import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Conversa } from '../domain.js';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import { sqlEscopo } from '../painel/escopo-sql.js';

/**
 * Tags (etiquetas) criadas pela empresa. A marcação fica numa tabela própria (conversa_tags),
 * por id: renomear ou trocar a cor vale em todas as conversas, e marcar/desmarcar nunca é
 * sobrescrito por quem grava a conversa inteira ao mesmo tempo.
 * O array antigo Conversa.etiquetas continua só para avisos do sistema ("precisa da equipe").
 */

/** Paleta fixa: tons médios, legíveis com texto branco no claro e no escuro (âmbar pede texto escuro). */
export const PALETA_TAGS = [
  { id: 'vermelho', nome: 'Vermelho', hex: '#E5484D', texto: '#FFFFFF' },
  { id: 'laranja', nome: 'Laranja', hex: '#F76B15', texto: '#FFFFFF' },
  { id: 'ambar', nome: 'Âmbar', hex: '#D4A017', texto: '#1F1600' },
  { id: 'verde', nome: 'Verde', hex: '#30A46C', texto: '#FFFFFF' },
  { id: 'turquesa', nome: 'Turquesa', hex: '#12A594', texto: '#FFFFFF' },
  { id: 'azul', nome: 'Azul', hex: '#0090FF', texto: '#FFFFFF' },
  { id: 'indigo', nome: 'Índigo', hex: '#3E63DD', texto: '#FFFFFF' },
  { id: 'roxo', nome: 'Roxo', hex: '#8E4EC6', texto: '#FFFFFF' },
  { id: 'rosa', nome: 'Rosa', hex: '#D6409F', texto: '#FFFFFF' },
  { id: 'cinza', nome: 'Cinza', hex: '#8B8D98', texto: '#FFFFFF' },
] as const;
export const CORES_TAGS: readonly string[] = PALETA_TAGS.map((c) => c.hex);

export interface Tag {
  id: string;
  empresaId: string;
  nome: string;
  cor: string;
  ordem: number;
  criadaPor: string | null;
  criadaEm: Date;
  /** Funil de que esta tag é etapa (coluna). null = tag solta. */
  funilId: string | null;
  /** Etapa fixa que esta tag espelha (só no funil do sistema "Atendimento"). */
  chaveSistema: string | null;
}

/** Marcação de uma etapa de funil numa conversa: desde quando ela está ali. */
export interface MarcacaoEtapa {
  conversaId: string;
  tagId: string;
  funilId: string;
  desde: Date;
}

/** Erro de regra (nome repetido, cor fora da paleta...): vira 400/404/409 na API. */
export class ErroTag extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
  }
}

export const limparNome = (nome: string) => nome.replace(/\s+/g, ' ').trim();

export interface ArmazemTags {
  listar(empresaId: string): Promise<Tag[]>;
  buscar(id: string): Promise<Tag | undefined>;
  /** Recusa (ErroTag 409) se já existe uma com o mesmo nome (sem diferenciar maiúsculas). */
  criar(t: Tag): Promise<void>;
  atualizar(id: string, campos: Partial<Pick<Tag, 'nome' | 'cor' | 'ordem'>>): Promise<void>;
  /** Apaga a tag e tira de todas as conversas. Devolve de quantas conversas saiu. */
  apagar(id: string): Promise<number>;
  /** true se marcou agora (false se já estava). */
  marcar(conversaId: string, tagId: string, por: string, em: Date): Promise<boolean>;
  desmarcar(conversaId: string, tagId: string): Promise<boolean>;
  /** Ids das tags de cada conversa da empresa (só as que têm alguma). */
  marcacoes(empresaId: string, conversaIds?: string[]): Promise<Map<string, string[]>>;
  /** Quantas conversas dentro do escopo têm cada tag. */
  contar(empresaId: string, escopo: EscopoVisao): Promise<Map<string, number>>;

