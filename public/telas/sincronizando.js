/* sincronizando: a mesma folha "Sincronizando" do WhatsApp (classes wa-* de conexoes.html) para as outras conexões
 * (Instagram, Facebook, TikTok, WhatsApp oficial, e-mail). Cada passo é uma chamada de verdade ao servidor;
 * a animação só gira enquanto um passo está rodando e cada passo tem tempo máximo. No fim: "Pronto" ou o erro.
 *
 * window.SintoniaSincronizando.abrir({
 *   nome: 'Instagram', artigo: 'o',            // título "Sincronizando o Instagram…"
 *   sub: 'Ligando as mensagens do Direct…',    // o que está sendo feito/trazido
 *   passos: [{ texto, pronto?, fazer: async (ctx) => 'detalhe opcional', opcional?: true, maxMs?: 20000 }],  // pronto = texto depois de feito
 *   // meta-historico: durante um passo longo, ctx.andamento('12 conversas…', 0.4) mostra o andamento embaixo do passo
 *   // e enche a barra até essa fração do passo (progresso de verdade, vindo do servidor).
 *   fim: (ctx) => ({ titulo, texto, botao?: { texto, href } }),
 *   falha?: (erro, passo, ctx) => ({ titulo, texto }),
 * }) -> Promise<{ ok, ctx }>
 * Todo texto entra por textContent. */
