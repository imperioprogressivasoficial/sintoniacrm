import type pg from 'pg';
import { z } from 'zod';
import { podeReceber } from '../auth/acesso.js';
import type { Contas, Usuario } from '../auth/contas.js';
import { ehEmailDemo } from '../demo/dados.js';
import type { Conversa, UnidadeId } from '../domain.js';
import { disponiveis, type Presencas } from '../presenca/presenca.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { unidadeDe } from '../unidades.js';
import { bahia, DIA, partesBahia } from '../util/tempo.js';

/**
 * automacao-vendas: rodízio automático de leads.
 *
 * Conversa nova (cliente que escreveu pela primeira vez) ganha dona sozinha: uma pessoa da unidade dela que está
 * "Disponível para atender" (src/presenca), escolhida em rodízio justo (quem recebeu há mais tempo) ou por menor carga
 * (quem tem menos conversas em andamento). Só entra quem pode receber a conversa (ativa, com a unidade dela, com a
 * permissão "Responder clientes"). Se a IA atende primeiro, a conversa só é distribuída quando a IA passa para a equipe.
 *
 * A pessoa que recebeu é avisada pelo sino e pelo push (evento "transferencia" com motivo "rodizio", que o notificador
 * transforma em "Lead novo para você"), e fica uma linha na conversa ("Rodízio automático: passada para Ana").
 * Configuração por unidade (ligado, regra, quem participa) na tela Atendimento › Distribuição e prazos.
 */

export const REGRAS_RODIZIO = ['rodizio', 'carga'] as const;
export type RegraRodizio = (typeof REGRAS_RODIZIO)[number];

export const EsquemaConfigRodizio = z.object({
  ligado: z.boolean(),
  /** rodizio = quem recebeu há mais tempo; carga = quem tem menos conversas em andamento. */
  regra: z.enum(REGRAS_RODIZIO),
  /** Quem participa (ids). Vazio = toda a linha de frente da unidade (atendentes e recepcionistas). */
  participantes: z.array(z.string().trim().min(1).max(100)).max(200).transform((l) => [...new Set(l)]),
});
export type ConfigRodizio = z.infer<typeof EsquemaConfigRodizio>;
export const CONFIG_RODIZIO_PADRAO: ConfigRodizio = { ligado: false, regra: 'rodizio', participantes: [] };

export interface Atribuicao {
  conversaId: string;
  unidade: UnidadeId;
  usuarioId: string;
  usuarioNome: string;
  regra: RegraRodizio;
  em: Date;
}

/** "Em andamento" para a menor carga: conversa da pessoa com mensagem (da cliente ou da equipe) nas últimas 24 h. */
export const JANELA_CARGA_MS = DIA;

export interface ArmazemRodizio {
  configs(empresaId: string): Promise<Partial<Record<UnidadeId, ConfigRodizio>>>;
  salvarConfig(empresaId: string, unidade: UnidadeId, c: ConfigRodizio, por: string): Promise<void>;
  registrar(empresaId: string, a: Atribuicao): Promise<void>;
  /** Última vez que cada pessoa recebeu pelo rodízio nesta unidade. */
  ultimasPorPessoa(empresaId: string, unidade: UnidadeId): Promise<Map<string, Date>>;
  /** Quantas conversas em andamento cada pessoa tem (dona, com mensagem desde `desde`). */
  carga(empresaId: string, usuarioIds: string[], desde: Date): Promise<Map<string, number>>;
  /** Últimas distribuições (para a tela), mais novas primeiro. */
  recentes(empresaId: string, unidades: UnidadeId[], limite: number): Promise<Atribuicao[]>;
  /** Quantas cada pessoa recebeu desde `desde` (para a tela: "recebeu hoje"). */
  contagem(empresaId: string, unidade: UnidadeId, desde: Date): Promise<Map<string, number>>;
}

// ---------------------------------------------------------------- memória

