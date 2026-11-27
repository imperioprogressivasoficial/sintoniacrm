/* primeiro-acesso: foto de perfil logo ao entrar.
 * Quem ainda não tem foto vê "Coloque sua foto de perfil" assim que o app abre: tirar foto ou escolher da galeria,
 * ajustar no círculo (arrastar e aproximar) e salvar. Usa o mesmo envio da Conta › Perfil (PUT /api/equipe/:id/foto,
 * JPEG de 256 px). Atendente e recepcionista só usam o app depois de pôr a foto; a gestão (gerente, direção,
 * administração) pode deixar para depois (volta a pedir no próximo acesso).
 * O servidor diz quem precisa (GET /api/auth/eu → pedirFoto, podePularFoto). Estilos com prefixo .fp-.
 */
(() => {
  const CSS = `
  .fp-fundo { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
    background: radial-gradient(900px 640px at 0% 0%, rgba(26,139,224,.55), transparent 60%), radial-gradient(760px 560px at 100% 100%, rgba(15,252,190,.18), transparent 60%), rgba(4,23,43,.88);
    -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); font-family: var(--fonte, Poppins, system-ui, sans-serif); overflow-y: auto; }
  .fp-cartao { width: min(440px, 100%); box-sizing: border-box; border-radius: 28px; padding: 28px 24px 22px; display: grid; gap: 16px; justify-items: center; text-align: center;
    background: #f7fafd; color: #08243f; box-shadow: inset 0 1px 0 #fff, 0 30px 80px rgba(0,0,0,.45); position: relative; overflow: hidden; }
  .fp-cartao::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 1.5px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); }
  .fp-cartao h2 { margin: 0; font-family: var(--fonte-titulo, Sintony, Poppins, sans-serif); font-size: 24px; letter-spacing: -.02em; }
  .fp-cartao p { margin: 0; font-size: 14.5px; line-height: 1.5; color: #5a6b7d; max-width: 32ch; }
  .fp-roda { width: 200px; height: 200px; border-radius: 50%; position: relative; flex: none; background: linear-gradient(135deg, #106ebe, #3aa0ff); display: grid; place-items: center;
    color: #fff; font-size: 56px; font-weight: 700; box-shadow: 0 0 0 4px #f7fafd, 0 0 0 5.5px rgba(16,110,190,.35), 0 18px 40px rgba(16,110,190,.25); overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; }
  .fp-roda canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: grab; }
  .fp-roda canvas:active { cursor: grabbing; }
  .fp-zoom { width: min(260px, 100%); display: flex; align-items: center; gap: 10px; color: #5a6b7d; }
  .fp-zoom svg { width: 18px; height: 18px; flex: none; }
  .fp-zoom input { flex: 1; accent-color: #106ebe; min-height: 32px; }
  .fp-botoes { display: grid; gap: 10px; width: 100%; }
  .fp-bt { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 50px; padding: 0 18px; border-radius: 999px;
    font-weight: 700; font-size: 15.5px; background: linear-gradient(90deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 10px 26px rgba(16,110,190,.32); }
  .fp-bt.leve { background: rgba(16,110,190,.08); color: #08243f; box-shadow: inset 0 0 0 1px rgba(16,110,190,.25); }
  .fp-bt svg { width: 20px; height: 20px; flex: none; }
  .fp-bt:focus-visible, .fp-depois:focus-visible { outline: 2px solid #0ffcbe; outline-offset: 3px; }
  .fp-bt[disabled] { opacity: .6; cursor: default; }
  .fp-depois { all: unset; cursor: pointer; font-size: 13.5px; font-weight: 600; color: #5a6b7d; padding: 6px 10px; border-radius: 8px; }
  .fp-erro { color: #c43a3a; font-size: 13.5px; font-weight: 600; margin: 0; }
  .fp-erro:empty { display: none; }
  .fp-dica { font-size: 12.5px !important; }
  @media (max-width: 560px) {
    .fp-fundo { place-items: end stretch; padding: 0; }
    .fp-cartao { width: 100%; border-radius: 28px 28px 0 0; padding: 26px 20px max(22px, env(safe-area-inset-bottom)); }
  }
  html[data-tema="escuro"] .fp-cartao { background: #0c2340; color: #e6f0fa; box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 30px 80px rgba(0,0,0,.55); }
  html[data-tema="escuro"] .fp-cartao p, html[data-tema="escuro"] .fp-zoom, html[data-tema="escuro"] .fp-depois { color: #9fb3c8; }
  html[data-tema="escuro"] .fp-roda { box-shadow: 0 0 0 4px #0c2340, 0 0 0 5.5px rgba(15,252,190,.45), 0 18px 40px rgba(0,0,0,.4); }
  html[data-tema="escuro"] .fp-bt.leve { background: rgba(255,255,255,.06); color: #e6f0fa; box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); }
  html[data-tema="escuro"] .fp-zoom input { accent-color: #0ffcbe; }
  html[data-tema="escuro"] .fp-erro { color: #ffb4b4; }
  `;
  const IC = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const SVG_CAMERA = IC('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.5"/>');
  const SVG_GALERIA = IC('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17 4.5-4.5 3.5 3.5 2.5-2.5L20 18"/>');
  const SVG_MENOS = IC('<circle cx="11" cy="11" r="6.5"/><path d="M8.5 11h5M16 16l4 4"/>');
  const SVG_MAIS = IC('<circle cx="11" cy="11" r="6.5"/><path d="M8.5 11h5M11 8.5v5M16 16l4 4"/>');
  const CHAVE_DEPOIS = 'sintonia.foto.depois';

  const h = (tag, props = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f);
    return e;
  };
  const api = async (url, opcoes = {}) => {
    const r = await fetch(url, { credentials: 'same-origin', ...opcoes, headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) } });
    const j = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.erro || 'Não deu certo. Tente de novo.');
    return j;
  };
  const iniciais = (nome) => { const p = String(nome || '').trim().split(/\s+/).filter(Boolean); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); };
  const VISTA = 200; // tamanho do círculo na tela (px)
  const SAIDA = 256; // tamanho da foto enviada (px), como na Conta › Perfil

  function abrir(eu) {
    if (document.getElementById('fp-fundo')) return;
    if (!document.getElementById('estilo-foto-perfil')) document.head.append(h('style', { id: 'estilo-foto-perfil', text: CSS }));
    const primeiro = String(eu.nome || '').trim().split(/\s+/)[0] || '';
    const roda = h('div', { class: 'fp-roda', 'aria-hidden': 'true', text: iniciais(eu.nome) });
    const titulo = h('h2', { id: 'fp-titulo', text: 'Coloque sua foto de perfil' });
    const texto = h('p', { text: `${primeiro ? `${primeiro}, a` : 'A'} sua foto aparece para a equipe nas conversas, no chat e na agenda. Use uma foto do rosto, de frente.` });
    const textoInicial = texto.textContent;
    const erro = h('p', { class: 'fp-erro', role: 'alert' });
    const zoom = h('input', { type: 'range', min: '1', max: '3', step: '0.01', value: '1', 'aria-label': 'Aproximar a foto' });
    const linhaZoom = h('div', { class: 'fp-zoom', hidden: true, html: SVG_MENOS }, zoom);
    linhaZoom.insertAdjacentHTML('beforeend', SVG_MAIS);
    const botoes = h('div', { class: 'fp-botoes' });
    const depois = eu.podePularFoto
      ? h('button', { class: 'fp-depois', type: 'button', text: 'Agora não', onclick: () => { try { sessionStorage.setItem(CHAVE_DEPOIS, '1'); } catch {} fechar(); } })
      : null;
    const cartao = h('div', { class: 'fp-cartao', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fp-titulo' }, roda, titulo, texto, linhaZoom, erro, botoes, depois);
    const fundo = h('div', { class: 'fp-fundo', id: 'fp-fundo' }, cartao);
    document.body.append(fundo);
    const antes = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    function fechar() { fundo.remove(); document.documentElement.style.overflow = antes; }

    // Escolher a imagem: câmera (frontal) ou galeria.
    const escolher = (camera) => {
      const entrada = h('input', { type: 'file', accept: 'image/*', ...(camera ? { capture: 'user' } : {}) });
      entrada.addEventListener('change', async () => {
        const arq = entrada.files?.[0]; if (!arq) return;
        erro.textContent = '';
        try { ajustar(await createImageBitmap(arq)); } catch { erro.textContent = 'Não deu para abrir essa imagem. Tente outra (JPG ou PNG).'; }
      });
      entrada.click();
    };
    const telaEscolha = () => {
      linhaZoom.hidden = true;
      titulo.textContent = 'Coloque sua foto de perfil';
      texto.textContent = textoInicial;
      botoes.replaceChildren(
        h('button', { class: 'fp-bt', type: 'button', html: `${SVG_CAMERA}<span>Tirar foto</span>`, onclick: () => escolher(true) }),
        h('button', { class: 'fp-bt leve', type: 'button', html: `${SVG_GALERIA}<span>Escolher da galeria</span>`, onclick: () => escolher(false) }),
      );
    };

    // Ajustar no círculo: arrastar para posicionar, aproximar pela barra (ou rodinha do mouse / pinça).
    function ajustar(bmp) {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const tela = h('canvas', { width: String(VISTA * dpr), height: String(VISTA * dpr) });
      const ctx = tela.getContext('2d');
      roda.textContent = ''; roda.append(tela);
      const base = VISTA / Math.min(bmp.width, bmp.height);
      let z = 1, x = 0, y = 0;
      const escala = () => base * z;
      const prender = () => {
        const s = escala();
        x = Math.min(0, Math.max(VISTA - bmp.width * s, x));
        y = Math.min(0, Math.max(VISTA - bmp.height * s, y));
      };
      const desenhar = () => {
        prender();
        const s = escala();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, VISTA, VISTA);
        ctx.drawImage(bmp, x, y, bmp.width * s, bmp.height * s);
      };
      const mudarZoom = (novo, cx = VISTA / 2, cy = VISTA / 2) => {
        const s0 = escala();
        z = Math.min(3, Math.max(1, novo));
        const s1 = escala();
        // Aproxima em torno do ponto (centro ou dedo), sem a foto "fugir".
        x = cx - ((cx - x) * s1) / s0; y = cy - ((cy - y) * s1) / s0;
        zoom.value = String(z); desenhar();
      };
      x = (VISTA - bmp.width * base) / 2; y = (VISTA - bmp.height * base) / 2;
      zoom.value = '1'; zoom.oninput = () => mudarZoom(Number(zoom.value));
      const toques = new Map(); let pinca = 0;
      tela.addEventListener('pointerdown', (e) => { tela.setPointerCapture(e.pointerId); toques.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
      tela.addEventListener('pointermove', (e) => {
        const p = toques.get(e.pointerId); if (!p) return;
        if (toques.size === 2) {
          const [a, b] = [...toques.values()];
          toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [a2, b2] = [...toques.values()];
          const d0 = Math.hypot(a.x - b.x, a.y - b.y), d1 = Math.hypot(a2.x - b2.x, a2.y - b2.y);
          if (d0 > 0) { pinca = d1 / d0; mudarZoom(z * pinca); }
          return;
        }
        const f = VISTA / tela.getBoundingClientRect().width;
        x += (e.clientX - p.x) * f; y += (e.clientY - p.y) * f;
        toques.set(e.pointerId, { x: e.clientX, y: e.clientY });
        desenhar();
      });
      const soltar = (e) => toques.delete(e.pointerId);
      tela.addEventListener('pointerup', soltar); tela.addEventListener('pointercancel', soltar);
      tela.addEventListener('wheel', (e) => { e.preventDefault(); const r = tela.getBoundingClientRect(); mudarZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), ((e.clientX - r.left) * VISTA) / r.width, ((e.clientY - r.top) * VISTA) / r.height); }, { passive: false });
      desenhar();
      roda.removeAttribute('aria-hidden');
      linhaZoom.hidden = false;
      titulo.textContent = 'Ajuste no círculo';
      texto.textContent = 'Arraste a foto para posicionar e use a barra para aproximar.';
      const salvar = h('button', { class: 'fp-bt', type: 'button', text: 'Usar esta foto' });
      salvar.addEventListener('click', async () => {
        salvar.disabled = true; salvar.textContent = 'Salvando…'; erro.textContent = '';
        try {
          const saida = Object.assign(document.createElement('canvas'), { width: SAIDA, height: SAIDA });
          const s = escala();
          saida.getContext('2d').drawImage(bmp, -x / s, -y / s, VISTA / s, VISTA / s, 0, 0, SAIDA, SAIDA);
          const base64 = saida.toDataURL('image/jpeg', 0.86).split(',')[1];
          await api(`/api/equipe/${encodeURIComponent(eu.id)}/foto`, { method: 'PUT', body: JSON.stringify({ base64, mimetype: 'image/jpeg' }) });
          try { sessionStorage.removeItem(CHAVE_DEPOIS); } catch {}
          await window.SintoniaFotos?.carregar?.();
          fechar();
          window.Sintonia?.ui?.toast?.('Foto salva ✓ Boas-vindas!');
        } catch (x2) { erro.textContent = x2.message || 'Não deu para salvar a foto. Tente de novo.'; salvar.disabled = false; salvar.textContent = 'Usar esta foto'; }
      });
      botoes.replaceChildren(salvar, h('button', { class: 'fp-bt leve', type: 'button', text: 'Escolher outra', onclick: () => { roda.replaceChildren(); roda.textContent = iniciais(eu.nome); roda.setAttribute('aria-hidden', 'true'); telaEscolha(); } }));
    }

    telaEscolha();
    cartao.setAttribute('tabindex', '-1');
    cartao.style.outline = 'none';
    cartao.focus({ preventScroll: true });
  }

  window.SintoniaFotoPerfil = { abrir };
  addEventListener('load', async () => {
    let eu;
    try { eu = await api('/api/auth/eu'); } catch { return; }
    // Senha provisória primeiro (a troca recarrega a página e, aí, vem a foto).
    if (!eu?.pedirFoto || eu.trocarSenha) return;
    let depois = false;
    try { depois = sessionStorage.getItem(CHAVE_DEPOIS) === '1'; } catch {}
    if (eu.podePularFoto && depois) return;
    abrir(eu);
  });
})();
