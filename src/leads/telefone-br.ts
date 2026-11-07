/**
 * Telefone brasileiro para importação e controle de duplicatas.
 *
 * Diferente de util/telefone.ts (que só aceita celular, como chega do WhatsApp), aqui a entrada vem de
 * planilha: "+55 (71) 98812-4471", "71 8812-4471" (sem o 9), "071988124471", "0 41 71 98812 4471"...
 * Tudo vira 55 + DDD + número, só dígitos: 13 dígitos para celular, 12 para fixo.
 */

/** DDDs em uso no Brasil (Anatel). */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53,
  54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96,
  97, 98, 99,
]);

export type TelefoneNormalizado =
  | { ok: true; telefone: string; tipo: 'celular' | 'fixo'; /** O que foi corrigido (para o relatório da importação). */ ajuste?: string }
  | { ok: false; motivo: string };

export interface OpcoesTelefone {
  /** DDD usado quando o número vem sem DDD (8 ou 9 dígitos). Sem ele, o número é recusado. */
  dddPadrao?: string;
}

export function normalizarTelefoneBR(bruto: string | number | null | undefined, o: OpcoesTelefone = {}): TelefoneNormalizado {
  const texto = String(bruto ?? '').trim();
  let d = texto.replace(/\D/g, '');
  if (!d) return { ok: false, motivo: 'Sem telefone' };
  const ajustes: string[] = [];
  const comMais = texto.startsWith('+');
  if (d.startsWith('00')) d = d.slice(2); // discagem internacional (00 55 ...)
  if (comMais && !d.startsWith('55')) return { ok: false, motivo: 'Número de fora do Brasil' };
  // Prefixo de operadora (0 + 2 dígitos + DDD + número) e o 0 de longa distância.
  if (d.startsWith('0') && (d.length === 13 || d.length === 14)) d = d.slice(3);
  else if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.length === 8 || d.length === 9) {
    const ddd = (o.dddPadrao ?? '').replace(/\D/g, '');
    if (!ddd) return { ok: false, motivo: 'Sem DDD' };
    d = ddd + d;
    ajustes.push(`DDD ${ddd} incluído`);
  }
  if (d.length === 10 || d.length === 11) d = '55' + d; // o 55 que falta não é aviso: é o normal na planilha
  if ((d.length !== 12 && d.length !== 13) || !d.startsWith('55')) return { ok: false, motivo: 'Telefone com quantidade de dígitos inválida' };
  const ddd = Number(d.slice(2, 4));
  if (!DDDS.has(ddd)) return { ok: false, motivo: `DDD ${d.slice(2, 4)} não existe` };
  let local = d.slice(4);
  if (local.length === 8) {
    if (/^[6-9]/.test(local)) {
      local = '9' + local;
      ajustes.push('9º dígito incluído');
    } else if (/^[2-5]/.test(local)) {
      return { ok: true, telefone: `55${d.slice(2, 4)}${local}`, tipo: 'fixo', ajuste: ajustes.join(', ') || undefined };
    } else return { ok: false, motivo: 'Telefone inválido' };
  } else if (local[0] !== '9') return { ok: false, motivo: 'Celular precisa começar com 9 depois do DDD' };
  return { ok: true, telefone: `55${d.slice(2, 4)}${local}`, tipo: 'celular', ajuste: ajustes.join(', ') || undefined };
}

/**
 * Chave para comparar telefones: o mesmo número com ou sem 55, com ou sem o 9º dígito, com máscara ou não
 * dá a mesma chave. Número que não normaliza fica só com os dígitos.
 */
export function chaveTelefone(t: string | null | undefined): string {
  const n = normalizarTelefoneBR(t);
  return n.ok ? n.telefone : String(t ?? '').replace(/\D/g, '');
}

/** "+55 (71) 98812-4471" para mostrar. */
export function formatarTelefoneBR(t: string): string {
  const d = t.replace(/\D/g, '');
  if (d.length === 13) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return t;
}
