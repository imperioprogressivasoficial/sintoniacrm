import { formatarTelefoneBR } from '../leads/telefone-br.js';

/**
 * Nome do contato (pedido do dono 21/11): "se o contato do WhatsApp já tem nome, puxe o nome; não deixe só o número.
 * Se o nome for muito grande, corta para não dar bug."
 *
 * Regra única, usada no webhook, na rotina que preenche os antigos e na tela:
 * - "nome de verdade" = tem pelo menos uma letra (de qualquer idioma) depois da limpeza. Só dígitos, símbolos,
 *   pontos, emojis ou o próprio telefone (com ou sem +55, máscara...) NÃO são nome.
 * - Nome de verdade nunca é trocado pelo nome do WhatsApp: pode ter sido digitado pela equipe.
 * - Nome que não é de verdade (vazio, o número, "...") é trocado pelo do WhatsApp quando ele chega.
 */

/** Tamanho máximo de um nome vindo do WhatsApp (o perfil aceita textos enormes). */
export const MAX_NOME = 60;

// Caracteres invisíveis: controle, formatação (zero-width, marcas de direção), separadores de linha e o "preenchimento Hangul" que
// alguns usam para deixar o nome "em branco".
const INVISIVEIS = /[\p{Cc}\p{Cf}\u2028\u2029\u115F\u1160\u3164\uFFA0\u034F\u180E]/gu;
const LETRA = /\p{L}/u;

/** Tira invisíveis, junta os espaços e corta em `max` caracteres (sem partir emoji ao meio). */
export function limparNome(bruto: string | null | undefined, max = MAX_NOME): string {
  const t = String(bruto ?? '')
    .normalize('NFC')
    .replace(INVISIVEIS, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const letras = Array.from(t);
  return letras.length > max ? letras.slice(0, max).join('').trim() : t;
}

/** Tem letra e não é o telefone? Então é um nome de verdade (pode ter sido digitado pela equipe). */
export function nomeEhReal(nome: string | null | undefined): boolean {
  return LETRA.test(limparNome(nome, 10_000));
}

/**
 * Nome do perfil do WhatsApp (pushName) pronto para gravar, ou undefined se não serve:
 * vazio, só pontos/emojis/símbolos, ou o número. Corta em 60 caracteres.
 */
export function nomeDoWhatsapp(bruto: string | null | undefined): string | undefined {
  const n = limparNome(bruto);
  if (!n || !LETRA.test(n)) return undefined;
  // "@lid"/JID no lugar do nome (acontece em algumas versões da Evolution).
  if (/@(s\.whatsapp\.net|lid|g\.us|c\.us)\b/i.test(n)) return undefined;
  return n;
}

/**
 * O nome que a conversa deve passar a ter, quando chega um nome do WhatsApp; undefined = deixa como está.
 * Só troca quando o nome atual não é de verdade (vazio, número, símbolos).
 */
export function nomeParaTrocar(atual: string | null | undefined, doWhatsapp: string | null | undefined): string | undefined {
  if (nomeEhReal(atual)) return undefined;
  const novo = nomeDoWhatsapp(doWhatsapp);
  if (!novo || novo === atual) return undefined;
  return novo;
}

/** Para mostrar em texto (avisos, notas, relatórios): o nome, ou o telefone no padrão "+55 (71) 99220-0365". */
export function nomeOuTelefone(nome: string | null | undefined, telefone: string | null | undefined): string {
  if (nomeEhReal(nome)) return limparNome(nome, 120);
  return telefone ? formatarTelefoneBR(telefone) : limparNome(nome) || 'Cliente';
}
