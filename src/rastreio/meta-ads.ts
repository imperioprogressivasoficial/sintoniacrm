import type { InsightAnuncio } from './criativos.js';

/**
 * Leitura da conta de anúncios da Meta (Marketing API), só leitura (permissão ads_read).
 * O token e o id da conta vêm das Conexões (banco), nunca do código.
 */

export interface ContaAnuncios {
  token: string;
  /** Só os números (o "act_" é posto aqui). */
  conta: string;
  versao: string;
}

export class ErroMetaAds extends Error {
  constructor(message: string, readonly codigo?: number) {
    super(message);
  }
}

/** "act_123", "123" ou o endereço do Gerenciador (…act=123…) → "123". */
export function numeroDaConta(entrada: string | undefined): string {
  const t = String(entrada ?? '').trim();
  const doLink = /[?&]act=(\d{5,25})/.exec(t)?.[1];
  if (doLink) return doLink;
  return t.replace(/^act_/i, '').replace(/\D/g, '');
}

/** Explica a recusa da Meta em português simples. */
export function explicarErroMeta(j: { error?: { message?: string; code?: number; error_subcode?: number; type?: string } } | undefined, status: number): string {
  const e = j?.error;
  const c = e?.code;
  if (c === 190) return 'A Meta recusou o token: ele expirou ou foi trocado. Gere um token novo e cole em Conexões › Anúncios da Meta.';
  if (c === 10 || c === 200 || c === 294 || (c !== undefined && c >= 200 && c < 300)) return 'O token não tem permissão para ler esta conta de anúncios (precisa de ads_read e acesso à conta).';
  if (c === 100) return 'A Meta não encontrou essa conta de anúncios. Confira o número (fica no Gerenciador de Anúncios, ao lado do nome da conta).';
  if (c === 4 || c === 17 || c === 32 || c === 613) return 'A Meta pediu para esperar um pouco (limite de consultas). Tente de novo em alguns minutos.';
  if (status === 0) return 'Não deu para falar com a Meta agora (sem resposta). Tente de novo em instantes.';
  return `A Meta recusou${e?.message ? `: ${e.message.slice(0, 200)}` : ` (erro ${status}).`}`;
}

type Fetch = typeof fetch;

async function pedir(url: string, fetchFn: Fetch): Promise<Record<string, unknown>> {
  let r: Response;
  try {
    r = await fetchFn(url, { signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new ErroMetaAds(explicarErroMeta(undefined, 0));
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; code?: number } };
  if (!r.ok || j.error) throw new ErroMetaAds(explicarErroMeta(j, r.status), j.error?.code);
  return j;
}

const base = (c: ContaAnuncios) => `https://graph.facebook.com/${encodeURIComponent(c.versao)}`;
const tok = (c: ContaAnuncios) => `access_token=${encodeURIComponent(c.token)}`;

/** Confere o token e a conta: devolve o nome e a moeda. */
export async function verificarConta(c: ContaAnuncios, fetchFn: Fetch = fetch): Promise<{ nome: string; moeda: string; situacao: number }> {
  if (!/^\d{5,25}$/.test(c.conta)) throw new ErroMetaAds('Número da conta de anúncios inválido. Use só os números (ex.: 123456789012345).');
  const j = await pedir(`${base(c)}/act_${c.conta}?fields=${encodeURIComponent('name,currency,account_status')}&${tok(c)}`, fetchFn);
  return { nome: String(j.name ?? `Conta ${c.conta}`), moeda: String(j.currency ?? 'BRL'), situacao: Number(j.account_status ?? 1) };
}

/** Confere o Dataset (Pixel) da API de Conversões com o token dela. */
export async function verificarDataset(o: { token: string; dataset: string; versao: string }, fetchFn: Fetch = fetch): Promise<{ nome: string }> {
  const j = await pedir(`https://graph.facebook.com/${encodeURIComponent(o.versao)}/${encodeURIComponent(o.dataset)}?fields=name&access_token=${encodeURIComponent(o.token)}`, fetchFn);
  return { nome: String(j.name ?? `Dataset ${o.dataset}`) };
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Gasto, impressões e cliques por anúncio entre duas datas (AAAA-MM-DD, inclusivas), mais a miniatura
 * e o texto de cada criativo. Segue a paginação até 1.000 anúncios.
 */
export async function lerInsights(c: ContaAnuncios, desde: string, ate: string, fetchFn: Fetch = fetch): Promise<InsightAnuncio[]> {
  const campos = 'ad_id,ad_name,adset_name,campaign_id,campaign_name,spend,impressions,inline_link_clicks,clicks';
  let url: string | undefined =
    `${base(c)}/act_${c.conta}/insights?level=ad&fields=${encodeURIComponent(campos)}&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: ate }))}&limit=200&${tok(c)}`;
  const saida: InsightAnuncio[] = [];
  for (let pagina = 0; url && pagina < 5; pagina++) {
    const j = await pedir(url, fetchFn);
    for (const r of (j.data as Array<Record<string, unknown>>) ?? []) {
      if (!r.ad_id) continue;
      saida.push({
        adId: String(r.ad_id),
        adNome: r.ad_name ? String(r.ad_name) : undefined,
        campanhaId: r.campaign_id ? String(r.campaign_id) : undefined,
        campanhaNome: r.campaign_name ? String(r.campaign_name) : undefined,
        conjuntoNome: r.adset_name ? String(r.adset_name) : undefined,
        gasto: n(r.spend),
        impressoes: n(r.impressions),
        cliques: n(r.inline_link_clicks ?? r.clicks),
      });
    }
    const prox = (j.paging as { next?: string } | undefined)?.next;
    url = prox && prox.startsWith('https://graph.facebook.com/') ? prox : undefined;
  }
  // Miniatura e texto do criativo, de 50 em 50 anúncios.
  const ids = [...new Set(saida.map((s) => s.adId))];
  const criativos = new Map<string, { miniatura?: string; titulo?: string; texto?: string }>();
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    try {
      const j = await pedir(`${base(c)}/?ids=${lote.join(',')}&fields=${encodeURIComponent('creative{thumbnail_url,image_url,title,body}')}&${tok(c)}`, fetchFn);
      for (const id of lote) {
        const cr = (j[id] as { creative?: { thumbnail_url?: string; image_url?: string; title?: string; body?: string } } | undefined)?.creative;
        if (!cr) continue;
        const img = [cr.image_url, cr.thumbnail_url].find((u) => typeof u === 'string' && /^https:\/\//i.test(u));
        const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 1000) : undefined);
        criativos.set(id, { miniatura: img, titulo: txt(cr.title), texto: txt(cr.body) });
      }
    } catch {
      // Sem miniatura: os números continuam valendo.
    }
  }
  for (const s of saida) {
    const cr = criativos.get(s.adId);
    if (cr) for (const [k, v] of Object.entries(cr)) if (v) (s as unknown as Record<string, string>)[k] = v;
  }
  return saida;
}
