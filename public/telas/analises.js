/* Tela "analises" da Sintonia: registra window.SintoniaTelas.analises = { desenhar(caixa, ui), focar(aba) }.
 * Menu Análises › Vendas e receita, Clientes e satisfação, Horários e funil e Painel da TV. Abas:
 *   vendas      receita por dia, por quem vendeu, por serviço, por unidade e campanhas/origens que viraram venda
 *   clientes    novas × quem voltou, intervalo entre visitas, clientes fiéis e as que sumiram (para chamar de volta)
 *   satisfacao  NPS (o mesmo painel do Relatório geral, de src/nps)
 *   horarios    picos de leads, mensagens e agendamentos (dia da semana × hora)
 *   funil       tempo parado em cada etapa, quem está parado agora e motivos de perda
 *   perdas      perdas por motivo, pela etapa em que o lead estava, por quem atendia e pela origem (perdas-saude)
 *   tv          link do Painel na TV (copiar, abrir, gerar novo, revogar) e prévia
 *   dia         Dia a dia: leads novos × agendaram no dia, por dia de chegada e grupo de leads (telas/relatorio-dia.js)
 *   saude       saúde do sistema: filas, tempo até aparecer, IA, mídias, WhatsApp, processo e banco (telas/saude.js)
 * Dados: /api/analises/:tipo (src/analises). Mesmo visual do Relatório geral (classes .rl- de relatorios.js) e,
 * no computador, toda a largura com margem de 28px como o Dashboard. Texto do servidor sempre por textContent.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ABAS = [
    ['dia', 'Dia a dia'], // relatorio-dia: leads novos × agendamentos (telas/relatorio-dia.js)
    ['vendas', 'Vendas'],
    ['clientes', 'Clientes'],
    ['satisfacao', 'Satisfação'],
    ['horarios', 'Horários'],
    ['funil', 'Funil'],
    ['perdas', 'Perdas'], // perdas-saude
    ['tv', 'Painel da TV'],
    ['saude', 'Saúde do sistema'], // perdas-saude
  ];
  const PERIODOS = [['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['personalizado', 'Período']];
  const TABELAS = {
    vendas: [['dias', 'Receita por dia'], ['atendentes', 'Por quem vendeu'], ['servicos', 'Por serviço'], ['produtos', 'Produtos vinculados aos leads'], ['origens', 'Campanhas e origens'], ['unidades', 'Por unidade']],
    clientes: [['resumo', 'Resumo de clientes'], ['fieis', 'Clientes fiéis'], ['sumidas', 'Para chamar de volta']],
    horarios: [['leads', 'Leads por dia e hora'], ['mensagens', 'Mensagens por dia e hora'], ['agendamentos', 'Agendamentos por dia e hora']],
    funil: [['etapas', 'Tempo em cada etapa'], ['paradas', 'Paradas há mais tempo'], ['perdas', 'Motivos de perda']],
    perdas: [['motivos', 'Perdas por motivo'], ['etapas', 'Por etapa em que perdeu'], ['atendentes', 'Por quem atendia'], ['origens', 'Por origem do lead'], ['lista', 'Todas as perdas do período']], // perdas-saude
  };
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const DIAS_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const CHAVE = 'sintonia.analises.filtro';
  const CHAVE_ABA = 'sintonia.analises.aba';
  const CORES = ['var(--azul-serie)', 'var(--marca-menta)', '#7cc4ff', '#19c3a6', '#9db8ff', '#f5b800', '#ff7a59'];

  const CSS = `
  .an-caixa.an-caixa { grid-template-columns: minmax(0, 1fr); overflow-x: hidden; padding: 14px 16px 0; gap: 0; }
  @media (min-width: 761px) { .an-caixa.an-caixa { padding: 22px 28px 0; } }
  .an.rl { max-width: none; margin: 0; }
  .an-kpis { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
  @media (max-width: 560px) { .an-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }
  .an-kpi { border-radius: 22px; padding: 14px 16px; display: grid; gap: 6px; align-content: start; min-width: 0; }
  .an-kpi small { font-size: 12.5px; color: var(--sub); font-weight: 600; display: flex; align-items: center; gap: 6px; min-width: 0; }
  .an-kpi small span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-kpi b { font-size: 26px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; overflow-wrap: anywhere; }
  .an-kpi em { font-style: normal; font-size: 12.5px; color: var(--sub); line-height: 1.35; }
  @media (max-width: 560px) { .an-kpi { padding: 12px 13px; border-radius: 18px; } .an-kpi b { font-size: 21px; } }
  .an-chip { justify-self: start; font-size: 11.5px; font-weight: 800; padding: 3px 8px; border-radius: 999px; background: var(--vidro-item); color: var(--sub); font-variant-numeric: tabular-nums; }
  .an-chip.sobe { background: color-mix(in srgb, #19c3a6 16%, transparent); color: #0a8f7a; }
  .an-chip.desce { background: color-mix(in srgb, #ff7a59 16%, transparent); color: #c2410c; }
  html[data-tema="escuro"] .an-chip.sobe { color: #0ffcbe; } html[data-tema="escuro"] .an-chip.desce { color: #ff9a7f; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .an-chip.sobe { color: #0ffcbe; } html:not([data-tema="claro"]) .an-chip.desce { color: #ff9a7f; } }
  .an-svg { width: 100%; height: auto; display: block; overflow: visible; }
  .an-svg text { fill: var(--sub); font-size: 11px; font-family: var(--fonte); }
  .an-svg .an-grid { stroke: var(--vidro-linha); stroke-width: 1; }
  .an-svg .an-col { fill: url(#an-degrade); }
  .an-svg .an-col.vazia { fill: var(--vidro-item); }
  .an-svg .an-alvo { fill: transparent; cursor: pointer; }
  .an-svg .an-alvo:hover + .an-col, .an-svg .an-col.ativa { filter: brightness(1.12); }
  .an-calor { display: grid; grid-template-columns: 34px repeat(24, minmax(0, 1fr)); gap: 3px; font-size: 10.5px; color: var(--sub); font-variant-numeric: tabular-nums; }
  .an-calor span { display: flex; align-items: center; min-width: 0; overflow: hidden; }
  .an-calor .an-h { justify-content: center; }
  .an-calor i { display: block; height: 26px; border-radius: 5px; background: var(--vidro-item); min-width: 0; }
  @media (max-width: 560px) { .an-calor { gap: 2px; grid-template-columns: 28px repeat(24, minmax(0, 1fr)); } .an-calor i { border-radius: 3px; height: auto; aspect-ratio: 1; } }
  .an-escala { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--sub); }
  .an-escala i { width: 90px; height: 8px; border-radius: 999px; background: linear-gradient(90deg, var(--vidro-item), var(--an-calor)); }
  .an { --an-calor: #106ebe; }
  html[data-tema="escuro"] .an { --an-calor: #3aa0ff; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .an { --an-calor: #3aa0ff; } }
  .an-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--vidro-item); flex-wrap: wrap; }
  .an-seg button { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; color: var(--sub); }
  .an-seg button[aria-pressed="true"] { background: linear-gradient(90deg, #106ebe, #3aa0ff); color: #fff; }
  .an-seg button:focus-visible, .an-link:focus-visible, .an-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .an-split { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--vidro-item); gap: 3px; }
  .an-split i { display: block; height: 100%; border-radius: 999px; }
  .an-lista { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr)); }
  .an-rank { display: grid; gap: 12px; }
  .an-rank-l { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; align-items: center; }
  .an-rank-l .rl-pessoa { min-width: 0; font-size: 14px; }
  .an-rank-l .rl-pessoa > :last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-rank-l > b { font-variant-numeric: tabular-nums; font-size: 15px; text-align: right; }
  .an-rank-l .rl-trilha { grid-column: 1 / -1; }
  .an-rank-l small { grid-column: 1 / -1; font-size: 12.5px; color: var(--sub); margin-top: -2px; }
  .an-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; padding: 10px 12px; border-radius: 16px; background: var(--vidro-item); }
  .an-item b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-item small { grid-column: 1; font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .an-item .an-tempo { grid-row: 1 / span 2; grid-column: 2; text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; font-size: 14px; display: grid; gap: 4px; justify-items: end; }
  .an-link { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 800; color: var(--azul-serie); }
  .an-etapas { display: grid; gap: 10px; }
  .an-etapa { display: grid; grid-template-columns: minmax(120px, 1.1fr) minmax(0, 2.4fr) repeat(3, minmax(70px, .7fr)); gap: 10px 14px; align-items: center; padding: 12px 14px; border-radius: 18px; background: var(--vidro-item); font-size: 13.5px; }
  .an-etapa > b { font-size: 14.5px; }
  .an-etapa .rl-trilha { height: 10px; }
  .an-etapa .an-v { text-align: right; font-variant-numeric: tabular-nums; font-weight: 800; }
  .an-etapa .an-v small { display: block; font-size: 11px; color: var(--sub); font-weight: 600; }
  .an-etapa .an-v small.an-rot { display: none; }
  .an-etapa { padding: 10px 14px; }
  .an-etapa .an-dest { grid-column: 1 / -1; font-size: 12.5px; color: var(--sub); }
  .an-cab-etapas { display: grid; grid-template-columns: minmax(120px, 1.1fr) minmax(0, 2.4fr) repeat(3, minmax(70px, .7fr)); gap: 14px; padding: 0 14px; font-size: 11.5px; color: var(--sub); font-weight: 700; }
  .an-cab-etapas span:nth-child(n+3) { text-align: right; }
  @container rlpainel (max-width: 640px) {
    .an-cab-etapas { display: none; }
    .an-etapa { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .an-etapa > b, .an-etapa > .rl-trilha, .an-etapa > .rl-vazio { grid-column: 1 / -1; }
    .an-etapa .an-v { text-align: left; }
    .an-etapa .an-v small.an-rot { display: block; }
  }
  .an-tv { display: grid; gap: 14px; }
  .an-tv-link { font-family: var(--fonte-mono); font-size: 13.5px; padding: 12px 14px; border-radius: 14px; background: var(--vidro-item); overflow-wrap: anywhere; user-select: all; }
  .an-acoes { display: flex; flex-wrap: wrap; gap: 8px; }
  .an-bt { all: unset; cursor: pointer; box-sizing: border-box; min-height: 44px; display: inline-flex; align-items: center; gap: 7px; padding: 0 18px; border-radius: 999px; font-weight: 800; font-size: 14px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); }
  .an-bt.principal { background: linear-gradient(90deg, #106ebe, #3aa0ff); color: #fff; box-shadow: none; }
  .an-bt.perigo { color: #e5383b; }
  .an-bt svg { width: 17px; height: 17px; }
  .an-op { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--texto); cursor: pointer; }
  .an-op input { width: 20px; height: 20px; accent-color: #106ebe; }
  .an-tela16 { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 18px; overflow: hidden; background: #061527; box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .an-tela16 iframe { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; border: 0; transform-origin: 0 0; }
  .an-passos { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 14px; color: var(--sub); line-height: 1.45; }
  @media (min-width: 1100px) { .rl-grade .an-g3 { grid-column: span 3; } .rl-grade .an-g5 { grid-column: span 5; } .rl-grade .an-g7 { grid-column: span 7; } .rl-grade .an-g9 { grid-column: span 9; } }
  `;

  const IC = {
    baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    abrir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
    tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12.5" rx="2.5"/><path d="M8 20.5h8M12 17v3.5"/></svg>',
  };

  // ---------------------------------------------------------------- formatos
  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  const fmtPct = (v) => (v == null ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')}%`);
  const fmtR = (v, centavos = false) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: centavos ? 2 : 0, maximumFractionDigits: centavos ? 2 : 0 }));
  function fmtDur(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    const min = Math.round(ms / 60000);
    if (min < 1) return '< 1 min';
    if (min < 60) return `${min} min`;
    const h = ms / 3600000;
    if (h < 48) return `${String(Math.round(h * 10) / 10).replace('.', ',')} h`;
    const d = Math.round(h / 24);
    return `${d} dias`;
  }
  const hojeBahia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diaCurto = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };
  const dataLonga = (d) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Bahia' }).format(new Date(d)).replace('.', '');
  const dataCurta = (d) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Bahia' }).format(new Date(d));
  const iniciais = (n) => String(n || '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const hora = (h) => `${h}h`;

  // ---------------------------------------------------------------- estado
  const ler = (k, padrao) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null') ?? padrao; } catch { return padrao; } };
  const gravar = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
  const FILTRO0 = { periodo: '30d', de: '', ate: '', unidade: '', atendente: '' };
  const s = { aba: ler(CHAVE_ABA, 'vendas'), f: ler(CHAVE, FILTRO0), dados: {}, erro: null, geracao: 0, caixa: null, ui: null, opcoes: null, serie: 'leads', tv: null, previa: false };

  function estilo() {
    window.SintoniaTelas.relatorios?.estilo?.();
    if (document.getElementById('estilo-analises')) return;
    const st = document.createElement('style');
    st.id = 'estilo-analises';
    st.textContent = CSS;
    document.head.append(st);
  }

  function consulta() {
    const q = new URLSearchParams({ periodo: s.f.periodo });
    if (s.f.periodo === 'personalizado') { q.set('de', s.f.de); q.set('ate', s.f.ate); }
    if (s.f.unidade) q.set('unidade', s.f.unidade);
    if (s.f.atendente) q.set('atendente', s.f.atendente);
    return q.toString();
  }
  const csvDe = (tipo, tabela) => `/api/analises/${tipo}/csv?${consulta()}&tabela=${encodeURIComponent(tabela)}`;
  const chaveDados = () => `${s.aba}?${consulta()}`;

  // ---------------------------------------------------------------- pedaços
  function painel(nome, titulo, sub, classe, csv, ...filhos) {
    const el = s.ui.el;
    const bt = csv ? el('a', { class: 'rl-redondo', href: csv, download: '', title: `Exportar "${titulo}" (CSV)`, 'aria-label': `Exportar ${titulo} em CSV`, html: IC.baixar }) : null;
    return el('section', { class: `rl-painel rl-vidro ${classe || ''}`, 'aria-label': titulo, 'data-an': nome },
      el('div', { class: 'rl-cab' }, el('h2', {}, titulo, sub ? el('small', { text: sub }) : null), bt), ...filhos);
  }
  const vazio = (txt) => s.ui.el('div', { class: 'rl-vazio', text: txt });

  function kpi(rotulo, valor, nota, chip) {
    const el = s.ui.el;
    return el('div', { class: 'an-kpi rl-vidro', role: 'listitem' },
      el('small', {}, el('span', { text: rotulo })),
      el('b', { text: valor }),
      chip ? el('span', { class: `an-chip ${chip.classe || ''}`, text: chip.texto }) : null,
      nota ? el('em', { text: nota }) : null);
  }
  const chipVar = (v, rotulo = 'vs período anterior') => (v == null ? { texto: 'sem comparação' } : { texto: `${v > 0 ? '▲' : v < 0 ? '▼' : ''} ${fmtPct(Math.abs(v))} ${rotulo}`.trim(), classe: v > 0 ? 'sobe' : v < 0 ? 'desce' : '' });

  function barras(itens) {
    const el = s.ui.el;
    const max = Math.max(1, ...itens.map((x) => x.valor));
    return el('div', { class: 'rl-barras', role: 'list' }, ...itens.map((x) =>
      el('div', { class: 'rl-barra', role: 'listitem', 'aria-label': `${x.nome}: ${x.rotulo ?? x.valor}` },
        el('span', {}, x.cor ? el('i', { class: 'rl-bol', style: `background:${x.cor}` }) : null, x.nome),
        el('span', { class: 'rl-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(2, (x.valor / max) * 100)}%${x.cor ? `;background:${x.cor}` : ';background:linear-gradient(90deg,#106ebe,#3aa0ff)'}` })),
        el('b', {}, x.rotulo ?? fmtN(x.valor), x.nota ? el('small', { text: x.nota }) : null))));
  }

  /** Colunas (SVG) com dica ao passar o dedo/mouse. pontos: [{ rotulo, valor, dica }]. */
  function colunas(pontos, { aria, fmt = fmtN, altura } = {}) {
    const NS = 'http://www.w3.org/2000/svg';
    const larguraCaixa = s.caixa?.clientWidth || 700;
    const W = Math.round(Math.max(300, Math.min(1400, larguraCaixa * (window.innerWidth >= 1100 ? 0.62 : 1) - 70)));
    const H = altura || (W < 600 ? 170 : 220);
    const esq = 44, dir = 6, topo = 12, base = H - 22;
    const max = Math.max(1, ...pontos.map((p) => p.valor)) * 1.12;
    const passo = (W - esq - dir) / Math.max(1, pontos.length);
    const larg = Math.max(3, Math.min(34, passo * 0.64));
    const y = (v) => base - (v / max) * (base - topo);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'an-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', aria || '');
    const add = (tag, at, txt, pai = svg) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) n.setAttribute(k, v); if (txt != null) n.textContent = txt; pai.append(n); return n; };
    const defs = add('defs', {});
    const g = add('linearGradient', { id: 'an-degrade', x1: 0, y1: 1, x2: 0, y2: 0 }, null, defs);
    add('stop', { offset: '0%', 'stop-color': '#106ebe' }, null, g);
    add('stop', { offset: '100%', 'stop-color': '#3aa0ff' }, null, g);
    // Linhas de grade em números redondos (1, 2, 5 × 10ⁿ).
    const bruto = max / 3.5;
    const pot = 10 ** Math.floor(Math.log10(Math.max(1, bruto)));
    const passoY = [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= bruto) || pot * 10;
    for (let v = 0; v <= max; v += passoY) {
      add('line', { x1: esq, x2: W - dir, y1: y(v), y2: y(v), class: 'an-grid' });
      add('text', { x: esq - 8, y: y(v) + 4, 'text-anchor': 'end' }, v === 0 ? '0' : fmt(v).replace(/\s/g, ' '));
    }
    const caixa = s.ui.el('div', { style: 'position:relative' });
    const dica = s.ui.el('div', { class: 'rl-dica', hidden: '' });
    const cada = Math.ceil(pontos.length / Math.max(4, Math.floor(W / 56)));
    pontos.forEach((p, i) => {
      const cx = esq + passo * i + passo / 2;
      const alvo = add('rect', { x: cx - passo / 2, y: 0, width: passo, height: H, class: 'an-alvo' });
      const alt = Math.max(p.valor ? 3 : 2, base - y(p.valor));
      const col = add('rect', { x: cx - larg / 2, y: base - alt, width: larg, height: alt, rx: Math.min(6, larg / 2), class: p.valor ? 'an-col' : 'an-col vazia' });
      if (i % cada === 0 || i === pontos.length - 1) add('text', { x: cx, y: H - 4, 'text-anchor': 'middle' }, p.rotulo);
      const mostrar = () => {
        const k = svg.getBoundingClientRect().width / W;
        svg.querySelectorAll('.an-col.ativa').forEach((x) => x.classList.remove('ativa'));
        col.classList.add('ativa');
        dica.replaceChildren(s.ui.el('b', { text: p.dica || fmt(p.valor) }), p.rotuloLongo || p.rotulo);
        dica.style.left = `${cx * k}px`; dica.style.top = `${(base - alt) * k}px`; dica.hidden = false;
      };
      alvo.addEventListener('pointerenter', mostrar);
      alvo.addEventListener('click', mostrar);
    });
    svg.addEventListener('pointerleave', () => { dica.hidden = true; svg.querySelectorAll('.an-col.ativa').forEach((x) => x.classList.remove('ativa')); });
    caixa.append(svg, dica);
    return caixa;
  }

  /** Mapa de calor dia da semana × hora (grade 7 × 24). */
  function calor(grade, rotulo) {
    const el = s.ui.el;
    const max = Math.max(1, ...grade.flat());
    const filhos = [el('span', {})];
    for (let h = 0; h < 24; h++) filhos.push(el('span', { class: 'an-h', text: h % 3 === 0 ? String(h) : '' }));
    grade.forEach((linha, d) => {
      filhos.push(el('span', { text: DIAS[d] }));
      linha.forEach((v, h) => {
        const p = v ? Math.round(18 + (v / max) * 82) : 0;
        filhos.push(el('i', { title: `${DIAS_LONGO[d]}, ${h}h: ${v}`, style: v ? `background:color-mix(in srgb, var(--an-calor) ${p}%, var(--vidro-item))` : '' }));
      });
    });
    return el('div', { style: 'display:grid;gap:10px' },
      el('div', { class: 'an-calor', role: 'img', 'aria-label': `${rotulo} por dia da semana e hora` }, ...filhos),
      el('div', { class: 'an-escala' }, 'menos', el('i', {}), 'mais'));
  }

  function tabela(cols, linhas, primeira = 'Nome') {
    const el = s.ui.el;
    return el('table', { class: 'rl-tabela' },
      el('thead', {}, el('tr', {}, el('th', { text: primeira }), ...cols.map(([, t]) => el('th', { text: t })))),
      el('tbody', {}, ...linhas.map((l) => el('tr', {}, el('td', {}, l.nomeEl || l.nome), ...cols.map(([k, t, f]) => el('td', { 'data-r': t, class: l[k] ? '' : 'rl-zero', text: f(l[k], l) }))))));
  }
  const pessoa = (nome, id, sigla) => {
    const el = s.ui.el;
    const ini = el('span', { class: 'rl-ini', text: sigla || iniciais(nome) });
    return el('span', { class: 'rl-pessoa' }, (id && window.SintoniaFotos?.aplicar?.(ini, id)) || ini, nome);
  };
  const abrirConversa = (id) => el2('button', { class: 'an-link', type: 'button', text: 'Abrir conversa', onclick: () => s.ui.abrir(id) });
  const el2 = (...a) => s.ui.el(...a);

  // ---------------------------------------------------------------- abas
  function abaVendas(r) {
    const el = s.ui.el;
    const t = r.totais;
    const kpis = el('div', { class: 'an-kpis', role: 'list', 'aria-label': 'Resumo de vendas' },
      kpi('Receita no período', fmtR(t.receita), t.semValor ? `${fmtN(t.semValor)} sem valor informado` : 'agendamentos com valor', chipVar(t.variacaoReceitaPct)),
      kpi('Vendas (agendamentos)', fmtN(t.vendas), `antes: ${fmtN(t.anterior.vendas)}`, chipVar(t.variacaoVendasPct)),
      kpi('Ticket médio', fmtR(t.ticketMedio, true), 'por venda com valor'),
      kpi('Compareceram', fmtPct(t.comparecimentoPct), `${fmtR(t.receitaConfirmada)} confirmados`),
      kpi('Vendidas pela IA', fmtN(t.ia.vendas), t.ia.receita ? fmtR(t.ia.receita) : 'sem valor informado'));
    const porDia = r.dias.length > 1
      ? colunas(r.dias.map((d) => ({ rotulo: diaCurto(d.dia), rotuloLongo: `${diaCurto(d.dia)} · ${fmtN(d.vendas)} ${d.vendas === 1 ? 'venda' : 'vendas'}`, valor: d.receita, dica: fmtR(d.receita) })), { aria: `Receita por dia: total ${fmtR(t.receita)}`, fmt: (v) => fmtR(v) })
      : el('div', { class: 'rl-destaque' }, el('b', { text: fmtR(t.receita) }), el('span', { text: `em ${fmtN(t.vendas)} ${t.vendas === 1 ? 'venda' : 'vendas'} hoje` }));
    const unidades = r.unidades.length
      ? barras(r.unidades.map((u, i) => ({ nome: u.nome, valor: u.receita, rotulo: fmtR(u.receita), nota: `${fmtN(u.vendas)} vendas`, cor: CORES[i % CORES.length] })))
      : vazio('Sem vendas no período.');
    const maxR = Math.max(1, ...r.atendentes.map((a) => a.receita || a.vendas));
    const at = r.atendentes.length
      ? el('div', { class: 'an-rank', role: 'list' }, ...r.atendentes.map((a) => el('div', { class: 'an-rank-l', role: 'listitem' },
        a.porIa && window.SintoniaSerenaSelo ? el('span', { class: 'rl-pessoa' }, window.SintoniaSerenaSelo({ classe: 'rl-ini', titulo: 'Vendas da Serena (IA)' }), a.nome) : pessoa(a.nome, a.porIa ? null : a.id, a.porIa ? 'IA' : null), /* conversa-extra */
        el('b', { text: fmtR(a.receita) }),
        el('span', { class: 'rl-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(2, ((a.receita || a.vendas) / maxR) * 100)}%;background:${a.porIa ? 'var(--marca-menta)' : 'linear-gradient(90deg,#106ebe,#3aa0ff)'}` })),
        el('small', { text: `${fmtN(a.vendas)} ${a.vendas === 1 ? 'venda' : 'vendas'} · ticket ${fmtR(a.ticketMedio)} · ${fmtPct(a.comparecimentoPct)} compareceram` }))))
      : vazio('Ninguém vendeu neste período.');
    const sv = r.servicos.length
      ? barras(r.servicos.slice(0, 12).map((x) => ({ nome: x.nome, valor: x.receita || x.vendas, rotulo: fmtR(x.receita), nota: `${fmtN(x.vendas)} · ticket ${fmtR(x.ticketMedio)}` })))
      : vazio('Sem serviços agendados no período.');
    const og = r.origens.length
      ? tabela([['leads', 'Leads', fmtN], ['viraramVenda', 'Compraram', fmtN], ['conversaoPct', 'Conversão', fmtPct], ['vendas', 'Vendas', fmtN], ['receita', 'Receita', (v) => fmtR(v)], ['ticketMedio', 'Ticket', (v) => fmtR(v)]],
        r.origens.map((o) => ({ ...o, nome: o.origem })), 'Origem ou campanha')
      : vazio('Sem leads nem vendas no período.');
    return [
      kpis,
      el('div', { class: 'rl-grade' },
        painel('dias', 'Receita por dia', 'valor dos agendamentos (gravado ou pela tabela de preços)', 'rl-g8', csvDe('vendas', 'dias'), porDia),
        painel('unidades', 'Por unidade', null, 'rl-g4', csvDe('vendas', 'unidades'), unidades),
        painel('atendentes', 'Por quem vendeu', 'atendentes e IA, pela receita', 'rl-g6', csvDe('vendas', 'atendentes'), at),
        painel('servicos', 'Por serviço', 'receita · vendas · ticket médio', 'rl-g6', csvDe('vendas', 'servicos'), sv),
        /* produtos-lead: produtos e serviços vinculados aos leads que compraram no período */
        (r.produtos || []).length ? painel('produtos', 'Produtos e serviços vinculados', 'dos leads que compraram no período (soma dos produtos de cada lead)', 'rl-g12', csvDe('vendas', 'produtos'),
          barras(r.produtos.slice(0, 12).map((x) => ({ nome: x.nome, valor: x.receita || x.quantidade, rotulo: fmtR(x.receita), nota: `${fmtN(x.quantidade)} ${x.quantidade === 1 ? 'unidade' : 'unidades'} · ${fmtN(x.leads)} ${x.leads === 1 ? 'lead' : 'leads'}${x.categoria ? ` · ${x.categoria}` : ''}` })))) : null,
        painel('origens', 'Campanhas e origens que viraram venda', 'leads que chegaram no período e quantos compraram; vendas e receita por origem (anúncio, link rastreado ou campo da ficha)', 'rl-g12', csvDe('vendas', 'origens'), og)),
    ];
  }

  function abaClientes(r) {
    const el = s.ui.el;
    const kpis = el('div', { class: 'an-kpis', role: 'list', 'aria-label': 'Resumo de clientes' },
      kpi('Clientes que agendaram', fmtN(r.clientes), `${fmtN(r.maisDeUmaNoPeriodo)} agendaram mais de uma vez`),
      kpi('Voltaram', fmtN(r.voltaram), 'já tinham agendado antes (12 meses)', r.retornoPct != null ? { texto: `${fmtPct(r.retornoPct)} de retorno`, classe: 'sobe' } : null),
      kpi('Novas', fmtN(r.novas), 'primeira vez que agendaram'),
      kpi('Tempo entre visitas', r.intervaloMedianoDias == null ? '—' : `${String(r.intervaloMedianoDias).replace('.', ',')} dias`, 'mediana de quem voltou'),
      kpi('Receita de quem voltou', fmtR(r.receitaVoltaram), `novas: ${fmtR(r.receitaNovas)}`));
    const tot = r.novas + r.voltaram;
    const split = tot
      ? el('div', { style: 'display:grid;gap:10px' },
        el('div', { class: 'an-split', role: 'img', 'aria-label': `Novas ${r.novas}, voltaram ${r.voltaram}` },
          r.novas ? el('i', { style: `width:${(r.novas / tot) * 100}%;background:#7cc4ff` }) : null,
          r.voltaram ? el('i', { style: `width:${(r.voltaram / tot) * 100}%;background:var(--marca-menta)` }) : null),
        el('div', { class: 'rl-legenda' }, el('span', {}, el('i', { class: 'rl-bol', style: 'background:#7cc4ff' }), 'Novas', el('b', { text: fmtN(r.novas) })), el('span', {}, el('i', { class: 'rl-bol', style: 'background:var(--marca-menta)' }), 'Voltaram', el('b', { text: fmtN(r.voltaram) }))),
        el('div', { class: 'rl-vazio', text: 'Quantas vezes cada uma agendou nos últimos 12 meses:' }),
        barras(r.frequencia.map((f) => ({ nome: f.faixa, valor: f.total }))))
      : vazio('Nenhuma cliente agendou neste período.');
    const fieis = r.fieis.length
      ? tabela([['visitas', 'Visitas', fmtN], ['valor', 'Valor', (v) => fmtR(v)], ['ultima', 'Última', (v) => dataCurta(v)], ['abrir', '', () => '']],
        r.fieis.map((c) => ({ ...c, nome: c.cliente, nomeEl: c.cliente })), 'Cliente')
      : vazio('Ainda não há clientes que voltaram neste período. Quem agendar de novo aparece aqui.');
    if (r.fieis.length) fieis.querySelectorAll('tbody tr').forEach((tr, i) => { const td = tr.lastElementChild; td.textContent = ''; td.append(abrirConversa(r.fieis[i].conversaId)); });
    const sumidas = r.sumidas.lista.length
      ? el('div', { class: 'an-lista' }, ...r.sumidas.lista.map((c) => el('div', { class: 'an-item' },
        el('b', { text: c.cliente }),
        el('small', { text: `${c.visitas} ${c.visitas === 1 ? 'visita' : 'visitas'} · última em ${dataCurta(c.ultima)}${c.ultimoServico ? ' · ' + c.ultimoServico : ''}` }),
        el('span', { class: 'an-tempo' }, `${fmtN(c.diasSem)} dias`, abrirConversa(c.conversaId)))))
      : vazio(`Nenhuma cliente está há mais de ${r.diasSumida} dias sem agendar.`);
    return [
      kpis,
      el('div', { class: 'rl-grade' },
        painel('resumo', 'Novas × quem voltou', 'clientes que agendaram no período', 'rl-g4', csvDe('clientes', 'resumo'), split),
        painel('fieis', 'Clientes fiéis', 'mais visitas nos últimos 12 meses, entre quem agendou no período', 'rl-g8', csvDe('clientes', 'fieis'), fieis),
        painel('sumidas', 'Para chamar de volta', `${fmtN(r.sumidas.total)} ${r.sumidas.total === 1 ? 'cliente está' : 'clientes estão'} há mais de ${r.diasSumida} dias sem agendar (vale para hoje, não depende do período)`, 'rl-g12', csvDe('clientes', 'sumidas'), sumidas)),
    ];
  }

  function abaSatisfacao(r) {
    const el = s.ui.el;
    const nps = window.SintoniaTelas.nps;
    if (!nps) return [vazio('A pesquisa de satisfação ainda não está disponível.')];
    return [el('div', { class: 'rl-grade' }, nps.painelRelatorio(s.ui, r, `/api/nps/csv?${consulta()}`))];
  }

  function abaHorarios(r) {
    const el = s.ui.el;
    const SERIES = [['leads', 'Leads novos'], ['mensagens', 'Mensagens das clientes'], ['agendamentos', 'Agendamentos']];
    const faixa = (x) => (x.faixa ? `${hora(x.faixa.de)}–${hora(x.faixa.ate)}` : '—');
    const kpis = el('div', { class: 'an-kpis', role: 'list', 'aria-label': 'Picos' },
      kpi('Hora com mais leads', r.leads.horaPico == null ? '—' : hora(r.leads.horaPico), `${fmtN(r.leads.total)} leads no período`),
      kpi('Dia com mais leads', r.leads.diaPico == null ? '—' : DIAS_LONGO[r.leads.diaPico], r.leads.diaPico == null ? null : `${fmtN(r.leads.porDiaSemana[r.leads.diaPico])} leads`),
      kpi('Faixa mais cheia de mensagens', faixa(r.mensagens), r.mensagens.faixa ? `${fmtPct(r.mensagens.faixa.pct)} das mensagens` : null),
      kpi('Hora em que mais agenda', r.agendamentos.horaPico == null ? '—' : hora(r.agendamentos.horaPico), `${fmtN(r.agendamentos.total)} agendamentos`),
      kpi('Pico da semana', r.mensagens.pico ? `${DIAS[r.mensagens.pico.diaSemana]} ${hora(r.mensagens.pico.hora)}` : '—', 'dia e hora com mais mensagens'));
    const serie = r[s.serie] || r.leads;
    const nomeSerie = SERIES.find(([k]) => k === s.serie)?.[1] || 'Leads novos';
    const seg = el('div', { class: 'an-seg', role: 'group', 'aria-label': 'O que ver' }, ...SERIES.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(k === s.serie), text: t, onclick: () => { s.serie = k; desenharTudo(); } })));
    const porHora = serie.total
      ? colunas(serie.porHora.map((v, h) => ({ rotulo: hora(h), rotuloLongo: `${hora(h)} às ${hora(h + 1)}`, valor: v })), { aria: `${nomeSerie} por hora do dia` })
      : vazio('Sem movimento neste período.');
    const dias = serie.total ? barras(serie.porDiaSemana.map((v, d) => ({ nome: DIAS_LONGO[d][0].toUpperCase() + DIAS_LONGO[d].slice(1), valor: v, nota: fmtPct(serie.total ? (v / serie.total) * 100 : null) }))) : vazio('Sem movimento neste período.');
    return [
      kpis,
      el('div', { class: 'rl-grade' },
        painel('hora', `${nomeSerie} por hora`, serie.faixa ? `mais movimento das ${hora(serie.faixa.de)} às ${hora(serie.faixa.ate)} (${fmtPct(serie.faixa.pct)})` : null, 'rl-g8', csvDe('horarios', s.serie), seg, porHora),
        painel('semana', 'Por dia da semana', nomeSerie, 'rl-g4', null, dias),
        painel('calor', `${nomeSerie}: dia da semana × hora`, serie.pico ? `mais cheio: ${DIAS_LONGO[serie.pico.diaSemana]} às ${hora(serie.pico.hora)} (${fmtN(serie.pico.total)})` : 'use para montar a escala da equipe e os horários da IA', 'rl-g12', csvDe('horarios', s.serie), serie.total ? calor(serie.grade, nomeSerie) : vazio('Sem movimento neste período.'))),
    ];
  }

  function abaFunil(r) {
    const el = s.ui.el;
    const abertas = r.etapas.filter((e) => e.aberta);
    const paradasAgora = abertas.reduce((a, e) => a + e.agora, 0);
    const lenta = [...abertas].filter((e) => e.medianaMs != null && e.saidas).sort((a, b) => b.medianaMs - a.medianaMs)[0];
    const emConversa = r.etapas.find((e) => e.etapa === 'em_conversa');
    const kpis = el('div', { class: 'an-kpis', role: 'list', 'aria-label': 'Resumo do funil' },
      kpi('Paradas agora', fmtN(paradasAgora), 'em etapas que esperam a loja agir'),
      kpi('Etapa mais lenta', lenta ? lenta.nome : '—', lenta ? `${fmtDur(lenta.medianaMs)} até sair (mediana)` : 'sem saídas no período'),
      kpi('Em conversa até decidir', fmtDur(emConversa?.medianaMs), emConversa?.saidas ? `${fmtN(emConversa.saidas)} saíram no período` : null),
      kpi('Perdidas no período', fmtN(r.perdas.total), r.perdas.motivos[0] ? `mais comum: ${r.perdas.motivos[0].nome}` : null));
    const max = Math.max(1, ...r.etapas.filter((e) => e.aberta).map((e) => e.medianaMs || 0));
    const tempo = (e) => (e.medianaMs == null ? '—' : `${fmtDur(e.medianaMs)} · ${fmtDur(e.mediaMs)}`);
    const etapas = el('div', { class: 'an-etapas' },
      el('div', { class: 'an-cab-etapas', 'aria-hidden': 'true' }, el('span', { text: 'Etapa' }), el('span', { text: 'Tempo até sair (mediana)' }), el('span', { text: 'Mediana · média' }), el('span', { text: 'Saíram' }), el('span', { text: 'Estão agora' })),
      ...r.etapas.map((e) => el('div', { class: 'an-etapa', role: 'group', 'aria-label': e.nome },
        el('b', { text: e.nome }),
        e.aberta
          ? el('span', { class: 'rl-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${e.medianaMs ? Math.max(3, Math.min(100, (e.medianaMs / max) * 100)) : 0}%;background:linear-gradient(90deg,#106ebe,#3aa0ff)` }))
          : el('span', { class: 'rl-vazio', style: 'font-size:12.5px', text: 'etapa de chegada' }),
        el('span', { class: 'an-v' }, el('small', { class: 'an-rot', text: 'mediana · média' }), tempo(e)),
        el('span', { class: 'an-v' }, el('small', { class: 'an-rot', text: 'saíram' }), fmtN(e.saidas)),
        el('span', { class: 'an-v' }, el('small', { class: 'an-rot', text: e.aberta ? 'paradas agora' : 'estão agora' }), fmtN(e.agora), e.paradoAgoraMedianaMs != null && e.agora ? el('small', { text: `há ${fmtDur(e.paradoAgoraMedianaMs)}` }) : null),
        e.destinos.length ? el('span', { class: 'an-dest', text: 'Foram para: ' + e.destinos.slice(0, 4).map((d) => `${d.nome} ${fmtPct(d.pct)}`).join(' · ') }) : null)));
    const paradas = r.paradas.length
      ? el('div', { class: 'an-lista' }, ...r.paradas.slice(0, 15).map((p) => el('div', { class: 'an-item' },
        el('b', { text: p.cliente }),
        el('small', { text: `${p.nomeEtapa} desde ${dataCurta(p.desde)}` }),
        el('span', { class: 'an-tempo' }, fmtDur(p.paradoMs), abrirConversa(p.conversaId)))))
      : vazio('Ninguém parado nas etapas em aberto.');
    const perdas = r.perdas.total
      ? el('div', { style: 'display:grid;gap:16px' },
        barras(r.perdas.motivos.map((m) => ({ nome: m.nome, valor: m.total, nota: fmtPct(m.pct), cor: '#ff7a59' }))),
        el('div', { class: 'rl-vazio', text: 'Em qual etapa foram perdidas:' }),
        barras(r.perdas.etapas.map((m) => ({ nome: m.nome, valor: m.total, nota: fmtPct(m.pct), cor: '#f5b800' }))))
      : vazio('Nenhuma conversa foi para "Perdida" neste período.');
    return [
      kpis,
      el('div', { class: 'rl-grade' },
        painel('etapas', 'Tempo parado em cada etapa', 'quanto tempo as conversas ficaram em cada etapa antes de mudar (saídas no período) e quantas estão nela agora', 'rl-g12', csvDe('funil', 'etapas'), etapas),
        painel('paradas', 'Paradas há mais tempo', `${fmtN(r.paradasTotal)} conversas em Novo lead, Em conversa, Interessada ou Agendada`, 'rl-g7 an-g7', csvDe('funil', 'paradas'), paradas),
        painel('perdas', 'Motivos de perda', `${fmtN(r.perdas.total)} ${r.perdas.total === 1 ? 'conversa perdida' : 'conversas perdidas'} no período`, 'an-g5', csvDe('funil', 'perdas'), perdas)),
    ];
  }

  // ---------------------------------------------------------------- perdas (perdas-saude)
  function abaPerdas(r) {
    const el = s.ui.el;
    const t = r.totais;
    const chipPerdas = t.variacaoPct == null ? { texto: 'sem comparação' } : { texto: `${t.variacaoPct > 0 ? '▲' : t.variacaoPct < 0 ? '▼' : ''} ${fmtPct(Math.abs(t.variacaoPct))} vs período anterior`.trim(), classe: t.variacaoPct > 0 ? 'desce' : t.variacaoPct < 0 ? 'sobe' : '' };
    const top = r.motivos[0];
    const kpis = el('div', { class: 'an-kpis', role: 'list', 'aria-label': 'Resumo das perdas' },
      kpi('Perdas no período', fmtN(t.perdas), `antes: ${fmtN(t.anterior)}`, chipPerdas),
      kpi('Motivo mais comum', top ? top.nome : '—', top ? `${fmtN(top.total)} · ${fmtPct(top.pct)} das perdas` : 'nenhuma perda no período'),
      kpi('Perdas ÷ leads novos', t.taxaPct == null ? '—' : fmtPct(t.taxaPct), `${fmtN(t.leads)} leads chegaram no período`),
      kpi('Marcadas pela equipe', fmtN(t.manuais), `${fmtN(t.automaticas)} automáticas (IA, follow-up, automação)`),
      kpi('Sem motivo', fmtN(t.semMotivo), t.semMotivo ? 'vieram de integrações ou de antes da regra' : 'toda perda tem motivo'));
    const cores = ['#ff7a59', '#f5b800', '#7cc4ff', '#9db8ff', '#19c3a6', '#c084fc', '#94a3b8'];
    const grupo = (lista, vazioTxt, comPrincipal) => (lista.length
      ? barras(lista.slice(0, 12).map((g, i) => ({ nome: g.nome, valor: g.total, cor: comPrincipal ? null : cores[i % cores.length], nota: [fmtPct(g.pct), comPrincipal && g.principal ? `mais: ${g.principal.nome}` : null, g.automaticas ? `${fmtN(g.automaticas)} autom.` : null].filter(Boolean).join(' · ') })))
      : vazio(vazioTxt));
    const editar = s.ui.ehGestor(s.ui.estado.eu || {}) && window.SintoniaPerda
      ? el('button', { class: 'an-bt', type: 'button', text: 'Editar motivos', onclick: () => window.SintoniaPerda.editarMotivos(s.ui, () => carregar()) })
      : null;
    const motivos = el('div', { style: 'display:grid;gap:14px' }, grupo(r.motivos, 'Nenhum lead foi perdido neste período.'), editar ? el('div', { class: 'an-acoes' }, editar) : null);
    const escritos = r.detalhes.length
      ? el('div', { class: 'an-lista' }, ...r.detalhes.slice(0, 12).map((d) => el('div', { class: 'an-item' },
        el('b', { text: d.cliente }),
        el('small', { text: `${d.motivo} · ${dataCurta(d.em)}` }),
        el('small', { style: 'white-space:normal;color:var(--texto)', text: `“${d.detalhe}”` }),
        el('span', { class: 'an-tempo' }, abrirConversa(d.conversaId)))))
      : vazio('Quando a equipe escrever um detalhe ao marcar a perda, ele aparece aqui.');
    const ultimas = r.lista.length
      ? tabela([['motivo', 'Motivo', (v) => v], ['etapa', 'Estava em', (v) => v], ['atendente', 'Quem atendia', (v) => v], ['origem', 'Origem', (v) => v], ['em', 'Quando', (v) => dataCurta(v)], ['abrir', '', () => '']],
        r.lista.slice(0, 40).map((p) => ({ ...p, nome: p.cliente, nomeEl: p.cliente })), 'Cliente')
      : vazio('Nenhuma perda no período.');
    if (r.lista.length) ultimas.querySelectorAll('tbody tr').forEach((tr, i) => { const td = tr.lastElementChild; td.textContent = ''; td.append(abrirConversa(r.lista[i].conversaId)); });
    return [
      kpis,
      el('div', { class: 'rl-grade' },
        painel('motivos', 'Por motivo', 'o que a equipe escolheu ao mover para uma etapa de perda (e as automáticas)', 'rl-g6', csvDe('perdas', 'motivos'), motivos),
        painel('etapas', 'Em que etapa perdeu', 'onde o lead estava antes de ir para a perda', 'rl-g6', csvDe('perdas', 'etapas'), grupo(r.etapas, 'Sem perdas no período.', true)),
        painel('atendentes', 'Por quem atendia', 'responsável pelo lead na hora da perda · motivo mais comum', 'rl-g6', csvDe('perdas', 'atendentes'), grupo(r.atendentes, 'Sem perdas no período.', true)),
        painel('origens', 'Por origem do lead', 'anúncio, link, indicação ou campo da ficha', 'rl-g6', csvDe('perdas', 'origens'), grupo(r.origens, 'Sem perdas no período.', true)),
        painel('detalhes', 'O que a equipe escreveu', 'os detalhes mais recentes', 'rl-g12', null, escritos),
        painel('lista', 'Últimas perdas', `${fmtN(r.listaTotal)} no período${r.listaTotal > 40 ? ' · as 40 mais recentes (o CSV traz todas)' : ''}`, 'rl-g12', csvDe('perdas', 'lista'), ultimas)),
    ];
  }

  // ---------------------------------------------------------------- Painel da TV
  function abaTv() {
    const el = s.ui.el;
    const { api, toast } = s.ui;
    const cfg = s.tv;
    if (!cfg) return [el('div', { class: 'rl-esq' })];
    if (cfg.erro) return [el('div', { class: 'rl-erro rl-vidro', role: 'alert' }, el('b', { text: 'Não deu para abrir o Painel da TV' }), el('span', { text: cfg.erro }))];
    const url = cfg.tv?.caminho ? location.origin + cfg.tv.caminho : null;
    const recarregar = async (msg) => { try { s.tv = await api('/api/comercial/config'); if (msg) toast(msg); } catch (e) { toast(e.message); } desenharTudo(); };
    const salvarTv = async (mudanca) => { try { await api('/api/comercial/config', { method: 'PUT', body: JSON.stringify({ tv: { rotacao: cfg.tv.rotacao, ultimosNomes: cfg.tv.ultimosNomes, ...mudanca } }) }); recarregar('Painel da TV atualizado'); } catch (e) { toast(e.message); } };
    const op = (rot, chave) => { const c = el('input', { type: 'checkbox' }); c.checked = Boolean(cfg.tv?.[chave]); c.onchange = () => salvarTv({ [chave]: c.checked }); return el('label', { class: 'an-op' }, c, rot); };
    const acoes = el('div', { class: 'an-acoes' },
      url ? el('button', { class: 'an-bt principal', type: 'button', html: IC.copiar + '<span>Copiar link</span>', onclick: () => navigator.clipboard?.writeText(url).then(() => toast('Link copiado'), () => toast('Copie o link acima')) }) : null,
      url ? el('a', { class: 'an-bt', href: url, target: '_blank', rel: 'noopener noreferrer', html: IC.abrir + '<span>Abrir em outra aba</span>' }) : null,
      el('button', { class: 'an-bt' + (url ? '' : ' principal'), type: 'button', text: url ? 'Gerar novo link' : 'Gerar link', onclick: async () => {
        if (url && !confirm('O link atual para de funcionar na TV. Gerar um novo?')) return;
        try { await api('/api/comercial/tv', { method: 'POST' }); recarregar(url ? 'Link novo gerado. Abra ele na TV.' : 'Link gerado'); } catch (e) { toast(e.message); }
      } }),
      url ? el('button', { class: 'an-bt perigo', type: 'button', text: 'Revogar', onclick: async () => {
        if (!confirm('A TV para de mostrar o painel. Revogar o link?')) return;
        try { await api('/api/comercial/tv', { method: 'DELETE' }); s.previa = false; recarregar('Link revogado'); } catch (e) { toast(e.message); }
      } }) : null);
    const info = painel('tv-link', 'Link do Painel da TV', 'abre sem login, em tela cheia, no navegador da TV da sala', 'an-g5 rl-g6', null,
      el('div', { class: 'an-tv' },
        url ? el('div', { class: 'an-tv-link', text: url }) : vazio('Nenhum link ativo. Gere um link para abrir o painel na TV.'),
        acoes,
        op('Alternar entre 3 telas (resumo, ranking e serviços) a cada 20 s', 'rotacao'),
        op('Mostrar o primeiro nome da cliente no último agendamento', 'ultimosNomes'),
        el('ol', { class: 'an-passos' },
          el('li', { text: 'Na TV (ou no computador ligado nela), abra o navegador.' }),
          el('li', { text: 'Digite ou cole o link acima e aperte F11 (tela cheia).' }),
          el('li', { text: 'Os números se atualizam sozinhos. Se o link vazar, gere um novo: o antigo para de funcionar.' }))));
    let previa;
    if (!url) previa = vazio('A prévia aparece depois de gerar o link.');
    else if (!s.previa) previa = el('div', { style: 'display:grid;gap:12px;justify-items:start' }, el('div', { class: 'rl-vazio', text: 'Veja aqui como a TV está mostrando o painel agora (a prévia só carrega quando você pede).' }), el('button', { class: 'an-bt', type: 'button', html: IC.tv + '<span>Ver prévia</span>', onclick: () => { s.previa = true; desenharTudo(); } }));
    else {
      const quadro = el('div', { class: 'an-tela16' });
      const ifr = el('iframe', { src: url, title: 'Prévia do Painel da TV', loading: 'lazy', referrerpolicy: 'no-referrer', tabindex: '-1' });
      quadro.append(ifr);
      const ajustar = () => { const w = quadro.clientWidth; if (w) ifr.style.transform = `scale(${w / 1920})`; };
      requestAnimationFrame(ajustar);
      new ResizeObserver(ajustar).observe(quadro);
      previa = quadro;
    }
    return [el('div', { class: 'rl-grade' }, info, painel('tv-previa', 'Prévia', 'o mesmo que aparece na TV', 'an-g7 rl-g6', null, previa))];
  }

  // ---------------------------------------------------------------- moldura
  function controles() {
    const el = s.ui.el;
    const op = s.opcoes || { unidades: [], atendentes: [] };
    const linha = el('div', { class: 'rl-controles' });
    if (s.aba === 'tv' || s.aba === 'saude' || s.aba === 'dia') return linha; /* relatorio-dia: os filtros do Dia a dia ficam dentro dele */
    linha.append(el('div', { class: 'rl-trilho rl-vidro', role: 'group', 'aria-label': 'Período' },
      ...PERIODOS.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(k === s.f.periodo), text: t, onclick: () => mudar({ periodo: k, ...(k === 'personalizado' && !s.f.de ? { de: addDias(hojeBahia(), -29), ate: hojeBahia() } : {}) }) }))));
    if (s.f.periodo === 'personalizado') {
      const hoje = hojeBahia();
      linha.append(
        el('label', { class: 'rl-campo rl-vidro' }, el('span', { text: 'De' }), el('input', { type: 'date', value: s.f.de, max: hoje, onchange: (e) => mudar({ de: e.target.value, ...(s.f.ate && e.target.value > s.f.ate ? { ate: e.target.value } : {}) }) })),
        el('label', { class: 'rl-campo rl-vidro' }, el('span', { text: 'Até' }), el('input', { type: 'date', value: s.f.ate, max: hoje, min: s.f.de, onchange: (e) => mudar({ ate: e.target.value }) })));
    }
    const sel = (rot, valor, opcoes, campo) => {
      const x = el('select', { 'aria-label': rot, onchange: (e) => mudar({ [campo]: e.target.value }) }, ...opcoes.map(([v, t]) => el('option', { value: v, text: t })));
      x.value = valor;
      return el('label', { class: 'rl-campo rl-vidro' }, el('span', { text: rot }), x);
    };
    if (op.unidades.length > 1) linha.append(sel('Unidade', s.f.unidade, [['', 'Todas'], ...op.unidades.map((u) => [u.id, u.nome])], 'unidade'));
    if (op.atendentes.length) linha.append(sel('Atendente', s.f.atendente, [['', 'Todas'], ...op.atendentes.map((a) => [a.id, a.nome + (a.ativo ? '' : ' (inativa)')])], 'atendente'));
    const tabelas = TABELAS[s.aba] || (s.aba === 'satisfacao' ? null : []);
    let itens = [];
    if (tabelas) itens = tabelas.map(([k, t]) => [csvDe(s.aba, k), t]);
    else itens = [[`/api/nps/csv?${consulta()}`, 'Respostas da pesquisa']];
    if (itens.length) {
      const exportar = el('details', { class: 'rl-exportar' },
        el('summary', { html: IC.baixar + '<span>Exportar</span>' }),
        el('div', { class: 'rl-menu rl-vidro', role: 'menu' }, ...itens.map(([href, t]) => el('a', { href, download: '', role: 'menuitem', html: IC.baixar }, `${t} (CSV)`))));
      exportar.addEventListener('focusout', (e) => { if (!exportar.contains(e.relatedTarget)) exportar.open = false; });
      linha.append(el('span', { class: 'rl-espaco' }), exportar);
    }
    return linha;
  }

  function abas() {
    const el = s.ui.el;
    return el('div', { class: 'rl-trilho rl-vidro', role: 'tablist', 'aria-label': 'Análises' },
      ...ABAS.map(([k, t]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(k === s.aba), 'aria-pressed': String(k === s.aba), text: t, onclick: () => trocarAba(k) })));
  }

  function subtitulo(r) {
    if (s.aba === 'tv') return 'Painel da sala comercial para deixar aberto na TV';
    if (s.aba === 'saude') return 'Atualiza a cada 15 s enquanto esta tela está aberta';
    if (s.aba === 'dia') return 'Leads novos × agendamentos, dia a dia'; // relatorio-dia
    if (!r || !r.inicio) return 'Carregando…';
    const ultimo = new Date(new Date(r.fim).getTime() - 1);
    const dias = Math.round((new Date(r.fim) - new Date(r.inicio)) / 864e5) || 1;
    const periodo = dias <= 1 && dataLonga(r.inicio) === dataLonga(ultimo) ? dataLonga(r.inicio) : `${dataLonga(r.inicio)} a ${dataLonga(ultimo)}`;
    const op = s.opcoes || { unidades: [], atendentes: [] };
    const unidade = s.f.unidade ? op.unidades.find((u) => u.id === s.f.unidade)?.nome : op.unidades.length > 1 ? 'todas as unidades' : op.unidades[0]?.nome;
    const at = s.f.atendente ? op.atendentes.find((a) => a.id === s.f.atendente)?.nome : null;
    return [periodo, unidade, at].filter(Boolean).join(' · ');
  }

  function desenharTudo() {
    const { ui, caixa } = s;
    if (!caixa) return;
    const el = ui.el;
    const r = s.dados[chaveDados()];
    const titulo = ABAS.find(([k]) => k === s.aba)?.[1];
    const topo = el('div', { class: 'rl-topo' }, el('h1', { class: 'titulo-grande' }, 'Análises', el('span', { class: 'rl-quando', text: `${titulo} · ${subtitulo(s.aba === 'satisfacao' ? r && { inicio: r.inicio, fim: r.fim } : r)}` })));
    const raiz = el('div', { class: 'rl an' }, topo, abas(), controles());
    if (s.aba === 'tv') raiz.append(...abaTv());
    else if (s.aba === 'dia') { /* relatorio-dia: telas/relatorio-dia.js desenha e busca os próprios dados */
      const host = el('div', { class: 'an-dia' });
      raiz.append(host);
      if (window.SintoniaRelatorioDia) window.SintoniaRelatorioDia.montar(host, ui); else host.append(vazio('O Dia a dia não carregou. Recarregue a página.'));
    }
    else if (s.aba === 'saude') { /* perdas-saude: telas/saude.js desenha e atualiza sozinho (só com a tela aberta) */
      const host = el('div', { class: 'an-saude' });
      raiz.append(host);
      if (window.SintoniaSaude) window.SintoniaSaude.montar(host, ui); else host.append(vazio('O painel de saúde não carregou. Recarregue a página.'));
    }
    else if (s.erro && !r) raiz.append(el('div', { class: 'rl-erro rl-vidro', role: 'alert' }, el('b', { text: 'Não deu para carregar esta análise' }), el('span', { text: s.erro }), el('button', { class: 'rl-botao', type: 'button', text: 'Tentar de novo', onclick: carregar })));
    else if (!r) raiz.append(el('div', { class: 'an-kpis' }, ...[1, 2, 3, 4].map(() => el('div', { class: 'rl-esq', style: 'height:96px' }))), el('div', { class: 'rl-esq' }));
    else {
      const montar = { vendas: abaVendas, clientes: abaClientes, satisfacao: abaSatisfacao, horarios: abaHorarios, funil: abaFunil, perdas: abaPerdas }[s.aba];
      try { raiz.append(...montar(r).filter(Boolean)); } catch (x) { console.error(x); raiz.append(vazio('Não deu para montar esta análise.')); }
    }
    caixa.replaceChildren(raiz);
    // perdas-saude: no celular as abas rolam de lado; a aba escolhida fica à vista.
    const trilho = raiz.querySelector('[role="tablist"]');
    const aba = trilho?.querySelector('[aria-selected="true"]');
    if (trilho && aba && trilho.scrollWidth > trilho.clientWidth) trilho.scrollLeft = Math.max(0, aba.offsetLeft - (trilho.clientWidth - aba.offsetWidth) / 2);
  }

  function trocarAba(k) {
    if (!ABAS.some(([x]) => x === k)) k = 'vendas';
    s.aba = k;
    gravar(CHAVE_ABA, k);
    window.SintoniaMenu?.analisesAba?.(k);
    carregar();
  }

  function mudar(p) {
    s.f = { ...s.f, ...p };
    gravar(CHAVE, s.f);
    carregar();
  }

  async function carregar() {
    const { ui } = s;
    const g = ++s.geracao;
    s.erro = null;
    if (s.aba === 'saude' || s.aba === 'dia') { desenharTudo(); return; } // perdas-saude e relatorio-dia: o painel pede os próprios dados
    if (s.aba !== 'tv' && s.f.periodo === 'personalizado' && (!s.f.de || !s.f.ate)) { desenharTudo(); return; }
    desenharTudo();
    try {
      if (s.aba === 'tv') {
        s.tv = await ui.api('/api/comercial/config').catch((e) => ({ erro: e.message || 'Só a gestão mexe no Painel da TV.' }));
      } else {
        const k = chaveDados();
        const [r, op] = await Promise.all([
          s.aba === 'satisfacao' ? ui.api('/api/nps/resumo?' + consulta()) : ui.api(`/api/analises/${s.aba}?${consulta()}`),
          s.opcoes ? null : ui.api('/api/analises/opcoes').catch(() => null),
        ]);
        if (g !== s.geracao) return;
        if (r.opcoes) s.opcoes = r.opcoes;
        else if (op) s.opcoes = op;
        s.dados = { [k]: r };
      }
    } catch (x) {
      if (g !== s.geracao) return;
      s.erro = x.message || 'Verifique a internet e tente de novo.';
      if (x.status === 403 || x.status === 400) { s.f = { ...FILTRO0 }; gravar(CHAVE, s.f); }
    }
    if (g === s.geracao && s.caixa?.isConnected) desenharTudo();
  }

  window.SintoniaTelas.analises = {
    /** Escolhe a aba antes de mostrar a tela (menu Análises › …). */
    focar(aba) { if (ABAS.some(([x]) => x === aba)) { s.aba = aba; gravar(CHAVE_ABA, aba); } },
    aba: () => s.aba,
    async desenhar(caixa, ui) {
      s.caixa = caixa;
      s.ui = ui;
      estilo();
      caixa.classList.add('an-caixa');
      if (ui.estado.eu && !ui.ehGestor(ui.estado.eu)) {
        caixa.replaceChildren(ui.el('div', { class: 'rl an' }, ui.el('h1', { class: 'titulo-grande', text: 'Análises' }), ui.el('div', { class: 'rl-erro rl-vidro' }, ui.el('b', { text: 'Só para a gestão' }), ui.el('span', { text: 'As análises ficam com a gerência, a direção e a administração. Seus números estão no Dashboard.' }))));
        return;
      }
      window.SintoniaMenu?.analisesAba?.(s.aba);
      await carregar();
    },
  };
})();
