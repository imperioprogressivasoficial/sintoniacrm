import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizar } from '../comercial/calculo.js';

/**
 * Cadastro da empresa (menu Empresa): dados (CNPJ, endereço, contato, fuso, horário), logo, unidades,
 * produtos e serviços, tabelas de preço e documentos. Tudo por empresa (empresa_id); migração 490.
 * As regras de quem pode o quê ficam nas rotas (cadastro-rotas.ts); aqui só guardar e ler sem confiar no banco.
 */

// ---------------------------------------------------------------- formatos

const T = (max: number) => z.string().trim().max(max);
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato 09:00');

export const Endereco = z
  .object({
    cep: z.string().trim().max(9).regex(/^(\d{5}-?\d{3})?$/, 'CEP inválido').default(''),
    logradouro: T(160).default(''),
    numero: T(20).default(''),
    complemento: T(80).default(''),
    bairro: T(80).default(''),
    cidade: T(80).default(''),
    uf: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'UF com 2 letras').default(''),
  })
  .prefault({});
export type Endereco = z.infer<typeof Endereco>;

/** Um dia da semana: 0 = domingo … 6 = sábado. */
export const DiaHorario = z.object({ dia: z.number().int().min(0).max(6), aberto: z.boolean(), abre: HHMM, fecha: HHMM });
export const Horario = z
  .array(DiaHorario)
  .max(7)
  .transform((l) => {
    const m = new Map(l.map((d) => [d.dia, d]));
    return [0, 1, 2, 3, 4, 5, 6].map((dia) => m.get(dia) ?? { dia, aberto: false, abre: '09:00', fecha: '18:00' });
  });
export type Horario = z.infer<typeof Horario>;
export const horarioPadrao = (): Horario => [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, aberto: dia >= 1 && dia <= 5, abre: '09:00', fecha: '18:00' }));

/** CNPJ com os dígitos verificadores certos (aceita com ou sem pontuação). */
export function cnpjValido(v: string): boolean {
  const d = v.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
export const formatarCnpj = (v: string) => {
  const d = v.replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v;
};
const fusoValido = (f: string) => {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: f });
    return true;
  } catch {
    return false;
  }
};
const Email = z.union([z.literal(''), z.string().trim().toLowerCase().email('E-mail inválido').max(200)]);

export const DadosEmpresa = z.object({
  razaoSocial: T(160).default(''),
  cnpj: z
    .string()
    .trim()
    .max(20)
    .default('')
    .refine((v) => !v || cnpjValido(v), 'CNPJ inválido: confira os números.')
    .transform((v) => (v ? formatarCnpj(v) : '')),
  inscricaoEstadual: T(30).default(''),
  segmento: T(80).default(''),
  sobre: T(1000).default(''),
  telefone: T(30).default(''),
  whatsapp: T(30).default(''),
  email: Email.default(''),
  site: T(200).default(''),
  instagram: T(80).default(''),
  endereco: Endereco,
  fuso: z.string().trim().max(60).default('America/Bahia').refine(fusoValido, 'Fuso horário desconhecido'),
  horario: Horario.default(horarioPadrao),
});
export type DadosEmpresa = z.infer<typeof DadosEmpresa>;
export const dadosPadrao = (): DadosEmpresa => DadosEmpresa.parse({});
/** Lê o que veio do banco: campo estranho vira o padrão, sem derrubar a tela. */
export function lerDados(bruto: unknown): DadosEmpresa {
  const r = DadosEmpresa.safeParse(bruto ?? {});
  if (r.success) return r.data;
  const base = dadosPadrao();
  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof DadosEmpresa)[]) {
    const um = DadosEmpresa.shape[k].safeParse(o[k]);
    if (um.success) (base as Record<string, unknown>)[k] = um.data;
  }
  return base;
}

export const DadosUnidade = z.object({
  endereco: Endereco,
  telefone: T(30).default(''),
  whatsapp: T(30).default(''),
  email: Email.default(''),
  /** null = segue o horário da empresa. */
  horario: Horario.nullable().default(null),
  observacao: T(500).default(''),
});
export type DadosUnidade = z.infer<typeof DadosUnidade>;
export const lerDadosUnidade = (b: unknown): DadosUnidade => {
  const r = DadosUnidade.safeParse(b ?? {});
  return r.success ? r.data : DadosUnidade.parse({});
};

