import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { ArmazemComercialMemoria } from '../src/comercial/armazem.js';
import { ConfigComercial } from '../src/comercial/calculo.js';
import { calcularDesempenho, desempenhoCsv, expedienteDe, mediana, montarFila, pico, type ConvD } from '../src/desempenho/calculo.js';
import { FonteDesempenhoMemoria } from '../src/desempenho/fonte.js';
import { registrarDesempenho } from '../src/desempenho/rotas.js';
import type { Mensagem } from '../src/domain.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { FonteDesempenhoPostgres } from '../src/desempenho/fonte.js';
import { poolDeTeste, temPostgres } from './repos.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { bahia, MIN } from '../src/util/tempo.js';

/** Sábado, 7/11/2026 (horário da Bahia). */
const h = (hora: number, min = 0, dia = 7) => bahia(2026, 11, dia, hora, min);
const ANA = '00000000-0000-4000-8000-0000000000a1';
const BIA = '00000000-0000-4000-8000-0000000000b1';
const PESSOAS = [
  { id: ANA, nome: 'Ana Souza' },
  { id: BIA, nome: 'Bia Lima' },
];
const EMP = 'emp';

async function cenario(repo: Repositorio = new RepositorioMemoria()) {
  const nova = async (tel: string, nome: string, dona?: { id: string; nome: string }, unidade: 'norte' | 'sumare' = 'norte') => {
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: EMP, unidade, canalId: 'x', telefone: tel, nome, agora: h(8) });
    if (dona) await repo.salvarConversa({ ...conversa, responsavelId: dona.id, responsavelNome: dona.nome });
    return conversa.id;
  };
  const msg = async (conversaId: string, autor: Mensagem['autor'], em: Date, autorNome?: string) => {
    await repo.adicionarMensagem({ conversaId, autor, texto: '.', em, ...(autorNome ? { autorNome } : {}) });
    const c = (await repo.buscarConversa(conversaId))!;
    const campo = autor === 'cliente' ? 'ultimaMensagemCliente' : autor === 'equipe' ? 'ultimaMensagemEquipe' : 'ultimaMensagemIa';
    await repo.salvarConversa({ ...c, [campo]: em });
  };
  // Conversa 1 (Ana): cliente 9:00 → Ana 9:10 (1ª resposta 10 min); cliente 9:20 → Ana 9:24 (durante: 4 min);
  // Ana agenda às 9:30 (até agendar: 30 min), com valor gravado.
  const c1 = await nova('5571900000001', 'Carla', PESSOAS[0]);
  await msg(c1, 'cliente', h(9));
  await msg(c1, 'equipe', h(9, 10), 'Ana Souza');
  await msg(c1, 'cliente', h(9, 20));
  await msg(c1, 'equipe', h(9, 24), 'Ana Souza');
  await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: c1, unidade: 'norte', em: h(9, 30), dados: { atendente: 'Ana Souza', atendenteId: ANA, servico: 'Progressiva', profissional: 'Rita', valor: 250 } });
  // Conversa 2 (Ana): cliente 14:00 → Ana 14:30 (1ª resposta 30 min: passou dos 15); agendamento sem valor às 15:00.
  const c2 = await nova('5571900000002', 'Duda', PESSOAS[0]);
  await msg(c2, 'cliente', h(14));
  await msg(c2, 'equipe', h(14, 30), 'Ana Souza');
  await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: c2, unidade: 'norte', em: h(15), dados: { atendente: 'Ana Souza', atendenteId: ANA, servico: 'Botox capilar', profissional: 'Rita' } });
  await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c2, unidade: 'norte', em: h(16), dados: { de: 'agendada', para: 'compareceu' } });
  // Conversa 3 (Bia): cliente 10:00 → IA assume às 10:16 por falta de resposta; Bia responde 11:00 (durante).
  // Bia perde a lead às 11:10; lembrete de ligação às 11:20 que nunca foi feito.
  const c3 = await nova('5571900000003', 'Eva', PESSOAS[1], 'sumare');
  await msg(c3, 'cliente', h(10));
  await repo.registrarEvento({ tipo: 'ia_assumiu', conversaId: c3, unidade: 'sumare', em: h(10, 16), dados: { motivo: 'A equipe não respondeu em 15 min: voltou para a IA.' } });
  await msg(c3, 'ia', h(10, 16));
  await msg(c3, 'cliente', h(10, 30));
  await msg(c3, 'equipe', h(11), 'Bia Lima');
  await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c3, unidade: 'sumare', em: h(11, 10), dados: { de: 'em_conversa', para: 'perdida', motivo: 'Achou caro' } });
  await repo.registrarEvento({ tipo: 'lembrete_ligacao', conversaId: c3, unidade: 'sumare', em: h(11, 20), dados: { quando: h(11, 20).toISOString(), texto: 'Ligar para Eva' } });
  // Conversa 4 (Bia, dona): cliente escreveu às 17:00 e ninguém respondeu (fila de agora).
  const c4 = await nova('5571900000004', 'Fabi', PESSOAS[1], 'sumare');
  await msg(c4, 'cliente', h(17));
  // Conversa 5: a IA agenda sozinha.
  const c5 = await nova('5571900000005', 'Gabi');
  await msg(c5, 'cliente', h(12));
  await msg(c5, 'ia', new Date(h(12).getTime() + 30_000));
  await repo.registrarEvento({ tipo: 'agendamento_ia', conversaId: c5, unidade: 'norte', em: h(12, 5), dados: { servico: 'Progressiva', profissional: 'Lu' } });
  await repo.registrarEvento({ tipo: 'ligacao', conversaId: c1, unidade: 'norte', em: h(18), dados: { atendente: 'Ana Souza', atendenteId: ANA, resultado: 'atendeu' } });
  return { repo, c1, c2, c3, c4, c5 };
}

