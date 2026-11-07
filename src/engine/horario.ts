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

/** Instante em que a unidade fecha hoje (undefined se hoje não abre). */
export function fechamentoDeHoje(unidade: Unidade, agora: Date): Date | undefined {
  const p = partesBahia(agora);
  const faixa = unidade.horario[p.diaSemana];
  if (!faixa) return undefined;
  const m = minutosDoDia(faixa.fecha);
  return bahia(p.ano, p.mes, p.dia, Math.floor(m / 60), m % 60);
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

/**
 * Próximo instante em que a unidade está aberta: agora mesmo, se já está; senão a próxima abertura
 * (procura até 8 dias à frente). undefined se a unidade não tem horário (ex.: unidade em obras).
 */
export function proximaAbertura(unidade: Unidade, agora: Date): Date | undefined {
  if (estaAberta(unidade, agora)) return agora;
  const p = partesBahia(agora);
  for (let d = 0; d <= 8; d++) {
    const dia = partesBahia(new Date(bahia(p.ano, p.mes, p.dia, 12).getTime() + d * DIA));
    const faixa = unidade.horario[dia.diaSemana];
    if (!faixa) continue;
    const m = minutosDoDia(faixa.abre);
    const abre = bahia(dia.ano, dia.mes, dia.dia, Math.floor(m / 60), m % 60);
    if (abre.getTime() > agora.getTime()) return abre;
  }
  return undefined;
}
