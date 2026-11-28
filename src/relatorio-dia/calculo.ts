import { dataISO, DIA } from '../util/tempo.js';

/**
 * relatorio-dia: "Dia a dia" das Análises — quantos leads novos chegaram, quantos agendaram no mesmo dia, quantos
 * dos leads de ontem e de anteontem agendaram hoje, e o grupo de leads (coorte) de cada dia.
 *
 * Regras (combinadas com o dono):
 * - Lead novo = conversa (pessoa) que falou pela 1ª vez no período (evento conversa_nova). Não contam:
 *   - contatos importados (planilha: lead_importado) e conversas que já tinham mensagens antes de "chegar"
 *     (puxadas pelo histórico do WhatsApp ou pelo resgate: importarHistorico não gera conversa_nova; e se a conversa
 *     nasceu por uma mensagem ao vivo e o histórico trouxe mensagens mais antigas, ela também não é nova);
 *   - grupos;
 *   - quem já agendou antes e volta (pelo mesmo telefone, em qualquer conversa/unidade): conta como "Retorno",
 *     numa linha separada. Também é Retorno a conversa antiga de quem já agendou e voltou a escrever depois de
 *     30 dias sem falar.
 * - Agendamento = horário marcado pela Sintonia naquele dia (IA ou equipe: agendamento_ia / agendamento_equipe).
 *   Remarcação não é agendamento novo: o evento com `remarcadoDe`/`remarcado` e o 2º agendamento da mesma conversa
 *   com menos de 6 h do anterior (a "mesma visita" de src/analises/calculo.ts) não contam.
 * - Dia = 00:00 a 23:59 no horário da Bahia (dataISO).
 * Funções puras: os dados chegam prontos de fonte.ts e os testes montam os casos à mão.
 */

/** 1ª entrada de uma conversa (conversa_nova ou lead_importado), com os dados da conversa. */
export interface ChegadaBruta {
  conversaId: string;
  em: Date;
  tipo: 'conversa_nova' | 'lead_importado';
  /** Mensagem mais antiga da conversa (do histórico, se veio). */
  primeiraMensagemEm: Date | null;
  telefone: string;
  nome: string | null;
  unidade: string;
  responsavelId: string | null;
}

/** Evento de agendamento (com a conversa e a chegada dela, se houver). */
export interface AgendamentoBruto {
  conversaId: string;
  em: Date;
  porIa: boolean;
  atendenteId: string | null;
  atendenteNome: string | null;
  /** Unidade da conversa (é o que o escopo de quem vê usa). */
  unidade: string;
  responsavelId: string | null;
  /** Remarcação (evento com remarcadoDe ou remarcado). */
  remarcado: boolean;
  compareceu: boolean;
  faltou: boolean;
  telefone: string;
  nome: string | null;
  /** 1ª entrada da conversa (qualquer data); null = conversa sem entrada registrada (antiga ou do histórico). */
  chegadaEm: Date | null;
  chegadaTipo: 'conversa_nova' | 'lead_importado' | null;
  primeiraMensagemEm: Date | null;
}

/** Conversa antiga que voltou a escrever depois de um tempo sem falar. */
export interface RetomadaBruta {
  conversaId: string;
  em: Date;
  telefone: string;
  nome: string | null;
  unidade: string;
  responsavelId: string | null;
}

export interface DadosRelatorioDia {
  /** Entradas (a 1ª de cada conversa) dentro da janela pedida. */
  chegadas: ChegadaBruta[];
  /** Agendamentos da empresa toda até o fim da janela (com folga para trás: saber quem já agendou antes). */
  agendamentos: AgendamentoBruto[];
  /** Retomadas dentro da janela. */
  retomadas: RetomadaBruta[];
}

export interface FiltrosDia {
  /** Só conversas destas unidades (já resolvidas pelo escopo de quem vê). */
  unidades?: string[];
  /** Quem só vê as próprias conversas: as sem dona ou desta pessoa. */
  donaOuSemDona?: string;
  /** Só quem é dona da conversa (ou marcou o agendamento). */
  atendente?: string;
  /** Só agendamentos da IA ou da equipe. */
  quem?: 'ia' | 'equipe';
  /** Só leads desta origem. */
  origem?: string;
  /** Origem de cada conversa (sem = "WhatsApp"). */
  origens?: Map<string, string>;
}

