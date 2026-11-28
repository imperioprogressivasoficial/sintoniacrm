import { normalizar } from './esquema.js';

/**
 * pos-venda: cuidados das automações de relacionamento (opção respeitar_limites).
 */

const digitos = (t: string) => String(t ?? '').replace(/\D/g, '');
/** Grupo do WhatsApp: id "...@g.us" ou "1203630…-…" (muito mais longo que um telefone). Igual ao do relatório do dia. */
export const ehGrupo = (telefone: string) => /@g\.us$|-/.test(String(telefone ?? '')) || digitos(telefone).length > 15;

/*
 * "Não quero mais receber mensagens" dito de vários jeitos. Além das palavras soltas (quase as mesmas das transmissões ("SAIR",
 * "PARAR", "não quero mais")), frases dentro da mensagem: "para de me mandar mensagem", "não me mande mais",
 * "me tira dessa lista". Cuidado com falso positivo: "não quero mais esperar" não conta (precisa falar de mensagem
 * ou de receber/mandar).
 */
const FRASES = [
  /\bnao (quero|desejo|gostaria de) (mais )?receber\b/,
  /\b(para|pare|parem|parar) de (me )?(mandar|enviar|chamar)\b/,
  /\bnao (me )?(mande|mandem|envie|enviem|manda|chamem|chame) mais\b/,
  /\b(me )?(tire|tira|tirem|remova|remove|removam|exclua|exclui) (da|dessa|desta|de sua|da sua) lista\b/,
  /\bnao quero mais (mensage(m|ns)|propaganda|promocao|promocoes|contato)\b/,
  /\bsem mais mensage(m|ns)\b/,
];

/** Mensagem inteira (como nas transmissões, sem "cancelar"/"remover": ali podem ser sobre o horário). */
const SOZINHAS = ['sair', 'parar', 'pare', 'stop', 'descadastrar', 'parar promocoes', 'nao quero mais', 'nao quero receber', 'nao envie mais', 'me tire da lista', 'sair da lista'];

/** A cliente pediu para não receber mais mensagens (automáticas, de relacionamento)? */
export function pediuParaNaoReceber(texto: string): boolean {
  if (!texto?.trim()) return false;
  const t = normalizar(texto);
  if (SOZINHAS.includes(t)) return true;
  return FRASES.some((r) => r.test(t));
}
