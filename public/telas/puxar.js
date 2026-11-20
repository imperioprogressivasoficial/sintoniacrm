/* Puxar para atualizar (celular): círculo de vidro com o arco no azul-brilho (modelo 4 aprovado pelo dono).
 * Funciona nas listas das telas principais quando a pessoa está no topo da rolagem e arrasta para baixo.
 * Ao soltar depois do ponto, gira enquanto busca de novo e some quando termina. */
(() => {
  const LIMITE = 72; // px de puxão para valer
  const MAX = 110;
  const FORA = new Set(['serena', 'funil']); // telas com gesto próprio
  const reduzir = matchMedia('(prefers-reduced-motion: reduce)');

  const css = document.createElement('style');
  css.textContent = `
  .px-ind{position:fixed;z-index:60;left:50%;top:calc(env(safe-area-inset-top,0px) + 10px);width:40px;height:40px;margin-left:-20px;
    pointer-events:none;opacity:0;transform:translateY(-44px) scale(.6)}
  .px-ind svg{position:absolute;inset:4px;width:32px;height:32px}
  .px-ind circle{fill:none;stroke:url(#px-brilho);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:63;filter:drop-shadow(0 0 2px rgba(58,160,255,.45))}
  .px-ind.solto{transition:transform .35s cubic-bezier(.2,.8,.2,1),opacity .3s}
  .px-ind.px-girando svg{animation:px-gira .9s linear infinite}
  @keyframes px-gira{to{transform:rotate(360deg)}}
  .px-alvo{transition:none}
  .px-alvo.px-volta{transition:transform .35s cubic-bezier(.2,.8,.2,1)}
  @media (prefers-reduced-motion:reduce){.px-ind.px-girando svg{animation:none}}`;
  document.head.appendChild(css);

  const ind = document.createElement('div');
  ind.className = 'px-ind';
  ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = '<svg viewBox="0 0 26 26"><defs><linearGradient id="px-brilho" x1="0" x2="1"><stop offset="0" stop-color="#0ffcbe"/><stop offset="1" stop-color="#3aa0ff"/></linearGradient></defs><circle cx="13" cy="13" r="10" transform="rotate(-90 13 13)"/></svg>';
  const arco = ind.querySelector('circle');
  addEventListener('DOMContentLoaded', () => document.body.appendChild(ind));
  if (document.body) document.body.appendChild(ind);

  let y0 = null, x0 = 0, d = 0, alvo = null, ocupado = false, decidido = false;

  const ui = () => window.Sintonia?.ui;
  const celular = () => innerWidth <= 760;
  const rolavel = (n) => {
    for (let e = n; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) return e;
    }
    return document.scrollingElement;
  };
  const pode = (t) => {
    const u = ui();
    if (!u || !celular() || ocupado) return false;
    if (FORA.has(u.estado.vista)) return false;
    if (document.getElementById('casca')?.classList.contains('em-conversa')) return false;
    if (document.querySelector('dialog[open]')) return false;
    if (t.closest('input,textarea,select,[contenteditable],.msgs,dialog,.bar,.trilho,[data-sem-puxar]')) return false;
    return Boolean(t.closest('.vista'));
  };
  const desenhar = (p) => {
    const k = Math.min(1, p);
    ind.style.opacity = String(Math.min(1, p * 1.4));
    ind.style.transform = `translateY(${-44 + k * 52}px) rotate(${p * 270}deg) scale(${0.6 + k * 0.4})`;
    arco.style.strokeDashoffset = String(63 - k * 50);
    if (alvo) alvo.style.transform = `translateY(${Math.min(d, MAX) * 0.55}px)`;
  };
  const limpar = () => {
    ind.classList.add('solto');
    ind.classList.remove('px-girando');
    ind.style.opacity = '0';
    ind.style.transform = 'translateY(-44px) scale(.6)';
    if (alvo) { alvo.classList.add('px-volta'); alvo.style.transform = ''; const a = alvo; setTimeout(() => a.classList.remove('px-volta', 'px-alvo'), 380); }
    alvo = null;
  };

  addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !pode(e.target)) return;
    const r = rolavel(e.target);
    if (r && r.scrollTop > 0) return;
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; d = 0; decidido = false;
    alvo = e.target.closest('.vista');
  }, { passive: true });

  addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!decidido) {
      if (Math.abs(dx) > Math.abs(dy) || dy < 0) { y0 = null; alvo = null; return; } // gesto de lado ou para cima: não é nosso
      if (dy < 8) return;
      decidido = true; ind.classList.remove('solto'); alvo?.classList.add('px-alvo');
    }
    d = Math.max(0, dy - 8) * (1 - Math.min(0.5, dy / 900));
    if (e.cancelable) e.preventDefault();
    desenhar(d / LIMITE);
  }, { passive: false });

  addEventListener('touchend', async () => {
    if (y0 == null) return;
    y0 = null;
    if (!decidido) { alvo = null; return; }
    if (d < LIMITE) { limpar(); return; }
    ocupado = true;
    ind.classList.add('solto', 'px-girando');
    d = LIMITE; desenhar(1);
    navigator.vibrate?.(8);
    const inicio = Date.now();
    try {
      const u = ui();
      await u?.atualizar?.();
      const v = u?.estado?.vista;
      if (v && v !== 'conversas') { const t = window.SintoniaTelas?.[v]; if (t?.recarregar) await t.recarregar(); else u.mostrar(v); }
    } catch {}
    // tempo mínimo para o giro ser visto (sem parecer travado)
    const resta = (reduzir.matches ? 200 : 650) - (Date.now() - inicio);
    if (resta > 0) await new Promise((r) => setTimeout(r, resta));
    limpar();
    ocupado = false;
  });
  addEventListener('touchcancel', () => { if (y0 != null || decidido) { y0 = null; limpar(); } });
})();
