import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalInstagram, CanalMessenger, FORA_DA_JANELA_SOCIAL, lerIdentificadorSocial, lerWebhookSocial, partirTexto } from '../src/channels/meta-social.js';
import { assinaturaTikTokValida, CanalTikTok, lerLeadsTikTok } from '../src/channels/tiktok.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import { numerosSociais } from '../src/conexoes/sociais.js';
import { FilaMemoria } from '../src/fila/entrada.js';
import { ArmazemRastreioMemoria } from '../src/rastreio/armazem.js';
import { Rastreio } from '../src/rastreio/rastreio.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

const FB = 'https://graph.facebook.com/v21.0';
const IG = 'https://graph.instagram.com/v21.0';
const PAGE = '1040';
const IGID = '1784';
const PSID = '7001';
const IGSID = '9001';

interface Pedido {
  metodo: string;
  url: string;
  auth?: string;
  corpo?: Record<string, unknown>;
  form?: FormData;
}

/** Graph API falsa: guarda os pedidos e responde por rota. Nunca vai à rede. */
function graphFalsa(o: { erro?: { status: number; code: number; sub?: number } } = {}) {
  const pedidos: Pedido[] = [];
  let seq = 0;
  const f = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const form = init?.body instanceof FormData ? init.body : undefined;
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidos.push({ metodo, url, auth: headers.authorization, corpo, form });
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    const u = new URL(url);
    if (u.hostname === 'cdn.falsa') return new Response(Buffer.from('foto'), { headers: { 'content-type': 'image/jpeg' } });
    if (metodo === 'POST' && u.pathname.endsWith('/messages')) {
      if (o.erro) return json({ error: { message: 'x', code: o.erro.code, error_subcode: o.erro.sub } }, o.erro.status);
      return json({ recipient_id: 'r', message_id: `m_SAIDA${++seq}` });
    }
    if (u.pathname.endsWith(`/${PSID}`)) return json({ first_name: 'Marina', last_name: 'Souza', profile_pic: 'https://cdn.falsa/p.jpg' });
    if (u.pathname.endsWith(`/${IGSID}`)) return json({ name: 'Ana Lima', username: 'analima', profile_pic: 'https://cdn.falsa/ig.jpg' });
    if (u.pathname.endsWith(`/${PAGE}`)) return json({ name: 'Império Norte', id: PAGE });
    if (u.pathname.endsWith('/me')) return json({ user_id: IGID, username: 'imperio' });
    return json({ error: { message: 'não achei', code: 100 } }, 404);
  }) as typeof fetch;
  return { f, pedidos };
}

const assinar = (corpo: string, segredo: string) => 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex');

const msgMessenger = (texto: string, extra: Record<string, unknown> = {}) => ({
  object: 'page',
  entry: [{ id: PAGE, time: 1793980000000, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 1793980000000, message: { mid: 'm_E1', text: texto }, ...extra }] }],
});
const msgInstagram = (message: Record<string, unknown>) => ({
  object: 'instagram',
  entry: [{ id: IGID, time: 1793980000, messaging: [{ sender: { id: IGSID }, recipient: { id: IGID }, timestamp: 1793980000000, message }] }],
});

async function conexoesCom(valores: Record<string, string>) {
  const c = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await c.carregar();
  await c.salvar(valores, 'teste');
  return c;
}

const COMPLETO = {
  messengerLigado: '1',
  messengerUnidade: 'sumare',
  messengerPageId: PAGE,
  messengerToken: 'EAAPAGE',
  messengerAppSecret: 'seg-fb',
  instagramLigado: '1',
  instagramAccountId: IGID,
  instagramToken: 'IGAATOKEN',
  instagramAppSecret: 'seg-ig',
  tiktokLigado: '1',
};

