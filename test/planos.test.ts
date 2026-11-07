import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { PedidoAgente } from '../src/ai/agente.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemPlanosMemoria, ArmazemPlanosPostgres, type ArmazemPlanos } from '../src/planos/armazem.js';
import { calcularCalculadora, CONFIG_SUGERIDA, catalogo, custoMensalClt, custoUsd, normalizarPlano, precoColaborador, type PlanoIdGravado } from '../src/planos/catalogo.js';
import { calcularComparativo } from '../src/planos/comparativo.js';
import { anotadorDe, comContexto, comPorteiro, IaBloqueada, medirCliente, porteiroDe } from '../src/planos/medidor.js';
import { PagamentoManual } from '../src/planos/pagamento.js';
import { Planos, textoQuando } from '../src/planos/porteiro.js';
import { registrarPlanos } from '../src/planos/rotas.js';
import { bahia } from '../src/util/tempo.js';
import { AgenteFalso, ambientes, montarBot, quinta } from './bot-ambiente.js';
import { poolDeTeste, temPostgres } from './repos.js';

const EMP = 'loja';
/** Segunda, 9/11/2026, horário da Bahia. */
const seg = (hora: number, min = 0) => bahia(2026, 11, 9, hora, min);
const espera = () => new Promise((r) => setTimeout(r, 5));
const L = CONFIG_SUGERIDA.limites;

function planosCom(armazem: ArmazemPlanos = new ArmazemPlanosMemoria()) {
  return new Planos({ armazem, fundadoras: ['imperio'] });
}
async function assinar(p: Planos, plano: PlanoIdGravado, extra: Partial<Parameters<ArmazemPlanos['gravarAssinatura']>[0]> = {}, empresaId = EMP) {
  await p.armazem.gravarAssinatura({ empresaId, plano: plano as never, status: 'ativa', atualizadaEm: seg(8), atualizadaPor: 'teste', ...extra });
}
const uso = (tokens: number) => ({ entrada: tokens, saida: 0, cacheLeitura: 0, cacheEscrita: 0 });
const gastar = (p: Planos, em: Date, tokens: number, empresaId = EMP) => p.registrarUso({ empresaId, em, conversaId: 'c1', origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(tokens) });
async function creditar(p: Planos, tokens: number, em: Date, empresaId = EMP) {
  const ped = await p.armazem.criarPedido({ empresaId, tipo: 'recarga', dados: { tokens }, status: 'pendente', criadoEm: em, pagoEm: null, por: 'x' });
  await p.confirmarPedido(empresaId, ped.id, em);
}

describe('catálogo e fórmulas', () => {
  it('planos novos, preços e limites sugeridos; id antigo "gratis" vira Essencial', () => {
    expect(custoMensalClt({ salario: 1800, encargosPct: 70, beneficios: 600 })).toBe(3660);
    expect(precoColaborador(CONFIG_SUGERIDA)).toBe(1997);
    const cat = catalogo(CONFIG_SUGERIDA);
    expect(cat.map((p) => p.id)).toEqual(['essencial', 'expediente', 'empresarial', 'fundador']);
    expect(cat.map((p) => p.nome)).toEqual(['Essencial', 'Colaborador de IA', 'Empresarial', 'Fundador']);
    expect(cat[0]).toMatchObject({ ia: false, preco: 497, mesesGratis: 12 });
    expect(cat[1]).toMatchObject({ ia: true, preco: 1997, horasSemana: 168, limites: { cincoHoras: 2_500_000, semana: 12_000_000, mes: 40_000_000 } });
    expect(cat[2]).toMatchObject({ ia: true, preco: null });
    expect(JSON.stringify(cat)).not.toMatch(/celular|aplicativo|fora do horário/i);
    expect(normalizarPlano('gratis')).toBe('essencial');
    expect(normalizarPlano('qualquer')).toBe('essencial');
  });
  it('custo por token (US$ por milhão)', () => {
    expect(custoUsd(CONFIG_SUGERIDA, 'claude-opus-5-5', { entrada: 1_000_000, saida: 100_000, cacheLeitura: 1_000_000, cacheEscrita: 0 })).toBeCloseTo(4 + 2 + 0.2);
  });
  it('texto de quando o limite volta/renova', () => {
    expect(textoQuando(seg(15, 20), seg(10), 'volta')).toBe('volta às 15h20');
    expect(textoQuando(bahia(2026, 11, 10, 9), seg(22), 'volta')).toBe('volta amanhã às 9h');
    expect(textoQuando(bahia(2026, 11, 16), seg(10), 'renova')).toBe('renova segunda');
    expect(textoQuando(bahia(2026, 12, 1), seg(10), 'renova')).toBe('renova dia 1º/12');
  });
});

