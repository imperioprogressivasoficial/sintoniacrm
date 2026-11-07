import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { usuarioDaRequisicao, type OpcoesAuth } from '../auth/rotas.js';

/** Páginas públicas (vendas, login) e a entrada do app, servidas pelo próprio servidor. */

const PASTA = new URL('../../public/', import.meta.url);

const ARQUIVOS: Record<string, { arquivo: string; tipo: string }> = {
  '/': { arquivo: 'index.html', tipo: 'text/html; charset=utf-8' },
  '/entrar': { arquivo: 'entrar.html', tipo: 'text/html; charset=utf-8' },
  '/app': { arquivo: 'app.html', tipo: 'text/html; charset=utf-8' },
  '/conexoes': { arquivo: 'conexoes.html', tipo: 'text/html; charset=utf-8' },
  '/estilo.css': { arquivo: 'estilo.css', tipo: 'text/css; charset=utf-8' },
  '/marca.svg': { arquivo: 'marca.svg', tipo: 'image/svg+xml' },
  '/simbolo.png': { arquivo: 'simbolo.png', tipo: 'image/png' },
  '/simbolo-escuro.png': { arquivo: 'simbolo-escuro.png', tipo: 'image/png' },
  '/icone-512.png': { arquivo: 'icone-512.png', tipo: 'image/png' },
  '/icone-192.png': { arquivo: 'icone-192.png', tipo: 'image/png' },
  '/icone-180.png': { arquivo: 'icone-180.png', tipo: 'image/png' },
  '/icone-32.png': { arquivo: 'icone-32.png', tipo: 'image/png' },
  '/logo.png': { arquivo: 'logo.png', tipo: 'image/png' },
  '/logo-escuro.png': { arquivo: 'logo-escuro.png', tipo: 'image/png' },
  '/telas/painel.js': { arquivo: 'telas/painel.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/ia.js': { arquivo: 'telas/ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/conversa-extras.js': { arquivo: 'telas/conversa-extras.js', tipo: 'text/javascript; charset=utf-8' },
  '/manifest.webmanifest': { arquivo: 'manifest.webmanifest', tipo: 'application/manifest+json' },
  '/ds.css': { arquivo: 'ds.css', tipo: 'text/css; charset=utf-8' },
  '/acesso-rapido.js': { arquivo: 'acesso-rapido.js', tipo: 'text/javascript; charset=utf-8' },
};

export function registrarPaginas(app: FastifyInstance, auth?: OpcoesAuth): void {
  const cache = new Map<string, Buffer>();
  const ler = (arquivo: string) => {
    let b = cache.get(arquivo);
    if (!b) {
      b = readFileSync(new URL(arquivo, PASTA));
      cache.set(arquivo, b);
    }
    return b;
  };

  for (const [rota, { arquivo, tipo }] of Object.entries(ARQUIVOS)) {
    app.get(rota, async (req, reply) => {
      if (auth && (rota === '/app' || rota === '/conexoes' || rota === '/entrar')) {
        const u = await usuarioDaRequisicao(req, auth);
        if ((rota === '/app' || rota === '/conexoes') && !u) return reply.redirect('/entrar');
        if (rota === '/conexoes' && u && u.papel !== 'admin' && u.papel !== 'direcao') return reply.redirect('/app');
        if (rota === '/entrar' && u) return reply.redirect('/app');
      }
      reply
        .header('content-type', tipo)
        .header('cache-control', tipo.startsWith('text/html') ? 'no-store, max-age=0' : 'public, max-age=3600')
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'strict-origin-when-cross-origin');
      if (tipo.startsWith('text/html')) reply.header('x-frame-options', 'DENY');
      return reply.send(ler(arquivo));
    });
  }
}
