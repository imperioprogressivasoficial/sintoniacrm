/*
 * Bolinha de acesso rápido da Sintonia (como o AssistiveTouch do iPhone).
 * Fica na borda da tela, dá para arrastar para onde quiser e, ao tocar, abre um painel de vidro
 * com os atalhos em grade (3 colunas). Fora de uso, fica meio apagada.
 *
 *   AcessoRapido.criar({ itens: [{ rotulo, icone: '<svg…>', acao, ativo?: () => bool, visivel?: () => bool }] })
 */
(() => {
  const TAM = 56;
  const MARGEM = 10;
  const CHAVE = 'sintonia.acessoRapido.posicao';
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { return null; } };
  const guardar = (p) => { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { /* sem armazenamento: só não lembra */ } };

  function criar({ itens = [], rotulo = 'Acesso rápido' } = {}) {
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

    function desenharPainel() {
      painel.replaceChildren();
      for (const it of itens) {
        if (it.visivel && !it.visivel()) continue;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ar-item' + (it.ativo?.() ? ' ativo' : '');
        b.innerHTML = `<span class="ar-ic">${it.icone || ''}</span>`;
        const s = document.createElement('span'); s.className = 'ar-rot'; s.textContent = typeof it.rotulo === 'function' ? it.rotulo() : it.rotulo; b.append(s);
        b.addEventListener('click', (e) => { e.stopPropagation(); fechar(); setTimeout(() => it.acao?.(), 60); });
        painel.append(b);
      }
    }

    let pos = ler() || { lado: 'dir', y: 0.62 };
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
      painel.querySelector('button')?.focus({ preventScroll: true });
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
        guardar(pos); aplicar(true);
      }
    };
    botao.addEventListener('pointerup', soltar);
    botao.addEventListener('pointercancel', soltar);
    botao.addEventListener('click', () => { if (Date.now() - soltouArrastando < 350) return; aberta ? fechar() : abrir(); });

    addEventListener('resize', () => { fechar(); aplicar(false); });
    aplicar(false); acordar();
    return { abrir, fechar, mostrar(sim) { raiz.hidden = !sim; if (!sim) fechar(); }, elemento: raiz };
  }

  window.AcessoRapido = { criar };
})();
