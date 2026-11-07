/* Tela "transmissoes" da Sintonia: registra window.SintoniaTelas.transmissoes = { desenhar(caixa, ui) }.
 * Disparo em massa de WhatsApp (só gestão): lista de campanhas, assistente (Público → Mensagem → Envio → Revisar),
 * página da campanha (funil, gráfico e destinatários) e gestor de modelos da Meta (API oficial).
 * Estilos em <style id="estilo-transmissoes">, prefixo .tx-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const PASSOS = ['Público', 'Mensagem', 'Envio', 'Revisar'];
  const STATUS = {
    rascunho: ['Rascunho', 'cinza'], aguardando_modelo: ['Aguardando aprovação do modelo', 'ambar'], agendada: ['Agendada', 'azul'],
    enviando: ['Enviando', 'menta'], pausada: ['Pausada', 'ambar'], concluida: ['Concluída', 'azul'], cancelada: ['Cancelada', 'coral'],
  };
  const STATUS_DEST = {
    fila: ['Na fila', 'cinza'], enviando: ['Enviando', 'azul'], enviada: ['Enviada', 'azul'], entregue: ['Entregue', 'azul'], lida: ['Lida', 'menta'],
    respondeu: ['Respondeu', 'menta'], falhou: ['Falhou', 'coral'], descadastrou: ['Saiu da lista', 'coral'], pulada: ['Pulada', 'cinza'],
  };
  const FONTES = [['primeiro_nome', 'Primeiro nome'], ['nome', 'Nome completo'], ['unidade', 'Unidade'], ['telefone', 'Telefone']];
  const MAX_LINHAS = 5000;

  const IC = {
    mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z"/></svg>',
    olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    resp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/></svg>',
    sair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></svg>',
    subir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    modelo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
    aviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17v.5"/></svg>',
    imagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    check2: '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m1 6.5 3 3L10 2M7.5 9.5 8.5 10.5 16 2"/></svg>',
  };

  const CSS = `
  .tx-caixa.tx-caixa { grid-template-columns: minmax(0, 1fr); overflow-x: hidden; padding: 14px 16px 0; gap: 0; }
  .tx { --acento: var(--marca-menta); display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; padding-bottom: 28px; min-width: 0; max-width: 1080px; width: 100%; margin: 0 auto; }
  @media (max-width: 760px) { .tx { padding-bottom: 120px; } }
  .tx-vidro, .tx-bloco, .tx-card, .tx-segmento, .tx-passos { background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(140%); backdrop-filter: blur(18px) saturate(140%); }
  .tx-topo { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 26px; }
  .tx-topo h1.titulo-grande { margin: 0 !important; font-size: 38px; letter-spacing: -.03em; }
  .tx-topo h1 small { display: block; font-family: var(--fonte); font-size: 13.5px; font-weight: 500; color: var(--sub); letter-spacing: 0; margin-top: 2px; }
  .tx-numeros { display: flex; gap: 22px; overflow-x: auto; scrollbar-width: none; flex: 1 1 auto; min-width: 0; padding: 2px; }
  .tx-numeros::-webkit-scrollbar { display: none; }
  @media (max-width: 760px) { .tx-numeros { flex-basis: 100%; margin: 0 -16px; padding: 2px 16px; } .tx-topo h1.titulo-grande { font-size: 32px; } }
  .tx-n { display: flex; align-items: center; gap: 10px; flex: none; }
  .tx-circ { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; box-sizing: border-box; color: var(--texto); }
  .tx-circ svg { width: 19px; height: 19px; }
  .tx-n b { display: block; font-size: 22px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .tx-n small { display: block; font-size: 12px; color: var(--sub); white-space: nowrap; }
  .tx-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .tx-botao { all: unset; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; box-sizing: border-box; background: var(--marca-menta); color: #071d33; font-weight: 800; font-size: 15px; padding: 0 20px; border-radius: 999px; box-shadow: var(--brilho-menta); text-align: center; transition: transform .18s; }
  .tx-botao:hover { transform: translateY(-1px); }
  .tx-botao svg { width: 18px; height: 18px; flex: none; }
  .tx-botao.leve { background: var(--vidro-item); color: var(--texto); box-shadow: none; border: 1px solid var(--vidro-borda); font-weight: 700; }
  .tx-botao.perigo { background: transparent; color: #e5484d; border: 1.5px solid color-mix(in srgb, #e5484d 60%, transparent); box-shadow: none; font-weight: 700; }
  .tx-botao.pequeno { min-height: 36px; padding: 0 14px; font-size: 13.5px; }
  .tx-botao[aria-disabled="true"] { opacity: .5; pointer-events: none; }
  .tx-botao:focus-visible, .tx-chip:focus-visible, .tx-seg button:focus-visible, .tx-card:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  @media (max-width: 560px) { .tx-acoes.cheio .tx-botao { flex: 1 1 100%; } }
  .tx-bloco { border-radius: 24px; padding: 18px; display: grid; gap: 14px; min-width: 0; }
  .tx-bloco h2 { margin: 0; font-size: 16px; font-weight: 700; }
  .tx-bloco h2 small { display: block; font-family: var(--fonte); font-size: 12.5px; color: var(--sub); font-weight: 500; margin-top: 3px; line-height: 1.4; letter-spacing: 0; }
  .tx-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 980px) { .tx-grade.duas { grid-template-columns: minmax(0, 1.25fr) minmax(320px, .9fr); align-items: start; } .tx-grade.duas > .tx-lado { position: sticky; top: 8px; } }
  .tx-campos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  .tx-campo { display: grid; gap: 5px; font-size: 12px; color: var(--sub); font-weight: 700; min-width: 0; }
  .tx-campo select, .tx-campo input:not([type=checkbox]):not([type=radio]), .tx-campo textarea { font: inherit; font-size: 15px; font-weight: 600; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 14px; padding: 11px 12px; min-width: 0; width: 100%; box-sizing: border-box; min-height: 44px; }
  .tx-campo textarea { min-height: 130px; resize: vertical; font-weight: 500; line-height: 1.45; }
  .tx-campo textarea.mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  .tx-campo select option { color: #106ebe; }
  html[data-tema="escuro"] .tx input, html[data-tema="escuro"] .tx select, html[data-tema="escuro"] .tx textarea { color-scheme: dark; }
  .tx-marcar { display: flex; gap: 10px; align-items: flex-start; font-size: 14.5px; line-height: 1.35; cursor: pointer; }
  .tx-marcar input { width: 20px; height: 20px; accent-color: var(--marca-azul); margin: 0; flex: none; }
  .tx-marcar small { display: block; color: var(--sub); font-size: 12.5px; }
  .tx-inline { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tx-inline input { width: 74px !important; min-height: 38px !important; padding: 6px 8px !important; text-align: center; }
  .tx-seg { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); border-radius: 999px; padding: 4px; gap: 2px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  .tx-seg button { all: unset; cursor: pointer; text-align: center; padding: 10px 8px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); border: 1px solid transparent; line-height: 1.2; }
  .tx-seg button small { display: block; font-size: 11.5px; font-weight: 500; }
  .tx-seg button[aria-pressed="true"] { background: var(--vidro-ativo); color: var(--texto); border-color: var(--vidro-borda); box-shadow: 0 2px 10px rgba(0, 0, 0, .08); font-weight: 700; }
  .tx-seg button[aria-disabled="true"] { opacity: .45; pointer-events: none; }
  .tx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .tx-chip { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; min-height: 22px; border-radius: 999px; font-size: 13.5px; font-weight: 600; background: var(--vidro-item); border: 1px solid var(--vidro-borda); color: var(--texto); }
  .tx-chip i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .tx-chip[aria-pressed="true"] { background: var(--marca-azul); border-color: var(--marca-azul); color: #fff; }
  .tx-chip.fora[aria-pressed="true"] { background: #e5484d; border-color: #e5484d; }
  .tx-chip small { font-weight: 500; opacity: .8; }
  .tx-passos { display: flex; border-radius: 999px; padding: 4px; gap: 2px; overflow-x: auto; scrollbar-width: none; }
  .tx-passos button { all: unset; cursor: pointer; flex: 1 0 auto; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 14px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); white-space: nowrap; }
  .tx-passos button b { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  .tx-passos button[aria-current="step"] { background: var(--vidro-ativo); color: var(--texto); font-weight: 700; box-shadow: 0 2px 10px rgba(0, 0, 0, .08); }
  .tx-passos button[aria-current="step"] b, .tx-passos button.feito b { background: var(--marca-menta); color: #071d33; border-color: transparent; }
  @media (max-width: 560px) { .tx-passos button:not([aria-current]) span { display: none; } .tx-passos button { flex: 0 0 auto; } .tx-passos button[aria-current] { flex: 1 0 auto; } }
  .tx-nota { font-size: 13px; color: var(--sub); line-height: 1.45; }
  .tx-erro { color: #e5484d; font-size: 14px; font-weight: 600; }
  .tx-alerta { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: start; padding: 12px 14px; border-radius: 18px; font-size: 13.5px; line-height: 1.45; background: color-mix(in srgb, #f5b800 16%, transparent); border: 1px solid color-mix(in srgb, #f5b800 45%, transparent); }
  .tx-alerta svg { width: 20px; height: 20px; color: #b88400; margin-top: 1px; }
  .tx-alerta.coral { background: color-mix(in srgb, #ff7a59 14%, transparent); border-color: color-mix(in srgb, #ff7a59 45%, transparent); }
  .tx-alerta.coral svg { color: #e5484d; }
  .tx-alerta b { display: block; font-size: 14px; margin-bottom: 2px; }
  .tx-pilula { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .tx-pilula::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .tx-pilula.cinza { background: var(--vidro-item); color: var(--sub); border: 1px solid var(--vidro-borda); }
  .tx-pilula.azul { background: color-mix(in srgb, #106ebe 14%, transparent); color: #106ebe; }
  .tx-pilula.menta { background: color-mix(in srgb, #0ffcbe 22%, transparent); color: #087a5c; }
  .tx-pilula.ambar { background: color-mix(in srgb, #f5b800 20%, transparent); color: #8a6400; }
  .tx-pilula.coral { background: color-mix(in srgb, #ff7a59 18%, transparent); color: #c4361b; }
  html[data-tema="escuro"] .tx-pilula.azul { color: #7cc4ff; } html[data-tema="escuro"] .tx-pilula.menta { color: #0ffcbe; } html[data-tema="escuro"] .tx-pilula.ambar { color: #f5c842; } html[data-tema="escuro"] .tx-pilula.coral { color: #ff9b80; }
  .tx-lista { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  @media (max-width: 560px) { .tx-lista { grid-template-columns: minmax(0, 1fr); } }
  .tx-card { all: unset; box-sizing: border-box; cursor: pointer; border-radius: 22px; padding: 16px; display: grid; gap: 10px; min-width: 0; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); transition: transform .18s; }
  .tx-card:hover { transform: translateY(-1px); }
  .tx-card-topo { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
  .tx-card h3 { margin: 0; font-size: 16.5px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tx-card .tx-sub { font-size: 12.5px; color: var(--sub); margin-top: 2px; }
  .tx-barra { height: 10px; border-radius: 999px; background: var(--vidro-item); overflow: hidden; display: flex; border: 1px solid var(--vidro-linha); }
  .tx-barra i { display: block; height: 100%; }
  .tx-mini { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); }
  .tx-mini b { color: var(--texto); font-size: 14px; font-variant-numeric: tabular-nums; }
  .tx-vazio { border-radius: 24px; padding: 30px 20px; display: grid; gap: 10px; justify-items: center; text-align: center; color: var(--sub); font-size: 14.5px; line-height: 1.45; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); }
  .tx-vazio b { color: var(--texto); font-size: 17px; }
  .tx-vazio svg { width: 34px; height: 34px; color: var(--marca-azul); }
  .tx-previa-num { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .tx-previa-num b { font-size: 42px; font-weight: 800; letter-spacing: -.03em; font-variant-numeric: tabular-nums; line-height: 1; }
  .tx-previa-num span { color: var(--sub); font-size: 14px; }
  .tx-linhas { display: grid; }
  .tx-linha { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 10px; padding: 9px 0; border-bottom: 1px solid var(--vidro-linha); font-size: 14px; align-items: center; }
  .tx-linha:last-child { border-bottom: 0; }
  .tx-linha b { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tx-linha span { color: var(--sub); font-size: 12.5px; }
  .tx-arquivo { border: 1.5px dashed var(--vidro-borda); border-radius: 18px; padding: 18px; display: grid; gap: 6px; justify-items: center; text-align: center; cursor: pointer; color: var(--sub); font-size: 14px; background: var(--vidro-item); }
  .tx-arquivo b { color: var(--texto); }
  .tx-arquivo svg { width: 28px; height: 28px; color: var(--marca-azul); }
  details.tx-dobra > summary { cursor: pointer; list-style: none; font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 8px; min-height: 30px; }
  details.tx-dobra > summary::-webkit-details-marker { display: none; }
  details.tx-dobra > summary::after { content: "▾"; margin-left: auto; color: var(--sub); transition: transform .2s; }
  details.tx-dobra[open] > summary::after { transform: rotate(180deg); }
  details.tx-dobra > div { display: grid; gap: 12px; margin-top: 12px; }
  /* Prévia no formato do WhatsApp */
  .tx-zap { border-radius: 22px; padding: 16px 14px 18px; background: #e7ddd3; background-image: radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px); background-size: 14px 14px; display: grid; gap: 6px; min-height: 120px; align-content: start; }
  html[data-tema="escuro"] .tx-zap { background-color: #0b141a; background-image: radial-gradient(rgba(255,255,255,.04) 1px, transparent 1px); }
  .tx-zap-topo { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #54656f; margin-bottom: 4px; }
  html[data-tema="escuro"] .tx-zap-topo { color: #8696a0; }
  .tx-balao { position: relative; max-width: 88%; justify-self: start; background: #fff; color: #111b21; border-radius: 0 12px 12px 12px; padding: 7px 9px 6px; font-size: 14.2px; line-height: 1.4; box-shadow: 0 1px .5px rgba(11, 20, 26, .13); white-space: pre-wrap; word-wrap: break-word; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  .tx-balao::before { content: ""; position: absolute; left: -7px; top: 0; border: 7px solid transparent; border-top-color: #fff; border-right-color: #fff; border-width: 0 8px 10px 0; }
  html[data-tema="escuro"] .tx-balao { background: #202c33; color: #e9edef; }
  html[data-tema="escuro"] .tx-balao::before { border-top-color: #202c33; border-right-color: #202c33; }
  .tx-balao img { display: block; width: 100%; max-height: 260px; object-fit: cover; border-radius: 8px; margin: -2px 0 6px; }
  .tx-balao .cab { font-weight: 700; margin-bottom: 4px; }
  .tx-balao .rod { color: #667781; font-size: 12.5px; margin-top: 4px; }
  .tx-balao .hora { float: right; margin: 6px 0 -4px 10px; font-size: 11px; color: #667781; display: inline-flex; gap: 3px; align-items: center; }
  .tx-balao .hora svg { width: 16px; height: 11px; color: #53bdeb; }
  .tx-botoes-zap { display: grid; gap: 4px; max-width: 88%; justify-self: start; width: 100%; }
  .tx-botoes-zap span { background: #fff; color: #027eb5; text-align: center; padding: 9px; border-radius: 10px; font-size: 14px; font-weight: 600; box-shadow: 0 1px .5px rgba(11, 20, 26, .13); font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  html[data-tema="escuro"] .tx-botoes-zap span { background: #202c33; color: #53bdeb; }
  .tx-vars { display: grid; gap: 8px; }
  .tx-var { display: grid; grid-template-columns: 52px minmax(0, 1fr) minmax(0, .8fr); gap: 8px; align-items: center; }
  .tx-var > b { font-family: ui-monospace, Menlo, monospace; font-size: 13px; text-align: center; background: var(--vidro-item); border-radius: 10px; padding: 8px 0; border: 1px solid var(--vidro-borda); }
  @media (max-width: 480px) { .tx-var { grid-template-columns: 46px minmax(0, 1fr); } .tx-var > :last-child { grid-column: 2; } }
  /* Funil da campanha */
  .tx-funil { display: grid; gap: 10px; }
  .tx-etapa { display: grid; grid-template-columns: 120px minmax(0, 1fr) 92px; gap: 10px; align-items: center; font-size: 14px; }
  .tx-etapa > span { color: var(--sub); font-weight: 600; }
  .tx-etapa > b { text-align: right; font-variant-numeric: tabular-nums; font-size: 15px; }
  .tx-etapa > b small { display: block; font-size: 11.5px; color: var(--sub); font-weight: 600; }
  .tx-etapa .tx-trilho { height: 30px; border-radius: 12px; background: var(--vidro-item); border: 1px solid var(--vidro-linha); overflow: hidden; }
  .tx-etapa .tx-trilho i { display: block; height: 100%; border-radius: 11px; transition: width .5s cubic-bezier(.2, .8, .2, 1); min-width: 4px; }
  @media (max-width: 480px) { .tx-etapa { grid-template-columns: 92px minmax(0, 1fr) 70px; font-size: 13px; } }
  .tx-grafico svg { width: 100%; height: 190px; display: block; overflow: visible; }
  .tx-grafico .leg { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); }
  .tx-grafico .leg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  .tx-filtros { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
  .tx-filtros .tx-chip { flex: none; }
  .tx-dest { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 11px 0; border-bottom: 1px solid var(--vidro-linha); align-items: center; }
  .tx-dest:last-child { border-bottom: 0; }
  .tx-dest b { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
  .tx-dest small { color: var(--sub); font-size: 12.5px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tx-dest .dir { display: grid; justify-items: end; gap: 4px; }
  .tx-link { all: unset; cursor: pointer; color: var(--marca-azul); font-weight: 700; font-size: 12.5px; }
  html[data-tema="escuro"] .tx-link { color: #7cc4ff; }
  .tx-cab-camp { display: grid; gap: 10px; }
  .tx-cab-camp .linha1 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .tx-cab-camp h1.titulo-grande { margin: 0 !important; font-size: 32px; overflow-wrap: anywhere; }
  .tx-redondo { all: unset; cursor: pointer; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; background: var(--vidro-item); border: 1px solid var(--vidro-borda); flex: none; }
  .tx-redondo svg { width: 20px; height: 20px; }
  .tx-modelo { display: grid; gap: 8px; padding: 14px; border-radius: 18px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); }
  .tx-modelo .t { display: flex; gap: 8px; justify-content: space-between; align-items: center; flex-wrap: wrap; }
  .tx-modelo .t b { font-family: ui-monospace, Menlo, monospace; font-size: 13.5px; overflow-wrap: anywhere; }
  .tx-modelo p { margin: 0; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; color: var(--texto); }
  .tx-resumo { display: grid; gap: 0; }
  .tx-resumo > div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--vidro-linha); font-size: 14px; }
  .tx-resumo > div:last-child { border-bottom: 0; }
  .tx-resumo span { color: var(--sub); font-weight: 600; }
  @media (max-width: 480px) { .tx-resumo > div { grid-template-columns: minmax(0, 1fr); gap: 2px; } }
  @media (prefers-reduced-motion: reduce) { .tx-card, .tx-botao, .tx-etapa .tx-trilho i { transition: none; } }
  `;

  const s = {
    caixa: null, ui: null, vista: 'lista', carregado: false, erro: '',
    lista: [], numeros: [], limites: null, descadastrados: 0, tags: [], funis: [], campos: [],
    rasc: null, passo: 0, previa: null, previaErro: '', imp: null, modelos: [], modelosUnidade: 'norte', modelosErro: '',
    atual: null, dest: null, destFiltro: '', destBusca: '', semente: 1, novoModelo: null, timer: null, timerPrevia: null, ocupado: false,
  };

  // ---------- utilidades ----------
  const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const fmtTel = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length === 13 ? `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : d.length === 12 ? `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}` : t; };
  const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }) : '');
  const hm = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const nomeUnidade = (u) => s.numeros.find((n) => n.unidade === u)?.nome || (u === 'sumare' ? 'Shopping Sumaré' : 'Salvador Norte Shopping');
  const el = (...a) => s.ui.el(...a);
  const botao = (texto, acao, classe = '', icone = '', attrs = {}) => { const b = el('button', { type: 'button', class: `tx-botao ${classe}`, onclick: acao, ...attrs }); if (icone) b.insertAdjacentHTML('beforeend', icone); b.append(el('span', { text: texto })); return b; };
  const pilula = (mapa, k) => { const [t, c] = mapa[k] || [k, 'cinza']; return el('span', { class: `tx-pilula ${c}`, text: t }); };
  const campo = (rotulo, controle, extra) => el('label', { class: 'tx-campo' }, rotulo, controle, extra || null);
  const select = (valor, opcoes, onchange, attrs = {}) => { const sel = el('select', { onchange: (e) => onchange(e.target.value), ...attrs }); for (const [v, t] of opcoes) { const o = el('option', { value: v, text: t }); if (String(v) === String(valor ?? '')) o.selected = true; sel.append(o); } return sel; };
  const numeroInput = (valor, min, max, onchange, attrs = {}) => el('input', { type: 'number', inputmode: 'numeric', min: String(min), max: String(max), value: String(valor ?? ''), onchange: (e) => onchange(Math.max(min, Math.min(max, Number(e.target.value) || min))), ...attrs });
  const toast = (t) => s.ui.toast(t);
  function estilo() { if (document.getElementById('estilo-transmissoes')) return; const st = document.createElement('style'); st.id = 'estilo-transmissoes'; st.textContent = CSS; document.head.append(st); }
  function numeroTopo(ic, valor, rot) { return el('div', { class: 'tx-n', role: 'listitem' }, el('span', { class: 'tx-circ tx-vidro', html: ic, 'aria-hidden': 'true' }), el('div', {}, el('b', { text: valor }), el('small', { text: rot }))); }

  // ---------- texto da mensagem (igual ao servidor: src/transmissoes/texto.ts) ----------
  function sorteio(semente) { let h = 2166136261 ^ semente; return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
  function variar(t, r) { for (let i = 0; i < 20; i++) { const n = t.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, g) => { const o = g.split('|'); return o[Math.floor(r() * o.length)] ?? ''; }); if (n === t) break; t = n; } return t; }
  function pessoaExemplo() {
    const a = s.previa?.amostra?.[0];
    return { nome: a?.nome || 'Maria Souza', telefone: a?.telefone || '5571988887777', unidade: nomeUnidade(s.rasc?.unidade) };
  }
  function valorFonte(f, p) {
    const prim = (p.nome || '').trim().split(/\s+/)[0] || '';
    if (f === 'primeiro_nome') return prim ? prim[0].toUpperCase() + prim.slice(1).toLowerCase() : '';
    if (f === 'nome') return p.nome || '';
    if (f === 'unidade') return p.unidade;
    if (f === 'telefone') return p.telefone;
    if (f.startsWith('fixo:')) return f.slice(5);
    if (f.startsWith('campo:')) return `[${f.slice(6)}]`;
    return '';
  }
  function montarTexto(t, p, r) { return variar(t.replace(/\{(primeiro_nome|nome|unidade|telefone|campo:[^{}|]+)\}/g, (_, f) => valorFonte(f, p)), r).replace(/[ \t]+([,.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim(); }
  const contarVars = (corpo) => new Set([...String(corpo || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((x) => x[1])).size;
  const preencherModelo = (corpo, params) => String(corpo || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`);

  /** Balão do WhatsApp: como a cliente vê. */
  function balao({ texto, imagem, cabecalho, rodape, botoes }) {
    const b = el('div', { class: 'tx-balao' });
    if (imagem) b.append(el('img', { src: imagem, alt: '' }));
    if (cabecalho) b.append(el('div', { class: 'cab', text: cabecalho }));
    b.append(document.createTextNode(texto || ' '));
    if (rodape) b.append(el('div', { class: 'rod', text: rodape }));
    b.append(el('span', { class: 'hora', html: `${hm()} ${IC.check2}` }));
    const zap = el('div', { class: 'tx-zap', 'aria-label': 'Prévia no WhatsApp' }, el('div', { class: 'tx-zap-topo', html: `${IC.olho}<span>Prévia: como a cliente vê</span>` }), b);
    zap.querySelector('.tx-zap-topo svg').setAttribute('style', 'width:15px;height:15px');
    if (botoes?.length) zap.append(el('div', { class: 'tx-botoes-zap' }, ...botoes.map((x) => el('span', { text: x }))));
    return zap;
  }
  function previaMensagem(r = s.rasc) {
    const p = pessoaExemplo();
    const img = r._imagemUrl || (r.temImagem && r.id ? `/api/transmissoes/${r.id}/imagem?v=${encodeURIComponent(r.atualizadaEm || '')}` : null);
    if (r.canal === 'oficial') {
      const m = r.mensagem.modelo;
      if (!m) return balao({ texto: 'Escolha um modelo aprovado para ver a prévia.' });
      const local = s.modelos.find((x) => x.nome === m.nome && x.idioma === m.idioma);
      const params = (r.mensagem.variaveis || []).map((v) => valorFonte(v.fonte, p).trim() || v.padrao || '-');
      return balao({
        texto: preencherModelo(m.corpo, params), imagem: m.cabecalho === 'IMAGE' ? img : null,
        cabecalho: local?.cabecalho?.formato === 'TEXT' ? local.cabecalho.texto : null, rodape: local?.rodape,
        botoes: (local?.botoes || []).map((x) => x.text || x.texto),
      });
    }
    return balao({ texto: montarTexto(r.mensagem.texto || '', p, sorteio(s.semente)) || 'Escreva a mensagem para ver a prévia.', imagem: img });
  }

  // ---------- dados ----------
  async function carregarLista() {
    try {
      const r = await s.ui.api('/api/transmissoes');
      s.lista = r.campanhas || []; s.numeros = r.numeros || []; s.limites = r.limites; s.descadastrados = r.descadastrados || 0; s.erro = '';
    } catch (e) { s.erro = e.message; }
    s.carregado = true;
  }
  async function carregarApoio() {
    const [tags, funis, campos] = await Promise.all([s.ui.api('/api/tags').catch(() => []), s.ui.api('/api/funis').catch(() => []), s.ui.api('/api/campos-contato').catch(() => [])]);
    s.tags = Array.isArray(tags) ? tags : []; s.funis = Array.isArray(funis) ? funis : []; s.campos = Array.isArray(campos) ? campos : [];
  }
  async function carregarModelos(unidade, sincronizar) {
    try { s.modelos = await s.ui.api(`/api/transmissoes/modelos?unidade=${unidade}${sincronizar ? '&sincronizar=1' : ''}`); s.modelosErro = ''; } catch (e) { s.modelosErro = e.message; s.modelos = []; }
  }
  function tagsSoltas() { return s.tags.filter((t) => !t.funilId); }
  function etapasFunis() { return s.funis.flatMap((f) => (f.etapas || []).map((e) => ({ id: e.id, nome: `${f.nome} › ${e.nome}`, cor: e.cor }))); }

  function pararTimer() { clearInterval(s.timer); s.timer = null; }
  function ir(vista) { pararTimer(); s.vista = vista; desenhar(); s.caixa.scrollTop = 0; }

  // ---------- lista ----------
  function vistaLista() {
    const somas = s.lista.reduce((a, c) => { a.env += c.contagem.funil.enviadas; a.resp += c.contagem.funil.responderam; a.lid += c.contagem.funil.lidas; return a; }, { env: 0, resp: 0, lid: 0 });
    const ativas = s.lista.filter((c) => ['enviando', 'agendada', 'aguardando_modelo'].includes(c.status)).length;
    const topo = el('div', { class: 'tx-topo' },
      el('h1', { class: 'titulo-grande' }, 'Transmissões', el('small', { text: 'Disparo em massa no WhatsApp, com ritmo seguro e o funil de cada pessoa.' })),
      el('div', { class: 'tx-numeros', role: 'list', 'aria-label': 'Resumo' },
        numeroTopo(IC.mega, fmtN(ativas), ativas === 1 ? 'campanha ativa' : 'campanhas ativas'),
        numeroTopo(IC.enviar, fmtN(somas.env), 'mensagens enviadas'),
        numeroTopo(IC.resp, `${pct(somas.resp, somas.env)}%`, `responderam (${fmtN(somas.resp)})`),
        numeroTopo(IC.sair, fmtN(s.descadastrados), 'pediram para sair')));
    const acoes = el('div', { class: 'tx-acoes cheio' }, botao('Nova transmissão', novaCampanha, '', IC.mais), botao('Modelos da Meta', abrirModelos, 'leve', IC.modelo));
    const partes = [topo, acoes];
    if (s.erro) partes.push(el('div', { class: 'tx-erro', text: s.erro }));
    if (!s.carregado) partes.push(el('div', { class: 'tx-vazio' }, el('span', { text: 'Carregando…' })));
    else if (!s.lista.length) partes.push(el('div', { class: 'tx-vazio', html: IC.mega }, el('b', { text: 'Nenhuma transmissão ainda' }), el('span', { text: 'Suba uma lista ou escolha uma tag, escreva a mensagem e a Sintonia envia no ritmo certo para não bloquear o número.' }), botao('Criar a primeira', novaCampanha, '', IC.mais)));
    else partes.push(el('div', { class: 'tx-lista' }, ...s.lista.map(cartao)));
    return partes;
  }
  function cartao(c) {
    const f = c.contagem.funil, tot = c.contagem.total || 1;
    const barra = el('div', { class: 'tx-barra', 'aria-hidden': 'true' },
      el('i', { style: `width:${pct(f.responderam, tot)}%;background:#0ffcbe` }),
      el('i', { style: `width:${pct(f.lidas - f.responderam, tot)}%;background:#19c3a6` }),
      el('i', { style: `width:${pct(f.enviadas - f.lidas, tot)}%;background:#7cc4ff` }),
      el('i', { style: `width:${pct(f.falharam + f.descadastraram, tot)}%;background:#ff7a59` }));
    const sub = `${nomeUnidade(c.unidade)} · ${c.canal === 'oficial' ? 'API oficial' : 'API não oficial'}${c.modo === 'automatico' ? ' · automática' : ''}`;
    const quandoTxt = c.status === 'agendada' && c.agendadaPara ? `Agendada para ${quando(c.agendadaPara)}` : c.concluidaEm ? `Terminou ${quando(c.concluidaEm)}` : c.iniciadaEm ? `Começou ${quando(c.iniciadaEm)}` : `Criada ${quando(c.criadaEm)}`;
    return el('button', { type: 'button', class: 'tx-card', onclick: () => abrirCampanha(c.id), 'aria-label': `Abrir ${c.nome}` },
      el('div', { class: 'tx-card-topo' }, el('div', { style: 'min-width:0' }, el('h3', { text: c.nome }), el('div', { class: 'tx-sub', text: sub })), pilula(STATUS, c.status)),
      c.contagem.total ? barra : null,
      el('div', { class: 'tx-mini' },
        el('span', {}, el('b', { text: fmtN(c.contagem.total) }), ' pessoas'),
        el('span', {}, el('b', { text: fmtN(f.enviadas) }), ' enviadas'),
        el('span', {}, el('b', { text: `${pct(f.lidas, f.enviadas)}%` }), ' lidas'),
        el('span', {}, el('b', { text: fmtN(f.responderam) }), ' respostas')),
      el('div', { class: 'tx-sub', text: c.erro ? `⚠ ${c.erro}` : quandoTxt }));
  }

  // ---------- assistente ----------
  function rascunhoNovo() {
    const n = s.numeros[0];
    const unidade = s.ui.estado.eu?.unidades?.[0] && s.numeros.some((x) => x.unidade === s.ui.estado.eu.unidades[0]) ? s.ui.estado.eu.unidades[0] : n?.unidade || 'norte';
    const num = s.numeros.find((x) => x.unidade === unidade);
    const canal = num?.tipo === 'meta' ? 'oficial' : 'nao_oficial';
    return {
      id: null, nome: '', unidade, canal, modo: 'manual', status: 'rascunho',
      publico: { tags: [], tagsTodas: false, semTags: [], etapas: [], quantidade: null, ordem: 'recentes', excluirRecebeuDias: 7, excluirConversaAberta: true },
      mensagem: { texto: '{Oi|Olá|Oie} {primeiro_nome}! 💙\n\nAqui é da Império Progressivas ({unidade}). ', modelo: null, variaveis: [] },
      envio: padroes(canal, {}), agendarPara: '', quandoEnviar: 'agora',
    };
  }
  function padroes(canal, e) {
    const L = s.limites || {};
    const base = { janelaInicio: 8, janelaFim: 20, domingo: false, porMinuto: 20, intervaloMin: 8, intervaloMax: 25, pausaCada: 30, pausaMin: 5, limiteDia: 200, gatilho: null, ...e };
    if (canal === 'oficial') base.limiteDia = e.limiteDia ?? L.oficial?.limiteDia ?? 1000;
    else Object.assign(base, { intervaloMin: L.nao_oficial?.intervaloMin ?? 8, intervaloMax: L.nao_oficial?.intervaloMax ?? 25, pausaCada: L.nao_oficial?.pausaCada ?? 30, pausaMin: L.nao_oficial?.pausaMin ?? 5, limiteDia: e.limiteDia ?? L.nao_oficial?.limiteDia ?? 200 });
    return base;
  }
  async function novaCampanha() {
    s.rasc = rascunhoNovo(); s.passo = 0; s.previa = null; s.imp = null;
    ir('assistente');
    await carregarModelos(s.rasc.unidade);
    atualizarPrevia();
  }
  function editar(c) {
    s.rasc = { ...structuredClone(c), _editar: true, agendarPara: c.agendadaPara ? paraLocal(c.agendadaPara) : '', quandoEnviar: c.agendadaPara ? 'agendar' : 'agora' };
    s.passo = 0; s.previa = null; s.imp = null;
    ir('assistente');
    carregarModelos(c.unidade).then(desenhar);
    atualizarPrevia();
  }
  const paraLocal = (d) => { const x = new Date(new Date(d).getTime() - 3 * 3600e3); return x.toISOString().slice(0, 16); };
  const deLocal = (v) => (v ? new Date(`${v}:00-03:00`).toISOString() : null);

  function atualizarPrevia() {
    clearTimeout(s.timerPrevia);
    s.timerPrevia = setTimeout(async () => {
      const r = s.rasc; if (!r) return;
      try { s.previa = await s.ui.post('/api/transmissoes/publico/previa', { unidade: r.unidade, publico: r.publico, ...(r.id ? { campanhaId: r.id } : {}) }); s.previaErro = ''; } catch (e) { s.previaErro = e.message; }
      if (s.vista === 'assistente') desenharSemPerderFoco();
    }, 250);
  }
  function desenharSemPerderFoco() {
    const ativo = document.activeElement;
    const chave = ativo?.dataset?.foco;
    const pos = ativo && 'selectionStart' in ativo ? [ativo.selectionStart, ativo.selectionEnd] : null;
    desenhar();
    if (chave) { const e = s.caixa.querySelector(`[data-foco="${chave}"]`); if (e) { e.focus(); if (pos && e.setSelectionRange) try { e.setSelectionRange(pos[0], pos[1]); } catch {} } }
  }
  function mudar(fn, previa = false) { fn(s.rasc); if (previa) atualizarPrevia(); desenharSemPerderFoco(); }

  async function salvarRascunho(silencioso) {
    const r = s.rasc;
    const corpo = { nome: r.nome.trim() || 'Transmissão sem nome', unidade: r.unidade, canal: r.canal, modo: r.modo, publico: r.publico, mensagem: r.mensagem, envio: r.envio };
    const salvo = r.id ? await s.ui.api(`/api/transmissoes/${r.id}`, { method: 'PATCH', body: JSON.stringify(corpo) }) : await s.ui.post('/api/transmissoes', corpo);
    Object.assign(r, { id: salvo.id, status: salvo.status, temImagem: salvo.temImagem, atualizadaEm: salvo.atualizadaEm });
    if (!r.nome.trim()) r.nome = salvo.nome;
    if (r._imagemPendente) { const im = r._imagemPendente; r._imagemPendente = null; const c = await s.ui.post(`/api/transmissoes/${r.id}/imagem`, im); r.temImagem = c.temImagem; r.atualizadaEm = c.atualizadaEm; }
    if (!silencioso) toast('Rascunho salvo');
    return salvo;
  }

  function vistaAssistente() {
    const r = s.rasc;
    const passos = el('div', { class: 'tx-passos', role: 'list', 'aria-label': 'Passos' }, ...PASSOS.map((p, i) => el('button', { type: 'button', role: 'listitem', class: i < s.passo ? 'feito' : '', 'aria-current': i === s.passo ? 'step' : null, onclick: () => trocarPasso(i) }, el('b', { text: String(i + 1) }), el('span', { text: p }))));
    const topo = el('div', { class: 'tx-cab-camp' }, el('div', { class: 'linha1' },
      el('button', { type: 'button', class: 'tx-redondo', html: IC.voltar, 'aria-label': 'Voltar', onclick: () => (r.id ? abrirCampanha(r.id) : voltarLista()) }),
      el('h1', { class: 'titulo-grande', text: r._editar ? 'Editar transmissão' : 'Nova transmissão' })), passos);
    const conteudo = [vistaPublico, vistaMensagem, vistaEnvio, vistaRevisar][s.passo]();
    const lado = el('div', { class: 'tx-lado', style: 'display:grid;gap:16px' }, ...ladoAssistente());
    const nav = el('div', { class: 'tx-acoes cheio' },
      s.passo > 0 ? botao('Voltar', () => trocarPasso(s.passo - 1), 'leve') : null,
      s.passo < 3 ? botao('Próximo', () => trocarPasso(s.passo + 1), '', '', { 'aria-disabled': String(s.ocupado) }) : null,
      s.passo < 3 ? botao('Salvar rascunho', () => salvarRascunho().catch((e) => toast(e.message)), 'leve') : null);
    return [topo, el('div', { class: 'tx-grade duas' }, el('div', { style: 'display:grid;gap:16px;min-width:0' }, ...conteudo, nav), lado)];
  }
  async function trocarPasso(i) {
    if (i === s.passo) return;
    if (i > s.passo) {
      const r = s.rasc;
      if (s.passo === 0 && !r.nome.trim()) { toast('Dê um nome para a transmissão.'); s.caixa.querySelector('[data-foco="nome"]')?.focus(); return; }
      if (i >= 2 && r.canal === 'oficial' && !r.mensagem.modelo) { toast('Escolha o modelo aprovado.'); if (s.passo !== 1) { s.passo = 1; desenhar(); } return; }
      if (i >= 2 && r.canal === 'nao_oficial' && !r.mensagem.texto.trim()) { toast('Escreva a mensagem.'); return; }
      s.ocupado = true;
      try { await salvarRascunho(true); } catch (e) { s.ocupado = false; toast(e.message); return; }
      s.ocupado = false;
    }
    s.passo = i; desenhar(); s.caixa.scrollTop = 0;
  }
  function ladoAssistente() {
    const r = s.rasc;
    const pv = s.previa;
    const blocoPublico = el('div', { class: 'tx-bloco', 'aria-live': 'polite' },
      el('h2', { text: 'Quem vai receber' }),
      pv ? el('div', { class: 'tx-previa-num' }, el('b', { text: fmtN(pv.selecionados) }), el('span', { text: r.publico.quantidade && pv.disponiveis > pv.selecionados ? `de ${fmtN(pv.disponiveis)} disponíveis (${r.publico.ordem === 'aleatorio' ? 'sorteadas' : 'mais recentes primeiro'})` : pv.selecionados === 1 ? 'pessoa' : 'pessoas' })) : el('span', { class: 'tx-nota', text: s.previaErro || 'Calculando…' }),
      pv ? el('div', { class: 'tx-linhas' },
        linhaResumo('Passaram nos filtros', fmtN(pv.encontrados)),
        linhaResumo('Fora: pediram para sair', fmtN(pv.excluidos.descadastrados)),
        linhaResumo(`Fora: receberam nos últimos ${r.publico.excluirRecebeuDias} dias`, fmtN(pv.excluidos.receberamRecente)),
        linhaResumo('Fora: conversando agora', fmtN(pv.excluidos.conversando)),
        linhaResumo('Fora: sem celular válido', fmtN(pv.excluidos.semCelular))) : null,
      pv?.amostra?.length ? el('div', { class: 'tx-nota', text: `Exemplos: ${pv.amostra.slice(0, 4).map((a) => (a.nome || fmtTel(a.telefone))).join(', ')}${r.publico.ordem === 'aleatorio' ? ' (o sorteio final é feito no envio)' : ''}` }) : null);
    return [blocoPublico, previaMensagem()];
  }
  const linhaResumo = (a, b) => el('div', { class: 'tx-linha' }, el('span', { text: a }), el('b', { text: b }));

  function vistaPublico() {
    const r = s.rasc;
    const num = (u) => s.numeros.find((n) => n.unidade === u);
    const n = num(r.unidade);
    const segCanal = el('div', { class: 'tx-seg', role: 'group', 'aria-label': 'API de envio' },
      el('button', { type: 'button', 'aria-pressed': String(r.canal === 'oficial'), 'aria-disabled': String(!n?.oficial), onclick: () => mudarCanal('oficial') }, 'API oficial', el('small', { text: 'modelo aprovado pela Meta' })),
      el('button', { type: 'button', 'aria-pressed': String(r.canal === 'nao_oficial'), 'aria-disabled': String(!n?.naoOficial), onclick: () => mudarCanal('nao_oficial') }, 'API não oficial', el('small', { text: 'texto livre (QR Code)' })));
    const basico = el('div', { class: 'tx-bloco' },
      el('h2', { text: 'Campanha' }),
      el('div', { class: 'tx-campos' },
        campo('Nome da transmissão', el('input', { type: 'text', maxlength: '80', value: r.nome, placeholder: 'Ex.: Black Friday 2026', 'data-foco': 'nome', oninput: (e) => { r.nome = e.target.value; } })),
        campo('Número de envio (unidade)', select(r.unidade, s.numeros.map((x) => [x.unidade, `${x.nome}${x.tipo === 'teste' ? ' · WhatsApp de teste' : x.tipo === 'meta' ? ' · API oficial' : x.tipo === 'evolution' ? ' · QR Code' : ' · sem número'}`]), (v) => { mudar((x) => { x.unidade = v; x.publico.tags = []; x.publico.semTags = []; }, true); carregarModelos(v).then(desenhar); }, { 'aria-label': 'Unidade' }))),
      segCanal,
      n?.tipo === 'teste' ? el('div', { class: 'tx-nota', text: 'Esta unidade está no WhatsApp de teste: nada sai para números reais. Entregas e leituras são simuladas para você ver o funil andar.' }) : null);
    return [basico, blocoImportar(), blocoFiltros()];
  }
  function mudarCanal(canal) {
    mudar((r) => { if (r.canal === canal) return; r.canal = canal; r.envio = padroes(canal, { janelaInicio: r.envio.janelaInicio, janelaFim: r.envio.janelaFim, domingo: r.envio.domingo, gatilho: r.envio.gatilho }); });
  }

  function blocoImportar() {
    const r = s.rasc;
    s.imp ??= { texto: '', nomeArquivo: '', tag: 'nova', tagNova: '', tagId: '', ddd: '71', resultado: null, erro: '', ocupado: false };
    const im = s.imp;
    if (!im.tagNova) im.tagNova = r.nome.trim() ? `Lista ${r.nome.trim()}`.slice(0, 30) : 'Lista Black Friday';
    const arquivo = el('input', { type: 'file', accept: '.csv,.txt,.tsv,text/csv,text/plain', hidden: '', onchange: async (e) => { const f = e.target.files?.[0]; if (!f) return; const buf = await f.arrayBuffer(); let t; try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { t = new TextDecoder('windows-1252').decode(buf); } im.texto = t; im.nomeArquivo = f.name; desenhar(); } });
    const tagsOpc = [['nova', '+ Criar tag nova'], ...tagsSoltas().map((t) => [t.id, t.nome])];
    const linhas = im.texto ? lerCsv(im.texto) : [];
    const corpo = el('div', {},
      el('div', { class: 'tx-nota', text: 'Cole a planilha (com a linha de títulos: Nome, Telefone...) ou escolha um arquivo CSV. Os telefones são corrigidos (DDD, 9º dígito), repetidos são juntados e todo mundo ganha a tag escolhida — use essa tag no público abaixo.' }),
      el('label', { class: 'tx-arquivo', role: 'button', tabindex: '0', html: IC.subir, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); arquivo.click(); } } }, el('b', { text: im.nomeArquivo || 'Escolher arquivo CSV' }), el('span', { text: 'ou cole abaixo' }), arquivo),
      campo('Planilha colada', el('textarea', { class: 'mono', rows: '5', placeholder: 'Nome;Telefone\nMaria Souza;(71) 98812-4471', text: im.texto, 'data-foco': 'planilha', oninput: (e) => { im.texto = e.target.value; } }, )),
      el('div', { class: 'tx-campos' },
        campo('Marcar com a tag', select(im.tag, tagsOpc, (v) => { im.tag = v; desenhar(); }, { 'aria-label': 'Tag da lista' })),
        im.tag === 'nova' ? campo('Nome da tag nova', el('input', { type: 'text', maxlength: '30', value: im.tagNova, 'data-foco': 'tagnova', oninput: (e) => { im.tagNova = e.target.value; } })) : null,
        campo('DDD para números sem DDD', el('input', { type: 'text', inputmode: 'numeric', maxlength: '2', value: im.ddd, oninput: (e) => { im.ddd = e.target.value.replace(/\D/g, ''); } }))),
      linhas.length > 1 ? el('div', { class: 'tx-nota', text: `${fmtN(linhas.length - 1)} linha(s) encontradas. Colunas: ${linhas[0].join(', ')}` }) : null,
      im.erro ? el('div', { class: 'tx-erro', text: im.erro }) : null,
      im.resultado ? el('div', { class: 'tx-alerta', style: 'background:color-mix(in srgb,#0ffcbe 14%,transparent);border-color:color-mix(in srgb,#0ffcbe 45%,transparent)', html: IC.check2 }, el('div', {}, el('b', { text: `Lista importada com a tag "${im.resultado.tag?.nome || ''}"` }), el('span', { text: `${fmtN(im.resultado.relatorio.criados)} novos, ${fmtN(im.resultado.relatorio.atualizados + im.resultado.relatorio.iguais)} já existiam, ${fmtN(im.resultado.relatorio.recusados)} recusados (telefone inválido ou repetido).` }))) : null,
      el('div', { class: 'tx-acoes' }, botao(im.ocupado ? 'Importando…' : 'Importar lista', importarLista, '', IC.subir, { 'aria-disabled': String(im.ocupado) })));
    return el('details', { class: 'tx-bloco tx-dobra', ...(im.texto || im.resultado ? { open: '' } : {}) }, el('summary', { html: `${IC.subir}<span>Subir lista (CSV ou planilha colada)</span>` }), corpo);
  }
  async function importarLista() {
    const im = s.imp, r = s.rasc;
    im.erro = '';
    const linhas = lerCsv(im.texto || '');
    if (linhas.length < 2) { im.erro = 'Não encontrei linhas. A primeira linha precisa ter os nomes das colunas (Nome, Telefone...).'; return desenhar(); }
    if (linhas.length - 1 > MAX_LINHAS) { im.erro = `Até ${fmtN(MAX_LINHAS)} linhas por vez.`; return desenhar(); }
    const cab = linhas[0].map((c) => semAcento(c));
    let iTel = cab.findIndex((c) => /^(telefone|tel|fone|celular|cel|whats|zap|phone|numero|contato)/.test(c));
    let iNome = cab.findIndex((c) => /^(nome|name|cliente)/.test(c));
    const iEmail = cab.findIndex((c) => /^e ?-?mail/.test(c));
    if (iTel < 0) { iTel = linhas[0].length > 1 ? 1 : 0; if (iNome < 0 && linhas[0].length > 1) iNome = 0; }
    const dados = linhas.slice(1).map((l) => ({ telefone: l[iTel] ?? '', ...(iNome >= 0 && l[iNome] ? { nome: l[iNome] } : {}), ...(iEmail >= 0 && l[iEmail] ? { email: l[iEmail] } : {}) }));
    im.ocupado = true; desenhar();
    try {
      im.resultado = await s.ui.post('/api/transmissoes/importar', { linhas: dados, unidade: r.unidade, ...(im.tag === 'nova' ? { tagNova: im.tagNova.trim() || 'Lista importada' } : { tagId: im.tag }), ...(/^\d{2}$/.test(im.ddd) ? { dddPadrao: im.ddd } : {}) });
      if (im.resultado.tag && !r.publico.tags.includes(im.resultado.tag.id)) r.publico.tags = [...r.publico.tags, im.resultado.tag.id];
      await carregarApoio();
      im.tag = im.resultado.tag?.id || im.tag;
      toast('Lista importada e tag marcada no público');
      atualizarPrevia();
    } catch (e) { im.erro = e.message; }
    im.ocupado = false; desenhar();
  }
  function lerCsv(texto) {
    const t = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const primeira = t.split('\n').find((l) => l.trim()) || '';
    const conta = (sep) => { let n = 0, q = false; for (const ch of primeira) { if (ch === '"') q = !q; else if (ch === sep && !q) n++; } return n; };
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

  function blocoFiltros() {
    const r = s.rasc, p = r.publico;
    const alterna = (lista, id) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
    const chipTag = (t, chave, classe = '') => el('button', { type: 'button', class: `tx-chip ${classe}`, 'aria-pressed': String(p[chave].includes(t.id)), onclick: () => mudar((x) => { x.publico[chave] = alterna(x.publico[chave], t.id); }, true) }, el('i', { style: `background:${t.cor || '#8b8d98'}` }), t.nome);
    const soltas = tagsSoltas();
    const etapas = etapasFunis();
    const quantidade = el('div', { class: 'tx-seg', role: 'group', 'aria-label': 'Quantidade' },
      el('button', { type: 'button', 'aria-pressed': String(!p.quantidade), onclick: () => mudar((x) => { x.publico.quantidade = null; }, true) }, 'Todas'),
      el('button', { type: 'button', 'aria-pressed': String(Boolean(p.quantidade)), onclick: () => mudar((x) => { x.publico.quantidade = x.publico.quantidade || Math.min(200, s.previa?.disponiveis || 200) || 200; }, true) }, 'Só uma parte'));
    return el('div', { class: 'tx-bloco' },
      el('h2', {}, 'Público', el('small', { text: 'Quem tiver QUALQUER uma das tags marcadas (ou todas, se preferir). Sem tag marcada = toda a unidade.' })),
      soltas.length ? el('div', { class: 'tx-chips', role: 'group', 'aria-label': 'Tags' }, ...soltas.map((t) => chipTag(t, 'tags'))) : el('div', { class: 'tx-nota', text: 'Nenhuma tag ainda: suba uma lista acima ou crie tags em Mais › Tags.' }),
      p.tags.length > 1 ? el('label', { class: 'tx-marcar' }, el('input', { type: 'checkbox', ...(p.tagsTodas ? { checked: '' } : {}), onchange: (e) => mudar((x) => { x.publico.tagsTodas = e.target.checked; }, true) }), el('span', { text: 'Precisa ter TODAS as tags marcadas' })) : null,
      el('details', { class: 'tx-dobra', ...(p.etapas.length || p.semTags.length || p.tags.some((id) => etapas.some((e) => e.id === id)) ? { open: '' } : {}) }, el('summary', { text: 'Etapa do funil e exclusões por tag' }),
        el('div', {},
          el('div', { class: 'tx-nota', text: 'Etapa do atendimento:' }),
          el('div', { class: 'tx-chips', role: 'group', 'aria-label': 'Etapas' }, ...s.ui.ETAPAS.map((e) => el('button', { type: 'button', class: 'tx-chip', 'aria-pressed': String(p.etapas.includes(e)), onclick: () => mudar((x) => { x.publico.etapas = alterna(x.publico.etapas, e); }, true) }, s.ui.NOME_ETAPA[e] || e))),
          etapas.length ? el('div', { class: 'tx-nota', text: 'Etapas dos seus funis:' }) : null,
          etapas.length ? el('div', { class: 'tx-chips' }, ...etapas.map((t) => chipTag(t, 'tags'))) : null,
          soltas.length ? el('div', { class: 'tx-nota', text: 'Tirar quem tem estas tags:' }) : null,
          soltas.length ? el('div', { class: 'tx-chips' }, ...soltas.map((t) => chipTag(t, 'semTags', 'fora'))) : null)),
      el('h2', {}, 'Quantidade'),
      quantidade,
      p.quantidade ? el('div', { class: 'tx-campos' },
        campo('Enviar para', numeroInput(p.quantidade, 1, 100000, (v) => mudar((x) => { x.publico.quantidade = v; }, true), { 'data-foco': 'qtd', 'aria-label': 'Quantidade de pessoas' }), el('span', { class: 'tx-nota', text: s.previa ? `de ${fmtN(s.previa.disponiveis)} disponíveis` : '' })),
        campo('Quem primeiro', select(p.ordem, [['recentes', 'Mais recentes primeiro'], ['aleatorio', 'Sorteio (aleatório)']], (v) => mudar((x) => { x.publico.ordem = v; }, true)))) : null,
      el('h2', {}, 'Excluir'),
      el('label', { class: 'tx-marcar' }, el('input', { type: 'checkbox', ...(p.excluirRecebeuDias > 0 ? { checked: '' } : {}), onchange: (e) => mudar((x) => { x.publico.excluirRecebeuDias = e.target.checked ? 7 : 0; }, true) }),
        el('span', { class: 'tx-inline' }, 'Quem recebeu transmissão nos últimos', p.excluirRecebeuDias > 0 ? numeroInput(p.excluirRecebeuDias, 1, 365, (v) => mudar((x) => { x.publico.excluirRecebeuDias = v; }, true), { 'aria-label': 'Dias' }) : null, 'dias')),
      el('label', { class: 'tx-marcar' }, el('input', { type: 'checkbox', ...(p.excluirConversaAberta ? { checked: '' } : {}), onchange: (e) => mudar((x) => { x.publico.excluirConversaAberta = e.target.checked; }, true) }), el('span', {}, 'Quem está conversando com a equipe agora', el('small', { text: 'Mensagem nas últimas 24 horas: não atrapalha o atendimento.' }))),
      el('div', { class: 'tx-nota', text: 'Quem respondeu SAIR, PARAR ou "não quero mais" fica sempre de fora.' }));
  }

  function vistaMensagem() {
    const r = s.rasc;
    return r.canal === 'oficial' ? mensagemOficial() : mensagemLivre();
  }
  function blocoImagem(rotulo) {
    const r = s.rasc;
    const input = el('input', { type: 'file', accept: 'image/jpeg,image/png', hidden: '', onchange: async (e) => {
      const f = e.target.files?.[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('A imagem pode ter até 5 MB.'); return; }
      const base64 = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
      r._imagemUrl = URL.createObjectURL(f);
      r._imagemPendente = { base64, mimetype: f.type };
      if (r.id) { try { const c = await s.ui.post(`/api/transmissoes/${r.id}/imagem`, r._imagemPendente); r._imagemPendente = null; r.temImagem = c.temImagem; r.atualizadaEm = c.atualizadaEm; } catch (er) { toast(er.message); } }
      desenhar();
    } });
    const tem = r._imagemUrl || r.temImagem;
    return el('div', { class: 'tx-acoes' },
      el('label', { class: 'tx-botao leve pequeno', role: 'button', tabindex: '0', html: IC.imagem, onkeydown: (e) => { if (e.key === 'Enter') input.click(); } }, el('span', { text: tem ? 'Trocar imagem' : rotulo }), input),
      tem ? botao('Tirar imagem', async () => { r._imagemUrl = null; r._imagemPendente = null; if (r.id) { const c = await s.ui.post(`/api/transmissoes/${r.id}/imagem`, { base64: null }); r.temImagem = c.temImagem; } else r.temImagem = false; desenhar(); }, 'leve pequeno') : null);
  }
  function mensagemLivre() {
    const r = s.rasc, m = r.mensagem;
    const L = s.limites?.nao_oficial;
    const area = el('textarea', { rows: '7', maxlength: '4000', text: m.texto, 'data-foco': 'texto', oninput: (e) => { m.texto = e.target.value; const z = s.caixa.querySelector('.tx-lado .tx-zap'); if (z) z.replaceWith(previaMensagem()); } });
    const inserir = (t) => { const a = s.caixa.querySelector('[data-foco="texto"]'); const i = a?.selectionStart ?? m.texto.length; m.texto = m.texto.slice(0, i) + t + m.texto.slice(a?.selectionEnd ?? i); desenhar(); const b = s.caixa.querySelector('[data-foco="texto"]'); b?.focus(); b?.setSelectionRange(i + t.length, i + t.length); };
    const temSair = /sair|parar/i.test(m.texto);
    return [
      el('div', { class: 'tx-alerta coral', html: IC.aviso }, el('div', {}, el('b', { text: 'Risco de bloqueio do número' }), el('span', { text: L?.texto || 'API não oficial: envie devagar e só para quem conhece a loja.' }))),
      el('div', { class: 'tx-bloco' },
        el('h2', {}, 'Mensagem', el('small', { text: 'Variáveis trocam pelo dado de cada pessoa. {Oi|Olá|Oie} sorteia uma das opções para cada uma — mensagens diferentes reduzem o risco de bloqueio.' })),
        campo('Texto', area),
        el('div', { class: 'tx-chips', role: 'group', 'aria-label': 'Inserir variável' },
          ...[['{primeiro_nome}', 'Primeiro nome'], ['{nome}', 'Nome completo'], ['{unidade}', 'Unidade']].map(([v, t]) => el('button', { type: 'button', class: 'tx-chip', onclick: () => inserir(v) }, `+ ${t}`)),
          ...s.campos.slice(0, 6).map((c) => el('button', { type: 'button', class: 'tx-chip', onclick: () => inserir(`{campo:${c.nome}}`) }, `+ ${c.nome}`)),
          el('button', { type: 'button', class: 'tx-chip', onclick: () => inserir('{Oi|Olá|Oie}') }, '+ Variação {Oi|Olá}')),
        !temSair ? el('div', { class: 'tx-alerta', html: IC.aviso }, el('div', {}, el('b', { text: 'Dê a opção de sair' }), el('span', { text: 'Termine com algo como "Se não quiser mais receber, responda SAIR." Quem responder sai da lista sozinho.' }), el('div', { style: 'margin-top:8px' }, botao('Adicionar a frase', () => { m.texto = `${m.texto.trimEnd()}\n\n_Se não quiser mais receber, responda SAIR._`; desenhar(); }, 'leve pequeno')))) : null,
        el('div', { class: 'tx-acoes' }, botao('Ver outra variação', () => { s.semente++; desenhar(); }, 'leve pequeno'), blocoImagem('Adicionar imagem (opcional)'))),
    ];
  }
  function mensagemOficial() {
    const r = s.rasc, m = r.mensagem;
    const aprovados = s.modelos.filter((x) => x.status === 'aprovado');
    const outros = s.modelos.filter((x) => x.status !== 'aprovado');
    const atual = m.modelo ? s.modelos.find((x) => x.nome === m.modelo.nome && x.idioma === m.modelo.idioma) : null;
    const escolher = (id) => {
      const x = s.modelos.find((y) => y.id === id);
      mudar((rr) => {
        if (!x) { rr.mensagem.modelo = null; rr.mensagem.variaveis = []; return; }
        rr.mensagem.modelo = { nome: x.nome, idioma: x.idioma, corpo: x.corpo, cabecalho: x.cabecalho?.formato };
        const n = x.variaveis;
        rr.mensagem.variaveis = Array.from({ length: n }, (_, i) => rr.mensagem.variaveis[i] || { fonte: i === 0 ? 'primeiro_nome' : 'fixo:', padrao: i === 0 ? 'cliente' : '' });
      });
    };
    const fontes = [...FONTES, ...s.campos.map((c) => [`campo:${c.nome}`, `Ficha: ${c.nome}`]), ['fixo:', 'Texto fixo…']];
    const linhasVar = (m.variaveis || []).map((v, i) => {
      const fixo = v.fonte.startsWith('fixo:');
      return el('div', { class: 'tx-var' }, el('b', { text: `{{${i + 1}}}` }),
        select(fixo ? 'fixo:' : v.fonte, fontes, (val) => mudar((rr) => { rr.mensagem.variaveis[i].fonte = val === 'fixo:' ? 'fixo:' : val; }), { 'aria-label': `Variável ${i + 1}` }),
        fixo ? el('input', { type: 'text', placeholder: 'Texto fixo', value: v.fonte.slice(5), 'data-foco': `fixo${i}`, 'aria-label': `Texto da variável ${i + 1}`, oninput: (e) => { v.fonte = `fixo:${e.target.value}`; } })
          : el('input', { type: 'text', placeholder: 'Se vazio: …', value: v.padrao, 'data-foco': `padrao${i}`, 'aria-label': `Padrão da variável ${i + 1}`, oninput: (e) => { v.padrao = e.target.value; } }));
    });
    return [
      el('div', { class: 'tx-bloco' },
        el('h2', {}, 'Modelo aprovado', el('small', { text: 'Pela API oficial, só modelos aprovados pela Meta podem iniciar conversa. Crie um novo e acompanhe a aprovação.' })),
        s.modelosErro ? el('div', { class: 'tx-erro', text: s.modelosErro }) : null,
        campo('Modelo', select(atual?.id || '', [['', aprovados.length ? 'Escolha…' : 'Nenhum modelo aprovado ainda'], ...aprovados.map((x) => [x.id, `${x.nome} · ${x.categoria === 'MARKETING' ? 'marketing' : 'utilidade'}${x.simulado ? ' (teste)' : ''}`])], escolher, { 'aria-label': 'Modelo' })),
        outros.length ? el('div', { class: 'tx-nota', text: `Aguardando ou recusados: ${outros.map((x) => `${x.nome} (${x.status})`).join(', ')}` }) : null,
        el('div', { class: 'tx-acoes' }, botao('Criar modelo', () => abrirModelos(true), 'leve pequeno', IC.mais), botao('Atualizar lista', async () => { await carregarModelos(r.unidade, true); desenhar(); }, 'leve pequeno'))),
      m.modelo ? el('div', { class: 'tx-bloco' },
        el('h2', {}, 'Variáveis', el('small', { text: m.variaveis.length ? 'O que vai em cada {{n}}: um campo da ficha ou um texto fixo. Se o campo estiver vazio, entra o padrão.' : 'Este modelo não tem variáveis.' })),
        el('div', { class: 'tx-vars' }, ...linhasVar),
        m.modelo.cabecalho === 'IMAGE' ? el('div', { class: 'tx-nota', text: 'Este modelo tem imagem no cabeçalho: envie a imagem da campanha.' }) : null,
        m.modelo.cabecalho === 'IMAGE' ? blocoImagem('Enviar imagem do cabeçalho') : null) : null,
    ];
  }

  function vistaEnvio() {
    const r = s.rasc, e = r.envio;
    const oficial = r.canal === 'oficial';
    const L = s.limites?.[r.canal];
    const modo = el('div', { class: 'tx-seg', role: 'group', 'aria-label': 'Modo de envio' },
      el('button', { type: 'button', 'aria-pressed': String(r.modo === 'manual'), onclick: () => mudar((x) => { x.modo = 'manual'; }) }, 'Manual', el('small', { text: 'agora ou agendado' })),
      el('button', { type: 'button', 'aria-pressed': String(r.modo === 'automatico'), onclick: () => mudar((x) => { x.modo = 'automatico'; x.envio.gatilho ??= { tipo: 'aniversario' }; }) }, 'Automático', el('small', { text: 'por gatilho' })));
    const blocoQuando = r.modo === 'manual'
      ? el('div', { class: 'tx-bloco' }, el('h2', { text: 'Quando' }),
        el('div', { class: 'tx-seg', role: 'group', 'aria-label': 'Quando enviar' },
          el('button', { type: 'button', 'aria-pressed': String(r.quandoEnviar !== 'agendar'), onclick: () => mudar((x) => { x.quandoEnviar = 'agora'; }) }, 'Enviar agora'),
          el('button', { type: 'button', 'aria-pressed': String(r.quandoEnviar === 'agendar'), onclick: () => mudar((x) => { x.quandoEnviar = 'agendar'; if (!x.agendarPara) x.agendarPara = paraLocal(Date.now() + 3600e3).slice(0, 14) + '00'; }) }, 'Agendar')),
        r.quandoEnviar === 'agendar' ? campo('Data e hora (horário da Bahia)', el('input', { type: 'datetime-local', value: r.agendarPara, onchange: (ev) => { r.agendarPara = ev.target.value; } })) : null)
      : el('div', { class: 'tx-bloco' }, el('h2', {}, 'Gatilho', el('small', { text: 'Cada pessoa recebe uma vez (no aniversário, uma vez por ano). Também dá para usar como passo "Enviar transmissão" nas Automações.' })), gatilho());
    const ritmo = el('div', { class: 'tx-bloco' },
      el('h2', {}, 'Ritmo e horário', el('small', { text: L?.texto || '' })),
      el('div', { class: 'tx-inline' }, 'Enviar das', numeroInput(e.janelaInicio, 0, 23, (v) => mudar((x) => { x.envio.janelaInicio = v; }), { 'aria-label': 'Hora inicial' }), 'h às', numeroInput(e.janelaFim, 1, 24, (v) => mudar((x) => { x.envio.janelaFim = v; }), { 'aria-label': 'Hora final' }), 'h'),
      el('label', { class: 'tx-marcar' }, el('input', { type: 'checkbox', ...(e.domingo ? { checked: '' } : {}), onchange: (ev) => mudar((x) => { x.envio.domingo = ev.target.checked; }) }), el('span', { text: 'Enviar também aos domingos' })),
      oficial
        ? el('div', { class: 'tx-inline' }, numeroInput(e.porMinuto, 1, 600, (v) => mudar((x) => { x.envio.porMinuto = v; }), { 'aria-label': 'Mensagens por minuto' }), 'mensagens por minuto')
        : el('div', { style: 'display:grid;gap:10px' },
          el('div', { class: 'tx-inline' }, 'Esperar entre', numeroInput(e.intervaloMin, 3, 600, (v) => mudar((x) => { x.envio.intervaloMin = v; }), { 'aria-label': 'Intervalo mínimo' }), 'e', numeroInput(e.intervaloMax, 3, 1200, (v) => mudar((x) => { x.envio.intervaloMax = v; }), { 'aria-label': 'Intervalo máximo' }), 'segundos (sorteado)'),
          el('div', { class: 'tx-inline' }, 'Pausa de', numeroInput(e.pausaMin, 0, 240, (v) => mudar((x) => { x.envio.pausaMin = v; }), { 'aria-label': 'Minutos de pausa' }), 'min a cada', numeroInput(e.pausaCada, 0, 1000, (v) => mudar((x) => { x.envio.pausaCada = v; }), { 'aria-label': 'Mensagens até a pausa' }), 'mensagens')),
      el('div', { class: 'tx-inline' }, 'No máximo', numeroInput(e.limiteDia, 1, 100000, (v) => mudar((x) => { x.envio.limiteDia = v; }), { 'aria-label': 'Limite por dia', style: 'width:96px!important' }), 'por dia neste número'),
      !oficial && (e.intervaloMin < 8 || e.limiteDia > 300) ? el('div', { class: 'tx-alerta coral', html: IC.aviso }, el('div', {}, el('b', { text: 'Ritmo acima do recomendado' }), el('span', { text: 'Intervalos curtos ou muitas mensagens por dia aumentam muito a chance de o WhatsApp bloquear o número.' }))) : null,
      el('div', { class: 'tx-acoes' }, botao('Usar padrões seguros', () => mudar((x) => { x.envio = padroes(x.canal, { gatilho: x.envio.gatilho, limiteDia: undefined }); }), 'leve pequeno')));
    return [el('div', { class: 'tx-bloco' }, el('h2', { text: 'Como enviar' }), modo), blocoQuando, ritmo];
  }
  function gatilho() {
    const r = s.rasc, g = r.envio.gatilho || { tipo: 'aniversario' };
    const tipos = [['entrou_na_etapa', 'Entrou numa etapa do funil'], ['tag_marcada', 'Tag marcada'], ['aniversario', 'Aniversário da cliente'], ['dias_apos_compareceu', 'X dias depois de comparecer']];
    const etapas = etapasFunis();
    const partes = [campo('Quando a pessoa entra na fila', select(g.tipo, tipos, (v) => mudar((x) => { x.envio.gatilho = v === 'entrou_na_etapa' ? { tipo: v, etapaId: etapas[0]?.id || '' } : v === 'tag_marcada' ? { tipo: v, tagId: tagsSoltas()[0]?.id || '' } : v === 'dias_apos_compareceu' ? { tipo: v, dias: 30 } : { tipo: v }; }), { 'aria-label': 'Gatilho' }))];
    if (g.tipo === 'entrou_na_etapa') partes.push(campo('Etapa', select(g.etapaId, etapas.map((e) => [e.id, e.nome]), (v) => mudar((x) => { x.envio.gatilho.etapaId = v; }))));
    if (g.tipo === 'tag_marcada') partes.push(campo('Tag', select(g.tagId, tagsSoltas().map((t) => [t.id, t.nome]), (v) => mudar((x) => { x.envio.gatilho.tagId = v; }))));
    if (g.tipo === 'dias_apos_compareceu') partes.push(el('div', { class: 'tx-inline' }, numeroInput(g.dias, 1, 365, (v) => mudar((x) => { x.envio.gatilho.dias = v; }), { 'aria-label': 'Dias' }), 'dias depois de comparecer'));
    if (g.tipo === 'aniversario') partes.push(el('div', { class: 'tx-nota', text: 'Usa a data de nascimento da ficha do contato. Sai no horário permitido do dia do aniversário.' }));
    return el('div', { style: 'display:grid;gap:10px' }, ...partes);
  }
  function estimativa() {
    const r = s.rasc, e = r.envio, n = s.previa?.selecionados || 0;
    if (!n) return '';
    const porMsg = r.canal === 'oficial' ? 60 / e.porMinuto : (e.intervaloMin + e.intervaloMax) / 2;
    let seg = n * porMsg + (r.canal === 'oficial' || !e.pausaCada ? 0 : Math.floor(n / e.pausaCada) * e.pausaMin * 60);
    const dias = Math.ceil(n / e.limiteDia);
    const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
    return `~${h ? `${h} h ` : ''}${m} min de envio${dias > 1 ? `, em ${dias} dias (limite de ${fmtN(e.limiteDia)} por dia)` : ''}`;
  }
  function vistaRevisar() {
    const r = s.rasc, e = r.envio;
    const nomesTags = r.publico.tags.map((id) => s.tags.find((t) => t.id === id)?.nome || etapasFunis().find((x) => x.id === id)?.nome).filter(Boolean);
    const g = e.gatilho;
    const gTxt = !g ? '' : g.tipo === 'aniversario' ? 'no aniversário' : g.tipo === 'dias_apos_compareceu' ? `${g.dias} dias depois de comparecer` : g.tipo === 'tag_marcada' ? `quando marcar a tag ${s.tags.find((t) => t.id === g.tagId)?.nome || ''}` : `ao entrar em ${etapasFunis().find((x) => x.id === g.etapaId)?.nome || 'uma etapa'}`;
    const linhas = [
      ['Nome', r.nome], ['Número', `${nomeUnidade(r.unidade)} · ${r.canal === 'oficial' ? 'API oficial' : 'API não oficial'}`],
      ['Público', r.modo === 'automatico' ? `Automático: ${gTxt}` : `${fmtN(s.previa?.selecionados)} pessoa(s)${nomesTags.length ? ` · ${nomesTags.join(r.publico.tagsTodas ? ' + ' : ' ou ')}` : ' · toda a unidade'}${r.publico.etapas.length ? ` · etapas: ${r.publico.etapas.map((x) => s.ui.NOME_ETAPA[x]).join(', ')}` : ''}`],
      ['Mensagem', r.canal === 'oficial' ? `Modelo ${r.mensagem.modelo?.nome || '—'}` : `Texto livre${r.temImagem || r._imagemUrl ? ' + imagem' : ''}`],
      ['Quando', r.modo === 'automatico' ? 'Assim que cada pessoa entrar (dentro do horário)' : r.quandoEnviar === 'agendar' && r.agendarPara ? `Agendada: ${new Date(deLocal(r.agendarPara)).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })}` : 'Agora'],
      ['Horário', `${e.janelaInicio}h às ${e.janelaFim}h${e.domingo ? ', inclusive domingo' : ', menos domingo'}`],
      ['Ritmo', r.canal === 'oficial' ? `${e.porMinuto}/min, até ${fmtN(e.limiteDia)}/dia` : `${e.intervaloMin}–${e.intervaloMax} s entre envios, pausa de ${e.pausaMin} min a cada ${e.pausaCada}, até ${fmtN(e.limiteDia)}/dia`],
    ];
    if (r.modo === 'manual') linhas.push(['Duração', estimativa() || '—']);
    const rotulo = r.modo === 'automatico' ? 'Ligar transmissão automática' : r.quandoEnviar === 'agendar' ? 'Agendar transmissão' : `Enviar para ${fmtN(s.previa?.selecionados)} pessoa(s)`;
    return [
      el('div', { class: 'tx-bloco' }, el('h2', { text: 'Revisar' }), el('div', { class: 'tx-resumo' }, ...linhas.map(([a, b]) => el('div', {}, el('span', { text: a }), el('b', { text: b || '—' }))))),
      r.canal === 'nao_oficial' ? el('div', { class: 'tx-alerta coral', html: IC.aviso }, el('div', {}, el('b', { text: 'Lembrete: API não oficial' }), el('span', { text: 'Disparo em massa pode bloquear o número. A Sintonia respeita o ritmo acima e pausa sozinha se vierem 5 falhas seguidas.' }))) : null,
      el('div', { class: 'tx-acoes cheio' }, botao(s.ocupado ? 'Começando…' : rotulo, iniciar, '', IC.enviar, { 'aria-disabled': String(s.ocupado || (r.modo === 'manual' && !s.previa?.selecionados)) }), botao('Salvar rascunho', () => salvarRascunho().then(() => abrirCampanha(s.rasc.id)).catch((er) => toast(er.message)), 'leve')),
    ];
  }
  async function iniciar() {
    const r = s.rasc;
    s.ocupado = true; desenhar();
    try {
      await salvarRascunho(true);
      const agendarPara = r.modo === 'manual' && r.quandoEnviar === 'agendar' ? deLocal(r.agendarPara) : null;
      const c = await s.ui.post(`/api/transmissoes/${r.id}/iniciar`, { agendarPara });
      toast(c.status === 'aguardando_modelo' ? 'Esperando a Meta aprovar o modelo: começa sozinha depois.' : c.status === 'agendada' ? 'Transmissão agendada' : 'Transmissão começou');
      s.ocupado = false;
      abrirCampanha(c.id);
    } catch (e) { s.ocupado = false; toast(e.message); desenhar(); }
  }

  // ---------- campanha ----------
  async function abrirCampanha(id) {
    pararTimer();
    s.vista = 'campanha'; s.atual = null; s.dest = null; s.destFiltro = ''; s.destBusca = '';
    desenhar();
    await atualizarCampanha(id);
    s.caixa.scrollTop = 0;
    s.timer = setInterval(() => { if (s.vista === 'campanha' && document.visibilityState === 'visible' && ['enviando', 'agendada', 'aguardando_modelo'].includes(s.atual?.status)) atualizarCampanha(id); }, 3000);
  }
  async function atualizarCampanha(id) {
    try {
      const [c, d] = await Promise.all([s.ui.api(`/api/transmissoes/${id}`), s.ui.api(`/api/transmissoes/${id}/destinos?limite=60${s.destFiltro ? `&status=${s.destFiltro}` : ''}${s.destBusca ? `&busca=${encodeURIComponent(s.destBusca)}` : ''}`)]);
      s.atual = c; s.dest = d;
    } catch (e) { toast(e.message); }
    if (s.vista === 'campanha') desenharSemPerderFoco();
  }
  async function acao(nome, msg) {
    const c = s.atual;
    if (nome === 'cancelar' && !confirm('Cancelar a transmissão? Quem ainda está na fila não recebe.')) return;
    if (nome === 'apagar') { if (!confirm('Apagar esta transmissão e o histórico dela?')) return; await s.ui.api(`/api/transmissoes/${c.id}`, { method: 'DELETE' }).catch((e) => toast(e.message)); await voltarLista(); return; }
    try {
      if (nome === 'duplicar') { const n = await s.ui.post(`/api/transmissoes/${c.id}/duplicar`); toast('Cópia criada'); editar(n); return; }
      if (nome === 'simular') { const r = await s.ui.post(`/api/transmissoes/${c.id}/simular-resposta`, { texto: 'Oi! Quero saber mais 😍' }); toast(`${r.nome || fmtTel(r.telefone)} respondeu (simulação)`); }
      else if (nome === 'simular-sair') { const r = await s.ui.post(`/api/transmissoes/${c.id}/simular-resposta`, { texto: 'SAIR' }); toast(`${r.nome || fmtTel(r.telefone)} pediu para sair (simulação)`); }
      else { await s.ui.post(`/api/transmissoes/${c.id}/${nome}`, nome === 'iniciar' ? { agendarPara: null } : {}); if (msg) toast(msg); }
    } catch (e) { toast(e.message); }
    await atualizarCampanha(c.id);
    if (!s.timer) abrirCampanha(c.id);
  }
  function vistaCampanha() {
    const c = s.atual;
    if (!c) return [el('div', { class: 'tx-vazio' }, el('span', { text: 'Carregando…' }))];
    const f = c.contagem.funil, tot = c.contagem.total;
    const sub = `${nomeUnidade(c.unidade)} · ${c.canal === 'oficial' ? `API oficial · ${c.mensagem.modelo?.nome || ''}` : 'API não oficial'}${c.modo === 'automatico' ? ' · automática' : ''}${c.situacao.canalTeste ? ' · WhatsApp de teste' : ''}`;
    const botoes = [];
    if (['rascunho'].includes(c.status)) botoes.push(botao('Continuar editando', () => editar(c), '', ''), botao('Enviar agora', () => acao('iniciar', 'Transmissão começou'), 'leve', IC.enviar));
    if (['enviando', 'agendada', 'aguardando_modelo'].includes(c.status)) botoes.push(botao('Pausar', () => acao('pausar', 'Pausada'), 'leve'));
    if (c.status === 'pausada') botoes.push(botao('Retomar', () => acao('retomar', 'Retomada'), ''), botao('Editar', () => editar(c), 'leve'));
    if (c.status === 'agendada') botoes.push(botao('Enviar agora', () => acao('iniciar', 'Transmissão começou'), 'leve', IC.enviar));
    if (c.situacao.canalTeste && f.enviadas > 0) botoes.push(botao('Simular resposta', () => acao('simular'), 'leve', IC.resp), botao('Simular "SAIR"', () => acao('simular-sair'), 'leve'));
    botoes.push(botao('Duplicar', () => acao('duplicar'), 'leve'));
    if (!['concluida', 'cancelada', 'rascunho'].includes(c.status)) botoes.push(botao('Cancelar', () => acao('cancelar', 'Cancelada'), 'perigo'));
    if (['rascunho', 'concluida', 'cancelada', 'aguardando_modelo'].includes(c.status)) botoes.push(botao('Apagar', () => acao('apagar'), 'perigo'));
    const cab = el('div', { class: 'tx-cab-camp' },
      el('div', { class: 'linha1' }, el('button', { type: 'button', class: 'tx-redondo', html: IC.voltar, 'aria-label': 'Voltar para a lista', onclick: voltarLista }), el('h1', { class: 'titulo-grande', text: c.nome }), pilula(STATUS, c.status)),
      el('div', { class: 'tx-nota', text: sub }),
      el('div', { class: 'tx-acoes' }, ...botoes));
    const avisos = [];
    if (c.erro) avisos.push(el('div', { class: 'tx-alerta coral', html: IC.aviso }, el('div', {}, el('b', { text: 'Atenção' }), el('span', { text: c.erro }))));
    if (c.status === 'enviando' && !c.situacao.dentroDaJanela) avisos.push(el('div', { class: 'tx-alerta', html: IC.aviso }, el('div', {}, el('b', { text: 'Fora do horário permitido' }), el('span', { text: `Os envios continuam sozinhos às ${c.envio.janelaInicio}h${c.envio.domingo ? '' : ' (domingo não envia)'}.` }))));
    if (c.status === 'aguardando_modelo') avisos.push(el('div', { class: 'tx-alerta', html: IC.aviso }, el('div', {}, el('b', { text: 'Esperando a Meta aprovar o modelo' }), el('span', { text: 'A Sintonia confere a cada poucos minutos e começa sozinha quando for aprovado.' }))));
    const estado = c.status === 'enviando' ? [c.situacao.proximoEnvio ? `Próximo envio às ${new Date(c.situacao.proximoEnvio).toLocaleTimeString('pt-BR', { timeZone: 'America/Bahia' })}` : f.fila ? 'Enviando…' : 'Aguardando novas pessoas', `${fmtN(c.situacao.enviadosHojeNoNumero)} de ${fmtN(c.envio.limiteDia)} hoje neste número`].join(' · ') : c.status === 'agendada' && c.agendadaPara ? `Começa ${quando(c.agendadaPara)}` : '';
    const etapa = (rot, n, base, cor) => el('div', { class: 'tx-etapa' }, el('span', { text: rot }), el('div', { class: 'tx-trilho' }, el('i', { style: `width:${base ? Math.max(1, pct(n, base)) : 0}%;background:${cor}` })), el('b', {}, fmtN(n), el('small', { text: base ? `${pct(n, base)}%` : '' })));
    const funil = el('div', { class: 'tx-bloco' },
      el('h2', {}, 'Funil da transmissão', el('small', { text: estado || `${fmtN(tot)} pessoa(s) no total` })),
      el('div', { class: 'tx-funil', 'aria-label': 'Funil' },
        etapa('Na fila', f.fila, tot, '#8b8d98'), etapa('Enviadas', f.enviadas, tot, '#7cc4ff'), etapa('Entregues', f.entregues, tot, '#1a8be0'),
        etapa('Lidas', f.lidas, tot, '#19c3a6'), etapa('Responderam', f.responderam, tot, '#0ffcbe')),
      el('div', { class: 'tx-mini' }, el('span', {}, el('b', { text: fmtN(f.falharam) }), ' falharam'), el('span', {}, el('b', { text: fmtN(f.descadastraram) }), ' pediram para sair'), el('span', {}, el('b', { text: fmtN(f.puladas) }), ' puladas'), c.canal === 'nao_oficial' && !c.situacao.canalTeste ? el('span', { text: 'API não oficial não avisa entrega/leitura: conta só envio e resposta.' }) : null));
    return [cab, ...avisos, el('div', { class: 'tx-grade duas' }, el('div', { style: 'display:grid;gap:16px;min-width:0' }, funil, grafico(c.serie), destinatarios()), el('div', { class: 'tx-lado', style: 'display:grid;gap:16px' }, previaMensagem({ ...c, _imagemUrl: null }), resumoCampanha(c)))];
  }
  function resumoCampanha(c) {
    const e = c.envio;
    return el('div', { class: 'tx-bloco' }, el('h2', { text: 'Configuração' }), el('div', { class: 'tx-resumo' },
      ...[['Horário', `${e.janelaInicio}h às ${e.janelaFim}h${e.domingo ? ', inclusive domingo' : ''}`],
        ['Ritmo', c.canal === 'oficial' ? `${e.porMinuto}/min` : `${e.intervaloMin}–${e.intervaloMax} s, pausa ${e.pausaMin} min a cada ${e.pausaCada}`],
        ['Limite', `${fmtN(e.limiteDia)} por dia`], ['Criada', `${quando(c.criadaEm)}${c.criadaPor ? ` por ${c.criadaPor}` : ''}`]].map(([a, b]) => el('div', {}, el('span', { text: a }), el('b', { text: b })))));
  }
  function grafico(serie) {
    const pts = serie?.pontos || [];
    const bloco = el('div', { class: 'tx-bloco tx-grafico' }, el('h2', {}, 'Ao longo do tempo', el('small', { text: `Acumulado por ${serie?.passo || 'minuto'}` })));
    if (!pts.length) { bloco.append(el('div', { class: 'tx-nota', text: 'O gráfico aparece quando os primeiros envios saírem.' })); return bloco; }
    const acum = { enviadas: 0, lidas: 0, responderam: 0 };
    const linhas = pts.map((p) => { acum.enviadas += p.enviadas; acum.lidas += p.lidas; acum.responderam += p.responderam; return { ...acum }; });
    if (linhas.length === 1) linhas.unshift({ enviadas: 0, lidas: 0, responderam: 0 });
    const W = 600, H = 170, max = Math.max(1, ...linhas.map((l) => l.enviadas));
    const xy = (i, v) => [linhas.length === 1 ? 0 : (i / (linhas.length - 1)) * W, H - (v / max) * (H - 12) - 4];
    const curva = (k) => linhas.map((l, i) => xy(i, l[k])).reduce((d, [x, y], i, a) => { if (!i) return `M${x},${y}`; const [px, py] = a[i - 1]; const cx = (px + x) / 2; return `${d} C${cx},${py} ${cx},${y} ${x},${y}`; }, '');
    const cores = { enviadas: '#1a8be0', lidas: '#19c3a6', responderam: '#0ffcbe' };
    const area = `${curva('enviadas')} L${W},${H} L0,${H} Z`;
    bloco.append(el('div', { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Envios, leituras e respostas acumulados"><defs><linearGradient id="tx-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a8be0" stop-opacity=".35"/><stop offset="1" stop-color="#1a8be0" stop-opacity="0"/></linearGradient></defs>
      <line x1="0" y1="${H - 4}" x2="${W}" y2="${H - 4}" stroke="currentColor" stroke-opacity=".15"/>
      <path d="${area}" fill="url(#tx-g)"/>
      ${Object.entries(cores).map(([k, c]) => `<path d="${curva(k)}" fill="none" stroke="${c}" stroke-width="2.5" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 4px ${c}88)"/>`).join('')}</svg>` }),
      el('div', { class: 'leg' }, ...Object.entries({ enviadas: 'Enviadas', lidas: 'Lidas', responderam: 'Responderam' }).map(([k, t]) => el('span', {}, el('i', { style: `background:${cores[k]}` }), `${t}: ${fmtN(linhas.at(-1)[k])}`))));
    return bloco;
  }
  function destinatarios() {
    const d = s.dest, c = s.atual;
    const filtros = [['', 'Todas'], ['fila', 'Na fila'], ['enviada', 'Enviadas'], ['entregue', 'Entregues'], ['lida', 'Lidas'], ['respondeu', 'Responderam'], ['falhou', 'Falharam'], ['descadastrou', 'Saíram']];
    const busca = el('input', { type: 'search', placeholder: 'Buscar nome ou telefone', value: s.destBusca, 'data-foco': 'busca-dest', 'aria-label': 'Buscar destinatário', oninput: (e) => { s.destBusca = e.target.value; clearTimeout(s.timerBusca); s.timerBusca = setTimeout(() => atualizarCampanha(c.id), 300); } });
    return el('div', { class: 'tx-bloco' },
      el('h2', {}, 'Destinatários', el('small', { text: d ? `${fmtN(d.total)} pessoa(s)${s.destFiltro ? ' neste filtro' : ''}` : '' })),
      el('div', { class: 'tx-filtros', role: 'group', 'aria-label': 'Filtrar' }, ...filtros.map(([k, t]) => el('button', { type: 'button', class: 'tx-chip', 'aria-pressed': String(s.destFiltro === k), onclick: () => { s.destFiltro = k; atualizarCampanha(c.id); } }, t))),
      el('label', { class: 'tx-campo' }, busca),
      d?.itens?.length ? el('div', {}, ...d.itens.map((x) => {
        const momento = x.respondeuEm || x.lidaEm || x.entregueEm || x.enviadaEm || x.falhouEm || x.entrouEm;
        return el('div', { class: 'tx-dest' },
          el('div', { style: 'min-width:0' }, el('b', { text: x.nome || fmtTel(x.telefone) }), el('small', { text: x.erro ? `⚠ ${x.erro}` : `${fmtTel(x.telefone)}${x.origem && x.origem !== 'publico' ? ` · ${x.origem}` : ''}` })),
          el('div', { class: 'dir' }, pilula(STATUS_DEST, x.status), el('small', { text: quando(momento) }), x.conversaId ? el('button', { type: 'button', class: 'tx-link', onclick: () => s.ui.abrir(x.conversaId) }, 'Abrir conversa') : null));
      })) : el('div', { class: 'tx-nota', text: d ? 'Ninguém aqui ainda.' : 'Carregando…' }));
  }

  // ---------- modelos da Meta ----------
  async function abrirModelos(criar = false) {
    const voltarPara = s.vista === 'assistente' ? 'assistente' : 'lista';
    pararTimer();
    s.vista = 'modelos'; s.modelosVolta = voltarPara;
    s.modelosUnidade = s.rasc?.unidade || s.numeros[0]?.unidade || 'norte';
    if (criar === true) s.novoModelo = modeloVazio();
    desenhar();
    await carregarModelos(s.modelosUnidade, true);
    desenhar();
    s.timer = setInterval(async () => { if (s.vista !== 'modelos' || !s.modelos.some((m) => m.status === 'pendente')) return; await carregarModelos(s.modelosUnidade, true); desenharSemPerderFoco(); }, 15000);
  }
  const modeloVazio = () => ({ nome: '', categoria: 'MARKETING', idioma: 'pt_BR', cab: 'nenhum', cabTexto: '', cabImagem: null, cabUrl: null, corpo: 'Olá, {{1}}! A Black Friday da Império chegou: progressiva com 30% de desconto até domingo. Quer garantir seu horário?', exemplos: ['Maria'], rodape: 'Responda SAIR para não receber mais', botoes: [{ tipo: 'resposta', texto: 'Quero agendar' }, { tipo: 'resposta', texto: 'Parar promoções' }], erro: '', ocupado: false });
  function vistaModelos() {
    const n = s.numeros.find((x) => x.unidade === s.modelosUnidade);
    const cor = { aprovado: 'menta', pendente: 'ambar', rejeitado: 'coral', pausado: 'ambar', desativado: 'coral' };
    const nomeStatus = { aprovado: 'Aprovado', pendente: 'Em análise', rejeitado: 'Rejeitado', pausado: 'Pausado', desativado: 'Desativado' };
    const cab = el('div', { class: 'tx-cab-camp' }, el('div', { class: 'linha1' }, el('button', { type: 'button', class: 'tx-redondo', html: IC.voltar, 'aria-label': 'Voltar', onclick: () => { if (s.modelosVolta === 'assistente' && s.rasc) { carregarModelos(s.rasc.unidade).then(() => ir('assistente')); } else voltarLista(); } }), el('h1', { class: 'titulo-grande', text: 'Modelos da Meta' })),
      el('div', { class: 'tx-nota', text: 'API oficial: para começar conversa (fora das 24 h), só com modelo aprovado. Crie aqui, a Meta analisa (minutos a horas) e o status atualiza sozinho.' }),
      el('div', { class: 'tx-acoes' }, el('label', { class: 'tx-campo', style: 'min-width:220px' }, select(s.modelosUnidade, s.numeros.map((x) => [x.unidade, x.nome]), async (v) => { s.modelosUnidade = v; await carregarModelos(v, true); desenhar(); }, { 'aria-label': 'Unidade' })),
        botao('Atualizar status', async () => { await carregarModelos(s.modelosUnidade, true); desenhar(); toast('Status atualizado'); }, 'leve pequeno'),
        !s.novoModelo ? botao('Novo modelo', () => { s.novoModelo = modeloVazio(); desenhar(); }, 'pequeno', IC.mais) : null));
    const partes = [cab];
    if (n?.tipo === 'teste') partes.push(el('div', { class: 'tx-alerta', html: IC.aviso }, el('div', {}, el('b', { text: 'WhatsApp de teste' }), el('span', { text: 'Sem a API oficial configurada, a aprovação é simulada (aprova em ~10 s). Com o WABA ID e o token em Conexões, vai de verdade para a Meta.' }))));
    if (s.modelosErro) partes.push(el('div', { class: 'tx-erro', text: s.modelosErro }));
    const lista = el('div', { class: 'tx-bloco' }, el('h2', { text: `Modelos (${s.modelos.length})` }),
      s.modelos.length ? el('div', { style: 'display:grid;gap:10px' }, ...s.modelos.map((m) => el('div', { class: 'tx-modelo' },
        el('div', { class: 't' }, el('b', { text: m.nome }), el('span', { class: `tx-pilula ${cor[m.status] || 'cinza'}`, text: `${nomeStatus[m.status] || m.status}${m.simulado ? ' (teste)' : ''}` })),
        el('div', { class: 'tx-nota', text: `${m.categoria === 'MARKETING' ? 'Marketing' : m.categoria === 'UTILITY' ? 'Utilidade' : m.categoria} · ${m.idioma} · ${m.variaveis} variável(is)${m.cabecalho ? ` · cabeçalho ${m.cabecalho.formato === 'IMAGE' ? 'imagem' : 'texto'}` : ''}` }),
        el('p', { text: m.corpo }),
        m.status === 'rejeitado' ? el('div', { class: 'tx-erro', text: `Motivo: ${m.motivo || 'não informado pela Meta'}` }) : null))) : el('div', { class: 'tx-nota', text: 'Nenhum modelo nesta unidade ainda.' }));
    if (s.novoModelo) partes.push(el('div', { class: 'tx-grade duas' }, formModelo(), el('div', { class: 'tx-lado', style: 'display:grid;gap:16px' }, previaModelo(), lista)));
    else partes.push(lista);
    return partes;
  }
  function previaModelo() {
    const m = s.novoModelo;
    return balao({ texto: preencherModelo(m.corpo, m.exemplos), cabecalho: m.cab === 'texto' ? m.cabTexto : null, imagem: m.cab === 'imagem' ? m.cabUrl : null, rodape: m.rodape, botoes: m.botoes.map((b) => b.texto).filter(Boolean) });
  }
  function formModelo() {
    const m = s.novoModelo;
    const nv = contarVars(m.corpo);
    while (m.exemplos.length < nv) m.exemplos.push('');
    const redesenhar = () => { const z = s.caixa.querySelector('.tx-lado .tx-zap'); if (z) z.replaceWith(previaModelo()); };
    const imgInput = el('input', { type: 'file', accept: 'image/jpeg,image/png', hidden: '', onchange: async (e) => { const f = e.target.files?.[0]; if (!f) return; m.cabUrl = URL.createObjectURL(f); m.cabImagem = { mimetype: f.type, base64: await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.readAsDataURL(f); }) }; desenhar(); } });
    const botoes = m.botoes.map((b, i) => el('div', { class: 'tx-var', style: 'grid-template-columns:110px minmax(0,1fr) auto' },
      select(b.tipo, [['resposta', 'Resposta'], ['url', 'Link (URL)']], (v) => { b.tipo = v; desenhar(); }, { 'aria-label': `Tipo do botão ${i + 1}` }),
      el('div', { style: 'display:grid;gap:6px' }, el('input', { type: 'text', maxlength: '25', value: b.texto, placeholder: 'Texto do botão', 'data-foco': `bt${i}`, 'aria-label': `Texto do botão ${i + 1}`, oninput: (e) => { b.texto = e.target.value; redesenhar(); } }),
        b.tipo === 'url' ? el('input', { type: 'url', value: b.url || '', placeholder: 'https://…', 'data-foco': `bu${i}`, 'aria-label': `Link do botão ${i + 1}`, oninput: (e) => { b.url = e.target.value; } }) : null),
      el('button', { type: 'button', class: 'tx-redondo', 'aria-label': 'Tirar botão', text: '×', onclick: () => { m.botoes.splice(i, 1); desenhar(); } })));
    return el('div', { class: 'tx-bloco' },
      el('h2', {}, 'Novo modelo', el('small', { text: 'Dicas para aprovar: diga quem é a loja, não use só variável no começo/fim, ofereça a opção de sair (botão "Parar promoções" ou rodapé), e escolha Marketing para promoções.' })),
      el('div', { class: 'tx-campos' },
        campo('Nome (minúsculas e _)', el('input', { type: 'text', maxlength: '60', value: m.nome, placeholder: 'black_friday_2026', 'data-foco': 'mnome', oninput: (e) => { m.nome = e.target.value; } })),
        campo('Categoria', select(m.categoria, [['MARKETING', 'Marketing (promoção)'], ['UTILITY', 'Utilidade (aviso, lembrete)']], (v) => { m.categoria = v; })),
        campo('Idioma', select(m.idioma, [['pt_BR', 'Português (BR)']], (v) => { m.idioma = v; }))),
      campo('Cabeçalho', select(m.cab, [['nenhum', 'Sem cabeçalho'], ['texto', 'Texto'], ['imagem', 'Imagem']], (v) => { m.cab = v; desenhar(); })),
      m.cab === 'texto' ? campo('Texto do cabeçalho', el('input', { type: 'text', maxlength: '60', value: m.cabTexto, 'data-foco': 'mcab', oninput: (e) => { m.cabTexto = e.target.value; redesenhar(); } })) : null,
      m.cab === 'imagem' ? el('label', { class: 'tx-botao leve pequeno', role: 'button', tabindex: '0', html: IC.imagem }, el('span', { text: m.cabImagem ? 'Trocar imagem de exemplo' : 'Imagem de exemplo (para a análise)' }), imgInput) : null,
      campo('Corpo', el('textarea', { rows: '6', maxlength: '1024', text: m.corpo, 'data-foco': 'mcorpo', oninput: (e) => { m.corpo = e.target.value; if (contarVars(m.corpo) !== nv) desenharSemPerderFoco(); else redesenhar(); } })),
      el('div', { class: 'tx-acoes' }, botao(`+ Variável {{${nv + 1}}}`, () => { m.corpo = `${m.corpo} {{${nv + 1}}}`; m.exemplos.push(''); desenhar(); }, 'leve pequeno')),
      nv ? el('div', { class: 'tx-vars' }, el('div', { class: 'tx-nota', text: 'Exemplo de cada variável (a Meta pede para analisar):' }), ...m.exemplos.slice(0, nv).map((x, i) => el('div', { class: 'tx-var', style: 'grid-template-columns:52px minmax(0,1fr)' }, el('b', { text: `{{${i + 1}}}` }), el('input', { type: 'text', value: x, placeholder: i === 0 ? 'Maria' : 'exemplo', 'data-foco': `mex${i}`, 'aria-label': `Exemplo da variável ${i + 1}`, oninput: (e) => { m.exemplos[i] = e.target.value; redesenhar(); } })))) : null,
      campo('Rodapé (opcional)', el('input', { type: 'text', maxlength: '60', value: m.rodape, 'data-foco': 'mrod', oninput: (e) => { m.rodape = e.target.value; redesenhar(); } })),
      el('h2', { text: 'Botões' }), ...botoes,
      m.botoes.length < 3 ? el('div', { class: 'tx-acoes' }, botao('+ Botão', () => { m.botoes.push({ tipo: 'resposta', texto: '' }); desenhar(); }, 'leve pequeno')) : null,
      m.erro ? el('div', { class: 'tx-erro', text: m.erro }) : null,
      el('div', { class: 'tx-acoes cheio' }, botao(m.ocupado ? 'Enviando…' : 'Enviar para aprovação', enviarModelo, '', IC.enviar, { 'aria-disabled': String(m.ocupado) }), botao('Descartar', () => { s.novoModelo = null; desenhar(); }, 'leve')));
  }
  async function enviarModelo() {
    const m = s.novoModelo;
    m.erro = ''; m.ocupado = true; desenhar();
    const nv = contarVars(m.corpo);
    try {
      const corpo = {
        unidade: s.modelosUnidade, nome: m.nome, categoria: m.categoria, idioma: m.idioma, corpo: m.corpo, exemplos: m.exemplos.slice(0, nv).map((x) => x.trim() || 'exemplo'),
        ...(m.rodape.trim() ? { rodape: m.rodape.trim() } : {}),
        cabecalho: m.cab === 'texto' && m.cabTexto.trim() ? { tipo: 'texto', texto: m.cabTexto.trim() } : m.cab === 'imagem' && m.cabImagem ? { tipo: 'imagem', ...m.cabImagem } : null,
        botoes: m.botoes.filter((b) => b.texto.trim()).map((b) => (b.tipo === 'url' ? { tipo: 'url', texto: b.texto.trim(), url: (b.url || '').trim() } : { tipo: 'resposta', texto: b.texto.trim() })),
      };
      const novo = await s.ui.post('/api/transmissoes/modelos', corpo);
      toast(`Modelo "${novo.nome}" enviado para aprovação`);
      s.novoModelo = null;
      await carregarModelos(s.modelosUnidade);
    } catch (e) { m.erro = e.message; m.ocupado = false; }
    desenhar();
  }

  async function voltarLista() { pararTimer(); s.vista = 'lista'; desenhar(); await carregarLista(); if (s.vista === 'lista') desenhar(); }

  // ---------- desenho ----------
  function desenhar() {
    if (!s.caixa) return;
    const partes = s.vista === 'assistente' && s.rasc ? vistaAssistente() : s.vista === 'campanha' ? vistaCampanha() : s.vista === 'modelos' ? vistaModelos() : vistaLista();
    s.caixa.replaceChildren(el('div', { class: 'tx' }, ...partes));
  }

  window.SintoniaTelas.transmissoes = {
    async desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa; s.ui = ui;
      caixa.classList.add('tx-caixa');
      if (ui.estado.eu && !ui.ehGestor(ui.estado.eu)) {
        caixa.replaceChildren(ui.el('div', { class: 'tx' }, ui.el('h1', { class: 'titulo-grande', text: 'Transmissões' }), ui.el('div', { class: 'tx-vazio' }, ui.el('b', { text: 'Só para a gestão' }), ui.el('span', { text: 'Transmissões ficam com a gerência, a direção e a administração.' }))));
        return;
      }
      if (s.vista === 'campanha' && s.atual) { abrirCampanha(s.atual.id); return; }
      if (s.vista !== 'lista') { desenhar(); return; }
      desenhar();
      await Promise.all([carregarLista(), carregarApoio()]);
      desenhar();
    },
  };
})();
