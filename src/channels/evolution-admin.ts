/**
 * Administração da Evolution API v2: criar a instância de cada loja, mostrar o QR Code,
 * saber se está conectada e desconectar. Usa a chave global da Evolution.
 *
 * Só mexe nas instâncias da própria Sintonia (nomes "sintonia-<unidade>"): nunca altera o webhook de
 * instâncias que já existem para outros fluxos (ex.: a Assia no n8n).
 */

export type EstadoInstancia = 'conectada' | 'conectando' | 'desconectada' | 'inexistente';

export interface InfoInstancia {
  nome: string;
  estado: EstadoInstancia;
  numero: string | null;
  perfil: string | null;
}

export const PREFIXO_INSTANCIA = 'sintonia-';

export class EvolutionAdmin {
  private readonly base: string;
  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
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
    return (texto ? JSON.parse(texto) : {}) as T;
  }

  /** Confere URL e chave. */
  async testar(): Promise<{ instancias: number }> {
    const lista = await this.chamar<unknown[]>('GET', '/instance/fetchInstances');
    return { instancias: Array.isArray(lista) ? lista.length : 0 };
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
    const status = String(i.connectionStatus ?? (i.instance as Record<string, unknown> | undefined)?.status ?? '');
    const dono = String(i.ownerJid ?? (i.instance as Record<string, unknown> | undefined)?.owner ?? '');
    return {
      nome,
      estado: status === 'open' ? 'conectada' : status === 'connecting' ? 'conectando' : 'desconectada',
      numero: dono ? dono.split('@')[0]!.replace(/\D/g, '') || null : null,
      perfil: (i.profileName as string | undefined) ?? null,
    };
  }

  /** Cria a instância (se não existir) já apontando o webhook para a Sintonia, e devolve o QR Code. */
  async conectar(nome: string, webhook: { url: string; token: string }): Promise<{ qr: string | null; estado: EstadoInstancia }> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia podem ser conectadas por aqui');
    const atual = await this.info(nome);
    const configWebhook = {
      enabled: true,
      url: webhook.url,
      headers: { 'x-sintonia-token': webhook.token },
      byEvents: false,
      base64: false,
      // CALL: ligação de voz recebida no número (vira "recebida"/"perdida" na tela Ligações).
      events: ['MESSAGES_UPSERT', 'CALL'],
    };
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
      if (atual.estado === 'conectada') return { qr: null, estado: 'conectada' };
    }
    const r = await this.chamar<{ base64?: string }>('GET', `/instance/connect/${encodeURIComponent(nome)}`);
    return { qr: r.base64 ?? null, estado: 'conectando' };
  }

  async desconectar(nome: string): Promise<void> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia podem ser desconectadas por aqui');
    await this.chamar('DELETE', `/instance/logout/${encodeURIComponent(nome)}`);
  }
}