describe('Leitura do webhook (Messenger e Instagram)', () => {
  it('Messenger: texto vira mensagem com PSID e canal da Página; anúncio vira referência', () => {
    const [m] = lerWebhookSocial(
      msgMessenger('Oi, quero agendar', { referral: { source: 'ADS', type: 'OPEN_THREAD', ad_id: '555', ads_context_data: { ad_title: 'Promo', photo_url: 'https://cdn.falsa/a.jpg' } } }),
      'facebook',
    );
    expect(m).toMatchObject({ canalId: `fb-${PAGE}`, telefone: `fb:${PSID}`, texto: 'Oi, quero agendar', deMim: false, idExterno: 'm_E1', rede: 'facebook', em: new Date(1793980000000) });
    expect(m!.referencia).toMatchObject({ via: 'meta', adId: '555', titulo: 'Promo', app: 'facebook', midiaUrl: 'https://cdn.falsa/a.jpg' });
    expect(lerIdentificadorSocial(m!.telefone)).toEqual({ rede: 'facebook', id: PSID });
  });

  it('Messenger: anexo de foto, eco da Página (deMim) e postback', () => {
    const corpo = {
      object: 'page',
      entry: [
        {
          id: PAGE,
          messaging: [
            { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 1, message: { mid: 'm_F', attachments: [{ type: 'image', payload: { url: 'https://cdn.falsa/x.jpg' } }] } },
            { sender: { id: PAGE }, recipient: { id: PSID }, timestamp: 2, message: { mid: 'm_ECO', text: 'Respondi pelo Inbox', is_echo: true } },
            { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 3, postback: { mid: 'm_P', title: 'Ver horários', payload: 'HORARIOS' } },
            { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: 4, read: { watermark: 1 } },
          ],
        },
      ],
    };
    const l = lerWebhookSocial(corpo, 'facebook');
    expect(l.map((m) => [m.idExterno, m.texto, m.deMim, m.telefone])).toEqual([
      ['m_F', '[foto]', false, `fb:${PSID}`],
      ['m_ECO', 'Respondi pelo Inbox', true, `fb:${PSID}`],
      ['m_P', 'Ver horários', false, `fb:${PSID}`],
    ]);
    expect(l[0]!.anexo).toEqual({ tipo: 'imagem', ref: 'https://cdn.falsa/x.jpg' });
    expect(lerWebhookSocial(corpo, 'instagram')).toEqual([]); // object diferente
  });

  it('Instagram: texto com IGSID, resposta a story e mensagem apagada ignorada', () => {
    const [m] = lerWebhookSocial(msgInstagram({ mid: 'ig_1', text: 'Que lindo!', reply_to: { story: { url: 'https://cdn.falsa/s', id: 's1' } } }), 'instagram');
    expect(m).toMatchObject({ canalId: `ig-${IGID}`, telefone: `ig:${IGSID}`, rede: 'instagram', texto: 'Que lindo! [resposta ao story https://cdn.falsa/s]' });
    expect(lerWebhookSocial(msgInstagram({ mid: 'ig_2', is_deleted: true }), 'instagram')).toEqual([]);
  });
});

