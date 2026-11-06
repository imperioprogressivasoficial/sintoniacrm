import { readdirSync, readFileSync } from 'node:fs';
import type pg from 'pg';

/**
 * Aplica, em ordem, os arquivos de db/migrations que ainda não rodaram.
 * Cada arquivo roda numa transação; dois processos subindo juntos não aplicam em dobro
 * (trava de migração no próprio Postgres).
 */
export async function migrar(
  pool: pg.Pool,
  pasta = new URL('../../db/migrations/', import.meta.url),
): Promise<string[]> {
  const arquivos = readdirSync(pasta)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const cliente = await pool.connect();
  const aplicadas: string[] = [];
  try {
    await cliente.query('select pg_advisory_lock(727001)');
    await cliente.query('create schema if not exists sintonia');
    await cliente.query(
      'create table if not exists sintonia.migracoes (versao text primary key, aplicada_em timestamptz not null default now())',
    );
    const { rows } = await cliente.query<{ versao: string }>('select versao from sintonia.migracoes');
    const feitas = new Set(rows.map((r) => r.versao));
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = readFileSync(new URL(arquivo, pasta), 'utf8');
      await cliente.query('begin');
      try {
        await cliente.query(sql);
        await cliente.query('insert into sintonia.migracoes (versao) values ($1)', [arquivo]);
        await cliente.query('commit');
        aplicadas.push(arquivo);
      } catch (e) {
        await cliente.query('rollback');
        throw new Error(`Falha na migração ${arquivo}: ${(e as Error).message}`);
      }
    }
    return aplicadas;
  } finally {
    await cliente.query('select pg_advisory_unlock(727001)').catch(() => {});
    cliente.release();
  }
}
