import { AsyncLocalStorage } from 'node:async_hooks';
import type { PedidoAgente, RespostaAgente } from '../ai/agente.js';
import type { Uso } from './catalogo.js';
import type { Planos } from './porteiro.js';

/**
 * Medição e porteiro ligados ao atendimento sem mexer no agente:
 * - `medirCliente` embrulha o cliente da Anthropic: cada `messages.create`/`parse` (beta ou não) tem o `usage`
 *   da resposta anotado (tokens de entrada, saída e cache), com a conversa do contexto em que rodou. Com `porteiro`,
 *   pergunta antes de CADA chamada: bloqueada (Essencial, suspensa ou limite sem crédito), a chamada nem sai e
 *   lança `IaBloqueada`. Assim copiloto, relatórios, "Peça para a IA", revisão e agentes do estúdio também param;
 * - `comPorteiro` embrulha o agente da Sintonia: antes de cada resposta pergunta ao porteiro. Sem permissão,
 *   a IA não responde e a conversa fica para a equipe (passar_para_humano com o motivo). A mensagem da cliente
 *   já está salva antes disso: nada se perde.
 */

interface Contexto {
  conversaId: string | null;
  origem: string;
}
const contexto = new AsyncLocalStorage<Contexto>();

/** Roda `fn` com a conversa/origem anotadas para a medição. */
export const comContexto = <T>(c: Contexto, fn: () => T): T => contexto.run(c, fn);

type UsageApi = { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

export function usoDaResposta(u: UsageApi | undefined | null): Uso | null {
  if (!u) return null;
  return { entrada: u.input_tokens ?? 0, saida: u.output_tokens ?? 0, cacheLeitura: u.cache_read_input_tokens ?? 0, cacheEscrita: u.cache_creation_input_tokens ?? 0 };
}

export type Anotar = (r: { modelo: string; uso: Uso; conversaId: string | null; origem: string }) => void;
/** Pergunta ao porteiro antes de cada chamada. Falha do porteiro não cala a IA (segue). */
export type PorteiroCliente = () => Promise<{ pode: boolean; texto?: string; motivo?: string }>;

/** A IA não pode agir agora (plano, assinatura ou limite sem crédito). `message` explica para a equipe. */
export class IaBloqueada extends Error {
  readonly statusCode = 402;
  constructor(
    readonly motivo: string,
    texto: string,
  ) {
    super(texto);
    this.name = 'IaBloqueada';
  }
}

const METODOS = new Set(['create', 'parse']);

function embrulharMessages<T extends object>(m: T, anotar: Anotar, porteiro?: PorteiroCliente): T {
  return new Proxy(m, {
    get(alvo, prop) {
      const v = Reflect.get(alvo, prop) as unknown;
      if (typeof prop === 'string' && METODOS.has(prop) && typeof v === 'function') {
        return (...args: unknown[]) => {
          const ctx = contexto.getStore();
          const chamar = () => (v as (...a: unknown[]) => unknown).apply(alvo, args);
          const r = porteiro
            ? porteiro()
                .catch(() => ({ pode: true }) as Awaited<ReturnType<PorteiroCliente>>)
                .then((d) => {
                  if (!d.pode) throw new IaBloqueada(d.motivo ?? 'bloqueada', d.texto ?? 'A IA não está disponível no plano agora.');
                  return chamar();
                })
            : chamar();
          Promise.resolve(r)
            .then((resp) => {
              const x = resp as { usage?: UsageApi; model?: string } | undefined;
              const uso = usoDaResposta(x?.usage);
              if (!uso) return;
              const modelo = x?.model ?? String((args[0] as { model?: string } | undefined)?.model ?? 'desconhecido');
              anotar({ modelo, uso, conversaId: ctx?.conversaId ?? null, origem: ctx?.origem ?? 'outro' });
            })
            .catch(() => {});
          return r;
        };
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(alvo) : v;
    },
  });
}

/** Cliente da Anthropic (ou o adaptador com a mesma forma) que anota o uso de cada chamada e, com porteiro, bloqueia. */
export function medirCliente<T extends object>(cliente: T, anotar: Anotar, porteiro?: PorteiroCliente): T {
  return new Proxy(cliente, {
    get(alvo, prop) {
      const v = Reflect.get(alvo, prop) as unknown;
      if (prop === 'messages' && v && typeof v === 'object') return embrulharMessages(v, anotar, porteiro);
      if (prop === 'beta' && v && typeof v === 'object') {
        return new Proxy(v, {
          get(b, p2) {
            const w = Reflect.get(b, p2) as unknown;
            if (p2 === 'messages' && w && typeof w === 'object') return embrulharMessages(w, anotar, porteiro);
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
  void planos.registrarUso({ empresaId, em: agora(), conversaId: r.conversaId, origem: r.origem, modelo: r.modelo, uso: r.uso });
};

/** Porteiro do cliente ligado aos Planos de uma empresa. */
export const porteiroDe = (planos: Planos, empresaId: string, agora: () => Date = () => new Date()): PorteiroCliente => () => planos.decidir(empresaId, agora());

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
      const bloquear = async (motivo: string, texto: string): Promise<RespostaAgente> => {
        await o.planos.armazem.registrarBloqueio({ empresaId: o.empresaId, em: p.agora, conversaId: p.conversa.id, motivo }).catch((e) => log('Falha ao registrar bloqueio da IA', String(e)));
        // Resposta à cliente: a conversa vai para a equipe, com o motivo. Sugestão e envio ativo: a IA só não age.
        const responder = p.modo === 'responder' && !p.tipoAtivo && !p.simulacao;
        return { texto: '', acoes: responder ? [{ tipo: 'passar_para_humano', motivo: texto }] : [], recusou: false };
      };
      if (!decisao.pode) return bloquear(decisao.motivo, decisao.texto);
      try {
        return await comContexto({ conversaId: p.conversa.id, origem: p.tipoAtivo ? `ativo:${p.tipoAtivo}` : p.modo === 'sugerir' ? 'copiloto' : 'agente' }, () => agente.executar(p));
      } catch (e) {
        // O limite estourou no meio da resposta (o cliente da IA recusou o passo seguinte): vai para a equipe.
        if (e instanceof IaBloqueada) return bloquear(e.motivo, e.message);
        throw e;
      }
    },
  };
}
