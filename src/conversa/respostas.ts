import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';

/**
 * Respostas rápidas: no campo de mensagem, "/preco" vira o texto pronto.
 * Da empresa (usuarioId null): a gestão cria e edita, todo mundo usa.
 * Pessoais: cada pessoa cria as suas; só ela vê.
 * O texto aceita {nome}, {unidade} e {atendente}: a tela troca na hora de inserir.
 */
export interface RespostaRapida {
  id: string;
  atalho: string;
  texto: string;
  /** null = da empresa. */
  usuarioId: string | null;
  criadaPor: string | null;
  atualizadaEm: Date;
}

export const VARIAVEIS_RESPOSTA = ['nome', 'unidade', 'atendente'] as const;

/** "/Preço da progressiva" → "preco-da-progressiva" (sem barra, acento, espaço; minúsculas). */
export function normalizarAtalho(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\/+/, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export const DadosResposta = z.object({
  atalho: z
    .string()
    .max(40)
    .transform(normalizarAtalho)
    .pipe(z.string().min(1, 'Escolha um atalho curto, como /preco.').max(30, 'Atalho longo demais (até 30 letras).')),
  texto: z.string().trim().min(1, 'Escreva o texto da resposta.').max(3000),
});

export class ErroAtalhoRepetido extends Error {
  constructor(atalho: string) {
    super(`Já existe a resposta /${atalho}.`);
  }
}

export interface ArmazemRespostas {
  /** As da empresa e as pessoais desta pessoa. */
  listar(empresaId: string, usuarioId: string | null): Promise<RespostaRapida[]>;
  obter(empresaId: string, id: string): Promise<RespostaRapida | undefined>;
  criar(empresaId: string, r: { atalho: string; texto: string; usuarioId: string | null; criadaPor: string }): Promise<RespostaRapida>;
  alterar(empresaId: string, id: string, r: { atalho?: string; texto?: string }, quem: string): Promise<RespostaRapida | undefined>;
  apagar(empresaId: string, id: string): Promise<boolean>;
}

const ordenar = (lista: RespostaRapida[]) =>
  lista.sort((a, b) => Number(a.usuarioId === null) - Number(b.usuarioId === null) || a.atalho.localeCompare(b.atalho));

export class RespostasMemoria implements ArmazemRespostas {
  private readonly dados = new Map<string, RespostaRapida & { empresaId: string }>();

  async listar(empresaId: string, usuarioId: string | null) {
    return ordenar(
      [...this.dados.values()]
        .filter((r) => r.empresaId === empresaId && (r.usuarioId === null || r.usuarioId === usuarioId))
        .map(({ empresaId: _e, ...r }) => ({ ...r })),
    );
  }
  async obter(empresaId: string, id: string) {
    const r = this.dados.get(id);
    if (!r || r.empresaId !== empresaId) return undefined;
    const { empresaId: _e, ...resto } = r;
    return { ...resto };
  }
  private conferir(empresaId: string, atalho: string, usuarioId: string | null, menos?: string) {
    for (const r of this.dados.values()) {
      if (r.id !== menos && r.empresaId === empresaId && r.usuarioId === usuarioId && r.atalho === atalho) throw new ErroAtalhoRepetido(atalho);
    }
  }
  async criar(empresaId: string, r: { atalho: string; texto: string; usuarioId: string | null; criadaPor: string }) {
    this.conferir(empresaId, r.atalho, r.usuarioId);
    const nova = { id: randomUUID(), empresaId, atalho: r.atalho, texto: r.texto, usuarioId: r.usuarioId, criadaPor: r.criadaPor, atualizadaEm: new Date() };
    this.dados.set(nova.id, nova);
    return (await this.obter(empresaId, nova.id))!;
  }
  async alterar(empresaId: string, id: string, r: { atalho?: string; texto?: string }, quem: string) {
    const atual = this.dados.get(id);
    if (!atual || atual.empresaId !== empresaId) return undefined;
    if (r.atalho !== undefined) this.conferir(empresaId, r.atalho, atual.usuarioId, id);
    Object.assign(atual, { ...(r.atalho !== undefined ? { atalho: r.atalho } : {}), ...(r.texto !== undefined ? { texto: r.texto } : {}), criadaPor: quem, atualizadaEm: new Date() });
    return this.obter(empresaId, id);
  }
  async apagar(empresaId: string, id: string) {
    const r = this.dados.get(id);
    if (!r || r.empresaId !== empresaId) return false;
    return this.dados.delete(id);
  }
}

interface Linha {
  id: string;
  atalho: string;
  texto: string;
  usuario_id: string | null;
  criada_por: string | null;
  atualizada_em: Date;
}
const daLinha = (l: Linha): RespostaRapida => ({ id: l.id, atalho: l.atalho, texto: l.texto, usuarioId: l.usuario_id, criadaPor: l.criada_por, atualizadaEm: l.atualizada_em });
const repetido = (e: unknown) => (e as { code?: string }).code === '23505';
const ehUuid = (id: string) => z.string().uuid().safeParse(id).success;

export class RespostasPostgres implements ArmazemRespostas {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string, usuarioId: string | null) {
    const { rows } = await this.pool.query<Linha>(
      `select * from sintonia.respostas_rapidas where empresa_id = $1 and (usuario_id is null or usuario_id = $2)`,
      [empresaId, usuarioId && ehUuid(usuarioId) ? usuarioId : null],
    );
    return ordenar(rows.map(daLinha));
  }
  async obter(empresaId: string, id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<Linha>('select * from sintonia.respostas_rapidas where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async criar(empresaId: string, r: { atalho: string; texto: string; usuarioId: string | null; criadaPor: string }) {
    try {
      const { rows } = await this.pool.query<Linha>(
        `insert into sintonia.respostas_rapidas (id, empresa_id, usuario_id, atalho, texto, criada_por) values ($1, $2, $3, $4, $5, $6) returning *`,
        [randomUUID(), empresaId, r.usuarioId, r.atalho, r.texto, r.criadaPor],
      );
      return daLinha(rows[0]!);
    } catch (e) {
      if (repetido(e)) throw new ErroAtalhoRepetido(r.atalho);
      throw e;
    }
  }
  async alterar(empresaId: string, id: string, r: { atalho?: string; texto?: string }, quem: string) {
    if (!ehUuid(id)) return undefined;
    try {
      const { rows } = await this.pool.query<Linha>(
        `update sintonia.respostas_rapidas set atalho = coalesce($3, atalho), texto = coalesce($4, texto), criada_por = $5, atualizada_em = now()
         where empresa_id = $1 and id = $2 returning *`,
        [empresaId, id, r.atalho ?? null, r.texto ?? null, quem],
      );
      return rows[0] ? daLinha(rows[0]) : undefined;
    } catch (e) {
      if (repetido(e) && r.atalho) throw new ErroAtalhoRepetido(r.atalho);
      throw e;
    }
  }
  async apagar(empresaId: string, id: string) {
    if (!ehUuid(id)) return false;
    const r = await this.pool.query('delete from sintonia.respostas_rapidas where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }
}