  // ---------- etapas de funil (tags exclusivas dentro do funil) ----------
  /**
   * Põe a conversa na etapa `tagId` do funil `funilId`, tirando da etapa anterior do mesmo funil
   * numa operação só. `de` = etapa anterior (null se estava fora do funil).
   */
  marcarEtapa(conversaId: string, tagId: string, funilId: string, por: string, em: Date): Promise<{ de: string | null; mudou: boolean }>;
  /** Tira a conversa do funil. Devolve a etapa em que estava (null se não estava). */
  tirarDoFunil(conversaId: string, funilId: string): Promise<string | null>;
  /** Etapas em que a conversa está (uma por funil). */
  etapasDaConversa(conversaId: string): Promise<MarcacaoEtapa[]>;
  /** Todas as marcações de um funil (memória e conferências; o quadro do Postgres usa SQL próprio). */
  etapasDoFunil(funilId: string): Promise<MarcacaoEtapa[]>;
  /** Passa todas as conversas de uma etapa para outra do mesmo funil. Devolve quantas. */
  moverTodas(deTagId: string, paraTagId: string, por: string, em: Date): Promise<number>;
}

export class ArmazemTagsMemoria implements ArmazemTags {
  private readonly tags = new Map<string, Tag>();
  /** conversaId → tagId → quando marcou. */
  private readonly marcadas = new Map<string, Map<string, Date>>();

  /** Precisa das conversas para contar dentro do escopo. */
  constructor(private readonly conversas: () => Promise<Conversa[]>) {}

