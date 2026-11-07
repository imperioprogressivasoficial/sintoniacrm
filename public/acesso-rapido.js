/*
 * Bolinha de acesso rápido da Sintonia (estilo AssistiveTouch do iPhone).
 * Fica na borda da tela; arrasta para onde quiser; ao tocar, abre as opções em leque.
 *
 *   AcessoRapido.criar({ marca: '/marca.svg', itens: [{ rotulo, icone: '<svg…>', cor, acao }] })
 */
(() => {
  const TAM = 58;
  const MARGEM = 10;
  const RAIO = 96;
  const CHAVE = 'sintonia.acessoRapido.posicao';

  function ler() {
    try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; }
  }
  function guardar(p) {
    try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { /* navegador sem armazenamento: só não lembra */ }
  }

  function criar({ marca = '/marca.svg', itens = [], rotulo = 'Acesso rápido' } = {}) {
    const raiz = document.createElement('div');
    raiz.className = 'ar ociosa';
    const fundo = document.createElement('div');
    fundo.className = 'ar-fundo';
    const botao = document.createElement('button');
    botao.className = 'ar-botao';
    botao.type = 'button';
    botao.setAttribute('aria-label', rotulo);
    botao.setAttribute('aria-expanded', 'false');
    const img = document.createElement('img');
    img.src = marca; img.alt = ''; img.draggable = false;
    botao.append(img);
    raiz.append(botao);

    const elementos = itens.map((it) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ar-item';
      b.style.background = it.cor || 'var(--marca-gradiente)';
      b.innerHTML = it.icone || '';
      const s = document.createElement('span'); s.textContent = it.rotulo; b.append(s);
      b.setAttribute('aria-label', it.rotulo);
      b.addEventListener('click', (e) => { e.stopPropagation(); fechar(); it.acao?.(); });
      raiz.append(b);
      return { b, it };
    });
    document.body.append(fundo, raiz);

    // posição: lado (esq/dir) + altura relativa, para sobreviver a girar a tela
    let pos = ler() || { lado: 'dir', y: 0.62 };
    let aberta = false;
    let ocioso;

    const limites = () => ({ w: innerWidth, h: innerHeight });
    function aplicar(animar) {
      const { w, h } = limites();
      const y = Math.min(Math.max(pos.y * h, 90), h - 110);
      const x = pos.lado === 'dir' ? w - TAM - MARGEM : MARGEM;
      raiz.style.transition = animar ? 'left .22s ease, top .22s ease' : 'none';
      raiz.style.left = x + 'px';
      raiz.style.top = y - TAM / 2 + 'px';
    }
    function acordar() {
      raiz.classList.remove('ociosa');
      clearTimeout(ocioso);
      ocioso = setTimeout(() => !aberta && raiz.classList.add('ociosa'), 3500);
    }

    function abrir() {
      aberta = true; acordar();
      raiz.classList.add('aberta'); fundo.classList.add('ver');
      botao.setAttribute('aria-expanded', 'true');
      // leque virado para dentro da tela; se estiver muito em cima ou embaixo, inclina
      const centro = pos.lado === 'dir' ? 180 : 0;
      const inclina = pos.y < 0.3 ? (pos.lado === 'dir' ? -35 : 35) : pos.y > 0.7 ? (pos.lado === 'dir' ? 35 : -35) : 0;
      const n = elementos.length;
      const abertura = Math.min(150, 40 * (n - 1));
      elementos.forEach(({ b }, i) => {
        const ang = ((centro + inclina - abertura / 2 + (n > 1 ? (abertura * i) / (n - 1) : abertura / 2)) * Math.PI) / 180;
        const dx = Math.cos(ang) * RAIO;
        const dy = Math.sin(ang) * RAIO;
        b.style.transitionDelay = i * 25 + 'ms';
        b.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
      });
    }
    function fechar() {
      aberta = false;
      raiz.classList.remove('aberta'); fundo.classList.remove('ver');
      botao.setAttribute('aria-expanded', 'false');
      elementos.forEach(({ b }) => { b.style.transitionDelay = '0ms'; b.style.transform = 'translate(0,0) scale(.3)'; });
      acordar();
    }
    fundo.addEventListener('click', fechar);
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && aberta) fechar(); });

    // arrastar (dedo ou mouse); toque curto abre/fecha
    let arrasto = null;
    let soltouArrastando = 0;
    botao.addEventListener('pointerdown', (e) => {
      if (aberta) return;
      arrasto = { id: e.pointerId, x0: e.clientX, y0: e.clientY, l0: raiz.offsetLeft, t0: raiz.offsetTop, moveu: false };
      botao.setPointerCapture(e.pointerId);
      acordar();
    });
    botao.addEventListener('pointermove', (e) => {
      if (!arrasto || e.pointerId !== arrasto.id) return;
      const dx = e.clientX - arrasto.x0, dy = e.clientY - arrasto.y0;
      if (!arrasto.moveu && Math.hypot(dx, dy) < 6) return;
      arrasto.moveu = true;
      raiz.style.transition = 'none';
      raiz.style.left = arrasto.l0 + dx + 'px';
      raiz.style.top = arrasto.t0 + dy + 'px';
    });
    botao.addEventListener('pointerup', (e) => {
      if (!arrasto || e.pointerId !== arrasto.id) return;
      const moveu = arrasto.moveu;
      arrasto = null;
      if (moveu) {
        soltouArrastando = Date.now();
        const { w, h } = limites();
        const cx = raiz.offsetLeft + TAM / 2;
        pos = { lado: cx > w / 2 ? 'dir' : 'esq', y: (raiz.offsetTop + TAM / 2) / h };
        guardar(pos);
        aplicar(true);
      }
    });
    botao.addEventListener('click', () => {
      if (Date.now() - soltouArrastando < 350) return; // foi arrasto, não toque
      aberta ? fechar() : abrir();
    });

    addEventListener('resize', () => { if (aberta) fechar(); aplicar(false); });
    aplicar(false);
    acordar();

    return {
      abrir, fechar,
      mostrar(sim) { raiz.hidden = !sim; if (!sim) fechar(); },
      elemento: raiz,
    };
  }

  window.AcessoRapido = { criar };
})();