export const TIPOS_PRODUTO = ['produto', 'servico'] as const;
export type TipoProduto = (typeof TIPOS_PRODUTO)[number];
export const CATEGORIAS_DOCUMENTO = ['contrato', 'tabela', 'catalogo', 'apresentacao', 'manual', 'outro'] as const;
export type CategoriaDocumento = (typeof CATEGORIAS_DOCUMENTO)[number];

// ---------------------------------------------------------------- registros

export interface RegistroDadosEmpresa {
  nome: string;
  dados: DadosEmpresa;
  logoEm: Date | null;
  atualizadaEm: Date | null;
  atualizadaPor: string | null;
}

export interface Unidade {
  id: string;
  nome: string;
  ativa: boolean;
  ordem: number;
  dados: DadosUnidade;
  atualizadaEm: Date;
  atualizadaPor: string | null;
}

export interface Produto {
  id: string;
  nome: string;
  tipo: TipoProduto;
  categoria: string | null;
  /** null = sob consulta. */
  preco: number | null;
  duracaoMin: number | null;
  descricao: string;
  codigo: string;
  ativo: boolean;
  origem: string | null;
  fotoEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
  atualizadoPor: string | null;
}
export type NovoProduto = Pick<Produto, 'nome' | 'tipo' | 'categoria' | 'preco' | 'duracaoMin' | 'descricao' | 'codigo' | 'ativo'> & { origem?: string | null };

export interface TabelaPreco {
  id: string;
  nome: string;
  descricao: string;
  unidade: string | null;
  ativa: boolean;
  inicio: string | null;
  fim: string | null;
  itens: Array<{ produtoId: string; preco: number }>;
  atualizadaEm: Date;
  atualizadaPor: string | null;
}
export type NovaTabela = Omit<TabelaPreco, 'id' | 'atualizadaEm' | 'atualizadaPor'>;

export interface Documento {
  id: string;
  nome: string;
  categoria: CategoriaDocumento;
  descricao: string;
  visivel: 'equipe' | 'gestao';
  mimetype: string;
  tamanho: number;
  enviadoPor: string | null;
  enviadoEm: Date;
}
export type NovoDocumento = Omit<Documento, 'id' | 'enviadoEm' | 'tamanho'> & { conteudo: Buffer };

export interface Arquivo {
  conteudo: Buffer;
  tipo: string;
  em: Date;
}

export class ErroDuplicado extends Error {
  statusCode = 409;
}

export interface ArmazemCadastro {
  // dados e logo
  lerDados(empresaId: string): Promise<RegistroDadosEmpresa | undefined>;
  gravarDados(empresaId: string, dados: DadosEmpresa, por: string): Promise<void>;
  logo(empresaId: string): Promise<Arquivo | undefined>;
  gravarLogo(empresaId: string, logo: { conteudo: Buffer; tipo: string } | null): Promise<void>;
  /** Marca (uma vez) que a tabela de preços do Comercial já foi copiada. Devolve false se já estava marcada. */
  marcarImportacao(empresaId: string): Promise<boolean>;

  // unidades
  unidades(empresaId: string): Promise<Unidade[]>;
  salvarUnidade(empresaId: string, u: Omit<Unidade, 'atualizadaEm'>): Promise<Unidade>;
  apagarUnidade(empresaId: string, id: string): Promise<boolean>;

  // produtos
  produtos(empresaId: string): Promise<Produto[]>;
  produto(empresaId: string, id: string): Promise<Produto | undefined>;
  criarProduto(empresaId: string, p: NovoProduto, por: string): Promise<Produto>;
  alterarProduto(empresaId: string, id: string, p: Partial<NovoProduto>, por: string): Promise<Produto | undefined>;
  apagarProduto(empresaId: string, id: string): Promise<boolean>;
  fotoProduto(empresaId: string, id: string): Promise<Arquivo | undefined>;
  gravarFotoProduto(empresaId: string, id: string, foto: { conteudo: Buffer; tipo: string } | null): Promise<boolean>;

  // tabelas de preço
  tabelas(empresaId: string): Promise<TabelaPreco[]>;
  criarTabela(empresaId: string, t: NovaTabela, por: string): Promise<TabelaPreco>;
  alterarTabela(empresaId: string, id: string, t: NovaTabela, por: string): Promise<TabelaPreco | undefined>;
  apagarTabela(empresaId: string, id: string): Promise<boolean>;

