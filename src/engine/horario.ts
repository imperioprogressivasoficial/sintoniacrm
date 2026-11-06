import type { Unidade } from '../unidades.js';
import { bahia, DIA, minutosDoDia, partesBahia } from '../util/tempo.js';

/** A equipe da unidade está em horário de atendimento neste instante? */
export function estaAberta(unidade: Unidade, agora: Date): boolean {
  const p = partesBahia(agora);
  const faixa = unidade.horario[p.diaSemana];
  if (!faixa) return false;
  const m = p.hora * 60 + p.minuto;
  return m >= minutosDoDia(faixa.abre) && m < minutosDoDia(faixa.fecha);
}

/**
 * Janela em que é educado mandar mensagem ativa (lembrete, follow-up, campanha):
 * das 8h às 20h30, todos os dias. Respostas a quem acabou de escrever não passam por aqui.
 */
export const JANELA_ATIVA = { inicio: '08:00', fim: '20:30' };

/** Empurra um envio ativo para dentro da janela educada (nunca de madrugada). */
export function ajustarParaJanelaAtiva(quando: Date): Date {
  const p = partesBahia(quando);
  const m = p.hora * 60 + p.minuto;
  const ini = minutosDoDia(JANELA_ATIVA.inicio);
  const fim = minutosDoDia(JANELA_ATIVA.fim);
  if (m >= ini && m <= fim) return quando;
  const [h, mm] = JANELA_ATIVA.inicio.split(':').map(Number);
  const mesmoDia = bahia(p.ano, p.mes, p.dia, h!, mm!);
  return m < ini ? mesmoDia : new Date(mesmoDia.getTime() + DIA);
}