  async listar(empresaId: string) {
    return [...this.tags.values()].filter((t) => t.empresaId === empresaId).map((t) => ({ ...t }));
  }
  async buscar(id: string) {
    const t = this.tags.get(id);
    return t ? { ...t } : undefined;
  }
  /** Nome repetido entre as soltas ou dentro do mesmo funil. */
  private repetida(empresaId: string, funilId: string | null, nome: string, exceto?: string) {
    return [...this.tags.values()].some(
      (t) => t.empresaId === empresaId && (t.funilId ?? null) === (funilId ?? null) && t.id !== exceto && t.nome.toLowerCase() === nome.toLowerCase(),
    );
  }
  async criar(t: Tag) {
    if (this.repetida(t.empresaId, t.funilId, t.nome)) throw new ErroTag(`Já existe ${t.funilId ? 'a etapa' : 'a tag'} "${t.nome}".`, 409);
    this.tags.set(t.id, { ...t, funilId: t.funilId ?? null, chaveSistema: t.chaveSistema ?? null });
  }
  async atualizar(id: string, campos: Partial<Pick<Tag, 'nome' | 'cor' | 'ordem'>>) {
    const t = this.tags.get(id);
    if (!t) return;
    if (campos.nome !== undefined && this.repetida(t.empresaId, t.funilId, campos.nome, id)) {
      throw new ErroTag(`Já existe ${t.funilId ? 'a etapa' : 'a tag'} "${campos.nome}".`, 409);
    }
    this.tags.set(id, { ...t, ...Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)) });
  }
  async apagar(id: string) {
    this.tags.delete(id);
    let n = 0;
    for (const s of this.marcadas.values()) if (s.delete(id)) n++;
    return n;
  }
  async marcar(conversaId: string, tagId: string, _por?: string, em: Date = new Date()) {
    const s = this.marcadas.get(conversaId) ?? new Map<string, Date>();
    if (s.has(tagId)) return false;
    s.set(tagId, em);
    this.marcadas.set(conversaId, s);
    return true;
  }
  async desmarcar(conversaId: string, tagId: string) {
    return this.marcadas.get(conversaId)?.delete(tagId) ?? false;
  }
  async marcacoes(empresaId: string, conversaIds?: string[]) {
    const daEmpresa = new Set((await this.listar(empresaId)).map((t) => t.id));
    const filtro = conversaIds ? new Set(conversaIds) : undefined;
    const r = new Map<string, string[]>();
    for (const [c, s] of this.marcadas) {
      if (filtro && !filtro.has(c)) continue;
      const ids = [...s.keys()].filter((x) => daEmpresa.has(x));
      if (ids.length) r.set(c, ids);
    }
    return r;
  }
  async contar(empresaId: string, escopo: EscopoVisao) {
    const vistas = new Set((await this.conversas()).filter((c) => c.empresaId === empresaId && noEscopo(escopo, c)).map((c) => c.id));
    const r = new Map<string, number>();
    for (const [c, ids] of await this.marcacoes(empresaId)) {
      if (!vistas.has(c)) continue;
      for (const id of ids) r.set(id, (r.get(id) ?? 0) + 1);
    }
    return r;
  }
  private etapaNoFunil(conversaId: string, funilId: string): string | null {
    for (const id of this.marcadas.get(conversaId)?.keys() ?? []) if (this.tags.get(id)?.funilId === funilId) return id;
    return null;
  }
  async marcarEtapa(conversaId: string, tagId: string, funilId: string, _por: string, em: Date) {
    const de = this.etapaNoFunil(conversaId, funilId);
    if (de === tagId) return { de, mudou: false };
    const s = this.marcadas.get(conversaId) ?? new Map<string, Date>();
    if (de) s.delete(de);
    s.set(tagId, em);
    this.marcadas.set(conversaId, s);
    return { de, mudou: true };
  }
  async tirarDoFunil(conversaId: string, funilId: string) {
    const de = this.etapaNoFunil(conversaId, funilId);
    if (de) this.marcadas.get(conversaId)!.delete(de);
    return de;
  }
  async etapasDaConversa(conversaId: string) {
    const r: MarcacaoEtapa[] = [];
    for (const [tagId, desde] of this.marcadas.get(conversaId) ?? []) {
      const funilId = this.tags.get(tagId)?.funilId;
      if (funilId) r.push({ conversaId, tagId, funilId, desde });
    }
    return r;
  }
  async etapasDoFunil(funilId: string) {
    const r: MarcacaoEtapa[] = [];
    for (const [conversaId, s] of this.marcadas) {
      for (const [tagId, desde] of s) if (this.tags.get(tagId)?.funilId === funilId) r.push({ conversaId, tagId, funilId, desde });
    }
    return r;
  }
  async moverTodas(deTagId: string, paraTagId: string, _por: string, em: Date) {
    let n = 0;
    for (const s of this.marcadas.values()) {
      if (!s.delete(deTagId)) continue;
      n++;
      if (!s.has(paraTagId)) s.set(paraTagId, em);
    }
    return n;
  }
}

interface LinhaTag {
  id: string;
  empresa_id: string;
  nome: string;
  cor: string;
  ordem: number;
  criada_por: string | null;
  criada_em: Date;
  funil_id: string | null;
  chave_sistema: string | null;
}
const COLUNAS_TAG = 'id, empresa_id, nome, cor, ordem, criada_por, criada_em, funil_id, chave_sistema';
const paraTag = (l: LinhaTag): Tag => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  cor: l.cor,
  ordem: l.ordem,
  criadaPor: l.criada_por,
  criadaEm: l.criada_em,
  funilId: l.funil_id,
  chaveSistema: l.chave_sistema,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nomeRepetido = (e: unknown) => (e as { code?: string }).code === '23505';

