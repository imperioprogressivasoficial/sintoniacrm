import { readdirSync, readFileSync } from 'node:fs';
import type pg from 'pg';

/**
 * Aplica, em ordem, os arquivos de db/migrations que ainda não rodaram.
 * Cada arquivo roda numa transação; dois processos subindo juntos não aplicam em dobro
 * (trava de migração no próprio Postgres).
 *
 * banco-seguranca: migração segura com o banco de produção cheio.
 * - Espera curta por trava (lock_timeout de 10 s): um ALTER TABLE nunca fica parado atrás de uma consulta longa
 *   segurando todo mundo que chega depois. Se não conseguir a trava, tenta de novo (até 6 vezes, espera crescente).
 * - Arquivo que começa com a linha `-- sintonia: sem-transacao` roda comando por comando, fora de transação.
 *   É o único jeito de usar `create index concurrently` (cria o índice sem travar a gravação na tabela).
 *   Cada comando desse arquivo precisa poder rodar de novo (if not exists): se o app cair no meio, o arquivo
 *   inteiro roda outra vez. Um índice que ficou pela metade (inválido) é apagado e criado de novo sozinho.
 */
export const MARCA_SEM_TRANSACAO = /^\s*--\s*sintonia:\s*sem-transacao\b/i;
const TENTATIVAS_TRAVA = 6;

export async function migrar(
  pool: pg.Pool,
  pasta = new URL('../../db/migrations/', import.meta.url),
  o: { dormir?: (ms: number) => Promise<void>; log?: (msg: string) => void } = {},
): Promise<string[]> {
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
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
      for (let tentativa = 1; ; tentativa++) {
        try {
          if (MARCA_SEM_TRANSACAO.test(sql)) await aplicarSemTransacao(cliente, sql);
          else await aplicarEmTransacao(cliente, sql);
          await cliente.query('insert into sintonia.migracoes (versao) values ($1) on conflict do nothing', [arquivo]);
          aplicadas.push(arquivo);
          break;
        } catch (e) {
          // 55P03 = não conseguiu a trava a tempo: alguém estava usando a tabela. Espera e tenta de novo.
          if ((e as { code?: string }).code === '55P03' && tentativa < TENTATIVAS_TRAVA) {
            o.log?.(`Migração ${arquivo}: tabela ocupada, nova tentativa (${tentativa}/${TENTATIVAS_TRAVA - 1})`);
            await dormir(Math.min(2_000 * tentativa, 10_000));
            continue;
          }
          throw new Error(`Falha na migração ${arquivo}: ${(e as Error).message}`);
        }
      }
    }
    return aplicadas;
  } finally {
    await cliente.query('select pg_advisory_unlock(727001)').catch(() => {});
    cliente.release();
  }
}

async function aplicarEmTransacao(cliente: pg.PoolClient, sql: string): Promise<void> {
  await cliente.query('begin');
  try {
    await cliente.query("set local lock_timeout = '10s'");
    await cliente.query(sql);
    await cliente.query('commit');
  } catch (e) {
    await cliente.query('rollback').catch(() => {});
    throw e;
  }
}

async function aplicarSemTransacao(cliente: pg.PoolClient, sql: string): Promise<void> {
  try {
    for (const comando of separarComandos(sql)) {
      const indice = /^create\s+(?:unique\s+)?index\s+concurrently\s+if\s+not\s+exists\s+("?)([\w]+)\1\s+on\s+(?:("?)([\w]+)\3\.)?/i.exec(comando);
      if (indice) {
        // create index concurrently espera as transações em andamento terminarem: aqui sem prazo de trava.
        await cliente.query("set lock_timeout = '0'");
        const esquema = indice[4] ?? 'sintonia';
        const { rows } = await cliente.query<{ valido: boolean }>(
          `select i.indisvalid as valido from pg_index i join pg_class c on c.oid = i.indexrelid
             join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = $2`,
          [esquema, indice[2]],
        );
        // Índice que ficou pela metade numa tentativa anterior: o "if not exists" o deixaria assim para sempre.
        if (rows[0] && !rows[0].valido) await cliente.query(`drop index concurrently if exists "${esquema}"."${indice[2]}"`);
      } else await cliente.query("set lock_timeout = '10s'");
      await cliente.query(comando);
    }
  } finally {
    await cliente.query('reset lock_timeout').catch(() => {});
  }
}

/**
 * Divide o arquivo em comandos pelo ";" — sem quebrar dentro de texto ('...'), nome entre aspas ("..."),
 * blocos $$...$$ (funções, DO) e comentários.
 */
export function separarComandos(sql: string): string[] {
  const comandos: string[] = [];
  let atual = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const resto = sql.slice(i);
    if (resto.startsWith('--')) {
      const fim = sql.indexOf('\n', i);
      i = fim < 0 ? sql.length : fim + 1;
      atual += '\n';
      continue;
    }
    if (resto.startsWith('/*')) {
      const fim = sql.indexOf('*/', i + 2);
      i = fim < 0 ? sql.length : fim + 2;
      atual += ' ';
      continue;
    }
    const dolar = /^\$([A-Za-z_]\w*)?\$/.exec(resto);
    if (dolar) {
      const marca = dolar[0];
      const fim = sql.indexOf(marca, i + marca.length);
      const ate = fim < 0 ? sql.length : fim + marca.length;
      atual += sql.slice(i, ate);
      i = ate;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c && sql[j + 1] === c) j += 2;
        else if (sql[j] === c) break;
        else j++;
      }
      atual += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ';') {
      if (atual.trim()) comandos.push(atual.trim());
      atual = '';
      i++;
      continue;
    }
    atual += c;
    i++;
  }
  if (atual.trim()) comandos.push(atual.trim());
  return comandos;
}
