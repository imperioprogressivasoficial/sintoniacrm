import { execFileSync } from 'node:child_process';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CanalMeta } from '../src/channels/meta.js';
import { ConversorFfmpeg, precisaConverter, type ConversorAudio } from '../src/web/audio-compat.js';
import { registrarRotasMidia } from '../src/web/midias.js';
import type { Sintonia } from '../src/app/sintonia.js';
import type { Repositorio } from '../src/store/repositorio.js';

/** Áudio da conversa: o iPhone não toca OGG/Opus (nota de voz do WhatsApp); o servidor entrega em MP3. */

const temFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const CONVERSA = '11111111-1111-4111-8111-111111111111';
const MENSAGEM = '22222222-2222-4222-8222-222222222222';

function servidor(conteudo: Buffer, mimetype: string, conversor: ConversorAudio) {
  const app = Fastify();
  const repo = {
    midia: async (id: string) =>
      id === MENSAGEM ? { conversaId: CONVERSA, conteudo, anexo: { tipo: 'audio', mimetype, situacao: 'pronta' } } : undefined,
  } as unknown as Repositorio;
  registrarRotasMidia(app, { sintonia: {} as Sintonia, repo, conversor });
  return app;
}

describe('áudio que toca no iPhone', () => {
  it('sabe quais formatos precisam de cópia', () => {
    expect(precisaConverter('audio/ogg; codecs=opus')).toBe(true);
    expect(precisaConverter('audio/webm')).toBe(true);
    expect(precisaConverter('audio/opus')).toBe(true);
    expect(precisaConverter('audio/amr')).toBe(true);
    expect(precisaConverter('audio/mpeg')).toBe(false);
    expect(precisaConverter('audio/mp4')).toBe(false);
    expect(precisaConverter('audio/aac')).toBe(false);
    expect(precisaConverter('image/jpeg')).toBe(false);
    expect(precisaConverter(undefined)).toBe(false);
  });

  it('?formato=tocar entrega a cópia em MP3 (com pedaços para o Safari); sem o parâmetro, o original', async () => {
    const OGG = Buffer.from('OggS-original');
    let vezes = 0;
    const conversor: ConversorAudio = { converter: async () => (vezes++, { conteudo: Buffer.from('ID3-mp3-convertido'), mimetype: 'audio/mpeg' }) };
    const app = servidor(OGG, 'audio/ogg; codecs=opus', conversor);
    const url = `/api/conversas/${CONVERSA}/midias/${MENSAGEM}`;
    const original = await app.inject({ url });
    expect(original.headers['content-type']).toContain('audio/ogg');
    expect(original.rawPayload).toEqual(OGG);
    const mp3 = await app.inject({ url: url + '?formato=tocar' });
    expect(mp3.statusCode).toBe(200);
    expect(mp3.headers['content-type']).toBe('audio/mpeg');
    expect(mp3.body).toBe('ID3-mp3-convertido');
    const pedaco = await app.inject({ url: url + '?formato=tocar', headers: { range: 'bytes=0-2' } });
    expect(pedaco.statusCode).toBe(206);
    expect(pedaco.body).toBe('ID3');
    expect(pedaco.headers['content-range']).toBe('bytes 0-2/18');
    expect(vezes).toBe(2);
  });

  it('MP3 e M4A não passam pelo conversor; sem ffmpeg, avisa (415)', async () => {
    const nunca: ConversorAudio = { converter: async () => { throw new Error('não devia converter'); } };
    const mp3 = servidor(Buffer.from('ID3'), 'audio/mpeg', nunca);
    const r = await mp3.inject({ url: `/api/conversas/${CONVERSA}/midias/${MENSAGEM}?formato=tocar` });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('audio/mpeg');
    const semFfmpeg = servidor(Buffer.from('OggS'), 'audio/ogg', { converter: async () => null });
    const r2 = await semFfmpeg.inject({ url: `/api/conversas/${CONVERSA}/midias/${MENSAGEM}?formato=tocar` });
    expect(r2.statusCode).toBe(415);
    expect(r2.json().erro).toMatch(/Baixe o arquivo/);
  });

  it.skipIf(!temFfmpeg)('converte uma nota de voz OGG/Opus de verdade para MP3 e guarda a cópia', async () => {
    const ogg = execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ac', '1', '-c:a', 'libopus', '-b:a', '24k', '-f', 'ogg', 'pipe:1']);
    expect(ogg.subarray(0, 4).toString()).toBe('OggS');
    const conv = new ConversorFfmpeg({ ffmpeg: 'ffmpeg' });
    const r = await conv.converter('m1', ogg);
    expect(r).not.toBeNull();
    expect(['audio/mpeg', 'audio/wav']).toContain(r!.mimetype);
    expect(r!.conteudo.length).toBeGreaterThan(1000);
    // segunda vez vem da memória (mesmo objeto)
    expect(await conv.converter('m1', Buffer.from('lixo'))).toBe(r);
    // arquivo que não é áudio: não quebra, devolve null
    expect(await conv.converter('m2', Buffer.from('isto não é áudio'))).toBeNull();
  });

  it('sem o ffmpeg instalado devolve null (o app segue com o original)', async () => {
    const conv = new ConversorFfmpeg({ ffmpeg: '/caminho/que/nao/existe/ffmpeg' });
    expect(await conv.converter('x', Buffer.from('OggS'))).toBeNull();
  });
});

describe('mídia da API oficial (Meta)', () => {
  function graph(arquivo: Response) {
    const pedidos: Array<{ url: string; headers: Record<string, string> }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.includes('cdn.meta.falsa')) return arquivo;
      return new Response(JSON.stringify({ url: 'https://cdn.meta.falsa/audio', mime_type: 'audio/ogg; codecs=opus', file_size: 4 }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    return { f, pedidos };
  }

  it('baixa o áudio com o token e um User-Agent', async () => {
    const g = graph(new Response(Buffer.from('OggS'), { headers: { 'content-type': 'audio/ogg' } }));
    const r = await new CanalMeta({ token: 'TK' }, g.f).baixarMidia('1122', 'wamid.A', 'MIDIA-A');
    expect(r.conteudo.toString()).toBe('OggS');
    expect(r.mimetype).toBe('audio/ogg; codecs=opus');
    expect(g.pedidos[1]!.headers.authorization).toBe('Bearer TK');
    expect(g.pedidos[1]!.headers['user-agent']).toMatch(/Sintonia/);
  });

  it('página HTML no lugar do arquivo não é guardada como áudio (tenta de novo depois)', async () => {
    const g = graph(new Response('<html>Sorry, this content isn\'t available</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    await expect(new CanalMeta({ token: 'TK' }, g.f).baixarMidia('1122', 'wamid.A', 'MIDIA-A')).rejects.toThrow(/página/);
  });
});
