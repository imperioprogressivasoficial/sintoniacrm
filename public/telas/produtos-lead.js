/* produtos-lead: produtos e serviços vinculados ao lead (como no Kommo).
 * Registra window.SintoniaProdutosLead:
 * - montar(caixa, conversaId, { aoMudar }) desenha o bloco "Produtos e serviços" dentro de `caixa`
 *   (lista com quantidade, preço do momento, desconto e total; busca no cadastro para adicionar; remover).
 * - ficha(c): o cartão na ficha da cliente (conversa-ux.js chama a cada desenho da ficha).
 * Rotas: /api/conversas/:id/produtos (src/empresa/lead-produtos-rotas.ts) e /api/produtos (cadastro).
 * Todo texto do servidor entra por textContent (el(..., { text })). */
(() => {
  const ui = () => window.Sintonia && window.Sintonia.ui;
  const I = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    caixa: I('<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>'),
    mais: I('<path d="M12 5v14M5 12h14"/>', 2),
    menos: I('<path d="M5 12h14"/>', 2),
    x: I('<path d="M7 7l10 10M17 7 7 17"/>', 2),
    lapis: I('<path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>'),
    busca: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  };
  const real = (v) => (v == null ? 'Sob consulta' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const numero = (t) => { const s = String(t ?? '').trim().replace(/[R$\s]/g, ''); if (!s) return null; const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const CSS = `
  .pl { display: grid; gap: 10px; min-width: 0; }
  .pl-lista { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
  .pl-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; padding: 10px 12px; border-radius: 14px;
    background: var(--cux-mini, var(--vidro-item, rgba(16, 110, 190, .06))); box-shadow: inset 0 0 0 1px var(--vidro-borda, transparent); }
  .pl-nome { min-width: 0; display: grid; gap: 2px; }
  .pl-nome b { font-size: 14px; font-weight: 700; color: var(--texto); overflow-wrap: anywhere; }
  .pl-nome small { font-size: 12px; color: var(--sub); }
  .pl-total { font-weight: 800; font-size: 14px; color: var(--texto); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .pl-acoes { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pl-qtd { display: inline-flex; align-items: center; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(8, 36, 63, .12)); background: var(--cux-cartao, var(--vidro-fundo, #fff)); }
  .pl-qtd button { all: unset; box-sizing: border-box; cursor: pointer; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%; color: var(--texto); }
  .pl-qtd button svg { width: 15px; height: 15px; }
  .pl-qtd button:hover { background: var(--hover, rgba(16, 110, 190, .08)); }
  .pl-qtd button[aria-disabled="true"] { opacity: .35; cursor: default; }
  .pl-qtd span { min-width: 26px; text-align: center; font-weight: 700; font-size: 14px; font-variant-numeric: tabular-nums; }
  .pl-bt { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 700; color: var(--sub); }
  .pl-bt svg { width: 15px; height: 15px; }
  .pl-bt:hover { background: var(--hover, rgba(16, 110, 190, .08)); color: var(--texto); }
  .pl-bt.pl-tirar { margin-left: auto; }
  .pl-bt.pl-tirar:hover { color: var(--erro, #d93636); }
  .pl-edita { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: end; }
  .pl-edita label { display: grid; gap: 4px; font-size: 12px; font-weight: 600; color: var(--sub); }
  .pl input { box-sizing: border-box; width: 100%; font: inherit; font-size: 15px; color: var(--texto); background: var(--cux-cartao, var(--vidro-fundo, #fff)); border: 1px solid var(--vidro-borda, rgba(8, 36, 63, .14)); border-radius: 12px; padding: 8px 10px; min-height: 40px; }
  .pl input:focus { outline: none; border-color: #3aa0ff; box-shadow: 0 0 0 3px rgba(58, 160, 255, .18); }
  .pl-ok { all: unset; box-sizing: border-box; cursor: pointer; height: 40px; padding: 0 14px; border-radius: 12px; font-weight: 700; font-size: 14px; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .pl-rodape { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 2px; }
  .pl-rodape .pl-soma { display: grid; gap: 1px; }
  .pl-rodape .pl-soma small { font-size: 12px; color: var(--sub); }
  .pl-rodape .pl-soma b { font-size: 18px; font-weight: 800; letter-spacing: -.01em; color: var(--texto); font-variant-numeric: tabular-nums; }
  .pl-add { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px; border-radius: 999px; font-weight: 700; font-size: 13.5px;
    color: var(--marca-azul, #106ebe); background: rgba(16, 110, 190, .08); box-shadow: inset 0 0 0 1px rgba(16, 110, 190, .18); }
  .pl-add svg { width: 16px; height: 16px; }
  html[data-tema="escuro"] .pl-add { color: #7cc4ff; background: rgba(124, 196, 255, .1); box-shadow: inset 0 0 0 1px rgba(124, 196, 255, .22); }
  .pl-vazio { font-size: 13.5px; color: var(--sub); margin: 0; }
  .pl-nota { font-size: 12px; color: var(--sub); margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pl-nota label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .pl-nota input[type="checkbox"] { width: 16px; height: 16px; min-height: 0; padding: 0; accent-color: #106ebe; }
  .pl-busca { display: grid; gap: 8px; padding: 10px; border-radius: 16px; background: var(--cux-mini, var(--vidro-item, rgba(16, 110, 190, .06))); }
  .pl-busca-campo { position: relative; display: flex; align-items: center; }
  .pl-busca-campo svg { position: absolute; left: 11px; width: 17px; height: 17px; color: var(--sub); pointer-events: none; }
  .pl-busca-campo input { padding-left: 36px; }
  .pl-achados { display: grid; gap: 4px; max-height: 260px; overflow-y: auto; overscroll-behavior: contain; margin: 0; padding: 0; list-style: none; }
  .pl-achado { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 9px 10px; border-radius: 12px; }
  .pl-achado:hover, .pl-achado:focus-visible { background: var(--cux-cartao, var(--vidro-fundo, #fff)); box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(8, 36, 63, .1)); }
  .pl-achado b { font-size: 14px; font-weight: 600; color: var(--texto); overflow-wrap: anywhere; }
  .pl-achado small { grid-column: 1; font-size: 12px; color: var(--sub); }
  .pl-achado span { grid-row: 1 / span 2; grid-column: 2; align-self: center; font-weight: 700; font-size: 13.5px; color: var(--texto); white-space: nowrap; }
  .pl-achado[aria-disabled="true"] { opacity: .55; }
  .pl-selo { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; padding: 1px 6px; border-radius: 6px; margin-right: 6px; vertical-align: 1px;
    color: #0a7a5c; background: rgba(15, 252, 190, .16); }
  .pl-selo.servico { color: #106ebe; background: rgba(16, 110, 190, .1); }
  html[data-tema="escuro"] .pl-selo { color: #0ffcbe; background: rgba(15, 252, 190, .12); }
  html[data-tema="escuro"] .pl-selo.servico { color: #7cc4ff; background: rgba(124, 196, 255, .14); }
  @media (max-width: 760px) { .pl-edita { grid-template-columns: 1fr 1fr; } .pl-edita .pl-ok { grid-column: 1 / -1; } }
  `;
  function estilo() {
    if (document.getElementById('produtos-lead-css')) return;
    const s = document.createElement('style'); s.id = 'produtos-lead-css'; s.textContent = CSS; document.head.append(s);
  }

  // Catálogo do cadastro (Empresa › Produtos e serviços): um minuto em memória.
  let catalogo = null, catalogoEm = 0;
  async function produtos() {
    if (catalogo && Date.now() - catalogoEm < 60_000) return catalogo;
    const r = await ui().api('/api/produtos');
    catalogo = Array.isArray(r?.produtos) ? r.produtos : [];
    catalogoEm = Date.now();
    return catalogo;
  }
  let configPode = null;
  async function podeConfig() {
    if (configPode !== null) return configPode;
    try { configPode = !!(await ui().api('/api/produtos-lead/config')).podeEditar; } catch { configPode = false; }
    return configPode;
  }

  /** Desenha o bloco dentro de `caixa`. Devolve { recarregar }. */
  function montar(caixa, conversaId, opcoes = {}) {
    estilo();
    const u = ui(); if (!u || !caixa) return null;
    const { el } = u;
    const raiz = el('div', { class: 'pl' });
    caixa.replaceChildren(raiz);
    let dados = null, buscando = false, editando = null, ocupado = false, termo = '';

    const avisar = (r) => { dados = r; desenhar(); opcoes.aoMudar?.(r); };
    async function chamar(metodo, caminho, corpo, ok) {
      if (ocupado) return; ocupado = true;
      try {
        const r = await u.api(`/api/conversas/${conversaId}/produtos${caminho}`, { method: metodo, ...(corpo ? { body: JSON.stringify(corpo) } : {}) });
        avisar(r); if (ok) u.toast(ok);
      } catch (x) { u.toast(x.message); } finally { ocupado = false; }
    }
    async function recarregar() {
      try { dados = await u.api(`/api/conversas/${conversaId}/produtos`); } catch (x) { dados = { erro: x.message }; }
      desenhar();
    }

    function linha(i) {
      const pode = dados.podeEditar;
      const meta = [`${i.quantidade} × ${real(i.preco)}`];
      if (i.desconto) meta.push(`desconto ${real(i.desconto)}`);
      if (i.categoria) meta.push(i.categoria);
      if (i.ativo === false) meta.push('desativado no cadastro');
      if (i.ativo === null) meta.push('saiu do cadastro');
      const nome = el('div', { class: 'pl-nome' }, el('b', {}, el('span', { class: 'pl-selo' + (i.tipo === 'servico' ? ' servico' : ''), text: i.tipo === 'servico' ? 'Serviço' : 'Produto' }), document.createTextNode(i.nome)), el('small', { text: meta.join(' · ') }));
      const li = el('li', { class: 'pl-item' }, nome, el('span', { class: 'pl-total', text: real(i.total) }));
      if (!pode) return li;
      const qtd = el('div', { class: 'pl-qtd', role: 'group', 'aria-label': `Quantidade de ${i.nome}` },
        el('button', { type: 'button', 'aria-label': 'Diminuir', title: 'Diminuir', html: IC.menos, 'aria-disabled': i.quantidade <= 1 ? 'true' : null, onclick: () => { if (i.quantidade > 1) chamar('PATCH', `/${i.id}`, { quantidade: i.quantidade - 1 }); } }),
        el('span', { text: String(i.quantidade), 'aria-live': 'polite' }),
        el('button', { type: 'button', 'aria-label': 'Aumentar', title: 'Aumentar', html: IC.mais, onclick: () => chamar('PATCH', `/${i.id}`, { quantidade: i.quantidade + 1 }) }));
      li.append(el('div', { class: 'pl-acoes' }, qtd,
        el('button', { type: 'button', class: 'pl-bt', 'aria-expanded': String(editando === i.id), onclick: () => { editando = editando === i.id ? null : i.id; desenhar(); } }, el('span', { html: IC.lapis, style: 'display:grid' }), el('span', { text: 'Preço e desconto' })),
        el('button', { type: 'button', class: 'pl-bt pl-tirar', title: `Tirar ${i.nome}`, 'aria-label': `Tirar ${i.nome} do lead`, onclick: () => chamar('DELETE', `/${i.id}`, null, 'Tirado do lead') }, el('span', { html: IC.x, style: 'display:grid' }), el('span', { text: 'Tirar' }))));
      if (editando === i.id) {
        const preco = el('input', { inputmode: 'decimal', value: String(i.preco).replace('.', ','), 'aria-label': 'Preço unitário (R$)' });
        const desc = el('input', { inputmode: 'decimal', value: i.desconto ? String(i.desconto).replace('.', ',') : '', placeholder: '0,00', 'aria-label': 'Desconto (R$)' });
        const form = el('form', { class: 'pl-edita' }, el('label', {}, el('span', { text: 'Preço unitário (R$)' }), preco), el('label', {}, el('span', { text: 'Desconto no total (R$)' }), desc), el('button', { type: 'submit', class: 'pl-ok', text: 'Salvar' }));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const p = numero(preco.value), d = numero(desc.value);
          if (p === null || Number.isNaN(p) || Number.isNaN(d)) { u.toast('Confira o preço e o desconto.'); return; }
          editando = null;
          chamar('PATCH', `/${i.id}`, { preco: p, desconto: d ?? 0 }, 'Salvo ✓');
        });
        li.append(form);
        requestAnimationFrame(() => preco.focus());
      }
      return li;
    }

    function painelBusca() {
      const campo = el('input', { type: 'search', placeholder: 'Buscar no cadastro (nome, categoria ou código)', 'aria-label': 'Buscar produto ou serviço', value: termo, maxlength: '80', autocomplete: 'off' });
      const lista = el('ul', { class: 'pl-achados', role: 'listbox', 'aria-label': 'Produtos e serviços do cadastro' });
      const pintarLista = (l) => {
        const t = semAcento(termo.trim());
        const jaTem = new Set((dados.itens || []).map((i) => i.produtoId));
        const achados = l.filter((p) => p.ativo !== false).filter((p) => !t || semAcento(`${p.nome} ${p.categoria || ''} ${p.codigo || ''}`).includes(t)).slice(0, 40);
        if (!l.length) { lista.replaceChildren(el('li', { class: 'pl-vazio', text: 'Nenhum produto ou serviço no cadastro ainda. Cadastre em Empresa › Produtos e serviços.' })); return; }
        if (!achados.length) { lista.replaceChildren(el('li', { class: 'pl-vazio', text: 'Nada encontrado.' })); return; }
        lista.replaceChildren(...achados.map((p) => el('li', {}, el('button', { type: 'button', class: 'pl-achado', role: 'option', onclick: () => { buscando = false; termo = ''; chamar('POST', '', { produtoId: p.id }, jaTem.has(p.id) ? 'Mais um ✓' : 'Adicionado ✓'); } },
          el('b', {}, el('span', { class: 'pl-selo' + (p.tipo === 'servico' ? ' servico' : ''), text: p.tipo === 'servico' ? 'Serviço' : 'Produto' }), document.createTextNode(p.nome)),
          el('small', { text: [p.categoria, jaTem.has(p.id) ? 'já está no lead (soma 1)' : ''].filter(Boolean).join(' · ') || ' ' }),
          el('span', { text: real(p.preco) })))));
      };
      campo.addEventListener('input', () => { termo = campo.value; if (catalogo) pintarLista(catalogo); });
      campo.addEventListener('keydown', (e) => { if (e.key === 'Escape') { buscando = false; desenhar(); } });
      lista.replaceChildren(el('li', { class: 'pl-vazio', text: 'Carregando…' }));
      produtos().then(pintarLista).catch((x) => lista.replaceChildren(el('li', { class: 'pl-vazio', text: x.message })));
      requestAnimationFrame(() => campo.focus());
      return el('div', { class: 'pl-busca' }, el('div', { class: 'pl-busca-campo' }, el('span', { html: IC.busca, style: 'display:contents' }), campo), lista);
    }

    function desenhar() {
      if (!dados) { raiz.replaceChildren(el('p', { class: 'pl-vazio', text: 'Carregando…' })); return; }
      if (dados.erro) { raiz.replaceChildren(el('p', { class: 'pl-vazio', text: dados.erro })); return; }
      const itens = dados.itens || [];
      const partes = [];
      partes.push(itens.length ? el('ul', { class: 'pl-lista' }, ...itens.map(linha)) : el('p', { class: 'pl-vazio', text: 'Nenhum produto ou serviço neste lead ainda.' }));
      if (buscando) partes.push(painelBusca());
      partes.push(el('div', { class: 'pl-rodape' },
        el('div', { class: 'pl-soma' }, el('small', { text: 'Total' }), el('b', { text: real(dados.total || 0) })),
        dados.podeEditar ? el('button', { type: 'button', class: 'pl-add', 'aria-expanded': String(buscando), onclick: () => { buscando = !buscando; termo = ''; desenhar(); } }, el('span', { html: buscando ? IC.x : IC.mais, style: 'display:grid' }), el('span', { text: buscando ? 'Fechar busca' : 'Adicionar' })) : null));
      const nota = el('p', { class: 'pl-nota' });
      nota.append(document.createTextNode(dados.valorPelaSoma ? (itens.length ? 'O valor do lead é a soma dos produtos.' : 'Com produtos, o valor do lead vira a soma deles.') : 'O valor do lead não muda com os produtos.'));
      partes.push(nota);
      raiz.replaceChildren(...partes);
      podeConfig().then((pode) => {
        if (!pode || !nota.isConnected) return;
        const c = el('input', { type: 'checkbox', 'aria-label': 'Usar a soma dos produtos como valor do lead' }); c.checked = !!dados.valorPelaSoma;
        c.addEventListener('change', async () => {
          try { await u.api('/api/produtos-lead/config', { method: 'PUT', body: JSON.stringify({ valorPelaSoma: c.checked }) }); u.toast(c.checked ? 'O valor do lead segue a soma dos produtos' : 'O valor do lead fica como está'); await recarregar(); opcoes.aoMudar?.(dados); }
          catch (x) { c.checked = !c.checked; u.toast(x.message); }
        });
        nota.replaceChildren(el('label', {}, c, el('span', { text: 'Valor do lead = soma dos produtos' })), el('span', { text: '(vale para todos os leads)' }));
      });
    }
    desenhar();
    recarregar();
    return { recarregar };
  }

  // ---------- ficha da cliente (Conversas): cartão logo depois de "Valor e agendamentos" ----------
  let cartaoFicha = null, conversaFicha = null, blocoFicha = null;
  function ficha(c) {
    const f = document.getElementById('ficha'); if (!f || !c?.id || !ui()) return;
    if (!cartaoFicha || !cartaoFicha.isConnected) {
      const antes = f.querySelector('.cux-c-valores'); if (!antes) return;
      estilo();
      const { el } = ui();
      const corpo = el('div', { class: 'pl-caixa' });
      cartaoFicha = el('section', { class: 'cux-cartao cux-c-produtos' }, el('div', { class: 'cux-cab' }, el('i', { html: IC.caixa }), el('h3', { text: 'Produtos e serviços' })), corpo);
      antes.after(cartaoFicha);
      conversaFicha = null;
    }
    if (conversaFicha === c.id) return;
    conversaFicha = c.id;
    blocoFicha = montar(cartaoFicha.querySelector('.pl-caixa'), c.id, {
      // o valor no relatório da ficha vem do app: pede para redesenhar
      aoMudar: () => { const e = ui()?.estado; if (e) e.assinatura = ''; },
    });
  }

  window.SintoniaProdutosLead = { montar, ficha, recarregarFicha: () => blocoFicha?.recarregar() };
})();
