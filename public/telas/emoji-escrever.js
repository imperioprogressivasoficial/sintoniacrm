/* vistoria (27/11): botão de emoji na barra de escrever da conversa, no computador.
 * No celular o teclado já tem os emojis; no computador (sobretudo Windows) a atendente não tinha como pôr um emoji.
 * Usa o mesmo seletor das reações (window.SintoniaEmojis.seletor, de menu-mensagem.js): busca, categorias e
 * "usados por último". O emoji entra onde está o cursor no campo #texto e o campo continua com o foco.
 * Fecha com ESC, clicando fora ou escolhendo. Sem gancho no app.html além do <script>. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  const $ = (id) => document.getElementById(id);
  const texto = $('texto'), mais = $('mais');
  if (!ui || !texto || !mais) return;
  const { el } = ui;

  const CSS = `
  #emoji-escrever { display: none; }
  @media (min-width: 761px) { #emoji-escrever { display: grid; } }
  .ee-caixa { position: fixed; z-index: 60; width: 330px; max-width: calc(100vw - 16px); border-radius: 18px; background: var(--fundo); color: var(--texto);
    border: 1px solid var(--vidro-borda, var(--linha)); box-shadow: 0 18px 48px rgba(4, 16, 30, .22); overflow: hidden; }
  html[data-tema="escuro"] .ee-caixa { background: #0a2440; box-shadow: 0 18px 48px rgba(0, 0, 0, .45); }`;
  document.head.append(el('style', { id: 'ee-css', text: CSS }));

  const bt = el('button', { type: 'button', class: 'icone', id: 'emoji-escrever', title: 'Emoji', 'aria-label': 'Emoji', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0"/><path d="M9.2 9.6h.01M14.8 9.6h.01" stroke-width="2.6"/></svg>' });
  mais.before(bt);

  let caixa = null;
  let sel = { ini: 0, fim: 0 };
  const lembrar = () => { sel = { ini: texto.selectionStart ?? texto.value.length, fim: texto.selectionEnd ?? texto.value.length }; };
  texto.addEventListener('blur', lembrar);

  function fechar() {
    if (!caixa) return;
    caixa.remove(); caixa = null;
    bt.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', fora, true);
    document.removeEventListener('keydown', tecla, true);
  }
  const fora = (e) => { if (caixa && !caixa.contains(e.target) && !bt.contains(e.target)) fechar(); };
  const tecla = (e) => { if (e.key === 'Escape' && caixa) { e.preventDefault(); e.stopPropagation(); fechar(); texto.focus(); } };

  function por(emo) {
    const v = texto.value; const ini = Math.min(sel.ini, v.length), fim = Math.min(sel.fim, v.length);
    texto.value = v.slice(0, ini) + emo + v.slice(fim);
    const pos = ini + emo.length; sel = { ini: pos, fim: pos };
    texto.dispatchEvent(new Event('input', { bubbles: true }));
    texto.focus({ preventScroll: true });
    try { texto.setSelectionRange(pos, pos); } catch {}
  }

  function abrir() {
    if (caixa) { fechar(); return; }
    const E = window.SintoniaEmojis;
    if (!E?.seletor) { ui.toast?.('Os emojis ainda estão carregando. Tente de novo.'); return; }
    if (document.activeElement === texto) lembrar();
    caixa = el('div', { class: 'ee-caixa', role: 'dialog', 'aria-label': 'Escolher emoji' }, E.seletor({ escolher: por }));
    document.body.append(caixa);
    const r = bt.getBoundingClientRect();
    const larg = caixa.offsetWidth;
    caixa.style.left = Math.max(8, Math.min(innerWidth - larg - 8, r.right - larg)) + 'px';
    // preso pela base (os emojis chegam depois e a caixa cresce para cima, sem passar da tela)
    caixa.style.bottom = (innerHeight - r.top + 8) + 'px';
    caixa.style.maxHeight = Math.max(200, r.top - 16) + 'px';
    bt.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', fora, true);
    document.addEventListener('keydown', tecla, true);
    caixa.querySelector('input')?.focus({ preventScroll: true });
  }
  bt.addEventListener('click', abrir);
  // trocar de conversa ou sair da tela fecha o seletor
  addEventListener('popstate', fechar);
})();
