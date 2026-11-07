import { z } from 'zod';
import type { AnexoRecebido, CanalWhatsApp, EnvioResultado, FotoPerfil, MensagemRecebida, MidiaBaixada, MidiaEnvio } from './tipos.js';
import type { TipoAnexo } from '../domain.js';
import { ErroMidiaGrande, LIMITE_INLINE, LIMITE_MIDIA, tamanhoBase64, textoDoAnexo } from '../midia.js';
import { telefoneDoJid } from '../util/telefone.js';

/**
 * Evolution API (v2), a que já roda no VPS da Império (fluxo "Assia" no n8n).
 * Webhook: evento `messages.upsert`. Envio: POST /message/sendText/{instancia}.
 * Mídia: baixada por POST /chat/getBase64FromMediaMessage/{instancia}; enviada por
 * POST /message/sendMedia/{instancia} (foto, vídeo, documento) e /message/sendWhatsAppAudio/{instancia} (nota de voz).
 */

const MensagemEvolution = z.object({
  key: z.object({
    remoteJid: z.string(),
    fromMe: z.boolean().optional().default(false),
    id: z.string(),
  }),
  pushName: z.string().nullish(),
  // O conteúdo vem no formato do WhatsApp (Baileys); os tipos de mídia são lidos à mão em `lerConteudo`.
  message: z.record(z.string(), z.unknown()).nullish(),
  messageTimestamp: z.union([z.number(), z.string()]).nullish(),
});

const WebhookEvolution = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.union([MensagemEvolution, z.array(MensagemEvolution)]),
});

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** Número que o WhatsApp manda como número, texto ou Long ({ low, high }). */
function numero(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  const o = obj(v);
  if (o && typeof o.low === 'number') return (o.low >>> 0) + (typeof o.high === 'number' ? o.high * 2 ** 32 : 0);
  return undefined;
}

/** Mensagens "embrulhadas" (temporárias, visualização única, documento com legenda): abre até achar o conteúdo. */
const EMBRULHOS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];
function desembrulhar(msg: Obj): Obj {
  let atual = msg;
  for (let i = 0; i < 4; i++) {
    const chave = EMBRULHOS.find((k) => obj(obj(atual[k])?.message));
    if (!chave) break;
    atual = { ...obj(obj(atual[chave])!.message)!, base64: atual.base64 };
  }
  return atual;
}

const TIPOS: Array<[string, TipoAnexo]> = [
  ['imageMessage', 'imagem'],
  ['audioMessage', 'audio'],
  ['videoMessage', 'video'],
  ['documentMessage', 'documento'],
  ['stickerMessage', 'figurinha'],
];

