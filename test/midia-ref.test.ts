import { describe, expect, it } from 'vitest';
import { CanalEvolution, lerWebhookEvolution } from '../src/channels/evolution.js';

// A Evolution do servidor não guarda mensagens: o download só pelo id falhava. A Sintonia guarda a mensagem
// completa (sem miniaturas) e manda para a Evolution baixar direto do WhatsApp.
const corpo = {
  event: 'messages.upsert',
  instance: 'sintonia-1',
  data: {
    key: { remoteJid: '5571999990001@s.whatsapp.net', fromMe: false, id: 'ABC123' },
    pushName: 'Cliente',
    message: { imageMessage: { mimetype: 'image/jpeg', url: 'https://mmg.whatsapp.net/x', directPath: '/v/x', mediaKey: 'Q2hhdmU=', fileLength: 5000, jpegThumbnail: 'AAAA'.repeat(500) } },
    messageTimestamp: 1763690000,
  },
};

describe('mídia da Evolution com a mensagem completa', () => {
  it('guarda a referência completa, sem a miniatura', () => {
    const [m] = lerWebhookEvolution(corpo);
    const ref = JSON.parse(m!.anexo!.ref!);
    expect(ref.key.id).toBe('ABC123');
    expect(ref.message.imageMessage.mediaKey).toBe('Q2hhdmU=');
    expect(ref.message.imageMessage.jpegThumbnail).toBeUndefined();
  });

  it('não guarda referência quando o arquivo já veio junto (base64)', () => {
    const [m] = lerWebhookEvolution({ ...corpo, data: { ...corpo.data, message: { ...corpo.data.message, base64: Buffer.from('oi').toString('base64') } } });
    expect(m!.anexo!.base64).toBeTruthy();
    expect(m!.anexo!.ref).toBeUndefined();
  });

  it('baixa mandando a mensagem completa; se falhar, tenta pelo id', async () => {
    const pedidos: unknown[] = [];
    let primeira = true;
    const fetchFn = (async (_url: string, init: RequestInit) => {
      pedidos.push(JSON.parse(String(init.body)));
      if (primeira) { primeira = false; return new Response('{"message":"erro"}', { status: 400 }); }
      return new Response(JSON.stringify({ base64: Buffer.from('arquivo').toString('base64'), mimetype: 'image/jpeg' }), { status: 200 });
    }) as unknown as typeof fetch;
    const canal = new CanalEvolution('http://evo', 'k', fetchFn, async () => {});
    const [m] = lerWebhookEvolution(corpo);
    const r = await canal.baixarMidia('sintonia-1', 'ABC123', m!.anexo!.ref);
    expect(r.conteudo.toString()).toBe('arquivo');
    expect((pedidos[0] as { message: { message: unknown } }).message.message).toBeTruthy();
    expect(pedidos[1]).toEqual({ message: { key: { id: 'ABC123' } }, convertToMp4: false });
  });

  it('com a mensagem completa dá certo de primeira', async () => {
    const pedidos: unknown[] = [];
    const fetchFn = (async (_url: string, init: RequestInit) => { pedidos.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ base64: Buffer.from('x').toString('base64') }), { status: 200 }); }) as unknown as typeof fetch;
    const canal = new CanalEvolution('http://evo', 'k', fetchFn, async () => {});
    const [m] = lerWebhookEvolution(corpo);
    await canal.baixarMidia('sintonia-1', 'ABC123', m!.anexo!.ref);
    expect(pedidos).toHaveLength(1);
  });
});
