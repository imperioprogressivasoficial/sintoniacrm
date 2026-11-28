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

  /**
   * Use um pool SÓ para as travas (veja src/index.ts): quem segura a trava precisa de outras conexões para
   * trabalhar; se travas e trabalho dividirem o mesmo pool, um pico esgota as conexões e tudo para.
   * Quem não consegue a trava não fica parado segurando conexão: tenta, devolve a conexão e tenta de novo.
   */
  constructor(
    private readonly pool: pg.Pool,
    private readonly dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  comTrava<T>(chave: string, fn: () => Promise<T>): Promise<T> {
    const k = `sintonia:${chave}`;
    // Dentro do mesmo processo, fila local primeiro: não ocupa conexões esperando a si mesmo.
    return this.local.comTrava(chave, async () => {
      for (let tentativa = 0; ; tentativa++) {
        const cliente = await this.pool.connect();
        let quebrou: Error | undefined;
        try {
          const { rows } = await cliente.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtextextended($1, 0)) as ok', [k]);
          if (rows[0]?.ok) {
            try {
              return await fn();
            } finally {
              // Se não der para soltar, a conexão é descartada (o Postgres solta a trava ao fechar a sessão).
              await cliente.query('select pg_advisory_unlock(hashtextextended($1, 0))', [k]).catch((e: Error) => (quebrou = e));
            }
          }
        } catch (e) {
          quebrou ??= e as Error;
          throw e;
        } finally {
          cliente.release(quebrou);
        }
        // Outro processo está com esta conversa: espera um pouco (crescendo até 400 ms, com variação).
        await this.dormir(Math.min(20 * 2 ** tentativa, 400) * (0.75 + Math.random() / 2));
      }
    });
  }
}
