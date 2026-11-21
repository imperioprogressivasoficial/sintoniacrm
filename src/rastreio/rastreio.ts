import { randomInt, randomUUID } from 'node:crypto';
import type { MensagemRecebida } from '../channels/tipos.js';
import type { Conversa } from '../domain.js';
import type { ArmazemRastreio, Clique, LinkRastreado, NomesAnuncio, Origem } from './armazem.js';
import type { Capi } from './capi.js';
import { ALFABETO_REF, codigoNaMensagem, parametrosDaUrl, tirarCodigo } from './referencia.js';

export interface DependenciasRastreio {
  armazem: ArmazemRastreio;
  empresaId: string;
  capi?: Capi;
  /** Token que lê os nomes dos anúncios na Graph API (ads_read) e a versão da Graph API. */
  graph?: () => { token?: string; versao: string };
  agora?: () => Date;
  fetchFn?: typeof fetch;
  log?: (msg: string, extra?: unknown) => void;
}

/** Ícone da origem, ao lado do nome do lead. */
export const ICONES = ['instagram', 'facebook', 'whatsapp', 'google_ads', 'indicacao', 'estabelecimento', 'desconhecido'] as const;
export type IconeOrigem = (typeof ICONES)[number];

/**
 * Ícone pela origem detectada. Prioridade: anúncio/UTM > link rastreado > IA pela conversa > desconhecido.
 * Anúncio da Meta: Instagram quando o posicionamento/endereço/utm_source diz Instagram, senão Facebook.
 */
export function iconeDe(o: Origem | undefined): IconeOrigem {
  if (!o) return 'desconhecido';
  const pistas = [o.fonte, o.utmSource, o.anuncioUrl].filter(Boolean).join(' ').toLowerCase();
  const google = Boolean(o.gclid) || /\bgoogle|adwords|gads\b/.test(pistas);
  if (o.canal === 'anuncio_meta') return /instagram|\big\b/.test(pistas) ? 'instagram' : 'facebook';
  if (o.canal === 'link') {
    if (google) return 'google_ads';
    if (/instagram|\big\b/.test(pistas)) return 'instagram';
    if (/facebook|\bfb\b|\bmeta\b/.test(pistas)) return 'facebook';
    if (/whatsapp/.test(pistas)) return 'whatsapp';
    return 'desconhecido';
  }
  if (o.canal === 'indicacao') return 'indicacao';
  if (o.canal === 'organico' || o.canal === 'outro') {
    if (/loja|fachada|estabelecimento|passou/.test(pistas)) return 'estabelecimento';
    if (/instagram/.test(pistas)) return 'instagram';
    if (/facebook/.test(pistas)) return 'facebook';
    if (google) return 'google_ads';
    if (o.canal === 'organico') return 'whatsapp';
  }
  return 'desconhecido';
}

/** Selo curto para o cartão e a lista. */
export interface Selo {
  icone: IconeOrigem;
  canal: Origem['canal'];
  rotulo: string;
  campanha?: string;
  fonte?: string;
}

const primeiraMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FONTES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', google: 'Google', tiktok: 'TikTok', loja: 'Passou na loja', site: 'Site', whatsapp: 'WhatsApp' };
export const nomeFonte = (f?: string) => (f ? (FONTES[f.toLowerCase()] ?? primeiraMaiuscula(f)) : undefined);

export function seloDe(o: Origem): Selo {
  const campanha = o.campaignNome ?? o.utmCampaign;
  let rotulo: string;
  if (o.canal === 'anuncio_meta') rotulo = `Anúncio${campanha ? ` · ${campanha}` : o.anuncioTitulo ? ` · ${o.anuncioTitulo}` : ''}`;
  else if (o.canal === 'link') rotulo = `Link${o.detalhe ? ` · ${o.detalhe}` : ''}`;
  else if (o.canal === 'indicacao') rotulo = 'Indicação';
  else if (o.canal === 'organico') rotulo = nomeFonte(o.fonte) ?? 'Orgânico';
  else rotulo = o.detalhe ?? nomeFonte(o.fonte) ?? 'Outro';
  return { icone: iconeDe(o), canal: o.canal, rotulo: rotulo.slice(0, 60), ...(campanha ? { campanha } : {}), ...(o.fonte ? { fonte: o.fonte } : {}) };
}

/** Rede de onde veio o anúncio, pelo app informado ou pelo endereço. */
function redeDoAnuncio(app?: string, url?: string): string | undefined {
  if (app) return app.toLowerCase();
  if (url && /instagram/i.test(url)) return 'instagram';
  if (url && /(facebook|fb\.me|fb\.com)/i.test(url)) return 'facebook';
  return undefined;
}

