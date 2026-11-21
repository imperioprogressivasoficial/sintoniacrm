import { valorDe, type ConfigComercial, type Venda } from '../comercial/calculo.js';
import { mediana } from '../desempenho/calculo.js';
import { ETAPAS, NOME_ETAPA, type Etapa } from '../domain.js';
import { dataISO, DIA, partesBahia } from '../util/tempo.js';

/**
 * Análises da gestão (menu Análises): vendas e receita, horários de pico, tempo parado no funil e clientes que voltaram.
 * Funções puras: a fonte (fonte.ts) traz os dados do período já no escopo de quem pede e aqui só se fazem as contas,
 * para os testes conferirem cada regra sem banco.
 */

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const centavos = (n: number) => Math.round(n * 100) / 100;
/** Variação em % do atual sobre o anterior (null quando não havia base). */
export const variacao = (atual: number, anterior: number) => (anterior ? Math.round(((atual - anterior) / anterior) * 1000) / 10 : null);

// ================================================================ vendas e receita

export interface LeadOrigem {
  conversaId: string;
  origem: string;
}

export interface EntradaVendas {
  vendas: Venda[];
  /** O mesmo tamanho de período, logo antes (para a variação). */
  anteriores: Venda[];
  precos: ConfigComercial['precos'];
  /** Dias do período (AAAA-MM-DD), na ordem. */
  dias: string[];
  /** Origem de cada conversa (anúncio, link, campo da ficha…). */
  origens: Map<string, string>;
  /** Leads que chegaram no período, com a origem. */
  leads: LeadOrigem[];
  /** Nomes da equipe (id → nome), para quando o evento não trouxe o nome. */
  nomes?: Map<string, string>;
}

interface Soma {
  vendas: number;
  receita: number;
  comValor: number;
  compareceram: number;
  receitaConfirmada: number;
}
const soma0 = (): Soma => ({ vendas: 0, receita: 0, comValor: 0, compareceram: 0, receitaConfirmada: 0 });
const somar = (s: Soma, valor: number, compareceu: boolean) => {
  s.vendas++;
  s.receita += valor;
  if (valor > 0) s.comValor++;
  if (compareceu) {
    s.compareceram++;
    s.receitaConfirmada += valor;
  }
};
const fechar = (s: Soma) => ({
  vendas: s.vendas,
  receita: centavos(s.receita),
  ticketMedio: s.comValor ? centavos(s.receita / s.comValor) : null,
  compareceram: s.compareceram,
  receitaConfirmada: centavos(s.receitaConfirmada),
  comparecimentoPct: pct(s.compareceram, s.vendas),
});

export const ID_IA = 'ia';
export const NOME_IA = 'IA da Sintonia';
const SEM_SERVICO = 'Serviço não informado';

