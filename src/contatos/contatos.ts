import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';

/**
 * Ficha do contato: o que a equipe sabe da cliente além da conversa.
 * Chave: empresa + telefone (o número do WhatsApp). A foto vem do WhatsApp (src/app/fotos.ts).
 */

export const TIPOS_CAMPO = ['texto', 'numero', 'data', 'lista', 'sim_nao'] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];

export interface CampoContato {
  id: string;
  nome: string;
  tipo: TipoCampo;
  opcoes: string[];
  ordem: number;
}

export interface DadosEmpresa {
  razaoSocial?: string;
  nomeFantasia?: string;
  cnpj?: string;
  cargo?: string;
  site?: string;
}

export interface Contato {
  telefone: string;
  nome: string | null;
  email: string | null;
  nascimento: string | null;
  observacoes: string | null;
  pessoa: 'fisica' | 'juridica';
  empresa: DadosEmpresa;
  campos: Record<string, string | number | boolean | null>;
  atualizadoEm: Date | null;
  atualizadoPor: string | null;
}

export const contatoVazio = (telefone: string, nome?: string | null): Contato => ({
  telefone,
  nome: nome ?? null,
  email: null,
  nascimento: null,
  observacoes: null,
  pessoa: 'fisica',
  empresa: {},
  campos: {},
  atualizadoEm: null,
  atualizadoPor: null,
});

export interface ArmazemContatos {
  obter(empresaId: string, telefone: string): Promise<Contato | undefined>;
  salvar(empresaId: string, c: Contato, quem: string): Promise<Contato>;
  campos(empresaId: string): Promise<CampoContato[]>;
  criarCampo(empresaId: string, c: Omit<CampoContato, 'id' | 'ordem'>): Promise<CampoContato>;
  atualizarCampo(empresaId: string, id: string, c: Partial<Omit<CampoContato, 'id'>>): Promise<CampoContato | undefined>;
  apagarCampo(empresaId: string, id: string): Promise<boolean>;
}

export class ErroCampoRepetido extends Error {
  constructor() {
    super('Já existe um campo com esse nome.');
  }
}

export class ContatosMemoria implements ArmazemContatos {
  private readonly contatos = new Map<string, Contato>();
  private readonly lista = new Map<string, CampoContato[]>();
  async obter(empresaId: string, telefone: string) {
    const c = this.contatos.get(`${empresaId}|${telefone}`);
    return c ? structuredClone(c) : undefined;
  }
  async salvar(empresaId: string, c: Contato, quem: string) {
    const salvo = { ...structuredClone(c), atualizadoEm: new Date(), atualizadoPor: quem };
    this.contatos.set(`${empresaId}|${c.telefone}`, salvo);
    return structuredClone(salvo);
  }
  async campos(empresaId: string) {
    return [...(this.lista.get(empresaId) ?? [])].sort((a, b) => a.ordem - b.ordem);
  }
  async criarCampo(empresaId: string, c: Omit<CampoContato, 'id' | 'ordem'>) {
    const l = this.lista.get(empresaId) ?? [];
    if (l.some((x) => x.nome.toLowerCase() === c.nome.toLowerCase())) throw new ErroCampoRepetido();
    const novo = { ...c, id: randomUUID(), ordem: l.length };
    l.push(novo);
    this.lista.set(empresaId, l);
    return { ...novo };
  }
  async atualizarCampo(empresaId: string, id: string, c: Partial<Omit<CampoContato, 'id'>>) {
    const l = this.lista.get(empresaId) ?? [];
    const x = l.find((y) => y.id === id);
    if (!x) return undefined;
    if (c.nome && l.some((y) => y.id !== id && y.nome.toLowerCase() === c.nome!.toLowerCase())) throw new ErroCampoRepetido();
    Object.assign(x, Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)));
    return { ...x };
  }
  async apagarCampo(empresaId: string, id: string) {
    const l = this.lista.get(empresaId) ?? [];
    const i = l.findIndex((y) => y.id === id);
    if (i < 0) return false;
    l.splice(i, 1);
    return true;
  }
  /** Só na memória (leads: exportar, importar, duplicatas). No Postgres é SQL (leads/armazem.ts). */
  async listar(empresaId: string) {
    return [...this.contatos.entries()].filter(([k]) => k.startsWith(`${empresaId}|`)).map(([, c]) => structuredClone(c));
  }
  async apagar(empresaId: string, telefone: string) {
    this.contatos.delete(`${empresaId}|${telefone}`);
  }
}

type LinhaContato = {
  telefone: string;
  nome: string | null;
  email: string | null;
  nascimento: string | null;
  observacoes: string | null;
  pessoa: 'fisica' | 'juridica';
  empresa: DadosEmpresa;
  campos: Contato['campos'];
  atualizado_em: Date;
  atualizado_por: string | null;
};
const paraContato = (r: LinhaContato): Contato => ({
  telefone: r.telefone,
  nome: r.nome,
  email: r.email,
  nascimento: r.nascimento,
  observacoes: r.observacoes,
  pessoa: r.pessoa,
  empresa: r.empresa ?? {},
  campos: r.campos ?? {},
  atualizadoEm: r.atualizado_em,
  atualizadoPor: r.atualizado_por,
});

