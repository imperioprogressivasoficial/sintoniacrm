import type { MensagemRecebida } from '../channels/tipos.js';
import type { FilaEntrada } from './entrada.js';

export interface OpcoesTrabalhador {
  fila: FilaEntrada;
  processar: (m: MensagemRecebida) => Promise<void>;
  /** Quantas clientes diferentes são atendidas ao mesmo tempo. */
  paralelo?: number;
  /** Espera quando a fila está vazia. */
  esperaVaziaMs?: number;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

/**
 * Consome a fila de entrada. Pode haver vários, em vários processos: a fila garante
 * que cada mensagem vai para um só e que a mesma cliente é atendida em ordem.
 */
export class Trabalhador {
  private rodando = false;
  private parado: Promise<void> = Promise.resolve();
  private acordar?: () => void;

  constructor(private readonly o: OpcoesTrabalhador) {}

  /** Processa uma rodada. Retorna quantas mensagens pegou. */
  async rodada(): Promise<number> {
    const agora = this.o.agora ?? (() => new Date());
    const itens = await this.o.fila.reivindicar(agora(), this.o.paralelo ?? 8);
    await Promise.all(
      itens.map(async (item) => {
        try {
          await this.o.processar(item.mensagem);
          await this.o.fila.concluir(item.id, agora());
        } catch (e) {
          const erro = e instanceof Error ? e.message : String(e);
          this.o.log?.('Falha ao processar mensagem da fila', { id: item.id, tentativa: item.tentativas, erro });
          await this.o.fila.falhar(item.id, erro, agora());
        }
      }),
    );
    return itens.length;
  }

  iniciar(): void {
    if (this.rodando) return;
    this.rodando = true;
    this.parado = (async () => {
      while (this.rodando) {
        let n = 0;
        try {
          n = await this.rodada();
        } catch (e) {
          this.o.log?.('Falha ao ler a fila', String(e));
        }
        if (n === 0 && this.rodando) {
          await new Promise<void>((r) => {
            const t = setTimeout(r, this.o.esperaVaziaMs ?? 500);
            this.acordar = () => {
              clearTimeout(t);
              r();
            };
          });
          this.acordar = undefined;
        }
      }
    })();
  }

  /** Chamado quando entra mensagem nova: não espera o próximo ciclo. */
  avisar(): void {
    this.acordar?.();
  }

  /** Para de pegar novas mensagens e espera as que estão em andamento terminarem. */
  async parar(): Promise<void> {
    this.rodando = false;
    this.acordar?.();
    await this.parado;
  }
}
