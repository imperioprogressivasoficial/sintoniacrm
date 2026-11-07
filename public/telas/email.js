/* Tela "email" da Sintonia (E-mail marketing): registra window.SintoniaTelas.email = { desenhar(caixa, ui) }.
 * Campanhas (editor de blocos com prévia celular/PC, público, envio agora/agendado, relatório com funil),
 * Modelos (usados também no passo "enviar e-mail" das automações) e Clientes (histórico e descadastros).
 * Só gestão. Nada é enviado sem confirmação. Estilos em <style id="estilo-email">, prefixo .em-.
 * Também põe o histórico de e-mails na ficha da cliente (bloco "E-mails" em Dados da cliente).
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ABAS = [['campanhas', 'Campanhas'], ['modelos', 'Modelos'], ['clientes', 'Clientes']];
  const CHAVE = 'sintonia.email.aba';
  const ESTADOS = { rascunho: ['Rascunho', 'neutro'], agendada: ['Agendada', 'azul'], enviando: ['Enviando', 'menta'], pausada: ['Pausada', 'ambar'], concluida: ['Concluída', 'ok'], cancelada: ['Cancelada', 'coral'] };
  const ETAPAS_NOME = { novo_lead: 'Novo lead', em_conversa: 'Em conversa', interessada: 'Interessada', agendada: 'Agendada', compareceu: 'Compareceu', manutencao: 'Manutenção', perdida: 'Perdida' };
  const UNIDADES = [['norte', 'Norte Shopping'], ['sumare', 'Sumaré']];
  const BLOCOS = [
    ['titulo', 'Título', 'T'], ['texto', 'Texto', '¶'], ['imagem', 'Imagem', '▣'], ['botao', 'Botão', '⬭'], ['colunas', '2 colunas', '◫'], ['divisor', 'Divisor', '—'], ['espaco', 'Espaço', '↕'],
  ];
  const NOVO = {
    titulo: () => ({ tipo: 'titulo', texto: 'Seu título aqui', tamanho: 'grande', alinhar: 'esquerda' }),
    texto: () => ({ tipo: 'texto', texto: 'Oi, {primeiro_nome}! Escreva aqui.', alinhar: 'esquerda' }),
    imagem: () => ({ tipo: 'imagem', url: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=1200&q=80', alt: 'Foto', largura: 600, arredondar: true, link: '' }),
    botao: () => ({ tipo: 'botao', texto: 'Agendar pelo WhatsApp', url: 'https://wa.me/5571999999999', alinhar: 'centro' }),
    colunas: () => ({ tipo: 'colunas', esquerda: [{ tipo: 'texto', texto: 'Coluna da esquerda', alinhar: 'esquerda' }], direita: [{ tipo: 'texto', texto: 'Coluna da direita', alinhar: 'esquerda' }] }),
    divisor: () => ({ tipo: 'divisor' }),
    espaco: () => ({ tipo: 'espaco', altura: 24 }),
  };
  const TEMA_PADRAO = { fundo: '#EEF4FB', conteudo: '#FFFFFF', texto: '#0B2540', destaque: '#106EBE', botao: '#0FFCBE', textoBotao: '#071D33', logo: '', rodape: 'Império Progressivas · Salvador, Bahia' };
  const VARIAVEIS = ['{primeiro_nome}', '{nome}', '{unidade}', '{email}'];

  const IC = {
    enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7Z"/></svg>',
    olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    clique: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9l11 4-5 2-2 5-4-11Z"/><path d="M4 4l2 2M9 2v3M2 9h3"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    cel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
    pc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    cima: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
    baixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    subir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>',
  };

  const CSS = `
  .em-caixa.em-caixa { grid-template-columns: minmax(0, 1fr); overflow-x: hidden; padding: 14px 16px 0; gap: 0; }
  .em { --acento: var(--marca-menta); display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-bottom: 28px; min-width: 0; max-width: 1240px; width: 100%; margin: 0 auto; }
  @media (max-width: 760px) { .em { padding-bottom: 110px; } }
  .em-vidro, .em-bloco, .em-abas, .em-card, .em-passos { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%); }
  .em-topo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 30px; }
  .em-topo h1.titulo-grande { margin: 0 !important; font-size: 38px; letter-spacing: -.03em; font-family: var(--fonte-titulo); }
  .em-topo h1 small { display: block; font-size: 13.5px; font-weight: 600; color: var(--sub); letter-spacing: 0; margin-top: 2px; font-family: var(--fonte); }
  .em-numeros { display: flex; gap: 22px; overflow-x: auto; scrollbar-width: none; flex: 1 1 auto; min-width: 0; padding: 2px; }
  .em-numeros::-webkit-scrollbar { display: none; }
  @media (max-width: 760px) { .em-topo h1.titulo-grande { font-size: 30px; } .em-numeros { flex-basis: 100%; margin: 0 -16px; padding: 2px 16px; } }
  .em-n { display: flex; align-items: center; gap: 10px; flex: none; }
  .em-circ { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; }
  .em-circ svg { width: 19px; height: 19px; }
  .em-n b { display: block; font-size: 22px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .em-n small { display: block; font-size: 12px; color: var(--sub); white-space: nowrap; }
  .em-abas { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); border-radius: 999px; padding: 4px; gap: 2px; }
  .em-abas button { all: unset; cursor: pointer; text-align: center; padding: 10px 6px; border-radius: 999px; font-size: 14.5px; font-weight: 600; color: var(--sub); border: 1px solid transparent; transition: background .18s, color .18s; min-height: 24px; }
  .em-abas button[aria-selected="true"] { background: var(--vidro-ativo); color: var(--texto); border-color: var(--vidro-borda); box-shadow: 0 2px 10px rgba(0,0,0,.08); font-weight: 700; }
  .em button:focus-visible, .em input:focus-visible, .em select:focus-visible, .em textarea:focus-visible, .em a:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
  .em-bloco { border-radius: 24px; padding: 18px; display: grid; gap: 14px; min-width: 0; }
  .em-bloco h2 { margin: 0; font-size: 15px; font-weight: 700; }
  .em-bloco h2 small { display: block; font-size: 12.5px; color: var(--sub); font-weight: 500; margin-top: 3px; line-height: 1.4; }
  .em-campos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
  .em-campo { display: grid; gap: 5px; font-size: 12px; color: var(--sub); font-weight: 700; min-width: 0; }
  .em-campo.em-largo { grid-column: 1 / -1; }
  .em-campo select, .em-campo input:not([type=checkbox]):not([type=color]):not([type=file]), .em-campo textarea { font: inherit; font-size: 15px; font-weight: 600; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 14px; padding: 10px 12px; min-width: 0; width: 100%; box-sizing: border-box; min-height: 44px; }
  .em-campo textarea { min-height: 90px; resize: vertical; font-weight: 500; line-height: 1.45; }
  .em-campo select option { color: #106ebe; }
  .em-campo input[type=color] { width: 100%; height: 44px; border-radius: 14px; border: 1px solid var(--vidro-borda); background: var(--vidro-item); padding: 4px; box-sizing: border-box; }
  html[data-tema="escuro"] .em input, html[data-tema="escuro"] .em select, html[data-tema="escuro"] .em textarea { color-scheme: dark; }
  .em-botao { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; box-sizing: border-box; background: var(--acento); color: #071d33; font-weight: 800; font-size: 15px; padding: 0 20px; border-radius: 999px; box-shadow: var(--brilho-menta); text-align: center; transition: transform .18s; }
  .em-botao:hover { transform: translateY(-1px); }
  .em-botao svg { width: 18px; height: 18px; flex: none; }
  .em-botao.em-leve { background: var(--vidro-item); color: var(--texto); box-shadow: none; border: 1px solid var(--vidro-borda); font-weight: 700; }
  .em-botao.em-perigo { background: transparent; color: #e5484d; box-shadow: none; border: 1px solid color-mix(in srgb, #e5484d 50%, transparent); font-weight: 700; }
  .em-botao[aria-disabled="true"] { opacity: .5; pointer-events: none; }
  .em-icone { all: unset; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--vidro-item); border: 1px solid var(--vidro-borda); color: var(--texto); flex: none; }
  .em-icone svg { width: 17px; height: 17px; }
  .em-icone[disabled] { opacity: .35; pointer-events: none; }
  .em-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  @media (max-width: 560px) { .em-acoes > .em-botao { flex: 1 1 auto; } }
  .em-nota { font-size: 13px; color: var(--sub); line-height: 1.45; margin: 0; }
  .em-erro { color: #e5484d; font-size: 14px; }
  .em-lista { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
  .em-card { all: unset; box-sizing: border-box; cursor: pointer; border-radius: 22px; padding: 16px; display: grid; gap: 10px; min-width: 0; transition: transform .18s; }
  .em-card:hover { transform: translateY(-1px); }
  .em-card b { font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .em-card .em-linha { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
  .em-card span.em-assunto { color: var(--sub); font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .em-mini { display: flex; gap: 14px; font-size: 12.5px; color: var(--sub); }
  .em-mini b { font-size: 15px; color: var(--texto); display: block; }
  .em-selo { font-size: 11.5px; font-weight: 800; padding: 4px 10px; border-radius: 999px; white-space: nowrap; background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  .em-selo.menta { background: color-mix(in srgb, var(--marca-menta) 30%, transparent); color: var(--texto); }
  .em-selo.azul { background: color-mix(in srgb, #106ebe 22%, transparent); }
  .em-selo.ambar { background: color-mix(in srgb, #f5b800 28%, transparent); }
  .em-selo.ok { background: color-mix(in srgb, #19c3a6 24%, transparent); }
  .em-selo.coral { background: color-mix(in srgb, #ff7a59 26%, transparent); }
  .em-vazio { border-radius: 24px; padding: 30px 20px; display: grid; gap: 8px; justify-items: center; text-align: center; color: var(--sub); }
  .em-vazio b { color: var(--texto); font-size: 17px; }
  .em-cab { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .em-cab h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -.02em; flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--fonte-titulo); }
  .em-passos { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); border-radius: 999px; padding: 4px; gap: 2px; }
  .em-passos button { all: unset; cursor: pointer; text-align: center; padding: 9px 4px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--sub); border: 1px solid transparent; }
  .em-passos button[aria-current="step"] { background: var(--acento); color: #071d33; font-weight: 800; }
  .em-passos button i { font-style: normal; font-size: 11px; opacity: .8; margin-right: 4px; }
  .em-editor { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 1000px) { .em-editor { grid-template-columns: minmax(0, 1fr); } .em-editor[data-ver="editar"] .em-col-previa, .em-editor[data-ver="previa"] .em-col-edicao { display: none !important; } }
  @media (min-width: 1001px) { .em-so-cel { display: none !important; } }
  .em-col-previa { position: sticky; top: 8px; }
  .em-blocos { display: grid; gap: 10px; }
  .em-b { border-radius: 18px; padding: 12px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); display: grid; gap: 10px; min-width: 0; }
  .em-b-topo { display: flex; align-items: center; gap: 8px; }
  .em-b-topo b { flex: 1; font-size: 13.5px; display: flex; align-items: center; gap: 8px; }
  .em-b-topo b i { font-style: normal; width: 26px; height: 26px; border-radius: 8px; display: inline-grid; place-items: center; background: color-mix(in srgb, var(--marca-azul) 16%, transparent); color: var(--marca-azul); font-size: 13px; }
  .em-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  @media (max-width: 560px) { .em-cols { grid-template-columns: minmax(0, 1fr); } }
  .em-cols > div { display: grid; gap: 8px; align-content: start; border: 1px dashed var(--vidro-borda); border-radius: 14px; padding: 8px; }
  .em-add { display: flex; flex-wrap: wrap; gap: 6px; }
  .em-add button { all: unset; cursor: pointer; padding: 8px 12px; border-radius: 999px; font-size: 13px; font-weight: 700; background: var(--vidro-item); border: 1px solid var(--vidro-borda); display: inline-flex; gap: 6px; align-items: center; min-height: 22px; }
  .em-add button i { font-style: normal; color: var(--marca-azul); }
  .em-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .em-chip { all: unset; cursor: pointer; padding: 8px 12px; border-radius: 999px; font-size: 13.5px; font-weight: 600; background: var(--vidro-item); border: 1px solid var(--vidro-borda); display: inline-flex; align-items: center; gap: 6px; min-height: 22px; }
  .em-chip[aria-pressed="true"] { background: var(--acento); color: #071d33; border-color: transparent; font-weight: 800; }
  .em-chip i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .em-chip.em-var { font-family: ui-monospace, Menlo, monospace; font-size: 12.5px; padding: 6px 10px; }
  .em-previa { border-radius: 24px; padding: 12px; display: grid; gap: 10px; justify-items: center; }
  .em-previa .em-acoes { justify-content: center; }
  .em-tela { width: 100%; border-radius: 18px; overflow: hidden; border: 1px solid var(--vidro-borda); background: #eef4fb; transition: max-width .25s; }
  .em-tela.celular { max-width: 390px; border-radius: 34px; border: 8px solid #0b2a47; }
  .em-tela .em-assunto-previa { background: #fff; color: #0b2540; padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #dbe6f1; }
  .em-tela .em-assunto-previa b { display: block; font-size: 14px; }
  .em-tela .em-assunto-previa span { color: #5b6b7c; }
  .em-tela iframe { display: block; width: 100%; height: 640px; border: 0; background: #eef4fb; }
  .em-marcar { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; line-height: 1.35; cursor: pointer; }
  .em-marcar input { width: 20px; height: 20px; accent-color: var(--marca-azul); margin: 0; flex: none; }
  .em-total { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .em-total b { font-size: 40px; font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
  .em-total span { color: var(--sub); font-size: 14px; }
  .em-pessoas { display: grid; }
  .em-pessoa { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 9px 0; border-bottom: 1px solid var(--vidro-linha); font-size: 14px; }
  .em-pessoa:last-child { border-bottom: 0; }
  .em-pessoa b { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .em-pessoa span { color: var(--sub); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .em-funil { display: grid; gap: 10px; }
  .em-degrau { display: grid; grid-template-columns: 120px minmax(0, 1fr) 90px; gap: 10px; align-items: center; font-size: 14px; }
  @media (max-width: 480px) { .em-degrau { grid-template-columns: 92px minmax(0, 1fr) 74px; font-size: 13px; } }
  .em-degrau span:first-child { color: var(--sub); font-weight: 600; }
  .em-barra { height: 30px; border-radius: 10px; background: var(--vidro-item); overflow: hidden; border: 1px solid var(--vidro-borda); }
  .em-barra i { display: block; height: 100%; border-radius: 9px; background: linear-gradient(90deg, #106ebe, #1a8be0); box-shadow: 0 0 18px color-mix(in srgb, #106ebe 40%, transparent); transition: width .4s; min-width: 2px; }
  .em-barra.menta i { background: linear-gradient(90deg, #0fd9a6, #0ffcbe); }
  .em-barra.coral i { background: linear-gradient(90deg, #ff7a59, #ff9a80); }
  .em-degrau b { text-align: right; font-variant-numeric: tabular-nums; }
  .em-degrau b small { display: block; color: var(--sub); font-weight: 600; font-size: 11.5px; }
  .em-progresso { height: 10px; border-radius: 999px; background: var(--vidro-item); overflow: hidden; }
  .em-progresso i { display: block; height: 100%; background: var(--acento); border-radius: 999px; transition: width .4s; }
  .em-arquivo { border: 1.5px dashed var(--vidro-borda); border-radius: 18px; padding: 16px; display: grid; gap: 6px; justify-items: center; text-align: center; cursor: pointer; color: var(--sub); font-size: 14px; background: var(--vidro-item); }
  .em-arquivo b { color: var(--texto); }
  .em-arquivo svg { width: 26px; height: 26px; color: var(--marca-azul); }
  .em-dialogo { border: 1px solid var(--vidro-borda); border-radius: 24px; padding: 20px; background: var(--vidro-forte); color: var(--texto); max-width: 440px; width: calc(100% - 32px); box-shadow: 0 30px 80px rgba(0,0,0,.35); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); }
  .em-dialogo::backdrop { background: rgba(4, 23, 43, .45); }
  .em-dialogo h3 { margin: 0 0 8px; font-size: 19px; font-family: var(--fonte-titulo); }
  .em-modelos-prontos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  .em-pronto { all: unset; cursor: pointer; border-radius: 18px; padding: 14px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); display: grid; gap: 4px; }
  .em-pronto b { font-size: 14.5px; }
  .em-pronto span { font-size: 12.5px; color: var(--sub); line-height: 1.35; }
  .em-ficha h3 { display: flex; align-items: center; gap: 6px; }
  .em-ficha .em-h { display: grid; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--linha); font-size: 14px; }
  .em-ficha .em-h:last-child { border-bottom: 0; }
  .em-ficha .em-h small { color: var(--sub); font-size: 12.5px; }
  .em-ficha .em-h em { font-style: normal; font-size: 12.5px; color: var(--texto); background: color-mix(in srgb, var(--marca-menta) 18%, transparent); border-radius: 10px; padding: 6px 8px; margin-top: 4px; }
  `;

  const s = { aba: lerAba(), caixa: null, ui: null, lista: null, modelos: [], contas: [], tags: [], prontos: [], resumo: null, doc: null, tipoDoc: 'campanha', passo: 'conteudo', previaModo: 'celular', ver: 'editar', contagem: null, relatorio: null, erro: '', salvando: false, hist: null, sup: null, timer: null };
  function lerAba() { try { const v = sessionStorage.getItem(CHAVE); return ABAS.some(([k]) => k === v) ? v : 'campanhas'; } catch { return 'campanhas'; } }
  function estilo() {
    if (document.getElementById('estilo-email')) return;
    const st = document.createElement('style');
    st.id = 'estilo-email';
    st.textContent = CSS;
    document.head.append(st);
  }
  const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
  const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%`.replace('.', ',') : '0%');
  const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }) : '—');
  const copia = (x) => JSON.parse(JSON.stringify(x));
  const el = (...a) => s.ui.el(...a);
  const api = (...a) => s.ui.api(...a);
  const post = (...a) => s.ui.post(...a);
  const put = (url, corpo) => s.ui.api(url, { method: 'PUT', body: JSON.stringify(corpo) });
  const apagar = (url) => s.ui.api(url, { method: 'DELETE' });

  // ------------------------------------------------------------ campos de formulário
  function campo(rotulo, entrada, largo) { return el('label', { class: 'em-campo' + (largo ? ' em-largo' : '') }, rotulo, entrada); }
  function entrada(valor, aoMudar, attrs = {}) {
    const i = el('input', { value: valor ?? '', ...attrs });
    i.addEventListener('input', () => aoMudar(attrs.type === 'number' ? Number(i.value) : i.value));
    return i;
  }
  function areaTexto(valor, aoMudar, attrs = {}) {
    const t = el('textarea', attrs);
    t.value = valor ?? '';
    t.addEventListener('input', () => aoMudar(t.value));
    return t;
  }
  function escolha(valor, opcoes, aoMudar, attrs = {}) {
    const sel = el('select', attrs, ...opcoes.map(([v, t]) => el('option', { value: v, text: t })));
    sel.value = valor ?? '';
    sel.addEventListener('change', () => aoMudar(sel.value));
    return sel;
  }
  function numero(ic, valor, rot) {
    return el('div', { class: 'em-n', role: 'listitem' }, el('span', { class: 'em-circ em-vidro', html: ic, 'aria-hidden': 'true' }), el('div', {}, el('b', { text: valor }), el('small', { text: rot })));
  }
  function botao(texto, acao, classe = '', icone = '') {
    const b = el('button', { type: 'button', class: 'em-botao ' + classe, onclick: acao });
    if (icone) b.insertAdjacentHTML('beforeend', icone);
    b.append(texto);
    return b;
  }
  function icone(svg, rotulo, acao, desligado) {
    const b = el('button', { type: 'button', class: 'em-icone', title: rotulo, 'aria-label': rotulo, html: svg, onclick: acao });
    if (desligado) b.disabled = true;
    return b;
  }
  /** Insere texto no campo onde está o cursor (variáveis). */
  let ultimoCampo = null;
  document.addEventListener('focusin', (e) => { if (e.target.closest?.('.em') && (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.dataset.var))) ultimoCampo = e.target; });
  function inserirVariavel(v) {
    const c = ultimoCampo;
    if (!c || !document.contains(c)) { s.ui.toast('Toque primeiro no texto onde a variável vai entrar.'); return; }
    const ini = c.selectionStart ?? c.value.length, fim = c.selectionEnd ?? c.value.length;
    c.value = c.value.slice(0, ini) + v + c.value.slice(fim);
    c.focus();
    c.setSelectionRange(ini + v.length, ini + v.length);
    c.dispatchEvent(new Event('input'));
  }

  // ------------------------------------------------------------ dados
  async function carregarTudo() {
    const [lista, modelos, contas, tags, resumo, prontos] = await Promise.all([
      api('/api/email/campanhas').catch((e) => { s.erro = e.message; return []; }),
      api('/api/email/modelos').catch(() => []),
      api('/api/email/contas').catch(() => []),
      api('/api/tags').catch(() => []),
      api('/api/email/resumo').catch(() => null),
      api('/api/email/modelos-prontos').catch(() => []),
    ]);
    Object.assign(s, { lista, modelos, contas, tags: Array.isArray(tags) ? tags : [], resumo, prontos });
    desenhar();
  }

  let salvarTimer = null, previaTimer = null;
  function mudou(estrutura) {
    if (estrutura) desenhar();
    clearTimeout(previaTimer);
    previaTimer = setTimeout(atualizarPrevia, 350);
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(salvar, 1200);
  }
  async function salvar() {
    clearTimeout(salvarTimer);
    const d = s.doc;
    if (!d) return;
    if (s.tipoDoc === 'campanha' && !['rascunho', 'agendada'].includes(d.estado)) return;
    s.salvando = true;
    try {
      const corpo = { nome: d.nome || 'Sem nome', assunto: d.assunto, preheader: d.preheader, conteudo: d.conteudo, contaId: d.contaId || null };
      if (s.tipoDoc === 'campanha') corpo.publico = d.publico;
      const r = s.tipoDoc === 'campanha' ? await put(`/api/email/campanhas/${d.id}`, corpo) : await put(`/api/email/modelos/${d.id}`, corpo);
      if (s.tipoDoc === 'campanha') d.estado = r.estado;
      s.erro = '';
    } catch (e) { s.erro = e.message; s.ui.toast(e.message); }
    s.salvando = false;
  }
  async function atualizarPrevia() {
    const f = s.caixa?.querySelector('.em-tela iframe');
    if (!f || !s.doc) return;
    try {
      const r = await post('/api/email/previa', { assunto: s.doc.assunto, preheader: s.doc.preheader, conteudo: s.doc.conteudo });
      f.srcdoc = r.html;
      const a = s.caixa.querySelector('.em-assunto-previa');
      if (a) a.replaceChildren(el('b', { text: r.assunto || '(sem assunto)' }), el('span', { text: s.doc.preheader || '' }));
    } catch (e) { /* conteúdo incompleto: a prévia volta quando ficar válido */ }
  }
  async function contarPublico() {
    if (!s.doc || s.tipoDoc !== 'campanha') return;
    try { s.contagem = await post('/api/email/publico/contar', { publico: s.doc.publico }); } catch (e) { s.contagem = { erro: e.message }; }
    if (s.passo === 'publico' || s.passo === 'envio') desenhar();
  }
  async function abrirCampanha(id) {
    const c = await api(`/api/email/campanhas/${id}`);
    s.doc = c; s.tipoDoc = 'campanha'; s.contagem = null; s.relatorio = null;
    s.passo = ['rascunho', 'agendada'].includes(c.estado) ? 'conteudo' : 'relatorio';
    desenhar();
    atualizarPrevia();
    contarPublico();
    if (s.passo === 'relatorio') carregarRelatorio();
  }
  function abrirModelo(m) {
    s.doc = copia(m); s.tipoDoc = 'modelo'; s.passo = 'conteudo';
    desenhar(); atualizarPrevia();
  }
  async function novaCampanha(pronto) {
    const base = pronto || s.prontos[0];
    try {
      const c = await post('/api/email/campanhas', { nome: base ? `${base.nome} · ${new Date().toLocaleDateString('pt-BR')}` : 'Nova campanha', assunto: base?.assunto || '', preheader: base?.preheader || '', conteudo: base ? copia(base.conteudo) : { tema: TEMA_PADRAO, blocos: [NOVO.titulo(), NOVO.texto(), NOVO.botao()] }, contaId: s.contas.find((x) => x.ativa)?.id || null });
      await abrirCampanha(c.id);
      carregarTudo();
    } catch (e) { s.ui.toast(e.message); }
  }
  async function novoModelo(pronto) {
    const base = pronto || s.prontos[0];
    try {
      const m = await post('/api/email/modelos', { nome: base ? base.nome : 'Novo modelo', assunto: base?.assunto || '', preheader: base?.preheader || '', conteudo: copia(base?.conteudo || { tema: TEMA_PADRAO, blocos: [NOVO.texto()] }) });
      s.modelos.push(m);
      abrirModelo(m);
    } catch (e) { s.ui.toast(e.message); }
  }
  async function carregarRelatorio() {
    if (!s.doc || s.tipoDoc !== 'campanha') return;
    try { s.relatorio = await api(`/api/email/campanhas/${s.doc.id}/relatorio`); s.doc.estado = s.relatorio.campanha.estado; } catch (e) { s.erro = e.message; }
    if (s.passo === 'relatorio') desenhar();
  }
  function fechar() { salvar(); s.doc = null; s.relatorio = null; desenhar(); carregarTudo(); }

  // ------------------------------------------------------------ editor de blocos
  function editorBloco(b, onde, i, simples) {
    const lista = onde;
    const m = () => mudou(false);
    const info = BLOCOS.find(([k]) => k === b.tipo) || [b.tipo, b.tipo, '?'];
    const topo = el('div', { class: 'em-b-topo' }, el('b', {}, el('i', { text: info[2] }), info[1]),
      icone(IC.cima, 'Subir', () => { [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]]; mudou(true); }, i === 0),
      icone(IC.baixo, 'Descer', () => { [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]]; mudou(true); }, i === lista.length - 1),
      icone(IC.lixo, 'Tirar bloco', () => { lista.splice(i, 1); mudou(true); }));
    const alinhar = (padrao) => campo('Alinhar', escolha(b.alinhar || padrao, [['esquerda', 'Esquerda'], ['centro', 'Centro'], ['direita', 'Direita']], (v) => { b.alinhar = v; m(); }));
    const corpo = el('div', { class: 'em-campos' });
    if (b.tipo === 'titulo') corpo.append(campo('Título', entrada(b.texto, (v) => { b.texto = v; m(); }, { maxlength: 300, 'data-var': '1' }), true), campo('Tamanho', escolha(b.tamanho, [['grande', 'Grande'], ['medio', 'Médio'], ['pequeno', 'Pequeno']], (v) => { b.tamanho = v; m(); })), alinhar('esquerda'));
    if (b.tipo === 'texto') corpo.append(campo('Texto (**negrito**, *itálico*, [link](https://...))', areaTexto(b.texto, (v) => { b.texto = v; m(); }, { maxlength: 6000 }), true), alinhar('esquerda'));
    if (b.tipo === 'imagem') corpo.append(campo('Endereço da imagem (https://)', entrada(b.url, (v) => { b.url = v; m(); }, { type: 'url', inputmode: 'url' }), true), campo('Descrição (para quem não vê a imagem)', entrada(b.alt, (v) => { b.alt = v; m(); }, { maxlength: 200 })), campo('Link ao tocar (opcional)', entrada(b.link || '', (v) => { b.link = v; m(); }, { type: 'url', placeholder: 'https://' })));
    if (b.tipo === 'botao') corpo.append(campo('Texto do botão', entrada(b.texto, (v) => { b.texto = v; m(); }, { maxlength: 80 })), campo('Link (https://, wa.me, tel:)', entrada(b.url, (v) => { b.url = v; m(); }, { type: 'url' })), alinhar('centro'));
    if (b.tipo === 'espaco') corpo.append(campo('Altura (px)', entrada(b.altura, (v) => { b.altura = Math.max(4, Math.min(120, v || 24)); m(); }, { type: 'number', min: 4, max: 120 })));
    const caixa = el('div', { class: 'em-b' }, topo);
    if (corpo.children.length) caixa.append(corpo);
    if (b.tipo === 'colunas' && !simples) {
      const lado = (nome, arr) => el('div', {}, el('small', { class: 'em-nota', text: nome }), ...arr.map((x, j) => editorBloco(x, arr, j, true)),
        el('div', { class: 'em-add' }, ...BLOCOS.filter(([k]) => !['colunas'].includes(k)).slice(0, 4).map(([k, t, ic]) => el('button', { type: 'button', onclick: () => { arr.push(NOVO[k]()); mudou(true); } }, el('i', { text: ic }), t))));
      caixa.append(el('div', { class: 'em-cols' }, lado('Esquerda', b.esquerda), lado('Direita', b.direita)));
    }
    return caixa;
  }

  function painelConteudo() {
    const d = s.doc;
    const tema = (d.conteudo.tema = { ...TEMA_PADRAO, ...(d.conteudo.tema || {}) });
    const m = () => mudou(false);
    const contas = [['', s.contas.length ? 'Escolha a conta' : 'Nenhuma conta — configure em Conexões'], ...s.contas.map((c) => [c.id, `${c.nome} · ${c.remetenteEmail}`])];
    const dados = el('div', { class: 'em-bloco' }, el('h2', {}, s.tipoDoc === 'campanha' ? 'Campanha' : 'Modelo', el('small', { text: s.tipoDoc === 'modelo' ? 'Modelos são usados nas automações (passo "Enviar e-mail") e para começar campanhas.' : 'O assunto e a prévia aparecem na caixa de entrada.' })),
      el('div', { class: 'em-campos' },
        campo('Nome (só para você)', entrada(d.nome, (v) => { d.nome = v; m(); }, { maxlength: 120 })),
        campo('Conta remetente', escolha(d.contaId || '', contas, (v) => { d.contaId = v || null; m(); })),
        campo('Assunto', entrada(d.assunto, (v) => { d.assunto = v; m(); }, { maxlength: 200, 'data-var': '1', placeholder: 'Ex.: {primeiro_nome}, seu liso dos sonhos ✨' }), true),
        campo('Texto de pré-visualização (aparece depois do assunto)', entrada(d.preheader, (v) => { d.preheader = v; m(); }, { maxlength: 200, 'data-var': '1' }), true)),
      el('div', { class: 'em-chips', 'aria-label': 'Variáveis' }, el('span', { class: 'em-nota', text: 'Variáveis:' }), ...VARIAVEIS.map((v) => el('button', { type: 'button', class: 'em-chip em-var', onclick: () => inserirVariavel(v), text: v }))));
    const blocos = el('div', { class: 'em-bloco' }, el('h2', {}, 'Conteúdo', el('small', { text: 'Monte o e-mail com blocos. O rodapé com o link de descadastro entra sozinho.' })),
      el('div', { class: 'em-blocos' }, ...d.conteudo.blocos.map((b, i) => editorBloco(b, d.conteudo.blocos, i))),
      el('div', { class: 'em-add', 'aria-label': 'Adicionar bloco' }, ...BLOCOS.map(([k, t, ic]) => el('button', { type: 'button', onclick: () => { d.conteudo.blocos.push(NOVO[k]()); mudou(true); } }, el('i', { text: ic }), t))));
    const cores = el('div', { class: 'em-bloco' }, el('h2', {}, 'Cores e rodapé'),
      el('div', { class: 'em-campos' },
        ...[['destaque', 'Títulos'], ['botao', 'Botões'], ['textoBotao', 'Texto do botão'], ['fundo', 'Fundo'], ['conteudo', 'Cartão'], ['texto', 'Texto']].map(([k, t]) => campo(t, entrada(tema[k], (v) => { tema[k] = v.toUpperCase(); m(); }, { type: 'color' }))),
        campo('Logo (endereço da imagem, opcional)', entrada(tema.logo, (v) => { tema.logo = v; m(); }, { type: 'url', placeholder: 'https://.../logo.png' }), true),
        campo('Rodapé (endereço, contatos)', areaTexto(tema.rodape, (v) => { tema.rodape = v; m(); }, { maxlength: 600, rows: 2 }), true)));
    const prontos = el('div', { class: 'em-bloco' }, el('h2', {}, 'Começar de um modelo pronto', el('small', { text: 'Troca o conteúdo atual pelo modelo escolhido.' })),
      el('div', { class: 'em-modelos-prontos' }, ...[...s.prontos.map((p) => ({ ...p, pronto: true })), ...(s.tipoDoc === 'campanha' ? s.modelos : [])].map((p) => el('button', { type: 'button', class: 'em-pronto', onclick: () => { if (!confirm(`Trocar o conteúdo por "${p.nome}"?`)) return; d.conteudo = copia(p.conteudo); if (p.assunto) d.assunto = p.assunto; if (p.preheader !== undefined) d.preheader = p.preheader; mudou(true); } }, el('b', { text: p.nome }), el('span', { text: p.descricao || (p.pronto ? '' : 'Seu modelo salvo') })))));
    const acoes = el('div', { class: 'em-acoes' },
      ...(s.tipoDoc === 'campanha'
        ? [botao('Enviar teste para mim', enviarTeste, 'em-leve', IC.enviar), botao('Salvar como modelo', salvarComoModelo, 'em-leve'), botao('Próximo: público', () => irPara('publico'))]
        : [botao('Salvar', async () => { await salvar(); s.ui.toast('Modelo salvo ✓'); }), botao('Usar numa campanha', () => novaCampanha({ ...d, nome: d.nome }), 'em-leve'), botao('Apagar modelo', apagarModelo, 'em-perigo', IC.lixo)]));
    const edicao = el('div', { class: 'em-col-edicao', style: 'display:grid;gap:14px;min-width:0' }, dados, blocos, cores, prontos, acoes);
    const tela = el('div', { class: 'em-tela ' + s.previaModo }, el('div', { class: 'em-assunto-previa' }, el('b', { text: d.assunto || '(sem assunto)' }), el('span', { text: d.preheader || '' })), el('iframe', { title: 'Prévia do e-mail', sandbox: '', loading: 'lazy' }));
    const previa = el('div', { class: 'em-col-previa' }, el('div', { class: 'em-previa em-vidro' },
      el('div', { class: 'em-acoes' }, el('button', { type: 'button', class: 'em-chip', 'aria-pressed': String(s.previaModo === 'celular'), onclick: () => { s.previaModo = 'celular'; tela.className = 'em-tela celular'; desenharModo(); }, html: IC.cel + 'Celular' }), el('button', { type: 'button', class: 'em-chip', 'aria-pressed': String(s.previaModo === 'pc'), onclick: () => { s.previaModo = 'pc'; tela.className = 'em-tela pc'; desenharModo(); }, html: IC.pc + 'Computador' })),
      tela));
    const ver = el('div', { class: 'em-abas em-so-cel', role: 'tablist' }, ...[['editar', 'Editar'], ['previa', 'Prévia']].map(([k, t]) => el('button', { role: 'tab', type: 'button', 'aria-selected': String(s.ver === k), onclick: () => { s.ver = k; desenhar(); atualizarPrevia(); } }, t)));
    return [ver, el('div', { class: 'em-editor', 'data-ver': s.ver }, edicao, previa)];
  }
  function desenharModo() { s.caixa.querySelectorAll('.em-previa .em-chip').forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (s.previaModo === 'celular')))); }

  async function enviarTeste() {
    await salvar();
    try { const r = await post(`/api/email/campanhas/${s.doc.id}/teste`, {}); s.ui.toast(`Teste enviado para ${r.para} ✓`); } catch (e) { s.ui.toast(e.message); }
  }
  async function salvarComoModelo() {
    const d = s.doc;
    try { const m = await post('/api/email/modelos', { nome: d.nome, assunto: d.assunto, preheader: d.preheader, conteudo: d.conteudo, contaId: d.contaId || null }); s.modelos.push(m); s.ui.toast('Modelo salvo ✓ (já aparece nas automações)'); } catch (e) { s.ui.toast(e.message); }
  }
  async function apagarModelo() {
    if (!confirm('Apagar este modelo? Automações que usam ele vão parar de enviar.')) return;
    await apagar(`/api/email/modelos/${s.doc.id}`).catch((e) => s.ui.toast(e.message));
    s.modelos = s.modelos.filter((x) => x.id !== s.doc.id);
    fechar();
  }

  // ------------------------------------------------------------ público
  function painelPublico() {
    const p = s.doc.publico;
    const alternar = (lista, v) => { const i = lista.indexOf(v); if (i >= 0) lista.splice(i, 1); else lista.push(v); salvar(); contarPublico(); desenhar(); };
    const chips = (lista, opcoes) => el('div', { class: 'em-chips' }, ...opcoes.map(([v, t, cor]) => el('button', { type: 'button', class: 'em-chip', 'aria-pressed': String(lista.includes(v)), onclick: () => alternar(lista, v) }, cor ? el('i', { style: `background:${cor}` }) : null, t)));
    const tags = s.tags.map((t) => [t.id, t.funilId ? `${t.nome}` : t.nome, t.cor]);
    const ct = s.contagem;
    const resultado = el('div', { class: 'em-bloco' }, el('h2', {}, 'Quem vai receber'),
      ct?.erro ? el('p', { class: 'em-erro', text: ct.erro }) : el('div', { class: 'em-total' }, el('b', { text: ct ? fmtN(ct.total) : '…' }), el('span', { text: ct ? `${ct.total === 1 ? 'pessoa' : 'pessoas'} com e-mail válido${ct.disponiveis > ct.total ? ` (de ${fmtN(ct.disponiveis)} disponíveis)` : ''}` : 'contando…' })),
      el('p', { class: 'em-nota', text: 'Ficam de fora automaticamente: quem se descadastrou, e-mails que deram erro permanente (bounce) e fichas sem e-mail válido.' }),
      ct?.amostra?.length ? el('div', { class: 'em-pessoas' }, ...ct.amostra.map((a) => el('div', { class: 'em-pessoa' }, el('b', { text: a.nome || a.email }), el('span', { text: (UNIDADES.find(([u]) => u === a.unidade) || [, ''])[1] }), el('span', { text: a.email })))) : null);
    const filtros = el('div', { class: 'em-bloco' }, el('h2', {}, 'Filtros', el('small', { text: 'Sem filtro = todas as clientes com e-mail.' })),
      el('div', { class: 'em-campo' }, 'Com qualquer destas tags', tags.length ? chips(p.tags, tags) : el('span', { class: 'em-nota', text: 'Nenhuma tag criada ainda.' })),
      el('div', { class: 'em-campo' }, 'Etapa do atendimento', chips(p.etapas, Object.entries(ETAPAS_NOME))),
      el('div', { class: 'em-campo' }, 'Unidade', chips(p.unidades, UNIDADES)),
      tags.length ? el('div', { class: 'em-campo' }, 'Tirar quem tem estas tags', chips(p.tagsExcluir, tags)) : null,
      el('label', { class: 'em-marcar' }, (() => { const i = el('input', { type: 'checkbox' }); i.checked = p.aniversariantesDoMes; i.addEventListener('change', () => { p.aniversariantesDoMes = i.checked; salvar(); contarPublico(); }); return i; })(), el('span', {}, 'Só aniversariantes do mês', el('small', { class: 'em-nota', style: 'display:block', text: 'Usa a data de nascimento da ficha.' }))),
      el('div', { class: 'em-campos' },
        campo('Quantidade máxima (vazio = todas)', entrada(p.quantidade ?? '', (v) => { p.quantidade = v > 0 ? Math.round(v) : null; clearTimeout(s.timerQ); s.timerQ = setTimeout(() => { salvar(); contarPublico(); }, 500); }, { type: 'number', min: 1, inputmode: 'numeric', placeholder: 'Todas' })),
        campo('Se limitar, quem vai primeiro', escolha(p.ordem, [['recentes', 'Mais recentes'], ['aleatoria', 'Sorteio']], (v) => { p.ordem = v; salvar(); contarPublico(); }))));
    const arq = el('input', { type: 'file', accept: '.csv,text/csv,.txt', hidden: '' });
    arq.addEventListener('change', () => arq.files[0] && importarLista(arq.files[0]));
    const lista = el('div', { class: 'em-bloco' }, el('h2', {}, 'Subir uma lista (CSV)', el('small', { text: 'Colunas: nome, e-mail e telefone (o telefone é obrigatório, como na importação de leads). As pessoas entram no CRM com uma tag nova e a campanha passa a mirar essa tag. Ninguém recebe WhatsApp.' })),
      el('label', { class: 'em-arquivo', tabindex: '0' }, el('span', { html: IC.subir }), el('b', { text: 'Escolher arquivo CSV' }), el('span', { text: 'Exporte do Excel como "CSV UTF-8"' }), arq));
    return [filtros, resultado, lista, el('div', { class: 'em-acoes' }, botao('Voltar ao conteúdo', () => irPara('conteudo'), 'em-leve'), botao('Próximo: envio', () => irPara('envio')))];
  }

  async function importarLista(arquivo) {
    const leads = window.SintoniaTelas?.leads;
    let texto;
    try { const buf = await arquivo.arrayBuffer(); try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { texto = new TextDecoder('windows-1252').decode(buf); } } catch { return s.ui.toast('Não consegui ler o arquivo.'); }
    const linhas = lerCsv(texto);
    if (linhas.length < 2) return s.ui.toast('A primeira linha precisa ter os nomes das colunas.');
    const cab = linhas[0].map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());
    const idx = (re) => cab.findIndex((c) => re.test(c));
    const iNome = idx(/^(nome|name|cliente)/), iEmail = idx(/^(e ?-?mail|email|correio)/), iTel = idx(/^(telefone|tel|fone|celular|whats|phone|numero)/);
    if (iEmail < 0 || iTel < 0) return s.ui.toast('Não achei as colunas de e-mail e telefone.');
    const dados = linhas.slice(1).slice(0, 5000).map((l) => ({ nome: iNome >= 0 ? l[iNome] : null, email: l[iEmail] || null, telefone: l[iTel] || '' }));
    const unidade = s.doc.publico.unidades[0] || (s.ui.estado.eu?.unidades?.[0] === 'sumare' ? 'sumare' : 'norte');
    if (!confirm(`Importar ${fmtN(dados.length)} pessoa(s) para ${unidade === 'sumare' ? 'o Sumaré' : 'o Norte Shopping'} com uma tag nova? Ninguém recebe mensagem no WhatsApp.`)) return;
    try {
      const nomeTag = `Lista ${arquivo.name.replace(/\.[^.]+$/, '')}`.slice(0, 30);
      let tag = s.tags.find((t) => !t.funilId && t.nome.toLowerCase() === nomeTag.toLowerCase());
      if (!tag) { tag = await post('/api/tags', { nome: nomeTag }); s.tags.push(tag); }
      const r = await post('/api/leads/importar', { linhas: dados, unidade, etapa: 'novo_lead', tagId: tag.id, criarConversa: true, dddPadrao: '71' });
      s.doc.publico.tags = [tag.id];
      await salvar();
      s.ui.toast(`Lista importada: ${fmtN(r.criados)} nova(s), ${fmtN(r.atualizados)} atualizada(s), ${fmtN(r.recusados)} recusada(s). Tag "${tag.nome}".`);
      void leads;
      contarPublico();
      desenhar();
    } catch (e) { s.ui.toast(e.message); }
  }
  function lerCsv(texto) {
    const t = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const primeira = t.split('\n').find((l) => l.trim()) || '';
    const conta = (sep) => primeira.split(sep).length;
    const sep = ['\t', ';', ','].sort((a, b) => conta(b) - conta(a))[0];
    const linhas = []; let linha = [], c = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; continue; }
      if (ch === '"' && c === '') q = true; else if (ch === sep) { linha.push(c); c = ''; } else if (ch === '\n') { linha.push(c); linhas.push(linha); linha = []; c = ''; } else c += ch;
    }
    if (c !== '' || linha.length) { linha.push(c); linhas.push(linha); }
    return linhas.map((l) => l.map((x) => x.trim())).filter((l) => l.some((x) => x));
  }

  // ------------------------------------------------------------ envio
  function painelEnvio() {
    const d = s.doc;
    const conta = s.contas.find((c) => c.id === d.contaId);
    const total = s.contagem?.total ?? 0;
    const minutos = conta ? Math.ceil(total / conta.porMinuto) : 0;
    const quandoI = el('input', { type: 'datetime-local' });
    const agendar = el('div', { class: 'em-campos', hidden: '' }, campo('Data e hora (Bahia)', quandoI));
    let modo = 'agora';
    const opcao = (v, t, sub) => { const i = el('input', { type: 'radio', name: 'em-quando', value: v }); if (v === 'agora') i.checked = true; i.addEventListener('change', () => { modo = v; agendar.hidden = v !== 'agendar'; }); return el('label', { class: 'em-marcar' }, i, el('span', {}, t, el('small', { class: 'em-nota', style: 'display:block', text: sub }))); };
    const problemas = [];
    if (!conta) problemas.push('Escolha a conta remetente no passo Conteúdo (configure em Conexões → E-mail).');
    if (!d.assunto?.trim()) problemas.push('Escreva o assunto.');
    if (!d.conteudo.blocos.length) problemas.push('Adicione pelo menos um bloco ao e-mail.');
    if (!total) problemas.push('O público está vazio.');
    return [
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Resumo'),
        el('div', { class: 'em-total' }, el('b', { text: fmtN(total) }), el('span', { text: `destinatários · conta ${conta ? `${conta.nome} (${conta.remetenteEmail})` : '—'}` })),
        conta ? el('p', { class: 'em-nota', text: `Ritmo: até ${conta.porMinuto} e-mails por minuto e ${fmtN(conta.limiteDiario)} por dia (hoje já foram ${fmtN(conta.enviadosHoje || 0)}). ${total ? `Leva cerca de ${minutos < 60 ? `${minutos} min` : `${Math.round(minutos / 6) / 10} h`}${total > conta.limiteDiario ? `, em ${Math.ceil(total / conta.limiteDiario)} dias` : ''}.` : ''} Dá para pausar a qualquer momento.` }) : null,
        ...problemas.map((p) => el('p', { class: 'em-erro', text: '• ' + p }))),
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Quando enviar'), opcao('agora', 'Agora', 'Começa em alguns segundos, no ritmo da conta.'), opcao('agendar', 'Agendar', 'Escolha o dia e a hora. O público é montado na hora de começar.'), agendar),
      el('div', { class: 'em-acoes' }, botao('Voltar ao público', () => irPara('publico'), 'em-leve'), botao('Enviar teste para mim', enviarTeste, 'em-leve', IC.enviar),
        Object.assign(botao('Enviar campanha', () => confirmarEnvio(modo, quandoI.value, total), '', IC.enviar), problemas.length ? { ariaDisabled: 'true' } : {})),
    ];
  }
  function confirmarEnvio(modo, valor, total) {
    let quando = null;
    if (modo === 'agendar') {
      if (!valor) return s.ui.toast('Escolha a data e a hora.');
      quando = new Date(`${valor}:00-03:00`).toISOString();
    }
    const dlg = el('dialog', { class: 'em-dialogo' },
      el('h3', { text: modo === 'agendar' ? 'Agendar campanha?' : 'Enviar agora?' }),
      el('p', { class: 'em-nota', text: `${fmtN(total)} pessoa(s) vão receber "${s.doc.assunto}". ${modo === 'agendar' ? `Começa em ${new Date(quando).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}.` : 'O envio começa já, no ritmo da conta.'}` }),
      el('div', { class: 'em-acoes', style: 'margin-top:16px;justify-content:flex-end' }, botao('Cancelar', () => dlg.close(), 'em-leve'), botao(modo === 'agendar' ? 'Agendar' : 'Enviar', async () => {
        dlg.close();
        try { await salvar(); await post(`/api/email/campanhas/${s.doc.id}/enviar`, { quando }); s.ui.toast(modo === 'agendar' ? 'Campanha agendada ✓' : 'Envio começou ✓'); s.passo = 'relatorio'; await carregarRelatorio(); desenhar(); } catch (e) { s.ui.toast(e.message); }
      }, '', IC.enviar)));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  // ------------------------------------------------------------ relatório
  function painelRelatorio() {
    const r = s.relatorio;
    if (!r) return [el('div', { class: 'em-bloco' }, el('p', { class: 'em-nota', text: 'Carregando…' }))];
    const f = r.funil;
    const est = r.campanha.estado;
    const base = Math.max(f.enviados, 1);
    const degrau = (rot, n, de, classe) => el('div', { class: 'em-degrau' }, el('span', { text: rot }), el('div', { class: 'em-barra ' + (classe || '') }, el('i', { style: `width:${Math.max(0.5, (n / Math.max(de, 1)) * 100)}%` })), el('b', {}, fmtN(n), el('small', { text: pct(n, base) })));
    const feitos = f.total - f.na_fila;
    const acoes = [];
    if (est === 'enviando' || est === 'agendada') acoes.push(botao('Pausar', () => acao('pausar'), 'em-leve'));
    if (est === 'pausada') acoes.push(botao('Retomar', () => acao('retomar')));
    if (['enviando', 'agendada', 'pausada'].includes(est)) acoes.push(botao('Cancelar envio', () => confirm('Cancelar o resto do envio?') && acao('cancelar'), 'em-perigo'));
    acoes.push(botao('Atualizar', () => carregarRelatorio(), 'em-leve'));
    acoes.push(botao('Duplicar', async () => { const c = await post(`/api/email/campanhas/${s.doc.id}/duplicar`, {}); abrirCampanha(c.id); }, 'em-leve'));
    return [
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Andamento', el('small', { text: est === 'agendada' ? `Agendada para ${quando(r.campanha.agendadaPara)}` : `${fmtN(feitos)} de ${fmtN(f.total)} processados${f.na_fila ? ` · ${fmtN(f.na_fila)} na fila` : ''}${r.ritmo ? ` · ritmo ${r.ritmo.porMinuto}/min` : ''}` })),
        el('div', { class: 'em-progresso' }, el('i', { style: `width:${f.total ? (feitos / f.total) * 100 : est === 'concluida' ? 100 : 0}%` })),
        el('div', { class: 'em-acoes' }, ...acoes)),
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Funil da campanha'),
        el('div', { class: 'em-funil' },
          degrau('Enviados', f.enviados, f.total),
          degrau('Abertos', f.abertos, base),
          degrau('Clicados', f.clicados, base, 'menta'),
          degrau('Responderam', f.responderam, base, 'menta'),
          degrau('Descadastros', f.descadastros, base, 'coral'),
          degrau('Erros/bounce', f.bounces + f.erros, base, 'coral')),
        el('p', { class: 'em-nota', text: 'Aberturas dependem das imagens: Apple Mail e alguns aplicativos abrem sozinhos, outros bloqueiam. Use como tendência; cliques e respostas são mais confiáveis.' })),
      r.links.length ? el('div', { class: 'em-bloco' }, el('h2', {}, 'Links mais clicados'), el('div', { class: 'em-pessoas' }, ...r.links.map((l) => el('div', { class: 'em-pessoa' }, el('b', { text: l.url }), el('span', { text: `${fmtN(l.cliques)} clique(s) · ${fmtN(l.pessoas)} pessoa(s)` }))))) : null,
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Destinatários'), r.destinatarios.length ? el('div', { class: 'em-pessoas' }, ...r.destinatarios.map((p) => el('div', { class: 'em-pessoa' }, el('b', { text: p.nome || p.email }), el('span', { text: rotuloEnvio(p) }), el('span', { text: p.email }), el('span', { text: p.erro || '' })))) : el('p', { class: 'em-nota', text: 'Ainda ninguém na fila.' })),
    ];
  }
  function rotuloEnvio(p) {
    if (p.descadastro_em) return 'Descadastrou';
    if (p.respondido_em) return 'Respondeu';
    if (p.clicado_em) return 'Clicou';
    if (p.aberto_em) return 'Abriu';
    return { pendente: 'Na fila', enviando: 'Enviando', enviado: 'Enviado', erro: 'Erro', bounce: 'Bounce', cancelado: 'Cancelado', suprimido: 'Pulado' }[p.estado] || p.estado;
  }
  async function acao(qual) {
    try { await post(`/api/email/campanhas/${s.doc.id}/${qual}`, {}); await carregarRelatorio(); } catch (e) { s.ui.toast(e.message); }
  }

  // ------------------------------------------------------------ abas da lista
  function abaCampanhas() {
    if (!s.lista) return [el('div', { class: 'em-vazio em-vidro' }, el('span', { text: 'Carregando…' }))];
    const semConta = !s.contas.length;
    const aviso = semConta ? el('div', { class: 'em-bloco' }, el('h2', {}, 'Primeiro, conecte uma conta de e-mail', el('small', { text: 'Hostinger, Gmail/Google Workspace ou Outlook. A direção ou a administração faz isso em Conexões → E-mail.' })), el('div', { class: 'em-acoes' }, el('a', { class: 'em-botao em-leve', href: '/conexoes#email', text: 'Abrir Conexões' }))) : null;
    const topo = el('div', { class: 'em-acoes' }, botao('Nova campanha', () => novaCampanha(), '', IC.mais));
    if (!s.lista.length) return [aviso, topo, el('div', { class: 'em-vazio em-vidro' }, el('b', { text: 'Nenhuma campanha ainda' }), el('span', { text: 'Comece por um modelo pronto com a cara da Império: promoção, aniversário ou pós-atendimento.' }), el('div', { class: 'em-modelos-prontos', style: 'width:100%;margin-top:8px' }, ...s.prontos.map((p) => el('button', { type: 'button', class: 'em-pronto', onclick: () => novaCampanha(p) }, el('b', { text: p.nome }), el('span', { text: p.descricao })))))];
    return [aviso, topo, el('div', { class: 'em-lista' }, ...s.lista.map((c) => {
      const [rot, cls] = ESTADOS[c.estado] || [c.estado, ''];
      return el('button', { type: 'button', class: 'em-card', onclick: () => abrirCampanha(c.id) },
        el('div', { class: 'em-linha' }, el('b', { text: c.nome }), el('span', { class: 'em-selo ' + cls, text: rot })),
        el('span', { class: 'em-assunto', text: c.assunto || 'Sem assunto' }),
        el('div', { class: 'em-mini' }, el('div', {}, el('b', { text: fmtN(c.metricas.enviados) }), 'enviados'), el('div', {}, el('b', { text: pct(c.metricas.abertos, c.metricas.enviados) }), 'abertura'), el('div', {}, el('b', { text: pct(c.metricas.clicados, c.metricas.enviados) }), 'cliques')),
        el('span', { class: 'em-nota', text: c.estado === 'agendada' ? `Agendada: ${quando(c.agendadaPara)}` : `Criada ${quando(c.criadaEm)}${c.criadaPor ? ` por ${c.criadaPor}` : ''}` }));
    }))];
  }
  function abaModelos() {
    return [
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Modelos salvos', el('small', { text: 'Usados no passo "Enviar e-mail" das automações (gatilhos: entrou na etapa, tag marcada, aniversário, X dias depois de comparecer) e para começar campanhas.' })),
        s.modelos.length ? el('div', { class: 'em-lista' }, ...s.modelos.map((m) => el('button', { type: 'button', class: 'em-card', onclick: () => abrirModelo(m) }, el('b', { text: m.nome }), el('span', { class: 'em-assunto', text: m.assunto || 'Sem assunto' })))) : el('p', { class: 'em-nota', text: 'Nenhum modelo salvo ainda.' }),
        el('div', { class: 'em-acoes' }, botao('Novo modelo', () => novoModelo(), '', IC.mais), el('button', { type: 'button', class: 'em-botao em-leve', onclick: () => s.ui.mostrar('automacoes'), text: 'Abrir automações' }))),
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Modelos prontos'), el('div', { class: 'em-modelos-prontos' }, ...s.prontos.map((p) => el('button', { type: 'button', class: 'em-pronto', onclick: () => novoModelo(p) }, el('b', { text: p.nome }), el('span', { text: p.descricao }))))),
    ];
  }
  function abaClientes() {
    const busca = el('input', { type: 'email', placeholder: 'email@cliente.com', inputmode: 'email' });
    const ir = async () => { try { s.hist = await api(`/api/email/historico?email=${encodeURIComponent(busca.value.trim())}`); } catch (e) { s.hist = { erro: e.message }; } desenhar(); };
    busca.addEventListener('keydown', (e) => { if (e.key === 'Enter') ir(); });
    if (!s.sup) api('/api/email/supressoes').then((x) => { s.sup = x; desenhar(); }).catch(() => { s.sup = []; });
    const h = s.hist;
    return [
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Histórico de uma cliente', el('small', { text: 'Também aparece na ficha da cliente, dentro da conversa.' })), el('div', { class: 'em-campos' }, campo('E-mail', busca)), el('div', { class: 'em-acoes' }, botao('Buscar', ir, 'em-leve')),
        h?.erro ? el('p', { class: 'em-erro', text: h.erro }) : h ? historicoLista(h) : null),
      el('div', { class: 'em-bloco' }, el('h2', {}, 'Descadastros e bounces', el('small', { text: 'Estes e-mails não recebem campanhas nem automações.' })),
        !s.sup ? el('p', { class: 'em-nota', text: 'Carregando…' }) : s.sup.length ? el('div', { class: 'em-pessoas' }, ...s.sup.map((x) => el('div', { class: 'em-pessoa' }, el('b', { text: x.email }), el('span', { text: { descadastro: 'Descadastrou', bounce: 'Bounce', reclamacao: 'Reclamação', manual: 'Manual' }[x.motivo] || x.motivo }), el('span', { text: x.detalhe || quando(x.em) })))) : el('p', { class: 'em-nota', text: 'Ninguém por enquanto.' })),
    ];
  }
  function historicoLista(h) {
    const envios = h.envios || [];
    return el('div', { class: 'em-pessoas' },
      h.bloqueio ? el('p', { class: 'em-erro', text: h.bloqueio.motivo === 'descadastro' ? 'Esta cliente se descadastrou dos e-mails.' : 'Este e-mail deu erro permanente (bounce).' }) : null,
      ...(envios.length ? envios.map((e) => el('div', { class: 'em-pessoa' }, el('b', { text: e.assunto || e.origem || 'E-mail' }), el('span', { text: rotuloEnvio(e) }), el('span', { text: `${e.tipo === 'campanha' ? 'Campanha' : 'Automação'} ${e.origem || ''} · ${quando(e.enviado_em || e.criado_em)}` }))) : [el('p', { class: 'em-nota', text: 'Nenhum e-mail enviado para esta cliente.' })]));
  }

  // ------------------------------------------------------------ desenho
  function irPara(p) { salvar(); s.passo = p; desenhar(); if (p === 'conteudo') atualizarPrevia(); if (p === 'publico' || p === 'envio') contarPublico(); if (p === 'relatorio') carregarRelatorio(); }
  function trocarAba(k) { s.aba = k; try { sessionStorage.setItem(CHAVE, k); } catch { /* sem armazenamento */ } desenhar(); }

  function desenhar() {
    const { caixa } = s;
    if (!caixa) return;
    const r = s.resumo || {};
    const topo = el('div', { class: 'em-topo' }, el('h1', { class: 'titulo-grande' }, 'E-mail marketing', el('small', { text: 'Campanhas e e-mails automáticos para as clientes da Império.' })),
      el('div', { class: 'em-numeros', role: 'list', 'aria-label': 'Últimos 30 dias' },
        numero(IC.enviar, fmtN(r.enviados30), 'enviados em 30 dias'),
        numero(IC.olho, pct(r.abertos30, r.enviados30), 'abertura'),
        numero(IC.clique, pct(r.clicados30, r.enviados30), 'cliques'),
        numero(IC.email, fmtN(r.contatos_com_email), 'clientes com e-mail'),
        numero(IC.sair, fmtN(r.descadastrados), 'descadastrados')));
    let corpo;
    if (s.doc) {
      const d = s.doc;
      const enviada = s.tipoDoc === 'campanha' && !['rascunho', 'agendada'].includes(d.estado);
      const [rot, cls] = ESTADOS[d.estado] || ['Modelo', 'azul'];
      const passos = s.tipoDoc === 'campanha' ? [['conteudo', 'Conteúdo'], ['publico', 'Público'], ['envio', 'Envio'], ['relatorio', 'Relatório']].filter(([k]) => !enviada || k === 'relatorio' || k === 'conteudo') : [];
      const cab = el('div', { class: 'em-cab' }, icone(IC.voltar, 'Voltar para a lista', fechar), el('h2', { text: d.nome || 'Sem nome' }), el('span', { class: 'em-selo ' + cls, text: s.tipoDoc === 'modelo' ? 'Modelo' : rot }));
      const trilho = passos.length > 1 ? el('nav', { class: 'em-passos', 'aria-label': 'Passos' }, ...passos.map(([k, t], i) => el('button', { type: 'button', 'aria-current': s.passo === k ? 'step' : null, onclick: () => irPara(k) }, el('i', { text: `${i + 1}` }), t))) : null;
      const painel = s.passo === 'publico' ? painelPublico() : s.passo === 'envio' ? painelEnvio() : s.passo === 'relatorio' ? painelRelatorio() : painelConteudo();
      if (enviada && s.passo === 'conteudo') painel.unshift(el('p', { class: 'em-nota', text: 'Campanha já enviada: o conteúdo é só para consulta (duplique para mudar).' }));
      corpo = [cab, trilho, ...painel];
    } else {
      const abas = el('div', { class: 'em-abas', role: 'tablist', 'aria-label': 'E-mail marketing' }, ...ABAS.map(([k, t]) => el('button', { role: 'tab', type: 'button', 'aria-selected': String(k === s.aba), onclick: () => trocarAba(k) }, t)));
      const c = s.aba === 'modelos' ? abaModelos() : s.aba === 'clientes' ? abaClientes() : abaCampanhas();
      corpo = [abas, s.erro ? el('p', { class: 'em-erro', text: s.erro }) : null, ...c];
    }
    const iframeAntigo = caixa.querySelector('.em-tela iframe');
    const html = iframeAntigo?.srcdoc;
    caixa.replaceChildren(el('div', { class: 'em' }, topo, ...corpo.filter(Boolean)));
    const novo = caixa.querySelector('.em-tela iframe');
    if (novo && html) novo.srcdoc = html;
  }

  // Enquanto uma campanha envia, o relatório se atualiza sozinho.
  setInterval(() => {
    if (s.doc && s.tipoDoc === 'campanha' && s.passo === 'relatorio' && ['enviando', 'agendada'].includes(s.doc.estado) && document.getElementById('v-email')?.classList.contains('ativa') && !document.hidden) carregarRelatorio();
  }, 5000);

  // ------------------------------------------------------------ ficha da cliente (conversa)
  function ligarFicha(ui) {
    const ficha = document.getElementById('ficha');
    if (!ficha || ficha.dataset.emailLigado) return;
    ficha.dataset.emailLigado = '1';
    const mostrar = async () => {
      if (ficha.hidden || !ui.estado.eu || !ui.ehGestor(ui.estado.eu)) return;
      const c = ui.estado.detalhe?.conversa || ui.estado.conversas?.find((x) => x.id === ui.estado.aberta);
      if (!c?.telefone) return;
      let bloco = document.getElementById('em-ficha');
      if (!bloco) {
        bloco = ui.el('div', { class: 'bloco em-ficha', id: 'em-ficha' });
        document.getElementById('f-contato')?.after(bloco);
      }
      try {
        const h = await ui.api(`/api/email/historico?telefone=${encodeURIComponent(c.telefone)}`);
        const envios = h.envios || [];
        bloco.replaceChildren(ui.el('h3', { html: IC.email.replace('<svg', '<svg width="16" height="16"') + ' E-mails' }),
          h.bloqueio ? ui.el('p', { class: 'em-erro', style: 'margin:0 0 6px', text: h.bloqueio.motivo === 'descadastro' ? 'Descadastrou dos e-mails.' : 'E-mail com erro permanente (bounce).' }) : null,
          ...(envios.length ? envios.slice(0, 8).map((e) => {
            const resp = (e.eventos || []).filter((x) => x.tipo === 'respondeu').pop();
            return ui.el('div', { class: 'em-h' }, ui.el('b', { text: e.assunto || e.origem || 'E-mail' }), ui.el('small', { text: `${rotuloEnvio(e)} · ${quando(e.enviado_em || e.criado_em)}` }), resp?.detalhe ? ui.el('em', { text: `Resposta: ${resp.detalhe}` }) : null);
          }) : [ui.el('small', { style: 'color:var(--sub)', text: h.email ? 'Nenhum e-mail enviado ainda.' : 'Sem e-mail na ficha.' })]));
      } catch { bloco.remove(); }
    };
    new MutationObserver(() => mostrar()).observe(ficha, { attributes: true, attributeFilter: ['hidden'] });
    document.addEventListener('click', (e) => { if (e.target.closest?.('.item-conversa, [data-conversa]')) setTimeout(mostrar, 600); });
  }

  window.SintoniaTelas.email = {
    async desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa;
      s.ui = ui;
      caixa.classList.add('em-caixa');
      if (ui.estado.eu && !ui.ehGestor(ui.estado.eu)) {
        caixa.replaceChildren(ui.el('div', { class: 'em' }, ui.el('h1', { class: 'titulo-grande', text: 'E-mail marketing' }), ui.el('div', { class: 'em-vazio em-vidro' }, ui.el('b', { text: 'Só para a gestão' }), ui.el('span', { text: 'Campanhas de e-mail ficam com a gerência, a direção e a administração.' }))));
        return;
      }
      desenhar();
      await carregarTudo();
      if (s.doc && s.passo === 'conteudo') atualizarPrevia();
    },
    ligarFicha,
  };
  // A ficha existe desde o começo do app: liga assim que a ferramenta do app estiver pronta.
  const esperar = setInterval(() => { if (window.Sintonia?.ui) { clearInterval(esperar); estilo(); ligarFicha(window.Sintonia.ui); } }, 500);
})();