describe('Envio pela Graph API', () => {
  it('Messenger: POST /{page}/messages com recipient, RESPONSE e o token', async () => {
    const g = graphFalsa();
    const r = await new CanalMessenger({ token: 'EAAPAGE', contaId: PAGE }, g.f).enviarTexto(`fb-${PAGE}`, `fb:${PSID}`, 'Oi, Marina!');
    expect(r.idExterno).toBe('m_SAIDA1');
    expect(g.pedidos[0]).toMatchObject({ metodo: 'POST', url: `${FB}/${PAGE}/messages`, auth: 'Bearer EAAPAGE', corpo: { recipient: { id: PSID }, messaging_type: 'RESPONSE', message: { text: 'Oi, Marina!' } } });
  });

  it('Messenger: arquivo vai em multipart (filedata) e a legenda em seguida', async () => {
    const g = graphFalsa();
    await new CanalMessenger({ token: 'T', contaId: PAGE }, g.f).enviarMidia(`fb-${PAGE}`, `fb:${PSID}`, { tipo: 'imagem', conteudo: Buffer.from('jpg'), mimetype: 'image/jpeg', nomeArquivo: 'f.jpg', legenda: 'Nosso espaço' });
    const form = g.pedidos[0]!.form!;
    expect(JSON.parse(form.get('recipient') as string)).toEqual({ id: PSID });
    expect(JSON.parse(form.get('message') as string)).toEqual({ attachment: { type: 'image', payload: { is_reusable: false } } });
    expect((form.get('filedata') as File).name).toBe('f.jpg');
    expect(g.pedidos[1]!.corpo).toMatchObject({ message: { text: 'Nosso espaço' } });
  });

  it('Instagram: token "IG" usa graph.instagram.com/{IG_ID}; token da Página usa /{PAGE}/messages', async () => {
    const g = graphFalsa();
    await new CanalInstagram({ token: 'IGAAX', contaId: IGID }, g.f).enviarTexto(`ig-${IGID}`, `ig:${IGSID}`, 'Olá');
    await new CanalInstagram({ token: 'EAAPAGE', contaId: IGID, pageId: PAGE }, g.f).enviarTexto(`ig-${IGID}`, `ig:${IGSID}`, 'Olá');
    expect(g.pedidos.map((p) => p.url)).toEqual([`${IG}/${IGID}/messages`, `${FB}/${PAGE}/messages`]);
    expect(g.pedidos[0]!.corpo).toMatchObject({ recipient: { id: IGSID }, message: { text: 'Olá' } });
  });

  it('Instagram: arquivo só com URL pública; sem ela recusa explicando', async () => {
    const g = graphFalsa();
    const midia = { tipo: 'imagem' as const, conteudo: Buffer.from('x'), mimetype: 'image/png' };
    await expect(new CanalInstagram({ token: 'IGAA', contaId: IGID }, g.f).enviarMidia('', `ig:${IGSID}`, midia)).rejects.toThrow('endereço público');
    await new CanalInstagram({ token: 'IGAA', contaId: IGID, publicarMidia: async () => 'https://sintonia/m/1.png' }, g.f).enviarMidia('', `ig:${IGSID}`, midia);
    expect(g.pedidos[0]!.corpo).toEqual({ recipient: { id: IGSID }, message: { attachment: { type: 'image', payload: { url: 'https://sintonia/m/1.png' } } } });
  });

  it('texto longo vai em partes; fora da janela vira mensagem clara; telefone comum é recusado', async () => {
    expect(partirTexto('a '.repeat(1500), 2000, (s) => s.length).every((p) => p.length <= 2000)).toBe(true);
    const g = graphFalsa();
    await new CanalMessenger({ token: 'T', contaId: PAGE }, g.f).enviarTexto('', `fb:${PSID}`, 'palavra '.repeat(400));
    expect(g.pedidos.length).toBe(2);
    const janela = graphFalsa({ erro: { status: 400, code: 10, sub: 2018278 } });
    await expect(new CanalMessenger({ token: 'T', contaId: PAGE }, janela.f).enviarTexto('', `fb:${PSID}`, 'oi')).rejects.toThrow(FORA_DA_JANELA_SOCIAL);
    await expect(new CanalMessenger({ token: 'T', contaId: PAGE }, g.f).enviarTexto('', '5571988124471', 'oi')).rejects.toThrow('PSID');
  });

  it('perfil: nome e foto da cliente (Messenger e Instagram)', async () => {
    const g = graphFalsa();
    const fb = new CanalMessenger({ token: 'T', contaId: PAGE }, g.f);
    expect(await fb.perfil('', `fb:${PSID}`)).toEqual({ nome: 'Marina Souza', fotoUrl: 'https://cdn.falsa/p.jpg' });
    expect(g.pedidos[0]!.url).toBe(`${FB}/${PSID}?fields=first_name,last_name,profile_pic`);
    expect((await fb.buscarFoto('', `fb:${PSID}`))!.conteudo.toString()).toBe('foto');
    expect(await new CanalInstagram({ token: 'IGAA', contaId: IGID }, g.f).perfil('', `ig:${IGSID}`)).toMatchObject({ nome: 'Ana Lima', usuario: 'analima' });
  });
});

