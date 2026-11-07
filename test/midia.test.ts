import { describe, expect, it } from 'vitest';
import { Midias, ESPERAS_MIDIA_MS } from '../src/app/midias.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalEvolution, lerWebhookEvolution } from '../src/channels/evolution.js';
import { lerWebhookMeta } from '../src/channels/meta.js';
import { CanalTeste } from '../src/channels/teste.js';
import type { CanalWhatsApp, MensagemRecebida, MidiaBaixada, MidiaEnvio } from '../src/channels/tipos.js';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { ErroMidiaGrande, LIMITE_ENVIO, LIMITE_MIDIA, textoDoAnexo } from '../src/midia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { fabricas } from './repos.js';

// ---------- payloads reais da Evolution v2 (messages.upsert), só com os campos que importam trocados ----------

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4]);
const OGG = Buffer.from('OggS\0\x02fake-opus-audio');

function upsert(message: Record<string, unknown>, extra: { id?: string; fromMe?: boolean; messageType?: string } = {}) {
  return {
    event: 'messages.upsert',
    instance: 'imperio-norte',
    data: {
      key: { remoteJid: '5571988124471@s.whatsapp.net', fromMe: extra.fromMe ?? false, id: extra.id ?? '3EB0C5A1F2D4B7E8A9' },
      pushName: 'Marina Souza',
      status: 'DELIVERY_ACK',
      message: { ...message, messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 } },
      contextInfo: null,
      messageType: extra.messageType ?? Object.keys(message)[0],
      messageTimestamp: 1793980000,
      instanceId: '7d2f1c4e-0a3b-4c5d-9e8f-112233445566',
      source: 'android',
    },
    destination: 'https://sintonia.exemplo/webhooks/evolution',
    date_time: '2026-11-05T02:13:20.000Z',
    sender: '557133334444@s.whatsapp.net',
    server_url: 'https://evo.imperio.exemplo',
    apikey: 'B6D711FCDE4D-4F7A-9F8C-1234',
  };
}

const IMAGEM = {
  imageMessage: {
    url: 'https://mmg.whatsapp.net/o1/v/t62.7118-24/f1/m231/up-oil-image-123?ccb=9-4&oh=01_Q5&oe=67A1B2C3&_nc_sid=5e03e0&mms3=true',
    mimetype: 'image/jpeg',
    caption: 'meu cabelo hoje',
    fileSha256: 'q1w2e3r4t5y6u7i8o9p0==',
    fileLength: '183442',
    height: 1280,
    width: 960,
    mediaKey: 'aGVsbG8gbWVkaWEga2V5IGZha2U=',
    fileEncSha256: 'z9x8c7v6b5n4m3==',
    directPath: '/o1/v/t62.7118-24/f1/m231/up-oil-image-123?ccb=9-4',
    mediaKeyTimestamp: '1793979990',
    jpegThumbnail: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAQABADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAAAAUH/8QAIhAAAQMDBAMAAAAAAAAAAAAAAQIDBAAFEQYSITETQVH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A',
  },
};
const AUDIO_VOZ = {
  audioMessage: {
    url: 'https://mmg.whatsapp.net/v/t62.7117-24/up-oil-audio-456.enc?ccb=11-4',
    mimetype: 'audio/ogg; codecs=opus',
    fileSha256: 'a1b2c3==',
    fileLength: '19534',
    seconds: 12,
    ptt: true,
    mediaKey: 'bWVkaWEga2V5IGF1ZGlv',
    fileEncSha256: 'd4e5f6==',
    directPath: '/v/t62.7117-24/up-oil-audio-456.enc?ccb=11-4',
    mediaKeyTimestamp: '1793979995',
    waveform: 'AAAEDRUcISUqLjI1OTw/QkVHSUxOUFJTVFVWVlZWVVRTUlBOTEpIRkRBPzw5NjMwLSkmIh4bFxMQDQoHBAIA',
  },
};
const VIDEO = {
  videoMessage: {
    url: 'https://mmg.whatsapp.net/v/t62.7161-24/up-oil-video-789.enc',
    mimetype: 'video/mp4',
    fileSha256: 'v1==',
    fileLength: { low: 2_345_678, high: 0, unsigned: true },
    seconds: 9,
    mediaKey: 'dmlkZW8ga2V5',
    caption: 'olha o resultado',
    height: 848,
    width: 480,
    jpegThumbnail: '/9j/4AAQ',
  },
};
const DOCUMENTO = {
  documentMessage: {
    url: 'https://mmg.whatsapp.net/v/t62.7119-24/up-oil-doc.enc',
    mimetype: 'application/pdf',
    title: 'comprovante pix',
    fileSha256: 'd1==',
    fileLength: '88123',
    pageCount: 1,
    mediaKey: 'ZG9jIGtleQ==',
    fileName: 'comprovante-pix.pdf',
  },
};
const DOCUMENTO_COM_LEGENDA = {
  documentWithCaptionMessage: {
    message: {
      documentMessage: { ...DOCUMENTO.documentMessage, caption: 'segue o comprovante', fileName: 'pix 05-11.pdf' },
    },
  },
};
const FIGURINHA = {
  stickerMessage: {
    url: 'https://mmg.whatsapp.net/v/t62.15575-24/up-oil-sticker.enc',
    fileSha256: 's1==',
    mimetype: 'image/webp',
    height: 64,
    width: 64,
    fileLength: '12440',
    isAnimated: false,
    isAvatar: false,
  },
};