describe('calculadora "Quanto custa ter a IA no seu negócio"', () => {
  const base = { atendentes: 1, salario: 1800, encargosPct: 70, beneficios: 600, conversasMes: 1500 };
  it('1 atendente, 1.500 conversas: só o plano', () => {
    const c = calcularCalculadora(base);
    expect(c).toMatchObject({ custoFuncionariosMensal: 3660, custoFuncionariosAnual: 43920, recargasEstimadas: 0, creditosEstimadosMensal: 0, custoIaMensal: 1997, custoIaAnual: 23964, economiaMensal: 1663, economiaAnual: 19956, horasIaSemana: 168, horasEquipeSemana: 44, calibrada: false });
  });
  it('mais conversas: recargas de R$ 99 a cada ~190 conversas (arredonda para cima)', () => {
    const c = calcularCalculadora({ ...base, atendentes: 3, conversasMes: 2000 });
    // (2000 − 1500) / 190 = 2,6 → 3 recargas = R$ 297
    expect(c).toMatchObject({ custoFuncionariosMensal: 10980, recargasEstimadas: 3, creditosEstimadosMensal: 297, custoIaMensal: 2294, economiaMensal: 8686, economiaAnual: 104232, horasEquipeSemana: 132 });
  });
  it('limita atendentes a 1–10 e calibra pela média real de tokens por conversa', () => {
    expect(calcularCalculadora({ ...base, atendentes: 40 }).custoFuncionariosMensal).toBe(36600);
    expect(calcularCalculadora({ ...base, atendentes: 0 }).custoFuncionariosMensal).toBe(3660);
    // 50 mil tokens/conversa: o plano cobre 40 mi / 50 mil = 800 conversas; a recarga, 5 mi / 50 mil = 100.
    const c = calcularCalculadora({ ...base, conversasMes: 1000, tokensPorConversa: 50_000 });
    expect(c).toMatchObject({ calibrada: true, conversasPlano: 800, conversasPorRecarga: 100, recargasEstimadas: 2, custoIaMensal: 1997 + 198 });
  });
});

describe('medição de uso', () => {
  it('anota cada chamada com conversa, tokens e custo; soma por dia e mês', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    let agora = seg(10);
    const falso = {
      beta: {
        messages: {
          create: async (args: { model: string }) => ({ model: args.model, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, content: [] }),
        },
      },
    };
    const cliente = medirCliente(falso, anotadorDe(p, EMP, () => agora));
    await comContexto({ conversaId: 'c1', origem: 'agente' }, () => cliente.beta.messages.create({ model: 'claude-opus-5-5' }));
    agora = seg(21);
    await cliente.beta.messages.create({ model: 'claude-opus-5-5' }); // sem contexto: origem "outro"
    await espera();
    const a = p.armazem as ArmazemPlanosMemoria;
    expect(a.usos).toHaveLength(2);
    expect(a.usos[0]).toMatchObject({ conversaId: 'c1', origem: 'agente', entrada: 1000, saida: 200, cacheLeitura: 5000, tokensCredito: 0 });
    expect(a.usos[0]!.custoUsd).toBeCloseTo((1000 * 4 + 200 * 20 + 5000 * 0.2) / 1e6);
    expect(a.usos[1]).toMatchObject({ conversaId: null, origem: 'outro' });
    const r = await p.armazem.resumo(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1));
    expect(r).toMatchObject({ tokens: 12400, tokensCredito: 0, conversas: 1 });
    expect(r.porDia.map((d) => d.dia)).toEqual(['2026-11-09']);
  });
});

