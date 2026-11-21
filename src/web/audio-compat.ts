import { spawn } from 'node:child_process';

/**
 * Áudio que toca em qualquer aparelho.
 *
 * As notas de voz do WhatsApp (API oficial da Meta e Evolution) chegam em OGG/Opus, e o que a equipe grava
 * no Chrome sai em WebM/Opus. O Chrome toca os dois, mas o Safari do iPhone (e o do Mac antigo) não toca OGG:
 * o player ficava parado. Para esses aparelhos o servidor entrega uma cópia em MP3 (ou WAV, se o ffmpeg não tiver
 * o codificador de MP3), feita com o ffmpeg na hora e guardada em memória. O arquivo original não muda
 * (a transcrição e o download continuam usando o original).
 */

/** Formatos que o Safari, o Chrome e o Firefox tocam direto: não precisam de cópia. */
const UNIVERSAIS = /^audio\/(mpeg|mp3|mp4|m4a|x-m4a|aac|x-aac|wav|x-wav|wave)$/;

/** Este áudio precisa da cópia para tocar em todo lugar? */
export function precisaConverter(mimetype: string | undefined | null): boolean {
  const base = String(mimetype ?? '').split(';')[0]!.trim().toLowerCase();
  if (!base.startsWith('audio/') && base !== 'application/ogg' && base !== 'video/webm') return false;
  return !UNIVERSAIS.test(base);
}

export interface AudioConvertido {
  conteudo: Buffer;
  mimetype: 'audio/mpeg' | 'audio/wav';
}

export interface ConversorAudio {
  converter(chave: string, original: Buffer): Promise<AudioConvertido | null>;
}

/** Onde está o ffmpeg: FFMPEG_PATH, o pacote @ffmpeg-installer/ffmpeg (vem no deploy) ou o do sistema. */
export async function acharFfmpeg(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  try {
    const nome = '@ffmpeg-installer/ffmpeg';
    const m = (await import(nome)) as { path?: string; default?: { path?: string } };
    const p = m.path ?? m.default?.path;
    if (p) return p;
  } catch {
    // sem o pacote: tenta o do sistema
  }
  return 'ffmpeg';
}

function rodar(ffmpeg: string, args: string[], entrada: Buffer, limiteMs: number): Promise<Buffer> {
  return new Promise((ok, erro) => {
    let filho;
    try {
      filho = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      erro(e);
      return;
    }
    const saida: Buffer[] = [];
    let tamanho = 0;
    let msg = '';
    const relogio = setTimeout(() => filho.kill('SIGKILL'), limiteMs);
    filho.stdout.on('data', (b: Buffer) => {
      tamanho += b.length;
      if (tamanho > 64 * 1024 * 1024) filho.kill('SIGKILL');
      else saida.push(b);
    });
    filho.stderr.on('data', (b: Buffer) => {
      if (msg.length < 2000) msg += b.toString();
    });
    filho.on('error', (e) => {
      clearTimeout(relogio);
      erro(e);
    });
    filho.on('close', (codigo) => {
      clearTimeout(relogio);
      if (codigo === 0 && tamanho > 0) ok(Buffer.concat(saida));
      else erro(new Error(`ffmpeg saiu com ${codigo}: ${msg.trim().slice(0, 300)}`));
    });
    filho.stdin.on('error', () => {}); // o ffmpeg pode fechar a entrada antes (arquivo inválido): o "close" explica
    filho.stdin.end(entrada);
  });
}

/**
 * Converte com o ffmpeg e guarda as últimas cópias em memória (o Safari pede o áudio em pedaços,
 * várias vezes: a conversão acontece uma vez só por áudio).
 */
export class ConversorFfmpeg implements ConversorAudio {
  private readonly cache = new Map<string, AudioConvertido>();
  private bytes = 0;
  private readonly andamento = new Map<string, Promise<AudioConvertido | null>>();
  private caminho: Promise<string> | null = null;
  /** O ffmpeg não existe aqui: não tenta de novo a cada pedido. */
  private semFfmpeg = false;

  constructor(
    private readonly opcoes: { ffmpeg?: string; limiteCacheBytes?: number; limiteMs?: number; log?: (msg: string, extra?: unknown) => void } = {},
  ) {}

  private ffmpeg(): Promise<string> {
    this.caminho ??= this.opcoes.ffmpeg ? Promise.resolve(this.opcoes.ffmpeg) : acharFfmpeg();
    return this.caminho;
  }

  async converter(chave: string, original: Buffer): Promise<AudioConvertido | null> {
    const ja = this.cache.get(chave);
    if (ja) {
      // o mais usado vai para o fim (sai por último)
      this.cache.delete(chave);
      this.cache.set(chave, ja);
      return ja;
    }
    if (this.semFfmpeg) return null;
    let p = this.andamento.get(chave);
    if (!p) {
      p = this.fazer(original).finally(() => this.andamento.delete(chave));
      this.andamento.set(chave, p);
    }
    const r = await p;
    if (r) this.guardar(chave, r);
    return r;
  }

  private async fazer(original: Buffer): Promise<AudioConvertido | null> {
    const ffmpeg = await this.ffmpeg();
    const limite = this.opcoes.limiteMs ?? 45_000;
    const base = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1'];
    try {
      const mp3 = await rodar(ffmpeg, [...base, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', 'pipe:1'], original, limite);
      return { conteudo: mp3, mimetype: 'audio/mpeg' };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.semFfmpeg = true;
        this.opcoes.log?.('ffmpeg não encontrado: áudios OGG não tocam no iPhone', ffmpeg);
        return null;
      }
      // sem o codificador de MP3: WAV toca em todo lugar (maior, mas nota de voz é curta)
      try {
        const wav = await rodar(ffmpeg, [...base, '-ar', '24000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], original, limite);
        return { conteudo: wav, mimetype: 'audio/wav' };
      } catch (e2) {
        this.opcoes.log?.('Falha ao converter áudio', String((e2 as Error).message ?? e2));
        return null;
      }
    }
  }

  private guardar(chave: string, r: AudioConvertido) {
    const limite = this.opcoes.limiteCacheBytes ?? 48 * 1024 * 1024;
    if (r.conteudo.length > limite) return;
    if (this.cache.has(chave)) return;
    this.cache.set(chave, r);
    this.bytes += r.conteudo.length;
    for (const [k, v] of this.cache) {
      if (this.bytes <= limite) break;
      this.cache.delete(k);
      this.bytes -= v.conteudo.length;
    }
  }
}
