/* Tela "agenda" da Sintonia: registra window.SintoniaTelas.agenda = { desenhar(caixa, ui) }.
 * Agenda do dia/semana por unidade e profissional, no jeito do calendário do iPhone: faixa de dias rolável no topo
 * e a lista do dia. Toque no horário abre a conversa da cliente; "Novo" escolhe a cliente e abre o Agendar de sempre.
 * Fonte: /api/agenda/agendamentos (horários marcados pela Sintonia). Estilos em <style id="estilo-agenda">, prefixo .ag-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ANTES = 7;   // dias antes de hoje na faixa
  const DEPOIS = 34; // dias depois
  const INTERVALO = 20000; // agenda "em tempo real": confere a cada 20 s com a tela aberta
  const CURTO = { norte: 'Norte', sumare: 'Sumaré', feira: 'Feira' };
  const COR_UNIDADE = { norte: 'var(--cor-norte)', sumare: 'var(--marca-menta)', feira: '#9db8ff' };

  const CSS = `
  .ag-caixa.ag-caixa { grid-template-columns: minmax(0, 1fr); overflow-x: hidden; padding: 0; gap: 0; }
  html[data-tema="escuro"] .ag { --cor-norte: #7cc4ff; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .ag { --cor-norte: #7cc4ff; } }
  .ag { --cor-norte: var(--marca-azul); --acento: var(--marca-menta); --acento-suave: color-mix(in srgb, var(--marca-menta) 14%, transparent); display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); min-height: 100%; min-width: 0; }
  .ag-vidro, .ag-item, .ag-vazio, .ag-seg, .ag-sel, .ag-btn { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%); }
  .ag-topo { position: sticky; top: 0; z-index: 2; padding: 14px 16px 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; background: var(--vidro-forte); border-bottom: 1px solid var(--vidro-borda); -webkit-backdrop-filter: blur(22px) saturate(150%); backdrop-filter: blur(22px) saturate(150%); }
  .ag-cab { display: flex; align-items: center; gap: 8px 24px; flex-wrap: wrap; }
  .ag-cab h1.titulo-grande { margin: 0 !important; font-size: 38px; letter-spacing: -.03em; }
  .ag-cab h1 small { display: block; font-size: 14px; font-weight: 700; color: var(--acento); letter-spacing: 0; margin-bottom: 2px; }
  .ag-numeros { display: flex; gap: 20px; overflow-x: auto; scrollbar-width: none; flex: 1 1 auto; min-width: 0; padding: 2px; order: 3; }
  .ag-numeros::-webkit-scrollbar { display: none; }
  @media (max-width: 760px) { .ag-numeros { flex-basis: 100%; margin: 0 -16px; padding: 2px 16px; } }
  @media (min-width: 761px) { .ag-numeros { order: 0; } }
  .ag-n { display: flex; align-items: center; gap: 9px; flex: none; }
  .ag-circ { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box; }
  .ag-circ svg { width: 18px; height: 18px; }
  .ag-n b { display: block; font-size: 20px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .ag-n small { display: block; font-size: 12px; color: var(--sub); white-space: nowrap; }
  .ag-acoes { display: flex; gap: 8px; margin-left: auto; }
  .ag-btn { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 44px; box-sizing: border-box; padding: 0 16px; border-radius: 999px; font-size: 14px; font-weight: 700; color: var(--texto); white-space: nowrap; background: var(--vidro-item); border: 1px solid var(--vidro-borda); transition: transform .18s; }
  .ag-btn:hover { transform: translateY(-1px); }
  .ag-btn svg { width: 17px; height: 17px; }
  .ag-btn.ag-forte { background: var(--acento); color: #071d33; border-color: transparent; font-weight: 800; box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 35%, transparent), 0 6px 22px color-mix(in srgb, var(--marca-menta) 35%, transparent); }
  .ag-btn:focus-visible, .ag-dia:focus-visible, .ag-item:focus-visible, .ag-seg button:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
  .ag-faixa { display: grid; grid-auto-flow: column; grid-auto-columns: calc((100% - 6 * 4px) / 7); gap: 4px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; padding: 2px 0 4px; }
  .ag-faixa::-webkit-scrollbar { display: none; }
  @media (min-width: 1000px) { .ag-faixa { grid-auto-columns: calc((100% - 13 * 4px) / 14); } .ag-topo, .ag-corpo { padding-left: 22px; padding-right: 22px; } }
  .ag-dia { all: unset; cursor: pointer; scroll-snap-align: start; display: grid; justify-items: center; gap: 3px; padding: 6px 0 7px; border-radius: 16px; }
  .ag-dia small { font-size: 11.5px; font-weight: 700; color: var(--sub); text-transform: uppercase; letter-spacing: .04em; }
  .ag-dia b { font-size: 19px; font-weight: 700; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font-variant-numeric: tabular-nums; transition: background .18s; }
  .ag-dia i { width: 5px; height: 5px; border-radius: 50%; background: transparent; }
  .ag-dia.ag-tem i { background: var(--sub); }
  .ag-dia.ag-hoje b { color: var(--acento); }
  .ag-dia[aria-pressed="true"] b { background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); }
  .ag-dia.ag-hoje[aria-pressed="true"] b { background: var(--acento); color: #071d33; box-shadow: 0 4px 16px color-mix(in srgb, var(--marca-menta) 40%, transparent); }
  .ag-dia.ag-passado b { opacity: .55; }
  .ag-filtros { display: flex; gap: 8px; align-items: center; overflow-x: auto; scrollbar-width: none; }
  .ag-filtros::-webkit-scrollbar { display: none; }
  .ag-seg { display: inline-grid; grid-auto-flow: column; border-radius: 999px; padding: 4px; flex: none; gap: 2px; box-shadow: none; }
  .ag-seg button { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--sub); white-space: nowrap; border: 1px solid transparent; }
  .ag-seg button[aria-pressed="true"] { background: var(--vidro-ativo); color: var(--texto); font-weight: 700; border-color: var(--vidro-borda); box-shadow: 0 2px 10px rgba(0, 0, 0, .08); }
  .ag-sel { font: inherit; font-size: 13.5px; font-weight: 600; color: var(--texto); border-radius: 999px; padding: 0 12px; min-height: 42px; flex: none; max-width: 200px; box-shadow: none; }
  .ag-sel option { color: #106ebe; }
  html[data-tema="escuro"] .ag select, html[data-tema="escuro"] .ag-dlg input { color-scheme: dark; }
  .ag-corpo { padding: 14px 16px 28px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-content: start; min-width: 0; }
  @media (max-width: 760px) { .ag-corpo { padding-bottom: 120px; } }
  .ag-titulo-dia { font-size: 15px; font-weight: 700; display: flex; justify-content: space-between; gap: 8px; color: var(--texto); padding: 2px 2px 0; }
  .ag-titulo-dia span { color: var(--sub); font-weight: 500; font-size: 13.5px; }
  .ag-lista { display: grid; gap: 10px; }
  .ag-item { all: unset; cursor: pointer; display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 12px; align-items: stretch; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); border-radius: 20px; padding: 13px 14px 13px 12px; position: relative; box-sizing: border-box; width: 100%; transition: transform .18s; }
  .ag-item:hover { transform: translateY(-1px); }
  .ag-item.ag-bloq { cursor: default; }
  .ag-item.ag-bloq:hover { transform: none; }
  .ag-hora { display: grid; align-content: start; gap: 1px; text-align: right; font-variant-numeric: tabular-nums; }
  .ag-hora b { font-size: 15.5px; font-weight: 800; }
  .ag-hora span { font-size: 12.5px; color: var(--sub); }
  .ag-info { border-left: 3px solid var(--cor, var(--marca-azul)); padding-left: 12px; display: grid; gap: 4px; min-width: 0; }
  .ag-info b { font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-info span { font-size: 13.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-info em { font-style: normal; font-size: 12px; font-weight: 700; color: var(--sub); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .ag-tag { padding: 3px 9px; border-radius: 999px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  .ag-tag.ag-quem { font-weight: 600; }
  .ag-tag.ag-ia { background: var(--acento-suave); color: var(--acento); border-color: transparent; }
  .ag-item.ag-foi { opacity: .6; }
  .ag-agora { display: flex; align-items: center; gap: 8px; color: var(--acento); font-size: 12px; font-weight: 800; padding: 0 2px; }
  .ag-agora::after { content: ''; flex: 1; height: 2px; background: var(--acento); border-radius: 2px; box-shadow: 0 0 6px var(--acento); }
  .ag-agora i { width: 9px; height: 9px; border-radius: 50%; background: var(--acento); margin-left: 52px; box-shadow: 0 0 8px var(--acento); }
  .ag-vazio { border-radius: 24px; padding: 26px 20px; display: grid; gap: 8px; justify-items: center; text-align: center; color: var(--sub); font-size: 14.5px; line-height: 1.45; }
  .ag-vazio b { color: var(--texto); font-size: 17px; }
  .ag-vazio svg { width: 38px; height: 38px; color: var(--acento); }
  .ag-nota { font-size: 12.5px; color: var(--sub); line-height: 1.45; padding: 4px 2px; }
  .ag-semana { display: grid; gap: 14px; }
  @media (min-width: 1000px) {
    .ag-semana { grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; align-items: start; }
    .ag-semana .ag-item { grid-template-columns: minmax(0, 1fr); padding: 10px; gap: 6px; border-radius: 16px; }
    .ag-semana .ag-hora { text-align: left; grid-auto-flow: column; justify-content: start; gap: 6px; align-items: baseline; }
    .ag-semana .ag-info { padding-left: 8px; }
    .ag-semana .ag-info b { font-size: 14px; }
    .ag-semana .ag-titulo-dia { flex-direction: column; gap: 0; }
    .ag-semana .ag-col { background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 20px; padding: 8px; min-height: 160px; align-content: start; }
  }
  .ag-col { display: grid; gap: 8px; }
  .ag-col.ag-col-hoje .ag-titulo-dia { color: var(--acento); }
  .ag-col .ag-livre { font-size: 13px; color: var(--sub); padding: 2px; }
  .ag-esq { border-radius: 20px; height: 76px; background: var(--vidro-fundo); animation: ag-pulso 1.4s ease-in-out infinite; }
  @keyframes ag-pulso { 50% { opacity: .5; } }
  dialog.ag-dlg { border: 1px solid var(--vidro-borda); padding: 0; border-radius: 26px; width: min(460px, calc(100vw - 24px)); max-height: min(640px, calc(100vh - 40px)); background: var(--vidro-forte); -webkit-backdrop-filter: blur(24px) saturate(150%); backdrop-filter: blur(24px) saturate(150%); color: var(--texto); box-shadow: 0 24px 70px rgba(0, 20, 40, .4); }
  dialog.ag-dlg::backdrop { background: rgba(0, 20, 40, .45); backdrop-filter: blur(3px); }
  .ag-dlg-corpo { display: grid; grid-template-rows: auto auto minmax(0, 1fr); gap: 12px; padding: 18px; max-height: min(640px, calc(100vh - 40px)); box-sizing: border-box; }
  .ag-dlg h2 { margin: 0; font-size: 19px; display: flex; justify-content: space-between; align-items: center; }
  .ag-dlg input[type=search] { font: inherit; font-size: 16px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--vidro-borda); background: var(--vidro-item); color: var(--texto); width: 100%; box-sizing: border-box; }
  .ag-res { overflow: auto; display: grid; gap: 2px; align-content: start; min-height: 120px; }
  .ag-res button { all: unset; cursor: pointer; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 10px; align-items: center; padding: 9px 8px; border-radius: 14px; min-height: 44px; }
  .ag-res button:hover, .ag-res button:focus-visible { background: var(--vidro-item); }
  .ag-res .avatar { grid-row: 1 / span 2; }
  .ag-res b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-res span { font-size: 12.5px; color: var(--sub); }
  .ag-x { all: unset; cursor: pointer; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--vidro-item); border: 1px solid var(--vidro-borda); font-size: 20px; }
  @media (prefers-reduced-motion: reduce) { .ag *, .ag-esq { transition: none !important; animation: none !important; } }
  `;

  const IC = {
    semana: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    raio: '<svg viewBox="0 0 24 24" fill="#f5b800"><path d="M13.5 2 4 14h7l-1.5 8L20 10h-7l.5-8Z"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  };

  // ---------- datas (horário da Bahia) ----------
  const isoBahia = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(d);
  const hmBahia = (d) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).format(d);
  const somar = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const meio = (iso) => new Date(iso + 'T12:00:00Z');
  const fmt = (iso, o) => new Intl.DateTimeFormat('pt-BR', { ...o, timeZone: 'UTC' }).format(meio(iso));
  const semana = (iso) => fmt(iso, { weekday: 'short' }).replace('.', '').slice(0, 3);
  const duracao = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ' ' + (min % 60) : ''}` : `${min} min`);

  const s = { caixa: null, ui: null, hoje: isoBahia(new Date()), dia: null, modo: 'dia', unidade: '', prof: '', dados: null, erro: null, inicio: null, timer: null, geracao: 0 };

  function estilo() {
    if (document.getElementById('estilo-agenda')) return;
    const st = document.createElement('style');
    st.id = 'estilo-agenda';
    st.textContent = CSS;
    document.head.append(st);
  }

  const filtrados = () => (s.dados?.itens || []).filter((i) => (!s.unidade || i.unidade === s.unidade) && (!s.prof || (s.prof === '-' ? !i.profissional : i.profissional === s.prof)));
  const doDia = (lista, iso) => lista.filter((i) => isoBahia(new Date(i.inicio)) === iso);

  function item(ui, i, agora) {
    const el = ui.el;
    const ini = new Date(i.inicio), fim = new Date(i.fim);
    const foi = fim < agora;
    const b = el('button', {
      class: 'ag-item' + (foi ? ' ag-foi' : '') + (i.podeAbrir ? '' : ' ag-bloq'), type: 'button', style: `--cor:${COR_UNIDADE[i.unidade] || 'var(--marca-azul)'}`,
      'aria-label': `${hmBahia(ini)}, ${i.cliente || 'cliente'}, ${i.servico || 'atendimento'}${i.profissional ? ' com ' + i.profissional : ''}${i.podeAbrir ? '. Abrir conversa' : ''}`,
      onclick: () => (i.podeAbrir ? ui.abrir(i.conversaId) : ui.toast('Esta conversa é de outra atendente.')),
    },
      el('div', { class: 'ag-hora' }, el('b', { text: hmBahia(ini) }), el('span', { text: hmBahia(fim) })),
      el('div', { class: 'ag-info' },
        el('b', { text: i.cliente || ui.formatarTel?.(i.telefone) || i.telefone }),
        el('span', { text: [i.servico, i.profissional ? `com ${i.profissional}` : null, duracao(i.duracaoMin)].filter(Boolean).join(' · ') }),
        el('em', {}, el('span', { class: 'ag-tag', text: ui.UNIDADE[i.unidade] || i.unidade }), el('span', { class: 'ag-tag ag-quem' + (i.porIa ? ' ag-ia' : ''), title: i.porIa ? 'Quem agendou: a IA, sozinha, pelo WhatsApp' : `Quem agendou: ${i.por || 'equipe'}`, text: i.porIa ? '✦ Agendado pela IA' : `Agendado por ${String(i.por || 'equipe').split(' ')[0]}` }),
          // Confirmação automática (src/followup): Aguardando / Confirmado / Remarcar / Sem resposta.
          !foi && s.conf?.[i.id] && window.SintoniaTelas?.followup?.seloConfirmacao ? window.SintoniaTelas.followup.seloConfirmacao(ui, s.conf[i.id]) : null)));
    return b;
  }

  function vazio(ui, titulo, texto) {
    return ui.el('div', { class: 'ag-vazio' }, ui.el('span', { html: IC.cal }), ui.el('b', { text: titulo }), ui.el('span', { text: texto }));
  }

  function corpoDia(ui) {
    const el = ui.el;
    const agora = new Date();
    const lista = doDia(filtrados(), s.dia);
    const titulo = el('div', { class: 'ag-titulo-dia' }, el('span', { style: 'color:var(--texto);font-weight:700;font-size:15px', text: s.dia === s.hoje ? 'Hoje' : fmt(s.dia, { weekday: 'long', day: 'numeric', month: 'long' }) }), el('span', { text: lista.length ? `${lista.length} ${lista.length === 1 ? 'horário' : 'horários'}` : '' }));
    if (!lista.length) return [titulo, vazio(ui, 'Nenhum horário', s.dia < s.hoje ? 'Nada marcado pela Sintonia neste dia.' : 'Dia livre por enquanto. Toque em "Novo" para agendar uma cliente.')];
    const caixa = el('div', { class: 'ag-lista' });
    let marcou = s.dia !== s.hoje;
    for (const i of lista) {
      if (!marcou && new Date(i.inicio) > agora) { caixa.append(el('div', { class: 'ag-agora', 'aria-label': `Agora, ${hmBahia(agora)}` }, el('i'), hmBahia(agora))); marcou = true; }
      caixa.append(item(ui, i, agora));
    }
    return [titulo, caixa];
  }

  function corpoSemana(ui) {
    const el = ui.el;
    const agora = new Date();
    const todos = filtrados();
    const cols = [];
    for (let k = 0; k < 7; k++) {
      const iso = somar(s.dia, k);
      const lista = doDia(todos, iso);
      cols.push(el('div', { class: 'ag-col' + (iso === s.hoje ? ' ag-col-hoje' : '') },
        el('div', { class: 'ag-titulo-dia' }, el('span', { style: 'color:inherit;font-weight:700;font-size:14.5px', text: iso === s.hoje ? 'Hoje' : fmt(iso, { weekday: 'long', day: 'numeric' }) }), el('span', { text: lista.length ? `${lista.length}` : '' })),
        ...(lista.length ? lista.map((i) => item(ui, i, agora)) : [el('div', { class: 'ag-livre', text: 'Livre' })])));
    }
    return [el('div', { class: 'ag-semana' }, ...cols)];
  }

  function faixa(ui) {
    const el = ui.el;
    const contagem = new Map();
    for (const i of filtrados()) { const d = isoBahia(new Date(i.inicio)); contagem.set(d, (contagem.get(d) || 0) + 1); }
    const f = el('div', { class: 'ag-faixa', role: 'group', 'aria-label': 'Dias' });
    for (let k = 0; k < ANTES + DEPOIS; k++) {
      const iso = somar(s.inicio, k);
      const n = contagem.get(iso) || 0;
      const naSemana = s.modo === 'semana' && iso >= s.dia && iso < somar(s.dia, 7);
      f.append(el('button', {
        class: 'ag-dia' + (n ? ' ag-tem' : '') + (iso === s.hoje ? ' ag-hoje' : '') + (iso < s.hoje ? ' ag-passado' : ''), type: 'button',
        'aria-pressed': String(iso === s.dia || naSemana), 'data-dia': iso,
        'aria-label': `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}${n ? `, ${n} ${n === 1 ? 'horário' : 'horários'}` : ''}`,
        onclick: () => { s.dia = iso; desenhar(); },
      }, el('small', { text: semana(iso) }), el('b', { text: String(Number(iso.slice(8))) }), el('i')));
    }
    return f;
  }

  function filtros(ui) {
    const el = ui.el;
    const unidades = s.dados?.unidades || [];
    const seg = (opcoes, valor, fn, rot) => el('div', { class: 'ag-seg', role: 'group', 'aria-label': rot }, ...opcoes.map(([v, t]) => el('button', { type: 'button', 'aria-pressed': String(v === valor), text: t, onclick: () => fn(v) })));
    const linha = el('div', { class: 'ag-filtros' }, seg([['dia', 'Dia'], ['semana', 'Semana']], s.modo, (v) => { s.modo = v; desenhar(); }, 'Ver'));
    if (unidades.length > 1) linha.append(seg([['', 'Todas'], ...unidades.map((u) => [u.id, CURTO[u.id] || u.nome])], s.unidade, (v) => { s.unidade = v; desenhar(); }, 'Unidade'));
    const profs = s.dados?.profissionais || [];
    if (profs.length) {
      const sel = el('select', { class: 'ag-sel', 'aria-label': 'Profissional', onchange: (e) => { s.prof = e.target.value; desenhar(); } },
        el('option', { value: '', text: 'Todas as profissionais' }), ...profs.map((p) => el('option', { value: p, text: p })), el('option', { value: '-', text: 'Sem profissional' }));
      sel.value = s.prof;
      linha.append(sel);
    }
    return linha;
  }

  /** Números do topo: horários do dia escolhido, dos próximos 7 dias e quanto a IA marcou. */
  function numeros(ui) {
    const el = ui.el;
    if (!s.dados) return null;
    const todos = filtrados();
    const dia = doDia(todos, s.dia).length;
    const fimSemana = somar(s.dia, 7);
    const semanaL = todos.filter((i) => { const d = isoBahia(new Date(i.inicio)); return d >= s.dia && d < fimSemana; });
    const ia = semanaL.filter((i) => i.porIa).length;
    const n = (ic, v, rot) => el('div', { class: 'ag-n', role: 'listitem' }, el('span', { class: 'ag-circ ag-vidro', html: ic, 'aria-hidden': 'true' }), el('div', {}, el('b', { text: v }), el('small', { text: rot })));
    return el('div', { class: 'ag-numeros', role: 'list', 'aria-label': 'Resumo' },
      n(IC.cal, String(dia), s.dia === s.hoje ? 'horários hoje' : 'horários no dia'),
      n(IC.semana, String(semanaL.length), 'nos 7 dias'),
      n(IC.raio, semanaL.length ? `${Math.round((ia / semanaL.length) * 100)}%` : '—', 'marcados pela IA'));
  }

  function desenhar() {
    const { ui, caixa } = s;
    if (!caixa) return;
    const el = ui.el;
    const rolagem = caixa.querySelector('.ag-faixa')?.scrollLeft;
    const mes = fmt(s.dia, { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
    const topo = el('div', { class: 'ag-topo' },
      el('div', { class: 'ag-cab' },
        el('h1', { class: 'titulo-grande' }, el('small', { text: `${mes} · em tempo real` }), 'Agenda'),
        numeros(ui),
        el('div', { class: 'ag-acoes' },
          el('button', { class: 'ag-btn', type: 'button', text: 'Hoje', onclick: () => { s.dia = s.hoje; desenhar(); centralizar(true); } }),
          el('button', { class: 'ag-btn ag-forte', type: 'button', html: IC.mais + '<span>Novo</span>', 'aria-label': 'Novo agendamento', onclick: novo }))),
      faixa(ui), filtros(ui));
    const corpo = el('div', { class: 'ag-corpo' });
    if (s.erro && !s.dados) corpo.append(vazio(ui, 'Não deu para carregar a agenda', s.erro));
    else if (!s.dados) corpo.append(el('div', { class: 'ag-esq' }), el('div', { class: 'ag-esq' }), el('div', { class: 'ag-esq' }));
    else {
      corpo.append(...(s.modo === 'semana' ? corpoSemana(ui) : corpoDia(ui)));
      corpo.append(el('div', { class: 'ag-nota', text: 'Mostra os horários marcados pela Sintonia (IA e botão Agendar). O que foi marcado direto no Trinks não aparece aqui.' }));
    }
    caixa.replaceChildren(el('div', { class: 'ag' }, topo, corpo));
    const f = caixa.querySelector('.ag-faixa');
    if (f && rolagem != null) f.scrollLeft = rolagem;
  }

  /** Põe a semana do dia escolhido à vista na faixa. */
  function centralizar(suave) {
    const f = s.caixa?.querySelector('.ag-faixa');
    const b = f?.querySelector(`[data-dia="${s.dia}"]`);
    if (!f || !b) return;
    const largura = b.offsetWidth + 4;
    const indice = [...f.children].indexOf(b);
    f.scrollTo({ left: Math.max(0, (indice - 1) * largura), behavior: suave ? 'smooth' : 'auto' });
  }

  async function carregar() {
    const { ui } = s;
    const g = ++s.geracao;
    try {
      const r = await ui.api(`/api/agenda/agendamentos?de=${s.inicio}&dias=${Math.min(42, ANTES + DEPOIS)}`);
      if (g !== s.geracao) return;
      s.dados = r;
      s.erro = null;
      // Status da confirmação de cada horário (não segura a Agenda se falhar).
      const fim = new Date(Date.parse(s.inicio) + (ANTES + DEPOIS + 2) * 86400000).toISOString();
      s.conf = await ui.api(`/api/followup/confirmacoes?de=${encodeURIComponent(new Date(Date.parse(s.inicio) - 86400000).toISOString())}&ate=${encodeURIComponent(fim)}`).then((x) => x.status).catch(() => s.conf || {});
      if (g !== s.geracao) return;
      if (s.unidade && !r.unidades.some((u) => u.id === s.unidade)) s.unidade = '';
    } catch (x) {
      if (g !== s.geracao) return;
      s.erro = x.message || 'Verifique a internet e tente de novo.';
    }
    if (s.caixa?.isConnected) desenhar();
  }

  // ---------- novo agendamento: escolhe a cliente e abre o "Agendar" de sempre ----------
  function novo() {
    const { ui } = s;
    const el = ui.el;
    const conversas = (ui.estado.conversas || []).slice();
    const busca = el('input', { type: 'search', placeholder: 'Nome ou telefone da cliente', 'aria-label': 'Buscar cliente', autocomplete: 'off' });
    const res = el('div', { class: 'ag-res', role: 'listbox' });
    const dlg = el('dialog', { class: 'ag-dlg', 'aria-label': 'Novo agendamento' });
    const listar = () => {
      const q = busca.value.trim().toLowerCase();
      const dig = q.replace(/\D/g, '');
      const achados = conversas.filter((c) => !q || (c.nome || '').toLowerCase().includes(q) || (dig.length >= 3 && c.telefone.includes(dig))).slice(0, 40);
      res.replaceChildren(...(achados.length ? achados.map((c) => el('button', { type: 'button', role: 'option', onclick: () => { dlg.close(); ui.agendar ? ui.agendar(c.id) : ui.abrir(c.id); } },
        ui.avatar(c, 'p'), el('b', { text: ui.nomeDe(c) }), el('span', { text: `${ui.UNIDADE[c.unidade] || c.unidade} · ${ui.NOME_ETAPA[c.etapa] || c.etapa}` }))) : [el('div', { class: 'ag-nota', text: 'Nenhuma cliente encontrada. A cliente precisa ter uma conversa no CRM (chegou pelo WhatsApp ou foi importada em Leads).' })]));
    };
    busca.addEventListener('input', listar);
    dlg.append(el('div', { class: 'ag-dlg-corpo' },
      el('h2', {}, 'Novo agendamento', el('button', { class: 'ag-x', type: 'button', 'aria-label': 'Fechar', text: '×', onclick: () => dlg.close() })),
      busca, res));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    listar();
    dlg.showModal();
    busca.focus();
  }

  const visivel = () => s.caixa && s.caixa.isConnected && s.caixa.offsetParent !== null;

  window.SintoniaTelas.agenda = {
    async desenhar(caixa, ui) {
      estilo();
      const hoje = isoBahia(new Date());
      if (hoje !== s.hoje || !s.dia) { s.hoje = hoje; s.dia = hoje; }
      s.inicio = somar(s.hoje, -ANTES);
      s.caixa = caixa;
      s.ui = ui;
      caixa.classList.add('ag-caixa');
      desenhar();
      centralizar(false);
      clearInterval(s.timer);
      s.timer = setInterval(() => { if (!visivel()) { clearInterval(s.timer); s.timer = null; return; } if (!document.hidden) carregar(); }, INTERVALO);
      await carregar();
      centralizar(false);
    },
  };
})();
