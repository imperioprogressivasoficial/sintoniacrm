/* Tela "Serena" (botão do meio da barra): conversa com a assistente de IA, no jeito do ChatGPT.
 * window.SintoniaTelas.serena = { desenhar(caixa, ui), abrirMenu(), nova() }.
 *
 * Barato por desenho:
 *  - abrir a tela NÃO chama a IA: só GET /api/serena/resumo (conversas e eventos já gravados), guardado por 60 s;
 *  - a IA só é chamada quando a pessoa manda uma mensagem (uma mensagem = uma chamada a POST /api/ia/chat);
 *  - "Responder uma cliente" responde aqui mesmo, sem IA (só pede o texto ou o print).
 * O histórico das conversas com a Serena fica neste aparelho, por pessoa (localStorage), como antes no "Ajuda da IA".
 * Texto da IA nunca entra como HTML: parágrafos, listas, **negrito**, clientes [[c1]] e mensagens prontas "…" viram elementos.
 * Animação "vidro + luz": entradas com desfoque leve, brilho menta no toque e a foto que "respira" enquanto ela pensa.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { el, api, post, estado, toast } = ui;
  const MAX_TEXTO = 4000;
  const MAX_CONVERSAS = 40;
  const MAX_MSGS = 80;
  const RESUMO_VALE_MS = 60_000;
  /* Foto da Serena embutida (240px, webp, ~10 KB): aparece na hora ao abrir a Serena, sem esperar download.
   * O arquivo grande /serena.jpg continua existindo para quem já o usa. Decodificada uma vez ao carregar. */
  const FOTO = 'data:image/webp;base64,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';
  window.SintoniaSerenaFoto = FOTO; /* a lista de Conversas usa a foto quando a IA está atendendo */
  /* conversa-extra: a mesma foto pequena e redonda em todo lugar que antes dizia "IA" (Pipeline, ficha, painéis...).
     SintoniaSerenaSelo({ tam, titulo, classe }) devolve um <span> com a foto; sem tam, o tamanho vem do CSS da classe. */
  window.SintoniaSerenaSelo = (o = {}) => {
    const s = document.createElement('span');
    s.className = 'serena-selo' + (o.classe ? ' ' + o.classe : '');
    const titulo = o.titulo || 'A Serena (IA) está atendendo';
    s.title = titulo; s.setAttribute('role', 'img'); s.setAttribute('aria-label', titulo);
    s.style.cssText = 'display:inline-block;flex:none;border-radius:50%;overflow:hidden;vertical-align:middle;line-height:0;background:#0d2240;box-shadow:0 0 0 1.5px rgba(15,252,190,.65)' + (o.tam ? `;width:${o.tam}px;height:${o.tam}px` : '');
    const i = new Image(); i.src = FOTO; i.alt = ''; i.decoding = 'async'; i.draggable = false;
    i.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;border-radius:50%';
    s.append(i);
    return s;
  };
  try { const pre = new Image(); pre.src = FOTO; pre.decode?.().catch(() => {}); } catch {}

  const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const SVG = {
    menu: I('<path d="M4 8h16M4 16h10"/>', 'stroke-width="1.9"'),
    seta: I('<path d="m6 9 6 6 6-6"/>', 'stroke-width="2"'),
    nova: I('<path d="M12 20h8"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    busca: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 'stroke-width="1.9"'),
    mais: I('<path d="M12 5v14M5 12h14"/>', 'stroke-width="1.9"'),
    mic: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
    enviar: I('<path d="M12 19V5M5 12l7-7 7 7"/>', 'stroke-width="2.1"'),
    parar: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
    camera: I('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5Z"/><circle cx="12" cy="13" r="3.5"/>'),
    fotos: I('<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="15.5" cy="9.5" r="1.8"/><path d="m3.5 16 5-5 9 9"/>'),
    clipe: I('<path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>'),
    sino: I('<path class="ic-cheio" d="M12 4a5.5 5.5 0 0 1 5.5 5.5v4.2l1.6 2.3a.8.8 0 0 1-.7 1.2H5.6a.8.8 0 0 1-.7-1.2l1.6-2.3V9.5A5.5 5.5 0 0 1 12 4Z"/><path d="M10.2 20.2h3.6"/><path d="M3 7.5a6 6 0 0 1 1.8-3M21 7.5a6 6 0 0 0-1.8-3"/>'),
    grafico: I('<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>'),
    relogio: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    respostas: I('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="m13 8-3 7"/>'),
    ajustes: I('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
    conversa: I('<path d="M6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5h-7L6.5 20.5V17A2.5 2.5 0 0 1 4 14.5v-8A2.5 2.5 0 0 1 6.5 4Z"/>'),
    historico: I('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4"/><path d="M12 8v4l2.5 1.5"/>'),
    pin: I('<path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3Z"/><path d="M12 13.5V20"/>'),
    lixo: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
    fechar: I('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2"'),
    copiar: I('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>'),
    aviao: I('<path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4Z"/>'),
    encurtar: I('<path d="M4 7h16M4 12h10M4 17h6"/>'),
    certo: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="2.2"'),
    chevron: I('<path d="m9 6 6 6-6 6"/>', 'stroke-width="2"'),
    tel: I('<path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/>'),
  };

  const CSS = `
  /* ===== Serena: tela no jeito do ChatGPT, com o design system da Sintonia ===== */
  #v-serena { position: relative; }
  .srn-raiz { --gw: min(84vw, 330px); --srn-mola: cubic-bezier(.32, 1.18, .5, 1); --srn-suave: cubic-bezier(.22, 1, .36, 1);
    --srn-gaveta-fundo: #f5f9fd; --srn-eu: #08243f; --srn-eu-txt: #fff; --srn-azul: #106ebe; --srn-vermelho: #e5383b; --srn-acao: rgba(16,110,190,.09);
    position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--srn-gaveta-fundo); isolation: isolate; }
  html[data-tema="escuro"] .srn-raiz { --srn-gaveta-fundo: #030c17; --srn-eu: #eaf3fc; --srn-eu-txt: #08243f; --srn-azul: #0ffcbe; --srn-acao: rgba(15,252,190,.10); }
  .srn-raiz button { font: inherit; }
  .srn-raiz :focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; }

  /* tela principal (é ela que desliza quando o menu abre) */
  .srn-tela { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; min-height: 0; background: var(--aurora, var(--fundo)); color: var(--texto);
    transition: transform .52s var(--srn-mola), border-radius .4s var(--srn-suave); will-change: transform; }
  .srn-raiz.aberta .srn-tela { transform: translateX(var(--gw)); border-radius: 28px; overflow: hidden; box-shadow: -10px 0 40px rgba(4,18,31,.18); }
  .srn-raiz.arrastando .srn-tela, .srn-raiz.arrastando .srn-veu { transition: none; }
  .srn-veu { position: absolute; inset: 0; z-index: 30; background: rgba(8,36,63,.16); opacity: 0; pointer-events: none; transition: opacity .4s ease;
    -webkit-backdrop-filter: blur(2.5px); backdrop-filter: blur(2.5px); border: 0; padding: 0; touch-action: pan-y; }
  html[data-tema="escuro"] .srn-veu { background: rgba(0,0,0,.34); }
  .srn-raiz.aberta .srn-veu { opacity: 1; pointer-events: auto; }

  .srn-vazio { visibility: hidden; pointer-events: none; }
  @media (min-width: 761px) { .srn-vazio { display: none; } }
  .srn-cab { flex: none; display: flex; align-items: center; gap: 8px; padding: 12px 14px 6px; padding-top: calc(12px + env(safe-area-inset-top)); }
  .srn-bt { all: unset; box-sizing: border-box; cursor: pointer; position: relative; overflow: hidden; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--texto);
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 2px 8px rgba(8,36,63,.06); transition: transform .3s var(--srn-mola); }
  .srn-bt svg { width: 21px; height: 21px; }
  .srn-bt:active { transform: scale(.93); }
  .srn-ponto { position: absolute; top: 8px; right: 8px; width: 9px; height: 9px; border-radius: 50%; background: var(--srn-vermelho); box-shadow: 0 0 0 2px var(--fundo); pointer-events: none; }
  .srn-ponto[hidden] { display: none; }
  .srn-titulo { all: unset; cursor: pointer; flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; line-height: 1.2; padding: 4px 8px; border-radius: 16px; }
  .srn-titulo b { font-size: 17px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px; }
  .srn-titulo b svg { width: 16px; height: 16px; transition: transform .3s var(--srn-suave); }
  .srn-titulo[aria-expanded="true"] b svg { transform: rotate(180deg); }
  .srn-titulo small { font-size: 12px; color: var(--sub); display: inline-flex; align-items: center; gap: 6px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .srn-vivo { width: 7px; height: 7px; border-radius: 50%; background: #16c784; box-shadow: 0 0 0 3px rgba(22,199,132,.18); flex: none; }
  .srn-vivo.off { background: #94a3b8; box-shadow: 0 0 0 3px rgba(148,163,184,.18); }

  /* faixa "precisam de você" durante a conversa */
  .srn-faixa { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; margin: 2px 14px 4px; padding: 8px 12px; border-radius: 18px; flex: none;
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px rgba(229,56,59,.24), 0 6px 22px rgba(8,36,63,.06); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); position: relative; overflow: hidden; }
  .srn-faixa[hidden] { display: none; }
  .srn-faixa > .txt { flex: 1; min-width: 0; font-size: 13.5px; line-height: 1.3; }
  .srn-faixa em { font-style: normal; font-size: 13.5px; font-weight: 600; color: var(--srn-azul); padding: 4px 2px; }

  /* miolo */
  .srn-miolo { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 6px 16px 12px; scroll-behavior: smooth; }
  .srn-coluna { max-width: 720px; margin: 0 auto; }
  .srn-ola { text-align: center; margin: 18px 0 18px; }
  .srn-ola h1 { font-size: 23px; font-weight: 700; margin: 14px 0 4px; letter-spacing: -.01em; }
  .srn-ola p { margin: 0 auto; color: var(--sub); font-size: 14px; line-height: 1.45; max-width: 330px; }
  .srn-foto { position: relative; display: block; border-radius: 50%; flex: none; }
  .srn-foto img { display: block; width: 100%; height: 100%; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 2px var(--fundo), 0 0 0 4px rgba(15,252,190,.55); }
  .srn-foto.grande { width: 76px; height: 76px; margin: 0 auto; }
  .srn-foto.grande img { box-shadow: 0 0 0 2px var(--fundo), 0 0 0 4px rgba(15,252,190,.55), 0 10px 26px rgba(16,110,190,.25); }
  .srn-foto.p { width: 28px; height: 28px; margin-top: 1px; }
  .srn-foto.p img { box-shadow: 0 0 0 1.5px var(--fundo), 0 0 0 3px rgba(15,252,190,.45); }
  /* luz: anel menta que "respira" (só transform/opacity) */
  .srn-foto::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; pointer-events: none; opacity: 0;
    background: radial-gradient(closest-side, transparent 72%, rgba(15,252,190,.55) 86%, rgba(15,252,190,0) 100%); }
  .srn-foto.grande::after { opacity: .5; animation: srnRespira 3.2s ease-in-out infinite; }
  .srn-foto.pensando::after { opacity: 1; animation: srnRespira 1.5s ease-in-out infinite; }
  @keyframes srnRespira { 0%, 100% { transform: scale(.94); opacity: .35; } 50% { transform: scale(1.14); opacity: 1; } }

  .srn-vidro { background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 6px 22px rgba(8,36,63,.06); border-radius: 20px; -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
  html[data-tema="escuro"] .srn-vidro { box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 6px 22px rgba(0,0,0,.2); }
  .srn-toca { position: relative; overflow: hidden; cursor: pointer; transition: transform .45s var(--srn-mola); -webkit-tap-highlight-color: transparent; }
  .srn-toca:active { transform: scale(.97); transition-duration: .12s; }
  button.srn-toca { -webkit-appearance: none; appearance: none; border: 0; margin: 0; font: inherit; color: var(--texto); text-align: left; box-sizing: border-box; width: 100%; }
  .srn-onda { position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; pointer-events: none; z-index: 0;
    background: radial-gradient(circle, rgba(15,252,190,.6), rgba(15,252,190,0) 70%); animation: srnOnda .7s ease-out forwards; }
  @keyframes srnOnda { to { transform: scale(22); opacity: 0; } }

  .srn-cartoes { display: grid; grid-template-columns: 1.25fr 1fr; gap: 10px; }
  .srn-cartao { padding: 13px; min-height: 84px; display: flex; flex-direction: column; gap: 6px; text-align: left; }
  .srn-cartao .rot { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: var(--sub); }
  .srn-cartao .rot.alerta { color: #c2410c; } html[data-tema="escuro"] .srn-cartao .rot.alerta { color: #ff9b73; }
  .srn-cartao .linha { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .srn-cartao .linha > .nomes { font-size: 13px; color: var(--sub); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .srn-cartao b.srn-num { font-size: 15px; font-weight: 700; }
  .srn-cartao small { font-size: 12.5px; color: var(--sub); }
  .srn-marca { width: 8px; height: 8px; border-radius: 50%; background: var(--srn-vermelho); flex: none; }
  .srn-pilha { display: flex; flex: none; }
  .srn-pilha > * { margin-left: -10px; box-shadow: 0 0 0 2px var(--fundo) !important; }
  .srn-pilha > :first-child { margin-left: 0; }
  .srn-pilha .avatar, .srn-cli .avatar { position: relative; overflow: hidden; margin-top: 0 !important; }
  .srn-pilha .avatar { width: 30px !important; height: 30px !important; font-size: 11.5px; }
  .srn-pilha .avatar img, .srn-cli .avatar img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .srn-pilha .avatar svg, .srn-cli .avatar svg { width: 70%; height: 70%; }
  .srn-mais-n { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-size: 11.5px; font-weight: 700; color: #fff; background: #0e7490; }
  .srn-rot { font-size: 12px; font-weight: 600; color: var(--sub); margin: 18px 4px 8px; letter-spacing: .02em; }
  .srn-sug { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .srn-sug .srn-vidro { padding: 12px 13px; font-size: 14px; font-weight: 600; line-height: 1.3; text-align: left; min-height: 64px; color: var(--texto); }
  .srn-sug small { display: block; font-weight: 400; color: var(--sub); font-size: 12.5px; margin-top: 3px; }
  .srn-esqueleto { color: transparent !important; background: linear-gradient(90deg, rgba(128,150,175,.14), rgba(128,150,175,.26), rgba(128,150,175,.14)); background-size: 200% 100%; border-radius: 8px; animation: srnBrilho 1.4s linear infinite; }
  @keyframes srnBrilho { to { background-position: -200% 0; } }

  /* mensagens */
  .srn-m { font-size: 15px; line-height: 1.55; margin: 12px 0; overflow-wrap: anywhere; }
  .srn-m.eu { margin-left: auto; width: fit-content; max-width: 82%; background: var(--srn-eu); color: var(--srn-eu-txt); padding: 10px 14px; border-radius: 20px 20px 6px 20px; white-space: pre-wrap; }
  .srn-m.eu img { display: block; max-width: 180px; max-height: 220px; border-radius: 12px; margin-bottom: 6px; }
  .srn-m.ia { display: flex; gap: 10px; align-items: flex-start; }
  .srn-m.ia .corpo { flex: 1; min-width: 0; }
  .srn-m.ia p { margin: 0 0 8px; } .srn-m.ia p:last-child { margin-bottom: 0; }
  .srn-m.ia ul { margin: 0 0 8px; padding-left: 20px; } .srn-m.ia li { margin: 3px 0; }
  .srn-rascunho { margin: 8px 0; padding: 12px 14px; font-style: italic; line-height: 1.5; }
  .srn-clientes { margin: 8px 0; padding: 2px 12px; }
  .srn-cli { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--linha); position: relative; overflow: hidden; }
  .srn-cli:first-child { border-top: 0; }
  .srn-cli .avatar { width: 38px !important; height: 38px !important; font-size: 13px; }
  .srn-cli .txt { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .srn-cli .txt b { font-size: 14.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .srn-cli .txt span { font-size: 12.8px; color: var(--sub); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .srn-cli > span:last-child { flex: none; width: 16px; height: 16px; }
  .srn-cli > span:last-child svg { width: 16px; height: 16px; }
  .srn-cartao .rot > span svg { width: 15px; height: 15px; }
  .srn-procura > span, .srn-g-busca > span { flex: none; width: 18px; height: 18px; }
  .srn-procura svg, .srn-g-busca > span svg { width: 18px; height: 18px; }
  .srn-acoes { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .srn-acao { all: unset; box-sizing: border-box; cursor: pointer; position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 6px; min-height: 36px; font-size: 13px; font-weight: 600; padding: 0 12px; border-radius: 999px; background: var(--srn-acao); color: var(--srn-azul); }
  .srn-acao svg { width: 15px; height: 15px; }
  .srn-digitando { display: inline-flex; gap: 5px; align-items: center; padding: 12px 14px; border-radius: 18px; }
  .srn-digitando i { width: 7px; height: 7px; border-radius: 50%; background: var(--srn-azul); animation: srnPula 1.1s ease-in-out infinite; }
  .srn-digitando i:nth-child(2) { animation-delay: .15s; } .srn-digitando i:nth-child(3) { animation-delay: .3s; }
  @keyframes srnPula { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-5px); opacity: 1; } }
  .srn-aviso { margin: 10px 0; padding: 12px 14px; border-radius: 16px; background: var(--aviso); color: var(--aviso-txt); font-size: 14px; line-height: 1.45; }
  .srn-aviso a { color: inherit; font-weight: 700; }
  .srn-erro { margin: 10px 0; padding: 10px 14px; border-radius: 16px; background: color-mix(in srgb, #e5484d 14%, transparent); font-size: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .srn-erro button { all: unset; cursor: pointer; font-weight: 700; color: var(--srn-azul); min-height: 32px; }

  /* compositor (como o do ChatGPT) */
  .srn-baixo { flex: none; padding: 2px 12px 10px; }
  .srn-tela { padding-bottom: 0; }
  @media (max-width: 760px) { .srn-baixo { padding-bottom: calc(86px + env(safe-area-inset-bottom)); } }
  .srn-anexo { display: flex; align-items: center; gap: 10px; max-width: 720px; margin: 0 auto 6px; padding: 6px 8px 6px 6px; width: fit-content; border-radius: 16px; }
  .srn-anexo[hidden] { display: none; }
  .srn-anexo img { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; display: block; }
  .srn-anexo span { font-size: 13px; color: var(--sub); }
  .srn-anexo button { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .srn-anexo button svg { width: 16px; height: 16px; }
  .srn-compor { display: flex; align-items: flex-end; gap: 6px; max-width: 720px; margin: 0 auto; border-radius: 26px; padding: 6px 6px 6px 6px; }
  .srn-compor textarea { flex: 1; min-width: 0; resize: none; border: 0; outline: none; background: transparent; color: var(--texto); font: inherit; font-size: 16px; line-height: 22px; max-height: 150px; padding: 9px 4px; }
  .srn-compor textarea::placeholder { color: color-mix(in srgb, var(--sub) 85%, transparent); }
  .srn-ic { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); position: relative; overflow: hidden; }
  .srn-ic svg { width: 22px; height: 22px; }
  .srn-ic.forte { color: var(--texto); }
  .srn-ic.gravando { color: #fff; background: var(--srn-vermelho); animation: srnGrava 1.4s ease-in-out infinite; }
  @keyframes srnGrava { 50% { transform: scale(.92); } }
  .srn-env { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--texto); color: var(--fundo); transition: opacity .2s, transform .3s var(--srn-mola); position: relative; overflow: hidden; }
  .srn-env svg { width: 20px; height: 20px; }
  .srn-env[disabled] { opacity: .3; cursor: default; }

  /* pop-ups (seletor do título e "+") */
  .srn-pop { position: absolute; z-index: 40; min-width: 240px; padding: 6px; border-radius: 22px; background: color-mix(in srgb, var(--fundo) 86%, transparent);
    box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 24px 60px rgba(4,18,31,.28); -webkit-backdrop-filter: blur(26px) saturate(1.6); backdrop-filter: blur(26px) saturate(1.6);
    transform-origin: top center; animation: srnPop .32s var(--srn-mola) both; }
  .srn-pop[hidden] { display: none; }
  .srn-pop.de-baixo { transform-origin: bottom left; }
  @keyframes srnPop { from { opacity: 0; transform: scale(.92) translateY(-6px); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
  .srn-op { all: unset; box-sizing: border-box; cursor: pointer; position: relative; overflow: hidden; width: 100%; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 12px; border-radius: 16px; color: var(--texto); }
  .srn-op:hover, .srn-op:focus-visible, .srn-op[aria-checked="true"] { background: var(--vidro-item); }
  .srn-op .ic { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .srn-op .ic svg { width: 20px; height: 20px; }
  .srn-op .t { flex: 1; min-width: 0; display: grid; }
  .srn-op .t b { font-size: 15px; font-weight: 600; }
  .srn-op .t small { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .srn-op .ok { width: 18px; height: 18px; color: var(--srn-azul); }
  .srn-veu-pop { position: absolute; inset: 0; z-index: 39; }
  .srn-veu-pop[hidden] { display: none; }

  /* menu lateral (gaveta) — como o do ChatGPT */
  .srn-gaveta { position: absolute; top: 0; bottom: 0; left: 0; width: var(--gw); z-index: 1; display: flex; flex-direction: column; color: var(--texto); background: var(--srn-gaveta-fundo);
    padding: calc(14px + env(safe-area-inset-top)) 0 calc(14px + env(safe-area-inset-bottom)); visibility: hidden; transition: visibility 0s linear .52s; }
  .srn-raiz.aberta .srn-gaveta, .srn-raiz.arrastando .srn-gaveta { visibility: visible; transition: none; }
  .srn-g-topo { display: flex; align-items: center; gap: 10px; padding: 0 16px 0 22px; min-height: 52px; }
  .srn-g-topo h2 { flex: 1; margin: 0; font-size: 25px; font-weight: 700; letter-spacing: -.015em; }
  .srn-g-busca { display: flex; align-items: center; gap: 8px; margin: 4px 16px 6px; padding: 0 6px 0 14px; height: 44px; border-radius: 22px; }
  .srn-g-busca[hidden] { display: none; }
  .srn-g-busca input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--texto); font: inherit; font-size: 16px; }
  .srn-g-status { display: flex; align-items: center; gap: 8px; padding: 0 16px 0 22px; margin: -2px 0 6px; font-size: 13px; color: var(--sub); min-height: 32px; }
  .srn-g-status span.txt { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 7px; }
  .srn-chave { all: unset; cursor: pointer; flex: none; width: 46px; height: 28px; border-radius: 999px; position: relative; background: rgba(128,150,175,.35); transition: background .25s; }
  .srn-chave::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .35s var(--srn-mola); }
  .srn-chave[aria-checked="true"] { background: #16c784; }
  .srn-chave[aria-checked="true"]::after { transform: translateX(18px); }
  .srn-chave[aria-busy="true"] { opacity: .6; }
  .srn-g-rolagem { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 10px 12px; scrollbar-width: none; }
  .srn-g-rolagem::-webkit-scrollbar { display: none; }
  .srn-g-item { all: unset; box-sizing: border-box; cursor: pointer; position: relative; overflow: hidden; width: 100%; display: flex; align-items: center; gap: 16px; min-height: 52px; padding: 0 12px; border-radius: 14px; font-size: 16.5px; font-weight: 500; color: var(--texto); }
  .srn-g-item:hover, .srn-g-item:focus-visible { background: var(--vidro-item); }
  .srn-g-item > span:first-child { width: 24px; height: 24px; flex: none; }
  .srn-g-item > span:first-child svg { width: 24px; height: 24px; }
  .srn-g-conv > span:first-child:not(:last-child) { flex: none; width: 20px; height: 20px; }
  .srn-g-conv > span svg { width: 20px; height: 20px; }
  .srn-g-item .lado { margin-left: auto; font-size: 13px; color: var(--sub); font-weight: 500; }
  .srn-g-item .qtd { margin-left: auto; min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; display: grid; place-items: center; font-size: 12px; font-weight: 700; color: #fff; background: var(--srn-vermelho); box-sizing: border-box; }
  .srn-g-item .qtd[hidden] { display: none; }
  .srn-g-secao { font-size: 16.5px; font-weight: 700; margin: 22px 12px 4px; }
  .srn-g-conv { all: unset; box-sizing: border-box; cursor: pointer; position: relative; overflow: hidden; width: 100%; display: flex; align-items: center; gap: 14px; min-height: 48px; padding: 0 12px; border-radius: 14px; font-size: 16px; color: var(--texto);
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .srn-g-conv span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .srn-g-conv > svg { width: 21px; height: 21px; flex: none; color: var(--srn-azul); }
  .srn-g-conv[aria-current="true"] { background: var(--vidro-item); }
  .srn-g-conv:hover { background: var(--vidro-item); }
  .srn-g-conv.ver-tudo { color: var(--sub); }
  .srn-g-vazio { margin: 8px 12px; font-size: 14px; color: var(--sub); line-height: 1.45; }
  .srn-g-rodape { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px 0 22px; }
  .srn-nova { all: unset; box-sizing: border-box; cursor: pointer; position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 10px; height: 52px; padding: 0 22px 0 18px; border-radius: 999px;
    background: linear-gradient(135deg, #1f7fd6, #106ebe); color: #fff; font-size: 16.5px; font-weight: 600; box-shadow: 0 8px 24px rgba(16,110,190,.35), inset 0 0 0 1px rgba(255,255,255,.18); }
  .srn-nova svg { width: 21px; height: 21px; }
  .srn-eu { all: unset; box-sizing: border-box; cursor: pointer; width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); flex: none; }
  .srn-eu .avatar { width: 40px !important; height: 40px !important; font-size: 14px; }

  /* folha de baixo (Precisa de você, Resumo, Agendado, histórico, enviar na conversa) */
  .srn-folha-veu { position: absolute; inset: 0; z-index: 50; background: rgba(8,36,63,.22); opacity: 0; pointer-events: none; transition: opacity .3s ease; -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  .srn-raiz.com-folha .srn-folha-veu { opacity: 1; pointer-events: auto; }
  .srn-folha { position: absolute; left: 0; right: 0; bottom: 0; z-index: 51; max-height: 86%; display: flex; flex-direction: column; border-radius: 28px 28px 0 0; color: var(--texto);
    background: color-mix(in srgb, var(--fundo) 92%, transparent); -webkit-backdrop-filter: blur(26px) saturate(1.5); backdrop-filter: blur(26px) saturate(1.5);
    box-shadow: inset 0 1px 0 var(--vidro-borda), 0 -18px 50px rgba(4,18,31,.25); transform: translateY(105%); transition: transform .48s var(--srn-mola); padding-bottom: env(safe-area-inset-bottom); }
  .srn-raiz.com-folha .srn-folha { transform: none; }
  @media (min-width: 761px) { .srn-folha { left: 50%; right: auto; width: min(560px, 92%); bottom: 24px; border-radius: 28px; transform: translate(-50%, 115%); }
    .srn-raiz.com-folha .srn-folha { transform: translate(-50%, 0); } }
  .srn-folha .alca { width: 38px; height: 5px; border-radius: 99px; background: rgba(128,150,175,.45); margin: 8px auto 2px; flex: none; }
  .srn-folha header { display: flex; align-items: center; gap: 8px; padding: 6px 10px 6px 20px; flex: none; }
  .srn-folha header h3 { flex: 1; margin: 0; font-size: 18px; font-weight: 700; }
  .srn-folha .corpo { overflow-y: auto; overscroll-behavior: contain; padding: 4px 16px 18px; }
  /* No celular a barra de abas (64 px + 10 px de folga) fica por cima do fim da folha: deixa esse espaço livre embaixo. */
  @media (max-width: 760px) { .srn-folha .corpo { padding-bottom: calc(18px + 84px); } }
  .srn-folha .srn-clientes { margin: 4px 0 0; }
  .srn-numeros { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; padding: 14px 8px; font-size: 12.5px; color: var(--sub); }
  .srn-numeros b { display: block; font-size: 22px; font-weight: 700; color: var(--texto); line-height: 1.2; }
  .srn-unid { display: flex; align-items: center; gap: 12px; padding: 12px 4px; border-top: 1px solid var(--linha); font-size: 15px; }
  .srn-unid span { flex: 1; min-width: 0; }
  .srn-unid small { display: block; font-size: 12.5px; color: var(--sub); }
  .srn-folha .srn-vazio { text-align: center; color: var(--sub); font-size: 14.5px; padding: 18px 8px 8px; line-height: 1.5; }
  .srn-botao { all: unset; box-sizing: border-box; cursor: pointer; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 48px; margin-top: 12px; border-radius: 16px; font-weight: 600; font-size: 15px; color: var(--srn-azul); background: var(--srn-acao); }
  .srn-botao svg { width: 18px; height: 18px; }
  .srn-procura { display: flex; align-items: center; gap: 8px; height: 44px; margin: 0 0 10px; padding: 0 14px; border-radius: 14px; }
  .srn-procura svg { width: 18px; height: 18px; color: var(--sub); flex: none; }
  .srn-procura input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--texto); font: inherit; font-size: 16px; }
  .srn-menu-conv { position: absolute; z-index: 45; min-width: 200px; }

  /* vidro: entradas com desfoque leve, em cascata */
  .srn-entra { animation: srnVidro .62s var(--srn-suave) both; animation-delay: calc(var(--i, 0) * 55ms); }
  @keyframes srnVidro { from { opacity: 0; filter: blur(8px); transform: translateY(8px); } to { opacity: 1; filter: none; transform: none; } }
  .srn-entra-msg { animation: srnVidroMsg .45s var(--srn-suave) both; }
  @keyframes srnVidroMsg { from { opacity: 0; filter: blur(6px); transform: translateY(6px); } to { opacity: 1; filter: none; transform: none; } }
  .srn-g-anima > * { animation: srnVidro .5s var(--srn-suave) both; animation-delay: calc(var(--i, 0) * 35ms + 80ms); }

  /* barra de baixo enquanto o menu está aberto: vai junto com a tela */
  @media (max-width: 760px) {
    body.srn-menu-aberto .trilho { transform: translateX(var(--srn-gw, 0px)); opacity: .55; pointer-events: none; transition: transform .52s cubic-bezier(.32, 1.18, .5, 1), opacity .4s ease; }
    body .trilho { transition: transform .52s cubic-bezier(.32, 1.18, .5, 1), opacity .4s ease; }
    body.srn-arrastando .trilho { transition: none; }
  }
  @media (min-width: 761px) {
    .srn-raiz { --gw: 300px; }
    .srn-cab { padding: 14px 18px 8px; }
    .srn-sug { grid-template-columns: repeat(4, 1fr); }
    .srn-miolo { padding: 6px 24px 12px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .srn-raiz *, .srn-raiz *::after, .srn-raiz { animation: none !important; transition: none !important; }
    body.srn-menu-aberto .trilho, body .trilho { transition: none !important; }
  }
  /* ===== serena-acoes: cartões do que a Serena vai criar (prévia + Salvar/Ajustar/Abrir no app) ===== */
  .srn-art { margin: 10px 0 4px; padding: 0; overflow: hidden; border-radius: 18px; position: relative; }
  .srn-art::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); opacity: .9; }
  .srn-art-cab { display: flex; align-items: center; gap: 10px; padding: 12px 14px 8px; }
  .srn-art-ic { flex: none; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .srn-art-ic svg { width: 18px; height: 18px; }
  .srn-art-tit { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .srn-art-tit small { font-size: 11.5px; font-weight: 600; letter-spacing: .02em; color: var(--sub); text-transform: uppercase; }
  .srn-art-tit b { font-size: 15px; font-weight: 650; line-height: 1.3; overflow-wrap: anywhere; }
  .srn-art-selo { flex: none; font-size: 11.5px; font-weight: 700; padding: 4px 9px; border-radius: 999px; background: var(--srn-acao); color: var(--srn-azul); }
  .srn-art-selo.ok { background: rgba(10,143,122,.12); color: #0a8f7a; } html[data-tema="escuro"] .srn-art-selo.ok { background: rgba(15,252,190,.14); color: #0ffcbe; }
  .srn-art-corpo { padding: 2px 14px 12px; display: grid; gap: 8px; }
  .srn-art-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .srn-art-chip { font-size: 12.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--srn-acao); color: var(--texto); }
  .srn-art-texto { margin: 0; white-space: pre-wrap; font: inherit; font-size: 13.8px; line-height: 1.55; max-height: 240px; overflow: auto; padding: 10px 12px; border-radius: 12px; background: rgba(8,36,63,.04); }
  html[data-tema="escuro"] .srn-art-texto { background: rgba(255,255,255,.05); }
  .srn-art-texto.aberto { max-height: none; }
  .srn-art-mais { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--srn-azul); justify-self: start; min-height: 28px; }
  .srn-art-linhas { display: grid; gap: 6px; margin: 0; }
  .srn-art-linhas div { display: flex; gap: 10px; font-size: 13.5px; } .srn-art-linhas dt { color: var(--sub); flex: none; width: 108px; } .srn-art-linhas dd { margin: 0; font-weight: 600; }
  .srn-art-pe { display: flex; gap: 8px; flex-wrap: wrap; padding: 10px 14px 12px; border-top: 1px solid var(--linha); }
  .srn-art-pe .srn-acao.forte { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; }
  .srn-art-pe .srn-acao[aria-busy="true"] { opacity: .6; pointer-events: none; }
  /* fluxo: gatilho → condições → ações, em cartões ligados */
  .srn-fluxo { display: grid; gap: 0; }
  .srn-no { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 9px 11px; border-radius: 14px; background: var(--vidro-forte, rgba(255,255,255,.8)); box-shadow: inset 0 0 0 1px var(--linha); }
  html[data-tema="escuro"] .srn-no { background: rgba(255,255,255,.05); }
  .srn-liga { width: 1.5px; height: 14px; margin-left: 24px; background: linear-gradient(#0ffcbe, #3aa0ff); }
  .srn-no-ic { flex: none; width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; background: var(--srn-acao); color: var(--srn-azul); }
  .srn-no-ic svg { width: 16px; height: 16px; }
  .srn-no.gatilho .srn-no-ic { background: linear-gradient(135deg, #0ffcbe, #3aa0ff); color: #08243f; }
  .srn-no.cond .srn-no-ic { background: rgba(245,184,0,.16); color: #b07d00; } html[data-tema="escuro"] .srn-no.cond .srn-no-ic { color: #f5c842; }
  .srn-no-txt { min-width: 0; display: grid; gap: 1px; }
  .srn-no-txt small { font-size: 11px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--sub); }
  .srn-no-txt b { font-size: 13.8px; font-weight: 650; }
  .srn-no-txt span { font-size: 13px; color: var(--sub); line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
  .srn-ramos { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-left: 14px; padding-left: 10px; border-left: 1.5px dashed var(--linha); }
  .srn-ramo { display: grid; align-content: start; gap: 0; }
  .srn-ramo > em { font-style: normal; font-size: 11.5px; font-weight: 700; margin: 6px 0 4px; color: #0a8f7a; } .srn-ramo.nao > em { color: #c2410c; }
  html[data-tema="escuro"] .srn-ramo > em { color: #0ffcbe; } html[data-tema="escuro"] .srn-ramo.nao > em { color: #ff9b73; }
  .srn-ramo-vazio { font-size: 12.5px; color: var(--sub); padding: 4px 0; }
  @media (max-width: 520px) { .srn-ramos { grid-template-columns: 1fr; } }

  `;

  // ---------- histórico neste aparelho (por pessoa) ----------
  const chaveHistorico = () => `sintonia.serena.v1.${estado.eu?.id || 'local'}`;
  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function lerHistorico() {
    try {
      const v = JSON.parse(localStorage.getItem(chaveHistorico()) || '{}');
      const lista = Array.isArray(v.lista) ? v.lista : [];
      return lista.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.msgs)).map((c) => ({
        id: c.id, titulo: String(c.titulo || 'Conversa'), em: Number(c.em) || Date.now(), fixada: Boolean(c.fixada),
        msgs: c.msgs.filter((m) => m && (m.papel === 'usuario' || m.papel === 'ia') && typeof m.texto === 'string').slice(-MAX_MSGS),
      }));
    } catch { return []; }
  }
  function gravarHistorico() {
    const lista = historico.filter((c) => c.msgs.length).sort((a, b) => b.em - a.em);
    const presas = lista.filter((c) => c.fixada), soltas = lista.filter((c) => !c.fixada).slice(0, MAX_CONVERSAS);
    const salvar = (l) => localStorage.setItem(chaveHistorico(), JSON.stringify({ lista: l.map((c) => ({ ...c, msgs: c.msgs.slice(-MAX_MSGS) })) }));
    try { salvar([...presas, ...soltas]); } catch {
      // Sem espaço: tira as miniaturas das imagens antigas e tenta de novo.
      try { for (const c of lista) for (const m of c.msgs) delete m.miniatura; salvar([...presas, ...soltas]); } catch { /* sem armazenamento: só esta tela lembra */ }
    }
  }

  // ---------- estado ----------
  let historico = [];
  let atualId = null; // conversa aberta (null = início)
  let resumo = null, resumoEm = 0, resumoPedido = null, resumoFalhou = false;
  let enviando = false, falha = null, anexo = null, reconhecedor = null;
  let montado = false, pessoaCarregada = null;
  const R = {}; // elementos

  const atual = () => historico.find((c) => c.id === atualId) || null;
  const primeiroNome = () => String(estado.eu?.nome || '').trim().split(/\s+/)[0] || '';
  const ehGestao = () => Boolean(estado.eu && ui.ehGestor(estado.eu));
  const ehAdmin = () => ['admin', 'direcao'].includes(estado.eu?.papel);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const saudacao = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
  const conversaDoApp = (id) => (estado.conversas || []).find((c) => c.id === id);

  // ---------- luz: brilho menta no toque ----------
  function onda(ev) {
    const t = ev.target.closest('.srn-toca, .srn-bt, .srn-op, .srn-g-item, .srn-g-conv, .srn-acao, .srn-nova, .srn-env, .srn-ic, .srn-cli, .srn-faixa, .srn-botao');
    if (!t || !R.raiz.contains(t) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = t.getBoundingClientRect();
    const s = el('i', { class: 'srn-onda', 'aria-hidden': 'true' });
    s.style.left = `${ev.clientX - r.left}px`; s.style.top = `${ev.clientY - r.top}px`;
    t.append(s); setTimeout(() => s.remove(), 720);
  }

  // ---------- texto da IA → elementos ----------
  const MARCA = /\[\[(c\d{1,3})\]\]/g;
  function comNegrito(linha) {
    const frag = document.createDocumentFragment();
    for (const p of String(linha).split(/(\*\*[^*\n]+\*\*)/g)) {
      if (!p) continue;
      if (/^\*\*[^*\n]+\*\*$/.test(p)) frag.append(el('b', { text: p.slice(2, -2) }));
      else frag.append(document.createTextNode(p));
    }
    return frag;
  }
  const semMarcas = (t) => String(t).replace(MARCA, '').replace(/[ \t]+([,.:;!?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  const limparNegrito = (t) => t.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  /** Mensagem pronta entre aspas (o parágrafo inteiro). */
  const ehRascunho = (linha) => /^\s*["“].{8,}["”]\s*$/s.test(linha);
  const tirarAspas = (t) => t.trim().replace(/^["“]/, '').replace(/["”]$/, '').trim();
  function rascunhosDe(texto) { return String(texto).split(/\n\s*\n/).map((p) => semMarcas(p).trim()).filter(ehRascunho).map((p) => limparNegrito(tirarAspas(p))); }

  function linhaCliente(info, detalhe) {
    const c = conversaDoApp(info.conversaId);
    const nome = c ? ui.nomeDe(c) : info.nome || 'Cliente';
    return el('button', { type: 'button', class: 'srn-cli', onclick: () => abrirConversa(info.conversaId) },
      ui.avatar({ id: info.conversaId }), el('span', { class: 'txt' }, el('b', { text: nome }), detalhe ? el('span', { text: detalhe }) : null),
      el('span', { html: SVG.chevron, style: 'display:grid;color:var(--sub)' }));
  }
  function formatar(texto, clientes = {}) {
    const caixa = document.createDocumentFragment();
    let lista = null, par = null, grupo = null;
    const soltas = [];
    const fechar = () => { lista = null; par = null; grupo = null; };
    for (const bruta of String(texto).replace(/\r/g, '').split('\n')) {
      const linha = bruta.replace(/^#{1,6}\s+/, '');
      const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(linha);
      const refs = [...linha.matchAll(MARCA)].map((m) => m[1]).filter((r) => clientes[r]);
      if (item && refs.length) {
        // Item de lista com uma cliente: vira uma linha que abre a conversa.
        par = null; lista = null;
        if (!grupo) { grupo = el('div', { class: 'srn-clientes srn-vidro' }); caixa.append(grupo); }
        const info = clientes[refs[0]];
        let det = limparNegrito(semMarcas(item[1]));
        const nome = info.nome || '';
        if (nome && det.toLowerCase().startsWith(nome.toLowerCase())) det = det.slice(nome.length);
        det = det.replace(/^[\s:·,–—-]+/, '').trim();
        grupo.append(linhaCliente(info, det));
        continue;
      }
      for (const r of refs) if (!soltas.includes(r)) soltas.push(r);
      const limpa = semMarcas(linha);
      if (item) {
        par = null; grupo = null;
        if (!lista) { lista = el('ul'); caixa.append(lista); }
        lista.append(el('li', {}, comNegrito(semMarcas(item[1]))));
      } else if (!limpa.trim()) { fechar(); }
      else {
        lista = null; grupo = null;
        if (par && !par.classList.contains('srn-rascunho')) par.append(el('br'), comNegrito(limpa));
        else { par = el('p', {}, comNegrito(limpa)); caixa.append(par); }
      }
    }
    // Parágrafos inteiros entre aspas = mensagem pronta (cartão de vidro).
    const frag = document.createDocumentFragment();
    for (const n of [...caixa.childNodes]) {
      if (n.tagName === 'P' && ehRascunho(n.textContent)) { const r = el('div', { class: 'srn-rascunho srn-vidro' }); r.append(...n.childNodes); frag.append(r); }
      else frag.append(n);
    }
    // Clientes citadas no meio do texto: linhas no fim (sem repetir as que já viraram linha).
    const jaTem = [...frag.childNodes].some((n) => n.classList?.contains('srn-clientes'));
    if (soltas.length && !jaTem) frag.append(el('div', { class: 'srn-clientes srn-vidro' }, ...soltas.map((r) => linhaCliente(clientes[r], ''))));
    return frag;
  }

  // ---------- montagem ----------
  function montar(caixa) {
    if (!document.getElementById('serena-css')) document.head.append(el('style', { id: 'serena-css', text: CSS }));
    R.raiz = caixa; caixa.classList.add('srn-raiz'); caixa.replaceChildren();

    // gaveta
    R.gBusca = el('input', { type: 'search', placeholder: 'Buscar nas conversas', 'aria-label': 'Buscar nas conversas com a Serena', enterkeyhint: 'search' });
    R.gBuscaCaixa = el('label', { class: 'srn-g-busca srn-vidro', hidden: '' }, el('span', { html: SVG.busca, style: 'display:grid;color:var(--sub);width:18px' }), R.gBusca,
      el('button', { type: 'button', class: 'srn-ic', 'aria-label': 'Fechar busca', html: SVG.fechar, onclick: () => alternarBusca(false) }));
    R.gBusca.addEventListener('input', desenharGaveta);
    R.gStatus = el('div', { class: 'srn-g-status' });
    R.gRolagem = el('div', { class: 'srn-g-rolagem' });
    R.gaveta = el('aside', { class: 'srn-gaveta', 'aria-label': 'Menu da Serena', id: 'srn-gaveta', inert: '' },
      el('div', { class: 'srn-g-topo' }, el('h2', { text: 'Serena' }), el('button', { type: 'button', class: 'srn-bt', 'aria-label': 'Buscar nas conversas', html: SVG.busca, onclick: () => alternarBusca() })),
      R.gStatus, R.gBuscaCaixa, R.gRolagem,
      el('div', { class: 'srn-g-rodape' },
        el('button', { type: 'button', class: 'srn-nova', onclick: () => { nova(); fecharMenu(); } }, el('span', { html: SVG.nova, style: 'display:grid' }), el('span', { text: 'Nova conversa' })),
        R.gEu = el('button', { type: 'button', class: 'srn-eu', 'aria-label': 'Sua conta', onclick: abrirConta })));

    // tela
    R.ponto = el('i', { class: 'srn-ponto', hidden: '', 'aria-hidden': 'true' });
    R.btMenu = el('button', { type: 'button', class: 'srn-bt', 'aria-label': 'Abrir o menu da Serena', 'aria-controls': 'srn-gaveta', 'aria-expanded': 'false', onclick: abrirMenu }, el('span', { html: SVG.menu, style: 'display:grid' }), R.ponto);
    R.status = el('small');
    R.titulo = el('button', { type: 'button', class: 'srn-titulo', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => alternarSeletor() },
      el('b', {}, document.createTextNode('Serena'), el('span', { html: SVG.seta, style: 'display:grid' })), R.status);
    R.btNova = el('button', { type: 'button', class: 'srn-bt', 'aria-label': 'Nova conversa', title: 'Nova conversa', html: SVG.nova, onclick: nova });
    R.faixa = el('button', { type: 'button', class: 'srn-faixa', hidden: '', onclick: () => folhaPrecisa() });
    R.miolo = el('main', { class: 'srn-miolo', 'aria-live': 'polite' });
    R.coluna = el('div', { class: 'srn-coluna' }); R.miolo.append(R.coluna);

    R.campo = el('textarea', { rows: '1', maxlength: String(MAX_TEXTO), placeholder: 'Pergunte à Serena', 'aria-label': 'Pergunte à Serena', enterkeyhint: 'send' });
    R.campo.addEventListener('input', () => { ajustarCampo(); atualizarEnviar(); });
    R.campo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(min-width: 761px)').matches) { e.preventDefault(); mandar(); } });
    R.btMais = el('button', { type: 'button', class: 'srn-ic forte', 'aria-label': 'Anexar', 'aria-haspopup': 'menu', 'aria-expanded': 'false', html: SVG.mais, onclick: () => alternarMais() });
    R.btMic = el('button', { type: 'button', class: 'srn-ic', 'aria-label': 'Falar em vez de digitar', html: SVG.mic, onclick: ditar });
    R.btEnviar = el('button', { type: 'button', class: 'srn-env', 'aria-label': 'Enviar', html: SVG.enviar, onclick: () => mandar() });
    R.anexo = el('div', { class: 'srn-anexo srn-vidro', hidden: '' });
    R.compor = el('div', { class: 'srn-compor srn-vidro' }, R.btMais, R.campo, R.btMic, R.btEnviar);
    R.arquivos = {
      camera: el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: '' }),
      fotos: el('input', { type: 'file', accept: 'image/*', hidden: '' }),
      arquivos: el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: '' }),
    };
    for (const i of Object.values(R.arquivos)) i.addEventListener('change', () => { const f = i.files?.[0]; i.value = ''; if (f) anexar(f); });

    R.veu = el('button', { type: 'button', class: 'srn-veu', 'aria-label': 'Fechar o menu', tabindex: '-1', onclick: () => fecharMenu() });
    R.tela = el('div', { class: 'srn-tela' },
      R.cab = el('header', { class: 'srn-cab' }, R.btMenu, el('span', { class: 'srn-bt srn-vazio', 'aria-hidden': 'true', style: 'visibility:hidden;pointer-events:none' }), R.titulo, window.SintoniaBotaoTema ? window.SintoniaBotaoTema('srn-bt srn-tema') : null, R.btNova),
      R.faixa, R.miolo,
      el('div', { class: 'srn-baixo' }, R.anexo, R.compor), ...Object.values(R.arquivos), R.veu);

    R.veuPop = el('div', { class: 'srn-veu-pop', hidden: '', onclick: fecharPops });
    R.seletor = el('div', { class: 'srn-pop', role: 'menu', hidden: '', 'aria-label': 'Escolher' });
    R.popMais = el('div', { class: 'srn-pop de-baixo', role: 'menu', hidden: '', 'aria-label': 'Anexar' });
    R.folhaVeu = el('div', { class: 'srn-folha-veu', onclick: fecharFolha });
    R.folha = el('section', { class: 'srn-folha', role: 'dialog', 'aria-modal': 'true', inert: '' });
    caixa.append(R.gaveta, R.tela, R.veuPop, R.seletor, R.popMais, R.folhaVeu, R.folha);

    caixa.addEventListener('pointerdown', onda);
    caixa.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (caixa.classList.contains('com-folha')) fecharFolha();
      else if (!R.seletor.hidden || !R.popMais.hidden) fecharPops();
      else if (caixa.classList.contains('aberta')) fecharMenu();
    });
    ligarGestos();
    montado = true;
  }

  // ---------- resumo (barato; 60 s de validade) ----------
  async function carregarResumo(forcar = false) {
    if (!forcar && resumo && Date.now() - resumoEm < RESUMO_VALE_MS) return resumo;
    if (resumoPedido) return resumoPedido;
    resumoPedido = api('/api/serena/resumo').then((r) => { resumo = r; resumoEm = Date.now(); resumoFalhou = false; return r; })
      .catch(() => { resumoFalhou = true; return resumo; })
      .finally(() => { resumoPedido = null; });
    return resumoPedido;
  }

  function textoStatus() {
    if (!resumo) return { txt: resumoFalhou ? 'Sua assistente' : 'Carregando…', on: null };
    if (resumo.ligada === false) return { txt: 'Desligada', on: false };
    if (resumo.ligada === null) return { txt: 'Sua assistente', on: null };
    return { txt: resumo.atendendo ? `Atendendo ${plural(resumo.atendendo, 'conversa', 'conversas')}` : 'Ligada', on: true };
  }
  function desenharCabecalho() {
    const s = textoStatus();
    R.status.replaceChildren(...(s.on === null ? [] : [el('i', { class: 'srn-vivo' + (s.on ? '' : ' off'), 'aria-hidden': 'true' })]), document.createTextNode(s.txt));
    const n = resumo?.precisa?.total || 0;
    R.ponto.hidden = !n;
    R.btMenu.setAttribute('aria-label', n ? `Abrir o menu da Serena (${plural(n, 'conversa precisa', 'conversas precisam')} de você)` : 'Abrir o menu da Serena');
    // faixa só durante a conversa
    const c = atual();
    R.faixa.hidden = !(c && c.msgs.length && n);
    if (!R.faixa.hidden) {
      const lista = resumo.precisa.lista;
      const quem = lista[0]?.nome || 'Uma cliente';
      R.faixa.replaceChildren(pilha(lista.slice(0, 3), n), el('span', { class: 'txt' }, el('b', { text: n > 1 ? `${quem} e mais ${n - 1}` : quem }), document.createTextNode(n > 1 ? ' precisam de você' : ' precisa de você')), el('em', { text: 'Ver' }));
      R.faixa.setAttribute('aria-label', `${n > 1 ? `${quem} e mais ${n - 1} precisam` : `${quem} precisa`} de você. Ver.`);
    }
  }
  function pilha(itens, total) {
    const p = el('span', { class: 'srn-pilha', 'aria-hidden': 'true' });
    const mostrar = itens.slice(0, total > 3 ? 2 : 3);
    for (const i of mostrar) p.append(ui.avatar({ id: i.conversaId }));
    if (total > mostrar.length) p.append(el('span', { class: 'srn-mais-n', text: `+${total - mostrar.length}` }));
    return p;
  }

  // ---------- início (conversa vazia) ----------
  const SUGESTOES = [
    { t: 'Quem eu ligo hoje?', s: 'Interessadas paradas', p: 'Quem eu ligo hoje?' },
    { t: 'Responder uma cliente', s: 'Cole o que ela disse', local: true },
    { t: 'Como foi o dia?', s: 'Resumo das lojas', p: 'Como foi o dia hoje?' },
    { t: 'Chamar quem sumiu', s: 'Mensagem pronta', p: 'Escreva uma mensagem curta para chamar de volta as clientes que sumiram.' },
  ];
  function desenharInicio() {
    const r = resumo;
    const h = r?.hoje;
    let frase;
    if (!r) frase = el('p', { class: resumoFalhou ? '' : 'srn-esqueleto', text: resumoFalhou ? 'Pergunte o que quiser sobre o seu dia.' : 'Carregando o seu dia…' });
    else if (r.ligada === false) frase = el('p', { text: 'Estou desligada no atendimento agora, mas posso te ajudar por aqui.' });
    else if (h.respostas) frase = el('p', { text: `Hoje respondi ${plural(h.respostas, 'mensagem', 'mensagens')}${h.marcados ? ` e marquei ${plural(h.marcados, 'horário', 'horários')}` : ''}.` });
    else frase = el('p', { text: 'Ainda não atendi ninguém hoje. Pergunte o que quiser.' });

    const n = r?.precisa?.total || 0;
    const precisa = el('button', { type: 'button', class: 'srn-cartao srn-vidro srn-toca srn-entra', style: '--i:2', onclick: folhaPrecisa, 'aria-label': n ? `${plural(n, 'conversa precisa', 'conversas precisam')} de você` : 'Ninguém precisa de você agora' },
      el('span', { class: 'rot' + (n ? ' alerta' : '') }, n ? el('i', { class: 'srn-marca' }) : el('span', { html: SVG.certo, style: 'display:grid;width:15px;color:#16c784' }), document.createTextNode(n ? 'Precisa de você' : 'Tudo em dia')),
      n ? el('span', { class: 'linha' }, pilha(r.precisa.lista, n), el('span', { class: 'nomes', text: n > 1 ? `${r.precisa.lista[0]?.nome || 'Cliente'} e mais ${n - 1}` : r.precisa.lista[0]?.nome || 'Uma cliente' }))
        : el('small', { text: r ? 'Ninguém esperando você agora.' : '…' }));
    const hoje = el('button', { type: 'button', class: 'srn-cartao srn-vidro srn-toca srn-entra', style: '--i:3', onclick: folhaResumo, 'aria-label': 'Resumo de hoje' },
      el('span', { class: 'rot', text: 'Hoje' }),
      el('b', { class: 'srn-num' + (r ? '' : ' srn-esqueleto'), text: r ? plural(h.marcados, 'horário', 'horários') : '0 horários' }),
      el('small', { text: r ? plural(h.respostas, 'resposta', 'respostas') : '' }));
    const sug = el('div', { class: 'srn-sug' }, ...SUGESTOES.map((s, i) => el('button', { type: 'button', class: 'srn-vidro srn-toca srn-entra', style: `--i:${5 + i}`, onclick: () => usarSugestao(s) }, document.createTextNode(s.t), el('small', { text: s.s }))));
    R.coluna.replaceChildren(
      el('div', { class: 'srn-ola srn-entra', style: '--i:0' }, el('span', { class: 'srn-foto grande' }, el('img', { src: FOTO, alt: 'Serena', width: '76', height: '76', decoding: 'async' })),
        el('h1', { text: `${saudacao()}${primeiroNome() ? `, ${primeiroNome()}` : ''}` }), frase),
      el('div', { class: 'srn-cartoes' }, precisa, hoje),
      el('div', { class: 'srn-rot srn-entra', style: '--i:4', text: 'Sugestões' }), sug);
  }

  // ---------- conversa ----------
  function fotoP(pensando) { return el('span', { class: 'srn-foto p' + (pensando ? ' pensando' : '') }, el('img', { src: FOTO, alt: '', width: '28', height: '28', decoding: 'async' })); }
  function bolhaIa(m, nova) {
    const corpo = el('div', { class: 'corpo' }, formatar(m.texto, m.clientes || {}));
    const rasc = rascunhosDe(m.texto);
    const acoes = el('div', { class: 'srn-acoes' },
      el('button', { type: 'button', class: 'srn-acao', onclick: () => copiar(rasc[0] || limparNegrito(semMarcas(m.texto))) }, el('span', { html: SVG.copiar, style: 'display:grid' }), document.createTextNode('Copiar')));
    if (rasc.length && !m.local) {
      acoes.append(el('button', { type: 'button', class: 'srn-acao', onclick: () => folhaEnviar(rasc[0], m.clientes) }, el('span', { html: SVG.aviao, style: 'display:grid' }), document.createTextNode('Enviar na conversa')));
      acoes.append(el('button', { type: 'button', class: 'srn-acao', onclick: () => mandar('Deixe a mensagem mais curta.') }, el('span', { html: SVG.encurtar, style: 'display:grid' }), document.createTextNode('Mais curta')));
    }
    if (Array.isArray(m.artefatos)) for (const a of m.artefatos) { const c = cartaoArtefato(m, a); if (c) corpo.append(c); }
    if (!m.local) corpo.append(acoes);
    return el('div', { class: 'srn-m ia' + (nova ? ' srn-entra-msg' : ''), role: 'article', 'aria-label': 'Serena' }, fotoP(false), corpo);
  }

  // ---------- serena-acoes: cartões do que a Serena vai criar (só salva no "Salvar") ----------
  const ART = {
    script: { rotulo: 'Script de venda', vista: 'scripts', ic: '<path d="M7 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 7 20Z"/><path d="M15 3.5V8h4M10 12h6M10 15.5h6"/>' },
    automacao: { rotulo: 'Fluxo de automação', vista: 'automacoes', ic: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z"/>' },
    link: { rotulo: 'Link de agendamento', vista: 'reunioes', ic: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m9.5 14.5 2 2 3.5-3.5"/>' },
    etiqueta: { rotulo: 'Etiqueta', vista: 'funil', ic: '<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0Z"/><circle cx="8" cy="8" r="1.4"/>' },
  };
  const IC_NO = {
    gatilho: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6Z"/>',
    enviar_mensagem: '<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/>',
    esperar: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    condicao: '<path d="M6 4v5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v3M18 4v5a4 4 0 0 1-4 4"/><circle cx="6" cy="4" r="1.5"/>',
    lembrete_ligacao: '<path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/>',
    mover_etapa: '<path d="M4 12h14M13 6l6 6-6 6"/>',
    marcar_tag: ART.etiqueta.ic, desmarcar_tag: ART.etiqueta.ic,
    fluxo_ia: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4.5"/>',
    mudar_modo: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0M17 8h4M19 6v4"/>',
  };
  const icone = (d) => el('span', { html: I(d), style: 'display:grid' });
  const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  function noFluxo(n, gatilho) {
    const c = el('div', { class: 'srn-no' + (gatilho ? ' gatilho' : n.tipo === 'condicao' ? ' cond' : '') },
      el('span', { class: 'srn-no-ic', html: I(IC_NO[gatilho ? 'gatilho' : n.tipo] || IC_NO.mover_etapa) }),
      el('span', { class: 'srn-no-txt' }, gatilho ? el('small', { text: 'Quando' }) : null, el('b', { text: n.titulo }), n.detalhe ? el('span', { text: n.detalhe }) : null));
    return c;
  }
  function listaFluxo(nos) {
    const frag = document.createDocumentFragment();
    nos.forEach((n, i) => {
      if (i) frag.append(el('i', { class: 'srn-liga', 'aria-hidden': 'true' }));
      frag.append(noFluxo(n));
      if (n.tipo === 'condicao') {
        const ramo = (lista, sim) => el('div', { class: 'srn-ramo' + (sim ? '' : ' nao') }, el('em', { text: sim ? 'Se sim' : 'Se não' }),
          lista && lista.length ? listaFluxo(lista) : el('span', { class: 'srn-ramo-vazio', text: 'Não faz nada' }));
        frag.append(el('div', { class: 'srn-ramos' }, ramo(n.entao, true), ramo(n.senao, false)));
      }
    });
    return frag;
  }
  function corpoArtefato(a) {
    const d = a.dados || {};
    const corpo = el('div', { class: 'srn-art-corpo' });
    if (a.tipo === 'script') {
      if (d.etapa) corpo.append(el('div', { class: 'srn-art-chips' }, el('span', { class: 'srn-art-chip', text: `Etapa: ${d.etapa}` })));
      const pre = el('pre', { class: 'srn-art-texto', text: String(d.texto || '') });
      corpo.append(pre);
      if (String(d.texto || '').length > 420) corpo.append(el('button', { type: 'button', class: 'srn-art-mais', text: 'Ver tudo', onclick: (e) => { pre.classList.toggle('aberto'); e.currentTarget.textContent = pre.classList.contains('aberto') ? 'Ver menos' : 'Ver tudo'; } }));
    } else if (a.tipo === 'automacao' && a.fluxo) {
      const f = el('div', { class: 'srn-fluxo' }, noFluxo(a.fluxo.gatilho, true));
      if (a.fluxo.passos.length) f.append(el('i', { class: 'srn-liga', 'aria-hidden': 'true' }), listaFluxo(a.fluxo.passos));
      corpo.append(f);
      if (a.estado !== 'salvo') corpo.append(el('span', { class: 'srn-ramo-vazio', text: 'Fica desligado ao salvar: você liga em Automações quando quiser.' }));
    } else if (a.tipo === 'link') {
      const linha = (k, v) => el('div', {}, el('dt', { text: k }), el('dd', { text: v }));
      corpo.append(el('dl', { class: 'srn-art-linhas' },
        linha('Duração', `${d.duracao_min} min`),
        linha('Dias', (d.dias || []).map((x) => DIAS_CURTOS[x]).join(', ')),
        linha('Horário', `${d.inicio} às ${d.fim}`),
        linha('Antecedência', `${d.antecedencia_h ?? 2} h`),
        d.local ? linha('Local', d.local) : null));
      if (d.descricao) corpo.append(el('pre', { class: 'srn-art-texto', text: d.descricao }));
    } else if (a.tipo === 'etiqueta') {
      const chip = el('span', { class: 'srn-art-chip', text: d.nome });
      if (/^#[0-9a-f]{6}$/i.test(d.cor || '')) { chip.style.background = d.cor; chip.style.color = '#fff'; }
      corpo.append(el('div', { class: 'srn-art-chips' }, chip));
    }
    return corpo;
  }
  async function salvarArtefato(m, a, bt) {
    bt.setAttribute('aria-busy', 'true');
    try {
      const d = a.dados || {};
      let r;
      if (a.tipo === 'script') r = a.acao === 'editar' && a.alvoId ? await api(`/api/scripts/${encodeURIComponent(a.alvoId)}`, { method: 'PUT', body: JSON.stringify(d) }) : await post('/api/scripts', d);
      else if (a.tipo === 'automacao') r = await post('/api/automacoes', d);
      else if (a.tipo === 'link') r = await post('/api/reunioes/links', d);
      else if (a.tipo === 'etiqueta') r = await post('/api/tags', d);
      a.estado = 'salvo';
      if (r && r.id && !a.alvoId) a.salvoId = r.id;
      if (r && r.slug) a.slug = r.slug;
      gravarHistorico();
      toast(`${ART[a.tipo].rotulo} salvo ✓`);
      ultimoQtd = 1e9; desenharMiolo();
    } catch (x) {
      bt.removeAttribute('aria-busy');
      toast(x.message || 'Não deu para salvar agora.');
    }
  }
  function ajustarArtefato(a) {
    R.campo.value = `Quero ajustar ${a.tipo === 'automacao' ? 'o fluxo' : a.tipo === 'script' ? 'o script' : a.tipo === 'link' ? 'o link' : 'a etiqueta'}: `;
    ajustarCampo(); atualizarEnviar();
    R.campo.focus({ preventScroll: true });
    R.campo.setSelectionRange(R.campo.value.length, R.campo.value.length);
  }
  function cartaoArtefato(m, a) {
    const tipo = ART[a.tipo];
    if (!tipo) return null;
    const salvo = a.estado === 'salvo';
    const pe = el('div', { class: 'srn-art-pe' });
    if (!salvo) {
      const bt = el('button', { type: 'button', class: 'srn-acao forte' }, icone('<path d="m5 12.5 4.5 4.5L19 7.5"/>'), document.createTextNode(a.acao === 'editar' ? 'Salvar mudanças' : 'Salvar'));
      bt.addEventListener('click', () => salvarArtefato(m, a, bt));
      pe.append(bt, el('button', { type: 'button', class: 'srn-acao', onclick: () => ajustarArtefato(a) }, icone('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'), document.createTextNode('Ajustar')));
    }
    if (a.tipo === 'link' && a.slug) pe.append(el('button', { type: 'button', class: 'srn-acao', onclick: () => copiar(`${location.origin}/r/${a.slug}`) }, icone('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>'), document.createTextNode('Copiar link')));
    pe.append(el('button', { type: 'button', class: 'srn-acao', onclick: () => { fecharMenu(); ui.mostrar(tipo.vista); } }, icone('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'), document.createTextNode('Abrir no app')));
    return el('section', { class: 'srn-art srn-vidro', 'aria-label': `${tipo.rotulo}: ${a.titulo}` },
      el('div', { class: 'srn-art-cab' }, el('span', { class: 'srn-art-ic', html: I(tipo.ic) }),
        el('span', { class: 'srn-art-tit' }, el('small', { text: a.acao === 'editar' ? `${tipo.rotulo} · edição` : tipo.rotulo }), el('b', { text: a.titulo })),
        el('span', { class: 'srn-art-selo' + (salvo ? ' ok' : ''), text: salvo ? 'Salvo ✓' : 'Prévia' })),
      corpoArtefato(a), pe);
  }
  /** O que a IA lê das mensagens anteriores: o cartão (e se foi salvo) vem antes do texto, para não ser cortado. */
  function textoParaIa(m) {
    if (m.papel !== 'ia' || !Array.isArray(m.artefatos) || !m.artefatos.length) return m.texto;
    const notas = m.artefatos.map((a) => `[cartão ${ART[a.tipo]?.rotulo || a.tipo} "${a.titulo}": ${a.estado === 'salvo' ? 'a pessoa SALVOU' : 'ainda NÃO salvo'}] ${JSON.stringify(a.dados || {}).slice(0, 2500)}`);
    return `${notas.join('\n')}\n\n${m.texto}`.slice(0, 11000);
  }
  /* serena-acoes: fim */
  function bolhaEu(m, nova) {
    const b = el('div', { class: 'srn-m eu' + (nova ? ' srn-entra-msg' : '') });
    if (m.miniatura) b.append(el('img', { src: m.miniatura, alt: 'Imagem enviada' }));
    else if (m.imagem) b.append(el('div', { text: '🖼️ Imagem', style: 'font-size:13px;opacity:.8' }));
    if (m.texto) b.append(document.createTextNode(m.texto));
    return b;
  }
  let ultimoQtd = 0;
  function desenharConversa() {
    const c = atual();
    const msgs = c ? c.msgs : [];
    const novas = msgs.length > ultimoQtd ? ultimoQtd : msgs.length;
    R.coluna.replaceChildren(...msgs.map((m, i) => (m.papel === 'usuario' ? bolhaEu(m, i >= novas) : bolhaIa(m, i >= novas))));
    ultimoQtd = msgs.length;
    if (enviando) R.coluna.append(el('div', { class: 'srn-m ia srn-entra-msg', 'aria-label': 'A Serena está escrevendo' }, fotoP(true), el('div', { class: 'srn-digitando srn-vidro' }, el('i'), el('i'), el('i'))));
    if (falha?.semChave) {
      R.coluna.append(el('p', { class: 'srn-aviso srn-entra-msg' }, document.createTextNode('A Serena ainda está desligada: falta configurar a chave da IA (Anthropic) em Conexões. '), ehAdmin() ? el('a', { href: '/conexoes', text: 'Abrir Conexões' }) : document.createTextNode('Peça para a administração.')));
    } else if (falha) {
      R.coluna.append(el('p', { class: 'srn-erro srn-entra-msg' }, el('span', { text: falha.texto }), el('button', { type: 'button', text: 'Tentar de novo', onclick: tentarDeNovo })));
    }
    requestAnimationFrame(() => { R.miolo.scrollTop = R.miolo.scrollHeight; });
  }
  function desenharMiolo() {
    const c = atual();
    if (c && c.msgs.length) desenharConversa(); else { ultimoQtd = 0; if (falha || enviando) desenharConversa(); else desenharInicio(); }
    desenharCabecalho();
    atualizarEnviar();
  }

  // ---------- mandar (uma mensagem = uma chamada à IA) ----------
  const ajustarCampo = () => { R.campo.style.height = 'auto'; R.campo.style.height = Math.min(R.campo.scrollHeight, 150) + 'px'; };
  const atualizarEnviar = () => { R.btEnviar.disabled = enviando || (!R.campo.value.trim() && !anexo); };
  function garantirConversa(titulo) {
    let c = atual();
    if (!c) { c = { id: novoId(), titulo: String(titulo || 'Conversa').replace(/\s+/g, ' ').slice(0, 60), em: Date.now(), fixada: false, msgs: [] }; historico.unshift(c); atualId = c.id; }
    return c;
  }
  function usarSugestao(s) {
    if (s.local) {
      // Sem IA: só pede o que ela disse (ou o print).
      const c = garantirConversa(s.t);
      c.msgs.push({ papel: 'usuario', texto: s.t });
      c.msgs.push({ papel: 'ia', local: true, texto: 'Cole aqui o que a cliente disse (ou mande um print da conversa pelo +) que eu te devolvo a resposta pronta.' });
      c.em = Date.now(); gravarHistorico(); desenharMiolo(); desenharGaveta();
      R.campo.focus({ preventScroll: true });
      return;
    }
    mandar(s.p);
  }
  function mandar(texto) {
    const t = String(texto ?? R.campo.value).trim().slice(0, MAX_TEXTO);
    if ((!t && !anexo) || enviando) return;
    fecharPops();
    const c = garantirConversa(t || 'Imagem');
    const m = { papel: 'usuario', texto: t };
    let imagem = null;
    if (anexo && texto === undefined) { imagem = { tipo: anexo.tipo, dados: anexo.dados }; m.imagem = true; m.miniatura = anexo.miniatura; tirarAnexo(); }
    c.msgs.push(m); c.em = Date.now(); gravarHistorico();
    if (texto === undefined) { R.campo.value = ''; ajustarCampo(); }
    pedir(imagem);
    desenharGaveta();
  }
  async function pedir(imagem) {
    const c = atual(); if (!c) return;
    enviando = true; falha = null; desenharMiolo();
    const mensagens = c.msgs.filter((m) => !m.local).slice(-20).map((m) => ({ papel: m.papel, texto: textoParaIa(m) }));
    if (imagem && mensagens.length) mensagens[mensagens.length - 1].imagem = imagem;
    try {
      const r = await post('/api/ia/chat', { mensagens });
      c.msgs.push({ papel: 'ia', texto: String(r.texto || ''), ...(r.clientes ? { clientes: r.clientes } : {}), ...(Array.isArray(r.artefatos) && r.artefatos.length ? { artefatos: r.artefatos.map((a) => ({ ...a, estado: 'previa' })) } : {}) });
      c.em = Date.now(); gravarHistorico();
    } catch (x) {
      falha = { texto: x.message || 'Não deu certo agora.', semChave: x.status === 501 || /chave da IA/i.test(x.message || '') };
    } finally {
      enviando = false;
      if (R.raiz?.isConnected) { desenharMiolo(); desenharGaveta(); }
    }
  }
  function tentarDeNovo() { const c = atual(); if (c?.msgs.at(-1)?.papel === 'usuario') pedir(); else { falha = null; desenharMiolo(); } }
  function nova() {
    atualId = null; falha = null; ultimoQtd = 0; tirarAnexo();
    R.campo.value = ''; ajustarCampo(); desenharMiolo(); desenharGaveta();
    carregarResumo().then(() => { if (!atual()) desenharMiolo(); });
  }
  function abrirConversaSerena(id) { atualId = id; falha = null; ultimoQtd = 1e9; desenharMiolo(); ultimoQtd = atual()?.msgs.length || 0; desenharGaveta(); fecharMenu(); fecharFolha(); }

  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); toast('Copiado ✓'); } catch { toast('Não deu para copiar aqui.'); } };
  function abrirConversa(id) {
    fecharFolha(); fecharMenu();
    ui.abrir(id);
  }

  // ---------- anexo (print/foto) ----------
  async function anexar(arquivo) {
    if (!/^image\//.test(arquivo.type)) { toast('Por enquanto a Serena lê só imagens (prints e fotos).'); return; }
    try {
      const url = URL.createObjectURL(arquivo);
      const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
      const reduzir = (lado, q) => {
        const k = Math.min(1, lado / Math.max(img.naturalWidth, img.naturalHeight));
        const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        return cv.toDataURL('image/jpeg', q);
      };
      let dados = reduzir(1600, 0.82);
      if (dados.length > 1_900_000) dados = reduzir(1200, 0.72);
      const miniatura = reduzir(240, 0.7);
      URL.revokeObjectURL(url);
      anexo = { tipo: 'image/jpeg', dados: dados.split(',')[1], miniatura };
      R.anexo.replaceChildren(el('img', { src: miniatura, alt: '' }), el('span', { text: 'Imagem pronta' }), el('button', { type: 'button', 'aria-label': 'Tirar a imagem', html: SVG.fechar, onclick: tirarAnexo }));
      R.anexo.hidden = false; R.anexo.classList.remove('srn-entra-msg'); void R.anexo.offsetWidth; R.anexo.classList.add('srn-entra-msg');
      atualizarEnviar(); R.campo.focus({ preventScroll: true });
    } catch { toast('Não deu para abrir essa imagem.'); }
  }
  function tirarAnexo() { anexo = null; if (R.anexo) { R.anexo.hidden = true; R.anexo.replaceChildren(); } if (R.btEnviar) atualizarEnviar(); }

  // ---------- ditado (voz → texto) ----------
  function ditar() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (reconhecedor) { reconhecedor.stop(); return; }
    if (!SR) { toast('Ditado não disponível neste navegador. Use o microfone do teclado.'); R.campo.focus(); return; }
    const r = new SR(); reconhecedor = r;
    r.lang = 'pt-BR'; r.interimResults = true; r.continuous = false;
    const antes = R.campo.value ? R.campo.value.replace(/\s*$/, ' ') : '';
    r.onresult = (e) => { let t = ''; for (const x of e.results) t += x[0].transcript; R.campo.value = antes + t; ajustarCampo(); atualizarEnviar(); };
    r.onerror = (e) => { if (e.error === 'not-allowed') toast('Libere o microfone para falar com a Serena.'); };
    r.onend = () => { reconhecedor = null; R.btMic.classList.remove('gravando'); R.btMic.innerHTML = SVG.mic; R.btMic.setAttribute('aria-label', 'Falar em vez de digitar'); };
    try { r.start(); R.btMic.classList.add('gravando'); R.btMic.innerHTML = SVG.parar; R.btMic.setAttribute('aria-label', 'Parar de ouvir'); } catch { reconhecedor = null; }
  }

  // ---------- pop-ups ----------
  function posicionar(pop, ancora, deBaixo) {
    const r = R.raiz.getBoundingClientRect(), a = ancora.getBoundingClientRect();
    pop.style.left = ''; pop.style.top = ''; pop.style.bottom = ''; pop.style.right = '';
    if (deBaixo) { pop.style.left = `${Math.max(10, a.left - r.left)}px`; pop.style.bottom = `${r.bottom - a.top + 8}px`; }
    else { const w = Math.min(r.width - 24, 360); pop.style.width = `${w}px`; pop.style.left = `${Math.max(12, a.left - r.left + a.width / 2 - w / 2)}px`; pop.style.top = `${a.bottom - r.top + 6}px`; }
  }
  const opcao = (ic, titulo, sub, acao, extra = {}) => el('button', { type: 'button', class: 'srn-op', role: extra.checado !== undefined ? 'menuitemradio' : 'menuitem', ...(extra.checado !== undefined ? { 'aria-checked': String(extra.checado) } : {}), onclick: () => { fecharPops(); acao(); } },
    el('span', { class: 'ic', html: ic }), el('span', { class: 't' }, el('b', { text: titulo }), sub ? el('small', { text: sub }) : null),
    extra.ponto ? el('i', { class: 'srn-marca' }) : null, extra.checado ? el('span', { class: 'ok', html: SVG.certo, style: 'display:grid' }) : null);
  function alternarSeletor(abrir = R.seletor.hidden) {
    fecharPops(); if (!abrir) return;
    const n = resumo?.precisa?.total || 0, h = resumo?.hoje;
    R.seletor.replaceChildren(
      opcao(SVG.conversa, 'Conversar', 'Pergunte o que quiser', () => R.campo.focus(), { checado: true }),
      opcao(SVG.sino, 'Precisa de você', n ? `${resumo.precisa.lista[0]?.nome || 'Cliente'}${n > 1 ? ` e mais ${n - 1}` : ''}` : 'Ninguém agora', folhaPrecisa, { ponto: n > 0 }),
      opcao(SVG.grafico, 'Resumo de hoje', h ? `${plural(h.marcados, 'horário', 'horários')} · ${plural(h.respostas, 'resposta', 'respostas')}` : '', folhaResumo),
      opcao(SVG.historico, 'Conversas anteriores', historico.length ? plural(historico.length, 'conversa', 'conversas') : 'Nenhuma ainda', () => abrirMenu()));
    posicionar(R.seletor, R.titulo, false);
    R.seletor.hidden = false; R.veuPop.hidden = false; R.titulo.setAttribute('aria-expanded', 'true');
    R.seletor.querySelector('.srn-op')?.focus({ preventScroll: true });
  }
  function alternarMais(abrir = R.popMais.hidden) {
    fecharPops(); if (!abrir) return;
    R.popMais.replaceChildren(
      opcao(SVG.camera, 'Câmera', 'Tirar uma foto', () => R.arquivos.camera.click()),
      opcao(SVG.fotos, 'Fotos', 'Print de uma conversa', () => R.arquivos.fotos.click()),
      opcao(SVG.clipe, 'Arquivos', 'Imagem do aparelho', () => R.arquivos.arquivos.click()));
    posicionar(R.popMais, R.btMais, true);
    R.popMais.hidden = false; R.veuPop.hidden = false; R.btMais.setAttribute('aria-expanded', 'true');
    R.popMais.querySelector('.srn-op')?.focus({ preventScroll: true });
  }
  function fecharPops() {
    if (!R.seletor) return;
    R.seletor.hidden = true; R.popMais.hidden = true; R.veuPop.hidden = true; R.menuConv?.remove(); R.menuConv = null;
    R.titulo.setAttribute('aria-expanded', 'false'); R.btMais.setAttribute('aria-expanded', 'false');
  }

  // ---------- folha de baixo ----------
  function abrirFolha(titulo, ...conteudo) {
    fecharPops();
    R.folha.replaceChildren(el('div', { class: 'alca', 'aria-hidden': 'true' }),
      el('header', {}, el('h3', { text: titulo, id: 'srn-folha-titulo' }), el('button', { type: 'button', class: 'srn-ic', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fecharFolha })),
      el('div', { class: 'corpo' }, ...conteudo));
    R.folha.setAttribute('aria-labelledby', 'srn-folha-titulo');
    R.folha.removeAttribute('inert');
    R.raiz.classList.add('com-folha');
    setTimeout(() => R.folha.querySelector('.corpo button, .corpo input, header button')?.focus({ preventScroll: true }), 60);
  }
  function fecharFolha() { if (!R.raiz?.classList.contains('com-folha')) return; R.raiz.classList.remove('com-folha'); R.folha.setAttribute('inert', ''); }
  const quandoTxt = (d) => { const x = new Date(d), h = new Date(); const am = new Date(h); am.setDate(h.getDate() + 1);
    const hora = x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return x.toDateString() === h.toDateString() ? `hoje às ${hora}` : x.toDateString() === am.toDateString() ? `amanhã às ${hora}` : `${x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`; };

  async function folhaPrecisa() {
    fecharMenu();
    const corpo = el('div');
    const pintar = () => {
      const l = resumo?.precisa?.lista || [];
      if (!resumo) corpo.replaceChildren(el('p', { class: 'srn-vazio', text: 'Carregando…' }));
      else if (!l.length) corpo.replaceChildren(el('p', { class: 'srn-vazio', text: 'Ninguém precisa de você agora. Eu aviso aqui quando alguém precisar. ✨' }));
      else corpo.replaceChildren(el('div', { class: 'srn-clientes srn-vidro' }, ...l.map((i) => linhaCliente(i, `${i.motivo}${i.tipo === 'passou' ? ` · ${i.unidadeNome}` : ''}`))),
        resumo.precisa.total > l.length ? el('p', { class: 'srn-vazio', text: `E mais ${resumo.precisa.total - l.length} nas Conversas.` }) : '');
    };
    pintar(); abrirFolha('Precisa de você', corpo);
    await carregarResumo(); pintar(); desenharCabecalho();
  }

  async function folhaResumo() {
    fecharMenu();
    const corpo = el('div');
    const pintar = () => {
      const h = resumo?.hoje;
      const nums = el('div', { class: 'srn-numeros srn-vidro' },
        el('div', {}, el('b', { text: h ? String(h.marcados) : '–' }), document.createTextNode('marcados')),
        el('div', {}, el('b', { text: h ? String(h.respostas) : '–' }), document.createTextNode('respostas')),
        el('div', {}, el('b', { text: h?.tempoMedioSeg != null ? (h.tempoMedioSeg < 90 ? `${h.tempoMedioSeg}s` : `${Math.round(h.tempoMedioSeg / 60)} min`) : '–' }), document.createTextNode('tempo médio')));
      const partes = [nums];
      if (resumo && resumo.ligada !== null) {
        partes.push(el('div', { class: 'srn-rot', text: 'Atendimento da Serena' }));
        for (const u of resumo.unidades) {
          partes.push(el('div', { class: 'srn-unid' }, el('span', {}, document.createTextNode(u.nome), el('small', { text: u.ligada ? 'Ela atende primeiro' : 'Desligada' })),
            resumo.podeLigar ? chave(u.ligada, (sim) => ligar(sim, u.unidade), `Serena no ${u.nome}`) : el('i', { class: 'srn-vivo' + (u.ligada ? '' : ' off') })));
        }
      }
      if (resumo && !resumo.podeLigar) partes.push(el('p', { class: 'srn-vazio', style: 'padding-top:10px', text: 'Só a gestão liga e desliga a Serena.' }));
      corpo.replaceChildren(...partes);
    };
    pintar(); abrirFolha('Resumo de hoje', corpo);
    await carregarResumo(); pintar();
  }

  async function folhaAgendado() {
    fecharMenu();
    const corpo = el('div');
    const pintar = () => {
      const l = resumo?.agendado?.proximas || [];
      corpo.replaceChildren(
        !resumo ? el('p', { class: 'srn-vazio', text: 'Carregando…' })
          : l.length ? el('div', { class: 'srn-clientes srn-vidro' }, ...l.map((i) => linhaCliente({ conversaId: i.conversaId, nome: i.nome }, `${i.texto} · ${quandoTxt(i.quando)}`)))
            : el('p', { class: 'srn-vazio', text: 'Nenhuma ligação programada. Programe em Ligações, ou peça para a Serena criar o lembrete na conversa.' }),
        el('button', { type: 'button', class: 'srn-botao', onclick: () => { fecharFolha(); ui.mostrar('ligacoes'); } }, el('span', { html: SVG.tel, style: 'display:grid' }), document.createTextNode('Abrir Ligações')));
    };
    pintar(); abrirFolha('Agendado', corpo);
    await carregarResumo(); pintar();
  }

  function folhaEnviar(texto, clientes) {
    const busca = el('input', { type: 'search', placeholder: 'Buscar cliente', 'aria-label': 'Buscar cliente' });
    const lista = el('div', { class: 'srn-clientes srn-vidro' });
    const citadas = Object.values(clientes || {}).map((c) => c.conversaId);
    const pintar = () => {
      const q = busca.value.trim().toLowerCase();
      const todas = [...(estado.conversas || [])].sort((a, b) => (citadas.includes(b.id) - citadas.includes(a.id)) || new Date(b.atualizadaEm || 0) - new Date(a.atualizadaEm || 0));
      const achadas = todas.filter((c) => !q || `${c.nome || ''} ${c.telefone}`.toLowerCase().includes(q)).slice(0, 30);
      lista.replaceChildren(...achadas.map((c) => linhaCliente({ conversaId: c.id, nome: c.nome }, ui.UNIDADE?.[c.unidade] || '')));
      lista.querySelectorAll('.srn-cli').forEach((b, i) => { b.onclick = () => colocarNaConversa(achadas[i].id, texto); });
      if (!achadas.length) lista.replaceChildren(el('p', { class: 'srn-vazio', text: 'Ninguém com esse nome.' }));
    };
    busca.addEventListener('input', pintar); pintar();
    abrirFolha('Enviar na conversa', el('p', { style: 'margin:0 4px 10px;color:var(--sub);font-size:13.5px;line-height:1.45', text: 'A mensagem vai para a caixa de texto da conversa. Você confere e envia.' }),
      el('label', { class: 'srn-procura srn-vidro' }, el('span', { html: SVG.busca, style: 'display:grid' }), busca), lista);
  }
  function colocarNaConversa(id, texto) {
    fecharFolha();
    ui.abrir(id);
    let n = 0;
    const tentar = () => { if (estado.aberta === id && document.getElementById('texto')) { ui.usarTexto(texto); toast('Mensagem na caixa de texto. Confira e envie.'); } else if (n++ < 30) setTimeout(tentar, 100); };
    setTimeout(tentar, 120);
  }

  function folhaHistorico() {
    fecharMenu();
    const busca = el('input', { type: 'search', placeholder: 'Buscar', 'aria-label': 'Buscar nas conversas' });
    const lista = el('div');
    const pintar = () => {
      const q = busca.value.trim().toLowerCase();
      const l = historico.filter((c) => c.msgs.length && (!q || c.titulo.toLowerCase().includes(q) || c.msgs.some((m) => m.texto.toLowerCase().includes(q))));
      lista.replaceChildren(...(l.length ? l.map((c) => itemConversa(c)) : [el('p', { class: 'srn-vazio', text: q ? 'Nada encontrado.' : 'Nenhuma conversa ainda.' })]));
    };
    busca.addEventListener('input', pintar); pintar();
    abrirFolha('Conversas anteriores', el('label', { class: 'srn-procura srn-vidro' }, el('span', { html: SVG.busca, style: 'display:grid' }), busca), lista);
  }

  // ---------- liga/desliga (gestão; usa o controle dos agentes de IA) ----------
  function chave(ligado, mudar, rotulo) {
    const b = el('button', { type: 'button', class: 'srn-chave', role: 'switch', 'aria-checked': String(Boolean(ligado)), 'aria-label': rotulo });
    b.addEventListener('click', async () => { const sim = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-busy', 'true'); b.setAttribute('aria-checked', String(sim)); const ok = await mudar(sim); b.removeAttribute('aria-busy'); if (!ok) b.setAttribute('aria-checked', String(!sim)); });
    return b;
  }
  async function ligar(sim, unidade) {
    try {
      const c = await api('/api/agentes-ia/controle');
      const unidades = unidade ? [unidade] : ['norte', 'sumare'].filter((u) => !sim || c[u]?.agenteId);
      if (sim && !unidades.length) { toast('Escolha o agente da Serena em Personalizar primeiro.'); return false; }
      const novo = {}; for (const u of unidades) novo[u] = { ...c[u], ligado: sim };
      await api('/api/agentes-ia/controle', { method: 'PUT', body: JSON.stringify(novo) });
      toast(sim ? 'Serena ligada ✓' : 'Serena desligada');
      await carregarResumo(true); desenharCabecalho(); desenharGaveta(); if (!atual()) desenharMiolo();
      return true;
    } catch (x) { toast(x.message || 'Não deu para mudar agora.'); return false; }
  }

  // ---------- gaveta ----------
  function itemConversa(c) {
    const b = el('button', { type: 'button', class: 'srn-g-conv', 'aria-current': String(c.id === atualId), onclick: () => { if (segurou) { segurou = false; return; } abrirConversaSerena(c.id); } },
      c.fixada ? el('span', { html: SVG.pin, style: 'display:grid;color:var(--srn-azul)' }) : null, el('span', { text: c.titulo }));
    let t = 0, segurou = false;
    const menu = (x, y) => menuConversa(c, x, y);
    b.addEventListener('pointerdown', (e) => { segurou = false; clearTimeout(t); t = setTimeout(() => { segurou = true; navigator.vibrate?.(8); menu(e.clientX, e.clientY); }, 480); });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(t));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); clearTimeout(t); segurou = false; menu(e.clientX, e.clientY); });
    return b;
  }
  function menuConversa(c, x, y) {
    fecharPops();
    const r = R.raiz.getBoundingClientRect();
    R.menuConv = el('div', { class: 'srn-pop srn-menu-conv', role: 'menu' },
      opcao(SVG.pin, c.fixada ? 'Desafixar' : 'Fixar', '', () => { c.fixada = !c.fixada; gravarHistorico(); desenharGaveta(); }),
      opcao(SVG.lixo, 'Apagar', '', () => { historico = historico.filter((k) => k !== c); if (atualId === c.id) atualId = null; gravarHistorico(); desenharGaveta(); desenharMiolo(); }));
    R.menuConv.style.left = `${Math.min(x - r.left, r.width - 230)}px`; R.menuConv.style.top = `${Math.min(y - r.top, r.height - 140)}px`;
    R.raiz.append(R.menuConv); R.veuPop.hidden = false;
    R.menuConv.querySelector('.srn-op')?.focus({ preventScroll: true });
  }
  function alternarBusca(abrir = R.gBuscaCaixa.hidden) {
    R.gBuscaCaixa.hidden = !abrir;
    if (abrir) R.gBusca.focus(); else R.gBusca.value = '';
    desenharGaveta();
  }
  function desenharGaveta() {
    if (!R.gRolagem) return;
    // status (+ chave da gestão)
    const s = textoStatus();
    R.gStatus.replaceChildren(el('span', { class: 'txt' }, s.on === null ? '' : el('i', { class: 'srn-vivo' + (s.on ? '' : ' off'), 'aria-hidden': 'true' }), document.createTextNode(s.on === null ? 'Sua assistente de IA' : s.txt)),
      resumo?.podeLigar ? chave(resumo.ligada, (sim) => ligar(sim), 'Serena atendendo') : '');
    // eu
    const eu = estado.eu;
    if (eu && pessoaCarregada !== eu.id + (window.SintoniaFotos?.url?.(eu.id) || '')) {
      pessoaCarregada = eu.id + (window.SintoniaFotos?.url?.(eu.id) || '');
      const ini = String(eu.nome || '?').trim().split(/\s+/).map((p) => p[0]).filter(Boolean);
      const av = el('span', { class: 'avatar', 'data-pessoa': eu.id, text: ((ini[0] || '?') + (ini.length > 1 ? ini.at(-1) : '')).toUpperCase(), style: 'background:#106ebe' });
      window.SintoniaFotos?.aplicar?.(av, eu.id);
      R.gEu.replaceChildren(av);
    }
    const q = R.gBusca.value.trim().toLowerCase();
    if (!R.gBuscaCaixa.hidden && q) {
      const achadas = historico.filter((c) => c.msgs.length && (c.titulo.toLowerCase().includes(q) || c.msgs.some((m) => m.texto.toLowerCase().includes(q))));
      R.gRolagem.replaceChildren(el('div', { class: 'srn-g-secao', text: 'Resultados' }), ...(achadas.length ? achadas.map(itemConversa) : [el('p', { class: 'srn-g-vazio', text: 'Nada encontrado.' })]));
      return;
    }
    const n = resumo?.precisa?.total || 0;
    const item = (ic, txt, acao, lado) => el('button', { type: 'button', class: 'srn-g-item', onclick: acao }, el('span', { html: ic, style: 'display:grid' }), el('span', { text: txt }), lado || '');
    const menu = el('div', { class: 'srn-g-anima' },
      item(SVG.sino, 'Precisa de você', folhaPrecisa, el('span', { class: 'qtd', text: String(n), hidden: n ? undefined : '', 'aria-label': `${n} esperando` })),
      item(SVG.grafico, 'Resumo de hoje', folhaResumo, resumo ? el('span', { class: 'lado', text: `${resumo.hoje.marcados} · ${resumo.hoje.respostas}`, 'aria-hidden': 'true' }) : ''),
      item(SVG.relogio, 'Agendado', folhaAgendado, resumo?.agendado?.total ? el('span', { class: 'lado', text: String(resumo.agendado.total) }) : ''),
      item(SVG.respostas, 'Respostas rápidas', () => { fecharMenu(); ui.mostrar('respostas'); }),
      /* Treinar a Serena (pedido do dono 20/11): abre o Agente de IA direto na parte de treinamento */
      ehGestao() ? item(SVG.nova, 'Treinar a Serena', () => { fecharMenu(); ui.mostrar('ia'); let n = 0; const ir = () => { const b = document.querySelector('#v-ia .iax-o4'); if (b) b.scrollIntoView({ block: 'start', behavior: 'smooth' }); else if (n++ < 20) setTimeout(ir, 150); }; setTimeout(ir, 120); }) : '',
      ehGestao() ? item(SVG.ajustes, 'Personalizar', () => { fecharMenu(); ui.mostrar('ia'); }) : '');
    [...menu.children].forEach((c, i) => c.style.setProperty('--i', i));
    const com = historico.filter((c) => c.msgs.length);
    const fixadas = com.filter((c) => c.fixada);
    const recentes = com.filter((c) => !c.fixada).slice(0, 8);
    R.gRolagem.replaceChildren(menu,
      ...(fixadas.length ? [el('div', { class: 'srn-g-secao', text: 'Fixado' }), ...fixadas.map(itemConversa)] : []),
      el('div', { class: 'srn-g-secao', text: 'Recentes' }),
      ...(recentes.length ? recentes.map(itemConversa) : [el('p', { class: 'srn-g-vazio', text: 'Suas conversas com a Serena aparecem aqui. Segure uma para fixar.' })]),
      com.length > fixadas.length + recentes.length || recentes.length >= 5 ? el('button', { type: 'button', class: 'srn-g-conv ver-tudo', onclick: folhaHistorico }, el('span', { text: 'Ver tudo…' })) : '');
  }

  // ---------- abrir / fechar o menu (a tela desliza para a direita) ----------
  const larguraGaveta = () => R.gaveta.getBoundingClientRect().width || 300;
  function abrirMenu() {
    fecharPops(); fecharFolha();
    desenharGaveta();
    document.body.style.setProperty('--srn-gw', `${larguraGaveta()}px`);
    R.raiz.classList.add('aberta'); document.body.classList.add('srn-menu-aberto');
    R.gaveta.removeAttribute('inert');
    for (const x of [R.cab, R.faixa, R.miolo, R.compor.parentElement]) x.setAttribute('inert', '');
    R.btMenu.setAttribute('aria-expanded', 'true');
    setTimeout(() => R.gaveta.querySelector('.srn-g-item')?.focus({ preventScroll: true }), 80);
    carregarResumo().then(() => { desenharGaveta(); desenharCabecalho(); });
  }
  function fecharMenu() {
    if (!R.raiz?.classList.contains('aberta')) return;
    R.raiz.classList.remove('aberta'); document.body.classList.remove('srn-menu-aberto');
    R.tela.style.transform = ''; R.veu.style.opacity = '';
    R.gaveta.setAttribute('inert', '');
    for (const x of [R.cab, R.faixa, R.miolo, R.compor.parentElement]) x.removeAttribute('inert');
    R.btMenu.setAttribute('aria-expanded', 'false');
    alternarBusca(false);
  }
  function abrirConta() {
    fecharMenu(); ui.mostrar('configuracoes');
    setTimeout(() => document.querySelector('#configuracoes .mais-perfil')?.click(), 60);
  }

  // Gestos: puxar da borda esquerda abre; arrastar para a esquerda (ou tocar) na tela empurrada fecha.
  function ligarGestos() {
    let x0 = 0, y0 = 0, modo = null, dx = 0, w = 0;
    const mover = (px) => {
      const t = modo === 'abrir' ? Math.min(w, Math.max(0, px)) : Math.min(w, Math.max(0, w + px));
      R.tela.style.transform = `translateX(${t}px)`; R.veu.style.opacity = String(t / w);
      document.body.style.setProperty('--srn-gw', `${t}px`);
    };
    const fim = () => {
      if (!modo) return;
      R.raiz.classList.remove('arrastando'); document.body.classList.remove('srn-arrastando');
      R.tela.style.transform = ''; R.veu.style.opacity = '';
      if (modo === 'abrir') { if (dx > w * 0.3) abrirMenu(); else { document.body.style.removeProperty('--srn-gw'); } }
      else if (Math.abs(dx) < 6 || dx < -w * 0.3) fecharMenu(); else document.body.style.setProperty('--srn-gw', `${w}px`);
      modo = null;
    };
    R.tela.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; const r = R.raiz.getBoundingClientRect();
      if (R.raiz.classList.contains('aberta') || R.raiz.classList.contains('com-folha') || t.clientX - r.left > 24) return;
      x0 = t.clientX; y0 = t.clientY; dx = 0; w = larguraGaveta(); modo = 'talvez-abrir';
    }, { passive: true });
    R.veu.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; dx = 0; w = larguraGaveta(); modo = 'talvez-fechar'; }, { passive: true });
    const aoMover = (e) => {
      if (!modo) return;
      const t = e.touches[0]; dx = t.clientX - x0;
      if (modo.startsWith('talvez')) {
        if (Math.abs(t.clientY - y0) > Math.abs(dx) && Math.abs(t.clientY - y0) > 8) { modo = null; return; }
        if (Math.abs(dx) < 8) return;
        modo = modo === 'talvez-abrir' ? 'abrir' : 'fechar';
        if (modo === 'abrir') { desenharGaveta(); R.gaveta.removeAttribute('inert'); }
        R.raiz.classList.add('arrastando'); document.body.classList.add('srn-arrastando', 'srn-menu-aberto');
      }
      mover(dx);
    };
    R.tela.addEventListener('touchmove', aoMover, { passive: true });
    R.tela.addEventListener('touchend', () => { if (modo === 'talvez-fechar') { modo = 'fechar'; dx = 0; } if (modo === 'abrir' || modo === 'fechar') { if (modo === 'abrir' && dx <= w * 0.3) { document.body.classList.remove('srn-menu-aberto'); R.gaveta.setAttribute('inert', ''); } fim(); } else modo = null; });
    R.tela.addEventListener('touchcancel', fim);
  }

  // ---------- entrada pública ----------
  function desenhar(caixa) {
    if (!montado || R.raiz !== caixa || !caixa.contains(R.tela)) montar(caixa);
    if (!historico.length || historicoDe !== estado.eu?.id) { historico = lerHistorico(); historicoDe = estado.eu?.id; }
    const primeiro = !resumo;
    desenharMiolo(); desenharGaveta();
    carregarResumo().then(() => {
      if (!R.raiz.isConnected) return;
      desenharCabecalho(); desenharGaveta();
      if (!atual() && !enviando && !falha) { if (primeiro) desenharInicioSemAnimar(); else desenharInicio(); }
    });
  }
  let historicoDe = null;
  // Depois que os números chegam: troca o conteúdo dos cartões sem repetir a animação de entrada.
  function desenharInicioSemAnimar() { desenharInicio(); R.coluna.querySelectorAll('.srn-entra').forEach((x) => x.classList.remove('srn-entra')); }

  // A atendente e a bolinha de acesso rápido agora abrem a Serena (o antigo "Ajuda da IA").
  const antigo = window.SintoniaChatIa;
  window.SintoniaChatIa = { ...(antigo || {}), abrir: () => ui.mostrar('serena'), fechar: () => {} };
  // sair(): chamado por mostrar() ao trocar de tela (fecha o menu para a barra voltar ao lugar).
  window.SintoniaTelas.serena = { desenhar, abrirMenu, fecharMenu, nova, sair: () => { fecharMenu(); fecharFolha(); fecharPops(); if (reconhecedor) reconhecedor.stop(); } };
})();