  // documentos
  documentos(empresaId: string): Promise<Documento[]>;
  criarDocumento(empresaId: string, d: NovoDocumento): Promise<Documento>;
  alterarDocumento(empresaId: string, id: string, d: Partial<Pick<Documento, 'nome' | 'categoria' | 'descricao' | 'visivel'>>): Promise<Documento | undefined>;
  apagarDocumento(empresaId: string, id: string): Promise<boolean>;
  arquivoDocumento(empresaId: string, id: string): Promise<(Arquivo & { doc: Documento }) | undefined>;
}

const uuidOk = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const ordenarProdutos = (l: Produto[]) => l.sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, 'pt-BR'));

// ---------------------------------------------------------------- memória

export class ArmazemCadastroMemoria implements ArmazemCadastro {
  private readonly emp = new Map<string, { dados?: DadosEmpresa; logo?: Arquivo; importado?: boolean; em?: Date; por?: string }>();
  private readonly uns = new Map<string, Unidade[]>();
  private readonly prods = new Map<string, Array<Produto & { foto?: Arquivo }>>();
  private readonly tabs = new Map<string, TabelaPreco[]>();
  private readonly docs = new Map<string, Array<Documento & { conteudo: Buffer }>>();
  constructor(private readonly nomeDe: (empresaId: string) => Promise<string> = async (id) => id) {}

  private e(id: string) {
    if (!this.emp.has(id)) this.emp.set(id, {});
    return this.emp.get(id)!;
  }
  async lerDados(empresaId: string) {
    const e = this.emp.get(empresaId);
    return { nome: await this.nomeDe(empresaId), dados: lerDados(e?.dados), logoEm: e?.logo?.em ?? null, atualizadaEm: e?.em ?? null, atualizadaPor: e?.por ?? null };
  }
  async gravarDados(empresaId: string, dados: DadosEmpresa, por: string) {
    Object.assign(this.e(empresaId), { dados: structuredClone(dados), em: new Date(), por });
  }
  async logo(empresaId: string) {
    return this.emp.get(empresaId)?.logo;
  }
  async gravarLogo(empresaId: string, logo: { conteudo: Buffer; tipo: string } | null) {
    this.e(empresaId).logo = logo ? { ...logo, em: new Date() } : undefined;
  }
  async marcarImportacao(empresaId: string) {
    const e = this.e(empresaId);
    if (e.importado) return false;
    e.importado = true;
    return true;
  }

  async unidades(empresaId: string) {
    return (this.uns.get(empresaId) ?? []).map((u) => structuredClone(u)).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  }
  async salvarUnidade(empresaId: string, u: Omit<Unidade, 'atualizadaEm'>) {
    const l = this.uns.get(empresaId) ?? [];
    const novo: Unidade = { ...structuredClone(u), atualizadaEm: new Date() };
    const i = l.findIndex((x) => x.id === u.id);
    if (i >= 0) l[i] = novo;
    else l.push(novo);
    this.uns.set(empresaId, l);
    return structuredClone(novo);
  }
  async apagarUnidade(empresaId: string, id: string) {
    const l = this.uns.get(empresaId) ?? [];
    const n = l.length;
    this.uns.set(empresaId, l.filter((x) => x.id !== id));
    return n !== this.uns.get(empresaId)!.length;
  }