/**
 * Origem dos leads: lê o anúncio (referral/externalAdReply) e o código do link rastreado de cada mensagem
 * da cliente, grava o primeiro toque (fixo) e o último, liga o clique à conversa, busca os nomes do anúncio
 * na Graph API em segundo plano e avisa a CAPI (Lead).
 */
export class Rastreio {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly buscandoNomes = new Map<string, Promise<void>>();

  constructor(readonly d: DependenciasRastreio) {
    this.agora = d.agora ?? (() => new Date());
    this.log = d.log ?? (() => {});
  }

  get armazem() {
    return this.d.armazem;
  }

  /** Texto que fica na conversa: sem o "(ref: XXXXX)" do link rastreado. */
  textoParaGuardar(msg: MensagemRecebida): string {
    return msg.deMim ? msg.texto : tirarCodigo(msg.texto);
  }

  /** Mensagem nova da cliente (já gravada). Nunca deve atrasar o atendimento: só grava no banco. */
  async aoMensagem(c: Conversa, msg: MensagemRecebida): Promise<Origem | undefined> {
    if (msg.deMim) return undefined;
    const codigo = codigoNaMensagem(msg.texto);
    const clique = codigo ? await this.d.armazem.cliquePorRef(codigo) : undefined;
    const link = clique ? await this.d.armazem.link(this.d.empresaId, clique.linkId) : undefined;
    const ref = msg.referencia;
    if (!ref && !clique) {
      // Messenger / Instagram Direct / TikTok sem anúncio: a própria rede é a origem (orgânico), só no primeiro toque.
      if (!msg.rede) return undefined;
      const org: Origem = { canal: 'organico', fonte: msg.rede, origemPor: 'automatico', em: msg.em, primeiraMensagem: tirarCodigo(msg.texto).slice(0, 500) };
      await this.d.armazem.gravarOrigem(c.id, 'primeiro', org, 'sobre_ia');
      return org;
    }

    const o: Origem = { canal: ref ? 'anuncio_meta' : 'link', origemPor: 'automatico', em: msg.em, primeiraMensagem: tirarCodigo(msg.texto).slice(0, 500) };
    if (clique && link) {
      Object.assign(o, {
        linkId: link.id,
        cliqueId: clique.id,
        codigo: clique.ref,
        detalhe: link.nome,
        fonte: clique.utmSource ?? link.utmSource,
        utmSource: clique.utmSource,
        utmMedium: clique.utmMedium,
        utmCampaign: clique.utmCampaign,
        utmContent: clique.utmContent,
        utmTerm: clique.utmTerm,
        fbclid: clique.fbclid,
        gclid: clique.gclid,
      });
    }
    if (ref) {
      const daUrl = parametrosDaUrl(ref.url);
      Object.assign(o, {
        fonte: msg.rede ?? redeDoAnuncio(ref.app, ref.url) ?? o.fonte ?? 'meta',
        adId: ref.adId,
        anuncioTipo: ref.tipo,
        anuncioUrl: ref.url,
        anuncioTitulo: ref.titulo,
        anuncioTexto: ref.texto,
        anuncioMidiaTipo: ref.midiaTipo,
        anuncioMidiaUrl: ref.midiaUrl,
        anuncioMiniatura: ref.miniaturaUrl,
        ctwaClid: ref.ctwaClid,
        utmSource: o.utmSource ?? daUrl.utm_source,
        utmMedium: o.utmMedium ?? daUrl.utm_medium,
        utmCampaign: o.utmCampaign ?? daUrl.utm_campaign,
        utmContent: o.utmContent ?? daUrl.utm_content,
        utmTerm: o.utmTerm ?? daUrl.utm_term,
        fbclid: o.fbclid ?? daUrl.fbclid,
      });
      if (ref.adId) {
        const nomes = await this.d.armazem.anuncio(ref.adId);
        if (nomes && !nomes.erro) Object.assign(o, { adNome: nomes.adNome, adsetId: nomes.adsetId, adsetNome: nomes.adsetNome, campaignId: nomes.campaignId, campaignNome: nomes.campaignNome });
      }
    }
    for (const k of Object.keys(o) as Array<keyof Origem>) if (o[k] === undefined) delete o[k];

    // Primeiro toque: fixo (só troca um palpite da IA). Último toque: sempre o mais recente.
    const primeiro = await this.d.armazem.gravarOrigem(c.id, 'primeiro', o, 'sobre_ia');
    await this.d.armazem.gravarOrigem(c.id, 'ultimo', o, 'substituir');
    if (clique) await this.d.armazem.ligarClique(clique.id, c.id);
    if (o.adId && !o.adNome) void this.buscarNomes(o.adId);
    if (primeiro) await this.d.capi?.gerar(c.id, 'lead').catch((e) => this.log('Falha ao gerar o Lead da CAPI', String(e)));
    return o;
  }

