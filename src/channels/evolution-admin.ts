/**
 * Administração da Evolution API v2: criar a instância de cada loja, mostrar o QR Code,
 * saber se está conectada e desconectar. Usa a chave global da Evolution.
 *
 * Só mexe nas instâncias da própria Sintonia (nomes "sintonia-<unidade>"): nunca altera o webhook de
 * instâncias que já existem para outros fluxos (ex.: a Serena no n8n).
 */

export type EstadoInstancia = 'conectada' | 'conectando' | 'desconectada' | 'inexistente';

export interface InfoInstancia {
  nome: string;
  estado: EstadoInstancia;
  numero: string | null;
  perfil: string | null;
  /** Código da última desconexão (401 = aparelho removido no celular; ver motivoDoCodigo em whatsapp-saude.ts). */
  codigoDesconexao?: number | null;
}

/** Eventos que a Sintonia assina no webhook de cada instância. */
export const EVENTOS_WEBHOOK = [
  'MESSAGES_UPSERT',
  // MESSAGES_SET: o histórico de conversas que o WhatsApp manda uma vez, logo depois de conectar.
  'MESSAGES_SET',
  // CALL: ligação de voz recebida no número (vira "recebida"/"perdida" na tela Ligações).
  'CALL',
  // CONNECTION_UPDATE: conectou, caiu, o aparelho foi removido no celular (aviso e faixa no app).
  'CONNECTION_UPDATE',
];

function lerInfo(nome: string, i: Record<string, unknown>): InfoInstancia {
  const inst = i.instance as Record<string, unknown> | undefined;
  const status = String(i.connectionStatus ?? inst?.status ?? inst?.state ?? '');
  const dono = String(i.ownerJid ?? inst?.owner ?? '');
  const cod = Number(i.disconnectionReasonCode);
  return {
    nome,
    estado: status === 'open' ? 'conectada' : status === 'connecting' ? 'conectando' : 'desconectada',
    numero: dono ? dono.split('@')[0]!.replace(/\D/g, '') || null : null,
    perfil: (i.profileName as string | undefined) ?? null,
    codigoDesconexao: Number.isFinite(cod) && cod > 0 ? cod : null,
  };
}

export const PREFIXO_INSTANCIA = 'sintonia-';

