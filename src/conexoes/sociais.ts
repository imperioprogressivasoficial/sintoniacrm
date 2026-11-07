import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { NumeroConectado } from '../app/sintonia.js';
import { assinaturaMetaValida } from '../channels/meta.js';
import { CanalInstagram, CanalMessenger, canalIdSocial, contasDoWebhookSocial, lerWebhookSocial, type ContaSocial } from '../channels/meta-social.js';
import { assinaturaTikTokValida, lerLeadsTikTok, type LeadTikTok } from '../channels/tiktok.js';
import type { CanalWhatsApp, MensagemRecebida } from '../channels/tipos.js';
import type { UnidadeId } from '../domain.js';
import { novoVerifyToken, UNIDADES_WHATSAPP, type Campo, type Conexoes } from './conexoes.js';

/**
 * Facebook Messenger, Instagram Direct e TikTok (leads) na tela de Conexões:
 * qual conta, para qual unidade, status (ligado / desligado / falta X), webhooks e botão "Testar".
 * Segredos (token, App Secret) ficam no cofre e nunca voltam para a tela — só "definido" e o final.
 */
export type Rede = 'messenger' | 'instagram' | 'tiktok';
export const REDES: Rede[] = ['messenger', 'instagram', 'tiktok'];
const NOMES: Record<Rede, string> = { messenger: 'Facebook Messenger', instagram: 'Instagram Direct', tiktok: 'TikTok' };

const unidadeDe = (c: Conexoes, rede: Rede): UnidadeId => {
  const u = c.get(`${rede}Unidade` as Campo);
  return u && (UNIDADES_WHATSAPP as readonly string[]).includes(u) ? (u as UnidadeId) : 'norte';
};
const ligado = (c: Conexoes, rede: Rede) => c.get(`${rede}Ligado` as Campo) === '1';

/** O que falta para a rede funcionar (vazio = completa). */
export function faltandoNaRede(c: Conexoes, rede: Rede): string[] {
  const f: string[] = [];
  if (rede === 'messenger') {
    if (!c.get('messengerPageId')) f.push('Page ID');
    if (!c.get('messengerToken')) f.push('token da Página');
    if (!c.get('messengerAppSecret')) f.push('App Secret');
  } else if (rede === 'instagram') {
    if (!c.get('instagramAccountId')) f.push('Instagram Business Account ID');
    if (!c.get('instagramToken')) f.push('token de acesso');
    if (!c.get('instagramAppSecret')) f.push('App Secret');
  } else {
    if (!c.get('tiktokVerifyToken')) f.push('token do webhook');
  }
  return f;
}

export interface ContaRede extends ContaSocial {
  rede: 'messenger' | 'instagram';
  unidade: UnidadeId;
  canalId: string;
  appSecret?: string;
  verifyToken?: string;
}

/** Messenger/Instagram ligados e com o mínimo para enviar (conta e token). */
export function contaDaRede(c: Conexoes, rede: 'messenger' | 'instagram'): ContaRede | undefined {
  if (!ligado(c, rede)) return undefined;
  const contaId = rede === 'messenger' ? c.get('messengerPageId') : c.get('instagramAccountId');
  const token = c.get(`${rede}Token` as Campo);
  if (!contaId || !token) return undefined;
  const conta: ContaRede = { rede, unidade: unidadeDe(c, rede), contaId, token, canalId: canalIdSocial(rede === 'messenger' ? 'facebook' : 'instagram', contaId) };
  const pageId = rede === 'instagram' ? c.get('instagramPageId') : undefined;
  const appSecret = c.get(`${rede}AppSecret` as Campo);
  const verifyToken = c.get(`${rede}VerifyToken` as Campo);
  if (pageId) conta.pageId = pageId;
  if (appSecret) conta.appSecret = appSecret;
  if (verifyToken) conta.verifyToken = verifyToken;
  return conta;
}

/** Cria o canal da rede (os testes trocam o fetch). */
export function canalDaRede(conta: ContaRede, fetchFn?: typeof fetch): CanalMessenger | CanalInstagram {
  return conta.rede === 'messenger' ? new CanalMessenger(conta, fetchFn) : new CanalInstagram(conta, fetchFn);
}

/** "Números" das redes sociais (entram na mesma lista dos números de WhatsApp). Cache: só refaz quando muda conta ou token. */
export function numerosSociais(c: Conexoes, cache: Map<string, { chave: string; canal: CanalWhatsApp }> = new Map(), criar: (conta: ContaRede) => CanalWhatsApp = (x) => canalDaRede(x)): NumeroConectado[] {
  const lista: NumeroConectado[] = [];
  for (const rede of ['messenger', 'instagram'] as const) {
    const conta = contaDaRede(c, rede);
    if (!conta) continue;
    const chave = `${conta.contaId}|${conta.token}|${conta.pageId ?? ''}`;
    let x = cache.get(rede);
    if (!x || x.chave !== chave) cache.set(rede, (x = { chave, canal: criar(conta) }));
    lista.push({ canalId: conta.canalId, unidade: conta.unidade, canal: x.canal });
  }
  return lista;
}

