/**
 * robustez: relógio que nunca começa uma rodada por cima da outra.
 *
 * Com setInterval puro, se uma rodada demora mais que o intervalo (banco lento, IA demorando, muitas tarefas), a
 * próxima começa junto e as duas pegam o mesmo trabalho, disputam as travas e enchem o pool de conexões. Aqui, se a
 * rodada anterior ainda está rodando, a vez é pulada (e contada). `ocioso()` espera a rodada em andamento terminar.
 */
export interface RelogioUmaPorVez {
  /** Roda agora se não houver rodada em andamento; senão pula. Retorna se rodou. */
  (): Promise<boolean>;
  /** Quantas vezes pulou porque a anterior não tinha terminado. */
  readonly pulos: number;
  /** Espera a rodada em andamento (se houver). */
  ocioso(): Promise<void>;
}

export function umaPorVez(nome: string, fn: () => Promise<unknown>, log?: (msg: string, extra?: unknown) => void): RelogioUmaPorVez {
  let andando: Promise<void> | undefined;
  let pulos = 0;
  let inicio = 0;
  const rodar = (async () => {
    if (andando) {
      pulos++;
      // Um aviso a cada 10 pulos: a rodada está passando do intervalo com frequência.
      if (pulos % 10 === 1) log?.(`Relógio "${nome}" ainda na rodada anterior (há ${Math.round((Date.now() - inicio) / 1000)} s); esta vez foi pulada`, { pulos });
      return false;
    }
    inicio = Date.now();
    andando = (async () => {
      try {
        await fn();
      } catch (e) {
        log?.(`Falha no relógio "${nome}"`, String(e));
      }
    })();
    try {
      await andando;
    } finally {
      andando = undefined;
    }
    return true;
  }) as RelogioUmaPorVez;
  Object.defineProperty(rodar, 'pulos', { get: () => pulos });
  rodar.ocioso = async () => {
    await andando;
  };
  return rodar;
}
