import type { MensagemRecebida } from '../channels/tipos.js';
import { lerWebhookEvolution } from '../channels/evolution.js';

/**
 * puxar-historico (dono 23/11: "receber todo o histórico de maneira profissional").
 *
 * O WhatsApp manda o histórico uma vez só, ao ler o QR Code (webhook messages.set). Se uma parte se perde (app
 * reiniciando, formato novo, contato que o WhatsApp mostra só pelo código "@lid"), ela não volta. Mas a Evolution
 * guarda essas mensagens no banco dela. Aqui a Sintonia vai buscar lá, página por página, e põe na mesma fila do
 * histórico (src/app/historico.ts): repetir é seguro, a mensagem com o mesmo id do WhatsApp não entra duas vezes.
 *
 * Quando roda sozinho: ~2 min depois do último pedaço do histórico chegar pelo webhook (e depois de conectar um número).
 * Também dá para pedir pela tela de Conexões ("Puxar as conversas de novo").
 */
export interface AdminHistorico {
  paginaDeMensagens(nome: string, pagina: number, porPagina?: number): Promise<{ registros: unknown[]; paginas: number; total: number }>;
  mapaLid(nome: string): Promise<Map<string, string>>;
}

export interface AndamentoPuxar {
  rodando: boolean;
  lidas: number;
  novas: number;
  total: number;
  semNumero: number;
  inicio: Date;
  fim?: Date;
  erro?: string;
}

type Registro = { key?: { remoteJid?: unknown; remoteJidAlt?: unknown; senderPn?: unknown } } & Record<string, unknown>;

/** Põe o número no lugar do código "@lid" quando a Evolution sabe qual é (sem mexer no resto da mensagem). */
export function completarLid(registros: unknown[], mapa: Map<string, string>): unknown[] {
  return registros.map((r) => {
    const m = r as Registro;
    const jid = typeof m?.key?.remoteJid === 'string' ? m.key.remoteJid : '';
    if (!jid.endsWith('@lid') || m.key?.remoteJidAlt || m.key?.senderPn) return r;
    const num = mapa.get(jid);
    return num ? { ...m, key: { ...m.key, remoteJidAlt: num } } : r;
  });
}

/** Aprende "@lid" → número com as próprias mensagens (as que já trazem remoteJidAlt/senderPn). */
function aprenderLid(registros: unknown[], mapa: Map<string, string>): void {
  for (const r of registros) {
    const k = (r as Registro)?.key;
    const jid = typeof k?.remoteJid === 'string' ? k.remoteJid : '';
    const alt = typeof k?.remoteJidAlt === 'string' ? k.remoteJidAlt : typeof k?.senderPn === 'string' ? k.senderPn : '';
    if (jid.endsWith('@lid') && alt.endsWith('@s.whatsapp.net') && !mapa.has(jid)) mapa.set(jid, alt);
  }
}

export class PuxarHistorico {
  private readonly andamentos = new Map<string, AndamentoPuxar>();
  private readonly agendados = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly o: {
      admin: () => AdminHistorico | undefined;
      receber: (instancia: string, mensagens: MensagemRecebida[]) => Promise<number>;
      log?: (msg: string, extra?: unknown) => void;
      porPagina?: number;
      /** limite de segurança (páginas por vez); o padrão dá 500 mil mensagens. */
      maxPaginas?: number;
    },
  ) {}

  andamento(instancia: string): AndamentoPuxar | undefined {
    return this.andamentos.get(instancia);
  }

  /**
   * Puxa daqui a pouco (junta vários avisos seguidos num só). `seRecente` (reconexão): não repete se já puxou nas
   * últimas 6 h — o WhatsApp religa sozinho várias vezes por dia e cada "conectou" disparava uma busca inteira.
   */
  agendar(instancia: string, emMs = 120_000, o: { seRecente?: boolean } = {}): void {
    const ultimo = this.andamentos.get(instancia);
    if (o.seRecente && ultimo?.fim && Date.now() - ultimo.fim.getTime() < 6 * 3600_000) return;
    clearTimeout(this.agendados.get(instancia));
    const t = setTimeout(() => {
      this.agendados.delete(instancia);
      this.puxar(instancia).catch(() => {});
    }, emMs);
    t.unref?.();
    this.agendados.set(instancia, t);
  }

  /** Busca tudo o que a Evolution guardou desse número e põe na fila do histórico. Um por número de cada vez. */
  async puxar(instancia: string): Promise<AndamentoPuxar> {
    const atual = this.andamentos.get(instancia);
    if (atual?.rodando) return atual;
    const adm = this.o.admin();
    const a: AndamentoPuxar = { rodando: true, lidas: 0, novas: 0, total: 0, semNumero: 0, inicio: new Date() };
    this.andamentos.set(instancia, a);
    if (!adm) { a.rodando = false; a.erro = 'Evolution não configurada'; a.fim = new Date(); return a; }
    const porPagina = this.o.porPagina ?? 500;
    const max = this.o.maxPaginas ?? 1000;
    try {
      const mapa = await adm.mapaLid(instancia).catch(() => new Map<string, string>());
      const pendentesLid: unknown[] = [];
      for (let pagina = 1, paginas = 1; pagina <= paginas && pagina <= max; pagina++) {
        let r: Awaited<ReturnType<AdminHistorico['paginaDeMensagens']>> | undefined;
        for (let tentativa = 1; !r; tentativa++) {
          try { r = await adm.paginaDeMensagens(instancia, pagina, porPagina); }
          catch (e) { if (tentativa >= 4) throw e; await new Promise((ok) => setTimeout(ok, 2000 * tentativa)); }
        }
        paginas = r.paginas;
        a.total = r.total;
        if (!r.registros.length) break;
        aprenderLid(r.registros, mapa);
        const completos = completarLid(r.registros, mapa);
        // "@lid" que ainda não sabemos o número: guarda para o fim (outra página pode ensinar).
        const prontos: unknown[] = [];
        for (const x of completos) {
          const k = (x as Registro)?.key;
          if (typeof k?.remoteJid === 'string' && k.remoteJid.endsWith('@lid') && !k.remoteJidAlt && !k.senderPn) pendentesLid.push(x);
          else prontos.push(x);
        }
        a.lidas += r.registros.length;
        a.novas += await this.guardar(instancia, prontos);
      }
      if (pendentesLid.length) {
        const resolvidos = completarLid(pendentesLid, mapa);
        a.novas += await this.guardar(instancia, resolvidos);
        a.semNumero = resolvidos.filter((x) => { const k = (x as Registro)?.key; return !k?.remoteJidAlt && !k?.senderPn; }).length;
      }
      this.o.log?.('Histórico puxado da Evolution', { instancia, lidas: a.lidas, novas: a.novas, total: a.total, semNumero: a.semNumero });
    } catch (e) {
      a.erro = String(e).slice(0, 200);
      this.o.log?.('Falha ao puxar o histórico da Evolution', { instancia, erro: a.erro, lidas: a.lidas });
    } finally {
      a.rodando = false;
      a.fim = new Date();
    }
    return a;
  }

  private async guardar(instancia: string, registros: unknown[]): Promise<number> {
    if (!registros.length) return 0;
    const msgs = lerWebhookEvolution({ event: 'messages.set', instance: instancia, data: registros });
    return msgs.length ? this.o.receber(instancia, msgs) : 0;
  }
}
