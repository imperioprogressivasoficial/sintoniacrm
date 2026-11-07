/* Tela "automacoes" da Sintonia: registra window.SintoniaTelas.automacoes = { desenhar(caixa, ui), abrirEditor(opcoes), abrirDaEtapa(opcoes) }.
 * Automações = "Quando <gatilho> → passo → passo…". Tudo escrito para quem atende no salão entender.
 * - desenhar(caixa, ui): a página com a lista, o filtro por funil e o limite diário.
 * - abrirEditor({ automacao | id, funilId, gatilho, nome, aoSalvar }): o editor (tela cheia no celular).
 * - abrirDaEtapa({ funilId, etapaId, etapaNome, aoMudar }): a lista das automações de uma etapa (o raio ⚡ do quadro).
 * Todo texto que vem do servidor entra por textContent (el(..., { text })), nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const SVG = {
    raio: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.2 2.5 4.8 13.4c-.3.4 0 1 .5 1h5.2l-1.4 7.1c-.1.6.7.9 1 .4l8.4-10.9c.3-.4 0-1-.5-1h-5.2l1.4-7.1c.1-.6-.7-.9-1-.4Z"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    cima: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    baixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    tubo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6M10 3v6L4.5 19A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3"/><path d="M7.5 15h9"/></svg>',
  };

  const UNIDADES = { norte: 'Salvador Norte', sumare: 'Sumaré', feira: 'Feira de Santana' };
  const MODOS = { ia: 'Agente de IA', copiloto: 'Sugestões', humano: 'Minha resposta' };

  const GATILHOS = [
    ['entrou_na_etapa', 'Entrar numa etapa', 'A cliente chega numa etapa do funil'],
    ['parada_na_etapa', 'Ficar parada numa etapa', 'Passou um tempo e ela não saiu da etapa'],
    ['nova_conversa', 'Cliente nova', 'Primeira mensagem de uma cliente'],
    ['palavra_chave', 'Palavra-chave', 'A cliente escreve uma palavra (o “bot”)'],
    ['tag_marcada', 'Tag marcada', 'Alguém (ou a IA) marca uma tag'],
    ['aniversario', 'Aniversário', 'No dia do aniversário da cliente (ficha)'],
    ['dias_apos_compareceu', 'Depois de comparecer', 'X dias depois de entrar em “Compareceu”'],
  ];
  const PASSOS = [
    ['enviar_mensagem', '💬', 'Enviar mensagem', 'Manda uma mensagem no WhatsApp'],
    ['esperar', '⏳', 'Esperar', 'Aguarda minutos, horas ou dias'],
    ['mover_etapa', '➡️', 'Mover de etapa', 'Leva o cartão para outra etapa'],
    ['marcar_tag', '🏷️', 'Marcar tag', 'Põe uma tag na conversa'],
    ['desmarcar_tag', '🧹', 'Tirar tag', 'Remove uma tag da conversa'],
    ['atribuir', '👤', 'Passar para alguém', 'Define quem atende a cliente'],
    ['fluxo_ia', '✨', 'IA conduz com um objetivo', 'A IA assume com uma missão'],
    ['mudar_modo', '🔁', 'Mudar quem responde', 'IA, Sugestões ou Minha resposta'],
    ['lembrete_ligacao', '📞', 'Lembrete de ligação', 'Aparece em “Ligar hoje”'],
    ['enviar_email', '✉️', 'Enviar e-mail', 'Manda um modelo do E-mail marketing'],
    ['condicao', '🔀', 'Se… senão…', 'Faz uma coisa ou outra'],
  ];
  const NOME_PASSO = Object.fromEntries(PASSOS.map(([t, i, n]) => [t, [i, n]]));
  const CONDICOES = [['cliente_respondeu', 'a cliente respondeu'], ['tem_tag', 'a conversa tem a tag'], ['modo', 'quem responde é'], ['horario_loja', 'a loja está aberta agora']];
  const VARIAVEIS = [['{primeiro_nome}', 'primeiro nome'], ['{nome}', 'nome completo'], ['{unidade}', 'unidade'], ['{atendente}', 'atendente']];
  const STATUS = { pendente: 'Na fila', rodando: 'Rodando', concluida: 'Concluída', cancelada: 'Cancelada', erro: 'Erro' };

  const CSS = `
  #automacoes.au-caixa { display: block; padding-bottom: 110px; }
  .au-tela { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
  .au-cab { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .au-cab .titulo-grande { margin: 2px 0 0; flex: none; min-width: 0; display: flex; align-items: center; gap: 10px; font-size: 38px; letter-spacing: -.03em; }
  .au-numeros { display: flex; align-items: center; gap: 20px; flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; padding: 2px; }
  .au-numeros::-webkit-scrollbar { display: none; }
  .au-kpi { display: flex; align-items: center; gap: 10px; flex: none; }
  .au-kpi-ic { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; flex: none; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda), inset 0 1px 0 rgba(255,255,255,.12); }
  .au-kpi-ic svg { width: 18px; height: 18px; }
  .au-kpi-ic.au-amb { color: #f5b800; box-shadow: inset 0 0 0 1px rgba(245,184,0,.45), 0 0 14px rgba(245,184,0,.22); }
  .au-kpi div { display: grid; line-height: 1.15; }
  .au-kpi b { font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
  .au-kpi small { font-size: 12px; color: var(--sub); white-space: nowrap; }
  .au-raio { color: #f5b800; display: inline-grid; filter: drop-shadow(0 0 8px rgba(255,190,0,.6)); }
  .au-raio svg { width: 1em; height: 1em; }
  .au-sub { margin: -8px 2px 0; color: var(--sub); font-size: 14.5px; line-height: 1.45; }
  .au-filtros { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px; }
  .au-filtros { justify-self: start; max-width: 100%; box-sizing: border-box; gap: 2px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho);
    -webkit-backdrop-filter: blur(18px) saturate(1.4); backdrop-filter: blur(18px) saturate(1.4); }
  .au-pilula { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 15px; border-radius: 999px; font-size: 14px; font-weight: 650; color: var(--sub);
    background: transparent; white-space: nowrap; transition: background .18s ease, color .18s ease; }
  .au-pilula:hover { color: var(--texto); }
  .au-pilula[aria-pressed="true"] { color: var(--texto); font-weight: 750; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 4px 14px rgba(16, 110, 190,.12); }
  html[data-tema="escuro"] .au-pilula[aria-pressed="true"] { background: rgba(255,255,255,.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,.4), 0 6px 18px rgba(0,0,0,.3); }
  .au-botao { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 20px; border-radius: 999px; font-weight: 750; font-size: 14.5px;
    background: var(--marca-menta); color: #071d33; box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 45%, transparent), 0 8px 26px color-mix(in srgb, var(--marca-menta) 36%, transparent); white-space: nowrap; transition: transform .15s ease, filter .15s ease; }
  .au-botao:hover { transform: translateY(-1px); filter: brightness(1.05); }
  .au-botao svg { width: 18px; height: 18px; }
  .au-botao.leve { background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .au-botao.perigo { background: transparent; color: #c4313b; box-shadow: inset 0 0 0 1.5px rgba(229,72,77,.55); padding: 0 16px; }
  html[data-tema="escuro"] .au-botao.perigo { color: #ff8f94; }
  .au-botao[disabled] { opacity: .55; cursor: default; }
  .au-lista { display: grid; gap: 10px; }
  .au-card { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 7px; padding: 16px 18px; border-radius: 24px; transition: transform .15s ease, border-color .15s ease; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho);
    -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  .au-card:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--marca-menta) 45%, var(--vidro-borda)); }
  .au-card .au-l1 > .au-raio { width: 36px; height: 36px; border-radius: 50%; place-items: center; background: rgba(245,184,0,.12); box-shadow: inset 0 0 0 1px rgba(245,184,0,.35); flex: none; }
  .au-card .au-l1 > .au-raio svg { width: 18px; height: 18px; }
  .au-card:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .au-card .au-l1 { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .au-card .au-l1 b { flex: 1; min-width: 0; font-size: 16.5px; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .au-card .au-quando { font-size: 14.5px; color: var(--texto); line-height: 1.4; }
  .au-card .au-passos-txt { font-size: 13.5px; color: var(--sub); line-height: 1.45; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .au-card .au-l3 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); }
  .au-selo { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; padding: 3px 8px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--sub); }
  .au-selo.ligada { color: #106ebe; background: color-mix(in srgb, var(--marca-menta) 26%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-menta) 55%, transparent); }
  html[data-tema="escuro"] .au-selo.ligada { color: #fff; }
  .au-selo.erro { color: #c4313b; background: rgba(229,72,77,.12); box-shadow: inset 0 0 0 1px rgba(229,72,77,.35); }
  html[data-tema="escuro"] .au-selo.erro { color: #ff8f94; }
  .au-selo.espera { color: #9a6700; background: rgba(255,190,0,.14); box-shadow: inset 0 0 0 1px rgba(255,190,0,.4); }
  html[data-tema="escuro"] .au-selo.espera { color: #ffd34d; }
  .au-vazio { padding: 30px 18px; border-radius: 22px; border: 1.5px dashed var(--vidro-borda); text-align: center; color: var(--sub); display: grid; gap: 12px; justify-items: center; font-size: 14.5px; line-height: 1.45; }
  .au-vazio b { color: var(--texto); font-size: 16.5px; }
  .au-config { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 16px 18px; border-radius: 24px; -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px); background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); font-size: 14.5px; }
  .au-config span { flex: 1; min-width: 220px; color: var(--sub); line-height: 1.4; }
  .au-config b { color: var(--texto); }
  .au-config select, .au-sel { background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 999px; min-height: 44px; padding: 0 14px; padding: 9px 12px; font: inherit; font-size: 15px; color: var(--texto); }

  /* interruptor */
  .au-chave { appearance: none; -webkit-appearance: none; margin: 0; flex: none; width: 46px; height: 28px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); position: relative; cursor: pointer; transition: background .2s ease; }
  .au-chave::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .2s ease; }
  .au-chave:checked { background: var(--marca-menta); box-shadow: 0 0 12px color-mix(in srgb, var(--marca-menta) 45%, transparent); }
  .au-chave:checked::after { transform: translateX(18px); }
  .au-chave:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }

  /* editor */
  dialog.au-editor { width: min(800px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 40px); padding: 0; border-radius: 28px; overflow: hidden; }
  dialog.au-editor[open] { display: flex; flex-direction: column; }
  .au-ed-topo { display: flex; align-items: center; gap: 10px; padding: 12px 14px 12px 20px; border-bottom: 1px solid var(--vidro-linha); flex: none; }
  .au-ed-topo h2 { flex: 1; min-width: 0; margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -.01em; display: flex; align-items: center; gap: 8px; }
  .au-ed-corpo { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 28px; display: grid; gap: 22px; align-content: start; overscroll-behavior: contain; }
  .au-ed-rodape { display: flex; align-items: center; gap: 10px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); border-top: 1px solid var(--vidro-linha); flex: none; }
  .au-ed-rodape .au-espaco { flex: 1; }
  .au-frase { padding: 14px 16px; border-radius: 18px; font-size: 15px; line-height: 1.55; color: var(--texto);
    background: linear-gradient(135deg, rgba(255,190,0,.12), rgba(16, 110, 190,.08)); box-shadow: inset 0 0 0 1px rgba(255,190,0,.35); }
  .au-frase .au-raio { vertical-align: -2px; margin-right: 4px; }
  .au-frase i { font-style: normal; color: var(--sub); margin: 0 4px; }
  .au-secao { display: grid; gap: 12px; }
  .au-secao > h3 { margin: 0; font-size: 13px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); display: flex; align-items: center; gap: 8px; }
  .au-secao > h3 em { font-style: normal; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--marca-gradiente); color: #fff; font-size: 12px; letter-spacing: 0; }
  .au-grade { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  dialog.au-editor label { display: grid; gap: 5px; font-size: 13.5px; color: var(--sub); }
  dialog.au-editor input:not([type=checkbox]):not([type=radio]), dialog.au-editor select, dialog.au-editor textarea { background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 16px; min-height: 46px; padding: 11px 12px; font: inherit; font-size: 16px; color: var(--texto); width: 100%; box-sizing: border-box; min-width: 0; }
  dialog.au-editor textarea { resize: vertical; min-height: 84px; line-height: 1.4; }
  .au-opcoes-gatilho { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(138px, 1fr)); }
  .au-op { all: unset; cursor: pointer; box-sizing: border-box; display: grid; gap: 2px; padding: 12px 14px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .au-op b { font-size: 14.5px; font-weight: 750; color: var(--texto); }
  .au-op small { font-size: 12.5px; color: var(--sub); line-height: 1.3; }
  .au-op[aria-pressed="true"] { background: var(--vidro-ativo); box-shadow: inset 0 0 0 2px var(--marca-menta), 0 8px 22px color-mix(in srgb, var(--marca-menta) 20%, transparent); }
  .au-duracao { display: grid; grid-template-columns: minmax(70px, 110px) minmax(100px, 1fr); gap: 8px; }
  .au-linha-chave, dialog.au-editor label.au-linha-chave { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); font-size: 15px; cursor: pointer; }
  .au-linha-chave span { flex: 1; display: grid; gap: 2px; }
  .au-linha-chave small { font-size: 12.5px; color: var(--sub); }
  .au-vars { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: var(--sub); }
  .au-vars button { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 700; padding: 4px 9px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--marca-azul); }
  html[data-tema="escuro"] .au-vars button { color: var(--marca-menta); }

  .au-passos { display: grid; gap: 0; }
  .au-passo { display: grid; gap: 10px; padding: 14px 14px 16px 16px; border-radius: 22px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda), inset 0 1px 0 rgba(255,255,255,.12), 0 4px 14px rgba(7, 29, 51,.08); }
  .au-passo-topo { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .au-num.nao { background: #8b8d98; }
  .au-num { width: 28px; height: 28px; border-radius: 50%; flex: none; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: #fff; background: var(--marca-gradiente); }
  .au-passo-topo b { flex: 1; min-width: 0; font-size: 15.5px; font-weight: 750; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .au-mini { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; }
  .au-mini:hover { background: var(--vidro-item); color: var(--texto); }
  .au-mini[disabled] { opacity: .3; cursor: default; }
  .au-mini svg { width: 18px; height: 18px; }
  .au-mini.perigo:hover { color: #e5484d; }
  .au-liga { justify-self: start; margin-left: 29px; width: 2px; height: 16px; background: linear-gradient(var(--vidro-borda), color-mix(in srgb, var(--marca-menta) 60%, transparent)); }
  .au-ramo { display: grid; gap: 8px; padding: 10px 10px 10px 12px; border-radius: 14px; border-left: 3px solid var(--marca-azul); background: color-mix(in srgb, var(--marca-azul) 5%, transparent); }
  .au-ramo.nao { border-left-color: #8b8d98; background: color-mix(in srgb, #8b8d98 6%, transparent); }
  .au-ramo > b { font-size: 13px; font-weight: 800; color: var(--sub); }
  .au-add { all: unset; cursor: pointer; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 48px; padding: 0 14px; border-radius: 999px; font-weight: 750; font-size: 14.5px;
    color: var(--marca-azul); border: 1.5px dashed color-mix(in srgb, var(--marca-azul) 40%, var(--vidro-borda)); }
  html[data-tema="escuro"] .au-add { color: var(--marca-menta); border-color: color-mix(in srgb, var(--marca-menta) 40%, transparent); }
  .au-add svg { width: 18px; height: 18px; }
  .au-catalogo { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); padding: 10px; border-radius: 22px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .au-catalogo button { all: unset; cursor: pointer; box-sizing: border-box; display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: 14px; }
  .au-catalogo button:hover, .au-catalogo button:focus-visible { background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .au-catalogo .au-emoji { font-size: 20px; width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: var(--vidro-ativo); flex: none; }
  .au-catalogo span:last-child { display: grid; gap: 1px; min-width: 0; }
  .au-catalogo b { font-size: 14px; font-weight: 750; }
  .au-catalogo small { font-size: 12px; color: var(--sub); line-height: 1.3; }

  .au-teste { display: grid; gap: 10px; padding: 16px; border-radius: 22px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .au-teste .au-linha { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
  .au-teste .au-linha label { flex: 1; min-width: 200px; }
  .au-log { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; font-size: 13.5px; }
  .au-log li { display: grid; grid-template-columns: 20px 1fr auto; gap: 8px; padding: 6px 4px; border-bottom: 1px solid var(--vidro-linha); align-items: start; }
  .au-log li:last-child { border-bottom: 0; }
  .au-log .ok { color: #12a594; font-weight: 800; }
  .au-log .nok { color: #e5484d; font-weight: 800; }
  .au-log small { color: var(--sub); white-space: nowrap; }
  .au-exec { all: unset; cursor: pointer; box-sizing: border-box; display: grid; gap: 6px; padding: 10px 12px; border-radius: 14px; }
  .au-exec:hover { background: var(--vidro-item); }
  .au-exec .au-l1 { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14.5px; }
  .au-exec .au-l1 b { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 700; }
  .au-exec .au-l1 small { color: var(--sub); white-space: nowrap; }
  .au-exec .au-det { font-size: 13px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .au-erro { color: #e5484d; font-size: 14px; font-weight: 600; }
  .au-erro:empty { display: none; }
  .au-info { font-size: 13.5px; color: var(--sub); line-height: 1.45; margin: 0; }

  /* folha da etapa */
  dialog.au-folha .au-lista { gap: 8px; }
  dialog.au-folha .au-card { padding: 12px 14px; border-radius: 16px; -webkit-backdrop-filter: none; backdrop-filter: none; }
  dialog.au-folha .au-sub { margin: -4px 6px 12px; text-align: center; }

  @media (max-width: 760px) {
    dialog.au-editor { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; border-radius: 0; border: 0; }
    .au-ed-topo { padding: calc(8px + env(safe-area-inset-top)) 10px 8px 16px; }
    .au-ed-corpo { padding: 14px 14px 28px; }
    .au-ed-rodape .au-botao { padding: 0 14px; }
    .au-ed-rodape .au-sotexto { display: none; }
    .au-cab .au-botao { width: 100%; }
    .au-cab .titulo-grande { font-size: 32px; }
    .au-numeros { order: 3; flex: 1 1 100%; gap: 8px; }
    .au-kpi { padding: 6px 14px 6px 6px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
    .au-kpi-ic { width: 34px; height: 34px; }
    .au-kpi b { font-size: 18px; }
    .au-opcoes-gatilho { grid-template-columns: 1fr 1fr; }
    .au-catalogo { grid-template-columns: 1fr; }
  }
  `;

  // ---------- estado ----------
  const lerSessao = (k) => { try { return sessionStorage.getItem(k); } catch { return null; } };
  const gravarSessao = (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  const s = { ui: null, caixa: null, base: null, baseEm: 0, filtro: lerSessao('sintonia.automacoes.filtro') || 'todas', lista: [], execs: {} };
  const UI = () => s.ui || window.Sintonia?.ui;
  const ehGestao = () => { const ui = UI(); return ui && ui.ehGestor(ui.estado.eu); };

  function estilo() {
    if (document.getElementById('estilo-automacoes')) return;
    const st = document.createElement('style');
    st.id = 'estilo-automacoes';
    st.textContent = CSS;
    document.head.append(st);
  }

  /** Funis, tags e equipe (para os campos e para escrever as frases). */
  async function base(forcar) {
    if (!forcar && s.base && Date.now() - s.baseEm < 30000) return s.base;
    const ui = UI();
    const [funis, tags, equipe, modelosEmail] = await Promise.all([ui.api('/api/funis').catch(() => []), ui.api('/api/tags').catch(() => []), ui.api('/api/equipe').catch(() => ({ pessoas: [] })), ui.api('/api/email/modelos').catch(() => [])]);
    const etapas = new Map(), tagsMap = new Map();
    for (const f of funis) for (const e of f.etapas || []) etapas.set(e.id, { ...e, funilNome: f.nome, sistema: f.sistema });
    for (const t of tags) tagsMap.set(t.id, t);
    s.base = { funis, tags, pessoas: (equipe.pessoas || []).filter((p) => p.ativo !== false), etapas, tagsMap, modelosEmail: Array.isArray(modelosEmail) ? modelosEmail : [] };
    s.baseEm = Date.now();
    return s.base;
  }
  const etapaNome = (id) => s.base?.etapas.get(id)?.nome || 'etapa apagada';
  const tagNome = (id) => s.base?.tagsMap.get(id)?.nome || s.base?.etapas.get(id)?.nome || 'tag apagada';
  const funilNome = (id) => s.base?.funis.find((f) => f.id === id)?.nome || '';
  const pessoaNome = (id) => (id ? s.base?.pessoas.find((p) => p.id === id)?.nome || 'pessoa' : 'ninguém');

  // ---------- frases simples ----------
  function duracao(min) {
    min = Number(min) || 0;
    if (min === 0) return 'na hora';
    if (min % 1440 === 0) { const d = min / 1440; return `${d} dia${d > 1 ? 's' : ''}`; }
    if (min % 60 === 0) { const h = min / 60; return `${h} hora${h > 1 ? 's' : ''}`; }
    if (min > 60) return `${Math.floor(min / 60)} h ${min % 60} min`;
    return `${min} min`;
  }
  const aspas = (t) => `“${t}”`;
  const curto = (t, n = 48) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  function fraseGatilho(g) {
    if (!g) return 'Quando…';
    switch (g.tipo) {
      case 'entrou_na_etapa': return `Quando a cliente entrar em ${aspas(etapaNome(g.etapaId))}`;
      case 'parada_na_etapa': return `Quando a cliente ficar ${duracao((g.horas || 0) * 60)} parada em ${aspas(etapaNome(g.etapaId))}`;
      case 'nova_conversa': return `Quando uma cliente nova mandar a primeira mensagem${g.unidade ? ` (${UNIDADES[g.unidade] || g.unidade})` : ''}`;
      case 'palavra_chave': {
        const p = (g.palavras || []).filter(Boolean).map(aspas);
        if (!p.length) return 'Quando a cliente escrever uma palavra-chave';
        return g.modo === 'exata' ? `Quando a cliente mandar só ${p.join(' ou ')}` : `Quando a cliente escrever ${p.join(', ')}`;
      }
      case 'tag_marcada': return `Quando marcarem a tag ${aspas(tagNome(g.tagId))}`;
      case 'aniversario': return 'No dia do aniversário da cliente';
      case 'dias_apos_compareceu': return `${g.dias || 0} dia(s) depois de a cliente comparecer`;
      default: return 'Quando…';
    }
  }
  function frasePasso(p) {
    switch (p.tipo) {
      case 'enviar_mensagem': return p.texto ? `enviar ${aspas(curto(p.texto, 60))}` : 'enviar mensagem';
      case 'esperar': return `esperar ${duracao(p.minutos)}`;
      case 'mudar_modo': return `passar para ${MODOS[p.modo] || p.modo}`;
      case 'fluxo_ia': return p.objetivo ? `IA conduz: ${aspas(curto(p.objetivo, 50))}` : 'IA conduz com um objetivo';
      case 'mover_etapa': return `mover para ${aspas(etapaNome(p.etapaId))}`;
      case 'marcar_tag': return `marcar ${aspas(tagNome(p.tagId))}`;
      case 'desmarcar_tag': return `tirar ${aspas(tagNome(p.tagId))}`;
      case 'atribuir': return `passar para ${pessoaNome(p.usuarioId)}${p.unidade ? ` (só ${UNIDADES[p.unidade]})` : ''}`;
      case 'lembrete_ligacao': return `lembrete de ligação ${p.em_minutos ? `em ${duracao(p.em_minutos)}` : 'na hora'}`;
      case 'enviar_email': return `enviar o e-mail ${aspas(s.base?.modelosEmail?.find((m) => m.id === p.modeloId)?.nome || 'modelo')}`;
      case 'condicao': {
        const c = CONDICOES.find(([k]) => k === p.se)?.[1] || '';
        const v = p.se === 'tem_tag' ? ` ${aspas(tagNome(p.valor))}` : p.se === 'modo' ? ` ${MODOS[p.valor] || ''}` : '';
        const sim = (p.entao || []).map(frasePasso).join(' → ') || 'nada';
        const nao = (p.senao || []).map(frasePasso).join(' → ') || 'nada';
        return `se ${c}${v}: ${sim}; senão: ${nao}`;
      }
      default: return p.tipo;
    }
  }
  const frasePassos = (passos) => (passos || []).map(frasePasso).join(' → ');

  // ---------- pequenas peças ----------
  function chave(marcada, aoMudar, rotulo) {
    const { el } = UI();
    const c = el('input', { type: 'checkbox', class: 'au-chave', role: 'switch', 'aria-label': rotulo });
    c.checked = !!marcada;
    c.addEventListener('click', (e) => e.stopPropagation());
    c.addEventListener('change', () => aoMudar(c.checked, c));
    return c;
  }
  function selecao(opcoes, valor, aoMudar, attrs = {}) {
    const { el } = UI();
    const sel = el('select', attrs);
    for (const o of opcoes) {
      if (o.grupo) { const g = el('optgroup', { label: o.grupo }); for (const [v, n] of o.itens) g.append(el('option', { value: v, text: n })); if (o.itens.length) sel.append(g); }
      else sel.append(el('option', { value: o[0], text: o[1] }));
    }
    sel.value = valor ?? '';
    if (sel.selectedIndex < 0 && sel.options.length) { sel.selectedIndex = 0; }
    sel.addEventListener('change', () => aoMudar(sel.value));
    return sel;
  }
  const rotulo = (texto, campo) => UI().el('label', {}, UI().el('span', { text: texto }), campo);
  /** minutos ⇄ número + unidade. unidades: lista entre 'min' | 'h' | 'd'. */
  function duracaoCampo(minutos, aoMudar, { unidades = ['min', 'h', 'd'], minimo = 1 } = {}) {
    const { el } = UI();
    const FATOR = { min: 1, h: 60, d: 1440 };
    const NOME = { min: 'minutos', h: 'horas', d: 'dias' };
    let u = unidades.slice().reverse().find((x) => minutos % FATOR[x] === 0 && minutos >= FATOR[x]) || unidades[0];
    const num = el('input', { type: 'number', min: String(minimo ? 1 : 0), step: '1', inputmode: 'numeric', value: String(Math.round(minutos / FATOR[u])), 'aria-label': 'Quanto tempo' });
    const sel = selecao(unidades.map((x) => [x, NOME[x]]), u, (v) => { u = v; mudou(); }, { 'aria-label': 'Unidade de tempo' });
    const mudou = () => aoMudar(Math.max(minimo, Math.round((Number(num.value) || 0) * FATOR[u])));
    num.addEventListener('input', mudou);
    return el('div', { class: 'au-duracao' }, num, sel);
  }
  const opcoesEtapas = (funilId, { semSistemaSoltas = false } = {}) => (s.base?.funis || [])
    .filter((f) => !funilId || f.id === funilId)
    .map((f) => ({ grupo: `Funil ${f.nome}`, itens: (f.etapas || []).filter((e) => !(semSistemaSoltas && f.sistema)).map((e) => [e.id, e.nome]) }));
  const opcoesTags = ({ semSistema = false } = {}) => [{ grupo: 'Tags', itens: (s.base?.tags || []).map((t) => [t.id, t.nome]) }, ...opcoesEtapas(null, { semSistemaSoltas: semSistema }).map((g) => ({ ...g, grupo: `Etapas do ${g.grupo.toLowerCase()}` }))];
  const primeiraOpcao = (grupos) => { for (const g of grupos) if (g.itens.length) return g.itens[0][0]; return ''; };

  function statusSelo(x) {
    const { el, hm } = UI();
    const esperando = x.status === 'pendente' && x.proximaEm && new Date(x.proximaEm) > new Date();
    const texto = esperando ? `Esperando até ${new Date(x.proximaEm).toDateString() === new Date().toDateString() ? hm(x.proximaEm) : UI().quando(x.proximaEm)}` : STATUS[x.status] || x.status;
    const classe = x.status === 'concluida' ? 'ligada' : x.status === 'erro' || x.status === 'cancelada' ? 'erro' : 'espera';
    return el('span', { class: 'au-selo ' + classe, text: texto + (x.teste ? ' · teste' : '') });
  }
  function logLista(log) {
    const { el, hm } = UI();
    return el('ul', { class: 'au-log' }, ...(log || []).map((l) => el('li', {},
      el('span', { class: l.ok ? 'ok' : 'nok', text: l.ok ? '✓' : '✗' }),
      el('span', { text: l.detalhe || l.passo }),
      el('small', { text: l.em ? hm(l.em) : '' }))));
  }

  // ---------- página ----------
  async function desenhar(caixa, ui) {
    s.ui = ui; s.caixa = caixa;
    estilo();
    caixa.classList.add('au-caixa');
    const { el } = ui;
    const tela = el('div', { class: 'au-tela' });
    caixa.replaceChildren(tela);
    tela.append(el('div', { class: 'au-cab' }, el('h1', { class: 'titulo-grande' }, el('span', { class: 'au-raio', html: SVG.raio }), el('span', { text: 'Automações' })),
      ehGestao() ? el('button', { class: 'au-botao', type: 'button', onclick: () => abrirEditor({ funilId: s.filtro !== 'todas' && s.filtro !== 'geral' ? s.filtro : null, aoSalvar: () => desenhar(caixa, ui) }) }, el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Nova automação' })) : null));
    tela.append(el('p', { class: 'au-sub', text: 'O que a Sintonia faz sozinha. Ex.: quando a cliente entrar em “Proposta” → esperar 1 dia → mandar uma mensagem. O jeito mais rápido de criar é pelo raio ⚡ em cada etapa do CRM.' }));
    if (!ehGestao()) { tela.append(el('div', { class: 'au-vazio' }, el('b', { text: 'Só a gestão mexe nas automações.' }), el('span', { text: 'Peça para a gerência criar ou mudar uma automação.' }))); return; }
    const corpo = el('div', { class: 'au-lista' }, el('p', { class: 'au-info', text: 'Carregando…' }));
    const filtros = el('div', { class: 'au-filtros', role: 'group', 'aria-label': 'Filtrar por funil' });
    const config = el('div', { class: 'au-config' });
    tela.append(filtros, corpo, config);
    const numeros = el('div', { class: 'au-numeros', 'aria-label': 'Resumo das automações' });
    tela.querySelector('.au-cab')?.insertBefore(numeros, tela.querySelector('.au-cab .au-botao'));
    let lista;
    try { [lista] = await Promise.all([ui.api('/api/automacoes'), base(true)]); } catch (x) { corpo.replaceChildren(el('p', { class: 'au-erro', text: x.message })); return; }
    s.lista = lista;
    const ligadas = lista.filter((a) => a.ligada).length;
    const num = (icone, valor, rotulo, amb) => el('div', { class: 'au-kpi' }, el('span', { class: 'au-kpi-ic' + (amb ? ' au-amb' : ''), html: icone }), el('div', {}, el('b', { text: String(valor) }), el('small', { text: rotulo })));
    numeros.replaceChildren(num(SVG.raio, ligadas, 'Ligadas', true), num(SVG.tubo, lista.length, 'No total'), num(SVG.seta, lista.length - ligadas, 'Desligadas'));
    const desenharFiltros = () => filtros.replaceChildren(...[['todas', 'Todas'], ['geral', 'Gerais'], ...s.base.funis.map((f) => [f.id, f.nome])].map(([v, n]) => {
      const qtd = v === 'todas' ? lista.length : v === 'geral' ? lista.filter((a) => !a.funilId).length : lista.filter((a) => a.funilId === v || (!a.funilId && s.base.etapas.get(a.gatilho?.etapaId)?.funilId === v)).length;
      return el('button', { class: 'au-pilula', type: 'button', 'aria-pressed': String(s.filtro === v), onclick: () => { s.filtro = v; gravarSessao('sintonia.automacoes.filtro', v); desenharFiltros(); desenharLista(); } },
        el('span', { text: n }), el('span', { style: 'opacity:.7', text: String(qtd) }));
    }));
    const desenharLista = () => {
      const f = s.filtro;
      const vis = lista.filter((a) => f === 'todas' || (f === 'geral' ? !a.funilId : a.funilId === f || (!a.funilId && s.base.etapas.get(a.gatilho?.etapaId)?.funilId === f)));
      if (!vis.length) {
        corpo.replaceChildren(el('div', { class: 'au-vazio' }, el('b', { text: lista.length ? 'Nenhuma automação aqui.' : 'Nenhuma automação ainda.' }),
          el('span', { text: 'Comece por uma etapa do CRM: toque no raio ⚡ da coluna e diga o que fazer quando a cliente chegar lá.' }),
          el('button', { class: 'au-botao', type: 'button', onclick: () => abrirEditor({ aoSalvar: () => desenhar(caixa, ui) }) }, el('span', { text: 'Criar automação' }))));
        return;
      }
      corpo.replaceChildren(...vis.map((a) => cartaoAutomacao(a, () => desenhar(caixa, ui))));
    };
    desenharFiltros(); desenharLista();
    // limite diário
    try {
      const cfg = await ui.api('/api/automacoes/config');
      const sel = selecao(Array.from({ length: 21 }, (_, i) => [String(i), i === 0 ? 'nenhuma (sem envio automático)' : `${i} mensage${i === 1 ? 'm' : 'ns'}`]), String(cfg.limiteDiario), async (v) => {
        try { await ui.api('/api/automacoes/config', { method: 'PATCH', body: JSON.stringify({ limiteDiario: Number(v) }) }); ui.toast('Limite salvo ✓'); } catch (x) { ui.toast(x.message); }
      }, { 'aria-label': 'Limite diário de mensagens automáticas por cliente' });
      config.replaceChildren(el('span', {}, el('b', { text: 'Limite por cliente: ' }), document.createTextNode('no máximo, quantas mensagens automáticas a mesma cliente recebe por dia (horário da Bahia). Protege contra mensagem demais.')), sel);
    } catch { config.remove(); }
    // nº de execuções (em segundo plano)
    for (const a of lista) contarExecucoes(a.id);
  }

  async function contarExecucoes(id) {
    try {
      const ex = await UI().api(`/api/automacoes/${id}/execucoes?limite=50`);
      s.execs[id] = ex;
      document.querySelectorAll(`[data-execs="${CSS_ESC(id)}"]`).forEach((n) => { n.textContent = ex.length ? `${ex.length >= 50 ? '50+' : ex.length} execuç${ex.length === 1 ? 'ão' : 'ões'}` : 'nunca rodou'; });
    } catch { /* sem contagem */ }
  }
  const CSS_ESC = (t) => (window.CSS && CSS.escape ? CSS.escape(t) : String(t).replace(/"/g, '\\"'));

  function cartaoAutomacao(a, aoMudar, aoAbrir) {
    const { el } = UI();
    const abrir = aoAbrir || (() => abrirEditor({ automacao: a, aoSalvar: aoMudar }));
    const ex = s.execs[a.id];
    const selo = el('span', { class: 'au-selo' + (a.ligada ? ' ligada' : ''), text: a.ligada ? 'Ligada' : 'Desligada' });
    const sw = chave(a.ligada, async (v, c) => {
      try {
        const r = await UI().post(`/api/automacoes/${a.id}/${v ? 'ligar' : 'desligar'}`);
        a.ligada = r.ligada; selo.className = 'au-selo' + (a.ligada ? ' ligada' : ''); selo.textContent = a.ligada ? 'Ligada' : 'Desligada';
        UI().toast(a.ligada ? `“${a.nome}” ligada ⚡` : `“${a.nome}” desligada`);
        if (s.aoMudarExterno) s.aoMudarExterno();
      } catch (x) { c.checked = !v; UI().toast(x.message); }
    }, `Ligar ou desligar ${a.nome}`);
    const funil = a.funilId ? funilNome(a.funilId) : 'Geral';
    return el('div', { class: 'au-card', role: 'button', tabindex: '0', onclick: abrir, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) abrir(); } },
      el('div', { class: 'au-l1' }, el('span', { class: 'au-raio', html: SVG.raio, style: a.ligada ? '' : 'filter:none;opacity:.45' }), el('b', { text: a.nome }), sw),
      el('div', { class: 'au-quando', text: fraseGatilho(a.gatilho) }),
      el('div', { class: 'au-passos-txt', text: '→ ' + frasePassos(a.passos) }),
      el('div', { class: 'au-l3' }, selo, el('span', { class: 'au-selo', text: funil }), el('span', { 'data-execs': a.id, text: ex ? (ex.length ? `${ex.length >= 50 ? '50+' : ex.length} execuç${ex.length === 1 ? 'ão' : 'ões'}` : 'nunca rodou') : '' })));
  }

  // ---------- automações de uma etapa (o raio ⚡) ----------
  async function abrirDaEtapa({ funilId = null, etapaId, etapaNome: nomeEtapa, aoMudar } = {}) {
    const ui = UI(); const { el } = ui;
    estilo();
    let lista;
    try { [lista] = await Promise.all([ui.api('/api/automacoes'), base()]); } catch (x) { ui.toast(x.message); return; }
    const daEtapa = lista.filter((a) => a.gatilho && a.gatilho.etapaId === etapaId);
    const d = el('dialog', { class: 'folha au-folha' });
    const fechar = () => d.close();
    const depois = () => { if (aoMudar) aoMudar(); };
    d.append(el('div', { class: 'folha-topo' }, el('span'), el('h2', {}, el('span', { class: 'au-raio', html: SVG.raio, style: 'margin-right:6px;vertical-align:-2px' }), el('span', { text: nomeEtapa || etapaNome(etapaId) })),
      el('button', { class: 'icone fechar-folha', type: 'button', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar })));
    d.append(el('p', { class: 'au-sub', text: `${daEtapa.length} automação${daEtapa.length === 1 ? '' : 'ões'} nesta etapa. Toque para editar.` }));
    s.aoMudarExterno = depois;
    d.append(el('div', { class: 'au-lista' }, ...daEtapa.map((a) => {
      return cartaoAutomacao(a, depois, () => { fechar(); abrirEditor({ automacao: a, aoSalvar: depois }); });
    })));
    d.append(el('div', { style: 'display:grid;margin-top:12px' }, el('button', { class: 'au-add', type: 'button', onclick: () => { fechar(); abrirEditor({ funilId, gatilho: { tipo: 'entrou_na_etapa', etapaId }, nome: `Ao entrar em ${nomeEtapa || etapaNome(etapaId)}`, aoSalvar: depois }); } },
      el('span', { html: SVG.mais, style: 'display:grid' }), el('span', { text: 'Nova automação nesta etapa' }))));
    d.addEventListener('close', () => { d.remove(); s.aoMudarExterno = null; });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    d.showModal();
  }

  // ---------- editor ----------
  const NOVO_PASSO = {
    enviar_mensagem: () => ({ tipo: 'enviar_mensagem', texto: '', so_no_horario: true }),
    esperar: () => ({ tipo: 'esperar', minutos: 1440 }),
    mudar_modo: () => ({ tipo: 'mudar_modo', modo: 'humano' }),
    fluxo_ia: () => ({ tipo: 'fluxo_ia', objetivo: '', dias: 7 }),
    mover_etapa: (ed) => { const f = s.base.funis.find((x) => x.id === ed.draft.funilId) || s.base.funis[0]; return { tipo: 'mover_etapa', funilId: f?.id || '', etapaId: f?.etapas?.[0]?.id || '' }; },
    marcar_tag: () => ({ tipo: 'marcar_tag', tagId: primeiraOpcao(opcoesTags()) }),
    desmarcar_tag: () => ({ tipo: 'desmarcar_tag', tagId: primeiraOpcao(opcoesTags({ semSistema: true })) }),
    atribuir: () => ({ tipo: 'atribuir', usuarioId: null }),
    lembrete_ligacao: () => ({ tipo: 'lembrete_ligacao', em_minutos: 0, texto: '' }),
    enviar_email: () => ({ tipo: 'enviar_email', modeloId: s.base?.modelosEmail?.[0]?.id || '' }),
    condicao: () => ({ tipo: 'condicao', se: 'cliente_respondeu', entao: [], senao: [] }),
  };
  const NOVO_GATILHO = {
    entrou_na_etapa: (ed) => ({ tipo: 'entrou_na_etapa', etapaId: primeiraOpcao(opcoesEtapas(ed.draft.funilId)) }),
    parada_na_etapa: (ed) => ({ tipo: 'parada_na_etapa', etapaId: ed.draft.gatilho?.etapaId || primeiraOpcao(opcoesEtapas(ed.draft.funilId)), horas: 24 }),
    nova_conversa: () => ({ tipo: 'nova_conversa' }),
    palavra_chave: () => ({ tipo: 'palavra_chave', palavras: [], modo: 'contem' }),
    tag_marcada: () => ({ tipo: 'tag_marcada', tagId: primeiraOpcao(opcoesTags()) }),
    aniversario: () => ({ tipo: 'aniversario' }),
    dias_apos_compareceu: () => ({ tipo: 'dias_apos_compareceu', dias: 30 }),
  };

  /** Deixa o passo no formato exato da API (sem campos vazios). */
  function limparPasso(p) {
    switch (p.tipo) {
      case 'enviar_mensagem': return { tipo: p.tipo, texto: String(p.texto || '').trim(), so_no_horario: p.so_no_horario !== false };
      case 'esperar': return { tipo: p.tipo, minutos: Math.max(1, Math.round(Number(p.minutos) || 1)) };
      case 'mudar_modo': return { tipo: p.tipo, modo: p.modo };
      case 'fluxo_ia': return { tipo: p.tipo, objetivo: String(p.objetivo || '').trim(), dias: Math.min(30, Math.max(1, Math.round(Number(p.dias) || 7))) };
      case 'mover_etapa': return { tipo: p.tipo, funilId: p.funilId, etapaId: p.etapaId };
      case 'marcar_tag': case 'desmarcar_tag': return { tipo: p.tipo, tagId: p.tagId };
      case 'atribuir': { const r = { tipo: p.tipo, usuarioId: p.usuarioId || null }; if (p.unidade) r.unidade = p.unidade; return r; }
      case 'lembrete_ligacao': { const r = { tipo: p.tipo, em_minutos: Math.max(0, Math.round(Number(p.em_minutos) || 0)) }; if (String(p.texto || '').trim()) r.texto = String(p.texto).trim(); return r; }
      case 'enviar_email': return { tipo: p.tipo, modeloId: p.modeloId };
      case 'condicao': { const r = { tipo: p.tipo, se: p.se, entao: (p.entao || []).map(limparPasso), senao: (p.senao || []).map(limparPasso) }; if (p.se === 'tem_tag' || p.se === 'modo') r.valor = p.valor; return r; }
      default: return p;
    }
  }
  function limparGatilho(g) {
    switch (g.tipo) {
      case 'entrou_na_etapa': return { tipo: g.tipo, etapaId: g.etapaId };
      case 'parada_na_etapa': return { tipo: g.tipo, etapaId: g.etapaId, horas: Math.max(1, Math.round(Number(g.horas) || 1)) };
      case 'nova_conversa': return g.unidade ? { tipo: g.tipo, unidade: g.unidade } : { tipo: g.tipo };
      case 'palavra_chave': return { tipo: g.tipo, palavras: (g.palavras || []).map((p) => String(p).trim()).filter(Boolean), modo: g.modo === 'exata' ? 'exata' : 'contem' };
      case 'tag_marcada': return { tipo: g.tipo, tagId: g.tagId };
      case 'dias_apos_compareceu': return { tipo: g.tipo, dias: Math.min(365, Math.max(0, Math.round(Number(g.dias) || 0))) };
      default: return g;
    }
  }
  const contarPassos = (l) => (l || []).reduce((n, p) => n + 1 + (p.tipo === 'condicao' ? contarPassos(p.entao) + contarPassos(p.senao) : 0), 0);
  function validar(d) {
    if (!d.nome.trim()) return 'Dê um nome para a automação.';
    const g = d.gatilho;
    if ((g.tipo === 'entrou_na_etapa' || g.tipo === 'parada_na_etapa') && !g.etapaId) return 'Escolha a etapa do “Quando”.';
    if (g.tipo === 'palavra_chave' && !(g.palavras || []).some((p) => String(p).trim())) return 'Escreva pelo menos uma palavra-chave.';
    if (g.tipo === 'tag_marcada' && !g.tagId) return 'Escolha a tag do “Quando”.';
    if (!d.passos.length) return 'Adicione pelo menos um passo em “Então”.';
    if (contarPassos(d.passos) > 40) return 'No máximo 40 passos (contando os de dentro do “Se…”).';
    let erro = null, n = 0;
    const ver = (l, pre) => l.forEach((p, i) => {
      n++; if (erro) return;
      const qual = `Passo ${pre}${i + 1} (${NOME_PASSO[p.tipo]?.[1] || p.tipo})`;
      if (p.tipo === 'enviar_mensagem' && !String(p.texto || '').trim()) erro = `${qual}: escreva a mensagem.`;
      else if (p.tipo === 'fluxo_ia' && String(p.objetivo || '').trim().length < 3) erro = `${qual}: escreva o objetivo da IA.`;
      else if (p.tipo === 'mover_etapa' && !p.etapaId) erro = `${qual}: escolha a etapa.`;
      else if (p.tipo === 'enviar_email' && !p.modeloId) erro = `${qual}: escolha o modelo de e-mail (crie em E-mail marketing › Modelos).`;
      else if ((p.tipo === 'marcar_tag' || p.tipo === 'desmarcar_tag') && !p.tagId) erro = `${qual}: escolha a tag.`;
      else if (p.tipo === 'condicao') { if ((p.se === 'tem_tag' || p.se === 'modo') && !p.valor) erro = `${qual}: complete a condição.`; ver(p.entao || [], `${pre}${i + 1}.sim.`); ver(p.senao || [], `${pre}${i + 1}.não.`); }
    });
    ver(d.passos, '');
    return erro;
  }

  async function abrirEditor(opcoes = {}) {
    const ui = UI(); const { el } = ui;
    estilo();
    try { await base(); } catch (x) { ui.toast(x.message); return; }
    let a = opcoes.automacao || null;
    if (!a && opcoes.id) { try { a = await ui.api(`/api/automacoes/${opcoes.id}`); } catch (x) { ui.toast(x.message); return; } }
    const copia = (o) => JSON.parse(JSON.stringify(o));
    const ed = {
      id: a?.id || null,
      draft: a ? { nome: a.nome, funilId: a.funilId || null, ligada: !!a.ligada, gatilho: copia(a.gatilho), passos: copia(a.passos), opcoes: { parar_se_equipe_responder: a.opcoes?.parar_se_equipe_responder !== false } }
        : { nome: opcoes.nome || '', funilId: opcoes.funilId || null, ligada: false, gatilho: null, passos: [NOVO_PASSO.enviar_mensagem()], opcoes: { parar_se_equipe_responder: true } },
      sujo: false, catalogo: null,
    };
    if (!ed.draft.gatilho) ed.draft.gatilho = opcoes.gatilho ? copia(opcoes.gatilho) : NOVO_GATILHO.entrou_na_etapa(ed);
    // a etapa do gatilho manda no funil da automação (o servidor exige etapa do mesmo funil)
    const etG = s.base.etapas.get(ed.draft.gatilho.etapaId);
    if (!a && etG && !etG.sistema) ed.draft.funilId = etG.funilId;
    if (!a && etG && etG.sistema) ed.draft.funilId = null;

    const d = el('dialog', { class: 'au-editor', 'aria-label': 'Editor de automação' });
    const titulo = el('span', { text: ed.id ? 'Editar automação' : 'Nova automação' });
    const erro = el('div', { class: 'au-erro', role: 'alert' });
    const frase = el('div', { class: 'au-frase', 'aria-live': 'polite' });
    const corpo = el('div', { class: 'au-ed-corpo' });
    const marcarSujo = () => { ed.sujo = true; atualizarFrase(); erro.textContent = ''; };
    function atualizarFrase() {
      frase.replaceChildren(el('span', { class: 'au-raio', html: SVG.raio }), el('b', { text: fraseGatilho(ed.draft.gatilho) }));
      for (const p of ed.draft.passos) frase.append(el('i', { text: '→' }), document.createTextNode(frasePasso(p)));
    }

    // nome e funil
    const nome = el('input', { value: ed.draft.nome, maxlength: '80', placeholder: 'Ex.: Proposta enviada', autocomplete: 'off' });
    nome.addEventListener('input', () => { ed.draft.nome = nome.value; marcarSujo(); });
    const funilSel = selecao([['', 'Geral (qualquer funil)'], ...s.base.funis.filter((f) => !f.sistema).map((f) => [f.id, f.nome])], ed.draft.funilId || '', (v) => {
      ed.draft.funilId = v || null;
      const g = ed.draft.gatilho;
      if ((g.tipo === 'entrou_na_etapa' || g.tipo === 'parada_na_etapa') && v && s.base.etapas.get(g.etapaId)?.funilId !== v) g.etapaId = primeiraOpcao(opcoesEtapas(v));
      marcarSujo(); desenharGatilho();
    });

    // gatilho
    const gatilhoCaixa = el('div', { style: 'display:grid;gap:12px' });
    function desenharGatilho() {
      const g = ed.draft.gatilho;
      const ops = el('div', { class: 'au-opcoes-gatilho', role: 'radiogroup', 'aria-label': 'Quando' }, ...GATILHOS.map(([t, n, info]) => el('button', { type: 'button', class: 'au-op', role: 'radio', 'aria-pressed': String(g.tipo === t), 'aria-checked': String(g.tipo === t),
        onclick: () => { if (g.tipo === t) return; ed.draft.gatilho = NOVO_GATILHO[t](ed); marcarSujo(); desenharGatilho(); } }, el('b', { text: n }), el('small', { text: info }))));
      const campos = el('div', { class: 'au-grade' });
      const etapasOps = () => (ed.draft.funilId ? opcoesEtapas(ed.draft.funilId) : opcoesEtapas(null));
      if (g.tipo === 'entrou_na_etapa' || g.tipo === 'parada_na_etapa') {
        if (!g.etapaId) g.etapaId = primeiraOpcao(etapasOps());
        campos.append(rotulo('Etapa', selecao(etapasOps(), g.etapaId, (v) => { g.etapaId = v; const e = s.base.etapas.get(v); if (e && !e.sistema && !ed.id) { ed.draft.funilId = e.funilId; funilSel.value = e.funilId; } marcarSujo(); })));
        if (g.tipo === 'parada_na_etapa') campos.append(rotulo('Parada há quanto tempo', duracaoCampo((g.horas || 24) * 60, (m) => { g.horas = Math.max(1, Math.round(m / 60)); marcarSujo(); }, { unidades: ['h', 'd'] })));
      } else if (g.tipo === 'nova_conversa') {
        campos.append(rotulo('Unidade', selecao([['', 'Qualquer unidade'], ...Object.entries(UNIDADES)], g.unidade || '', (v) => { if (v) g.unidade = v; else delete g.unidade; marcarSujo(); })));
      } else if (g.tipo === 'palavra_chave') {
        const inp = el('input', { value: (g.palavras || []).join(', '), placeholder: 'preço, valor, quanto custa', autocomplete: 'off' });
        inp.addEventListener('input', () => { g.palavras = inp.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30); marcarSujo(); });
        campos.append(rotulo('Palavras (separe por vírgula)', inp),
          rotulo('Como comparar', selecao([['contem', 'A mensagem contém a palavra'], ['exata', 'A mensagem é só a palavra']], g.modo || 'contem', (v) => { g.modo = v; marcarSujo(); })));
        campos.append(el('p', { class: 'au-info', style: 'grid-column:1/-1', text: 'Vale só para mensagem da cliente. Não liga para acento nem maiúscula. “preço” não pega “preços”: escreva as duas se quiser.' }));
      } else if (g.tipo === 'tag_marcada') {
        if (!g.tagId) g.tagId = primeiraOpcao(opcoesTags());
        campos.append(rotulo('Tag', selecao(opcoesTags(), g.tagId, (v) => { g.tagId = v; marcarSujo(); })));
      } else if (g.tipo === 'aniversario') {
        campos.append(el('p', { class: 'au-info', style: 'grid-column:1/-1', text: 'Usa a data de nascimento da ficha da cliente. Dispara uma vez por ano, a partir das 9h.' }));
      } else if (g.tipo === 'dias_apos_compareceu') {
        const dias = el('input', { type: 'number', min: '0', max: '365', value: String(g.dias ?? 30), inputmode: 'numeric' });
        dias.addEventListener('input', () => { g.dias = Number(dias.value) || 0; marcarSujo(); });
        campos.append(rotulo('Quantos dias depois', dias), el('p', { class: 'au-info', style: 'grid-column:1/-1', text: 'Conta a partir do dia em que a conversa entrou em “Compareceu”. Bom para pós-atendimento e manutenção.' }));
      }
      gatilhoCaixa.replaceChildren(ops, campos);
    }

    // passos
    const passosCaixa = el('div', { style: 'display:grid;gap:12px' });
    function desenharPassos() {
      passosCaixa.replaceChildren(listaPassos(ed.draft.passos, 0, ''), botaoAdicionar(ed.draft.passos, 'raiz'));
      atualizarFrase();
    }
    function botaoAdicionar(lista, chaveCat, nivel = 0) {
      const caixa = el('div', { style: 'display:grid;gap:8px' });
      const aberto = ed.catalogo === chaveCat;
      caixa.append(el('button', { class: 'au-add', type: 'button', 'aria-expanded': String(aberto), onclick: () => { ed.catalogo = aberto ? null : chaveCat; desenharPassos(); } },
        el('span', { html: aberto ? SVG.fechar : SVG.mais, style: 'display:grid' }), el('span', { text: aberto ? 'Fechar' : lista.length ? 'Adicionar passo' : 'Adicionar o primeiro passo' })));
      if (aberto) caixa.append(el('div', { class: 'au-catalogo' }, ...PASSOS.filter(([t]) => t !== 'condicao' || nivel < 3).map(([t, emoji, n, info]) => el('button', { type: 'button', onclick: () => {
        if (contarPassos(ed.draft.passos) >= 40) { erro.textContent = 'No máximo 40 passos.'; return; }
        lista.push(NOVO_PASSO[t](ed)); ed.catalogo = null; marcarSujo(); desenharPassos();
      } }, el('span', { class: 'au-emoji', text: emoji }), el('span', {}, el('b', { text: n }), el('small', { text: info }))))));
      return caixa;
    }
    function listaPassos(lista, nivel, prefixo) {
      const caixa = el('div', { class: 'au-passos' });
      lista.forEach((p, i) => {
        if (i) caixa.append(el('div', { class: 'au-liga' }));
        caixa.append(cartaoPasso(p, lista, i, nivel, prefixo));
      });
      return caixa;
    }
    function cartaoPasso(p, lista, i, nivel, prefixo) {
      const [emoji, nomeTipo] = NOME_PASSO[p.tipo] || ['•', p.tipo];
      const mexer = (passo) => { const j = i + passo; if (j < 0 || j >= lista.length) return; [lista[i], lista[j]] = [lista[j], lista[i]]; marcarSujo(); desenharPassos(); };
      const topo = el('div', { class: 'au-passo-topo' },
        el('span', { class: 'au-num' + (/N$/.test(prefixo) ? ' nao' : ''), title: `Passo ${prefixo}${i + 1}`, text: String(i + 1) }), el('span', { text: emoji, style: 'font-size:18px' }), el('b', { text: nomeTipo }),
        el('button', { class: 'au-mini', type: 'button', title: 'Subir', 'aria-label': 'Subir passo', html: SVG.cima, disabled: i === 0 ? '' : null, onclick: () => mexer(-1) }),
        el('button', { class: 'au-mini', type: 'button', title: 'Descer', 'aria-label': 'Descer passo', html: SVG.baixo, disabled: i === lista.length - 1 ? '' : null, onclick: () => mexer(1) }),
        el('button', { class: 'au-mini perigo', type: 'button', title: 'Remover', 'aria-label': 'Remover passo', html: SVG.lixo, onclick: () => { lista.splice(i, 1); marcarSujo(); desenharPassos(); } }));
      const campos = el('div', { class: 'au-grade' });
      const larga = (n) => { n.style.gridColumn = '1/-1'; return n; };
      switch (p.tipo) {
        case 'enviar_mensagem': {
          const t = el('textarea', { maxlength: '1000', rows: '3', placeholder: 'Oi {primeiro_nome}! Passando para saber se ficou alguma dúvida sobre o orçamento 😊' });
          t.value = p.texto || '';
          t.addEventListener('input', () => { p.texto = t.value; marcarSujo(); });
          const inserir = (v) => { const a0 = t.selectionStart ?? t.value.length, b0 = t.selectionEnd ?? a0; t.setRangeText(v, a0, b0, 'end'); t.focus(); p.texto = t.value; marcarSujo(); };
          campos.append(larga(rotulo('Mensagem', t)),
            larga(el('div', { class: 'au-vars' }, el('span', { text: 'Inserir:' }), ...VARIAVEIS.map(([v, n]) => el('button', { type: 'button', title: v, text: n, onclick: () => inserir(v) })))),
            larga(linhaChave('Só no horário da loja', 'Fora do horário, espera a loja abrir para enviar', p.so_no_horario !== false, (v) => { p.so_no_horario = v; marcarSujo(); })));
          break;
        }
        case 'esperar':
          campos.append(rotulo('Esperar', duracaoCampo(p.minutos || 60, (m) => { p.minutos = m; marcarSujo(); })));
          break;
        case 'mudar_modo':
          campos.append(rotulo('Quem responde a partir daqui', selecao(Object.entries(MODOS), p.modo, (v) => { p.modo = v; marcarSujo(); })));
          break;
        case 'fluxo_ia': {
          const t = el('textarea', { maxlength: '1000', rows: '3', placeholder: 'Ex.: Descobrir o tipo de cabelo e agendar uma avaliação gratuita.' });
          t.value = p.objetivo || '';
          t.addEventListener('input', () => { p.objetivo = t.value; marcarSujo(); });
          const dias = el('input', { type: 'number', min: '1', max: '30', value: String(p.dias || 7), inputmode: 'numeric' });
          dias.addEventListener('input', () => { p.dias = Number(dias.value) || 7; marcarSujo(); });
          campos.append(larga(rotulo('Objetivo da IA (ela conversa com a cliente até conseguir)', t)), rotulo('Vale por quantos dias', dias),
            larga(el('p', { class: 'au-info', text: 'A conversa passa para o Agente de IA. Se alguém mudar para “Minha resposta”, a IA para.' })));
          break;
        }
        case 'mover_etapa': {
          const etapaSel = () => selecao(opcoesEtapas(p.funilId), p.etapaId, (v) => { p.etapaId = v; marcarSujo(); });
          let es = etapaSel();
          const caixaEtapa = rotulo('Etapa', es);
          campos.append(rotulo('Funil', selecao(s.base.funis.map((f) => [f.id, f.nome]), p.funilId, (v) => {
            p.funilId = v; p.etapaId = primeiraOpcao(opcoesEtapas(v)); const n = etapaSel(); es.replaceWith(n); es = n; marcarSujo();
          })), caixaEtapa);
          break;
        }
        case 'marcar_tag': case 'desmarcar_tag': {
          const ops = opcoesTags({ semSistema: p.tipo === 'desmarcar_tag' });
          if (!p.tagId) p.tagId = primeiraOpcao(ops);
          campos.append(rotulo('Tag', selecao(ops, p.tagId, (v) => { p.tagId = v; marcarSujo(); })));
          if (!ops.some((g) => g.itens.length)) campos.append(el('p', { class: 'au-info', text: 'Nenhuma tag criada ainda. Crie em Conta › Tags.' }));
          break;
        }
        case 'atribuir':
          campos.append(rotulo('Passar para', selecao([['', 'Ninguém (fica sem dona)'], ...s.base.pessoas.map((x) => [x.id, x.nome])], p.usuarioId || '', (v) => { p.usuarioId = v || null; marcarSujo(); })),
            rotulo('Só para clientes da unidade', selecao([['', 'Qualquer unidade'], ...Object.entries(UNIDADES)], p.unidade || '', (v) => { if (v) p.unidade = v; else delete p.unidade; marcarSujo(); })));
          break;
        case 'lembrete_ligacao': {
          const t = el('input', { maxlength: '200', value: p.texto || '', placeholder: 'Ex.: Ligar para {primeiro_nome} e oferecer horário', autocomplete: 'off' });
          t.addEventListener('input', () => { p.texto = t.value; marcarSujo(); });
          campos.append(rotulo('Quando ligar (0 = hoje)', duracaoCampo(p.em_minutos || 0, (m) => { p.em_minutos = Math.min(8640, m); marcarSujo(); }, { minimo: 0 })), rotulo('Recado (opcional)', t),
            larga(el('p', { class: 'au-info', text: 'Aparece em CRM › Ligar hoje no dia certo e sai quando alguém registra a ligação. Até 6 dias à frente.' })));
          break;
        }
        case 'enviar_email': {
          const mods = s.base.modelosEmail || [];
          if (!p.modeloId && mods[0]) p.modeloId = mods[0].id;
          campos.append(rotulo('Modelo de e-mail', selecao(mods.length ? mods.map((m) => [m.id, m.nome]) : [['', 'Nenhum modelo salvo']], p.modeloId || '', (v) => { p.modeloId = v; marcarSujo(); })),
            larga(el('p', { class: 'au-info', text: 'Vai para o e-mail da ficha, no ritmo da conta, com descadastro. Quem não tem e-mail ou se descadastrou é pulada. Crie modelos em E-mail marketing › Modelos.' })));
          break;
        }
        case 'condicao': {
          const valorCaixa = el('div');
          const desenharValor = () => {
            if (p.se === 'tem_tag') { if (!p.valor || !s.base.tagsMap.has(p.valor) && !s.base.etapas.has(p.valor)) p.valor = primeiraOpcao(opcoesTags()); valorCaixa.replaceChildren(rotulo('Tag', selecao(opcoesTags(), p.valor, (v) => { p.valor = v; marcarSujo(); }))); }
            else if (p.se === 'modo') { if (!MODOS[p.valor]) p.valor = 'ia'; valorCaixa.replaceChildren(rotulo('Modo', selecao(Object.entries(MODOS), p.valor, (v) => { p.valor = v; marcarSujo(); }))); }
            else { delete p.valor; valorCaixa.replaceChildren(); }
          };
          campos.append(rotulo('Se', selecao(CONDICOES, p.se, (v) => { p.se = v; desenharValor(); marcarSujo(); })), valorCaixa);
          desenharValor();
          if (p.se === 'cliente_respondeu') campos.append(larga(el('p', { class: 'au-info', text: 'Conta se a cliente escreveu depois que esta automação começou. Combine com um “Esperar” antes.' })));
          p.entao = p.entao || []; p.senao = p.senao || [];
          const chaveSim = `${prefixo}${i}s`, chaveNao = `${prefixo}${i}n`;
          campos.append(larga(el('div', { class: 'au-ramo' }, el('b', { text: 'Se sim' }), listaPassos(p.entao, nivel + 1, `${prefixo}${i + 1}.S`), botaoAdicionar(p.entao, chaveSim, nivel + 1))),
            larga(el('div', { class: 'au-ramo nao' }, el('b', { text: 'Se não' }), listaPassos(p.senao, nivel + 1, `${prefixo}${i + 1}.N`), botaoAdicionar(p.senao, chaveNao, nivel + 1))));
          break;
        }
        default: break;
      }
      return el('div', { class: 'au-passo' }, topo, campos);
    }
    function linhaChave(t, info, v, aoMudar) {
      const c = chave(v, aoMudar, t);
      return el('label', { class: 'au-linha-chave' }, el('span', {}, el('b', { text: t, style: 'font-weight:650' }), info ? el('small', { text: info }) : null), c);
    }

    // teste e execuções
    const testeCaixa = el('div', { class: 'au-teste' });
    const execCaixa = el('div', { style: 'display:grid;gap:2px' });
    function desenharTeste() {
      const conversas = (ui.estado.conversas || []).filter((c) => String(c.canalId || '').startsWith('teste-'));
      const resultado = el('div', { style: 'display:grid;gap:8px' });
      if (!conversas.length) {
        testeCaixa.replaceChildren(el('p', { class: 'au-info', text: 'Para testar, crie uma conversa de teste em Conversas (botão +). O teste roda na hora, sem esperar, e não manda nada para clientes de verdade.' }));
        return;
      }
      const sel = selecao(conversas.map((c) => [c.id, `${ui.nomeDe(c)} · ${ui.UNIDADE[c.unidade] || c.unidade}`]), s.ultimaTeste || conversas[0].id, (v) => { s.ultimaTeste = v; }, { 'aria-label': 'Conversa de teste' });
      const botao = el('button', { class: 'au-botao leve', type: 'button', text: ed.id && !ed.sujo ? 'Testar agora' : 'Salvar e testar' });
      botao.addEventListener('click', async () => {
        botao.disabled = true; resultado.replaceChildren(el('p', { class: 'au-info', text: 'Rodando o teste…' }));
        try {
          if (!ed.id || ed.sujo) { const ok = await salvar(false); if (!ok) { resultado.replaceChildren(); return; } }
          const x = await ui.post(`/api/automacoes/${ed.id}/testar`, { conversaId: sel.value });
          resultado.replaceChildren(el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, el('b', { text: 'Resultado:' }), statusSelo(x), x.erro ? el('span', { class: 'au-info', text: x.erro }) : null), logLista(x.log));
          carregarExecucoes();
        } catch (x) { resultado.replaceChildren(el('p', { class: 'au-erro', text: x.message })); }
        finally { botao.disabled = false; botao.textContent = 'Testar agora'; }
      });
      testeCaixa.replaceChildren(
        el('p', { class: 'au-info', text: 'Roda agora numa conversa de teste, mesmo desligada: o “esperar” não espera e nada sai do WhatsApp de teste.' }),
        el('div', { class: 'au-linha' }, rotulo('Conversa de teste', sel), botao), resultado);
    }
    async function carregarExecucoes() {
      if (!ed.id) { execCaixa.replaceChildren(el('p', { class: 'au-info', text: 'Depois de salvar, aqui aparece cada vez que a automação rodar.' })); return; }
      let ex;
      try { ex = await ui.api(`/api/automacoes/${ed.id}/execucoes?limite=20`); } catch (x) { execCaixa.replaceChildren(el('p', { class: 'au-erro', text: x.message })); return; }
      if (!ex.length) { execCaixa.replaceChildren(el('p', { class: 'au-info', text: 'Ainda não rodou.' })); return; }
      execCaixa.replaceChildren(...ex.map((x) => {
        const c = (ui.estado.conversas || []).find((k) => k.id === x.conversaId);
        const ultimo = (x.log || [])[x.log.length - 1];
        const det = el('div', { hidden: '' }, logLista(x.log));
        const b = el('button', { class: 'au-exec', type: 'button', 'aria-expanded': 'false', onclick: () => { det.hidden = !det.hidden; b.setAttribute('aria-expanded', String(!det.hidden)); } },
          el('div', { class: 'au-l1' }, el('b', { text: c ? ui.nomeDe(c) : 'Conversa' }), statusSelo(x), el('small', { text: ui.quando(x.criadaEm) })),
          el('div', { class: 'au-det', text: x.erro || (ultimo ? ultimo.detalhe : '') }), det);
        return b;
      }));
    }

    // salvar e apagar
    const botaoSalvar = el('button', { class: 'au-botao', type: 'button', text: 'Salvar' });
    async function salvar(fechar = true) {
      const msg = validar(ed.draft);
      if (msg) { erro.textContent = msg; erro.scrollIntoView({ block: 'nearest' }); return false; }
      const corpoReq = { nome: ed.draft.nome.trim(), funilId: ed.draft.funilId || null, ligada: !!ed.draft.ligada, gatilho: limparGatilho(ed.draft.gatilho), passos: ed.draft.passos.map(limparPasso), opcoes: { ...ed.draft.opcoes } };
      botaoSalvar.disabled = true;
      try {
        const r = ed.id ? await ui.api(`/api/automacoes/${ed.id}`, { method: 'PATCH', body: JSON.stringify(corpoReq) }) : await ui.post('/api/automacoes', corpoReq);
        const nova = !ed.id;
        ed.id = r.id; ed.sujo = false;
        titulo.textContent = 'Editar automação';
        apagar.hidden = false;
        ui.toast(nova ? (r.ligada ? 'Automação criada e ligada ⚡' : 'Automação criada ✓ (desligada)') : 'Automação salva ✓');
        if (opcoes.aoSalvar) try { opcoes.aoSalvar(r); } catch { /* quem chamou se vira */ }
        if (fechar) d.close(); else carregarExecucoes();
        return true;
      } catch (x) { erro.textContent = x.message; erro.scrollIntoView({ block: 'nearest' }); return false; }
      finally { botaoSalvar.disabled = false; }
    }
    botaoSalvar.addEventListener('click', () => salvar(true));
    const apagar = el('button', { class: 'au-botao perigo', type: 'button', hidden: ed.id ? null : '', onclick: async () => {
      if (!confirm(`Apagar a automação “${ed.draft.nome}”? As execuções pendentes param.`)) return;
      try { await ui.api(`/api/automacoes/${ed.id}`, { method: 'DELETE' }); ui.toast('Automação apagada'); ed.sujo = false; if (opcoes.aoSalvar) opcoes.aoSalvar(null); d.close(); } catch (x) { ui.toast(x.message); }
    } }, el('span', { html: SVG.lixo, style: 'display:grid' }), el('span', { class: 'au-sotexto', text: 'Apagar' }));
    const tentarFechar = () => { if (ed.sujo && !confirm('Sair sem salvar as mudanças?')) return; ed.sujo = false; d.close(); };

    const secao = (n, t, ...filhos) => el('section', { class: 'au-secao' }, el('h3', {}, n ? el('em', { text: n }) : null, el('span', { text: t })), ...filhos);
    corpo.append(
      frase,
      secao('', 'Nome', el('div', { class: 'au-grade' }, rotulo('Nome da automação', nome), rotulo('Funil', funilSel))),
      secao('1', 'Quando', gatilhoCaixa),
      secao('2', 'Então', passosCaixa),
      secao('', 'Opções',
        linhaChave('Ligada', 'Desligada, ela não dispara sozinha (mas dá para testar).', ed.draft.ligada, (v) => { ed.draft.ligada = v; marcarSujo(); }),
        linhaChave('Parar quando a equipe responder', 'Se alguém da loja responder a cliente, as mensagens que faltam não saem.', ed.draft.opcoes.parar_se_equipe_responder, (v) => { ed.draft.opcoes.parar_se_equipe_responder = v; marcarSujo(); }),
        el('p', { class: 'au-info', text: 'Horário da loja: cada “Enviar mensagem” tem a opção de só sair com a loja aberta. Limite diário por cliente: veja na página Automações.' })),
      secao('', 'Testar', testeCaixa),
      secao('', 'Execuções recentes', execCaixa),
    );
    d.append(
      el('div', { class: 'au-ed-topo' }, el('h2', {}, el('span', { class: 'au-raio', html: SVG.raio }), titulo),
        el('button', { class: 'icone', type: 'button', 'aria-label': 'Fechar', title: 'Fechar', html: SVG.fechar, onclick: tentarFechar })),
      corpo,
      el('div', { class: 'au-ed-rodape' }, apagar, el('span', { class: 'au-espaco' }),
        el('button', { class: 'au-botao leve', type: 'button', text: 'Cancelar', onclick: tentarFechar }), botaoSalvar),
    );
    corpo.insertBefore(erro, corpo.children[1]);
    d.addEventListener('cancel', (e) => { e.preventDefault(); tentarFechar(); });
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    desenharGatilho(); desenharPassos(); desenharTeste(); carregarExecucoes();
    d.showModal();
    if (!ed.draft.nome) nome.focus(); else corpo.scrollTop = 0;
    return d;
  }

  window.SintoniaTelas.automacoes = { desenhar, abrirEditor, abrirDaEtapa };
})();
