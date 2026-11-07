/* Tela de conversa, recursos a mais (window.SintoniaConversa):
 * - respostas rápidas: "/" no campo abre a lista; "Gerenciar respostas rápidas" cria, edita e apaga;
 * - bolinha "IA" no topo da conversa: sugerir, melhorar o texto, resumir, próximo passo, explicar áudio;
 * - áudios: velocidade 1x / 1,5x / 2x e "Transcrever" (guardado no servidor);
 * - balões de texto: "Ouvir" (voz do navegador, pt-BR) e "Copiar";
 * - "+" do topo da lista: nova conversa por número.
 * Usa window.Sintonia.ui (app.html). Texto que vem do servidor entra sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, post, el, toast, estado } = ui;
  const $ = (id) => document.getElementById(id);
  const campo = $('texto');

  const SVG = {
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    resposta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M8.5 10h7M8.5 13.5h4.5"/></svg>',
    lapis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/><path d="M13.5 7.5l3 3"/></svg>',
    resumo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 6h14M5 10.5h14M5 15h9M5 19.5h6"/></svg>',
    passo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h12M13 6l6 6-6 6"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
    brilho: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" opacity=".75"/></svg>',
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
    alto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>',
    parar: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    engrenagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
    texto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h8"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  };

  const CSS = `
  /* ---------- bolinha IA no topo ---------- */
  .pilula-topo .ia-topo { position: relative; width: 34px; height: 34px; margin: 0 4px; border-radius: 50%; color: #fff; font-size: 12.5px; font-weight: 800; letter-spacing: .02em;
    background: var(--marca-gradiente); box-shadow: 0 0 0 1.5px rgba(216, 57, 149,.55), 0 0 14px rgba(216, 57, 149,.55); display: grid; place-items: center; font-family: var(--fonte); }
  .pilula-topo .ia-topo::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; box-shadow: 0 0 0 1.5px rgba(216, 57, 149,.0); animation: iaPulso 2.8s ease-out infinite; pointer-events: none; }
  .pilula-topo .ia-topo:hover { background: var(--marca-gradiente); filter: brightness(1.08); }
  .pilula-topo .ia-topo[aria-busy="true"]::after { animation-duration: 1s; }
  @keyframes iaPulso { 0% { box-shadow: 0 0 0 0 rgba(216, 57, 149,.55); } 70% { box-shadow: 0 0 0 7px rgba(216, 57, 149,0); } 100% { box-shadow: 0 0 0 0 rgba(216, 57, 149,0); } }
  @media (prefers-reduced-motion: reduce) { .pilula-topo .ia-topo::after { animation: none; } }
  @media (max-width: 760px) { .pilula-topo .icone { width: 38px; } .pilula-topo .ia-topo { width: 32px; height: 32px; margin: 0 3px; } }

  /* ---------- folhas (sobem de baixo no celular) ---------- */
  dialog.cx-folha { padding-bottom: calc(16px + env(safe-area-inset-bottom)); max-height: min(88vh, 760px); overflow: auto; overscroll-behavior: contain; }
  dialog.cx-folha .folha-lista button { min-height: 30px; }
  .cx-op i { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; flex: none; color: #fff; background: var(--marca-gradiente); }
  .cx-op i svg { width: 21px; height: 21px; }
  .cx-op.ia i { background: linear-gradient(135deg, #D83995 0%, #23ABDD 100%); color: #ffffff; box-shadow: 0 0 12px rgba(216, 57, 149,.35); }
  .cx-op small, .cx-sub { color: var(--sub); font-size: 13px; line-height: 17px; }
  .cx-op b { font-size: 15.5px; font-weight: 700; }
  .cx-op[aria-disabled="true"] { opacity: .55; }
  .cx-aviso { margin: 10px 2px 0; padding: 12px 14px; border-radius: 14px; background: var(--aviso); color: var(--aviso-txt); font-size: 14px; line-height: 19px; }
  .cx-aviso a { color: inherit; font-weight: 700; }
  .cx-resultado { display: grid; gap: 12px; }
  .cx-texto { white-space: pre-wrap; font-size: 15.5px; line-height: 22px; padding: 14px 16px; border-radius: 16px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); overflow-wrap: anywhere; }
  .cx-citacao { border-left: 3px solid var(--marca-menta); background: var(--citacao); color: var(--texto); }
  .cx-rotulo { font-size: 12.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--sub); margin: 2px 4px -4px; }
  .cx-botoes { display: flex; gap: 10px; flex-wrap: wrap; }
  .cx-botoes .botao { flex: 1; min-height: 48px; justify-content: center; display: inline-flex; align-items: center; gap: 8px; font-size: 15.5px; }
  .cx-botoes .botao svg { width: 19px; height: 19px; }
  .cx-pensando { display: grid; gap: 10px; padding: 6px 2px; }
  .cx-pensando i { display: block; height: 14px; border-radius: 8px; background: linear-gradient(90deg, var(--painel) 0%, color-mix(in srgb, var(--marca-menta) 35%, var(--painel)) 50%, var(--painel) 100%); background-size: 200% 100%; animation: cxBrilho 1.3s linear infinite; }
  .cx-pensando i:nth-child(2) { width: 86%; } .cx-pensando i:nth-child(3) { width: 64%; }
  @keyframes cxBrilho { to { background-position: -200% 0; } }

  /* ---------- respostas rápidas: lista flutuante ---------- */
  .rr-lista { position: absolute; left: 10px; right: 10px; bottom: calc(100% + 6px); z-index: 8; max-height: min(46vh, 340px); display: flex; flex-direction: column; border-radius: 18px; overflow: hidden;
    background: var(--vidro-forte, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha)); box-shadow: var(--vidro-brilho, none), 0 18px 50px rgba(4,18,31,.28); -webkit-backdrop-filter: blur(18px) saturate(1.4); backdrop-filter: blur(18px) saturate(1.4); }
  @media (min-width: 761px) { .rr-lista { right: auto; width: min(520px, calc(100% - 20px)); } }
  .rr-lista[hidden], .bal-acoes[hidden] { display: none !important; }
  .rr-itens { overflow-y: auto; overscroll-behavior: contain; padding: 6px; display: grid; gap: 2px; }
  .rr-item { all: unset; cursor: pointer; box-sizing: border-box; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; align-items: baseline; padding: 11px 12px; border-radius: 12px; min-height: 48px; }
  .rr-item b { font-weight: 800; color: var(--azul); font-size: 15px; }
  .rr-item span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--texto); font-size: 14.5px; }
  .rr-item small { grid-column: 2; color: var(--sub); font-size: 12px; }
  .rr-item[aria-selected="true"], .rr-item:hover { background: var(--sel); }
  .rr-vazio { padding: 14px 16px; color: var(--sub); font-size: 14px; }
  .rr-gerenciar { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 0 16px; min-height: 50px; border-top: 1px solid var(--vidro-linha, var(--linha)); font-weight: 700; font-size: 14.5px; color: var(--azul); }
  .rr-gerenciar svg { width: 20px; height: 20px; }
  .rr-item mark, .rr-gestao mark { background: none; color: inherit; font-weight: 700; }

  /* ---------- respostas rápidas: gerenciar ---------- */
  .rr-gestao .folha-lista button { align-items: flex-start; }
  .rr-gestao .folha-lista .rr-at { font-weight: 800; color: var(--azul); }
  .rr-gestao .folha-lista small { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .rr-selo { flex: none; align-self: center; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--sel); color: var(--icone); }
  .rr-selo.minha { background: color-mix(in srgb, var(--marca-menta) 28%, transparent); color: var(--texto); }
  .rr-form { display: grid; gap: 12px; margin-top: 14px; padding: 14px; border-radius: 18px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .rr-form h3 { margin: 0; font-size: 16px; }
  .rr-form label { display: grid; gap: 6px; font-size: 13.5px; color: var(--sub); }
  .rr-form input:not([type="checkbox"]), .rr-form textarea, .nc-form input, .nc-form select, .nc-form textarea { font: inherit; font-size: 16px; color: var(--texto); background: var(--entrada); border: 1px solid var(--linha); border-radius: 12px; padding: 12px 14px; min-height: 24px; }
  .rr-form textarea, .nc-form textarea { resize: vertical; min-height: 92px; }
  .rr-atalho { display: flex; align-items: center; border: 1px solid var(--linha); border-radius: 12px; background: var(--entrada); padding-left: 14px; }
  .rr-atalho b { color: var(--azul); font-size: 17px; }
  .rr-atalho input { border: 0 !important; background: transparent !important; flex: 1; min-width: 0; padding-left: 2px !important; }
  .rr-vars { display: flex; gap: 8px; flex-wrap: wrap; }
  .rr-vars button { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 999px; font-size: 13.5px; font-weight: 700; background: var(--sel); color: var(--icone); min-height: 20px; }
  .rr-check { display: flex !important; grid-template-columns: none !important; align-items: center; gap: 10px !important; color: var(--texto) !important; font-size: 15px !important; }
  .rr-check input { width: 20px; height: 20px; accent-color: var(--marca-azul); }
  .rr-form .erro-txt, .nc-form .erro-txt { min-height: 0; }

  /* ---------- nova conversa ---------- */
  .nc-form { display: grid; gap: 14px; }
  .nc-form label { display: grid; gap: 6px; font-size: 13.5px; color: var(--sub); }
  .nc-unidades { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .nc-unidades button { all: unset; cursor: pointer; box-sizing: border-box; text-align: center; padding: 12px 8px; min-height: 48px; border-radius: 14px; border: 1px solid var(--linha); background: var(--entrada); font-weight: 700; font-size: 14.5px; color: var(--texto); }
  .nc-unidades button[aria-pressed="true"] { border-color: var(--marca-azul); background: var(--sel); box-shadow: 0 0 0 2px color-mix(in srgb, var(--marca-azul) 35%, transparent); }
  .nc-msg { position: relative; }
  .nc-msg .rr-lista { left: 0; right: 0; bottom: calc(100% + 4px); width: auto; }
  .nc-teste { all: unset; cursor: pointer; color: var(--azul); font-weight: 700; font-size: 14px; text-align: center; padding: 8px; }
  .nc-tel { font-variant-numeric: tabular-nums; letter-spacing: .02em; }

  /* ---------- áudios: velocidade e transcrição ---------- */
  .audio-bloco { display: block; }
  .audio-extras { display: flex; align-items: center; gap: 6px; margin: 2px 0 0 54px; min-height: 30px; padding-right: 64px; }
  .audio-extras button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 700; color: var(--icone);
    background: color-mix(in srgb, var(--texto) 8%, transparent); }
  .audio-extras button:hover { background: color-mix(in srgb, var(--texto) 14%, transparent); }
  .audio-extras button svg { width: 15px; height: 15px; }
  .audio-extras .vel { min-width: 26px; justify-content: center; font-variant-numeric: tabular-nums; }
  .audio-extras .vel[data-v="1"] { opacity: .85; }
  .audio-extras .vel:not([data-v="1"]) { background: var(--marca-menta); color: #ffffff; }
  .audio-extras button[aria-busy="true"] { opacity: .7; pointer-events: none; }
  .transcricao { margin: 6px 2px 0 4px; padding: 8px 10px; border-radius: 10px; font-size: 13.8px; line-height: 19px; white-space: pre-wrap; color: var(--texto); background: color-mix(in srgb, var(--texto) 6%, transparent); max-width: min(300px, calc(100vw - 110px)); }
  .transcricao::before { content: "Transcrição"; display: block; font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--sub); margin-bottom: 2px; }
  .transcricao.aviso { color: var(--sub); }
  .transcricao.aviso::before { content: none; }
  .transcricao a { color: var(--azul); font-weight: 700; }
  .bal.aud .transcricao { margin-bottom: 14px; }

  /* ---------- balão de texto: Ouvir / Copiar ---------- */
  .bal.lendo { box-shadow: 0 0 0 2px var(--marca-menta), 0 0 16px rgba(216, 57, 149,.45); }
  .bal-acoes { position: fixed; z-index: 40; display: flex; gap: 4px; padding: 5px; border-radius: 999px; background: var(--vidro-forte, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha));
    box-shadow: var(--vidro-brilho, none), 0 12px 34px rgba(4,18,31,.28); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
  .bal-acoes button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; height: 42px; padding: 0 16px; border-radius: 999px; font-weight: 700; font-size: 14.5px; color: var(--texto); }
  .bal-acoes button:hover { background: var(--sel); }
  .bal-acoes svg { width: 19px; height: 19px; }
  #msgs .bal:not(.midia):not(.aud) { cursor: pointer; }

  /* ---------- microfone: segurar para gravar ---------- */
  #enviar { touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .gravando[data-modo="segurar"] #grav-cancelar { opacity: .35; pointer-events: none; }
  .gravando[data-modo="segurar"] .dica { text-indent: calc(-1 * var(--arrasto, 0px)); overflow: hidden; white-space: nowrap; font-weight: 600; }
  .gravando[data-modo="segurar"] #grav-enviar { animation: micVivo 1.2s ease-in-out infinite; box-shadow: 0 0 0 6px color-mix(in srgb, var(--marca-azul) 22%, transparent); }
  @keyframes micVivo { 50% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--marca-azul) 10%, transparent); } }
  `;
  document.head.append(el('style', { id: 'conversa-extras-css', text: CSS }));

  // ------------------------------------------------------------ utilidades
  const primeiro = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  const conversa = () => estado.detalhe?.conversa;
  let recursos = { ia: Boolean(estado.situacao?.iaLigada), transcricao: false };
  const carregarRecursos = () => api('/api/conversa/recursos').then((r) => { recursos = r; }).catch(() => {});
  carregarRecursos();
  setInterval(carregarRecursos, 60000);
  const ehAdmin = () => ['admin', 'direcao'].includes(estado.eu?.papel);
  const linkConexoes = () => (ehAdmin() ? el('a', { href: '/conexoes', text: 'Abrir Conexões' }) : null);

  /** Folha de vidro (sobe de baixo no celular). Devolve { d, corpo, titulo }. */
  function folha(id, tituloTxt, classe = '') {
    let d = $(id);
    if (!d) {
      const titulo = el('h2');
      const fechar = el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: () => d.close() });
      const corpo = el('div', { class: 'cx-corpo' });
      d = el('dialog', { id, class: `folha cx-folha ${classe}` }, el('div', { class: 'folha-topo' }, el('span'), titulo, fechar), corpo);
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      document.body.append(d);
      d._corpo = corpo; d._titulo = titulo;
    }
    d._titulo.textContent = tituloTxt;
    return { d, corpo: d._corpo, titulo: d._titulo };
  }
  const abrirFolha = (d) => { if (!d.open) d.showModal(); };
  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copiado ✓'); } catch { toast('Não deu para copiar aqui.'); } };

  // ------------------------------------------------------------ respostas rápidas
  let respostas = null, respostasEm = 0;
  async function carregarRespostas(forcar) {
    if (!forcar && respostas && Date.now() - respostasEm < 60000) return respostas;
    try { respostas = await api('/api/respostas-rapidas'); respostasEm = Date.now(); } catch { respostas = respostas || []; }
    return respostas;
  }
  /** Troca {nome}, {unidade} e {atendente}. Variável sem valor some sem deixar espaço sobrando. */
  function preencher(texto, c = conversa(), nomeCliente) {
    const valores = {
      nome: primeiro(nomeCliente !== undefined ? nomeCliente : c?.nome),
      unidade: c ? (ui.UNIDADE[c.unidade] || c.unidade) : '',
      atendente: primeiro(estado.eu?.nome),
    };
    let vazio = false;
    const t = String(texto).replace(/\{(nome|unidade|atendente)\}/gi, (_, k) => { const v = valores[k.toLowerCase()]; if (!v) vazio = true; return v; });
    return vazio ? t.replace(/[ \t]+([,!?.;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t,]+/gm, '') : t;
  }

  /** A palavra que está sendo digitada antes do cursor, se começar com "/". */
  function barraNoCursor(area) {
    const fim = area.selectionStart ?? area.value.length;
    if (area.selectionEnd !== fim) return null;
    const antes = area.value.slice(0, fim);
    const m = /(^|\s)\/([^\s/]{0,30})$/.exec(antes);
    if (!m) return null;
    return { inicio: fim - m[2].length - 1, fim, busca: m[2].toLowerCase() };
  }
  const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /** Liga a lista flutuante de respostas rápidas a um campo de texto. */
  function ligarRespostas(area, ancora, opcoes = {}) {
    const lista = el('div', { class: 'rr-lista', role: 'listbox', 'aria-label': 'Respostas rápidas', hidden: '' });
    const itens = el('div', { class: 'rr-itens' });
    lista.append(itens, el('button', { type: 'button', class: 'rr-gerenciar', html: SVG.engrenagem, onmousedown: (e) => e.preventDefault(), onclick: () => { fechar(); abrirGestao(); } }, document.createTextNode('Gerenciar respostas rápidas')));
    ancora.append(lista);
    let alvo = null, filtradas = [], sel = 0;

    const fechar = () => { lista.hidden = true; alvo = null; };
    function desenhar() {
      itens.replaceChildren();
      if (!filtradas.length) {
        itens.append(el('div', { class: 'rr-vazio', text: respostas?.length ? 'Nenhuma resposta com esse atalho.' : 'Nenhuma resposta rápida ainda. Crie a primeira em "Gerenciar".' }));
        return;
      }
      filtradas.forEach((r, i) => {
        const b = el('button', { type: 'button', class: 'rr-item', role: 'option', 'aria-selected': String(i === sel), onmousedown: (e) => e.preventDefault(), onclick: () => escolher(r) },
          el('b', { text: '/' + r.atalho }), el('span', { text: preencher(r.texto, opcoes.conversa?.(), opcoes.nome?.()).replace(/\s+/g, ' ') }),
          r.pessoal ? el('small', { text: 'Minha' }) : null);
        itens.append(b);
      });
      itens.children[sel]?.scrollIntoView({ block: 'nearest' });
    }
    async function atualizarLista() {
      const b = barraNoCursor(area);
      if (!b) { fechar(); return; }
      alvo = b;
      const todas = await carregarRespostas();
      if (!alvo) return;
      const q = semAcento(alvo.busca);
      filtradas = todas.filter((r) => r.atalho.includes(q) || (q.length > 1 && semAcento(r.texto).includes(q)))
        .sort((a, b2) => Number(!a.atalho.startsWith(q)) - Number(!b2.atalho.startsWith(q)) || Number(!a.atalho.includes(q)) - Number(!b2.atalho.includes(q)));
      sel = Math.min(sel, Math.max(0, filtradas.length - 1));
      lista.hidden = false;
      desenhar();
    }
    function escolher(r) {
      const b = alvo || barraNoCursor(area); if (!b) return;
      const texto = preencher(r.texto, opcoes.conversa?.(), opcoes.nome?.());
      area.value = area.value.slice(0, b.inicio) + texto + area.value.slice(b.fim);
      const pos = b.inicio + texto.length;
      fechar();
      area.focus(); area.setSelectionRange(pos, pos);
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }
    area.addEventListener('input', () => { sel = 0; atualizarLista(); });
    area.addEventListener('click', atualizarLista);
    area.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== area) fechar(); }, 150));
    // Na fase de captura do contêiner: roda antes do Enter-envia do campo.
    ancora.addEventListener('keydown', (e) => {
      if (lista.hidden || e.target !== area) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!filtradas.length) return;
        e.preventDefault(); e.stopPropagation();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + filtradas.length) % filtradas.length; desenhar();
      } else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        if (!filtradas.length) { if (e.key === 'Enter') fechar(); return; }
        e.preventDefault(); e.stopPropagation(); escolher(filtradas[sel]);
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); }
    }, true);
    return { fechar };
  }
  const rrComposer = ligarRespostas(campo, document.querySelector('.compor'), { conversa });

  // Gerenciar (folha de vidro)
  let editando = null;
  async function abrirGestao() {
    const { d, corpo } = folha('d-respostas', 'Respostas rápidas', 'rr-gestao');
    editando = null;
    await carregarRespostas(true);
    desenharGestao(corpo);
    abrirFolha(d);
  }
  function desenharGestao(corpo) {
    const gestor = ui.ehGestor(estado.eu);
    const lista = respostas || [];
    const caixaLista = el('div', { class: 'folha-lista' }, ...(lista.length ? lista.map((r) => el('button', { type: 'button', 'aria-disabled': String(!r.podeEditar),
      onclick: () => { if (!r.podeEditar) { toast('Só a gestão muda as respostas da empresa.'); return; } editando = r; desenharGestao(corpo); corpo.querySelector('.rr-form input')?.focus(); } },
      el('span', {}, el('b', { class: 'rr-at', text: '/' + r.atalho }), el('small', { text: r.texto })),
      el('i', { class: 'rr-selo' + (r.pessoal ? ' minha' : ''), text: r.pessoal ? 'Minha' : 'Empresa' }))) : [el('p', { class: 'cx-sub', style: 'padding:14px 16px;margin:0', text: 'Nenhuma resposta ainda. Crie a primeira aqui embaixo: digite / no campo de mensagem para usar.' })]));

    const r = editando;
    const atalho = el('input', { name: 'atalho', maxlength: '30', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'preco', required: '', inputmode: 'text' });
    const texto = el('textarea', { name: 'texto', maxlength: '3000', required: '', rows: '4', placeholder: 'Oi {nome}! A progressiva na unidade {unidade}…' });
    atalho.value = r ? r.atalho : ''; texto.value = r ? r.texto : '';
    const pessoal = el('input', { type: 'checkbox', name: 'pessoal' });
    const erro = el('div', { class: 'erro-txt' });
    const inserir = (v) => { const i = texto.selectionStart ?? texto.value.length; texto.value = texto.value.slice(0, i) + v + texto.value.slice(texto.selectionEnd ?? i); texto.focus(); texto.setSelectionRange(i + v.length, i + v.length); };
    const salvar = el('button', { class: 'botao', type: 'submit', text: r ? 'Salvar' : 'Criar resposta' });
    const form = el('form', { class: 'rr-form' },
      el('h3', { text: r ? `Editar /${r.atalho}` : 'Nova resposta' }),
      el('label', {}, document.createTextNode('Atalho'), el('div', { class: 'rr-atalho' }, el('b', { text: '/' }), atalho)),
      el('label', {}, document.createTextNode('Texto'), texto),
      el('div', { class: 'rr-vars' }, ...['{nome}', '{unidade}', '{atendente}'].map((v) => el('button', { type: 'button', text: v, title: { '{nome}': 'Primeiro nome da cliente', '{unidade}': 'Unidade da conversa', '{atendente}': 'Seu primeiro nome' }[v], onclick: () => inserir(v) }))),
      el('span', { class: 'cx-sub', text: '{nome} vira o primeiro nome da cliente, {unidade} a unidade e {atendente} o seu nome.' }),
      !r && gestor ? el('label', { class: 'rr-check' }, pessoal, document.createTextNode('Só para mim (as outras pessoas não veem)')) : null,
      !r && !gestor ? el('span', { class: 'cx-sub', text: 'Esta resposta fica só para você. As da empresa são criadas pela gestão.' }) : null,
      erro,
      el('div', { class: 'cx-botoes' },
        r ? el('button', { class: 'botao leve', type: 'button', text: 'Apagar', onclick: async () => {
          if (!confirm(`Apagar a resposta /${r.atalho}?`)) return;
          try { await api('/api/respostas-rapidas/' + r.id, { method: 'DELETE' }); editando = null; await carregarRespostas(true); desenharGestao(corpo); toast('Resposta apagada'); } catch (x) { erro.textContent = x.message; }
        } }) : null,
        r ? el('button', { class: 'botao leve', type: 'button', text: 'Cancelar', onclick: () => { editando = null; desenharGestao(corpo); } }) : null,
        salvar));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.textContent = ''; salvar.disabled = true;
      const corpoPedido = { atalho: atalho.value, texto: texto.value };
      try {
        if (r) await api('/api/respostas-rapidas/' + r.id, { method: 'PATCH', body: JSON.stringify(corpoPedido) });
        else await post('/api/respostas-rapidas', { ...corpoPedido, ...(gestor ? { pessoal: pessoal.checked } : {}) });
        editando = null; await carregarRespostas(true); desenharGestao(corpo); toast(r ? 'Resposta salva ✓' : 'Resposta criada ✓');
      } catch (x) { erro.textContent = x.message; }
      finally { salvar.disabled = false; }
    });
    corpo.replaceChildren(caixaLista, form);
  }

  // ------------------------------------------------------------ bolinha IA
  const OPCOES_IA = [
    { acao: 'sugerir', titulo: 'Sugerir resposta', sub: 'A IA escreve a próxima mensagem para você revisar', ic: SVG.brilho },
    { acao: 'melhorar', titulo: 'Melhorar meu texto', sub: 'Reescreve o que está no campo, mais claro e gentil', ic: SVG.lapis },
    { acao: 'resumir', titulo: 'Resumir conversa', sub: 'O que ela quer, o que foi combinado e o que falta', ic: SVG.resumo },
    { acao: 'proximo', titulo: 'Próximo passo', sub: 'O que fazer agora com essa cliente', ic: SVG.passo },
    { acao: 'explicar_audio', titulo: 'Explicar último áudio', sub: 'Transcreve e explica o que ela disse', ic: SVG.audio },
  ];
  const botaoIa = el('button', { class: 'icone ia-topo', id: 'topo-ia', type: 'button', title: 'Ajuda da IA', 'aria-label': 'Ajuda da IA', 'aria-haspopup': 'dialog', text: 'IA', onclick: () => abrirMenuIa() });
  const agendar = $('topo-agendar');
  agendar?.parentElement?.insertBefore(botaoIa, agendar);

  function abrirMenuIa() {
    const c = conversa(); if (!c) return;
    carregarRecursos();
    const { d, corpo } = folha('d-ia', 'Ajuda da IA');
    const temAudio = (estado.detalhe?.mensagens || []).some((m) => m.autor === 'cliente' && m.anexo?.tipo === 'audio');
    const temTexto = campo.value.trim().length > 0;
    const lista = el('div', { class: 'folha-lista' }, ...OPCOES_IA.filter((o) => o.acao !== 'explicar_audio' || temAudio).map((o) => {
      const sub = o.acao === 'melhorar' && !temTexto ? 'Escreva algo no campo primeiro' : o.sub;
      return el('button', { type: 'button', class: 'cx-op ia', 'aria-disabled': String(o.acao === 'melhorar' && !temTexto), onclick: () => {
        if (o.acao === 'melhorar' && !campo.value.trim()) { toast('Escreva sua mensagem no campo; a IA melhora o que estiver lá.'); d.close(); campo.focus(); return; }
        pedirIa(o.acao, o.titulo);
      } }, el('i', { html: o.ic }), el('span', {}, el('b', { text: o.titulo }), el('small', { text: sub })));
    }));
    corpo.replaceChildren(lista);
    if (!recursos.ia && !estado.situacao?.iaLigada) corpo.append(el('p', { class: 'cx-aviso' }, document.createTextNode('A IA ainda está desligada: falta configurar a chave da IA (Anthropic) em Conexões. '), linkConexoes()));
    abrirFolha(d);
  }

  let pedidoIa = 0;
  async function pedirIa(acao, titulo) {
    const c = conversa(); if (!c) return;
    const { d, corpo } = folha('d-ia', titulo);
    const meu = ++pedidoIa;
    corpo.replaceChildren(el('div', { class: 'cx-resultado' }, el('div', { class: 'cx-pensando', 'aria-label': 'A IA está pensando' }, el('i'), el('i'), el('i')), el('span', { class: 'cx-sub', text: 'A IA está lendo a conversa…' })));
    abrirFolha(d); botaoIa.setAttribute('aria-busy', 'true');
    try {
      const r = await post(`/api/conversas/${c.id}/ia`, { acao, texto: acao === 'melhorar' ? campo.value : undefined });
      if (meu !== pedidoIa || conversa()?.id !== c.id) return;
      d._titulo.textContent = r.titulo;
      const blocos = [];
      const soMensagem = r.mensagem && r.mensagem === r.texto;
      blocos.push(el('div', { class: 'cx-texto' + (soMensagem ? ' cx-citacao' : ''), text: r.texto }));
      if (r.mensagem && !soMensagem) blocos.push(el('div', { class: 'cx-rotulo', text: 'Mensagem sugerida' }), el('div', { class: 'cx-texto cx-citacao', text: r.mensagem }));
      const botoes = el('div', { class: 'cx-botoes' });
      botoes.append(el('button', { class: 'botao leve', type: 'button', html: SVG.copiar, onclick: () => copiar(r.mensagem || r.texto) }, document.createTextNode('Copiar')));
      if (r.mensagem) botoes.append(el('button', { class: 'botao', type: 'button', html: SVG.resposta, onclick: () => { d.close(); ui.usarTexto(r.mensagem); } }, document.createTextNode('Usar')));
      blocos.push(botoes, el('button', { type: 'button', class: 'nc-teste', text: 'Pedir outra coisa à IA', onclick: abrirMenuIa }));
      corpo.replaceChildren(el('div', { class: 'cx-resultado' }, ...blocos));
      if (acao === 'explicar_audio') carregarTranscricoes(true);
    } catch (x) {
      if (meu !== pedidoIa) return;
      corpo.replaceChildren(el('div', { class: 'cx-resultado' }, el('p', { class: 'cx-aviso' }, document.createTextNode(x.message + ' '), /Conexões/.test(x.message) ? linkConexoes() : null),
        el('div', { class: 'cx-botoes' }, el('button', { class: 'botao leve', type: 'button', text: 'Voltar', onclick: abrirMenuIa }), el('button', { class: 'botao', type: 'button', text: 'Tentar de novo', onclick: () => pedirIa(acao, titulo) }))));
    } finally { if (meu === pedidoIa) botaoIa.removeAttribute('aria-busy'); }
  }

  // ------------------------------------------------------------ áudios: velocidade e transcrição
  const transcricoes = new Map();
  let transcricoesDe = null;
  async function carregarTranscricoes(forcar) {
    const c = conversa(); if (!c) return;
    if (!forcar && transcricoesDe === c.id) return;
    transcricoesDe = c.id;
    try {
      const t = await api(`/api/conversas/${c.id}/transcricoes`);
      for (const [id, texto] of Object.entries(t)) transcricoes.set(id, texto);
      document.querySelectorAll('#msgs .audio-bloco').forEach(mostrarTranscricao);
    } catch {}
  }
  const VELOCIDADES = [1, 1.5, 2];
  const rotuloVel = (v) => String(v).replace('.', ',') + 'x';
  function mostrarTranscricao(bloco) {
    const t = transcricoes.get(bloco.dataset.mid);
    if (t === undefined) return;
    bloco.querySelector('.transcricao.aviso')?.remove();
    let caixa = bloco.querySelector('.transcricao:not(.aviso)');
    if (!caixa) { caixa = el('div', { class: 'transcricao' }); bloco.append(caixa); }
    caixa.textContent = t;
    bloco.querySelector('.audio-extras .transcrever')?.remove();
  }
  function decorarAudio(bloco) {
    if (bloco.dataset.ext) return;
    bloco.dataset.ext = '1';
    const audio = bloco._audio;
    const vel = el('button', { type: 'button', class: 'vel', 'data-v': '1', title: 'Velocidade', 'aria-label': 'Velocidade 1x', text: '1x' });
    vel.addEventListener('click', () => {
      const atual = Number(vel.dataset.v); const prox = VELOCIDADES[(VELOCIDADES.indexOf(atual) + 1) % VELOCIDADES.length];
      vel.dataset.v = String(prox); vel.textContent = rotuloVel(prox); vel.setAttribute('aria-label', 'Velocidade ' + rotuloVel(prox));
      if (audio) { audio.playbackRate = prox; audio.defaultPlaybackRate = prox; }
    });
    audio?.addEventListener('play', () => { audio.playbackRate = Number(vel.dataset.v); });
    const transcrever = el('button', { type: 'button', class: 'transcrever', html: SVG.texto, title: 'Transcrever áudio' }, document.createTextNode('Transcrever'));
    transcrever.addEventListener('click', () => pedirTranscricao(bloco, transcrever));
    bloco.append(el('div', { class: 'audio-extras' }, vel, transcrever));
    mostrarTranscricao(bloco);
  }
  async function pedirTranscricao(bloco, botao) {
    const c = conversa(); if (!c) return;
    bloco.querySelector('.transcricao.aviso')?.remove();
    if (!recursos.transcricao) {
      await carregarRecursos();
      if (!recursos.transcricao) {
        bloco.append(el('div', { class: 'transcricao aviso' }, document.createTextNode('Para transcrever, configure a chave da OpenAI em Conexões (Transcrição de áudio). '), linkConexoes()));
        return;
      }
    }
    botao.setAttribute('aria-busy', 'true'); botao.lastChild.textContent = 'Transcrevendo…';
    try {
      const r = await post(`/api/conversas/${c.id}/midias/${bloco.dataset.mid}/transcrever`);
      transcricoes.set(bloco.dataset.mid, r.texto);
      document.querySelectorAll(`#msgs .audio-bloco[data-mid="${CSS.escape(bloco.dataset.mid)}"]`).forEach(mostrarTranscricao);
      mostrarTranscricao(bloco);
    } catch (x) {
      botao.removeAttribute('aria-busy'); botao.lastChild.textContent = 'Transcrever';
      bloco.append(el('div', { class: 'transcricao aviso' }, document.createTextNode(x.message + ' '), /Conexões/.test(x.message) ? linkConexoes() : null));
    }
  }

  // ------------------------------------------------------------ balão de texto: Ouvir / Copiar
  const fala = window.speechSynthesis;
  let vozPt = null;
  const escolherVoz = () => { const vs = fala?.getVoices?.() || []; vozPt = vs.find((v) => /^pt[-_]BR$/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null; };
  if (fala) { escolherVoz(); fala.addEventListener?.('voiceschanged', escolherVoz); }
  let lendo = null;
  function pararFala() { try { fala?.cancel(); } catch {} lendo?.classList.remove('lendo'); lendo = null; }
  function ouvir(bal, texto) {
    if (!fala || !window.SpeechSynthesisUtterance) { toast('Este navegador não lê mensagens em voz alta.'); return; }
    pararFala();
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR'; if (vozPt) u.voice = vozPt; u.rate = 1;
    u.onend = u.onerror = () => { if (lendo === bal) pararFala(); };
    lendo = bal; bal.classList.add('lendo');
    fala.speak(u);
  }
  const textoDoBalao = (bal) => {
    const id = bal.dataset.id;
    const m = (estado.detalhe?.mensagens || []).find((x) => x.id === id);
    return m ? m.texto : Array.from(bal.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  };
  const acoes = el('div', { class: 'bal-acoes', hidden: '', role: 'menu' });
  document.body.append(acoes);
  const fecharAcoes = () => { acoes.hidden = true; };
  function abrirAcoes(bal) {
    const texto = textoDoBalao(bal); if (!texto) return;
    const falando = lendo === bal;
    acoes.replaceChildren(
      el('button', { type: 'button', role: 'menuitem', html: falando ? SVG.parar : SVG.alto, onclick: () => { fecharAcoes(); falando ? pararFala() : ouvir(bal, texto); } }, document.createTextNode(falando ? 'Parar' : 'Ouvir')),
      el('button', { type: 'button', role: 'menuitem', html: SVG.copiar, onclick: () => { fecharAcoes(); copiar(texto); } }, document.createTextNode('Copiar')));
    acoes.hidden = false;
    const r = bal.getBoundingClientRect(); const w = acoes.offsetWidth, h = acoes.offsetHeight;
    const esquerda = Math.max(8, Math.min(innerWidth - w - 8, bal.classList.contains('env') ? r.right - w : r.left));
    const topo = r.top - h - 8 > 60 ? r.top - h - 8 : Math.min(innerHeight - h - 8, r.bottom + 8);
    acoes.style.left = esquerda + 'px'; acoes.style.top = topo + 'px';
  }
  $('msgs').addEventListener('click', (e) => {
    const bal = e.target.closest('.bal');
    if (!bal || bal.classList.contains('midia') || bal.classList.contains('aud') || e.target.closest('a, button, video, audio')) return;
    if (!getSelection().isCollapsed) return; // selecionando texto
    e.stopPropagation();
    abrirAcoes(bal);
  });
  document.addEventListener('click', (e) => { if (!acoes.hidden && !e.target.closest('.bal-acoes')) fecharAcoes(); });
  $('msgs').addEventListener('scroll', fecharAcoes, { passive: true });
  addEventListener('resize', fecharAcoes);

  // ------------------------------------------------------------ conversa redesenhada: decorar o que é novo
  let aberta = null;
  new MutationObserver(() => {
    const c = conversa();
    if (c && c.id !== aberta) { aberta = c.id; pararFala(); fecharAcoes(); rrComposer.fechar(); carregarTranscricoes(); }
    document.querySelectorAll('#msgs .audio-bloco:not([data-ext])').forEach(decorarAudio);
    if (lendo && !lendo.isConnected) {
      // O balão foi redesenhado: a marca de "lendo" passa para o novo.
      const novo = document.querySelector(`#msgs .bal[data-id="${CSS.escape(lendo.dataset.id || '')}"]`);
      if (novo) { lendo = novo; novo.classList.add('lendo'); }
    }
  }).observe($('msgs'), { childList: true });
  document.querySelectorAll('#msgs .audio-bloco:not([data-ext])').forEach(decorarAudio);

  // ------------------------------------------------------------ nova conversa por número
  /** Máscara BR enquanto digita: (71) 98812-4471. Aceita colar com +55, espaços e traços. */
  function soDigitos(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
    return d.slice(0, 11);
  }
  function mascara(v) {
    const d = soDigitos(v);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  function unidadesMinhas() {
    const eu = estado.eu || {};
    const todas = ['norte', 'sumare'];
    return ['admin', 'direcao'].includes(eu.papel) || !Array.isArray(eu.unidades) ? todas : todas.filter((u) => eu.unidades.includes(u));
  }
  function novaConversa() {
    const { d, corpo } = folha('d-nova', 'Nova conversa');
    const unidades = unidadesMinhas();
    let unidade = unidades[0] || 'norte';
    const tel = el('input', { class: 'nc-tel', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '(71) 98812-4471', required: '', 'aria-label': 'Telefone com DDD' });
    tel.addEventListener('input', () => { const fim = tel.selectionStart === tel.value.length; tel.value = mascara(tel.value); if (fim) tel.setSelectionRange(tel.value.length, tel.value.length); });
    tel.addEventListener('paste', (e) => { const t = e.clipboardData?.getData('text'); if (t) { e.preventDefault(); tel.value = mascara(t); tel.dispatchEvent(new Event('input')); } });
    const nome = el('input', { autocomplete: 'off', maxlength: '80', placeholder: 'Como ela se chama (opcional)', autocapitalize: 'words' });
    const msg = el('textarea', { rows: '4', maxlength: '4000', required: '', placeholder: 'Oi! Aqui é da Império Progressivas… (digite / para respostas rápidas)' });
    const erro = el('div', { class: 'erro-txt' });
    const botoesUnidade = unidades.map((u) => el('button', { type: 'button', 'aria-pressed': String(u === unidade), text: ui.UNIDADE[u] || u, onclick: (e) => {
      unidade = u; botoesUnidade.forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    } }));
    const enviar = el('button', { class: 'botao', type: 'submit', html: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87Z"/></svg>' }, document.createTextNode('Enviar e abrir'));
    const caixaMsg = el('label', { class: 'nc-msg' }, document.createTextNode('Primeira mensagem'), msg);
    const form = el('form', { class: 'nc-form' },
      el('label', {}, document.createTextNode('Telefone com DDD'), tel),
      el('label', {}, document.createTextNode('Nome'), nome),
      unidades.length > 1 ? el('div', { style: 'display:grid;gap:6px' }, el('span', { class: 'cx-sub', text: 'Unidade (número que vai mandar a mensagem)' }), el('div', { class: 'nc-unidades' }, ...botoesUnidade)) : null,
      caixaMsg, erro,
      el('div', { class: 'cx-botoes' }, enviar),
      estado.situacao?.simulador ? el('button', { type: 'button', class: 'nc-teste', text: 'Criar conversa de teste (simulador)', onclick: () => { d.close(); ui.abrirTeste(); } }) : null);
    if (!unidades.length) erro.textContent = 'Você ainda não tem unidade. Peça para a gestão liberar.';
    ligarRespostas(msg, caixaMsg, { conversa: () => ({ unidade, nome: nome.value }), nome: () => nome.value });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.textContent = '';
      const d11 = soDigitos(tel.value);
      if (d11.length < 10) { erro.textContent = 'Digite o DDD e o número, por exemplo (71) 98812-4471.'; tel.focus(); return; }
      if (!msg.value.trim()) { erro.textContent = 'Escreva a primeira mensagem.'; msg.focus(); return; }
      enviar.disabled = true;
      try {
        const r = await post('/api/conversas/nova', { telefone: d11, nome: nome.value.trim() || undefined, unidade, texto: msg.value.trim(), atendente: estado.eu?.nome });
        d.close();
        toast(r.nova ? 'Conversa criada ✓' : 'Ela já tinha conversa: mensagem enviada nela ✓');
        await ui.atualizar(); ui.abrir(r.id);
      } catch (x) { erro.textContent = x.message; }
      finally { enviar.disabled = false; }
    });
    corpo.replaceChildren(form);
    abrirFolha(d);
    setTimeout(() => tel.focus(), 60);
  }

  window.SintoniaConversa = { novaConversa, abrirMenuIa, abrirRespostas: abrirGestao, preencher };
})();
