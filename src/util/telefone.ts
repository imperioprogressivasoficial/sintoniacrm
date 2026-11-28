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

/**
 * aud-numeros: número que chegou pelo WhatsApp (já com o código do país, só dígitos), de qualquer país.
 * - Brasil (começa com 55, 12 ou 13 dígitos): celular segue a regra de sempre (normalizarCelular: com/sem o 9),
 *   para não duplicar conversas que já existem; fixo (DDD + 8 dígitos começando com 2-5) passa como veio, sem o 9.
 * - Outros países: aceita como veio, de 8 a 15 dígitos (padrão internacional E.164, sem o +).
 * Antes, número de fora do Brasil ou fixo era descartado e a mensagem sumia sem registro.
 */
export function normalizarTelefoneWhats(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (!d || d.startsWith('0')) return null;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const celular = normalizarCelular(d);
    if (celular) return celular;
    if (d.length === 12 && /^[1-9][0-9][2-5]/.test(d.slice(2))) return d; // fixo brasileiro
    return null;
  }
  if (d.startsWith('55')) return null; // Brasil com quantidade de dígitos errada
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** Extrai o número de um JID do WhatsApp ("5571988124471@s.whatsapp.net"). Ignora grupos. */
export function telefoneDoJid(jid: string): string | null {
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@lid') || jid.endsWith('@newsletter')) return null;
  const numero = jid.split('@')[0]?.split(':')[0] ?? '';
  return normalizarTelefoneWhats(numero);
}

/** Separa DDD e número para o cadastro de cliente no Trinks. */
export function partesTrinks(telefone: string): { ddi: string; ddd: string; numero: string } {
  return { ddi: telefone.slice(0, 2), ddd: telefone.slice(2, 4), numero: telefone.slice(4) };
}