export const FAIXAS = ['mesmoDia', 'd1', 'd2', 'd3a7', 'mais7', 'retorno', 'importado'] as const;
export type Faixa = (typeof FAIXAS)[number];
export const NOME_FAIXA: Record<Faixa, string> = {
  mesmoDia: 'Chegaram no mesmo dia',
  d1: 'Chegaram no dia anterior',
  d2: 'Chegaram 2 dias antes',
  d3a7: 'Chegaram de 3 a 7 dias antes',
  mais7: 'Chegaram há mais de 7 dias',
  retorno: 'Retorno (já tinham agendado)',
  importado: 'Contato antigo ou importado',
};

/** Dois agendamentos da mesma conversa com menos que isso entre eles são a mesma visita (remarcação). */
export const MESMA_VISITA_MS = 6 * 3600_000;
/** Conversa antiga que volta a escrever depois disso sem falar (e já agendou) é Retorno. */
export const SILENCIO_RETORNO_MS = 30 * DIA;
/** Mensagem mais antiga que isso antes da chegada = a conversa já existia (histórico). */
const FOLGA_HISTORICO_MS = 10 * 60_000;

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const digitos = (t: string) => String(t ?? '').replace(/\D/g, '');
/** Grupo do WhatsApp: id "...@g.us" ou "1203630…-…" (muito mais longo que um telefone). */
export const ehGrupo = (telefone: string) => /@g\.us$|-/.test(String(telefone ?? '')) || digitos(telefone).length > 15;
/** Mesmo telefone com ou sem 55 e com ou sem o 9: compara pelos 8 últimos dígitos + DDD. */
export function chavePessoa(telefone: string): string {
  const d = digitos(telefone);
  if (d.length < 10) return d || String(telefone ?? '');
  const sem55 = d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
  return sem55.slice(0, 2) + sem55.slice(-8);
}

