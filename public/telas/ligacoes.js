/* Tela "Ligações" (como a aba Ligações do WhatsApp): window.SintoniaTelas.ligacoes = { desenhar(caixa, ui), recarregar() }.
 * Só o que é real: a ligação sai do celular (tel:); o app registra quem ligou e quando ("Efetuada", sem duração).
 * "Recebida" e "Perdida" só aparecem quando o WhatsApp (Evolution, evento CALL) avisa.
 * No computador não finge ligar: mostra o número para ligar pelo celular (copiar) e registra quando a pessoa confirma.
 * Texto do servidor sempre por textContent. Páginas extras (Teclado, Programar, Favoritos) no painel lateral.
 * ligacoes-modos: ao ligar, uma folha pergunta o jeito — Telefone (chip), WhatsApp (abre a conversa dela) ou
 * Linha da empresa (VoIP, travada "Em breve"). O app lembra o último jeito da pessoa (Conta › preferências, no servidor)
 * e, para quem nunca escolheu, vem marcado o padrão da unidade (Ligações › ⋯ › Configurar). Cada ligação guarda o jeito
 * usado (ícone no histórico). "Serena liga para reconfirmar" fica desenhada e travada (cartaoSerena, também em Automações). */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const SVG = {
    calendario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/><path d="M8 3v4M16 3v4M3 10h18M8 14h2M14 14h2M8 17h2"/></svg>',
    pontos: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    tel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    teclado: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="5" r="1.7"/><circle cx="12" cy="5" r="1.7"/><circle cx="18" cy="5" r="1.7"/><circle cx="6" cy="11" r="1.7"/><circle cx="12" cy="11" r="1.7"/><circle cx="18" cy="11" r="1.7"/><circle cx="6" cy="17" r="1.7"/><circle cx="12" cy="17" r="1.7"/><circle cx="18" cy="17" r="1.7"/><circle cx="12" cy="22" r="1.5"/></svg>',
    estrela: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z"/></svg>',
    estrelaCheia: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/></svg>',
    saiu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    chegou: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17M15 17H7V9"/></svg>',
    apagar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m12 9 6 6M18 9l-6 6"/></svg>',
    /* ligacoes-modos: ícones dos jeitos de ligar (traço 1.8, pontas arredondadas) */
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M9.3 8.2h1.2l.7 1.7-.9.6a4.8 4.8 0 0 0 2.6 2.6l.6-.9 1.7.7v1.2a.9.9 0 0 1-1 .9 6.4 6.4 0 0 1-5.8-5.8.9.9 0 0 1 .9-1Z"/></svg>',
    chip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/></svg>',
    voip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h3v5H5.5A1.5 1.5 0 0 1 4 17.5V14ZM20 14h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5V14Z"/><path d="M18.5 19c0 1.3-2.2 2.2-5 2.2"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    serena: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5l1.6 4.4 4.4 1.6-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6L10 3.5Z"/><path d="M17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/></svg>',
    certo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
  };
  const CSS = `
  .lg { width: 100%; min-width: 0; padding: 4px 0 90px; }
  /* layout-telas: no computador, lista larga de recentes à esquerda; ações, resumo do dia e programadas à direita */
  .lg-grade { display: block; }
  .lg-principal { min-width: 0; }
  .lg-resumo, .lg-prog { display: none; }
  @media (max-width: 760px) { .lg { max-width: 760px; margin: 0 auto; } }
  @media (min-width: 1100px) {
    .lg-grade { display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 380px); gap: 24px; align-items: start; }
    .lg-lado { grid-column: 2; grid-row: 1; display: grid; gap: 14px; position: sticky; top: 0; }
    .lg-principal { grid-column: 1; grid-row: 1; }
    .lg-lado .lg-acoes { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
    .lg-lado .lg-acao { grid-auto-flow: column; justify-content: start; align-items: center; text-align: left; gap: 10px; padding: 10px 12px; border-radius: 18px; background: var(--vidro-item) !important; box-shadow: inset 0 0 0 1px var(--vidro-borda) !important; color: var(--texto); font-weight: 600; }
    .lg-lado .lg-acao i { width: 40px; height: 40px; }
    .lg-lado .lg-acao i svg { width: 20px; height: 20px; }
    .lg-lado .lg-acao b { font-weight: 600; }
    .lg-lado .lg-acao small { grid-column: 2; }
    .lg-resumo, .lg-prog { display: grid; gap: 10px; padding: 16px; border-radius: 20px; background: var(--vidro-fundo, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)), var(--vidro-brilho, none); }
    .lg-resumo h3, .lg-prog h3 { margin: 0; font-size: 15px; font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .lg-resumo h3 small, .lg-prog h3 small { font-size: 12px; font-weight: 500; color: var(--sub); }
    .lg-nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .lg-nums div { padding: 10px 12px; border-radius: 14px; background: var(--vidro-item, rgba(13,34,64,.05)); }
    .lg-nums b { display: block; font-size: 24px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
    .lg-nums span { font-size: 12.5px; color: var(--sub); }
    .lg-nums .perdida b { color: #dc2626; } [data-tema="escuro"] .lg-nums .perdida b { color: #f87171; }
    .lg-prog .lg-linha { min-height: 52px; padding: 4px 0; }
    .lg-prog .lg-linha .avatar { width: 36px; height: 36px; }
    .lg-prog .lg-txt b { font-size: 14.5px; }
    .lg-prog .lg-txt small { font-size: 12.5px; }
    .lg-prog .lg-ligar { width: 36px; height: 36px; }
    .lg-prog .lg-mais { margin: 0; justify-self: start; padding: 4px 0; font-size: 13.5px; }
    .lg-principal .lg-cab { margin-top: 0; }
  }
  .lg-barra { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
  .lg-barra .icone.redondo { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
  .lg-barra .icone.redondo svg { width: 22px; height: 22px; }
  .lg h1.titulo-grande { margin: 6px 0 14px; }
  .lg-acoes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
  .lg-acao { all: unset; cursor: pointer; display: grid; justify-items: center; gap: 6px; padding: 12px 4px; border-radius: 18px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); font-size: 13px; font-weight: 650; color: var(--texto); text-align: center; }
  .lg-acao i { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--marca-azul, #106ebe); }
  .lg-acao i svg { width: 21px; height: 21px; }
  .lg-acao b { font-weight: 650; }
  .lg-acao small { display: block; font-size: 11.5px; font-weight: 700; color: var(--marca-azul); }
  [data-tema="escuro"] .lg-acao small { color: var(--marca-menta); }
  .lg-acao:focus-visible, .lg-linha:focus-visible, .lg-ligar:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .lg-cab { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 2px 6px; }
  .lg-cab h2 { margin: 0; font-size: 18px; }
  .lg-chips { display: flex; gap: 6px; }
  .lg-lista { border-radius: 18px; overflow: hidden; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .lg-linha { display: flex; align-items: center; gap: 12px; padding: 10px 12px; min-height: 64px; box-sizing: border-box; cursor: pointer; }
  .lg-linha + .lg-linha { border-top: 1px solid var(--linha); }
  .lg-linha:hover { background: var(--sel); }
  .lg-linha .avatar { width: 44px; height: 44px; flex: none; }
  .lg-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .lg-txt b { font-size: 16px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lg-txt b.perdida { color: #dc2626; } [data-tema="escuro"] .lg-txt b.perdida { color: #f87171; }
  .lg-txt small { font-size: 13px; color: var(--sub); display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lg-txt small svg { width: 14px; height: 14px; flex: none; }
  .lg-quando { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .lg-ligar { all: unset; cursor: pointer; flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--marca-azul); }
  [data-tema="escuro"] .lg-ligar { color: var(--marca-menta); }
  .lg-ligar:hover { background: var(--sel); }
  .lg-ligar svg { width: 21px; height: 21px; }
  .lg-vazio { padding: 26px 16px; text-align: center; color: var(--sub); font-size: 14.5px; }
  .lg-mais { all: unset; cursor: pointer; display: block; margin: 10px auto; padding: 10px 16px; border-radius: 999px; font-weight: 700; color: var(--marca-azul); }
  .lg-nota { font-size: 12.5px; color: var(--sub); margin: 10px 4px; line-height: 1.4; }
  /* teclado */
  .lg-visor { text-align: center; font-size: 32px; font-weight: 600; letter-spacing: .02em; min-height: 46px; margin: 12px 0 18px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .lg-teclas { display: grid; grid-template-columns: repeat(3, 76px); gap: 16px 26px; justify-content: center; }
  .lg-tecla { all: unset; cursor: pointer; width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; align-content: center; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--linha); font-size: 30px; font-weight: 500; color: var(--texto); }
  .lg-tecla small { font-size: 10px; letter-spacing: .14em; color: var(--sub); font-weight: 700; height: 12px; }
  .lg-tecla:active { background: var(--sel); }
  .lg-teclado-pe { display: grid; grid-template-columns: repeat(3, 76px); gap: 26px; justify-content: center; margin-top: 18px; align-items: center; }
  .lg-tecla.verde { background: #16a34a; color: #fff; box-shadow: none; }
  .lg-tecla.verde svg { width: 30px; height: 30px; }
  .lg-tecla.leve { background: transparent; box-shadow: none; }
  .lg-tecla.leve svg { width: 26px; height: 26px; color: var(--sub); }
  /* ligar pelo celular (computador) */
  .lg-pc { display: grid; gap: 14px; justify-items: center; text-align: center; padding: 10px 0; }
  .lg-pc .lg-num { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .lg-pc p { margin: 0; color: var(--sub); font-size: 14.5px; line-height: 1.45; max-width: 340px; }
  .lg-botoes { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .lg-botoes .botao { min-height: 46px; display: inline-flex; align-items: center; gap: 8px; padding: 0 20px; font-weight: 700; }
  .lg-botoes .botao svg { width: 18px; height: 18px; }
  .lg-form { display: grid; gap: 12px; }
  .lg-form label { display: grid; gap: 6px; font-size: 13.5px; color: var(--sub); }
  .lg-form input { font: inherit; font-size: 16px; color: var(--texto); background: var(--entrada); border: 1px solid var(--linha); border-radius: 12px; padding: 12px 14px; }
  .lg-sec { font-size: 12.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--sub); margin: 14px 4px 8px; }
  /* imperio: jeito do WhatsApp — só o círculo nos 4 botões, lista corrida sem cartão */
  .lg-acoes { gap: 4px; margin: 4px 0 22px; }
  .lg-acao { background: none !important; box-shadow: none !important; padding: 0; gap: 8px; font-size: 13.5px; font-weight: 400; color: var(--sub); }
  .lg-acao i { width: 62px; height: 62px; color: var(--texto); background: var(--vidro-item, rgba(13,34,64,.06)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); transition: transform .15s ease; }
  .lg-acao:active i { transform: scale(.94); }
  .lg-acao i svg { width: 25px; height: 25px; }
  .lg-acao b { font-weight: 400; }
  .lg-cab h2 { font-size: 21px; font-weight: 600; }
  .lg-lista { background: none !important; box-shadow: none !important; border-radius: 0; overflow: visible; }
  .lg-linha { padding: 9px 0; gap: 12px; }
  .lg-linha + .lg-linha { border-top: 0; }
  .lg-linha .lg-txt { align-self: stretch; align-content: center; border-bottom: 1px solid var(--linha); padding: 6px 0; }
  .lg-linha:last-child .lg-txt { border-bottom: 0; }
  .lg-linha:hover { background: none; }
  .lg-linha .avatar { width: 48px; height: 48px; }
  .lg-txt b { font-weight: 600; font-size: 16px; }
  .lg-linha .avatar { box-shadow: 0 0 0 2px var(--fundo, #fff), 0 0 0 3.5px rgba(15,252,190,.6) !important; border: 0 !important; }
  .lg-cab h2 { font-size: 18px; }
  .lg-quando { font-size: 14px; }
  .lg-ligar { width: 42px; height: 42px; color: var(--texto) !important; background: var(--vidro-item, rgba(13,34,64,.06)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  /* ligacoes-modos: folha "Como ligar?", selo Em breve, linha VoIP e Serena travadas */
  dialog.lg-folha { border: 0; color: var(--texto); max-height: min(92vh, 92dvh); overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; }
  dialog.lg-folha::backdrop { background: rgba(4, 12, 24, .45); }
  .lg-folha .lg-para { text-align: center; margin: -4px 0 12px; color: var(--sub); font-size: 14px; font-variant-numeric: tabular-nums; }
  .lg-folha .folha-lista button > svg { color: var(--marca-azul); }
  [data-tema="escuro"] .lg-folha .folha-lista button > svg { color: var(--marca-menta); }
  .lg-folha .folha-lista button { align-items: flex-start; }
  .lg-folha .folha-lista button > svg { margin-top: 2px; }
  .lg-folha .folha-lista button:hover:not([aria-disabled="true"]) { background: var(--sel); }
  .lg-folha .folha-lista button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: -2px; }
  .lg-folha .folha-lista small { font-size: 13.5px; line-height: 1.4; }
  .lg-folha .folha-lista b { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 600; }
  .lg-folha .folha-lista b > span { flex: none; display: inline-flex; gap: 0; }
  .lg-folha .folha-lista b > span:first-child { display: inline; }
  .lg-folha .folha-lista button[aria-disabled="true"] { cursor: not-allowed; }
  .lg-folha .folha-lista button[aria-disabled="true"] > svg, .lg-folha .folha-lista button[aria-disabled="true"] b > span:first-child { opacity: .55; }
  .lg-folha .lg-trava { width: 18px; height: 18px; flex: none; color: var(--sub); margin-top: 3px; }
  .lg-folha .lg-trava svg { width: 18px; height: 18px; }
  .lg-folha .lg-rodape { font-size: 12.5px; color: var(--sub); text-align: center; margin: 12px 8px 0; line-height: 1.4; }
  .lg-marca { font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; color: var(--marca-azul, #106ebe); background: rgba(16, 110, 190, .1); white-space: nowrap; }
  [data-tema="escuro"] .lg-marca { color: var(--marca-menta, #0ffcbe); background: rgba(15, 252, 190, .1); }
  .lg-breve { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; padding: 2px 9px; border-radius: 999px; color: #8a5a00; background: rgba(245, 166, 35, .16); white-space: nowrap; letter-spacing: .01em; }
  [data-tema="escuro"] .lg-breve { color: #fbbf5a; background: rgba(251, 191, 90, .14); }
  .lg-modo-ic { display: inline-flex; align-items: center; gap: 3px; }
  .lg-txt small .lg-modo-ic svg { width: 13px; height: 13px; }
  .lg-cartao { display: grid; gap: 12px; padding: 16px; border-radius: 20px; background: var(--vidro-fundo, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)), var(--vidro-brilho, none); color: var(--texto); }
  .lg-cartao-cab { display: flex; align-items: center; gap: 12px; }
  .lg-cartao-cab > i { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; flex: none; color: var(--marca-azul); background: rgba(16, 110, 190, .1); }
  [data-tema="escuro"] .lg-cartao-cab > i { color: var(--marca-menta); background: rgba(15, 252, 190, .1); }
  .lg-cartao-cab > i svg { width: 22px; height: 22px; }
  .lg-cartao-cab > div { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .lg-cartao-cab b { font-size: 16px; font-weight: 700; }
  .lg-cartao-cab > div > .lg-breve { justify-self: start; }
  .lg-cartao p { margin: 0; font-size: 14px; line-height: 1.45; color: var(--sub); }
  .lg-cartao h4 { margin: 4px 0 0; font-size: 12.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
  .lg-passos { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .lg-passos li { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; line-height: 1.4; }
  .lg-passos li svg { width: 19px; height: 19px; flex: none; margin-top: 1px; color: var(--marca-azul); }
  [data-tema="escuro"] .lg-passos li svg { color: var(--marca-menta); }
  .lg-campos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (max-width: 520px) { .lg-campos { grid-template-columns: 1fr; } }
  .lg-campos label { display: grid; gap: 5px; font-size: 13px; color: var(--sub); }
  .lg-campos input, .lg-campos select { font: inherit; font-size: 15px; color: var(--texto); background: var(--entrada, transparent); border: 1px solid var(--linha); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .lg-campos input:disabled, .lg-campos select:disabled, .lg-cartao .botao:disabled { opacity: .55; cursor: not-allowed; }
  .lg-faixa { display: flex; align-items: center; gap: 6px; }
  .lg-faixa select { flex: 1; }
  .lg-aviso { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 14px; font-size: 13.5px; line-height: 1.4; color: var(--texto); background: rgba(245, 166, 35, .1); box-shadow: inset 0 0 0 1px rgba(245, 166, 35, .28); }
  .lg-aviso svg { width: 18px; height: 18px; flex: none; color: #b7791f; margin-top: 1px; }
  [data-tema="escuro"] .lg-aviso svg { color: #fbbf5a; }
  .lg-cartao .lg-botoes { justify-content: flex-start; }
  .lg-unid { display: grid; gap: 8px; }
  .lg-unid-linha { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 0; border-top: 1px solid var(--linha); }
  .lg-unid-linha:first-child { border-top: 0; }
  .lg-unid-linha b { font-size: 14.5px; font-weight: 600; }
  .lg-seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--vidro-item, rgba(13,34,64,.06)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .lg-seg button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--sub); }
  .lg-seg button svg { width: 16px; height: 16px; }
  .lg-seg button[aria-pressed="true"] { background: var(--marca-azul, #106ebe); color: #fff; }
  [data-tema="escuro"] .lg-seg button[aria-pressed="true"] { background: #1d4f86; }
  .lg-seg button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 1px; }
  .lg-serena-mini { all: unset; cursor: pointer; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--vidro-fundo, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); color: var(--texto); }
  .lg-serena-mini > i { width: 38px; height: 38px; border-radius: 12px; display: grid; place-items: center; flex: none; color: var(--marca-azul); background: rgba(16, 110, 190, .1); }
  [data-tema="escuro"] .lg-serena-mini > i { color: var(--marca-menta); background: rgba(15, 252, 190, .1); }
  .lg-serena-mini > i svg { width: 21px; height: 21px; }
  .lg-serena-mini > span { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .lg-serena-mini b { font-size: 15px; font-weight: 650; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lg-serena-mini small { font-size: 13px; color: var(--sub); }
  .lg-serena-mini:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .lg-principal > .lg-serena-mini { margin-top: 14px; }
  @media (min-width: 1100px) { .lg-principal > .lg-serena-mini { display: none; } }
  @media (max-width: 1099px) { .lg-lado > .lg-serena-mini { display: none; } }
  .lg-config { display: grid; gap: 14px; }
  `;
  const s = { ui: null, caixa: null, filtro: 'todas', itens: [], proximo: null, sugestoes: null, carregando: false };
  const ehCelular = () => matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
  const P = () => window.SintoniaPainel;

  function estilo() {
    if (document.getElementById('ligacoes-css')) return;
    const st = document.createElement('style'); st.id = 'ligacoes-css'; st.textContent = CSS; document.head.append(st);
  }
  const telFmt = (t) => s.ui.formatarTel(String(t || ''));
  const telE164 = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 12 ? `+${d}` : d.length >= 10 ? `+55${d}` : d; };
  function relativo(d) {
    const x = new Date(d); const agora = new Date();
    const dia = (q) => { const c = new Date(q); c.setHours(0, 0, 0, 0); return c.getTime(); };
    if (dia(x) === dia(agora)) return x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (dia(x) === dia(agora) - 864e5) return 'ontem';
    if (agora - x < 6 * 864e5) return x.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  // ---------- ligar ----------
  /* ligacoes-modos: jeitos de ligar. 'voip' fica travado até o servidor dizer que há linha (GET /api/ligacoes/modos). */
  const MODOS = {
    telefone: { nome: 'Telefone', curto: 'Telefone', ic: SVG.chip, texto: () => ehCelular() ? 'Liga pelo chip do seu celular.' : 'Mostra o número para você ligar pelo seu celular.' },
    whatsapp: { nome: 'WhatsApp', curto: 'WhatsApp', ic: SVG.zap, texto: () => 'Abre o WhatsApp na conversa dela; toque no telefone de lá para ligar.' },
    voip: { nome: 'Linha da empresa (VoIP)', curto: 'VoIP', ic: SVG.voip, texto: () => 'Para ligar pela linha fixa da empresa pelo app. Precisa de uma linha com acesso SIP (Vivo, Claro, TIM ou outra operadora).' },
  };
  const TXT_SERENA = 'Precisa da linha VoIP da empresa e da voz da Serena. A gente libera quando estiver pronto.';
  const CHAVE_MODO = 'sintonia.modoLigacao';
  const lerLocal = () => { try { const v = localStorage.getItem(CHAVE_MODO); return v === 'telefone' || v === 'whatsapp' ? v : null; } catch { return null; } };
  let pedidoModos = null;
  /** Preferência da pessoa (servidor), padrão de cada unidade e o que está liberado. Carrega uma vez. */
  function infoModos() {
    const ui = s.ui;
    pedidoModos ||= Promise.all([
      ui.api('/api/conta').catch(() => null),
      ui.api('/api/unidades').catch(() => null),
      ui.api('/api/ligacoes/modos').catch(() => null),
    ]).then(([conta, unid, modos]) => ({
      meu: conta?.preferencias?.modoLigacao || null,
      unidades: (unid?.unidades || []).filter((u) => u.ativa !== false),
      podeEditar: Boolean(unid?.podeEditar),
      livres: new Set((modos?.modos || [{ id: 'telefone', disponivel: true }, { id: 'whatsapp', disponivel: true }]).filter((m) => m.disponivel).map((m) => m.id)),
      ligacoesIa: Boolean(modos?.ligacoesIa?.disponivel),
    }));
    return pedidoModos;
  }
  /** O jeito que vem marcado: o último da pessoa; se nunca escolheu, o padrão da unidade; senão, Telefone. */
  function modoMarcado(info, unidade) {
    const meu = info.meu || lerLocal();
    if (meu && info.livres.has(meu)) return { modo: meu, por: 'Último que você usou' };
    const un = unidade || s.ui.estado?.eu?.unidades?.[0];
    const daUnidade = info.unidades.find((u) => u.id === un)?.dados?.modoLigacao;
    if (daUnidade && info.livres.has(daUnidade)) return { modo: daUnidade, por: 'Padrão da unidade' };
    return { modo: 'telefone', por: '' };
  }
  /** Guarda o último jeito (no servidor, para valer em qualquer aparelho; e no aparelho, para abrir na hora). */
  function lembrarModo(modo) {
    try { localStorage.setItem(CHAVE_MODO, modo); } catch {}
    if (!pedidoModos) return;
    pedidoModos.then((info) => {
      if (info.meu === modo) return;
      info.meu = modo;
      s.ui.api('/api/conta', { method: 'PATCH', body: JSON.stringify({ preferencias: { modoLigacao: modo } }) }).catch(() => {});
    });
  }
  const abrirLink = (href, novaAba) => { const a = document.createElement('a'); a.href = href; a.rel = 'noopener'; if (novaAba) a.target = '_blank'; document.body.append(a); a.click(); a.remove(); };

  /** Folha "Como ligar?" (sobe de baixo no celular, centro no computador). aoEscolher(modo) roda no próprio toque
   * (o tel: e o WhatsApp precisam abrir no toque, senão o navegador bloqueia). */
  function escolherModo({ nome, telefone, unidade }, info, aoEscolher) {
    const el = s.ui.el;
    const marcado = modoMarcado(info, unidade);
    const d = el('dialog', { class: 'folha lg-folha', 'aria-label': 'Como ligar' });
    const fechar = () => d.close();
    const opcao = (id) => {
      const m = MODOS[id];
      const livre = info.livres.has(id);
      const titulo = el('b', {}, el('span', { text: m.nome }),
        !livre ? el('span', { class: 'lg-breve', text: 'Em breve' }) : null,
        livre && marcado.modo === id && marcado.por ? el('span', { class: 'lg-marca', text: marcado.por }) : null);
      const b = el('button', { type: 'button', html: m.ic, 'aria-disabled': livre ? null : 'true', 'data-modo': id,
        onclick: () => { if (!livre) { s.ui.toast('A linha da empresa (VoIP) chega em breve.'); return; } fechar(); lembrarModo(id); aoEscolher(id); } },
        el('span', {}, titulo, el('small', { text: m.texto() })),
        !livre ? el('i', { class: 'lg-trava', html: SVG.cadeado, 'aria-hidden': 'true' }) : null);
      if (!livre) b.setAttribute('aria-label', `${m.nome}: em breve`);
      return b;
    };
    d.append(
      el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: nome ? `Ligar para ${nome}` : 'Como ligar?' }),
        el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })),
      el('p', { class: 'lg-para', text: telFmt(telefone) }),
      el('div', { class: 'folha-lista', role: 'list' }, opcao('telefone'), opcao('whatsapp'), opcao('voip')),
      el('p', { class: 'lg-rodape', text: 'O app lembra o último jeito que você usou.' }));
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    d.querySelector(`[data-modo="${marcado.modo}"]`)?.focus();
  }

  /** Ligar para uma cliente (conversa) ou um número. Primeiro pergunta o jeito (Telefone, WhatsApp ou VoIP — travado).
   * Telefone: celular = tel: + registro; computador = mostra o número para ligar pelo celular.
   * WhatsApp: abre wa.me (o app no celular; WhatsApp Web/Desktop no computador) + registro. */
  async function ligar({ conversaId = null, telefone = '', nome = '', unidade = null } = {}) {
    const ui = s.ui;
    if (!String(telefone || '').replace(/\D/g, '')) { ui.toast('Este contato não tem telefone.'); return; }
    const info = await infoModos();
    escolherModo({ nome, telefone, unidade }, info, (modo) => executar(modo, { conversaId, telefone, nome }));
  }
  function executar(modo, { conversaId, telefone, nome }) {
    const ui = s.ui;
    const registrar = async () => {
      try { const r = await ui.post('/api/ligacoes/efetuada', conversaId ? { conversaId, modo } : { telefone, modo }); recarregar(); return r; } catch (x) { ui.toast(x.message); return null; }
    };
    const depois = async (espera) => {
      const r = await registrar();
      if (r && (r.conversaId || conversaId)) setTimeout(() => ui.abrirRegistroLigacao?.(r.conversaId || conversaId, window.SintoniaFone.rotulo(nome, telefone), r.id), espera);
      else if (r) ui.toast('Ligação registrada ✓');
    };
    if (modo === 'whatsapp') { abrirLink(`https://wa.me/${String(telE164(telefone)).replace(/\D/g, '')}`, true); depois(ehCelular() ? 900 : 1500); return; }
    if (ehCelular()) { abrirLink(`tel:${telE164(telefone)}`); depois(900); return; }
    const el = ui.el;
    const op = { id: 'ligar-pc', titulo: 'Ligar pelo celular', montar: (corpo) => {
      corpo.append(el('div', { class: 'lg-pc' },
        el('b', { text: nome || 'Número' }), el('span', { class: 'lg-num', text: telFmt(telefone) }),
        el('p', { text: 'A Sintonia não faz a ligação pelo computador. Ligue pelo seu celular e toque em “Liguei” para registrar.' }),
        el('div', { class: 'lg-botoes' },
          el('button', { class: 'botao leve', type: 'button', html: SVG.copiar, onclick: async () => { try { await navigator.clipboard.writeText(telE164(telefone)); ui.toast('Número copiado ✓'); } catch { ui.toast('Não deu para copiar aqui.'); } } }, document.createTextNode('Copiar número')),
          el('button', { class: 'botao', type: 'button', html: SVG.tel, onclick: async () => { P().fechar(); depois(300); } }, document.createTextNode('Liguei')))));
    } };
    if (P().aberto()) P().empurrar(op); else P().abrir(op);
  }
  const escolherELigar = (titulo = 'Nova ligação') => window.SintoniaConversa?.escolherContato?.({ titulo, rotuloNovo: 'Novo contato', aoEscolher: (c) => { P().fechar(); setTimeout(() => ligar({ conversaId: c.id, telefone: c.telefone, nome: s.ui.nomeDe(c), unidade: c.unidade }), 260); } });

  // ---------- teclado ----------
  function teclado() {
    const el = s.ui.el;
    let num = '';
    const visor = el('div', { class: 'lg-visor', 'aria-live': 'polite' });
    const mostrar = () => { visor.textContent = num ? telFmt(num.length >= 10 ? '55' + num : num) : ''; };
    const LETRAS = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '+' };
    const tecla = (d) => el('button', { type: 'button', class: 'lg-tecla', 'aria-label': String(d), onclick: () => { if (num.length < 15) num += d; mostrar(); } }, el('span', { text: String(d) }), el('small', { text: LETRAS[d] || '' }));
    const corpoTeclado = el('div', {}, visor,
      el('div', { class: 'lg-teclas' }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, '*', 0, '#'].map(tecla)),
      el('div', { class: 'lg-teclado-pe' }, el('span'),
        el('button', { type: 'button', class: 'lg-tecla verde', 'aria-label': 'Ligar', html: SVG.tel, onclick: () => { const d = num.replace(/\D/g, ''); if (d.length < 8) { s.ui.toast('Digite o número com DDD.'); return; } ligar({ telefone: d }); } }),
        el('button', { type: 'button', class: 'lg-tecla leve', 'aria-label': 'Apagar', html: SVG.apagar, onclick: () => { num = num.slice(0, -1); mostrar(); } })));
    const digitar = (e) => { if (/^[0-9*#]$/.test(e.key)) { num += e.key; mostrar(); } else if (e.key === 'Backspace') { num = num.slice(0, -1); mostrar(); } };
    P().abrir({ id: 'teclado', titulo: 'Teclado', montar: (corpo) => { corpo.append(corpoTeclado); addEventListener('keydown', digitar); }, aoFechar: () => removeEventListener('keydown', digitar) });
  }

  // ---------- favoritos ----------
  async function favoritos() {
    const ui = s.ui, el = ui.el;
    P().abrir({ id: 'favoritos', titulo: 'Favoritos', montar: async (corpo) => {
      const desenhar = async () => {
        let lista = [];
        try { lista = await ui.api('/api/ligacoes/favoritos'); } catch {}
        corpo.replaceChildren(
          lista.length ? el('div', { class: 'lg-lista' }, ...lista.map((f) => linhaContato({ id: f.conversaId, nome: f.nome, telefone: f.telefone, unidade: f.unidade }, async () => { await ui.post('/api/ligacoes/favoritos', { conversaId: f.conversaId, favorito: false }); desenhar(); })))
            : el('p', { class: 'lg-vazio', text: 'Nenhum favorito ainda. Adicione as clientes para quem você liga sempre.' }),
          el('button', { class: 'lg-mais', type: 'button', text: '+ Adicionar favorito', onclick: () => window.SintoniaConversa?.escolherContato?.({ titulo: 'Adicionar favorito', aoEscolher: async (c) => {
            try { await ui.post('/api/ligacoes/favoritos', { conversaId: c.id, favorito: true }); ui.toast('Favorito adicionado ⭐'); } catch (x) { ui.toast(x.message); }
            favoritos();
          } }) }),
          el('p', { class: 'lg-nota', text: 'Dica: na ficha da cliente também dá para marcar a estrela.' }));
      };
      corpo.append(el('p', { class: 'lg-vazio', text: 'Carregando…' }));
      desenhar();
    } });
  }
  function linhaContato(c, aoTirar) {
    const ui = s.ui, el = ui.el;
    return el('div', { class: 'lg-linha', role: 'button', tabindex: '0', onclick: () => ui.abrir(c.id) },
      ui.avatar({ id: c.id, nome: c.nome, telefone: c.telefone }),
      el('span', { class: 'lg-txt' }, el('b', { text: window.SintoniaFone.rotulo(c.nome, c.telefone) }), el('small', { text: `${telFmt(c.telefone)}${c.unidade ? ' · ' + (ui.UNIDADE[c.unidade] || c.unidade) : ''}` })),
      aoTirar ? el('button', { class: 'lg-ligar', type: 'button', title: 'Tirar dos favoritos', 'aria-label': 'Tirar dos favoritos', html: SVG.estrelaCheia, onclick: (e) => { e.stopPropagation(); aoTirar(); } }) : null,
      el('button', { class: 'lg-ligar', type: 'button', title: 'Ligar', 'aria-label': `Ligar para ${window.SintoniaFone.rotulo(c.nome, c.telefone)}`, html: SVG.tel, onclick: (e) => { e.stopPropagation(); ligar({ conversaId: c.id, telefone: c.telefone, nome: c.nome, unidade: c.unidade }); } }));
  }

  // ---------- programar (inclui o antigo "Ligar hoje" do CRM) ----------
  const MOTIVO = { lembrete: 'Programada', faltou: 'Faltou', interessada_sem_agendar: 'Interessada', nao_responde: 'Sumiu' };
  async function programar() {
    const ui = s.ui, el = ui.el;
    P().abrir({ id: 'programar', titulo: 'Programar', montar: async (corpo) => {
      corpo.append(el('p', { class: 'lg-vazio', text: 'Carregando…' }));
      let r = { sugestoes: [] };
      try { r = await ui.api('/api/ligacoes'); s.sugestoes = r.sugestoes; } catch {}
      const prog = r.sugestoes.filter((x) => x.motivo === 'lembrete');
      const outras = r.sugestoes.filter((x) => x.motivo !== 'lembrete');
      const linha = (x) => linhaContato({ id: x.conversaId, nome: x.cliente, telefone: x.telefone, unidade: x.unidade });
      const comMotivo = (x) => { const l = linha(x); l.querySelector('.lg-txt small').textContent = x.motivo === 'lembrete' ? `Programada · ${x.texto}` : x.texto; return l; };
      corpo.replaceChildren(
        el('div', { class: 'lg-botoes', style: 'justify-content:flex-start' }, el('button', { class: 'botao', type: 'button', html: SVG.relogio, onclick: () => window.SintoniaConversa?.escolherContato?.({ titulo: 'Programar ligação', aoEscolher: (c) => formProgramar(c) }) }, document.createTextNode('Programar ligação'))),
        el('div', { class: 'lg-sec', text: `Programadas para hoje (${prog.length})` }),
        prog.length ? el('div', { class: 'lg-lista' }, ...prog.map(comMotivo)) : el('p', { class: 'lg-vazio', text: 'Nenhuma ligação programada para hoje.' }),
        el('div', { class: 'lg-sec', text: `Para ligar (${outras.length})` }),
        outras.length ? el('div', { class: 'lg-lista' }, ...outras.map(comMotivo)) : el('p', { class: 'lg-vazio', text: 'Ninguém para ligar agora. Aqui aparecem quem faltou, quem se interessou e não agendou e quem parou de responder.' }));
    } });
  }
  function formProgramar(c) {
    const ui = s.ui, el = ui.el;
    const amanha = new Date(Date.now() + 3600_000); amanha.setMinutes(0, 0, 0);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const quando = el('input', { type: 'datetime-local', value: local(amanha), min: local(new Date()) });
    const texto = el('input', { maxlength: '200', placeholder: 'Ex.: confirmar o horário de sábado' });
    const erro = el('div', { class: 'erro-txt', role: 'alert' });
    const salvar = el('button', { class: 'botao', type: 'submit', text: 'Programar' });
    const form = el('form', { class: 'lg-form' }, el('b', { text: ui.nomeDe(c) }), el('label', {}, document.createTextNode('Quando'), quando), el('label', {}, document.createTextNode('Lembrete (opcional)'), texto), erro, el('div', { class: 'lg-botoes', style: 'justify-content:flex-end' }, salvar));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.textContent = '';
      const d = new Date(quando.value);
      if (Number.isNaN(d.getTime())) { erro.textContent = 'Escolha dia e hora.'; return; }
      salvar.disabled = true;
      try { await ui.post('/api/ligacoes/programar', { conversaId: c.id, quando: d.toISOString(), texto: texto.value.trim() || undefined }); ui.toast('Ligação programada ✓ Você recebe o lembrete na hora.'); programar(); }
      catch (x) { erro.textContent = x.message; } finally { salvar.disabled = false; }
    });
    P().empurrar({ id: 'programar-form', titulo: 'Programar ligação', montar: (corpo) => corpo.append(form) });
  }

  // ---------- ligacoes-modos: configurar (gestão), linha VoIP e Serena (travadas) ----------
  const selo = () => s.ui.el('span', { class: 'lg-breve', html: SVG.cadeado.replace('<svg ', '<svg width="12" height="12" ') }, document.createTextNode('Em breve'));
  const cab = (ic, titulo, sub) => s.ui.el('div', { class: 'lg-cartao-cab' }, s.ui.el('i', { html: ic }),
    s.ui.el('div', {}, s.ui.el('b', { text: titulo }), sub || null));

  /** Cartão "Linha VoIP (SIP)": os campos do futuro, todos desligados. Nada é guardado. */
  function cartaoVoip() {
    const el = s.ui.el;
    const campo = (rot, attrs = {}) => el('label', {}, document.createTextNode(rot), el('input', { disabled: '', 'aria-disabled': 'true', autocomplete: 'off', ...attrs }));
    return el('section', { class: 'lg-cartao', 'aria-label': 'Linha VoIP (SIP)' },
      cab(SVG.voip, 'Linha VoIP (SIP)', selo()),
      el('p', { text: MODOS.voip.texto() }),
      el('div', { class: 'lg-aviso', role: 'note' }, el('span', { html: SVG.cadeado }), el('span', { text: 'Em breve. Por enquanto nada aqui é salvo; a equipe liga pelo telefone ou pelo WhatsApp.' })),
      el('div', { class: 'lg-campos' },
        campo('Servidor SIP', { placeholder: 'ex.: sip.operadora.com.br' }),
        campo('Usuário', { placeholder: 'ex.: 7133334444' }),
        campo('Senha', { type: 'password', placeholder: '••••••••' }),
        campo('Número que aparece para o cliente', { placeholder: 'ex.: (71) 3333-4444' })),
      el('div', { class: 'lg-botoes' }, el('button', { class: 'botao', type: 'button', disabled: '', text: 'Salvar linha' })));
  }

  /** Cartão "Serena liga para reconfirmar": já desenhado, com os ajustes do futuro visíveis e desligados. */
  function cartaoSerena() {
    const el = s.ui.el;
    const fora = (rot, controle) => el('label', {}, document.createTextNode(rot), controle);
    const sel = (opcoes) => el('select', { disabled: '', 'aria-disabled': 'true' }, ...opcoes.map((t, i) => el('option', { text: t, selected: i === 0 ? '' : null })));
    const hora = (v) => sel([v]);
    return el('section', { class: 'lg-cartao lg-serena', 'aria-label': 'Serena liga para reconfirmar (em breve)' },
      cab(SVG.serena, 'Serena liga para reconfirmar', selo()),
      el('p', { text: 'A Serena liga para as clientes e confirma o horário marcado, sozinha.' }),
      el('h4', { text: 'O que ela vai fazer' }),
      el('ul', { class: 'lg-passos' }, ...[
        'Liga na véspera para confirmar o horário.',
        'Remarca na hora, se a cliente pedir.',
        'Avisa a equipe se ninguém atender ou se der algum problema.',
        'Anota o resumo da ligação no CRM.',
      ].map((t) => el('li', { html: SVG.certo }, el('span', { text: t })))),
      el('h4', { text: 'Ajustes (quando liberar)' }),
      el('div', { class: 'lg-campos' },
        fora('Quanto tempo antes', sel(['24 horas antes', '12 horas antes', '48 horas antes'])),
        fora('Horário das ligações', el('span', { class: 'lg-faixa' }, hora('9h'), document.createTextNode('às'), hora('19h'))),
        fora('Tentativas', sel(['2 tentativas', '1 tentativa', '3 tentativas'])),
        fora('Voz', sel(['Voz da Serena']))),
      el('div', { class: 'lg-aviso', role: 'note' }, el('span', { html: SVG.cadeado }), el('span', { text: TXT_SERENA })),
      el('div', { class: 'lg-botoes' }, el('button', { class: 'botao', type: 'button', disabled: '', text: 'Ligar a Serena' })));
  }
  function abrirSerena() {
    P().abrir({ id: 'lg-serena', titulo: 'Ligações da Serena', montar: (corpo) => corpo.append(cartaoSerena()) });
  }
  /** Atalho na tela Ligações (no computador fica na coluna da direita; no celular, embaixo da lista). */
  const serenaMini = () => {
    const el = s.ui.el;
    return el('button', { class: 'lg-serena-mini', type: 'button', onclick: abrirSerena, 'aria-label': 'Ligações da Serena: em breve' },
      el('i', { html: SVG.serena }),
      el('span', {}, el('b', {}, el('span', { text: 'Ligações da Serena' }), el('span', { class: 'lg-breve', text: 'Em breve' })),
        el('small', { text: 'Ela liga na véspera para reconfirmar os horários.' })),
      el('span', { html: SVG.saiu, style: 'width:18px;height:18px;display:grid;color:var(--sub);flex:none;transform:rotate(45deg)' }));
  };

  /** Ligações › ⋯ › Configurar ligações (gestão): padrão de cada unidade, linha VoIP e Serena. */
  async function configurar() {
    const ui = s.ui, el = ui.el;
    P().abrir({ id: 'lg-config', titulo: 'Configurar ligações', montar: async (corpo) => {
      corpo.append(el('p', { class: 'lg-vazio', text: 'Carregando…' }));
      pedidoModos = null;
      const info = await infoModos();
      const linhas = info.unidades.map((u) => {
        const seg = el('div', { class: 'lg-seg', role: 'group', 'aria-label': `Jeito de ligar padrão: ${u.nome}` });
        const desenharSeg = () => seg.replaceChildren(...['telefone', 'whatsapp'].map((id) => el('button', { type: 'button', html: MODOS[id].ic, 'aria-pressed': String((u.dados?.modoLigacao || 'telefone') === id), disabled: info.podeEditar ? null : '',
          onclick: async () => {
            if ((u.dados?.modoLigacao || 'telefone') === id) return;
            try {
              const r = await ui.api(`/api/unidades/${encodeURIComponent(u.id)}`, { method: 'PATCH', body: JSON.stringify({ modoLigacao: id, ativa: u.ativa !== false }) });
              u.dados = r.dados || { ...u.dados, modoLigacao: id }; desenharSeg(); ui.toast(`${u.nome}: ${MODOS[id].nome} ✓`);
            } catch (x) { ui.toast(x.message); }
          } }, document.createTextNode(MODOS[id].curto))));
        desenharSeg();
        return el('div', { class: 'lg-unid-linha' }, el('b', { text: u.nome }), seg);
      });
      corpo.replaceChildren(el('div', { class: 'lg-config' },
        el('section', { class: 'lg-cartao', 'aria-label': 'Jeito de ligar de cada unidade' },
          cab(SVG.tel, 'Jeito de ligar de cada unidade'),
          el('p', { text: 'Vem marcado para quem ainda não escolheu. Na hora de ligar, cada pessoa pode trocar; o app lembra o último jeito que ela usou.' }),
          linhas.length ? el('div', { class: 'lg-unid' }, ...linhas) : el('p', { text: 'Nenhuma unidade cadastrada.' }),
          info.podeEditar ? null : el('p', { text: 'Só a direção e a administração mudam o padrão das unidades.' })),
        cartaoVoip(),
        cartaoSerena()));
    } });
  }

  // ---------- tela ----------
  function menu(botao) {
    const ui = s.ui, el = ui.el;
    document.getElementById('lg-menu')?.remove();
    const m = el('div', { class: 'menu-lista', id: 'lg-menu', role: 'menu', style: 'position:absolute;z-index:30;left:0;top:52px' },
      el('button', { role: 'menuitem', type: 'button', html: SVG.relogio, onclick: () => { m.remove(); programar(); } }, el('span', { text: 'Ligações programadas' })),
      /* ligacoes-modos */
      ui.ehGestor?.(ui.estado?.eu) ? el('button', { role: 'menuitem', type: 'button', html: SVG.ajustes, onclick: () => { m.remove(); configurar(); } }, el('span', { text: 'Configurar ligações' })) : null,
      el('button', { role: 'menuitem', type: 'button', html: SVG.serena, onclick: () => { m.remove(); abrirSerena(); } }, el('span', { text: 'Ligações da Serena' })),
      el('button', { role: 'menuitem', type: 'button', html: SVG.apagar, onclick: async () => { m.remove(); if (!confirm('Limpar o seu histórico de ligações? A equipe continua vendo.')) return; await ui.post('/api/ligacoes/limpar', {}); ui.toast('Histórico limpo ✓'); recarregar(); } }, el('span', { text: 'Limpar histórico' })));
    botao.parentElement.style.position = 'relative';
    botao.parentElement.append(m);
    setTimeout(() => document.addEventListener('click', function fora(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', fora); } }), 0);
  }

  function linhaChamada(x) {
    const ui = s.ui, el = ui.el;
    const nome = window.SintoniaFone.rotulo(x.cliente, x.telefone);
    const dir = { efetuada: ['Efetuada', SVG.saiu], recebida: ['Recebida', SVG.chegou], perdida: ['Perdida', SVG.chegou] }[x.direcao] || ['', ''];
    const RES = { atendeu: 'atendeu', nao_atendeu: 'não atendeu', agendou: 'agendou', caixa_postal: 'caixa postal' };
    const extra = [RES[x.resultado], x.unidade ? (ui.UNIDADE[x.unidade] || x.unidade) : null, x.atendente].filter(Boolean).join(' · ');
    const small = el('small', { html: dir[1] }); small.append(document.createTextNode(dir[0]));
    /* ligacoes-modos: por onde foi (Telefone, WhatsApp ou VoIP), com o ícone pequeno */
    const m = MODOS[x.modo];
    if (m) small.append(document.createTextNode(' · '), el('span', { class: 'lg-modo-ic', title: `Pelo ${m.curto}`, html: m.ic }, document.createTextNode(m.curto)));
    if (extra) small.append(document.createTextNode(' · ' + extra));
    return el('div', { class: 'lg-linha', role: 'button', tabindex: '0', title: x.conversaId ? 'Abrir a conversa' : '', onclick: () => { if (x.conversaId) ui.abrir(x.conversaId); },
      onkeydown: (e) => { if (e.key === 'Enter' && x.conversaId) ui.abrir(x.conversaId); } },
      ui.avatar({ id: x.conversaId || x.id, nome: x.cliente, telefone: x.telefone }),
      el('span', { class: 'lg-txt' }, el('b', { class: x.direcao === 'perdida' ? 'perdida' : '', text: nome }), small),
      el('span', { class: 'lg-quando', text: relativo(x.em) }),
      el('button', { class: 'lg-ligar', type: 'button', title: 'Ligar de volta', 'aria-label': `Ligar para ${nome}`, html: SVG.tel, onclick: (e) => { e.stopPropagation(); ligar({ conversaId: x.conversaId, telefone: x.telefone, nome: x.cliente || '', unidade: x.unidade }); } }));
  }

  function desenhar() {
    const ui = s.ui, el = ui.el;
    if (!s.caixa) return;
    const btMenu = el('button', { class: 'icone redondo', type: 'button', title: 'Mais opções', 'aria-label': 'Mais opções das ligações', html: SVG.pontos, onclick: (e) => { e.stopPropagation(); menu(e.currentTarget); } });
    const btNovo = el('button', { class: 'icone redondo branco', type: 'button', title: 'Nova ligação', 'aria-label': 'Nova ligação', html: SVG.mais, onclick: () => escolherELigar() });
    const prog = (s.sugestoes || []).filter((x) => x.motivo === 'lembrete').length;
    const acao = (rot, ic, fn, extra) => el('button', { class: 'lg-acao', type: 'button', onclick: fn }, el('i', { html: ic }), el('b', { text: rot }), extra ? el('small', { text: extra }) : null);
    const chip = (v, rot) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(s.filtro === v), onclick: () => { s.filtro = v; s.itens = []; s.proximo = null; carregar(); } }, document.createTextNode(rot));
    const lista = s.itens.length ? el('div', { class: 'lg-lista', role: 'list' }, ...s.itens.map(linhaChamada))
      : el('p', { class: 'lg-vazio', text: s.carregando ? 'Carregando…' : s.filtro === 'perdidas' ? 'Nenhuma ligação perdida.' : 'Nenhuma ligação ainda. Toque em Ligar para começar.' });
    // layout-telas: resumo de hoje (das ligações já carregadas) e as programadas para hoje — só aparecem no computador.
    const hoje = new Date().toDateString();
    const deHoje = s.itens.filter((x) => new Date(x.em).toDateString() === hoje);
    const conta = (f) => deHoje.filter(f).length;
    const num = (n, rot, cls = '') => el('div', { class: cls }, el('b', { text: String(n) }), el('span', { text: rot }));
    const resumo = el('section', { class: 'lg-resumo', 'aria-label': 'Resumo de hoje' },
      el('h3', {}, document.createTextNode('Hoje'), el('small', { text: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' }) })),
      el('div', { class: 'lg-nums' },
        num(conta((x) => x.direcao === 'efetuada'), 'efetuadas'),
        num(conta((x) => x.resultado === 'atendeu' || x.resultado === 'agendou'), 'atenderam'),
        num(conta((x) => x.resultado === 'agendou'), 'agendaram'),
        num(conta((x) => x.direcao === 'perdida'), 'perdidas', 'perdida')));
    const progLista = (s.sugestoes || []).filter((x) => x.motivo === 'lembrete');
    const progBox = el('section', { class: 'lg-prog', 'aria-label': 'Programadas para hoje' },
      el('h3', {}, document.createTextNode('Programadas para hoje'), el('small', { text: String(progLista.length) })),
      progLista.length ? el('div', { class: 'lg-lista' }, ...progLista.slice(0, 5).map((x) => linhaContato({ id: x.conversaId, nome: x.cliente, telefone: x.telefone, unidade: x.unidade })))
        : el('p', { class: 'lg-nota', style: 'margin:0', text: 'Nenhuma ligação programada para hoje.' }),
      el('button', { class: 'lg-mais', type: 'button', text: progLista.length > 5 ? `Ver todas (${progLista.length})` : 'Programar ligação', onclick: programar }));
    s.caixa.replaceChildren(el('div', { class: 'lg' },
      el('div', { class: 'lg-barra' }, btMenu, el('span', { style: 'display:flex;align-items:center;gap:10px' }, window.SintoniaTopoGrupo ? window.SintoniaTopoGrupo() : null, btNovo)),
      el('h1', { class: 'titulo-grande', text: 'Ligações' }),
      el('div', { class: 'lg-grade' },
        el('aside', { class: 'lg-lado' },
          el('div', { class: 'lg-acoes' },
            acao('Ligar', SVG.tel, () => escolherELigar('Ligar')),
            acao('Programar', SVG.calendario, programar, prog ? `${prog} hoje` : ''),
            acao('Teclado', SVG.teclado, teclado),
            acao('Favoritos', SVG.estrela, favoritos)),
          s.filtro === 'todas' ? resumo : null, progBox, serenaMini()),
        el('div', { class: 'lg-principal' },
          el('div', { class: 'lg-cab' }, el('h2', { text: 'Ligações recentes' }), el('div', { class: 'lg-chips', role: 'group', 'aria-label': 'Filtro' }, chip('todas', 'Todas'), chip('perdidas', 'Perdidas'))),
          lista,
          s.proximo ? el('button', { class: 'lg-mais', type: 'button', text: 'Carregar mais', onclick: () => carregar(true) }) : null,
          serenaMini(),
          el('p', { class: 'lg-nota', text: 'Efetuadas: registradas quando alguém toca em Ligar (pelo telefone ou pelo WhatsApp; sem duração). Recebidas e perdidas: avisadas pelo WhatsApp da loja.' })))));
  }

  async function carregar(mais = false) {
    const ui = s.ui; if (!ui) return;
    s.carregando = true; if (!mais) desenhar();
    try {
      const q = new URLSearchParams({ filtro: s.filtro, limite: '30' });
      if (mais && s.proximo) q.set('antes', s.proximo);
      const [r, sug] = await Promise.all([ui.api('/api/ligacoes/historico?' + q), mais ? Promise.resolve(null) : ui.api('/api/ligacoes').catch(() => null)]);
      s.itens = mais ? s.itens.concat(r.itens) : r.itens; s.proximo = r.proximo;
      if (sug) s.sugestoes = sug.sugestoes;
    } catch (x) { ui.toast(x.message); }
    finally { s.carregando = false; if (s.caixa?.isConnected) desenhar(); }
  }
  function recarregar() { if (s.caixa?.isConnected && s.caixa.offsetParent !== null) carregar(); }

  window.SintoniaTelas.ligacoes = {
    async desenhar(caixa, ui) { estilo(); s.ui = ui; s.caixa = caixa; await carregar(); },
    recarregar, ligar: (o) => { if (!s.ui) s.ui = window.Sintonia?.ui; estilo(); return ligar(o); }, favoritos: () => { s.ui ||= window.Sintonia?.ui; estilo(); return favoritos(); },
    /* ligacoes-modos: o cartão travado "Serena liga para reconfirmar" (também na tela Automações) */
    cartaoSerena: (ui) => { s.ui ||= ui || window.Sintonia?.ui; estilo(); return cartaoSerena(); },
  };
})();
