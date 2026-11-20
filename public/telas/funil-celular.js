/* CRM no celular (até 760 px): o "Pipeline" com três modos (Foco, Lista, Colunas).
 * Registra window.SintoniaFunilCelular = { desenhar(caixa, ctx), focar(conversaId, etapaId) }.
 * Quem chama é /telas/funil.js: ele busca os dados (o mesmo quadro do computador) e entrega as ações reais
 * (mover de etapa, abrir conversa, agendar, novo lead) no ctx. Aqui só desenha.
 * Todo texto que vem do servidor entra por textContent (el(..., { text })), nunca como HTML. */
(() => {
  const IC = {
    baixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    foco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="3"/><path d="M9 9h6M9 13h4"/></svg>',
    lista: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
    colunas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="16.5" y="4" width="4" height="7" rx="1.5"/></svg>',
    esq: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    dir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
    conversa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v11H9l-5 4Z"/></svg>',
    avancar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    pontos: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    agendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    ganho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    venda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 8.5c-.6-1.2-2-2-3.5-2-2 0-3.5 1.1-3.5 2.6 0 3.6 7 2 7 5.6 0 1.5-1.5 2.8-3.5 2.8-1.6 0-3-.8-3.6-2M12 4v2.5M12 17.5V20"/></svg>',
    proposta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4Z"/></svg>',
  };
  /** Botão do meio do cartão: escolhido em cada funil (gestão), guardado no funil (acaoPrincipal). */
  const ACOES = {
    agendar: { nome: 'Agendar', info: 'Abre a conversa com o Agendar' },
    ganho: { nome: 'Marcar como ganho', info: 'Leva para a etapa de ganho' },
    venda: { nome: 'Fechar venda', info: 'Pede o valor e leva para a etapa de ganho' },
    proposta: { nome: 'Enviar proposta', info: 'Abre a conversa para mandar a proposta' },
  };
  const MODOS = [
    ['foco', 'Foco', 'Foco: uma etapa por vez', 'Foco · uma etapa, a próxima cliente em destaque'],
    ['lista', 'Lista', 'Lista: todas de uma vez', 'Lista · todas, quem precisa de você primeiro'],
    ['colunas', 'Colunas', 'Colunas: uma coluna por etapa', 'Colunas · uma coluna por etapa'],
  ];
  const METRICAS = [
    ['valor', 'Valor em aberto', 'em aberto'],
    ['negocios', 'Negócios abertos', 'negócios abertos'],
    ['agendamentos', 'Agendamentos', 'agendamentos'],
    ['vendas', 'Vendas fechadas', 'vendas fechadas'],
  ];
  const DIA = 86400000;

  const CSS = `
  .fc { flex: 1; min-height: 0; display: flex; flex-direction: column; color: var(--texto); position: relative; }
  .fc[hidden] { display: none; }
  .fc button { font-family: inherit; }
  .fc svg { width: 20px; height: 20px; display: block; }
  .fc-topo { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 16px 0; }
  .fc-titulo { all: unset; cursor: pointer; display: flex; flex-direction: column; min-width: 0; }
  .fc-titulo small { font-size: 12.5px; color: var(--sub); }
  .fc-titulo b { font-size: 22px; font-weight: 750; letter-spacing: -.01em; display: flex; align-items: center; gap: 4px; min-width: 0; }
  .fc-titulo b span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-titulo b svg { width: 16px; height: 16px; flex: none; }
  .fc-titulo:focus-visible, .fc-metrica:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 3px; border-radius: 10px; }
  .fc-pilula { flex: none; display: flex; padding: 3px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 6px 18px rgba(13,34,64,.1);
    -webkit-backdrop-filter: blur(18px) saturate(1.4); backdrop-filter: blur(18px) saturate(1.4); }
  .fc-pilula > button { all: unset; box-sizing: border-box; cursor: pointer; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); }
  .fc-pilula > button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -2px; }
  .fc-pilula .tema-bt svg { width: 20px; height: 20px; }
  .fc-destaque { flex: none; padding: 8px 16px 0; position: relative; }
  .fc-metrica { all: unset; cursor: pointer; display: flex; align-items: baseline; gap: 8px; max-width: 100%; }
  .fc-metrica b { font-size: 28px; font-weight: 800; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
  .fc-metrica span { font-size: 12.5px; color: var(--sub); }
  .fc-metrica svg { width: 16px; height: 16px; opacity: .6; align-self: center; }
  .fc-menu { position: absolute; left: 16px; top: 54px; z-index: 30; width: min(290px, calc(100vw - 32px)); padding: 10px; border-radius: 18px; display: flex; flex-direction: column; gap: 2px;
    background: #fff; box-shadow: 0 16px 40px rgba(4,12,24,.22), inset 0 0 0 1px rgba(13,34,64,.06); }
  html[data-tema="escuro"] .fc-menu { background: #10233f; box-shadow: 0 16px 40px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.1); }
  .fc-menu > small { font-size: 11px; color: var(--sub); padding: 2px 12px 6px; }
  .fc-menu button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; width: 100%; border-radius: 12px; padding: 11px 12px; font-size: 14px; color: var(--texto); }
  .fc-menu button span { flex: 1; }
  .fc-menu button[aria-checked="true"] { background: rgba(16,110,190,.08); font-weight: 650; }
  html[data-tema="escuro"] .fc-menu button[aria-checked="true"] { background: rgba(255,255,255,.1); }
  .fc-barra { display: flex; gap: 3px; height: 10px; margin-top: 8px; }
  .fc-barra button { all: unset; cursor: pointer; border-radius: 5px; min-width: 6px; background: var(--cor); opacity: .8; }
  .fc-barra button[aria-current="true"] { opacity: 1; box-shadow: 0 0 0 2px var(--fc-fundo-anel, #fff), 0 0 0 3.5px #3aa0ff; }
  html[data-tema="escuro"] .fc-barra button[aria-current="true"] { --fc-fundo-anel: #071629; }
  .fc-barra-rot { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 11px; color: var(--sub); }
  .fc-barra-rot span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-modos { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 16px 10px; }
  .fc-modos > span { font-size: 12.5px; color: var(--sub); line-height: 1.3; min-width: 0; }
  .fc-icones { flex: none; display: flex; gap: 2px; padding: 3px; border-radius: 15px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fc-icones button { all: unset; box-sizing: border-box; cursor: pointer; width: 44px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: var(--sub); border: 1.5px solid transparent; }
  .fc-icones button[aria-pressed="true"] { color: #fff; background: linear-gradient(135deg,#106ebe,#3aa0ff) padding-box, linear-gradient(135deg,#0ffcbe,#3aa0ff) border-box; box-shadow: 0 6px 16px rgba(16,110,190,.35); }
  .fc-icones button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 1px; }
  .fc-corpo { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .fc-rolar { scrollbar-width: none; }
  .fc-rolar::-webkit-scrollbar { display: none; }
  .fc-vazio { text-align: center; font-size: 13.5px; color: var(--sub); padding: 36px 10px; }
  .fc-erro { display: grid; gap: 10px; justify-items: center; }

  /* foco */
  .fc-painel { flex: 1; min-height: 0; margin: 0 14px calc(92px + env(safe-area-inset-bottom)); position: relative; display: flex; flex-direction: column; gap: 8px; padding: 10px 10px 0; border-radius: 28px; overflow: hidden;
    background: var(--vidro-fundo); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 18px 40px rgba(4,12,24,.14); }
  .fc-painel::after { content: ''; position: absolute; left: 26px; right: 26px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, transparent, #0ffcbe, #3aa0ff, transparent); pointer-events: none; }
  .fc-etapa { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .fc-etapa > div { text-align: center; min-width: 0; }
  .fc-etapa > div b { font-size: 17px; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-etapa > div small { font-size: 12.5px; color: var(--sub); }
  .fc-seta { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--fc-leve); }
  .fc-seta[aria-disabled="true"] { opacity: .35; cursor: default; }
  .fc-pontos { flex: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
  .fc-pontos span { height: 6px; width: 6px; border-radius: 3px; background: var(--fc-trilho); }
  .fc-pontos span.on { width: 22px; background: linear-gradient(90deg,#0ffcbe,#3aa0ff); }
  .fc-cards { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding: 2px 0 16px; overscroll-behavior: contain; }
  .fc-grande { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 13px; border-radius: 22px; background: var(--fc-card); box-shadow: inset 0 0 0 1px var(--fc-card-b), 0 10px 26px rgba(4,12,24,.12); }
  .fc-g0 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .fc-g0 > b { font-size: 11px; font-weight: 700; letter-spacing: .4px; color: #3aa0ff; }
  .fc-g0 > div { display: flex; align-items: center; gap: 4px; }
  .fc-g0 .fc-mini { all: unset; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .fc-g0 .fc-mini svg { width: 18px; height: 18px; }
  .fc-g1 { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .fc-g1 .avatar { width: 44px; height: 44px; flex: none; margin: 0; font-size: 15px; box-shadow: inset 0 0 0 2px var(--cor); }
  .fc-g1 > div { flex: 1; min-width: 0; display: grid; }
  .fc-g1 > div b, .fc-p0 b:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-g1 > div b { font-size: 16px; }
  .fc-g1 > div small { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-valor { font-weight: 750; font-variant-numeric: tabular-nums; flex: none; }
  .fc-valor.fc-sem { color: var(--sub); font-weight: 600; }
  .fc-g1 .fc-valor { font-size: 16px; }
  .fc-passos { display: flex; gap: 4px; }
  .fc-passos i { flex: 1; height: 5px; border-radius: 3px; background: var(--fc-trilho); }
  .fc-passos i.feito { background: #7fd3ff; }
  .fc-passos i.aqui { background: linear-gradient(90deg,#0ffcbe,#3aa0ff); }
  .fc-passos.perdido i { background: rgba(196,58,58,.35); }
  .fc-balao { background: var(--fc-leve); border-radius: 14px; padding: 8px 11px; font-size: 13px; line-height: 1.4; overflow-wrap: anywhere; }
  .fc-balao b { font-size: 11.5px; color: #3aa0ff; display: block; }
  .fc-balao p { margin: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .fc-balao.nada { color: var(--sub); font-style: italic; }
  .fc-acoes { display: flex; align-items: center; gap: 8px; }
  .fc-ico { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; background: var(--fc-leve); color: var(--texto); }
  .fc-principal { all: unset; box-sizing: border-box; cursor: pointer; flex: 1; min-width: 0; height: 44px; border-radius: 14px; border: 1.5px solid transparent; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 8px;
    font-size: 13.5px; font-weight: 700; color: #fff; white-space: nowrap; background: linear-gradient(135deg,#106ebe,#3aa0ff) padding-box, linear-gradient(135deg,#0ffcbe,#3aa0ff) border-box; }
  .fc-principal svg { width: 16px; height: 16px; flex: none; }
  .fc-principal span { overflow: hidden; text-overflow: ellipsis; }
  .fc-principal[aria-disabled="true"] { opacity: .55; cursor: default; }
  .fc-ico:focus-visible, .fc-principal:focus-visible, .fc-seta:focus-visible, .fc-peq:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .fc-peq { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 100%; display: flex; flex-direction: column; gap: 7px; padding: 11px 13px; border-radius: 18px; color: var(--texto);
    background: var(--fc-card); box-shadow: inset 0 0 0 1px var(--fc-card-b); }
  .fc-p0 { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; }
  .fc-p0 b { font-size: 14.5px; }
  .fc-p2 { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--sub); min-width: 0; }
  .fc-p2 span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .fc-p2 span:last-child { flex: none; }
  .fc-selo { flex: none; font-size: 11px; font-weight: 650; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
  .fc-selo.verde { background: rgba(15,252,190,.18); color: #087a5c; }
  .fc-selo.laranja { background: rgba(242,169,59,.22); color: #9a5a00; }
  .fc-selo.vermelho { background: rgba(196,58,58,.16); color: #b3261e; }
  .fc-selo.neutro { background: var(--fc-leve); color: var(--sub); }
  html[data-tema="escuro"] .fc-selo.verde { color: #5ff5cf; }
  html[data-tema="escuro"] .fc-selo.laranja { color: #ffc56b; }
  html[data-tema="escuro"] .fc-selo.vermelho { color: #ff9a92; }
  .fc-carregar { all: unset; box-sizing: border-box; cursor: pointer; flex: none; text-align: center; padding: 11px; border-radius: 999px; font-size: 13.5px; font-weight: 700; color: var(--marca-azul); background: var(--fc-leve); }
  html[data-tema="escuro"] .fc-carregar { color: var(--marca-menta); }

  /* lista */
  .fc-lista { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 16px calc(100px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 8px; overscroll-behavior: contain; }
  .fc-lista > small { font-size: 11px; color: var(--sub); }
  .fc-l0 { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .fc-l0 .avatar { width: 38px; height: 38px; flex: none; margin: 0; font-size: 13px; }
  .fc-l0 > span:nth-child(2) { flex: 1; min-width: 0; display: grid; }
  .fc-l0 > span:nth-child(2) b { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-l0 > span:nth-child(2) small { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-chip { flex: none; max-width: 40%; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 3px 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    background: color-mix(in srgb, var(--cor) 24%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cor) 45%, transparent); }

  /* colunas */
  .fc-cols { flex: 1; min-height: 0; overflow-x: auto; overflow-y: hidden; display: flex; align-items: stretch; gap: 10px; padding: 2px 16px calc(96px + env(safe-area-inset-bottom)); scroll-snap-type: x mandatory; scroll-padding: 0 16px; overscroll-behavior-x: contain; }
  .fc-col { flex: none; width: min(300px, calc(100vw - 64px)); scroll-snap-align: start; display: flex; flex-direction: column; gap: 8px; min-height: 0; padding: 12px; border-radius: 24px;
    background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fc-col > header { flex: none; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .fc-col > header i { width: 10px; height: 10px; border-radius: 50%; background: var(--cor); flex: none; }
  .fc-col > header b { font-size: 14px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fc-col > header span { font-size: 12px; color: var(--sub); flex: none; }
  .fc-col-lista { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; overscroll-behavior: contain; }
  .fc-add { all: unset; box-sizing: border-box; cursor: pointer; flex: none; text-align: center; border: 1.5px dashed var(--sub); border-radius: 14px; padding: 9px; font-size: 12.5px; font-weight: 600; color: var(--sub); opacity: .75; }

  .fc { --fc-card: #fff; --fc-card-b: #fff; --fc-leve: #eef3f9; --fc-trilho: #e1e8f1; }
  html[data-tema="escuro"] .fc { --fc-card: rgba(255,255,255,.07); --fc-card-b: rgba(255,255,255,.1); --fc-leve: rgba(255,255,255,.1); --fc-trilho: rgba(255,255,255,.14); }

  /* busca (folha) */
  dialog.fc-busca-dlg .fn-busca { margin: 0 2px 10px; max-width: none; width: auto; }
  dialog.fc-busca-dlg .fc-achados { display: grid; gap: 2px; max-height: min(56dvh, 440px); overflow-y: auto; padding-bottom: 8px; }

  /* no celular o pipeline novo toma o lugar do quadro e do cabeçalho */
  @media (max-width: 760px) {
    #v-funil.fc-on > .cabeca-vista { display: none !important; }
    #funil.fc-on > .fn-topo, #funil.fc-on > .fn-quadro { display: none !important; }
  }
  @media (prefers-reduced-motion: reduce) { .fc * { transition: none !important; } }
  `;

  // ---------- estado desta tela (sobrevive aos redesenhos) ----------
  const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const st = { caixa: null, ctx: null, modo: null, metrica: null, menu: false, etapaPorFunil: {}, aberto: null, assinatura: '', donoChaves: '', rolagem: {} };
  const chave = (ctx, nome) => `sintonia.crm.${nome}.${ctx.ui.estado.eu?.id || 'local'}`;

  function estilo() {
    if (document.getElementById('estilo-funil-celular')) return;
    const e = document.createElement('style');
    e.id = 'estilo-funil-celular';
    e.textContent = CSS;
    document.head.append(e);
  }

  // ---------- contas ----------
  const nomeDe = (ctx, c) => c.nome || ctx.ui.nomeDe({ telefone: c.telefone });
  const sistema = (ctx) => !!ctx.funil?.sistema;
  const colunas = (ctx) => ctx.q?.colunas || [];
  /** Etapas que contam como "em andamento" (o funil do sistema para no Agendada; os outros, todas menos a última). */
  function abertas(ctx) {
    const cols = colunas(ctx);
    if (sistema(ctx)) return cols.filter((c) => ['novo_lead', 'em_conversa', 'interessada', 'agendada'].includes(c.etapa.chaveSistema));
    return cols.length > 1 ? cols.slice(0, -1) : cols;
  }
  /** Etapa de ganho: Compareceu no funil do sistema; nos outros, a última coluna. */
  function colGanho(ctx) {
    const cols = colunas(ctx);
    if (sistema(ctx)) return cols.find((c) => c.etapa.chaveSistema === 'compareceu') || null;
    return cols.length > 1 ? cols.at(-1) : null;
  }
  const ehPerdida = (col) => col?.etapa.chaveSistema === 'perdida';
  /** Etapas do caminho (a "Perdida" fica fora da barrinha). */
  const caminho = (ctx) => colunas(ctx).filter((c) => !ehPerdida(c));
  function colAgendada(ctx) {
    if (sistema(ctx)) return colunas(ctx).filter((c) => c.etapa.chaveSistema === 'agendada');
    return colunas(ctx).filter((c) => /agend/i.test(c.etapa.nome));
  }
  const visiveis = (ctx, col) => col.cartoes.filter(ctx.passa);
  const somaValor = (lista) => lista.reduce((a, c) => a + (Number(c.valor) || 0), 0);
  function metricas(ctx) {
    const ab = abertas(ctx);
    const ganho = colGanho(ctx);
    return {
      valor: ctx.dinheiro(somaValor(ab.flatMap((c) => visiveis(ctx, c)))),
      negocios: String(ab.reduce((a, c) => a + c.total, 0)),
      agendamentos: String(colAgendada(ctx).reduce((a, c) => a + c.total, 0)),
      vendas: String(ganho ? ganho.total : 0),
    };
  }
  const acaoDoFunil = (ctx) => ctx.funil?.acaoPrincipal || (sistema(ctx) ? 'agendar' : 'ganho');

  /** Selo do tempo parado na etapa: verde até 1 dia, laranja até 3, vermelho depois. Nas etapas finais, neutro. */
  function selo(ctx, cartao, col) {
    const ms = cartao.desde ? Date.now() - new Date(cartao.desde).getTime() : 0;
    const dias = Math.floor(ms / DIA);
    const final = col === colGanho(ctx) || ehPerdida(col);
    const texto = !cartao.desde ? 'agora' : dias < 1 ? (ms < 120000 ? 'chegou agora' : ctx.haTexto(cartao.desde)) : `parada há ${dias} dia${dias === 1 ? '' : 's'}`;
    const cor = final ? 'neutro' : dias < 1 ? 'verde' : dias <= 3 ? 'laranja' : 'vermelho';
    return { texto, cor, nivel: final ? -1 : dias < 1 ? 0 : dias <= 3 ? 1 : 2 };
  }
  /** Quem precisa de você primeiro: cliente esperando resposta (a mais antiga antes), depois quem está parada há mais tempo. */
  function urgencia(ctx, cartao, col) {
    if (col === colGanho(ctx) || ehPerdida(col)) return -1e15;
    const u = cartao.ultima;
    const espera = u && u.autor === 'cliente' ? Date.now() - new Date(u.em).getTime() : -1;
    const parado = cartao.desde ? Date.now() - new Date(cartao.desde).getTime() : 0;
    return espera >= 0 ? 1e13 + espera : parado;
  }
  const ordenar = (ctx, itens) => itens.sort((a, b) => urgencia(ctx, b.cartao, b.col) - urgencia(ctx, a.cartao, a.col));

  function quemAtende(cartao) {
    if (cartao.modo === 'ia') return 'IA';
    return cartao.dona ? cartao.dona.nome || 'Equipe' : 'Sem atendente';
  }

  // ---------- pedaços ----------
  function passos(ctx, col) {
    const { el } = ctx.ui;
    const cam = caminho(ctx);
    const i = cam.indexOf(col);
    const p = el('span', { class: 'fc-passos' + (ehPerdida(col) ? ' perdido' : ''), 'aria-hidden': 'true' });
    for (let k = 0; k < cam.length; k++) p.append(el('i', { class: k < i ? 'feito' : k === i ? 'aqui' : '' }));
    return p;
  }
  function valorEl(ctx, cartao) {
    return ctx.ui.el('b', { class: 'fc-valor' + (cartao.valor == null ? ' fc-sem' : ''), text: cartao.valor == null ? 'R$ —' : ctx.dinheiro(cartao.valor) });
  }

  function cartaoGrande(ctx, cartao, col) {
    const { el, UNIDADE } = ctx.ui;
    const nome = nomeDe(ctx, cartao);
    const sl = selo(ctx, cartao, col);
    const av = ctx.ui.avatar({ id: cartao.conversaId, nome: cartao.nome, telefone: cartao.telefone });
    av.style.setProperty('--cor', col.etapa.cor || '#3aa0ff');
    const u = cartao.ultima;
    const quem = u ? (u.autor === 'cliente' ? String(nome).split(/\s+/)[0] : u.autor === 'ia' ? 'IA' : (String(u.autorNome || 'Equipe').split(/\s+/)[0])) : '';
    const balao = u
      ? el('div', { class: 'fc-balao' }, el('b', { text: `${quem} · ${ctx.haTexto(u.em)}` }), el('p', { text: u.texto || '(mídia)' }))
      : el('div', { class: 'fc-balao nada', text: 'Sem mensagens ainda' });
    const cam = caminho(ctx);
    const prox = cam[cam.indexOf(col) + 1];
    const podeAvancar = !!prox && col !== colGanho(ctx) && !ehPerdida(col);
    const acao = acaoDoFunil(ctx);
    const ganho = colGanho(ctx);
    const jaGanhou = (acao === 'ganho' || acao === 'venda') && ganho === col;
    return el('article', { class: 'fc-grande', 'data-id': cartao.conversaId, 'aria-label': `Próximo a atender: ${nome}` },
      el('div', { class: 'fc-g0' }, el('b', { text: 'PRÓXIMO A ATENDER' }),
        el('div', {}, el('span', { class: 'fc-selo ' + sl.cor, title: 'Tempo nesta etapa', text: sl.texto }),
          el('button', { class: 'fc-mini', type: 'button', 'aria-label': `Mais opções de ${nome}`, title: 'Mover para…, ficha e valor', html: IC.pontos, onclick: () => ctx.menuCartao(cartao.conversaId) }))),
      el('div', { class: 'fc-g1' }, av,
        el('div', {}, el('b', { text: nome }), el('small', { text: [quemAtende(cartao), UNIDADE[cartao.unidade] || ''].filter(Boolean).join(' · ') })),
        valorEl(ctx, cartao)),
      passos(ctx, col),
      balao,
      el('div', { class: 'fc-acoes' },
        el('button', { class: 'fc-ico', type: 'button', 'aria-label': `Abrir conversa com ${nome}`, title: 'Abrir conversa', html: IC.conversa, onclick: () => ctx.ui.abrir(cartao.conversaId) }),
        el('button', { class: 'fc-principal', type: 'button', 'aria-disabled': jaGanhou ? 'true' : null, onclick: () => { if (!jaGanhou) fazerAcao(ctx, acao, cartao, col); } },
          el('span', { html: IC[acao], style: 'display:grid' }), el('span', { text: jaGanhou ? 'Ganho ✓' : ACOES[acao].nome })),
        podeAvancar
          ? el('button', { class: 'fc-ico', type: 'button', 'aria-label': `Mover para ${prox.etapa.nome}`, title: `Mover para ${prox.etapa.nome}`, html: IC.avancar, onclick: () => ctx.mover(cartao.conversaId, prox.etapa.id) })
          : null));
  }

  function cartaoPequeno(ctx, cartao, col, aoTocar, comChip) {
    const { el } = ctx.ui;
    const nome = nomeDe(ctx, cartao);
    const sl = selo(ctx, cartao, col);
    const b = el('button', { class: 'fc-peq', type: 'button', 'data-id': cartao.conversaId, 'aria-label': `${nome}, ${col.etapa.nome}`, onclick: aoTocar });
    if (comChip) {
      const av = ctx.ui.avatar({ id: cartao.conversaId, nome: cartao.nome, telefone: cartao.telefone });
      const chip = el('span', { class: 'fc-chip', text: col.etapa.nome });
      chip.style.setProperty('--cor', col.etapa.cor || '#3aa0ff');
      b.append(el('span', { class: 'fc-l0' }, av,
        el('span', {}, el('b', { text: nome }), el('small', { text: [quemAtende(cartao), cartao.valor == null ? '' : ctx.dinheiro(cartao.valor)].filter(Boolean).join(' · ') })), chip));
    } else {
      b.append(el('span', { class: 'fc-p0' }, el('b', { text: nome }), valorEl(ctx, cartao)));
    }
    b.append(passos(ctx, col),
      el('span', { class: 'fc-p2' }, el('span', { text: comChip ? situacao(ctx, cartao) : quemAtende(cartao) }), el('span', { class: 'fc-selo ' + sl.cor, text: sl.texto })));
    return b;
  }
  function situacao(ctx, cartao) {
    const u = cartao.ultima;
    if (!u) return 'Sem mensagens ainda';
    return u.autor === 'cliente' ? `Esperando resposta ${ctx.haTexto(u.em)}` : `Respondida ${ctx.haTexto(u.em)}`;
  }

  // ---------- ações ----------
  async function fazerAcao(ctx, acao, cartao, col) {
    const ganho = colGanho(ctx);
    if (acao === 'agendar') { ctx.ui.agendar(cartao.conversaId); return; }
    if (acao === 'proposta') {
      const etapaProposta = colunas(ctx).find((c) => /propost/i.test(c.etapa.nome));
      if (etapaProposta && etapaProposta !== col) await ctx.mover(cartao.conversaId, etapaProposta.etapa.id);
      ctx.ui.abrir(cartao.conversaId);
      return;
    }
    if (!ganho) { ctx.ui.toast('Este funil precisa de pelo menos duas etapas: a última é a de ganho.'); return; }
    if (acao === 'venda') {
      const salvo = await ctx.editarValor(cartao);
      if (!salvo) return;
    }
    ctx.mover(cartao.conversaId, ganho.etapa.id);
  }

  function escolherFunil(ctx) {
    const grupos = [ctx.funis.map((f) => ({ nome: f.nome, info: f.conversas != null ? `${f.conversas} cliente${f.conversas === 1 ? '' : 's'}` : '', atual: f.id === ctx.funil?.id, acao: () => ctx.trocarFunil(f.id) }))];
    const extra = [{ nome: 'Filtros', info: 'Origem, atendente, unidade, etiqueta e período', acao: ctx.abrirFiltros }];
    if (ctx.gestao) {
      extra.push({ nome: 'Botão do cartão', info: ACOES[acaoDoFunil(ctx)].nome + (ctx.funil?.acaoPrincipal ? '' : ' (padrão)'), acao: () => ctx.escolherAcao() });
      extra.push({ nome: 'Funis, etapas e automações', info: 'Criar, renomear e organizar', acao: ctx.menuTopo });
    }
    grupos.push(extra);
    ctx.folha('Pipeline', null, grupos);
  }

  function abrirBusca(ctx) {
    const { el } = ctx.ui;
    const d = el('dialog', { class: 'folha fn-folha fc-busca-dlg', 'aria-label': 'Buscar cliente' });
    const fechar = () => d.close();
    const input = el('input', { type: 'search', placeholder: 'Nome ou telefone', 'aria-label': 'Buscar cliente por nome ou telefone', autocomplete: 'off' });
    const lista = el('div', { class: 'fc-achados', role: 'listbox', 'aria-label': 'Clientes encontradas' });
    let t = null, pedido = 0;
    const buscar = async () => {
      const q = input.value.trim();
      if (q.length < 2) { lista.replaceChildren(); return; }
      const meu = ++pedido;
      let achados = [];
      try { achados = await ctx.buscar(q); } catch { achados = []; }
      if (meu !== pedido || !d.open) return;
      lista.replaceChildren(...(achados.length ? achados.map((a) => {
        const etapa = el('small', {}, el('i'), el('span', { text: a.etapa.nome }));
        etapa.style.setProperty('--cor', a.etapa.cor);
        return el('div', { class: 'fn-achado', role: 'option', tabindex: '0', onclick: () => { fechar(); ctx.pular(a.conversaId, a.etapa.id, a); },
          onkeydown: (e) => { if (e.key === 'Enter') { fechar(); ctx.pular(a.conversaId, a.etapa.id, a); } } },
        ctx.ui.avatar({ id: a.conversaId, nome: a.nome, telefone: a.telefone }),
        el('span', { class: 'fn-achado-txt' }, el('b', { text: a.nome || ctx.ui.formatarTel(a.telefone) }), etapa));
      }) : [el('div', { class: 'fn-sem', text: 'Nenhum cliente encontrado' })]));
    };
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });
    d.append(el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: 'Buscar cliente' }),
      el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: IC.fechar, onclick: fechar })),
    el('label', { class: 'fn-busca' }, el('span', { html: IC.busca, style: 'display:grid' }), input), lista);
    ctx.abrirDialogo(d);
    input.focus();
  }

  // ---------- desenho ----------
  function irEtapa(ctx, idx) {
    const cols = colunas(ctx);
    if (!cols.length) return;
    const col = cols[(idx + cols.length) % cols.length];
    st.etapaPorFunil[ctx.funil.id] = col.etapa.id;
    st.modo = 'foco'; gravarLocal(chave(ctx, 'modoCelular'), 'foco');
    st.aberto = null;
    redesenhar(true);
  }
  function etapaAtual(ctx) {
    const cols = colunas(ctx);
    const id = st.etapaPorFunil[ctx.funil?.id];
    let i = cols.findIndex((c) => c.etapa.id === id);
    if (i < 0) { i = cols.findIndex((c) => c.total > 0); if (i < 0) i = 0; }
    return i;
  }

  function topo(ctx) {
    const { el } = ctx.ui;
    const pilula = el('span', { class: 'fc-pilula' },
      el('button', { type: 'button', 'aria-label': 'Buscar cliente', title: 'Buscar', html: IC.busca, onclick: () => abrirBusca(ctx) }));
    if (window.SintoniaBotaoTema) pilula.append(window.SintoniaBotaoTema('fc-tema'));
    pilula.append(el('button', { type: 'button', 'aria-label': 'Novo lead', title: 'Novo lead', html: IC.mais, onclick: ctx.novoLead }));
    return el('div', { class: 'fc-topo' },
      el('button', { class: 'fc-titulo', type: 'button', 'aria-haspopup': 'dialog', 'aria-label': `Pipeline ${ctx.funil?.nome || ''}. Trocar de pipeline`, onclick: () => escolherFunil(ctx) },
        el('small', { text: 'Pipeline' }), el('b', {}, el('span', { text: ctx.funil?.nome || 'CRM' }), el('span', { html: IC.baixo, style: 'display:grid;overflow:visible' }))),
      pilula);
  }

  function destaque(ctx) {
    const { el } = ctx.ui;
    const m = metricas(ctx);
    const atual = METRICAS.find((x) => x[0] === st.metrica) || METRICAS[0];
    const caixa = el('div', { class: 'fc-destaque' });
    caixa.append(el('button', { class: 'fc-metrica', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': String(st.menu), title: 'Escolher o número em destaque',
      onclick: (e) => { e.stopPropagation(); st.menu = !st.menu; redesenhar(true); } },
    el('b', { text: m[atual[0]] }), el('span', { text: atual[2] }), el('span', { html: IC.baixo, style: 'display:grid' })));
    if (st.menu) {
      caixa.append(el('div', { class: 'fc-menu', role: 'menu', 'aria-label': 'Mostrar em destaque' }, el('small', { text: 'Mostrar em destaque' }),
        ...METRICAS.map(([id, nome]) => el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(id === atual[0]),
          onclick: (e) => { e.stopPropagation(); st.metrica = id; st.menu = false; gravarLocal(chave(ctx, 'destaque'), id); redesenhar(true); } },
        el('span', { text: nome }), el('b', { text: m[id] })))));
    }
    // Barra do funil: cada cor é uma etapa (largura = quantas clientes); tocar vai para a etapa.
    const cols = colunas(ctx);
    const i = etapaAtual(ctx);
    const barra = el('div', { class: 'fc-barra', role: 'group', 'aria-label': 'Etapas do funil' },
      ...cols.map((c, k) => {
        const b = el('button', { type: 'button', 'aria-label': `${c.etapa.nome}: ${c.total} cliente${c.total === 1 ? '' : 's'}`, title: `${c.etapa.nome} · ${c.total}`,
          'aria-current': st.modo === 'foco' && k === i ? 'true' : null, onclick: () => irEtapa(ctx, k) });
        b.style.setProperty('--cor', c.etapa.cor || '#3aa0ff');
        b.style.flex = String(Math.max(0.5, c.total));
        return b;
      }));
    const total = cols.reduce((a, c) => a + c.total, 0);
    const ganho = colGanho(ctx);
    // Meio: a taxa de ganho (quantas chegaram na etapa de ganho), quando ela não é a última coluna já nomeada à direita.
    const pct = ganho && total ? ` ${Math.round((ganho.total / total) * 100)}%` : '';
    const meio = ganho && ganho !== cols.at(-1) ? `${ganho.etapa.nome}${pct}` : `${total} no funil`;
    caixa.append(barra, el('div', { class: 'fc-barra-rot' }, el('span', { text: cols[0]?.etapa.nome || '' }), el('span', { text: meio }), el('span', { text: cols.length > 1 ? cols.at(-1).etapa.nome + (ganho === cols.at(-1) ? pct : '') : '' })));
    return caixa;
  }

  function seletorModo(ctx) {
    const { el } = ctx.ui;
    const m = MODOS.find((x) => x[0] === st.modo) || MODOS[0];
    return el('div', { class: 'fc-modos' }, el('span', { text: m[3] }),
      el('div', { class: 'fc-icones', role: 'group', 'aria-label': 'Modo de ver' },
        ...MODOS.map(([id, nome, rotulo]) => el('button', { type: 'button', 'aria-label': rotulo, title: nome, 'aria-pressed': String(st.modo === id), html: IC[id],
          onclick: () => { if (st.modo === id) return; st.modo = id; gravarLocal(chave(ctx, 'modoCelular'), id); redesenhar(true); } }))));
  }

  function modoFoco(ctx) {
    const { el } = ctx.ui;
    const cols = colunas(ctx);
    const i = etapaAtual(ctx);
    const col = cols[i];
    const painel = el('div', { class: 'fc-painel' });
    if (!col) { painel.append(el('p', { class: 'fc-vazio', text: 'Este funil ainda não tem etapas.' })); return painel; }
    const vis = visiveis(ctx, col);
    const itens = ordenar(ctx, vis.map((cartao) => ({ cartao, col })));
    const abertoId = itens.some((x) => x.cartao.conversaId === st.aberto) ? st.aberto : itens[0]?.cartao.conversaId;
    const n = col.total;
    painel.append(
      el('div', { class: 'fc-etapa' },
        el('button', { class: 'fc-seta', type: 'button', 'aria-label': 'Etapa anterior', html: IC.esq, onclick: () => irEtapa(ctx, i - 1) }),
        el('div', { 'aria-live': 'polite' }, el('b', { text: col.etapa.nome }), el('small', { text: `${n} negócio${n === 1 ? '' : 's'} · ${ctx.dinheiro(somaValor(vis))}` })),
        el('button', { class: 'fc-seta', type: 'button', 'aria-label': 'Próxima etapa', html: IC.dir, onclick: () => irEtapa(ctx, i + 1) })),
      el('div', { class: 'fc-pontos', 'aria-hidden': 'true' }, ...cols.map((c, k) => el('span', { class: k === i ? 'on' : '' }))));
    const cards = el('div', { class: 'fc-cards fc-rolar', 'data-rolar': 'foco' });
    if (!itens.length) cards.append(el('p', { class: 'fc-vazio', text: col.cartoes.length ? 'Ninguém com esses filtros nesta etapa.' : 'Nenhum negócio nesta etapa.' }));
    for (const { cartao } of itens) {
      cards.append(cartao.conversaId === abertoId
        ? cartaoGrande(ctx, cartao, col)
        : cartaoPequeno(ctx, cartao, col, () => { st.aberto = cartao.conversaId; redesenhar(true); const c = st.caixa?.querySelector('.fc-cards'); if (c) c.scrollTop = 0; }));
    }
    if (col.mais) cards.append(el('button', { class: 'fc-carregar', type: 'button', text: `Carregar mais (${Math.max(0, col.total - col.cartoes.length)})`, onclick: () => ctx.carregarMais(col) }));
    painel.append(cards);
    return painel;
  }

  function modoLista(ctx) {
    const { el } = ctx.ui;
    const itens = ordenar(ctx, colunas(ctx).flatMap((col) => visiveis(ctx, col).map((cartao) => ({ cartao, col }))));
    const total = colunas(ctx).reduce((a, c) => a + c.total, 0);
    const carregadas = colunas(ctx).reduce((a, c) => a + c.cartoes.length, 0);
    const lista = el('div', { class: 'fc-lista fc-rolar', 'data-rolar': 'lista' },
      el('small', { text: 'Ordenado por quem precisa de você primeiro' + (carregadas < total ? ` · ${carregadas} de ${total}` : '') }));
    if (!itens.length) lista.append(el('p', { class: 'fc-vazio', text: 'Nenhum negócio neste funil.' }));
    for (const { cartao, col } of itens) lista.append(cartaoPequeno(ctx, cartao, col, () => focar(cartao.conversaId, col.etapa.id), true));
    for (const col of colunas(ctx)) if (col.mais) lista.append(el('button', { class: 'fc-carregar', type: 'button', text: `Carregar mais de ${col.etapa.nome} (${Math.max(0, col.total - col.cartoes.length)})`, onclick: () => ctx.carregarMais(col) }));
    return lista;
  }

  function modoColunas(ctx) {
    const { el } = ctx.ui;
    const caixa = el('div', { class: 'fc-cols fc-rolar', 'data-rolar': 'colunas' });
    for (const col of colunas(ctx)) {
      const vis = visiveis(ctx, col);
      const itens = ordenar(ctx, vis.map((cartao) => ({ cartao, col })));
      const lista = el('div', { class: 'fc-col-lista fc-rolar', 'data-rolar': `col-${col.etapa.id}` },
        ...itens.map(({ cartao }) => cartaoPequeno(ctx, cartao, col, () => focar(cartao.conversaId, col.etapa.id))));
      if (!itens.length) lista.append(el('p', { class: 'fc-vazio', text: 'Ninguém aqui.' }));
      if (col.mais) lista.append(el('button', { class: 'fc-carregar', type: 'button', text: 'Carregar mais', onclick: () => ctx.carregarMais(col) }));
      const sec = el('section', { class: 'fc-col', 'aria-label': col.etapa.nome },
        el('header', {}, el('i'), el('b', { text: col.etapa.nome }), el('span', { text: `${col.total} · ${ctx.dinheiro(somaValor(vis))}` })),
        lista,
        ctx.gestao ? el('button', { class: 'fc-add', type: 'button', text: '+ Adicionar', onclick: () => ctx.adicionarCliente(col) }) : null);
      sec.style.setProperty('--cor', col.etapa.cor || '#3aa0ff');
      caixa.append(sec);
    }
    return caixa;
  }

  /** Assinatura do que aparece: se nada mudou, não redesenha (não perde a rolagem nem o toque). */
  function assinar(ctx) {
    return JSON.stringify([ctx.funil?.id, ctx.funil?.nome, ctx.funil?.acaoPrincipal, ctx.gestao, ctx.erro, st.modo, st.metrica, st.menu, st.aberto, st.etapaPorFunil[ctx.funil?.id], Math.floor(Date.now() / 60000), ctx.filtros,
      ctx.funis.map((f) => [f.id, f.nome, f.conversas]),
      colunas(ctx).map((c) => [c.etapa.id, c.etapa.nome, c.etapa.cor, c.total, c.mais, c.cartoes.map((x) => [x.conversaId, x.nome, x.valor, x.desde, x.ultima?.em, x.ultima?.texto, x.dona?.id, x.modo])])]);
  }

  function guardarRolagem() {
    if (!st.caixa) return;
    for (const n of st.caixa.querySelectorAll('[data-rolar]')) st.rolagem[n.dataset.rolar] = [n.scrollLeft, n.scrollTop];
  }
  function voltarRolagem() {
    for (const n of st.caixa.querySelectorAll('[data-rolar]')) { const r = st.rolagem[n.dataset.rolar]; if (r) { n.scrollLeft = r[0]; n.scrollTop = r[1]; } }
  }

  function redesenhar(forcar) {
    const ctx = st.ctx;
    if (!ctx || !st.caixa) return;
    const { el } = ctx.ui;
    const ass = assinar(ctx);
    if (!forcar && ass === st.assinatura) return;
    st.assinatura = ass;
    guardarRolagem();
    if (!ctx.q) {
      st.caixa.replaceChildren(topo(ctx), el('div', { class: 'fc-vazio fc-erro' }, el('span', { text: ctx.erro ? `Não deu para carregar: ${ctx.erro}` : 'Carregando…' }),
        ctx.erro ? el('button', { class: 'botao leve', type: 'button', text: 'Tentar de novo', onclick: ctx.recarregar }) : null));
      return;
    }
    const corpo = el('div', { class: 'fc-corpo' }, st.modo === 'lista' ? modoLista(ctx) : st.modo === 'colunas' ? modoColunas(ctx) : modoFoco(ctx));
    st.caixa.replaceChildren(topo(ctx), destaque(ctx), seletorModo(ctx), corpo);
    voltarRolagem();
  }

  /** Abre o modo Foco na etapa, com o cartão grande (busca, novo lead, toque na Lista ou nas Colunas). */
  function focar(conversaId, etapaId) {
    const ctx = st.ctx;
    if (!ctx) return;
    st.modo = 'foco'; gravarLocal(chave(ctx, 'modoCelular'), 'foco');
    if (ctx.funil) st.etapaPorFunil[ctx.funil.id] = etapaId;
    st.aberto = conversaId;
    st.rolagem.foco = [0, 0];
    redesenhar(true);
  }

  function desenhar(caixa, ctx) {
    estilo();
    st.caixa = caixa;
    st.ctx = ctx;
    const dono = chave(ctx, '');
    if (st.donoChaves !== dono) {
      st.donoChaves = dono;
      const m = lerLocal(chave(ctx, 'modoCelular'));
      st.modo = MODOS.some((x) => x[0] === m) ? m : 'foco';
      const d = lerLocal(chave(ctx, 'destaque'));
      st.metrica = METRICAS.some((x) => x[0] === d) ? d : 'valor';
    }
    if (!caixa.dataset.fcLigado) {
      caixa.dataset.fcLigado = '1';
      // tocar fora fecha o menu do número em destaque
      document.addEventListener('click', (e) => { if (st.menu && !e.target.closest?.('.fc-destaque')) { st.menu = false; redesenhar(true); } });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st.menu) { st.menu = false; redesenhar(true); } });
    }
    redesenhar(false);
  }

  window.SintoniaFunilCelular = { desenhar, focar, ACOES };
})();
