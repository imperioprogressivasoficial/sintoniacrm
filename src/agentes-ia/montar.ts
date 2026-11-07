import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { ClienteClaude, PedidoAgente, RespostaAgente } from '../ai/agente.js';
import type { ClienteClaudeParse } from '../ai/copiloto.js';
import type { Agenda } from '../ai/ferramentas.js';
import type { Conversa, Etapa, ModoAtendimento } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ArmazemAgentesIaMemoria, ArmazemAgentesIaPostgres, type ArmazemAgentesIa } from './armazem.js';
import { Comandos } from './comandos.js';
import { ControleIa } from './controle.js';
import { ExecutorAgentes, type ResultadoAgente } from './executor.js';
import { clienteOpenAI, SemChave } from './provedores.js';
import { registrarAgentesIa } from './rotas.js';
import { ServicoAgentesIa } from './servico.js';
import type { AgenteIa, Provedor } from './tipos.js';

/**
 * Liga o estúdio de agentes de IA (o mesmo em produção e nos testes).
 * Devolve o roteador (agente da Sintonia), o gancho do modo inicial e `executarAgente` para o bot.
 */
export interface OpcoesAgentesIa {
  empresaId: string;
  pool?: pg.Pool;
  armazem?: ArmazemAgentesIa;
  repo: Repositorio;
  cofre: { cifrar(s: string): string; decifrar(s: string): string };
  agenda: Agenda;
  baseGeral: () => Promise<string>;
  /** O agente de sempre (usado quando a conversa não tem agente do estúdio). */
  padrao: { executar(p: PedidoAgente): Promise<RespostaAgente> };
  /** Chave geral de cada provedor (Conexões), lida na hora. */
  chaveGeral: (p: Provedor) => string | undefined;
  /** Cliente da Anthropic com a chave geral (o que já existe) e a fábrica para chave própria. */
  claudeGeral: ClienteClaude & ClienteClaudeParse;
  claudeComChave: (chave: string) => ClienteClaude;
  /** Embrulha o cliente da OpenAI (medição de uso e porteiro do plano). */
  embrulhar?: (c: ClienteClaude) => ClienteClaude;
  sintonia: () => { mudarModo(id: string, modo: ModoAtendimento): Promise<void> };
  tags?: { nomes(): Promise<string[]>; daConversa(id: string): Promise<string[]>; marcar(conversaId: string, nome: string, por: string): Promise<boolean> };
  moverEtapa: (conversaId: string, etapa: Etapa, por: string) => Promise<boolean>;
  modeloComandos?: string;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  fetch?: typeof fetch;
  /** Para testes: substitui a criação do cliente do provedor. */
  cliente?: (provedor: Provedor, chave?: string) => ClienteClaude;
}

export function montarAgentesIa(o: OpcoesAgentesIa) {
  const armazem = o.armazem ?? (o.pool ? new ArmazemAgentesIaPostgres(o.pool) : new ArmazemAgentesIaMemoria());
  const cliente =
    o.cliente ??
    ((provedor: Provedor, chave?: string): ClienteClaude => {
      if (provedor === 'openai') {
        const k = chave ?? o.chaveGeral('openai');
        if (!k) throw new SemChave('openai');
        const c = clienteOpenAI(k, o.fetch);
        return o.embrulhar ? o.embrulhar(c) : c;
      }
      if (chave) return o.claudeComChave(chave);
      if (!o.chaveGeral('anthropic')) throw new SemChave('anthropic');
      return o.claudeGeral;
    });
  const executor = new ExecutorAgentes({ empresaId: o.empresaId, armazem, cofre: o.cofre, agenda: o.agenda, baseGeral: o.baseGeral, cliente, repo: o.repo, agora: o.agora, log: o.log });
  const temChave = (a: AgenteIa) => Boolean(a.chaveCifrada) || Boolean(o.chaveGeral(a.provedor));
  const controle = new ControleIa({ empresaId: o.empresaId, armazem, executor, padrao: o.padrao, repo: o.repo, temChave, sintonia: o.sintonia, agora: o.agora, log: o.log });
  const servico = new ServicoAgentesIa({ empresaId: o.empresaId, armazem, cofre: o.cofre, executor, repo: o.repo, baseGeral: o.baseGeral, agora: o.agora, fetch: o.fetch });
  const comandos = new Comandos({
    empresaId: o.empresaId,
    armazem,
    repo: o.repo,
    tags: () => o.tags?.nomes() ?? Promise.resolve([]),
    tagsDaConversa: (id) => o.tags?.daConversa(id) ?? Promise.resolve([]),
    moverEtapa: o.moverEtapa,
    marcarTag: (id, nome, por) => (o.tags ? o.tags.marcar(id, nome, por) : Promise.resolve(false)),
    mudarModo: (id, modo) => o.sintonia().mudarModo(id, modo),
    claude: () => (o.chaveGeral('anthropic') ? o.claudeGeral : undefined),
    modelo: o.modeloComandos,
    agora: o.agora,
  });

  return {
    armazem,
    executor,
    controle,
    servico,
    comandos,
    /** Agente para a Sintonia (roteia para o agente do estúdio quando a conversa tem um). */
    agente: controle.roteador(),
    /** Gancho `modoInicial` da Sintonia ("IA atende primeiro"). */
    modoInicial: (c: Conversa, agora: Date) => controle.modoInicial(c, agora),
    /** Para o construtor visual de bot (bloco "Agente de IA"). Não envia nada: devolve texto e ações. */
    executarAgente: (agenteIaId: string, conversa: Conversa, objetivo?: string): Promise<ResultadoAgente> => servico.executarAgente(agenteIaId, conversa, objetivo),
    /** Põe a conversa sob o controle de um agente (modo IA): a Sintonia passa a responder por ele. */
    entregarConversa: (conversaId: string, agenteIaId: string) => controle.devolverParaIa(conversaId, agenteIaId),
    registrar: (app: FastifyInstance, extra: { tagsDaIa?: () => Promise<string[]> } = {}) =>
      registrarAgentesIa(app, {
        repo: o.repo,
        servico,
        executor,
        controle,
        comandos,
        chavesGerais: () => ({ anthropic: Boolean(o.chaveGeral('anthropic')), openai: Boolean(o.chaveGeral('openai')) }),
        tagsDaIa: extra.tagsDaIa,
        sintonia: { mudarModo: (id, modo) => o.sintonia().mudarModo(id, modo) },
      }),
  };
}
export type AgentesIa = ReturnType<typeof montarAgentesIa>;
