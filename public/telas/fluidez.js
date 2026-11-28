/* Fluidez da Sintonia (window.SintoniaFluidez): o app responde como um aplicativo nativo do iPhone.
 *   - Trocar de aba: a barra responde no toque e a tela nova entra esmaecendo (~190 ms, de 30% a 100%: sem tela em
 *     branco). Medido no celular emulado: mais leve que View Transitions (que tira um retrato da tela inteira).
 *   - Celular: abrir conversa = a conversa entra deslizando da direita e a lista anda ~30% para a esquerda e escurece;
 *     voltar = o inverso. Arrastar da borda esquerda (começando a menos de 24 px da borda) volta, acompanhando o dedo,
 *     na conversa e nas páginas do painel lateral (ficha, filtros, configurações…).
 *   - Folhas (diálogos que sobem de baixo no celular): sobem com mola suave, fundo escurece aos poucos e dá para
 *     arrastar para baixo para fechar. No computador, os diálogos só aparecem com um leve esmaecer.
 *   - Toque: :active imediato (leve escala nos botões, linha da lista escurece), sem os 300 ms do toque duplo.
 *   - Peso: sem desfoque (backdrop-filter) em cartões que rolam no celular; linhas da lista fora da tela não são
 *     desenhadas (content-visibility); o brilho girando do Radar pausa enquanto a tela rola ou anima.
 *   - "Reduzir movimento" do aparelho: nada desliza, tudo troca direto.
 * Ganchos no app.html (bloco "fluidez"): trocarAba() no clique da barra; a lista só refaz a linha que mudou;
 * a conversa abre na hora com o que já se sabe; a lista guardada aparece ao abrir o app.
 * Sem animação em loop: tudo aqui só anima quando a pessoa faz algo. */
