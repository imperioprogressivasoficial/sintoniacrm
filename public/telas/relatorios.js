/* Tela "relatorios" da Sintonia: registra window.SintoniaTelas.relatorios = { desenhar(caixa, ui) }.
 * Relatórios da gestão: leads por dia (curva) e por origem (anel), conversão, equipe, IA × equipe, motivos de perda e tags.
 * Visual "vidro" (docs/ESTILO-VIDRO.md): título grande com números em círculos de vidro, trilho de pílulas,
 * painéis de vidro com botões redondos, curva suave com traço brilhante e área em degradê. SVG puro, sem bibliotecas.
 * Cada relatório exporta CSV (/api/relatorios/:nome/csv). Estilos em <style id="estilo-relatorios">, prefixo .rl-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const PERIODOS = [['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias'], ['personalizado', 'Período']];
  const CHAVE = 'sintonia.relatorios.filtro';
  /** Só cores da Sintonia: azul, menta, céu, turquesa, lavanda-azulada, âmbar, coral. */
  const CORES = ['var(--azul-serie)', 'var(--marca-menta)', '#7cc4ff', '#19c3a6', '#9db8ff', '#f5b800', '#ff7a59'];
  const RELATORIOS = [['origem', 'Leads por origem e dia'], ['conversao', 'Conversão do funil'], ['atendentes', 'Desempenho do time'], ['ia-equipe', 'IA × equipe'], ['perdas', 'Motivos de perda'], ['tags', 'Tags mais usadas']];

  const CSS = `
  .rl-caixa.rl-caixa { grid-template-columns: minmax(0, 1fr); overflow-x: hidden; padding: 14px 16px 0; gap: 0; }
  html[data-tema="escuro"] .rl { --azul-serie: #7cc4ff; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .rl { --azul-serie: #7cc4ff; } }
  .rl { --azul-serie: var(--marca-azul); --acento: var(--marca-menta); --acento-suave: color-mix(in srgb, var(--marca-menta) 14%, transparent); --brilho: color-mix(in srgb, var(--marca-menta) 50%, transparent); --menta: var(--marca-menta); --noite: #071d33;
        display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-bottom: 28px; min-width: 0; max-width: 1240px; width: 100%; margin: 0 auto; }
  @media (max-width: 760px) { .rl { padding-bottom: 110px; } }
  .rl-vidro { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%); }

  .rl-topo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 30px; }
  .rl-topo h1.titulo-grande { margin: 0 !important; font-size: 38px; letter-spacing: -.03em; }
  .rl-topo .rl-quando { display: block; font-size: 13.5px; font-weight: 600; color: var(--sub); letter-spacing: 0; margin-top: 2px; }
  .rl-numeros { display: flex; gap: 22px; overflow-x: auto; scrollbar-width: none; flex: 1 1 auto; min-width: 0; padding: 2px; }
  .rl-numeros::-webkit-scrollbar { display: none; }
  @media (max-width: 760px) { .rl-numeros { flex-basis: 100%; gap: 18px; margin: 0 -16px; padding: 2px 16px; } }
  .rl-num { display: flex; align-items: center; gap: 10px; flex: none; }
  .rl-circ { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); flex: none; box-sizing: border-box; }
  .rl-circ svg { width: 19px; height: 19px; }
  .rl-num b { display: block; font-size: 22px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rl-num small { display: block; font-size: 12px; color: var(--sub); white-space: nowrap; }
  .rl-selo { display: inline-block; font-size: 11.5px; font-weight: 800; padding: 2px 8px; border-radius: 999px; margin-left: 6px; vertical-align: 3px; background: var(--acento-suave); color: var(--acento); letter-spacing: 0; }

  .rl-controles { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .rl-trilho { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; overflow-x: auto; scrollbar-width: none; max-width: 100%; box-sizing: border-box; }
  .rl-trilho::-webkit-scrollbar { display: none; }
  .rl-trilho button { all: unset; cursor: pointer; padding: 9px 15px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); white-space: nowrap; border: 1px solid transparent; transition: background .18s, color .18s; }
  .rl-trilho button[aria-pressed="true"] { background: var(--vidro-ativo); color: var(--texto); border-color: var(--vidro-borda); box-shadow: 0 2px 10px rgba(0, 0, 0, .08); font-weight: 700; }
  .rl-campo { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; padding: 0 8px 0 14px; min-height: 44px; box-sizing: border-box; min-width: 0; }
  .rl-campo span { font-size: 12px; color: var(--sub); font-weight: 700; white-space: nowrap; }
  .rl-campo select, .rl-campo input { all: unset; font: inherit; font-size: 14px; font-weight: 600; color: var(--texto); padding: 8px 6px; cursor: pointer; min-width: 0; max-width: 170px; }
  .rl-campo select option { color: #106ebe; }
  html[data-tema="escuro"] .rl input, html[data-tema="escuro"] .rl select { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .rl input, html:not([data-tema="claro"]) .rl select { color-scheme: dark; } }
  .rl-espaco { flex: 1; }
  .rl-exportar { position: relative; }
  .rl-exportar summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; min-height: 44px; box-sizing: border-box; padding: 0 18px; border-radius: 999px; background: var(--menta); color: var(--noite); font-weight: 800; font-size: 14.5px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 35%, transparent), 0 6px 22px color-mix(in srgb, var(--marca-menta) 35%, transparent); transition: transform .18s; }
  .rl-exportar summary:hover { transform: translateY(-1px); }
  .rl-exportar summary::-webkit-details-marker { display: none; }
  .rl-exportar summary svg { width: 17px; height: 17px; }
  .rl-menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 5; border-radius: 18px; padding: 6px; display: grid; min-width: 250px; background: var(--vidro-forte); }
  .rl-menu a { display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 12px; color: var(--texto); text-decoration: none; font-size: 14px; font-weight: 600; }
  .rl-menu a:hover { background: var(--vidro-item); }
  .rl-menu a svg { width: 16px; height: 16px; color: var(--sub); }
  @media (max-width: 560px) { .rl-espaco { display: none; } .rl-menu { right: auto; left: 0; } }
  .rl-trilho button:focus-visible, .rl-exportar summary:focus-visible, .rl-redondo:focus-visible, .rl-menu a:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }

  .rl-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1100px) { .rl-grade { grid-template-columns: repeat(12, minmax(0, 1fr)); } .rl-g8 { grid-column: span 8; } .rl-g4 { grid-column: span 4; } .rl-g6 { grid-column: span 6; } .rl-g12 { grid-column: 1 / -1; } }
  .rl-painel { border-radius: 24px; padding: 18px; min-width: 0; display: grid; gap: 14px; align-content: start; container: rlpainel / inline-size; }
  .rl-cab { display: flex; align-items: flex-start; gap: 10px; }
  .rl-cab h2 { margin: 0; font-size: 15px; font-weight: 700; flex: 1; min-width: 0; }
  .rl-cab h2 small { display: block; font-size: 12.5px; font-weight: 500; color: var(--sub); margin-top: 3px; line-height: 1.4; }
  .rl-redondo { all: unset; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); flex: none; background: var(--vidro-item); border: 1px solid var(--vidro-borda); transition: transform .18s; box-sizing: border-box; }
  .rl-redondo:hover { transform: translateY(-1px); }
  .rl-redondo svg { width: 16px; height: 16px; }
  @media (max-width: 760px) { .rl-redondo { width: 44px; height: 44px; } }
  .rl-destaque { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .rl-destaque b { font-size: 34px; font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1; }
  .rl-destaque span { font-size: 13px; color: var(--sub); }
  .rl-vazio { font-size: 14px; color: var(--sub); line-height: 1.45; }
  .rl-legenda { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--sub); }
  .rl-legenda span { display: inline-flex; align-items: center; gap: 6px; }
  .rl-legenda b { color: var(--texto); font-weight: 700; font-variant-numeric: tabular-nums; }
  .rl-bol { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
  .rl-tracejado { width: 16px; border-top: 2px dashed var(--sub); display: inline-block; }

  .rl-svg { width: 100%; height: auto; display: block; overflow: visible; }
  .rl-svg text { fill: var(--sub); font-size: 11px; font-family: var(--fonte); }
  .rl-svg .rl-grid { stroke: var(--vidro-linha); stroke-width: 1; }
  .rl-svg .rl-curva { fill: none; stroke: var(--acento); stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 6px var(--brilho)); }
  .rl-svg .rl-media { stroke: var(--sub); stroke-width: 1.2; stroke-dasharray: 5 5; opacity: .7; }
  .rl-svg .rl-ponto { fill: var(--acento); filter: drop-shadow(0 0 6px var(--brilho)); }
  .rl-svg .rl-alvo { fill: transparent; cursor: pointer; }
  .rl-dica { position: absolute; pointer-events: none; padding: 7px 11px; border-radius: 12px; font-size: 12.5px; white-space: nowrap; transform: translate(-50%, -118%); background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); color: var(--sub); }
  .rl-dica b { display: block; font-size: 14px; color: var(--texto); }

  .rl-anel { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 16px; align-items: center; }
  @container rlpainel (max-width: 340px) { .rl-anel { grid-template-columns: minmax(0, 1fr); justify-items: center; } }
  .rl-anel svg { width: 150px; height: 150px; }
  .rl-origens { display: grid; gap: 9px; width: 100%; }
  .rl-origens div { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 8px; align-items: center; font-size: 13.5px; }
  .rl-origens span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rl-origens b { font-variant-numeric: tabular-nums; }
  .rl-origens em { font-style: normal; color: var(--sub); font-size: 12.5px; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }

  .rl-barras { display: grid; gap: 11px; }
  .rl-barra { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; font-size: 13.5px; }
  .rl-barra > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .rl-barra > span:first-child .rl-bol { margin-right: 7px; }
  .rl-barra .rl-trilha { grid-column: 1 / -1; grid-row: 2; }
  .rl-trilha { display: block; height: 10px; border-radius: 999px; background: var(--vidro-item); overflow: hidden; }
  .rl-trilha i { display: block; height: 100%; border-radius: 999px; min-width: 4px; background: var(--acento); transition: width .25s; }
  .rl-barra b { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; }
  .rl-barra b small { color: var(--sub); font-weight: 500; font-size: 12px; margin-left: 5px; }

  .rl-funil { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; height: 200px; }
  .rl-coluna { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; gap: 6px; text-align: center; min-width: 0; }
  .rl-coluna b { font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .rl-coluna b small { display: block; font-size: 11.5px; color: var(--sub); font-weight: 600; }
  .rl-pilha { display: flex; flex-direction: column; justify-content: flex-end; border-radius: 16px; overflow: hidden; background: var(--vidro-item); }
  .rl-pilha i { display: block; border-radius: 16px; }
  .rl-coluna span { font-size: 12px; color: var(--sub); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .rl-tabela { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
  .rl-tabela th { text-align: right; font-size: 12px; color: var(--sub); font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--vidro-linha); white-space: nowrap; }
  .rl-tabela td { text-align: right; padding: 10px 8px; border-bottom: 1px solid var(--vidro-linha); white-space: nowrap; }
  .rl-tabela th:first-child, .rl-tabela td:first-child { text-align: left; white-space: normal; }
  .rl-tabela tr:last-child td { border-bottom: 0; }
  .rl-tabela td.rl-zero { color: var(--sub); }
  .rl-pessoa { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; }
  .rl-ini { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 11.5px; font-weight: 800; background: var(--acento-suave); color: var(--acento); flex: none; }
  @container rlpainel (max-width: 560px) {
    .rl-tabela thead { display: none; }
    .rl-tabela, .rl-tabela tbody, .rl-tabela tr, .rl-tabela td { display: block; }
    .rl-tabela tr { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px 6px; background: var(--vidro-item); border-radius: 18px; padding: 12px; margin-bottom: 8px; }
    .rl-tabela td { border: 0; padding: 0; text-align: left; font-weight: 700; font-size: 15px; white-space: normal; }
    .rl-tabela td::before { content: attr(data-r); display: block; font-size: 11px; font-weight: 500; color: var(--sub); }
    .rl-tabela td:first-child { grid-column: 1 / -1; }
    .rl-tabela td:first-child::before { display: none; }
  }
  .rl-duelo { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .rl-lado { border-radius: 18px; background: var(--vidro-item); padding: 12px; display: grid; gap: 8px; align-content: start; }
  .rl-lado h3 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 7px; }
  .rl-lado dl { margin: 0; display: grid; gap: 7px; }
  .rl-lado dl div { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--sub); }
  .rl-lado dd { margin: 0; color: var(--texto); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .rl-divisao { display: flex; height: 10px; border-radius: 999px; overflow: hidden; background: var(--vidro-item); gap: 3px; }
  .rl-divisao i { display: block; height: 100%; border-radius: 999px; }
  .rl-esq { border-radius: 24px; height: 220px; background: var(--vidro-fundo); animation: rl-pulso 1.4s ease-in-out infinite; }
  @keyframes rl-pulso { 50% { opacity: .5; } }
  .rl-erro { border-radius: 24px; padding: 28px 20px; display: grid; gap: 12px; justify-items: center; text-align: center; color: var(--sub); }
  .rl-erro b { color: var(--texto); font-size: 17px; }
  .rl-botao { all: unset; cursor: pointer; padding: 11px 20px; border-radius: 999px; background: var(--menta); color: var(--noite); font-weight: 800; }
  @media (prefers-reduced-motion: reduce) { .rl *, .rl-esq { transition: none !important; animation: none !important; } }
  `;

  const IC = {
    baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
    pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0M16 4.8a3.4 3.4 0 0 1 0 6.4M18.2 14.3a6.2 6.2 0 0 1 3 5.7"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    raio: '<svg viewBox="0 0 24 24" fill="#f5b800"><path d="M13.5 2 4 14h7l-1.5 8L20 10h-7l.5-8Z"/></svg>',
  };

  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  const fmtPct = (v) => (v == null ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')}%`);
  function fmtTempo(seg) {
    if (seg == null || !isFinite(seg)) return '—';
    const s = Math.max(0, Math.round(seg));
    if (s < 60) return `${s} s`;
    if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? `${m} min ${r} s` : `${m} min`; }
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return `${h} h ${String(m).padStart(2, '0')}`;
  }
  const hojeBahia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
  const diaCurto = (iso) => { const [, m, d] = iso.split('-'); return `${Number(d)}/${Number(m)}`; };
  const dataLonga = (d) => new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'America/Bahia' }).format(new Date(d)).replace('.', '');
  const iniciais = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  const lerFiltro = () => { try { return JSON.parse(sessionStorage.getItem(CHAVE) || 'null'); } catch { return null; } };
  const gravarFiltro = () => { try { sessionStorage.setItem(CHAVE, JSON.stringify(s.f)); } catch { /* sem armazenamento */ } };
  const s = { f: lerFiltro() || { periodo: '7d', de: '', ate: '', unidade: '', atendente: '' }, dados: null, erro: null, geracao: 0, caixa: null, ui: null };

  function estilo() {
    if (document.getElementById('estilo-relatorios')) return;
    const st = document.createElement('style');
    st.id = 'estilo-relatorios';
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
  const csvDe = (nome) => `/api/relatorios/${nome}/csv?${consulta()}`;

  // ---------- pedaços ----------
  function painel(ui, nome, titulo, sub, classe, ...filhos) {
    const el = ui.el;
    const csv = el('a', { class: 'rl-redondo', href: csvDe(nome), download: '', title: `Exportar "${titulo}" (CSV)`, 'aria-label': `Exportar ${titulo} em CSV`, html: IC.baixar });
    return el('section', { class: `rl-painel rl-vidro ${classe || ''}`, 'aria-label': titulo },
      el('div', { class: 'rl-cab' }, el('h2', {}, titulo, sub ? el('small', { text: sub }) : null), csv), ...filhos);
  }

  function barras(ui, itens) {
    const el = ui.el;
    const max = Math.max(1, ...itens.map((x) => x.valor));
    return el('div', { class: 'rl-barras', role: 'list' }, ...itens.map((x) =>
      el('div', { class: 'rl-barra', role: 'listitem', 'aria-label': `${x.nome}: ${x.valor}` },
        el('span', {}, x.cor ? el('i', { class: 'rl-bol', style: `background:${x.cor}` }) : null, x.nome),
        el('span', { class: 'rl-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(2, (x.valor / max) * 100)}%${x.cor ? `;background:${x.cor}` : ''}` })),
        el('b', {}, fmtN(x.valor), x.nota ? el('small', { text: x.nota }) : null))));
  }

  /** Curva suave (Catmull-Rom → Bézier) com área em degradê, linha da média tracejada e dica de vidro. */
  function curva(ui, dias) {
    const NS = 'http://www.w3.org/2000/svg';
    const W = Math.round(Math.max(300, Math.min(1100, (s.caixa?.clientWidth || 700) * (window.innerWidth >= 1100 ? 0.62 : 1) - 70)));
    const H = W < 600 ? 170 : 210, esq = 26, dir = 10, topo = 14, base = H - 22;
    const vals = dias.map((d) => d.total);
    const max = Math.max(2, ...vals) * 1.15;
    const media = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const x = (i) => (dias.length === 1 ? (esq + W - dir) / 2 : esq + (i * (W - esq - dir)) / (dias.length - 1));
    const y = (v) => base - (v / max) * (base - topo);
    const pts = vals.map((v, i) => [x(i), y(v)]);
    let d = pts.length === 1 ? `M${esq},${pts[0][1]} L${W - dir},${pts[0][1]}` : `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(base, p1[1] + (p2[1] - p0[1]) / 6)];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(base, p2[1] - (p3[1] - p1[1]) / 6)];
      d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
    }
    const area = pts.length === 1 ? `${d} L${W - dir},${base} L${esq},${base} Z` : `${d} L${pts.at(-1)[0]},${base} L${pts[0][0]},${base} Z`;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'rl-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Leads por dia: média de ${String(Math.round(media * 10) / 10).replace('.', ',')} por dia, máximo de ${Math.max(0, ...vals)}.`);
    const add = (tag, at, txt, pai = svg) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) n.setAttribute(k, v); if (txt != null) n.textContent = txt; pai.append(n); return n; };
    const id = 'rl-grad-' + Math.random().toString(36).slice(2, 8);
    const grad = add('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, null, add('defs', {}));
    add('stop', { offset: '0%', style: 'stop-color:var(--acento);stop-opacity:.38' }, null, grad);
    add('stop', { offset: '100%', style: 'stop-color:var(--acento);stop-opacity:0' }, null, grad);
    const passo = Math.max(1, Math.ceil(max / 4));
    for (let v = 0; v <= max; v += passo) {
      add('line', { x1: esq, x2: W - dir, y1: y(v), y2: y(v), class: 'rl-grid' });
      add('text', { x: esq - 8, y: y(v) + 4, 'text-anchor': 'end' }, String(v));
    }
    add('path', { d: area, fill: `url(#${id})` });
    add('line', { x1: esq, x2: W - dir, y1: y(media), y2: y(media), class: 'rl-media' });
    add('path', { d, class: 'rl-curva' });
    const ultimo = pts.at(-1);
    add('circle', { cx: ultimo[0], cy: ultimo[1], r: 4.5, class: 'rl-ponto' });
    const cada = Math.ceil(dias.length / Math.max(3, Math.floor(W / 70)));
    dias.forEach((dd, i) => { if (i % cada === 0 || i === dias.length - 1) add('text', { x: x(i), y: H - 4, 'text-anchor': dias.length > 1 && i === 0 ? 'start' : dias.length > 1 && i === dias.length - 1 ? 'end' : 'middle' }, diaCurto(dd.dia)); });
    const caixa = ui.el('div', { style: 'position:relative' });
    caixa.append(svg);
    const dica = ui.el('div', { class: 'rl-dica', hidden: '' });
    caixa.append(dica);
    const larg = dias.length > 1 ? (W - esq - dir) / (dias.length - 1) : W;
    dias.forEach((dd, i) => {
      const alvo = add('rect', { x: x(i) - larg / 2, y: 0, width: larg, height: H, class: 'rl-alvo' });
      const mostrar = () => {
        const k = svg.getBoundingClientRect().width / W;
        dica.replaceChildren(ui.el('b', { text: `${fmtN(dd.total)} ${dd.total === 1 ? 'lead' : 'leads'}` }), diaCurto(dd.dia));
        dica.style.left = `${x(i) * k}px`; dica.style.top = `${y(dd.total) * k}px`; dica.hidden = false;
      };
      alvo.addEventListener('pointerenter', mostrar);
      alvo.addEventListener('click', mostrar);
    });
    svg.addEventListener('pointerleave', () => { dica.hidden = true; });
    return { caixa, media };
  }

  function painelDias(ui, r) {
    const el = ui.el;
    const o = r.origem;
    if (!o.total) return painel(ui, 'origem', 'Leads por dia', null, 'rl-g8', el('div', { class: 'rl-vazio', text: 'Nenhum lead novo neste período. Cada cliente que chama pela primeira vez (ou entra por importação) aparece aqui.' }));
    const { caixa, media } = curva(ui, o.dias);
    return painel(ui, 'origem', 'Leads por dia', null, 'rl-g8',
      el('div', { class: 'rl-destaque' }, el('b', { text: fmtN(o.total) }), el('span', { text: `leads em ${r.dias} ${r.dias === 1 ? 'dia' : 'dias'} · média ${String(Math.round(media * 10) / 10).replace('.', ',')} por dia` })),
      caixa,
      el('div', { class: 'rl-legenda' }, el('span', {}, el('i', { class: 'rl-bol', style: 'background:var(--acento);box-shadow:0 0 6px var(--brilho)' }), 'Leads por dia'), el('span', {}, el('i', { class: 'rl-tracejado' }), 'Média do período')));
  }

  /** Anel (donut) das origens com o total no centro. */
  function painelOrigem(ui, r) {
    const el = ui.el;
    const o = r.origem;
    const sub = o.campo ? `pelo campo "${o.campo}" da ficha` : 'por onde a cliente chegou';
    if (!o.total) return painel(ui, 'origem', 'Origem dos leads', sub, 'rl-g4', el('div', { class: 'rl-vazio', text: 'Sem leads no período.' }));
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', o.origens.map((x) => `${x.origem}: ${x.total}`).join(', '));
    const R = 48, C = 2 * Math.PI * R, folga = o.origens.length > 1 ? 14 : 0;
    const add = (tag, at, txt) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(at)) n.setAttribute(k, v); if (txt != null) n.textContent = txt; svg.append(n); return n; };
    add('circle', { cx: 60, cy: 60, r: R, fill: 'none', style: 'stroke:var(--vidro-item)', 'stroke-width': 12 });
    let ini = 0;
    o.origens.forEach((x, i) => {
      const parte = (x.total / o.total) * C;
      add('circle', { cx: 60, cy: 60, r: R, fill: 'none', style: `stroke:${CORES[i % CORES.length]}`, 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-dasharray': `${Math.max(0.1, parte - folga)} ${C}`, 'stroke-dashoffset': -(ini + folga / 2), transform: 'rotate(-90 60 60)' });
      ini += parte;
    });
    add('text', { x: 60, y: 63, 'text-anchor': 'middle', 'font-size': 26, 'font-weight': 800, style: 'fill:var(--texto);font-family:var(--fonte)' }, fmtN(o.total));
    add('text', { x: 60, y: 79, 'text-anchor': 'middle', 'font-size': 9.5, style: 'fill:var(--sub);font-family:var(--fonte)' }, 'novos leads');
    return painel(ui, 'origem', 'Origem dos leads', sub, 'rl-g4',
      el('div', { class: 'rl-anel' }, svg,
        el('div', { class: 'rl-origens' }, ...o.origens.map((x, i) => el('div', {}, el('i', { class: 'rl-bol', style: `background:${CORES[i % CORES.length]}` }), el('span', { text: x.origem }), el('b', { text: fmtN(x.total) }), el('em', { text: fmtPct((x.total / o.total) * 100) }))))));
  }

  function painelConversao(ui, r) {
    const el = ui.el;
    const et = r.conversao.etapas;
    const total = et[0]?.total || 0;
    if (!total) return painel(ui, 'conversao', 'Conversão do funil', 'de quem chegou no período', 'rl-g6', el('div', { class: 'rl-vazio', text: 'Sem leads novos no período para acompanhar a conversão.' }));
    const cores = ['#7cc4ff', 'var(--azul-serie)', '#19c3a6', 'var(--marca-menta)'];
    return painel(ui, 'conversao', 'Conversão do funil', `de quem chegou no período, até agora · ${fmtN(r.conversao.perdidas)} perdidas`, 'rl-g6',
      el('div', { class: 'rl-funil', role: 'list' }, ...et.map((e, i) => el('div', { class: 'rl-coluna', role: 'listitem', 'aria-label': `${e.nome}: ${e.total} (${fmtPct(e.pct)})` },
        el('b', {}, fmtN(e.total), el('small', { text: fmtPct(e.pct) })),
        el('div', { class: 'rl-pilha' }, el('i', { style: `height:${Math.max(e.total ? 4 : 0, (e.total / total) * 100)}%;background:${cores[i]}` })),
        el('span', { text: e.nome })))));
  }

  function painelAtendentes(ui, r) {
    const el = ui.el;
    const lista = r.atendentes || [];
    if (!lista.length) return painel(ui, 'atendentes', 'Desempenho do time', null, 'rl-g12', el('div', { class: 'rl-vazio', text: 'Ninguém da equipe atuou neste período.' }));
    const cols = [['respostas', 'Respostas', fmtN], ['primeiraRespostaSeg', '1ª resposta', fmtTempo], ['tempoMedioRespostaSeg', 'Tempo médio', fmtTempo], ['agendamentos', 'Agend.', fmtN], ['ligacoes', 'Ligações', fmtN], ['conversasDona', 'Conversas', fmtN]];
    const tab = el('table', { class: 'rl-tabela' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Atendente' }), ...cols.map(([, t]) => el('th', { text: t })))),
      el('tbody', {}, ...lista.map((a) => el('tr', {}, el('td', {}, el('span', { class: 'rl-pessoa' }, window.SintoniaFotos?.aplicar(el('span', { class: 'rl-ini', text: iniciais(a.nome) }), a.usuarioId) ?? el('span', { class: 'rl-ini', text: iniciais(a.nome) }), a.nome)), ...cols.map(([k, t, f]) => el('td', { 'data-r': t, class: a[k] ? '' : 'rl-zero', text: f(a[k]) }))))));
    return painel(ui, 'atendentes', 'Desempenho do time', '1ª resposta: quanto a cliente nova esperou até a primeira resposta dela', 'rl-g12', tab);
  }

  function painelIaEquipe(ui, r) {
    const el = ui.el;
    const { ia, equipe } = r.iaEquipe;
    const tot = ia.agendamentos + equipe.agendamentos;
    const linha = (rot, v) => el('div', {}, el('dt', { text: rot }), el('dd', { text: v }));
    const lado = (titulo, cor, x, extra) => el('div', { class: 'rl-lado' },
      el('h3', {}, el('i', { class: 'rl-bol', style: `background:${cor}` }), titulo),
      el('dl', {}, linha('Respostas', fmtN(x.respostas)), linha('1ª resposta', fmtTempo(x.primeiraRespostaSeg)), linha('Tempo médio', fmtTempo(x.tempoMedioRespostaSeg)), linha('Agendamentos', fmtN(x.agendamentos)), ...extra));
    return painel(ui, 'ia-equipe', 'IA × equipe', null, 'rl-g6',
      el('div', { class: 'rl-duelo' },
        lado('IA', 'var(--marca-menta)', ia, [linha('Assumiu', fmtN(ia.assumiu)), linha('Pediu ajuda', fmtN(ia.passouParaEquipe))]),
        lado('Equipe', 'var(--azul-serie)', equipe, [])),
      tot ? el('div', { style: 'display:grid;gap:8px' },
        el('div', { class: 'rl-divisao', role: 'img', 'aria-label': `Agendamentos: IA ${fmtPct(ia.agendamentosPct)}, equipe ${fmtPct(equipe.agendamentosPct)}` },
          ia.agendamentos ? el('i', { style: `width:${ia.agendamentosPct}%;background:var(--marca-menta)` }) : null, equipe.agendamentos ? el('i', { style: `width:${equipe.agendamentosPct}%;background:var(--azul-serie)` }) : null),
        el('div', { class: 'rl-legenda' }, el('span', {}, 'Agendamentos da IA', el('b', { text: fmtPct(ia.agendamentosPct) })), el('span', {}, 'da equipe', el('b', { text: fmtPct(equipe.agendamentosPct) })))) : null);
  }

  function painelPerdas(ui, r) {
    const el = ui.el;
    const p = r.perdas;
    if (!p.total) return painel(ui, 'perdas', 'Motivos de perda', null, 'rl-g6', el('div', { class: 'rl-vazio', text: 'Nenhuma conversa foi para "Perdida" neste período.' }));
    const sub = p.campo ? `pelo campo "${p.campo}" da ficha` : `${fmtN(p.total)} ${p.total === 1 ? 'conversa perdida' : 'conversas perdidas'} no período`;
    return painel(ui, 'perdas', 'Motivos de perda', sub, 'rl-g6', barras(ui, p.motivos.map((m) => ({ nome: m.motivo, valor: m.total, nota: fmtPct(m.pct), cor: '#ff7a59' }))));
  }

  function painelTags(ui, r) {
    const el = ui.el;
    if (!r.tags.length) return painel(ui, 'tags', 'Tags mais usadas', null, 'rl-g6', el('div', { class: 'rl-vazio', text: 'Nenhuma tag marcada neste período.' }));
    return painel(ui, 'tags', 'Tags mais usadas', 'marcações no período · conversas com a tag agora', 'rl-g6',
      barras(ui, r.tags.slice(0, 10).map((t) => ({ nome: t.nome, valor: t.marcacoes, cor: t.cor, nota: `${fmtN(t.conversasAgora)} agora` }))));
  }

  function numeros(ui, r) {
    const el = ui.el;
    const et = r.conversao.etapas;
    const n = (ic, valor, rot, selo) => el('div', { class: 'rl-num', role: 'listitem' }, el('span', { class: 'rl-circ rl-vidro', html: ic, 'aria-hidden': 'true' }),
      el('div', {}, el('b', {}, valor, selo ? el('span', { class: 'rl-selo', text: selo }) : null), el('small', { text: rot })));
    return el('div', { class: 'rl-numeros', role: 'list', 'aria-label': 'Resumo' },
      n(IC.pessoas, fmtN(r.origem.total), 'leads no período'),
      n(IC.agenda, fmtN(et[2]?.total), 'agendaram', et[2]?.pct != null ? fmtPct(et[2].pct) : null),
      n(IC.relogio, fmtTempo(r.iaEquipe.equipe.primeiraRespostaSeg), '1ª resposta da equipe'),
      n(IC.raio, fmtN(r.iaEquipe.ia.agendamentos), 'agendados pela IA'));
  }

  function controles(ui) {
    const el = ui.el;
    const op = s.dados?.opcoes || { unidades: [], atendentes: [] };
    const trilho = el('div', { class: 'rl-trilho rl-vidro', role: 'group', 'aria-label': 'Período' },
      ...PERIODOS.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(k === s.f.periodo), text: t, onclick: () => mudar({ periodo: k, ...(k === 'personalizado' && !s.f.de ? { de: addDias(hojeBahia(), -6), ate: hojeBahia() } : {}) }) })));
    const linha = el('div', { class: 'rl-controles' }, trilho);
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
    const exportar = el('details', { class: 'rl-exportar' },
      el('summary', { html: IC.baixar + '<span>Exportar</span>' }),
      el('div', { class: 'rl-menu rl-vidro', role: 'menu' }, ...RELATORIOS.map(([k, t]) => el('a', { href: csvDe(k), download: '', role: 'menuitem', html: IC.baixar }, `${t} (CSV)`))));
    exportar.addEventListener('focusout', (e) => { if (!exportar.contains(e.relatedTarget)) exportar.open = false; });
    linha.append(el('span', { class: 'rl-espaco' }), exportar);
    return linha;
  }

  /** Abas: visão geral | links rastreados (origem dos leads e anúncios). */
  function abas(ui) {
    const el = ui.el;
    return el('div', { class: 'rl-trilho rl-vidro', role: 'tablist', 'aria-label': 'Seção dos relatórios' },
      el('button', { type: 'button', role: 'tab', 'aria-pressed': String(s.aba !== 'links'), 'aria-selected': String(s.aba !== 'links'), text: 'Visão geral', onclick: () => { s.aba = 'geral'; carregar(); } }),
      el('button', { type: 'button', role: 'tab', 'aria-pressed': String(s.aba === 'links'), 'aria-selected': String(s.aba === 'links'), text: '📣 Origem dos leads e links', onclick: () => { s.aba = 'links'; desenharTudo(); } }));
  }

  function desenharTudo() {
    const { ui, caixa } = s;
    if (!caixa) return;
    const el = ui.el;
    if (s.aba === 'links' && window.SintoniaTelas.links) {
      const corpo = el('div');
      caixa.replaceChildren(el('div', { class: 'rl' }, el('div', { class: 'rl-topo' }, el('h1', { class: 'titulo-grande', text: 'Relatórios' })), abas(ui), corpo));
      window.SintoniaTelas.links.desenhar(corpo, ui);
      return;
    }
    const r = s.dados;
    let quando = 'Carregando…';
    if (r) {
      const ultimo = new Date(new Date(r.fim).getTime() - 1);
      const periodo = r.dias === 1 ? dataLonga(r.inicio) : `${dataLonga(r.inicio)} a ${dataLonga(ultimo)}`;
      const unidade = r.unidade ? r.opcoes.unidades.find((u) => u.id === r.unidade)?.nome : r.opcoes.unidades.length > 1 ? 'todas as unidades' : r.opcoes.unidades[0]?.nome;
      const at = r.atendente ? r.opcoes.atendentes.find((a) => a.id === r.atendente)?.nome : null;
      quando = [periodo, unidade, at].filter(Boolean).join(' · ');
    }
    const topo = el('div', { class: 'rl-topo' }, el('h1', { class: 'titulo-grande' }, 'Relatórios', el('span', { class: 'rl-quando', text: quando })), r ? numeros(ui, r) : null);
    const raiz = el('div', { class: 'rl' }, topo, abas(ui), controles(ui));
    if (s.erro && !r) raiz.append(el('div', { class: 'rl-erro rl-vidro', role: 'alert' }, el('b', { text: 'Não deu para carregar os relatórios' }), el('span', { text: s.erro }), el('button', { class: 'rl-botao', type: 'button', text: 'Tentar de novo', onclick: carregar })));
    else if (!r) raiz.append(el('div', { class: 'rl-esq' }), el('div', { class: 'rl-esq' }));
    else {
      if (s.erro) raiz.append(el('div', { class: 'rl-vazio', role: 'alert', text: s.erro }));
      raiz.append(el('div', { class: 'rl-grade' }, painelDias(ui, r), painelOrigem(ui, r), painelConversao(ui, r), painelIaEquipe(ui, r), painelAtendentes(ui, r), painelPerdas(ui, r), painelTags(ui, r)));
    }
    caixa.replaceChildren(raiz);
  }

  function mudar(p) {
    s.f = { ...s.f, ...p };
    gravarFiltro();
    carregar();
  }

  async function carregar() {
    const { ui } = s;
    if (s.aba === 'links') { if (!s.caixa?.querySelector('.ra-tela')) desenharTudo(); return; }
    const g = ++s.geracao;
    if (s.f.periodo === 'personalizado' && (!s.f.de || !s.f.ate)) { desenharTudo(); return; }
    desenharTudo();
    try {
      const r = await ui.api('/api/relatorios?' + consulta());
      if (g !== s.geracao) return;
      s.dados = r;
      s.erro = null;
    } catch (x) {
      if (g !== s.geracao) return;
      s.erro = x.message || 'Verifique a internet e tente de novo.';
      // Filtro que deixou de valer (ex.: atendente de outra unidade): volta ao padrão.
      if (x.status === 403 || x.status === 400) { s.f = { periodo: '7d', de: '', ate: '', unidade: '', atendente: '' }; gravarFiltro(); }
    }
    if (s.caixa?.isConnected) desenharTudo();
  }

  window.SintoniaTelas.relatorios = {
    async desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa;
      s.ui = ui;
      caixa.classList.add('rl-caixa');
      if (ui.estado.eu && !ui.ehGestor(ui.estado.eu)) {
        caixa.replaceChildren(ui.el('div', { class: 'rl' }, ui.el('h1', { class: 'titulo-grande', text: 'Relatórios' }), ui.el('div', { class: 'rl-erro rl-vidro' }, ui.el('b', { text: 'Só para a gestão' }), ui.el('span', { text: 'Os relatórios ficam com a gerência, a direção e a administração. Seus números estão no Painel.' }))));
        return;
      }
      await carregar();
    },
  };
})();
