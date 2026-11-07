/**
 * Base comum dos clientes de agenda (Trinks, Avec, AppBarber): o mesmo cuidado com a cota em todos.
 * - fila única: nunca duas chamadas ao mesmo tempo, sempre com pausa mínima entre elas;
 * - nova tentativa com espera crescente quando a API devolve 429;
 * - cache em memória com prazo (serviços e profissionais por horas, horários vagos por minutos).
 */

export type MetodoHttp = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface OpcoesFila {
  baseUrl: string;
  /** Pausa mínima entre chamadas (ms). */
  intervaloMs?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export interface PedidoHttp {
  query?: Record<string, string>;
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
}

export abstract class ClienteHttpFila {
  protected baseUrl: string;
  protected readonly intervaloMs: number;
  protected readonly fetchFn: typeof fetch;
  protected readonly agora: () => number;
  protected readonly dormir: (ms: number) => Promise<void>;
  private fila: Promise<unknown> = Promise.resolve();
  private ultimaChamada = 0;
  private readonly cache = new Map<string, { expira: number; valor: unknown }>();
  /** Quantas chamadas reais foram feitas (para o painel de consumo). */
  chamadas = 0;

  constructor(o: OpcoesFila) {
    this.baseUrl = o.baseUrl.replace(/\/$/, '');
    this.intervaloMs = o.intervaloMs ?? 1200;
    this.fetchFn = o.fetchFn ?? fetch;
    this.agora = o.agora ?? Date.now;
    this.dormir = o.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Erro devolvido quando a API responde fora de 2xx. Cada sistema tem a sua classe. */
  protected abstract erroHttp(status: number, mensagem: string): Error;
  /** Nome curto que aparece nas mensagens de erro ("Trinks", "Avec"…). */
  protected abstract readonly rotulo: string;

  protected limparCache(): void {
    this.cache.clear();
  }

  protected invalidar(prefixo: string): void {
    for (const k of this.cache.keys()) if (k.startsWith(prefixo)) this.cache.delete(k);
  }

  protected async emCache<T>(chave: string, ttlMs: number, carregar: () => Promise<T>): Promise<T> {
    const c = this.cache.get(chave);
    if (c && c.expira > this.agora()) return c.valor as T;
    const valor = await carregar();
    this.cache.set(chave, { expira: this.agora() + ttlMs, valor });
    return valor;
  }

  /** Toda chamada passa por uma fila única: nunca duas ao mesmo tempo, sempre com pausa entre elas. */
  protected enfileirar<T>(metodo: MetodoHttp, caminho: string, op: PedidoHttp = {}): Promise<T> {
    const tarefa = this.fila.then(() => this.executar<T>(metodo, caminho, op));
    this.fila = tarefa.catch(() => undefined);
    return tarefa;
  }

  private async executar<T>(metodo: MetodoHttp, caminho: string, op: PedidoHttp): Promise<T> {
    const url = new URL(this.baseUrl + caminho);
    for (const [k, v] of Object.entries(op.query ?? {})) url.searchParams.set(k, v);

    for (let tentativa = 0; ; tentativa++) {
      const espera = this.ultimaChamada + this.intervaloMs - this.agora();
      if (espera > 0) await this.dormir(espera);
      this.ultimaChamada = this.agora();
      this.chamadas++;

      const resp = await this.fetchFn(url, {
        method: metodo,
        headers: {
          ...(op.cabecalhos ?? {}),
          accept: 'application/json',
          ...(op.corpo ? { 'content-type': 'application/json' } : {}),
        },
        body: op.corpo ? JSON.stringify(op.corpo) : undefined,
      });

      if (resp.status === 429 && tentativa < 3) {
        await this.dormir(2000 * 2 ** tentativa);
        continue;
      }
      const texto = await resp.text();
      if (!resp.ok) throw this.erroHttp(resp.status, `${this.rotulo} ${metodo} ${caminho} → ${resp.status}: ${texto.slice(0, 300)}`);
      return (texto ? JSON.parse(texto) : {}) as T;
    }
  }
}
