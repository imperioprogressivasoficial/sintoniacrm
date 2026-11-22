import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { DadosDesempenho } from '../src/desempenho/calculo.js';
import type { FonteDesempenho } from '../src/desempenho/fonte.js';
import { calcularEconomia, CUSTO_PADRAO, custoPessoaMes } from '../src/economia-ia/calculo.js';
import { custoGravado, registrarEconomiaIa } from '../src/economia-ia/rotas.js';
import { ArmazemPlanosMemoria, ArmazemPlanosPostgres } from '../src/planos/armazem.js';
import { Planos } from '../src/planos/porteiro.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

/* calculadora: "Quanto a IA economiza" (Inteligência). */

const AGORA = new Date('2026-11-20T15:00:00Z');
const SENHA = 'Imperio2026xyz';

describe('conta da economia (função pura)', () => {
  it('custo de uma pessoa, horas poupadas, saldo e 24 h com gente', () => {
    expect(custoPessoaMes(CUSTO_PADRAO)).toBe(3660); // 1.800 × 1,7 + 600
    const r = calcularEconomia(
      { dias: 30, mensagensIa: 3000, conversasIa: 400, foraDoHorarioIa: 900, agendamentosIa: 40, valorIa: 8000, respostaIaMs: 10_000, respostaEquipeMs: 600_000, mensagensEquipe: 1000 },
      CUSTO_PADRAO,
    );
    // 3.000 mensagens × 2 min = 100 h; hora = 3.660 ÷ (40 × 52 ÷ 12 = 173,3 h) = 21,12
    expect(r.horasPoupadas).toBe(100);
    expect(r.pessoa.hora).toBeCloseTo(21.12, 2);
    expect(r.valorHoras).toBeCloseTo(2111.54, 1);
    expect(r.custoIaPeriodo).toBe(1997);
    expect(r.saldoPeriodo).toBeCloseTo(114.54, 1);
    expect(r.pessoasEquivalentes).toBe(0.6);
    // 168 ÷ 40 = 4,2 → 5 pessoas × 3.660 = 18.300 contra R$ 1.997
    expect(r.cobertura24h).toEqual({ pessoas: 5, custoMes: 18300, custoIaMes: 1997, economiaMes: 16303 });
    expect(r.respostaVezesMaisRapida).toBe(60);
    expect(r.temDados).toBe(true);
    // 7 dias: custo da IA proporcional e saldo levado para 30 dias.
    const s = calcularEconomia({ ...r.real, dias: 7, mensagensIa: 0 }, CUSTO_PADRAO);
    expect(s.custoIaPeriodo).toBeCloseTo(465.97, 2);
    expect(s.saldoMes).toBeCloseTo(-1997, 0);
    expect(s.temDados).toBe(false);
  });

  it('custo gravado: o novo por cima do antigo custo do atendente, valor ruim é ignorado', () => {
    expect(custoGravado({})).toEqual(CUSTO_PADRAO);
    expect(custoGravado({ clt: { salario: 2500, horasSemana: 44 } })).toMatchObject({ salario: 2500, horasSemana: 44, encargosPct: 70 });
    expect(custoGravado({ clt: { salario: 2500 }, economia: { salario: 3000, minutosPorMensagem: 3 } })).toMatchObject({ salario: 3000, minutosPorMensagem: 3 });
    expect(custoGravado({ economia: { salario: -5 } }).salario).toBe(1800);
  });
});

function dadosFalsos(): DadosDesempenho {
  const em = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);
  return {
    mensagens: [
      { conversaId: 'c1', autor: 'cliente', em: em(30) },
      { conversaId: 'c1', autor: 'ia', em: em(29.99) },
      { conversaId: 'c1', autor: 'ia', em: em(29.98) },
      { conversaId: 'c2', autor: 'cliente', em: em(5) },
      { conversaId: 'c2', autor: 'ia', em: em(4.99) },
      { conversaId: 'c3', autor: 'equipe', em: em(3) },
      { conversaId: 'velha', autor: 'ia', em: em(24 * 40) }, // fora do período de 30 dias
    ],
    eventos: [],
    agendamentos: [],
    conversas: new Map(),
  } as unknown as DadosDesempenho;
}

