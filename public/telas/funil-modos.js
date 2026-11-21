/* pipeline-modos: os 3 modos do Pipeline no computador (Foco · Lista · Colunas), como o modelo "Junção" aprovado.
 * Registra window.SintoniaFunilModos; o funil.js chama desenhar(ctx) a cada redesenho do quadro.
 * - Topo (ao lado dos pipelines): o número em destaque (a pessoa escolhe), a barra fina das etapas e o seletor
 *   de 3 ícones. A escolha fica guardada (localStorage) e vai para o endereço: /app/pipelines/<funilId>?modo=foco|lista|colunas.
 * - Foco: um lead por vez, por prioridade (a mesma regra do celular: SintoniaFunilCelular.regras), cartão grande no
 *   centro, ‹ › e setas do teclado (← →), "1 de N", filtro por etapa e, à direita, a fila dos próximos.
 * - Lista: funil-topo.js (desenharLista). Colunas: o quadro de sempre (funil.js).
 * No celular (até 760 px) nada daqui aparece: lá vale /telas/funil-celular.js.
 * Todo texto do servidor entra por textContent (el(..., { text })). */
(() => {
  const I = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    foco: I('<rect x="5" y="4" width="14" height="16" rx="3"/><path d="M9 9h6M9 13h4"/>'),
    lista: I('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
    colunas: I('<rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="16.5" y="4" width="4" height="7" rx="1.5"/>'),
    esq: I('<path d="m15 5-7 7 7 7"/>'),
    dir: I('<path d="m9 5 7 7-7 7"/>'),
    baixo: I('<path d="m6 9 6 6 6-6"/>', 2),
    conversa: I('<path d="M4 5h16v11H9l-5 4Z"/>'),
    avancar: I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    agendar: I('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    ganho: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    venda: I('<path d="M15.5 8.5c-.6-1.2-2-2-3.5-2-2 0-3.5 1.1-3.5 2.6 0 3.6 7 2 7 5.6 0 1.5-1.5 2.8-3.5 2.8-1.6 0-3-.8-3.6-2M12 4v2.5M12 17.5V20"/>'),
    proposta: I('<path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4Z"/>'),
    pontos: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    x: I('<path d="M7 7l10 10M17 7 7 17"/>', 2),
    relogio: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    pessoa: I('<circle cx="12" cy="9" r="3.5"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>'),
    caixa: I('<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>'),
    etiqueta: I('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1 1 0 0 1 0 1.4l-7.3 7.3a1 1 0 0 1-1.4 0Z"/><circle cx="8" cy="8" r="1.3"/>'),
    alvo: I('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>'),
    origem: I('<path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
    mensagem: I('<path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 4v-4H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5Z"/>'),
  };
  /** id na tela · nome · dica (title) · explicação curta */
  const MODOS = [
    ['foco', 'Foco', 'Foco: um lead por vez, por prioridade', 'Um lead por vez, por prioridade'],
    ['lista', 'Lista', 'Lista: todos em linhas', 'Todos em linhas'],
    ['colunas', 'Colunas', 'Colunas: uma coluna por etapa', 'Uma coluna por etapa'],
  ];
  const NOMES = new Set(MODOS.map((m) => m[0]));
  const R = () => window.SintoniaFunilCelular?.regras || null;
  const MQ_CELULAR = matchMedia('(max-width: 760px)');
  const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const CHAVE_MODO = 'sintonia.crm.vista';
  const CHANFRO = (n) => `polygon(${n}px 0, 100% 0, 100% calc(100% - ${n}px), calc(100% - ${n}px) 100%, 0 100%, 0 ${n}px)`;
  const FIO = (n, cor) => `linear-gradient(to bottom right, transparent calc(50% - .6px), ${cor} 50%, transparent calc(50% + .6px)) top left / ${n}px ${n}px no-repeat,
      linear-gradient(to bottom right, transparent calc(50% - .6px), ${cor} 50%, transparent calc(50% + .6px)) bottom right / ${n}px ${n}px no-repeat`;

  /** Modo guardado (o antigo "quadro" agora é "colunas"). */
  function modoGuardado() {
    const v = lerLocal(CHAVE_MODO);
    return v === 'quadro' ? 'colunas' : NOMES.has(v) ? v : 'colunas';
  }
  /** ?modo= do endereço, quando é um modo válido. */
  function modoDoEndereco() {
    try { const m = new URLSearchParams(location.search).get('modo'); return NOMES.has(m) ? m : null; } catch { return null; }
  }
  function modoInicial() {
    const m = modoDoEndereco();
    if (m) { gravarLocal(CHAVE_MODO, m); return m; }
    return modoGuardado();
  }

  const CSS = `
  /* ---------- topo: número em destaque · barra fina das etapas · seletor de 3 ícones ---------- */
  .fm-topo { display: flex; align-items: center; gap: 16px; flex: 1 1 auto; min-width: 0; margin-left: 14px; }
  .fm-topo[hidden] { display: none; }
  .fm-met { position: relative; flex: none; }
  .fm-met-bt { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: baseline; gap: 7px; padding: 4px 8px; border-radius: 12px; color: var(--texto); white-space: nowrap; }
  .fm-met-bt b { font-size: 21px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .fm-met-bt span { font-size: 13px; color: var(--sub); }
  .fm-met-bt svg { width: 14px; height: 14px; color: var(--sub); align-self: center; }
  .fm-met-bt:hover { background: var(--vidro-item); }
  .fm-met-menu { position: absolute; z-index: 30; top: calc(100% + 6px); left: 0; width: 270px; padding: 8px; border-radius: 16px; display: grid; gap: 2px;
    background: var(--fundo); box-shadow: 0 0 0 1px var(--linha), 0 18px 44px rgba(4,18,31,.22); }
  .fm-met-menu small { font-size: 11.5px; font-weight: 700; color: var(--sub); padding: 4px 10px 6px; }
  .fm-met-menu button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; font-size: 14px; color: var(--texto); }
  .fm-met-menu button span { flex: 1; }
  .fm-met-menu button b { font-variant-numeric: tabular-nums; }
  .fm-met-menu button:hover, .fm-met-menu button[aria-checked="true"] { background: var(--sel, var(--vidro-item)); }
  .fm-barra-c { flex: 1 1 220px; min-width: 160px; max-width: 520px; display: grid; gap: 5px; }
  .fm-barra { display: flex; gap: 3px; height: 7px; }
  .fm-barra button { all: unset; box-sizing: border-box; cursor: pointer; min-width: 6px; height: 7px; border-radius: 4px; background: var(--cor); opacity: .82; transition: opacity .15s ease; }
  .fm-barra button:hover { opacity: 1; }
  .fm-barra button[aria-current="true"] { opacity: 1; box-shadow: 0 0 0 2px var(--fundo), 0 0 0 3.5px #3aa0ff; }
  .fm-barra-rot { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--sub); white-space: nowrap; overflow: hidden; }
  .fm-barra-rot span { overflow: hidden; text-overflow: ellipsis; }
  .fm-seg { flex: none; display: inline-flex; gap: 2px; padding: 3px; border-radius: 14px; margin-left: auto;
    background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); }
  .fm-seg button { all: unset; box-sizing: border-box; cursor: pointer; width: 42px; height: 36px; border-radius: 11px; display: grid; place-items: center; color: var(--sub); border: 1.5px solid transparent; transition: color .15s ease, background .15s ease; }
  .fm-seg button svg { width: 20px; height: 20px; }
  .fm-seg button:hover { color: var(--texto); background: var(--vidro-item); }
  .fm-seg button[aria-pressed="true"] { background: linear-gradient(#0d2240, #0d2240) padding-box, linear-gradient(135deg, #0ffcbe, #3aa0ff) border-box; }
  html[data-tema="escuro"] .fm-seg button[aria-pressed="true"] { background: linear-gradient(rgba(13,34,64,.92), rgba(13,34,64,.92)) padding-box, linear-gradient(135deg, #0ffcbe, #3aa0ff) border-box; }
  .fm-seg button[aria-pressed="true"] svg { stroke: url(#fm-degrade); }
  .fm-seg button:focus-visible, .fm-met-bt:focus-visible, .fm-barra button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  @media (max-width: 1180px) { .fm-barra-c { display: none; } }
  @media (max-width: 760px) { .fm-topo, .fm-foco, #funil.fc-on > .ft-lista { display: none !important; } } /* no celular vale o Pipeline do celular (a Lista do computador também some) */

  /* ---------- Foco ---------- */
  .fm-foco { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 2px 20px 16px; }
  .fm-foco[hidden] { display: none; }
  .fm-cab { flex: none; display: flex; align-items: center; gap: 12px; min-width: 0; }
  .fm-etapas { display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 2px; flex: 1 1 auto; }
  .fm-etapas::-webkit-scrollbar { display: none; }
  .fm-etapas.fm-corta { -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 44px), transparent); mask-image: linear-gradient(90deg, #000 calc(100% - 44px), transparent); }
  .fm-etapa { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px; border-radius: 999px; font-size: 13px; font-weight: 650; color: var(--sub); white-space: nowrap;
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fm-etapa i { width: 8px; height: 8px; border-radius: 50%; background: var(--cor); flex: none; }
  .fm-etapa small { font-size: 11.5px; font-weight: 700; opacity: .8; }
  .fm-etapa:hover { color: var(--texto); }
  .fm-etapa[aria-pressed="true"] { color: var(--texto); font-weight: 750; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--cor) 70%, transparent); }
  .fm-etapa:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .fm-nav { flex: none; display: flex; align-items: center; gap: 8px; }
  .fm-n { min-width: 74px; text-align: center; font-size: 13.5px; font-weight: 700; color: var(--texto); font-variant-numeric: tabular-nums; }
  .fm-seta { all: unset; box-sizing: border-box; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fm-seta svg { width: 18px; height: 18px; }
  .fm-seta:hover { background: var(--vidro-ativo); }
  .fm-seta[aria-disabled="true"] { opacity: .35; cursor: default; }
  .fm-seta:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .fm-teclas { font-size: 12px; color: var(--sub); white-space: nowrap; }
  .fm-teclas kbd { font: inherit; font-weight: 700; padding: 1px 6px; border-radius: 6px; box-shadow: inset 0 0 0 1px var(--linha); background: var(--vidro-item); }
  @media (max-width: 1280px) { .fm-teclas { display: none; } }

  .fm-corpo { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; }
  @media (min-width: 1700px) { .fm-corpo { grid-template-columns: minmax(0, 1fr) 340px; } }
  .fm-palco { min-height: 0; overflow-y: auto; display: flex; justify-content: center; align-items: flex-start; padding: 2px 2px 6px; scrollbar-width: thin; }
  .fm-carta { position: relative; width: 100%; max-width: 920px; box-sizing: border-box; display: grid; gap: 16px; padding: 22px 24px 20px; border-radius: 4px; clip-path: ${CHANFRO(22)};
    background: ${FIO(22, 'var(--vidro-borda)')}, var(--fm-carta); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); }
  .fm-carta::after { content: ''; position: absolute; left: 30px; right: 30px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, transparent, #0ffcbe, #3aa0ff, transparent); opacity: .9; pointer-events: none; }
  .fm-carta:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -3px; }
  .fm-entra-d { animation: fm-entra-d .17s ease-out; }
  .fm-entra-e { animation: fm-entra-e .17s ease-out; }
  @keyframes fm-entra-d { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
  @keyframes fm-entra-e { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
  .fm-c0 { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .fm-c0 .fm-prox { font-size: 11px; font-weight: 800; letter-spacing: .06em; color: #3aa0ff; }
  .fm-chip { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 11px; border-radius: 999px; font-size: 12.5px; font-weight: 700; white-space: nowrap;
    background: color-mix(in srgb, var(--cor) 18%, transparent); color: var(--texto); }
  .fm-chip i { width: 8px; height: 8px; border-radius: 50%; background: var(--cor); }
  .fm-selo { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .fm-selo.verde { background: rgba(15,252,190,.18); color: #087a5c; }
  .fm-selo.laranja { background: rgba(242,169,59,.2); color: #9a5b00; }
  .fm-selo.vermelho { background: rgba(229,72,77,.15); color: #b4232a; }
  .fm-selo.neutro { background: var(--vidro-item); color: var(--sub); box-shadow: inset 0 0 0 1px var(--linha); }
  html[data-tema="escuro"] .fm-selo.verde { color: #0ffcbe; }
  html[data-tema="escuro"] .fm-selo.laranja { color: #ffc46b; background: rgba(242,169,59,.16); }
  html[data-tema="escuro"] .fm-selo.vermelho { color: #ff9a9a; background: rgba(229,72,77,.18); }
  .fm-c0 .fm-esp { flex: 1; }
  .fm-mini { all: unset; box-sizing: border-box; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .fm-mini svg { width: 18px; height: 18px; }
  .fm-mini:hover { background: var(--vidro-item); color: var(--texto); }
  .fm-c1 { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .fm-c1 .avatar { width: 64px; height: 64px; font-size: 21px; flex: none; margin: 0; box-shadow: 0 0 0 2.5px var(--cor), 0 8px 20px rgba(4,18,31,.14); }
  .fm-c1 > div { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .fm-c1 h2 { margin: 0; font-size: 26px; font-weight: 750; letter-spacing: -.015em; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fm-c1 > div > span { font-size: 13.5px; color: var(--sub); display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fm-valor { flex: none; text-align: right; display: grid; gap: 1px; }
  .fm-valor b { font-size: 28px; font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .fm-valor b.fm-sem { color: var(--sub); font-weight: 700; }
  .fm-valor small { font-size: 11.5px; color: var(--sub); }
  .fm-passos { display: flex; gap: 4px; }
  .fm-passos i { flex: 1; height: 5px; border-radius: 3px; background: var(--fm-trilho); }
  .fm-passos i.feito { background: #7fd3ff; }
  .fm-passos i.aqui { background: linear-gradient(90deg, #0ffcbe, #3aa0ff); }
  .fm-passos.perdido i { background: var(--fm-trilho); }
  .fm-passos-rot { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--sub); margin-top: -10px; }
  .fm-c2 { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 16px; }
  .fm-balao { border-radius: 16px; padding: 14px 16px; background: var(--fm-leve); display: grid; gap: 6px; align-content: start; min-height: 96px; }
  .fm-balao small { font-size: 12px; font-weight: 700; color: #3aa0ff; display: flex; align-items: center; gap: 6px; }
  .fm-balao small svg { width: 15px; height: 15px; }
  .fm-balao p { margin: 0; font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
  .fm-balao.nada p { color: var(--sub); font-style: italic; }
  .fm-dados { margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px 12px; align-content: start; font-size: 13.5px; }
  .fm-dados dt { color: var(--sub); display: flex; align-items: center; gap: 7px; white-space: nowrap; }
  .fm-dados dt svg { width: 16px; height: 16px; }
  .fm-dados dd { margin: 0; min-width: 0; font-weight: 650; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; overflow-wrap: anywhere; }
  .fm-dados dd .fn-tag { max-width: 150px; }
  .fm-dados dd .fm-fraco { color: var(--sub); font-weight: 500; }
  .fm-passos-lista { display: grid; gap: 6px; }
  .fm-passos-lista h3, .fm-fila h3 { margin: 0 0 2px; font-size: 11.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--sub); }
  .fm-passo { display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.4; padding: 8px 12px; border-radius: 12px; background: var(--fm-leve); }
  .fm-passo > i { flex: none; width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: #3aa0ff; }
  .fm-passo.urgente > i { background: #e5484d; }
  .fm-passo.ok > i { background: #0fd9a5; }
  .fm-passo span { min-width: 0; overflow-wrap: anywhere; }
  .fm-passo small { color: var(--sub); }
  .fm-acoes { display: flex; align-items: center; gap: 10px; }
  .fm-acoes .fm-bt { flex: none; padding: 0 15px; }
  .fm-acoes .fm-bt.fm-principal { flex: 1 1 160px; min-width: 0; }
  .fm-acoes .fm-bt span:last-child { overflow: hidden; text-overflow: ellipsis; }
  .fm-bt { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 46px; padding: 0 18px; border-radius: 14px; font-size: 14px; font-weight: 700; white-space: nowrap; color: var(--texto);
    background: var(--fm-leve); box-shadow: inset 0 0 0 1px var(--vidro-borda); transition: filter .15s ease, background .15s ease; }
  .fm-bt svg { width: 19px; height: 19px; flex: none; }
  .fm-bt:hover { background: var(--vidro-ativo); }
  .fm-bt.fm-principal { flex: 1 1 200px; color: #fff; border: 1.5px solid transparent; background: linear-gradient(135deg, #106ebe, #3aa0ff) padding-box, linear-gradient(135deg, #0ffcbe, #3aa0ff) border-box; box-shadow: 0 6px 18px rgba(16,110,190,.25); }
  .fm-bt.fm-principal:hover { filter: brightness(1.06); }
  .fm-bt[aria-disabled="true"] { opacity: .55; cursor: default; filter: none; }
  .fm-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }

  /* fila dos próximos */
  .fm-fila { min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 14px 12px 12px; border-radius: 4px; clip-path: ${CHANFRO(16)};
    background: ${FIO(16, 'var(--vidro-borda)')}, color-mix(in srgb, var(--vidro-fundo) 70%, transparent); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fm-fila h3 { padding: 0 4px; display: flex; justify-content: space-between; }
  .fm-fila-l { flex: 1; min-height: 0; overflow-y: auto; display: grid; align-content: start; gap: 4px; scrollbar-width: thin; }
  .fm-item { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 2px 10px; padding: 8px 8px; border-radius: 12px; }
  .fm-item small { grid-column: 2 / 4; }
  .fm-item:hover { background: var(--vidro-item); }
  .fm-item:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -2px; }
  .fm-item .avatar { width: 32px; height: 32px; font-size: 12px; margin: 0; grid-row: span 2; }
  .fm-item b { font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fm-item small { font-size: 12px; color: var(--sub); display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; min-width: 0; }
  .fm-item small i { width: 7px; height: 7px; border-radius: 50%; background: var(--cor); flex: none; }
  .fm-item small span:first-of-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .fm-item small .fm-t { flex: none; }
  .fm-item .fm-v { font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; }
  .fm-item .fm-t { color: var(--sub); white-space: nowrap; }
  .fm-item .fm-t.laranja { color: #b26b00; } .fm-item .fm-t.vermelho { color: #c43a3a; }
  html[data-tema="escuro"] .fm-item .fm-t.laranja { color: #ffc46b; } html[data-tema="escuro"] .fm-item .fm-t.vermelho { color: #ff9a9a; }
  .fm-fila-mais { font-size: 12px; color: var(--sub); text-align: center; padding: 6px; }
  .fm-vazio { margin: auto; text-align: center; color: var(--sub); font-size: 15px; display: grid; gap: 12px; justify-items: center; padding: 40px 20px; }
  .fm-vazio b { color: var(--texto); font-size: 18px; }

  .fm-foco { --fm-carta: color-mix(in srgb, var(--vidro-fundo) 92%, #fff); --fm-leve: #eef3f9; --fm-trilho: #e1e8f1; }
  html[data-tema="escuro"] .fm-foco { --fm-carta: rgba(255,255,255,.06); --fm-leve: rgba(255,255,255,.07); --fm-trilho: rgba(255,255,255,.14); }
  @media (max-height: 820px) {
    .fm-carta { gap: 12px; padding: 18px 20px 16px; }
    .fm-c1 .avatar { width: 54px; height: 54px; }
    .fm-c1 h2 { font-size: 23px; }
    .fm-balao { min-height: 0; }
  }
  @media (prefers-reduced-motion: reduce) { .fm-entra-d, .fm-entra-e { animation: none; } .fm-seg button, .fm-barra button, .fm-bt { transition: none; } }
  `;
  function estilo() {
    if (document.getElementById('fm-estilo')) return;
    document.head.append(Object.assign(document.createElement('style'), { id: 'fm-estilo', textContent: CSS }));
    // o degradê dos ícones (menta → azul), uma vez só na página
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.innerHTML = '<defs><linearGradient id="fm-degrade" gradientUnits="userSpaceOnUse" x1="3" y1="3" x2="21" y2="21"><stop offset="0" stop-color="#0ffcbe"/><stop offset="1" stop-color="#3aa0ff"/></linearGradient></defs>';
    document.body.append(svg);
  }

  // ---------- estado desta parte (sobrevive aos redesenhos) ----------
  const st = { ctx: null, etapaPorFunil: {}, aberto: null, itens: [], pos: 0, assFoco: '', assTopo: '', menu: false, entrada: '', extras: new Map(), pedindo: new Set(), carregando: new Set() };
  const chaveDestaque = (s) => `sintonia.crm.destaque.${s.ui?.estado?.eu?.id || 'local'}`; // a mesma do celular

  /** O "ctx" no formato das regras do celular (funil.js entrega funil() como função). */
  function regrasCtx(ctx) {
    const s = ctx.s;
    return { ui: s.ui, q: s.q, funil: ctx.funil(), gestao: ctx.ehGestao(), passa: ctx.passa, dinheiro: ctx.dinheiro, haTexto: ctx.haTexto, mover: ctx.mover, editarValor: ctx.editarValor, carregarMais: ctx.carregarMais };
  }
  const celular = () => MQ_CELULAR.matches;

  // ---------- endereço: /app/pipelines/<id>?modo=… ----------
  function acertarEndereco(ctx) {
    const s = ctx.s;
    if (celular() || s.ui?.estado?.vista !== 'funil' || !/^\/app\/pipelines(\/|$)/.test(location.pathname)) return;
    let p;
    try { p = new URLSearchParams(location.search); } catch { return; }
    if (p.get('modo') === s.vista) return;
    p.set('modo', s.vista);
    try { history.replaceState(history.state, '', `${location.pathname}?${p}${location.hash}`); } catch { /* sem histórico */ }
  }

  /** Troca de modo (seletor, barra, busca). */
  function trocar(ctx, modo, op = {}) {
    if (!NOMES.has(modo)) return;
    const s = ctx.s;
    const mudou = s.vista !== modo;
    s.vista = modo;
    gravarLocal(CHAVE_MODO, modo);
    if (op.etapa !== undefined) { st.etapaPorFunil[s.funilId] = op.etapa; st.aberto = op.aberto || null; st.assFoco = ''; }
    if (mudou || op.etapa !== undefined) ctx.desenharQuadro();
    acertarEndereco(ctx);
  }

  // ---------- topo ----------
  function desenharTopo(ctx) {
    const s = ctx.s;
    const caixa = s.ftVistas;
    if (!caixa) return;
    const { el } = s.ui;
    if (!caixa.classList.contains('fm-topo')) caixa.className = 'fm-topo';
    caixa.removeAttribute('role'); caixa.removeAttribute('aria-label');
    const r = R();
    const c = regrasCtx(ctx);
    const cols = s.q?.colunas || [];
    const m = r && s.q ? r.metricas(c) : null;
    const lista = r?.METRICAS || [];
    let metrica = lerLocal(chaveDestaque(s));
    if (!lista.some((x) => x[0] === metrica)) metrica = 'valor';
    const etapaFoco = st.etapaPorFunil[s.funilId] || null;
    const ass = JSON.stringify([s.vista, metrica, st.menu, m, etapaFoco, cols.map((x) => [x.etapa.id, x.etapa.nome, x.etapa.cor, x.total])]);
    if (ass === st.assTopo && caixa.childElementCount) return;
    st.assTopo = ass;
    const partes = [];
    // número em destaque (a pessoa escolhe)
    if (m) {
      const atual = lista.find((x) => x[0] === metrica) || lista[0];
      const met = el('div', { class: 'fm-met' },
        el('button', { class: 'fm-met-bt', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': String(st.menu), title: 'Escolher o número em destaque',
          onclick: (e) => { e.stopPropagation(); st.menu = !st.menu; st.assTopo = ''; desenharTopo(ctx); } },
        el('b', { text: m[atual[0]] }), el('span', { text: atual[2] }), el('span', { html: IC.baixo, style: 'display:grid' })));
      if (st.menu) {
        met.append(el('div', { class: 'fm-met-menu', role: 'menu', 'aria-label': 'Mostrar em destaque' }, el('small', { text: 'Mostrar em destaque' }),
          ...lista.map(([id, nome]) => el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(id === atual[0]),
            onclick: (e) => { e.stopPropagation(); st.menu = false; gravarLocal(chaveDestaque(s), id); st.assTopo = ''; desenharTopo(ctx); } },
          el('span', { text: nome }), el('b', { text: m[id] })))));
      }
      partes.push(met);
    }
    // barra fina: cada cor é uma etapa (largura = quantos leads); clicar abre o Foco naquela etapa
    if (cols.length) {
      const ganho = r && s.q ? r.colGanho(c) : null;
      const total = cols.reduce((a, x) => a + x.total, 0);
      const pct = ganho && total ? ` ${Math.round((ganho.total / total) * 100)}%` : '';
      const barra = el('div', { class: 'fm-barra', role: 'group', 'aria-label': 'Etapas do funil' },
        ...cols.map((col) => {
          const b = el('button', { type: 'button', 'aria-label': `${col.etapa.nome}: ${col.total} lead${col.total === 1 ? '' : 's'}. Ver no Foco`, title: `${col.etapa.nome} · ${col.total}`,
            'aria-current': s.vista === 'foco' && etapaFoco === col.etapa.id ? 'true' : null,
            onclick: () => trocar(ctx, 'foco', { etapa: col.etapa.id }) });
          b.style.setProperty('--cor', col.etapa.cor || '#3aa0ff');
          b.style.flex = String(Math.max(0.5, col.total));
          return b;
        }));
      const meio = ganho && ganho !== cols.at(-1) ? `${ganho.etapa.nome}${pct}` : `${total} no funil`;
      partes.push(el('div', { class: 'fm-barra-c' }, barra,
        el('div', { class: 'fm-barra-rot' }, el('span', { text: cols[0].etapa.nome }), el('span', { text: meio }),
          el('span', { text: cols.length > 1 ? cols.at(-1).etapa.nome + (ganho === cols.at(-1) ? pct : '') : '' }))));
    }
    // seletor de 3 ícones
    partes.push(el('div', { class: 'fm-seg', role: 'group', 'aria-label': 'Modo de ver o pipeline' },
      ...MODOS.map(([id, nome, dica]) => el('button', { type: 'button', 'aria-pressed': String(s.vista === id), 'aria-label': dica, title: dica, html: IC[id],
        onclick: () => trocar(ctx, id) }))));
    caixa.replaceChildren(...partes);
  }

  // ---------- Foco ----------
  const nomeDe = (s, c) => c.nome || (s.ui.formatarTel ? s.ui.formatarTel(c.telefone) : s.ui.nomeDe({ telefone: c.telefone }));
  const primeiro = (n) => String(n || '').split(/\s+/)[0];
  const DIA = 86400000;

  /** Produtos e mensagens agendadas do lead em foco (buscados à parte, guardados por 1 minuto). */
  function extras(ctx, id) {
    const s = ctx.s;
    const e = st.extras.get(id);
    if (e && Date.now() - e.em < 60000) return e;
    if (!st.pedindo.has(id)) {
      st.pedindo.add(id);
      Promise.all([
        s.ui.api(`/api/conversas/${id}/produtos`).then((r) => (Array.isArray(r?.itens) ? r.itens : [])).catch(() => null),
        s.ui.api(`/api/conversas/${id}/agendadas`).then((r) => (Array.isArray(r?.agendadas) ? r.agendadas : [])).catch(() => null),
      ]).then(([produtos, agendadas]) => {
        st.extras.set(id, { em: Date.now(), produtos, agendadas });
        if (st.extras.size > 60) st.extras.delete(st.extras.keys().next().value);
        st.pedindo.delete(id);
        if (st.ctx && st.itens[st.pos]?.cartao.conversaId === id) { st.assFoco = ''; desenharFoco(st.ctx); }
      });
    }
    return e || null;
  }

  function itensDoFoco(ctx) {
    const s = ctx.s; const r = R(); const c = regrasCtx(ctx);
    const cols = s.q?.colunas || [];
    let etapa = st.etapaPorFunil[s.funilId] || null;
    let filtro = etapa ? cols.find((x) => x.etapa.id === etapa) : null;
    if (etapa && !filtro) { st.etapaPorFunil[s.funilId] = null; etapa = null; }
    const fontes = filtro ? [filtro] : r.abertas(c);
    const itens = r.ordenar(c, fontes.flatMap((col) => col.cartoes.filter(ctx.passa).map((cartao) => ({ cartao, col }))));
    return { cols, filtro, fontes, itens, c, r };
  }

  function ir(ctx, d) {
    const novo = Math.min(st.itens.length - 1, Math.max(0, st.pos + d));
    if (novo === st.pos || !st.itens[novo]) return false;
    st.aberto = st.itens[novo].cartao.conversaId;
    st.entrada = d > 0 ? 'fm-entra-d' : 'fm-entra-e';
    desenharFoco(ctx, true);
    return true;
  }

  /** Próximos passos: o que fazer agora com este lead (e o que já está marcado). */
  function proximosPassos(ctx, cartao, col, prox, ex, r, c) {
    const s = ctx.s; const { el } = s.ui;
    const nome = primeiro(nomeDe(s, cartao));
    const lista = [];
    const final = col === r.colGanho(c) || r.ehPerdida(col);
    const u = cartao.ultima;
    const parado = cartao.desde ? Date.now() - new Date(cartao.desde).getTime() : 0;
    if (!final) {
      if (u && u.autor === 'cliente') lista.push(['urgente', `Responder ${nome}`, `está esperando ${ctx.haTexto(u.em)}`]);
      else if (!u) lista.push(['', `Puxar conversa com ${nome}`, 'ainda não houve mensagem']);
      else if (parado > 3 * DIA) lista.push(['urgente', 'Mandar uma mensagem de retomada', `parado nesta etapa ${ctx.haTexto(cartao.desde)}`]);
      else lista.push(['ok', 'Acompanhar', `a última mensagem foi respondida ${ctx.haTexto(u.em)}`]);
    } else lista.push(['ok', r.ehPerdida(col) ? 'Negócio perdido' : 'Negócio ganho', 'nada pendente nesta etapa']);
    for (const a of (ex?.agendadas || []).slice(0, 2)) {
      const quando = a.enviarEm ? new Date(a.enviarEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      const texto = String(a.texto || (a.anexo ? 'arquivo' : '')).slice(0, 80);
      lista.push(['', `Mensagem agendada ${quando}`, texto ? `“${texto}${String(a.texto || '').length > 80 ? '…' : ''}”` : '']);
    }
    if (prox && !final) lista.push(['', `Depois: ${prox.etapa.nome}`, 'use Avançar etapa quando chegar lá']);
    return el('div', { class: 'fm-passos-lista' }, el('h3', { text: 'Próximos passos' }),
      ...lista.map(([cls, t, sub]) => el('div', { class: 'fm-passo' + (cls ? ' ' + cls : '') }, el('i'), el('span', {}, el('b', { text: t }), sub ? el('small', { text: ` · ${sub}` }) : null))));
  }

  function cartaFoco(ctx, cartao, col, itens, pos, r, c) {
    const s = ctx.s; const { el, UNIDADE } = s.ui;
    const nome = nomeDe(s, cartao);
    const sl = r.selo(c, cartao, col);
    const cam = r.caminho(c);
    const i = cam.indexOf(col);
    const prox = cam[i + 1];
    const ganho = r.colGanho(c);
    const podeAvancar = !!prox && col !== ganho && !r.ehPerdida(col);
    const acao = r.acaoDoFunil(c);
    const ACOES = window.SintoniaFunilCelular?.ACOES || {};
    const jaGanhou = (acao === 'ganho' || acao === 'venda') && ganho === col;
    const ex = extras(ctx, cartao.conversaId);
    const seguinte = itens[pos + 1]?.cartao.conversaId || itens[pos - 1]?.cartao.conversaId || null;
    const depois = () => { st.aberto = seguinte; st.entrada = 'fm-entra-d'; };

    const av = s.ui.avatar({ id: cartao.conversaId, nome: cartao.nome, telefone: cartao.telefone });
    const chip = el('span', { class: 'fm-chip' }, el('i'), el('span', { text: col.etapa.nome }));
    const carta = el('article', { class: 'fm-carta' + (st.entrada ? ' ' + st.entrada : ''), tabindex: '0', 'data-id': cartao.conversaId, 'aria-label': `${nome}, ${col.etapa.nome}. Enter abre a conversa` });
    carta.style.setProperty('--cor', col.etapa.cor || '#3aa0ff');
    carta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === carta) s.ui.abrir(cartao.conversaId); });

    // linha 0: etapa · tempo · ⋯
    const c0 = el('div', { class: 'fm-c0' }, el('span', { class: 'fm-prox', text: pos === 0 ? 'PRÓXIMO A ATENDER' : `NA FILA · ${pos + 1}º` }), chip,
      el('span', { class: 'fm-selo ' + sl.cor, title: 'Tempo nesta etapa', text: sl.texto }), el('span', { class: 'fm-esp' }),
      el('button', { class: 'fm-mini', type: 'button', title: 'Mover para…, ficha, valor', 'aria-label': `Mais opções de ${nome}`, html: IC.pontos, onclick: () => ctx.menuCartao(cartao.conversaId) }));

    // linha 1: foto, nome, telefone, valor
    const tel = cartao.nome && s.ui.formatarTel ? s.ui.formatarTel(cartao.telefone) : '';
    const sub = [tel, UNIDADE?.[cartao.unidade] || ''].filter(Boolean).join(' · ');
    const c1 = el('div', { class: 'fm-c1' }, av,
      el('div', {}, el('h2', { text: nome }), el('span', { text: sub || ' ' })),
      el('div', { class: 'fm-valor' }, el('b', { class: cartao.valor == null ? 'fm-sem' : '', text: cartao.valor == null ? 'R$ —' : ctx.dinheiro(cartao.valor) }),
        el('small', { text: cartao.valor == null ? 'sem valor' : 'valor do negócio' })));

    // passos (caminho do funil)
    const passos = el('div', { class: 'fm-passos' + (r.ehPerdida(col) ? ' perdido' : ''), 'aria-hidden': 'true' });
    for (let k = 0; k < cam.length; k++) passos.append(el('i', { class: k < i ? 'feito' : k === i ? 'aqui' : '' }));
    const passosRot = el('div', { class: 'fm-passos-rot', 'aria-hidden': 'true' }, el('span', { text: cam[0]?.etapa.nome || '' }), el('span', { text: cam.length > 1 ? cam.at(-1).etapa.nome : '' }));

    // linha 2: última mensagem | dados
    const u = cartao.ultima;
    const quem = u ? (u.autor === 'cliente' ? primeiro(nome) : u.autor === 'ia' ? 'Serena (IA)' : primeiro(u.autorNome) || 'Equipe') : '';
    const balao = u
      ? el('div', { class: 'fm-balao' }, el('small', {}, el('span', { html: IC.mensagem, style: 'display:grid' }), el('span', { text: `Última mensagem · ${quem} · ${ctx.haTexto(u.em)}` })), el('p', { text: u.texto || '(mídia)' }))
      : el('div', { class: 'fm-balao nada' }, el('small', {}, el('span', { html: IC.mensagem, style: 'display:grid' }), el('span', { text: 'Última mensagem' })), el('p', { text: 'Sem mensagens ainda' }));
    const espera = u && u.autor === 'cliente' ? `há ${ctx.haTexto(u.em).replace(/^há /, '')} sem resposta` : u ? 'ninguém esperando' : '—';
    const responsavel = cartao.modo === 'ia'
      ? el('dd', {}, window.SintoniaSerenaSelo ? window.SintoniaSerenaSelo({ tam: 20 }) : null, el('span', { text: 'Serena (IA)' }))
      : el('dd', {}, el('span', { class: cartao.dona ? '' : 'fm-fraco', text: cartao.dona?.nome || 'Sem responsável' }));
    const produtos = ex == null ? el('dd', {}, el('span', { class: 'fm-fraco', text: 'Carregando…' }))
      : !ex.produtos ? el('dd', {}, el('span', { class: 'fm-fraco', text: '—' }))
        : ex.produtos.length ? el('dd', { text: ex.produtos.slice(0, 4).map((p) => (p.quantidade > 1 ? `${p.quantidade}× ` : '') + p.nome).join(', ') + (ex.produtos.length > 4 ? ` e mais ${ex.produtos.length - 4}` : '') })
          : el('dd', {}, el('span', { class: 'fm-fraco', text: 'Nenhum ainda' }));
    const tags = (cartao.tags || []).length ? el('dd', {}, ...cartao.tags.slice(0, 4).map(ctx.tagEl)) : el('dd', {}, el('span', { class: 'fm-fraco', text: 'Nenhuma' }));
    const dt = (ic, t) => el('dt', {}, el('span', { html: ic, style: 'display:grid' }), el('span', { text: t }));
    const dados = el('dl', { class: 'fm-dados' },
      dt(IC.relogio, 'Esperando'), el('dd', {}, el('span', { class: u && u.autor === 'cliente' ? '' : 'fm-fraco', text: espera })),
      dt(IC.alvo, 'Na etapa'), el('dd', { text: cartao.desde ? `desde ${new Date(cartao.desde).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} (${ctx.haTexto(cartao.desde)})` : '—' }),
      dt(IC.pessoa, 'Responsável'), responsavel,
      dt(IC.caixa, 'Produtos'), produtos,
      dt(IC.etiqueta, 'Etiquetas'), tags,
      dt(IC.origem, 'Origem'), el('dd', {}, ctx.origemEl(cartao)));
    const c2 = el('div', { class: 'fm-c2' }, balao, dados);

    // ações: Abrir conversa · ação principal da etapa · Avançar etapa · Agendar
    const acoes = el('div', { class: 'fm-acoes' },
      el('button', { class: 'fm-bt', type: 'button', onclick: () => s.ui.abrir(cartao.conversaId) }, el('span', { html: IC.conversa, style: 'display:grid' }), el('span', { text: 'Abrir conversa' })),
      el('button', { class: 'fm-bt fm-principal', type: 'button', 'aria-disabled': jaGanhou ? 'true' : null,
        onclick: async () => { if (jaGanhou) return; if (acao !== 'agendar' && acao !== 'proposta') depois(); await r.fazerAcao(c, acao, cartao, col); } },
      el('span', { html: IC[acao] || IC.ganho, style: 'display:grid' }), el('span', { text: jaGanhou ? 'Ganho ✓' : ACOES[acao]?.nome || 'Marcar como ganho' })),
      podeAvancar ? el('button', { class: 'fm-bt', type: 'button', title: `Mover para ${prox.etapa.nome}`, 'aria-label': `Avançar etapa: mover para ${prox.etapa.nome}`, onclick: () => { depois(); ctx.mover(cartao.conversaId, prox.etapa.id); } },
        el('span', { html: IC.avancar, style: 'display:grid' }), el('span', { text: 'Avançar etapa' })) : null,
      acao !== 'agendar' ? el('button', { class: 'fm-bt', type: 'button', onclick: () => s.ui.agendar(cartao.conversaId) }, el('span', { html: IC.agendar, style: 'display:grid' }), el('span', { text: 'Agendar' })) : null);

    carta.append(c0, c1, passos, passosRot, c2, proximosPassos(ctx, cartao, col, prox, ex, r, c), acoes);
    return carta;
  }

  function filaEl(ctx, itens, pos, r, c) {
    const s = ctx.s; const { el } = s.ui;
    const resto = itens.slice(pos + 1);
    const mostrar = resto.slice(0, 40);
    const fila = el('aside', { class: 'fm-fila', 'aria-label': 'Próximos da fila' },
      el('h3', {}, el('span', { text: 'Próximos na fila' }), el('span', { text: String(resto.length) })));
    const l = el('div', { class: 'fm-fila-l' });
    if (!resto.length) l.append(el('div', { class: 'fm-fila-mais', text: 'Ninguém depois deste.' }));
    for (const { cartao, col } of mostrar) {
      const sl = r.selo(c, cartao, col);
      const et = el('small', {}, el('i'), el('span', { text: col.etapa.nome }));
      et.style.setProperty('--cor', col.etapa.cor || '#3aa0ff');
      const nome = nomeDe(s, cartao);
      l.append(el('button', { class: 'fm-item', type: 'button', 'aria-label': `${nome}, ${col.etapa.nome}. Ver no Foco`,
        onclick: () => { st.aberto = cartao.conversaId; st.entrada = 'fm-entra-d'; desenharFoco(ctx, true); } },
      s.ui.avatar({ id: cartao.conversaId, nome: cartao.nome, telefone: cartao.telefone }),
      el('b', { text: nome }), el('span', { class: 'fm-v', text: cartao.valor == null ? '' : ctx.dinheiro(cartao.valor) }),
      et));
      et.append(document.createTextNode('·'), el('span', { class: 'fm-t ' + sl.cor, text: sl.texto.replace(/^parada há /, 'há ') }));
    }
    if (resto.length > mostrar.length) l.append(el('div', { class: 'fm-fila-mais', text: `e mais ${resto.length - mostrar.length}` }));
    fila.append(l);
    return fila;
  }

  function desenharFoco(ctx, forcar) {
    const s = ctx.s;
    const caixa = s.focoEl;
    if (!caixa || caixa.hidden || celular()) return;
    const { el } = s.ui;
    const r = R();
    if (!r || !s.q) { caixa.replaceChildren(el('div', { class: 'fm-vazio', text: s.erro ? `Não deu para carregar: ${s.erro}` : 'Carregando…' })); st.assFoco = ''; return; }
    const { cols, filtro, fontes, itens, c } = itensDoFoco(ctx);
    let pos = itens.findIndex((x) => x.cartao.conversaId === st.aberto);
    if (pos < 0) pos = Math.min(st.pos, Math.max(0, itens.length - 1));
    st.itens = itens; st.pos = pos; st.aberto = itens[pos]?.cartao.conversaId || null;
    const atual = itens[pos];
    const ex = atual ? st.extras.get(atual.cartao.conversaId) : null;
    const ass = JSON.stringify([s.funilId, c.funil?.acaoPrincipal, c.gestao, filtro?.etapa.id, pos, Math.floor(Date.now() / 60000), ex?.em,
      cols.map((x) => [x.etapa.id, x.etapa.nome, x.etapa.cor, x.total]),
      itens.slice(0, pos + 42).map((x) => [x.cartao.conversaId, x.col.etapa.id, x.cartao.nome, x.cartao.valor, x.cartao.desde, x.cartao.ultima?.em, x.cartao.ultima?.texto, x.cartao.dona?.id, x.cartao.modo, (x.cartao.tags || []).map((t) => t.id)]), itens.length]);
    if (!forcar && ass === st.assFoco) return;
    st.assFoco = ass;
    const focado = caixa.contains(document.activeElement) && document.activeElement !== document.body;

    // cabeçalho: filtro por etapa · ‹ 1 de N ›
    const chips = [el('button', { class: 'fm-etapa', type: 'button', 'aria-pressed': String(!filtro), onclick: () => trocar(ctx, 'foco', { etapa: null }) },
      el('span', { text: 'Todas em aberto' }))];
    for (const col of cols) {
      const b = el('button', { class: 'fm-etapa', type: 'button', 'aria-pressed': String(filtro === col), title: `Só ${col.etapa.nome}`,
        onclick: () => trocar(ctx, 'foco', { etapa: filtro === col ? null : col.etapa.id }) },
      el('i'), el('span', { text: col.etapa.nome }), el('small', { text: String(col.total) }));
      b.style.setProperty('--cor', col.etapa.cor || '#3aa0ff');
      chips.push(b);
    }
    const nav = el('div', { class: 'fm-nav' },
      el('span', { class: 'fm-teclas', 'aria-hidden': 'true' }, el('kbd', { text: '←' }), document.createTextNode(' '), el('kbd', { text: '→' }), document.createTextNode(' para navegar')),
      el('button', { class: 'fm-seta', type: 'button', 'aria-label': 'Lead anterior', title: 'Anterior (←)', 'aria-disabled': pos <= 0 ? 'true' : null, html: IC.esq, onclick: () => ir(ctx, -1) }),
      el('span', { class: 'fm-n', 'aria-live': 'polite', text: itens.length ? `${pos + 1} de ${itens.length}` : '0 de 0' }),
      el('button', { class: 'fm-seta', type: 'button', 'aria-label': 'Próximo lead', title: 'Próximo (→)', 'aria-disabled': pos + 1 >= itens.length ? 'true' : null, html: IC.dir, onclick: () => ir(ctx, 1) }));
    const cab = el('div', { class: 'fm-cab' }, el('div', { class: 'fm-etapas', role: 'group', 'aria-label': 'Filtrar por etapa' }, ...chips), nav);

    let corpo;
    if (!cols.length) corpo = el('div', { class: 'fm-vazio' }, el('b', { text: 'Este pipeline ainda não tem etapas.' }));
    else if (!atual) {
      corpo = el('div', { class: 'fm-vazio' }, el('b', { text: 'Ninguém para atender agora.' }),
        el('span', { text: filtro ? `Nenhum lead em ${filtro.etapa.nome} com os filtros de agora.` : 'Tudo em dia ✓' }),
        filtro ? el('button', { class: 'fm-bt', type: 'button', text: 'Ver todas as etapas', onclick: () => trocar(ctx, 'foco', { etapa: null }) }) : null);
    } else {
      const carta = cartaFoco(ctx, atual.cartao, atual.col, itens, pos, r, c);
      corpo = el('div', { class: 'fm-corpo' }, el('div', { class: 'fm-palco' }, carta), filaEl(ctx, itens, pos, r, c));
    }
    // mesma pessoa em foco: guarda a rolagem da fila e do cartão (o redesenho de cada minuto não pula)
    const mesmo = caixa.querySelector('.fm-carta')?.dataset.id === atual?.cartao.conversaId;
    const rol = mesmo ? ['.fm-fila-l', '.fm-palco', '.fm-etapas'].map((q) => [q, caixa.querySelector(q)?.scrollTop || 0, caixa.querySelector(q)?.scrollLeft || 0]) : [];
    st.entrada = '';
    caixa.replaceChildren(cab, corpo);
    for (const [q, y, x] of rol) { const n = caixa.querySelector(q); if (n) { n.scrollTop = y; n.scrollLeft = x; } }
    const tira = cab.querySelector('.fm-etapas');
    const corta = () => tira.classList.toggle('fm-corta', tira.scrollWidth - tira.clientWidth - tira.scrollLeft > 4);
    corta(); tira.addEventListener('scroll', corta, { passive: true });
    if (focado) caixa.querySelector('.fm-carta')?.focus({ preventScroll: true });
    // perto do fim da fila: carrega mais das etapas que têm mais
    if (atual && pos + 4 >= itens.length) {
      for (const col of fontes.filter((x) => x.mais && !st.carregando.has(x.etapa.id))) {
        st.carregando.add(col.etapa.id);
        Promise.resolve(ctx.carregarMais(col)).finally(() => st.carregando.delete(col.etapa.id));
      }
    }
  }

  /** Abre o Foco num lead (busca do topo). */
  function focar(ctx, conversaId, etapaId) {
    st.ctx = ctx;
    st.aberto = conversaId;
    st.etapaPorFunil[ctx.s.funilId] = etapaId || null;
    st.assFoco = '';
    if (ctx.s.vista !== 'foco') trocar(ctx, 'foco');
    else desenharFoco(ctx, true);
    ctx.s.focoEl?.querySelector('.fm-carta')?.focus({ preventScroll: true });
  }

  /** Chamado pelo funil.js a cada redesenho: topo, Foco e endereço. */
  function desenhar(ctx) {
    st.ctx = ctx;
    estilo();
    if (celular()) return;
    desenharTopo(ctx);
    if (ctx.s.vista === 'foco') desenharFoco(ctx);
    acertarEndereco(ctx);
  }

  // ---------- teclado, clique fora e voltar/avançar ----------
  document.addEventListener('keydown', (e) => {
    const ctx = st.ctx;
    if (!ctx || celular()) return;
    const s = ctx.s;
    if (e.key === 'Escape' && st.menu) { st.menu = false; st.assTopo = ''; desenharTopo(ctx); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (s.vista !== 'foco' || s.ui?.estado?.vista !== 'funil' || !s.focoEl || s.focoEl.hidden) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (t?.closest?.('.fm-etapas')) return; // na fila de etapas as setas rolam
    if (ir(ctx, e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    if (!st.menu || e.target.closest?.('.fm-met')) return;
    st.menu = false; st.assTopo = '';
    if (st.ctx) desenharTopo(st.ctx);
  });
  addEventListener('popstate', () => {
    const ctx = st.ctx;
    if (!ctx || celular() || !/^\/app\/pipelines(\/|$)/.test(location.pathname)) return;
    const m = modoDoEndereco();
    if (m && m !== ctx.s.vista) { ctx.s.vista = m; gravarLocal(CHAVE_MODO, m); ctx.desenharQuadro(); }
  });

  window.SintoniaFunilModos = { desenhar, focar, trocar, modoInicial, MODOS };
})();
