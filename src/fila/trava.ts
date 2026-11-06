import type pg from 'pg';

/**
 * Trava por conversa: uma conversa é pensada por um processo de cada vez, mesmo com
 * vários servidores (ex.: o relógio reavaliando a conversa enquanto chega mensagem nova).
 */
export interface Trava {
  comTrava<T>(chave: string, fn: () => Promise<T>): Promise<T>;
}

/** Um processo só: fila de promessas por chave. */
export class TravaMemoria implements Trava {
  private filas = new Map<string, Promise<unknown>>();

  comTrava<T>(chave: string, fn: () => Promise<T>): Promise<T> {
    const anterior = this.filas.get(chave) ?? Promise.resolve();
    const atual = anterior.catch(() => undefined).then(fn);
    const fim = atual.catch(() => undefined);
    this.filas.set(chave, fim);
    void fim.then(() => {
      if (this.filas.get(chave) === fim) this.filas.delete(chave);
    });
    return atual;
  }
}

/** Vários processos: trava consultiva do Postgres, liberada mesmo se o processo cair. */
export class TravaPostgres implements Trava {
  private readonly local = new TravaMemoria();

  constructor(private readonly pool: pg.Pool) {}

  comTrava<T>(chave: string, fn: () => Promise<T>): Promise<T> {
    // Dentro do mesmo processo, fila local primeiro: não ocupa conexões esperando a si mesmo.
    return this.local.comTrava(chave, async () => {
      const cliente = await this.pool.connect();
      try {
        await cliente.query('select pg_advisory_lock(hashtextextended($1, 0))', [`sintonia:${chave}`]);
        try {
          return await fn();
        } finally {
          await cliente.query('select pg_advisory_unlock(hashtextextended($1, 0))', [`sintonia:${chave}`]);
        }
      } finally {
        cliente.release();
      }
    });
  }
}
