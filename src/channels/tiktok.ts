import { createHmac, timingSafeEqual } from 'node:crypto';
import { normalizarCelular } from '../util/telefone.js';
import type { CanalWhatsApp, EnvioResultado } from './tipos.js';

/**
 * TikTok — esqueleto (ver docs/CANAIS.md).
 *
 * - Mensagens diretas (Business Messaging API): existem, mas o acesso é por aprovação do TikTok (parceiros /
 *   "Acesso Avançado", conta ligada ao TikTok for Business ou Business Center), com janela de 48 h, até 10 mensagens
 *   por janela e a conversa sempre começa pela pessoa. Não é autosserviço; por isso o canal fica preparado e recusa o envio.
 * - Leads (Lead Generation / formulário instantâneo): o Gerenciador de Anúncios do TikTok envia cada lead para uma URL de
 *   webhook (integração "Custom API with Webhooks"). Isto já funciona aqui: /webhook/tiktok lê o lead e entrega para a Sintonia.
 */
export const DM_TIKTOK_INDISPONIVEL =
  'Mensagens diretas do TikTok dependem de aprovação do TikTok (Business Messaging API para parceiros). Por enquanto a Sintonia só recebe os leads dos formulários do TikTok.';

export class CanalTikTok implements CanalWhatsApp {
  readonly tipo = 'tiktok' as const;
  lerWebhook(): never[] {
    return [];
  }
  async enviarTexto(): Promise<EnvioResultado> {
    throw Object.assign(new Error(DM_TIKTOK_INDISPONIVEL), { statusCode: 422 });
  }
}

/** Lead de formulário instantâneo do TikTok. */
export interface LeadTikTok {
  leadId: string;
  nome?: string;
  telefone?: string;
  email?: string;
  adId?: string;
  campanhaId?: string;
  formularioId?: string;
  em: Date;
  /** Todas as respostas do formulário (pergunta → resposta). */
  respostas: Record<string, string>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

/** Respostas do formulário: aceita lista [{name|field_name|question, value|answer}] ou objeto chave → valor. */
function respostasDe(o: Obj): Record<string, string> {
  const r: Record<string, string> = {};
  for (const chave of ['field_data', 'fields', 'answers', 'lead_data', 'user_info']) {
    const v = o[chave];
    if (Array.isArray(v)) {
      for (const it of v) {
        const x = obj(it);
        const nome = str(x?.name) ?? str(x?.field_name) ?? str(x?.question) ?? str(x?.key);
        const valor = Array.isArray(x?.values) ? (x!.values as unknown[]).map(str).filter(Boolean).join(', ') : (str(x?.value) ?? str(x?.answer));
        if (nome && valor) r[nome.toLowerCase()] = valor;
      }
    } else if (obj(v)) {
      for (const [k, val] of Object.entries(obj(v)!)) if (str(val)) r[k.toLowerCase()] = str(val)!;
    }
  }
  return r;
}

const achar = (r: Record<string, string>, ...padroes: RegExp[]) => Object.entries(r).find(([k]) => padroes.some((p) => p.test(k)))?.[1];

/**
 * Lê os leads do corpo do webhook. O formato exato do TikTok varia por integração; esta leitura é tolerante:
 * aceita um lead solto, `{ leads: [...] }`, `{ data: [...] }` ou `{ entry: [...] }`.
 */
export function lerLeadsTikTok(corpo: unknown): LeadTikTok[] {
  const c = obj(corpo);
  if (!c) return [];
  const lista: unknown[] = Array.isArray(c.leads) ? c.leads : Array.isArray(c.data) ? c.data : Array.isArray(c.entry) ? c.entry : obj(c.data) ? [c.data] : [c];
  const saida: LeadTikTok[] = [];
  for (const it of lista) {
    const l = obj(it);
    if (!l) continue;
    const leadId = str(l.lead_id) ?? str(l.leadId) ?? str(l.id);
    if (!leadId) continue;
    const respostas = respostasDe(l);
    const tel = achar(respostas, /phone|telefone|celular|whatsapp/);
    const ts = Number(l.create_time ?? l.created_time ?? l.timestamp);
    const lead: LeadTikTok = { leadId, em: Number.isFinite(ts) && ts > 0 ? new Date(ts < 1e12 ? ts * 1000 : ts) : new Date(), respostas };
    const nome = achar(respostas, /^name$|full_name|nome/);
    if (nome) lead.nome = nome;
    const celular = tel ? normalizarCelular(tel) : undefined;
    if (celular) lead.telefone = celular;
    const email = achar(respostas, /e-?mail/);
    if (email) lead.email = email;
    for (const [campo, chaves] of [
      ['adId', ['ad_id', 'adId']],
      ['campanhaId', ['campaign_id', 'campaignId']],
      ['formularioId', ['form_id', 'page_id', 'formId']],
    ] as const) {
      const v = chaves.map((k) => str(l[k])).find(Boolean);
      if (v) lead[campo] = v;
    }
    saida.push(lead);
  }
  return saida;
}

/**
 * Assinatura dos webhooks do TikTok for Developers: cabeçalho `TikTok-Signature: t=<timestamp>,s=<hex>`,
 * onde s = HMAC-SHA256(client_secret, `${t}.${corpo}`).
 */
export function assinaturaTikTokValida(corpoBruto: string, cabecalho: string | undefined, segredo: string, agoraSeg = Math.floor(Date.now() / 1000)): boolean {
  if (!cabecalho || !segredo) return false;
  const partes = Object.fromEntries(cabecalho.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = partes.t;
  const s = partes.s;
  if (!t || !s || Math.abs(agoraSeg - Number(t)) > 300) return false;
  const esperado = createHmac('sha256', segredo).update(`${t}.${corpoBruto}`).digest('hex');
  const a = Buffer.from(s, 'hex');
  const b = Buffer.from(esperado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
