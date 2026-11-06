import type { Conversa } from '../domain.js';
import type { Unidade } from '../unidades.js';
import { estaAberta } from './horario.js';
import { MIN } from '../util/tempo.js';

/**
 * O diferencial da Sintonia: a IA decide sozinha QUANDO entrar.
 * Função pura, sem efeitos colaterais, para ser fácil de testar e de ajustar.
 */

export interface RegrasAtendimento {
  /** Em horário de loja, quanto tempo a cliente pode ficar sem resposta antes de a IA assumir. */
  assumirAposMin: number;
  /** Quanto tempo a IA fica quieta depois que alguém da equipe escreve ou digita. */
  pausaAposEquipeMin: number;
}

export const REGRAS_PADRAO: RegrasAtendimento = {
  assumirAposMin: 15,
  pausaAposEquipeMin: 10,
};

export type Decisao =
  | { acao: 'nada'; motivo: string }
  /** Mostrar sugestão para a atendente e reavaliar em `reavaliarEm`. */
  | { acao: 'sugerir'; motivo: string; reavaliarEm: Date }
  /** Esperar (equipe atuando agora) e reavaliar depois. */
  | { acao: 'aguardar'; motivo: string; reavaliarEm: Date }
  | { acao: 'ia_responde'; motivo: string; assumiu: boolean };

export function decidirQuemResponde(
  conversa: Conversa,
  unidade: Unidade,
  agora: Date,
  regras: RegrasAtendimento = REGRAS_PADRAO,
): Decisao {
  if (conversa.modo === 'humano') {
    return { acao: 'nada', motivo: 'Modo "Só eu": a IA apenas observa.' };
  }

  const ultCliente = conversa.ultimaMensagemCliente?.getTime() ?? 0;
  const ultResposta = Math.max(
    conversa.ultimaMensagemEquipe?.getTime() ?? 0,
    conversa.ultimaMensagemIa?.getTime() ?? 0,
  );
  if (!ultCliente || ultResposta >= ultCliente) {
    return { acao: 'nada', motivo: 'Nenhuma mensagem da cliente aguardando resposta.' };
  }

  if (conversa.pausaIaAte && conversa.pausaIaAte.getTime() > agora.getTime()) {
    return {
      acao: 'aguardar',
      motivo: 'A equipe está atuando nesta conversa.',
      reavaliarEm: conversa.pausaIaAte,
    };
  }

  const aberta = estaAberta(unidade, agora);
  if (!aberta) {
    return { acao: 'ia_responde', motivo: 'Fora do horário de atendimento.', assumiu: conversa.modo !== 'ia' };
  }

  if (conversa.modo === 'ia') {
    return { acao: 'ia_responde', motivo: 'A IA está conduzindo esta conversa.', assumiu: false };
  }

  // Copiloto em horário de loja: sugere já e assume se ninguém responder no prazo.
  const prazo = ultCliente + regras.assumirAposMin * MIN;
  if (agora.getTime() >= prazo) {
    const esperou = Math.round((agora.getTime() - ultCliente) / MIN);
    return {
      acao: 'ia_responde',
      motivo: `Cliente sem resposta há ${esperou} min em horário de atendimento.`,
      assumiu: true,
    };
  }
  return {
    acao: 'sugerir',
    motivo: 'Copiloto: sugestão pronta para a atendente.',
    reavaliarEm: new Date(prazo),
  };
}

/**
 * Quando alguém da equipe envia mensagem ou começa a digitar, a IA sai da frente:
 * vira copiloto e fica em silêncio por um tempo.
 */
export function equipeAtuou(
  conversa: Conversa,
  agora: Date,
  regras: RegrasAtendimento = REGRAS_PADRAO,
): Pick<Conversa, 'modo' | 'pausaIaAte'> {
  return {
    modo: conversa.modo === 'humano' ? 'humano' : 'copiloto',
    pausaIaAte: new Date(agora.getTime() + regras.pausaAposEquipeMin * MIN),
  };
}
