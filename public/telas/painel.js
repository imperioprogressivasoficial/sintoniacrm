/* Tela "painel" da Sintonia: registra window.SintoniaTelas.painel = { desenhar(caixa, ui) }.
 * Dashboard no jeito de banco digital escuro (modelo 3 aprovado pelo dono), sempre escuro nos dois temas:
 * topo com você (anel de presença), período e sino; "Vendido em <mês>" com olho para esconder os valores;
 * curva do período (SVG puro); quatro cartões com variação; meta do mês com anel; movimentações como extrato;
 * funil por etapa, ranking da equipe (quem está online, Desempenho), IA vs equipe e o Comercial.
 * A atendente vê "Seus números" (só os dela). Sem bibliotecas e sem animação contínua (só um esmaecer ao chegar).
 * Estilos próprios em <style id="estilo-painel">, tudo com prefixo .pn-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const PERIODOS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias']];
  // Hoje compara com ontem até a mesma hora (o servidor corta o período anterior no mesmo horário).
  const COMPARA = { hoje: 'vs ontem, mesma hora', ontem: 'vs anteontem', '7d': 'vs 7 dias antes', '30d': 'vs 30 dias antes' };
  const NO_PERIODO = { hoje: 'hoje', ontem: 'ontem', '7d': 'nos últimos 7 dias', '30d': 'nos últimos 30 dias' };
  const ROTULO_LEADS = { hoje: 'Leads hoje', ontem: 'Leads ontem', '7d': 'Leads em 7 dias', '30d': 'Leads em 30 dias' };
  const CHAVE = 'sintonia.painel.periodo';
  const CHAVE_OLHO = 'sintonia.painel.ocultar';
  const INTERVALO = 30000;
  /** Cores das etapas (só para gráficos). */
  const COR_ETAPA = { novo_lead: '#7cc4ff', em_conversa: '#8CC7E0', interessada: '#5FA8CB', agendada: '#0ffcbe', compareceu: '#FFB199', manutencao: '#F5B800', perdida: '#7D8C99' };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  const CSS = `
  /* ---------- o Dashboard é sempre escuro (banco digital), nos dois temas ---------- */
  .pn-caixa.pn-caixa { padding: 14px 16px 0; gap: 0; color-scheme: dark;
    background: radial-gradient(140% 60% at 50% 0%, #0d3a66 0%, #071c33 55%, #05162a 100%) #05162a;
    --texto: #eaf3fc; --sub: #8fb1d1; --fraco: #7d9cbb; --fundo: #071c33; --painel: #0b2a47; --linha: #143a5e; --hover: #0d3050; --entrada: #0d3050; --icone: #b9d4ee;
    --vidro-fundo: rgba(255, 255, 255, .05); --vidro-forte: #0c2b49; --vidro-borda: rgba(255, 255, 255, .09); --vidro-linha: rgba(255, 255, 255, .07);
    --vidro-brilho: none; --vidro-item: rgba(255, 255, 255, .06); --vidro-ativo: rgba(255, 255, 255, .12);
    --aviso: #2a2410; --aviso-txt: #ffd47a; --ia: #0ffcbe;
    --pn-menta: #0ffcbe; --pn-azul: #3aa0ff; --pn-apoio: #7cc4ff;
    --pn-bom-fundo: rgba(15, 252, 190, .14); --pn-bom-txt: #0ffcbe; --pn-ruim-fundo: rgba(255, 122, 122, .14); --pn-ruim-txt: #ff9a9c;
    --pn-cartao: rgba(255, 255, 255, .05); --pn-cartao-borda: rgba(255, 255, 255, .08); --anel-foto: rgba(255, 255, 255, .22); color: var(--texto); }
  @media (min-width: 761px) { .pn-caixa.pn-caixa { padding: 22px 28px 0; } }
  /* Fora do Dashboard (painel lateral de uma pessoa) os mesmos cartões seguem o tema do app. */
  .pn-painel-pessoa { --fraco: var(--sub); --pn-menta: #0b8f6a; --pn-azul: #106ebe; --pn-apoio: #7cc4ff; --pn-cartao: var(--vidro-item); --pn-cartao-borda: var(--vidro-borda);
    --pn-bom-fundo: rgba(15, 157, 107, .12); --pn-bom-txt: #0b7a5a; --pn-ruim-fundo: rgba(220, 38, 38, .1); --pn-ruim-txt: #b91c1c; }
  [data-tema="escuro"] .pn-painel-pessoa { --pn-menta: #0ffcbe; --pn-azul: #3aa0ff; --pn-bom-fundo: rgba(15, 252, 190, .14); --pn-bom-txt: #0ffcbe; --pn-ruim-fundo: rgba(255, 122, 122, .14); --pn-ruim-txt: #ff9a9c; }

  .pn { display: grid; gap: 16px; padding-bottom: 36px; min-width: 0; max-width: 1240px; width: 100%; margin: 0 auto; }
  @media (max-width: 760px) { .pn { padding-bottom: 120px; gap: 14px; } }
  .pn button { font-family: inherit; }
  .pn :focus-visible { outline: 2px solid var(--pn-menta); outline-offset: 2px; }
  .pn svg.pn-i { width: 20px; height: 20px; display: block; }
  .pn-entra { animation: pn-entra .45s ease-out both; }
  @keyframes pn-entra { from { opacity: 0; transform: translateY(6px); } }

  /* ---------- topo: você · período · sino ---------- */
  .pn-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
  .pn-eu { all: unset; box-sizing: border-box; cursor: pointer; flex: none; border-radius: 50%; display: grid; }
  .pn-eu .avatar { width: 40px; height: 40px; font-size: 14px; background: linear-gradient(135deg, #1a8be0, #0a4c86); color: #fff; box-shadow: 0 0 0 2px rgba(255, 255, 255, .22); }
  .pn-redondo { all: unset; box-sizing: border-box; cursor: pointer; flex: none; position: relative; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
                background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); transition: background .15s ease; }
  .pn-redondo:hover { background: var(--vidro-ativo); }
  .pn-redondo svg { width: 19px; height: 19px; }
  .pn-redondo.pn-mini { width: 32px; height: 32px; } .pn-redondo.pn-mini svg { width: 16px; height: 16px; }
  .pn-bolinha { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center;
                font-size: 10.5px; font-weight: 800; background: #0ffcbe; color: #04172b; box-shadow: 0 0 0 2px #071c33; }
  .pn-bolinha[hidden] { display: none; }
  .pn-trilho { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: rgba(255, 255, 255, .07); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08); min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .pn-trilho::-webkit-scrollbar { display: none; }
  .pn-trilho button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 32px; padding: 0 11px; display: inline-grid; place-items: center; border-radius: 999px; font-size: 12.5px; font-weight: 500; color: #a9c2da; white-space: nowrap; transition: background .15s ease, color .15s ease; }
  .pn-trilho button:hover { color: #eaf3fc; }
  .pn-trilho button[aria-pressed="true"] { background: #eaf3fc; color: #08243f; font-weight: 700; }
  @media (max-width: 370px) { .pn-trilho button { padding: 0 8px; font-size: 12px; } }
  .pn-estado { display: flex; justify-content: center; align-items: center; gap: 6px; font-size: 12px; color: var(--fraco); margin-top: -6px; min-height: 32px; flex-wrap: wrap; text-align: center; }
  .pn-estado b { color: var(--sub); font-weight: 600; }
  .pn-estado .pn-carregando { opacity: .45; }

  /* ---------- herói: vendido no mês ---------- */
  .pn-heroi { text-align: center; display: grid; justify-items: center; gap: 8px; padding: 4px 0 0; min-width: 0; }
  .pn-rot { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--sub); }
  .pn-olho { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; margin: -4px 0; border-radius: 999px; color: var(--sub); font-size: 12.5px; }
  .pn-olho:hover { background: var(--vidro-item); color: var(--texto); }
  .pn-olho svg { width: 17px; height: 17px; }
  .pn-valor { font-size: 44px; font-weight: 800; letter-spacing: -1.5px; line-height: 1.05; font-variant-numeric: tabular-nums; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .pn-valor small { font-size: .5em; font-weight: 700; opacity: .6; letter-spacing: -.5px; }
  @media (max-width: 370px) { .pn-valor { font-size: 38px; } }
  @media (min-width: 761px) { .pn-valor { font-size: 54px; } }
  .pn-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .pn-chip.pn-bom { background: var(--pn-bom-fundo); color: var(--pn-bom-txt); }
  .pn-chip.pn-ruim { background: var(--pn-ruim-fundo); color: var(--pn-ruim-txt); }
  .pn-chip.pn-igual { background: var(--vidro-item); color: var(--sub); }

  /* ---------- curva ---------- */
  .pn-curva { position: relative; display: grid; gap: 4px; margin: 0 -16px; min-width: 0; }
  @media (min-width: 761px) { .pn-curva { margin: 0; } }
  .pn-curva-cab { display: flex; align-items: center; gap: 8px; padding: 0 16px; font-size: 12px; color: var(--fraco); min-height: 32px; }
  @media (min-width: 761px) { .pn-curva-cab { padding: 0; } }
  .pn-curva-cab > span { flex: 1; min-width: 0; display: flex; gap: 6px 14px; flex-wrap: wrap; align-items: center; }
  .pn-leg { display: inline-flex; align-items: center; gap: 6px; }
  .pn-leg i { width: 14px; height: 3px; border-radius: 2px; display: inline-block; }
  .pn-leg i.pn-l-1 { background: linear-gradient(90deg, #0ffcbe, #3aa0ff); }
  .pn-leg i.pn-l-2 { background: rgba(124, 196, 255, .6); }
  .pn-leg i.pn-l-m { height: 0; border-top: 2px dashed var(--fraco); background: none; }
  .pn-grafico { position: relative; height: 170px; touch-action: pan-y; }
  @media (min-width: 761px) { .pn-grafico { height: 240px; } }
  .pn-grafico svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .pn-grafico .pn-eixo-t { font-size: 11px; fill: var(--fraco); font-family: var(--fonte); font-variant-numeric: tabular-nums; }
  .pn-grafico .pn-grade-l { stroke: rgba(255, 255, 255, .06); stroke-width: 1; }
  .pn-grafico .pn-meta-l { stroke: var(--fraco); stroke-opacity: .6; stroke-width: 1.2; stroke-dasharray: 4 6; fill: none; }
  .pn-grafico .pn-meta-t { font-size: 10.5px; fill: var(--fraco); font-weight: 600; font-family: var(--fonte); }
  .pn-grafico .pn-t-1 { stroke-width: 2.4; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .pn-grafico .pn-t-2 { stroke: rgba(124, 196, 255, .55); stroke-width: 1.6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
  .pn-grafico .pn-guia { stroke: #eaf3fc; stroke-opacity: .25; stroke-width: 1; }
  .pn-grafico .pn-ponto { fill: #3aa0ff; stroke: #eaf3fc; stroke-width: 2; }
  .pn-grafico .pn-ponto-2 { fill: #7cc4ff; stroke: #071c33; stroke-width: 2; }
  .pn-dica-g { position: absolute; pointer-events: none; z-index: 3; min-width: 140px; padding: 10px 12px; border-radius: 14px; font-size: 12.5px; display: grid; gap: 4px;
               background: #0c2b49; border: 1px solid rgba(255, 255, 255, .12); box-shadow: 0 12px 30px rgba(0, 0, 0, .35); }
  .pn-dica-g[hidden] { display: none; }
  .pn-dica-g b { font-size: 13px; }
  .pn-dica-g div { display: flex; align-items: center; gap: 6px; color: var(--sub); }
  .pn-dica-g div strong { margin-left: auto; color: var(--texto); font-variant-numeric: tabular-nums; }
  .pn-dica-g i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .pn-sem-dado { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .pn-sem-dado span { padding: 9px 14px; border-radius: 999px; font-size: 13px; color: var(--sub); background: #0c2b49; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .1); max-width: 86%; text-align: center; }

  /* menu ⋯ da curva */
  .pn-menu { position: absolute; z-index: 5; right: 16px; top: 38px; min-width: 210px; padding: 6px; border-radius: 18px; display: grid;
             background: #0c2b49; border: 1px solid rgba(255, 255, 255, .12); box-shadow: 0 18px 40px rgba(0, 0, 0, .4); }
  @media (min-width: 761px) { .pn-menu { right: 0; } }
  .pn-menu[hidden] { display: none; }
  .pn-menu button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border-radius: 12px; font-size: 14px; font-weight: 600; color: var(--texto); }
  .pn-menu button:hover { background: var(--vidro-item); }
  .pn-menu svg { width: 17px; height: 17px; color: var(--sub); }

  /* ---------- cartões (pílulas de vidro) ---------- */
  .pn-cartoes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (min-width: 761px) { .pn-cartoes { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; } }
  .pn-cartoes > .pn-cartao:nth-child(5):last-child { grid-column: 1 / -1; }
  @media (min-width: 761px) { .pn-cartoes > .pn-cartao:nth-child(5):last-child { grid-column: auto; } }
  .pn-cartao { position: relative; overflow: hidden; min-width: 0; border-radius: 20px; padding: 14px; display: grid; gap: 4px; align-content: start;
               background: var(--pn-cartao); box-shadow: inset 0 0 0 1px var(--pn-cartao-borda); }
  .pn-cartao::after { content: ''; position: absolute; left: 14px; right: 14px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, transparent, #0ffcbe, #3aa0ff, transparent); opacity: .7; }
  .pn-cartao-r { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-cartao-v { font-size: 24px; font-weight: 800; letter-spacing: -.02em; line-height: 1.15; margin: 2px 0; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-cartao-v small { font-size: .6em; font-weight: 700; color: var(--sub); margin: 0 3px 0 1px; }
  .pn-cartao-v.pn-nada { color: var(--sub); }
  .pn-cartao-s { font-size: 12px; color: var(--fraco); }
  .pn-cartao .pn-chip { justify-self: start; }
  .pn-comp { margin: -6px 2px 0; font-size: 12px; color: var(--fraco); text-align: center; }

  /* ---------- painéis (seções) ---------- */
  .pn-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1000px) {
    .pn-grade { grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .pn-g-mov { grid-column: span 7; } .pn-g-funil { grid-column: span 5; }
    .pn-g-rank { grid-column: span 7; } .pn-g-iaeq { grid-column: span 5; }
  }
  .pn-p { position: relative; min-width: 0; border-radius: 22px; padding: 16px; display: grid; gap: 14px; align-content: start;
          background: var(--pn-cartao); box-shadow: inset 0 0 0 1px var(--pn-cartao-borda); }
  @media (min-width: 761px) { .pn-p { padding: 18px 20px; } }
  .pn-p-cab { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .pn-p-cab h2 { margin: 0; font-size: 16.5px; font-weight: 700; letter-spacing: -.005em; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-p-cab .pn-dica { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .pn-link { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #0ffcbe; padding: 6px 4px; white-space: nowrap; }
  .pn-link:hover { text-decoration: underline; }
  .pn-desemp { all: unset; box-sizing: border-box; cursor: pointer; flex: none; min-height: 36px; padding: 0 14px; border-radius: 999px; font-weight: 800; font-size: 13px; background: #0ffcbe; color: #04172b; }
  .pn-desemp:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  .pn-vazio { font-size: 14px; color: var(--sub); line-height: 1.5; }
  .pn-vazio b { color: var(--texto); }

  /* ---------- meta do mês ---------- */
  .pn-meta { display: grid; gap: 12px; border-radius: 22px; padding: 16px; background: linear-gradient(135deg, rgba(15, 252, 190, .12), rgba(58, 160, 255, .12)); box-shadow: inset 0 0 0 1px rgba(15, 252, 190, .2); }
  .pn-meta-l { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .pn-anel { position: relative; flex: none; width: 56px; height: 56px; }
  .pn-anel svg { width: 100%; height: 100%; display: block; }
  .pn-anel b { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pn-meta-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .pn-meta-txt b { font-size: 15px; }
  .pn-meta-txt span { font-size: 12.5px; color: var(--sub); line-height: 1.4; }
  .pn-meta-txt small { font-size: 12px; color: var(--fraco); line-height: 1.4; }
  .pn-meta-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pn-meta-form label { font-size: 13px; color: var(--sub); flex-basis: 100%; }
  .pn-meta-form input { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 44px; padding: 0 14px; border-radius: 14px; font-size: 16px; font-weight: 700; color: var(--texto);
                        background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-variant-numeric: tabular-nums; }
  .pn-botao { all: unset; box-sizing: border-box; cursor: pointer; min-height: 44px; padding: 0 18px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 14px; font-weight: 700; white-space: nowrap; }
  .pn-botao.pn-menta { background: #0ffcbe; color: #04172b; }
  .pn-botao.pn-vidro { background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }

  /* ---------- movimentações (extrato) ---------- */
  .pn-movs { display: grid; }
  .pn-mov { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 12px; padding: 11px 2px; border-bottom: 1px solid var(--vidro-linha); min-width: 0; }
  .pn-mov:last-child { border-bottom: 0; }
  button.pn-mov { cursor: pointer; }
  button.pn-mov:hover { background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .05), transparent); }
  .pn-mov .avatar { width: 40px; height: 40px; flex: none; }
  .pn-mov-ic { width: 40px; height: 40px; flex: none; border-radius: 14px; display: grid; place-items: center; background: rgba(255, 255, 255, .07); color: var(--sub); }
  .pn-mov-ic svg { width: 19px; height: 19px; }
  .pn-mov-ic.pn-t-agendamento, .pn-mov-ic.pn-t-ia_assumiu { background: rgba(15, 252, 190, .14); color: #0ffcbe; }
  .pn-mov-ic.pn-t-pediu_ajuda { background: rgba(124, 196, 255, .14); color: #7cc4ff; }
  .pn-mov-ic.pn-t-falha { background: rgba(255, 122, 122, .14); color: #ff9a9c; }
  .pn-mov-ic.pn-t-lembrete { background: rgba(245, 184, 0, .14); color: #f5c84a; }
  .pn-mov-ic.pn-t-ligacao { background: rgba(58, 160, 255, .16); color: #7cc4ff; }
  .pn-mov-c { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .pn-mov-c b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-mov-c span { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-mov-v { flex: none; text-align: right; display: grid; gap: 1px; max-width: 38%; }
  .pn-mov-v strong { font-size: 14px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pn-mov-v strong.pn-mais { color: #0ffcbe; }
  .pn-mov-v small { font-size: 11.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-ver { justify-self: center; }

  /* ---------- funil por etapa ---------- */
  .pn-total { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .pn-total b { font-size: 28px; font-weight: 800; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
  .pn-total span { font-size: 13px; color: var(--sub); }
  .pn-pilha { display: flex; gap: 4px; height: 14px; }
  .pn-pilha i { display: block; min-width: 8px; border-radius: 999px; }
  .pn-pilha.pn-pilha-vazia { border-radius: 999px; background: var(--vidro-item); }
  .pn-etapas { display: grid; }
  .pn-etapa { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 12px minmax(0, 1fr) 44px 44px; gap: 10px; align-items: center; min-height: 44px; padding: 0 6px; font-size: 14px; border-bottom: 1px solid var(--vidro-linha); }
  .pn-etapa:last-child { border-bottom: 0; }
  .pn-etapa:hover { background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .05), transparent); }
  .pn-etapa i { width: 10px; height: 10px; border-radius: 50%; }
  .pn-etapa .pn-nome { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .pn-etapa b { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
  .pn-etapa small { text-align: right; font-size: 12.5px; color: var(--sub); font-variant-numeric: tabular-nums; }
  .pn-etapa.pn-nula { color: var(--sub); }
  .pn-etapa.pn-nula .pn-nome { font-weight: 500; }

  /* ---------- ranking ---------- */
  .pn-online { display: flex; flex-wrap: wrap; gap: 6px; }
  .pn-pil { display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px 4px 4px; border-radius: 999px; background: var(--vidro-item); font-size: 13px; font-weight: 600; }
  .pn-pil .pn-ini { width: 26px; height: 26px; font-size: 10.5px; }
  .pn-pil.pn-ninguem { padding: 6px 12px; color: var(--sub); font-weight: 500; }
  .pn-ini { flex: none; position: relative; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: var(--texto); background: var(--vidro-ativo); }
  .pn-ini.pn-ouro { background: #0ffcbe; color: #04172b; }
  .pn-ini.pn-robo { background: rgba(15, 252, 190, .14); color: #0ffcbe; }
  .pn-ini.pn-robo svg { width: 18px; height: 18px; }
  .pn-luz { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: #16c784; border: 2px solid var(--fundo); }
  .pn-rank { display: grid; gap: 8px; }
  .pn-rank-cab, .pn-pessoa { display: grid; grid-template-columns: 22px minmax(0, 1fr) 72px 64px 76px 84px; gap: 10px; align-items: center; }
  .pn-rank-cab { font-size: 12px; color: var(--sub); font-weight: 600; padding: 0 12px; }
  .pn-rank-cab span:nth-child(n+3) { text-align: right; }
  .pn-pessoa { padding: 8px 12px; border-radius: 16px; background: rgba(255, 255, 255, .045); }
  .pn-pessoa.pn-eu-l { box-shadow: inset 0 0 0 1.5px rgba(15, 252, 190, .5); }
  button.pn-pessoa { font: inherit; color: inherit; text-align: left; border: 0; width: 100%; box-sizing: border-box; cursor: pointer; }
  button.pn-pessoa:hover { background: var(--vidro-ativo); }
  .pn-pos { font-size: 13px; color: var(--sub); font-weight: 800; text-align: center; font-variant-numeric: tabular-nums; }
  .pn-quem { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pn-quem > span:last-child { display: grid; min-width: 0; }
  .pn-quem b { font-size: 14.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-quem small { font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-m { text-align: right; font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pn-m.pn-zero { color: var(--sub); font-weight: 500; }
  .pn-m small { display: none; }
  .pn-rank-p { container-type: inline-size; }
  @container (max-width: 560px) {
    .pn-rank-cab { display: none; }
    .pn-pessoa { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px; }
    .pn-pos { display: none; }
    .pn-quem { grid-column: 1 / -1; }
    .pn-m { text-align: left; display: grid; gap: 1px; padding: 6px 10px; border-radius: 12px; background: rgba(255, 255, 255, .04); }
    .pn-m small { display: block; font-size: 11px; font-weight: 500; color: var(--sub); }
  }

  /* ---------- IA vs equipe ---------- */
  .pn-vs { display: grid; gap: 16px; }
  .pn-vs-l { display: grid; gap: 7px; }
  .pn-vs-t { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--sub); }
  .pn-vs-t b { color: var(--texto); font-weight: 700; }
  .pn-vs-n { display: flex; justify-content: space-between; gap: 8px; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .pn-vs-n span:last-child { text-align: right; }
  .pn-vs-n small { font-size: 12px; font-weight: 600; color: var(--sub); margin-left: 4px; }
  .pn-vs-barra { display: flex; gap: 4px; height: 10px; }
  .pn-vs-barra i { display: block; border-radius: 999px; min-width: 6px; }
  .pn-vs-barra .pn-b-ia { background: linear-gradient(90deg, #0ffcbe, #3aa0ff); }
  .pn-vs-barra .pn-b-eq { background: rgba(124, 196, 255, .55); }
  .pn-vs-barra.pn-vs-vazia { border-radius: 999px; background: var(--vidro-item); }
  .pn-chave { display: flex; gap: 14px; font-size: 12.5px; color: var(--sub); }
  .pn-chave span { display: inline-flex; align-items: center; gap: 6px; }
  .pn-chave i { width: 9px; height: 9px; border-radius: 50%; }

  /* ---------- visão individual (atendente e painel lateral) ---------- */
  .pn-agora { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .pn-agora button, .pn-agora div { all: unset; box-sizing: border-box; display: grid; gap: 2px; padding: 14px; border-radius: 18px; background: var(--vidro-item); }
  .pn-agora button { cursor: pointer; }
  .pn-agora b { font-size: 26px; font-weight: 800; letter-spacing: -.02em; }
  .pn-agora span { font-size: 13px; color: var(--sub); }
  .pn-agora .pn-alerta b { color: #fcd34d; }
  .pn-pessoa-cab { display: flex; align-items: center; gap: 12px; }
  .pn-pessoa-cab .pn-ini { width: 48px; height: 48px; font-size: 16px; }
  .pn-pessoa-cab b { font-size: 18px; } .pn-pessoa-cab small { display: block; color: var(--sub); font-size: 13px; }
  .pn-painel-pessoa { display: grid; gap: 14px; }
  .pn-painel-pessoa .pn-cartoes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pn-painel-pessoa .pn-cartoes > .pn-cartao:nth-child(5):last-child { grid-column: 1 / -1; }
  [data-tema="claro"] .pn-painel-pessoa .pn-agora .pn-alerta b { color: #b45309; }

  /* ---------- avisos, esqueleto e erro ---------- */
  .pn-aviso { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 20px; font-size: 14px; line-height: 1.45; color: var(--sub); background: var(--pn-cartao); border: 1px dashed var(--vidro-borda); }
  .pn-aviso b { color: var(--texto); display: block; font-size: 15px; }
  .pn-aviso .pn-mov-ic { background: rgba(15, 252, 190, .14); color: #0ffcbe; }
  .pn-nota { font-size: 13px; color: var(--aviso-txt); background: var(--aviso); border-radius: 14px; padding: 9px 14px; }
  .pn-esq { background: rgba(255, 255, 255, .07); border-radius: 12px; }
  .pn-erro { justify-items: center; text-align: center; padding: 36px 20px; color: var(--sub); font-size: 14.5px; }
  .pn-erro b { color: var(--texto); font-size: 17px; }

  /* ---------- Comercial (/telas/comercial.js) dentro do Dashboard escuro ---------- */
  .pn-caixa .cm-p { background: var(--pn-cartao); border: 0; box-shadow: inset 0 0 0 1px var(--pn-cartao-borda); -webkit-backdrop-filter: none; backdrop-filter: none; border-radius: 22px; }
  .pn-caixa .cm-meta { background: linear-gradient(160deg, rgba(15, 252, 190, .12), rgba(255, 255, 255, .03)); }
  .pn-caixa .cm-var.sobe { color: #0ffcbe; } .pn-caixa .cm-var.desce { color: #ff9a7f; }
  .pn-caixa .cm-av { background: #106ebe; }
  .pn-caixa .cm-barra i, .pn-caixa .cm-serv .cm-barra i { background: linear-gradient(90deg, #0ffcbe, #3aa0ff); }
  .pn-caixa .cm-seg button[aria-pressed="true"] { background: #eaf3fc; color: #08243f; }

  @media (prefers-reduced-motion: reduce) {
    .pn-entra { animation: none; }
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

  // ---------- estado da tela (sobrevive entre aberturas da aba) ----------
  const s = { periodo: lerPeriodo() || 'hoje', cache: {}, extra: null, meta: undefined, comercial: undefined, timer: null, geracao: 0, caixa: null, ui: null, falhou: false, carregando: false,
    verTodos: false, editandoMeta: false, menuAberto: false, observador: null, ocultar: lerOlho(), entrou: false, sinoObs: null };

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

  /** Cartão de vidro com o fio de brilho embaixo. */
  function cartao(ui, rotulo, valor, seloEl, opcoes = {}) {
    const el = ui.el;
    const v = el('span', { class: 'pn-cartao-v' + (opcoes.nada ? ' pn-nada' : ''), 'aria-label': opcoes.aria });
    if (valor instanceof Node) v.append(valor); else v.textContent = valor;
    return el('div', { class: 'pn-cartao', role: 'group', 'aria-label': rotulo },
      el('span', { class: 'pn-cartao-r', text: rotulo }), v, seloEl || (opcoes.sub ? el('span', { class: 'pn-cartao-s', text: opcoes.sub }) : null));
  }

  function numeros(ui, d) {
    const comp = COMPARA[d.periodo] || 'vs período anterior';
    const L = d.leads || {}, A = d.agendamentos || {}, PR = d.primeiraResposta || {};
    const tot = A.total || 0;
    const conv = A.conversaoPct, convAnt = A.conversaoAnteriorPct;
    const tempo = PR.geral?.mediaSeg;
    return ui.el('div', { class: 'pn-cartoes', role: 'list', 'aria-label': 'Números do período' },
      cartao(ui, ROTULO_LEADS[d.periodo] || 'Leads', fmtN(L.total || 0), selo(ui, L.variacaoPct, '%', comp)),
      cartao(ui, 'Agendamentos', fmtN(tot), selo(ui, A.anterior ? ((tot - A.anterior) / A.anterior) * 100 : null, '%', comp)),
      cartao(ui, 'Conversão', fmtPct(conv), conv != null && convAnt != null ? selo(ui, conv - convAnt, ' p.p.', comp) : null, { nada: conv == null, sub: 'lead → horário' }),
      cartao(ui, '1ª resposta', valorTempo(tempo), null, { nada: tempo == null, aria: fmtTempo(tempo), sub: `média ${NO_PERIODO[d.periodo]}` }));
  }

  // ---------- visão individual: a atendente (só os números dela) ou uma pessoa aberta pela gestão ----------
  const variacao = (c) => (c && c.anterior ? ((c.total - c.anterior) / c.anterior) * 100 : null);
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
  function blocoAgora(ui, d, { abrirConversas = false } = {}) {
    const el = ui.el;
    if (d.pessoa?.ia || !d.agora) return null;
    const esperando = d.agora.esperando || 0;
    const irEsperando = () => { window.SintoniaPainel?.fechar(); ui.mostrar('conversas'); document.querySelector('[data-f="esperando"]')?.click(); };
    return el('section', { class: 'pn-p', 'aria-labelledby': 'pn-t-agora' },
      el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-agora', text: 'Agora' })),
      el('div', { class: 'pn-agora' },
        el('div', {}, el('b', { text: fmtN(d.agora.conversasDela || 0) }), el('span', { text: abrirConversas ? 'conversas suas' : 'conversas dela' })),
        abrirConversas
          ? el('button', { type: 'button', class: esperando ? 'pn-alerta' : '', onclick: irEsperando, title: 'Ver quem está esperando' }, el('b', { text: fmtN(esperando) }), el('span', { text: 'esperando sua resposta' }))
          : el('div', { class: esperando ? 'pn-alerta' : '' }, el('b', { text: fmtN(esperando) }), el('span', { text: 'esperando resposta dela' }))));
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
        corpo.replaceChildren(el('div', { class: 'pn pn-painel-pessoa' },
          el('div', { class: 'pn-pessoa-cab' }, av, el('span', {}, el('b', { text: d.pessoa.nome }), el('small', { text: `${(PERIODOS.find(([k]) => k === periodo) || [])[1] || ''} · atualizado às ${ui.hm(new Date())}` }))),
          numerosPessoa(ui, d), blocoAgora(ui, d)));
      } catch (x) { corpo.replaceChildren(el('p', { class: 'pn-vazio', text: x.message || 'Não deu para carregar.' })); }
    } });
  }

  // ---------- topo: você · período · sino ----------
  function topo(ui, d) {
    const el = ui.el;
    const eu = ui.estado.eu || {};
    const av = el('span', { class: 'avatar', 'data-pessoa': eu.id || '', text: iniciais(eu.nome) });
    window.SintoniaFotos?.aplicar(av, eu.id);
    const quem = el('button', { class: 'pn-eu', type: 'button', title: eu.nome ? `${eu.nome}: sua conta` : 'Sua conta', 'aria-label': 'Abrir sua conta', onclick: () => ui.mostrar('configuracoes') }, av);
    const trilho = el('div', { class: 'pn-trilho', role: 'group', 'aria-label': 'Período' },
      ...PERIODOS.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(k === s.periodo), onclick: () => trocarPeriodo(k), text: t })));
    const bolinha = el('span', { class: 'pn-bolinha', id: 'pn-sino-qtd', hidden: '' });
    const sino = el('button', { class: 'pn-redondo', type: 'button', id: 'pn-sino', title: 'Notificações', 'aria-label': 'Notificações', html: IC.sino, onclick: () => window.SintoniaTelas?.notificacoes?.abrir?.() }, bolinha);
    copiarSino(bolinha, sino);

    const escopo = d?.escopo;
    const nomeEscopo = escopo === 'pessoal' ? 'Seus números' : escopo === 'unidades' ? `Suas unidades${(eu.unidades || []).length ? ': ' + eu.unidades.map((u) => ui.UNIDADE[u] || u).join(', ') : ''}` : escopo === 'empresa' ? 'Toda a empresa' : '';
    const linha = el('div', { class: 'pn-estado', role: 'status' });
    if (nomeEscopo) linha.append(el('b', { text: nomeEscopo }));
    linha.append(el('span', { class: s.carregando ? 'pn-carregando' : '', text: d?._em ? `${nomeEscopo ? '· ' : ''}atualizado às ${ui.hm(d._em)}` : 'Carregando os números…' }));
    linha.append(botaoRedondo(ui, IC.recarregar, 'Atualizar agora', () => carregar(true), { class: 'pn-redondo pn-mini' }));
    return [el('header', { class: 'pn-topo' }, quem, trilho, sino), linha];
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

  // ---------- herói: vendido no mês (ou agendamentos, para quem não vê dinheiro) ----------
  /** O que vai no topo: valor do mês (com comparação) ou agendamentos do mês. Nunca inventa número. */
  function dadosHeroi(d) {
    const V = s.comercial?.vendido;
    const pessoal = d?.escopo === 'pessoal';
    if (V) {
      const dinheiro = V.podeVerValor && V.valor != null;
      const mes = nomeMes(V.mes);
      return {
        dinheiro,
        rotulo: dinheiro ? `${V.de === 'voce' ? 'Você vendeu' : 'Vendido'} em ${mes}` : `${V.de === 'voce' || pessoal ? 'Seus agendamentos' : 'Agendamentos'} em ${mes}`,
        atual: dinheiro ? V.valor : V.agendamentos,
        anterior: dinheiro ? V.anterior?.valor : V.anterior?.agendamentos,
        mesAnterior: mesAnteriorDe(V.mes),
        ateDia: V.anterior?.ate ? Number(new Intl.DateTimeFormat('pt-BR', { day: 'numeric', timeZone: 'America/Bahia' }).format(new Date(new Date(V.anterior.ate).getTime() - 1))) : null,
      };
    }
    // Sem o Comercial: a meta do Dashboard traz os agendamentos do mês (sem comparação).
    if (s.meta && !pessoal) return { dinheiro: false, rotulo: `Agendamentos em ${nomeMes(s.meta.mes)}`, atual: s.meta.agendamentos, anterior: null };
    return null;
  }

  function heroi(ui, d) {
    const el = ui.el;
    const h = dadosHeroi(d);
    const bloco = el('section', { class: 'pn-heroi' + (s.entrou ? '' : ' pn-entra'), 'aria-label': 'Resumo do mês' });
    if (!h) {
      bloco.append(el('div', { class: 'pn-rot', text: s.comercial === undefined ? 'Carregando o mês…' : 'Resumo do mês' }), el('div', { class: 'pn-esq', style: 'height:46px;width:220px' }));
      return bloco;
    }
    const oculto = h.dinheiro && s.ocultar;
    const rot = el('div', { class: 'pn-rot' }, el('span', { text: h.rotulo }));
    if (h.dinheiro) {
      rot.append(el('button', { class: 'pn-olho', type: 'button', 'aria-pressed': String(oculto), title: oculto ? 'Mostrar os valores' : 'Esconder os valores',
        html: (oculto ? IC.olhoFechado : IC.olho) + `<span>${oculto ? 'mostrar' : 'ocultar'}</span>`, onclick: () => { s.ocultar = !s.ocultar; gravarOlho(s.ocultar); desenharTudo(); } }));
    }
    const valor = el('div', { class: 'pn-valor', 'aria-live': 'polite' });
    if (oculto) { valor.textContent = OCULTO; valor.setAttribute('aria-label', 'Valor escondido'); }
    else if (h.dinheiro) {
      const t = brl(h.atual);
      const i = t.lastIndexOf(',');
      valor.append(t.slice(0, i), el('small', { text: t.slice(i) }));
    } else valor.textContent = fmtN(h.atual);
    bloco.append(rot, valor);
    // Comparação com o mês anterior até o mesmo dia (só quando o servidor manda; nunca inventa).
    if (h.anterior != null && h.mesAnterior) {
      const dif = h.atual - h.anterior;
      const pct = h.anterior ? Math.round((dif / h.anterior) * 100) : null;
      const base = `vs ${h.mesAnterior}${h.ateDia ? ` até dia ${h.ateDia}` : ''}`;
      const cls = dif > 0 ? 'pn-bom' : dif < 0 ? 'pn-ruim' : 'pn-igual';
      const qtd = h.dinheiro ? (oculto ? 'R$ •••' : brlCurto(Math.abs(dif))) : fmtN(Math.abs(dif));
      const txt = dif === 0 ? `igual ${base}` : `${qtd}${pct != null ? ` (${fmtDec(Math.abs(pct), 0)}%)` : ''} ${base}`;
      const explica = `Comparado com o mesmo período de ${h.mesAnterior}${h.ateDia ? ` (dia 1 até o dia ${h.ateDia})` : ''}`;
      bloco.append(el('span', { class: 'pn-chip ' + cls, title: explica, 'aria-label': `${dif > 0 ? 'Subiu' : dif < 0 ? 'Caiu' : 'Ficou'} ${txt}. ${explica}`, html: (dif > 0 ? IC.sobe : dif < 0 ? IC.desce : '') + esc(txt) }));
    }
    return bloco;
  }

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

  /**
   * A série do gráfico, dia a dia (ou hora a hora em Hoje/Ontem). Prefere o valor vendido por dia (Comercial);
   * sem valor, usa leads e agendamentos do Dashboard. A atendente vê os agendamentos dela por dia.
   */
  function serieGrafico(d) {
    const V = s.comercial?.vendido;
    const pessoal = d.escopo === 'pessoal';
    const dias = (n) => (V?.porDia || []).slice(-n);
    const hoje = hojeBahia();
    const deDias = (lista, comValor) => lista.map((x) => ({ chave: x.dia, rotulo: x.dia === hoje ? 'hoje' : rotuloDia(x.dia), v: comValor ? x.valor || 0 : x.agendamentos, extra: x.agendamentos }));
    if (!pessoal && (d.periodo === '7d' || d.periodo === '30d')) {
      const lista = dias(d.periodo === '7d' ? 7 : 30);
      if (V?.podeVerValor && lista.some((x) => x.valor > 0)) {
        return { pontos: deDias(lista, true), tipo: 'brl', titulo: 'Vendido por dia', nome1: 'Vendido', porHora: false, extraNome: 'Agendamentos' };
      }
    }
    if (pessoal) {
      if (!V) return null;
      const lista = dias(d.periodo === '30d' ? 30 : 7);
      const comValor = V.podeVerValor && lista.some((x) => x.valor > 0);
      return { pontos: deDias(lista, comValor), tipo: comValor ? 'brl' : 'n', titulo: `${comValor ? 'Você vendeu' : 'Seus agendamentos'} por dia · últimos ${lista.length} dias`, nome1: comValor ? 'Vendido' : 'Agendamentos', porHora: false, extraNome: comValor ? 'Agendamentos' : null };
    }
    const porHora = d.serie?.unidade !== 'dia';
    const pontos = (d.serie?.pontos || []).map((p) => ({ chave: p.chave, rotulo: p.rotulo, v: p.leads, v2: p.agendamentos }));
    return { pontos, tipo: 'n', titulo: porHora ? 'Leads e agendamentos por hora' : 'Leads e agendamentos por dia', nome1: 'Leads', nome2: 'Agendamentos', porHora, corte: d.periodo === 'hoje' && porHora ? horaBahia() : null };
  }

  function desenharCurva(host, d, sr) {
    const largura = Math.max(260, host.clientWidth || 600);
    const altura = host.clientHeight || 170;
    const pontos = sr.pontos;
    const vis = sr.corte != null ? pontos.slice(0, sr.corte + 1) : pontos; // hoje: a curva para na hora atual
    const max = teto(Math.max(1, ...vis.map((p) => Math.max(p.v, p.v2 || 0))));
    const esq = 12, dir = 12, topo = 16, baixo = 24;
    const W = largura - esq - dir, H = altura - topo - baixo;
    const x = (i) => esq + (pontos.length > 1 ? (i / (pontos.length - 1)) * W : W / 2);
    const y = (v) => topo + H - (v / max) * H;
    const pts1 = vis.map((p, i) => [x(i), y(p.v)]);
    const pts2 = sr.nome2 ? vis.map((p, i) => [x(i), y(p.v2 || 0)]) : null;
    const soma = vis.reduce((a, p) => a + p.v, 0);
    const media = vis.length ? soma / vis.length : 0;
    const fmtV = (v) => (sr.tipo === 'brl' ? (s.ocultar ? 'R$ •••' : brlCurto(v)) : fmtN(Math.round(v * 10) / 10));
    const fmtEixo = (v) => (sr.tipo === 'brl' ? (s.ocultar ? '' : v >= 1000 ? `R$ ${fmtDec(v / 1000)} mil` : `R$ ${fmtN(Math.round(v))}`) : fmtN(Math.round(v * 10) / 10));
    let h = `<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="${esc(rotuloAcessivel(d, sr, vis, soma))}" preserveAspectRatio="none">
      <defs><linearGradient id="pn-linha" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#0ffcbe"/><stop offset="1" stop-color="#3aa0ff"/></linearGradient>
      <linearGradient id="pn-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3aa0ff" stop-opacity=".25"/><stop offset="1" stop-color="#3aa0ff" stop-opacity="0"/></linearGradient></defs>`;
    for (const f of [0.5, 1]) {
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
    if (soma) {
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
      h += `<circle cx="${ax}" cy="${ay}" r="4.5" fill="#3aa0ff" stroke="#eaf3fc" stroke-width="2"/>`;
    }
    h += `<g class="pn-foco" style="display:none"><line class="pn-guia" y1="${topo}" y2="${topo + H}"/>${pts2 ? '<circle class="pn-ponto-2" r="4"/>' : '<circle r="0"/>'}<circle class="pn-ponto" r="5"/></g></svg>`;
    host.innerHTML = h;
    const dica = document.createElement('div');
    dica.className = 'pn-dica-g';
    dica.hidden = true;
    host.append(dica);
    if (!soma && !vis.some((p) => p.v2 || p.extra)) {
      const sem = document.createElement('div');
      sem.className = 'pn-sem-dado';
      sem.innerHTML = `<span>${esc(sr.tipo === 'brl' || d.escopo === 'pessoal' ? 'Nada no período ainda. A curva aparece com os primeiros agendamentos.' : `Nenhum lead ${NO_PERIODO[d.periodo]} ainda. A curva aparece quando as clientes chamarem.`)}</span>`;
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
      let linhas = `<div><i style="background:#0ffcbe"></i>${esc(sr.nome1)}<strong>${esc(fmtV(p.v))}</strong></div>`;
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

  function blocoCurva(ui, d) {
    const el = ui.el;
    const sr = serieGrafico(d);
    if (!sr) return null;
    const bloco = el('section', { class: 'pn-curva' + (s.entrou ? '' : ' pn-entra'), 'aria-label': sr.titulo });
    const menu = el('div', { class: 'pn-menu', role: 'menu', hidden: s.menuAberto ? undefined : '' },
      el('button', { type: 'button', role: 'menuitem', onclick: () => { fecharMenu(); exportarCsv(d, sr); } }, el('span', { html: IC.baixar, style: 'display:grid' }), 'Exportar CSV'),
      el('button', { type: 'button', role: 'menuitem', onclick: () => { fecharMenu(); carregar(true); } }, el('span', { html: IC.recarregar, style: 'display:grid' }), 'Atualizar agora'),
      el('button', { type: 'button', role: 'menuitem', onclick: () => { fecharMenu(); ui.mostrar('conversas'); } }, el('span', { html: IC.abrir, style: 'display:grid' }), 'Abrir as conversas'));
    const bMais = botaoRedondo(ui, IC.mais, 'Mais opções do gráfico', (ev) => { ev.stopPropagation(); s.menuAberto = !s.menuAberto; menu.hidden = !s.menuAberto; bMais.setAttribute('aria-expanded', String(s.menuAberto)); }, { class: 'pn-redondo pn-mini', 'aria-haspopup': 'menu', 'aria-expanded': String(s.menuAberto) });
    const leg = el('span', {},
      el('span', { class: 'pn-leg' }, el('i', { class: 'pn-l-1' }), sr.nome2 ? sr.nome1 : sr.titulo),
      sr.nome2 ? el('span', { class: 'pn-leg' }, el('i', { class: 'pn-l-2' }), sr.nome2) : null,
      el('span', { class: 'pn-leg' }, el('i', { class: 'pn-l-m' }), sr.porHora ? 'média por hora' : 'média por dia'));
    const host = el('div', { class: 'pn-grafico' });
    bloco.append(host, el('div', { class: 'pn-curva-cab' }, leg, bMais), menu);
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

  function fecharMenu() {
    if (!s.menuAberto) return;
    s.menuAberto = false;
    s.caixa?.querySelectorAll('.pn-menu').forEach((m) => { m.hidden = true; });
    s.caixa?.querySelectorAll('[aria-haspopup="menu"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  // ---------- meta do mês ----------
  function anel(pct) {
    const r = 23, c = 2 * Math.PI * r, f = pct == null ? 0 : Math.max(0, Math.min(1, pct / 100));
    return `<svg viewBox="0 0 56 56" aria-hidden="true"><defs><linearGradient id="pn-anel-g" x1="0" x2="1"><stop offset="0" stop-color="#0ffcbe"/><stop offset="1" stop-color="#3aa0ff"/></linearGradient></defs>
      <circle cx="28" cy="28" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="5"/>
      ${f ? `<circle cx="28" cy="28" r="${r}" fill="none" stroke="url(#pn-anel-g)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 28 28)"/>` : ''}</svg>`;
  }

  function blocoMeta(ui, d) {
    const el = ui.el;
    const m = s.meta;
    const bloco = el('section', { class: 'pn-meta', 'aria-labelledby': 'pn-t-meta' });
    if (m === undefined) { bloco.append(el('div', { class: 'pn-meta-l' }, el('div', { class: 'pn-esq', style: 'width:56px;height:56px;border-radius:50%' }), el('div', { class: 'pn-meta-txt' }, el('b', { id: 'pn-t-meta', text: 'Meta do mês' }), el('span', { text: 'Carregando…' })))); return bloco; }
    if (m === null) { bloco.append(el('div', { class: 'pn-meta-txt' }, el('b', { id: 'pn-t-meta', text: 'Meta do mês' }), el('span', { text: 'Não deu para carregar a meta agora. Tentamos de novo na próxima atualização.' }))); return bloco; }
    const mes = nomeMes(m.mes);
    const dias = Math.max(1, m.diasRestantes || 1);
    // Meta de valor (Comercial) quando existe e a pessoa vê dinheiro; senão, a meta de agendamentos do Dashboard.
    const V = s.comercial?.vendido;
    const metaValor = V?.podeVerValor && V.de === 'equipe' ? s.comercial?.metas?.equipe?.meta?.valor : null;
    let pct, linha1, linha2 = null;
    if (metaValor) {
      const feito = V.valor || 0, falta = Math.max(0, metaValor - feito);
      pct = (feito / metaValor) * 100;
      const R = (v) => (s.ocultar ? 'R$ •••' : brlCurto(v));
      linha1 = falta ? `faltam ${R(falta)} em ${plural(dias, 'dia', 'dias')} · ${R(falta / dias)}/dia` : `Meta batida! ${R(feito)} em ${mes}.`;
      if (m.meta) linha2 = `Agendamentos: ${fmtN(m.agendamentos)} de ${fmtN(m.meta)}${m.faltam ? ` · faltam ${fmtN(m.faltam)}` : ' · meta batida'}`;
    } else if (m.meta) {
      pct = m.progressoPct;
      linha1 = m.faltam ? `faltam ${plural(m.faltam, 'agendamento', 'agendamentos')} em ${plural(dias, 'dia', 'dias')} · ${fmtDec(m.faltam / dias)}/dia` : `Meta batida! ${plural(m.agendamentos, 'agendamento', 'agendamentos')} em ${mes}.`;
      linha2 = `${fmtN(m.agendamentos)} de ${fmtN(m.meta)} agendamentos em ${mes}`;
    } else {
      pct = null;
      linha1 = m.podeEditar ? 'Sem meta definida. Toque no lápis e defina quantos agendamentos a loja quer no mês.' : 'A gestão ainda não definiu a meta deste mês.';
      linha2 = `${plural(m.agendamentos, 'agendamento', 'agendamentos')} em ${mes} · ${plural(m.diasRestantes, 'dia restante', 'dias restantes')}`;
    }
    const an = el('div', { class: 'pn-anel', role: 'img', 'aria-label': pct != null ? `${Math.round(pct)}% da meta de ${mes}` : `Sem meta em ${mes}`, html: anel(pct) },
      el('b', { text: pct != null ? `${Math.round(pct)}%` : '—' }));
    const linha = el('div', { class: 'pn-meta-l' }, an, el('div', { class: 'pn-meta-txt' }, el('b', { id: 'pn-t-meta', text: 'Meta do mês' }), el('span', { text: linha1 }), linha2 ? el('small', { text: linha2 }) : null));
    if (m.podeEditar) linha.append(botaoRedondo(ui, IC.lapis, m.meta ? 'Mudar a meta de agendamentos' : 'Definir a meta de agendamentos', () => { s.editandoMeta = !s.editandoMeta; desenharTudo(); }, { class: 'pn-redondo pn-mini' }));
    bloco.append(linha);
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
        el('button', { class: 'pn-botao pn-menta', type: 'submit', text: 'Salvar' }));
      if (m.meta) form.append(el('button', { class: 'pn-botao pn-vidro', type: 'button', text: 'Tirar meta', onclick: () => salvar(null) }));
      bloco.append(form);
      requestAnimationFrame(() => input.focus());
    } else if (d.escopo && d.escopo !== 'empresa' && m.meta) {
      bloco.append(el('div', { class: 'pn-vazio', style: 'font-size:12.5px', text: 'A meta é da empresa; o progresso conta os agendamentos que você vê.' }));
    }
    return bloco;
  }

  // ---------- movimentações (o que aconteceu hoje, como extrato) ----------
  function blocoMovimentacoes(ui, extra) {
    const el = ui.el;
    const fatos = Array.isArray(extra?.atualizacoes) ? extra.atualizacoes.slice().sort((a, b) => new Date(b.em) - new Date(a.em)) : null;
    const lig = Array.isArray(extra?.ligacoes?.hoje) ? extra.ligacoes.hoje : null;
    const cab = el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-mov', text: 'Movimentações' }), el('span', { class: 'pn-dica', text: fatos?.length ? `hoje · ${plural(fatos.length, 'registro', 'registros')}` : 'hoje' }));
    const bloco = el('section', { class: 'pn-p pn-g-mov', 'aria-labelledby': 'pn-t-mov' }, cab);
    const V = s.comercial?.vendido;
    const veDinheiro = V ? V.podeVerValor : ui.estado.eu ? ui.ehGestor(ui.estado.eu) : true;
    const lista = el('div', { class: 'pn-movs', role: 'list' });
    if (lig && lig.length) {
      const atendeu = lig.filter((x) => x.resultado === 'atendeu' || x.resultado === 'agendou').length;
      const agendou = lig.filter((x) => x.resultado === 'agendou').length;
      lista.append(el('div', { class: 'pn-mov', role: 'listitem' }, el('span', { class: 'pn-mov-ic pn-t-ligacao', html: IC.telefone }),
        el('span', { class: 'pn-mov-c' }, el('b', { text: plural(lig.length, 'ligação hoje', 'ligações hoje') }), el('span', { text: `${atendeu ? `${atendeu} ${atendeu === 1 ? 'atendeu' : 'atenderam'}` : 'ninguém atendeu'} · ${agendou ? `${agendou} ${agendou === 1 ? 'agendou' : 'agendaram'}` : 'nenhum agendamento'}` })),
        el('span', { class: 'pn-mov-v' }, el('strong', { text: fmtN(lig.length) }), el('small', { text: 'equipe' }))));
    }
    if (!fatos) { bloco.append(lista, el('div', { class: 'pn-vazio', text: 'Não deu para carregar as movimentações de hoje agora. Tentamos de novo na próxima atualização.' })); return bloco; }
    if (!fatos.length) { bloco.append(lista, el('div', { class: 'pn-vazio', text: 'Nada por aqui ainda hoje. Agendamentos, vezes que a IA assumiu, pedidos de ajuda, lembretes e follow-ups aparecem aqui conforme acontecem.' })); return bloco; }
    const LIMITE = 8;
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
    bloco.append(lista);
    if (fatos.length > LIMITE) bloco.append(el('button', { class: 'pn-botao pn-vidro pn-ver', type: 'button', text: s.verTodos ? 'Mostrar menos' : `Ver tudo (${fatos.length})`, onclick: () => { s.verTodos = !s.verTodos; desenharTudo(); } }));
    return bloco;
  }

  // ---------- funil por etapa ----------
  function blocoFunil(ui, d) {
    const el = ui.el;
    const f = Array.isArray(d.funil) ? d.funil : [];
    const total = f.reduce((a, x) => a + (x.conversas || 0), 0);
    const bloco = el('section', { class: 'pn-p pn-g-funil', 'aria-labelledby': 'pn-t-funil' },
      el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-funil', text: 'Funil por etapa' }), el('button', { class: 'pn-link', type: 'button', text: 'Abrir o Funil', onclick: () => ui.mostrar('funil') })),
      el('div', { class: 'pn-total' }, el('b', { text: fmtN(total) }), el('span', { text: `${total === 1 ? 'conversa' : 'conversas'} no funil agora` })));
    const nome = (x) => x.nome || ui.NOME_ETAPA[x.etapa] || x.etapa;
    const pilha = el('div', { class: 'pn-pilha' + (total ? '' : ' pn-pilha-vazia'), role: 'img', 'aria-label': total ? f.filter((x) => x.conversas).map((x) => `${nome(x)} ${x.conversas}`).join(', ') : 'Funil vazio' });
    for (const x of f) if (x.conversas) pilha.append(el('i', { style: `flex-grow:${x.conversas};background:${COR_ETAPA[x.etapa] || '#7cc4ff'}`, title: `${nome(x)}: ${x.conversas}` }));
    bloco.append(pilha);
    const lista = el('div', { class: 'pn-etapas' });
    for (const x of f) {
      const n = x.conversas || 0;
      const p = total ? Math.round((n / total) * 100) : 0;
      lista.append(el('button', { class: 'pn-etapa' + (n ? '' : ' pn-nula'), type: 'button', 'aria-label': `${nome(x)}: ${plural(n, 'conversa', 'conversas')}, ${p}%. Abrir o Funil`, onclick: () => ui.mostrar('funil') },
        el('i', { style: `background:${COR_ETAPA[x.etapa] || '#7cc4ff'}${n ? '' : ';opacity:.45'}` }),
        el('span', { class: 'pn-nome', text: nome(x) }), el('b', { text: fmtN(n) }), el('small', { text: total ? `${p}%` : '—' })));
    }
    bloco.append(lista);
    if (!total) bloco.append(el('div', { class: 'pn-vazio', text: 'Ainda não há conversas no funil. Elas entram em “Novo lead” assim que a cliente chama.' }));
    return bloco;
  }

  // ---------- ranking da equipe ----------
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

  function blocoRanking(ui, d) {
    const el = ui.el;
    const pessoal = d.escopo === 'pessoal';
    const ia = (d.ranking || []).find((p) => p.ia);
    const rk = (Array.isArray(d.ranking) ? d.ranking.filter((p) => !p.ia) : []).sort((a, b) => (b.agendamentos || 0) - (a.agendamentos || 0) || (b.respostas || 0) - (a.respostas || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const eq = d.equipe;
    const cab = el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-rank', text: pessoal ? 'Seu desempenho' : 'Equipe' }),
      el('span', { class: 'pn-dica', text: eq ? `${fmtN(eq.online)} de ${fmtN(eq.ativas)} online` : NO_PERIODO[d.periodo] }));
    if (!pessoal && ui.ehGestor?.(ui.estado.eu)) cab.append(el('button', { class: 'pn-link', type: 'button', text: 'Abrir', title: 'Abrir a equipe', onclick: () => ui.mostrar('equipe') }));
    // Atalho para o Desempenho do atendimento (quem vê relatórios).
    if (!pessoal && ui.estado.eu?.permissoes?.relatorios) cab.append(el('button', { class: 'pn-desemp', type: 'button', id: 'pn-desempenho', title: 'Ver o desempenho de cada atendente', text: 'Desempenho', onclick: () => ui.mostrar('desempenho') }));
    const bloco = el('section', { class: 'pn-p pn-rank-p pn-g-rank', 'aria-labelledby': 'pn-t-rank' }, cab);
    if (eq) {
      const on = el('div', { class: 'pn-online', 'aria-label': 'Online agora' });
      if (eq.onlineNomes?.length) eq.onlineNomes.forEach((nm) => on.append(el('span', { class: 'pn-pil' }, el('span', { class: 'pn-ini', text: iniciais(nm), 'aria-hidden': 'true' }, el('i', { class: 'pn-luz' })), primeiroNome(nm))));
      else on.append(el('span', { class: 'pn-pil pn-ninguem', text: 'Ninguém online agora' }));
      bloco.append(on);
    }
    if (!rk.length) {
      bloco.append(el('div', { class: 'pn-vazio', text: pessoal ? 'Assim que você responder as clientes, suas respostas, agendamentos e tempo médio aparecem aqui.' : 'Nenhuma atendente ativa no seu alcance. Cadastre a equipe na aba Equipe para ver o ranking aqui.' }));
      return bloco;
    }
    bloco.append(el('div', { class: 'pn-vazio', style: 'font-size:12.5px;margin-top:-6px', text: 'Toque numa pessoa para ver os números dela.' }));
    const tab = el('div', { class: 'pn-rank', role: 'table', 'aria-label': pessoal ? 'Seus números' : 'Ranking da equipe' },
      el('div', { class: 'pn-rank-cab', role: 'row' }, ...['#', pessoal ? 'Você' : 'Atendente', 'Conversas', 'Agend.', 'Conversão', 'Tempo méd.'].map((t) => el('span', { role: 'columnheader', text: t }))));
    rk.forEach((p, i) => tab.append(linhaPessoa(ui, p, i + 1, { pessoal, sozinha: pessoal || rk.length < 2 })));
    if (ia) tab.append(linhaPessoa(ui, ia, 0, { ia: true, sozinha: true }));
    bloco.append(tab);
    if (!pessoal && rk.every((p) => !p.respostas && !p.agendamentos)) bloco.append(el('div', { class: 'pn-vazio', text: `Ninguém da equipe respondeu ${NO_PERIODO[d.periodo]} ainda. Cada resposta e cada agendamento entram aqui, com o tempo que a cliente esperou.` }));
    return bloco;
  }

  // ---------- IA vs equipe ----------
  function blocoIaEquipe(ui, d) {
    const el = ui.el;
    const A = d.agendamentos || {}, PR = d.primeiraResposta || {}, TR = d.tempoResposta || {};
    const bloco = el('section', { class: 'pn-p pn-g-iaeq', 'aria-labelledby': 'pn-t-iaeq' },
      el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-iaeq', text: 'IA vs equipe' }), el('span', { class: 'pn-dica', text: NO_PERIODO[d.periodo] })),
      el('div', { class: 'pn-chave' }, el('span', {}, el('i', { style: 'background:linear-gradient(90deg,#0ffcbe,#3aa0ff)' }), 'IA da Sintonia'), el('span', {}, el('i', { style: 'background:rgba(124,196,255,.55)' }), 'Equipe')));
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
    bloco.append(el('div', { class: 'pn-vs' },
      linha('Agendamentos', A.ia || 0, A.equipe || 0, fmtN, { nota: tot ? `IA fez ${Math.round(((A.ia || 0) / tot) * 100)}%` : '' }),
      linha('Respostas', TR.ia?.n || 0, TR.equipe?.n || 0, fmtN),
      linha('1ª resposta (média)', PR.ia?.mediaSeg, PR.equipe?.mediaSeg, (v) => fmtTempo(v), { inverso: true, nota: 'barra maior = mais rápida' })));
    if (!tot && !(TR.ia?.n || TR.equipe?.n)) bloco.append(el('div', { class: 'pn-vazio', text: `Sem respostas ${NO_PERIODO[d.periodo]} ainda. Aqui você compara o que a IA e a equipe fizeram.` }));
    return bloco;
  }

  const vazio = (d) => (d.escopo === 'pessoal' && d.pessoa ? !d.conversas?.total && !d.agendamentos?.total && !d.respostas?.total : !d.leads?.total) && !d.agendamentos?.total && !(d.funil || []).some((x) => x.conversas) && !(d.ranking || []).some((p) => p.respostas || p.agendamentos) && !d.tempoResposta?.geral?.n;

  function esqueleto(ui) {
    const el = ui.el, b = (st) => el('div', { class: 'pn-esq', style: st });
    const painel = (alt) => el('div', { class: 'pn-p' }, b('height:16px;width:40%'), b(`height:${alt}px;width:100%`));
    return [el('div', { class: 'pn-heroi' }, b('height:14px;width:150px'), b('height:46px;width:240px')), b('height:170px;width:100%'),
      el('div', { class: 'pn-cartoes' }, b('height:96px;border-radius:20px'), b('height:96px;border-radius:20px'), b('height:96px;border-radius:20px'), b('height:96px;border-radius:20px')),
      el('div', { class: 'pn-grade' }, painel(200), painel(200))];
  }

  function desenharTudo() {
    const { caixa, ui } = s;
    if (!caixa || !ui) return;
    const el = ui.el;
    const d = s.cache[s.periodo];
    const rolagem = caixa.scrollTop;
    const raiz = el('div', { class: 'pn', 'aria-busy': String(s.carregando) });
    raiz.append(...topo(ui, d));
    if (!d) {
      s.observador?.disconnect();
      if (s.falhou) {
        raiz.append(el('div', { class: 'pn-p pn-erro', role: 'alert' }, el('b', { text: 'Não deu para carregar o Dashboard' }),
          el('span', { text: s.falhou === true ? 'Verifique a internet e tente de novo.' : s.falhou }),
          el('button', { class: 'pn-botao pn-menta', type: 'button', text: 'Tentar de novo', onclick: () => carregar(true) })));
      } else raiz.append(...esqueleto(ui));
    } else {
      if (s.falhou) raiz.append(el('div', { class: 'pn-nota', role: 'status', text: 'Sem conexão no momento: mostrando os últimos números. Tentamos de novo a cada 30 segundos.' }));
      const pessoal = d.escopo === 'pessoal' && d.pessoa;
      raiz.append(heroi(ui, d));
      const curva = blocoCurva(ui, d);
      if (curva) raiz.append(curva);
      raiz.append(pessoal ? numerosPessoa(ui, d) : numeros(ui, d), el('p', { class: 'pn-comp', text: `Variação dos cartões: ${COMPARA[d.periodo] || 'vs período anterior'}` }));
      if (vazio(d)) raiz.append(el('div', { class: 'pn-aviso' }, el('span', { class: 'pn-mov-ic', html: IC.grafico, 'aria-hidden': 'true' }),
        el('div', {}, el('b', { text: d.escopo === 'pessoal' ? `Seus números ${NO_PERIODO[d.periodo]} ainda estão zerados` : `Ainda sem movimento ${NO_PERIODO[d.periodo]}` }),
          d.escopo === 'pessoal' ? 'Quando as clientes começarem a chamar e você responder, seus leads, tempo de resposta e agendamentos aparecem aqui.' : 'Os números aparecem aqui assim que as clientes começarem a chamar no WhatsApp: leads, tempo de resposta, agendamentos e o ranking da equipe.')));
      if (pessoal) {
        // Atendente: só os números dela (o servidor já manda só isso).
        raiz.append(blocoAgora(ui, d, { abrirConversas: true }));
      } else {
        if (!s.meta?.oculta) raiz.append(blocoMeta(ui, d));
        raiz.append(el('div', { class: 'pn-grade' }, blocoMovimentacoes(ui, s.extra), blocoFunil(ui, d), blocoRanking(ui, d), blocoIaEquipe(ui, d)));
        // Comercial (/telas/comercial.js): minha meta, ranking por período, serviços, metas e comissão, Painel na TV.
        const comercial = window.SintoniaComercial?.bloco(ui);
        if (comercial) raiz.append(comercial);
      }
      // O esmaecer de chegada acontece uma vez só (quando os números chegam pela primeira vez).
      if (!s.entrou && s.comercial !== undefined) s.entrou = true;
    }
    caixa.replaceChildren(raiz);
    caixa.scrollTop = rolagem;
  }

  const visivel = () => s.caixa && s.caixa.isConnected && s.caixa.offsetParent !== null;

  async function carregar(manual) {
    const { ui } = s;
    const g = ++s.geracao;
    const periodo = s.periodo;
    s.carregando = true;
    if (manual) desenharTudo();
    const gestao = !ui.estado.eu || ui.ehGestor(ui.estado.eu);
    const [painel, atualizacoes, ligacoes, meta, comercial] = await Promise.allSettled([
      ui.api(`/api/painel/completo?periodo=${encodeURIComponent(periodo)}`),
      ui.api('/api/atualizacoes'),
      gestao ? ui.api('/api/ligacoes') : Promise.resolve(null),
      ui.api('/api/painel/meta'),
      ui.api('/api/comercial/resumo'),
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
      atualizacoes: atualizacoes.status === 'fulfilled' ? atualizacoes.value : s.extra?.atualizacoes ?? null,
      ligacoes: ligacoes.status === 'fulfilled' ? ligacoes.value : s.extra?.ligacoes ?? null,
    };
    s.meta = meta.status === 'fulfilled' ? meta.value : s.meta || null;
    s.comercial = comercial.status === 'fulfilled' ? comercial.value : s.comercial || null;
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

  document.addEventListener('click', (ev) => { if (s.menuAberto && !ev.target.closest?.('.pn-menu')) fecharMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fecharMenu(); });

  window.SintoniaTelas.painel = {
    async desenhar(caixa, ui) {
      estilo();
      s.caixa = caixa;
      s.ui = ui;
      caixa.classList.add('pn-caixa');
      s.falhou = false;
      s.carregando = true;
      desenharTudo();
      ligarRelogio();
      await carregar(false);
    },
  };
})();