function lerConteudo(bruta: Obj | null | undefined): { texto: string; anexo?: AnexoRecebido } | null {
  if (!bruta) return null;
  const msg = desembrulhar(bruta);
  const t = texto(msg.conversation) ?? texto(obj(msg.extendedTextMessage)?.text);
  if (t) return { texto: t };
  for (const [chave, tipo] of TIPOS) {
    const m = obj(msg[chave]);
    if (!m) continue;
    const legenda = texto(m.caption);
    const nomeArquivo = tipo === 'documento' ? (texto(m.fileName) ?? texto(m.title)) : undefined;
    const base64 = texto(msg.base64);
    const anexo: AnexoRecebido = {
      tipo,
      mimetype: texto(m.mimetype),
      nomeArquivo,
      duracaoSeg: tipo === 'audio' || tipo === 'video' ? numero(m.seconds) : undefined,
      legenda,
      tamanho: numero(m.fileLength),
      voz: tipo === 'audio' ? m.ptt === true : undefined,
      base64: base64 && tamanhoBase64(base64) <= LIMITE_INLINE ? base64 : undefined,
    };
    for (const k of Object.keys(anexo) as Array<keyof AnexoRecebido>) if (anexo[k] === undefined) delete anexo[k];
    // Áudio ainda não é transcrito: o marcador deixa a equipe ver e a IA pedir em texto.
    return { texto: textoDoAnexo(tipo, legenda, nomeArquivo), anexo };
  }
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
    const conteudo = lerConteudo(m.message);
    if (!telefone || !conteudo) continue;
    const ts = Number(m.messageTimestamp ?? 0);
    saida.push({
      canalId: r.data.instance,
      telefone,
      nome: m.key.fromMe ? undefined : (m.pushName ?? undefined),
      texto: conteudo.texto,
      deMim: m.key.fromMe,
      idExterno: m.key.id,
      em: ts ? new Date(ts * 1000) : new Date(),
      ...(conteudo.anexo ? { anexo: conteudo.anexo } : {}),
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

  private url(caminho: string, instancia: string) {
    return `${this.baseUrl.replace(/\/$/, '')}/${caminho}/${encodeURIComponent(instancia)}`;
  }

  private async postar(caminho: string, instancia: string, corpo: unknown, timeoutMs?: number): Promise<Response> {
    return this.fetchFn(this.url(caminho, instancia), {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify(corpo),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  }

  private async idDoEnvio(resp: Response): Promise<EnvioResultado> {
    if (!resp.ok) {
      throw new Error(`Evolution recusou o envio (${resp.status}): ${(await resp.text()).slice(0, 500)}`);
    }
    const json = (await resp.json()) as { key?: { id?: string } };
    return { idExterno: json.key?.id ?? '' };
  }

  async enviarTexto(instancia: string, telefone: string, texto: string): Promise<EnvioResultado> {
    return this.idDoEnvio(await this.postar('message/sendText', instancia, { number: telefone, text: texto }));
  }

  /**
   * Foto, vídeo e documento: sendMedia com o arquivo em base64 (sem o prefixo "data:").
   * Nota de voz: sendWhatsAppAudio (a Evolution converte para o formato do WhatsApp e manda como gravada na hora).
   */
  async enviarMidia(instancia: string, telefone: string, m: MidiaEnvio): Promise<EnvioResultado> {
    const media = m.conteudo.toString('base64');
    if (m.tipo === 'audio') {
      return this.idDoEnvio(await this.postar('message/sendWhatsAppAudio', instancia, { number: telefone, audio: media }, 120_000));
    }
    const mediatype = m.tipo === 'imagem' ? 'image' : m.tipo === 'video' ? 'video' : 'document';
    const corpo: Record<string, unknown> = { number: telefone, mediatype, mimetype: m.mimetype, media };
    if (m.legenda?.trim()) corpo.caption = m.legenda.trim();
    if (m.nomeArquivo) corpo.fileName = m.nomeArquivo;
    return this.idDoEnvio(await this.postar('message/sendMedia', instancia, corpo, 120_000));
  }

  /** Baixa a mídia de uma mensagem já recebida. A Evolution procura a mensagem pelo id no banco dela. */
  async baixarMidia(instancia: string, idExterno: string): Promise<MidiaBaixada> {
    const resp = await this.postar('chat/getBase64FromMediaMessage', instancia, { message: { key: { id: idExterno } }, convertToMp4: false }, 60_000);
    if (!resp.ok) throw new Error(`Evolution não entregou a mídia (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
    const j = (await resp.json()) as { base64?: string; mimetype?: string; fileName?: string };
    if (!j.base64) throw new Error('Evolution respondeu sem o arquivo');
    if (tamanhoBase64(j.base64) > LIMITE_MIDIA) throw new ErroMidiaGrande(tamanhoBase64(j.base64));
    return { conteudo: Buffer.from(j.base64, 'base64'), mimetype: texto(j.mimetype), nomeArquivo: texto(j.fileName) };
  }

  async buscarFoto(instancia: string, telefone: string): Promise<FotoPerfil | null> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/fetchProfilePictureUrl/${encodeURIComponent(instancia)}`;
    const resp = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ number: telefone }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`Evolution recusou a foto (${resp.status})`);
    const { profilePictureUrl } = (await resp.json()) as { profilePictureUrl?: string | null };
    if (!profilePictureUrl) return null;
    const img = await this.fetchFn(profilePictureUrl, { signal: AbortSignal.timeout(10_000) });
    if (!img.ok) throw new Error(`Foto indisponível (${img.status})`);
    const tipo = img.headers.get('content-type') ?? 'image/jpeg';
    if (!tipo.startsWith('image/')) return null;
    const conteudo = Buffer.from(await img.arrayBuffer());
    return conteudo.length > 0 && conteudo.length < 2_000_000 ? { conteudo, tipo } : null;
  }
}
