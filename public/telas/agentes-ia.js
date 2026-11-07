/* Estúdio de agentes de IA (aba Inteligência): sub-abas Visão geral · Agentes · Treinamento · Memória · Comandos · Configuração.
 * Embrulha a tela "ia" (/telas/ia.js), que continua sendo a Visão geral. Também põe na conversa aberta quem está no controle
 * (IA ou equipe) com os botões "Assumir" e "Devolver para a IA".
 * Todo texto que vem do servidor entra por textContent (el(..., { text })), nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const geral = window.SintoniaTelas.ia;
  const ABAS = [
    ['geral', 'Visão geral'],
    ['agentes', 'Agentes'],
    ['treinamento', 'Treinamento'],
    ['memoria', 'Memória'],
    ['comandos', 'Comandos'],
    ['configuracao', 'Configuração'],
  ];
  const lerAba = () => { try { return localStorage.getItem('sintonia.ia.aba') || 'geral'; } catch { return 'geral'; } };
  const gravarAba = (a) => { try { localStorage.setItem('sintonia.ia.aba', a); } catch {} };
  let aba = lerAba();
  if (!ABAS.some(([id]) => id === aba)) aba = 'geral';
  let geracao = 0;
  let agenteTreino = null;

  const SVG = {
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z"/></svg>',
    brilho: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" opacity=".75"/></svg>',
    chave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/></svg>',
    ferramenta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6Z"/></svg>',
  };

  const CSS = `
  .agx { max-width: 1180px; margin: 0 auto; display: grid; gap: 18px; min-width: 0; }
  .agx-trilho { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha)); box-shadow: var(--vidro-brilho, none); overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; max-width: 100%; }
  .agx-trilho::-webkit-scrollbar { display: none; }
  .agx-trilho button { all: unset; cursor: pointer; flex: none; padding: 9px 15px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); white-space: nowrap; min-height: 22px; }
  .agx-trilho button[aria-selected="true"] { background: var(--vidro-ativo, var(--sel)); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)), 0 4px 14px rgba(16,110,190,.12); }
  .agx-trilho button:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 1px; }
  .agx-conteudo { min-width: 0; }
  .agx-topo { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .agx-topo h1 { margin: 0; font-family: var(--fonte-titulo); font-size: 30px; font-weight: 800; letter-spacing: -.01em; }
  .agx-sub { margin: 0; color: var(--sub); font-size: 14px; line-height: 1.45; }
  .agx-vidro { background: var(--vidro-fundo, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha)); border-radius: 22px; box-shadow: var(--vidro-brilho, none); padding: 16px; display: grid; gap: 12px; min-width: 0; }
  .agx-vidro h2 { margin: 0; font-size: 17px; font-weight: 750; display: flex; align-items: center; gap: 8px; }
  .agx-vidro h2 small { font-size: 12.5px; color: var(--sub); font-weight: 600; margin-left: auto; }
  .agx-grade { display: grid; gap: 14px; grid-template-columns: 1fr; }
  @media (min-width: 700px) { .agx-grade.cartoes { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1100px) { .agx-grade.cartoes { grid-template-columns: repeat(3, minmax(0, 1fr)); } .agx-editor { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: start; } .agx-editor .agx-lado { position: sticky; top: 12px; } }
  .agx-editor { display: grid; gap: 16px; }
  .agx-col { display: grid; gap: 14px; min-width: 0; align-content: start; }
  .agx-cartao { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 10px; padding: 16px; border-radius: 22px; background: var(--vidro-fundo, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha)); box-shadow: var(--vidro-brilho, none); transition: transform .18s, box-shadow .18s; min-width: 0; }
  .agx-cartao:hover { transform: translateY(-1px); }
  .agx-cartao:focus-visible { outline: 2px solid var(--marca-azul); }
  .agx-cab { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .agx-cab .agx-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .agx-cab b { font-size: 17px; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agx-cab .agx-txt > span { font-size: 13px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agx-av { width: 48px; height: 48px; border-radius: 16px; flex: none; display: grid; place-items: center; font-size: 26px; background: var(--marca-gradiente); color: #fff; overflow: hidden; box-shadow: 0 6px 18px rgba(16,110,190,.28); }
  .agx-av img { width: 100%; height: 100%; object-fit: cover; }
  .agx-av.p { width: 34px; height: 34px; border-radius: 11px; font-size: 18px; }
  .agx-pilulas { display: flex; flex-wrap: wrap; gap: 6px; }
  .agx-pil { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; border-radius: 999px; padding: 4px 10px; background: var(--vidro-item, var(--painel)); border: 1px solid var(--vidro-borda, var(--linha)); color: var(--texto); }
  .agx-pil.menta { background: rgba(15,252,190,.16); border-color: rgba(15,252,190,.45); }
  .agx-pil.coral { background: rgba(255,122,89,.14); border-color: rgba(255,122,89,.4); }
  .agx-pil i { width: 7px; height: 7px; border-radius: 50%; background: var(--sub); }
  .agx-pil.menta i { background: #0bd9a3; box-shadow: 0 0 8px rgba(15,252,190,.9); }
  .agx-nota { display: inline-grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; flex: none; font-weight: 800; font-size: 15px; background: conic-gradient(var(--marca-menta) calc(var(--n) * 1%), var(--linha) 0); position: relative; }
  .agx-nota::before { content: ""; position: absolute; inset: 4px; border-radius: 50%; background: var(--fundo); }
  .agx-nota span { position: relative; font-size: 15px; color: var(--texto); }
  .agx-botao { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 999px; font-size: 15px; font-weight: 650; background: var(--vidro-item, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha)); color: var(--texto); white-space: nowrap; }
  .agx-botao svg { width: 18px; height: 18px; }
  .agx-botao.primario { background: var(--marca-menta); color: #04172b; border-color: transparent; box-shadow: var(--brilho-menta); }
  .agx-botao.perigo { color: #d9534f; border-color: rgba(217,83,79,.45); }
  .agx-botao[disabled] { opacity: .55; cursor: default; }
  .agx-botao.peq { min-height: 36px; padding: 0 13px; font-size: 14px; }
  .agx-link { all: unset; cursor: pointer; color: var(--marca-azul); font-weight: 650; font-size: 14px; }
  [data-tema="escuro"] .agx-link { color: var(--marca-menta); }
  .agx-campo { display: grid; gap: 6px; min-width: 0; }
  .agx-campo > span { font-size: 13px; font-weight: 650; color: var(--sub); }
  .agx-campo input, .agx-campo textarea, .agx-campo select, .agx-entrada { font: inherit; font-size: 15px; color: var(--texto); background: var(--entrada, var(--fundo)); border: 1px solid var(--linha); border-radius: 14px; padding: 11px 13px; width: 100%; box-sizing: border-box; min-height: 44px; }
  .agx-campo textarea { resize: vertical; min-height: 76px; line-height: 1.4; }
  .agx-linha2 { display: grid; gap: 10px; grid-template-columns: 1fr; }
  @media (min-width: 560px) { .agx-linha2 { grid-template-columns: 1fr 1fr; } }
  .agx-seg { display: inline-flex; width: fit-content; max-width: 100%; box-sizing: border-box; padding: 3px; border-radius: 18px; background: var(--painel); border: 1px solid var(--linha); gap: 2px; flex-wrap: wrap; }
  .agx-seg button { all: unset; cursor: pointer; padding: 8px 13px; border-radius: 15px; font-size: 13.5px; font-weight: 600; color: var(--sub); }
  .agx-seg button[aria-pressed="true"] { background: var(--fundo); color: var(--texto); box-shadow: 0 2px 8px rgba(8,36,63,.12); }
  .agx-int { all: unset; cursor: pointer; flex: none; width: 51px; height: 31px; border-radius: 999px; background: var(--linha); position: relative; transition: background .2s; }
  .agx-int::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,.25); transition: transform .2s; }
  .agx-int[aria-checked="true"] { background: var(--marca-gradiente); box-shadow: 0 0 12px rgba(15,252,190,.45); }
  .agx-int[aria-checked="true"]::after { transform: translateX(20px); }
  .agx-int[aria-disabled="true"] { opacity: .6; cursor: default; }
  .agx-opcao { display: flex; align-items: center; gap: 12px; padding: 6px 0; min-width: 0; }
  .agx-opcao .agx-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .agx-opcao b { font-size: 15px; font-weight: 650; }
  .agx-opcao .agx-txt span { font-size: 13px; color: var(--sub); line-height: 1.35; }
  .agx-lista { display: grid; gap: 8px; }
  .agx-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--vidro-item, var(--painel)); border: 1px solid var(--vidro-borda, var(--linha)); min-width: 0; }
  .agx-item .agx-txt { flex: 1; min-width: 0; display: grid; gap: 3px; overflow-wrap: anywhere; }
  .agx-item .agx-txt b { font-size: 14.5px; }
  .agx-item .agx-txt span { font-size: 13.5px; color: var(--sub); line-height: 1.4; white-space: pre-wrap; }
  .agx-x { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; color: var(--sub); flex: none; }
  .agx-x:hover { background: var(--hover); color: #d9534f; }
  .agx-x svg { width: 17px; height: 17px; }
  .agx-marca-chip { all: unset; cursor: pointer; font-size: 13px; font-weight: 600; padding: 6px 11px; border-radius: 999px; border: 1px dashed var(--linha); color: var(--sub); }
  .agx-marca-chip:hover { color: var(--texto); border-style: solid; }
  .agx-checks { display: grid; gap: 8px; grid-template-columns: 1fr; }
  @media (min-width: 560px) { .agx-checks { grid-template-columns: 1fr 1fr; } }
  .agx-check { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--linha); cursor: pointer; font-size: 14.5px; min-height: 44px; box-sizing: border-box; }
  .agx-check input { width: 20px; height: 20px; accent-color: #106ebe; flex: none; }
  .agx-check:has(input:checked) { border-color: rgba(15,252,190,.6); background: rgba(15,252,190,.08); }
  .agx-faixa { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border-radius: 18px; background: rgba(245,184,0,.12); border: 1px solid rgba(245,184,0,.4); font-size: 14px; line-height: 1.45; }
  .agx-faixa svg { width: 20px; height: 20px; flex: none; color: #b88a00; margin-top: 1px; }
  .agx-faixa a { color: inherit; font-weight: 700; }
  .agx-rodape { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; padding: 4px 0; }
  @media (min-width: 1100px) { .agx-rodape { position: sticky; bottom: 0; padding: 12px 0 4px; z-index: 2; } }
  .agx-chat { display: flex; flex-direction: column; gap: 8px; min-height: 220px; max-height: 52vh; overflow-y: auto; padding: 12px; border-radius: 18px; background: var(--chat); }
  .agx-bolha { max-width: 86%; padding: 9px 12px; border-radius: 16px; font-size: 14.5px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: var(--sombra); }
  .agx-bolha.cli { align-self: flex-start; background: var(--recebida); border-top-left-radius: 6px; }
  .agx-bolha.ia { align-self: flex-end; background: var(--enviada); border-top-right-radius: 6px; }
  .agx-bolha .agx-ferr { display: grid; gap: 4px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(8,36,63,.18); font-size: 12.5px; color: var(--sub); white-space: normal; }
  .agx-bolha .agx-ferr div { display: flex; gap: 6px; align-items: flex-start; }
  .agx-bolha .agx-ferr svg { width: 13px; height: 13px; flex: none; margin-top: 2px; }
  .agx-bolha .agx-corrigir { all: unset; cursor: pointer; margin-top: 6px; font-size: 12.5px; font-weight: 650; color: var(--marca-azul); }
  [data-tema="escuro"] .agx-bolha .agx-corrigir { color: var(--marca-menta); }
  .agx-compor { display: flex; gap: 8px; align-items: flex-end; }
  .agx-compor textarea { flex: 1; min-height: 44px; max-height: 120px; resize: none; }
  .agx-redondo { all: unset; cursor: pointer; width: 46px; height: 46px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--marca-gradiente); color: #fff; box-shadow: var(--brilho-azul); }
  .agx-redondo svg { width: 20px; height: 20px; }
  .agx-redondo[disabled] { opacity: .5; cursor: default; }
  .agx-vazio { text-align: center; padding: 26px 12px; color: var(--sub); display: grid; gap: 8px; justify-items: center; }
  .agx-vazio b { color: var(--texto); font-size: 16px; }
  .agx-esq { border-radius: 22px; background: linear-gradient(90deg, var(--linha), var(--hover), var(--linha)); background-size: 200% 100%; animation: agx-brilho 1.2s infinite linear; }
  @keyframes agx-brilho { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .agx-esq { animation: none; } .agx-cartao { transition: none; } }
  .agx-slider { display: grid; gap: 6px; }
  .agx-slider input { width: 100%; accent-color: #106ebe; }
  .agx-slider .agx-pontas { display: flex; justify-content: space-between; font-size: 12.5px; color: var(--sub); font-weight: 600; }
  .agx-plano-itens { display: grid; gap: 6px; max-height: 340px; overflow-y: auto; }
  .agx-exemplos { display: flex; gap: 6px; flex-wrap: wrap; }
  details.agx-sec { border-radius: 22px; background: var(--vidro-fundo, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha)); box-shadow: var(--vidro-brilho, none); overflow: hidden; }
  details.agx-sec > summary { list-style: none; cursor: pointer; padding: 15px 16px; display: flex; align-items: center; gap: 10px; font-weight: 750; font-size: 16px; min-height: 24px; }
  details.agx-sec > summary::-webkit-details-marker { display: none; }
  details.agx-sec > summary small { margin-left: auto; color: var(--sub); font-weight: 600; font-size: 12.5px; }
  details.agx-sec > summary::after { content: "›"; font-size: 22px; color: var(--sub); transform: rotate(90deg); transition: transform .2s; }
  details.agx-sec:not([open]) > summary::after { transform: none; }
  details.agx-sec > .agx-corpo { padding: 0 16px 16px; display: grid; gap: 12px; }
  dialog.agx-dlg { padding: 0; width: min(560px, calc(100vw - 24px)); border-radius: 22px; border: 1px solid var(--vidro-borda, var(--linha)); background: var(--fundo); color: var(--texto); box-shadow: 0 24px 60px rgba(4,23,43,.35); }
  dialog.agx-dlg::backdrop { background: rgba(4,23,43,.45); backdrop-filter: blur(4px); }
  .agx-dlg-corpo { padding: 20px; display: grid; gap: 14px; }
  .agx-dlg-corpo h2 { margin: 0; font-size: 19px; font-weight: 750; }
  .agx-dlg-rodape { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
  /* faixa na conversa: quem está no controle */
  .agx-controle { display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin: 0; font-size: 13.5px; border-bottom: 1px solid var(--linha); background: var(--vidro-fundo, var(--fundo)); min-width: 0; }
  .agx-controle.ia { background: linear-gradient(90deg, rgba(15,252,190,.16), transparent 70%); }
  .agx-controle .agx-txt { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .agx-controle .agx-txt b { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agx-controle .agx-txt span { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .agx-controle .agx-botao { min-height: 34px; padding: 0 12px; font-size: 13.5px; }
  `;
  function estilo() {
    if (document.getElementById('agx-css')) return;
    document.head.append(Object.assign(document.createElement('style'), { id: 'agx-css', textContent: CSS }));
  }

  const erroTxt = (x, padrao = 'Algo deu errado.') => {
    if (!x) return padrao;
    if (x instanceof TypeError || /Failed to fetch|NetworkError/i.test(x.message)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    return x.message || padrao;
  };

  function avatarDe(el, a, classe = '') {
    const caixa = el('span', { class: 'agx-av ' + classe, 'aria-hidden': 'true' });
    const v = (a && a.avatar) || '✦';
    if (/^data:image\//.test(v)) caixa.append(el('img', { src: v, alt: '' }));
    else caixa.textContent = v;
    return caixa;
  }

  // ====================================================================== tela
  function desenhar(caixa, ui) {
    estilo();
    const { el } = ui;
    let raiz = caixa.querySelector(':scope > .agx');
    if (!raiz) {
      caixa.replaceChildren();
      raiz = el('div', { class: 'agx' });
      caixa.append(raiz);
      caixa.classList.add('iax-caixa');
    }
    const trilho = el('div', { class: 'agx-trilho', role: 'tablist', 'aria-label': 'Partes da Inteligência' },
      ...ABAS.map(([id, nome]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(id === aba), 'data-aba': id, text: nome, onclick: () => { if (aba === id) return; aba = id; gravarAba(id); desenhar(caixa, ui); } })));
    const conteudo = el('div', { class: 'agx-conteudo', role: 'tabpanel' });
    raiz.replaceChildren(trilho, conteudo);
    queueMicrotask(() => trilho.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    const minha = ++geracao;
    const vivo = () => minha === geracao && conteudo.isConnected;
    if (aba === 'geral') {
      if (geral) return geral.desenhar(conteudo, ui);
      conteudo.append(el('p', { class: 'agx-sub', text: 'Carregando…' }));
      return;
    }
    const ctx = { ui, el, conteudo, vivo, recarregar: () => desenhar(caixa, ui), irPara: (a) => { aba = a; gravarAba(a); desenhar(caixa, ui); } };
    conteudo.append(el('div', { class: 'agx-esq', style: 'height:180px' }));
    const telas = { agentes: telaAgentes, treinamento: telaTreinamento, memoria: telaMemoria, comandos: telaComandos, configuracao: telaConfiguracao };
    return telas[aba](ctx).catch((x) => {
      if (!vivo()) return;
      conteudo.replaceChildren(el('div', { class: 'agx-vidro' }, el('b', { text: 'Não deu para carregar esta parte.' }), el('span', { class: 'agx-sub', text: erroTxt(x) }), el('button', { class: 'agx-botao', type: 'button', text: 'Tentar de novo', onclick: ctx.recarregar })));
    });
  }

  const gestorDe = (ui) => ui.ehGestor(ui.estado.eu || {});
  const topo = (el, titulo, sub, ...lado) => el('div', { class: 'agx-topo' }, el('div', { style: 'display:grid;gap:4px;min-width:0' }, el('h1', { text: titulo }), sub ? el('p', { class: 'agx-sub', text: sub }) : null), ...lado);
  const avisoChave = (el, ui, chaves) => {
    if (chaves && (chaves.anthropic || chaves.openai)) return null;
    const podeConexoes = ['admin', 'direcao'].includes((ui.estado.eu || {}).papel);
    return el('div', { class: 'agx-faixa', role: 'status' }, el('span', { html: SVG.chave, 'aria-hidden': 'true' }),
      el('span', {}, el('b', { text: 'Configure a chave da IA. ' }), el('span', { text: 'Sem chave, os agentes não respondem nem testam. Ponha a chave geral em Conexões ou uma chave própria no agente. ' }),
        podeConexoes ? el('a', { href: '/conexoes', text: 'Abrir Conexões' }) : null));
  };
  const interruptor = (el, ligado, rotulo, aoMudar, travado) => {
    const b = el('button', { class: 'agx-int', type: 'button', role: 'switch', 'aria-checked': String(Boolean(ligado)), 'aria-label': rotulo, 'aria-disabled': travado ? 'true' : null });
    b.addEventListener('click', () => { if (travado) return; const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); aoMudar(v); });
    return b;
  };
  const campo = (el, rotulo, entrada) => el('label', { class: 'agx-campo' }, el('span', { text: rotulo }), entrada);
  const segmentado = (el, opcoes, atual, aoMudar, travado) => {
    const s = el('div', { class: 'agx-seg', role: 'group' });
    for (const [v, nome] of opcoes) {
      s.append(el('button', { type: 'button', 'aria-pressed': String(v === atual), text: nome, onclick: () => { if (travado) return; s.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', 'false')); s.querySelector(`[data-v="${v}"]`).setAttribute('aria-pressed', 'true'); aoMudar(v); }, 'data-v': v }));
    }
    return s;
  };
  const dialogo = (el, titulo, corpo, acoes) => {
    const dlg = el('dialog', { class: 'agx-dlg' }, el('div', { class: 'agx-dlg-corpo' }, el('h2', { text: titulo }), ...corpo, el('div', { class: 'agx-dlg-rodape' }, ...acoes(() => dlg.close()))));
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return dlg;
  };

  // ====================================================================== Agentes
  async function telaAgentes(ctx, abrirId) {
    const { el, ui, conteudo } = ctx;
    const d = await ui.api('/api/agentes-ia');
    if (!ctx.vivo()) return;
    const gestor = gestorDe(ui);
    if (abrirId || ctx.abrir) {
      const a = d.agentes.find((x) => x.id === (abrirId || ctx.abrir));
      ctx.abrir = null;
      if (a) return editorAgente(ctx, d, a.id);
    }
    const criar = async (modelo) => {
      try {
        const a = await ui.post('/api/agentes-ia', modelo ? { modeloPronto: 'imperio' } : { nome: 'Novo agente' });
        ui.toast('Agente criado ✓');
        editorAgente(ctx, { ...d, agentes: [...d.agentes, a] }, a.id);
      } catch (x) { ui.toast(erroTxt(x)); }
    };
    const novo = gestor ? el('button', { class: 'agx-botao primario', type: 'button', onclick: () => dialogo(el, 'Novo agente de IA', [el('p', { class: 'agx-sub', text: 'Comece pelo modelo da Império (persona, regras, padrões e exemplos prontos para ajustar) ou em branco.' })], (fechar) => [
      el('button', { class: 'agx-botao', type: 'button', text: 'Em branco', onclick: () => { fechar(); criar(false); } }),
      el('button', { class: 'agx-botao primario', type: 'button', text: 'Modelo Império', onclick: () => { fechar(); criar(true); } })]) }, el('span', { html: SVG.mais, 'aria-hidden': 'true' }), el('span', { text: 'Novo agente' })) : null;
    const cartoes = d.agentes.map((a) => el('button', { class: 'agx-cartao', type: 'button', onclick: () => editorAgente(ctx, d, a.id) },
      el('div', { class: 'agx-cab' }, avatarDe(el, a), el('div', { class: 'agx-txt' }, el('b', { text: a.nome }), el('span', { text: (d.modelos[a.provedor] || []).find((m) => m.id === a.modelo)?.nome || a.modelo }))),
      el('div', { class: 'agx-pilulas' },
        el('span', { class: 'agx-pil' + (a.ativo ? ' menta' : '') }, el('i'), el('span', { text: a.ativo ? 'Ligado' : 'Desligado' })),
        ...(a.unidades || []).map((u) => el('span', { class: 'agx-pil', text: ui.UNIDADE[u] || u })),
        a.temChavePropria ? el('span', { class: 'agx-pil', text: 'Chave própria' }) : null,
        el('span', { class: 'agx-pil', text: `${(a.config.regras.sempre.length + a.config.regras.nunca.length)} regras · ${a.config.exemplos.length} exemplos` }))));
    conteudo.replaceChildren(
      topo(el, 'Agentes de IA', 'Cada agente tem persona, regras, respostas modelo, exemplos, conhecimento e memória. Teste antes de colocar para atender.', novo),
      avisoChave(el, ui, d.chaves) || '',
      d.agentes.length ? el('div', { class: 'agx-grade cartoes' }, ...cartoes) : el('div', { class: 'agx-vidro' }, el('div', { class: 'agx-vazio' }, el('b', { text: 'Nenhum agente ainda' }), el('span', { text: gestor ? 'Crie o primeiro: o modelo Império já vem com o jeito do salão.' : 'A gestão cria os agentes aqui.' }), gestor ? el('button', { class: 'agx-botao primario', type: 'button', text: 'Criar com o modelo Império', onclick: () => criar(true) }) : null)));
  }

  async function editorAgente(ctx, lista, id) {
    const { el, ui, conteudo } = ctx;
    const det = await ui.api(`/api/agentes-ia/${id}`);
    if (!ctx.vivo()) return;
    const gestor = gestorDe(ui);
    const trava = !gestor;
    const a = structuredClone(det.agente);
    const c = a.config;
    let mudou = false;
    const marcar = () => { mudou = true; salvarBtn.disabled = false; salvarTopo.disabled = false; };
    const salvarBtn = el('button', { class: 'agx-botao primario', type: 'button', text: 'Salvar', disabled: 'true' });
    const salvarTopo = el('button', { class: 'agx-botao primario peq', type: 'button', text: 'Salvar', disabled: 'true', onclick: () => salvarBtn.click() });
    const entrada = (valor, aoMudar, props = {}) => {
      const i = el(props.tag || 'input', { class: 'agx-entrada', ...(props.tag ? {} : { type: props.type || 'text' }), placeholder: props.placeholder || '', ...(props.rows ? { rows: props.rows } : {}), ...(props.max ? { maxlength: props.max } : {}) });
      i.value = valor ?? '';
      if (trava) i.disabled = true;
      i.addEventListener('input', () => { aoMudar(i.value); marcar(); });
      return i;
    };
    const area = (valor, aoMudar, placeholder, rows = 3) => entrada(valor, aoMudar, { tag: 'textarea', placeholder, rows });

    // ---- identidade
    const avVista = avatarDe(el, a);
    const trocarAvatar = () => { avVista.replaceWith(Object.assign(avatarDe(el, a), {})); };
    const arquivoFoto = el('input', { type: 'file', accept: 'image/*', hidden: '' });
    arquivoFoto.addEventListener('change', async () => {
      const f = arquivoFoto.files[0]; if (!f) return;
      const img = new Image(); img.src = URL.createObjectURL(f); await img.decode().catch(() => {});
      const cv = document.createElement('canvas'); cv.width = cv.height = 128;
      const lado = Math.min(img.width, img.height) || 1;
      cv.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, 128, 128);
      a.avatar = cv.toDataURL('image/jpeg', 0.85); marcar();
      const novo = avatarDe(el, a); idBloco.querySelector('.agx-av').replaceWith(novo);
    });
    const EMOJIS = ['💇‍♀️', '✨', '💜', '🌸', '👩🏽', '🤖', '💬', '⭐'];
    const unidadesSel = el('div', { class: 'agx-pilulas' }, ...['norte', 'sumare'].map((u) => {
      const l = el('label', { class: 'agx-check', style: 'min-height:40px;padding:6px 12px' }, el('input', { type: 'checkbox' }), el('span', { text: ui.UNIDADE[u] || u }));
      const cb = l.querySelector('input'); cb.checked = a.unidades.includes(u); cb.disabled = trava;
      cb.addEventListener('change', () => { a.unidades = cb.checked ? [...new Set([...a.unidades, u])] : a.unidades.filter((x) => x !== u); marcar(); });
      return l;
    }));
    const idBloco = el('div', { class: 'agx-vidro' },
      el('div', { class: 'agx-cab' }, avVista, el('div', { class: 'agx-txt' }, campo(el, 'Nome do agente', entrada(a.nome, (v) => { a.nome = v; }, { max: 60 })))),
      el('div', { class: 'agx-pilulas' }, ...EMOJIS.map((e) => el('button', { class: 'agx-marca-chip', type: 'button', text: e, 'aria-label': `Usar ${e}`, onclick: () => { if (trava) return; a.avatar = e; marcar(); idBloco.querySelector('.agx-av').replaceWith(avatarDe(el, a)); } })),
        gestor ? el('button', { class: 'agx-marca-chip', type: 'button', text: 'Foto…', onclick: () => arquivoFoto.click() }) : null, arquivoFoto),
      el('div', { class: 'agx-campo' }, el('span', { text: 'Atende nas unidades' }), unidadesSel),
      el('div', { class: 'agx-opcao' }, el('span', { class: 'agx-txt' }, el('b', { text: 'Agente ligado' }), el('span', { text: 'Desligado, ele não atende nem entra no “IA atende primeiro”.' })), interruptor(el, a.ativo, 'Agente ligado', (v) => { a.ativo = v; marcar(); }, trava)));
    void trocarAvatar;

    // ---- modelo e chave
    const modeloSel = el('select', { class: 'agx-entrada' });
    const encherModelos = () => { modeloSel.replaceChildren(...(lista.modelos[a.provedor] || []).map((m) => el('option', { value: m.id, text: m.nome }))); if (![...modeloSel.options].some((o) => o.value === a.modelo)) modeloSel.append(el('option', { value: a.modelo, text: a.modelo })); modeloSel.value = a.modelo; };
    encherModelos(); modeloSel.disabled = trava;
    modeloSel.addEventListener('change', () => { a.modelo = modeloSel.value; marcar(); });
    let novaChave;
    const chaveIn = el('input', { class: 'agx-entrada', type: 'password', autocomplete: 'off', placeholder: a.temChavePropria ? '•••••• (chave própria salva; digite para trocar)' : (a.provedor === 'openai' ? 'sk-… (opcional)' : 'sk-ant-… (opcional)') });
    chaveIn.disabled = trava;
    chaveIn.addEventListener('input', () => { novaChave = chaveIn.value.trim() || undefined; marcar(); });
    const geralOk = lista.chaves && lista.chaves[a.provedor];
    const modBloco = el('details', { class: 'agx-sec' }, el('summary', {}, el('span', { text: 'Modelo e chave' }), el('small', { text: a.temChavePropria ? 'chave própria' : 'chave geral' })),
      el('div', { class: 'agx-corpo' },
        el('div', { class: 'agx-campo' }, el('span', { text: 'Provedor' }), segmentado(el, [['anthropic', 'Anthropic (Claude)'], ['openai', 'OpenAI']], a.provedor, (v) => { a.provedor = v; a.modelo = (lista.modelos[v] || [])[0]?.id || a.modelo; encherModelos(); marcar(); }, trava)),
        campo(el, 'Modelo', modeloSel),
        campo(el, 'Chave de API própria (opcional, guardada cifrada)', chaveIn),
        el('p', { class: 'agx-sub', text: a.temChavePropria ? 'Este agente usa a chave própria dele.' : geralOk ? 'Sem chave própria: usa a chave geral de Conexões.' : 'Sem chave própria e sem chave geral: configure a chave para ele responder.' }),
        a.temChavePropria && gestor ? el('button', { class: 'agx-link', type: 'button', text: 'Apagar a chave própria (voltar para a geral)', onclick: () => { novaChave = null; chaveIn.value = ''; chaveIn.placeholder = 'Será apagada ao salvar'; marcar(); } }) : null));

    // ---- persona e tom
    const slider = el('input', { type: 'range', min: '0', max: '100', step: '5', 'aria-label': 'Formal ou descontraída' });
    slider.value = String(a.criatividade); slider.disabled = trava;
    slider.addEventListener('input', () => { a.criatividade = Number(slider.value); marcar(); });
    const persona = el('details', { class: 'agx-sec', open: '' }, el('summary', {}, el('span', { text: 'Persona e tom' })),
      el('div', { class: 'agx-corpo' },
        campo(el, 'Quem é', area(c.persona.quemE, (v) => { c.persona.quemE = v; }, 'Ex.: Lia, consultora da Império, especialista em progressiva.')),
        campo(el, 'Como fala', area(c.persona.comoFala, (v) => { c.persona.comoFala = v; }, 'Ex.: calorosa, chama pelo nome, frases curtas.', 2)),
        el('div', { class: 'agx-slider' }, el('span', { class: 'agx-sub', style: 'font-weight:650', text: 'Jeito' }), slider, el('div', { class: 'agx-pontas' }, el('span', { text: 'Formal' }), el('span', { text: 'Descontraída' }))),
        el('div', { class: 'agx-opcao' }, el('span', { class: 'agx-txt' }, el('b', { text: 'Usa emojis' })), interruptor(el, c.persona.emojis, 'Usa emojis', (v) => { c.persona.emojis = v; marcar(); }, trava)),
        el('div', { class: 'agx-campo' }, el('span', { text: 'Tamanho das respostas' }), segmentado(el, [['curta', 'Curta'], ['media', 'Média'], ['longa', 'Longa']], c.persona.tamanho, (v) => { c.persona.tamanho = v; marcar(); }, trava))));

    // ---- listas editáveis
    const listaTextos = (arr, placeholder) => {
      const caixa = el('div', { class: 'agx-lista' });
      const desenharL = () => {
        caixa.replaceChildren(...arr.map((t, i) => el('div', { class: 'agx-item' }, el('div', { class: 'agx-txt' }, el('span', { style: 'color:var(--texto)', text: t })), trava ? null : el('button', { class: 'agx-x', type: 'button', 'aria-label': 'Remover', html: SVG.lixo, onclick: () => { arr.splice(i, 1); marcar(); desenharL(); } }))));
        if (!trava) {
          const i = el('input', { class: 'agx-entrada', placeholder, maxlength: '300' });
          const add = () => { const v = i.value.trim(); if (!v) return; arr.push(v); marcar(); desenharL(); caixa.querySelector('input')?.focus(); };
          i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
          caixa.append(el('div', { class: 'agx-compor' }, i, el('button', { class: 'agx-botao peq', type: 'button', text: 'Adicionar', onclick: add })));
        }
      };
      desenharL();
      return caixa;
    };
    const regras = el('details', { class: 'agx-sec' }, el('summary', {}, el('span', { text: 'Regras' }), el('small', { text: `${c.regras.sempre.length + c.regras.nunca.length}` })),
      el('div', { class: 'agx-corpo' },
        el('b', { text: 'SEMPRE' }), listaTextos(c.regras.sempre, 'Ex.: sempre oferecer um horário'),
        el('b', { text: 'NUNCA' }), listaTextos(c.regras.nunca, 'Ex.: nunca dar preço sem perguntar o comprimento')));

    const pares = (arr, chaves, rotulos, sugestoes) => {
      const caixa = el('div', { class: 'agx-lista' });
      const desenharP = () => {
        caixa.replaceChildren(...arr.map((x, i) => el('div', { class: 'agx-item' }, el('div', { class: 'agx-txt' }, el('b', { text: x[chaves[0]] }), el('span', { text: x[chaves[1]] })), trava ? null : el('button', { class: 'agx-x', type: 'button', 'aria-label': 'Remover', html: SVG.lixo, onclick: () => { arr.splice(i, 1); marcar(); desenharP(); } }))));
        if (trava) return;
        const i1 = el('input', { class: 'agx-entrada', placeholder: rotulos[0], maxlength: '800' });
        const i2 = el('textarea', { class: 'agx-entrada', placeholder: rotulos[1], rows: '2', maxlength: '1500' });
        if (sugestoes) caixa.append(el('div', { class: 'agx-exemplos' }, ...sugestoes.filter((s) => !arr.some((x) => x[chaves[0]] === s)).map((s) => el('button', { class: 'agx-marca-chip', type: 'button', text: `+ ${s}`, onclick: () => { i1.value = s; i2.focus(); } }))));
        caixa.append(i1, i2, el('button', { class: 'agx-botao peq', type: 'button', style: 'justify-self:start', text: 'Adicionar', onclick: () => { if (!i1.value.trim() || !i2.value.trim()) return ui.toast('Preencha os dois campos.'); arr.push({ [chaves[0]]: i1.value.trim(), [chaves[1]]: i2.value.trim() }); marcar(); desenharP(); } }));
      };
      desenharP();
      return caixa;
    };
    const padroes = el('details', { class: 'agx-sec' }, el('summary', {}, el('span', { text: 'Padrões de resposta' }), el('small', { text: String(c.padroes.length) })),
      el('div', { class: 'agx-corpo' }, el('p', { class: 'agx-sub', text: 'Respostas modelo para situações que se repetem. A IA adapta o nome e mantém o conteúdo.' }),
        pares(c.padroes, ['situacao', 'resposta'], ['Situação (ex.: Preço)', 'Resposta modelo'], ['Preço', 'Horário', 'Gestante', 'Química anterior', 'Promoção'])));
    const exemplos = el('details', { class: 'agx-sec' }, el('summary', {}, el('span', { text: 'Exemplos' }), el('small', { text: String(c.exemplos.length) })),
      el('div', { class: 'agx-corpo' }, el('p', { class: 'agx-sub', text: 'Pares “cliente escreve → resposta ideal”. Mostram o jeito de responder.' }),
        pares(c.exemplos, ['cliente', 'resposta'], ['A cliente escreve…', 'Resposta ideal'])));

    // ---- ferramentas
    const ferr = el('details', { class: 'agx-sec' }, el('summary', {}, el('span', { text: 'Ferramentas permitidas' }), el('small', { text: String(c.ferramentas.length) })),
      el('div', { class: 'agx-corpo' }, el('div', { class: 'agx-checks' }, ...lista.ferramentas.map((f) => {
        const l = el('label', { class: 'agx-check' }, el('input', { type: 'checkbox' }), el('span', { text: f.nome }));
        const cb = l.querySelector('input'); cb.checked = c.ferramentas.includes(f.id); cb.disabled = trava;
        cb.addEventListener('change', () => { c.ferramentas = cb.checked ? [...new Set([...c.ferramentas, f.id])] : c.ferramentas.filter((x) => x !== f.id); marcar(); });
        return l;
      }))));

    // ---- passagem
    const P = c.passagem;
    const valorIn = el('input', { class: 'agx-entrada', type: 'number', min: '0', step: '50', placeholder: 'sem limite' });
    valorIn.value = P.valorAcimaDe ?? ''; valorIn.disabled = trava;
    valorIn.addEventListener('input', () => { P.valorAcimaDe = valorIn.value === '' ? null : Number(valorIn.value); marcar(); });
    const opP = (k, t, s) => el('div', { class: 'agx-opcao' }, el('span', { class: 'agx-txt' }, el('b', { text: t }), s ? el('span', { text: s }) : null), interruptor(el, P[k], t, (v) => { P[k] = v; marcar(); }, trava));
    const passagem = el('details', { class: 'agx-sec' }, el('summary', {}, el('span', { text: 'Quando passar para a equipe' })),
      el('div', { class: 'agx-corpo' },
        opP('reclamacao', 'Reclamação', 'Ex.: “absurdo”, “queimou”, “alergia”'),
        opP('pedidoPessoa', 'Pede para falar com uma pessoa'),
        opP('irritada', 'Cliente irritada', 'Muitas exclamações, CAIXA ALTA, palavrões'),
        opP('naoSabe', 'Não sabe responder com segurança'),
        campo(el, 'Valor acima de (R$)', valorIn),
        el('b', { text: 'Palavras que passam para a equipe' }), listaTextos(P.palavras, 'Ex.: cancelar, reembolso')));

    // ---- memória
    const mem = el('details', { class: 'agx-sec' }, el('summary', {}, el('span', { text: 'Memória e conhecimento' })),
      el('div', { class: 'agx-corpo' },
        el('div', { class: 'agx-opcao' }, el('span', { class: 'agx-txt' }, el('b', { text: 'Memória por cliente' }), el('span', { text: 'Grava tipo de cabelo, última química, horário preferido e objeções, e lê em toda conversa.' })), interruptor(el, c.memoriaCliente, 'Memória por cliente', (v) => { c.memoriaCliente = v; marcar(); }, trava)),
        el('div', { class: 'agx-opcao' }, el('span', { class: 'agx-txt' }, el('b', { text: 'Usar a base geral da empresa' }), el('span', { text: 'A base da Visão geral › Treinamento, além do conhecimento próprio do agente.' })), interruptor(el, c.usarBaseGeral, 'Usar a base geral', (v) => { c.usarBaseGeral = v; marcar(); }, trava)),
        el('p', { class: 'agx-sub' }, el('span', { text: `${det.conhecimento.length} item(ns) de conhecimento próprio · ${det.aprendizadosAprovados.length} aprendizado(s) aprovado(s) · ${det.aprendizadosPendentes} esperando aprovação. ` }),
          el('button', { class: 'agx-link', type: 'button', text: 'Abrir Treinamento', onclick: () => { agenteTreino = id; ctx.irPara('treinamento'); } }))));

    // ---- salvar / apagar
    salvarBtn.addEventListener('click', async () => {
      if (!mudou) return;
      salvarBtn.disabled = true;
      try {
        const corpo = { nome: a.nome.trim() || 'Agente', avatar: a.avatar, unidades: a.unidades, provedor: a.provedor, modelo: a.modelo, criatividade: a.criatividade, ativo: a.ativo, config: c };
        if (novaChave !== undefined) corpo.chave = novaChave;
        await ui.api(`/api/agentes-ia/${id}`, { method: 'PATCH', body: JSON.stringify(corpo) });
        mudou = false; ui.toast('Agente salvo ✓');
        editorAgente(ctx, lista, id);
      } catch (x) { salvarBtn.disabled = false; ui.toast(erroTxt(x, 'Não deu para salvar.')); }
    });
    const apagar = gestor ? el('button', { class: 'agx-botao perigo', type: 'button', text: 'Apagar', onclick: () => dialogo(el, `Apagar ${a.nome}?`, [el('p', { class: 'agx-sub', text: 'O conhecimento e os aprendizados dele também somem. As conversas voltam para a IA padrão.' })], (fechar) => [
      el('button', { class: 'agx-botao', type: 'button', text: 'Cancelar', onclick: fechar }),
      el('button', { class: 'agx-botao perigo', type: 'button', text: 'Apagar', onclick: async () => { fechar(); try { await ui.api(`/api/agentes-ia/${id}`, { method: 'DELETE' }); ui.toast('Agente apagado'); telaAgentes(ctx); } catch (x) { ui.toast(erroTxt(x)); } } })]) }) : null;

    // ---- nota + testar
    const n = det.nota;
    const notaBloco = el('div', { class: 'agx-vidro' },
      el('div', { class: 'agx-cab' }, el('span', { class: 'agx-nota', style: `--n:${n.nota * 10}` }, el('span', { text: String(n.nota).replace('.', ',') })), el('div', { class: 'agx-txt' }, el('b', { text: 'Nota de qualidade' }), el('span', { text: n.sugestoes.length ? `${n.sugestoes.length} sugestão(ões) para melhorar` : 'Tudo configurado. Continue testando.' }))),
      n.sugestoes.length ? el('div', { class: 'agx-lista' }, ...n.sugestoes.slice(0, 4).map((s) => el('div', { class: 'agx-item' }, el('div', { class: 'agx-txt' }, el('span', { style: 'color:var(--texto)', text: s }))))) : null);

    const teste = montarTeste(ctx, a, lista.chaves);
    const voltar = el('button', { class: 'agx-botao peq', type: 'button', onclick: () => { if (mudou && !confirm('Sair sem salvar?')) return; telaAgentes(ctx); } }, el('span', { html: SVG.voltar, 'aria-hidden': 'true' }), el('span', { text: 'Agentes' }));
    conteudo.replaceChildren(
      el('div', { class: 'agx-topo' }, voltar, el('div', { class: 'agx-pilulas' }, el('button', { class: 'agx-botao peq', type: 'button', text: 'Ver o que a IA lê', onclick: () => verPrompt(ctx, id) }), gestor ? salvarTopo : null)),
      el('div', { class: 'agx-editor' },
        el('div', { class: 'agx-col' }, idBloco, persona, regras, padroes, exemplos, ferr, passagem, modBloco, mem,
          gestor ? el('div', { class: 'agx-rodape' }, apagar, salvarBtn) : el('p', { class: 'agx-sub', text: 'Só a gerência, a direção e a administração mudam os agentes.' })),
        el('div', { class: 'agx-col agx-lado' }, notaBloco, teste)));
  }

  async function verPrompt(ctx, id) {
    const { el, ui } = ctx;
    try {
      const r = await ui.api(`/api/agentes-ia/${id}/prompt`);
      dialogo(el, 'O que a IA lê', [el('p', { class: 'agx-sub', text: `Ferramentas: ${r.ferramentas.join(', ') || 'nenhuma'}. A memória da cliente e a data entram junto de cada conversa.` }), el('pre', { style: 'white-space:pre-wrap;font-size:13px;max-height:60vh;overflow:auto;background:var(--painel);padding:12px;border-radius:14px', text: r.texto })], (f) => [el('button', { class: 'agx-botao', type: 'button', text: 'Fechar', onclick: f })]);
    } catch (x) { ui.toast(erroTxt(x)); }
  }

  function montarTeste(ctx, a, chaves) {
    const { el, ui } = ctx;
    const semChave = !a.temChavePropria && !(chaves && chaves[a.provedor]);
    const msgs = [];
    const chat = el('div', { class: 'agx-chat', 'aria-live': 'polite' });
    const campoTxt = el('textarea', { class: 'agx-entrada', rows: '1', placeholder: semChave ? 'Configure a chave para testar' : 'Escreva como se fosse a cliente…' });
    const unidade = segmentado(el, [['norte', ui.UNIDADE.norte || 'Norte'], ['sumare', ui.UNIDADE.sumare || 'Sumaré']], a.unidades[0] || 'norte', (v) => { estado.unidade = v; });
    const estado = { unidade: a.unidades[0] || 'norte', enviando: false };
    const enviarBtn = el('button', { class: 'agx-redondo', type: 'button', 'aria-label': 'Enviar', html: SVG.enviar });
    if (semChave) { campoTxt.disabled = true; enviarBtn.disabled = true; }
    const desenharChat = () => {
      chat.replaceChildren(...(msgs.length ? msgs.map((m, i) => {
        const b = el('div', { class: 'agx-bolha ' + (m.autor === 'cliente' ? 'cli' : 'ia') }, el('span', { text: m.texto || (m.autor === 'ia' ? '(não responde: só organiza o CRM)' : '') }));
        if (m.info) {
          const linhas = [];
          if (m.info.passagemDireta) linhas.push(`Passaria para a equipe: ${m.info.passagemDireta}`);
          for (const f of m.info.ferramentas || []) linhas.push(`${f.ok ? 'Usaria' : 'Tentou (bloqueado)'} ${f.nome}${f.resultado && f.nome !== 'passar_para_humano' ? ` · ${String(f.resultado).slice(0, 90)}` : ''}`);
          for (const ac of m.info.acoes || []) linhas.push(ac.descricao);
          for (const me of m.info.memorias || []) linhas.push(`Lembraria: ${me.chave} = ${me.valor}`);
          for (const av of m.info.avisos || []) linhas.push(`⚠ ${av}`);
          if (linhas.length) b.append(el('div', { class: 'agx-ferr' }, ...linhas.map((t) => el('div', {}, el('span', { html: SVG.ferramenta, 'aria-hidden': 'true' }), el('span', { text: t })))));
          if (m.texto) b.append(el('button', { class: 'agx-corrigir', type: 'button', text: 'Corrigir esta resposta', onclick: () => corrigir(i) }));
        }
        return b;
      }) : [el('div', { class: 'agx-vazio' }, el('b', { text: 'Teste ao vivo' }), el('span', { text: 'Nada é enviado para cliente nenhuma e nada é gravado. As ferramentas aparecem embaixo de cada resposta.' }))]));
      if (estado.enviando) chat.append(el('div', { class: 'agx-bolha ia', text: '…' }));
      chat.scrollTop = chat.scrollHeight;
    };
    const corrigir = (i) => {
      const cli = msgs.slice(0, i).filter((m) => m.autor === 'cliente').at(-1)?.texto || '';
      const t = el('textarea', { class: 'agx-entrada', rows: '4', placeholder: 'Como a resposta deveria ser?' });
      dialogo(el, 'Corrigir a resposta', [el('p', { class: 'agx-sub', text: 'Vira um aprendizado para a gestão aprovar na aba Memória.' }), t], (fechar) => [
        el('button', { class: 'agx-botao', type: 'button', text: 'Cancelar', onclick: fechar }),
        el('button', { class: 'agx-botao primario', type: 'button', text: 'Enviar para aprovação', onclick: async () => {
          if (t.value.trim().length < 3) return;
          try { await ui.post(`/api/agentes-ia/${a.id}/aprendizados`, { texto: `Quando a cliente disser algo como "${cli.slice(0, 160)}", responda assim: "${t.value.trim()}"`, cliente: cli, sugestao: msgs[i].texto }); fechar(); ui.toast('Aprendizado enviado para aprovação ✓'); } catch (x) { ui.toast(erroTxt(x)); }
        } })]);
    };
    const enviar = async () => {
      const texto = campoTxt.value.trim();
      if (!texto || estado.enviando) return;
      const historico = msgs.map((m) => ({ autor: m.autor, texto: m.texto || '' })).filter((m) => m.texto);
      msgs.push({ autor: 'cliente', texto }); campoTxt.value = ''; estado.enviando = true; desenharChat();
      try {
        const r = await ui.post(`/api/agentes-ia/${a.id}/testar`, { mensagem: texto, historico, unidade: estado.unidade });
        msgs.push({ autor: 'ia', texto: r.resposta, info: r });
      } catch (x) { msgs.push({ autor: 'ia', texto: `⚠ ${erroTxt(x)}` }); }
      estado.enviando = false; if (chat.isConnected) desenharChat();
    };
    enviarBtn.addEventListener('click', enviar);
    campoTxt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
    desenharChat();
    return el('div', { class: 'agx-vidro' },
      el('h2', {}, el('span', { text: 'Testar' }), el('small', {}, el('button', { class: 'agx-link', type: 'button', text: 'Limpar', onclick: () => { msgs.length = 0; desenharChat(); } }))),
      semChave ? el('div', { class: 'agx-faixa' }, el('span', { html: SVG.chave, 'aria-hidden': 'true' }), el('span', { text: 'Configure a chave da IA (própria do agente ou geral em Conexões) para testar.' })) : null,
      unidade, chat, el('div', { class: 'agx-compor' }, campoTxt, enviarBtn));
  }

  // ====================================================================== Treinamento
  async function telaTreinamento(ctx) {
    const { el, ui, conteudo } = ctx;
    const d = await ui.api('/api/agentes-ia');
    if (!ctx.vivo()) return;
    const gestor = gestorDe(ui);
    if (!d.agentes.length) {
      conteudo.replaceChildren(topo(el, 'Treinamento', 'O que cada agente sabe.'), el('div', { class: 'agx-vidro' }, el('div', { class: 'agx-vazio' }, el('b', { text: 'Crie um agente primeiro' }), el('button', { class: 'agx-botao primario', type: 'button', text: 'Ir para Agentes', onclick: () => ctx.irPara('agentes') }))));
      return;
    }
    const idSel = agenteTreino && d.agentes.some((a) => a.id === agenteTreino) ? agenteTreino : d.agentes[0].id;
    agenteTreino = idSel;
    const sel = el('select', { class: 'agx-entrada', 'aria-label': 'Agente', style: 'max-width:320px' }, ...d.agentes.map((a) => el('option', { value: a.id, text: a.nome })));
    sel.value = idSel;
    sel.addEventListener('change', () => { agenteTreino = sel.value; telaTreinamento(ctx); });
    const det = await ui.api(`/api/agentes-ia/${idSel}`);
    if (!ctx.vivo()) return;
    const recarregar = () => telaTreinamento(ctx);
    const ROTULO = { texto: 'Texto', faq: 'Pergunta e resposta', link: 'Página importada', arquivo: 'Arquivo' };
    const itens = det.conhecimento.map((k) => el('div', { class: 'agx-item' },
      el('div', { class: 'agx-txt' }, el('b', { text: k.titulo }), el('span', { text: `${ROTULO[k.tipo] || k.tipo}${k.origem ? ' · ' + k.origem : ''}\n${k.conteudo.slice(0, 220)}${k.conteudo.length > 220 ? '…' : ''}` })),
      gestor ? el('button', { class: 'agx-x', type: 'button', 'aria-label': 'Apagar', html: SVG.lixo, onclick: async () => { try { await ui.api(`/api/agentes-ia/${idSel}/conhecimento/${k.id}`, { method: 'DELETE' }); ui.toast('Apagado'); recarregar(); } catch (x) { ui.toast(erroTxt(x)); } } }) : null));

    const formulario = () => {
      if (!gestor) return el('p', { class: 'agx-sub', text: 'Só a gestão adiciona conhecimento.' });
      let tipo = 'texto';
      const t1 = el('input', { class: 'agx-entrada', placeholder: 'Título (ex.: Cuidados pós-progressiva)', maxlength: '120' });
      const t2 = el('textarea', { class: 'agx-entrada', rows: '4', placeholder: 'Conteúdo' });
      const url = el('input', { class: 'agx-entrada', type: 'url', placeholder: 'https://…' });
      const arq = el('input', { type: 'file', accept: '.txt,.pdf,.md,text/plain,application/pdf', class: 'agx-entrada' });
      const partes = { texto: [t1, t2], faq: [t1, t2], link: [url], arquivo: [arq] };
      const corpo = el('div', { class: 'agx-lista' });
      const desenharF = () => { t1.placeholder = tipo === 'faq' ? 'Pergunta (ex.: Atende criança?)' : 'Título (ex.: Cuidados pós-progressiva)'; t2.placeholder = tipo === 'faq' ? 'Resposta' : 'Conteúdo'; corpo.replaceChildren(...partes[tipo]); };
      const btn = el('button', { class: 'agx-botao primario', type: 'button', style: 'justify-self:start', text: 'Adicionar' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          if (tipo === 'link') await ui.post(`/api/agentes-ia/${idSel}/conhecimento/link`, { url: url.value.trim() });
          else if (tipo === 'arquivo') {
            const f = arq.files[0]; if (!f) throw new Error('Escolha um arquivo .txt ou .pdf');
            const base64 = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = falha; r.readAsDataURL(f); });
            await ui.post(`/api/agentes-ia/${idSel}/conhecimento/arquivo`, { nome: f.name, base64 });
          } else await ui.post(`/api/agentes-ia/${idSel}/conhecimento`, { tipo, titulo: t1.value.trim(), conteudo: t2.value.trim() });
          ui.toast('Adicionado ✓'); recarregar();
        } catch (x) { btn.disabled = false; ui.toast(erroTxt(x, 'Não deu para adicionar.')); }
      });
      desenharF();
      return el('div', { class: 'agx-lista' }, segmentado(el, [['texto', 'Texto'], ['faq', 'Pergunta e resposta'], ['link', 'Link'], ['arquivo', 'Arquivo']], tipo, (v) => { tipo = v; desenharF(); }), corpo, btn);
    };

    conteudo.replaceChildren(
      topo(el, 'Treinamento', 'Conhecimento próprio de cada agente. A base geral da empresa continua na Visão geral e vale para todos que a usam.', sel),
      el('div', { class: 'agx-editor' },
        el('div', { class: 'agx-col' },
          el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { text: 'Conhecimento do agente' }), el('small', { text: String(det.conhecimento.length) })),
            itens.length ? el('div', { class: 'agx-lista' }, ...itens) : el('p', { class: 'agx-sub', text: 'Nada ainda. Adicione textos, perguntas e respostas, um link ou um arquivo.' }))),
        el('div', { class: 'agx-col' },
          el('div', { class: 'agx-vidro' }, el('h2', { text: 'Adicionar' }), formulario()),
          el('div', { class: 'agx-vidro' }, el('h2', { text: 'Base geral da empresa' }),
            el('p', { class: 'agx-sub', text: det.agente.config.usarBaseGeral ? 'Este agente também usa a base geral (seções e perguntas frequentes).' : 'Este agente NÃO usa a base geral (mude em Agentes › Memória e conhecimento).' }),
            el('button', { class: 'agx-botao peq', type: 'button', style: 'justify-self:start', text: 'Abrir a base geral', onclick: () => ctx.irPara('geral') })))));
  }

  // ====================================================================== Memória
  async function telaMemoria(ctx) {
    const { el, ui, conteudo } = ctx;
    const gestor = gestorDe(ui);
    const [pend, aprov, mems] = await Promise.all([
      ui.api('/api/agentes-ia/aprendizados?situacao=pendente'),
      ui.api('/api/agentes-ia/aprendizados?situacao=aprovado'),
      gestor ? ui.api('/api/agentes-ia/memoria').catch(() => []) : Promise.resolve(null),
    ]);
    if (!ctx.vivo()) return;
    const decidir = async (x, acao, texto) => {
      try { await ui.post(`/api/agentes-ia/aprendizados/${x.id}/${acao}`, texto ? { texto } : {}); ui.toast(acao === 'aprovar' ? 'Aprovado: vale na próxima resposta ✓' : 'Recusado'); telaMemoria(ctx); } catch (e) { ui.toast(erroTxt(e)); }
    };
    const cartaoPend = (x) => {
      const t = el('textarea', { class: 'agx-entrada', rows: '3' }); t.value = x.texto; t.disabled = !gestor;
      const orig = x.origem || {};
      return el('div', { class: 'agx-item', style: 'display:grid;gap:8px' },
        el('div', { class: 'agx-pilulas' }, el('span', { class: 'agx-pil menta', text: x.agenteNome }), orig.atendente || orig.por ? el('span', { class: 'agx-pil', text: `correção de ${orig.atendente || orig.por}` }) : null),
        orig.sugestao ? el('span', { class: 'agx-sub', text: `A IA tinha sugerido: “${String(orig.sugestao).slice(0, 200)}”` }) : null,
        t,
        gestor ? el('div', { class: 'agx-pilulas', style: 'justify-content:flex-end' },
          el('button', { class: 'agx-botao peq', type: 'button', text: 'Recusar', onclick: () => decidir(x, 'recusar') }),
          el('button', { class: 'agx-botao peq primario', type: 'button', text: 'Aprovar', onclick: () => decidir(x, 'aprovar', t.value.trim() !== x.texto ? t.value.trim() : undefined) })) : null);
    };
    const nomeMem = { tipo_cabelo: 'Tipo de cabelo', comprimento: 'Comprimento', ultima_quimica: 'Última química', preferencia_horario: 'Horário preferido', objecao: 'Objeção', gestante: 'Gestante', unidade_preferida: 'Unidade preferida', outro: 'Outro' };
    const porTel = new Map();
    for (const m of mems || []) { if (!porTel.has(m.telefone)) porTel.set(m.telefone, []); porTel.get(m.telefone).push(m); }
    const nomeConversa = (tel) => (ui.estado.conversas || []).find((c) => c.telefone === tel);
    conteudo.replaceChildren(
      topo(el, 'Memória', 'O que os agentes aprendem: com a equipe (você aprova) e sobre cada cliente (eles gravam sozinhos).'),
      el('div', { class: 'agx-editor' },
        el('div', { class: 'agx-col' },
          el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { html: SVG.brilho, style: 'width:18px;height:18px;color:var(--marca-menta);display:inline-grid', 'aria-hidden': 'true' }), el('span', { text: 'A IA aprendeu isso. Aprovar?' }), el('small', { text: String(pend.length) })),
            pend.length ? el('div', { class: 'agx-lista' }, ...pend.map(cartaoPend)) : el('p', { class: 'agx-sub', text: 'Nada esperando. Quando a equipe responder diferente da sugestão da IA (ou corrigir no teste), aparece aqui.' })),
          el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { text: 'Aprendizados aprovados' }), el('small', { text: String(aprov.length) })),
            aprov.length ? el('div', { class: 'agx-lista' }, ...aprov.slice(0, 40).map((x) => el('div', { class: 'agx-item' }, el('div', { class: 'agx-txt' }, el('b', { text: x.agenteNome }), el('span', { text: x.texto }))))) : el('p', { class: 'agx-sub', text: 'Nenhum ainda.' }))),
        el('div', { class: 'agx-col' },
          el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { text: 'Memória das clientes' }), el('small', { text: mems ? String(porTel.size) : '' })),
            !mems ? el('p', { class: 'agx-sub', text: 'Só a gestão vê a lista de todas. A memória de cada cliente aparece na conversa dela.' })
              : porTel.size ? el('div', { class: 'agx-lista' }, ...[...porTel.entries()].slice(0, 40).map(([tel, fatos]) => {
                const c = nomeConversa(tel);
                return el('button', { class: 'agx-item', type: 'button', style: 'all:unset;box-sizing:border-box;cursor:pointer;display:flex;gap:10px;padding:10px 12px;border-radius:14px;border:1px solid var(--linha)', onclick: () => { if (c) ui.abrir(c.id); } },
                  el('div', { class: 'agx-txt' }, el('b', { text: c ? (c.nome || ui.formatarTel(tel)) : ui.formatarTel(tel) }), el('span', { text: fatos.map((f) => `${nomeMem[f.chave] || f.chave}: ${f.valor}`).join('\n') })));
              })) : el('p', { class: 'agx-sub', text: 'Ainda vazia. Ligue “Memória por cliente” no agente.' })))));
  }

  // ====================================================================== Comandos
  async function telaComandos(ctx) {
    const { el, ui, conteudo } = ctx;
    if (!gestorDe(ui)) {
      conteudo.replaceChildren(topo(el, 'Comandos', 'Peça para a IA organizar o CRM.'), el('div', { class: 'agx-vidro' }, el('p', { class: 'agx-sub', text: 'Só a gerência, a direção e a administração usam os comandos da IA.' })));
      return;
    }
    const hist = await ui.api('/api/ia/comandos').catch(() => []);
    if (!ctx.vivo()) return;
    const caixaTxt = el('textarea', { class: 'agx-entrada', rows: '3', maxlength: '500', placeholder: 'Ex.: mova para Interessada todas que pediram preço hoje e não agendaram' });
    const resultado = el('div', { class: 'agx-col' });
    const EXEMPLOS = ['Mova para Interessada todas que pediram preço hoje e não agendaram', 'Marque VIP quem gastou mais de 500', 'Liste quem sumiu há 3 dias', 'Crie lembrete de ligação para quem sumiu há 7 dias na Norte'];
    const pedir = async () => {
      const texto = caixaTxt.value.trim();
      if (texto.length < 4) return;
      btn.disabled = true;
      resultado.replaceChildren(el('div', { class: 'agx-esq', style: 'height:140px' }));
      try { mostrarPlano(await ui.post('/api/ia/comando', { texto })); telaHist(); }
      catch (x) { resultado.replaceChildren(el('div', { class: 'agx-faixa' }, el('span', { text: erroTxt(x) }))); }
      btn.disabled = false;
    };
    const mostrarPlano = (r) => {
      const p = r.plano;
      const itens = el('div', { class: 'agx-plano-itens' }, ...p.itens.slice(0, 100).map((i) => el('button', { class: 'agx-item', type: 'button', style: 'all:unset;box-sizing:border-box;cursor:pointer;display:flex;gap:10px;padding:10px 12px;border-radius:14px;border:1px solid var(--linha)', onclick: () => ui.abrir(i.conversaId) },
        el('div', { class: 'agx-txt' }, el('b', { text: i.nome || ui.formatarTel(i.telefone) }), el('span', { text: [ui.UNIDADE[i.unidade] || i.unidade, ui.NOME_ETAPA[i.etapa] || i.etapa, i.motivo].filter(Boolean).join(' · ') })))));
      const listar = p.acao.tipo === 'listar';
      const acoes = el('div', { class: 'agx-pilulas', style: 'justify-content:flex-end' });
      if (!listar && p.itens.length) {
        acoes.append(
          el('button', { class: 'agx-botao', type: 'button', text: 'Cancelar', onclick: async () => { await ui.post(`/api/ia/comando/${r.id}/cancelar`).catch(() => {}); resultado.replaceChildren(); ui.toast('Cancelado'); } }),
          el('button', { class: 'agx-botao primario', type: 'button', text: `Confirmar (${p.itens.length})`, onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { const f = await ui.post(`/api/ia/comando/${r.id}/confirmar`); ui.toast(`Feito: ${f.resultado.feitos} conversa(s) ✓`); resultado.replaceChildren(el('div', { class: 'agx-vidro' }, el('b', { text: `Pronto: ${f.resultado.feitos} conversa(s) atualizada(s).` }), f.resultado.falhas.length ? el('span', { class: 'agx-sub', text: `${f.resultado.falhas.length} não deram certo.` }) : null)); telaHist(); }
            catch (x) { ui.toast(erroTxt(x)); e.currentTarget.disabled = false; }
          } }));
      }
      resultado.replaceChildren(el('div', { class: 'agx-vidro' },
        el('h2', {}, el('span', { text: listar ? 'Resultado' : 'Prévia: nada mudou ainda' }), el('small', { text: `${p.total} conversa(s)` })),
        el('p', { style: 'margin:0;font-size:15px;font-weight:600', text: p.explicacao }),
        el('div', { class: 'agx-pilulas' }, el('span', { class: 'agx-pil', text: p.origem === 'ia' ? 'Entendido pela IA' : 'Entendido pelas regras' }), ...p.avisos.map((a) => el('span', { class: 'agx-pil coral', text: a }))),
        p.itens.length ? itens : el('p', { class: 'agx-sub', text: 'Nenhuma conversa se encaixa.' }),
        acoes));
    };
    const btn = el('button', { class: 'agx-botao primario', type: 'button', onclick: pedir }, el('span', { html: SVG.brilho, 'aria-hidden': 'true' }), el('span', { text: 'Montar plano' }));
    caixaTxt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) pedir(); });
    const histCaixa = el('div', { class: 'agx-lista' });
    const SIT = { planejado: 'esperando confirmação', executado: 'executado', cancelado: 'cancelado' };
    const telaHist = async () => {
      const h = await ui.api('/api/ia/comandos').catch(() => []);
      desenharHist(h);
    };
    const desenharHist = (h) => histCaixa.replaceChildren(...(h.length ? h.slice(0, 20).map((c) => el('div', { class: 'agx-item' }, el('div', { class: 'agx-txt' }, el('b', { text: c.texto }), el('span', { text: `${c.por} · ${ui.quando ? ui.quando(c.criadoEm) : new Date(c.criadoEm).toLocaleString('pt-BR')} · ${SIT[c.situacao] || c.situacao}${c.resultado && c.resultado.feitos != null ? ` · ${c.resultado.feitos} alterada(s)` : ''}${c.resultado && c.resultado.listadas != null ? ` · ${c.resultado.listadas} listada(s)` : ''}` })))) : [el('p', { class: 'agx-sub', text: 'Nenhum comando ainda.' })]));
    desenharHist(hist);
    conteudo.replaceChildren(
      topo(el, 'Peça para a IA', 'Escreva o que quer em português. A IA monta um plano com a lista de conversas; nada muda até você confirmar. No máximo 200 conversas por comando, tudo registrado.'),
      el('div', { class: 'agx-editor' },
        el('div', { class: 'agx-col' },
          el('div', { class: 'agx-vidro' }, caixaTxt, el('div', { class: 'agx-exemplos' }, ...EXEMPLOS.map((x) => el('button', { class: 'agx-marca-chip', type: 'button', text: x, onclick: () => { caixaTxt.value = x; caixaTxt.focus(); } }))), el('div', { style: 'display:flex;justify-content:flex-end' }, btn)),
          resultado),
        el('div', { class: 'agx-col' }, el('div', { class: 'agx-vidro' }, el('h2', { text: 'Histórico (auditoria)' }), histCaixa))));
  }

  // ====================================================================== Configuração (IA atende primeiro)
  async function telaConfiguracao(ctx) {
    const { el, ui, conteudo } = ctx;
    const [d, cfg] = await Promise.all([ui.api('/api/agentes-ia'), ui.api('/api/agentes-ia/controle')]);
    if (!ctx.vivo()) return;
    const gestor = gestorDe(ui);
    const trava = !gestor;
    const salvar = async (parcial) => {
      try { const r = await ui.api('/api/agentes-ia/controle', { method: 'PUT', body: JSON.stringify(parcial) }); Object.assign(cfg, r); ui.toast('Salvo ✓'); return true; }
      catch (x) { ui.toast(erroTxt(x, 'Não deu para salvar.')); telaConfiguracao(ctx); return false; }
    };
    const unidade = (u) => {
      const c = cfg[u];
      const corpo = el('div', { class: 'agx-lista' });
      const sel = el('select', { class: 'agx-entrada' }, el('option', { value: '', text: 'Escolha o agente' }), ...d.agentes.filter((a) => a.ativo).map((a) => el('option', { value: a.id, text: a.nome })));
      sel.value = c.agenteId || ''; sel.disabled = trava;
      sel.addEventListener('change', () => { c.agenteId = sel.value || null; salvar({ [u]: c }); });
      const ini = el('input', { class: 'agx-entrada', type: 'time' }); ini.value = c.inicio; ini.disabled = trava;
      const fim = el('input', { class: 'agx-entrada', type: 'time' }); fim.value = c.fim; fim.disabled = trava;
      const faixa = el('div', { class: 'agx-linha2' }, campo(el, 'Das', ini), campo(el, 'Até', fim));
      faixa.hidden = c.quando !== 'faixa';
      for (const [i, k] of [[ini, 'inicio'], [fim, 'fim']]) i.addEventListener('change', () => { c[k] = i.value; salvar({ [u]: c }); });
      const volta = el('select', { class: 'agx-entrada' }, el('option', { value: '', text: 'Não volta sozinha' }), ...[10, 15, 30, 60, 120, 240].map((n) => el('option', { value: String(n), text: n >= 60 ? `Depois de ${n / 60} h sem a equipe` : `Depois de ${n} min sem a equipe` })));
      volta.value = c.voltarAposMin == null ? '' : String(c.voltarAposMin); volta.disabled = trava;
      volta.addEventListener('change', () => { c.voltarAposMin = volta.value ? Number(volta.value) : null; salvar({ [u]: c }); });
      corpo.append(
        campo(el, 'Agente que atende', sel),
        el('div', { class: 'agx-campo' }, el('span', { text: 'Quando' }), segmentado(el, [['sempre', 'Sempre'], ['fora_do_horario', 'Fora do horário'], ['faixa', 'Num horário']], c.quando, (v) => { c.quando = v; faixa.hidden = v !== 'faixa'; salvar({ [u]: c }); }, trava)),
        faixa,
        campo(el, 'Volta para a IA', volta),
        el('div', { class: 'agx-opcao' }, el('span', { class: 'agx-txt' }, el('b', { text: 'Retomar conversas paradas' }), el('span', { text: 'Follow-ups automáticos de quem parou de responder sem agendar.' })), interruptor(el, c.retomarParadas, 'Retomar conversas paradas', (v) => { c.retomarParadas = v; salvar({ [u]: c }); }, trava)));
      corpo.hidden = !c.ligado;
      return el('div', { class: 'agx-vidro' },
        el('div', { class: 'agx-opcao' }, el('span', { class: 'agx-txt' }, el('b', { style: 'font-size:17px', text: ui.UNIDADE[u] || u }), el('span', { text: c.ligado ? 'A IA atende primeiro toda conversa nova.' : 'Desligado: vale o modo padrão da Visão geral.' })),
          interruptor(el, c.ligado, `IA atende primeiro em ${ui.UNIDADE[u] || u}`, async (v) => {
            if (v && !c.agenteId) { const primeiro = d.agentes.find((a) => a.ativo && (a.unidades || []).includes(u)) || d.agentes.find((a) => a.ativo); if (!primeiro) { ui.toast('Crie um agente primeiro (aba Agentes).'); telaConfiguracao(ctx); return; } c.agenteId = primeiro.id; sel.value = primeiro.id; }
            c.ligado = v; corpo.hidden = !v;
            if (await salvar({ [u]: c })) telaConfiguracao(ctx);
          }, trava)),
        corpo);
    };
    conteudo.replaceChildren(
      topo(el, 'IA atende primeiro', 'Com a opção ligada, a IA recebe toda conversa nova da unidade no horário escolhido, conduz o atendimento e organiza o CRM sozinha (etapa, tags, lembretes). Tudo fica no histórico como “IA”.'),
      avisoChave(el, ui, d.chaves) || '',
      el('div', { class: 'agx-grade cartoes', style: 'grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))' }, unidade('norte'), unidade('sumare')),
      el('div', { class: 'agx-vidro' }, el('h2', { text: 'Passagem para a equipe e de volta' }),
        el('p', { class: 'agx-sub', text: 'A IA passa para a equipe pelas condições de cada agente (reclamação, pedido de pessoa, cliente irritada, valor alto, palavras). Na conversa, a atendente vê quem está no controle e toca em “Assumir”. Quando a equipe responde, a IA sai da frente; com “Volta para a IA”, ela retoma se a equipe sumir.' })),
      trava ? el('p', { class: 'agx-sub', text: 'Só a gerência, a direção e a administração mudam estas opções.' }) : '');
  }

  // ====================================================================== conversa aberta: quem está no controle
  const cacheConversa = new Map();
  function faixaConversa() {
    const ui = window.Sintonia && window.Sintonia.ui;
    const modoEl = document.getElementById('modo');
    const dono = document.getElementById('dono');
    if (!ui || !modoEl || !dono) return;
    estilo();
    const id = ui.estado.aberta;
    const modo = modoEl.dataset.m;
    let faixa = document.getElementById('agx-controle');
    if (!id) { faixa?.remove(); return; }
    const chave = `${id}|${modo}`;
    const desenharF = (info) => {
      if (ui.estado.aberta !== id) return;
      if (!info || (!info.agente && modo !== 'ia')) { faixa?.remove(); return; }
      const { el } = ui;
      const novo = el('div', { id: 'agx-controle', class: 'agx-controle' + (modo === 'ia' ? ' ia' : ''), role: 'status' });
      const fatos = (info.memoria || []).slice(0, 3).map((m) => m.valor).join(' · ');
      if (modo === 'ia') {
        novo.append(info.agente ? avatarDe(el, info.agente, 'p') : el('span', { class: 'agx-av p', text: '✦' }),
          el('div', { class: 'agx-txt' }, el('b', { text: `${info.agente ? info.agente.nome : 'A IA'} está no controle` }), el('span', { text: fatos ? `Memória: ${fatos}` : 'Responde, agenda e organiza o CRM sozinha.' })),
          el('button', { class: 'agx-botao', type: 'button', text: 'Assumir', onclick: async () => { try { await ui.post(`/api/agentes-ia/conversa/${id}/assumir`); cacheConversa.delete(chave); ui.toast('Você assumiu a conversa'); ui.atualizar?.(); } catch (x) { ui.toast(erroTxt(x)); } } }));
      } else {
        novo.append(el('span', { class: 'agx-av p', text: '👤' }),
          el('div', { class: 'agx-txt' }, el('b', { text: 'Equipe no controle' }), el('span', { text: fatos ? `Memória: ${fatos}` : `${info.agente.nome} pode voltar a atender.` })),
          el('button', { class: 'agx-botao', type: 'button', text: `Devolver para ${info.agente.nome}`, onclick: async () => { try { await ui.post(`/api/agentes-ia/conversa/${id}/devolver`); cacheConversa.delete(chave); ui.toast(`${info.agente.nome} voltou a atender`); ui.atualizar?.(); } catch (x) { ui.toast(erroTxt(x)); } } }));
      }
      if (faixa) faixa.replaceWith(novo); else dono.after(novo);
      faixa = novo;
    };
    if (cacheConversa.has(chave)) return desenharF(cacheConversa.get(chave));
    ui.api(`/api/agentes-ia/conversa/${id}`).then((info) => { cacheConversa.set(chave, info); desenharF(info); }, () => desenharF(null));
  }
  let agendado = 0;
  const observar = () => {
    const modoEl = document.getElementById('modo');
    if (!modoEl) return;
    new MutationObserver(() => { clearTimeout(agendado); agendado = setTimeout(faixaConversa, 60); }).observe(modoEl, { attributes: true, attributeFilter: ['data-m'] });
    const nome = document.getElementById('c-nome');
    if (nome) new MutationObserver(() => { clearTimeout(agendado); agendado = setTimeout(faixaConversa, 60); }).observe(nome, { childList: true, characterData: true, subtree: true });
    setInterval(() => cacheConversa.clear(), 60_000);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observar); else observar();

  window.SintoniaTelas.ia = { desenhar };
  window.SintoniaTelas.agentesIa = { desenhar, faixaConversa };
})();
