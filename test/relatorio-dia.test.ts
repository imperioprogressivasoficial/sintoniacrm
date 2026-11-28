import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Usuario } from '../src/auth/contas.js';
import { ArmazemComercialMemoria } from '../src/comercial/armazem.js';
import { ConfigComercial } from '../src/comercial/calculo.js';
import {
  chavePessoa,
  classificarLeads,
  contarAgendamentos,
  porCoorte,
  porDia,
  preparar,
  resumoPeriodo,
  type AgendamentoBruto,
  type ChegadaBruta,
  type DadosRelatorioDia,
} from '../src/relatorio-dia/calculo.js';
import {
  ArmazemEnvioRelatorioMemoria,
  ArmazemEnvioRelatorioPostgres,
  ConfigEnvio,
  naMadrugada,
  podeEnviar,
  vezDoRelatorio,
  type ArmazemEnvioRelatorio,
} from '../src/relatorio-dia/envio.js';
import { FonteRelatorioDiaMemoria, FonteRelatorioDiaPostgres, type FonteRelatorioDia } from '../src/relatorio-dia/fonte.js';
import { registrarRelatorioDia } from '../src/relatorio-dia/rotas.js';
import { RelatorioDia } from '../src/relatorio-dia/servico.js';
import { direcao, textoFechamento } from '../src/relatorio-dia/textos.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia, MIN } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/** Horário da Bahia em novembro de 2026 (20/11 é sexta). */
const h = (dia: number, hora = 10, min = 0, mes = 11) => bahia(2026, mes, dia, hora, min);
const EMP = 'emp-a';
const ANA = '00000000-0000-4000-8000-0000000000a1';

const chegada = (p: Partial<ChegadaBruta> & { conversaId: string; em: Date }): ChegadaBruta => ({
  tipo: 'conversa_nova',
  primeiraMensagemEm: p.em,
  telefone: '55719' + p.conversaId.replace(/\D/g, '').padStart(8, '0'),
  nome: 'Cliente ' + p.conversaId,
  unidade: 'norte',
  responsavelId: null,
  ...p,
});
const ag = (p: Partial<AgendamentoBruto> & { conversaId: string; em: Date }): AgendamentoBruto => ({
  porIa: false,
  atendenteId: ANA,
  atendenteNome: 'Ana',
  unidade: 'norte',
  responsavelId: null,
  remarcado: false,
  compareceu: false,
  faltou: false,
  telefone: '55719' + p.conversaId.replace(/\D/g, '').padStart(8, '0'),
  nome: null,
  chegadaEm: null,
  chegadaTipo: 'conversa_nova',
  primeiraMensagemEm: null,
  ...p,
});