  private ps(empresaId: string) {
    if (!this.prods.has(empresaId)) this.prods.set(empresaId, []);
    return this.prods.get(empresaId)!;
  }
  private publico = ({ foto: _f, ...p }: Produto & { foto?: Arquivo }): Produto => ({ ...p });
  async produtos(empresaId: string) {
    return ordenarProdutos(this.ps(empresaId).map(this.publico));
  }
  async produto(empresaId: string, id: string) {
    const p = this.ps(empresaId).find((x) => x.id === id);
    return p ? this.publico(p) : undefined;
  }
  async criarProduto(empresaId: string, p: NovoProduto, por: string) {
    const l = this.ps(empresaId);
    if (l.some((x) => normalizar(x.nome) === normalizar(p.nome))) throw new ErroDuplicado('Já existe um produto ou serviço com esse nome.');
    const agora = new Date();
    const novo: Produto = { ...p, origem: p.origem ?? null, id: randomUUID(), fotoEm: null, criadoEm: agora, atualizadoEm: agora, atualizadoPor: por };
    l.push(novo);
    return { ...novo };
  }
  async alterarProduto(empresaId: string, id: string, p: Partial<NovoProduto>, por: string) {
    const l = this.ps(empresaId);
    const x = l.find((y) => y.id === id);
    if (!x) return undefined;
    if (p.nome !== undefined && l.some((y) => y.id !== id && normalizar(y.nome) === normalizar(p.nome!))) throw new ErroDuplicado('Já existe um produto ou serviço com esse nome.');
    Object.assign(x, Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)), { atualizadoEm: new Date(), atualizadoPor: por });
    return this.publico(x);
  }
  async apagarProduto(empresaId: string, id: string) {
    const l = this.ps(empresaId);
    const i = l.findIndex((x) => x.id === id);
    if (i < 0) return false;
    l.splice(i, 1);
    for (const t of this.tabs.get(empresaId) ?? []) t.itens = t.itens.filter((it) => it.produtoId !== id);
    return true;
  }
  async fotoProduto(empresaId: string, id: string) {
    return this.ps(empresaId).find((x) => x.id === id)?.foto;
  }
  async gravarFotoProduto(empresaId: string, id: string, foto: { conteudo: Buffer; tipo: string } | null) {
    const x = this.ps(empresaId).find((y) => y.id === id);
    if (!x) return false;
    const em = new Date();
    x.foto = foto ? { ...foto, em } : undefined;
    x.fotoEm = foto ? em : null;
    return true;
  }

  async tabelas(empresaId: string) {
    return (this.tabs.get(empresaId) ?? []).map((t) => structuredClone(t)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }
  async criarTabela(empresaId: string, t: NovaTabela, por: string) {
    const ids = new Set(this.ps(empresaId).map((p) => p.id));
    const nova: TabelaPreco = { ...structuredClone(t), itens: t.itens.filter((i) => ids.has(i.produtoId)), id: randomUUID(), atualizadaEm: new Date(), atualizadaPor: por };
    const l = this.tabs.get(empresaId) ?? [];
    l.push(nova);
    this.tabs.set(empresaId, l);
    return structuredClone(nova);
  }
  async alterarTabela(empresaId: string, id: string, t: NovaTabela, por: string) {
    const l = this.tabs.get(empresaId) ?? [];
    const i = l.findIndex((x) => x.id === id);
    if (i < 0) return undefined;
    const ids = new Set(this.ps(empresaId).map((p) => p.id));
    l[i] = { ...structuredClone(t), itens: t.itens.filter((x) => ids.has(x.produtoId)), id, atualizadaEm: new Date(), atualizadaPor: por };
    return structuredClone(l[i]!);
  }
  async apagarTabela(empresaId: string, id: string) {
    const l = this.tabs.get(empresaId) ?? [];
    const n = l.length;
    this.tabs.set(empresaId, l.filter((x) => x.id !== id));
    return n !== this.tabs.get(empresaId)!.length;
  }

  async documentos(empresaId: string) {
    return (this.docs.get(empresaId) ?? []).map(({ conteudo: _c, ...d }) => ({ ...d })).sort((a, b) => b.enviadoEm.getTime() - a.enviadoEm.getTime());
  }
  async criarDocumento(empresaId: string, d: NovoDocumento) {
    const novo = { ...d, id: randomUUID(), tamanho: d.conteudo.length, enviadoEm: new Date() };
    const l = this.docs.get(empresaId) ?? [];
    l.push(novo);
    this.docs.set(empresaId, l);
    const { conteudo: _c, ...pub } = novo;
    return pub;
  }
  async alterarDocumento(empresaId: string, id: string, d: Partial<Pick<Documento, 'nome' | 'categoria' | 'descricao' | 'visivel'>>) {
    const x = (this.docs.get(empresaId) ?? []).find((y) => y.id === id);
    if (!x) return undefined;
    Object.assign(x, Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)));
    const { conteudo: _c, ...pub } = x;
    return { ...pub };
  }
  async apagarDocumento(empresaId: string, id: string) {
    const l = this.docs.get(empresaId) ?? [];
    const n = l.length;
    this.docs.set(empresaId, l.filter((x) => x.id !== id));
    return n !== this.docs.get(empresaId)!.length;
  }
  async arquivoDocumento(empresaId: string, id: string) {
    const x = (this.docs.get(empresaId) ?? []).find((y) => y.id === id);
    if (!x) return undefined;
    const { conteudo, ...doc } = x;
    return { conteudo, tipo: x.mimetype, em: x.enviadoEm, doc };
  }
}

