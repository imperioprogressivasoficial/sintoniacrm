import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { usuarioDaRequisicao, type OpcoesAuth } from '../auth/rotas.js';

/** Páginas públicas (vendas, login) e a entrada do app, servidas pelo próprio servidor. */

const PASTA = new URL('../../public/', import.meta.url);

const ARQUIVOS: Record<string, { arquivo: string; tipo: string }> = {
  '/': { arquivo: 'index.html', tipo: 'text/html; charset=utf-8' },
  '/entrar': { arquivo: 'entrar.html', tipo: 'text/html; charset=utf-8' },
  '/convite': { arquivo: 'convite.html', tipo: 'text/html; charset=utf-8' },
  '/esqueci-senha': { arquivo: 'esqueci-senha.html', tipo: 'text/html; charset=utf-8' },
  '/nova-senha': { arquivo: 'nova-senha.html', tipo: 'text/html; charset=utf-8' },
  // Tela de "abrindo o aplicativo" (login e primeira carga do /app).
  '/abertura.css': { arquivo: 'abertura.css', tipo: 'text/css; charset=utf-8' },
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
  '/vendas/tv-sala-1920.webp': { arquivo: 'vendas/tv-sala-1920.webp', tipo: 'image/webp' },
  '/vendas/tv-sala-960.webp': { arquivo: 'vendas/tv-sala-960.webp', tipo: 'image/webp' },
  // Rostos das clientes de exemplo (animações) e logos dos veículos e concorrentes (uso nominativo).
  '/vendas/cliente-01.webp': { arquivo: 'vendas/cliente-01.webp', tipo: 'image/webp' },
  '/vendas/cliente-02.webp': { arquivo: 'vendas/cliente-02.webp', tipo: 'image/webp' },
  '/vendas/cliente-03.webp': { arquivo: 'vendas/cliente-03.webp', tipo: 'image/webp' },
  '/vendas/cliente-04.webp': { arquivo: 'vendas/cliente-04.webp', tipo: 'image/webp' },
  '/vendas/cliente-05.webp': { arquivo: 'vendas/cliente-05.webp', tipo: 'image/webp' },
  '/vendas/cliente-06.webp': { arquivo: 'vendas/cliente-06.webp', tipo: 'image/webp' },
  '/vendas/cliente-07.webp': { arquivo: 'vendas/cliente-07.webp', tipo: 'image/webp' },
  '/vendas/cliente-08.webp': { arquivo: 'vendas/cliente-08.webp', tipo: 'image/webp' },
  '/vendas/logo-forbes.png': { arquivo: 'vendas/logo-forbes.png', tipo: 'image/png' },
  '/vendas/logo-infomoney.png': { arquivo: 'vendas/logo-infomoney.png', tipo: 'image/png' },
  '/vendas/logo-kommo.png': { arquivo: 'vendas/logo-kommo.png', tipo: 'image/png' },
  '/vendas/logo-hubspot.png': { arquivo: 'vendas/logo-hubspot.png', tipo: 'image/png' },
  '/vendas/logo-rdstation.png': { arquivo: 'vendas/logo-rdstation.png', tipo: 'image/png' },
  '/telas/acessos.js': { arquivo: 'telas/acessos.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/painel.js': { arquivo: 'telas/painel.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/ia.js': { arquivo: 'telas/ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agentes-ia.js': { arquivo: 'telas/agentes-ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/conversa-extras.js': { arquivo: 'telas/conversa-extras.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/chat-ia.js': { arquivo: 'telas/chat-ia.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/funil.js': { arquivo: 'telas/funil.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/automacoes.js': { arquivo: 'telas/automacoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/bot.js': { arquivo: 'telas/bot.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/relatorios.js': { arquivo: 'telas/relatorios.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/leads.js': { arquivo: 'telas/leads.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/transmissoes.js': { arquivo: 'telas/transmissoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/email.js': { arquivo: 'telas/email.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/followup.js': { arquivo: 'telas/followup.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/email-conexoes.js': { arquivo: 'telas/email-conexoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/agenda.js': { arquivo: 'telas/agenda.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/notificacoes.js': { arquivo: 'telas/notificacoes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/alertas.js': { arquivo: 'telas/alertas.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/rastreio.js': { arquivo: 'telas/rastreio.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/comercial.js': { arquivo: 'telas/comercial.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/planos.js': { arquivo: 'telas/planos.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/desempenho.js': { arquivo: 'telas/desempenho.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/clientes.js': { arquivo: 'telas/clientes.js', tipo: 'text/javascript; charset=utf-8' },
  '/telas/respostas.js': { arquivo: 'telas/respostas.js', tipo: 'text/javascript; charset=utf-8' },
  // Service worker do push: na raiz (escopo /) e sem cache longo, para a versão nova valer logo.
  '/sw.js': { arquivo: 'sw.js', tipo: 'text/javascript; charset=utf-8' },
  '/manifest.webmanifest': { arquivo: 'manifest.webmanifest', tipo: 'application/manifest+json' },
  '/responsivo.css': { arquivo: 'responsivo.css', tipo: 'text/css; charset=utf-8' },
  '/telas/responsivo.js': { arquivo: 'telas/responsivo.js', tipo: 'text/javascript; charset=utf-8' },
  '/ds.css': { arquivo: 'ds.css', tipo: 'text/css; charset=utf-8' },
  '/acesso-rapido.js': { arquivo: 'acesso-rapido.js', tipo: 'text/javascript; charset=utf-8' },
  '/painel-lateral.js': { arquivo: 'painel-lateral.js', tipo: 'text/javascript; charset=utf-8' },
  // Calculadora de custo da IA (mesma fórmula na página de vendas e no app).
  '/calculadora-ia.js': { arquivo: 'calculadora-ia.js', tipo: 'text/javascript; charset=utf-8' },
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

  const versoes = new Map<string, string>();
  const versao = (arquivo: string) => {
    let v = versoes.get(arquivo);
    if (!v) { v = createHash('sha256').update(ler(arquivo)).digest('hex').slice(0, 10); versoes.set(arquivo, v); }
    return v;
  };
  const porRota = new Map(Object.entries(ARQUIVOS).map(([r, a]) => [r, a.arquivo]));
  const htmlPronto = new Map<string, Buffer>();
  const comVersoes = (arquivo: string) => {
    let h = htmlPronto.get(arquivo);
    if (!h) {
      const texto = ler(arquivo).toString('utf8').replace(/(href|src)="(\/[^"?#]+\.(?:css|js))"/g, (m, attr: string, rota: string) => {
        const a = porRota.get(rota);
        return a ? `${attr}="${rota}?v=${versao(a)}"` : m;
      });
      // imagens (src e srcset): também ganham ?v=, para foto/print novo aparecer na hora no celular
      const comImagens = texto.replace(/(\/[^"\s?#,]+\.(?:webp|png|jpe?g|svg))(?=[\s",])/g, (m, rota: string) => {
        const a = porRota.get(rota);
        return a ? `${rota}?v=${versao(a)}` : m;
      });
      h = Buffer.from(comImagens, 'utf8');
      htmlPronto.set(arquivo, h);
    }
    return h;
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
      // HTML: cada CSS/JS local ganha ?v=<versão>, para o celular nunca misturar página nova com estilo antigo guardado.
      if (tipo.startsWith('text/html')) return reply.send(comVersoes(arquivo));
      // CSS e JS: o navegador confere a versão a cada uso (ETag) e só baixa de novo quando mudou.
      if (/^(text\/css|text\/javascript|application\/javascript)/.test(tipo)) {
        const etag = `"${versao(arquivo)}"`;
        reply.header('cache-control', 'no-cache').header('etag', etag);
        if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      }
      return reply.send(ler(arquivo));
    });
  }

  // Painel da sala comercial na TV: público, sem login. A página só mostra algo se o token valer
  // (os números vêm de /tv/:token/dados, em src/comercial/rotas.ts).
  app.get('/tv/:token', async (_req, reply) =>
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store, max-age=0')
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(ler('tv.html')),
  );
}