/** O caso de regras: leads de 18, 19 e 20/11, importados, grupo, retorno, remarcação e virada do dia na Bahia. */
function casos(): DadosRelatorioDia {
  const l1 = chegada({ conversaId: 'c1', em: h(20, 9) });
  const l2 = chegada({ conversaId: 'c2', em: h(19, 10) });
  const l3 = chegada({ conversaId: 'c3', em: h(18, 10) });
  const l4 = chegada({ conversaId: 'c4', em: h(20, 8), tipo: 'lead_importado' }); // planilha
  const l5 = chegada({ conversaId: 'c5', em: h(20, 8), primeiraMensagemEm: h(1, 10, 0, 10) }); // histórico do WhatsApp: falava desde outubro
  const l6 = chegada({ conversaId: 'g1', em: h(20, 8), telefone: '120363012345678901@g.us' }); // grupo
  const l7 = chegada({ conversaId: 'c7', em: h(20, 13), telefone: '5571988887777' }); // mesmo telefone de X (que já agendou)
  const l8 = chegada({ conversaId: 'c8', em: new Date('2026-11-21T02:30:00Z') }); // 20/11 23:30 na Bahia
  const l9 = chegada({ conversaId: 'c9', em: new Date('2026-11-20T03:30:00Z') }); // 20/11 00:30 na Bahia
  const l10 = chegada({ conversaId: 'c10', em: new Date('2026-11-20T02:59:00Z') }); // 19/11 23:59 na Bahia
  const ch = (c: ChegadaBruta) => ({ chegadaEm: c.em, chegadaTipo: c.tipo, primeiraMensagemEm: c.primeiraMensagemEm, telefone: c.telefone });
  return {
    chegadas: [l1, l2, l3, l4, l5, l6, l7, l8, l9, l10],
    agendamentos: [
      // X: cliente antiga (agendou em 01/11), telefone escrito sem o 9.
      ag({ conversaId: 'x', em: h(1, 15), telefone: '557188887777', chegadaEm: h(1, 9), chegadaTipo: 'conversa_nova' }),
      ag({ conversaId: 'y', em: h(1, 15, 0, 9), telefone: '5571955554444', chegadaEm: h(1, 9, 0, 9) }), // Y: agendou em setembro
      ag({ conversaId: 'c1', em: h(20, 11), porIa: true, atendenteId: null, atendenteNome: null, ...ch(l1) }),
      ag({ conversaId: 'c2', em: h(20, 10), ...ch(l2), compareceu: true }),
      ag({ conversaId: 'c3', em: h(20, 12), ...ch(l3) }),
      ag({ conversaId: 'c3', em: h(20, 14), ...ch(l3), remarcado: true }), // remarcação: não conta
      ag({ conversaId: 'c3', em: h(20, 17), ...ch(l3) }), // 2º agendamento em menos de 6 h: mesma visita
      ag({ conversaId: 'c4', em: h(20, 9), ...ch(l4) }),
      ag({ conversaId: 'c7', em: h(20, 15), ...ch(l7) }),
      ag({ conversaId: 'g1', em: h(20, 9), ...ch(l6) }), // grupo: fora
    ],
    retomadas: [{ conversaId: 'y', em: h(20, 16), telefone: '5571955554444', nome: 'Yara', unidade: 'norte', responsavelId: null }],
  };
}

