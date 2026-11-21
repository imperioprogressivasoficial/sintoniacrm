import { z } from 'zod';
import { ETAPAS, NOME_ETAPA, type Conversa, type Etapa, type UnidadeId } from '../domain.js';
import { type DiaSemana, unidadeDe } from '../unidades.js';
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
    /*
     * automacao-vendas: prazo de resposta (SLA). `primeiraMin` = prazo da PRIMEIRA resposta (cliente que ainda não
     * recebeu nenhuma resposta da loja); `etapas` = prazo por etapa do funil (ex.: Novo lead 5 min, Em conversa 30 min).
     * Vazio = vale o aviso padrão (avisoMin). Estourou o prazo: aviso para a dona (ou a unidade). Continuou sem resposta
     * por mais (forteMin − avisoMin) minutos: escala para a gerência da unidade (alerta forte), como sempre foi.
     */
    primeiraMin: z.number().int().min(1).max(1440).nullable().default(null),
    etapas: z.partialRecord(z.enum(ETAPAS), z.number().int().min(1).max(1440)).default({}),
  })
  .refine((r) => r.forteMin > r.avisoMin, { message: 'O alerta forte precisa vir depois do aviso.', path: ['forteMin'] });
export type RegraEspera = z.infer<typeof EsquemaRegraEspera>;

export const REGRA_PADRAO: RegraEspera = { ligado: true, avisoMin: 5, forteMin: 15, repetirSeg: 45, soNoHorario: true, abre: null, fecha: null, primeiraMin: null, etapas: {} };

export type RegrasEspera = Partial<Record<UnidadeId, RegraEspera>>;

export function regraDa(regras: RegrasEspera | undefined, unidade: UnidadeId): RegraEspera {
  const r = { ...REGRA_PADRAO, ...(regras?.[unidade] ?? {}) };
  // Regras gravadas antes dos prazos por etapa não têm estes campos.
  return { ...r, primeiraMin: r.primeiraMin ?? null, etapas: { ...(r.etapas ?? {}) } };
}

/** automacao-vendas: de onde veio o prazo que vale para a conversa agora. */
export type OrigemPrazo = 'primeira' | 'etapa' | 'padrao';
export interface PrazoEspera {
  /** Minutos até o aviso (o prazo de resposta). */
  avisoMin: number;
  /** Minutos até escalar para a gerência (prazo + o intervalo da escalada). */
  forteMin: number;
  origem: OrigemPrazo;
  /** Texto curto para os avisos: "primeira resposta", "etapa Novo lead" ou "". */
  rotulo: string;
}

/** Ainda não recebeu nenhuma resposta da loja (equipe ou IA)? */
export const semNenhumaResposta = (c: Pick<Conversa, 'ultimaMensagemEquipe' | 'ultimaMensagemIa'>) => !c.ultimaMensagemEquipe && !c.ultimaMensagemIa;

/**
 * automacao-vendas: o prazo que vale para a conversa: o da primeira resposta (se ninguém respondeu ainda), senão o da
 * etapa dela, senão o aviso padrão. A escalada vem depois do mesmo intervalo de sempre (forteMin − avisoMin).
 */
export function prazoDa(regra: RegraEspera, c: Pick<Conversa, 'etapa' | 'ultimaMensagemEquipe' | 'ultimaMensagemIa'>): PrazoEspera {
  const escalar = Math.max(1, regra.forteMin - regra.avisoMin);
  const daEtapa = c.etapa ? regra.etapas?.[c.etapa as Etapa] : undefined;
  if (regra.primeiraMin && semNenhumaResposta(c)) return { avisoMin: regra.primeiraMin, forteMin: regra.primeiraMin + escalar, origem: 'primeira', rotulo: 'primeira resposta' };
  if (daEtapa) return { avisoMin: daEtapa, forteMin: daEtapa + escalar, origem: 'etapa', rotulo: `etapa ${NOME_ETAPA[c.etapa as Etapa] ?? c.etapa}` };
  return { avisoMin: regra.avisoMin, forteMin: regra.forteMin, origem: 'padrao', rotulo: '' };
}

/** A loja está aberta agora (horário da Bahia)? */
export function lojaAberta(regra: RegraEspera, unidade: UnidadeId, agora: Date): boolean {
  if (!regra.soNoHorario) return true;
  const p = partesBahia(agora);
  const m = p.hora * 60 + p.minuto;
  const faixa = regra.abre && regra.fecha ? { abre: regra.abre, fecha: regra.fecha } : unidadeDe(unidade)?.horario[p.diaSemana as DiaSemana];
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
  /** automacao-vendas: o prazo usado (primeira resposta, da etapa ou o padrão). */
  prazo?: PrazoEspera;
}

/**
 * Quanto a cliente está esperando e em que nível. Sem alerta quando a IA atende sozinha,
 * fora do horário da loja, com bot/follow-up conduzindo (automacaoAtiva) ou com a regra desligada.
 */
export function avaliarEspera(c: Pick<Conversa, 'modo' | 'unidade' | 'ultimaMensagemCliente' | 'ultimaMensagemEquipe' | 'ultimaMensagemIa'> & Partial<Pick<Conversa, 'etapa'>>, regra: RegraEspera, agora: Date, automacaoAtiva = false): SituacaoEspera {
  const nada: SituacaoEspera = { nivel: 0, minutos: 0 };
  if (!regra.ligado || c.modo === 'ia' || automacaoAtiva) return nada;
  const cl = c.ultimaMensagemCliente?.getTime() ?? 0;
  const resp = Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
  if (!cl || resp >= cl) return nada;
  const espera = agora.getTime() - cl;
  if (espera > 24 * 60 * MIN) return nada; // conversa largada há mais de um dia: não é "esperando agora"
  if (!lojaAberta(regra, c.unidade, agora)) return nada;
  const minutos = Math.floor(espera / MIN);
  const prazo = prazoDa(regra, { etapa: c.etapa as Etapa, ultimaMensagemEquipe: c.ultimaMensagemEquipe, ultimaMensagemIa: c.ultimaMensagemIa });
  const nivel = minutos >= prazo.forteMin ? 2 : minutos >= prazo.avisoMin ? 1 : 0;
  return { nivel, desde: new Date(cl), minutos, prazo };
}
