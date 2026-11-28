import { randomUUID } from 'node:crypto';
import type pg from 'pg';

/** De onde a cliente veio. */
export const CANAIS = ['anuncio_meta', 'link', 'organico', 'indicacao', 'outro'] as const;
export type CanalOrigem = (typeof CANAIS)[number];
export type Toque = 'primeiro' | 'ultimo';
export type OrigemPor = 'automatico' | 'ia' | 'equipe';

export interface Origem {
  canal: CanalOrigem;
  /** instagram, facebook, google, tiktok, loja, site... (texto livre curto). */
  fonte?: string;
  origemPor: OrigemPor;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  campaignId?: string;
  campaignNome?: string;
  adsetId?: string;
  adsetNome?: string;
  adId?: string;
  adNome?: string;
  anuncioTitulo?: string;
  anuncioTexto?: string;
  anuncioMidiaTipo?: string;
  anuncioMidiaUrl?: string;
  anuncioMiniatura?: string;
  anuncioUrl?: string;
  anuncioTipo?: string;
  ctwaClid?: string;
  fbclid?: string;
  gclid?: string;
  linkId?: string;
  cliqueId?: string;
  codigo?: string;
  indicadoPor?: string;
  detalhe?: string;
  primeiraMensagem?: string;
  em: Date;
  atualizadoEm?: Date;
}

/** Coluna no banco ↔ campo. */
const COLUNAS: Array<[keyof Origem, string]> = [
  ['canal', 'canal'], ['fonte', 'fonte'], ['origemPor', 'origem_por'],
  ['utmSource', 'utm_source'], ['utmMedium', 'utm_medium'], ['utmCampaign', 'utm_campaign'], ['utmContent', 'utm_content'], ['utmTerm', 'utm_term'],
  ['campaignId', 'campaign_id'], ['campaignNome', 'campaign_nome'], ['adsetId', 'adset_id'], ['adsetNome', 'adset_nome'], ['adId', 'ad_id'], ['adNome', 'ad_nome'],
  ['anuncioTitulo', 'anuncio_titulo'], ['anuncioTexto', 'anuncio_texto'], ['anuncioMidiaTipo', 'anuncio_midia_tipo'], ['anuncioMidiaUrl', 'anuncio_midia_url'],
  ['anuncioMiniatura', 'anuncio_miniatura'], ['anuncioUrl', 'anuncio_url'], ['anuncioTipo', 'anuncio_tipo'],
  ['ctwaClid', 'ctwa_clid'], ['fbclid', 'fbclid'], ['gclid', 'gclid'], ['linkId', 'link_id'], ['cliqueId', 'clique_id'], ['codigo', 'codigo'],
  ['indicadoPor', 'indicado_por'], ['detalhe', 'detalhe'], ['primeiraMensagem', 'primeira_mensagem'], ['em', 'em'],
];

export interface LinkRastreado {
  id: string;
  codigo: string;
  nome: string;
  unidade: string;
  numero: string;
  mensagem: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  ativo: boolean;
  criadoPor?: string;
  criadoEm: Date;
}

export interface Clique {
  id: string;
  linkId: string;
  ref: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  fbclid?: string;
  gclid?: string;
  userAgent?: string;
  referencia?: string;
  em: Date;
  conversaId?: string;
}

export interface NomesAnuncio {
  adNome?: string;
  adsetId?: string;
  adsetNome?: string;
  campaignId?: string;
  campaignNome?: string;
  erro?: string;
  atualizadoEm: Date;
}

export type SituacaoCapi = 'pendente' | 'enviado' | 'erro' | 'desistiu';
export interface EventoCapi {
  id: number;
  eventId: string;
  conversaId?: string;
  nome: string;
  chave: string;
  payload: Record<string, unknown>;
  situacao: SituacaoCapi;
  tentativas: number;
  proximaEm: Date;
  resposta?: string;
  teste: boolean;
  criadoEm: Date;
  enviadoEm?: Date;
}

/** Como gravar o toque: só se não houver; trocando um palpite da IA; ou sempre. */
export type ModoGravar = 'se_vazio' | 'sobre_ia' | 'substituir';

