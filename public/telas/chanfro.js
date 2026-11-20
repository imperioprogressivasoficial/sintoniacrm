/* Cantos chanfrados no computador (escolha do dono em 20/11: "o chanfrado").
 * Cartões, colunas, painéis e campos ganham quinas cortadas na diagonal; pílulas (botões e abas) ganham pontas.
 * Círculos (fotos, ícones redondos) continuam redondos. Só no computador (≥ 761px); o celular fica como está.
 * Funciona por cima do CSS de cada tela: lê o arredondado de cada elemento e troca pelo corte, uma vez por elemento.
 * Se algo que abre por cima (menu, lista de sugestões) nascer dentro de um elemento cortado, o corte sai dali
 * para não esconder o menu. */
(() => {
  if (!matchMedia('(min-width: 761px)').matches) return;
  const feito = new WeakSet();
  const ACIMA = /^(absolute|fixed)$/;

  function cortar(e) {
    if (feito.has(e) || !(e instanceof HTMLElement)) return;
    feito.add(e);
    if (e.closest('.tema-bt, .nt-bolinha, .radar-num, [data-sem-chanfro]')) return;
    const cs = getComputedStyle(e);
    const r = parseFloat(cs.borderTopLeftRadius);
    if (!r || r < 6 || cs.borderTopLeftRadius.includes('%')) return;
    const w = e.offsetWidth, h = e.offsetHeight;
    if (w < 24 || h < 16) return;
    if (Math.abs(w - h) < 3 && r >= w / 2 - 1) return; // círculo
    const pilula = r >= h / 2 - 1;
    // Corte só onde não esconde nada: sem menus soltos dentro e sem campos de busca com sugestões.
    const podeCortar = cs.overflow !== 'visible' || ![...e.querySelectorAll('*')].some((f) => ACIMA.test(getComputedStyle(f).position));
    if (pilula) {
      e.style.setProperty('border-radius', '6px', 'important');
      if (podeCortar) { const k = Math.min(10, h / 2); e.style.setProperty('clip-path', `polygon(${k}px 0,calc(100% - ${k}px) 0,100% 50%,calc(100% - ${k}px) 100%,${k}px 100%,0 50%)`, 'important'); e.dataset.chanfro = '1'; }
      return;
    }
    e.style.setProperty('border-radius', '4px', 'important');
    if (podeCortar) {
      const k = Math.round(Math.max(6, Math.min(14, Math.min(w, h) * 0.12)));
      e.style.setProperty('clip-path', `polygon(${k}px 0,100% 0,100% calc(100% - ${k}px),calc(100% - ${k}px) 100%,0 100%,0 ${k}px)`, 'important');
      e.dataset.chanfro = '1';
    }
  }
  /** Um menu/aba solta nasceu dentro de algo cortado: tira o corte dos de fora para não esconder. */
  function liberar(n) {
    if (!(n instanceof HTMLElement) || !ACIMA.test(getComputedStyle(n).position)) return;
    for (let p = n.parentElement; p; p = p.parentElement) if (p.dataset.chanfro) { p.style.removeProperty('clip-path'); delete p.dataset.chanfro; }
  }
  let fila = [], marcado = false;
  const processar = () => {
    marcado = false;
    const lote = fila; fila = [];
    for (const raiz of lote) {
      if (!raiz.isConnected) continue;
      liberar(raiz);
      cortar(raiz);
      raiz.querySelectorAll?.('*').forEach(cortar);
    }
  };
  const agendar = (n) => { fila.push(n); if (!marcado) { marcado = true; (window.requestIdleCallback || setTimeout)(processar, { timeout: 300 }); } };
  const iniciar = () => {
    agendar(document.body);
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) agendar(n); }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