// ---------------------------------------------------------------- webhooks

export interface OpcoesWebhooksSociais {
  conexoes: Conexoes;
  /** Canal em vigor de cada conta (para buscar o nome da cliente). */
  canalDe?: (canalId: string) => CanalWhatsApp | undefined;
  /** Leads do TikTok (formulário instantâneo). */
  aoLeadTikTok?: (leads: LeadTikTok[], unidade: UnidadeId) => Promise<unknown>;
}

/** Quando chegou o último webhook de cada rede (para a tela mostrar se está chegando). */
export const vistosSociais = new Map<Rede, Date>();

/**
 * GET  /webhook/{messenger|instagram}  verificação (hub.mode=subscribe, hub.verify_token, hub.challenge)
 * POST /webhook/{messenger|instagram}  mensagens, assinadas com X-Hub-Signature-256 (App Secret)
 * POST /webhook/tiktok?token=...       leads do formulário instantâneo (token gerado ou TikTok-Signature)
 */
export function registrarWebhooksSociais(
  app: FastifyInstance,
  o: () => OpcoesWebhooksSociais | undefined,
  entregar: (canal: string, m: MensagemRecebida[]) => Promise<number>,
  log: (msg: string, extra?: unknown) => void,
): void {
  for (const rede of ['messenger', 'instagram'] as const) {
    app.get(`/webhook/${rede}`, async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const token = o()?.conexoes.get(`${rede}VerifyToken` as Campo);
      if (q['hub.mode'] === 'subscribe' && token && q['hub.verify_token'] === token) return reply.type('text/plain').send(q['hub.challenge'] ?? '');
      return reply.code(403).send();
    });
    app.post(`/webhook/${rede}`, async (req, reply) => {
      const op = o();
      if (!op) return reply.code(404).send();
      const conta = contaDaRede(op.conexoes, rede);
      const segredo = op.conexoes.get(`${rede}AppSecret` as Campo);
      const bruto = (req as unknown as { corpoBruto?: string }).corpoBruto ?? '';
      if (!segredo || !assinaturaMetaValida(bruto, req.headers['x-hub-signature-256'] as string | undefined, segredo)) return reply.code(401).send();
      vistosSociais.set(rede, new Date());
      if (!conta) return { recebidas: 0, desligado: true };
      // Só a conta configurada: outra Página/conta no mesmo app é ignorada.
      if (!contasDoWebhookSocial(req.body).includes(conta.contaId)) return { recebidas: 0 };
      const mensagens = lerWebhookSocial(req.body, rede === 'messenger' ? 'facebook' : 'instagram').filter((m) => m.canalId === conta.canalId);
      await completarNomes(mensagens, op.canalDe?.(conta.canalId), log);
      return { recebidas: await entregar(rede, mensagens) };
    });
  }

  app.post('/webhook/tiktok', async (req, reply) => {
    const op = o();
    if (!op) return reply.code(404).send();
    const c = op.conexoes;
    const bruto = (req as unknown as { corpoBruto?: string }).corpoBruto ?? '';
    const token = (req.query as Record<string, string | undefined>).token;
    const porToken = Boolean(token && token === c.get('tiktokVerifyToken'));
    const segredo = c.get('tiktokClientSecret');
    const porAssinatura = Boolean(segredo && assinaturaTikTokValida(bruto, req.headers['tiktok-signature'] as string | undefined, segredo));
    if (!porToken && !porAssinatura) return reply.code(401).send();
    vistosSociais.set('tiktok', new Date());
    if (!ligado(c, 'tiktok')) return { recebidos: 0, desligado: true };
    const leads = lerLeadsTikTok(req.body);
    if (leads.length && op.aoLeadTikTok) await op.aoLeadTikTok(leads, unidadeDe(c, 'tiktok')).catch((e) => log('Falha ao registrar lead do TikTok', String(e)));
    return { recebidos: leads.length };
  });
}

/** Nome da cliente pela API de perfil (o webhook só traz o id). Rápido e opcional: falha não segura a mensagem. */
async function completarNomes(mensagens: MensagemRecebida[], canal: CanalWhatsApp | undefined, log: (msg: string, extra?: unknown) => void) {
  if (!canal?.perfil) return;
  const vistos = new Map<string, string | undefined>();
  for (const m of mensagens) {
    if (m.deMim || m.nome) continue;
    if (!vistos.has(m.telefone)) {
      const nome = await Promise.race([
        canal.perfil(m.canalId, m.telefone).then((p) => p.nome),
        new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
      ]).catch((e) => {
        log('Perfil da rede social indisponível', String(e));
        return undefined;
      });
      vistos.set(m.telefone, nome);
    }
    const nome = vistos.get(m.telefone);
    if (nome) m.nome = nome;
  }
}