  // ---------- nomes do anúncio (Graph API) ----------

  /** Busca nome do anúncio, do conjunto e da campanha (com cache). Em segundo plano; nunca lança. */
  buscarNomes(adId: string): Promise<void> {
    const ja = this.buscandoNomes.get(adId);
    if (ja) return ja;
    const p = this.buscarNomesAgora(adId)
      .catch((e) => this.log('Falha ao buscar nomes do anúncio', String(e)))
      .finally(() => this.buscandoNomes.delete(adId));
    this.buscandoNomes.set(adId, p);
    return p;
  }

  private async buscarNomesAgora(adId: string): Promise<void> {
    if (!/^\d{5,25}$/.test(adId)) return;
    const cache = await this.d.armazem.anuncio(adId);
    const agora = this.agora();
    if (cache && !cache.erro) {
      await this.d.armazem.aplicarNomes(adId, cache);
      return;
    }
    if (cache?.erro && agora.getTime() - cache.atualizadoEm.getTime() < 3600_000) return;
    const g = this.d.graph?.();
    if (!g?.token) return;
    const url = `https://graph.facebook.com/${encodeURIComponent(g.versao)}/${adId}?fields=${encodeURIComponent('name,adset{id,name},campaign{id,name}')}&access_token=${encodeURIComponent(g.token)}`;
    const r = await (this.d.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { name?: string; adset?: { id?: string; name?: string }; campaign?: { id?: string; name?: string }; error?: { message?: string } };
    if (!r.ok || j.error) {
      await this.d.armazem.gravarAnuncio(adId, { erro: (j.error?.message ?? `status ${r.status}`).slice(0, 300), atualizadoEm: agora });
      return;
    }
    const n: NomesAnuncio = { adNome: j.name, adsetId: j.adset?.id, adsetNome: j.adset?.name, campaignId: j.campaign?.id, campaignNome: j.campaign?.name, atualizadoEm: agora };
    await this.d.armazem.gravarAnuncio(adId, n);
    await this.d.armazem.aplicarNomes(adId, n);
  }

  /** Relógio: tenta de novo os nomes que faltam. */
  async tick(): Promise<void> {
    for (const id of await this.d.armazem.anunciosSemNome(5)) await this.buscarNomes(id);
  }

  // ---------- links rastreados ----------

  /** Clique em /l/:codigo: grava e devolve o endereço do wa.me com o código curto. undefined = link não existe/desligado. */
  async clicar(codigo: string, q: Record<string, string | undefined>, extra: { userAgent?: string; referencia?: string; gravar: boolean }): Promise<string | undefined> {
    const link = await this.d.armazem.linkPorCodigo(codigo);
    if (!link || !link.ativo) return undefined;
    const curto = (v: string | undefined, max = 300) => (v && v.trim() ? v.trim().slice(0, max) : undefined);
    if (!extra.gravar) return urlWhatsApp(link);
    for (let i = 0; i < 6; i++) {
      const ref = Array.from({ length: 5 }, () => ALFABETO_REF[randomInt(ALFABETO_REF.length)]).join('');
      const clique: Clique = {
        id: randomUUID(),
        linkId: link.id,
        ref,
        // UTMs do próprio endereço (/l/x?utm_campaign=...) valem por cima das do link.
        utmSource: curto(q.utm_source) ?? link.utmSource,
        utmMedium: curto(q.utm_medium) ?? link.utmMedium,
        utmCampaign: curto(q.utm_campaign) ?? link.utmCampaign,
        utmContent: curto(q.utm_content) ?? link.utmContent,
        utmTerm: curto(q.utm_term) ?? link.utmTerm,
        fbclid: curto(q.fbclid, 500),
        gclid: curto(q.gclid, 500),
        userAgent: curto(extra.userAgent, 400),
        referencia: curto(extra.referencia, 500),
        em: this.agora(),
      };
      for (const k of Object.keys(clique) as Array<keyof Clique>) if (clique[k] === undefined) delete clique[k];
      if (await this.d.armazem.gravarClique(clique)) return urlWhatsApp(link, ref);
    }
    return urlWhatsApp(link);
  }

  async selos(ids?: string[]): Promise<Record<string, Selo>> {
    const m = await this.d.armazem.primeiros(ids);
    return Object.fromEntries([...m].map(([id, o]) => [id, seloDe(o)]));
  }
}

export function urlWhatsApp(link: Pick<LinkRastreado, 'numero' | 'mensagem'>, ref?: string): string {
  const texto = ref ? `${link.mensagem} (ref: ${ref})` : link.mensagem;
  return `https://wa.me/${link.numero.replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`;
}