describe('porteiro: limites de uso no estilo Claude', () => {
  it('Colaborador de IA trabalha 24 h (madrugada e domingo)', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    expect(await p.decidir(EMP, seg(3))).toMatchObject({ pode: true, usandoCreditos: false });
    expect(await p.decidir(EMP, bahia(2026, 11, 8, 23))).toMatchObject({ pode: true });
    expect(await p.decidir(EMP, bahia(2026, 11, 20, 10))).toMatchObject({ pode: true }); // feriado
  });
  it('janela móvel de 5 h: estoura, bloqueia sem crédito e volta quando o uso sai da janela', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    await gastar(p, seg(10, 20), 1_500_000);
    await gastar(p, seg(12), 1_000_000); // 2,5 mi em 5 h: estourou
    const d = await p.decidir(EMP, seg(13));
    expect(d).toMatchObject({ pode: false, motivo: 'sem_credito' });
    expect(d.pode === false && d.texto).toContain('volta às 15h20');
    const s = await p.situacao(EMP, seg(13));
    expect(s.limites[0]).toMatchObject({ id: 'cincoHoras', usados: 2_500_000, estourou: true, texto: 'volta às 15h20' });
    expect(s.limites[0]!.renovaEm).toBe(seg(15, 20).toISOString());
    expect(s.limites[1]).toMatchObject({ id: 'semana', estourou: false, texto: 'renova segunda' });
    // 15h20: o 1,5 mi das 10h20 saiu da janela móvel.
    expect(await p.decidir(EMP, seg(15, 21))).toMatchObject({ pode: true, usandoCreditos: false });
  });
  it('limite semanal e mensal; renova segunda e dia 1º', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    // Uso espalhado (nunca 2,5 mi em 5 h) até bater 12 mi na semana.
    for (let i = 0; i < 6; i++) await gastar(p, bahia(2026, 11, 9 + i, 9), 2_000_000);
    const s = await p.situacao(EMP, bahia(2026, 11, 14, 20));
    expect(s.limites.map((l) => [l.id, l.estourou])).toEqual([['cincoHoras', false], ['semana', true], ['mes', false]]);
    expect(s.limites[1]!.texto).toBe('renova segunda');
    expect(await p.decidir(EMP, bahia(2026, 11, 14, 20))).toMatchObject({ pode: false, motivo: 'sem_credito' });
    expect(await p.decidir(EMP, bahia(2026, 11, 16, 0, 1))).toMatchObject({ pode: true }); // segunda: nova semana
    // Mês: 40 mi (com limite semanal folgado para isolar o mensal).
    const q = planosCom();
    await assinar(q, 'expediente', { limites: { semana: null } });
    for (let i = 0; i < 20; i++) await gastar(q, bahia(2026, 11, 1 + i, 9), 2_000_000);
    const m = await q.situacao(EMP, bahia(2026, 11, 25));
    expect(m.limites[2]).toMatchObject({ id: 'mes', usados: 40_000_000, estourou: true, texto: 'renova dia 1º/12' });
    expect(m.limites[1]).toMatchObject({ limite: null, texto: 'sem limite' });
    expect(await q.decidir(EMP, bahia(2026, 12, 1, 0, 1))).toMatchObject({ pode: true });
  });
  it('estourou: a IA continua com créditos, que só são gastos depois do limite; sem crédito, para', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    await creditar(p, 1_000_000, seg(8));
    await gastar(p, seg(9), 2_000_000); // dentro do limite: não gasta crédito
    expect((await p.situacao(EMP, seg(9, 1))).creditos).toEqual({ comprados: 1_000_000, usados: 0, saldo: 1_000_000 });
    await gastar(p, seg(9, 30), 600_000); // ainda não tinha estourado antes da chamada: conta no plano (2,6 mi)
    expect(await p.decidir(EMP, seg(10))).toMatchObject({ pode: true, usandoCreditos: true });
    await gastar(p, seg(10), 700_000); // estourado: sai dos créditos
    let s = await p.situacao(EMP, seg(10, 1));
    expect(s.creditos).toEqual({ comprados: 1_000_000, usados: 700_000, saldo: 300_000 });
    expect(s.limites[0]!.usados).toBe(2_600_000); // tokens pagos com crédito não contam no limite
    await gastar(p, seg(10, 5), 300_000);
    s = await p.situacao(EMP, seg(10, 6));
    expect(s.creditos.saldo).toBe(0);
    expect(await p.decidir(EMP, seg(10, 6))).toMatchObject({ pode: false, motivo: 'sem_credito' });
    // Pedido pendente não credita; pago libera na hora.
    const ped = await p.armazem.criarPedido({ empresaId: EMP, tipo: 'recarga', dados: { tokens: 5_000_000 }, status: 'pendente', criadoEm: seg(10, 7), pagoEm: null, por: 'x' });
    expect(await p.decidir(EMP, seg(10, 8))).toMatchObject({ pode: false });
    await p.confirmarPedido(EMP, ped.id, seg(10, 9));
    expect(await p.decidir(EMP, seg(10, 10))).toMatchObject({ pode: true, usandoCreditos: true });
    const r = await p.armazem.resumo(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1));
    expect(r.tokensCredito).toBe(1_000_000);
  });
  it('Empresarial: limites da assinatura (personalizados por empresa)', async () => {
    const p = planosCom();
    await assinar(p, 'empresarial', { limites: { cincoHoras: 10_000_000, semana: 50_000_000, mes: null } });
    await gastar(p, seg(9), 5_000_000); // estouraria o Colaborador (2,5 mi em 5 h)
    expect(await p.decidir(EMP, seg(10))).toMatchObject({ pode: true, usandoCreditos: false });
    const s = await p.situacao(EMP, seg(10));
    expect(s.plano.nome).toBe('Empresarial');
    expect(s.limites.map((l) => l.limite)).toEqual([10_000_000, 50_000_000, null]);
    await gastar(p, seg(10), 5_000_000);
    expect(await p.decidir(EMP, seg(11))).toMatchObject({ pode: false, motivo: 'sem_credito' });
    // Sem ajuste gravado, usa os limites sugeridos.
    await assinar(p, 'empresarial', {}, 'outra');
    expect((await p.situacao('outra', seg(10))).limites.map((l) => l.limite)).toEqual([L.cincoHoras, L.semana, L.mes]);
  });
  it('Fundador (conta original, sem assinatura gravada): sem limite, sem cobrança, nunca gasta crédito', async () => {
    const p = planosCom();
    await gastar(p, seg(9), 10 * L.mes!, 'imperio');
    expect(await p.decidir('imperio', bahia(2026, 11, 8, 3))).toMatchObject({ pode: true, ilimitado: true });
    const s = await p.situacao('imperio', seg(10));
    expect(s).toMatchObject({ ilimitado: true, estourou: false });
    expect(s.limites.every((l) => l.limite === null && !l.estourou)).toBe(true);
    expect((p.armazem as ArmazemPlanosMemoria).usos[0]!.tokensCredito).toBe(0);
    expect((await p.assinatura('imperio')).plano).toBe('fundador');
    expect((await p.assinatura('outra')).plano).toBe('essencial');
  });
  it('assinatura suspensa para a IA', async () => {
    const p = planosCom();
    await assinar(p, 'expediente', { status: 'suspensa' });
    expect(await p.decidir(EMP, seg(10))).toMatchObject({ pode: false, motivo: 'suspensa' });
  });
});

