/* Comercial no Dashboard: card "Minha meta" (com a comissão da atendente), ranking (dia/semana/mês),
 * serviços mais agendados e, para a gestão, "Metas e comissão" e "Painel na TV".
 * Registra window.SintoniaComercial.bloco(ui): devolve sempre o mesmo elemento (o Dashboard redesenha a cada 30 s
 * e só reaproveita este pedaço). Estilos próprios com prefixo .cm-.
 */
(() => {
  const UNIDADE = { norte: 'Norte', sumare: 'Sumaré', feira: 'Feira' };
  const PERIODOS = [['dia', 'Hoje'], ['semana', 'Semana'], ['mes', 'Mês']];
  const CRITERIOS = [['agendamentos', 'Agendamentos'], ['comparecimentos', 'Comparecimentos'], ['valor', 'Valor'], ['conversao', 'Conversão'], ['tempo', '1ª resposta']];
  const CSS = `
  .cm { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1100px) { .cm { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr); } }
  .cm-p { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); border-radius: 24px; padding: 18px; min-width: 0;
          -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); display: grid; gap: 12px; align-content: start; }
  .cm-p h3 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .cm-p h3 .cm-dir { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
  .cm-seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .cm-seg button { border: 0; background: none; color: var(--sub); font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 11px; border-radius: 999px; cursor: pointer; min-height: 32px; }
  .cm-seg button[aria-pressed="true"] { background: var(--vidro-ativo, rgba(255,255,255,.7)); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .cm-sel { font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--vidro-borda); background: var(--vidro-item); color: var(--texto); min-height: 32px; }
  .cm-bt { font: inherit; font-size: 13px; font-weight: 600; border-radius: 999px; padding: 8px 14px; border: 1px solid var(--vidro-borda); background: var(--vidro-item); color: var(--texto); cursor: pointer; min-height: 36px; }
  .cm-bt.cm-menta { background: var(--marca-menta); color: #04172b; border-color: transparent; box-shadow: var(--brilho-menta); }
  .cm-bt.cm-perigo { color: #c2410c; border-color: rgba(255,122,89,.6); background: transparent; }
  .cm-meta { background: linear-gradient(160deg, color-mix(in srgb, var(--marca-menta) 20%, transparent), transparent); }
  .cm-grande { font-size: 40px; font-weight: 800; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
  .cm-grande small { font-size: .45em; color: var(--sub); font-weight: 700; }
  .cm-sub { color: var(--sub); font-size: 13px; }
  .cm-barra { height: 10px; border-radius: 99px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); overflow: hidden; }
  .cm-barra i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--marca-azul), var(--marca-menta)); }
  .cm-lin { display: grid; grid-template-columns: 28px 36px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 0; }
  .cm-pos { font-weight: 800; text-align: center; color: var(--sub); }
  .cm-med { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 800; color: #08243f; }
  .cm-med.ouro { background: #f5b800; } .cm-med.prata { background: #c9d6e3; } .cm-med.bronze { background: #e0a36f; }
  .cm-av { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--marca-azul); color: #fff; font-size: 13px; font-weight: 700; overflow: hidden; }
  .cm-av img { width: 100%; height: 100%; object-fit: cover; }
  .cm-nome { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; gap: 6px; align-items: center; }
  .cm-var { font-size: 11px; font-weight: 700; } .cm-var.sobe { color: #087a5c; } .cm-var.desce { color: #c2410c; }
  [data-tema="escuro"] .cm-var.sobe { color: var(--marca-menta); } [data-tema="escuro"] .cm-var.desce { color: #ff7a59; }
  .cm-num { font-weight: 800; font-size: 18px; text-align: right; font-variant-numeric: tabular-nums; }
  .cm-num small { display: block; font-size: 11px; color: var(--sub); font-weight: 600; }
  .cm-serv .cm-l { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; font-weight: 600; }
  .cm-serv .cm-barra i { background: linear-gradient(90deg, var(--marca-azul), #7cc4ff); }
  .cm-vazio { color: var(--sub); font-size: 13px; }
  .cm-dlg { width: min(920px, calc(100vw - 24px)); max-height: calc(100vh - 32px); border: 1px solid var(--vidro-borda); border-radius: 24px; padding: 0; background: var(--fundo); color: var(--texto); }
  .cm-dlg::backdrop { background: rgba(4, 23, 43, .55); }
  .cm-dlg .cm-dc { padding: 20px; display: grid; gap: 16px; }
  .cm-dlg h2 { margin: 0; font-size: 22px; }
  .cm-dlg h4 { margin: 4px 0 0; font-size: 14px; }
  .cm-tab { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .cm-tab th, .cm-tab td { text-align: left; padding: 6px; border-bottom: 1px solid var(--linha); vertical-align: middle; }
  .cm-tab input, .cm-tab select, .cm-in { font: inherit; font-size: 13.5px; padding: 7px 9px; border-radius: 10px; border: 1px solid var(--linha); background: var(--entrada); color: var(--texto); width: 100%; min-width: 70px; min-height: 36px; }
  .cm-rod { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; position: sticky; bottom: 0; background: var(--fundo); padding: 12px 0 0; }
  .cm-link { font-family: ui-monospace, monospace; font-size: 12.5px; word-break: break-all; padding: 10px; border-radius: 12px; background: var(--painel); border: 1px solid var(--linha); }
  .cm-ab { display: flex; gap: 6px; flex-wrap: wrap; }
  .cm-rolar { overflow-x: auto; }
  .cm-dlg label { display: flex !important; gap: 10px; align-items: center; cursor: pointer; }
  .cm-dlg input[type=checkbox] { width: 20px !important; height: 20px; min-height: 0; margin: 0; flex: none; accent-color: var(--marca-azul); }
  `;
  const s = { el: null, ui: null, periodo: 'mes', criterio: 'agendamentos', dados: null, comissao: null, em: 0, carregando: false };

  function estilo() {
    if (document.getElementById('estilo-comercial')) return;
    const st = document.createElement('style');
    st.id = 'estilo-comercial';
    st.textContent = CSS;
    document.head.append(st);
  }
  const fmt = (v) => Number(v || 0).toLocaleString('pt-BR');
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const tempo = (seg) => (seg == null ? '—' : seg < 60 ? `${seg}s` : seg < 3600 ? `${Math.round(seg / 60)} min` : `${Math.round(seg / 360) / 10} h`);
  const iniciais = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  const eu = () => s.ui?.estado?.eu;
  const gestor = () => { const u = eu(); return !u || ['gerente', 'direcao', 'admin'].includes(u.papel); };

  function valorCriterio(p) {
    if (s.criterio === 'comparecimentos') return [fmt(p.comparecimentos), 'compareceram'];
    if (s.criterio === 'valor') return [brl(p.valor), 'vendido'];
    if (s.criterio === 'conversao') return [p.conversao == null ? '—' : `${String(p.conversao).replace('.', ',')}%`, 'conversão'];
    if (s.criterio === 'tempo') return [tempo(p.tempoSeg), '1ª resposta'];
    return [fmt(p.agendamentos), 'agendamentos'];
  }

  function seg(opcoes, atual, aoEscolher, rotulo) {
    const { el } = s.ui;
    return el('div', { class: 'cm-seg', role: 'group', 'aria-label': rotulo }, ...opcoes.map(([v, t]) => el('button', { type: 'button', 'aria-pressed': String(v === atual), text: t, onclick: () => aoEscolher(v) })));
  }

  function blocoMinha() {
    const { el } = s.ui;
    const d = s.dados;
    const p = el('section', { class: 'cm-p cm-meta', 'aria-label': gestor() ? 'Meta da equipe' : 'Minha meta' });
    if (!d) return p;
    const pessoal = !gestor() && d.minha;
    const m = pessoal ? d.minha : d.metas.equipe;
    const pct = m.pctAgendamentos ?? m.pctValor;
    p.append(el('h3', { text: pessoal ? 'Minha meta do mês' : 'Meta da equipe no mês' }));
    p.append(el('div', { class: 'cm-grande', html: pct != null ? `${Math.round(pct)}<small>%</small>` : `${fmt(m.agendamentos)}<small> agend.</small>` }));
    const alvo = m.meta.agendamentos ? `${fmt(m.agendamentos)} de ${fmt(m.meta.agendamentos)} agendamentos` : m.meta.valor ? `${brl(m.valor)} de ${brl(m.meta.valor)} vendidos` : 'Sem meta definida ainda';
    p.append(el('div', { class: 'cm-barra' }, el('i', { style: `width:${Math.min(100, pct || 0)}%` })));
    p.append(el('div', { class: 'cm-sub', text: `${alvo} · ${d.diasRestantes} dia(s) no mês` }));
    if (pessoal && d.minha.posicao) p.append(el('div', { class: 'cm-sub', html: `Você está em <b>${d.minha.posicao}º</b> no ranking` }));
    if (!pessoal) {
      const us = Object.entries(d.metas.unidades || {});
      for (const [u, x] of us) {
        const q = x.pctAgendamentos ?? x.pctValor;
        p.append(el('div', { class: 'cm-sub', text: `${UNIDADE[u] || u}: ${fmt(x.agendamentos)} agend.${x.meta.agendamentos ? ` de ${fmt(x.meta.agendamentos)}` : ''}${q != null ? ` · ${Math.round(q)}%` : ''}` }));
      }
    }
    if (pessoal && s.comissao) {
      const minha = s.comissao.atendentes[0];
      p.append(el('div', { class: 'cm-sub', html: `Comissão do mês: <b>${brl(minha?.comissao || 0)}</b> · ${fmt(minha?.compareceram || 0)} compareceram` }));
    }
    if (d.podeEditar) {
      p.append(el('div', { class: 'cm-ab' },
        el('button', { class: 'cm-bt cm-menta', type: 'button', text: 'Metas e comissão', onclick: abrirMetas }),
        el('button', { class: 'cm-bt', type: 'button', text: 'Painel na TV', onclick: abrirTv })));
    }
    return p;
  }

  function blocoRanking() {
    const { el } = s.ui;
    const d = s.dados;
    const sel = el('select', { class: 'cm-sel', 'aria-label': 'Ordenar o ranking por', onchange: (e) => { s.criterio = e.target.value; carregar(true); } },
      ...CRITERIOS.map(([v, t]) => { const o = el('option', { value: v, text: t }); if (v === s.criterio) o.selected = true; return o; }));
    const p = el('section', { class: 'cm-p', 'aria-label': 'Ranking das atendentes' },
      el('h3', {}, 'Ranking', el('span', { class: 'cm-dir' }, seg(PERIODOS, s.periodo, (v) => { s.periodo = v; carregar(true); }, 'Período do ranking'), sel)));
    const rk = d?.ranking || [];
    if (!rk.length) p.append(el('div', { class: 'cm-vazio', text: d ? 'Cadastre a equipe na aba Equipe para ver o ranking.' : 'Carregando…' }));
    for (const r of rk.slice(0, 10)) {
      const [v, rot] = valorCriterio(r);
      const av = el('span', { class: 'cm-av', text: iniciais(r.nome) });
      window.SintoniaFotos?.aplicar?.(av, r.id);
      const variacao = r.variacao > 0 ? el('span', { class: 'cm-var sobe', text: `▲${r.variacao}`, title: 'Subiu de posição' }) : r.variacao < 0 ? el('span', { class: 'cm-var desce', text: `▼${-r.variacao}`, title: 'Desceu de posição' }) : null;
      const pct = r.meta?.progressoPct;
      p.append(el('div', { class: 'cm-lin' },
        r.medalha ? el('span', { class: 'cm-med ' + r.medalha, text: String(r.posicao), title: `${r.posicao}º lugar` }) : el('span', { class: 'cm-pos', text: String(r.posicao) }),
        av,
        el('div', { style: 'min-width:0' }, el('div', { class: 'cm-nome' }, r.nome, variacao),
          pct != null ? el('div', { class: 'cm-barra', title: `${Math.round(pct)}% da meta`, style: 'margin-top:5px;height:6px' }, el('i', { style: `width:${Math.min(100, pct)}%` })) : null),
        el('div', { class: 'cm-num', html: `${v}<small>${rot}</small>` })));
    }
    return p;
  }

  function blocoServicos() {
    const { el } = s.ui;
    const lista = s.dados?.servicos || [];
    const p = el('section', { class: 'cm-p', 'aria-label': 'Serviços mais agendados' }, el('h3', { text: 'Serviços mais agendados' }));
    if (!lista.length) p.append(el('div', { class: 'cm-vazio', text: 'Os serviços aparecem conforme os agendamentos entram.' }));
    const topo = Math.max(1, ...lista.map((x) => x.agendamentos));
    for (const x of lista.slice(0, 8)) {
      const u = Object.entries(x.porUnidade || {}).map(([k, q]) => `${UNIDADE[k] || k} ${q}`).join(' · ');
      p.append(el('div', { class: 'cm-serv' }, el('div', { class: 'cm-l' }, el('span', { text: x.servico }), el('b', { text: fmt(x.agendamentos) })),
        el('div', { class: 'cm-barra' }, el('i', { style: `width:${(x.agendamentos / topo) * 100}%` })),
        el('div', { class: 'cm-sub', text: `${u}${x.valor ? ' · ' + brl(x.valor) : ''}` })));
    }
    return p;
  }

  function desenhar() {
    if (!s.el) return;
    s.el.replaceChildren(blocoMinha(), blocoRanking(), blocoServicos());
  }

  async function carregar(forcar) {
    if (s.carregando || (!forcar && Date.now() - s.em < 25000)) return;
    s.carregando = true;
    try {
      const [r, c] = await Promise.allSettled([
        s.ui.api(`/api/comercial/resumo?periodo=${s.periodo}&criterio=${s.criterio}`),
        gestor() ? Promise.resolve(null) : s.ui.api('/api/comercial/comissao'),
      ]);
      if (r.status === 'fulfilled') s.dados = r.value;
      if (c.status === 'fulfilled') s.comissao = c.value;
      s.em = Date.now();
    } finally { s.carregando = false; }
    if (!s.el?.contains(document.activeElement) || forcar) desenhar();
  }

  // ------------------------------------------------------------ janelas da gestão
  function janela(titulo) {
    const { el } = s.ui;
    document.querySelector('.cm-dlg')?.remove();
    const corpo = el('div', { class: 'cm-dc' });
    const d = el('dialog', { class: 'cm-dlg', 'aria-label': titulo }, corpo);
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    return { d, corpo };
  }
  const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

  async function abrirMetas() {
    const { el, api, toast } = s.ui;
    const { d, corpo } = janela('Metas e comissão');
    corpo.append(el('h2', { text: 'Metas e comissão' }), el('div', { class: 'cm-sub', text: 'Carregando…' }));
    let cfg;
    try { cfg = await api('/api/comercial/config'); } catch (e) { corpo.lastChild.textContent = e.message; return; }
    corpo.lastChild.remove();
    const inp = (v, extra = {}) => el('input', { class: 'cm-in', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: v ?? '', ...extra });

    // metas
    const tabMetas = el('table', { class: 'cm-tab' }, el('thead', {}, el('tr', {}, el('th', { text: 'Quem' }), el('th', { text: 'Agendamentos no mês' }), el('th', { text: 'Valor vendido (R$)' }))));
    const tb = el('tbody');
    const linhasMeta = [];
    const linhaMeta = (rotulo, tipo, id, m) => {
      const a = inp(m?.agendamentos, { 'aria-label': `Meta de agendamentos: ${rotulo}` });
      const v = inp(m?.valor, { 'aria-label': `Meta de valor: ${rotulo}` });
      linhasMeta.push({ tipo, id, a, v });
      tb.append(el('tr', {}, el('td', { text: rotulo }), el('td', {}, a), el('td', {}, v)));
    };
    linhaMeta('Equipe toda (vazio = soma das individuais)', 'equipe', null, cfg.metas.equipe);
    for (const u of cfg.unidades) linhaMeta(`Unidade ${UNIDADE[u] || u}`, 'unidade', u, cfg.metas.unidades[u]);
    for (const p of cfg.pessoas) linhaMeta(p.nome, 'atendente', p.id, cfg.metas.atendentes[p.id]);
    tabMetas.append(tb);

    // comissão
    const ligada = el('input', { type: 'checkbox' }); ligada.checked = cfg.comissao.ligada;
    const soQuem = el('input', { type: 'checkbox' }); soQuem.checked = cfg.comissao.soQuemAgendou;
    const tbR = el('tbody');
    const regras = [];
    const addRegra = (r = { servico: '', tipo: 'percentual', valor: 5 }) => {
      const sv = el('input', { class: 'cm-in', type: 'text', value: r.servico || '', placeholder: 'Todos os serviços', 'aria-label': 'Serviço da regra' });
      const tp = el('select', { class: 'cm-in', 'aria-label': 'Tipo da comissão' }, el('option', { value: 'percentual', text: '% do valor' }), el('option', { value: 'fixo', text: 'R$ fixo por agendamento' }));
      tp.value = r.tipo;
      const vl = inp(r.valor, { 'aria-label': 'Valor da comissão' });
      const item = { sv, tp, vl };
      const tr = el('tr', {}, el('td', {}, sv), el('td', {}, tp), el('td', {}, vl), el('td', {}, el('button', { class: 'cm-bt cm-perigo', type: 'button', text: 'Tirar', onclick: () => { regras.splice(regras.indexOf(item), 1); tr.remove(); } })));
      regras.push(item);
      tbR.append(tr);
    };
    for (const r of cfg.comissao.regras) addRegra(r);
    const tabR = el('table', { class: 'cm-tab' }, el('thead', {}, el('tr', {}, el('th', { text: 'Serviço (vazio = regra geral)' }), el('th', { text: 'Tipo' }), el('th', { text: 'Valor' }), el('th'))), tbR);

    // preços
    const tbP = el('tbody');
    const precos = [];
    const addPreco = (p = { servico: '', valor: '' }) => {
      const sv = el('input', { class: 'cm-in', type: 'text', value: p.servico, placeholder: 'Ex.: Progressiva', 'aria-label': 'Serviço' });
      const vl = inp(p.valor, { 'aria-label': 'Preço' });
      const item = { sv, vl };
      const tr = el('tr', {}, el('td', {}, sv), el('td', {}, vl), el('td', {}, el('button', { class: 'cm-bt cm-perigo', type: 'button', text: 'Tirar', onclick: () => { precos.splice(precos.indexOf(item), 1); tr.remove(); } })));
      precos.push(item);
      tbP.append(tr);
    };
    for (const p of cfg.precos) addPreco(p);
    const tabP = el('table', { class: 'cm-tab' }, el('thead', {}, el('tr', {}, el('th', { text: 'Serviço' }), el('th', { text: 'Preço (R$)' }), el('th'))), tbP);

    // relatório de comissão
    const hoje = new Date();
    const iso = (x) => x.toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });
    const de = el('input', { class: 'cm-in', type: 'date', value: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), 'aria-label': 'De' });
    const ate = el('input', { class: 'cm-in', type: 'date', value: iso(hoje), 'aria-label': 'Até' });
    const rel = el('div', { class: 'cm-rolar' });
    const verRel = async () => {
      rel.replaceChildren(el('div', { class: 'cm-sub', text: 'Calculando…' }));
      try {
        const r = await api(`/api/comercial/comissao?de=${de.value}&ate=${ate.value}`);
        const t = el('table', { class: 'cm-tab' }, el('thead', {}, el('tr', {}, ...['Atendente', 'Agendou', 'Compareceram', 'Vendido', 'Comissão'].map((x) => el('th', { text: x })))));
        const b = el('tbody');
        for (const a of r.atendentes) b.append(el('tr', {}, el('td', { text: a.nome }), el('td', { text: fmt(a.agendamentos) }), el('td', { text: fmt(a.compareceram) }), el('td', { text: brl(a.vendido) }), el('td', { html: `<b>${brl(a.comissao)}</b>` })));
        t.append(b);
        rel.replaceChildren(el('div', { class: 'cm-sub', html: `Total do período: <b>${brl(r.total)}</b>${r.ligada ? '' : ' · comissão ainda desligada'}` }), t);
      } catch (e) { rel.replaceChildren(el('div', { class: 'cm-sub', text: e.message })); }
    };

    const salvar = async () => {
      const metas = { equipe: {}, unidades: {}, atendentes: {} };
      for (const l of linhasMeta) {
        const m = { agendamentos: num(l.a.value) == null ? null : Math.round(num(l.a.value)), valor: num(l.v.value) };
        if (l.tipo === 'equipe') metas.equipe = m;
        else if (m.agendamentos != null || m.valor != null) (l.tipo === 'unidade' ? metas.unidades : metas.atendentes)[l.id] = m;
      }
      const corpoPut = {
        metas,
        comissao: { ligada: ligada.checked, soQuemAgendou: soQuem.checked, regras: regras.filter((r) => num(r.vl.value) != null).map((r) => ({ servico: r.sv.value.trim() || null, tipo: r.tp.value, valor: num(r.vl.value) })) },
        precos: precos.filter((p) => p.sv.value.trim() && num(p.vl.value) != null).map((p) => ({ servico: p.sv.value.trim(), valor: num(p.vl.value) })),
      };
      try {
        await api('/api/comercial/config', { method: 'PUT', body: JSON.stringify(corpoPut) });
        toast('Metas e comissão salvas');
        d.close();
        carregar(true);
      } catch (e) { toast(e.message || 'Não deu para salvar'); }
    };

    corpo.append(
      el('div', { class: 'cm-sub', text: 'Metas mensais por atendente, por unidade e da equipe. A comissão só conta quando a cliente COMPARECEU.' }),
      el('h4', { text: 'Metas do mês' }), el('div', { class: 'cm-rolar' }, tabMetas),
      el('h4', { text: 'Comissão por vender no WhatsApp' }),
      el('label', { class: 'cm-sub' }, ligada, ' Comissão ligada (a atendente vê a dela no Dashboard)'),
      el('label', { class: 'cm-sub' }, soQuem, ' Só conta para quem agendou pela conversa (desmarcado: o que a IA agendou vai para a dona da conversa)'),
      el('div', { class: 'cm-rolar' }, tabR), el('div', {}, el('button', { class: 'cm-bt', type: 'button', text: '+ Regra', onclick: () => addRegra() })),
      el('h4', { text: 'Tabela de preços (quando o agendamento não traz valor)' }),
      el('div', { class: 'cm-rolar' }, tabP), el('div', {}, el('button', { class: 'cm-bt', type: 'button', text: '+ Preço', onclick: () => addPreco() })),
      el('h4', { text: 'Relatório de comissão' }),
      el('div', { class: 'cm-ab' }, de, ate, el('button', { class: 'cm-bt', type: 'button', text: 'Ver', onclick: verRel }),
        el('button', { class: 'cm-bt', type: 'button', text: 'Exportar CSV', onclick: () => { location.href = `/api/comercial/comissao?de=${de.value}&ate=${ate.value}&formato=csv`; } })),
      rel,
      el('div', { class: 'cm-rod' }, el('button', { class: 'cm-bt', type: 'button', text: 'Fechar', onclick: () => d.close() }), el('button', { class: 'cm-bt cm-menta', type: 'button', text: 'Salvar', onclick: salvar })),
    );
    verRel();
  }

  async function abrirTv() {
    const { el, api, toast } = s.ui;
    const { d, corpo } = janela('Painel na TV');
    const area = el('div', { style: 'display:grid;gap:12px' });
    corpo.append(el('h2', { text: 'Painel na TV' }),
      el('div', { class: 'cm-sub', text: 'Abra o link no navegador da TV da sala comercial (tela cheia). Ele não pede login e não mostra telefone nem conversa das clientes: só o primeiro nome no último agendamento. Quem tiver o link vê o painel — revogue se ele vazar.' }), area);
    const pintar = (cfg) => {
      const url = cfg.tv.caminho ? location.origin + cfg.tv.caminho : null;
      const rot = el('input', { type: 'checkbox' }); rot.checked = cfg.tv.rotacao;
      const nomes = el('input', { type: 'checkbox' }); nomes.checked = cfg.tv.ultimosNomes;
      const salvarTv = async () => { try { pintar({ ...cfg, ...(await api('/api/comercial/config', { method: 'PUT', body: JSON.stringify({ tv: { rotacao: rot.checked, ultimosNomes: nomes.checked } }) })) }); toast('Painel na TV atualizado'); } catch (e) { toast(e.message); } };
      rot.onchange = salvarTv; nomes.onchange = salvarTv;
      area.replaceChildren(
        url ? el('div', { class: 'cm-link', text: url }) : el('div', { class: 'cm-sub', text: 'Nenhum link ativo.' }),
        el('div', { class: 'cm-ab' },
          url ? el('button', { class: 'cm-bt cm-menta', type: 'button', text: 'Copiar link', onclick: () => navigator.clipboard?.writeText(url).then(() => toast('Link copiado'), () => toast('Copie o link acima')) }) : null,
          url ? el('a', { class: 'cm-bt', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Abrir' }) : null,
          el('button', { class: 'cm-bt' + (url ? '' : ' cm-menta'), type: 'button', text: url ? 'Gerar novo link' : 'Gerar link', onclick: async () => { const r = await api('/api/comercial/tv', { method: 'POST' }); pintar({ ...cfg, tv: { ...cfg.tv, caminho: r.caminho, ativo: true } }); } }),
          url ? el('button', { class: 'cm-bt cm-perigo', type: 'button', text: 'Revogar', onclick: async () => { await api('/api/comercial/tv', { method: 'DELETE' }); pintar({ ...cfg, tv: { ...cfg.tv, caminho: null, ativo: false } }); toast('Link revogado'); } }) : null),
        el('label', { class: 'cm-sub' }, rot, ' Alternar entre 3 telas (resumo, ranking, serviços) a cada 20 s'),
        el('label', { class: 'cm-sub' }, nomes, ' Mostrar o primeiro nome da cliente no último agendamento'),
        el('div', { class: 'cm-rod' }, el('button', { class: 'cm-bt', type: 'button', text: 'Fechar', onclick: () => d.close() })));
    };
    try { pintar(await api('/api/comercial/config')); } catch (e) { area.textContent = e.message; }
  }

  window.SintoniaComercial = {
    bloco(ui) {
      estilo();
      s.ui = ui;
      if (!s.el) s.el = ui.el('div', { class: 'cm', id: 'comercial' });
      if (!s.dados) desenhar();
      carregar(false);
      return s.el;
    },
    abrirMetas: () => abrirMetas(),
    abrirTv: () => abrirTv(),
  };

  // Tela própria (menu Relatórios › Comercial): o mesmo bloco do Dashboard, com metas, comissão e o link da TV no topo.
  window.SintoniaTelas = window.SintoniaTelas || {};
  window.SintoniaTelas.comercial = {
    desenhar(caixa, ui) {
      const el = ui.el;
      const gestao = ui.ehGestor(ui.estado.eu || {});
      const topo = el('div', { class: 'ds-cab-tela' },
        el('div', { class: 'ds-cab-txt' }, el('h1', { class: 'titulo-grande', text: 'Comercial' }), el('p', { text: 'Metas, ranking da equipe, comissão e o painel da sala comercial na TV.' })),
        gestao ? el('div', { class: 'ds-cab-acoes' },
          el('button', { class: 'botao leve', type: 'button', text: 'Metas e comissão', onclick: () => abrirMetas() }),
          el('button', { class: 'botao', type: 'button', text: 'Painel na TV', onclick: () => abrirTv() })) : null);
      caixa.replaceChildren(el('div', { class: 'ds-tela' }, topo, window.SintoniaComercial.bloco(ui)));
      carregar(true);
    },
  };
})();
