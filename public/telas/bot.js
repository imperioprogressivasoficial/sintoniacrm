/* Tela "bot" da Sintonia: construtor visual de bots (fluxos em grafo, estilo Salesbot).
 * Registra window.SintoniaTelas.bot = { desenhar(caixa, ui), abrirEditor(id), escolherDaEtapa(opcoes), iniciarNaConversa(conversaId) }.
 * - desenhar: a lista de bots (com a aba Automações | Bots) e "Novo bot" (em branco ou de um modelo).
 * - abrirEditor: tela cheia com paleta, palco (arrastar, ligar, mover/zoom com mouse, trackpad e toque), painel do bloco,
 *   desfazer/refazer, validação visual, mini-mapa, salvar rascunho, publicar, ligar e testar numa conversa de teste
 *   mostrando o caminho percorrido. No celular há também a visão em lista.
 * - escolherDaEtapa: o raio ⚡ da etapa no CRM oferece "Automação simples" ou "Bot (fluxo)".
 * - iniciarNaConversa: o "Iniciar bot" da folha "Quem atende" da conversa (chip de baixo).
 * Todo texto que vem do servidor entra por textContent, nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const SVG = {
    robo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="4"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/><circle cx="12" cy="3.5" r="1"/></svg>',
    raio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 2.5 4.8 13.4c-.3.4 0 1 .5 1h5.2l-1.4 7.1c-.1.6.7.9 1 .4l8.4-10.9c.3-.4 0-1-.5-1h-5.2l1.4-7.1c.1-.6-.7-.9-1-.4Z"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    menos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    desfazer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    refazer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    ajustar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/></svg>',
    lista: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    palco: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="5" rx="1.5"/><rect x="14" y="15" width="7" height="5" rx="1.5"/><path d="M10 6.5h2a2 2 0 0 1 2 2v7"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.5-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z"/></svg>',
    salvar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
    foguete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 15c-1.5 1.3-2 4-2 6 2 0 4.7-.5 6-2"/><path d="M9 18 6 15c1-4 4-9 12-11-2 8-7 11-11 12Z"/><circle cx="14.5" cy="9.5" r="1.5"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87Z"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 1.8 20.5h20.4L12 3Zm1 14h-2v-2h2v2Zm0-4h-2V9h2v4Z"/></svg>',
  };

  const GRUPOS = {
    inicio: { cor: '#0FFCBE', nome: 'Início' },
    msg: { cor: '#106EBE', nome: 'Mensagens' },
    logica: { cor: '#F5B800', nome: 'Lógica' },
    acao: { cor: '#19C3A6', nome: 'Ações' },
    ia: { cor: '#9DB8FF', nome: 'Inteligência' },
    fim: { cor: '#FF7A59', nome: 'Encerrar' },
  };
  /** [tipo, grupo, ícone, nome, descrição] */
  const CATALOGO = [
    ['inicio', 'inicio', '🚀', 'Início', 'Quando o bot começa'],
    ['mensagem', 'msg', '💬', 'Enviar mensagem', 'Texto e imagem, com {nome}'],
    ['pergunta', 'msg', '🔢', 'Pergunta com opções', 'Menu 1-2-3; cada opção um caminho'],
    ['pergunta_aberta', 'msg', '✍️', 'Pergunta aberta', 'Guarda a resposta na ficha'],
    ['condicao', 'logica', '🔀', 'Condição', 'Se… senão…'],
    ['esperar', 'logica', '⏳', 'Esperar', 'Minutos, horas ou dias'],
    ['esperar_resposta', 'logica', '⌛', 'Esperar resposta', 'Com tempo limite'],
    ['mover_etapa', 'acao', '➡️', 'Mover etapa', 'Qualquer funil'],
    ['marcar_tag', 'acao', '🏷️', 'Marcar tag', 'Põe uma tag'],
    ['desmarcar_tag', 'acao', '🧹', 'Tirar tag', 'Remove uma tag'],
    ['atribuir', 'acao', '👤', 'Atribuir', 'Atendente da conversa'],
    ['mudar_modo', 'acao', '🔁', 'Mudar modo', 'IA, Copiloto ou Só equipe'],
    ['lembrete', 'acao', '📞', 'Lembrete de ligação', 'Aparece em “Ligar hoje”'],
    ['webhook', 'acao', '🌐', 'Webhook', 'POST com os dados (JSON)'],
    ['agente_ia', 'ia', '✨', 'Agente de IA', 'A IA conduz com um objetivo'],
    ['transferir', 'fim', '🙋', 'Transferir para humano', 'Chama a equipe'],
    ['fim', 'fim', '🏁', 'Fim', 'Encerra o bot'],
  ];
  const INFO = Object.fromEntries(CATALOGO.map(([t, g, i, n, d]) => [t, { grupo: g, icone: i, nome: n, desc: d }]));
  const GATILHOS = [
    ['nova_conversa', 'Cliente nova (primeira mensagem)'],
    ['palavra_chave', 'Palavra-chave'],
    ['entrou_na_etapa', 'Entrou numa etapa'],
    ['tag_marcada', 'Tag marcada'],
    ['fora_do_horario', 'Mensagem fora do horário'],
    ['manual', 'Manual (botão na conversa)'],
  ];
  const UNIDADES = { norte: 'Salvador Norte', sumare: 'Sumaré', feira: 'Feira de Santana' };
  const MODOS = { ia: 'IA responde', copiloto: 'Copiloto (sugere)', humano: 'Só equipe' };
  const VALIDACOES = { texto: 'Texto', numero: 'Número', telefone: 'Telefone', email: 'E-mail', data: 'Data' };
  const CONDICOES = [['horario_loja', 'A loja está aberta'], ['tag', 'Tem a tag'], ['etapa', 'Está na etapa'], ['campo', 'Campo da ficha / variável'], ['unidade', 'A unidade é'], ['resposta_contem', 'A resposta contém'], ['modo', 'O modo é']];
  const VARIAVEIS = ['{primeiro_nome}', '{nome}', '{unidade}', '{atendente}'];
  const STATUS = { pendente: 'Esperando', rodando: 'Rodando', concluida: 'Concluída', cancelada: 'Cancelada', erro: 'Erro' };
  const W = 236; // largura do bloco no palco

  const CSS = `
  #bot.bt-caixa { display: block; padding-bottom: 110px; }
  .bt-tela { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
  .bt-cab { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .bt-cab .titulo-grande { margin: 2px 0 0; flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; font-family: var(--fonte-titulo); font-size: 38px; letter-spacing: -.03em; }
  .bt-ic { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: var(--marca-azul); background: color-mix(in srgb, var(--marca-menta) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-menta) 55%, transparent), 0 0 16px color-mix(in srgb, var(--marca-menta) 30%, transparent); }
  html[data-tema="escuro"] .bt-ic { color: var(--marca-menta); }
  .bt-ic svg { width: 24px; height: 24px; }
  .bt-sub { margin: -8px 2px 0; color: var(--sub); font-size: 14.5px; line-height: 1.45; }
  .bt-abas { justify-self: start; display: flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  .bt-aba { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 18px; border-radius: 999px; font-size: 14.5px; font-weight: 650; color: var(--sub); }
  .bt-aba svg { width: 16px; height: 16px; }
  .bt-aba[aria-pressed="true"] { color: var(--texto); font-weight: 750; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 4px 14px rgba(16,110,190,.12); }
  html[data-tema="escuro"] .bt-aba[aria-pressed="true"] { background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,.4); }
  .bt-botao { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 18px; border-radius: 999px; font-weight: 750; font-size: 14.5px; white-space: nowrap;
    background: var(--marca-menta); color: #071d33; box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 45%, transparent), 0 8px 26px color-mix(in srgb, var(--marca-menta) 36%, transparent); transition: transform .15s ease, filter .15s ease; }
  .bt-botao:hover { transform: translateY(-1px); filter: brightness(1.05); }
  .bt-botao svg { width: 18px; height: 18px; flex: none; }
  .bt-botao.leve { background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .bt-botao.perigo { background: transparent; color: #c4313b; box-shadow: inset 0 0 0 1.5px rgba(229,72,77,.55); }
  html[data-tema="escuro"] .bt-botao.perigo { color: #ff8f94; }
  .bt-botao[disabled] { opacity: .5; cursor: default; transform: none; }
  .bt-botao:focus-visible, .bt-redondo:focus-visible, .bt-aba:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .bt-redondo { all: unset; cursor: pointer; box-sizing: border-box; width: 44px; height: 44px; flex: none; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .bt-redondo svg { width: 20px; height: 20px; }
  .bt-redondo[disabled] { opacity: .4; cursor: default; }
  .bt-redondo[aria-pressed="true"] { background: color-mix(in srgb, var(--marca-menta) 30%, transparent); box-shadow: inset 0 0 0 1px var(--marca-menta); }
  .bt-lista { display: grid; gap: 10px; }
  .bt-card { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 7px; padding: 16px 18px; border-radius: 24px; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); transition: transform .15s ease, border-color .15s ease; }
  .bt-card:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--marca-menta) 45%, var(--vidro-borda)); }
  .bt-card .bt-l1 { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .bt-card .bt-l1 b { flex: 1; min-width: 0; font-size: 16.5px; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bt-card .bt-quando { font-size: 14.5px; line-height: 1.4; }
  .bt-card .bt-l3 { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); align-items: center; }
  .bt-selo { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--sub); white-space: nowrap; }
  .bt-selo.ligado { color: #0a4c86; background: color-mix(in srgb, var(--marca-menta) 26%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-menta) 55%, transparent); }
  html[data-tema="escuro"] .bt-selo.ligado { color: #fff; }
  .bt-selo.aviso { color: #8a5d00; background: rgba(245,184,0,.16); box-shadow: inset 0 0 0 1px rgba(245,184,0,.45); }
  html[data-tema="escuro"] .bt-selo.aviso { color: #ffd34d; }
  .bt-selo.erro { color: #c4313b; background: rgba(255,122,89,.14); box-shadow: inset 0 0 0 1px rgba(255,122,89,.45); }
  html[data-tema="escuro"] .bt-selo.erro { color: #ffab94; }
  .bt-vazio { padding: 30px 18px; border-radius: 22px; border: 1.5px dashed var(--vidro-borda); text-align: center; color: var(--sub); display: grid; gap: 12px; justify-items: center; font-size: 14.5px; line-height: 1.45; }
  .bt-vazio b { color: var(--texto); font-size: 16.5px; }
  .bt-chave { appearance: none; -webkit-appearance: none; margin: 0; flex: none; width: 46px; height: 28px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); position: relative; cursor: pointer; transition: background .2s ease; }
  .bt-chave::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .2s ease; }
  .bt-chave:checked { background: var(--marca-menta); box-shadow: 0 0 12px color-mix(in srgb, var(--marca-menta) 45%, transparent); }
  .bt-chave:checked::after { transform: translateX(18px); }
  dialog.bt-dialogo { width: min(720px, calc(100vw - 24px)); max-width: none; max-height: calc(100dvh - 32px); padding: 0; border-radius: 26px; overflow: auto; border: 1px solid var(--vidro-borda); background: var(--vidro-forte); color: var(--texto); box-shadow: var(--vidro-brilho), 0 30px 80px rgba(4,23,43,.35); -webkit-backdrop-filter: blur(26px) saturate(1.5); backdrop-filter: blur(26px) saturate(1.5); }
  dialog.bt-dialogo::backdrop { background: rgba(4,23,43,.45); }
  .bt-dlg-topo { display: flex; align-items: center; gap: 10px; padding: 14px 14px 6px 22px; }
  .bt-dlg-topo h2 { flex: 1; margin: 0; font-family: var(--fonte-titulo); font-size: 22px; }
  .bt-dlg-corpo { padding: 6px 22px 22px; display: grid; gap: 14px; }
  .bt-modelos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .bt-modelo { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 6px; padding: 14px 16px; border-radius: 20px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-height: 96px; align-content: start; }
  .bt-modelo b { font-size: 15.5px; }
  .bt-modelo span { font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .bt-modelo[aria-pressed="true"] { box-shadow: inset 0 0 0 2px var(--marca-menta), 0 0 18px color-mix(in srgb, var(--marca-menta) 30%, transparent); }
  .bt-campo { display: grid; gap: 6px; font-size: 13.5px; font-weight: 650; color: var(--sub); }
  .bt-campo input, .bt-campo select, .bt-campo textarea, .bt-entrada { box-sizing: border-box; width: 100%; min-height: 44px; padding: 10px 14px; border-radius: 14px; font: inherit; font-size: 15px; font-weight: 500; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); outline: none; }
  .bt-campo textarea { min-height: 92px; resize: vertical; line-height: 1.45; }
  .bt-campo input:focus, .bt-campo select:focus, .bt-campo textarea:focus, .bt-entrada:focus { border-color: var(--marca-menta); box-shadow: 0 0 0 3px color-mix(in srgb, var(--marca-menta) 25%, transparent); }
  .bt-linha { display: flex; gap: 8px; align-items: center; }
  .bt-linha > * { min-width: 0; }
  .bt-dica { font-size: 12.5px; color: var(--sub); line-height: 1.4; font-weight: 500; }
  .bt-vars { display: flex; gap: 6px; flex-wrap: wrap; }
  .bt-var { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 650; padding: 4px 10px; border-radius: 999px; color: var(--marca-azul); background: color-mix(in srgb, var(--marca-azul) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 30%, transparent); }
  html[data-tema="escuro"] .bt-var { color: #9fd2ff; }

  /* ---------- editor (tela cheia) ---------- */
  .bt-editor { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .bt-editor input, .bt-editor textarea, .bt-editor .bt-chat { -webkit-user-select: text; user-select: text; }
  .bt-editor { position: fixed; inset: 0; z-index: 60; display: grid; grid-template-rows: auto 1fr; background: var(--fundo); background-image: var(--aurora); color: var(--texto); font-family: var(--fonte); }
  .bt-topo { display: flex; align-items: center; gap: 8px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); border-bottom: 1px solid var(--vidro-linha); background: var(--vidro-fundo); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); min-width: 0; }
  .bt-nome { flex: 1 1 180px; min-width: 0; font-family: var(--fonte-titulo); font-size: 19px; font-weight: 800; border: 1px solid transparent; background: transparent; color: var(--texto); padding: 8px 10px; border-radius: 12px; }
  .bt-nome:hover, .bt-nome:focus { border-color: var(--vidro-borda); background: var(--vidro-item); outline: none; }
  .bt-topo .bt-sep { flex: 0 0 1px; align-self: stretch; background: var(--vidro-linha); margin: 4px 2px; }
  .bt-topo .bt-rot { display: inline; }
  .bt-ligado { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 700; color: var(--sub); padding: 0 6px; }
  .bt-corpo { position: relative; min-height: 0; display: grid; grid-template-columns: 220px 1fr auto; overflow: hidden; }
  .bt-paleta { overflow-y: auto; padding: 12px 10px 24px; border-right: 1px solid var(--vidro-linha); background: var(--vidro-fundo); display: grid; gap: 4px; align-content: start; }
  .bt-paleta h4 { margin: 10px 6px 4px; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
  .bt-peca { all: unset; box-sizing: border-box; cursor: grab; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 14px; font-size: 14px; font-weight: 650; touch-action: none; user-select: none; }
  .bt-peca:hover { background: var(--vidro-item); }
  .bt-peca i { font-style: normal; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; flex: none; font-size: 16px; background: color-mix(in srgb, var(--cor) 20%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cor) 50%, transparent); }
  .bt-peca small { display: block; font-size: 11.5px; color: var(--sub); font-weight: 500; }
  .bt-palco { position: relative; overflow: hidden; touch-action: none; cursor: grab; background-image: radial-gradient(circle, color-mix(in srgb, var(--texto) 16%, transparent) 1.1px, transparent 1.2px); }
  .bt-palco.arrastando { cursor: grabbing; }
  .bt-mundo { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  .bt-linhas { position: absolute; left: 0; top: 0; width: 1px; height: 1px; overflow: visible; pointer-events: none; }
  .bt-linhas path.bt-traco { fill: none; stroke: color-mix(in srgb, var(--marca-azul) 70%, var(--sub)); stroke-width: 2.4; }
  html[data-tema="escuro"] .bt-linhas path.bt-traco { stroke: #7cc4ff; }
  .bt-linhas path.bt-toque { fill: none; stroke: transparent; stroke-width: 16; pointer-events: stroke; cursor: pointer; }
  .bt-linhas path.bt-traco.sel { stroke: var(--marca-menta); stroke-width: 3.4; filter: drop-shadow(0 0 5px var(--marca-menta)); }
  .bt-linhas path.bt-traco.passou { stroke: var(--marca-menta); stroke-width: 3.4; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--marca-menta) 80%, transparent)); }
  .bt-linhas path.bt-temp { fill: none; stroke: var(--marca-menta); stroke-width: 2.6; stroke-dasharray: 6 5; }
  .bt-no { position: absolute; width: ${W}px; box-sizing: border-box; border-radius: 18px; background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho), 0 6px 20px rgba(4,23,43,.12); color: var(--texto); user-select: none; touch-action: none; cursor: grab; transition: box-shadow .15s ease; }
  html[data-tema="escuro"] .bt-no { background: rgba(11,42,71,.92); }
  .bt-no:hover { box-shadow: var(--vidro-brilho), 0 10px 28px rgba(4,23,43,.2); }
  .bt-no.sel { box-shadow: 0 0 0 2.5px var(--marca-menta), 0 0 24px color-mix(in srgb, var(--marca-menta) 45%, transparent); }
  .bt-no.erro { box-shadow: 0 0 0 2px #ff7a59, 0 6px 20px rgba(255,122,89,.25); }
  .bt-no.aviso:not(.erro) { box-shadow: 0 0 0 1.5px rgba(245,184,0,.85); }
  .bt-no.sel.erro, .bt-no.sel.aviso { box-shadow: 0 0 0 2.5px var(--marca-menta), 0 0 0 5px rgba(255,122,89,.55); }
  .bt-no.passou { box-shadow: 0 0 0 2px color-mix(in srgb, var(--marca-menta) 75%, transparent); }
  .bt-no.atual { box-shadow: 0 0 0 3px var(--marca-menta), 0 0 30px var(--marca-menta); animation: bt-pulso 1.6s ease-in-out infinite; }
  @keyframes bt-pulso { 50% { box-shadow: 0 0 0 3px var(--marca-menta), 0 0 10px var(--marca-menta); } }
  @media (prefers-reduced-motion: reduce) { .bt-no.atual { animation: none; } .bt-card, .bt-botao { transition: none; } }
  .bt-no-cab { display: flex; align-items: center; gap: 8px; padding: 10px 12px 6px; }
  .bt-no-cab i { font-style: normal; width: 30px; height: 30px; flex: none; border-radius: 10px; display: grid; place-items: center; font-size: 15px; background: color-mix(in srgb, var(--cor) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cor) 55%, transparent); }
  .bt-no-cab b { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bt-no-cab .bt-alerta { width: 20px; height: 20px; flex: none; color: #ff7a59; display: grid; place-items: center; }
  .bt-no-cab .bt-alerta.aviso { color: #f5b800; }
  .bt-no-cab .bt-alerta svg { width: 18px; height: 18px; }
  .bt-no-faixa { position: absolute; left: 14px; right: 14px; top: 0; height: 3px; border-radius: 0 0 4px 4px; background: var(--cor); opacity: .9; }
  .bt-no-corpo { padding: 0 12px 8px; font-size: 12.5px; line-height: 1.4; color: var(--sub); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; word-break: break-word; }
  .bt-no-img { margin: 0 12px 8px; height: 64px; border-radius: 10px; background: var(--vidro-item) center / cover no-repeat; box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .bt-saidas { display: grid; padding: 2px 0 8px; border-top: 1px solid var(--vidro-linha); }
  .bt-saida { position: relative; display: flex; justify-content: flex-end; align-items: center; min-height: 26px; padding: 0 18px 0 12px; font-size: 12px; font-weight: 650; color: var(--texto); }
  .bt-saida span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bt-saida.opcional span:first-child { color: var(--sub); font-weight: 550; }
  .bt-porta-saida { position: absolute; right: -9px; top: 50%; width: 16px; height: 16px; margin-top: -8px; border-radius: 50%; box-sizing: border-box; background: var(--fundo); border: 2.5px solid var(--marca-azul); cursor: crosshair; touch-action: none; }
  .bt-porta-saida::after { content: ""; position: absolute; inset: -10px; border-radius: 50%; }
  .bt-porta-saida.ligada { background: var(--marca-azul); }
  html[data-tema="escuro"] .bt-porta-saida { border-color: #7cc4ff; }
  html[data-tema="escuro"] .bt-porta-saida.ligada { background: #7cc4ff; }
  .bt-porta-entrada { position: absolute; left: -8px; top: 20px; width: 14px; height: 14px; border-radius: 50%; background: var(--fundo); border: 2.5px solid color-mix(in srgb, var(--sub) 80%, transparent); box-sizing: border-box; }
  .bt-no.alvo { box-shadow: 0 0 0 3px var(--marca-menta), 0 0 26px var(--marca-menta); }
  .bt-zoom { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 6px; z-index: 3; }
  .bt-zoom .bt-redondo { background: var(--vidro-forte); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
  .bt-zoom span { align-self: center; font-size: 12px; font-weight: 700; color: var(--sub); min-width: 40px; text-align: center; }
  .bt-mini { position: absolute; right: 12px; bottom: 12px; width: 180px; height: 120px; border-radius: 16px; z-index: 3; background: var(--vidro-forte); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); cursor: pointer; overflow: hidden; }
  .bt-mini rect.n { fill: color-mix(in srgb, var(--marca-azul) 55%, transparent); }
  .bt-mini rect.v { fill: color-mix(in srgb, var(--marca-menta) 14%, transparent); stroke: var(--marca-menta); stroke-width: 1.5; }
  .bt-problemas { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 4; max-width: calc(100% - 24px); }
  .bt-problemas > button { all: unset; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; background: var(--vidro-forte); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); white-space: nowrap; }
  .bt-problemas ul { list-style: none; margin: 6px 0 0; padding: 6px; border-radius: 18px; background: var(--vidro-forte); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); max-height: 40vh; overflow: auto; width: min(420px, 86vw); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); }
  .bt-problemas li { padding: 8px 10px; border-radius: 12px; font-size: 13px; line-height: 1.4; cursor: pointer; display: flex; gap: 8px; }
  .bt-problemas li:hover { background: var(--vidro-item); }
  .bt-problemas li i { font-style: normal; }
  .bt-lado { width: 0; overflow: hidden; border-left: 1px solid var(--vidro-linha); background: var(--vidro-fundo); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); display: flex; flex-direction: column; min-height: 0; }
  .bt-lado.aberto { width: 360px; }
  .bt-lado-topo { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 16px; }
  .bt-lado-topo h3 { flex: 1; margin: 0; font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px; min-width: 0; }
  .bt-lado-topo h3 i { font-style: normal; }
  .bt-lado-corpo { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 16px 24px; display: grid; gap: 14px; align-content: start; overscroll-behavior: contain; }
  .bt-opcao { display: flex; gap: 6px; align-items: center; }
  .bt-opcao em { font-style: normal; width: 26px; flex: none; text-align: center; font-weight: 800; color: var(--sub); }
  .bt-opcao input { flex: 1; }
  .bt-acoes-no { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 6px; border-top: 1px solid var(--vidro-linha); }
  .bt-chat { display: grid; gap: 6px; padding: 10px; border-radius: 18px; background: color-mix(in srgb, var(--chat) 70%, transparent); box-shadow: inset 0 0 0 1px var(--vidro-borda); max-height: 46vh; overflow-y: auto; }
  .bt-bolha { max-width: 86%; padding: 8px 11px; border-radius: 14px; font-size: 13.5px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; box-shadow: var(--sombra); }
  .bt-bolha.cliente { justify-self: start; background: var(--recebida); }
  .bt-bolha.loja { justify-self: end; background: var(--enviada); }
  .bt-bolha small { display: block; font-size: 10.5px; color: var(--sub); margin-top: 2px; }
  .bt-caminho { display: flex; flex-wrap: wrap; gap: 4px; }
  .bt-execs { display: grid; gap: 6px; }
  .bt-exec { all: unset; cursor: pointer; display: flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 12px; font-size: 13px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .bt-exec span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bt-fab { display: none; }
  .bt-visao-lista { display: none; overflow-y: auto; padding: 14px 14px 120px; gap: 10px; align-content: start; }
  .bt-lcard { display: grid; gap: 8px; padding: 12px 14px; border-radius: 20px; background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); }
  .bt-lcard.erro { border-color: #ff7a59; }
  .bt-lcard-cab { all: unset; cursor: pointer; display: flex; gap: 10px; align-items: center; }
  .bt-lcard-cab i { font-style: normal; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; flex: none; background: color-mix(in srgb, var(--cor) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cor) 55%, transparent); }
  .bt-lcard-cab div { flex: 1; min-width: 0; display: grid; }
  .bt-lcard-cab b { font-size: 14.5px; }
  .bt-lcard-cab small { font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bt-lcard .bt-saida-l { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 8px; align-items: center; font-size: 13px; font-weight: 650; }
  .bt-lcard .bt-saida-l select { min-height: 40px; padding: 6px 10px; border-radius: 12px; font: inherit; font-size: 13.5px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  .bt-fantasma { position: fixed; z-index: 80; pointer-events: none; padding: 8px 12px; border-radius: 14px; font-size: 14px; font-weight: 700; background: var(--vidro-forte); box-shadow: 0 0 0 2px var(--marca-menta), 0 10px 30px rgba(4,23,43,.3); transform: translate(-50%, -50%); }

  @media (max-width: 760px) {
    .bt-cab .titulo-grande { font-size: 32px; }
    .bt-cab .bt-botao { width: 100%; }
    .bt-modelos { grid-template-columns: 1fr; }
    .bt-corpo { grid-template-columns: 1fr; }
    .bt-paleta { display: none; }
    .bt-topo { gap: 6px; padding-left: 8px; padding-right: 8px; flex-wrap: wrap; row-gap: 6px; }
    .bt-topo > * { order: 3; }
    .bt-topo .bt-voltar { order: 0; }
    .bt-topo .bt-nome { order: 1; flex: 1 1 calc(100% - 150px); }
    .bt-topo .bt-publicar { order: 2; }
    .bt-topo .bt-ligado { margin-right: auto; }
    .bt-topo .bt-rot, .bt-topo .bt-sep, .bt-ligado span { display: none; }
    .bt-topo .bt-botao { padding: 0 12px; }
    .bt-nome { font-size: 17px; }
    .bt-mini { display: none; }
    .bt-lado { position: fixed; left: 0; right: 0; bottom: 0; width: auto !important; max-height: 0; z-index: 70; border-left: 0; border-radius: 24px 24px 0 0; box-shadow: 0 -10px 40px rgba(4,23,43,.3); background: var(--fundo); transition: max-height .2s ease; }
    .bt-lado.aberto { max-height: 74dvh; }
    .bt-lado-corpo { padding-bottom: calc(24px + env(safe-area-inset-bottom)); }
    .bt-fab { display: grid; position: absolute; right: 14px; bottom: 14px; z-index: 5; width: 56px; height: 56px; }
    .bt-zoom { bottom: 14px; }
    .bt-corpo.lista .bt-palco { display: none; }
    .bt-corpo.lista .bt-visao-lista { display: grid; }
  }
  `;

  // ---------- estado ----------
  const s = { ui: null, caixa: null, base: null, baseEm: 0, ed: null };
  const UI = () => s.ui || window.Sintonia?.ui;
  const ehGestao = () => { const ui = UI(); return ui && ui.ehGestor(ui.estado.eu); };
  const celular = () => matchMedia('(max-width: 760px)').matches;
  const uid = (p = 'n') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const curto = (t, n = 90) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  function estilo() {
    if (document.getElementById('estilo-bot')) return;
    const st = document.createElement('style');
    st.id = 'estilo-bot';
    st.textContent = CSS;
    document.head.append(st);
  }

  /** Funis, tags, equipe, campos da ficha e agentes de IA (para os campos dos blocos). */
  async function base(forcar) {
    if (!forcar && s.base && Date.now() - s.baseEm < 30000) return s.base;
    const ui = UI();
    const [funis, tags, equipe, campos, agentes] = await Promise.all([
      ui.api('/api/funis').catch(() => []),
      ui.api('/api/tags').catch(() => []),
      ui.api('/api/equipe').catch(() => ({ pessoas: [] })),
      ui.api('/api/campos-contato').catch(() => []),
      // Estúdio "Agentes de IA" (outro módulo): se ainda não existe, não pergunta de novo nesta sessão.
      s.semAgentes ? [] : ui.api('/api/agentes-ia').catch(() => { s.semAgentes = true; return []; }),
    ]);
    const etapas = new Map();
    for (const f of funis) for (const e of f.etapas || []) etapas.set(e.id, { ...e, funilNome: f.nome, funilId: f.id, sistema: f.sistema });
    s.base = { funis, tags, etapas, pessoas: (equipe.pessoas || []).filter((p) => p.ativo !== false), campos: Array.isArray(campos) ? campos : [], agentes: Array.isArray(agentes) ? agentes : (agentes?.agentes || []) };
    s.baseEm = Date.now();
    return s.base;
  }
  const etapaNome = (id) => { const e = s.base?.etapas.get(id); return e ? `${e.funilNome} › ${e.nome}` : 'etapa?'; };
  const tagNome = (id) => s.base?.tags.find((t) => t.id === id)?.nome || s.base?.etapas.get(id)?.nome || 'tag?';
  const pessoaNome = (id) => (id ? s.base?.pessoas.find((p) => p.id === id)?.nome || 'pessoa' : 'ninguém');

  function duracao(min) {
    min = Number(min) || 0;
    if (min === 0) return 'na hora';
    if (min % 1440 === 0) { const d = min / 1440; return `${d} dia${d > 1 ? 's' : ''}`; }
    if (min % 60 === 0) { const h = min / 60; return `${h} hora${h > 1 ? 's' : ''}`; }
    return `${min} min`;
  }

  function fraseGatilho(g) {
    if (!g) return 'Início manual';
    switch (g.tipo) {
      case 'nova_conversa': return `Quando uma cliente nova escrever${g.unidade ? ` (${UNIDADES[g.unidade]})` : ''}`;
      case 'palavra_chave': return (g.palavras || []).length ? `Quando a cliente escrever ${g.palavras.map((p) => `“${p}”`).join(', ')}` : 'Quando a cliente escrever… (falta a palavra)';
      case 'entrou_na_etapa': return `Quando entrar em “${etapaNome(g.etapaId)}”`;
      case 'tag_marcada': return `Quando marcarem a tag “${tagNome(g.tagId)}”`;
      case 'fora_do_horario': return `Quando escrever com a loja fechada${g.unidade ? ` (${UNIDADES[g.unidade]})` : ''}`;
      default: return 'Manual: pelo botão “Iniciar bot” na conversa';
    }
  }

  // ---------- grafo (espelho do servidor: src/bot/esquema.ts) ----------
  function saidasDe(n) {
    switch (n.tipo) {
      case 'pergunta': return [...(n.opcoes || []).map((o, i) => ({ id: o.id, rotulo: `${i + 1}. ${o.texto || 'opção'}` })), { id: 'outro', rotulo: 'Não entendeu', opcional: true }, { id: 'sem_resposta', rotulo: 'Não respondeu', opcional: true }];
      case 'pergunta_aberta': return [{ id: 'proximo', rotulo: 'Respondeu' }, { id: 'invalida', rotulo: 'Resposta inválida', opcional: true }, { id: 'sem_resposta', rotulo: 'Não respondeu', opcional: true }];
      case 'condicao': return [{ id: 'sim', rotulo: 'Sim' }, { id: 'nao', rotulo: 'Não' }];
      case 'esperar_resposta': return [{ id: 'respondeu', rotulo: 'Respondeu' }, { id: 'sem_resposta', rotulo: 'Não respondeu' }];
      case 'webhook': return [{ id: 'ok', rotulo: 'Deu certo' }, { id: 'erro', rotulo: 'Deu erro', opcional: true }];
      case 'agente_ia': return [{ id: 'concluiu', rotulo: 'Concluiu' }, { id: 'tempo_esgotado', rotulo: 'Prazo acabou', opcional: true }];
      case 'transferir': case 'fim': return [];
      default: return [{ id: 'proximo', rotulo: 'Depois' }];
    }
  }

  function novoNo(tipo, x, y) {
    const n = { id: uid(), tipo, x: Math.round(x), y: Math.round(y) };
    switch (tipo) {
      case 'inicio': n.gatilho = { tipo: 'manual' }; break;
      case 'mensagem': n.texto = ''; n.so_no_horario = false; break;
      case 'pergunta': n.texto = ''; n.opcoes = [{ id: uid('o'), texto: '' }, { id: uid('o'), texto: '' }]; n.tentativas = 2; n.tempoLimiteMin = 1440; break;
      case 'pergunta_aberta': n.texto = ''; n.validacao = 'texto'; n.tentativas = 2; n.tempoLimiteMin = 1440; break;
      case 'condicao': n.condicao = { se: 'horario_loja', valor: '', operador: 'preenchido' }; break;
      case 'esperar': n.minutos = 60; break;
      case 'esperar_resposta': n.minutos = 60; break;
      case 'mover_etapa': { const f = s.base?.funis[0]; n.funilId = f?.id || ''; n.etapaId = f?.etapas?.[0]?.id || ''; break; }
      case 'marcar_tag': case 'desmarcar_tag': n.tagId = s.base?.tags[0]?.id || ''; break;
      case 'atribuir': n.usuarioId = null; break;
      case 'mudar_modo': n.modo = 'humano'; break;
      case 'lembrete': n.em_minutos = 0; n.texto = 'Ligar para {primeiro_nome}'; break;
      case 'webhook': n.url = 'https://'; break;
      case 'agente_ia': n.objetivo = ''; n.saida = { tipo: 'agendou' }; n.dias = 3; break;
      case 'transferir': n.texto = 'Vou chamar uma atendente para continuar com você. 💛'; break;
    }
    return n;
  }

  function problemas(g) {
    const p = [];
    const erro = (noId, mensagem) => p.push({ nivel: 'erro', noId, mensagem });
    const aviso = (noId, mensagem) => p.push({ nivel: 'aviso', noId, mensagem });
    const inicios = g.nos.filter((n) => n.tipo === 'inicio');
    if (!inicios.length) erro(null, 'Falta o bloco Início.');
    inicios.slice(1).forEach((n) => erro(n.id, 'Só pode haver um bloco Início.'));
    const usadas = new Set(g.ligacoes.map((l) => `${l.de}|${l.saida}`));
    const alc = new Set(); const fila = inicios.slice(0, 1).map((n) => n.id);
    while (fila.length) { const x = fila.shift(); if (alc.has(x)) continue; alc.add(x); for (const l of g.ligacoes) if (l.de === x) fila.push(l.para); }
    for (const n of g.nos) {
      const nome = n.titulo || INFO[n.tipo].nome;
      if (n.tipo !== 'inicio' && !alc.has(n.id)) aviso(n.id, `${nome}: nenhum caminho chega aqui.`);
      for (const sd of saidasDe(n)) if (!sd.opcional && !usadas.has(`${n.id}|${sd.id}`)) {
        if (n.tipo === 'inicio') erro(n.id, 'Ligue o Início ao primeiro bloco.');
        else aviso(n.id, `${nome}: a saída “${sd.rotulo}” está solta (o bot termina ali).`);
      }
      if (n.tipo === 'inicio') {
        const gt = n.gatilho || {};
        if (gt.tipo === 'palavra_chave' && !(gt.palavras || []).some((x) => x.trim())) erro(n.id, 'Início: escreva a palavra-chave.');
        if (gt.tipo === 'entrou_na_etapa' && !gt.etapaId) erro(n.id, 'Início: escolha a etapa.');
        if (gt.tipo === 'tag_marcada' && !gt.tagId) erro(n.id, 'Início: escolha a tag.');
      }
      if (n.tipo === 'mensagem' && !String(n.texto || '').trim() && !n.midiaUrl && !n.midiaId) erro(n.id, `${nome}: escreva a mensagem.`);
      if ((n.tipo === 'pergunta' || n.tipo === 'pergunta_aberta') && !String(n.texto || '').trim()) erro(n.id, `${nome}: escreva a pergunta.`);
      if (n.tipo === 'pergunta' && !(n.opcoes || []).length) erro(n.id, `${nome}: a pergunta não tem opções.`);
      if (n.tipo === 'pergunta' && (n.opcoes || []).some((o) => !String(o.texto || '').trim())) erro(n.id, `${nome}: há opção sem texto.`);
      if (n.tipo === 'condicao') { const c = n.condicao || {}; if (['tag', 'etapa', 'unidade', 'modo', 'resposta_contem'].includes(c.se) && !String(c.valor || '').trim()) erro(n.id, `${nome}: complete a condição.`); if (c.se === 'campo' && !c.campo) erro(n.id, `${nome}: escolha o campo.`); }
      if (n.tipo === 'mover_etapa' && (!n.funilId || !n.etapaId)) erro(n.id, `${nome}: escolha o funil e a etapa.`);
      if ((n.tipo === 'marcar_tag' || n.tipo === 'desmarcar_tag') && !n.tagId) erro(n.id, `${nome}: escolha a tag.`);
      if (n.tipo === 'webhook' && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(n.url || '')) erro(n.id, `${nome}: endereço inválido.`);
      if (n.tipo === 'agente_ia' && String(n.objetivo || '').trim().length < 3) erro(n.id, `${nome}: escreva o objetivo.`);
    }
    return p;
  }

  function resumoNo(n) {
    switch (n.tipo) {
      case 'inicio': return fraseGatilho(n.gatilho);
      case 'mensagem': return (n.midiaUrl || n.midiaId ? '🖼️ ' : '') + (curto(n.texto) || (n.midiaUrl || n.midiaId ? 'Imagem' : 'Escreva a mensagem…'));
      case 'pergunta': return curto(n.texto) || 'Escreva a pergunta…';
      case 'pergunta_aberta': return `${curto(n.texto, 60) || 'Escreva a pergunta…'} · ${VALIDACOES[n.validacao] || 'Texto'}${n.variavel ? ` → {${n.variavel}}` : ''}`;
      case 'condicao': { const c = n.condicao || {}; const nome = (CONDICOES.find(([k]) => k === c.se) || [, ''])[1];
        const v = c.se === 'tag' ? tagNome(c.valor) : c.se === 'etapa' ? etapaNome(c.valor) : c.se === 'unidade' ? UNIDADES[c.valor] || '' : c.se === 'modo' ? MODOS[c.valor] || '' : c.se === 'campo' ? `${c.campo || '?'} ${c.operador === 'preenchido' ? 'preenchido' : `${c.operador} “${c.valor || ''}”`}` : c.valor ? `“${c.valor}”` : '';
        return `Se ${nome.toLowerCase()} ${v}`.trim(); }
      case 'esperar': return `Esperar ${duracao(n.minutos)}`;
      case 'esperar_resposta': return `Até ${duracao(n.minutos)}${n.variavel ? ` → {${n.variavel}}` : ''}`;
      case 'mover_etapa': return n.etapaId ? `Para “${etapaNome(n.etapaId)}”` : 'Escolha a etapa';
      case 'marcar_tag': return n.tagId ? `Marcar “${tagNome(n.tagId)}”` : 'Escolha a tag';
      case 'desmarcar_tag': return n.tagId ? `Tirar “${tagNome(n.tagId)}”` : 'Escolha a tag';
      case 'atribuir': return `Para ${pessoaNome(n.usuarioId)}${n.unidade ? ` (só ${UNIDADES[n.unidade]})` : ''}`;
      case 'mudar_modo': return MODOS[n.modo] || n.modo;
      case 'lembrete': return `${duracao(n.em_minutos)} · ${curto(n.texto, 50) || 'Ligar'}`;
      case 'webhook': return curto(n.url, 60);
      case 'agente_ia': { const ag = n.agenteIaId ? s.base?.agentes.find((a) => a.id === n.agenteIaId)?.nome || 'agente' : 'Agente padrão';
        const sai = n.saida?.tipo === 'mensagens' ? `até ${n.saida.n} msgs` : n.saida?.tipo === 'prazo' ? `por ${n.dias} dia(s)` : 'até agendar';
        return `${ag} · ${sai} · ${curto(n.objetivo, 60) || 'Escreva o objetivo…'}`; }
      case 'transferir': return curto(n.texto) || 'Passa para a equipe';
      case 'fim': return 'Encerra o bot';
    }
    return '';
  }

  // ---------- campos dos formulários ----------
  function campo(rotulo, entrada, dica) {
    const { el } = UI();
    return el('label', { class: 'bt-campo' }, el('span', { text: rotulo }), entrada, dica ? el('span', { class: 'bt-dica', text: dica }) : null);
  }
  function entradaTexto(valor, aoMudar, o = {}) {
    const { el } = UI();
    const e = el(o.area ? 'textarea' : 'input', { maxlength: String(o.max || 1000), placeholder: o.placeholder || '', ...(o.tipo ? { type: o.tipo } : {}), ...(o.attrs || {}) });
    e.value = valor ?? '';
    e.addEventListener('input', () => aoMudar(e.value));
    return e;
  }
  function selecao(opcoes, valor, aoMudar, attrs = {}) {
    const { el } = UI();
    const sel = el('select', attrs, ...opcoes.map(([v, t]) => el('option', { value: v, text: t })));
    sel.value = valor ?? '';
    if (sel.value !== String(valor ?? '') && opcoes.length) sel.value = opcoes[0][0];
    sel.addEventListener('change', () => aoMudar(sel.value));
    return sel;
  }
  function campoDuracao(minutos, aoMudar, minimo = 1) {
    const { el } = UI();
    const unid = minutos % 1440 === 0 && minutos >= 1440 ? 1440 : minutos % 60 === 0 && minutos >= 60 ? 60 : 1;
    const num = el('input', { type: 'number', min: String(minimo === 0 ? 0 : 1), max: '43200', inputmode: 'numeric', class: 'bt-entrada' });
    num.value = String(Math.round(minutos / unid));
    const sel = el('select', { class: 'bt-entrada', style: 'width:auto' }, el('option', { value: '1', text: 'minutos' }), el('option', { value: '60', text: 'horas' }), el('option', { value: '1440', text: 'dias' }));
    sel.value = String(unid);
    const mudar = () => aoMudar(Math.max(minimo, Math.round(Number(num.value || 0) * Number(sel.value))));
    num.addEventListener('input', mudar); sel.addEventListener('change', mudar);
    return el('div', { class: 'bt-linha' }, num, sel);
  }
  const opcoesEtapas = () => [...(s.base?.etapas.values() || [])].map((e) => [e.id, `${e.funilNome} › ${e.nome}`]);
  const opcoesTags = (semSistema) => [...(s.base?.tags || []).map((t) => [t.id, `🏷️ ${t.nome}`]), ...[...(s.base?.etapas.values() || [])].filter((e) => !(semSistema && e.sistema)).map((e) => [e.id, `${e.funilNome} › ${e.nome}`])];
  const opcoesPessoas = () => [['', 'Ninguém (sem dona)'], ...(s.base?.pessoas || []).map((p) => [p.id, p.nome])];
  const opcoesCampos = () => [['', '— só guardar na variável —'], ['nome', 'Nome'], ['email', 'E-mail'], ['nascimento', 'Data de nascimento'], ['observacoes', 'Observações'], ...(s.base?.campos || []).map((c) => [`campo:${c.id}`, `Campo: ${c.nome}`])];

  // ---------- lista de bots ----------
  async function desenhar(caixa, ui) {
    s.ui = ui; s.caixa = caixa;
    estilo();
    caixa.classList.add('bt-caixa');
    const { el } = ui;
    const tela = el('div', { class: 'bt-tela' });
    caixa.replaceChildren(tela);
    tela.append(el('div', { class: 'bt-cab' }, el('h1', { class: 'titulo-grande' }, el('span', { class: 'bt-ic', html: SVG.robo }), el('span', { text: 'Bots' })),
      ehGestao() ? el('button', { class: 'bt-botao', type: 'button', onclick: () => novoBot() }, el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Novo bot' })) : null));
    tela.append(abasAutomacoes('bots'));
    tela.append(el('p', { class: 'bt-sub', text: 'Bots são conversas guiadas: menu de opções, perguntas, condições e ações, desenhadas como um fluxo. O bot responde antes da IA e para quando alguém da equipe responde.' }));
    if (!ehGestao()) { tela.append(el('div', { class: 'bt-vazio' }, el('b', { text: 'Só a gestão mexe nos bots.' }), el('span', { text: 'Para iniciar um bot numa conversa, toque no chip de quem atende (embaixo, na conversa) → “Iniciar bot”.' }))); return; }
    const corpo = el('div', { class: 'bt-lista' }, el('p', { class: 'bt-dica', text: 'Carregando…' }));
    tela.append(corpo);
    let lista;
    try { [lista] = await Promise.all([ui.api('/api/bots'), base(true)]); } catch (x) { corpo.replaceChildren(el('p', { class: 'bt-dica', text: x.message })); return; }
    if (!lista.length) {
      corpo.replaceChildren(el('div', { class: 'bt-vazio' }, el('b', { text: 'Nenhum bot ainda.' }), el('span', { text: 'Comece por um modelo pronto: boas-vindas com menu, fora do horário ou qualificação com agendamento pela IA.' }),
        el('button', { class: 'bt-botao', type: 'button', onclick: () => novoBot() }, el('span', { text: 'Criar meu primeiro bot' }))));
      return;
    }
    corpo.replaceChildren(...lista.map((f) => cartaoBot(f, () => desenhar(caixa, ui))));
  }

  function abasAutomacoes(ativa) {
    estilo();
    const { el } = UI();
    const ir = (v) => { if (v === ativa) return; UI().mostrar(v === 'bots' ? 'bot' : 'automacoes'); };
    return el('div', { class: 'bt-abas', role: 'group', 'aria-label': 'Automações ou bots' },
      el('button', { class: 'bt-aba', type: 'button', 'aria-pressed': String(ativa === 'automacoes'), onclick: () => ir('automacoes') }, el('span', { html: SVG.raio, style: 'display:grid;color:#f5b800' }), el('span', { text: 'Automações' })),
      el('button', { class: 'bt-aba', type: 'button', 'aria-pressed': String(ativa === 'bots'), onclick: () => ir('bots') }, el('span', { html: SVG.robo, style: 'display:grid' }), el('span', { text: 'Bots' })));
  }

  function seloStatus(f) {
    const { el } = UI();
    if (!f.versao) return el('span', { class: 'bt-selo aviso', text: 'Rascunho (nunca publicado)' });
    return el('span', { class: 'bt-selo' + (f.ligado ? ' ligado' : ''), text: f.ligado ? `Ligado · v${f.versao}` : `Desligado · v${f.versao}` });
  }

  function chave(marcada, aoMudar, rotulo) {
    const { el } = UI();
    const c = el('input', { type: 'checkbox', class: 'bt-chave', role: 'switch', 'aria-label': rotulo, onclick: (e) => e.stopPropagation() });
    c.checked = marcada;
    c.addEventListener('change', () => aoMudar(c.checked, c));
    return c;
  }

  async function ligarBot(f, v, c) {
    try {
      const r = await UI().post(`/api/bots/${f.id}/${v ? 'ligar' : 'desligar'}`);
      f.ligado = r.ligado;
      UI().toast(r.ligado ? `“${f.nome}” ligado 🤖` : `“${f.nome}” desligado`);
      return r;
    } catch (x) { if (c) c.checked = !v; UI().toast(x.message); return null; }
  }

  function cartaoBot(f, aoMudar) {
    const { el } = UI();
    const selo = seloStatus(f);
    const sw = chave(f.ligado, async (v, c) => { if (await ligarBot(f, v, c)) selo.replaceWith(Object.assign(seloStatus(f))); aoMudar(); }, `Ligar ou desligar ${f.nome}`);
    if (!f.versao) sw.disabled = true;
    const abrir = () => abrirEditor(f.id, aoMudar);
    return el('div', { class: 'bt-card', role: 'button', tabindex: '0', onclick: abrir, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) abrir(); } },
      el('div', { class: 'bt-l1' }, el('span', { class: 'bt-ic', html: SVG.robo, style: 'width:36px;height:36px' }), el('b', { text: f.nome }), sw),
      el('div', { class: 'bt-quando', text: fraseGatilho(f.gatilho) }),
      el('div', { class: 'bt-l3' }, selo, f.rascunhoDiferente && f.versao ? el('span', { class: 'bt-selo aviso', text: 'Rascunho com mudanças' }) : null, el('span', { text: `${f.blocos} bloco${f.blocos === 1 ? '' : 's'}` }), f.publicadoEm ? el('span', { text: `publicado ${UI().quando(f.publicadoEm)}` }) : null));
  }

  /** Novo bot: em branco ou de um modelo. `inicio` = gatilho já escolhido (ex.: pela etapa). */
  async function novoBot(o = {}) {
    const ui = UI(); const { el } = ui;
    estilo();
    let modelos = [];
    try { [modelos] = await Promise.all([ui.api('/api/bots/modelos'), base()]); } catch (x) { ui.toast(x.message); return; }
    let escolha = o.gatilho ? '' : modelos[0]?.id || '';
    const nome = entradaTexto(o.nome || '', () => {}, { max: 80, placeholder: 'Ex.: Boas-vindas' });
    const d = el('dialog', { class: 'bt-dialogo' });
    const grade = el('div', { class: 'bt-modelos' });
    const desenharGrade = () => grade.replaceChildren(
      ...[{ id: '', nome: 'Em branco', descricao: o.gatilho ? fraseGatilho(o.gatilho) : 'Só o Início; você monta o resto.' }, ...modelos].map((m) =>
        el('button', { class: 'bt-modelo', type: 'button', 'aria-pressed': String(escolha === m.id), onclick: () => { escolha = m.id; if (!nome.value || nome.dataset.auto) { nome.value = m.id ? m.nome : ''; nome.dataset.auto = '1'; } desenharGrade(); } },
          el('b', { text: m.nome }), el('span', { text: m.descricao }))));
    desenharGrade();
    if (!nome.value && escolha) { nome.value = modelos[0].nome; nome.dataset.auto = '1'; }
    nome.addEventListener('input', () => { delete nome.dataset.auto; });
    const criar = el('button', { class: 'bt-botao', type: 'button', text: 'Criar e abrir', onclick: async () => {
      if (!nome.value.trim()) { nome.focus(); ui.toast('Dê um nome ao bot.'); return; }
      criar.disabled = true;
      try {
        const corpo = { nome: nome.value.trim() };
        if (escolha) corpo.modelo = escolha;
        else corpo.rascunho = { nos: [{ id: 'inicio', tipo: 'inicio', x: 0, y: 0, gatilho: o.gatilho || { tipo: 'manual' } }], ligacoes: [] };
        const f = await ui.post('/api/bots', corpo);
        d.close();
        abrirEditor(f.id, o.aoMudar || (() => { if (s.caixa && UI().estado.vista === 'bot') desenhar(s.caixa, UI()); }));
      } catch (x) { ui.toast(x.message); criar.disabled = false; }
    } });
    d.append(el('div', { class: 'bt-dlg-topo' }, el('h2', { text: 'Novo bot' }), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: () => d.close() })),
      el('div', { class: 'bt-dlg-corpo' }, campo('Nome do bot', nome), el('span', { class: 'bt-dica', text: 'Comece de um modelo pronto ou em branco:' }), grade, el('div', { class: 'bt-linha', style: 'justify-content:flex-end' }, criar)));
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
  }

  // ---------- raio ⚡ da etapa: automação simples ou bot ----------
  async function escolherDaEtapa({ etapaId, etapaNome: nomeEtapa, automacoes = 0, abrirAutomacao, aoMudar } = {}) {
    const ui = UI(); const { el } = ui;
    estilo();
    let bots = [];
    try { [bots] = await Promise.all([ui.api('/api/bots'), base()]); } catch { /* sem bots */ }
    const daEtapa = bots.filter((b) => b.gatilho?.tipo === 'entrou_na_etapa' && b.gatilho.etapaId === etapaId);
    const d = el('dialog', { class: 'bt-dialogo', style: 'width:min(560px, calc(100vw - 24px))' });
    const fechar = () => d.close();
    const opcao = (icone, titulo, texto, acao) => el('button', { class: 'bt-modelo', type: 'button', onclick: () => { fechar(); acao(); } },
      el('b', {}, el('span', { html: icone, style: 'display:inline-grid;width:18px;height:18px;vertical-align:-3px;margin-right:6px' }), document.createTextNode(titulo)), el('span', { text: texto }));
    d.append(el('div', { class: 'bt-dlg-topo' }, el('h2', { text: nomeEtapa || 'Etapa' }), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })),
      el('div', { class: 'bt-dlg-corpo' },
        el('span', { class: 'bt-dica', text: 'Quando a cliente entrar nesta etapa…' }),
        el('div', { class: 'bt-modelos' },
          opcao(SVG.raio, 'Automação simples', automacoes ? `${automacoes} nesta etapa. Passos em lista: mensagem, esperar, mover…` : 'Passos em lista: mandar mensagem, esperar, mover, marcar tag.', () => abrirAutomacao && abrirAutomacao()),
          opcao(SVG.robo, 'Bot (fluxo)', daEtapa.length ? `${daEtapa.length} bot(s) nesta etapa. Menu, perguntas e caminhos.` : 'Conversa guiada com menu, perguntas, condições e IA.', () => {
            if (!daEtapa.length) novoBot({ nome: `Ao entrar em ${nomeEtapa || 'etapa'}`, gatilho: { tipo: 'entrou_na_etapa', etapaId }, aoMudar });
            else escolherBotDaEtapa(daEtapa, etapaId, nomeEtapa, aoMudar);
          }))));
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    d.showModal();
  }
  function escolherBotDaEtapa(lista, etapaId, nomeEtapa, aoMudar) {
    const { el } = UI();
    const d = el('dialog', { class: 'bt-dialogo', style: 'width:min(560px, calc(100vw - 24px))' });
    d.append(el('div', { class: 'bt-dlg-topo' }, el('h2', { text: `Bots · ${nomeEtapa || ''}` }), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: () => d.close() })),
      el('div', { class: 'bt-dlg-corpo' }, el('div', { class: 'bt-lista' }, ...lista.map((f) => { const c = cartaoBot(f, () => {}); c.addEventListener('click', () => d.close()); return c; })),
        el('button', { class: 'bt-botao leve', type: 'button', onclick: () => { d.close(); novoBot({ nome: `Ao entrar em ${nomeEtapa || 'etapa'}`, gatilho: { tipo: 'entrou_na_etapa', etapaId }, aoMudar }); } }, el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Novo bot nesta etapa' }))));
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  // ---------- "Iniciar bot" na conversa ----------
  async function iniciarNaConversa(conversaId) {
    const ui = UI(); const { el } = ui;
    estilo();
    if (!conversaId) { ui.toast('Abra uma conversa primeiro.'); return; }
    let r;
    try { r = await ui.api(`/api/conversas/${conversaId}/bot`); } catch (x) { ui.toast(x.message); return; }
    const d = el('dialog', { class: 'bt-dialogo', style: 'width:min(520px, calc(100vw - 24px))' });
    const fechar = () => d.close();
    const corpo = el('div', { class: 'bt-dlg-corpo' });
    if (r.ativa) {
      corpo.append(el('div', { class: 'bt-card', style: 'cursor:default' }, el('div', { class: 'bt-l1' }, el('span', { class: 'bt-ic', html: SVG.robo, style: 'width:36px;height:36px' }), el('b', { text: r.ativa.fluxoNome || 'Bot' }), el('span', { class: 'bt-selo ligado', text: STATUS[r.ativa.status] || r.ativa.status })),
        el('span', { class: 'bt-dica', text: 'Este bot está conduzindo a conversa agora.' }),
        el('button', { class: 'bt-botao perigo', type: 'button', text: 'Parar o bot', onclick: async () => { try { await ui.post(`/api/conversas/${conversaId}/bot/parar`); ui.toast('Bot parado'); fechar(); } catch (x) { ui.toast(x.message); } } })));
    }
    if (!r.fluxos.length) corpo.append(el('div', { class: 'bt-vazio' }, el('b', { text: 'Nenhum bot publicado.' }), el('span', { text: 'A gestão cria e publica bots em Automações → Bots.' })));
    else corpo.append(el('span', { class: 'bt-dica', text: r.ativa ? 'Ou troque por outro bot:' : 'Escolha o bot para começar agora nesta conversa:' }),
      el('div', { class: 'bt-lista' }, ...r.fluxos.map((f) => el('button', { class: 'bt-card', type: 'button', onclick: async () => {
        try { await ui.post(`/api/conversas/${conversaId}/bot`, { fluxoId: f.id, substituir: Boolean(r.ativa) }); ui.toast(`“${f.nome}” iniciado 🤖`); fechar(); ui.abrir?.(conversaId); } catch (x) { ui.toast(x.message); }
      } }, el('div', { class: 'bt-l1' }, el('span', { class: 'bt-ic', html: SVG.robo, style: 'width:36px;height:36px' }), el('b', { text: f.nome }), el('span', { class: 'bt-selo' + (f.ligado ? ' ligado' : ''), text: f.ligado ? 'Ligado' : 'Só manual' }))))));
    d.append(el('div', { class: 'bt-dlg-topo' }, el('h2', { text: 'Iniciar bot' }), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })), corpo);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    d.showModal();
  }

  // ================================================================ editor
  async function abrirEditor(id, aoMudar) {
    const ui = UI(); const { el } = ui;
    estilo();
    let fluxo;
    try { [fluxo] = await Promise.all([ui.api(`/api/bots/${id}`), base()]); } catch (x) { ui.toast(x.message); return; }
    if (s.ed) s.ed.fechar(true);
    const ed = {
      fluxo, g: copia(fluxo.rascunho), sel: null, view: { x: 0, y: 0, z: 1 }, hist: [], futuro: [], pendente: null, sujo: false,
      servidor: fluxo.problemas || [], teste: null, els: new Map(), lista: celular(), aoMudar,
    };
    s.ed = ed;

    // ----- estrutura -----
    const raiz = el('div', { class: 'bt-editor', role: 'dialog', 'aria-label': `Editor do bot ${fluxo.nome}` });
    const nome = el('input', { class: 'bt-nome', maxlength: '80', 'aria-label': 'Nome do bot' }); nome.value = fluxo.nome;
    nome.addEventListener('input', () => { ed.fluxo.nome = nome.value; marcarSujo(); });
    const bDesfazer = el('button', { class: 'bt-redondo', type: 'button', title: 'Desfazer (Ctrl+Z)', 'aria-label': 'Desfazer', html: SVG.desfazer, onclick: () => desfazer() });
    const bRefazer = el('button', { class: 'bt-redondo', type: 'button', title: 'Refazer (Ctrl+Shift+Z)', 'aria-label': 'Refazer', html: SVG.refazer, onclick: () => refazer() });
    const bVisao = el('button', { class: 'bt-redondo', type: 'button', title: 'Ver em lista / no palco', 'aria-label': 'Alternar lista e palco', onclick: () => { ed.lista = !ed.lista; aplicarVisao(); } });
    const bTestar = el('button', { class: 'bt-botao leve', type: 'button', title: 'Testar numa conversa de teste', onclick: () => abrirTeste() }, el('span', { html: SVG.play, style: 'display:grid' }), el('span', { class: 'bt-rot', text: 'Testar' }));
    const bSalvar = el('button', { class: 'bt-botao leve', type: 'button', title: 'Salvar rascunho (Ctrl+S)', onclick: () => salvar() }, el('span', { html: SVG.salvar, style: 'display:grid' }), el('span', { class: 'bt-rot', text: 'Salvar' }));
    const bPublicar = el('button', { class: 'bt-botao bt-publicar', type: 'button', title: 'Publicar a versão que roda', onclick: () => publicar() }, el('span', { html: SVG.foguete, style: 'display:grid' }), el('span', { class: 'bt-rot', text: 'Publicar' }));
    const swLigado = chave(fluxo.ligado, async (v, c) => { const r = await ligarBot(ed.fluxo, v, c); if (r) { ed.fluxo.ligado = r.ligado; ed.aoMudar?.(); } }, 'Ligar ou desligar o bot');
    const rotLigado = el('label', { class: 'bt-ligado' }, swLigado, el('span', { text: 'Ligado' }));
    const topo = el('div', { class: 'bt-topo' },
      el('button', { class: 'bt-redondo bt-voltar', type: 'button', 'aria-label': 'Voltar', title: 'Voltar', html: SVG.voltar, onclick: () => ed.fechar() }), nome,
      bDesfazer, bRefazer, bVisao, el('span', { class: 'bt-sep' }), rotLigado, bTestar, bSalvar, bPublicar);

    const paleta = el('div', { class: 'bt-paleta', 'aria-label': 'Blocos: arraste para o palco ou clique para adicionar' });
    const palco = el('div', { class: 'bt-palco', tabindex: '0', 'aria-label': 'Palco do fluxo' });
    const mundo = el('div', { class: 'bt-mundo' });
    const svgNS = 'http://www.w3.org/2000/svg';
    const linhas = document.createElementNS(svgNS, 'svg'); linhas.setAttribute('class', 'bt-linhas');
    mundo.append(linhas);
    palco.append(mundo);
    const zoomTxt = el('span', { text: '100%' });
    palco.append(el('div', { class: 'bt-zoom' },
      el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Diminuir zoom', html: SVG.menos, onclick: () => zoomEm(1 / 1.2) }), zoomTxt,
      el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Aumentar zoom', html: SVG.mais, onclick: () => zoomEm(1.2) }),
      el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Ajustar à tela', title: 'Ajustar à tela', html: SVG.ajustar, onclick: () => ajustar() })));
    const mini = document.createElementNS(svgNS, 'svg'); mini.setAttribute('class', 'bt-mini'); mini.setAttribute('aria-label', 'Mini-mapa');
    palco.append(mini);
    const avisos = el('div', { class: 'bt-problemas' });
    palco.append(avisos);
    const fab = el('button', { class: 'bt-botao bt-fab', type: 'button', 'aria-label': 'Adicionar bloco', html: SVG.mais, onclick: () => abrirPaletaCelular() });
    const visaoLista = el('div', { class: 'bt-visao-lista' });
    const lado = el('aside', { class: 'bt-lado', 'aria-label': 'Painel do bloco' });
    const corpo = el('div', { class: 'bt-corpo' }, paleta, palco, visaoLista, lado, fab);
    raiz.append(topo, corpo);
    document.body.append(raiz);
    document.documentElement.style.overflow = 'hidden';

    // ----- paleta -----
    const grupos = {};
    for (const [tipo, g] of CATALOGO) (grupos[g] ||= []).push(tipo);
    for (const [g, tipos] of Object.entries(grupos)) {
      paleta.append(el('h4', { text: GRUPOS[g].nome }));
      for (const t of tipos) {
        const i = INFO[t];
        const peca = el('button', { class: 'bt-peca', type: 'button', style: `--cor:${GRUPOS[g].cor}`, 'data-tipo': t, title: i.desc }, el('i', { text: i.icone }), el('span', {}, document.createTextNode(i.nome), el('small', { text: i.desc })));
        peca.addEventListener('pointerdown', (e) => arrastarDaPaleta(e, t));
        paleta.append(peca);
      }
    }

    // ----- histórico -----
    const foto = () => JSON.stringify(ed.g);
    function guardar() { ed.hist.push(foto()); if (ed.hist.length > 80) ed.hist.shift(); ed.futuro = []; ed.pendente = null; }
    function mudar(fn, o = {}) { guardar(); fn(); marcarSujo(); desenharTudo(o); }
    /** Formulário: guarda a foto só na primeira mudança depois de focar. */
    function marcarEdicao() { if (ed.pendente) { ed.hist.push(ed.pendente); ed.futuro = []; ed.pendente = null; } marcarSujo(); }
    lado.addEventListener('focusin', () => { if (!ed.pendente) ed.pendente = foto(); });
    function desfazer() { if (!ed.hist.length) return; ed.futuro.push(foto()); ed.g = JSON.parse(ed.hist.pop()); ed.pendente = null; marcarSujo(); limparSelecaoInvalida(); desenharTudo({ painel: true }); }
    function refazer() { if (!ed.futuro.length) return; ed.hist.push(foto()); ed.g = JSON.parse(ed.futuro.pop()); ed.pendente = null; marcarSujo(); limparSelecaoInvalida(); desenharTudo({ painel: true }); }
    function limparSelecaoInvalida() { if (ed.sel?.tipo === 'no' && !no(ed.sel.id)) ed.sel = null; if (ed.sel?.tipo === 'ligacao' && !ed.g.ligacoes.some((l) => l.id === ed.sel.id)) ed.sel = null; }
    function marcarSujo() { ed.sujo = true; ed.servidor = []; bSalvar.querySelector('.bt-rot').textContent = 'Salvar •'; bSalvar.title = 'Há mudanças não salvas (Ctrl+S)'; }
    function limparSujo() { ed.sujo = false; bSalvar.querySelector('.bt-rot').textContent = 'Salvar'; bSalvar.title = 'Salvar rascunho (Ctrl+S)'; }
    const no = (nid) => ed.g.nos.find((n) => n.id === nid);

    // ----- coordenadas -----
    function aplicarVista() {
      const v = ed.view;
      mundo.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
      palco.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
      palco.style.backgroundPosition = `${v.x}px ${v.y}px`;
      zoomTxt.textContent = `${Math.round(v.z * 100)}%`;
      desenharMini();
    }
    const paraMundo = (cx, cy) => { const r = palco.getBoundingClientRect(); return { x: (cx - r.left - ed.view.x) / ed.view.z, y: (cy - r.top - ed.view.y) / ed.view.z }; };
    function zoomEm(f, cx, cy) {
      const r = palco.getBoundingClientRect();
      const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2;
      const antes = paraMundo(px, py);
      ed.view.z = Math.min(2, Math.max(0.25, ed.view.z * f));
      ed.view.x = px - r.left - antes.x * ed.view.z; ed.view.y = py - r.top - antes.y * ed.view.z;
      aplicarVista();
    }
    function caixaDoFluxo() {
      if (!ed.g.nos.length) return { x: 0, y: 0, w: 400, h: 300 };
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const n of ed.g.nos) { const h = ed.els.get(n.id)?.offsetHeight || 120; x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + W); y2 = Math.max(y2, n.y + h); }
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    function ajustar() {
      const r = palco.getBoundingClientRect(); if (!r.width) return;
      const c = caixaDoFluxo();
      const z = Math.min(1.1, Math.max(0.25, Math.min((r.width - 80) / (c.w || 1), (r.height - 120) / (c.h || 1))));
      ed.view = { z, x: (r.width - c.w * z) / 2 - c.x * z, y: Math.max(56, (r.height - c.h * z) / 2) - c.y * z };
      aplicarVista();
    }
    function centroDaTela() { const r = palco.getBoundingClientRect(); const m = paraMundo(r.left + r.width / 2, r.top + r.height / 2); return { x: m.x - W / 2, y: m.y - 40 }; }

    // ----- desenhar -----
    let probs = [];
    function desenharTudo(o = {}) {
      probs = problemas(ed.g);
      desenharNos();
      requestAnimationFrame(() => { desenharLinhas(); desenharMini(); });
      desenharAvisos();
      if (ed.lista) desenharLista();
      if (o.painel !== false) desenharPainel();
      bDesfazer.disabled = !ed.hist.length; bRefazer.disabled = !ed.futuro.length;
    }
    const problemasDo = (nid) => [...probs.filter((p) => p.noId === nid), ...ed.servidor.filter((p) => p.noId === nid && p.nivel === 'erro' && !probs.some((q) => q.mensagem === p.mensagem))];

    function cartaoNo(n) {
      const i = INFO[n.tipo];
      const cor = GRUPOS[i.grupo].cor;
      const ps = problemasDo(n.id);
      const temErro = ps.some((p) => p.nivel === 'erro'); const temAviso = ps.length > 0;
      const ligadas = new Set(ed.g.ligacoes.filter((l) => l.de === n.id).map((l) => l.saida));
      const exec = ed.teste?.exec;
      const passou = exec?.estado?.caminho?.includes(n.id);
      const atual = exec && ['pendente', 'rodando'].includes(exec.status) && exec.estado?.noAtual === n.id;
      const c = el('div', { class: `bt-no${ed.sel?.tipo === 'no' && ed.sel.id === n.id ? ' sel' : ''}${temErro ? ' erro' : temAviso ? ' aviso' : ''}${passou ? ' passou' : ''}${atual ? ' atual' : ''}`, 'data-id': n.id, style: `--cor:${cor};left:${n.x}px;top:${n.y}px`, tabindex: '0', role: 'button', 'aria-label': `${i.nome}: ${resumoNo(n)}` },
        el('span', { class: 'bt-no-faixa' }),
        n.tipo !== 'inicio' ? el('span', { class: 'bt-porta-entrada' }) : null,
        el('div', { class: 'bt-no-cab' }, el('i', { text: i.icone }), el('b', { text: n.titulo || i.nome }),
          temAviso ? el('span', { class: 'bt-alerta' + (temErro ? '' : ' aviso'), html: SVG.alerta, title: ps.map((p) => p.mensagem).join('\n') }) : null),
        el('div', { class: 'bt-no-corpo', text: resumoNo(n) }));
      if (n.tipo === 'mensagem' && (n.midiaId || n.midiaUrl)) c.append(el('div', { class: 'bt-no-img', style: `background-image:url("${encodeURI(String(n.midiaId ? `/api/bots/midias/${n.midiaId}` : n.midiaUrl)).replace(/["\\()]/g, '')}")` }));
      const sds = saidasDe(n);
      if (sds.length) c.append(el('div', { class: 'bt-saidas' }, ...sds.map((sd) => el('div', { class: 'bt-saida' + (sd.opcional ? ' opcional' : ''), 'data-saida': sd.id },
        el('span', { text: sd.rotulo }), el('span', { class: 'bt-porta-saida' + (ligadas.has(sd.id) ? ' ligada' : ''), 'data-no': n.id, 'data-saida': sd.id, title: 'Arraste até outro bloco para ligar' })))));
      return c;
    }
    function desenharNos() {
      for (const e of ed.els.values()) e.remove();
      ed.els.clear();
      for (const n of ed.g.nos) { const c = cartaoNo(n); ed.els.set(n.id, c); mundo.append(c); }
    }
    function atualizarNo(nid) {
      const n = no(nid); const velho = ed.els.get(nid); if (!n || !velho) return;
      probs = problemas(ed.g);
      const c = cartaoNo(n); velho.replaceWith(c); ed.els.set(nid, c);
      requestAnimationFrame(() => { desenharLinhas(); desenharMini(); });
      desenharAvisos();
    }
    function porta(nid, saida) { return ed.els.get(nid)?.querySelector(`.bt-porta-saida[data-saida="${window.CSS.escape(saida)}"]`); }
    function centro(elm) { const r = elm.getBoundingClientRect(); return paraMundo(r.left + r.width / 2, r.top + r.height / 2); }
    function curva(a, b) {
      const dx = Math.max(50, Math.abs(b.x - a.x) / 2) + (b.x < a.x ? 80 : 0);
      return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
    }
    function desenharLinhas() {
      linhas.replaceChildren();
      const exec = ed.teste?.exec; const cam = exec?.estado?.caminho || [];
      const pares = new Set(); for (let i = 0; i + 1 < cam.length; i++) pares.add(`${cam[i]}>${cam[i + 1]}`);
      for (const l of ed.g.ligacoes) {
        const p = porta(l.de, l.saida); const alvo = ed.els.get(l.para)?.querySelector('.bt-porta-entrada');
        if (!p || !alvo) continue;
        const d = curva(centro(p), centro(alvo));
        const traco = document.createElementNS(svgNS, 'path'); traco.setAttribute('d', d);
        traco.setAttribute('class', `bt-traco${ed.sel?.tipo === 'ligacao' && ed.sel.id === l.id ? ' sel' : ''}${pares.has(`${l.de}>${l.para}`) ? ' passou' : ''}`);
        const toque = document.createElementNS(svgNS, 'path'); toque.setAttribute('d', d); toque.setAttribute('class', 'bt-toque'); toque.dataset.ligacao = l.id;
        linhas.append(traco, toque);
      }
    }
    function desenharMini() {
      if (celular()) return;
      const r = palco.getBoundingClientRect(); if (!r.width) return;
      const c = caixaDoFluxo();
      const vx = -ed.view.x / ed.view.z, vy = -ed.view.y / ed.view.z, vw = r.width / ed.view.z, vh = r.height / ed.view.z;
      const x1 = Math.min(c.x, vx) - 40, y1 = Math.min(c.y, vy) - 40, x2 = Math.max(c.x + c.w, vx + vw) + 40, y2 = Math.max(c.y + c.h, vy + vh) + 40;
      mini.setAttribute('viewBox', `${x1} ${y1} ${x2 - x1} ${y2 - y1}`);
      mini.dataset.vb = JSON.stringify([x1, y1, x2 - x1, y2 - y1]);
      mini.replaceChildren(...ed.g.nos.map((n) => { const q = document.createElementNS(svgNS, 'rect'); q.setAttribute('class', 'n'); q.setAttribute('x', n.x); q.setAttribute('y', n.y); q.setAttribute('width', W); q.setAttribute('height', ed.els.get(n.id)?.offsetHeight || 110); q.setAttribute('rx', 16); return q; }),
        (() => { const q = document.createElementNS(svgNS, 'rect'); q.setAttribute('class', 'v'); q.setAttribute('x', vx); q.setAttribute('y', vy); q.setAttribute('width', vw); q.setAttribute('height', vh); q.setAttribute('rx', 12); return q; })());
    }
    mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const [x, y, w, h] = JSON.parse(mini.dataset.vb || '[0,0,1,1]'); const r = mini.getBoundingClientRect();
      const esc = Math.max(w / r.width, h / r.height); const ox = (r.width - w / esc) / 2, oy = (r.height - h / esc) / 2;
      const mx = x + (e.clientX - r.left - ox) * esc, my = y + (e.clientY - r.top - oy) * esc;
      const pr = palco.getBoundingClientRect();
      ed.view.x = pr.width / 2 - mx * ed.view.z; ed.view.y = pr.height / 2 - my * ed.view.z;
      aplicarVista();
    });
    let avisosAbertos = false;
    function desenharAvisos() {
      const todos = [...probs, ...ed.servidor.filter((p) => p.nivel === 'erro' && !probs.some((q) => q.mensagem === p.mensagem))];
      const erros = todos.filter((p) => p.nivel === 'erro').length, av = todos.length - erros;
      if (!todos.length) { avisos.replaceChildren(el('button', { type: 'button', style: 'cursor:default' }, el('span', { text: '✅' }), el('span', { text: 'Tudo certo para publicar' }))); return; }
      const bt = el('button', { type: 'button', 'aria-expanded': String(avisosAbertos), onclick: () => { avisosAbertos = !avisosAbertos; desenharAvisos(); } },
        el('span', { html: SVG.alerta, style: `display:grid;width:16px;height:16px;color:${erros ? '#ff7a59' : '#f5b800'}` }),
        el('span', { text: [erros ? `${erros} erro${erros > 1 ? 's' : ''}` : '', av ? `${av} aviso${av > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ') }));
      avisos.replaceChildren(bt, ...(avisosAbertos ? [el('ul', {}, ...todos.map((p) => el('li', { onclick: () => { if (p.noId) { focar(p.noId); avisosAbertos = false; desenharAvisos(); } } }, el('i', { text: p.nivel === 'erro' ? '⛔' : '⚠️' }), el('span', { text: p.mensagem }))))] : []));
    }
    function focar(nid) {
      const n = no(nid); if (!n) return;
      ed.sel = { tipo: 'no', id: nid };
      if (ed.lista) { desenharTudo(); visaoLista.querySelector(`[data-id="${window.CSS.escape(nid)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      const r = palco.getBoundingClientRect();
      ed.view.x = r.width / 2 - (n.x + W / 2) * ed.view.z; ed.view.y = r.height / 2.4 - n.y * ed.view.z;
      aplicarVista(); desenharTudo();
    }

    // ----- painel do bloco -----
    function fecharPainel() { ed.sel = null; lado.classList.remove('aberto'); desenharTudo({ painel: false }); }
    function desenharPainel() {
      if (ed.teste?.aberto) return desenharTeste();
      const n = ed.sel?.tipo === 'no' ? no(ed.sel.id) : null;
      if (ed.sel?.tipo === 'ligacao') {
        const l = ed.g.ligacoes.find((x) => x.id === ed.sel.id);
        if (!l) { lado.classList.remove('aberto'); return; }
        const de = no(l.de), para = no(l.para);
        lado.replaceChildren(el('div', { class: 'bt-lado-topo' }, el('h3', { text: 'Linha' }), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fecharPainel })),
          el('div', { class: 'bt-lado-corpo' }, el('p', { class: 'bt-dica', text: `De “${de ? de.titulo || INFO[de.tipo].nome : '?'}” (${saidasDe(de || {}).find((x) => x.id === l.saida)?.rotulo || l.saida}) para “${para ? para.titulo || INFO[para.tipo].nome : '?'}”.` }),
            el('button', { class: 'bt-botao perigo', type: 'button', onclick: () => mudar(() => { ed.g.ligacoes = ed.g.ligacoes.filter((x) => x.id !== l.id); ed.sel = null; }) }, el('span', { html: SVG.lixo, style: 'display:grid' }), el('span', { text: 'Apagar linha' }))));
        lado.classList.add('aberto');
        return;
      }
      if (!n) { lado.classList.remove('aberto'); lado.replaceChildren(); return; }
      const i = INFO[n.tipo];
      const corpoP = el('div', { class: 'bt-lado-corpo' });
      const alterou = (refazerPainel) => { marcarEdicao(); atualizarNo(n.id); if (ed.lista) desenharLista(); if (refazerPainel) desenharPainel(); };
      corpoP.append(campo('Título do bloco (opcional)', entradaTexto(n.titulo || '', (v) => { n.titulo = v.trim() ? v : undefined; alterou(); }, { max: 60, placeholder: i.nome })));
      formularioDo(n, corpoP, alterou);
      const ps = problemasDo(n.id);
      if (ps.length) corpoP.append(el('div', { class: 'bt-lista' }, ...ps.map((p) => el('span', { class: 'bt-selo ' + (p.nivel === 'erro' ? 'erro' : 'aviso'), style: 'white-space:normal;line-height:1.35', text: p.mensagem }))));
      corpoP.append(el('div', { class: 'bt-acoes-no' },
        n.tipo !== 'inicio' ? el('button', { class: 'bt-botao leve', type: 'button', onclick: () => duplicar(n.id) }, el('span', { html: SVG.copiar, style: 'display:grid' }), el('span', { text: 'Duplicar' })) : null,
        n.tipo !== 'inicio' ? el('button', { class: 'bt-botao perigo', type: 'button', onclick: () => apagarNo(n.id) }, el('span', { html: SVG.lixo, style: 'display:grid' }), el('span', { text: 'Apagar' })) : null));
      lado.replaceChildren(el('div', { class: 'bt-lado-topo' }, el('h3', {}, el('i', { text: i.icone }), el('span', { text: i.nome })), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar painel', html: SVG.fechar, onclick: fecharPainel })), corpoP);
      lado.classList.add('aberto');
    }

    function chipsVariaveis(alvo, aoInserir) {
      const extras = [...new Set(ed.g.nos.map((x) => x.variavel).filter(Boolean))].map((v) => `{${v}}`);
      return el('div', { class: 'bt-vars' }, ...[...VARIAVEIS, ...extras].map((v) => el('button', { class: 'bt-var', type: 'button', text: v, onmousedown: (e) => e.preventDefault(), onclick: () => {
        const ini = alvo.selectionStart ?? alvo.value.length, fim = alvo.selectionEnd ?? ini;
        alvo.value = alvo.value.slice(0, ini) + v + alvo.value.slice(fim); alvo.focus(); alvo.selectionStart = alvo.selectionEnd = ini + v.length; aoInserir(alvo.value);
      } })));
    }

    function formularioDo(n, caixa, alterou) {
      const add = (...x) => caixa.append(...x.filter(Boolean));
      switch (n.tipo) {
        case 'inicio': {
          const g = n.gatilho || (n.gatilho = { tipo: 'manual' });
          add(campo('Quando o bot começa', selecao(GATILHOS, g.tipo, (v) => { n.gatilho = v === 'palavra_chave' ? { tipo: v, palavras: [], modo: 'contem' } : v === 'entrou_na_etapa' ? { tipo: v, etapaId: opcoesEtapas()[0]?.[0] || '' } : v === 'tag_marcada' ? { tipo: v, tagId: opcoesTags()[0]?.[0] || '' } : { tipo: v }; alterou(true); })));
          if (g.tipo === 'palavra_chave') {
            add(campo('Palavras (uma por linha)', entradaTexto((g.palavras || []).join('\n'), (v) => { g.palavras = v.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 30); alterou(); }, { area: true, max: 2000, placeholder: 'preço\nquanto custa' }), 'Sem acento e sem maiúsculas; a palavra precisa aparecer inteira.'),
              campo('Como comparar', selecao([['contem', 'A mensagem contém a palavra'], ['exata', 'A mensagem é exatamente a palavra']], g.modo || 'contem', (v) => { g.modo = v; alterou(); })));
          }
          if (g.tipo === 'entrou_na_etapa') add(campo('Etapa', selecao(opcoesEtapas(), g.etapaId, (v) => { g.etapaId = v; alterou(); })));
          if (g.tipo === 'tag_marcada') add(campo('Tag', selecao(opcoesTags(), g.tagId, (v) => { g.tagId = v; alterou(); })));
          if (g.tipo === 'nova_conversa' || g.tipo === 'fora_do_horario') add(campo('Unidade', selecao([['', 'Todas'], ...Object.entries(UNIDADES)], g.unidade || '', (v) => { if (v) g.unidade = v; else delete g.unidade; alterou(); })));
          add(el('p', { class: 'bt-dica', text: 'Um bot por vez em cada conversa. Enquanto o bot conduz, a IA fica quieta; se a equipe responder, o bot para.' }));
          break;
        }
        case 'mensagem': {
          const t = entradaTexto(n.texto, (v) => { n.texto = v; alterou(); }, { area: true, max: 1000, placeholder: 'Oi, {primeiro_nome}! 💛' });
          add(campo('Mensagem', t), chipsVariaveis(t, (v) => { n.texto = v; alterou(); }));
          const url = entradaTexto(n.midiaUrl || '', (v) => { n.midiaUrl = v.trim() || undefined; if (n.midiaUrl) delete n.midiaId; alterou(); }, { max: 1000, placeholder: 'https://… (opcional)' });
          const arq = el('input', { type: 'file', accept: 'image/*,video/mp4,application/pdf', hidden: '' });
          arq.addEventListener('change', async () => {
            const f = arq.files?.[0]; if (!f) return;
            if (f.size > 8 * 1024 * 1024) { ui.toast('Arquivo grande demais (máximo 8 MB).'); return; }
            const b64 = await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = erro; r.readAsDataURL(f); });
            try { const m = await ui.post('/api/bots/midias', { nome: f.name, mimetype: f.type || 'image/jpeg', base64: b64 }); n.midiaId = m.id; delete n.midiaUrl; alterou(true); ui.toast('Imagem enviada ✓'); } catch (x) { ui.toast(x.message); }
          });
          add(campo('Imagem por endereço (URL)', url), el('div', { class: 'bt-linha' }, arq,
            el('button', { class: 'bt-botao leve', type: 'button', onclick: () => arq.click() }, el('span', { text: n.midiaId ? 'Trocar imagem' : 'Enviar imagem' })),
            n.midiaId || n.midiaUrl ? el('button', { class: 'bt-botao perigo', type: 'button', text: 'Tirar', onclick: () => { delete n.midiaId; delete n.midiaUrl; alterou(true); } }) : null));
          add(linhaChave('Só com a loja aberta', 'Fora do horário, espera a abertura para enviar.', n.so_no_horario, (v) => { n.so_no_horario = v; alterou(); }));
          break;
        }
        case 'pergunta': {
          const t = entradaTexto(n.texto, (v) => { n.texto = v; alterou(); }, { area: true, max: 1000, placeholder: 'Como posso te ajudar?' });
          add(campo('Pergunta', t), chipsVariaveis(t, (v) => { n.texto = v; alterou(); }));
          const ops = el('div', { class: 'bt-lista', style: 'gap:6px' });
          (n.opcoes || []).forEach((o, idx) => ops.append(el('div', { class: 'bt-opcao' }, el('em', { text: `${idx + 1}.` }),
            entradaTexto(o.texto, (v) => { o.texto = v; alterou(); }, { max: 80, placeholder: `Opção ${idx + 1}`, attrs: { class: 'bt-entrada', 'aria-label': `Opção ${idx + 1}` } }),
            el('button', { class: 'bt-redondo', type: 'button', 'aria-label': `Tirar opção ${idx + 1}`, html: SVG.fechar, style: 'width:38px;height:38px', onclick: () => mudar(() => { n.opcoes.splice(idx, 1); ed.g.ligacoes = ed.g.ligacoes.filter((l) => !(l.de === n.id && l.saida === o.id)); }) }))));
          add(el('div', { class: 'bt-campo' }, el('span', { text: 'Opções (cada uma é uma saída)' }), ops,
            (n.opcoes || []).length < 10 ? el('button', { class: 'bt-botao leve', type: 'button', onclick: () => mudar(() => { n.opcoes.push({ id: uid('o'), texto: '' }); }) }, el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Adicionar opção' })) : null),
            el('p', { class: 'bt-dica', text: 'No WhatsApp sai como lista numerada (1, 2, 3…). A cliente pode responder o número ou o nome da opção.' }));
          add(campo('Guardar a escolha na variável', entradaTexto(n.variavel || '', (v) => { n.variavel = v.trim() || undefined; alterou(); }, { max: 40, placeholder: 'ex.: servico' }), `Use depois como {${n.variavel || 'servico'}} nas mensagens.`));
          add(campo('Se não entender, perguntar de novo', selecao([['0', 'Não'], ['1', '1 vez'], ['2', '2 vezes'], ['3', '3 vezes']], String(n.tentativas ?? 2), (v) => { n.tentativas = Number(v); alterou(); })));
          add(campo('Tempo para responder', campoDuracao(n.tempoLimiteMin ?? 1440, (v) => { n.tempoLimiteMin = v; alterou(); }), 'Depois disso segue por “Não respondeu”.'));
          break;
        }
        case 'pergunta_aberta': {
          const t = entradaTexto(n.texto, (v) => { n.texto = v; alterou(); }, { area: true, max: 1000, placeholder: 'Qual o seu e-mail?' });
          add(campo('Pergunta', t), chipsVariaveis(t, (v) => { n.texto = v; alterou(); }));
          add(campo('Tipo de resposta', selecao(Object.entries(VALIDACOES), n.validacao || 'texto', (v) => { n.validacao = v; alterou(); })));
          add(campo('Guardar na variável', entradaTexto(n.variavel || '', (v) => { n.variavel = v.trim() || undefined; alterou(); }, { max: 40, placeholder: 'ex.: email' })));
          add(campo('Salvar também na ficha', selecao(opcoesCampos(), n.campo || '', (v) => { n.campo = v || undefined; alterou(); })));
          add(campo('Se a resposta não valer, perguntar de novo', selecao([['0', 'Não'], ['1', '1 vez'], ['2', '2 vezes'], ['3', '3 vezes']], String(n.tentativas ?? 2), (v) => { n.tentativas = Number(v); alterou(); })));
          add(campo('Tempo para responder', campoDuracao(n.tempoLimiteMin ?? 1440, (v) => { n.tempoLimiteMin = v; alterou(); })));
          break;
        }
        case 'condicao': {
          const c = n.condicao || (n.condicao = { se: 'horario_loja', valor: '', operador: 'preenchido' });
          add(campo('Se…', selecao(CONDICOES, c.se, (v) => { n.condicao = { se: v, valor: v === 'tag' ? opcoesTags()[0]?.[0] || '' : v === 'etapa' ? opcoesEtapas()[0]?.[0] || '' : v === 'unidade' ? 'norte' : v === 'modo' ? 'ia' : '', operador: 'preenchido' }; alterou(true); })));
          if (c.se === 'tag') add(campo('Tag', selecao(opcoesTags(), c.valor, (v) => { c.valor = v; alterou(); })));
          if (c.se === 'etapa') add(campo('Etapa', selecao(opcoesEtapas(), c.valor, (v) => { c.valor = v; alterou(); })));
          if (c.se === 'unidade') add(campo('Unidade', selecao(Object.entries(UNIDADES), c.valor, (v) => { c.valor = v; alterou(); })));
          if (c.se === 'modo') add(campo('Modo', selecao(Object.entries(MODOS), c.valor, (v) => { c.valor = v; alterou(); })));
          if (c.se === 'resposta_contem') add(campo('Palavras (separe por vírgula)', entradaTexto(c.valor, (v) => { c.valor = v; alterou(); }, { max: 300, placeholder: 'sim, quero, pode' }), 'Olha a última resposta da cliente no bot.'));
          if (c.se === 'campo') {
            const vars = [...new Set(ed.g.nos.map((x) => x.variavel).filter(Boolean))].map((v) => [v, `Variável {${v}}`]);
            add(campo('Campo', selecao([['', 'Escolha…'], ...vars, ...opcoesCampos().slice(1)], c.campo || '', (v) => { c.campo = v || undefined; alterou(); })),
              campo('Regra', selecao([['preenchido', 'está preenchido'], ['igual', 'é igual a'], ['contem', 'contém']], c.operador || 'preenchido', (v) => { c.operador = v; alterou(true); })));
            if (c.operador && c.operador !== 'preenchido') add(campo('Valor', entradaTexto(c.valor, (v) => { c.valor = v; alterou(); }, { max: 300 })));
          }
          if (c.se === 'horario_loja') add(el('p', { class: 'bt-dica', text: 'Usa o horário de atendimento da unidade da conversa.' }));
          break;
        }
        case 'esperar':
          add(campo('Esperar', campoDuracao(n.minutos ?? 60, (v) => { n.minutos = v; alterou(); })), el('p', { class: 'bt-dica', text: 'Sobrevive a reinício do servidor. No teste não espera.' }));
          break;
        case 'esperar_resposta':
          add(campo('Esperar a resposta por até', campoDuracao(n.minutos ?? 60, (v) => { n.minutos = v; alterou(); })),
            campo('Guardar a resposta na variável', entradaTexto(n.variavel || '', (v) => { n.variavel = v.trim() || undefined; alterou(); }, { max: 40, placeholder: 'ex.: resposta' })));
          break;
        case 'mover_etapa': {
          const funis = s.base?.funis || [];
          add(campo('Funil', selecao(funis.map((f) => [f.id, f.nome]), n.funilId, (v) => { n.funilId = v; n.etapaId = funis.find((f) => f.id === v)?.etapas?.[0]?.id || ''; alterou(true); })));
          const f = funis.find((x) => x.id === n.funilId);
          add(campo('Etapa', selecao((f?.etapas || []).map((e) => [e.id, e.nome]), n.etapaId, (v) => { n.etapaId = v; alterou(); })));
          break;
        }
        case 'marcar_tag':
        case 'desmarcar_tag':
          add(campo('Tag', selecao(opcoesTags(n.tipo === 'desmarcar_tag'), n.tagId, (v) => { n.tagId = v; alterou(); })));
          break;
        case 'atribuir':
          add(campo('Atendente', selecao(opcoesPessoas(), n.usuarioId || '', (v) => { n.usuarioId = v || null; alterou(); })),
            campo('Só para a unidade', selecao([['', 'Qualquer unidade'], ...Object.entries(UNIDADES)], n.unidade || '', (v) => { if (v) n.unidade = v; else delete n.unidade; alterou(); }), 'Em conversa de outra unidade, o bloco é pulado.'));
          break;
        case 'mudar_modo':
          add(campo('Quem responde', selecao(Object.entries(MODOS), n.modo, (v) => { n.modo = v; alterou(); })));
          break;
        case 'lembrete': {
          const t = entradaTexto(n.texto || '', (v) => { n.texto = v || undefined; alterou(); }, { max: 200, placeholder: 'Ligar para {primeiro_nome}' });
          add(campo('Daqui a', campoDuracao(n.em_minutos ?? 0, (v) => { n.em_minutos = v; alterou(); }, 0)), campo('Texto do lembrete', t), chipsVariaveis(t, (v) => { n.texto = v; alterou(); }));
          break;
        }
        case 'webhook':
          add(campo('Endereço (POST JSON)', entradaTexto(n.url, (v) => { n.url = v.trim(); alterou(); }, { max: 1000, placeholder: 'https://…', tipo: 'url' }), 'Manda a conversa e as variáveis. Valores simples da resposta viram {webhook_chave}.'));
          break;
        case 'agente_ia': {
          const ags = s.base?.agentes || [];
          add(campo('Agente', selecao([['', 'Agente padrão da Sintonia'], ...ags.map((a) => [a.id, a.nome || a.id])], n.agenteIaId || '', (v) => { n.agenteIaId = v || undefined; alterou(); }), ags.length ? '' : 'Quando o estúdio “Agentes de IA” tiver agentes, eles aparecem aqui.'));
          const t = entradaTexto(n.objetivo, (v) => { n.objetivo = v; alterou(); }, { area: true, max: 1000, placeholder: 'Agendar uma avaliação de {servico}.' });
          add(campo('Objetivo', t), chipsVariaveis(t, (v) => { n.objetivo = v; alterou(); }));
          const sai = n.saida || (n.saida = { tipo: 'agendou' });
          add(campo('Até quando', selecao([['agendou', 'Até a cliente agendar'], ['mensagens', 'Até a IA mandar N mensagens'], ['prazo', 'Só pelo prazo']], sai.tipo, (v) => { n.saida = v === 'mensagens' ? { tipo: v, n: 5 } : { tipo: v }; alterou(true); })));
          if (sai.tipo === 'mensagens') { const q = el('input', { type: 'number', min: '1', max: '50', class: 'bt-entrada' }); q.value = String(sai.n || 5); q.addEventListener('input', () => { sai.n = Math.min(50, Math.max(1, Number(q.value) || 1)); alterou(); }); add(campo('Mensagens da IA', q)); }
          add(campo('Prazo máximo', selecao([1, 2, 3, 5, 7, 14, 30].map((d) => [String(d), `${d} dia${d > 1 ? 's' : ''}`]), String(n.dias || 3), (v) => { n.dias = Number(v); alterou(); }), 'Passou do prazo, segue por “Prazo acabou”.'));
          break;
        }
        case 'transferir': {
          const t = entradaTexto(n.texto || '', (v) => { n.texto = v || undefined; alterou(); }, { area: true, max: 1000, placeholder: 'Já chamei uma atendente…' });
          add(campo('Mensagem antes de passar (opcional)', t), chipsVariaveis(t, (v) => { n.texto = v; alterou(); }),
            campo('Passar para', selecao([['', 'A equipe (sem dona)'], ...opcoesPessoas().slice(1)], n.usuarioId || '', (v) => { n.usuarioId = v || null; alterou(); })),
            el('p', { class: 'bt-dica', text: 'A conversa vai para “Só equipe”, ganha a etiqueta “precisa da equipe” e o bot termina.' }));
          break;
        }
        case 'fim':
          add(el('p', { class: 'bt-dica', text: 'O bot termina aqui. A conversa segue no modo em que está.' }));
          break;
      }
    }
    function linhaChave(t, info, v, aoMudar) {
      return el('label', { class: 'bt-linha', style: 'justify-content:space-between;gap:12px' }, el('span', { class: 'bt-campo', style: 'gap:2px' }, el('span', { text: t, style: 'color:var(--texto)' }), el('span', { class: 'bt-dica', text: info })), chave(v, (x) => aoMudar(x), t));
    }

    // ----- ações nos blocos -----
    function adicionar(tipo, x, y) {
      if (tipo === 'inicio' && ed.g.nos.some((n) => n.tipo === 'inicio')) { ui.toast('Já existe um Início.'); return; }
      const n = novoNo(tipo, x, y);
      mudar(() => {
        ed.g.nos.push(n);
        // Ligação automática: o bloco selecionado com a primeira saída livre aponta para o novo.
        const sel = ed.sel?.tipo === 'no' ? no(ed.sel.id) : null;
        if (sel) { const livre = saidasDe(sel).find((sd) => !sd.opcional && !ed.g.ligacoes.some((l) => l.de === sel.id && l.saida === sd.id)); if (livre) ed.g.ligacoes.push({ id: uid('l'), de: sel.id, saida: livre.id, para: n.id }); }
        ed.sel = { tipo: 'no', id: n.id };
      });
    }
    function posicaoNova() {
      const sel = ed.sel?.tipo === 'no' ? no(ed.sel.id) : null;
      if (sel) return { x: sel.x + W + 90, y: sel.y };
      if (ed.lista || celular()) { const baixo = ed.g.nos.reduce((m, n) => (n.y > m.y ? n : m), { x: 0, y: -170 }); return { x: baixo.x, y: baixo.y + (ed.els.get(baixo.id)?.offsetHeight || 140) + 50 }; }
      return centroDaTela();
    }
    function duplicar(nid) {
      const n = no(nid); if (!n || n.tipo === 'inicio') return;
      const c = copia(n); c.id = uid(); c.x += 40; c.y += 40;
      if (c.opcoes) c.opcoes = c.opcoes.map((o) => ({ ...o, id: uid('o') }));
      mudar(() => { ed.g.nos.push(c); ed.sel = { tipo: 'no', id: c.id }; });
    }
    function apagarNo(nid) {
      const n = no(nid); if (!n || n.tipo === 'inicio') { if (n) ui.toast('O Início não pode ser apagado.'); return; }
      mudar(() => { ed.g.nos = ed.g.nos.filter((x) => x.id !== nid); ed.g.ligacoes = ed.g.ligacoes.filter((l) => l.de !== nid && l.para !== nid); ed.sel = null; });
    }
    function ligar(de, saida, para) {
      if (de === para) return;
      const alvo = no(para); if (!alvo || alvo.tipo === 'inicio') { ui.toast('Nada entra no Início.'); return; }
      mudar(() => { ed.g.ligacoes = ed.g.ligacoes.filter((l) => !(l.de === de && l.saida === saida)); if (para) ed.g.ligacoes.push({ id: uid('l'), de, saida, para }); }, { painel: false });
    }

    // ----- arrastar da paleta -----
    function arrastarDaPaleta(e, tipo) {
      e.preventDefault();
      const ini = { x: e.clientX, y: e.clientY }; let fant = null;
      const mover = (ev) => {
        if (!fant && Math.hypot(ev.clientX - ini.x, ev.clientY - ini.y) > 6) { fant = el('div', { class: 'bt-fantasma', text: `${INFO[tipo].icone} ${INFO[tipo].nome}` }); document.body.append(fant); }
        if (fant) { fant.style.left = ev.clientX + 'px'; fant.style.top = ev.clientY + 'px'; }
      };
      const soltar = (ev) => {
        removeEventListener('pointermove', mover); removeEventListener('pointerup', soltar);
        if (!fant) { const p = posicaoNova(); adicionar(tipo, p.x, p.y); return; }
        fant.remove();
        const r = palco.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) { const m = paraMundo(ev.clientX, ev.clientY); ed.sel = null; adicionar(tipo, m.x - W / 2, m.y - 24); }
      };
      addEventListener('pointermove', mover); addEventListener('pointerup', soltar);
    }

    // ----- palco: mover, ligar, arrastar, pinça -----
    // O palco nunca rola (o foco num bloco faria o navegador rolar e desalinhar as contas).
    palco.addEventListener('scroll', () => { palco.scrollLeft = 0; palco.scrollTop = 0; });
    const dedos = new Map(); let gesto = null;
    palco.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.bt-zoom, .bt-mini, .bt-problemas')) return;
      if (e.button > 0) return;
      e.preventDefault(); // sem seleção de texto ao arrastar
      palco.focus({ preventScroll: true });
      dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      palco.setPointerCapture(e.pointerId);
      if (dedos.size === 2) { const [a, b] = [...dedos.values()]; gesto = { tipo: 'pinca', d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; return; }
      const portaS = e.target.closest('.bt-porta-saida');
      if (portaS) { gesto = { tipo: 'ligar', de: portaS.dataset.no, saida: portaS.dataset.saida, a: centro(portaS) }; return; }
      const toque = e.target.closest('path.bt-toque');
      if (toque) { ed.sel = { tipo: 'ligacao', id: toque.dataset.ligacao }; desenharTudo(); gesto = null; return; }
      const cartao = e.target.closest('.bt-no');
      if (cartao) { const n = no(cartao.dataset.id); gesto = { tipo: 'no', id: n.id, ini: { x: e.clientX, y: e.clientY }, orig: { x: n.x, y: n.y }, moveu: false }; return; }
      gesto = { tipo: 'pan', ini: { x: e.clientX, y: e.clientY }, orig: { ...ed.view }, moveu: false };
      palco.classList.add('arrastando');
    });
    palco.addEventListener('pointermove', (e) => {
      if (!dedos.has(e.pointerId)) return;
      dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesto) return;
      if (gesto.tipo === 'pinca' && dedos.size >= 2) {
        const [a, b] = [...dedos.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        ed.view.x += cx - gesto.cx; ed.view.y += cy - gesto.cy; gesto.cx = cx; gesto.cy = cy;
        zoomEm(d / (gesto.d || d), cx, cy); gesto.d = d;
        return;
      }
      if (gesto.tipo === 'pan') {
        const dx = e.clientX - gesto.ini.x, dy = e.clientY - gesto.ini.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) gesto.moveu = true;
        ed.view.x = gesto.orig.x + dx; ed.view.y = gesto.orig.y + dy; aplicarVista();
        return;
      }
      if (gesto.tipo === 'no') {
        const dx = (e.clientX - gesto.ini.x) / ed.view.z, dy = (e.clientY - gesto.ini.y) / ed.view.z;
        if (!gesto.moveu && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!gesto.moveu) { guardar(); gesto.moveu = true; }
        const n = no(gesto.id); n.x = Math.round((gesto.orig.x + dx) / 10) * 10; n.y = Math.round((gesto.orig.y + dy) / 10) * 10;
        const c = ed.els.get(n.id); c.style.left = n.x + 'px'; c.style.top = n.y + 'px';
        desenharLinhas();
        return;
      }
      if (gesto.tipo === 'ligar') {
        const b = paraMundo(e.clientX, e.clientY);
        let temp = linhas.querySelector('.bt-temp');
        if (!temp) { temp = document.createElementNS(svgNS, 'path'); temp.setAttribute('class', 'bt-temp'); linhas.append(temp); }
        temp.setAttribute('d', curva(gesto.a, b));
        mundo.querySelectorAll('.bt-no.alvo').forEach((x) => x.classList.remove('alvo'));
        const sob = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bt-no');
        if (sob && sob.dataset.id !== gesto.de) sob.classList.add('alvo');
      }
    });
    const fimGesto = (e) => {
      dedos.delete(e.pointerId);
      palco.classList.remove('arrastando');
      const g = gesto;
      if (dedos.size < 2 && g?.tipo === 'pinca') { gesto = null; return; }
      if (dedos.size) return;
      gesto = null;
      if (!g) return;
      if (g.tipo === 'pan' && !g.moveu) { if (ed.sel && !ed.teste?.aberto) fecharPainel(); else if (ed.sel) { ed.sel = null; desenharTudo({ painel: false }); } }
      if (g.tipo === 'no') {
        if (g.moveu) { marcarSujo(); desenharMini(); bDesfazer.disabled = false; }
        else { ed.sel = { tipo: 'no', id: g.id }; if (ed.teste) ed.teste.aberto = false; desenharTudo(); }
      }
      if (g.tipo === 'ligar') {
        linhas.querySelector('.bt-temp')?.remove();
        mundo.querySelectorAll('.bt-no.alvo').forEach((x) => x.classList.remove('alvo'));
        const sob = document.elementFromPoint(e.clientX, e.clientY)?.closest('.bt-no');
        if (sob && sob.dataset.id !== g.de) ligar(g.de, g.saida, sob.dataset.id);
        else if (!sob) {
          // Soltou no vazio: tira a linha que havia nesta saída.
          if (ed.g.ligacoes.some((l) => l.de === g.de && l.saida === g.saida)) mudar(() => { ed.g.ligacoes = ed.g.ligacoes.filter((l) => !(l.de === g.de && l.saida === g.saida)); }, { painel: false });
        }
      }
    };
    palco.addEventListener('pointerup', fimGesto);
    palco.addEventListener('pointercancel', fimGesto);
    palco.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomEm(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else { ed.view.x -= e.deltaX; ed.view.y -= e.deltaY; aplicarVista(); }
    }, { passive: false });
    palco.addEventListener('dblclick', (e) => { if (!e.target.closest('.bt-no')) { const m = paraMundo(e.clientX, e.clientY); ed.sel = null; abrirPaletaCelular({ x: m.x - W / 2, y: m.y - 24 }); } });

    // ----- teclado -----
    const teclas = (e) => {
      if (!document.body.contains(raiz)) return;
      if (document.querySelector('dialog[open]')) return;
      const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); salvar(); return; }
      if (digitando) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) refazer(); else desfazer(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); refazer(); return; }
      if (mod && e.key.toLowerCase() === 'd' && ed.sel?.tipo === 'no') { e.preventDefault(); duplicar(ed.sel.id); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel) {
        e.preventDefault();
        if (ed.sel.tipo === 'no') apagarNo(ed.sel.id);
        else { const id = ed.sel.id; mudar(() => { ed.g.ligacoes = ed.g.ligacoes.filter((l) => l.id !== id); ed.sel = null; }); }
        return;
      }
      if (e.key === 'Escape') { if (ed.sel) fecharPainel(); }
    };
    addEventListener('keydown', teclas);
    const aoRedimensionar = () => { desenharLinhas(); desenharMini(); };
    addEventListener('resize', aoRedimensionar);

    // ----- celular: paleta em folha e visão em lista -----
    function abrirPaletaCelular(pos) {
      const d = el('dialog', { class: 'bt-dialogo' });
      d.append(el('div', { class: 'bt-dlg-topo' }, el('h2', { text: 'Adicionar bloco' }), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: () => d.close() })),
        el('div', { class: 'bt-dlg-corpo' }, el('div', { class: 'bt-modelos' }, ...CATALOGO.filter(([t]) => t !== 'inicio' || !ed.g.nos.some((n) => n.tipo === 'inicio')).map(([t, g, i, nomeB, desc]) =>
          el('button', { class: 'bt-modelo', type: 'button', style: `min-height:0;--cor:${GRUPOS[g].cor}`, onclick: () => { d.close(); const p = pos || posicaoNova(); adicionar(t, p.x, p.y); if (!ed.lista) focar(ed.sel?.id); } },
            el('b', { text: `${i} ${nomeB}` }), el('span', { text: desc }))))));
      d.addEventListener('close', () => d.remove());
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      document.body.append(d); d.showModal();
    }
    function ordemLista() {
      const ini = ed.g.nos.find((n) => n.tipo === 'inicio'); const vistos = new Set(); const ordem = [];
      const fila = ini ? [ini.id] : [];
      while (fila.length) { const x = fila.shift(); if (vistos.has(x)) continue; vistos.add(x); const n = no(x); if (!n) continue; ordem.push(n); for (const sd of saidasDe(n)) { const l = ed.g.ligacoes.find((k) => k.de === x && k.saida === sd.id); if (l) fila.push(l.para); } }
      for (const n of ed.g.nos) if (!vistos.has(n.id)) ordem.push(n);
      return ordem;
    }
    function desenharLista() {
      const ordem = ordemLista(); const num = new Map(ordem.map((n, i) => [n.id, i + 1]));
      const rotulo = (n) => `${num.get(n.id)}. ${n.titulo || INFO[n.tipo].nome}`;
      visaoLista.replaceChildren(...ordem.map((n) => {
        const i = INFO[n.tipo]; const ps = problemasDo(n.id);
        const saidas = saidasDe(n).map((sd) => {
          const l = ed.g.ligacoes.find((k) => k.de === n.id && k.saida === sd.id);
          const sel = selecao([['', '— termina aqui —'], ...ordem.filter((x) => x.id !== n.id && x.tipo !== 'inicio').map((x) => [x.id, rotulo(x)]), ['__novo', '+ novo bloco…']], l?.para || '', (v) => {
            if (v === '__novo') { ed.sel = { tipo: 'no', id: n.id }; abrirPaletaCelular(); return; }
            if (v) ligar(n.id, sd.id, v); else mudar(() => { ed.g.ligacoes = ed.g.ligacoes.filter((k) => !(k.de === n.id && k.saida === sd.id)); });
          }, { 'aria-label': `Saída ${sd.rotulo} vai para` });
          return el('div', { class: 'bt-saida-l' }, el('span', { text: `${sd.rotulo} →` }), sel);
        });
        return el('div', { class: 'bt-lcard' + (ps.some((p) => p.nivel === 'erro') ? ' erro' : ''), 'data-id': n.id, style: `--cor:${GRUPOS[i.grupo].cor}` },
          el('button', { class: 'bt-lcard-cab', type: 'button', onclick: () => { ed.sel = { tipo: 'no', id: n.id }; if (ed.teste) ed.teste.aberto = false; desenharTudo(); } },
            el('i', { text: i.icone }), el('div', {}, el('b', { text: rotulo(n) }), el('small', { text: resumoNo(n) })), ps.length ? el('span', { html: SVG.alerta, style: `display:grid;width:18px;height:18px;color:${ps.some((p) => p.nivel === 'erro') ? '#ff7a59' : '#f5b800'}` }) : null),
          ...saidas);
      }), el('button', { class: 'bt-botao leve', type: 'button', onclick: () => { ed.sel = null; abrirPaletaCelular(); } }, el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Adicionar bloco' })));
    }
    function aplicarVisao() {
      corpo.classList.toggle('lista', ed.lista);
      bVisao.innerHTML = ed.lista ? SVG.palco : SVG.lista;
      bVisao.setAttribute('aria-pressed', String(ed.lista));
      bVisao.title = ed.lista ? 'Ver no palco' : 'Ver em lista';
      if (ed.lista) desenharLista(); else requestAnimationFrame(() => { ajustar(); desenharLinhas(); });
    }

    // ----- salvar, publicar -----
    async function salvar(silencio) {
      try {
        const r = await ui.api(`/api/bots/${ed.fluxo.id}`, { method: 'PATCH', body: JSON.stringify({ nome: nome.value.trim() || ed.fluxo.nome, rascunho: ed.g }) });
        ed.servidor = r.problemas || []; ed.fluxo = { ...ed.fluxo, ...r }; limparSujo();
        desenharTudo({ painel: false });
        if (!silencio) ui.toast('Rascunho salvo ✓');
        ed.aoMudar?.();
        return true;
      } catch (x) { ui.toast(x.message); return false; }
    }
    async function publicar() {
      if (!(await salvar(true))) return;
      try {
        const r = await ui.post(`/api/bots/${ed.fluxo.id}/publicar`);
        ed.fluxo = { ...ed.fluxo, ...r }; ed.servidor = [];
        swLigado.disabled = false;
        ui.toast(`Publicado (v${r.versao}) 🚀${r.ligado ? '' : ' — ligue para valer'}`);
        desenharTudo({ painel: false });
        ed.aoMudar?.();
      } catch (x) {
        ui.toast(x.message);
        try { const f = await ui.api(`/api/bots/${ed.fluxo.id}`); ed.servidor = f.problemas || []; } catch { /* fica o que tem */ }
        avisosAbertos = true; desenharTudo({ painel: false });
      }
    }
    if (!fluxo.versao) swLigado.disabled = true;

    // ----- testar -----
    function abrirTeste() {
      ed.teste = ed.teste || { conversaId: null, execId: null, exec: null, msgs: [] };
      ed.teste.aberto = true; ed.sel = null;
      desenharTudo();
    }
    async function novaClienteTeste() {
      const telefone = '5599' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      await ui.post('/api/teste/cliente', { unidade: 'norte', nome: 'Cliente Teste', telefone, texto: 'Oi' });
      for (let i = 0; i < 10; i++) {
        const lista = await ui.api('/api/conversas').catch(() => []);
        const c = (Array.isArray(lista) ? lista : lista.conversas || []).find((x) => x.telefone === telefone);
        if (c) return c;
        await new Promise((ok) => setTimeout(ok, 300));
      }
      throw new Error('Não achei a conversa de teste.');
    }
    async function comecarTeste(conversaId) {
      if (!(await salvar(true))) return;
      try {
        const ex = await ui.post(`/api/bots/${ed.fluxo.id}/testar`, { conversaId });
        Object.assign(ed.teste, { conversaId, execId: ex.id, exec: ex });
        ui.toast('Teste começou: responda como a cliente 💬');
        await atualizarTeste(); vigiarTeste();
      } catch (x) {
        ui.toast(x.message);
        try { const f = await ui.api(`/api/bots/${ed.fluxo.id}`); ed.servidor = f.problemas || []; desenharTudo({ painel: false }); } catch { /* nada */ }
      }
    }
    async function atualizarTeste() {
      const t = ed.teste; if (!t?.conversaId) return;
      try {
        const [conv, ex] = await Promise.all([ui.api(`/api/conversas/${t.conversaId}`), t.execId ? ui.api(`/api/bots/execucoes/${t.execId}`) : null]);
        t.msgs = conv.mensagens || []; t.conv = conv.conversa;
        const mudouCaminho = JSON.stringify(ex?.estado?.caminho) !== JSON.stringify(t.exec?.estado?.caminho) || ex?.status !== t.exec?.status;
        t.exec = ex;
        if (mudouCaminho) { desenharNos(); requestAnimationFrame(desenharLinhas); }
        if (t.aberto) desenharTeste();
      } catch { /* tenta de novo */ }
    }
    function vigiarTeste() { clearInterval(ed.relogio); ed.relogio = setInterval(atualizarTeste, 1500); }
    function desenharTeste() {
      const t = ed.teste;
      const corpoT = el('div', { class: 'bt-lado-corpo' });
      const testes = (ui.estado.conversas || []).filter((c) => String(c.canalId || '').startsWith('teste-'));
      const sel = selecao([['', testes.length ? 'Escolha a conversa…' : 'Nenhuma conversa de teste'], ...testes.map((c) => [c.id, `${ui.nomeDe(c)} · ${ui.UNIDADE?.[c.unidade] || c.unidade}`])], t.conversaId || '', (v) => { t.conversaId = v || null; });
      corpoT.append(el('p', { class: 'bt-dica', text: 'Roda o RASCUNHO numa conversa do WhatsApp de teste (nada sai para fora). Escreva como a cliente e veja o caminho acender no palco.' }),
        campo('Conversa de teste', sel),
        el('div', { class: 'bt-linha', style: 'flex-wrap:wrap' },
          el('button', { class: 'bt-botao', type: 'button', onclick: async () => { if (!sel.value) { ui.toast('Escolha ou crie uma conversa de teste.'); return; } await comecarTeste(sel.value); } }, el('span', { html: SVG.play, style: 'display:grid' }), el('span', { text: t.execId ? 'Recomeçar' : 'Começar teste' })),
          el('button', { class: 'bt-botao leve', type: 'button', onclick: async (e) => { e.currentTarget.disabled = true; try { const c = await novaClienteTeste(); t.conversaId = c.id; await comecarTeste(c.id); } catch (x) { ui.toast(x.message); } } }, el('span', { text: 'Nova cliente de teste' }))));
      if (t.exec) {
        const cam = t.exec.estado?.caminho || [];
        corpoT.append(el('div', { class: 'bt-linha', style: 'flex-wrap:wrap' }, el('span', { class: 'bt-selo' + (['pendente', 'rodando'].includes(t.exec.status) ? ' ligado' : t.exec.status === 'concluida' ? '' : ' erro'), text: `${STATUS[t.exec.status] || t.exec.status}${t.exec.estado?.espera?.tipo === 'resposta' ? ' a resposta' : ''}` }), t.exec.erro ? el('span', { class: 'bt-dica', text: t.exec.erro }) : null),
          el('div', { class: 'bt-caminho', 'aria-label': 'Caminho percorrido' }, ...cam.map((nid, i) => { const n = no(nid); return el('button', { class: 'bt-selo' + (i === cam.length - 1 && ['pendente', 'rodando'].includes(t.exec.status) ? ' ligado' : ''), type: 'button', style: 'cursor:pointer', text: `${i + 1}. ${n ? (n.titulo || INFO[n.tipo].nome) : '?'}`, onclick: () => n && focar(nid) }); })));
      }
      if (t.conversaId && t.msgs) {
        const chat = el('div', { class: 'bt-chat', 'aria-live': 'polite' }, ...(t.msgs.slice(-30).map((m) => el('div', { class: 'bt-bolha ' + (m.autor === 'cliente' ? 'cliente' : 'loja') }, document.createTextNode(m.texto), el('small', { text: `${m.autorNome || (m.autor === 'cliente' ? 'Cliente' : m.autor === 'ia' ? 'IA' : 'Equipe')} · ${ui.hm(m.em)}` })))));
        const entrada = el('input', { class: 'bt-entrada', placeholder: 'Escreva como a cliente…', maxlength: '500', 'aria-label': 'Mensagem da cliente de teste' });
        const enviar = async () => {
          const texto = entrada.value.trim(); if (!texto || !t.conv) return;
          entrada.value = '';
          try { await ui.post('/api/teste/cliente', { unidade: t.conv.unidade === 'sumare' ? 'sumare' : 'norte', nome: t.conv.nome || 'Cliente Teste', telefone: t.conv.telefone, texto }); await atualizarTeste(); } catch (x) { ui.toast(x.message); }
        };
        entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') enviar(); });
        corpoT.append(chat, el('div', { class: 'bt-linha' }, entrada, el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Enviar', html: SVG.enviar, onclick: enviar })));
        requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
      }
      const execs = el('div', { class: 'bt-execs' });
      corpoT.append(el('h4', { text: 'Execuções recentes', style: 'margin:6px 0 0;font-size:13px;color:var(--sub)' }), execs);
      ui.api(`/api/bots/${ed.fluxo.id}/execucoes?limite=8`).then((l) => execs.replaceChildren(...(l.length ? l.map((x) => el('button', { class: 'bt-exec', type: 'button', onclick: () => { t.exec = x; t.execId = x.id; t.conversaId = x.conversaId; atualizarTeste(); vigiarTeste(); } },
        el('span', { text: `${x.teste ? '🧪 ' : ''}${(ui.estado.conversas || []).find((c) => c.id === x.conversaId) ? ui.nomeDe((ui.estado.conversas || []).find((c) => c.id === x.conversaId)) : 'Conversa'}` }), el('span', { class: 'bt-selo', style: 'flex:none', text: STATUS[x.status] || x.status }), el('small', { text: ui.quando(x.criadaEm) }))) : [el('span', { class: 'bt-dica', text: 'Ainda não rodou.' })]))).catch(() => {});
      lado.replaceChildren(el('div', { class: 'bt-lado-topo' }, el('h3', {}, el('i', { text: '🧪' }), el('span', { text: 'Testar o bot' })), el('button', { class: 'bt-redondo', type: 'button', 'aria-label': 'Fechar teste', html: SVG.fechar, onclick: () => { t.aberto = false; lado.classList.remove('aberto'); } })), corpoT);
      lado.classList.add('aberto');
    }

    // ----- fechar -----
    ed.fechar = (forcar) => {
      if (!forcar && ed.sujo && !confirm('Há mudanças não salvas. Sair mesmo assim?')) return;
      clearInterval(ed.relogio);
      removeEventListener('keydown', teclas); removeEventListener('resize', aoRedimensionar);
      raiz.remove(); document.documentElement.style.overflow = '';
      if (s.ed === ed) s.ed = null;
      ed.aoMudar?.();
    };

    aplicarVista();
    desenharTudo({ painel: false });
    aplicarVisao();
    requestAnimationFrame(() => { ajustar(); desenharLinhas(); });
    return ed;
  }

  window.SintoniaTelas.bot = { desenhar, abrirEditor, escolherDaEtapa, iniciarNaConversa, novoBot, abasAutomacoes: (a) => abasAutomacoes(a) };
})();
