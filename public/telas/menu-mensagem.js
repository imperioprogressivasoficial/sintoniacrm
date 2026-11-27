/* menu-mensagem: segurar uma mensagem da conversa abre o menu igual ao do WhatsApp do iPhone (pedido do dono, 21/11).
 * - Celular: toque longo (~350 ms, sem o dedo andar mais de 10 px; rolar a conversa nunca abre). Vibra curto onde o aparelho deixa.
 *   Computador: botão direito, a setinha que aparece no canto do balão ao passar o mouse, ou clicar e segurar.
 *   Clique rápido e arrastar para selecionar texto continuam normais.
 * - gestos-whats (27/11): enquanto segura, o balão afunda de leve; ao abrir ele "levanta" (escala 1,03 + sombra), o resto da
 *   tela escurece e desfoca suave, a pílula de reações entra em cima e o cartão embaixo com mola curta (~220 ms; sai em ~150 ms).
 *   O balão fica no mesmo lugar da tela; se o menu não couber, a conversa rola o necessário. Só transform/opacity.
 * - Fundo desfocado e escurecido; o balão segurado fica nítido no lugar dele; em cima, a pílula de reações
 *   (👍 ❤️ 😂 😮 😢 🙏 ✅ e "+" com mais emojis); embaixo, o cartão de ações (só o que vale para aquela mensagem).
 * - Fecha tocando fora, com ESC ou arrastando para baixo no celular.
 * - Nos balões: reações no canto, citação ("respondendo a"), "Mensagem apagada", "Editada", estrela das favoritas
 *   e a faixa da mensagem fixada no topo. Faixa "Respondendo a…" acima do campo de escrever.
 * Ganchos no app.html: desenharConversa chama SintoniaMenuMensagem.decorar(bal, m) e .depois(); enviar() pergunta
 * SintoniaMenuMensagem.citando() para mandar citando. O servidor confere tudo de novo (src/conversa/acoes-mensagem.ts).
 * Texto que vem do servidor entra sempre por textContent. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, post, el, toast, estado } = ui;
  const $ = (id) => document.getElementById(id);
  const msgs = $('msgs');
  if (!msgs) return;

  const SEGURAR_MS = 350;
  const ANDOU_PX = 10;
  const RAPIDOS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅'];

  const tr = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    responder: tr('<path d="M9.5 7 4.5 12l5 5"/><path d="M5 12h9a5.5 5.5 0 0 1 5.5 5.5V19"/>'),
    encaminhar: tr('<path d="M14.5 7l5 5-5 5"/><path d="M19 12h-9A5.5 5.5 0 0 0 4.5 17.5V19"/>'),
    copiar: tr('<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>'),
    editar: tr('<path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/><path d="M13.5 7.5l3 3"/>'),
    nota: tr('<path d="M6 3.5h9l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5Z"/><path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16h4.5"/>'),
    dados: tr('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>'),
    estrela: tr('<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7.9-5.6-4-3.9 5.6-.8L12 3.8Z"/>'),
    apagar: tr('<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 11v5.5M14 11v5.5"/>'),
    mais: tr('<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>'),
    fixar: tr('<path d="M9 4h6l-1 5 3 3v1.5H7V12l3-3-1-5ZM12 13.5V20"/>'),
    traduzir: tr('<path d="M4 6h8M8 4v2M5.5 6c.6 3 2.7 5.4 5.5 6.5M10.5 6c-.6 3-2.7 5.4-5.5 6.5"/><path d="M12.5 20l3.5-8.5 3.5 8.5M13.7 17.2h4.6"/>'),
    rapida: tr('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M12 8v7M8.5 11.5h7"/>'),
    transcrever: tr('<path d="M5 7h14M5 12h14M5 17h8"/>'),
    voltar: tr('<path d="m14.5 6-6 6 6 6"/>'),
    lista: tr('<path d="M9 6h11M9 12h11M9 18h11"/><path d="m4.5 4.8.6 1.2 1.3.2-1 .9.3 1.3-1.2-.6-1.1.6.2-1.3-.9-.9 1.3-.2.5-1.2Z"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="18" r=".6"/>'),
    fechar: tr('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    proibido: tr('<circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/>'),
    mais2: tr('<path d="M12 6v12M6 12h12"/>'),
  };
  const ESTRELA_CHEIA = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7.9-5.6-4-3.9 5.6-.8L12 3.8Z"/></svg>';

  const ESTILO = `
  /* toque longo: sem o menu do iOS (copiar/consultar) por cima do nosso, sem seleção no celular */
  #msgs .bal { -webkit-touch-callout: none; }
  @media (pointer: coarse) { #msgs .bal { -webkit-user-select: none; user-select: none; } }
  /* segurando: o balão afunda de leve (só transform) */
  #msgs .bal.mm-segurando { transform: scale(.97); transition: transform .2s cubic-bezier(.2,.8,.2,1); }
  #msgs .bal.rec.mm-segurando { transform-origin: left center; } #msgs .bal.env.mm-segurando { transform-origin: right center; }
  #msgs .bal.mm-original { opacity: 0 !important; }
  /* setinha do canto do balão (computador, ao passar o mouse) */
  .mm-seta { all: unset; box-sizing: border-box; position: absolute; top: 3px; right: 3px; z-index: 2; width: 26px; height: 22px; border-radius: 0 6px 0 12px; display: grid; place-items: center; cursor: pointer;
    color: var(--sub); background: radial-gradient(circle at 70% 30%, var(--mm-seta-fundo, var(--recebida)) 55%, transparent 80%); opacity: 0; transform: translateY(-2px); transition: opacity .12s ease, transform .12s ease; }
  .bal.env > .mm-seta { --mm-seta-fundo: var(--enviada); }
  .bal.midia > .mm-seta { color: #fff; --mm-seta-fundo: rgba(0,0,0,.35); }
  .mm-seta svg { width: 18px; height: 18px; }
  .mm-seta.mm-ver, .mm-seta:focus-visible { opacity: 1; transform: none; }
  .mm-seta:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 1px; }

  /* ---------- menu ---------- */
  /* camada separada para o desfoque: só a opacidade dela anima (leve para o celular) */
  .mm-fundo { position: fixed; inset: 0; z-index: 2147482000; touch-action: none; overscroll-behavior: contain; -webkit-tap-highlight-color: transparent; }
  .mm-veu { position: absolute; inset: 0; background: rgba(8,26,46,.30); -webkit-backdrop-filter: blur(10px) saturate(1.1); backdrop-filter: blur(10px) saturate(1.1);
    opacity: 0; transition: opacity .2s ease; }
  html[data-tema="escuro"] .mm-veu { background: rgba(0,8,18,.55); }
  .mm-fundo.mm-aberto .mm-veu { opacity: 1; }
  .mm-fundo.mm-saindo .mm-veu { opacity: 0; transition-duration: .15s; }
  .mm-peca { position: absolute; }
  /* o balão "levanta": cresce 3% e ganha sombra (a sombra fica numa camada que só muda a opacidade) */
  .mm-clone { margin: 0 !important; pointer-events: none; box-shadow: none !important; transform: translateY(var(--mm-dy, 0px)) scale(var(--mm-s, .97));
    transition: transform .24s cubic-bezier(.34,1.45,.64,1); }
  .mm-clone.rec { transform-origin: left center; } .mm-clone.env { transform-origin: right center; }
  .mm-clone::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 14px 36px rgba(4,18,31,.26), 0 2px 6px rgba(4,18,31,.12); opacity: 0; transition: opacity .2s ease; pointer-events: none; }
  html[data-tema="escuro"] .mm-clone::after { box-shadow: 0 14px 36px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3); }
  .mm-fundo.mm-aberto .mm-clone { --mm-s: 1.03; }
  .mm-fundo.mm-aberto .mm-clone::after { opacity: 1; }
  .mm-fundo.mm-saindo .mm-clone { --mm-s: 1; transition: transform .15s cubic-bezier(.4,0,.2,1); }
  .mm-fundo.mm-saindo .mm-clone::after { opacity: 0; transition-duration: .15s; }
  .mm-clone.mm-corta { overflow: hidden; -webkit-mask-image: linear-gradient(#000 calc(100% - 28px), transparent); mask-image: linear-gradient(#000 calc(100% - 28px), transparent); }
  .mm-clone .encaminhar, .mm-clone .mm-reacoes, .mm-clone .mm-seta { display: none !important; }
  /* pílula e cartão entram com mola curta e saem rápido */
  .mm-pilula.mm-entra, .mm-cartao.mm-entra { opacity: 0; transform: translateY(var(--mm-de, 8px)) scale(.82); transition: opacity .16s ease, transform .24s cubic-bezier(.34,1.56,.64,1); }
  .mm-cartao.mm-entra { --mm-de: -6px; transition-delay: .02s; }
  .mm-fundo.mm-aberto .mm-entra { opacity: 1; transform: none; }
  .mm-fundo.mm-saindo .mm-entra { opacity: 0; transform: scale(.92); transition: opacity .12s ease, transform .15s ease; transition-delay: 0s; }
  @media (prefers-reduced-motion: reduce) {
    .mm-veu, .mm-clone, .mm-clone::after, .mm-pilula.mm-entra, .mm-cartao.mm-entra, .mm-fundo.mm-saindo .mm-clone, .mm-fundo.mm-saindo .mm-entra { transition: none !important; }
    .mm-fundo.mm-aberto .mm-clone, .mm-fundo.mm-saindo .mm-clone { --mm-s: 1; }
    #msgs .bal.mm-segurando { transform: none; transition: none; }
  }

  .mm-pilula { display: flex; align-items: center; gap: 2px; padding: 5px 6px; border-radius: 999px; background: var(--fundo); box-shadow: 0 10px 34px rgba(4,18,31,.24); transform-origin: bottom center; }
  .mm-pilula button { all: unset; cursor: pointer; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-size: 26px; line-height: 1;
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; transition: transform .1s ease; }
  .mm-pilula button:focus-visible { background: var(--hover); transform: scale(1.12); }
  @media (hover: hover) { .mm-pilula button:hover { background: var(--hover); transform: scale(1.12); } }
  .mm-pilula button[aria-pressed="true"] { background: color-mix(in srgb, var(--marca-azul, #106ebe) 18%, transparent); }
  .mm-pilula .mm-mais { font-size: 0; color: var(--sub); background: var(--painel); }
  .mm-pilula .mm-mais svg { width: 22px; height: 22px; }
  @media (max-width: 380px) { .mm-pilula button { width: 36px; height: 36px; font-size: 23px; } }

  .mm-cartao { width: min(254px, calc(100vw - 16px)); border-radius: 14px; overflow: hidden; background: var(--fundo); box-shadow: 0 14px 44px rgba(4,18,31,.28); transform-origin: top center; color: var(--texto); }
  html[data-tema="escuro"] .mm-cartao, html[data-tema="escuro"] .mm-pilula { background: #0d2c4b; box-shadow: 0 14px 44px rgba(0,0,0,.45); }
  .mm-cartao.mm-largo { width: min(320px, calc(100vw - 16px)); }
  .mm-op { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 10px 16px;
    font: 400 16px/21px var(--fonte, inherit); color: var(--texto); border-bottom: 1px solid var(--linha); }
  .mm-op:last-child { border-bottom: 0; }
  .mm-op:focus-visible, .mm-op:active { background: var(--hover); }
  @media (hover: hover) { .mm-op:hover { background: var(--hover); } } /* no celular o toque não deixa a opção "acesa" */
  .mm-op svg { width: 21px; height: 21px; flex: none; color: var(--icone, var(--texto)); }
  .mm-op.mm-perigo, .mm-op.mm-perigo svg { color: #e5252a; }
  html[data-tema="escuro"] .mm-op.mm-perigo, html[data-tema="escuro"] .mm-op.mm-perigo svg { color: #ff6b6b; }
  .mm-op[aria-disabled="true"] { opacity: .5; cursor: default; }
  .mm-op small { display: block; font-size: 12.5px; line-height: 16px; color: var(--sub); }
  .mm-op .mm-txt { display: grid; text-align: left; }
  .mm-sep { height: 7px; background: var(--painel); border-bottom: 1px solid var(--linha); }
  @media (min-width: 761px) { .mm-op { min-height: 40px; padding: 8px 14px; font-size: 15px; } }
  .mm-cab { display: flex; align-items: center; gap: 6px; padding: 8px 8px 8px 6px; border-bottom: 1px solid var(--linha); font-weight: 600; font-size: 15px; }
  .mm-cab button { all: unset; cursor: pointer; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; color: var(--icone, var(--texto)); }
  .mm-cab button:hover { background: var(--hover); }
  .mm-cab button svg { width: 20px; height: 20px; }
  .mm-corpo { padding: 12px 14px; display: grid; gap: 10px; font-size: 14.5px; line-height: 20px; max-height: min(52vh, 420px); overflow-y: auto; }
  .mm-corpo .mm-linha { display: flex; justify-content: space-between; gap: 12px; }
  .mm-corpo .mm-linha span:first-child { color: var(--sub); }
  .mm-corpo .mm-linha span:last-child { text-align: right; font-weight: 500; }
  .mm-corpo textarea, .mm-corpo input { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 10px 12px; border-radius: 12px; border: 0; color: var(--texto); background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); resize: vertical; }
  .mm-corpo textarea:focus, .mm-corpo input:focus { outline: none; box-shadow: inset 0 0 0 1.5px var(--marca-azul, #106ebe); }
  .mm-corpo .mm-aviso { color: var(--sub); font-size: 13px; line-height: 18px; }
  .mm-corpo .mm-erro { color: #e5252a; font-size: 13.5px; }
  .mm-corpo .mm-traducao { white-space: pre-wrap; overflow-wrap: anywhere; padding: 10px 12px; border-radius: 12px; background: var(--painel); }
  .mm-botoes { display: flex; gap: 8px; }
  .mm-botoes button { all: unset; cursor: pointer; flex: 1; text-align: center; min-height: 42px; border-radius: 12px; font-weight: 600; font-size: 15px; background: var(--painel); color: var(--texto); }
  .mm-botoes button.mm-ok { background: var(--marca-gradiente, linear-gradient(135deg, #106ebe, #3aa0ff)); color: #fff; }
  .mm-botoes button:disabled { opacity: .6; cursor: default; }
  .mm-grade { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; padding: 8px; max-height: min(40vh, 260px); overflow-y: auto; touch-action: pan-y; }
  .mm-grade button { all: unset; cursor: pointer; aspect-ratio: 1; display: grid; place-items: center; border-radius: 10px; font-size: 24px; font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
  .mm-grade button:hover, .mm-grade button:focus-visible { background: var(--hover); }
  .mm-cartao.mm-grade-cartao { width: min(330px, calc(100vw - 16px)); }
  .mm-emo { display: grid; }
  .mm-emo-topo { padding: 8px 10px 4px; }
  .mm-emo-busca { all: unset; box-sizing: border-box; width: 100%; height: 38px; padding: 0 12px; border-radius: 12px; background: var(--hover); color: var(--texto); font-size: 15px; }
  .mm-emo-busca::placeholder { color: var(--sub); }
  .mm-emo-abas { display: flex; gap: 2px; padding: 2px 8px 4px; overflow-x: auto; scrollbar-width: none; }
  .mm-emo-abas[hidden] { display: none; }
  .mm-emo-abas button { all: unset; cursor: pointer; flex: none; width: 32px; height: 30px; display: grid; place-items: center; border-radius: 8px; font-size: 18px; font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
  .mm-emo-abas button:hover, .mm-emo-abas button:focus-visible { background: var(--hover); }
  .mm-grade.mm-emo-lista { max-height: min(42vh, 300px); padding-top: 0; }
  .mm-emo-tit { grid-column: 1 / -1; font-size: 12px; font-weight: 600; color: var(--sub); padding: 8px 4px 2px; position: sticky; top: 0; background: var(--fundo); z-index: 1; }
  .mm-emo-vazio { grid-column: 1 / -1; margin: 0; padding: 16px 6px; font-size: 14px; color: var(--sub); text-align: center; }

  /* ---------- no balão ---------- */
  #msgs .bal.mm-com-reacao { margin-bottom: 15px; }
  .mm-reacoes { position: absolute; bottom: -15px; display: inline-flex; align-items: center; gap: 1px; height: 24px; padding: 0 6px; border-radius: 999px; background: var(--recebida); box-shadow: 0 1px 3px rgba(11,20,26,.22), 0 0 0 1.5px var(--chat, var(--painel)); font-size: 14px; line-height: 1; cursor: pointer; white-space: nowrap;
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; z-index: 1; }
  .bal.rec .mm-reacoes { left: 10px; }
  .bal.env .mm-reacoes { right: 10px; }
  .mm-reacoes b { font: 600 12px/1 var(--fonte, inherit); color: var(--sub); margin-left: 3px; }
  .mm-reacoes.mm-minha { box-shadow: 0 1px 3px rgba(11,20,26,.22), 0 0 0 1.5px var(--marca-azul, #106ebe); }
  .mm-cit { display: block; margin: 0 0 5px -3px; padding: 5px 8px 6px 10px; border-radius: 6px; background: rgba(11,20,26,.06); border-left: 4px solid var(--cor-cit, #06cf9c); cursor: pointer; white-space: normal; overflow: hidden; }
  html[data-tema="escuro"] .mm-cit { background: rgba(0,0,0,.22); }
  .mm-cit b { display: block; font-size: 12.8px; line-height: 18px; font-weight: 600; color: var(--cor-cit, #06cf9c); }
  .mm-cit span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13.2px; line-height: 18px; color: var(--sub); }
  .mm-apagada { display: inline-flex; align-items: center; gap: 5px; font-style: italic; color: var(--sub); }
  .mm-apagada svg { width: 16px; height: 16px; flex: none; }
  .bal .meta .mm-editada { font-style: normal; margin-right: 2px; }
  .bal .meta .mm-fav { display: inline-flex; color: var(--sub); } .bal .meta .mm-fav svg { width: 12px; height: 12px; }
  #msgs .bal.mm-pisca { animation: mm-pisca 1.2s ease 1; }
  @keyframes mm-pisca { 0%, 100% { filter: none; } 25%, 60% { filter: brightness(.82); } }
  html[data-tema="escuro"] #msgs .bal.mm-pisca { animation-name: mm-pisca-e; }
  @keyframes mm-pisca-e { 0%, 100% { filter: none; } 25%, 60% { filter: brightness(1.35); } }

  /* ---------- faixas ---------- */
  .mm-fixada { display: flex; align-items: center; gap: 10px; padding: 7px 8px 7px 14px; border-bottom: 1px solid var(--vidro-borda, var(--linha)); background: var(--vidro-forte, var(--fundo)); cursor: pointer; flex: none; min-width: 0; position: relative; z-index: 2; }
  .mm-fixada[hidden] { display: none; }
  .mm-fixada svg { width: 18px; height: 18px; flex: none; color: var(--icone, var(--texto)); }
  .mm-fixada .mm-ft { display: grid; min-width: 0; flex: 1; }
  .mm-fixada .mm-ft b { font-size: 12.5px; font-weight: 600; color: var(--marca-azul, #106ebe); line-height: 16px; }
  html[data-tema="escuro"] .mm-fixada .mm-ft b { color: #0ffcbe; }
  .mm-fixada .mm-ft span { font-size: 14px; line-height: 19px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--texto); }
  .mm-fixada button { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: var(--sub); flex: none; }
  .mm-fixada button:hover { background: var(--hover); } .mm-fixada button svg { width: 18px; height: 18px; }
  .mm-resp { display: flex; align-items: center; gap: 6px; padding: 0 0 0 2px; }
  .mm-resp[hidden] { display: none; }
  .mm-resp .mm-cit { flex: 1; min-width: 0; margin: 0; cursor: default; background: var(--painel); }
  .mm-resp button { all: unset; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; }
  .mm-resp button:hover { background: var(--hover); } .mm-resp button svg { width: 20px; height: 20px; }
  .mm-clone .audio-extras button, .mm-clone .transcrever { white-space: nowrap; }
  .mm-favs { display: grid; margin: 0 -16px; }
  .mm-fav-it { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 3px; padding: 12px 16px; border-bottom: 1px solid var(--linha); }
  .mm-fav-it:hover { background: var(--hover); }
  .mm-fav-it b { font-size: 14.5px; font-weight: 600; } .mm-fav-it small { color: var(--sub); font-size: 12.5px; }
  .mm-fav-it span { font-size: 14.5px; line-height: 20px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .mm-vazio { padding: 30px 10px; text-align: center; color: var(--sub); }
  `;
  document.head.append(el('style', { id: 'mm-css', text: ESTILO }));

  // ------------------------------------------------------------ dados da conversa aberta
  const conversa = () => estado.detalhe?.conversa || null;
  const acoes = () => estado.detalhe?.acoes || {};
  const mensagem = (id) => (estado.detalhe?.mensagens || []).find((m) => m.id === id);
  const eu = () => estado.eu || {};
  const gestor = () => { try { return ui.ehGestor(eu()); } catch { return false; } };
  const mesmoNome = (a, b) => String(a || '').trim().toLocaleLowerCase('pt-BR') === String(b || '').trim().toLocaleLowerCase('pt-BR');
  const nomeAutor = (m) => m.autor === 'cliente' ? (conversa()?.nome || 'Cliente') : m.autor === 'ia' ? 'IA da Sintonia' : (mesmoNome(m.autorNome, eu().nome) ? 'Você' : (m.autorNome || 'Equipe'));
  const ROTULO_ANEXO = { imagem: '📷 Foto', audio: '🎤 Áudio', video: '🎥 Vídeo', documento: '📄 Documento', figurinha: 'Figurinha' };
  const trechoDe = (m) => (m.anexo ? (m.anexo.legenda || ROTULO_ANEXO[m.anexo.tipo] || m.texto) : m.texto) || '';
  const corCit = (autor) => autor === 'cliente' ? '#7f66ff' : autor === 'ia' ? '#0fbf96' : '#106ebe';
  const recarregar = async () => { estado.assinatura = ''; try { await ui.atualizar(); } catch {} };
  const quandoTxt = (d) => { const x = new Date(d); return `${x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${ui.hm(x)}`; };

  /** O que esta mensagem mostra no menu (o servidor confere de novo). */
  function possiveis(m, bal) {
    const A = acoes(); const canal = A.canal || {};
    const apagada = A.apagadas?.[m.id] || null;
    const minha = m.autor === 'equipe' && mesmoNome(m.autorNome, eu().nome);
    const mexe = gestor() || minha;
    const idade = Date.now() - new Date(m.em).getTime();
    const daLoja = m.autor === 'equipe' || m.autor === 'ia';
    const temWa = Boolean(m.idExterno);
    const temTexto = !m.anexo ? Boolean(m.texto) : Boolean(m.anexo.legenda);
    const transcrita = Boolean(bal?.querySelector('.transcricao:not(.aviso)'));
    return {
      apagada,
      reagir: !apagada,
      responder: !apagada,
      encaminhar: !apagada,
      copiar: !apagada && temTexto,
      editar: !apagada && !m.anexo && m.autor === 'equipe' && mexe && idade < (A.prazos?.editarMin ?? 15) * 60_000,
      nota: !apagada && temTexto,
      favoritar: !apagada,
      favorita: (A.favoritas || []).includes(m.id),
      fixada: A.fixada?.mensagemId === m.id,
      traduzir: !apagada && temTexto,
      rapida: !apagada && temTexto,
      transcrever: !apagada && (m.anexo?.tipo === 'audio' || m.anexo?.tipo === 'video') && !transcrita,
      apagarTodos: apagada !== 'todos' && apagada !== 'cliente' && daLoja && mexe && temWa && canal.apagar && idade < (A.prazos?.apagarHoras ?? 48) * 3600_000,
      apagarAqui: apagada !== 'aqui' && mexe,
      canal,
    };
  }

  // ------------------------------------------------------------ gesto: segurar
  const G = { timer: 0, bal: null, x: 0, y: 0, pid: null, engolirAte: 0, dedo: null, dedoAte: 0 };
  const cancelar = () => { clearTimeout(G.timer); G.timer = 0; G.bal?.classList.remove('mm-segurando'); G.bal = null; };
  msgs.addEventListener('pointerdown', (e) => {
    if (menu.aberto) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const bal = e.target.closest('#msgs .bal');
    if (!bal || !bal.dataset.id || e.target.closest('a[href], input, textarea, select, video[controls], .mm-reacoes, .mm-cit, .mm-seta')) return;
    cancelar();
    G.bal = bal; G.x = e.clientX; G.y = e.clientY; G.pid = e.pointerId;
    G.timer = setTimeout(() => {
      const alvo = G.bal; cancelar();
      if (!alvo || !alvo.isConnected) return;
      G.dedo = e.pointerId; G.dedoAte = Date.now() + 8000; // até este dedo sair da tela, nenhum clique conta (nem o que o soltar gera)
      try { if (e.pointerType === 'mouse') getSelection()?.removeAllRanges(); } catch {}
      try { navigator.vibrate?.(10); } catch {}
      abrirMenu(alvo);
    }, SEGURAR_MS);
    // um pouquinho antes de abrir, o balão afunda de leve (o dedo sente que "pegou")
    setTimeout(() => { if (G.bal === bal && G.timer) bal.classList.add('mm-segurando'); }, 120);
  });
  msgs.addEventListener('pointermove', (e) => {
    if (!G.timer || e.pointerId !== G.pid) return;
    if (Math.hypot(e.clientX - G.x, e.clientY - G.y) > ANDOU_PX) cancelar();
  }, { passive: true });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) msgs.addEventListener(t, (e) => { if (e.pointerId === G.pid) cancelar(); });
  msgs.addEventListener('scroll', cancelar, { passive: true });
  // botão direito (computador) e o "segurar" do Android/Chrome
  msgs.addEventListener('contextmenu', (e) => {
    const bal = e.target.closest('#msgs .bal');
    if (!bal || !bal.dataset.id || e.target.closest('a[href], input, textarea')) return;
    e.preventDefault();
    cancelar();
    if (menu.aberto) return;
    abrirMenu(bal);
  });
  // O clique que vem logo depois do segurar não faz mais nada (nem o "Ouvir/Copiar", nem tocar o áudio).
  document.addEventListener('click', (e) => {
    if ((G.dedo !== null && Date.now() < G.dedoAte) || Date.now() < G.engolirAte) { e.preventDefault(); e.stopPropagation(); G.engolirAte = 0; }
  }, true);
  const dedoSaiu = (e) => { if (e.pointerId === G.dedo) { G.dedo = null; G.engolirAte = Date.now() + 350; } };
  addEventListener('pointerup', dedoSaiu, true);
  addEventListener('pointercancel', dedoSaiu, true);

  // ------------------------------------------------------------ o menu
  const menu = { aberto: false, fundo: null, bal: null, m: null, clone: null, pilula: null, cartao: null, rTopo: 0, tecla: null };

  const calmo = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function fechar() {
    if (!menu.aberto) return;
    menu.aberto = false;
    const f = menu.fundo, clone = menu.clone, bal = menu.bal;
    removeEventListener('keydown', menu.tecla, true);
    removeEventListener('resize', fechar);
    const mostrarBalao = () => { bal?.classList.remove('mm-original'); msgs.querySelectorAll('.bal.mm-original').forEach((b) => b.classList.remove('mm-original')); };
    if (f) {
      // o balão volta (encolhendo) para o lugar de verdade dele, e o resto some em ~150 ms
      if (clone && bal?.isConnected) {
        const rb = bal.getBoundingClientRect();
        clone.style.transition = ''; clone.style.setProperty('--mm-dy', Math.round(rb.top - (parseFloat(clone.style.top) || 0)) + 'px');
      }
      f.classList.remove('mm-aberto'); f.classList.add('mm-saindo');
      setTimeout(() => { mostrarBalao(); f.remove(); }, calmo() ? 0 : 150);
    } else mostrarBalao();
    menu.fundo = menu.bal = menu.m = menu.clone = menu.pilula = menu.cartao = null;
  }

  function abrirMenu(bal) {
    const m = mensagem(bal.dataset.id);
    if (!m || menu.aberto) return;
    esconderSeta();
    window.SintoniaConversaExtras?.fecharAcoes?.();
    document.querySelectorAll('.bal-acoes').forEach((x) => { x.hidden = true; });
    menu.aberto = true; menu.bal = bal; menu.m = m;
    const r = bal.getBoundingClientRect();
    const fundo = el('div', { class: 'mm-fundo', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ações da mensagem' }, el('div', { class: 'mm-veu' }));
    const clone = bal.cloneNode(true);
    clone.classList.remove('mm-segurando', 'lendo', 'mm-pisca', 'mm-original'); clone.classList.add('mm-peca', 'mm-clone');
    clone.removeAttribute('data-id'); clone.setAttribute('aria-hidden', 'true');
    clone.style.width = r.width + 'px'; clone.style.maxWidth = 'none'; clone.style.left = r.left + 'px'; clone.style.top = r.top + 'px';
    const p = possiveis(m, bal);
    const pilula = p.reagir ? montarPilula(m) : null;
    const cartao = el('div', { class: 'mm-peca mm-cartao mm-entra', role: 'menu' });
    menu.fundo = fundo; menu.clone = clone; menu.pilula = pilula; menu.cartao = cartao; menu.rTopo = r.top; menu.r = r;
    preencher(cartao, opcoesPrincipais(m, p));
    fundo.append(clone, ...(pilula ? [pilula] : []), cartao);
    document.body.append(fundo);
    bal.classList.add('mm-original'); // o de verdade some: quem aparece é o clone, nítido por cima do desfoque
    posicionar(true);
    fundo.getBoundingClientRect();
    requestAnimationFrame(() => { if (menu.fundo === fundo) { clone.style.transition = ''; clone.style.setProperty('--mm-dy', '0px'); fundo.classList.add('mm-aberto'); } });
    // tocar fora (no fundo ou no balão) fecha; arrastar para baixo também
    const foraDoMenu = (t) => t === fundo || t.classList?.contains('mm-veu');
    fundo.addEventListener('click', (e) => { if (foraDoMenu(e.target) || e.target.closest('.mm-clone')) fechar(); });
    fundo.addEventListener('contextmenu', (e) => { e.preventDefault(); if (foraDoMenu(e.target)) fechar(); });
    arrastarParaFechar(fundo);
    menu.tecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); } };
    addEventListener('keydown', menu.tecla, true);
    addEventListener('resize', fechar);
    setTimeout(() => (pilula?.querySelector('button') || cartao.querySelector('button'))?.focus({ preventScroll: true }), 30);
  }

  /** Arruma pílula, balão e cartão na tela (o balão fica no lugar dele, ou sobe/desce o mínimo para caber). */
  function posicionar(primeira) {
    const { clone, pilula, cartao, r } = menu; if (!clone) return;
    const vw = innerWidth, vh = (window.visualViewport?.height || innerHeight);
    const borda = 10, gap = 8;
    const topoSeguro = Math.max(borda, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sat')) || 0) + 6;
    const ph = pilula ? pilula.offsetHeight : 0, pw = pilula ? pilula.offsetWidth : 0;
    const ch = cartao.offsetHeight, cw = cartao.offsetWidth;
    const espaco = vh - topoSeguro - borda - (pilula ? ph + gap : 0) - ch - gap;
    let bh = r.height;
    clone.classList.toggle('mm-corta', bh > espaco);
    if (bh > espaco) { bh = Math.max(56, espaco); clone.style.maxHeight = bh + 'px'; } else clone.style.maxHeight = '';
    const total = (pilula ? ph + gap : 0) + bh + gap + ch;
    let topo = r.top - (pilula ? ph + gap : 0);
    topo = Math.min(Math.max(topo, topoSeguro), vh - borda - total);
    const balTopo = topo + (pilula ? ph + gap : 0);
    const direita = menu.bal?.classList.contains('env');
    const lado = (w) => Math.min(Math.max(direita ? r.right - w : r.left, 8), vw - w - 8);
    if (pilula) { pilula.style.top = topo + 'px'; pilula.style.left = lado(pw) + 'px'; pilula.style.transformOrigin = direita ? 'bottom right' : 'bottom left'; }
    cartao.style.top = (balTopo + bh + gap) + 'px'; cartao.style.left = lado(cw) + 'px'; cartao.style.transformOrigin = direita ? 'top right' : 'top left';
    // O balão fica onde estava. Se o menu não cabe, a conversa rola o necessário (o balão de verdade acompanha)
    // e o clone desliza junto, do lugar antigo para o novo.
    clone.style.top = balTopo + 'px';
    if (primeira) {
      clone.style.transition = 'none'; clone.style.setProperty('--mm-dy', Math.round(r.top - balTopo) + 'px');
      if (Math.abs(balTopo - r.top) > 1) { try { msgs.scrollBy({ top: r.top - balTopo, behavior: calmo() ? 'auto' : 'smooth' }); } catch { msgs.scrollTop += r.top - balTopo; } }
    }
  }

  function arrastarParaFechar(fundo) {
    let y0 = null, dy = 0, pid = null;
    const pecas = () => [menu.clone, menu.pilula, menu.cartao].filter(Boolean);
    fundo.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('.mm-grade, .mm-corpo, textarea, input')) return;
      y0 = e.clientY; dy = 0; pid = e.pointerId;
    });
    fundo.addEventListener('pointermove', (e) => {
      if (y0 === null || e.pointerId !== pid) return;
      dy = Math.max(0, e.clientY - y0);
      if (dy < 6) return;
      for (const p of pecas()) { p.style.transition = 'none'; p.style.translate = `0 ${dy * 0.6}px`; }
      fundo.style.opacity = String(Math.max(0.35, 1 - dy / 320));
    });
    const soltar = () => {
      if (y0 === null) return;
      const fecha = dy > 90; y0 = null;
      if (fecha) { G.engolirAte = Date.now() + 500; fechar(); return; }
      for (const p of pecas()) { p.style.transition = 'translate .18s ease'; p.style.translate = ''; }
      fundo.style.opacity = '';
    };
    fundo.addEventListener('pointerup', soltar);
    fundo.addEventListener('pointercancel', soltar);
  }

  function montarPilula(m) {
    const minha = (acoes().reacoes?.[m.id] || []).find((x) => x.minha)?.emoji || null;
    const pil = el('div', { class: 'mm-peca mm-pilula mm-entra', role: 'group', 'aria-label': 'Reagir' });
    for (const emo of RAPIDOS) pil.append(el('button', { type: 'button', 'aria-label': 'Reagir com ' + emo, 'aria-pressed': String(minha === emo), text: emo, onclick: () => reagir(m, minha === emo ? null : emo) }));
    pil.append(el('button', { type: 'button', class: 'mm-mais', 'aria-label': 'Mais emojis', html: IC.mais2, onclick: () => grade(m, minha) }));
    return pil;
  }

  function preencher(cartao, filhos, classe = '') {
    cartao.className = 'mm-peca mm-cartao mm-entra' + (classe ? ' ' + classe : '');
    cartao.replaceChildren(...filhos.filter(Boolean));
    if (menu.aberto && menu.clone) posicionar(false);
  }
  const op = (rotulo, icone, acao, o = {}) => el('button', { type: 'button', role: 'menuitem', class: 'mm-op' + (o.perigo ? ' mm-perigo' : ''), onclick: acao, ...(o.desligado ? { 'aria-disabled': 'true' } : {}) },
    o.sub ? el('span', { class: 'mm-txt' }, el('span', { text: rotulo }), el('small', { text: o.sub })) : el('span', { text: rotulo }), el('i', { html: icone, style: 'display:contents' }));
  const cabecalho = (titulo, voltar) => el('div', { class: 'mm-cab' }, voltar ? el('button', { type: 'button', 'aria-label': 'Voltar', html: IC.voltar, onclick: voltar }) : null, el('span', { text: titulo }));

  function opcoesPrincipais(m, p) {
    if (p.apagada) {
      return [op('Dados', IC.dados, () => dados(m)), p.apagarAqui ? op('Apagar só daqui', IC.apagar, () => confirmarApagar(m, p), { perigo: true }) : null];
    }
    return [
      p.responder && op('Responder', IC.responder, () => { fechar(); responder(m); }),
      p.encaminhar && op('Encaminhar', IC.encaminhar, () => { fechar(); encaminhar(m); }),
      p.copiar && op('Copiar', IC.copiar, () => { fechar(); copiar(trechoDe(m)); }),
      p.editar && op('Editar', IC.editar, () => editar(m)),
      p.nota && op('Adicionar às notas', IC.nota, () => nota(m)),
      op('Dados', IC.dados, () => dados(m)),
      p.favoritar && op(p.favorita ? 'Tirar dos favoritos' : 'Favoritar', p.favorita ? ESTRELA_CHEIA : IC.estrela, () => favoritar(m, !p.favorita)),
      (p.apagarAqui || p.apagarTodos) && op('Apagar', IC.apagar, () => confirmarApagar(m, p), { perigo: true }),
      op('Mais…', IC.mais, () => maisOpcoes(m, p)),
    ];
  }
  function maisOpcoes(m, p) {
    preencher(menu.cartao, [
      cabecalho('Mais', () => preencher(menu.cartao, opcoesPrincipais(m, possiveis(m, menu.bal)))),
      op(p.fixada ? 'Desafixar' : 'Fixar', IC.fixar, () => fixar(m, !p.fixada), { sub: p.fixada ? 'Tira a faixa do topo' : 'Fica numa faixa no topo da conversa' }),
      p.traduzir && op('Traduzir', IC.traduzir, () => traduzir(m)),
      p.rapida && op('Adicionar resposta rápida', IC.rapida, () => respostaRapida(m)),
      p.transcrever && op('Transcrever', IC.transcrever, () => transcrever(m)),
      op('Mensagens favoritas', IC.lista, () => { fechar(); listaFavoritas(); }),
      (p.apagarAqui || p.apagarTodos) && op('Apagar', IC.apagar, () => confirmarApagar(m, p), { perigo: true }),
    ]);
  }

  // ------------------------------------------------------------ ações
  const urlMsg = (m, acao) => `/api/conversas/${m.conversaId || conversa()?.id}/mensagens/${m.id}/${acao}`;
  async function reagir(m, emoji) {
    fechar();
    // na hora, no balão (o servidor confirma em seguida)
    const A = estado.detalhe?.acoes; if (A) {
      const lista = (A.reacoes[m.id] || []).filter((x) => !x.minha);
      if (emoji) lista.push({ emoji, nome: eu().nome, minha: true, cliente: false });
      A.reacoes[m.id] = lista;
      const bal = msgs.querySelector(`.bal[data-id="${CSS.escape(m.id)}"]`); if (bal) desenharReacoes(bal, m);
    }
    try { const r = await post(urlMsg(m, 'reacao'), { emoji }); if (r?.aviso) toast(r.aviso); }
    catch (x) { toast(x.message); }
    recarregar();
  }
  /* Seletor com TODOS os emojis (dono 22/11): busca em português, categorias e "Usados por último".
   * Os dados (public/telas/emojis-dados.js, ~38 KB comprimido) só são baixados na primeira vez que abre. */
  let dadosEmoji = null;
  function carregarEmojis() {
    if (window.SintoniaEmojiDados) return Promise.resolve(window.SintoniaEmojiDados);
    if (dadosEmoji) return dadosEmoji;
    dadosEmoji = new Promise((ok, falha) => {
      const sc = document.createElement('script'); sc.src = '/telas/emojis-dados.js'; sc.async = true;
      sc.onload = () => ok(window.SintoniaEmojiDados || []); sc.onerror = () => { dadosEmoji = null; falha(new Error('Não deu para carregar os emojis.')); };
      document.head.append(sc);
    });
    return dadosEmoji;
  }
  const CHAVE_RECENTES = 'sintonia.emojis.recentes';
  const lerRecentes = () => { try { return JSON.parse(localStorage.getItem(CHAVE_RECENTES) || '[]').slice(0, 24); } catch { return []; } };
  const guardarRecente = (e) => { try { localStorage.setItem(CHAVE_RECENTES, JSON.stringify([e, ...lerRecentes().filter((x) => x !== e)].slice(0, 24))); } catch {} };
  const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const GRUPOS_EMOJI = [[0, '😀', 'Carinhas'], [1, '👋', 'Pessoas'], [3, '🐶', 'Animais e natureza'], [4, '🍔', 'Comida e bebida'], [5, '✈️', 'Viagens e lugares'], [6, '⚽', 'Atividades'], [7, '💡', 'Objetos'], [8, '❤️', 'Símbolos'], [9, '🏳️', 'Bandeiras']];
  function seletorEmoji({ marcado, escolher, aoCarregar }) {
    const busca = el('input', { type: 'search', class: 'mm-emo-busca', placeholder: 'Buscar emoji', 'aria-label': 'Buscar emoji', autocomplete: 'off', enterkeyhint: 'search' });
    const abas = el('div', { class: 'mm-emo-abas', role: 'tablist', 'aria-label': 'Categorias' });
    const lista = el('div', { class: 'mm-grade mm-emo-lista', role: 'group', 'aria-label': 'Emojis' });
    const botao = (emo, rot) => el('button', { type: 'button', text: emo, title: rot || '', 'aria-label': 'Escolher ' + emo, 'aria-pressed': String(marcado === emo), onclick: () => { guardarRecente(emo); escolher(emo); } });
    const titulo = (t, id) => el('div', { class: 'mm-emo-tit', id, text: t });
    let dados = [];
    const desenharTudo = () => {
      const filhos = [];
      const rec = lerRecentes();
      if (rec.length) filhos.push(titulo('Usados por último', 'mm-emo-g-r'), ...rec.map((e) => botao(e)));
      for (const [g, , nome] of GRUPOS_EMOJI) {
        const doGrupo = dados.filter((x) => x[0] === g); if (!doGrupo.length) continue;
        filhos.push(titulo(nome, 'mm-emo-g-' + g), ...doGrupo.map((x) => botao(x[1], x[2])));
      }
      lista.replaceChildren(...filhos);
    };
    const filtrar = () => {
      const q = semAcento(busca.value.trim());
      if (!q) { abas.hidden = false; desenharTudo(); return; }
      abas.hidden = true;
      const termos = q.split(/\s+/);
      const achados = dados.filter((x) => { const p = ' ' + x[2]; return termos.every((t) => p.includes(' ' + t)); }).slice(0, 240); /* pelo começo das palavras: "bolo" não acha "símbolo" */
      lista.replaceChildren(...(achados.length ? achados.map((x) => botao(x[1], x[2])) : [el('p', { class: 'mm-emo-vazio', text: 'Nenhum emoji com esse nome.' })]));
      lista.scrollTop = 0;
    };
    for (const [g, ic, nome] of GRUPOS_EMOJI) abas.append(el('button', { type: 'button', role: 'tab', text: ic, title: nome, 'aria-label': nome, onclick: () => { lista.querySelector('#mm-emo-g-' + g)?.scrollIntoView({ block: 'start' }); } }));
    busca.addEventListener('input', filtrar);
    lista.replaceChildren(el('p', { class: 'mm-emo-vazio', text: 'Carregando emojis…' }));
    carregarEmojis().then((d) => { dados = d; filtrar(); aoCarregar?.(); }).catch((x) => lista.replaceChildren(el('p', { class: 'mm-emo-vazio', text: x.message })));
    const caixa = el('div', { class: 'mm-emo' }, el('div', { class: 'mm-emo-topo' }, busca), abas, lista);
    caixa.focar = () => busca.focus({ preventScroll: true });
    return caixa;
  }
  window.SintoniaEmojis = { seletor: seletorEmoji, carregar: carregarEmojis };

  function grade(m, minha) {
    const sel = seletorEmoji({ marcado: minha, escolher: (emo) => reagir(m, minha === emo ? null : emo), aoCarregar: () => { if (menu.aberto && menu.clone) posicionar(false); } });
    preencher(menu.cartao, [
      cabecalho('Escolha um emoji', () => preencher(menu.cartao, opcoesPrincipais(m, possiveis(m, menu.bal)))),
      sel,
    ], 'mm-grade-cartao');
    /* no celular não abre o teclado sozinho (ele tamparia os emojis); no computador já dá para digitar */
    if (matchMedia('(hover: hover)').matches) sel.focar();
  }
  async function copiar(t) {
    try { await navigator.clipboard.writeText(t); toast('Copiado'); }
    catch { const a = el('textarea', { style: 'position:fixed;opacity:0' }); a.value = t; document.body.append(a); a.select(); try { document.execCommand('copy'); toast('Copiado'); } catch { toast('Não deu para copiar aqui.'); } a.remove(); }
  }

  // ---- Responder: faixa "Respondendo a…" acima do campo
  let resp = null; // { id, conversaId, m }
  const faixaResp = el('div', { class: 'mm-resp', hidden: '' });
  document.querySelector('.compor')?.prepend(faixaResp);
  function responder(m) {
    const c = conversa(); if (!c) return;
    resp = { id: m.id, conversaId: c.id };
    faixaResp.replaceChildren(citacaoEl(m, false), el('button', { type: 'button', 'aria-label': 'Não responder a esta mensagem', html: IC.fechar, onclick: () => limparResposta() }));
    faixaResp.hidden = false;
    const t = $('texto'); t?.focus();
  }
  let rolarAteFim = false;
  /** enviada = true: a resposta saiu; ao redesenhar, a conversa desce até ela (como no WhatsApp). */
  function limparResposta(enviada) { resp = null; faixaResp.hidden = true; faixaResp.replaceChildren(); if (enviada === true) rolarAteFim = true; }
  function citacaoEl(m, clicavel = true) {
    const b = el('span', { class: 'mm-cit', ...(clicavel ? { role: 'button', tabindex: '0', 'aria-label': 'Ir para a mensagem citada' } : {}) },
      el('b', { text: nomeAutor(m) }), el('span', { text: trechoDe(m) }));
    b.style.setProperty('--cor-cit', corCit(m.autor));
    return b;
  }

  // ---- Encaminhar: escolher outra conversa
  function encaminhar(m) {
    const ec = window.SintoniaConversa?.escolherContato;
    if (!ec) { toast('Não deu para abrir a lista de contatos.'); return; }
    ec({ titulo: 'Encaminhar para…', rotuloNovo: 'Novo contato', aoEscolher: async (c2) => {
      if (c2.id === conversa()?.id && !confirm('Encaminhar para a mesma conversa?')) return;
      try {
        const r = await post(urlMsg(m, 'encaminhar'), { para: c2.id });
        window.SintoniaPainel?.fechar?.();
        toast(r?.aviso ? r.aviso : `Encaminhada para ${ui.nomeDe(c2)} ✓`);
        recarregar();
      } catch (x) { toast(x.message); }
    } });
  }

  // ---- Editar
  function editar(m) {
    const caixa = el('textarea', { rows: '3', maxlength: '4096', 'aria-label': 'Texto novo' }); caixa.value = m.texto;
    const erro = el('div', { class: 'mm-erro', role: 'alert' });
    const salvar = el('button', { type: 'button', class: 'mm-ok', text: 'Salvar' });
    const canal = acoes().canal || {};
    const aviso = !m.idExterno ? 'Esta mensagem não está no WhatsApp: muda só aqui.' : canal.editar ? 'Muda também no WhatsApp da cliente (até 15 minutos depois de mandar).' : canal.tipo === 'meta' ? 'A API oficial do WhatsApp não deixa editar: muda só aqui, a cliente continua vendo o texto antigo.' : 'Este canal não edita: muda só aqui.';
    salvar.addEventListener('click', async () => {
      const t = caixa.value.trim(); if (!t) { erro.textContent = 'Escreva o texto.'; return; }
      salvar.disabled = true; erro.textContent = '';
      try { const r = await post(urlMsg(m, 'editar'), { texto: t }); fechar(); toast(r?.aviso || 'Mensagem editada ✓'); recarregar(); }
      catch (x) { erro.textContent = x.message; salvar.disabled = false; }
    });
    preencher(menu.cartao, [cabecalho('Editar mensagem', () => preencher(menu.cartao, opcoesPrincipais(m, possiveis(m, menu.bal)))),
      el('div', { class: 'mm-corpo' }, caixa, el('div', { class: 'mm-aviso', text: aviso }), erro, el('div', { class: 'mm-botoes' }, el('button', { type: 'button', text: 'Cancelar', onclick: fechar }), salvar))], 'mm-largo');
    setTimeout(() => { caixa.focus(); caixa.setSelectionRange(caixa.value.length, caixa.value.length); }, 30);
  }

  // ---- Notas da ficha
  async function nota(m) {
    fechar();
    try { await post(urlMsg(m, 'nota'), {}); toast('Foi para as observações da ficha ✓'); }
    catch (x) { toast(x.message); }
  }

  // ---- Dados
  const ENTREGA = { enviada: 'Enviada', entregue: 'Entregue', lida: 'Lida', falhou: 'Não entregue' };
  async function dados(m) {
    const corpo = el('div', { class: 'mm-corpo' }, el('div', { class: 'mm-aviso', text: 'Carregando…' }));
    preencher(menu.cartao, [cabecalho('Dados da mensagem', () => preencher(menu.cartao, opcoesPrincipais(m, possiveis(m, menu.bal)))), corpo], 'mm-largo');
    let d; try { d = await api(urlMsg(m, 'dados')); } catch (x) { corpo.replaceChildren(el('div', { class: 'mm-erro', text: x.message })); return; }
    if (!menu.aberto) return;
    const linha = (a, b) => b ? el('div', { class: 'mm-linha' }, el('span', { text: a }), el('span', { text: b })) : null;
    const loja = d.autor !== 'cliente';
    corpo.replaceChildren(...[
      linha('Quem mandou', d.autor === 'cliente' ? (d.autorNome || 'Cliente') : d.autorNome),
      linha(loja ? 'Enviada' : 'Recebida', quandoTxt(d.em)),
      loja && d.entrega ? linha(ENTREGA[d.entrega] || d.entrega, d.entregaEm ? quandoTxt(d.entregaEm) : 'sim') : null,
      loja && !d.entrega && d.noWhatsApp ? linha('Entrega', 'sem aviso do WhatsApp') : null,
      !d.noWhatsApp ? linha('WhatsApp', 'só na Sintonia') : null,
      d.editadaEm ? linha('Editada', `${quandoTxt(d.editadaEm)}${d.editadaPor ? ' · ' + d.editadaPor : ''}`) : null,
      d.apagada ? linha('Apagada', `${d.apagada === 'todos' ? 'para todos' : d.apagada === 'cliente' ? 'pela cliente' : 'só daqui'}${d.apagadaEm ? ' · ' + quandoTxt(d.apagadaEm) : ''}`) : null,
      ...(d.reacoes || []).map((r) => linha(r.emoji, r.nome || 'Cliente')),
    ].filter(Boolean));
    posicionar(false);
  }

  // ---- Favoritar
  async function favoritar(m, sim) {
    fechar();
    try { await post(urlMsg(m, 'favorito'), { favorito: sim }); toast(sim ? 'Nos favoritos ⭐' : 'Saiu dos favoritos'); recarregar(); }
    catch (x) { toast(x.message); }
  }
  async function listaFavoritas() {
    const lista = el('div', { class: 'mm-favs' }, el('div', { class: 'mm-vazio', text: 'Carregando…' }));
    window.SintoniaPainel?.abrir({ id: 'mensagens-favoritas', titulo: 'Mensagens favoritas', montar: (corpo) => corpo.append(lista) });
    let r; try { r = await api('/api/mensagens/favoritas'); } catch (x) { lista.replaceChildren(el('div', { class: 'mm-vazio', text: x.message })); return; }
    if (!r.length) { lista.replaceChildren(el('div', { class: 'mm-vazio', text: 'Nenhuma mensagem favorita ainda. Segure uma mensagem e toque em Favoritar.' })); return; }
    lista.replaceChildren(...r.map((f) => el('button', { type: 'button', class: 'mm-fav-it', onclick: () => { window.SintoniaPainel?.fechar?.(); irPara(f.conversaId, f.mensagemId); } },
      el('b', { text: f.nome || ui.formatarTel(f.telefone) }), el('span', { text: f.texto || ROTULO_ANEXO[f.tipo] || '' }),
      el('small', { text: `${f.autor === 'cliente' ? (f.nome || 'Cliente') : f.autor === 'ia' ? 'IA' : (f.autorNome || 'Equipe')} · ${quandoTxt(f.em)}` }))));
  }
  async function irPara(conversaId, mensagemId) {
    if (conversa()?.id !== conversaId) { ui.abrir(conversaId); for (let i = 0; i < 30 && conversa()?.id !== conversaId; i++) await new Promise((ok) => setTimeout(ok, 100)); await new Promise((ok) => setTimeout(ok, 400)); }
    piscar(mensagemId);
  }
  function piscar(id) {
    const bal = msgs.querySelector(`.bal[data-id="${CSS.escape(id)}"]`);
    if (!bal) { toast('Essa mensagem é antiga e não está carregada aqui.'); return; }
    bal.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    bal.classList.remove('mm-pisca'); void bal.offsetWidth; bal.classList.add('mm-pisca');
    setTimeout(() => bal.classList.remove('mm-pisca'), 1300);
  }

  // ---- Apagar (confirma antes)
  function confirmarApagar(m, p) {
    const fazer = async (modo) => {
      try { await post(urlMsg(m, 'apagar'), { modo }); fechar(); toast(modo === 'todos' ? 'Apagada para todos' : 'Apagada só daqui'); recarregar(); }
      catch (x) { fechar(); toast(x.message); }
    };
    const canal = p.canal || {};
    const semTodos = !p.apagarTodos && (m.autor === 'equipe' || m.autor === 'ia') && !p.apagada
      ? (!m.idExterno ? 'Não está no WhatsApp: só dá para apagar daqui.' : canal.tipo === 'meta' ? 'A API oficial do WhatsApp não apaga para todos.' : !canal.apagar ? 'Este canal não apaga para todos.' : (gestor() || mesmoNome(m.autorNome, eu().nome)) ? 'Passou o prazo do WhatsApp (2 dias) para apagar para todos.' : '')
      : '';
    preencher(menu.cartao, [
      cabecalho('Apagar mensagem?', () => preencher(menu.cartao, opcoesPrincipais(m, possiveis(m, menu.bal)))),
      p.apagarTodos && op('Apagar para todos', IC.apagar, () => fazer('todos'), { perigo: true, sub: 'Some também no WhatsApp da cliente' }),
      p.apagarAqui && op('Apagar só daqui', IC.apagar, () => fazer('aqui'), { perigo: true, sub: m.autor === 'cliente' ? 'Some só na Sintonia; a cliente continua vendo' : 'Some só na Sintonia; fica guardada no histórico' }),
      semTodos ? el('div', { class: 'mm-corpo' }, el('div', { class: 'mm-aviso', text: semTodos })) : null,
      op('Cancelar', IC.fechar, fechar),
    ], 'mm-largo');
  }

  // ---- Fixar
  async function fixar(m, sim) {
    fechar();
    try { await post(urlMsg(m, 'fixar'), { fixar: sim }); toast(sim ? 'Fixada no topo da conversa' : 'Desafixada'); recarregar(); }
    catch (x) { toast(x.message); }
  }

  // ---- Traduzir
  async function traduzir(m) {
    const corpo = el('div', { class: 'mm-corpo' }, el('div', { class: 'mm-aviso', text: 'Traduzindo…' }));
    preencher(menu.cartao, [cabecalho('Tradução', () => maisOpcoes(m, possiveis(m, menu.bal))), corpo], 'mm-largo');
    try {
      const r = await post(urlMsg(m, 'traduzir'), { para: 'pt' });
      if (!menu.aberto) return;
      corpo.replaceChildren(el('div', { class: 'mm-traducao', text: r.texto }), el('div', { class: 'mm-botoes' }, el('button', { type: 'button', text: 'Copiar', onclick: () => { copiar(r.texto); } }), el('button', { type: 'button', class: 'mm-ok', text: 'Fechar', onclick: fechar })));
    } catch (x) {
      if (!menu.aberto) return;
      corpo.replaceChildren(el('div', { class: 'mm-aviso', text: x.status === 501 || /Conexões/.test(x.message) ? 'A tradução usa a IA. Para ligar, a gestão coloca a chave da IA (Anthropic) em Mais › Conexões.' : x.message }));
    }
    posicionar(false);
  }

  // ---- Adicionar resposta rápida
  function respostaRapida(m) {
    const texto = trechoDe(m);
    const sugestao = '/' + (texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().match(/[a-z0-9]{3,}/)?.[0] || 'resposta').slice(0, 20);
    const atalho = el('input', { maxlength: '30', 'aria-label': 'Atalho', placeholder: '/atalho' }); atalho.value = sugestao;
    const caixa = el('textarea', { rows: '4', maxlength: '3000', 'aria-label': 'Texto da resposta' }); caixa.value = texto;
    const erro = el('div', { class: 'mm-erro', role: 'alert' });
    const salvar = el('button', { type: 'button', class: 'mm-ok', text: 'Criar' });
    salvar.addEventListener('click', async () => {
      salvar.disabled = true; erro.textContent = '';
      try { await post('/api/respostas-rapidas', { atalho: atalho.value, texto: caixa.value }); fechar(); toast('Resposta rápida criada ✓ Digite / no campo para usar.'); }
      catch (x) { erro.textContent = x.message; salvar.disabled = false; }
    });
    preencher(menu.cartao, [cabecalho('Nova resposta rápida', () => maisOpcoes(m, possiveis(m, menu.bal))),
      el('div', { class: 'mm-corpo' }, atalho, caixa, el('div', { class: 'mm-aviso', text: gestor() ? 'Fica para você. A da empresa toda se cria em Respostas rápidas.' : 'Fica só para você.' }), erro, el('div', { class: 'mm-botoes' }, el('button', { type: 'button', text: 'Cancelar', onclick: fechar }), salvar))], 'mm-largo');
    setTimeout(() => atalho.focus(), 30);
  }

  // ---- Transcrever (o botão do áudio já faz; aqui é o mesmo caminho)
  async function transcrever(m) {
    const bal = menu.bal; fechar();
    const botao = bal?.querySelector('.audio-extras .transcrever');
    if (botao) { botao.click(); return; }
    try { await post(`/api/conversas/${conversa()?.id}/midias/${m.id}/transcrever`, {}); toast('Transcrito ✓'); recarregar(); }
    catch (x) { toast(x.message); }
  }

  // ------------------------------------------------------------ desenho nos balões (gancho do desenharConversa)
  function desenharReacoes(bal, m) {
    bal.querySelector(':scope > .mm-reacoes')?.remove();
    const lista = acoes().reacoes?.[m.id] || [];
    bal.classList.toggle('mm-com-reacao', lista.length > 0);
    if (!lista.length) return;
    const unicos = [...new Set(lista.map((r) => r.emoji))].slice(0, 3);
    const chip = el('span', { class: 'mm-reacoes' + (lista.some((r) => r.minha) ? ' mm-minha' : ''), role: 'button', tabindex: '0', title: lista.map((r) => `${r.emoji} ${r.cliente ? (conversa()?.nome || 'Cliente') : (r.nome || 'Equipe')}`).join('\n'),
      'aria-label': `Reações: ${lista.map((r) => r.emoji).join(' ')}` }, document.createTextNode(unicos.join('')), lista.length > 1 ? el('b', { text: String(lista.length) }) : null);
    chip.addEventListener('click', (e) => { e.stopPropagation(); abrirMenu(bal); setTimeout(() => menu.aberto && dados(m), 0); });
    bal.append(chip);
  }
  function decorar(bal, m) {
    const A = acoes();
    if (!A || !m) return;
    const meta = bal.querySelector('.meta');
    const apagada = A.apagadas?.[m.id];
    if (apagada) {
      const manter = [...bal.children].filter((x) => x.classList.contains('autor'));
      bal.classList.remove('midia', 'so-midia', 'aud', 'fig', 'sem-sombra');
      bal.replaceChildren(...manter, el('span', { class: 'mm-apagada', html: IC.proibido }, document.createTextNode(apagada === 'cliente' ? 'A cliente apagou esta mensagem' : 'Mensagem apagada')), ...(meta ? [meta] : []));
      return;
    }
    const cit = A.citacoes?.[m.id];
    if (cit) {
      const alvo = { id: cit.id, autor: cit.autor, autorNome: cit.autorNome, texto: cit.apagada ? 'Mensagem apagada' : cit.texto, anexo: cit.tipo ? { tipo: cit.tipo, legenda: cit.texto } : null };
      if (cit.apagada) alvo.anexo = null;
      const b = citacaoEl(alvo);
      b.addEventListener('click', (e) => { e.stopPropagation(); piscar(cit.id); });
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') piscar(cit.id); });
      const autor = bal.querySelector(':scope > .autor');
      if (autor) autor.after(b); else bal.prepend(b);
    }
    if (meta && A.editadas?.[m.id]) meta.prepend(el('span', { class: 'mm-editada', text: 'Editada' }));
    if (meta && (A.favoritas || []).includes(m.id)) meta.prepend(el('span', { class: 'mm-fav', html: ESTRELA_CHEIA, title: 'Favorita' }));
    desenharReacoes(bal, m);
  }

  // ---- faixa da mensagem fixada (topo da conversa)
  const faixaFix = el('div', { class: 'mm-fixada', hidden: '', role: 'button', tabindex: '0', 'aria-label': 'Mensagem fixada: toque para ver' });
  ($('fx-faixa') || msgs).insertAdjacentElement($('fx-faixa') ? 'afterend' : 'beforebegin', faixaFix);
  faixaFix.addEventListener('click', (e) => { if (e.target.closest('button')) return; const f = acoes().fixada; if (f) piscar(f.mensagemId); });
  faixaFix.addEventListener('keydown', (e) => { if (e.key === 'Enter') faixaFix.click(); });
  function depois() {
    const c = conversa(); const f = acoes().fixada;
    if (resp && resp.conversaId !== c?.id) limparResposta();
    if (rolarAteFim) { rolarAteFim = false; requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; }); }
    if (!f || !c) { faixaFix.hidden = true; return; }
    const m = { autor: f.autor, autorNome: f.autorNome, texto: f.texto, anexo: f.tipo ? { tipo: f.tipo, legenda: f.texto } : null };
    faixaFix.replaceChildren(el('i', { html: IC.fixar, style: 'display:contents' }),
      el('span', { class: 'mm-ft' }, el('b', { text: 'Mensagem fixada' }), el('span', { text: trechoDe(m) })),
      el('button', { type: 'button', title: 'Desafixar', 'aria-label': 'Desafixar', html: IC.fechar, onclick: async () => { try { await post(`/api/conversas/${c.id}/mensagens/${f.mensagemId}/fixar`, { fixar: false }); toast('Desafixada'); recarregar(); } catch (x) { toast(x.message); } } }));
    faixaFix.hidden = false;
  }

  // conversa trocada: fecha o menu e a faixa de resposta
  new MutationObserver(() => { if (menu.aberto && menu.bal && !menu.bal.isConnected) { const novo = msgs.querySelector(`.bal[data-id="${CSS.escape(menu.m?.id || '')}"]`); if (novo) { menu.bal = novo; novo.classList.add('mm-original'); } else fechar(); } }).observe(msgs, { childList: true });

  // ---- setinha no canto do balão ao passar o mouse (computador), como no WhatsApp Web
  const seta = el('button', { type: 'button', class: 'mm-seta', title: 'Mais opções', 'aria-label': 'Abrir o menu da mensagem', html: tr('<path d="m7 10 5 5 5-5"/>') });
  function esconderSeta() { seta.classList.remove('mm-ver'); seta.remove(); }
  msgs.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || menu.aberto) return;
    const bal = e.target.closest?.('#msgs .bal');
    if (!bal || !bal.dataset.id || bal.querySelector(':scope > .mm-apagada')) { if (!e.target.closest?.('.mm-seta')) esconderSeta(); return; }
    if (seta.parentElement === bal) return;
    seta.classList.remove('mm-ver'); bal.append(seta);
    requestAnimationFrame(() => { if (seta.parentElement === bal) seta.classList.add('mm-ver'); });
  });
  msgs.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') esconderSeta(); });
  seta.addEventListener('pointerdown', (e) => e.stopPropagation());
  seta.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const bal = seta.parentElement; if (bal) abrirMenu(bal);
  });
  // Com o menu aberto, o dedo que ainda está na tela não rola a conversa por baixo (só as listas de dentro do menu rolam).
  document.addEventListener('touchmove', (e) => {
    if (menu.aberto && e.cancelable && !e.target.closest?.('.mm-grade, .mm-corpo, .mm-emo-abas')) e.preventDefault();
  }, { passive: false });

  window.SintoniaMenuMensagem = {
    decorar, depois, abrirMenu, fechar, listaFavoritas, limparResposta,
    /** Id da mensagem que está sendo respondida nesta conversa (ou null). */
    citando: () => (resp && resp.conversaId === conversa()?.id ? resp.id : null),
  };
})();
