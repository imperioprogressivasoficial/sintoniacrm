import { createHash } from 'node:crypto';
import type pg from 'pg';

/**
 * banco-seguranca: registro de ações sensíveis (tabela sintonia.auditoria, migração 630).
 * Entrar e bloqueio por senha errada, trocar senha, mexer em acessos/permissões, chaves e conexões,
 * exportar e apagar dados de cliente. Só acrescenta (o banco recusa alterar ou apagar uma linha).
 * Nunca guarda senha, chave ou telefone de cliente em claro: telefone vira `resumoCliente` (não volta ao número).
 */
export interface RegistroAuditoria {
  empresaId: string;
  acao: string;
  autorId?: string | null;
  autorNome?: string | null;
  papel?: string | null;
  alvo?: string | null;
  detalhe?: Record<string, unknown>;
  ip?: string | null;
  em?: Date;
}
export type LinhaAuditoria = Required<Omit<RegistroAuditoria, 'detalhe'>> & { id: number; detalhe: Record<string, unknown> };

export interface Auditoria {
  registrar(r: RegistroAuditoria): Promise<void>;
  listar(empresaId: string, o?: { limite?: number; acao?: string }): Promise<LinhaAuditoria[]>;
}

/** "cliente:9f2c…" — identifica o mesmo cliente nos registros sem guardar o telefone. */
export const resumoCliente = (chave: string) => `cliente:${createHash('sha256').update(`sintonia-cliente:${chave}`).digest('hex').slice(0, 16)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuditoriaMemoria implements Auditoria {
  readonly linhas: LinhaAuditoria[] = [];
  async registrar(r: RegistroAuditoria) {
    this.linhas.push({
      id: this.linhas.length + 1,
      empresaId: r.empresaId,
      acao: r.acao,
      autorId: r.autorId ?? null,
      autorNome: r.autorNome ?? null,
      papel: r.papel ?? null,
      alvo: r.alvo ?? null,
      detalhe: r.detalhe ?? {},
      ip: r.ip ?? null,
      em: r.em ?? new Date(),
    } as LinhaAuditoria);
  }
  async listar(empresaId: string, o: { limite?: number; acao?: string } = {}) {
    return this.linhas
      .filter((l) => l.empresaId === empresaId && (!o.acao || l.acao === o.acao))
      .slice(-(o.limite ?? 200))
      .reverse();
  }
}

export class AuditoriaPostgres implements Auditoria {
  constructor(private readonly pool: pg.Pool) {}
  async registrar(r: RegistroAuditoria) {
    await this.pool.query(
      `insert into sintonia.auditoria (empresa_id, em, autor_id, autor_nome, papel, acao, alvo, detalhe, ip)
       values ($1, coalesce($2, now()), $3, $4, $5, $6, $7, $8, $9)`,
      [r.empresaId, r.em ?? null, r.autorId && UUID.test(r.autorId) ? r.autorId : null, r.autorNome ?? null, r.papel ?? null, r.acao, r.alvo ?? null, JSON.stringify(r.detalhe ?? {}), r.ip ?? null],
    );
  }
  async listar(empresaId: string, o: { limite?: number; acao?: string } = {}) {
    const { rows } = await this.pool.query<{
      id: string; empresa_id: string; em: Date; autor_id: string | null; autor_nome: string | null; papel: string | null; acao: string; alvo: string | null; detalhe: Record<string, unknown>; ip: string | null;
    }>(
      `select id, empresa_id, em, autor_id, autor_nome, papel, acao, alvo, detalhe, ip from sintonia.auditoria
        where empresa_id = $1 and ($2::text is null or acao = $2) order by em desc, id desc limit $3`,
      [empresaId, o.acao ?? null, Math.min(Math.max(o.limite ?? 200, 1), 1000)],
    );
    return rows.map((x) => ({ id: Number(x.id), empresaId: x.empresa_id, em: x.em, autorId: x.autor_id, autorNome: x.autor_nome, papel: x.papel, acao: x.acao, alvo: x.alvo, detalhe: x.detalhe ?? {}, ip: x.ip }));
  }
}
