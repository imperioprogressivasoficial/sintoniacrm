import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Contas } from '../auth/contas.js';
import { podeReceber } from '../auth/acesso.js';
import type { Tag, Tags } from '../tags/tags.js';
import type { Funis, MovimentoEtapa } from '../funis/funis.js';
import type { GanchosSintonia } from '../app/sintonia.js';
import type { CanalWhatsApp, MidiaEnvio } from '../channels/tipos.js';
import type { ArmazemAutomacoes } from '../automacoes/automacoes.js';
import { casaPalavra, normalizar, preencher } from '../automacoes/esquema.js';
import { contatoVazio, validarCampos, type ArmazemContatos } from '../contatos/contatos.js';
import { tipoPeloMimetype } from '../midia.js';
import { estaAberta, proximaAbertura } from '../engine/horario.js';
import { UNIDADES } from '../unidades.js';
import { bahia, DIA, horaHHmm, MIN, partesBahia, dataISO } from '../util/tempo.js';
import {
  casarOpcao,
  FluxoAlteracao,
  FluxoNovo,
  Grafo,
  INVALIDA_PADRAO,
  nomeDoTipo,
  preencherVariaveis,
  problemasDoGrafo,
  saidasDe,
  textoComOpcoes,
  validarResposta,
  type GatilhoBot,
  type No,
  type OpcoesBot,
  type Problema,
} from './esquema.js';
import { MODELOS } from './modelos.js';

/**
 * Motor dos bots (fluxos em grafo). Segue o mesmo jeito das automações (src/automacoes):
 * - cada disparo vira uma EXECUÇÃO gravada, com o bloco atual, a espera, as variáveis e o caminho percorrido;
 * - tudo roda sob a trava da conversa; "esperar" e "esperar resposta" deixam a execução pendente com hora marcada
 *   e o relógio (tick) retoma, mesmo depois de reiniciar o servidor;
 * - a resposta da cliente retoma a execução no bloco que estava esperando (antes da IA pensar: o bot responde primeiro);
 * - enquanto o bot conduz, a IA fica quieta (gancho botNoControle), menos no bloco "Agente de IA";
 * - se a equipe responder, o bot para (opção do fluxo); um bot por vez em cada conversa;
 * - o bloco é gravado como "em execução" ANTES de rodar: se o processo cair no meio, ele não repete (nunca envia duas vezes).
 */

export interface Fluxo {
  id: string;
  empresaId: string;
  nome: string;
  descricao: string | null;
  ligado: boolean;
  rascunho: Grafo;
  publicado: Grafo | null;
  versao: number;
  publicadoEm: Date | null;
  publicadoPor: string | null;
  opcoes: OpcoesBot;
  criadoPor: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

export type StatusBot = 'pendente' | 'rodando' | 'concluida' | 'cancelada' | 'erro';

export interface Espera {
  tipo: 'tempo' | 'resposta' | 'agente';
  no: string;
  /** ISO. */
  desde: string;
  /** ISO (tempo limite); null = sem limite. */
  ate: string | null;
  tentativas?: number;
  objetivo?: string;
  agenteIaId?: string;
}

export interface EstadoBot {
  noAtual: string | null;
  /** Bloco que começou a rodar e não terminou (se o processo caiu no meio, não repete). */
  emExecucao: string | null;
  espera: Espera | null;
  /** Resposta da cliente que chegou durante a espera (ainda não usada). */
  entrada: { texto: string; em: string } | null;
  /** O agente de IA cumpriu a condição de saída. */
  agenteConcluiu?: boolean;
  vars: Record<string, string>;
  /** Ids dos blocos por onde passou, em ordem (a tela desenha o caminho). */
  caminho: string[];
  passos: number;
  envios: number;
}

export interface RegistroBot {
  em: string;
  no: string | null;
  tipo: No['tipo'] | 'inicio_exec' | 'fim';
  ok: boolean;
  detalhe: string;
}

export interface ExecucaoBot {
  id: string;
  fluxoId: string;
  conversaId: string;
  chave: string;
  status: StatusBot;
  teste: boolean;
  versao: number;
  grafo: Grafo;
  estado: EstadoBot;
  log: RegistroBot[];
  erro: string | null;
  proximaEm: Date;
  reservadaAte: Date | null;
  criadaEm: Date;
  atualizadaEm: Date;
}

export interface MidiaBot {
  id: string;
  empresaId: string;
  nome: string | null;
  mimetype: string;
  conteudo: Buffer;
}

export class ErroBot extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
    readonly problemas?: Problema[],
  ) {
    super(message);
  }
}

export interface ArmazemBots {
  listar(empresaId: string): Promise<Fluxo[]>;
  buscar(id: string): Promise<Fluxo | undefined>;
  salvar(f: Fluxo): Promise<void>;
  apagar(id: string): Promise<void>;
  /** false se o evento já disparou este fluxo nesta conversa, ou se a conversa já tem um bot ativo (fora testes). */
  criarExecucao(e: ExecucaoBot): Promise<boolean>;
  salvarExecucao(e: ExecucaoBot): Promise<void>;
  execucao(id: string): Promise<ExecucaoBot | undefined>;
  execucoes(fluxoId: string, limite: number): Promise<ExecucaoBot[]>;
  ativasDaConversa(conversaId: string): Promise<ExecucaoBot[]>;
  /** Pendentes no bloco "Agente de IA" (o relógio confere a condição de saída). */
  comAgente(limite: number): Promise<ExecucaoBot[]>;
  reivindicar(agora: Date, reservaAte: Date, o: { conversaId?: string; limite: number }): Promise<ExecucaoBot[]>;
  guardarMidia(m: MidiaBot): Promise<void>;
  midia(id: string): Promise<MidiaBot | undefined>;
}

const ATIVOS: StatusBot[] = ['pendente', 'rodando'];
const copia = <T>(x: T): T => structuredClone(x);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------- memória

export class ArmazemBotsMemoria implements ArmazemBots {
  private readonly fluxos = new Map<string, Fluxo>();
  private readonly execs = new Map<string, ExecucaoBot>();
  private readonly midias = new Map<string, MidiaBot>();

  async listar(empresaId: string) {
    return [...this.fluxos.values()].filter((f) => f.empresaId === empresaId).map(copia);
  }
  async buscar(id: string) {
    const f = this.fluxos.get(id);
    return f ? copia(f) : undefined;
  }
  async salvar(f: Fluxo) {
    this.fluxos.set(f.id, copia(f));
  }
  async apagar(id: string) {
    this.fluxos.delete(id);
    for (const [k, e] of this.execs) if (e.fluxoId === id) this.execs.delete(k);
  }
  async criarExecucao(e: ExecucaoBot) {
    for (const x of this.execs.values()) {
      if (x.fluxoId === e.fluxoId && x.conversaId === e.conversaId && x.chave === e.chave) return false;
      if (!e.teste && !x.teste && x.conversaId === e.conversaId && ATIVOS.includes(x.status)) return false;
    }
    this.execs.set(e.id, copia(e));
    return true;
  }
  async salvarExecucao(e: ExecucaoBot) {
    if (this.execs.has(e.id)) this.execs.set(e.id, copia(e));
  }
  async execucao(id: string) {
    const e = this.execs.get(id);
    return e ? copia(e) : undefined;
  }
  async execucoes(fluxoId: string, limite: number) {
    return [...this.execs.values()]
      .filter((e) => e.fluxoId === fluxoId)
      .sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())
      .slice(0, limite)
      .map(copia);
  }
  async ativasDaConversa(conversaId: string) {
    return [...this.execs.values()]
      .filter((e) => e.conversaId === conversaId && ATIVOS.includes(e.status))
      .sort((a, b) => a.criadaEm.getTime() - b.criadaEm.getTime())
      .map(copia);
  }
  async comAgente(limite: number) {
    return [...this.execs.values()].filter((e) => e.status === 'pendente' && e.estado.espera?.tipo === 'agente').slice(0, limite).map(copia);
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
  async guardarMidia(m: MidiaBot) {
    this.midias.set(m.id, { ...m });
  }
  async midia(id: string) {
    const m = this.midias.get(id);
    return m ? { ...m } : undefined;
  }
}

// ---------------------------------------------------------------- Postgres

