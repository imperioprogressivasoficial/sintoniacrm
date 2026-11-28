import { describe, expect, it } from 'vitest';
import { ErroTranscricao, TranscritorComReserva, TranscritorLocal, type Transcritor } from '../src/conversa/transcricao.js';

describe('transcrição grátis no servidor (Whisper local)', () => {
  it('manda o áudio para o /asr em português e devolve o texto', async () => {
    const pedidos: Array<{ url: string; corpo: FormData }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      pedidos.push({ url, corpo: init!.body as FormData });
      return new Response(JSON.stringify({ text: ' Oi, quero marcar progressiva no sábado. ' }));
    }) as typeof fetch;
    const t = new TranscritorLocal('http://whisper:9000/', 'whisper-local', f);
    expect(await t.transcrever(Buffer.from('ogg'), 'audio/ogg; codecs=opus')).toBe('Oi, quero marcar progressiva no sábado.');
    expect(pedidos[0]!.url).toBe('http://whisper:9000/asr?task=transcribe&language=pt&output=json&encode=true&vad_filter=true');
    expect((pedidos[0]!.corpo.get('audio_file') as File).name).toBe('audio.ogg');
  });

  it('se o Whisper do servidor falhar, usa a OpenAI quando há chave; sem chave, mostra o erro', async () => {
    const quebrado: Transcritor = { modelo: 'whisper-local', transcrever: async () => { throw new ErroTranscricao('fora do ar', 'falhou'); } };
    const openai: Transcritor = { modelo: 'whisper-1', transcrever: async () => 'texto da OpenAI' };
    expect(await new TranscritorComReserva(quebrado, openai, () => true).transcrever(Buffer.from('x'), 'audio/ogg')).toBe('texto da OpenAI');
    await expect(new TranscritorComReserva(quebrado, openai, () => false).transcrever(Buffer.from('x'), 'audio/ogg')).rejects.toThrow('fora do ar');
    // Sem Whisper no servidor: vai direto na OpenAI.
    const so = new TranscritorComReserva(null, openai, () => true);
    expect(so.modelo).toBe('whisper-1');
    expect(await so.transcrever(Buffer.from('x'), 'audio/ogg')).toBe('texto da OpenAI');
  });
});
