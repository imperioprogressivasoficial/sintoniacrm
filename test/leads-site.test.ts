import { describe, expect, it } from 'vitest';
import { ContasMemoria, ContasPostgres, type Contas } from '../src/auth/contas.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { diasDemonstracao, horarioValido, instanteBrasilia } from '../src/vendas/demonstracao.js';
import { poolDeTeste, temPostgres } from './repos.js';

// sexta-feira, 6/11/2026, 12h em Brasília
const AGORA = new Date('2026-11-06T15:00:00Z');

function montar(contas: Contas = new ContasMemoria()) {
  const relogio = { t: AGORA };
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => relogio.t, duracaoHoras: 12 } });
  return { app, relogio, contas };
}

const lead = {
  nome: 'Ana Souza',
  whatsapp: '(71) 9 8888-7777',
  email: 'Ana@Empresa.com.br',
  setor: 'Serviços',
  faturamento: 'R$ 50 mil a R$ 200 mil',
  plano: 'Colaborador de IA',
};

describe('Horários da demonstração', () => {
  it('oferece só dias úteis, das 9h às 17h30, de 30 em 30 min, com 2 h de antecedência', () => {
    const dias = diasDemonstracao(AGORA);
    expect(dias).toHaveLength(10);
    // sexta 6/11: a partir das 14h (12h + 2 h); sábado e domingo ficam de fora
    expect(dias[0]!.data).toBe('2026-11-06');
    expect(dias[0]!.horas[0]).toBe('14:00');
    expect(dias[0]!.horas.at(-1)).toBe('17:30');
    expect(dias[1]!.data).toBe('2026-11-09');
    expect(dias[1]!.horas).toHaveLength(18);
    expect(dias[1]!.horas[0]).toBe('09:00');
    expect(dias.map((d) => d.data)).not.toContain('2026-11-07');
  });
  it('converte o horário de Brasília e recusa horário fora da grade', () => {
    expect(instanteBrasilia('2026-11-09', '09:00')!.toISOString()).toBe('2026-11-09T12:00:00.000Z');
    expect(horarioValido('2026-11-09', '09:15', AGORA)).toBeUndefined();
    expect(horarioValido('2026-11-09', '18:00', AGORA)).toBeUndefined();
    expect(horarioValido('2026-11-07', '10:00', AGORA)).toBeUndefined(); // sábado
    expect(horarioValido('2026-11-06', '12:30', AGORA)).toBeUndefined(); // perto demais
    expect(horarioValido('2026-11-09', '17:30', AGORA)).toBeDefined();
  });
  it('tira da lista os horários ocupados', () => {
    const dias = diasDemonstracao(AGORA, [instanteBrasilia('2026-11-09', '10:00')!]);
    expect(dias[1]!.horas).not.toContain('10:00');
    expect(dias[1]!.horas).toHaveLength(17);
  });
});

