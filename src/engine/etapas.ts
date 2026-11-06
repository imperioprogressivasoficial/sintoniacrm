import type { Etapa } from '../domain.js';

/**
 * Funil automático. Ninguém arrasta card: a etapa muda por eventos.
 * Os momentos que valem dinheiro (Agendada, Compareceu) vêm de fatos do Trinks,
 * nunca da opinião da IA.
 */
export type EventoFunil =
  | { tipo: 'mensagem_cliente' }
  | { tipo: 'ia_classificou'; etapa: Etapa }
  | { tipo: 'agendamento_criado' }
  | { tipo: 'agendamento_cancelado' }
  | { tipo: 'atendimento_finalizado' }
  | { tipo: 'cliente_faltou' }
  | { tipo: 'manutencao_vencida' }
  | { tipo: 'followups_esgotados' };

/** Etapas que a IA pode escolher pela conversa. */
export const ETAPAS_DA_IA: readonly Etapa[] = ['em_conversa', 'interessada', 'perdida'];

/** Etapas que só mudam por fato do Trinks; a IA não tira a cliente delas. */
const PROTEGIDAS: readonly Etapa[] = ['agendada', 'compareceu'];

export function proximaEtapa(atual: Etapa, evento: EventoFunil): Etapa {
  switch (evento.tipo) {
    case 'mensagem_cliente':
      // Cliente que volta a falar sai de "Novo lead", "Perdida" ou "Manutenção" para conversa ativa.
      if (atual === 'novo_lead' || atual === 'perdida' || atual === 'manutencao') return 'em_conversa';
      return atual;
    case 'ia_classificou':
      if (!ETAPAS_DA_IA.includes(evento.etapa)) return atual;
      if (PROTEGIDAS.includes(atual)) return atual;
      return evento.etapa;
    case 'agendamento_criado':
      return 'agendada';
    case 'agendamento_cancelado':
      return atual === 'agendada' ? 'interessada' : atual;
    case 'atendimento_finalizado':
      return 'compareceu';
    case 'cliente_faltou':
      // Faltou: volta para Interessada e entra no fluxo de recuperação.
      return 'interessada';
    case 'manutencao_vencida':
      return atual === 'compareceu' ? 'manutencao' : atual;
    case 'followups_esgotados':
      return PROTEGIDAS.includes(atual) ? atual : 'perdida';
  }
}
