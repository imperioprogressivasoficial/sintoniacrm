/* Faixa "Sincronizando suas conversas do WhatsApp…" no topo da lista de Conversas (dono 23/11): enquanto o histórico
 * ainda está chegando (depois de conectar um número), quem está na lista vê que está carregando, com o número de
 * conversas e mensagens que já entraram. Some sozinha ("Tudo sincronizado") quando termina.
 * Pergunta ao servidor GET /api/sincronizando: a cada 4 s com a faixa à mostra, a cada 20 s quando não há nada. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const $ = (id) => document.getElementById(id);
  const CSS = `
  .sl-faixa { display: flex !important; align-items: center; gap: 10px; margin: 4px 12px 8px; align-self: stretch; box-sizing: border-box; width: auto !important; min-width: 0; flex: none; writing-mode: horizontal-tb; padding: 10px 12px; border-radius: 14px;
    background: color-mix(in srgb, #106ebe 10%, var(--painel, #fff)); color: var(--texto); font-size: 13.5px; line-height: 1.35;
    border: 1px solid color-mix(in srgb, #106ebe 22%, transparent); }
  html[data-tema="escuro"] .sl-faixa { background: color-mix(in srgb, #0ffcbe 10%, var(--painel)); border-color: color-mix(in srgb, #0ffcbe 25%, transparent); }
  .sl-faixa[hidden] { display: none; }
  .sl-faixa i { width: 20px; height: 20px; flex: none; color: #106ebe; display: grid; }
  html[data-tema="escuro"] .sl-faixa i { color: #0ffcbe; }
  .sl-faixa i svg { width: 20px; height: 20px; }
  .sl-faixa.sl-girando i svg { animation: sl-gira 1s linear infinite; }
  @keyframes sl-gira { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .sl-faixa.sl-girando i svg { animation: none; } }
  .sl-faixa span { flex: 1; min-width: 0; }
  .sl-faixa b { font-weight: 650; display: block; }
  .sl-faixa small { color: var(--sub); font-size: 12.5px; }`;
  const GIRA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>';
  const OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/></svg>';
  let estiloPronto = false, ativoAntes = false, timer = 0, escondendo = 0;
  const plural = (n, um, varios) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;

  function faixa() {
    let f = $('sl-faixa');
    if (f) return f;
    const itens = $('itens'); if (!itens) return null;
    if (!estiloPronto) { estiloPronto = true; document.head.append(Object.assign(document.createElement('style'), { textContent: CSS })); }
    f = document.createElement('div'); f.id = 'sl-faixa'; f.className = 'sl-faixa'; f.setAttribute('role', 'status'); f.setAttribute('aria-live', 'polite'); f.hidden = true;
    (document.getElementById('sc-faixa') || itens).before(f);
    return f;
  }
  function mostrar(r) {
    const f = faixa(); if (!f) return;
    clearTimeout(escondendo);
    const conv = r.canais.reduce((s, c) => s + (c.conversas || 0), 0);
    const msgs = r.canais.reduce((s, c) => s + (c.mensagens || 0), 0);
    const faltam = r.canais.reduce((s, c) => s + (c.faltam || 0), 0);
    f.classList.add('sl-girando');
    f.innerHTML = `<i>${GIRA}</i>`;
    const t = document.createElement('span');
    const b = document.createElement('b'); b.textContent = 'Sincronizando suas conversas do WhatsApp…';
    const s = document.createElement('small');
    s.textContent = (conv || msgs ? `${plural(conv, 'conversa', 'conversas')} · ${plural(msgs, 'mensagem', 'mensagens')} já chegaram` : 'Trazendo as conversas do celular')
      + (faltam ? ` · faltam ${faltam.toLocaleString('pt-BR')}` : '') + '. Pode continuar usando.';
    t.append(b, s); f.append(t); f.hidden = false;
  }
  function terminou() {
    const f = faixa(); if (!f || f.hidden) return;
    f.classList.remove('sl-girando');
    f.innerHTML = `<i>${OK}</i><span><b>Tudo sincronizado</b><small>As conversas novas aparecem na hora.</small></span>`;
    escondendo = setTimeout(() => { f.hidden = true; }, 5000);
    ui.atualizar?.();
  }
  async function conferir() {
    clearTimeout(timer);
    let proximo = 20000;
    if (!document.hidden) {
      try {
        const r = await ui.api('/api/sincronizando');
        if (r?.ativo) { mostrar(r); proximo = 4000; ui.atualizar?.(); }
        else if (ativoAntes) terminou();
        ativoAntes = Boolean(r?.ativo);
      } catch { /* sem login ou servidor ocupado: tenta depois */ }
    }
    timer = setTimeout(conferir, proximo);
  }
  addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
  setTimeout(conferir, 1500);
  window.SintoniaSincLista = { conferir, ativo: () => ativoAntes };
})();