describe('Essencial: a IA não age de jeito nenhum', () => {
  it('porteiro, agente, sugestão (copiloto) e envio ativo bloqueados; "gratis" gravado vale como Essencial', async () => {
    const p = planosCom();
    await assinar(p, 'gratis');
    expect(await p.decidir(EMP, seg(10))).toMatchObject({ pode: false, motivo: 'sem_plano' });
    let chamou = 0;
    const agente = { executar: async () => (chamou++, { texto: 'oi', acoes: [], recusou: false }) };
    const g = comPorteiro(agente, { planos: p, empresaId: EMP });
    const pedido = { conversa: { id: 'c9' } as Conversa, mensagens: [], agora: seg(10), modo: 'responder' } as PedidoAgente;
    const r = await g.executar(pedido);
    expect(chamou).toBe(0);
    expect(r.texto).toBe('');
    expect(r.acoes).toEqual([{ tipo: 'passar_para_humano', motivo: expect.stringContaining('Essencial') }]);
    expect((p.armazem as ArmazemPlanosMemoria).bloq).toMatchObject([{ conversaId: 'c9', motivo: 'sem_plano' }]);
    // Sugestão (copiloto) e envio ativo: a IA só não age (não tira a conversa de ninguém).
    expect(await g.executar({ ...pedido, modo: 'sugerir' } as PedidoAgente)).toMatchObject({ texto: '', acoes: [] });
    expect((await g.executar({ ...pedido, tipoAtivo: 'followup_3d' } as PedidoAgente)).acoes).toEqual([]);
    expect(chamou).toBe(0);
    await assinar(p, 'expediente');
    expect((await g.executar(pedido)).texto).toBe('oi');
    expect(chamou).toBe(1);
  });
  it('cliente da IA com porteiro: nenhuma chamada sai (relatórios, comandos, revisão, agentes do estúdio)', async () => {
    const p = planosCom();
    let chamadas = 0;
    const falso = { messages: { create: async () => (chamadas++, { model: 'm', usage: { input_tokens: 1, output_tokens: 1 } }) }, beta: { messages: { parse: async () => (chamadas++, { model: 'm', usage: { input_tokens: 1, output_tokens: 1 } }) } } };
    const cliente = medirCliente(falso, anotadorDe(p, EMP, () => seg(10)), porteiroDe(p, EMP, () => seg(10)));
    await expect(cliente.messages.create()).rejects.toBeInstanceOf(IaBloqueada);
    await expect(cliente.beta.messages.parse()).rejects.toThrow(/Essencial/);
    expect(chamadas).toBe(0);
    await assinar(p, 'expediente');
    await cliente.messages.create();
    expect(chamadas).toBe(1);
    // Limite estourado no meio da resposta: comPorteiro passa a conversa para a equipe.
    const g = comPorteiro({ executar: async () => { throw new IaBloqueada('sem_credito', 'Limite atingido.'); } }, { planos: p, empresaId: EMP });
    const r = await g.executar({ conversa: { id: 'c1' } as Conversa, mensagens: [], agora: seg(10), modo: 'responder' } as PedidoAgente);
    expect(r.acoes).toEqual([{ tipo: 'passar_para_humano', motivo: 'Limite atingido.' }]);
  });
  it('o chatbot de fluxo (sem IA) funciona; o bloco "Agente de IA" não faz a IA responder', async () => {
    const p = new Planos({ armazem: new ArmazemPlanosMemoria() }); // "imperio" aqui não é fundadora: Essencial
    class AgenteComPorteiro extends AgenteFalso {
      private readonly g = comPorteiro({ executar: (x: PedidoAgente) => super.executar(x) }, { planos: p, empresaId: 'imperio' });
      override executar(x: PedidoAgente) {
        return this.g.executar(x);
      }
    }
    const agente = new AgenteComPorteiro(() => ({ texto: 'Resposta da IA', acoes: [], recusou: false }));
    const m = await montarBot(ambientes[0]!, { agente, inicio: quinta(14) });
    const criar = async (nome: string, rascunho: unknown) => {
      const f = (await m.como(m.gente.admin, 'POST', '/api/bots', { nome, rascunho })).json() as { id: string };
      await m.como(m.gente.admin, 'POST', `/api/bots/${f.id}/publicar`);
      await m.como(m.gente.admin, 'POST', `/api/bots/${f.id}/ligar`);
    };
    const lig = (l: Array<[string, string, string]>) => l.map(([de, saida, para], i) => ({ id: `l${i}`, de, saida, para }));
    await criar('Menu', {
      nos: [
        { id: 'ini', tipo: 'inicio', gatilho: { tipo: 'palavra_chave', palavras: ['menu'] } },
        { id: 'p', tipo: 'pergunta', texto: 'Como posso ajudar?', variavel: 'servico', tentativas: 1, opcoes: [{ id: 'prog', texto: 'Progressiva' }, { id: 'ag', texto: 'Agendar' }] },
        { id: 'm1', tipo: 'mensagem', texto: 'Você escolheu {servico}.' },
        { id: 'ia', tipo: 'agente_ia', objetivo: 'Agendar', saida: { tipo: 'mensagens', n: 2 }, dias: 1 },
        { id: 'fim', tipo: 'fim' },
      ],
      ligacoes: lig([['ini', 'proximo', 'p'], ['p', 'prog', 'm1'], ['p', 'ag', 'ia'], ['p', 'outro', 'fim'], ['m1', 'proximo', 'fim'], ['ia', 'concluiu', 'fim'], ['ia', 'tempo_esgotado', 'fim']]),
    });
    const c = await m.conversa('norte', 'Marina', 'menu');
    expect(m.enviadosPara(c)).toEqual([expect.stringContaining('Como posso ajudar?')]);
    m.avancar(1);
    await m.escreve(c, '1');
    expect(m.enviadosPara(c).at(-1)).toBe('Você escolheu Progressiva.');
    m.avancar(1);
    await m.escreve(c, 'menu');
    m.avancar(1);
    await m.escreve(c, '2'); // bloco "Agente de IA": no Essencial a IA não responde e a conversa vai para a equipe
    expect(m.enviadosPara(c)).not.toContain('Resposta da IA');
    expect(agente.pedidos).toHaveLength(0);
    expect((await m.buscar(c.id)).modo).toBe('humano');
  });
});