describe('relatório dia a dia: regras', () => {
  it('lead novo, retorno, importado e grupo', () => {
    const leads = classificarLeads(casos());
    const tipo = (id: string) => leads.find((l) => l.conversaId === id)?.tipo;
    expect(tipo('c1')).toBe('novo');
    expect(tipo('c4')).toBe('importado'); // planilha
    expect(tipo('c5')).toBe('importado'); // histórico/resgate: já tinha mensagens antes
    expect(tipo('g1')).toBeUndefined(); // grupo não entra
    expect(tipo('c7')).toBe('retorno'); // o telefone já tinha agendado (em outra conversa, sem o 9)
    expect(tipo('y')).toBe('retorno'); // conversa antiga que voltou a escrever
    expect(chavePessoa('5571988887777')).toBe(chavePessoa('557188887777'));
  });

  it('remarcação e 2º agendamento da mesma visita não contam', () => {
    const c3 = contarAgendamentos(casos().agendamentos).filter((a) => a.conversaId === 'c3');
    expect(c3).toHaveLength(1);
    expect(c3[0]!.em).toEqual(h(20, 12));
  });

  it('virada do dia no horário da Bahia', () => {
    const leads = classificarLeads(casos());
    const dia = (id: string) => leads.find((l) => l.conversaId === id)?.dia;
    expect(dia('c8')).toBe('2026-11-20'); // 02:30 UTC do dia 21 = 23:30 do dia 20
    expect(dia('c9')).toBe('2026-11-20');
    expect(dia('c10')).toBe('2026-11-19'); // 02:59 UTC do dia 20 = 23:59 do dia 19
  });

  it('visão do dia: chegaram × agendaram e a divisão por dia de chegada (D, D-1, D-2…)', () => {
    const r = porDia(preparar(casos()), '2026-11-20');
    expect(r.chegaram).toEqual({ novos: 3, retorno: 2, importados: 2 }); // c1, c8, c9 · c7, y · c4, c5
    expect(r.novosQueAgendaramNoDia).toBe(1);
    expect(r.conversaoNoDiaPct).toBe(33.3);
    const f = Object.fromEntries(r.agendamentos.faixas.map((x) => [x.faixa, x.total]));
    expect(f).toEqual({ mesmoDia: 1, d1: 1, d2: 1, d3a7: 0, mais7: 0, retorno: 1, importado: 1 });
    expect(r.agendamentos).toMatchObject({ total: 5, porIa: 1, porEquipe: 4, compareceram: 1 });
    expect(r.grupos).toEqual([
      { dia: '2026-11-20', chegaram: 3, agendaramNoMesmoDia: 1, agendaramAte: 1, agendaramNoDia: 1 },
      { dia: '2026-11-19', chegaram: 2, agendaramNoMesmoDia: 0, agendaramAte: 1, agendaramNoDia: 1 },
      { dia: '2026-11-18', chegaram: 1, agendaramNoMesmoDia: 0, agendaramAte: 1, agendaramNoDia: 1 },
    ]);
    expect(r.ranking[0]).toMatchObject({ nome: 'Ana', agendamentos: 4 });
  });

  it('filtros: IA × equipe, atendente e unidade', () => {
    expect(porDia(preparar(casos(), { quem: 'ia' }), '2026-11-20').agendamentos.total).toBe(1);
    expect(porDia(preparar(casos(), { atendente: ANA }), '2026-11-20').agendamentos.total).toBe(4);
    expect(porDia(preparar(casos(), { unidades: ['sumare'] }), '2026-11-20').agendamentos.total).toBe(0);
  });

  it('grupo de leads (coorte): dia 0, 1, 2… com conversão acumulada e dias futuros vazios', () => {
    const c = porCoorte(preparar(casos()), ['2026-11-20', '2026-11-19', '2026-11-18'], '2026-11-20');
    const d18 = c.linhas.find((l) => l.dia === '2026-11-18')!;
    expect(d18.chegaram).toBe(1);
    expect(d18.celulas.slice(0, 3)).toEqual([
      { agendaram: 0, acumulado: 0, acumuladoPct: 0 },
      { agendaram: 0, acumulado: 0, acumuladoPct: 0 },
      { agendaram: 1, acumulado: 1, acumuladoPct: 100 },
    ]);
    expect(d18.celulas[3]).toBeNull(); // 21/11 ainda não chegou
    const d19 = c.linhas.find((l) => l.dia === '2026-11-19')!;
    expect(d19.celulas[1]).toEqual({ agendaram: 1, acumulado: 1, acumuladoPct: 50 });
    expect(c.total).toEqual({ chegaram: 6, agendaram: 3, conversaoPct: 50 });
  });

  it('geral do período: chegaram, retorno, conversão, tempo até agendar e por origem', () => {
    const origens = new Map([['c1', 'Instagram'], ['c2', 'Instagram']]);
    const g = resumoPeriodo(preparar(casos(), { origens }), '2026-11-18', '2026-11-20');
    expect(g).toMatchObject({ chegaram: 6, retorno: 2, agendamentos: 5, novosQueAgendaram: 3, conversaoPct: 50, agendamentosRetorno: 1 });
    expect(g.tempoAteAgendarMedianaMs).toBe(24 * 3600_000); // c1 2 h, c2 24 h, c3 50 h
    expect(g.origens[0]).toMatchObject({ origem: 'WhatsApp', chegaram: 4, agendaram: 1 });
    expect(g.origens.find((o) => o.origem === 'Instagram')).toMatchObject({ chegaram: 2, agendaram: 2, conversaoPct: 100 });
  });
});