export class ArmazemRodizioMemoria implements ArmazemRodizio {
  private readonly cfg = new Map<string, ConfigRodizio>();
  private readonly atribs = new Map<string, Atribuicao & { empresaId: string }>();
  constructor(private readonly repo: Pick<Repositorio, 'listarConversas'>) {}
  async configs(empresaId: string) {
    const r: Partial<Record<UnidadeId, ConfigRodizio>> = {};
    for (const [k, v] of this.cfg) if (k.startsWith(`${empresaId}|`)) r[k.slice(empresaId.length + 1)] = structuredClone(v);
    return r;
  }
  async salvarConfig(empresaId: string, unidade: UnidadeId, c: ConfigRodizio) {
    this.cfg.set(`${empresaId}|${unidade}`, structuredClone(c));
  }
  async registrar(empresaId: string, a: Atribuicao) {
    this.atribs.set(a.conversaId, { ...a, empresaId });
  }
  async ultimasPorPessoa(empresaId: string, unidade: UnidadeId) {
    const m = new Map<string, Date>();
    for (const a of this.atribs.values()) {
      if (a.empresaId !== empresaId || a.unidade !== unidade) continue;
      if ((m.get(a.usuarioId)?.getTime() ?? -1) < a.em.getTime()) m.set(a.usuarioId, a.em);
    }
    return m;
  }
  async carga(empresaId: string, ids: string[], desde: Date) {
    const m = new Map(ids.map((id) => [id, 0]));
    for (const c of await this.repo.listarConversas({ empresaId })) {
      if (!c.responsavelId || !m.has(c.responsavelId)) continue;
      const ult = Math.max(c.ultimaMensagemCliente?.getTime() ?? 0, c.ultimaMensagemEquipe?.getTime() ?? 0);
      if (ult >= desde.getTime()) m.set(c.responsavelId, (m.get(c.responsavelId) ?? 0) + 1);
    }
    return m;
  }
  async recentes(empresaId: string, unidades: UnidadeId[], limite: number) {
    return [...this.atribs.values()]
      .filter((a) => a.empresaId === empresaId && unidades.includes(a.unidade))
      .sort((a, b) => b.em.getTime() - a.em.getTime())
      .slice(0, limite)
      .map(({ empresaId: _e, ...a }) => ({ ...a }));
  }
  async contagem(empresaId: string, unidade: UnidadeId, desde: Date) {
    const m = new Map<string, number>();
    for (const a of this.atribs.values()) {
      if (a.empresaId === empresaId && a.unidade === unidade && a.em.getTime() >= desde.getTime()) m.set(a.usuarioId, (m.get(a.usuarioId) ?? 0) + 1);
    }
    return m;
  }
}

