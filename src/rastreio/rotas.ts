import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehGestor, podeVer, UNIDADES_EQUIPE } from '../auth/acesso.js';
import type { Conexoes, ValoresConexao } from '../conexoes/conexoes.js';
import type { Rastreio } from './rastreio.js';
import { seloDe } from './rastreio.js';
import { EVENTOS_MENSAGEM, lerMapa, MAPA_PADRAO, VERSAO_PADRAO, type Capi, type ConfigCapi } from './capi.js';
import type { EventoCapi } from './armazem.js';
import { escopoDe } from '../auth/acesso.js';
import type { ConfigComercial } from '../comercial/calculo.js';
import { janelaCriativos, ORDENS, PERIODOS_CRIATIVOS, resumirCriativos, type FonteCriativos, type InsightAnuncio } from './criativos.js';
import { ErroMetaAds, lerInsights, numeroDaConta, verificarConta, verificarDataset } from './meta-ads.js';

export interface OpcoesRotasRastreio {
  repo: Repositorio;
  rastreio: Rastreio;
  capi: Capi;
  conexoes: Conexoes;
  empresaId: string;
  agora?: () => Date;
  /** marketing: Central de criativos (sem fonte, a rota responde vazia). */
  criativos?: FonteCriativos;
  /** Tabela de preços do Comercial (valor da venda quando o agendamento não tem valor). */
  precos?: () => Promise<ConfigComercial['precos']>;
  fetchFn?: typeof fetch;
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

const primeiroErro = (e: z.ZodError) => Object.assign(new Error(e.issues[0]?.message ?? 'Confira os dados.'), { statusCode: 400 });
const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });
const ADMIN = new Set(['admin', 'direcao']);
const Utm = z.string().trim().max(200).optional();
/**
 * Número do WhatsApp só com dígitos e com o código do país: quem digita só o DDD e o número
 * (10 ou 11 dígitos, ex.: 71 99999-9999) ganha o 55 do Brasil na frente.
 */
export function numeroComPais(entrada: string): string {
  const d = entrada.replace(/\D/g, '').replace(/^0+/, '');
  return d.length === 10 || d.length === 11 ? '55' + d : d;
}
const NovoLink = z.object({
  nome: z.string({ message: 'Dê um nome ao link.' }).trim().min(2, 'Dê um nome ao link (2 letras ou mais).').max(60, 'Nome do link: até 60 letras.'),
  codigo: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Código: letras minúsculas, números e hífen (2 a 40)').optional(),
  unidade: z.enum(UNIDADES_EQUIPE as [string, ...string[]], { message: 'Escolha a unidade.' }),
  numero: z
    .string({ message: 'Informe o WhatsApp da unidade, com DDD.' })
    .transform(numeroComPais)
    .refine((s) => s.length >= 12 && s.length <= 13, 'Número do WhatsApp inválido. Use o DDD e o número, ex.: 71 99999-9999'),
  mensagem: z.string().trim().min(2, 'A mensagem precisa de 2 letras ou mais.').max(300, 'Mensagem: até 300 letras.').default('Olá! Vim pelo link e quero saber mais.'),
  utmSource: Utm,
  utmMedium: Utm,
  utmCampaign: Utm,
  utmContent: Utm,
  utmTerm: Utm,
});
const EdicaoLink = z.object({ nome: z.string().trim().min(2).max(60).optional(), ativo: z.boolean().optional(), mensagem: z.string().trim().min(2).max(300).optional() });

