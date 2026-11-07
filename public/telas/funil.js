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
    caixa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13h4l1.5 2.5h5L16 13h4"/><path d="M5.5 5h13L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5Z"/></svg>',
    calendario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4M9.5 15l2 2 3.5-3.5"/></svg>',
    tendencia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m4 16 5-5 4 4 7-7"/><path d="M15 8h5v5"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9 2.5h6"/></svg>',
    pessoa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="9" r="3.5"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    filtro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 16l4-4-4-4M19 12H9"/></svg>',
  };

  const CSS = `
  /* ---------- cabeçalho da vista (título, números, Quadro | Ligar hoje) ---------- */
  #v-funil .cabeca-vista.fn-cabeca { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 22px; padding: 16px 20px 6px; background: transparent; border-bottom: 0; -webkit-backdrop-filter: none; backdrop-filter: none; }
  #v-funil .fn-cabeca h1.titulo-grande { margin: 0; font-size: 38px; font-weight: 800; letter-spacing: -.03em; line-height: 1; flex: none; }
  .fn-numeros { display: flex; align-items: center; gap: 22px; flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 4px 2px; }
  .fn-numeros::-webkit-scrollbar { display: none; }
  .fn-numeros:empty { display: none; }
  .fn-num { display: flex; align-items: center; gap: 10px; flex: none; }
  .fn-num-ic { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda), inset 0 1px 0 rgba(255,255,255,.12); }
  .fn-num-ic svg { width: 19px; height: 19px; }
  .fn-num div { display: grid; line-height: 1.15; }
  .fn-num b { font-size: 22px; font-weight: 800; letter-spacing: -.02em; color: var(--texto); display: flex; align-items: center; gap: 7px; }
  .fn-num small { font-size: 12px; color: var(--sub); white-space: nowrap; }
  .fn-num .fn-selo { font-size: 11px; font-weight: 800; padding: 2px 7px; border-radius: 999px; letter-spacing: 0; }
  .fn-selo.bom { color: #106ebe; background: color-mix(in srgb, var(--marca-menta) 28%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-menta) 55%, transparent); }
  html[data-tema="escuro"] .fn-selo.bom { color: #fff; background: color-mix(in srgb, var(--marca-menta) 22%, transparent); }
  .fn-selo.ruim { color: #8a5a00; background: rgba(245,184,0,.18); box-shadow: inset 0 0 0 1px rgba(245,184,0,.5); }
  html[data-tema="escuro"] .fn-selo.ruim { color: #ffd34d; }
  .fn-num.alerta .fn-num-ic { color: #c98f00; box-shadow: inset 0 0 0 1px rgba(245,184,0,.5), 0 0 14px rgba(245,184,0,.25); }
  html[data-tema="escuro"] .fn-num.alerta .fn-num-ic { color: #ffd34d; }
  /* trilho Quadro | Ligar hoje (o mesmo desenho do seletor de funil) */
  #funil-abas, .fn-trilho { display: inline-flex; align-items: center; gap: 2px; padding: 4px; margin: 0; border-radius: 999px; overflow-x: auto; scrollbar-width: none; flex: none; max-width: 100%;
    background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(1.4); backdrop-filter: blur(18px) saturate(1.4); }
  #funil-abas::-webkit-scrollbar, .fn-trilho::-webkit-scrollbar { display: none; }
  #funil-abas { margin-left: auto; }
  #funil-abas .chip, .fn-trilho .fn-pilula { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 15px; border-radius: 999px; white-space: nowrap;
    font-size: 14px; font-weight: 650; color: var(--sub); background: transparent; box-shadow: none; transition: background .18s ease, color .18s ease, box-shadow .18s ease; }
  #funil-abas .chip:hover, .fn-trilho .fn-pilula:hover { color: var(--texto); }
  #funil-abas .chip[aria-pressed="true"], .fn-trilho .fn-pilula[aria-pressed="true"] { color: var(--texto); font-weight: 750; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 4px 14px rgba(16, 110, 190,.12); }
  html[data-tema="escuro"] #funil-abas .chip[aria-pressed="true"], html[data-tema="escuro"] .fn-trilho .fn-pilula[aria-pressed="true"] { background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,.4), 0 6px 18px rgba(0,0,0,.3); }
  #funil-abas .chip .qtd { min-width: 18px; height: 18px; padding: 0 6px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; background: var(--marca-menta); color: #071d33; }
  #funil-abas .chip .qtd:empty { display: none; }

  #funil.fn-caixa { display: flex; flex-direction: column; padding: 0; gap: 0; overflow: hidden; align-items: stretch; }
  .fn-topo { display: flex; align-items: center; gap: 10px; padding: 6px 20px 12px; flex: none; min-width: 0; }
  .fn-topo .fn-busca { flex: 0 1 300px; }
  .fn-topo .fn-funis { margin-left: auto; }
  .fn-filtros-bt { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 42px; padding: 0 15px; border-radius: 999px; font-size: 14px; font-weight: 650; color: var(--texto);
    background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); }
  .fn-filtros-bt svg { width: 18px; height: 18px; }
  .fn-filtros-bt b { min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; background: var(--marca-azul); color: #fff; }
  .fn-filtros-bt b:empty { display: none; }
  .fn-filtros-bt:hover { background: var(--vidro-ativo); }
  .fn-filtros-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  #rs-filtros-crm { display: none !important; }
  #v-funil .fn-numeros { display: none !important; }
  dialog.fn-filtros .fn-fil-corpo { display: grid; gap: 14px; padding: 4px 18px 6px; }
  dialog.fn-filtros .fn-fil-rodape { display: flex; gap: 10px; justify-content: flex-end; padding: 14px 18px calc(16px + env(safe-area-inset-bottom)); }
  .fn-barra { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 8px 20px 12px; flex: none; }
  .fn-linha { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .fn-linha.fn-l1 { flex: 1 1 420px; }
  .fn-linha.fn-l2 { flex: 0 1 auto; margin-left: auto; }
  .fn-funis { flex: 0 1 auto; min-width: 0; }
  .fn-pilula .fn-qtd { font-size: 12px; font-weight: 700; color: var(--sub); opacity: .85; }
  .fn-pilula.fn-novo { color: var(--marca-azul); }
  html[data-tema="escuro"] .fn-pilula.fn-novo { color: var(--marca-menta); }
  .fn-pilula svg { width: 16px; height: 16px; }
  .fn-redondo { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); transition: background .15s ease, transform .15s ease; }
  .fn-redondo svg { width: 19px; height: 19px; }
  .fn-redondo:hover { background: var(--vidro-ativo); transform: translateY(-1px); }
  .fn-busca { flex: 0 1 280px; min-width: 160px; display: flex; align-items: center; gap: 9px; height: 42px; padding: 0 16px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); color: var(--sub);
    -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  .fn-busca:focus-within { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-azul) 60%, var(--vidro-borda)), var(--vidro-brilho); }
  html[data-tema="escuro"] .fn-busca:focus-within { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-menta) 50%, transparent), var(--vidro-brilho); }
  .fn-busca svg { width: 17px; height: 17px; flex: none; }
  .fn-busca input { all: unset; flex: 1; min-width: 0; font-size: 15px; color: var(--texto); }
  .fn-busca input::placeholder { color: var(--sub); }
  .fn-pessoas { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; min-width: 0; flex: 1 1 auto; padding: 2px; }
  .fn-pessoas::-webkit-scrollbar { display: none; }
  .fn-pessoas:empty { display: none; }
  .fn-pessoa { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 13px 0 5px; border-radius: 999px; font-size: 13.5px; font-weight: 700; color: var(--sub);
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; transition: background .15s ease, color .15s ease; }
  .fn-pessoa.fn-todas { padding: 0 14px; }
  .fn-pessoa:hover { color: var(--texto); }
  .fn-pessoa[aria-pressed="true"] { color: var(--texto); background: var(--vidro-ativo); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-azul) 55%, var(--vidro-borda)); }
  html[data-tema="escuro"] .fn-pessoa[aria-pressed="true"] { background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.5); }
  .fn-ini { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 10.5px; font-weight: 800; letter-spacing: .02em; color: #106ebe; background: var(--ini, #e8eef5);
    box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.75), 0 2px 6px rgba(0,0,0,.18); }
  .fn-ini.fn-sem { background: transparent; color: inherit; box-shadow: inset 0 0 0 1.5px currentColor; opacity: .7; }
  .fn-ini svg { width: 15px; height: 15px; }
  .fn-unidade-sel { display: none; flex: none; height: 42px; border-radius: 999px; padding: 0 14px; font: inherit; font-size: 14px; font-weight: 650; color: var(--texto);
    background: var(--vidro-item); border: 0; box-shadow: inset 0 0 0 1px var(--vidro-borda); max-width: 46%; }

  /* ---------- quadro ---------- */
  .fn-quadro { flex: 1; min-height: 0; display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden; padding: 4px 20px 18px; align-items: stretch; overscroll-behavior-x: contain; }
  .fn-col { width: 300px; flex: none; display: flex; flex-direction: column; min-height: 0; max-height: 100%; border-radius: 24px; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho);
    -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); transition: box-shadow .15s ease, transform .15s ease; position: relative; }
  .fn-col.fn-alvo { box-shadow: inset 0 0 0 2px var(--cor), 0 0 0 4px color-mix(in srgb, var(--cor) 22%, transparent), var(--vidro-brilho); }
  .fn-cab { display: flex; align-items: center; gap: 6px; padding: 14px 10px 10px 16px; flex: none; }
  .fn-cab .fn-ponto { width: 12px; height: 12px; border-radius: 50%; background: var(--cor); flex: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--cor) 25%, transparent), 0 0 10px color-mix(in srgb, var(--cor) 60%, transparent); margin-right: 3px; }
  .fn-cab-txt { flex: 1; min-width: 0; display: grid; line-height: 1.2; }
  .fn-cab-l1 { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .fn-cab h2 { margin: 0; font-size: 15.5px; font-weight: 750; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--texto); }
  .fn-cab .fn-total { flex: none; min-width: 22px; height: 20px; box-sizing: border-box; display: inline-grid; place-items: center; font-size: 11.5px; font-weight: 800; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); border-radius: 999px; padding: 0 7px; }
  .fn-cab-sub { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fn-cab-sub:empty { display: none; }
  .fn-cab-sub.fn-alerta { color: #8a5a00; font-weight: 650; }
  html[data-tema="escuro"] .fn-cab-sub.fn-alerta { color: #ffd34d; }
  .fn-cab .fn-redondo { width: 32px; height: 32px; color: var(--sub); }
  .fn-cab .fn-redondo:hover { color: var(--texto); }
  .fn-cab .fn-redondo svg { width: 16px; height: 16px; }
  .fn-cab .fn-redondo.fn-menu { background: transparent; box-shadow: none; }
  .fn-raio { all: unset; cursor: pointer; flex: none; height: 30px; min-width: 30px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;
    color: #f5b800; font-size: 12.5px; font-weight: 800; }
  .fn-raio svg { width: 18px; height: 18px; filter: drop-shadow(0 0 5px rgba(245,184,0,.65)); }
  .fn-raio:hover { background: rgba(245,184,0,.14); }
  .fn-raio.fn-tem { background: rgba(245,184,0,.16); box-shadow: inset 0 0 0 1px rgba(245,184,0,.45), 0 0 12px rgba(245,184,0,.25); color: #a87400; }
  html[data-tema="escuro"] .fn-raio.fn-tem { color: #ffd34d; }
  .fn-raio:not(.fn-tem) { opacity: .8; }
  .fn-raio:not(.fn-tem) b { display: none; }
  .fn-lista { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 10px 8px; display: flex; flex-direction: column; gap: 10px; scrollbar-width: thin; }
  .fn-vazio { margin: 4px 2px 10px; padding: 22px 12px; border-radius: 18px; border: 1.5px dashed var(--vidro-borda); color: var(--sub); font-size: 13.5px; text-align: center; line-height: 1.4; }
  .fn-col.fn-alvo .fn-vazio { border-color: var(--cor); color: var(--texto); }
  .fn-carregar { all: unset; cursor: pointer; margin: 0 10px 12px; padding: 11px; border-radius: 999px; text-align: center; font-size: 13.5px; font-weight: 750; color: var(--marca-azul); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  html[data-tema="escuro"] .fn-carregar { color: var(--marca-menta); }

  /* ---------- cartão: vidro neutro, igual em todas as etapas (a cor fica só na bolinha da coluna) ---------- */
  .fn-resumo { --fill: var(--f-cla, #e8eef5); --tx: #106ebe; --tx2: rgba(16, 110, 190,.74); --vd: rgba(255,255,255,.55); --vd-b: rgba(16, 110, 190,.12); }
  html[data-tema="escuro"] .fn-resumo { --fill: var(--f-esc, #2a3a4c); --tx: #ffffff; --tx2: rgba(255,255,255,.80); --vd: rgba(255,255,255,.16); --vd-b: rgba(255,255,255,.22); }
  .fn-cartao { --tx: var(--texto); --tx2: var(--sub); --vd: var(--vidro-ativo); --vd-b: var(--vidro-borda);
    position: relative; display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: start; gap: 0 10px; padding: 12px 12px 11px; border-radius: 16px; cursor: pointer; color: var(--tx);
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 1px 2px rgba(7, 29, 51,.06);
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-x pan-y; transition: transform .15s ease, box-shadow .15s ease, opacity .15s ease, filter .15s ease; flex: none; }
  .fn-cartao:hover { transform: translateY(-1px); background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 6px 16px rgba(7, 29, 51,.12); }
  .fn-cartao > .avatar { width: 40px; height: 40px; font-size: 15px; margin: 0; }
  .fn-corpo { min-width: 0; display: grid; gap: 3px; padding-right: 26px; }
  .fn-cartao .fn-nome { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .fn-cartao .fn-nome > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fn-tags { flex: 1; min-width: 0; display: flex; gap: 4px; overflow: hidden; }
  .fn-tags .fn-tag { flex: 0 1 auto; min-width: 0; }
  .fn-ia { flex: none; display: inline-grid; place-items: center; height: 22px; padding: 0 7px; border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: .02em; color: var(--texto); background: color-mix(in srgb, var(--marca-menta) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-menta) 55%, transparent); }
  .fn-cartao:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .fn-cartao.fn-saindo { opacity: .3; transform: scale(.98); }
  .fn-cartao.fn-segurando { transform: scale(.97); }
  .fn-cartao.fn-novo-aqui { animation: fn-chegou .7s ease; }
  @keyframes fn-chegou { 0% { box-shadow: inset 0 0 0 2px var(--marca-menta), 0 0 0 6px color-mix(in srgb, var(--marca-menta) 35%, transparent); } 100% { box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 1px 2px rgba(7, 29, 51,.06); } }
  .fn-c0 { display: flex; align-items: center; gap: 6px; min-height: 24px; padding-right: 30px; }
  .fn-desde { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: var(--tx2); white-space: nowrap; }
  .fn-desde svg { width: 12.5px; height: 12.5px; }
  .fn-desde.fn-velho { color: #9a6700; font-weight: 700; }
  html[data-tema="escuro"] .fn-desde.fn-velho { color: #ffd34d; }
  .fn-cartao .fn-nome { font-size: 15px; font-weight: 700; letter-spacing: -.01em; line-height: 1.3; }
  .fn-linha2 { display: flex; align-items: center; gap: 5px; min-width: 0; flex-wrap: wrap; font-size: 12.5px; color: var(--tx2); line-height: 1.3; }
  .fn-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; border-radius: 999px; padding: 1px 7px 1px 5px; background: transparent; color: var(--sub); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; max-width: 96px; overflow: hidden; text-overflow: ellipsis; flex: 0 1 auto; min-width: 0; }
  .fn-tag i { width: 6px; height: 6px; border-radius: 50%; background: var(--cor); flex: none; }
  .fn-pe { display: flex; align-items: center; gap: 6px; margin-top: 5px; min-width: 0; }
  .fn-previa { min-width: 0; font-size: 13px; font-weight: 400; color: var(--sub); line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .fn-previa i { font-style: normal; font-weight: 600; }
  .fn-previa.fn-nada { font-weight: 500; color: var(--tx2); font-style: italic; }
  .fn-cartao .fn-ini { width: 24px; height: 24px; font-size: 9.5px; }
  .fn-cartao .fn-ini svg { width: 13px; height: 13px; }
  .fn-cartao .fn-ini.fn-sem { color: var(--tx2); }
  .fn-mais { all: unset; box-sizing: border-box; cursor: pointer; position: absolute; top: 8px; right: 6px; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); transition: background .15s ease; }
  .fn-mais:hover { background: var(--vidro-ativo); color: var(--texto); }
  .fn-mais svg { width: 18px; height: 18px; }

  .fn-fantasma { position: fixed; z-index: 1000; pointer-events: none; margin: 0; transform: rotate(2.5deg) scale(1.03); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.4), 0 26px 54px rgba(7, 29, 51,.42) !important; opacity: .97; }
  .fn-arrastando, .fn-arrastando * { cursor: grabbing !important; }
  .fn-arrastando .fn-quadro { scroll-snap-type: none !important; }

  .fn-nova-etapa { all: unset; cursor: pointer; width: 220px; flex: none; align-self: flex-start; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; height: 56px; border-radius: 22px;
    border: 1.5px dashed color-mix(in srgb, var(--marca-azul) 40%, var(--vidro-borda)); color: var(--marca-azul); font-weight: 700; font-size: 14.5px; background: var(--vidro-item); }
  html[data-tema="escuro"] .fn-nova-etapa { color: var(--marca-menta); border-color: color-mix(in srgb, var(--marca-menta) 30%, transparent); }
  .fn-nova-etapa svg { width: 18px; height: 18px; }
  .fn-erro { margin: 30px auto; color: var(--sub); text-align: center; display: grid; gap: 10px; justify-items: center; }

  /* ---------- folhas e diálogos desta tela ---------- */
  dialog.fn-folha .folha-lista .fn-ponto-g { width: 14px; height: 14px; border-radius: 50%; background: var(--cor); flex: none; box-shadow: 0 0 8px color-mix(in srgb, var(--cor) 55%, transparent); }
  dialog.fn-folha .folha-lista button > svg { width: 22px; height: 22px; color: var(--sub); }
  dialog.fn-folha .folha-lista button.fn-perigo, dialog.fn-folha .folha-lista button.fn-perigo b, dialog.fn-folha .folha-lista button.fn-perigo svg { color: #e5484d; }
  dialog.fn-folha .folha-lista button[aria-disabled="true"] { opacity: .45; cursor: default; }
  dialog.fn-folha .fn-sub { margin: -4px 6px 12px; text-align: center; color: var(--sub); font-size: 14px; }
  dialog.fn-folha .folha-lista + .folha-lista { margin-top: 12px; }
  dialog.fn-dlg form { gap: 14px; }
  dialog.fn-dlg .cores .cor { width: 32px; height: 32px; }
  dialog.fn-dlg .fn-aviso { margin: 0; font-size: 14px; color: var(--sub); line-height: 1.45; }
  dialog.fn-dlg .botao.fn-perigo { background: #e5484d !important; color: #fff !important; }
  dialog.fn-folha .fn-add-busca { margin: 0 2px 12px; width: auto; flex: none; max-width: none; }
  dialog.fn-folha .fn-add-lista { max-height: min(52dvh, 420px); overflow-y: auto; }

  /* ---------- botões de vidro e menta ---------- */
  .fn-bt { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 18px; border-radius: 999px; font-size: 14.5px; font-weight: 750; white-space: nowrap;
    color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); transition: transform .15s ease, filter .15s ease, background .15s ease; }
  .fn-bt:hover { transform: translateY(-1px); background: var(--vidro-ativo); }
  .fn-bt svg { width: 18px; height: 18px; flex: none; }
  dialog .fn-bt.fn-menta, .fn-bt.fn-menta { background: var(--marca-menta); color: #071d33; box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 45%, transparent), 0 8px 26px color-mix(in srgb, var(--marca-menta) 38%, transparent); }
  .fn-bt.fn-menta:hover { filter: brightness(1.05); background: var(--marca-menta); }
  .fn-bt.fn-perigo { color: #c4313b; box-shadow: inset 0 0 0 1.5px rgba(229,72,77,.6); background: transparent; }
  html[data-tema="escuro"] .fn-bt.fn-perigo { color: #ff8f94; }
  .fn-bt[aria-disabled="true"] { opacity: .5; cursor: default; transform: none; }
  .fn-bt:focus-visible, .fn-seta:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }

  /* ---------- ficha do cartão em janela de vidro ---------- */
  dialog.fn-ficha { width: min(660px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); padding: 0; border-radius: 28px; overflow: hidden; }
  dialog.fn-ficha[open] { display: flex; flex-direction: column; }
  .fn-fi-topo { display: flex; align-items: center; gap: 10px; padding: 16px 16px 6px 22px; flex: none; }
  .fn-fi-topo span { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fn-fi-topo span b { color: var(--texto); }
  .fn-fi-corpo { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 22px 6px; display: grid; gap: 16px; align-content: start; overscroll-behavior: contain; }
  .fn-fi-rodape { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 22px calc(18px + env(safe-area-inset-bottom)); flex: none; border-top: 1px solid var(--vidro-linha); }
  html[data-tema="claro"] .fn-campo select, html[data-tema="claro"] .fn-campo textarea { border-color: rgba(16, 110, 190,.14); background: rgba(255,255,255,.75); }
  html[data-tema="claro"] .fn-bt:not(.fn-menta):not(.fn-perigo) { box-shadow: inset 0 0 0 1px rgba(16, 110, 190,.14); }
  .fn-resumo { position: relative; display: grid; gap: 4px; padding: 18px 20px 18px; border-radius: 22px; color: var(--tx);
    background: linear-gradient(160deg, rgba(255,255,255,.2), rgba(255,255,255,0) 50%), var(--fill); box-shadow: inset 0 0 0 1px var(--vd-b), inset 0 1px 0 rgba(255,255,255,.3), 0 14px 34px rgba(7, 29, 51,.22); }
  .fn-resumo .fn-r0 { display: flex; align-items: center; gap: 8px; }
  .fn-resumo .fn-r0 .fn-desde { flex: 1; }
  .fn-etapa-selo { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 750; padding: 4px 11px 4px 9px; border-radius: 999px; background: var(--vd); box-shadow: inset 0 0 0 1px var(--vd-b); white-space: nowrap; }
  .fn-etapa-selo i { width: 8px; height: 8px; border-radius: 50%; background: var(--tx); }
  .fn-resumo h3 { margin: 4px 0 0; font-size: 26px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; overflow-wrap: anywhere; }
  .fn-resumo .fn-r2 { font-size: 14px; color: var(--tx2); }
  .fn-resumo .fn-r3 { display: flex; align-items: flex-end; gap: 12px; margin-top: 10px; }
  .fn-resumo .fn-r3 .fn-previa { font-size: 14.5px; -webkit-line-clamp: 3; }
  .fn-resumo .fn-ini { width: 38px; height: 38px; font-size: 12.5px; }
  .fn-resumo .fn-ini.fn-sem { color: var(--tx2); }
  .fn-trilha { display: flex; overflow-x: auto; scrollbar-width: none; padding: 2px 0; }
  .fn-trilha::-webkit-scrollbar { display: none; }
  .fn-seta { all: unset; box-sizing: border-box; cursor: pointer; flex: 1 0 auto; min-width: 96px; height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 20px 0 24px; margin-left: -7px;
    font-size: 13px; font-weight: 700; color: var(--sub); white-space: nowrap; background: var(--vidro-item);
    clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%); transition: background .15s ease, color .15s ease; }
  .fn-seta:first-child { margin-left: 0; padding-left: 16px; clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%); border-radius: 999px 0 0 999px; }
  .fn-seta:hover { background: var(--vidro-ativo); color: var(--texto); }
  .fn-seta i { width: 7px; height: 7px; border-radius: 50%; background: var(--cor); flex: none; }
  .fn-seta.fn-feita { color: var(--texto); background: color-mix(in srgb, var(--marca-menta) 14%, var(--vidro-item)); }
  .fn-seta[aria-current="step"] { background: var(--marca-menta); color: #071d33; font-weight: 800; cursor: default; }
  .fn-seta[aria-current="step"] i { background: currentColor; }
  html[data-tema="claro"] .fn-seta { background: rgba(16, 110, 190,.06); }
  html[data-tema="claro"] .fn-seta.fn-feita { background: color-mix(in srgb, var(--marca-menta) 22%, transparent); }
  html[data-tema="claro"] .fn-seta[aria-current="step"] { background: var(--marca-menta); }
  .fn-campo { display: grid; gap: 7px; }
  .fn-campo > span, .fn-campo > label > span { font-size: 13px; font-weight: 700; color: var(--sub); }
  .fn-campo select, .fn-campo textarea { box-sizing: border-box; width: 100%; font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 16px; padding: 12px 14px; min-height: 46px; }
  .fn-campo textarea { resize: vertical; min-height: 92px; line-height: 1.45; }
  .fn-campo select:focus, .fn-campo textarea:focus { outline: none; border-color: color-mix(in srgb, var(--marca-azul) 60%, var(--vidro-borda)); }
  html[data-tema="escuro"] .fn-campo select:focus, html[data-tema="escuro"] .fn-campo textarea:focus { border-color: color-mix(in srgb, var(--marca-menta) 55%, transparent); }
  html[data-tema="escuro"] .fn-campo select option { background: #0d3050; }
  .fn-campo small { font-size: 12.5px; color: var(--sub); min-height: 1em; }
  .fn-dona-linha { display: flex; align-items: center; gap: 10px; }
  .fn-dona-linha select { flex: 1; }
  .fn-dona-linha .fn-ini { width: 40px; height: 40px; font-size: 13px; }
  .fn-dona-txt { flex: 1; font-size: 15px; font-weight: 650; }
  .fn-tags-fi { display: flex; flex-wrap: wrap; gap: 6px; }
  .fn-tags-fi .fn-tag { font-size: 12.5px; padding: 5px 11px 5px 8px; max-width: none; background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fn-tags-fi .fn-tag i { width: 9px; height: 9px; }
  .fn-tags-fi em { font-style: normal; font-size: 13.5px; color: var(--sub); }

  @media (max-width: 760px) {
    #v-funil .cabeca-vista.fn-cabeca { padding: 10px 14px 2px; gap: 8px 10px; }
    #v-funil .fn-cabeca h1.titulo-grande { font-size: 32px; }
    #funil-abas .chip { height: 40px; padding: 0 13px; }
    .fn-numeros { order: 3; flex: 1 1 100%; gap: 8px; margin: 2px -14px 0; padding: 2px 14px 4px; scroll-snap-type: x proximity; }
    .fn-num { padding: 7px 14px 7px 7px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda); scroll-snap-align: start; }
    .fn-num-ic { width: 34px; height: 34px; }
    .fn-num-ic svg { width: 16px; height: 16px; }
    .fn-num b { font-size: 18px; }
    .fn-num small { font-size: 11.5px; }
    .fn-barra { padding: 4px 14px 8px; gap: 8px; }
    .fn-topo { flex-wrap: wrap; padding: 4px 14px 10px; gap: 8px; }
    .fn-topo .fn-busca { order: 1; flex: 1 1 0; min-width: 0; height: 44px; }
    .fn-filtros-bt { order: 2; height: 44px; }
    .fn-topo .fn-funis { order: 3; margin-left: 0; flex: 1 1 calc(100% - 60px); min-width: 0; }
    .fn-topo > .fn-redondo { order: 4; }
    .fn-linha.fn-l1, .fn-linha.fn-l2 { display: contents; }
    .fn-busca { order: 1; flex: 1 1 50%; min-width: 0; height: 44px; }
    .fn-unidade-sel { order: 2; }
    .fn-funis { order: 3; flex: 1 1 calc(100% - 60px); min-width: 0; }
    .fn-barra > .fn-linha > .fn-redondo { order: 4; }
    .fn-pessoas { order: 5; flex: 1 1 100%; }
    .fn-trilho .fn-pilula { height: 38px; padding: 0 13px; }
    .fn-unidades { display: none; }
    .fn-unidade-sel:not([hidden]) { display: block; height: 44px; flex: 0 1 auto; max-width: 44%; }
    .fn-redondo { width: 44px; height: 44px; }
    .fn-pessoa { height: 40px; }
    .fn-quadro { scroll-snap-type: x mandatory; padding: 4px 14px calc(100px + env(safe-area-inset-bottom)); gap: 10px; scroll-padding: 0 14px; }
    .fn-col { width: calc(100vw - 46px); scroll-snap-align: center; scroll-snap-stop: always; }
    .fn-nova-etapa { width: calc(100vw - 46px); scroll-snap-align: center; }
    .fn-mais { width: 36px; height: 36px; top: 6px; right: 6px; }
    .fn-c0 { padding-right: 38px; min-height: 28px; }
    .fn-cab .fn-redondo { width: 40px; height: 40px; }
    .fn-raio { height: 40px; min-width: 40px; }
    dialog.fn-ficha { width: 100vw; max-width: 100vw; max-height: 94dvh; margin: auto auto 0; border-radius: 28px 28px 0 0; border-bottom: 0; }
    .fn-fi-corpo { padding: 6px 16px 6px; }
    .fn-fi-topo { padding: 14px 12px 4px 18px; }
    .fn-fi-rodape { padding: 12px 16px calc(14px + env(safe-area-inset-bottom)); }
    .fn-fi-rodape .fn-bt { flex: 1 1 calc(50% - 5px); padding: 0 10px; font-size: 14px; }
    .fn-fi-rodape .fn-bt.fn-menta { flex-basis: 100%; order: -1; }
    .fn-resumo h3 { font-size: 23px; }
    .fn-seta { min-width: 104px; height: 46px; }
  }
  @media (hover: hover) and (min-width: 761px) {
    .fn-cartao .fn-mais { opacity: .55; }
    .fn-cartao:hover .fn-mais, .fn-cartao:focus-within .fn-mais { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) { .fn-cartao, .fn-col, .fn-bt, .fn-redondo, .fn-seta { transition: none; } .fn-cartao:hover, .fn-bt:hover { transform: none; } .fn-cartao.fn-novo-aqui { animation: none; } }
  `;


  // ---------- estado (sobrevive entre aberturas da aba) ----------
  const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const s = {
    ui: null, caixa: null, montado: false,
    funis: [], funisEm: 0, funilId: lerLocal('sintonia.crm.funil'), unidade: lerLocal('sintonia.crm.unidade') || '', busca: '',
    q: null, carregados: {}, geracao: 0, buscando: false, erro: null,
    colEls: new Map(), cartaoEls: new Map(), autos: [], autosEm: 0, cores: [],
    arrasto: null, aperto: null, abertos: 0, assinaturaFunis: '', dona: lerLocal('sintonia.crm.dona') || '', assinaturaPessoas: '',
    origem: lerLocal('sintonia.crm.origem') || '', etiqueta: '', periodo: '',
  };
  const PAGINA = 50;
  const DIA = 86400000;

  // ---------- cores: cartão preenchido com a cor da etapa (fosco no escuro, pastel no claro), com contraste garantido ----------
  const hexRgb = (h) => {
    h = String(h || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return Number.isNaN(n) || h.length !== 6 ? [139, 141, 152] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const misturar = (a, b, t) => a.map((v, i) => Math.round(v * t + b[i] * (1 - t)));
  const luz = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contraste = (a, b) => { const x = luz(a), y = luz(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const NOITE = [0, 26, 43], BRANCO = [255, 255, 255], TINTA = [0, 41, 65];
  const cacheTons = new Map();
  function tons(hex) {
    if (cacheTons.has(hex)) return cacheTons.get(hex);
    const c0 = hexRgb(hex);
    const media = Math.round((c0[0] + c0[1] + c0[2]) / 3);
    const c = misturar(c0, [media, media, media], 0.7); // um pouco menos saturada: tom fosco
    let t = 0.66, esc = misturar(c, NOITE, t);
    while (contraste(esc, BRANCO) < 5 && t > 0.2) { t -= 0.04; esc = misturar(c, NOITE, t); }
    let t2 = 0.36, cla = misturar(c, BRANCO, t2);
    while (contraste(cla, TINTA) < 7.5 && t2 > 0.1) { t2 -= 0.04; cla = misturar(c, BRANCO, t2); }
    const r = { esc: `rgb(${esc.join(',')})`, cla: `rgb(${cla.join(',')})` };
    cacheTons.set(hex, r);
    return r;
  }
  function pintar(no, hex) {
    const t = tons(hex || '#8B8D98');
    no.style.setProperty('--cor', hex || '#8B8D98');
    no.style.setProperty('--f-esc', t.esc);
    no.style.setProperty('--f-cla', t.cla);
  }
  // bolinhas das pessoas: tons claros de apoio com tinta azul-noite
  const TONS_PESSOA = ['#7cc4ff', '#C9D6FF', '#BFEFE3', '#FFE3A3', '#FFD0D0', '#E2D4FF', '#D6F0B8'];
  const tomPessoa = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TONS_PESSOA[h % TONS_PESSOA.length]; };
  const iniciais = (n) => { const p = String(n || '').trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?'; };
  function bolinha(dona, titulo) {
    const { el } = s.ui;
    if (!dona) return el('span', { class: 'fn-ini fn-sem', title: titulo || 'Sem dona', 'aria-label': titulo || 'Sem dona', html: SVG.pessoa });
    const b = el('span', { class: 'fn-ini', style: `--ini:${tomPessoa(dona.id)}`, title: titulo || dona.nome, 'aria-label': titulo || dona.nome, text: iniciais(dona.nome) });
    return window.SintoniaFotos?.aplicar(b, dona.id) ?? b;
  }
  const haTexto = (d) => {
    if (!d) return '';
    const min = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `há ${h} h`;
    const dias = Math.round(h / 24);
    return dias === 1 ? 'há 1 dia' : dias < 60 ? `há ${dias} dias` : `há ${Math.round(dias / 30)} meses`;
  };

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
    s.barraFunis = el('div', { class: 'fn-funis fn-trilho', role: 'tablist', 'aria-label': 'Funis' });
    s.botaoFunil = el('button', { class: 'fn-redondo', type: 'button', title: 'Opções do funil', 'aria-label': 'Opções do funil', html: SVG.pontos, onclick: menuFunil });
    const busca = el('input', { type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar no quadro por nome ou telefone', value: s.busca });
    let t = null;
    busca.addEventListener('input', () => { s.busca = busca.value; clearTimeout(t); t = setTimeout(() => { s.carregados = {}; carregarQuadro(); }, 300); });
    s.assinaturaPessoas = '';
    s.qtdFiltros = el('b');
    s.botaoFiltros = el('button', { class: 'fn-filtros-bt', type: 'button', title: 'Filtrar por origem, atendente, unidade, etiqueta ou período', onclick: abrirFiltros },
      el('span', { html: SVG.filtro, style: 'display:grid' }), el('span', { text: 'Filtros' }), s.qtdFiltros);
    s.quadro = el('div', { class: 'fn-quadro' });
    s.caixa.replaceChildren(
      el('div', { class: 'fn-topo' },
        el('label', { class: 'fn-busca' }, el('span', { html: SVG.busca, style: 'display:grid' }), busca),
        s.botaoFiltros, s.barraFunis, s.botaoFunil),
      s.quadro,
    );
    s.colEls.clear(); s.cartaoEls.clear();
    // cabeçalho da vista (em app.html): números ao lado do título
    s.numeros = document.getElementById('funil-numeros');
    s.numeros?.closest('.cabeca-vista')?.classList.add('fn-cabeca');
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
    s.unidadesOps = unidades.length < 2 ? [] : [['', 'Todas as unidades'], ...unidades.map((u) => [u, UNIDADE[u] || u])];
    contarFiltros();
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

  // ---------- números do topo e filtro de pessoas ----------
  const FECHADAS = new Set(['agendada', 'compareceu', 'manutencao', 'perdida']);
  const parada = (c) => c.desde && Date.now() - new Date(c.desde).getTime() > 3 * DIA;
  const passaDona = (c) => !s.dona || (s.dona === 'sem' ? !c.dona : !!c.dona && c.dona.id === s.dona);
  function colunasAbertas() {
    const cols = s.q?.colunas || [];
    if (funil()?.sistema) return cols.filter((c) => !FECHADAS.has(c.etapa.chaveSistema));
    return cols.length > 1 ? cols.slice(0, -1) : cols;
  }
  // O topo do quadro ficou limpo: os números grandes saíram (estão no Dashboard).
  function desenharNumeros() { s.numeros?.replaceChildren(); }
  function desenharPessoas() {
    const donas = new Map();
    let semDona = 0;
    for (const col of s.q?.colunas || []) for (const c of col.cartoes) { if (c.dona) donas.set(c.dona.id, c.dona); else semDona++; }
    if (s.dona && s.dona !== 'sem' && !donas.has(s.dona)) s.dona = '';
    const lista = [...donas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    // Opções do filtro "Atendente" (janela Filtros).
    s.donasOps = [['', 'Todas as atendentes'], ...lista.map((d) => [d.id, d.nome || 'Sem nome']), ...(semDona ? [['sem', 'Sem atendente']] : [])];
    const tags = new Map();
    for (const col of s.q?.colunas || []) for (const c of col.cartoes) for (const t of c.tags || []) tags.set(t.id, t);
    if (s.etiqueta && !tags.has(s.etiqueta)) s.etiqueta = '';
    s.etiquetasOps = [['', 'Todas as etiquetas'], ...[...tags.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map((t) => [t.id, t.nome])];
    contarFiltros();
  }

  // ---------- filtros (janela) ----------
  const PERIODOS = [['', 'Qualquer data'], ['1', 'Hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']];
  const passaEtiqueta = (c) => !s.etiqueta || (c.tags || []).some((t) => t.id === s.etiqueta);
  const passaPeriodo = (c) => {
    if (!s.periodo) return true;
    const d = Number(s.periodo);
    const desde = d === 1 ? new Date(new Date().setHours(0, 0, 0, 0)).getTime() : Date.now() - d * DIA;
    return new Date(c.ultima?.em || c.atualizadaEm || 0).getTime() >= desde;
  };
  function contarFiltros() {
    if (!s.qtdFiltros) return;
    const n = [s.origem, s.dona, s.unidade, s.etiqueta, s.periodo].filter(Boolean).length;
    s.qtdFiltros.textContent = n ? String(n) : '';
    s.botaoFiltros.setAttribute('aria-label', n ? `Filtros (${n} ligado${n === 1 ? '' : 's'})` : 'Filtros');
  }
  function abrirFiltros() {
    const { el } = s.ui;
    const ra = window.SintoniaRastreio;
    const d = el('dialog', { class: 'folha fn-folha fn-filtros', 'aria-label': 'Filtros do CRM' });
    const fechar = () => d.close();
    const campo = (rotulo, ops, valor, mudar) => {
      const sel = el('select', { 'aria-label': rotulo }, ...ops.map(([v, n]) => el('option', { value: v, text: n })));
      sel.value = valor;
      sel.addEventListener('change', () => { mudar(sel.value); contarFiltros(); });
      return el('label', { class: 'fn-campo' }, el('span', { text: rotulo }), sel);
    };
    const corpo = el('div', { class: 'fn-fil-corpo' });
    const montarCorpo = () => corpo.replaceChildren(
      campo('Origem', (ra?.opcoesFiltro() || [{ nome: 'Todas as origens', valor: '' }]).map((o) => [o.valor, o.nome.trim()]), s.origem, (v) => { s.origem = v; gravarLocal('sintonia.crm.origem', v); desenharQuadro(); }),
      campo('Atendente', s.donasOps || [['', 'Todas as atendentes']], s.dona, (v) => { s.dona = v; gravarLocal('sintonia.crm.dona', v); desenharQuadro(); }),
      (s.unidadesOps || []).length ? campo('Unidade', s.unidadesOps, s.unidade, (v) => escolherUnidade(v)) : null,
      campo('Etiqueta', s.etiquetasOps || [['', 'Todas as etiquetas']], s.etiqueta, (v) => { s.etiqueta = v; desenharQuadro(); }),
      campo('Última mensagem', PERIODOS, s.periodo, (v) => { s.periodo = v; desenharQuadro(); }),
    );
    montarCorpo();
    d.append(
      el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: 'Filtros' }), el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })),
      corpo,
      el('div', { class: 'fn-fil-rodape' },
        el('button', { class: 'fn-bt', type: 'button', text: 'Limpar', onclick: () => {
          s.origem = ''; s.dona = ''; s.etiqueta = ''; s.periodo = ''; gravarLocal('sintonia.crm.origem', ''); gravarLocal('sintonia.crm.dona', '');
          if (s.unidade) escolherUnidade(''); else desenharQuadro();
          contarFiltros(); montarCorpo();
        } }),
        el('button', { class: 'fn-bt fn-menta', type: 'button', text: 'Pronto', onclick: fechar })));
    d.addEventListener('close', () => { d.remove(); s.abertos--; });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    s.abertos++;
    ra?.carregarSelos(true).then(() => { if (d.open) montarCorpo(); });
    d.showModal();
  }

  // ---------- quadro ----------
  function desenharQuadro() {
    const { el } = s.ui;
    if (!s.q) {
      s.quadro.replaceChildren(el('div', { class: 'fn-erro' }, el('span', { text: s.erro ? `Não deu para carregar o quadro: ${s.erro}` : 'Carregando…' }),
        s.erro ? el('button', { class: 'botao leve', type: 'button', text: 'Tentar de novo', onclick: () => carregarQuadro() }) : null));
      s.colEls.clear();
      desenharNumeros();
      return;
    }
    const gestao = ehGestao();
    // a dona escolhida pode ter sumido do quadro (outro funil, outra busca)
    if (s.dona && s.dona !== 'sem' && !s.q.colunas.some((col) => col.cartoes.some((c) => c.dona && c.dona.id === s.dona))) { s.dona = ''; s.assinaturaPessoas = ''; }
    const ordem = [];
    const vistas = new Set();
    for (const col of s.q.colunas) {
      const id = col.etapa.id;
      vistas.add(id);
      let c = s.colEls.get(id);
      if (!c) { c = criarColuna(id); s.colEls.set(id, c); }
      c.col = col;
      pintar(c.raiz, col.etapa.cor || '#8B8D98');
      c.nome.textContent = col.etapa.nome;
      const ra = window.SintoniaRastreio;
      const vis = col.cartoes.filter((x) => passaDona(x) && passaEtiqueta(x) && passaPeriodo(x) && (!ra || ra.passa(x.conversaId, x.origem, s.origem)));
      c.total.textContent = String(s.dona || vis.length !== col.cartoes.length ? vis.length : col.total);
      c.total.title = s.dona ? `${vis.length} desta dona entre as carregadas` : `${col.total} cliente${col.total === 1 ? '' : 's'} nesta etapa`;
      const paradasCol = vis.filter(parada).length;
      const aberta = colunasAbertas().includes(col);
      c.sub.textContent = aberta && paradasCol ? `${paradasCol}${col.mais ? '+' : ''} parada${paradasCol === 1 ? '' : 's'} há +3 dias` : '';
      c.sub.classList.toggle('fn-alerta', !!c.sub.textContent);
      c.mais.hidden = !gestao;
      const autos = autosDaEtapa(id);
      c.raio.hidden = !gestao;
      c.raio.classList.toggle('fn-tem', autos.length > 0);
      c.raioQtd.textContent = autos.length ? String(autos.length) : '';
      const ligadas = autos.filter((a) => a.ligada).length;
      c.raio.title = autos.length ? `${autos.length} automação(ões) nesta etapa${ligadas ? `, ${ligadas} ligada(s)` : ', todas desligadas'}` : 'Criar automação: quando a cliente entrar nesta etapa';
      c.raio.setAttribute('aria-label', c.raio.title);
      c.menu.hidden = !gestao;
      // cartões: reaproveita os elementos que não mudaram (não pisca nem recarrega a foto)
      const nos = vis.map((cartao) => cartaoEl(cartao, id));
      const topo = c.lista.scrollTop;
      if (!nos.length) nos.push(el('div', { class: 'fn-vazio', text: (s.dona || s.origem || s.etiqueta || s.periodo) && col.cartoes.length ? 'Ninguém com esses filtros aqui.' : s.busca.trim() ? 'Ninguém com essa busca aqui.' : 'Nenhuma cliente nesta etapa. Arraste um cartão para cá.' }));
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
    desenharPessoas();
    desenharNumeros();
    if (s.ficha) s.ficha.atualizar();
  }

  function criarColuna(id) {
    const { el } = s.ui;
    const c = {};
    c.nome = el('h2');
    c.total = el('span', { class: 'fn-total' });
    c.sub = el('span', { class: 'fn-cab-sub' });
    c.mais = el('button', { class: 'fn-redondo', type: 'button', title: 'Pôr uma cliente nesta etapa', 'aria-label': 'Pôr uma cliente nesta etapa', html: SVG.mais, onclick: (e) => { e.stopPropagation(); adicionarCliente(c.col); } });
    c.raioQtd = el('b');
    c.raio = el('button', { class: 'fn-raio', type: 'button', onclick: (e) => { e.stopPropagation(); abrirRaio(c.col); } }, el('span', { html: SVG.raio, style: 'display:grid' }), c.raioQtd);
    c.menu = el('button', { class: 'fn-redondo fn-menu', type: 'button', title: 'Opções da etapa', 'aria-label': 'Opções da etapa', html: SVG.pontos, onclick: () => menuEtapa(c.col) });
    c.lista = el('div', { class: 'fn-lista' });
    c.carregar = el('button', { class: 'fn-carregar', type: 'button', hidden: '', onclick: () => carregarMais(c.col) });
    c.raiz = el('section', { class: 'fn-col', 'data-etapa': id, 'aria-label': 'Etapa' },
      el('div', { class: 'fn-cab' }, el('span', { class: 'fn-ponto' }),
        el('div', { class: 'fn-cab-txt' }, el('div', { class: 'fn-cab-l1' }, c.nome, c.total), c.sub), c.raio, c.mais, c.menu), c.lista, c.carregar);
    return c;
  }

  function previaEl(u) {
    const { el } = s.ui;
    const previa = el('div', { class: 'fn-previa' });
    if (u) {
      const quem = u.autor === 'cliente' ? '' : u.autor === 'ia' ? (u.autorNome && /^Automação/.test(u.autorNome) ? '⚡ ' : 'IA: ') : `${primeiroNome(u.autorNome) || 'Equipe'}: `;
      if (quem) previa.append(el('i', { text: quem }));
      previa.append(document.createTextNode(u.texto || '(mídia)'));
    } else { previa.textContent = 'Sem mensagens ainda'; previa.classList.add('fn-nada'); }
    return previa;
  }
  function desdeEl(cartao) {
    const { el } = s.ui;
    if (!cartao.desde) return el('span', { class: 'fn-desde' });
    return el('span', { class: 'fn-desde' + (parada(cartao) ? ' fn-velho' : ''), title: `Nesta etapa desde ${s.ui.quando(cartao.desde)}` },
      el('span', { html: SVG.relogio, style: 'display:grid' }), el('span', { text: haTexto(cartao.desde) }));
  }
  const tagEl = (t) => s.ui.el('span', { class: 'fn-tag', style: `--cor:${t.cor}`, title: t.nome }, s.ui.el('i'), s.ui.el('span', { text: t.nome }));

  // Ícone de origem só quando é conhecida (sem "?" em todo cartão).
  const origemConhecida = (c) => !!window.SintoniaRastreio && ((c.origem?.icone && c.origem.icone !== 'desconhecido') || !!window.SintoniaRastreio.selo(c.conversaId));
  function cartaoEl(cartao, etapaId) {
    const selo = window.SintoniaRastreio?.selo(cartao.conversaId);
    const assinatura = JSON.stringify([cartao, etapaId, Math.floor(Date.now() / 60000), selo]);
    const cache = s.cartaoEls.get(cartao.conversaId);
    if (cache && cache.assinatura === assinatura) return cache.no;
    const { el, nomeDe } = s.ui;
    const nome = cartao.nome || nomeDe({ telefone: cartao.telefone });
    const mais = el('button', { class: 'fn-mais', type: 'button', title: 'Mais opções', 'aria-label': `Mais opções de ${nome}`, html: SVG.pontos, onclick: (e) => { e.stopPropagation(); menuCartao(cartao.conversaId); } });
    // Quem atende: selo "IA" quando a IA responde sozinha; senão, a foto ou as iniciais da atendente.
    const atende = cartao.modo === 'ia'
      ? el('span', { class: 'fn-ia', title: 'A IA está atendendo', text: 'IA' })
      : bolinha(cartao.dona, cartao.dona ? `Atendida por ${cartao.dona.nome}` : 'Sem atendente');
    const no = el('div', { class: 'fn-cartao', role: 'button', tabindex: '0', 'data-id': cartao.conversaId, 'aria-label': `${nome}. Abrir conversa` },
      s.ui.avatar({ id: cartao.conversaId, nome: cartao.nome, telefone: cartao.telefone }),
      el('div', { class: 'fn-corpo' },
        el('div', { class: 'fn-nome' }, origemConhecida(cartao) ? window.SintoniaRastreio.iconeEl(cartao.origem?.icone && cartao.origem.icone !== 'desconhecido' ? cartao.origem : cartao.conversaId) : null, el('span', { text: nome })),
        previaEl(cartao.ultima),
        // Rodapé discreto: até 2 etiquetas, o relógio só quando está parada há +3 dias, e quem atende.
        el('div', { class: 'fn-pe' }, el('span', { class: 'fn-tags' }, ...(cartao.tags || []).slice(0, 2).map(tagEl)), parada(cartao) ? desdeEl(cartao) : null, atende)),
      mais);
    // Clicar no cartão abre a conversa; a ficha (observações, etapa, tags) fica no ⋯.
    no.addEventListener('click', () => { if (s.semClique) return; s.ui.abrir(cartao.conversaId); });
    no.addEventListener('keydown', (e) => {
      if (e.target !== no) return;
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
    if (col) for (const v of ['--cor', '--f-esc', '--f-cla']) fantasma.style.setProperty(v, col.style.getPropertyValue(v));
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
    const outros = [{ nome: 'Abrir conversa', icone: SVG.conversa, acao: () => s.ui.abrir(conversaId) }, { nome: 'Ficha e observações', info: 'Etapa, responsável, observações e tags', icone: SVG.lapis, acao: () => abrirFicha(conversaId) }];
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
    const abrirAutomacao = () => {
      if (!autos.length) A.abrirEditor({ funilId: f && !f.sistema ? f.id : null, gatilho: { tipo: 'entrou_na_etapa', etapaId: col.etapa.id }, nome: `Ao entrar em ${col.etapa.nome}`, aoSalvar: aoMudar });
      else A.abrirDaEtapa({ funilId: f && !f.sistema ? f.id : null, etapaId: col.etapa.id, etapaNome: col.etapa.nome, aoMudar });
    };
    // O raio oferece "Automação simples" ou "Bot (fluxo)" (/telas/bot.js).
    const B = window.SintoniaTelas.bot;
    if (B) B.escolherDaEtapa({ etapaId: col.etapa.id, etapaNome: col.etapa.nome, automacoes: autos.length, abrirAutomacao });
    else abrirAutomacao();
  }

  // ---------- ficha do cartão (janela de vidro; folha que sobe no celular) ----------
  function abrirFicha(conversaId) {
    if (!acharCartao(conversaId)) { s.ui.abrir(conversaId); return; }
    if (s.ficha) s.ficha.d.close();
    const { el, UNIDADE, nomeDe, formatarTel } = s.ui;
    const d = el('dialog', { class: 'folha fn-ficha', 'aria-label': 'Ficha da cliente' });
    const fechar = () => d.close();
    const rotuloTopo = el('span');
    const resumo = el('div', { class: 'fn-resumo' });
    const trilha = el('div', { class: 'fn-trilha', role: 'group', 'aria-label': 'Etapa do funil' });
    const donaCaixa = el('div', { class: 'fn-dona-linha' }, el('span', { class: 'fn-dona-txt', text: 'Carregando…' }));
    const obs = el('textarea', { rows: '3', maxlength: '4000', placeholder: 'Preferências, histórico, cuidados…', 'aria-label': 'Observações', disabled: '' });
    const obsInfo = el('small');
    const tags = el('div', { class: 'fn-tags-fi' });
    const rodape = el('div', { class: 'fn-fi-rodape' });
    d.append(
      el('div', { class: 'fn-fi-topo' }, rotuloTopo, el('button', { class: 'fn-redondo', type: 'button', 'aria-label': 'Fechar', title: 'Fechar', html: SVG.fechar, onclick: fechar })),
      el('div', { class: 'fn-fi-corpo' }, resumo, trilha,
        el('div', { class: 'fn-campo' }, el('span', { text: 'Responsável' }), donaCaixa),
        el('label', { class: 'fn-campo' }, el('span', { text: 'Observações da ficha' }), obs, obsInfo),
        el('div', { class: 'fn-campo' }, el('span', { text: 'Tags' }), tags)),
      rodape);
    let ultimoObs = '';
    const salvarObs = async () => {
      if (obs.disabled || obs.value === ultimoObs) return;
      const valor = obs.value;
      obsInfo.textContent = 'Salvando…';
      try { await s.ui.api(`/api/conversas/${conversaId}/contato`, { method: 'PUT', body: JSON.stringify({ observacoes: valor }) }); ultimoObs = valor; obsInfo.textContent = 'Salvo ✓'; }
      catch (x) { obsInfo.textContent = `Não deu para salvar: ${x.message}`; }
    };
    obs.addEventListener('blur', salvarObs);
    obs.addEventListener('input', () => { obsInfo.textContent = 'Salva quando você sair do campo.'; });

    const sistemaF = () => s.funis.find((f) => f.sistema);
    async function marcarSistema(chave) {
      const f = funil();
      if (f?.sistema) { const col = s.q.colunas.find((c) => c.etapa.chaveSistema === chave); if (col) await mover(conversaId, col.etapa.id); return; }
      const fs = sistemaF(); const et = fs?.etapas?.find((e) => e.chaveSistema === chave);
      if (!fs || !et) return;
      try { await s.ui.post(`/api/conversas/${conversaId}/funis/${fs.id}`, { etapaId: et.id }); s.ui.toast(`Marcada como ${et.nome.toLowerCase()} ✓`); s.funisEm = 0; }
      catch (x) { s.ui.toast(x.message); }
    }

    function atualizar() {
      const achado = acharCartao(conversaId);
      if (!achado) return;
      const { col, cartao } = achado;
      const f = funil();
      const nome = cartao.nome || nomeDe({ telefone: cartao.telefone });
      rotuloTopo.replaceChildren('Cliente · ', el('b', { text: f ? f.nome : '' }));
      pintar(resumo, col.etapa.cor);
      resumo.replaceChildren(
        el('div', { class: 'fn-r0' }, desdeEl(cartao), el('span', { class: 'fn-etapa-selo' }, el('i'), el('span', { text: col.etapa.nome }))),
        el('h3', { text: nome }),
        el('div', { class: 'fn-r2', text: [UNIDADE[cartao.unidade] || cartao.unidade, cartao.telefone ? formatarTel(cartao.telefone) : '', cartao.desde ? `desde ${s.ui.quando(cartao.desde)}` : ''].filter(Boolean).join(' · ') }),
        el('div', { class: 'fn-r3' }, previaEl(cartao.ultima), bolinha(cartao.dona, cartao.dona ? `Dona: ${cartao.dona.nome}` : 'Sem dona')));
      const i = s.q.colunas.indexOf(col);
      trilha.replaceChildren(...s.q.colunas.map((c, j) => {
        const atual = c === col;
        const b = el('button', { class: 'fn-seta' + (j < i ? ' fn-feita' : ''), type: 'button', style: `--cor:${c.etapa.cor}`, title: atual ? `Está em ${c.etapa.nome}` : `Mover para ${c.etapa.nome}`,
          'aria-current': atual ? 'step' : null, onclick: () => { if (!atual) mover(conversaId, c.etapa.id); } }, el('i'), el('span', { text: c.etapa.nome }));
        return b;
      }));
      requestAnimationFrame(() => { const atual = trilha.querySelector('[aria-current]'); if (atual) trilha.scrollLeft = Math.max(0, atual.offsetLeft - trilha.clientWidth / 2 + atual.offsetWidth / 2); });
      const ts = cartao.tags || [];
      tags.replaceChildren(...(ts.length ? ts.map(tagEl) : [el('em', { text: 'Sem tags. Marque pela conversa.' })]));
      const fs = sistemaF();
      const chaveAtual = f?.sistema ? col.etapa.chaveSistema : null;
      const bt = (classe, icone, texto, acao, desligado) => el('button', { class: 'fn-bt ' + classe, type: 'button', 'aria-disabled': desligado ? 'true' : null, onclick: () => { if (!desligado) acao(); } },
        icone ? el('span', { html: icone, style: 'display:grid' }) : null, el('span', { text: texto }));
      rodape.replaceChildren(
        bt('fn-menta', SVG.conversa, 'Abrir conversa', () => { fechar(); s.ui.abrir(conversaId); }),
        ...(fs ? [
          bt('', SVG.check, chaveAtual === 'agendada' ? 'Agendada' : 'Marcar agendada', () => marcarSistema('agendada'), chaveAtual === 'agendada'),
          bt('fn-perigo', SVG.fechar, chaveAtual === 'perdida' ? 'Perdida' : 'Marcar perdida', () => marcarSistema('perdida'), chaveAtual === 'perdida'),
        ] : []));
    }

    async function carregarDona() {
      const cartao = acharCartao(conversaId)?.cartao; if (!cartao) return;
      const atual = cartao.dona;
      let pessoas = null;
      try { pessoas = await s.ui.api(`/api/conversas/${conversaId}/transferir`); } catch { pessoas = null; }
      if (!d.open) return;
      if (pessoas) {
        const sel = el('select', { 'aria-label': 'Responsável pela conversa' });
        const opcoes = pessoas.map((p) => [p.id, p.eu ? `${p.nome} (você)` : p.nome]);
        if (atual && !opcoes.some(([id]) => id === atual.id)) opcoes.unshift([atual.id, atual.nome]);
        opcoes.push(['', 'Sem dona']);
        sel.replaceChildren(...opcoes.map(([v, n]) => el('option', { value: v, text: n })));
        sel.value = atual ? atual.id : '';
        sel.addEventListener('change', async () => {
          const usuarioId = sel.value || null;
          try {
            const r = await s.ui.post(`/api/conversas/${conversaId}/transferir`, { usuarioId });
            const c = acharCartao(conversaId)?.cartao;
            if (c) c.dona = r.responsavelId ? { id: r.responsavelId, nome: r.responsavelNome } : null;
            s.ui.toast(r.responsavelNome ? `Agora com ${r.responsavelNome} ✓` : 'A conversa ficou sem dona.');
            donaCaixa.firstChild.replaceWith(bolinha(c?.dona || null));
            desenharQuadro(); carregarQuadro();
          } catch (x) { s.ui.toast(x.message); sel.value = atual ? atual.id : ''; }
        });
        donaCaixa.replaceChildren(bolinha(atual), sel);
      } else {
        const eu = s.ui.estado.eu || {};
        const kids = [bolinha(atual), el('span', { class: 'fn-dona-txt', text: atual ? (atual.id === eu.id ? 'Você' : atual.nome) : 'Sem dona' })];
        if (!atual) kids.push(el('button', { class: 'fn-bt', type: 'button', text: 'Assumir', onclick: async () => {
          try { await s.ui.post(`/api/conversas/${conversaId}/assumir`); s.ui.toast('A conversa agora é sua.'); carregarQuadro(); fechar(); } catch (x) { s.ui.toast(x.message); }
        } }));
        donaCaixa.replaceChildren(...kids);
      }
    }
    async function carregarObs() {
      try {
        const r = await s.ui.api(`/api/conversas/${conversaId}/contato`);
        if (!d.open) return;
        ultimoObs = r.contato?.observacoes || '';
        obs.value = ultimoObs; obs.disabled = false;
      } catch (x) { obsInfo.textContent = x.message; }
    }

    s.ficha = { d, atualizar, id: conversaId };
    d.addEventListener('close', () => { salvarObs(); d.remove(); s.abertos--; if (s.ficha && s.ficha.d === d) s.ficha = null; });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    s.abertos++;
    atualizar();
    d.showModal();
    carregarDona(); carregarObs();
  }

  // ---------- "+" da coluna: pôr uma cliente das Conversas nesta etapa ----------
  function adicionarCliente(col) {
    if (!col) return;
    const { el, nomeDe, formatarTel, UNIDADE } = s.ui;
    const d = el('dialog', { class: 'folha fn-folha' });
    const fechar = () => d.close();
    const ja = new Set(s.q.colunas.flatMap((c) => c.cartoes.map((x) => x.conversaId)));
    const input = el('input', { type: 'search', placeholder: 'Buscar nome ou telefone', 'aria-label': 'Buscar cliente' });
    const lista = el('div', { class: 'folha-lista fn-add-lista' });
    const desenhar = () => {
      const t = input.value.trim().toLowerCase();
      const dig = t.replace(/\D/g, '');
      const todas = (s.ui.estado.conversas || []).filter((c) => !ja.has(c.id) && (!t || nomeDe(c).toLowerCase().includes(t) || (dig.length >= 3 && String(c.telefone || '').includes(dig)))).slice(0, 40);
      lista.replaceChildren(...(todas.length ? todas.map((c) => el('button', { type: 'button', onclick: async () => {
        fechar();
        try { await s.ui.post(`/api/conversas/${c.id}/funis/${s.funilId}`, { etapaId: col.etapa.id }); s.ui.toast(`${nomeDe(c)} entrou em “${col.etapa.nome}” ✓`); recarregarTudo(); }
        catch (x) { s.ui.toast(x.message); }
      } }, el('span', {}, el('b', { text: nomeDe(c) }), el('small', { text: [UNIDADE[c.unidade] || c.unidade, formatarTel(c.telefone)].filter(Boolean).join(' · ') })))) : [el('p', { class: 'fn-sub', style: 'margin:14px', text: 'Ninguém encontrado fora deste quadro.' })]));
    };
    input.addEventListener('input', desenhar);
    d.append(el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: `Pôr em ${col.etapa.nome}` }),
      el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })),
    el('label', { class: 'fn-busca fn-add-busca' }, el('span', { html: SVG.busca, style: 'display:grid' }), input), lista);
    desenhar();
    d.addEventListener('close', () => { d.remove(); s.abertos--; });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    s.abertos++;
    d.showModal();
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

  window.SintoniaTelas.funil = { desenhar, recarregar: () => s.ui && recarregarTudo(), redesenhar: () => { if (s.q && s.quadro) desenharQuadro(); } };
})();
