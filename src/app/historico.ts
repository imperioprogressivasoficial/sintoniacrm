import type pg from 'pg';
import type { MensagemRecebida } from '../channels/tipos.js';

/**
 * robustez: histórico do WhatsApp ao conectar (messages.set da Evolution, até 40 MB) importado em lotes, com o estado
 * no banco.
 *
 * Antes: o webhook passava as ~120 mil mensagens de uma vez para `importarHistorico`, que as guardava em memória
 * durante ~9 minutos (pico de 0,9 GB) e, se o app reiniciasse no meio, o resto se perdia (a Evolution não manda de
 * novo). Agora:
 * - o webhook só grava as mensagens na tabela `historico_entrada` (em blocos de 1.000) e responde;
 * - o importador pega lotes de 500 (das mais antigas para as mais novas), passa para `importarHistorico` (o mesmo de
 *   sempre: sem IA, avisos nem funil) e só então apaga o lote da tabela;
 * - se o app reiniciar, a importação continua de onde parou ao subir (repetir um lote é seguro: a mensagem com o mesmo
 *   id do WhatsApp não entra duas vezes);
 * - a memória fica no tamanho de um lote, não do histórico inteiro.
 */
export interface FilaHistorico {
  guardar(instancia: string, mensagens: MensagemRecebida[]): Promise<number>;
  pegar(limite: number): Promise<Array<{ id: number; instancia: string; mensagem: MensagemRecebida }>>;
  apagar(ids: number[]): Promise<void>;
  pendentes(): Promise<Record<string, number>>;
}

const lerMensagem = (j: MensagemRecebida & { em: string | Date }): MensagemRecebida => ({ ...j, em: new Date(j.em) });

export class FilaHistoricoMemoria implements FilaHistorico {
  private linhas: Array<{ id: number; instancia: string; idExterno: string; mensagem: MensagemRecebida }> = [];
  private seq = 0;
  private vistos = new Set<string>();
  async guardar(instancia: string, mensagens: MensagemRecebida[]) {
    let n = 0;
    for (const m of mensagens) {
      if (this.vistos.has(m.idExterno)) continue;
      this.vistos.add(m.idExterno);
      this.linhas.push({ id: ++this.seq, instancia, idExterno: m.idExterno, mensagem: m });
      n++;
    }
    return n;
  }
  async pegar(limite: number) {
    return [...this.linhas].sort((a, b) => a.mensagem.em.getTime() - b.mensagem.em.getTime() || a.id - b.id).slice(0, limite);
  }
  async apagar(ids: number[]) {
    const s = new Set(ids);
    for (const l of this.linhas) if (s.has(l.id)) this.vistos.delete(l.idExterno);
    this.linhas = this.linhas.filter((l) => !s.has(l.id));
  }
  async pendentes() {
    const r: Record<string, number> = {};
    for (const l of this.linhas) r[l.instancia] = (r[l.instancia] ?? 0) + 1;
    return r;
  }
}

export class FilaHistoricoPostgres implements FilaHistorico {
  constructor(private readonly pool: pg.Pool) {}
  async guardar(instancia: string, mensagens: MensagemRecebida[]) {
    let n = 0;
    for (let i = 0; i < mensagens.length; i += 1000) {
      const bloco = mensagens.slice(i, i + 1000);
      const r = await this.pool.query(
        `insert into sintonia.historico_entrada (instancia, id_externo, em, mensagem)
         select $1, x.id_externo, x.em, x.mensagem from unnest($2::text[], $3::timestamptz[], $4::jsonb[]) as x(id_externo, em, mensagem)
         on conflict (id_externo) do nothing`,
        [instancia, bloco.map((m) => m.idExterno), bloco.map((m) => m.em), bloco.map((m) => JSON.stringify(m))],
      );
      n += r.rowCount ?? 0;
    }
    return n;
  }
  async pegar(limite: number) {
    const { rows } = await this.pool.query<{ id: string; instancia: string; mensagem: MensagemRecebida & { em: string } }>(
      'select id, instancia, mensagem from sintonia.historico_entrada order by em, id limit $1',
      [limite],
    );
    return rows.map((r) => ({ id: Number(r.id), instancia: r.instancia, mensagem: lerMensagem(r.mensagem) }));
  }
  async apagar(ids: number[]) {
    if (ids.length) await this.pool.query('delete from sintonia.historico_entrada where id = any($1::bigint[])', [ids]);
  }
  async pendentes() {
    const { rows } = await this.pool.query<{ instancia: string; n: string }>('select instancia, count(*) as n from sintonia.historico_entrada group by instancia');
    return Object.fromEntries(rows.map((r) => [r.instancia, Number(r.n)]));
  }
}

