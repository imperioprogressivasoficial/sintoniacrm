/* Tela "desempenho" da Sintonia: registra window.SintoniaTelas.desempenho = { desenhar(caixa, ui) }.
 * Desempenho do atendimento (visão do dono): por atendente (tempos de resposta, expediente, agendamentos, o que deixou
 * passar), a equipe (rankings, serviços, clientes, IA × equipe, mapas de calor, linha do tempo) e a fila de agora.
 * Visual vidro (docs/ESTILO-VIDRO.md), gráficos em SVG puro. No celular as tabelas viram cartões.
 * Dados: GET /api/desempenho; CSV: /api/desempenho/:tabela/csv. Estilos em <style id="estilo-desempenho">, prefixo .dp-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const PERIODOS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias'], ['personalizado', 'Período']];
  const ABAS = [['atendentes', 'Por atendente'], ['equipe', 'Equipe'], ['fila', 'Sem resposta agora']];
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const CHAVE = 'sintonia.desempenho.filtro';
  const UNI = { norte: 'Norte', sumare: 'Sumaré' };

  const CSS = `
  .dp-caixa.dp-caixa { grid-template-columns: minmax(0, 1fr); overflow-x: hidden; padding: 14px 16px 0; gap: 0; }
  .dp { --serie: var(--marca-azul); --menta: var(--marca-menta); --noite: #071d33; --coral: #ff7a59;
        display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-bottom: 28px; min-width: 0; max-width: 1240px; width: 100%; margin: 0 auto; }
  html[data-tema="escuro"] .dp { --serie: #7cc4ff; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .dp { --serie: #7cc4ff; } }
  @media (max-width: 760px) { .dp { padding-bottom: 110px; } }
  .dp-vidro { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%); border-radius: 24px; }
  .dp-topo h1 { margin: 0; font-size: 38px; letter-spacing: -.03em; }
  .dp-topo small { display: block; color: var(--sub); font-size: 13.5px; font-weight: 600; margin-top: 2px; }
  .dp-grandes { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .dp-grande { padding: 16px 18px; }
  .dp-grande b { display: block; font-family: var(--fonte-titulo); font-size: 32px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .dp-grande span { display: block; font-size: 12.5px; color: var(--sub); font-weight: 600; margin-top: 4px; }
  .dp-grande.dp-alerta b { color: var(--coral); }
  .dp-controles { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .dp-trilho { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; overflow-x: auto; scrollbar-width: none; max-width: 100%; box-sizing: border-box; }
  .dp-trilho::-webkit-scrollbar { display: none; }
  .dp-trilho button { all: unset; cursor: pointer; padding: 9px 15px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); white-space: nowrap; border: 1px solid transparent; }
  .dp-trilho button[aria-pressed="true"] { background: var(--vidro-ativo); color: var(--texto); border-color: var(--vidro-borda); font-weight: 700; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
  .dp-trilho button:focus-visible, .dp-csv:focus-visible, .dp-linha:focus-visible { outline: 2px solid var(--menta); outline-offset: 2px; }
  .dp-campo { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 0 8px 0 14px; min-height: 44px; box-sizing: border-box; }
  .dp-campo span { font-size: 12px; color: var(--sub); font-weight: 700; }
  .dp-campo select, .dp-campo input { all: unset; font: inherit; font-size: 14px; font-weight: 600; color: var(--texto); padding: 8px 6px; cursor: pointer; max-width: 170px; }
  .dp-campo select option { color: #106ebe; }
  html[data-tema="escuro"] .dp input, html[data-tema="escuro"] .dp select { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .dp input, html:not([data-tema="claro"]) .dp select { color-scheme: dark; } }
  .dp-p { padding: 18px 20px; min-width: 0; }
  .dp-p-cab { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
  .dp-p-cab h2 { margin: 0; font-size: 19px; flex: 1 1 160px; min-width: 0; }
  @media (max-width: 560px) { .dp-p-cab .dp-dica { display: none; } .dp-controles .dp-campo { flex: 1 1 40%; } .dp-grande { padding: 12px 14px; } .dp-grandes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }
  .dp-p-cab .dp-dica { font-size: 12.5px; color: var(--sub); }
  .dp-csv { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 800; padding: 7px 12px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); }
  .dp-grade2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
  @media (max-width: 900px) { .dp-grade2 { grid-template-columns: minmax(0, 1fr); } }
  .dp-tab { width: 100%; border-collapse: collapse; font-size: 13.5px; font-variant-numeric: tabular-nums; }
  .dp-tab th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--sub); font-weight: 700; padding: 8px 7px; border-bottom: 1px solid var(--vidro-linha); white-space: nowrap; }
  .dp-tab td { padding: 10px 7px; border-bottom: 1px solid var(--vidro-linha); white-space: nowrap; }
  .dp-tab td.dp-n, .dp-tab th.dp-n { text-align: right; }
  .dp-tab tr.dp-linha { cursor: pointer; }
  .dp-tab tr.dp-linha:hover td, .dp-tab tr[aria-selected="true"] td { background: var(--vidro-item); }
  .dp-rolar { overflow-x: auto; }
  .dp-ruim { color: var(--coral); font-weight: 800; }
  .dp-bom { color: color-mix(in srgb, var(--menta) 70%, var(--texto)); font-weight: 800; }
  @media (max-width: 760px) {
    .dp-tab thead { display: none; }
    .dp-tab, .dp-tab tbody, .dp-tab tr, .dp-tab td { display: block; width: 100%; box-sizing: border-box; }
    .dp-tab tr { border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); padding: 8px 12px; margin-bottom: 10px; }
    .dp-tab td { display: flex; justify-content: space-between; gap: 12px; border: 0; padding: 5px 0; white-space: normal; text-align: right; }
    .dp-tab td::before { content: attr(data-r); color: var(--sub); font-weight: 600; text-align: left; }
    .dp-tab td:first-child { font-size: 15.5px; font-weight: 800; }
    .dp-tab td:first-child::before { content: none; }
  }
  .dp-barras { display: grid; gap: 9px; }
  .dp-barra { display: grid; grid-template-columns: minmax(90px, 30%) 1fr auto; gap: 10px; align-items: center; font-size: 13.5px; }
  .dp-barra > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .dp-barra i { display: block; height: 12px; border-radius: 999px; background: linear-gradient(90deg, var(--serie), var(--menta)); min-width: 3px; }
  .dp-barra b { font-variant-numeric: tabular-nums; font-size: 13px; }
  .dp-calor svg, .dp-linha-svg svg { width: 100%; height: auto; display: block; }
  .dp-calor text, .dp-linha-svg text { fill: var(--sub); font-size: 10px; font-family: inherit; }
  .dp-legenda { font-size: 12px; color: var(--sub); margin-top: 6px; }
  .dp-detalhe { border: 1px solid color-mix(in srgb, var(--menta) 50%, var(--vidro-borda)); }
  .dp-detalhe h2 { font-size: 24px; }
  .dp-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .dp-mini div { padding: 12px 14px; border-radius: 16px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .dp-mini b { display: block; font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .dp-mini span { font-size: 12px; color: var(--sub); font-weight: 600; }
  .dp-lista { display: grid; gap: 8px; }
  .dp-item { all: unset; cursor: pointer; display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 12px 14px; border-radius: 16px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .dp-item:hover { background: var(--vidro-ativo); }
  .dp-item b { font-size: 14.5px; }
  .dp-item small { color: var(--sub); font-size: 12.5px; grid-column: 1; }
  .dp-item em { font-style: normal; font-weight: 800; grid-row: 1 / span 2; grid-column: 2; align-self: center; font-variant-numeric: tabular-nums; }
  .dp-sub { font-size: 14px; margin: 16px 0 8px; color: var(--sub); text-transform: uppercase; letter-spacing: .04em; }
  .dp-vazio { color: var(--sub); font-size: 13.5px; padding: 8px 0; }
  .dp-erro { padding: 18px; }
  .dp-tl { display: grid; gap: 4px; }
  .dp-tl-l { display: grid; grid-template-columns: 110px repeat(24, minmax(0, 1fr)); gap: 2px; align-items: center; font-size: 11px; }
  .dp-tl-l > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; font-size: 12.5px; }
  .dp-tl-l i { height: 18px; border-radius: 4px; background: var(--vidro-linha); }
  @media (max-width: 560px) { .dp-tl-l { grid-template-columns: 70px repeat(24, minmax(0, 1fr)); } .dp-topo h1 { font-size: 30px; } .dp-grande b { font-size: 26px; } }
  .dp-ve { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .dp-ve > div { padding: 14px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .dp-ve h3 { margin: 0 0 8px; font-size: 15px; }
  .dp-ve p { margin: 4px 0; font-size: 13px; display: flex; justify-content: space-between; gap: 8px; }
  `;

  const s = { f: lerFiltro(), aba: 'atendentes', dados: null, erro: null, sel: null, geracao: 0, timer: null };
  function lerFiltro() {
    try { return { periodo: 'hoje', de: '', ate: '', unidade: '', atendente: '', limite: '15', ...JSON.parse(localStorage.getItem(CHAVE) || '{}') }; } catch { return { periodo: 'hoje', de: '', ate: '', unidade: '', atendente: '', limite: '15' }; }
  }
  function gravarFiltro() { try { localStorage.setItem(CHAVE, JSON.stringify(s.f)); } catch {} }
  function estilo() { if (!document.getElementById('estilo-desempenho')) document.head.append(Object.assign(document.createElement('style'), { id: 'estilo-desempenho', textContent: CSS })); }
  const consulta = () => {
    const q = new URLSearchParams({ periodo: s.f.periodo, limite: s.f.limite });
    if (s.f.periodo === 'personalizado') { if (s.f.de) q.set('de', s.f.de); if (s.f.ate) q.set('ate', s.f.ate); }
    if (s.f.unidade) q.set('unidade', s.f.unidade);
    if (s.f.atendente) q.set('atendente', s.f.atendente);
    return q.toString();
  };

  // ---------------------------------------------------------------- formatação
  const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
  const fmtR = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  function fmtT(ms) {
    if (ms === null || ms === undefined) return '—';
    const min = ms / 60000;
    if (min < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
    if (min < 60) return `${Math.round(min)} min`;
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h >= 24 ? `${Math.round(h / 24)} d` : `${h}h${m ? String(m).padStart(2, '0') : ''}`;
  }
  const fmtMin = (min) => (min > 0 ? fmtT(min * 60000) : '0 min');
  const fmtDia = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}`; };
  const fmtQuando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const tempoRuim = (ms) => ms !== null && ms !== undefined && ms > Number(s.f.limite) * 60000;

  // ---------------------------------------------------------------- gráficos (SVG puro)
  const NS = 'http://www.w3.org/2000/svg';
  function svg(w, h, html) { const e = document.createElementNS(NS, 'svg'); e.setAttribute('viewBox', `0 0 ${w} ${h}`); e.setAttribute('role', 'img'); e.innerHTML = html; return e; }
  /** Mapa de calor dia da semana × hora (só 7h–22h quando não há nada de madrugada). */
  function calor(ui, g, rotulo) {
    const tudo = g.flat();
    const max = Math.max(1, ...tudo);
    const madrugada = g.some((l) => l.some((v, h) => v > 0 && (h < 7 || h > 22)));
    const h0 = madrugada ? 0 : 7, h1 = madrugada ? 23 : 22;
    const n = h1 - h0 + 1, cw = 22, ch = 20, ox = 34, oy = 16;
    let html = '';
    for (let h = h0; h <= h1; h++) if ((h - h0) % 2 === 0) html += `<text x="${ox + (h - h0) * cw + cw / 2}" y="11" text-anchor="middle">${h}h</text>`;
    g.forEach((linha, d) => {
      html += `<text x="0" y="${oy + d * ch + 14}">${DIAS[d]}</text>`;
      for (let h = h0; h <= h1; h++) {
        const v = linha[h] || 0;
        const a = v ? 0.15 + 0.85 * (v / max) : 0;
        html += `<rect x="${ox + (h - h0) * cw + 1}" y="${oy + d * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="4" fill="${v ? 'var(--serie)' : 'var(--vidro-linha)'}" fill-opacity="${v ? a.toFixed(2) : 1}"><title>${DIAS[d]} ${h}h: ${v}</title></rect>`;
      }
    });
    const caixa = ui.el('div', { class: 'dp-calor', 'aria-label': rotulo });
    caixa.append(svg(ox + n * cw, oy + 7 * ch + 2, html));
    return caixa;
  }
  /** Curva por hora (soma dos dias). */
  function linhaHoras(ui, porHora, rotulo) {
    const w = 480, h = 140, p = 22, max = Math.max(1, ...porHora);
    const pts = porHora.map((v, i) => [p + (i * (w - 2 * p)) / 23, h - p - (v / max) * (h - 2 * p)]);
    const d = pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
    let html = `<defs><linearGradient id="dp-gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--menta)" stop-opacity=".45"/><stop offset="1" stop-color="var(--menta)" stop-opacity="0"/></linearGradient></defs>`;
    html += `<path d="${d} L${w - p},${h - p} L${p},${h - p} Z" fill="url(#dp-gr)"/><path d="${d}" fill="none" stroke="var(--serie)" stroke-width="2.5" stroke-linejoin="round"/>`;
    for (let i = 0; i < 24; i += 3) html += `<text x="${pts[i][0]}" y="${h - 6}" text-anchor="middle">${i}h</text>`;
    const top = porHora.indexOf(max);
    if (porHora[top]) html += `<circle cx="${pts[top][0]}" cy="${pts[top][1]}" r="4.5" fill="var(--menta)"/><text x="${pts[top][0]}" y="${Math.max(10, pts[top][1] - 8)}" text-anchor="middle" style="font-weight:700">${max}</text>`;
    const caixa = ui.el('div', { class: 'dp-linha-svg', 'aria-label': rotulo });
    caixa.append(svg(w, h, html));
    return caixa;
  }
  function barras(ui, itens, valor, rotulo, fmt = fmtN) {
    const max = Math.max(1, ...itens.map(valor));
    if (!itens.length) return ui.el('div', { class: 'dp-vazio', text: 'Nada no período.' });
    return ui.el('div', { class: 'dp-barras' }, ...itens.map((x) => ui.el('div', { class: 'dp-barra' }, ui.el('span', { text: rotulo(x), title: rotulo(x) }), ui.el('span', {}, Object.assign(ui.el('i'), { style: `width:${(100 * valor(x)) / max}%` })), ui.el('b', { text: fmt(valor(x)) }))));
  }
  const porHoraDe = (g) => Array.from({ length: 24 }, (_, h) => g.reduce((a, l) => a + (l[h] || 0), 0));

  // ---------------------------------------------------------------- blocos
  const csvBotao = (ui, tabela, texto = 'CSV') => ui.el('a', { class: 'dp-csv', href: `/api/desempenho/${tabela}/csv?${consulta()}`, download: '', title: 'Exportar CSV', text: texto });
  function painel(ui, titulo, extra, ...filhos) {
    return ui.el('section', { class: 'dp-p dp-vidro' }, ui.el('div', { class: 'dp-p-cab' }, ui.el('h2', { text: titulo }), ...extra), ...filhos);
  }
  function tabela(ui, cols, linhas, aoTocar) {
    const t = ui.el('table', { class: 'dp-tab' });
    t.append(ui.el('thead', {}, ui.el('tr', {}, ...cols.map((c) => ui.el('th', { class: c.n ? 'dp-n' : '', text: c.t })))));
    const tb = ui.el('tbody');
    for (const l of linhas) {
      const tr = ui.el('tr', aoTocar ? { class: 'dp-linha', tabindex: '0', 'aria-selected': String(s.sel === l.id), onclick: () => aoTocar(l), onkeydown: (e) => { if (e.key === 'Enter') aoTocar(l); } } : {});
      for (const c of cols) { const v = c.v(l); const td = ui.el('td', { class: (c.n ? 'dp-n ' : '') + (c.cls ? c.cls(l) : ''), 'data-r': c.t }); td.append(v instanceof Node ? v : document.createTextNode(String(v))); tr.append(td); }
      tb.append(tr);
    }
    t.append(tb);
    return ui.el('div', { class: 'dp-rolar' }, t);
  }
  const itemConversa = (ui, titulo, sub, direita, id) => ui.el('button', { class: 'dp-item', type: 'button', onclick: () => ui.abrir(id) }, ui.el('b', { text: titulo }), ui.el('small', { text: sub }), ui.el('em', { text: direita }));

  function blocoAtendentes(ui, d) {
    const cols = [
      { t: 'Atendente', v: (a) => a.nome },
      { t: 'Conversas', n: 1, v: (a) => fmtN(a.conversas) },
      { t: 'Mensagens', n: 1, v: (a) => fmtN(a.mensagens) },
      { t: '1ª resp. média', n: 1, v: (a) => fmtT(a.primeiraResposta.mediaMs), cls: (a) => (tempoRuim(a.primeiraResposta.mediaMs) ? 'dp-ruim' : '') },
      { t: 'Mediana', n: 1, v: (a) => fmtT(a.primeiraResposta.medianaMs) },
      { t: 'Na conversa', n: 1, v: (a) => fmtT(a.respostaConversa.mediaMs) },
      { t: 'Até agendar', n: 1, v: (a) => fmtT(a.ateAgendar.mediaMs) },
      { t: 'Agendou', n: 1, v: (a) => fmtN(a.agendamentos) },
      { t: 'Valor', n: 1, v: (a) => fmtR(a.valor) },
      { t: 'Conversão', n: 1, v: (a) => `${String(a.conversao).replace('.', ',')}%` },
      { t: 'Ativa', n: 1, v: (a) => `${String(a.horasAtivas).replace('.', ',')} h` },
      { t: 'Deixou passar', n: 1, v: (a) => fmtN(a.deixouPassar.semResposta + a.deixouPassar.iaAssumiu + a.deixouPassar.lembretesNaoFeitos.length), cls: (a) => (a.deixouPassar.semResposta + a.deixouPassar.iaAssumiu ? 'dp-ruim' : '') },
    ];
    const bloco = painel(ui, 'Por atendente', [ui.el('span', { class: 'dp-dica', text: 'Toque numa atendente para ver tudo dela' }), csvBotao(ui, 'atendentes', 'CSV atendentes'), csvBotao(ui, 'expediente', 'CSV expediente')],
      d.atendentes.length ? tabela(ui, cols, d.atendentes, (a) => { s.sel = s.sel === a.id ? null : a.id; desenharTudo(); document.getElementById('dp-detalhe')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }) : ui.el('div', { class: 'dp-vazio', text: 'Ninguém da equipe atendeu no período.' }));
    const frag = [bloco];
    const a = d.atendentes.find((x) => x.id === s.sel);
    if (a) frag.push(detalhe(ui, a));
    return frag;
  }

  function detalhe(ui, a) {
    const el = ui.el;
    const dp = a.deixouPassar;
    const mini = (v, r) => el('div', {}, el('b', { text: v }), el('span', { text: r }));
    const pico = a.picoAgendamento ? `${DIAS[a.picoAgendamento.diaSemana]} ${a.picoAgendamento.hora}h` : '—';
    const caixa = el('section', { class: 'dp-p dp-vidro dp-detalhe', id: 'dp-detalhe' },
      el('div', { class: 'dp-p-cab' }, el('h2', { text: a.nome }), el('button', { class: 'dp-csv', type: 'button', text: 'Fechar', onclick: () => { s.sel = null; desenharTudo(); } })),
      el('div', { class: 'dp-mini' },
        mini(fmtN(a.conversas), 'conversas atendidas'), mini(fmtN(a.mensagens), 'mensagens enviadas'),
        mini(fmtT(a.primeiraResposta.mediaMs), `1ª resposta média (mediana ${fmtT(a.primeiraResposta.medianaMs)})`),
        mini(fmtT(a.respostaConversa.mediaMs), 'resposta durante a conversa'), mini(fmtT(a.ateAgendar.mediaMs), 'até agendar (média)'),
        mini(fmtN(a.agendamentos), `agendamentos · ${a.comValor} com valor, ${a.semValor} sem`), mini(fmtR(a.valor), 'valor agendado'),
        mini(`${String(a.conversao).replace('.', ',')}%`, 'conversão'), mini(fmtN(a.comparecimentos), 'compareceram'),
        mini(fmtN(a.ligacoes), 'ligações'), mini(`${String(a.horasAtivas).replace('.', ',')} h`, 'horas ativas'), mini(pico, 'quando mais agendou')));
    caixa.append(el('h3', { class: 'dp-sub', text: 'Expediente por dia' }));
    caixa.append(a.expediente.length ? tabela(ui, [
      { t: 'Dia', v: (x) => fmtDia(x.dia) }, { t: 'Começou', n: 1, v: (x) => x.inicio }, { t: 'Terminou', n: 1, v: (x) => x.fim },
      { t: 'No ar', n: 1, v: (x) => fmtMin(x.spanMin) }, { t: 'Ativa', n: 1, v: (x) => fmtMin(x.ativoMin) }, { t: 'Ações', n: 1, v: (x) => fmtN(x.acoes) },
    ], a.expediente.slice().reverse()) : el('div', { class: 'dp-vazio', text: 'Sem atividade no período.' }));
    caixa.append(el('h3', { class: 'dp-sub', text: 'Horário em que mais agendou' }), calor(ui, a.calorAgendamentos, `Agendamentos de ${a.nome} por dia e hora`));
    caixa.append(el('div', { class: 'dp-p-cab', style: 'margin-top:16px' }, el('h3', { class: 'dp-sub', style: 'margin:0;flex:1', text: 'O que deixou passar' }), csvBotao(ui, 'deixou-passar')));
    caixa.append(el('div', { class: 'dp-mini' }, mini(fmtN(dp.semResposta), `sem resposta > ${s.f.limite} min`), mini(fmtN(dp.iaAssumiu), 'a IA teve que assumir'), mini(fmtN(dp.perdidos.length), 'leads perdidos'), mini(fmtN(dp.lembretesNaoFeitos.length), 'ligações não feitas')));
    const lista = el('div', { class: 'dp-lista' });
    for (const x of dp.esperas.slice(0, 12)) lista.append(itemConversa(ui, x.cliente, `${fmtQuando(x.desde)} · ${x.respondeu ? (x.respondeu === 'ia' ? 'a IA respondeu' : 'respondida') : 'ainda esperando'}`, fmtMin(x.esperaMin), x.conversaId));
    for (const x of dp.perdidos) lista.append(itemConversa(ui, x.cliente, `Perdida em ${fmtQuando(x.em)}`, x.motivo, x.conversaId));
    for (const x of dp.lembretesNaoFeitos) lista.append(itemConversa(ui, x.cliente, `${x.texto} · era ${fmtQuando(x.quando)}`, 'Não ligou', x.conversaId));
    caixa.append(lista.children.length ? lista : el('div', { class: 'dp-vazio', text: 'Nada ficou para trás. 👏' }));
    return caixa;
  }

  function blocoEquipe(ui, d) {
    const el = ui.el;
    const crit = s.criterio || 'agendamentos';
    const CRIT = { agendamentos: ['Agendamentos', (a) => a.agendamentos, fmtN], valor: ['Valor', (a) => a.valor, fmtR], conversao: ['Conversão', (a) => a.conversao, (v) => `${String(v).replace('.', ',')}%`], tempo: ['1ª resposta (mais rápida)', (a) => (a.primeiraResposta.mediaMs === null ? 0 : 1 / (1 + a.primeiraResposta.mediaMs / 60000)), null] };
    const [nomeC, fC, fmtC] = CRIT[crit];
    const ordenadas = d.atendentes.slice().filter((a) => crit !== 'tempo' || a.primeiraResposta.mediaMs !== null).sort((a, b) => fC(b) - fC(a));
    const trilhoC = el('div', { class: 'dp-trilho dp-vidro' }, ...Object.entries(CRIT).map(([k, v]) => el('button', { type: 'button', 'aria-pressed': String(k === crit), text: v[0].split(' (')[0], onclick: () => { s.criterio = k; desenharTudo(); } })));
    const ranking = painel(ui, 'Ranking de atendentes', [], ui.el('div', { style: 'margin:-4px 0 14px' }, trilhoC),
      crit === 'tempo' ? barras(ui, ordenadas, (a) => a.primeiraResposta.mediaMs / 60000, (a) => a.nome, (v) => fmtMin(v)) : barras(ui, ordenadas, fC, (a) => a.nome, fmtC));
    const ia = d.iaEquipe.ia, eq = d.iaEquipe.equipe;
    const lado = (t, x) => el('div', {}, el('h3', { text: t }), el('p', {}, el('span', { text: 'Mensagens' }), el('b', { text: fmtN(x.mensagens) })), el('p', {}, el('span', { text: '1ª respostas' }), el('b', { text: fmtN(x.primeiras) })), el('p', {}, el('span', { text: '1ª resposta média' }), el('b', { text: fmtT(x.primeiraMediaMs) })), el('p', {}, el('span', { text: 'Agendamentos' }), el('b', { text: fmtN(x.agendamentos) })), el('p', {}, el('span', { text: 'Valor' }), el('b', { text: fmtR(x.valor) })));
    const tot = d.totais;
    const valorBloco = painel(ui, 'Com valor × sem valor', [], barras(ui, [{ n: 'Com valor', v: tot.comValor }, { n: 'Sem valor', v: tot.semValor }], (x) => x.v, (x) => x.n), el('p', { class: 'dp-legenda', text: `Soma: ${fmtR(tot.valor)} · valor gravado no agendamento ou da tabela de preços do Comercial.` }));
    const tl = el('div', { class: 'dp-tl' }, el('div', { class: 'dp-tl-l' }, el('span', { text: '' }), ...Array.from({ length: 24 }, (_, h) => el('span', { style: 'text-align:center;color:var(--sub)', text: h % 3 === 0 ? String(h) : '' }))));
    const maxTl = Math.max(1, ...d.linhaDoTempo.pessoas.flatMap((p) => p.horas));
    for (const p of d.linhaDoTempo.pessoas) tl.append(el('div', { class: 'dp-tl-l' }, el('span', { text: p.nome, title: p.nome }), ...p.horas.map((v, h) => el('i', { title: `${p.nome} · ${h}h: ${v} mensagens`, style: v ? `background:var(--serie);opacity:${(0.25 + 0.75 * (v / maxTl)).toFixed(2)}` : '' }))));
    return [
      el('div', { class: 'dp-grade2' }, ranking, painel(ui, 'IA × equipe', [], el('div', { class: 'dp-ve' }, lado('Equipe', eq), lado('IA', ia)))),
      el('div', { class: 'dp-grade2' },
        painel(ui, 'Profissionais mais agendados', [csvBotao(ui, 'profissionais')], barras(ui, d.profissionais.slice(0, 10), (p) => p.agendamentos, (p) => `${p.nome} · ${fmtR(p.valor)}`)),
        painel(ui, 'Serviços mais vendidos', [csvBotao(ui, 'servicos')], barras(ui, d.servicos.slice(0, 10), (x) => x.agendamentos, (x) => `${x.servico} · ${fmtR(x.valor)}`))),
      el('div', { class: 'dp-grade2' },
        painel(ui, 'Clientes que mais agendaram', [csvBotao(ui, 'clientes')], d.clientes.length ? el('div', { class: 'dp-lista' }, ...d.clientes.slice(0, 8).map((c) => itemConversa(ui, c.cliente, fmtR(c.valor), `${c.agendamentos}×`, c.conversaId))) : el('div', { class: 'dp-vazio', text: 'Nada no período.' })),
        valorBloco),
      el('div', { class: 'dp-grade2' },
        painel(ui, 'Pico de mensagens', [el('span', { class: 'dp-dica', text: d.picos.mensagens ? `Mais cheio: ${DIAS[d.picos.mensagens.diaSemana]} às ${d.picos.mensagens.hora}h` : '' })], linhaHoras(ui, porHoraDe(d.calor.mensagens), 'Mensagens por hora'), calor(ui, d.calor.mensagens, 'Mensagens por dia e hora')),
        painel(ui, 'Pico de agendamentos', [el('span', { class: 'dp-dica', text: d.picos.agendamentos ? `Mais agendou: ${DIAS[d.picos.agendamentos.diaSemana]} às ${d.picos.agendamentos.hora}h` : '' })], linhaHoras(ui, porHoraDe(d.calor.agendamentos), 'Agendamentos por hora'), calor(ui, d.calor.agendamentos, 'Agendamentos por dia e hora'))),
      painel(ui, `Linha do tempo · ${fmtDia(d.linhaDoTempo.dia)}`, [el('span', { class: 'dp-dica', text: 'Quem estava atendendo em cada hora (mensagens enviadas)' })], d.linhaDoTempo.pessoas.length ? tl : el('div', { class: 'dp-vazio', text: 'Ninguém da equipe mandou mensagem nesse dia.' })),
    ];
  }

  function blocoFila(ui, d) {
    const el = ui.el;
    const lista = el('div', { class: 'dp-lista' }, ...d.fila.map((f) => itemConversa(ui, f.cliente, `${f.dona || 'Sem dona'} · ${UNI[f.unidade] || f.unidade} · desde ${fmtQuando(f.desde)}`, fmtMin(f.esperaMin), f.conversaId)));
    for (const [i, f] of d.fila.entries()) if (f.esperaMin > Number(s.f.limite)) lista.children[i].querySelector('em').classList.add('dp-ruim');
    return [painel(ui, 'Esperando resposta agora', [el('span', { class: 'dp-dica', text: 'Da espera mais longa para a mais curta · toque para abrir' }), csvBotao(ui, 'fila')], d.fila.length ? lista : el('div', { class: 'dp-vazio', text: 'Ninguém esperando. 🎉' }))];
  }

  // ---------------------------------------------------------------- tela
  function controles(ui) {
    const el = ui.el;
    const o = s.dados?.opcoes || { unidades: [], atendentes: [] };
    const trilho = el('div', { class: 'dp-trilho dp-vidro', role: 'group', 'aria-label': 'Período' }, ...PERIODOS.map(([k, n]) => el('button', { type: 'button', 'aria-pressed': String(s.f.periodo === k), text: n, onclick: () => { s.f.periodo = k; gravarFiltro(); carregar(); } })));
    const sel = (rot, chave, opcoes) => {
      const x = el('select', { 'aria-label': rot, onchange: (e) => { s.f[chave] = e.target.value; gravarFiltro(); carregar(); } }, ...opcoes.map(([v, n]) => el('option', { value: v, text: n })));
      x.value = s.f[chave];
      return el('label', { class: 'dp-campo dp-vidro' }, el('span', { text: rot }), x);
    };
    const filhos = [trilho];
    if (s.f.periodo === 'personalizado') {
      const data = (chave, rot) => el('label', { class: 'dp-campo dp-vidro' }, el('span', { text: rot }), Object.assign(el('input', { type: 'date', onchange: (e) => { s.f[chave] = e.target.value; gravarFiltro(); carregar(); } }), { value: s.f[chave] }));
      filhos.push(data('de', 'De'), data('ate', 'Até'));
    }
    filhos.push(sel('Unidade', 'unidade', [['', 'Todas'], ...o.unidades.map((u) => [u.id, u.nome])]), sel('Atendente', 'atendente', [['', 'Todas'], ...o.atendentes.map((a) => [a.id, a.nome])]), sel('Sem resposta após', 'limite', [['5', '5 min'], ['15', '15 min'], ['30', '30 min'], ['60', '1 hora']]));
    return el('div', { class: 'dp-controles' }, ...filhos);
  }

  function desenharTudo() {
    const ui = s.ui, el = ui.el, d = s.dados;
    const quando = d ? (s.f.periodo === 'hoje' ? 'Hoje até agora' : `${new Date(d.periodo.inicio).toLocaleDateString('pt-BR')} a ${new Date(new Date(d.periodo.fim).getTime() - 1).toLocaleDateString('pt-BR')}`) : 'Carregando…';
    const raiz = el('div', { class: 'dp' }, el('div', { class: 'dp-topo' }, el('h1', { class: 'titulo-grande', text: 'Desempenho' }), el('small', { text: `Atendimento · ${quando}` })), controles(ui));
    if (s.erro) raiz.append(el('div', { class: 'dp-erro dp-vidro' }, el('b', { text: 'Não deu para carregar. ' }), el('span', { text: s.erro })));
    if (d) {
      const t = d.totais;
      const g = (v, r, alerta) => el('div', { class: 'dp-grande dp-vidro' + (alerta ? ' dp-alerta' : '') }, el('b', { text: v }), el('span', { text: r }));
      raiz.append(el('div', { class: 'dp-grandes' },
        g(fmtN(t.conversas), 'conversas no período'), g(fmtN(t.agendamentos), `agendamentos · ${t.comValor} com valor`), g(fmtR(t.valor), 'valor agendado'),
        g(fmtT(t.primeiraRespostaMedianaMs), '1ª resposta (mediana)'), g(fmtN(t.semResposta), `esperas > ${s.f.limite} min`, t.semResposta > 0), g(fmtN(d.fila.length), 'esperando agora', d.fila.length > 0)));
      raiz.append(el('div', { class: 'dp-trilho dp-vidro', role: 'tablist' }, ...ABAS.map(([k, n]) => el('button', { type: 'button', role: 'tab', 'aria-pressed': String(s.aba === k), text: k === 'fila' ? `${n} (${d.fila.length})` : n, onclick: () => { s.aba = k; desenharTudo(); } }))));
      raiz.append(...(s.aba === 'atendentes' ? blocoAtendentes(ui, d) : s.aba === 'equipe' ? blocoEquipe(ui, d) : blocoFila(ui, d)));
    }
    s.caixa.replaceChildren(raiz);
  }

  async function carregar() {
    const g = ++s.geracao;
    if (s.f.periodo === 'personalizado' && (!s.f.de || !s.f.ate)) { s.erro = null; desenharTudo(); return; }
    if (s.dados) desenharTudo();
    try {
      const r = await s.ui.api('/api/desempenho?' + consulta());
      if (g !== s.geracao) return;
      s.dados = r; s.erro = null;
    } catch (x) {
      if (g !== s.geracao) return;
      s.erro = x.message || 'Verifique a internet e tente de novo.';
      if (x.status === 403 || x.status === 400) { s.f = { periodo: 'hoje', de: '', ate: '', unidade: '', atendente: '', limite: '15' }; gravarFiltro(); }
    }
    if (s.caixa?.isConnected) desenharTudo();
  }

  window.SintoniaTelas.desempenho = {
    async desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa; s.ui = ui;
      caixa.classList.add('dp-caixa');
      if (ui.estado.eu && !ui.estado.eu.permissoes?.relatorios) {
        caixa.replaceChildren(ui.el('div', { class: 'dp' }, ui.el('h1', { class: 'titulo-grande', text: 'Desempenho' }), ui.el('div', { class: 'dp-erro dp-vidro' }, ui.el('b', { text: 'Só para quem vê relatórios. ' }), ui.el('span', { text: 'Seus números estão no Dashboard.' }))));
        return;
      }
      desenharTudo();
      await carregar();
      // A fila muda o tempo todo: atualiza a cada minuto enquanto a tela está aberta.
      clearInterval(s.timer);
      s.timer = setInterval(() => { if (s.caixa?.isConnected && document.getElementById('v-desempenho')?.classList.contains('ativa') && !document.hidden) carregar(); else if (!document.getElementById('v-desempenho')?.classList.contains('ativa')) clearInterval(s.timer); }, 60_000);
    },
  };
})();