const precos = [{ servico: 'Progressiva', valor: 200 }];

async function calcular(extra: { atendente?: string; limiteMin?: number } = {}) {
  const s = await cenario();
  const fonte = new FonteDesempenhoMemoria(s.repo);
  const inicio = h(0);
  const agora = h(19);
  const dados = await fonte.carregar(inicio, agora, agora, { empresaId: EMP });
  return { s, d: calcularDesempenho({ dados, inicio, fim: agora, agora, pessoas: PESSOAS, precos, limiteMin: extra.limiteMin ?? 15, atendente: extra.atendente }), fonte, agora };
}

describe('desempenho: cálculos', () => {
  it('mediana e pico', () => {
    expect(mediana([])).toBeNull();
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
    const g = Array.from({ length: 7 }, () => Array(24).fill(0));
    g[6]![15] = 3;
    g[1]![9] = 2;
    expect(pico(g)).toEqual({ diaSemana: 6, hora: 15, total: 3 });
  });

  it('1ª resposta (média e mediana), resposta durante a conversa e tempo até agendar', async () => {
    const { d } = await calcular();
    const ana = d.atendentes.find((a) => a.id === ANA)!;
    expect(ana.primeiraResposta.n).toBe(2);
    expect(ana.primeiraResposta.mediaMs).toBe(20 * MIN);
    expect(ana.primeiraResposta.medianaMs).toBe(20 * MIN);
    expect(ana.respostaConversa).toEqual({ mediaMs: 4 * MIN, n: 1 });
    // c1: 9:00 → 9:30 (30 min); c2: 14:00 → 15:00 (60 min).
    expect(ana.ateAgendar.mediaMs).toBe(45 * MIN);
    expect(ana.conversas).toBe(2);
    expect(ana.mensagens).toBe(3);
    const bia = d.atendentes.find((a) => a.id === BIA)!;
    // Bia não abriu atendimento (a IA respondeu primeiro); respondeu durante a conversa 30 min depois.
    expect(bia.primeiraResposta.n).toBe(0);
    expect(bia.respostaConversa.mediaMs).toBe(30 * MIN);
    expect(d.iaEquipe.ia.primeiras).toBe(2);
    expect(d.iaEquipe.equipe.primeiras).toBe(2);
  });

  it('início e fim do expediente por dia, com horas ativas sem as pausas', async () => {
    const { d } = await calcular();
    const ana = d.atendentes.find((a) => a.id === ANA)!;
    expect(ana.expediente).toHaveLength(1);
    expect(ana.expediente[0]).toMatchObject({ dia: '2026-11-07', inicio: '09:10', fim: '18:00' });
    // 9:10 → 9:24 → 9:30 (20 min ativos), pausa, 14:30 → 15:00 (30 min), pausa até 18:00.
    expect(ana.expediente[0]!.ativoMin).toBe(50);
    expect(ana.ligacoes).toBe(1);
    const dias = expedienteDe([h(8), h(8, 20), h(12), bahia(2026, 11, 8, 9), bahia(2026, 11, 8, 9, 10)]);
    expect(dias.map((x) => [x.dia, x.inicio, x.fim, x.ativoMin])).toEqual([
      ['2026-11-07', '08:00', '12:00', 20],
      ['2026-11-08', '09:00', '09:10', 10],
    ]);
  });

  it('horário em que mais agendou (mapa de calor dia × hora)', async () => {
    const { d } = await calcular();
    const ana = d.atendentes.find((a) => a.id === ANA)!;
    expect(ana.calorAgendamentos[6]![9]).toBe(1);
    expect(ana.calorAgendamentos[6]![15]).toBe(1);
    expect(ana.picoAgendamento?.diaSemana).toBe(6);
    expect(d.calor.agendamentos[6]!.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('agendamentos com valor × sem valor (gravado ou pela tabela de preços)', async () => {
    const { d } = await calcular();
    const ana = d.atendentes.find((a) => a.id === ANA)!;
    expect(ana).toMatchObject({ agendamentos: 2, comValor: 1, semValor: 1, valor: 250, comparecimentos: 1, conversao: 100 });
    // Total: 250 (gravado) + 0 (botox sem preço) + 200 (progressiva da IA, pela tabela).
    expect(d.totais).toMatchObject({ agendamentos: 3, comValor: 2, semValor: 1, valor: 450 });
    expect(d.iaEquipe.ia).toMatchObject({ agendamentos: 1, valor: 200 });
  });

  it('o que deixou passar: esperas longas, IA assumiu, lead perdida e ligação não feita', async () => {
    const { d, s } = await calcular();
    const ana = d.atendentes.find((a) => a.id === ANA)!;
    expect(ana.deixouPassar.semResposta).toBe(1);
    expect(ana.deixouPassar.esperas[0]).toMatchObject({ conversaId: s.c2, esperaMin: 30, respondeu: 'equipe' });
    const bia = d.atendentes.find((a) => a.id === BIA)!;
    expect(bia.deixouPassar.iaAssumiu).toBe(1);
    expect(bia.deixouPassar.perdidos).toEqual([expect.objectContaining({ conversaId: s.c3, motivo: 'Achou caro' })]);
    expect(bia.deixouPassar.lembretesNaoFeitos).toHaveLength(1);
    // c3: 10:00 → IA 10:16 (16 min) e 10:30 → Bia 11:00 (30 min); c4: esperando desde 17:00 (120 min).
    expect(bia.deixouPassar.esperas.map((x) => x.esperaMin)).toEqual([120, 30, 16]);
    expect(bia.deixouPassar.esperas[0]!.respondeu).toBeNull();
    // Com limite de 60 min, só a de agora conta.
    const { d: d60 } = await calcular({ limiteMin: 60 });
    expect(d60.atendentes.find((a) => a.id === BIA)!.deixouPassar.semResposta).toBe(1);
  });

  it('rankings da equipe: atendentes, profissionais, serviços e clientes', async () => {
    const { d, s } = await calcular();
    expect(d.atendentes.map((a) => a.id)).toEqual([ANA, BIA]);
    expect(d.profissionais[0]).toMatchObject({ nome: 'Rita', agendamentos: 2, valor: 250, comparecimentos: 1 });
    expect(d.servicos[0]).toMatchObject({ servico: 'Progressiva', agendamentos: 2, valor: 450 });
    expect(d.clientes.map((c) => c.conversaId)).toContain(s.c1);
    expect(d.linhaDoTempo.dia).toBe('2026-11-07');
    expect(d.linhaDoTempo.pessoas.find((p) => p.id === ANA)!.horas[9]).toBe(2);
    const soAna = (await calcular({ atendente: ANA })).d;
    expect(soAna.atendentes.map((a) => a.id)).toEqual([ANA]);
  });

  it('fila de agora: quem espera resposta, da espera mais longa para a mais curta', async () => {
    const { fonte, agora, s } = await calcular();
    const fila = montarFila(await fonte.esperando({ empresaId: EMP }), agora);
    expect(fila.map((f) => f.conversaId)).toEqual([s.c4]);
    expect(fila[0]).toMatchObject({ dona: 'Bia Lima', esperaMin: 120, unidade: 'sumare' });
    const conv = (id: string, cl: number, eq?: number): ConvD => ({ id, nome: id, telefone: '1', unidade: 'norte', etapa: 'em_conversa', responsavelId: null, responsavelNome: null, ultimaMensagemCliente: new Date(cl), ultimaMensagemEquipe: eq ? new Date(eq) : null, ultimaMensagemIa: null });
    expect(montarFila([conv('a', 1000), conv('b', 500), conv('c', 500, 900)], new Date(10 * MIN)).map((f) => f.conversaId)).toEqual(['b', 'a']);
  });

  it('CSV de cada tabela', async () => {
    const { d } = await calcular();
    const t = desempenhoCsv('atendentes', d, []);
    expect(t.startsWith('﻿Atendente;')).toBe(true);
    expect(t).toContain('Ana Souza;2;3;20;20;4;45;2;1;1;250,00;1;100');
    expect(desempenhoCsv('deixou-passar', d, [])).toContain('Lead perdido;Eva');
  });
});

describe('desempenho: rotas', () => {
  it('devolve tudo do período e exporta CSV', async () => {
    const s = await cenario();
    const app = Fastify();
    const armazem = new ArmazemComercialMemoria();
    await armazem.salvar(EMP, ConfigComercial.parse({ precos }), 'teste');
    registrarDesempenho(app, { fonte: new FonteDesempenhoMemoria(s.repo), armazem, empresaId: EMP, unidades: ['norte', 'sumare'], agora: () => h(19) });
    const r = await app.inject({ url: '/api/desempenho?periodo=hoje' });
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.totais.valor).toBe(450);
    expect(j.fila).toHaveLength(1);
    const so = (await app.inject({ url: '/api/desempenho?periodo=hoje&unidade=sumare' })).json();
    expect(so.totais.agendamentos).toBe(0);
    expect(so.atendentes.map((a: { id: string }) => a.id)).toEqual([BIA]);
    const csv = await app.inject({ url: '/api/desempenho/profissionais/csv?periodo=hoje' });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Rita;2;250,00;1');
    expect((await app.inject({ url: '/api/desempenho/nada/csv' })).statusCode).not.toBe(200);
  });
});

describe.skipIf(!temPostgres)('desempenho: Postgres dá o mesmo que a memória', () => {
  it('mesmos números e mesma fila', async () => {
    const pool = await poolDeTeste();
    await cenario(new RepositorioPostgres(pool));
    const fonte = new FonteDesempenhoPostgres(pool);
    const inicio = h(0);
    const agora = h(19);
    const dados = await fonte.carregar(inicio, agora, agora, { empresaId: EMP });
    const pgD = calcularDesempenho({ dados, inicio, fim: agora, agora, pessoas: PESSOAS, precos, limiteMin: 15 });
    const { d } = await calcular();
    const sem = (x: typeof d) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'conversaId' ? undefined : v)));
    expect(sem(pgD)).toEqual(sem(d));
    const fila = montarFila(await fonte.esperando({ empresaId: EMP }), agora);
    expect(fila.map((f) => f.cliente)).toEqual(['Fabi']);
  });
});
