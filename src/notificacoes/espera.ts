import { z } from 'zod';
import type { Conversa, UnidadeId } from '../domain.js';
import { UNIDADES, type DiaSemana } from '../unidades.js';
import { MIN, minutosDoDia, partesBahia } from '../util/tempo.js';

/**
 * Regras de "cliente esperando há muito tempo", por unidade (configuradas pela gestão).
 * Nível 1 = aviso (ex.: 5 min), nível 2 = alerta forte (ex.: 15 min, também para a gestão).
 */
const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const EsquemaRegraEspera = z
  .object({
    ligado: z.boolean(),
    avisoMin: z.number().int().min(1).max(240),
    forteMin: z.number().int().min(1).max(480),
    /** De quanto em quanto tempo o alarme toca de novo com o app aberto. */
    repetirSeg: z.number().int().min(15).max(600),
    /** Só alerta com a loja aberta. */
    soNoHorario: z.boolean(),
    /** Horário próprio (todos os dias); vazio = o horário cadastrado da unidade. */
    abre: HORA.nullable(),
    fecha: HORA.nullable(),
  })
  .refine((r) => r.forteMin > r.avisoMin, { message: 'O alerta forte precisa vir depois do aviso.', path: ['forteMin'] });
export type RegraEspera = z.infer<typeof EsquemaRegraEspera>;

export const REGRA_PADRAO: RegraEspera = { ligado: true, avisoMin: 5, forteMin: 15, repetirSeg: 45, soNoHorario: true, abre: null, fecha: null };

export type RegrasEspera = Partial<Record<UnidadeId, RegraEspera>>;

export function regraDa(regras: RegrasEspera | undefined, unidade: UnidadeId): RegraEspera {
  return { ...REGRA_PADRAO, ...(regras?.[unidade] ?? {}) };
}

/** A loja está aberta agora (horário da Bahia)? */
export function lojaAberta(regra: RegraEspera, unidade: UnidadeId, agora: Date): boolean {
  if (!regra.soNoHorario) return true;
  const p = partesBahia(agora);
  const m = p.hora * 60 + p.minuto;
  const faixa = regra.abre && regra.fecha ? { abre: regra.abre, fecha: regra.fecha } : UNIDADES[unidade]?.horario[p.diaSemana as DiaSemana];
  if (!faixa) return false;
  const ini = minutosDoDia(faixa.abre);
  const fim = minutosDoDia(faixa.fecha);
  return ini < fim ? m >= ini && m < fim : m >= ini || m < fim;
}

export interface SituacaoEspera {
  nivel: 0 | 1 | 2;
  /** Desde quando a cliente espera (última mensagem dela sem resposta). */
  desde?: Date;
  minutos: number;
}

/**
 * Quanto a cliente está esperando e em que nível. Sem alerta quando a IA atende sozinha,
 * fora do horário da loja, com bot/follow-up conduzindo (automacaoAtiva) ou com a regra desligada.
 */
export function avaliarEspera(c: Pick<Conversa, 'modo' | 'unidade' | 'ultimaMensagemCliente' | 'ultimaMensagemEquipe' | 'ultimaMensagemIa'>, regra: RegraEspera, agora: Date, automacaoAtiva = false): SituacaoEspera {
  const nada: SituacaoEspera = { nivel: 0, minutos: 0 };
  if (!regra.ligado || c.modo === 'ia' || automacaoAtiva) return nada;
  const cl = c.ultimaMensagemCliente?.getTime() ?? 0;
  const resp = Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
  if (!cl || resp >= cl) return nada;
  const espera = agora.getTime() - cl;
  if (espera > 24 * 60 * MIN) return nada; // conversa largada há mais de um dia: não é "esperando agora"
  if (!lojaAberta(regra, c.unidade, agora)) return nada;
  const minutos = Math.floor(espera / MIN);
  const nivel = minutos >= regra.forteMin ? 2 : minutos >= regra.avisoMin ? 1 : 0;
  return { nivel, desde: new Date(cl), minutos };
}
