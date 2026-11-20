/* Radar ("tô no radar") — window.SintoniaTelas.radar.
 * Só entra no radar a conversa que alguém da equipe coloca, dizendo o que vigiar ("se ela falar que recebeu o salário",
 * "se não responder até sexta"), um prazo opcional e o que fazer quando acontecer (me avisar / a IA responde).
 * A IA confere cada mensagem nova da cliente; prazo vencido também dispara (servidor: src/radar).
 * Ganchos usados pelo app.html (bloco "radar:"):
 *   tem(id)            — a conversa está no radar? (filtro Radar)
 *   etiqueta(id)       — pílula da linha da lista: o que está vigiando (ou "Aconteceu: ...")
 *   alertas(conversas) — número vermelho do chip: disparos meus ainda não vistos
 *   faixa(caixa, id)   — faixa na conversa aberta (e marca o disparo como visto)
 * Ação "Colocar no radar": botão de radar no topo da conversa (posto aqui, não no app.html).
 * Texto que vem do servidor entra sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, el, toast, estado } = ui;
  const $ = (id) => document.getElementById(id);

  const SVG = {
    radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" opacity=".5"/><path d="M12 12 18.2 5.8"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>',
    sino: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4a5.5 5.5 0 0 1 5.5 5.5v4.2l1.6 2.3a.8.8 0 0 1-.7 1.2H5.6a.8.8 0 0 1-.7-1.2l1.6-2.3V9.5A5.5 5.5 0 0 1 12 4Z"/><path d="M10.2 20.2h3.6"/></svg>',
    ia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6L12 3Z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/></svg>',
  };

  const CSS = `
  /* Chip Radar: a luz só corre quando há disparo não visto (sem animação em loop à toa). */
  #filtros .chip-radar:not(.rd-alerta)::before, #filtros .chip-radar:not(.rd-alerta) .feixe { animation-play-state: paused; }
  /* Pílula da linha: vigiando (azul) e disparou (laranja, a de antes). */
  .motivo-radar.rd-vigiando { background: #e8f2fc; color: #0d5ea6; max-width: 46%; overflow: hidden; text-overflow: ellipsis; }
  html[data-tema="escuro"] .motivo-radar.rd-vigiando { background: rgba(58,160,255,.14); color: #8cc8ff; }
  .motivo-radar.rd-disparou { max-width: 46%; overflow: hidden; text-overflow: ellipsis; }
  .motivo-radar.rd-novo::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 5px; border-radius: 50%; background: #e8473f; vertical-align: 1px; }

  /* Botão do topo da conversa. */
  #topo-radar.rd-ligado { color: var(--marca-azul, #106ebe); }
  html[data-tema="escuro"] #topo-radar.rd-ligado { color: #0ffcbe; }

  /* Faixa na conversa aberta. */
  .rd-faixa { display: flex; align-items: center; gap: 10px; margin: 6px 10px 0; padding: 9px 12px; border-radius: 14px; font-size: 13.5px; line-height: 18px;
    background: #eef6fe; color: #0d2240; box-shadow: inset 0 0 0 1px rgba(16,110,190,.18); position: relative; overflow: hidden; }
  .rd-faixa::after { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); opacity: .9; }
  html[data-tema="escuro"] .rd-faixa { background: rgba(58,160,255,.10); color: #e6f1ff; box-shadow: inset 0 0 0 1px rgba(58,160,255,.25); }
  .rd-faixa.disparou { background: #fff4ec; color: #5a2a0c; box-shadow: inset 0 0 0 1px rgba(194,65,12,.25); }
  html[data-tema="escuro"] .rd-faixa.disparou { background: rgba(255,155,115,.10); color: #ffe2d4; box-shadow: inset 0 0 0 1px rgba(255,155,115,.25); }
  .rd-faixa[hidden] { display: none; }
  .rd-faixa > svg { width: 20px; height: 20px; flex: none; color: #106ebe; }
  html[data-tema="escuro"] .rd-faixa > svg { color: #0ffcbe; }
  .rd-faixa.disparou > svg { color: #c2410c; }
  html[data-tema="escuro"] .rd-faixa.disparou > svg { color: #ffb08f; }
  .rd-faixa .rd-txt { flex: 1; min-width: 0; }
  .rd-faixa .rd-txt b { font-weight: 700; }
  .rd-faixa .rd-txt small { display: block; opacity: .75; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .rd-faixa .rd-bt { all: unset; cursor: pointer; flex: none; font-size: 12.5px; font-weight: 700; padding: 6px 11px; border-radius: 999px; background: rgba(16,110,190,.12); color: inherit; }
  .rd-faixa .rd-bt:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  @media (max-width: 760px) { .rd-faixa { margin: 6px 8px 0; } .rd-faixa .rd-bt.rd-so-pc { display: none; } }

  /* Formulário (painel lateral). */
  .rd-form { display: grid; gap: 16px; padding: 16px; }
  .rd-form label, .rd-campo { display: grid; gap: 7px; font-size: 13.5px; color: var(--sub); }
  .rd-form label > b, .rd-campo > b { color: var(--texto); font-size: 15px; font-weight: 700; }
  .rd-form textarea, .rd-form input[type="datetime-local"] { font: inherit; font-size: 16px; color: var(--texto); background: var(--entrada, var(--painel)); border: 1px solid var(--linha); border-radius: 12px; padding: 12px 14px; box-sizing: border-box; width: 100%; }
  .rd-form textarea { resize: vertical; min-height: 76px; }
  html[data-tema="escuro"] .rd-form input[type="datetime-local"] { color-scheme: dark; }
  .rd-chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .rd-chips button { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 999px; font-size: 13.5px; font-weight: 600; background: var(--sel); color: var(--texto); }
  .rd-chips button[aria-pressed="true"] { background: #106ebe; color: #fff; }
  .rd-chips button:focus-visible, .rd-op:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  .rd-ops { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rd-op { all: unset; cursor: pointer; box-sizing: border-box; display: grid; gap: 4px; padding: 13px 14px; border-radius: 16px; border: 1px solid var(--linha); background: var(--entrada, var(--painel)); }
  .rd-op svg { width: 22px; height: 22px; color: #106ebe; }
  html[data-tema="escuro"] .rd-op svg { color: #0ffcbe; }
  .rd-op b { font-size: 15px; color: var(--texto); }
  .rd-op small { font-size: 12.5px; color: var(--sub); line-height: 16px; }
  .rd-op[aria-pressed="true"] { border-color: #106ebe; box-shadow: 0 0 0 2px rgba(16,110,190,.35); background: color-mix(in srgb, #106ebe 7%, var(--entrada, var(--painel))); }
  .rd-aviso { font-size: 13px; line-height: 18px; padding: 10px 12px; border-radius: 12px; background: var(--aviso, #fff7e0); color: var(--aviso-txt, #6b4e00); }
  .rd-acoes { display: flex; gap: 10px; flex-wrap: wrap; }
  .rd-acoes .botao { flex: 1; min-height: 46px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; box-sizing: border-box; }
  .rd-principal { background: linear-gradient(90deg, #106ebe, #3aa0ff) !important; color: #fff !important; }
  .rd-tirar { color: #c4313b !important; }
  html[data-tema="escuro"] .rd-tirar { color: #ff8a8f !important; }
  .rd-hist { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--linha); }
  .rd-hist li { display: grid; gap: 2px; padding: 10px 2px; border-bottom: 1px solid var(--linha); font-size: 14px; color: var(--texto); }
  .rd-hist small { color: var(--sub); font-size: 12px; }
  .rd-tit { margin: 6px 0 -6px; font-size: 12.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
  .rd-erro { color: #ea0038; font-size: 13.5px; min-height: 0; }
  `;
  document.head.append(el('style', { text: CSS }));

  // ------------------------------------------------------------ dados
  const R = { itens: new Map(), iaLigada: true, assinatura: '' };
  async function carregar() {
    let d; try { d = await api('/api/radar'); } catch { return; }
    R.iaLigada = d.iaLigada !== false;
    const ass = JSON.stringify(d.itens);
    if (ass === R.assinatura) return;
    R.assinatura = ass;
    R.itens = new Map(d.itens.map((x) => [x.conversaId, x]));
    dispatchEvent(new Event('sintonia:radar'));
    marcarBotao();
  }
  const poe = (x) => { if (x) R.itens.set(x.conversaId, x); R.assinatura = ''; dispatchEvent(new Event('sintonia:radar')); marcarBotao(); };
  const tira = (id) => { R.itens.delete(id); R.assinatura = ''; dispatchEvent(new Event('sintonia:radar')); marcarBotao(); };
  carregar();
  setInterval(() => { if (!document.hidden) carregar(); }, 20000);
  addEventListener('visibilitychange', () => { if (!document.hidden) carregar(); });
  // Notificação nova (sino): pode ser um disparo do radar.
  addEventListener('sintonia:notificacoes', () => carregar());

  const naoVisto = (x) => x.estado === 'disparou' && !x.visto && x.meu;
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const dataCurta = (d) => { const x = new Date(d); return `${DIAS[x.getDay()]}, ${x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`; };
  const quando = (d) => new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  function tem(id) { return R.itens.has(id); }
  function etiqueta(id) {
    const x = R.itens.get(id); if (!x) return null;
    const disparou = x.estado === 'disparou';
    const txt = disparou ? (x.motivo || 'Aconteceu') : x.vigiar;
    return el('em', { class: 'motivo-radar ' + (disparou ? 'rd-disparou' : 'rd-vigiando') + (naoVisto(x) ? ' rd-novo' : ''), title: (disparou ? 'Aconteceu: ' : 'Vigiando: ') + txt, text: txt });
  }
  function alertas(conversas) {
    const ids = conversas ? new Set(conversas.map((c) => c.id)) : null;
    let n = 0; for (const x of R.itens.values()) if (naoVisto(x) && (!ids || ids.has(x.conversaId))) n++;
    document.querySelector('#filtros .chip-radar')?.classList.toggle('rd-alerta', n > 0);
    return n;
  }

  // ------------------------------------------------------------ faixa na conversa
  async function marcarVisto(id) {
    const x = R.itens.get(id); if (!x || !naoVisto(x)) return;
    x.visto = true; poe(x);
    try { await ui.post(`/api/radar/conversa/${id}/visto`, {}); } catch {}
  }
  function faixa(caixa, id) {
    caixa = caixa || $('rd-selo'); if (!caixa) return;
    const x = R.itens.get(id);
    const bt = $('topo-radar');
    if (bt && id === estado.aberta) { bt.classList.toggle('rd-ligado', !!x); bt.setAttribute('aria-label', x ? 'Mudar o radar desta conversa' : 'Colocar no radar'); }
    caixa.replaceChildren(); caixa.hidden = !x;
    if (!x) return;
    const disparou = x.estado === 'disparou';
    caixa.className = 'rd-faixa' + (disparou ? ' disparou' : '');
    caixa.insertAdjacentHTML('afterbegin', SVG.radar);
    const sub = [];
    if (x.prazo && !disparou) sub.push(`até ${dataCurta(x.prazo)}`);
    sub.push(x.acao === 'ia' ? 'a IA responde' : 'avisa ' + (x.meu ? 'você' : (x.donoNome || 'a equipe')));
    if (!x.meu && x.donoNome) sub.push(`de ${x.donoNome}`);
    if (disparou && x.resposta === 'pendente') sub.push('IA respondendo…');
    caixa.append(
      el('div', { class: 'rd-txt' }, el('b', { text: disparou ? 'Aconteceu: ' : 'No radar: ' }), document.createTextNode(disparou ? (x.motivo || x.vigiar) : x.vigiar), el('small', { text: (disparou ? `Vigiava: ${x.vigiar} · ` : '') + sub.join(' · ') })),
      ...(disparou ? [el('button', { class: 'rd-bt rd-so-pc', type: 'button', text: 'Vigiar de novo', onclick: () => deNovo(id) })] : []),
      el('button', { class: 'rd-bt', type: 'button', text: disparou ? 'Ver' : 'Mudar', onclick: () => abrirForm(id) }));
    if (disparou && naoVisto(x)) marcarVisto(id);
  }
  async function deNovo(id) {
    try { const d = await ui.post(`/api/radar/conversa/${id}/de-novo`, {}); poe(d.item); faixa(null, id); toast('Vigiando de novo.'); } catch (e) { toast(e.message || 'Não deu agora.'); }
  }

  // Botão de radar no topo da conversa + a faixa logo abaixo do topo (criados aqui para mexer pouco no app.html).
  function montarTopo() {
    const pilula = document.querySelector('#chat-aberto .pilula-topo');
    if (pilula && !$('topo-radar')) {
      const b = el('button', { class: 'icone', id: 'topo-radar', type: 'button', title: 'Radar: vigiar esta conversa', 'aria-label': 'Colocar no radar', html: SVG.radar, onclick: () => estado.aberta && abrirForm(estado.aberta) });
      pilula.prepend(b);
    }
    if (!$('rd-selo')) { const fu = $('fu-selo'); const f = el('div', { class: 'rd-faixa', id: 'rd-selo', hidden: '' }); if (fu) fu.after(f); }
  }
  function marcarBotao() { if (estado.aberta) faixa(null, estado.aberta); }
  montarTopo();

  // ------------------------------------------------------------ formulário
  const EXEMPLOS = ['Se ela falar que recebeu o salário', 'Se não responder até sexta', 'Quando pedir desconto'];
  function proxima(diaSemana, hora = 18) { const d = new Date(); d.setHours(hora, 0, 0, 0); let add = (diaSemana - d.getDay() + 7) % 7; if (add === 0 && d <= new Date()) add = 7; d.setDate(d.getDate() + add); return d; }
  const PRAZOS = [
    ['Sem prazo', () => null],
    ['Amanhã', () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); return d; }],
    ['Sexta', () => proxima(5)],
    ['Em 1 semana', () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(18, 0, 0, 0); return d; }],
  ];
  const paraInput = (d) => { if (!d) return ''; const x = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };

  async function abrirForm(id) {
    const c = estado.conversas.find((x) => x.id === id) || estado.detalhe?.conversa;
    let d; try { d = await api(`/api/radar/conversa/${id}`); } catch (e) { toast(e.message || 'Não deu para abrir o radar.'); return; }
    R.iaLigada = d.iaLigada !== false;
    const atual = d.item;
    const P = window.SintoniaPainel;
    if (!P) return;
    P.abrir({ id: 'radar', titulo: atual ? 'Radar desta conversa' : 'Colocar no radar', montar: (corpo) => desenharForm(corpo, id, c, atual, d.historico) });
  }

  function desenharForm(corpo, id, c, atual, historico) {
    const f = { vigiar: atual?.vigiar || '', prazo: atual?.prazo || null, acao: atual?.acao || 'avisar', instrucao: atual?.instrucao || '' };
    const form = el('form', { class: 'rd-form', novalidate: '' });
    const nome = c ? ui.nomeDe(c) : 'esta cliente';
    form.append(el('p', { style: 'margin:0;font-size:14.5px;line-height:20px;color:var(--sub)', text: `Diga o que vigiar na conversa com ${nome}. A IA confere cada mensagem nova dela e, quando acontecer (ou chegar o prazo), age.` }));

    // O que vigiar
    const vigiar = el('textarea', { maxlength: '300', rows: '2', placeholder: 'Ex.: se ela falar que recebeu o salário', 'aria-label': 'O que vigiar' });
    vigiar.value = f.vigiar;
    const exemplos = el('div', { class: 'rd-chips' }, ...EXEMPLOS.map((t) => el('button', { type: 'button', text: t, onclick: () => { vigiar.value = t; vigiar.focus(); } })));
    form.append(el('label', {}, el('b', { text: 'O que vigiar' }), vigiar, exemplos));

    // Prazo
    const prazo = el('input', { type: 'datetime-local', 'aria-label': 'Prazo' });
    prazo.value = paraInput(f.prazo);
    const chipsPrazo = el('div', { class: 'rd-chips' });
    const marcarPrazo = () => chipsPrazo.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0 ? !prazo.value : false)));
    PRAZOS.forEach(([t, fn]) => chipsPrazo.append(el('button', { type: 'button', text: t, 'aria-pressed': 'false', onclick: () => { prazo.value = paraInput(fn()); marcarPrazo(); } })));
    prazo.addEventListener('input', marcarPrazo); marcarPrazo();
    form.append(el('div', { class: 'rd-campo' }, el('b', { text: 'Prazo (opcional)' }), el('span', { text: 'Chegou o prazo e não aconteceu? O radar dispara do mesmo jeito.' }), chipsPrazo, prazo));

    // Quando acontecer
    const instr = el('textarea', { maxlength: '600', rows: '2', placeholder: 'Ex.: ofereça o horário de sábado e lembre do Pix com desconto', 'aria-label': 'Instrução para a IA' });
    instr.value = f.instrucao;
    const caixaInstr = el('label', {}, el('b', { text: 'Instrução para a IA (opcional)' }), instr);
    const avisoIa = el('div', { class: 'rd-aviso', text: 'A IA está desligada ou sem chave agora: quando acontecer, só avisamos você.' });
    const ops = el('div', { class: 'rd-ops', role: 'group', 'aria-label': 'Quando acontecer' });
    const op = (valor, ic, t, sub) => el('button', { type: 'button', class: 'rd-op', 'data-v': valor, html: ic, onclick: () => { f.acao = valor; marcar(); } }, el('b', { text: t }), el('small', { text: sub }));
    ops.append(op('avisar', SVG.sino, 'Me avisar', 'Aviso no sino e no celular.'), op('ia', SVG.ia, 'A IA responde', 'A IA responde a cliente e te avisa.'));
    const marcar = () => { ops.querySelectorAll('.rd-op').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === f.acao))); caixaInstr.hidden = f.acao !== 'ia'; avisoIa.hidden = f.acao !== 'ia' || R.iaLigada; };
    form.append(el('div', { class: 'rd-campo' }, el('b', { text: 'Quando acontecer' }), ops), avisoIa, caixaInstr);
    marcar();

    const erroTxt = el('div', { class: 'rd-erro', role: 'alert' });
    const salvar = el('button', { type: 'submit', class: 'botao rd-principal', text: atual ? 'Salvar' : 'Colocar no radar' });
    const acoes = el('div', { class: 'rd-acoes' }, salvar);
    if (atual) acoes.append(el('button', { type: 'button', class: 'botao leve rd-tirar', text: 'Tirar do radar', onclick: async () => {
      try { await ui.api(`/api/radar/conversa/${id}`, { method: 'DELETE' }); tira(id); window.SintoniaPainel.fechar(); toast('Saiu do radar.'); } catch (e) { toast(e.message || 'Não deu agora.'); }
    } }));
    form.append(erroTxt, acoes);
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erroTxt.textContent = '';
      const corpoReq = { vigiar: vigiar.value.trim(), acao: f.acao, prazo: prazo.value ? new Date(prazo.value).toISOString() : null, instrucao: f.acao === 'ia' ? instr.value.trim() || null : null };
      if (corpoReq.vigiar.length < 3) { erroTxt.textContent = 'Diga o que vigiar.'; vigiar.focus(); return; }
      if (corpoReq.prazo && new Date(corpoReq.prazo) <= new Date()) { erroTxt.textContent = 'O prazo precisa ser no futuro.'; prazo.focus(); return; }
      salvar.disabled = true;
      try {
        const r = await ui.api(`/api/radar/conversa/${id}`, { method: 'PUT', body: JSON.stringify(corpoReq), headers: { 'content-type': 'application/json' } });
        poe(r.item); window.SintoniaPainel.fechar();
        toast(atual ? 'Radar atualizado.' : 'No radar. A IA vai ficar de olho.');
      } catch (x) { erroTxt.textContent = x.message || 'Não deu para salvar.'; }
      salvar.disabled = false;
    });

    if (historico?.length) {
      form.append(el('p', { class: 'rd-tit', text: 'Histórico' }), el('ul', { class: 'rd-hist' }, ...historico.map((h) => el('li', {}, el('span', { text: h.texto }), el('small', { text: quando(h.em) + (h.por ? ` · ${h.por}` : '') })))));
    }
    corpo.append(form);
    if (!atual) setTimeout(() => vigiar.focus(), 250);
  }

  window.SintoniaTelas.radar = { tem, etiqueta, alertas, faixa, abrirForm, carregar };
})();
