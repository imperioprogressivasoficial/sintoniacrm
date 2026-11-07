import type { DiaSemana, Faixa } from '../unidades.js';
import { minutosDoDia, partesBahia } from '../util/tempo.js';

/**
 * Modelo de negócio da IA (docs/PLANOS.md). O CRM é grátis; a IA é uma assinatura com cota mensal,
 * no horário de um atendente CLT, pela METADE do custo dele. Fora do horário é um adicional; passou da cota, recarga.
 *
 * TODOS os valores abaixo são SUGESTÃO para o dono ajustar (salário, encargos, cotas, recargas, câmbio, margens).
 * As fórmulas ficam em funções puras para a tela, o porteiro e os testes usarem as mesmas contas.
 */

export type PlanoId = 'gratis' | 'expediente' | 'fundador';
export type Janela = Partial<Record<DiaSemana, Faixa>>;

/** Custo de um atendente CLT (base do preço). SUGESTÃO. */
export interface CustoClt {
  /** Salário bruto mensal (R$). */
  salario: number;
  /** Encargos e provisões sobre o salário (INSS patronal, FGTS, 13º, férias + 1/3, etc.), em %. */
  encargosPct: number;
  /** Benefícios mensais (vale-transporte, refeição...), R$. */
  beneficios: number;
  /** Carga semanal (h). */
  horasSemana: number;
}

