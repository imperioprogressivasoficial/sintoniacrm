/* empresa-conta: menu Empresa (public/telas/empresa.js) — dados da empresa, unidades, produtos e serviços,
 * tabelas de preço e documentos, em abas na largura toda, nos cartões de vidro do Dashboard (claro e escuro).
 * Registra window.SintoniaTelas.empresa = { desenhar(caixa, ui), irAba(aba) } e as peças comuns em
 * window.SintoniaEC (usadas também por telas/conta.js). Dados: /api/empresa/cadastro, /api/empresa/logo,
 * /api/unidades, /api/produtos, /api/tabelas-preco, /api/documentos (src/empresa/cadastro-rotas.ts).
 * Também troca os nomes das unidades do app (ui.UNIDADE) pelos do cadastro. Texto do servidor entra por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ec-caixa.ec-caixa { padding: 14px 16px 120px; gap: 0; color-scheme: light;
    --ec-cartao: #ffffff; --ec-borda: rgba(8, 36, 63, .07); --ec-sombra: 0 4px 16px rgba(8, 36, 63, .06); --ec-campo: #f3f6fa; --ec-campo-borda: rgba(8, 36, 63, .1);
    --ec-g1: #12d6a3; --ec-g2: #3aa0ff; --ec-seg: #ffffff; --ec-seg-on: #08243f; --ec-seg-on-txt: #fff; --ec-forte: #08243f; --ec-forte-txt: #fff;
    --ec-ic: #106ebe; --ec-ic-fundo: rgba(16, 110, 190, .1); --ec-bom: #0b7a5a; --ec-bom-fundo: #e3fbf3; --ec-ruim: #b42318; --ec-ruim-fundo: #fdecec; --ec-aviso: #8a6100; --ec-aviso-fundo: #fff6db; }
  html[data-tema="escuro"] .ec-caixa.ec-caixa { color-scheme: dark; background: radial-gradient(140% 60% at 50% 0%, #0d3a66 0%, #071c33 55%, #05162a 100%) #05162a;
    --texto: #eaf3fc; --sub: #8fb1d1;
    --ec-cartao: rgba(255, 255, 255, .05); --ec-borda: rgba(255, 255, 255, .08); --ec-sombra: none; --ec-campo: rgba(255, 255, 255, .06); --ec-campo-borda: rgba(255, 255, 255, .12);
    --ec-g1: #0ffcbe; --ec-seg: rgba(255, 255, 255, .07); --ec-seg-on: #eaf3fc; --ec-seg-on-txt: #08243f; --ec-forte: #eaf3fc; --ec-forte-txt: #08243f;
    --ec-ic: #7cc4ff; --ec-ic-fundo: rgba(124, 196, 255, .14); --ec-bom: #0ffcbe; --ec-bom-fundo: rgba(15, 252, 190, .14); --ec-ruim: #ff9a9c; --ec-ruim-fundo: rgba(255, 122, 122, .14); --ec-aviso: #f5c84a; --ec-aviso-fundo: rgba(245, 184, 0, .14); }
  @media (min-width: 761px) { .ec-caixa.ec-caixa { padding: 22px 28px 40px; } }
  .ec { width: 100%; min-width: 0; display: grid; gap: 16px; align-content: start; color: var(--texto); }
  .ec button, .ec input, .ec select, .ec textarea { font-family: inherit; }
  .ec :focus-visible { outline: 2px solid var(--ec-g2); outline-offset: 2px; }
  .ec svg.ec-i { width: 18px; height: 18px; display: block; flex: none; }
  .ec-topo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
  .ec-topo .ec-tit { flex: 1 1 260px; min-width: 0; display: grid; gap: 2px; }
  .ec-topo h1 { margin: 0; font-size: 26px; letter-spacing: -.01em; }
  .ec-topo p { margin: 0; color: var(--sub); font-size: 14px; }
  .ec-logo-topo { width: 48px; height: 48px; border-radius: 14px; flex: none; object-fit: contain; background: var(--ec-cartao); box-shadow: inset 0 0 0 1px var(--ec-borda); }
  .ec-abas { position: relative; display: flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--ec-seg); box-shadow: inset 0 0 0 1px var(--ec-borda), var(--ec-sombra); overflow-x: auto; scrollbar-width: none; max-width: 100%; justify-self: start; }
  .ec-abas::-webkit-scrollbar { display: none; }
  .ec-abas button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 34px; padding: 0 14px; display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; font-size: 13.5px; font-weight: 500; color: var(--sub); white-space: nowrap; }
  .ec-abas button:hover { color: var(--texto); }
  .ec-abas button[aria-selected="true"] { background: var(--ec-seg-on); color: var(--ec-seg-on-txt); font-weight: 700; }
  .ec-abas button svg { width: 16px; height: 16px; }
  .ec-grade { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); align-items: start; }
  .ec-grade.ec-2 { grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr)); }
  .ec-c { position: relative; min-width: 0; border-radius: 22px; padding: 16px; display: grid; gap: 12px; align-content: start; background: var(--ec-cartao); box-shadow: inset 0 0 0 1px var(--ec-borda), var(--ec-sombra); }
  @media (min-width: 761px) { .ec-c { padding: 18px 20px; } }
  .ec-c::after { content: ''; position: absolute; left: 18px; right: 18px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, transparent, var(--ec-g1), var(--ec-g2), transparent); opacity: .5; pointer-events: none; }
  .ec-c.ec-largo { grid-column: 1 / -1; }
  .ec-c h2 { margin: 0; font-size: 16.5px; display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ec-c h2 .ec-h2t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .ec-ico { width: 34px; height: 34px; border-radius: 12px; flex: none; display: grid; place-items: center; color: var(--ec-ic); background: var(--ec-ic-fundo); }
  .ec-ico svg { width: 18px; height: 18px; }
  .ec-sub { margin: 0; font-size: 13px; color: var(--sub); line-height: 1.45; }
  .ec-form { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
  .ec-form .ec-cheio { grid-column: 1 / -1; }
  .ec-campo { display: grid; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--sub); min-width: 0; }
  .ec-campo small { font-weight: 400; font-size: 12px; }
  .ec-in { box-sizing: border-box; width: 100%; min-width: 0; font: inherit; font-size: 15px; font-weight: 400; color: var(--texto); background: var(--ec-campo); border: 1px solid var(--ec-campo-borda); border-radius: 12px; padding: 10px 12px; min-height: 42px; }
  textarea.ec-in { min-height: 84px; resize: vertical; line-height: 1.45; }
  .ec-in:disabled { opacity: .7; }
  .ec-in[aria-invalid="true"] { border-color: var(--ec-ruim); }
  .ec-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .ec-acoes.ec-fim { justify-content: flex-end; }
  .ec-bt { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; padding: 0 15px; border-radius: 999px; font-size: 13.5px; font-weight: 600; white-space: nowrap;
    background: var(--ec-seg); color: var(--texto); box-shadow: inset 0 0 0 1px var(--ec-borda), var(--ec-sombra); }
  .ec-bt:hover { filter: brightness(.98); }
  .ec-bt.forte { background: var(--ec-forte); color: var(--ec-forte-txt); box-shadow: none; }
  .ec-bt.azul { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 8px 18px rgba(16, 110, 190, .25); }
  .ec-bt.perigo { color: var(--ec-ruim); }
  .ec-bt.mini { min-height: 32px; padding: 0 11px; font-size: 12.5px; }
  .ec-bt.icone { width: 36px; padding: 0; min-height: 36px; }
  .ec-bt[disabled] { opacity: .45; cursor: default; }
  .ec-bt svg { width: 16px; height: 16px; }
  .ec-pil { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; background: var(--ec-campo); color: var(--sub); }
  .ec-pil.bom { background: var(--ec-bom-fundo); color: var(--ec-bom); }
  .ec-pil.ruim { background: var(--ec-ruim-fundo); color: var(--ec-ruim); }
  .ec-pil.aviso { background: var(--ec-aviso-fundo); color: var(--ec-aviso); }
  .ec-pil.azul { background: var(--ec-ic-fundo); color: var(--ec-ic); }
  .ec-linhas { display: grid; }
  .ec-linha { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 2px; border-top: 1px solid var(--ec-borda); font-size: 14px; min-width: 0; }
  .ec-linha:first-child { border-top: 0; }
  .ec-linha > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ec-linha > b { flex: none; font-variant-numeric: tabular-nums; }
  .ec-grande { font-size: 26px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
  .ec-erro { color: var(--ec-ruim); font-size: 13px; margin: 0; min-height: 1em; }
  .ec-aviso { margin: 0; padding: 10px 13px; border-radius: 14px; font-size: 13px; line-height: 1.45; background: var(--ec-aviso-fundo); color: var(--ec-aviso); }
  .ec-info { margin: 0; padding: 10px 13px; border-radius: 14px; font-size: 13px; line-height: 1.45; background: var(--ec-ic-fundo); color: var(--texto); }
  .ec-chave { position: relative; display: inline-flex; flex: none; width: 44px; height: 26px; cursor: pointer; }
  .ec-chave input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
  .ec-chave i { width: 100%; height: 100%; border-radius: 999px; background: var(--ec-campo-borda); transition: background .15s ease; }
  .ec-chave i::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .15s ease; }
  .ec-chave input:checked + i { background: #16a34a; }
  .ec-chave input:checked + i::after { transform: translateX(18px); }
  .ec-chave input:focus-visible + i { outline: 2px solid var(--ec-g2); outline-offset: 2px; }
  .ec-chave input:disabled + i { opacity: .5; }
  .ec-opcao { display: flex; align-items: center; gap: 12px; justify-content: space-between; padding: 6px 0; min-width: 0; }
  .ec-opcao { flex-wrap: wrap; }
  .ec-opcao > span { display: grid; gap: 2px; min-width: 0; font-size: 14.5px; font-weight: 600; flex: 1 1 180px; }
  .ec-opcao > span small { font-size: 12.5px; color: var(--sub); font-weight: 400; }
  .ec-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 12px; background: var(--ec-campo); flex-wrap: nowrap; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .ec-seg button { all: unset; cursor: pointer; box-sizing: border-box; min-height: 34px; padding: 0 13px; border-radius: 9px; font-size: 13.5px; font-weight: 600; color: var(--sub); display: inline-flex; align-items: center; }
  .ec-seg button[aria-pressed="true"] { background: var(--ec-cartao); color: var(--texto); box-shadow: 0 1px 4px rgba(8, 36, 63, .12), inset 0 0 0 1px var(--ec-borda); }
  .ec-horario { display: grid; gap: 6px; }
  .ec-dia { display: grid; grid-template-columns: 74px 46px 1fr; gap: 8px; align-items: center; font-size: 14px; }
  .ec-dia .ec-horas { display: flex; gap: 6px; align-items: center; min-width: 0; color: var(--sub); font-size: 13px; }
  .ec-dia .ec-horas input { min-height: 36px; padding: 6px 8px; width: 100%; max-width: 120px; }
  .ec-dia .ec-fechado { color: var(--sub); font-size: 13px; }
  .ec-ferramentas { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .ec-busca { flex: 1 1 220px; display: flex; align-items: center; gap: 8px; padding: 0 12px; min-height: 40px; border-radius: 999px; background: var(--ec-cartao); box-shadow: inset 0 0 0 1px var(--ec-borda), var(--ec-sombra); min-width: 0; }
  .ec-busca input { all: unset; flex: 1; min-width: 0; font-size: 14.5px; color: var(--texto); }
  .ec-busca svg { width: 17px; height: 17px; color: var(--sub); flex: none; }
  .ec-sel { box-sizing: border-box; min-height: 40px; padding: 0 12px; border-radius: 999px; font: inherit; font-size: 13.5px; color: var(--texto); background: var(--ec-cartao); border: 0; box-shadow: inset 0 0 0 1px var(--ec-borda), var(--ec-sombra); max-width: 100%; }
  .ec-tabela { width: 100%; border-collapse: collapse; font-size: 14px; }
  .ec-tabela th { text-align: left; font-size: 11.5px; font-weight: 700; color: var(--sub); text-transform: uppercase; letter-spacing: .06em; padding: 10px 10px; border-bottom: 1px solid var(--ec-borda); white-space: nowrap; }
  .ec-tabela td { padding: 10px; border-bottom: 1px solid var(--ec-borda); vertical-align: middle; }
  .ec-tabela tbody tr { cursor: pointer; }
  .ec-tabela tbody tr:hover { background: var(--ec-campo); }
  .ec-tabela tbody tr:last-child td { border-bottom: 0; }
  .ec-tabela td.ec-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ec-tabela .ec-nome { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ec-tabela .ec-nome div { display: grid; gap: 2px; min-width: 0; }
  .ec-tabela .ec-nome b { font-weight: 600; }
  .ec-tabela .ec-nome small { color: var(--sub); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
  .ec-tabela tr.ec-inativo td { opacity: .55; }
  .ec-foto { width: 40px; height: 40px; border-radius: 11px; flex: none; object-fit: cover; background: var(--ec-campo); display: grid; place-items: center; color: var(--sub); overflow: hidden; }
  .ec-foto svg { width: 18px; height: 18px; }
  .ec-foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ec-lista-cel { display: none; }
  @media (max-width: 760px) { .ec-so-pc { display: none !important; } .ec-lista-cel { display: grid; gap: 10px; } }
  .ec-item { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--ec-cartao); box-shadow: inset 0 0 0 1px var(--ec-borda), var(--ec-sombra); min-width: 0; }
  .ec-item > div { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .ec-item b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ec-item small { font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ec-item .ec-preco { font-weight: 700; font-variant-numeric: tabular-nums; flex: none; }
  .ec-item.ec-inativo { opacity: .6; }
  .ec-doc { flex-wrap: wrap; }
  @media (max-width: 760px) { .ec-doc > div:nth-child(2) { flex: 1 1 calc(100% - 60px); } .ec-doc > .ec-acoes { width: 100%; justify-content: flex-end; } }
  .ec-vazio { display: grid; justify-items: center; text-align: center; gap: 8px; padding: 28px 16px; }
  .ec-vazio .ec-ico { width: 48px; height: 48px; border-radius: 16px; }
  .ec-vazio .ec-ico svg { width: 24px; height: 24px; }
  .ec-vazio b { font-size: 16px; }
  .ec-vazio p { margin: 0; color: var(--sub); font-size: 13.5px; max-width: 460px; line-height: 1.5; }
  .ec-un-topo { display: flex; align-items: flex-start; gap: 10px; }
  .ec-un-topo > div { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .ec-un-topo b { font-size: 16.5px; }
  .ec-drop { border: 1.5px dashed var(--ec-campo-borda); border-radius: 18px; padding: 22px 16px; display: grid; justify-items: center; gap: 8px; text-align: center; color: var(--sub); font-size: 13.5px; }
  .ec-drop.sobre { border-color: var(--ec-g2); background: var(--ec-ic-fundo); }
  .ec-drop b { color: var(--texto); font-size: 15px; }
  .ec-doc-ic { width: 42px; height: 42px; border-radius: 12px; flex: none; display: grid; place-items: center; font-size: 10.5px; font-weight: 800; letter-spacing: .03em; color: #fff; background: #64748b; }
  .ec-logo { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .ec-logo-img { width: 76px; height: 76px; border-radius: 20px; display: grid; place-items: center; background: var(--ec-campo); overflow: hidden; color: var(--sub); flex: none; }
  .ec-logo-img img { width: 100%; height: 100%; object-fit: contain; }
  .ec-logo-img svg { width: 30px; height: 30px; }
  .ec-barra-salvar { position: sticky; bottom: 12px; z-index: 3; display: flex; gap: 10px; align-items: center; justify-content: flex-end; flex-wrap: wrap; padding: 10px 12px; border-radius: 18px; background: var(--ec-cartao); box-shadow: inset 0 0 0 1px var(--ec-borda), 0 10px 30px rgba(8, 36, 63, .14); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  html[data-tema="escuro"] .ec-barra-salvar { background: rgba(11, 42, 71, .92); }
  .ec-barra-salvar span { flex: 1; min-width: 160px; font-size: 13px; color: var(--sub); }
  @media (max-width: 760px) { .ec-barra-salvar { bottom: calc(86px + env(safe-area-inset-bottom)); } }
  /* janela (editar produto, unidade, tabela, documento) */
  .ec-dlg { border: 0; padding: 0; border-radius: 24px; width: min(640px, calc(100vw - 24px)); max-height: calc(100dvh - 40px); background: var(--painel, #fff); color: var(--texto); box-shadow: 0 30px 80px rgba(0, 0, 0, .35); }
  .ec-dlg { --ec-cartao: #ffffff; --ec-borda: rgba(8, 36, 63, .08); --ec-sombra: none; --ec-campo: #f1f5f9; --ec-campo-borda: rgba(8, 36, 63, .14); --ec-g1: #12d6a3; --ec-g2: #3aa0ff;
    --ec-seg: #ffffff; --ec-forte: #08243f; --ec-forte-txt: #fff; --ec-ic: #106ebe; --ec-ic-fundo: rgba(16, 110, 190, .1); --ec-ruim: #b42318; --ec-ruim-fundo: #fdecec; --ec-aviso: #8a6100; --ec-aviso-fundo: #fff6db; --ec-bom: #0b7a5a; --ec-bom-fundo: #e3fbf3; }
  html[data-tema="escuro"] .ec-dlg { background: #0b2a47; color-scheme: dark; --texto: #eaf3fc; --sub: #8fb1d1; --ec-cartao: rgba(255, 255, 255, .06); --ec-borda: rgba(255, 255, 255, .1); --ec-campo: rgba(255, 255, 255, .07); --ec-campo-borda: rgba(255, 255, 255, .14);
    --ec-g1: #0ffcbe; --ec-seg: rgba(255, 255, 255, .08); --ec-forte: #eaf3fc; --ec-forte-txt: #08243f; --ec-ic: #7cc4ff; --ec-ic-fundo: rgba(124, 196, 255, .14); --ec-ruim: #ff9a9c; --ec-ruim-fundo: rgba(255, 122, 122, .14); --ec-aviso: #f5c84a; --ec-aviso-fundo: rgba(245, 184, 0, .14); --ec-bom: #0ffcbe; --ec-bom-fundo: rgba(15, 252, 190, .14); }
  .ec-dlg::backdrop { background: rgba(4, 16, 30, .45); }
  .ec-dlg form { display: grid; gap: 14px; padding: 20px; max-height: calc(100dvh - 40px); overflow-y: auto; box-sizing: border-box; }
  .ec-dlg h2 { margin: 0; font-size: 19px; }
  .ec-dlg .ec-rodape { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; position: sticky; bottom: -20px; margin: 0 -20px -20px; padding: 12px 20px 16px; background: inherit; border-top: 1px solid var(--ec-borda, rgba(8,36,63,.08)); }
  .ec-dlg .ec-rodape .ec-esq { margin-right: auto; }
  .ec-dlg .ec-in { background: var(--ec-campo, #f3f6fa); }
  @media (max-width: 760px) { .ec-dlg { width: 100vw; max-width: 100vw; margin: auto 0 0; border-radius: 24px 24px 0 0; max-height: 92dvh; } .ec-dlg form { max-height: 92dvh; padding-bottom: calc(20px + env(safe-area-inset-bottom)); } }
  .ec-itens-tab { display: grid; gap: 0; max-height: 46vh; overflow-y: auto; border-radius: 14px; box-shadow: inset 0 0 0 1px var(--ec-borda, rgba(8,36,63,.08)); }
  .ec-itens-tab .ec-it { display: grid; grid-template-columns: 1fr auto 120px; gap: 10px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--ec-borda, rgba(8,36,63,.08)); font-size: 14px; }
  .ec-itens-tab .ec-it:first-child { border-top: 0; }
  .ec-itens-tab .ec-it span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ec-itens-tab .ec-it small { color: var(--sub); font-variant-numeric: tabular-nums; }
  .ec-itens-tab .ec-it input { min-height: 34px; padding: 6px 8px; text-align: right; }
  .ec-carregando { color: var(--sub); font-size: 14px; padding: 8px 2px; }
  .ec-atalhos { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
  .ec-atalho { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; background: var(--ec-campo); min-width: 0; }
  .ec-atalho:hover { filter: brightness(.97); }
  .ec-atalho div { display: grid; gap: 2px; min-width: 0; }
  .ec-atalho b { font-size: 14.5px; }
  .ec-atalho small { font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  const S = (d) => `<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    empresa: S('<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4"/>'),
    geral: S('<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>'),
    unidade: S('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    produto: S('<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
    preco: S('<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
    doc: S('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    equipe: S('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>'),
    acesso: S('<rect x="4" y="11" width="16" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    conexao: S('<path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v4"/>'),
    plano: S('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/>'),
    relogio: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    contato: S('<path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/>'),
    mais: S('<path d="M12 5v14M5 12h14"/>'),
    busca: S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    lapis: S('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    lixo: S('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    cima: S('<path d="m6 15 6-6 6 6"/>'),
    baixo: S('<path d="m6 9 6 6 6-6"/>'),
    baixar: S('<path d="M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
    enviar: S('<path d="M12 21V9M7 14l5-5 5 5M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/>'),
    abrir: S('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    imagem: S('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>'),
    seta: S('<path d="m9 6 6 6-6 6"/>'),
    copiar: S('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  };
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const FUSOS = [
    ['America/Sao_Paulo', 'Brasília (SP, RJ, MG, Sul, GO, DF)'], ['America/Bahia', 'Bahia'], ['America/Fortaleza', 'Ceará, RN, PB, PI, MA'], ['America/Recife', 'Pernambuco'],
    ['America/Maceio', 'Alagoas e Sergipe'], ['America/Belem', 'Pará (leste) e Amapá'], ['America/Araguaina', 'Tocantins'], ['America/Manaus', 'Amazonas'], ['America/Cuiaba', 'Mato Grosso'],
    ['America/Campo_Grande', 'Mato Grosso do Sul'], ['America/Porto_Velho', 'Rondônia'], ['America/Boa_Vista', 'Roraima'], ['America/Rio_Branco', 'Acre'], ['America/Noronha', 'Fernando de Noronha'],
    ['Europe/Lisbon', 'Portugal (Lisboa)'],
  ];
  const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
  const CATEGORIA_DOC = { contrato: 'Contrato', tabela: 'Tabela', catalogo: 'Catálogo', apresentacao: 'Apresentação', manual: 'Manual', outro: 'Outro' };
  const COR_DOC = { PDF: '#dc2626', Imagem: '#0891b2', Word: '#2563eb', Excel: '#16a34a', Planilha: '#16a34a', PowerPoint: '#ea580c', Documento: '#2563eb', Texto: '#64748b', ZIP: '#7c3aed' };
  const brl = (v) => (v == null ? 'Sob consulta' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const tamanho = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const duracao = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let ui;
  const el = (...a) => ui.el(...a);
  /** replaceChildren sem os vazios (null viraria o texto "null"). */
  const encher = (c, ...f) => c.replaceChildren(...f.flat().filter((x) => x != null && x !== false));
  const css = () => { if (!document.getElementById('ec-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'ec-css', textContent: CSS })); };
  const souDirecao = () => ['admin', 'direcao'].includes(ui?.estado?.eu?.papel);
  const souGestao = () => ['admin', 'direcao', 'gerente'].includes(ui?.estado?.eu?.papel);

  // ------------------------------------------------------------ peças comuns (também usadas por telas/conta.js)
  const ico = (k) => el('span', { class: 'ec-ico', html: IC[k] || k });
  function cartao(icone, titulo, ...filhos) {
    const extra = filhos.length && filhos[0] && filhos[0].nodeType === undefined && !Array.isArray(filhos[0]) ? filhos.shift() : {};
    return el('section', { class: 'ec-c' + (extra.largo ? ' ec-largo' : '') }, el('h2', {}, ico(icone), el('span', { class: 'ec-h2t', text: titulo }), extra.direita || null), ...filhos.flat().filter(Boolean));
  }
  const entrada = (props = {}) => { const i = el(props.tag || 'input', { class: 'ec-in', ...props, tag: undefined }); if (props.value != null && props.tag === 'textarea') i.value = props.value; return i; };
  const campo = (rotulo, controle, o = {}) => el('label', { class: 'ec-campo' + (o.cheio ? ' ec-cheio' : '') }, document.createTextNode(rotulo), controle, o.dica ? el('small', { text: o.dica }) : null);
  function chave(ligada, aoMudar, rotulo, desligada) {
    const i = el('input', { type: 'checkbox', role: 'switch', 'aria-label': rotulo || '' });
    i.checked = Boolean(ligada); if (desligada) i.disabled = true;
    i.addEventListener('change', () => aoMudar?.(i.checked, i));
    return el('label', { class: 'ec-chave' }, i, el('i'));
  }
  const opcao = (titulo, sub, controle) => el('div', { class: 'ec-opcao' }, el('span', {}, document.createTextNode(titulo), sub ? el('small', { text: sub }) : null), controle);
  function seg(opcoes, valor, aoMudar, rotulo) {
    const caixa = el('div', { class: 'ec-seg', role: 'group', 'aria-label': rotulo || '' });
    const marcar = (v) => caixa.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
    for (const [v, nome] of opcoes) caixa.append(el('button', { type: 'button', 'data-v': v, text: nome, onclick: () => { marcar(v); caixa.valor = v; aoMudar?.(v); } }));
    caixa.valor = valor; marcar(valor);
    return caixa;
  }
  const botao = (texto, onclick, cls = '', icone) => { const b = el('button', { class: 'ec-bt ' + cls, type: 'button', onclick }); if (icone) b.insertAdjacentHTML('afterbegin', IC[icone] || icone); if (texto) b.append(texto); return b; };
  const vazio = (icone, titulo, texto, acao) => el('div', { class: 'ec-vazio' }, ico(icone), el('b', { text: titulo }), el('p', { text: texto }), acao || null);
  function abas(lista, atual, aoTrocar) {
    const barra = el('div', { class: 'ec-abas', role: 'tablist' }, ...lista.map(([id, nome, icone]) => {
      const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(id === atual), onclick: () => aoTrocar(id) });
      const svg = IC[icone] || (String(icone || '').startsWith('<svg') ? icone : null);
      if (svg) b.insertAdjacentHTML('afterbegin', svg);
      b.append(nome);
      return b;
    }));
    // A aba escolhida sempre à vista (no celular a barra rola de lado).
    requestAnimationFrame(() => { const sel = barra.querySelector('[aria-selected="true"]'); if (sel && barra.scrollWidth > barra.clientWidth) barra.scrollLeft = Math.max(0, sel.offsetLeft - 24); });
    return barra;
  }
  /** Janela por cima (no celular, sobe de baixo). montar(form, fechar) devolve os botões do rodapé. */
  function janela(titulo, montar) {
    const d = el('dialog', { class: 'ec-dlg' });
    const form = el('form', { method: 'dialog', novalidate: '' });
    const pôr = form.append.bind(form);
    form.append = (...f) => pôr(...f.flat().filter((x) => x != null && x !== false));
    const fechar = () => { d.close(); d.remove(); };
    d.addEventListener('cancel', (e) => { e.preventDefault(); fechar(); });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    form.append(el('h2', { text: titulo }));
    const rodape = montar(form, fechar) || [];
    form.append(el('div', { class: 'ec-rodape' }, ...rodape.filter(Boolean)));
    form.addEventListener('submit', (e) => e.preventDefault());
    d.append(form);
    (document.querySelector('.casca') || document.body).append(d);
    d.showModal();
    return { d, fechar };
  }
  /** Arquivo → base64 (sem o "data:...;base64,"). */
  const lerBase64 = (arq) => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => falha(new Error('Não deu para ler o arquivo.')); r.readAsDataURL(arq); });
  /** Imagem reduzida (lado maior até `lado` px) em JPEG, ou PNG quando tem transparência e pediu `png`. */
  async function reduzirImagem(arq, lado = 512, png = false) {
    const bmp = await createImageBitmap(arq);
    const f = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const tela = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * f), height: Math.round(bmp.height * f) });
    const c = tela.getContext('2d');
    if (!png) { c.fillStyle = '#fff'; c.fillRect(0, 0, tela.width, tela.height); }
    c.drawImage(bmp, 0, 0, tela.width, tela.height);
    const tipo = png ? 'image/png' : 'image/jpeg';
    return { base64: tela.toDataURL(tipo, 0.86).split(',')[1], mimetype: tipo };
  }
  const escolherArquivo = (accept, aoEscolher) => { const i = el('input', { type: 'file', accept }); i.addEventListener('change', () => { const f = i.files?.[0]; if (f) aoEscolher(f); }); i.click(); };
  /** Editor do horário da semana. Devolve { el, valor() }. */
  function editorHorario(horario, desligado) {
    const linhas = (horario || []).map((d) => ({ ...d }));
    while (linhas.length < 7) linhas.push({ dia: linhas.length, aberto: false, abre: '09:00', fecha: '18:00' });
    const caixa = el('div', { class: 'ec-horario' });
    const desenhar = () => {
      caixa.replaceChildren(...linhas.map((d) => {
        const abre = entrada({ type: 'time', value: d.abre, 'aria-label': `Abre ${DIAS[d.dia]}` });
        const fecha = entrada({ type: 'time', value: d.fecha, 'aria-label': `Fecha ${DIAS[d.dia]}` });
        if (desligado) { abre.disabled = true; fecha.disabled = true; }
        abre.addEventListener('change', () => { d.abre = abre.value || d.abre; });
        fecha.addEventListener('change', () => { d.fecha = fecha.value || d.fecha; });
        const horas = d.aberto ? el('div', { class: 'ec-horas' }, abre, document.createTextNode('às'), fecha) : el('span', { class: 'ec-fechado', text: 'Fechado' });
        return el('div', { class: 'ec-dia' }, el('b', { text: DIAS_CURTOS[d.dia] }), chave(d.aberto, (v) => { d.aberto = v; desenhar(); }, `Aberto ${DIAS[d.dia]}`, desligado), horas);
      }));
      if (!desligado) caixa.append(el('div', { class: 'ec-acoes' }, botao('Copiar segunda para os dias úteis', () => { const s = linhas[1]; for (const d of linhas.slice(2, 6)) Object.assign(d, { aberto: s.aberto, abre: s.abre, fecha: s.fecha }); desenhar(); }, 'mini', 'copiar')));
    };
    desenhar();
    return { el: caixa, valor: () => linhas.map((d) => ({ dia: d.dia, aberto: d.aberto, abre: d.abre, fecha: d.fecha })) };
  }
  const resumoHorario = (h) => {
    if (!h) return 'Segue o horário da empresa';
    const abertos = h.filter((d) => d.aberto);
    if (!abertos.length) return 'Fechado todos os dias';
    const grupos = new Map();
    for (const d of abertos) { const k = `${d.abre}–${d.fecha}`; grupos.set(k, [...(grupos.get(k) || []), DIAS_CURTOS[d.dia]]); }
    return [...grupos].map(([k, ds]) => `${ds.join(', ')} ${k}`).join(' · ');
  };
  const camposEndereco = (e = {}, desligado) => {
    const c = {
      cep: entrada({ value: e.cep || '', inputmode: 'numeric', maxlength: '9', placeholder: '00000-000', autocomplete: 'postal-code' }),
      logradouro: entrada({ value: e.logradouro || '', maxlength: '160', autocomplete: 'address-line1' }),
      numero: entrada({ value: e.numero || '', maxlength: '20' }),
      complemento: entrada({ value: e.complemento || '', maxlength: '80', autocomplete: 'address-line2' }),
      bairro: entrada({ value: e.bairro || '', maxlength: '80' }),
      cidade: entrada({ value: e.cidade || '', maxlength: '80', autocomplete: 'address-level2' }),
      uf: el('select', { class: 'ec-in', 'aria-label': 'Estado' }, el('option', { value: '', text: '—' }), ...UFS.map((u) => el('option', { value: u, text: u }))),
    };
    c.uf.value = e.uf || '';
    c.cep.addEventListener('input', () => { const d = c.cep.value.replace(/\D/g, '').slice(0, 8); c.cep.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; });
    if (desligado) Object.values(c).forEach((x) => { x.disabled = true; });
    return {
      campos: [campo('CEP', c.cep), campo('Rua / avenida', c.logradouro, { cheio: true }), campo('Número', c.numero), campo('Complemento', c.complemento), campo('Bairro', c.bairro), campo('Cidade', c.cidade), campo('Estado', c.uf)],
      valor: () => Object.fromEntries(Object.entries(c).map(([k, x]) => [k, x.value.trim()])),
    };
  };

  window.SintoniaEC = { IC, css: () => css(), cartao, entrada, campo, chave, opcao, seg, botao, vazio, abas, janela, lerBase64, reduzirImagem, escolherArquivo, editorHorario, ico, brl, iniciar: (u) => { ui = u; css(); } };

  // ------------------------------------------------------------ nomes das unidades no app
  let unidadesCache = null;
  async function lerUnidades(forcar) {
    if (unidadesCache && !forcar) return unidadesCache;
    const r = await ui.api('/api/unidades').catch(() => null);
    if (r?.unidades) {
      unidadesCache = r;
      // O app inteiro lê ui.UNIDADE na hora de desenhar: trocar aqui muda os nomes em toda parte.
      for (const u of r.unidades) if (ui.UNIDADE) ui.UNIDADE[u.id] = u.nome;
      /* unidades: o app inteiro (selects, filtros, telas) refaz a lista na hora */
      if (forcar) ui.carregarUnidades?.();
    }
    return unidadesCache || { unidades: [], podeEditar: false };
  }

  // ------------------------------------------------------------ tela
  const ABAS = [
    ['geral', 'Visão geral', 'geral'],
    ['dados', 'Dados da empresa', 'empresa'],
    ['unidades', 'Unidades', 'unidade'],
    ['produtos', 'Produtos e serviços', 'produto'],
    ['precos', 'Tabelas de preço', 'preco'],
    ['documentos', 'Documentos', 'doc'],
  ];
  let aba = 'geral';
  let caixa = null;
  let cadastro = null;
  const filtroProd = { busca: '', tipo: '', categoria: '', inativos: false };
  let filtroDoc = '';

  function irAba(a) { if (ABAS.some(([id]) => id === a)) aba = a; marcarMenu(); }
  function marcarMenu() {
    const naTela = document.getElementById('v-empresa')?.classList.contains('ativa');
    let mudou = false;
    document.querySelectorAll('[data-emp]').forEach((b) => {
      const deve = naTela && b.dataset.emp === aba;
      if (deve !== (b.getAttribute('aria-current') === 'page')) { mudou = true; deve ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'); }
    });
    // A trilha do topo ("Empresa › Unidades") é montada antes de o item mudar: refaz quando muda.
    const v = window.Sintonia?.ui?.estado?.vista;
    if (mudou && v && v !== 'funil') window.SintoniaMenu?.vistaMudou?.(v);
  }

  async function desenhar(c, u) {
    ui = u; caixa = c; css();
    caixa.classList.add('ec-caixa');
    marcarMenu();
    if (!caixa.firstChild) caixa.replaceChildren(el('p', { class: 'ec-carregando', text: 'Carregando…' }));
    cadastro = await ui.api('/api/empresa/cadastro').catch(() => null);
    if (!caixa.isConnected) return;
    const corpo = el('div', { class: 'ec-corpo', style: 'display:grid;gap:16px;min-width:0' });
    const logo = cadastro?.logoEm ? el('img', { class: 'ec-logo-topo', src: `/api/empresa/logo?v=${cadastro.logoEm}`, alt: '' }) : null;
    caixa.replaceChildren(el('div', { class: 'ec' },
      el('div', { class: 'ec-topo' }, logo, el('div', { class: 'ec-tit' }, el('h1', { text: cadastro?.nome || 'Empresa' }), el('p', { text: 'Dados, unidades, o que a empresa vende, preços e documentos num lugar só.' })),
        window.SintoniaTopoGrupo ? window.SintoniaTopoGrupo() : null),
      abas(ABAS, aba, (a) => { aba = a; marcarMenu(); desenhar(caixa, ui); }),
      corpo));
    const telas = { geral: telaGeral, dados: telaDados, unidades: telaUnidades, produtos: telaProdutos, precos: telaPrecos, documentos: telaDocumentos };
    try { await telas[aba](corpo); } catch (x) { encher(corpo, el('p', { class: 'ec-erro', text: x.message || 'Não deu para carregar agora.' })); }
  }
  const redesenhar = () => caixa && desenhar(caixa, ui);

  // ------------------------------------------------------------ visão geral
  async function telaGeral(corpo) {
    encher(corpo, el('p', { class: 'ec-carregando', text: 'Carregando…' }));
    const [uns, prods, docs, eq, sit, pl] = await Promise.all([
      lerUnidades(true), ui.api('/api/produtos').catch(() => null), ui.api('/api/documentos').catch(() => null),
      souGestao() ? ui.api('/api/equipe').catch(() => null) : null, ui.api('/api/situacao').catch(() => null), souDirecao() ? ui.api('/api/planos').catch(() => null) : null,
    ]);
    const d = cadastro?.dados || {};
    const linha = (rot, valor, cls) => el('div', { class: 'ec-linha' }, el('span', { text: rot }), el('b', { class: cls || '', text: valor }));
    const ir = (a) => () => { aba = a; marcarMenu(); redesenhar(); };
    const faltam = [!d.cnpj && 'CNPJ', !d.telefone && !d.whatsapp && 'telefone', !d.endereco?.cidade && 'endereço'].filter(Boolean);
    const secDados = cartao('empresa', 'Dados da empresa',
      el('div', { class: 'ec-linhas' }, linha('Nome', cadastro?.nome || '—'), linha('CNPJ', d.cnpj || 'Não informado'), linha('Cidade', [d.endereco?.cidade, d.endereco?.uf].filter(Boolean).join(' / ') || 'Não informada'), linha('Fuso', (FUSOS.find(([f]) => f === d.fuso) || [d.fuso, d.fuso])[1] || '—')),
      faltam.length ? el('p', { class: 'ec-aviso', text: `Falta preencher: ${faltam.join(', ')}.` }) : null,
      el('div', { class: 'ec-acoes' }, botao(cadastro?.podeEditar ? 'Editar dados' : 'Ver dados', ir('dados'), '', 'lapis')));
    const lu = uns.unidades || [];
    const pessoas = eq?.pessoas || [];
    const conversas = ui.estado?.conversas || [];
    const secUn = cartao('unidade', `Unidades (${lu.filter((u) => u.ativa).length} ativas)`,
      lu.length ? el('div', { class: 'ec-linhas' }, ...lu.map((u) => {
        const n = pessoas.filter((p) => p.ativo && p.unidades?.includes(u.id)).length;
        const c = conversas.filter((k) => k.unidade === u.id).length;
        return el('div', { class: 'ec-linha' }, el('span', { text: u.nome }), u.ativa ? el('small', { class: 'ec-sub', text: `${eq ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'} · ` : ''}${c} ${c === 1 ? 'conversa' : 'conversas'}` }) : el('span', { class: 'ec-pil', text: 'Desativada' }));
      })) : el('p', { class: 'ec-sub', text: 'Nenhuma unidade cadastrada.' }),
      el('div', { class: 'ec-acoes' }, botao('Ver unidades', ir('unidades'), '', 'seta')));
    const lp = prods?.produtos || [];
    const ativos = lp.filter((p) => p.ativo);
    const secProd = cartao('produto', 'Produtos e serviços',
      el('div', { class: 'ec-grande', text: String(ativos.length) }),
      el('p', { class: 'ec-sub', text: [plural(ativos.filter((p) => p.tipo === 'servico').length, 'serviço', 'serviços'), plural(ativos.filter((p) => p.tipo === 'produto').length, 'produto', 'produtos'), lp.length > ativos.length ? plural(lp.length - ativos.length, 'desativado', 'desativados') : ''].filter(Boolean).join(' · ') }),
      el('div', { class: 'ec-acoes' }, botao('Abrir catálogo', ir('produtos'), '', 'seta')));
    const ld = docs?.documentos || [];
    const secDocs = cartao('doc', 'Documentos',
      el('div', { class: 'ec-grande', text: String(ld.length) }),
      el('p', { class: 'ec-sub', text: ld.length ? `Último: ${ld[0].nome}` : 'Contrato, tabela de preços, catálogo em PDF: guarde aqui para a equipe achar.' }),
      el('div', { class: 'ec-acoes' }, botao('Abrir documentos', ir('documentos'), '', 'seta')));
    const s = sit || {};
    const atalhos = cartao('conexao', 'Equipe, conexões e plano', { largo: true },
      el('div', { class: 'ec-atalhos' },
        souGestao() ? atalho('acesso', 'Atendentes e acessos', eq ? plural(pessoas.filter((p) => p.ativo).length, 'pessoa ativa', 'pessoas ativas') : 'Pessoas, perfis e permissões', () => ui.mostrar('acessos')) : null,
        souDirecao() ? atalho('conexao', 'Conexões', `WhatsApp: ${s.numerosReais ? `${s.numerosReais} conectado${s.numerosReais === 1 ? '' : 's'}` : 'nenhum'} · IA ${s.iaLigada ? 'ligada' : 'desligada'}`, () => { location.href = '/conexoes'; }) : null,
        souDirecao() ? atalho('plano', 'Plano e uso da IA', pl?.plano ? `${pl.plano.nome} · ${pl.plano.precoTexto || ''}` : 'Plano, limites e créditos', () => ui.mostrar('planos')) : null,
        atalho('equipe', 'Minha conta', 'Perfil, preferências e notificações', () => ui.mostrar('conta'))));
    encher(corpo, el('div', { class: 'ec-grade' }, secDados, secUn, secProd, secDocs, atalhos));
  }
  const atalho = (icone, titulo, sub, onclick) => el('button', { class: 'ec-atalho', type: 'button', onclick }, ico(icone), el('div', {}, el('b', { text: titulo }), el('small', { text: sub })));

  // ------------------------------------------------------------ dados da empresa
  async function telaDados(corpo) {
    const pode = Boolean(cadastro?.podeEditar);
    const d = cadastro?.dados || {};
    const des = !pode;
    const f = {
      nome: entrada({ value: cadastro?.nome || '', maxlength: '80', autocomplete: 'organization' }),
      razaoSocial: entrada({ value: d.razaoSocial || '', maxlength: '160' }),
      cnpj: entrada({ value: d.cnpj || '', inputmode: 'numeric', maxlength: '18', placeholder: '00.000.000/0000-00' }),
      inscricaoEstadual: entrada({ value: d.inscricaoEstadual || '', maxlength: '30' }),
      segmento: entrada({ value: d.segmento || '', maxlength: '80', placeholder: 'Ex.: salão de beleza, clínica, loja' }),
      sobre: entrada({ tag: 'textarea', value: d.sobre || '', maxlength: '1000', placeholder: 'Uma frase sobre a empresa (aparece para a IA e nos relatórios).' }),
      telefone: entrada({ value: d.telefone || '', inputmode: 'tel', maxlength: '30', autocomplete: 'tel' }),
      whatsapp: entrada({ value: d.whatsapp || '', inputmode: 'tel', maxlength: '30' }),
      email: entrada({ value: d.email || '', type: 'email', maxlength: '200', autocomplete: 'email' }),
      site: entrada({ value: d.site || '', maxlength: '200', placeholder: 'www.suaempresa.com.br' }),
      instagram: entrada({ value: d.instagram || '', maxlength: '80', placeholder: '@suaempresa' }),
      fuso: el('select', { class: 'ec-in' }, ...FUSOS.map(([v, n]) => el('option', { value: v, text: n }))),
    };
    if (d.fuso && !FUSOS.some(([v]) => v === d.fuso)) f.fuso.append(el('option', { value: d.fuso, text: d.fuso }));
    f.fuso.value = d.fuso || 'America/Bahia';
    f.cnpj.addEventListener('input', () => {
      const n = f.cnpj.value.replace(/\D/g, '').slice(0, 14);
      f.cnpj.value = n.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
    });
    if (des) Object.values(f).forEach((x) => { x.disabled = true; });
    const end = camposEndereco(d.endereco, des);
    const hor = editorHorario(d.horario, des);
    const erro = el('p', { class: 'ec-erro', role: 'alert' });

    // logo
    const logoImg = el('div', { class: 'ec-logo-img' });
    const pintarLogo = (v) => { logoImg.replaceChildren(); if (v) logoImg.append(el('img', { src: `/api/empresa/logo?v=${v}`, alt: 'Logo da empresa' })); else logoImg.innerHTML = IC.imagem; };
    pintarLogo(cadastro?.logoEm);
    const btLogo = botao(cadastro?.logoEm ? 'Trocar logo' : 'Enviar logo', () => escolherArquivo('image/png,image/jpeg,image/webp', async (arq) => {
      try { const img = await reduzirImagem(arq, 512, arq.type === 'image/png'); const r = await ui.api('/api/empresa/logo', { method: 'PUT', body: JSON.stringify(img) }); cadastro.logoEm = r.logoEm; pintarLogo(r.logoEm); ui.toast('Logo salva ✓'); btTirar.hidden = false; }
      catch (x) { ui.toast(x.message || 'Não deu para usar essa imagem.'); }
    }), '', 'imagem');
    const btTirar = botao('Tirar', async () => { try { await ui.api('/api/empresa/logo', { method: 'DELETE' }); cadastro.logoEm = null; pintarLogo(null); btTirar.hidden = true; } catch (x) { ui.toast(x.message); } }, 'perigo');
    btTirar.hidden = !cadastro?.logoEm;
    const logo = el('div', { class: 'ec-logo' }, logoImg, el('div', { style: 'display:grid;gap:6px' }, el('p', { class: 'ec-sub', text: 'PNG, JPG ou WebP. Aparece no topo do menu e nos documentos.' }), pode ? el('div', { class: 'ec-acoes' }, btLogo, btTirar) : null));

    const secId = cartao('empresa', 'Identificação', { largo: false }, logo,
      el('div', { class: 'ec-form' }, campo('Nome da empresa', f.nome, { cheio: true, dica: 'Aparece no topo do menu, na Conta e nos relatórios.' }), campo('Razão social', f.razaoSocial, { cheio: true }), campo('CNPJ', f.cnpj), campo('Inscrição estadual', f.inscricaoEstadual), campo('Segmento', f.segmento, { cheio: true }), campo('Sobre a empresa', f.sobre, { cheio: true })));
    const secContato = cartao('contato', 'Contato', el('div', { class: 'ec-form' }, campo('Telefone', f.telefone), campo('WhatsApp', f.whatsapp), campo('E-mail', f.email, { cheio: true }), campo('Site', f.site), campo('Instagram', f.instagram)));
    const secEnd = cartao('unidade', 'Endereço da sede', el('div', { class: 'ec-form' }, ...end.campos));
    const secHor = cartao('relogio', 'Fuso e horário de funcionamento', campo('Fuso horário', f.fuso, { dica: 'Vale para lembretes, relatórios e o horário de atendimento.' }), el('p', { class: 'ec-sub', text: 'Horário padrão. Cada unidade pode ter o seu (aba Unidades).' }), hor.el);
    const salvar = botao('Salvar dados', async () => {
      erro.textContent = '';
      const corpoPedido = {
        nome: f.nome.value.trim(),
        dados: { razaoSocial: f.razaoSocial.value, cnpj: f.cnpj.value, inscricaoEstadual: f.inscricaoEstadual.value, segmento: f.segmento.value, sobre: f.sobre.value, telefone: f.telefone.value, whatsapp: f.whatsapp.value, email: f.email.value, site: f.site.value, instagram: f.instagram.value, endereco: end.valor(), fuso: f.fuso.value, horario: hor.valor() },
      };
      if (corpoPedido.nome.length < 2) { erro.textContent = 'O nome precisa de pelo menos 2 letras.'; f.nome.focus(); return; }
      salvar.disabled = true;
      try {
        cadastro = await ui.api('/api/empresa/cadastro', { method: 'PATCH', body: JSON.stringify(corpoPedido) });
        const topo = document.getElementById('lt-empresa'); if (topo && cadastro?.nome) topo.textContent = cadastro.nome;
        caixa.querySelector('.ec-topo h1').textContent = cadastro.nome;
        ui.toast('Dados salvos ✓');
      } catch (x) { erro.textContent = x.message; }
      salvar.disabled = false;
    }, 'azul');
    const quando = cadastro?.atualizadaEm ? `Última mudança: ${ui.quando(cadastro.atualizadaEm)}${cadastro.atualizadaPor ? ' · ' + cadastro.atualizadaPor : ''}` : 'Ainda sem mudanças.';
    encher(corpo, 
      pode ? null : el('p', { class: 'ec-info', text: 'Só a direção e a administração mudam os dados da empresa. Aqui você consulta.' }),
      el('div', { class: 'ec-grade ec-2' }, secId, el('div', { style: 'display:grid;gap:16px;min-width:0' }, secContato, secEnd), secHor),
      pode ? el('div', { class: 'ec-barra-salvar' }, el('span', { text: quando }), erro, salvar) : null);
  }

  // ------------------------------------------------------------ unidades
  async function telaUnidades(corpo) {
    const r = await lerUnidades(true);
    const [eq] = await Promise.all([souGestao() ? ui.api('/api/equipe').catch(() => null) : null]);
    const pessoas = eq?.pessoas || [];
    const conversas = ui.estado?.conversas || [];
    const lista = r.unidades || [];
    const pode = r.podeEditar;
    const mover = async (i, delta) => {
      const ids = lista.map((u) => u.id); const j = i + delta; if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await ui.api('/api/unidades/ordem', { method: 'PUT', body: JSON.stringify({ ids }) }); redesenhar(); } catch (x) { ui.toast(x.message); }
    };
    const cartaoUn = (u, i) => {
      const n = pessoas.filter((p) => p.ativo && p.unidades?.includes(u.id)).length;
      const c = conversas.filter((k) => k.unidade === u.id).length;
      const e = u.dados?.endereco || {};
      const endereco = [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, [e.cidade, e.uf].filter(Boolean).join(' / ')].filter(Boolean).join(' · ');
      return el('section', { class: 'ec-c' },
        el('div', { class: 'ec-un-topo' }, ico('unidade'), el('div', {}, el('b', { text: u.nome }), el('span', { class: 'ec-sub', text: endereco || 'Sem endereço' })),
          el('span', { class: 'ec-pil ' + (u.ativa ? 'bom' : ''), text: u.ativa ? 'Ativa' : 'Desativada' })),
        el('div', { class: 'ec-linhas' },
          el('div', { class: 'ec-linha', style: 'align-items:flex-start' }, el('span', { text: 'Horário', style: 'flex:none' }), el('small', { class: 'ec-sub', style: 'text-align:right', text: resumoHorario(u.dados?.horario) })),
          u.dados?.telefone || u.dados?.whatsapp ? el('div', { class: 'ec-linha' }, el('span', { text: 'Contato' }), el('b', { text: [u.dados.telefone, u.dados.whatsapp].filter(Boolean).join(' · ') })) : null,
          el('div', { class: 'ec-linha' }, el('span', { text: 'Movimento' }), el('small', { class: 'ec-sub', text: `${eq ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'} · ` : ''}${c} ${c === 1 ? 'conversa' : 'conversas'} agora` }))),
        u.fixa ? null : el('p', { class: 'ec-sub', text: 'Ligue um número de WhatsApp a ela em Conexões › WhatsApp e dê acesso às pessoas em Atendentes e acessos.' }),
        pode ? el('div', { class: 'ec-acoes' }, botao('Editar', () => editarUnidade(u), 'mini', 'lapis'),
          botao('', () => mover(i, -1), 'mini icone', 'cima'), botao('', () => mover(i, 1), 'mini icone', 'baixo')) : null);
    };
    encher(corpo, 
      el('div', { class: 'ec-ferramentas' }, el('p', { class: 'ec-sub', style: 'flex:1;min-width:200px', text: pode ? 'Lojas e filiais da empresa. Renomear não mexe nas conversas: o nome muda em todo o app.' : 'Lojas e filiais da empresa. Só a direção e a administração mudam.' }),
        pode ? botao('Nova unidade', () => editarUnidade(null), 'azul', 'mais') : null),
      lista.length ? el('div', { class: 'ec-grade' }, ...lista.map(cartaoUn)) : vazio('unidade', 'Nenhuma unidade ainda', 'Cadastre a primeira loja ou filial.', pode ? botao('Nova unidade', () => editarUnidade(null), 'azul', 'mais') : null));
  }
  function editarUnidade(u) {
    janela(u ? `Editar ${u.nome}` : 'Nova unidade', (form, fechar) => {
      const nome = entrada({ value: u?.nome || '', maxlength: '60', required: '' });
      const ativa = u ? u.ativa : true;
      let ligada = ativa;
      const d = u?.dados || {};
      const end = camposEndereco(d.endereco);
      const tel = entrada({ value: d.telefone || '', inputmode: 'tel', maxlength: '30' });
      const wpp = entrada({ value: d.whatsapp || '', inputmode: 'tel', maxlength: '30' });
      const email = entrada({ value: d.email || '', type: 'email', maxlength: '200' });
      const obs = entrada({ tag: 'textarea', value: d.observacao || '', maxlength: '500', placeholder: 'Ex.: estacionamento no piso G2, entrada pela rua de trás.' });
      /* unidades: nome que vai nas mensagens para os clientes (vazio = o nome) */
      const nomeCli = entrada({ value: d.nomeCliente || '', maxlength: '80', placeholder: 'Ex.: Shopping Barra, piso L2' });
      let proprio = Boolean(d.horario);
      const hor = editorHorario(d.horario || cadastro?.dados?.horario);
      hor.el.hidden = !proprio;
      const erro = el('p', { class: 'ec-erro', role: 'alert' });
      form.append(el('div', { class: 'ec-form' }, campo('Nome', nome, { cheio: true, dica: 'Como aparece no app (filtros, conversas, relatórios).' }), campo('Nome para os clientes', nomeCli, { cheio: true, dica: 'Como a IA e as mensagens chamam a unidade. Vazio = o nome acima.' }), ...end.campos, campo('Telefone', tel), campo('WhatsApp', wpp), campo('E-mail', email, { cheio: true }), campo('Observação', obs, { cheio: true })),
        opcao('Horário próprio', 'Desligado: segue o horário da empresa.', chave(proprio, (v) => { proprio = v; hor.el.hidden = !v; }, 'Horário próprio')), hor.el,
        opcao('Unidade ativa', 'Desativada some das escolhas, mas nada é apagado.', chave(ativa, (v) => { ligada = v; }, 'Unidade ativa')), erro);
      const salvar = botao(u ? 'Salvar' : 'Cadastrar', async () => {
        erro.textContent = '';
        const corpo = { nome: nome.value.trim(), ativa: ligada, endereco: end.valor(), telefone: tel.value.trim(), whatsapp: wpp.value.trim(), email: email.value.trim(), observacao: obs.value.trim(), nomeCliente: nomeCli.value.trim(), horario: proprio ? hor.valor() : null };
        if (corpo.nome.length < 2) { erro.textContent = 'O nome precisa de pelo menos 2 letras.'; nome.focus(); return; }
        salvar.disabled = true;
        try { await ui.api(u ? `/api/unidades/${encodeURIComponent(u.id)}` : '/api/unidades', { method: u ? 'PATCH' : 'POST', body: JSON.stringify(corpo) }); ui.toast(u ? 'Unidade salva ✓' : 'Unidade cadastrada ✓'); fechar(); redesenhar(); ui.atualizar?.(); }
        catch (x) { erro.textContent = x.message; salvar.disabled = false; }
      }, 'azul');
      const apagar = u && !u.fixa ? botao('Apagar', async () => {
        if (!confirm(`Apagar a unidade ${u.nome}?`)) return;
        try { await ui.api(`/api/unidades/${encodeURIComponent(u.id)}`, { method: 'DELETE' }); ui.toast('Unidade apagada.'); fechar(); redesenhar(); } catch (x) { erro.textContent = x.message; }
      }, 'perigo ec-esq', 'lixo') : null;
      setTimeout(() => nome.focus(), 50);
      return [apagar, botao('Cancelar', fechar), salvar];
    });
  }

  // ------------------------------------------------------------ produtos e serviços
  let produtosCache = null;
  async function telaProdutos(corpo) {
    const r = await ui.api('/api/produtos');
    produtosCache = r;
    const pode = r.podeEditar;
    const busca = el('input', { type: 'search', placeholder: 'Buscar por nome, categoria ou código', 'aria-label': 'Buscar produtos', value: filtroProd.busca });
    const tipo = el('select', { class: 'ec-sel', 'aria-label': 'Tipo' }, el('option', { value: '', text: 'Serviços e produtos' }), el('option', { value: 'servico', text: 'Só serviços' }), el('option', { value: 'produto', text: 'Só produtos' }));
    tipo.value = filtroProd.tipo;
    const cat = el('select', { class: 'ec-sel', 'aria-label': 'Categoria' }, el('option', { value: '', text: 'Todas as categorias' }), ...r.categorias.map((c) => el('option', { value: c, text: c })));
    cat.value = r.categorias.includes(filtroProd.categoria) ? filtroProd.categoria : '';
    const inativos = el('label', { class: 'ec-opcao', style: 'gap:8px;padding:0' }, chave(filtroProd.inativos, (v) => { filtroProd.inativos = v; pintar(); }, 'Mostrar desativados'), el('span', { style: 'font-size:13px;font-weight:600;color:var(--sub)', text: 'Desativados' }));
    const area = el('div', { style: 'display:grid;gap:12px;min-width:0' });
    const pintar = () => {
      const q = normal(filtroProd.busca);
      const l = r.produtos.filter((p) => (!filtroProd.tipo || p.tipo === filtroProd.tipo) && (!filtroProd.categoria || p.categoria === filtroProd.categoria) && (filtroProd.inativos || p.ativo) && (!q || normal(`${p.nome} ${p.categoria || ''} ${p.codigo || ''} ${p.descricao || ''}`).includes(q)));
      if (!r.produtos.length) {
        area.replaceChildren(el('section', { class: 'ec-c' }, vazio('produto', 'Nenhum produto ou serviço ainda', 'Cadastre o que a empresa vende: serviços (com duração) e produtos. A IA, o CRM e o Comercial usam estes preços.',
          pode ? el('div', { class: 'ec-acoes' }, botao('Cadastrar o primeiro', () => editarProduto(null), 'azul', 'mais'), botao('Copiar preços do Comercial', importar, '', 'copiar')) : null)));
        return;
      }
      if (!l.length) { area.replaceChildren(el('section', { class: 'ec-c' }, vazio('busca', 'Nada com esse filtro', 'Tente outro nome ou limpe os filtros.'))); return; }
      const fotoDe = (p) => { const f = el('span', { class: 'ec-foto' }); if (p.fotoEm) f.append(el('img', { src: `/api/produtos/${p.id}/foto?v=${p.fotoEm}`, alt: '', loading: 'lazy' })); else f.innerHTML = p.tipo === 'servico' ? IC.relogio : IC.produto; return f; };
      const tabela = el('table', { class: 'ec-tabela' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Nome' }), el('th', { text: 'Tipo' }), el('th', { text: 'Categoria' }), el('th', { text: 'Duração' }), el('th', { style: 'text-align:right', text: 'Preço' }), el('th', { text: '' }))),
        el('tbody', {}, ...l.map((p) => {
          const tr = el('tr', { class: p.ativo ? '' : 'ec-inativo', tabindex: '0', onclick: () => editarProduto(p) },
            el('td', {}, el('div', { class: 'ec-nome' }, fotoDe(p), el('div', {}, el('b', { text: p.nome }), p.descricao || p.codigo ? el('small', { text: [p.codigo, p.descricao].filter(Boolean).join(' · ') }) : null))),
            el('td', {}, el('span', { class: 'ec-pil ' + (p.tipo === 'servico' ? 'azul' : ''), text: p.tipo === 'servico' ? 'Serviço' : 'Produto' })),
            el('td', { text: p.categoria || '—' }), el('td', { text: duracao(p.duracaoMin) || '—' }), el('td', { class: 'ec-num', text: brl(p.preco) }),
            el('td', {}, p.ativo ? null : el('span', { class: 'ec-pil', text: 'Desativado' })));
          tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') editarProduto(p); });
          return tr;
        })));
      const cel = el('div', { class: 'ec-lista-cel' }, ...l.map((p) => el('button', { class: 'ec-item' + (p.ativo ? '' : ' ec-inativo'), type: 'button', onclick: () => editarProduto(p) }, fotoDe(p),
        el('div', {}, el('b', { text: p.nome }), el('small', { text: [p.tipo === 'servico' ? 'Serviço' : 'Produto', p.categoria, duracao(p.duracaoMin), p.ativo ? '' : 'desativado'].filter(Boolean).join(' · ') })),
        el('span', { class: 'ec-preco', text: brl(p.preco) }))));
      area.replaceChildren(el('section', { class: 'ec-c ec-so-pc', style: 'padding:6px 10px' }, el('div', { style: 'overflow-x:auto' }, tabela)), cel,
        el('p', { class: 'ec-sub', text: `${l.length} de ${r.produtos.length} ${r.produtos.length === 1 ? 'item' : 'itens'}.` }));
    };
    busca.addEventListener('input', () => { filtroProd.busca = busca.value; pintar(); });
    tipo.addEventListener('change', () => { filtroProd.tipo = tipo.value; pintar(); });
    cat.addEventListener('change', () => { filtroProd.categoria = cat.value; pintar(); });
    async function importar() {
      try { const x = await ui.api('/api/produtos/importar-comercial', { method: 'POST', body: '{}' }); ui.toast(x.importados ? `${x.importados} ${x.importados === 1 ? 'preço copiado' : 'preços copiados'} do Comercial ✓` : 'Nada novo no Comercial para copiar.'); redesenhar(); }
      catch (e) { ui.toast(e.message); }
    }
    encher(corpo, 
      el('div', { class: 'ec-ferramentas' }, el('label', { class: 'ec-busca' }, el('span', { html: IC.busca, style: 'display:contents' }), busca), tipo, r.categorias.length ? cat : null, inativos,
        pode ? botao('Novo', () => editarProduto(null), 'azul', 'mais') : null),
      pode ? null : el('p', { class: 'ec-info', text: 'Consulta do catálogo. Só a gerência, a direção e a administração mudam produtos e preços.' }),
      area,
      pode && r.produtos.length ? el('div', { class: 'ec-acoes' }, botao('Copiar preços que faltam do Comercial', importar, 'mini', 'copiar')) : null);
    pintar();
  }
  function editarProduto(p) {
    const pode = produtosCache?.podeEditar;
    janela(p ? (pode ? `Editar ${p.nome}` : p.nome) : 'Novo produto ou serviço', (form, fechar) => {
      let tipo = p?.tipo || 'servico';
      const nome = entrada({ value: p?.nome || '', maxlength: '80', required: '' });
      const categoria = entrada({ value: p?.categoria || '', maxlength: '60', list: 'ec-categorias', placeholder: 'Ex.: Cabelo, Home care' });
      const lista = el('datalist', { id: 'ec-categorias' }, ...(produtosCache?.categorias || []).map((c) => el('option', { value: c })));
      const preco = entrada({ value: p?.preco != null ? String(p.preco).replace('.', ',') : '', inputmode: 'decimal', placeholder: '0,00' });
      let consulta = p ? p.preco == null : false;
      preco.disabled = consulta;
      const dur = entrada({ type: 'number', min: '5', max: '1440', step: '5', value: p?.duracaoMin ?? '', placeholder: 'Ex.: 60' });
      const codigo = entrada({ value: p?.codigo || '', maxlength: '40', placeholder: 'Opcional (SKU, código interno)' });
      const desc = entrada({ tag: 'textarea', value: p?.descricao || '', maxlength: '2000', placeholder: 'O que inclui, para quem é, cuidados. A IA usa para responder clientes.' });
      let ativo = p ? p.ativo : true;
      const campoDur = campo('Duração (minutos)', dur, { dica: 'Usada na agenda e para a IA dizer quanto tempo leva.' });
      const tipoSeg = seg([['servico', 'Serviço'], ['produto', 'Produto']], tipo, (v) => { tipo = v; campoDur.hidden = v !== 'servico'; }, 'Tipo');
      campoDur.hidden = tipo !== 'servico';
      // foto
      const foto = el('div', { class: 'ec-logo-img', style: 'width:64px;height:64px;border-radius:16px' });
      let fotoNova = null; let tirarFoto = false;
      const pintarFoto = (src) => { foto.replaceChildren(); if (src) foto.append(el('img', { src, alt: '', style: 'object-fit:cover' })); else foto.innerHTML = IC.imagem; };
      pintarFoto(p?.fotoEm ? `/api/produtos/${p.id}/foto?v=${p.fotoEm}` : null);
      const btFoto = botao('Escolher foto', () => escolherArquivo('image/*', async (arq) => { try { fotoNova = await reduzirImagem(arq, 640); tirarFoto = false; pintarFoto('data:image/jpeg;base64,' + fotoNova.base64); } catch { ui.toast('Não deu para usar essa imagem.'); } }), 'mini', 'imagem');
      const btSemFoto = botao('Tirar', () => { fotoNova = null; tirarFoto = true; pintarFoto(null); }, 'mini perigo');
      const erro = el('p', { class: 'ec-erro', role: 'alert' });
      if (!pode) [nome, categoria, preco, dur, codigo, desc].forEach((x) => { x.disabled = true; });
      form.append(lista,
        el('div', { class: 'ec-logo' }, foto, el('div', { style: 'display:grid;gap:6px' }, el('span', { class: 'ec-sub', text: 'Foto (opcional)' }), pode ? el('div', { class: 'ec-acoes' }, btFoto, btSemFoto) : null)),
        pode ? el('div', {}, tipoSeg) : el('span', { class: 'ec-pil azul', text: tipo === 'servico' ? 'Serviço' : 'Produto' }),
        el('div', { class: 'ec-form' }, campo('Nome', nome, { cheio: true }), campo('Categoria', categoria), campo('Preço (R$)', preco), campoDur, campo('Código', codigo), campo('Descrição', desc, { cheio: true })),
        opcao('Sob consulta', 'Sem preço fixo: a IA diz que o valor é passado no atendimento.', chave(consulta, (v) => { consulta = v; preco.disabled = v; if (!v) preco.focus(); }, 'Sob consulta', !pode)),
        opcao('Ativo', 'Desativado some das escolhas e da IA, mas o histórico fica.', chave(ativo, (v) => { ativo = v; }, 'Ativo', !pode)),
        p?.origem === 'comercial' ? el('p', { class: 'ec-sub', text: 'Veio da tabela de preços do Comercial.' }) : null,
        p?.atualizadoEm ? el('p', { class: 'ec-sub', text: `Última mudança: ${ui.quando(p.atualizadoEm)}${p.atualizadoPor ? ' · ' + p.atualizadoPor : ''}` }) : null, erro);
      if (!pode) return [botao('Fechar', fechar)];
      const salvar = botao(p ? 'Salvar' : 'Cadastrar', async () => {
        erro.textContent = '';
        const valor = consulta ? null : Number(preco.value.replace(/\./g, '').replace(',', '.'));
        if (!consulta && (preco.value.trim() === '' || !Number.isFinite(valor) || valor < 0)) { erro.textContent = 'Informe um preço válido, ou ligue "Sob consulta".'; preco.focus(); return; }
        const corpo = { nome: nome.value.trim(), tipo, categoria: categoria.value.trim() || null, preco: valor, duracaoMin: tipo === 'servico' && dur.value ? Number(dur.value) : null, codigo: codigo.value.trim(), descricao: desc.value.trim(), ativo };
        if (corpo.nome.length < 2) { erro.textContent = 'O nome precisa de pelo menos 2 letras.'; nome.focus(); return; }
        salvar.disabled = true;
        try {
          const r = await ui.api(p ? `/api/produtos/${p.id}` : '/api/produtos', { method: p ? 'PATCH' : 'POST', body: JSON.stringify(corpo) });
          if (fotoNova) await ui.api(`/api/produtos/${r.id}/foto`, { method: 'PUT', body: JSON.stringify(fotoNova) });
          else if (tirarFoto && p?.fotoEm) await ui.api(`/api/produtos/${r.id}/foto`, { method: 'DELETE' });
          ui.toast(p ? 'Salvo ✓' : 'Cadastrado ✓'); fechar(); redesenhar();
        } catch (x) { erro.textContent = x.message; salvar.disabled = false; }
      }, 'azul');
      const apagar = p ? botao('Apagar', async () => {
        if (!confirm(`Apagar "${p.nome}"? Se só quer parar de vender, desative em vez de apagar.`)) return;
        try { await ui.api(`/api/produtos/${p.id}`, { method: 'DELETE' }); ui.toast('Apagado.'); fechar(); redesenhar(); } catch (x) { erro.textContent = x.message; }
      }, 'perigo ec-esq', 'lixo') : null;
      setTimeout(() => nome.focus(), 50);
      return [apagar, botao('Cancelar', fechar), salvar];
    });
  }

  // ------------------------------------------------------------ tabelas de preço
  async function telaPrecos(corpo) {
    const [r, prods, uns] = await Promise.all([ui.api('/api/tabelas-preco'), ui.api('/api/produtos'), lerUnidades()]);
    produtosCache = prods;
    const pode = r.podeEditar;
    const nomeUn = (id) => (uns.unidades || []).find((u) => u.id === id)?.nome || id;
    const hoje = new Date().toISOString().slice(0, 10);
    const situacao = (t) => !t.ativa ? ['Desligada', ''] : t.fim && t.fim < hoje ? ['Encerrada', 'ruim'] : t.inicio && t.inicio > hoje ? ['Começa depois', 'aviso'] : ['Valendo', 'bom'];
    const data = (s) => s ? new Date(s + 'T12:00:00').toLocaleDateString('pt-BR') : '';
    const cartaoT = (t) => {
      const [st, cls] = situacao(t);
      const base = new Map(prods.produtos.map((p) => [p.id, p]));
      const amostra = t.itens.slice(0, 4).map((i) => base.get(i.produtoId)).filter(Boolean);
      return el('section', { class: 'ec-c' },
        el('div', { class: 'ec-un-topo' }, ico('preco'), el('div', {}, el('b', { text: t.nome }), el('span', { class: 'ec-sub', text: t.descricao || (t.unidade ? `Só em ${nomeUn(t.unidade)}` : 'Todas as unidades') })), el('span', { class: 'ec-pil ' + cls, text: st })),
        el('div', { class: 'ec-linhas' },
          el('div', { class: 'ec-linha' }, el('span', { text: 'Onde vale' }), el('b', { text: t.unidade ? nomeUn(t.unidade) : 'Todas as unidades' })),
          el('div', { class: 'ec-linha' }, el('span', { text: 'Quando' }), el('b', { text: t.inicio || t.fim ? [t.inicio ? `de ${data(t.inicio)}` : '', t.fim ? `até ${data(t.fim)}` : ''].filter(Boolean).join(' ') : 'Sem data' })),
          ...amostra.map((p) => el('div', { class: 'ec-linha' }, el('span', { text: p.nome }), el('b', { text: `${brl(t.itens.find((i) => i.produtoId === p.id).preco)}` }))),
          t.itens.length > amostra.length ? el('div', { class: 'ec-linha' }, el('span', { class: 'ec-sub', text: `+ ${t.itens.length - amostra.length} itens` })) : null,
          !t.itens.length ? el('div', { class: 'ec-linha' }, el('span', { class: 'ec-sub', text: 'Nenhum preço diferente ainda.' })) : null),
        el('div', { class: 'ec-acoes' }, botao(pode ? 'Editar' : 'Ver preços', () => editarTabela(t, prods, uns), 'mini', pode ? 'lapis' : 'seta')));
    };
    encher(corpo, 
      el('div', { class: 'ec-ferramentas' }, el('p', { class: 'ec-sub', style: 'flex:1;min-width:220px', text: 'O preço base fica em cada produto. Use tabelas para preços diferentes: promoção com data, preço de uma unidade, parceiro ou convênio.' }),
        pode ? botao('Nova tabela', () => editarTabela(null, prods, uns), 'azul', 'mais') : null),
      r.tabelas.length ? el('div', { class: 'ec-grade' }, ...r.tabelas.map(cartaoT))
        : el('section', { class: 'ec-c' }, vazio('preco', 'Nenhuma tabela de preço', prods.produtos.length ? 'Por enquanto vale o preço base de cada produto.' : 'Cadastre os produtos e serviços primeiro; depois crie tabelas com preços diferentes.',
          pode ? botao(prods.produtos.length ? 'Criar a primeira' : 'Ir para Produtos e serviços', () => (prods.produtos.length ? editarTabela(null, prods, uns) : (aba = 'produtos', marcarMenu(), redesenhar())), 'azul', 'mais') : null)));
  }
  function editarTabela(t, prods, uns) {
    const pode = prods.podeEditar;
    janela(t ? (pode ? `Editar ${t.nome}` : t.nome) : 'Nova tabela de preço', (form, fechar) => {
      const nome = entrada({ value: t?.nome || '', maxlength: '80', placeholder: 'Ex.: Black Friday, Convênio, Unidade Centro' });
      const desc = entrada({ value: t?.descricao || '', maxlength: '500' });
      const unidade = el('select', { class: 'ec-in' }, el('option', { value: '', text: 'Todas as unidades' }), ...(uns.unidades || []).map((u) => el('option', { value: u.id, text: u.nome })));
      unidade.value = t?.unidade || '';
      const inicio = entrada({ type: 'date', value: t?.inicio || '' });
      const fim = entrada({ type: 'date', value: t?.fim || '' });
      let ativa = t ? t.ativa : true;
      const precos = new Map((t?.itens || []).map((i) => [i.produtoId, i.preco]));
      const ativos = prods.produtos.filter((p) => p.ativo || precos.has(p.id));
      const entradas = new Map();
      const itens = el('div', { class: 'ec-itens-tab' }, ...ativos.map((p) => {
        const i = entrada({ inputmode: 'decimal', placeholder: p.preco != null ? String(p.preco).replace('.', ',') : '—', value: precos.has(p.id) ? String(precos.get(p.id)).replace('.', ',') : '', 'aria-label': `Preço de ${p.nome}` });
        if (!pode) i.disabled = true;
        entradas.set(p.id, i);
        return el('div', { class: 'ec-it' }, el('span', { text: p.nome }), el('small', { text: `base ${brl(p.preco)}` }), i);
      }));
      const pct = entrada({ type: 'number', min: '1', max: '90', step: '1', placeholder: '10', style: 'max-width:90px' });
      const desconto = el('div', { class: 'ec-acoes' }, el('span', { class: 'ec-sub', text: 'Desconto de' }), pct, el('span', { class: 'ec-sub', text: '% sobre o preço base' }),
        botao('Aplicar em todos', () => { const v = Number(pct.value); if (!(v > 0 && v < 100)) { pct.focus(); return; } for (const p of ativos) if (p.preco != null) entradas.get(p.id).value = (Math.round(p.preco * (100 - v)) / 100).toFixed(2).replace('.', ','); }, 'mini'));
      const erro = el('p', { class: 'ec-erro', role: 'alert' });
      if (!pode) [nome, desc, unidade, inicio, fim].forEach((x) => { x.disabled = true; });
      form.append(el('div', { class: 'ec-form' }, campo('Nome', nome, { cheio: true }), campo('Descrição', desc, { cheio: true }), campo('Onde vale', unidade, { cheio: true }), campo('Começa em', inicio, { dica: 'Vazio: já vale.' }), campo('Termina em', fim, { dica: 'Vazio: sem fim.' })),
        opcao('Tabela ligada', null, chave(ativa, (v) => { ativa = v; }, 'Tabela ligada', !pode)),
        el('b', { text: 'Preços desta tabela', style: 'font-size:14px' }), el('p', { class: 'ec-sub', text: 'Deixe em branco para usar o preço base.' }),
        pode && ativos.length ? desconto : null,
        ativos.length ? itens : el('p', { class: 'ec-aviso', text: 'Cadastre produtos e serviços para dar preços nesta tabela.' }), erro);
      if (!pode) return [botao('Fechar', fechar)];
      const salvar = botao(t ? 'Salvar' : 'Criar tabela', async () => {
        erro.textContent = '';
        const lista = [];
        for (const [id, i] of entradas) {
          const s = i.value.trim(); if (!s) continue;
          const v = Number(s.replace(/\./g, '').replace(',', '.'));
          if (!Number.isFinite(v) || v < 0) { erro.textContent = 'Confira os preços: só números, como 99,90.'; i.focus(); return; }
          lista.push({ produtoId: id, preco: v });
        }
        const corpo = { nome: nome.value.trim(), descricao: desc.value.trim(), unidade: unidade.value || null, ativa, inicio: inicio.value || null, fim: fim.value || null, itens: lista };
        if (corpo.nome.length < 2) { erro.textContent = 'Dê um nome à tabela.'; nome.focus(); return; }
        salvar.disabled = true;
        try { await ui.api(t ? `/api/tabelas-preco/${t.id}` : '/api/tabelas-preco', { method: t ? 'PUT' : 'POST', body: JSON.stringify(corpo) }); ui.toast('Tabela salva ✓'); fechar(); redesenhar(); }
        catch (x) { erro.textContent = x.message; salvar.disabled = false; }
      }, 'azul');
      const apagar = t ? botao('Apagar', async () => {
        if (!confirm(`Apagar a tabela "${t.nome}"? Os produtos continuam com o preço base.`)) return;
        try { await ui.api(`/api/tabelas-preco/${t.id}`, { method: 'DELETE' }); ui.toast('Tabela apagada.'); fechar(); redesenhar(); } catch (x) { erro.textContent = x.message; }
      }, 'perigo ec-esq', 'lixo') : null;
      return [apagar, botao('Cancelar', fechar), salvar];
    });
  }

  // ------------------------------------------------------------ documentos
  async function telaDocumentos(corpo) {
    const r = await ui.api('/api/documentos');
    const pode = r.podeEditar;
    const aceita = Object.keys(r.tipos || {}).join(',');
    const enviarArquivo = (arq) => {
      const tipo = (arq.type || '').toLowerCase();
      if (!r.tipos[tipo]) { ui.toast('Tipo de arquivo não aceito. Envie PDF, imagem, Word, Excel, PowerPoint, texto ou ZIP.'); return; }
      if (arq.size > r.limite) { ui.toast(`Arquivo grande demais (até ${Math.round(r.limite / 1048576)} MB).`); return; }
      novoDocumento(arq);
    };
    const drop = pode ? el('div', { class: 'ec-drop' }, ico('enviar'), el('b', { text: 'Arraste um arquivo para cá' }), el('span', { text: `PDF, imagem, Word, Excel, PowerPoint, texto ou ZIP · até ${Math.round(r.limite / 1048576)} MB` }),
      botao('Escolher arquivo', () => escolherArquivo(aceita, enviarArquivo), 'azul', 'enviar')) : null;
    if (drop) {
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('sobre'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('sobre'));
      drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('sobre'); const f = e.dataTransfer?.files?.[0]; if (f) enviarArquivo(f); });
    }
    const cats = Object.entries(CATEGORIA_DOC).filter(([k]) => r.documentos.some((d) => d.categoria === k));
    const lista = r.documentos.filter((d) => !filtroDoc || d.categoria === filtroDoc);
    const linhaDoc = (d) => {
      const tipo = r.tipos[d.mimetype] || 'Arquivo';
      const icone = el('span', { class: 'ec-doc-ic', text: tipo === 'Imagem' ? 'IMG' : tipo === 'PowerPoint' ? 'PPT' : tipo === 'Planilha' ? 'XLS' : tipo.slice(0, 4).toUpperCase() });
      icone.style.background = COR_DOC[tipo] || '#64748b';
      const url = `/api/documentos/${d.id}/arquivo`;
      return el('div', { class: 'ec-item ec-doc', style: 'cursor:default' }, icone,
        el('div', {}, el('b', { text: d.nome }), el('small', { text: [CATEGORIA_DOC[d.categoria], tamanho(d.tamanho), new Date(d.enviadoEm).toLocaleDateString('pt-BR'), d.enviadoPor].filter(Boolean).join(' · ') }),
          d.descricao ? el('small', { text: d.descricao }) : null),
        d.visivel === 'gestao' ? el('span', { class: 'ec-pil aviso', text: 'Só gestão' }) : null,
        el('div', { class: 'ec-acoes', style: 'flex:none;display:flex' },
          el('a', { class: 'ec-bt mini icone', href: url, target: '_blank', rel: 'noopener', title: 'Abrir', 'aria-label': `Abrir ${d.nome}`, html: IC.abrir }),
          el('a', { class: 'ec-bt mini icone', href: url + '?baixar=1', title: 'Baixar', 'aria-label': `Baixar ${d.nome}`, html: IC.baixar }),
          pode ? botao('', () => editarDocumento(d), 'mini icone', 'lapis') : null));
    };
    const filtros = cats.length > 1 ? el('div', { class: 'ec-abas', role: 'tablist', style: 'justify-self:start' }, ...[['', 'Todos'], ...cats].map(([k, n]) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(filtroDoc === k), text: n, onclick: () => { filtroDoc = k; redesenhar(); } }))) : null;
    encher(corpo, 
      pode ? null : el('p', { class: 'ec-info', text: 'Documentos que a gestão deixou para a equipe. Só a gerência, a direção e a administração enviam.' }),
      drop ? el('section', { class: 'ec-c' }, drop) : null,
      filtros,
      lista.length ? el('div', { style: 'display:grid;gap:10px' }, ...lista.map(linhaDoc))
        : el('section', { class: 'ec-c' }, vazio('doc', r.documentos.length ? 'Nada nesta categoria' : 'Nenhum documento ainda', 'Contrato, tabela de preços, catálogo em PDF, manual da equipe: o que ficar aqui a equipe acha num toque.')));
  }
  function camposDoc(d) {
    const nome = entrada({ value: d.nome || '', maxlength: '160' });
    const categoria = el('select', { class: 'ec-in' }, ...Object.entries(CATEGORIA_DOC).map(([k, n]) => el('option', { value: k, text: n })));
    categoria.value = d.categoria || 'outro';
    const desc = entrada({ value: d.descricao || '', maxlength: '500', placeholder: 'Opcional' });
    let visivel = d.visivel || 'equipe';
    const vis = seg([['equipe', 'Toda a equipe'], ['gestao', 'Só a gestão']], visivel, (v) => { visivel = v; }, 'Quem vê');
    return { nome, categoria, desc, vis, valor: () => ({ nome: nome.value.trim(), categoria: categoria.value, descricao: desc.value.trim(), visivel }), campos: [campo('Nome', nome, { cheio: true }), campo('Categoria', categoria), campo('Descrição', desc, { cheio: true })] };
  }
  function novoDocumento(arq) {
    janela('Enviar documento', (form, fechar) => {
      const nomeBase = arq.name.replace(/\.[a-z0-9]{2,5}$/i, '');
      const c = camposDoc({ nome: nomeBase, categoria: /contrato/i.test(arq.name) ? 'contrato' : /cat[aá]logo/i.test(arq.name) ? 'catalogo' : /tabela|pre[cç]o/i.test(arq.name) ? 'tabela' : 'outro' });
      const erro = el('p', { class: 'ec-erro', role: 'alert' });
      form.append(el('p', { class: 'ec-sub', text: `${arq.name} · ${tamanho(arq.size)}` }), el('div', { class: 'ec-form' }, ...c.campos), el('span', { class: 'ec-campo' }, document.createTextNode('Quem vê'), c.vis), erro);
      const enviar = botao('Enviar', async () => {
        erro.textContent = '';
        const v = c.valor(); if (!v.nome) { erro.textContent = 'Dê um nome ao documento.'; return; }
        enviar.disabled = true; enviar.textContent = 'Enviando…';
        try { const base64 = await lerBase64(arq); await ui.api('/api/documentos', { method: 'POST', body: JSON.stringify({ ...v, mimetype: arq.type, base64 }) }); ui.toast('Documento guardado ✓'); fechar(); redesenhar(); }
        catch (x) { erro.textContent = x.message; enviar.disabled = false; enviar.textContent = 'Enviar'; }
      }, 'azul');
      return [botao('Cancelar', fechar), enviar];
    });
  }
  function editarDocumento(d) {
    janela('Editar documento', (form, fechar) => {
      const c = camposDoc(d);
      const erro = el('p', { class: 'ec-erro', role: 'alert' });
      form.append(el('div', { class: 'ec-form' }, ...c.campos), el('span', { class: 'ec-campo' }, document.createTextNode('Quem vê'), c.vis), erro);
      const salvar = botao('Salvar', async () => {
        erro.textContent = '';
        try { await ui.api(`/api/documentos/${d.id}`, { method: 'PATCH', body: JSON.stringify(c.valor()) }); ui.toast('Salvo ✓'); fechar(); redesenhar(); } catch (x) { erro.textContent = x.message; }
      }, 'azul');
      const apagar = botao('Apagar', async () => {
        if (!confirm(`Apagar "${d.nome}"? Não dá para desfazer.`)) return;
        try { await ui.api(`/api/documentos/${d.id}`, { method: 'DELETE' }); ui.toast('Documento apagado.'); fechar(); redesenhar(); } catch (x) { erro.textContent = x.message; }
      }, 'perigo ec-esq', 'lixo');
      return [apagar, botao('Cancelar', fechar), salvar];
    });
  }

  // ------------------------------------------------------------ menu lateral e início
  function ligarMenu() {
    document.querySelectorAll('[data-emp]').forEach((b) => {
      if (b.dataset.empLigado) return;
      b.dataset.empLigado = '1';
      b.addEventListener('click', () => { irAba(b.dataset.emp); ui ? ui.mostrar('empresa') : window.Sintonia?.mostrar?.('empresa'); setTimeout(marcarMenu, 0); });
    });
    const v = document.getElementById('v-empresa');
    if (v && !v.dataset.ecObs) { v.dataset.ecObs = '1'; new MutationObserver(marcarMenu).observe(v, { attributes: true, attributeFilter: ['class'] }); }
  }
  (async () => {
    for (let i = 0; i < 80 && !(window.Sintonia?.ui && window.Sintonia.ui.estado?.eu); i++) await new Promise((r) => setTimeout(r, 100));
    if (!window.Sintonia?.ui) return;
    ui = window.Sintonia.ui; css();
    ligarMenu();
    lerUnidades().then(() => { try { ui.atualizar?.(); } catch {} });
  })();

  window.SintoniaTelas.empresa = { desenhar, irAba, aba: () => aba, unidades: (forcar) => lerUnidades(forcar) };
})();
