/* trocar-numero: Conversas › "Arquivadas do número antigo" — window.SintoniaArquivadasNumero.
 * Quando a loja troca o WhatsApp de um canal e escolhe "Arquivar" (Conexões), as conversas do número anterior
 * saem da lista de todo mundo. Aqui aparece um filtro discreto no fim dos filtros (só quando existe alguma),
 * que abre a lista delas: tocar abre a conversa (só para consultar); a gestão pode desarquivar uma ou todas.
 * Servidor: GET /api/conversas/arquivadas-numero e POST /api/conversas/desarquivar-numero
 * (src/conversa/arquivadas-numero.ts). Texto do servidor entra sempre por textContent. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, post, el, toast, formatarTel, horaLista } = ui;

  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const SVG = {
    arquivo: ic('<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M10 12.5h4"/>'),
    desarquivar: ic('<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M12 17.5v-6M9.5 14 12 11.5 14.5 14"/>'),
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  document.head.append(el('style', { id: 'an-css', text: `
  #filtros .chip.an-chip { gap: 6px; color: var(--sub); }
  #filtros .chip.an-chip svg { width: 15px; height: 15px; flex: none; }
  #filtros .chip.an-chip[hidden] { display: none; }
  .an-folha .an-sub { margin: -2px 4px 12px; font-size: 14px; line-height: 1.45; color: var(--sub); text-align: center; }
  .an-lista { background: var(--painel); border-radius: 18px; overflow: hidden; max-height: min(58vh, 560px); overflow-y: auto; }
  .an-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 14px; border-bottom: 1px solid var(--linha); }
  .an-item:last-child { border-bottom: 0; }
  .an-abrir { all: unset; cursor: pointer; flex: 1; min-width: 0; display: grid; gap: 2px; }
  .an-abrir:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; border-radius: 8px; }
  .an-abrir b { font-size: 16px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-abrir small { font-size: 13px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-des { all: unset; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--texto); background: var(--fundo); box-shadow: inset 0 0 0 1px var(--linha); }
  .an-des svg { width: 16px; height: 16px; }
  .an-des[aria-busy="true"] { opacity: .5; pointer-events: none; }
  .an-rodape { display: flex; gap: 8px; justify-content: center; margin-top: 12px; flex-wrap: wrap; }
  .an-vazio { padding: 22px 16px; text-align: center; color: var(--sub); font-size: 14px; }
  @media (max-width: 760px) { .an-des span { display: none; } .an-des { padding: 9px; } }
  ` }));

  let total = 0, mais = false, pode = false;
  const chip = el('button', { class: 'chip an-chip', type: 'button', 'aria-pressed': 'false', title: 'Conversas do número antigo que a empresa arquivou', html: SVG.arquivo });
  const rotulo = el('span', { text: 'Arquivadas do número antigo' });
  const qtd = el('span', { class: 'qtd' });
  chip.append(rotulo, qtd);
  chip.hidden = true;
  chip.addEventListener('click', abrirFolha);

  function pintar() {
    chip.hidden = !total;
    qtd.textContent = total ? (mais ? `${total}+` : String(total)) : '';
    const f = document.getElementById('filtros');
    if (f && chip.parentNode !== f) f.append(chip);
  }

  async function contar() {
    try {
      const r = await api('/api/conversas/arquivadas-numero?limite=100');
      total = r.conversas.length; mais = Boolean(r.proximo); pode = Boolean(r.podeDesarquivar);
    } catch { total = 0; }
    pintar();
  }

  const nomeDe = (c) => c.nome || formatarTel(c.telefone);
  function linha(c, aoMudar) {
    const abrir = el('button', { type: 'button', class: 'an-abrir', onclick: () => { fechar(); ui.abrir(c.id); } },
      el('b', { text: nomeDe(c) }),
      el('small', { text: [c.nome ? formatarTel(c.telefone) : '', c.ultima ? `${horaLista(c.ultima.em)}: ${c.ultima.texto}` : ''].filter(Boolean).join(' · ') }));
    const item = el('div', { class: 'an-item' }, abrir);
    if (pode) {
      const b = el('button', { type: 'button', class: 'an-des', title: 'Desarquivar', 'aria-label': `Desarquivar ${nomeDe(c)}`, html: SVG.desarquivar }, el('span', { text: 'Desarquivar' }));
      b.addEventListener('click', async () => {
        b.setAttribute('aria-busy', 'true');
        try { await post('/api/conversas/desarquivar-numero', { ids: [c.id] }); item.remove(); toast?.('Voltou para a lista de conversas.'); aoMudar(); }
        catch (x) { toast?.(x.message); b.removeAttribute('aria-busy'); }
      });
      item.append(b);
    }
    return item;
  }

  let folha = null;
  const fechar = () => folha?.close();
  async function abrirFolha() {
    folha?.remove();
    folha = el('dialog', { class: 'folha an-folha', id: 'an-folha', 'aria-label': 'Arquivadas do número antigo' });
    const lista = el('div', { class: 'an-lista' }, el('div', { class: 'an-vazio', text: 'Carregando…' }));
    const rodape = el('div', { class: 'an-rodape' });
    folha.append(
      el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: 'Arquivadas do número antigo' }), el('button', { type: 'button', class: 'icone fechar-folha', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })),
      el('p', { class: 'an-sub', text: 'Conversas do número que a loja usava antes. Saíram da lista, do Pipeline e dos relatórios. Voltam sozinhas se a cliente mandar mensagem nova.' }),
      lista, rodape);
    folha.addEventListener('click', (e) => { if (e.target === folha) fechar(); });
    folha.addEventListener('close', () => { const d = folha; setTimeout(() => d?.remove(), 300); contar(); });
    document.body.append(folha);
    folha.showModal();
    let r;
    try { r = await api('/api/conversas/arquivadas-numero?limite=200'); }
    catch (x) { lista.replaceChildren(el('div', { class: 'an-vazio', text: x.message })); return; }
    pode = Boolean(r.podeDesarquivar);
    const vazio = () => { if (!lista.querySelector('.an-item')) { lista.replaceChildren(el('div', { class: 'an-vazio', text: 'Nenhuma conversa arquivada.' })); rodape.replaceChildren(); } };
    const aoMudar = () => { ui.atualizar?.(); vazio(); };
    lista.replaceChildren(...r.conversas.map((c) => linha(c, aoMudar)));
    vazio();
    if (pode && r.conversas.length > 1) {
      const todas = el('button', { type: 'button', class: 'an-des', html: SVG.desarquivar }, el('span', { text: `Desarquivar todas (${r.conversas.length}${r.proximo ? '+' : ''})` }));
      todas.querySelector('span').style.display = 'inline';
      todas.addEventListener('click', async () => {
        if (!confirm('Desarquivar todas? Elas voltam para a lista de conversas de todo mundo.')) return;
        todas.setAttribute('aria-busy', 'true');
        try { await post('/api/conversas/desarquivar-numero', { ids: r.conversas.map((c) => c.id) }); lista.replaceChildren(); aoMudar(); toast?.('Voltaram para a lista de conversas.'); }
        catch (x) { toast?.(x.message); todas.removeAttribute('aria-busy'); }
      });
      rodape.append(todas);
    }
  }

  window.SintoniaArquivadasNumero = { contar, abrir: abrirFolha };
  contar();
  // Confere de novo ao voltar para a aba (outra pessoa pode ter arquivado ou desarquivado).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) contar(); });
})();