export interface ArmazemRastreio {
  origem(conversaId: string): Promise<{ primeiro?: Origem; ultimo?: Origem }>;
  /** Devolve true se gravou. */
  gravarOrigem(conversaId: string, toque: Toque, o: Origem, modo: ModoGravar): Promise<boolean>;
  /** Primeiro toque das conversas (selos e filtros). */
  primeiros(conversaIds?: string[]): Promise<Map<string, Origem>>;
  /** Põe os nomes nas origens que só têm o id do anúncio. */
  aplicarNomes(adId: string, n: NomesAnuncio): Promise<void>;
  anuncio(adId: string): Promise<NomesAnuncio | undefined>;
  gravarAnuncio(adId: string, n: NomesAnuncio): Promise<void>;
  /** ad_ids das origens ainda sem nome (para tentar de novo). */
  anunciosSemNome(limite: number): Promise<string[]>;

  listarLinks(empresaId: string): Promise<Array<LinkRastreado & { cliques: number; leads: number }>>;
  link(empresaId: string, id: string): Promise<LinkRastreado | undefined>;
  linkPorCodigo(codigo: string): Promise<LinkRastreado | undefined>;
  criarLink(empresaId: string, l: Omit<LinkRastreado, 'id' | 'criadoEm'>): Promise<LinkRastreado>;
  alterarLink(empresaId: string, id: string, l: Partial<Pick<LinkRastreado, 'nome' | 'ativo' | 'mensagem' | 'numero'>>): Promise<LinkRastreado | undefined>;
  /** Grava o clique; false se o ref já existia (sorteia outro). */
  gravarClique(c: Clique): Promise<boolean>;
  cliquePorRef(ref: string): Promise<Clique | undefined>;
  ligarClique(cliqueId: string, conversaId: string): Promise<void>;

  /** Análise da IA: "reserva" a conversa (só uma vez). true = é a primeira vez. */
  reservarAnaliseIa(conversaId: string): Promise<boolean>;
  concluirAnaliseIa(conversaId: string, situacao: 'feita' | 'erro', resultado?: unknown): Promise<void>;
  analisesPendentes(antesDe: Date, limite: number): Promise<string[]>;

  /** Põe na fila; false se o event_id já existia (não duplica). */
  enfileirarCapi(e: Omit<EventoCapi, 'id' | 'situacao' | 'tentativas' | 'criadoEm' | 'enviadoEm' | 'resposta'>): Promise<boolean>;
  /** Pendentes vencidos, já reservados por `reservaMs`. */
  reivindicarCapi(agora: Date, limite: number, reservaMs: number): Promise<EventoCapi[]>;
  concluirCapi(id: number, r: { situacao: SituacaoCapi; resposta: string; proximaEm?: Date; enviadoEm?: Date }): Promise<void>;
  reenviarCapi(id: number, agora: Date): Promise<boolean>;
  eventosCapi(limite: number): Promise<EventoCapi[]>;
}

const sem = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k];
  return o;
};

// ---------------------------------------------------------------- memória

export class ArmazemRastreioMemoria implements ArmazemRastreio {
  readonly origens = new Map<string, Origem>();
  readonly links: LinkRastreado[] = [];
  readonly cliques: Clique[] = [];
  readonly anuncios = new Map<string, NomesAnuncio>();
  readonly analises = new Map<string, { situacao: string; em: Date; resultado?: unknown }>();
  readonly capi: EventoCapi[] = [];
  private seq = 0;

  async origem(conversaId: string) {
    const p = this.origens.get(`${conversaId}|primeiro`);
    const u = this.origens.get(`${conversaId}|ultimo`);
    return { ...(p ? { primeiro: structuredClone(p) } : {}), ...(u ? { ultimo: structuredClone(u) } : {}) };
  }
  async gravarOrigem(conversaId: string, toque: Toque, o: Origem, modo: ModoGravar) {
    const k = `${conversaId}|${toque}`;
    const atual = this.origens.get(k);
    if (atual && modo === 'se_vazio') return false;
    if (atual && modo === 'sobre_ia' && atual.origemPor !== 'ia') return false;
    this.origens.set(k, { ...sem(structuredClone(o)), atualizadoEm: new Date() });
    return true;
  }
  async primeiros(ids?: string[]) {
    const m = new Map<string, Origem>();
    for (const [k, v] of this.origens) {
      const [id, t] = k.split('|');
      if (t === 'primeiro' && (!ids || ids.includes(id!))) m.set(id!, structuredClone(v));
    }
    return m;
  }
  async aplicarNomes(adId: string, n: NomesAnuncio) {
    for (const o of this.origens.values()) {
      if (o.adId !== adId) continue;
      if (n.adNome) o.adNome = n.adNome;
      if (n.adsetId) o.adsetId = n.adsetId;
      if (n.adsetNome) o.adsetNome = n.adsetNome;
      if (n.campaignId) o.campaignId = n.campaignId;
      if (n.campaignNome) o.campaignNome = n.campaignNome;
    }
  }
  async anuncio(adId: string) {
    const a = this.anuncios.get(adId);
    return a ? { ...a } : undefined;
  }
  async gravarAnuncio(adId: string, n: NomesAnuncio) {
    this.anuncios.set(adId, { ...n });
  }
  async anunciosSemNome(limite: number) {
    const ids = new Set<string>();
    for (const o of this.origens.values()) if (o.adId && !o.adNome) ids.add(o.adId);
    return [...ids].slice(0, limite);
  }