describe('webhook da Evolution: mídias', () => {
  it('foto com legenda: marcador para a IA + anexo com os dados', () => {
    const [m] = lerWebhookEvolution(upsert(IMAGEM));
    expect(m!.texto).toBe('[foto] meu cabelo hoje');
    expect(m!.anexo).toEqual({ tipo: 'imagem', mimetype: 'image/jpeg', legenda: 'meu cabelo hoje', tamanho: 183442 });
    expect(m!.nome).toBe('Marina Souza');
  });

  it('nota de voz (ptt) com duração', () => {
    const [m] = lerWebhookEvolution(upsert(AUDIO_VOZ));
    expect(m!.texto).toBe('[áudio]');
    expect(m!.anexo).toEqual({ tipo: 'audio', mimetype: 'audio/ogg; codecs=opus', duracaoSeg: 12, tamanho: 19534, voz: true });
  });

  it('áudio encaminhado (sem ptt) não é nota de voz', () => {
    const [m] = lerWebhookEvolution(upsert({ audioMessage: { ...AUDIO_VOZ.audioMessage, ptt: false, mimetype: 'audio/mpeg' } }));
    expect(m!.anexo).toMatchObject({ tipo: 'audio', voz: false, mimetype: 'audio/mpeg' });
  });

  it('vídeo: tamanho no formato Long do WhatsApp', () => {
    const [m] = lerWebhookEvolution(upsert(VIDEO));
    expect(m!.texto).toBe('[vídeo] olha o resultado');
    expect(m!.anexo).toEqual({ tipo: 'video', mimetype: 'video/mp4', duracaoSeg: 9, legenda: 'olha o resultado', tamanho: 2_345_678 });
  });

  it('documento com nome do arquivo', () => {
    const [m] = lerWebhookEvolution(upsert(DOCUMENTO));
    expect(m!.texto).toBe('[documento: comprovante-pix.pdf]');
    expect(m!.anexo).toEqual({ tipo: 'documento', mimetype: 'application/pdf', nomeArquivo: 'comprovante-pix.pdf', tamanho: 88123 });
  });

  it('documento com legenda (vem embrulhado em documentWithCaptionMessage)', () => {
    const [m] = lerWebhookEvolution(upsert(DOCUMENTO_COM_LEGENDA));
    expect(m!.texto).toBe('[documento: pix 05-11.pdf] segue o comprovante');
    expect(m!.anexo).toMatchObject({ tipo: 'documento', nomeArquivo: 'pix 05-11.pdf', legenda: 'segue o comprovante' });
  });

  it('figurinha', () => {
    const [m] = lerWebhookEvolution(upsert(FIGURINHA));
    expect(m!.texto).toBe('[figurinha]');
    expect(m!.anexo).toEqual({ tipo: 'figurinha', mimetype: 'image/webp', tamanho: 12440 });
  });

  it('mensagem temporária (ephemeralMessage) e visualização única também são lidas', () => {
    const [a] = lerWebhookEvolution(upsert({ ephemeralMessage: { message: IMAGEM } }));
    expect(a!.anexo?.tipo).toBe('imagem');
    const [b] = lerWebhookEvolution(upsert({ viewOnceMessageV2: { message: { imageMessage: { ...IMAGEM.imageMessage, caption: undefined } } } }));
    expect(b!.texto).toBe('[foto]');
  });

  it('com "Webhook Base64" ligado na Evolution, o arquivo já vem junto', () => {
    const [m] = lerWebhookEvolution(upsert({ ...IMAGEM, base64: JPG.toString('base64') }));
    expect(m!.anexo?.base64).toBe(JPG.toString('base64'));
  });

  it('arquivo embutido grande demais não entra na fila (é baixado à parte)', () => {
    const grande = Buffer.alloc(6 * 1024 * 1024).toString('base64');
    const [m] = lerWebhookEvolution(upsert({ ...VIDEO, base64: grande }));
    expect(m!.anexo?.base64).toBeUndefined();
  });

  it('texto continua igual e sem anexo', () => {
    const [m] = lerWebhookEvolution(upsert({ conversation: 'oi' }));
    expect(m!.texto).toBe('oi');
    expect(m!.anexo).toBeUndefined();
  });

  it('mensagem sem conteúdo conhecido (reação, enquete) é ignorada', () => {
    expect(lerWebhookEvolution(upsert({ reactionMessage: { text: '👍' } }))).toHaveLength(0);
  });
});

