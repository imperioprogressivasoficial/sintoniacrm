import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Midias } from '../src/app/midias.js';
import { Sintonia, type NumeroConectado } from '../src/app/sintonia.js';
import { CanalMeta, FORA_DA_JANELA, lerStatusMeta } from '../src/channels/meta.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import { numerosDasConexoes, opcoesWebhookMeta } from '../src/conexoes/numeros.js';
import { FilaMemoria } from '../src/fila/entrada.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { fabricas } from './repos.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TEL = '5571988124471';

interface Pedido {
  metodo: string;
  url: string;
  auth?: string;
  corpo?: unknown;
  form?: FormData;
}

/** Graph API falsa: responde por rota e guarda os pedidos. Nunca vai à rede. */
function graphFalsa(opcoes: { erroEnvio?: { status: number; code: number; message: string } } = {}) {
  const pedidos: Pedido[] = [];
  let seq = 0;
  const f = (async (url: string, init?: RequestInit) => {
    const metodo = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const form = init?.body instanceof FormData ? init.body : undefined;
    const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidos.push({ metodo, url, auth: headers.authorization, corpo, form });
    const u = new URL(url);
    const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'cdn.meta.falsa') return new Response(Buffer.from('bytes-da-foto'), { headers: { 'content-type': 'image/jpeg' } });
    const p = u.pathname.replace('/v21.0/', '');
    if (metodo === 'POST' && p.endsWith('/messages')) {
      if (opcoes.erroEnvio && corpo?.type !== 'template' && !corpo?.status) {
        return json({ error: { message: opcoes.erroEnvio.message, code: opcoes.erroEnvio.code } }, opcoes.erroEnvio.status);
      }
      return json(corpo?.status ? { success: true } : { messaging_product: 'whatsapp', messages: [{ id: `wamid.SAIDA${++seq}` }] });
    }
    if (metodo === 'POST' && p.endsWith('/media')) return json({ id: 'MIDIA-SUBIDA' });
    if (p === 'MIDIA-1') return json({ url: 'https://cdn.meta.falsa/arquivo?x=1', mime_type: 'image/jpeg', file_size: 13 });
    if (p.endsWith('/message_templates')) {
      return json({
        data: [
          { name: 'lembrete_horario', language: 'pt_BR', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Oi {{1}}, seu horário é {{2}}.' }] },
          { name: 'rascunho', language: 'pt_BR', category: 'MARKETING', status: 'PENDING', components: [] },
        ],
      });
    }
    if (p === '1122') return json({ display_phone_number: '+55 71 3333-0000', verified_name: 'Império Norte', quality_rating: 'GREEN' });
    return json({ error: { message: 'não achei', code: 100 } }, 404);
  }) as typeof fetch;
  return { f, pedidos };
}

const assinar = (corpo: string, segredo: string) => 'sha256=' + createHmac('sha256', segredo).update(corpo).digest('hex');

function webhook(phoneId: string, extra: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneId, display_phone_number: '557133330000' }, ...extra } }] }],
  };
}
const msgTexto = (id: string, texto: string, ts = '1793980000') => ({
  contacts: [{ wa_id: TEL, profile: { name: 'Marina' } }],
  messages: [{ from: TEL, id, timestamp: ts, type: 'text', text: { body: texto } }],
});

async function conexoesCom(valores: Record<string, string>) {
  const c = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await c.carregar();
  await c.salvar(valores, 'teste');
  return c;
}

