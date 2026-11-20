/* Tela "Clientes" da Sintonia (clientes-tags): a casa de todos os contatos. Registra window.SintoniaTelas.clientes.
 * Abas no topo: Clientes (pessoas), Empresas (empresas ligadas aos contatos, pela ficha), Importar e Exportar
 * (estas duas vieram de Vendas › "Importar e exportar": a tela leads.js embutida; só a gestão).
 * Clientes: tabela densa no computador (busca, filtros de tag, etapa, unidade, origem e chegada, seleção em massa
 * para aplicar/tirar tag, mover etapa e exportar os selecionados); cartões no celular.
 * As pessoas vêm de /api/conversas (ui.estado.conversas: já com tags e origem); as empresas de /api/clientes/empresas.
 * Textos do servidor entram por textContent. Estilos em <style id="estilo-clientes">, prefixo .ct-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const POR_PAGINA = 50;
  const PERIODOS = [['', 'Qualquer data'], ['1', 'Chegou hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']];
  const ORIGENS = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', google_ads: 'Google', indicacao: 'Indicação', estabelecimento: 'Estabelecimento', desconhecido: 'Sem origem' };
  const CHAVE = 'sintonia.clientes.filtro';
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch { return {}; } };
  const s = { caixa: null, ui: null, aba: 'clientes', busca: '', pagina: 0, origem: '', tag: '', etapa: '', unidade: '', periodo: '', selecao: new Set(), modoSel: false, empresas: null, empBusca: '', empAberta: null, ...ler() };
  s.selecao = new Set(); s.modoSel = false; s.empresas = null;
  if (!['clientes', 'empresas', 'importar', 'exportar'].includes(s.aba)) s.aba = 'clientes';
  const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify({ aba: s.aba, origem: s.origem, tag: s.tag, etapa: s.etapa, unidade: s.unidade, periodo: s.periodo })); } catch { /* sem armazenamento */ } };

  const CSS = `
  .ct-caixa.ct-caixa { padding: 14px 16px 0; gap: 0; }
  @media (min-width: 761px) { .ct-caixa.ct-caixa { padding: 22px 28px 0; } }
  .ct { display: grid; gap: 14px; min-width: 0; padding-bottom: 36px; align-content: start; }
  @media (max-width: 760px) { .ct { padding-bottom: 120px; gap: 12px; } }
  .ct-cab { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; }
  .ct-cab h1.titulo-grande { margin: 0 !important; }
  .ct-cab p { margin: 4px 0 0; color: var(--sub); font-size: 14px; }
  .ct-abas { display: flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); width: max-content; max-width: 100%; overflow-x: auto; box-sizing: border-box; }
  @media (max-width: 760px) { .ct-abas { width: 100%; } .ct-abas button { flex: 1 1 0; } }
  .ct-abas button { all: unset; cursor: pointer; white-space: nowrap; padding: 8px 16px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  @media (max-width: 420px) { .ct-abas button { padding: 8px 8px; font-size: 13px; } }
  .ct-abas button[aria-selected="true"] { background: var(--vidro-ativo); color: var(--texto); box-shadow: 0 2px 10px rgba(0, 0, 0, .08); font-weight: 700; }
  .ct-abas button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -2px; }
  .ct-abas em { font-style: normal; font-size: 11.5px; font-weight: 700; color: var(--sub); }
  .ct-filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .ct-filtros select, .ct-busca { box-sizing: border-box; height: 40px; padding: 0 12px; border-radius: 10px; font: inherit; font-size: 14px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); min-width: 0; }
  .ct-filtros select { max-width: 190px; }
  .ct-filtros select.ct-ligado { border-color: var(--marca-azul); box-shadow: inset 0 0 0 1px var(--marca-azul); }
  html[data-tema="escuro"] .ct-filtros select { color-scheme: dark; }
  .ct-busca { flex: 1 1 240px; display: flex; align-items: center; gap: 8px; }
  .ct-busca input { all: unset; flex: 1; min-width: 0; font-size: 14px; color: var(--texto); }
  .ct-busca svg { width: 18px; height: 18px; color: var(--sub); flex: none; }
  @media (max-width: 760px) { .ct-filtros { flex-wrap: nowrap; overflow-x: auto; margin: 0 -16px; padding: 0 16px; } .ct-filtros .ct-busca { flex: 0 0 220px; } .ct-filtros .ct-busca:only-child { flex: 1 1 auto; } .ct-filtros select { flex: none; } }
  .ct-link { all: unset; cursor: pointer; font-size: 13.5px; font-weight: 600; color: var(--marca-azul); padding: 0 6px; white-space: nowrap; }
  html[data-tema="escuro"] .ct-link { color: #6cb8ff; }
  .ct-linha-info { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13.5px; color: var(--sub); min-height: 24px; }
  .ct-sel { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px 8px 16px; border-radius: 16px; background: var(--marca-tinta, #08243f); color: #fff; box-shadow: 0 10px 30px rgba(8, 36, 63, .25); }
  html[data-tema="escuro"] .ct-sel { background: #16395c; }
  .ct-sel b { font-size: 14px; margin-right: auto; }
  .ct-sel button { all: unset; cursor: pointer; height: 34px; padding: 0 12px; border-radius: 999px; font-size: 13.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; background: rgba(255, 255, 255, .12); color: #fff; }
  .ct-sel button:hover { background: rgba(255, 255, 255, .2); }
  .ct-sel button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .ct-sel button svg { width: 16px; height: 16px; }
  @media (max-width: 760px) { .ct-sel { position: fixed; left: 10px; right: 10px; bottom: calc(84px + env(safe-area-inset-bottom)); top: auto; z-index: 40; } .ct-sel b { flex-basis: 100%; } .ct-sel button { flex: 1 1 auto; justify-content: center; } }
  .ct-cartao { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); border-radius: 22px; overflow: hidden; min-width: 0; -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  .ct-rolar { overflow-x: auto; }
  .ct-tab { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  .ct-tab th { text-align: left; font-size: 11px; font-weight: 600; color: var(--sub); text-transform: uppercase; letter-spacing: .06em; padding: 10px 8px; border-bottom: 1px solid var(--vidro-linha); white-space: nowrap; position: sticky; top: 0; }
  .ct-tab td { padding: 6px 8px; border-bottom: 1px solid var(--vidro-linha); vertical-align: middle; white-space: nowrap; height: 40px; }
  .ct-tab tbody tr { cursor: pointer; }
  .ct-tab tbody tr:hover { background: var(--vidro-item); }
  .ct-tab tbody tr[aria-selected="true"] { background: color-mix(in srgb, var(--marca-azul) 10%, transparent); }
  .ct-tab tbody tr:last-child td { border-bottom: 0; }
  .ct-tab tbody tr:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -2px; }
  .ct-tab th:first-child, .ct-tab td:first-child { width: 36px; padding-left: 16px; padding-right: 4px; }
  .ct-caixinha { width: 17px; height: 17px; accent-color: var(--marca-azul); margin: 0; cursor: pointer; vertical-align: middle; }
  .ct-pessoa { display: flex; align-items: center; gap: 10px; min-width: 190px; max-width: 280px; }
  .ct-pessoa .avatar { width: 30px; height: 30px; flex: none; font-size: 12px; }
  .ct-pessoa span { display: grid; min-width: 0; }
  .ct-pessoa b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  .ct-pessoa small { font-size: 12px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; }
  .ct-tags { display: flex; gap: 4px; align-items: center; max-width: 220px; overflow: hidden; }
  .ct-tag { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; border-radius: 999px; padding: 2px 8px 2px 6px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; flex: none; }
  .ct-tag i { width: 7px; height: 7px; border-radius: 50%; background: var(--cor); flex: none; }
  .ct-tag-mais { font-size: 12px; color: var(--sub); font-weight: 600; flex: none; }
  .ct-tag-add { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; opacity: .55; }
  .ct-tag-add svg { width: 14px; height: 14px; }
  tr:hover .ct-tag-add, .ct-tag-add:focus-visible { opacity: 1; background: var(--vidro-ativo); }
  .ct-pilula { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12px; font-weight: 500; background: var(--vidro-item); border: 1px solid var(--vidro-borda); color: var(--texto); }
  .ct-pilula.ct-ia { background: color-mix(in srgb, var(--marca-menta) 18%, transparent); border-color: color-mix(in srgb, var(--marca-menta) 50%, transparent); }
  .ct-origem { display: inline-flex; align-items: center; gap: 6px; }
  .ct-sub { color: var(--sub); }
  .ct-paginas { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px; border-top: 1px solid var(--vidro-linha); font-size: 13.5px; color: var(--sub); flex-wrap: wrap; }
  .ct-paginas div { display: flex; gap: 6px; align-items: center; }
  .ct-bt { all: unset; box-sizing: border-box; cursor: pointer; min-height: 36px; padding: 0 14px; border-radius: 999px; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; background: var(--vidro-item); border: 1px solid var(--vidro-borda); color: var(--texto); }
  .ct-bt[disabled] { opacity: .4; pointer-events: none; }
  .ct-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .ct-bt svg { width: 17px; height: 17px; }
  .ct-bt.ct-forte { background: var(--marca-azul); border-color: var(--marca-azul); color: #fff; }
  .ct-vazio { padding: 40px 16px; text-align: center; color: var(--sub); font-size: 14.5px; line-height: 1.5; }
  .ct-vazio b { display: block; color: var(--texto); font-size: 16px; margin-bottom: 4px; }
  .ct-cartoes { display: none; }
  @media (max-width: 760px) {
    .ct-tab { display: none; }
    .ct-cartoes { display: grid; }
    .ct-c { display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; padding: 11px 14px; border-bottom: 1px solid var(--vidro-linha); cursor: pointer; }
    .ct-c:last-child { border-bottom: 0; }
    .ct-c[aria-selected="true"] { background: color-mix(in srgb, var(--marca-azul) 10%, transparent); }
    .ct-c > .ct-caixinha { grid-row: 1 / span 3; width: 20px; height: 20px; }
    .ct-c > .avatar { grid-row: 1 / span 3; width: 40px; height: 40px; }
    .ct-c b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; grid-column: 3; }
    .ct-c .ct-hora { grid-column: 4; font-size: 12px; color: var(--sub); }
    .ct-c small { grid-column: 3 / span 2; font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ct-c .ct-tags { grid-column: 3 / span 2; max-width: none; }
    .ct-c:not(.ct-com-sel) { grid-template-columns: auto minmax(0, 1fr) auto; }
    .ct-c:not(.ct-com-sel) b, .ct-c:not(.ct-com-sel) small, .ct-c:not(.ct-com-sel) .ct-tags { grid-column: 2 / span 1; }
    .ct-c:not(.ct-com-sel) .ct-hora { grid-column: 3; }
    .ct-c:not(.ct-com-sel) small, .ct-c:not(.ct-com-sel) .ct-tags { grid-column: 2 / span 2; }
  }
  /* empresas */
  .ct-emp-lin td:first-child { width: auto; padding-left: 16px; }
  .ct-emp-nome { display: flex; align-items: center; gap: 10px; min-width: 220px; }
  .ct-emp-ic { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; flex: none; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); font-weight: 700; font-size: 13px; }
  .ct-emp-nome span { display: grid; min-width: 0; }
  .ct-emp-nome b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
  .ct-emp-nome small { color: var(--sub); font-size: 12px; overflow: hidden; text-overflow: ellipsis; max-width: 320px; }
  .ct-emp-pessoas { display: flex; gap: 4px; flex-wrap: nowrap; overflow: hidden; max-width: 360px; }
  .ct-emp-det td { background: var(--vidro-item); padding: 6px 16px 12px 58px !important; height: auto; cursor: default; }
  .ct-emp-det tr:hover { background: none; }
  .ct-emp-contatos { display: grid; gap: 4px; }
  .ct-emp-contato { all: unset; cursor: pointer; display: grid; grid-template-columns: minmax(140px, 1.2fr) minmax(100px, 1fr) minmax(120px, 1fr) minmax(140px, 1.2fr); gap: 10px; padding: 7px 10px; border-radius: 10px; font-size: 13.5px; }
  .ct-emp-contato:hover, .ct-emp-contato:focus-visible { background: var(--vidro-ativo); }
  .ct-emp-contato[aria-disabled="true"] { cursor: default; }
  .ct-emp-contato span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 760px) {
    .ct-emp { display: grid; gap: 4px; padding: 12px 14px; border-bottom: 1px solid var(--vidro-linha); }
    .ct-emp:last-child { border-bottom: 0; }
    .ct-emp-contato { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 8px 10px; background: var(--vidro-item); }
    .ct-emp-contato span + span { font-size: 12.5px; color: var(--sub); }
  }
  `;
  const IC = {
    lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    tirar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><path d="m6 6 5 5"/></svg>',
    etapa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/></svg>',
    baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  function estilo() {
    if (document.getElementById('estilo-clientes')) return;
    const st = document.createElement('style'); st.id = 'estilo-clientes'; st.textContent = CSS; document.head.append(st);
  }

  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const data = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
  const ultimoContato = (c) => {
    const t = Math.max(...[c.ultimaMensagemCliente, c.ultimaMensagemEquipe, c.ultimaMensagemIa].map((x) => (x ? new Date(x).getTime() : 0)));
    return t ? new Date(t) : c.atualizadaEm ? new Date(c.atualizadaEm) : null;
  };
  const iconeOrigem = (c) => (c.origem && c.origem.icone) || window.SintoniaRastreio?.selo?.(c.id)?.icone || 'desconhecido';
  const nomeOrigem = (c) => ORIGENS[iconeOrigem(c)] || 'Sem origem';
  const atendente = (c) => (c.modo === 'ia' ? 'IA' : c.responsavelNome || '—');
  const gestor = () => { const u = s.ui; return !u.estado.eu || u.ehGestor(u.estado.eu); };
  const podeImportar = () => { const eu = s.ui.estado.eu; return !eu || (gestor() && (eu.permissoes ? eu.permissoes.importar_leads !== false : true)); };
  const contatos = (n) => (n === 1 ? '1 contato' : `${Number(n || 0).toLocaleString('pt-BR')} contatos`);
  const pessoas = () => (s.ui.estado.conversas || []);
  const empresaDe = (() => { let mapa = new Map(), de = null; return (tel) => { if (de !== s.empresas) { de = s.empresas; mapa = new Map(); for (const e of s.empresas || []) for (const c of e.contatos) mapa.set(c.telefone, e.nome); } return mapa.get(tel); }; })();

  function filtradas() {
    const q = semAcento(s.busca); const qd = s.busca.replace(/\D/g, '');
    const desde = s.periodo ? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (Number(s.periodo) - 1)); return d.getTime(); })() : 0;
    return pessoas().filter((c) => {
      if (q && !(semAcento(c.nome).includes(q) || (qd.length >= 3 && String(c.telefone).includes(qd)) || semAcento(empresaDe(c.telefone)).includes(q) || (c.tags || []).some((t) => semAcento(t.nome) === q))) return false;
      if (s.unidade && c.unidade !== s.unidade) return false;
      if (s.etapa && c.etapa !== s.etapa) return false;
      if (s.tag && !(c.tags || []).some((t) => t.id === s.tag)) return false;
      if (s.origem && iconeOrigem(c) !== s.origem) return false;
      if (desde && !(c.criadaEm && new Date(c.criadaEm).getTime() >= desde)) return false;
      return true;
    }).sort((a, b) => new Date(b.criadaEm || 0) - new Date(a.criadaEm || 0));
  }

  // ---------- exportar ----------
  function csvLocal(lista) {
    const u = s.ui;
    const esc = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const linhas = [['Nome', 'Telefone', 'Empresa', 'Origem', 'Chegada', 'Último contato', 'Etapa', 'Atendente', 'Unidade', 'Tags']]
      .concat(lista.map((c) => [c.nome || '', c.telefone, empresaDe(c.telefone) || '', nomeOrigem(c), data(c.criadaEm), data(ultimoContato(c)), u.NOME_ETAPA[c.etapa] || c.etapa || '', atendente(c), u.UNIDADE[c.unidade] || c.unidade || '', (c.tags || []).map((t) => t.nome).join(', ')]));
    baixar(new Blob(['﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `clientes-${new Date().toISOString().slice(0, 10)}.csv`);
  }
  function baixar(blob, nome) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function exportar(lista) {
    const u = s.ui;
    if (!lista.length) return;
    // Gestão: o CSV completo do servidor (e-mail e campos da ficha). Equipe: o que está na tela.
    if (podeImportar() && lista.length <= 5000) {
      try {
        const r = await fetch('/api/leads/exportar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: lista.map((c) => c.id) }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Não deu para exportar.');
        baixar(await r.blob(), `clientes-${new Date().toISOString().slice(0, 10)}.csv`);
      } catch (x) { u.toast(x.message); return; }
    } else csvLocal(lista);
    u.toast(`${contatos(lista.length)} exportado${lista.length === 1 ? '' : 's'} ✓`);
  }

  // ---------- ações em massa ----------
  const selecionadas = () => pessoas().filter((c) => s.selecao.has(c.id));
  async function aplicarTag(tirar) {
    const u = s.ui; const ids = [...s.selecao];
    const qtd = contatos(ids.length);
    const t = await window.SintoniaTags?.escolher({ titulo: tirar ? 'Tirar tag' : 'Aplicar tag', sub: `${qtd} selecionado${ids.length === 1 ? '' : 's'}` });
    if (!t) return;
    try {
      const r = await u.post(`/api/tags/${t.id}/conversas`, { ids, acao: tirar ? 'desmarcar' : 'marcar' });
      u.toast(tirar ? `“${t.nome}” saiu de ${contatos(r.mudaram)} ✓` : `“${t.nome}” em ${contatos(r.mudaram)} ✓${r.mudaram < ids.length - r.ignoradas ? ' (os outros já tinham)' : ''}`);
      window.SintoniaTags?.invalidar();
      u.estado.assinatura = ''; await u.atualizar?.(); desenhar();
    } catch (x) { u.toast(x.message); }
  }
  function escolherOpcao(titulo, sub, opcoes) {
    // Lista simples numa janela (mesmo visual do seletor de tags).
    return new Promise((ok) => {
      const u = s.ui; const el = u.el; let valor = null;
      window.SintoniaTags?.estilo?.();
      const d = el('dialog', { class: 'tgs-dlg', 'aria-label': titulo });
      const folha = el('div', { class: 'tgs-folha' },
        el('div', { class: 'tgs-topo' }, el('h2', { text: titulo }), el('button', { type: 'button', class: 'tgs-x', 'aria-label': 'Fechar', html: IC.x, onclick: () => d.close() })),
        sub ? el('p', { class: 'tgs-sub', text: sub }) : null,
        el('div', { class: 'tgs-lista' }, ...opcoes.map((o) => { const b = el('button', { type: 'button', class: 'tgs-op', onclick: () => { valor = o.valor; d.close(); } }, el('i', { class: 'tgs-ponto' }), el('span', { class: 'tgs-txt' }, el('b', { text: o.nome }), o.info ? el('small', { text: o.info }) : null)); b.style.setProperty('--cor', o.cor || 'var(--marca-azul)'); return b; })));
      d.append(folha);
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      d.addEventListener('close', () => { d.remove(); ok(valor); });
      document.body.append(d); d.showModal();
    });
  }
  async function moverEtapa() {
    const u = s.ui; const ids = [...s.selecao]; const qtd = contatos(ids.length);
    let funis;
    try { funis = (await u.api('/api/funis')).filter((f) => f.etapas?.length); } catch (x) { return u.toast(x.message); }
    if (!funis.length) return u.toast('Nenhum funil com etapas.');
    const f = funis.length === 1 ? funis[0] : await escolherOpcao('Mover para qual funil?', qtd, funis.map((x) => ({ nome: x.nome, info: `${x.etapas.length} etapas`, valor: x })));
    if (!f) return;
    const etapa = await escolherOpcao('Mover para a etapa', `${qtd} · ${f.nome}`, f.etapas.map((x) => ({ nome: x.nome, cor: x.cor, valor: x })));
    if (!etapa) return;
    let ok = 0, falhou = 0;
    for (let i = 0; i < ids.length; i += 8) {
      const r = await Promise.allSettled(ids.slice(i, i + 8).map((id) => u.post(`/api/conversas/${id}/funis/${f.id}`, { etapaId: etapa.id })));
      for (const x of r) x.status === 'fulfilled' ? ok++ : falhou++;
    }
    u.toast(`${contatos(ok)} em ${etapa.nome} ✓${falhou ? ` · ${falhou} não deu` : ''}`);
    u.estado.assinatura = ''; await u.atualizar?.(); desenhar();
  }

  // ---------- desenho ----------
  function desenhar() {
    const u = s.ui; const el = u.el; const caixa = s.caixa;
    if (!caixa) return;
    const ativo = document.activeElement;
    const focoBusca = ativo && caixa.contains(ativo) && ativo.dataset?.busca ? { k: ativo.dataset.busca, pos: ativo.selectionStart } : null;
    const comImport = podeImportar();
    if (!comImport && (s.aba === 'importar' || s.aba === 'exportar')) s.aba = 'clientes';
    const total = pessoas().length;
    const abas = [['clientes', 'Clientes', total], ['empresas', 'Empresas', s.empresas ? s.empresas.length : null], ...(comImport ? [['importar', 'Importar'], ['exportar', 'Exportar']] : [])];
    const barraAbas = el('div', { class: 'ct-abas', role: 'tablist', 'aria-label': 'Clientes' }, ...abas.map(([k, n, q]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(s.aba === k), onclick: () => irAba(k) }, n, q != null && q !== '' ? el('em', { text: Number(q).toLocaleString('pt-BR') }) : null)));
    const sub = s.aba === 'empresas' ? 'Empresas ligadas aos contatos (preencha “Empresa” na ficha do contato).' : s.aba === 'importar' ? 'Traga contatos de uma planilha e junte os repetidos. Ninguém recebe mensagem.' : s.aba === 'exportar' ? 'Baixe os contatos em CSV, que abre direto no Excel.' : 'Todos os contatos que você pode ver. Toque em um para abrir a conversa.';
    const cab = el('div', { class: 'ct-cab' }, el('div', {}, el('h1', { class: 'titulo-grande', text: 'Clientes' }), el('p', { text: sub })));
    const partes = [cab, barraAbas];
    if (s.aba === 'clientes') partes.push(...abaClientes());
    else if (s.aba === 'empresas') partes.push(...abaEmpresas());
    else { const casa = el('div', { style: 'min-width:0' }); partes.push(casa); setTimeout(() => embutirLeads(casa), 0); }
    caixa.replaceChildren(el('div', { class: 'ct' }, ...partes));
    if (focoBusca) { const i = caixa.querySelector(`[data-busca="${focoBusca.k}"]`); i?.focus(); try { i?.setSelectionRange(focoBusca.pos, focoBusca.pos); } catch { /* campo search */ } }
  }

  function embutirLeads(casa) {
    const leads = window.SintoniaTelas.leads;
    if (!leads || !casa.isConnected) return;
    if (s.aba === 'importar') leads.desenhar(casa, s.ui, { embutido: true, abas: ['importar', 'duplicatas'], nomes: { importar: 'Importar planilha', duplicatas: 'Contatos repetidos' } });
    else leads.desenhar(casa, s.ui, { embutido: true, abas: ['exportar'], aba: 'exportar' });
  }

  function abaClientes() {
    const u = s.ui; const el = u.el;
    const sel = (rot, chave, opcoes) => {
      const x = el('select', { 'aria-label': rot, class: s[chave] ? 'ct-ligado' : '' }, ...opcoes.map(([v, n]) => el('option', { value: v, text: n })));
      x.value = s[chave]; if (x.value !== s[chave]) { s[chave] = ''; x.value = ''; }
      x.addEventListener('change', () => { s[chave] = x.value; s.pagina = 0; s.selecao.clear(); gravar(); desenhar(); });
      return x;
    };
    const busca = el('input', { type: 'search', placeholder: 'Buscar por nome, telefone, empresa ou tag', 'aria-label': 'Buscar cliente', 'data-busca': 'p', value: s.busca });
    busca.addEventListener('input', () => { s.busca = busca.value; s.pagina = 0; desenhar(); });
    const origens = [...new Set(pessoas().map(iconeOrigem))].sort((a, b) => (ORIGENS[a] || a).localeCompare(ORIGENS[b] || b, 'pt-BR'));
    const unidades = [...new Set(pessoas().map((c) => c.unidade).filter(Boolean))];
    const tags = (window.SintoniaTags?.dados.tags.length ? window.SintoniaTags.dados.tags : u.estado.tags || []).filter((t) => !t.funilId);
    const algum = s.busca || s.tag || s.etapa || s.unidade || s.origem || s.periodo;
    const filtros = el('div', { class: 'ct-filtros' },
      el('label', { class: 'ct-busca', html: IC.lupa }, busca),
      sel('Tag', 'tag', [['', 'Todas as tags'], ...tags.map((t) => [t.id, t.nome])]),
      sel('Etapa', 'etapa', [['', 'Todas as etapas'], ...u.ETAPAS.map((e) => (Array.isArray(e) ? e : [e, u.NOME_ETAPA[e] || e]))]),
      unidades.length > 1 ? sel('Unidade', 'unidade', [['', 'Todas as unidades'], ...unidades.map((x) => [x, u.UNIDADE[x] || x])]) : null,
      sel('Origem', 'origem', [['', 'Todas as origens'], ...origens.map((o) => [o, ORIGENS[o] || o])]),
      sel('Chegada', 'periodo', PERIODOS),
      algum ? el('button', { type: 'button', class: 'ct-link', text: 'Limpar filtros', onclick: () => { Object.assign(s, { busca: '', tag: '', etapa: '', unidade: '', origem: '', periodo: '', pagina: 0 }); s.selecao.clear(); gravar(); desenhar(); } }) : null);

    const lista = filtradas();
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    if (s.pagina >= paginas) s.pagina = paginas - 1;
    const ini = s.pagina * POR_PAGINA;
    const pedaco = lista.slice(ini, ini + POR_PAGINA);
    for (const id of [...s.selecao]) if (!pessoas().some((c) => c.id === id)) s.selecao.delete(id);
    const nSel = s.selecao.size;
    const todasMarcadas = lista.length > 0 && lista.every((c) => s.selecao.has(c.id));

    const info = el('div', { class: 'ct-linha-info' },
      el('span', { text: lista.length === pessoas().length ? contatos(lista.length) : `${contatos(lista.length)} de ${pessoas().length.toLocaleString('pt-BR')}` }),
      el('span', { style: 'display:flex;gap:4px;align-items:center' },
        matchMedia('(max-width: 760px)').matches ? el('button', { type: 'button', class: 'ct-link', text: s.modoSel ? 'Cancelar seleção' : 'Selecionar', onclick: () => { s.modoSel = !s.modoSel; if (!s.modoSel) s.selecao.clear(); desenhar(); } }) : null,
        lista.length ? el('button', { type: 'button', class: 'ct-link', text: 'Exportar estes', title: 'Baixar em CSV os contatos com estes filtros', onclick: () => exportar(lista) }) : null));

    const barraSel = nSel ? el('div', { class: 'ct-sel', role: 'region', 'aria-label': 'Ações nos selecionados' },
      el('b', { text: `${nSel.toLocaleString('pt-BR')} selecionado${nSel === 1 ? '' : 's'}` }),
      el('button', { type: 'button', onclick: () => aplicarTag(false) }, el('span', { html: IC.tag, style: 'display:grid' }), 'Aplicar tag'),
      el('button', { type: 'button', onclick: () => aplicarTag(true) }, el('span', { html: IC.tirar, style: 'display:grid' }), 'Tirar tag'),
      el('button', { type: 'button', onclick: moverEtapa }, el('span', { html: IC.etapa, style: 'display:grid' }), 'Mover etapa'),
      el('button', { type: 'button', onclick: () => exportar(selecionadas()) }, el('span', { html: IC.baixar, style: 'display:grid' }), 'Exportar'),
      el('button', { type: 'button', 'aria-label': 'Limpar seleção', title: 'Limpar seleção', onclick: () => { s.selecao.clear(); s.modoSel = false; desenhar(); } }, el('span', { html: IC.x, style: 'display:grid' }))) : null;

    let corpo;
    if (!lista.length) {
      corpo = el('div', { class: 'ct-cartao' }, el('div', { class: 'ct-vazio' }, pessoas().length ? el('b', { text: 'Ninguém com esses filtros.' }) : el('b', { text: 'Nenhum contato ainda.' }),
        el('span', { text: pessoas().length ? 'Mude ou limpe os filtros.' : 'Assim que alguém chamar no WhatsApp, aparece aqui. Também dá para importar uma planilha na aba Importar.' })));
    } else {
      const alternar = (c, sim) => { sim ? s.selecao.add(c.id) : s.selecao.delete(c.id); desenhar(); };
      const caixinha = (c) => { const x = el('input', { type: 'checkbox', class: 'ct-caixinha', 'aria-label': `Selecionar ${u.nomeDe(c)}` }); x.checked = s.selecao.has(c.id); x.addEventListener('click', (e) => e.stopPropagation()); x.addEventListener('change', () => alternar(c, x.checked)); return x; };
      const tagsEl = (c, comAdd) => {
        const ts = c.tags || []; const max = 3;
        const pilulas = ts.slice(0, max).map((t) => { const p = el('span', { class: 'ct-tag', title: t.nome }, el('i'), el('span', { text: t.nome })); p.style.setProperty('--cor', t.cor); return p; });
        return el('span', { class: 'ct-tags' }, ...pilulas, ts.length > max ? el('span', { class: 'ct-tag-mais', text: `+${ts.length - max}` }) : null,
          comAdd ? el('button', { type: 'button', class: 'ct-tag-add', title: 'Tags deste contato', 'aria-label': `Tags de ${u.nomeDe(c)}`, html: IC.mais, onclick: (e) => { e.stopPropagation(); tagsDe(c); } }) : null);
      };
      const cabCaixa = el('input', { type: 'checkbox', class: 'ct-caixinha', 'aria-label': todasMarcadas ? 'Desmarcar todos' : `Selecionar todos os ${lista.length}`, title: `Selecionar todos os ${lista.length} com estes filtros` });
      cabCaixa.checked = todasMarcadas; cabCaixa.indeterminate = !todasMarcadas && lista.some((c) => s.selecao.has(c.id));
      cabCaixa.addEventListener('change', () => { if (cabCaixa.checked) for (const c of lista) s.selecao.add(c.id); else for (const c of lista) s.selecao.delete(c.id); desenhar(); });
      const tabela = el('table', { class: 'ct-tab' },
        el('thead', {}, el('tr', {}, el('th', {}, cabCaixa), ...['Nome', 'Telefone', 'Tags', 'Etapa', 'Origem', 'Atende', 'Chegou', 'Última msg.'].map((t) => el('th', { text: t })))),
        el('tbody', {}, ...pedaco.map((c) => {
          const emp = empresaDe(c.telefone);
          const tr = el('tr', { tabindex: '0', 'aria-selected': String(s.selecao.has(c.id)), title: `Abrir a conversa com ${u.nomeDe(c)}` },
            el('td', {}, caixinha(c)),
            el('td', {}, el('span', { class: 'ct-pessoa' }, u.avatar(c, 'p'), el('span', {}, el('b', { text: c.nome || u.formatarTel(c.telefone) }), emp ? el('small', { text: emp }) : null))),
            el('td', { class: 'ct-sub', text: u.formatarTel(c.telefone) }),
            el('td', {}, tagsEl(c, true)),
            el('td', {}, el('span', { class: 'ct-pilula', text: u.NOME_ETAPA[c.etapa] || c.etapa || '—' })),
            el('td', {}, el('span', { class: 'ct-origem' }, window.SintoniaRastreio ? window.SintoniaRastreio.iconeEl(c.origem || c.id) : null, el('span', { text: nomeOrigem(c) }))),
            el('td', {}, c.modo === 'ia' ? el('span', { class: 'ct-pilula ct-ia', text: 'IA' }) : el('span', { class: 'ct-sub', text: atendente(c) })),
            el('td', { class: 'ct-sub', text: data(c.criadaEm) }),
            el('td', { class: 'ct-sub', text: u.horaLista(ultimoContato(c)) || '—' }));
          tr.addEventListener('click', () => (nSel ? alternar(c, !s.selecao.has(c.id)) : u.abrir(c.id)));
          tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') u.abrir(c.id); if (e.key === ' ') { e.preventDefault(); alternar(c, !s.selecao.has(c.id)); } });
          return tr;
        })));
      const cartoes = el('div', { class: 'ct-cartoes' }, ...pedaco.map((c) => {
        const emp = empresaDe(c.telefone);
        const linha = el('div', { class: 'ct-c' + (s.modoSel ? ' ct-com-sel' : ''), role: 'button', tabindex: '0', 'aria-selected': String(s.selecao.has(c.id)) },
          s.modoSel ? caixinha(c) : null, u.avatar(c, 'p'),
          el('b', { text: c.nome || u.formatarTel(c.telefone) }), el('span', { class: 'ct-hora', text: u.horaLista(ultimoContato(c)) || '' }),
          el('small', { text: [u.NOME_ETAPA[c.etapa] || c.etapa, emp, nomeOrigem(c)].filter(Boolean).join(' · ') }),
          (c.tags || []).length ? tagsEl(c, false) : null);
        linha.addEventListener('click', () => (s.modoSel ? alternar(c, !s.selecao.has(c.id)) : u.abrir(c.id)));
        return linha;
      }));
      const ir = (p) => { s.pagina = p; desenhar(); s.caixa.scrollTo?.(0, 0); };
      corpo = el('div', { class: 'ct-cartao' }, el('div', { class: 'ct-rolar' }, tabela), cartoes,
        paginas > 1 ? el('div', { class: 'ct-paginas' },
          el('span', { text: `${ini + 1}–${ini + pedaco.length} de ${lista.length.toLocaleString('pt-BR')}` }),
          el('div', {},
            el('button', { class: 'ct-bt', type: 'button', text: 'Anterior', disabled: s.pagina === 0 ? '' : null, onclick: () => ir(s.pagina - 1) }),
            el('span', { text: `${s.pagina + 1} de ${paginas}` }),
            el('button', { class: 'ct-bt', type: 'button', text: 'Próxima', disabled: s.pagina >= paginas - 1 ? '' : null, onclick: () => ir(s.pagina + 1) }))) : null);
    }
    return [filtros, barraSel, info, corpo].filter(Boolean);
  }

  async function tagsDe(c) {
    await window.SintoniaTags?.daConversa(c.id, { titulo: 'Tags', sub: s.ui.nomeDe(c), aoMudar: (tags) => { c.tags = tags; } });
    desenhar();
  }

  function abaEmpresas() {
    const u = s.ui; const el = u.el;
    if (!s.empresas) { carregarEmpresas(); return [el('div', { class: 'ct-cartao', style: 'height:200px' })]; }
    const busca = el('input', { type: 'search', placeholder: 'Buscar empresa, CNPJ ou pessoa', 'aria-label': 'Buscar empresa', 'data-busca': 'e', value: s.empBusca });
    busca.addEventListener('input', () => { s.empBusca = busca.value; desenhar(); });
    const q = semAcento(s.empBusca); const qd = s.empBusca.replace(/\D/g, '');
    const lista = s.empresas.filter((e) => !q || semAcento(e.nome).includes(q) || semAcento(e.razaoSocial).includes(q) || (qd.length >= 3 && String(e.cnpj || '').replace(/\D/g, '').includes(qd)) || e.contatos.some((c) => semAcento(c.nome).includes(q)));
    const iniciais = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    const contato = (c) => el('button', { type: 'button', class: 'ct-emp-contato', 'aria-disabled': c.conversaId ? null : 'true', title: c.conversaId ? 'Abrir a conversa' : 'Contato sem conversa', onclick: () => c.conversaId && u.abrir(c.conversaId) },
      el('span', { text: c.nome || u.formatarTel(c.telefone), style: 'font-weight:600' }), el('span', { class: 'ct-sub', text: c.cargo || '—' }), el('span', { class: 'ct-sub', text: u.formatarTel(c.telefone) }), el('span', { class: 'ct-sub', text: c.email || '' }));
    let corpo;
    if (!s.empresas.length) corpo = el('div', { class: 'ct-cartao' }, el('div', { class: 'ct-vazio' }, el('b', { text: 'Nenhuma empresa ainda.' }), el('span', { text: 'Na ficha do contato, marque “Pessoa jurídica” e preencha a empresa (nome, CNPJ, cargo). Contatos da mesma empresa aparecem juntos aqui.' })));
    else if (!lista.length) corpo = el('div', { class: 'ct-cartao' }, el('div', { class: 'ct-vazio', text: 'Nenhuma empresa com essa busca.' }));
    else {
      const linhas = [];
      for (const e of lista) {
        const aberta = s.empAberta === e.chave;
        const tr = el('tr', { class: 'ct-emp-lin', tabindex: '0', 'aria-expanded': String(aberta), title: aberta ? 'Fechar' : 'Ver os contatos' },
          el('td', {}, el('span', { class: 'ct-emp-nome' }, el('i', { class: 'ct-emp-ic', text: iniciais(e.nome), 'aria-hidden': 'true', style: 'font-style:normal' }), el('span', {}, el('b', { text: e.nome }), e.razaoSocial && e.razaoSocial !== e.nome ? el('small', { text: e.razaoSocial }) : null))),
          el('td', { class: 'ct-sub', text: e.cnpj || '—' }),
          el('td', { text: contatos(e.total) }),
          el('td', {}, el('span', { class: 'ct-emp-pessoas' }, ...e.contatos.slice(0, 3).map((c) => el('span', { class: 'ct-pilula', text: c.nome || u.formatarTel(c.telefone) })), e.contatos.length > 3 ? el('span', { class: 'ct-tag-mais', text: `+${e.contatos.length - 3}` }) : null)),
          el('td', { class: 'ct-sub', text: e.site || '' }));
        const alternar = () => { s.empAberta = aberta ? null : e.chave; desenhar(); };
        tr.addEventListener('click', alternar);
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') alternar(); });
        linhas.push(tr);
        if (aberta) linhas.push(el('tr', { class: 'ct-emp-det' }, el('td', { colspan: '5' }, el('div', { class: 'ct-emp-contatos' }, ...e.contatos.map(contato)))));
      }
      const cartoes = el('div', { class: 'ct-cartoes' }, ...lista.map((e) => {
        const aberta = s.empAberta === e.chave;
        const d = el('div', { class: 'ct-emp' },
          el('button', { type: 'button', class: 'ct-emp-contato', style: 'background:none;padding:0', 'aria-expanded': String(aberta), onclick: () => { s.empAberta = aberta ? null : e.chave; desenhar(); } },
            el('span', { class: 'ct-emp-nome' }, el('i', { class: 'ct-emp-ic', text: iniciais(e.nome), style: 'font-style:normal' }), el('span', {}, el('b', { text: e.nome }), el('small', { text: [contatos(e.total), e.cnpj].filter(Boolean).join(' · ') })))));
        if (aberta) d.append(el('div', { class: 'ct-emp-contatos' }, ...e.contatos.map(contato)));
        return d;
      }));
      corpo = el('div', { class: 'ct-cartao' }, el('div', { class: 'ct-rolar' }, el('table', { class: 'ct-tab' },
        el('thead', {}, el('tr', {}, ...['Empresa', 'CNPJ', 'Contatos', 'Pessoas', 'Site'].map((t, i) => el('th', { text: t, style: i === 0 ? 'padding-left:16px' : '' })))),
        el('tbody', {}, ...linhas))), cartoes);
    }
    return [el('div', { class: 'ct-filtros' }, el('label', { class: 'ct-busca', html: IC.lupa }, busca)),
      el('div', { class: 'ct-linha-info' }, el('span', { text: `${lista.length} ${lista.length === 1 ? 'empresa' : 'empresas'}` })), corpo];
  }

  let buscandoEmpresas = null;
  function carregarEmpresas() {
    if (buscandoEmpresas) return buscandoEmpresas;
    buscandoEmpresas = s.ui.api('/api/clientes/empresas').then((r) => { s.empresas = r.empresas || []; }).catch(() => { s.empresas = s.empresas || []; })
      .finally(() => { buscandoEmpresas = null; if (s.caixa?.isConnected && s.ui.estado.vista === 'clientes') desenhar(); });
    return buscandoEmpresas;
  }

  /** Troca a aba (e, se vier, aplica filtros: { tag }). Usado pela tela Tags e pela rota antiga "leads". */
  function irAba(aba, filtros) {
    if (aba) s.aba = aba;
    if (filtros) { Object.assign(s, { busca: '', etapa: '', unidade: '', origem: '', periodo: '', tag: '' }, filtros); s.pagina = 0; s.selecao.clear(); s.modoSel = false; }
    gravar();
    if (s.caixa && s.ui?.estado.vista === 'clientes') desenhar();
  }

  window.SintoniaTelas.clientes = {
    irAba,
    desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa; s.ui = ui;
      caixa.classList.add('ct-caixa');
      desenhar();
      // Tags com contagem (filtro e seletor) e empresas (coluna e aba): chegam depois, sem travar a tela.
      window.SintoniaTags?.carregar().then(() => { if (s.aba === 'clientes') desenhar(); }).catch(() => {});
      s.empresas = null; carregarEmpresas();
    },
  };
})();
