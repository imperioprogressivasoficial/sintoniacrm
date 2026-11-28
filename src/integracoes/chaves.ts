import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PREFIXO_CHAVE } from './catalogo.js';

/**
 * Chaves de API: `sk_<id público de 10 letras>_<segredo de 32 bytes>`.
 * - O id público (com o "sk_") fica guardado aberto e aparece na tela, para a pessoa reconhecer a chave.
 * - A chave inteira só aparece uma vez, ao criar. No banco fica só o SHA-256 dela (o segredo tem 256 bits
 *   de acaso, então um hash lento como o scrypt não acrescenta proteção e deixaria cada chamada mais lenta).
 * - A conferência é em tempo constante e a chave inteira nunca vai para o log.
 */

const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';
const TAMANHO_ID = 10;
const FORMATO = /^sk_([a-z2-9]{10})_([A-Za-z0-9_-]{43})$/;

function idAleatorio(): string {
  const b = randomBytes(TAMANHO_ID);
  let s = '';
  for (const x of b) s += ALFABETO[x % ALFABETO.length];
  return s;
}

export const hashDaChave = (chave: string) => createHash('sha256').update(`sintonia-api:${chave}`).digest('hex');

export interface ChaveGerada {
  /** Mostrada uma vez só. */
  chave: string;
  /** "sk_abcdefghij": fica aberto, serve para achar a chave e aparece na tela. */
  prefixo: string;
  hash: string;
}

export function gerarChave(): ChaveGerada {
  const prefixo = `${PREFIXO_CHAVE}${idAleatorio()}`;
  const chave = `${prefixo}_${randomBytes(32).toString('base64url')}`;
  return { chave, prefixo, hash: hashDaChave(chave) };
}

/** Separa o prefixo de uma chave recebida (undefined = formato inválido). */
export function prefixoDe(chave: string): string | undefined {
  const m = FORMATO.exec(chave);
  return m ? `${PREFIXO_CHAVE}${m[1]}` : undefined;
}

/** Compara o hash da chave recebida com o guardado, em tempo constante. */
export function hashConfere(chave: string, guardado: string): boolean {
  const a = Buffer.from(hashDaChave(chave), 'hex');
  const b = Buffer.from(guardado, 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** Chave mascarada para logs e telas: só o prefixo e os 4 últimos caracteres. */
export function mascarar(chave: string): string {
  const p = prefixoDe(chave);
  return p ? `${p}_…${chave.slice(-4)}` : `${chave.slice(0, 6)}…`;
}

/** Lê o "Authorization: Bearer sk_..." (ou "x-api-key"). */
export function chaveDoCabecalho(headers: Record<string, unknown>): string | undefined {
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  const x = headers['x-api-key'];
  return typeof x === 'string' && x.trim() ? x.trim() : undefined;
}

// ------------------------------------------------------------------ assinatura dos webhooks

export const gerarSegredoWebhook = () => `whsec_${randomBytes(32).toString('base64url')}`;

/** HMAC-SHA256 (hex) de `${timestamp}.${corpo}` com o segredo do webhook. */
export function assinar(segredo: string, timestamp: number, corpo: string): string {
  return createHmac('sha256', segredo).update(`${timestamp}.${corpo}`).digest('hex');
}

/** Valor do cabeçalho Sintonia-Assinatura: "t=<segundos>,v1=<hex>". */
export const cabecalhoAssinatura = (segredo: string, timestamp: number, corpo: string) => `t=${timestamp},v1=${assinar(segredo, timestamp, corpo)}`;

/**
 * Confere uma assinatura (o mesmo que o código de exemplo da documentação faz do lado de quem recebe).
 * Recusa assinatura velha (mais de `toleranciaSeg`) para ninguém reaproveitar um envio antigo.
 */
export function assinaturaValida(segredo: string, cabecalho: string | undefined, corpo: string, agoraSeg: number, toleranciaSeg = 300): boolean {
  if (!cabecalho) return false;
  const partes = Object.fromEntries(cabecalho.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(partes.t);
  if (!Number.isFinite(t) || Math.abs(agoraSeg - t) > toleranciaSeg || !partes.v1) return false;
  const a = Buffer.from(assinar(segredo, t, corpo), 'hex');
  const b = Buffer.from(partes.v1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
