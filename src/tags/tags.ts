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
}

export class ArmazemTagsMemoria implements ArmazemTags {
  private readonly tags = new Map<string, Tag>();
  private readonly marcadas = new Map<string, Set<string>>(); // conversaId → tagIds

  /** Precisa das conversas para contar dentro do escopo. */
  constructor(private readonly conversas: () => Promise<Conversa[]>) {}

  async listar(empresaId: string) {
    return [...this.tags.values()].filter((t) => t.empresaId === empresaId).map((t) => ({ ...t }));
  }
  async buscar(id: string) {
    const t = this.tags.get(id);
    return t ? { ...t } : undefined;
  }
  private repetida(empresaId: string, nome: string, exceto?: string) {
    return [...this.tags.values()].some((t) => t.empresaId === empresaId && t.id !== exceto && t.nome.toLowerCase() === nome.toLowerCase());
  }
  async criar(t: Tag) {
    if (this.repetida(t.empresaId, t.nome)) throw new ErroTag(`Já existe a tag "${t.nome}".`, 409);
    this.tags.set(t.id, { ...t });
  }
  async atualizar(id: string, campos: Partial<Pick<Tag, 'nome' | 'cor' | 'ordem'>>) {
    const t = this.tags.get(id);
    if (!t) return;
    if (campos.nome !== undefined && this.repetida(t.empresaId, campos.nome, id)) throw new ErroTag(`Já existe a tag "${campos.nome}".`, 409);
    this.tags.set(id, { ...t, ...Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)) });
  }
  async apagar(id: string) {
    this.tags.delete(id);
    let n = 0;
    for (const s of this.marcadas.values()) if (s.delete(id)) n++;
    return n;
  }
  async marcar(conversaId: string, tagId: string) {
    const s = this.marcadas.get(conversaId) ?? new Set();
    if (s.has(tagId)) return false;
    s.add(tagId);
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
      const ids = [...s].filter((x) => daEmpresa.has(x));
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
}

interface LinhaTag {
  id: string;
  empresa_id: string;
  nome: string;
  cor: string;
  ordem: number;
  criada_por: string | null;
  criada_em: Date;
}
const paraTag = (l: LinhaTag): Tag => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  cor: l.cor,
  ordem: l.ordem,
  criadaPor: l.criada_por,
  criadaEm: l.criada_em,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nomeRepetido = (e: unknown) => (e as { code?: string }).code === '23505';

export class ArmazemTagsPostgres implements ArmazemTags {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string) {
    const { rows } = await this.pool.query<LinhaTag>(
      'select id, empresa_id, nome, cor, ordem, criada_por, criada_em from sintonia.tags where empresa_id = $1',
      [empresaId],
    );
    return rows.map(paraTag);
  }
  async buscar(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaTag>(
      'select id, empresa_id, nome, cor, ordem, criada_por, criada_em from sintonia.tags where id = $1',
      [id],
    );
    return rows[0] ? paraTag(rows[0]) : undefined;
  }
  async criar(t: Tag) {
    try {
      await this.pool.query(
        'insert into sintonia.tags (id, empresa_id, nome, cor, ordem, criada_por, criada_em) values ($1, $2, $3, $4, $5, $6, $7)',
        [t.id, t.empresaId, t.nome, t.cor, t.ordem, t.criadaPor, t.criadaEm],
      );
    } catch (e) {
      if (nomeRepetido(e)) throw new ErroTag(`Já existe a tag "${t.nome}".`, 409);
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
      `insert into sintonia.conversa_tags (conversa_id, tag_id, marcada_por, marcada_em) values ($1, $2, $3, $4)
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
}

/** Tag como aparece na conversa (para a tela). */
export type TagResumo = Pick<Tag, 'id' | 'nome' | 'cor'>;
const resumo = (t: Tag): TagResumo => ({ id: t.id, nome: t.nome, cor: t.cor });
const ordenar = (l: Tag[]) => l.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));

/** Regras das tags em cima do armazém. As permissões ficam nas rotas. */
export class Tags {
  constructor(
    private readonly armazem: ArmazemTags,
    readonly empresaId: string,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async listar(): Promise<Tag[]> {
    return ordenar(await this.armazem.listar(this.empresaId));
  }

  async listarComContagem(escopo: EscopoVisao) {
    const [lista, n] = await Promise.all([this.listar(), this.armazem.contar(this.empresaId, escopo)]);
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
    const lista = await this.listar();
    const cor = dados.cor ? validarCor(dados.cor) : CORES_TAGS[lista.length % CORES_TAGS.length]!;
    const t: Tag = {
      id: randomUUID(),
      empresaId: this.empresaId,
      nome,
      cor,
      ordem: lista.reduce((m, x) => Math.max(m, x.ordem), -1) + 1,
      criadaPor: por,
      criadaEm: this.agora(),
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
    const lista = await this.listar();
    const conhecidas = new Set(lista.map((t) => t.id));
    const desconhecida = ids.find((x) => !conhecidas.has(x));
    if (desconhecida) throw new ErroTag('Tag não encontrada.', 404);
    const final = [...new Set(ids), ...lista.map((t) => t.id).filter((x) => !ids.includes(x))];
    for (const [i, id] of final.entries()) {
      if (lista.find((t) => t.id === id)!.ordem !== i) await this.armazem.atualizar(id, { ordem: i });
    }
    return this.listar();
  }

  async apagar(id: string): Promise<number> {
    await this.exigir(id);
    return this.armazem.apagar(id);
  }

  async marcar(c: Conversa, tagId: string, por: string): Promise<{ tag: Tag; mudou: boolean }> {
    const tag = await this.exigir(tagId);
    return { tag, mudou: await this.armazem.marcar(c.id, tag.id, por, this.agora()) };
  }

  async desmarcar(c: Conversa, tagId: string): Promise<{ tag: Tag; mudou: boolean }> {
    const tag = await this.exigir(tagId);
    return { tag, mudou: await this.armazem.desmarcar(c.id, tag.id) };
  }

  /** Tags de cada conversa, prontas para a tela (id, nome, cor), na ordem da empresa. */
  async dasConversas(conversaIds?: string[]): Promise<Map<string, TagResumo[]>> {
    const [lista, marcas] = await Promise.all([this.listar(), this.armazem.marcacoes(this.empresaId, conversaIds)]);
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

  async daConversa(conversaId: string): Promise<TagResumo[]> {
    return (await this.dasConversas([conversaId])).get(conversaId) ?? [];
  }

  /** Tag existente com este nome (sem diferenciar maiúsculas e espaços), ou undefined. */
  async porNome(nome: string): Promise<Tag | undefined> {
    const alvo = limparNome(nome).toLowerCase();
    return (await this.listar()).find((t) => t.nome.toLowerCase() === alvo);
  }
}

function validarNome(bruto: string): string {
  const nome = limparNome(bruto);
  if (nome.length < 1) throw new ErroTag('Dê um nome para a tag.', 400);
  if (nome.length > 30) throw new ErroTag('O nome da tag pode ter até 30 letras.', 400);
  return nome;
}

function validarCor(bruto: string): string {
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
    return (await this.tags.listar()).map((t) => t.nome);
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
