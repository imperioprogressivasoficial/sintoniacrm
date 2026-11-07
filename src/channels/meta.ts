import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { CanalWhatsApp, EnvioResultado, MensagemRecebida } from './tipos.js';
import { normalizarCelular } from '../util/telefone.js';
import { textoDoAnexo } from '../midia.js';

/**
 * WhatsApp Cloud API (oficial da Meta). Pronto para a Fase 3.
 * `canalId` aqui é o phone_number_id do número na Meta.
 */
const VERSAO_GRAPH = 'v21.0';

const WebhookMeta = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }),
            contacts: z
              .array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().nullish() }).nullish() }))
              .nullish(),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.string(),
                  text: z.object({ body: z.string() }).nullish(),
                  image: z.object({ caption: z.string().nullish() }).passthrough().nullish(),
                  video: z.object({ caption: z.string().nullish() }).passthrough().nullish(),
                  document: z.object({ caption: z.string().nullish(), filename: z.string().nullish() }).passthrough().nullish(),
                  button: z.object({ text: z.string() }).nullish(),
                  interactive: z
                    .object({
                      button_reply: z.object({ title: z.string() }).nullish(),
                      list_reply: z.object({ title: z.string() }).nullish(),
                    })
                    .nullish(),
                }),
              )
              .nullish(),
          }),
        }),
      ),
    }),
  ),
});

/**
 * Mídia da API oficial: por enquanto vira só o marcador de texto (a IA e a equipe sabem que chegou algo).
 * TODO(Fase 3): baixar pelo id da mídia (GET /{media-id} → url → download com o token) e preencher `anexo`,
 * como na Evolution; e implementar `enviarMidia` (upload em /{phone-number-id}/media).
 */
function midiaComoTexto(m: {
  type: string;
  image?: { caption?: string | null } | null;
  video?: { caption?: string | null } | null;
  document?: { caption?: string | null; filename?: string | null } | null;
}): string | null {
  if (m.type === 'audio') return textoDoAnexo('audio');
  if (m.type === 'image') return textoDoAnexo('imagem', m.image?.caption ?? undefined);
  if (m.type === 'video') return textoDoAnexo('video', m.video?.caption ?? undefined);
  if (m.type === 'document') return textoDoAnexo('documento', m.document?.caption ?? undefined, m.document?.filename ?? undefined);
  if (m.type === 'sticker') return textoDoAnexo('figurinha');
  return null;
}

export function lerWebhookMeta(corpo: unknown): MensagemRecebida[] {
  const r = WebhookMeta.safeParse(corpo);
  if (!r.success) return [];
  const saida: MensagemRecebida[] = [];
  for (const entry of r.data.entry) {
    for (const change of entry.changes) {
      const v = change.value;
      for (const m of v.messages ?? []) {
        const texto =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          midiaComoTexto(m);
        const telefone = normalizarCelular(m.from);
        if (!texto || !telefone) continue;
        const contato = v.contacts?.find((c) => c.wa_id === m.from);
        saida.push({
          canalId: v.metadata.phone_number_id,
          telefone,
          nome: contato?.profile?.name ?? undefined,
          texto,
          deMim: false,
          idExterno: m.id,
          em: new Date(Number(m.timestamp) * 1000),
        });
      }
    }
  }
  return saida;
}

/** Confere a assinatura X-Hub-Signature-256 que a Meta manda em cada webhook. */
export function assinaturaMetaValida(corpoBruto: string, assinatura: string | undefined, appSecret: string): boolean {
  if (!assinatura?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', appSecret).update(corpoBruto).digest('hex');
  const a = Buffer.from(assinatura.slice(7), 'hex');
  const b = Buffer.from(esperado, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class CanalMeta implements CanalWhatsApp {
  readonly tipo = 'meta' as const;

  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  lerWebhook(corpo: unknown): MensagemRecebida[] {
    return lerWebhookMeta(corpo);
  }

  /**
   * Texto livre só funciona até 24h depois da última mensagem da cliente.
   * Fora dessa janela é preciso um modelo aprovado (lembretes, campanhas) — Fase 3.
   */
  async enviarTexto(phoneNumberId: string, telefone: string, texto: string): Promise<EnvioResultado> {
    const resp = await this.fetchFn(`https://graph.facebook.com/${VERSAO_GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: telefone, type: 'text', text: { body: texto } }),
    });
    if (!resp.ok) throw new Error(`Meta recusou o envio (${resp.status}): ${await resp.text()}`);
    const json = (await resp.json()) as { messages?: Array<{ id?: string }> };
    return { idExterno: json.messages?.[0]?.id ?? '' };
  }
}