describe('relatório automático: horários', () => {
  const cfg = ConfigEnvio.parse({});
  it('começa desligado, com os horários padrão', () => {
    expect(cfg.ligado).toBe(false);
    expect(cfg.destinatarios).toEqual([]);
    expect(cfg.horarios).toMatchObject({ agenda: '08:00', fechamento: '21:00', semanal: '08:30', semanalDia: 1, mensal: '09:00', mensalDia: 1 });
  });
  it('janela: nunca antes, até 3 h depois e, entre 22:00 e 07:00, só no horário marcado', () => {
    expect(podeEnviar(h(20, 20, 59), h(20, 21))).toBe(false);
    expect(podeEnviar(h(20, 21, 0), h(20, 21))).toBe(true);
    expect(podeEnviar(h(20, 21, 50), h(20, 21))).toBe(true);
    expect(podeEnviar(h(20, 22, 10), h(20, 21))).toBe(false); // atrasado e já na madrugada
    expect(podeEnviar(h(20, 23, 5), h(20, 23))).toBe(true); // marcado para 23:00: sai no horário
    expect(podeEnviar(h(20, 23, 20), h(20, 23))).toBe(false);
    expect(podeEnviar(h(20, 11, 30), h(20, 8))).toBe(false); // mais de 3 h
    expect(naMadrugada(h(20, 6, 59))).toBe(true);
    expect(naMadrugada(h(20, 7))).toBe(false);
  });
  it('semanal na segunda e mensal no dia 1 (referência = mês fechado)', () => {
    expect(vezDoRelatorio('semanal', cfg, h(20))).toBeNull(); // sexta
    expect(vezDoRelatorio('semanal', cfg, h(23))?.referencia).toBe('2026-11-23');
    expect(vezDoRelatorio('mensal', cfg, h(1, 9, 0, 12))?.referencia).toBe('2026-11');
    expect(vezDoRelatorio('mensal', cfg, bahia(2027, 1, 1, 9))?.referencia).toBe('2026-12');
    expect(vezDoRelatorio('fechamento', cfg, h(20))?.marcado).toEqual(h(20, 21));
  });
});

describe('relatório automático: texto', () => {
  it('frase de direção pela meta do mês (modelo pronto, sem IA)', () => {
    const m = { mes: 300, feitosMes: 176, diasMes: 30, diaAtual: 20, feitosDia: 9 };
    expect(direcao(m, { hoje: 9, media7: 8 })).toBe('Estamos 12% abaixo do ritmo para bater a meta do mês: precisamos de 13 agendamentos por dia até o fim do mês.');
    expect(direcao({ ...m, feitosMes: 230 }, { hoje: 9, media7: 8 })).toMatch(/^Estamos 15% acima do ritmo/);
    expect(direcao({ ...m, mes: null }, { hoje: 12, media7: 10 })).toBe('Hoje ficamos 20% acima da média dos últimos 7 dias (10 por dia). Ótimo dia!');
  });
  it('fechamento: chegaram × agendaram, divisão hoje/ontem/antigos, metas, ranking, parados e direção', () => {
    const texto = textoFechamento({
      rel: porDia(preparar(casos()), '2026-11-20'),
      unidadeNome: null,
      meta: { mes: 300, feitosMes: 176, diasMes: 30, diaAtual: 20, feitosDia: 5 },
      parados: { total: 4, maisAntigoMs: 3 * 3600_000 },
      atendimento: { conversas: 12, primeiraMs: 6 * MIN },
      media7: 4,
    });
    expect(texto).toContain('*Fechamento do dia · sexta, 20/11*');
    expect(texto).toContain('Chegaram 3 leads novos; 1 agendaram hoje (33%).');
    expect(texto).toContain('• de leads de hoje: 1');
    expect(texto).toContain('• de leads de ontem: 1');
    expect(texto).toContain('• de leads mais antigos: 1');
    expect(texto).toContain('Meta do dia: 5 de 10 (faltaram 5)');
    expect(texto).toContain('Meta do mês: 176 de 300 (59%), faltam 124');
    expect(texto).toContain('1. Ana: 4');
    expect(texto).toContain('Parados sem resposta: 4 (o mais antigo há 3 h).');
    expect(texto).toContain('*Direção:* Estamos 12% abaixo do ritmo');
  });
  it('sem meta cadastrada, as linhas de meta somem', () => {
    const texto = textoFechamento({ rel: porDia(preparar(casos()), '2026-11-20'), unidadeNome: 'Norte', meta: { mes: null, feitosMes: 0, diasMes: 30, diaAtual: 20, feitosDia: 0 }, parados: { total: 0, maisAntigoMs: null }, atendimento: null, media7: null });
    expect(texto).not.toContain('Meta');
    expect(texto).toContain('· Norte');
  });
});