describe('Webhooks no servidor', () => {
  async function montar(o: { fila?: boolean } = {}) {
    const conexoes = await conexoesCom(COMPLETO);
    const g = graphFalsa();
    const repo = new RepositorioMemoria();
    const fila = new FilaMemoria();
    const numeros = numerosSociais(conexoes, new Map(), (conta) => (conta.rede === 'messenger' ? new CanalMessenger(conta, g.f) : new CanalInstagram(conta, g.f)));
    const armazem = new ArmazemRastreioMemoria();
    const rastreio = new Rastreio({ armazem, empresaId: 'imperio' });
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, rastreio, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const app = criarServidor({
      sintonia,
      repo,
      ...(o.fila ? { fila: { fila } } : {}),
      sociais: { conexoes, canalDe: (id) => numeros.find((n) => n.canalId === id)?.canal },
    });
    return { app, conexoes, fila, repo, g, sintonia, armazem };
  }
  const postar = (app: Awaited<ReturnType<typeof montar>>['app'], url: string, corpo: unknown, segredo?: string) => {
    const bruto = JSON.stringify(corpo);
    return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...(segredo ? { 'x-hub-signature-256': assinar(bruto, segredo) } : {}) }, payload: bruto });
  };

  it('verificação GET hub.challenge com o Verify Token de cada rede', async () => {
    const { app, conexoes } = await montar();
    for (const rede of ['messenger', 'instagram'] as const) {
      const token = conexoes.get(`${rede}VerifyToken`)!;
      expect(token).toMatch(/^sintonia-[a-f0-9]{32}$/);
      const ok = await app.inject({ url: `/webhook/${rede}?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4321` });
      expect([ok.statusCode, ok.body]).toEqual([200, '4321']);
      expect((await app.inject({ url: `/webhook/${rede}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1` })).statusCode).toBe(403);
    }
    // O token de uma rede não vale na outra.
    expect((await app.inject({ url: `/webhook/instagram?hub.mode=subscribe&hub.verify_token=${conexoes.get('messengerVerifyToken')}&hub.challenge=1` })).statusCode).toBe(403);
  });

  it('assinatura X-Hub-Signature-256: sem ou errada = 401; a do outro app = 401; certa entra na fila', async () => {
    const { app, fila } = await montar({ fila: true });
    const corpo = msgMessenger('Oi');
    expect((await postar(app, '/webhook/messenger', corpo)).statusCode).toBe(401);
    expect((await postar(app, '/webhook/messenger', corpo, 'outro')).statusCode).toBe(401);
    expect((await postar(app, '/webhook/messenger', corpo, 'seg-ig')).statusCode).toBe(401);
    const ok = await postar(app, '/webhook/messenger', corpo, 'seg-fb');
    expect(ok.json()).toEqual({ recebidas: 1 });
    const [item] = await fila.reivindicar(new Date(), 10);
    expect(item!.mensagem).toMatchObject({ canalId: `fb-${PAGE}`, telefone: `fb:${PSID}`, nome: 'Marina Souza' });
    // Página que não é a configurada: ignorada.
    const outra = { ...corpo, entry: [{ ...corpo.entry[0]!, id: '999' }] };
    expect((await postar(app, '/webhook/messenger', outra, 'seg-fb')).json()).toEqual({ recebidas: 0 });
  });

  it('Messenger e Instagram viram mensagens na conversa certa (unidade, canal, nome, origem)', async () => {
    const { app, repo, armazem } = await montar();
    await postar(app, '/webhook/messenger', msgMessenger('Quero agendar'), 'seg-fb');
    await postar(app, '/webhook/instagram', msgInstagram({ mid: 'ig_1', text: 'Oi pelo Insta' }), 'seg-ig');
    await new Promise((r) => setTimeout(r, 50));
    const conversas = await repo.listarConversas();
    const fb = conversas.find((c) => c.telefone === `fb:${PSID}`)!;
    const ig = conversas.find((c) => c.telefone === `ig:${IGSID}`)!;
    expect(fb).toMatchObject({ canalId: `fb-${PAGE}`, unidade: 'sumare', nome: 'Marina Souza' });
    expect(ig).toMatchObject({ canalId: `ig-${IGID}`, unidade: 'norte', nome: 'Ana Lima' });
    expect((await repo.mensagens(fb.id)).map((m) => [m.autor, m.texto])).toEqual([['cliente', 'Quero agendar']]);
    expect((await repo.mensagens(ig.id)).map((m) => m.texto)).toEqual(['Oi pelo Insta']);
    expect((await armazem.origem(fb.id)).primeiro).toMatchObject({ canal: 'organico', fonte: 'facebook' });
    expect((await armazem.origem(ig.id)).primeiro).toMatchObject({ canal: 'organico', fonte: 'instagram' });
  });

  it('resposta da loja sai pelo Messenger dentro da janela; fora dela é recusada', async () => {
    const { app, repo, sintonia, g } = await montar();
    await postar(app, '/webhook/messenger', msgMessenger('Oi'), 'seg-fb');
    await new Promise((r) => setTimeout(r, 50));
    const c = (await repo.listarConversas())[0]!;
    c.ultimaMensagemCliente = new Date();
    await repo.salvarConversa(c);
    expect(sintonia.janelaDa(c)).toMatchObject({ canal: 'messenger', aberta: true });
    await sintonia.equipeEnviou(c.id, 'Temos horário amanhã!', 'Bruno');
    expect(g.pedidos.filter((p) => p.metodo === 'POST').at(-1)).toMatchObject({ url: `${FB}/${PAGE}/messages`, corpo: { recipient: { id: PSID }, message: { text: 'Temos horário amanhã!' } } });
    c.ultimaMensagemCliente = new Date(Date.now() - 25 * 3600_000);
    await repo.salvarConversa(c);
    await expect(sintonia.equipeEnviou(c.id, 'Oi de novo', 'Bruno')).rejects.toThrow(FORA_DA_JANELA_SOCIAL);
  });

  it('TikTok: leads com o token da URL (ou TikTok-Signature); sem token = 401', async () => {
    const { app, conexoes } = await montar();
    const lead = { lead_id: 'L1', ad_id: 'A9', create_time: 1793980000, field_data: [{ name: 'full_name', value: 'Bia' }, { name: 'phone_number', value: '+55 71 98812-4471' }, { name: 'email', value: 'bia@x.com' }] };
    expect((await postar(app, '/webhook/tiktok', lead)).statusCode).toBe(401);
    const r = await postar(app, `/webhook/tiktok?token=${conexoes.get('tiktokVerifyToken')}`, lead);
    expect(r.json()).toEqual({ recebidos: 1 });
    expect(lerLeadsTikTok({ leads: [lead] })[0]).toMatchObject({ leadId: 'L1', nome: 'Bia', telefone: '5571988124471', email: 'bia@x.com', adId: 'A9' });
    const t = 1793980000;
    const sig = createHmac('sha256', 'segredo').update(`${t}.{"a":1}`).digest('hex');
    expect(assinaturaTikTokValida('{"a":1}', `t=${t},s=${sig}`, 'segredo', t)).toBe(true);
    expect(assinaturaTikTokValida('{"a":2}', `t=${t},s=${sig}`, 'segredo', t)).toBe(false);
    await expect(new CanalTikTok().enviarTexto()).rejects.toThrow('aprovação do TikTok');
  });
});

