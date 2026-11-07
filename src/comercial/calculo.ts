import { z } from 'zod';
import { bahia, DIA, partesBahia } from '../util/tempo.js';

/**
 * Comercial (sala de vendas pelo WhatsApp): metas individuais, comissão, ranking e serviços mais agendados.
 * Tudo aqui é função pura: a fonte (fonte.ts) entrega as "vendas" (agendamentos) e a atividade de atendimento,
 * e este arquivo faz as contas. Os testes conferem cada regra sem banco.
 */

// ---------------------------------------------------------------- configuração

const Dinheiro = z.number().min(0).max(1_000_000);
const Qtd = z.number().int().min(0).max(100_000);
export const Meta = z.object({ agendamentos: Qtd.nullable().optional(), valor: Dinheiro.nullable().optional() });
export type Meta = z.infer<typeof Meta>;

export const RegraComissao = z.object({
  /** Serviço ao qual a regra vale (sem = regra geral). Comparação sem acento/maiúscula. */
  servico: z.string().trim().max(80).nullable().optional(),
  tipo: z.enum(['percentual', 'fixo']),
  /** % (0–100) ou R$ por agendamento. */
  valor: z.number().min(0).max(100_000),
});
export type RegraComissao = z.infer<typeof RegraComissao>;

export const ConfigComercial = z.object({
  metas: z
    .object({
      equipe: Meta.default({}),
      unidades: z.record(z.string().max(20), Meta).default({}),
      atendentes: z.record(z.string().max(64), Meta).default({}),
    })
    .prefault({}),
  comissao: z
    .object({
      ligada: z.boolean().default(false),
      regras: z.array(RegraComissao).max(50).default([]),
      /** true: só conta para a atendente que agendou pela conversa (agendamento_equipe). false: vale também a dona da conversa quando a IA agendou. */
      soQuemAgendou: z.boolean().default(true),
    })
    .prefault({}),
  precos: z.array(z.object({ servico: z.string().trim().min(1).max(80), valor: Dinheiro })).max(200).default([]),
  tv: z.object({ rotacao: z.boolean().default(true), ultimosNomes: z.boolean().default(true) }).prefault({}),
});
export type ConfigComercial = z.infer<typeof ConfigComercial>;
export const configPadrao = (): ConfigComercial => ConfigComercial.parse({});

// ---------------------------------------------------------------- dados de entrada

/** Um agendamento feito pela Sintonia (IA ou equipe). */
export interface Venda {
  conversaId: string;
  unidade: string;
  servico: string | null;
  /** Quem agendou pela conversa (só no agendamento da equipe). */
  atendenteId: string | null;
  atendenteNome: string | null;
  /** Dona da conversa agora (para a IA agendar e a comissão ir para a dona, se a gestão quiser). */
  responsavelId: string | null;
  porIa: boolean;
  /** Quando foi marcado. */
  em: Date;
  /** Valor gravado no agendamento (quando houver). */
  valor: number | null;
  compareceu: boolean;
  /** Só o primeiro nome da cliente (para a TV). */
  primeiroNome: string | null;
}

/** Atendimento de uma atendente no período (para conversão e tempo de 1ª resposta). */
export interface Atendimento {
  id: string;
  nome: string;
  /** Conversas diferentes que ela respondeu. */
  conversas: number;
  /** Soma e quantidade do tempo da 1ª resposta dela em cada conversa. */
  primeiraMs: number;
  primeiraN: number;
}

export interface Pessoa {
  id: string;
  nome: string;
  unidades: string[];
}

// ---------------------------------------------------------------- valor e comissão

export const normalizar = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Valor do agendamento: o gravado nele; senão, a tabela de preços pelo serviço; senão 0. */
export function valorDe(v: Pick<Venda, 'valor' | 'servico'>, precos: ConfigComercial['precos']): number {
  if (typeof v.valor === 'number' && v.valor >= 0) return v.valor;
  const s = normalizar(v.servico);
  if (!s) return 0;
  return precos.find((p) => normalizar(p.servico) === s)?.valor ?? 0;
}

