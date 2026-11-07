/* Service worker da Sintonia: só cuida das notificações (push). Não guarda páginas em cache.
 * A carga do push vem do servidor (src/notificacoes/notificador.ts): { id, titulo, texto, conversaId?, vista?, etiqueta, silenciosa? }.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const destino = (d) => (d && d.conversaId ? `/app#conversa=${d.conversaId}` : d && d.vista ? `/app#vista=${d.vista}` : '/app');

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: 'Sintonia', texto: e.data ? e.data.text() : '' }; }
  const titulo = d.titulo || 'Sintonia';
  e.waitUntil((async () => {
    // Com o app aberto e visível, o próprio app mostra o aviso (toast): evita aviso em dobro.
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visivel = janelas.some((c) => c.visibilityState === 'visible' && c.focused);
    if (visivel) {
      for (const c of janelas) c.postMessage({ tipo: 'sintonia:push', dados: d });
      return;
    }
    await self.registration.showNotification(titulo, {
      body: d.texto || '',
      icon: '/icone-192.png',
      badge: '/favicon-64.png',
      tag: d.etiqueta || d.id || 'sintonia',
      renotify: !d.silenciosa,
      silent: Boolean(d.silenciosa),
      data: { url: destino(d), id: d.id, conversaId: d.conversaId || null, vista: d.vista || null },
      lang: 'pt-BR',
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const dados = e.notification.data || {};
  const url = new URL(dados.url || '/app', self.location.origin).href;
  e.waitUntil((async () => {
    // Marca como lida (a sessão vai no cookie). Se falhar, o app marca quando abrir.
    if (dados.id) await fetch(`/api/notificacoes/${dados.id}/lida`, { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = janelas.find((c) => new URL(c.url).pathname === '/app');
    if (app) {
      app.postMessage({ tipo: 'sintonia:abrir', dados });
      return app.focus();
    }
    return self.clients.openWindow(url);
  })());
});

// O navegador trocou a inscrição (chave renovada): avisa o app para inscrever de novo na próxima abertura.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((l) => l.forEach((c) => c.postMessage({ tipo: 'sintonia:reinscrever' }))));
});