// ---------------------------------------------------------------- envio sem repetir

interface Enviado {
  tipo: string;
  destino: string;
  texto: string;
}
function servico(o: { armazem?: ArmazemEnvioRelatorio; agora: () => Date; falhar?: (destino: string) => boolean; repo?: Repositorio; fonte?: FonteRelatorioDia; comercial?: ArmazemComercialMemoria }) {
  const enviados: Enviado[] = [];
  const armazem = o.armazem ?? new ArmazemEnvioRelatorioMemoria();
  const repo = o.repo ?? new RepositorioMemoria();
  const s = new RelatorioDia({
    fonte: o.fonte ?? new FonteRelatorioDiaMemoria(repo),
    armazem,
    armazemComercial: o.comercial,
    enviar: async (d, texto) => {
      if (o.falhar?.(d.destino)) throw new Error('WhatsApp desconectado');
      await new Promise((r) => setTimeout(r, 5));
      enviados.push({ tipo: d.tipo, destino: d.destino, texto });
    },
    empresaId: EMP,
    agora: o.agora,
  });
  return { s, enviados, armazem };
}
const ligado = (extra: Partial<ConfigEnvio> = {}) =>
  ConfigEnvio.parse({
    ligado: true,
    destinatarios: [
      { tipo: 'numero', destino: '5571988124471', nome: 'Bruno', relatorios: ['fechamento'] },
      { tipo: 'grupo', destino: 'grupo-1', nome: 'Gerência', relatorios: ['fechamento', 'agenda'] },
      { tipo: 'numero', destino: '5571999990000', nome: 'Sem relatório', relatorios: [] },
    ],
    ...extra,
  });

