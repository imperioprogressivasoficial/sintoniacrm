import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Contas } from '../auth/contas.js';
import { podeReceber } from '../auth/acesso.js';
import type { ArmazemTags, Tag, Tags } from '../tags/tags.js';
import type { Funis, MovimentoEtapa } from '../funis/funis.js';
import type { GanchosSintonia } from '../app/sintonia.js';
import type { CanalWhatsApp } from '../channels/tipos.js';
import { estaAberta, proximaAbertura } from '../engine/horario.js';
import { UNIDADES } from '../unidades.js';
import { bahia, DIA, horaHHmm, MIN, partesBahia, dataISO } from '../util/tempo.js';
import {
  AutomacaoAlteracao,
  AutomacaoNova,
  casaPalavra,
  LIMITE_PASSOS,
  MODOS,
  percorrer,
  preencher,
  PROFUNDIDADE_CONDICAO,
  type Gatilho,
  type Opcoes,
  type Passo,
} from './esquema.js';

/**
 * Automações: quando acontece o gatilho numa conversa, roda a lista de passos.
 *
 * Cada disparo vira uma EXECUÇÃO gravada (auditoria e retomada): a fila de passos que faltam, o status e o
 * registro do que aconteceu. Os passos rodam sob a trava da conversa. "Esperar" e "fora do horário" deixam a
 * execução pendente com hora marcada; o relógio (tick) retoma, mesmo depois de reiniciar o servidor.
 *
 * Proteções contra bagunça:
 * - no máximo 1 execução ativa da mesma automação por conversa (índice único no banco);
 * - o mesmo evento nunca dispara duas vezes (chave do evento, índice único);
 * - limite de mensagens automáticas por conversa por dia (configurável, padrão 3);
 * - se a equipe responder, execuções com envio pendente param (opção parar_se_equipe_responder);
 * - encadeamento limitado: uma automação que dispara outra soma 1 na profundidade; passou do limite, não dispara.
 */

export interface Automacao {
  id: string;
  empresaId: string;
  funilId: string | null;
  nome: string;
  ligada: boolean;
  gatilho: Gatilho;
  passos: Passo[];
  opcoes: Opcoes;
  criadaPor: string | null;
  criadaEm: Date;
  atualizadaEm: Date;
}

export type StatusExecucao = 'pendente' | 'rodando' | 'concluida' | 'cancelada' | 'erro';

/** Uma linha do registro da execução (o que a tela mostra em "o que aconteceu"). */
export interface RegistroPasso {
  /** ISO. */
  em: string;
  passo: Passo['tipo'] | 'inicio' | 'fim';
  ok: boolean;
  detalhe: string;
}

export interface Execucao {
  id: string;
  automacaoId: string;
  conversaId: string;
  /** O evento que disparou (ex.: "msg:<id do WhatsApp>", "nova_conversa", "parada:<etapa>:<desde>"). */
  chave: string;
  status: StatusExecucao;
  /** Passos que ainda faltam (cópia feita no disparo). */
  fila: Passo[];
  feitos: number;
  profundidade: number;
  teste: boolean;
  proximaEm: Date;
  reservadaAte: Date | null;
  log: RegistroPasso[];
  erro: string | null;
  criadaEm: Date;
  atualizadaEm: Date;
}

export interface ConfigAutomacoes {
  /** Mensagens automáticas por conversa por dia (dia da Bahia). */
  limiteDiario: number;
}
export const CONFIG_PADRAO: ConfigAutomacoes = { limiteDiario: 3 };

export class ErroAutomacao extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export interface ArmazemAutomacoes {
  listar(empresaId: string): Promise<Automacao[]>;
  buscar(id: string): Promise<Automacao | undefined>;
  salvar(a: Automacao): Promise<void>;
  apagar(id: string): Promise<void>;
  /** As do funil (o Postgres já apaga em cascata; a memória precisa). */
  apagarDoFunil(funilId: string): Promise<void>;

  /** false se o evento já disparou esta automação nesta conversa, ou se já há uma execução ativa dela (fora testes). */
  criarExecucao(e: Execucao): Promise<boolean>;
  salvarExecucao(e: Execucao): Promise<void>;
  execucao(id: string): Promise<Execucao | undefined>;
  /** Últimas execuções da automação (mais novas primeiro). */
  execucoes(automacaoId: string, limite: number): Promise<Execucao[]>;
  /** Pendentes e rodando da conversa. */
  ativasDaConversa(conversaId: string): Promise<Execucao[]>;
  /**
   * Reserva para rodar (status "rodando" até `reservaAte`) as execuções prontas: pendentes vencidas e
   * rodando com a reserva vencida (o processo caiu no meio). Com `conversaId`, só as dela.
   */
  reivindicar(agora: Date, reservaAte: Date, o: { conversaId?: string; limite: number }): Promise<Execucao[]>;
  /** Conversas na etapa desde antes de `ate` que esta automação ainda não pegou nesta estadia. */
  paradas(automacaoId: string, funilId: string, tagId: string, ate: Date, limite: number): Promise<Array<{ conversaId: string; desde: Date }>>;

  registrarEnvio(conversaId: string, em: Date): Promise<void>;
  contarEnvios(conversaId: string, desde: Date): Promise<number>;

  objetivo(conversaId: string): Promise<{ objetivo: string; ate: Date; automacaoId: string | null } | undefined>;
  definirObjetivo(conversaId: string, o: { objetivo: string; desde: Date; ate: Date; automacaoId: string } | null): Promise<void>;

  config(empresaId: string): Promise<ConfigAutomacoes>;
  salvarConfig(empresaId: string, c: ConfigAutomacoes, por: string): Promise<void>;
}

