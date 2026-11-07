import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { usuarioDaRequisicao, type OpcoesAuth } from '../auth/rotas.js';

/** Páginas públicas (vendas, login) e a entrada do app, servidas pelo próprio servidor. */

const PASTA = new URL('../../public/', import.meta.url);

const ARQUIVOS: Record<string, { arquivo: string; tipo: string }> = {
  '/': { arquivo: 'index.html', tipo: 'text/html; charset=utf-8' },
  '/entrar': { arquivo: 'entrar.html', tipo: 'text/html; charset=utf-8' },
  '/convite': { arquivo: 'convite.html', tipo: 'text/html; charset=utf-8' },
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
  '/favicon-escuro-32.png': { arquivo: 'favicon-escuro-32.png', tipo: 'image/png' },
  '/favicon-escuro-64.png': { arquivo: 'favicon-escuro-64.png', tipo: 'image/png' },
  '/icone-escuro-180.png': { arquivo: 'icone-escuro-180.png', tipo: 'image/png' },
  '/icone-escuro-192.png': { arquivo: 'icone-escuro-192.png', tipo: 'image/png' },
  '/icone-escuro-512.png': { arquivo: 'icone-escuro-512.png', tipo: 'image/png' },
  '/favicon-32.png': { arquivo: 'favicon-32.png', tipo: 'image/png' },
  '/favicon-64.png': { arquivo: 'favicon-64.png', tipo: 'image/png' },
  '/logo.png': { arquivo: 'logo.png', tipo: 'image/png' },
  '/logo-escuro.png': { arquivo: 'logo-escuro.png', tipo: 'image/png' },
  // Página de vendas: prints reais do app (mockups), foto do herói e rostos da equipe.
  '/vendas/equipe-01.webp': { arquivo: 'vendas/equipe-01.webp', tipo: 'image/webp' },
  '/vendas/equipe-02.webp': { arquivo: 'vendas/equipe-02.webp', tipo: 'image/webp' },
  '/vendas/equipe-03.webp': { arquivo: 'vendas/equipe-03.webp', tipo: 'image/webp' },
  '/vendas/equipe-04.webp': { arquivo: 'vendas/equipe-04.webp', tipo: 'image/webp' },
  '/vendas/equipe-05.webp': { arquivo: 'vendas/equipe-05.webp', tipo: 'image/webp' },
  '/vendas/equipe-06.webp': { arquivo: 'vendas/equipe-06.webp', tipo: 'image/webp' },
  '/vendas/equipe-07.webp': { arquivo: 'vendas/equipe-07.webp', tipo: 'image/webp' },
  '/vendas/equipe-08.webp': { arquivo: 'vendas/equipe-08.webp', tipo: 'image/webp' },
  '/vendas/equipe-09.webp': { arquivo: 'vendas/equipe-09.webp', tipo: 'image/webp' },
  '/vendas/equipe-10.webp': { arquivo: 'vendas/equipe-10.webp', tipo: 'image/webp' },
  '/vendas/equipe-11.webp': { arquivo: 'vendas/equipe-11.webp', tipo: 'image/webp' },
  '/vendas/equipe-12.webp': { arquivo: 'vendas/equipe-12.webp', tipo: 'image/webp' },
  '/vendas/equipe-13.webp': { arquivo: 'vendas/equipe-13.webp', tipo: 'image/webp' },
  '/vendas/equipe-14.webp': { arquivo: 'vendas/equipe-14.webp', tipo: 'image/webp' },
  '/vendas/equipe-15.webp': { arquivo: 'vendas/equipe-15.webp', tipo: 'image/webp' },
  '/vendas/foto-heroi-480.webp': { arquivo: 'vendas/foto-heroi-480.webp', tipo: 'image/webp' },
  '/vendas/foto-heroi-720.webp': { arquivo: 'vendas/foto-heroi-720.webp', tipo: 'image/webp' },
  '/vendas/iphone-conversa-430.webp': { arquivo: 'vendas/iphone-conversa-430.webp', tipo: 'image/webp' },
  '/vendas/iphone-conversa-860.webp': { arquivo: 'vendas/iphone-conversa-860.webp', tipo: 'image/webp' },
  '/vendas/iphone-crm-430.webp': { arquivo: 'vendas/iphone-crm-430.webp', tipo: 'image/webp' },
  '/vendas/iphone-crm-860.webp': { arquivo: 'vendas/iphone-crm-860.webp', tipo: 'image/webp' },
  '/vendas/iphone-modos-430.webp': { arquivo: 'vendas/iphone-modos-430.webp', tipo: 'image/webp' },
  '/vendas/iphone-modos-860.webp': { arquivo: 'vendas/iphone-modos-860.webp', tipo: 'image/webp' },
  '/vendas/mac-conversas-1440.webp': { arquivo: 'vendas/mac-conversas-1440.webp', tipo: 'image/webp' },
  '/vendas/mac-crm-1440.webp': { arquivo: 'vendas/mac-crm-1440.webp', tipo: 'image/webp' },
  '/vendas/mac-dashboard-1440.webp': { arquivo: 'vendas/mac-dashboard-1440.webp', tipo: 'image/webp' },
  '/telas/acessos.js': { arquivo: 'telas/acessos.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/painel.js': { arquivo: 'telas/painel.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/ia.js': { arquivo: 'telas/ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agentes-ia.js': { arquivo: 'telas/agentes-ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/conversa-extras.js': { arquivo: 'telas/conversa-extras.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/funil.js': { arquivo: 'telas/funil.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/automacoes.js': { arquivo: 'telas/automacoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/relatorios.js': { arquivo: 'telas/relatorios.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/leads.js': { arquivo: 'telas/leads.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/transmissoes.js': { arquivo: 'telas/transmissoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/email.js': { arquivo: 'telas/email.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/email-conexoes.js': { arquivo: 'telas/email-conexoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agenda.js': { arquivo: 'telas/agenda.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/notificacoes.js': { arquivo: 'telas/notificacoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/rastreio.js': { arquivo: 'telas/rastreio.js', tipo: 'text/javascript; charset=utf-8' },
  // Service worker do push: na raiz (escopo /) e sem cache longo, para a versão nova valer logo.
  '/sw.js': { arquivo: 'sw.js', tipo: 'text/javascript; charset=utf-8' },
  '/manifest.webmanifest': { arquivo: 'manifest.webmanifest', tipo: 'application/manifest+json' },
  '/responsivo.css': { arquivo: 'responsivo.css', tipo: 'text/css; charset=utf-8' },
  '/telas/responsivo.js': { arquivo: 'telas/responsivo.js', tipo: 'text/javascript; charset=utf-8' },
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
      if (rota === '/sw.js') reply.header('cache-control', 'no-cache').header('service-worker-allowed', '/');
      return reply.send(ler(arquivo));
    });
  }
}
