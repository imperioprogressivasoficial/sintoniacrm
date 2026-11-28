/* Abas por gesto no celular (pedido do dono em 21/11): arrastar o dedo para o lado em QUALQUER ponto da tela passa para a
 * aba vizinha da barra de baixo (Dashboard · Ligações · Serena · Conversas · Configurações). A tela acompanha o dedo e a
 * vizinha vem junto, como no iPhone. Não precisa pegar na borda.
 * Dedo para a esquerda = próxima aba (a da direita na barra). Dedo para a direita = aba anterior.
 * Fica de fora (para não brigar com outros gestos): linhas da lista de conversas (arrastar a linha), listas que rolam de
 * lado (filtros, funil), campos de texto, conversa aberta, folhas e painéis abertos, telas que não são da barra.
 * Na primeira e na última aba a tela só cede um pouco e volta (efeito elástico). Sem animação em loop. */
(() => {
  const celular = () => innerWidth <= 760;
  const reduzido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CURVA = 'cubic-bezier(.2,.8,.2,1)';
  const EXCLUIR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], dialog, #itens .item, .cg-acao, .trilho, [data-sem-deslizar], canvas, audio, video, .onda';

  const abas = () => [...document.querySelectorAll('.trilho .nav[data-vista]')].filter((b) => !b.hidden && b.offsetParent !== null);
  function contexto() {
    const lista = abas();
    const atual = lista.find((b) => b.getAttribute('aria-current') === 'page');
    if (!atual) return null;
    const vista = document.querySelector('.area > .vista.ativa');
    if (!vista || vista.id !== 'v-' + atual.dataset.vista) return null; // tela de dentro (Agenda, Funil…): sem troca
    const vc = document.getElementById('v-conversas');
    if (vista === vc && vc.classList.contains('abrindo')) return null; // conversa aberta: o gesto é o de voltar
    if ([...document.querySelectorAll('dialog[open]')].length || window.SintoniaPainel?.elemento?.()?.open) return null;
    return { lista, i: lista.indexOf(atual), vista };
  }
  // sobe da origem do toque até a tela: se algo no caminho rola de lado (e ainda tem para onde rolar), o gesto é dele
  function roladorDeLado(el, fim) {
    for (let n = el; n && n !== fim; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 2) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
    }
    return false;
  }

  let g = null;
  function limpar(...els) { for (const e of els) if (e) { e.style.transform = ''; e.style.transition = ''; e.style.willChange = ''; e.classList.remove('ad-vizinha'); } }

  document.addEventListener('touchstart', (e) => {
    g = null;
    if (e.touches.length !== 1 || !celular()) return;
    const t = e.touches[0];
    if (t.clientX < 24 || t.clientX > innerWidth - 12) return; // borda: fica com o "voltar" (fluidez) e com o sistema
    const alvo = e.target instanceof Element ? e.target : null;
    if (!alvo || alvo.closest(EXCLUIR)) return;
    const ctx = contexto(); if (!ctx) return;
    if (roladorDeLado(alvo, ctx.vista.parentElement)) return;
    g = { ...ctx, x0: t.clientX, y0: t.clientY, dir: null, dx: 0, pontos: [{ x: t.clientX, t: e.timeStamp }], quadro: 0 };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = e.touches[0]; const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.4) { g = null; return; } // é rolagem para cima/baixo
      g.dir = dx < 0 ? 1 : -1; // 1 = próxima aba
      const prox = g.lista[g.i + g.dir];
      g.prox = prox || null;
      g.viz = prox ? document.getElementById('v-' + prox.dataset.vista) : null;
      if (g.viz && !g.viz.textContent.trim()) window.SintoniaAbas?.preparar?.(prox.dataset.vista);
      g.w = g.vista.clientWidth || innerWidth;
      const area = g.vista.parentElement;
      g.area = area; g.posArea = area.style.position; g.ovArea = area.style.overflow;
      area.style.position = 'relative'; area.style.overflow = 'hidden';
      g.vista.style.willChange = 'transform'; g.vista.style.transition = 'none';
      if (g.viz) {
        const r = g.vista.getBoundingClientRect(), ra = area.getBoundingClientRect();
        Object.assign(g.viz.style, { position: 'absolute', left: (r.left - ra.left) + 'px', top: (r.top - ra.top) + 'px', width: r.width + 'px', height: r.height + 'px', willChange: 'transform', transition: 'none' });
        g.viz.classList.add('ad-vizinha');
      }
      try { document.activeElement?.blur?.(); } catch {}
    }
    if (e.cancelable) e.preventDefault();
    // sem vizinha (ponta da barra) ou voltando contra o sentido: só cede um pouco
    let d = dx;
    if (!g.viz || Math.sign(dx) === g.dir) d = g.viz ? 0 : dx * 0.25;
    g.dx = d;
    g.pontos.push({ x: t.clientX, t: e.timeStamp }); if (g.pontos.length > 6) g.pontos.shift();
    if (!g.quadro) g.quadro = requestAnimationFrame(() => { if (!g) return; g.quadro = 0; pintar(g, g.dx); });
  }, { passive: false });

  function pintar(s, d) {
    s.vista.style.transform = `translate3d(${d}px,0,0)`;
    if (s.viz) s.viz.style.transform = `translate3d(${d + s.dir * s.w}px,0,0)`;
  }

  function soltar(cancelou) {
    const s = g; g = null;
    if (!s || !s.dir) return;
    cancelAnimationFrame(s.quadro);
    const a = s.pontos[0], b = s.pontos[s.pontos.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms (negativo = para a esquerda)
    const p = Math.abs(s.dx) / s.w;
    const vai = !cancelou && s.viz && ((p > 0.32 && v * s.dir <= 0.2) || (-v * s.dir > 0.4 && p > 0.04));
    const fim = vai ? -s.dir * s.w : 0;
    const resto = Math.abs(fim - s.dx);
    const dur = reduzido() ? 0 : Math.max(140, Math.min(300, resto / Math.max(0.9, Math.abs(v))));
    const terminar = () => {
      const area = s.area;
      if (vai) {
        // a vizinha já está no lugar: vira a tela da aba e o app só troca o estado (sem esmaecer de novo)
        s.viz.classList.add('ativa');
        limpar(s.vista);
        s.viz.style.position = s.viz.style.left = s.viz.style.top = s.viz.style.width = s.viz.style.height = '';
        limpar(s.viz);
        s.prox.click();
      } else {
        limpar(s.vista);
        if (s.viz) { s.viz.style.position = s.viz.style.left = s.viz.style.top = s.viz.style.width = s.viz.style.height = ''; limpar(s.viz); }
      }
      area.style.position = s.posArea; area.style.overflow = s.ovArea;
    };
    if (!dur) { terminar(); return; }
    const op = { duration: dur, easing: CURVA, fill: 'forwards' };
    const an = s.vista.animate([{ transform: `translate3d(${s.dx}px,0,0)` }, { transform: `translate3d(${fim}px,0,0)` }], op);
    const an2 = s.viz?.animate([{ transform: `translate3d(${s.dx + s.dir * s.w}px,0,0)` }, { transform: `translate3d(${fim + s.dir * s.w}px,0,0)` }], op);
    an.finished.then(() => { pintar(s, fim); terminar(); an.cancel(); an2?.cancel(); }, () => terminar());
  }
  document.addEventListener('touchend', () => soltar(false), { passive: true });
  document.addEventListener('touchcancel', () => soltar(true), { passive: true });

  // Deixa as telas vizinhas desenhadas antes (quando o app está parado), para não aparecer tela vazia no arrasto.
  const ocioso = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  function prepararVizinhas() {
    if (!celular()) return;
    if (!window.SintoniaAbas || !window.Sintonia?.ui?.estado?.eu) { setTimeout(prepararVizinhas, 1500); return; } // app ainda entrando
    const lista = abas(); const i = lista.findIndex((b) => b.getAttribute('aria-current') === 'page');
    if (i < 0) return;
    for (const b of [lista[i - 1], lista[i + 1]]) if (b) ocioso(() => window.SintoniaAbas.preparar(b.dataset.vista), { timeout: 1500 });
  }
  const trilho = document.querySelector('.trilho');
  if (trilho) new MutationObserver(() => setTimeout(prepararVizinhas, 400)).observe(trilho, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  setTimeout(prepararVizinhas, 1200);

  // a vizinha aparece durante o arrasto mesmo sem ser a tela ativa
  const css = document.createElement('style');
  css.textContent = '.area > .vista.ad-vizinha { display: flex; z-index: 1; pointer-events: none; }';
  document.head.append(css);
})();