// ---------------------------------------------------------------- rotas da tela

export interface OpcoesRotasSociais {
  conexoes: Conexoes;
  quem: (req: FastifyRequest) => Promise<string>;
  baseDe: (req: FastifyRequest) => string;
  fetchFn?: typeof fetch;
}

export const RedeParam = z.enum(['messenger', 'instagram', 'tiktok']);

/** Campos que a tela pode gravar (o PUT /api/conexoes valida com isto). */
const IdNum = z.string().trim().regex(/^\d*$/, 'Use só os números do id (copie do painel da Meta)').max(40).optional();
export const CamposSociais = {
  messengerLigado: z.enum(['', '0', '1']).optional(),
  messengerUnidade: z.enum(['', ...UNIDADES_WHATSAPP]).optional(),
  messengerPageId: IdNum,
  messengerToken: z.string().max(800).optional(),
  messengerAppSecret: z.string().max(200).optional(),
  instagramLigado: z.enum(['', '0', '1']).optional(),
  instagramUnidade: z.enum(['', ...UNIDADES_WHATSAPP]).optional(),
  instagramAccountId: IdNum,
  instagramPageId: IdNum,
  instagramToken: z.string().max(800).optional(),
  instagramAppSecret: z.string().max(200).optional(),
  tiktokLigado: z.enum(['', '0', '1']).optional(),
  tiktokUnidade: z.enum(['', ...UNIDADES_WHATSAPP]).optional(),
  tiktokClientKey: z.string().trim().max(100).optional(),
  tiktokClientSecret: z.string().max(200).optional(),
};

/** Status de cada rede para a tela. */
export function situacaoSociais(c: Conexoes, base: string) {
  return REDES.map((rede) => {
    const faltando = faltandoNaRede(c, rede);
    const visto = vistosSociais.get(rede);
    const estaLigado = ligado(c, rede);
    return {
      rede,
      nome: NOMES[rede],
      ligado: estaLigado,
      unidade: unidadeDe(c, rede),
      faltando,
      status: !estaLigado ? 'desligado' : faltando.length ? 'falta' : 'ligado',
      webhookUrl: rede === 'tiktok' ? `${base}/webhook/tiktok?token=${encodeURIComponent(c.get('tiktokVerifyToken') ?? '')}` : `${base}/webhook/${rede}`,
      verifyToken: c.get(`${rede}VerifyToken` as Campo) ?? null,
      ultimoWebhook: visto ? visto.toISOString() : null,
      envio: rede !== 'tiktok',
    };
  });
}

export function registrarRotasSociais(app: FastifyInstance, o: OpcoesRotasSociais): void {
  const c = o.conexoes;

  app.get('/api/conexoes/sociais', async (req) => {
    await o.quem(req);
    return { redes: situacaoSociais(c, o.baseDe(req)) };
  });

  app.post('/api/conexoes/sociais/:rede/testar', async (req, reply: FastifyReply) => {
    await o.quem(req);
    const rede = RedeParam.parse((req.params as { rede: string }).rede);
    if (rede === 'tiktok') {
      return {
        ok: true,
        mensagem: 'Webhook de leads pronto: cole a URL no formulário instantâneo do TikTok (Gerenciador de Anúncios). Mensagens diretas dependem de aprovação do TikTok.',
      };
    }
    const contaId = rede === 'messenger' ? c.get('messengerPageId') : c.get('instagramAccountId');
    const token = c.get(`${rede}Token` as Campo);
    if (!contaId || !token) return reply.code(400).send({ ok: false, erro: `Preencha ${faltandoNaRede(c, rede).join(', ') || 'a conta e o token'} primeiro` });
    try {
      const conta: ContaRede = { rede, unidade: unidadeDe(c, rede), contaId, token, canalId: '' };
      const pageId = c.get('instagramPageId');
      if (rede === 'instagram' && pageId) conta.pageId = pageId;
      const r = await canalDaRede(conta, o.fetchFn).testar();
      const falta = faltandoNaRede(c, rede);
      return { ok: true, mensagem: `Conta respondendo: ${r.nome || r.id}${falta.length ? ` · falta ${falta.join(', ')}` : ''}`, ...r };
    } catch (e) {
      return { ok: false, erro: String((e as Error).message ?? e).slice(0, 400) };
    }
  });

  /** Gera outro Verify Token (o antigo deixa de valer: cole o novo no painel). */
  app.post('/api/conexoes/sociais/:rede/verify-token', async (req) => {
    const autor = await o.quem(req);
    const rede = RedeParam.parse((req.params as { rede: string }).rede);
    await c.salvar({ [`${rede}VerifyToken`]: novoVerifyToken() }, autor);
    return { verifyToken: c.get(`${rede}VerifyToken` as Campo) };
  });
}
