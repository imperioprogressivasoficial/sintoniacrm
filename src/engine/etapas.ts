import { etapaDoFunil, type Etapa } from '../domain.js';

/**
 * Funil automático. A etapa muda por eventos; os momentos que valem dinheiro (Agendado, Finalizado) vêm de fatos
 * da agenda, nunca da opinião da IA.
 *
 * funil-atendimento (dono 28/11): Novo lead → Em atendimento → Reagendar / Sem resposta → Agendado <unidade> →
 * Finalizado (ou Perdido, sempre com motivo, pela equipe ou pela IA). Cada movimento automático é uma regra que a
 * gestão liga e desliga em Pipeline › Regras automáticas (src/funis/regras-funil.ts). As etapas antigas
 * (novo_lead, interessada, manutencao) valem como a equivalente (etapaDoFunil).
 */
export type EventoFunil =
  | { tipo: 'mensagem_cliente' }
  /** etapa-entrada: a loja (equipe ou IA) respondeu. Tira de "Novo lead". */
  | { tipo: 'primeira_resposta'; clienteEscreveu: boolean }
  | { tipo: 'ia_classificou'; etapa: Etapa }
  | { tipo: 'agendamento_criado' }
  /** funil-atendimento: a IA ou a equipe remarcou (o horário novo já está na agenda). */
  | { tipo: 'agendamento_remarcado' }
  | { tipo: 'agendamento_cancelado' }
  /** funil-atendimento: a cliente pediu para remarcar (confirmação de agenda, tag "Quer remarcar"). */
  | { tipo: 'pediu_remarcar' }
  | { tipo: 'atendimento_finalizado' }
  | { tipo: 'cliente_faltou' }
  | { tipo: 'manutencao_vencida' }
  | { tipo: 'followups_esgotados' };

/** funil-atendimento: regras automáticas do motor (todas ligadas = o padrão). */
export interface RegrasMotor {
  /** Quem estava em Perdido ou Finalizado e escreveu de novo volta para "Novo lead" (para ser respondida). */
  voltouEscrever: boolean;
  /** A loja respondeu: "Novo lead" → "Em atendimento". */
  lojaRespondeu: boolean;
  /** Pediu para remarcar, cancelou ou faltou: → "Reagendar". */
  remarcar: boolean;
  /** Agendou ou remarcou: → "Agendado <unidade>". */
  agendou: boolean;
}
export const REGRAS_MOTOR_PADRAO: RegrasMotor = { voltouEscrever: true, lojaRespondeu: true, remarcar: true, agendou: true };

/** Etapas que a IA pode escolher pela conversa (registrar_etapa e mover_no_funil no funil do sistema). */
export const ETAPAS_DA_IA: readonly Etapa[] = ['em_conversa', 'reagendar', 'perdida'];

/** Etapas que só mudam por fato da agenda; a IA não tira a cliente delas (só para "Reagendar", quando ela não vai). */
const PROTEGIDAS: readonly Etapa[] = ['agendada', 'compareceu'];

export function proximaEtapa(etapaAtual: Etapa, evento: EventoFunil, r: RegrasMotor = REGRAS_MOTOR_PADRAO): Etapa {
  const atual = etapaDoFunil(etapaAtual);
  const ficar = etapaAtual;
  switch (evento.tipo) {
    case 'mensagem_cliente':
      // etapa-entrada: em "Novo lead" a cliente pode escrever quanto quiser; sai só quando a loja responder.
      if (atual === 'entrada') return 'entrada';
      // Estava sem responder e respondeu: volta para o atendimento.
      if (atual === 'sem_resposta') return 'em_conversa';
      // Voltou depois de perdida ou do atendimento feito: precisa ser respondida de novo.
      if ((atual === 'perdida' || atual === 'compareceu') && r.voltouEscrever) return 'entrada';
      return ficar;
    case 'primeira_resposta':
      if (atual !== 'entrada') return ficar;
      return r.lojaRespondeu ? 'em_conversa' : ficar;
    case 'ia_classificou': {
      const pedida = etapaDoFunil(evento.etapa);
      if (!ETAPAS_DA_IA.includes(pedida)) return ficar;
      if (PROTEGIDAS.includes(atual) && pedida !== 'reagendar') return ficar;
      return pedida;
    }
    case 'agendamento_criado':
    case 'agendamento_remarcado':
      return r.agendou ? 'agendada' : ficar;
    case 'agendamento_cancelado':
      if (atual !== 'agendada') return ficar;
      return r.remarcar ? 'reagendar' : 'em_conversa';
    case 'pediu_remarcar':
      if (!r.remarcar || atual === 'perdida' || atual === 'compareceu' || atual === 'reagendar') return ficar;
      return 'reagendar';
    case 'atendimento_finalizado':
      return 'compareceu';
    case 'cliente_faltou':
      return r.remarcar ? 'reagendar' : 'em_conversa';
    case 'manutencao_vencida':
      // funil-atendimento: a manutenção agora é do funil Pós-venda; aqui ela continua em "Finalizado".
      return ficar;
    case 'followups_esgotados':
      // funil-atendimento (dono 28/11): perda só com motivo (equipe ou IA). Follow-ups esgotados = "Sem resposta".
      return PROTEGIDAS.includes(atual) || atual === 'perdida' || atual === 'reagendar' ? ficar : 'sem_resposta';
  }
}