describe('relatório automático: envio', () => {
  it('desligado (o padrão) não envia nada', async () => {
    const { s, enviados } = servico({ agora: () => h(20, 21, 1) });
    expect(await s.tick()).toEqual({ enviados: 0, falhas: 0 });
    expect(enviados).toHaveLength(0);
  });

  it('cada destinatário recebe só o que escolheu, uma vez só, mesmo com dois processos', async () => {
    let agora = h(20, 21, 1);
    const armazem = new ArmazemEnvioRelatorioMemoria();
    await armazem.salvarConfig(EMP, ligado(), 'teste');
    const a = servico({ armazem, agora: () => agora });
    const b = servico({ armazem, agora: () => agora });
    await Promise.all([a.s.tick(), b.s.tick(), a.s.tick()]);
    const todos = [...a.enviados, ...b.enviados];
    expect(todos.map((x) => `${x.tipo}:${x.destino}`).sort()).toEqual(['grupo:grupo-1', 'numero:5571988124471']);
    expect(todos[0]!.texto).toContain('Fechamento do dia · sexta, 20/11');
    agora = h(20, 21, 30);
    await a.s.tick();
    expect(a.enviados.length + b.enviados.length).toBe(2);
    // Manhã seguinte: a agenda só para o grupo.
    agora = h(21, 8, 2);
    await a.s.tick();
    expect(a.enviados.at(-1)).toMatchObject({ tipo: 'grupo', destino: 'grupo-1' });
    expect(a.enviados.at(-1)!.texto).toContain('Agenda do dia · sábado, 21/11');
    expect(armazem.linhas.filter((l) => l.relatorio === 'agenda')).toHaveLength(1);
  });

  it('não sai atrasado de madrugada', async () => {
    const armazem = new ArmazemEnvioRelatorioMemoria();
    await armazem.salvarConfig(EMP, ligado(), 'teste');
    const { s, enviados } = servico({ armazem, agora: () => h(20, 22, 5) }); // o servidor voltou às 22:05
    await s.tick();
    expect(enviados).toHaveLength(0);
  });

  it('falha fica registrada (aparece na tela) e é tentada de novo depois de 5 min, até 3 vezes', async () => {
    let agora = h(20, 21);
    let falhar = true;
    const armazem = new ArmazemEnvioRelatorioMemoria();
    await armazem.salvarConfig(EMP, ligado(), 'teste');
    const { s, enviados } = servico({ armazem, agora: () => agora, falhar: (d) => falhar && d === '5571988124471' });
    expect(await s.tick()).toEqual({ enviados: 1, falhas: 1 });
    const linha = () => armazem.linhas.find((l) => l.destino === 'numero:5571988124471')!;
    expect(linha()).toMatchObject({ situacao: 'falhou', erro: 'WhatsApp desconectado', tentativas: 1 });
    expect((await armazem.recentes(EMP)).some((r) => r.situacao === 'falhou')).toBe(true);
    agora = h(20, 21, 2);
    await s.tick();
    expect(linha().tentativas).toBe(1); // cedo demais
    falhar = false;
    agora = h(20, 21, 7);
    await s.tick();
    expect(linha()).toMatchObject({ situacao: 'enviado', tentativas: 2 });
    expect(enviados.filter((e) => e.destino === '5571988124471')).toHaveLength(1);
    expect(enviados.filter((e) => e.destino === 'grupo-1')).toHaveLength(1);
  });

  it('teste para mim: na hora, uma vez por minuto', async () => {
    const { s, enviados } = servico({ agora: () => h(20, 23, 30) });
    const r = await s.enviarTeste('fechamento', '5571988124471', 'Bruno');
    expect(r.enviado).toBe(true);
    expect(enviados[0]!.texto.startsWith('_Teste_\n*Fechamento do dia')).toBe(true);
    expect((await s.enviarTeste('fechamento', '5571988124471', 'Bruno')).enviado).toBe(false);
  });
});

// ---------------------------------------------------------------- dados de verdade (memória e Postgres)

async function cenario(repo: Repositorio) {
  const nova = async (tel: string, nome: string, em: Date, o: { unidade?: string; dona?: string; evento?: 'conversa_nova' | 'lead_importado' | null; primeiraMsg?: Date } = {}) => {
    const unidade = o.unidade ?? 'norte';
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: EMP, unidade, canalId: 'x', telefone: tel, nome, agora: em });
    if (o.dona) await repo.salvarConversa({ ...conversa, responsavelId: o.dona, responsavelNome: 'Ana' });
    if (o.evento !== null) await repo.registrarEvento({ tipo: o.evento ?? 'conversa_nova', conversaId: conversa.id, unidade, em });
    await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'cliente', texto: 'oi', em: o.primeiraMsg ?? em });
    return conversa.id;
  };
  const agendar = (id: string, em: Date, dados: Record<string, unknown> = {}, ia = false) =>
    repo.registrarEvento({ tipo: ia ? 'agendamento_ia' : 'agendamento_equipe', conversaId: id, unidade: 'norte', em, dados: ia ? dados : { atendente: 'Ana', atendenteId: ANA, ...dados } });
  const antiga = await nova('5571988887777', 'Xênia', h(1, 9));
  await agendar(antiga, h(1, 15));
  const c1 = await nova('5571900000001', 'Carla', h(20, 9), { dona: ANA });
  await agendar(c1, h(20, 11), {}, true);
  const c2 = await nova('5571900000002', 'Duda', h(19, 10), { unidade: 'sumare' });
  await agendar(c2, h(20, 10));
  await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c2, unidade: 'sumare', em: h(20, 18), dados: { de: 'agendada', para: 'compareceu' } });
  const c3 = await nova('5571900000003', 'Edna', h(18, 10));
  await agendar(c3, h(20, 12));
  await agendar(c3, h(20, 14), { remarcadoDe: 'ag-1' }, true);
  await nova('5571900000004', 'Fabi', h(20, 8), { evento: 'lead_importado' });
  await nova('5571900000005', 'Gil', h(20, 8), { primeiraMsg: h(1, 10, 0, 10) });
  const volta = await nova('557188887777', 'Xênia de novo', h(20, 13), { unidade: 'sumare' });
  await agendar(volta, h(20, 15));
  await nova('5571900000009', 'Noite', new Date('2026-11-21T02:30:00Z'));
  return { c1, c2, c3 };
}

