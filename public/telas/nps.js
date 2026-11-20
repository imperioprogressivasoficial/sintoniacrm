/* Tela "nps" da Sintonia: finalizar atendimento, pesquisa de satisfação (NPS) e modelos prontos.
 * Registra window.SintoniaTelas.nps = {
 *   finalizarNaConversa(conversaId, ui, aoFinalizar)  — a folha "Finalizar atendimento" (motivo + pesquisa),
 *   configurar(ui, aoSalvar)                         — a folha de configuração da pesquisa,
 *   prontos(ui, { aoMudar, abrirFollowup })          — o bloco "Prontos para usar" da tela Automações,
 *   corpoPainel(ui, dados, ctx)                      — o corpo do bloco "Satisfação (NPS)" do Dashboard,
 *   painelRelatorio(ui, dados, csv)                  — o painel de NPS nos Relatórios }.
 * Todo texto que vem do servidor entra por textContent (el(..., { text })), nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    fechar: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    estrela: ic('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>'),
    presente: ic('<rect x="3.5" y="8" width="17" height="12.5" rx="2"/><path d="M12 8v12.5M3.5 12.5h17M12 8c-1.5-3.5-5.5-4-5.5-1.5S10 8 12 8Zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 8 12 8Z"/>'),
    regua: ic('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2.5h6"/>'),
    certo: ic('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    baixar: ic('<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/>'),
  };
  const CSS = `
  dialog.np-folha { max-height: 92vh; overflow: auto; }
  .np-corpo { display: grid; gap: 14px; }
  .np-sub { margin: 0; font-size: 14px; line-height: 1.45; color: var(--sub); }
  .np-motivos { display: flex; flex-wrap: wrap; gap: 8px; }
  .np-pill { all: unset; cursor: pointer; box-sizing: border-box; min-height: 40px; padding: 8px 14px; border-radius: 999px; font-size: 14.5px; font-weight: 600; color: var(--texto);
    background: color-mix(in srgb, #106ebe 7%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, #106ebe 28%, transparent); }
  html[data-tema="escuro"] .np-pill { background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,.16); }
  .np-pill[aria-pressed="true"], html[data-tema="escuro"] .np-pill[aria-pressed="true"] { color: #fff; background: linear-gradient(90deg, #106ebe, #3aa0ff); box-shadow: none; }
  .np-pill:focus-visible, .np-botao:focus-visible { outline: 2px solid #0ffcbe; outline-offset: 2px; }
  .np-campo { display: grid; gap: 6px; font-size: 13.5px; color: var(--sub); }
  .np-campo textarea, .np-campo input[type=text], .np-campo input[type=url], .np-campo input[type=number], .np-campo select {
    background: var(--vidro-item, var(--painel)); border: 1px solid var(--vidro-borda, var(--linha)); border-radius: 14px; min-height: 44px; padding: 10px 12px;
    font: inherit; font-size: 16px; color: var(--texto); width: 100%; box-sizing: border-box; }
  .np-campo textarea { min-height: 78px; resize: vertical; line-height: 1.4; }
  .np-linha { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--vidro-item, var(--painel));
    box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); color: var(--texto); font-size: 15px; cursor: pointer; }
  .np-linha span { flex: 1; display: grid; gap: 2px; }
  .np-linha small { color: var(--sub); font-size: 12.5px; line-height: 1.35; }
  .np-linha input[type=checkbox], dialog.np-folha .np-linha input[type=checkbox] { width: 20px; height: 20px; min-height: 0; padding: 0; margin: 0; border-radius: 4px; accent-color: #106ebe; flex: none; }
  .np-acoes { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; position: sticky; bottom: 0; padding-top: 6px; background: var(--fundo); }
  .np-botao { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 20px;
    border-radius: 999px; font-weight: 700; font-size: 14.5px; color: #fff; background: linear-gradient(90deg, #106ebe, #3aa0ff); }
  .np-botao.leve { color: var(--texto); background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .np-botao[disabled] { opacity: .55; cursor: default; }
  .np-botao svg { width: 18px; height: 18px; }
  .np-vars { font-size: 12.5px; color: var(--sub); }
  .np-vars code { font-size: 12px; padding: 1px 5px; border-radius: 6px; background: var(--vidro-item, var(--painel)); }
  .np-hist { font-size: 13px; color: var(--sub); padding: 10px 12px; border-radius: 14px; border: 1px dashed var(--vidro-borda, var(--linha)); }
  .np-erro { color: #c4313b; font-size: 13.5px; min-height: 1em; margin: 0; }
  html[data-tema="escuro"] .np-erro { color: #ff8f94; }
  /* Prontos para usar (tela Automações) */
  .np-prontos { display: grid; gap: 10px; }
  .np-prontos h2 { margin: 4px 0 0; font-size: 15px; font-weight: 750; color: var(--texto); }
  .np-cards { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
  .np-card { position: relative; display: grid; gap: 8px; align-content: start; padding: 16px; border-radius: 22px; background: var(--vidro-fundo, var(--painel));
    border: 1px solid var(--vidro-borda, var(--linha)); overflow: hidden; }
  .np-card::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); opacity: .8; }
  .np-card-cab { display: flex; align-items: center; gap: 10px; }
  .np-card-cab b { flex: 1; font-size: 15.5px; font-weight: 750; }
  .np-ic { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; flex: none; color: #106ebe; background: color-mix(in srgb, #3aa0ff 14%, transparent); }
  html[data-tema="escuro"] .np-ic { color: #0ffcbe; background: rgba(15,252,190,.10); }
  .np-ic svg { width: 18px; height: 18px; }
  .np-card p { margin: 0; font-size: 13.5px; line-height: 1.45; color: var(--sub); }
  .np-card .np-acoes { justify-content: flex-start; position: static; background: none; padding: 0; }
  .np-card .np-botao { min-height: 38px; padding: 0 14px; font-size: 13.5px; }
  .np-selo { justify-self: start; font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; color: var(--sub); background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .np-selo.on { color: #0b6a52; background: rgba(15,252,190,.18); box-shadow: inset 0 0 0 1px rgba(15,252,190,.55); }
  html[data-tema="escuro"] .np-selo.on { color: #0ffcbe; }
  /* Resultado (Dashboard e Relatórios) */
  .np-res { display: grid; gap: 12px; }
  .np-topo { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .np-n { font-size: 40px; font-weight: 800; letter-spacing: -.03em; line-height: 1; color: var(--texto); font-variant-numeric: tabular-nums; }
  .np-n.bom { color: #0b8a6a; } .np-n.ruim { color: #c4313b; }
  html[data-tema="escuro"] .np-n.bom { color: #0ffcbe; } html[data-tema="escuro"] .np-n.ruim { color: #ff8f94; }
  .np-topo small { font-size: 13px; color: var(--sub); }
  .np-faixa { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--vidro-item, var(--painel)); }
  .np-faixa i { display: block; height: 100%; }
  .np-faixa .p { background: linear-gradient(90deg, #0ffcbe, #3aa0ff); } .np-faixa .n { background: #b9c6d3; } .np-faixa .d { background: #e5484d; }
  html[data-tema="escuro"] .np-faixa .n { background: #4a6580; }
  .np-legenda { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); }
  .np-legenda span { display: inline-flex; align-items: center; gap: 6px; }
  .np-legenda i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .np-at { display: grid; gap: 6px; }
  .np-at-l { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px; font-size: 14px; padding: 7px 0; border-bottom: 1px solid var(--vidro-borda, var(--linha)); }
  .np-at-l:last-child { border-bottom: 0; }
  .np-at-l b { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .np-at-l small { color: var(--sub); font-size: 12.5px; }
  .np-at-l strong { font-variant-numeric: tabular-nums; min-width: 42px; text-align: right; }
  .np-coment { display: grid; gap: 8px; }
  .np-coment div { padding: 10px 12px; border-radius: 14px; background: var(--vidro-item, var(--painel)); font-size: 13.5px; line-height: 1.4; }
  .np-coment small { display: block; color: var(--sub); font-size: 12px; margin-top: 3px; }
  .np-vazio { font-size: 13.5px; color: var(--sub); line-height: 1.45; }
  `;
  function estilo() {
    if (document.getElementById('estilo-nps')) return;
    const st = document.createElement('style');
    st.id = 'estilo-nps';
    st.textContent = CSS;
    document.head.append(st);
  }
  const UI = (ui) => ui || window.Sintonia?.ui;
  const VARS = ['{primeiro_nome}', '{nome}', '{atendente}'];

  /** Folha (dialog) no padrão do app: embaixo no celular, no meio no computador. */
  function folha(ui, titulo) {
    estilo();
    const el = ui.el;
    const d = el('dialog', { class: 'folha np-folha', 'aria-label': titulo });
    const corpo = el('div', { class: 'np-corpo' });
    d.append(el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: titulo }), el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: IC.fechar, onclick: () => d.close() })), corpo);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
    return { d, corpo };
  }
  const campo = (ui, rotulo, entrada) => ui.el('label', { class: 'np-campo' }, ui.el('span', { text: rotulo }), entrada);
  function area(ui, valor, max = 800) { const t = ui.el('textarea', { maxlength: String(max) }); t.value = valor || ''; return t; }
  function marca(ui, titulo, sub, marcado) {
    const c = ui.el('input', { type: 'checkbox' });
    c.checked = !!marcado;
    return { c, linha: ui.el('label', { class: 'np-linha' }, c, ui.el('span', {}, ui.el('b', { text: titulo }), sub ? ui.el('small', { text: sub }) : null)) };
  }
  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ---------------------------------------------------------------- finalizar atendimento
  async function finalizarNaConversa(conversaId, uiDado, aoFinalizar) {
    const ui = UI(uiDado);
    if (!conversaId) return;
    let info;
    try { info = await ui.api(`/api/conversas/${conversaId}/finalizar`); } catch (x) { ui.toast(x.message); return; }
    const el = ui.el;
    const { d, corpo } = folha(ui, 'Finalizar atendimento');
    let motivo = '';
    const enviar = marca(ui, 'Enviar a pesquisa de satisfação', 'A cliente recebe no WhatsApp: "De 0 a 10, quanto você recomendaria…?" e pode deixar um comentário.', false);
    const ajustarEnvio = () => { enviar.c.checked = Boolean(info.pesquisa.ligada && info.pesquisa.motivos.includes(motivo)); };
    const pills = el('div', { class: 'np-motivos', role: 'radiogroup', 'aria-label': 'Motivo' }, ...info.motivos.map((m) => {
      const b = el('button', { type: 'button', class: 'np-pill', role: 'radio', 'aria-pressed': 'false', 'aria-checked': 'false', text: m.nome });
      b.onclick = () => { motivo = m.id; pills.querySelectorAll('.np-pill').forEach((x) => { const sim = x === b; x.setAttribute('aria-pressed', String(sim)); x.setAttribute('aria-checked', String(sim)); }); ajustarEnvio(); erro.textContent = ''; };
      return b;
    }));
    const obs = area(ui, '', 500);
    obs.placeholder = 'Opcional: o que foi combinado, valor da venda…';
    const erro = el('p', { class: 'np-erro', role: 'alert' });
    const ultima = (info.pesquisas || [])[0];
    const hist = ultima ? el('div', { class: 'np-hist', text: ultima.nota != null
      ? `Última pesquisa: nota ${ultima.nota}${ultima.comentario ? ` · “${ultima.comentario}”` : ''} (${quando(ultima.respondidaEm || ultima.enviadaEm)})`
      : `Última pesquisa enviada em ${quando(ultima.enviadaEm)}: ${ultima.estado === 'expirada' ? 'sem resposta' : ultima.estado === 'nao_enviada' ? 'não foi enviada' : 'esperando a nota'}` }) : null;
    const ok = el('button', { class: 'np-botao', type: 'button', text: 'Finalizar' });
    ok.onclick = async () => {
      if (!motivo) { erro.textContent = 'Escolha o motivo.'; return; }
      ok.disabled = true;
      try {
        const corpoPedido = { motivo, ...(obs.value.trim() ? { observacao: obs.value.trim() } : {}), ...(info.pesquisa.ligada ? { enviarPesquisa: enviar.c.checked } : {}) };
        const r = await ui.post(`/api/conversas/${conversaId}/finalizar`, corpoPedido);
        d.close();
        ui.toast(r.aviso || (r.pesquisa?.estado === 'aguardando_nota' ? 'Atendimento finalizado. A pesquisa foi enviada ✓' : 'Atendimento finalizado ✓'));
        if (aoFinalizar) aoFinalizar(r); else ui.atualizar?.();
      } catch (x) { erro.textContent = x.message; ok.disabled = false; }
    };
    corpo.append(
      el('p', { class: 'np-sub', text: 'Encerra este atendimento e registra o motivo. Os resultados aparecem no Dashboard e nos Relatórios.' }),
      el('div', { class: 'np-campo' }, el('span', { text: 'Motivo' }), pills),
      campo(ui, 'Observação', obs),
      info.pesquisa.ligada ? enviar.linha : el('p', { class: 'np-sub', text: 'A pesquisa de satisfação está desligada. A gestão liga em Automações › Prontos para usar.' }),
      ...(hist ? [hist] : []), erro,
      el('div', { class: 'np-acoes' }, el('button', { class: 'np-botao leve', type: 'button', text: 'Cancelar', onclick: () => d.close() }), ok));
    pills.querySelector('button')?.focus();
  }

  // ---------------------------------------------------------------- configurar a pesquisa
  async function configurar(uiDado, aoSalvar) {
    const ui = UI(uiDado);
    let dados;
    try { dados = await ui.api('/api/nps/config'); } catch (x) { ui.toast(x.message); return; }
    const el = ui.el, cfg = dados.config;
    const { d, corpo } = folha(ui, 'Pesquisa de satisfação');
    const ligada = marca(ui, 'Mandar a pesquisa ao finalizar o atendimento', 'NPS: de 0 a 10. 9–10 = promotores, 7–8 = neutros, 0–6 = detratores (a gestão recebe um aviso).', cfg.ligada);
    const motivos = new Set(cfg.motivos);
    const pills = el('div', { class: 'np-motivos', role: 'group', 'aria-label': 'Motivos que recebem a pesquisa' }, ...dados.motivos.map((m) => {
      const b = el('button', { type: 'button', class: 'np-pill', 'aria-pressed': String(motivos.has(m.id)), text: m.nome });
      b.onclick = () => { if (motivos.has(m.id)) motivos.delete(m.id); else motivos.add(m.id); b.setAttribute('aria-pressed', String(motivos.has(m.id))); };
      return b;
    }));
    const pergunta = area(ui, cfg.pergunta);
    const pedir = marca(ui, 'Depois da nota, pedir um comentário', 'Opcional para a cliente. Se ela já escrever junto com a nota, não perguntamos de novo.', cfg.pedirComentario);
    const coment = area(ui, cfg.textoComentario);
    const obrigado = area(ui, cfg.agradecimento);
    const horas = el('input', { type: 'number', min: '1', max: '336', inputmode: 'numeric', value: String(cfg.validadeHoras) });
    const link = el('input', { type: 'url', maxlength: '500', placeholder: 'https://g.page/r/…/review', value: cfg.linkAvaliacao || '' });
    const erro = el('p', { class: 'np-erro', role: 'alert' });
    const salvar = el('button', { class: 'np-botao', type: 'button', text: 'Salvar' });
    salvar.onclick = async () => {
      salvar.disabled = true; erro.textContent = '';
      try {
        await ui.api('/api/nps/config', { method: 'PUT', body: JSON.stringify({
          ligada: ligada.c.checked, motivos: [...motivos], pergunta: pergunta.value, pedirComentario: pedir.c.checked, textoComentario: coment.value,
          agradecimento: obrigado.value, validadeHoras: Math.round(Number(horas.value) || 72), linkAvaliacao: link.value.trim(),
        }) });
        d.close();
        ui.toast('Pesquisa de satisfação salva ✓');
        aoSalvar?.();
      } catch (x) { erro.textContent = x.message; salvar.disabled = false; }
    };
    corpo.append(ligada.linha,
      el('div', { class: 'np-campo' }, el('span', { text: 'Quem recebe (motivo da finalização)' }), pills),
      campo(ui, 'Pergunta', pergunta), pedir.linha, campo(ui, 'Pedido de comentário', coment), campo(ui, 'Agradecimento', obrigado),
      el('div', { class: 'np-vars' }, 'Variáveis: ', ...VARS.flatMap((v) => [el('code', { text: v }), ' '])),
      campo(ui, 'A resposta vale por quantas horas', horas),
      campo(ui, 'Link de avaliação (Google, por exemplo) — vira {link_avaliacao} nas automações', link),
      erro, el('div', { class: 'np-acoes' }, el('button', { class: 'np-botao leve', type: 'button', text: 'Cancelar', onclick: () => d.close() }), salvar));
  }

  // ---------------------------------------------------------------- pós-venda pronto
  function usarPosVenda(ui, modelo, linkAtual, aoMudar) {
    const el = ui.el, p = modelo.padrao;
    const { d, corpo } = folha(ui, 'Pós-venda pronto');
    const comeca = el('select', {}, el('option', { value: 'finalizado', text: 'Quando finalizar o atendimento com "Venda feita"' }), el('option', { value: 'compareceu', text: 'Quando a cliente entrar em "Compareceu"' }));
    const cuidados = area(ui, p.textoCuidados, 1000);
    const dias = el('input', { type: 'number', min: '2', max: '365', inputmode: 'numeric', value: String(p.diasRetorno) });
    const retorno = area(ui, p.textoRetorno, 1000);
    const pedir = marca(ui, 'Pedir avaliação para quem deu nota 9 ou 10', 'Sai 30 minutos depois da nota da pesquisa de satisfação.', p.pedirAvaliacao);
    const avaliacao = area(ui, p.textoAvaliacao, 1000);
    const link = el('input', { type: 'url', maxlength: '500', placeholder: 'https://g.page/r/…/review', value: linkAtual || '' });
    const blocoAval = el('div', { class: 'np-corpo' }, campo(ui, 'Mensagem de avaliação', avaliacao), campo(ui, 'Link de avaliação no Google', link));
    pedir.c.onchange = () => { blocoAval.hidden = !pedir.c.checked; };
    const ligar = marca(ui, 'Já deixar ligado', 'Você pode desligar ou mudar os textos depois na lista de automações.', true);
    const erro = el('p', { class: 'np-erro', role: 'alert' });
    const criar = el('button', { class: 'np-botao', type: 'button', text: 'Criar automações' });
    criar.onclick = async () => {
      if (pedir.c.checked && !link.value.trim()) { erro.textContent = 'Coloque o link de avaliação do Google (ou desmarque o pedido de avaliação).'; return; }
      criar.disabled = true; erro.textContent = '';
      try {
        await ui.post('/api/automacoes/modelos/pos-venda', {
          comeca: comeca.value, textoCuidados: cuidados.value, diasRetorno: Math.round(Number(dias.value) || 30), textoRetorno: retorno.value,
          pedirAvaliacao: pedir.c.checked, textoAvaliacao: avaliacao.value, ...(link.value.trim() ? { linkAvaliacao: link.value.trim() } : {}), ligar: ligar.c.checked,
        });
        d.close();
        ui.toast(ligar.c.checked ? 'Pós-venda criado e ligado ⚡' : 'Pós-venda criado (desligado)');
        aoMudar?.();
      } catch (x) { erro.textContent = x.message; criar.disabled = false; }
    };
    corpo.append(el('p', { class: 'np-sub', text: modelo.descricao }), campo(ui, 'Começa', comeca),
      campo(ui, 'No dia seguinte: mensagem de cuidados', cuidados), campo(ui, 'Lembrete de retorno: quantos dias depois do atendimento', dias), campo(ui, 'Mensagem de retorno', retorno),
      pedir.linha, blocoAval, el('div', { class: 'np-vars' }, 'Variáveis: ', ...['{primeiro_nome}', '{nome}', '{atendente}', '{link_avaliacao}'].flatMap((v) => [el('code', { text: v }), ' '])),
      ligar.linha, erro, el('div', { class: 'np-acoes' }, el('button', { class: 'np-botao leve', type: 'button', text: 'Cancelar', onclick: () => d.close() }), criar));
  }

  /** Bloco "Prontos para usar" da tela Automações. */
  function prontos(uiDado, { aoMudar, abrirFollowup } = {}) {
    const ui = UI(uiDado); estilo();
    const el = ui.el;
    const cards = el('div', { class: 'np-cards' });
    const caixa = el('section', { class: 'np-prontos', 'aria-label': 'Prontos para usar' }, el('h2', { text: 'Prontos para usar' }), cards);
    const card = (icone, titulo, selo, texto, ...botoes) => el('div', { class: 'np-card' },
      el('div', { class: 'np-card-cab' }, el('span', { class: 'np-ic', html: icone }), el('b', { text: titulo })),
      selo, el('p', { text: texto }), el('div', { class: 'np-acoes' }, ...botoes));
    const selo = (on, texto) => el('span', { class: 'np-selo' + (on ? ' on' : ''), text: texto });
    const desenhar = async () => {
      let m = null, fu = null, cfg = null;
      try { [m, fu, cfg] = await Promise.all([ui.api('/api/automacoes/modelos'), ui.api('/api/followup/config').catch(() => null), ui.api('/api/nps/config').catch(() => null)]); }
      catch { caixa.remove(); return; }
      const pos = m.modelos.find((x) => x.id === 'pos-venda');
      const regua = fu?.config?.cadencias?.find((c) => c.id === 'sem_resposta');
      const horas = (regua?.passos || []).map((p) => p.esperaHoras);
      const ehRegua = horas.length === 3 && horas[0] === 24 && horas[1] === 48 && horas[2] === 96;
      cards.replaceChildren(
        card(IC.estrela, 'Pesquisa de satisfação (NPS)', selo(cfg?.config?.ligada, cfg?.config?.ligada ? 'Ligada' : 'Desligada'),
          'Ao finalizar o atendimento, a cliente dá uma nota de 0 a 10 e um comentário. Resultado no Dashboard e nos Relatórios; nota baixa avisa a gestão.',
          el('button', { class: 'np-botao', type: 'button', text: 'Configurar', onclick: () => configurar(ui, desenhar) })),
        pos ? card(IC.presente, pos.nome, selo(pos.criadas.some((a) => a.ligada), pos.criadas.length ? `${pos.criadas.length} automação(ões) criada(s)` : 'Ainda não usado'), pos.descricao,
          el('button', { class: 'np-botao', type: 'button', text: pos.criadas.length ? 'Criar de novo' : 'Usar modelo', onclick: () => usarPosVenda(ui, pos, m.linkAvaliacao, () => { desenhar(); aoMudar?.(); }) })) : null,
        card(IC.regua, 'Régua sem resposta: 1, 3 e 7 dias', selo(regua?.ligada && ehRegua, regua?.ligada ? (ehRegua ? 'Ligada' : 'Ligada (outros tempos)') : 'Desligada'),
          'Lembretes para quem parou de responder: no 1º, no 3º e no 7º dia. Para sozinha quando a cliente responde. Textos editáveis no Follow-up.',
          el('button', { class: 'np-botao', type: 'button', text: regua?.ligada && ehRegua ? 'Aplicar textos padrão' : 'Usar e ligar', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { await ui.post('/api/followup/modelo/sem_resposta', { ligar: true }); ui.toast('Régua 1, 3 e 7 dias ligada ✓'); } catch (x) { ui.toast(x.message); }
            desenhar();
          } }),
          abrirFollowup ? el('button', { class: 'np-botao leve', type: 'button', text: 'Editar textos', onclick: abrirFollowup }) : null));
    };
    desenhar();
    return caixa;
  }

  // ---------------------------------------------------------------- resultado
  function resultado(ui, r, { compacto = false } = {}) {
    estilo();
    const el = ui.el;
    if (!r.total) {
      return [el('div', { class: 'np-vazio', text: r.ligada === false
        ? 'A pesquisa de satisfação está desligada. Ligue em Automações › Prontos para usar: ao finalizar o atendimento, a cliente dá uma nota de 0 a 10.'
        : `Nenhuma nota no período ainda${r.enviadas ? ` (${r.enviadas} pesquisa(s) enviada(s))` : ''}. As notas chegam quando a cliente responde a pesquisa.` })];
    }
    const pct = (n) => (r.total ? (n / r.total) * 100 : 0);
    const classe = r.nps >= 50 ? ' bom' : r.nps < 0 ? ' ruim' : '';
    const partes = [
      el('div', { class: 'np-topo' }, el('span', { class: 'np-n' + classe, text: (r.nps > 0 ? '+' : '') + r.nps, 'aria-label': `NPS ${r.nps}` }),
        el('small', { text: `${r.total} nota(s)${r.taxaResposta != null ? ` · ${String(r.taxaResposta).replace('.', ',')}% responderam` : ''}` })),
      el('div', { class: 'np-faixa', role: 'img', 'aria-label': `${r.promotores} promotores, ${r.neutros} neutros, ${r.detratores} detratores` },
        el('i', { class: 'p', style: `width:${pct(r.promotores)}%` }), el('i', { class: 'n', style: `width:${pct(r.neutros)}%` }), el('i', { class: 'd', style: `width:${pct(r.detratores)}%` })),
      el('div', { class: 'np-legenda' },
        el('span', {}, el('i', { style: 'background:#3aa0ff' }), `Promotores (9–10): ${r.promotores}`),
        el('span', {}, el('i', { class: '', style: 'background:#b9c6d3' }), `Neutros (7–8): ${r.neutros}`),
        el('span', {}, el('i', { style: 'background:#e5484d' }), `Detratores (0–6): ${r.detratores}`)),
    ];
    const at = (r.porAtendente || []).slice(0, compacto ? 5 : 30);
    if (at.length) partes.push(el('div', { class: 'np-at', role: 'list', 'aria-label': 'NPS por atendente' }, ...at.map((a) => el('div', { class: 'np-at-l', role: 'listitem' },
      el('b', { text: a.nome }), el('small', { text: `${a.total} nota(s) · média ${String(a.media).replace('.', ',')}` }), el('strong', { text: (a.nps > 0 ? '+' : '') + a.nps })))));
    const cs = (r.comentarios || []).slice(0, compacto ? 2 : 8);
    if (cs.length) partes.push(el('div', { class: 'np-coment', 'aria-label': 'Comentários' }, ...cs.map((c) => el('div', {}, document.createTextNode(`“${c.comentario}”`),
      el('small', { text: `Nota ${c.nota}${c.cliente ? ` · ${c.cliente}` : ''}${c.atendente ? ` · ${c.atendente}` : ''} · ${quando(c.em)}` })))));
    return partes;
  }

  /** Corpo do bloco do Dashboard. `dados`: undefined = carregando; null = erro. */
  function corpoPainel(uiDado, dados) {
    const ui = UI(uiDado);
    if (dados === undefined) return [ui.el('div', { class: 'pn-esq', style: 'height:90px' })];
    if (dados === null) return [ui.el('div', { class: 'pn-vazio', text: 'Não deu para carregar agora. Tentamos de novo na próxima atualização.' })];
    return [ui.el('div', { class: 'np-res' }, ...resultado(ui, dados, { compacto: true }))];
  }

  /** Painel dos Relatórios (no estilo dos outros painéis). */
  function painelRelatorio(uiDado, dados, csv) {
    const ui = UI(uiDado); estilo();
    const el = ui.el;
    const corpo = dados ? resultado(ui, dados) : [el('div', { class: 'np-vazio', text: 'Carregando a pesquisa de satisfação…' })];
    return el('section', { class: 'rl-painel rl-vidro rl-g12', 'aria-label': 'Satisfação (NPS)', 'data-rel': 'nps' },
      el('div', { class: 'rl-cab' }, el('h2', {}, 'Satisfação (NPS)', el('small', { text: 'Notas de 0 a 10 depois de finalizar o atendimento: % de promotores (9–10) − % de detratores (0–6), por atendente.' })),
        csv ? el('a', { class: 'rl-redondo', href: csv, download: '', title: 'Exportar NPS (CSV)', 'aria-label': 'Exportar NPS em CSV', html: IC.baixar }) : null),
      el('div', { class: 'np-res' }, ...corpo));
  }

  window.SintoniaTelas.nps = { finalizarNaConversa, configurar, prontos, corpoPainel, painelRelatorio };
})();
