import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { Sintonia } from '../src/app/sintonia.js';
import { lerWebhookEvolution } from '../src/channels/evolution.js';
import { lerWebhookMeta } from '../src/channels/meta.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { observarEventos } from '../src/notificacoes/notificador.js';
import { ArmazemRastreioMemoria, ArmazemRastreioPostgres, type ArmazemRastreio } from '../src/rastreio/armazem.js';
import { Capi, sha256 } from '../src/rastreio/capi.js';
import { iconeDe, Rastreio } from '../src/rastreio/rastreio.js';
import { codigoNaMensagem, referenciaDaEvolution, referenciaDaMeta, tirarCodigo } from '../src/rastreio/referencia.js';
import { configCapiDe, registrarRastreio } from '../src/rastreio/rotas.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

// ---------- payloads de exemplo (formato real dos webhooks) ----------

const AD_ID = '120212345678900123';
const CTWA = 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfJBzdGxdwXJHE5yGHs6Lj';

/** Evolution v2 (Baileys): anúncio no contextInfo do extendedTextMessage e repetido em data.contextInfo. */
const webhookEvolutionAnuncio = (comDataContext = true) => {
  const contextInfo = {
    conversionSource: 'FB_Ads',
    conversionDelaySeconds: 7,
    externalAdReply: {
      title: 'Progressiva sem formol 💙',
      body: 'Agende sua avaliação grátis no Norte Shopping',
      mediaType: 1,
      thumbnailUrl: 'https://scontent.xx.fbcdn.net/v/t45.1600-4/miniatura.jpg',
      sourceType: 'ad',
      sourceId: AD_ID,
      sourceUrl: 'https://www.instagram.com/p/C9xyz/?utm_source=meta&utm_campaign=Progressiva%20Nov',
      containsAutoReply: false,
      renderLargerThumbnail: true,
      showAdAttribution: true,
      ctwaClid: CTWA,
    },
    entryPointConversionSource: 'ctwa_ad',
    entryPointConversionApp: 'instagram',
    entryPointConversionDelaySeconds: 7,
  };
  return {
    event: 'messages.upsert',
    instance: 'imperio-norte',
    data: {
      key: { remoteJid: '5571988124471@s.whatsapp.net', fromMe: false, id: '3EB0C431C26A1916E07E' },
      pushName: 'Marina',
      status: 'DELIVERY_ACK',
      message: { extendedTextMessage: { text: 'Olá! Tenho interesse e queria mais informações, por favor.', contextInfo }, messageContextInfo: { deviceListMetadataVersion: 2 } },
      ...(comDataContext ? { contextInfo } : {}),
      messageType: 'extendedTextMessage',
      messageTimestamp: 1762437600,
      instanceId: 'a1b2',
      source: 'android',
    },
  };
};