async function montar() {
  const contas = new ContasMemoria();
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const hash = await gerarHash(SENHA);
  for (const [nome, email, papel] of [['Bruno', 'bruno@x.com', 'admin'], ['Gina', 'gina@x.com', 'gerente'], ['Carla', 'carla@x.com', 'atendente']] as const) {
    await contas.criarUsuario({ empresaId: 'imperio', nome, email, papel, unidades: [], senhaHash: hash });
  }
  const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => AGORA, duracaoHoras: 12 } });
  const pedidos: Array<{ inicio: Date; fim: Date; empresaId?: string }> = [];
  const fonte: FonteDesempenho = {
    carregar: async (inicio, fim, _agora, esc) => { pedidos.push({ inicio, fim, empresaId: esc.empresaId }); return dadosFalsos(); },
    esperando: async () => [],
  };
  const planos = new Planos({ armazem: new ArmazemPlanosMemoria() });
  registrarEconomiaIa(app, { fonte, planos, contas, empresaId: 'imperio', agora: () => AGORA });
  const cookie = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: SENHA } })).headers['set-cookie']).split(';')[0]!;
  return { app, cookie, pedidos };
}

describe('rotas /api/economia-ia', () => {
  it('mostra os números reais do período e a conta com o custo padrão', async () => {
    const { app, cookie, pedidos } = await montar();
    const r = await app.inject({ url: '/api/economia-ia?dias=30', headers: { cookie: await cookie('bruno@x.com') } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.real).toMatchObject({ mensagensIa: 3, conversasIa: 2, mensagensEquipe: 1, dias: 30 });
    expect(b.custo).toEqual(CUSTO_PADRAO);
    expect(b.podeGravar).toBe(true);
    expect(pedidos[0]).toMatchObject({ empresaId: 'imperio' });
    expect(AGORA.getTime() - pedidos[0]!.inicio.getTime()).toBe(30 * 86_400_000);
    // Valores na consulta mudam a conta sem gravar.
    const q = (await app.inject({ url: '/api/economia-ia?dias=7&salario=3000&minutosPorMensagem=4', headers: { cookie: await cookie('bruno@x.com') } })).json();
    expect(q.custo).toMatchObject({ salario: 3000, minutosPorMensagem: 4 });
    expect(q.gravado.salario).toBe(1800);
    expect((await app.inject({ url: '/api/economia-ia?dias=12', headers: { cookie: await cookie('bruno@x.com') } })).statusCode).toBe(400);
  });

  it('administração grava o custo; gerente vê mas não grava; atendente não vê; sem login, 401', async () => {
    const { app, cookie } = await montar();
    const custo = { salario: 2200, encargosPct: 80, beneficios: 500, horasSemana: 42, minutosPorMensagem: 3, custoIaMes: 1997 };
    const g = await cookie('gina@x.com');
    expect((await app.inject({ url: '/api/economia-ia', headers: { cookie: g } })).json().podeGravar).toBe(false);
    expect((await app.inject({ method: 'PUT', url: '/api/economia-ia/custo', headers: { cookie: g }, payload: custo })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/economia-ia', headers: { cookie: await cookie('carla@x.com') } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/economia-ia' })).statusCode).toBe(401);
    const b = await cookie('bruno@x.com');
    expect((await app.inject({ method: 'PUT', url: '/api/economia-ia/custo', headers: { cookie: b }, payload: { ...custo, salario: -1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/economia-ia/custo', headers: { cookie: b }, payload: { ...custo, extra: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/economia-ia/custo', headers: { cookie: b }, payload: custo })).statusCode).toBe(200);
    const depois = (await app.inject({ url: '/api/economia-ia', headers: { cookie: g } })).json();
    expect(depois.custo).toEqual(custo);
    expect(depois.pessoa.mes).toBe(2200 * 1.8 + 500);
  });
});

describe.runIf(temPostgres)('custo da equipe no Postgres', () => {
  it('grava e lê o custo junto da assinatura, sem perder o custo antigo nem os limites', async () => {
    const pool = await poolDeTeste();
    const armazem = new ArmazemPlanosPostgres(pool);
    await armazem.gravarAssinatura({ empresaId: 'calc', plano: 'essencial', status: 'ativa', clt: { salario: 2000 }, limites: { mes: 10 }, economia: { minutosPorMensagem: 3 }, atualizadaEm: AGORA, atualizadaPor: 'Bruno' });
    const a = await armazem.assinatura('calc');
    expect(a).toMatchObject({ clt: { salario: 2000 }, limites: { mes: 10 }, economia: { minutosPorMensagem: 3 } });
    expect(custoGravado(a!)).toMatchObject({ salario: 2000, minutosPorMensagem: 3 });
  });
});