  async listarLinks(_empresaId: string) {
    return this.links.map((l) => {
      const cs = this.cliques.filter((c) => c.linkId === l.id);
      return { ...l, cliques: cs.length, leads: new Set(cs.filter((c) => c.conversaId).map((c) => c.conversaId)).size };
    }).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  }
  async link(_e: string, id: string) {
    return this.links.find((l) => l.id === id);
  }
  async linkPorCodigo(codigo: string) {
    return this.links.find((l) => l.codigo.toLowerCase() === codigo.toLowerCase());
  }
  async criarLink(_e: string, l: Omit<LinkRastreado, 'id' | 'criadoEm'>) {
    if (this.links.some((x) => x.codigo.toLowerCase() === l.codigo.toLowerCase())) throw Object.assign(new Error('Já existe um link com esse código.'), { statusCode: 409 });
    const novo = { ...sem({ ...l }), ativo: l.ativo, id: randomUUID(), criadoEm: new Date() };
    this.links.push(novo);
    return { ...novo };
  }
  async alterarLink(_e: string, id: string, l: Partial<Pick<LinkRastreado, 'nome' | 'ativo' | 'mensagem' | 'numero'>>) {
    const x = this.links.find((y) => y.id === id);
    if (!x) return undefined;
    Object.assign(x, Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)));
    return { ...x };
  }
  async gravarClique(c: Clique) {
    if (this.cliques.some((x) => x.ref === c.ref)) return false;
    this.cliques.push(sem({ ...c }));
    return true;
  }
  async cliquePorRef(ref: string) {
    const c = this.cliques.find((x) => x.ref === ref);
    return c ? { ...c } : undefined;
  }
  async ligarClique(cliqueId: string, conversaId: string) {
    const c = this.cliques.find((x) => x.id === cliqueId);
    if (c) c.conversaId = conversaId;
  }

  async reservarAnaliseIa(conversaId: string) {
    if (this.analises.has(conversaId)) return false;
    this.analises.set(conversaId, { situacao: 'pendente', em: new Date() });
    return true;
  }
  async concluirAnaliseIa(conversaId: string, situacao: 'feita' | 'erro', resultado?: unknown) {
    this.analises.set(conversaId, { situacao, em: new Date(), resultado });
  }
  async analisesPendentes(antesDe: Date, limite: number) {
    return [...this.analises.entries()].filter(([, a]) => a.situacao === 'pendente' && a.em < antesDe).slice(0, limite).map(([id]) => id);
  }

  async enfileirarCapi(e: Omit<EventoCapi, 'id' | 'situacao' | 'tentativas' | 'criadoEm' | 'enviadoEm' | 'resposta'>) {
    if (this.capi.some((x) => x.eventId === e.eventId)) return false;
    this.capi.push({ ...structuredClone(e), id: ++this.seq, situacao: 'pendente', tentativas: 0, criadoEm: new Date() });
    return true;
  }
  async reivindicarCapi(agora: Date, limite: number, reservaMs: number) {
    const lista = this.capi.filter((e) => e.situacao === 'pendente' && e.proximaEm <= agora).slice(0, limite);
    for (const e of lista) {
      e.proximaEm = new Date(agora.getTime() + reservaMs);
      e.tentativas++;
    }
    return lista.map((e) => structuredClone(e));
  }
  async concluirCapi(id: number, r: { situacao: SituacaoCapi; resposta: string; proximaEm?: Date; enviadoEm?: Date }) {
    const e = this.capi.find((x) => x.id === id);
    if (!e) return;
    e.situacao = r.situacao;
    e.resposta = r.resposta;
    if (r.proximaEm) e.proximaEm = r.proximaEm;
    if (r.enviadoEm) e.enviadoEm = r.enviadoEm;
  }
  async reenviarCapi(id: number, agora: Date) {
    const e = this.capi.find((x) => x.id === id);
    if (!e || e.situacao === 'enviado' || e.situacao === 'pendente') return false;
    e.situacao = 'pendente';
    e.proximaEm = agora;
    e.tentativas = 0;
    return true;
  }
  async eventosCapi(limite: number) {
    return [...this.capi].sort((a, b) => b.id - a.id).slice(0, limite).map((e) => structuredClone(e));
  }
}