export function analisarVendas(e: EntradaVendas) {
  const total = soma0();
  let semValor = 0;
  const ia = soma0();
  const porDia = new Map(e.dias.map((d) => [d, soma0()]));
  const porAtendente = new Map<string, { id: string; nome: string; s: Soma }>();
  const porServico = new Map<string, { nome: string; s: Soma }>();
  const porUnidade = new Map<string, Soma>();
  const porOrigem = new Map<string, { s: Soma; clientes: Set<string> }>();

  for (const v of e.vendas) {
    const valor = valorDe(v, e.precos);
    if (valor <= 0) semValor++;
    somar(total, valor, v.compareceu);
    if (v.porIa) somar(ia, valor, v.compareceu);
    const dia = dataISO(v.em);
    const d = porDia.get(dia);
    if (d) somar(d, valor, v.compareceu);

    const id = v.porIa ? ID_IA : (v.atendenteId ?? (v.atendenteNome ? `nome:${v.atendenteNome.toLowerCase()}` : 'sem'));
    const nome = v.porIa ? NOME_IA : ((v.atendenteId && e.nomes?.get(v.atendenteId)) || v.atendenteNome || 'Sem atendente');
    const a = porAtendente.get(id) ?? { id, nome, s: soma0() };
    somar(a.s, valor, v.compareceu);
    porAtendente.set(id, a);

    const servico = v.servico?.trim() || SEM_SERVICO;
    const ks = servico.toLowerCase();
    const sv = porServico.get(ks) ?? { nome: servico, s: soma0() };
    somar(sv.s, valor, v.compareceu);
    porServico.set(ks, sv);

    const u = porUnidade.get(v.unidade) ?? soma0();
    somar(u, valor, v.compareceu);
    porUnidade.set(v.unidade, u);

    const origem = e.origens.get(v.conversaId) ?? 'WhatsApp';
    const o = porOrigem.get(origem) ?? { s: soma0(), clientes: new Set<string>() };
    somar(o.s, valor, v.compareceu);
    o.clientes.add(v.conversaId);
    porOrigem.set(origem, o);
  }

  // Campanhas e origens: quantos leads chegaram e quantos deles compraram (dentro do período).
  const compraram = new Set(e.vendas.map((v) => v.conversaId));
  const leadsPorOrigem = new Map<string, { leads: number; viraram: number }>();
  const vistos = new Set<string>();
  for (const l of e.leads) {
    if (vistos.has(l.conversaId)) continue;
    vistos.add(l.conversaId);
    const x = leadsPorOrigem.get(l.origem) ?? { leads: 0, viraram: 0 };
    x.leads++;
    if (compraram.has(l.conversaId)) x.viraram++;
    leadsPorOrigem.set(l.origem, x);
  }
  const nomesOrigem = new Set([...porOrigem.keys(), ...leadsPorOrigem.keys()]);
  const origens = [...nomesOrigem]
    .map((origem) => {
      const o = porOrigem.get(origem);
      const l = leadsPorOrigem.get(origem) ?? { leads: 0, viraram: 0 };
      return { origem, leads: l.leads, viraramVenda: l.viraram, conversaoPct: pct(l.viraram, l.leads), clientes: o?.clientes.size ?? 0, ...fechar(o?.s ?? soma0()) };
    })
    .sort((a, b) => b.receita - a.receita || b.vendas - a.vendas || b.leads - a.leads || a.origem.localeCompare(b.origem, 'pt-BR'));

  const anterior = soma0();
  for (const v of e.anteriores) somar(anterior, valorDe(v, e.precos), v.compareceu);
  const ord = <T extends { receita: number; vendas: number; nome: string }>(xs: T[]) =>
    xs.sort((a, b) => b.receita - a.receita || b.vendas - a.vendas || a.nome.localeCompare(b.nome, 'pt-BR'));

  return {
    totais: {
      ...fechar(total),
      semValor,
      ia: fechar(ia),
      anterior: { vendas: anterior.vendas, receita: centavos(anterior.receita) },
      variacaoReceitaPct: variacao(total.receita, anterior.receita),
      variacaoVendasPct: variacao(total.vendas, anterior.vendas),
    },
    dias: [...porDia].map(([dia, s]) => ({ dia, vendas: s.vendas, receita: centavos(s.receita) })),
    atendentes: ord([...porAtendente.values()].map((a) => ({ id: a.id, nome: a.nome, porIa: a.id === ID_IA, ...fechar(a.s) }))),
    servicos: ord([...porServico.values()].map((x) => ({ nome: x.nome, ...fechar(x.s) }))),
    unidades: ord([...porUnidade].map(([unidade, s]) => ({ unidade, nome: unidade, ...fechar(s) }))),
    origens,
  };
}
export type AnaliseVendas = ReturnType<typeof analisarVendas>;

// ================================================================ horários de pico

/** Grade dia da semana (0 = domingo) × hora (0–23). */
export type Grade = number[][];
export const gradeVazia = (): Grade => Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
export function gradeDe(datas: Date[]): Grade {
  const g = gradeVazia();
  for (const d of datas) {
    const p = partesBahia(d);
    g[p.diaSemana]![p.hora]!++;
  }
  return g;
}

