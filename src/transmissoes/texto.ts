import { normalizar } from '../automacoes/esquema.js';
import { partesBahia } from '../util/tempo.js';
import type { Envio, Variavel } from './tipos.js';

/** Dados de uma pessoa para preencher a mensagem. */
export interface DadosPessoa {
  nome?: string | null;
  telefone: string;
  unidade: string;
  /** Campos personalizados da ficha: nome do campo (e id) → valor. */
  campos?: Record<string, string | number | boolean | null | undefined>;
}

/** Sorteio com semente (mesma pessoa, mesma variação; teste reprodutível). */
export function sorteador(semente: string): () => number {
  let h = 2166136261;
  for (const ch of semente) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Variações {Oi|Olá|Oie}: cada grupo com "|" vira uma das opções. Grupos podem ficar um dentro do outro. */
export function variar(texto: string, aleatorio: () => number = Math.random): string {
  let t = texto;
  for (let i = 0; i < 20; i++) {
    const novo = t.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, grupo: string) => {
      const opcoes = grupo.split('|');
      return opcoes[Math.floor(aleatorio() * opcoes.length)] ?? '';
    });
    if (novo === t) break;
    t = novo;
  }
  return t;
}

const primeiroNome = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] ?? '';
const capitalizar = (s: string) => s.toLowerCase().replace(/(^|\s)\p{L}/gu, (x) => x.toUpperCase());

/** Valor de uma fonte: primeiro_nome, nome, unidade, telefone, campo:<nome ou id>, fixo:<texto>. */
export function valorDaFonte(fonte: string, p: DadosPessoa): string {
  if (fonte === 'primeiro_nome') return capitalizar(primeiroNome(p.nome));
  if (fonte === 'nome') return (p.nome ?? '').trim();
  if (fonte === 'unidade') return p.unidade;
  if (fonte === 'telefone') return p.telefone;
  if (fonte.startsWith('fixo:')) return fonte.slice(5);
  if (fonte.startsWith('campo:')) {
    const chave = fonte.slice(6);
    const v = p.campos?.[chave] ?? Object.entries(p.campos ?? {}).find(([k]) => normalizar(k) === normalizar(chave))?.[1];
    return v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v);
  }
  return '';
}

/** Texto livre (API não oficial): troca {primeiro_nome} {nome} {unidade} {campo:X} e sorteia as variações. */
export function montarTexto(texto: string, p: DadosPessoa, aleatorio: () => number = Math.random): string {
  const comVars = texto.replace(/\{(primeiro_nome|nome|unidade|telefone|campo:[^{}|]+)\}/g, (_, f: string) => valorDaFonte(f, p));
  return variar(comVars, aleatorio)
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Parâmetros {{1}}, {{2}}... do modelo (nunca vazios: a Meta recusa parâmetro vazio). */
export function parametrosDoModelo(variaveis: Variavel[], p: DadosPessoa): string[] {
  return variaveis.map((v) => valorDaFonte(v.fonte, p).trim() || v.padrao.trim() || '-');
}

/** Quantas variáveis {{n}} o corpo do modelo tem. */
export const contarVariaveis = (corpo: string) => new Set([...corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => x[1])).size;

/** Corpo do modelo com as variáveis preenchidas (é o que fica na conversa). */
export const preencherModelo = (corpo: string, params: string[]) => corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);

const SAIR = ['sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover', 'parar promocoes', 'nao quero mais', 'nao quero receber', 'nao envie mais', 'me tire da lista', 'sair da lista'];
/** A cliente pediu para sair? Só a mensagem inteira (com ou sem pontuação): "SAIR", "Parar!", "não quero mais". */
export function ehDescadastro(texto: string): boolean {
  const t = normalizar(texto);
  return SAIR.includes(t);
}

/** Está dentro da janela de envio (hora da Bahia)? */
export function dentroDaJanela(e: Pick<Envio, 'janelaInicio' | 'janelaFim' | 'domingo'>, agora: Date): boolean {
  const p = partesBahia(agora);
  if (p.diaSemana === 0 && !e.domingo) return false;
  return p.hora >= e.janelaInicio && p.hora < e.janelaFim;
}

/**
 * Espera depois de um envio, em ms. Oficial: 60 s / por minuto. Não oficial: sorteio entre o mínimo e o máximo.
 * A cada `pausaCada` envios seguidos, soma a pausa longa.
 */
export function esperaDepois(e: Envio, oficial: boolean, seguidos: number, aleatorio: () => number = Math.random): { ms: number; pausou: boolean } {
  let ms: number;
  if (oficial) ms = Math.ceil(60_000 / e.porMinuto);
  else {
    const min = Math.min(e.intervaloMin, e.intervaloMax);
    const max = Math.max(e.intervaloMin, e.intervaloMax);
    ms = Math.round((min + aleatorio() * (max - min)) * 1000);
  }
  const pausou = e.pausaCada > 0 && e.pausaMin > 0 && seguidos > 0 && seguidos % e.pausaCada === 0;
  if (pausou) ms += e.pausaMin * 60_000;
  return { ms, pausou };
}
