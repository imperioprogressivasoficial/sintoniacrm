/* perdas-saude: motivo de perda obrigatório no Pipeline. Registra window.SintoniaPerda:
 *   pedir(info)        abre a folha "Por que foi perdida?" e devolve { motivo, detalhe } ou null (cancelou).
 *                      Chamado pelo api() do app.html quando o servidor responde 409 { codigo: 'motivo_perda' }:
 *                      vale para qualquer tela que mova o cartão (Pipeline nos 3 modos, celular, ficha, ações em massa).
 *                      Pedidos ao mesmo tempo (mover vários leads de uma vez) dividem a mesma pergunta.
 *   selo(perda)        selo pequeno "Perdida · Preço" para o cartão (texto sempre por textContent).
 *   linha(perda)       bloco "Motivo da perda" para a ficha do lead.
 *   editarMotivos(ui)  folha da gestão para mudar a lista de motivos da empresa (PUT /api/perdas/motivos).
 * Claro e escuro pelas variáveis do app; sem animação em loop.
 */
(() => {
  const CSS = `
  dialog.pd-folha { width: min(480px, 100vw); color: var(--texto); max-height: 92dvh; overflow: auto; }
  @media (max-width: 760px) { .pd-lista { gap: 6px; } .pd-op { min-height: 44px; } .pd-texto { min-height: 60px; } }
  .pd-folha h2 { font-size: 18px; font-weight: 800; margin: 0; text-align: center; }
  .pd-folha .pd-sub { margin: 2px 0 12px; text-align: center; font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .pd-lista { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; border: 0; }
  .pd-op { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 14px; border-radius: 16px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); cursor: pointer; font-size: 15.5px; font-weight: 600; }
  .pd-op input { position: absolute; opacity: 0; pointer-events: none; }
  .pd-op i { width: 20px; height: 20px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 2px var(--sub); display: grid; place-items: center; }
  .pd-op:has(input:checked) { box-shadow: inset 0 0 0 2px #106ebe; }
  html[data-tema="escuro"] .pd-op:has(input:checked) { box-shadow: inset 0 0 0 2px #3aa0ff; }
  .pd-op:has(input:checked) i { background: linear-gradient(135deg, #106ebe, #3aa0ff); box-shadow: none; }
  .pd-op:has(input:checked) i::after { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #fff; }
  .pd-op:has(input:focus-visible) { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; }
  .pd-texto { width: 100%; box-sizing: border-box; min-height: 76px; resize: vertical; border: 0; border-radius: 14px; padding: 12px 14px; font: inherit; font-size: 16px; color: var(--texto); background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .pd-texto:focus { outline: 2px solid #106ebe; outline-offset: 1px; }
  .pd-rot { display: block; font-size: 13px; font-weight: 700; color: var(--sub); margin: 0 0 6px 2px; }
  .pd-erro { color: #d93636; font-size: 13.5px; font-weight: 700; min-height: 18px; margin: 6px 2px 0; }
  html[data-tema="escuro"] .pd-erro { color: #ff8a80; }
  .pd-acoes { display: grid; grid-template-columns: 1fr 1.4fr; gap: 10px; margin-top: 12px; position: sticky; bottom: 0; padding: 10px 0 2px; background: var(--fundo); }
  .pd-bt { all: unset; box-sizing: border-box; cursor: pointer; min-height: 48px; border-radius: 999px; display: grid; place-items: center; font-weight: 800; font-size: 15px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); color: var(--texto); text-align: center; padding: 0 14px; }
  .pd-bt.principal { background: linear-gradient(90deg, #106ebe, #3aa0ff); color: #fff; box-shadow: none; }
  .pd-bt[aria-disabled="true"] { opacity: .55; cursor: default; }
  .pd-bt:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; }
  .pd-selo { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-width: 0; font-size: 11.5px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, #ff7a59 14%, transparent); color: #b5401f; }
  html[data-tema="escuro"] .pd-selo { color: #ffab94; background: color-mix(in srgb, #ff7a59 20%, transparent); }
  .pd-selo svg { width: 12px; height: 12px; flex: none; }
  .pd-selo span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pd-ficha { display: grid; gap: 3px; padding: 10px 12px; border-radius: 14px; background: color-mix(in srgb, #ff7a59 10%, var(--vidro-item, var(--painel))); font-size: 13.5px; }
  .pd-ficha b { font-size: 14px; }
  .pd-ficha small { color: var(--sub); }
  .pd-cfg { display: grid; gap: 8px; margin-bottom: 10px; max-height: min(56vh, 460px); overflow: auto; padding: 2px; }
  .pd-cfg-l { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 14px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .pd-cfg-l input[type="text"] { min-width: 0; border: 0; background: transparent; font: inherit; font-size: 15.5px; color: var(--texto); padding: 8px 4px; }
  .pd-cfg-l input[type="text"]:focus { outline: 2px solid #106ebe; border-radius: 8px; }
  .pd-cfg-l label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--sub); font-weight: 700; }
  .pd-cfg-l input[type="checkbox"] { width: 20px; height: 20px; accent-color: #106ebe; }
  `;
  const IC = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  const el = (tag, props = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v; // só ícones fixos daqui
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const f of filhos) if (f != null) e.append(f);
    return e;
  };
  function estilo() {
    if (document.getElementById('estilo-perdas')) return;
    const st = document.createElement('style');
    st.id = 'estilo-perdas';
    st.textContent = CSS;
    document.head.append(st);
  }
  const ui = () => window.Sintonia?.ui;
  const toast = (t) => ui()?.toast?.(t);

  // ---------------------------------------------------------------- pergunta
  /** Folha com a lista de motivos. Devolve { motivo, detalhe } ou null. */
  function folha(info, varios) {
    estilo();
    return new Promise((resolver) => {
      const motivos = Array.isArray(info.motivos) && info.motivos.length ? info.motivos : [{ id: 'outro', nome: 'Outro', pedeTexto: true }];
      const d = el('dialog', { class: 'folha pd-folha', 'aria-labelledby': 'pd-titulo' });
      let resposta = null;
      const nome = info.cliente ? String(info.cliente).split(/\s+/)[0] : '';
      const titulo = varios ? 'Por que perdemos estes leads?' : nome ? `Por que perdemos ${nome}?` : 'Por que perdemos este lead?';
      const lista = el('fieldset', { class: 'pd-lista' }, el('legend', { class: 'pd-rot', text: 'Motivo' }));
      const texto = el('textarea', { class: 'pd-texto', id: 'pd-detalhe', maxlength: '300', placeholder: 'Conte em poucas palavras (opcional)' });
      const rotTexto = el('label', { class: 'pd-rot', for: 'pd-detalhe', text: 'Detalhe' });
      const erro = el('div', { class: 'pd-erro', role: 'alert', text: info.status === 400 && info.erro ? info.erro : '' });
      const escolhido = () => motivos.find((m) => m.id === lista.querySelector('input:checked')?.value);
      const pedeTexto = () => { const m = escolhido(); return Boolean(m && (m.pedeTexto || m.id === 'outro')); };
      const salvar = el('button', { class: 'pd-bt principal', type: 'button', 'aria-disabled': 'true', text: varios ? 'Salvar e mover todos' : 'Salvar e mover' });
      const atualizar = () => {
        const m = escolhido();
        texto.placeholder = pedeTexto() ? 'Obrigatório: conte o motivo em poucas palavras' : 'Conte em poucas palavras (opcional)';
        rotTexto.textContent = pedeTexto() ? 'Detalhe (obrigatório)' : 'Detalhe';
        salvar.setAttribute('aria-disabled', String(!m || (pedeTexto() && texto.value.trim().length < 2)));
      };
      motivos.forEach((m, i) => {
        const r = el('input', { type: 'radio', name: 'pd-motivo', value: m.id, id: `pd-m-${i}` });
        r.addEventListener('change', () => { erro.textContent = ''; atualizar(); if (pedeTexto()) texto.focus(); });
        lista.append(el('label', { class: 'pd-op', for: `pd-m-${i}` }, r, el('i', { 'aria-hidden': 'true' }), el('span', { text: m.nome })));
      });
      texto.addEventListener('input', atualizar);
      const fechar = () => d.close();
      salvar.addEventListener('click', () => {
        const m = escolhido();
        if (!m) { erro.textContent = 'Escolha um motivo.'; return; }
        const detalhe = texto.value.trim();
        if (pedeTexto() && detalhe.length < 2) { erro.textContent = `Em “${m.nome}”, escreva o motivo.`; texto.focus(); return; }
        resposta = { motivo: m.id, ...(detalhe ? { detalhe: detalhe.slice(0, 300) } : {}) };
        fechar();
      });
      d.append(
        el('div', { class: 'folha-topo' }, el('span'), el('h2', { id: 'pd-titulo', text: titulo }),
          el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Cancelar', html: IC.fechar, onclick: fechar })),
        el('p', { class: 'pd-sub', text: `Para ir para “${info.etapa || 'Perdida'}”, conte o motivo. Ele aparece no cartão e no relatório de perdas.` }),
        lista, rotTexto, texto, erro,
        el('div', { class: 'pd-acoes' }, el('button', { class: 'pd-bt', type: 'button', text: 'Cancelar', onclick: fechar }), salvar));
      d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
      d.addEventListener('close', () => { d.remove(); resolver(resposta); });
      document.body.append(d);
      d.showModal();
      requestAnimationFrame(() => lista.querySelector('input')?.focus());
    });
  }

  // Pedidos ao mesmo tempo (mover vários de uma vez) dividem a mesma folha; a resposta ainda vale por 3 s para os
  // que chegarem logo depois (o próximo lote), só quando a folha foi de vários.
  let emAberto = null;
  let ultima = null;
  async function pedir(info = {}) {
    const chave = String(info.etapa || '');
    if (ultima && ultima.chave === chave && ultima.varios && Date.now() - ultima.em < 3000) return ultima.resposta;
    if (emAberto && emAberto.chave === chave) { emAberto.varios = true; return emAberto.promessa; }
    const atual = { chave, varios: false, promessa: null };
    // Espera um instante: os outros pedidos do mesmo lote chegam e a folha já abre dizendo "estes leads".
    atual.promessa = new Promise((r) => setTimeout(r, 60)).then(() => folha(info, atual.varios));
    emAberto = atual;
    try {
      const resposta = await atual.promessa;
      ultima = resposta ? { chave, varios: atual.varios, resposta, em: Date.now() } : null;
      return resposta;
    } finally {
      if (emAberto === atual) emAberto = null;
    }
  }

  // ---------------------------------------------------------------- cartão e ficha
  function selo(perda) {
    if (!perda || !perda.nome) return null;
    estilo();
    const t = perda.detalhe && perda.motivo === 'outro' ? perda.detalhe : perda.nome;
    return el('span', { class: 'pd-selo', title: `Motivo da perda: ${perda.nome}${perda.detalhe ? ` — ${perda.detalhe}` : ''}` }, el('span', { html: IC.x, style: 'display:grid' }), el('span', { text: t }));
  }
  function linha(perda) {
    if (!perda || !perda.nome) return null;
    estilo();
    const quando = perda.em ? new Date(perda.em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '';
    return el('div', { class: 'pd-ficha', role: 'group', 'aria-label': 'Motivo da perda' },
      el('small', { text: 'Motivo da perda' }),
      el('b', { text: perda.nome }),
      perda.detalhe ? el('span', { text: perda.detalhe }) : null,
      el('small', { text: [perda.automatico ? 'Automático' : `Por ${perda.por || 'equipe'}`, quando].filter(Boolean).join(' · ') }));
  }

  // ---------------------------------------------------------------- lista de motivos (gestão)
  async function editarMotivos(u = ui(), aoSalvar) {
    estilo();
    let cfg;
    try { cfg = await u.api('/api/perdas/motivos'); } catch (x) { toast(x.message); return; }
    if (!cfg.podeEditar) { toast('Só a gestão muda a lista de motivos.'); return; }
    const linhas = cfg.motivos.map((m) => ({ ...m }));
    const d = el('dialog', { class: 'folha pd-folha', 'aria-labelledby': 'pd-cfg-t' });
    const caixa = el('div', { class: 'pd-cfg' });
    const erro = el('div', { class: 'pd-erro', role: 'alert' });
    const desenhar = () => {
      caixa.replaceChildren(...linhas.map((m, i) => {
        const nome = el('input', { type: 'text', value: m.nome, maxlength: '60', 'aria-label': `Nome do motivo ${i + 1}` });
        nome.addEventListener('input', () => { m.nome = nome.value; });
        const ativo = el('input', { type: 'checkbox' }); ativo.checked = m.ativo !== false;
        ativo.addEventListener('change', () => { m.ativo = ativo.checked; });
        const fixo = m.id === 'outro';
        if (fixo) ativo.disabled = true;
        return el('div', { class: 'pd-cfg-l' }, nome, el('label', { title: fixo ? '“Outro” sempre aparece e pede um texto' : 'Aparece para escolher' }, ativo, fixo ? 'sempre' : 'usar'));
      }));
    };
    const novo = el('button', { class: 'pd-bt', type: 'button', text: '+ Novo motivo', onclick: () => {
      if (linhas.length >= 20) { erro.textContent = 'No máximo 20 motivos.'; return; }
      const base = 'motivo_' + Date.now().toString(36);
      linhas.splice(Math.max(0, linhas.length - 1), 0, { id: base, nome: '', ativo: true, pedeTexto: false });
      desenhar();
      caixa.querySelectorAll('input[type="text"]')[Math.max(0, linhas.length - 2)]?.focus();
    } });
    const salvar = el('button', { class: 'pd-bt principal', type: 'button', text: 'Salvar', onclick: async () => {
      const motivos = linhas.filter((m) => m.nome.trim()).map((m) => ({ id: m.id, nome: m.nome.trim(), ativo: m.ativo !== false, pedeTexto: Boolean(m.pedeTexto) }));
      try { await u.api('/api/perdas/motivos', { method: 'PUT', body: JSON.stringify({ motivos }) }); toast('Motivos de perda salvos ✓'); d.close(); aoSalvar?.(); }
      catch (x) { erro.textContent = x.message; }
    } });
    d.append(
      el('div', { class: 'folha-topo' }, el('span'), el('h2', { id: 'pd-cfg-t', text: 'Motivos de perda' }), el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: IC.fechar, onclick: () => d.close() })),
      el('p', { class: 'pd-sub', text: 'O que a equipe escolhe ao mover um lead para uma etapa de perda. Desmarque para esconder sem perder o histórico.' }),
      caixa, novo, erro, el('div', { class: 'pd-acoes' }, el('button', { class: 'pd-bt', type: 'button', text: 'Cancelar', onclick: () => d.close() }), salvar));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => d.remove());
    desenhar();
    document.body.append(d);
    d.showModal();
  }

  window.SintoniaPerda = { pedir, selo, linha, editarMotivos };
})();
