import { createCipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CanalEvolution, lerWebhookEvolution } from '../src/channels/evolution.js';
import { abrirMidiaWhatsApp, baixarDoWhatsApp } from '../src/channels/whatsapp-cdn.js';

// Cifra como o WhatsApp: HKDF(mediaKey) → iv | chave AES | chave HMAC; arquivo = AES-CBC + 10 bytes do HMAC.
function cifrar(conteudo: Buffer, mediaKey: Buffer, info: string): Buffer {
  const exp = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(32), Buffer.from(info), 112));
  const iv = exp.subarray(0, 16), chave = exp.subarray(16, 48), mac = exp.subarray(48, 80);
  const c = createCipheriv('aes-256-cbc', chave, iv);
  const corpo = Buffer.concat([c.update(conteudo), c.final()]);
  return Buffer.concat([corpo, createHmac('sha256', mac).update(iv).update(corpo).digest().subarray(0, 10)]);
}

const audio = Buffer.from('OggS-nota-de-voz-de-teste'.repeat(20));
const mediaKey = randomBytes(32);
const cifrado = cifrar(audio, mediaKey, 'WhatsApp Audio Keys');
const corpoWebhook = {
  event: 'messages.upsert', instance: 'sintonia-1',
  data: {
    key: { remoteJid: '5571999990001@s.whatsapp.net', fromMe: false, id: 'AUDIO1' }, pushName: 'Cliente',
    message: { audioMessage: { url: 'https://mmg.whatsapp.net/v/t62.7117-24/abc.enc?ccb=11', directPath: '/v/t62.7117-24/abc.enc?ccb=11', mediaKey: mediaKey.toString('base64'), mimetype: 'audio/ogg; codecs=opus', seconds: 4, ptt: true } },
    messageTimestamp: 1763690000,
  },
};

describe('mídia direto do WhatsApp (sem a Evolution)', () => {
  it('abre o arquivo cifrado com a chave da mensagem', () => {
    expect(abrirMidiaWhatsApp(cifrado, mediaKey, 'audioMessage').equals(audio)).toBe(true);
  });

  it('recusa arquivo adulterado', () => {
    const ruim = Buffer.from(cifrado); ruim[5] = (ruim[5] ?? 0) ^ 0xff;
    expect(() => abrirMidiaWhatsApp(ruim, mediaKey, 'audioMessage')).toThrow(/não confere/);
  });

  it('baixa do mmg.whatsapp.net sem chamar a Evolution', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => { urls.push(String(url)); return new Response(new Uint8Array(cifrado), { status: 200 }); }) as unknown as typeof fetch;
    const canal = new CanalEvolution('http://evo', 'k', fetchFn, async () => {});
    const [m] = lerWebhookEvolution(corpoWebhook);
    const r = await canal.baixarMidia('sintonia-1', 'AUDIO1', m!.anexo!.ref);
    expect(r.conteudo.equals(audio)).toBe(true);
    expect(r.mimetype).toBe('audio/ogg; codecs=opus');
    expect(urls).toEqual(['https://mmg.whatsapp.net/v/t62.7117-24/abc.enc?ccb=11']);
  });

  it('se o WhatsApp recusar, tenta a Evolution (mensagem completa e depois id)', async () => {
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('whatsapp.net')) return new Response('vencido', { status: 404 });
      return new Response(JSON.stringify({ base64: audio.toString('base64'), mimetype: 'audio/ogg' }), { status: 200 });
    }) as unknown as typeof fetch;
    const canal = new CanalEvolution('http://evo', 'k', fetchFn, async () => {});
    const [m] = lerWebhookEvolution(corpoWebhook);
    const r = await canal.baixarMidia('sintonia-1', 'AUDIO1', m!.anexo!.ref);
    expect(r.conteudo.equals(audio)).toBe(true);
    expect(urls[0]).toContain('mmg.whatsapp.net');
    expect(urls[1]).toContain('getBase64FromMediaMessage');
  });

  it('não aceita endereço que não seja do WhatsApp', async () => {
    await expect(baixarDoWhatsApp({ imageMessage: { url: 'http://169.254.169.254/x', mediaKey: mediaKey.toString('base64') } }, { limite: 1e6 })).rejects.toThrow(/endereço/);
  });
});