/** Preço de API por milhão de tokens, em US$ (tabela da Anthropic, out/2026). */
export interface PrecoModelo {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export interface ConfigPlanos {
  clt: CustoClt;
  /** Fração do custo CLT cobrada pelo plano IA Expediente (0,5 = metade). */
  fatorPreco: number;
  /** Adicional "Fora do horário" (noite, madrugada, domingo e feriado), em % do plano base. */
  adicionalForaPct: number;
  /** Cota extra que o adicional dá, em % da cota base (a IA trabalha mais horas, gasta mais). */
  adicionalCotaPct: number;
  /** Cota mensal do plano IA Expediente. */
  cotaTokens: number;
  /** Estimativa de conversas que a cota cobre (informativo; o limite é em tokens). */
  cotaConversas: number;
  /** Janela do plano: o expediente CLT (44 h: seg–sex 8h–16h, sáb 8h–12h). */
  janela: Janela;
  /** Feriados: "MM-DD" (todo ano) ou "AAAA-MM-DD". Contam como fora do horário. */
  feriados: string[];
  /** Câmbio usado no custo estimado (R$ por US$). */
  cambio: number;
  precos: Record<string, PrecoModelo>;
  /** Pacotes de recarga. */
  recargas: Recarga[];
}

export interface Recarga {
  id: string;
  nome: string;
  tokens: number;
  preco: number;
}

export interface Plano {
  id: PlanoId;
  nome: string;
  descricao: string;
  ia: boolean;
  /** Preço mensal (R$); null = não se aplica (fundador). */
  preco: number | null;
  /** Cota mensal de tokens; null = ilimitada. */
  cotaTokens: number | null;
  cotaConversas: number | null;
  /** Horas por semana cobertas pela janela (sem adicional). */
  horasSemana: number;
  /** Fundador: IA sem cota, 24 h, sem cobrança (conta original). */
  ilimitado?: boolean;
  sugestao: boolean;
}

/** Expediente CLT de 44 h. SUGESTÃO. */
export const JANELA_CLT: Janela = {
  1: { abre: '08:00', fecha: '16:00' },
  2: { abre: '08:00', fecha: '16:00' },
  3: { abre: '08:00', fecha: '16:00' },
  4: { abre: '08:00', fecha: '16:00' },
  5: { abre: '08:00', fecha: '16:00' },
  6: { abre: '08:00', fecha: '12:00' },
};

/** Feriados nacionais de data fixa. SUGESTÃO (Carnaval, Paixão e Corpus Christi mudam a cada ano: inclua como AAAA-MM-DD). */
export const FERIADOS_NACIONAIS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/** Valores iniciais. TODOS SÃO SUGESTÃO: o dono ajusta em src/planos/catalogo.ts ou na tela (custo CLT). */
export const CONFIG_SUGERIDA: ConfigPlanos = {
  clt: { salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 44 },
  fatorPreco: 0.5,
  adicionalForaPct: 50,
  adicionalCotaPct: 50,
  cotaTokens: 40_000_000,
  cotaConversas: 1500,
  janela: JANELA_CLT,
  feriados: FERIADOS_NACIONAIS,
  cambio: 5.5,
  precos: {
    'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
    'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
    'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 },
  },
  recargas: [
    { id: 'r5', nome: '+5 milhões de tokens', tokens: 5_000_000, preco: 99 },
    { id: 'r20', nome: '+20 milhões de tokens', tokens: 20_000_000, preco: 349 },
    { id: 'r50', nome: '+50 milhões de tokens', tokens: 50_000_000, preco: 790 },
  ],
};

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Custo mensal de um CLT = salário × (1 + encargos) + benefícios. */
export function custoMensalClt(c: CustoClt): number {
  return centavos(c.salario * (1 + c.encargosPct / 100) + c.beneficios);
}

/** Horas por semana de uma janela. */
export function horasDaJanela(j: Janela): number {
  let min = 0;
  for (const f of Object.values(j)) if (f) min += Math.max(0, minutosDoDia(f.fecha) - minutosDoDia(f.abre));
  return Math.round((min / 60) * 10) / 10;
}

export function precoExpediente(cfg: ConfigPlanos): number {
  return centavos(custoMensalClt(cfg.clt) * cfg.fatorPreco);
}

export function precoAdicionalFora(cfg: ConfigPlanos): number {
  return centavos(precoExpediente(cfg) * (cfg.adicionalForaPct / 100));
}

export function catalogo(cfg: ConfigPlanos): Plano[] {
  return [
    { id: 'gratis', nome: 'Grátis', descricao: 'CRM completo, sem IA: a equipe atende tudo.', ia: false, preco: 0, cotaTokens: 0, cotaConversas: 0, horasSemana: 0, sugestao: true },
    {
      id: 'expediente',
      nome: 'IA Expediente',
      descricao: `A IA no horário de um atendente CLT (${horasDaJanela(cfg.janela)} h por semana) pela metade do custo dele.`,
      ia: true,
      preco: precoExpediente(cfg),
      cotaTokens: cfg.cotaTokens,
      cotaConversas: cfg.cotaConversas,
      horasSemana: horasDaJanela(cfg.janela),
      sugestao: true,
    },
    { id: 'fundador', nome: 'Fundador', descricao: 'Conta fundadora: IA sem limite, 24 h, sem cobrança.', ia: true, preco: null, cotaTokens: null, cotaConversas: null, horasSemana: 168, ilimitado: true, sugestao: false },
  ];
}

export function planoPorId(cfg: ConfigPlanos, id: PlanoId): Plano {
  return catalogo(cfg).find((p) => p.id === id) ?? catalogo(cfg)[0]!;
}

/** Instante dentro da janela (e não é feriado)? */
export function dentroDaJanela(agora: Date, janela: Janela, feriados: string[]): boolean {
  const p = partesBahia(agora);
  const mmdd = `${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
  if (feriados.includes(mmdd) || feriados.includes(`${p.ano}-${mmdd}`)) return false;
  const f = janela[p.diaSemana];
  if (!f) return false;
  const m = p.hora * 60 + p.minuto;
  return m >= minutosDoDia(f.abre) && m < minutosDoDia(f.fecha);
}

export interface Uso {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

/** Tokens que contam na cota: tudo que a API cobra (entrada, saída e cache). */
export const tokensDe = (u: Uso) => u.entrada + u.saida + u.cacheLeitura + u.cacheEscrita;

/** Custo estimado em US$ = Σ tokens × preço por milhão. Modelo desconhecido usa o preço do Opus (o mais caro da tabela). */
export function custoUsd(cfg: ConfigPlanos, modelo: string, u: Uso): number {
  const p = cfg.precos[modelo] ?? Object.entries(cfg.precos).find(([k]) => modelo.startsWith(k))?.[1] ?? cfg.precos['claude-opus-5-5']!;
  return (u.entrada * p.entrada + u.saida * p.saida + u.cacheLeitura * p.cacheLeitura + u.cacheEscrita * p.cacheEscrita) / 1_000_000;
}