const ATIVOS: StatusExecucao[] = ['pendente', 'rodando'];
const copia = <T>(x: T): T => structuredClone(x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chaveParada = (tagId: string, desde: Date) => `parada:${tagId}:${desde.toISOString()}`;

// ---------------------------------------------------------------- memória

export class ArmazemAutomacoesMemoria implements ArmazemAutomacoes {
  private readonly automacoes = new Map<string, Automacao>();
  private readonly execs = new Map<string, Execucao>();
  private readonly envios: Array<{ conversaId: string; em: Date }> = [];
  private readonly objetivos = new Map<string, { objetivo: string; ate: Date; automacaoId: string | null }>();
  private readonly configs = new Map<string, ConfigAutomacoes>();

  /** Precisa das marcações de etapa para achar quem está parado. */
  constructor(private readonly tags: ArmazemTags) {}

  async listar(empresaId: string) {
    return [...this.automacoes.values()].filter((a) => a.empresaId === empresaId).map(copia);
  }
  async buscar(id: string) {
    const a = this.automacoes.get(id);
    return a ? copia(a) : undefined;
  }
  async salvar(a: Automacao) {
    this.automacoes.set(a.id, copia(a));
  }
  async apagar(id: string) {
    this.automacoes.delete(id);
    for (const [k, e] of this.execs) if (e.automacaoId === id) this.execs.delete(k);
  }
  async apagarDoFunil(funilId: string) {
    for (const a of [...this.automacoes.values()]) if (a.funilId === funilId) await this.apagar(a.id);
  }
  async criarExecucao(e: Execucao) {
    for (const x of this.execs.values()) {
      if (x.automacaoId !== e.automacaoId || x.conversaId !== e.conversaId) continue;
      if (x.chave === e.chave) return false;
      if (!e.teste && !x.teste && ATIVOS.includes(x.status)) return false;
    }
    this.execs.set(e.id, copia(e));
    return true;
  }
  async salvarExecucao(e: Execucao) {
    if (this.execs.has(e.id)) this.execs.set(e.id, copia(e));
  }
  async execucao(id: string) {
    const e = this.execs.get(id);
    return e ? copia(e) : undefined;
  }
  async execucoes(automacaoId: string, limite: number) {
    return [...this.execs.values()]
      .filter((e) => e.automacaoId === automacaoId)
      .sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())
      .slice(0, limite)
      .map(copia);
  }
  async ativasDaConversa(conversaId: string) {
    return [...this.execs.values()].filter((e) => e.conversaId === conversaId && ATIVOS.includes(e.status)).map(copia);
  }
  async reivindicar(agora: Date, reservaAte: Date, o: { conversaId?: string; limite: number }) {
    const t = agora.getTime();
    const prontas = [...this.execs.values()]
      .filter((e) => !o.conversaId || e.conversaId === o.conversaId)
      .filter((e) => (e.status === 'pendente' && e.proximaEm.getTime() <= t) || (e.status === 'rodando' && (e.reservadaAte?.getTime() ?? 0) < t))
      .sort((a, b) => a.proximaEm.getTime() - b.proximaEm.getTime() || a.criadaEm.getTime() - b.criadaEm.getTime())
      .slice(0, o.limite);
    for (const e of prontas) Object.assign(e, { status: 'rodando', reservadaAte: reservaAte, atualizadaEm: agora });
    return prontas.map(copia);
  }
  async paradas(automacaoId: string, funilId: string, tagId: string, ate: Date, limite: number) {
    const r: Array<{ conversaId: string; desde: Date }> = [];
    for (const m of await this.tags.etapasDoFunil(funilId)) {
      if (m.tagId !== tagId || m.desde.getTime() > ate.getTime()) continue;
      const chave = chaveParada(tagId, m.desde);
      const ja = [...this.execs.values()].some(
        (e) => e.automacaoId === automacaoId && e.conversaId === m.conversaId && (e.chave === chave || (!e.teste && ATIVOS.includes(e.status))),
      );
      if (!ja) r.push({ conversaId: m.conversaId, desde: m.desde });
    }
    return r.sort((a, b) => a.desde.getTime() - b.desde.getTime()).slice(0, limite);
  }
  async registrarEnvio(conversaId: string, em: Date) {
    this.envios.push({ conversaId, em });
  }
  async contarEnvios(conversaId: string, desde: Date) {
    return this.envios.filter((x) => x.conversaId === conversaId && x.em.getTime() >= desde.getTime()).length;
  }
  async objetivo(conversaId: string) {
    const o = this.objetivos.get(conversaId);
    return o ? { ...o } : undefined;
  }
  async definirObjetivo(conversaId: string, o: { objetivo: string; desde: Date; ate: Date; automacaoId: string } | null) {
    if (!o) this.objetivos.delete(conversaId);
    else this.objetivos.set(conversaId, { objetivo: o.objetivo, ate: o.ate, automacaoId: o.automacaoId });
  }
  async config(empresaId: string) {
    return { ...(this.configs.get(empresaId) ?? CONFIG_PADRAO) };
  }
  async salvarConfig(empresaId: string, c: ConfigAutomacoes) {
    this.configs.set(empresaId, { ...c });
  }
}

// ---------------------------------------------------------------- Postgres

interface LinhaAutomacao {
  id: string;
  empresa_id: string;
  funil_id: string | null;
  nome: string;
  ligada: boolean;
  gatilho: Gatilho;
  passos: Passo[];
  opcoes: Opcoes;
  criada_por: string | null;
  criada_em: Date;
  atualizada_em: Date;
}
const paraAutomacao = (l: LinhaAutomacao): Automacao => ({
  id: l.id,
  empresaId: l.empresa_id,
  funilId: l.funil_id,
  nome: l.nome,
  ligada: l.ligada,
  gatilho: l.gatilho,
  passos: l.passos,
  opcoes: { parar_se_equipe_responder: l.opcoes?.parar_se_equipe_responder ?? true },
  criadaPor: l.criada_por,
  criadaEm: l.criada_em,
  atualizadaEm: l.atualizada_em,
});
const COLUNAS_AUTOMACAO = 'id::text, empresa_id, funil_id::text, nome, ligada, gatilho, passos, opcoes, criada_por, criada_em, atualizada_em';

interface LinhaExecucao {
  id: string;
  automacao_id: string;
  conversa_id: string;
  chave: string;
  status: StatusExecucao;
  fila: Passo[];
  feitos: number;
  profundidade: number;
  teste: boolean;
  proxima_em: Date;
  reservada_ate: Date | null;
  log: RegistroPasso[];
  erro: string | null;
  criada_em: Date;
  atualizada_em: Date;
}
const paraExecucao = (l: LinhaExecucao): Execucao => ({
  id: l.id,
  automacaoId: l.automacao_id,
  conversaId: l.conversa_id,
  chave: l.chave,
  status: l.status,
  fila: l.fila,
  feitos: l.feitos,
  profundidade: l.profundidade,
  teste: l.teste,
  proximaEm: l.proxima_em,
  reservadaAte: l.reservada_ate,
  log: l.log,
  erro: l.erro,
  criadaEm: l.criada_em,
  atualizadaEm: l.atualizada_em,
});
const COLUNAS_EXECUCAO =
  'id::text, automacao_id::text, conversa_id::text, chave, status, fila, feitos, profundidade, teste, proxima_em, reservada_ate, log, erro, criada_em, atualizada_em';