/** Regra que vale para o serviço: a específica dele, senão a geral. */
export function regraPara(servico: string | null, regras: RegraComissao[]): RegraComissao | undefined {
  const s = normalizar(servico);
  return (s && regras.find((r) => normalizar(r.servico) === s)) || regras.find((r) => !normalizar(r.servico));
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** De quem é a venda para a comissão (null = ninguém, ex.: a IA agendou e só conta quem agendou). */
export function donaDaVenda(v: Venda, soQuemAgendou: boolean): string | null {
  if (v.atendenteId) return v.atendenteId;
  return soQuemAgendou ? null : v.responsavelId;
}

export interface LinhaComissao {
  conversaId: string;
  em: Date;
  unidade: string;
  servico: string | null;
  valor: number;
  regra: string;
  comissao: number;
}

export interface ComissaoAtendente {
  id: string;
  nome: string;
  agendamentos: number;
  compareceram: number;
  vendido: number;
  comissao: number;
  itens: LinhaComissao[];
}

/** Comissão por atendente: só agendamentos em que a cliente COMPARECEU. */
export function calcularComissao(vendas: Venda[], cfg: ConfigComercial, pessoas: Pessoa[]): ComissaoAtendente[] {
  const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
  const mapa = new Map<string, ComissaoAtendente>();
  const de = (id: string, nome: string | null) => {
    let a = mapa.get(id);
    if (!a) {
      a = { id, nome: nomes.get(id) ?? nome ?? 'Atendente', agendamentos: 0, compareceram: 0, vendido: 0, comissao: 0, itens: [] };
      mapa.set(id, a);
    }
    return a;
  };
  for (const p of pessoas) de(p.id, p.nome);
  for (const v of vendas) {
    const id = donaDaVenda(v, cfg.comissao.soQuemAgendou);
    if (!id) continue;
    const a = de(id, v.atendenteNome);
    a.agendamentos++;
    if (!v.compareceu) continue;
    const valor = valorDe(v, cfg.precos);
    a.compareceram++;
    a.vendido = centavos(a.vendido + valor);
    const r = regraPara(v.servico, cfg.comissao.regras);
    const c = !r ? 0 : r.tipo === 'percentual' ? centavos((valor * r.valor) / 100) : centavos(r.valor);
    a.comissao = centavos(a.comissao + c);
    a.itens.push({
      conversaId: v.conversaId,
      em: v.em,
      unidade: v.unidade,
      servico: v.servico,
      valor,
      regra: !r ? 'sem regra' : r.tipo === 'percentual' ? `${r.valor}%` : `R$ ${r.valor.toFixed(2).replace('.', ',')} fixo`,
      comissao: c,
    });
  }
  return [...mapa.values()].sort((a, b) => b.comissao - a.comissao || b.compareceram - a.compareceram || a.nome.localeCompare(b.nome, 'pt-BR'));
}

const csvCampo = (v: unknown) => {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const brl = (n: number) => n.toFixed(2).replace('.', ',');

/** CSV (ponto e vírgula, para o Excel em português) com uma linha por agendamento que gerou comissão + total. */
export function comissaoCsv(linhas: ComissaoAtendente[]): string {
  const out = ['Atendente;Data;Unidade;Serviço;Valor (R$);Regra;Comissão (R$)'];
  for (const a of linhas) {
    for (const i of a.itens) {
      const p = partesBahia(i.em);
      const data = `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
      out.push([a.nome, data, i.unidade, i.servico ?? '', brl(i.valor), i.regra, brl(i.comissao)].map(csvCampo).join(';'));
    }
    out.push([`TOTAL ${a.nome}`, '', '', `${a.compareceram} compareceram de ${a.agendamentos}`, brl(a.vendido), '', brl(a.comissao)].map(csvCampo).join(';'));
  }
  return '﻿' + out.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- períodos

export const PERIODOS_RANKING = ['dia', 'semana', 'mes'] as const;
export type PeriodoRanking = (typeof PERIODOS_RANKING)[number];

/** [inicio, fim) do período atual e o anterior com o mesmo tempo corrido (para "subiu/desceu"). */
export function janelaRanking(p: PeriodoRanking, agora: Date) {
  const d = partesBahia(agora);
  let inicio: Date;
  let inicioAnterior: Date;
  if (p === 'dia') {
    inicio = bahia(d.ano, d.mes, d.dia);
    inicioAnterior = new Date(inicio.getTime() - DIA);
  } else if (p === 'semana') {
    const desdeSegunda = (d.diaSemana + 6) % 7;
    inicio = new Date(bahia(d.ano, d.mes, d.dia).getTime() - desdeSegunda * DIA);
    inicioAnterior = new Date(inicio.getTime() - 7 * DIA);
  } else {
    inicio = bahia(d.ano, d.mes, 1);
    inicioAnterior = d.mes === 1 ? bahia(d.ano - 1, 12, 1) : bahia(d.ano, d.mes - 1, 1);
  }
  const decorrido = agora.getTime() - inicio.getTime();
  const fimAnterior = new Date(Math.min(inicio.getTime(), inicioAnterior.getTime() + decorrido));
  return { inicio, fim: agora, inicioAnterior, fimAnterior };
}

// ---------------------------------------------------------------- ranking

export const CRITERIOS = ['agendamentos', 'comparecimentos', 'valor', 'conversao', 'tempo'] as const;
export type Criterio = (typeof CRITERIOS)[number];

export interface LinhaRanking {
  id: string;
  nome: string;
  posicao: number;
  agendamentos: number;
  comparecimentos: number;
  valor: number;
  /** Agendamentos ÷ conversas que ela atendeu, em %. */
  conversao: number | null;
  /** Média da 1ª resposta dela, em segundos. */
  tempoSeg: number | null;
  /** Posição no período anterior (null = não estava). */
  posicaoAnterior: number | null;
  /** + subiu, − desceu, 0 igual, null = estreia. */
  variacao: number | null;
  medalha: 'ouro' | 'prata' | 'bronze' | null;
  meta: { agendamentos: number | null; valor: number | null; progressoPct: number | null };
}

interface Numeros {
  id: string;
  nome: string;
  agendamentos: number;
  comparecimentos: number;
  valor: number;
  conversas: number;
  primeiraMs: number;
  primeiraN: number;
}

function numerosPorAtendente(vendas: Venda[], atend: Atendimento[], pessoas: Pessoa[], cfg: ConfigComercial): Map<string, Numeros> {
  const m = new Map<string, Numeros>();
  const de = (id: string, nome: string) => {
    let n = m.get(id);
    if (!n) {
      n = { id, nome, agendamentos: 0, comparecimentos: 0, valor: 0, conversas: 0, primeiraMs: 0, primeiraN: 0 };
      m.set(id, n);
    }
    return n;
  };
  for (const p of pessoas) de(p.id, p.nome);
  for (const v of vendas) {
    if (!v.atendenteId) continue; // o ranking é das atendentes: o que a IA agendou fica fora
    const n = de(v.atendenteId, v.atendenteNome ?? 'Atendente');
    n.agendamentos++;
    if (v.compareceu) {
      n.comparecimentos++;
      n.valor = centavos(n.valor + valorDe(v, cfg.precos));
    }
  }
  for (const a of atend) {
    const n = de(a.id, a.nome);
    n.conversas += a.conversas;
    n.primeiraMs += a.primeiraMs;
    n.primeiraN += a.primeiraN;
  }
  return m;
}

const valorCriterio = (n: Numeros, c: Criterio): number => {
  if (c === 'agendamentos') return n.agendamentos;
  if (c === 'comparecimentos') return n.comparecimentos;
  if (c === 'valor') return n.valor;
  if (c === 'conversao') return n.conversas ? n.agendamentos / n.conversas : -1;
  return n.primeiraN ? -(n.primeiraMs / n.primeiraN) : -Infinity; // tempo: menor é melhor
};

function ordenar(lista: Numeros[], c: Criterio): Numeros[] {
  return lista.slice().sort((a, b) => valorCriterio(b, c) - valorCriterio(a, c) || b.agendamentos - a.agendamentos || a.nome.localeCompare(b.nome, 'pt-BR'));
}

export interface EntradaRanking {
  atual: { vendas: Venda[]; atendimento: Atendimento[] };
  anterior: { vendas: Venda[]; atendimento: Atendimento[] };
  pessoas: Pessoa[];
  cfg: ConfigComercial;
  criterio: Criterio;
  /** Escala da meta mensal para o período (1 = mês; o dia usa 1/dias do mês etc.). */
  fatorMeta?: number;
}

export function montarRanking(e: EntradaRanking): LinhaRanking[] {
  const atual = ordenar([...numerosPorAtendente(e.atual.vendas, e.atual.atendimento, e.pessoas, e.cfg).values()], e.criterio);
  const anteriorMapa = numerosPorAtendente(e.anterior.vendas, e.anterior.atendimento, e.pessoas, e.cfg);
  const ativoAntes = (n: Numeros) => n.agendamentos || n.conversas || n.comparecimentos;
  const anterior = ordenar([...anteriorMapa.values()].filter(ativoAntes), e.criterio);
  const posAntes = new Map(anterior.map((n, i) => [n.id, i + 1]));
  const fator = e.fatorMeta ?? 1;
  return atual.map((n, i) => {
    const posicao = i + 1;
    const pa = posAntes.get(n.id) ?? null;
    const meta = e.cfg.metas.atendentes[n.id] ?? {};
    const mAg = meta.agendamentos ? Math.max(1, Math.round(meta.agendamentos * fator)) : null;
    const mVal = meta.valor ? centavos(meta.valor * fator) : null;
    const prog = mAg ? (n.agendamentos / mAg) * 100 : mVal ? (n.valor / mVal) * 100 : null;
    const temAlgo = n.agendamentos > 0 || n.comparecimentos > 0 || n.valor > 0;
    return {
      id: n.id,
      nome: n.nome,
      posicao,
      agendamentos: n.agendamentos,
      comparecimentos: n.comparecimentos,
      valor: n.valor,
      conversao: n.conversas ? Math.round((n.agendamentos / n.conversas) * 1000) / 10 : null,
      tempoSeg: n.primeiraN ? Math.round(n.primeiraMs / n.primeiraN / 1000) : null,
      posicaoAnterior: pa,
      variacao: pa === null ? null : pa - posicao,
      medalha: temAlgo && posicao <= 3 ? (['ouro', 'prata', 'bronze'] as const)[i]! : null,
      meta: { agendamentos: mAg, valor: mVal, progressoPct: prog === null ? null : Math.round(prog * 10) / 10 },
    };
  });
}

// ---------------------------------------------------------------- serviços mais agendados

export interface LinhaServico {
  servico: string;
  agendamentos: number;
  compareceram: number;
  valor: number;
  porUnidade: Record<string, number>;
}

export function servicosMaisAgendados(vendas: Venda[], cfg: ConfigComercial): LinhaServico[] {
  const m = new Map<string, LinhaServico>();
  for (const v of vendas) {
    const nome = v.servico?.trim() || 'Sem serviço informado';
    const k = normalizar(nome);
    let s = m.get(k);
    if (!s) {
      s = { servico: nome, agendamentos: 0, compareceram: 0, valor: 0, porUnidade: {} };
      m.set(k, s);
    }
    s.agendamentos++;
    s.porUnidade[v.unidade] = (s.porUnidade[v.unidade] ?? 0) + 1;
    // Valor previsto do que foi agendado (o comparecido entra no ranking e na comissão).
    s.valor = centavos(s.valor + valorDe(v, cfg.precos));
    if (v.compareceu) s.compareceram++;
  }
  return [...m.values()].sort((a, b) => b.agendamentos - a.agendamentos || b.valor - a.valor || a.servico.localeCompare(b.servico, 'pt-BR'));
}

// ---------------------------------------------------------------- metas

export interface ProgressoMeta {
  agendamentos: number;
  valor: number;
  meta: { agendamentos: number | null; valor: number | null };
  pctAgendamentos: number | null;
  pctValor: number | null;
}

const pct = (a: number, b: number | null | undefined) => (b ? Math.round((a / b) * 1000) / 10 : null);

export function progresso(vendas: Venda[], meta: Meta | undefined, cfg: ConfigComercial): ProgressoMeta {
  const valor = centavos(vendas.filter((v) => v.compareceu).reduce((s, v) => s + valorDe(v, cfg.precos), 0));
  const mAg = meta?.agendamentos ?? null;
  const mVal = meta?.valor ?? null;
  return { agendamentos: vendas.length, valor, meta: { agendamentos: mAg, valor: mVal }, pctAgendamentos: pct(vendas.length, mAg), pctValor: pct(valor, mVal) };
}

/** Meta da equipe: a definida; se não houver, a soma das metas individuais. */
export function metaDaEquipe(cfg: ConfigComercial): Meta {
  const e = cfg.metas.equipe;
  if (e.agendamentos || e.valor) return e;
  const ind = Object.values(cfg.metas.atendentes);
  const ag = ind.reduce((s, m) => s + (m.agendamentos ?? 0), 0);
  const val = ind.reduce((s, m) => s + (m.valor ?? 0), 0);
  return { agendamentos: ag || null, valor: val || null };
}

export function progressoMetas(vendasMes: Venda[], cfg: ConfigComercial, pessoas: Pessoa[], unidades: string[]) {
  return {
    equipe: progresso(vendasMes, metaDaEquipe(cfg), cfg),
    unidades: Object.fromEntries(unidades.map((u) => [u, progresso(vendasMes.filter((v) => v.unidade === u), cfg.metas.unidades[u], cfg)])),
    atendentes: pessoas.map((p) => ({
      id: p.id,
      nome: p.nome,
      ...progresso(vendasMes.filter((v) => v.atendenteId === p.id), cfg.metas.atendentes[p.id], cfg),
    })),
  };
}

/** Primeiro nome só (a TV nunca mostra sobrenome, telefone ou conversa). */
export function primeiroNome(nome: string | null | undefined): string | null {
  const p = (nome ?? '').trim().split(/\s+/)[0];
  if (!p || /\d/.test(p)) return null;
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}
