import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehGestor, podeVer } from '../auth/acesso.js';
import type { Conexoes, ValoresConexao } from '../conexoes/conexoes.js';
import type { Rastreio } from './rastreio.js';
import { seloDe } from './rastreio.js';
import { EVENTOS_MENSAGEM, lerMapa, MAPA_PADRAO, VERSAO_PADRAO, type Capi, type ConfigCapi } from './capi.js';
import type { EventoCapi } from './armazem.js';

export interface OpcoesRotasRastreio {
  repo: Repositorio;
  rastreio: Rastreio;
  capi: Capi;
  conexoes: Conexoes;
  empresaId: string;
  agora?: () => Date;
}

/** Configuração da CAPI a partir das Conexões (lida a cada uso: muda na tela, vale na hora). */
export function configCapiDe(c: Pick<Conexoes, 'get'>): ConfigCapi {
  const valor = Number(String(c.get('capiValorPadrao') ?? '').replace(',', '.'));
  return {
    ligado: c.get('capiLigado') === '1',
    datasetId: c.get('capiDatasetId'),
    token: c.get('capiToken'),
    testeCodigo: c.get('capiTesteCodigo'),
    versao: c.get('capiVersao') || VERSAO_PADRAO,
    wabaId: c.get('capiWabaId'),
    pageId: c.get('capiPageId'),
    ...(Number.isFinite(valor) && valor > 0 ? { valorPadrao: valor } : {}),
    eventos: lerMapa(c.get('capiEventos')),
  };
}

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });
const ADMIN = new Set(['admin', 'direcao']);
const Utm = z.string().trim().max(200).optional();
const NovoLink = z.object({
  nome: z.string().trim().min(2).max(60),
  codigo: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Código: letras minúsculas, números e hífen (2 a 40)').optional(),
  unidade: z.enum(['norte', 'sumare']),
  numero: z.string().transform((s) => s.replace(/\D/g, '')).refine((s) => s.length >= 12 && s.length <= 13, 'Número do WhatsApp com DDI e DDD, ex.: 55 71 99999-9999'),
  mensagem: z.string().trim().min(2).max(300).default('Olá! Quero saber mais sobre a progressiva.'),
  utmSource: Utm,
  utmMedium: Utm,
  utmCampaign: Utm,
  utmContent: Utm,
  utmTerm: Utm,
});
const EdicaoLink = z.object({ nome: z.string().trim().min(2).max(60).optional(), ativo: z.boolean().optional(), mensagem: z.string().trim().min(2).max(300).optional() });

const Regra = z.object({ ligado: z.boolean(), site: z.string().trim().max(50), mensagem: z.union([z.literal(''), z.enum(EVENTOS_MENSAGEM)]) });
const SalvarCapi = z.object({
  ligado: z.boolean().optional(),
  datasetId: z.string().trim().regex(/^\d*$/, 'Use só os números do Dataset ID').max(30).optional(),
  token: z.string().trim().max(600).optional(),
  testeCodigo: z.string().trim().max(40).optional(),
  versao: z.string().trim().regex(/^(v\d{1,2}\.\d)?$/, 'Versão no formato v27.0').optional(),
  wabaId: z.string().trim().regex(/^\d*$/).max(30).optional(),
  pageId: z.string().trim().regex(/^\d*$/).max(30).optional(),
  valorPadrao: z.string().trim().regex(/^(\d+([.,]\d{1,2})?)?$/, 'Valor em reais, ex.: 250 ou 250,00').optional(),
  adsToken: z.string().trim().max(600).optional(),
  eventos: z
    .object({
      lead: Regra,
      qualificado: Regra,
      agendada: Regra,
      compareceu: Regra,
      etapas: z.array(z.object({ etapaId: z.string().min(1).max(60), nome: z.string().trim().min(2).max(50).regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'Nome do evento sem espaços nem acentos'), ligado: z.boolean() })).max(30),
    })
    .optional(),
});

/** Limite simples por IP para /l/:codigo (janela de 1 minuto). */
class Limite {
  private readonly contas = new Map<string, { n: number; desde: number }>();
  constructor(private readonly max: number) {}
  passa(chave: string, agora = Date.now()): boolean {
    const c = this.contas.get(chave);
    if (!c || agora - c.desde > 60_000) {
      if (this.contas.size > 20_000) this.contas.clear();
      this.contas.set(chave, { n: 1, desde: agora });
      return true;
    }
    c.n++;
    return c.n <= this.max;
  }
}