describe('webhook da Meta: mídia vira marcador e anexo', () => {
  const corpo = (msg: Record<string, unknown>) => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { metadata: { phone_number_id: '1122' }, messages: [{ from: '5571988124471', id: 'wamid.X', timestamp: '1793980000', ...msg }] } }] }],
  });
  it('foto, documento, vídeo e figurinha viram marcador', () => {
    expect(lerWebhookMeta(corpo({ type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'olha' } }))[0]!.texto).toBe('[foto] olha');
    expect(lerWebhookMeta(corpo({ type: 'document', document: { id: 'm2', filename: 'a.pdf' } }))[0]!.texto).toBe('[documento: a.pdf]');
    expect(lerWebhookMeta(corpo({ type: 'video', video: { id: 'm3' } }))[0]!.texto).toBe('[vídeo]');
    expect(lerWebhookMeta(corpo({ type: 'sticker', sticker: { id: 'm4' } }))[0]!.texto).toBe('[figurinha]');
    // O anexo leva o id da mídia na Meta: o baixador busca o arquivo por ele.
    expect(lerWebhookMeta(corpo({ type: 'audio', audio: { id: 'm5', mime_type: 'audio/ogg; codecs=opus', voice: true } }))[0]!.anexo).toEqual({
      tipo: 'audio',
      ref: 'm5',
      mimetype: 'audio/ogg; codecs=opus',
      voz: true,
    });
  });
});

describe('marcador de texto', () => {
  it('cada tipo', () => {
    expect(textoDoAnexo('imagem')).toBe('[foto]');
    expect(textoDoAnexo('audio')).toBe('[áudio]');
    expect(textoDoAnexo('documento')).toBe('[documento]');
    expect(textoDoAnexo('imagem', '  ')).toBe('[foto]');
  });
});

// ---------- Evolution: download e envio (fetch falso conferindo URL e corpo) ----------

interface Pedido {
  url: string;
  metodo: string;
  cabecalhos: Record<string, string>;
  corpo: Record<string, unknown>;
}
function fetchFalso(resposta: (p: Pedido) => Response) {
  const pedidos: Pedido[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const p = { url, metodo: init?.method ?? 'GET', cabecalhos: init?.headers as Record<string, string>, corpo: JSON.parse(String(init?.body ?? '{}')) };
    pedidos.push(p);
    return resposta(p);
  }) as unknown as typeof fetch;
  return { f, pedidos };
}

