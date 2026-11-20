/* Gestos na lista de Conversas, como no WhatsApp do iPhone — window.SintoniaTelas.conversasGestos.
 *   - Arrastar a linha para a DIREITA: "Não lida"/"Lida" (verde) e "Radar"/"Tirar do radar" (azul-marinho).
 *   - Arrastar para a ESQUERDA: "Mais" (cinza: opções da conversa) e "Mover" (azul: etapa do funil).
 *   - Arrastar bem longo até o fim: faz a ação da ponta (não lida / mover).
 *   - Segurar o dedo (~450 ms) ou botão direito do mouse: prévia das últimas mensagens + menu de ações.
 * Só uma linha aberta por vez; rolar a lista, tocar fora ou tocar na própria linha fecha.
 * Ganchos no app.html (bloco "conversas-gestos"): segurar() no começo de desenharLista (não redesenha a lista
 * com uma linha aberta ou arrastando; redesenha ao fechar), ui.naoLida/esperando/textoPrevia, c.marcadaNaoLida.
 * Servidor: GET /api/conversas/:id/previa (só leitura, não marca como lida) e /api/conversas/nao-lidas | lidas.
 * Texto que vem do servidor entra sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  const lista = document.getElementById('itens');
  if (!ui || !lista) return;
  const { api, post, el, toast, estado } = ui;

  const BT = 78; // largura de cada botão de ação
  const ABERTO = BT * 2;
  const SEGURAR_MS = 450;
  const LONGO = 0.58; // fração da largura da linha para o "arrastar até o fim"

  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const SVG = {
    naoLida: ic('<path d="M20 12.5a8 8 0 0 1-11.7 7L4 20.5l1.1-3.9A8 8 0 1 1 20 12.5Z"/><circle cx="18" cy="6" r="3" fill="currentColor" stroke="none"/>'),
    lida: ic('<path d="M20 12.5a8 8 0 0 1-11.7 7L4 20.5l1.1-3.9A8 8 0 1 1 20 12.5Z"/><path d="m8.5 12.5 2.3 2.3 4.7-4.8"/>'),
    radar: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" opacity=".5"/><path d="M12 12 18.2 5.8"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
    tirarRadar: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" opacity=".5"/><path d="M5.6 5.6l12.8 12.8"/>'),
    mais: ic('<circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="16" cy="12" r=".9" fill="currentColor"/>'),
    mover: ic('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><path d="M15.5 18h5.5m-2-2 2 2-2 2"/>'),
    atribuir: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 11.6-4"/><path d="M15 18h6m-2.2-2.3L21 18l-2.2 2.3"/>'),
    tarefa: ic('<rect x="4.5" y="4" width="15" height="17" rx="2.5"/><path d="M9 4V3h6v1"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>'),
    finalizar: ic('<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.9"/>'),
    abrir: ic('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M9 11.5h6m-2.5-2.5 2.5 2.5-2.5 2.5"/>'),
    ficha: ic('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="11" r="2.2"/><path d="M5.8 16.2a3.4 3.4 0 0 1 6.4 0M14.5 10h4M14.5 13.5h3"/>'),
    ia: ic('<path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6L12 3Z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>'),
    agendar: ic('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5"/>'),
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    ok: ic('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  };

  const CSS = `
  #itens { position: relative; overflow-x: hidden; }
  #itens .item { touch-action: pan-y; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
  #itens .item.cg-movendo { will-change: transform; position: relative; z-index: 1; }
  #itens .item.cg-solta { transition: transform .26s cubic-bezier(.2,.8,.2,1); }
  .badge.cg-ponto { min-width: 12px !important; width: 12px; height: 12px !important; padding: 0 !important; margin-top: 6px; }
  .cg-camada { position: absolute; left: 0; right: 0; z-index: 0; pointer-events: none; }
  .cg-lado { position: absolute; top: 0; bottom: 0; display: flex; overflow: hidden; pointer-events: auto; }
  .cg-lado.cg-esq { left: 0; } .cg-lado.cg-dir { right: 0; }
  .cg-lado.cg-solta { transition: width .26s cubic-bezier(.2,.8,.2,1); }
  .cg-acao { all: unset; box-sizing: border-box; cursor: pointer; flex: 1 1 0; min-width: 0; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
    color: #fff; font: 600 12.5px/15px var(--fonte, system-ui); text-align: center; transition: flex-grow .18s ease, flex-basis .18s ease; -webkit-tap-highlight-color: transparent; }
  .cg-acao svg { width: 25px; height: 25px; flex: none; }
  .cg-acao span { display: block; max-width: ${BT - 8}px; }
  .cg-acao:focus-visible { outline: 2px solid #fff; outline-offset: -4px; }
  .cg-lado.cg-longo .cg-acao { flex: 0 0 0; }
  .cg-lado.cg-longo .cg-acao.cg-ponta { flex: 1 1 auto; }
  .cg-lido { background: #0fb37f; }
  .cg-radar { background: #0d2240; }
  .cg-mais { background: #8a97a6; }
  .cg-mover { background: #106ebe; }
  html[data-tema="escuro"] .cg-radar { background: #1c3d66; }
  html[data-tema="escuro"] .cg-mais { background: #4b6078; }
  html[data-tema="escuro"] .cg-lido { background: #0a9a6c; }

  /* prévia (segurar o dedo): fundo desfocado, cartão com as últimas mensagens e o menu */
  .cg-fundo { position: fixed; inset: 0; z-index: 2147483000; background: rgba(8,26,46,.28); -webkit-backdrop-filter: blur(16px) saturate(1.1); backdrop-filter: blur(16px) saturate(1.1);
    touch-action: none; overscroll-behavior: contain; animation: cg-fundo .18s ease both; }
  html[data-tema="escuro"] .cg-fundo { background: rgba(0,8,18,.5); }
  @keyframes cg-fundo { from { opacity: 0; } }
  .cg-previa { position: absolute; left: 50%; top: 50%; width: min(380px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 10px;
    max-height: calc(100dvh - 72px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    transform: translate(-50%, -50%); animation: cg-entra .2s cubic-bezier(.2,.8,.2,1) both; }
  .cg-previa.cg-no-ponto { transform: none; }
  @keyframes cg-entra { from { opacity: 0; scale: .94; } }
  @media (prefers-reduced-motion: reduce) { .cg-fundo, .cg-previa { animation: none; } #itens .item.cg-solta, .cg-lado.cg-solta, .cg-acao { transition: none; } }
  .cg-cartao { border-radius: 18px; overflow: hidden; background: var(--chat, #eef3f8); box-shadow: 0 18px 50px rgba(4,18,31,.28); display: flex; flex-direction: column; flex: 0 1 auto; min-height: 160px; max-height: min(52vh, 440px); }
  .cg-cab { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--fundo); border-bottom: 1px solid var(--linha); flex: none; }
  .cg-cab .avatar { width: 34px; height: 34px; flex: none; }
  .cg-cab b { font-size: 16px; font-weight: 600; color: var(--texto); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cg-msgs { flex: 1; min-height: 90px; overflow-y: auto; padding: 10px 10px 12px; display: flex; flex-direction: column; gap: 4px; touch-action: pan-y; overscroll-behavior: contain; }
  .cg-msgs .cg-dia { align-self: center; margin: 6px 0 2px; padding: 3px 10px; border-radius: 8px; font-size: 12px; color: var(--sub); background: var(--data, var(--fundo)); box-shadow: var(--sombra); }
  .cg-bal { max-width: 82%; padding: 6px 9px 5px; border-radius: 10px; font-size: 14px; line-height: 19px; color: var(--texto); box-shadow: var(--sombra); white-space: pre-wrap; overflow-wrap: anywhere; background: var(--recebida); align-self: flex-start; }
  .cg-bal.eu { background: var(--enviada); align-self: flex-end; }
  .cg-bal.ia { background: var(--ia-fundo, var(--enviada)); align-self: flex-end; }
  .cg-bal.sis { align-self: center; background: transparent; box-shadow: none; color: var(--sub); font-size: 12.5px; text-align: center; }
  .cg-bal small { display: block; text-align: right; font-size: 11px; color: var(--sub); margin-top: 1px; }
  .cg-bal .cg-autor { display: block; font-size: 12px; font-weight: 600; color: var(--equipe, #0a4c86); }
  .cg-vazio { margin: auto; color: var(--sub); font-size: 14px; text-align: center; }
  .cg-menu { flex: none; width: min(270px, 100%); border-radius: 16px; overflow: hidden; background: var(--fundo); box-shadow: 0 18px 50px rgba(4,18,31,.28); }
  .cg-menu button { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; font: 400 16px/21px var(--fonte, system-ui); color: var(--texto); border-bottom: 1px solid var(--linha); }
  .cg-menu button:last-child { border-bottom: 0; }
  .cg-menu button:hover, .cg-menu button:focus-visible { background: var(--hover); }
  .cg-menu button svg { width: 21px; height: 21px; flex: none; color: var(--icone, var(--texto)); }
  .cg-menu button.cg-forte { font-weight: 600; }
  @media (min-width: 761px) { .cg-menu button { padding: 9px 14px; font-size: 15px; } }

  /* folhas (Mais, Mover, Atribuir): a folha de baixo do app (dialog.folha) */
  dialog.folha.cg-folha .cg-sub { margin: -4px 0 12px; text-align: center; font-size: 14px; color: var(--sub); }
  .cg-funis { display: flex; gap: 6px; overflow-x: auto; margin: 0 0 12px; padding-bottom: 2px; scrollbar-width: none; }
  .cg-funis button { all: unset; cursor: pointer; flex: none; padding: 7px 13px; border-radius: 999px; font-size: 14px; font-weight: 500; color: var(--texto); background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); }
  .cg-funis button[aria-pressed="true"] { background: #106ebe; color: #fff; box-shadow: none; }
  .cg-etapa-cor { width: 14px; height: 14px; border-radius: 50%; flex: none; margin: 0 5px; background: var(--cor, #8a97a6); }
  .folha-lista button .cg-marca { width: 22px; height: 22px; color: #106ebe; flex: none; }
  html[data-tema="escuro"] .folha-lista button .cg-marca { color: #0ffcbe; }
  .cg-folha .folha-lista { max-height: 60vh; overflow-y: auto; }
  .cg-carregando { padding: 18px; text-align: center; color: var(--sub); font-size: 14px; }
  `;
  document.head.append(el('style', { text: CSS }));

  // ------------------------------------------------------------ estado
  const G = { arrasto: null, aberta: null, pendente: false, engolirAte: 0, previa: null, timer: 0 };
  const conversa = (id) => estado.conversas?.find((c) => c.id === id);
  const naoLida = (c) => (ui.naoLida ? ui.naoLida(c) : !!c?.marcadaNaoLida);
  const noRadar = (id) => !!window.SintoniaTelas?.radar?.tem?.(id);
  const engolir = () => { G.engolirAte = Date.now() + 450; };
  const cedo = () => Date.now() < G.engolirAte;
  // Depois do toque longo, o dedo ainda está na tela: o clique que vem ao soltar não pode fechar a prévia
  // nem apertar um item do menu que ficou embaixo do dedo.
  document.addEventListener('pointerup', () => { if (G.soltarDepois) { G.soltarDepois = false; engolir(); } }, true);
  const largura = (item) => item.getBoundingClientRect().width || lista.clientWidth || 360;

  /** Gancho do app.html: com linha aberta ou arrastando, não redesenha agora (redesenha ao fechar). */
  function segurar() {
    if (G.arrasto || G.aberta) { G.pendente = true; return true; }
    return false;
  }
  function redesenharSePreciso() {
    if (G.arrasto || G.aberta || !G.pendente) return;
    G.pendente = false; ui.desenharLista?.();
  }

  // ------------------------------------------------------------ botões atrás da linha
  function botao(classe, svg, texto, acao, ponta) {
    return el('button', { type: 'button', class: `cg-acao ${classe}${ponta ? ' cg-ponta' : ''}`, 'data-acao': acao, html: svg }, el('span', { text: texto }));
  }
  function montarCamada(item, id) {
    const c = conversa(id);
    const lida = c && naoLida(c);
    const radar = noRadar(id);
    const esq = el('div', { class: 'cg-lado cg-esq' },
      botao('cg-lido', lida ? SVG.lida : SVG.naoLida, lida ? 'Lida' : 'Não lida', 'lida', true),
      botao('cg-radar', radar ? SVG.tirarRadar : SVG.radar, radar ? 'Tirar do radar' : 'Radar', 'radar'));
    const dir = el('div', { class: 'cg-lado cg-dir' },
      botao('cg-mais', SVG.mais, 'Mais', 'mais'),
      botao('cg-mover', SVG.mover, 'Mover', 'mover', true));
    const camada = el('div', { class: 'cg-camada', 'data-id': id }, esq, dir);
    camada.style.top = item.offsetTop + 'px';
    camada.style.height = item.offsetHeight + 'px';
    esq.style.width = '0px'; dir.style.width = '0px';
    lista.append(camada);
    camada.addEventListener('click', (e) => {
      const b = e.target.closest('.cg-acao'); if (!b) return;
      e.stopPropagation();
      const acao = b.dataset.acao;
      fechar();
      fazer(acao, id);
    });
    return camada;
  }
  function pintar(a, dx, solta) {
    const { item } = a;
    if (!a.camada) a.camada = montarCamada(item, a.id);
    const esq = a.camada.querySelector('.cg-esq'), dir = a.camada.querySelector('.cg-dir');
    for (const x of [item, esq, dir]) x.classList.toggle('cg-solta', !!solta);
    item.style.transform = dx ? `translateX(${dx}px)` : '';
    esq.style.width = Math.max(0, dx) + 'px';
    dir.style.width = Math.max(0, -dx) + 'px';
    const longo = Math.abs(dx) > largura(item) * LONGO;
    const lado = dx > 0 ? esq : dir;
    if (longo !== lado.classList.contains('cg-longo')) {
      lado.classList.toggle('cg-longo', longo);
      if (longo) try { navigator.vibrate?.(8); } catch {}
    }
    (dx > 0 ? dir : esq).classList.remove('cg-longo');
    a.dx = dx;
  }
  function abrirLinha(a, dx) {
    pintar(a, dx, true);
    a.item.classList.add('cg-aberta');
    G.aberta = { item: a.item, id: a.id, camada: a.camada, dx };
    a.camada.querySelector(dx > 0 ? '.cg-esq .cg-acao' : '.cg-dir .cg-acao')?.setAttribute('tabindex', '0');
  }
  /** Fecha a linha aberta (com animação) e, se a lista mudou enquanto estava aberta, redesenha. */
  function fechar(instantaneo) {
    const a = G.aberta || (G.arrasto?.camada ? G.arrasto : null);
    G.aberta = null;
    if (!a) { redesenharSePreciso(); return; }
    const { item, camada } = a;
    item.classList.remove('cg-aberta');
    const fim = () => {
      item.classList.remove('cg-solta', 'cg-movendo'); item.style.transform = '';
      camada?.remove();
      if (G.arrasto && G.arrasto.item === item) G.arrasto = null;
      redesenharSePreciso();
    };
    if (instantaneo || !camada) { fim(); return; }
    pintar({ item, id: a.id, camada, dx: a.dx }, 0, true);
    setTimeout(fim, 270);
  }

  // ------------------------------------------------------------ arrastar
  lista.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || estado.selecao) return;
    if (e.target.closest('.cg-camada')) return; // tocou num botão de ação: o clique cuida
    const item = e.target.closest('.item[data-id]');
    if (G.aberta && G.aberta.item !== item) { fechar(); engolir(); return; } // toque fora da linha aberta: só fecha
    if (!item || !lista.contains(item)) return;
    const id = item.dataset.id;
    const base = G.aberta && G.aberta.item === item ? G.aberta.dx : 0;
    G.arrasto = { item, id, x0: e.clientX, y0: e.clientY, base, dx: base, dir: null, pid: e.pointerId, camada: G.aberta?.camada || null, tipo: e.pointerType };
    clearTimeout(G.timer);
    if (!base) G.timer = setTimeout(() => {
      const a = G.arrasto;
      if (!a || a.dir || a.item !== item) return;
      G.arrasto = null; engolir(); G.soltarDepois = true;
      abrirPrevia(id, { item });
    }, SEGURAR_MS);
  });
  lista.addEventListener('pointermove', (e) => {
    const a = G.arrasto; if (!a || e.pointerId !== a.pid) return;
    const ddx = e.clientX - a.x0, ddy = e.clientY - a.y0;
    if (!a.dir) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      clearTimeout(G.timer);
      if (Math.abs(ddx) > Math.abs(ddy) * 1.15) {
        a.dir = 'h';
        a.item.classList.add('cg-movendo');
        try { a.item.setPointerCapture(e.pointerId); } catch {}
      } else {
        // rolagem vertical: o navegador rola; a linha aberta fecha
        G.arrasto = null;
        if (G.aberta) fechar(); else redesenharSePreciso();
        return;
      }
    }
    e.preventDefault();
    const w = largura(a.item);
    let dx = a.base + ddx;
    if (Math.abs(dx) > w * 0.92) dx = Math.sign(dx) * (w * 0.92 + (Math.abs(dx) - w * 0.92) * 0.25);
    pintar(a, dx, false);
  });
  function soltar(e, cancelou) {
    const a = G.arrasto; if (!a || (e && e.pointerId !== a.pid)) return;
    clearTimeout(G.timer);
    G.arrasto = null;
    if (a.dir !== 'h') {
      if (a.base) { fechar(); engolir(); } // tocou na própria linha aberta: fecha
      redesenharSePreciso();
      return;
    }
    engolir();
    a.item.classList.remove('cg-movendo');
    const w = largura(a.item); const dx = a.dx || 0;
    if (!cancelou && Math.abs(dx) > w * LONGO) {
      // arrastou até o fim: faz a ação da ponta
      G.aberta = { item: a.item, id: a.id, camada: a.camada, dx };
      fechar();
      fazer(dx > 0 ? 'lida' : 'mover', a.id);
      return;
    }
    if (!cancelou && dx > BT * 0.7 && (dx > a.base || a.base <= 0)) abrirLinha(a, ABERTO);
    else if (!cancelou && dx < -BT * 0.7 && (dx < a.base || a.base >= 0)) abrirLinha(a, -ABERTO);
    else if (!cancelou && a.base && Math.sign(dx) === Math.sign(a.base) && Math.abs(dx) > BT * 0.7) abrirLinha(a, Math.sign(dx) * ABERTO);
    else { G.aberta = { item: a.item, id: a.id, camada: a.camada, dx }; fechar(); }
  }
  lista.addEventListener('pointerup', (e) => soltar(e, false));
  lista.addEventListener('pointercancel', (e) => soltar(e, true));
  // O clique que vem depois de arrastar (ou de fechar a linha) não abre a conversa.
  lista.addEventListener('click', (e) => {
    if (e.target.closest('.cg-camada')) return;
    if (cedo()) { e.stopPropagation(); e.preventDefault(); return; }
    if (G.aberta) { e.stopPropagation(); e.preventDefault(); fechar(); }
  }, true);
  // Botão direito (computador) ou toque longo do Android: a prévia.
  lista.addEventListener('contextmenu', (e) => {
    const item = e.target.closest('.item[data-id]');
    if (!item || estado.selecao) return;
    e.preventDefault();
    clearTimeout(G.timer); G.arrasto = null;
    if (G.previa) return;
    if (G.aberta) fechar(true);
    const ponto = e.button === 2 || e.pointerType === 'mouse' || (e.clientX && matchMedia('(pointer: fine)').matches) ? { x: e.clientX, y: e.clientY } : null;
    abrirPrevia(item.dataset.id, { item, ponto });
  });
  // Rolar a lista (ou qualquer coisa fora dela) fecha a linha aberta.
  document.addEventListener('scroll', (e) => {
    if (G.aberta && !(e.target instanceof Element && e.target.closest?.('.cg-fundo'))) fechar();
  }, true);
  document.addEventListener('pointerdown', (e) => { if (G.aberta && !lista.contains(e.target)) fechar(); }, true);
  addEventListener('resize', () => { if (G.aberta) fechar(true); });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (G.previa) { e.preventDefault(); fecharPrevia(); } else if (G.aberta) fechar();
  });

  // ------------------------------------------------------------ ações
  async function fazer(acao, id) {
    const c = conversa(id);
    if (!c) { toast('Essa conversa não está mais na lista.'); return; }
    if (acao === 'lida') return alternarLida(c);
    if (acao === 'radar') return radar(c);
    if (acao === 'mais') return abrirMais(c);
    if (acao === 'mover') return abrirMover(c);
    if (acao === 'atribuir') return abrirAtribuir(c);
    if (acao === 'tarefa') return window.SintoniaTelas?.rotina?.novaTarefa?.({ conversaId: c.id });
    if (acao === 'finalizar') return window.SintoniaTelas?.nps?.finalizarNaConversa?.(c.id, ui);
    if (acao === 'abrir') return ui.abrir(c.id);
    if (acao === 'ficha') return abrirEDepois(c.id, () => ui.abrirFicha?.());
    if (acao === 'ia') return abrirEDepois(c.id, () => window.SintoniaConversa?.abrirMenuIa?.());
    if (acao === 'agendar') return ui.agendar?.(c.id);
  }
  async function alternarLida(c) {
    const ficaLida = naoLida(c);
    try {
      await post(ficaLida ? '/api/conversas/lidas' : '/api/conversas/nao-lidas', { ids: [c.id] });
      if (ficaLida) { c.marcadaNaoLida = false; c.lidaAte = new Date().toISOString(); }
      else { c.marcadaNaoLida = true; c.lidaAte = null; }
      G.pendente = true; redesenharSePreciso();
      toast(ficaLida ? 'Marcada como lida.' : 'Marcada como não lida.');
      ui.atualizar?.();
    } catch (x) { toast(x.message || 'Não deu agora.'); }
  }
  async function radar(c) {
    const R = window.SintoniaTelas?.radar;
    if (!R) { toast('O radar não está disponível.'); return; }
    if (!R.tem(c.id)) { R.abrirForm(c.id); return; }
    try {
      await api(`/api/radar/conversa/${c.id}`, { method: 'DELETE' });
      await R.carregar();
      toast('Saiu do radar.');
    } catch (x) { toast(x.message || 'Não deu agora.'); }
  }
  /** Abre a conversa e, quando ela carregar, faz `fn` (ficha, folha de atendimento). */
  function abrirEDepois(id, fn) {
    ui.abrir(id);
    const t0 = Date.now();
    const ver = () => { if (estado.detalhe?.conversa?.id === id) fn(); else if (Date.now() - t0 < 4000) setTimeout(ver, 80); };
    setTimeout(ver, 60);
  }

  // ------------------------------------------------------------ folhas (de baixo)
  function folha(titulo, sub) {
    document.getElementById('cg-folha')?.remove();
    const d = el('dialog', { class: 'folha cg-folha', id: 'cg-folha', 'aria-label': titulo });
    const corpo = el('div', {});
    d.append(
      el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: titulo }), el('button', { type: 'button', class: 'icone fechar-folha', 'aria-label': 'Fechar', html: SVG.fechar, onclick: () => d.close() })),
      sub ? el('p', { class: 'cg-sub', text: sub }) : null, corpo);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => setTimeout(() => d.remove(), 300));
    document.body.append(d);
    d.showModal();
    return { d, corpo };
  }
  const opcao = (svg, titulo, sub, onclick, extra) => el('button', { type: 'button', html: svg, onclick, ...(extra || {}) }, el('span', {}, el('b', { text: titulo }), sub ? el('small', { text: sub }) : null));

  /** A lista de ações de uma conversa (usada no menu da prévia e na folha "Mais"). */
  function acoesDa(c) {
    const T = window.SintoniaTelas || {};
    const lida = naoLida(c);
    return [
      { acao: 'lida', svg: lida ? SVG.lida : SVG.naoLida, texto: lida ? 'Marcar como lida' : 'Marcar como não lida' },
      T.radar && { acao: 'radar', svg: noRadar(c.id) ? SVG.tirarRadar : SVG.radar, texto: noRadar(c.id) ? 'Tirar do radar' : 'Colocar no radar' },
      { acao: 'mover', svg: SVG.mover, texto: 'Mover de etapa' },
      { acao: 'atribuir', svg: SVG.atribuir, texto: 'Atribuir a alguém' },
      T.rotina?.novaTarefa && { acao: 'tarefa', svg: SVG.tarefa, texto: 'Criar tarefa' },
      T.nps?.finalizarNaConversa && { acao: 'finalizar', svg: SVG.finalizar, texto: 'Finalizar atendimento' },
      { acao: 'abrir', svg: SVG.abrir, texto: 'Abrir conversa', forte: true },
    ].filter(Boolean);
  }

  function abrirMais(c) {
    const { d, corpo } = folha(ui.nomeDe(c), 'Opções da conversa');
    const ir = (acao) => () => { d.close(); fazer(acao, c.id); };
    const T = window.SintoniaTelas || {};
    corpo.append(el('div', { class: 'folha-lista' },
      opcao(SVG.abrir, 'Abrir conversa', null, ir('abrir')),
      opcao(SVG.ficha, 'Ficha da cliente', 'Dados, CRM, tags e observações', ir('ficha')),
      window.SintoniaConversa?.abrirMenuIa ? opcao(SVG.ia, 'Atendimento e IA', 'Quem atende, IA e ajuda para escrever', ir('ia')) : null,
      opcao(SVG.atribuir, 'Atribuir a alguém', c.responsavelNome ? `Hoje: ${c.responsavelNome}` : 'Passar para outra pessoa da equipe', ir('atribuir')),
      T.rotina?.novaTarefa ? opcao(SVG.tarefa, 'Criar tarefa', 'Lembrete com prazo ligado a esta conversa', ir('tarefa')) : null,
      ui.agendar ? opcao(SVG.agendar, 'Agendar', 'Marcar um horário para a cliente', ir('agendar')) : null,
      T.nps?.finalizarNaConversa ? opcao(SVG.finalizar, 'Finalizar atendimento', 'Registra o motivo e manda a pesquisa', ir('finalizar')) : null));
  }

  async function abrirMover(c) {
    const { d, corpo } = folha('Mover de etapa', ui.nomeDe(c));
    corpo.append(el('div', { class: 'cg-carregando', text: 'Carregando o funil…' }));
    let funis, daConversa;
    try { [funis, daConversa] = await Promise.all([api('/api/funis'), api(`/api/conversas/${c.id}/funis`)]); }
    catch (x) { corpo.replaceChildren(el('div', { class: 'cg-carregando', text: x.message || 'Não deu para abrir o funil.' })); return; }
    funis = (funis || []).filter((f) => f.etapas?.length);
    if (!funis.length) { corpo.replaceChildren(el('div', { class: 'cg-carregando', text: 'Nenhum funil com etapas ainda. Crie em CRM.' })); return; }
    const atualDe = (fid) => daConversa.find((x) => x.funilId === fid)?.etapa?.id || null;
    // Começa no funil em que a cliente está (o mais recente); se não estiver em nenhum, no primeiro.
    const onde = daConversa.filter((x) => x.etapa).sort((a, b) => new Date(b.desde || 0) - new Date(a.desde || 0))[0];
    let fid = (onde && funis.some((f) => f.id === onde.funilId) ? onde.funilId : funis[0].id);
    const pilulas = el('div', { class: 'cg-funis', role: 'tablist', 'aria-label': 'Funil' });
    const etapas = el('div', { class: 'folha-lista', role: 'list' });
    const desenhar = () => {
      pilulas.replaceChildren(...funis.map((f) => el('button', { type: 'button', role: 'tab', 'aria-pressed': String(f.id === fid), 'aria-selected': String(f.id === fid), text: f.nome, onclick: () => { fid = f.id; desenhar(); } })));
      pilulas.hidden = funis.length < 2;
      const f = funis.find((x) => x.id === fid); const atual = atualDe(fid);
      etapas.replaceChildren(...f.etapas.map((e) => {
        const cor = el('i', { class: 'cg-etapa-cor' }); cor.style.setProperty('--cor', e.cor || '#8a97a6');
        const b = el('button', { type: 'button', 'aria-pressed': String(e.id === atual), 'data-etapa': e.id }, cor, el('span', {}, el('b', { text: e.nome }), e.id === atual ? el('small', { text: 'Etapa atual' }) : null));
        if (e.id === atual) b.append(el('i', { class: 'cg-marca', html: SVG.ok }));
        b.onclick = async () => {
          if (e.id === atual) { d.close(); return; }
          b.setAttribute('aria-busy', 'true');
          try {
            const r = await post(`/api/conversas/${c.id}/funis/${f.id}`, { etapaId: e.id });
            if (r?.funis) daConversa = r.funis;
            if (r?.etapa !== undefined) c.etapa = r.etapa;
            d.close();
            toast(`${ui.nomeDe(c)} foi para “${e.nome}” ✓`);
            ui.atualizar?.();
          } catch (x) { b.removeAttribute('aria-busy'); toast(x.message || 'Não deu para mover.'); }
        };
        return b;
      }));
    };
    desenhar();
    corpo.replaceChildren(pilulas, etapas);
  }

  async function abrirAtribuir(c) {
    let pessoas;
    try { pessoas = await api(`/api/conversas/${c.id}/transferir`); } catch (x) { toast(x.message || 'Você não pode atribuir esta conversa.'); return; }
    const { d, corpo } = folha('Atribuir a alguém', ui.nomeDe(c));
    const passar = async (usuarioId) => {
      try {
        const r = await post(`/api/conversas/${c.id}/transferir`, { usuarioId });
        d.close();
        toast(r.responsavelNome ? `Conversa passada para ${r.responsavelNome}.` : 'A conversa ficou sem dona.');
        ui.atualizar?.();
      } catch (x) { toast(x.message || 'Não deu agora.'); }
    };
    const linhas = pessoas.filter((p) => !p.dona).map((p) => opcao(SVG.atribuir, p.eu ? `${p.nome} (você)` : p.nome, null, () => passar(p.id)));
    if (c.responsavelId) linhas.push(opcao(SVG.fechar, 'Sem dona', 'Volta para todas da unidade', () => passar(null)));
    corpo.append(linhas.length ? el('div', { class: 'folha-lista' }, ...linhas) : el('div', { class: 'cg-carregando', text: 'Ninguém mais atende esta unidade.' }));
  }

  // ------------------------------------------------------------ prévia (segurar o dedo / botão direito)
  const hm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diaTxt = (d) => { const x = new Date(d), h = new Date(); const ontem = new Date(h); ontem.setDate(h.getDate() - 1);
    if (x.toDateString() === h.toDateString()) return 'Hoje'; if (x.toDateString() === ontem.toDateString()) return 'Ontem';
    return x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
  const textoDe = (m) => (ui.textoPrevia ? ui.textoPrevia(m) : m.texto) || '';

  function fecharPrevia() {
    const p = G.previa; if (!p) return;
    G.previa = null;
    p.fundo.remove();
    try { p.voltarFoco?.focus?.({ preventScroll: true }); } catch {}
  }
  async function abrirPrevia(id, { item, ponto } = {}) {
    const c = conversa(id); if (!c) return;
    fecharPrevia();
    try { navigator.vibrate?.(12); } catch {}
    const msgs = el('div', { class: 'cg-msgs', role: 'log', 'aria-label': 'Últimas mensagens' }, el('div', { class: 'cg-vazio', text: 'Carregando…' }));
    const cab = el('div', { class: 'cg-cab' }, ui.avatar(c), el('b', { text: ui.nomeDe(c) }));
    const cartao = el('div', { class: 'cg-cartao' }, cab, msgs);
    const menu = el('div', { class: 'cg-menu', role: 'menu', 'aria-label': 'Ações da conversa' },
      ...acoesDa(c).map((o) => el('button', { type: 'button', role: 'menuitem', class: o.forte ? 'cg-forte' : '', 'data-acao': o.acao, onclick: () => { if (cedo()) return; fecharPrevia(); fazer(o.acao, c.id); } }, el('span', { text: o.texto }), el('i', { html: o.svg, style: 'display:contents' }))));
    const caixa = el('div', { class: 'cg-previa', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Prévia da conversa com ${ui.nomeDe(c)}` }, cartao, menu);
    const fundo = el('div', { class: 'cg-fundo' }, caixa);
    fundo.addEventListener('click', (e) => { if (e.target === fundo && !cedo()) fecharPrevia(); });
    fundo.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target === fundo) fecharPrevia(); });
    // Tocar fora fecha; o toque que fecha não "atravessa" para a lista.
    fundo.addEventListener('pointerdown', (e) => { if (e.target === fundo) { e.preventDefault(); } });
    G.previa = { fundo, id, voltarFoco: item || document.activeElement };
    document.body.append(fundo);
    // No computador, perto do ponteiro; no celular, no meio da tela.
    const posicionar = () => {
      if (!ponto || innerWidth <= 760) return;
      caixa.classList.add('cg-no-ponto');
      const r = { width: caixa.offsetWidth, height: caixa.offsetHeight };
      const x = Math.min(Math.max(12, ponto.x), innerWidth - r.width - 12);
      const y = Math.min(Math.max(12, ponto.y - 40), innerHeight - r.height - 12);
      caixa.style.left = x + 'px'; caixa.style.top = Math.max(12, y) + 'px';
    };
    posicionar();
    menu.querySelector('button')?.focus({ preventScroll: true });
    let d;
    try { d = await api(`/api/conversas/${id}/previa?limite=30`); } catch (x) { if (G.previa?.fundo === fundo) msgs.replaceChildren(el('div', { class: 'cg-vazio', text: x.message || 'Não deu para carregar.' })); return; }
    if (G.previa?.fundo !== fundo) return;
    const lista = d.mensagens || [];
    if (!lista.length) { msgs.replaceChildren(el('div', { class: 'cg-vazio', text: 'Nenhuma mensagem ainda.' })); return; }
    const nos = []; let dia = '';
    for (const m of lista) {
      const dt = diaTxt(m.em); if (dt !== dia) { dia = dt; nos.push(el('div', { class: 'cg-dia', text: dt })); }
      const classe = m.autor === 'cliente' ? '' : m.autor === 'ia' ? 'ia' : m.autor === 'sistema' ? 'sis' : 'eu';
      const bal = el('div', { class: 'cg-bal ' + classe });
      if (m.autor === 'equipe' && m.autorNome) bal.append(el('span', { class: 'cg-autor', text: m.autorNome }));
      if (m.autor === 'ia') bal.append(el('span', { class: 'cg-autor', text: 'IA' }));
      bal.append(document.createTextNode(textoDe(m)));
      if (m.autor !== 'sistema') bal.append(el('small', { text: hm(m.em) }));
      nos.push(bal);
    }
    msgs.replaceChildren(...nos);
    posicionar();
    msgs.scrollTop = msgs.scrollHeight;
  }

  window.SintoniaTelas.conversasGestos = { segurar, fechar: () => fechar(), abrirPrevia, fecharPrevia, acoesDa, fazer };
})();
