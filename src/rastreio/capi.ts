import { createHash } from 'node:crypto';
import type { Conversa } from '../domain.js';
import type { Evento } from '../store/repositorio.js';
import type { ArmazemRastreio, EventoCapi, Origem } from './armazem.js';

/**
 * API de Conversões da Meta (CAPI). Cada mudança de etapa vira um evento na fila (tabela capi_eventos),
 * com event_id fixo por conversa + etapa (a Meta descarta repetidos e a fila também não duplica).
 * O envio acontece fora do atendimento, com novas tentativas; nada se perde num reinício.
 *
 * - Anúncio de clique para WhatsApp (com ctwa_clid): action_source "business_messaging",
 *   messaging_channel "whatsapp", user_data { whatsapp_business_account_id, ctwa_clid }.
 * - Link rastreado (ou anúncio sem ctwa_clid): action_source "system_generated", com telefone e e-mail em SHA-256
 *   (normalizados como a Meta pede), external_id em hash, fbc (do fbclid) e o user-agent do clique.
 */

export interface RegraEvento {
  ligado: boolean;
  /** Nome para links / sistema (website, system_generated). Ex.: Lead, Schedule, Purchase. */
  site: string;
  /** Nome para anúncio de clique para WhatsApp (só os aceitos pela Meta). Vazio = manda pelo caminho do telefone. */
  mensagem: string;
}
export interface MapaEventos {
  lead: RegraEvento;
  qualificado: RegraEvento;
  agendada: RegraEvento;
  compareceu: RegraEvento;
  /** Eventos personalizados: quando o cartão entra nesta etapa de um funil. */
  etapas: Array<{ etapaId: string; nome: string; ligado: boolean }>;
}

export const EVENTOS_MENSAGEM = ['Purchase', 'LeadSubmitted', 'InitiateCheckout', 'AddToCart', 'ViewContent', 'OrderCreated', 'OrderShipped', 'OrderDelivered', 'OrderCanceled', 'OrderReturned', 'CartAbandoned', 'QualifiedLead', 'RatingProvided', 'ReviewProvided'] as const;

export const MAPA_PADRAO: MapaEventos = {
  lead: { ligado: true, site: 'Lead', mensagem: 'LeadSubmitted' },
  qualificado: { ligado: true, site: 'QualifiedLead', mensagem: 'QualifiedLead' },
  agendada: { ligado: true, site: 'Schedule', mensagem: 'OrderCreated' },
  compareceu: { ligado: true, site: 'Purchase', mensagem: 'Purchase' },
  etapas: [],
};

export interface ConfigCapi {
  ligado: boolean;
  datasetId?: string;
  token?: string;
  testeCodigo?: string;
  versao: string;
  wabaId?: string;
  pageId?: string;
  valorPadrao?: number;
  eventos: MapaEventos;
}

export const VERSAO_PADRAO = 'v27.0';

export function lerMapa(json: string | undefined): MapaEventos {
  try {
    const j = JSON.parse(json || '{}') as Partial<MapaEventos>;
    const regra = (k: 'lead' | 'qualificado' | 'agendada' | 'compareceu'): RegraEvento => ({ ...MAPA_PADRAO[k], ...(j[k] ?? {}) });
    return {
      lead: regra('lead'),
      qualificado: regra('qualificado'),
      agendada: regra('agendada'),
      compareceu: regra('compareceu'),
      etapas: Array.isArray(j.etapas) ? j.etapas.filter((e) => e && typeof e.etapaId === 'string' && typeof e.nome === 'string') : [],
    };
  } catch {
    return structuredClone(MAPA_PADRAO);
  }
}

