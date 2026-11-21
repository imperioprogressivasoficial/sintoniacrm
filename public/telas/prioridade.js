/* fluidez2: ordem de chegada na abertura do app (F5 no computador ou abrir no celular).
 * 1º a casca (menu, barra, título) e o esqueleto da lista, que já vêm no HTML;
 * 2º a lista de conversas (ou a tela aberta) e a conversa aberta;
 * 3º o resto (contadores, sino, radar, etiquetas, avisos…), que espera a lista aparecer e então entra aos poucos,
 *    sem disputar a internet nem o servidor com o que a pessoa quer ver primeiro.
 * Também junta pedidos repetidos: o mesmo endereço pedido por duas telas ao mesmo tempo vira um pedido só.
 * Só mexe em GET de /api/ do próprio app; envios (POST, PUT…) passam direto e limpam o que foi guardado.
 * Carregado sem "defer" no <head>, antes de qualquer pedido. */
(() => {
  'use strict';
  if (window.SintoniaPrioridade || typeof window.fetch !== 'function') return;
  const original = window.fetch.bind(window);
  const inicio = Date.now();
  /** Pedidos que a primeira tela precisa: nunca esperam. */
  const URGENTE = /^\/api\/(conversas(\/[^/?]+)?(\?|$)|auth\/eu|situacao|unidades|equipe\/fotos|funis(\?|$))/;
  /** Respostas que não mudam nos primeiros segundos: várias telas pedem na abertura; uma resposta serve a todas. */
  const REPETIDOS = /^\/api\/(empresa|auth\/eu|unidades|conta|situacao|radar|ia\/pausa|espera\/regras|notificacoes\/preferencias|equipe\/fotos|whatsapp\/saude)(\?|$)/;
  const JANELA = 8000; // ms depois de abrir em que repetidos se juntam
  const VALIDADE = 4000; // ms que uma resposta repetida vale
  let liberado = false;
  const fila = [];
  const emVoo = new Map(); // url -> Promise<Response> (pedido em andamento)
  const guardado = new Map(); // url -> { em, resp } (só na janela da abertura)

  const caminho = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname + x.search : null; } catch { return null; } };
  const ocioso = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 30));

  function liberar() {
    if (liberado) return;
    liberado = true;
    // em lotes pequenos, quando o navegador estiver livre (a lista acabou de ser desenhada)
    const lote = () => { fila.splice(0, 4).forEach((f) => f()); if (fila.length) ocioso(lote); };
    ocioso(lote);
  }
  setTimeout(liberar, 2500); // rede de segurança: nada espera mais que isso

  window.fetch = function (entrada, opcoes) {
    const metodo = String(opcoes?.method || (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();
    const url = caminho(entrada instanceof Request ? entrada.url : String(entrada));
    if (!url || !url.startsWith('/api/')) return original(entrada, opcoes);
    if (metodo !== 'GET') { guardado.clear(); return original(entrada, opcoes); } // algo mudou: nada de resposta guardada
    if (opcoes?.signal || entrada instanceof Request) return original(entrada, opcoes);
    const agora = Date.now();
    const repetivel = REPETIDOS.test(url);
    if (repetivel && agora - inicio < JANELA) {
      const g = guardado.get(url);
      if (g && agora - g.em < VALIDADE) return Promise.resolve(g.resp.clone());
    }
    const ja = emVoo.get(url);
    if (ja) return ja.then((r) => r.clone());
    const pedir = () => original(entrada, opcoes);
    const p = (liberado || URGENTE.test(url) ? pedir() : new Promise((ok, erro) => fila.push(() => pedir().then(ok, erro))))
      .then((r) => {
        if (repetivel && r.ok && Date.now() - inicio < JANELA) guardado.set(url, { em: Date.now(), resp: r.clone() });
        return r;
      })
      .finally(() => { if (emVoo.get(url) === p) emVoo.delete(url); });
    emVoo.set(url, p);
    return p.then((r) => r.clone());
  };

  window.SintoniaPrioridade = { liberar, liberado: () => liberado };
})();