export const NOMES_DIA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function resumirGrade(g: Grade) {
  const porHora = Array.from({ length: 24 }, (_, h) => g.reduce((s, linha) => s + (linha[h] ?? 0), 0));
  const porDiaSemana = g.map((linha) => linha.reduce((a, b) => a + b, 0));
  const total = porDiaSemana.reduce((a, b) => a + b, 0);
  let pico: { diaSemana: number; hora: number; total: number } | null = null;
  g.forEach((linha, d) => linha.forEach((v, h) => { if (v > 0 && (!pico || v > pico.total)) pico = { diaSemana: d, hora: h, total: v }; }));
  const maxH = Math.max(...porHora);
  const maxD = Math.max(...porDiaSemana);
  // Faixa de 3 horas seguidas com mais movimento (ex.: 18h–21h).
  let faixa: { de: number; ate: number; total: number; pct: number | null } | null = null;
  for (let h = 0; h <= 21; h++) {
    const t = porHora[h]! + porHora[h + 1]! + porHora[h + 2]!;
    if (t > 0 && (!faixa || t > faixa.total)) faixa = { de: h, ate: h + 3, total: t, pct: pct(t, total) };
  }
  return {
    total,
    grade: g,
    porHora,
    porDiaSemana,
    pico: pico as { diaSemana: number; hora: number; total: number } | null,
    horaPico: maxH > 0 ? porHora.indexOf(maxH) : null,
    diaPico: maxD > 0 ? porDiaSemana.indexOf(maxD) : null,
    faixa,
  };
}

export const SERIES_HORARIO = ['leads', 'mensagens', 'agendamentos'] as const;
export type SerieHorario = (typeof SERIES_HORARIO)[number];
export function analisarHorarios(g: Record<SerieHorario, Grade>) {
  return Object.fromEntries(SERIES_HORARIO.map((s) => [s, resumirGrade(g[s])])) as Record<SerieHorario, ReturnType<typeof resumirGrade>>;
}

// ================================================================ funil: tempo parado por etapa e perdas

export interface MudancaEtapa {
  conversaId: string;
  em: Date;
  de: string | null;
  para: string;
  motivo?: string | null;
}
export interface ConversaFunil {
  id: string;
  nome: string | null;
  unidade: string;
  etapa: string;
  criadaEm: Date;
}
export interface EntradaFunil {
  /** Mudanças de etapa conhecidas (até agora), de qualquer ordem. */
  mudancas: MudancaEtapa[];
  conversas: ConversaFunil[];
  inicio: Date;
  fim: Date;
  agora: Date;
}

/** Etapas em que a cliente "fica parada" esperando a loja agir (as outras são de chegada). */
export const ETAPAS_ABERTAS: Etapa[] = ['novo_lead', 'em_conversa', 'interessada', 'agendada'];

