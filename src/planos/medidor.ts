import { AsyncLocalStorage } from 'node:async_hooks';
import type { PedidoAgente, RespostaAgente } from '../ai/agente.js';
import type { Uso } from './catalogo.js';
import type { Planos } from './porteiro.js';

/**
 * Medição e porteiro ligados ao atendimento sem mexer no agente:
 * - `medirCliente` embrulha o cliente da Anthropic: cada `messages.create`/`parse` (beta ou não) tem o `usage`
 *   da resposta anotado (tokens de entrada, saída e cache), com a conversa e o horário do contexto em que rodou;
 * - `comPorteiro` embrulha o agente da Sintonia: antes de cada resposta pergunta ao porteiro. Sem permissão,
 *   a IA não responde e a conversa fica para a equipe (passar_para_humano com o motivo). A mensagem da cliente
 *   já está salva antes disso: nada se perde.
 */

interface Contexto {
  conversaId: string | null;
  origem: string;
  dentro?: boolean;
}
const contexto = new AsyncLocalStorage<Contexto>();

/** Roda `fn` com a conversa/origem anotadas para a medição. */
export const comContexto = <T>(c: Contexto, fn: () => T): T => contexto.run(c, fn);

type UsageApi = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

export function usoDaResposta(u: UsageApi | undefined | null): Uso | null {
  if (!u) return null;
  return { entrada: u.input_tokens ?? 0, saida: u.output_tokens ?? 0, cacheLeitura: u.cache_read_input_tokens ?? 0, cacheEscrita: u.cache_creation_input_tokens ?? 0 };
}

export type Anotar = (r: { modelo: string; uso: Uso; conversaId: string | null; origem: string; dentro?: boolean }) => void;

const METODOS = new Set(['create', 'parse']);

function embrulharMessages<T extends object>(m: T, anotar: Anotar): T {
  return new Proxy(m, {
    get(alvo, prop) {
      const v = Reflect.get(alvo, prop) as unknown;
      if (typeof prop === 'string' && METODOS.has(prop) && typeof v === 'function') {
        return (...args: unknown[]) => {
          const ctx = contexto.getStore();
          const r = (v as (...a: unknown[]) => unknown).apply(alvo, args);
          Promise.resolve(r)
            .then((resp) => {
              const x = resp as { usage?: UsageApi; model?: string } | undefined;
              const uso = usoDaResposta(x?.usage);
              if (!uso) return;
              const modelo = x?.model ?? String((args[0] as { model?: string } | undefined)?.model ?? 'desconhecido');
              anotar({ modelo, uso, conversaId: ctx?.conversaId ?? null, origem: ctx?.origem ?? 'outro', dentro: ctx?.dentro });
            })
            .catch(() => {});
          return r;
        };
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
    },
  });
}

/** Cliente da Anthropic (ou o adaptador com a mesma forma) que anota o uso de cada chamada. */
export function medirCliente<T extends object>(cliente: T, anotar: Anotar): T {
  return new Proxy(cliente, {
    get(alvo, prop) {
      const v = Reflect.get(alvo, prop) as unknown;
      if (prop === 'messages' && v && typeof v === 'object') return embrulharMessages(v, anotar);
      if (prop === 'beta' && v && typeof v === 'object') {
        return new Proxy(v, {
          get(b, p2) {
            const w = Reflect.get(b, p2) as unknown;
            if (p2 === 'messages' && w && typeof w === 'object') return embrulharMessages(w, anotar);
            return typeof w === 'function' ? (w as (...a: unknown[]) => unknown).bind(b) : w;
          },
        });
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
    },
  });
}

/** Anotador ligado aos Planos de uma empresa. */
export const anotadorDe = (planos: Planos, empresaId: string, agora: () => Date = () => new Date()): Anotar => (r) => {
  void planos.registrarUso({ empresaId, em: agora(), conversaId: r.conversaId, origem: r.origem, modelo: r.modelo, uso: r.uso, dentro: r.dentro });
};

export type AgenteSintonia = { executar(p: PedidoAgente): Promise<RespostaAgente> };

export function comPorteiro(agente: AgenteSintonia, o: { planos: Planos; empresaId: string; log?: (msg: string, extra?: unknown) => void }): AgenteSintonia {
  const log = o.log ?? (() => {});
  return {
    async executar(p) {
      let decisao;
      try {
        decisao = await o.planos.decidir(o.empresaId, p.agora);
      } catch (e) {
        // Falha ao consultar o plano não pode calar a IA de quem paga: segue e registra.
        log('Porteiro da IA indisponível; seguindo com a IA', String(e));
        return comContexto({ conversaId: p.conversa.id, origem: 'agente' }, () => agente.executar(p));
      }
      if (!decisao.pode) {
        await o.planos.armazem.registrarBloqueio({ empresaId: o.empresaId, em: p.agora, conversaId: p.conversa.id, motivo: decisao.motivo }).catch((e) => log('Falha ao registrar bloqueio da IA', String(e)));
        // Resposta à cliente: a conversa vai para a equipe, com o motivo. Sugestão e envio ativo: a IA só não age.
        const responder = p.modo === 'responder' && !p.tipoAtivo && !p.simulacao;
        return { texto: '', acoes: responder ? [{ tipo: 'passar_para_humano', motivo: decisao.texto }] : [], recusou: false };
      }
      return comContexto({ conversaId: p.conversa.id, origem: p.tipoAtivo ? `ativo:${p.tipoAtivo}` : p.modo === 'sugerir' ? 'copiloto' : 'agente', dentro: decisao.dentro }, () => agente.executar(p));
    },
  };
}
