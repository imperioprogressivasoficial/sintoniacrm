import type { ModoAtendimento } from '../domain.js';
import type { AgenteIa } from '../agentes-ia/tipos.js';

/**
 * A IA está atendendo de verdade agora? (selo "IA atendendo agora" da tela Plano)
 * Só quando existe a chave e algum agente ligado:
 * - um agente do estúdio ativo e com chave (a própria dele ou a geral do provedor); ou
 * - a chave geral da Anthropic cadastrada e as conversas novas começando com a IA (modo IA ou copiloto).
 * O plano permitir a IA não basta: isso a tela já mostra à parte.
 */
export interface EstadoIa {
  atendendo: boolean;
  /** Por que não está atendendo (texto para a pessoa). */
  motivo?: 'sem_chave' | 'sem_agente';
  texto?: string;
}

export function estadoDaIa(o: {
  chaveGeral: (provedor: AgenteIa['provedor']) => boolean;
  agentes: Pick<AgenteIa, 'ativo' | 'provedor' | 'chaveCifrada'>[];
  modoPadrao: ModoAtendimento;
}): EstadoIa {
  const ativos = o.agentes.filter((a) => a.ativo);
  if (ativos.some((a) => Boolean(a.chaveCifrada) || o.chaveGeral(a.provedor))) return { atendendo: true };
  if (o.chaveGeral('anthropic') && o.modoPadrao !== 'humano') return { atendendo: true };
  if (!o.chaveGeral('anthropic') && !o.chaveGeral('openai')) {
    return { atendendo: false, motivo: 'sem_chave', texto: 'Falta a chave da IA. Cadastre em Mais › Conexões.' };
  }
  return { atendendo: false, motivo: 'sem_agente', texto: 'Nenhum agente de IA está ligado e as conversas novas começam com a equipe.' };
}
