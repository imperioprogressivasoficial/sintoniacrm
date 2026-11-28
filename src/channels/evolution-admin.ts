import { telefoneDoJid } from '../util/telefone.js';

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
  // MESSAGES_UPDATE: vistos das mensagens da loja (✓ saiu, ✓✓ entregue, ✓✓ azul lida, áudio ouvido).
  'MESSAGES_UPDATE',
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

/** Grupo do WhatsApp como a Evolution descreve. */
export interface InfoGrupo {
  jid: string;
  nome: string | null;
  participantes: number | null;
  fotoUrl: string | null;
}

function lerGrupo(g: Record<string, unknown>): InfoGrupo | null {
  const jid = typeof g.id === 'string' ? g.id : typeof g.jid === 'string' ? g.jid : '';
  if (!jid.endsWith('@g.us')) return null;
  const size = Number(g.size ?? (Array.isArray(g.participants) ? g.participants.length : NaN));
  const nome = typeof g.subject === 'string' && g.subject.trim() ? g.subject.trim() : null;
  const foto = typeof g.pictureUrl === 'string' && /^https:\/\//.test(g.pictureUrl) ? g.pictureUrl : null;
  return { jid, nome, participantes: Number.isFinite(size) && size > 0 ? size : null, fotoUrl: foto };
}

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

  private async chamar<T>(metodo: string, caminho: string, corpo?: unknown, timeoutMs = 15_000): Promise<T> {
    const resp = await this.fetchFn(`${this.base}${caminho}`, {
      method: metodo,
      headers: { apikey: this.apiKey, ...(corpo ? { 'content-type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
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
      // O arquivo (foto, áudio, documento) vem junto no webhook: não depende de baixar depois da Evolution.
      base64: true,
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
        // Conversas de grupo: os grupos do WhatsApp chegam à Sintonia (tela própria, sem IA nem funil).
        groupsIgnore: false,
        // Ao conectar, o celular manda TODO o histórico de conversas (sem isso, só um pouco do recente). Dono 23/11.
        syncFullHistory: true,
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
        // Conversas de grupo: os grupos do WhatsApp chegam à Sintonia (tela própria, sem IA nem funil).
        groupsIgnore: false,
        syncFullHistory: true,
        webhook: configWebhook,
      });
      // Algumas versões da v2 ignoram o webhook na criação: garante com a rota própria.
      await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, { webhook: configWebhook }).catch(() => {});
      if (criada.qrcode?.base64) return { qr: criada.qrcode.base64, estado: 'conectando' };
    } else {
      await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, { webhook: configWebhook }).catch(() => {});
      await this.historicoCompleto(nome).catch(() => {});
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

  /**
   * Resgate de UMA conversa: as últimas mensagens guardadas na Evolution para esse telefone, procurando pelo número
   * (com e sem o 9 do celular brasileiro) e pelos códigos "@lid" que o WhatsApp usa no lugar do número.
   */
  async mensagensDoContato(nome: string, telefone: string, quantas = 200): Promise<unknown[]> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const dig = telefone.replace(/\D/g, '');
    const variantes = new Set([dig]);
    const br = /^55(\d{2})(\d{8,9})$/.exec(dig);
    if (br && br[1] && br[2]) { const ddd = br[1]; const n = br[2]; variantes.add(n.length === 9 && n.startsWith('9') ? `55${ddd}${n.slice(1)}` : `55${ddd}9${n}`); }
    const jids = new Set([...variantes].map((v) => `${v}@s.whatsapp.net`));
    const chats = await this.chamar<unknown>('POST', `/chat/findChats/${encodeURIComponent(nome)}`, {}, 60_000).catch(() => []);
    for (const c of (Array.isArray(chats) ? chats : []) as Array<Record<string, unknown>>) {
      const jid = typeof c.remoteJid === 'string' ? c.remoteJid : '';
      if (!jid.endsWith('@lid')) continue;
      const k = ((c.lastMessage as Record<string, unknown> | undefined)?.key ?? {}) as Record<string, unknown>;
      const alt = String(k.remoteJidAlt ?? k.senderPn ?? c.remoteJidAlt ?? '').replace(/\D/g, '');
      if (alt && variantes.has(alt)) jids.add(jid);
    }
    const saida: unknown[] = [];
    for (const remoteJid of jids) {
      const r = await this.chamar<Record<string, unknown>>('POST', `/chat/findMessages/${encodeURIComponent(nome)}`, { where: { key: { remoteJid } }, page: 1, offset: quantas }, 30_000).catch(() => null);
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
    // Também liga o arquivo junto no webhook (base64), se estiver desligado.
    if (!faltam.length && w.webhookBase64 === true) return false;
    await this.chamar('POST', `/webhook/set/${encodeURIComponent(nome)}`, {
      webhook: {
        enabled: w.enabled !== false,
        url: w.url,
        headers: (w.headers as Record<string, unknown> | undefined) ?? {},
        byEvents: w.webhookByEvents === true,
        base64: true,
        events: [...atuais, ...faltam],
      },
    });
    return true;
  }

  /** Liga "trazer todo o histórico" (syncFullHistory) mantendo as outras opções. Vale na próxima vez que o celular conectar. */
  async historicoCompleto(nome: string): Promise<void> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const atual = await this.chamar<Record<string, unknown> | null>('GET', `/settings/find/${encodeURIComponent(nome)}`);
    if (atual?.syncFullHistory === true) return;
    const campos = ['rejectCall', 'msgCall', 'groupsIgnore', 'alwaysOnline', 'readMessages', 'readStatus', 'wavoipToken'];
    const corpo: Record<string, unknown> = { syncFullHistory: true };
    for (const k of campos) if (atual && atual[k] !== undefined && atual[k] !== null) corpo[k] = atual[k];
    corpo.rejectCall ??= false;
    corpo.groupsIgnore ??= false;
    corpo.alwaysOnline ??= false;
    corpo.readMessages ??= false;
    corpo.readStatus ??= false;
    await this.chamar('POST', `/settings/set/${encodeURIComponent(nome)}`, corpo);
  }

  /**
   * Conversas de grupo: se a instância está com "ignorar grupos" ligado, desliga, mantendo as outras opções.
   * Só muda a configuração (POST /settings/set): o WhatsApp continua conectado, sem QR Code de novo.
   */
  async liberarGrupos(nome: string): Promise<'liberado' | 'ja_liberado'> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const atual = await this.chamar<Record<string, unknown> | null>('GET', `/settings/find/${encodeURIComponent(nome)}`);
    if (!atual || atual.groupsIgnore !== true) return 'ja_liberado';
    const campos = ['rejectCall', 'msgCall', 'alwaysOnline', 'readMessages', 'readStatus', 'syncFullHistory', 'wavoipToken'];
    const corpo: Record<string, unknown> = { groupsIgnore: false };
    for (const k of campos) if (atual[k] !== undefined && atual[k] !== null) corpo[k] = atual[k];
    // A Evolution exige estes campos no /settings/set.
    corpo.rejectCall ??= false;
    corpo.alwaysOnline ??= false;
    corpo.readMessages ??= false;
    corpo.readStatus ??= false;
    corpo.syncFullHistory ??= false;
    await this.chamar('POST', `/settings/set/${encodeURIComponent(nome)}`, corpo);
    return 'liberado';
  }

  /** Nome, quantas pessoas e a foto de um grupo (GET /group/findGroupInfos). */
  async infoGrupo(nome: string, jid: string): Promise<InfoGrupo | null> {
    const r = await this.chamar<Record<string, unknown>>('GET', `/group/findGroupInfos/${encodeURIComponent(nome)}?groupJid=${encodeURIComponent(jid)}`).catch((e) => {
      if ((e as { status?: number }).status === 404 || (e as { status?: number }).status === 400) return null;
      throw e;
    });
    return r ? lerGrupo(r) : null;
  }

  /**
   * Todos os grupos em que o número está, arquivados ou não (GET /group/fetchAllGroups, sem a lista de pessoas).
   * Demora com muitos grupos (a Evolution busca a foto de um por um): espera até 3 minutos.
   */
  async listarGrupos(nome: string): Promise<InfoGrupo[]> {
    const r = await this.chamar<unknown>('GET', `/group/fetchAllGroups/${encodeURIComponent(nome)}?getParticipants=false`, undefined, 180_000);
    return (Array.isArray(r) ? r : []).map((g) => lerGrupo(g as Record<string, unknown>)).filter((g): g is InfoGrupo => Boolean(g));
  }

  /**
   * contato-nome: nome do perfil (pushName) de cada contato do número, por telefone (só dígitos, com 55 e o 9).
   * Lê POST /chat/findContacts (os contatos) e POST /chat/findChats (para achar o número dos contatos "@lid",
   * que vem na última mensagem como remoteJidAlt/senderPn). O nome volta como veio: quem usa limpa e confere.
   */
  async nomesDeContatos(nome: string, timeoutMs = 60_000): Promise<Map<string, string>> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const inst = encodeURIComponent(nome);
    const contatos = await this.chamar<unknown>('POST', `/chat/findContacts/${inst}`, { where: {} }, timeoutMs);
    const chats = await this.chamar<unknown>('POST', `/chat/findChats/${inst}`, {}, timeoutMs).catch(() => []);
    const texto = (v: unknown) => (typeof v === 'string' ? v : '');
    const telDe = (jid: string) => {
      if (!jid || jid.endsWith('@lid')) return null;
      return telefoneDoJid(jid.includes('@') ? jid : `${jid}@s.whatsapp.net`);
    };
    // "@lid" → número, pelas conversas.
    const doLid = new Map<string, string>();
    const listaChats = (Array.isArray(chats) ? chats : []) as Array<Record<string, unknown>>;
    for (const c of listaChats) {
      const jid = texto(c.remoteJid);
      if (!jid.endsWith('@lid')) continue;
      const k = ((c.lastMessage as Record<string, unknown> | undefined)?.key ?? {}) as Record<string, unknown>;
      const tel = telDe(texto(k.remoteJidAlt) || texto(k.senderPn) || texto(c.remoteJidAlt));
      if (tel) doLid.set(jid, tel);
    }
    const saida = new Map<string, string>();
    const por = (r: Record<string, unknown>, nomeBruto: unknown) => {
      const n = texto(nomeBruto).trim();
      if (!n || !/\p{L}/u.test(n)) return; // sem letra (número, pontos, emojis): não é nome
      const jid = texto(r.remoteJid) || texto(r.id);
      const alt = texto(r.remoteJidAlt) || texto(r.senderPn) || texto(r.phoneNumber) || texto(r.jidAlt);
      const tel = (jid.endsWith('@lid') ? (telDe(alt) ?? doLid.get(jid)) : telDe(jid)) ?? null;
      if (tel && !saida.has(tel)) saida.set(tel, n);
    };
    for (const c of (Array.isArray(contatos) ? contatos : []) as Array<Record<string, unknown>>) por(c, c.pushName);
    // Conversa sem contato salvo: o nome que a Evolution guardou na conversa (só pessoas, nunca grupo).
    for (const c of listaChats) if (!texto(c.remoteJid).endsWith('@g.us')) por(c, c.pushName);
    return saida;
  }

  /**
   * puxar-historico: uma página das mensagens que a Evolution guardou desse número (POST /chat/findMessages), das mais
   * novas para as mais antigas. Volta os registros como vieram (o mesmo formato do webhook) e quantas páginas há.
   */
  async paginaDeMensagens(nome: string, pagina: number, porPagina = 500): Promise<{ registros: unknown[]; paginas: number; total: number }> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const r = await this.chamar<Record<string, unknown>>('POST', `/chat/findMessages/${encodeURIComponent(nome)}`, { where: {}, page: pagina, offset: porPagina }, 120_000);
    const caixa = (r?.messages && typeof r.messages === 'object' ? r.messages : r) as Record<string, unknown>;
    const registros = Array.isArray(caixa?.records) ? caixa.records : Array.isArray(r) ? (r as unknown[]) : [];
    const paginas = Number(caixa?.pages ?? 0) || (registros.length >= porPagina ? pagina + 1 : pagina);
    return { registros, paginas, total: Number(caixa?.total ?? registros.length) || registros.length };
  }

  /**
   * puxar-historico: "@lid" → JID do número (5571...@s.whatsapp.net), pelas conversas (última mensagem) e pelos
   * contatos que a Evolution guardou. Serve para não perder as conversas de quem o WhatsApp mostra só pelo código.
   */
  async mapaLid(nome: string): Promise<Map<string, string>> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const inst = encodeURIComponent(nome);
    const [chats, contatos] = await Promise.all([
      this.chamar<unknown>('POST', `/chat/findChats/${inst}`, {}, 120_000).catch(() => []),
      this.chamar<unknown>('POST', `/chat/findContacts/${inst}`, { where: {} }, 120_000).catch(() => []),
    ]);
    const t = (v: unknown) => (typeof v === 'string' ? v : '');
    const pn = (v: string) => { const d = v.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? ''; return d.length >= 8 ? `${d}@s.whatsapp.net` : ''; };
    const mapa = new Map<string, string>();
    for (const c of (Array.isArray(chats) ? chats : []) as Array<Record<string, unknown>>) {
      const jid = t(c.remoteJid);
      if (!jid.endsWith('@lid')) continue;
      const k = ((c.lastMessage as Record<string, unknown> | undefined)?.key ?? {}) as Record<string, unknown>;
      const alt = pn(t(k.remoteJidAlt) || t(k.senderPn) || t(c.remoteJidAlt));
      if (alt) mapa.set(jid, alt);
    }
    for (const c of (Array.isArray(contatos) ? contatos : []) as Array<Record<string, unknown>>) {
      const jid = t(c.remoteJid) || t(c.id);
      const lid = jid.endsWith('@lid') ? jid : t(c.lid);
      const num = jid.endsWith('@s.whatsapp.net') ? jid : pn(t(c.remoteJidAlt) || t(c.senderPn) || t(c.phoneNumber) || t(c.jidAlt));
      if (lid.endsWith('@lid') && num && !mapa.has(lid)) mapa.set(lid, num);
    }
    return mapa;
  }

  /** Grupos que têm conversa guardada na Evolution (POST /chat/findChats, só "@g.us"): rápido, só jid e nome. */
  async chatsDeGrupo(nome: string): Promise<Array<{ jid: string; nome: string | null }>> {
    const chats = await this.chamar<unknown>('POST', `/chat/findChats/${encodeURIComponent(nome)}`, {}, 60_000);
    const lista = (Array.isArray(chats) ? chats : []) as Array<Record<string, unknown>>;
    const saida = new Map<string, string | null>();
    for (const c of lista) {
      const jid = typeof c.remoteJid === 'string' ? c.remoteJid : '';
      if (!jid.endsWith('@g.us')) continue;
      const n = typeof c.pushName === 'string' && c.pushName.trim() && !c.pushName.includes('@') ? c.pushName.trim() : typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null;
      if (!saida.has(jid) || (n && !saida.get(jid))) saida.set(jid, n);
    }
    return [...saida].map(([jid, n]) => ({ jid, nome: n }));
  }

  /** As últimas `quantas` mensagens de um grupo guardadas na Evolution (formato do webhook). */
  async mensagensDoGrupo(nome: string, jid: string, quantas = 50): Promise<unknown[]> {
    const r = await this.chamar<Record<string, unknown>>('POST', `/chat/findMessages/${encodeURIComponent(nome)}`, { where: { key: { remoteJid: jid } }, page: 1, offset: quantas }, 30_000);
    const msgs = (r?.messages as Record<string, unknown> | undefined)?.records ?? r?.records ?? (Array.isArray(r) ? r : []);
    return Array.isArray(msgs) ? msgs : [];
  }

  /**
   * Arquiva (ou desarquiva) a conversa no WhatsApp do celular (POST /chat/archiveChat). A Evolution precisa ter
   * alguma mensagem dessa conversa guardada; sem ela, recusa (e a Sintonia arquiva só do lado dela).
   */
  async arquivarConversa(nome: string, jid: string, arquivar: boolean): Promise<void> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    await this.chamar('POST', `/chat/archiveChat/${encodeURIComponent(nome)}`, { chat: jid, archive: arquivar }, 20_000);
  }

  /** Mensagens recentes dos grupos guardadas na Evolution (formato do webhook): os `grupos` mais recentes. */
  async historicoGrupos(nome: string, o: { grupos?: number; porGrupo?: number } = {}): Promise<unknown[]> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia por aqui');
    const chats = await this.chamar<unknown>('POST', `/chat/findChats/${encodeURIComponent(nome)}`, {});
    const lista = (Array.isArray(chats) ? chats : []) as Array<Record<string, unknown>>;
    const quando = (c: Record<string, unknown>) => new Date(String(c.updatedAt ?? c.lastMessageAt ?? 0)).getTime() || Number((c.lastMessage as Record<string, unknown> | undefined)?.messageTimestamp ?? 0) * 1000;
    const jids = lista
      .filter((c) => typeof c.remoteJid === 'string' && (c.remoteJid as string).endsWith('@g.us'))
      .sort((a, b) => quando(b) - quando(a))
      .slice(0, o.grupos ?? 30)
      .map((c) => c.remoteJid as string);
    const saida: unknown[] = [];
    for (const remoteJid of jids) {
      const r = await this.chamar<Record<string, unknown>>('POST', `/chat/findMessages/${encodeURIComponent(nome)}`, { where: { key: { remoteJid } }, page: 1, offset: o.porGrupo ?? 20 }).catch(() => null);
      const msgs = (r?.messages as Record<string, unknown> | undefined)?.records ?? r?.records ?? (Array.isArray(r) ? r : []);
      if (Array.isArray(msgs)) saida.push(...msgs);
    }
    return saida;
  }

  async desconectar(nome: string): Promise<void> {
    if (!nome.startsWith(PREFIXO_INSTANCIA)) throw new Error('Só instâncias da Sintonia podem ser desconectadas por aqui');
    await this.chamar('DELETE', `/instance/logout/${encodeURIComponent(nome)}`);
  }
}
