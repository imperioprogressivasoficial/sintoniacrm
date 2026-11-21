/* conversa-extra: papel de parede das conversas (o fundo atrás dos balões), como no WhatsApp — window.SintoniaPapelParede.
 * A pessoa escolhe uma cor (ou o padrão) e se quer o desenho sutil de pontinhos, separado para o tema claro e o escuro.
 * Vale no #msgs das Conversas e nos chats de Grupos e Equipe (todos usam .chat). Guardado na conta
 * (/api/conta › preferencias.papelParede, src/conta/conta.ts): vale em todos os aparelhos; uma cópia fica neste
 * aparelho só para abrir já com a cor certa.
 * As cores claras são tons claros da marca e as escuras, tons escuros: os balões (brancos/azuis no claro,
 * azul-marinho/azul no escuro) continuam se destacando em qualquer fundo.
 * Usado em: Conta › Área de trabalho (cartao) e menu da conversa › Papel de parede (abrir). */
(() => {
  const CORES = [
    // id, nome, claro, escuro
    ['padrao', 'Padrão', null, null],
    ['ceu', 'Céu', '#cfe2f5', '#062441'],
    ['menta', 'Menta', '#d3f5ea', '#06332a'],
    ['marinho', 'Marinho', '#d9e1ec', '#0d2240'],
    ['aqua', 'Água', '#d2eef1', '#032a31'],
    ['areia', 'Areia', '#efe8dc', '#282017'],
    ['lavanda', 'Lavanda', '#e3e0f4', '#1d1838'],
    ['grafite', 'Grafite', '#e1e4e8', '#101418'],
  ];
  const PADRAO_COR = { claro: '#eef3f8', escuro: '#05172a' };
  const BALOES = { claro: { rec: '#ffffff', env: '#d9ecfb', txt: '#0b1b2b', sub: '#5b6b7d', ponto: 'rgba(16,110,190,.08)' }, escuro: { rec: '#0f3150', env: '#106ebe', txt: '#e8f1fb', sub: '#9fb6cc', ponto: 'rgba(15,252,190,.06)' } };
  const GUARDADO = 'sintonia.papelParede';
  const padrao = () => ({ claro: { cor: 'padrao', desenho: true }, escuro: { cor: 'padrao', desenho: true } });
  const limpo = (p) => {
    const ok = (l) => ({ cor: CORES.some(([id]) => id === l?.cor) ? l.cor : 'padrao', desenho: l?.desenho !== false });
    return { claro: ok(p?.claro), escuro: ok(p?.escuro) };
  };
  let atual = padrao();
  try { const g = JSON.parse(localStorage.getItem(GUARDADO) || 'null'); if (g) atual = limpo(g); } catch {}

  // CSS fixo: uma regra por cor e por tema; a escolha entra como atributos no <html>.
  const regras = [];
  for (const [id, , claro, escuro] of CORES) {
    if (!claro) continue;
    regras.push(`html[data-tema="claro"][data-papel-claro="${id}"] .chat::before { background-color: ${claro}; }`);
    regras.push(`html[data-tema="escuro"][data-papel-escuro="${id}"] .chat::before { background-color: ${escuro}; }`);
  }
  regras.push('html[data-tema="claro"][data-papel-desenho-claro="0"] .chat::before, html[data-tema="escuro"][data-papel-desenho-escuro="0"] .chat::before { background-image: none; }');
  const CSS = regras.join('\n') + `
  .pp { display: grid; gap: 12px; min-width: 0; }
  .pp-previa { position: relative; overflow: hidden; border-radius: 18px; padding: 14px 14px 12px; display: grid; gap: 6px; min-height: 148px; align-content: end;
    box-shadow: inset 0 0 0 1px rgba(8,36,63,.08); background-size: 26px 26px; background-position: 0 0, 13px 13px; }
  .pp-previa .pp-dia { justify-self: center; font-size: 11.5px; padding: 3px 10px; border-radius: 7px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  .pp-previa .pp-bal { max-width: 78%; padding: 6px 9px 7px; border-radius: 9px; font-size: 13.5px; line-height: 18px; box-shadow: 0 1px .5px rgba(11,20,26,.13); }
  .pp-previa .pp-bal.rec { justify-self: start; border-top-left-radius: 2px; }
  .pp-previa .pp-bal.env { justify-self: end; border-top-right-radius: 2px; }
  .pp-previa .pp-bal small { display: block; text-align: right; font-size: 10.5px; margin-top: 1px; }
  .pp-cores { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 8px; }
  .pp-cor { all: unset; cursor: pointer; display: grid; justify-items: center; gap: 5px; font-size: 12.5px; color: var(--sub); min-width: 0; -webkit-tap-highlight-color: transparent; }
  .pp-cor i { display: block; width: 46px; height: 46px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(8,36,63,.12); position: relative; }
  html[data-tema="escuro"] .pp-cor i { box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
  .pp-cor[aria-pressed="true"] { color: var(--texto); font-weight: 650; }
  .pp-cor[aria-pressed="true"] i { box-shadow: 0 0 0 2px var(--fundo, #fff), 0 0 0 3.5px #106ebe; }
  html[data-tema="escuro"] .pp-cor[aria-pressed="true"] i { box-shadow: 0 0 0 2px var(--fundo, #071d33), 0 0 0 3.5px #0ffcbe; }
  .pp-cor[aria-pressed="true"] i::after { content: ""; position: absolute; inset: 0; margin: auto; width: 16px; height: 16px; background: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23106ebe' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 12.5 4.5 4.5L19 7.5'/%3E%3C/svg%3E"); }
  html[data-tema="escuro"] .pp-cor[aria-pressed="true"] i::after { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230ffcbe' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 12.5 4.5 4.5L19 7.5'/%3E%3C/svg%3E"); }
  .pp-cor:focus-visible i { outline: 2px solid #3aa0ff; outline-offset: 3px; }
  .pp-linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14.5px; }
  .pp-linha small { display: block; color: var(--sub); font-size: 12.5px; }
  .pp-temas { display: inline-flex; padding: 3px; border-radius: 999px; background: color-mix(in srgb, var(--texto) 7%, transparent); }
  .pp-temas button { all: unset; cursor: pointer; padding: 6px 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--sub); }
  .pp-temas button[aria-pressed="true"] { background: var(--fundo, #fff); color: var(--texto); box-shadow: 0 1px 4px rgba(8,36,63,.14); }
  .pp-chave { position: relative; flex: none; width: 46px; height: 28px; }
  .pp-chave input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
  .pp-chave i { display: block; width: 100%; height: 100%; border-radius: 999px; background: color-mix(in srgb, var(--texto) 18%, transparent); transition: background .2s; pointer-events: none; }
  .pp-chave i::after { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
  .pp-chave input:checked + i { background: linear-gradient(90deg, #106ebe, #3aa0ff); }
  .pp-chave input:checked + i::after { transform: translateX(18px); }
  .pp-chave input:focus-visible + i { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  .pp-nota { margin: 0; font-size: 12.5px; color: var(--sub); }
  dialog.folha.pp-folha .pp { padding: 2px 2px 4px; }
  @media (prefers-reduced-motion: reduce) { .pp-chave i, .pp-chave i::after { transition: none; } }
  `;
  const css = () => { if (!document.getElementById('pp-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'pp-css', textContent: CSS })); };
  css();

  function aplicar(p, guardar = true) {
    atual = limpo(p || atual);
    const h = document.documentElement;
    h.dataset.papelClaro = atual.claro.cor; h.dataset.papelEscuro = atual.escuro.cor;
    h.dataset.papelDesenhoClaro = atual.claro.desenho ? '1' : '0'; h.dataset.papelDesenhoEscuro = atual.escuro.desenho ? '1' : '0';
    if (guardar) { try { localStorage.setItem(GUARDADO, JSON.stringify(atual)); } catch {} }
  }
  aplicar(atual, false);
  // A conta chegou (telas/conta.js põe window.SintoniaContaPrefs e avisa): o servidor manda.
  const daConta = () => { const p = window.SintoniaContaPrefs; if (p?.papelParede) aplicar(p.papelParede); };
  daConta();
  addEventListener('sintonia:conta', daConta);

  const ui = () => window.Sintonia?.ui;
  const temaAgora = () => (document.documentElement.dataset.tema === 'escuro' ? 'escuro' : 'claro');
  const corDe = (lado, id) => (CORES.find((c) => c[0] === id)?.[lado === 'claro' ? 2 : 3]) || PADRAO_COR[lado];

  let salvando = Promise.resolve();
  function salvar(lado, mud) {
    const antes = structuredClone(atual);
    aplicar({ ...atual, [lado]: { ...atual[lado], ...mud } });
    const u = ui(); if (!u) return;
    salvando = salvando.then(() => u.api('/api/conta', { method: 'PATCH', body: JSON.stringify({ preferencias: { papelParede: { [lado]: mud } } }) }))
      .then((c) => { if (c?.preferencias) window.SintoniaContaPrefs = c.preferencias; })
      .catch((x) => { aplicar(antes); u.toast(x?.message || 'Não deu para salvar o papel de parede agora.'); });
  }

  /** O seletor (prévia ao vivo + cores + desenho), igual na Conta e no menu da conversa. */
  function seletor() {
    css();
    const u = ui(); const el = u.el;
    let lado = temaAgora();
    const previa = el('div', { class: 'pp-previa', role: 'img' });
    const cores = el('div', { class: 'pp-cores', role: 'radiogroup', 'aria-label': 'Cor do papel de parede' });
    const chaveIn = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Desenho sutil' });
    const temas = el('div', { class: 'pp-temas', role: 'group', 'aria-label': 'Para qual tema' });
    const pintar = () => {
      const l = atual[lado]; const b = BALOES[lado]; const fundo = corDe(lado, l.cor);
      previa.style.backgroundColor = fundo;
      previa.style.backgroundImage = l.desenho ? `radial-gradient(${b.ponto} 1.2px, transparent 1.3px), radial-gradient(${b.ponto} 1.2px, transparent 1.3px)` : 'none';
      previa.setAttribute('aria-label', `Prévia do papel de parede ${CORES.find((c) => c[0] === l.cor)?.[1] || 'Padrão'} no tema ${lado}`);
      const bal = (cls, txt, hora) => { const n = el('div', { class: 'pp-bal ' + cls, text: txt }); n.style.background = cls === 'rec' ? b.rec : b.env; n.style.color = b.txt; const s = el('small', { text: hora }); s.style.color = b.sub; n.append(s); return n; };
      const dia = el('span', { class: 'pp-dia', text: 'Hoje' }); dia.style.background = b.rec; dia.style.color = b.sub;
      previa.replaceChildren(dia, bal('rec', 'Oi! Tem horário amanhã?', '10:02'), bal('env', 'Tenho sim! Às 15h fica bom?', '10:03'), bal('rec', 'Perfeito 😊', '10:04'));
      for (const bt of cores.children) { const sim = bt.dataset.cor === l.cor; bt.setAttribute('aria-pressed', String(sim)); bt.setAttribute('aria-checked', String(sim)); bt.querySelector('i').style.background = corDe(lado, bt.dataset.cor); }
      chaveIn.checked = l.desenho;
      for (const bt of temas.children) bt.setAttribute('aria-pressed', String(bt.dataset.lado === lado));
    };
    for (const [id, nome] of CORES) cores.append(el('button', { type: 'button', class: 'pp-cor', role: 'radio', 'data-cor': id, 'aria-label': nome, onclick: () => { salvar(lado, { cor: id }); pintar(); } }, el('i'), el('span', { text: nome })));
    for (const [v, n] of [['claro', 'Claro'], ['escuro', 'Escuro']]) temas.append(el('button', { type: 'button', 'data-lado': v, text: n, onclick: () => { lado = v; pintar(); } }));
    chaveIn.addEventListener('change', () => { salvar(lado, { desenho: chaveIn.checked }); pintar(); });
    pintar();
    return el('div', { class: 'pp' },
      el('div', { class: 'pp-linha' }, el('span', {}, document.createTextNode('Escolha para cada tema'), el('small', { text: 'Como no WhatsApp: um fundo no claro e outro no escuro.' })), temas),
      previa, cores,
      el('label', { class: 'pp-linha' }, el('span', {}, document.createTextNode('Desenho sutil'), el('small', { text: 'Os pontinhos por cima da cor.' })), el('span', { class: 'pp-chave' }, chaveIn, el('i'))),
      el('p', { class: 'pp-nota', text: 'Vale para Conversas, Grupos e Equipe, em todos os aparelhos em que você entrar.' }));
  }

  /** Cartão para Conta › Área de trabalho. */
  function cartao(EC) {
    const ic = '<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="m4 16 4.5-4.5 3.5 3.5 2.5-2.5L20 18"/><circle cx="15.5" cy="8.5" r="1.6"/></svg>';
    return EC.cartao(ic, 'Papel de parede das conversas', seletor());
  }

  /** Folha (de baixo no celular) com o seletor: atalho do menu da conversa. */
  function abrir() {
    const u = ui(); if (!u) return;
    const el = u.el;
    document.getElementById('pp-folha')?.remove();
    const d = el('dialog', { class: 'folha pp-folha', id: 'pp-folha', 'aria-label': 'Papel de parede' });
    d.append(el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: 'Papel de parede' }),
      el('button', { type: 'button', class: 'icone fechar-folha', 'aria-label': 'Fechar', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>', onclick: () => d.close() })), seletor());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => setTimeout(() => d.remove(), 300));
    document.body.append(d);
    d.showModal();
  }

  window.SintoniaPapelParede = { aplicar, cartao, abrir, seletor, cores: CORES, atual: () => structuredClone(atual) };
})();