/** "R$ 1.250,00", "1250,5", "1250.50" → "1250,00"-ish que o regex aceita (milhar com ponto sai). */
function valorEmReais(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  let t = v.replace(/R\$/gi, '').replace(/\s/g, '');
  if (/,/.test(t)) t = t.replace(/\.(?=\d{3}(\D|$))/g, '');
  return t;
}
const Regra = z.object({ ligado: z.boolean(), site: z.string().trim().max(50), mensagem: z.union([z.literal(''), z.enum(EVENTOS_MENSAGEM)]) });
const SalvarCapi = z.object({
  ligado: z.boolean().optional(),
  datasetId: z.string().trim().regex(/^\d*$/, 'Use só os números do Dataset ID').max(30).optional(),
  token: z.string().trim().max(600).optional(),
  testeCodigo: z.string().trim().max(40).optional(),
  versao: z.string().trim().regex(/^(v\d{1,2}\.\d)?$/, 'Versão no formato v27.0').optional(),
  wabaId: z.string().trim().regex(/^\d*$/, 'WhatsApp Business Account ID: use só os números.').max(30).optional(),
  pageId: z.string().trim().regex(/^\d*$/, 'Page ID: use só os números.').max(30).optional(),
  valorPadrao: z.preprocess(valorEmReais, z.string().trim().regex(/^(\d+([.,]\d{1,2})?)?$/, 'Valor em reais, ex.: 250 ou 250,00').optional()),
  adsToken: z.string().trim().max(600).optional(),
  adsConta: z
    .string()
    .trim()
    .max(200)
    .transform(numeroDaConta)
    .refine((x) => x === '' || /^\d{5,25}$/.test(x), 'Conta de anúncios: use só os números (ex.: 123456789012345).')
    .optional(),
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
    const r = NovoLink.safeParse(req.body ?? {});
    // A primeira coisa errada, dita em português (em vez de um "Dados inválidos" genérico).
    if (!r.success) return reply.code(400).send({ erro: r.error.issues[0]?.message ?? 'Confira os dados do link.', campo: String(r.error.issues[0]?.path[0] ?? '') });
    const b = r.data;
    const codigo = b.codigo ?? (b.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'link') + '-' + Math.random().toString(36).slice(2, 6);
    const link = await o.rastreio.armazem.criarLink(o.empresaId, { ...b, codigo, ativo: true, criadoPor: req.usuario?.nome ?? 'teste' });
    return reply.code(201).send(link);
  });
  app.patch('/api/rastreio/links/:id', async (req, reply) => {
    exigeGestao(req);
    const id = (req.params as { id: string }).id;
    // Id que não é uuid: o banco recusaria com erro interno; para quem chama, é só "não encontrado".
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return reply.code(404).send({ erro: 'Link não encontrado' });
    const e = EdicaoLink.safeParse(req.body ?? {});
    if (!e.success) return reply.code(400).send({ erro: e.error.issues[0]?.message ?? 'Confira os dados do link.' });
    const l = await o.rastreio.armazem.alterarLink(o.empresaId, id, e.data);
    return l ?? reply.code(404).send({ erro: 'Link não encontrado' });
  });

  // ---------- API de Conversões ----------
  const graphVersao = () => configCapiDe(o.conexoes).versao;
  const tokenAnuncios = () => o.conexoes.get('metaAdsToken') ?? o.conexoes.get('capiToken');
  /** Última conferência com a Meta (memória do servidor; some num reinício e a tela pede para conferir de novo). */
  const verificacao: { conversoes?: { ok: boolean; texto: string; em: Date }; anuncios?: { ok: boolean; texto: string; em: Date } } = {};
  const resumoCapi = async () => {
    const cfg = configCapiDe(o.conexoes);
    const r = o.conexoes.resumo().campos as Record<string, { definido: boolean; final?: string | null }>;
    const eventos = await o.rastreio.armazem.eventosCapi(40);
    const tokenCapi = r.capiToken?.definido ?? false;
    const tokenAds = r.metaAdsToken?.definido ?? false;
    const conta = o.conexoes.get('metaAdsConta') ?? '';
    const ultimoReal = eventos.find((e) => !e.teste && e.situacao !== 'pendente');
    // Situação em uma palavra para a tela (o texto explica).
    const conversoes = !cfg.datasetId || !tokenCapi
      ? { estado: 'faltando', texto: !cfg.datasetId && !tokenCapi ? 'Falta o Dataset (Pixel) ID e o token de acesso.' : !cfg.datasetId ? 'Falta o Dataset (Pixel) ID.' : 'Falta o token de acesso.' }
      : verificacao.conversoes && !verificacao.conversoes.ok
        ? { estado: 'erro', texto: verificacao.conversoes.texto }
        : ultimoReal && (ultimoReal.situacao === 'erro' || ultimoReal.situacao === 'desistiu')
          ? { estado: 'erro', texto: 'O último evento foi recusado pela Meta. Veja em "Últimos envios".' }
          : !cfg.ligado
            ? { estado: 'pausada', texto: 'Conectada, mas o envio de eventos está desligado.' }
            : { estado: 'ok', texto: cfg.testeCodigo ? 'Ligada no modo de teste: os eventos vão só para "Eventos de teste".' : 'Ligada: a Meta recebe os eventos.' };
    const anuncios = !conta || !(tokenAds || tokenCapi)
      ? { estado: 'faltando', texto: !conta ? 'Falta o número da conta de anúncios.' : 'Falta o token com permissão de leitura (ads_read).' }
      : verificacao.anuncios
        ? { estado: verificacao.anuncios.ok ? 'ok' : 'erro', texto: verificacao.anuncios.texto }
        : { estado: 'nao_conferida', texto: 'Conta preenchida, ainda não conferida com a Meta.' };
    return {
      ligado: cfg.ligado,
      datasetId: cfg.datasetId ?? '',
      token: { definido: tokenCapi, final: r.capiToken?.final ?? null },
      adsToken: { definido: tokenAds, final: r.metaAdsToken?.final ?? null },
      adsConta: conta,
      testeCodigo: cfg.testeCodigo ?? '',
      versao: cfg.versao,
      wabaId: cfg.wabaId ?? '',
      pageId: cfg.pageId ?? '',
      valorPadrao: (o.conexoes.get('capiValorPadrao') ?? '').replace('.', ','),
      eventos: cfg.eventos,
      padrao: MAPA_PADRAO,
      eventosMensagem: EVENTOS_MENSAGEM,
      registro: eventos.map(resumoEvento),
      totais: eventos.reduce<Record<string, number>>((m, e) => ({ ...m, [e.situacao]: (m[e.situacao] ?? 0) + 1 }), {}),
      situacao: { conversoes, anuncios },
    };
  };
  app.get('/api/rastreio/capi', async (req) => {
    exigeAdmin(req);
    return resumoCapi();
  });
  app.put('/api/rastreio/capi', async (req) => {
    exigeAdmin(req);
    const p = SalvarCapi.safeParse(req.body ?? {});
    if (!p.success) throw primeiroErro(p.error);
    const b = p.data;
    const v: ValoresConexao = {};
    if (b.ligado !== undefined) v.capiLigado = b.ligado ? '1' : '0';
    if (b.datasetId !== undefined) v.capiDatasetId = b.datasetId;
    if (b.token) v.capiToken = b.token;
    if (b.adsToken) v.metaAdsToken = b.adsToken;
    if (b.adsConta !== undefined) v.metaAdsConta = b.adsConta;
    if (b.testeCodigo !== undefined) v.capiTesteCodigo = b.testeCodigo;
    if (b.versao !== undefined) v.capiVersao = b.versao;
    if (b.wabaId !== undefined) v.capiWabaId = b.wabaId;
    if (b.pageId !== undefined) v.capiPageId = b.pageId;
    if (b.valorPadrao !== undefined) v.capiValorPadrao = b.valorPadrao.replace(',', '.');
    if (b.eventos) v.capiEventos = JSON.stringify(b.eventos);
    const depois = { ...configCapiDe(o.conexoes), ...(b.ligado !== undefined ? { ligado: b.ligado } : {}) };
    if (depois.ligado && !(v.capiDatasetId ?? depois.datasetId)) throw Object.assign(new Error('Para ligar, preencha o Dataset (Pixel) ID.'), { statusCode: 400 });
    if (depois.ligado && !v.capiToken && !depois.token) throw Object.assign(new Error('Para ligar, cole o token de acesso da API de Conversões.'), { statusCode: 400 });
    // Mudou token, conta ou dataset: a conferência anterior não vale mais.
    if (v.capiToken || v.capiDatasetId !== undefined) delete verificacao.conversoes;
    if (v.metaAdsToken || v.metaAdsConta !== undefined || v.capiToken) delete verificacao.anuncios;
    await o.conexoes.salvar(v, req.usuario?.email ?? 'teste');
    return resumoCapi();
  });
  /** Confere com a Meta o que estiver preenchido (dataset + token; conta de anúncios + token). */
  app.post('/api/rastreio/capi/conferir', async (req) => {
    exigeAdmin(req);
    const cfg = configCapiDe(o.conexoes);
    const em = agora();
    const f = o.fetchFn ?? fetch;
    if (cfg.datasetId && cfg.token) {
      try {
        const d = await verificarDataset({ token: cfg.token, dataset: cfg.datasetId, versao: cfg.versao }, f);
        verificacao.conversoes = { ok: true, texto: `Conferida com a Meta: ${d.nome}.`, em };
      } catch (e) {
        verificacao.conversoes = { ok: false, texto: e instanceof ErroMetaAds ? e.message : 'Não deu para conferir agora.', em };
      }
    }
    const conta = o.conexoes.get('metaAdsConta');
    const token = tokenAnuncios();
    if (conta && token) {
      try {
        const c = await verificarConta({ token, conta, versao: graphVersao() }, f);
        verificacao.anuncios = { ok: true, texto: `Conectada à conta "${c.nome}" (${c.moeda}).${c.situacao !== 1 ? ' Atenção: a Meta diz que a conta não está ativa.' : ''}`, em };
      } catch (e) {
        verificacao.anuncios = { ok: false, texto: e instanceof ErroMetaAds ? e.message : 'Não deu para conferir agora.', em };
      }
    }
    cacheInsights.clear();
    return resumoCapi();
  });
  /** Desconecta uma parte: apaga tokens e ids (e desliga o envio). */
  const Desconectar = z.object({ parte: z.enum(['conversoes', 'anuncios'], { message: 'Diga o que desconectar.' }) });
  app.post('/api/rastreio/capi/desconectar', async (req) => {
    exigeAdmin(req);
    const p = Desconectar.safeParse(req.body ?? {});
    if (!p.success) throw primeiroErro(p.error);
    if (p.data.parte === 'conversoes') {
      await o.conexoes.salvar({ capiLigado: '0', capiDatasetId: '', capiToken: '', capiTesteCodigo: '' }, req.usuario?.email ?? 'teste');
      delete verificacao.conversoes;
    } else {
      await o.conexoes.salvar({ metaAdsToken: '', metaAdsConta: '' }, req.usuario?.email ?? 'teste');
      delete verificacao.anuncios;
    }
    cacheInsights.clear();
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

  // ---------- marketing: Central de criativos ----------
  const cacheInsights = new Map<string, { em: number; dados: InsightAnuncio[] }>();
  const FiltroCriativos = z.object({
    periodo: z.enum(PERIODOS_CRIATIVOS).default('30d'),
    unidade: z.string().trim().max(30).regex(/^[a-z0-9_-]*$/).optional(),
    campanha: z.string().trim().max(200).optional(),
    ordem: z.enum(ORDENS).default('vendas'),
  });
  app.get('/api/rastreio/criativos', async (req) => {
    exigeGestao(req);
    const p = FiltroCriativos.safeParse(req.query ?? {});
    if (!p.success) throw primeiroErro(p.error);
    const f = p.data;
    const j = janelaCriativos(f.periodo, agora());
    // Sempre a empresa da conta (ou a do servidor); a gerente de uma unidade vê só as dela.
    const escopo = { ...escopoDe(req.usuario), empresaId: req.usuario?.empresaId ?? o.empresaId };
    const [leads, precos] = await Promise.all([o.criativos ? o.criativos.carregar(j.inicio, j.fim, escopo) : Promise.resolve([]), o.precos?.().catch(() => []) ?? Promise.resolve([])]);
    const conta = o.conexoes.get('metaAdsConta');
    const token = tokenAnuncios();
    let meta: { conectada: boolean; erro?: string; atualizadoEm?: Date } = { conectada: false };
    let insights: InsightAnuncio[] | undefined;
    // A gerente de uma unidade não vê o gasto da conta inteira (é da empresa toda).
    const veGasto = !escopo.unidades;
    if (conta && token && veGasto) {
      const chave = `${conta}|${j.desde}|${j.ate}`;
      const c = cacheInsights.get(chave);
      try {
        if (c && Date.now() - c.em < 10 * 60_000) insights = c.dados;
        else {
          insights = await lerInsights({ token, conta, versao: graphVersao() }, j.desde, j.ate, o.fetchFn ?? fetch);
          if (cacheInsights.size > 30) cacheInsights.clear();
          cacheInsights.set(chave, { em: Date.now(), dados: insights });
        }
        meta = { conectada: true, atualizadoEm: new Date(cacheInsights.get(chave)?.em ?? Date.now()) };
      } catch (e) {
        meta = { conectada: true, erro: e instanceof ErroMetaAds ? e.message : 'Não deu para ler a conta de anúncios agora.' };
      }
    }
    const valorPadrao = configCapiDe(o.conexoes).valorPadrao;
    const r = resumirCriativos(leads, { precos, valorPadrao, insights, unidade: f.unidade || undefined, campanha: f.campanha || undefined, ordem: f.ordem });
    return { periodo: f.periodo, desde: j.desde, ate: j.ate, ordem: f.ordem, ...r, meta, veGasto, podeConectar: !req.usuario || ADMIN.has(req.usuario.papel) };
  });
}