// ---------------------------------------------------------------- Postgres

const S = 'sintonia';
type Linha = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? undefined : String(v));

function paraOrigem(r: Linha): Origem {
  const o: Record<string, unknown> = {};
  for (const [campo, col] of COLUNAS) if (r[col] !== null && r[col] !== undefined) o[campo] = r[col];
  if (r.atualizado_em) o.atualizadoEm = r.atualizado_em;
  return o as unknown as Origem;
}
const paraLink = (r: Linha): LinkRastreado =>
  sem({
    id: String(r.id), codigo: String(r.codigo), nome: String(r.nome), unidade: String(r.unidade), numero: String(r.numero), mensagem: String(r.mensagem),
    utmSource: str(r.utm_source), utmMedium: str(r.utm_medium), utmCampaign: str(r.utm_campaign), utmContent: str(r.utm_content), utmTerm: str(r.utm_term),
    ativo: Boolean(r.ativo), criadoPor: str(r.criado_por), criadoEm: r.criado_em as Date,
  }) as LinkRastreado;
const paraClique = (r: Linha): Clique =>
  sem({
    id: String(r.id), linkId: String(r.link_id), ref: String(r.ref), utmSource: str(r.utm_source), utmMedium: str(r.utm_medium), utmCampaign: str(r.utm_campaign),
    utmContent: str(r.utm_content), utmTerm: str(r.utm_term), fbclid: str(r.fbclid), gclid: str(r.gclid), userAgent: str(r.user_agent), referencia: str(r.referencia),
    em: r.em as Date, conversaId: str(r.conversa_id),
  }) as Clique;
const paraEvento = (r: Linha): EventoCapi =>
  sem({
    id: Number(r.id), eventId: String(r.event_id), conversaId: str(r.conversa_id), nome: String(r.nome), chave: String(r.chave), payload: r.payload as Record<string, unknown>,
    situacao: r.situacao as SituacaoCapi, tentativas: Number(r.tentativas), proximaEm: r.proxima_em as Date, resposta: str(r.resposta), teste: Boolean(r.teste),
    criadoEm: r.criado_em as Date, enviadoEm: (r.enviado_em as Date | null) ?? undefined,
  }) as EventoCapi;

export class ArmazemRastreioPostgres implements ArmazemRastreio {
  constructor(private readonly pool: pg.Pool) {}

