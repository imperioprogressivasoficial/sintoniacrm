/**
 * Anúncio de clique para WhatsApp (CTWA): o que o WhatsApp manda junto da primeira mensagem de quem
 * tocou no anúncio. Dois formatos:
 * - API oficial (Cloud API): `messages[].referral` = { source_url, source_id, source_type, headline, body,
 *   media_type, image_url, video_url, thumbnail_url, ctwa_clid }.
 * - API não oficial (Evolution v2 / Baileys): `contextInfo.externalAdReply` = { title, body, mediaType,
 *   thumbnailUrl, mediaUrl, sourceType, sourceId, sourceUrl, ctwaClid, sourceApp }, mais
 *   `contextInfo.conversionSource` ("FB_Ads"), `entryPointConversionSource` ("ctwa_ad") e
 *   `entryPointConversionApp` ("instagram" / "facebook"). O contextInfo aparece dentro da mensagem
 *   (extendedTextMessage.contextInfo, imageMessage.contextInfo...) e, na Evolution v2, também em `data.contextInfo`.
 */
export interface ReferenciaAnuncio {
  /** De onde veio a leitura. */
  via: 'meta' | 'evolution';
  /** ad = anúncio; post = publicação impulsionada; outros valores ficam como vieram. */
  tipo?: string;
  /** source_id: na prática o id do anúncio. */
  adId?: string;
  url?: string;
  titulo?: string;
  texto?: string;
  midiaTipo?: string;
  midiaUrl?: string;
  miniaturaUrl?: string;
  ctwaClid?: string;
  /** instagram / facebook / whatsapp, quando o WhatsApp informa. */
  app?: string;
  /** conversionSource / entryPointConversionSource, para depuração. */
  fonteConversao?: string;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const txt = (v: unknown, max = 2000): string | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
};
const url = (v: unknown): string | undefined => {
  const t = txt(v, 2000);
  return t && /^https?:\/\//i.test(t) ? t : undefined;
};

function limpar(r: ReferenciaAnuncio): ReferenciaAnuncio {
  for (const k of Object.keys(r) as Array<keyof ReferenciaAnuncio>) if (r[k] === undefined) delete r[k];
  return r;
}

/** referral da Cloud API. */
export function referenciaDaMeta(referral: unknown): ReferenciaAnuncio | undefined {
  const r = obj(referral);
  if (!r) return undefined;
  const ref: ReferenciaAnuncio = limpar({
    via: 'meta',
    tipo: txt(r.source_type, 40)?.toLowerCase(),
    adId: txt(r.source_id, 60),
    url: url(r.source_url),
    titulo: txt(r.headline, 300),
    texto: txt(r.body, 1000),
    midiaTipo: txt(r.media_type, 20)?.toLowerCase(),
    midiaUrl: url(r.image_url) ?? url(r.video_url),
    miniaturaUrl: url(r.thumbnail_url) ?? url(r.image_url),
    ctwaClid: txt(r.ctwa_clid, 500),
  });
  return ref.adId || ref.ctwaClid || ref.url ? ref : undefined;
}

const TIPO_MIDIA_BAILEYS: Record<string, string> = { '0': 'nenhuma', '1': 'image', '2': 'video', IMAGE: 'image', VIDEO: 'video', NONE: 'nenhuma' };

/** Procura o contextInfo de um anúncio na mensagem do Baileys (e no data.contextInfo da Evolution v2). */
export function referenciaDaEvolution(data: unknown): ReferenciaAnuncio | undefined {
  const d = obj(data);
  if (!d) return undefined;
  const candidatos: Obj[] = [];
  const ver = (v: unknown) => {
    const o = obj(v);
    if (o) candidatos.push(o);
  };
  ver(d.contextInfo);
  const visitar = (m: Obj | undefined, nivel: number) => {
    if (!m || nivel > 4) return;
    for (const [k, v] of Object.entries(m)) {
      const o = obj(v);
      if (!o) continue;
      if (k === 'contextInfo') candidatos.push(o);
      else if (k === 'message' || k.endsWith('Message')) visitar(o, nivel + 1);
    }
  };
  visitar(obj(d.message), 0);
  for (const c of candidatos) {
    const ad = obj(c.externalAdReply);
    const fonte = txt(c.conversionSource, 60) ?? txt(c.entryPointConversionSource, 60);
    const ehAnuncio = Boolean(ad && (txt(ad.sourceId) || txt(ad.ctwaClid) || /ad/i.test(txt(ad.sourceType) ?? '') || ad.showAdAttribution)) || /fb_ads|ctwa/i.test(fonte ?? '');
    if (!ehAnuncio) continue;
    const midia = ad ? (TIPO_MIDIA_BAILEYS[String(ad.mediaType ?? '').toUpperCase()] ?? txt(ad.mediaType, 20)?.toLowerCase()) : undefined;
    const app = txt(c.entryPointConversionApp, 30)?.toLowerCase() ?? txt(ad?.sourceApp, 30)?.toLowerCase();
    return limpar({
      via: 'evolution',
      tipo: txt(ad?.sourceType, 40)?.toLowerCase() ?? 'ad',
      adId: txt(ad?.sourceId, 60),
      url: url(ad?.sourceUrl),
      titulo: txt(ad?.title, 300),
      texto: txt(ad?.body, 1000),
      midiaTipo: midia === 'nenhuma' ? undefined : midia,
      midiaUrl: url(ad?.mediaUrl),
      miniaturaUrl: url(ad?.thumbnailUrl) ?? url(ad?.originalImageUrl),
      ctwaClid: txt(ad?.ctwaClid, 500) ?? txt(c.ctwaClid, 500),
      app,
      fonteConversao: fonte,
    });
  }
  return undefined;
}

// ---------- código do link rastreado na mensagem ----------

/** Alfabeto do código curto (sem 0/O, 1/I/L para ninguém confundir). */
export const ALFABETO_REF = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REF = /\(\s*ref\s*[:：]\s*([A-Za-z0-9]{4,8})\s*\)/;

/** Código "(ref: A7K2X)" que o link rastreado põe no fim da mensagem. */
export function codigoNaMensagem(texto: string): string | undefined {
  return REF.exec(texto)?.[1]?.toUpperCase();
}

/**
 * Tira o "(ref: ...)" do texto que a equipe e a IA veem. Só quando é seguro: o código está sozinho entre
 * parênteses e sobra texto; senão devolve o texto como veio.
 */
export function tirarCodigo(texto: string): string {
  if (!REF.test(texto)) return texto;
  const limpo = texto.replace(REF, '').replace(/[ \t]+\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
  return limpo.length >= 2 ? limpo : texto;
}

/** UTMs e ids de clique de uma URL (ex.: o source_url do anúncio). */
export function parametrosDaUrl(u: string | undefined): Partial<Record<'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term' | 'fbclid' | 'gclid', string>> {
  if (!u) return {};
  try {
    const p = new URL(u).searchParams;
    const saida: Record<string, string> = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid']) {
      const v = p.get(k)?.trim();
      if (v) saida[k] = v.slice(0, 300);
    }
    return saida;
  } catch {
    return {};
  }
}