export class ContatosPostgres implements ArmazemContatos {
  constructor(private readonly pool: pg.Pool) {}
  async obter(empresaId: string, telefone: string) {
    const { rows } = await this.pool.query<LinhaContato>(
      `select telefone, nome, email, to_char(nascimento, 'YYYY-MM-DD') as nascimento, observacoes, pessoa, empresa, campos, atualizado_em, atualizado_por
         from sintonia.contatos where empresa_id = $1 and telefone = $2`,
      [empresaId, telefone],
    );
    return rows[0] ? paraContato(rows[0]) : undefined;
  }
  async salvar(empresaId: string, c: Contato, quem: string) {
    await this.pool.query(
      `insert into sintonia.contatos (empresa_id, telefone, nome, email, nascimento, observacoes, pessoa, empresa, campos, atualizado_em, atualizado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
       on conflict (empresa_id, telefone) do update set nome = excluded.nome, email = excluded.email, nascimento = excluded.nascimento,
         observacoes = excluded.observacoes, pessoa = excluded.pessoa, empresa = excluded.empresa, campos = excluded.campos,
         atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [empresaId, c.telefone, c.nome, c.email, c.nascimento, c.observacoes, c.pessoa, JSON.stringify(c.empresa), JSON.stringify(c.campos), quem],
    );
    return (await this.obter(empresaId, c.telefone))!;
  }
  async campos(empresaId: string) {
    const { rows } = await this.pool.query<CampoContato>(
      'select id, nome, tipo, opcoes, ordem from sintonia.campos_contato where empresa_id = $1 order by ordem, criado_em',
      [empresaId],
    );
    return rows;
  }
  async criarCampo(empresaId: string, c: Omit<CampoContato, 'id' | 'ordem'>) {
    try {
      const { rows } = await this.pool.query<CampoContato>(
        `insert into sintonia.campos_contato (id, empresa_id, nome, tipo, opcoes, ordem)
         values ($1, $2, $3, $4, $5, (select coalesce(max(ordem) + 1, 0) from sintonia.campos_contato where empresa_id = $2))
         returning id, nome, tipo, opcoes, ordem`,
        [randomUUID(), empresaId, c.nome, c.tipo, c.opcoes],
      );
      return rows[0]!;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ErroCampoRepetido();
      throw e;
    }
  }
  async atualizarCampo(empresaId: string, id: string, c: Partial<Omit<CampoContato, 'id'>>) {
    try {
      const { rows } = await this.pool.query<CampoContato>(
        `update sintonia.campos_contato set nome = coalesce($3, nome), tipo = coalesce($4, tipo), opcoes = coalesce($5, opcoes), ordem = coalesce($6, ordem)
          where empresa_id = $1 and id = $2 returning id, nome, tipo, opcoes, ordem`,
        [empresaId, id, c.nome ?? null, c.tipo ?? null, c.opcoes ?? null, c.ordem ?? null],
      );
      return rows[0];
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ErroCampoRepetido();
      throw e;
    }
  }
  async apagarCampo(empresaId: string, id: string) {
    const r = await this.pool.query('delete from sintonia.campos_contato where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }
}

// ---------- validação ----------

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

export const EdicaoContato = z.object({
  nome: textoOpcional(120),
  email: z
    .union([z.literal(''), z.string().trim().toLowerCase().email('E-mail inválido').max(200)])
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
  nascimento: z
    .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')])
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional(),
  observacoes: textoOpcional(4000),
  pessoa: z.enum(['fisica', 'juridica']).optional(),
  empresa: z
    .object({
      razaoSocial: z.string().trim().max(200).optional(),
      nomeFantasia: z.string().trim().max(200).optional(),
      cnpj: z
        .string()
        .trim()
        .transform((s) => s.replace(/\D/g, ''))
        .refine((s) => s === '' || s.length === 14, 'CNPJ precisa ter 14 números')
        .optional(),
      cargo: z.string().trim().max(120).optional(),
      site: z.string().trim().max(200).optional(),
    })
    .optional(),
  campos: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])).optional(),
});
export type EdicaoContato = z.infer<typeof EdicaoContato>;

/** Confere os valores dos campos personalizados contra as definições (tipo e opções). Campos que não existem são descartados. */
export function validarCampos(defs: CampoContato[], valores: Record<string, unknown>): Contato['campos'] {
  const saida: Contato['campos'] = {};
  for (const d of defs) {
    if (!(d.id in valores)) continue;
    const v = valores[d.id];
    if (v === null || v === '') {
      saida[d.id] = null;
      continue;
    }
    if (d.tipo === 'numero') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
      if (!Number.isFinite(n)) throw new Error(`"${d.nome}" precisa ser um número`);
      saida[d.id] = n;
    } else if (d.tipo === 'sim_nao') {
      if (typeof v !== 'boolean') throw new Error(`"${d.nome}" precisa ser sim ou não`);
      saida[d.id] = v;
    } else if (d.tipo === 'data') {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`"${d.nome}" precisa ser uma data`);
      saida[d.id] = v;
    } else if (d.tipo === 'lista') {
      if (typeof v !== 'string' || !d.opcoes.includes(v)) throw new Error(`"${d.nome}": escolha uma das opções`);
      saida[d.id] = v;
    } else {
      saida[d.id] = String(v).slice(0, 2000);
    }
  }
  return saida;
}

/** Aplica a edição sobre a ficha atual (só o que veio). */
export function aplicarEdicao(atual: Contato, e: EdicaoContato, defs: CampoContato[]): Contato {
  const c = structuredClone(atual);
  if (e.nome !== undefined) c.nome = e.nome;
  if (e.email !== undefined) c.email = e.email;
  if (e.nascimento !== undefined) c.nascimento = e.nascimento;
  if (e.observacoes !== undefined) c.observacoes = e.observacoes;
  if (e.pessoa) c.pessoa = e.pessoa;
  if (e.empresa) c.empresa = Object.fromEntries(Object.entries({ ...c.empresa, ...e.empresa }).filter(([, v]) => v !== '' && v !== undefined));
  if (e.campos) c.campos = { ...c.campos, ...validarCampos(defs, e.campos) };
  return c;
}
