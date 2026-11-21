import pg from 'pg';

/**
 * robustez: pool do Postgres que aguenta o banco reiniciar ou derrubar as conexões.
 *
 * Sem isto, quando o Postgres encerra uma conexão parada (reinício, publicação, "terminating connection due to
 * administrator command"), o pg emite 'error' sem ninguém ouvindo e o Node derruba o processo inteiro
 * (auditoria de 20/11: 213 mensagens perdidas numa queda de 20 s). Aqui:
 * - o pool e CADA conexão têm quem ouça o erro (só registra; a conexão quebrada é descartada pelo pool);
 * - pedir conexão tem prazo (não fica pendurado para sempre com o banco fora);
 * - quando o banco volta, as próximas consultas abrem conexões novas sozinhas (o pg já faz isso).
 */
export function criarPool(o: { url: string; max: number; log: (msg: string, extra?: unknown) => void; nome?: string }): pg.Pool {
  const pool = new pg.Pool({
    connectionString: o.url,
    max: o.max,
    // Banco fora: falha em 10 s em vez de esperar para sempre (quem chamou decide: webhook guarda na reserva em disco).
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    // Detecta conexão morta (rede caiu sem aviso).
    keepAlive: true,
  });
  ouvirErros(pool, o.log, o.nome ?? 'banco');
  return pool;
}

/** Liga os ouvintes de erro no pool e em cada conexão nova (ver criarPool). */
export function ouvirErros(pool: pg.Pool, log: (msg: string, extra?: unknown) => void, nome = 'banco'): void {
  let ultimoAviso = 0;
  const avisar = (onde: string, e: unknown) => {
    // Numa queda chegam dezenas de erros iguais (um por conexão): um aviso a cada 5 s basta.
    const t = Date.now();
    if (t - ultimoAviso < 5_000) return;
    ultimoAviso = t;
    log(`Conexão com o ${nome} caiu (${onde}); o app continua e reconecta sozinho`, String((e as Error)?.message ?? e));
  };
  pool.on('error', (e) => avisar('parada', e));
  // Conexão emprestada (ex.: trava da conversa, transação) também pode cair enquanto ninguém consulta.
  pool.on('connect', (cliente) => {
    cliente.on('error', (e) => avisar('em uso', e));
  });
}

/** Erro de "banco fora do ar" (e não de consulta errada): vale a pena guardar e tentar de novo depois. */
export function ehErroDeConexao(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  const codigo = String(err?.code ?? '');
  // 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now, 08xxx connection_exception, 53300 too_many_connections
  if (/^(57P0[1-3]|08\d{3}|53300)$/.test(codigo)) return true;
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'].includes(codigo)) return true;
  return /connection (terminated|timeout)|timeout exceeded when trying to connect|Connection terminated|terminating connection|the database system is (starting up|shutting down)|Client has encountered a connection error/i.test(String(err?.message ?? ''));
}

/**
 * Na subida, espera o banco responder (o Docker pode subir o app antes de o Postgres aceitar conexões, ou o banco
 * estar reiniciando): tenta com espera crescente até `limiteMs`. Sem isto, a primeira consulta derrubava o app.
 */
export async function esperarBanco(
  pool: pg.Pool,
  log: (msg: string, extra?: unknown) => void,
  o: { limiteMs?: number; dormir?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limite = Date.now() + (o.limiteMs ?? 5 * 60_000);
  for (let tentativa = 0; ; tentativa++) {
    try {
      await pool.query('select 1');
      if (tentativa) log('Banco respondeu; seguindo.');
      return;
    } catch (e) {
      if (Date.now() > limite) throw e;
      const espera = Math.min(1_000 * 2 ** tentativa, 15_000);
      log(`Banco ainda não responde; nova tentativa em ${Math.round(espera / 1000)} s`, String((e as Error)?.message ?? e));
      await dormir(espera);
    }
  }
}
