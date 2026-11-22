/* Rotina do vendedor (Agenda › Rotina): tarefas com prazo e o checklist do dia que se repete.
 * Registra window.SintoniaTelas.rotina = { desenhar(caixa, ui), novaTarefa({ conversaId }), resumo() }.
 * Servidor: src/rotina/rotina.ts (rotas /api/rotina/...). Texto do servidor entra sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .rt { width: 100%; min-width: 0; display: grid; gap: 16px; } /* layout-telas: largura toda do painel */
  .rt-topo { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .rt-topo h1 { margin: 0; font-size: 28px; letter-spacing: -.01em; }
  .rt-topo p { margin: 4px 0 0; color: var(--sub); font-size: 14.5px; }
  .rt-grade { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 900px) { .rt-grade { grid-template-columns: 1fr; } .rt-grade > .rt-lado { order: -1; } }
  .rt-cartao { border-radius: 24px; padding: 18px; display: grid; gap: 12px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); position: relative; min-width: 0; }
  .rt-cartao h2 { margin: 0; font-size: 17px; }
  .rt-cab { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .rt-lado { display: grid; gap: 16px; min-width: 0; }
  .rt-abas { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px; margin: -2px; }
  .rt-abas::-webkit-scrollbar { display: none; }
  .rt-aba { all: unset; cursor: pointer; flex: none; box-sizing: border-box; padding: 8px 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--sub); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); display: inline-flex; align-items: center; gap: 7px; }
  .rt-aba b { font-size: 12px; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; display: inline-grid; place-items: center; background: var(--vidro-borda); color: var(--texto); }
  .rt-aba.atraso b { background: #e5484d; color: #fff; }
  .rt-aba[aria-selected="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 8px 18px rgba(16,110,190,.25); }
  .rt-aba[aria-selected="true"] b { background: rgba(255,255,255,.25); color: #fff; }
  .rt-aba:focus-visible, .rt-bt:focus-visible, .rt-marca:focus-visible, .rt-linha:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .rt-bt { all: unset; cursor: pointer; box-sizing: border-box; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; background: var(--vidro-ativo, rgba(255,255,255,.7)); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; }
  .rt-bt.forte { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 8px 18px rgba(16,110,190,.28); }
  .rt-bt.perigo { color: var(--erro, #c43a3a); }
  .rt-bt.mini { padding: 5px 11px; font-size: 12.5px; }
  .rt-sel { font: inherit; font-size: 13.5px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 999px; padding: 7px 12px; max-width: 220px; }
  .rt-lista { display: grid; gap: 8px; }
  .rt-linha { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); cursor: pointer; min-width: 0; }
  .rt-linha.feita .rt-tit { text-decoration: line-through; color: var(--sub); }
  .rt-corpo { flex: 1; min-width: 0; display: grid; gap: 4px; }
  .rt-tit { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
  .rt-desc { font-size: 13px; color: var(--sub); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .rt-meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 12.5px; color: var(--sub); }
  .rt-meta .atraso { color: #d93036; font-weight: 600; }
  html[data-tema="escuro"] .rt-meta .atraso { color: #ff7b80; }
  .rt-pri { font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .rt-pri.alta { background: rgba(229,72,77,.14); color: #d93036; }
  .rt-pri.baixa { background: var(--vidro-borda); color: var(--sub); }
  html[data-tema="escuro"] .rt-pri.alta { color: #ff7b80; }
  .rt-cli { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--marca-azul, #106ebe); max-width: 100%; }
  .rt-cli span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rt-cli svg, .rt-marca svg { width: 15px; height: 15px; flex: none; }
  html[data-tema="escuro"] .rt-cli { color: var(--marca-menta, #0ffcbe); }
  .rt-marca { all: unset; cursor: pointer; flex: none; width: 24px; height: 24px; margin-top: 1px; border-radius: 50%; box-sizing: border-box; display: grid; place-items: center; box-shadow: inset 0 0 0 1.8px var(--sub); color: transparent; }
  .rt-marca[aria-checked="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); box-shadow: none; color: #fff; }
  .rt-vazio { color: var(--sub); font-size: 14px; margin: 0; padding: 6px 2px; }
  .rt-prog { display: flex; align-items: center; gap: 16px; }
  .rt-anel { --p: 0; flex: none; width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; position: relative; }
  .rt-anel::before { content: ""; position: absolute; inset: 0; border-radius: 50%;
    background: conic-gradient(from 0deg, #106ebe 0%, #3aa0ff calc(var(--p) * 1%), var(--vidro-borda) 0);
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7px)); mask: radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7px)); }
  .rt-anel b { position: relative; font-size: 17px; }
  .rt-prog-txt { display: grid; gap: 2px; }
  .rt-prog-txt b { font-size: 16px; }
  .rt-prog-txt span { font-size: 13px; color: var(--sub); }
  .rt-barra { height: 8px; border-radius: 999px; background: var(--vidro-borda); overflow: hidden; }
  .rt-barra i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #106ebe, #3aa0ff); transition: width .35s ease; }
  .rt-check { display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--vidro-borda); cursor: pointer; }
  .rt-check:last-child { border-bottom: 0; }
  .rt-check .rt-tit { font-size: 14.5px; font-weight: 500; }
  .rt-check.feita .rt-tit { text-decoration: line-through; color: var(--sub); }
  .rt-pessoa { display: grid; gap: 6px; padding: 8px 2px; }
  .rt-pessoa-cab { display: flex; justify-content: space-between; font-size: 13.5px; }
  .rt-pessoa-cab span { color: var(--sub); }
  dialog.rt-d { border: 0; border-radius: 26px; padding: 22px; width: min(500px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); overflow: auto; box-sizing: border-box; background: var(--vidro-forte, var(--painel)); color: var(--texto); box-shadow: var(--vidro-brilho); }
  dialog.rt-d::backdrop { background: rgba(4,12,20,.55); }
  .rt-form { display: grid; gap: 12px; }
  .rt-form h2 { margin: 0; font-size: 19px; }
  .rt-form label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; color: var(--sub); min-width: 0; }
  .rt-form input, .rt-form select, .rt-form textarea { font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 10px 12px; min-width: 0; box-sizing: border-box; width: 100%; }
  .rt-dois { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rt-seg { display: flex; gap: 6px; flex-wrap: wrap; }
  .rt-seg button { all: unset; cursor: pointer; padding: 8px 13px; border-radius: 12px; font-size: 13px; font-weight: 600; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .rt-seg.dias button { width: 42px; padding: 8px 0; text-align: center; }
  .rt-seg button[aria-pressed="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: none; }
  .rt-chip { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 12px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); font-size: 14px; color: var(--texto); }
  .rt-chip span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rt-acoes { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .rt-erro { color: var(--erro, #c43a3a); font-size: 13px; margin: 0; }
  .rt-item { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-bottom: 1px solid var(--vidro-borda); }
  .rt-item:last-child { border-bottom: 0; }
  .rt-item > div { flex: 1; min-width: 0; display: grid; gap: 2px; }
  `;
  const IC = {
    certo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4 4 9-9"/></svg>',
    conversa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/></svg>',
  };
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const VISOES = [['hoje', 'Hoje'], ['atrasadas', 'Atrasadas'], ['proximas', 'Próximas'], ['feitas', 'Feitas']];
  const PRI = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta' };
  const FUSO = 'America/Bahia';
  let ui, caixa, visao = 'hoje', pessoa = '';
  try { visao = localStorage.getItem('sintonia.rotina.visao') || 'hoje'; } catch {}

  const css = () => { if (!document.getElementById('rt-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'rt-css', textContent: CSS })); };
  const U = () => ui || window.Sintonia?.ui;
  const diaBahia = (d) => new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  const hora = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO });
  function quando(iso) {
    if (!iso) return 'Sem prazo';
    const d = new Date(iso), hoje = diaBahia(new Date()), dia = diaBahia(d);
    const amanha = diaBahia(new Date(Date.now() + 86400_000)), ontem = diaBahia(new Date(Date.now() - 86400_000));
    if (dia === hoje) return `Hoje, ${hora(d)}`;
    if (dia === amanha) return `Amanhã, ${hora(d)}`;
    if (dia === ontem) return `Ontem, ${hora(d)}`;
    return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: FUSO }).replace('.', '')}, ${hora(d)}`;
  }
  const resumoFreq = (i) => {
    if (i.frequencia === 'diaria') return 'Todo dia';
    if (i.frequencia === 'semanal') return 'Uma vez por semana';
    const s = [...i.dias].sort().join();
    return s === '1,2,3,4,5' ? 'Seg a sex' : s === '1,2,3,4,5,6' ? 'Seg a sáb' : [...i.dias].sort().map((d) => DIAS[d].toLowerCase()).join(', ');
  };

  // ---------- selo do menu (tarefas atrasadas) ----------
  let ultimoResumo = null;
  async function resumo() {
    const u = U(); if (!u) return null;
    try { ultimoResumo = await u.api('/api/rotina/resumo'); } catch { return ultimoResumo; }
    const n = ultimoResumo.atrasadas || 0;
    const selo = document.getElementById('lt-rotina-qtd');
    if (selo) { selo.hidden = !n; selo.textContent = n ? String(n) : ''; selo.title = n ? `${n} tarefa${n > 1 ? 's' : ''} atrasada${n > 1 ? 's' : ''}` : ''; }
    return ultimoResumo;
  }
  const valorMenu = () => (ultimoResumo?.atrasadas ? `${ultimoResumo.atrasadas} atrasada${ultimoResumo.atrasadas > 1 ? 's' : ''}` : '');

  // ---------- tela ----------
  async function desenhar(c, u) {
    ui = u; caixa = c; css();
    const el = ui.el;
    if (!caixa.firstChild) caixa.append(el('p', { class: 'rt-vazio', text: 'Carregando…' }));
    let t, dia;
    try {
      [t, dia] = await Promise.all([
        ui.api(`/api/rotina/tarefas?visao=${visao}${pessoa ? `&pessoa=${encodeURIComponent(pessoa)}` : ''}`),
        ui.api('/api/rotina/dia'),
      ]);
    } catch (e) { caixa.replaceChildren(el('p', { class: 'rt-vazio', text: e.message })); return; }
    resumo();

    // abas Hoje / Atrasadas / Próximas / Feitas
    const abas = el('div', { class: 'rt-abas', role: 'tablist', 'aria-label': 'Tarefas' }, ...VISOES.map(([id, nome]) => {
      const n = t.contagem[id];
      return el('button', { class: 'rt-aba' + (id === 'atrasadas' && n ? ' atraso' : ''), type: 'button', role: 'tab', 'aria-selected': String(id === visao),
        onclick: () => { visao = id; try { localStorage.setItem('sintonia.rotina.visao', id); } catch {} desenhar(caixa, ui); } },
      document.createTextNode(nome), id === 'feitas' ? null : el('b', { text: String(n) }));
    }));
    const filtroPessoa = t.gestor ? (() => {
      const s = el('select', { class: 'rt-sel', 'aria-label': 'Ver tarefas de' },
        el('option', { value: '', text: 'Equipe toda' }), ...t.equipe.map((p) => el('option', { value: p.id, text: p.id === t.eu ? `${p.nome} (eu)` : p.nome })));
      s.value = pessoa;
      s.addEventListener('change', () => { pessoa = s.value; desenhar(caixa, ui); });
      return s;
    })() : null;
    const mostraDono = t.gestor && !pessoa;
    const vazio = {
      hoje: 'Nada para hoje. Crie uma tarefa para não esquecer um retorno.',
      atrasadas: 'Nenhuma tarefa atrasada. Muito bem!',
      proximas: 'Nenhuma tarefa marcada para os próximos dias.',
      feitas: 'As tarefas concluídas aparecem aqui.',
    }[visao];
    const lista = t.tarefas.length ? t.tarefas.map((x) => linhaTarefa(x, mostraDono, t)) : [el('p', { class: 'rt-vazio', text: vazio })];

    const cartaoTarefas = el('section', { class: 'rt-cartao' },
      el('div', { class: 'rt-cab' }, el('h2', { text: 'Tarefas' }), filtroPessoa),
      abas, el('div', { class: 'rt-lista' }, ...lista));

    caixa.replaceChildren(el('div', { class: 'rt' },
      el('div', { class: 'rt-topo' },
        el('div', {}, el('h1', { text: 'Rotina' }), el('p', { text: 'Suas tarefas e o checklist do dia, para não deixar nada para trás.' })),
        el('button', { class: 'rt-bt forte', type: 'button', text: '+ Nova tarefa', onclick: () => editarTarefa(null, t) })),
      el('div', { class: 'rt-grade' }, cartaoTarefas, el('div', { class: 'rt-lado' }, ...cartoesDia(dia, t)))));
  }

  function linhaTarefa(x, mostraDono, ctx) {
    const el = ui.el;
    const marca = el('button', { class: 'rt-marca', type: 'button', role: 'checkbox', 'aria-checked': String(x.feita), 'aria-label': x.feita ? 'Desmarcar feita' : 'Marcar como feita', html: IC.certo });
    marca.addEventListener('click', async (e) => {
      e.stopPropagation();
      marca.setAttribute('aria-checked', String(!x.feita));
      try { await ui.post(`/api/rotina/tarefas/${x.id}/feita`, { feita: !x.feita }); if (!x.feita) ui.toast('Tarefa feita ✓'); } catch (er) { ui.toast(er.message); }
      desenhar(caixa, ui);
    });
    const prazo = el('span', { class: x.visao === 'atrasadas' ? 'atraso' : '', text: x.visao === 'atrasadas' ? `Atrasada · ${quando(x.venceEm)}` : x.feita && x.feitaEm ? `Feita ${quando(x.feitaEm).toLowerCase()}` : quando(x.venceEm) });
    const cli = x.conversaId ? el('button', { class: 'rt-cli', type: 'button', title: 'Abrir a conversa', onclick: (e) => { e.stopPropagation(); ui.abrir(x.conversaId); } }, el('i', { html: IC.conversa, style: 'display:inline-flex' }), el('span', { text: x.clienteNome || 'Abrir conversa' }))
      : x.clienteNome ? el('span', { text: x.clienteNome }) : null;
    const linha = el('div', { class: 'rt-linha' + (x.feita ? ' feita' : ''), tabindex: '0', role: 'button', 'aria-label': `Editar tarefa: ${x.titulo}` },
      marca,
      el('div', { class: 'rt-corpo' },
        el('span', { class: 'rt-tit', text: x.titulo }),
        x.descricao ? el('span', { class: 'rt-desc', text: x.descricao }) : null,
        el('div', { class: 'rt-meta' }, prazo,
          x.prioridade !== 'normal' ? el('span', { class: `rt-pri ${x.prioridade}`, text: x.prioridade === 'alta' ? 'Prioridade alta' : 'Baixa' }) : null,
          mostraDono ? el('span', { text: x.responsavelNome }) : null, cli)));
    const abrir = () => editarTarefa(x, ctx);
    linha.addEventListener('click', abrir);
    linha.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === linha) { e.preventDefault(); abrir(); } });
    return linha;
  }

  function cartoesDia(dia, t) {
    const el = ui.el;
    const p = dia.total ? Math.round((dia.feitas / dia.total) * 100) : 0;
    const frase = !dia.total ? 'Monte o checklist que se repete.' : dia.feitas === dia.total ? 'Tudo feito hoje. Parabéns!' : `Falta${dia.total - dia.feitas > 1 ? 'm' : ''} ${dia.total - dia.feitas} para fechar o dia.`;
    const itens = dia.itens.map((i) => {
      const marca = el('span', { class: 'rt-marca', role: 'checkbox', 'aria-checked': String(i.feita), html: IC.certo });
      const linha = el('div', { class: 'rt-check' + (i.feita ? ' feita' : ''), tabindex: '0', role: 'button', 'aria-label': `${i.feita ? 'Desmarcar' : 'Marcar'}: ${i.titulo}` },
        marca, el('div', { class: 'rt-corpo' }, el('span', { class: 'rt-tit', text: i.titulo }),
          el('div', { class: 'rt-meta' }, el('span', { text: i.ate ? `Até ${i.ate}` : resumoFreq(i) }), i.ate ? el('span', { text: resumoFreq(i) }) : null)));
      const alternar = async () => {
        marca.setAttribute('aria-checked', String(!i.feita));
        try { await ui.post(`/api/rotina/dia/${i.id}`, { feita: !i.feita }); } catch (er) { ui.toast(er.message); }
        desenhar(caixa, ui);
      };
      linha.addEventListener('click', alternar);
      linha.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
      return linha;
    });
    const hojeTxt = new Date(`${dia.data}T12:00:00-03:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: FUSO });
    const cartao = el('section', { class: 'rt-cartao' },
      el('div', { class: 'rt-cab' }, el('h2', { text: 'Rotina de hoje' }), el('button', { class: 'rt-bt mini', type: 'button', text: 'Editar rotina', onclick: () => gerenciarRotina(t) })),
      el('div', { class: 'rt-prog' },
        el('div', { class: 'rt-anel', style: `--p:${p}`, role: 'img', 'aria-label': `${dia.feitas} de ${dia.total} feitos` }, el('b', { text: `${dia.feitas}/${dia.total}` })),
        el('div', { class: 'rt-prog-txt' }, el('b', { text: `${dia.feitas} de ${dia.total}` }), el('span', { text: frase }), el('span', { text: hojeTxt }))),
      ...(itens.length ? itens : [el('p', { class: 'rt-vazio', text: 'Nenhum item hoje. Ex.: "Responder todos do Radar até 10h", "Mandar 10 follow-ups", "Atualizar o funil".' })]));
    const saida = [cartao];
    if (dia.equipe?.length) {
      saida.push(el('section', { class: 'rt-cartao' }, el('h2', { text: 'Rotina da equipe hoje' }),
        ...dia.equipe.map((x) => {
          const pp = Math.round((x.feitas / x.total) * 100);
          return el('div', { class: 'rt-pessoa' }, el('div', { class: 'rt-pessoa-cab' }, el('b', { text: x.nome }), el('span', { text: `${x.feitas} de ${x.total}` })),
            el('div', { class: 'rt-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pp), 'aria-label': `Rotina de ${x.nome}` }, el('i', { style: `width:${pp}%` })));
        })));
    }
    return saida;
  }

  // ---------- janelas ----------
  function janela() {
    const d = ui.el('dialog', { class: 'rt-d' });
    document.body.append(d); d.addEventListener('close', () => d.remove());
    return d;
  }
  const campo = (rot, input) => ui.el('label', {}, document.createTextNode(rot), input);
  const segmentado = (opcoes, atual, aoMudar, classe = '') => {
    const caixaSeg = ui.el('div', { class: 'rt-seg ' + classe, role: 'group' });
    for (const [v, nome] of opcoes) {
      const b = ui.el('button', { type: 'button', text: nome, 'aria-pressed': String(v === atual) });
      b.addEventListener('click', () => { for (const x of caixaSeg.children) x.setAttribute('aria-pressed', String(x === b)); aoMudar(v); });
      caixaSeg.append(b);
    }
    return caixaSeg;
  };

  /** Nova tarefa (x = null) ou edição. ctx traz equipe/gestor; opcoes.conversaId liga a uma conversa. */
  async function editarTarefa(x, ctx, opcoes = {}) {
    ui = U(); css();
    const el = ui.el;
    if (!ctx) { try { ctx = await ui.api('/api/rotina/tarefas?visao=hoje'); } catch { ctx = { gestor: false, equipe: [], eu: ui.estado?.eu?.id }; } }
    const v = x || { titulo: '', descricao: '', venceEm: null, responsavelId: ctx.eu, prioridade: 'normal', conversaId: opcoes.conversaId || null, clienteNome: null };
    let conversaId = v.conversaId, prioridade = v.prioridade;
    if (conversaId && !v.clienteNome) {
      const c = (ui.estado?.conversas || []).find((k) => k.id === conversaId) || (ui.estado?.aberta?.id === conversaId ? ui.estado.aberta : null);
      v.clienteNome = c ? (window.SintoniaFone.rotulo(c.nome, c.telefone) || c.telefone) : 'Conversa';
    }
    const titulo = el('input', { value: v.titulo, maxlength: '140', placeholder: 'Ex.: Retornar a Ana sobre o orçamento', required: '' });
    const desc = el('textarea', { rows: '2', maxlength: '2000', placeholder: 'Detalhes (opcional)' }); desc.value = v.descricao || '';
    const venc = v.venceEm ? new Date(v.venceEm) : null;
    const padrao = new Date(Date.now() + 3600_000);
    const data = el('input', { type: 'date', value: venc ? diaBahia(venc) : x ? '' : diaBahia(new Date()) });
    const horaIn = el('input', { type: 'time', value: venc ? hora(venc) : x ? '' : `${String(Number(hora(padrao).slice(0, 2))).padStart(2, '0')}:00` });
    const resp = ctx.gestor ? (() => {
      const s = el('select', {}, ...ctx.equipe.map((p) => el('option', { value: p.id, text: p.id === ctx.eu ? `${p.nome} (eu)` : p.nome })));
      s.value = v.responsavelId || ctx.eu; return s;
    })() : null;
    // Cliente: a conversa ligada (chip) ou escolher entre as conversas carregadas.
    const listaId = 'rt-clientes-' + Math.random().toString(36).slice(2, 7);
    const conversas = (ui.estado?.conversas || []).slice(0, 400);
    const rotuloConv = (c) => `${window.SintoniaFone.temNome(c.nome) ? c.nome : 'Sem nome'} · ${window.SintoniaFone.formatar(c.telefone)}`;
    const busca = el('input', { list: listaId, placeholder: 'Buscar pelo nome ou telefone', autocomplete: 'off' });
    const dl = el('datalist', { id: listaId }, ...conversas.map((c) => el('option', { value: rotuloConv(c) })));
    const zonaCliente = el('div');
    const desenharCliente = () => {
      if (conversaId) zonaCliente.replaceChildren(el('div', { class: 'rt-chip' }, el('i', { html: IC.conversa, style: 'display:inline-flex;width:16px' }), el('span', { text: v.clienteNome || 'Conversa' }),
        el('button', { class: 'rt-bt mini', type: 'button', text: 'Tirar', onclick: () => { conversaId = null; v.clienteNome = null; desenharCliente(); } })));
      else zonaCliente.replaceChildren(busca, dl);
    };
    busca.addEventListener('change', () => { const c = conversas.find((k) => rotuloConv(k) === busca.value); if (c) { conversaId = c.id; v.clienteNome = c.nome || c.telefone; busca.value = ''; desenharCliente(); } });
    desenharCliente();
    const erro = el('p', { class: 'rt-erro', role: 'alert', hidden: '' });
    const d = janela();
    const apagar = x ? el('button', { class: 'rt-bt perigo', type: 'button', text: 'Apagar', onclick: async () => {
      if (!confirm(`Apagar a tarefa "${x.titulo}"?`)) return;
      try { await ui.api(`/api/rotina/tarefas/${x.id}`, { method: 'DELETE' }); d.close(); fim(); } catch (er) { erro.textContent = er.message; erro.hidden = false; }
    } }) : null;
    const form = el('form', { class: 'rt-form' },
      el('h2', { text: x ? 'Editar tarefa' : 'Nova tarefa' }),
      campo('O que fazer', titulo), campo('Descrição', desc),
      el('div', { class: 'rt-dois' }, campo('Dia', data), campo('Hora', horaIn)),
      resp ? campo('Responsável', resp) : null,
      el('label', {}, document.createTextNode('Prioridade'), segmentado(Object.entries(PRI), prioridade, (p) => { prioridade = p; })),
      el('label', {}, document.createTextNode('Cliente (opcional)'), zonaCliente),
      erro,
      el('div', { class: 'rt-acoes' }, apagar ? el('span', { style: 'flex:1;display:flex' }, apagar) : null,
        el('button', { class: 'rt-bt', type: 'button', text: 'Cancelar', onclick: () => d.close() }),
        el('button', { class: 'rt-bt forte', type: 'submit', text: x ? 'Salvar' : 'Criar tarefa' })));
    const fim = () => { resumo(); if (caixa && ui.estado?.vista === 'rotina') desenhar(caixa, ui); };
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.hidden = true;
      const venceEm = data.value ? new Date(`${data.value}T${horaIn.value || '18:00'}:00-03:00`).toISOString() : null;
      const corpo = { titulo: titulo.value, descricao: desc.value, venceEm, prioridade, conversaId, ...(resp ? { responsavelId: resp.value } : {}) };
      try {
        if (x) await ui.api(`/api/rotina/tarefas/${x.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
        else await ui.post('/api/rotina/tarefas', corpo);
        d.close(); ui.toast(x ? 'Tarefa salva.' : 'Tarefa criada. Ela aparece em Agenda › Rotina.'); fim();
      } catch (er) { erro.textContent = er.message; erro.hidden = false; }
    });
    d.append(form); d.showModal(); if (!x) titulo.focus();
  }

  async function gerenciarRotina(ctx) {
    const el = ui.el;
    const d = janela();
    const corpo = el('div', { class: 'rt-form' });
    d.append(corpo); d.showModal();
    const recarregar = async () => {
      let r;
      try { r = await ui.api('/api/rotina/itens'); } catch (e) { corpo.replaceChildren(el('p', { class: 'rt-erro', text: e.message })); return; }
      const nomeDe = (id) => ctx.equipe.find((p) => p.id === id)?.nome;
      corpo.replaceChildren(
        el('h2', { text: 'Editar rotina' }),
        el('p', { class: 'rt-vazio', text: r.gestor ? 'Itens que se repetem para a equipe toda ou para uma pessoa. Cada dia vira um checklist para marcar.' : 'Os itens da gestão aparecem para você todo dia. Você também pode criar os seus.' }),
        el('div', {}, ...(r.itens.length ? r.itens.map((i) => el('div', { class: 'rt-item' },
          el('div', {}, el('b', { text: i.titulo + (i.ativa ? '' : ' (pausado)') }),
            el('span', { class: 'rt-meta', text: [resumoFreq(i), i.ate ? `até ${i.ate}` : '', i.paraId ? (i.paraNome || nomeDe(i.paraId) || '') : 'Toda a equipe'].filter(Boolean).join(' · ') })),
          i.podeEditar ? el('button', { class: 'rt-bt mini', type: 'button', text: 'Editar', onclick: () => editarItem(i) }) : null))
          : [el('p', { class: 'rt-vazio', text: 'Nenhum item ainda.' })])),
        el('div', { class: 'rt-acoes' }, el('button', { class: 'rt-bt', type: 'button', text: 'Fechar', onclick: () => d.close() }),
          el('button', { class: 'rt-bt forte', type: 'button', text: '+ Novo item', onclick: () => editarItem(null) })));
    };
    const editarItem = (i) => {
      const v = i || { titulo: '', frequencia: 'diaria', dias: [1, 2, 3, 4, 5], ate: null, paraId: null, ativa: true, ordem: 0 };
      let freq = v.frequencia; const dias = new Set(v.dias.length ? v.dias : [1, 2, 3, 4, 5]);
      const titulo = el('input', { value: v.titulo, maxlength: '140', placeholder: 'Ex.: Mandar 10 follow-ups' });
      const ate = el('input', { type: 'time', value: v.ate || '' });
      const botoesDias = segmentado([], '', () => {}, 'dias');
      DIAS.forEach((n, k) => { const b = el('button', { type: 'button', text: n, 'aria-pressed': String(dias.has(k)) }); b.addEventListener('click', () => { dias.has(k) ? dias.delete(k) : dias.add(k); b.setAttribute('aria-pressed', String(dias.has(k))); }); botoesDias.append(b); });
      const zonaDias = el('label', { hidden: freq === 'dias' ? null : '' }, document.createTextNode('Quais dias'), botoesDias);
      const para = ctx.gestor ? (() => { const s = el('select', {}, el('option', { value: '', text: 'Toda a equipe' }), ...ctx.equipe.map((p) => el('option', { value: p.id, text: p.nome }))); s.value = v.paraId || ''; return s; })() : null;
      const ativa = el('input', { type: 'checkbox', style: 'width:auto' }); ativa.checked = v.ativa;
      const erro = el('p', { class: 'rt-erro', role: 'alert', hidden: '' });
      const form = el('form', { class: 'rt-form' },
        el('h2', { text: i ? 'Editar item' : 'Novo item da rotina' }),
        campo('Item', titulo),
        el('label', {}, document.createTextNode('Repete'), segmentado([['diaria', 'Todo dia'], ['dias', 'Dias da semana'], ['semanal', 'Uma vez por semana']], freq, (f) => { freq = f; zonaDias.hidden = f !== 'dias'; })),
        zonaDias,
        el('div', { class: 'rt-dois' }, campo('Até que horas (opcional)', ate), para ? campo('Para quem', para) : el('span')),
        el('label', { style: 'display:flex;align-items:center;gap:8px' }, ativa, document.createTextNode('Ligado')),
        erro,
        el('div', { class: 'rt-acoes' },
          i ? el('span', { style: 'flex:1;display:flex' }, el('button', { class: 'rt-bt perigo', type: 'button', text: 'Apagar', onclick: async () => {
            if (!confirm(`Apagar "${i.titulo}" da rotina?`)) return;
            try { await ui.api(`/api/rotina/itens/${i.id}`, { method: 'DELETE' }); recarregar(); } catch (er) { erro.textContent = er.message; erro.hidden = false; }
          } })) : null,
          el('button', { class: 'rt-bt', type: 'button', text: 'Voltar', onclick: recarregar }),
          el('button', { class: 'rt-bt forte', type: 'submit', text: i ? 'Salvar' : 'Criar item' })));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); erro.hidden = true;
        const dados = { titulo: titulo.value, frequencia: freq, dias: freq === 'dias' ? [...dias] : [], ate: ate.value || null, paraId: para ? (para.value || null) : (i ? i.paraId : null), ativa: ativa.checked, ordem: v.ordem || 0 };
        try {
          if (i) await ui.api(`/api/rotina/itens/${i.id}`, { method: 'PUT', body: JSON.stringify(dados) });
          else await ui.post('/api/rotina/itens', dados);
          recarregar();
        } catch (er) { erro.textContent = er.message; erro.hidden = false; }
      });
      corpo.replaceChildren(form); titulo.focus();
    };
    d.addEventListener('close', () => { if (ui.estado?.vista === 'rotina') desenhar(caixa, ui); resumo(); });
    recarregar();
  }

  /** Atalho para criar tarefa a partir de uma conversa (menu de ações da conversa). */
  const novaTarefa = ({ conversaId } = {}) => editarTarefa(null, null, { conversaId });

  window.SintoniaTelas.rotina = { desenhar, novaTarefa, resumo, valorMenu, css };
  // Selo do menu: ao abrir o app e a cada 2 minutos (só uma leitura leve).
  /* velocidade: esta tela pode chegar depois da abertura (public/telas/sob-demanda.js): aí o "load" já passou */
  const ligarResumo = () => { setTimeout(resumo, 1500); setInterval(() => { if (!document.hidden) resumo(); }, 120000); };
  if (document.readyState === 'complete') ligarResumo(); else addEventListener('load', ligarResumo, { once: true });
})();
