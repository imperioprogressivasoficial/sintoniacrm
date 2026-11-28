/* Barra de baixo do celular: modelo "Some" (escolha do dono em 21/11, entre 4 modelos).
 * Rolando para baixo, a barra desce e sai da tela (como no Safari); rolando um pouco para cima, chegando ao topo
 * ou trocando de tela, ela volta. Só no celular (≤760px).
 * Usa a propriedade `translate` (separada de `transform`), para não brigar com as animações da fluidez.js e do menu
 * da Serena, que mexem no `transform` da mesma barra. Sem animação em loop; com "reduzir movimento", troca direto. */
(() => {
  const CSS = `
  @media (max-width: 760px) {
    html body .trilho { transition: transform .52s cubic-bezier(.32, 1.18, .5, 1), opacity .4s ease, translate .34s cubic-bezier(.32, .72, 0, 1); }
    body.barra-some .trilho { translate: 0 calc(100% + 24px + env(safe-area-inset-bottom, 0px)); }
  }
  @media (prefers-reduced-motion: reduce) { html body .trilho { transition: none !important; } }
  `;
  if (!document.getElementById('barra-some-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'barra-some-css', textContent: CSS }));

  const celular = matchMedia('(max-width: 760px)');
  const ultimo = new WeakMap();
  let pedido = false;
  const mostrar = () => document.body.classList.remove('barra-some');
  const esconder = () => { if (!document.querySelector('dialog[open]')) document.body.classList.add('barra-some'); };

  /* rotas-celular: só some quando a PESSOA rola (dedo ou roda, dentro da lista que rolou). Rolagem feita pela tela (a Agenda abre já na
     hora de agora, por exemplo) não esconde a barra. */
  let mexeu = 0, tocado = null;
  const marcarMexeu = (e) => { mexeu = Date.now(); tocado = e.target instanceof Node ? e.target : null; };
  for (const ev of ['touchstart', 'wheel', 'pointerdown']) document.addEventListener(ev, marcarMexeu, { capture: true, passive: true });
  const pessoaRolou = (alvo) => Date.now() - mexeu < 3000 && tocado && (alvo === document.scrollingElement || alvo.contains(tocado));
  function aoRolar(e) {
    if (!celular.matches) return;
    const alvo = e.target === document ? document.scrollingElement : e.target;
    if (!(alvo instanceof Element) || alvo.closest('.trilho, dialog, .painel-lateral, [role="dialog"]')) return;
    // Só listas que rolam de verdade (no mínimo uma tela e meia de conteúdo).
    if (alvo.scrollHeight < alvo.clientHeight * 1.5) return;
    if (pedido) return;
    pedido = true;
    requestAnimationFrame(() => {
      pedido = false;
      const y = alvo.scrollTop;
      if (!ultimo.has(alvo)) { ultimo.set(alvo, 0); }
      const antes = ultimo.get(alvo);
      if (y < 24) mostrar();
      else if (y > antes + 8 && y > 80 && pessoaRolou(alvo)) esconder();
      else if (y < antes - 6) mostrar();
      if (Math.abs(y - antes) > 6 || y < 24) ultimo.set(alvo, y);
    });
  }
  document.addEventListener('scroll', aoRolar, { capture: true, passive: true });

  // Trocou de tela (a barra marca outra aba), voltou no navegador ou virou o aparelho: a barra aparece.
  const ligar = () => {
    const t = document.querySelector('.trilho');
    if (!t) return setTimeout(ligar, 400);
    new MutationObserver(mostrar).observe(t, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
    // Abrir/fechar uma conversa (a casca troca de classe): ao voltar para a lista, a barra aparece.
    const casca = document.getElementById('casca'); if (casca) new MutationObserver(mostrar).observe(casca, { attributes: true, attributeFilter: ['class'] });
  };
  ligar();
  addEventListener('popstate', mostrar);
  celular.addEventListener?.('change', mostrar);

  window.SintoniaBarra = { mostrar, esconder };
})();
