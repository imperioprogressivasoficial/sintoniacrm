import { ajustarParaJanelaAtiva } from './horario.js';
import { bahia, DIA, HORA, partesBahia } from '../util/tempo.js';

/** Tipos de mensagem ativa que a Sintonia programa sozinha. */
export type TipoEnvio =
  | 'lembrete_vespera'
  | 'lembrete_2h'
  | 'followup_1h'
  | 'followup_1d'
  | 'followup_3d'
  | 'recuperar_falta'
  | 'manutencao_90d'
  | 'pos_atendimento';

export interface EnvioProgramado {
  tipo: TipoEnvio;
  quando: Date;
}

/**
 * Lembretes de um agendamento:
 * - véspera às 10h (ou na hora, se o agendamento foi marcado em cima);
 * - 2h antes, só se isso cair depois das 8h; para horários cedo, a véspera basta.
 */
export function lembretesDoAgendamento(inicio: Date, agora: Date): EnvioProgramado[] {
  const envios: EnvioProgramado[] = [];
  const p = partesBahia(new Date(inicio.getTime() - DIA));
  const vespera = bahia(p.ano, p.mes, p.dia, 10, 0);
  if (vespera.getTime() > agora.getTime()) envios.push({ tipo: 'lembrete_vespera', quando: vespera });

  const duasHoras = new Date(inicio.getTime() - 2 * HORA);
  const ph = partesBahia(duasHoras);
  if (duasHoras.getTime() > agora.getTime() && ph.hora >= 8) {
    envios.push({ tipo: 'lembrete_2h', quando: duasHoras });
  }
  return envios;
}

/**
 * Cliente conversou e não agendou: 1h, 1 dia e 3 dias depois da última mensagem dela.
 * Tudo empurrado para a janela educada (8h–20h30). Para no primeiro "não quero".
 */
export function followupsSemAgendamento(ultimaMensagemCliente: Date): EnvioProgramado[] {
  const base = ultimaMensagemCliente.getTime();
  return [
    { tipo: 'followup_1h' as const, quando: new Date(base + HORA) },
    { tipo: 'followup_1d' as const, quando: new Date(base + DIA) },
    { tipo: 'followup_3d' as const, quando: new Date(base + 3 * DIA) },
  ].map((e) => ({ ...e, quando: ajustarParaJanelaAtiva(e.quando) }));
}

/** Faltou: convite para remarcar no mesmo dia, 1h depois do horário perdido. */
export function recuperacaoDeFalta(inicioPerdido: Date): EnvioProgramado {
  return { tipo: 'recuperar_falta', quando: ajustarParaJanelaAtiva(new Date(inicioPerdido.getTime() + 3 * HORA)) };
}

/** Depois do atendimento: pesquisa no dia seguinte e convite de manutenção em 90 dias, às 10h. */
export function posAtendimento(fimAtendimento: Date): EnvioProgramado[] {
  const pd = partesBahia(new Date(fimAtendimento.getTime() + DIA));
  const p90 = partesBahia(new Date(fimAtendimento.getTime() + 90 * DIA));
  return [
    { tipo: 'pos_atendimento', quando: bahia(pd.ano, pd.mes, pd.dia, 11, 0) },
    { tipo: 'manutencao_90d', quando: bahia(p90.ano, p90.mes, p90.dia, 10, 0) },
  ];
}