/** Diferença em dias de calendário (Bahia) entre duas datas "AAAA-MM-DD". */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / DIA);
}
export function somarDias(dia: string, n: number): string {
  const d = new Date(Date.parse(dia + 'T12:00:00Z') + n * DIA);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- agendamentos que contam

export interface AgendamentoContado extends AgendamentoBruto {
  dia: string;
  faixa: Faixa;
  /** Dias entre a chegada e o agendamento (null para retorno/importado). */
  diasDesdeChegada: number | null;
}

/**
 * Agendamentos que contam (sem remarcação nem 2º agendamento da mesma visita), em ordem, com a faixa de cada um
 * (pela chegada do lead, ou Retorno se o telefone já tinha agendado antes, ou contato antigo/importado).
 */
export function contarAgendamentos(ags: AgendamentoBruto[]): AgendamentoContado[] {
  const ordenados = [...ags].sort((a, b) => a.em.getTime() - b.em.getTime());
  const ultimoDaConversa = new Map<string, number>();
  const pessoasQueAgendaram = new Set<string>();
  const out: AgendamentoContado[] = [];
  for (const a of ordenados) {
    if (ehGrupo(a.telefone)) continue;
    const anterior = ultimoDaConversa.get(a.conversaId);
    ultimoDaConversa.set(a.conversaId, a.em.getTime());
    if (a.remarcado) continue;
    if (anterior !== undefined && a.em.getTime() - anterior < MESMA_VISITA_MS) continue;
    const pessoa = chavePessoa(a.telefone);
    const dia = dataISO(a.em);
    let faixa: Faixa;
    let diasDesde: number | null = null;
    if (pessoasQueAgendaram.has(pessoa)) faixa = 'retorno';
    else if (!a.chegadaEm || a.chegadaTipo !== 'conversa_nova' || (a.primeiraMensagemEm && a.primeiraMensagemEm.getTime() < a.chegadaEm.getTime() - FOLGA_HISTORICO_MS)) faixa = 'importado';
    else {
      diasDesde = Math.max(0, diasEntre(dataISO(a.chegadaEm), dia));
      faixa = diasDesde === 0 ? 'mesmoDia' : diasDesde === 1 ? 'd1' : diasDesde === 2 ? 'd2' : diasDesde <= 7 ? 'd3a7' : 'mais7';
    }
    pessoasQueAgendaram.add(pessoa);
    out.push({ ...a, dia, faixa, diasDesdeChegada: diasDesde });
  }
  return out;
}

// ---------------------------------------------------------------- leads (chegadas)

export type TipoChegada = 'novo' | 'retorno' | 'importado';
export interface Lead {
  conversaId: string;
  em: Date;
  dia: string;
  tipo: TipoChegada;
  nome: string | null;
  unidade: string;
  responsavelId: string | null;
  origem: string;
}

/**
 * Classifica as entradas da janela: novo, retorno (o telefone já tinha agendado antes) ou importado (planilha ou
 * conversa que já tinha mensagens antes). Grupos saem. Retomadas entram como retorno (uma vez por conversa).
 */
export function classificarLeads(d: DadosRelatorioDia, origens?: Map<string, string>): Lead[] {
  const agendouAntes = new Map<string, number>(); // pessoa → 1º agendamento que conta
  for (const a of contarAgendamentos(d.agendamentos)) {
    const p = chavePessoa(a.telefone);
    if (!agendouAntes.has(p)) agendouAntes.set(p, a.em.getTime());
  }
  const origem = (id: string) => origens?.get(id) ?? 'WhatsApp';
  const leads = new Map<string, Lead>();
  for (const c of [...d.chegadas].sort((a, b) => a.em.getTime() - b.em.getTime())) {
    if (ehGrupo(c.telefone) || leads.has(c.conversaId)) continue;
    let tipo: TipoChegada;
    if (c.tipo === 'lead_importado' || (c.primeiraMensagemEm && c.primeiraMensagemEm.getTime() < c.em.getTime() - FOLGA_HISTORICO_MS)) tipo = 'importado';
    else {
      const primeiro = agendouAntes.get(chavePessoa(c.telefone));
      tipo = primeiro !== undefined && primeiro < c.em.getTime() ? 'retorno' : 'novo';
    }
    leads.set(c.conversaId, { conversaId: c.conversaId, em: c.em, dia: dataISO(c.em), tipo, nome: c.nome, unidade: c.unidade, responsavelId: c.responsavelId, origem: tipo === 'importado' ? origens?.get(c.conversaId) ?? 'Importação' : origem(c.conversaId) });
  }
  for (const r of [...d.retomadas].sort((a, b) => a.em.getTime() - b.em.getTime())) {
    if (ehGrupo(r.telefone) || leads.has(r.conversaId)) continue;
    const primeiro = agendouAntes.get(chavePessoa(r.telefone));
    if (primeiro === undefined || primeiro >= r.em.getTime()) continue;
    leads.set(r.conversaId, { conversaId: r.conversaId, em: r.em, dia: dataISO(r.em), tipo: 'retorno', nome: r.nome, unidade: r.unidade, responsavelId: r.responsavelId, origem: origem(r.conversaId) });
  }
  return [...leads.values()].sort((a, b) => a.em.getTime() - b.em.getTime());
}

// ---------------------------------------------------------------- filtros

const naUnidade = (f: FiltrosDia, unidade: string, dona?: string | null) =>
  (!f.unidades || f.unidades.includes(unidade)) && (!f.donaOuSemDona || !dona || dona === f.donaOuSemDona);
function filtrarLeads(leads: Lead[], f: FiltrosDia): Lead[] {
  return leads.filter((l) => naUnidade(f, l.unidade, l.responsavelId) && (!f.atendente || l.responsavelId === f.atendente) && (!f.origem || l.origem === f.origem));
}
function filtrarAgendamentos(ags: AgendamentoContado[], f: FiltrosDia): AgendamentoContado[] {
  return ags.filter(
    (a) =>
      naUnidade(f, a.unidade, a.responsavelId) &&
      (!f.atendente || a.atendenteId === f.atendente || (!a.atendenteId && a.responsavelId === f.atendente)) &&
      (!f.quem || (f.quem === 'ia') === a.porIa) &&
      (!f.origem || (f.origens?.get(a.conversaId) ?? 'WhatsApp') === f.origem),
  );
}

/** Leads e agendamentos já classificados e filtrados (base das três visões). */
export function preparar(d: DadosRelatorioDia, f: FiltrosDia = {}) {
  const leads = filtrarLeads(classificarLeads(d, f.origens), f);
  const agendamentos = filtrarAgendamentos(contarAgendamentos(d.agendamentos), f);
  /** 1º agendamento que conta de cada conversa. */
  const primeiro = new Map<string, AgendamentoContado>();
  for (const a of agendamentos) if (!primeiro.has(a.conversaId)) primeiro.set(a.conversaId, a);
  return { leads, agendamentos, primeiro };
}
export type Preparado = ReturnType<typeof preparar>;

// ---------------------------------------------------------------- visão (a): pelo dia do agendamento

export interface LinhaRanking {
  id: string | null;
  nome: string;
  porIa: boolean;
  agendamentos: number;
}

function ranking(ags: AgendamentoContado[]): LinhaRanking[] {
  const m = new Map<string, LinhaRanking>();
  for (const a of ags) {
    const k = a.porIa ? 'ia' : a.atendenteId ?? `nome:${a.atendenteNome ?? 'Equipe'}`;
    const l = m.get(k) ?? { id: a.porIa ? null : a.atendenteId, nome: a.porIa ? 'Serena (IA)' : a.atendenteNome ?? 'Equipe', porIa: a.porIa, agendamentos: 0 };
    l.agendamentos++;
    m.set(k, l);
  }
  return [...m.values()].sort((a, b) => b.agendamentos - a.agendamentos || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Leads novos de um dia: quantos chegaram, quantos agendaram no próprio dia, até `ate` e no dia `em`. */
function grupoDoDia(p: Preparado, dia: string, ate: string, em: string) {
  const novos = p.leads.filter((l) => l.tipo === 'novo' && l.dia === dia);
  const ag = novos.map((l) => p.primeiro.get(l.conversaId)).filter((a): a is AgendamentoContado => Boolean(a));
  return {
    dia,
    chegaram: novos.length,
    agendaramNoMesmoDia: ag.filter((a) => a.dia === dia).length,
    agendaramAte: ag.filter((a) => a.dia <= ate).length,
    agendaramNoDia: ag.filter((a) => a.dia === em).length,
  };
}

/** Visão (a): o dia D, pelo dia em que o agendamento foi feito. */
export function porDia(p: Preparado, dia: string) {
  const leadsDia = p.leads.filter((l) => l.dia === dia);
  const novos = leadsDia.filter((l) => l.tipo === 'novo');
  const ags = p.agendamentos.filter((a) => a.dia === dia);
  const faixas = Object.fromEntries(FAIXAS.map((k) => [k, 0])) as Record<Faixa, number>;
  for (const a of ags) faixas[a.faixa]++;
  const agendaramNoDia = novos.filter((l) => p.primeiro.get(l.conversaId)?.dia === dia).length;
  return {
    dia,
    chegaram: { novos: novos.length, retorno: leadsDia.filter((l) => l.tipo === 'retorno').length, importados: leadsDia.filter((l) => l.tipo === 'importado').length },
    novosQueAgendaramNoDia: agendaramNoDia,
    conversaoNoDiaPct: pct(agendaramNoDia, novos.length),
    agendamentos: {
      total: ags.length,
      faixas: FAIXAS.map((k) => ({ faixa: k, nome: NOME_FAIXA[k], total: faixas[k], pct: pct(faixas[k], ags.length) })),
      porIa: ags.filter((a) => a.porIa).length,
      porEquipe: ags.filter((a) => !a.porIa).length,
      compareceram: ags.filter((a) => a.compareceu).length,
      faltaram: ags.filter((a) => a.faltou && !a.compareceu).length,
    },
    /** Os leads de D, D-1 e D-2: chegaram, agendaram no mesmo dia, até D e em D. */
    grupos: [0, 1, 2].map((n) => grupoDoDia(p, somarDias(dia, -n), dia, dia)),
    ranking: ranking(ags),
  };
}
export type RelatorioDoDia = ReturnType<typeof porDia>;

// ---------------------------------------------------------------- visão (b): grupo de leads (coorte)

/** Quantos dias depois da chegada a grade mostra; a última coluna é "7 ou mais". */
export const DIAS_COORTE = 7;

/**
 * Visão (b): para cada dia de chegada, quantos leads novos chegaram e quantos agendaram no dia 0, 1, 2… 7+ depois,
 * com a conversão acumulada. Dias que ainda não aconteceram (depois de `hoje`) ficam null.
 */
export function porCoorte(p: Preparado, dias: string[], hoje: string) {
  const linhas = dias.map((dia) => {
    const novos = p.leads.filter((l) => l.tipo === 'novo' && l.dia === dia);
    const cols = Array.from({ length: DIAS_COORTE + 1 }, () => 0);
    for (const l of novos) {
      const a = p.primeiro.get(l.conversaId);
      if (!a || a.dia > hoje) continue;
      cols[Math.min(DIAS_COORTE, Math.max(0, diasEntre(dia, a.dia)))]!++;
    }
    let acum = 0;
    const celulas = cols.map((n, k) => {
      const futuro = somarDias(dia, k) > hoje;
      acum += n;
      return futuro ? null : { agendaram: n, acumulado: acum, acumuladoPct: pct(acum, novos.length) };
    });
    return { dia, chegaram: novos.length, agendaram: acum, conversaoPct: pct(acum, novos.length), celulas };
  });
  const chegaram = linhas.reduce((s, l) => s + l.chegaram, 0);
  const agendaram = linhas.reduce((s, l) => s + l.agendaram, 0);
  return { dias: DIAS_COORTE, linhas, total: { chegaram, agendaram, conversaoPct: pct(agendaram, chegaram) } };
}
export type Coorte = ReturnType<typeof porCoorte>;

// ---------------------------------------------------------------- relatório geral do período

function mediana(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Geral do período [inicio, fim): chegaram, retorno, agendaram, conversão, tempo até agendar e por origem. */
export function resumoPeriodo(p: Preparado, inicioDia: string, fimDia: string) {
  const dentro = (dia: string) => dia >= inicioDia && dia <= fimDia;
  const leads = p.leads.filter((l) => dentro(l.dia));
  const novos = leads.filter((l) => l.tipo === 'novo');
  const ags = p.agendamentos.filter((a) => dentro(a.dia));
  const convertidos = novos.map((l) => ({ l, a: p.primeiro.get(l.conversaId) })).filter((x): x is { l: Lead; a: AgendamentoContado } => Boolean(x.a));
  const tempos = convertidos.map((x) => Math.max(0, x.a.em.getTime() - x.l.em.getTime()));
  const porOrigem = new Map<string, { origem: string; chegaram: number; agendaram: number; tempos: number[] }>();
  for (const l of novos) {
    const o = porOrigem.get(l.origem) ?? { origem: l.origem, chegaram: 0, agendaram: 0, tempos: [] };
    o.chegaram++;
    const a = p.primeiro.get(l.conversaId);
    if (a) {
      o.agendaram++;
      o.tempos.push(Math.max(0, a.em.getTime() - l.em.getTime()));
    }
    porOrigem.set(l.origem, o);
  }
  return {
    chegaram: novos.length,
    retorno: leads.filter((l) => l.tipo === 'retorno').length,
    importados: leads.filter((l) => l.tipo === 'importado').length,
    agendamentos: ags.length,
    agendamentosDeNovos: ags.filter((a) => a.faixa !== 'retorno' && a.faixa !== 'importado').length,
    agendamentosRetorno: ags.filter((a) => a.faixa === 'retorno').length,
    porIa: ags.filter((a) => a.porIa).length,
    porEquipe: ags.filter((a) => !a.porIa).length,
    /** Leads novos do período que já agendaram (até agora). */
    novosQueAgendaram: convertidos.length,
    conversaoPct: pct(convertidos.length, novos.length),
    tempoAteAgendarMedianaMs: mediana(tempos),
    tempoAteAgendarMediaMs: media(tempos),
    origens: [...porOrigem.values()]
      .map((o) => ({ origem: o.origem, chegaram: o.chegaram, agendaram: o.agendaram, conversaoPct: pct(o.agendaram, o.chegaram), tempoMedianaMs: mediana(o.tempos) }))
      .sort((a, b) => b.chegaram - a.chegaram || b.agendaram - a.agendaram || a.origem.localeCompare(b.origem, 'pt-BR')),
    ranking: ranking(ags),
  };
}
export type ResumoPeriodo = ReturnType<typeof resumoPeriodo>;