// ---------------------------------------------------------------- Postgres

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
interface LinhaProduto {
  id: string;
  nome: string;
  tipo: TipoProduto;
  categoria: string | null;
  preco: string | null;
  duracao_min: number | null;
  descricao: string | null;
  codigo: string | null;
  ativo: boolean;
  origem: string | null;
  foto_em: Date | null;
  criado_em: Date;
  atualizado_em: Date;
  atualizado_por: string | null;
}
const COLUNAS_PRODUTO = 'id, nome, tipo, categoria, preco, duracao_min, descricao, codigo, ativo, origem, foto_em, criado_em, atualizado_em, atualizado_por';
const paraProduto = (l: LinhaProduto): Produto => ({
  id: l.id,
  nome: l.nome,
  tipo: l.tipo,
  categoria: l.categoria,
  preco: num(l.preco),
  duracaoMin: l.duracao_min,
  descricao: l.descricao ?? '',
  codigo: l.codigo ?? '',
  ativo: l.ativo,
  origem: l.origem,
  fotoEm: l.foto_em,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
  atualizadoPor: l.atualizado_por,
});
interface LinhaDoc {
  id: string;
  nome: string;
  categoria: CategoriaDocumento;
  descricao: string | null;
  visivel: 'equipe' | 'gestao';
  mimetype: string;
  tamanho: number;
  enviado_por: string | null;
  enviado_em: Date;
}
const COLUNAS_DOC = 'id, nome, categoria, descricao, visivel, mimetype, tamanho, enviado_por, enviado_em';
const paraDoc = (l: LinhaDoc): Documento => ({
  id: l.id,
  nome: l.nome,
  categoria: (CATEGORIAS_DOCUMENTO as readonly string[]).includes(l.categoria) ? l.categoria : 'outro',
  descricao: l.descricao ?? '',
  visivel: l.visivel,
  mimetype: l.mimetype,
  tamanho: l.tamanho,
  enviadoPor: l.enviado_por,
  enviadoEm: l.enviado_em,
});
const duplicado = (e: unknown) => (e as { code?: string }).code === '23505';
const dataTxt = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : typeof d === 'string' ? d.slice(0, 10) : null);

export class ArmazemCadastroPostgres implements ArmazemCadastro {
  constructor(private readonly pool: pg.Pool) {}

  async lerDados(empresaId: string) {
    const { rows } = await this.pool.query<{ nome: string; dados: unknown; logo_em: Date | null; atualizada_em: Date | null; atualizada_por: string | null }>(
      'select nome, dados, logo_em, atualizada_em, atualizada_por from sintonia.empresas where id = $1',
      [empresaId],
    );
    const r = rows[0];
    return r ? { nome: r.nome, dados: lerDados(r.dados), logoEm: r.logo_em, atualizadaEm: r.atualizada_em, atualizadaPor: r.atualizada_por } : undefined;
  }
  async gravarDados(empresaId: string, dados: DadosEmpresa, por: string) {
    await this.pool.query(
      `insert into sintonia.empresas (id, nome, dados, atualizada_em, atualizada_por) values ($1, $1, $2, now(), $3)
       on conflict (id) do update set dados = excluded.dados, atualizada_em = now(), atualizada_por = excluded.atualizada_por`,
      [empresaId, JSON.stringify(dados), por],
    );
  }
  async logo(empresaId: string) {
    const { rows } = await this.pool.query<{ logo: Buffer | null; logo_tipo: string | null; logo_em: Date | null }>('select logo, logo_tipo, logo_em from sintonia.empresas where id = $1', [empresaId]);
    const r = rows[0];
    return r?.logo && r.logo_tipo ? { conteudo: r.logo, tipo: r.logo_tipo, em: r.logo_em ?? new Date(0) } : undefined;
  }
  async gravarLogo(empresaId: string, logo: { conteudo: Buffer; tipo: string } | null) {
    await this.pool.query(
      `insert into sintonia.empresas (id, nome, logo, logo_tipo, logo_em) values ($1, $1, $2, $3, $4)
       on conflict (id) do update set logo = excluded.logo, logo_tipo = excluded.logo_tipo, logo_em = excluded.logo_em`,
      [empresaId, logo?.conteudo ?? null, logo?.tipo ?? null, logo ? new Date() : null],
    );
  }
  async marcarImportacao(empresaId: string) {
    await this.pool.query('insert into sintonia.empresas (id, nome) values ($1, $1) on conflict (id) do nothing', [empresaId]);
    const r = await this.pool.query('update sintonia.empresas set produtos_importados_em = now() where id = $1 and produtos_importados_em is null', [empresaId]);
    return (r.rowCount ?? 0) > 0;
  }

