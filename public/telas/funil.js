/* Tela "funil" (CRM) da Sintonia: registra window.SintoniaTelas.funil = { desenhar(caixa, ui) }.
 * Quadro Kanban dos funis por tags: cada coluna é uma etapa (uma tag do funil). Mover o cartão troca a tag.
 * Arrastar e soltar com pointer events (mouse e toque: no toque, segure o cartão para arrastar) e,
 * em qualquer aparelho, "Mover para…" pelo botão ⋯ do cartão. Atualização otimista com volta se der erro.
 * Todo texto que vem do servidor entra por textContent (el(..., { text })), nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const SVG = {
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    pontos: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
    raio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 2.5 4.8 13.4c-.3.4 0 1 .5 1h5.2l-1.4 7.1c-.1.6.7.9 1 .4l8.4-10.9c.3-.4 0-1-.5-1h-5.2l1.4-7.1c.1-.6-.7-.9-1-.4Z"/></svg>',
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    conversa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/></svg>',
    lapis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg>',
    esquerda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    direita: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5 7 7-7 7"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H9"/></svg>',
  };

  const CSS = `
  #funil.fn-caixa { display: flex; flex-direction: column; padding: 0; gap: 0; overflow: hidden; align-items: stretch; }
  .fn-barra { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 16px 10px; flex: none; }
  .fn-linha { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .fn-linha.fn-l1 { flex: 1 1 360px; }
  .fn-linha.fn-l2 { flex: 0 1 auto; }
  .fn-funis { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; flex: 1; min-width: 0; padding: 2px; }
  .fn-funis::-webkit-scrollbar { display: none; }
  .fn-pilula { all: unset; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px; border-radius: 999px; font-size: 14.5px; font-weight: 650; color: var(--sub);
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; }
  .fn-pilula:hover { color: var(--texto); }
  .fn-pilula[aria-pressed="true"] { color: var(--texto); background: var(--vidro-ativo); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-azul) 55%, var(--vidro-borda)), 0 6px 18px rgba(0, 41, 65,.18); }
  html[data-tema="escuro"] .fn-pilula[aria-pressed="true"] { box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.55), 0 8px 22px rgba(0,0,0,.35); }
  .fn-pilula .fn-qtd { font-size: 12px; font-weight: 700; color: var(--sub); }
  .fn-pilula.fn-novo { color: var(--marca-azul); background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 40%, transparent); }
  html[data-tema="escuro"] .fn-pilula.fn-novo { color: var(--marca-menta); box-shadow: inset 0 0 0 1px rgba(253, 110, 110,.35); }
  .fn-pilula svg { width: 16px; height: 16px; }
  .fn-redondo { all: unset; cursor: pointer; flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fn-redondo svg { width: 20px; height: 20px; }
  .fn-redondo:hover { background: var(--vidro-ativo); }
  .fn-busca { flex: 1 1 240px; min-width: 0; width: 280px; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; border-radius: 14px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--sub); max-width: 360px; }
  .fn-busca svg { width: 17px; height: 17px; flex: none; }
  .fn-busca input { all: unset; flex: 1; min-width: 0; font-size: 15px; color: var(--texto); }
  .fn-busca input::placeholder { color: var(--sub); }
  .fn-unidades { display: flex; gap: 6px; flex: none; }
  .fn-unidades .fn-pilula { height: 34px; padding: 0 12px; font-size: 13.5px; }
  .fn-espaco { flex: 1; }
  .fn-unidade-sel { display: none; flex: none; height: 38px; border-radius: 14px; padding: 0 10px; font: inherit; font-size: 14.5px; font-weight: 650; color: var(--texto);
    background: var(--vidro-item); border: 0; box-shadow: inset 0 0 0 1px var(--vidro-borda); max-width: 46%; }

  .fn-quadro { flex: 1; min-height: 0; display: flex; gap: 12px; overflow-x: auto; overflow-y: hidden; padding: 4px 16px 16px; align-items: stretch; overscroll-behavior-x: contain; }
  .fn-col { width: 296px; flex: none; display: flex; flex-direction: column; min-height: 0; max-height: 100%; border-radius: 22px; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho);
    -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); transition: box-shadow .15s ease, transform .15s ease; position: relative; }
  .fn-col::before { content: ""; position: absolute; left: 18px; right: 18px; top: 0; height: 3px; border-radius: 0 0 4px 4px; background: var(--cor); opacity: .9; box-shadow: 0 0 12px color-mix(in srgb, var(--cor) 60%, transparent); }
  .fn-col.fn-alvo { box-shadow: inset 0 0 0 2px var(--cor), 0 0 0 4px color-mix(in srgb, var(--cor) 18%, transparent), var(--vidro-brilho); }
  .fn-cab { display: flex; align-items: center; gap: 8px; padding: 14px 10px 8px 16px; flex: none; }
  .fn-cab .fn-ponto { width: 10px; height: 10px; border-radius: 4px; background: var(--cor); flex: none; box-shadow: 0 0 8px color-mix(in srgb, var(--cor) 55%, transparent); }
  .fn-cab h2 { margin: 0; font-size: 15.5px; font-weight: 750; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--texto); }
  .fn-cab .fn-total { font-size: 13px; font-weight: 700; color: var(--sub); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); border-radius: 999px; padding: 2px 9px; }
  .fn-cab .fn-redondo { width: 32px; height: 32px; background: transparent; box-shadow: none; color: var(--sub); }
  .fn-cab .fn-redondo:hover { background: var(--vidro-item); color: var(--texto); }
  .fn-cab .fn-redondo svg { width: 18px; height: 18px; }
  .fn-raio { all: unset; cursor: pointer; flex: none; height: 30px; min-width: 30px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;
    color: #f5b301; font-size: 12.5px; font-weight: 800; }
  .fn-raio svg { width: 18px; height: 18px; filter: drop-shadow(0 0 5px rgba(255,190,0,.65)); }
  .fn-raio:hover { background: rgba(255,190,0,.14); }
  .fn-raio.fn-tem { background: rgba(255,190,0,.16); box-shadow: inset 0 0 0 1px rgba(255,190,0,.45), 0 0 12px rgba(255,190,0,.25); color: #b37f00; }
  html[data-tema="escuro"] .fn-raio.fn-tem { color: #ffd34d; }
  .fn-raio:not(.fn-tem) { opacity: .8; }
  .fn-raio:not(.fn-tem) b { display: none; }
  .fn-lista { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 10px 6px; display: flex; flex-direction: column; gap: 8px; scrollbar-width: thin; }
  .fn-vazio { margin: 6px 4px 10px; padding: 18px 10px; border-radius: 16px; border: 1.5px dashed var(--vidro-linha); color: var(--sub); font-size: 13.5px; text-align: center; }
  .fn-col.fn-alvo .fn-vazio { border-color: var(--cor); color: var(--texto); }
  .fn-carregar { all: unset; cursor: pointer; margin: 0 10px 12px; padding: 10px; border-radius: 14px; text-align: center; font-size: 13.5px; font-weight: 700; color: var(--marca-azul); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  html[data-tema="escuro"] .fn-carregar { color: var(--marca-menta); }

  .fn-cartao { position: relative; display: grid; gap: 6px; padding: 11px 10px 10px 12px; border-radius: 16px; cursor: pointer; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 2px 8px rgba(0, 41, 65,.06);
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-x pan-y; transition: transform .12s ease, box-shadow .12s ease, opacity .12s ease; flex: none; }
  .fn-cartao:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 35%, var(--vidro-borda)), 0 6px 16px rgba(0, 41, 65,.12); }
  .fn-cartao:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .fn-cartao.fn-saindo { opacity: .3; transform: scale(.98); }
  .fn-cartao.fn-segurando { transform: scale(.97); }
  .fn-cartao.fn-novo-aqui { animation: fn-chegou .6s ease; }
  @keyframes fn-chegou { 0% { box-shadow: inset 0 0 0 2px var(--marca-menta), 0 0 0 6px rgba(253, 110, 110,.25); } 100% { box-shadow: inset 0 0 0 1px var(--vidro-borda); } }
  .fn-c1 { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .fn-c1 .avatar { width: 38px; height: 38px; font-size: 14px; }
  .fn-quem { flex: 1; min-width: 0; display: grid; line-height: 1.2; }
  .fn-quem .fn-n { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .fn-quem b { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--texto); }
  .fn-quem span { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fn-mais { all: unset; cursor: pointer; width: 34px; height: 34px; margin: -4px -4px -4px 0; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; }
  .fn-mais:hover { background: var(--vidro-item); color: var(--texto); }
  .fn-mais svg { width: 18px; height: 18px; }
  .fn-previa { font-size: 13.5px; color: var(--sub); line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .fn-previa i { font-style: normal; font-weight: 650; color: var(--texto); opacity: .8; }
  .fn-c3 { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
  .fn-tag { font-size: 11.5px; font-weight: 700; border-radius: 6px; padding: 2px 6px; background: color-mix(in srgb, var(--cor) 18%, transparent); color: color-mix(in srgb, var(--cor) 72%, var(--texto)); white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
  .fn-desde { flex: none; display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--sub); white-space: nowrap; }
  .fn-desde svg { width: 13px; height: 13px; }
  .fn-desde.fn-velho { color: #d9480f; font-weight: 700; }
  html[data-tema="escuro"] .fn-desde.fn-velho { color: #ffa94d; }

  .fn-fantasma { position: fixed; z-index: 1000; pointer-events: none; margin: 0; transform: rotate(2.5deg) scale(1.03); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-azul) 55%, var(--vidro-borda)), 0 24px 50px rgba(0, 41, 65,.3) !important;
    background: var(--vidro-forte); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); opacity: .96; }
  .fn-arrastando, .fn-arrastando * { cursor: grabbing !important; }
  .fn-arrastando .fn-quadro { scroll-snap-type: none !important; }

  .fn-nova-etapa { all: unset; cursor: pointer; width: 220px; flex: none; align-self: flex-start; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; height: 54px; border-radius: 18px;
    border: 1.5px dashed color-mix(in srgb, var(--marca-azul) 40%, var(--vidro-borda)); color: var(--marca-azul); font-weight: 700; font-size: 14.5px; }
  html[data-tema="escuro"] .fn-nova-etapa { color: var(--marca-menta); border-color: rgba(253, 110, 110,.3); }
  .fn-nova-etapa svg { width: 18px; height: 18px; }
  .fn-erro { margin: 30px auto; color: var(--sub); text-align: center; display: grid; gap: 10px; justify-items: center; }

  /* folhas e diálogos desta tela */
  dialog.fn-folha .folha-lista .fn-ponto-g { width: 14px; height: 14px; border-radius: 5px; background: var(--cor); flex: none; box-shadow: 0 0 8px color-mix(in srgb, var(--cor) 55%, transparent); }
  dialog.fn-folha .folha-lista button > svg { width: 22px; height: 22px; color: var(--sub); }
  dialog.fn-folha .folha-lista button.fn-perigo, dialog.fn-folha .folha-lista button.fn-perigo b, dialog.fn-folha .folha-lista button.fn-perigo svg { color: #e5484d; }
  dialog.fn-folha .folha-lista button[aria-disabled="true"] { opacity: .45; cursor: default; }
  dialog.fn-folha .fn-sub { margin: -4px 6px 12px; text-align: center; color: var(--sub); font-size: 14px; }
  dialog.fn-folha .folha-lista + .folha-lista { margin-top: 12px; }
  dialog.fn-dlg form { gap: 14px; }
  dialog.fn-dlg .cores .cor { width: 32px; height: 32px; }
  dialog.fn-dlg .fn-aviso { margin: 0; font-size: 14px; color: var(--sub); line-height: 1.45; }
  dialog.fn-dlg .botao.fn-perigo { background: #e5484d !important; color: #fff !important; }

  @media (max-width: 760px) {
    .fn-barra { padding: 6px 14px 6px; }
    .fn-busca { max-width: none; width: auto; }
    .fn-linha.fn-l1, .fn-linha.fn-l2 { flex: 1 1 100%; }
    .fn-unidades { display: none; }
    .fn-unidade-sel:not([hidden]) { display: block; }
    .fn-quadro { scroll-snap-type: x mandatory; padding: 4px 14px calc(100px + env(safe-area-inset-bottom)); gap: 10px; scroll-padding: 0 14px; }
    .fn-col { width: calc(100vw - 46px); scroll-snap-align: center; scroll-snap-stop: always; }
    .fn-nova-etapa { width: calc(100vw - 46px); scroll-snap-align: center; }
    .fn-cartao { padding: 12px 10px 12px 12px; }
    .fn-mais { width: 40px; height: 40px; }
    .fn-cab .fn-redondo { width: 38px; height: 38px; }
    .fn-raio { height: 36px; min-width: 36px; }
  }
  @media (hover: hover) and (min-width: 761px) {
    .fn-cartao .fn-mais { opacity: 0; }
    .fn-cartao:hover .fn-mais, .fn-cartao:focus-within .fn-mais { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .fn-cartao, .fn-col { transition: none; } .fn-cartao.fn-novo-aqui { animation: none; } }
  `;

  // ---------- estado (sobrevive entre aberturas da aba) ----------
  const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const s = {
    ui: null, caixa: null, montado: false,
    funis: [], funisEm: 0, funilId: lerLocal('sintonia.crm.funil'), unidade: lerLocal('sintonia.crm.unidade') || '', busca: '',
    q: null, carregados: {}, geracao: 0, buscando: false, erro: null,
    colEls: new Map(), cartaoEls: new Map(), autos: [], autosEm: 0, cores: [],
    arrasto: null, aperto: null, abertos: 0, assinaturaFunis: '',
  };
  const PAGINA = 50;

  function estilo() {
    if (document.getElementById('estilo-funil')) return;
    const st = document.createElement('style');
    st.id = 'estilo-funil';
    st.textContent = CSS;
    document.head.append(st);
  }

  const ehGestao = () => s.ui && s.ui.ehGestor(s.ui.estado.eu);
  const funil = () => s.funis.find((f) => f.id === s.funilId) || s.funis[0];
  const primeiroNome = (n) => String(n || '').split(/\s+/)[0];
  const ha = (d) => {
    if (!d) return '';
    const min = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} h`;
    const dias = Math.round(h / 24);
    return dias < 60 ? `${dias} d` : `${Math.round(dias / 30)} m`;
  };

  // ---------- dados ----------
  async function carregarFunis(forcar) {
    if (!forcar && s.funis.length && Date.now() - s.funisEm < 20000) return;
    const lista = await s.ui.api('/api/funis');
    s.funis = Array.isArray(lista) ? lista : [];
    s.funisEm = Date.now();
    if (!s.funis.some((f) => f.id === s.funilId)) s.funilId = s.funis[0]?.id || null;
  }
  async function carregarAutos(forcar) {
    if (!ehGestao()) { s.autos = []; return; }
    if (!forcar && Date.now() - s.autosEm < 30000) return;
    try { s.autos = await s.ui.api('/api/automacoes'); s.autosEm = Date.now(); } catch { s.autos = s.autos || []; }
  }
  const autosDaEtapa = (etapaId) => (s.autos || []).filter((a) => a.gatilho && a.gatilho.etapaId === etapaId && (a.gatilho.tipo === 'entrou_na_etapa' || a.gatilho.tipo === 'parada_na_etapa'));

  function urlQuadro(extra = {}) {
    const p = new URLSearchParams();
    if (s.unidade) p.set('unidade', s.unidade);
    if (s.busca.trim()) p.set('busca', s.busca.trim());
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `/api/funis/${s.funilId}/quadro?${p}`;
  }

  /** Busca o quadro (primeira página de cada coluna + o que a pessoa já carregou a mais) e redesenha sem piscar. */
  async function carregarQuadro() {
    if (!s.funilId) return;
    const geracao = ++s.geracao;
    s.buscando = true;
    try {
      const q = await s.ui.api(urlQuadro({ limite: PAGINA }));
      const extras = q.colunas.filter((c) => (s.carregados[c.etapa.id] || 0) > PAGINA && c.mais);
      await Promise.all(extras.map(async (c) => {
        const r = await s.ui.api(urlQuadro({ etapaId: c.etapa.id, offset: PAGINA, limite: Math.min(200, s.carregados[c.etapa.id] - PAGINA) }));
        const cr = r.colunas[0];
        if (cr) { c.cartoes = c.cartoes.concat(cr.cartoes); c.mais = cr.mais; }
      }));
      if (geracao !== s.geracao || s.arrasto) return; // chegou depois de um movimento: ignora para não voltar o cartão
      s.q = q; s.erro = null;
      desenharQuadro();
    } catch (x) {
      if (geracao !== s.geracao) return;
      s.erro = x.message;
      if (!s.q) desenharQuadro();
    } finally { if (geracao === s.geracao) s.buscando = false; }
  }

  async function carregarMais(col) {
    const id = col.etapa.id;
    const ja = col.cartoes.length;
    try {
      const r = await s.ui.api(urlQuadro({ etapaId: id, offset: ja, limite: PAGINA }));
      const cr = r.colunas[0]; if (!cr) return;
      const vistos = new Set(col.cartoes.map((c) => c.conversaId));
      col.cartoes = col.cartoes.concat(cr.cartoes.filter((c) => !vistos.has(c.conversaId)));
      col.mais = cr.mais; col.total = cr.total;
      s.carregados[id] = col.cartoes.length;
      desenharQuadro();
    } catch (x) { s.ui.toast(x.message); }
  }

  // ---------- montagem ----------
  function montar() {
    const { el } = s.ui;
    s.caixa.classList.add('fn-caixa');
    s.barraFunis = el('div', { class: 'fn-funis', role: 'tablist', 'aria-label': 'Funis' });
    s.botaoFunil = el('button', { class: 'fn-redondo', type: 'button', title: 'Opções do funil', 'aria-label': 'Opções do funil', html: SVG.pontos, onclick: menuFunil });
    const busca = el('input', { type: 'search', placeholder: 'Buscar nome ou telefone', 'aria-label': 'Buscar no quadro', value: s.busca });
    let t = null;
    busca.addEventListener('input', () => { s.busca = busca.value; clearTimeout(t); t = setTimeout(() => { s.carregados = {}; carregarQuadro(); }, 300); });
    s.unidades = el('div', { class: 'fn-unidades', role: 'group', 'aria-label': 'Unidade' });
    s.unidadeSel = el('select', { class: 'fn-unidade-sel', 'aria-label': 'Unidade' });
    s.unidadeSel.addEventListener('change', () => escolherUnidade(s.unidadeSel.value));
    s.quadro = el('div', { class: 'fn-quadro' });
    s.caixa.replaceChildren(
      el('div', { class: 'fn-barra' },
        el('div', { class: 'fn-linha fn-l1' }, s.barraFunis, s.botaoFunil),
        el('div', { class: 'fn-linha fn-l2' }, el('label', { class: 'fn-busca' }, el('span', { html: SVG.busca, style: 'display:grid' }), busca), s.unidades, s.unidadeSel)),
      s.quadro,
    );
    s.colEls.clear(); s.cartaoEls.clear();
    s.montado = true;
  }

  function desenharBarra() {
    const { el, UNIDADE } = s.ui;
    const gestao = ehGestao();
    const assinatura = JSON.stringify([s.funilId, gestao, s.unidade, s.funis.map((f) => [f.id, f.nome, f.conversas])]);
    if (assinatura === s.assinaturaFunis) return;
    s.assinaturaFunis = assinatura;
    s.barraFunis.replaceChildren(...s.funis.map((f) => el('button', {
      class: 'fn-pilula', type: 'button', role: 'tab', 'aria-pressed': String(f.id === s.funilId), 'aria-selected': String(f.id === s.funilId),
      onclick: () => trocarFunil(f.id),
    }, el('span', { text: f.nome }), el('span', { class: 'fn-qtd', text: f.conversas != null ? String(f.conversas) : '' }))));
    if (gestao) s.barraFunis.append(el('button', { class: 'fn-pilula fn-novo', type: 'button', onclick: novoFunil }, el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Novo funil' })));
    s.botaoFunil.hidden = !gestao;
    const eu = s.ui.estado.eu || {};
    const unidades = (eu.unidades && eu.unidades.length ? eu.unidades : Object.keys(UNIDADE).filter((u) => u !== 'feira'));
    if (s.unidade && !unidades.includes(s.unidade)) s.unidade = '';
    s.unidades.hidden = unidades.length < 2;
    s.unidadeSel.hidden = unidades.length < 2;
    const ops = [['', 'Todas as unidades'], ...unidades.map((u) => [u, UNIDADE[u] || u])];
    s.unidades.replaceChildren(...ops.map(([v, n]) => el('button', {
      class: 'fn-pilula', type: 'button', 'aria-pressed': String(s.unidade === v), onclick: () => escolherUnidade(v),
    }, el('span', { text: v ? n : 'Todas' }))));
    s.unidadeSel.replaceChildren(...ops.map(([v, n]) => el('option', { value: v, text: n })));
    s.unidadeSel.value = s.unidade;
  }
  function escolherUnidade(v) {
    s.unidade = v; gravarLocal('sintonia.crm.unidade', v); s.assinaturaFunis = ''; desenharBarra(); s.carregados = {}; carregarQuadro();
  }

  function trocarFunil(id) {
    if (id === s.funilId) return;
    s.funilId = id; gravarLocal('sintonia.crm.funil', id);
    s.q = null; s.carregados = {}; s.colEls.clear(); s.cartaoEls.clear(); s.quadro.replaceChildren(); s.quadro.scrollLeft = 0;
    s.assinaturaFunis = ''; desenharBarra();
    carregarQuadro();
  }

  // ---------- quadro ----------
  function desenharQuadro() {
    const { el } = s.ui;
    if (!s.q) {
      s.quadro.replaceChildren(el('div', { class: 'fn-erro' }, el('span', { text: s.erro ? `Não deu para carregar o quadro: ${s.erro}` : 'Carregando…' }),
        s.erro ? el('button', { class: 'botao leve', type: 'button', text: 'Tentar de novo', onclick: () => carregarQuadro() }) : null));
      s.colEls.clear();
      return;
    }
    const gestao = ehGestao();
    const ordem = [];
    const vistas = new Set();
    for (const col of s.q.colunas) {
      const id = col.etapa.id;
      vistas.add(id);
      let c = s.colEls.get(id);
      if (!c) { c = criarColuna(id); s.colEls.set(id, c); }
      c.col = col;
      c.raiz.style.setProperty('--cor', col.etapa.cor || '#8B8D98');
      c.nome.textContent = col.etapa.nome;
      c.total.textContent = String(col.total);
      c.total.title = `${col.total} cliente${col.total === 1 ? '' : 's'} nesta etapa`;
      const autos = autosDaEtapa(id);
      c.raio.hidden = !gestao;
      c.raio.classList.toggle('fn-tem', autos.length > 0);
      c.raioQtd.textContent = autos.length ? String(autos.length) : '';
      const ligadas = autos.filter((a) => a.ligada).length;
      c.raio.title = autos.length ? `${autos.length} automação(ões) nesta etapa${ligadas ? `, ${ligadas} ligada(s)` : ', todas desligadas'}` : 'Criar automação: quando a cliente entrar nesta etapa';
      c.raio.setAttribute('aria-label', c.raio.title);
      c.menu.hidden = !gestao;
      // cartões: reaproveita os elementos que não mudaram (não pisca nem recarrega a foto)
      const nos = col.cartoes.map((cartao) => cartaoEl(cartao, id));
      const topo = c.lista.scrollTop;
      if (!nos.length) nos.push(el('div', { class: 'fn-vazio', text: s.busca.trim() ? 'Ninguém com essa busca aqui.' : 'Nenhuma cliente nesta etapa. Arraste um cartão para cá.' }));
      const atuais = [...c.lista.children];
      if (atuais.length !== nos.length || atuais.some((n, i) => n !== nos[i])) { c.lista.replaceChildren(...nos); c.lista.scrollTop = topo; }
      const faltam = col.total - col.cartoes.length;
      c.carregar.hidden = !col.mais;
      c.carregar.textContent = `Carregar mais${faltam > 0 ? ` (${faltam})` : ''}`;
      ordem.push(c.raiz);
    }
    for (const [id, c] of s.colEls) if (!vistas.has(id)) { c.raiz.remove(); s.colEls.delete(id); }
    if (gestao) {
      s.botaoNovaEtapa = s.botaoNovaEtapa || el('button', { class: 'fn-nova-etapa', type: 'button', onclick: novaEtapa }, el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Nova etapa' }));
      ordem.push(s.botaoNovaEtapa);
    }
    const atuais = [...s.quadro.children];
    if (atuais.length !== ordem.length || atuais.some((n, i) => n !== ordem[i])) {
      const esq = s.quadro.scrollLeft;
      s.quadro.replaceChildren(...ordem);
      s.quadro.scrollLeft = esq;
    }
    // limpa elementos de cartões que saíram do quadro
    const ids = new Set(s.q.colunas.flatMap((c) => c.cartoes.map((x) => x.conversaId)));
    for (const k of s.cartaoEls.keys()) if (!ids.has(k)) s.cartaoEls.delete(k);
  }

  function criarColuna(id) {
    const { el } = s.ui;
    const c = {};
    c.nome = el('h2');
    c.total = el('span', { class: 'fn-total' });
    c.raioQtd = el('b');
    c.raio = el('button', { class: 'fn-raio', type: 'button', onclick: (e) => { e.stopPropagation(); abrirRaio(c.col); } }, el('span', { html: SVG.raio, style: 'display:grid' }), c.raioQtd);
    c.menu = el('button', { class: 'fn-redondo', type: 'button', title: 'Opções da etapa', 'aria-label': 'Opções da etapa', html: SVG.pontos, onclick: () => menuEtapa(c.col) });
    c.lista = el('div', { class: 'fn-lista' });
    c.carregar = el('button', { class: 'fn-carregar', type: 'button', hidden: '', onclick: () => carregarMais(c.col) });
    c.raiz = el('section', { class: 'fn-col', 'data-etapa': id, 'aria-label': 'Etapa' },
      el('div', { class: 'fn-cab' }, el('span', { class: 'fn-ponto' }), c.nome, c.total, c.raio, c.menu), c.lista, c.carregar);
    return c;
  }

  function cartaoEl(cartao, etapaId) {
    const assinatura = JSON.stringify([cartao, etapaId, Math.floor(Date.now() / 60000)]);
    const cache = s.cartaoEls.get(cartao.conversaId);
    if (cache && cache.assinatura === assinatura) return cache.no;
    const { el, UNIDADE, avatar, nomeDe } = s.ui;
    const nome = cartao.nome || nomeDe({ telefone: cartao.telefone });
    const u = cartao.ultima;
    const previa = el('div', { class: 'fn-previa' });
    if (u) {
      const quem = u.autor === 'cliente' ? '' : u.autor === 'ia' ? (u.autorNome && /^Automação/.test(u.autorNome) ? '⚡ ' : 'IA: ') : `${primeiroNome(u.autorNome) || 'Equipe'}: `;
      if (quem) previa.append(el('i', { text: quem }));
      previa.append(document.createTextNode(u.texto || '(mídia)'));
    } else previa.textContent = 'Sem mensagens ainda';
    const linha2 = [UNIDADE[cartao.unidade] || cartao.unidade, cartao.dona ? primeiroNome(cartao.dona.nome) : 'sem dona'].filter(Boolean).join(' · ');
    const desdeMin = cartao.desde ? (Date.now() - new Date(cartao.desde).getTime()) / 60000 : 0;
    const desde = cartao.desde ? el('span', { class: 'fn-desde' + (desdeMin > 3 * 1440 ? ' fn-velho' : ''), title: `Nesta etapa desde ${s.ui.quando(cartao.desde)}` }, el('span', { html: SVG.relogio, style: 'display:grid' }), el('span', { text: ha(cartao.desde) })) : null;
    const mais = el('button', { class: 'fn-mais', type: 'button', title: 'Mover para…', 'aria-label': `Mover ${nome} para…`, html: SVG.pontos, onclick: (e) => { e.stopPropagation(); menuCartao(cartao.conversaId); } });
    const no = el('div', { class: 'fn-cartao', role: 'button', tabindex: '0', 'data-id': cartao.conversaId, 'aria-label': `${nome}. Abrir conversa` },
      el('div', { class: 'fn-c1' }, avatar({ id: cartao.conversaId }, 'p'), el('div', { class: 'fn-quem' }, el('div', { class: 'fn-n' }, el('b', { text: nome }), desde), el('span', { text: linha2 })), mais),
      previa,
      cartao.tags && cartao.tags.length ? el('div', { class: 'fn-c3' }, ...cartao.tags.slice(0, 4).map((t) => el('span', { class: 'fn-tag', style: `--cor:${t.cor}`, text: t.nome }))) : null);
    // a foto é a mesma: reaproveita a do cartão anterior para não recarregar
    if (cache) { const velho = cache.no.querySelector('.avatar'); const novo = no.querySelector('.avatar'); if (velho && novo) novo.replaceWith(velho); }
    no.addEventListener('click', () => { if (s.semClique) return; s.ui.abrir(cartao.conversaId); });
    no.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.ui.abrir(cartao.conversaId); }
      if (e.key === 'm' || e.key === 'M' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); menuCartao(cartao.conversaId); }
    });
    no.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!s.arrasto && !s.aperto) menuCartao(cartao.conversaId); });
    no.addEventListener('pointerdown', (e) => apertar(e, no, cartao.conversaId));
    no.addEventListener('touchmove', (e) => { if (s.arrasto) e.preventDefault(); }, { passive: false });
    s.cartaoEls.set(cartao.conversaId, { assinatura, no });
    return no;
  }

  const acharCartao = (id) => {
    for (const col of s.q?.colunas || []) { const c = col.cartoes.find((x) => x.conversaId === id); if (c) return { col, cartao: c }; }
    return null;
  };

  // ---------- arrastar e soltar (pointer events: mouse arrasta direto; toque segura ~0,35 s) ----------
  function apertar(e, no, id) {
    if (s.arrasto || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.fn-mais')) return;
    const a = { id, no, pid: e.pointerId, tipo: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer: null };
    s.aperto = a;
    if (a.tipo !== 'mouse') {
      no.classList.add('fn-segurando');
      a.timer = setTimeout(() => { if (s.aperto === a) { if (navigator.vibrate) try { navigator.vibrate(12); } catch {} iniciarArrasto(a); } }, 350);
    }
    addEventListener('pointermove', aoMover, { passive: false });
    addEventListener('pointerup', aoSoltar);
    addEventListener('pointercancel', aoCancelar);
  }
  function limparAperto() {
    if (s.aperto) { clearTimeout(s.aperto.timer); s.aperto.no.classList.remove('fn-segurando'); }
    s.aperto = null;
    removeEventListener('pointermove', aoMover);
    removeEventListener('pointerup', aoSoltar);
    removeEventListener('pointercancel', aoCancelar);
  }
  function aoMover(e) {
    const a = s.aperto;
    if (!a || e.pointerId !== a.pid) return;
    a.x = e.clientX; a.y = e.clientY;
    if (!s.arrasto) {
      const d = Math.hypot(a.x - a.x0, a.y - a.y0);
      if (d > 6) {
        if (a.tipo === 'mouse') iniciarArrasto(a);
        else limparAperto(); // mexeu o dedo antes de segurar: é rolagem
      }
      return;
    }
    e.preventDefault();
    s.arrasto.moveu = s.arrasto.moveu || Math.hypot(a.x - a.x0, a.y - a.y0) > 8;
    posicionarFantasma();
    marcarAlvo();
  }
  function iniciarArrasto(a) {
    const achado = acharCartao(a.id); if (!achado) { limparAperto(); return; }
    a.no.classList.remove('fn-segurando');
    const r = a.no.getBoundingClientRect();
    const fantasma = a.no.cloneNode(true);
    fantasma.classList.add('fn-fantasma');
    fantasma.removeAttribute('tabindex');
    fantasma.style.width = r.width + 'px';
    const col = a.no.closest('.fn-col');
    if (col) fantasma.style.setProperty('--cor', getComputedStyle(col).getPropertyValue('--cor'));
    document.body.append(fantasma);
    a.no.classList.add('fn-saindo');
    s.arrasto = { ...a, de: achado.col.etapa.id, fantasma, dx: a.x0 - r.left, dy: a.y0 - r.top, alvo: null, moveu: false, raf: 0 };
    document.documentElement.classList.add('fn-arrastando');
    try { a.no.setPointerCapture?.(a.pid); } catch { /* sem captura */ }
    posicionarFantasma(); marcarAlvo();
    const rolar = () => { if (!s.arrasto) return; autoRolar(); s.arrasto.raf = requestAnimationFrame(rolar); };
    s.arrasto.raf = requestAnimationFrame(rolar);
  }
  function posicionarFantasma() {
    const d = s.arrasto; if (!d) return;
    d.fantasma.style.left = (s.aperto.x - d.dx) + 'px';
    d.fantasma.style.top = (s.aperto.y - d.dy) + 'px';
  }
  function marcarAlvo() {
    const d = s.arrasto; if (!d) return;
    const sob = document.elementFromPoint(s.aperto.x, s.aperto.y);
    const col = sob && sob.closest ? sob.closest('.fn-col[data-etapa]') : null;
    const id = col ? col.dataset.etapa : null;
    if (id === d.alvo) return;
    if (d.alvo) s.colEls.get(d.alvo)?.raiz.classList.remove('fn-alvo');
    d.alvo = id;
    if (id && id !== d.de) col.classList.add('fn-alvo');
  }
  function autoRolar() {
    const d = s.arrasto, a = s.aperto; if (!d || !a) return;
    const r = s.quadro.getBoundingClientRect();
    const borda = Math.min(70, r.width / 6);
    if (a.x < r.left + borda) s.quadro.scrollLeft -= Math.ceil((r.left + borda - a.x) / 4);
    else if (a.x > r.right - borda) s.quadro.scrollLeft += Math.ceil((a.x - (r.right - borda)) / 4);
    const c = d.alvo && s.colEls.get(d.alvo);
    if (c) {
      const rl = c.lista.getBoundingClientRect();
      if (a.y < rl.top + 40) c.lista.scrollTop -= Math.ceil((rl.top + 40 - a.y) / 4);
      else if (a.y > rl.bottom - 40) c.lista.scrollTop += Math.ceil((a.y - (rl.bottom - 40)) / 4);
    }
    marcarAlvo();
  }
  function terminarArrasto() {
    const d = s.arrasto; if (!d) return null;
    cancelAnimationFrame(d.raf);
    d.fantasma.remove();
    d.no.classList.remove('fn-saindo');
    if (d.alvo) s.colEls.get(d.alvo)?.raiz.classList.remove('fn-alvo');
    document.documentElement.classList.remove('fn-arrastando');
    s.arrasto = null;
    // o clique que vem depois de soltar não abre a conversa
    s.semClique = true; setTimeout(() => { s.semClique = false; }, 80);
    return d;
  }
  function aoSoltar(e) {
    const a = s.aperto;
    if (!a || e.pointerId !== a.pid) return;
    const d = terminarArrasto();
    limparAperto();
    if (!d) return;
    if (!d.moveu && d.tipo !== 'mouse') { menuCartao(d.id); return; } // segurou e soltou sem mexer: abre o "Mover para…"
    if (d.alvo && d.alvo !== d.de) mover(d.id, d.alvo);
  }
  function aoCancelar(e) {
    if (s.aperto && e.pointerId !== s.aperto.pid) return;
    terminarArrasto();
    limparAperto();
  }

  // ---------- mover (otimista, com volta se der erro) ----------
  async function mover(conversaId, paraId) {
    const achado = acharCartao(conversaId); if (!achado) return;
    const { col: de, cartao } = achado;
    if (de.etapa.id === paraId) return;
    const para = paraId ? s.q.colunas.find((c) => c.etapa.id === paraId) : null;
    if (paraId && !para) return;
    const antes = JSON.parse(JSON.stringify(s.q));
    s.geracao++; // respostas do quadro que ainda estão a caminho ficam velhas
    de.cartoes = de.cartoes.filter((c) => c.conversaId !== conversaId); de.total = Math.max(0, de.total - 1);
    if (para) { para.cartoes = [{ ...cartao, desde: new Date().toISOString() }, ...para.cartoes]; para.total += 1; }
    desenharQuadro();
    const novo = para && s.cartaoEls.get(conversaId)?.no;
    if (novo) { novo.classList.remove('fn-novo-aqui'); void novo.offsetWidth; novo.classList.add('fn-novo-aqui'); }
    const f = funil();
    try {
      await s.ui.post(`/api/conversas/${conversaId}/funis/${s.funilId}`, { etapaId: paraId || null });
      s.ui.toast(para ? `${cartao.nome || 'Cliente'} foi para “${para.etapa.nome}” ✓` : `${cartao.nome || 'Cliente'} saiu do funil ${f ? f.nome : ''}`);
      s.funisEm = 0;
      carregarFunis(true).then(() => desenharBarra()).catch(() => {});
      carregarQuadro();
    } catch (x) {
      s.q = antes; s.geracao++;
      desenharQuadro();
      s.ui.toast(`Não deu para mover: ${x.message}`);
    }
  }

  // ---------- folhas (menus que sobem de baixo no celular) e diálogos ----------
  function folha(titulo, sub, grupos) {
    const { el } = s.ui;
    const d = el('dialog', { class: 'folha fn-folha' });
    const fechar = () => d.close();
    d.append(el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: titulo }),
      el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })));
    if (sub) d.append(el('p', { class: 'fn-sub', text: sub }));
    for (const itens of grupos) {
      if (!itens.length) continue;
      d.append(el('div', { class: 'folha-lista' }, ...itens.map((it) => {
        const b = el('button', { type: 'button', class: it.perigo ? 'fn-perigo' : '', 'aria-pressed': it.atual ? 'true' : null, 'aria-disabled': it.desligado ? 'true' : null,
          onclick: () => { if (it.desligado) return; fechar(); it.acao(); } });
        if (it.cor) b.append(el('i', { class: 'fn-ponto-g', style: `--cor:${it.cor}` }));
        else if (it.icone) b.append(el('span', { html: it.icone, style: 'display:grid;flex:none' }).firstChild);
        b.append(el('span', {}, el('b', { text: it.nome }), it.info ? el('small', { text: it.info }) : null));
        if (it.atual !== undefined) b.append(el('i', { class: 'marca-ok' }));
        return b;
      })));
    }
    d.addEventListener('close', () => { d.remove(); s.abertos--; });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    s.abertos++;
    d.showModal();
    return d;
  }

  /** Pergunta com campos: [{ nome, rotulo, valor, tipo: 'texto' | 'cor' | 'escolha', opcoes: [[v, rótulo]] }]. Devolve os valores ou null. */
  function pedir({ titulo, aviso, campos = [], ok = 'Salvar', perigo = false }) {
    const { el } = s.ui;
    return new Promise((resolver) => {
      const d = el('dialog', { class: 'fn-dlg' });
      const form = el('form', { method: 'dialog' });
      const valores = {};
      form.append(el('h2', { text: titulo }));
      if (aviso) form.append(el('p', { class: 'fn-aviso', text: aviso }));
      for (const c of campos) {
        valores[c.nome] = c.valor ?? '';
        if (c.tipo === 'cor') {
          const caixa = el('div', { class: 'cores', role: 'radiogroup', 'aria-label': c.rotulo });
          const desenharCores = () => caixa.replaceChildren(...s.cores.map((k) => el('button', { type: 'button', class: 'cor', style: `--cor:${k.hex}`, title: k.nome, 'aria-label': k.nome, 'aria-pressed': String(String(valores[c.nome]).toUpperCase() === k.hex.toUpperCase()),
            onclick: () => { valores[c.nome] = k.hex; desenharCores(); } })));
          desenharCores();
          form.append(el('div', { style: 'display:grid;gap:6px' }, el('span', { class: 'info', text: c.rotulo }), caixa));
        } else if (c.tipo === 'escolha') {
          const sel = el('select', { name: c.nome }, ...c.opcoes.map(([v, n]) => el('option', { value: v, text: n })));
          sel.value = valores[c.nome] || c.opcoes[0]?.[0] || ''; valores[c.nome] = sel.value;
          sel.addEventListener('change', () => { valores[c.nome] = sel.value; });
          form.append(el('label', {}, el('span', { text: c.rotulo }), sel));
        } else {
          const inp = el('input', { name: c.nome, value: valores[c.nome], maxlength: String(c.max || 40), required: '', autocomplete: 'off', placeholder: c.dica || '' });
          inp.addEventListener('input', () => { valores[c.nome] = inp.value; });
          form.append(el('label', {}, el('span', { text: c.rotulo }), inp));
        }
      }
      const erro = el('div', { class: 'erro-txt' });
      form.append(erro, el('div', { class: 'rodape' },
        el('button', { class: 'botao leve', value: 'cancelar', formnovalidate: '', text: 'Cancelar' }),
        el('button', { class: 'botao' + (perigo ? ' fn-perigo' : ''), value: 'ok', text: ok })));
      let resposta = null;
      form.addEventListener('submit', (e) => {
        if (e.submitter?.value !== 'ok') return;
        for (const c of campos) if (c.tipo === 'texto' && !String(valores[c.nome]).trim()) { e.preventDefault(); erro.textContent = `Preencha: ${c.rotulo}.`; return; }
        resposta = { ...valores };
      });
      d.append(form);
      d.addEventListener('close', () => { d.remove(); s.abertos--; resolver(resposta); });
      document.body.append(d);
      s.abertos++;
      d.showModal();
      d.querySelector('input')?.focus();
    });
  }
  async function cores() {
    if (!s.cores.length) { try { s.cores = await s.ui.api('/api/tags/cores'); } catch { s.cores = []; } }
    return s.cores;
  }
  const corLivre = () => {
    const usadas = new Set((s.q?.colunas || []).map((c) => String(c.etapa.cor).toUpperCase()));
    return (s.cores.find((k) => !usadas.has(k.hex.toUpperCase())) || s.cores[0] || { hex: '#0090FF' }).hex;
  };
  async function tentar(fn, ok) {
    try { const r = await fn(); if (ok) s.ui.toast(ok); return r ?? true; } catch (x) { s.ui.toast(x.message); return null; }
  }
  async function recarregarTudo() {
    s.funisEm = 0; s.assinaturaFunis = '';
    await carregarFunis(true).catch(() => {});
    desenharBarra();
    await carregarQuadro();
  }

  // ---------- menus ----------
  function menuCartao(conversaId) {
    const achado = acharCartao(conversaId); if (!achado) return;
    const { col, cartao } = achado;
    const f = funil();
    const etapas = s.q.colunas.map((c) => ({
      nome: c.etapa.nome, cor: c.etapa.cor, atual: c.etapa.id === col.etapa.id, info: c.etapa.id === col.etapa.id ? 'Está aqui agora' : `${c.total} cliente${c.total === 1 ? '' : 's'}`,
      acao: () => { if (c.etapa.id !== col.etapa.id) mover(conversaId, c.etapa.id); },
    }));
    const outros = [{ nome: 'Abrir conversa', icone: SVG.conversa, acao: () => s.ui.abrir(conversaId) }];
    if (f && !f.sistema) outros.push({ nome: `Tirar do funil ${f.nome}`, info: 'A cliente continua nas Conversas', icone: SVG.sair, perigo: true, acao: () => mover(conversaId, null) });
    folha('Mover para…', cartao.nome || s.ui.formatarTel(cartao.telefone), [etapas, outros]);
  }

  function menuFunil() {
    const f = funil(); if (!f) return;
    folha(f.nome, f.sistema ? 'Funil do sistema: a IA move as clientes sozinha. Dá para renomear e recolorir as etapas.' : null, [[
      { nome: 'Renomear funil', icone: SVG.lapis, acao: renomearFunil },
      { nome: 'Nova etapa', icone: SVG.mais, acao: novaEtapa },
      { nome: 'Automações deste funil', icone: SVG.raio, acao: () => { if (window.SintoniaTelas.automacoes) s.ui.mostrar('automacoes'); } },
    ], f.sistema ? [] : [
      { nome: 'Apagar funil', info: 'As conversas continuam; somem as etapas e as automações dele', icone: SVG.lixo, perigo: true, acao: apagarFunil },
    ]]);
  }

  function menuEtapa(col) {
    if (!col) return;
    const i = s.q.colunas.indexOf(col);
    const n = s.q.colunas.length;
    folha(col.etapa.nome, `${col.total} cliente${col.total === 1 ? '' : 's'} nesta etapa`, [[
      { nome: 'Renomear e mudar a cor', icone: SVG.lapis, acao: () => editarEtapa(col) },
      { nome: 'Automações desta etapa', icone: SVG.raio, acao: () => abrirRaio(col) },
      { nome: 'Mover para a esquerda', icone: SVG.esquerda, desligado: i <= 0, acao: () => reordenar(col, -1) },
      { nome: 'Mover para a direita', icone: SVG.direita, desligado: i >= n - 1, acao: () => reordenar(col, 1) },
    ], col.etapa.chaveSistema ? [] : [
      { nome: 'Apagar etapa', icone: SVG.lixo, perigo: true, acao: () => apagarEtapa(col) },
    ]]);
  }

  function abrirRaio(col) {
    if (!col) return;
    const A = window.SintoniaTelas.automacoes;
    if (!A) { s.ui.toast('As automações ainda estão carregando.'); return; }
    const aoMudar = async () => { await carregarAutos(true); desenharQuadro(); };
    const f = funil();
    const autos = autosDaEtapa(col.etapa.id);
    if (!autos.length) A.abrirEditor({ funilId: f && !f.sistema ? f.id : null, gatilho: { tipo: 'entrou_na_etapa', etapaId: col.etapa.id }, nome: `Ao entrar em ${col.etapa.nome}`, aoSalvar: aoMudar });
    else A.abrirDaEtapa({ funilId: f && !f.sistema ? f.id : null, etapaId: col.etapa.id, etapaNome: col.etapa.nome, aoMudar });
  }

  // ---------- gestão de funis e etapas ----------
  async function novoFunil() {
    const r = await pedir({ titulo: 'Novo funil', aviso: 'Ex.: Comercial, Pós-venda, Retorno. Ele começa com as etapas Lead, Em negociação e Fechado; dá para mudar depois.', campos: [{ nome: 'nome', rotulo: 'Nome do funil', max: 40, dica: 'Comercial' }], ok: 'Criar' });
    if (!r) return;
    await cores();
    const f = await tentar(() => s.ui.post('/api/funis', { nome: r.nome.trim(), etapas: [{ nome: 'Lead', cor: '#0090FF' }, { nome: 'Em negociação', cor: '#F76B15' }, { nome: 'Fechado', cor: '#30A46C' }] }), 'Funil criado ✓');
    if (!f || !f.id) return;
    await carregarFunis(true).catch(() => {});
    s.funilId = null; trocarFunil(f.id);
  }
  async function renomearFunil() {
    const f = funil(); if (!f) return;
    const r = await pedir({ titulo: 'Renomear funil', campos: [{ nome: 'nome', rotulo: 'Nome', valor: f.nome, max: 40 }] });
    if (!r || r.nome.trim() === f.nome) return;
    if (await tentar(() => s.ui.api(`/api/funis/${f.id}`, { method: 'PATCH', body: JSON.stringify({ nome: r.nome.trim() }) }), 'Funil renomeado ✓')) recarregarTudo();
  }
  async function apagarFunil() {
    const f = funil(); if (!f || f.sistema) return;
    const r = await pedir({ titulo: `Apagar o funil “${f.nome}”?`, aviso: 'As etapas, as marcações das clientes neste funil e as automações dele somem. As conversas continuam normalmente.', ok: 'Apagar', perigo: true });
    if (!r) return;
    if (await tentar(() => s.ui.api(`/api/funis/${f.id}`, { method: 'DELETE' }), 'Funil apagado')) { s.funilId = null; s.q = null; s.colEls.clear(); s.quadro.replaceChildren(); recarregarTudo(); }
  }
  async function novaEtapa() {
    const f = funil(); if (!f) return;
    await cores();
    const r = await pedir({ titulo: `Nova etapa em ${f.nome}`, campos: [{ nome: 'nome', rotulo: 'Nome da etapa', max: 30, dica: 'Ex.: Proposta enviada' }, { nome: 'cor', rotulo: 'Cor', tipo: 'cor', valor: corLivre() }], ok: 'Criar' });
    if (!r) return;
    if (await tentar(() => s.ui.post(`/api/funis/${f.id}/etapas`, { nome: r.nome.trim(), cor: r.cor || undefined }), 'Etapa criada ✓')) {
      await recarregarTudo();
      requestAnimationFrame(() => { s.quadro.scrollLeft = s.quadro.scrollWidth; });
    }
  }
  async function editarEtapa(col) {
    await cores();
    const r = await pedir({ titulo: 'Etapa', campos: [{ nome: 'nome', rotulo: 'Nome', valor: col.etapa.nome, max: 30 }, { nome: 'cor', rotulo: 'Cor', tipo: 'cor', valor: col.etapa.cor }] });
    if (!r) return;
    const corpo = {};
    if (r.nome.trim() !== col.etapa.nome) corpo.nome = r.nome.trim();
    if (r.cor && r.cor !== col.etapa.cor) corpo.cor = r.cor;
    if (!Object.keys(corpo).length) return;
    if (await tentar(() => s.ui.api(`/api/funis/${s.funilId}/etapas/${col.etapa.id}`, { method: 'PATCH', body: JSON.stringify(corpo) }), 'Etapa salva ✓')) recarregarTudo();
  }
  async function reordenar(col, passo) {
    const ids = s.q.colunas.map((c) => c.etapa.id);
    const i = ids.indexOf(col.etapa.id), j = i + passo;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const antes = s.q.colunas.slice();
    s.q.colunas = ids.map((id) => antes.find((c) => c.etapa.id === id));
    s.geracao++;
    desenharQuadro();
    if (!(await tentar(() => s.ui.post(`/api/funis/${s.funilId}/etapas/ordem`, { ids })))) { s.q.colunas = antes; desenharQuadro(); }
    carregarQuadro();
  }
  async function apagarEtapa(col, quantas) {
    const outras = s.q.colunas.filter((c) => c !== col);
    const n = quantas ?? col.total;
    let moverPara;
    if (n > 0) {
      if (!outras.length) { s.ui.toast('Crie outra etapa antes, para as clientes irem para lá.'); return; }
      const r = await pedir({ titulo: `Apagar “${col.etapa.nome}”?`, aviso: `Há ${n} cliente${n === 1 ? '' : 's'} nesta etapa. Para onde ela${n === 1 ? ' vai' : 's vão'}?`,
        campos: [{ nome: 'para', rotulo: 'Mover para', tipo: 'escolha', opcoes: outras.map((c) => [c.etapa.id, c.etapa.nome]) }], ok: 'Mover e apagar', perigo: true });
      if (!r) return;
      moverPara = r.para;
    } else {
      const r = await pedir({ titulo: `Apagar “${col.etapa.nome}”?`, aviso: 'A etapa está vazia. As automações que usam esta etapa podem parar de funcionar.', ok: 'Apagar', perigo: true });
      if (!r) return;
    }
    try {
      const res = await s.ui.api(`/api/funis/${s.funilId}/etapas/${col.etapa.id}${moverPara ? `?moverPara=${encodeURIComponent(moverPara)}` : ''}`, { method: 'DELETE' });
      s.ui.toast(res.movidas ? `Etapa apagada; ${res.movidas} cliente(s) mudaram de etapa` : 'Etapa apagada');
      recarregarTudo();
    } catch (x) {
      // há conversas que esta pessoa não vê: o servidor conta todas
      if (x.status === 409 && !moverPara && /conversa/.test(x.message)) { const m = /(\d+)/.exec(x.message); return apagarEtapa(col, m ? Number(m[1]) : 1); }
      s.ui.toast(x.message);
    }
  }

  // ---------- entrada ----------
  async function desenhar(caixa, ui) {
    s.ui = ui;
    estilo();
    if (s.caixa !== caixa || !s.montado || !caixa.contains(s.quadro)) { s.caixa = caixa; montar(); s.assinaturaFunis = ''; }
    if (caixa.hidden || s.arrasto || s.aperto || s.abertos > 0) return; // não mexe no quadro com a pessoa no meio de algo
    if (document.visibilityState === 'hidden') return;
    try { await carregarFunis(false); } catch (x) { s.erro = x.message; if (!s.funis.length) { desenharQuadro(); return; } }
    if (!s.cores.length && ehGestao()) cores();
    await carregarAutos(false);
    desenharBarra();
    if (!s.q && !s.buscando) desenharQuadro();
    await carregarQuadro();
  }

  window.SintoniaTelas.funil = { desenhar, recarregar: () => s.ui && recarregarTudo() };
})();
