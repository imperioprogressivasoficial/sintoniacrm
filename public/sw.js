/* Service worker da Sintonia: cuida das notificações (push) e guarda UMA página em cache: /atualizando.html
 * ("Estamos atualizando melhorias"). Nada mais é guardado: as telas sempre vêm do servidor.
 * Quando uma navegação (abrir /app, /conexoes...) falha porque o servidor está reiniciando numa publicação
 * (rede caiu, 502/503/504, ou 404 do proxy, que vem sem o cabeçalho x-sintonia do nosso servidor), mostra essa página,
 * que recarrega sozinha quando /saude voltar.
 * A carga do push vem do servidor (src/notificacoes/notificador.ts): { id, titulo, texto, conversaId?, vista?, etiqueta, silenciosa?, tipo?, vibrar?, insistente? }.
 * Cada mensagem nova da cliente chega com a etiqueta da conversa e renotify: o celular apita de novo sem empilhar avisos.
 */
const CACHE = 'sintonia-atualizando-v1';
const PAGINA = '/atualizando.html';
const guardarPagina = async () => {
  const c = await caches.open(CACHE);
  const r = await fetch(new Request(PAGINA, { cache: 'reload', credentials: 'same-origin' }));
  if (r.ok && r.headers.get('x-sintonia')) await c.put(PAGINA, r);
};
let guardadaEm = 0;

self.addEventListener('install', (e) => e.waitUntil(guardarPagina().catch(() => {}).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('sintonia-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

async function paginaAtualizando() {
  const r = await caches.match(PAGINA, { cacheName: CACHE });
  if (!r) return null;
  return new Response(r.body, { status: 503, statusText: 'Atualizando', headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '5' } });
}

async function navegar(e) {
  let r;
  try {
    r = await fetch(e.request);
  } catch (erro) {
    const p = await paginaAtualizando();
    if (p) return p;
    throw erro;
  }
  if (r.type === 'opaqueredirect') return r;
  const nosso = Boolean(r.headers.get('x-sintonia'));
  if (!nosso && [404, 502, 503, 504].includes(r.status)) return (await paginaAtualizando()) || r;
  // Servidor no ar: de hora em hora, guarda de novo a página (pega a versão nova do visual).
  if (nosso && r.ok && Date.now() - guardadaEm > 3600_000) {
    guardadaEm = Date.now();
    e.waitUntil(guardarPagina().catch(() => { guardadaEm = 0; }));
  }
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.mode !== 'navigate' || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname === PAGINA) return;
  e.respondWith(navegar(e));
});

const destino = (d) => (d && d.conversaId ? `/app#conversa=${d.conversaId}` : d && d.vista ? `/app#vista=${d.vista}` : '/app');

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: 'Sintonia', texto: e.data ? e.data.text() : '' }; }
  const titulo = d.titulo || 'Sintonia';
  e.waitUntil((async () => {
    // Com o app aberto e visível, o próprio app mostra o aviso (toast). Mesmo assim a notificação é sempre mostrada
    // (em silêncio): o iPhone cancela a inscrição de quem recebe push sem mostrar nada.
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visivel = janelas.some((c) => c.visibilityState === 'visible' && c.focused);
    if (visivel) for (const c of janelas) c.postMessage({ tipo: 'sintonia:push', dados: d });
    if (visivel) d = { ...d, silenciosa: true };
    await self.registration.showNotification(titulo, {
      body: d.texto || '',
      icon: '/icone-192.png',
      badge: '/favicon-64.png',
      tag: d.etiqueta || d.id || 'sintonia',
      renotify: !d.silenciosa,
      silent: Boolean(d.silenciosa),
      ...(!d.silenciosa && d.vibrar ? { vibrate: d.insistente ? [300, 120, 300, 120, 600] : [180, 80, 180] } : {}),
      ...(d.insistente ? { requireInteraction: true } : {}),
      timestamp: Date.now(),
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