describe('Evolution v2: baixar e enviar mídia', () => {
  it('baixa pelo getBase64FromMediaMessage', async () => {
    const { f, pedidos } = fetchFalso(() => new Response(JSON.stringify({ mediaType: 'imageMessage', fileName: '3EB0.jpeg', mimetype: 'image/jpeg', base64: JPG.toString('base64'), size: { fileLength: '14' } })));
    const r = await new CanalEvolution('https://evo.exemplo/', 'chave', f).baixarMidia('imperio-norte', '3EB0C5A1F2D4B7E8A9');
    expect(r.conteudo).toEqual(JPG);
    expect(r.mimetype).toBe('image/jpeg');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.url).toBe('https://evo.exemplo/chat/getBase64FromMediaMessage/imperio-norte');
    expect(pedidos[0]!.metodo).toBe('POST');
    expect(pedidos[0]!.cabecalhos.apikey).toBe('chave');
    expect(pedidos[0]!.corpo).toEqual({ message: { key: { id: '3EB0C5A1F2D4B7E8A9' } }, convertToMp4: false });
  });

  it('falha da Evolution vira erro (para a nova tentativa)', async () => {
    const { f } = fetchFalso(() => new Response('{"message":"Message not found"}', { status: 400 }));
    await expect(new CanalEvolution('https://evo', 'k', f).baixarMidia('i', 'X')).rejects.toThrow(/400/);
    const { f: semArquivo } = fetchFalso(() => new Response(JSON.stringify({ mimetype: 'image/jpeg' })));
    await expect(new CanalEvolution('https://evo', 'k', semArquivo).baixarMidia('i', 'X')).rejects.toThrow(/sem o arquivo/);
  });

  it('arquivo acima do limite: erro de "grande demais"', async () => {
    const { f } = fetchFalso(() => new Response(JSON.stringify({ base64: 'A'.repeat(Math.ceil(((LIMITE_MIDIA + 10) * 4) / 3)) })));
    await expect(new CanalEvolution('https://evo', 'k', f).baixarMidia('i', 'X')).rejects.toBeInstanceOf(ErroMidiaGrande);
  });

  it('envia foto com legenda pelo sendMedia', async () => {
    const { f, pedidos } = fetchFalso(() => new Response(JSON.stringify({ key: { id: 'OUT1', fromMe: true }, status: 'PENDING' }), { status: 201 }));
    const r = await new CanalEvolution('https://evo.exemplo', 'chave', f).enviarMidia('imperio-norte', '5571988124471', {
      tipo: 'imagem',
      conteudo: JPG,
      mimetype: 'image/jpeg',
      nomeArquivo: 'tabela.jpg',
      legenda: 'Nossa tabela',
    });
    expect(r.idExterno).toBe('OUT1');
    expect(pedidos[0]!.url).toBe('https://evo.exemplo/message/sendMedia/imperio-norte');
    expect(pedidos[0]!.corpo).toEqual({
      number: '5571988124471',
      mediatype: 'image',
      mimetype: 'image/jpeg',
      media: JPG.toString('base64'),
      caption: 'Nossa tabela',
      fileName: 'tabela.jpg',
    });
  });

  it('envia documento e vídeo com o mediatype certo', async () => {
    const { f, pedidos } = fetchFalso(() => new Response(JSON.stringify({ key: { id: 'OUT' } })));
    const c = new CanalEvolution('https://evo', 'k', f);
    await c.enviarMidia('i', '55', { tipo: 'documento', conteudo: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf', nomeArquivo: 'orcamento.pdf' });
    await c.enviarMidia('i', '55', { tipo: 'video', conteudo: Buffer.from('mp4'), mimetype: 'video/mp4' });
    expect(pedidos.map((p) => [p.corpo.mediatype, p.corpo.fileName, p.corpo.caption])).toEqual([
      ['document', 'orcamento.pdf', undefined],
      ['video', undefined, undefined],
    ]);
  });

  it('nota de voz pelo sendWhatsAppAudio', async () => {
    const { f, pedidos } = fetchFalso(() => new Response(JSON.stringify({ key: { id: 'AUD1' } })));
    const r = await new CanalEvolution('https://evo', 'k', f).enviarMidia('imperio-norte', '5571988124471', { tipo: 'audio', conteudo: OGG, mimetype: 'audio/webm' });
    expect(r.idExterno).toBe('AUD1');
    expect(pedidos[0]!.url).toBe('https://evo/message/sendWhatsAppAudio/imperio-norte');
    expect(pedidos[0]!.corpo).toEqual({ number: '5571988124471', audio: OGG.toString('base64') });
  });

  it('envio recusado vira erro', async () => {
    const { f } = fetchFalso(() => new Response('{"error":"Bad Request"}', { status: 400 }));
    await expect(new CanalEvolution('https://evo', 'k', f).enviarMidia('i', '55', { tipo: 'imagem', conteudo: JPG, mimetype: 'image/jpeg' })).rejects.toThrow(/recusou/);
  });
});

// ---------- recebimento + download (memória e Postgres) ----------

class CanalComMidia implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ telefone: string; texto?: string; midia?: MidiaEnvio }> = [];
  baixados: string[] = [];
  falhasAntes = 0;
  arquivo: MidiaBaixada = { conteudo: JPG, mimetype: 'image/jpeg' };
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, texto: string) {
    this.enviados.push({ telefone, texto });
    return { idExterno: `out-${this.enviados.length}` };
  }
  async enviarMidia(_c: string, telefone: string, midia: MidiaEnvio) {
    this.enviados.push({ telefone, midia });
    return { idExterno: `out-${this.enviados.length}` };
  }
  async baixarMidia(_c: string, idExterno: string) {
    this.baixados.push(idExterno);
    if (this.falhasAntes > 0) {
      this.falhasAntes--;
      throw new Error('Evolution fora do ar');
    }
    return this.arquivo;
  }
}

function montar(repo: Repositorio, canal: CanalWhatsApp = new CanalComMidia()) {
  const relogio = { t: new Date('2026-11-05T05:00:00Z') }; // madrugada: a IA responde sozinha
  const pedidosIa: string[] = [];
  const midias = new Midias(repo, () => canal, () => relogio.t);
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: {
      executar: async (p) => {
        pedidosIa.push(p.mensagens.at(-1)!.texto);
        return { texto: 'Recebi! Me conta o que você precisa?', acoes: [], recusou: false };
      },
    },
    agora: () => relogio.t,
    midias,
  });
  return { sintonia, midias, relogio, pedidosIa, canal };
}

/** A mensagem com mídia da conversa (no Postgres, mensagens no mesmo instante não têm ordem garantida). */
async function midiaDe(repo: Repositorio, conversaId: string) {
  const m = (await repo.mensagens(conversaId)).find((x) => x.anexo);
  if (!m) throw new Error('sem mídia');
  return m;
}

let seq = 0;
const recebida = (extra: Partial<MensagemRecebida>): MensagemRecebida => ({
  canalId: 'imperio-norte',
  telefone: '5571988124471',
  nome: 'Marina',
  texto: '[foto] meu cabelo',
  deMim: false,
  idExterno: `midia-${++seq}`,
  em: new Date('2026-11-05T05:00:00Z'),
  anexo: { tipo: 'imagem', mimetype: 'image/jpeg', legenda: 'meu cabelo', tamanho: JPG.length },
  ...extra,
});

