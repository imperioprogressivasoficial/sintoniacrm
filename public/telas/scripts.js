/* Scripts de venda (Vendas › Scripts): roteiros prontos por etapa do funil, para copiar na conversa.
 * Registra window.SintoniaTelas.scripts = { desenhar(caixa, ui) }. Servidor: /api/scripts (src/reunioes/reunioes.ts).
 * Reaproveita o visual da tela de Agendamento online (classes rn-*, de /telas/reunioes.js).
 * layout-telas: no computador, etapas à esquerda (filtro) e os scripts em grade de cartões à direita, com busca
 * e "Copiar" num clique. No celular, as etapas viram uma faixa de chips que rola de lado. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .sc-texto { white-space: pre-wrap; font-size: 14px; line-height: 1.5; margin: 0; color: var(--texto); }
  .sc-busca { display: flex; align-items: center; gap: 10px; min-height: 46px; border-radius: 16px; padding: 0 14px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .sc-busca svg { width: 18px; height: 18px; flex: none; color: var(--sub); }
  .sc-busca input { all: unset; flex: 1; min-width: 0; font-size: 15px; color: var(--texto); }
  .sc-busca input::placeholder { color: var(--sub); }
  .sc-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  .sc-etapas { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px; margin: 0 -2px; }
  .sc-etapas::-webkit-scrollbar { display: none; }
  .sc-et { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 14px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; }
  .sc-et small { font-size: 12px; font-weight: 700; color: var(--sub); }
  .sc-et[aria-pressed="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: none; }
  .sc-et[aria-pressed="true"] small { color: rgba(255,255,255,.85); }
  .sc-et:focus-visible, .sc-copiar:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .sc-cartoes { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); align-items: start; }
  .sc-cartao { display: grid; gap: 10px; padding: 16px; border-radius: 20px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); min-width: 0; }
  .sc-cartao-cab { display: flex; align-items: flex-start; gap: 10px; }
  .sc-cartao-cab b { flex: 1; min-width: 0; font-size: 15.5px; line-height: 1.3; }
  .sc-selo { flex: none; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; color: var(--texto); background: color-mix(in srgb, #106ebe 12%, transparent); white-space: nowrap; max-width: 45%; overflow: hidden; text-overflow: ellipsis; }
  html[data-tema="escuro"] .sc-selo { background: color-mix(in srgb, #3aa0ff 22%, transparent); }
  .sc-cartao .sc-texto { display: -webkit-box; -webkit-line-clamp: 9; -webkit-box-orient: vertical; overflow: hidden; }
  .sc-cartao.aberto .sc-texto { display: block; }
  .sc-mais { all: unset; cursor: pointer; justify-self: start; font-size: 13px; font-weight: 700; color: var(--marca-azul); }
  html[data-tema="escuro"] .sc-mais { color: var(--marca-menta); }
  .sc-pe { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
  .sc-pe .rn-bt { padding: 7px 12px; }
  .sc-copiar { margin-right: auto; }
  .sc-copiar.ok { background: linear-gradient(135deg, #0aa57f, #0fd6a3); box-shadow: none; }
  .sc-vazio { display: grid; gap: 12px; }
  .sc-vazio .sc-cartoes { grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); }
  .sc-modelo { display: grid; gap: 8px; padding: 16px; border-radius: 20px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); border: 1.5px dashed var(--vidro-borda); }
  .sc-modelo b { font-size: 15px; }
  .sc-modelo p { margin: 0; font-size: 13.5px; color: var(--sub); line-height: 1.45; white-space: pre-wrap; }
  @media (min-width: 1000px) {
    .sc-grade { grid-template-columns: 240px minmax(0, 1fr); }
    .sc-etapas { flex-direction: column; overflow: visible; position: sticky; top: 0; padding: 10px; margin: 0; border-radius: 20px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); }
    .sc-et { justify-content: space-between; border-radius: 12px; background: none; box-shadow: none; min-height: 40px; }
    .sc-et:hover { background: var(--sel); }
    .sc-et span { overflow: hidden; text-overflow: ellipsis; }
    .sc-etapas-tit { font-size: 11.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--sub); margin: 4px 14px 6px; }
  }
  @media (max-width: 999px) { .sc-etapas-tit { display: none; } }
  `;
  const MODELOS = [
    ['Primeiro contato', 'Novo lead', 'Oi, {nome}! Tudo bem? Aqui é {atendente}. Vi que você se interessou pelo nosso serviço. Posso te fazer duas perguntas rápidas para te indicar a melhor opção?'],
    ['Quebra de objeção de preço', 'Em conversa', 'Entendo, {nome}! O valor inclui tudo o que conversamos e você pode parcelar. Quer que eu reserve um horário para você conhecer sem compromisso?'],
    ['Confirmação de horário', 'Agendada', 'Oi, {nome}! Passando para confirmar o seu horário. Posso confirmar? Se precisar mudar, é só me avisar por aqui.'],
    ['Retomar quem sumiu', 'Interessada', 'Oi, {nome}! Ficou alguma dúvida? Estou por aqui para te ajudar a escolher o melhor horário.'],
  ];
  const IC_BUSCA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  let ui, caixa;
  const est = { etapa: '', busca: '' };

  async function copiar(texto, botao) {
    try { await navigator.clipboard.writeText(texto); } catch { ui.toast('Não deu para copiar aqui. Selecione o texto e copie.'); return; }
    if (botao) { botao.textContent = 'Copiado ✓'; botao.classList.add('ok'); setTimeout(() => { botao.textContent = 'Copiar'; botao.classList.remove('ok'); }, 1600); }
    ui.toast('Script copiado. Cole na conversa.');
  }

  async function desenhar(c, u) {
    ui = u; caixa = c;
    window.SintoniaTelas.reunioes?.css?.();
    if (!document.getElementById('sc-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'sc-css', textContent: CSS }));
    const el = ui.el;
    caixa.replaceChildren(el('p', { class: 'rn-vazio', text: 'Carregando…' }));
    let d;
    try { d = await ui.api('/api/scripts'); } catch (e) { caixa.replaceChildren(el('p', { class: 'rn-vazio', text: e.message })); return; }
    const scripts = d.scripts;
    // Etapas na ordem do funil; as que não são do funil vêm depois; "Geral" (sem etapa) por último.
    const ordemFunil = Object.values(ui.NOME_ETAPA || {});
    const contagem = new Map();
    for (const s of scripts) { const k = s.etapa || 'Geral'; contagem.set(k, (contagem.get(k) || 0) + 1); }
    const etapas = [...contagem.keys()].sort((a, b) => {
      const pa = a === 'Geral' ? 1e4 : ordemFunil.indexOf(a) < 0 ? 1e3 : ordemFunil.indexOf(a);
      const pb = b === 'Geral' ? 1e4 : ordemFunil.indexOf(b) < 0 ? 1e3 : ordemFunil.indexOf(b);
      return pa - pb || a.localeCompare(b);
    });
    if (est.etapa && !contagem.has(est.etapa)) est.etapa = '';

    const novo = el('button', { class: 'rn-bt forte', type: 'button', text: '+ Novo script', onclick: () => editar(null) });
    const topo = el('div', { class: 'rn-topo' }, el('div', {}, el('h1', { text: 'Scripts de venda' }), el('p', { text: 'Roteiros prontos para cada etapa do atendimento. A equipe copia e usa na conversa.' })), novo);

    if (!scripts.length) {
      const modelos = MODELOS.map(([titulo, etapa, texto]) => el('div', { class: 'sc-modelo' },
        el('div', { class: 'sc-cartao-cab' }, el('b', { text: titulo }), el('span', { class: 'sc-selo', text: etapa })),
        el('p', { text: texto }),
        el('div', { class: 'sc-pe' }, el('button', { class: 'rn-bt', type: 'button', text: 'Usar este modelo', onclick: () => editar(null, { titulo, etapa, texto }) }))));
      caixa.replaceChildren(el('div', { class: 'rn' }, topo,
        el('section', { class: 'rn-cartao sc-vazio' },
          el('h2', { text: 'Comece por um modelo' }),
          el('p', { class: 'rn-vazio', text: 'Nenhum script ainda. Escolha um modelo para adaptar ao seu jeito, ou crie do zero em "+ Novo script". Ao usar, troque o que está entre chaves (como {nome}) pelo nome do contato.' }),
          el('div', { class: 'sc-cartoes' }, ...modelos))));
      return;
    }

    const lista = el('div', { class: 'sc-cartoes', role: 'list' });
    const contador = el('p', { class: 'rn-vazio', 'aria-live': 'polite' });
    const botoesEtapa = [];
    const marcar = () => botoesEtapa.forEach(([b, k]) => b.setAttribute('aria-pressed', String(k === est.etapa)));
    const desenharLista = () => {
      const q = est.busca.trim().toLowerCase();
      const vis = scripts.filter((s) => (!est.etapa || (s.etapa || 'Geral') === est.etapa) && (!q || `${s.titulo} ${s.texto} ${s.etapa || ''}`.toLowerCase().includes(q)));
      contador.textContent = vis.length === scripts.length ? `${scripts.length} ${scripts.length === 1 ? 'script' : 'scripts'}` : `${vis.length} de ${scripts.length} scripts`;
      if (!vis.length) { lista.replaceChildren(el('p', { class: 'rn-vazio', text: 'Nenhum script com esse filtro.' })); return; }
      lista.replaceChildren(...vis.map((s) => {
        const bCopiar = el('button', { class: 'rn-bt forte sc-copiar', type: 'button', text: 'Copiar', title: 'Copiar o texto para colar na conversa' });
        bCopiar.addEventListener('click', () => copiar(s.texto, bCopiar));
        const cartao = el('article', { class: 'sc-cartao', role: 'listitem' },
          el('div', { class: 'sc-cartao-cab' }, el('b', { text: s.titulo }), el('span', { class: 'sc-selo', text: s.etapa || 'Geral' })),
          el('p', { class: 'sc-texto', text: s.texto }));
        // "Ver tudo" só quando o texto passa do limite de linhas.
        const mais = el('button', { class: 'sc-mais', type: 'button', text: 'Ver tudo', hidden: '' });
        mais.addEventListener('click', () => { const ab = cartao.classList.toggle('aberto'); mais.textContent = ab ? 'Ver menos' : 'Ver tudo'; });
        cartao.append(mais, el('div', { class: 'sc-pe' }, bCopiar,
          el('button', { class: 'rn-bt', type: 'button', text: 'Editar', onclick: () => editar(s) }),
          el('button', { class: 'rn-bt perigo', type: 'button', text: 'Apagar', onclick: async () => { if (!confirm(`Apagar o script "${s.titulo}"?`)) return; await ui.api(`/api/scripts/${s.id}`, { method: 'DELETE' }); desenhar(caixa, ui); } })));
        requestAnimationFrame(() => { const t = cartao.querySelector('.sc-texto'); if (t && t.scrollHeight > t.clientHeight + 2) mais.hidden = false; });
        return cartao;
      }));
    };
    const botaoEtapa = (k, rot, n) => { const b = el('button', { class: 'sc-et', type: 'button', 'aria-pressed': 'false', onclick: () => { est.etapa = k; marcar(); desenharLista(); } }, el('span', { text: rot }), el('small', { text: String(n) })); botoesEtapa.push([b, k]); return b; };
    const busca = el('input', { type: 'search', placeholder: 'Buscar script por título ou texto', 'aria-label': 'Buscar script' });
    busca.value = est.busca;
    busca.addEventListener('input', () => { est.busca = busca.value; desenharLista(); });

    caixa.replaceChildren(el('div', { class: 'rn' }, topo,
      el('div', { class: 'sc-grade' },
        el('nav', { class: 'sc-etapas', 'aria-label': 'Etapas' }, el('p', { class: 'sc-etapas-tit', text: 'Etapas' }),
          botaoEtapa('', 'Todas', scripts.length), ...etapas.map((k) => botaoEtapa(k, k, contagem.get(k)))),
        el('div', { style: 'display:grid;gap:12px;min-width:0' },
          el('label', { class: 'sc-busca', html: IC_BUSCA }, busca), contador, lista))));
    marcar(); desenharLista();
  }

  function editar(s, modelo) {
    const el = ui.el;
    const base = s || modelo || null;
    const etapas = Object.values(ui.NOME_ETAPA || {});
    const titulo = el('input', { value: base?.titulo || '', maxlength: '100', placeholder: 'Ex.: Primeiro contato' });
    const etapa = el('input', { value: base?.etapa || '', maxlength: '60', placeholder: 'Ex.: Em conversa', list: 'sc-etapas' });
    const lista = el('datalist', { id: 'sc-etapas' }, ...etapas.map((e) => el('option', { value: e })));
    const texto = el('textarea', { rows: '8', maxlength: '6000', placeholder: 'Oi {nome}! Tudo bem? …' }); texto.value = base?.texto || '';
    const erro = el('p', { class: 'rn-erro', role: 'alert', hidden: '' });
    const d = el('dialog', { class: 'rn-d' });
    const form = el('form', { class: 'rn-form' },
      el('h2', { text: s ? 'Editar script' : 'Novo script', style: 'margin:0' }),
      el('label', {}, document.createTextNode('Título'), titulo),
      el('label', {}, document.createTextNode('Etapa (opcional)'), etapa, lista),
      el('label', {}, document.createTextNode('Texto'), texto), erro,
      el('div', { class: 'rn-acoes', style: 'justify-content:flex-end' }, el('button', { class: 'rn-bt', type: 'button', text: 'Cancelar', onclick: () => d.close() }), el('button', { class: 'rn-bt forte', type: 'submit', text: 'Salvar' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.hidden = true;
      const corpo = { titulo: titulo.value, etapa: etapa.value, texto: texto.value, ordem: s?.ordem ?? 0 };
      try {
        if (s) await ui.api(`/api/scripts/${s.id}`, { method: 'PUT', body: JSON.stringify(corpo) }); else await ui.post('/api/scripts', corpo);
        d.close(); desenhar(caixa, ui);
      } catch (x) { erro.textContent = x.message; erro.hidden = false; }
    });
    d.append(form); document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal(); titulo.focus();
  }
  window.SintoniaTelas.scripts = { desenhar };
})();