describe('comparativo IA × humano', () => {
  it('custo por agendamento, horas cobertas e economia', () => {
    const c = calcularComparativo({
      dias: 30,
      clt: { salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 44 },
      precoIaMensal: 1830,
      horasIaSemana: 44,
      custoApiPeriodo: 120,
      ia: { conversas: 300, agendamentos: 60, respostaMs: 20_000 },
      equipe: { conversas: 200, agendamentos: 40, respostaMs: 600_000, atendentes: 2 },
    });
    expect(c.custoCltMensal).toBe(3660);
    expect(c.ia.custoPorAgendamento).toBe(30.5);
    expect(c.equipe.custoPeriodo).toBe(7320);
    expect(c.equipe.custoPorAgendamento).toBe(183);
    expect(c.equipe.horasSemana).toBe(88);
    expect(c.cltsEquivalentes).toBe(1);
    expect(c.economiaMensal).toBe(1830);
    expect(c.iaMaisBarataPorAgendamento).toBe(true);
    expect(c.respostaVezesMaisRapida).toBe(30);
  });
  it('24 h: a IA equivale a ~3,8 CLTs; sem agendamento não divide por zero', () => {
    const c = calcularComparativo({
      dias: 7,
      clt: { salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 44 },
      precoIaMensal: 2745,
      horasIaSemana: 168,
      custoApiPeriodo: 0,
      ia: { conversas: 0, agendamentos: 0, respostaMs: null },
      equipe: { conversas: 0, agendamentos: 0, respostaMs: null, atendentes: 0 },
    });
    expect(c.cltsEquivalentes).toBe(3.8);
    expect(c.economiaMensal).toBe(Math.round((3.8 * 3660 - 2745) * 100) / 100);
    expect(c.ia.custoPorAgendamento).toBeNull();
    expect(c.iaMaisBarataPorAgendamento).toBeNull();
  });
});

