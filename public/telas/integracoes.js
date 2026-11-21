/* Integrações e API (área de desenvolvedores): chaves de API, webhooks de saída, MCP e documentação.
 * Registra window.SintoniaTelas.integracoes = { desenhar(caixa, ui, opcoes?) }; opcoes.aba abre uma aba ('chaves' | 'webhooks' | 'mcp' | 'docs').
 * Servidor: src/integracoes/rotas.ts (/api/integracoes/*, só administração e direção).
 * Todo texto que vem do servidor entra por textContent; ícones são fixos daqui. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ig { width: 100%; min-width: 0; display: grid; gap: 16px; }
  .ig-topo { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .ig-topo h1 { margin: 0; font-size: 28px; letter-spacing: -.01em; }
  .ig-topo p { margin: 4px 0 0; color: var(--sub); font-size: 14.5px; max-width: 640px; }
  .ig-abas { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px; margin: 0 -2px; }
  .ig-abas::-webkit-scrollbar { display: none; }
  .ig-aba { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 15px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; }
  .ig-aba svg { width: 17px; height: 17px; }
  .ig-aba small { font-size: 12px; font-weight: 700; color: var(--sub); }
  .ig-aba[aria-pressed="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: none; }
  .ig-aba[aria-pressed="true"] small { color: rgba(255,255,255,.85); }
  .ig-aba:focus-visible, .ig-bt:focus-visible, .ig-esc button:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; }
  .ig-cartao { border-radius: 22px; padding: 18px; display: grid; gap: 12px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); min-width: 0; position: relative; }
  .ig-cartao h2 { margin: 0; font-size: 17px; }
  .ig-cartao > p { margin: 0; color: var(--sub); font-size: 14px; }
  .ig-lista { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); align-items: start; }
  .ig-item { display: grid; gap: 10px; padding: 15px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-width: 0; }
  .ig-item.off { opacity: .72; }
  .ig-item-cab { display: flex; align-items: flex-start; gap: 10px; }
  .ig-item-cab > div { flex: 1; min-width: 0; }
  .ig-item-cab b { display: block; font-size: 15.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ig-mono { font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace; font-size: 12.5px; color: var(--sub); word-break: break-all; }
  .ig-selo { flex: none; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; white-space: nowrap; }
  .ig-selo.ok { color: #067a5b; background: color-mix(in srgb, #0ffcbe 26%, transparent); }
  .ig-selo.mal { color: #b42318; background: color-mix(in srgb, #ef4444 14%, transparent); }
  .ig-selo.neutro { color: var(--sub); background: color-mix(in srgb, #94a3b8 18%, transparent); }
  .ig-selo.espera { color: #9a5b00; background: color-mix(in srgb, #f5b800 20%, transparent); }
  html[data-tema="escuro"] .ig-selo.ok { color: #5ff5cf; } html[data-tema="escuro"] .ig-selo.mal { color: #fca5a5; } html[data-tema="escuro"] .ig-selo.espera { color: #fcd34d; }
  .ig-chips { display: flex; gap: 5px; flex-wrap: wrap; }
  .ig-chip { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px; background: color-mix(in srgb, #106ebe 11%, transparent); color: var(--texto); }
  html[data-tema="escuro"] .ig-chip { background: color-mix(in srgb, #3aa0ff 20%, transparent); }
  .ig-meta { display: flex; gap: 4px 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); }
  .ig-acoes { display: flex; gap: 6px; flex-wrap: wrap; }
  .ig-bt { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; background: var(--vidro-ativo, rgba(255,255,255,.7)); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; }
  .ig-bt svg { width: 15px; height: 15px; }
  .ig-bt.forte { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 8px 18px rgba(16,110,190,.28); }
  .ig-bt.perigo { color: var(--erro, #c43a3a); }
  .ig-bt.mini { padding: 6px 11px; font-size: 12.5px; }
  .ig-bt[disabled] { opacity: .5; pointer-events: none; }
  .ig-vazio { display: grid; gap: 8px; justify-items: start; padding: 22px; border-radius: 20px; border: 1.5px dashed var(--vidro-borda); color: var(--sub); font-size: 14px; }
  .ig-vazio b { color: var(--texto); font-size: 15.5px; }
  .ig-codigo { position: relative; display: grid; gap: 6px; padding: 12px 14px; border-radius: 14px; background: #0d2240; color: #e6f0ff; font-family: ui-monospace, 'JetBrains Mono', Menlo, monospace; font-size: 12.5px; }
  .ig-codigo pre { margin: 0; white-space: pre-wrap; word-break: break-all; }
  .ig-codigo .ig-bt { justify-self: end; background: rgba(255,255,255,.1); color: #e6f0ff; box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); padding: 5px 11px; font-size: 12px; }
  html[data-tema="escuro"] .ig-codigo { background: #050c16; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
  .ig-segredo { display: grid; gap: 10px; padding: 14px; border-radius: 16px; background: color-mix(in srgb, #0ffcbe 13%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, #0ffcbe 45%, transparent); }
  .ig-segredo p { margin: 0; font-size: 13.5px; }
  .ig-passos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); margin: 0; padding: 0; list-style: none; counter-reset: ig; }
  .ig-passos li { counter-increment: ig; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 2px 10px; padding: 12px 14px; border-radius: 16px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-size: 13.5px; color: var(--sub); }
  .ig-passos li::before { content: counter(ig); grid-row: span 2; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 700; font-size: 14px; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .ig-passos li b { color: var(--texto); font-size: 14.5px; }
  .ig-entregas { display: grid; gap: 0; }
  .ig-entrega { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 4px; border-bottom: 1px solid var(--vidro-borda); }
  .ig-entrega:last-child { border-bottom: 0; }
  .ig-entrega:hover { background: var(--sel); }
  .ig-ponto { width: 10px; height: 10px; border-radius: 50%; background: #94a3b8; }
  .ig-ponto.entregue { background: #0aa57f; } .ig-ponto.falhou { background: #ef4444; } .ig-ponto.pendente { background: #f5b800; } .ig-ponto.cancelada { background: #94a3b8; }
  .ig-entrega b { display: block; font-size: 13.5px; } .ig-entrega small { color: var(--sub); font-size: 12px; }
  .ig-entrega .ig-mono { text-align: right; }
  dialog.ig-d { border: 0; border-radius: 26px; padding: 22px; width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); overflow: auto; background: var(--vidro-forte, var(--painel)); color: var(--texto); box-shadow: var(--vidro-brilho); }
  dialog.ig-d.largo { width: min(820px, calc(100vw - 24px)); }
  dialog.ig-d::backdrop { background: rgba(4,12,20,.55); }
  .ig-d h2 { margin: 0 0 4px; font-size: 19px; }
  .ig-d .ig-sub { margin: 0 0 14px; color: var(--sub); font-size: 13.5px; }
  .ig-form { display: grid; gap: 14px; }
  .ig-form label.campo { display: grid; gap: 5px; font-size: 13px; font-weight: 600; color: var(--sub); }
  .ig-form input[type=text], .ig-form input[type=url], .ig-form select { font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .ig-dois { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .ig-esc { display: grid; gap: 0; border-radius: 16px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); overflow: hidden; }
  .ig-esc-linha { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--vidro-borda); }
  .ig-esc-linha:last-child { border-bottom: 0; }
  .ig-esc-linha b { font-size: 14px; display: block; } .ig-esc-linha small { color: var(--sub); font-size: 12px; display: block; line-height: 1.35; }
  .ig-tri { display: flex; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda); padding: 2px; }
  .ig-tri button { all: unset; cursor: pointer; font-size: 12px; font-weight: 600; padding: 5px 10px; border-radius: 999px; color: var(--sub); white-space: nowrap; }
  .ig-tri button[aria-pressed="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; }
  .ig-presets { display: flex; gap: 6px; flex-wrap: wrap; }
  .ig-eventos { display: grid; gap: 6px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); }
  .ig-ev { display: flex; gap: 9px; align-items: flex-start; padding: 9px 11px; border-radius: 14px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); cursor: pointer; font-size: 13.5px; }
  .ig-ev input { margin-top: 3px; accent-color: #106ebe; }
  .ig-ev b { display: block; font-size: 13.5px; } .ig-ev small { color: var(--sub); font-size: 12px; }
  .ig-erro { color: var(--erro, #c43a3a); font-size: 13px; margin: 0; }
  .ig-rodape { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px; }
  .ig-tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
  .ig-tabela td, .ig-tabela th { text-align: left; padding: 7px 6px; border-bottom: 1px solid var(--vidro-borda); vertical-align: top; }
  .ig-tabela th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--sub); }
  .ig-rolar { overflow-x: auto; }
  .ig-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  @media (min-width: 1100px) { .ig-grade.dupla { grid-template-columns: minmax(0, 1fr) minmax(320px, 400px); } }
  @media (max-width: 520px) { .ig-dois { grid-template-columns: 1fr; } .ig-topo h1 { font-size: 24px; } .ig-esc-linha { grid-template-columns: 1fr; } }
  `;
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    chave: I('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>'),
    raio: I('<path d="M13.2 2.5 4.8 13.4a.6.6 0 0 0 .5 1h5.4l-1.1 7.1 8.4-10.9a.6.6 0 0 0-.5-1h-5.4l1.1-7.1Z"/>'),
    ia: I('<path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9Z"/><path d="M19 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z"/>'),
    doc: I('<path d="M7 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20Z"/><path d="M15 3.5V8h4M10 12h6M10 15.5h6"/>'),
    mais: I('<path d="M12 5v14M5 12h14"/>'),
    copiar: I('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
    enviar: I('<path d="M21 3 10 14M21 3l-7 18-4-7-7-4Z"/>'),
    lista: I('<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>'),
    fora: I('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  };
  const ABAS = [
    { id: 'chaves', nome: 'Chaves de API', ic: IC.chave },
    { id: 'webhooks', nome: 'Webhooks', ic: IC.raio },
    { id: 'mcp', nome: 'MCP (IA)', ic: IC.ia },
    { id: 'docs', nome: 'Documentação', ic: IC.doc },
  ];
  const STATUS = { entregue: 'Entregue', falhou: 'Falhou', pendente: 'Tentando de novo', cancelada: 'Cancelada' };
  let ui, caixa, dados, aba = 'chaves';
  try { aba = localStorage.getItem('sintonia.integracoes.aba') || 'chaves'; } catch {}

  const css = () => { if (!document.getElementById('ig-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'ig-css', textContent: CSS })); };
  const quando = (d) => {
    if (!d) return 'nunca';
    const t = new Date(d); const s = (Date.now() - t.getTime()) / 1000;
    if (s < 60) return 'agora há pouco';
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 86400) return `há ${Math.round(s / 3600)} h`;
    return t.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + t.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
  const pedir = (url, metodo, corpo) => ui.api(url, { method: metodo, ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}) });
  const nomeRecurso = (id) => dados?.catalogo.recursos.find((r) => r.id === id)?.nome || id;
  const nomeEvento = (id) => dados?.catalogo.eventos.find((e) => e.id === id)?.nome || id;

  async function copiar(texto, botao) {
    try { await navigator.clipboard.writeText(texto); } catch { ui.toast('Não deu para copiar aqui. Selecione o texto e copie.'); return; }
    if (botao) { const antes = botao.textContent; botao.textContent = 'Copiado ✓'; setTimeout(() => { botao.textContent = antes; }, 1600); }
  }
  const codigo = (texto) => {
    const el = ui.el;
    const b = el('button', { class: 'ig-bt', type: 'button', text: 'Copiar' });
    b.addEventListener('click', () => copiar(texto, b));
    return el('div', { class: 'ig-codigo' }, el('pre', { text: texto }), b);
  };
  const botao = (texto, ic, acao, classe = '') => {
    const el = ui.el;
    const b = el('button', { class: `ig-bt ${classe}`, type: 'button', onclick: acao });
    if (ic) b.append(el('span', { html: ic, style: 'display:inline-flex' }));
    b.append(document.createTextNode(texto));
    return b;
  };
  function dialogo(titulo, sub, montar, largo = false) {
    const el = ui.el;
    const d = el('dialog', { class: `ig-d${largo ? ' largo' : ''}` }, el('h2', { text: titulo }), sub ? el('p', { class: 'ig-sub', text: sub }) : null);
    const fechar = () => { d.close(); d.remove(); };
    d.addEventListener('close', () => d.remove());
    montar(d, fechar);
    document.body.append(d);
    d.showModal();
    return { d, fechar };
  }

  // ------------------------------------------------------------------ carregar e desenhar
  async function desenhar(c, u, opcoes = {}) {
    ui = u; caixa = c;
    if (opcoes.aba) aba = opcoes.aba;
    css();
    const el = ui.el;
    caixa.replaceChildren(el('p', { class: 'ig-sub', text: 'Carregando…', style: 'color:var(--sub)' }));
    try { dados = await ui.api('/api/integracoes'); } catch (e) { caixa.replaceChildren(el('div', { class: 'ig-vazio' }, el('b', { text: 'Integrações' }), el('span', { text: e.message }))); return; }
    montar();
  }
  async function recarregar() {
    try { dados = await ui.api('/api/integracoes'); } catch (e) { ui.toast(e.message); return; }
    montar();
  }

  function montar() {
    const el = ui.el;
    const ativas = dados.chaves.filter((k) => k.situacao === 'ativa').length;
    const contagem = { chaves: ativas, webhooks: dados.webhooks.length };
    const abas = el('div', { class: 'ig-abas', role: 'tablist' }, ...ABAS.map((a) => {
      const b = el('button', { class: 'ig-aba', type: 'button', role: 'tab', 'aria-pressed': String(a.id === aba), onclick: () => { aba = a.id; try { localStorage.setItem('sintonia.integracoes.aba', aba); } catch {} montar(); } });
      b.append(el('span', { html: a.ic, style: 'display:inline-flex' }), document.createTextNode(a.nome));
      if (contagem[a.id]) b.append(el('small', { text: String(contagem[a.id]) }));
      return b;
    }));
    const corpo = aba === 'webhooks' ? abaWebhooks() : aba === 'mcp' ? abaMcp() : aba === 'docs' ? abaDocs() : abaChaves();
    caixa.replaceChildren(el('div', { class: 'ig' },
      el('div', { class: 'ig-topo' }, el('div', {}, el('h1', { text: 'Integrações e API' }), el('p', { text: 'Conecte o seu sistema à Sintonia: chaves de API, webhooks para receber os eventos e o MCP para a IA usar o CRM.' }))),
      abas, corpo));
  }

  // ------------------------------------------------------------------ chaves
  function abaChaves() {
    const el = ui.el;
    const lista = dados.chaves;
    const topo = el('div', { class: 'ig-acoes' }, botao('Nova chave', IC.mais, novaChave, 'forte'));
    if (!lista.length) {
      return el('div', { class: 'ig' }, topo, el('ol', { class: 'ig-passos' },
        el('li', {}, el('b', { text: 'Crie uma chave' }), el('span', { text: 'Dê um nome (ex.: "Site", "n8n") e escolha só as permissões que o sistema precisa.' })),
        el('li', {}, el('b', { text: 'Copie e guarde' }), el('span', { text: 'A chave aparece uma vez só. Guarde no sistema que vai usar, nunca em mensagem.' })),
        el('li', {}, el('b', { text: 'Use na API ou no MCP' }), el('span', { text: 'Cabeçalho Authorization: Bearer sk_... Veja a aba Documentação.' }))));
    }
    return el('div', { class: 'ig' }, topo, el('div', { class: 'ig-lista' }, ...lista.map(cartaoChave)));
  }

  function cartaoChave(k) {
    const el = ui.el;
    const selo = { ativa: ['Ativa', 'ok'], revogada: ['Revogada', 'neutro'], vencida: ['Vencida', 'mal'] }[k.situacao];
    const porRecurso = new Map();
    for (const e of k.escopos) { const [r, a] = e.split(':'); if (porRecurso.get(r) !== 'escrever') porRecurso.set(r, a); }
    const chips = [...porRecurso].map(([r, a]) => el('span', { class: 'ig-chip', text: `${nomeRecurso(r)} · ${a === 'escrever' ? 'ler e escrever' : 'ler'}` }));
    const ativa = k.situacao === 'ativa';
    return el('div', { class: `ig-item${ativa ? '' : ' off'}` },
      el('div', { class: 'ig-item-cab' }, el('div', {}, el('b', { text: k.nome }), el('span', { class: 'ig-mono', text: `${k.prefixo}_••••••••` })), el('span', { class: `ig-selo ${selo[1]}`, text: selo[0] })),
      el('div', { class: 'ig-chips' }, ...chips),
      el('div', { class: 'ig-meta' },
        el('span', { text: `Último uso: ${quando(k.ultimoUsoEm)}` }),
        el('span', { text: `24 h: ${k.uso24h.total} chamada${k.uso24h.total === 1 ? '' : 's'}${k.uso24h.erros ? ` · ${k.uso24h.erros} com erro` : ''}` }),
        el('span', { text: `${k.limiteMinuto}/min` }),
        el('span', { text: k.expiraEm ? `Vence ${new Date(k.expiraEm).toLocaleDateString('pt-BR')}` : 'Sem validade' }),
        k.criadaPorNome ? el('span', { text: `Criada por ${k.criadaPorNome}` }) : null),
      el('div', { class: 'ig-acoes' },
        botao('Uso', IC.lista, () => verUso(k), 'mini'),
        ativa ? botao('Revogar', null, () => revogar(k), 'mini perigo') : null));
  }

  function novaChave() {
    const el = ui.el;
    const acesso = new Map(dados.catalogo.recursos.map((r) => [r.id, 'nada']));
    dialogo('Nova chave de API', 'Dê só as permissões que o sistema precisa. Escrever inclui ler.', (d, fechar) => {
      const nome = el('input', { type: 'text', maxlength: '60', placeholder: 'Ex.: Site, n8n, Zapier', required: '' });
      const linhas = new Map();
      const pintar = () => { for (const [id, grupo] of linhas) grupo.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === acesso.get(id)))); };
      const esc = el('div', { class: 'ig-esc' }, ...dados.catalogo.recursos.map((r) => {
        const tri = el('div', { class: 'ig-tri', role: 'group', 'aria-label': r.nome }, ...[['nada', 'Sem acesso'], ['ler', 'Ler'], ['escrever', 'Ler e escrever']].map(([v, t]) => el('button', { type: 'button', 'data-v': v, text: t, onclick: () => { acesso.set(r.id, v); pintar(); } })));
        linhas.set(r.id, tri);
        return el('div', { class: 'ig-esc-linha' }, el('div', {}, el('b', { text: r.nome }), el('small', { text: r.descricao })), tri);
      }));
      const preset = (v) => () => { for (const r of dados.catalogo.recursos) acesso.set(r.id, v); pintar(); };
      const validade = el('select', {}, ...[['', 'Nunca vence'], ['30', '30 dias'], ['90', '90 dias'], ['365', '1 ano']].map(([v, t]) => el('option', { value: v, text: t })));
      const limite = el('select', {}, ...[['30', '30 por minuto'], ['60', '60 por minuto'], ['120', '120 por minuto'], ['300', '300 por minuto']].map(([v, t]) => el('option', { value: v, text: t })));
      limite.value = '60';
      const erro = el('p', { class: 'ig-erro', hidden: '' });
      const criar = botao('Criar chave', null, async () => {
        const escopos = [...acesso].filter(([, v]) => v !== 'nada').map(([r, v]) => `${r}:${v}`);
        erro.hidden = true;
        if (nome.value.trim().length < 2) { erro.textContent = 'Dê um nome para a chave.'; erro.hidden = false; nome.focus(); return; }
        if (!escopos.length) { erro.textContent = 'Escolha pelo menos uma permissão.'; erro.hidden = false; return; }
        criar.setAttribute('disabled', '');
        try {
          const r = await ui.post('/api/integracoes/chaves', { nome: nome.value.trim(), escopos, expiraEmDias: validade.value ? Number(validade.value) : null, limiteMinuto: Number(limite.value) });
          fechar();
          mostrarChave(r.chave, r.info);
          recarregar();
        } catch (e) { erro.textContent = e.message; erro.hidden = false; criar.removeAttribute('disabled'); }
      }, 'forte');
      pintar();
      d.append(el('div', { class: 'ig-form' },
        el('label', { class: 'campo' }, 'Nome da chave', nome),
        el('div', { class: 'ig-presets' }, botao('Só leitura', null, preset('ler'), 'mini'), botao('Acesso total', null, preset('escrever'), 'mini'), botao('Limpar', null, preset('nada'), 'mini')),
        esc,
        el('div', { class: 'ig-dois' }, el('label', { class: 'campo' }, 'Validade', validade), el('label', { class: 'campo' }, 'Limite de chamadas', limite)),
        erro,
        el('div', { class: 'ig-rodape' }, botao('Cancelar', null, fechar), criar)));
      setTimeout(() => nome.focus(), 50);
    });
  }

  function mostrarChave(chave, info) {
    const el = ui.el;
    dialogo('Chave criada', `"${info.nome}" — copie agora: esta é a única vez que ela aparece.`, (d, fechar) => {
      d.append(el('div', { class: 'ig-form' },
        el('div', { class: 'ig-segredo' }, el('p', {}, el('b', { text: 'Guarde num lugar seguro. ' }), document.createTextNode('Ninguém consegue mostrar esta chave de novo, nem a Sintonia. Se perder, revogue e crie outra.')), codigo(chave)),
        el('p', { class: 'ig-sub', text: 'Teste no terminal:' }),
        codigo(`curl ${dados.enderecos.api}/eu -H "Authorization: Bearer ${chave}"`),
        el('div', { class: 'ig-rodape' }, botao('Já guardei', null, fechar, 'forte'))));
    });
  }

  function revogar(k) {
    const el = ui.el;
    dialogo('Revogar chave?', `"${k.nome}" para de funcionar em segundos. Os sistemas que usam esta chave vão receber erro.`, (d, fechar) => {
      d.append(el('div', { class: 'ig-rodape' }, botao('Cancelar', null, fechar), botao('Revogar', null, async () => {
        try { await ui.post(`/api/integracoes/chaves/${k.id}/revogar`); fechar(); ui.toast('Chave revogada.'); recarregar(); } catch (e) { ui.toast(e.message); }
      }, 'forte')));
    });
  }

  async function verUso(k) {
    const el = ui.el;
    let uso = [];
    try { uso = (await ui.api(`/api/integracoes/chaves/${k.id}/uso`)).uso; } catch (e) { ui.toast(e.message); return; }
    dialogo(`Uso de "${k.nome}"`, 'As últimas 100 chamadas (API e MCP).', (d, fechar) => {
      d.append(uso.length
        ? el('div', { class: 'ig-rolar' }, el('table', { class: 'ig-tabela' },
            el('thead', {}, el('tr', {}, el('th', { text: 'Quando' }), el('th', { text: 'Chamada' }), el('th', { text: 'Status' }), el('th', { text: 'Tempo' }))),
            el('tbody', {}, ...uso.map((x) => el('tr', {}, el('td', { text: dataHora(x.em) }), el('td', { class: 'ig-mono', text: x.rota }), el('td', {}, el('span', { class: `ig-selo ${x.status < 400 ? 'ok' : 'mal'}`, text: String(x.status) })), el('td', { text: `${x.duracaoMs} ms` }))))))
        : el('div', { class: 'ig-vazio' }, el('b', { text: 'Ainda sem chamadas' }), el('span', { text: 'Quando o sistema usar esta chave, cada chamada aparece aqui.' })),
        el('div', { class: 'ig-rodape' }, botao('Fechar', null, fechar)));
    }, true);
  }

  // ------------------------------------------------------------------ webhooks
  function abaWebhooks() {
    const el = ui.el;
    const topo = el('div', { class: 'ig-acoes' }, botao('Novo webhook', IC.mais, () => editarWebhook(), 'forte'));
    if (!dados.webhooks.length) {
      return el('div', { class: 'ig' }, topo, el('ol', { class: 'ig-passos' },
        el('li', {}, el('b', { text: 'Cole o endereço' }), el('span', { text: 'Um endereço https do seu sistema que recebe POST com JSON.' })),
        el('li', {}, el('b', { text: 'Escolha os eventos' }), el('span', { text: 'Mensagem recebida, novo lead, etapa mudou, agendamento, NPS…' })),
        el('li', {}, el('b', { text: 'Confira a assinatura' }), el('span', { text: 'Cada envio vem assinado com o segredo do webhook (HMAC-SHA256).' }))));
    }
    return el('div', { class: 'ig' }, topo, el('div', { class: 'ig-lista' }, ...dados.webhooks.map(cartaoWebhook)));
  }

  function cartaoWebhook(w) {
    const el = ui.el;
    const c = w.entregas24h || {};
    const selo = w.ativo ? (w.falhasSeguidas ? ['Falhando', 'espera'] : ['Ligado', 'ok']) : ['Desligado', 'mal'];
    return el('div', { class: `ig-item${w.ativo ? '' : ' off'}` },
      el('div', { class: 'ig-item-cab' }, el('div', {}, el('b', { text: w.nome }), el('span', { class: 'ig-mono', text: w.url })), el('span', { class: `ig-selo ${selo[1]}`, text: selo[0] })),
      !w.ativo && w.desligadoMotivo ? el('span', { class: 'ig-erro', text: w.desligadoMotivo }) : null,
      el('div', { class: 'ig-chips' }, ...w.eventos.map((e) => el('span', { class: 'ig-chip', text: nomeEvento(e) }))),
      el('div', { class: 'ig-meta' },
        el('span', { text: `24 h: ${c.entregue || 0} entregue${(c.entregue || 0) === 1 ? '' : 's'}` }),
        c.falhou ? el('span', { text: `${c.falhou} ${c.falhou === 1 ? 'falhou' : 'falharam'}` }) : null,
        c.pendente ? el('span', { text: `${c.pendente} tentando de novo` }) : null,
        el('span', { text: `Último sucesso: ${quando(w.ultimoSucessoEm)}` })),
      el('div', { class: 'ig-acoes' },
        botao('Enviar teste', IC.enviar, () => testar(w), 'mini'),
        botao('Entregas', IC.lista, () => verEntregas(w), 'mini'),
        botao('Segredo', IC.chave, () => verSegredo(w), 'mini'),
        botao('Editar', null, () => editarWebhook(w), 'mini'),
        botao(w.ativo ? 'Desligar' : 'Ligar', null, async () => { try { await pedir(`/api/integracoes/webhooks/${w.id}`, 'PATCH', { ativo: !w.ativo }); recarregar(); } catch (e) { ui.toast(e.message); } }, 'mini'),
        botao('Apagar', null, () => apagarWebhook(w), 'mini perigo')));
  }

  function editarWebhook(w) {
    const el = ui.el;
    dialogo(w ? 'Editar webhook' : 'Novo webhook', 'A Sintonia faz um POST com JSON neste endereço a cada evento escolhido.', (d, fechar) => {
      const nome = el('input', { type: 'text', maxlength: '80', placeholder: 'Ex.: Meu ERP' });
      const url = el('input', { type: 'url', placeholder: 'https://seu-sistema.com/webhooks/sintonia', required: '', inputmode: 'url' });
      nome.value = w?.nome || ''; url.value = w?.url || '';
      const marcados = new Set(w?.eventos || ['mensagem.recebida', 'contato.criado']);
      const eventos = el('div', { class: 'ig-eventos' }, ...dados.catalogo.eventos.map((e) => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = marcados.has(e.id);
        cb.addEventListener('change', () => (cb.checked ? marcados.add(e.id) : marcados.delete(e.id)));
        return el('label', { class: 'ig-ev' }, cb, el('span', {}, el('b', { text: e.nome }), el('small', { text: e.descricao })));
      }));
      const erro = el('p', { class: 'ig-erro', hidden: '' });
      const salvar = botao(w ? 'Salvar' : 'Criar webhook', null, async () => {
        erro.hidden = true;
        if (!marcados.size) { erro.textContent = 'Escolha pelo menos um evento.'; erro.hidden = false; return; }
        salvar.setAttribute('disabled', '');
        try {
          const corpo = { nome: nome.value.trim() || undefined, url: url.value.trim(), eventos: [...marcados] };
          if (w) { await pedir(`/api/integracoes/webhooks/${w.id}`, 'PATCH', corpo); fechar(); ui.toast('Webhook salvo.'); }
          else { const r = await ui.post('/api/integracoes/webhooks', corpo); fechar(); mostrarSegredo(r.webhook, r.segredo, true); }
          recarregar();
        } catch (e) { erro.textContent = e.message; erro.hidden = false; salvar.removeAttribute('disabled'); }
      }, 'forte');
      d.append(el('div', { class: 'ig-form' },
        el('label', { class: 'campo' }, 'Endereço (https)', url),
        el('label', { class: 'campo' }, 'Nome (opcional)', nome),
        el('div', { class: 'campo', style: 'display:grid;gap:6px;font-size:13px;font-weight:600;color:var(--sub)' }, 'Eventos', eventos),
        erro,
        el('div', { class: 'ig-rodape' }, botao('Cancelar', null, fechar), salvar)));
      setTimeout(() => url.focus(), 50);
    }, true);
  }

  function mostrarSegredo(w, segredo, novo) {
    const el = ui.el;
    dialogo(novo ? 'Webhook criado' : 'Segredo do webhook', 'Use este segredo no seu sistema para conferir a assinatura (cabeçalho Sintonia-Assinatura).', (d, fechar) => {
      d.append(el('div', { class: 'ig-form' },
        el('div', { class: 'ig-segredo' }, el('p', { text: 'Guarde como variável de ambiente (ex.: SINTONIA_WEBHOOK_SEGREDO). Nunca coloque no site.' }), codigo(segredo)),
        el('div', { class: 'ig-rodape' },
          !novo ? botao('Trocar segredo', null, async () => {
            try { const r = await ui.post(`/api/integracoes/webhooks/${w.id}/segredo`); fechar(); mostrarSegredo(w, r.segredo, false); ui.toast('Segredo trocado. Atualize o seu sistema.'); } catch (e) { ui.toast(e.message); }
          }, 'perigo') : botao('Enviar teste agora', IC.enviar, () => { fechar(); testar(w); }),
          botao('Pronto', null, fechar, 'forte'))));
    });
  }

  async function verSegredo(w) {
    try { const r = await ui.api(`/api/integracoes/webhooks/${w.id}/segredo`); mostrarSegredo(w, r.segredo, false); } catch (e) { ui.toast(e.message); }
  }

  async function testar(w) {
    ui.toast('Enviando teste…');
    try {
      const r = await ui.post(`/api/integracoes/webhooks/${w.id}/teste`);
      const e = r.entrega;
      if (e.status === 'entregue') ui.toast(`Teste entregue (${e.ultimoHttp}, ${e.duracaoMs} ms).`);
      else detalheEntrega(e);
      recarregar();
    } catch (e) { ui.toast(e.message); }
  }

  function apagarWebhook(w) {
    const el = ui.el;
    dialogo('Apagar webhook?', `"${w.nome}" e o histórico de entregas dele somem. Não dá para desfazer.`, (d, fechar) => {
      d.append(el('div', { class: 'ig-rodape' }, botao('Cancelar', null, fechar), botao('Apagar', null, async () => {
        try { await pedir(`/api/integracoes/webhooks/${w.id}`, 'DELETE'); fechar(); ui.toast('Webhook apagado.'); recarregar(); } catch (e) { ui.toast(e.message); }
      }, 'forte')));
    });
  }

  async function verEntregas(w) {
    const el = ui.el;
    const lista = el('div', { class: 'ig-entregas' });
    let cursor = null;
    const mais = botao('Carregar mais', null, () => carregar(), 'mini');
    const linha = (e) => {
      const b = el('button', { class: 'ig-entrega', type: 'button', onclick: () => detalheEntrega(e, () => { d.fechar(); verEntregas(w); }) },
        el('span', { class: `ig-ponto ${e.status}` }),
        el('span', {}, el('b', { text: `${e.teste ? 'Teste' : nomeEvento(e.evento)} · ${STATUS[e.status] || e.status}` }), el('small', { text: `${dataHora(e.criadaEm)} · ${e.tentativas} tentativa${e.tentativas === 1 ? '' : 's'}${e.status === 'pendente' && e.proximaEm ? ` · próxima ${quando(e.proximaEm).replace('há ', 'em ')}` : ''}` })),
        el('span', { class: 'ig-mono', text: e.ultimoHttp ? `HTTP ${e.ultimoHttp}` : (e.ultimoErro ? 'sem resposta' : '—') }));
      return b;
    };
    async function carregar() {
      mais.setAttribute('disabled', '');
      try {
        const r = await ui.api(`/api/integracoes/webhooks/${w.id}/entregas${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
        if (!cursor && !r.entregas.length) lista.replaceChildren(el('div', { class: 'ig-vazio' }, el('b', { text: 'Nenhuma entrega ainda' }), el('span', { text: 'Use "Enviar teste" ou espere um evento acontecer.' })));
        else lista.append(...r.entregas.map(linha));
        cursor = r.proximoCursor;
        mais.hidden = !cursor;
      } catch (e) { ui.toast(e.message); }
      mais.removeAttribute('disabled');
    }
    const d = dialogo(`Entregas · ${w.nome}`, 'Cada envio deste webhook, do mais novo para o mais antigo. Toque para ver o corpo e a resposta.', (dl, fechar) => {
      dl.append(lista, el('div', { class: 'ig-rodape' }, mais, botao('Fechar', null, fechar)));
    }, true);
    mais.hidden = true;
    await carregar();
  }

  async function detalheEntrega(e, voltar) {
    const el = ui.el;
    let completa = e;
    if (!('corpo' in e)) { try { completa = (await ui.api(`/api/integracoes/entregas/${e.id}`)).entrega; } catch (x) { ui.toast(x.message); return; } }
    dialogo(`${completa.teste ? 'Teste' : nomeEvento(completa.evento)} · ${STATUS[completa.status] || completa.status}`, `${dataHora(completa.criadaEm)} · ${completa.tentativas} tentativa(s)${completa.duracaoMs != null ? ` · ${completa.duracaoMs} ms` : ''}`, (d, fechar) => {
      d.append(el('div', { class: 'ig-form' },
        completa.ultimoErro ? el('p', { class: 'ig-erro', text: completa.ultimoErro }) : null,
        el('div', { class: 'ig-meta' }, el('span', { text: `Evento: ${completa.evento}` }), el('span', { text: `Id: ${completa.eventoId}` }), completa.ultimoHttp ? el('span', { text: `Resposta: HTTP ${completa.ultimoHttp}` }) : null),
        el('b', { text: 'Corpo enviado' }), codigo(JSON.stringify(completa.corpo, null, 2)),
        completa.ultimaResposta ? el('b', { text: 'Resposta do seu sistema' }) : null,
        completa.ultimaResposta ? codigo(completa.ultimaResposta) : null,
        el('div', { class: 'ig-rodape' },
          botao('Reenviar', IC.enviar, async () => {
            try { const r = await ui.post(`/api/integracoes/entregas/${completa.id}/reenviar`); ui.toast(r.entrega.status === 'entregue' ? `Reenviado (${r.entrega.ultimoHttp}).` : `Não entregou: ${r.entrega.ultimoErro || 'sem resposta'}`); fechar(); voltar?.(); recarregar(); } catch (x) { ui.toast(x.message); }
          }),
          botao('Fechar', null, () => { fechar(); }, 'forte'))));
    }, true);
  }

  // ------------------------------------------------------------------ MCP
  function abaMcp() {
    const el = ui.el;
    const url = dados.enderecos.mcp;
    return el('div', { class: 'ig-grade dupla' },
      el('div', { class: 'ig' },
        el('div', { class: 'ig-cartao' },
          el('h2', { text: 'Endereço do servidor MCP' }),
          el('p', { text: 'Com ele, o Claude, o Cursor e outras IAs usam o seu CRM: buscam contatos, leem conversas, mandam mensagens, movem leads, aplicam tags e criam tarefas. A IA usa uma chave de API e só faz o que a chave permite.' }),
          codigo(url)),
        el('div', { class: 'ig-cartao' },
          el('h2', { text: 'Claude Code' }),
          codigo(`claude mcp add --transport http sintonia ${url} \\\n  --header "Authorization: Bearer sk_sua_chave"`),
          el('h2', { text: 'Cursor' }),
          el('p', { text: 'Em ~/.cursor/mcp.json:' }),
          codigo(JSON.stringify({ mcpServers: { sintonia: { url, headers: { Authorization: 'Bearer sk_sua_chave' } } } }, null, 2)),
          el('h2', { text: 'Claude Desktop' }),
          el('p', { text: 'Em Configurações › Desenvolvedor › Editar configuração:' }),
          codigo(JSON.stringify({ mcpServers: { sintonia: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', 'Authorization: Bearer ${SINTONIA_CHAVE}'], env: { SINTONIA_CHAVE: 'sk_sua_chave' } } } }, null, 2)))),
      el('div', { class: 'ig-cartao' },
        el('h2', { text: 'Ferramentas' }),
        el('p', { text: 'A IA vê só as ferramentas que a chave pode usar. Para só consultar, crie uma chave só com leitura.' }),
        ...dados.catalogo.ferramentas.map((f) => el('div', { class: 'ig-item' }, el('div', { class: 'ig-item-cab' }, el('div', {}, el('b', { text: f.titulo }), el('span', { class: 'ig-mono', text: f.nome }))), el('span', { style: 'font-size:13px;color:var(--sub)', text: f.descricao }), el('div', { class: 'ig-chips' }, ...f.escopos.map((e) => el('span', { class: 'ig-chip', text: e }))))),
        botao('Criar chave para a IA', IC.chave, () => { aba = 'chaves'; montar(); novaChave(); }, 'forte')));
  }

  // ------------------------------------------------------------------ documentação
  function abaDocs() {
    const el = ui.el;
    const e = dados.enderecos;
    const link = (texto, href) => { const a = el('a', { class: 'ig-bt forte', href, target: '_blank', rel: 'noopener' }); a.append(el('span', { html: IC.fora, style: 'display:inline-flex' }), document.createTextNode(texto)); return a; };
    return el('div', { class: 'ig-grade dupla' },
      el('div', { class: 'ig' },
        el('div', { class: 'ig-cartao' },
          el('h2', { text: 'Documentação completa' }),
          el('p', { text: 'Todas as rotas da API v1 com exemplos, os eventos dos webhooks com o corpo de exemplo, como validar a assinatura em Node e Python e como ligar o MCP. A página é pública e não mostra dado da empresa: pode mandar para quem vai desenvolver.' }),
          el('div', { class: 'ig-acoes' }, link('Abrir documentação', e.docs), link('openapi.json', e.openapi))),
        el('div', { class: 'ig-cartao' },
          el('h2', { text: 'Primeiros passos' }),
          el('p', { text: 'Endereço da API:' }), codigo(e.api),
          el('p', { text: 'Listar conversas:' }), codigo(`curl "${e.api}/conversas?limite=10" \\\n  -H "Authorization: Bearer $SINTONIA_CHAVE"`),
          el('p', { text: 'Mandar uma mensagem de WhatsApp:' }), codigo(`curl -X POST "${e.api}/mensagens" \\\n  -H "Authorization: Bearer $SINTONIA_CHAVE" \\\n  -H "Content-Type: application/json" \\\n  -d '{"telefone":"5571988124471","texto":"Olá! Seu pedido saiu."}'`))),
      el('div', { class: 'ig-cartao' },
        el('h2', { text: 'Regras importantes' }),
        el('ol', { class: 'ig-passos', style: 'grid-template-columns:1fr' },
          el('li', {}, el('b', { text: 'Limite por chave' }), el('span', { text: 'Padrão 60 chamadas por minuto. Os cabeçalhos X-RateLimit-* mostram quanto falta.' })),
          el('li', {}, el('b', { text: 'Paginação por cursor' }), el('span', { text: 'As listas trazem proximoCursor: mande de volta em ?cursor= para a próxima página.' })),
          el('li', {}, el('b', { text: 'Erros padronizados' }), el('span', { text: '{ "erro": { "codigo", "mensagem" } } em todas as respostas de erro.' })),
          el('li', {}, el('b', { text: 'Webhooks seguros' }), el('span', { text: 'Só https e endereços públicos. Confira a assinatura e responda 2xx em até 10 s.' })))));
  }

  window.SintoniaTelas.integracoes = { desenhar, recarregar };
})();
