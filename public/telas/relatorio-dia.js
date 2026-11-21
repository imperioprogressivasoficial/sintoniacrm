/* relatorio-dia: aba "Dia a dia" das Análises (window.SintoniaRelatorioDia.montar(host, ui), chamada por telas/analises.js).
 * - Escolha do dia (hoje por padrão, setas para o dia anterior/seguinte) e filtros (unidade, atendente, IA × equipe, origem).
 * - O dia: leads novos que chegaram × quantos agendaram no mesmo dia; os agendamentos do dia pelo dia em que o lead
 *   chegou (hoje, ontem, 2 dias, 3–7, mais de 7, retorno, contato antigo); leads de hoje, ontem e anteontem.
 * - Grupo de leads (coorte): para cada dia de chegada, quantos agendaram no dia 0, 1, 2… 7+ (tabela de calor).
 * - Geral do período e por origem.
 * - Relatório automático no WhatsApp (só a gestão): ligar, quem recebe (grupos e números) e o quê, horários,
 *   prévia do texto, teste para mim e os últimos envios (com as falhas).
 * Dados: /api/relatorio-dia (src/relatorio-dia). Texto do servidor sempre por textContent. Sem animação em loop.
 */
(() => {
  const CHAVE = 'sintonia.relatorioDia.filtro';
  const IC = {
    esq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    dir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
    grupo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/></svg>',
    fone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18h3"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg>',
    olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z"/></svg>',
  };
  const NOMES_FAIXA = { mesmoDia: 'Chegaram no mesmo dia', d1: 'Chegaram no dia anterior', d2: 'Chegaram 2 dias antes', d3a7: 'Chegaram de 3 a 7 dias antes', mais7: 'Chegaram há mais de 7 dias', retorno: 'Retorno (já eram clientes)', importado: 'Contato antigo ou importado' };
  const CORES_FAIXA = { mesmoDia: '#106ebe', d1: '#3aa0ff', d2: '#7cc4ff', d3a7: '#9db8ff', mais7: '#b9c6dc', retorno: 'var(--marca-menta)', importado: '#94a3b8' };
  const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

  const CSS = `
  .rd { display: grid; gap: 16px; min-width: 0; }
  .rd-dia { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 3px; min-height: 44px; box-sizing: border-box; }
  .rd-dia button { all: unset; cursor: pointer; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); }
  .rd-dia button[disabled] { opacity: .35; cursor: default; }
  .rd-dia button svg { width: 18px; height: 18px; }
  .rd-dia button:not([disabled]):hover { background: var(--vidro-item); }
  .rd-dia label { position: relative; display: grid; gap: 0; text-align: center; padding: 0 6px; cursor: pointer; min-width: 112px; }
  .rd-dia label b { font-size: 14px; font-weight: 800; white-space: nowrap; }
  .rd-dia label small { font-size: 11.5px; color: var(--sub); font-weight: 600; }
  .rd-dia input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  .rd-hoje { all: unset; cursor: pointer; font-size: 13px; font-weight: 800; color: var(--azul-serie); padding: 0 10px; min-height: 44px; display: inline-flex; align-items: center; }
  .rd button:focus-visible, .rd a:focus-visible, .rd input:focus-visible, .rd select:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }

  @media (max-width: 640px) {
    .rd-controles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .rd-controles .rd-dia, .rd-controles .rd-hoje { grid-column: 1 / -1; justify-content: space-between; }
    .rd-controles .rl-campo { flex-direction: column; align-items: stretch; gap: 0; border-radius: 18px; padding: 7px 12px; min-height: 52px; }
    .rd-controles .rl-campo span { font-size: 11px; }
    .rd-controles .rl-campo select { max-width: none; width: 100%; padding: 2px 0; font-size: 14px; }
    .rd-controles .rl-exportar summary { width: 100%; justify-content: center; min-height: 52px; border-radius: 18px; }
  }
  @media (max-width: 640px) {
    .rd-env .rl-campo { width: 100%; flex-direction: column; align-items: stretch; gap: 0; border-radius: 18px; padding: 7px 12px; }
    .rd-env .rl-campo span { font-size: 11px; }
    .rd-env .rl-campo select { max-width: none; width: 100%; padding: 2px 0; }
    .rd-pessoa .rd-quais.rd-quais { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .rd-marca { font-size: 12px; padding: 6px 8px; }
    .rd-calor { grid-template-columns: 58px 44px repeat(var(--rd-cols), minmax(48px, 1fr)) 58px; }
  }
  .rd-trio { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  @media (max-width: 640px) { .rd-trio { grid-template-columns: minmax(0, 1fr); } }
  .rd-card { border-radius: 18px; background: var(--vidro-item); padding: 12px 14px; display: grid; gap: 8px; align-content: start; min-width: 0; }
  .rd-card h3 { margin: 0; font-size: 13.5px; display: flex; justify-content: space-between; gap: 8px; }
  .rd-card h3 small { color: var(--sub); font-weight: 600; }
  .rd-card .rd-nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .rd-card .rd-nums span { display: grid; gap: 1px; font-size: 11.5px; color: var(--sub); line-height: 1.25; }
  .rd-card .rd-nums b { font-size: 21px; color: var(--texto); font-variant-numeric: tabular-nums; }
  .rd-card .rl-trilha { height: 8px; }

  .rd-calor-rolar { overflow-x: auto; margin: 0 -4px; padding: 0 4px 4px; overscroll-behavior-x: contain; }
  .rd-calor { display: grid; grid-template-columns: 92px 64px repeat(var(--rd-cols), minmax(54px, 1fr)) 70px; gap: 4px; min-width: max-content; font-variant-numeric: tabular-nums; }
  @media (min-width: 900px) { .rd-calor { min-width: 0; } }
  .rd-calor > span { display: grid; place-items: center; min-height: 42px; border-radius: 10px; font-size: 13px; font-weight: 700; text-align: center; line-height: 1.1; }
  .rd-calor > span small { display: block; font-size: 10.5px; font-weight: 600; opacity: .8; margin-top: 2px; }
  .rd-calor .rd-cab { min-height: 30px; font-size: 11.5px; color: var(--sub); font-weight: 700; }
  .rd-calor .rd-dia-l { justify-items: start; place-items: center start; padding-left: 4px; font-size: 13px; position: sticky; left: 0; background: var(--vidro-forte, var(--fundo)); z-index: 1; }
  .rd-calor .rd-dia-l small { color: var(--sub); }
  .rd-calor .rd-cel { background: var(--vidro-item); color: var(--texto); }
  .rd-calor .rd-cel.forte { color: #fff; }
  .rd-calor .rd-cel.fut { background: transparent; box-shadow: inset 0 0 0 1px var(--vidro-linha); color: var(--sub); }
  .rd-calor .rd-tot { background: transparent; box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .rd { --rd-calor: #106ebe; }
  html[data-tema="escuro"] .rd { --rd-calor: #3aa0ff; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .rd { --rd-calor: #3aa0ff; } }

  .rd-nota { font-size: 12.5px; color: var(--sub); line-height: 1.45; margin: 0; }
  .rd-regras { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; color: var(--sub); line-height: 1.45; }

  /* envio automático */
  .rd-env { display: grid; gap: 16px; }
  .rd-linha { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .rd-chave { position: relative; display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-weight: 700; font-size: 14.5px; min-height: 44px; }
  .rd-chave input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .rd-chave i { width: 46px; height: 28px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); position: relative; flex: none; transition: background .2s; }
  .rd-chave i::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
  .rd-chave input:checked + i { background: linear-gradient(90deg, #106ebe, #3aa0ff); box-shadow: none; }
  .rd-chave input:checked + i::after { transform: translateX(18px); }
  .rd-chave input:focus-visible + i { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .rd-horarios { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }
  .rd-hora { display: grid; gap: 6px; padding: 12px; border-radius: 16px; background: var(--vidro-item); font-size: 13px; }
  .rd-hora b { font-size: 13.5px; }
  .rd-hora div { display: flex; gap: 8px; flex-wrap: wrap; }
  .rd-hora input, .rd-hora select, .rd-campo-txt { font: inherit; font-size: 14px; color: var(--texto); background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); border-radius: 10px; padding: 8px 10px; min-height: 40px; box-sizing: border-box; }
  html[data-tema="escuro"] .rd input, html[data-tema="escuro"] .rd select { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .rd input, html:not([data-tema="claro"]) .rd select { color-scheme: dark; } }
  .rd-dest { display: grid; gap: 8px; }
  .rd-pessoa { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 6px 12px; align-items: center; padding: 10px 12px; border-radius: 16px; background: var(--vidro-item); }
  .rd-pessoa > i { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, #106ebe 14%, transparent); color: var(--azul-serie); }
  .rd-pessoa > i svg { width: 19px; height: 19px; }
  .rd-pessoa > div { min-width: 0; }
  .rd-pessoa b { display: block; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rd-pessoa small { display: block; font-size: 12.5px; color: var(--sub); }
  .rd-pessoa .rd-quais { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
  .rd-pessoa > .rd-icone { grid-row: 1; grid-column: 3; }
  @media (min-width: 900px) { .rd-pessoa { grid-template-columns: 38px minmax(160px, 1fr) auto auto; } .rd-pessoa .rd-quais { grid-column: auto; } .rd-pessoa > .rd-icone { grid-column: 4; } }
  .rd-marca { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; padding: 6px 10px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda); cursor: pointer; min-height: 32px; box-sizing: border-box; }
  .rd-marca input { width: 16px; height: 16px; accent-color: #106ebe; margin: 0; }
  .rd-marca:has(input:checked) { box-shadow: inset 0 0 0 1.5px #3aa0ff; }
  .rd-icone { all: unset; cursor: pointer; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .rd-icone:hover { background: var(--vidro-fundo); color: #e5383b; }
  .rd-icone svg { width: 18px; height: 18px; }
  .rd-add { display: grid; gap: 10px; padding: 12px; border-radius: 16px; box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .rd-add select, .rd-add input { width: 100%; }
  .rd-bolha { white-space: pre-wrap; font-size: 14px; line-height: 1.5; padding: 12px 14px; border-radius: 14px 14px 14px 4px; background: #e7fbe9; color: #102a1c; max-width: 520px; box-shadow: 0 1px 2px rgba(0,0,0,.12); overflow-wrap: anywhere; }
  html[data-tema="escuro"] .rd-bolha { background: #134d37; color: #e9fff3; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .rd-bolha { background: #134d37; color: #e9fff3; } }
  .rd-wa { padding: 14px; border-radius: 18px; background: color-mix(in srgb, #0b141a 6%, var(--vidro-item)); display: grid; justify-items: start; }
  .rd-reg { display: grid; gap: 6px; }
  .rd-reg > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; font-size: 13px; padding: 8px 10px; border-radius: 12px; background: var(--vidro-item); }
  .rd-reg small { color: var(--sub); }
  .rd-reg .ok { color: #0a8f7a; font-weight: 800; } .rd-reg .erro { color: #c2410c; font-weight: 800; }
  html[data-tema="escuro"] .rd-reg .ok { color: #0ffcbe; } html[data-tema="escuro"] .rd-reg .erro { color: #ff9a7f; }
  .rd-reg .rd-erro { grid-column: 1 / -1; color: #c2410c; }
  html[data-tema="escuro"] .rd-reg .rd-erro { color: #ff9a7f; }
  `;

  // ---------------------------------------------------------------- formatos
  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  const fmtPct = (v) => (v == null ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')}%`);
  function fmtDur(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${Math.max(1, min)} min`;
    const h = ms / 3600000;
    if (h < 48) return `${String(Math.round(h * 10) / 10).replace('.', ',')} h`;
    return `${Math.round(h / 24)} dias`;
  }
  const hojeBahia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const semana = (iso) => DIAS_SEMANA[new Date(iso + 'T12:00:00Z').getUTCDay()];
  const nomeDia = (iso, hoje) => (iso === hoje ? 'Hoje' : iso === addDias(hoje, -1) ? 'Ontem' : iso === addDias(hoje, -2) ? 'Anteontem' : semana(iso)[0].toUpperCase() + semana(iso).slice(1));
  const dataHora = (d) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).format(new Date(d));
  /** "+55 (71) 98812-4471" enquanto digita. */
  function mascara(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.startsWith('55') && d.length > 11) d = d.slice(2);
    d = d.slice(0, 11);
    if (!d) return '';
    let s = '+55 (' + d.slice(0, 2);
    if (d.length >= 2) s += ') ';
    if (d.length > 2) s += d.length > 10 ? d.slice(2, 7) + (d.length > 7 ? '-' + d.slice(7) : '') : d.slice(2, 6) + (d.length > 6 ? '-' + d.slice(6) : '');
    return s;
  }

  // ---------------------------------------------------------------- estado
  const ler = (k, p) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null') ?? p; } catch { return p; } };
  const gravar = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
  const F0 = { dia: '', dias: 14, unidade: '', atendente: '', quem: '', origem: '' };
  const s = { host: null, ui: null, f: { ...F0, ...ler(CHAVE, {}), dia: '' }, dados: null, erro: null, geracao: 0, env: null, envErro: null, rascunho: null, previa: null, relPrevia: 'fechamento', adicionando: null, salvando: false };

  function estilo() {
    if (document.getElementById('estilo-relatorio-dia')) return;
    const st = document.createElement('style');
    st.id = 'estilo-relatorio-dia';
    st.textContent = CSS;
    document.head.append(st);
  }
  const el = (...a) => s.ui.el(...a);
  const diaAtual = () => s.f.dia || hojeBahia();
  function consulta(extra = {}) {
    const q = new URLSearchParams({ dia: diaAtual(), dias: String(s.f.dias) });
    for (const k of ['unidade', 'atendente', 'quem', 'origem']) if (s.f[k]) q.set(k, s.f[k]);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q.toString();
  }
  function mudar(p) {
    s.f = { ...s.f, ...p };
    gravar(CHAVE, { ...s.f, dia: '' });
    carregar();
  }

  // ---------------------------------------------------------------- pedaços
  function painel(nome, titulo, sub, classe, csv, ...filhos) {
    const bt = csv ? el('a', { class: 'rl-redondo', href: `/api/relatorio-dia/csv?${consulta({ tabela: csv })}`, download: '', title: `Exportar "${titulo}" (CSV)`, 'aria-label': `Exportar ${titulo} em CSV`, html: IC.baixar }) : null;
    return el('section', { class: `rl-painel rl-vidro ${classe || ''}`, 'aria-label': titulo, 'data-rd': nome },
      el('div', { class: 'rl-cab' }, el('h2', {}, titulo, sub ? el('small', { text: sub }) : null), bt), ...filhos);
  }
  const vazio = (txt) => el('div', { class: 'rl-vazio', text: txt });
  function kpi(rotulo, valor, nota, chip) {
    return el('div', { class: 'an-kpi rl-vidro', role: 'listitem' },
      el('small', {}, el('span', { text: rotulo })), el('b', { text: valor }),
      chip ? el('span', { class: `an-chip ${chip.classe || ''}`, text: chip.texto }) : null,
      nota ? el('em', { text: nota }) : null);
  }
  function barras(itens) {
    const max = Math.max(1, ...itens.map((x) => x.valor));
    return el('div', { class: 'rl-barras', role: 'list' }, ...itens.map((x) =>
      el('div', { class: 'rl-barra', role: 'listitem', 'aria-label': `${x.nome}: ${x.valor}` },
        el('span', {}, x.cor ? el('i', { class: 'rl-bol', style: `background:${x.cor}` }) : null, x.nome),
        el('span', { class: 'rl-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${x.valor ? Math.max(2, (x.valor / max) * 100) : 0}%;background:${x.cor || 'linear-gradient(90deg,#106ebe,#3aa0ff)'}` })),
        el('b', {}, fmtN(x.valor), x.nota ? el('small', { text: x.nota }) : null))));
  }

  function controles(r) {
    const hoje = hojeBahia();
    const dia = diaAtual();
    const op = r?.opcoes || { unidades: [], atendentes: [], origens: [] };
    const input = el('input', { type: 'date', value: dia, max: hoje, 'aria-label': 'Escolher o dia', onchange: (e) => e.target.value && mudar({ dia: e.target.value > hoje ? hoje : e.target.value }) });
    const seletor = el('div', { class: 'rd-dia rl-vidro', role: 'group', 'aria-label': 'Dia' },
      el('button', { type: 'button', 'aria-label': 'Dia anterior', title: 'Dia anterior', html: IC.esq, onclick: () => mudar({ dia: addDias(dia, -1) }) }),
      el('label', {}, el('b', { text: `${nomeDia(dia, hoje)}, ${ddmm(dia)}` }), el('small', { text: dia === hoje ? 'até agora' : semana(dia) }), input),
      el('button', { type: 'button', 'aria-label': 'Dia seguinte', title: 'Dia seguinte', html: IC.dir, disabled: dia >= hoje ? '' : null, onclick: () => dia < hoje && mudar({ dia: addDias(dia, 1) === hoje ? '' : addDias(dia, 1) }) }));
    const linha = el('div', { class: 'rl-controles rd-controles' }, seletor);
    if (dia !== hoje) linha.append(el('button', { class: 'rd-hoje', type: 'button', text: 'Voltar para hoje', onclick: () => mudar({ dia: '' }) }));
    const sel = (rot, valor, opcoes, campo) => {
      const x = el('select', { 'aria-label': rot, onchange: (e) => mudar({ [campo]: e.target.value }) }, ...opcoes.map(([v, t]) => el('option', { value: v, text: t })));
      x.value = valor;
      return el('label', { class: 'rl-campo rl-vidro' }, el('span', { text: rot }), x);
    };
    if (op.unidades.length > 1) linha.append(sel('Unidade', s.f.unidade, [['', 'Todas'], ...op.unidades.map((u) => [u.id, u.nome])], 'unidade'));
    if (op.atendentes.length) linha.append(sel('Atendente', s.f.atendente, [['', 'Todas'], ...op.atendentes.map((a) => [a.id, a.nome + (a.ativo ? '' : ' (inativa)')])], 'atendente'));
    linha.append(sel('Quem agendou', s.f.quem, [['', 'IA e equipe'], ['ia', 'Só a IA'], ['equipe', 'Só a equipe']], 'quem'));
    if (op.origens.length > 1 || s.f.origem) linha.append(sel('Origem', s.f.origem, [['', 'Todas'], ...op.origens.map((o) => [o, o])], 'origem'));
    linha.append(sel('Grupo de leads', String(s.f.dias), [['7', '7 dias'], ['14', '14 dias'], ['30', '30 dias']], 'dias'));
    const itens = [['dia', 'Resumo do dia'], ['faixas', 'Agendamentos por dia de chegada'], ['coorte', 'Grupo de leads por dia'], ['origens', 'Geral por origem']];
    const exportar = el('details', { class: 'rl-exportar' },
      el('summary', { html: IC.baixar + '<span>Exportar</span>' }),
      el('div', { class: 'rl-menu rl-vidro', role: 'menu' }, ...itens.map(([k, t]) => el('a', { href: `/api/relatorio-dia/csv?${consulta({ tabela: k })}`, download: '', role: 'menuitem', html: IC.baixar }, `${t} (CSV)`))));
    exportar.addEventListener('focusout', (e) => { if (!exportar.contains(e.relatedTarget)) exportar.open = false; });
    linha.append(el('span', { class: 'rl-espaco' }), exportar);
    return linha;
  }

  // ---------------------------------------------------------------- o dia (visão a)
  function blocoDia(r) {
    const d = r.relatorio;
    const hoje = r.hoje;
    const qual = d.dia === hoje ? 'hoje' : d.dia === addDias(hoje, -1) ? 'ontem' : `em ${ddmm(d.dia)}`;
    const a = d.agendamentos;
    const kpis = el('div', { class: 'an-kpis', role: 'list', 'aria-label': 'Resumo do dia' },
      kpi('Leads novos', fmtN(d.chegaram.novos), [d.chegaram.retorno ? `+ ${fmtN(d.chegaram.retorno)} retorno` : null, d.chegaram.importados ? `${fmtN(d.chegaram.importados)} importados não contam` : null].filter(Boolean).join(' · ') || 'primeira conversa no dia'),
      kpi(d.dia === hoje ? 'Agendaram hoje' : 'Agendaram no dia', fmtN(d.novosQueAgendaramNoDia), `dos leads novos de ${qual}`, d.conversaoNoDiaPct != null ? { texto: `${fmtPct(d.conversaoNoDiaPct)} de conversão`, classe: 'sobe' } : null),
      kpi('Agendamentos do dia', fmtN(a.total), `Serena ${fmtN(a.porIa)} · equipe ${fmtN(a.porEquipe)}`),
      kpi('Compareceram', fmtN(a.compareceram), a.faltaram ? `${fmtN(a.faltaram)} faltaram` : 'dos agendamentos feitos no dia'));
    const nomes = ['do dia', 'do dia anterior', 'de 2 dias antes'];
    const trio = el('div', { class: 'rd-trio' }, ...d.grupos.map((g, i) => {
      const pctAte = g.chegaram ? (g.agendaramAte / g.chegaram) * 100 : 0;
      return el('div', { class: 'rd-card', role: 'group', 'aria-label': `Leads de ${ddmm(g.dia)}` },
        el('h3', {}, el('span', { text: `Leads ${nomes[i]}` }), el('small', { text: `${nomeDia(g.dia, hoje)}, ${ddmm(g.dia)}` })),
        el('div', { class: 'rd-nums' },
          el('span', {}, el('b', { text: fmtN(g.chegaram) }), 'chegaram'),
          el('span', {}, el('b', { text: fmtN(g.agendaramNoMesmoDia) }), 'agendaram no mesmo dia'),
          el('span', {}, el('b', { text: fmtN(g.agendaramAte) }), i === 0 ? 'agendaram até agora' : `agendaram até ${ddmm(d.dia)}`)),
        el('span', { class: 'rl-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${pctAte}%;background:linear-gradient(90deg,#106ebe,#3aa0ff)` })),
        el('small', { class: 'rd-nota', text: g.chegaram ? `${fmtPct(pctAte)} já agendaram${i > 0 ? ` · ${fmtN(g.agendaramNoDia)} agendaram ${qual}` : ''}` : 'nenhum lead novo neste dia' }));
    }));
    const faixas = a.total
      ? barras(a.faixas.filter((f) => f.total || ['mesmoDia', 'd1', 'd2'].includes(f.faixa)).map((f) => ({ nome: NOMES_FAIXA[f.faixa] || f.nome, valor: f.total, nota: fmtPct(f.pct), cor: CORES_FAIXA[f.faixa] })))
      : vazio(`Nenhum agendamento feito ${qual}.`);
    const rank = d.ranking.length
      ? barras(d.ranking.slice(0, 10).map((x) => ({ nome: x.nome, valor: x.agendamentos, cor: x.porIa ? 'var(--marca-menta)' : null })))
      : vazio('Ninguém agendou neste dia.');
    return [
      kpis,
      el('div', { class: 'rl-grade' },
        painel('trio', 'Leads de hoje, ontem e anteontem', `quantos chegaram, quantos agendaram no mesmo dia e quantos já agendaram até ${d.dia === hoje ? 'agora' : ddmm(d.dia)}`, 'rl-g12', 'dia', trio),
        painel('faixas', 'Agendamentos do dia por dia de chegada', 'remarcação não conta como agendamento novo', 'rl-g6', 'faixas', faixas),
        painel('ranking', 'Ranking do dia', 'agendamentos feitos no dia', 'rl-g6', null, rank)),
    ];
  }

  // ---------------------------------------------------------------- grupo de leads (visão b)
  function blocoCoorte(r) {
    const c = r.coorte;
    const cols = c.dias + 1;
    const grade = el('div', { class: 'rd-calor', role: 'table', 'aria-label': 'Leads por dia de chegada e dia em que agendaram', style: `--rd-cols:${cols}` });
    const cab = (t, sub) => el('span', { class: 'rd-cab', role: 'columnheader' }, t, sub ? el('small', { text: sub }) : null);
    grade.append(cab('Chegada'), cab('Leads'), ...Array.from({ length: cols }, (_, k) => cab(k === c.dias ? `${k}+` : k === 0 ? 'Dia 0' : `Dia ${k}`)), cab('Total'));
    for (const l of c.linhas) {
      grade.append(el('span', { class: 'rd-dia-l', role: 'rowheader' }, `${ddmm(l.dia)}`, el('small', { text: nomeDia(l.dia, r.hoje).slice(0, 3).toLowerCase() === 'hoj' ? 'hoje' : semana(l.dia).slice(0, 3) })));
      grade.append(el('span', { class: 'rd-cel', role: 'cell', text: fmtN(l.chegaram) }));
      l.celulas.forEach((x, k) => {
        if (!x) { grade.append(el('span', { class: 'rd-cel fut', role: 'cell', 'aria-label': 'ainda não chegou', text: '·' })); return; }
        const p = x.acumuladoPct || 0;
        const forca = l.chegaram ? Math.round(10 + Math.min(1, p / 60) * 80) : 0;
        grade.append(el('span', { class: `rd-cel${forca > 55 ? ' forte' : ''}`, role: 'cell', title: `${ddmm(l.dia)}, dia ${k}: ${x.agendaram} agendaram · ${fmtPct(x.acumuladoPct)} acumulado`, style: x.acumulado ? `background:color-mix(in srgb, var(--rd-calor) ${forca}%, var(--vidro-item))` : '' },
          x.agendaram ? fmtN(x.agendaram) : '0', el('small', { text: l.chegaram ? fmtPct(x.acumuladoPct) : '—' })));
      });
      grade.append(el('span', { class: 'rd-cel rd-tot', role: 'cell' }, fmtN(l.agendaram), el('small', { text: fmtPct(l.conversaoPct) })));
    }
    const corpo = c.total.chegaram ? el('div', { style: 'display:grid;gap:10px' },
      el('div', { class: 'rd-calor-rolar' }, grade),
      el('div', { class: 'an-escala' }, 'menos', el('i', { style: 'background:linear-gradient(90deg, var(--vidro-item), var(--rd-calor))' }), 'mais (conversão acumulada)'),
      el('p', { class: 'rd-nota', text: `Em cada quadro: quantos agendaram naquele dia depois de chegar e, embaixo, a conversão acumulada até ali. Total: ${fmtN(c.total.agendaram)} de ${fmtN(c.total.chegaram)} leads novos agendaram (${fmtPct(c.total.conversaoPct)}).` }))
      : vazio('Nenhum lead novo neste período.');
    return painel('coorte', 'Grupo de leads por dia de chegada', `últimos ${c.linhas.length} dias até ${ddmm(r.dia)} · dia 0 = o próprio dia em que o lead chegou`, 'rl-g12', 'coorte', corpo);
  }

  // ---------------------------------------------------------------- geral do período
  function blocoGeral(r) {
    const g = r.geral;
    const kpis = el('div', { class: 'an-kpis', role: 'list', 'aria-label': 'Geral do período' },
      kpi('Leads novos', fmtN(g.chegaram), `${fmtN(g.retorno)} retorno · ${fmtN(g.importados)} importados (não contam)`),
      kpi('Agendamentos', fmtN(g.agendamentos), `Serena ${fmtN(g.porIa)} · equipe ${fmtN(g.porEquipe)} · ${fmtN(g.agendamentosRetorno)} retorno`),
      kpi('Conversão', fmtPct(g.conversaoPct), `${fmtN(g.novosQueAgendaram)} dos leads novos agendaram`),
      kpi('Tempo até agendar', fmtDur(g.tempoAteAgendarMedianaMs), `mediana · média ${fmtDur(g.tempoAteAgendarMediaMs)}`));
    const origens = g.origens.length
      ? el('table', { class: 'rl-tabela' },
        el('thead', {}, el('tr', {}, ...['Origem', 'Leads novos', 'Agendaram', 'Conversão', 'Tempo até agendar'].map((t) => el('th', { text: t })))),
        el('tbody', {}, ...g.origens.map((o) => el('tr', {},
          el('td', { text: o.origem }), el('td', { 'data-r': 'Leads novos', text: fmtN(o.chegaram) }), el('td', { 'data-r': 'Agendaram', text: fmtN(o.agendaram) }),
          el('td', { 'data-r': 'Conversão', text: fmtPct(o.conversaoPct) }), el('td', { 'data-r': 'Tempo até agendar', text: fmtDur(o.tempoMedianaMs) })))))
      : vazio('Nenhum lead novo no período.');
    const regras = el('ul', { class: 'rd-regras' },
      el('li', { text: 'Lead novo: pessoa que falou pela primeira vez no dia. Contatos importados (planilha, histórico do WhatsApp, resgate) e grupos não contam.' }),
      el('li', { text: 'Retorno: quem já tinha agendado antes e voltou (conta à parte).' }),
      el('li', { text: 'Agendamento: horário marcado pela Sintonia (IA ou equipe) naquele dia. Remarcação não conta de novo.' }),
      el('li', { text: 'Dia: de 00:00 a 23:59 no horário da Bahia.' }));
    return [
      el('h2', { class: 'rd-sec', style: 'margin:8px 0 0;font-size:19px', text: `Geral de ${ddmm(r.inicio)} a ${ddmm(r.dia)}` }),
      kpis,
      el('div', { class: 'rl-grade' },
        painel('origens', 'Por origem', 'leads novos do período e quantos já agendaram', 'rl-g8', 'origens', origens),
        painel('regras', 'Como contamos', null, 'rl-g4', null, regras)),
    ];
  }

  // ---------------------------------------------------------------- relatório automático
  function blocoEnvio() {
    const r = s.env;
    if (s.envErro) return painel('envio', 'Relatório automático no WhatsApp', null, 'rl-g12', null, vazio(s.envErro));
    if (!r) return painel('envio', 'Relatório automático no WhatsApp', 'carregando…', 'rl-g12', null, el('div', { class: 'rl-esq', style: 'height:120px' }));
    const c = s.rascunho;
    const mexeu = JSON.stringify(c) !== JSON.stringify(r.config);
    const repintar = () => desenhar();
    const chave = (rot, marcado, aoMudar) => {
      const i = el('input', { type: 'checkbox', role: 'switch' });
      i.checked = Boolean(marcado);
      i.addEventListener('change', () => aoMudar(i.checked));
      return el('label', { class: 'rd-chave' }, i, el('i', { 'aria-hidden': 'true' }), rot);
    };
    const topo = el('div', { class: 'rd-linha' },
      chave(c.ligado ? 'Ligado: a Serena envia nos horários abaixo' : 'Desligado: nada sai sozinho', c.ligado, (v) => { c.ligado = v; repintar(); }));
    const selU = (rot, valor, opcoes, aoMudar) => {
      const x = el('select', { 'aria-label': rot, onchange: (e) => aoMudar(e.target.value || null) }, ...opcoes.map(([v, t]) => el('option', { value: v, text: t })));
      x.value = valor || '';
      return el('label', { class: 'rl-campo rl-vidro' }, el('span', { text: rot }), x);
    };
    const linhaU = el('div', { class: 'rd-linha' },
      selU('Números de', c.unidade, [['', 'Todas as unidades'], ...r.unidades.map((u) => [u.id, u.nome])], (v) => { c.unidade = v; s.previa = null; repintar(); }),
      selU('Sai pelo WhatsApp de', c.unidadeEnvio, [['', r.canais.length ? 'Primeiro número conectado' : 'Nenhum número conectado'], ...r.canais.map((u) => [u.id, u.nome])], (v) => { c.unidadeEnvio = v; repintar(); }));
    const hora = (campo) => { const i = el('input', { type: 'time', value: c.horarios[campo], 'aria-label': 'Horário', onchange: (e) => { if (e.target.value) { c.horarios[campo] = e.target.value; repintar(); } } }); return i; };
    const horarios = el('div', { class: 'rd-horarios' },
      el('div', { class: 'rd-hora' }, el('b', { text: 'Agenda da manhã' }), el('span', { class: 'rd-nota', text: 'Todo dia: horários de hoje, como foi ontem e por onde começar.' }), el('div', {}, hora('agenda'))),
      el('div', { class: 'rd-hora' }, el('b', { text: 'Fechamento do dia' }), el('span', { class: 'rd-nota', text: 'Todo dia: chegaram × agendaram, metas, ranking e parados.' }), el('div', {}, hora('fechamento'))),
      el('div', { class: 'rd-hora' }, el('b', { text: 'Resumo da semana' }), el('span', { class: 'rd-nota', text: 'Os 7 dias anteriores, comparados com a semana de antes.' }),
        el('div', {}, (() => { const x = el('select', { 'aria-label': 'Dia da semana', onchange: (e) => { c.horarios.semanalDia = Number(e.target.value); repintar(); } }, ...DIAS_SEMANA.map((d, i) => el('option', { value: String(i), text: d[0].toUpperCase() + d.slice(1) }))); x.value = String(c.horarios.semanalDia); return x; })(), hora('semanal'))),
      el('div', { class: 'rd-hora' }, el('b', { text: 'Fechamento do mês' }), el('span', { class: 'rd-nota', text: 'O mês que acabou: leads, agendamentos, meta e ranking.' }),
        el('div', {}, (() => { const x = el('select', { 'aria-label': 'Dia do mês', onchange: (e) => { c.horarios.mensalDia = Number(e.target.value); repintar(); } }, ...Array.from({ length: 28 }, (_, i) => el('option', { value: String(i + 1), text: `Dia ${i + 1}` }))); x.value = String(c.horarios.mensalDia); return x; })(), hora('mensal'))));

    const lista = el('div', { class: 'rd-dest', role: 'list', 'aria-label': 'Quem recebe' });
    if (!c.destinatarios.length) lista.append(vazio('Ninguém na lista ainda. Adicione um grupo do WhatsApp ou um número.'));
    c.destinatarios.forEach((d, i) => {
      const quais = el('div', { class: 'rd-quais', role: 'group', 'aria-label': `O que ${d.nome || 'este destinatário'} recebe` }, ...r.relatorios.map((rel) => {
        const cx = el('input', { type: 'checkbox' });
        cx.checked = d.relatorios.includes(rel.id);
        cx.addEventListener('change', () => { d.relatorios = cx.checked ? [...new Set([...d.relatorios, rel.id])] : d.relatorios.filter((x) => x !== rel.id); repintar(); });
        return el('label', { class: 'rd-marca' }, cx, rel.nome);
      }));
      lista.append(el('div', { class: 'rd-pessoa', role: 'listitem' },
        el('i', { html: d.tipo === 'grupo' ? IC.grupo : IC.fone, 'aria-hidden': 'true' }),
        el('div', {}, el('b', { text: d.nome || (d.tipo === 'grupo' ? 'Grupo' : mascara(d.destino)) }), el('small', { text: d.tipo === 'grupo' ? 'Grupo do WhatsApp' : mascara(d.destino) })),
        quais,
        el('button', { class: 'rd-icone', type: 'button', title: 'Tirar da lista', 'aria-label': `Tirar ${d.nome || 'da lista'}`, html: IC.lixo, onclick: () => { c.destinatarios.splice(i, 1); repintar(); } })));
    });
    const padrao = ['agenda', 'fechamento'];
    const add = el('div', { class: 'an-acoes' },
      el('button', { class: 'an-bt', type: 'button', html: IC.grupo + '<span>Adicionar grupo</span>', onclick: () => { s.adicionando = s.adicionando === 'grupo' ? null : 'grupo'; repintar(); } }),
      el('button', { class: 'an-bt', type: 'button', html: IC.fone + '<span>Adicionar número</span>', onclick: () => { s.adicionando = s.adicionando === 'numero' ? null : 'numero'; repintar(); } }));
    let caixaAdd = null;
    if (s.adicionando === 'grupo') {
      const usados = new Set(c.destinatarios.filter((d) => d.tipo === 'grupo').map((d) => d.destino));
      const livres = r.grupos.filter((g) => !usados.has(g.id));
      const x = el('select', { 'aria-label': 'Grupo do WhatsApp', class: 'rd-campo-txt' }, el('option', { value: '', text: livres.length ? 'Escolha o grupo…' : 'Nenhum grupo disponível' }), ...livres.map((g) => el('option', { value: g.id, text: g.nome })));
      caixaAdd = el('div', { class: 'rd-add' }, el('b', { text: 'Grupo do WhatsApp (o número da loja precisa estar no grupo)' }), x,
        el('div', { class: 'an-acoes' }, el('button', { class: 'an-bt principal', type: 'button', text: 'Adicionar', onclick: () => {
          const g = r.grupos.find((y) => y.id === x.value);
          if (!g) return s.ui.toast('Escolha um grupo.');
          c.destinatarios.push({ id: crypto.randomUUID?.() || String(Date.now()), tipo: 'grupo', destino: g.id, nome: g.nome, usuarioId: null, relatorios: [...padrao] });
          s.adicionando = null; repintar();
        } }), el('button', { class: 'an-bt', type: 'button', text: 'Cancelar', onclick: () => { s.adicionando = null; repintar(); } })));
    } else if (s.adicionando === 'numero') {
      const usados = new Set(c.destinatarios.filter((d) => d.tipo === 'numero').map((d) => d.destino));
      const daEquipe = r.equipe.filter((p) => p.numero && !usados.has(p.numero));
      const semTel = r.equipe.filter((p) => !p.numero).length;
      const pessoa = el('select', { 'aria-label': 'Pessoa da equipe', class: 'rd-campo-txt' }, el('option', { value: '', text: daEquipe.length ? 'Alguém da equipe…' : 'Ninguém da equipe com WhatsApp na Conta' }), ...daEquipe.map((p) => el('option', { value: p.id, text: `${p.nome} · ${p.numeroBonito}` })));
      const nome = el('input', { class: 'rd-campo-txt', placeholder: 'Nome (ex.: Dono)', maxlength: '80', 'aria-label': 'Nome' });
      const num = el('input', { class: 'rd-campo-txt', placeholder: '+55 (71) 9xxxx-xxxx', inputmode: 'tel', 'aria-label': 'Número do WhatsApp', oninput: (e) => { e.target.value = mascara(e.target.value); } });
      caixaAdd = el('div', { class: 'rd-add' }, el('b', { text: 'Pessoa da equipe' }), pessoa,
        semTel ? el('small', { class: 'rd-nota', text: `${semTel} ${semTel === 1 ? 'pessoa ainda não cadastrou' : 'pessoas ainda não cadastraram'} o WhatsApp em Minha conta.` }) : null,
        el('b', { text: 'Ou digite um número' }), nome, num,
        el('div', { class: 'an-acoes' }, el('button', { class: 'an-bt principal', type: 'button', text: 'Adicionar', onclick: () => {
          const p = r.equipe.find((y) => y.id === pessoa.value);
          let novo;
          if (p) novo = { tipo: 'numero', destino: p.numero, nome: p.nome, usuarioId: p.id };
          else {
            const d = num.value.replace(/\D/g, '');
            if (d.length < 12) return s.ui.toast('Digite o número com DDD: +55 (71) 9xxxx-xxxx');
            novo = { tipo: 'numero', destino: d.startsWith('55') ? d : '55' + d, nome: nome.value.trim(), usuarioId: null };
          }
          if (c.destinatarios.some((y) => y.tipo === 'numero' && y.destino === novo.destino)) return s.ui.toast('Esse número já está na lista.');
          c.destinatarios.push({ id: crypto.randomUUID?.() || String(Date.now()), ...novo, relatorios: [...padrao] });
          s.adicionando = null; repintar();
        } }), el('button', { class: 'an-bt', type: 'button', text: 'Cancelar', onclick: () => { s.adicionando = null; repintar(); } })));
    }
    const salvar = el('div', { class: 'an-acoes' },
      el('button', { class: 'an-bt principal', type: 'button', disabled: !mexeu || s.salvando ? '' : null, text: s.salvando ? 'Salvando…' : mexeu ? 'Salvar' : 'Salvo', onclick: salvarEnvio }),
      mexeu ? el('button', { class: 'an-bt', type: 'button', text: 'Desfazer', onclick: () => { s.rascunho = structuredClone(r.config); repintar(); } }) : null);

    // prévia e teste
    const selRel = el('select', { class: 'rd-campo-txt', 'aria-label': 'Qual relatório', onchange: (e) => { s.relPrevia = e.target.value; s.previa = null; repintar(); } }, ...r.relatorios.map((x) => el('option', { value: x.id, text: x.nome })));
    selRel.value = s.relPrevia;
    const previa = el('div', { style: 'display:grid;gap:12px' },
      el('div', { class: 'rd-linha' }, selRel,
        el('button', { class: 'an-bt', type: 'button', html: IC.olho + '<span>Ver prévia</span>', onclick: verPrevia }),
        el('button', { class: 'an-bt', type: 'button', html: IC.enviar + '<span>Enviar teste para mim</span>', onclick: enviarTeste })),
      s.previa ? el('div', { class: 'rd-wa', 'aria-label': 'Prévia da mensagem' }, el('div', { class: 'rd-bolha', 'data-rd-previa': '', text: s.previa })) : el('p', { class: 'rd-nota', text: 'A prévia mostra exatamente o texto que sairia agora, com os números de agora.' }));
    const regs = r.registros.length
      ? el('div', { class: 'rd-reg', role: 'list' }, ...r.registros.slice(0, 12).map((x) => el('div', { role: 'listitem' },
        el('span', {}, el('b', { text: x.relatorioNome }), ' → ', x.destinoNome || x.destino.replace(/^numero:/, '').replace(/^grupo:.*/, 'grupo')),
        el('span', { class: x.situacao === 'enviado' ? 'ok' : x.situacao === 'falhou' ? 'erro' : '', text: x.situacao === 'enviado' ? 'Enviado' : x.situacao === 'falhou' ? 'Falhou' : x.situacao === 'enviando' ? 'Enviando' : 'Pulado' }),
        el('small', { text: `${dataHora(x.atualizadoEm)}${x.tentativas > 1 ? ` · ${x.tentativas} tentativas` : ''}` }),
        x.erro ? el('small', { class: 'rd-erro', text: x.erro }) : null)))
      : vazio('Nenhum envio ainda.');
    return el('div', { class: 'rl-grade' },
      painel('envio', 'Relatório automático no WhatsApp', 'a Serena manda os números como uma gerente de vendas. Começa desligado.', 'rl-g12', null,
        el('div', { class: 'rd-env' }, topo, linhaU,
          el('h3', { style: 'margin:4px 0 0;font-size:15px', text: 'Quem recebe e o quê' }), lista, add, caixaAdd,
          el('h3', { style: 'margin:4px 0 0;font-size:15px', text: 'Horários (horário da Bahia)' }), horarios,
          el('p', { class: 'rd-nota', text: 'Entre 22:00 e 07:00 nada sai atrasado: só no horário marcado. Se o envio falhar, a Sintonia tenta de novo até 3 vezes e mostra aqui embaixo.' }),
          salvar)),
      painel('previa', 'Prévia e teste', null, 'rl-g7 an-g7', null, previa),
      painel('envios', 'Últimos envios', 'enviados e falhas', 'an-g5', null, regs));
  }

  async function carregarEnvio(forcar) {
    if (s.env && !forcar) return;
    try {
      s.env = await s.ui.api('/api/relatorio-dia/envio');
      s.rascunho = structuredClone(s.env.config);
      s.envErro = null;
    } catch (e) { s.envErro = e.message || 'Não deu para carregar.'; }
    desenhar();
  }
  async function salvarEnvio() {
    s.salvando = true; desenhar();
    try {
      const c = s.rascunho;
      await s.ui.api('/api/relatorio-dia/envio', { method: 'PUT', body: JSON.stringify({ ligado: c.ligado, unidade: c.unidade, unidadeEnvio: c.unidadeEnvio, horarios: c.horarios, destinatarios: c.destinatarios.map(({ bonito, ...d }) => d) }) });
      s.ui.toast(c.ligado ? 'Salvo. A Serena envia nos horários marcados.' : 'Salvo (desligado).');
      s.salvando = false;
      await carregarEnvio(true);
    } catch (e) { s.salvando = false; s.ui.toast(e.message); desenhar(); }
  }
  async function verPrevia() {
    try {
      const r = await s.ui.api('/api/relatorio-dia/envio/previa', { method: 'POST', body: JSON.stringify({ relatorio: s.relPrevia, unidade: s.rascunho?.unidade ?? null }) });
      s.previa = r.texto;
    } catch (e) { s.ui.toast(e.message); }
    desenhar();
  }
  async function enviarTeste() {
    try {
      const r = await s.ui.api('/api/relatorio-dia/envio/teste', { method: 'POST', body: JSON.stringify({ relatorio: s.relPrevia, unidade: s.rascunho?.unidade ?? null }) });
      s.ui.toast(`Teste enviado para ${r.para}`);
      carregarEnvio(true);
    } catch (e) { s.ui.toast(e.message); }
  }

  // ---------------------------------------------------------------- moldura
  function desenhar() {
    if (!s.host || !s.host.isConnected) return;
    const r = s.dados;
    const raiz = el('div', { class: 'rd' }, controles(r));
    if (s.erro && !r) raiz.append(el('div', { class: 'rl-erro rl-vidro', role: 'alert' }, el('b', { text: 'Não deu para carregar o dia a dia' }), el('span', { text: s.erro }), el('button', { class: 'rl-botao', type: 'button', text: 'Tentar de novo', onclick: carregar })));
    else if (!r) raiz.append(el('div', { class: 'an-kpis' }, ...[1, 2, 3, 4].map(() => el('div', { class: 'rl-esq', style: 'height:96px' }))), el('div', { class: 'rl-esq', style: 'height:220px' }));
    else {
      try {
        raiz.append(...blocoDia(r), el('div', { class: 'rl-grade' }, blocoCoorte(r)), ...blocoGeral(r));
        if (r.podeConfigurar) raiz.append(el('h2', { style: 'margin:8px 0 0;font-size:19px', text: 'Relatório automático' }), blocoEnvio());
      } catch (x) { console.error(x); raiz.append(vazio('Não deu para montar o dia a dia.')); }
    }
    // Mantém a rolagem ao redesenhar (mexer na configuração não pula a tela).
    const rolador = s.host.closest('.an-caixa') || document.scrollingElement;
    const y = rolador?.scrollTop;
    s.host.replaceChildren(raiz);
    if (rolador && y != null) rolador.scrollTop = y;
  }

  async function carregar() {
    const g = ++s.geracao;
    s.erro = null;
    desenhar();
    try {
      const r = await s.ui.api(`/api/relatorio-dia?${consulta()}`);
      if (g !== s.geracao) return;
      s.dados = r;
      if (r.podeConfigurar) carregarEnvio();
    } catch (x) {
      if (g !== s.geracao) return;
      s.erro = x.message || 'Verifique a internet e tente de novo.';
      if (x.status === 400 || x.status === 403) { s.f = { ...F0 }; gravar(CHAVE, s.f); }
    }
    desenhar();
  }

  window.SintoniaRelatorioDia = {
    /** Monta a aba dentro de `host` (telas/analises.js). */
    montar(host, ui) {
      estilo();
      s.host = host;
      s.ui = ui;
      s.dados = null;
      carregar();
    },
    /** Texto subtítulo para o topo das Análises. */
    subtitulo: () => (s.dados ? `${nomeDia(s.dados.dia, s.dados.hoje)}, ${ddmm(s.dados.dia)}` : 'Carregando…'),
  };
})();
