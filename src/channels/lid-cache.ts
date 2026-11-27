import { completarLid } from '../app/puxar-historico.js';

/**
 * aud-numeros: mensagem ao vivo (messages.upsert) de contato "@lid" que chega sem o número (sem remoteJidAlt/senderPn)
 * era descartada em silêncio. Aqui ela é completada com o mapa "@lid" → número da Evolution (EvolutionAdmin.mapaLid),
 * guardado por instância e atualizado no máximo a cada 10 min. O webhook nunca espera mais que ~3 s pelo mapa:
 * se demorar ou falhar, segue sem ele (a busca continua por trás e serve às próximas mensagens).
 * As mensagens que continuarem sem número vão para o log: 1 linha por minuto por instância, no máximo.
 */
export interface OpcoesCacheLid {
  buscar: (instancia: string) => Promise<Map<string, string>>;
  log?: (msg: string, extra?: unknown) => void;
  /** Intervalo mínimo entre duas buscas do mapa de uma instância (padrão 10 min). */
  intervaloMs?: number;
  /** Quanto o webhook espera pelo mapa (padrão 3 s). */
  esperaMs?: number;
  /** Intervalo mínimo entre duas linhas de log de uma instância (padrão 1 min). */
  logMs?: number;
  agora?: () => number;
}

type Item = { key?: { remoteJid?: unknown; remoteJidAlt?: unknown; senderPn?: unknown; fromMe?: unknown } } & Record<string, unknown>;

interface EstadoInstancia {
  mapa: Map<string, string>;
  buscadoEm: number;
  buscando?: Promise<void>;
  semNumero: number;
  logEm: number;
}

const semNumero = (x: unknown): boolean => {
  const k = (x as Item | null)?.key;
  return typeof k?.remoteJid === 'string' && k.remoteJid.endsWith('@lid') && !k.remoteJidAlt && !k.senderPn;
};

export class CacheLid {
  private readonly estados = new Map<string, EstadoInstancia>();
  private readonly intervaloMs: number;
  private readonly esperaMs: number;
  private readonly logMs: number;
  private readonly agora: () => number;

  constructor(private readonly o: OpcoesCacheLid) {
    this.intervaloMs = o.intervaloMs ?? 10 * 60_000;
    this.esperaMs = o.esperaMs ?? 3_000;
    this.logMs = o.logMs ?? 60_000;
    this.agora = o.agora ?? Date.now;
  }

  private estado(instancia: string): EstadoInstancia {
    let e = this.estados.get(instancia);
    if (!e) { e = { mapa: new Map(), buscadoEm: -Infinity, semNumero: 0, logEm: -Infinity }; this.estados.set(instancia, e); }
    return e;
  }

  /** Busca o mapa de novo se a última busca tem mais de 10 min (uma por vez). Falha: mantém o mapa que já tinha. */
  private atualizar(instancia: string, e: EstadoInstancia): Promise<void> | undefined {
    if (e.buscando) return e.buscando;
    if (this.agora() - e.buscadoEm < this.intervaloMs) return undefined;
    e.buscadoEm = this.agora();
    e.buscando = this.o.buscar(instancia)
      .then((novo) => { for (const [lid, num] of novo) e.mapa.set(lid, num); })
      .catch((err) => this.o.log?.('Mapa de contatos @lid do WhatsApp não veio', { instancia, erro: String(err).slice(0, 200) }))
      .finally(() => { e.buscando = undefined; });
    return e.buscando;
  }

  /** Aprende "@lid" → número com as próprias mensagens que já trazem o número. */
  private aprender(itens: unknown[], e: EstadoInstancia): void {
    for (const x of itens) {
      const k = (x as Item | null)?.key;
      const jid = typeof k?.remoteJid === 'string' ? k.remoteJid : '';
      const alt = typeof k?.remoteJidAlt === 'string' ? k.remoteJidAlt : typeof k?.senderPn === 'string' ? k.senderPn : '';
      if (jid.endsWith('@lid') && alt && !alt.endsWith('@lid')) e.mapa.set(jid, alt.includes('@') ? alt : `${alt}@s.whatsapp.net`);
    }
  }

  /**
   * Devolve o corpo do webhook com os "@lid" sem número completados (o mesmo corpo, se não havia nada a completar).
   * Nunca lança erro.
   */
  async completar(corpo: unknown): Promise<unknown> {
    try {
      const c = corpo as { instance?: unknown; data?: unknown };
      const instancia = typeof c?.instance === 'string' ? c.instance : '';
      if (!instancia) return corpo;
      const lista = Array.isArray(c.data) ? c.data : [c.data];
      const e = this.estado(instancia);
      this.aprender(lista, e);
      if (!lista.some(semNumero)) return corpo;
      let completos = completarLid(lista, e.mapa);
      if (completos.some(semNumero)) {
        const busca = this.atualizar(instancia, e);
        if (busca) {
          let relogio: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([busca, new Promise<void>((ok) => { relogio = setTimeout(ok, this.esperaMs); })]);
          clearTimeout(relogio);
          completos = completarLid(lista, e.mapa);
        }
      }
      const faltam = completos.filter(semNumero).length;
      if (faltam) this.registrarSemNumero(instancia, e, faltam);
      return { ...c, data: Array.isArray(c.data) ? completos : completos[0] };
    } catch (err) {
      this.o.log?.('Falha ao completar contatos @lid', String(err).slice(0, 200));
      return corpo;
    }
  }

  private registrarSemNumero(instancia: string, e: EstadoInstancia, n: number): void {
    e.semNumero += n;
    const agora = this.agora();
    if (agora - e.logEm < this.logMs) return;
    this.o.log?.('Mensagens do WhatsApp sem número (contato @lid) ficaram de fora', { instancia, mensagens: e.semNumero });
    e.semNumero = 0;
    e.logEm = agora;
  }
}
