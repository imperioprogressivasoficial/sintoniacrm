/* Tela "ia" da Sintonia: registra window.SintoniaTelas.ia = { desenhar(caixa, ui) }.
 * O que a IA fez hoje, quem ela está conduzindo, o comportamento dela, o treinamento e um teste.
 * Todo texto que vem do servidor entra por textContent (el(..., { text })), nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const MARCA_PENDENTE = '[PREENCHER';
  const DESCRICAO_MODO = {
    humano: 'Você escreve e envia. A IA fica quieta.',
    copiloto: 'A IA sugere a resposta; você revisa e envia.',
    ia: 'A IA responde sozinha e chama a equipe quando precisa.',
  };
  const MINUTOS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

  // Ícones (texto fixo nosso, nunca dado do servidor).
  const SVG = {
    brilho: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" opacity=".75"/></svg>',
    seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87z"/></svg>',
    chave: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    cadeado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  const CSS = `
  #ia.iax-caixa { display: block; }
  .iax-tela { max-width: 1180px; margin: 0 auto; display: grid; gap: 22px; }
  .iax-topo { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .iax-topo .titulo-grande { margin: 2px 0 0; }
  .iax-estado { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: var(--sub); background: var(--fundo); border: 1px solid var(--linha); border-radius: 999px; padding: 6px 12px; }
  .iax-estado i { width: 8px; height: 8px; border-radius: 50%; background: var(--sub); }
  .iax-estado.ligada { color: var(--texto); }
  .iax-estado.ligada i { background: var(--marca-menta); box-shadow: 0 0 8px rgba(253, 110, 110, .9); }
  .iax-colunas { display: grid; gap: 22px; }
  .iax-coluna { display: contents; }
  .iax-bloco { display: grid; gap: 10px; min-width: 0; align-content: start; }
  .iax-o1 { order: 1; } .iax-o2 { order: 2; } .iax-o3 { order: 3; } .iax-o4 { order: 4; } .iax-o5 { order: 5; }
  @media (min-width: 1100px) {
    .iax-colunas { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); align-items: start; }
    .iax-coluna { display: grid; gap: 22px; align-content: start; }
  }
  .iax-cab { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 4px; }
  .iax-cab h2 { margin: 0; font-size: 20px; font-weight: 750; letter-spacing: -.01em; flex: 1; min-width: 0; }
  .iax-cab .iax-conta { font-size: 14px; color: var(--sub); font-weight: 600; }
  .iax-sub { margin: -4px 4px 0; font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .iax-cartao { background: var(--fundo); border-radius: 16px; overflow: hidden; border: 1px solid var(--linha); }
  .iax-cartao > :last-child, .iax-cartao > :last-child .corpo { border-bottom: 0 !important; }
  #ia .iax-cartao .item { padding-left: 14px; }
  #ia .iax-cartao .item:last-child .corpo { border-bottom: 0; }
  #ia .iax-cartao .item { height: auto; min-height: 76px; }
  #ia .iax-cartao .item .corpo { padding-top: 10px; padding-bottom: 10px; }
  .iax-unid { font-size: 12.5px; color: var(--sub); opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* destaque "Hoje a IA" (usa .ia-destaque do app) */
  .iax-hoje { position: relative; overflow: hidden; }
  .iax-hoje .iax-icone-hoje { position: absolute; right: 16px; top: 16px; width: 30px; height: 30px; color: var(--marca-menta); filter: drop-shadow(0 0 10px rgba(253, 110, 110,.8)); }
  .iax-hoje .iax-icone-hoje svg { width: 100%; height: 100%; }
  .iax-hoje b { font-size: 30px; line-height: 1.12; }
  .iax-nums { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (min-width: 560px) { .iax-nums { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .iax-num { background: var(--fundo); border: 1px solid var(--linha); border-radius: 16px; padding: 13px 14px; display: grid; gap: 2px; min-width: 0; }
  .iax-num b { font-size: 26px; font-weight: 750; letter-spacing: -.02em; line-height: 1.15; white-space: nowrap; }
  .iax-num span { font-size: 13px; color: var(--sub); line-height: 1.3; }
  .iax-num.alerta b { color: var(--marca-azul); }
  @media (prefers-color-scheme: dark) { .iax-num.alerta b { color: var(--marca-menta); text-shadow: 0 0 14px rgba(253, 110, 110,.45); } }

  /* linhas simples tocáveis (agendamentos, pedidos de ajuda, seções, perguntas) */
  .iax-linha { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; border-bottom: 1px solid var(--linha); min-height: 56px; }
  .iax-linha:hover { background: var(--hover); }
  .iax-linha[aria-disabled="true"] { cursor: default; }
  .iax-linha[aria-disabled="true"]:hover { background: none; }
  .iax-linha .iax-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .iax-linha .iax-txt b { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .iax-linha .iax-txt span { font-size: 14px; color: var(--sub); line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
  .iax-linha .iax-lado { font-size: 13px; color: var(--sub); white-space: nowrap; flex: none; text-align: right; }
  .iax-linha > .iax-seta { width: 18px; height: 18px; color: var(--sub); flex: none; opacity: .7; }
  .iax-linha > .iax-seta svg { width: 100%; height: 100%; }
  .iax-marcador { width: 34px; height: 34px; border-radius: 10px; flex: none; display: grid; place-items: center; font-size: 15px; font-weight: 700; color: #fff; }
  .iax-marcador svg { width: 18px; height: 18px; }
  .iax-marcador.agenda { background: var(--marca-gradiente); }
  .iax-marcador.ajuda { background: #e26b2c; }
  .iax-titulo-lista { padding: 10px 14px 4px; font-size: 12.5px; font-weight: 700; color: var(--sub); text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid var(--linha); }
  .iax-cartao + .iax-cartao { margin-top: 0; }

  /* contador de pendências [PREENCHER] */
  .iax-pend { flex: none; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 9px; background: var(--badge); color: var(--badge-txt); box-shadow: 0 0 10px rgba(253, 110, 110, .5); white-space: nowrap; }
  .iax-ok { flex: none; font-size: 12px; font-weight: 600; color: var(--sub); white-space: nowrap; }
  .iax-faixa { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--chip-ativo); color: var(--chip-ativo-txt); font-size: 14px; line-height: 1.4; border: 1px solid rgba(253, 110, 110, .35); }
  .iax-faixa b { font-weight: 750; }
  .iax-faixa .iax-pend { font-size: 13px; }

  /* aviso "IA desligada" */
  .iax-alerta { display: flex; gap: 14px; align-items: flex-start; padding: 16px; border-radius: 18px; background: var(--fundo); border: 1px solid var(--linha); box-shadow: var(--brilho-azul); }
  .iax-alerta .iax-alerta-ic { width: 42px; height: 42px; border-radius: 12px; flex: none; display: grid; place-items: center; background: var(--marca-gradiente); color: #fff; }
  .iax-alerta .iax-alerta-ic svg { width: 22px; height: 22px; }
  .iax-alerta .iax-txt { display: grid; gap: 6px; flex: 1; min-width: 0; }
  .iax-alerta b { font-size: 17px; }
  .iax-alerta p { margin: 0; font-size: 14px; color: var(--sub); line-height: 1.45; }
  .iax-alerta .botao { justify-self: start; margin-top: 4px; }

  /* comportamento */
  .iax-modo { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--linha); }
  .iax-modo:hover { background: var(--hover); }
  .iax-modo[aria-disabled="true"] { cursor: default; }
  .iax-modo[aria-disabled="true"]:hover { background: none; }
  .iax-modo .iax-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .iax-modo b { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .iax-modo b i { width: 8px; height: 8px; border-radius: 50%; background: var(--sub); flex: none; }
  .iax-modo[data-m="ia"] b i { background: var(--marca-menta); box-shadow: 0 0 8px rgba(253, 110, 110, .9); }
  .iax-modo[data-m="copiloto"] b i { background: #5ec4ff; }
  .iax-modo .iax-txt > span { font-size: 13.5px; color: var(--sub); line-height: 1.35; }
  .iax-marca { width: 22px; height: 22px; border-radius: 50%; flex: none; border: 2px solid var(--linha); box-sizing: border-box; }
  .iax-modo[aria-checked="true"] .iax-marca { border: 0; background: var(--marca-gradiente); box-shadow: 0 0 10px rgba(253, 110, 110,.5); display: grid; place-items: center; }
  .iax-modo[aria-checked="true"] .iax-marca::after { content: "✓"; color: #fff; font-size: 13px; font-weight: 800; }
  .iax-opcao { display: flex; align-items: center; gap: 12px; padding: 13px 14px; border-bottom: 1px solid var(--linha); }
  .iax-opcao .iax-txt { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .iax-opcao b { font-size: 16px; font-weight: 600; }
  .iax-opcao .iax-txt > span { font-size: 13.5px; color: var(--sub); line-height: 1.35; }
  .iax-minutos { display: inline-flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 14px; color: var(--sub); }
  .iax-minutos select { font: inherit; font-size: 14px; font-weight: 600; color: var(--texto); background: var(--painel); border: 1px solid var(--linha); border-radius: 10px; padding: 5px 8px; }
  .iax-minutos select:disabled { opacity: .7; }
  .iax-int { all: unset; cursor: pointer; flex: none; width: 51px; height: 31px; border-radius: 999px; background: var(--linha); position: relative; transition: background .2s, box-shadow .2s; }
  .iax-int::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,.25); transition: transform .2s; }
  .iax-int[aria-checked="true"] { background: var(--marca-gradiente); box-shadow: 0 0 12px rgba(253, 110, 110, .45); }
  .iax-int[aria-checked="true"]::after { transform: translateX(20px); }
  .iax-int[aria-disabled="true"] { cursor: default; opacity: .65; }
  .iax-int:focus-visible { outline: 2px solid var(--verde); outline-offset: 2px; }
  .iax-tags { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px 14px; }
  .iax-tag { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; border-radius: 999px; padding: 4px 10px; background: var(--painel); color: var(--texto); }
  .iax-tag i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .iax-tag small { color: var(--sub); font-size: 12px; }
  .iax-nota { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-size: 13px; color: var(--sub); }
  .iax-nota svg { width: 15px; height: 15px; flex: none; }

  /* botões pequenos */
  .iax-acao { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; color: var(--marca-azul); padding: 6px 12px; border-radius: 999px; background: var(--fundo); border: 1px solid var(--linha); white-space: nowrap; }
  @media (prefers-color-scheme: dark) { .iax-acao { color: var(--marca-menta); } }
  .iax-acao:hover { background: var(--hover); }
  .iax-acao svg { width: 16px; height: 16px; }
  .iax-novo { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; gap: 10px; padding: 13px 14px; font-size: 15px; font-weight: 600; color: var(--marca-azul); }
  @media (prefers-color-scheme: dark) { .iax-novo { color: var(--marca-menta); } }
  .iax-novo:hover { background: var(--hover); }
  .iax-novo svg { width: 18px; height: 18px; }

  /* vazio, erro, carregando */
  .iax-vazio { padding: 22px 18px; text-align: center; color: var(--sub); font-size: 14px; line-height: 1.45; display: grid; gap: 4px; justify-items: center; }
  .iax-vazio b { color: var(--texto); font-size: 15px; font-weight: 600; }
  .iax-erro { padding: 16px; display: grid; gap: 10px; justify-items: start; font-size: 14px; color: var(--texto); }
  .iax-erro span { color: var(--sub); }
  .iax-esq { border-radius: 16px; background: linear-gradient(90deg, var(--fundo) 0%, var(--hover) 50%, var(--fundo) 100%); background-size: 200% 100%; animation: iax-brilho 1.3s ease-in-out infinite; border: 1px solid var(--linha); }
  @keyframes iax-brilho { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  @media (prefers-reduced-motion: reduce) { .iax-esq { animation: none; } }

  /* testar a IA */
  .iax-teste { display: flex; flex-direction: column; }
  .iax-teste-cab { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--linha); flex-wrap: wrap; }
  .iax-teste-cab select, .iax-teste-cab input { font: inherit; font-size: 14px; color: var(--texto); background: var(--painel); border: 1px solid var(--linha); border-radius: 10px; padding: 7px 10px; min-width: 0; }
  .iax-teste-cab input { flex: 1; min-width: 120px; }
  .iax-selo { display: flex; align-items: center; gap: 8px; padding: 8px 14px; font-size: 12.5px; color: var(--aviso-txt); background: var(--aviso); }
  .iax-selo svg { width: 14px; height: 14px; flex: none; }
  .iax-chat { display: flex; flex-direction: column; gap: 2px; padding: 12px 16px 14px; min-height: 240px; max-height: 460px; overflow-y: auto; background-color: var(--chat); background-image: radial-gradient(var(--textura) 1px, transparent 1px); background-size: 14px 14px; }
  .iax-chat .bal { max-width: 82%; }
  .iax-chat .bal.env .autor { color: var(--ia); }
  .iax-chat-vazio { margin: auto; text-align: center; color: var(--sub); font-size: 13.5px; line-height: 1.45; max-width: 300px; display: grid; gap: 6px; justify-items: center; }
  .iax-chat-vazio .iax-ic { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--marca-gradiente); box-shadow: var(--brilho-menta); }
  .iax-chat-vazio .iax-ic svg { width: 22px; height: 22px; }
  .iax-sugestoes { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 6px; }
  .iax-acoes-ia { align-self: flex-end; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; margin: 5px 0 6px; max-width: 86%; }
  .iax-acoes-ia span { display: inline-flex; align-items: flex-start; gap: 6px; font-size: 12.5px; line-height: 1.35; padding: 5px 10px; border-radius: 12px; background: var(--fundo); color: var(--texto); border: 1px solid rgba(253, 110, 110, .45); box-shadow: 0 0 10px rgba(253, 110, 110, .18); }
  .iax-acoes-ia span::before { content: "✦"; color: var(--ia); }
  .iax-aviso-chat { align-self: center; background: var(--aviso); color: var(--aviso-txt); font-size: 13px; line-height: 1.4; padding: 7px 12px; border-radius: 10px; box-shadow: var(--sombra); margin: 8px 0; text-align: center; max-width: 92%; }
  .iax-digitando { align-self: flex-end; display: inline-flex; gap: 4px; padding: 11px 13px; border-radius: 12px; background: var(--enviada); box-shadow: var(--sombra); margin-top: 8px; }
  .iax-digitando i { width: 7px; height: 7px; border-radius: 50%; background: var(--sub); animation: iax-pula 1.1s infinite ease-in-out; }
  .iax-digitando i:nth-child(2) { animation-delay: .15s; } .iax-digitando i:nth-child(3) { animation-delay: .3s; }
  @keyframes iax-pula { 0%, 60%, 100% { transform: translateY(0); opacity: .5; } 30% { transform: translateY(-4px); opacity: 1; } }
  .iax-compor { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--linha); background: var(--fundo); }
  .iax-compor textarea { flex: 1; min-width: 0; resize: none; border: 0; outline: 0; font: inherit; font-size: 16px; line-height: 21px; color: var(--texto); background: var(--painel); border-radius: 20px; padding: 10px 14px; max-height: 120px; }
  .iax-compor textarea:disabled { opacity: .6; }
  .iax-enviar { all: unset; cursor: pointer; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--marca-gradiente); color: #fff; box-shadow: var(--brilho-azul); }
  .iax-enviar svg { width: 20px; height: 20px; }
  .iax-enviar[disabled] { opacity: .45; cursor: default; box-shadow: none; }

  /* folhas (dialog) */
  dialog.iax-folha { padding: 0; width: min(520px, calc(100vw - 24px)); border-radius: 18px; }
  dialog.iax-folha .iax-folha-corpo { padding: 20px; display: grid; gap: 14px; }
  dialog.iax-folha h2 { margin: 0; font-size: 19px; font-weight: 700; }
  dialog.iax-folha p { margin: 0; color: var(--sub); font-size: 14.5px; line-height: 1.45; }
  dialog.iax-folha label { display: grid; gap: 6px; font-size: 13.5px; color: var(--sub); }
  .iax-campo { font: inherit; font-size: 16px; color: var(--texto); background: var(--entrada); border: 1px solid var(--linha); border-radius: 12px; padding: 11px 13px; width: 100%; box-sizing: border-box; }
  .iax-campo:focus { outline: 2px solid var(--marca-azul); outline-offset: -1px; }
  textarea.iax-campo { resize: vertical; line-height: 1.45; }
  .iax-rodape { display: flex; align-items: center; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
  .iax-rodape .iax-espaco { flex: 1; }
  .iax-perigo { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; color: #e5484d; font-size: 14px; font-weight: 600; padding: 8px 4px; }
  .iax-perigo svg { width: 17px; height: 17px; }
  .iax-msg-erro { color: #e5484d; font-size: 13.5px; min-height: 0; }
  .iax-msg-erro:empty { display: none; }
  .botao.ds-primario[disabled], .botao[disabled] { opacity: .55; cursor: default; }

  /* editor de seção em tela cheia */
  dialog.iax-editor { padding: 0; margin: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; display: none; flex-direction: column; background: var(--fundo); }
  dialog.iax-editor[open] { display: flex; }
  @media (min-width: 761px) { dialog.iax-editor { margin: auto; width: min(900px, calc(100vw - 48px)); height: min(880px, calc(100dvh - 48px)); border-radius: 20px; border: 1px solid var(--linha); box-shadow: 0 24px 70px rgba(0,0,0,.35); } }
  .iax-ed-topo { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--linha); padding-top: calc(10px + env(safe-area-inset-top)); }
  .iax-ed-topo h2 { margin: 0; font-size: 17px; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .iax-ed-topo .iax-esq-btn { justify-self: start; }
  .iax-ed-topo .iax-dir-btn { justify-self: end; }
  .iax-texto-btn { all: unset; cursor: pointer; font-size: 16px; color: var(--marca-azul); padding: 8px 6px; border-radius: 8px; }
  @media (prefers-color-scheme: dark) { .iax-texto-btn { color: var(--marca-menta); } }
  .iax-ed-topo .botao { padding: 8px 18px; }
  .iax-ed-corpo { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .iax-ed-corpo .iax-titulo-campo { font-size: 20px; font-weight: 700; }
  .iax-ed-meta { font-size: 12.5px; color: var(--sub); padding: 0 2px; }
  .iax-ed-corpo textarea.iax-conteudo { flex: 1; min-height: 320px; resize: none; font-size: 15px; line-height: 1.55; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .iax-pendlista { border-radius: 14px; background: var(--chip-ativo); color: var(--chip-ativo-txt); padding: 10px 12px; display: grid; gap: 6px; font-size: 13.5px; border: 1px solid rgba(253, 110, 110, .35); }
  .iax-pendlista b { font-weight: 750; }
  .iax-pendlista button { all: unset; cursor: pointer; display: flex; gap: 8px; align-items: baseline; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
  .iax-pendlista button small { flex: none; font-weight: 700; opacity: .8; }
  .iax-pendlista button:hover span { text-decoration: underline; }
  .iax-ed-rodape { display: flex; align-items: center; gap: 10px; padding: 10px 14px calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--linha); flex-wrap: wrap; }
  .iax-ed-rodape .iax-espaco { flex: 1; }
  .iax-versao { border: 1px solid var(--linha); border-radius: 14px; overflow: hidden; }
  .iax-versao-cab { display: flex; align-items: center; gap: 10px; padding: 11px 12px; background: var(--painel); }
  .iax-versao-cab .iax-txt { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .iax-versao-cab b { font-size: 14.5px; font-weight: 600; color: var(--texto); }
  .iax-versao-cab .iax-txt > span { font-size: 12.5px; color: var(--sub); }
  .iax-versao pre { margin: 0; padding: 10px 12px; max-height: 180px; overflow: auto; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--texto); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .iax-leitura { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.6; color: var(--texto); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .iax-leitura mark { background: var(--badge); color: var(--badge-txt); border-radius: 4px; padding: 0 3px; box-shadow: 0 0 8px rgba(253, 110, 110,.45); }
  .iax-leitura .iax-h { font-weight: 800; color: var(--marca-azul); }
  @media (prefers-color-scheme: dark) { .iax-leitura .iax-h { color: var(--marca-menta); } }

  @media (max-width: 760px) {
    #ia.iax-caixa { padding: 8px 14px 130px; }
    .iax-tela, .iax-colunas, .iax-coluna { gap: 20px; }
    .iax-hoje b { font-size: 27px; }
    .iax-linha .iax-txt b { white-space: normal; }
    .iax-teste-cab select { flex: 1; }
    .iax-chat { max-height: 52vh; padding: 12px 12px 14px; }
    .iax-editor .iax-ed-corpo { padding: 14px; }
  }
  `;

  const estiloPronto = () => {
    if (document.getElementById('estilo-ia')) return;
    const s = document.createElement('style');
    s.id = 'estilo-ia';
    s.textContent = CSS;
    document.head.append(s);
  };

  // estado que sobrevive entre aberturas da aba
  const teste = { msgs: [], unidade: 'norte', nome: '', enviando: false, rascunho: '' };
  let geracao = 0;

  // ------------------------------------------------------------ utilidades
  const segundos = (s) => {
    if (s == null || !isFinite(s)) return '—';
    const n = Math.round(s);
    if (n < 60) return `${n} s`;
    const m = Math.floor(n / 60), r = n % 60;
    if (m < 60) return r ? `${m} min ${r} s` : `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const haQuanto = (min) => {
    if (min == null) return '';
    if (min < 1) return 'agora';
    if (min < 60) return `há ${Math.round(min)} min`;
    const h = Math.floor(min / 60);
    return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} d`;
  };
  const diaHora = (d) => {
    if (!d) return '';
    const x = new Date(d);
    const hoje = new Date();
    const amanha = new Date(hoje); amanha.setDate(hoje.getDate() + 1);
    const hora = x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (x.toDateString() === hoje.toDateString()) return `hoje, ${hora}`;
    if (x.toDateString() === amanha.toDateString()) return `amanhã, ${hora}`;
    return `${x.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '')}, ${hora}`;
  };
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const contarPend = (texto) => String(texto || '').split('\n').filter((l) => l.toUpperCase().includes(MARCA_PENDENTE)).length;
  const resumo = (texto, max = 140) => {
    const t = String(texto || '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  };
  const mensagemErro = (x, padrao = 'Algo deu errado.') => {
    if (!x) return padrao;
    if (x.status === 403) return x.message || 'Você não tem permissão para isso.';
    if (x instanceof TypeError || /Failed to fetch|NetworkError/i.test(x.message)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    return x.message || padrao;
  };

  function desenhar(caixa, ui) {
    estiloPronto();
    const { el, api, toast } = ui;
    const icone = (nome, classe) => el('span', { class: classe || '', html: SVG[nome], 'aria-hidden': 'true' });
    const eu = ui.estado.eu || {};
    const gestor = ui.ehGestor(eu);
    const podeConexoes = ['admin', 'direcao'].includes(eu.papel);
    const minha = ++geracao;
    caixa.classList.add('iax-caixa');

    // ---------- diálogos
    const abrirDialogo = (dlg) => {
      document.body.append(dlg);
      dlg.addEventListener('close', () => dlg.remove());
      dlg.showModal();
      return dlg;
    };
    const confirmar = (titulo, texto, botao = 'Apagar') => new Promise((resolver) => {
      let ok = false;
      const dlg = el('dialog', { class: 'iax-folha' },
        el('div', { class: 'iax-folha-corpo' },
          el('h2', { text: titulo }),
          texto ? el('p', { text: texto }) : null,
          el('div', { class: 'iax-rodape' },
            el('button', { class: 'botao leve', type: 'button', text: 'Cancelar', onclick: () => dlg.close() }),
            el('button', { class: 'botao ds-primario', type: 'button', text: botao, onclick: () => { ok = true; dlg.close(); } }))));
      dlg.addEventListener('close', () => resolver(ok));
      abrirDialogo(dlg);
    });

    // ---------- carregando
    if (!caixa.querySelector('.iax-tela')) {
      caixa.replaceChildren(el('div', { class: 'iax-tela', 'aria-busy': 'true' },
        el('div', { class: 'iax-topo' }, el('h1', { class: 'titulo-grande', text: 'Inteligência' })),
        el('div', { class: 'iax-esq', style: 'height:150px;border-radius:20px' }),
        el('div', { class: 'iax-nums' }, ...[1, 2, 3, 4].map(() => el('div', { class: 'iax-esq', style: 'height:78px' }))),
        el('div', { class: 'iax-esq', style: 'height:220px' })));
    }

    const carregar = async () => {
      const [hoje, cfg, base, tags] = await Promise.all([
        api('/api/ia/hoje').then((v) => ({ v }), (e) => ({ e })),
        api('/api/ia/config').then((v) => ({ v }), (e) => ({ e })),
        api('/api/ia/base').then((v) => ({ v }), (e) => ({ e })),
        api('/api/tags').then((v) => ({ v }), (e) => ({ e })),
      ]);
      return { hoje, cfg, base, tags };
    };

    const recarregar = () => desenhar(caixa, ui);

    return carregar().then((d) => {
      if (minha !== geracao) return; // outra abertura começou depois desta
      const cfg = d.cfg.v || null;
      const ligada = cfg && cfg.iaLigada != null ? Boolean(cfg.iaLigada) : Boolean(ui.estado.situacao?.iaLigada);

      const blocoErro = (texto) => el('div', { class: 'iax-cartao' }, el('div', { class: 'iax-erro' },
        el('b', { text: 'Não deu para carregar esta parte.' }), el('span', { text: texto }),
        el('button', { class: 'botao leve', type: 'button', text: 'Tentar de novo', onclick: recarregar })));
      const cab = (titulo, ...lado) => el('div', { class: 'iax-cab' }, el('h2', { text: titulo }), ...lado);

      // ================= topo + aviso de chave
      const topo = el('div', { class: 'iax-topo' },
        el('h1', { class: 'titulo-grande', text: 'Inteligência' }),
        el('span', { class: 'iax-estado' + (ligada ? ' ligada' : '') }, el('i'), el('span', { text: ligada ? 'IA ligada' : 'IA desligada' })));

      const alerta = ligada ? null : el('div', { class: 'iax-alerta', role: 'status' },
        el('span', { class: 'iax-alerta-ic', html: SVG.chave, 'aria-hidden': 'true' }),
        el('div', { class: 'iax-txt' },
          el('b', { text: 'Falta a chave da IA' }),
          el('p', { text: 'Sem a chave, a IA não responde nem sugere: as conversas novas entram em Minha resposta e o teste fica parado. O resto da tela continua funcionando.' }),
          podeConexoes
            ? el('a', { class: 'botao ds-primario', href: '/conexoes', text: 'Ligar em Conexões' })
            : el('p', { text: 'Peça para a administração cadastrar a chave em Conexões.' })));

      // ================= hoje
      const blocoHoje = el('section', { class: 'iax-bloco iax-o1' });
      if (d.hoje.e) blocoHoje.append(cab('Hoje a IA'), blocoErro(mensagemErro(d.hoje.e)));
      else {
        const h = d.hoje.v;
        const lembretes = h.envios?.lembretes || 0, followups = h.envios?.followups || 0;
        const num = (v, t, alerta) => el('div', { class: 'iax-num' + (alerta ? ' alerta' : '') }, el('b', { text: String(v) }), el('span', { text: t }));
        blocoHoje.append(
          el('div', { class: 'ia-destaque iax-hoje' },
            el('span', { class: 'iax-icone-hoje', html: SVG.brilho, 'aria-hidden': 'true' }),
            el('span', { text: 'Hoje a IA' }),
            el('b', { text: plural(h.conversasAtendidas || 0, 'cliente atendida', 'clientes atendidas') }),
            el('small', { text: `${plural(h.respostas || 0, 'resposta', 'respostas')} · assumiu ${plural(h.assumiu || 0, 'conversa', 'conversas')} · tempo médio de resposta ${segundos(h.tempoMedioRespostaSeg)}` + (h.tagsMarcadas ? ` · ${plural(h.tagsMarcadas, 'tag marcada', 'tags marcadas')}` : '') })),
          el('div', { class: 'iax-nums' },
            num(h.agendamentos?.total || 0, 'agendou', (h.agendamentos?.total || 0) > 0),
            num(h.pediuAjuda?.total || 0, 'pediu ajuda'),
            num(lembretes + followups, `${plural(lembretes, 'lembrete', 'lembretes')} e ${plural(followups, 'follow-up', 'follow-ups')}`),
            num(segundos(h.tempoMedioRespostaSeg), 'tempo médio de resposta')));
        const ags = h.agendamentos?.lista || [], ajudas = h.pediuAjuda?.lista || [];
        const abrir = (id) => () => { if (id) ui.abrir(id); };
        if (ags.length) blocoHoje.append(el('div', { class: 'iax-cartao' },
          el('div', { class: 'iax-titulo-lista', text: 'Agendamentos que ela fez' }),
          ...ags.map((a) => el('button', { class: 'iax-linha', type: 'button', onclick: abrir(a.conversaId) },
            el('span', { class: 'iax-marcador agenda', html: SVG.relogio, 'aria-hidden': 'true' }),
            el('span', { class: 'iax-txt' }, el('b', { text: a.cliente || 'Cliente' }), el('span', { text: [a.servico, a.inicio ? diaHora(a.inicio) : ''].filter(Boolean).join(' · ') })),
            el('span', { class: 'iax-lado', text: a.em ? ui.hm(a.em) : '' }),
            icone('seta', 'iax-seta')))));
        if (ajudas.length) blocoHoje.append(el('div', { class: 'iax-cartao' },
          el('div', { class: 'iax-titulo-lista', text: 'Pediu ajuda da equipe' }),
          ...ajudas.map((a) => el('button', { class: 'iax-linha', type: 'button', onclick: abrir(a.conversaId) },
            el('span', { class: 'iax-marcador ajuda', text: '!', 'aria-hidden': 'true' }),
            el('span', { class: 'iax-txt' }, el('b', { text: a.cliente || 'Cliente' }), el('span', { text: a.motivo || 'Chamou alguém da equipe' })),
            el('span', { class: 'iax-lado', text: a.em ? ui.hm(a.em) : '' }),
            icone('seta', 'iax-seta')))));
      }

      // ================= conduzindo agora
      const blocoAgora = el('section', { class: 'iax-bloco iax-o2' });
      if (d.hoje.e) blocoAgora.append(cab('Conduzindo agora'), blocoErro(mensagemErro(d.hoje.e)));
      else {
        const lista = d.hoje.v.conduzindoAgora || [];
        blocoAgora.append(cab('Conduzindo agora', el('span', { class: 'iax-conta', text: lista.length ? String(lista.length) : '' })));
        blocoAgora.append(lista.length
          ? el('div', { class: 'iax-cartao' }, ...lista.map((c) => {
            const m = c.ultimaMensagem;
            const previa = m ? (m.autor === 'ia' ? '✦ ' : m.autor === 'cliente' ? '' : 'Equipe: ') + (m.texto || '') : 'Sem mensagens ainda';
            return el('button', { class: 'item', type: 'button', onclick: () => ui.abrir(c.conversaId) },
              ui.avatar({ id: c.conversaId, nome: c.nome, telefone: c.telefone }),
              el('div', { class: 'corpo' },
                el('div', { class: 'l1' }, el('span', { class: 'nome', text: c.nome || ui.formatarTel(c.telefone) }), el('span', { class: 'hora' + (c.haMin != null && c.haMin < 5 ? ' nova' : ''), text: haQuanto(c.haMin) })),
                el('div', { class: 'l2' }, el('span', { class: 'previa', text: previa })),
                el('div', { class: 'iax-unid', text: [c.unidadeNome || ui.UNIDADE[c.unidade], ui.NOME_ETAPA[c.etapa]].filter(Boolean).join(' · ') })));
          }))
          : el('div', { class: 'iax-cartao' }, el('div', { class: 'iax-vazio' },
            el('b', { text: 'Ninguém com a IA agora' }),
            el('span', { text: ligada ? 'Quando uma conversa estiver no modo Agente de IA, ela aparece aqui.' : 'Ligue a IA para ela conduzir conversas.' }))));
      }

      // ================= comportamento
      const blocoComp = el('section', { class: 'iax-bloco iax-o3' }, cab('Comportamento'));
      if (!cfg) blocoComp.append(blocoErro(mensagemErro(d.cfg.e)));
      else {
        const atual = { ...cfg, assumirSemResposta: { ...(cfg.assumirSemResposta || {}) } };
        const travado = !gestor;
        const salvar = async (parcial, desfazer) => {
          try {
            const r = await api('/api/ia/config', { method: 'PATCH', body: JSON.stringify(parcial) });
            Object.assign(atual, r, { assumirSemResposta: { ...(r.assumirSemResposta || {}) } });
            toast('Salvo ✓');
          } catch (x) { desfazer(); toast(mensagemErro(x, 'Não deu para salvar.')); }
        };

        const modos = ['humano', 'copiloto', 'ia'].map((m) => el('button', {
          class: 'iax-modo', type: 'button', role: 'radio', 'data-m': m,
          'aria-checked': String(atual.modoPadrao === m), 'aria-disabled': travado ? 'true' : null,
          onclick: () => {
            if (travado || atual.modoPadrao === m) return;
            const antes = atual.modoPadrao;
            const marcar = (v) => { atual.modoPadrao = v; modos.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === v))); };
            marcar(m);
            salvar({ modoPadrao: m }, () => marcar(antes));
          },
        }, el('span', { class: 'iax-txt' }, el('b', {}, el('i'), el('span', { text: ui.MODO[m] || m })), el('span', { text: DESCRICAO_MODO[m] })), el('span', { class: 'iax-marca' })));

        const interruptor = (ligado, rotulo, aoMudar) => {
          const b = el('button', { class: 'iax-int', type: 'button', role: 'switch', 'aria-checked': String(Boolean(ligado)), 'aria-label': rotulo, 'aria-disabled': travado ? 'true' : null });
          b.addEventListener('click', () => {
            if (travado) return;
            const novo = b.getAttribute('aria-checked') !== 'true';
            b.setAttribute('aria-checked', String(novo));
            aoMudar(novo, () => b.setAttribute('aria-checked', String(!novo)));
          });
          return b;
        };

        const asr = atual.assumirSemResposta;
        const opcoesMin = [...new Set([...MINUTOS, Number(asr.minutos) || 15])].sort((a, b) => a - b);
        const sel = el('select', { 'aria-label': 'Minutos sem resposta' }, ...opcoesMin.map((n) => el('option', { value: String(n), text: n >= 60 && n % 60 === 0 ? `${n / 60} h` : `${n} min` })));
        sel.value = String(Number(asr.minutos) || 15);
        sel.disabled = travado;
        const linhaMin = el('span', { class: 'iax-minutos' }, el('span', { text: 'depois de' }), sel, el('span', { text: 'sem resposta' }));
        linhaMin.hidden = !asr.ligado;
        sel.addEventListener('change', () => {
          const antes = atual.assumirSemResposta.minutos;
          const v = Number(sel.value);
          atual.assumirSemResposta.minutos = v;
          salvar({ assumirSemResposta: { minutos: v } }, () => { atual.assumirSemResposta.minutos = antes; sel.value = String(antes); });
        });
        const intAssumir = interruptor(asr.ligado, 'IA assume quando ninguém responde', (v, desfazer) => {
          linhaMin.hidden = !v;
          atual.assumirSemResposta.ligado = v;
          salvar({ assumirSemResposta: { ligado: v } }, () => { desfazer(); atual.assumirSemResposta.ligado = !v; linhaMin.hidden = v; });
        });

        const listaTags = d.tags.v || [];
        const tagsCaixa = el('div', { class: 'iax-tags' },
          ...(listaTags.length
            ? listaTags.map((t) => { const i = el('i'); i.style.background = t.cor || 'var(--sub)'; return el('span', { class: 'iax-tag' }, i, el('span', { text: t.nome }), t.conversas ? el('small', { text: String(t.conversas) }) : null); })
            : [el('span', { class: 'iax-tag' }, el('span', { text: d.tags.e ? 'Não deu para ler as tags agora.' : 'Nenhuma tag criada ainda. Crie em Conta › Tags.' }))]));
        const intTags = interruptor(atual.marcarTags, 'IA marca tags sozinha', (v, desfazer) => {
          atual.marcarTags = v;
          salvar({ marcarTags: v }, () => { desfazer(); atual.marcarTags = !v; });
        });

        blocoComp.append(...[
          el('p', { class: 'iax-sub', text: 'Modo das conversas novas' }),
          el('div', { class: 'iax-cartao', role: 'radiogroup', 'aria-label': 'Modo padrão das conversas novas' }, ...modos),
          el('div', { class: 'iax-cartao' },
            el('div', { class: 'iax-opcao' },
              el('span', { class: 'iax-txt' }, el('b', { text: 'IA assume quando ninguém responde' }),
                el('span', { text: 'Se a cliente ficar esperando, a IA entra na conversa.' }), linhaMin),
              intAssumir),
            el('div', { class: 'iax-opcao', style: 'border-bottom:0' },
              el('span', { class: 'iax-txt' }, el('b', { text: 'IA marca tags sozinha' }),
                el('span', { text: 'Ex.: “Instagram” quando a cliente cita o anúncio. Ela só usa as tags que já existem:' })),
              intTags),
            tagsCaixa),
          travado ? el('div', { class: 'iax-nota' }, icone('cadeado'), el('span', { text: 'Só a gerência, a direção e a administração mudam essas opções.' })) : null,
          !ligada ? el('div', { class: 'iax-nota' }, el('span', { text: 'Enquanto a IA estiver sem chave, as conversas novas entram em Minha resposta.' })) : null].filter(Boolean));
      }

      // ================= treinamento
      const blocoTrein = el('section', { class: 'iax-bloco iax-o4' },
        cab('Treinamento', el('button', { class: 'iax-acao', type: 'button', onclick: () => verTexto() }, icone('olho'), el('span', { text: 'Ver o que a IA lê' }))));
      if (d.base.e) blocoTrein.append(blocoErro(mensagemErro(d.base.e)));
      else {
        const b = d.base.v;
        const secoes = b.secoes || [], perguntas = b.perguntas || [], pend = b.pendencias || [];
        blocoTrein.append(el('p', { class: 'iax-sub', text: gestor ? 'O que a IA sabe da empresa. Toque numa seção para editar; vale na próxima resposta.' : 'O que a IA sabe da empresa. Só a gestão edita.' }));
        if (pend.length) blocoTrein.append(el('div', { class: 'iax-faixa' },
          el('span', { class: 'iax-pend', text: String(pend.length) }),
          el('span', {}, el('b', { text: pend.length === 1 ? 'Falta preencher 1 trecho. ' : `Faltam preencher ${pend.length} trechos. ` }),
            el('span', { text: 'Onde está [PREENCHER] a IA não inventa: ela chama a equipe.' }))));
        blocoTrein.append(el('div', { class: 'iax-cartao' },
          ...(secoes.length ? secoes.map((s) => el('button', { class: 'iax-linha', type: 'button', onclick: () => editarSecao(s) },
            el('span', { class: 'iax-txt' }, el('b', { text: s.titulo }), el('span', { text: resumo(s.conteudo) || 'Vazia' })),
            s.pendencias ? el('span', { class: 'iax-pend', text: `${s.pendencias} a preencher` }) : null,
            icone('seta', 'iax-seta')))
            : [el('div', { class: 'iax-vazio' }, el('b', { text: 'Nada ensinado ainda' }), el('span', { text: 'Crie a primeira seção: serviços, unidades, jeito de falar, regras…' }))]),
          gestor ? el('button', { class: 'iax-novo', type: 'button', onclick: () => editarSecao(null) }, icone('mais'), el('span', { text: 'Nova seção' })) : null));

        blocoTrein.append(el('div', { class: 'iax-cab', style: 'margin-top:6px' }, el('h2', { text: 'Perguntas frequentes', style: 'font-size:17px' }), el('span', { class: 'iax-conta', text: perguntas.length ? String(perguntas.length) : '' })));
        blocoTrein.append(el('div', { class: 'iax-cartao' },
          ...(perguntas.length ? perguntas.map((p) => el('button', { class: 'iax-linha', type: 'button', 'aria-disabled': gestor ? null : 'true', onclick: () => { if (gestor) editarPergunta(p); } },
            el('span', { class: 'iax-txt' }, el('b', { text: p.pergunta, style: 'white-space:normal' }), el('span', { text: p.resposta })),
            gestor ? icone('seta', 'iax-seta') : null))
            : [el('div', { class: 'iax-vazio' }, el('span', { text: 'Nenhuma pergunta ainda. Ensine as respostas que as clientes mais pedem.' }))]),
          gestor ? el('button', { class: 'iax-novo', type: 'button', onclick: () => editarPergunta(null) }, icone('mais'), el('span', { text: 'Adicionar pergunta' })) : null));
      }

      // ================= testar
      let blocoTeste = null;
      if (gestor) {
        const t = montarTeste(ligada);
        blocoTeste = el('section', { class: 'iax-bloco iax-o5' }, cab('Testar a IA', t.limpar), t.cartao);
      }

      // ================= montar
      const tela = el('div', { class: 'iax-tela' }, topo, alerta,
        el('div', { class: 'iax-colunas' },
          el('div', { class: 'iax-coluna' }, blocoHoje, blocoAgora, blocoTeste),
          el('div', { class: 'iax-coluna' }, blocoComp, blocoTrein)));
      caixa.replaceChildren(tela);
      const chat = tela.querySelector('.iax-chat');
      if (chat) chat.scrollTop = chat.scrollHeight;
    }).catch((x) => {
      if (minha !== geracao) return;
      caixa.replaceChildren(el('div', { class: 'iax-tela' },
        el('div', { class: 'iax-topo' }, el('h1', { class: 'titulo-grande', text: 'Inteligência' })),
        el('div', { class: 'iax-cartao' }, el('div', { class: 'iax-erro' }, el('b', { text: 'Não deu para abrir a tela da IA.' }), el('span', { text: mensagemErro(x) }),
          el('button', { class: 'botao leve', type: 'button', text: 'Tentar de novo', onclick: recarregar })))));
    });

    // ------------------------------------------------------------ editor de seção (tela cheia)
    function editarSecao(secao) {
      const nova = !secao;
      const somenteLer = !gestor;
      const titulo = el('input', { class: 'iax-campo iax-titulo-campo', maxlength: '80', placeholder: 'Título (ex.: Serviços, Regras, Jeito de falar)', 'aria-label': 'Título da seção' });
      const conteudo = el('textarea', { class: 'iax-campo iax-conteudo', spellcheck: 'true', placeholder: 'Escreva aqui o que a IA precisa saber. Use [PREENCHER] onde ainda falta uma informação.', 'aria-label': 'Conteúdo da seção' });
      titulo.value = secao?.titulo || '';
      conteudo.value = secao?.conteudo || '';
      titulo.readOnly = conteudo.readOnly = somenteLer;
      const original = { titulo: titulo.value, conteudo: conteudo.value };
      const sujo = () => titulo.value !== original.titulo || conteudo.value !== original.conteudo;
      const erro = el('div', { class: 'iax-msg-erro', role: 'alert' });
      const pendCaixa = el('div', { class: 'iax-pendlista' });
      const desenharPend = () => {
        const linhas = conteudo.value.split('\n');
        const achadas = [];
        linhas.forEach((l, i) => { if (l.toUpperCase().includes(MARCA_PENDENTE)) achadas.push({ i, l }); });
        pendCaixa.hidden = !achadas.length;
        pendCaixa.replaceChildren(
          el('b', { text: achadas.length === 1 ? '1 trecho para preencher' : `${achadas.length} trechos para preencher` }),
          ...achadas.slice(0, 12).map(({ i, l }) => el('button', { type: 'button', onclick: () => irParaLinha(i) }, el('small', { text: `linha ${i + 1}` }), el('span', { text: l.trim() }))),
          ...(achadas.length > 12 ? [el('span', { text: `e mais ${achadas.length - 12}…` })] : []));
      };
      const irParaLinha = (i) => {
        const linhas = conteudo.value.split('\n');
        const ini = linhas.slice(0, i).reduce((s, l) => s + l.length + 1, 0);
        const linha = linhas[i] || '';
        const p = linha.toUpperCase().indexOf(MARCA_PENDENTE);
        const fimMarca = p >= 0 ? linha.indexOf(']', p) : -1;
        conteudo.focus();
        if (p >= 0) conteudo.setSelectionRange(ini + p, ini + (fimMarca >= 0 ? fimMarca + 1 : linha.length));
        else conteudo.setSelectionRange(ini, ini + linha.length);
        // rola até a linha
        const alturaLinha = parseFloat(getComputedStyle(conteudo).lineHeight) || 22;
        conteudo.scrollTop = Math.max(0, i * alturaLinha - conteudo.clientHeight / 3);
      };
      conteudo.addEventListener('input', desenharPend);
      desenharPend();

      const salvarBtn = somenteLer ? null : el('button', { class: 'botao ds-primario iax-dir-btn', type: 'button', text: 'Salvar' });
      const meta = secao ? el('div', { class: 'iax-ed-meta', text: `Atualizada ${ui.quando(secao.atualizadaEm)}${secao.atualizadaPor ? ' por ' + secao.atualizadaPor : ''}` }) : null;
      const corpo = el('div', { class: 'iax-ed-corpo' }, titulo, meta, pendCaixa, conteudo, erro);
      const topoTitulo = el('h2', { text: somenteLer ? 'Treinamento' : nova ? 'Nova seção' : 'Editar seção' });
      let fechando = false;
      const fechar = async () => {
        if (fechando) return;
        if (!somenteLer && sujo()) {
          if (!(await confirmar('Descartar as mudanças?', 'O que você escreveu nesta seção ainda não foi salvo.', 'Descartar'))) return;
        }
        fechando = true;
        dlg.close();
      };
      const voltarBtn = el('button', { class: 'iax-texto-btn iax-esq-btn', type: 'button', text: somenteLer ? 'Fechar' : 'Cancelar', onclick: fechar });
      const rodape = el('div', { class: 'iax-ed-rodape' });
      const dlg = el('dialog', { class: 'iax-editor', 'aria-label': 'Editor de seção do treinamento' },
        el('div', { class: 'iax-ed-topo' }, voltarBtn, topoTitulo, salvarBtn || el('span')),
        corpo, rodape);
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });

      if (salvarBtn) salvarBtn.addEventListener('click', async () => {
        erro.textContent = '';
        const t = titulo.value.trim();
        if (!t) { erro.textContent = 'Dê um título para a seção.'; titulo.focus(); return; }
        if (!nova && !sujo()) { fechando = true; dlg.close(); return; }
        salvarBtn.disabled = true;
        try {
          if (nova) await api('/api/ia/base', { method: 'POST', body: JSON.stringify({ titulo: t, conteudo: conteudo.value }) });
          else {
            const mud = {};
            if (t !== secao.titulo) mud.titulo = t;
            if (conteudo.value !== secao.conteudo) mud.conteudo = conteudo.value;
            await api(`/api/ia/base/${encodeURIComponent(secao.chave)}`, { method: 'PUT', body: JSON.stringify(mud) });
          }
          fechando = true;
          dlg.close();
          toast(nova ? 'Seção criada ✓ A IA já usa na próxima resposta.' : 'Salvo ✓ A IA já usa na próxima resposta.');
          recarregar();
        } catch (x) {
          erro.textContent = x.status === 409 ? 'Já existe uma seção com esse título. Escolha outro.' : mensagemErro(x, 'Não deu para salvar.');
        } finally { salvarBtn.disabled = false; }
      });

      // histórico e apagar
      if (!nova) {
        rodape.append(el('button', { class: 'botao leve', type: 'button', onclick: () => verHistorico() }, el('span', { text: 'Ver histórico' })));
        rodape.append(el('span', { class: 'iax-espaco' }));
        if (!somenteLer) rodape.append(el('button', { class: 'iax-perigo', type: 'button', onclick: apagar }, icone('lixo'), el('span', { text: 'Apagar seção' })));
      } else rodape.hidden = true;

      async function apagar() {
        if (!(await confirmar(`Apagar “${secao.titulo}”?`, 'A IA deixa de saber o que está nesta seção. Não dá para desfazer.'))) return;
        try {
          await api(`/api/ia/base/${encodeURIComponent(secao.chave)}`, { method: 'DELETE' });
          fechando = true; dlg.close(); toast('Seção apagada'); recarregar();
        } catch (x) { erro.textContent = mensagemErro(x, 'Não deu para apagar.'); }
      }

      async function verHistorico() {
        const voltar = () => { corpo.replaceChildren(...[titulo, meta, pendCaixa, conteudo, erro].filter(Boolean)); rodape.hidden = false; topoTitulo.textContent = somenteLer ? 'Treinamento' : 'Editar seção'; voltarBtn.onclick = null; voltarBtn.textContent = somenteLer ? 'Fechar' : 'Cancelar'; voltarBtn.removeEventListener('click', voltar); voltarBtn.addEventListener('click', fechar); if (salvarBtn) salvarBtn.hidden = false; };
        voltarBtn.removeEventListener('click', fechar);
        voltarBtn.textContent = '‹ Voltar';
        voltarBtn.addEventListener('click', voltar);
        topoTitulo.textContent = 'Histórico';
        rodape.hidden = true;
        if (salvarBtn) salvarBtn.hidden = true;
        corpo.replaceChildren(el('div', { class: 'iax-esq', style: 'height:90px' }), el('div', { class: 'iax-esq', style: 'height:90px' }));
        let versoes;
        try { versoes = await api(`/api/ia/base/${encodeURIComponent(secao.chave)}/historico`); }
        catch (x) { corpo.replaceChildren(el('div', { class: 'iax-erro' }, el('b', { text: 'Não deu para ler o histórico.' }), el('span', { text: mensagemErro(x) }))); return; }
        if (!versoes.length) { corpo.replaceChildren(el('div', { class: 'iax-vazio' }, el('b', { text: 'Sem versões anteriores' }), el('span', { text: 'Cada vez que alguém salva, a versão fica guardada aqui.' }))); return; }
        corpo.replaceChildren(
          el('p', { class: 'iax-sub', style: 'margin:0', text: somenteLer ? 'As 10 versões mais novas desta seção.' : 'As 10 versões mais novas. Restaurar salva aquela versão como a atual (a de agora fica no histórico).' }),
          ...versoes.map((v, i) => {
            const atualIgual = v.titulo === secao.titulo && v.conteudo === secao.conteudo;
            return el('div', { class: 'iax-versao' },
              el('div', { class: 'iax-versao-cab' },
                el('span', { class: 'iax-txt' }, el('b', { text: v.titulo }), el('span', { text: `${ui.quando(v.em)}${v.por ? ' · ' + v.por : ''}${atualIgual ? ' · versão atual' : ''}${contarPend(v.conteudo) ? ` · ${contarPend(v.conteudo)} a preencher` : ''}` })),
                !somenteLer && !atualIgual ? el('button', { class: 'iax-acao', type: 'button', onclick: () => restaurar(v) }, el('span', { text: 'Restaurar' })) : null),
              el('pre', { text: v.conteudo || '(vazia)' }));
          }));
      }

      async function restaurar(v) {
        if (!(await confirmar('Restaurar esta versão?', `A seção volta a ficar como estava em ${ui.quando(v.em)}. A versão de agora continua no histórico.`, 'Restaurar'))) return;
        try {
          await api(`/api/ia/base/${encodeURIComponent(secao.chave)}`, { method: 'PUT', body: JSON.stringify({ titulo: v.titulo, conteudo: v.conteudo }) });
          fechando = true; dlg.close(); toast('Versão restaurada ✓'); recarregar();
        } catch (x) {
          corpo.prepend(el('div', { class: 'iax-msg-erro', role: 'alert', text: x.status === 409 ? 'Outra seção já usa esse título. Renomeie antes de restaurar.' : mensagemErro(x, 'Não deu para restaurar.') }));
        }
      }

      abrirDialogo(dlg);
      if (!somenteLer) (nova ? titulo : conteudo).focus({ preventScroll: true });
      if (!somenteLer && !nova) conteudo.setSelectionRange(0, 0);
    }

    // ------------------------------------------------------------ pergunta frequente
    function editarPergunta(p) {
      const nova = !p;
      const pergunta = el('input', { class: 'iax-campo', maxlength: '500', placeholder: 'Ex.: Vocês atendem aos domingos?' });
      const resposta = el('textarea', { class: 'iax-campo', rows: '5', maxlength: '2000', placeholder: 'A resposta que a IA deve dar.' });
      pergunta.value = p?.pergunta || ''; resposta.value = p?.resposta || '';
      const erro = el('div', { class: 'iax-msg-erro', role: 'alert' });
      const salvar = el('button', { class: 'botao ds-primario', type: 'button', text: 'Salvar' });
      const dlg = el('dialog', { class: 'iax-folha' },
        el('div', { class: 'iax-folha-corpo' },
          el('h2', { text: nova ? 'Nova pergunta frequente' : 'Pergunta frequente' }),
          el('label', {}, el('span', { text: 'Pergunta da cliente' }), pergunta),
          el('label', {}, el('span', { text: 'Resposta' }), resposta),
          erro,
          el('div', { class: 'iax-rodape' },
            nova ? null : el('button', { class: 'iax-perigo', type: 'button', onclick: apagar }, icone('lixo'), el('span', { text: 'Apagar' })),
            el('span', { class: 'iax-espaco' }),
            el('button', { class: 'botao leve', type: 'button', text: 'Cancelar', onclick: () => dlg.close() }),
            salvar)));
      salvar.addEventListener('click', async () => {
        erro.textContent = '';
        const q = pergunta.value.trim(), r = resposta.value.trim();
        if (q.length < 3) { erro.textContent = 'Escreva a pergunta (pelo menos 3 letras).'; pergunta.focus(); return; }
        if (!r) { erro.textContent = 'Escreva a resposta.'; resposta.focus(); return; }
        salvar.disabled = true;
        try {
          if (nova) await api('/api/ia/perguntas', { method: 'POST', body: JSON.stringify({ pergunta: q, resposta: r }) });
          else await api(`/api/ia/perguntas/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: JSON.stringify({ pergunta: q, resposta: r }) });
          dlg.close(); toast(nova ? 'Pergunta adicionada ✓' : 'Salvo ✓'); recarregar();
        } catch (x) { erro.textContent = mensagemErro(x, 'Não deu para salvar.'); }
        finally { salvar.disabled = false; }
      });
      async function apagar() {
        if (!(await confirmar('Apagar esta pergunta?', p.pergunta))) return;
        try { await api(`/api/ia/perguntas/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); dlg.close(); toast('Pergunta apagada'); recarregar(); }
        catch (x) { erro.textContent = mensagemErro(x, 'Não deu para apagar.'); }
      }
      abrirDialogo(dlg);
      (nova ? pergunta : resposta).focus();
    }

    // ------------------------------------------------------------ o que a IA lê
    function verTexto() {
      const corpo = el('div', { class: 'iax-ed-corpo' }, el('div', { class: 'iax-esq', style: 'height:60vh' }));
      const dlg = el('dialog', { class: 'iax-editor', 'aria-label': 'O que a IA lê' },
        el('div', { class: 'iax-ed-topo' }, el('button', { class: 'iax-texto-btn iax-esq-btn', type: 'button', text: 'Fechar', onclick: () => dlg.close() }), el('h2', { text: 'O que a IA lê' }), el('span')),
        corpo);
      abrirDialogo(dlg);
      api('/api/ia/base/texto').then(({ texto }) => {
        const pre = el('pre', { class: 'iax-leitura' });
        String(texto || '').split('\n').forEach((linha, i) => {
          if (i) pre.append('\n');
          if (/^#{1,3}\s/.test(linha)) { pre.append(el('span', { class: 'iax-h', text: linha })); return; }
          linha.split(/(\[PREENCHER[^\]]*\]?)/i).forEach((parte, j) => { if (parte) pre.append(j % 2 ? el('mark', { text: parte }) : parte); });
        });
        corpo.replaceChildren(
          el('p', { class: 'iax-sub', style: 'margin:0', text: 'É exatamente este texto que a IA recebe junto com cada conversa (as perguntas frequentes entram nele). Só leitura.' }),
          pre);
      }).catch((x) => corpo.replaceChildren(el('div', { class: 'iax-erro' }, el('b', { text: 'Não deu para ler o texto.' }), el('span', { text: mensagemErro(x) }))));
    }

    // ------------------------------------------------------------ testar a IA
    function montarTeste(ligada) {
      const chat = el('div', { class: 'iax-chat', 'aria-live': 'polite' });
      const campo = el('textarea', { rows: '1', placeholder: ligada ? 'Escreva como se fosse a cliente…' : 'Ligue a IA para testar', 'aria-label': 'Mensagem da cliente (teste)' });
      campo.value = teste.rascunho;
      const enviarBtn = el('button', { class: 'iax-enviar', type: 'button', html: SVG.enviar, 'aria-label': 'Enviar para o teste' });
      const unidade = el('select', { 'aria-label': 'Unidade do teste' }, ...Object.entries(ui.UNIDADE).map(([k, v]) => el('option', { value: k, text: v })));
      unidade.value = teste.unidade;
      unidade.addEventListener('change', () => { teste.unidade = unidade.value; });
      const nome = el('input', { placeholder: 'Nome da cliente (opcional)', maxlength: '60', 'aria-label': 'Nome da cliente no teste' });
      nome.value = teste.nome;
      nome.addEventListener('input', () => { teste.nome = nome.value; });
      const limpar = el('button', { class: 'iax-acao', type: 'button', text: 'Limpar', onclick: () => { if (teste.enviando) return; teste.msgs = []; desenharChat(); campo.focus(); } });

      const ajustar = () => { campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight, 120) + 'px'; };
      const atualizarBotao = () => { enviarBtn.disabled = !ligada || teste.enviando || !campo.value.trim(); campo.disabled = !ligada; };
      campo.addEventListener('input', () => { teste.rascunho = campo.value; ajustar(); atualizarBotao(); });
      campo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); enviar(); } });
      enviarBtn.addEventListener('click', () => enviar());

      const SUGESTOES = ['Oi! Quanto fica a progressiva?', 'Vi no Instagram, tem horário sábado?', 'Quero reclamar do atendimento'];
      function desenharChat() {
        const itens = [];
        if (!teste.msgs.length) {
          itens.push(el('div', { class: 'iax-chat-vazio' },
            el('span', { class: 'iax-ic', html: SVG.brilho, 'aria-hidden': 'true' }),
            el('b', { text: 'Converse como se fosse uma cliente' }),
            el('span', { text: 'Veja como a IA responderia com o treinamento de agora e o que ela faria na conversa.' }),
            ligada ? el('div', { class: 'iax-sugestoes' }, ...SUGESTOES.map((s) => el('button', { class: 'chip', type: 'button', text: s, onclick: () => { campo.value = s; enviar(); } }))) : null));
        }
        let anterior = null;
        for (const m of teste.msgs) {
          if (m.autor === 'cliente') {
            itens.push(el('div', { class: 'bal rec' + (anterior !== 'cliente' ? ' primeira' : '') }, el('span', { text: m.texto })));
          } else if (m.autor === 'ia') {
            itens.push(el('div', { class: 'bal env' + (anterior !== 'ia' ? ' primeira' : '') }, el('span', { class: 'autor ia', text: '✦ IA da Sintonia' }), el('span', { text: m.texto })));
            if (m.acoes?.length) itens.push(el('div', { class: 'iax-acoes-ia' }, ...m.acoes.map((a) => el('span', { text: a.descricao || a.tipo }))));
          } else if (m.autor === 'aviso') {
            itens.push(el('div', { class: 'iax-aviso-chat', text: m.texto }));
          }
          anterior = m.autor;
        }
        if (teste.enviando) itens.push(el('div', { class: 'iax-digitando', 'aria-label': 'A IA está escrevendo' }, el('i'), el('i'), el('i')));
        chat.replaceChildren(...itens);
        chat.scrollTop = chat.scrollHeight;
        atualizarBotao();
      }

      async function enviar() {
        const texto = campo.value.trim();
        if (!texto || teste.enviando || !ligada) return;
        const historico = teste.msgs.filter((m) => m.autor === 'cliente' || (m.autor === 'ia' && m.texto)).map((m) => ({ autor: m.autor, texto: m.texto.slice(0, 2000) })).slice(-30);
        teste.msgs.push({ autor: 'cliente', texto });
        campo.value = ''; teste.rascunho = ''; ajustar();
        teste.enviando = true;
        desenharChat();
        try {
          const corpo = { mensagem: texto.slice(0, 2000), historico, unidade: teste.unidade };
          if (teste.nome.trim()) corpo.nome = teste.nome.trim();
          const r = await ui.post('/api/ia/testar', corpo);
          if (r.resposta && r.resposta.trim()) teste.msgs.push({ autor: 'ia', texto: r.resposta, acoes: r.acoes || [] });
          else if (r.acoes?.length) teste.msgs.push({ autor: 'ia', texto: '(sem mensagem para a cliente)', acoes: r.acoes });
          if (r.recusou) teste.msgs.push({ autor: 'aviso', texto: 'A IA preferiu não responder sozinha esta mensagem e chamaria alguém da equipe.' });
          if (!r.resposta && !r.acoes?.length && !r.recusou) teste.msgs.push({ autor: 'aviso', texto: 'A IA não mandaria nada para esta mensagem.' });
        } catch (x) {
          let t;
          if (x.status === 400 && /chave/i.test(x.message)) t = x.message;
          else if (x.status === 403) t = 'Só a gerência, a direção e a administração testam a IA.';
          else if (x.status === 501) t = 'Testar a IA não está disponível neste servidor.';
          else if (x.status === 400) t = `O teste não foi aceito: ${x.message}`;
          else {
            const det = mensagemErro(x, '');
            t = 'A IA não conseguiu responder agora. Confira a chave da IA em Conexões e tente de novo.' + (det && !/erro interno|algo deu errado/i.test(det) ? ` (${det})` : '');
          }
          teste.msgs.push({ autor: 'aviso', texto: t });
        } finally {
          teste.enviando = false;
          if (chat.isConnected) desenharChat();
        }
      }

      desenharChat();
      queueMicrotask(ajustar);
      const cartao = el('div', { class: 'iax-cartao iax-teste' },
        el('div', { class: 'iax-selo' }, icone('cadeado'), el('span', { text: ligada ? 'É só um teste: nada é enviado para cliente nenhuma e nada fica gravado.' : 'A IA está sem chave: o teste volta a funcionar quando ela for ligada em Conexões.' })),
        el('div', { class: 'iax-teste-cab' }, unidade, nome),
        chat,
        el('div', { class: 'iax-compor' }, campo, enviarBtn));
      return { cartao, limpar };
    }
  }

  window.SintoniaTelas.ia = { desenhar };
})();