/** Cloud API: messages[].referral. */
const webhookMetaAnuncio = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '557133334444', phone_number_id: '106540352242922' },
            contacts: [{ profile: { name: 'Joana' }, wa_id: '5571999990000' }],
            messages: [
              {
                from: '5571999990000',
                id: 'wamid.HBgLMTU1NTEyMzQ1NjcVAgASGBQzQUUzRjQwQjgwMjk2RjU0MTg4MAA=',
                timestamp: '1762437600',
                type: 'text',
                text: { body: 'Oi, vi o anúncio da progressiva' },
                referral: {
                  source_url: 'https://fb.me/2ZQ8kL3m1',
                  source_id: AD_ID,
                  source_type: 'ad',
                  headline: 'Progressiva sem formol',
                  body: 'Agende sua avaliação',
                  media_type: 'image',
                  image_url: 'https://scontent.xx.fbcdn.net/v/imagem.jpg',
                  thumbnail_url: 'https://scontent.xx.fbcdn.net/v/miniatura.jpg',
                  ctwa_clid: CTWA,
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe('Leitura do anúncio de clique para WhatsApp', () => {
  it('Evolution: externalAdReply dentro da mensagem e no data.contextInfo', () => {
    for (const dataCtx of [true, false]) {
      const [m] = lerWebhookEvolution(webhookEvolutionAnuncio(dataCtx));
      expect(m!.texto).toBe('Olá! Tenho interesse e queria mais informações, por favor.');
      expect(m!.referencia).toEqual({
        via: 'evolution',
        tipo: 'ad',
        adId: AD_ID,
        url: 'https://www.instagram.com/p/C9xyz/?utm_source=meta&utm_campaign=Progressiva%20Nov',
        titulo: 'Progressiva sem formol 💙',
        texto: 'Agende sua avaliação grátis no Norte Shopping',
        midiaTipo: 'image',
        miniaturaUrl: 'https://scontent.xx.fbcdn.net/v/t45.1600-4/miniatura.jpg',
        ctwaClid: CTWA,
        app: 'instagram',
        fonteConversao: 'FB_Ads',
      });
    }
  });

  it('Evolution: mensagem comum não tem anúncio; contextInfo de resposta (quotedMessage) também não', () => {
    const w = webhookEvolutionAnuncio();
    const ctx = { stanzaId: 'X', participant: '557199@s.whatsapp.net', quotedMessage: { conversation: 'oi' } };
    w.data.message = { extendedTextMessage: { text: 'Respondendo', contextInfo: ctx as never }, messageContextInfo: { deviceListMetadataVersion: 2 } };
    (w.data as Record<string, unknown>).contextInfo = ctx;
    expect(lerWebhookEvolution(w)[0]!.referencia).toBeUndefined();
    expect(referenciaDaEvolution({ message: { conversation: 'oi' } })).toBeUndefined();
  });

  it('Evolution: anúncio só com conversionSource e imagem com legenda', () => {
    const r = referenciaDaEvolution({ message: { imageMessage: { caption: 'oi', contextInfo: { entryPointConversionSource: 'ctwa_ad', entryPointConversionApp: 'facebook' } } } });
    expect(r).toMatchObject({ via: 'evolution', tipo: 'ad', app: 'facebook', fonteConversao: 'ctwa_ad' });
  });

  it('API oficial: referral', () => {
    const [m] = lerWebhookMeta(webhookMetaAnuncio);
    expect(m!.referencia).toEqual({
      via: 'meta',
      tipo: 'ad',
      adId: AD_ID,
      url: 'https://fb.me/2ZQ8kL3m1',
      titulo: 'Progressiva sem formol',
      texto: 'Agende sua avaliação',
      midiaTipo: 'image',
      midiaUrl: 'https://scontent.xx.fbcdn.net/v/imagem.jpg',
      miniaturaUrl: 'https://scontent.xx.fbcdn.net/v/miniatura.jpg',
      ctwaClid: CTWA,
    });
    expect(referenciaDaMeta(undefined)).toBeUndefined();
    expect(referenciaDaMeta({ headline: 'só título' })).toBeUndefined();
  });

  it('ícone da origem: anúncio/UTM > link > IA > desconhecido; Instagram x Facebook pelo posicionamento', () => {
    const em = new Date();
    expect(iconeDe(undefined)).toBe('desconhecido');
    expect(iconeDe({ canal: 'anuncio_meta', origemPor: 'automatico', fonte: 'instagram', em })).toBe('instagram');
    expect(iconeDe({ canal: 'anuncio_meta', origemPor: 'automatico', anuncioUrl: 'https://fb.me/x', em })).toBe('facebook');
    expect(iconeDe({ canal: 'anuncio_meta', origemPor: 'automatico', utmSource: 'ig', em })).toBe('instagram');
    expect(iconeDe({ canal: 'link', origemPor: 'automatico', gclid: 'abc', em })).toBe('google_ads');
    expect(iconeDe({ canal: 'link', origemPor: 'automatico', utmSource: 'google', em })).toBe('google_ads');
    expect(iconeDe({ canal: 'link', origemPor: 'automatico', utmSource: 'instagram', em })).toBe('instagram');
    expect(iconeDe({ canal: 'link', origemPor: 'automatico', em })).toBe('desconhecido');
    expect(iconeDe({ canal: 'indicacao', origemPor: 'ia', em })).toBe('indicacao');
    expect(iconeDe({ canal: 'organico', origemPor: 'ia', fonte: 'loja', em })).toBe('estabelecimento');
    expect(iconeDe({ canal: 'organico', origemPor: 'ia', em })).toBe('whatsapp');
  });

  it('código do link: reconhece e tira do texto só quando sobra mensagem', () => {
    expect(codigoNaMensagem('Olá! Quero saber mais (ref: a7k2x)')).toBe('A7K2X');
    expect(codigoNaMensagem('sem código')).toBeUndefined();
    expect(tirarCodigo('Olá! Quero saber mais (ref: A7K2X)')).toBe('Olá! Quero saber mais');
    expect(tirarCodigo('(ref: A7K2X)')).toBe('(ref: A7K2X)');
  });
});

// ---------- ambiente com Sintonia + rastreio + CAPI ----------

interface Amb {
  nome: string;
  criar(): Promise<{ repo: Repositorio; armazem: ArmazemRastreio; pool?: pg.Pool }>;
}
const ambientes: Amb[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), armazem: new ArmazemRastreioMemoria() }) },
  ...(temPostgres
    ? [{ nome: 'postgres', criar: async () => { const pool = await poolDeTeste(); return { repo: new RepositorioPostgres(pool), armazem: new ArmazemRastreioPostgres(pool), pool }; } }]
    : []),
];