export const MOTIVO_PERDA: Record<string, string> = {
  manual: 'Marcada pela equipe',
  automacao: 'Automação',
  followups_esgotados: 'Não respondeu aos follow-ups',
  ia_classificou: 'Classificada pela IA',
  faltou: 'Faltou ao horário',
  comando_ia: 'Pedido à IA',
};
const nomeMotivo = (m: string | null | undefined) => {
  const s = (m ?? '').trim();
  if (!s) return 'Sem motivo';
  return MOTIVO_PERDA[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
};
const nomeEtapa = (e: string) => NOME_ETAPA[e as Etapa] ?? e;

export function analisarFunil(e: EntradaFunil) {
  const porConversa = new Map<string, MudancaEtapa[]>();
  for (const m of e.mudancas) porConversa.set(m.conversaId, [...(porConversa.get(m.conversaId) ?? []), m]);
  for (const l of porConversa.values()) l.sort((a, b) => a.em.getTime() - b.em.getTime());
  const criada = new Map(e.conversas.map((c) => [c.id, c]));

  // Passagens que terminaram dentro do período: quanto tempo ficou na etapa antes de sair dela.
  const tempos = new Map<string, number[]>();
  const saidasPara = new Map<string, Map<string, number>>();
  for (const [id, lista] of porConversa) {
    let desde = criada.get(id)?.criadaEm ?? null;
    let etapa: string | null = lista[0]?.de ?? 'novo_lead';
    for (const m of lista) {
      const de = m.de ?? etapa;
      if (de && desde && m.em >= e.inicio && m.em < e.fim && m.em.getTime() >= desde.getTime()) {
        tempos.set(de, [...(tempos.get(de) ?? []), m.em.getTime() - desde.getTime()]);
        const x = saidasPara.get(de) ?? new Map<string, number>();
        x.set(m.para, (x.get(m.para) ?? 0) + 1);
        saidasPara.set(de, x);
      }
      desde = m.em;
      etapa = m.para;
    }
  }

  // Quem está parado agora em cada etapa (desde a última mudança ou desde que a conversa chegou).
  const agora = new Map<string, number[]>();
  const paradas: Array<{ conversaId: string; cliente: string; unidade: string; etapa: string; nomeEtapa: string; desde: Date; paradoMs: number }> = [];
  for (const c of e.conversas) {
    const ultima = porConversa.get(c.id)?.filter((m) => m.para === c.etapa).at(-1);
    const desde = ultima?.em ?? c.criadaEm;
    const ms = Math.max(0, e.agora.getTime() - desde.getTime());
    agora.set(c.etapa, [...(agora.get(c.etapa) ?? []), ms]);
    if (ETAPAS_ABERTAS.includes(c.etapa as Etapa)) paradas.push({ conversaId: c.id, cliente: c.nome || 'Cliente', unidade: c.unidade, etapa: c.etapa, nomeEtapa: nomeEtapa(c.etapa), desde, paradoMs: ms });
  }
  paradas.sort((a, b) => b.paradoMs - a.paradoMs);

  const conhecidas = [...ETAPAS, ...[...new Set([...tempos.keys(), ...agora.keys()])].filter((x) => !(ETAPAS as readonly string[]).includes(x))];
  const media = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const etapas = conhecidas
    .map((etapa) => {
      const t = tempos.get(etapa) ?? [];
      const a = agora.get(etapa) ?? [];
      const destinos = [...(saidasPara.get(etapa) ?? new Map<string, number>())].sort((x, y) => y[1] - x[1]).map(([para, total]) => ({ para, nome: nomeEtapa(para), total, pct: pct(total, t.length) }));
      return {
        etapa,
        nome: nomeEtapa(etapa),
        aberta: ETAPAS_ABERTAS.includes(etapa as Etapa),
        saidas: t.length,
        mediaMs: media(t),
        medianaMs: mediana(t),
        agora: a.length,
        paradoAgoraMedianaMs: ETAPAS_ABERTAS.includes(etapa as Etapa) ? mediana(a) : null,
        destinos,
      };
    })
    .filter((x) => x.saidas || x.agora || (ETAPAS as readonly string[]).includes(x.etapa));

  // Perdas no período, pelo motivo gravado na mudança (uma por conversa).
  const motivos = new Map<string, number>();
  const daEtapa = new Map<string, number>();
  const perdidas = new Set<string>();
  for (const m of e.mudancas) {
    if (m.para !== 'perdida' || m.em < e.inicio || m.em >= e.fim || perdidas.has(m.conversaId)) continue;
    perdidas.add(m.conversaId);
    const n = nomeMotivo(m.motivo);
    motivos.set(n, (motivos.get(n) ?? 0) + 1);
    const de = nomeEtapa(m.de ?? 'novo_lead');
    daEtapa.set(de, (daEtapa.get(de) ?? 0) + 1);
  }
  const lista = (mp: Map<string, number>) => [...mp].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([nome, total]) => ({ nome, total, pct: pct(total, perdidas.size) }));

  return {
    etapas,
    paradas: paradas.slice(0, 30),
    paradasTotal: paradas.length,
    perdas: { total: perdidas.size, motivos: lista(motivos), etapas: lista(daEtapa) },
  };
}
export type AnaliseFunil = ReturnType<typeof analisarFunil>;

// ================================================================ clientes que voltaram (recorrência)

export interface AgendamentoCliente {
  conversaId: string;
  em: Date;
  nome: string | null;
  servico: string | null;
  valor: number | null;
  compareceu: boolean;
}
export interface EntradaRecorrencia {
  /** Agendamentos de até 1 ano antes do fim do período (para saber quem já tinha vindo). */
  agendamentos: AgendamentoCliente[];
  precos: ConfigComercial['precos'];
  inicio: Date;
  fim: Date;
  agora: Date;
  /** Sem agendar há quantos dias a cliente conta como "sumida". */
  diasSumida?: number;
}

/** Dois agendamentos da mesma cliente com menos que isso entre eles são a mesma visita (remarcação). */
const MESMA_VISITA_MS = 6 * 3600_000;