describe.each(fabricas)('Mídia recebida ($nome)', (f) => {
  it('grava a mensagem primeiro, a IA responde, e o arquivo é baixado em seguida', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    const { sintonia, midias, pedidosIa } = montar(repo, canal);
    await sintonia.receber(recebida({}));
    // A IA leu o marcador, sem esperar o download.
    expect(pedidosIa).toEqual(['[foto] meu cabelo']);
    expect(canal.enviados.map((e) => e.texto)).toEqual(['Recebi! Me conta o que você precisa?']);
    await midias.ocioso();
    const [c] = await repo.listarConversas();
    const msgs = await repo.mensagens(c!.id);
    expect(msgs.filter((x) => x.anexo)).toHaveLength(1);
    const foto = await midiaDe(repo, c!.id);
    expect(foto.anexo).toEqual({ tipo: 'imagem', mimetype: 'image/jpeg', legenda: 'meu cabelo', tamanho: JPG.length, situacao: 'pronta' });
    const guardada = await repo.midia(foto.id);
    expect(guardada?.conteudo).toEqual(JPG);
    expect(guardada?.conversaId).toBe(c!.id);
    expect(canal.baixados).toEqual([`midia-${seq}`]);
  });

  it('download falha: a mensagem fica, e a nova tentativa baixa depois', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    canal.falhasAntes = 1;
    canal.arquivo = { conteudo: OGG, mimetype: 'audio/ogg; codecs=opus' };
    const { sintonia, midias, relogio } = montar(repo, canal);
    await sintonia.receber(recebida({ texto: '[áudio]', anexo: { tipo: 'audio', mimetype: 'audio/ogg; codecs=opus', duracaoSeg: 12, voz: true } }));
    await midias.ocioso();
    const [c] = await repo.listarConversas();
    const m = await midiaDe(repo, c!.id);
    expect(m!.texto).toBe('[áudio]');
    expect(m!.anexo?.situacao).toBe('pendente');
    // Antes da espera, ninguém tenta de novo.
    expect(await midias.rodada()).toBe(0);
    relogio.t = new Date(relogio.t.getTime() + ESPERAS_MIDIA_MS[0]! + 1000);
    expect(await midias.rodada()).toBe(1);
    expect((await midiaDe(repo, c!.id)).anexo).toMatchObject({ situacao: 'pronta', duracaoSeg: 12, voz: true, tamanho: OGG.length });
    expect(canal.baixados).toHaveLength(2);
  });

  it('depois de todas as tentativas, desiste; "tentar de novo" volta para a fila', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    canal.falhasAntes = 99;
    const { sintonia, midias, relogio } = montar(repo, canal);
    await sintonia.receber(recebida({}));
    await midias.ocioso();
    for (let i = 0; i < 10; i++) {
      relogio.t = new Date(relogio.t.getTime() + 3 * 3600_000);
      await midias.rodada();
    }
    const [c] = await repo.listarConversas();
    const m = await midiaDe(repo, c!.id);
    expect(m!.anexo?.situacao).toBe('falhou');
    expect(canal.baixados).toHaveLength(ESPERAS_MIDIA_MS.length + 1);
    canal.falhasAntes = 0;
    expect(await repo.rebaixarMidia(m!.id, relogio.t)).toBe(true);
    expect(await repo.rebaixarMidia(m!.id, relogio.t)).toBe(false); // já está pendente
    await midias.rodada();
    expect((await repo.midia(m!.id))?.anexo.situacao).toBe('pronta');
  });

  it('arquivo acima de 16 MB: só os dados, sem baixar', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    const { sintonia, midias } = montar(repo, canal);
    await sintonia.receber(recebida({ texto: '[vídeo]', anexo: { tipo: 'video', mimetype: 'video/mp4', tamanho: LIMITE_MIDIA + 1 } }));
    await midias.ocioso();
    const [c] = await repo.listarConversas();
    const m = await midiaDe(repo, c!.id);
    expect(m!.anexo).toMatchObject({ situacao: 'grande', tamanho: LIMITE_MIDIA + 1 });
    expect(canal.baixados).toEqual([]);
    expect((await repo.midia(m!.id))?.conteudo).toBeNull();
  });

  it('a Evolution diz que o arquivo é grande demais: marca como grande', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    canal.baixarMidia = async () => {
      throw new ErroMidiaGrande(LIMITE_MIDIA * 2);
    };
    const { sintonia, midias } = montar(repo, canal);
    await sintonia.receber(recebida({ anexo: { tipo: 'documento', nomeArquivo: 'catalogo.pdf' }, texto: '[documento: catalogo.pdf]' }));
    await midias.ocioso();
    const [c] = await repo.listarConversas();
    expect((await midiaDe(repo, c!.id)).anexo).toMatchObject({ situacao: 'grande', tamanho: LIMITE_MIDIA * 2, nomeArquivo: 'catalogo.pdf' });
  });

  it('arquivo já veio no webhook: guardado na hora, sem download', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    const { sintonia, midias } = montar(repo, canal);
    await sintonia.receber(recebida({ anexo: { tipo: 'imagem', mimetype: 'image/jpeg', base64: JPG.toString('base64') } }));
    await midias.ocioso();
    const [c] = await repo.listarConversas();
    const m = await midiaDe(repo, c!.id);
    expect(m!.anexo?.situacao).toBe('pronta');
    expect((await repo.midia(m!.id))?.conteudo).toEqual(JPG);
    expect(canal.baixados).toEqual([]);
  });

  it('canal que não baixa mídia: mensagem entra, arquivo fica como "falhou"', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    (canal as Partial<CanalComMidia>).baixarMidia = undefined;
    const { sintonia } = montar(repo, canal);
    await sintonia.receber(recebida({}));
    const [c] = await repo.listarConversas();
    expect((await midiaDe(repo, c!.id)).anexo?.situacao).toBe('falhou');
  });

  it('webhook repetido não duplica a mídia', async () => {
    const repo = await f.criar();
    const { sintonia, midias } = montar(repo);
    const m = recebida({});
    await sintonia.receber(m);
    await sintonia.receber(m);
    await midias.ocioso();
    const [c] = await repo.listarConversas();
    expect((await repo.mensagens(c!.id)).filter((x) => x.anexo)).toHaveLength(1);
  });

  it('dois baixadores ao mesmo tempo não pegam a mesma mídia', async () => {
    const repo = await f.criar();
    const { sintonia, relogio } = montar(repo);
    const canal = new CanalComMidia();
    canal.falhasAntes = 1; // a primeira (automática) falha, para sobrar pendente
    const s2 = montar(repo, canal);
    await s2.sintonia.receber(recebida({}));
    await s2.midias.ocioso();
    void sintonia;
    relogio.t = new Date('2026-11-05T06:00:00Z');
    const quando = new Date('2026-11-05T06:00:00Z');
    const [a, b] = await Promise.all([repo.reivindicarMidias(quando), repo.reivindicarMidias(quando)]);
    expect(a!.length + b!.length).toBe(1);
  });

  it('equipe envia foto: vai pelo canal, fica gravada com o arquivo e conta como resposta', async () => {
    const repo = await f.criar();
    const canal = new CanalComMidia();
    const { sintonia } = montar(repo, canal);
    await sintonia.receber(recebida({ anexo: undefined, texto: 'tem foto da tabela?' }));
    const [c] = await repo.listarConversas();
    const r = await sintonia.equipeEnviouMidia(c!.id, { tipo: 'imagem', conteudo: JPG, mimetype: 'image/jpeg', nomeArquivo: 'tabela.jpg', legenda: ' Tabela de hoje ' }, 'Carla');
    expect(canal.enviados.at(-1)!.midia).toMatchObject({ tipo: 'imagem', legenda: 'Tabela de hoje', nomeArquivo: 'tabela.jpg' });
    const m = (await repo.mensagens(c!.id)).find((x) => x.id === r.mensagemId)!;
    expect(m).toMatchObject({ autor: 'equipe', autorNome: 'Carla', texto: '[foto] Tabela de hoje' });
    expect(m.anexo).toEqual({ tipo: 'imagem', mimetype: 'image/jpeg', nomeArquivo: 'tabela.jpg', legenda: 'Tabela de hoje', tamanho: JPG.length, situacao: 'pronta' });
    expect((await repo.midia(m.id))?.conteudo).toEqual(JPG);
    expect(await repo.foiEnviadoPorNos(m.idExterno!)).toBe(true);
    expect((await repo.buscarConversa(c!.id))?.ultimaMensagemEquipe).toBeDefined();
  });
});

