/* Scripts de venda (Vendas › Scripts): roteiros prontos por etapa do funil, para copiar na conversa.
 * Registra window.SintoniaTelas.scripts = { desenhar(caixa, ui) }. Servidor: /api/scripts (src/reunioes/reunioes.ts).
 * Reaproveita o visual da tela de Agendamento online (classes rn-*, de /telas/reunioes.js). */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .sc-texto { white-space: pre-wrap; font-size: 14px; line-height: 1.5; margin: 0; color: var(--texto); }
  .sc-etapa { font-size: 12px; font-weight: 700; color: var(--sub); text-transform: uppercase; letter-spacing: .04em; margin: 6px 2px 0; }
  `;
  let ui, caixa;
  async function desenhar(c, u) {
    ui = u; caixa = c;
    window.SintoniaTelas.reunioes?.css?.();
    if (!document.getElementById('sc-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'sc-css', textContent: CSS }));
    const el = ui.el;
    caixa.replaceChildren(el('p', { class: 'rn-vazio', text: 'Carregando…' }));
    let d;
    try { d = await ui.api('/api/scripts'); } catch (e) { caixa.replaceChildren(el('p', { class: 'rn-vazio', text: e.message })); return; }
    const grupos = new Map();
    for (const s of d.scripts) { const k = s.etapa || 'Geral'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(s); }
    const blocos = [...grupos].map(([etapa, lista]) => el('div', { style: 'display:grid;gap:10px' }, el('p', { class: 'sc-etapa', text: etapa }), ...lista.map((s) => el('div', { class: 'rn-link' },
      el('div', { class: 'rn-link-cab' }, el('b', { text: s.titulo })),
      el('p', { class: 'sc-texto', text: s.texto }),
      el('div', { class: 'rn-acoes' },
        el('button', { class: 'rn-bt forte', type: 'button', text: 'Copiar', onclick: async () => { try { await navigator.clipboard.writeText(s.texto); ui.toast('Script copiado.'); } catch { ui.toast('Não deu para copiar.'); } } }),
        el('button', { class: 'rn-bt', type: 'button', text: 'Editar', onclick: () => editar(s) }),
        el('button', { class: 'rn-bt perigo', type: 'button', text: 'Apagar', onclick: async () => { if (!confirm(`Apagar o script "${s.titulo}"?`)) return; await ui.api(`/api/scripts/${s.id}`, { method: 'DELETE' }); desenhar(caixa, ui); } }))))));
    caixa.replaceChildren(el('div', { class: 'rn' },
      el('div', { class: 'rn-topo' }, el('div', {}, el('h1', { text: 'Scripts de venda' }), el('p', { text: 'Roteiros prontos para cada etapa do atendimento. A equipe copia e usa na conversa.' })),
        el('button', { class: 'rn-bt forte', type: 'button', text: '+ Novo script', onclick: () => editar(null) })),
      el('section', { class: 'rn-cartao' }, ...(blocos.length ? blocos : [el('p', { class: 'rn-vazio', text: 'Nenhum script ainda. Crie o primeiro, como "Primeiro contato" ou "Quebra de objeção de preço".' })]))));
  }
  function editar(s) {
    const el = ui.el;
    const etapas = Object.values(ui.NOME_ETAPA || {});
    const titulo = el('input', { value: s?.titulo || '', maxlength: '100', placeholder: 'Ex.: Primeiro contato' });
    const etapa = el('input', { value: s?.etapa || '', maxlength: '60', placeholder: 'Ex.: Em conversa', list: 'sc-etapas' });
    const lista = el('datalist', { id: 'sc-etapas' }, ...etapas.map((e) => el('option', { value: e })));
    const texto = el('textarea', { rows: '8', maxlength: '6000', placeholder: 'Oi {nome}! Tudo bem? …' }); texto.value = s?.texto || '';
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
