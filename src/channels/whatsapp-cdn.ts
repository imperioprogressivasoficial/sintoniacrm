import { createDecipheriv, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Baixa e abre um arquivo do WhatsApp direto do servidor de mídia dele (mmg.whatsapp.net), sem a Evolution.
 * Toda mensagem com foto/áudio/vídeo/documento traz o endereço do arquivo cifrado (url/directPath) e a chave
 * (mediaKey). A chave vira, por HKDF-SHA256, o vetor, a chave AES-256-CBC e a chave do HMAC (padrão do WhatsApp).
 * Motivo (21/11): a Evolution do servidor respondia "Message not found" porque não guarda as mensagens.
 */
const INFO: Record<string, string> = {
  imageMessage: 'WhatsApp Image Keys',
  stickerMessage: 'WhatsApp Image Keys',
  videoMessage: 'WhatsApp Video Keys',
  ptvMessage: 'WhatsApp Video Keys',
  audioMessage: 'WhatsApp Audio Keys',
  documentMessage: 'WhatsApp Document Keys',
};
const EMBRULHOS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

export interface NoMidia { tipo: string; no: Obj }

/** Acha o nó da mídia (imageMessage, audioMessage…) dentro da mensagem, abrindo os "embrulhos". */
export function noDaMidia(message: unknown): NoMidia | null {
  let atual = obj(message);
  for (let i = 0; i < 5 && atual; i++) {
    for (const tipo of Object.keys(INFO)) { const no = obj(atual[tipo]); if (no) return { tipo, no }; }
    const emb = EMBRULHOS.find((k) => obj(obj(atual![k])?.message));
    atual = emb ? obj(obj(atual[emb])!.message) : null;
  }
  return null;
}

/** Chave da mídia: vem em base64 (webhook da Evolution) ou como objeto { "0": n, ... } (Buffer serializado). */
function bytes(v: unknown): Buffer | null {
  if (typeof v === 'string' && v) return Buffer.from(v, 'base64');
  const o = obj(v);
  if (o && Array.isArray(o.data)) return Buffer.from(o.data as number[]);
  if (o) { const k = Object.keys(o).filter((x) => /^\d+$/.test(x)).sort((a, b) => Number(a) - Number(b)); if (k.length) return Buffer.from(k.map((x) => Number(o[x]))); }
  return null;
}

export function abrirMidiaWhatsApp(cifrado: Buffer, mediaKey: Buffer, tipo: string): Buffer {
  const info = INFO[tipo];
  if (!info) throw new Error('Tipo de mídia desconhecido');
  const exp = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(32), Buffer.from(info), 112));
  const iv = exp.subarray(0, 16), chave = exp.subarray(16, 48), chaveMac = exp.subarray(48, 80);
  if (cifrado.length <= 10) throw new Error('Arquivo do WhatsApp vazio');
  const corpo = cifrado.subarray(0, cifrado.length - 10), mac = cifrado.subarray(cifrado.length - 10);
  const esperado = createHmac('sha256', chaveMac).update(iv).update(corpo).digest().subarray(0, 10);
  if (!timingSafeEqual(mac, esperado)) throw new Error('Arquivo do WhatsApp não confere (assinatura)');
  const d = createDecipheriv('aes-256-cbc', chave, iv);
  return Buffer.concat([d.update(corpo), d.final()]);
}

/**
 * Baixa pelo endereço da própria mensagem. `limite` em bytes (cifrado). Lança erro se faltar dado ou o WhatsApp
 * recusar (endereço vencido etc.) — quem chama tenta outro caminho.
 */
export async function baixarDoWhatsApp(message: unknown, o: { limite: number; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<{ conteudo: Buffer; mimetype?: string; nomeArquivo?: string }> {
  const achado = noDaMidia(message);
  if (!achado) throw new Error('Mensagem sem mídia');
  const { tipo, no } = achado;
  const chave = bytes(no.mediaKey);
  if (!chave || chave.length !== 32) throw new Error('Mensagem sem a chave da mídia');
  const direto = typeof no.directPath === 'string' && no.directPath ? `https://mmg.whatsapp.net${no.directPath}` : '';
  const url = typeof no.url === 'string' && /^https:\/\/[a-z0-9.-]+\.whatsapp\.net\//i.test(no.url) ? no.url : direto;
  if (!url || !/^https:\/\/[a-z0-9.-]+\.whatsapp\.net\//i.test(url)) throw new Error('Mensagem sem o endereço da mídia');
  const resp = await (o.fetchFn ?? fetch)(url, { headers: { 'user-agent': 'WhatsApp/2.24 Sintonia', origin: 'https://web.whatsapp.com' }, signal: AbortSignal.timeout(o.timeoutMs ?? 45_000) });
  if (!resp.ok) throw new Error(`WhatsApp não entregou o arquivo (${resp.status})`);
  const tamanho = Number(resp.headers.get('content-length') ?? 0);
  if (tamanho && tamanho > o.limite + 64) throw new Error('Arquivo grande demais');
  const cifrado = Buffer.from(await resp.arrayBuffer());
  if (cifrado.length > o.limite + 64) throw new Error('Arquivo grande demais');
  const conteudo = abrirMidiaWhatsApp(cifrado, chave, tipo);
  const mimetype = typeof no.mimetype === 'string' ? no.mimetype : undefined;
  const nomeArquivo = typeof no.fileName === 'string' ? no.fileName : undefined;
  return { conteudo, ...(mimetype ? { mimetype } : {}), ...(nomeArquivo ? { nomeArquivo } : {}) };
}