describe('relatório dia a dia: fonte e rotas', () => {
  const usuario = (p: Partial<Usuario> = {}): Usuario => ({ id: 'u1', empresaId: EMP, nome: 'Gestora', email: 'g@x', papel: 'admin', unidades: ['norte', 'sumare'], ativo: true, ...p });
  async function montar(repo: Repositorio, u?: Usuario, fonte: FonteRelatorioDia = new FonteRelatorioDiaMemoria(repo), telefone = '') {
    const app = Fastify();
    app.addHook('preHandler', async (req) => {
      if (u) (req as { usuario?: Usuario }).usuario = u;
    });
    const comercial = new ArmazemComercialMemoria();
    await comercial.salvar(EMP, ConfigComercial.parse({ metas: { equipe: { agendamentos: 300 } } }), 'teste');
    const { s, armazem, enviados } = servico({ repo, fonte, agora: () => h(20, 22), comercial });
    registrarRelatorioDia(app, { servico: s, armazem, telefoneDe: async () => telefone, grupos: async () => [{ id: 'grupo-1', nome: 'Gerência', unidade: 'norte' }], canais: () => ['norte'], empresaId: EMP, agora: () => h(20, 22) });
    return { app, enviados };
  }

  it('a tela do dia, os filtros e o CSV', async () => {
    const repo = new RepositorioMemoria();
    await cenario(repo);
    const { app } = await montar(repo, usuario());
    const r = (await app.inject({ url: '/api/relatorio-dia?dia=2026-11-20&dias=7' })).json();
    expect(r.relatorio.chegaram).toEqual({ novos: 2, retorno: 1, importados: 2 });
    expect(r.relatorio.agendamentos.total).toBe(4); // c1, c2, c3 (sem a remarcação) e o retorno
    expect(r.relatorio.agendamentos.compareceram).toBe(1);
    expect(r.coorte.linhas).toHaveLength(7);
    expect(r.opcoes.origens).toContain('Importação');
    const norte = (await app.inject({ url: '/api/relatorio-dia?dia=2026-11-20&unidade=norte' })).json();
    expect(norte.relatorio.agendamentos.total).toBe(2); // c2 e o retorno são de Sumaré
    const csv = await app.inject({ url: '/api/relatorio-dia/csv?dia=2026-11-20&tabela=coorte' });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Dia de chegada;Leads novos;Dia 0');
  });

  it('só a gestão vê e mexe no envio; números validados; prévia; teste pede o telefone da Conta', async () => {
    const repo = new RepositorioMemoria();
    await cenario(repo);
    const at = await montar(repo, usuario({ papel: 'atendente' }));
    expect((await at.app.inject({ url: '/api/relatorio-dia' })).statusCode).toBe(403);
    expect((await at.app.inject({ url: '/api/relatorio-dia/envio' })).statusCode).toBe(403);
    const { app } = await montar(repo, usuario());
    const ini = (await app.inject({ url: '/api/relatorio-dia/envio' })).json();
    expect(ini.config.ligado).toBe(false);
    expect(ini.grupos).toHaveLength(1);
    const ruim = await app.inject({ method: 'PUT', url: '/api/relatorio-dia/envio', payload: { ligado: true, destinatarios: [{ tipo: 'numero', destino: '123', relatorios: ['fechamento'] }] } });
    expect(ruim.statusCode).toBe(400);
    const ok = await app.inject({
      method: 'PUT',
      url: '/api/relatorio-dia/envio',
      payload: { ligado: true, destinatarios: [{ tipo: 'numero', destino: '+55 (71) 98812-4471', relatorios: ['fechamento'] }, { tipo: 'grupo', destino: 'grupo-1', relatorios: ['agenda'] }] },
    });
    expect(ok.statusCode).toBe(200);
    const salvo = (await app.inject({ url: '/api/relatorio-dia/envio' })).json();
    expect(salvo.config.destinatarios[0]).toMatchObject({ destino: '5571988124471', bonito: '+55 (71) 98812-4471' });
    expect(salvo.config.destinatarios[1]).toMatchObject({ nome: 'Gerência' });
    const previa = (await app.inject({ method: 'POST', url: '/api/relatorio-dia/envio/previa', payload: { relatorio: 'fechamento' } })).json();
    expect(previa.texto).toContain('Chegaram 2 leads novos');
    expect(previa.texto).toContain('Meta do mês');
    expect((await app.inject({ method: 'POST', url: '/api/relatorio-dia/envio/teste', payload: { relatorio: 'fechamento' } })).statusCode).toBe(400);
    const comTel = await montar(repo, usuario(), undefined, '71 98812-4471');
    const t = await comTel.app.inject({ method: 'POST', url: '/api/relatorio-dia/envio/teste', payload: { relatorio: 'agenda' } });
    expect(t.json()).toMatchObject({ ok: true, para: '+55 (71) 98812-4471' });
    expect(comTel.enviados[0]!.destino).toBe('5571988124471');
  });
});