// ---------- normalização e hash (padrão da Meta) ----------
export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** Telefone: só dígitos, com DDI (55), sem zeros à esquerda. */
export function normalizarTelefone(t: string): string {
  let d = t.replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
export const normalizarEmail = (e: string) => e.trim().toLowerCase();

export interface DependenciasCapi {
  armazem: ArmazemRastreio;
  config: () => ConfigCapi;
  buscarConversa: (id: string) => Promise<Conversa | undefined>;
  /** E-mail e valor do serviço (campo da ficha), quando houver. */
  ficha?: (c: Conversa) => Promise<{ email?: string; valor?: number }>;
  /** WABA da unidade (API oficial), quando a CAPI não tem uma própria. */
  wabaDaUnidade?: (unidade: string) => string | undefined;
  agora?: () => Date;
  fetchFn?: typeof fetch;
  log?: (msg: string, extra?: unknown) => void;
}

const ESPERAS_MIN = [1, 5, 30, 120, 360];
const MAX_TENTATIVAS = 6;

export type ChaveCapi = 'lead' | 'qualificado' | 'agendada' | 'compareceu';
const ETAPA_PARA_CHAVE: Record<string, ChaveCapi> = { interessada: 'qualificado', agendada: 'agendada', compareceu: 'compareceu' };

export class Capi {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private enviando: Promise<void> | null = null;

  constructor(private readonly d: DependenciasCapi) {
    this.agora = d.agora ?? (() => new Date());
    this.log = d.log ?? (() => {});
  }

  private pronto(): ConfigCapi | undefined {
    const c = this.d.config();
    return c.ligado && c.datasetId && c.token ? c : undefined;
  }

  /** Observa os eventos do sistema (repo.registrarEvento). Nunca lança. */
  aoEvento(e: Evento): void {
    if (!e.conversaId || !this.pronto()) return;
    let tarefa: Promise<unknown> | undefined;
    if (e.tipo === 'etapa_mudou') {
      const chave = ETAPA_PARA_CHAVE[String(e.dados?.para ?? '')];
      if (chave) tarefa = this.gerar(e.conversaId, chave);
    } else if (e.tipo === 'etapa_movida' && typeof e.dados?.para === 'string') {
      const regra = this.d.config().eventos.etapas.find((x) => x.ligado && x.etapaId === e.dados!.para);
      if (regra) tarefa = this.gerar(e.conversaId, `etapa:${regra.etapaId}`, { site: regra.nome, mensagem: (EVENTOS_MENSAGEM as readonly string[]).includes(regra.nome) ? regra.nome : '', ligado: true });
    }
    tarefa?.catch((x) => this.log('Falha ao gerar evento da CAPI', String(x)));
  }

  /**
   * Gera (e põe na fila) o evento de uma conversa vinda de anúncio ou link rastreado.
   * Devolve o evento enfileirado, ou undefined (desligado, sem origem rastreada, regra desligada ou já enviado).
   */
  async gerar(conversaId: string, chave: ChaveCapi | `etapa:${string}`, regraExtra?: RegraEvento): Promise<EventoCapi['payload'] | undefined> {
    const cfg = this.pronto();
    if (!cfg) return undefined;
    const regra = regraExtra ?? cfg.eventos[chave as ChaveCapi];
    if (!regra?.ligado) return undefined;
    const { primeiro, ultimo } = await this.d.armazem.origem(conversaId);
    const o = primeiro && (primeiro.canal === 'anuncio_meta' || primeiro.canal === 'link') ? primeiro : undefined;
    if (!o) return undefined;
    const c = await this.d.buscarConversa(conversaId);
    if (!c) return undefined;
    const ficha = (await this.d.ficha?.(c).catch(() => undefined)) ?? {};
    const payload = this.montar(cfg, regra, chave, c, o, ultimo, ficha);
    if (!payload) return undefined;
    const novo = await this.d.armazem.enfileirarCapi({
      eventId: String(payload.event_id),
      conversaId,
      nome: String(payload.event_name),
      chave,
      payload,
      proximaEm: this.agora(),
      teste: false,
    });
    if (!novo) return undefined;
    this.avisar();
    return payload;
  }

  /** Monta o evento no formato da Meta. */
  montar(cfg: ConfigCapi, regra: RegraEvento, chave: string, c: Conversa, o: Origem, ultimo: Origem | undefined, ficha: { email?: string; valor?: number }): Record<string, unknown> | undefined {
    const ctwa = (ultimo?.canal === 'anuncio_meta' && ultimo.ctwaClid) || o.ctwaClid;
    const waba = cfg.wabaId || this.d.wabaDaUnidade?.(c.unidade);
    const evento: Record<string, unknown> = {
      event_time: Math.floor(this.agora().getTime() / 1000),
      event_id: `sintonia-${chave}-${c.id}`,
    };
    if (ctwa && waba && regra.mensagem) {
      evento.event_name = regra.mensagem;
      evento.action_source = 'business_messaging';
      evento.messaging_channel = 'whatsapp';
      evento.user_data = { whatsapp_business_account_id: waba, ctwa_clid: ctwa, ...(cfg.pageId ? { page_id: cfg.pageId } : {}) };
    } else {
      if (!regra.site) return undefined;
      evento.event_name = regra.site;
      evento.action_source = 'system_generated';
      const ud: Record<string, unknown> = {
        ph: [sha256(normalizarTelefone(c.telefone))],
        external_id: [sha256(c.id)],
      };
      if (ficha.email) ud.em = [sha256(normalizarEmail(ficha.email))];
      if (o.fbclid) ud.fbc = `fb.1.${o.em.getTime()}.${o.fbclid}`;
      evento.user_data = ud;
    }
    if (chave === 'compareceu') {
      const valor = ficha.valor ?? cfg.valorPadrao;
      evento.custom_data = { currency: 'BRL', ...(valor !== undefined ? { value: valor } : {}) };
    } else if (chave === 'lead' || chave === 'qualificado' || chave === 'agendada' || chave.startsWith('etapa:')) {
      const camp = o.campaignNome ?? o.utmCampaign;
      if (camp) evento.custom_data = { ...(evento.custom_data as object), content_name: camp };
    }
    return evento;
  }

  private avisar() {
    if (this.enviando) return;
    this.enviando = this.tick()
      .then(() => undefined)
      .catch((e) => this.log('Falha ao enviar eventos da CAPI', String(e)))
      .finally(() => {
        this.enviando = null;
      });
  }

  /** Espera os envios em andamento (testes). */
  async ocioso(): Promise<void> {
    while (this.enviando) await this.enviando;
  }

  /** Envia o que venceu. Chamado pelo relógio e logo depois de enfileirar. */
  async tick(): Promise<number> {
    const cfg = this.pronto();
    if (!cfg) return 0;
    let n = 0;
    for (const e of await this.d.armazem.reivindicarCapi(this.agora(), 20, 120_000)) {
      await this.enviar(cfg, e);
      n++;
    }
    return n;
  }

  private async enviar(cfg: ConfigCapi, e: EventoCapi): Promise<void> {
    const url = `https://graph.facebook.com/${encodeURIComponent(cfg.versao)}/${encodeURIComponent(cfg.datasetId!)}/events?access_token=${encodeURIComponent(cfg.token!)}`;
    const corpo: Record<string, unknown> = { data: [e.payload] };
    if (cfg.testeCodigo) corpo.test_event_code = cfg.testeCodigo;
    let status = 0;
    let texto = '';
    try {
      const r = await (this.d.fetchFn ?? fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(20_000) });
      status = r.status;
      texto = (await r.text().catch(() => '')).slice(0, 1500);
    } catch (x) {
      texto = `sem resposta: ${String((x as Error).message ?? x)}`.slice(0, 500);
    }
    const agora = this.agora();
    if (status >= 200 && status < 300) {
      await this.d.armazem.concluirCapi(e.id, { situacao: 'enviado', resposta: texto || String(status), enviadoEm: agora });
      return;
    }
    const resposta = status ? `${status}: ${texto}` : texto;
    // Recusa da Meta (dados errados, token sem permissão): não adianta repetir. Rede, 429 ou 5xx: tenta de novo.
    const repetir = !status || status === 429 || status >= 500;
    if (!repetir) {
      await this.d.armazem.concluirCapi(e.id, { situacao: 'erro', resposta });
      return;
    }
    if (e.tentativas >= MAX_TENTATIVAS) {
      await this.d.armazem.concluirCapi(e.id, { situacao: 'desistiu', resposta });
      return;
    }
    const espera = ESPERAS_MIN[Math.min(e.tentativas - 1, ESPERAS_MIN.length - 1)]!;
    await this.d.armazem.concluirCapi(e.id, { situacao: 'pendente', resposta, proximaEm: new Date(agora.getTime() + espera * 60_000) });
  }

  /** Botão "Enviar evento de teste": um Lead fictício com o código de teste do Gerenciador de Eventos. */
  async enviarTeste(): Promise<EventoCapi> {
    const cfg = this.d.config();
    if (!cfg.datasetId || !cfg.token) throw Object.assign(new Error('Preencha o Dataset (Pixel) ID e o token de acesso.'), { statusCode: 400 });
    if (!cfg.testeCodigo) throw Object.assign(new Error('Preencha o código de evento de teste (Gerenciador de Eventos › Eventos de teste) para não misturar com os dados reais.'), { statusCode: 400 });
    const agora = this.agora();
    const payload = {
      event_name: cfg.eventos.lead.site || 'Lead',
      event_time: Math.floor(agora.getTime() / 1000),
      event_id: `sintonia-teste-${agora.getTime()}`,
      action_source: 'system_generated',
      user_data: { ph: [sha256('5571900000000')], external_id: [sha256('sintonia-teste')] },
      custom_data: { content_name: 'Teste da Sintonia' },
    };
    await this.d.armazem.enfileirarCapi({ eventId: payload.event_id, nome: payload.event_name, chave: 'teste', payload, proximaEm: new Date(0), teste: true });
    const [e] = (await this.d.armazem.eventosCapi(20)).filter((x) => x.eventId === payload.event_id);
    // Envia agora mesmo se a CAPI estiver desligada (o teste vale para conferir a configuração).
    const reivindicados = await this.d.armazem.reivindicarCapi(agora, 50, 120_000);
    const alvo = reivindicados.find((x) => x.eventId === payload.event_id) ?? e!;
    await this.enviar({ ...cfg, testeCodigo: cfg.testeCodigo }, alvo);
    // Os outros que vieram junto voltam para a fila normal.
    for (const x of reivindicados) if (x.id !== alvo.id) await this.d.armazem.concluirCapi(x.id, { situacao: 'pendente', resposta: x.resposta ?? '', proximaEm: agora });
    return (await this.d.armazem.eventosCapi(50)).find((x) => x.id === alvo.id)!;
  }
}