export class ArmazemAutomacoesPostgres implements ArmazemAutomacoes {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string) {
    const { rows } = await this.pool.query<LinhaAutomacao>(`select ${COLUNAS_AUTOMACAO} from sintonia.automacoes where empresa_id = $1`, [empresaId]);
    return rows.map(paraAutomacao);
  }
  async buscar(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaAutomacao>(`select ${COLUNAS_AUTOMACAO} from sintonia.automacoes where id = $1`, [id]);
    return rows[0] ? paraAutomacao(rows[0]) : undefined;
  }
  async salvar(a: Automacao) {
    await this.pool.query(
      `insert into sintonia.automacoes (id, empresa_id, funil_id, nome, ligada, gatilho, passos, opcoes, criada_por, criada_em, atualizada_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do update set funil_id = excluded.funil_id, nome = excluded.nome, ligada = excluded.ligada,
         gatilho = excluded.gatilho, passos = excluded.passos, opcoes = excluded.opcoes, atualizada_em = excluded.atualizada_em`,
      [a.id, a.empresaId, a.funilId, a.nome, a.ligada, JSON.stringify(a.gatilho), JSON.stringify(a.passos), JSON.stringify(a.opcoes), a.criadaPor, a.criadaEm, a.atualizadaEm],
    );
  }
  async apagar(id: string) {
    await this.pool.query('delete from sintonia.automacoes where id = $1', [id]);
  }
  async apagarDoFunil(funilId: string) {
    await this.pool.query('delete from sintonia.automacoes where funil_id = $1', [funilId]);
  }
  async criarExecucao(e: Execucao) {
    const r = await this.pool.query(
      `insert into sintonia.automacao_execucoes (id, automacao_id, conversa_id, chave, status, fila, feitos, profundidade, teste, proxima_em, reservada_ate, log, erro, criada_em, atualizada_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict do nothing`,
      [e.id, e.automacaoId, e.conversaId, e.chave, e.status, JSON.stringify(e.fila), e.feitos, e.profundidade, e.teste, e.proximaEm, e.reservadaAte, JSON.stringify(e.log), e.erro, e.criadaEm, e.atualizadaEm],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async salvarExecucao(e: Execucao) {
    await this.pool.query(
      `update sintonia.automacao_execucoes set status = $2, fila = $3, feitos = $4, proxima_em = $5, reservada_ate = $6, log = $7, erro = $8, atualizada_em = $9
        where id = $1`,
      [e.id, e.status, JSON.stringify(e.fila), e.feitos, e.proximaEm, e.reservadaAte, JSON.stringify(e.log), e.erro, e.atualizadaEm],
    );
  }
  async execucao(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaExecucao>(`select ${COLUNAS_EXECUCAO} from sintonia.automacao_execucoes where id = $1`, [id]);
    return rows[0] ? paraExecucao(rows[0]) : undefined;
  }
  async execucoes(automacaoId: string, limite: number) {
    const { rows } = await this.pool.query<LinhaExecucao>(
      `select ${COLUNAS_EXECUCAO} from sintonia.automacao_execucoes where automacao_id = $1 order by criada_em desc, id limit $2`,
      [automacaoId, limite],
    );
    return rows.map(paraExecucao);
  }
  async ativasDaConversa(conversaId: string) {
    const { rows } = await this.pool.query<LinhaExecucao>(
      `select ${COLUNAS_EXECUCAO} from sintonia.automacao_execucoes where conversa_id = $1 and status in ('pendente', 'rodando') order by criada_em`,
      [conversaId],
    );
    return rows.map(paraExecucao);
  }
  async reivindicar(agora: Date, reservaAte: Date, o: { conversaId?: string; limite: number }) {
    // "skip locked": dois processos nunca pegam a mesma execução.
    const { rows } = await this.pool.query<LinhaExecucao>(
      `update sintonia.automacao_execucoes set status = 'rodando', reservada_ate = $2, atualizada_em = $1
        where id in (
          select id from sintonia.automacao_execucoes
           where ((status = 'pendente' and proxima_em <= $1) or (status = 'rodando' and reservada_ate < $1))
             and ($3::uuid is null or conversa_id = $3::uuid)
           order by proxima_em, criada_em
           limit $4
           for update skip locked)
       returning ${COLUNAS_EXECUCAO}`,
      [agora, reservaAte, o.conversaId ?? null, o.limite],
    );
    return rows.map(paraExecucao).sort((a, b) => a.proximaEm.getTime() - b.proximaEm.getTime() || a.criadaEm.getTime() - b.criadaEm.getTime());
  }
  async paradas(automacaoId: string, funilId: string, tagId: string, ate: Date, limite: number) {
    const { rows } = await this.pool.query<{ conversa_id: string; marcada_em: Date }>(
      `select ct.conversa_id::text, ct.marcada_em
         from sintonia.conversa_tags ct
        where ct.funil_id = $2 and ct.tag_id = $3 and ct.marcada_em <= $4
          and not exists (
            select 1 from sintonia.automacao_execucoes e
             where e.automacao_id = $1 and e.conversa_id = ct.conversa_id
               and (e.chave = 'parada:' || ct.tag_id::text || ':' || to_char(ct.marcada_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                    or (e.status in ('pendente', 'rodando') and not e.teste)))
        order by ct.marcada_em
        limit $5`,
      [automacaoId, funilId, tagId, ate, limite],
    );
    return rows.map((r) => ({ conversaId: r.conversa_id, desde: r.marcada_em }));
  }
  async registrarEnvio(conversaId: string, em: Date) {
    await this.pool.query('insert into sintonia.automacao_envios (conversa_id, em) values ($1, $2)', [conversaId, em]);
  }
  async contarEnvios(conversaId: string, desde: Date) {
    const { rows } = await this.pool.query<{ n: number }>('select count(*)::int as n from sintonia.automacao_envios where conversa_id = $1 and em >= $2', [
      conversaId,
      desde,
    ]);
    return rows[0]?.n ?? 0;
  }
  async objetivo(conversaId: string) {
    const { rows } = await this.pool.query<{ objetivo: string; ate: Date; automacao_id: string | null }>(
      'select objetivo, ate, automacao_id::text from sintonia.conversa_objetivos where conversa_id = $1',
      [conversaId],
    );
    return rows[0] ? { objetivo: rows[0].objetivo, ate: rows[0].ate, automacaoId: rows[0].automacao_id } : undefined;
  }
  async definirObjetivo(conversaId: string, o: { objetivo: string; desde: Date; ate: Date; automacaoId: string } | null) {
    if (!o) {
      await this.pool.query('delete from sintonia.conversa_objetivos where conversa_id = $1', [conversaId]);
      return;
    }
    await this.pool.query(
      `insert into sintonia.conversa_objetivos (conversa_id, objetivo, automacao_id, desde, ate) values ($1, $2, $3, $4, $5)
       on conflict (conversa_id) do update set objetivo = excluded.objetivo, automacao_id = excluded.automacao_id, desde = excluded.desde, ate = excluded.ate`,
      [conversaId, o.objetivo, o.automacaoId, o.desde, o.ate],
    );
  }
  async config(empresaId: string) {
    const { rows } = await this.pool.query<{ limite_diario: number }>('select limite_diario from sintonia.automacoes_config where empresa_id = $1', [empresaId]);
    return rows[0] ? { limiteDiario: rows[0].limite_diario } : { ...CONFIG_PADRAO };
  }
  async salvarConfig(empresaId: string, c: ConfigAutomacoes, por: string) {
    await this.pool.query(
      `insert into sintonia.automacoes_config (empresa_id, limite_diario, atualizada_em, atualizada_por) values ($1, $2, now(), $3)
       on conflict (empresa_id) do update set limite_diario = excluded.limite_diario, atualizada_em = now(), atualizada_por = excluded.atualizada_por`,
      [empresaId, c.limiteDiario, por],
    );
  }
}

// ---------------------------------------------------------------- motor

/** O que a Sintonia oferece às automações (tudo já sob a trava da conversa, menos reavaliar). */
export interface SintoniaParaAutomacoes {
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined>;
  reavaliar(conversaId: string): Promise<void>;
  enviarAutomatico(c: Conversa, texto: string, autorNome: string): Promise<string>;
  canalDa(c: Conversa): CanalWhatsApp['tipo'];
  trocarDonaSobTrava(c: Conversa, para: { id: string; nome: string } | null, por: { id?: string; nome: string }, motivo: string): Promise<void>;
}

export interface OpcoesAutomacoes {
  armazem: ArmazemAutomacoes;
  repo: Repositorio;
  empresaId: string;
  /** Pode ser preenchida depois (a Sintonia é criada com os ganchos destas automações). */
  sintonia: () => SintoniaParaAutomacoes;
  funis: Funis;
  tags: Tags;
  contas?: Contas;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Quantas automações podem disparar em cadeia (uma disparando a outra). Padrão 3. */
  maxEncadeamento?: number;
}

/** Contexto da execução em andamento: quem dispara de dentro dela herda a profundidade. */
interface Contexto {
  profundidade: number;
  teste: boolean;
}

/** Resultado de um passo. */
type Efeito = { seguir: true; reavaliar?: boolean } | { esperarAte: Date; repetir?: boolean } | { parar: 'cancelada' | 'erro'; motivo: string };

const RESERVA_MS = 5 * MIN;
const LIMITE_LOG = 200;

export class Automacoes {
  readonly empresaId: string;
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly contexto = new AsyncLocalStorage<Contexto>();
  private readonly emAndamento = new Set<Promise<unknown>>();
  private readonly maxEncadeamento: number;

  constructor(private readonly o: OpcoesAutomacoes) {
    this.empresaId = o.empresaId;
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
    this.maxEncadeamento = o.maxEncadeamento ?? 3;
  }

  // ---------- cadastro ----------

  async listar(): Promise<Automacao[]> {
    return (await this.o.armazem.listar(this.empresaId)).sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime() || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async exigir(id: string): Promise<Automacao> {
    const a = await this.o.armazem.buscar(id);
    if (!a || a.empresaId !== this.empresaId) throw new ErroAutomacao('Automação não encontrada.', 404);
    return a;
  }

  async criar(bruto: unknown, por: string): Promise<Automacao> {
    const d = AutomacaoNova.parse(bruto);
    const agora = this.agora();
    const a: Automacao = {
      id: randomUUID(),
      empresaId: this.empresaId,
      funilId: d.funilId ?? null,
      nome: d.nome,
      ligada: d.ligada,
      gatilho: d.gatilho,
      passos: d.passos,
      opcoes: d.opcoes,
      criadaPor: por,
      criadaEm: agora,
      atualizadaEm: agora,
    };
    await this.validar(a);
    await this.o.armazem.salvar(a);
    return a;
  }

  async alterar(id: string, bruto: unknown): Promise<Automacao> {
    const atual = await this.exigir(id);
    const d = AutomacaoAlteracao.parse(bruto);
    const a: Automacao = {
      ...atual,
      nome: d.nome ?? atual.nome,
      funilId: d.funilId !== undefined ? d.funilId : atual.funilId,
      ligada: d.ligada ?? atual.ligada,
      gatilho: d.gatilho ?? atual.gatilho,
      passos: d.passos ?? atual.passos,
      opcoes: { ...atual.opcoes, ...Object.fromEntries(Object.entries(d.opcoes ?? {}).filter(([, v]) => v !== undefined)) },
      atualizadaEm: this.agora(),
    };
    await this.validar(a);
    await this.o.armazem.salvar(a);
    return a;
  }

  async ligar(id: string, ligada: boolean): Promise<Automacao> {
    const a = await this.exigir(id);
    if (a.ligada === ligada) return a;
    if (ligada) await this.validar(a); // etapas/tags podem ter sido apagadas desde que foi criada
    const nova = { ...a, ligada, atualizadaEm: this.agora() };
    await this.o.armazem.salvar(nova);
    return nova;
  }

  async apagar(id: string): Promise<void> {
    await this.exigir(id);
    await this.o.armazem.apagar(id);
  }

  async funilApagado(funilId: string): Promise<void> {
    await this.o.armazem.apagarDoFunil(funilId);
  }

  async execucoes(id: string, limite = 50): Promise<Execucao[]> {
    await this.exigir(id);
    return this.o.armazem.execucoes(id, limite);
  }

  async config(): Promise<ConfigAutomacoes> {
    return this.o.armazem.config(this.empresaId);
  }
  async alterarConfig(c: ConfigAutomacoes, por: string): Promise<ConfigAutomacoes> {
    await this.o.armazem.salvarConfig(this.empresaId, c, por);
    return this.config();
  }

  /** Confere ids (funil, etapas, tags, pessoas) e limites. Recusa com 400 dizendo qual passo. */
  private async validar(a: Automacao): Promise<void> {
    const erro = (msg: string) => new ErroAutomacao(msg, 400);
    if (a.funilId) await this.o.funis.exigir(a.funilId).catch(() => Promise.reject(erro('Funil da automação não encontrado.')));
    const todas = await this.o.tags.listar();
    const tag = (id: string | undefined) => (id ? todas.find((t) => t.id === id) : undefined);
    const g = a.gatilho;
    if (g.tipo === 'entrou_na_etapa' || g.tipo === 'parada_na_etapa') {
      const e = tag(g.etapaId);
      if (!e?.funilId) throw erro('Gatilho: etapa não encontrada.');
      if (a.funilId && e.funilId !== a.funilId) throw erro('Gatilho: a etapa é de outro funil.');
    }
    if (g.tipo === 'tag_marcada' && !tag(g.tagId)) throw erro('Gatilho: tag não encontrada.');

    let n = 0;
    for (const { passo: p, nivel } of percorrer(a.passos)) {
      n++;
      const onde = `Passo ${n} (${p.tipo})`;
      if (n > LIMITE_PASSOS) throw erro(`Uma automação pode ter até ${LIMITE_PASSOS} passos.`);
      if (nivel >= PROFUNDIDADE_CONDICAO) throw erro(`${onde}: condições podem ficar no máximo ${PROFUNDIDADE_CONDICAO} níveis uma dentro da outra.`);
      if (p.tipo === 'mover_etapa') {
        const e = tag(p.etapaId);
        if (!e || e.funilId !== p.funilId) throw erro(`${onde}: etapa não encontrada neste funil.`);
      }
      if (p.tipo === 'marcar_tag' || p.tipo === 'desmarcar_tag') {
        const t = tag(p.tagId);
        if (!t) throw erro(`${onde}: tag não encontrada.`);
        if (p.tipo === 'desmarcar_tag' && t.chaveSistema) throw erro(`${onde}: toda conversa fica no funil do sistema; use mover_etapa.`);
      }
      if (p.tipo === 'atribuir' && p.usuarioId && this.o.contas) {
        const u = await this.o.contas.buscarPorId(p.usuarioId).catch(() => undefined);
        if (!u || u.empresaId !== this.empresaId || !u.ativo) throw erro(`${onde}: pessoa não encontrada ou inativa.`);
      }
      if (p.tipo === 'condicao') {
        if (p.se === 'tem_tag' && !tag(p.valor)) throw erro(`${onde}: escolha a tag em "valor".`);
        if (p.se === 'modo' && !MODOS.includes(p.valor as (typeof MODOS)[number])) throw erro(`${onde}: "valor" deve ser ia, copiloto ou humano.`);
      }
    }
  }

  // ---------- disparos (chamados pelos ganchos, sob a trava da conversa: só registram) ----------

  /** Movimento de cartão: entrou_na_etapa e tag_marcada (etapa é tag). */
  async aoMover(m: MovimentoEtapa): Promise<void> {
    if (!m.para || m.conversa.empresaId !== this.empresaId) return;
    const para = m.para;
    await this.disparar(m.conversa, (g) => (g.tipo === 'entrou_na_etapa' && g.etapaId === para) || (g.tipo === 'tag_marcada' && g.tagId === para), `etapa:${para}:${randomUUID()}`);
  }

  /** Tag solta marcada. */
  async aoMarcarTag(c: Conversa, tag: Tag): Promise<void> {
    if (c.empresaId !== this.empresaId) return;
    await this.disparar(c, (g) => g.tipo === 'tag_marcada' && g.tagId === tag.id, `tag:${tag.id}:${randomUUID()}`);
  }

  /** Mensagem da cliente: nova_conversa (na primeira) e palavra_chave (o bot). */
  async mensagemCliente(c: Conversa, m: { texto: string; idExterno: string; primeira: boolean }): Promise<void> {
    if (c.empresaId !== this.empresaId) return;
    if (m.primeira) await this.disparar(c, (g) => g.tipo === 'nova_conversa' && (!g.unidade || g.unidade === c.unidade), 'nova_conversa');
    await this.disparar(c, (g) => g.tipo === 'palavra_chave' && casaPalavra(m.texto, g.palavras, g.modo), `msg:${m.idExterno || randomUUID()}`);
  }

  /** A equipe respondeu: execuções com envio pendente (e a opção ligada) param. */
  async equipeRespondeu(c: Conversa): Promise<void> {
    const ativas = await this.o.armazem.ativasDaConversa(c.id);
    for (const e of ativas) {
      if (![...percorrer(e.fila)].some((x) => x.passo.tipo === 'enviar_mensagem')) continue;
      const a = await this.o.armazem.buscar(e.automacaoId);
      if (a && !a.opcoes.parar_se_equipe_responder) continue;
      await this.encerrar(e, 'cancelada', 'A equipe respondeu a conversa.');
    }
  }

  /** Objetivo do fluxo de IA, se a conversa está com a IA e ainda vale. */
  async objetivoIa(c: Conversa): Promise<string | undefined> {
    if (c.modo !== 'ia') return undefined;
    const o = await this.o.armazem.objetivo(c.id);
    if (!o || o.ate.getTime() <= this.agora().getTime()) return undefined;
    return o.objetivo;
  }

  private async disparar(c: Conversa, casa: (g: Gatilho) => boolean, chave: string): Promise<void> {
    const ctx = this.contexto.getStore();
    if (ctx?.teste) return; // "Testar" não dispara outras automações
    const lista = (await this.o.armazem.listar(this.empresaId)).filter((a) => a.ligada && casa(a.gatilho));
    if (!lista.length) return;
    const profundidade = ctx ? ctx.profundidade + 1 : 0;
    if (profundidade > this.maxEncadeamento) {
      this.log('Automação não disparada: limite de encadeamento', { conversaId: c.id, automacoes: lista.map((a) => a.nome) });
      await this.o.repo.registrarEvento({
        tipo: 'falha',
        conversaId: c.id,
        unidade: c.unidade,
        em: this.agora(),
        dados: { etapa: 'automacao', erro: 'limite de encadeamento de automações', automacoes: lista.map((a) => a.id) },
      });
      return;
    }
    let criou = false;
    for (const a of lista) if (await this.novaExecucao(a, c.id, chave, profundidade, false)) criou = true;
    if (criou) this.rodarLogo(c.id);
  }

  private async novaExecucao(a: Automacao, conversaId: string, chave: string, profundidade: number, teste: boolean): Promise<Execucao | undefined> {
    const agora = this.agora();
    const e: Execucao = {
      id: randomUUID(),
      automacaoId: a.id,
      conversaId,
      chave,
      status: 'pendente',
      fila: copia(a.passos),
      feitos: 0,
      profundidade,
      teste,
      proximaEm: agora,
      reservadaAte: null,
      log: [{ em: agora.toISOString(), passo: 'inicio', ok: true, detalhe: teste ? 'Teste iniciado.' : `Disparada (${a.gatilho.tipo}).` }],
      erro: null,
      criadaEm: agora,
      atualizadaEm: agora,
    };
    return (await this.o.armazem.criarExecucao(e)) ? e : undefined;
  }

  /**
   * Roda as execuções prontas da conversa assim que a trava dela ficar livre (sem esperar aqui).
   * A trava é pedida JÁ (de forma síncrona): quem disparou ainda está com ela, e assim a automação roda
   * antes da IA pensar a resposta da mesma mensagem (o bot responde primeiro; a IA vê que já foi respondida).
   */
  private rodarLogo(conversaId: string): void {
    const p: Promise<unknown> = this.contexto.exit(() => this.rodarNaConversa(conversaId).catch((e) => this.log('Falha ao rodar automações', String(e))));
    this.emAndamento.add(p);
    void p.finally(() => this.emAndamento.delete(p));
  }

  /** Espera tudo que foi disparado terminar (testes e desligamento). */
  async ocioso(): Promise<void> {
    while (this.emAndamento.size) await Promise.allSettled([...this.emAndamento]);
  }

  /** Sob a trava da conversa: reserva as prontas (ou usa as já reservadas) e roda uma a uma. */
  private async rodarNaConversa(conversaId: string, jaReservadas?: Execucao[]): Promise<void> {
    const sintonia = this.o.sintonia();
    let reavaliar = false;
    const existe = await sintonia.comConversa(conversaId, async (c) => {
      const agora = this.agora();
      const lista = jaReservadas ?? (await this.o.armazem.reivindicar(agora, new Date(agora.getTime() + RESERVA_MS), { conversaId, limite: 20 }));
      for (const e of lista) if (await this.rodarSobTrava(e, c)) reavaliar = true;
      return true;
    });
    if (!existe) {
      for (const e of jaReservadas ?? []) await this.encerrar(e, 'cancelada', 'A conversa não existe mais.');
      return;
    }
    if (reavaliar) await sintonia.reavaliar(conversaId);
  }

  // ---------- relógio ----------

  /** Retoma "esperar"/"fora do horário" vencidos e execuções de um processo que caiu; dispara parada_na_etapa. */
  async tick(): Promise<void> {
    const agora = this.agora();
    for (const a of await this.o.armazem.listar(this.empresaId)) {
      if (!a.ligada || a.gatilho.tipo !== 'parada_na_etapa') continue;
      const g = a.gatilho;
      try {
        const etapa = await this.o.tags.exigir(g.etapaId).catch(() => undefined);
        if (!etapa?.funilId) continue;
        const ate = new Date(agora.getTime() - g.horas * 3600_000);
        const lista = await this.o.armazem.paradas(a.id, etapa.funilId, etapa.id, ate, 100);
        for (const p of lista) {
          if (await this.novaExecucao(a, p.conversaId, chaveParada(etapa.id, p.desde), 0, false)) this.rodarLogo(p.conversaId);
        }
      } catch (e) {
        this.log('Falha ao procurar conversas paradas', { automacao: a.id, erro: String(e) });
      }
    }
    await this.ocioso();
    for (let volta = 0; volta < 10; volta++) {
      const prontas = await this.o.armazem.reivindicar(agora, new Date(agora.getTime() + RESERVA_MS), { limite: 50 });
      if (!prontas.length) break;
      const porConversa = new Map<string, Execucao[]>();
      for (const e of prontas) porConversa.set(e.conversaId, [...(porConversa.get(e.conversaId) ?? []), e]);
      for (const [conversaId, lista] of porConversa) {
        await this.rodarNaConversa(conversaId, lista).catch((e) => this.log('Falha ao retomar automações', { conversaId, erro: String(e) }));
      }
      await this.ocioso();
    }
  }

  // ---------- testar ----------

  /**
   * Roda a automação agora na conversa (ligada ou não, sem olhar o gatilho) e devolve o que aconteceu.
   * No teste, "esperar" não espera, o horário da loja e o limite diário são só anotados, e outras automações não disparam.
   */
  async testar(id: string, conversaId: string): Promise<Execucao> {
    const a = await this.exigir(id);
    const e = await this.novaExecucao(a, conversaId, `teste:${randomUUID()}`, 0, true);
    if (!e) throw new ErroAutomacao('Não foi possível iniciar o teste.', 409);
    e.status = 'rodando';
    e.reservadaAte = new Date(this.agora().getTime() + RESERVA_MS);
    await this.o.armazem.salvarExecucao(e);
    await this.rodarNaConversa(conversaId, [e]);
    await this.ocioso();
    return (await this.o.armazem.execucao(e.id)) ?? e;
  }

  // ---------- execução ----------

  private anotar(e: Execucao, passo: RegistroPasso['passo'], ok: boolean, detalhe: string): void {
    e.log.push({ em: this.agora().toISOString(), passo, ok, detalhe });
    if (e.log.length > LIMITE_LOG) e.log.splice(1, e.log.length - LIMITE_LOG);
  }

  private async encerrar(e: Execucao, status: 'concluida' | 'cancelada' | 'erro', motivo?: string): Promise<void> {
    e.status = status;
    e.reservadaAte = null;
    e.atualizadaEm = this.agora();
    if (status !== 'concluida') e.erro = motivo ?? null;
    this.anotar(e, 'fim', status === 'concluida', motivo ?? 'Concluída.');
    await this.o.armazem.salvarExecucao(e);
  }

  /**
   * Roda uma execução já reservada (status "rodando"), já sob a trava da conversa, até acabar, esperar ou parar.
   * Devolve true se a IA precisa pensar de novo depois (modo/objetivo mudou).
   */
  private async rodarSobTrava(reservada: Execucao, c: Conversa): Promise<boolean> {
    const a = await this.o.armazem.buscar(reservada.automacaoId);
    // Pode ter sido cancelada (a equipe respondeu) enquanto esperava a trava.
    const e = await this.o.armazem.execucao(reservada.id);
    if (!a || !e || e.status !== 'rodando') return false;
    if (!a.ligada && !e.teste) {
      await this.encerrar(e, 'cancelada', 'A automação foi desligada.');
      return false;
    }
    let reavaliar = false;
    const ctx: Contexto = { profundidade: e.profundidade, teste: e.teste };
    await this.contexto.run(ctx, async () => {
      while (e.fila.length) {
        const passo = e.fila.shift()!;
        e.feitos++;
        e.atualizadaEm = this.agora();
        // A fila é gravada sem o passo ANTES de executá-lo: se o processo cair no meio, o passo não repete
        // (melhor perder um envio do que mandar duas vezes para a cliente).
        await this.o.armazem.salvarExecucao(e);
        let efeito: Efeito;
        try {
          efeito = await this.executarPasso(a, e, c, passo);
        } catch (erro) {
          efeito = { parar: 'erro', motivo: (erro as Error).message || String(erro) };
        }
        await this.o.repo.salvarConversa(c);
        if ('parar' in efeito) {
          await this.encerrar(e, efeito.parar, efeito.motivo);
          return;
        }
        if ('esperarAte' in efeito) {
          if (efeito.repetir) {
            e.fila.unshift(passo);
            e.feitos--;
          }
          e.status = 'pendente';
          e.proximaEm = efeito.esperarAte;
          e.reservadaAte = null;
          e.atualizadaEm = this.agora();
          await this.o.armazem.salvarExecucao(e);
          return;
        }
        if (efeito.reavaliar) reavaliar = true;
      }
      await this.encerrar(e, 'concluida');
    });
    return reavaliar;
  }

  private async executarPasso(a: Automacao, e: Execucao, c: Conversa, p: Passo): Promise<Efeito> {
    const agora = this.agora();
    const sintonia = this.o.sintonia();
    const por = { nome: `Automação: ${a.nome}`, id: null };
    const evento = (acao: string, dados: Record<string, unknown> = {}) =>
      this.o.repo.registrarEvento({ tipo: 'automacao', conversaId: c.id, unidade: c.unidade, em: agora, dados: { automacaoId: a.id, execucaoId: e.id, acao, teste: e.teste, ...dados } });
    const unidade = UNIDADES[c.unidade];

    switch (p.tipo) {
      case 'enviar_mensagem': {
        if (p.so_no_horario && !estaAberta(unidade, agora)) {
          const abre = proximaAbertura(unidade, agora);
          if (e.teste) this.anotar(e, p.tipo, true, `Fora do horário da loja (no teste, envia assim mesmo; de verdade esperaria ${abre ? `até ${dataISO(abre)} ${horaHHmm(abre)}` : 'a abertura'}).`);
          else {
            if (!abre) return { parar: 'erro', motivo: 'A unidade não tem horário de atendimento para enviar.' };
            this.anotar(e, p.tipo, true, `Fora do horário da loja: envio marcado para ${dataISO(abre)} às ${horaHHmm(abre)}.`);
            return { esperarAte: abre, repetir: true };
          }
        }
        if (!e.teste) {
          const { limiteDiario } = await this.config();
          const d = partesBahia(agora);
          const enviadas = await this.o.armazem.contarEnvios(c.id, bahia(d.ano, d.mes, d.dia));
          if (enviadas >= limiteDiario) return { parar: 'cancelada', motivo: `Limite de ${limiteDiario} mensagem(ns) automática(s) por dia nesta conversa.` };
        }
        if (sintonia.canalDa(c) === 'meta' && agora.getTime() - (c.ultimaMensagemCliente?.getTime() ?? 0) > DIA) {
          return { parar: 'erro', motivo: 'WhatsApp oficial: fora da janela de 24 h só com modelo aprovado pela Meta.' };
        }
        const texto = preencher(p.texto, { nome: c.nome, unidade: unidade.nome, atendente: c.responsavelNome });
        await sintonia.enviarAutomatico(c, texto, `Automação: ${a.nome}`);
        await this.o.armazem.registrarEnvio(c.id, agora);
        await evento('enviou', { texto });
        this.anotar(e, p.tipo, true, `Enviou: "${texto}"`);
        return { seguir: true };
      }
      case 'esperar': {
        if (e.teste) {
          this.anotar(e, p.tipo, true, `Esperaria ${p.minutos} min (no teste não espera).`);
          return { seguir: true };
        }
        const ate = new Date(agora.getTime() + p.minutos * MIN);
        this.anotar(e, p.tipo, true, `Esperando ${p.minutos} min (até ${dataISO(ate)} ${horaHHmm(ate)}).`);
        return { esperarAte: ate };
      }
      case 'mudar_modo': {
        c.modo = p.modo;
        c.pausaIaAte = undefined;
        await evento('mudou_modo', { modo: p.modo });
        this.anotar(e, p.tipo, true, `Modo: ${p.modo}.`);
        return { seguir: true, reavaliar: p.modo !== 'humano' };
      }
      case 'fluxo_ia': {
        c.modo = 'ia';
        c.pausaIaAte = undefined;
        await this.o.armazem.definirObjetivo(c.id, { objetivo: p.objetivo, desde: agora, ate: new Date(agora.getTime() + p.dias * DIA), automacaoId: a.id });
        await evento('fluxo_ia', { objetivo: p.objetivo });
        this.anotar(e, p.tipo, true, `IA conduzindo com o objetivo: "${p.objetivo}".`);
        return { seguir: true, reavaliar: true };
      }
      case 'mover_etapa': {
        const r = await this.o.funis.moverSobTrava(c, p.funilId, p.etapaId, por, true);
        this.anotar(e, p.tipo, true, r.mudou ? 'Moveu de etapa.' : 'Já estava nesta etapa.');
        return { seguir: true };
      }
      case 'marcar_tag': {
        const tag = await this.o.tags.exigir(p.tagId);
        let mudou: boolean;
        if (tag.funilId) mudou = (await this.o.funis.moverSobTrava(c, tag.funilId, tag.id, por, true)).mudou;
        else mudou = (await this.o.tags.marcar(c, tag.id, por.nome)).mudou;
        if (mudou) await this.o.repo.registrarEvento({ tipo: 'tag_marcada', conversaId: c.id, unidade: c.unidade, em: agora, dados: { tagId: tag.id, nome: tag.nome, por: por.nome, porId: null } });
        this.anotar(e, p.tipo, true, mudou ? `Marcou "${tag.nome}".` : `"${tag.nome}" já estava marcada.`);
        return { seguir: true };
      }
      case 'desmarcar_tag': {
        const tag = await this.o.tags.exigir(p.tagId);
        let mudou = false;
        if (tag.funilId) {
          if (await this.o.tags.temTag(c.id, tag.id)) mudou = (await this.o.funis.moverSobTrava(c, tag.funilId, null, por, true)).mudou;
        } else mudou = (await this.o.tags.desmarcar(c, tag.id, por.nome)).mudou;
        if (mudou) await this.o.repo.registrarEvento({ tipo: 'tag_desmarcada', conversaId: c.id, unidade: c.unidade, em: agora, dados: { tagId: tag.id, nome: tag.nome, por: por.nome, porId: null } });
        this.anotar(e, p.tipo, true, mudou ? `Desmarcou "${tag.nome}".` : `"${tag.nome}" não estava marcada.`);
        return { seguir: true };
      }
      case 'atribuir': {
        if (p.unidade && p.unidade !== c.unidade) {
          this.anotar(e, p.tipo, true, `Pulado: a conversa não é da unidade ${UNIDADES[p.unidade].nome}.`);
          return { seguir: true };
        }
        if (!p.usuarioId) {
          await sintonia.trocarDonaSobTrava(c, null, { nome: por.nome }, 'automacao');
          this.anotar(e, p.tipo, true, 'Conversa sem dona.');
          return { seguir: true };
        }
        const alvo = this.o.contas ? await this.o.contas.buscarPorId(p.usuarioId).catch(() => undefined) : undefined;
        if (!alvo || !podeReceber(alvo, c)) {
          this.anotar(e, p.tipo, false, 'Pulado: a pessoa não está ativa ou não atende esta unidade.');
          return { seguir: true };
        }
        await sintonia.trocarDonaSobTrava(c, { id: alvo.id, nome: alvo.nome }, { nome: por.nome }, 'automacao');
        this.anotar(e, p.tipo, true, `Dona: ${alvo.nome}.`);
        return { seguir: true };
      }
      case 'lembrete_ligacao': {
        const quando = new Date(agora.getTime() + p.em_minutos * MIN);
        const texto = p.texto ? preencher(p.texto, { nome: c.nome, unidade: unidade.nome, atendente: c.responsavelNome }) : `Ligar (automação ${a.nome})`;
        await this.o.repo.registrarEvento({
          tipo: 'lembrete_ligacao',
          conversaId: c.id,
          unidade: c.unidade,
          em: agora,
          dados: { quando: quando.toISOString(), texto, automacaoId: a.id, automacaoNome: a.nome, teste: e.teste },
        });
        this.anotar(e, p.tipo, true, `Lembrete de ligação para ${dataISO(quando)} ${horaHHmm(quando)}.`);
        return { seguir: true };
      }
      case 'condicao': {
        let vale: boolean;
        if (p.se === 'cliente_respondeu') vale = (c.ultimaMensagemCliente?.getTime() ?? 0) > e.criadaEm.getTime();
        else if (p.se === 'tem_tag') vale = Boolean(p.valor) && (await this.o.tags.temTag(c.id, p.valor!));
        else if (p.se === 'modo') vale = c.modo === p.valor;
        else vale = estaAberta(unidade, agora);
        const ramo = vale ? p.entao : p.senao;
        e.fila.unshift(...copia(ramo));
        this.anotar(e, p.tipo, true, `${p.se}${p.valor ? ` = ${p.valor}` : ''}: ${vale ? 'sim' : 'não'} (${ramo.length} passo(s)).`);
        return { seguir: true };
      }
    }
  }
}

/**
 * Liga tags ⇄ funis ⇄ automações e devolve os ganchos para a Sintonia.
 * Use o mesmo em produção (src/index.ts) e nos testes.
 */
export function ligarFunis(o: { tags: Tags; funis: Funis; automacoes?: Automacoes }): GanchosSintonia {
  const { tags, funis, automacoes } = o;
  tags.usarFunis(funis);
  if (automacoes) {
    funis.aoMover((m) => automacoes.aoMover(m));
    funis.aoApagar((id) => automacoes.funilApagado(id));
    tags.aoMarcar((c, tag) => automacoes.aoMarcarTag(c, tag));
  }
  return {
    etapaMudou: (c, de, para, por) => funis.etapaDoSistemaMudou(c, de, para, por),
    mensagemCliente: async (c, m) => {
      await funis.garantirNoSistema(c);
      await automacoes?.mensagemCliente(c, m);
    },
    equipeRespondeu: async (c) => {
      await automacoes?.equipeRespondeu(c);
    },
    objetivoIa: async (c) => automacoes?.objetivoIa(c),
  };
}