describe('rotas /api/planos', () => {
  async function app(papel: string) {
    const p = planosCom();
    const a = Fastify();
    a.addHook('onRequest', async (req) => {
      (req as { usuario?: unknown }).usuario = { id: 'u1', nome: 'Bruno', empresaId: 'imperio', papel };
    });
    registrarPlanos(a, { planos: p, pagamento: new PagamentoManual(), empresaId: 'imperio', agora: () => seg(10) });
    return { a, p };
  }
  it('admin vê o plano Fundador e registra pedido de recarga (sem cobrança real)', async () => {
    const { a, p } = await app('admin');
    const r = await a.inject({ method: 'GET', url: '/api/planos' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ assinatura: { plano: 'fundador' }, agora: { pode: true }, ilimitado: true, pagamento: { ativo: false }, calculadora: { conversasMes: 1500, conversasReais: false, tokensPorConversa: null } });
    expect(r.json().catalogo.map((x: { id: string }) => x.id)).toEqual(['essencial', 'expediente', 'empresarial']);
    expect(r.json().limites).toHaveLength(3);
    const ped = await a.inject({ method: 'POST', url: '/api/planos/pedidos', payload: { tipo: 'recarga', recargaId: 'r5' } });
    expect(ped.json()).toMatchObject({ pedido: { status: 'pendente', dados: { tokens: 5_000_000 } }, pagamentoAtivo: false });
    expect(ped.json().mensagem).toContain('Em breve');
    expect(await p.armazem.pedidos('imperio')).toHaveLength(1);
    const comp = await a.inject({ method: 'GET', url: '/api/planos/comparativo?dias=30&salario=2000' });
    expect(comp.statusCode).toBe(200);
    expect(comp.json()).toMatchObject({ precoReferencia: true, ia: { horasSemana: 168, custoMensal: 1997 } });
    // Mudar de plano só registra o pedido; Empresarial vai sem valor (sob medida). "adicional_fora" não existe mais.
    const mp = await a.inject({ method: 'POST', url: '/api/planos/pedidos', payload: { tipo: 'mudar_plano', plano: 'empresarial' } });
    expect(mp.json()).toMatchObject({ pedido: { tipo: 'mudar_plano', status: 'pendente', dados: { plano: 'empresarial', valor: 0, sobMedida: true } } });
    expect((await a.inject({ method: 'POST', url: '/api/planos/pedidos', payload: { tipo: 'adicional_fora', ligar: true } })).statusCode).toBeGreaterThanOrEqual(400); // o servidor real responde 400 ao ZodError
    expect((await p.assinatura('imperio')).plano).toBe('fundador');
  });
  it('Colaborador de IA: limites com quando renovam, créditos e média real da calculadora', async () => {
    const { a, p } = await app('admin');
    await assinar(p, 'expediente', {}, 'imperio');
    await gastar(p, seg(9), 3_000_000, 'imperio');
    await p.registrarUso({ empresaId: 'imperio', em: seg(9, 30), conversaId: 'c2', origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(1_000_000) });
    const j = (await a.inject({ method: 'GET', url: '/api/planos' })).json();
    expect(j.plano.nome).toBe('Colaborador de IA');
    expect(j.agora).toMatchObject({ pode: false, motivo: 'sem_credito' });
    expect(j.limites[0]).toMatchObject({ id: 'cincoHoras', estourou: true, texto: 'volta às 14h' });
    expect(j.limites[1].texto).toBe('renova segunda');
    expect(j.creditos).toEqual({ comprados: 0, usados: 0, saldo: 0 });
    // 2 conversas nos últimos 30 dias: vira o padrão de conversas/mês, mas é pouco para calibrar tokens por conversa.
    expect(j.calculadora).toMatchObject({ conversasMes: 2, conversasReais: true, tokensPorConversa: null });
    for (let i = 0; i < 20; i++) await p.registrarUso({ empresaId: 'imperio', em: bahia(2026, 11, 1, 9, i), conversaId: `k${i}`, origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(30_000) });
    expect((await a.inject({ method: 'GET', url: '/api/planos' })).json().calculadora).toMatchObject({ conversasMes: 22, tokensPorConversa: null }); // média de 208 mil: fora do plausível
    for (let i = 0; i < 40; i++) await p.registrarUso({ empresaId: 'imperio', em: bahia(2026, 11, 2, 9, i), conversaId: `q${i}`, origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(30_000) });
    // (4 mi + 60 × 30 mil) ÷ 62 conversas ≈ 93,5 mil tokens por conversa: calibra.
    expect((await a.inject({ method: 'GET', url: '/api/planos' })).json().calculadora).toMatchObject({ conversasMes: 62, tokensPorConversa: Math.round(5_800_000 / 62) });
  });
  it('atendente não entra', async () => {
    const { a } = await app('atendente');
    expect((await a.inject({ method: 'GET', url: '/api/planos' })).statusCode).toBe(403);
  });
});

