/* Resgatar mensagens do WhatsApp (pedido do dono 20/11): quando alguma mensagem não apareceu na Sintonia.
 * - Conversas › ⋯ › "Sincronizar WhatsApp": busca de novo as conversas recentes de todos os números (por trás),
 *   com uma folha mostrando o andamento.
 * - Dentro de uma conversa: um aviso discreto no topo, "Faltou alguma mensagem? Resgatar do WhatsApp",
 *   que busca só aquela conversa.
 * Servidor: src/resgate/resgate.ts. Entra como histórico (sem IA, sem avisos); nada duplica. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { el, api, post, toast, estado } = ui;
  const $ = (id) => document.getElementById(id);

  const CSS = `
  .rg-topo { display: flex; justify-content: center; margin: 6px 0 10px; }
  .rg-topo button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
    font: 500 12px/1.2 var(--fonte, system-ui); color: var(--sub); background: color-mix(in srgb, var(--fundo, #fff) 82%, transparent);
    box-shadow: inset 0 0 0 1px var(--linha, rgba(13,34,64,.12)); }
  .rg-topo button:hover, .rg-topo button:focus-visible { color: var(--texto); }
  .rg-topo button[aria-busy="true"] { opacity: .7; pointer-events: none; }
  .rg-topo svg { width: 14px; height: 14px; }
  .rg-folha { width: min(420px, calc(100vw - 32px)); border: 0; border-radius: 20px; padding: 20px; background: var(--fundo); color: var(--texto);
    box-shadow: 0 24px 60px rgba(0,0,0,.28); }
  .rg-folha::backdrop { background: rgba(4,20,39,.45); }
  .rg-folha h2 { margin: 0 0 6px; font-size: 17px; }
  .rg-folha p { margin: 0; color: var(--sub); font-size: 13.5px; line-height: 1.5; }
  .rg-barra { margin: 16px 0 8px; height: 4px; border-radius: 4px; background: var(--linha, rgba(13,34,64,.1)); overflow: hidden; }
  .rg-barra i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #106ebe, #3aa0ff); transition: width .4s ease; }
  .rg-num { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--texto); }
  .rg-acoes { display: flex; justify-content: flex-end; margin-top: 16px; }
  .rg-acoes button { all: unset; cursor: pointer; padding: 9px 16px; border-radius: 999px; font: 600 13.5px var(--fonte, system-ui); background: var(--marca-azul, #106ebe); color: #fff; }
  `;
  if (!$('rg-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'rg-css', textContent: CSS }));

  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>';

  // ---------- uma conversa ----------
  async function resgatarConversa(bt) {
    const id = estado.aberta; if (!id) return;
    bt.setAttribute('aria-busy', 'true'); bt.lastChild.textContent = 'Buscando no WhatsApp…';
    try {
      const r = await post(`/api/conversas/${id}/resgatar`, {});
      toast(r.novas ? `${r.novas} ${r.novas === 1 ? 'mensagem resgatada' : 'mensagens resgatadas'} ✓` : 'Tudo certo: nenhuma mensagem faltando nesta conversa.');
      if (r.novas) { estado.assinatura = ''; await ui.atualizar?.(); }
    } catch (e) { toast(e.message || 'Não deu para resgatar agora.'); }
    bt.removeAttribute('aria-busy'); bt.lastChild.textContent = 'Faltou alguma mensagem? Resgatar do WhatsApp';
  }
  function garantirAviso() {
    const msgs = $('msgs'); if (!msgs || !estado.aberta) return;
    if (msgs.firstElementChild?.classList.contains('rg-topo')) return;
    msgs.querySelector(':scope > .rg-topo')?.remove();
    const bt = el('button', { type: 'button', title: 'Busca de novo no WhatsApp as mensagens desta conversa que não apareceram aqui', html: IC });
    bt.append(el('span', { text: 'Faltou alguma mensagem? Resgatar do WhatsApp' }));
    bt.addEventListener('click', () => resgatarConversa(bt));
    msgs.prepend(el('div', { class: 'rg-topo' }, bt));
  }
  const ligar = () => { const m = $('msgs'); if (!m) return setTimeout(ligar, 400); new MutationObserver(garantirAviso).observe(m, { childList: true }); garantirAviso(); };
  ligar();

  // ---------- todas (⋯ da lista) ----------
  async function sincronizarTudo() {
    const barra = el('i'); const num = el('p', { class: 'rg-num', text: 'Começando…' }); const texto = el('p', { text: 'Buscando no WhatsApp as conversas recentes de todos os números. Pode continuar usando a Sintonia: o que faltava aparece sozinho.' });
    const fechar = el('button', { type: 'button', text: 'Fechar' });
    const d = el('dialog', { class: 'rg-folha', 'aria-label': 'Sincronizar WhatsApp' }, el('h2', { text: 'Sincronizar WhatsApp' }), texto, el('div', { class: 'rg-barra' }, barra), num, el('div', { class: 'rg-acoes' }, fechar));
    fechar.addEventListener('click', () => d.close());
    d.addEventListener('close', () => { clearInterval(t); d.remove(); });
    document.body.append(d); d.showModal();
    let t = null;
    const mostrar = (r) => {
      const pct = r.numeros ? Math.round((r.feitos / r.numeros) * 100) : 0;
      barra.style.width = (r.rodando ? Math.max(8, pct) : 100) + '%';
      num.textContent = `${r.mensagens} ${r.mensagens === 1 ? 'mensagem nova' : 'mensagens novas'} em ${r.conversas} ${r.conversas === 1 ? 'conversa' : 'conversas'}`;
      if (!r.rodando) {
        clearInterval(t);
        texto.textContent = r.erro ? r.erro : r.mensagens ? 'Pronto. As mensagens que faltavam já estão nas conversas.' : 'Pronto. Nada estava faltando.';
        if (r.mensagens) { estado.assinatura = ''; ui.atualizar?.(); }
      }
    };
    try {
      mostrar(await post('/api/whatsapp/sincronizar', {}));
      t = setInterval(async () => { try { mostrar(await api('/api/whatsapp/sincronizar')); } catch { clearInterval(t); } }, 2000);
    } catch (e) { texto.textContent = e.message || 'Não deu para sincronizar agora.'; barra.style.width = '0'; num.textContent = ''; }
  }
  const menu = $('menu-lista');
  if (menu && !menu.querySelector('[data-acao="sincronizar"]')) {
    const b = el('button', { role: 'menuitem', 'data-acao': 'sincronizar', html: IC });
    b.append(el('span', { text: 'Sincronizar WhatsApp' }));
    b.addEventListener('click', () => { menu.hidden = true; sincronizarTudo(); });
    menu.append(b);
  }

  window.SintoniaTelas = window.SintoniaTelas || {};
  window.SintoniaTelas.resgatar = { sincronizarTudo };
})();