export class EvolutionAdmin {
  private readonly base: string;
  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly esperar: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.base = baseUrl.replace(/\/$/, '');
  }

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const resp = await this.fetchFn(`${this.base}${caminho}`, {
      method: metodo,
      headers: { apikey: this.apiKey, ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      const erro = new Error(`Evolution respondeu ${resp.status}: ${texto.slice(0, 200)}`) as Error & { status: number };
      erro.status = resp.status;
      throw erro;
    }
    if (!texto) return {} as T;
    try {
      return JSON.parse(texto) as T;
    } catch {
      // Proxy ou página de erro no lugar da Evolution: trata como "sem resposta".
      throw Object.assign(new Error(`Evolution respondeu algo que não é JSON (${resp.status})`), { status: 502 });
    }
  }

  /** Confere URL e chave. */
  async testar(): Promise<{ instancias: number }> {
    const lista = await this.chamar<unknown[]>('GET', '/instance/fetchInstances');
    return { instancias: Array.isArray(lista) ? lista.length : 0 };
  }

  /** Todas as instâncias da Sintonia (nome começa com "sintonia-"), com estado e número. */
  async listar(): Promise<InfoInstancia[]> {
    const lista = await this.chamar<Array<Record<string, unknown>>>('GET', '/instance/fetchInstances');
    return (Array.isArray(lista) ? lista : [])
      .map((i) => lerInfo(String(i.name ?? (i.instance as Record<string, unknown> | undefined)?.instanceName ?? ''), i))
      .filter((i) => i.nome.startsWith(PREFIXO_INSTANCIA));
  }

  /** Apaga a instância da Sintonia na Evolution (sai do WhatsApp antes). */
  async apagar(nome: string): Promise<void> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia podem ser apagadas por aqui');
    await this.chamar('DELETE', `/instance/logout/${encodeURIComponent(nome)}`).catch(() => {});
    await this.chamar('DELETE', `/instance/delete/${encodeURIComponent(nome)}`).catch((e) => {
      if ((e as { status?: number }).status !== 404) throw e;
    });
  }

  async info(nome: string): Promise<InfoInstancia> {
    let lista: Array<Record<string, unknown>>;
    try {
      lista = await this.chamar('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(nome)}`);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return { nome, estado: 'inexistente', numero: null, perfil: null };
      throw e;
    }
    const i = (Array.isArray(lista) ? lista : []).find((x) => (x.name ?? (x.instance as Record<string, unknown> | undefined)?.instanceName) === nome);
    if (!i) return { nome, estado: 'inexistente', numero: null, perfil: null };
    return lerInfo(nome, i);
  }

  /**
   * Cria a instância (se não existir) já apontando o webhook para a Sintonia e devolve o QR Code.
   * Com `numero` (só dígitos, com DDI 55), pede também o código de 8 letras para "Conectar com número de telefone".
   */
  async conectar(nome: string, webhook: { url: string; token: string }, numero?: string): Promise<{ qr: string | null; codigo?: string | null; estado: EstadoInstancia }> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia podem ser conectadas por aqui');
    const atual = await this.info(nome);
    const configWebhook = {
      enabled: true,
      url: webhook.url,
      headers: { 'x-sintonia-token': webhook.token },
      byEvents: false,
      base64: false,
      events: EVENTOS_WEBHOOK,
    };
    if (atual.estado === 'conectada') {
      await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, { webhook: configWebhook }).catch(() => {});
      return { qr: null, estado: 'conectada' };
    }
    if (numero) {
      // A Evolution (v2.3) só pede o código quando a conexão começa do zero com o número:
      // se o canal já estava gerando QR Code, ela ignora o número. Por isso recria a instância.
      if (atual.estado !== 'inexistente') {
        await this.apagar(nome);
        for (let i = 0; i < 20 && (await this.info(nome)).estado !== 'inexistente'; i++) await this.esperar(500);
      }
      const criada = await this.chamar<{ qrcode?: { pairingCode?: string | null } }>('POST', '/instance/create', {
        instanceName: nome,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        number: numero,
        webhook: configWebhook,
      });
      await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, { webhook: configWebhook }).catch(() => {});
      // O código chega uns segundos depois de criar: espera por ele.
      let codigo = criada.qrcode?.pairingCode ?? null;
      for (let i = 0; i < 20 && !codigo; i++) {
        if (i > 0) await this.esperar(1000);
        codigo = await this.codigoAtual(nome).catch(() => null);
      }
      return { qr: null, codigo, estado: 'conectando' };
    }
    if (atual.estado === 'inexistente') {
      const criada = await this.chamar<{ qrcode?: { base64?: string } }>('POST', '/instance/create', {
        instanceName: nome,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: configWebhook,
      });
      // Algumas versões da v2 ignoram o webhook na criação: garante com a rota própria.
      await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, { webhook: configWebhook }).catch(() => {});
      if (criada.qrcode?.base64) return { qr: criada.qrcode.base64, estado: 'conectando' };
    } else {
      await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, { webhook: configWebhook }).catch(() => {});
    }
    const r = await this.chamar<{ base64?: string }>('GET', `/instance/connect/${encodeURIComponent(nome)}`);
    return { qr: r.base64 ?? null, estado: 'conectando' };
  }

  /**
   * Conversas recentes guardadas na Evolution (sem grupos), no formato do webhook: as últimas `porConversa`
   * mensagens de cada uma das `conversas` mais recentes.
   */
  /** Resumo do que a Evolution guarda (diagnóstico da sincronização; sem conteúdo de mensagens). */
  async diagnosticoHistorico(nome: string): Promise<{ chats: number; tipos: Record<string, number>; campos: string[] }> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const chats = await this.chamar<unknown>('POST', `/chat/findChats/${encodeURIComponent(nome)}`, {});
    const lista = (Array.isArray(chats) ? chats : []) as Array<Record<string, unknown>>;
    const tipos: Record<string, number> = {};
    for (const c of lista) { const k = String(c.remoteJid ?? c.id ?? '?').split('@')[1] ?? 'sem'; tipos[k] = (tipos[k] ?? 0) + 1; }
    return { chats: lista.length, tipos, campos: Object.keys(lista[0] ?? (Array.isArray(chats) ? {} : (chats as Record<string, unknown>) ?? {})) };
  }

  async historico(nome: string, o: { conversas?: number; porConversa?: number } = {}): Promise<unknown[]> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const chats = await this.chamar<unknown>('POST', `/chat/findChats/${encodeURIComponent(nome)}`, {});
    const lista = (Array.isArray(chats) ? chats : []) as Array<Record<string, unknown>>;
    const quando = (c: Record<string, unknown>) => new Date(String(c.updatedAt ?? c.lastMessageAt ?? 0)).getTime() || Number((c.lastMessage as Record<string, unknown> | undefined)?.messageTimestamp ?? 0) * 1000;
    const jids = lista
      .filter((c) => typeof c.remoteJid === 'string' && /@(s\.whatsapp\.net|lid)$/.test(c.remoteJid as string))
      .sort((a, b) => quando(b) - quando(a))
      .slice(0, o.conversas ?? 60)
      .map((c) => c.remoteJid as string);
    const saida: unknown[] = [];
    for (const remoteJid of jids) {
      const r = await this.chamar<Record<string, unknown>>('POST', `/chat/findMessages/${encodeURIComponent(nome)}`, { where: { key: { remoteJid } }, page: 1, offset: o.porConversa ?? 15 }).catch(() => null);
      const msgs = (r?.messages as Record<string, unknown> | undefined)?.records ?? r?.records ?? (Array.isArray(r) ? r : []);
      if (Array.isArray(msgs)) saida.push(...msgs);
    }
    return saida;
  }

  /** O código de 8 letras em vigor (a Evolution troca de tempos em tempos enquanto espera). */
  async codigoAtual(nome: string): Promise<string | null> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const r = await this.chamar<{ pairingCode?: string | null }>('GET', `/instance/connect/${encodeURIComponent(nome)}`);
    return r.pairingCode ?? null;
  }

  /**
   * Religa uma instância que caiu, sem número (GET /instance/connect): se a sessão do aparelho ainda vale, volta sozinha.
   * Se o WhatsApp devolve QR Code, a sessão acabou e só a pessoa resolve (lendo o QR Code de novo).
   */
  async reconectar(nome: string): Promise<{ estado: 'conectada' | 'precisa_parear' | 'conectando' | 'inexistente' }> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const antes = await this.info(nome);
    if (antes.estado === 'inexistente') return { estado: 'inexistente' };
    if (antes.estado === 'conectada') return { estado: 'conectada' };
    const r = await this.chamar<Record<string, unknown>>('GET', `/instance/connect/${encodeURIComponent(nome)}`);
    // A Evolution devolve 200 com { error: true } quando algo falha por dentro.
    if (r.error) return { estado: /does not exist|não existe/i.test(String(r.message ?? '')) ? 'inexistente' : 'conectando' };
    if (r.base64 || r.code || r.pairingCode) return { estado: 'precisa_parear' };
    if ((r.instance as Record<string, unknown> | undefined)?.state === 'open') return { estado: 'conectada' };
    await this.esperar(4000);
    const depois = await this.info(nome);
    return { estado: depois.estado === 'conectada' ? 'conectada' : depois.estado === 'inexistente' ? 'inexistente' : 'conectando' };
  }

  /**
   * Instâncias criadas antes de a Sintonia assinar CONNECTION_UPDATE: acrescenta os eventos que faltam,
   * mantendo o endereço e o token do webhook que já estão lá. Devolve true se mudou algo.
   */
  async atualizarEventos(nome: string): Promise<boolean> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) return false;
    const w = await this.chamar<Record<string, unknown> | null>('GET', `/webhook/find/${encodeURIComponent(nome)}`);
    if (!w || typeof w.url !== 'string' || !w.url) return false;
    const atuais = Array.isArray(w.events) ? (w.events as unknown[]).map(String) : [];
    const faltam = EVENTOS_WEBHOOK.filter((e) => !atuais.includes(e));
    if (!faltam.length) return false;
    await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, {
      webhook: {
        enabled: w.enabled !== false,
        url: w.url,
        headers: (w.headers as Record<string, unknown> | undefined) ?? {},
        byEvents: w.webhookByEvents === true,
        base64: w.webhookBase64 === true,
        events: [...atuais, ...faltam],
      },
    });
    return true;
  }

  async desconectar(nome: string): Promise<void> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia podem ser desconectadas por aqui');
    await this.chamar('DELETE', `/instance/logout/${encodeURIComponent(nome)}`);
  }
}