// ---------------------------------------------------------------- Postgres (db/migrations/570_rodizio.sql)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ArmazemRodizioPostgres implements ArmazemRodizio {
  constructor(private readonly pool: pg.Pool) {}
  async configs(empresaId: string) {
    const { rows } = await this.pool.query<{ unidade: string; ligado: boolean; regra: RegraRodizio; participantes: string[] }>(
      'select unidade, ligado, regra, participantes from sintonia.rodizio_config where empresa_id = $1',
      [empresaId],
    );
    return Object.fromEntries(rows.map((r) => [r.unidade, { ligado: r.ligado, regra: r.regra, participantes: r.participantes ?? [] }]));
  }
  async salvarConfig(empresaId: string, unidade: UnidadeId, c: ConfigRodizio, por: string) {
    await this.pool.query(
      `insert into sintonia.rodizio_config (empresa_id, unidade, ligado, regra, participantes, atualizado_em, atualizado_por)
       values ($1, $2, $3, $4, $5, now(), $6)
       on conflict (empresa_id, unidade) do update set ligado = excluded.ligado, regra = excluded.regra, participantes = excluded.participantes,
         atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [empresaId, unidade, c.ligado, c.regra, c.participantes, por],
    );
  }
  async registrar(empresaId: string, a: Atribuicao) {
    await this.pool.query(
      `insert into sintonia.rodizio_atribuicoes (conversa_id, empresa_id, unidade, usuario_id, usuario_nome, regra, em)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (conversa_id) do update set unidade = excluded.unidade, usuario_id = excluded.usuario_id, usuario_nome = excluded.usuario_nome,
         regra = excluded.regra, em = excluded.em`,
      [a.conversaId, empresaId, a.unidade, a.usuarioId, a.usuarioNome, a.regra, a.em],
    );
  }
  async ultimasPorPessoa(empresaId: string, unidade: UnidadeId) {
    const { rows } = await this.pool.query<{ usuario_id: string; em: Date }>(
      'select usuario_id, max(em) as em from sintonia.rodizio_atribuicoes where empresa_id = $1 and unidade = $2 group by usuario_id',
      [empresaId, unidade],
    );
    return new Map(rows.map((r) => [r.usuario_id, r.em]));
  }
  async carga(empresaId: string, ids: string[], desde: Date) {
    const m = new Map(ids.map((id) => [id, 0]));
    const validos = ids.filter((id) => UUID.test(id));
    if (!validos.length) return m;
    const { rows } = await this.pool.query<{ responsavel_id: string; n: number }>(
      `select responsavel_id::text, count(*)::int as n from sintonia.conversas
        where empresa_id = $1 and responsavel_id = any($2::uuid[])
          and greatest(coalesce(ultima_mensagem_cliente, 'epoch'), coalesce(ultima_mensagem_equipe, 'epoch')) >= $3
        group by responsavel_id`,
      [empresaId, validos, desde],
    );
    for (const r of rows) m.set(r.responsavel_id, r.n);
    return m;
  }
  async recentes(empresaId: string, unidades: UnidadeId[], limite: number) {
    const { rows } = await this.pool.query<{ conversa_id: string; unidade: string; usuario_id: string; usuario_nome: string; regra: RegraRodizio; em: Date }>(
      `select conversa_id::text, unidade, usuario_id, usuario_nome, regra, em from sintonia.rodizio_atribuicoes
        where empresa_id = $1 and unidade = any($2::text[]) order by em desc limit $3`,
      [empresaId, unidades, limite],
    );
    return rows.map((r) => ({ conversaId: r.conversa_id, unidade: r.unidade, usuarioId: r.usuario_id, usuarioNome: r.usuario_nome, regra: r.regra, em: r.em }));
  }
  async contagem(empresaId: string, unidade: UnidadeId, desde: Date) {
    const { rows } = await this.pool.query<{ usuario_id: string; n: number }>(
      'select usuario_id, count(*)::int as n from sintonia.rodizio_atribuicoes where empresa_id = $1 and unidade = $2 and em >= $3 group by usuario_id',
      [empresaId, unidade, desde],
    );
    return new Map(rows.map((r) => [r.usuario_id, r.n]));
  }
}

// ---------------------------------------------------------------- motor

/** O que a Sintonia oferece ao rodízio (a troca de dona acontece sob a trava da conversa). */
export interface SintoniaParaRodizio {
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined>;
  trocarDonaSobTrava(c: Conversa, para: { id: string; nome: string } | null, por: { id?: string; nome: string }, motivo: string): Promise<void>;
}

export interface OpcoesRodizio {
  armazem: ArmazemRodizio;
  contas: Pick<Contas, 'listarUsuarios'>;
  presencas: Presencas;
  repo: Pick<Repositorio, 'buscarConversa' | 'salvarConversa' | 'adicionarMensagem' | 'mensagens'>;
  empresaId: string;
  sintonia: () => SintoniaParaRodizio;
  /** A pessoa tem a permissão "Responder clientes"? Ausente = todas têm (padrão dos papéis). */
  podeResponder?: (u: Usuario) => Promise<boolean>;
  /** A conversa é de demonstração? (nunca distribuída). */
  ehDemo?: (conversaId: string) => Promise<boolean>;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

/** Resultado de uma tentativa (para os testes e o log). */
export type ResultadoRodizio =
  | { feito: true; usuarioId: string; usuarioNome: string }
  | { feito: false; motivo: 'desligado' | 'tem_dona' | 'ia_atendendo' | 'ninguem_disponivel' | 'nao_existe' | 'demo' };

export class Rodizio {
  private fila: Promise<unknown> = Promise.resolve();
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;

  constructor(private readonly o: OpcoesRodizio) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  /**
   * Ouve os eventos (src/notificacoes/notificador.ts: observarEventos). Quem registra o evento está com a trava da
   * conversa: o rodízio só enfileira e roda depois, por trás, pegando a trava quando ela ficar livre.
   */
  aoEvento(e: Evento): void {
    if (!e.conversaId) return;
    // Só a cliente que escreveu primeiro (não quem a equipe chamou por "Nova conversa", a API ou o link de agendamento).
    if (e.tipo === 'conversa_nova' && (e.dados?.origem === 'cliente' || e.dados?.origem === 'cliente_teste')) this.depois(e.conversaId, 'nova');
    else if (e.tipo === 'passou_para_humano') this.depois(e.conversaId, 'ia');
  }

  private depois(conversaId: string, origem: 'nova' | 'ia'): void {
    this.fila = this.fila
      .then(() => this.distribuir(conversaId, origem))
      .catch((x) => this.log('Falha no rodízio de leads', String(x)));
  }

  /** Testes e desligamento: espera o que já foi pedido. */
  ocioso(): Promise<unknown> {
    return this.fila;
  }

  async config(unidade: UnidadeId): Promise<ConfigRodizio> {
    return { ...CONFIG_RODIZIO_PADRAO, ...((await this.o.armazem.configs(this.o.empresaId))[unidade] ?? {}) };
  }
  async configs(): Promise<Partial<Record<UnidadeId, ConfigRodizio>>> {
    return this.o.armazem.configs(this.o.empresaId);
  }
  async salvarConfig(unidade: UnidadeId, bruto: unknown, por: string): Promise<ConfigRodizio> {
    const atual = await this.config(unidade);
    const c = EsquemaConfigRodizio.parse({ ...atual, ...(bruto as object) });
    await this.o.armazem.salvarConfig(this.o.empresaId, unidade, c, por);
    return c;
  }

  /** Quem da equipe pode entrar no rodízio desta conversa (sem olhar a presença). */
  async elegiveis(c: Pick<Conversa, 'empresaId' | 'unidade'> & Partial<Conversa>, cfg: ConfigRodizio): Promise<Usuario[]> {
    const todos = (await this.o.contas.listarUsuarios(this.o.empresaId)).filter((u) => u.ativo && !ehEmailDemo(u.email));
    const alvo = { id: '', canalId: '', telefone: '', modo: 'humano', etapa: 'novo_lead', etiquetas: [], criadaEm: new Date(0), atualizadaEm: new Date(0), ...c } as Conversa;
    let lista = todos.filter((u) => podeReceber(u, alvo));
    // Quem participa: os escolhidos; sem escolha, a linha de frente (atendentes e recepcionistas).
    lista = cfg.participantes.length ? lista.filter((u) => cfg.participantes.includes(u.id)) : lista.filter((u) => u.papel === 'atendente' || u.papel === 'recepcionista');
    if (this.o.podeResponder) {
      const ok = await Promise.all(lista.map((u) => this.o.podeResponder!(u).catch(() => false)));
      lista = lista.filter((_, i) => ok[i]);
    }
    return lista;
  }

  /** Escolhe a próxima pessoa: rodízio (quem recebeu há mais tempo) ou menor carga (empate: rodízio). */
  async escolher(unidade: UnidadeId, candidatos: Usuario[], regra: RegraRodizio): Promise<Usuario | undefined> {
    if (!candidatos.length) return undefined;
    const ultimas = await this.o.armazem.ultimasPorPessoa(this.o.empresaId, unidade);
    const quando = (u: Usuario) => ultimas.get(u.id)?.getTime() ?? -1;
    const carga = regra === 'carga' ? await this.o.armazem.carga(this.o.empresaId, candidatos.map((u) => u.id), new Date(this.agora().getTime() - JANELA_CARGA_MS)) : undefined;
    const ordem = [...candidatos].sort(
      (a, b) => (carga ? (carga.get(a.id) ?? 0) - (carga.get(b.id) ?? 0) : 0) || quando(a) - quando(b) || a.nome.localeCompare(b.nome, 'pt-BR') || (a.id < b.id ? -1 : 1),
    );
    return ordem[0];
  }

  /** Tenta dar dona à conversa agora. `origem`: conversa nova, ou a IA passou para a equipe. */
  async distribuir(conversaId: string, origem: 'nova' | 'ia'): Promise<ResultadoRodizio> {
    const inicio = await this.o.repo.buscarConversa(conversaId);
    if (!inicio || inicio.empresaId !== this.o.empresaId) return { feito: false, motivo: 'nao_existe' };
    const cfg = await this.config(inicio.unidade);
    if (!cfg.ligado) return { feito: false, motivo: 'desligado' };
    if (this.o.ehDemo && (await this.o.ehDemo(conversaId).catch(() => false))) return { feito: false, motivo: 'demo' };
    const r = await this.o.sintonia().comConversa(conversaId, async (c): Promise<ResultadoRodizio> => {
      if (c.responsavelId) return { feito: false, motivo: 'tem_dona' };
      // A IA atende primeiro: a conversa vai para alguém só quando a IA passar para a equipe.
      if (origem === 'nova' && c.modo === 'ia') return { feito: false, motivo: 'ia_atendendo' };
      const elegiveis = await this.elegiveis(c, cfg);
      const livres = new Set(await disponiveis(this.o.presencas, elegiveis.map((u) => u.id)));
      const alvo = await this.escolher(c.unidade, elegiveis.filter((u) => livres.has(u.id)), cfg.regra);
      if (!alvo) return { feito: false, motivo: 'ninguem_disponivel' };
      const agora = this.agora();
      await this.o.sintonia().trocarDonaSobTrava(c, { id: alvo.id, nome: alvo.nome }, { nome: 'Rodízio automático' }, 'rodizio');
      await this.o.repo.salvarConversa(c);
      await this.o.armazem.registrar(this.o.empresaId, { conversaId: c.id, unidade: c.unidade, usuarioId: alvo.id, usuarioNome: alvo.nome, regra: cfg.regra, em: agora });
      // Fica na conversa, para todo mundo ver de onde veio a dona. Entra logo antes da última mensagem: a lista de
      // conversas continua mostrando a mensagem da cliente (ou da IA), não o aviso.
      // (Sem mensagem ainda — conversa criada pelo simulador antes da mensagem — fica no começo da conversa.)
      const ultima = (await this.o.repo.mensagens(c.id, 1)).at(-1)?.em ?? c.criadaEm;
      await this.o.repo.adicionarMensagem({
        conversaId: c.id,
        autor: 'sistema',
        texto: `Rodízio automático: conversa passada para ${alvo.nome} (${cfg.regra === 'carga' ? 'menor carga' : 'vez no rodízio'}).`,
        em: new Date(ultima.getTime() - 1),
      });
      return { feito: true, usuarioId: alvo.id, usuarioNome: alvo.nome };
    });
    if (!r) return { feito: false, motivo: 'nao_existe' };
    if (!r.feito && r.motivo === 'ninguem_disponivel') this.log(`Rodízio: ninguém disponível em ${unidadeDe(inicio.unidade).nome}; a conversa ficou para a unidade`, { conversaId });
    return r;
  }

  /** Para a tela: pessoas de cada unidade, se estão disponíveis, quantas receberam hoje e a carga. */
  async painel(unidade: UnidadeId, cfg: ConfigRodizio) {
    const base = { empresaId: this.o.empresaId, unidade };
    // Na tela aparece todo mundo que pode receber (para escolher quem participa), não só a linha de frente.
    const todos = await this.elegiveis(base, { ...cfg, participantes: [] });
    const extras = cfg.participantes.length ? (await this.elegiveis(base, cfg)).filter((u) => !todos.some((x) => x.id === u.id)) : [];
    const pessoas = [...todos, ...extras];
    const livres = new Set(await disponiveis(this.o.presencas, pessoas.map((u) => u.id)));
    const p = partesBahia(this.agora());
    const hoje = await this.o.armazem.contagem(this.o.empresaId, unidade, bahia(p.ano, p.mes, p.dia));
    const carga = await this.o.armazem.carga(this.o.empresaId, pessoas.map((u) => u.id), new Date(this.agora().getTime() - JANELA_CARGA_MS));
    const participa = (u: Usuario) => (cfg.participantes.length ? cfg.participantes.includes(u.id) : u.papel === 'atendente' || u.papel === 'recepcionista');
    return pessoas
      .map((u) => ({ id: u.id, nome: u.nome, papel: u.papel, disponivel: livres.has(u.id), participa: participa(u), recebidasHoje: hoje.get(u.id) ?? 0, carga: carga.get(u.id) ?? 0 }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  recentes(unidades: UnidadeId[], limite = 20) {
    return this.o.armazem.recentes(this.o.empresaId, unidades, limite);
  }
}