describe('Canal oficial (Graph API)', () => {
  it('envia texto pelo phone_number_id com o token', async () => {
    const g = graphFalsa();
    const canal = new CanalMeta({ token: 'TOKEN-N' }, g.f);
    const r = await canal.enviarTexto('1122', TEL, 'Oi, Marina!');
    expect(r.idExterno).toBe('wamid.SAIDA1');
    expect(g.pedidos[0]).toMatchObject({
      metodo: 'POST',
      url: `${GRAPH}/1122/messages`,
      auth: 'Bearer TOKEN-N',
      corpo: { messaging_product: 'whatsapp', to: TEL, type: 'text', text: { body: 'Oi, Marina!' } },
    });
  });

  it('mídia: sobe em /media e envia com o id (documento leva nome e legenda; áudio sem legenda)', async () => {
    const g = graphFalsa();
    const canal = new CanalMeta({ token: 'T' }, g.f);
    await canal.enviarMidia('1122', TEL, { tipo: 'documento', conteudo: Buffer.from('%PDF'), mimetype: 'application/pdf', nomeArquivo: 'tabela.pdf', legenda: 'Nossos preços' });
    expect(g.pedidos[0]!.url).toBe(`${GRAPH}/1122/media`);
    expect(g.pedidos[0]!.form!.get('messaging_product')).toBe('whatsapp');
    expect(g.pedidos[0]!.form!.get('type')).toBe('application/pdf');
    expect((g.pedidos[0]!.form!.get('file') as File).name).toBe('tabela.pdf');
    expect(g.pedidos[1]!.corpo).toMatchObject({ to: TEL, type: 'document', document: { id: 'MIDIA-SUBIDA', caption: 'Nossos preços', filename: 'tabela.pdf' } });
    await canal.enviarMidia('1122', TEL, { tipo: 'audio', conteudo: Buffer.from('ogg'), mimetype: 'audio/ogg', legenda: 'x' });
    expect(g.pedidos[3]!.corpo).toMatchObject({ type: 'audio', audio: { id: 'MIDIA-SUBIDA' } });
    expect((g.pedidos[3]!.corpo as { audio: object }).audio).not.toHaveProperty('caption');
  });

  it('modelo aprovado: nome, idioma e parâmetros do corpo', async () => {
    const g = graphFalsa();
    await new CanalMeta({ token: 'T' }, g.f).enviarModelo('1122', TEL, { nome: 'lembrete_horario', idioma: 'pt_BR', parametros: ['Marina', 'amanhã 15h'] });
    expect(g.pedidos[0]!.corpo).toMatchObject({
      type: 'template',
      template: { name: 'lembrete_horario', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Marina' }, { type: 'text', text: 'amanhã 15h' }] }] },
    });
  });

  it('lista só os modelos aprovados da WABA e conta as variáveis', async () => {
    const g = graphFalsa();
    const lista = await new CanalMeta({ token: 'T', wabaId: '9988' }, g.f).listarModelos();
    expect(lista).toEqual([{ nome: 'lembrete_horario', idioma: 'pt_BR', categoria: 'UTILITY', status: 'APPROVED', corpo: 'Oi {{1}}, seu horário é {{2}}.', variaveis: 2 }]);
    expect(g.pedidos[0]!.url).toContain(`${GRAPH}/9988/message_templates`);
    await expect(new CanalMeta({ token: 'T' }, g.f).listarModelos()).rejects.toThrow('Business Account ID');
  });

  it('marca como lida', async () => {
    const g = graphFalsa();
    await new CanalMeta({ token: 'T' }, g.f).marcarLida('1122', 'wamid.ENTRADA');
    expect(g.pedidos[0]!.corpo).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ENTRADA' });
  });

  it('baixa a mídia recebida: pega a url pelo id e baixa com o token', async () => {
    const g = graphFalsa();
    const r = await new CanalMeta({ token: 'TK' }, g.f).baixarMidia('1122', 'wamid.X', 'MIDIA-1');
    expect(r.conteudo.toString()).toBe('bytes-da-foto');
    expect(r.mimetype).toBe('image/jpeg');
    expect(g.pedidos.map((p) => [p.url, p.auth])).toEqual([
      [`${GRAPH}/MIDIA-1`, 'Bearer TK'],
      ['https://cdn.meta.falsa/arquivo?x=1', 'Bearer TK'],
    ]);
  });

  it('erro da Meta vem explicado; fora da janela vira a mensagem clara', async () => {
    const janela = graphFalsa({ erroEnvio: { status: 400, code: 131047, message: 'Re-engagement message' } });
    await expect(new CanalMeta({ token: 'T' }, janela.f).enviarTexto('1122', TEL, 'oi')).rejects.toThrow(FORA_DA_JANELA);
    const token = graphFalsa({ erroEnvio: { status: 401, code: 190, message: 'Invalid OAuth access token' } });
    await expect(new CanalMeta({ token: 'T' }, token.f).enviarTexto('1122', TEL, 'oi')).rejects.toThrow('token de acesso inválido');
  });

  it('lê avisos de entrega e leitura', () => {
    const s = lerStatusMeta(webhook('1122', { statuses: [{ id: 'wamid.S', status: 'read', timestamp: '1793980100', recipient_id: TEL }, { id: 'wamid.F', status: 'failed', timestamp: '1793980100', errors: [{ code: 131047, title: 'Re-engagement' }] }] }));
    expect(s).toEqual([
      { canalId: '1122', idExterno: 'wamid.S', status: 'lida', em: new Date(1793980100 * 1000), telefone: TEL },
      { canalId: '1122', idExterno: 'wamid.F', status: 'falhou', em: new Date(1793980100 * 1000), erro: '131047 Re-engagement' },
    ]);
  });
});

describe('Webhook da API oficial', () => {
  async function montar() {
    const conexoes = await conexoesCom({
      metaPhoneNumberIdNorte: '1122',
      metaTokenNorte: 'TN',
      metaAppSecretNorte: 'segredo-norte',
      metaPhoneNumberIdSumare: '3344',
      metaTokenSumare: 'TS',
      metaAppSecretSumare: 'segredo-sumare',
      canalNorte: 'meta',
      canalSumare: 'meta',
    });
    const repo = new RepositorioMemoria();
    const fila = new FilaMemoria();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const app = criarServidor({ sintonia, repo, fila: { fila }, meta: opcoesWebhookMeta(conexoes, {}, (l) => sintonia.statusRecebidos(l)) });
    return { app, conexoes, fila, repo };
  }
  const postar = (app: Awaited<ReturnType<typeof montar>>['app'], corpo: unknown, segredo?: string, url = '/webhook/meta') => {
    const bruto = JSON.stringify(corpo);
    return app.inject({ method: 'POST', url, headers: { 'content-type': 'application/json', ...(segredo ? { 'x-hub-signature-256': assinar(bruto, segredo) } : {}) }, payload: bruto });
  };

  it('verificação: devolve o hub.challenge só com o Verify Token de uma unidade', async () => {
    const { app, conexoes } = await montar();
    const token = conexoes.get('metaVerifyTokenSumare')!;
    expect(token).toMatch(/^sintonia-[a-f0-9]{32}$/);
    const ok = await app.inject({ url: `/webhook/meta?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1234` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('1234');
    expect((await app.inject({ url: '/webhook/meta?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1' })).statusCode).toBe(403);
    expect((await app.inject({ url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=' + token + '&hub.challenge=9' })).body).toBe('9'); // endereço antigo
  });

  it('assinatura: sem ou errada = 401; certa entra na fila; repetida não duplica', async () => {
    const { app, fila } = await montar();
    const corpo = webhook('1122', msgTexto('wamid.A1', 'Oi, quero agendar'));
    expect((await postar(app, corpo)).statusCode).toBe(401);
    expect((await postar(app, corpo, 'outro')).statusCode).toBe(401);
    const r = await postar(app, corpo, 'segredo-norte');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ recebidas: 1 });
    expect((await postar(app, corpo, 'segredo-norte')).json()).toMatchObject({ recebidas: 0 });
    const [item] = await fila.reivindicar(new Date(), 10);
    expect(item!.mensagem).toEqual({ canalId: '1122', telefone: TEL, nome: 'Marina', texto: 'Oi, quero agendar', deMim: false, idExterno: 'wamid.A1', em: new Date(1793980000 * 1000) });
  });

  it('o App Secret de uma unidade não assina mensagem do número da outra', async () => {
    const { app } = await montar();
    const r = await postar(app, webhook('3344', msgTexto('wamid.B1', 'oi')), 'segredo-norte');
    expect(r.json()).toMatchObject({ recebidas: 0 });
    expect((await postar(app, webhook('3344', msgTexto('wamid.B1', 'oi')), 'segredo-sumare')).json()).toMatchObject({ recebidas: 1 });
  });

  it('áudio, foto, documento e vídeo entram com o anexo e o id da mídia', async () => {
    const { app, fila } = await montar();
    const corpo = webhook('1122', {
      messages: [
        { from: TEL, id: 'wamid.M1', timestamp: '1793980000', type: 'audio', audio: { id: 'AUD', mime_type: 'audio/ogg; codecs=opus', voice: true } },
        { from: '5571977776666', id: 'wamid.M2', timestamp: '1793980000', type: 'image', image: { id: 'IMG', mime_type: 'image/jpeg', caption: 'meu cabelo' } },
        { from: '5571966665555', id: 'wamid.M3', timestamp: '1793980000', type: 'document', document: { id: 'DOC', mime_type: 'application/pdf', filename: 'exame.pdf' } },
        { from: '5571955554444', id: 'wamid.M4', timestamp: '1793980000', type: 'video', video: { id: 'VID', mime_type: 'video/mp4' } },
      ],
    });
    expect((await postar(app, corpo, 'segredo-norte')).json()).toMatchObject({ recebidas: 4 });
    const itens = (await fila.reivindicar(new Date(), 10)).map((i) => [i.mensagem.texto, i.mensagem.anexo]);
    expect(itens).toEqual([
      ['[áudio]', { tipo: 'audio', ref: 'AUD', mimetype: 'audio/ogg; codecs=opus', voz: true }],
      ['[foto] meu cabelo', { tipo: 'imagem', ref: 'IMG', mimetype: 'image/jpeg', legenda: 'meu cabelo' }],
      ['[documento: exame.pdf]', { tipo: 'documento', ref: 'DOC', mimetype: 'application/pdf', nomeArquivo: 'exame.pdf' }],
      ['[vídeo]', { tipo: 'video', ref: 'VID', mimetype: 'video/mp4' }],
    ]);
  });

  it('aviso de leitura fica na mensagem enviada (e não volta atrás)', async () => {
    const { app, repo } = await montar();
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: '1122', telefone: TEL, agora: new Date() });
    await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'equipe', texto: 'Oi!', em: new Date(), idExterno: 'wamid.OUT' });
    const status = (s: string) => webhook('1122', { statuses: [{ id: 'wamid.OUT', status: s, timestamp: '1793980100', recipient_id: TEL }] });
    expect((await postar(app, status('read'), 'segredo-norte')).json()).toMatchObject({ recebidas: 0, status: 1 });
    await postar(app, status('delivered'), 'segredo-norte'); // chegou atrasado
    expect((await repo.mensagens(conversa.id))[0]!.entrega).toBe('lida');
  });
});

/** Canal oficial falso para a Sintonia: guarda o que foi enviado. */
function canalOficialFalso() {
  const g = graphFalsa();
  return { g, canal: new CanalMeta({ token: 'T', wabaId: '9988' }, g.f) };
}

describe.each(fabricas)('Janela de 24 h e modelos ($nome)', ({ criar }) => {
  async function montar(horasDesdeACliente: number) {
    const repo = await criar();
    const { g, canal } = canalOficialFalso();
    const numeros: NumeroConectado[] = [{ canalId: '1122', unidade: 'norte', canal }];
    const agora = new Date('2026-11-07T15:00:00Z');
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora: () => agora });
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: '1122', telefone: TEL, nome: 'Marina', agora });
    const em = new Date(agora.getTime() - horasDesdeACliente * 3600_000);
    await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'cliente', texto: 'oi', em, idExterno: `wamid.CLI${horasDesdeACliente}` });
    await repo.salvarConversa({ ...conversa, modo: 'humano', ultimaMensagemCliente: em });
    return { repo, sintonia, g, conversa };
  }

  it('dentro da janela: texto livre sai e a mensagem da cliente é marcada como lida', async () => {
    const { repo, sintonia, g, conversa } = await montar(23);
    expect(sintonia.janelaDa((await repo.buscarConversa(conversa.id))!).aberta).toBe(true);
    await sintonia.equipeEnviou(conversa.id, 'Oi, Marina!', 'Carla');
    await new Promise((r) => setTimeout(r, 20));
    expect(g.pedidos.map((p) => (p.corpo as { type?: string; status?: string }).type ?? (p.corpo as { status?: string }).status)).toEqual(['text', 'read']);
  });

  it('fora da janela: texto e arquivo falham com a mensagem clara; o modelo passa', async () => {
    const { repo, sintonia, g, conversa } = await montar(25);
    const erro = await sintonia.equipeEnviou(conversa.id, 'Oi?', 'Carla').catch((e) => e);
    expect(erro.message).toBe(FORA_DA_JANELA);
    expect(erro.statusCode).toBe(422);
    await expect(
      sintonia.equipeEnviouMidia(conversa.id, { tipo: 'imagem', conteudo: Buffer.from('x'), mimetype: 'image/jpeg' }, 'Carla'),
    ).rejects.toThrow('Fora da janela de 24h');
    expect(g.pedidos).toHaveLength(0);

    const r = await sintonia.equipeEnviouModelo(conversa.id, { nome: 'lembrete_horario', idioma: 'pt_BR', parametros: ['Marina', 'amanhã 15h'] }, 'Carla');
    expect(r.texto).toBe('Oi Marina, seu horário é amanhã 15h.');
    expect(g.pedidos.at(-1)!.corpo).toMatchObject({ type: 'template' });
    const ultima = (await repo.mensagens(conversa.id)).at(-1)!;
    expect(ultima).toMatchObject({ autor: 'equipe', autorNome: 'Carla', texto: 'Oi Marina, seu horário é amanhã 15h.' });
  });

  it('rotas: a conversa mostra a janela; modelo e lista de modelos pela API', async () => {
    const { repo, sintonia, conversa } = await montar(30);
    const app = criarServidor({ sintonia, repo });
    const det = (await app.inject({ url: `/api/conversas/${conversa.id}` })).json();
    expect(det.janela).toMatchObject({ canal: 'meta', aberta: false });
    const envio = await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/enviar`, payload: { texto: 'oi', atendente: 'Carla' } });
    expect(envio.statusCode).toBe(422);
    expect(envio.json()).toEqual({ erro: FORA_DA_JANELA, codigo: 'fora_da_janela' });
    const modelos = (await app.inject({ url: `/api/conversas/${conversa.id}/modelos` })).json();
    expect(modelos.modelos.map((m: { nome: string }) => m.nome)).toEqual(['lembrete_horario']);
    const m = await app.inject({ method: 'POST', url: `/api/conversas/${conversa.id}/modelo`, payload: { nome: 'lembrete_horario', idioma: 'pt_BR', parametros: ['Marina', '15h'], atendente: 'Carla' } });
    expect(m.json()).toEqual({ ok: true, texto: 'Oi Marina, seu horário é 15h.' });
  });

  it('mídia recebida pela API oficial é baixada pelo id da mídia', async () => {
    const repo = await criar();
    const { g, canal } = canalOficialFalso();
    const numeros: NumeroConectado[] = [{ canalId: '1122', unidade: 'norte', canal }];
    const midias = new Midias(repo, (id) => numeros.find((n) => n.canalId === id)?.canal);
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, midias, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    await sintonia.receber({ canalId: '1122', telefone: TEL, texto: '[foto]', deMim: false, idExterno: 'wamid.FOTO', em: new Date(), anexo: { tipo: 'imagem', mimetype: 'image/jpeg', ref: 'MIDIA-1' } });
    await midias.ocioso();
    await midias.rodada();
    const c = (await repo.listarConversas())[0]!;
    const msg = (await repo.mensagens(c.id)).find((m) => m.idExterno === 'wamid.FOTO')!;
    expect(msg.anexo?.situacao).toBe('pronta');
    expect((await repo.midia(msg.id))!.conteudo!.toString()).toBe('bytes-da-foto');
    expect(g.pedidos[0]!.url).toBe(`${GRAPH}/MIDIA-1`);
  });
});

describe('Escolha de canal por unidade', () => {
  const evolution = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: '' }) } satisfies CanalWhatsApp;

  it('cada unidade usa só a API escolhida; sem escolha fica a não oficial', async () => {
    const c = await conexoesCom({ numeros: JSON.stringify([{ canalId: 'sintonia-norte', unidade: 'norte' }, { canalId: 'sintonia-sumare', unidade: 'sumare' }]) });
    const ver = () => numerosDasConexoes({ conexoes: c, evolution }).map((n) => [n.unidade, n.canalId, n.canal.tipo]);
    expect(ver()).toEqual([
      ['norte', 'sintonia-norte', 'evolution'],
      ['sumare', 'sintonia-sumare', 'evolution'],
    ]);
    await c.salvar({ metaPhoneNumberIdSumare: '3344', metaTokenSumare: 'TS', canalSumare: 'meta' }, 'x');
    expect(ver()).toEqual([
      ['sumare', '3344', 'meta'],
      ['norte', 'sintonia-norte', 'evolution'],
    ]);
    // Oficial escolhida mas incompleta: nenhum número para a unidade (e não cai na Evolution sem querer).
    await c.salvar({ metaTokenSumare: '' }, 'x');
    expect(ver()).toEqual([['norte', 'sintonia-norte', 'evolution']]);
  });

  it('o canal da Meta só é refeito quando o token muda', async () => {
    const c = await conexoesCom({ metaPhoneNumberIdNorte: '1122', metaTokenNorte: 'T1', canalNorte: 'meta' });
    const cache = new Map();
    let criados = 0;
    const criarMeta = () => (criados++, { ...evolution, tipo: 'meta' as const });
    numerosDasConexoes({ conexoes: c, cacheMeta: cache, criarMeta });
    numerosDasConexoes({ conexoes: c, cacheMeta: cache, criarMeta });
    await c.salvar({ metaTokenNorte: 'T2' }, 'x');
    numerosDasConexoes({ conexoes: c, cacheMeta: cache, criarMeta });
    expect(criados).toBe(2);
  });
});

describe('Tela de Conexões: API oficial', () => {
  async function montar() {
    const contas = new ContasMemoria();
    await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash: await gerarHash('Imperio2026xyz') });
    const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
    await conexoes.carregar();
    const g = graphFalsa();
    const repo = new RepositorioMemoria();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const app = criarServidor({ sintonia, repo, auth: { contas }, conexoes: { conexoes, fetchFn: g.f, testarIA: async () => {}, testarTrinks: async () => ({ profissionais: 0 }) } });
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'bruno@imperio.com', senha: 'Imperio2026xyz' } });
    const cookie = String(r.headers['set-cookie']).split(';')[0]!;
    return { app, conexoes, cookie, g };
  }

  it('mostra a URL do webhook e o Verify Token; recusa ligar a oficial sem os dados; testa o número', async () => {
    const { app, conexoes, cookie, g } = await montar();
    const meta = (await app.inject({ url: '/api/conexoes/meta', headers: { cookie, host: 'sintonia.n8nimperio.tech' } })).json();
    expect(meta.webhookUrl).toBe('https://sintonia.n8nimperio.tech/webhook/meta');
    expect(meta.unidades[0]).toMatchObject({ unidade: 'norte', canal: 'evolution', pronta: false, verifyToken: conexoes.get('metaVerifyTokenNorte') });
    expect(meta.unidades[0].faltando).toEqual(['Phone Number ID', 'WhatsApp Business Account ID', 'token de acesso', 'App Secret']);

    const recusa = await app.inject({ method: 'PUT', url: '/api/conexoes', headers: { cookie }, payload: { canalNorte: 'meta' } });
    expect(recusa.statusCode).toBe(400);
    expect(recusa.json().erro).toContain('Phone Number ID');
    expect((await app.inject({ method: 'PUT', url: '/api/conexoes', headers: { cookie }, payload: { metaPhoneNumberIdNorte: 'abc' } })).statusCode).toBe(400);

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/conexoes',
      headers: { cookie },
      payload: { metaPhoneNumberIdNorte: '1122', metaWabaIdNorte: '9988', metaTokenNorte: 'EAAG-segredo-WXYZ', metaAppSecretNorte: 'app-secreto-1234', canalNorte: 'meta' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain('EAAG-segredo');
    expect(ok.body).not.toContain('app-secreto');
    expect(ok.json().canais).toEqual({ norte: 'meta', sumare: 'evolution' });

    const t = (await app.inject({ method: 'POST', url: '/api/conexoes/meta/norte/testar', headers: { cookie }, payload: {} })).json();
    expect(t).toMatchObject({ ok: true, numero: '+55 71 3333-0000', nome: 'Império Norte', modelos: 1 });
    expect(g.pedidos[0]).toMatchObject({ url: expect.stringContaining(`${GRAPH}/1122?fields=`), auth: 'Bearer EAAG-segredo-WXYZ' });
    const modelos = (await app.inject({ url: '/api/conexoes/meta/norte/modelos', headers: { cookie } })).json();
    expect(modelos.modelos).toHaveLength(1);

    const antes = conexoes.get('metaVerifyTokenNorte');
    const novo = (await app.inject({ method: 'POST', url: '/api/conexoes/meta/norte/verify-token', headers: { cookie }, payload: {} })).json();
    expect(novo.verifyToken).not.toBe(antes);
    expect((await app.inject({ url: '/api/conexoes/meta', headers: { cookie } })).json().unidades[0].pronta).toBe(true);
  });
});