describe('Tela de Conexões (redes sociais)', () => {
  async function montar(valores: Record<string, string>) {
    const conexoes = await conexoesCom(valores);
    const g = graphFalsa();
    const repo = new RepositorioMemoria();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const app = criarServidor({ sintonia, repo, conexoes: { conexoes, testarIA: async () => {}, testarTrinks: async () => ({ resumo: '' }), fetchFn: g.f } });
    return { app, g };
  }

  it('status ligado / desligado / falta X, URL do webhook e nenhum segredo na resposta', async () => {
    const { app } = await montar({ messengerLigado: '1', messengerPageId: PAGE, messengerToken: 'EAASEGREDO', instagramLigado: '1', instagramAccountId: IGID });
    const r = await app.inject({ url: '/api/conexoes/sociais', headers: { host: 'sintonia.exemplo.com' } });
    const { redes } = r.json() as { redes: Array<{ rede: string; status: string; faltando: string[]; webhookUrl: string }> };
    expect(redes.map((x) => [x.rede, x.status])).toEqual([['messenger', 'falta'], ['instagram', 'falta'], ['tiktok', 'desligado']]);
    expect(redes[0]!.faltando).toEqual(['App Secret']);
    expect(redes[1]!.faltando).toEqual(['token de acesso', 'App Secret']);
    expect(redes[0]!.webhookUrl).toBe('https://sintonia.exemplo.com/webhook/messenger');
    expect(redes[2]!.webhookUrl).toMatch(/^https:\/\/sintonia\.exemplo\.com\/webhook\/tiktok\?token=sintonia-/);
    expect(r.body).not.toContain('EAASEGREDO');
    const resumo = await app.inject({ url: '/api/conexoes' });
    expect(resumo.body).not.toContain('EAASEGREDO');
    expect(resumo.json().campos.messengerToken).toEqual({ definido: true, final: 'REDO' });
  });

  it('salva pelo PUT e "Testar" consulta a Página / a conta do Instagram', async () => {
    const { app, g } = await montar({});
    const put = await app.inject({ method: 'PUT', url: '/api/conexoes', payload: { messengerPageId: PAGE, messengerToken: 'EAAP', instagramAccountId: IGID, instagramToken: 'IGAAT' } });
    expect(put.statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: '/api/conexoes', payload: { messengerPageId: 'abc' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/conexoes/sociais/messenger/testar' })).json()).toMatchObject({ ok: true, nome: 'Império Norte' });
    expect((await app.inject({ method: 'POST', url: '/api/conexoes/sociais/instagram/testar' })).json()).toMatchObject({ ok: true, nome: '@imperio' });
    expect(g.pedidos.map((p) => p.url)).toEqual([`${FB}/${PAGE}?fields=name,id`, `${IG}/me?fields=user_id,username,name`]);
    const novo = await app.inject({ method: 'POST', url: '/api/conexoes/sociais/instagram/verify-token' });
    expect(novo.json().verifyToken).toMatch(/^sintonia-/);
  });
});