export function analisarRecorrencia(e: EntradaRecorrencia) {
  const diasSumida = e.diasSumida ?? 60;
  const porCliente = new Map<string, AgendamentoCliente[]>();
  for (const a of e.agendamentos) {
    if (a.em >= e.agora) continue;
    porCliente.set(a.conversaId, [...(porCliente.get(a.conversaId) ?? []), a]);
  }
  // Uma visita por cliente a cada 6 h (a remarcação não conta como volta).
  for (const [id, l] of porCliente) {
    l.sort((a, b) => a.em.getTime() - b.em.getTime());
    const visitas: AgendamentoCliente[] = [];
    for (const a of l) {
      const ult = visitas.at(-1);
      if (ult && a.em.getTime() - ult.em.getTime() < MESMA_VISITA_MS) visitas[visitas.length - 1] = { ...a, compareceu: a.compareceu || ult.compareceu };
      else visitas.push(a);
    }
    porCliente.set(id, visitas);
  }

  const dentro = (d: Date) => d >= e.inicio && d < e.fim;
  let clientes = 0, novas = 0, voltaram = 0, maisDeUma = 0;
  let receitaNovas = 0, receitaVoltaram = 0;
  const intervalos: number[] = [];
  const faixas = [0, 0, 0, 0];
  const fieis: Array<{ conversaId: string; cliente: string; visitas: number; valor: number; ultima: Date; primeira: Date }> = [];
  const sumidas: Array<{ conversaId: string; cliente: string; visitas: number; ultima: Date; diasSem: number; ultimoServico: string | null }> = [];

  for (const [id, visitas] of porCliente) {
    const ate = visitas.filter((v) => v.em < e.fim);
    const noPeriodo = ate.filter((v) => dentro(v.em));
    const valor = (xs: AgendamentoCliente[]) => xs.reduce((s, v) => s + valorDe(v, e.precos), 0);
    if (noPeriodo.length) {
      clientes++;
      const antes = ate.some((v) => v.em < e.inicio);
      if (antes) { voltaram++; receitaVoltaram += valor(noPeriodo); } else { novas++; receitaNovas += valor(noPeriodo); }
      if (noPeriodo.length > 1) maisDeUma++;
      faixas[Math.min(ate.length, 4) - 1]!++;
      for (let i = 1; i < ate.length; i++) if (dentro(ate[i]!.em)) intervalos.push(ate[i]!.em.getTime() - ate[i - 1]!.em.getTime());
      if (ate.length > 1) {
        const nome = [...ate].reverse().find((v) => v.nome)?.nome ?? 'Cliente';
        fieis.push({ conversaId: id, cliente: nome, visitas: ate.length, valor: centavos(valor(ate)), ultima: ate.at(-1)!.em, primeira: ate[0]!.em });
      }
    }
    // Sumidas: já agendou, mas a última vez foi há mais de N dias (vale para hoje, não para o período).
    const ultima = visitas.at(-1)!;
    const diasSem = Math.floor((e.agora.getTime() - ultima.em.getTime()) / DIA);
    if (diasSem >= diasSumida) sumidas.push({ conversaId: id, cliente: [...visitas].reverse().find((v) => v.nome)?.nome ?? 'Cliente', visitas: visitas.length, ultima: ultima.em, diasSem, ultimoServico: ultima.servico });
  }
  fieis.sort((a, b) => b.visitas - a.visitas || b.valor - a.valor || b.ultima.getTime() - a.ultima.getTime());
  sumidas.sort((a, b) => b.visitas - a.visitas || a.diasSem - b.diasSem);
  const med = mediana(intervalos);

  return {
    clientes,
    novas,
    voltaram,
    retornoPct: pct(voltaram, clientes),
    maisDeUmaNoPeriodo: maisDeUma,
    receitaNovas: centavos(receitaNovas),
    receitaVoltaram: centavos(receitaVoltaram),
    intervaloMedianoDias: med == null ? null : Math.round((med / DIA) * 10) / 10,
    frequencia: [
      { faixa: '1 vez', total: faixas[0]! },
      { faixa: '2 vezes', total: faixas[1]! },
      { faixa: '3 vezes', total: faixas[2]! },
      { faixa: '4 ou mais', total: faixas[3]! },
    ],
    fieis: fieis.slice(0, 15),
    diasSumida,
    sumidas: { total: sumidas.length, lista: sumidas.slice(0, 20) },
  };
}
export type AnaliseRecorrencia = ReturnType<typeof analisarRecorrencia>;