  async unidades(empresaId: string) {
    const { rows } = await this.pool.query<{ id: string; nome: string; ativa: boolean; ordem: number; dados: unknown; atualizada_em: Date; atualizada_por: string | null }>(
      'select id, nome, ativa, ordem, dados, atualizada_em, atualizada_por from sintonia.unidades where empresa_id = $1 order by ordem, nome',
      [empresaId],
    );
    return rows.map((r) => ({ id: r.id, nome: r.nome, ativa: r.ativa, ordem: r.ordem, dados: lerDadosUnidade(r.dados), atualizadaEm: r.atualizada_em, atualizadaPor: r.atualizada_por }));
  }
  async salvarUnidade(empresaId: string, u: Omit<Unidade, 'atualizadaEm'>) {
    const { rows } = await this.pool.query<{ atualizada_em: Date }>(
      `insert into sintonia.unidades (empresa_id, id, nome, dados, ativa, ordem, atualizada_em, atualizada_por) values ($1, $2, $3, $4, $5, $6, now(), $7)
       on conflict (empresa_id, id) do update set nome = excluded.nome, dados = excluded.dados, ativa = excluded.ativa, ordem = excluded.ordem,
         atualizada_em = now(), atualizada_por = excluded.atualizada_por
       returning atualizada_em`,
      [empresaId, u.id, u.nome, JSON.stringify(u.dados), u.ativa, u.ordem, u.atualizadaPor],
    );
    return { ...u, atualizadaEm: rows[0]!.atualizada_em };
  }
  async apagarUnidade(empresaId: string, id: string) {
    const r = await this.pool.query('delete from sintonia.unidades where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async produtos(empresaId: string) {
    const { rows } = await this.pool.query<LinhaProduto>(`select ${COLUNAS_PRODUTO} from sintonia.produtos where empresa_id = $1`, [empresaId]);
    return ordenarProdutos(rows.map(paraProduto));
  }
  async produto(empresaId: string, id: string) {
    if (!uuidOk(id)) return undefined;
    const { rows } = await this.pool.query<LinhaProduto>(`select ${COLUNAS_PRODUTO} from sintonia.produtos where empresa_id = $1 and id = $2`, [empresaId, id]);
    return rows[0] ? paraProduto(rows[0]) : undefined;
  }
  async criarProduto(empresaId: string, p: NovoProduto, por: string) {
    try {
      const { rows } = await this.pool.query<LinhaProduto>(
        `insert into sintonia.produtos (empresa_id, nome, chave, tipo, categoria, preco, duracao_min, descricao, codigo, ativo, origem, atualizado_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning ${COLUNAS_PRODUTO}`,
        [empresaId, p.nome, normalizar(p.nome), p.tipo, p.categoria, p.preco, p.duracaoMin, p.descricao, p.codigo, p.ativo, p.origem ?? null, por],
      );
      return paraProduto(rows[0]!);
    } catch (e) {
      if (duplicado(e)) throw new ErroDuplicado('Já existe um produto ou serviço com esse nome.');
      throw e;
    }
  }
  async alterarProduto(empresaId: string, id: string, p: Partial<NovoProduto>, por: string) {
    const atual = await this.produto(empresaId, id);
    if (!atual) return undefined;
    const n = { ...atual, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Produto;
    try {
      const { rows } = await this.pool.query<LinhaProduto>(
        `update sintonia.produtos set nome = $3, chave = $4, tipo = $5, categoria = $6, preco = $7, duracao_min = $8, descricao = $9, codigo = $10, ativo = $11,
           atualizado_em = now(), atualizado_por = $12
         where empresa_id = $1 and id = $2 returning ${COLUNAS_PRODUTO}`,
        [empresaId, id, n.nome, normalizar(n.nome), n.tipo, n.categoria, n.preco, n.duracaoMin, n.descricao, n.codigo, n.ativo, por],
      );
      return rows[0] ? paraProduto(rows[0]) : undefined;
    } catch (e) {
      if (duplicado(e)) throw new ErroDuplicado('Já existe um produto ou serviço com esse nome.');
      throw e;
    }
  }
  async apagarProduto(empresaId: string, id: string) {
    if (!uuidOk(id)) return false;
    const r = await this.pool.query('delete from sintonia.produtos where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async fotoProduto(empresaId: string, id: string) {
    if (!uuidOk(id)) return undefined;
    const { rows } = await this.pool.query<{ foto: Buffer | null; foto_tipo: string | null; foto_em: Date | null }>(
      'select foto, foto_tipo, foto_em from sintonia.produtos where empresa_id = $1 and id = $2',
      [empresaId, id],
    );
    const r = rows[0];
    return r?.foto && r.foto_tipo ? { conteudo: r.foto, tipo: r.foto_tipo, em: r.foto_em ?? new Date(0) } : undefined;
  }
  async gravarFotoProduto(empresaId: string, id: string, foto: { conteudo: Buffer; tipo: string } | null) {
    if (!uuidOk(id)) return false;
    const r = await this.pool.query('update sintonia.produtos set foto = $3, foto_tipo = $4, foto_em = $5 where empresa_id = $1 and id = $2', [
      empresaId,
      id,
      foto?.conteudo ?? null,
      foto?.tipo ?? null,
      foto ? new Date() : null,
    ]);
    return (r.rowCount ?? 0) > 0;
  }

  async tabelas(empresaId: string) {
    const { rows } = await this.pool.query<{ id: string; nome: string; descricao: string | null; unidade: string | null; ativa: boolean; inicio: unknown; fim: unknown; atualizada_em: Date; atualizada_por: string | null }>(
      'select id, nome, descricao, unidade, ativa, inicio, fim, atualizada_em, atualizada_por from sintonia.tabelas_preco where empresa_id = $1 order by nome',
      [empresaId],
    );
    if (!rows.length) return [];
    const itens = await this.pool.query<{ tabela_id: string; produto_id: string; preco: string }>(
      'select tabela_id, produto_id, preco from sintonia.tabela_preco_itens where tabela_id = any($1::uuid[])',
      [rows.map((r) => r.id)],
    );
    return rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      descricao: r.descricao ?? '',
      unidade: r.unidade,
      ativa: r.ativa,
      inicio: dataTxt(r.inicio),
      fim: dataTxt(r.fim),
      itens: itens.rows.filter((i) => i.tabela_id === r.id).map((i) => ({ produtoId: i.produto_id, preco: Number(i.preco) })),
      atualizadaEm: r.atualizada_em,
      atualizadaPor: r.atualizada_por,
    }));
  }
  private async gravarItens(c: pg.PoolClient, empresaId: string, tabelaId: string, itens: NovaTabela['itens']) {
    await c.query('delete from sintonia.tabela_preco_itens where tabela_id = $1', [tabelaId]);
    if (!itens.length) return;
    // Só produtos desta empresa entram (o id de outra empresa é ignorado).
    await c.query(
      `insert into sintonia.tabela_preco_itens (tabela_id, produto_id, preco)
       select $1, p.id, i.preco from unnest($3::uuid[], $4::numeric[]) as i(produto_id, preco)
       join sintonia.produtos p on p.id = i.produto_id and p.empresa_id = $2
       on conflict do nothing`,
      [tabelaId, empresaId, itens.map((i) => i.produtoId), itens.map((i) => i.preco)],
    );
  }
  private async naTransacao<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async criarTabela(empresaId: string, t: NovaTabela, por: string) {
    const id = await this.naTransacao(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'insert into sintonia.tabelas_preco (empresa_id, nome, descricao, unidade, ativa, inicio, fim, atualizada_por) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
        [empresaId, t.nome, t.descricao, t.unidade, t.ativa, t.inicio, t.fim, por],
      );
      await this.gravarItens(c, empresaId, rows[0]!.id, t.itens.filter((i) => uuidOk(i.produtoId)));
      return rows[0]!.id;
    });
    return (await this.tabelas(empresaId)).find((x) => x.id === id)!;
  }
  async alterarTabela(empresaId: string, id: string, t: NovaTabela, por: string) {
    if (!uuidOk(id)) return undefined;
    const ok = await this.naTransacao(async (c) => {
      const r = await c.query(
        'update sintonia.tabelas_preco set nome = $3, descricao = $4, unidade = $5, ativa = $6, inicio = $7, fim = $8, atualizada_em = now(), atualizada_por = $9 where empresa_id = $1 and id = $2',
        [empresaId, id, t.nome, t.descricao, t.unidade, t.ativa, t.inicio, t.fim, por],
      );
      if (!r.rowCount) return false;
      await this.gravarItens(c, empresaId, id, t.itens.filter((i) => uuidOk(i.produtoId)));
      return true;
    });
    return ok ? (await this.tabelas(empresaId)).find((x) => x.id === id) : undefined;
  }
  async apagarTabela(empresaId: string, id: string) {
    if (!uuidOk(id)) return false;
    const r = await this.pool.query('delete from sintonia.tabelas_preco where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async documentos(empresaId: string) {
    const { rows } = await this.pool.query<LinhaDoc>(`select ${COLUNAS_DOC} from sintonia.documentos_empresa where empresa_id = $1 order by enviado_em desc`, [empresaId]);
    return rows.map(paraDoc);
  }
  async criarDocumento(empresaId: string, d: NovoDocumento) {
    const { rows } = await this.pool.query<LinhaDoc>(
      `insert into sintonia.documentos_empresa (empresa_id, nome, categoria, descricao, visivel, mimetype, tamanho, conteudo, enviado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLUNAS_DOC}`,
      [empresaId, d.nome, d.categoria, d.descricao, d.visivel, d.mimetype, d.conteudo.length, d.conteudo, d.enviadoPor],
    );
    return paraDoc(rows[0]!);
  }
  async alterarDocumento(empresaId: string, id: string, d: Partial<Pick<Documento, 'nome' | 'categoria' | 'descricao' | 'visivel'>>) {
    if (!uuidOk(id)) return undefined;
    const { rows } = await this.pool.query<LinhaDoc>(
      `update sintonia.documentos_empresa set nome = coalesce($3, nome), categoria = coalesce($4, categoria), descricao = coalesce($5, descricao), visivel = coalesce($6, visivel)
       where empresa_id = $1 and id = $2 returning ${COLUNAS_DOC}`,
      [empresaId, id, d.nome ?? null, d.categoria ?? null, d.descricao ?? null, d.visivel ?? null],
    );
    return rows[0] ? paraDoc(rows[0]) : undefined;
  }
  async apagarDocumento(empresaId: string, id: string) {
    if (!uuidOk(id)) return false;
    const r = await this.pool.query('delete from sintonia.documentos_empresa where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async arquivoDocumento(empresaId: string, id: string) {
    if (!uuidOk(id)) return undefined;
    const { rows } = await this.pool.query<LinhaDoc & { conteudo: Buffer }>(`select ${COLUNAS_DOC}, conteudo from sintonia.documentos_empresa where empresa_id = $1 and id = $2`, [
      empresaId,
      id,
    ]);
    const r = rows[0];
    if (!r) return undefined;
    const doc = paraDoc(r);
    return { conteudo: r.conteudo, tipo: doc.mimetype, em: doc.enviadoEm, doc };
  }
}

/** Horário no formato antigo (src/unidades.ts: { 1: { abre, fecha } }) → o do cadastro (7 dias). */
export function horarioDeFaixas(h: Partial<Record<number, { abre: string; fecha: string }>>): Horario {
  return [0, 1, 2, 3, 4, 5, 6].map((dia) => {
    const f = h[dia];
    return f ? { dia, aberto: true, abre: f.abre, fecha: f.fecha } : { dia, aberto: false, abre: '09:00', fecha: '18:00' };
  });
}