(() => {
  const css = document.createElement('style');
  css.textContent = `
  .sc-folha .sc-passos { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; text-align: left; }
  .sc-folha .sc-passos li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 10px; align-items: start; font-size: 14px; line-height: 1.4; color: var(--sub); }
  .sc-folha .sc-passos li small { display: block; font-size: 12.5px; color: var(--sub); overflow-wrap: anywhere; }
  .sc-folha .sc-passos li.sc-agora { color: var(--texto); font-weight: 600; }
  .sc-folha .sc-passos li.sc-feito { color: var(--texto); }
  .sc-folha .sc-marca { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; box-shadow: inset 0 0 0 1.6px color-mix(in srgb, var(--sub) 45%, transparent); }
  .sc-folha .sc-marca svg { width: 14px; height: 14px; }
  .sc-folha li.sc-agora .sc-marca { box-shadow: inset 0 0 0 1.6px var(--brilho-2, #3aa0ff); }
  .sc-folha li.sc-agora .sc-marca::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: linear-gradient(135deg, var(--brilho-1, #0ffcbe), var(--brilho-2, #3aa0ff)); }
  .sc-folha li.sc-feito .sc-marca { background: var(--ok-fundo); color: var(--ok); box-shadow: none; }
  .sc-folha li.sc-aviso .sc-marca { background: color-mix(in srgb, #f5a524 18%, transparent); color: #b77400; box-shadow: none; }
  html[data-tema="escuro"] .sc-folha li.sc-aviso .sc-marca { color: #ffd47a; }
  .sc-folha li.sc-erro .sc-marca { background: color-mix(in srgb, var(--erro) 14%, transparent); color: var(--erro); box-shadow: none; }
  .sc-folha .wa-barra.sc-det i { animation: none; transform: none; width: 0; transition: width .45s cubic-bezier(.2,.8,.2,1); }
  .sc-folha .wa-check.sc-ruim { background: color-mix(in srgb, var(--erro) 14%, transparent); color: var(--erro); }
  .sc-folha .sc-txt { white-space: pre-line; }
  @media (prefers-reduced-motion: reduce) { .sc-folha .wa-barra.sc-det i { transition: none; } }
  `;
  document.head.append(css);

  const NS = 'http://www.w3.org/2000/svg';
  const svg = (d, largura = '2.2') => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', largura); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    for (const x of [].concat(d)) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', x); s.append(p); }
    return s;
  };
  const OK = 'm5 12.5 4.5 4.5L19 7.5';
  const EXCL = ['M12 7v6', 'M12 17h.01'];
  const XIS = ['M7 7l10 10', 'M17 7 7 17'];
  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...filhos.filter((f) => f != null)); return e; };

  let folha = null;
  function montar() {
    if (folha) return folha;
    const d = el('dialog', { className: 'wa-folha sc-folha', id: 'd-sinc' });
    d.setAttribute('aria-labelledby', 'sc-titulo');
    // O mesmo anel do WhatsApp (gradiente menta→azul) com as setas de sincronizar no meio.
    const anel = el('div', { className: 'wa-sinc', id: 'sc-anel' });
    anel.setAttribute('aria-hidden', 'true');
    anel.innerHTML = '<svg class="wa-sinc-anel" viewBox="0 0 64 64"><defs><linearGradient id="sc-g" x1="0" x2="1"><stop offset="0" stop-color="#0ffcbe"/><stop offset="1" stop-color="#3aa0ff"/></linearGradient></defs><circle cx="32" cy="32" r="27" fill="none" stroke="url(#sc-g)" stroke-width="4" stroke-linecap="round" stroke-dasharray="120 60"/></svg><svg class="wa-sinc-meio" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>';
    const check = el('div', { className: 'wa-check', id: 'sc-ok', hidden: true });
    check.setAttribute('aria-hidden', 'true');
    const barra = el('div', { className: 'wa-barra sc-det', id: 'sc-barra' }, el('i'));
    barra.setAttribute('aria-hidden', 'true');
    const texto = el('p', { className: 'wa-sub sc-txt', id: 'sc-texto' });
    texto.setAttribute('role', 'status'); texto.setAttribute('aria-live', 'polite');
    const botao = el('a', { className: 'botao wa-pri', id: 'sc-botao', hidden: true });
    const fechar = el('button', { className: 'wa-fechar', type: 'button', textContent: '✕' });
    fechar.setAttribute('aria-label', 'Fechar');
    fechar.addEventListener('click', () => d.close());
    botao.addEventListener('click', (e) => { if (!botao.getAttribute('href')) { e.preventDefault(); d.close(); } });
    d.append(el('div', { className: 'wa-puxa' }),
      el('div', { className: 'wa-etapa' }, anel, check, el('h2', { id: 'sc-titulo' }), texto, el('ol', { className: 'sc-passos', id: 'sc-passos' }), barra, botao),
      fechar);
    d.addEventListener('click', (e) => { if (e.target === d && !d.dataset.rodando) d.close(); });
    document.body.append(d);
    return (folha = d);
  }

  const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const comPrazo = (p, ms) => Promise.race([p, pausa(ms).then(() => { throw new Error('demorou mais que o normal'); })]);

  async function abrir(o) {
    const d = montar();
    const q = (id) => d.querySelector('#' + id);
    const nome = o.nome;
    const vez = Symbol('vez'); d._vez = vez; // se abrir de novo, a rodada anterior para de mexer na tela
    const viva = () => d._vez === vez;
    q('sc-anel').hidden = false; q('sc-ok').hidden = true; q('sc-ok').classList.remove('sc-ruim'); q('sc-ok').replaceChildren(svg(OK));
    q('sc-barra').hidden = false; q('sc-barra').firstChild.style.width = '0%';
    q('sc-botao').hidden = true;
    q('sc-titulo').textContent = `Sincronizando ${o.artigo || 'o'} ${nome}…`;
    q('sc-texto').textContent = o.sub || '';
    const itens = o.passos.map((p) => el('li', {}, el('span', { className: 'sc-marca' }), el('span', { textContent: p.texto })));
    q('sc-passos').replaceChildren(...itens);
    d.dataset.rodando = '1';
    if (!d.open) d.showModal();

    const ctx = {};
    let falhou = null;
    for (let i = 0; i < o.passos.length; i++) {
      const p = o.passos[i]; const li = itens[i];
      li.className = 'sc-agora'; li.setAttribute('aria-current', 'step');
      const inicio = Date.now();
      // meta-historico: andamento real do passo (texto embaixo dele + barra até a fração feita).
      ctx.andamento = (texto, fracao) => {
        if (!viva()) return;
        let s = li.querySelector('small.sc-and');
        if (!s) { s = el('small', { className: 'sc-and' }); li.lastChild.append(s); }
        s.textContent = texto || '';
        if (typeof fracao === 'number' && Number.isFinite(fracao)) q('sc-barra').firstChild.style.width = `${Math.round(((i + Math.min(1, Math.max(0, fracao))) / o.passos.length) * 100)}%`;
      };
      let detalhe = '', deu = true, erro = null;
      try { detalhe = (await comPrazo(Promise.resolve().then(() => p.fazer(ctx)), p.maxMs || 20000)) || ''; }
      catch (x) { deu = false; erro = x; }
      // Mínimo de meio segundo por passo, só para dar tempo de ler.
      const resta = 500 - (Date.now() - inicio); if (resta > 0) await pausa(resta);
      if (!viva()) return { ok: false, ctx };
      li.removeAttribute('aria-current');
      li.querySelector('small.sc-and')?.remove();
      li.className = deu ? 'sc-feito' : p.opcional ? 'sc-aviso' : 'sc-erro';
      if (deu && p.pronto) li.lastChild.textContent = p.pronto;
      li.querySelector('.sc-marca').replaceChildren(svg(deu ? OK : p.opcional ? EXCL : XIS, '2.4'));
      const dica = deu ? detalhe : (erro?.message || 'não respondeu');
      if (dica) li.lastChild.append(el('small', { textContent: dica }));
      q('sc-barra').firstChild.style.width = `${Math.round(((i + 1) / o.passos.length) * 100)}%`;
      if (!deu && !p.opcional) { falhou = { erro, passo: p }; break; }
    }
    delete d.dataset.rodando;
    q('sc-anel').hidden = true; q('sc-barra').hidden = true; q('sc-ok').hidden = false;
    if (falhou) {
      const f = o.falha?.(falhou.erro, falhou.passo, ctx) || {};
      q('sc-ok').classList.add('sc-ruim'); q('sc-ok').replaceChildren(svg(EXCL, '2.4'));
      q('sc-titulo').textContent = f.titulo || `Não deu para conectar ${o.artigo || 'o'} ${nome}`;
      q('sc-texto').textContent = f.texto || (falhou.erro?.message || 'Tente de novo em alguns minutos.');
      const b = q('sc-botao'); b.textContent = 'Fechar'; b.removeAttribute('href'); b.hidden = false;
      return { ok: false, ctx };
    }
    const f = o.fim(ctx) || {};
    q('sc-titulo').textContent = f.titulo || `${nome} conectado`;
    q('sc-texto').textContent = f.texto || '';
    const b = q('sc-botao'); b.textContent = f.botao?.texto || 'Pronto';
    if (f.botao?.href) b.href = f.botao.href; else b.removeAttribute('href');
    b.hidden = false;
    return { ok: true, ctx };
  }

  window.SintoniaSincronizando = { abrir };
})();
