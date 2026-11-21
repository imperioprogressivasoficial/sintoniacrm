import { mkdirSync } from 'node:fs';
import { appendFile, open, readdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { MensagemRecebida } from '../channels/tipos.js';
import type { FilaEntrada } from './entrada.js';

/**
 * robustez: reserva em disco da fila de entrada.
 *
 * O webhook só responde "ok" depois que a mensagem está guardada em lugar que sobrevive a reinício. Normalmente é a
 * fila no banco. Se o banco está fora (reiniciando, conexões derrubadas), a mensagem vai para um arquivo neste disco
 * (gravado e sincronizado antes de responder) e entra na fila do banco assim que ele voltar. Mensagem repetida não
 * duplica: a fila ignora o mesmo id do WhatsApp. Se nem o disco aceitar, o webhook responde erro e o WhatsApp reenvia.
 *
 * Formato: uma linha JSON por lote ({ canal, mensagens }). Ao descarregar, o arquivo é renomeado antes de ler
 * (o que chega durante a descarga vai para um arquivo novo); se a descarga parar no meio, o renomeado fica e é
 * retomado na próxima vez (repetir é seguro).
 */
export class FilaComReserva implements FilaEntrada {
  private escrita: Promise<unknown> = Promise.resolve();
  private descarregando?: Promise<number>;
  private guardadas = 0;

  constructor(
    private readonly principal: FilaEntrada,
    private readonly pasta: string,
    private readonly log: (msg: string, extra?: unknown) => void = () => {},
  ) {
    mkdirSync(pasta, { recursive: true });
  }

  private get arquivo() {
    return path.join(this.pasta, 'entrada.jsonl');
  }

  async enfileirar(canal: string, mensagens: MensagemRecebida[]): Promise<number> {
    if (!mensagens.length) return 0;
    try {
      const n = await this.principal.enfileirar(canal, mensagens);
      // O banco voltou e ainda há reserva: descarrega por trás.
      if (this.guardadas) void this.descarregar().catch(() => undefined);
      return n;
    } catch (e) {
      await this.guardar(canal, mensagens);
      this.log(`Banco fora: ${mensagens.length} mensagem(ns) guardada(s) na reserva em disco`, String((e as Error)?.message ?? e));
      return mensagens.length;
    }
  }

  /** Grava e sincroniza no disco (uma escrita por vez, para as linhas não se misturarem). */
  private guardar(canal: string, mensagens: MensagemRecebida[]): Promise<void> {
    const linha = JSON.stringify({ canal, mensagens }) + '\n';
    const feito = this.escrita.then(async () => {
      await appendFile(this.arquivo, linha, 'utf8');
      const h = await open(this.arquivo, 'r');
      try {
        await h.sync();
      } finally {
        await h.close();
      }
      this.guardadas += mensagens.length;
    });
    this.escrita = feito.catch(() => undefined);
    return feito;
  }

  /** Quantas mensagens estão na reserva (para /saude). Conta as linhas dos arquivos. */
  async pendentesNaReserva(): Promise<number> {
    let n = 0;
    for (const a of await this.arquivos()) {
      const txt = await readFile(path.join(this.pasta, a), 'utf8').catch(() => '');
      for (const l of txt.split('\n')) {
        if (!l.trim()) continue;
        try {
          n += (JSON.parse(l) as { mensagens: unknown[] }).mensagens.length;
        } catch {
          /* linha cortada: ignorada */
        }
      }
    }
    return n;
  }

  private async arquivos(): Promise<string[]> {
    const nomes = await readdir(this.pasta).catch(() => [] as string[]);
    // Primeiro as descargas que pararam no meio (mais antigas), depois o arquivo em uso.
    return [...nomes.filter((n) => n.startsWith('descarga-') && n.endsWith('.jsonl')).sort(), ...nomes.filter((n) => n === 'entrada.jsonl')];
  }

  /** Passa o que está no disco para a fila do banco. Retorna quantas mensagens entraram. Uma descarga por vez. */
  descarregar(): Promise<number> {
    this.descarregando ??= this.descarregarAgora().finally(() => (this.descarregando = undefined));
    return this.descarregando;
  }

  private async descarregarAgora(): Promise<number> {
    let total = 0;
    for (const nome of await this.arquivos()) {
      let alvo = path.join(this.pasta, nome);
      if (nome === 'entrada.jsonl') {
        // Espera a escrita em andamento e tira o arquivo do caminho: o que chegar agora vai para um novo.
        await this.escrita;
        const novo = path.join(this.pasta, `descarga-${Date.now()}-${process.pid}.jsonl`);
        try {
          await rename(alvo, novo);
        } catch {
          continue;
        }
        this.guardadas = 0;
        alvo = novo;
      }
      const linhas = (await readFile(alvo, 'utf8')).split('\n').filter((l) => l.trim());
      for (const l of linhas) {
        let lote: { canal: string; mensagens: Array<MensagemRecebida & { em: string | Date }> };
        try {
          lote = JSON.parse(l);
        } catch {
          continue; // linha cortada por uma queda no meio da escrita: não há o que recuperar dela
        }
        const mensagens = lote.mensagens.map((m) => ({ ...m, em: new Date(m.em) }));
        // Se o banco cair de novo aqui, a descarga para e o arquivo fica para a próxima (repetidas são ignoradas).
        await this.principal.enfileirar(lote.canal, mensagens);
        total += mensagens.length;
      }
      await unlink(alvo);
    }
    if (total) this.log(`Reserva em disco descarregada: ${total} mensagem(ns) passaram para a fila`);
    return total;
  }

  reivindicar(agora: Date, limite: number) {
    return this.principal.reivindicar(agora, limite);
  }
  concluir(id: number, agora: Date) {
    return this.principal.concluir(id, agora);
  }
  falhar(id: number, erro: string, agora: Date) {
    return this.principal.falhar(id, erro, agora);
  }
  situacao() {
    return this.principal.situacao();
  }
  falhas(limite?: number) {
    return this.principal.falhas(limite);
  }
  reprocessar(id: number, agora: Date) {
    return this.principal.reprocessar(id, agora);
  }
}
