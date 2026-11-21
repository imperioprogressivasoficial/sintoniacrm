/**
 * robustez: fila própria da IA.
 *
 * Antes, a fila de entrada do WhatsApp gravava a mensagem E esperava a IA pensar a resposta (~8 s) antes de pegar a
 * próxima; com 8 conversas por vez, acima de ~1 msg/s a mensagem demorava dezenas de segundos para APARECER na tela
 * (auditoria de 20/11: 41 s com 2 msg/s). Agora a entrada só grava e mostra (rápido) e pede aqui para a IA pensar.
 *
 * - `paralelo` conversas pensadas ao mesmo tempo (SINTONIA_PARALELO_IA, padrão 24);
 * - a mesma conversa nunca é pensada duas vezes ao mesmo tempo: pedido repetido enquanto espera não entra de novo;
 *   pedido enquanto ela está sendo pensada vira "pense de novo quando terminar" (a IA vê a mensagem nova);
 * - quem espera há mais tempo é atendido primeiro (ordem de chegada);
 * - se o processo cair com conversas na fila, a rede de segurança é a tarefa "reavaliar" gravada no banco
 *   (Sintonia.receber programa uma para daqui a alguns minutos; o relógio de 30 s a executa).
 */
export class FilaIa {
  private readonly espera: string[] = [];
  private readonly naFila = new Set<string>();
  private readonly pensando = new Set<string>();
  private readonly deNovo = new Set<string>();
  private readonly aguardando = new Map<string, Array<() => void>>();
  private ociosos: Array<() => void> = [];
  private feitas = 0;

  constructor(
    private readonly o: {
      pensar: (conversaId: string) => Promise<void>;
      paralelo: number;
      log?: (msg: string, extra?: unknown) => void;
    },
  ) {}

  /** Pede para a IA pensar esta conversa (não espera). */
  pedir(conversaId: string): void {
    if (this.pensando.has(conversaId)) {
      this.deNovo.add(conversaId);
      return;
    }
    if (this.naFila.has(conversaId)) return;
    this.naFila.add(conversaId);
    this.espera.push(conversaId);
    this.andar();
  }

  /** Pede e espera terminar (o relógio usa para as reavaliações: várias em paralelo, sem passar do limite). */
  executar(conversaId: string): Promise<void> {
    return new Promise<void>((r) => {
      const l = this.aguardando.get(conversaId) ?? [];
      l.push(r);
      this.aguardando.set(conversaId, l);
      this.pedir(conversaId);
    });
  }

  private andar(): void {
    while (this.pensando.size < this.o.paralelo && this.espera.length) {
      const id = this.espera.shift()!;
      this.naFila.delete(id);
      this.pensando.add(id);
      void this.rodar(id);
    }
    if (!this.pensando.size && !this.espera.length) {
      const l = this.ociosos;
      this.ociosos = [];
      for (const r of l) r();
    }
  }

  private async rodar(id: string): Promise<void> {
    try {
      await this.o.pensar(id);
    } catch (e) {
      // `pensar` já registra e reagenda; aqui só não deixa a fila parar.
      this.o.log?.('Falha na fila da IA', String(e));
    } finally {
      this.pensando.delete(id);
      this.feitas++;
      const deNovo = this.deNovo.delete(id);
      if (!deNovo) {
        const l = this.aguardando.get(id);
        this.aguardando.delete(id);
        for (const r of l ?? []) r();
      }
      if (deNovo) this.pedir(id);
      this.andar();
    }
  }

  /** Para o painel de saúde e os testes. */
  situacao(): { esperando: number; pensando: number; feitas: number } {
    return { esperando: this.espera.length, pensando: this.pensando.size, feitas: this.feitas };
  }

  /** Espera a fila esvaziar (desligamento e testes). */
  ocioso(): Promise<void> {
    if (!this.pensando.size && !this.espera.length) return Promise.resolve();
    return new Promise<void>((r) => this.ociosos.push(r));
  }
}
