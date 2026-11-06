/**
 * Normaliza telefone brasileiro para o formato com DDI, só dígitos: 55 + DDD + 9 + 8 dígitos.
 * Mesma regra já usada nos fluxos de cashback/aniversário do n8n:
 * - 10 ou 11 dígitos ganham o 55 na frente;
 * - celular antigo sem o 9 (12 dígitos começando em 6-9 após o DDD) ganha o 9;
 * - só aceita celular (13 dígitos com 9 após o DDD).
 * Retorna null quando não dá para ter certeza.
 */
export function normalizarCelular(bruto: string | null | undefined): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length === 12) {
    const local = d.slice(4);
    if (/^[6-9]/.test(local)) d = d.slice(0, 4) + '9' + local;
  }
  if (d.length !== 13 || !d.startsWith('55')) return null;
  if (d[4] !== '9') return null;
  return d;
}

/** Extrai o número de um JID do WhatsApp ("5571988124471@s.whatsapp.net"). Ignora grupos. */
export function telefoneDoJid(jid: string): string | null {
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return null;
  const numero = jid.split('@')[0]?.split(':')[0] ?? '';
  return normalizarCelular(numero);
}

/** Separa DDD e número para o cadastro de cliente no Trinks. */
export function partesTrinks(telefone: string): { ddi: string; ddd: string; numero: string } {
  return { ddi: telefone.slice(0, 2), ddd: telefone.slice(2, 4), numero: telefone.slice(4) };
}