interface LinhaFluxo {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string | null;
  ligado: boolean;
  rascunho: Grafo;
  publicado: Grafo | null;
  versao: number;
  publicado_em: Date | null;
  publicado_por: string | null;
  opcoes: OpcoesBot;
  criado_por: string | null;
  criado_em: Date;
  atualizado_em: Date;
}
const paraFluxo = (l: LinhaFluxo): Fluxo => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  descricao: l.descricao,
  ligado: l.ligado,
  rascunho: l.rascunho,
  publicado: l.publicado,
  versao: l.versao,
  publicadoEm: l.publicado_em,
  publicadoPor: l.publicado_por,
  opcoes: { parar_se_equipe_responder: l.opcoes?.parar_se_equipe_responder ?? true },
  criadoPor: l.criado_por,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
});
const COLUNAS_FLUXO = 'id::text, empresa_id, nome, descricao, ligado, rascunho, publicado, versao, publicado_em, publicado_por, opcoes, criado_por, criado_em, atualizado_em';

interface LinhaExec {
  id: string;
  fluxo_id: string;
  conversa_id: string;
  chave: string;
  status: StatusBot;
  teste: boolean;
  versao: number;
  grafo: Grafo;
  estado: EstadoBot;
  log: RegistroBot[];
  erro: string | null;
  proxima_em: Date;
  reservada_ate: Date | null;
  criada_em: Date;
  atualizada_em: Date;
}
const paraExec = (l: LinhaExec): ExecucaoBot => ({
  id: l.id,
  fluxoId: l.fluxo_id,
  conversaId: l.conversa_id,
  chave: l.chave,
  status: l.status,
  teste: l.teste,
  versao: l.versao,
  grafo: l.grafo,
  estado: l.estado,
  log: l.log,
  erro: l.erro,
  proximaEm: l.proxima_em,
  reservadaAte: l.reservada_ate,
  criadaEm: l.criada_em,
  atualizadaEm: l.atualizada_em,
});
const COLUNAS_EXEC = 'id::text, fluxo_id::text, conversa_id::text, chave, status, teste, versao, grafo, estado, log, erro, proxima_em, reservada_ate, criada_em, atualizada_em';