  async origem(conversaId: string) {
    const { rows } = await this.pool.query(`select * from ${S}.origens_lead where conversa_id = $1`, [conversaId]);
    const saida: { primeiro?: Origem; ultimo?: Origem } = {};
    for (const r of rows) saida[r.toque as Toque] = paraOrigem(r);
    return saida;
  }
  async gravarOrigem(conversaId: string, toque: Toque, o: Origem, modo: ModoGravar) {
    const cols = COLUNAS.map(([, c]) => c);
    const vals = COLUNAS.map(([k]) => (o[k] === '' ? null : (o[k] ?? null)));
    const conflito =
      modo === 'se_vazio'
        ? 'do nothing'
        : `do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}, atualizado_em = now()${modo === 'sobre_ia' ? ` where ${S}.origens_lead.origem_por = 'ia'` : ''}`;
    const r = await this.pool.query(
      `insert into ${S}.origens_lead (conversa_id, toque, ${cols.join(', ')}) values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')})
       on conflict (conversa_id, toque) ${conflito}`,
      [conversaId, toque, ...vals],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async primeiros(ids?: string[]) {
    const { rows } = ids
      ? await this.pool.query(`select * from ${S}.origens_lead where toque = 'primeiro' and conversa_id = any($1::uuid[])`, [ids])
      : await this.pool.query(`select * from ${S}.origens_lead where toque = 'primeiro'`);
    return new Map(rows.map((r) => [String(r.conversa_id), paraOrigem(r)]));
  }
  async aplicarNomes(adId: string, n: NomesAnuncio) {
    await this.pool.query(
      `update ${S}.origens_lead set ad_nome = coalesce($2, ad_nome), adset_id = coalesce($3, adset_id), adset_nome = coalesce($4, adset_nome),
         campaign_id = coalesce($5, campaign_id), campaign_nome = coalesce($6, campaign_nome), atualizado_em = now() where ad_id = $1`,
      [adId, n.adNome ?? null, n.adsetId ?? null, n.adsetNome ?? null, n.campaignId ?? null, n.campaignNome ?? null],
    );
  }
  async anuncio(adId: string) {
    const { rows } = await this.pool.query(`select * from ${S}.anuncios_meta where ad_id = $1`, [adId]);
    const r = rows[0];
    return r
      ? (sem({ adNome: str(r.ad_nome), adsetId: str(r.adset_id), adsetNome: str(r.adset_nome), campaignId: str(r.campaign_id), campaignNome: str(r.campaign_nome), erro: str(r.erro), atualizadoEm: r.atualizado_em }) as NomesAnuncio)
      : undefined;
  }
  async gravarAnuncio(adId: string, n: NomesAnuncio) {
    await this.pool.query(
      `insert into ${S}.anuncios_meta (ad_id, ad_nome, adset_id, adset_nome, campaign_id, campaign_nome, erro, atualizado_em) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (ad_id) do update set ad_nome = excluded.ad_nome, adset_id = excluded.adset_id, adset_nome = excluded.adset_nome,
         campaign_id = excluded.campaign_id, campaign_nome = excluded.campaign_nome, erro = excluded.erro, atualizado_em = excluded.atualizado_em`,
      [adId, n.adNome ?? null, n.adsetId ?? null, n.adsetNome ?? null, n.campaignId ?? null, n.campaignNome ?? null, n.erro ?? null, n.atualizadoEm],
    );
  }
  async anunciosSemNome(limite: number) {
    const { rows } = await this.pool.query(`select distinct ad_id from ${S}.origens_lead where ad_id is not null and ad_nome is null limit $1`, [limite]);
    return rows.map((r) => String(r.ad_id));
  }

  async listarLinks(empresaId: string) {
    const { rows } = await this.pool.query(
      `select l.*, (select count(*) from ${S}.cliques_link c where c.link_id = l.id)::int as cliques,
              (select count(distinct c.conversa_id) from ${S}.cliques_link c where c.link_id = l.id and c.conversa_id is not null)::int as leads
         from ${S}.links_rastreados l where l.empresa_id = $1 order by l.criado_em desc`,
      [empresaId],
    );
    return rows.map((r) => ({ ...paraLink(r), cliques: Number(r.cliques), leads: Number(r.leads) }));
  }
  async link(empresaId: string, id: string) {
    const { rows } = await this.pool.query(`select * from ${S}.links_rastreados where empresa_id = $1 and id = $2`, [empresaId, id]);
    return rows[0] ? paraLink(rows[0]) : undefined;
  }
  async linkPorCodigo(codigo: string) {
    const { rows } = await this.pool.query(`select * from ${S}.links_rastreados where lower(codigo) = lower($1)`, [codigo]);
    return rows[0] ? paraLink(rows[0]) : undefined;
  }
  async criarLink(empresaId: string, l: Omit<LinkRastreado, 'id' | 'criadoEm'>) {
    try {
      const { rows } = await this.pool.query(
        `insert into ${S}.links_rastreados (id, empresa_id, codigo, nome, unidade, numero, mensagem, utm_source, utm_medium, utm_campaign, utm_content, utm_term, ativo, criado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [randomUUID(), empresaId, l.codigo, l.nome, l.unidade, l.numero, l.mensagem, l.utmSource ?? null, l.utmMedium ?? null, l.utmCampaign ?? null, l.utmContent ?? null, l.utmTerm ?? null, l.ativo, l.criadoPor ?? null],
      );
      return paraLink(rows[0]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw Object.assign(new Error('Já existe um link com esse código.'), { statusCode: 409 });
      throw e;
    }
  }
  async alterarLink(empresaId: string, id: string, l: Partial<Pick<LinkRastreado, 'nome' | 'ativo' | 'mensagem' | 'numero'>>) {
    const { rows } = await this.pool.query(
      `update ${S}.links_rastreados set nome = coalesce($3, nome), ativo = coalesce($4, ativo), mensagem = coalesce($5, mensagem), numero = coalesce($6, numero)
        where empresa_id = $1 and id = $2 returning *`,
      [empresaId, id, l.nome ?? null, l.ativo ?? null, l.mensagem ?? null, l.numero ?? null],
    );
    return rows[0] ? paraLink(rows[0]) : undefined;
  }
  async gravarClique(c: Clique) {
    const r = await this.pool.query(
      `insert into ${S}.cliques_link (id, link_id, ref, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, user_agent, referencia, em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (ref) do nothing`,
      [c.id, c.linkId, c.ref, c.utmSource ?? null, c.utmMedium ?? null, c.utmCampaign ?? null, c.utmContent ?? null, c.utmTerm ?? null, c.fbclid ?? null, c.gclid ?? null, c.userAgent ?? null, c.referencia ?? null, c.em],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async cliquePorRef(ref: string) {
    const { rows } = await this.pool.query(`select * from ${S}.cliques_link where ref = $1`, [ref]);
    return rows[0] ? paraClique(rows[0]) : undefined;
  }
  async ligarClique(cliqueId: string, conversaId: string) {
    await this.pool.query(`update ${S}.cliques_link set conversa_id = $2 where id = $1`, [cliqueId, conversaId]);
  }

  async reservarAnaliseIa(conversaId: string) {
    const r = await this.pool.query(`insert into ${S}.origem_ia (conversa_id) values ($1) on conflict do nothing`, [conversaId]);
    return (r.rowCount ?? 0) > 0;
  }
  async concluirAnaliseIa(conversaId: string, situacao: 'feita' | 'erro', resultado?: unknown) {
    await this.pool.query(`update ${S}.origem_ia set situacao = $2, resultado = $3, tentativas = tentativas + 1, em = now() where conversa_id = $1`, [
      conversaId, situacao, resultado === undefined ? null : JSON.stringify(resultado),
    ]);
  }
  async analisesPendentes(antesDe: Date, limite: number) {
    const { rows } = await this.pool.query(`select conversa_id from ${S}.origem_ia where situacao = 'pendente' and em < $1 limit $2`, [antesDe, limite]);
    return rows.map((r) => String(r.conversa_id));
  }

  async enfileirarCapi(e: Omit<EventoCapi, 'id' | 'situacao' | 'tentativas' | 'criadoEm' | 'enviadoEm' | 'resposta'>) {
    const r = await this.pool.query(
      `insert into ${S}.capi_eventos (event_id, conversa_id, nome, chave, payload, proxima_em, teste) values ($1,$2,$3,$4,$5,$6,$7) on conflict (event_id) do nothing`,
      [e.eventId, e.conversaId ?? null, e.nome, e.chave, JSON.stringify(e.payload), e.proximaEm, e.teste],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async reivindicarCapi(agora: Date, limite: number, reservaMs: number) {
    const { rows } = await this.pool.query(
      `update ${S}.capi_eventos set proxima_em = $2, tentativas = tentativas + 1
        where id in (select id from ${S}.capi_eventos where situacao = 'pendente' and proxima_em <= $1 order by proxima_em limit $3 for update skip locked)
        returning *`,
      [agora, new Date(agora.getTime() + reservaMs), limite],
    );
    return rows.map(paraEvento);
  }
  async concluirCapi(id: number, r: { situacao: SituacaoCapi; resposta: string; proximaEm?: Date; enviadoEm?: Date }) {
    await this.pool.query(`update ${S}.capi_eventos set situacao = $2, resposta = $3, proxima_em = coalesce($4, proxima_em), enviado_em = coalesce($5, enviado_em) where id = $1`, [
      id, r.situacao, r.resposta.slice(0, 2000), r.proximaEm ?? null, r.enviadoEm ?? null,
    ]);
  }
  async reenviarCapi(id: number, agora: Date) {
    const r = await this.pool.query(`update ${S}.capi_eventos set situacao = 'pendente', proxima_em = $2, tentativas = 0 where id = $1 and situacao in ('erro', 'desistiu')`, [id, agora]);
    return (r.rowCount ?? 0) > 0;
  }
  async eventosCapi(limite: number) {
    const { rows } = await this.pool.query(`select * from ${S}.capi_eventos order by id desc limit $1`, [limite]);
    return rows.map(paraEvento);
  }
}
