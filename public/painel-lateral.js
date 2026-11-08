/*
 * Painel lateral da Sintonia (window.SintoniaPainel): a "página" que entra pela direita.
 * Um só painel para tudo (Filtros, Notificações, Ficha, Nova conversa, Respostas rápidas, Ajuda da IA…):
 * quando algo dentro dele abre outra página, ela é EMPILHADA no mesmo painel (com seta de voltar),
 * em vez de abrir um pop-up por cima de outro.
 *   - celular: tela cheia, entra da direita (como o iOS); computador: gaveta de ~440px com a página atrás.
 *   - Esc / voltar do navegador / gesto de voltar: volta uma página (ou fecha na primeira).
 *   - <dialog> modal: prende o foco, aria-modal, inerte o resto. Animação de 220ms (sem animação em "reduzir movimento").
 *
 *   const p = SintoniaPainel.abrir({ titulo, montar: (corpo, pagina) => {...}, acoes?: [Node], larga?: true, id?: 'filtros', aoFechar? })
 *   SintoniaPainel.empurrar({ titulo, montar, aoSair? })   // nova página dentro do painel aberto (aoSair: ao voltar/fechar)
 *   SintoniaPainel.voltar(); SintoniaPainel.fechar(); SintoniaPainel.atual() // { corpo, titulo, id }
 */
