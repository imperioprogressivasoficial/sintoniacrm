import type { ConfigAgente } from './tipos.js';

/**
 * Passagem para a equipe sem depender da IA: confere a última mensagem da cliente contra as condições
 * do agente. Se bater, a IA nem é chamada e a conversa vai para a equipe.
 */

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const RECLAMACAO = /\b(reclama(cao|r|ndo)?|absurdo|pessimo|horrivel|nunca mais|procon|estragou|queimou|caiu (meu|o) cabelo|alergia|reacao alergica|descaso|vergonha)\b/;
const PEDIDO_PESSOA = /\b(falar|conversar|atendimento) (com|c\/) (uma |um |alguem|atendente|pessoa|humano|gerente|responsavel|a dona)|\b(quero|prefiro|pode me passar pra?) (uma |um )?(atendente|pessoa|humano|gerente)\b|\batendente humano\b|\bvoce e (um )?robo\b/;
const IRRITADA = /(!!!|\?\?\?|\b(raiva|irritad[ao]|ridiculo|palhacada|cansei|que saco|to puta|to p\.?|merda|porra|droga)\b)/;

export interface Passagem {
  passar: boolean;
  motivo?: string;
}

export function conferirPassagem(texto: string, p: ConfigAgente['passagem']): Passagem {
  const t = sem(texto);
  if (!t.trim()) return { passar: false };
  if (p.pedidoPessoa && PEDIDO_PESSOA.test(t)) return { passar: true, motivo: 'A cliente pediu para falar com uma pessoa.' };
  if (p.reclamacao && RECLAMACAO.test(t)) return { passar: true, motivo: 'Reclamação da cliente.' };
  if (p.irritada && (IRRITADA.test(t) || (texto.length > 12 && texto === texto.toUpperCase() && /[A-Z]{6,}/.test(texto)))) {
    return { passar: true, motivo: 'A cliente parece irritada.' };
  }
  for (const palavra of p.palavras) {
    if (palavra.trim() && t.includes(sem(palavra.trim()))) return { passar: true, motivo: `A cliente falou "${palavra}".` };
  }
  if (p.valorAcimaDe != null) {
    for (const m of t.matchAll(/r\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/g)) {
      const v = Number(m[1]!.replace(/\./g, '').replace(',', '.'));
      if (v > p.valorAcimaDe) return { passar: true, motivo: `Valor acima de R$ ${p.valorAcimaDe} (cliente citou R$ ${m[1]}).` };
    }
  }
  return { passar: false };
}