describe.skipIf(!temPostgres)('planos no Postgres', () => {
  it('grava uso, assinatura, pedidos e bloqueios e soma igual à memória', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.ia_uso, sintonia.ia_assinaturas, sintonia.ia_pedidos, sintonia.ia_bloqueios');
    const p = planosCom(new ArmazemPlanosPostgres(pool));
    await assinar(p, 'empresarial', { limites: { cincoHoras: 200, semana: null } });
    expect((await p.assinatura(EMP)).limites).toEqual({ cincoHoras: 200, semana: null });
    await p.registrarUso({ empresaId: EMP, em: seg(10), conversaId: 'c1', origem: 'agente', modelo: 'claude-opus-5-5', uso: { entrada: 100, saida: 50, cacheLeitura: 10, cacheEscrita: 5 } });
    await p.registrarUso({ empresaId: EMP, em: seg(10, 30), conversaId: 'c2', origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(40) });
    expect(await p.decidir(EMP, seg(11))).toMatchObject({ pode: false, motivo: 'sem_credito' });
    const ped = await p.armazem.criarPedido({ empresaId: EMP, tipo: 'recarga', dados: { tokens: 100 }, status: 'pendente', criadoEm: seg(11), pagoEm: null, por: null });
    await p.confirmarPedido(EMP, ped.id, seg(11));
    expect(await p.decidir(EMP, seg(11, 1))).toMatchObject({ pode: true, usandoCreditos: true });
    await p.registrarUso({ empresaId: EMP, em: seg(11, 2), conversaId: 'c2', origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(30) });
    const r = await p.armazem.resumo(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1));
    expect(r).toMatchObject({ tokens: 235, tokensCredito: 30, conversas: 2, chamadas: 3 });
    expect(r.porDia.map((d) => d.dia)).toEqual(['2026-11-09']);
    const s = await p.situacao(EMP, seg(11, 3));
    expect(s.limites[0]).toMatchObject({ usados: 205, estourou: true, texto: 'volta às 15h' });
    expect(s.creditos).toEqual({ comprados: 100, usados: 30, saldo: 70 });
    expect(await p.armazem.usosPlano(EMP, seg(10), seg(12))).toEqual([{ em: seg(10), tokens: 165 }, { em: seg(10, 30), tokens: 40 }]);
    await p.armazem.registrarBloqueio({ empresaId: EMP, em: seg(23), conversaId: 'c3', motivo: 'sem_credito' });
    expect(await p.armazem.bloqueios(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1))).toEqual([{ motivo: 'sem_credito', total: 1 }]);
    // Assinatura antiga gravada como "gratis" (antes da migração 270) é lida como Essencial.
    await pool.query("insert into sintonia.ia_assinaturas (empresa_id, plano) values ('velha', 'gratis')");
    expect((await p.assinatura('velha')).plano).toBe('essencial');
  });
});