(() => {
  const $ = (id) => document.getElementById(id);
  const raiz = document.documentElement;
  const celular = () => innerWidth <= 760;
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)');
  const reduzido = () => reduzir.matches;
  const EMPURRAR = 'cubic-bezier(.32,.72,0,1)';
  const DUR = 350;
  const BORDA = 24;
  const temLinear = (() => { try { return CSS.supports('animation-timing-function', 'linear(0, 0.5, 1)'); } catch { return false; } })();
  // mola suave (amortecimento 0,86; sobra de 0,5%) para a folha subir; sem linear(), a curva do iOS
  const MOLA = temLinear ? 'linear(0, 0.048, 0.157, 0.291, 0.427, 0.553, 0.662, 0.752, 0.823, 0.878, 0.92, 0.95, 0.971, 0.985, 0.994, 1, 1.003, 1.005, 1.005, 1.005, 1.004, 1.004, 1.003, 1.002, 1)' : EMPURRAR;

  const CSS = `
  /* toque: sem atraso de toque duplo; :active imediato */
  html { touch-action: manipulation; }
  @media (hover: none) {
    :is(button, .botao, .chip, [role="button"], summary, a.botao):not(:disabled):not(.item):not(.cg-acao):not(.nav):active { scale: .96; }
    :is(.folha-lista, .mais-lista, .pl-corpo .lista-opcoes) :is(button, [role="button"]):active { scale: 1; background-color: var(--fz-toque) !important; }
    .lista .item { transition: background-color .25s ease; }
    .lista .item:active { background-color: var(--fz-toque) !important; transition: none; }
    /* sem "hover grudado" depois do toque */
    .lista .item:hover:not([aria-current="true"]):not(:active) { background: transparent; }
  }
  :root { --fz-toque: rgba(13, 34, 64, .07); }
  html[data-tema="escuro"] { --fz-toque: rgba(255, 255, 255, .09); }

  /* lista: linhas fora da tela não custam nada */
  #itens > .item { content-visibility: auto; contain-intrinsic-size: auto 72px; }
  @media (max-width: 760px) { #itens > .item { contain-intrinsic-size: auto 84px; } }
  /* Dashboard no celular: os blocos lá de baixo só são montados quando chegam perto da tela */
  @media (max-width: 760px) { .pn:not(.pn-editando) .pn-col > section.pn-b:nth-child(n+3) { content-visibility: auto; contain-intrinsic-size: auto 280px; } }

  /* peso: no celular, desfoque só no que fica parado (barra de baixo, topo, folhas); nos cartões que rolam, não */
  @media (max-width: 760px) {
    html .lista, html .coluna, html .num, html .tabela, html .opcoes-conta, html .perfil-conta,
    html .vista :is(.pn-b, .cm-p, [class$="-vidro"], [class*="-vidro "], [class*="-card"], [class*="-bloco"], [class*="-cartao"], [class*="-grupo"], .ac-painel, .ra-painel, .au-config) {
      -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
  }
  /* o brilho do Radar descansa enquanto a tela rola ou anima */
  html.fz-movendo #filtros .chip-radar::before, html.fz-movendo #filtros .chip-radar .feixe { animation-play-state: paused !important; }

  /* conversa empilhada (celular): lista e conversa juntas na tela durante o deslize */
  #v-conversas > .fz-sombra { display: none; }
  @media (max-width: 760px) {
    #v-conversas.fz-pilha { position: relative; overflow: hidden; }
    #v-conversas.fz-pilha > .lista, #v-conversas.fz-pilha > .chat { display: flex !important; position: absolute; inset: 0; width: 100%; height: 100%; }
    #v-conversas.fz-pilha > .lista { z-index: 0; }
    #v-conversas.fz-pilha > .fz-sombra { display: block; position: absolute; inset: 0; z-index: 9; background: #000; opacity: 0; pointer-events: none; }
    #v-conversas.fz-pilha > .chat { z-index: 10; box-shadow: -12px 0 32px rgba(4, 18, 31, .18); background-color: var(--fundo); }
    .casca.em-conversa.fz-com-barra .trilho { display: flex !important; }
    html.fz-arrastando, html.fz-arrastando * { user-select: none !important; -webkit-user-select: none !important; }
  }

  /* folhas no celular: sólidas e sem desfoque (o desfoque teria de ser refeito a cada quadro enquanto a folha sobe) */
  @media (max-width: 760px) {
    dialog:not(.pl) { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
    dialog:is(.folha, #d-empresa, #d-ligacao, #d-teste, #d-agendar, #d-pessoa, #d-redefinir, #d-trocar-senha, #d-transferir) { background: var(--fundo) !important; }
    html[data-tema="escuro"] dialog:is(.folha, #d-empresa, #d-ligacao, #d-teste, #d-agendar, #d-pessoa, #d-redefinir, #d-trocar-senha, #d-transferir) { background: #0a2440 !important; }
    dialog::backdrop { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
  }
  /* folhas: fundo escurece e clareia aos poucos */
  dialog.fz-fundo-entra::backdrop { animation: fz-fundo-in .32s ease-out both; }
  dialog.fz-fundo-sai::backdrop { animation: fz-fundo-out .26s ease-in both; }
  dialog.fz-arrastando::backdrop { opacity: calc(1 - var(--fz-arraste, 0)); }
  @keyframes fz-fundo-in { from { opacity: 0; } }
  @keyframes fz-fundo-out { to { opacity: 0; } }
  dialog.fz-folha-pega::before { content: ""; position: sticky; display: block; top: 0; z-index: 3; width: 38px; height: 5px; margin: -4px auto 6px; border-radius: 3px; background: color-mix(in srgb, var(--texto) 22%, transparent); }

  @media (prefers-reduced-motion: reduce) {
    dialog.fz-fundo-entra::backdrop, dialog.fz-fundo-sai::backdrop { animation: none; }
  }`;
  const st = document.createElement('style'); st.id = 'fluidez-css'; st.textContent = CSS; document.head.append(st);

  // iOS só liga o :active quando há quem escute o toque
  document.addEventListener('touchstart', () => {}, { passive: true });

  // ------------------------------------------------------------------ "movendo": rolagem/animação em curso
  let movendoN = 0, movendoT = 0;
  const marcarMovendo = (ms = 160) => { raiz.classList.add('fz-movendo'); clearTimeout(movendoT); movendoT = setTimeout(() => { if (!movendoN) raiz.classList.remove('fz-movendo'); }, ms); };
  const comecarMov = () => { movendoN++; raiz.classList.add('fz-movendo'); };
  const fimMov = () => { movendoN = Math.max(0, movendoN - 1); if (!movendoN) marcarMovendo(80); };
  document.addEventListener('scroll', () => marcarMovendo(), { capture: true, passive: true });

  // ------------------------------------------------------------------ troca de aba
  // A barra responde no toque; a tela nova é montada no quadro seguinte e entra esmaecendo (de 30% a 100%, sem
  // passar por tela vazia). Medido: tirar o retrato da tela (View Transitions) custava mais que isso no celular.
  function trocarAba(fn, v) {
    const alvo = $('v-' + v);
    if (!alvo || alvo.classList.contains('ativa') || reduzido() || document.hidden) { fn(); return; }
    const cel = celular();
    const fazer = () => {
      fn();
      const nova = document.querySelector('.area > .vista.ativa');
      if (!nova) return;
      comecarMov();
      try {
        const a = nova.animate([{ opacity: 0.3, transform: cel ? 'translate3d(0,5px,0)' : 'none' }, { opacity: 1, transform: 'none' }], { duration: cel ? 190 : 130, easing: 'cubic-bezier(.2,.8,.2,1)' });
        a.finished.then(fimMov, fimMov);
      } catch { fimMov(); }
    };
    if (cel) requestAnimationFrame(() => setTimeout(fazer, 0)); else fazer();
  }

  // ------------------------------------------------------------------ conversa empilhada (celular)
  const vc = $('v-conversas'), casca = $('casca');
  let anims = [], pular = false, andando = null;
  const sombra = document.createElement('div'); sombra.className = 'fz-sombra'; sombra.setAttribute('aria-hidden', 'true');
  if (vc) vc.append(sombra);
  const partes = () => ({ lista: vc.querySelector(':scope > .lista'), chat: vc.querySelector(':scope > .chat'), barra: document.querySelector('.trilho') });
  const escuro = () => (raiz.dataset.tema === 'escuro' ? 0.38 : 0.14);
  // p = quanto a conversa cobre a tela (0 = só a lista, 1 = conversa aberta)
  const quadro = (p) => ({
    chat: { transform: `translate3d(${(1 - p) * 100}%,0,0)` },
    lista: { transform: `translate3d(${-30 * p}%,0,0)` },
    sombra: { opacity: String(p * escuro()) },
    barra: { transform: `translate3d(${-30 * p}%,0,0)`, opacity: String(Math.max(0, 1 - p * 1.6)) },
  });
  function cancelarAnims() { anims.forEach((a) => { try { a.cancel(); } catch {} }); anims = []; }
  function montarPilha() {
    cancelarAnims();
    vc.classList.add('fz-pilha'); casca?.classList.add('fz-com-barra');
  }
  function desmontarPilha() {
    cancelarAnims();
    const { lista, chat, barra } = partes();
    for (const e of [lista, chat, sombra, barra]) if (e) { e.style.transform = ''; e.style.opacity = ''; }
    vc.classList.remove('fz-pilha'); casca?.classList.remove('fz-com-barra');
  }
  function pintarPilha(p) {
    const { lista, chat, barra } = partes(); const q = quadro(p);
    if (chat) chat.style.transform = q.chat.transform;
    if (lista) lista.style.transform = q.lista.transform;
    sombra.style.opacity = q.sombra.opacity;
    if (barra) { barra.style.transform = q.barra.transform; barra.style.opacity = q.barra.opacity; }
  }
  /** Anima a pilha de p0 até p1; resolve quando termina (true) ou é interrompida (false). */
  function animarPilha(p0, p1, dur, curva = EMPURRAR) {
    const { lista, chat, barra } = partes(); const a = quadro(p0), b = quadro(p1);
    cancelarAnims();
    const op = { duration: dur, easing: curva, fill: 'forwards' };
    const lista2 = [[chat, 'chat'], [lista, 'lista'], [sombra, 'sombra'], [barra, 'barra']].filter(([e]) => e);
    comecarMov();
    anims = lista2.map(([e, k]) => e.animate([a[k], b[k]], op));
    const fim = anims[0].finished.then(() => { fimMov(); return true; }, () => { fimMov(); return false; });
    andando = fim; fim.finally(() => { if (andando === fim) andando = null; });
    return fim;
  }
  async function empurrar() {
    montarPilha();
    if (await animarPilha(0, 1, DUR)) desmontarPilha();
  }
  async function desempurrar() {
    montarPilha();
    if (await animarPilha(1, 0, DUR)) desmontarPilha();
  }
  if (vc) {
    let aberta = vc.classList.contains('abrindo');
    new MutationObserver(() => {
      const agora = vc.classList.contains('abrindo');
      if (agora === aberta) return;
      aberta = agora;
      if (pular) { pular = false; return; }
      if (!celular() || reduzido() || document.hidden) { desmontarPilha(); return; }
      if (agora) empurrar(); else desempurrar();
    }).observe(vc, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', () => { if (!celular()) desmontarPilha(); });
  }

  // ------------------------------------------------------------------ arrastar da borda esquerda para voltar
  const folhaAberta = () => [...document.querySelectorAll('dialog[open]')].some((d) => !d.classList.contains('pl'));
  function alvoVoltar() {
    const P = window.SintoniaPainel;
    const d = P?.elemento?.();
    if (d?.open && !folhaAberta()) {
      const pags = [...d.querySelectorAll('.pl-pilha > .pl-pagina')].filter((x) => !x.classList.contains('saindo'));
      if (pags.length >= 2) return alvoPagina(pags[pags.length - 1], pags[pags.length - 2]);
      if (pags.length === 1) return alvoPainel(d);
      return null;
    }
    if (vc?.classList.contains('abrindo') && vc.classList.contains('ativa') && !folhaAberta() && !d?.open) return alvoConversa();
    /* rotas-celular: tela de dentro (Agenda, Respostas, Clientes…) volta para a tela de onde veio */
    if (!folhaAberta() && !d?.open && window.SintoniaVoltar?.dentro?.()) return alvoTela();
    return null;
  }
  /* rotas-celular: a tela de dentro acompanha o dedo para a direita e a de onde ela veio aparece por baixo, chegando
   * de -24% (o mesmo jeito das páginas do painel). Ao soltar além do meio, volta de verdade (SintoniaVoltar.voltar). */
  function alvoTela() {
    const V = window.SintoniaVoltar;
    const cima = document.querySelector('.area > .vista.ativa');
    if (!cima) return null;
    const area = cima.parentElement;
    let baixo = $('v-' + V.destino());
    if (baixo === cima) baixo = null;
    let guardado = null;
    const limpar = () => {
      cima.classList.remove('fz-cima'); cima.style.transform = '';
      if (baixo) { baixo.classList.remove('fz-baixo'); for (const k of ['transform', 'left', 'top', 'width', 'height']) baixo.style[k] = ''; }
      if (guardado) { area.style.position = guardado.pos; area.style.overflow = guardado.ov; guardado = null; }
    };
    const pintar = (p) => { cima.style.transform = `translate3d(${p * 100}%,0,0)`; if (baixo) baixo.style.transform = `translate3d(${-24 * (1 - p)}%,0,0)`; };
    return {
      largura: () => cima.clientWidth || innerWidth,
      comecar() {
        if (baixo && !baixo.textContent.trim()) window.SintoniaAbas?.preparar?.(baixo.id.slice(2));
        guardado = { pos: area.style.position, ov: area.style.overflow };
        area.style.position = 'relative'; area.style.overflow = 'hidden';
        if (baixo) {
          const r = cima.getBoundingClientRect(), ra = area.getBoundingClientRect();
          Object.assign(baixo.style, { left: (r.left - ra.left) + 'px', top: (r.top - ra.top) + 'px', width: r.width + 'px', height: r.height + 'px' });
          baixo.classList.add('fz-baixo');
        }
        cima.classList.add('fz-cima');
        pintar(0);
      },
      mover: pintar,
      soltar(vai, p, v) {
        const resta = vai ? 1 - p : p;
        const dur = Math.max(140, Math.min(300, (resta * (cima.clientWidth || 390)) / Math.max(0.8, v || 0)));
        const op = { duration: dur, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' };
        const fim = vai ? 1 : 0;
        const a1 = cima.animate([{ transform: `translate3d(${p * 100}%,0,0)` }, { transform: `translate3d(${fim * 100}%,0,0)` }], op);
        const a2 = baixo?.animate([{ transform: `translate3d(${-24 * (1 - p)}%,0,0)` }, { transform: `translate3d(${vai ? 0 : -24}%,0,0)` }], op);
        a1.finished.then(() => {
          pintar(fim); a1.cancel(); a2?.cancel();
          if (!vai) { limpar(); return; }
          // a tela de dentro fica fora da vista até o app trocar de tela (sem piscar); depois tudo volta ao normal
          const obs = new MutationObserver(() => { if (!cima.classList.contains('ativa')) { obs.disconnect(); requestAnimationFrame(limpar); } });
          obs.observe(cima, { attributes: true, attributeFilter: ['class'] });
          setTimeout(() => { obs.disconnect(); limpar(); }, 900);
          V.voltar({ arrastou: true });
        }, () => limpar());
      },
    };
  }
  function alvoConversa() {
    return {
      largura: () => vc.clientWidth || innerWidth,
      comecar() { montarPilha(); pintarPilha(1); },
      mover(p) { pintarPilha(1 - p); },
      async soltar(vai, p, v) {
        const resta = vai ? 1 - p : p;
        const dur = Math.max(160, Math.min(DUR, (resta * (vc.clientWidth || 390)) / Math.max(0.8, v || 0)));
        const ok = await animarPilha(1 - p, vai ? 0 : 1, dur, 'cubic-bezier(.2,.8,.2,1)');
        if (!ok) return;
        if (vai) { pular = true; $('voltar')?.click(); pular = false; }
        desmontarPilha();
      },
    };
  }
  function alvoPagina(pag, ant) {
    const tirarAtras = () => { ant.style.transform = ''; ant.style.opacity = ''; ant.style.transition = ''; };
    return {
      largura: () => pag.clientWidth || innerWidth,
      comecar() { for (const e of [pag, ant]) e.style.transition = 'none'; ant.style.opacity = '1'; },
      mover(p) { pag.style.transform = `translate3d(${p * 100}%,0,0)`; ant.style.transform = `translate3d(${-24 * (1 - p)}%,0,0)`; },
      soltar(vai, p) {
        const op = { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' };
        const fimP = vai ? 1 : 0;
        const a1 = pag.animate([{ transform: `translate3d(${p * 100}%,0,0)` }, { transform: `translate3d(${fimP * 100}%,0,0)` }], op);
        const a2 = ant.animate([{ transform: `translate3d(${-24 * (1 - p)}%,0,0)`, opacity: 1 }, { transform: `translate3d(${vai ? 0 : -24}%,0,0)`, opacity: vai ? 1 : 0 }], op);
        a1.finished.then(() => {
          if (vai) {
            // a página fica fora da tela até o painel tirá-la; a de trás perde o "atrás" e fica como está
            pag.style.transform = 'translate3d(100%,0,0)';
            ant.style.transform = 'none'; ant.style.opacity = '1';
            const obs = new MutationObserver(() => { if (!ant.classList.contains('atras')) { obs.disconnect(); requestAnimationFrame(tirarAtras); } });
            obs.observe(ant, { attributes: true, attributeFilter: ['class'] });
            setTimeout(() => { obs.disconnect(); if (!ant.classList.contains('atras')) tirarAtras(); }, 900);
            window.SintoniaPainel.voltar();
          } else {
            pag.style.transform = 'none'; ant.style.transform = 'translate3d(-24%,0,0)'; ant.style.opacity = '0';
            requestAnimationFrame(() => { pag.style.transform = ''; pag.style.transition = ''; tirarAtras(); });
          }
          a1.cancel(); a2.cancel();
        }, () => {});
      },
    };
  }
  function alvoPainel(d) {
    return {
      largura: () => d.clientWidth || innerWidth,
      comecar() { d.style.transition = 'none'; },
      mover(p) { d.style.transform = `translate3d(${p * 100}%,0,0)`; },
      soltar(vai, p) {
        const a = d.animate([{ transform: `translate3d(${p * 100}%,0,0)` }, { transform: `translate3d(${vai ? 100 : 0}%,0,0)` }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
        a.finished.then(() => {
          if (vai) {
            d.style.transform = 'translate3d(100%,0,0)';
            d.addEventListener('close', () => { d.style.transform = ''; d.style.transition = ''; }, { once: true });
            window.SintoniaPainel.fechar();
          } else {
            d.style.transform = 'none';
            requestAnimationFrame(() => { d.style.transform = ''; d.style.transition = ''; });
          }
          a.cancel();
        }, () => {});
      },
    };
  }

  let borda = null;
  document.addEventListener('touchstart', (e) => {
    borda = null;
    if (e.touches.length !== 1 || !celular()) return;
    const t = e.touches[0];
    if (t.clientX > BORDA) return;
    const alvo = alvoVoltar(); if (!alvo) return;
    borda = { x0: t.clientX, y0: t.clientY, alvo, dir: null, p: 0, pontos: [{ x: t.clientX, t: e.timeStamp }], quadro: 0 };
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', (e) => {
    const g = borda; if (!g) return;
    const t = e.touches[0]; const dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.dir) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.1) {
        g.dir = 'h'; g.w = g.alvo.largura(); raiz.classList.add('fz-arrastando'); comecarMov();
        try { document.activeElement?.blur?.(); } catch {}
        g.alvo.comecar();
      } else { borda = null; return; }
    }
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
    g.p = Math.max(0, Math.min(1, dx / g.w));
    g.pontos.push({ x: t.clientX, t: e.timeStamp }); if (g.pontos.length > 6) g.pontos.shift();
    if (!g.quadro) g.quadro = requestAnimationFrame(() => { g.quadro = 0; if (borda === g) g.alvo.mover(g.p); });
  }, { passive: false, capture: true });
  const soltarBorda = (e, cancelou) => {
    const g = borda; borda = null;
    if (!g || g.dir !== 'h') return;
    cancelAnimationFrame(g.quadro);
    raiz.classList.remove('fz-arrastando'); fimMov();
    const a = g.pontos[0], b = g.pontos[g.pontos.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0; // px/ms
    const vai = !cancelou && ((g.p > 0.4 && v > -0.2) || (v > 0.45 && g.p > 0.05));
    g.alvo.mover(g.p);
    g.alvo.soltar(vai, g.p, Math.abs(v));
    e?.stopPropagation?.();
  };
  document.addEventListener('touchend', (e) => soltarBorda(e, false), { capture: true });
  document.addEventListener('touchcancel', (e) => soltarBorda(e, true), { capture: true });

  // ------------------------------------------------------------------ folhas e diálogos
  const fecharOriginal = HTMLDialogElement.prototype.close;
  const showModalOriginal = HTMLDialogElement.prototype.showModal;
  const showOriginal = HTMLDialogElement.prototype.show;
  function terminarAgora(d) {
    const f = d.__fzFechando; if (!f) return;
    d.__fzFechando = null;
    try { f.anim.cancel(); } catch {}
    d.classList.remove('fz-fundo-sai', 'fz-arrastando');
    d.style.transform = '';
    fecharOriginal.call(d, f.rv);
  }
  function fecharFolha(d, v = 0, rv) {
    if (d.__fzFechando) return;
    const h = d.getBoundingClientRect().height || innerHeight;
    const atual = new DOMMatrixReadOnly(getComputedStyle(d).transform === 'none' ? undefined : getComputedStyle(d).transform).m42 || 0;
    const dur = Math.max(170, Math.min(300, v > 0.3 ? ((h - atual) / v) : 280));
    (d.__fzAnim || []).forEach((a) => { try { a.cancel(); } catch {} });
    d.classList.remove('fz-fundo-entra'); d.classList.add('fz-fundo-sai');
    comecarMov();
    const anim = d.animate([{ transform: `translate3d(0,${atual}px,0)` }, { transform: 'translate3d(0,100%,0)' }], { duration: dur, easing: 'cubic-bezier(.32,0,.67,0)', fill: 'forwards' });
    d.__fzFechando = { anim, rv };
    anim.finished.then(() => { fimMov(); if (d.__fzFechando?.anim === anim) terminarAgora(d); }, () => fimMov());
  }
  HTMLDialogElement.prototype.close = function (rv) {
    if (this.__fz === 'folha' && this.open && !this.__fzFechando && celular() && !reduzido() && !document.hidden && this.isConnected) { fecharFolha(this, 0, rv); return; }
    if (this.__fzFechando) { const f = this.__fzFechando; f.rv = rv ?? f.rv; terminarAgora(this); return; }
    return fecharOriginal.call(this, rv);
  };
  HTMLDialogElement.prototype.showModal = function () { if (this.__fzFechando) terminarAgora(this); return showModalOriginal.call(this); };
  HTMLDialogElement.prototype.show = function () { if (this.__fzFechando) terminarAgora(this); return showOriginal.call(this); };

  function aoAbrir(d) {
    if (d.classList.contains('pl') || reduzido()) return;
    const r = d.getBoundingClientRect();
    const deBaixo = celular() && r.bottom >= innerHeight - 3 && r.width >= innerWidth - 3;
    d.__fz = deBaixo ? 'folha' : 'centro';
    (d.__fzAnim || []).forEach((a) => { try { a.cancel(); } catch {} });
    d.classList.remove('fz-fundo-sai'); d.classList.add('fz-fundo-entra');
    comecarMov();
    const anim = deBaixo
      ? d.animate([{ transform: 'translate3d(0,100%,0)' }, { transform: 'translate3d(0,0,0)' }], { duration: 520, easing: MOLA })
      : d.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: celular() ? 200 : 150, easing: 'cubic-bezier(.2,.8,.2,1)' });
    d.__fzAnim = [anim];
    anim.finished.then(() => { fimMov(); d.classList.remove('fz-fundo-entra'); }, () => fimMov());
    // folha que não ocupa a tela toda: dá para puxar para baixo para fechar
    if (deBaixo && r.top > 40) { d.classList.add('fz-folha-pega'); ligarArrasto(d); } else d.classList.remove('fz-folha-pega');
  }
  new MutationObserver((ms) => {
    for (const m of ms) {
      const d = m.target;
      if (d.tagName === 'DIALOG' && d.open && m.oldValue === null) { try { aoAbrir(d); } catch {} }
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });

  const NAO_ARRASTA = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], canvas, [draggable="true"], input[type="range"]';
  function rolavelAcima(el, d) {
    for (let e = el; e && e !== d.parentElement; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight + 1) { const oy = getComputedStyle(e).overflowY; if ((oy === 'auto' || oy === 'scroll') && e.scrollTop > 0) return true; }
      if (e === d) break;
    }
    return false;
  }
  function ligarArrasto(d) {
    if (d.__fzArrasto) return;
    d.__fzArrasto = true;
    let g = null;
    d.addEventListener('touchstart', (e) => {
      g = null;
      if (d.__fz !== 'folha' || !celular() || reduzido() || e.touches.length !== 1 || d.__fzFechando) return;
      if (e.target.closest?.(NAO_ARRASTA)) return;
      if (rolavelAcima(e.target, d)) return;
      const t = e.touches[0];
      g = { y0: t.clientY, x0: t.clientX, dir: null, dy: 0, pontos: [{ y: t.clientY, t: e.timeStamp }], quadro: 0 };
    }, { passive: true });
    d.addEventListener('touchmove', (e) => {
      if (!g) return;
      const t = e.touches[0]; const dy = t.clientY - g.y0, dx = t.clientX - g.x0;
      if (!g.dir) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        if (dy > 0 && Math.abs(dy) > Math.abs(dx)) {
          g.dir = 'v'; g.h = d.getBoundingClientRect().height || innerHeight;
          (d.__fzAnim || []).forEach((a) => { try { a.finish(); } catch {} });
          d.classList.add('fz-arrastando'); comecarMov();
        } else { g = null; return; }
      }
      if (e.cancelable) e.preventDefault();
      g.dy = Math.max(0, dy);
      g.pontos.push({ y: t.clientY, t: e.timeStamp }); if (g.pontos.length > 6) g.pontos.shift();
      if (!g.quadro) {
        const gg = g;
        g.quadro = requestAnimationFrame(() => {
          gg.quadro = 0;
          d.style.transform = `translate3d(0,${gg.dy}px,0)`;
          d.style.setProperty('--fz-arraste', String(Math.min(1, gg.dy / gg.h)));
        });
      }
    }, { passive: false });
    const soltar = (cancelou) => {
      const gg = g; g = null;
      if (!gg || gg.dir !== 'v') return;
      cancelAnimationFrame(gg.quadro);
      fimMov();
      const a = gg.pontos[0], b = gg.pontos[gg.pontos.length - 1];
      const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
      d.style.transform = `translate3d(0,${gg.dy}px,0)`;
      d.classList.remove('fz-arrastando'); d.style.removeProperty('--fz-arraste');
      if (!cancelou && (gg.dy > gg.h * 0.28 || (v > 0.5 && gg.dy > 12))) { fecharFolha(d, v); return; }
      const volta = d.animate([{ transform: `translate3d(0,${gg.dy}px,0)` }, { transform: 'translate3d(0,0,0)' }], { duration: 380, easing: MOLA });
      d.style.transform = '';
      d.__fzAnim = [volta];
    };
    d.addEventListener('touchend', () => soltar(false));
    d.addEventListener('touchcancel', () => soltar(true));
  }

  /** Enquanto a conversa desliza, o desenho pesado (200 mensagens) espera o fim do deslize: o quadro fica livre. */
  const pilhaAndando = () => andando && Promise.race([andando, new Promise((ok) => setTimeout(ok, DUR + 80))]);
  window.SintoniaFluidez = { trocarAba, reduzido, pilhaAndando };
})();
