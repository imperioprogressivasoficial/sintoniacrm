/* Tela "leads" da Sintonia: registra window.SintoniaTelas.leads = { desenhar(caixa, ui) }.
 * Três abas (só gestão): Exportar (CSV para o Excel com filtros), Importar (arquivo CSV ou planilha colada,
 * mapeamento de colunas, prévia e relatório) e Duplicatas (detectar, mesclar, "não é duplicata").
 * Importar nunca envia mensagem para ninguém. Estilos em <style id="estilo-leads">, prefixo .ld-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ABAS = [['exportar', 'Exportar'], ['importar', 'Importar'], ['duplicatas', 'Duplicatas']];
  const CHAVE = 'sintonia.leads.aba';
  const MAX_LINHAS = 5000;

  const CSS = `
  .ld-caixa.ld-caixa { grid-template-columns: minmax(0, 1fr); overflow-x: hidden; padding: 14px 16px 0; gap: 0; }
  .ld { --acento: var(--marca-menta); --acento-suave: color-mix(in srgb, var(--marca-menta) 14%, transparent);
        display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-bottom: 28px; min-width: 0; max-width: 1000px; width: 100%; margin: 0 auto; }
  @media (max-width: 760px) { .ld { padding-bottom: 110px; } }
  .ld-vidro, .ld-bloco, .ld-grupo, .ld-vazio, .ld-abas { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%); }
  .ld-topo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 30px; }
  .ld-topo h1.titulo-grande { margin: 0 !important; font-size: 38px; letter-spacing: -.03em; }
  .ld-topo h1 small { display: block; font-size: 13.5px; font-weight: 600; color: var(--sub); letter-spacing: 0; margin-top: 2px; }
  .ld-numeros { display: flex; gap: 22px; overflow-x: auto; scrollbar-width: none; flex: 1 1 auto; min-width: 0; padding: 2px; }
  .ld-numeros::-webkit-scrollbar { display: none; }
  @media (max-width: 760px) { .ld-numeros { flex-basis: 100%; margin: 0 -16px; padding: 2px 16px; } }
  .ld-n { display: flex; align-items: center; gap: 10px; flex: none; }
  .ld-circ { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box; }
  .ld-circ svg { width: 19px; height: 19px; }
  .ld-n b { display: block; font-size: 22px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .ld-n small { display: block; font-size: 12px; color: var(--sub); white-space: nowrap; }
  .ld-abas { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-radius: 999px; padding: 4px; gap: 2px; }
  .ld-abas button { all: unset; cursor: pointer; text-align: center; padding: 10px 6px; border-radius: 999px; font-size: 14.5px; font-weight: 600; color: var(--sub); display: flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid transparent; transition: background .18s, color .18s; }
  .ld-abas button[aria-selected="true"] { background: var(--vidro-ativo); color: var(--texto); border-color: var(--vidro-borda); box-shadow: 0 2px 10px rgba(0, 0, 0, .08); font-weight: 700; }
  .ld-abas button:focus-visible, .ld-botao:focus-visible, .ld-link:focus-visible, .ld-arquivo:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
  .ld-abas .ld-qtd { font-size: 11.5px; min-width: 18px; height: 18px; border-radius: 9px; background: var(--acento); color: #fff; display: inline-grid; place-items: center; padding: 0 5px; font-weight: 800; }
  .ld-bloco { border-radius: 24px; padding: 18px; display: grid; gap: 14px; min-width: 0; }
  .ld-bloco h2 { margin: 0; font-size: 15px; font-weight: 700; }
  .ld-bloco h2 small { display: block; font-size: 12.5px; color: var(--sub); font-weight: 500; margin-top: 3px; line-height: 1.4; }
  .ld-campos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .ld-campo { display: grid; gap: 5px; font-size: 12px; color: var(--sub); font-weight: 700; min-width: 0; }
  .ld-campo select, .ld-campo input:not([type=checkbox]), .ld-campo textarea { font: inherit; font-size: 15px; font-weight: 600; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 14px; padding: 11px 12px; min-width: 0; width: 100%; box-sizing: border-box; min-height: 44px; }
  .ld-campo textarea { min-height: 120px; resize: vertical; font-family: ui-monospace, Menlo, monospace; font-size: 13px; font-weight: 500; }
  .ld-campo select option { color: #08243f; }
  .ld-periodo { grid-column: 1 / -1; max-width: 560px; }
  .ld-periodo > div { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 8px; align-items: center; }
  .ld-periodo > div span { color: var(--sub); font-weight: 500; }
  html[data-tema="escuro"] .ld input, html[data-tema="escuro"] .ld select, html[data-tema="escuro"] .ld textarea { color-scheme: dark; }
  @media (prefers-color-scheme: dark) { html:not([data-tema="claro"]) .ld input, html:not([data-tema="claro"]) .ld select { color-scheme: dark; } }
  .ld-marcar { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; line-height: 1.35; cursor: pointer; }
  .ld-marcar input { width: 20px; height: 20px; accent-color: var(--acento); margin: 0; flex: none; }
  .ld-marcar small { display: block; color: var(--sub); font-size: 12.5px; }
  .ld-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .ld-botao { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; box-sizing: border-box; background: var(--acento); color: #fff; font-weight: 800; font-size: 15px; padding: 0 22px; border-radius: 999px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 35%, transparent), 0 6px 22px color-mix(in srgb, var(--marca-menta) 35%, transparent); text-align: center; transition: transform .18s; }
  .ld-botao:hover { transform: translateY(-1px); }
  .ld-botao svg { width: 18px; height: 18px; }
  .ld-botao.ld-leve { background: var(--vidro-item); color: var(--texto); box-shadow: none; border: 1px solid var(--vidro-borda); font-weight: 700; }
  .ld-botao[aria-disabled="true"] { opacity: .5; pointer-events: none; }
  @media (max-width: 560px) { .ld-acoes .ld-botao { flex: 1 1 100%; } }
  .ld-total { display: flex; align-items: baseline; gap: 8px; }
  .ld-total b { font-size: 34px; font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  .ld-total span { color: var(--sub); font-size: 14px; }
  .ld-lista { display: grid; }
  .ld-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 10px 0; border-bottom: 1px solid var(--vidro-linha); font-size: 14px; }
  .ld-item:last-child { border-bottom: 0; }
  .ld-item b { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ld-item span { color: var(--sub); font-size: 13px; }
  .ld-item .ld-dir { text-align: right; }
  .ld-nota { font-size: 13px; color: var(--sub); line-height: 1.45; }
  .ld-erro { color: #e5484d; font-size: 14px; }
  .ld-arquivo { border: 1.5px dashed var(--vidro-borda); border-radius: 18px; padding: 20px; display: grid; gap: 8px; justify-items: center; text-align: center; cursor: pointer; color: var(--sub); font-size: 14px; background: var(--vidro-item); }
  .ld-arquivo b { color: var(--texto); font-size: 15.5px; }
  .ld-arquivo svg { width: 30px; height: 30px; color: var(--acento); }
  .ld-arquivo.ld-sobre { border-color: var(--acento); background: var(--acento-suave); }
  .ld-ou { text-align: center; font-size: 12.5px; color: var(--sub); font-weight: 600; }
  .ld-mapa { display: grid; gap: 8px; }
  .ld-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, 220px); gap: 4px 12px; align-items: center; padding: 10px 12px; border-radius: 16px; background: var(--vidro-item); }
  .ld-col b { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ld-col span { grid-column: 1; font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ld-col select { grid-column: 2; grid-row: 1 / span 2; font: inherit; font-size: 14px; font-weight: 600; color: var(--texto); background: var(--vidro-ativo); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 9px; min-width: 0; min-height: 40px; }
  .ld-col select option { color: #08243f; }
  .ld-col.ld-ignorada b { color: var(--sub); }
  @media (max-width: 480px) { .ld-col { grid-template-columns: minmax(0, 1fr); } .ld-col select { grid-column: 1; grid-row: auto; } }
  .ld-numeros-res { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  @media (max-width: 480px) { .ld-numeros-res { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .ld-num { border-radius: 16px; background: var(--vidro-item); padding: 11px 12px; display: grid; gap: 2px; }
  .ld-num b { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .ld-num span { font-size: 12.5px; color: var(--sub); font-weight: 600; }
  .ld-num.ld-n-criado b { color: var(--acento); }
  .ld-num.ld-n-recusado b { color: #e5484d; }
  .ld-res { display: grid; gap: 6px; max-height: 340px; overflow: auto; }
  .ld-res div { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; font-size: 13.5px; padding: 9px 11px; border-radius: 14px; background: var(--vidro-item); }
  .ld-res em { font-style: normal; font-weight: 700; font-size: 12px; color: var(--sub); grid-row: 1 / span 2; font-variant-numeric: tabular-nums; }
  .ld-res small { color: var(--sub); }
  .ld-res .ld-r-recusado small { color: #e5484d; }
  .ld-grupo { border-radius: 24px; padding: 16px; display: grid; gap: 10px; }
  .ld-motivos { display: flex; gap: 6px; flex-wrap: wrap; }
  .ld-pilula { font-size: 12px; font-weight: 800; padding: 4px 11px; border-radius: 999px; background: var(--acento-suave); color: var(--acento); }
  .ld-pessoa { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 12px; padding: 12px; border-radius: 18px; background: var(--vidro-item); cursor: pointer; border: 1.5px solid transparent; align-items: start; transition: border-color .18s, background .18s; }
  .ld-pessoa:has(input:checked) { border-color: var(--acento); background: var(--acento-suave); }
  .ld-pessoa input { width: 20px; height: 20px; accent-color: var(--acento); margin: 2px 0 0; grid-column: 1; grid-row: 1 / span 8; }
  .ld-pessoa > :not(input) { grid-column: 2; }
  .ld-pessoa b { font-size: 15px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .ld-pessoa b i { font-style: normal; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 999px; background: var(--acento); color: #fff; }
  .ld-pessoa span { font-size: 13px; color: var(--sub); line-height: 1.45; overflow-wrap: anywhere; }
  .ld-link { all: unset; cursor: pointer; color: var(--texto); font-weight: 700; text-decoration: underline; text-decoration-color: var(--acento); text-decoration-thickness: 2px; text-underline-offset: 3px; }
  .ld-vazio { border-radius: 24px; padding: 28px 20px; display: grid; gap: 8px; justify-items: center; text-align: center; color: var(--sub); font-size: 14.5px; line-height: 1.45; }
  .ld-vazio b { color: var(--texto); font-size: 17px; }
  .ld-vazio svg { width: 40px; height: 40px; color: var(--acento); }
  .ld-esq { border-radius: 24px; height: 140px; background: var(--vidro-fundo); animation: ld-pulso 1.4s ease-in-out infinite; }
  @keyframes ld-pulso { 50% { opacity: .5; } }
  @media (prefers-reduced-motion: reduce) { .ld *, .ld-esq { transition: none !important; animation: none !important; } }
  `;

  const IC = {
    baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
    subir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7 8.5l5-5 5 5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16 10"/></svg>',
    pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0M16 4.8a3.4 3.4 0 0 1 0 6.4M18.2 14.3a6.2 6.2 0 0 1 3 5.7"/></svg>',
    juntar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4v5a5 5 0 0 0 5 5h7"/><path d="M18 4v2a5 5 0 0 1-2 4"/><path d="m15 11 3 3-3 3"/></svg>',
  };

  const s = { totalGeral: null, aba: lerAba(), caixa: null, ui: null, tags: [], campos: [], exp: { unidade: '', etapa: '', tag: '', de: '', ate: '' }, previa: null, imp: novaImportacao(), dup: null, dupErro: null, ocupado: false };
  function lerAba() { try { const v = sessionStorage.getItem(CHAVE); return ABAS.some(([k]) => k === v) ? v : 'exportar'; } catch { return 'exportar'; } }
  function novaImportacao() { return { passo: 'fonte', texto: '', nomeArquivo: '', cab: [], linhas: [], mapa: [], unidade: '', etapa: 'novo_lead', tagId: '', ddd: '71', conversa: true, previa: null, final: null, erro: '' }; }

  function estilo() {
    if (document.getElementById('estilo-leads')) return;
    const st = document.createElement('style');
    st.id = 'estilo-leads';
    st.textContent = CSS;
    document.head.append(st);
  }

  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
  const fmtTel = (t) => { const d = String(t).replace(/\D/g, ''); return d.length === 13 ? `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : d.length === 12 ? `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}` : t; };
  const dataBR = (d) => (d ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Bahia' }).format(new Date(d)) : '');

  // ---------- CSV / planilha colada ----------
  function lerCsv(texto) {
    const t = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const primeira = t.split('\n').find((l) => l.trim()) || '';
    const conta = (sep) => { let n = 0, q = false; for (const ch of primeira) { if (ch === '"') q = !q; else if (ch === sep && !q) n++; } return n; };
    const sep = ['\t', ';', ','].sort((a, b) => conta(b) - conta(a))[0];
    const linhas = []; let linha = [], campo = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += ch; continue; }
      if (ch === '"' && campo === '') q = true;
      else if (ch === sep) { linha.push(campo); campo = ''; }
      else if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
      else campo += ch;
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.map((l) => l.map((c) => c.trim())).filter((l) => l.some((c) => c));
  }

  /** Nome da coluna → campo da Sintonia. */
  function adivinhar(cab, campos) {
    const usados = new Set();
    return cab.map((c) => {
      const n = semAcento(c).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const regras = [
        ['telefone', /^(telefone|tel|fone|celular|cel|whats ?app|whats|zap|phone|numero|contato|mobile)\b/],
        ['email', /^(e ?mail|email|correio)\b/],
        ['nome', /^(nome|name|cliente|nome completo|contato nome|full name)\b/],
        ['unidade', /^(unidade|loja|filial|salao)\b/],
        ['etapa', /^(etapa|status|fase|situacao|estagio)\b/],
        ['tags', /^(tags?|etiquetas?|marcadores?)\b/],
        ['observacoes', /^(obs|observ|anotac|notas?)/],
      ];
      for (const [k, re] of regras) if (re.test(n) && !usados.has(k)) { usados.add(k); return k; }
      const campo = campos.find((x) => semAcento(x.nome) === semAcento(c));
      if (campo && !usados.has('c:' + campo.id)) { usados.add('c:' + campo.id); return 'c:' + campo.id; }
      return '';
    });
  }

  async function lerArquivo(arq) {
    const buf = await arq.arrayBuffer();
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
  }

  function carregarTexto(texto, nome) {
    const im = s.imp;
    im.erro = '';
    const linhas = lerCsv(texto);
    if (linhas.length < 2) { im.erro = 'Não encontrei linhas. A primeira linha precisa ter os nomes das colunas (Nome, Telefone...).'; return desenhar(); }
    if (linhas.length - 1 > MAX_LINHAS) { im.erro = `A planilha tem ${fmtN(linhas.length - 1)} linhas. Divida em partes de até ${fmtN(MAX_LINHAS)}.`; return desenhar(); }
    im.cab = linhas[0].map((c, i) => c || `Coluna ${i + 1}`);
    im.linhas = linhas.slice(1);
    im.mapa = adivinhar(im.cab, s.campos);
    im.nomeArquivo = nome || '';
    im.passo = 'mapa';
    im.previa = null;
    if (!im.unidade) im.unidade = s.ui.estado.eu?.unidades?.[0] === 'sumare' ? 'sumare' : 'norte';
    desenhar();
  }

  function montarLinhas() {
    const im = s.imp;
    return im.linhas.map((l) => {
      const r = { campos: {} };
      im.mapa.forEach((m, i) => {
        const v = l[i] ?? '';
        if (!m || v === '') return;
        if (m.startsWith('c:')) r.campos[m.slice(2)] = v;
        else if (m === 'tags' && r.tags) r.tags += ',' + v;
        else r[m] = v;
      });
      if (!Object.keys(r.campos).length) delete r.campos;
      r.telefone = r.telefone ?? '';
      return r;
    });
  }

  async function enviarImportacao(simular) {
    const { ui } = s;
    const im = s.imp;
    if (!im.mapa.includes('telefone')) { im.erro = 'Escolha qual coluna é o Telefone.'; return desenhar(); }
    s.ocupado = true; im.erro = ''; desenhar();
    try {
      const corpo = { linhas: montarLinhas(), unidade: im.unidade, etapa: im.etapa, criarConversa: im.conversa, simular, ...(im.tagId ? { tagId: im.tagId } : {}), ...(/^\d{2}$/.test(im.ddd) ? { dddPadrao: im.ddd } : {}) };
      const r = await ui.api('/api/leads/importar', { method: 'POST', body: JSON.stringify(corpo) });
      if (simular) { im.previa = r; im.passo = 'previa'; }
      else { im.final = r; im.passo = 'fim'; ui.api('/api/leads').then((x) => { s.totalGeral = x.total; desenhar(); }).catch(() => {}); ui.toast(`Importação concluída: ${r.criados} novos, ${r.atualizados} atualizados`); }
    } catch (x) { im.erro = x.message; }
    s.ocupado = false;
    desenhar();
  }

  function baixarRelatorio(r) {
    const esc = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const SIT = { criado: 'Criado', atualizado: 'Atualizado', igual: 'Já existia igual', recusado: 'Recusado' };
    const linhas = [['#', 'Situação', 'Telefone', 'Nome', 'Motivo / avisos'], ...r.linhas.map((l) => [l.linha, SIT[l.situacao], l.telefone, l.nome, [l.motivo, ...(l.avisos || [])].filter(Boolean).join(' · ')])];
    const blob = new Blob(['﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'relatorio-importacao.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- desenho ----------
  function opcoesEtapa(ui, comTodas) { return [...(comTodas ? [['', 'Todas']] : []), ...ui.ETAPAS.map((e) => (Array.isArray(e) ? e : [e, ui.NOME_ETAPA[e] || e]))]; }
  function select(ui, valor, opcoes, onchange, attrs = {}) {
    const x = ui.el('select', { onchange, ...attrs }, ...opcoes.map(([v, t]) => ui.el('option', { value: v, text: t })));
    x.value = valor;
    return x;
  }
  const UNIDADES = [['norte', 'Salvador Norte Shopping'], ['sumare', 'Shopping Sumaré']];
  const unidadesDaPessoa = (ui) => { const eu = ui.estado.eu; return !eu || ['admin', 'direcao'].includes(eu.papel) || !eu.unidades?.length ? UNIDADES : UNIDADES.filter(([u]) => eu.unidades.includes(u)); };

  function consultaExp() {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(s.exp)) if (v) q.set(k, v);
    return q.toString();
  }

  async function atualizarPrevia() {
    try { s.previa = await s.ui.api('/api/leads?' + consultaExp()); } catch (x) { s.previa = { erro: x.message }; }
    if (s.aba === 'exportar') desenhar();
  }

  function abaExportar(ui) {
    const el = ui.el;
    const mudar = (k) => (e) => { s.exp[k] = e.target.value; s.previa = null; desenhar(); atualizarPrevia(); };
    const unidades = unidadesDaPessoa(ui);
    const filtros = el('div', { class: 'ld-bloco' },
      el('h2', {}, 'Filtros', el('small', { text: 'Sem filtro, saem todos os contatos (inclusive os importados sem conversa).' })),
      el('div', { class: 'ld-campos' },
        el('label', { class: 'ld-campo' }, 'Unidade', select(ui, s.exp.unidade, [['', unidades.length > 1 ? 'Todas' : 'Todas as minhas'], ...unidades], mudar('unidade'))),
        el('label', { class: 'ld-campo' }, 'Etapa', select(ui, s.exp.etapa, opcoesEtapa(ui, true), mudar('etapa'))),
        el('label', { class: 'ld-campo' }, 'Tag', select(ui, s.exp.tag, [['', 'Todas'], ...s.tags.map((t) => [t.id, t.nome])], mudar('tag'))),
        el('div', { class: 'ld-campo ld-periodo' }, 'Criados entre',
          el('div', {}, el('input', { type: 'date', 'aria-label': 'Criados de', value: s.exp.de, onchange: mudar('de') }), el('span', { text: 'e' }), el('input', { type: 'date', 'aria-label': 'Criados até', value: s.exp.ate, min: s.exp.de || undefined, onchange: mudar('ate') })))));
    const p = s.previa;
    const resultado = el('div', { class: 'ld-bloco' });
    if (!p) resultado.append(el('div', { class: 'ld-esq', style: 'height:90px' }));
    else if (p.erro) resultado.append(el('div', { class: 'ld-erro', text: p.erro }));
    else {
      resultado.append(el('div', { class: 'ld-total' }, el('b', { text: fmtN(p.total) }), el('span', { text: p.total === 1 ? 'contato para exportar' : 'contatos para exportar' })));
      if (p.amostra.length) resultado.append(el('div', { class: 'ld-lista' }, ...p.amostra.slice(0, 5).map((l) => el('div', { class: 'ld-item' },
        el('b', { text: l.nome || fmtTel(l.telefone) }), el('span', { class: 'ld-dir', text: l.etapa ? ui.NOME_ETAPA[l.etapa] || l.etapa : 'só ficha' }),
        el('span', { text: `${fmtTel(l.telefone)}${l.email ? ' · ' + l.email : ''}` }), el('span', { class: 'ld-dir', text: dataBR(l.criadoEm) })))));
      const botao = el('a', { class: 'ld-botao', href: '/api/leads/exportar?' + consultaExp(), download: '', html: IC.baixar + '<span>Exportar CSV</span>', 'aria-disabled': String(!p.total) });
      resultado.append(el('div', { class: 'ld-acoes' }, botao), el('div', { class: 'ld-nota', text: 'Colunas: nome, telefone, e-mail, unidade, etapa, tags, dona, criado em e os campos da ficha. Abre direto no Excel (UTF-8, separado por ponto e vírgula).' }));
    }
    return [filtros, resultado];
  }

  function abaImportar(ui) {
    const el = ui.el;
    const im = s.imp;
    const blocos = [];
    const erro = im.erro ? el('div', { class: 'ld-erro', role: 'alert', text: im.erro }) : null;
    if (im.passo === 'fonte') {
      const entrada = el('input', { type: 'file', accept: '.csv,.txt,.tsv,text/csv,text/plain', hidden: '' });
      entrada.addEventListener('change', async () => { const f = entrada.files?.[0]; if (f) carregarTexto(await lerArquivo(f), f.name); });
      const area = el('label', { class: 'ld-arquivo', tabindex: '0' }, el('span', { html: IC.subir }), el('b', { text: 'Escolher arquivo CSV' }), el('span', { text: 'Exportado do Excel, Google Planilhas ou de outro sistema. A primeira linha tem os nomes das colunas.' }), entrada);
      area.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.click(); } });
      area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('ld-sobre'); });
      area.addEventListener('dragleave', () => area.classList.remove('ld-sobre'));
      area.addEventListener('drop', async (e) => { e.preventDefault(); area.classList.remove('ld-sobre'); const f = e.dataTransfer.files?.[0]; if (f) carregarTexto(await lerArquivo(f), f.name); });
      const colar = el('textarea', { placeholder: 'Nome\tTelefone\tE-mail\nMaria Souza\t(71) 98888-1111\tmaria@email.com', 'aria-label': 'Colar da planilha' });
      colar.value = im.texto;
      colar.addEventListener('input', () => { im.texto = colar.value; });
      blocos.push(el('div', { class: 'ld-bloco' },
        el('h2', {}, 'De onde vêm os leads?', el('small', { text: 'Ninguém recebe mensagem: a importação só cria a ficha (e, se quiser, a conversa vazia no CRM).' })),
        area, el('div', { class: 'ld-ou', text: 'ou cole as linhas da planilha' }),
        el('label', { class: 'ld-campo' }, 'Colar da planilha (com a linha dos títulos)', colar),
        erro,
        el('div', { class: 'ld-acoes' }, el('button', { class: 'ld-botao', type: 'button', text: 'Continuar', onclick: () => carregarTexto(im.texto, '') }))));
      return blocos;
    }
    const opcoesCol = [['', 'Ignorar'], ['nome', 'Nome'], ['telefone', 'Telefone'], ['email', 'E-mail'], ['unidade', 'Unidade'], ['etapa', 'Etapa'], ['tags', 'Tags'], ['observacoes', 'Observações'], ...s.campos.map((c) => ['c:' + c.id, `Ficha: ${c.nome}`])];
    if (im.passo === 'mapa') {
      const amostra = (i) => im.linhas.slice(0, 3).map((l) => l[i]).filter(Boolean).join(' · ') || '(vazia)';
      blocos.push(el('div', { class: 'ld-bloco' },
        el('h2', {}, `${fmtN(im.linhas.length)} ${im.linhas.length === 1 ? 'linha' : 'linhas'}${im.nomeArquivo ? ' em ' + im.nomeArquivo : ''}`, el('small', { text: 'Confira o que cada coluna é. Já escolhemos pelo nome da coluna.' })),
        el('div', { class: 'ld-mapa' }, ...im.cab.map((c, i) => el('div', { class: 'ld-col' + (im.mapa[i] ? '' : ' ld-ignorada') },
          el('b', { text: c }), el('span', { text: amostra(i) }),
          select(ui, im.mapa[i], opcoesCol, (e) => { const v = e.target.value; if (v) im.mapa = im.mapa.map((m) => (m === v ? '' : m)); im.mapa[i] = v; desenhar(); }, { 'aria-label': `Coluna ${c}` }))))));
      const unidades = unidadesDaPessoa(ui);
      if (!unidades.some(([u]) => u === im.unidade)) im.unidade = unidades[0][0];
      blocos.push(el('div', { class: 'ld-bloco' },
        el('h2', {}, 'Para os leads sem essa informação', el('small', { text: 'Valem quando a planilha não tem a coluna (ou a célula está vazia).' })),
        el('div', { class: 'ld-campos' },
          el('label', { class: 'ld-campo' }, 'Unidade', select(ui, im.unidade, unidades, (e) => { im.unidade = e.target.value; })),
          el('label', { class: 'ld-campo' }, 'Etapa', select(ui, im.etapa, opcoesEtapa(ui, false), (e) => { im.etapa = e.target.value; })),
          el('label', { class: 'ld-campo' }, 'Marcar a tag', select(ui, im.tagId, [['', 'Nenhuma'], ...s.tags.map((t) => [t.id, t.nome])], (e) => { im.tagId = e.target.value; })),
          el('label', { class: 'ld-campo' }, 'DDD de quem vem sem DDD', el('input', { inputmode: 'numeric', maxlength: '2', value: im.ddd, oninput: (e) => { im.ddd = e.target.value.replace(/\D/g, ''); } }))),
        el('label', { class: 'ld-marcar' }, el('input', { type: 'checkbox', ...(im.conversa ? { checked: '' } : {}), onchange: (e) => { im.conversa = e.target.checked; } }),
          el('span', {}, 'Criar a conversa no CRM', el('small', { text: 'Aparece no funil, sem nenhuma mensagem e em "Só eu" (a IA não puxa conversa).' }))),
        erro,
        el('div', { class: 'ld-acoes' },
          el('button', { class: 'ld-botao', type: 'button', 'aria-disabled': String(s.ocupado), text: s.ocupado ? 'Conferindo…' : 'Conferir antes de importar', onclick: () => enviarImportacao(true) }),
          el('button', { class: 'ld-botao ld-leve', type: 'button', text: 'Trocar arquivo', onclick: () => { s.imp = { ...novaImportacao(), texto: im.texto }; desenhar(); } }))));
      return blocos;
    }
    const r = im.passo === 'fim' ? im.final : im.previa;
    const numeros = el('div', { class: 'ld-numeros-res' },
      el('div', { class: 'ld-num ld-n-criado' }, el('b', { text: fmtN(r.criados) }), el('span', { text: im.passo === 'fim' ? 'novos' : 'vão entrar' })),
      el('div', { class: 'ld-num' }, el('b', { text: fmtN(r.atualizados) }), el('span', { text: im.passo === 'fim' ? 'atualizados' : 'vão atualizar' })),
      el('div', { class: 'ld-num' }, el('b', { text: fmtN(r.iguais) }), el('span', { text: 'já existiam iguais' })),
      el('div', { class: 'ld-num ld-n-recusado' }, el('b', { text: fmtN(r.recusados) }), el('span', { text: 'recusados' })));
    const SIT = { criado: 'novo', atualizado: 'atualiza', igual: 'igual', recusado: 'recusado' };
    const relevantes = r.linhas.filter((l) => l.situacao === 'recusado' || l.avisos?.length);
    const lista = relevantes.length
      ? el('div', { class: 'ld-res' }, ...relevantes.slice(0, 200).map((l) => el('div', { class: 'ld-r-' + l.situacao },
        el('em', { text: `#${l.linha}` }), el('b', { text: `${l.nome || '—'} · ${l.telefone ? fmtTel(l.telefone) : 'sem telefone'} · ${SIT[l.situacao]}` }),
        el('small', { text: [l.motivo, ...(l.avisos || [])].filter(Boolean).join(' · ') }))))
      : el('div', { class: 'ld-nota', text: 'Nenhum problema encontrado.' });
    const titulo = im.passo === 'fim' ? 'Importação concluída' : 'Prévia: nada foi gravado ainda';
    const sub = im.passo === 'fim'
      ? `${fmtN(r.conversasCriadas)} ${r.conversasCriadas === 1 ? 'conversa criada' : 'conversas criadas'} no CRM, sem enviar mensagem.`
      : `${fmtN(r.total)} linhas conferidas${r.conversasCriadas ? ` · ${fmtN(r.conversasCriadas)} conversas novas no CRM` : ''}. Mesmo número em outro formato (com/sem 55 ou 9) atualiza o cadastro que já existe.`;
    blocos.push(el('div', { class: 'ld-bloco' }, el('h2', {}, titulo, el('small', { text: sub })), numeros,
      relevantes.length ? el('h2', { style: 'font-size:15px' }, `Recusados e avisos (${fmtN(relevantes.length)})`, el('small', { text: '# = posição na planilha, sem contar a linha dos títulos.' })) : null,
      lista, erro,
      el('div', { class: 'ld-acoes' }, ...(im.passo === 'previa'
        ? [el('button', { class: 'ld-botao', type: 'button', 'aria-disabled': String(s.ocupado || !(r.criados + r.atualizados)), text: s.ocupado ? 'Importando…' : `Importar ${fmtN(r.criados + r.atualizados)} ${r.criados + r.atualizados === 1 ? 'lead' : 'leads'}`, onclick: () => enviarImportacao(false) }),
          el('button', { class: 'ld-botao ld-leve', type: 'button', text: 'Voltar', onclick: () => { im.passo = 'mapa'; desenhar(); } })]
        : [el('button', { class: 'ld-botao', type: 'button', html: IC.baixar + '<span>Baixar relatório</span>', onclick: () => baixarRelatorio(r) }),
          el('button', { class: 'ld-botao ld-leve', type: 'button', text: 'Importar outra planilha', onclick: () => { s.imp = novaImportacao(); desenhar(); } })]))));
    return blocos;
  }

  async function carregarDuplicatas() {
    try { s.dup = await s.ui.api('/api/leads/duplicatas'); s.dupErro = null; } catch (x) { s.dupErro = x.message; }
    desenhar();
  }

  async function acaoDuplicata(url, corpo, msg) {
    s.ocupado = true; desenhar();
    try { await s.ui.api(url, { method: 'POST', body: JSON.stringify(corpo) }); s.ui.toast(msg); }
    catch (x) { s.ui.toast(x.message); }
    s.ocupado = false;
    s.ui.api('/api/leads').then((x) => { s.totalGeral = x.total; }).catch(() => {});
    await carregarDuplicatas();
  }

  function abaDuplicatas(ui) {
    const el = ui.el;
    if (s.dupErro) return [el('div', { class: 'ld-vazio' }, el('b', { text: 'Não deu para procurar duplicatas' }), el('span', { text: s.dupErro }), el('button', { class: 'ld-botao', type: 'button', text: 'Tentar de novo', onclick: carregarDuplicatas }))];
    if (!s.dup) return [el('div', { class: 'ld-esq' }), el('div', { class: 'ld-esq' })];
    const grupos = s.dup.grupos;
    if (!grupos.length) return [el('div', { class: 'ld-vazio' }, el('span', { html: IC.ok }), el('b', { text: 'Nenhuma duplicata' }),
      el('span', { text: `Procuramos o mesmo telefone (com ou sem 55 e 9º dígito), o mesmo e-mail e nomes parecidos com o mesmo final de telefone.${s.dup.naoDuplicatas ? ` ${s.dup.naoDuplicatas} ${s.dup.naoDuplicatas === 1 ? 'par marcado' : 'pares marcados'} como "não é duplicata".` : ''}` }))];
    const topo = el('div', { class: 'ld-nota', text: `${grupos.length} ${grupos.length === 1 ? 'grupo' : 'grupos'} para conferir. Escolha a principal: o telefone dela fica, e as mensagens, tags, etapas e dados da ficha das outras vão para ela.` });
    return [topo, ...grupos.map((g) => {
      const nomeRadio = 'ld-p-' + g.id;
      const pessoas = g.leads.map((l) => {
        const convs = l.conversas.map((c) => {
          const b = el('button', { class: 'ld-link', type: 'button', text: `${ui.UNIDADE[c.unidade] || c.unidade} · ${ui.NOME_ETAPA[c.etapa] || c.etapa}`, onclick: (e) => { e.preventDefault(); ui.abrir(c.id); } });
          return el('span', {}, b, c.dona ? ` · ${c.dona}` : '', ` · desde ${dataBR(c.criadaEm)}`);
        });
        return el('label', { class: 'ld-pessoa' },
          el('input', { type: 'radio', name: nomeRadio, value: l.telefone, ...(l.telefone === g.sugerido ? { checked: '' } : {}) }),
          el('b', {}, l.nome || 'Sem nome', l.telefone === g.sugerido ? el('i', { text: 'sugerida' }) : null),
          el('span', { text: [fmtTel(l.telefone), l.email].filter(Boolean).join(' · ') }),
          ...(convs.length ? convs : [el('span', { text: 'Só a ficha (sem conversa)' })]),
          l.tags.length ? el('span', { text: 'Tags: ' + l.tags.join(', ') }) : null);
      });
      const card = el('section', { class: 'ld-grupo', 'aria-label': 'Possível duplicata' },
        el('div', { class: 'ld-motivos' }, ...g.motivos.map((m) => el('span', { class: 'ld-pilula', text: m.nome }))),
        ...pessoas,
        el('div', { class: 'ld-acoes' },
          el('button', { class: 'ld-botao', type: 'button', 'aria-disabled': String(s.ocupado), html: IC.juntar + '<span>Mesclar na principal</span>', onclick: () => {
            const principal = card.querySelector(`input[name="${window.CSS.escape(nomeRadio)}"]:checked`)?.value;
            if (!principal) return;
            const outros = g.leads.map((l) => l.telefone).filter((t) => t !== principal);
            const p = g.leads.find((l) => l.telefone === principal);
            if (!confirm(`Juntar ${outros.length === 1 ? 'o outro contato' : `os outros ${outros.length} contatos`} em ${p?.nome || fmtTel(principal)} (${fmtTel(principal)})? As conversas viram uma só e isso não tem volta.`)) return;
            acaoDuplicata('/api/leads/mesclar', { principal, outros }, 'Contatos mesclados ✓');
          } }),
          el('button', { class: 'ld-botao ld-leve', type: 'button', 'aria-disabled': String(s.ocupado), text: 'Não é duplicata', onclick: () => acaoDuplicata('/api/leads/nao-duplicata', { telefones: g.leads.map((l) => l.telefone) }, 'Marcado como pessoas diferentes') })));
      return card;
    })];
  }

  function numero(ic, valor, rot) {
    const el = s.ui.el;
    return el('div', { class: 'ld-n', role: 'listitem' }, el('span', { class: 'ld-circ ld-vidro', html: ic, 'aria-hidden': 'true' }), el('div', {}, el('b', { text: valor }), el('small', { text: rot })));
  }

  function desenhar() {
    const { ui, caixa } = s;
    if (!caixa) return;
    const el = ui.el;
    const nDup = s.dup?.grupos?.length || 0;
    const abas = el('div', { class: 'ld-abas', role: 'tablist', 'aria-label': 'Leads' }, ...ABAS.map(([k, t]) => el('button', { role: 'tab', type: 'button', 'aria-selected': String(k === s.aba), onclick: () => trocarAba(k) }, t, k === 'duplicatas' && nDup ? el('span', { class: 'ld-qtd', text: String(nDup) }) : null)));
    const conteudo = s.aba === 'importar' ? abaImportar(ui) : s.aba === 'duplicatas' ? abaDuplicatas(ui) : abaExportar(ui);
    const ativo = document.activeElement;
    const foco = ativo && caixa.contains(ativo) && ativo.tagName === 'SELECT' ? ativo.getAttribute('aria-label') : null;
    caixa.replaceChildren(el('div', { class: 'ld' },
      el('div', { class: 'ld-topo' }, el('h1', { class: 'titulo-grande' }, 'Leads', el('small', { text: 'Exporte para o Excel, importe planilhas e junte contatos repetidos.' })),
        el('div', { class: 'ld-numeros', role: 'list', 'aria-label': 'Resumo' },
          numero(IC.pessoas, s.totalGeral == null ? '—' : fmtN(s.totalGeral), 'contatos'),
          numero(IC.juntar, s.dup ? fmtN(nDup) : '—', nDup === 1 ? 'possível duplicata' : 'possíveis duplicatas'),
          ...(s.imp.final ? [numero(IC.subir, fmtN(s.imp.final.criados), 'entraram na última importação')] : []))),
      abas, el('div', { role: 'tabpanel', style: 'display:grid;gap:14px;min-width:0' }, ...conteudo)));
    if (foco) caixa.querySelector(`select[aria-label="${window.CSS.escape(foco)}"]`)?.focus();
  }

  function trocarAba(k) {
    s.aba = k;
    try { sessionStorage.setItem(CHAVE, k); } catch { /* sem armazenamento */ }
    desenhar();
    if (k === 'duplicatas') carregarDuplicatas();
    if (k === 'exportar') atualizarPrevia();
  }

  window.SintoniaTelas.leads = {
    async desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa;
      s.ui = ui;
      caixa.classList.add('ld-caixa');
      if (ui.estado.eu && !ui.ehGestor(ui.estado.eu)) {
        caixa.replaceChildren(ui.el('div', { class: 'ld' }, ui.el('h1', { class: 'titulo-grande', text: 'Leads' }), ui.el('div', { class: 'ld-vazio' }, ui.el('b', { text: 'Só para a gestão' }), ui.el('span', { text: 'Importar, exportar e juntar contatos fica com a gerência, a direção e a administração.' }))));
        return;
      }
      desenhar();
      const [tags, campos] = await Promise.all([ui.api('/api/tags').catch(() => []), ui.api('/api/campos-contato').catch(() => [])]);
      s.tags = (Array.isArray(tags) ? tags : []).filter((t) => !t.funilId);
      s.campos = Array.isArray(campos) ? campos : [];
      desenhar();
      s.ui.api('/api/leads').then((r) => { s.totalGeral = r.total; desenhar(); }).catch(() => {});
      if (s.aba === 'exportar') atualizarPrevia();
      // A contagem de duplicatas aparece na aba mesmo sem abri-la.
      if (s.aba === 'duplicatas' || !s.dup) carregarDuplicatas();
    },
  };
})();
