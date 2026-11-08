/*
 * Bolinha de acesso rápido da Sintonia (como o AssistiveTouch do iPhone).
 * Fica na borda da tela, dá para arrastar para onde quiser e, ao tocar, abre um painel de vidro
 * com os atalhos em grade (3 colunas). Fora de uso, fica meio apagada.
 * A canetinha no canto do painel abre, no painel lateral, o editor: cada pessoa escolhe e ordena os atalhos (1 a 9),
 * guardados neste aparelho.
 *
 *   AcessoRapido.criar({
 *     catalogo: [{ id, rotulo, icone: '<svg…>', acao, ativo?: () => bool, disponivel?: () => bool }],
 *     padrao: ['id', …],            // atalhos de fábrica, em ordem
 *     chaveItens: () => 'chave',    // onde guardar a escolha (por pessoa)
 *   })
 */
(() => {
  const TAM = 56;
  const MARGEM = 10;
  const MAX = 9;
  const CHAVE = 'sintonia.acessoRapido.posicao';
  const lerJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  const gravarJson = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento: só não lembra */ } };
  const SVG = {
    lapis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/><path d="M13.5 7.5l3 3"/></svg>',
    cima: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    baixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7"/></svg>',
  };
  const el = (tag, attrs = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    e.append(...filhos.filter(Boolean));
    return e;
  };

  function criar({ catalogo = [], padrao = [], chaveItens = () => 'sintonia.acessoRapido.itens', rotulo = 'Acesso rápido' } = {}) {
    const porId = new Map(catalogo.map((c) => [c.id, c]));
    const disponivel = (c) => Boolean(c) && (!c.disponivel || c.disponivel());
    /** Ids escolhidos (na ordem), só os que existem e que a pessoa pode usar. */
    function escolhidos() {
      const salvo = lerJson(chaveItens());
      const base = Array.isArray(salvo) && salvo.length ? salvo : padrao;
      const ids = base.filter((id, i) => base.indexOf(id) === i && disponivel(porId.get(id))).slice(0, MAX);
      return ids.length ? ids : padrao.filter((id) => disponivel(porId.get(id))).slice(0, MAX);
    }

    const raiz = document.createElement('div');
    raiz.className = 'ar ociosa';
    const botao = document.createElement('button');
    botao.className = 'ar-botao'; botao.type = 'button';
    botao.setAttribute('aria-label', rotulo); botao.setAttribute('aria-expanded', 'false'); botao.setAttribute('aria-haspopup', 'dialog');
    botao.innerHTML = '<i class="ar-anel ar-a1"></i><i class="ar-anel ar-a2"></i><i class="ar-anel ar-a3"></i>';
    raiz.append(botao);

    const fundo = document.createElement('div'); fundo.className = 'ar-fundo';
    const painel = document.createElement('div');
    painel.className = 'ar-painel'; painel.setAttribute('role', 'dialog'); painel.setAttribute('aria-label', rotulo); painel.hidden = true;
    document.body.append(fundo, painel, raiz);

    let editando = null; // lista de ids durante a edição
    let aviso = '';

    function desenharPainel() {
      painel.replaceChildren();
      painel.append(el('div', { class: 'ar-cab' },
        el('span', { class: 'ar-tit', text: rotulo }),
        el('button', { type: 'button', class: 'ar-editar', 'aria-label': 'Editar atalhos', title: 'Editar atalhos', html: SVG.lapis, onclick: (e) => { e.stopPropagation(); fechar(); abrirEditor(); } })));
      for (const id of escolhidos()) {
        const it = porId.get(id);
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ar-item' + (it.ativo?.() ? ' ativo' : ''); b.dataset.id = id;
        b.innerHTML = `<span class="ar-ic">${it.icone || ''}</span>`;
        const s = document.createElement('span'); s.className = 'ar-rot'; s.textContent = it.rotulo; b.append(s);
        b.addEventListener('click', (e) => { e.stopPropagation(); fechar(); setTimeout(() => it.acao?.(), 60); });
        painel.append(b);
      }
    }

    /** Editor dos atalhos: uma página do painel lateral (window.SintoniaPainel). */
    let corpoEditor = null;
    function abrirEditor() {
      editando = escolhidos(); aviso = '';
      const P = window.SintoniaPainel;
      if (!P) return;
      P.abrir({ id: 'atalhos', titulo: 'Atalhos da bolinha', montar: (corpo) => { corpoEditor = corpo; corpo.classList.add('are'); desenharEditor(); },
        aoFechar: () => { editando = null; corpoEditor = null; } });
    }
    function desenharEditor() {
      const corpo = corpoEditor; if (!corpo) return;
      const todos = catalogo.filter(disponivel);
      const ligados = editando.filter((id) => porId.has(id));
      const desligados = todos.map((c) => c.id).filter((id) => !ligados.includes(id));
      const salvar = () => gravarJson(chaveItens(), editando);
      const mudar = (fn) => { fn(); aviso = ''; salvar(); desenharEditor(); };
      const linha = (id, ligado, pos) => {
        const it = porId.get(id);
        const marcar = el('button', { type: 'button', class: 'are-marca' + (ligado ? ' sim' : ''), role: 'switch', 'aria-checked': String(ligado), 'aria-label': `${ligado ? 'Tirar' : 'Mostrar'} ${it.rotulo}`, html: ligado ? SVG.ok : '',
          onclick: () => {
            if (ligado) {
              if (editando.length <= 1) { aviso = 'Deixe pelo menos 1 atalho.'; desenharEditor(); return; }
              mudar(() => { editando = editando.filter((x) => x !== id); });
            } else {
              if (editando.length >= MAX) { aviso = `Cabem até ${MAX} atalhos. Tire um para pôr este.`; desenharEditor(); return; }
              mudar(() => { editando = [...editando, id]; });
            }
          } });
        const mover = (d) => mudar(() => { const i = editando.indexOf(id); const j = i + d; [editando[i], editando[j]] = [editando[j], editando[i]]; });
        return el('div', { class: 'are-linha' + (ligado ? '' : ' fora') },
          el('span', { class: 'are-ic', html: it.icone || '' }),
          el('span', { class: 'are-nome', text: it.rotulo }),
          ligado ? el('span', { class: 'are-ordem' },
            el('button', { type: 'button', 'aria-label': `Subir ${it.rotulo}`, html: SVG.cima, disabled: pos === 0 ? '' : null, onclick: () => mover(-1) }),
            el('button', { type: 'button', 'aria-label': `Descer ${it.rotulo}`, html: SVG.baixo, disabled: pos === ligados.length - 1 ? '' : null, onclick: () => mover(1) })) : null,
          marcar);
      };
      corpo.replaceChildren(
        el('p', { class: 'are-dica', text: `Escolha de 1 a ${MAX} atalhos e a ordem em que aparecem. ${ligados.length} de ${MAX} na bolinha.` }),
        el('div', { class: 'are-sub', text: 'Na bolinha' }),
        el('div', { class: 'are-lista', role: 'group', 'aria-label': 'Na bolinha' }, ...ligados.map((id, i) => linha(id, true, i))),
        desligados.length ? el('div', { class: 'are-sub', text: 'Mais atalhos' }) : null,
        desligados.length ? el('div', { class: 'are-lista', role: 'group', 'aria-label': 'Mais atalhos' }, ...desligados.map((id) => linha(id, false))) : null,
        aviso ? el('p', { class: 'are-aviso', role: 'alert', text: aviso }) : null,
        el('div', { class: 'are-rodape' },
          el('button', { type: 'button', class: 'are-restaurar', text: 'Restaurar padrão', onclick: () => { gravarJson(chaveItens(), null); editando = escolhidos(); aviso = ''; desenharEditor(); } }),
          el('button', { type: 'button', class: 'are-pronto', text: 'Pronto', onclick: () => window.SintoniaPainel.fechar() })));
    }

    let pos = lerJson(CHAVE) || { lado: 'dir', y: 0.62 };
    let aberta = false;
    let ocioso;
    function aplicar(animar) {
      const w = innerWidth, h = innerHeight;
      const y = Math.min(Math.max(pos.y * h, 90), h - 130);
      raiz.style.transition = animar ? 'left .22s ease, top .22s ease' : 'none';
      raiz.style.left = (pos.lado === 'dir' ? w - TAM - MARGEM : MARGEM) + 'px';
      raiz.style.top = y - TAM / 2 + 'px';
    }
    function acordar() {
      raiz.classList.remove('ociosa'); clearTimeout(ocioso);
      ocioso = setTimeout(() => !aberta && raiz.classList.add('ociosa'), 3000);
    }
    function abrir() {
      aberta = true; acordar(); desenharPainel();
      painel.hidden = false; fundo.classList.add('ver'); raiz.classList.add('aberta');
      requestAnimationFrame(() => painel.classList.add('ver'));
      botao.setAttribute('aria-expanded', 'true');
      painel.querySelector('.ar-item')?.focus({ preventScroll: true });
    }
    function fechar() {
      if (!aberta) return;
      aberta = false; painel.classList.remove('ver'); fundo.classList.remove('ver'); raiz.classList.remove('aberta');
      botao.setAttribute('aria-expanded', 'false');
      setTimeout(() => { if (!aberta) painel.hidden = true; }, 200);
      acordar();
    }
    fundo.addEventListener('click', fechar);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && aberta) { fechar(); botao.focus(); } });

    // arrastar (dedo ou mouse); toque curto abre/fecha
    let arrasto = null; let soltouArrastando = 0;
    botao.addEventListener('pointerdown', (e) => {
      if (aberta) return;
      arrasto = { id: e.pointerId, x0: e.clientX, y0: e.clientY, l0: raiz.offsetLeft, t0: raiz.offsetTop, moveu: false };
      botao.setPointerCapture(e.pointerId); acordar();
    });
    botao.addEventListener('pointermove', (e) => {
      if (!arrasto || e.pointerId !== arrasto.id) return;
      const dx = e.clientX - arrasto.x0, dy = e.clientY - arrasto.y0;
      if (!arrasto.moveu && Math.hypot(dx, dy) < 6) return;
      arrasto.moveu = true; raiz.style.transition = 'none';
      raiz.style.left = arrasto.l0 + dx + 'px'; raiz.style.top = arrasto.t0 + dy + 'px';
    });
    const soltar = (e) => {
      if (!arrasto || e.pointerId !== arrasto.id) return;
      const moveu = arrasto.moveu; arrasto = null;
      if (moveu) {
        soltouArrastando = Date.now();
        const cx = raiz.offsetLeft + TAM / 2;
        pos = { lado: cx > innerWidth / 2 ? 'dir' : 'esq', y: (raiz.offsetTop + TAM / 2) / innerHeight };
        gravarJson(CHAVE, pos); aplicar(true);
      }
    };
    botao.addEventListener('pointerup', soltar);
    botao.addEventListener('pointercancel', soltar);
    botao.addEventListener('click', () => { if (Date.now() - soltouArrastando < 350) return; aberta ? fechar() : abrir(); });

    addEventListener('resize', () => { fechar(); aplicar(false); });
    aplicar(false); acordar();
    return { abrir, fechar, editar: abrirEditor, escolhidos, mostrar(sim) { raiz.hidden = !sim; if (!sim) fechar(); }, elemento: raiz, painel };
  }

  window.AcessoRapido = { criar, MAX };
})();