export class ArmazemTagsPostgres implements ArmazemTags {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string) {
    const { rows } = await this.pool.query<LinhaTag>(
      `select ${COLUNAS_TAG} from sintonia.tags where empresa_id = $1`,
      [empresaId],
    );
    return rows.map(paraTag);
  }
  async buscar(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaTag>(
      `select ${COLUNAS_TAG} from sintonia.tags where id = $1`,
      [id],
    );
    return rows[0] ? paraTag(rows[0]) : undefined;
  }
  async criar(t: Tag) {
    try {
      await this.pool.query(
        `insert into sintonia.tags (id, empresa_id, nome, cor, ordem, criada_por, criada_em, funil_id, chave_sistema)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [t.id, t.empresaId, t.nome, t.cor, t.ordem, t.criadaPor, t.criadaEm, t.funilId ?? null, t.chaveSistema ?? null],
      );
    } catch (e) {
      if (nomeRepetido(e)) throw new ErroTag(`Já existe ${t.funilId ? 'a etapa' : 'a tag'} "${t.nome}".`, 409);
      throw e;
    }
  }
  async atualizar(id: string, campos: Partial<Pick<Tag, 'nome' | 'cor' | 'ordem'>>) {
    try {
      await this.pool.query(
        `update sintonia.tags set nome = coalesce($2, nome), cor = coalesce($3, cor), ordem = coalesce($4, ordem) where id = $1`,
        [id, campos.nome ?? null, campos.cor ?? null, campos.ordem ?? null],
      );
    } catch (e) {
      if (nomeRepetido(e)) throw new ErroTag(`Já existe a tag "${campos.nome}".`, 409);
      throw e;
    }
  }
  async apagar(id: string) {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('begin');
      const r = await cliente.query('delete from sintonia.conversa_tags where tag_id = $1', [id]);
      await cliente.query('delete from sintonia.tags where id = $1', [id]);
      await cliente.query('commit');
      return r.rowCount ?? 0;
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }
  async marcar(conversaId: string, tagId: string, por: string, em: Date) {
    const r = await this.pool.query(
      `insert into sintonia.conversa_tags (conversa_id, tag_id, marcada_por, marcada_em, funil_id)
       select $1, $2, $3, $4, (select funil_id from sintonia.tags where id = $2)
       on conflict do nothing`,
      [conversaId, tagId, por, em],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async desmarcar(conversaId: string, tagId: string) {
    const r = await this.pool.query('delete from sintonia.conversa_tags where conversa_id = $1 and tag_id = $2', [conversaId, tagId]);
    return (r.rowCount ?? 0) > 0;
  }
  async marcacoes(empresaId: string, conversaIds?: string[]) {
    const { rows } = await this.pool.query<{ conversa_id: string; ids: string[] }>(
      `select ct.conversa_id, array_agg(ct.tag_id::text order by t.ordem, t.nome) as ids
         from sintonia.conversa_tags ct join sintonia.tags t on t.id = ct.tag_id
        where t.empresa_id = $1 and ($2::uuid[] is null or ct.conversa_id = any($2::uuid[]))
        group by ct.conversa_id`,
      [empresaId, conversaIds ? conversaIds.filter((x) => UUID.test(x)) : null],
    );
    return new Map(rows.map((r) => [r.conversa_id, r.ids]));
  }
  async contar(empresaId: string, escopo: EscopoVisao) {
    const params: unknown[] = [empresaId];
    const onde = sqlEscopo(escopo, 'c', params);
    const { rows } = await this.pool.query<{ tag_id: string; n: number }>(
      `select ct.tag_id::text as tag_id, count(*)::int as n
         from sintonia.conversa_tags ct
         join sintonia.tags t on t.id = ct.tag_id
         join sintonia.conversas c on c.id = ct.conversa_id
        where t.empresa_id = $1 and ${onde}
        group by ct.tag_id`,
      params,
    );
    return new Map(rows.map((r) => [r.tag_id, r.n]));
  }
  async marcarEtapa(conversaId: string, tagId: string, funilId: string, por: string, em: Date) {
    // Trava curta por conversa+funil dentro da transação: duas mudanças ao mesmo tempo nunca deixam duas etapas.
    const cliente = await this.pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`funil:${conversaId}:${funilId}`]);
      const { rows } = await cliente.query<{ tag_id: string }>(
        'select tag_id::text from sintonia.conversa_tags where conversa_id = $1 and funil_id = $2',
        [conversaId, funilId],
      );
      const de = rows[0]?.tag_id ?? null;
      if (de === tagId) {
        await cliente.query('commit');
        return { de, mudou: false };
      }
      if (de) await cliente.query('delete from sintonia.conversa_tags where conversa_id = $1 and funil_id = $2', [conversaId, funilId]);
      await cliente.query(
        'insert into sintonia.conversa_tags (conversa_id, tag_id, funil_id, marcada_por, marcada_em) values ($1, $2, $3, $4, $5)',
        [conversaId, tagId, funilId, por, em],
      );
      await cliente.query('commit');
      return { de, mudou: true };
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }
  async tirarDoFunil(conversaId: string, funilId: string) {
    const { rows } = await this.pool.query<{ tag_id: string }>(
      'delete from sintonia.conversa_tags where conversa_id = $1 and funil_id = $2 returning tag_id::text',
      [conversaId, funilId],
    );
    return rows[0]?.tag_id ?? null;
  }
  async etapasDaConversa(conversaId: string) {
    if (!UUID.test(conversaId)) return [];
    const { rows } = await this.pool.query<{ tag_id: string; funil_id: string; marcada_em: Date }>(
      'select tag_id::text, funil_id::text, marcada_em from sintonia.conversa_tags where conversa_id = $1 and funil_id is not null',
      [conversaId],
    );
    return rows.map((r) => ({ conversaId, tagId: r.tag_id, funilId: r.funil_id, desde: r.marcada_em }));
  }
  async etapasDoFunil(funilId: string) {
    const { rows } = await this.pool.query<{ conversa_id: string; tag_id: string; marcada_em: Date }>(
      'select conversa_id::text, tag_id::text, marcada_em from sintonia.conversa_tags where funil_id = $1',
      [funilId],
    );
    return rows.map((r) => ({ conversaId: r.conversa_id, tagId: r.tag_id, funilId, desde: r.marcada_em }));
  }
  async moverTodas(deTagId: string, paraTagId: string, por: string, em: Date) {
    const r = await this.pool.query(
      `update sintonia.conversa_tags set tag_id = $2, marcada_por = $3, marcada_em = $4
        where tag_id = $1`,
      [deTagId, paraTagId, por, em],
    );
    return r.rowCount ?? 0;
  }
}

/** Tag como aparece na conversa (para a tela). Etapa de funil da empresa vem com `funilId`. */
export type TagResumo = Pick<Tag, 'id' | 'nome' | 'cor'> & { funilId?: string };
const resumo = (t: Tag): TagResumo => (t.funilId ? { id: t.id, nome: t.nome, cor: t.cor, funilId: t.funilId } : { id: t.id, nome: t.nome, cor: t.cor });

/**
 * Quem cuida das etapas de funil (src/funis/funis.ts): marcar/desmarcar uma tag que é etapa passa por ele,
 * para valer a exclusividade, a sincronia com a etapa do sistema e as automações.
 */
export interface DelegadoEtapas {
  marcarEtapa(c: Conversa, tag: Tag, por: string): Promise<boolean>;
  desmarcarEtapa(c: Conversa, tag: Tag, por: string): Promise<boolean>;
}
const ordenar = (l: Tag[]) => l.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));

/** Regras das tags em cima do armazém. As permissões ficam nas rotas. */
export class Tags {
  constructor(
    private readonly armazem: ArmazemTags,
    readonly empresaId: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private delegado?: DelegadoEtapas;
  private readonly observadores: Array<(c: Conversa, tag: Tag, por: string) => Promise<void>> = [];

  /** Liga os funis: marcar uma etapa passa a mover o cartão (e vice-versa). */
  usarFunis(d: DelegadoEtapas): void {
    this.delegado = d;
  }
  /** Avisado quando uma tag SOLTA é marcada de verdade (etapas avisam pelos funis). */
  aoMarcar(fn: (c: Conversa, tag: Tag, por: string) => Promise<void>): void {
    this.observadores.push(fn);
  }

  /** Todas as tags da empresa, soltas e etapas de funil. */
  async listar(): Promise<Tag[]> {
    return ordenar(await this.armazem.listar(this.empresaId));
  }

  /** Só as tags soltas (as que aparecem em Conta › Tags e que a IA pode marcar). */
  async soltas(): Promise<Tag[]> {
    return (await this.listar()).filter((t) => !t.funilId);
  }

  async listarComContagem(escopo: EscopoVisao) {
    const [lista, n] = await Promise.all([this.soltas(), this.armazem.contar(this.empresaId, escopo)]);
    return lista.map((t) => ({ ...t, conversas: n.get(t.id) ?? 0 }));
  }

  /** Tag da empresa (404 se não existe ou é de outra empresa). */
  async exigir(id: string): Promise<Tag> {
    const t = await this.armazem.buscar(id);
    if (!t || t.empresaId !== this.empresaId) throw new ErroTag('Tag não encontrada.', 404);
    return t;
  }

  async criar(dados: { nome: string; cor?: string }, por: string): Promise<Tag> {
    const nome = validarNome(dados.nome);
    const lista = await this.soltas();
    const cor = dados.cor ? validarCor(dados.cor) : CORES_TAGS[lista.length % CORES_TAGS.length]!;
    const t: Tag = {
      id: randomUUID(),
      empresaId: this.empresaId,
      nome,
      cor,
      ordem: lista.reduce((m, x) => Math.max(m, x.ordem), -1) + 1,
      criadaPor: por,
      criadaEm: this.agora(),
      funilId: null,
      chaveSistema: null,
    };
    await this.armazem.criar(t);
    return t;
  }

  async alterar(id: string, campos: { nome?: string; cor?: string }): Promise<Tag> {
    await this.exigir(id);
    await this.armazem.atualizar(id, {
      nome: campos.nome !== undefined ? validarNome(campos.nome) : undefined,
      cor: campos.cor !== undefined ? validarCor(campos.cor) : undefined,
    });
    return this.exigir(id);
  }

  /** Nova ordem: os ids na ordem desejada (os que faltarem vão para o fim, na ordem em que estavam). */
  async reordenar(ids: string[]): Promise<Tag[]> {
    const lista = await this.soltas();
    const conhecidas = new Set(lista.map((t) => t.id));
    const desconhecida = ids.find((x) => !conhecidas.has(x));
    if (desconhecida) throw new ErroTag('Tag não encontrada.', 404);
    const final = [...new Set(ids), ...lista.map((t) => t.id).filter((x) => !ids.includes(x))];
    for (const [i, id] of final.entries()) {
      if (lista.find((t) => t.id === id)!.ordem !== i) await this.armazem.atualizar(id, { ordem: i });
    }
    return this.soltas();
  }

  async apagar(id: string): Promise<number> {
    const t = await this.exigir(id);
    if (t.funilId) throw new ErroTag('Esta tag é uma etapa de funil: apague pela tela do funil.', 409);
    return this.armazem.apagar(id);
  }

  /** Marca a tag. Se for etapa de funil, a conversa sai da etapa anterior do mesmo funil. */
  async marcar(c: Conversa, tagId: string, por: string): Promise<{ tag: Tag; mudou: boolean }> {
    const tag = await this.exigir(tagId);
    if (tag.funilId) {
      const mudou = this.delegado
        ? await this.delegado.marcarEtapa(c, tag, por)
        : (await this.armazem.marcarEtapa(c.id, tag.id, tag.funilId, por, this.agora())).mudou;
      return { tag, mudou };
    }
    const mudou = await this.armazem.marcar(c.id, tag.id, por, this.agora());
    if (mudou) for (const fn of this.observadores) await fn(c, tag, por);
    return { tag, mudou };
  }

  async desmarcar(c: Conversa, tagId: string, por = 'equipe'): Promise<{ tag: Tag; mudou: boolean }> {
    const tag = await this.exigir(tagId);
    if (tag.funilId && this.delegado) return { tag, mudou: await this.delegado.desmarcarEtapa(c, tag, por) };
    return { tag, mudou: await this.armazem.desmarcar(c.id, tag.id) };
  }

  /**
   * Tags de cada conversa, prontas para a tela (id, nome, cor), na ordem da empresa: as soltas e as etapas
   * dos funis da empresa (com `funilId`). As etapas do funil do sistema ficam de fora: já estão em `conversa.etapa`.
   */
  async dasConversas(conversaIds?: string[]): Promise<Map<string, TagResumo[]>> {
    const [todas, marcas] = await Promise.all([this.listar(), this.armazem.marcacoes(this.empresaId, conversaIds)]);
    const lista = todas.filter((t) => !t.chaveSistema);
    const porId = new Map(lista.map((t, i) => [t.id, { t, i }]));
    const r = new Map<string, TagResumo[]>();
    for (const [c, ids] of marcas) {
      r.set(
        c,
        ids
          .map((id) => porId.get(id))
          .filter((x): x is { t: Tag; i: number } => Boolean(x))
          .sort((a, b) => a.i - b.i)
          .map((x) => resumo(x.t)),
      );
    }
    return r;
  }

  /** A conversa tem esta tag (solta ou etapa, inclusive do funil do sistema)? */
  async temTag(conversaId: string, tagId: string): Promise<boolean> {
    return ((await this.armazem.marcacoes(this.empresaId, [conversaId])).get(conversaId) ?? []).includes(tagId);
  }

  async daConversa(conversaId: string): Promise<TagResumo[]> {
    return (await this.dasConversas([conversaId])).get(conversaId) ?? [];
  }

  /** Tag existente com este nome (sem diferenciar maiúsculas e espaços), ou undefined. */
  async porNome(nome: string): Promise<Tag | undefined> {
    const alvo = limparNome(nome).toLowerCase();
    return (await this.soltas()).find((t) => t.nome.toLowerCase() === alvo);
  }
}

export function validarNome(bruto: string): string {
  const nome = limparNome(bruto);
  if (nome.length < 1) throw new ErroTag('Dê um nome para a tag.', 400);
  if (nome.length > 30) throw new ErroTag('O nome da tag pode ter até 30 letras.', 400);
  return nome;
}

export function validarCor(bruto: string): string {
  const cor = CORES_TAGS.find((c) => c.toLowerCase() === bruto.trim().toLowerCase());
  if (!cor) throw new ErroTag('Escolha uma das cores da paleta.', 400);
  return cor;
}

/**
 * A IA marcando tags sozinha: só quando a empresa ligou, e só nomes que já existem (nunca cria).
 * Usado pela Sintonia (lista de nomes para a ferramenta e aplicação da ação).
 */
export class TagsDaIa {
  constructor(
    private readonly tags: Tags,
    private readonly ligada: () => Promise<boolean>,
  ) {}

  /** Nomes que a IA pode usar agora (vazio = a IA não marca tags). */
  async nomes(): Promise<string[]> {
    if (!(await this.ligada())) return [];
    return (await this.tags.soltas()).map((t) => t.nome);
  }

  /** Marca a tag de nome `nome`, se existir e a opção estiver ligada. Devolve a tag marcada agora, ou undefined. */
  async aplicar(c: Conversa, nome: string): Promise<TagResumo | undefined> {
    if (c.empresaId !== this.tags.empresaId || !(await this.ligada())) return undefined;
    const t = await this.tags.porNome(nome);
    if (!t) return undefined;
    const { mudou } = await this.tags.marcar(c, t.id, 'IA');
    return mudou ? resumo(t) : undefined;
  }
}
