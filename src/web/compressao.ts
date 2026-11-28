import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';

/**
 * fluidez2: respostas de texto (HTML, CSS, JS, JSON, SVG) saem comprimidas (brotli ou gzip), sem pacote novo.
 * Antes o app ia inteiro sem compressão: ~2,5 MB de JS na primeira abertura e a lista de conversas (≈140 KB)
 * a cada 4 s. Com brotli o JS cai para ~⅕ e a lista para ~⅒.
 *
 * Só comprime corpo que já está pronto (texto ou Buffer): fluxos (stream, SSE, arquivos de mídia) passam direto.
 * Arquivos fixos (Buffer guardado em memória por src/web/paginas.ts) são comprimidos uma vez, no capricho, e guardados;
 * respostas da API (texto que muda) usam um nível rápido.
 */
const br = promisify(brotliCompress);
const gz = promisify(gzip);

const MINIMO = 1024;
const MAXIMO = 8 << 20; // arquivo enorme (documento de texto de 8 MB+) vai como está
const TIPOS = /^(text\/|application\/(json|javascript|manifest\+json|xml)|image\/svg\+xml)/i;

/** Qual compressão o navegador aceita (prefere brotli). `q=0` desliga. */
export function escolherCompressao(aceita: string | string[] | undefined): 'br' | 'gzip' | null {
  const s = String(Array.isArray(aceita) ? aceita.join(',') : aceita ?? '').toLowerCase();
  const pode = (nome: string) => s.split(',').some((p) => {
    const [n, ...params] = p.trim().split(';');
    if (n !== nome) return false;
    const q = params.map((x) => x.trim()).find((x) => x.startsWith('q='));
    return !q || Number(q.slice(2)) > 0;
  });
  if (pode('br')) return 'br';
  if (pode('gzip')) return 'gzip';
  return null;
}

const guardados = new WeakMap<Buffer, Partial<Record<'br' | 'gzip', Promise<Buffer>>>>();

async function comprimir(corpo: Buffer, tipo: 'br' | 'gzip', fixo: boolean): Promise<Buffer> {
  if (tipo === 'br') {
    return br(corpo, { params: { [constants.BROTLI_PARAM_QUALITY]: fixo ? 11 : 4, [constants.BROTLI_PARAM_SIZE_HINT]: corpo.length } });
  }
  return gz(corpo, { level: fixo ? 9 : 6 });
}

export function registrarCompressao(app: FastifyInstance): void {
  app.addHook('onSend', async (req, reply, corpo) => {
    if (req.method === 'HEAD' || reply.statusCode === 204 || reply.statusCode === 304 || reply.statusCode === 206) return corpo;
    if (typeof corpo !== 'string' && !Buffer.isBuffer(corpo)) return corpo; // stream (mídia, SSE) ou vazio
    if (reply.getHeader('content-encoding') || reply.getHeader('content-range')) return corpo;
    if (!TIPOS.test(String(reply.getHeader('content-type') ?? ''))) return corpo;
    const tamanho = typeof corpo === 'string' ? Buffer.byteLength(corpo) : corpo.length;
    reply.header('vary', 'accept-encoding');
    if (tamanho < MINIMO || tamanho > MAXIMO) return corpo;
    const tipo = escolherCompressao(req.headers['accept-encoding']);
    if (!tipo) return corpo;
    let pronto: Buffer;
    if (Buffer.isBuffer(corpo) && !req.url.startsWith('/api/')) {
      // Buffer fora da API = arquivo fixo guardado em memória (páginas, telas): comprime uma vez só, no capricho, e reaproveita.
      let g = guardados.get(corpo);
      if (!g) { g = {}; guardados.set(corpo, g); }
      g[tipo] ??= comprimir(corpo, tipo, true);
      pronto = await g[tipo]!;
    } else {
      pronto = await comprimir(Buffer.isBuffer(corpo) ? corpo : Buffer.from(corpo), tipo, false);
    }
    if (pronto.length >= tamanho) return corpo;
    reply.removeHeader('content-length');
    reply.header('content-encoding', tipo);
    return pronto;
  });
}
