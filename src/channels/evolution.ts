import { z } from 'zod';
import type { CanalWhatsApp, EnvioResultado, MensagemRecebida } from './tipos.js';
import { telefoneDoJid } from '../util/telefone.js';

/**
 * Evolution API (v2), a que já roda no VPS da Império (fluxo "Assia" no n8n).
 * Webhook: evento `messages.upsert`. Envio: POST /message/sendText/{instancia}.
 */

const MensagemEvolution = z.object({
  key: z.object({
    remoteJid: z.string(),
    fromMe: z.boolean().optional().default(false),
    id: z.string(),
  }),
  pushName: z.string().nullish(),
  message: z
    .object({
      conversation: z.string().nullish(),
      extendedTextMessage: z.object({ text: z.string().nullish() }).nullish(),
      imageMessage: z.object({ caption: z.string().nullish() }).nullish(),
      videoMessage: z.object({ caption: z.string().nullish() }).nullish(),
      audioMessage: z.unknown().nullish(),
    })
    .passthrough()
    .nullish(),
  messageTimestamp: z.union([z.number(), z.string()]).nullish(),
});

const WebhookEvolution = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.union([MensagemEvolution, z.array(MensagemEvolution)]),
});

function textoDa(m: z.infer<typeof MensagemEvolution>): string | null {
  const msg = m.message;
  if (!msg) return null;
  const t =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    null;
  if (t) return t;
  // Áudio ainda não é transcrito: registra para a equipe ver e a IA pedir em texto.
  if (msg.audioMessage) return '[áudio]';
  if (msg.imageMessage) return '[foto]';
  return null;
}

export function lerWebhookEvolution(corpo: unknown): MensagemRecebida[] {
  const r = WebhookEvolution.safeParse(corpo);
  if (!r.success) return [];
  const evento = r.data.event.toLowerCase().replace(/_/g, '.');
  if (evento !== 'messages.upsert') return [];
  const lista = Array.isArray(r.data.data) ? r.data.data : [r.data.data];
  const saida: MensagemRecebida[] = [];
  for (const m of lista) {
    const telefone = telefoneDoJid(m.key.remoteJid);
    const texto = textoDa(m);
    if (!telefone || !texto) continue;
    const ts = Number(m.messageTimestamp ?? 0);
    saida.push({
      canalId: r.data.instance,
      telefone,
      nome: m.key.fromMe ? undefined : (m.pushName ?? undefined),
      texto,
      deMim: m.key.fromMe,
      idExterno: m.key.id,
      em: ts ? new Date(ts * 1000) : new Date(),
    });
  }
  return saida;
}

export class CanalEvolution implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  lerWebhook(corpo: unknown): MensagemRecebida[] {
    return lerWebhookEvolution(corpo);
  }

  async enviarTexto(instancia: string, telefone: string, texto: string): Promise<EnvioResultado> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instancia)}`;
    const resp = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ number: telefone, text: texto }),
    });
    if (!resp.ok) {
      throw new Error(`Evolution recusou o envio (${resp.status}): ${await resp.text()}`);
    }
    const json = (await resp.json()) as { key?: { id?: string } };
    return { idExterno: json.key?.id ?? '' };
  }
}