async function montar(amb: Amb, opcoes: { capiLigada?: boolean; respostas?: Array<{ status: number; corpo: unknown } | Error> } = {}) {
  const { repo: base, armazem } = await amb.criar();
  const repo = base;
  const relogio = { t: bahia(2026, 11, 6, 10) };
  const agora = () => relogio.t;
  const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await conexoes.carregar();
  if (opcoes.capiLigada !== false) {
    await conexoes.salvar({ capiLigado: '1', capiDatasetId: '987654321', capiToken: 'TOKEN-CAPI', capiWabaId: '102290129340398', capiVersao: 'v27.0', metaAdsToken: 'TOKEN-ADS' }, 'teste');
  }
  const chamadas: Array<{ url: string; corpo: Record<string, unknown> | null }> = [];
  const respostas = opcoes.respostas ?? [];
  const fetchFalso = (async (url: string, init?: RequestInit) => {
    const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    chamadas.push({ url, corpo });
    if (url.includes(`/${AD_ID}?fields=`)) {
      return new Response(JSON.stringify({ id: AD_ID, name: 'Criativo Antes e Depois', adset: { id: '1202', name: 'Salvador 25-45' }, campaign: { id: '1201', name: 'Progressiva Nov' } }), { status: 200 });
    }
    const r = respostas.shift() ?? { status: 200, corpo: { events_received: 1, fbtrace_id: 'AbC' } };
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo), { status: r.status });
  }) as typeof fetch;
  const capi = new Capi({ armazem, config: () => configCapiDe(conexoes), buscarConversa: (id) => repo.buscarConversa(id), ficha: async () => ({ email: ' Marina@Exemplo.com ', valor: 350 }), agora, fetchFn: fetchFalso });
  observarEventos(repo, (e) => capi.aoEvento(e));
  const rastreio = new Rastreio({ armazem, empresaId: 'imperio', capi, agora, fetchFn: fetchFalso, graph: () => ({ token: conexoes.get('metaAdsToken'), versao: 'v27.0' }) });
  const canal: CanalWhatsApp = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: `out-${Math.random()}` }) };
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: { executar: async () => ({ texto: 'Oi!', acoes: [], recusou: false }) },
    agora,
    rastreio,
    configIa: async () => ({ modoPadrao: 'humano' }),
  });
  const app = criarServidor({ sintonia, repo, agora, origens: (ids) => rastreio.selos(ids) });
  registrarRastreio(app, { repo, rastreio, capi, conexoes, empresaId: 'imperio', agora });
  let n = 0;
  const receber = (m: Partial<MensagemRecebida>) =>
    sintonia.receber({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina', texto: 'Oi', deMim: false, idExterno: `in-${++n}-${Math.random()}`, em: relogio.t, ...m });
  const conversa = async (telefone = '5571988124471') => (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  const enviosCapi = () => chamadas.filter((c) => c.url.includes('/events?'));
  return { repo, armazem, conexoes, capi, rastreio, sintonia, app, receber, conversa, chamadas, enviosCapi, relogio };
}

const etapa = (repo: Repositorio, conversaId: string, para: string, em: Date) => repo.registrarEvento({ tipo: 'etapa_mudou', conversaId, unidade: 'norte', em, dados: { de: 'em_conversa', para } });

describe.each(ambientes)('Origem do lead e CAPI ($nome)', (amb) => {
  it('anúncio pela Evolution: primeiro toque fixo, nomes da Graph API e Lead na CAPI (business_messaging)', async () => {
    const x = await montar(amb);
    const [m] = lerWebhookEvolution(webhookEvolutionAnuncio());
    await x.sintonia.receber(m!);
    const c = await x.conversa();
    await x.rastreio.buscarNomes(AD_ID);
    await x.capi.ocioso();
    const { primeiro, ultimo } = await x.armazem.origem(c.id);
    expect(primeiro).toMatchObject({
      canal: 'anuncio_meta', origemPor: 'automatico', fonte: 'instagram', adId: AD_ID, ctwaClid: CTWA, anuncioTitulo: 'Progressiva sem formol 💙',
      utmSource: 'meta', utmCampaign: 'Progressiva Nov', adNome: 'Criativo Antes e Depois', adsetNome: 'Salvador 25-45', campaignNome: 'Progressiva Nov', campaignId: '1201',
    });
    expect(ultimo?.adId).toBe(AD_ID);
    // Busca de nomes: uma vez, com o token de anúncios.
    const graph = x.chamadas.filter((ch) => ch.url.includes('?fields='));
    expect(graph).toHaveLength(1);
    expect(graph[0]!.url).toContain('access_token=TOKEN-ADS');

    const lead = x.enviosCapi();
    expect(lead).toHaveLength(1);
    expect(lead[0]!.url).toBe('https://graph.facebook.com/v27.0/987654321/events?access_token=TOKEN-CAPI');
    const ev = (lead[0]!.corpo!.data as Array<Record<string, unknown>>)[0]!;
    expect(ev).toMatchObject({
      event_name: 'LeadSubmitted', action_source: 'business_messaging', messaging_channel: 'whatsapp', event_id: `sintonia-lead-${c.id}`,
      user_data: { whatsapp_business_account_id: '102290129340398', ctwa_clid: CTWA },
    });
    expect((ev.user_data as Record<string, unknown>).ph).toBeUndefined();

    // Selo.
    const selos = (await x.app.inject({ method: 'GET', url: '/api/rastreio/selos' })).json();
    expect(selos[c.id]).toMatchObject({ icone: 'instagram', canal: 'anuncio_meta', rotulo: 'Anúncio · Progressiva Nov' });
    const lista = (await x.app.inject({ method: 'GET', url: '/api/conversas' })).json();
    expect(lista.find((l: { id: string }) => l.id === c.id).origem).toMatchObject({ icone: 'instagram' });
    const ficha = (await x.app.inject({ method: 'GET', url: `/api/conversas/${c.id}/origem` })).json();
    expect(ficha.primeiro.adsetNome).toBe('Salvador 25-45');

    // Mensagem seguinte comum não muda nada; outra campanha mais tarde muda só o último toque.
    await x.receber({ texto: 'Quanto custa?' });
    const outro = webhookEvolutionAnuncio();
    outro.data.key.id = 'OUTRO';
    outro.data.message.extendedTextMessage.contextInfo.externalAdReply.sourceId = '555555555';
    (outro.data.contextInfo as { externalAdReply: { sourceId: string } }).externalAdReply.sourceId = '555555555';
    await x.sintonia.receber(lerWebhookEvolutionAnuncio(outro));
    const depois = await x.armazem.origem(c.id);
    expect(depois.primeiro?.adId).toBe(AD_ID);
    expect(depois.ultimo?.adId).toBe('555555555');
  });

  it('anúncio pela API oficial (referral) e mudanças de etapa: Schedule/Purchase com event_id estável', async () => {
    const x = await montar(amb);
    const [m] = lerWebhookMeta(webhookMetaAnuncio);
    await x.sintonia.receber({ ...m!, canalId: 'imperio-norte' });
    const c = await x.conversa('5571999990000');
    expect((await x.armazem.origem(c.id)).primeiro).toMatchObject({ canal: 'anuncio_meta', adId: AD_ID, ctwaClid: CTWA, anuncioMiniatura: 'https://scontent.xx.fbcdn.net/v/miniatura.jpg' });
    await etapa(x.repo, c.id, 'interessada', x.relogio.t);
    await etapa(x.repo, c.id, 'agendada', x.relogio.t);
    await etapa(x.repo, c.id, 'agendada', x.relogio.t); // repetido: não duplica
    await etapa(x.repo, c.id, 'compareceu', x.relogio.t);
    await etapa(x.repo, c.id, 'perdida', x.relogio.t); // sem evento
    await new Promise((r) => setTimeout(r, 50));
    await x.capi.ocioso();
    await x.capi.tick();
    const nomes = x.enviosCapi().map((e) => (e.corpo!.data as Array<{ event_name: string; event_id: string }>)[0]!);
    expect(nomes.map((e) => e.event_name).sort()).toEqual(['LeadSubmitted', 'OrderCreated', 'Purchase', 'QualifiedLead']);
    expect(nomes.find((e) => e.event_name === 'OrderCreated')!.event_id).toBe(`sintonia-agendada-${c.id}`);
    const compra = x.enviosCapi().map((e) => (e.corpo!.data as Array<Record<string, unknown>>)[0]!).find((e) => e.event_name === 'Purchase')!;
    expect(compra.custom_data).toEqual({ currency: 'BRL', value: 350 });
    const registro = await x.armazem.eventosCapi(10);
    expect(registro.every((e) => e.situacao === 'enviado')).toBe(true);
  });

  it('link rastreado: clique → código na mensagem → conversa ligada, UTMs do endereço e Lead com hash', async () => {
    const x = await montar(amb);
    const cria = await x.app.inject({ method: 'POST', url: '/api/rastreio/links', payload: { nome: 'Link Bio', codigo: 'bio', unidade: 'norte', numero: '55 71 99999-8888', utmSource: 'instagram', utmMedium: 'bio', utmCampaign: 'perfil' } });
    expect(cria.statusCode).toBe(201);
    expect((await x.app.inject({ method: 'POST', url: '/api/rastreio/links', payload: { nome: 'Outro', codigo: 'bio', unidade: 'norte', numero: '5571999998888' } })).statusCode).toBe(409);

    const r = await x.app.inject({ method: 'GET', url: '/l/bio?utm_campaign=Progressiva%20Nov&fbclid=IwAR123abc', headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } });
    expect(r.statusCode).toBe(302);
    const destino = new URL(r.headers.location as string);
    expect(destino.origin + destino.pathname).toBe('https://wa.me/5571999998888');
    const texto = destino.searchParams.get('text')!;
    const ref = codigoNaMensagem(texto)!;
    expect(texto).toBe(`Olá! Quero saber mais sobre a progressiva. (ref: ${ref})`);
    // Robô de pré-visualização não conta clique; link desconhecido é 404 e não revela nada.
    expect((await x.app.inject({ method: 'GET', url: '/l/bio', headers: { 'user-agent': 'facebookexternalhit/1.1' } })).headers.location).toBe('https://wa.me/5571999998888?text=Ol%C3%A1!%20Quero%20saber%20mais%20sobre%20a%20progressiva.');
    expect((await x.app.inject({ method: 'GET', url: '/l/nada' })).statusCode).toBe(404);

    await x.receber({ telefone: '5571977776666', nome: 'Paula', texto });
    const c = await x.conversa('5571977776666');
    const msgs = await x.repo.mensagens(c.id);
    expect(msgs[0]!.texto).toBe('Olá! Quero saber mais sobre a progressiva.');
    const { primeiro } = await x.armazem.origem(c.id);
    expect(primeiro).toMatchObject({ canal: 'link', detalhe: 'Link Bio', codigo: ref, utmSource: 'instagram', utmMedium: 'bio', utmCampaign: 'Progressiva Nov', fbclid: 'IwAR123abc' });
    const links = (await x.app.inject({ method: 'GET', url: '/api/rastreio/links' })).json().links;
    expect(links[0]).toMatchObject({ codigo: 'bio', cliques: 1, leads: 1 });

    await x.capi.ocioso();
    const ev = (x.enviosCapi()[0]!.corpo!.data as Array<Record<string, unknown>>)[0]!;
    expect(ev).toMatchObject({ event_name: 'Lead', action_source: 'system_generated', event_id: `sintonia-lead-${c.id}`, custom_data: { content_name: 'Progressiva Nov' } });
    const ud = ev.user_data as Record<string, unknown>;
    expect(ud.ph).toEqual([sha256('5571977776666')]);
    expect(ud.em).toEqual([sha256('marina@exemplo.com')]);
    expect(ud.external_id).toEqual([sha256(c.id)]);
    expect(ud.fbc).toMatch(/^fb\.1\.\d{13}\.IwAR123abc$/);
  });

  it('CAPI desligada: nada é enfileirado nem enviado; conversa orgânica também não gera evento', async () => {
    const x = await montar(amb, { capiLigada: false });
    const [m] = lerWebhookEvolution(webhookEvolutionAnuncio());
    await x.sintonia.receber(m!);
    const c = await x.conversa();
    await etapa(x.repo, c.id, 'agendada', x.relogio.t);
    await x.capi.tick();
    expect(x.enviosCapi()).toHaveLength(0);
    expect(await x.armazem.eventosCapi(10)).toHaveLength(0);

    const y = await montar(amb);
    await y.receber({ telefone: '5571911112222', texto: 'Oi, quanto é a progressiva?' });
    const org = await y.conversa('5571911112222');
    await etapa(y.repo, org.id, 'agendada', y.relogio.t);
    await y.capi.tick();
    expect(y.enviosCapi()).toHaveLength(0);
  });

  it('novas tentativas: rede fora e 500 voltam para a fila com espera; 400 vira erro; reenviar', async () => {
    const x = await montar(amb, { respostas: [new Error('ECONNRESET'), { status: 500, corpo: { error: { message: 'fora' } } }, { status: 200, corpo: { events_received: 1 } }] });
    const [m] = lerWebhookEvolution(webhookEvolutionAnuncio());
    await x.sintonia.receber(m!);
    await x.capi.ocioso();
    let [e] = await x.armazem.eventosCapi(1);
    expect(e).toMatchObject({ situacao: 'pendente', tentativas: 1 });
    expect(e!.resposta).toContain('ECONNRESET');
    expect(await x.capi.tick()).toBe(0); // ainda não venceu
    x.relogio.t = new Date(x.relogio.t.getTime() + 61_000);
    await x.capi.tick();
    [e] = await x.armazem.eventosCapi(1);
    expect(e).toMatchObject({ situacao: 'pendente', tentativas: 2 });
    expect(e!.resposta).toContain('500');
    x.relogio.t = new Date(x.relogio.t.getTime() + 6 * 60_000);
    await x.capi.tick();
    [e] = await x.armazem.eventosCapi(1);
    expect(e).toMatchObject({ situacao: 'enviado', tentativas: 3 });

    const y = await montar(amb, { respostas: [{ status: 400, corpo: { error: { message: 'Invalid parameter' } } }] });
    await y.sintonia.receber(lerWebhookEvolution(webhookEvolutionAnuncio())[0]!);
    await y.capi.ocioso();
    const [f] = await y.armazem.eventosCapi(1);
    expect(f).toMatchObject({ situacao: 'erro' });
    expect(f!.resposta).toContain('Invalid parameter');
    expect((await y.app.inject({ method: 'POST', url: `/api/rastreio/capi/eventos/${f!.id}/reenviar` })).statusCode).toBe(200);
    expect((await y.armazem.eventosCapi(1))[0]!.situacao).toBe('enviado');
  });

  it('evento de teste exige o código de teste e manda test_event_code', async () => {
    const x = await montar(amb);
    expect((await x.app.inject({ method: 'POST', url: '/api/rastreio/capi/teste' })).statusCode).toBe(400);
    const put = await x.app.inject({ method: 'PUT', url: '/api/rastreio/capi', payload: { testeCodigo: 'TEST12345' } });
    expect(put.statusCode).toBe(200);
    expect(put.json().token).toEqual({ definido: true, final: 'CAPI' });
    expect(JSON.stringify(put.json())).not.toContain('TOKEN-CAPI');
    const r = await x.app.inject({ method: 'POST', url: '/api/rastreio/capi/teste' });
    expect(r.json().ok).toBe(true);
    expect(x.enviosCapi()[0]!.corpo).toMatchObject({ test_event_code: 'TEST12345', data: [{ event_name: 'Lead', action_source: 'system_generated' }] });
  });

  it('evento personalizado por etapa de funil (etapa_movida)', async () => {
    const x = await montar(amb);
    await x.app.inject({ method: 'PUT', url: '/api/rastreio/capi', payload: { eventos: { ...configCapiDe(x.conexoes).eventos, etapas: [{ etapaId: 'etapa-avaliacao', nome: 'AvaliacaoMarcada', ligado: true }] } } });
    await x.sintonia.receber(lerWebhookEvolutionAnuncio(webhookEvolutionAnuncio()));
    const c = await x.conversa();
    await x.repo.registrarEvento({ tipo: 'etapa_movida', conversaId: c.id, unidade: 'norte', em: x.relogio.t, dados: { funilId: 'f1', de: null, para: 'etapa-avaliacao' } });
    await new Promise((r) => setTimeout(r, 30));
    await x.capi.ocioso();
    const ev = x.enviosCapi().map((e) => (e.corpo!.data as Array<Record<string, unknown>>)[0]!).find((e) => e.event_name === 'AvaliacaoMarcada')!;
    // Nome fora da lista de business messaging: vai pelo caminho do telefone (system_generated).
    expect(ev).toMatchObject({ action_source: 'system_generated', event_id: `sintonia-etapa:etapa-avaliacao-${c.id}` });
  });
});

function lerWebhookEvolutionAnuncio(w: ReturnType<typeof webhookEvolutionAnuncio>): MensagemRecebida {
  return lerWebhookEvolution(w)[0]!;
}