export class ArmazemBotsPostgres implements ArmazemBots {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string) {
    const { rows } = await this.pool.query<LinhaFluxo>(`select ${COLUNAS_FLUXO} from sintonia.bot_fluxos where empresa_id = $1`, [empresaId]);
    return rows.map(paraFluxo);
  }
  async buscar(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaFluxo>(`select ${COLUNAS_FLUXO} from sintonia.bot_fluxos where id = $1`, [id]);
    return rows[0] ? paraFluxo(rows[0]) : undefined;
  }
  async salvar(f: Fluxo) {
    await this.pool.query(
      `insert into sintonia.bot_fluxos (id, empresa_id, nome, descricao, ligado, rascunho, publicado, versao, publicado_em, publicado_por, opcoes, criado_por, criado_em, atualizado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (id) do update set nome = excluded.nome, descricao = excluded.descricao, ligado = excluded.ligado, rascunho = excluded.rascunho,
         publicado = excluded.publicado, versao = excluded.versao, publicado_em = excluded.publicado_em, publicado_por = excluded.publicado_por,
         opcoes = excluded.opcoes, atualizado_em = excluded.atualizado_em`,
      [
        f.id,
        f.empresaId,
        f.nome,
        f.descricao,
        f.ligado,
        JSON.stringify(f.rascunho),
        f.publicado ? JSON.stringify(f.publicado) : null,
        f.versao,
        f.publicadoEm,
        f.publicadoPor,
        JSON.stringify(f.opcoes),
        f.criadoPor,
        f.criadoEm,
        f.atualizadoEm,
      ],
    );
  }
  async apagar(id: string) {
    await this.pool.query('delete from sintonia.bot_fluxos where id = $1', [id]);
  }
  async criarExecucao(e: ExecucaoBot) {
    const r = await this.pool.query(
      `insert into sintonia.bot_execucoes (id, fluxo_id, conversa_id, chave, status, teste, versao, grafo, estado, log, erro, proxima_em, reservada_ate, criada_em, atualizada_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict do nothing`,
      [e.id, e.fluxoId, e.conversaId, e.chave, e.status, e.teste, e.versao, JSON.stringify(e.grafo), JSON.stringify(e.estado), JSON.stringify(e.log), e.erro, e.proximaEm, e.reservadaAte, e.criadaEm, e.atualizadaEm],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async salvarExecucao(e: ExecucaoBot) {
    await this.pool.query(
      `update sintonia.bot_execucoes set status = $2, estado = $3, log = $4, erro = $5, proxima_em = $6, reservada_ate = $7, atualizada_em = $8 where id = $1`,
      [e.id, e.status, JSON.stringify(e.estado), JSON.stringify(e.log), e.erro, e.proximaEm, e.reservadaAte, e.atualizadaEm],
    );
  }
  async execucao(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaExec>(`select ${COLUNAS_EXEC} from sintonia.bot_execucoes where id = $1`, [id]);
    return rows[0] ? paraExec(rows[0]) : undefined;
  }
  async execucoes(fluxoId: string, limite: number) {
    const { rows } = await this.pool.query<LinhaExec>(`select ${COLUNAS_EXEC} from sintonia.bot_execucoes where fluxo_id = $1 order by criada_em desc, id limit $2`, [fluxoId, limite]);
    return rows.map(paraExec);
  }
  async ativasDaConversa(conversaId: string) {
    const { rows } = await this.pool.query<LinhaExec>(
      `select ${COLUNAS_EXEC} from sintonia.bot_execucoes where conversa_id = $1 and status in ('pendente', 'rodando') order by criada_em`,
      [conversaId],
    );
    return rows.map(paraExec);
  }
  async comAgente(limite: number) {
    const { rows } = await this.pool.query<LinhaExec>(
      `select ${COLUNAS_EXEC} from sintonia.bot_execucoes where status = 'pendente' and estado->'espera'->>'tipo' = 'agente' order by proxima_em limit $1`,
      [limite],
    );
    return rows.map(paraExec);
  }
  async reivindicar(agora: Date, reservaAte: Date, o: { conversaId?: string; limite: number }) {
    const { rows } = await this.pool.query<LinhaExec>(
      `update sintonia.bot_execucoes set status = 'rodando', reservada_ate = $2, atualizada_em = $1
        where id in (
          select id from sintonia.bot_execucoes
           where ((status = 'pendente' and proxima_em <= $1) or (status = 'rodando' and reservada_ate < $1))
             and ($3::uuid is null or conversa_id = $3::uuid)
           order by proxima_em, criada_em
           limit $4
           for update skip locked)
       returning ${COLUNAS_EXEC}`,
      [agora, reservaAte, o.conversaId ?? null, o.limite],
    );
    return rows.map(paraExec).sort((a, b) => a.proximaEm.getTime() - b.proximaEm.getTime() || a.criadaEm.getTime() - b.criadaEm.getTime());
  }
  async guardarMidia(m: MidiaBot) {
    await this.pool.query('insert into sintonia.bot_midias (id, empresa_id, nome, mimetype, conteudo) values ($1, $2, $3, $4, $5)', [m.id, m.empresaId, m.nome, m.mimetype, m.conteudo]);
  }
  async midia(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<{ id: string; empresa_id: string; nome: string | null; mimetype: string; conteudo: Buffer }>(
      'select id::text, empresa_id, nome, mimetype, conteudo from sintonia.bot_midias where id = $1',
      [id],
    );
    const r = rows[0];
    return r ? { id: r.id, empresaId: r.empresa_id, nome: r.nome, mimetype: r.mimetype, conteudo: r.conteudo } : undefined;
  }
}

// ---------------------------------------------------------------- motor

export interface SintoniaParaBots {
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined>;
  reavaliar(conversaId: string): Promise<void>;
  enviarAutomatico(c: Conversa, texto: string, autorNome: string): Promise<string>;
  enviarMidiaAutomatico?(c: Conversa, midia: MidiaEnvio, autorNome: string): Promise<string>;
  canalDa(c: Conversa): CanalWhatsApp['tipo'];
  trocarDonaSobTrava(c: Conversa, para: { id: string; nome: string } | null, por: { id?: string; nome: string }, motivo: string): Promise<void>;
}

export interface OpcoesBots {
  armazem: ArmazemBots;
  repo: Repositorio;
  empresaId: string;
  sintonia: () => SintoniaParaBots;
  funis: Funis;
  tags: Tags;
  contas?: Contas;
  /** Ficha da cliente (pergunta aberta salva num campo). */
  contatos?: ArmazemContatos;
  /** Limite diário compartilhado com as automações (mensagens que não respondem a cliente contam). */
  envios?: Pick<ArmazemAutomacoes, 'registrarEnvio' | 'contarEnvios' | 'config'>;
  /** Estúdio "Agentes de IA" (opcional): instruções do agente escolhido no bloco. Ausente = agente padrão. */
  agentesIa?: { instrucoes(agenteIaId: string): Promise<string | undefined> };
  fetch?: typeof fetch;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

type Efeito =
  | { ir: string; reavaliar?: boolean }
  | { esperar: Espera; ate: Date | null; reavaliar?: boolean }
  | { fim: 'concluida' | 'cancelada' | 'erro'; motivo?: string };

const RESERVA_MS = 5 * MIN;
const LIMITE_LOG = 300;
/** Blocos por rodada (um laço sem espera para aqui). */
const PASSOS_POR_RODADA = 60;
/** Mensagens por execução (proteção contra laço com espera). */
const ENVIOS_POR_EXECUCAO = 60;
/** "Esperar" curto (ex.: pausa entre mensagens): o bot continua no controle e a IA não entra. */
const ESPERA_CURTA_MS = 15 * MIN;
/** A cliente escreveu há menos que isto: mensagem do bot é resposta (não conta no limite diário). */
const CONVERSA_ATIVA_MS = 30 * MIN;

export class Bots {
  readonly empresaId: string;
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly emAndamento = new Set<Promise<unknown>>();

  constructor(private readonly o: OpcoesBots) {
    this.empresaId = o.empresaId;
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  // ---------- cadastro ----------

  modelos() {
    return MODELOS.map((m) => ({ id: m.id, nome: m.nome, descricao: m.descricao, grafo: copia(m.grafo) }));
  }

  async listar(): Promise<Fluxo[]> {
    return (await this.o.armazem.listar(this.empresaId)).sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime() || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async exigir(id: string): Promise<Fluxo> {
    const f = await this.o.armazem.buscar(id);
    if (!f || f.empresaId !== this.empresaId) throw new ErroBot('Bot não encontrado.', 404);
    return f;
  }

  async criar(bruto: unknown, por: string): Promise<Fluxo> {
    const d = FluxoNovo.parse(bruto);
    let rascunho: Grafo = d.rascunho ?? { nos: [{ id: 'inicio', tipo: 'inicio', x: 0, y: 0, gatilho: { tipo: 'manual' } }], ligacoes: [] };
    if (d.modelo) {
      const m = MODELOS.find((x) => x.id === d.modelo);
      if (!m) throw new ErroBot('Modelo não encontrado.', 404);
      rascunho = Grafo.parse(copia(m.grafo));
    }
    const agora = this.agora();
    const f: Fluxo = {
      id: randomUUID(),
      empresaId: this.empresaId,
      nome: d.nome,
      descricao: d.descricao ?? null,
      ligado: false,
      rascunho,
      publicado: null,
      versao: 0,
      publicadoEm: null,
      publicadoPor: null,
      opcoes: d.opcoes,
      criadoPor: por,
      criadoEm: agora,
      atualizadoEm: agora,
    };
    await this.o.armazem.salvar(f);
    return f;
  }

  async alterar(id: string, bruto: unknown): Promise<Fluxo> {
    const atual = await this.exigir(id);
    const d = FluxoAlteracao.parse(bruto);
    const f: Fluxo = {
      ...atual,
      nome: d.nome ?? atual.nome,
      descricao: d.descricao !== undefined ? d.descricao : atual.descricao,
      rascunho: d.rascunho ?? atual.rascunho,
      opcoes: { ...atual.opcoes, ...Object.fromEntries(Object.entries(d.opcoes ?? {}).filter(([, v]) => v !== undefined)) },
      atualizadoEm: this.agora(),
    };
    await this.o.armazem.salvar(f);
    return f;
  }

  async apagar(id: string): Promise<void> {
    await this.exigir(id);
    await this.o.armazem.apagar(id);
  }

  /** Problemas do grafo: estrutura, conteúdo e ids (etapas, tags, pessoas) que já não existem. */
  async validar(g: Grafo): Promise<Problema[]> {
    const p = problemasDoGrafo(g);
    const todas = await this.o.tags.listar();
    const tag = (id: string) => todas.find((t) => t.id === id);
    const erro = (noId: string, mensagem: string) => p.push({ nivel: 'erro', noId, mensagem });
    for (const n of g.nos) {
      const nome = n.titulo || nomeDoTipo(n.tipo);
      if (n.tipo === 'inicio') {
        const gt = n.gatilho;
        if (gt.tipo === 'entrou_na_etapa' && gt.etapaId && !tag(gt.etapaId)?.funilId) erro(n.id, 'Início: a etapa não existe mais.');
        if (gt.tipo === 'tag_marcada' && gt.tagId && !tag(gt.tagId)) erro(n.id, 'Início: a tag não existe mais.');
      }
      if (n.tipo === 'mover_etapa' && n.etapaId) {
        const e = tag(n.etapaId);
        if (!e || e.funilId !== n.funilId) erro(n.id, `${nome}: etapa não encontrada neste funil.`);
      }
      if ((n.tipo === 'marcar_tag' || n.tipo === 'desmarcar_tag') && n.tagId) {
        const t = tag(n.tagId);
        if (!t) erro(n.id, `${nome}: a tag não existe mais.`);
        else if (n.tipo === 'desmarcar_tag' && t.chaveSistema) erro(n.id, `${nome}: toda conversa fica no funil do sistema; use "Mover etapa".`);
      }
      if (n.tipo === 'condicao' && (n.condicao.se === 'tag' || n.condicao.se === 'etapa') && n.condicao.valor && !tag(n.condicao.valor)) erro(n.id, `${nome}: a tag/etapa não existe mais.`);
      const pessoa = n.tipo === 'atribuir' ? n.usuarioId : n.tipo === 'transferir' ? n.usuarioId : null;
      if (pessoa && this.o.contas) {
        const u = await this.o.contas.buscarPorId(pessoa).catch(() => undefined);
        if (!u || u.empresaId !== this.empresaId || !u.ativo) erro(n.id, `${nome}: pessoa não encontrada ou inativa.`);
      }
    }
    return p;
  }

  /** O rascunho vira a versão que roda. Recusa (400) se houver erro. */
  async publicar(id: string, por: string): Promise<Fluxo> {
    const f = await this.exigir(id);
    const problemas = await this.validar(f.rascunho);
    const erros = problemas.filter((x) => x.nivel === 'erro');
    if (erros.length) throw new ErroBot(`Não dá para publicar: ${erros[0]!.mensagem}${erros.length > 1 ? ` (e mais ${erros.length - 1})` : ''}`, 400, problemas);
    const agora = this.agora();
    const novo: Fluxo = { ...f, publicado: copia(f.rascunho), versao: f.versao + 1, publicadoEm: agora, publicadoPor: por, atualizadoEm: agora };
    await this.o.armazem.salvar(novo);
    return novo;
  }

  async ligar(id: string, ligado: boolean): Promise<Fluxo> {
    const f = await this.exigir(id);
    if (f.ligado === ligado) return f;
    if (ligado) {
      if (!f.publicado) throw new ErroBot('Publique o bot antes de ligar.', 409);
      const erros = (await this.validar(f.publicado)).filter((x) => x.nivel === 'erro');
      if (erros.length) throw new ErroBot(`A versão publicada tem problema: ${erros[0]!.mensagem} Corrija e publique de novo.`, 400, erros);
    }
    const novo = { ...f, ligado, atualizadoEm: this.agora() };
    await this.o.armazem.salvar(novo);
    return novo;
  }

  async execucoes(id: string, limite = 30): Promise<ExecucaoBot[]> {
    await this.exigir(id);
    return this.o.armazem.execucoes(id, limite);
  }

  async execucao(id: string): Promise<ExecucaoBot> {
    const e = await this.o.armazem.execucao(id);
    if (!e) throw new ErroBot('Execução não encontrada.', 404);
    await this.exigir(e.fluxoId);
    return e;
  }

  /** Bot ativo na conversa (para a tela da conversa) e os bots que dá para iniciar nela. */
  async daConversa(conversaId: string) {
    const ativa = (await this.o.armazem.ativasDaConversa(conversaId))[0];
    const fluxos = (await this.listar()).filter((f) => f.publicado);
    const nome = ativa ? fluxos.find((f) => f.id === ativa.fluxoId)?.nome ?? (await this.o.armazem.buscar(ativa.fluxoId))?.nome : undefined;
    return {
      ativa: ativa ? { ...ativa, fluxoNome: nome ?? 'Bot' } : null,
      fluxos: fluxos.map((f) => ({ id: f.id, nome: f.nome, ligado: f.ligado, gatilho: inicioDe(f.publicado!)?.gatilho.tipo ?? 'manual' })),
    };
  }

  async guardarMidia(m: { nome?: string; mimetype: string; conteudo: Buffer }): Promise<MidiaBot> {
    const midia: MidiaBot = { id: randomUUID(), empresaId: this.empresaId, nome: m.nome ?? null, mimetype: m.mimetype, conteudo: m.conteudo };
    await this.o.armazem.guardarMidia(midia);
    return midia;
  }
  async midia(id: string): Promise<MidiaBot> {
    const m = await this.o.armazem.midia(id);
    if (!m || m.empresaId !== this.empresaId) throw new ErroBot('Arquivo não encontrado.', 404);
    return m;
  }

  // ---------- iniciar à mão e testar ----------

  /**
   * Inicia a versão publicada na conversa (botão "Iniciar bot"). Com outro bot ativo, recusa (409),
   * a não ser com `substituir`.
   */
  async iniciar(fluxoId: string, conversaId: string, o: { substituir?: boolean; por?: string } = {}): Promise<ExecucaoBot> {
    const f = await this.exigir(fluxoId);
    if (!f.publicado) throw new ErroBot('Este bot ainda não foi publicado.', 409);
    return this.comecar(f, f.publicado, f.versao, conversaId, false, o.substituir ?? false, `manual:${randomUUID()}`, o.por ? `Iniciado por ${o.por}.` : 'Iniciado à mão.');
  }

  /** Roda o RASCUNHO numa conversa de teste (quem chama confere que é de teste). A cliente de teste responde e o bot segue. */
  async testar(fluxoId: string, conversaId: string, o: { usarPublicado?: boolean } = {}): Promise<ExecucaoBot> {
    const f = await this.exigir(fluxoId);
    const g = o.usarPublicado && f.publicado ? f.publicado : f.rascunho;
    const erros = problemasDoGrafo(g).filter((x) => x.nivel === 'erro');
    if (erros.length) throw new ErroBot(`Corrija antes de testar: ${erros[0]!.mensagem}`, 400, erros);
    return this.comecar(f, g, o.usarPublicado ? f.versao : 0, conversaId, true, true, `teste:${randomUUID()}`, 'Teste iniciado.');
  }

  /** Para o bot (botão na conversa ou na tela). */
  async cancelar(execucaoId: string, motivo = 'Parado à mão.'): Promise<ExecucaoBot> {
    const e = await this.execucao(execucaoId);
    if (!ATIVOS.includes(e.status)) return e;
    await this.encerrar(e, 'cancelada', motivo);
    return (await this.o.armazem.execucao(e.id)) ?? e;
  }

  private async comecar(f: Fluxo, g: Grafo, versao: number, conversaId: string, teste: boolean, substituir: boolean, chave: string, detalhe: string): Promise<ExecucaoBot> {
    const c = await this.o.repo.buscarConversa(conversaId);
    if (!c || c.empresaId !== this.empresaId) throw new ErroBot('Conversa não encontrada.', 404);
    const ativas = await this.o.armazem.ativasDaConversa(conversaId);
    if (ativas.length && !substituir) throw new ErroBot('Já há um bot rodando nesta conversa.', 409);
    for (const a of ativas) await this.encerrar(a, 'cancelada', 'Outro bot foi iniciado nesta conversa.');
    const e = this.novaExecucao(f, g, versao, conversaId, chave, teste, detalhe);
    if (!(await this.o.armazem.criarExecucao(e))) throw new ErroBot('Não foi possível iniciar o bot.', 409);
    await this.rodarNaConversa(conversaId);
    await this.ocioso();
    return (await this.o.armazem.execucao(e.id)) ?? e;
  }

  private novaExecucao(f: Fluxo, g: Grafo, versao: number, conversaId: string, chave: string, teste: boolean, detalhe: string): ExecucaoBot {
    const agora = this.agora();
    const inicio = inicioDe(g);
    return {
      id: randomUUID(),
      fluxoId: f.id,
      conversaId,
      chave,
      status: 'pendente',
      teste,
      versao,
      grafo: copia(g),
      estado: { noAtual: inicio?.id ?? null, emExecucao: null, espera: null, entrada: null, vars: {}, caminho: [], passos: 0, envios: 0 },
      log: [{ em: agora.toISOString(), no: null, tipo: 'inicio_exec', ok: true, detalhe }],
      erro: null,
      proximaEm: agora,
      reservadaAte: null,
      criadaEm: agora,
      atualizadaEm: agora,
    };
  }

  // ---------- ganchos (sob a trava da conversa: só registram e agendam) ----------

  /** Mensagem da cliente: retoma o bot que esperava a resposta; senão, vê se algum bot começa. */
  async mensagemCliente(c: Conversa, m: { texto: string; idExterno: string; primeira: boolean }): Promise<void> {
    if (c.empresaId !== this.empresaId) return;
    const agora = this.agora();
    const ativas = await this.o.armazem.ativasDaConversa(c.id);
    if (ativas.length) {
      for (const e of ativas) {
        const esp = e.estado.espera;
        if (e.status !== 'pendente' || !esp) continue;
        if (esp.tipo === 'resposta' && !e.estado.entrada) {
          e.estado.entrada = { texto: m.texto, em: agora.toISOString() };
          e.proximaEm = agora;
          e.atualizadaEm = agora;
          await this.o.armazem.salvarExecucao(e);
          this.rodarLogo(c.id);
        } else if (esp.tipo === 'agente' && (await this.agenteConcluiu(e, c))) {
          e.estado.agenteConcluiu = true;
          e.proximaEm = agora;
          await this.o.armazem.salvarExecucao(e);
          this.rodarLogo(c.id);
        }
      }
      return; // um bot por vez: com um ativo, nenhum outro começa
    }
    const aberta = estaAberta(UNIDADES[c.unidade], agora);
    const fora = aberta ? undefined : proximaAbertura(UNIDADES[c.unidade], agora);
    await this.disparar(c, (g) => {
      if (g.tipo === 'nova_conversa') return m.primeira && (!g.unidade || g.unidade === c.unidade) ? 'nova_conversa' : undefined;
      if (g.tipo === 'palavra_chave') return casaPalavra(m.texto, g.palavras, g.modo) ? `msg:${m.idExterno || randomUUID()}` : undefined;
      if (g.tipo === 'fora_do_horario') return !aberta && (!g.unidade || g.unidade === c.unidade) ? `fora:${fora?.toISOString() ?? dataISO(agora)}` : undefined;
      return undefined;
    });
  }

  /** Cartão entrou numa etapa (e tag-etapa marcada). Também confere o agente "até agendar". */
  async aoMover(m: MovimentoEtapa): Promise<void> {
    if (!m.para || m.conversa.empresaId !== this.empresaId) return;
    const para = m.para;
    const ativas = await this.o.armazem.ativasDaConversa(m.conversa.id);
    if (ativas.some((e) => e.status === 'pendente' && e.estado.espera?.tipo === 'agente')) {
      this.rodarLogo(m.conversa.id, true);
      return;
    }
    await this.disparar(m.conversa, (g) =>
      (g.tipo === 'entrou_na_etapa' && g.etapaId === para) || (g.tipo === 'tag_marcada' && g.tagId === para) ? `etapa:${para}:${randomUUID()}` : undefined,
    );
  }

  async aoMarcarTag(c: Conversa, tag: Tag): Promise<void> {
    if (c.empresaId !== this.empresaId) return;
    await this.disparar(c, (g) => (g.tipo === 'tag_marcada' && g.tagId === tag.id ? `tag:${tag.id}:${randomUUID()}` : undefined));
  }

  /** A equipe respondeu: o bot para (se a opção do fluxo estiver ligada). */
  async equipeRespondeu(c: Conversa): Promise<void> {
    for (const e of await this.o.armazem.ativasDaConversa(c.id)) {
      const f = await this.o.armazem.buscar(e.fluxoId);
      if (f && !f.opcoes.parar_se_equipe_responder) continue;
      await this.encerrar(e, 'cancelada', 'A equipe respondeu a conversa.');
    }
  }

  /** O bot está conduzindo a conversa agora? (a IA não responde nem sugere). No bloco "Agente de IA", não. */
  async noControle(c: Conversa): Promise<boolean> {
    const agora = this.agora().getTime();
    for (const e of await this.o.armazem.ativasDaConversa(c.id)) {
      const esp = e.estado.espera;
      if (!esp || esp.tipo === 'resposta') return true;
      if (esp.tipo === 'tempo' && esp.ate && new Date(esp.ate).getTime() - agora <= ESPERA_CURTA_MS) return true;
    }
    return false;
  }

  /** Objetivo do bloco "Agente de IA" em andamento (vai para a IA como instrução extra). */
  async objetivoIa(c: Conversa): Promise<string | undefined> {
    for (const e of await this.o.armazem.ativasDaConversa(c.id)) {
      const esp = e.estado.espera;
      if (esp?.tipo !== 'agente' || !esp.objetivo) continue;
      let extra = '';
      if (esp.agenteIaId && this.o.agentesIa) extra = (await this.o.agentesIa.instrucoes(esp.agenteIaId).catch(() => undefined)) ?? '';
      return extra ? `${extra}\n\n${esp.objetivo}` : esp.objetivo;
    }
    return undefined;
  }

  private async disparar(c: Conversa, chaveSe: (g: GatilhoBot) => string | undefined): Promise<void> {
    if ((await this.o.armazem.ativasDaConversa(c.id)).length) return; // um bot por vez (inclusive o de teste)
    const lista = (await this.listar()).filter((f) => f.ligado && f.publicado);
    for (const f of lista) {
      const ini = inicioDe(f.publicado!);
      if (!ini) continue;
      const chave = chaveSe(ini.gatilho);
      if (!chave) continue;
      const e = this.novaExecucao(f, f.publicado!, f.versao, c.id, chave, false, `Disparado (${ini.gatilho.tipo}).`);
      if (await this.o.armazem.criarExecucao(e)) {
        this.rodarLogo(c.id);
        return; // um bot por vez
      }
    }
  }

  // ---------- rodar ----------

  /** Pede a trava da conversa JÁ (síncrono): roda antes da IA pensar a resposta da mesma mensagem. */
  private rodarLogo(conversaId: string, conferirAgente = false): void {
    const p: Promise<unknown> = this.rodarNaConversa(conversaId, undefined, conferirAgente).catch((e) => this.log('Falha ao rodar o bot', String(e)));
    this.emAndamento.add(p);
    void p.finally(() => this.emAndamento.delete(p));
  }

  async ocioso(): Promise<void> {
    while (this.emAndamento.size) await Promise.allSettled([...this.emAndamento]);
  }

  private async rodarNaConversa(conversaId: string, jaReservadas?: ExecucaoBot[], conferirAgente = false): Promise<void> {
    const sintonia = this.o.sintonia();
    let reavaliar = false;
    const existe = await sintonia.comConversa(conversaId, async (c) => {
      const agora = this.agora();
      if (conferirAgente) {
        for (const e of await this.o.armazem.ativasDaConversa(conversaId)) {
          if (e.status === 'pendente' && e.estado.espera?.tipo === 'agente' && (await this.agenteConcluiu(e, c))) {
            e.estado.agenteConcluiu = true;
            e.proximaEm = agora;
            await this.o.armazem.salvarExecucao(e);
          }
        }
      }
      const lista = jaReservadas ?? (await this.o.armazem.reivindicar(agora, new Date(agora.getTime() + RESERVA_MS), { conversaId, limite: 10 }));
      for (const e of lista) if (await this.rodarSobTrava(e, c)) reavaliar = true;
      return true;
    });
    if (!existe) {
      for (const e of jaReservadas ?? []) await this.encerrar(e, 'cancelada', 'A conversa não existe mais.');
      return;
    }
    if (reavaliar) await sintonia.reavaliar(conversaId);
  }

  /** Relógio: esperas vencidas (tempo, tempo limite da resposta, prazo do agente), agente que já cumpriu, processo que caiu. */
  async tick(): Promise<void> {
    const agora = this.agora();
    for (const e of await this.o.armazem.comAgente(100)) {
      const c = await this.o.repo.buscarConversa(e.conversaId);
      if (c && (await this.agenteConcluiu(e, c))) this.rodarLogo(e.conversaId, true);
    }
    await this.ocioso();
    for (let volta = 0; volta < 10; volta++) {
      const prontas = await this.o.armazem.reivindicar(agora, new Date(agora.getTime() + RESERVA_MS), { limite: 50 });
      if (!prontas.length) break;
      const porConversa = new Map<string, ExecucaoBot[]>();
      for (const e of prontas) porConversa.set(e.conversaId, [...(porConversa.get(e.conversaId) ?? []), e]);
      for (const [conversaId, lista] of porConversa) {
        await this.rodarNaConversa(conversaId, lista).catch((x) => this.log('Falha ao retomar bot', { conversaId, erro: String(x) }));
      }
      await this.ocioso();
    }
  }

  private anotar(e: ExecucaoBot, no: No | null, ok: boolean, detalhe: string): void {
    e.log.push({ em: this.agora().toISOString(), no: no?.id ?? null, tipo: no?.tipo ?? 'fim', ok, detalhe });
    if (e.log.length > LIMITE_LOG) e.log.splice(1, e.log.length - LIMITE_LOG);
  }

  private async encerrar(e: ExecucaoBot, status: 'concluida' | 'cancelada' | 'erro', motivo?: string): Promise<void> {
    e.status = status;
    e.reservadaAte = null;
    e.atualizadaEm = this.agora();
    e.estado.espera = null;
    e.estado.entrada = null;
    if (status !== 'concluida') e.erro = motivo ?? null;
    e.log.push({ em: this.agora().toISOString(), no: null, tipo: 'fim', ok: status === 'concluida', detalhe: motivo ?? 'Concluído.' });
    await this.o.armazem.salvarExecucao(e);
  }

  /** Roda uma execução reservada, sob a trava, até acabar ou esperar. true = a IA precisa pensar de novo. */
  private async rodarSobTrava(reservada: ExecucaoBot, c: Conversa): Promise<boolean> {
    const e = await this.o.armazem.execucao(reservada.id);
    if (!e || e.status !== 'rodando') return false;
    const f = await this.o.armazem.buscar(e.fluxoId);
    if (!f) {
      await this.encerrar(e, 'cancelada', 'O bot foi apagado.');
      return false;
    }
    if (!e.teste && !f.ligado) {
      await this.encerrar(e, 'cancelada', 'O bot foi desligado.');
      return false;
    }
    const st = e.estado;
    let reavaliar = false;
    for (let n = 0; ; n++) {
      if (n >= PASSOS_POR_RODADA) {
        await this.o.repo.salvarConversa(c);
        await this.encerrar(e, 'erro', `Passou de ${PASSOS_POR_RODADA} blocos seguidos sem esperar a cliente (laço no fluxo?).`);
        return reavaliar;
      }
      const no = st.noAtual ? e.grafo.nos.find((x) => x.id === st.noAtual) : undefined;
      if (!no) {
        await this.o.repo.salvarConversa(c);
        await this.encerrar(e, st.noAtual ? 'erro' : 'concluida', st.noAtual ? 'Bloco não encontrado no fluxo.' : 'Fim do caminho.');
        return reavaliar;
      }
      let efeito: Efeito;
      if (st.emExecucao === no.id) {
        // O processo caiu no meio deste bloco: não repete (melhor perder um envio do que mandar duas vezes).
        st.emExecucao = null;
        if (no.tipo === 'pergunta' || no.tipo === 'pergunta_aberta') {
          efeito = { esperar: { tipo: 'resposta', no: no.id, desde: this.agora().toISOString(), ate: null, tentativas: 0 }, ate: new Date(this.agora().getTime() + no.tempoLimiteMin * MIN) };
          this.anotar(e, no, true, 'Retomado depois de uma queda: esperando a resposta.');
        } else {
          const s = saidasDe(no)[0]?.id;
          efeito = s ? { ir: s } : { fim: 'concluida' };
          this.anotar(e, no, true, 'Retomado depois de uma queda: bloco não repetido.');
        }
      } else {
        const retomando = st.espera?.no === no.id;
        if (!retomando) {
          st.passos++;
          st.caminho.push(no.id);
          if (st.caminho.length > 500) st.caminho.splice(0, st.caminho.length - 500);
        }
        st.emExecucao = no.id;
        e.atualizadaEm = this.agora();
        await this.o.armazem.salvarExecucao(e);
        try {
          efeito = await this.executarNo(f, e, c, no, retomando);
        } catch (x) {
          efeito = { fim: 'erro', motivo: `${nomeDoTipo(no.tipo)}: ${(x as Error).message || String(x)}` };
        }
        st.emExecucao = null;
      }
      if ('reavaliar' in efeito && efeito.reavaliar) reavaliar = true;
      if ('fim' in efeito) {
        await this.o.repo.salvarConversa(c);
        await this.encerrar(e, efeito.fim, efeito.motivo);
        return reavaliar;
      }
      if ('esperar' in efeito) {
        st.espera = efeito.esperar;
        st.entrada = null;
        st.agenteConcluiu = false;
        e.status = 'pendente';
        e.proximaEm = efeito.ate ?? new Date(this.agora().getTime() + 365 * DIA);
        e.reservadaAte = null;
        e.atualizadaEm = this.agora();
        await this.o.repo.salvarConversa(c);
        await this.o.armazem.salvarExecucao(e);
        return reavaliar;
      }
      // Seguir pela saída.
      st.espera = null;
      st.entrada = null;
      st.agenteConcluiu = false;
      const lig = e.grafo.ligacoes.find((l) => l.de === no.id && l.saida === efeito.ir);
      st.noAtual = lig?.para ?? null;
      if (!lig && efeito.ir !== 'proximo') this.anotar(e, no, true, `Saída "${rotuloSaida(no, efeito.ir)}" sem ligação: o bot termina aqui.`);
    }
  }

  private vars(e: ExecucaoBot, c: Conversa) {
    const u = UNIDADES[c.unidade];
    return (t: string) => preencherVariaveis(preencher(t, { nome: c.nome, unidade: u.nome, atendente: c.responsavelNome }), e.estado.vars);
  }

  /** Envia (texto e/ou mídia) respeitando o limite diário (só o que não responde a cliente conta) e a janela da Meta. */
  private async enviar(f: Fluxo, e: ExecucaoBot, c: Conversa, no: No, texto: string, midia?: MidiaEnvio): Promise<Efeito | undefined> {
    const agora = this.agora();
    const sintonia = this.o.sintonia();
    if (e.estado.envios >= ENVIOS_POR_EXECUCAO) return { fim: 'cancelada', motivo: `Limite de ${ENVIOS_POR_EXECUCAO} mensagens nesta execução.` };
    // Conversa em andamento (a cliente escreveu há pouco): o bot está respondendo, não conta no limite diário.
    const respondendo = agora.getTime() - (c.ultimaMensagemCliente?.getTime() ?? 0) <= CONVERSA_ATIVA_MS;
    const ativo = !respondendo && !e.teste;
    if (ativo && this.o.envios) {
      const { limiteDiario } = await this.o.envios.config(this.empresaId);
      const d = partesBahia(agora);
      const n = await this.o.envios.contarEnvios(c.id, bahia(d.ano, d.mes, d.dia));
      if (n >= limiteDiario) return { fim: 'cancelada', motivo: `Limite de ${limiteDiario} mensagem(ns) automática(s) por dia nesta conversa.` };
    }
    if (sintonia.canalDa(c) === 'meta' && agora.getTime() - (c.ultimaMensagemCliente?.getTime() ?? 0) > DIA) {
      return { fim: 'erro', motivo: 'WhatsApp oficial: fora da janela de 24 h só com modelo aprovado pela Meta.' };
    }
    const autor = `Bot: ${f.nome}`;
    if (midia) {
      if (!sintonia.enviarMidiaAutomatico) throw new Error('Este servidor não envia imagens pelo bot.');
      await sintonia.enviarMidiaAutomatico(c, { ...midia, legenda: texto || undefined }, autor);
    } else await sintonia.enviarAutomatico(c, texto, autor);
    e.estado.envios++;
    if (ativo) await this.o.envios?.registrarEnvio(c.id, agora);
    await this.o.repo.registrarEvento({ tipo: 'automacao', conversaId: c.id, unidade: c.unidade, em: agora, dados: { bot: true, fluxoId: f.id, execucaoId: e.id, noId: no.id, acao: 'enviou', texto, teste: e.teste } });
    return undefined;
  }

  private async carregarMidia(no: Extract<No, { tipo: 'mensagem' }>): Promise<MidiaEnvio | undefined> {
    if (no.midiaId) {
      const m = await this.midia(no.midiaId);
      return { tipo: tipoMidia(m.mimetype), conteudo: m.conteudo, mimetype: m.mimetype, nomeArquivo: m.nome ?? undefined };
    }
    if (no.midiaUrl) {
      const r = await (this.o.fetch ?? fetch)(no.midiaUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`não consegui baixar a imagem (${r.status}).`);
      const mimetype = (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
      const conteudo = Buffer.from(await r.arrayBuffer());
      if (conteudo.length > 16 * 1024 * 1024) throw new Error('imagem grande demais.');
      return { tipo: tipoMidia(mimetype), conteudo, mimetype, nomeArquivo: no.midiaUrl.split('/').pop()?.split('?')[0] || undefined };
    }
    return undefined;
  }

  private esperarResposta(no: No, minutos: number, tentativas = 0): Efeito {
    const agora = this.agora();
    const ate = new Date(agora.getTime() + minutos * MIN);
    return { esperar: { tipo: 'resposta', no: no.id, desde: agora.toISOString(), ate: ate.toISOString(), tentativas }, ate };
  }

  private async executarNo(f: Fluxo, e: ExecucaoBot, c: Conversa, no: No, retomando: boolean): Promise<Efeito> {
    const agora = this.agora();
    const st = e.estado;
    const v = this.vars(e, c);
    const por = { nome: `Bot: ${f.nome}`, id: null };
    const unidade = UNIDADES[c.unidade];
    const entrada = retomando ? st.entrada : null;
    const tentativas = st.espera?.tentativas ?? 0;

    switch (no.tipo) {
      case 'inicio':
        this.anotar(e, no, true, 'Início.');
        return { ir: 'proximo' };

      case 'mensagem': {
        if (no.so_no_horario && !e.teste && !estaAberta(unidade, agora)) {
          const abre = proximaAbertura(unidade, agora);
          if (!abre) return { fim: 'erro', motivo: 'A unidade não tem horário de atendimento para enviar.' };
          if (!retomando) {
            this.anotar(e, no, true, `Fora do horário da loja: envio marcado para ${dataISO(abre)} às ${horaHHmm(abre)}.`);
            return { esperar: { tipo: 'tempo', no: no.id, desde: agora.toISOString(), ate: abre.toISOString() }, ate: abre };
          }
        }
        const texto = v(no.texto);
        const midia = await this.carregarMidia(no);
        const parar = await this.enviar(f, e, c, no, texto, midia);
        if (parar) return parar;
        this.anotar(e, no, true, midia ? `Enviou imagem${texto ? `: "${texto}"` : ''}` : `Enviou: "${texto}"`);
        return { ir: 'proximo' };
      }

      case 'pergunta': {
        if (!retomando) {
          const parar = await this.enviar(f, e, c, no, textoComOpcoes(v(no.texto), no.opcoes.map((o) => ({ ...o, texto: v(o.texto) }))));
          if (parar) return parar;
          this.anotar(e, no, true, `Perguntou: "${v(no.texto)}" (${no.opcoes.length} opções).`);
          return this.esperarResposta(no, no.tempoLimiteMin);
        }
        if (!entrada) {
          this.anotar(e, no, true, 'A cliente não respondeu no tempo.');
          return { ir: 'sem_resposta' };
        }
        st.vars.ultima_resposta = entrada.texto.slice(0, 500);
        const op = casarOpcao(entrada.texto, no.opcoes);
        if (op) {
          if (no.variavel) st.vars[no.variavel] = op.texto;
          this.anotar(e, no, true, `Resposta: "${entrada.texto}" → ${op.texto}.`);
          return { ir: op.id };
        }
        if (tentativas < no.tentativas) {
          const lista = no.opcoes.map((o, i) => `${i + 1}. ${v(o.texto)}`).join('\n');
          const parar = await this.enviar(f, e, c, no, `${v(no.mensagemInvalida || 'Não entendi 🙂 Responda com o número de uma das opções:')}\n\n${lista}`);
          if (parar) return parar;
          this.anotar(e, no, false, `Resposta: "${entrada.texto}" não é uma opção; perguntou de novo.`);
          return this.esperarResposta(no, no.tempoLimiteMin, tentativas + 1);
        }
        this.anotar(e, no, false, `Resposta: "${entrada.texto}" não é uma opção.`);
        return { ir: 'outro' };
      }

      case 'pergunta_aberta': {
        if (!retomando) {
          const parar = await this.enviar(f, e, c, no, v(no.texto));
          if (parar) return parar;
          this.anotar(e, no, true, `Perguntou: "${v(no.texto)}".`);
          return this.esperarResposta(no, no.tempoLimiteMin);
        }
        if (!entrada) {
          this.anotar(e, no, true, 'A cliente não respondeu no tempo.');
          return { ir: 'sem_resposta' };
        }
        st.vars.ultima_resposta = entrada.texto.slice(0, 500);
        const valor = validarResposta(entrada.texto, no.validacao);
        if (valor === undefined) {
          if (tentativas < no.tentativas) {
            const parar = await this.enviar(f, e, c, no, v(no.mensagemInvalida || INVALIDA_PADRAO[no.validacao]));
            if (parar) return parar;
            this.anotar(e, no, false, `Resposta: "${entrada.texto}" não vale como ${no.validacao}; perguntou de novo.`);
            return this.esperarResposta(no, no.tempoLimiteMin, tentativas + 1);
          }
          this.anotar(e, no, false, `Resposta: "${entrada.texto}" não vale como ${no.validacao}.`);
          return { ir: 'invalida' };
        }
        const exibir = no.validacao === 'data' ? valor.split('-').reverse().join('/') : valor;
        if (no.variavel) st.vars[no.variavel] = exibir;
        let salvo = '';
        if (no.campo) salvo = await this.salvarNaFicha(c, no.campo, valor, por.nome);
        this.anotar(e, no, true, `Resposta: "${entrada.texto}"${no.variavel ? ` → {${no.variavel}}` : ''}${salvo}.`);
        return { ir: 'proximo' };
      }

      case 'esperar_resposta': {
        if (!retomando) {
          this.anotar(e, no, true, `Esperando a resposta por até ${no.minutos} min.`);
          return this.esperarResposta(no, no.minutos);
        }
        if (!entrada) {
          this.anotar(e, no, true, 'A cliente não respondeu no tempo.');
          return { ir: 'sem_resposta' };
        }
        st.vars.ultima_resposta = entrada.texto.slice(0, 500);
        if (no.variavel) st.vars[no.variavel] = entrada.texto.slice(0, 500);
        this.anotar(e, no, true, `Resposta: "${entrada.texto}".`);
        return { ir: 'respondeu' };
      }

      case 'esperar': {
        if (retomando) return { ir: 'proximo' };
        if (e.teste) {
          this.anotar(e, no, true, `Esperaria ${no.minutos} min (no teste não espera).`);
          return { ir: 'proximo' };
        }
        const ate = new Date(agora.getTime() + no.minutos * MIN);
        this.anotar(e, no, true, `Esperando ${no.minutos} min (até ${dataISO(ate)} ${horaHHmm(ate)}).`);
        return { esperar: { tipo: 'tempo', no: no.id, desde: agora.toISOString(), ate: ate.toISOString() }, ate };
      }

      case 'condicao': {
        const vale = await this.avaliar(no.condicao, e, c);
        this.anotar(e, no, true, `${descreverCondicao(no.condicao)}: ${vale ? 'sim' : 'não'}.`);
        return { ir: vale ? 'sim' : 'nao' };
      }

      case 'mover_etapa': {
        const r = await this.o.funis.moverSobTrava(c, no.funilId, no.etapaId, por, true);
        this.anotar(e, no, true, r.mudou ? 'Moveu de etapa.' : 'Já estava nesta etapa.');
        return { ir: 'proximo' };
      }
      case 'marcar_tag': {
        const tag = await this.o.tags.exigir(no.tagId);
        const mudou = tag.funilId ? (await this.o.funis.moverSobTrava(c, tag.funilId, tag.id, por, true)).mudou : (await this.o.tags.marcar(c, tag.id, por.nome)).mudou;
        if (mudou) await this.o.repo.registrarEvento({ tipo: 'tag_marcada', conversaId: c.id, unidade: c.unidade, em: agora, dados: { tagId: tag.id, nome: tag.nome, por: por.nome, porId: null } });
        this.anotar(e, no, true, mudou ? `Marcou "${tag.nome}".` : `"${tag.nome}" já estava marcada.`);
        return { ir: 'proximo' };
      }
      case 'desmarcar_tag': {
        const tag = await this.o.tags.exigir(no.tagId);
        let mudou = false;
        if (tag.funilId) {
          if (await this.o.tags.temTag(c.id, tag.id)) mudou = (await this.o.funis.moverSobTrava(c, tag.funilId, null, por, true)).mudou;
        } else mudou = (await this.o.tags.desmarcar(c, tag.id, por.nome)).mudou;
        if (mudou) await this.o.repo.registrarEvento({ tipo: 'tag_desmarcada', conversaId: c.id, unidade: c.unidade, em: agora, dados: { tagId: tag.id, nome: tag.nome, por: por.nome, porId: null } });
        this.anotar(e, no, true, mudou ? `Desmarcou "${tag.nome}".` : `"${tag.nome}" não estava marcada.`);
        return { ir: 'proximo' };
      }
      case 'atribuir': {
        if (no.unidade && no.unidade !== c.unidade) {
          this.anotar(e, no, true, `Pulado: a conversa não é da unidade ${UNIDADES[no.unidade].nome}.`);
          return { ir: 'proximo' };
        }
        if (!no.usuarioId) {
          await this.o.sintonia().trocarDonaSobTrava(c, null, { nome: por.nome }, 'automacao');
          this.anotar(e, no, true, 'Conversa sem dona.');
          return { ir: 'proximo' };
        }
        const alvo = this.o.contas ? await this.o.contas.buscarPorId(no.usuarioId).catch(() => undefined) : undefined;
        if (!alvo || !podeReceber(alvo, c)) {
          this.anotar(e, no, false, 'Pulado: a pessoa não está ativa ou não atende esta unidade.');
          return { ir: 'proximo' };
        }
        await this.o.sintonia().trocarDonaSobTrava(c, { id: alvo.id, nome: alvo.nome }, { nome: por.nome }, 'automacao');
        this.anotar(e, no, true, `Dona: ${alvo.nome}.`);
        return { ir: 'proximo' };
      }
      case 'mudar_modo': {
        c.modo = no.modo;
        c.pausaIaAte = undefined;
        this.anotar(e, no, true, `Modo: ${no.modo}.`);
        return { ir: 'proximo', reavaliar: no.modo !== 'humano' };
      }
      case 'lembrete': {
        const quando = new Date(agora.getTime() + no.em_minutos * MIN);
        const texto = no.texto ? v(no.texto) : `Ligar (bot ${f.nome})`;
        await this.o.repo.registrarEvento({
          tipo: 'lembrete_ligacao',
          conversaId: c.id,
          unidade: c.unidade,
          em: agora,
          dados: { quando: quando.toISOString(), texto, automacaoId: f.id, automacaoNome: `Bot: ${f.nome}`, bot: true, teste: e.teste },
        });
        this.anotar(e, no, true, `Lembrete de ligação para ${dataISO(quando)} ${horaHHmm(quando)}.`);
        return { ir: 'proximo' };
      }
      case 'webhook': {
        const corpo = {
          evento: 'bot',
          fluxo: { id: f.id, nome: f.nome },
          bloco: no.id,
          conversa: { id: c.id, nome: c.nome ?? null, telefone: c.telefone, unidade: c.unidade, etapa: c.etapa, modo: c.modo },
          variaveis: st.vars,
          teste: e.teste,
          em: agora.toISOString(),
        };
        try {
          const r = await (this.o.fetch ?? fetch)(no.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10_000) });
          if (!r.ok) {
            this.anotar(e, no, false, `Webhook respondeu ${r.status}.`);
            return { ir: 'erro' };
          }
          // Resposta em JSON com valores simples vira variável ({webhook_<chave>}).
          const json = await r.json().catch(() => undefined);
          if (json && typeof json === 'object' && !Array.isArray(json)) {
            for (const [k, val] of Object.entries(json).slice(0, 20)) {
              if (/^[a-z_][a-z0-9_]*$/i.test(k) && (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean')) st.vars[`webhook_${k}`] = String(val).slice(0, 500);
            }
          }
          this.anotar(e, no, true, `Webhook ok (${r.status}).`);
          return { ir: 'ok' };
        } catch (x) {
          this.anotar(e, no, false, `Webhook falhou: ${(x as Error).message}.`);
          return { ir: 'erro' };
        }
      }
      case 'agente_ia': {
        if (!retomando) {
          const ate = new Date(agora.getTime() + no.dias * DIA);
          const saida =
            no.saida.tipo === 'agendou' ? 'até a cliente agendar' : no.saida.tipo === 'mensagens' ? `por até ${no.saida.n} mensagem(ns)` : `até ${dataISO(ate)}`;
          c.modo = 'ia';
          c.pausaIaAte = undefined;
          const objetivo = v(no.objetivo);
          this.anotar(e, no, true, `Agente de IA${no.agenteIaId ? ` (${no.agenteIaId})` : ''} conduzindo ${saida}: "${objetivo}".`);
          await this.o.repo.registrarEvento({ tipo: 'automacao', conversaId: c.id, unidade: c.unidade, em: agora, dados: { bot: true, fluxoId: f.id, execucaoId: e.id, acao: 'fluxo_ia', objetivo, teste: e.teste } });
          return {
            esperar: { tipo: 'agente', no: no.id, desde: agora.toISOString(), ate: ate.toISOString(), objetivo, ...(no.agenteIaId ? { agenteIaId: no.agenteIaId } : {}) },
            ate,
            reavaliar: true,
          };
        }
        if (st.agenteConcluiu || (await this.agenteConcluiu(e, c))) {
          this.anotar(e, no, true, 'O agente de IA cumpriu o objetivo.');
          return { ir: 'concluiu' };
        }
        this.anotar(e, no, true, 'O prazo do agente de IA acabou.');
        return { ir: 'tempo_esgotado' };
      }
      case 'transferir': {
        if (no.texto?.trim()) {
          const parar = await this.enviar(f, e, c, no, v(no.texto));
          if (parar) return parar;
        }
        c.modo = 'humano';
        c.pausaIaAte = undefined;
        if (!c.etiquetas.includes('precisa da equipe')) c.etiquetas.push('precisa da equipe');
        if (no.usuarioId && this.o.contas) {
          const alvo = await this.o.contas.buscarPorId(no.usuarioId).catch(() => undefined);
          if (alvo && podeReceber(alvo, c)) await this.o.sintonia().trocarDonaSobTrava(c, { id: alvo.id, nome: alvo.nome }, { nome: por.nome }, 'automacao');
        }
        await this.o.repo.registrarEvento({ tipo: 'passou_para_humano', conversaId: c.id, unidade: c.unidade, em: agora, dados: { motivo: `Bot: ${f.nome}`, bot: true, teste: e.teste } });
        this.anotar(e, no, true, 'Passou para a equipe.');
        return { fim: 'concluida', motivo: 'Transferido para a equipe.' };
      }
      case 'fim':
        this.anotar(e, no, true, 'Fim.');
        return { fim: 'concluida', motivo: 'Fim.' };
    }
  }

  private async agenteConcluiu(e: ExecucaoBot, c: Conversa): Promise<boolean> {
    const esp = e.estado.espera;
    if (esp?.tipo !== 'agente') return false;
    const no = e.grafo.nos.find((n) => n.id === esp.no);
    if (no?.tipo !== 'agente_ia') return false;
    if (no.saida.tipo === 'agendou') return c.etapa === 'agendada' || c.etapa === 'compareceu';
    if (no.saida.tipo === 'mensagens') {
      const desde = new Date(esp.desde).getTime();
      const msgs = await this.o.repo.mensagens(c.id, 200);
      return msgs.filter((m) => m.autor === 'ia' && !m.autorNome && m.em.getTime() >= desde).length >= no.saida.n;
    }
    return false;
  }

  private async avaliar(cond: Extract<No, { tipo: 'condicao' }>['condicao'], e: ExecucaoBot, c: Conversa): Promise<boolean> {
    switch (cond.se) {
      case 'tag':
      case 'etapa':
        return Boolean(cond.valor) && (await this.o.tags.temTag(c.id, cond.valor));
      case 'horario_loja':
        return estaAberta(UNIDADES[c.unidade], this.agora());
      case 'unidade':
        return c.unidade === cond.valor;
      case 'modo':
        return c.modo === cond.valor;
      case 'resposta_contem': {
        const r = e.estado.vars.ultima_resposta ?? '';
        const palavras = cond.valor.split(',').map((x) => x.trim()).filter(Boolean);
        return casaPalavra(r, palavras, 'contem');
      }
      case 'campo': {
        const valor = await this.lerCampo(cond.campo ?? '', e, c);
        if (cond.operador === 'preenchido') return Boolean(valor.trim());
        const a = normalizar(valor);
        const b = normalizar(cond.valor);
        return cond.operador === 'igual' ? a === b : Boolean(b) && ` ${a} `.includes(` ${b} `);
      }
    }
  }

  private async lerCampo(campo: string, e: ExecucaoBot, c: Conversa): Promise<string> {
    if (campo in e.estado.vars) return e.estado.vars[campo]!;
    const ficha = this.o.contatos ? await this.o.contatos.obter(this.empresaId, c.telefone).catch(() => undefined) : undefined;
    if (campo === 'nome') return ficha?.nome ?? c.nome ?? '';
    if (campo === 'email') return ficha?.email ?? '';
    if (campo === 'nascimento') return ficha?.nascimento ?? '';
    if (campo === 'observacoes') return ficha?.observacoes ?? '';
    if (campo.startsWith('campo:')) {
      const v = ficha?.campos[campo.slice(6)];
      return v === null || v === undefined ? '' : String(v);
    }
    return '';
  }

  /** Grava a resposta na ficha da cliente. Devolve um pedaço do registro (", salvo em …"). */
  private async salvarNaFicha(c: Conversa, campo: string, valor: string, quem: string): Promise<string> {
    if (campo === 'nome') c.nome = valor.slice(0, 120);
    if (!this.o.contatos) return campo === 'nome' ? ', salvo no nome' : '';
    try {
      const atual = (await this.o.contatos.obter(this.empresaId, c.telefone)) ?? contatoVazio(c.telefone, c.nome);
      const novo = structuredClone(atual);
      if (campo === 'nome') novo.nome = valor.slice(0, 120);
      else if (campo === 'email') novo.email = valor.slice(0, 200);
      else if (campo === 'nascimento') novo.nascimento = valor;
      else if (campo === 'observacoes') novo.observacoes = [atual.observacoes, valor].filter(Boolean).join('\n').slice(0, 4000);
      else if (campo.startsWith('campo:')) {
        const id = campo.slice(6);
        const defs = await this.o.contatos.campos(this.empresaId);
        novo.campos = { ...novo.campos, ...validarCampos(defs, { [id]: valor }) };
      }
      await this.o.contatos.salvar(this.empresaId, novo, quem);
      return `, salvo na ficha (${campo.replace(/^campo:/, '')})`;
    } catch (x) {
      return ` (não deu para salvar na ficha: ${(x as Error).message})`;
    }
  }
}

function inicioDe(g: Grafo) {
  return g.nos.find((n): n is Extract<No, { tipo: 'inicio' }> => n.tipo === 'inicio');
}

function rotuloSaida(no: No, saida: string): string {
  return saidasDe(no).find((s) => s.id === saida)?.rotulo ?? saida;
}

function tipoMidia(mimetype: string): MidiaEnvio['tipo'] {
  const t = tipoPeloMimetype(mimetype);
  return t === 'figurinha' ? 'imagem' : t;
}

function descreverCondicao(c: Extract<No, { tipo: 'condicao' }>['condicao']): string {
  switch (c.se) {
    case 'tag':
      return 'Tem a tag';
    case 'etapa':
      return 'Está na etapa';
    case 'horario_loja':
      return 'Loja aberta agora';
    case 'unidade':
      return `Unidade = ${c.valor}`;
    case 'modo':
      return `Modo = ${c.valor}`;
    case 'resposta_contem':
      return `Resposta contém "${c.valor}"`;
    case 'campo':
      return `Campo ${c.campo} ${c.operador === 'preenchido' ? 'preenchido' : `${c.operador} "${c.valor}"`}`;
  }
}

/**
 * Pluga os bots nos ganchos da Sintonia (por cima dos de funis/automações) e nos eventos de funis e tags.
 * Use o mesmo em produção (src/index.ts) e nos testes.
 */
export function ligarBots(base: GanchosSintonia, o: { bots: Bots; funis: Funis; tags: Tags }): GanchosSintonia {
  const { bots } = o;
  o.funis.aoMover((m) => bots.aoMover(m));
  o.tags.aoMarcar((c, tag) => bots.aoMarcarTag(c, tag));
  return {
    ...base,
    mensagemCliente: async (c, m) => {
      await base.mensagemCliente?.(c, m);
      await bots.mensagemCliente(c, m);
    },
    equipeRespondeu: async (c) => {
      await base.equipeRespondeu?.(c);
      await bots.equipeRespondeu(c);
    },
    objetivoIa: async (c) => (await bots.objetivoIa(c)) ?? (await base.objetivoIa?.(c)),
    botNoControle: (c) => bots.noControle(c),
  };
}