/** Robôs de pré-visualização de link (WhatsApp, Instagram, Facebook...): não contam como clique. */
const ROBO = /(facebookexternalhit|facebot|whatsapp|twitterbot|slackbot|telegrambot|discordbot|linkedinbot|googlebot|bingbot|bot\b|crawler|spider|preview)/i;

function resumoEvento(e: EventoCapi) {
  return { id: e.id, eventId: e.eventId, conversaId: e.conversaId ?? null, nome: e.nome, chave: e.chave, situacao: e.situacao, tentativas: e.tentativas, resposta: e.resposta ?? null, teste: e.teste, criadoEm: e.criadoEm, enviadoEm: e.enviadoEm ?? null, origem: (e.payload as { action_source?: string }).action_source ?? null, payload: e.payload };
}

export function registrarRastreio(app: FastifyInstance, o: OpcoesRotasRastreio): void {
  const agora = o.agora ?? (() => new Date());
  const limite = new Limite(40);
  const exigeGestao = (req: FastifyRequest) => {
    if (req.usuario && !ehGestor(req.usuario)) throw proibido('Só a gerência, a direção e a administração mexem nos links rastreados.');
  };
  const exigeAdmin = (req: FastifyRequest) => {
    if (req.usuario && !ADMIN.has(req.usuario.papel)) throw proibido('Só a administração e a direção mexem na API de Conversões.');
  };
  const visivel = (req: FastifyRequest, c: Conversa) => c.empresaId === o.empresaId && (!req.usuario || podeVer(req.usuario, c));

  // ---------- link público ----------
  app.get('/l/:codigo', async (req, reply) => {
    const { codigo } = req.params as { codigo: string };
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex').header('referrer-policy', 'no-referrer');
    if (!/^[A-Za-z0-9-]{2,40}$/.test(codigo)) return reply.code(404).type('text/plain; charset=utf-8').send('Link não encontrado.');
    const ua = String(req.headers['user-agent'] ?? '');
    // Acima do limite (ou robô de pré-visualização): manda para o WhatsApp sem registrar o clique.
    const gravar = limite.passa(req.ip) && !ROBO.test(ua);
    const q = Object.fromEntries(Object.entries((req.query as Record<string, unknown>) ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
    const destino = await o.rastreio.clicar(codigo, q, { userAgent: ua, referencia: typeof req.headers.referer === 'string' ? req.headers.referer : undefined, gravar });
    if (!destino) return reply.code(404).type('text/plain; charset=utf-8').send('Link não encontrado.');
    return reply.redirect(destino, 302);
  });

  // ---------- origem na ficha, selos ----------
  app.get('/api/conversas/:id/origem', async (req) => {
    const c = await o.repo.buscarConversa((req.params as { id: string }).id).catch(() => undefined);
    if (!c || !visivel(req, c)) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    const { primeiro, ultimo } = await o.rastreio.armazem.origem(c.id);
    const link = primeiro?.linkId ? await o.rastreio.armazem.link(o.empresaId, primeiro.linkId) : undefined;
    return { primeiro: primeiro ?? null, ultimo: ultimo ?? null, selo: primeiro ? seloDe(primeiro) : null, link: link ? { id: link.id, nome: link.nome, codigo: link.codigo } : null };
  });

  app.get('/api/rastreio/selos', async (req) => {
    const conversas = (await o.repo.listarConversas()).filter((c) => visivel(req, c));
    const ids = new Set(conversas.map((c) => c.id));
    const todos = await o.rastreio.selos();
    return Object.fromEntries(Object.entries(todos).filter(([id]) => ids.has(id)));
  });

  // ---------- links rastreados ----------
  app.get('/api/rastreio/links', async (req) => {
    exigeGestao(req);
    return { links: await o.rastreio.armazem.listarLinks(o.empresaId) };
  });
  app.post('/api/rastreio/links', async (req, reply) => {
    exigeGestao(req);
    const b = NovoLink.parse(req.body);
    const codigo = b.codigo ?? (b.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'link') + '-' + Math.random().toString(36).slice(2, 6);
    const link = await o.rastreio.armazem.criarLink(o.empresaId, { ...b, codigo, ativo: true, criadoPor: req.usuario?.nome ?? 'teste' });
    return reply.code(201).send(link);
  });
  app.patch('/api/rastreio/links/:id', async (req, reply) => {
    exigeGestao(req);
    const l = await o.rastreio.armazem.alterarLink(o.empresaId, (req.params as { id: string }).id, EdicaoLink.parse(req.body));
    return l ?? reply.code(404).send({ erro: 'Link não encontrado' });
  });

  // ---------- API de Conversões ----------
  const resumoCapi = async () => {
    const cfg = configCapiDe(o.conexoes);
    const r = o.conexoes.resumo().campos as Record<string, { definido: boolean; final?: string | null }>;
    const eventos = await o.rastreio.armazem.eventosCapi(40);
    return {
      ligado: cfg.ligado,
      datasetId: cfg.datasetId ?? '',
      token: { definido: r.capiToken?.definido ?? false, final: r.capiToken?.final ?? null },
      adsToken: { definido: r.metaAdsToken?.definido ?? false, final: r.metaAdsToken?.final ?? null },
      testeCodigo: cfg.testeCodigo ?? '',
      versao: cfg.versao,
      wabaId: cfg.wabaId ?? '',
      pageId: cfg.pageId ?? '',
      valorPadrao: o.conexoes.get('capiValorPadrao') ?? '',
      eventos: cfg.eventos,
      padrao: MAPA_PADRAO,
      eventosMensagem: EVENTOS_MENSAGEM,
      registro: eventos.map(resumoEvento),
      totais: eventos.reduce<Record<string, number>>((m, e) => ({ ...m, [e.situacao]: (m[e.situacao] ?? 0) + 1 }), {}),
    };
  };
  app.get('/api/rastreio/capi', async (req) => {
    exigeAdmin(req);
    return resumoCapi();
  });
  app.put('/api/rastreio/capi', async (req) => {
    exigeAdmin(req);
    const b = SalvarCapi.parse(req.body);
    const v: ValoresConexao = {};
    if (b.ligado !== undefined) v.capiLigado = b.ligado ? '1' : '0';
    if (b.datasetId !== undefined) v.capiDatasetId = b.datasetId;
    if (b.token) v.capiToken = b.token;
    if (b.adsToken) v.metaAdsToken = b.adsToken;
    if (b.testeCodigo !== undefined) v.capiTesteCodigo = b.testeCodigo;
    if (b.versao !== undefined) v.capiVersao = b.versao;
    if (b.wabaId !== undefined) v.capiWabaId = b.wabaId;
    if (b.pageId !== undefined) v.capiPageId = b.pageId;
    if (b.valorPadrao !== undefined) v.capiValorPadrao = b.valorPadrao.replace(',', '.');
    if (b.eventos) v.capiEventos = JSON.stringify(b.eventos);
    const depois = { ...configCapiDe(o.conexoes), ...(b.ligado !== undefined ? { ligado: b.ligado } : {}) };
    if (depois.ligado && !(v.capiDatasetId ?? depois.datasetId)) throw Object.assign(new Error('Para ligar, preencha o Dataset (Pixel) ID.'), { statusCode: 400 });
    if (depois.ligado && !v.capiToken && !depois.token) throw Object.assign(new Error('Para ligar, cole o token de acesso da API de Conversões.'), { statusCode: 400 });
    await o.conexoes.salvar(v, req.usuario?.email ?? 'teste');
    return resumoCapi();
  });
  app.post('/api/rastreio/capi/teste', async (req) => {
    exigeAdmin(req);
    const e = await o.capi.enviarTeste();
    return { ok: e.situacao === 'enviado', evento: resumoEvento(e) };
  });
  app.post('/api/rastreio/capi/eventos/:id/reenviar', async (req, reply) => {
    exigeAdmin(req);
    const ok = await o.rastreio.armazem.reenviarCapi(Number((req.params as { id: string }).id), agora());
    if (!ok) return reply.code(409).send({ erro: 'Só dá para reenviar eventos com erro.' });
    await o.capi.tick();
    return { ok: true };
  });
}
