/* Tela "painel" da Sintonia: registra window.SintoniaTelas.painel = { desenhar(caixa, ui) }.
 * Dashboard no jeito de banco digital, nos dois temas (claro: cartões brancos com texto azul-marinho; escuro: o
 * azul profundo de antes). No computador são duas colunas (modelo 3 aprovado): à esquerda o número grande com a
 * curva, os quatro cartões e as movimentações; à direita (360 px) a meta do mês, IA × equipe, o ranking e o resto.
 * No celular, uma coluna só.
 * Cada bloco tem o "i" (o que o número conta e de onde vem) e, quando dá para escolher, o lápis (qual métrica
 * mostrar). "Personalizar" deixa arrastar os blocos (mouse e dedo, sem biblioteca), tirar blocos e voltar ao padrão;
 * "+ Adicionar relatório" abre a Biblioteca de relatórios. O jeito de cada pessoa fica guardado no servidor
 * (/api/painel/layout); sem login, só neste navegador.
 * A atendente vê "Seus números" (só os dela). Sem bibliotecas e sem animação contínua (só um esmaecer ao chegar).
 * Estilos próprios em <style id="estilo-painel">, tudo com prefixo .pn-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const PERIODOS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias']];
  // Hoje compara com ontem até a mesma hora (o servidor corta o período anterior no mesmo horário).
  const COMPARA = { hoje: 'vs ontem, mesma hora', ontem: 'vs anteontem', '7d': 'vs 7 dias antes', '30d': 'vs 30 dias antes' };
  const NO_PERIODO = { hoje: 'hoje', ontem: 'ontem', '7d': 'nos últimos 7 dias', '30d': 'nos últimos 30 dias' };
  const CURTO_PERIODO = { hoje: 'hoje', ontem: 'ontem', '7d': 'últimos 7 dias', '30d': 'últimos 30 dias' };
  const CHAVE = 'sintonia.painel.periodo';
  const CHAVE_OLHO = 'sintonia.painel.ocultar';
  const CHAVE_LAYOUT = 'sintonia.painel.layout';
  const INTERVALO = 30000;
  /** A partir desta largura da tela do Dashboard, duas colunas. */
  const LARGURA_DUAS = 940;
  /** Cores das etapas (só para gráficos). */
  const COR_ETAPA = { novo_lead: '#7cc4ff', em_conversa: '#8CC7E0', interessada: '#5FA8CB', agendada: '#0ffcbe', compareceu: '#FFB199', manutencao: '#F5B800', perdida: '#7D8C99' };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  const CSS = `
  /* ---------- cores: claro (padrão) e escuro, sempre seguindo o tema do app ---------- */
  .pn-caixa.pn-caixa { padding: 14px 16px 0; gap: 0; color-scheme: light;
    --texto: #08243f; --sub: #5a6b7d; --fraco: #7b8ea2;
    --vidro-fundo: #ffffff; --vidro-forte: #ffffff; --vidro-borda: rgba(8, 36, 63, .08); --vidro-linha: rgba(8, 36, 63, .07);
    --vidro-brilho: 0 4px 16px rgba(8, 36, 63, .06); --vidro-item: #eef3f8; --vidro-ativo: #e2ebf5;
    --aviso: #fff6db; --aviso-txt: #5e4b00;
    --pn-g1: #12d6a3; --pn-g2: #3aa0ff; --pn-apoio: #7cc4ff; --pn-acento: #0b8f6a;
    --pn-bom-fundo: #e3fbf3; --pn-bom-txt: #0b7a5a; --pn-ruim-fundo: #fdecec; --pn-ruim-txt: #b42318;
    --pn-cartao: #ffffff; --pn-cartao-borda: rgba(8, 36, 63, .06); --pn-cartao-sombra: 0 4px 16px rgba(8, 36, 63, .06);
    --pn-seg: #ffffff; --pn-seg-txt: #5a6b7d; --pn-seg-on: #08243f; --pn-seg-on-txt: #ffffff;
    --pn-forte: #08243f; --pn-forte-txt: #ffffff;
    --pn-pop: #ffffff; --pn-pop-txt: #08243f; --pn-pop-sub: #5a6b7d; --pn-pop-sel: #e3effa; --pn-pop-sombra: 0 18px 40px rgba(8, 36, 63, .18);
    --pn-grade: rgba(8, 36, 63, .07); --pn-ponto-borda: #ffffff; --pn-mini: #f1f5f9; --pn-mini-txt: #5a6b7d;
    --pn-ic-ia-fundo: rgba(15, 252, 190, .2); --pn-ic-ia: #0b7a5a; --pn-ic-azul-fundo: rgba(16, 110, 190, .1); --pn-ic-azul: #106ebe;
    --pn-ic-ruim-fundo: rgba(220, 38, 38, .09); --pn-ic-ruim: #b42318; --pn-ic-aviso-fundo: rgba(245, 184, 0, .16); --pn-ic-aviso: #8a6100;
    --pn-meta-fundo: linear-gradient(135deg, rgba(15, 252, 190, .16), rgba(58, 160, 255, .12)), #ffffff;
    --pn-tracejado: rgba(8, 36, 63, .22); --pn-tracejado-txt: #6b7d90; --pn-editar: rgba(16, 110, 190, .45);
    --pn-anel-trilho: #e8eef5; --anel-foto: rgba(8, 36, 63, .14);
    color: var(--texto); }
  html[data-tema="escuro"] .pn-caixa.pn-caixa { color-scheme: dark;
    background: radial-gradient(140% 60% at 50% 0%, #0d3a66 0%, #071c33 55%, #05162a 100%) #05162a;
    --texto: #eaf3fc; --sub: #8fb1d1; --fraco: #7d9cbb; --fundo: #071c33; --painel: #0b2a47; --linha: #143a5e; --hover: #0d3050; --entrada: #0d3050; --icone: #b9d4ee;
    --vidro-fundo: rgba(255, 255, 255, .05); --vidro-forte: #0c2b49; --vidro-borda: rgba(255, 255, 255, .09); --vidro-linha: rgba(255, 255, 255, .07);
    --vidro-brilho: none; --vidro-item: rgba(255, 255, 255, .06); --vidro-ativo: rgba(255, 255, 255, .12);
    --aviso: #2a2410; --aviso-txt: #ffd47a; --ia: #0ffcbe;
    --pn-g1: #0ffcbe; --pn-g2: #3aa0ff; --pn-acento: #0ffcbe;
    --pn-bom-fundo: rgba(15, 252, 190, .14); --pn-bom-txt: #0ffcbe; --pn-ruim-fundo: rgba(255, 122, 122, .14); --pn-ruim-txt: #ff9a9c;
    --pn-cartao: rgba(255, 255, 255, .05); --pn-cartao-borda: rgba(255, 255, 255, .08); --pn-cartao-sombra: none;
    --pn-seg: rgba(255, 255, 255, .07); --pn-seg-txt: #a9c2da; --pn-seg-on: #eaf3fc; --pn-seg-on-txt: #08243f;
    --pn-forte: #eaf3fc; --pn-forte-txt: #08243f;
    --pn-pop: #eaf3fc; --pn-pop-txt: #08243f; --pn-pop-sub: #5a6b7d; --pn-pop-sel: #d9e9f9; --pn-pop-sombra: 0 20px 40px rgba(0, 0, 0, .45);
    --pn-grade: rgba(255, 255, 255, .06); --pn-ponto-borda: #eaf3fc; --pn-mini: rgba(255, 255, 255, .06); --pn-mini-txt: #a9c2da;
    --pn-ic-ia-fundo: rgba(15, 252, 190, .14); --pn-ic-ia: #0ffcbe; --pn-ic-azul-fundo: rgba(124, 196, 255, .14); --pn-ic-azul: #7cc4ff;
    --pn-ic-ruim-fundo: rgba(255, 122, 122, .14); --pn-ic-ruim: #ff9a9c; --pn-ic-aviso-fundo: rgba(245, 184, 0, .14); --pn-ic-aviso: #f5c84a;
    --pn-meta-fundo: linear-gradient(135deg, rgba(15, 252, 190, .12), rgba(58, 160, 255, .12));
    --pn-tracejado: rgba(255, 255, 255, .2); --pn-tracejado-txt: #a9c2da; --pn-editar: rgba(15, 252, 190, .45);
    --pn-anel-trilho: rgba(255, 255, 255, .12); --anel-foto: rgba(255, 255, 255, .22); }
  @media (min-width: 761px) { .pn-caixa.pn-caixa { padding: 22px 28px 0; } }
  /* Fora do Dashboard (painel lateral de uma pessoa) os mesmos cartões seguem o tema do app. */
  .pn-painel-pessoa { --fraco: var(--sub); --pn-g1: #12d6a3; --pn-g2: #3aa0ff; --pn-apoio: #7cc4ff; --pn-cartao: var(--vidro-item); --pn-cartao-borda: var(--vidro-borda); --pn-cartao-sombra: none;
    --pn-bom-fundo: rgba(15, 157, 107, .12); --pn-bom-txt: #0b7a5a; --pn-ruim-fundo: rgba(220, 38, 38, .1); --pn-ruim-txt: #b91c1c; --pn-mini: var(--vidro-item); --pn-mini-txt: var(--sub); }
  [data-tema="escuro"] .pn-painel-pessoa { --pn-g1: #0ffcbe; --pn-bom-fundo: rgba(15, 252, 190, .14); --pn-bom-txt: #0ffcbe; --pn-ruim-fundo: rgba(255, 122, 122, .14); --pn-ruim-txt: #ff9a9c; }

  .pn { display: grid; gap: 16px; padding-bottom: 36px; min-width: 0; max-width: 1400px; width: 100%; margin: 0 auto; position: relative; }
  @media (max-width: 760px) { .pn { padding-bottom: 120px; gap: 14px; } }
  .pn button { font-family: inherit; }
  .pn :focus-visible { outline: 2px solid var(--pn-g2); outline-offset: 2px; }
  .pn svg.pn-i { width: 20px; height: 20px; display: block; }
  .pn-entra { animation: pn-entra .4s ease-out both; }
  @keyframes pn-entra { from { opacity: 0; transform: translateY(6px); } }

  /* ---------- topo ---------- */
  .pn-topo { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pn-titulo { display: none; min-width: 0; flex: 1; }
  .pn-titulo h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
  .pn-largo .pn-titulo { display: grid; gap: 2px; }
  .pn-largo .pn-eu { display: none; }
  .pn-eu { all: unset; box-sizing: border-box; cursor: pointer; flex: none; border-radius: 50%; display: grid; }
  .pn-eu .avatar { width: 40px; height: 40px; font-size: 14px; background: linear-gradient(135deg, #1a8be0, #0a4c86); color: #fff; box-shadow: 0 0 0 2px var(--anel-foto); }
  .pn-eu.pn-on .avatar { box-shadow: 0 0 0 2px var(--pn-cartao), 0 0 0 4px #16c784 !important; }
  .pn-redondo { all: unset; box-sizing: border-box; cursor: pointer; flex: none; position: relative; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
                background: var(--pn-seg); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); transition: background .15s ease; }
  .pn-redondo:hover { background: var(--vidro-ativo); }
  .pn-redondo svg { width: 19px; height: 19px; }
  .pn-redondo.pn-mini { width: 32px; height: 32px; } .pn-redondo.pn-mini svg { width: 16px; height: 16px; }
  .pn-bolinha { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center;
                font-size: 10.5px; font-weight: 800; background: #0ffcbe; color: #04172b; box-shadow: 0 0 0 2px var(--pn-cartao); }
  .pn-bolinha[hidden] { display: none; }
  .pn-trilho { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--pn-seg); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: none; margin: 0 auto; }
  .pn-largo .pn-trilho { margin: 0; }
  .pn-trilho::-webkit-scrollbar { display: none; }
  .pn-trilho button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 32px; padding: 0 12px; display: inline-grid; place-items: center; border-radius: 999px; font-size: 12.5px; font-weight: 500; color: var(--pn-seg-txt); white-space: nowrap; transition: background .15s ease, color .15s ease; }
  .pn-trilho button:hover { color: var(--texto); }
  .pn-trilho button[aria-pressed="true"] { background: var(--pn-seg-on); color: var(--pn-seg-on-txt); font-weight: 700; }
  @media (max-width: 370px) { .pn-trilho button { padding: 0 8px; font-size: 12px; } }
  .pn-pilula { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 40px; padding: 0 16px; border-radius: 999px; font-size: 13px; font-weight: 700; white-space: nowrap;
               background: var(--pn-seg); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-pilula:hover { background: var(--vidro-ativo); }
  .pn-pilula.pn-forte { background: var(--pn-forte); color: var(--pn-forte-txt); box-shadow: none; }
  .pn-pilula svg { width: 17px; height: 17px; }
  .pn-estado { display: flex; justify-content: center; align-items: center; gap: 6px; font-size: 12px; color: var(--fraco); margin-top: -6px; min-height: 32px; flex-wrap: wrap; text-align: center; }
  .pn-largo .pn-estado { justify-content: flex-start; margin: 0; min-height: 0; text-align: left; }
  .pn-estado b { color: var(--sub); font-weight: 600; }
  .pn-estado .pn-carregando { opacity: .45; }
  .pn-editando-barra { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px; border-radius: 18px; background: var(--pn-cartao); box-shadow: inset 0 0 0 1.5px var(--pn-editar); }
  .pn-editando-barra div { flex: 1; min-width: 180px; display: grid; gap: 2px; }
  .pn-editando-barra b { font-size: 15px; } .pn-editando-barra span { font-size: 12.5px; color: var(--sub); }

  /* ---------- colunas ---------- */
  .pn-colunas { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  .pn-largo .pn-colunas { grid-template-columns: minmax(0, 1fr) 360px; }
  .pn-col { display: grid; gap: 16px; align-content: start; min-width: 0; min-height: 60px; }
  @media (max-width: 760px) { .pn-col { gap: 14px; } }

  /* ---------- bloco (moldura comum) ---------- */
  .pn-b { position: relative; min-width: 0; border-radius: 22px; padding: 16px; display: grid; gap: 14px; align-content: start; container-type: inline-size;
          background: var(--pn-cartao); box-shadow: inset 0 0 0 1px var(--pn-cartao-borda), var(--pn-cartao-sombra); }
  @media (min-width: 761px) { .pn-b { padding: 18px 20px; } }
  .pn-b::after { content: ''; position: absolute; left: 18px; right: 18px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, transparent, var(--pn-g1), var(--pn-g2), transparent); opacity: .55; pointer-events: none; }
  .pn-b.pn-solto { background: none; box-shadow: none; padding: 0; }
  .pn-b.pn-solto::after { display: none; }
  .pn-b-cab { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 28px; }
  .pn-b-cab h2 { margin: 0; font-size: 15.5px; font-weight: 700; letter-spacing: -.005em; min-width: 0; flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-b-cab .pn-dica { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 1 1 0; }
  .pn-b-acoes { margin-left: auto; display: flex; align-items: center; gap: 4px; flex: none; }
  .pn-ib { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; color: var(--pn-mini-txt); background: var(--pn-mini); }
  .pn-ib:hover { color: var(--texto); background: var(--vidro-ativo); }
  .pn-ib svg { width: 15px; height: 15px; }
  .pn-ib[aria-expanded="true"] { color: var(--texto); box-shadow: inset 0 0 0 1.5px var(--pn-g2); }
  .pn-info { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: var(--fraco); }
  .pn-info:hover, .pn-info[aria-expanded="true"] { color: var(--texto); background: var(--pn-mini); }
  .pn-info svg { width: 16px; height: 16px; }
  .pn-pega { cursor: grab; touch-action: none; }
  .pn-pega:active { cursor: grabbing; }
  .pn-tirar { all: unset; box-sizing: border-box; cursor: pointer; flex: none; display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border-radius: 9px; font-size: 12px; font-weight: 700; color: var(--pn-ruim-txt); background: var(--pn-ruim-fundo); }
  .pn-tirar svg { width: 14px; height: 14px; }
  @container (max-width: 440px) {
    .pn-tirar { padding: 0 8px; } .pn-tirar span { display: none; }
    .pn-editando .pn-b-cab .pn-dica, .pn-editando .pn-b-cab .pn-link { display: none; }
  }
  .pn-editando .pn-b { box-shadow: inset 0 0 0 1.5px var(--pn-editar), var(--pn-cartao-sombra); }
  .pn-editando .pn-b.pn-solto { background: var(--pn-cartao); padding: 16px; }
  .pn-b.pn-arrastando { position: fixed; z-index: 40; margin: 0; pointer-events: none; opacity: .96; box-shadow: 0 24px 50px rgba(8, 36, 63, .28), inset 0 0 0 2px var(--pn-g2); }
  .pn-vaga { border-radius: 22px; border: 2px dashed var(--pn-editar); background: color-mix(in srgb, var(--pn-g1) 6%, transparent); }
  .pn-link { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--pn-acento); padding: 4px; white-space: nowrap; }
  .pn-link:hover { text-decoration: underline; }
  .pn-desemp { all: unset; box-sizing: border-box; cursor: pointer; flex: none; min-height: 30px; padding: 0 12px; border-radius: 999px; font-weight: 800; font-size: 12.5px; background: #0ffcbe; color: #04172b; }
  .pn-vazio { font-size: 14px; color: var(--sub); line-height: 1.5; }
  .pn-vazio b { color: var(--texto); }

  /* ---------- popover: "i" e lápis ---------- */
  .pn-pop { position: fixed; z-index: 60; width: 270px; max-width: calc(100vw - 24px); box-sizing: border-box; border-radius: 16px; padding: 12px 14px; font-size: 12.5px; line-height: 1.5;
            background: var(--pn-pop); color: var(--pn-pop-txt); box-shadow: var(--pn-pop-sombra), inset 0 0 0 1px rgba(8, 36, 63, .06); animation: pn-pop .12s ease-out both; }
  @keyframes pn-pop { from { opacity: 0; transform: translateY(-4px); } }
  .pn-pop b.pn-pop-t { display: block; font-size: 13.5px; margin-bottom: 3px; }
  .pn-pop p { margin: 0; }
  .pn-pop small { display: block; margin-top: 6px; color: var(--pn-pop-sub); font-size: 11.5px; }
  .pn-pop.pn-menu-m { padding: 8px; width: 260px; }
  .pn-pop .pn-pop-cab { display: block; font-size: 12px; color: var(--pn-pop-sub); padding: 4px 8px 6px; font-weight: 600; }
  .pn-pop .pn-op { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 10px; border-radius: 10px; font-size: 13.5px; color: var(--pn-pop-txt); }
  .pn-pop .pn-op:hover { background: var(--pn-pop-sel); }
  .pn-pop .pn-op[aria-checked="true"] { background: var(--pn-pop-sel); font-weight: 700; }
  .pn-pop .pn-op small { margin: 0 0 0 auto; font-size: 11px; }
  .pn-pop .pn-op svg { width: 16px; height: 16px; flex: none; }
  .pn-pop hr { border: 0; height: 1px; background: rgba(8, 36, 63, .08); margin: 6px 4px; }

  /* ---------- herói: o número grande com a curva ---------- */
  .pn-sel { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px 0 13px; border-radius: 999px; font-size: 13.5px; font-weight: 700;
            background: var(--pn-mini); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; }
  .pn-sel svg { width: 14px; height: 14px; }
  .pn-sel[aria-expanded="true"] { box-shadow: inset 0 0 0 1.5px var(--pn-g2); }
  .pn-valor { font-size: 40px; font-weight: 800; letter-spacing: -1.5px; line-height: 1.05; font-variant-numeric: tabular-nums; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .pn-valor small { font-size: .5em; font-weight: 700; opacity: .6; letter-spacing: -.5px; }
  @container (min-width: 560px) { .pn-valor { font-size: 52px; } }
  /* imperio: número grande estilo app de banco (celular) */
  .pn-banco { display: grid; justify-items: center; text-align: center; gap: 10px; padding: 6px 0 0; min-width: 0; }
  .pn-banco-linha { display: flex; align-items: center; gap: 4px; font-size: 14.5px; color: var(--sub); }
  .pn-banco-rot { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; }
  .pn-banco-rot svg { width: 15px; height: 15px; opacity: .7; }
  .pn-banco-olho { all: unset; cursor: pointer; font-weight: 500; }
  .pn-banco-olho::before { content: "·"; margin: 0 6px 0 2px; }
  .pn-banco-rot:focus-visible, .pn-banco-olho:focus-visible { outline: 2px solid var(--pn-g2); border-radius: 6px; }
  .pn-banco .pn-valor { font-size: 46px; letter-spacing: -2px; }
  .pn-banco .pn-curva { width: calc(100% + 32px); margin: 8px -16px 0; }
  .pn-grafico-banco { height: 190px; }
  @container (min-width: 560px) { .pn-grafico-banco { height: 260px; } }
  .pn-grafico-banco .pn-t-1 { stroke-width: 2.8; }
  .pn-heroi-n { display: grid; gap: 8px; justify-items: start; min-width: 0; }
  .pn-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .pn-chip.pn-bom { background: var(--pn-bom-fundo); color: var(--pn-bom-txt); }
  .pn-chip.pn-ruim { background: var(--pn-ruim-fundo); color: var(--pn-ruim-txt); }
  .pn-chip.pn-igual { background: var(--vidro-item); color: var(--sub); }

  /* ---------- curva ---------- */
  .pn-curva { position: relative; display: grid; gap: 4px; min-width: 0; }
  .pn-curva-cab { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--fraco); min-height: 32px; }
  .pn-curva-cab > span { flex: 1; min-width: 0; display: flex; gap: 6px 14px; flex-wrap: wrap; align-items: center; }
  .pn-leg { display: inline-flex; align-items: center; gap: 6px; }
  .pn-leg i { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
  .pn-leg i.pn-l-1 { background: linear-gradient(90deg, var(--pn-g1), var(--pn-g2)); }
  .pn-leg i.pn-l-2 { background: rgba(124, 196, 255, .7); }
  .pn-leg i.pn-l-m { height: 0; border-top: 2px dashed var(--fraco); background: none; }
  .pn-grafico { position: relative; height: 170px; touch-action: pan-y; }
  @container (min-width: 560px) { .pn-grafico { height: 250px; } }
  .pn-grafico svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .pn-grafico .pn-eixo-t { font-size: 11px; fill: var(--fraco); font-family: var(--fonte); font-variant-numeric: tabular-nums; }
  .pn-grafico .pn-grade-l { stroke: var(--pn-grade); stroke-width: 1; }
  .pn-grafico .pn-meta-l { stroke: var(--fraco); stroke-opacity: .6; stroke-width: 1.2; stroke-dasharray: 4 6; fill: none; }
  .pn-grafico .pn-meta-t { font-size: 10.5px; fill: var(--fraco); font-weight: 600; font-family: var(--fonte); }
  .pn-grafico .pn-t-1 { stroke-width: 2.4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .pn-grafico .pn-t-2 { stroke: rgba(124, 196, 255, .65); stroke-width: 1.6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .pn-grafico .pn-guia { stroke: var(--texto); stroke-opacity: .2; stroke-width: 1; }
  .pn-grafico .pn-ponto, .pn-grafico .pn-fim { fill: var(--pn-g2); stroke: var(--pn-ponto-borda); stroke-width: 2; }
  .pn-grafico .pn-ponto-2 { fill: #7cc4ff; stroke: var(--pn-ponto-borda); stroke-width: 2; }
  .pn-g-1 { stop-color: var(--pn-g1); } .pn-g-2 { stop-color: var(--pn-g2); }
  .pn-dica-g { position: absolute; pointer-events: none; z-index: 3; min-width: 140px; padding: 10px 12px; border-radius: 14px; font-size: 12.5px; display: grid; gap: 4px;
               background: var(--pn-pop); color: var(--pn-pop-txt); box-shadow: var(--pn-pop-sombra); }
  .pn-dica-g[hidden] { display: none; }
  .pn-dica-g b { font-size: 13px; }
  .pn-dica-g div { display: flex; align-items: center; gap: 6px; color: var(--pn-pop-sub); }
  .pn-dica-g div strong { margin-left: auto; color: var(--pn-pop-txt); font-variant-numeric: tabular-nums; }
  .pn-dica-g i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .pn-sem-dado { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .pn-sem-dado span { padding: 9px 14px; border-radius: 999px; font-size: 13px; color: var(--sub); background: var(--pn-cartao); box-shadow: inset 0 0 0 1px var(--vidro-borda); max-width: 86%; text-align: center; }

  /* ---------- cartões ---------- */
  .pn-cartoes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @container (min-width: 560px) { .pn-cartoes { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; } }
  .pn-cartoes > .pn-cartao:nth-child(5):last-child { grid-column: 1 / -1; }
  .pn-cartao { position: relative; overflow: hidden; min-width: 0; border-radius: 20px; padding: 14px; display: grid; gap: 4px; align-content: start;
               background: var(--pn-cartao); box-shadow: inset 0 0 0 1px var(--pn-cartao-borda), var(--pn-cartao-sombra); }
  .pn-cartao::after { content: ''; position: absolute; left: 14px; right: 14px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, transparent, var(--pn-g1), var(--pn-g2), transparent); opacity: .7; }
  .pn-cartao-cab { display: flex; align-items: flex-start; gap: 2px; min-width: 0; }
  .pn-cartao-r { font-size: 12px; line-height: 1.35; padding-top: 2px; color: var(--sub); min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .pn-cartao-cab .pn-ib { width: 22px; height: 22px; margin-left: auto; border-radius: 7px; }
  .pn-cartao-cab .pn-ib svg { width: 12px; height: 12px; }
  .pn-cartao-cab .pn-info { width: 18px; height: 18px; }
  .pn-cartao-cab .pn-info svg { width: 14px; height: 14px; }
  .pn-cartao-v { font-size: 24px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; margin: 2px 0; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-cartao-v small { font-size: .6em; font-weight: 700; color: var(--sub); margin: 0 3px 0 1px; }
  .pn-cartao-v.pn-nada { color: var(--sub); }
  .pn-cartao-s { font-size: 12px; color: var(--fraco); }
  .pn-cartao .pn-chip { justify-self: start; }
  .pn-comp { margin: -4px 2px 0; font-size: 12px; color: var(--fraco); text-align: center; }
  .pn-num-g { display: grid; gap: 6px; justify-items: start; }
  .pn-num-g .pn-valor { font-size: 34px; }

  /* ---------- meta do mês ---------- */
  .pn-b.pn-b-meta { background: var(--pn-meta-fundo); }
  .pn-meta-l { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .pn-anel { position: relative; flex: none; width: 64px; height: 64px; }
  .pn-anel svg { width: 100%; height: 100%; display: block; }
  .pn-anel b { position: absolute; inset: 0; display: grid; place-items: center; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pn-meta-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .pn-meta-txt b { font-size: 18px; font-weight: 800; }
  .pn-meta-txt span { font-size: 12.5px; color: var(--sub); line-height: 1.4; }
  .pn-meta-txt small { font-size: 12px; color: var(--fraco); line-height: 1.4; }
  .pn-meta-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pn-meta-form label { font-size: 13px; color: var(--sub); flex-basis: 100%; }
  .pn-meta-form input { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 44px; padding: 0 14px; border-radius: 14px; font-size: 16px; font-weight: 700; color: var(--texto);
                        background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-variant-numeric: tabular-nums; }
  .pn-botao { all: unset; box-sizing: border-box; cursor: pointer; min-height: 44px; padding: 0 18px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 14px; font-weight: 700; white-space: nowrap; }
  .pn-botao.pn-menta { background: #0ffcbe; color: #04172b; }
  .pn-botao.pn-vidro { background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-botao.pn-escuro { background: var(--pn-forte); color: var(--pn-forte-txt); }

  /* ---------- listas (movimentações, ranking, serviços…) ---------- */
  .pn-movs { display: grid; }
  .pn-mov { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--vidro-linha); min-width: 0; }
  .pn-mov:last-child { border-bottom: 0; }
  button.pn-mov { cursor: pointer; }
  button.pn-mov:hover { background: linear-gradient(90deg, transparent, var(--vidro-item), transparent); }
  .pn-mov .avatar { width: 38px; height: 38px; flex: none; }
  .pn-mov-ic { width: 38px; height: 38px; flex: none; border-radius: 13px; display: grid; place-items: center; background: var(--vidro-item); color: var(--sub); }
  .pn-mov-ic svg { width: 19px; height: 19px; }
  .pn-mov-ic.pn-t-agendamento, .pn-mov-ic.pn-t-ia_assumiu { background: var(--pn-ic-ia-fundo); color: var(--pn-ic-ia); }
  .pn-mov-ic.pn-t-pediu_ajuda, .pn-mov-ic.pn-t-ligacao { background: var(--pn-ic-azul-fundo); color: var(--pn-ic-azul); }
  .pn-mov-ic.pn-t-falha { background: var(--pn-ic-ruim-fundo); color: var(--pn-ic-ruim); }
  .pn-mov-ic.pn-t-lembrete { background: var(--pn-ic-aviso-fundo); color: var(--pn-ic-aviso); }
  .pn-mov-c { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .pn-mov-c b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-mov-c span { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-mov-v { flex: none; text-align: right; display: grid; gap: 1px; max-width: 40%; }
  .pn-mov-v strong { font-size: 14px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pn-mov-v strong.pn-mais { color: var(--pn-bom-txt); }
  .pn-mov-v small { font-size: 11.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-ver { justify-self: center; }

  /* funil */
  .pn-total { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .pn-total b { font-size: 28px; font-weight: 800; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
  .pn-total span { font-size: 13px; color: var(--sub); }
  .pn-pilha { display: flex; gap: 4px; height: 12px; }
  .pn-pilha i { display: block; min-width: 8px; border-radius: 999px; }
  .pn-pilha.pn-pilha-vazia { border-radius: 999px; background: var(--vidro-item); }
  .pn-etapas { display: grid; }
  .pn-etapa { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 12px minmax(0, 1fr) 44px 44px; gap: 10px; align-items: center; min-height: 40px; padding: 0 6px; font-size: 14px; border-bottom: 1px solid var(--vidro-linha); }
  .pn-etapa:last-child { border-bottom: 0; }
  .pn-etapa:hover { background: linear-gradient(90deg, transparent, var(--vidro-item), transparent); }
  .pn-etapa i { width: 10px; height: 10px; border-radius: 50%; }
  .pn-etapa .pn-nome { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .pn-etapa b { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
  .pn-etapa small { text-align: right; font-size: 12.5px; color: var(--sub); font-variant-numeric: tabular-nums; }
  .pn-etapa.pn-nula { color: var(--sub); }
  .pn-etapa.pn-nula .pn-nome { font-weight: 500; }

  /* barras simples (quem mais agendou, origem, serviços, perdas, transmissões) */
  .pn-barras { display: grid; }
  .pn-barra-l { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--vidro-linha); min-width: 0; font-size: 13.5px; }
  .pn-barra-l:last-child { border-bottom: 0; }
  button.pn-barra-l { cursor: pointer; }
  button.pn-barra-l:hover { background: linear-gradient(90deg, transparent, var(--vidro-item), transparent); }
  .pn-barra-l .pn-pos { width: 22px; flex: none; font-size: 12.5px; color: var(--sub); font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
  .pn-barra-c { flex: 1; min-width: 0; display: grid; gap: 5px; }
  .pn-barra-c b { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-barra-c small { font-size: 11.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-barra-t { height: 5px; border-radius: 3px; background: var(--vidro-item); overflow: hidden; }
  .pn-barra-t i { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, var(--pn-g1), var(--pn-g2)); }
  .pn-barra-v { flex: none; font-weight: 800; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .pn-barra-v small { display: block; font-size: 11px; font-weight: 500; color: var(--sub); }

  /* ranking (tabela da equipe) */
  .pn-online { display: flex; flex-wrap: wrap; gap: 6px; }
  .pn-pil { display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px 4px 4px; border-radius: 999px; background: var(--vidro-item); font-size: 13px; font-weight: 600; }
  .pn-pil .pn-ini { width: 26px; height: 26px; font-size: 10.5px; }
  .pn-pil.pn-ninguem { padding: 6px 12px; color: var(--sub); font-weight: 500; }
  .pn-ini { flex: none; position: relative; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: var(--texto); background: var(--vidro-ativo); }
  .pn-ini.pn-ouro { background: #0ffcbe; color: #04172b; }
  .pn-ini.pn-robo { background: var(--pn-ic-ia-fundo); color: var(--pn-ic-ia); }
  .pn-ini.pn-robo svg { width: 18px; height: 18px; }
  .pn-luz { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: #16c784; border: 2px solid var(--pn-cartao); }
  .pn-rank { display: grid; gap: 8px; }
  .pn-rank-cab, .pn-pessoa { display: grid; grid-template-columns: 22px minmax(0, 1fr) 72px 64px 76px 84px; gap: 10px; align-items: center; }
  .pn-rank-cab { font-size: 12px; color: var(--sub); font-weight: 600; padding: 0 12px; }
  .pn-rank-cab span:nth-child(n+3) { text-align: right; }
  .pn-pessoa { padding: 8px 12px; border-radius: 16px; background: var(--vidro-item); }
  .pn-pessoa.pn-eu-l { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--pn-g1) 60%, transparent); }
  button.pn-pessoa { font: inherit; color: inherit; text-align: left; border: 0; width: 100%; box-sizing: border-box; cursor: pointer; }
  button.pn-pessoa:hover { background: var(--vidro-ativo); }
  .pn-pessoa .pn-pos { font-size: 13px; color: var(--sub); font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; }
  .pn-quem { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pn-quem > span:last-child { display: grid; min-width: 0; }
  .pn-quem b { font-size: 14.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-quem small { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-m { text-align: right; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pn-m.pn-zero { color: var(--sub); font-weight: 500; }
  .pn-m small { display: none; }
  @container (max-width: 560px) {
    .pn-rank-cab { display: none; }
    .pn-pessoa { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; }
    .pn-pessoa .pn-pos { display: none; }
    .pn-quem { grid-column: 1 / -1; }
    .pn-m { text-align: left; display: grid; gap: 1px; padding: 6px 10px; border-radius: 12px; background: var(--pn-cartao); }
    .pn-m small { display: block; font-size: 11px; font-weight: 500; color: var(--sub); }
  }

  /* IA vs equipe */
  .pn-vs { display: grid; gap: 16px; }
  .pn-vs-l { display: grid; gap: 7px; }
  .pn-vs-t { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--sub); }
  .pn-vs-t b { color: var(--texto); font-weight: 700; }
  .pn-vs-n { display: flex; justify-content: space-between; gap: 8px; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .pn-vs-n span:last-child { text-align: right; }
  .pn-vs-n small { font-size: 12px; font-weight: 600; color: var(--sub); margin-left: 4px; }
  .pn-vs-barra { display: flex; gap: 4px; height: 10px; }
  .pn-vs-barra i { display: block; border-radius: 999px; min-width: 6px; }
  .pn-vs-barra .pn-b-ia { background: linear-gradient(90deg, var(--pn-g1), var(--pn-g2)); }
  .pn-vs-barra .pn-b-eq { background: rgba(124, 196, 255, .55); }
  .pn-vs-barra.pn-vs-vazia { border-radius: 999px; background: var(--vidro-item); }
  .pn-chave { display: flex; gap: 14px; font-size: 12.5px; color: var(--sub); }
  .pn-chave span { display: inline-flex; align-items: center; gap: 6px; }
  .pn-chave i { width: 9px; height: 9px; border-radius: 50%; }

  /* visão individual (atendente e painel lateral) */
  .pn-agora { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .pn-agora button, .pn-agora div { all: unset; box-sizing: border-box; display: grid; gap: 2px; padding: 14px; border-radius: 18px; background: var(--vidro-item); }
  .pn-agora button { cursor: pointer; }
  .pn-agora b { font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
  .pn-agora span { font-size: 13px; color: var(--sub); }
  .pn-agora .pn-alerta b { color: #b45309; }
  html[data-tema="escuro"] .pn-agora .pn-alerta b { color: #fcd34d; }
  .pn-pessoa-cab { display: flex; align-items: center; gap: 12px; }
  .pn-pessoa-cab .pn-ini { width: 48px; height: 48px; font-size: 16px; }
  .pn-pessoa-cab b { font-size: 18px; } .pn-pessoa-cab small { display: block; color: var(--sub); font-size: 13px; }
  .pn-painel-pessoa { display: grid; gap: 14px; }
  .pn-painel-pessoa .pn-cartoes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pn-painel-pessoa .pn-cartoes > .pn-cartao:nth-child(5):last-child { grid-column: 1 / -1; }
  .pn-painel-pessoa .pn-p { display: grid; gap: 12px; }
  .pn-painel-pessoa .pn-b-cab h2 { font-size: 15.5px; margin: 0; }

  /* avisos, esqueleto e erro */
  .pn-aviso { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 20px; font-size: 14px; line-height: 1.45; color: var(--sub); background: var(--pn-cartao); border: 1px dashed var(--pn-tracejado); }
  .pn-aviso b { color: var(--texto); display: block; font-size: 15px; }
  .pn-aviso .pn-mov-ic { background: var(--pn-ic-ia-fundo); color: var(--pn-ic-ia); }
  .pn-nota { font-size: 13px; color: var(--aviso-txt); background: var(--aviso); border-radius: 14px; padding: 9px 14px; }
  .pn-esq { background: var(--vidro-item); border-radius: 12px; }
  .pn-erro { justify-items: center; text-align: center; padding: 36px 20px; color: var(--sub); font-size: 14.5px; }
  .pn-erro b { color: var(--texto); font-size: 17px; }

  /* ---------- + Adicionar relatório e a Biblioteca ---------- */
  .pn-adicionar { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; min-height: 56px; border-radius: 20px; border: 1.5px dashed var(--pn-tracejado); color: var(--pn-tracejado-txt);
                  display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 14px; font-weight: 700; }
  .pn-adicionar:hover { background: var(--vidro-item); color: var(--texto); }
  .pn-adicionar svg { width: 18px; height: 18px; }
  .pn-bib-fundo { position: fixed; inset: 0; z-index: 70; background: rgba(4, 18, 31, .45); display: grid; align-items: end; justify-items: center; }
  @media (min-width: 761px) { .pn-bib-fundo { align-items: center; padding: 24px; } }
  .pn-bib { width: 100%; max-width: 680px; max-height: min(86vh, 760px); overflow: auto; overscroll-behavior: contain; box-sizing: border-box; border-radius: 24px 24px 0 0; padding: 18px 16px 28px;
            background: var(--pn-pop); color: var(--pn-pop-txt); box-shadow: var(--pn-pop-sombra); animation: pn-sobe .2s ease-out both; --sub: #5a6b7d; --texto: #08243f; --pn-forte: #08243f; --pn-forte-txt: #ffffff; }
  @media (min-width: 761px) { .pn-bib { border-radius: 24px; padding: 22px 24px 26px; } }
  @keyframes pn-sobe { from { opacity: 0; transform: translateY(16px); } }
  .pn-bib-cab { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 6px; }
  .pn-bib-cab div { flex: 1; display: grid; gap: 2px; }
  .pn-bib-cab h2 { margin: 0; font-size: 19px; }
  .pn-bib-cab p { margin: 0; font-size: 13px; color: var(--sub); }
  .pn-bib .pn-redondo { background: #eef3f8; color: #08243f; box-shadow: none; }
  .pn-bib h3 { margin: 18px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--sub); font-weight: 700; }
  .pn-bib-it { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(8, 36, 63, .07); }
  .pn-bib-it:last-child { border-bottom: 0; }
  .pn-bib-it .pn-mov-ic { background: #eef3f8; color: #106ebe; }
  .pn-bib-it div { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .pn-bib-it b { font-size: 14px; } .pn-bib-it span { font-size: 12.5px; color: var(--sub); line-height: 1.4; }
  .pn-bib-it .pn-botao { min-height: 36px; padding: 0 14px; font-size: 13px; }
  .pn-bib-it .pn-ja { font-size: 12.5px; color: #0b7a5a; font-weight: 700; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
  .pn-bib-it .pn-ja svg { width: 15px; height: 15px; }

  /* ---------- Comercial (/telas/comercial.js) dentro do Dashboard ---------- */
  .pn-caixa .cm { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .pn-caixa .cm-p { background: var(--pn-cartao); border: 0; box-shadow: inset 0 0 0 1px var(--pn-cartao-borda), var(--pn-cartao-sombra); -webkit-backdrop-filter: none; backdrop-filter: none; border-radius: 22px; }
  .pn-caixa .cm-meta { background: var(--pn-meta-fundo); }
  .pn-caixa .cm-av { background: #106ebe; }
  .pn-caixa .cm-barra i, .pn-caixa .cm-serv .cm-barra i { background: linear-gradient(90deg, var(--pn-g1), var(--pn-g2)); }
  .pn-caixa .cm-seg button[aria-pressed="true"] { background: var(--pn-seg-on); color: var(--pn-seg-on-txt); }
  html[data-tema="escuro"] .pn-caixa .cm-var.sobe { color: #0ffcbe; } html[data-tema="escuro"] .pn-caixa .cm-var.desce { color: #ff9a7f; }
  .pn-b-comercial { background: none; box-shadow: none; padding: 0; }
  .pn-b-comercial::after { display: none; }
  .pn-editando .pn-b-comercial { padding: 12px; }

  @media (prefers-reduced-motion: reduce) {
    .pn-entra, .pn-pop, .pn-bib { animation: none; }
    .pn-redondo, .pn-trilho button { transition: none; }
  }
  `;
  const svg = (d, extra = '') => `<svg class="pn-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const IC = {
    recarregar: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    sobe: '<svg viewBox="0 0 12 12" width="8" height="8" fill="currentColor" aria-hidden="true"><path d="M6 2l4.5 6h-9z"/></svg>',
    desce: '<svg viewBox="0 0 12 12" width="8" height="8" fill="currentColor" aria-hidden="true"><path d="M6 10L1.5 4h9z"/></svg>',
    // o sino novo do app (mesmo desenho do menu lateral)
    sino: svg('<path d="M12 4a5.5 5.5 0 0 1 5.5 5.5v4.2l1.6 2.3a.8.8 0 0 1-.7 1.2H5.6a.8.8 0 0 1-.7-1.2l1.6-2.3V9.5A5.5 5.5 0 0 1 12 4Z"/><path d="M10.2 20.2h3.6"/><path d="M3 7.5a6 6 0 0 1 1.8-3M21 7.5a6 6 0 0 0-1.8-3"/>'),
    olho: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
    olhoFechado: svg('<path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.7M6.3 7.3A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.2-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
    mais: '<svg class="pn-i" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
    abrir: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
    baixar: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    lapis: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    brilho: svg('<path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>'),
    agendamento: svg('<path d="M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z"/><path d="M8 3v4M16 3v4M3 10h18M9 15l2 2 4-4"/>'),
    pediu_ajuda: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17.2h.01"/>'),
    lembrete: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    followup: svg('<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7Z"/>'),
    nova_cliente: svg('<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>'),
    falha: svg('<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
    telefone: svg('<path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/>'),
    grafico: svg('<path d="M4 19c3-1 4-9 8-9s4 5 8-6"/><path d="M3 21h18"/>'),
  };
  IC.ia_assumiu = IC.brilho;

  // ---------- formatação ----------
  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  const fmtDec = (n, casas = 1) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas });
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
  const brlCurto = (v) => `R$ ${Number(Math.round(v || 0)).toLocaleString('pt-BR')}`;
  const OCULTO = 'R$ •••••';
  /** Tempo em partes [número, unidade]: "48 s", "1 min 12 s", "2 h 05". */
  function partesTempo(seg) {
    if (seg == null || !isFinite(seg)) return null;
    const s = Math.max(0, Math.round(seg));
    if (s < 60) return [[s, 's']];
    if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? [[m, 'min'], [r, 's']] : [[m, 'min']]; }
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return [[h, 'h'], [String(m).padStart(2, '0'), '']];
  }
  const fmtTempo = (seg) => { const p = partesTempo(seg); return p ? p.map(([n, u]) => (u ? `${n} ${u}` : n)).join(' ') : '—'; };
  const fmtPct = (v) => (v == null ? '—' : `${fmtDec(v)}%`);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const horaBahia = () => Number(new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Bahia' }).format(new Date()));
  const hojeBahia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date());
  const iniciais = (n) => String(n || '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const primeiroNome = (n) => String(n || '').split(/\s+/)[0];
  const plural = (n, um, varios) => `${fmtN(n)} ${n === 1 ? um : varios}`;
  const diaSemana = (iso) => SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  const nomeMes = (mes) => MESES[Number(String(mes || '').slice(5, 7)) - 1] || MESES[Number(hojeBahia().slice(5, 7)) - 1];
  const mesAnteriorDe = (mes) => { const m = Number(String(mes).slice(5, 7)) || 1; return MESES[(m + 10) % 12]; };
  const lerPeriodo = () => { try { const v = sessionStorage.getItem(CHAVE); return PERIODOS.some(([k]) => k === v) ? v : null; } catch { return null; } };
  const gravarPeriodo = (v) => { try { sessionStorage.setItem(CHAVE, v); } catch { /* sem armazenamento: fica só na memória */ } };
  const lerOlho = () => { try { return localStorage.getItem(CHAVE_OLHO) === '1'; } catch { return false; } };
  const gravarOlho = (v) => { try { localStorage.setItem(CHAVE_OLHO, v ? '1' : '0'); } catch { /* fica só na memória */ } };
  Object.assign(IC, {
    info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>'),
    pega: '<svg class="pn-i" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    grade: svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>'),
    baixo: svg('<path d="m6 9 6 6 6-6"/>'),
    fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    tirar: svg('<path d="M5 12h14"/>'),
    certo: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    somar: svg('<path d="M12 5v14M5 12h14"/>'),
    dinheiro: svg('<rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>'),
    conversa: svg('<path d="M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8l-4.5 3.5V18H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"/>'),
    funil: svg('<path d="M4 4.5h16a.8.8 0 0 1 .6 1.3L14 13.5V19l-4 2v-7.5L3.4 5.8A.8.8 0 0 1 4 4.5Z"/>'),
    equipe: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.2A6.5 6.5 0 0 1 21.5 20"/>'),
    alvo: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8"/>'),
    lista: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
    megafone: svg('<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M17 9a4 4 0 0 1 0 6"/>'),
    origem: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5Z"/>'),
  });

  // ---------- estado da tela (sobrevive entre aberturas da aba) ----------
  const s = { periodo: lerPeriodo() || 'hoje', cache: {}, extra: null, meta: undefined, comercial: undefined, timer: null, geracao: 0, caixa: null, ui: null, falhou: false, carregando: false,
    verTodos: false, editandoMeta: false, observador: null, ocultar: lerOlho(), entrou: false, sinoObs: null,
    // personalização
    layout: undefined, guardaServidor: false, layoutCarregado: false, editando: false, pop: null, bib: null, arrastando: false, pendente: false, largo: false, raiz: null, tamanhoObs: null, salvarT: null,
    rel: {}, transmissoes: undefined, comissao: undefined };

  function estilo() {
    if (document.getElementById('estilo-painel')) return;
    const st = document.createElement('style');
    st.id = 'estilo-painel';
    st.textContent = CSS;
    document.head.append(st);
  }

  // ---------- peças ----------
  function botaoRedondo(ui, icone, titulo, acao, extra = {}) {
    return ui.el('button', { class: 'pn-redondo', type: 'button', title: titulo, 'aria-label': titulo, html: icone, onclick: acao, ...extra });
  }
  function botaoMini(ui, icone, titulo, acao, extra = {}) {
    return ui.el('button', { class: 'pn-ib', type: 'button', title: titulo, 'aria-label': titulo, html: icone, onclick: acao, ...extra });
  }

  /** Selo de variação: menta se bom, coral se ruim. `menorMelhor` inverte (tempo). */
  function selo(ui, valor, sufixo, comparacao, menorMelhor = false) {
    if (valor == null || !isFinite(valor)) return ui.el('span', { class: 'pn-chip pn-igual', title: `Sem base para comparar (${comparacao})`, text: 'sem base' });
    const r = Math.round(valor * 10) / 10;
    const bom = menorMelhor ? r < 0 : r > 0;
    const cls = r === 0 ? 'pn-igual' : bom ? 'pn-bom' : 'pn-ruim';
    const txt = `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmtDec(Math.abs(r))}${sufixo}`;
    return ui.el('span', { class: 'pn-chip ' + cls, title: `${txt} ${comparacao}`, 'aria-label': `${txt} ${comparacao}`, html: (r > 0 ? IC.sobe : r < 0 ? IC.desce : '') + esc(txt) });
  }

  function valorTempo(seg) {
    const p = partesTempo(seg);
    const f = document.createDocumentFragment();
    if (!p) { f.append('—'); return f; }
    p.forEach(([n, u]) => { f.append(String(n)); if (u) { const sm = document.createElement('small'); sm.textContent = u; f.append(sm); } else f.append(' '); });
    return f;
  }

  /** Cartão com o fio de brilho embaixo. `acoes`: nós extras no cabeçalho (o "i" e o lápis no Dashboard). */
  function cartao(ui, rotulo, valor, seloEl, opcoes = {}) {
    const el = ui.el;
    const v = el('span', { class: 'pn-cartao-v' + (opcoes.nada ? ' pn-nada' : ''), 'aria-label': opcoes.aria });
    if (valor instanceof Node) v.append(valor); else v.textContent = valor;
    return el('div', { class: 'pn-cartao', role: 'group', 'aria-label': rotulo },
      el('div', { class: 'pn-cartao-cab' }, el('span', { class: 'pn-cartao-r', text: rotulo }), ...(opcoes.acoes || [])), v,
      seloEl || (opcoes.sub ? el('span', { class: 'pn-cartao-s', text: opcoes.sub }) : null));
  }

  // ---------- visão individual: a atendente (só os números dela) ou uma pessoa aberta pela gestão ----------
  const variacao = (c) => (c && c.anterior ? ((c.total - c.anterior) / c.anterior) * 100 : null);
  /** Cartões da pessoa (painel lateral que a gestão abre ao tocar numa pessoa). */
  function numerosPessoa(ui, d) {
    const comp = COMPARA[d.periodo] || 'vs período anterior';
    const T = d.tempoMedioRespostaSeg || {}, C = d.conversaoPct || {};
    const sT = T.atual != null && T.anterior != null ? selo(ui, T.anterior ? ((T.atual - T.anterior) / T.anterior) * 100 : null, '%', comp, true) : null;
    return ui.el('div', { class: 'pn-cartoes', role: 'list', 'aria-label': 'Números do período' },
      cartao(ui, d.pessoa?.ia ? 'Conversas que respondeu' : 'Conversas atendidas', fmtN(d.conversas?.total || 0), selo(ui, variacao(d.conversas), '%', comp)),
      cartao(ui, 'Agendamentos', fmtN(d.agendamentos?.total || 0), selo(ui, variacao(d.agendamentos), '%', comp)),
      cartao(ui, 'Conversão', fmtPct(C.atual), C.atual != null && C.anterior != null ? selo(ui, C.atual - C.anterior, ' p.p.', comp) : null, { nada: C.atual == null, sub: 'conversa → horário' }),
      cartao(ui, 'Tempo de resposta', valorTempo(T.atual), sT, { nada: T.atual == null, aria: fmtTempo(T.atual), sub: 'média' }),
      ...(d.pessoa?.ia ? [] : [cartao(ui, 'Ligações', fmtN(d.ligacoes?.total || 0), null, { sub: NO_PERIODO[d.periodo] })]));
  }
  /** "Agora": conversas da pessoa e quantas esperam resposta dela. */
  function corpoAgora(ui, d, { abrirConversas = false } = {}) {
    const el = ui.el;
    if (d.pessoa?.ia || !d.agora) return null;
    const esperando = d.agora.esperando || 0;
    const irEsperando = () => { window.SintoniaPainel?.fechar(); ui.mostrar('conversas'); document.querySelector('[data-f="esperando"]')?.click(); };
    return el('div', { class: 'pn-agora' },
      el('div', {}, el('b', { text: fmtN(d.agora.conversasDela || 0) }), el('span', { text: abrirConversas ? 'conversas suas' : 'conversas dela' })),
      abrirConversas
        ? el('button', { type: 'button', class: esperando ? 'pn-alerta' : '', onclick: irEsperando, title: 'Ver quem está esperando' }, el('b', { text: fmtN(esperando) }), el('span', { text: 'esperando sua resposta' }))
        : el('div', { class: esperando ? 'pn-alerta' : '' }, el('b', { text: fmtN(esperando) }), el('span', { text: 'esperando resposta dela' })));
  }
  /** Gestão: toca numa pessoa da equipe (ou na IA) e os números dela abrem no painel lateral. */
  async function abrirPessoa(ui, p) {
    const el = ui.el;
    const P = window.SintoniaPainel; if (!P) return;
    const periodo = s.periodo;
    P.abrir({ id: 'painel-pessoa', titulo: p.nome, montar: async (corpo) => {
      corpo.append(el('div', { class: 'pn pn-painel-pessoa' }, el('p', { class: 'pn-vazio', text: 'Carregando os números…' })));
      try {
        const d = await ui.api(`/api/painel/pessoa?periodo=${encodeURIComponent(periodo)}&usuarioId=${encodeURIComponent(p.usuarioId)}`);
        const av = d.pessoa.ia ? el('span', { class: 'pn-ini pn-robo', html: IC.brilho }) : el('span', { class: 'pn-ini', text: iniciais(d.pessoa.nome) });
        if (!d.pessoa.ia) window.SintoniaFotos?.aplicar(av, d.pessoa.id);
        const agora = corpoAgora(ui, d);
        corpo.replaceChildren(el('div', { class: 'pn pn-painel-pessoa' },
          el('div', { class: 'pn-pessoa-cab' }, av, el('span', {}, el('b', { text: d.pessoa.nome }), el('small', { text: `${(PERIODOS.find(([k]) => k === periodo) || [])[1] || ''} · atualizado às ${ui.hm(new Date())}` }))),
          numerosPessoa(ui, d), agora ? el('section', { class: 'pn-p' }, el('div', { class: 'pn-b-cab' }, el('h2', { text: 'Agora' })), agora) : null));
      } catch (x) { corpo.replaceChildren(el('p', { class: 'pn-vazio', text: x.message || 'Não deu para carregar.' })); }
    } });
  }

  // =====================================================================================================
  // Métricas: o que cada número conta, de onde vem e como comparar. Só o que as APIs já trazem (nada inventado).
  //   /api/painel/completo (período escolhido): leads, agendamentos, conversão, 1ª resposta, respostas, IA × equipe.
  //   /api/comercial/resumo → vendido (mês até agora): vendido, comparecimentos, ticket médio, agendamentos do mês.
  //   /api/painel/completo da atendente: só os números dela (conversas, agendamentos, conversão, tempo, ligações).
  // =====================================================================================================
  const nomeDe = (m, c) => (typeof m.nome === 'function' ? m.nome(c) : m.nome);
  const ateDiaDe = (V) => (V?.anterior?.ate ? Number(new Intl.DateTimeFormat('pt-BR', { day: 'numeric', timeZone: 'America/Bahia' }).format(new Date(new Date(V.anterior.ate).getTime() - 1))) : null);
  const deQuem = (c) => (c.V?.de === 'voce' || c.pessoal ? ' Só os seus.' : c.d?.escopo === 'unidades' ? ' Só das suas unidades.' : ' Da empresa toda.');
  const METRICAS = {
    vendido: {
      nome: (c) => (c.V?.de === 'voce' ? 'Você vendeu' : 'Vendido'), tipo: 'brl', base: 'mes', serie: 'vendido',
      pode: (c) => Boolean(c.V?.podeVerValor && c.V.valor != null),
      ler: (c) => ({ v: c.V.valor, ant: c.V.anterior?.valor }),
      explica: (c) => `Soma do valor dos serviços de quem compareceu em ${nomeMes(c.V?.mes)}, do dia 1 até agora. Agendou e não compareceu não conta. O valor vem do próprio agendamento ou da tabela de preços do Comercial.${deQuem(c)}`,
    },
    comparecimentos: {
      nome: 'Comparecimentos', tipo: 'n', base: 'mes', serie: 'comparecimentos',
      pode: (c) => Boolean(c.V && c.V.comparecimentos != null),
      ler: (c) => ({ v: c.V.comparecimentos, ant: c.V.anterior?.comparecimentos }),
      explica: (c) => `Agendamentos marcados em ${nomeMes(c.V?.mes)} em que a cliente já está como “compareceu” (etapa Compareceu ou Manutenção). Vem dos agendamentos do Comercial.${deQuem(c)}`,
    },
    ticket: {
      nome: 'Ticket médio', tipo: 'brl', base: 'mes', serie: 'vendido',
      pode: (c) => Boolean(c.V?.podeVerValor && c.V.valor != null && c.V.comparecimentos != null),
      ler: (c) => ({ v: c.V.comparecimentos ? c.V.valor / c.V.comparecimentos : null, ant: c.V.anterior?.comparecimentos ? c.V.anterior.valor / c.V.anterior.comparecimentos : null }),
      explica: (c) => `Vendido ÷ comparecimentos de ${nomeMes(c.V?.mes)}: quanto, em média, cada cliente que compareceu deixou. Sem comparecimento no mês, fica em branco.${deQuem(c)}`,
    },
    agMes: {
      nome: (c) => (c.V?.de === 'voce' || c.pessoal ? 'Seus agendamentos no mês' : 'Agendamentos no mês'), tipo: 'n', base: 'mes', serie: 'agDia',
      pode: (c) => Boolean(c.V || (c.meta && !c.meta.oculta && !c.pessoal)),
      ler: (c) => (c.V ? { v: c.V.agendamentos, ant: c.V.anterior?.agendamentos } : { v: c.meta.agendamentos, ant: undefined }),
      explica: (c) => `Horários marcados em ${nomeMes(c.V?.mes || c.meta?.mes)}, do dia 1 até agora, pela IA e pela equipe.${deQuem(c)}`,
    },
    agendamentos: {
      nome: (c) => (c.pessoal ? 'Seus agendamentos' : 'Agendamentos'), tipo: 'n', base: 'periodo', serie: 'agendamentos',
      pode: (c) => Boolean(c.d?.agendamentos),
      ler: (c) => ({ v: c.d.agendamentos.total || 0, ant: c.d.agendamentos.anterior ?? null }),
      explica: (c) => (c.pessoal ? `Horários que você marcou ${NO_PERIODO[c.periodo]}.` : `Horários marcados ${NO_PERIODO[c.periodo]}, pela IA e pela equipe, nas unidades que você vê.`) + ` Compara com o período anterior do mesmo tamanho.`,
    },
    leads: {
      nome: 'Leads', tipo: 'n', base: 'periodo', serie: 'leads',
      pode: (c) => Boolean(!c.pessoal && c.d?.leads),
      ler: (c) => ({ v: c.d.leads.total || 0, ant: c.d.leads.anterior ?? null }),
      explica: (c) => `Clientes novas que chamaram pela primeira vez ${NO_PERIODO[c.periodo]} (WhatsApp e os outros canais ligados), nas unidades que você vê. Compara com o período anterior do mesmo tamanho.`,
    },
    conversao: {
      nome: 'Conversão', tipo: 'pct', base: 'periodo', serie: 'leads',
      pode: (c) => Boolean(c.d && (c.pessoal ? c.d.conversaoPct : c.d.agendamentos)),
      ler: (c) => (c.pessoal ? { v: c.d.conversaoPct?.atual ?? null, ant: c.d.conversaoPct?.anterior ?? null } : { v: c.d.agendamentos.conversaoPct ?? null, ant: c.d.agendamentos.conversaoAnteriorPct ?? null }),
      sub: (c) => (c.pessoal ? 'conversa → horário' : 'lead → horário'),
      explica: (c) => (c.pessoal ? `Seus agendamentos ÷ conversas que você atendeu ${NO_PERIODO[c.periodo]}.` : `Agendamentos ÷ leads ${NO_PERIODO[c.periodo]}: de cada 100 clientes novas, quantas marcaram horário.`) + ' A variação é em pontos percentuais (p.p.).',
    },
    primeira: {
      nome: '1ª resposta', tipo: 'tempo', base: 'periodo', menorMelhor: true, serie: 'leads',
      pode: (c) => Boolean(!c.pessoal && c.d?.primeiraResposta),
      ler: (c) => ({ v: c.d.primeiraResposta.geral?.mediaSeg ?? null, ant: undefined }),
      sub: (c) => `média · ${CURTO_PERIODO[c.periodo]}`,
      explica: (c) => `Tempo médio entre a cliente nova chamar e receber a primeira resposta (da IA ou da equipe), ${NO_PERIODO[c.periodo]}. Quanto menor, melhor.`,
    },
    respostas: {
      nome: 'Respostas', tipo: 'n', base: 'periodo', serie: 'leads',
      pode: (c) => Boolean(!c.pessoal && c.d?.tempoResposta),
      ler: (c) => ({ v: c.d.tempoResposta.geral?.n || 0, ant: undefined }),
      sub: (c) => `IA e equipe, ${CURTO_PERIODO[c.periodo]}`,
      explica: (c) => `Mensagens respondidas às clientes ${NO_PERIODO[c.periodo]}, somando a IA e a equipe.`,
    },
    agIa: {
      nome: 'Agendados pela IA', tipo: 'n', base: 'periodo', serie: 'agendamentos',
      pode: (c) => Boolean(!c.pessoal && c.d?.agendamentos),
      ler: (c) => ({ v: c.d.agendamentos.ia || 0, ant: undefined }),
      sub: (c) => { const t = c.d.agendamentos.total || 0; return t ? `${Math.round(((c.d.agendamentos.ia || 0) / t) * 100)}% dos agendamentos` : CURTO_PERIODO[c.periodo]; },
      explica: (c) => `Horários que a IA da Sintonia marcou sozinha ${NO_PERIODO[c.periodo]}, sem ninguém da equipe.`,
    },
    conversas: {
      nome: (c) => (c.d?.pessoa?.ia ? 'Conversas que respondeu' : 'Conversas atendidas'), tipo: 'n', base: 'periodo', serie: 'agDia',
      pode: (c) => Boolean(c.pessoal && c.d?.conversas),
      ler: (c) => ({ v: c.d.conversas.total || 0, ant: c.d.conversas.anterior ?? null }),
      explica: (c) => `Conversas em que você respondeu ${NO_PERIODO[c.periodo]}. Compara com o período anterior do mesmo tamanho.`,
    },
    tempo: {
      nome: 'Tempo de resposta', tipo: 'tempo', base: 'periodo', menorMelhor: true, serie: 'agDia',
      pode: (c) => Boolean(c.pessoal && c.d?.tempoMedioRespostaSeg),
      ler: (c) => ({ v: c.d.tempoMedioRespostaSeg.atual ?? null, ant: c.d.tempoMedioRespostaSeg.anterior ?? null }),
      sub: () => 'média',
      explica: (c) => `Quanto tempo, em média, a cliente esperou pela sua resposta ${NO_PERIODO[c.periodo]}. Quanto menor, melhor.`,
    },
    ligacoes: {
      nome: 'Ligações', tipo: 'n', base: 'periodo', serie: 'agDia',
      pode: (c) => Boolean(c.pessoal && c.d?.ligacoes && !c.d.pessoa?.ia),
      ler: (c) => ({ v: c.d.ligacoes.total || 0, ant: c.d.ligacoes.anterior ?? null }),
      explica: (c) => `Ligações que você registrou ${NO_PERIODO[c.periodo]} (botão Ligar do app ou chamadas do WhatsApp).`,
    },
  };
  const OPCOES_HEROI = ['vendido', 'comparecimentos', 'ticket', 'agMes', 'agendamentos', 'leads', 'conversao', 'conversas'];
  const OPCOES_CARTAO = ['leads', 'agendamentos', 'conversao', 'primeira', 'respostas', 'agIa', 'vendido', 'comparecimentos', 'ticket', 'agMes', 'conversas', 'tempo', 'ligacoes'];
  const opcoesDe = (lista, c) => lista.filter((id) => METRICAS[id].pode(c));
  const baseDe = (m, c) => (m.base === 'mes' ? nomeMes(c.V?.mes || c.meta?.mes) : CURTO_PERIODO[c.periodo]);
  const comparaDe = (m, c) => {
    if (m.base !== 'mes') return COMPARA[c.periodo] || 'vs período anterior';
    const dia = ateDiaDe(c.V);
    return `vs ${mesAnteriorDe(c.V?.mes || c.meta?.mes)}${dia ? ` até dia ${dia}` : ''}`;
  };
  const padraoHeroi = (c) => (METRICAS.vendido.pode(c) ? 'vendido' : METRICAS.agMes.pode(c) ? 'agMes' : 'agendamentos');
  const padraoCartoes = (c) => (c.pessoal ? ['conversas', 'agendamentos', 'conversao', 'tempo'] : ['leads', 'agendamentos', 'conversao', 'primeira']);
  /** A métrica pedida, se ainda puder ser mostrada; senão a primeira que puder. */
  const metricaValida = (id, lista, c, padrao) => (id && lista.includes(id) && METRICAS[id]?.pode(c) ? id : METRICAS[padrao]?.pode(c) ? padrao : opcoesDe(lista, c)[0]);

  /** Valor formatado de uma métrica (dinheiro respeita o olho). `grande`: centavos menores. */
  function valorDe(ui, m, v, grande = false) {
    if (m.tipo === 'tempo') return valorTempo(v);
    if (v == null || !isFinite(v)) return '—';
    if (m.tipo === 'pct') return fmtPct(v);
    if (m.tipo === 'brl') {
      if (s.ocultar) return OCULTO;
      if (!grande) return brlCurto(v);
      const t = brl(v);
      const i = t.lastIndexOf(',');
      const f = document.createDocumentFragment();
      f.append(t.slice(0, i), ui.el('small', { text: t.slice(i) }));
      return f;
    }
    return fmtN(Math.round(v * 10) / 10);
  }
  /** Selo de variação dos cartões. `undefined` em `ant` = métrica sem comparação (mostra a legenda). */
  function seloDe(ui, m, c, x) {
    if (x.ant === undefined) return null;
    const comp = comparaDe(m, c);
    if (m.tipo === 'pct') return x.v != null && x.ant != null ? selo(ui, x.v - x.ant, ' p.p.', comp) : selo(ui, null, '', comp);
    if (x.v == null || !x.ant) return selo(ui, null, '', comp);
    return selo(ui, ((x.v - x.ant) / x.ant) * 100, '%', comp, m.menorMelhor);
  }
  /** Selo do número grande: quanto mudou e em %, com a base escrita ("vs outubro até dia 19"). */
  function chipHeroi(ui, m, c, x) {
    if (x.ant == null || x.v == null) return null;
    const base = comparaDe(m, c);
    const dif = x.v - x.ant;
    const r = Math.round(dif * 10) / 10;
    const bom = m.menorMelhor ? r < 0 : r > 0;
    const cls = r === 0 ? 'pn-igual' : bom ? 'pn-bom' : 'pn-ruim';
    let qtd;
    if (m.tipo === 'pct') qtd = `${fmtDec(Math.abs(r))} p.p.`;
    else if (m.tipo === 'tempo') qtd = fmtTempo(Math.abs(dif));
    else if (m.tipo === 'brl') qtd = s.ocultar ? 'R$ •••' : brlCurto(Math.abs(dif));
    else qtd = fmtN(Math.abs(r));
    const pct = m.tipo !== 'pct' && x.ant ? Math.round((dif / x.ant) * 100) : null;
    const txt = r === 0 ? `igual ${base}` : `${qtd}${pct != null ? ` (${fmtDec(Math.abs(pct), 0)}%)` : ''} ${base}`;
    return ui.el('span', { class: 'pn-chip ' + cls, title: `Comparado com ${base.replace(/^vs /, '')}`, 'aria-label': `${r > 0 ? 'Subiu' : r < 0 ? 'Caiu' : 'Ficou'} ${txt}`, html: (r > 0 ? IC.sobe : r < 0 ? IC.desce : '') + esc(txt) });
  }

  // ---------- topo: título · período · Personalizar · sino ----------
  function topo(ui, d) {
    const el = ui.el;
    const eu = ui.estado.eu || {};
    const av = el('span', { class: 'avatar', 'data-pessoa': eu.id || '', text: iniciais(eu.nome) });
    window.SintoniaFotos?.aplicar(av, eu.id);
    // Anel de presença: verde quando o Dashboard diz que você está online (respondeu ou digitou nos últimos minutos).
    const online = Boolean(eu.id && (d?.ranking || []).some((p) => p.usuarioId === eu.id && p.online));
    const quem = el('button', { class: 'pn-eu' + (online ? ' pn-on' : ''), type: 'button', title: `${eu.nome || 'Sua conta'}${online ? ' · online agora' : ''}`, 'aria-label': `Abrir sua conta${online ? ' (você está online)' : ''}`, onclick: () => ui.mostrar('configuracoes') }, av);
    const trilho = el('div', { class: 'pn-trilho', role: 'group', 'aria-label': 'Período' },
      ...PERIODOS.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(k === s.periodo), onclick: () => trocarPeriodo(k), text: t })));
    const bolinha = el('span', { class: 'pn-bolinha', id: 'pn-sino-qtd', hidden: '' });
    const sino = el('button', { class: 'pn-redondo', type: 'button', id: 'pn-sino', title: 'Notificações', 'aria-label': 'Notificações', html: IC.sino, onclick: () => window.SintoniaTelas?.notificacoes?.abrir?.() }, bolinha);
    copiarSino(bolinha, sino);

    const escopo = d?.escopo;
    const nomeEscopo = escopo === 'pessoal' ? 'Seus números' : escopo === 'unidades' ? `Suas unidades${(eu.unidades || []).length ? ': ' + eu.unidades.map((u) => ui.UNIDADE[u] || u).join(', ') : ''}` : escopo === 'empresa' ? 'Toda a empresa' : '';
    const linha = el('div', { class: 'pn-estado', role: 'status' });
    if (nomeEscopo) linha.append(el('b', { text: nomeEscopo }));
    linha.append(el('span', { class: 'pn-atualizado' + (s.carregando ? ' pn-carregando' : ''), text: d?._em ? `${nomeEscopo ? '· ' : ''}atualizado às ${ui.hm(d._em)}` : 'Carregando os números…' }));
    linha.append(botaoRedondo(ui, IC.recarregar, 'Atualizar agora', () => carregar(true), { class: 'pn-redondo pn-mini' }));
    const podePersonalizar = Boolean(d);
    if (!s.largo && window.SintoniaBotaoTema) linha.append(window.SintoniaBotaoTema('pn-redondo pn-mini'));
    if (!s.largo && podePersonalizar && !s.editando) linha.append(botaoRedondo(ui, IC.grade, 'Personalizar o Dashboard', () => entrarEdicao(), { class: 'pn-redondo pn-mini', id: 'pn-personalizar' }));

    if (s.largo) {
      const titulo = el('div', { class: 'pn-titulo' }, el('h1', { text: s.editando ? 'Personalizando o Dashboard' : 'Dashboard' }),
        s.editando ? el('div', { class: 'pn-estado' }, el('span', { text: 'Arraste os blocos pela alça, troque a métrica no lápis e tire o que não usa.' })) : linha);
      const acoes = s.editando
        ? [el('button', { class: 'pn-pilula', type: 'button', text: 'Voltar ao padrão', onclick: () => voltarAoPadrao() }),
          el('button', { class: 'pn-pilula pn-forte', type: 'button', html: IC.certo + '<span>Pronto</span>', onclick: () => sairEdicao() })]
        : [podePersonalizar ? el('button', { class: 'pn-pilula pn-forte', type: 'button', id: 'pn-personalizar', html: IC.grade + '<span>Personalizar</span>', onclick: () => entrarEdicao() }) : null];
      return [el('header', { class: 'pn-topo' }, quem, titulo, trilho, ...acoes, sino)];
    }
    const partes = [el('header', { class: 'pn-topo' }, quem, trilho, sino), linha];
    if (s.editando) partes.push(el('div', { class: 'pn-editando-barra', role: 'region', 'aria-label': 'Personalizando o Dashboard' },
      el('div', {}, el('b', { text: 'Personalizando o Dashboard' }), el('span', { text: 'Arraste pela alça, troque a métrica no lápis e tire o que não usa.' })),
      el('button', { class: 'pn-pilula', type: 'button', text: 'Voltar ao padrão', onclick: () => voltarAoPadrao() }),
      el('button', { class: 'pn-pilula pn-forte', type: 'button', html: IC.certo + '<span>Pronto</span>', onclick: () => sairEdicao() })));
    return partes;
  }
  /** O sino do Dashboard mostra o mesmo contador do sino do app (/telas/notificacoes.js). */
  function copiarSino(bolinha, sino) {
    const fonte = document.getElementById('sino-cel-qtd') || document.getElementById('lt-sino-qtd');
    const copiar = () => {
      const alvo = document.getElementById('pn-sino-qtd');
      const f = document.getElementById('sino-cel-qtd') || document.getElementById('lt-sino-qtd');
      if (!alvo || !f) return;
      alvo.hidden = f.hidden || !f.textContent.trim();
      alvo.textContent = f.textContent;
      alvo.parentElement?.setAttribute('aria-label', alvo.hidden ? 'Notificações' : `Notificações, ${alvo.textContent} não lidas`);
    };
    if (fonte) { bolinha.hidden = fonte.hidden || !fonte.textContent.trim(); bolinha.textContent = fonte.textContent; if (!bolinha.hidden) sino.setAttribute('aria-label', `Notificações, ${fonte.textContent} não lidas`); }
    if (fonte && !s.sinoObs) { s.sinoObs = new MutationObserver(copiar); s.sinoObs.observe(fonte, { attributes: true, childList: true, characterData: true, subtree: true }); }
  }

  // ---------- popovers: "i" (o que o número conta) e lápis (qual métrica mostrar) ----------
  function posicionar(pop, ancora) {
    const r = ancora.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.min(innerWidth - w - 12, Math.max(12, r.left + r.width / 2 - w / 2));
    let top = r.bottom + 8;
    if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8);
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }
  function abrirPop(ancora, chave, classe, montar) {
    if (s.pop?.chave === chave) { fecharPop(); return; }
    fecharPop();
    const pop = s.ui.el('div', { class: 'pn-pop ' + classe, role: classe === 'pn-menu-m' ? 'menu' : 'dialog' });
    montar(pop);
    (s.raiz || s.caixa).append(pop);
    posicionar(pop, ancora);
    ancora.setAttribute('aria-expanded', 'true');
    s.pop = { chave, el: pop, ancora };
    pop.querySelector('[aria-checked="true"], button')?.focus({ preventScroll: true });
  }
  function fecharPop(redesenhar = true) {
    if (!s.pop) return;
    const { el, ancora } = s.pop;
    s.pop = null;
    el.remove();
    ancora.setAttribute('aria-expanded', 'false');
    if (redesenhar && s.pendente) { s.pendente = false; desenharTudo(); }
  }
  /** Botão "i": um texto curto, em português simples, do que o número conta e de onde vem. */
  function botaoInfo(ui, chave, titulo, texto, fonte) {
    const b = ui.el('button', { class: 'pn-info', type: 'button', html: IC.info, title: `O que é “${titulo}”?`, 'aria-label': `O que é ${titulo}?`, 'aria-expanded': 'false', 'aria-haspopup': 'dialog' });
    b.onclick = (ev) => { ev.stopPropagation(); abrirPop(b, 'i:' + chave, '', (pop) => pop.append(...[ui.el('b', { class: 'pn-pop-t', text: titulo }), ui.el('p', { text: texto }), fonte ? ui.el('small', { text: `De onde vem: ${fonte}` }) : null].filter(Boolean))); };
    return b;
  }
  /**
   * Menu do lápis: escolhe uma das `opcoes` ([{ id, nome, nota }]) e chama `escolher(id)`.
   * `extras`: ações a mais no fim do menu ([{ nome, icone, acao }]).
   */
  function abrirMenu(ancora, chave, titulo, opcoes, atual, escolher, extras = []) {
    const ui = s.ui, el = ui.el;
    abrirPop(ancora, 'm:' + chave, 'pn-menu-m', (pop) => {
      pop.append(el('span', { class: 'pn-pop-cab', text: titulo }));
      for (const o of opcoes) {
        pop.append(el('button', { class: 'pn-op', type: 'button', role: 'menuitemradio', 'aria-checked': String(o.id === atual), onclick: () => { fecharPop(false); if (o.id !== atual) escolher(o.id); else if (s.pendente) { s.pendente = false; desenharTudo(); } } },
          el('span', { text: o.nome }), o.nota ? el('small', { text: o.nota }) : null));
      }
      if (extras.length) {
        pop.append(el('hr'));
        for (const x of extras) pop.append(el('button', { class: 'pn-op', type: 'button', role: 'menuitem', onclick: () => { fecharPop(false); x.acao(); } }, x.icone ? el('span', { html: x.icone, style: 'display:grid' }) : null, el('span', { text: x.nome })));
      }
    });
  }
  function botaoLapis(ui, chave, titulo, abrir) {
    const b = botaoMini(ui, IC.lapis, titulo, null, { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    b.onclick = (ev) => { ev.stopPropagation(); abrir(b); };
    return b;
  }
  const opcoesMetricas = (lista, c) => opcoesDe(lista, c).map((id) => ({ id, nome: nomeDe(METRICAS[id], c), nota: METRICAS[id].base === 'mes' ? 'no mês' : '' }));
  // ---------- curva (SVG puro) ----------
  /** Curva suave monotônica (não passa abaixo de zero nem inventa picos entre pontos). */
  function caminho(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
    const n = pts.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + h * t[i]).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - h * t[i + 1]).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
    }
    return d;
  }
  const teto = (v) => { if (v <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const k of [1, 2, 2.5, 4, 5, 10]) if (k * p >= v) return k * p; return 10 * p; };
  const rotuloDia = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

  function desenharCurva(host, d, sr) {
    const largura = Math.max(260, host.clientWidth || 600);
    const altura = host.clientHeight || 170;
    const pontos = sr.pontos;
    const vis = sr.corte != null ? pontos.slice(0, sr.corte + 1) : pontos; // hoje: a curva para na hora atual
    // Banco (celular): curva ondulada como no modelo 3 — suaviza o desenho (o toque no gráfico mostra o valor real do dia).
    const suave = (arr) => { let v = arr; for (let k = 0; k < 2; k++) v = v.map((x, i) => ((v[i - 1] ?? x) + 2 * x + (v[i + 1] ?? x)) / 4); return v; };
    const vDes = sr.banco ? suave(vis.map((p) => p.v)) : vis.map((p) => p.v);
    const max = sr.banco ? Math.max(1, ...vDes) * 1.08 : teto(Math.max(1, ...vis.map((p) => Math.max(p.v, p.v2 || 0))));
    const esq = sr.banco ? 2 : 12, dir = sr.banco ? 8 : 12, topo = 16, baixo = 24;
    const W = largura - esq - dir, H = altura - topo - baixo;
    const x = (i) => esq + (pontos.length > 1 ? (i / (pontos.length - 1)) * W : W / 2);
    const y = (v) => topo + H - (v / max) * H;
    const pts1 = vis.map((p, i) => [x(i), y(vDes[i])]);
    const pts2 = sr.nome2 ? vis.map((p, i) => [x(i), y(p.v2 || 0)]) : null;
    const soma = vis.reduce((a, p) => a + p.v, 0);
    const media = vis.length ? soma / vis.length : 0;
    const fmtV = (v) => (sr.tipo === 'brl' ? (s.ocultar ? 'R$ •••' : brlCurto(v)) : fmtN(Math.round(v * 10) / 10));
    const fmtEixo = (v) => (sr.tipo === 'brl' ? (s.ocultar ? '' : v >= 1000 ? `R$ ${fmtDec(v / 1000)} mil` : `R$ ${fmtN(Math.round(v))}`) : fmtN(Math.round(v * 10) / 10));
    let h = `<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="${esc(rotuloAcessivel(d, sr, vis, soma))}" preserveAspectRatio="none">
      <defs><linearGradient id="pn-linha" x1="0" x2="1" y1="0" y2="0"><stop offset="0" class="pn-g-1"/><stop offset="1" class="pn-g-2"/></linearGradient>
      <linearGradient id="pn-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="pn-g-2" stop-opacity=".22"/><stop offset="1" class="pn-g-2" stop-opacity="0"/></linearGradient></defs>`;
    for (const f of sr.banco ? [] : [0.5, 1]) {
      const v = max * f;
      h += `<line class="pn-grade-l" x1="${esq}" x2="${largura - dir}" y1="${y(v)}" y2="${y(v)}"/>`;
      const t = fmtEixo(v);
      if (t) h += `<text class="pn-eixo-t" x="${esq}" y="${y(v) - 5}">${esc(t)}</text>`;
    }
    // Rótulos de baixo: poucos, como no app de banco (início, meio e "hoje").
    const passo = sr.porHora ? (largura < 520 ? 6 : 3) : pontos.length > 10 ? (largura < 520 ? 7 : 5) : largura < 420 && pontos.length > 5 ? 2 : 1;
    pontos.forEach((p, i) => {
      const ultimo = i === pontos.length - 1;
      const sobra = (pontos.length - 1) % passo;
      if ((i % passo === 0 && !(sr.porHora ? false : !ultimo && pontos.length - 1 - i < passo / 2 && sobra)) || (!sr.porHora && ultimo)) {
        const ancora = i === 0 ? 'start' : ultimo ? 'end' : 'middle';
        h += `<text class="pn-eixo-t" x="${x(i)}" y="${altura - 4}" text-anchor="${ancora}">${esc(p.rotulo)}</text>`;
      }
    });
    if (soma && !sr.banco) {
      const ym = y(media);
      h += `<line class="pn-meta-l" x1="${esq}" x2="${largura - dir}" y1="${ym}" y2="${ym}"/>`;
      h += `<text class="pn-meta-t" x="${largura - dir}" y="${ym - 6}" text-anchor="end">${esc(`média ${fmtV(media)}/${sr.porHora ? 'h' : 'dia'}`)}</text>`;
    }
    if (pts1.length) {
      const linha = caminho(pts1);
      h += `<path d="${linha}L${pts1[pts1.length - 1][0]},${topo + H}L${pts1[0][0]},${topo + H}Z" fill="url(#pn-area)"/>`;
      if (pts2) h += `<path class="pn-t-2" d="${caminho(pts2)}"/>`;
      h += `<path class="pn-t-1" stroke="url(#pn-linha)" d="${linha}"/>`;
      const [ax, ay] = pts1[pts1.length - 1];
      h += `<circle class="pn-fim" cx="${ax}" cy="${ay}" r="4.5"/>`;
    }
    h += `<g class="pn-foco" style="display:none"><line class="pn-guia" y1="${topo}" y2="${topo + H}"/>${pts2 ? '<circle class="pn-ponto-2" r="4"/>' : '<circle r="0"/>'}<circle class="pn-ponto" r="5"/></g></svg>`;
    host.innerHTML = h;
    const dica = document.createElement('div');
    dica.className = 'pn-dica-g';
    dica.hidden = true;
    host.append(dica);
    if (!soma && !vis.some((p) => p.v2 || p.extra)) {
      if (sr.banco) return; // banco: sem movimento fica só a linha reta, sem balão
      const sem = document.createElement('div');
      sem.className = 'pn-sem-dado';
      sem.innerHTML = `<span>${esc(sr.semDado || (sr.tipo === 'brl' || d.escopo === 'pessoal' ? 'Nada no período ainda. A curva aparece com os primeiros agendamentos.' : `Nenhum lead ${NO_PERIODO[d.periodo]} ainda. A curva aparece quando as clientes chamarem.`))}</span>`;
      host.append(sem);
      return;
    }
    const foco = host.querySelector('.pn-foco');
    const [guia, p2, p1] = foco.children;
    const mostrar = (ev) => {
      const r = host.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * largura;
      const i = Math.max(0, Math.min(vis.length - 1, Math.round(((px - esq) / W) * (pontos.length - 1))));
      const p = vis[i];
      if (!p) return;
      foco.style.display = '';
      guia.setAttribute('x1', pts1[i][0]); guia.setAttribute('x2', pts1[i][0]);
      p1.setAttribute('cx', pts1[i][0]); p1.setAttribute('cy', pts1[i][1]);
      if (pts2) { p2.setAttribute('cx', pts2[i][0]); p2.setAttribute('cy', pts2[i][1]); }
      const titulo = sr.porHora ? `${p.rotulo.replace('h', '')}h às ${Number(p.chave) + 1}h` : `${diaSemana(p.chave)}, ${rotuloDia(p.chave)}`;
      let linhas = `<div><i style="background:linear-gradient(90deg,var(--pn-g1),var(--pn-g2))"></i>${esc(sr.nome1)}<strong>${esc(fmtV(p.v))}</strong></div>`;
      if (sr.nome2) linhas += `<div><i style="background:#7cc4ff"></i>${esc(sr.nome2)}<strong>${fmtN(p.v2)}</strong></div>`;
      else if (sr.extraNome) linhas += `<div><i style="background:#7cc4ff"></i>${esc(sr.extraNome)}<strong>${fmtN(p.extra)}</strong></div>`;
      dica.innerHTML = `<b>${esc(titulo)}</b>${linhas}`;
      dica.hidden = false;
      const xPx = (pts1[i][0] / largura) * r.width;
      const dw = dica.offsetWidth || 140;
      dica.style.left = `${Math.max(0, Math.min(r.width - dw, xPx - dw / 2))}px`;
      const yPx = (Math.min(pts1[i][1], pts2 ? pts2[i][1] : Infinity) / altura) * r.height;
      dica.style.top = `${Math.max(-8, yPx - (dica.offsetHeight || 70) - 14)}px`;
    };
    const esconder = () => { foco.style.display = 'none'; dica.hidden = true; };
    host.onpointermove = mostrar;
    host.onpointerdown = mostrar;
    host.onpointerleave = esconder;
  }

  function rotuloAcessivel(d, sr, vis, soma) {
    if (!soma) return `${sr.titulo}: nada no período.`;
    const pico = vis.reduce((a, p) => (p.v > a.v ? p : a), vis[0]);
    const v = (n) => (sr.tipo === 'brl' ? (s.ocultar ? 'valor escondido' : brl(n)) : fmtN(n));
    return `${sr.titulo}: total ${v(soma)}, pico em ${pico.rotulo} com ${v(pico.v)}.`;
  }

  function exportarCsv(d, sr) {
    const cab = [sr.porHora ? 'Hora' : 'Dia', sr.nome1];
    if (sr.nome2) cab.push(sr.nome2); else if (sr.extraNome) cab.push(sr.extraNome);
    const linhas = [cab];
    for (const p of sr.pontos) {
      const l = [sr.porHora ? p.rotulo : p.chave, sr.tipo === 'brl' ? String(p.v).replace('.', ',') : p.v];
      if (sr.nome2) l.push(p.v2); else if (sr.extraNome) l.push(p.extra);
      linhas.push(l);
    }
    const csv = '﻿' + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `sintonia-${sr.tipo === 'brl' ? 'vendido' : 'leads'}-${d.periodo}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /**
   * A série da curva do número grande, conforme a métrica escolhida. Só dados que já chegam:
   * valor/comparecimentos/agendamentos por dia (Comercial, últimos 30 dias) ou leads e agendamentos do período.
   */
  function serieHeroi(c, mid) {
    const d = c.d, V = c.V;
    const m = METRICAS[mid];
    const hoje = hojeBahia();
    const n = c.periodo === '7d' ? 7 : 30;
    const dias = (V?.porDia || []).slice(-n);
    const rot = (x) => (x.dia === hoje ? 'hoje' : rotuloDia(x.dia));
    const porDia = (titulo, nome1, v, extraNome, extra) => (dias.length ? {
      pontos: dias.map((x) => ({ chave: x.dia, rotulo: rot(x), v: v(x), extra: extra ? extra(x) : undefined })),
      tipo: nome1 === 'Vendido' ? 'brl' : 'n', titulo: `${titulo} · últimos ${dias.length} dias`, nome1, extraNome, porHora: false,
      semDado: 'Nada nesses dias ainda. A curva aparece com os primeiros agendamentos.',
    } : null);
    const serie = m?.serie;
    if (serie === 'vendido' && V?.podeVerValor) return porDia('Vendido por dia', 'Vendido', (x) => x.valor || 0, 'Agendamentos', (x) => x.agendamentos);
    if (serie === 'comparecimentos' && V) return porDia('Comparecimentos por dia', 'Comparecimentos', (x) => x.comparecimentos || 0, 'Agendamentos', (x) => x.agendamentos);
    if (serie === 'agDia' || c.pessoal) return V ? porDia(c.pessoal || V.de === 'voce' ? 'Seus agendamentos por dia' : 'Agendamentos por dia', 'Agendamentos', (x) => x.agendamentos) : null;
    if (!d?.serie) return null;
    const porHora = d.serie.unidade !== 'dia';
    const agPrimeiro = serie === 'agendamentos';
    const pontos = (d.serie.pontos || []).map((p) => ({ chave: p.chave, rotulo: p.rotulo, v: agPrimeiro ? p.agendamentos : p.leads, v2: agPrimeiro ? p.leads : p.agendamentos }));
    return { pontos, tipo: 'n', titulo: `${agPrimeiro ? 'Agendamentos e leads' : 'Leads e agendamentos'} por ${porHora ? 'hora' : 'dia'}`, nome1: agPrimeiro ? 'Agendamentos' : 'Leads', nome2: agPrimeiro ? 'Leads' : 'Agendamentos', porHora, corte: d.periodo === 'hoje' && porHora ? horaBahia() : null };
  }

  function curva(ui, d, sr) {
    const el = ui.el;
    const bloco = el('div', { class: 'pn-curva', role: 'group', 'aria-label': sr.titulo });
    const leg = el('span', {},
      el('span', { class: 'pn-leg' }, el('i', { class: 'pn-l-1' }), sr.nome2 ? sr.nome1 : sr.titulo),
      sr.nome2 ? el('span', { class: 'pn-leg' }, el('i', { class: 'pn-l-2' }), sr.nome2) : null,
      el('span', { class: 'pn-leg' }, el('i', { class: 'pn-l-m' }), sr.porHora ? 'média por hora' : 'média por dia'));
    const bMais = botaoMini(ui, IC.mais, 'Mais opções do gráfico', null, { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    bMais.onclick = (ev) => { ev.stopPropagation(); abrirMenu(bMais, 'curva', 'Gráfico', [], null, () => {}, [
      { nome: 'Exportar CSV', icone: IC.baixar, acao: () => exportarCsv(d, sr) },
      { nome: 'Atualizar agora', icone: IC.recarregar, acao: () => carregar(true) },
      { nome: 'Abrir as conversas', icone: IC.abrir, acao: () => ui.mostrar('conversas') }]); };
    const host = el('div', { class: 'pn-grafico' + (sr.banco ? ' pn-grafico-banco' : '') });
    if (sr.banco) bloco.append(host); else bloco.append(host, el('div', { class: 'pn-curva-cab' }, leg, bMais));
    // Desenha quando já tem largura e redesenha quando a largura muda (sem esticar o texto).
    requestAnimationFrame(() => desenharCurva(host, d, sr));
    s.observador?.disconnect();
    if ('ResizeObserver' in window) {
      let ultima = 0;
      s.observador = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w && Math.abs(w - ultima) > 2) { ultima = w; desenharCurva(host, d, sr); } });
      s.observador.observe(host);
    }
    return bloco;
  }

  // ---------- meta do mês ----------
  function anel(pct) {
    const r = 26, c = 2 * Math.PI * r, f = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="pn-anel-g" x1="0" x2="1"><stop offset="0" class="pn-g-1"/><stop offset="1" class="pn-g-2"/></linearGradient></defs>
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="var(--pn-anel-trilho)" stroke-width="6"/>
      ${f ? `<circle cx="32" cy="32" r="${r}" fill="none" stroke="url(#pn-anel-g)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>` : ''}</svg>`;
  }
  const metaValorDe = (c) => (c.V?.podeVerValor && c.V.de === 'equipe' ? s.comercial?.metas?.equipe?.meta?.valor || null : null);
  const opcoesMeta = (c) => [{ id: 'agendamentos', nome: 'Agendamentos', nota: c.meta?.meta ? '' : 'sem meta' }, ...(metaValorDe(c) ? [{ id: 'vendido', nome: 'Vendido (R$)', nota: 'Comercial' }] : [])];
  const metaEscolhida = (c, b) => (b.metrica === 'agendamentos' ? 'agendamentos' : b.metrica === 'vendido' && metaValorDe(c) ? 'vendido' : metaValorDe(c) ? 'vendido' : 'agendamentos');

  function corpoMeta(ui, c, b) {
    const el = ui.el;
    const m = c.meta;
    if (m === undefined) return [el('div', { class: 'pn-meta-l' }, el('div', { class: 'pn-esq', style: 'width:64px;height:64px;border-radius:50%' }), el('div', { class: 'pn-meta-txt' }, el('span', { text: 'Carregando…' })))];
    if (m === null) return [el('div', { class: 'pn-vazio', text: 'Não deu para carregar a meta agora. Tentamos de novo na próxima atualização.' })];
    const mes = nomeMes(m.mes);
    const dias = Math.max(1, m.diasRestantes || 1);
    const qual = metaEscolhida(c, b);
    let pct, grande, linha1, linha2 = null;
    if (qual === 'vendido') {
      const alvo = metaValorDe(c), feito = c.V.valor || 0, falta = Math.max(0, alvo - feito);
      const R = (v) => (s.ocultar ? 'R$ •••' : brlCurto(v));
      pct = (feito / alvo) * 100;
      grande = `${R(feito)} de ${R(alvo)}`;
      linha1 = falta ? `faltam ${R(falta)} em ${plural(dias, 'dia', 'dias')} · ${R(falta / dias)}/dia` : `Meta batida em ${mes}!`;
      if (m.meta) linha2 = `Agendamentos: ${fmtN(m.agendamentos)} de ${fmtN(m.meta)}${m.faltam ? ` · faltam ${fmtN(m.faltam)}` : ' · meta batida'}`;
    } else if (m.meta) {
      pct = m.progressoPct;
      grande = `${fmtN(m.agendamentos)} de ${fmtN(m.meta)}`;
      linha1 = m.faltam ? `faltam ${plural(m.faltam, 'agendamento', 'agendamentos')} em ${plural(dias, 'dia', 'dias')} · ${fmtDec(m.faltam / dias)}/dia` : `Meta batida! ${plural(m.agendamentos, 'agendamento', 'agendamentos')} em ${mes}.`;
    } else {
      pct = null;
      grande = plural(m.agendamentos, 'agendamento', 'agendamentos');
      linha1 = m.podeEditar ? 'Sem meta definida. Toque no lápis e defina quantos agendamentos a loja quer no mês.' : 'A gestão ainda não definiu a meta deste mês.';
      linha2 = `${plural(m.diasRestantes, 'dia restante', 'dias restantes')} em ${mes}`;
    }
    const an = el('div', { class: 'pn-anel', role: 'img', 'aria-label': pct != null ? `${Math.round(pct)}% da meta de ${mes}` : `Sem meta em ${mes}`, html: anel(pct) },
      el('b', { text: pct != null ? `${Math.round(pct)}%` : '—' }));
    const partes = [el('div', { class: 'pn-meta-l' }, an, el('div', { class: 'pn-meta-txt' }, el('b', { text: grande }), el('span', { text: linha1 }), linha2 ? el('small', { text: linha2 }) : null))];
    if (s.editandoMeta && m.podeEditar) {
      const input = el('input', { type: 'number', inputmode: 'numeric', min: '1', max: '100000', step: '1', id: 'pn-meta-n', value: m.meta ?? '', placeholder: 'Ex.: 120' });
      const salvar = async (valor) => {
        try {
          s.meta = await ui.api('/api/painel/meta', { method: 'PUT', body: JSON.stringify({ agendamentosMes: valor }) });
          s.editandoMeta = false;
          ui.toast(valor ? 'Meta salva ✓' : 'Meta removida');
          desenharTudo();
        } catch (e) { ui.toast(e.message || 'Não deu para salvar a meta.'); }
      };
      const form = el('form', { class: 'pn-meta-form', onsubmit: (ev) => { ev.preventDefault(); const n = Math.round(Number(input.value)); if (!n || n < 1) { ui.toast('Digite quantos agendamentos a loja quer no mês.'); return; } salvar(n); } },
        el('label', { for: 'pn-meta-n', text: `Quantos agendamentos em ${mes}?` }), input,
        el('button', { class: 'pn-botao pn-menta', type: 'submit', text: 'Salvar' }),
        el('button', { class: 'pn-botao pn-vidro', type: 'button', text: 'Cancelar', onclick: () => { s.editandoMeta = false; desenharTudo(); } }));
      if (m.meta) form.append(el('button', { class: 'pn-botao pn-vidro', type: 'button', text: 'Tirar meta', onclick: () => salvar(null) }));
      partes.push(form);
      requestAnimationFrame(() => input.focus());
    } else if (c.d?.escopo && c.d.escopo !== 'empresa' && m.meta && qual === 'agendamentos') {
      partes.push(el('div', { class: 'pn-vazio', style: 'font-size:12.5px', text: 'A meta é da empresa; o progresso conta os agendamentos que você vê.' }));
    }
    return partes;
  }

  // ---------- movimentações (o que aconteceu hoje, como extrato) ----------
  function corpoMovimentacoes(ui, c, b) {
    const el = ui.el;
    const extra = s.extra;
    const soAg = b.metrica === 'agendamentos';
    let fatos = Array.isArray(extra?.atualizacoes) ? extra.atualizacoes.slice().sort((a, x) => new Date(x.em) - new Date(a.em)) : null;
    if (fatos && soAg) fatos = fatos.filter((f) => f.tipo === 'agendamento');
    const lig = !soAg && Array.isArray(extra?.ligacoes?.hoje) ? extra.ligacoes.hoje : null;
    const veDinheiro = c.V ? c.V.podeVerValor : ui.estado.eu ? ui.ehGestor(ui.estado.eu) : true;
    const lista = el('div', { class: 'pn-movs', role: 'list' });
    if (lig && lig.length) {
      const atendeu = lig.filter((x) => x.resultado === 'atendeu' || x.resultado === 'agendou').length;
      const agendou = lig.filter((x) => x.resultado === 'agendou').length;
      lista.append(el('div', { class: 'pn-mov', role: 'listitem' }, el('span', { class: 'pn-mov-ic pn-t-ligacao', html: IC.telefone }),
        el('span', { class: 'pn-mov-c' }, el('b', { text: plural(lig.length, 'ligação hoje', 'ligações hoje') }), el('span', { text: `${atendeu ? `${atendeu} ${atendeu === 1 ? 'atendeu' : 'atenderam'}` : 'ninguém atendeu'} · ${agendou ? `${agendou} ${agendou === 1 ? 'agendou' : 'agendaram'}` : 'nenhum agendamento'}` })),
        el('span', { class: 'pn-mov-v' }, el('strong', { text: fmtN(lig.length) }), el('small', { text: 'equipe' }))));
    }
    if (!fatos) return [lista, el('div', { class: 'pn-vazio', text: 'Não deu para carregar as movimentações de hoje agora. Tentamos de novo na próxima atualização.' })];
    if (!fatos.length) return [lista, el('div', { class: 'pn-vazio', text: soAg ? 'Nenhum agendamento hoje ainda.' : 'Nada por aqui ainda hoje. Agendamentos, vezes que a IA assumiu, pedidos de ajuda, lembretes e follow-ups aparecem aqui conforme acontecem.' })];
    const LIMITE = s.largo ? 7 : 8;
    (s.verTodos ? fatos : fatos.slice(0, LIMITE)).forEach((f) => {
      const tipo = IC[f.tipo] ? f.tipo : 'lembrete';
      const hora = f.em ? ui.hm(f.em) : '';
      const agendou = f.tipo === 'agendamento';
      const titulo = agendou && f.cliente ? `${f.cliente} agendou` : f.titulo || 'Atualização';
      const sub = agendou ? [f.servico, ui.UNIDADE?.[f.unidade] || f.unidade, hora].filter(Boolean).join(' · ') : [f.cliente, f.tipo === 'falha' ? null : f.detalhe, hora].filter(Boolean).join(' · ');
      const comFoto = f.conversaId && (agendou || f.tipo === 'nova_cliente');
      const icone = comFoto ? ui.avatar({ id: f.conversaId }) : el('span', { class: 'pn-mov-ic pn-t-' + tipo, html: IC[tipo] });
      icone.setAttribute('aria-hidden', 'true');
      const temValor = agendou && typeof f.valor === 'number' && veDinheiro;
      const direita = temValor || f.por ? el('span', { class: 'pn-mov-v' },
        temValor ? el('strong', { class: 'pn-mais', text: s.ocultar ? '+R$ •••' : `+${brlCurto(f.valor)}` }) : null,
        f.por ? el('small', { text: f.por }) : null) : null;
      const filhos = [icone, el('span', { class: 'pn-mov-c' }, el('b', { text: titulo }), sub ? el('span', { text: sub }) : null), direita];
      lista.append(f.conversaId
        ? el('button', { class: 'pn-mov', type: 'button', role: 'listitem', title: f.tipo === 'falha' && f.detalhe ? f.detalhe : 'Abrir a conversa', onclick: () => ui.abrir(f.conversaId) }, ...filhos)
        : el('div', { class: 'pn-mov', role: 'listitem', title: f.detalhe || '' }, ...filhos));
    });
    const partes = [lista];
    if (fatos.length > LIMITE) partes.push(el('button', { class: 'pn-botao pn-vidro pn-ver', type: 'button', text: s.verTodos ? 'Mostrar menos' : `Ver tudo (${fatos.length})`, onclick: () => { s.verTodos = !s.verTodos; desenharTudo(); } }));
    return partes;
  }

  // ---------- funil por etapa ----------
  function corpoFunil(ui, c) {
    const el = ui.el;
    const f = Array.isArray(c.d.funil) ? c.d.funil : [];
    const total = f.reduce((a, x) => a + (x.conversas || 0), 0);
    const nome = (x) => x.nome || ui.NOME_ETAPA[x.etapa] || x.etapa;
    const pilha = el('div', { class: 'pn-pilha' + (total ? '' : ' pn-pilha-vazia'), role: 'img', 'aria-label': total ? f.filter((x) => x.conversas).map((x) => `${nome(x)} ${x.conversas}`).join(', ') : 'Funil vazio' });
    for (const x of f) if (x.conversas) pilha.append(el('i', { style: `flex-grow:${x.conversas};background:${COR_ETAPA[x.etapa] || '#7cc4ff'}`, title: `${nome(x)}: ${x.conversas}` }));
    const lista = el('div', { class: 'pn-etapas' });
    for (const x of f) {
      const n = x.conversas || 0;
      const p = total ? Math.round((n / total) * 100) : 0;
      lista.append(el('button', { class: 'pn-etapa' + (n ? '' : ' pn-nula'), type: 'button', 'aria-label': `${nome(x)}: ${plural(n, 'conversa', 'conversas')}, ${p}%. Abrir o Funil`, onclick: () => ui.mostrar('funil') },
        el('i', { style: `background:${COR_ETAPA[x.etapa] || '#7cc4ff'}${n ? '' : ';opacity:.45'}` }),
        el('span', { class: 'pn-nome', text: nome(x) }), el('b', { text: fmtN(n) }), el('small', { text: total ? `${p}%` : '—' })));
    }
    return [el('div', { class: 'pn-total' }, el('b', { text: fmtN(total) }), el('span', { text: `${total === 1 ? 'conversa' : 'conversas'} no funil agora` })), pilha, lista,
      total ? null : el('div', { class: 'pn-vazio', text: 'Ainda não há conversas no funil. Elas entram em “Novo lead” assim que a cliente chama.' })];
  }

  // ---------- equipe (tabela) ----------
  function linhaPessoa(ui, p, pos, opcoes = {}) {
    const el = ui.el;
    const eu = ui.estado.eu?.id && p.usuarioId === ui.estado.eu.id;
    const primeiro = pos === 1 && !opcoes.sozinha && (p.agendamentos > 0 || p.respostas > 0);
    const av = opcoes.ia
      ? el('span', { class: 'pn-ini pn-robo', html: IC.brilho, 'aria-hidden': 'true' })
      : el('span', { class: 'pn-ini' + (primeiro ? ' pn-ouro' : ''), 'aria-hidden': 'true', text: iniciais(p.nome) });
    if (!opcoes.ia) window.SintoniaFotos?.aplicar(av, p.usuarioId);
    if (!opcoes.ia && p.online) av.append(el('i', { class: 'pn-luz', title: 'online agora' }));
    const papel = opcoes.ia ? 'responde e agenda sozinha' : [primeiro ? '1º lugar' : null, eu ? 'você' : null, p.online ? 'online agora' : null].filter(Boolean).join(' · ') || (p.papel === 'recepcionista' ? 'Recepção' : 'Atendente');
    const m = (v, rot, txt) => el('span', { class: 'pn-m' + (!v ? ' pn-zero' : '') }, el('small', { text: rot }), txt ?? fmtN(v));
    const podeAbrir = !opcoes.pessoal && p.usuarioId;
    return el(podeAbrir ? 'button' : 'div', { class: 'pn-pessoa' + (eu && !opcoes.pessoal ? ' pn-eu-l' : ''), role: 'row', ...(podeAbrir ? { type: 'button', title: `Ver os números de ${p.nome}`, onclick: () => abrirPessoa(ui, p) } : {}) },
      el('span', { class: 'pn-pos', role: 'cell', text: opcoes.ia ? '' : `${pos}º` }),
      el('span', { class: 'pn-quem', role: 'cell' }, av, el('span', {}, el('b', { text: p.nome }), el('small', { text: papel }))),
      m(p.conversas, 'conversas'), m(p.agendamentos, 'agendamentos'),
      m(p.conversaoPct != null ? 1 : 0, 'conversão', fmtPct(p.conversaoPct)),
      m(p.tempoMedioRespostaSeg != null ? 1 : 0, 'tempo médio', fmtTempo(p.tempoMedioRespostaSeg)));
  }
  function corpoEquipe(ui, c) {
    const el = ui.el, d = c.d;
    const ia = (d.ranking || []).find((p) => p.ia);
    const rk = (Array.isArray(d.ranking) ? d.ranking.filter((p) => !p.ia) : []).sort((a, b) => (b.agendamentos || 0) - (a.agendamentos || 0) || (b.respostas || 0) - (a.respostas || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const partes = [];
    if (d.equipe) partes.push(corpoOnline(ui, c));
    if (!rk.length) { partes.push(el('div', { class: 'pn-vazio', text: 'Nenhuma atendente ativa no seu alcance. Cadastre a equipe na aba Equipe para ver o ranking aqui.' })); return partes; }
    partes.push(el('div', { class: 'pn-vazio', style: 'font-size:12.5px;margin-top:-4px', text: 'Toque numa pessoa para ver os números dela.' }));
    const tab = el('div', { class: 'pn-rank', role: 'table', 'aria-label': 'Ranking da equipe' },
      el('div', { class: 'pn-rank-cab', role: 'row' }, ...['#', 'Atendente', 'Conversas', 'Agend.', 'Conversão', 'Tempo méd.'].map((t) => el('span', { role: 'columnheader', text: t }))));
    rk.forEach((p, i) => tab.append(linhaPessoa(ui, p, i + 1, { sozinha: rk.length < 2 })));
    if (ia) tab.append(linhaPessoa(ui, ia, 0, { ia: true, sozinha: true }));
    partes.push(tab);
    if (rk.every((p) => !p.respostas && !p.agendamentos)) partes.push(el('div', { class: 'pn-vazio', text: `Ninguém da equipe respondeu ${NO_PERIODO[d.periodo]} ainda. Cada resposta e cada agendamento entram aqui, com o tempo que a cliente esperou.` }));
    return partes;
  }
  function corpoOnline(ui, c) {
    const el = ui.el, eq = c.d.equipe;
    const on = el('div', { class: 'pn-online', 'aria-label': 'Online agora' });
    if (eq?.onlineNomes?.length) eq.onlineNomes.forEach((nm) => on.append(el('span', { class: 'pn-pil' }, el('span', { class: 'pn-ini', text: iniciais(nm), 'aria-hidden': 'true' }, el('i', { class: 'pn-luz' })), primeiroNome(nm))));
    else on.append(el('span', { class: 'pn-pil pn-ninguem', text: 'Ninguém online agora' }));
    return on;
  }

  // ---------- quem mais agendou (ranking curto, com barra) ----------
  const RANK = {
    agendamentos: { titulo: 'Quem mais agendou', nome: 'Agendamentos', v: (p) => p.agendamentos || 0, fmt: fmtN, ia: true },
    respostas: { titulo: 'Quem mais respondeu', nome: 'Respostas', v: (p) => p.respostas || 0, fmt: fmtN, ia: true },
    conversas: { titulo: 'Quem mais atendeu', nome: 'Conversas atendidas', v: (p) => p.conversas || 0, fmt: fmtN, ia: true },
    conversao: { titulo: 'Melhor conversão', nome: 'Conversão', v: (p) => p.conversaoPct, fmt: fmtPct, ia: true },
    tempo: { titulo: 'Quem responde mais rápido', nome: 'Tempo de resposta', v: (p) => p.tempoMedioRespostaSeg, fmt: fmtTempo, menor: true, ia: true },
  };
  const rankDe = (b) => RANK[b.metrica] || RANK.agendamentos;
  function corpoQuem(ui, c, b) {
    const el = ui.el, R = rankDe(b);
    const lista = (c.d.ranking || []).filter((p) => (R.ia || !p.ia) && R.v(p) != null && (R.menor || R.v(p) > 0));
    lista.sort((a, x) => (R.menor ? R.v(a) - R.v(x) : R.v(x) - R.v(a)) || String(a.nome).localeCompare(String(x.nome), 'pt-BR'));
    if (!lista.length) return [el('div', { class: 'pn-vazio', text: `Ninguém ${R.menor ? 'respondeu' : 'pontuou'} ${NO_PERIODO[c.periodo]} ainda.` })];
    const top = lista.slice(0, 6);
    const ref = R.menor ? Math.min(...top.map(R.v)) : Math.max(...top.map(R.v));
    const caixa = el('div', { class: 'pn-barras', role: 'list' });
    top.forEach((p, i) => {
      const v = R.v(p);
      const f = ref && v > 0 ? (R.menor ? ref / v : v / ref) : 0;
      const av = p.ia ? el('span', { class: 'pn-ini pn-robo', html: IC.brilho, 'aria-hidden': 'true' }) : el('span', { class: 'pn-ini' + (i === 0 ? ' pn-ouro' : ''), 'aria-hidden': 'true', text: iniciais(p.nome) });
      if (!p.ia) window.SintoniaFotos?.aplicar(av, p.usuarioId);
      if (!p.ia && p.online) av.append(el('i', { class: 'pn-luz', title: 'online agora' }));
      const filhos = [el('span', { class: 'pn-pos', text: `${i + 1}º` }), av,
        el('span', { class: 'pn-barra-c' }, el('b', { text: p.ia ? 'IA da Sintonia' : p.nome }), el('span', { class: 'pn-barra-t', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(4, Math.round(f * 100))}%` }))),
        el('span', { class: 'pn-barra-v', text: R.fmt(v) })];
      caixa.append(p.usuarioId && !c.pessoal
        ? el('button', { class: 'pn-barra-l', type: 'button', role: 'listitem', title: `Ver os números de ${p.nome}`, onclick: () => abrirPessoa(ui, p) }, ...filhos)
        : el('div', { class: 'pn-barra-l', role: 'listitem' }, ...filhos));
    });
    return [caixa];
  }

  // ---------- IA vs equipe ----------
  function corpoIaEquipe(ui, c) {
    const el = ui.el, d = c.d;
    const A = d.agendamentos || {}, PR = d.primeiraResposta || {}, TR = d.tempoResposta || {};
    const linha = (titulo, ia, eq, fmt, opcoes = {}) => {
      const a = Number(ia) || 0, b = Number(eq) || 0;
      const barra = el('div', { class: 'pn-vs-barra' + (a + b ? '' : ' pn-vs-vazia'), 'aria-hidden': 'true' });
      if (a + b) {
        // Tempo: barra maior = mais rápido (quem fez a cliente esperar menos).
        const [pa, pb] = opcoes.inverso && a && b ? [b, a] : [a, b];
        if (pa) barra.append(el('i', { class: 'pn-b-ia', style: `flex-grow:${pa}` }));
        if (pb) barra.append(el('i', { class: 'pn-b-eq', style: `flex-grow:${pb}` }));
      }
      return el('div', { class: 'pn-vs-l', role: 'group', 'aria-label': `${titulo}: IA ${fmt(ia)}, equipe ${fmt(eq)}` },
        el('div', { class: 'pn-vs-t' }, el('b', { text: titulo }), opcoes.nota ? el('span', { text: opcoes.nota }) : null),
        el('div', { class: 'pn-vs-n' }, el('span', {}, fmt(ia), el('small', { text: 'IA' })), el('span', {}, fmt(eq), el('small', { text: 'equipe' }))),
        barra);
    };
    const tot = (A.ia || 0) + (A.equipe || 0);
    return [el('div', { class: 'pn-chave' }, el('span', {}, el('i', { style: 'background:linear-gradient(90deg,var(--pn-g1),var(--pn-g2))' }), 'IA da Sintonia'), el('span', {}, el('i', { style: 'background:rgba(124,196,255,.55)' }), 'Equipe')),
      el('div', { class: 'pn-vs' },
        linha('Agendamentos', A.ia || 0, A.equipe || 0, fmtN, { nota: tot ? `IA fez ${Math.round(((A.ia || 0) / tot) * 100)}%` : '' }),
        linha('Respostas', TR.ia?.n || 0, TR.equipe?.n || 0, fmtN),
        linha('1ª resposta (média)', PR.ia?.mediaSeg, PR.equipe?.mediaSeg, (v) => fmtTempo(v), { inverso: true, nota: 'barra maior = mais rápida' })),
      !tot && !(TR.ia?.n || TR.equipe?.n) ? el('div', { class: 'pn-vazio', text: `Sem respostas ${NO_PERIODO[c.periodo]} ainda. Aqui você compara o que a IA e a equipe fizeram.` }) : null];
  }

  // ---------- barras genéricas (origem, serviços, perdas, comissão, transmissões) ----------
  function listaBarras(ui, linhas) {
    const el = ui.el;
    const max = Math.max(1, ...linhas.map((l) => l.n || 0));
    return el('div', { class: 'pn-barras', role: 'list' }, ...linhas.map((l) => el('div', { class: 'pn-barra-l', role: 'listitem' },
      el('span', { class: 'pn-barra-c' }, el('b', { text: l.nome }), l.sub ? el('small', { text: l.sub }) : null, el('span', { class: 'pn-barra-t', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(3, Math.round(((l.n || 0) / max) * 100))}%` }))),
      el('span', { class: 'pn-barra-v' }, l.valor, l.nota ? el('small', { text: l.nota }) : null))));
  }
  const carregandoOu = (ui, x, erro) => (x === undefined ? [ui.el('div', { class: 'pn-esq', style: 'height:90px' })] : x === null ? [ui.el('div', { class: 'pn-vazio', text: erro || 'Não deu para carregar agora. Tentamos de novo na próxima atualização.' })] : null);
  const relDe = () => s.rel[s.periodo];

  function corpoOrigem(ui, c) {
    const r = relDe();
    const espera = carregandoOu(ui, r);
    if (espera) return espera;
    const o = r.origem || {};
    if (!o.total) return [ui.el('div', { class: 'pn-vazio', text: `Nenhum lead novo ${NO_PERIODO[c.periodo]} ainda.` })];
    return [ui.el('div', { class: 'pn-total' }, ui.el('b', { text: fmtN(o.total) }), ui.el('span', { text: `leads ${NO_PERIODO[c.periodo]}` })),
      listaBarras(ui, (o.origens || []).slice(0, 8).map((x) => ({ nome: x.origem, n: x.total, valor: fmtN(x.total), nota: `${Math.round((x.total / o.total) * 100)}%` })))];
  }
  function corpoPerdas(ui, c) {
    const r = relDe();
    const espera = carregandoOu(ui, r);
    if (espera) return espera;
    const p = r.perdas || {};
    const agora = (c.d.funil || []).find((x) => x.etapa === 'perdida')?.conversas;
    const partes = [ui.el('div', { class: 'pn-total' }, ui.el('b', { text: fmtN(p.total || 0) }), ui.el('span', { text: `marcadas como perdidas ${NO_PERIODO[c.periodo]}${agora != null ? ` · ${fmtN(agora)} na etapa agora` : ''}` }))];
    if (p.motivos?.length) partes.push(listaBarras(ui, p.motivos.slice(0, 6).map((x) => ({ nome: x.motivo, n: x.total, valor: fmtN(x.total), nota: x.pct != null ? `${fmtDec(x.pct, 0)}%` : '' }))));
    else partes.push(ui.el('div', { class: 'pn-vazio', text: p.total ? 'Sem motivo informado.' : 'Nenhuma perda no período.' }));
    return partes;
  }
  function corpoServicos(ui, c) {
    const lista = s.comercial?.servicos;
    if (!Array.isArray(lista)) return carregandoOu(ui, s.comercial === undefined ? undefined : null);
    if (!lista.length) return [ui.el('div', { class: 'pn-vazio', text: `Nenhum agendamento em ${nomeMes(c.V?.mes)} ainda.` })];
    const dinheiro = c.V?.podeVerValor;
    return [listaBarras(ui, lista.slice(0, 6).map((x) => ({ nome: x.servico, sub: `${plural(x.compareceram, 'compareceu', 'compareceram')}`, n: x.agendamentos, valor: fmtN(x.agendamentos), nota: dinheiro ? (s.ocultar ? 'R$ •••' : brlCurto(x.valor)) : 'agend.' })))];
  }
  function corpoComissao(ui) {
    const r = s.comissao;
    const espera = carregandoOu(ui, r);
    if (espera) return espera;
    if (!r.ligada) return [ui.el('div', { class: 'pn-vazio', text: 'A comissão está desligada. Ligue em Relatórios › Comercial › Metas e comissão.' })];
    const R = (v) => (s.ocultar ? 'R$ •••' : brl(v));
    const at = (r.atendentes || []).filter((a) => a.comissao > 0).sort((a, b) => b.comissao - a.comissao);
    return [ui.el('div', { class: 'pn-total' }, ui.el('b', { text: R(r.total || 0) }), ui.el('span', { text: 'de comissão no mês' })),
      at.length ? listaBarras(ui, at.slice(0, 6).map((a) => ({ nome: a.nome, sub: plural(a.compareceram ?? 0, 'compareceu', 'compareceram'), n: a.comissao, valor: R(a.comissao) }))) : ui.el('div', { class: 'pn-vazio', text: 'Ninguém tem comissão no mês ainda.' })];
  }
  function corpoTransmissoes(ui) {
    const r = s.transmissoes;
    const espera = carregandoOu(ui, r, 'Transmissões não está disponível agora.');
    if (espera) return espera;
    const cs = (r.campanhas || []).filter((x) => x.contagem?.funil?.enviadas).slice(0, 5);
    if (!cs.length) return [ui.el('div', { class: 'pn-vazio', text: 'Nenhuma transmissão enviada ainda. Os resultados (enviadas, lidas, respostas) aparecem aqui.' })];
    return [listaBarras(ui, cs.map((x) => { const f = x.contagem.funil; return { nome: x.nome, sub: `${fmtN(f.enviadas)} enviadas · ${fmtN(f.lidas)} lidas`, n: f.responderam, valor: fmtN(f.responderam), nota: `responderam${f.enviadas ? ` · ${Math.round((f.responderam / f.enviadas) * 100)}%` : ''}` }; }))];
  }

  // ---------- número solto (um cartão grande de uma métrica) ----------
  function corpoNumero(ui, c, mid) {
    const el = ui.el, m = METRICAS[mid];
    const x = m.ler(c);
    const v = el('div', { class: 'pn-valor' });
    const conteudo = valorDe(ui, m, x.v, true);
    if (conteudo instanceof Node) v.append(conteudo); else v.textContent = conteudo;
    return [el('div', { class: 'pn-num-g' }, v, chipHeroi(ui, m, c, x) || (m.sub ? el('span', { class: 'pn-cartao-s', text: m.sub(c) }) : null))];
  }

  // =====================================================================================================
  // Os blocos. `pode`: aparece para quem (e com os dados que existem); `cat`: grupo na Biblioteca.
  // =====================================================================================================
  const numeroBloco = (mid, cat, desc, lista) => ({
    cat, desc, coluna: 'lateral', lista,
    titulo: (c, b) => nomeDe(METRICAS[metricaValida(b.metrica, lista, c, mid)], c),
    pode: (c) => METRICAS[mid].pode(c),
    metrica: (c, b) => metricaValida(b.metrica, lista, c, mid),
    explica: (c, b) => METRICAS[metricaValida(b.metrica, lista, c, mid)].explica(c),
    dica: (c, b) => baseDe(METRICAS[metricaValida(b.metrica, lista, c, mid)], c),
    opcoes: (c) => opcoesMetricas(lista, c),
    corpo: (ui, c, b) => corpoNumero(ui, c, metricaValida(b.metrica, lista, c, mid)),
  });
  const LISTA_DINHEIRO = ['vendido', 'ticket', 'comparecimentos', 'agMes'];
  const LISTA_ATEND = ['primeira', 'respostas', 'agIa', 'leads', 'agendamentos', 'conversao'];
  const BLOCOS = {
    heroi: { cat: 'Painel', nome: 'Número principal com gráfico', desc: 'O número grande do topo com a curva por dia ou por hora. Escolha a métrica no lápis.', coluna: 'principal', pode: () => true },
    cartoes: { cat: 'Painel', nome: 'Quatro números', desc: 'Leads, agendamentos, conversão e 1ª resposta (ou os que você escolher), com a variação.', coluna: 'principal', pode: () => true, titulo: () => 'Números' },
    movs: { cat: 'Painel', nome: 'Movimentações de hoje', desc: 'O extrato do dia: agendamentos, IA assumindo, pedidos de ajuda, lembretes e ligações.', coluna: 'principal', pode: (c) => !c.pessoal,
      titulo: (c, b) => (b.metrica === 'agendamentos' ? 'Agendamentos de hoje' : 'Movimentações de hoje'),
      dica: () => { const n = s.extra?.atualizacoes?.length; return n ? plural(n, 'registro', 'registros') : ''; },
      explica: () => 'O que aconteceu hoje, do mais novo para o mais antigo: agendamentos (com o valor do serviço), vezes que a IA assumiu, pedidos de ajuda, lembretes, follow-ups e o resumo das ligações. Vem das atualizações do app.',
      opcoes: () => [{ id: 'todas', nome: 'Tudo o que aconteceu' }, { id: 'agendamentos', nome: 'Só agendamentos' }], corpo: corpoMovimentacoes },
    agora: { cat: 'Painel', nome: 'Agora', desc: 'Suas conversas e quantas clientes esperam a sua resposta.', coluna: 'lateral', pode: (c) => c.pessoal && Boolean(c.d?.agora) && !c.d?.pessoa?.ia,
      titulo: () => 'Agora', explica: () => 'Conversas que estão com você agora e quantas clientes mandaram mensagem e ainda esperam a sua resposta. Atualiza a cada 30 segundos.',
      corpo: (ui, c) => [corpoAgora(ui, c.d, { abrirConversas: true })] },
    meta: { cat: 'Comercial', nome: 'Meta do mês', desc: 'Quanto falta para a meta de agendamentos (ou de valor, se o Comercial tiver meta em R$).', coluna: 'lateral', pode: (c) => !c.pessoal && !c.meta?.oculta, classe: 'pn-b-meta',
      titulo: (c, b) => `Meta do mês · ${metaEscolhida(c, b) === 'vendido' ? 'Vendido' : 'Agendamentos'}`,
      explica: (c, b) => (metaEscolhida(c, b) === 'vendido'
        ? `Vendido em ${nomeMes(c.V?.mes)} (valor de quem compareceu) comparado com a meta de valor da equipe, definida em Comercial › Metas e comissão. Mostra quanto falta por dia até o fim do mês.`
        : `Agendamentos de ${nomeMes(c.meta?.mes)} (IA + equipe, do dia 1 até agora) comparados com a meta que a gestão definiu aqui no lápis. Mostra quanto falta por dia até o fim do mês.`),
      opcoes: opcoesMeta,
      extrasMenu: (ui, c) => [
        ...(c.meta?.podeEditar ? [{ nome: c.meta?.meta ? 'Mudar a meta de agendamentos' : 'Definir a meta de agendamentos', icone: IC.alvo, acao: () => { s.editandoMeta = true; desenharTudo(); } }] : []),
        ...(c.gestao && window.SintoniaComercial?.abrirMetas ? [{ nome: 'Metas de valor (Comercial)', icone: IC.dinheiro, acao: () => window.SintoniaComercial.abrirMetas() }] : [])],
      corpo: corpoMeta },
    iaeq: { cat: 'Atendimento', nome: 'IA × equipe', desc: 'Agendamentos, respostas e 1ª resposta da IA comparados com a equipe.', coluna: 'lateral', pode: (c) => !c.pessoal, titulo: () => 'IA × equipe', dica: (c) => CURTO_PERIODO[c.periodo],
      explica: (c) => `Divide ${NO_PERIODO[c.periodo]} o que a IA da Sintonia fez sozinha e o que a equipe fez: agendamentos, respostas enviadas e o tempo médio da primeira resposta (barra maior = mais rápida).`, corpo: corpoIaEquipe },
    quem: { cat: 'Equipe', nome: 'Ranking (quem mais agendou)', desc: 'As 6 primeiras do período, com barra. Troque para respostas, conversas, conversão ou tempo.', coluna: 'lateral', pode: (c) => !c.pessoal && Array.isArray(c.d?.ranking),
      titulo: (c, b) => rankDe(b).titulo, dica: (c) => CURTO_PERIODO[c.periodo],
      explica: (c, b) => `${rankDe(b).nome} de cada pessoa da equipe ${NO_PERIODO[c.periodo]}, incluindo a IA da Sintonia. Toque numa pessoa para ver os números dela.`,
      opcoes: () => Object.entries(RANK).map(([id, r]) => ({ id, nome: r.nome })), corpo: corpoQuem },
    equipe: { cat: 'Equipe', nome: 'Equipe e desempenho', desc: 'Quem está online e a tabela de cada atendente: conversas, agendamentos, conversão e tempo médio.', coluna: 'principal', pode: (c) => !c.pessoal,
      titulo: () => 'Equipe', dica: (c) => (c.d?.equipe ? `${fmtN(c.d.equipe.online)} de ${fmtN(c.d.equipe.ativas)} online` : CURTO_PERIODO[c.periodo]),
      explica: (c) => `Cada atendente das suas unidades ${NO_PERIODO[c.periodo]}: conversas em que respondeu, agendamentos que marcou, conversão (agendamentos ÷ conversas) e o tempo médio que a cliente esperou. Online = respondeu ou digitou nos últimos 10 minutos.`,
      extras: (ui, c) => [ui.ehGestor?.(ui.estado.eu) ? el2(ui, 'button', { class: 'pn-link', type: 'button', text: 'Abrir', title: 'Abrir a equipe', onclick: () => ui.mostrar('equipe') }) : null,
        ui.estado.eu?.permissoes?.relatorios ? el2(ui, 'button', { class: 'pn-desemp', type: 'button', id: 'pn-desempenho', title: 'Ver o desempenho de cada atendente', text: 'Desempenho', onclick: () => ui.mostrar('desempenho') }) : null],
      corpo: corpoEquipe },
    funil: { cat: 'Funil e CRM', nome: 'Funil por etapa', desc: 'Quantas conversas estão em cada etapa do funil agora.', coluna: 'lateral', pode: (c) => !c.pessoal && Array.isArray(c.d?.funil), titulo: () => 'Funil por etapa',
      explica: () => 'Quantas conversas estão em cada etapa do funil neste momento (não depende do período). Vem do CRM: a etapa de cada conversa. Toque numa etapa para abrir o Funil.',
      extras: (ui) => [el2(ui, 'button', { class: 'pn-link', type: 'button', text: 'Abrir', title: 'Abrir o Funil', onclick: () => ui.mostrar('funil') })], corpo: corpoFunil },
    comercial: { cat: 'Comercial', nome: 'Painel do Comercial', desc: 'Minha meta, ranking por dia/semana/mês, serviços, metas e comissão e o Painel na TV.', coluna: 'principal', pode: (c) => !c.pessoal && Boolean(window.SintoniaComercial), classe: 'pn-b-comercial', semCab: true,
      titulo: () => 'Comercial', explica: () => 'O bloco da tela Comercial: ranking da equipe por dia, semana ou mês, serviços mais agendados, metas e comissão. Os valores vêm dos agendamentos e da tabela de preços do Comercial.',
      corpo: (ui) => [window.SintoniaComercial.bloco(ui)] },
    // ---- só pela Biblioteca ----
    vendido: numeroBloco('vendido', 'Comercial', 'O valor de quem compareceu no mês, comparado com o mês passado até o mesmo dia.', LISTA_DINHEIRO),
    ticket: numeroBloco('ticket', 'Comercial', 'Quanto, em média, cada cliente que compareceu deixou no mês.', LISTA_DINHEIRO),
    servicos: { cat: 'Comercial', nome: 'Serviços mais agendados', desc: 'Os serviços com mais agendamentos no mês, quantas compareceram e o valor.', coluna: 'lateral', pode: (c) => !c.pessoal && Boolean(c.V),
      titulo: () => 'Serviços mais agendados', dica: (c) => nomeMes(c.V?.mes),
      explica: (c) => `Os serviços agendados em ${nomeMes(c.V?.mes)}, do mais pedido para o menos, com quantas clientes compareceram e o valor previsto (do agendamento ou da tabela de preços). Vem do Comercial.`, corpo: corpoServicos },
    comissao: { cat: 'Comercial', nome: 'Comissões do mês', desc: 'Quanto cada atendente tem de comissão no mês, pelas regras do Comercial.', coluna: 'lateral', pode: (c) => c.gestao && !c.pessoal && Boolean(c.V?.podeVerValor),
      titulo: () => 'Comissões', dica: (c) => nomeMes(c.V?.mes),
      explica: (c) => `Comissão de cada atendente em ${nomeMes(c.V?.mes)}, calculada pelas regras de Comercial › Metas e comissão sobre quem compareceu.`, corpo: (ui) => corpoComissao(ui) },
    primeira: numeroBloco('primeira', 'Atendimento', 'Quanto tempo, em média, a cliente nova esperou pela primeira resposta.', LISTA_ATEND),
    respostas: numeroBloco('respostas', 'Atendimento', 'Quantas mensagens a IA e a equipe responderam no período.', LISTA_ATEND),
    online: { cat: 'Atendimento', nome: 'Quem está online', desc: 'Quem da equipe respondeu ou digitou nos últimos 10 minutos.', coluna: 'lateral', pode: (c) => !c.pessoal && Boolean(c.d?.equipe),
      titulo: () => 'Quem está online', dica: (c) => (c.d?.equipe ? `${fmtN(c.d.equipe.online)} de ${fmtN(c.d.equipe.ativas)}` : ''),
      explica: () => 'Atendentes e recepcionistas ativas das suas unidades que responderam ou digitaram nos últimos 10 minutos.', corpo: (ui, c) => [corpoOnline(ui, c)] },
    perdas: { cat: 'Funil e CRM', nome: 'Perdidas', desc: 'Quantas conversas foram marcadas como perdidas no período e os motivos.', coluna: 'lateral', pode: (c) => c.gestao && !c.pessoal,
      titulo: () => 'Perdidas', dica: (c) => CURTO_PERIODO[c.periodo],
      explica: (c) => `Conversas que mudaram para a etapa “Perdida” ${NO_PERIODO[c.periodo]}, com o motivo (do campo “Motivo da perda” da ficha, quando existe). Vem dos Relatórios.`, corpo: corpoPerdas },
    origem: { cat: 'Marketing', nome: 'Leads por origem', desc: 'De onde vieram os leads novos do período.', coluna: 'lateral', pode: (c) => c.gestao && !c.pessoal,
      titulo: () => 'Leads por origem', dica: (c) => CURTO_PERIODO[c.periodo],
      explica: (c) => `Leads novos ${NO_PERIODO[c.periodo]} separados pela origem: o campo “Origem” (ou “Como nos conheceu”) da ficha da cliente. Sem esse campo preenchido, conta como WhatsApp (ou Importação, quando veio de planilha). Vem dos Relatórios.`, corpo: corpoOrigem },
    transmissoes: { cat: 'Marketing', nome: 'Resultado das transmissões', desc: 'As últimas campanhas enviadas: enviadas, lidas e quantas responderam.', coluna: 'lateral', pode: (c) => c.gestao && !c.pessoal,
      titulo: () => 'Transmissões', dica: () => 'últimas enviadas',
      explica: () => 'As 5 últimas transmissões que já saíram: quantas mensagens foram enviadas, lidas e quantas clientes responderam (até 7 dias depois). Vem da tela Transmissões.',
      extras: (ui) => [el2(ui, 'button', { class: 'pn-link', type: 'button', text: 'Abrir', onclick: () => ui.mostrar('transmissoes') })], corpo: (ui) => corpoTransmissoes(ui) },
    /* nps-posvenda: resultado da pesquisa de satisfação (desenho em /telas/nps.js) */
    nps: { cat: 'Atendimento', nome: 'Satisfação (NPS)', desc: 'Nota de 0 a 10 depois de finalizar o atendimento: NPS geral e por atendente, com os últimos comentários.', coluna: 'lateral',
      pode: (c) => c.gestao && !c.pessoal && Boolean(window.SintoniaTelas?.nps),
      titulo: () => 'Satisfação (NPS)', dica: (c) => CURTO_PERIODO[c.periodo],
      explica: (c) => `Notas que as clientes deram ${NO_PERIODO[c.periodo]} na pesquisa enviada ao finalizar o atendimento. NPS = % de promotores (9–10) − % de detratores (0–6), de −100 a +100. Por atendente: quem atendeu a conversa.`,
      corpo: (ui) => window.SintoniaTelas.nps.corpoPainel(ui, s.nps?.[s.periodo]) },
  };
  function el2(ui, ...a) { return ui.el(...a); }
  const CATEGORIAS = ['Comercial', 'Atendimento', 'Funil e CRM', 'Marketing', 'Equipe', 'Painel'];
  const ICONE_CAT = { Comercial: IC.dinheiro, Atendimento: IC.conversa, 'Funil e CRM': IC.funil, Marketing: IC.megafone, Equipe: IC.equipe, Painel: IC.grade };
  /** Blocos que pedem dados a mais (só carregados quando estão no Dashboard). */
  const PRECISA = { origem: 'rel', perdas: 'rel', transmissoes: 'transmissoes', comissao: 'comissao', nps: 'nps' };

  // =====================================================================================================
  // Layout: ordem (a do celular), coluna no computador, blocos tirados e a métrica de cada bloco.
  // =====================================================================================================
  function padrao(c) {
    const ids = c.pessoal ? ['heroi', 'cartoes', 'agora'] : ['heroi', 'cartoes', 'meta', 'movs', 'iaeq', 'quem', 'equipe', 'funil', 'comercial'];
    return ids.filter((id) => BLOCOS[id].pode(c)).map((id) => ({ id, coluna: BLOCOS[id].coluna }));
  }
  /** A lista em uso (a guardada, sem blocos que não existem mais), ou o padrão. */
  function blocosAtuais(c) {
    const salvo = s.layout?.blocos;
    if (!Array.isArray(salvo)) return padrao(c);
    return salvo.filter((b) => BLOCOS[b.id]);
  }
  /** Antes de mudar: copia o layout em uso para poder alterar e guardar. */
  function editavel(c) {
    if (!s.layout) s.layout = { versao: 1, blocos: blocosAtuais(c).map((b) => ({ ...b })) };
    return s.layout.blocos;
  }
  function mudarBloco(id, mudar) {
    const c = ctx();
    const lista = editavel(c);
    let b = lista.find((x) => x.id === id);
    if (!b) { b = { id, coluna: BLOCOS[id].coluna }; lista.push(b); }
    mudar(b, lista);
    salvarLayout();
    desenharTudo();
  }
  const limpo = (l) => ({ versao: 1, blocos: l.blocos.map((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== false))) });
  function salvarLayout() {
    clearTimeout(s.salvarT);
    s.salvarT = setTimeout(async () => {
      const l = s.layout ? limpo(s.layout) : null;
      if (!l) return;
      if (s.guardaServidor) {
        try { await s.ui.api('/api/painel/layout', { method: 'PUT', body: JSON.stringify(l) }); return; }
        catch (e) { if (e.status !== 400) s.ui.toast('Não deu para guardar no servidor agora; ficou guardado neste aparelho.'); else { s.ui.toast(e.message || 'Não deu para guardar o Dashboard.'); return; } }
      }
      try { localStorage.setItem(CHAVE_LAYOUT, JSON.stringify(l)); } catch { /* sem armazenamento */ }
    }, 350);
  }
  async function lerLayout() {
    if (s.layoutCarregado) return;
    let local = null;
    try { local = JSON.parse(localStorage.getItem(CHAVE_LAYOUT) || 'null'); } catch { local = null; }
    try {
      const r = await s.ui.api('/api/painel/layout');
      s.guardaServidor = Boolean(r.guardaNoServidor);
      s.layout = r.layout || (s.guardaServidor ? null : local) || null;
    } catch {
      s.guardaServidor = false;
      s.layout = local?.versao === 1 ? local : null;
    }
    s.layoutCarregado = true;
  }
  async function voltarAoPadrao() {
    s.layout = null;
    try { localStorage.removeItem(CHAVE_LAYOUT); } catch { /* nada */ }
    if (s.guardaServidor) { try { await s.ui.api('/api/painel/layout', { method: 'DELETE' }); } catch { /* fica o padrão nesta tela */ } }
    s.ui.toast('Dashboard de volta ao padrão');
    desenharTudo();
    carregar(false);
  }
  function entrarEdicao() { s.editando = true; fecharPop(false); desenharTudo(); }
  function sairEdicao() { s.editando = false; fecharPop(false); desenharTudo(); s.ui.toast('Dashboard guardado ✓'); }

  // ---------- arrastar (pointer events: mouse e dedo; sem biblioteca) ----------
  function arrastar(ev, secao, id) {
    if (ev.button > 0) return;
    ev.preventDefault();
    const pega = ev.currentTarget;
    const r = secao.getBoundingClientRect();
    const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
    const vaga = s.ui.el('div', { class: 'pn-vaga', style: `height:${Math.round(r.height)}px`, 'aria-hidden': 'true' });
    secao.before(vaga);
    secao.classList.add('pn-arrastando');
    Object.assign(secao.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
    secao.style.animation = 'none';
    s.arrastando = true;
    try { pega.setPointerCapture(ev.pointerId); } catch { /* ok */ }
    const mover = (e) => {
      secao.style.transform = `translate(${e.clientX - dx - r.left}px, ${e.clientY - dy - r.top}px)`;
      const alvo = document.elementFromPoint(e.clientX, e.clientY);
      const col = alvo?.closest?.('.pn-col') || (alvo?.closest?.('.pn-vaga') ? vaga.parentElement : null);
      if (col) {
        const irmaos = [...col.children].filter((x) => x.classList.contains('pn-b') && x !== secao);
        const antes = irmaos.find((x) => { const q = x.getBoundingClientRect(); return e.clientY < q.top + q.height / 2; });
        if (antes) { if (vaga.nextElementSibling !== antes) col.insertBefore(vaga, antes); } else if (col.lastElementChild !== vaga) col.append(vaga);
      }
      // Rola a tela quando o bloco chega perto da borda.
      const cx = s.caixa.getBoundingClientRect();
      if (e.clientY < cx.top + 50) s.caixa.scrollTop -= 14; else if (e.clientY > cx.bottom - 50) s.caixa.scrollTop += 14;
    };
    const soltar = () => {
      pega.removeEventListener('pointermove', mover);
      pega.removeEventListener('pointerup', soltar);
      pega.removeEventListener('pointercancel', soltar);
      const col = vaga.parentElement;
      const prox = (() => { let x = vaga.nextElementSibling; while (x && !(x.classList.contains('pn-b') && x !== secao)) x = x.nextElementSibling; return x?.dataset.id; })();
      const ant = (() => { let x = vaga.previousElementSibling; while (x && !(x.classList.contains('pn-b') && x !== secao)) x = x.previousElementSibling; return x?.dataset.id; })();
      const coluna = col?.dataset.coluna;
      vaga.remove();
      s.arrastando = false;
      s.pendente = false;
      mudarBloco(id, (b, lista) => {
        if (coluna === 'principal' || coluna === 'lateral') b.coluna = coluna;
        lista.splice(lista.indexOf(b), 1);
        const i = prox ? lista.findIndex((x) => x.id === prox) : -1;
        const j = ant ? lista.findIndex((x) => x.id === ant) : -1;
        if (i >= 0) lista.splice(i, 0, b); else if (j >= 0) lista.splice(j + 1, 0, b); else lista.push(b);
      });
    };
    pega.addEventListener('pointermove', mover);
    pega.addEventListener('pointerup', soltar);
    pega.addEventListener('pointercancel', soltar);
  }
  /** Teclado na alça: ↑/↓ muda a ordem; ←/→ troca de coluna no computador. */
  function teclaAlca(ev, id) {
    const c = ctx();
    const visiveis = (lista) => lista.filter((b) => !b.oculto && BLOCOS[b.id].pode(c));
    const k = ev.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    ev.preventDefault();
    mudarBloco(id, (b, lista) => {
      if (k === 'ArrowLeft' || k === 'ArrowRight') { if (s.largo) b.coluna = k === 'ArrowLeft' ? 'principal' : 'lateral'; return; }
      const mesma = visiveis(lista).filter((x) => !s.largo || x.coluna === b.coluna);
      const i = mesma.indexOf(b);
      const outro = mesma[k === 'ArrowUp' ? i - 1 : i + 1];
      if (!outro) return;
      const a = lista.indexOf(b), o = lista.indexOf(outro);
      lista[a] = outro; lista[o] = b;
    });
    requestAnimationFrame(() => s.caixa?.querySelector(`.pn-b[data-id="${id}"] .pn-pega`)?.focus());
  }

  // ---------- moldura comum de cada bloco ----------
  function moldura(ui, c, b, conteudo) {
    const el = ui.el, def = BLOCOS[b.id];
    const secao = el('section', { class: 'pn-b' + (def.classe ? ' ' + def.classe : '') + (conteudo.classe ? ' ' + conteudo.classe : '') + (s.entrou ? '' : ' pn-entra'), 'data-id': b.id, 'aria-label': conteudo.titulo });
    const acoes = el('span', { class: 'pn-b-acoes' }, ...(conteudo.acoes || []));
    if (s.editando) {
      const pega = botaoMini(ui, IC.pega, `Arrastar “${conteudo.titulo}” (setas do teclado também mudam a ordem)`, null, { class: 'pn-ib pn-pega' });
      pega.addEventListener('pointerdown', (ev) => arrastar(ev, secao, b.id));
      pega.addEventListener('keydown', (ev) => teclaAlca(ev, b.id));
      acoes.append(pega, el('button', { class: 'pn-tirar', type: 'button', title: `Tirar “${conteudo.titulo}” do Dashboard`, html: IC.tirar + '<span>Tirar</span>', onclick: () => { mudarBloco(b.id, (x) => { x.oculto = true; }); ui.toast(`“${conteudo.titulo}” saiu do Dashboard. Volta pelo “+ Adicionar relatório”.`); } }));
    }
    if (conteudo.cab !== false && (!def.semCab || s.editando)) {
      secao.append(el('div', { class: 'pn-b-cab' }, ...(conteudo.esquerda || [el('h2', { text: conteudo.titulo })]), conteudo.info || null, conteudo.dica ? el('span', { class: 'pn-dica', text: conteudo.dica }) : null, acoes));
    } else if (s.editando) secao.append(el('div', { class: 'pn-b-cab' }, el('h2', { text: conteudo.titulo }), acoes));
    secao.append(...(conteudo.corpo || []).filter(Boolean));
    return secao;
  }

  /** Um bloco qualquer, pelo seu registro. */
  function desenharBloco(ui, c, b) {
    const def = BLOCOS[b.id];
    if (b.id === 'heroi') return blocoHeroi(ui, c, b);
    if (b.id === 'cartoes') return blocoCartoes(ui, c, b);
    const titulo = def.titulo ? def.titulo(c, b) : def.nome;
    const acoes = [...(def.extras ? def.extras(ui, c, b) : [])].filter(Boolean);
    const opcoes = def.opcoes ? def.opcoes(c, b) : null;
    const extrasMenu = def.extrasMenu ? def.extrasMenu(ui, c, b) : [];
    if ((opcoes && opcoes.length > 1) || extrasMenu.length) {
      const atual = def.metrica ? def.metrica(c, b) : b.id === 'meta' ? metaEscolhida(c, b) : b.metrica || opcoes?.[0]?.id;
      acoes.push(botaoLapis(ui, b.id, `Escolher o que “${titulo}” mostra`, (ancora) => abrirMenu(ancora, b.id, 'Mostrar', opcoes && opcoes.length > 1 ? opcoes : [], atual, (id) => mudarBloco(b.id, (x) => { x.metrica = id; }), extrasMenu)));
    }
    return moldura(ui, c, b, {
      titulo, acoes,
      info: botaoInfo(ui, b.id, titulo, def.explica ? def.explica(c, b) : def.desc),
      dica: def.dica ? def.dica(c, b) : '',
      corpo: def.corpo(ui, c, b),
    });
  }

  // ---------- número principal com a curva ----------
  function blocoHeroi(ui, c, b) {
    const el = ui.el;
    const lista = OPCOES_HEROI;
    const mid = metricaValida(b.metrica, lista, c, padraoHeroi(c));
    if (!mid) return moldura(ui, c, b, { titulo: 'Número principal', corpo: [el('div', { class: 'pn-esq', style: 'height:46px;width:220px' })] });
    const m = METRICAS[mid];
    const nome = nomeDe(m, c);
    const x = m.ler(c);
    const abrir = (ancora) => abrirMenu(ancora, 'heroi', 'Mostrar no número grande', opcoesMetricas(lista, c), mid, (id) => mudarBloco('heroi', (bl) => { bl.metrica = id; }));
    const sel = el('button', { class: 'pn-sel', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Trocar a métrica', html: `<span>${esc(nome)}</span>${IC.baixo}` });
    sel.onclick = (ev) => { ev.stopPropagation(); abrir(sel); };
    const acoes = [];
    if (m.tipo === 'brl') {
      acoes.push(botaoMini(ui, s.ocultar ? IC.olhoFechado : IC.olho, s.ocultar ? 'Mostrar os valores' : 'Esconder os valores', () => { s.ocultar = !s.ocultar; gravarOlho(s.ocultar); desenharTudo(); }, { 'aria-pressed': String(s.ocultar) }));
    }
    acoes.push(botaoLapis(ui, 'heroi-l', 'Trocar a métrica do número grande', abrir));
    const valor = el('div', { class: 'pn-valor', 'aria-live': 'polite' });
    const conteudo = valorDe(ui, m, x.v, true);
    if (conteudo instanceof Node) valor.append(conteudo); else valor.textContent = conteudo;
    if (m.tipo === 'brl' && s.ocultar) valor.setAttribute('aria-label', 'Valor escondido');
    const sr = serieHeroi(c, mid);
    // Celular: estilo app de banco (modelo 3). Sem caixa, número centralizado e a curva de ponta a ponta.
    if (!s.largo && !s.editando) {
      const base = baseDe(m, c);
      const rot = el('button', { class: 'pn-banco-rot', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Trocar o que aparece aqui',
        html: `<span>${esc(nome)}${base ? (m.base === 'mes' ? ' em ' : ' · ') + esc(base) : ''}</span>${IC.baixo}` });
      rot.onclick = (ev) => { ev.stopPropagation(); abrir(rot); };
      const linha = el('div', { class: 'pn-banco-linha' }, rot);
      if (m.tipo === 'brl') linha.append(el('button', { class: 'pn-banco-olho', type: 'button', 'aria-pressed': String(s.ocultar), text: s.ocultar ? 'mostrar' : 'ocultar', onclick: () => { s.ocultar = !s.ocultar; gravarOlho(s.ocultar); desenharTudo(); } }));
      const secao = el('section', { class: 'pn-banco' + (s.entrou ? '' : ' pn-entra'), 'data-id': 'heroi', 'aria-label': nome });
      secao.append(linha, valor, chipHeroi(ui, m, c, x) || (m.sub ? el('span', { class: 'pn-cartao-s', text: m.sub(c) }) : null));
      if (sr) secao.append(curva(ui, c.d, { ...sr, banco: true }));
      return secao;
    }
    return moldura(ui, c, b, {
      titulo: nome, acoes,
      esquerda: [sel],
      info: botaoInfo(ui, 'heroi', nome, m.explica(c)),
      dica: baseDe(m, c),
      corpo: [el('div', { class: 'pn-heroi-n' }, valor, chipHeroi(ui, m, c, x) || (m.sub ? el('span', { class: 'pn-cartao-s', text: m.sub(c) }) : null)), sr ? curva(ui, c.d, s.editando ? sr : { ...sr, banco: true }) : null],
    });
  }

  // ---------- os cartões de números (cada um com "i" e lápis) ----------
  function blocoCartoes(ui, c, b) {
    const el = ui.el;
    const lista = opcoesDe(OPCOES_CARTAO, c);
    const pad = padraoCartoes(c);
    const escolhidas = (Array.isArray(b.metricas) && b.metricas.length ? b.metricas : pad).slice(0, 4);
    while (escolhidas.length < 4) escolhidas.push(pad[escolhidas.length]);
    const usadas = new Set();
    const cartoes = escolhidas.map((id, i) => {
      let mid = METRICAS[id]?.pode(c) && !usadas.has(id) ? id : null;
      if (!mid) mid = [pad[i], ...lista].find((x) => x && METRICAS[x]?.pode(c) && !usadas.has(x));
      if (!mid) return null;
      usadas.add(mid);
      const m = METRICAS[mid];
      const nome = nomeDe(m, c);
      const x = m.ler(c);
      const lapis = botaoLapis(ui, 'c' + i, `Trocar o número “${nome}”`, (ancora) => abrirMenu(ancora, 'cartao-' + i, 'Mostrar neste cartão', opcoesMetricas(OPCOES_CARTAO, c), mid,
        (novo) => mudarBloco('cartoes', (bl) => { const ms = escolhidas.slice(); ms[i] = novo; bl.metricas = ms; })));
      const conteudo = valorDe(ui, m, x.v);
      return cartao(ui, nome, conteudo, seloDe(ui, m, c, x), {
        nada: x.v == null, aria: m.tipo === 'tempo' ? fmtTempo(x.v) : undefined,
        sub: m.sub ? m.sub(c) : m.base === 'mes' ? `em ${baseDe(m, c)}` : '',
        // Celular fora do modo de editar: cartão limpo como no app de banco (troca pelo botão de personalizar).
        acoes: !s.largo && !s.editando ? [] : [botaoInfo(ui, 'cartao-' + i, nome, m.explica(c)), lapis],
      });
    }).filter(Boolean);
    const temMes = escolhidas.some((id) => METRICAS[id]?.base === 'mes');
    const temPeriodo = escolhidas.some((id) => METRICAS[id]?.base !== 'mes');
    const nota = temPeriodo ? `Variação dos cartões: ${COMPARA[c.periodo] || 'vs período anterior'}${temMes ? '; os do mês comparam com o mês passado até o mesmo dia' : ''}` : '';
    return moldura(ui, c, b, {
      titulo: 'Números', cab: false, classe: 'pn-solto',
      corpo: [el('div', { class: 'pn-cartoes', role: 'list', 'aria-label': 'Números do período' }, ...cartoes), nota ? el('p', { class: 'pn-comp', text: nota }) : null],
    });
  }

  // =====================================================================================================
  // Biblioteca de relatórios
  // =====================================================================================================
  function abrirBiblioteca() {
    const ui = s.ui, el = ui.el;
    const c = ctx();
    if (!c.d) return;
    fecharPop(false);
    fecharBiblioteca(false);
    const lista = blocosAtuais(c);
    const naTela = (id) => lista.some((b) => b.id === id && !b.oculto);
    const corpo = el('div', { class: 'pn-bib', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'pn-bib-t' },
      el('div', { class: 'pn-bib-cab' }, el('div', {}, el('h2', { id: 'pn-bib-t', text: 'Biblioteca de relatórios' }), el('p', { text: 'Escolha o que entra no seu Dashboard. Só aparecem relatórios com dados que a Sintonia já tem.' })),
        botaoRedondo(ui, IC.fechar, 'Fechar', () => fecharBiblioteca())));
    for (const cat of CATEGORIAS) {
      const itens = Object.entries(BLOCOS).filter(([, def]) => def.cat === cat && def.pode(c));
      if (!itens.length) continue;
      corpo.append(el('h3', { text: cat }));
      for (const [id, def] of itens) {
        const nome = def.nome || nomeDe(METRICAS[id], c);
        corpo.append(el('div', { class: 'pn-bib-it' }, el('span', { class: 'pn-mov-ic', html: ICONE_CAT[cat], 'aria-hidden': 'true' }),
          el('div', {}, el('b', { text: nome }), el('span', { text: def.desc })),
          naTela(id) ? el('span', { class: 'pn-ja', html: IC.certo + '<span>No Dashboard</span>' })
            : el('button', { class: 'pn-botao pn-escuro', type: 'button', text: 'Adicionar', 'aria-label': `Adicionar ${nome}`, onclick: () => adicionar(id, nome) })));
      }
    }
    const fundo = el('div', { class: 'pn-bib-fundo', onclick: (ev) => { if (ev.target === fundo) fecharBiblioteca(); } }, corpo);
    (s.raiz || s.caixa).append(fundo);
    s.bib = fundo;
    corpo.querySelector('button')?.focus({ preventScroll: true });
  }
  function fecharBiblioteca(redesenhar = true) {
    if (!s.bib) return;
    s.bib.remove();
    s.bib = null;
    if (redesenhar && s.pendente) { s.pendente = false; desenharTudo(); }
  }
  function adicionar(id, nome) {
    fecharBiblioteca(false);
    s.pendente = false;
    mudarBloco(id, (b, lista) => {
      // Volta ao lugar de antes se estava tirado; se é novo, entra no fim (na coluna dele).
      if (b.oculto) delete b.oculto;
      else { lista.splice(lista.indexOf(b), 1); lista.push(b); }
    });
    s.ui.toast(`“${nome}” entrou no Dashboard ✓`);
    if (PRECISA[id]) carregar(false);
    requestAnimationFrame(() => s.caixa?.querySelector(`.pn-b[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  // =====================================================================================================
  // Desenho da tela
  // =====================================================================================================
  function ctx() {
    const d = s.cache[s.periodo];
    const eu = s.ui?.estado?.eu;
    return { d, V: s.comercial?.vendido || null, meta: s.meta, periodo: s.periodo, pessoal: d?.escopo === 'pessoal', gestao: !eu || Boolean(s.ui?.ehGestor?.(eu)) };
  }

  const vazio = (d) => (d.escopo === 'pessoal' && d.pessoa ? !d.conversas?.total && !d.agendamentos?.total && !d.respostas?.total : !d.leads?.total) && !d.agendamentos?.total && !(d.funil || []).some((x) => x.conversas) && !(d.ranking || []).some((p) => p.respostas || p.agendamentos) && !d.tempoResposta?.geral?.n;

  function esqueleto(ui) {
    const el = ui.el, b = (st) => el('div', { class: 'pn-esq', style: st });
    const painel = (alt) => el('div', { class: 'pn-b' }, b('height:16px;width:40%'), b(`height:${alt}px;width:100%`));
    const principal = [el('div', { class: 'pn-b' }, b('height:14px;width:150px'), b('height:46px;width:240px'), b('height:170px;width:100%')),
      el('div', { class: 'pn-cartoes' }, b('height:96px;border-radius:20px'), b('height:96px;border-radius:20px'), b('height:96px;border-radius:20px'), b('height:96px;border-radius:20px'))];
    const lateral = [painel(120), painel(200)];
    return el('div', { class: 'pn-colunas' }, el('div', { class: 'pn-col' }, ...principal, ...(s.largo ? [] : lateral)), s.largo ? el('div', { class: 'pn-col' }, ...lateral) : null);
  }

  function desenharTudo() {
    const { caixa, ui } = s;
    if (!caixa || !ui) return;
    // Não redesenha embaixo de quem está arrastando, com um menu aberto ou com a Biblioteca aberta: fica para depois.
    if (s.arrastando || s.pop || s.bib) { s.pendente = true; return; }
    const el = ui.el;
    s.pendente = false;
    s.largo = (caixa.clientWidth || innerWidth) >= LARGURA_DUAS;
    const c = ctx();
    const d = c.d;
    const rolagem = caixa.scrollTop;
    const raiz = el('div', { class: 'pn' + (s.largo ? ' pn-largo' : '') + (s.editando ? ' pn-editando' : ''), 'aria-busy': String(s.carregando) });
    s.raiz = raiz;
    raiz.append(...topo(ui, d));
    if (!d) {
      s.observador?.disconnect();
      if (s.falhou) {
        raiz.append(el('div', { class: 'pn-b pn-erro', role: 'alert' }, el('b', { text: 'Não deu para carregar o Dashboard' }),
          el('span', { text: s.falhou === true ? 'Verifique a internet e tente de novo.' : s.falhou }),
          el('button', { class: 'pn-botao pn-menta', type: 'button', text: 'Tentar de novo', onclick: () => carregar(true) })));
      } else raiz.append(esqueleto(ui));
    } else {
      if (s.falhou) raiz.append(el('div', { class: 'pn-nota', role: 'status', text: 'Sem conexão no momento: mostrando os últimos números. Tentamos de novo a cada 30 segundos.' }));
      if (vazio(d) && !s.editando && s.largo) raiz.append(el('div', { class: 'pn-aviso' }, el('span', { class: 'pn-mov-ic', html: IC.grafico, 'aria-hidden': 'true' }),
        el('div', {}, el('b', { text: c.pessoal ? `Seus números ${NO_PERIODO[d.periodo]} ainda estão zerados` : `Ainda sem movimento ${NO_PERIODO[d.periodo]}` }),
          c.pessoal ? 'Quando as clientes começarem a chamar e você responder, seus leads, tempo de resposta e agendamentos aparecem aqui.' : 'Os números aparecem aqui assim que as clientes começarem a chamar no WhatsApp: leads, tempo de resposta, agendamentos e o ranking da equipe.')));
      const visiveis = blocosAtuais(c).filter((b) => !b.oculto && BLOCOS[b.id].pode(c));
      const montar = (b) => { try { return desenharBloco(ui, c, b); } catch (e) { console.error('painel: bloco', b.id, e); return null; } };
      s.observador?.disconnect();
      if (s.largo) {
        const p = el('div', { class: 'pn-col', 'data-coluna': 'principal' }, ...visiveis.filter((b) => b.coluna !== 'lateral').map(montar).filter(Boolean));
        const l = el('div', { class: 'pn-col', 'data-coluna': 'lateral' }, ...visiveis.filter((b) => b.coluna === 'lateral').map(montar).filter(Boolean));
        raiz.append(el('div', { class: 'pn-colunas' }, p, l));
      } else {
        raiz.append(el('div', { class: 'pn-colunas' }, el('div', { class: 'pn-col', 'data-coluna': 'todas' }, ...visiveis.map(montar).filter(Boolean))));
      }
      if (!visiveis.length) raiz.append(el('div', { class: 'pn-vazio', style: 'text-align:center', text: 'Seu Dashboard está vazio. Use “+ Adicionar relatório” para escolher o que ver.' }));
      raiz.append(el('button', { class: 'pn-adicionar', type: 'button', id: 'pn-adicionar', html: IC.somar + '<span>Adicionar relatório</span>', onclick: (ev) => { ev.stopPropagation(); abrirBiblioteca(); } }));
      // O esmaecer de chegada acontece uma vez só (quando os números chegam pela primeira vez).
      if (!s.entrou && s.comercial !== undefined) s.entrou = true;
    }
    caixa.replaceChildren(raiz);
    caixa.scrollTop = rolagem;
  }

  const visivel = () => s.caixa && s.caixa.isConnected && s.caixa.offsetParent !== null;
  const ontemBahia = () => new Date(new Date(`${hojeBahia()}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  const qsRelatorio = (p) => (p === 'ontem' ? `periodo=personalizado&de=${ontemBahia()}&ate=${ontemBahia()}` : `periodo=${p}`);

  async function carregar(manual) {
    const { ui } = s;
    const g = ++s.geracao;
    const periodo = s.periodo;
    s.carregando = true;
    if (manual) desenharTudo();
    const gestao = !ui.estado.eu || ui.ehGestor(ui.estado.eu);
    await lerLayout();
    // Dados a mais só para os blocos que estão no Dashboard (origem, perdas, transmissões, comissão).
    const ids = new Set((Array.isArray(s.layout?.blocos) ? s.layout.blocos : []).filter((b) => !b.oculto).map((b) => b.id));
    const precisa = new Set([...ids].map((id) => PRECISA[id]).filter(Boolean));
    const nada = Promise.resolve(undefined);
    const [painel, atualizacoes, ligacoes, meta, comercial, rel, transm, comissao, npsR] = await Promise.allSettled([
      ui.api(`/api/painel/completo?periodo=${encodeURIComponent(periodo)}`),
      ui.api('/api/atualizacoes'),
      gestao ? ui.api('/api/ligacoes') : Promise.resolve(null),
      ui.api('/api/painel/meta'),
      ui.api('/api/comercial/resumo'),
      gestao && precisa.has('rel') ? ui.api(`/api/relatorios?${qsRelatorio(periodo)}`) : nada,
      gestao && precisa.has('transmissoes') ? ui.api('/api/transmissoes') : nada,
      gestao && precisa.has('comissao') ? ui.api('/api/comercial/comissao') : nada,
      gestao && precisa.has('nps') ? ui.api(`/api/nps/resumo?periodo=${encodeURIComponent(periodo)}`) : nada,
    ]);
    if (g !== s.geracao) return; // chegou resposta de um pedido mais antigo
    s.carregando = false;
    if (painel.status === 'fulfilled') {
      s.cache[periodo] = { ...painel.value, periodo: painel.value.periodo || periodo, _em: new Date().toISOString() };
      s.falhou = false;
    } else {
      s.falhou = painel.reason?.status && painel.reason.status !== 0 && painel.reason.message ? painel.reason.message : true;
    }
    s.extra = {
      // Falhas internas (tentativas automáticas) não são movimento do negócio: ficam fora do Dashboard.
      atualizacoes: atualizacoes.status === 'fulfilled' ? (Array.isArray(atualizacoes.value) ? atualizacoes.value.filter((f) => f.tipo !== 'falha') : atualizacoes.value) : s.extra?.atualizacoes ?? null,
      ligacoes: ligacoes.status === 'fulfilled' ? ligacoes.value : s.extra?.ligacoes ?? null,
    };
    s.meta = meta.status === 'fulfilled' ? meta.value : s.meta || null;
    s.comercial = comercial.status === 'fulfilled' ? comercial.value : s.comercial || null;
    const guarda = (r, antigo) => (r.status === 'fulfilled' ? (r.value === undefined ? antigo : r.value) : antigo ?? null);
    s.rel[periodo] = guarda(rel, s.rel[periodo]);
    s.transmissoes = guarda(transm, s.transmissoes);
    s.comissao = guarda(comissao, s.comissao);
    s.nps = { ...(s.nps || {}), [periodo]: guarda(npsR, s.nps?.[periodo]) };
    /* fluidez: números iguais aos que já estão na tela = não redesenha (o gráfico não pisca); só atualiza o "atualizado às" */
    const marca = (() => { try { const { _em, ...p } = s.cache[periodo] || {}; return JSON.stringify([p, s.extra, s.meta, s.comercial, s.rel[periodo], s.transmissoes, s.comissao, s.nps[periodo], s.falhou, periodo]).replace(/(\d{4}-\d\d-\d\dT\d\d:\d\d):\d\d(\.\d+)?Z/g, '$1'); } catch { return ''; } })();
    if (!manual && marca && marca === s.marcaDesenho && s.caixa?.isConnected && s.raiz?.isConnected && !s.pendente) {
      const t = s.caixa.querySelector('.pn-atualizado'); const d = s.cache[periodo];
      if (t && d?._em) { t.classList.remove('pn-carregando'); t.textContent = t.textContent.replace(/\d{2}:\d{2}/, ui.hm(d._em)); }
      return;
    }
    s.marcaDesenho = marca;
    // Não redesenha por cima de quem está digitando a meta.
    if (s.caixa?.isConnected && !(s.editandoMeta && !manual && s.caixa.contains(document.activeElement))) desenharTudo();
  }

  function trocarPeriodo(p) {
    if (p === s.periodo) return;
    s.periodo = p;
    gravarPeriodo(p);
    s.falhou = false;
    desenharTudo();
    carregar(false);
  }

  function ligarRelogio() {
    clearInterval(s.timer);
    s.timer = setInterval(() => {
      if (!visivel()) { clearInterval(s.timer); s.timer = null; return; } // a aba saiu: para; volta quando abrir de novo
      if (document.hidden || s.carregando) return;
      carregar(false);
    }, INTERVALO);
  }

  document.addEventListener('click', (ev) => {
    if (s.pop && !ev.target.closest?.('.pn-pop') && !s.pop.ancora.contains(ev.target)) fecharPop();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (s.pop) { const a = s.pop.ancora; fecharPop(); a.focus?.(); } else if (s.bib) { fecharBiblioteca(); document.getElementById('pn-adicionar')?.focus(); }
  });
  addEventListener('resize', () => { if (s.pop) fecharPop(); });

  window.SintoniaTelas.painel = {
    async desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa;
      s.ui = ui;
      caixa.classList.add('pn-caixa');
      s.falhou = false;
      s.carregando = true;
      if (!caixa.dataset.pnRolagem) {
        caixa.dataset.pnRolagem = '1';
        caixa.addEventListener('scroll', () => { if (s.pop) fecharPop(); }, { passive: true });
      }
      // Duas colunas quando a tela do Dashboard fica larga (e uma só quando estreita): redesenha ao cruzar.
      s.tamanhoObs?.disconnect();
      if ('ResizeObserver' in window) {
        s.tamanhoObs = new ResizeObserver(() => { const largo = caixa.clientWidth >= LARGURA_DUAS; if (largo !== s.largo && caixa.clientWidth) desenharTudo(); });
        s.tamanhoObs.observe(caixa);
      }
      /* fluidez: voltando à aba com o Dashboard ainda montado e igual, não remonta tudo (só confere os números) */
      const jaNaTela = s.raiz?.isConnected && caixa.contains(s.raiz) && s.marcaDesenho && !s.pendente && s.largo === ((caixa.clientWidth || innerWidth) >= LARGURA_DUAS);
      if (!jaNaTela) desenharTudo();
      ligarRelogio();
      await carregar(false);
    },
  };
})();