export interface ProgressoHistorico {
  mensagens: number;
  conversas: number;
  em: Date;
  /** robustez: quantas ainda faltam importar (na tabela). */
  faltam?: number;
}

export class ImportadorHistorico {
  private rodando?: Promise<void>;
  private readonly progressos = new Map<string, ProgressoHistorico>();
  private parar = false;

  constructor(
    private readonly o: {
      fila: FilaHistorico;
      importar: (mensagens: MensagemRecebida[]) => Promise<{ conversas: number; mensagens: number }>;
      lote?: number;
      log?: (msg: string, extra?: unknown) => void;
    },
  ) {}

  /** O webhook recebeu um histórico: grava (com o estado no banco) e põe o importador para andar. */
  async receber(instancia: string, mensagens: MensagemRecebida[]): Promise<number> {
    const n = await this.o.fila.guardar(instancia, mensagens);
    const p = this.progressos.get(instancia) ?? { mensagens: 0, conversas: 0, em: new Date() };
    this.progressos.set(instancia, { ...p, em: new Date(), faltam: (p.faltam ?? 0) + n });
    this.avisar();
    return n;
  }

  /** Começa (ou continua, depois de reiniciar) a importar o que estiver na tabela. */
  avisar(): void {
    if (this.rodando || this.parar) return;
    this.rodando = this.andar().finally(() => (this.rodando = undefined));
  }

  progresso(instancia: string): ProgressoHistorico | undefined {
    return this.progressos.get(instancia);
  }

  /** Para depois do lote em andamento (desligamento). O que faltar continua ao subir de novo. */
  async encerrar(): Promise<void> {
    this.parar = true;
    await this.rodando;
  }

  /** Espera terminar (testes). */
  async ocioso(): Promise<void> {
    while (this.rodando) await this.rodando;
  }

  private async andar(): Promise<void> {
    const lote = this.o.lote ?? 500;
    for (let falhas = 0; !this.parar; ) {
      let itens: Awaited<ReturnType<FilaHistorico['pegar']>>;
      try {
        itens = await this.o.fila.pegar(lote);
        if (!itens.length) return;
        const r = await this.o.importar(itens.map((i) => i.mensagem));
        await this.o.fila.apagar(itens.map((i) => i.id));
        falhas = 0;
        const porInstancia = new Map<string, number>();
        for (const i of itens) porInstancia.set(i.instancia, (porInstancia.get(i.instancia) ?? 0) + 1);
        for (const [inst, qtd] of porInstancia) {
          const p = this.progressos.get(inst) ?? { mensagens: 0, conversas: 0, em: new Date() };
          // As conversas novas do lote são contadas na instância com mais mensagens nele (aproximação para a tela).
          const parte = qtd / itens.length;
          this.progressos.set(inst, { mensagens: p.mensagens + Math.round(r.mensagens * parte), conversas: p.conversas + Math.round(r.conversas * parte), em: new Date(), faltam: Math.max(0, (p.faltam ?? 0) - qtd) });
        }
      } catch (e) {
        // Banco fora ou lote com problema: espera e tenta de novo (até 10 vezes seguidas; depois retoma no próximo aviso).
        if (++falhas >= 10) {
          this.o.log?.('Importação do histórico parada depois de várias falhas; continua no próximo aviso', String(e));
          return;
        }
        this.o.log?.('Falha ao importar um lote do histórico; nova tentativa em instantes', String(e));
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** falhas, 30_000)));
      }
    }
  }
}