describe.skipIf(!temPostgres)('relatório dia a dia: Postgres', () => {
  it('Postgres dá o mesmo que a memória', async () => {
    const pool = await poolDeTeste();
    const repoPg = new RepositorioPostgres(pool);
    await cenario(repoPg);
    const repoMem = new RepositorioMemoria();
    await cenario(repoMem);
    const f = { dia: '2026-11-20', dias: 7 };
    const pg = await servico({ repo: repoPg, fonte: new FonteRelatorioDiaPostgres(pool), agora: () => h(20, 22) }).s.tela({ empresaId: EMP }, f);
    const mem = await servico({ repo: repoMem, agora: () => h(20, 22) }).s.tela({ empresaId: EMP }, f);
    expect(pg.relatorio).toEqual(mem.relatorio);
    expect(pg.coorte).toEqual(mem.coorte);
    expect(pg.geral).toEqual(mem.geral);
    expect(pg.relatorio.chegaram).toEqual({ novos: 2, retorno: 1, importados: 2 });
    expect(await new FonteRelatorioDiaPostgres(pool).parados({ empresaId: EMP }, h(20, 22))).toHaveLength(
      (await new FonteRelatorioDiaMemoria(repoMem).parados({ empresaId: EMP }, h(20, 22))).length,
    );
  });

  it('chave única no banco: dois processos ao mesmo tempo, um envio só', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.relatorio_envios, sintonia.relatorio_envio_config');
    const armazem = new ArmazemEnvioRelatorioPostgres(pool);
    await armazem.salvarConfig(EMP, ligado(), 'teste');
    expect((await armazem.lerConfig(EMP)).cfg.ligado).toBe(true);
    const a = servico({ armazem, agora: () => h(20, 21, 1) });
    const b = servico({ armazem: new ArmazemEnvioRelatorioPostgres(pool), agora: () => h(20, 21, 1) });
    await Promise.all([a.s.tick(), b.s.tick(), a.s.tick(), b.s.tick()]);
    expect(a.enviados.length + b.enviados.length).toBe(2);
    const { rows } = await pool.query("select destino, situacao from sintonia.relatorio_envios where relatorio = 'fechamento' order by destino");
    expect(rows).toEqual([
      { destino: 'grupo:grupo-1', situacao: 'enviado' },
      { destino: 'numero:5571988124471', situacao: 'enviado' },
    ]);
  });
});
