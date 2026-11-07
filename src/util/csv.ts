/**
 * CSV para abrir no Excel em português: UTF-8 com BOM (acentos certos), separador ";" e quebra CRLF.
 * Células que começam com = + - @ ganham um apóstrofo para o Excel não executar fórmula (injeção de CSV).
 */

export type Celula = string | number | boolean | null | undefined | Date;

const BOM = '﻿';

function celula(v: Celula): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'boolean' ? (v ? 'sim' : 'não') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function gerarCsv(cabecalho: string[], linhas: Celula[][]): string {
  return BOM + [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n';
}

/** Nome de arquivo seguro para o cabeçalho Content-Disposition. */
export function nomeArquivo(base: string): string {
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}
