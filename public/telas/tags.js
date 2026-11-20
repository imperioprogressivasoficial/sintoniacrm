/* clientes-tags: tags em um lugar só.
 * 1) window.SintoniaTags: o seletor de tags usado em todo lugar que se aplica tag (conversa, ficha, CRM, seleção em
 *    massa, Clientes). Mostra as tags que já existem (busca, cor, quantos contatos têm cada uma) e só oferece criar
 *    uma nova quando o nome digitado ainda não existe.
 *    - SintoniaTags.montar(caixa, op): desenha o seletor dentro de um elemento (painel "Etapa e etiquetas").
 *    - SintoniaTags.escolher(op): o mesmo seletor numa janela; devolve a tag escolhida (ou null).
 * 2) window.SintoniaTelas.tags: a tela Vendas › Tags (gestão completa): lista com cor, contatos e último uso,
 *    editar nome/cor/grupo, juntar duas tags, apagar (avisando quantos contatos perdem) e ver os contatos de uma tag.
 * Textos do servidor entram sempre por textContent (ui.el com text). Estilos em <style id="estilo-tags">, prefixo .tgs-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .tgs-sel { display: grid; gap: 10px; min-width: 0; }
  .tgs-busca { display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px; border-radius: 12px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  .tgs-busca svg { width: 18px; height: 18px; color: var(--sub); flex: none; }
  .tgs-busca input { all: unset; flex: 1; min-width: 0; font-size: 15px; color: var(--texto); }
  .tgs-busca input::placeholder { color: var(--sub); }
  .tgs-lista { display: grid; gap: 2px; max-height: min(52vh, 420px); overflow: auto; margin: 0 -4px; padding: 0 4px; }
  .tgs-grupo-tit { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); padding: 10px 8px 4px; }
  .tgs-op { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 12px; min-height: 48px; }
  .tgs-op:hover, .tgs-op:focus-visible, .tgs-op.tgs-ativa { background: var(--vidro-item); }
  .tgs-op:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -2px; }
  .tgs-op[aria-disabled="true"] { cursor: default; opacity: .6; }
  .tgs-ponto { width: 14px; height: 14px; border-radius: 50%; background: var(--cor, #8b8d98); flex: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor, #8b8d98) 22%, transparent); }
  .tgs-op .tgs-txt { flex: 1; min-width: 0; display: grid; }
  .tgs-op b { font-size: 15px; font-weight: 600; color: var(--texto); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tgs-op small { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tgs-sel .tgs-op > span.tgs-ok { width: 22px; height: 22px; border-radius: 50%; flex: none; display: grid; place-items: center; box-shadow: inset 0 0 0 2px var(--vidro-borda); color: #fff; }
  .tgs-ok svg { width: 14px; height: 14px; opacity: 0; }
  .tgs-sel .tgs-op[aria-pressed="true"] > span.tgs-ok { background: var(--marca-azul); box-shadow: none; }
  .tgs-op[aria-pressed="true"] .tgs-ok svg { opacity: 1; }
  .tgs-criar { border: 1.5px dashed color-mix(in srgb, var(--marca-azul) 45%, var(--vidro-borda)); }
  .tgs-criar .tgs-mais { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--marca-azul); color: #fff; flex: none; }
  .tgs-criar .tgs-mais svg { width: 15px; height: 15px; }
  .tgs-cores { display: flex; flex-wrap: wrap; gap: 8px; padding: 2px 10px 6px 48px; }
  .tgs-cor { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 50%; background: var(--cor); box-shadow: 0 0 0 2px transparent; }
  .tgs-cor[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--fundo, #fff), 0 0 0 4px var(--cor); }
  .tgs-cor:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 3px; }
  .tgs-vazio { padding: 18px 8px; text-align: center; color: var(--sub); font-size: 14px; line-height: 1.45; }
  .tgs-aviso { font-size: 13px; color: var(--sub); padding: 4px 10px; }
  .tgs-erro { color: #e5484d; font-size: 13.5px; padding: 0 10px; }

  /* janela do seletor e confirmações: folha de baixo no celular, caixa no centro no computador */
  .tgs-dlg { border: 0; padding: 0; background: transparent; max-width: none; max-height: none; color: var(--texto); }
  .tgs-dlg::backdrop { background: rgba(4, 16, 30, .45); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  .tgs-folha { box-sizing: border-box; background: var(--fundo); color: var(--texto); border: 1px solid var(--vidro-borda); box-shadow: 0 24px 60px rgba(0, 0, 0, .25); display: grid; gap: 12px; padding: 16px; font-family: var(--fonte); }
  .tgs-folha h2 { margin: 0; font-size: 19px; }
  .tgs-folha p.tgs-sub { margin: -6px 0 0; font-size: 13.5px; color: var(--sub); }
  .tgs-topo { display: flex; align-items: center; gap: 10px; }
  .tgs-topo h2 { flex: 1; min-width: 0; }
  .tgs-x { all: unset; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .tgs-x:hover { background: var(--vidro-item); }
  .tgs-x svg { width: 20px; height: 20px; }
  .tgs-rodape { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
  .tgs-rodape .tgs-esq { margin-right: auto; }
  .tgs-bt { all: unset; box-sizing: border-box; cursor: pointer; min-height: 40px; padding: 0 18px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; font-size: 14.5px; background: var(--marca-azul); color: #fff; }
  .tgs-bt.tgs-leve { background: var(--vidro-item); color: var(--texto); border: 1px solid var(--vidro-borda); font-weight: 600; }
  .tgs-bt.tgs-perigo { background: #e5484d; }
  .tgs-bt.tgs-link { background: none; color: var(--marca-azul); padding: 0 6px; font-weight: 600; }
  html[data-tema="escuro"] .tgs-bt.tgs-link { color: #6cb8ff; }
  .tgs-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .tgs-bt[disabled] { opacity: .5; pointer-events: none; }
  .tgs-bt svg { width: 17px; height: 17px; }
  @media (min-width: 761px) { .tgs-dlg { margin: auto; } .tgs-folha { width: min(460px, calc(100vw - 32px)); border-radius: 22px; padding: 20px; } }
  @media (max-width: 760px) { .tgs-dlg { margin: auto 0 0; width: 100vw; } .tgs-folha { width: 100vw; border-radius: 22px 22px 0 0; padding-bottom: calc(16px + env(safe-area-inset-bottom)); } .tgs-lista { max-height: 50vh; } }
  .tgs-form { display: grid; gap: 12px; }
  .tgs-form label { display: grid; gap: 6px; font-size: 12.5px; font-weight: 700; color: var(--sub); }
  .tgs-form input { font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 10px 12px; min-height: 42px; box-sizing: border-box; width: 100%; }
  .tgs-form .tgs-cores { padding: 0; }
  html[data-tema="escuro"] .tgs-form input { color-scheme: dark; }

  /* tela Vendas › Tags */
  .tgs-caixa.tgs-caixa { padding: 14px 16px 0; gap: 0; }
  @media (min-width: 761px) { .tgs-caixa.tgs-caixa { padding: 22px 28px 0; } }
  .tgs-tela { display: grid; gap: 16px; min-width: 0; padding-bottom: 36px; }
  @media (max-width: 760px) { .tgs-tela { padding-bottom: 120px; gap: 14px; } }
  .tgs-cab { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .tgs-cab h1.titulo-grande { margin: 0 !important; }
  .tgs-cab p { margin: 4px 0 0; color: var(--sub); font-size: 14px; }
  .tgs-barra { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .tgs-barra .tgs-busca { flex: 1 1 240px; height: 40px; }
  .tgs-barra select { box-sizing: border-box; height: 40px; padding: 0 12px; border-radius: 10px; font: inherit; font-size: 14px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  html[data-tema="escuro"] .tgs-barra select { color-scheme: dark; }
  .tgs-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .tgs-chip { all: unset; cursor: pointer; height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); color: var(--texto); }
  .tgs-chip[aria-pressed="true"] { background: var(--marca-azul); border-color: var(--marca-azul); color: #fff; }
  .tgs-chip em { font-style: normal; opacity: .7; font-weight: 500; }
  .tgs-cartao { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); border-radius: 22px; overflow: hidden; min-width: 0; -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  .tgs-tab { width: 100%; border-collapse: collapse; font-size: 14px; }
  .tgs-tab th { text-align: left; font-size: 11.5px; font-weight: 600; color: var(--sub); text-transform: uppercase; letter-spacing: .06em; padding: 11px 14px; border-bottom: 1px solid var(--vidro-linha); white-space: nowrap; }
  .tgs-tab td { padding: 8px 14px; border-bottom: 1px solid var(--vidro-linha); vertical-align: middle; white-space: nowrap; }
  .tgs-tab tr:last-child td { border-bottom: 0; }
  .tgs-tab tbody tr:hover { background: var(--vidro-item); }
  .tgs-tab .tgs-num { text-align: right; font-variant-numeric: tabular-nums; }
  .tgs-nome { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; max-width: 320px; }
  .tgs-nome span { overflow: hidden; text-overflow: ellipsis; }
  .tgs-barrinha { display: inline-block; width: 70px; height: 6px; border-radius: 3px; background: var(--vidro-linha); vertical-align: middle; margin-left: 8px; overflow: hidden; }
  .tgs-barrinha i { display: block; height: 100%; background: var(--cor); border-radius: 3px; }
  .tgs-acoes { display: flex; gap: 2px; justify-content: flex-end; }
  .tgs-ic { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: var(--sub); }
  .tgs-ic:hover { background: var(--vidro-ativo); color: var(--texto); }
  .tgs-ic.tgs-ic-perigo:hover { color: #e5484d; }
  .tgs-ic:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -2px; }
  .tgs-ic svg { width: 18px; height: 18px; }
  .tgs-sub-txt { color: var(--sub); }
  .tgs-cartoes { display: none; }
  @media (max-width: 760px) {
    .tgs-tab { display: none; }
    .tgs-cartoes { display: grid; }
    .tgs-c { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 2px 12px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--vidro-linha); }
    .tgs-c:last-child { border-bottom: 0; }
    .tgs-c .tgs-ponto { grid-row: 1 / span 2; }
    .tgs-c b { font-size: 15.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tgs-c small { color: var(--sub); font-size: 12.5px; grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tgs-c .tgs-acoes { grid-column: 3; grid-row: 1 / span 2; }
  }
  .tgs-esq-car { height: 220px; border-radius: 22px; background: var(--vidro-fundo); }
  @media (prefers-reduced-motion: reduce) { .tgs-op, .tgs-bt { transition: none; } }
  `;

  const SVG = {
    lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0M16 4.8a3.4 3.4 0 0 1 0 6.4M18.2 14.3a6.2 6.2 0 0 1 3 5.7"/></svg>',
    lapis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
    juntar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v5a5 5 0 0 0 5 5h7"/><path d="M18 4v2a5 5 0 0 1-2 4"/><path d="m15 11 3 3-3 3"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  };

  function estilo() {
    if (document.getElementById('estilo-tags')) return;
    const st = document.createElement('style');
    st.id = 'estilo-tags';
    st.textContent = CSS;
    document.head.append(st);
  }
  const ui = () => window.Sintonia && window.Sintonia.ui;
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const limpar = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  const contatos = (n) => (n === 1 ? '1 contato' : `${Number(n || 0).toLocaleString('pt-BR')} contatos`);
  const gestor = () => { const u = ui(); return !u?.estado?.eu || u.ehGestor(u.estado.eu); };
  const quando = (d) => {
    if (!d) return 'nunca usada';
    const dias = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (dias <= 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return `há ${dias} dias`;
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  // ---------- dados compartilhados (a lista de tags, com contagem) ----------
  const dados = { tags: [], cores: [], em: 0, buscando: null };
  async function carregar(forcar) {
    const u = ui(); if (!u) return [];
    if (!forcar && Date.now() - dados.em < 15000 && dados.tags.length) return dados.tags;
    if (dados.buscando) return dados.buscando;
    dados.buscando = Promise.all([u.api('/api/tags'), dados.cores.length ? dados.cores : u.api('/api/tags/cores').catch(() => [])])
      .then(([t, c]) => {
        dados.tags = (Array.isArray(t) ? t : []).filter((x) => !x.funilId);
        dados.cores = Array.isArray(c) ? c : [];
        dados.em = Date.now();
        u.estado.tags = dados.tags; // a lista e os filtros das Conversas usam a mesma
        return dados.tags;
      })
      .finally(() => { dados.buscando = null; });
    return dados.buscando;
  }
  const invalidar = () => { dados.em = 0; };

  async function criar(nome, cor) {
    const t = await ui().api('/api/tags', { method: 'POST', body: JSON.stringify({ nome, ...(cor ? { cor } : {}) }) });
    invalidar();
    await carregar(true);
    return dados.tags.find((x) => x.id === t.id) || { ...t, conversas: 0 };
  }

  // ---------- o seletor ----------
  /**
   * op: { marcadas?: Set<id> | () => Set<id>, varias?: boolean (liga/desliga e continua aberto),
   *       aoEscolher(tag, ligar): Promise, excluir?: Set<id>, placeholder?, foco? }
   */
  function montar(caixa, op = {}) {
    estilo();
    const u = ui(); const el = u.el;
    const st = { q: '', cor: null, ativa: 0, ocupado: false, erro: '' };
    const marcadas = () => (typeof op.marcadas === 'function' ? op.marcadas() : op.marcadas) || new Set();
    const entrada = el('input', { type: 'search', placeholder: op.placeholder || 'Buscar ou criar tag', 'aria-label': 'Buscar ou criar tag', autocomplete: 'off', enterkeyhint: 'done' });
    const lista = el('div', { class: 'tgs-lista', role: 'listbox', 'aria-label': 'Tags' });
    const raiz = el('div', { class: 'tgs-sel' }, el('label', { class: 'tgs-busca', html: SVG.lupa }, entrada), lista);
    caixa.replaceChildren(raiz);
    if (op.alturaLivre) lista.style.maxHeight = 'none';

    const visiveis = () => {
      const q = semAcento(st.q);
      return dados.tags.filter((t) => !op.excluir?.has(t.id) && (!q || semAcento(t.nome).includes(q) || semAcento(t.grupo).includes(q)));
    };
    const exata = () => { const q = semAcento(limpar(st.q)); return q && dados.tags.find((t) => semAcento(t.nome) === q); };

    async function escolher(t) {
      if (st.ocupado) return;
      const ligar = op.varias ? !marcadas().has(t.id) : true;
      st.ocupado = true; st.erro = '';
      try { await op.aoEscolher?.(t, ligar); } catch (x) { st.erro = x.message; }
      st.ocupado = false;
      desenhar();
    }
    async function criarNova() {
      const nome = limpar(st.q);
      if (!nome || st.ocupado) return;
      if (nome.length > 30) { st.erro = 'O nome da tag pode ter até 30 letras.'; return desenhar(); }
      st.ocupado = true; st.erro = '';
      try {
        const t = await criar(nome, st.cor);
        st.q = ''; entrada.value = ''; st.cor = null;
        st.ocupado = false;
        await escolher(t);
        u.toast(`Tag “${t.nome}” criada ✓`);
      } catch (x) { st.ocupado = false; st.erro = x.message; desenhar(); }
    }

    function linha(t, i) {
      const lig = marcadas().has(t.id);
      const b = el('button', { type: 'button', class: 'tgs-op' + (i === st.ativa ? ' tgs-ativa' : ''), role: 'option', 'aria-pressed': op.varias ? String(lig) : null, 'aria-selected': String(i === st.ativa), onclick: () => escolher(t) },
        el('i', { class: 'tgs-ponto' }),
        el('span', { class: 'tgs-txt' }, el('b', { text: t.nome }), el('small', { text: [contatos(t.conversas), t.grupo].filter(Boolean).join(' · ') })),
        op.varias ? el('span', { class: 'tgs-ok', html: SVG.ok }) : null);
      b.style.setProperty('--cor', t.cor);
      return b;
    }

    function desenhar() {
      const lst = visiveis();
      if (st.ativa >= lst.length + 1) st.ativa = 0;
      const partes = [];
      const q = limpar(st.q);
      // Com grupos e sem busca: separado por grupo; com busca: pela ordem.
      const grupos = !q && lst.some((t) => t.grupo);
      if (grupos) {
        const mapa = new Map();
        for (const t of lst) { const g = t.grupo || ''; mapa.set(g, [...(mapa.get(g) || []), t]); }
        const nomes = [...mapa.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'pt-BR')));
        let i = 0;
        for (const g of nomes) { partes.push(el('div', { class: 'tgs-grupo-tit', text: g || 'Sem grupo' })); for (const t of mapa.get(g)) partes.push(linha(t, i++)); }
      } else lst.forEach((t, i) => partes.push(linha(t, i)));

      if (q && !exata()) {
        if (gestor()) {
          if (!st.cor) st.cor = dados.cores[dados.tags.length % Math.max(1, dados.cores.length)]?.hex || null;
          const b = el('button', { type: 'button', class: 'tgs-op tgs-criar' + (st.ativa === lst.length ? ' tgs-ativa' : ''), onclick: criarNova, 'aria-disabled': st.ocupado ? 'true' : null },
            el('span', { class: 'tgs-mais', html: SVG.mais }), el('span', { class: 'tgs-txt' }, el('b', { text: `Criar “${q}”` }), el('small', { text: 'Tag nova · escolha a cor abaixo' })));
          const cores = el('div', { class: 'tgs-cores', role: 'radiogroup', 'aria-label': 'Cor da tag nova' }, ...dados.cores.map((c) => {
            const x = el('button', { type: 'button', class: 'tgs-cor', title: c.nome, 'aria-label': c.nome, 'aria-pressed': String(st.cor === c.hex), onclick: () => { st.cor = c.hex; desenhar(); } });
            x.style.setProperty('--cor', c.hex); return x;
          }));
          partes.push(b, cores);
        } else partes.push(el('div', { class: 'tgs-aviso', text: `Não existe a tag “${q}”. Peça para a gestão criar.` }));
      }
      if (!dados.tags.length && !q) partes.push(el('div', { class: 'tgs-vazio', text: gestor() ? 'Nenhuma tag ainda. Digite um nome acima para criar a primeira.' : 'Nenhuma tag ainda. Peça para a gestão criar.' }));
      else if (!lst.length && q && exata()) partes.push(el('div', { class: 'tgs-vazio', text: 'Essa tag já está aqui.' }));
      if (st.erro) partes.push(el('div', { class: 'tgs-erro', role: 'alert', text: st.erro }));
      lista.replaceChildren(...partes);
    }

    entrada.addEventListener('input', () => { st.q = entrada.value; st.ativa = 0; st.erro = ''; desenhar(); });
    entrada.addEventListener('keydown', (e) => {
      const lst = visiveis();
      const total = lst.length + (limpar(st.q) && !exata() && gestor() ? 1 : 0);
      if (e.key === 'ArrowDown') { e.preventDefault(); st.ativa = Math.min(total - 1, st.ativa + 1); desenhar(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); st.ativa = Math.max(0, st.ativa - 1); desenhar(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (st.ativa < lst.length) { const t = exata() || lst[st.ativa]; if (t) escolher(t); }
        else criarNova();
      }
    });
    desenhar();
    carregar().then(desenhar).catch(() => {});
    if (op.foco && matchMedia('(min-width: 761px)').matches) setTimeout(() => entrada.focus(), 60);
    return { atualizar: desenhar, entrada };
  }

  // ---------- janelas ----------
  function janela(montarCorpo, { titulo, sub, aoFechar } = {}) {
    estilo();
    const u = ui(); const el = u.el;
    const d = el('dialog', { class: 'tgs-dlg', 'aria-label': titulo || '' });
    const folha = el('div', { class: 'tgs-folha' },
      el('div', { class: 'tgs-topo' }, el('h2', { text: titulo || '' }), el('button', { type: 'button', class: 'tgs-x', 'aria-label': 'Fechar', html: SVG.x, onclick: () => d.close() })),
      sub ? el('p', { class: 'tgs-sub', text: sub }) : null);
    d.append(folha);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => { d.remove(); aoFechar?.(); });
    document.body.append(d);
    montarCorpo(folha, d);
    d.showModal();
    return d;
  }

  /**
   * Seletor numa janela. Uma tag (varias falso): devolve a escolhida. Várias: liga/desliga até "Pronto" e devolve null.
   * op: { titulo, sub, varias, marcadas, aoEscolher, excluir }
   */
  function escolher(op = {}) {
    return new Promise((ok) => {
      let escolhida = null;
      janela((folha, d) => {
        const u = ui(); const el = u.el;
        const corpo = el('div');
        folha.append(corpo);
        montar(corpo, { ...op, foco: true, aoEscolher: async (t, ligar) => {
          if (op.aoEscolher) await op.aoEscolher(t, ligar);
          if (!op.varias) { escolhida = t; d.close(); }
        } });
        const rodape = el('div', { class: 'tgs-rodape' },
          gestor() ? el('button', { type: 'button', class: 'tgs-bt tgs-link tgs-esq', text: 'Gerenciar tags', onclick: () => { d.close(); u.mostrar('tags'); } }) : null,
          op.varias ? el('button', { type: 'button', class: 'tgs-bt', text: 'Pronto', onclick: () => d.close() }) : null);
        if (rodape.childNodes.length) folha.append(rodape);
      }, { titulo: op.titulo || 'Tags', sub: op.sub, aoFechar: () => ok(escolhida) });
    });
  }

  /** Confirmação com texto claro (o que acontece e quantos contatos). */
  function confirmar({ titulo, texto, botao = 'Confirmar', perigo = false }) {
    return new Promise((ok) => {
      let sim = false;
      janela((folha, d) => {
        const el = ui().el;
        folha.append(el('p', { style: 'margin:0;font-size:15px;line-height:1.5', text: texto }),
          el('div', { class: 'tgs-rodape' },
            el('button', { type: 'button', class: 'tgs-bt tgs-leve', text: 'Cancelar', onclick: () => d.close() }),
            el('button', { type: 'button', class: 'tgs-bt' + (perigo ? ' tgs-perigo' : ''), text: botao, onclick: () => { sim = true; d.close(); } })));
      }, { titulo, aoFechar: () => ok(sim) });
    });
  }

  /** Marca/desmarca uma tag numa conversa (o caminho de sempre: evento e funil respeitados). */
  async function alternarNaConversa(conversaId, t, ligar) {
    const u = ui();
    const r = ligar ? await u.post(`/api/conversas/${conversaId}/tags`, { tagId: t.id }) : await u.api(`/api/conversas/${conversaId}/tags/${t.id}`, { method: 'DELETE' });
    t.conversas = Math.max(0, (t.conversas || 0) + (ligar ? 1 : -1));
    const c = (u.estado.conversas || []).find((x) => x.id === conversaId);
    if (c && r?.tags) c.tags = r.tags;
    return r?.tags || [];
  }

  /** Atalho para as telas: escolhe as tags de uma conversa (liga/desliga na hora). */
  async function daConversa(conversaId, { titulo = 'Tags', sub, aoMudar } = {}) {
    const u = ui();
    let atuais = new Set(((u.estado.conversas || []).find((x) => x.id === conversaId)?.tags || []).map((t) => t.id));
    try { const d = await u.api(`/api/conversas/${conversaId}`); atuais = new Set((d.conversa?.tags || []).map((t) => t.id)); } catch { /* usa o que já tem */ }
    await escolher({ titulo, sub, varias: true, marcadas: () => atuais, aoEscolher: async (t, ligar) => {
      const tags = await alternarNaConversa(conversaId, t, ligar);
      atuais = new Set(tags.map((x) => x.id));
      aoMudar?.(tags);
    } });
    u.estado.assinatura = '';
    return atuais;
  }

  window.SintoniaTags = { estilo, carregar, invalidar, montar, escolher, confirmar, daConversa, alternarNaConversa, dados };

  // ---------- tela Vendas › Tags ----------
  const T = { caixa: null, busca: '', grupo: '*', ordem: 'uso', carregando: false };
  const CHAVE = 'sintonia.tags.tela';
  try { Object.assign(T, JSON.parse(localStorage.getItem(CHAVE) || '{}')); } catch { /* sem armazenamento */ }
  const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify({ grupo: T.grupo, ordem: T.ordem })); } catch { /* sem armazenamento */ } };

  async function recarregar() { invalidar(); await carregar(true); desenharTela(); }

  function editar(t) {
    const u = ui(); const el = u.el;
    const st = { cor: t?.cor || dados.cores[dados.tags.length % Math.max(1, dados.cores.length)]?.hex, erro: '' };
    const grupos = [...new Set(dados.tags.map((x) => x.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    janela((folha, d) => {
      const nome = el('input', { maxlength: '30', required: '', autocomplete: 'off', placeholder: 'Ex.: VIP, Indicação, Retorno' }); nome.value = t?.nome || '';
      const grupo = el('input', { maxlength: '30', autocomplete: 'off', list: 'tgs-grupos', placeholder: 'Opcional. Ex.: Interesse, Origem' }); grupo.value = t?.grupo || '';
      const cores = el('div', { class: 'tgs-cores', role: 'radiogroup', 'aria-label': 'Cor' });
      const erro = el('div', { class: 'tgs-erro', role: 'alert' });
      const pintar = () => cores.replaceChildren(...dados.cores.map((c) => { const x = el('button', { type: 'button', class: 'tgs-cor', title: c.nome, 'aria-label': c.nome, 'aria-pressed': String(st.cor === c.hex), onclick: () => { st.cor = c.hex; pintar(); } }); x.style.setProperty('--cor', c.hex); return x; }));
      pintar();
      const salvar = el('button', { type: 'submit', class: 'tgs-bt', text: t ? 'Salvar' : 'Criar tag' });
      const form = el('form', { class: 'tgs-form' },
        el('label', {}, 'Nome', nome), el('label', {}, 'Cor', cores), el('label', {}, 'Grupo', grupo),
        el('datalist', { id: 'tgs-grupos' }, ...grupos.map((g) => el('option', { value: g }))),
        erro, el('div', { class: 'tgs-rodape' }, el('button', { type: 'button', class: 'tgs-bt tgs-leve', text: 'Cancelar', onclick: () => d.close() }), salvar));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const corpo = { nome: nome.value, cor: st.cor, grupo: limpar(grupo.value) || null };
        salvar.setAttribute('disabled', '');
        try {
          if (t) await u.api('/api/tags/' + t.id, { method: 'PATCH', body: JSON.stringify(corpo) });
          else await u.post('/api/tags', corpo);
          d.close(); u.toast(t ? 'Tag salva ✓' : 'Tag criada ✓'); await recarregar(); u.atualizar?.();
        } catch (x) { erro.textContent = x.message; salvar.removeAttribute('disabled'); }
      });
      folha.append(form);
      setTimeout(() => nome.focus(), 60);
    }, { titulo: t ? 'Editar tag' : 'Nova tag' });
  }

  async function juntar(de) {
    const u = ui();
    const para = await escolher({ titulo: `Juntar “${de.nome}” em…`, sub: 'Escolha a tag que fica. Quem tem as duas não fica repetido.', excluir: new Set([de.id]) });
    if (!para) return;
    const ok = await confirmar({ titulo: 'Juntar tags', texto: `${contatos(de.conversas)} com “${de.nome}” passam a ter “${para.nome}”, e a tag “${de.nome}” deixa de existir. Isso não tem volta.`, botao: 'Juntar' });
    if (!ok) return;
    try {
      const r = await u.post(`/api/tags/${de.id}/juntar`, { paraId: para.id });
      u.toast(`Pronto: “${de.nome}” entrou em “${para.nome}” (${contatos(r.movidas)} ganharam a tag) ✓`);
      await recarregar(); u.estado.assinatura = ''; u.atualizar?.();
    } catch (x) { u.toast(x.message); }
  }

  async function apagar(t) {
    const u = ui();
    const ok = await confirmar({ titulo: 'Apagar tag', texto: t.conversas ? `${contatos(t.conversas)} vão perder a tag “${t.nome}”. Isso não tem volta.` : `Ninguém tem a tag “${t.nome}”. Ela some da lista.`, botao: 'Apagar', perigo: true });
    if (!ok) return;
    try { const r = await u.api('/api/tags/' + t.id, { method: 'DELETE' }); u.toast(`Tag apagada (saiu de ${contatos(r.removidaDe)}) ✓`); await recarregar(); u.estado.assinatura = ''; u.atualizar?.(); }
    catch (x) { u.toast(x.message); }
  }

  const verContatos = (t) => { const u = ui(); window.SintoniaTelas.clientes?.irAba?.('clientes', { tag: t.id }); u.mostrar('clientes'); };

  function desenharTela() {
    const u = ui(); const el = u.el; const caixa = T.caixa;
    if (!caixa || !u) return;
    const pode = gestor();
    const todos = dados.tags;
    const grupos = [...new Set(todos.map((t) => t.grupo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (T.grupo !== '*' && T.grupo !== '' && !grupos.includes(T.grupo)) T.grupo = '*';
    const q = semAcento(T.busca);
    const lista = todos.filter((t) => (T.grupo === '*' || (t.grupo || '') === T.grupo) && (!q || semAcento(t.nome).includes(q) || semAcento(t.grupo).includes(q)));
    const ordem = { uso: (a, b) => (b.conversas || 0) - (a.conversas || 0) || a.nome.localeCompare(b.nome, 'pt-BR'), nome: (a, b) => a.nome.localeCompare(b.nome, 'pt-BR'), recente: (a, b) => new Date(b.ultimoUso || 0) - new Date(a.ultimoUso || 0), ordem: (a, b) => (a.ordem || 0) - (b.ordem || 0) };
    lista.sort(ordem[T.ordem] || ordem.uso);
    const maior = Math.max(1, ...todos.map((t) => t.conversas || 0));
    const total = todos.reduce((s, t) => s + (t.conversas || 0), 0);

    const acoes = (t) => el('div', { class: 'tgs-acoes' },
      el('button', { type: 'button', class: 'tgs-ic', title: 'Ver os contatos com esta tag', 'aria-label': `Ver contatos com ${t.nome}`, html: SVG.pessoas, onclick: () => verContatos(t) }),
      pode ? el('button', { type: 'button', class: 'tgs-ic', title: 'Editar nome, cor e grupo', 'aria-label': `Editar ${t.nome}`, html: SVG.lapis, onclick: () => editar(t) }) : null,
      pode ? el('button', { type: 'button', class: 'tgs-ic', title: 'Juntar com outra tag', 'aria-label': `Juntar ${t.nome} com outra tag`, html: SVG.juntar, onclick: () => juntar(t) }) : null,
      pode ? el('button', { type: 'button', class: 'tgs-ic tgs-ic-perigo', title: 'Apagar', 'aria-label': `Apagar ${t.nome}`, html: SVG.lixo, onclick: () => apagar(t) }) : null);
    const ponto = (t) => { const i = el('i', { class: 'tgs-ponto' }); i.style.setProperty('--cor', t.cor); return i; };
    const barrinha = (t) => { const b = el('span', { class: 'tgs-barrinha' }, el('i', { style: `width:${Math.round(((t.conversas || 0) / maior) * 100)}%` })); b.style.setProperty('--cor', t.cor); return b; };
    const criada = (t) => [t.criadaEm ? new Date(t.criadaEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '', t.criadaPor ? `por ${t.criadaPor}` : ''].filter(Boolean).join(' ');

    const busca = el('input', { type: 'search', placeholder: 'Buscar tag', 'aria-label': 'Buscar tag', value: T.busca });
    busca.addEventListener('input', () => { T.busca = busca.value; const pos = busca.selectionStart; desenharTela(); const b = caixa.querySelector('.tgs-barra input'); b?.focus(); b?.setSelectionRange?.(pos, pos); });
    const sel = el('select', { 'aria-label': 'Ordenar', onchange: (e) => { T.ordem = e.target.value; gravar(); desenharTela(); } },
      ...[['uso', 'Mais usadas'], ['recente', 'Usadas por último'], ['nome', 'Nome (A–Z)'], ['ordem', 'Ordem das Conversas']].map(([v, n]) => el('option', { value: v, text: n })));
    sel.value = T.ordem;
    const chip = (v, nome, n) => el('button', { type: 'button', class: 'tgs-chip', 'aria-pressed': String(T.grupo === v), onclick: () => { T.grupo = v; gravar(); desenharTela(); } }, nome, el('em', { text: String(n) }));
    const chips = grupos.length ? el('div', { class: 'tgs-chips', role: 'group', 'aria-label': 'Grupos' },
      chip('*', 'Todas', todos.length), ...grupos.map((g) => chip(g, g, todos.filter((t) => t.grupo === g).length)),
      todos.some((t) => !t.grupo) ? chip('', 'Sem grupo', todos.filter((t) => !t.grupo).length) : null) : null;

    let corpo;
    if (T.carregando && !todos.length) corpo = el('div', { class: 'tgs-esq-car' });
    else if (!lista.length) corpo = el('div', { class: 'tgs-cartao' }, el('div', { class: 'tgs-vazio', style: 'padding:36px 16px', text: todos.length ? 'Nenhuma tag com essa busca.' : pode ? 'Nenhuma tag ainda. Crie a primeira em “Nova tag”. Tags servem para separar clientes (VIP, Indicação, Retorno...) e filtrar as Conversas.' : 'Nenhuma tag ainda. Peça para a gestão criar.' }));
    else {
      corpo = el('div', { class: 'tgs-cartao' },
        el('table', { class: 'tgs-tab' },
          el('thead', {}, el('tr', {}, ...['Tag', 'Grupo', 'Contatos', 'Último uso', 'Criada', ''].map((x, i) => el('th', { class: i === 2 ? 'tgs-num' : '', text: x })))),
          el('tbody', {}, ...lista.map((t) => el('tr', {},
            el('td', {}, el('span', { class: 'tgs-nome' }, ponto(t), el('span', { text: t.nome }))),
            el('td', { class: 'tgs-sub-txt', text: t.grupo || '—' }),
            el('td', { class: 'tgs-num' }, el('span', { text: (t.conversas || 0).toLocaleString('pt-BR') }), barrinha(t)),
            el('td', { class: 'tgs-sub-txt', text: quando(t.ultimoUso) }),
            el('td', { class: 'tgs-sub-txt', text: criada(t) || '—' }),
            el('td', {}, acoes(t)))))),
        el('div', { class: 'tgs-cartoes' }, ...lista.map((t) => el('div', { class: 'tgs-c' }, ponto(t), el('b', { text: t.nome }), acoes(t),
          el('small', { text: [contatos(t.conversas), t.grupo, quando(t.ultimoUso)].filter(Boolean).join(' · ') })))));
    }

    caixa.replaceChildren(el('div', { class: 'tgs-tela' },
      el('div', { class: 'tgs-cab' },
        el('div', {}, el('h1', { class: 'titulo-grande', text: 'Tags' }), el('p', { text: `${todos.length} ${todos.length === 1 ? 'tag' : 'tags'} · ${total.toLocaleString('pt-BR')} marcações · toque no ícone de pessoas para ver quem tem cada uma` })),
        pode ? el('button', { type: 'button', class: 'tgs-bt', onclick: () => editar(null) }, el('span', { html: SVG.mais, style: 'display:grid' }), 'Nova tag') : null),
      el('div', { class: 'tgs-barra' }, el('label', { class: 'tgs-busca', html: SVG.lupa }, busca), sel),
      chips, corpo));
  }

  window.SintoniaTelas.tags = {
    async desenhar(caixa, u) {
      estilo();
      T.caixa = caixa; caixa.classList.add('tgs-caixa');
      T.carregando = true; desenharTela();
      try { await carregar(true); } catch (x) { u.toast(x.message); }
      T.carregando = false; desenharTela();
    },
  };
})();