describe('POST /api/leads-site e a demonstração', () => {
  it('salva o lead, agenda a demonstração e não deixa dois no mesmo horário', async () => {
    const contas = new ContasMemoria();
    const { app } = montar(contas);
    const r = await app.inject({ method: 'POST', url: '/api/leads-site', payload: lead });
    expect(r.statusCode).toBe(200);
    const { id, token } = r.json();
    expect(contas.leadsSite[0]).toMatchObject({ nome: 'Ana Souza', whatsapp: '71988887777', email: 'ana@empresa.com.br', setor: 'Serviços', plano: 'Colaborador de IA', origem: 'pagina-vendas' });

    const horarios = (await app.inject({ url: '/api/leads-site/horarios' })).json();
    expect(horarios.dias[1].data).toBe('2026-11-09');

    const errado = await app.inject({ method: 'POST', url: '/api/leads-site/demonstracao', payload: { id, token: 'y'.repeat(43), data: '2026-11-09', hora: '10:00' } });
    expect(errado.statusCode).toBe(404);
    const ok = await app.inject({ method: 'POST', url: '/api/leads-site/demonstracao', payload: { id, token, data: '2026-11-09', hora: '10:00' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, data: '2026-11-09', hora: '10:00', em: '2026-11-09T13:00:00.000Z' });
    expect(contas.leadsSite[0]!.demoEm?.toISOString()).toBe('2026-11-09T13:00:00.000Z');

    const outro = (await app.inject({ method: 'POST', url: '/api/leads-site', payload: { ...lead, nome: 'Bia Lima' } })).json();
    const choque = await app.inject({ method: 'POST', url: '/api/leads-site/demonstracao', payload: { id: outro.id, token: outro.token, data: '2026-11-09', hora: '10:00' } });
    expect(choque.statusCode).toBe(409);
    const depois = (await app.inject({ url: '/api/leads-site/horarios' })).json();
    expect(depois.dias[1].horas).not.toContain('10:00');
    const fora = await app.inject({ method: 'POST', url: '/api/leads-site/demonstracao', payload: { id: outro.id, token: outro.token, data: '2026-11-07', hora: '10:00' } });
    expect(fora.statusCode).toBe(400);
  });

  it('valida os campos, ignora robôs e limita a taxa', async () => {
    const contas = new ContasMemoria();
    const { app } = montar(contas);
    const semEmail = await app.inject({ method: 'POST', url: '/api/leads-site', payload: { ...lead, email: 'nao-e-email' } });
    expect(semEmail.statusCode).toBe(400);
    expect(semEmail.json().erro).toMatch(/e-mail/);
    expect((await app.inject({ method: 'POST', url: '/api/leads-site', payload: { ...lead, setor: 'Mineração' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/leads-site', payload: { ...lead, whatsapp: '123' } })).statusCode).toBe(400);
    const robo = await app.inject({ method: 'POST', url: '/api/leads-site', payload: { ...lead, site: 'http://spam' } });
    expect(robo.statusCode).toBe(200);
    expect(contas.leadsSite).toHaveLength(0);
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'POST', url: '/api/leads-site', payload: lead })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/leads-site', payload: lead })).statusCode).toBe(429);
    expect(contas.leadsSite).toHaveLength(5);
  });
});

describe('Calculadora de custo da IA (public/calculadora-ia.js)', () => {
  it('compara funcionários com o Colaborador de IA', async () => {
    await import(/* @vite-ignore */ new URL('../public/calculadora-ia.js', import.meta.url).href);
    const calc = (globalThis as unknown as { SintoniaCalculadora: { calcular(e: object): any } }).SintoniaCalculadora;
    const r = calc.calcular({});
    // 1.800 × 1,7 + 600 = 3.660 por atendente
    expect(r.funcionarios.mes).toBe(3660);
    expect(r.funcionarios.ano).toBe(43920);
    expect(r.ia).toMatchObject({ mes: 1997, recargas: 0, estimativa: true });
    expect(r.economia.mes).toBe(1663);
    expect(r.horas).toMatchObject({ ia: 168, funcionario: 40 });
    const tres = calc.calcular({ atendentes: 3, conversas: 2000 });
    expect(tres.funcionarios.mes).toBe(10980);
    expect(tres.ia.recargas).toBe(3); // 500 a mais ÷ 190
    expect(tres.ia.mes).toBe(1997 + 297);
    expect(tres.horas.equipe).toBe(120);
    expect(calc.calcular({ atendentes: 50 }).entradas.atendentes).toBe(10);
  });
});

describe.runIf(temPostgres)('Leads do site no Postgres', () => {
  it('grava o lead e a demonstração, sem dois no mesmo horário', async () => {
    const pool = await poolDeTeste();
    const contas = new ContasPostgres(pool);
    const a = await contas.registrarLeadSite({ nome: 'Ana', whatsapp: '71988887777', email: 'ana@x.com', setor: 'Serviços', faturamento: 'até R$ 50 mil', plano: 'Essencial', origem: 'pagina-vendas' });
    const b = await contas.registrarLeadSite({ nome: 'Bia', whatsapp: '71988886666', email: 'bia@x.com', setor: 'Outro', faturamento: 'acima de R$ 1 milhão', plano: 'Empresarial' });
    const em = instanteBrasilia('2026-11-09', '10:00')!;
    expect(await contas.agendarDemonstracao(a.id, 'errado'.repeat(8), em, AGORA)).toBe('nao-achou');
    expect(await contas.agendarDemonstracao(a.id, a.token, em, AGORA)).toBe('ok');
    expect(await contas.agendarDemonstracao(a.id, a.token, em, AGORA)).toBe('ok');
    expect(await contas.agendarDemonstracao(b.id, b.token, em, AGORA)).toBe('ocupado');
    expect(await contas.agendarDemonstracao(a.id, a.token, instanteBrasilia('2026-11-09', '11:00')!, AGORA)).toBe('ja-agendado');
    expect((await contas.demonstracoesOcupadas(AGORA, new Date('2026-12-01T00:00:00Z'))).map((d) => d.toISOString())).toEqual([em.toISOString()]);
    const { rows } = await pool.query('select nome, email, setor, faturamento, plano, demo_em from sintonia.interessados order by id');
    expect(rows[0]).toMatchObject({ nome: 'Ana', email: 'ana@x.com', setor: 'Serviços', plano: 'Essencial' });
    expect(rows[1].demo_em).toBeNull();
  });
});