(() => {
  const CSS = `
  dialog.pl { position: fixed; inset: 0 0 0 auto; margin: 0; padding: 0; border: 0; width: min(440px, 100vw); height: 100dvh; max-width: 100vw; max-height: 100dvh;
    border-radius: 0; overflow: hidden; color: var(--texto); background: var(--fundo); box-shadow: -18px 0 60px rgba(4,18,31,.28); border-left: 1px solid var(--linha);
    -webkit-backdrop-filter: none; backdrop-filter: none; transform: translateX(100%); transition: transform .22s cubic-bezier(.2,.8,.2,1); }
  dialog.pl.larga { width: min(620px, 100vw); }
  dialog.pl[open].ver { transform: none; }
  dialog.pl::backdrop { background: rgba(4,18,31,.22); opacity: 0; transition: opacity .22s ease; -webkit-backdrop-filter: none; backdrop-filter: none; }
  dialog.pl.ver::backdrop { opacity: 1; }
  @media (max-width: 760px) { dialog.pl, dialog.pl.larga { width: 100vw; border-left: 0; box-shadow: none; } }
  .pl-pilha { position: relative; width: 100%; height: 100%; overflow: hidden; }
  .pl-pagina { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--fundo); transition: transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease; }
  .pl-pagina.entrando { transform: translateX(100%); }
  .pl-pagina.atras { transform: translateX(-24%); opacity: 0; pointer-events: none; }
  .pl-pagina.saindo { transform: translateX(100%); }
  .pl-topo { flex: none; display: flex; align-items: center; gap: 6px; min-height: 58px; padding: 6px 10px; padding-top: calc(6px + env(safe-area-inset-top)); border-bottom: 1px solid var(--linha); }
  .pl-topo h2 { flex: 1; min-width: 0; margin: 0; font-size: 18px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pl-bt { all: unset; cursor: pointer; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); }
  .pl-bt:hover { background: var(--sel); }
  .pl-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 1px; }
  .pl-bt svg { width: 22px; height: 22px; }
  .pl-acoes { display: flex; align-items: center; gap: 4px; flex: none; }
  .pl-corpo { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px calc(18px + env(safe-area-inset-bottom)); }
  .pl-corpo.sem-margem { padding: 0; display: flex; flex-direction: column; }
  /* a ficha da cliente dentro do painel */
  .pl-corpo .ficha { position: static !important; width: auto !important; max-width: none !important; min-width: 0 !important; border: 0 !important; box-shadow: none !important; overflow: visible; background: transparent; }
  .pl-corpo .ficha > .topo { display: none !important; }
  @media (prefers-reduced-motion: reduce) { dialog.pl, dialog.pl::backdrop, .pl-pagina { transition: none !important; } }
  `;
  const SVG = {
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
  };
  const DUR = 230;
  const reduzido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let d, pilha, paginas = [], aoFechar = null, entradas = 0, fechando = false, timerFechar = null;

  function montarDialog() {
    if (d) return;
    const st = document.createElement('style'); st.id = 'painel-lateral-css'; st.textContent = CSS; document.head.append(st);
    d = document.createElement('dialog'); d.className = 'pl'; d.setAttribute('aria-modal', 'true');
    pilha = document.createElement('div'); pilha.className = 'pl-pilha'; d.append(pilha);
    d.addEventListener('cancel', (e) => { e.preventDefault(); voltar(); });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    // gesto/botão de voltar do celular e do navegador
    addEventListener('popstate', (e) => {
      if (!d.open || fechando) return;
      const alvo = Number(e.state?.sintoniaPainel || 0);
      entradas = alvo;
      if (alvo <= 0) { fecharAgora(); return; }
      while (paginas.length > alvo) desempilhar();
    });
    document.body.append(d);
  }

  function criarPagina({ titulo = '', montar, acoes = [], id = '', semMargem = false, aoSair = null }, primeira) {
    const h = document.createElement('h2'); h.textContent = titulo;
    const sair = document.createElement('button'); sair.type = 'button'; sair.className = 'pl-bt';
    sair.innerHTML = primeira ? SVG.fechar : SVG.voltar; sair.setAttribute('aria-label', primeira ? 'Fechar' : 'Voltar');
    sair.addEventListener('click', () => (primeira ? fechar() : voltar()));
    const caixaAcoes = document.createElement('div'); caixaAcoes.className = 'pl-acoes'; caixaAcoes.append(...acoes.filter(Boolean));
    const topo = document.createElement('div'); topo.className = 'pl-topo'; topo.append(sair, h, caixaAcoes);
    const corpo = document.createElement('div'); corpo.className = 'pl-corpo' + (semMargem ? ' sem-margem' : '');
    const el = document.createElement('section'); el.className = 'pl-pagina'; el.setAttribute('role', 'document'); el.append(topo, corpo);
    const pagina = { el, corpo, id, topo, aoSair, acoes: caixaAcoes, titulo: (t) => { h.textContent = t; d.setAttribute('aria-label', t); } };
    pagina.titulo(titulo);
    try { montar?.(corpo, pagina); } catch (x) { console.error(x); }
    return pagina;
  }
  const sair = (p) => { const f = p.aoSair; p.aoSair = null; try { f?.(); } catch (x) { console.error(x); } };
  const focarEm = (p) => setTimeout(() => (p.corpo.querySelector('[autofocus], input:not([type=hidden]), textarea, select') || p.topo.querySelector('.pl-bt'))?.focus({ preventScroll: true }), reduzido() ? 0 : DUR);

  function abrir(op = {}) {
    montarDialog();
    if (timerFechar) { clearTimeout(timerFechar); timerFechar = null; fechando = false; if (d.open) { d.close(); } }
    const jaAberto = d.open;
    paginas.forEach((p) => { sair(p); p.el.remove(); }); paginas = [];
    const p = criarPagina(op, true);
    paginas.push(p); pilha.append(p.el);
    aoFechar = op.aoFechar || null;
    d.classList.toggle('larga', Boolean(op.larga));
    d.dataset.id = op.id || '';
    if (!jaAberto) {
      fechando = false;
      d.showModal();
      requestAnimationFrame(() => d.classList.add('ver'));
      try { history.pushState({ ...(history.state || {}), sintoniaPainel: 1 }, ''); entradas = 1; } catch { entradas = 0; }
    } else {
      try { history.replaceState({ ...(history.state || {}), sintoniaPainel: 1 }, ''); entradas = 1; } catch {}
    }
    focarEm(p);
    return p;
  }

  function empurrar(op = {}) {
    if (!d?.open) return abrir(op);
    const atual = paginas.at(-1);
    const p = criarPagina(op, false);
    p.el.classList.add('entrando'); pilha.append(p.el); paginas.push(p);
    requestAnimationFrame(() => requestAnimationFrame(() => { p.el.classList.remove('entrando'); atual?.el.classList.add('atras'); }));
    try { history.pushState({ ...(history.state || {}), sintoniaPainel: paginas.length }, ''); entradas = paginas.length; } catch {}
    focarEm(p);
    return p;
  }

  function desempilhar() {
    const p = paginas.pop(); if (!p) return;
    sair(p);
    const anterior = paginas.at(-1);
    p.el.classList.add('saindo'); anterior?.el.classList.remove('atras');
    setTimeout(() => p.el.remove(), reduzido() ? 0 : DUR);
    if (anterior) { anterior.aoVoltar?.(); focarEm(anterior); }
  }

  function voltar() {
    if (!d?.open) return;
    if (paginas.length <= 1) { fechar(); return; }
    if (entradas >= paginas.length) { try { history.back(); return; } catch {} }
    desempilhar();
  }

  function fecharAgora() {
    if (!d?.open) return;
    fechando = true;
    d.classList.remove('ver');
    const cb = aoFechar; aoFechar = null;
    paginas.forEach(sair);
    timerFechar = setTimeout(() => { timerFechar = null; d.close(); paginas.forEach((p) => p.el.remove()); paginas = []; fechando = false; }, reduzido() ? 0 : DUR);
    try { cb?.(); } catch (x) { console.error(x); }
  }
  function fechar() {
    if (!d?.open) return;
    const n = entradas; entradas = 0;
    fecharAgora();
    if (n > 0) { try { history.go(-n); } catch {} }
  }

  window.SintoniaPainel = {
    abrir, empurrar, voltar, fechar,
    atual: () => paginas.at(-1) || null,
    aberto: (id) => Boolean(d?.open) && (id === undefined || d.dataset.id === id),
    elemento: () => d,
  };
})();