// ---------- rotas ----------

async function montarServidor() {
  const repo = new RepositorioMemoria();
  const canal = new CanalComMidia();
  const { sintonia, midias, relogio } = montar(repo, canal);
  const contas = new ContasMemoria();
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await gerarHash('Imperio2026xyz') });
  const testeCanal = new CanalTeste();
  const app = criarServidor({
    sintonia,
    repo,
    midias,
    agora: () => relogio.t,
    auth: { contas },
    clienteTeste: async ({ unidade, nome, telefone, texto, midia }) => {
      void testeCanal;
      void unidade;
      await sintonia.receber({
        canalId: 'imperio-norte',
        telefone,
        nome,
        texto: textoDoAnexo('imagem', texto),
        deMim: false,
        idExterno: `t-${++seq}`,
        em: new Date('2026-11-05T05:00:00Z'),
        anexo: midia ? { tipo: 'imagem', mimetype: midia.mimetype, base64: midia.base64 } : undefined,
      });
    },
  });
  const login = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: 'Imperio2026xyz' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  await sintonia.receber(recebida({}));
  await midias.ocioso();
  const [c] = await repo.listarConversas();
  const foto = await midiaDe(repo, c!.id);
  return { app, repo, canal, cookie, c: c!, foto, midias };
}

describe('Rotas de mídia', () => {
  it('download exige login e manda cache privado', async () => {
    const { app, cookie, c, foto } = await montarServidor();
    const url = `/api/conversas/${c.id}/midias/${foto.id}`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    const r = await app.inject({ url, headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers['cache-control']).toBe('private, max-age=86400');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['content-disposition'])).toMatch(/^inline;/);
    expect(r.rawPayload).toEqual(JPG);
    const baixar = await app.inject({ url: url + '?baixar=1', headers: { cookie } });
    expect(String(baixar.headers['content-disposition'])).toMatch(/^attachment;/);
  });

  it('pedaço do arquivo (Range), para áudio e vídeo no iPhone', async () => {
    const { app, cookie, c, foto } = await montarServidor();
    const r = await app.inject({ url: `/api/conversas/${c.id}/midias/${foto.id}`, headers: { cookie, range: 'bytes=2-5' } });
    expect(r.statusCode).toBe(206);
    expect(r.headers['content-range']).toBe(`bytes 2-5/${JPG.length}`);
    expect(r.rawPayload).toEqual(JPG.subarray(2, 6));
    const fora = await app.inject({ url: `/api/conversas/${c.id}/midias/${foto.id}`, headers: { cookie, range: 'bytes=999-' } });
    expect(fora.statusCode).toBe(416);
  });

  it('mídia de outra conversa, id inválido ou inexistente: 404', async () => {
    const { app, cookie, foto } = await montarServidor();
    expect((await app.inject({ url: `/api/conversas/outra/midias/${foto.id}`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/conversas/x/midias/nao-e-uuid`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('arquivo mandado pela cliente como HTML nunca abre dentro do app', async () => {
    const { app, repo, cookie, c } = await montarServidor();
    const id = '0f0e0d0c-0b0a-4909-8807-060504030201';
    await repo.adicionarMensagem({ id, conversaId: c.id, autor: 'cliente', texto: '[documento: x.html]', em: new Date(), idExterno: 'html-1', anexo: { tipo: 'documento', mimetype: 'text/html', nomeArquivo: 'x.html', situacao: 'pendente' } });
    await repo.guardarMidia(id, { conteudo: Buffer.from('<script>alert(1)</script>') });
    const r = await app.inject({ url: `/api/conversas/${c.id}/midias/${id}`, headers: { cookie } });
    expect(r.headers['content-type']).toBe('application/octet-stream');
    expect(String(r.headers['content-disposition'])).toMatch(/^attachment;/);
    expect(String(r.headers['content-security-policy'])).toContain('sandbox');
  });

  it('ainda baixando: 409; falhou: "tentar de novo" baixa', async () => {
    const { app, repo, canal, cookie, c, midias } = await montarServidor();
    const id = '1f0e0d0c-0b0a-4909-8807-060504030201';
    await repo.adicionarMensagem({ id, conversaId: c.id, autor: 'cliente', texto: '[foto]', em: new Date(), idExterno: 'pend-1', anexo: { tipo: 'imagem', situacao: 'pendente' } });
    const url = `/api/conversas/${c.id}/midias/${id}`;
    expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(409);
    await repo.falhaMidia(id, 'não achou');
    expect((await app.inject({ url, headers: { cookie } })).json()).toMatchObject({ situacao: 'falhou' });
    const r = await app.inject({ method: 'POST', url: url + '/baixar', headers: { cookie } });
    expect(r.json()).toEqual({ ok: true, situacao: 'pendente' });
    await midias.ocioso();
    expect(canal.baixados).toContain('pend-1');
    expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(200);
  });

  it('lista de conversas leva o anexo da última mensagem (prévia "📷 Foto")', async () => {
    const { app, repo, cookie, c } = await montarServidor();
    await repo.adicionarMensagem({ conversaId: c.id, autor: 'cliente', texto: '[áudio]', em: new Date('2026-11-05T07:00:00Z'), idExterno: 'aud-x', anexo: { tipo: 'audio', duracaoSeg: 12, voz: true, situacao: 'pendente' } });
    const [item] = (await app.inject({ url: '/api/conversas', headers: { cookie } })).json();
    expect(item.ultima).toMatchObject({ texto: '[áudio]', anexo: { tipo: 'audio', duracaoSeg: 12, voz: true } });
  });

  it('atendente envia foto pelo app', async () => {
    const { app, repo, canal, cookie, c } = await montarServidor();
    const r = await app.inject({
      method: 'POST',
      url: `/api/conversas/${c.id}/enviar-midia`,
      headers: { cookie },
      payload: { base64: 'data:image/jpeg;base64,' + JPG.toString('base64'), mimetype: 'image/jpeg', nomeArquivo: 'foto.jpg', legenda: 'Olha!' },
    });
    expect(r.statusCode).toBe(200);
    const m = (await repo.mensagens(c.id)).at(-1)!;
    expect(m).toMatchObject({ autor: 'equipe', autorNome: 'Carla Lima', texto: '[foto] Olha!' });
    expect(m.anexo).toMatchObject({ tipo: 'imagem', situacao: 'pronta', tamanho: JPG.length });
    expect(canal.enviados.at(-1)!.midia?.conteudo).toEqual(JPG);
  });

  it('atendente envia nota de voz e documento', async () => {
    const { app, repo, canal, cookie, c } = await montarServidor();
    const url = `/api/conversas/${c.id}/enviar-midia`;
    await app.inject({ method: 'POST', url, headers: { cookie }, payload: { base64: OGG.toString('base64'), mimetype: 'audio/webm;codecs=opus', duracaoSeg: 4.6 } });
    await app.inject({ method: 'POST', url, headers: { cookie }, payload: { tipo: 'documento', base64: Buffer.from('%PDF').toString('base64'), mimetype: 'application/pdf', nomeArquivo: 'orçamento.pdf' } });
    const [voz, doc] = (await repo.mensagens(c.id)).slice(-2);
    expect(voz!.anexo).toMatchObject({ tipo: 'audio', voz: true, duracaoSeg: 5 });
    expect(voz!.texto).toBe('[áudio]');
    expect(doc!.texto).toBe('[documento: orçamento.pdf]');
    expect(canal.enviados.slice(-2).map((e) => e.midia?.tipo)).toEqual(['audio', 'documento']);
    const baixar = await app.inject({ url: `/api/conversas/${c.id}/midias/${doc!.id}`, headers: { cookie } });
    expect(String(baixar.headers['content-disposition'])).toContain("filename*=UTF-8''or%C3%A7amento.pdf");
  });

  it('limite de tamanho e tipo que não confere', async () => {
    const { app, canal, cookie, c } = await montarServidor();
    const url = `/api/conversas/${c.id}/enviar-midia`;
    const antes = canal.enviados.length;
    const grande = Buffer.alloc(LIMITE_ENVIO + 1).toString('base64');
    const r = await app.inject({ method: 'POST', url, headers: { cookie }, payload: { base64: grande, mimetype: 'video/mp4' } });
    expect(r.statusCode).toBe(413);
    expect(r.json().erro).toMatch(/16 MB/);
    const errado = await app.inject({ method: 'POST', url, headers: { cookie }, payload: { tipo: 'imagem', base64: 'AAAA', mimetype: 'application/pdf' } });
    expect(errado.statusCode).toBe(400);
    const lixo = await app.inject({ method: 'POST', url, headers: { cookie }, payload: { base64: 'AAAA', mimetype: 'nada' } });
    expect(lixo.statusCode).toBe(400);
    expect(canal.enviados.length).toBe(antes);
  });

  it('número sem envio de arquivo (API oficial, por enquanto): 501', async () => {
    const repo = new RepositorioMemoria();
    const canal = new CanalComMidia();
    (canal as Partial<CanalComMidia>).enviarMidia = undefined;
    const { sintonia } = montar(repo, canal);
    const app = criarServidor({ sintonia, repo });
    await sintonia.receber(recebida({ anexo: undefined, texto: 'oi' }));
    const [c] = await repo.listarConversas();
    const r = await app.inject({ method: 'POST', url: `/api/conversas/${c!.id}/enviar-midia`, payload: { base64: JPG.toString('base64'), mimetype: 'image/jpeg', atendente: 'Carla' } });
    expect(r.statusCode).toBe(501);
  });

  it('simulador aceita mídia de teste', async () => {
    const { app, repo, cookie } = await montarServidor();
    const r = await app.inject({
      method: 'POST',
      url: '/api/teste/cliente',
      headers: { cookie },
      payload: { unidade: 'norte', nome: 'Cliente Teste', telefone: '5599123456789', midia: { base64: JPG.toString('base64'), mimetype: 'image/jpeg' } },
    });
    expect(r.statusCode).toBe(200);
    const sem = await app.inject({ method: 'POST', url: '/api/teste/cliente', headers: { cookie }, payload: { unidade: 'norte', nome: 'Cliente Teste', telefone: '5599123456789' } });
    expect(sem.statusCode).toBe(400);
    const todas = await Promise.all((await repo.listarConversas()).map((c) => repo.mensagens(c.id)));
    expect(todas.flat().filter((m) => m.anexo?.situacao === 'pronta').length).toBeGreaterThanOrEqual(2);
  });
});
