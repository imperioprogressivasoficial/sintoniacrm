import type { RelatorioDoDia, ResumoPeriodo } from './calculo.js';

/**
 * relatorio-dia: o texto que a Serena manda pelo WhatsApp. Curto, em português simples, sem IA paga: a frase de
 * direção sai de um modelo pronto (funciona sem chave de IA).
 */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const diaBr = (dia: string) => {
  const [a, m, d] = dia.split('-').map(Number);
  const sem = new Date(Date.UTC(a!, m! - 1, d!, 12)).getUTCDay();
  return `${DIAS[sem]}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};
export const mesBr = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m! - 1]} de ${a}`;
};
const n = (x: number) => x.toLocaleString('pt-BR');
const pctTxt = (v: number | null) => (v == null ? '—' : `${String(Math.round(v)).replace('.', ',')}%`);
const plural = (q: number, um: string, varios: string) => `${n(q)} ${q === 1 ? um : varios}`;
function duracao(ms: number | null): string {
  if (ms == null) return '—';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

export interface MetaInfo {
  /** Meta de agendamentos do mês (null = não há meta: a linha some). */
  mes: number | null;
  /** Agendamentos que contam do dia 1 até o dia do relatório (inclusive). */
  feitosMes: number;
  diasMes: number;
  /** Dia do mês do relatório (quantos dias já contam). */
  diaAtual: number;
  /** Agendamentos que contam no próprio dia. */
  feitosDia: number;
}

export const metaDoDia = (m: MetaInfo) => (m.mes ? Math.max(1, Math.round(m.mes / m.diasMes)) : null);

/** Frase de direção (modelo pronto). `diaAtual` da meta = quantos dias do mês já fecharam. */
export function direcao(m: MetaInfo, o: { hoje: number; media7: number | null }): string {
  if (m.mes) {
    const esperado = (m.mes * m.diaAtual) / m.diasMes;
    const ritmo = esperado ? m.feitosMes / esperado : 1;
    const faltam = Math.max(0, m.mes - m.feitosMes);
    const diasRestantes = Math.max(1, m.diasMes - m.diaAtual);
    if (faltam === 0) return `Meta do mês batida! Cada agendamento a mais agora é bônus.`;
    const porDia = Math.ceil(faltam / diasRestantes);
    if (ritmo < 0.97) return `Estamos ${Math.round((1 - ritmo) * 100)}% abaixo do ritmo para bater a meta do mês: precisamos de ${plural(porDia, 'agendamento', 'agendamentos')} por dia até o fim do mês.`;
    if (ritmo > 1.03) return `Estamos ${Math.round((ritmo - 1) * 100)}% acima do ritmo da meta do mês. Vamos manter: ${plural(porDia, 'agendamento', 'agendamentos')} por dia fecham a meta.`;
    return `Estamos no ritmo certo para bater a meta do mês: ${plural(porDia, 'agendamento', 'agendamentos')} por dia até o fim.`;
  }
  if (o.media7 == null || o.media7 === 0) return o.hoje ? `Foram ${plural(o.hoje, 'agendamento', 'agendamentos')}. Cadastre a meta do mês em Comercial para eu acompanhar o ritmo.` : `Sem agendamentos ainda. Cadastre a meta do mês em Comercial para eu acompanhar o ritmo.`;
  const dif = Math.round(((o.hoje - o.media7) / o.media7) * 100);
  const media = String(Math.round(o.media7 * 10) / 10).replace('.', ',');
  if (dif <= -5) return `Hoje ficamos ${Math.abs(dif)}% abaixo da média dos últimos 7 dias (${media} por dia). Vamos recuperar amanhã.`;
  if (dif >= 5) return `Hoje ficamos ${dif}% acima da média dos últimos 7 dias (${media} por dia). Ótimo dia!`;
  return `Hoje ficamos na média dos últimos 7 dias (${media} agendamentos por dia).`;
}

function linhasMeta(m: MetaInfo, dia: boolean): string[] {
  if (!m.mes) return [];
  const md = metaDoDia(m)!;
  const out: string[] = [];
  if (dia) {
    const falta = md - m.feitosDia;
    out.push(`Meta do dia: ${n(m.feitosDia)} de ${n(md)}${falta > 0 ? ` (faltaram ${n(falta)})` : ' (batida!)'}`);
  }
  const falta = Math.max(0, m.mes - m.feitosMes);
  out.push(`Meta do mês: ${n(m.feitosMes)} de ${n(m.mes)} (${pctTxt((m.feitosMes / m.mes) * 100)})${falta ? `, faltam ${n(falta)}` : ', batida!'}`);
  return out;
}

function linhasRanking(r: RelatorioDoDia['ranking'], max = 5): string[] {
  if (!r.length) return [];
  return ['', '*Ranking*', ...r.slice(0, max).map((x, i) => `${i + 1}. ${x.nome}: ${n(x.agendamentos)}`)];
}

function linhaParados(p: { total: number; maisAntigoMs: number | null }): string[] {
  if (!p.total) return ['Nenhum lead parado sem resposta.'];
  return [`Parados sem resposta: ${n(p.total)}${p.maisAntigoMs ? ` (o mais antigo há ${duracao(p.maisAntigoMs)})` : ''}.`];
}

const cabecalho = (titulo: string, unidade: string | null) => `*${titulo}*${unidade ? ` · ${unidade}` : ''}`;

export interface EntradaFechamento {
  rel: RelatorioDoDia;
  unidadeNome: string | null;
  meta: MetaInfo;
  parados: { total: number; maisAntigoMs: number | null };
  atendimento: { conversas: number; primeiraMs: number | null } | null;
  /** Média de agendamentos por dia nos 7 dias anteriores. */
  media7: number | null;
}

/** Fechamento do dia (21:00). */
export function textoFechamento(e: EntradaFechamento): string {
  const r = e.rel;
  const f = Object.fromEntries(r.agendamentos.faixas.map((x) => [x.faixa, x.total])) as Record<string, number>;
  const antigos = (f.d2 ?? 0) + (f.d3a7 ?? 0) + (f.mais7 ?? 0);
  const l: string[] = [cabecalho(`Fechamento do dia · ${diaBr(r.dia)}`, e.unidadeNome), ''];
  l.push(`Chegaram ${plural(r.chegaram.novos, 'lead novo', 'leads novos')}; ${n(r.novosQueAgendaramNoDia)} agendaram hoje (${pctTxt(r.conversaoNoDiaPct)}).`);
  if (r.chegaram.retorno) l.push(`Voltaram ${plural(r.chegaram.retorno, 'cliente', 'clientes')} (retorno).`);
  l.push('', `*Agendamentos de hoje: ${n(r.agendamentos.total)}*`);
  if (r.agendamentos.total) {
    l.push(`• de leads de hoje: ${n(f.mesmoDia ?? 0)}`, `• de leads de ontem: ${n(f.d1 ?? 0)}`, `• de leads mais antigos: ${n(antigos)}`);
    if (f.retorno) l.push(`• retorno (já eram clientes): ${n(f.retorno)}`);
    if (f.importado) l.push(`• contatos antigos: ${n(f.importado)}`);
    l.push(`Pela Serena: ${n(r.agendamentos.porIa)} · pela equipe: ${n(r.agendamentos.porEquipe)}`);
  }
  const ontem = r.grupos[1];
  if (ontem && ontem.chegaram) l.push(`Leads de ontem: ${n(ontem.chegaram)} chegaram, ${n(ontem.agendaramAte)} já agendaram.`);
  const metas = linhasMeta(e.meta, true);
  if (metas.length) l.push('', ...metas);
  l.push(...linhasRanking(r.ranking));
  l.push('', ...linhaParados(e.parados));
  if (e.atendimento && e.atendimento.conversas) l.push(`Atendimento: a equipe respondeu ${plural(e.atendimento.conversas, 'conversa', 'conversas')}${e.atendimento.primeiraMs != null ? `, 1ª resposta em ~${duracao(e.atendimento.primeiraMs)}` : ''}.`);
  l.push('', `*Direção:* ${direcao(e.meta, { hoje: r.agendamentos.total, media7: e.media7 })}`);
  return l.join('\n');
}

export interface ItemAgendaTexto {
  hora: string;
  cliente: string | null;
  servico: string | null;
}
export interface EntradaAgenda {
  dia: string;
  unidadeNome: string | null;
  agenda: ItemAgendaTexto[];
  ontem: RelatorioDoDia;
  meta: MetaInfo;
  parados: { total: number; maisAntigoMs: number | null };
  media7: number | null;
}

/** Agenda da manhã (08:00): os horários de hoje, como foi ontem, metas e por onde começar. */
export function textoAgenda(e: EntradaAgenda): string {
  const l: string[] = [cabecalho(`Agenda do dia · ${diaBr(e.dia)}`, e.unidadeNome), ''];
  if (e.agenda.length) {
    l.push(`Hoje temos ${plural(e.agenda.length, 'horário marcado', 'horários marcados')} pela Sintonia:`);
    for (const a of e.agenda.slice(0, 8)) l.push(`• ${a.hora} ${(a.cliente ?? 'Cliente').split(/\s+/)[0]}${a.servico ? ` (${a.servico})` : ''}`);
    if (e.agenda.length > 8) l.push(`• e mais ${n(e.agenda.length - 8)}`);
  } else l.push('Ainda não há horários marcados pela Sintonia para hoje.');
  const o = e.ontem;
  l.push('', `*Ontem:* ${plural(o.chegaram.novos, 'lead novo', 'leads novos')}, ${n(o.novosQueAgendaramNoDia)} agendaram no mesmo dia; ${plural(o.agendamentos.total, 'agendamento', 'agendamentos')} no total.`);
  const semAgendar = o.grupos[0] ? o.grupos[0].chegaram - o.grupos[0].agendaramAte : 0;
  if (semAgendar > 0) l.push(`${plural(semAgendar, 'lead de ontem ainda não agendou', 'leads de ontem ainda não agendaram')}: vale chamar hoje.`);
  const md = metaDoDia(e.meta);
  if (md) l.push('', `Meta de hoje: ${plural(md, 'agendamento', 'agendamentos')}.`, ...linhasMeta(e.meta, false));
  l.push('', ...linhaParados(e.parados));
  l.push('', `*Direção:* ${direcao(e.meta, { hoje: o.agendamentos.total, media7: e.media7 })}`);
  return l.join('\n');
}

export interface EntradaPeriodo {
  titulo: string;
  unidadeNome: string | null;
  geral: ResumoPeriodo;
  anterior: ResumoPeriodo | null;
  meta: MetaInfo | null;
  parados?: { total: number; maisAntigoMs: number | null };
  /** Frase de direção pronta (fechamento do mês). */
  frase?: string;
}

/** Resumo da semana e fechamento do mês. */
export function textoPeriodo(e: EntradaPeriodo): string {
  const g = e.geral;
  const l: string[] = [cabecalho(e.titulo, e.unidadeNome), ''];
  const comp = (agora: number, antes: number | undefined) => {
    if (antes == null || !antes) return '';
    const d = Math.round(((agora - antes) / antes) * 100);
    return d === 0 ? ' (igual ao anterior)' : ` (${d > 0 ? '+' : ''}${d}% vs anterior)`;
  };
  l.push(`Leads novos: ${n(g.chegaram)}${comp(g.chegaram, e.anterior?.chegaram)}`);
  l.push(`Agendamentos: ${n(g.agendamentos)}${comp(g.agendamentos, e.anterior?.agendamentos)} · Serena ${n(g.porIa)}, equipe ${n(g.porEquipe)}`);
  l.push(`Conversão dos leads novos: ${pctTxt(g.conversaoPct)}${g.tempoAteAgendarMedianaMs != null ? ` · agendam em ~${duracao(g.tempoAteAgendarMedianaMs)}` : ''}`);
  if (g.retorno || g.agendamentosRetorno) l.push(`Retorno: ${plural(g.retorno, 'cliente voltou', 'clientes voltaram')}, ${n(g.agendamentosRetorno)} reagendaram.`);
  const top = g.origens.filter((o) => o.chegaram).slice(0, 3);
  if (top.length) l.push('', '*Origens*', ...top.map((o) => `• ${o.origem}: ${plural(o.chegaram, 'lead', 'leads')}, ${n(o.agendaram)} agendaram (${pctTxt(o.conversaoPct)})`));
  if (e.meta?.mes) l.push('', ...linhasMeta(e.meta, false));
  if (g.ranking.length) l.push('', '*Ranking*', ...g.ranking.slice(0, 5).map((x, i) => `${i + 1}. ${x.nome}: ${n(x.agendamentos)}`));
  if (e.parados) l.push('', ...linhaParados(e.parados));
  let frase: string;
  if (e.frase) frase = e.frase;
  else if (e.meta?.mes) frase = direcao(e.meta, { hoje: g.agendamentos, media7: null });
  else if (e.anterior && e.anterior.agendamentos) {
    const d = Math.round(((g.agendamentos - e.anterior.agendamentos) / e.anterior.agendamentos) * 100);
    frase = d < 0 ? `Agendamos ${Math.abs(d)}% menos que no período anterior. Foco em responder rápido e chamar quem não agendou.` : d > 0 ? `Agendamos ${d}% mais que no período anterior. Vamos manter o ritmo!` : 'Agendamos o mesmo que no período anterior.';
  } else frase = 'Cadastre a meta do mês em Comercial para eu acompanhar o ritmo.';
  l.push('', `*Direção:* ${frase}`);
  return l.join('\n');
}
