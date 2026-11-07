/* Tela "painel" da Sintonia: registra window.SintoniaTelas.painel = { desenhar(caixa, ui) }.
 * Dashboard da gestão (ou "Seus números" da atendente) no estilo vidro (docs/ESTILO-VIDRO.md):
 * números do topo com selo de variação, curva de leads e agendamentos (SVG puro), meta do mês com anel,
 * funil por etapa em barra empilhada, ranking da equipe, IA vs equipe e o que aconteceu hoje.
 * Sem bibliotecas. Estilos próprios em <style id="estilo-painel">, tudo com prefixo .pn-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const PERIODOS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias']];
  const COMPARA = { hoje: 'vs ontem', ontem: 'vs anteontem', '7d': 'vs 7 dias antes', '30d': 'vs 30 dias antes' };
  const NO_PERIODO = { hoje: 'hoje', ontem: 'ontem', '7d': 'nos últimos 7 dias', '30d': 'nos últimos 30 dias' };
  const ROTULO_LEADS = { hoje: 'Leads hoje', ontem: 'Leads ontem', '7d': 'Leads em 7 dias', '30d': 'Leads em 30 dias' };
  const CHAVE = 'sintonia.painel.periodo';
  const INTERVALO = 30000;
  /** Cores das etapas (acentos de apoio do guia: só para gráficos). */
  const COR_ETAPA = { novo_lead: '#7cc4ff', em_conversa: '#8CC7E0', interessada: '#5FA8CB', agendada: 'var(--marca-menta)', compareceu: '#FFB199', manutencao: '#F5B800', perdida: '#7D8C99' };
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  const CSS = `
  .pn-caixa.pn-caixa { padding: 18px 16px 0; gap: 0; }
  @media (min-width: 761px) { .pn-caixa.pn-caixa { padding: 26px 28px 0; } }
  /* Acento = var(--marca-menta) (coral na paleta final), principal = var(--marca-azul) (Midnight Navy), apoio = Soft Blue. */
  .pn { --pn-linha: var(--marca-menta); --pn-linha-2: var(--marca-azul); --pn-apoio: #7cc4ff; --pn-forte: var(--marca-menta); --pn-coral: var(--marca-menta);
        --pn-sobre: var(--marca-azul); --pn-bom-txt: var(--marca-azul); --pn-raio: 24px;
        display: grid; gap: 16px; padding-bottom: 32px; min-width: 0; max-width: 1480px; width: 100%; margin: 0 auto; }
  [data-tema="escuro"] .pn { --pn-linha-2: var(--pn-apoio); --pn-bom-txt: var(--pn-apoio); }
  @media (max-width: 760px) { .pn { padding-bottom: 116px; gap: 14px; } }
  .pn button { font-family: inherit; }
  .pn :focus-visible { outline: 2px solid var(--pn-linha); outline-offset: 2px; }

  /* ---------- cabeçalho: título + números ---------- */
  .pn-cab { display: grid; gap: 14px; align-items: center; }
  @media (min-width: 1180px) { .pn-cab { grid-template-columns: auto minmax(0, 1fr); gap: 28px; } }
  .pn-titulo { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .pn-titulo > div { min-width: 0; }
  .pn-titulo h1.titulo-grande { margin: 0 !important; font-size: 38px !important; line-height: 1; letter-spacing: -.035em !important; }
  .pn-sub { color: var(--sub); font-size: 13.5px; margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .pn-sub b { color: var(--texto); font-weight: 600; }
  .pn-titulo .pn-redondo { margin-left: auto; }
  @media (min-width: 1180px) { .pn-titulo .pn-redondo { margin-left: 8px; } }
  .pn-nums { display: flex; gap: 10px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; margin: 0 -16px; padding: 4px 16px 6px; }
  .pn-nums::-webkit-scrollbar { display: none; }
  @media (min-width: 761px) { .pn-nums { margin: 0; padding: 4px 0 6px; } }
  @media (min-width: 1180px) { .pn-nums { justify-content: flex-end; overflow: visible; flex-wrap: wrap; gap: 10px 26px; } }
  .pn-num { flex: none; scroll-snap-align: start; display: flex; align-items: center; gap: 12px; min-width: 0; padding: 12px 16px 12px 12px; border-radius: 20px;
            background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  @media (min-width: 1180px) { .pn-num { padding: 0; background: none; border: 0; box-shadow: none; -webkit-backdrop-filter: none; backdrop-filter: none; } }
  .pn-num-ic { flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); }
  .pn-num-ic svg { width: 19px; height: 19px; }
  .pn-num-txt { display: grid; gap: 1px; min-width: 0; }
  .pn-num-l1 { display: flex; align-items: center; gap: 8px; }
  .pn-num-v { font-size: 22px; font-weight: 800; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pn-num-v small { font-size: .62em; font-weight: 700; color: var(--sub); margin: 0 3px 0 1px; }
  .pn-num-v.pn-nada { color: var(--sub); }
  .pn-num-r { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .pn-selo { display: inline-flex; align-items: center; gap: 3px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pn-selo.pn-bom { background: color-mix(in srgb, var(--pn-apoio) 30%, transparent); color: var(--pn-bom-txt); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--pn-apoio) 70%, transparent); }
  .pn-selo.pn-ruim { background: var(--marca-menta); color: var(--pn-sobre); box-shadow: 0 0 12px color-mix(in srgb, var(--marca-menta) 45%, transparent); }
  .pn-selo.pn-igual { background: var(--vidro-item); color: var(--sub); box-shadow: inset 0 0 0 1px var(--vidro-borda); }

  /* ---------- painéis de vidro ---------- */
  .pn-p { position: relative; min-width: 0; border-radius: var(--pn-raio); padding: 18px; display: grid; gap: 14px; align-content: start;
          background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho);
          -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  @media (min-width: 761px) { .pn-p { padding: 20px 22px; } }
  .pn-p-cab { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .pn-p-cab h2 { margin: 0; font-size: 15px; font-weight: 700; letter-spacing: -.005em; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-p-cab .pn-dica { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .pn-redondo { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
                background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); transition: transform .15s ease, background .15s ease; }
  .pn-redondo:hover { background: var(--vidro-ativo); transform: translateY(-1px); }
  .pn-redondo svg { width: 18px; height: 18px; }
  @media (min-width: 761px) { .pn-p-cab .pn-redondo { width: 38px; height: 38px; } }
  .pn-girando svg { animation: pn-gira .9s linear infinite; }
  @keyframes pn-gira { to { transform: rotate(360deg); } }
  .pn-vazio { font-size: 14px; color: var(--sub); line-height: 1.5; }
  .pn-vazio b { color: var(--texto); }

  /* trilho de pílulas (período) */
  .pn-trilho { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .pn-trilho::-webkit-scrollbar { display: none; }
  .pn-trilho button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 36px; padding: 0 14px; display: inline-grid; place-items: center; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--sub); white-space: nowrap; transition: background .15s ease, color .15s ease; }
  .pn-trilho button:hover { color: var(--texto); }
  .pn-trilho button[aria-pressed="true"] { background: var(--vidro-ativo); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda), 0 4px 14px rgba(0, 0, 0, .12); }
  @media (max-width: 760px) { .pn-trilho button { min-height: 40px; padding: 0 13px; } }

  /* menu ⋯ */
  .pn-menu { position: absolute; z-index: 5; right: 18px; top: 66px; min-width: 210px; padding: 6px; border-radius: 18px; display: grid;
             background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho), 0 18px 40px rgba(0, 0, 0, .25);
             -webkit-backdrop-filter: blur(24px) saturate(1.5); backdrop-filter: blur(24px) saturate(1.5); }
  .pn-menu button { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border-radius: 12px; font-size: 14px; font-weight: 600; color: var(--texto); }
  .pn-menu button:hover { background: var(--vidro-item); }
  .pn-menu svg { width: 17px; height: 17px; color: var(--sub); }

  /* ---------- curva ---------- */
  .pn-curva-cab { display: grid; gap: 14px; margin-top: -8px; }
  @media (min-width: 900px) { .pn-curva-cab { grid-template-columns: minmax(0, 1fr) auto; align-items: end; } }
  .pn-curva-ctl { display: flex; min-width: 0; }
  @media (max-width: 899px) { .pn-curva-ctl .pn-trilho { display: flex; width: 100%; } .pn-curva-ctl .pn-trilho button { flex: 1; padding: 0 6px; } }
  .pn-grande { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .pn-grande b { font-size: 40px; font-weight: 800; letter-spacing: -.04em; line-height: 1; font-variant-numeric: tabular-nums; }
  .pn-grande span { font-size: 13.5px; color: var(--sub); }
  .pn-leg { display: flex; gap: 6px 16px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); margin-top: 10px; }
  .pn-leg span { display: inline-flex; align-items: center; gap: 6px; }
  .pn-leg i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  .pn-leg i.pn-l-leads { background: var(--pn-linha); box-shadow: 0 0 8px var(--pn-linha); }
  .pn-leg i.pn-l-ag { background: var(--pn-linha-2); }
  .pn-leg i.pn-l-media { width: 16px; height: 0; border-radius: 0; border-top: 2px dashed var(--sub); }
  .pn-grafico { position: relative; height: 240px; margin: 0 -4px; touch-action: pan-y; }
  @media (min-width: 761px) { .pn-grafico { height: 280px; } }
  .pn-grafico svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .pn-grafico .pn-eixo-t { font-size: 11px; fill: var(--sub); font-family: var(--fonte); font-variant-numeric: tabular-nums; }
  .pn-grafico .pn-grade-l { stroke: var(--vidro-linha); stroke-width: 1; }
  .pn-grafico .pn-meta-l { stroke: var(--sub); stroke-opacity: .7; stroke-width: 1.4; stroke-dasharray: 5 6; fill: none; }
  .pn-grafico .pn-meta-t { font-size: 11px; fill: var(--sub); font-weight: 700; font-family: var(--fonte); }
  .pn-grafico .pn-t-leads { stroke: var(--pn-linha); stroke-width: 2.6; fill: none; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 0 6px color-mix(in srgb, var(--pn-linha) 70%, transparent)); }
  .pn-grafico .pn-t-ag { stroke: var(--pn-linha-2); stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: .9; }
  .pn-grafico .pn-guia { stroke: var(--texto); stroke-opacity: .25; stroke-width: 1; }
  .pn-grafico .pn-ponto { fill: var(--pn-linha); stroke: var(--fundo); stroke-width: 2.5; filter: drop-shadow(0 0 6px var(--pn-linha)); }
  .pn-grafico .pn-ponto-2 { fill: var(--pn-linha-2); stroke: var(--fundo); stroke-width: 2.5; }
  .pn-grafico .pn-agora { fill: var(--pn-linha); }
  .pn-dica-g { position: absolute; pointer-events: none; z-index: 3; min-width: 132px; padding: 10px 12px; border-radius: 14px; font-size: 12.5px; display: grid; gap: 4px;
               background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho), 0 12px 30px rgba(0, 0, 0, .25);
               -webkit-backdrop-filter: blur(18px) saturate(1.5); backdrop-filter: blur(18px) saturate(1.5); transition: opacity .15s ease; }
  .pn-dica-g[hidden] { display: none; }
  .pn-dica-g b { font-size: 13px; }
  .pn-dica-g div { display: flex; align-items: center; gap: 6px; color: var(--sub); }
  .pn-dica-g div strong { margin-left: auto; color: var(--texto); font-variant-numeric: tabular-nums; }
  .pn-dica-g i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .pn-sem-dado { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
  .pn-sem-dado span { padding: 10px 16px; border-radius: 999px; font-size: 13.5px; color: var(--sub); background: var(--vidro-forte); box-shadow: inset 0 0 0 1px var(--vidro-borda); max-width: 86%; text-align: center; }

  /* ---------- grade dos painéis ---------- */
  .pn-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1000px) {
    .pn-grade { grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .pn-g-meta { grid-column: span 5; } .pn-g-funil { grid-column: span 7; }
    .pn-g-rank { grid-column: span 7; } .pn-g-iaeq { grid-column: span 5; }
    .pn-g-hoje { grid-column: 1 / -1; }
  }
  @media (min-width: 1400px) { .pn-g-meta { grid-column: span 4; } .pn-g-funil { grid-column: span 8; } }

  /* ---------- meta do mês ---------- */
  .pn-meta { background: linear-gradient(155deg, color-mix(in srgb, var(--marca-menta) 30%, transparent), color-mix(in srgb, var(--marca-menta) 10%, transparent) 55%, color-mix(in srgb, var(--marca-azul) 10%, transparent));
             border-color: color-mix(in srgb, var(--marca-menta) 55%, transparent); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .25), 0 16px 40px color-mix(in srgb, var(--marca-menta) 12%, transparent); }
  [data-tema="escuro"] .pn-meta { background: linear-gradient(155deg, color-mix(in srgb, var(--marca-menta) 22%, transparent), color-mix(in srgb, var(--marca-menta) 6%, transparent) 60%, color-mix(in srgb, var(--marca-azul) 20%, transparent)); }
  .pn-anel { position: relative; width: 176px; height: 176px; justify-self: center; margin: 4px 0; }
  .pn-anel svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
  .pn-anel .pn-trilha-a { stroke: color-mix(in srgb, var(--pn-forte) 18%, transparent); }
  .pn-anel .pn-arco { stroke: var(--pn-forte); filter: drop-shadow(0 0 8px color-mix(in srgb, var(--pn-forte) 70%, transparent)); transition: stroke-dashoffset .6s ease; }
  .pn-anel-c { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 2px; }
  .pn-anel-c b { font-size: 40px; font-weight: 800; letter-spacing: -.04em; line-height: 1; font-variant-numeric: tabular-nums; }
  .pn-anel-c span { font-size: 12.5px; color: var(--sub); }
  .pn-meta-nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; text-align: center; }
  .pn-meta-nums div { display: grid; gap: 2px; }
  .pn-meta-nums span { font-size: 12px; color: var(--sub); }
  .pn-meta-nums b { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .pn-meta-rodape { border-radius: 14px; padding: 10px 14px; font-size: 13px; background: rgba(255, 255, 255, .35); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); }
  [data-tema="escuro"] .pn-meta-rodape { background: rgba(255, 255, 255, .07); }
  .pn-meta-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pn-meta-form label { font-size: 13px; color: var(--sub); flex-basis: 100%; }
  .pn-meta-form input { all: unset; box-sizing: border-box; flex: 1; min-width: 0; height: 44px; padding: 0 14px; border-radius: 14px; font-size: 16px; font-weight: 700; color: var(--texto);
                        background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-variant-numeric: tabular-nums; }
  .pn-botao { all: unset; box-sizing: border-box; cursor: pointer; min-height: 44px; padding: 0 18px; border-radius: 999px; display: inline-grid; place-items: center; font-size: 14px; font-weight: 700; white-space: nowrap; }
  .pn-botao.pn-menta { background: var(--marca-menta); color: var(--pn-sobre); box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 40%, transparent), 0 6px 20px color-mix(in srgb, var(--marca-menta) 35%, transparent); }
  .pn-botao.pn-vidro { background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-botao:hover { transform: translateY(-1px); }

  /* ---------- funil por etapa ---------- */
  .pn-total { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .pn-total b { font-size: 30px; font-weight: 800; letter-spacing: -.03em; line-height: 1; font-variant-numeric: tabular-nums; }
  .pn-total span { font-size: 13px; color: var(--sub); }
  .pn-pilha { display: flex; gap: 5px; height: 48px; }
  .pn-pilha i { display: block; min-width: 10px; border-radius: 14px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .45), inset 0 -10px 18px rgba(0, 0, 0, .08); transition: flex-grow .4s ease; }
  .pn-pilha.pn-pilha-vazia { height: 48px; border-radius: 14px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-etapas { display: grid; }
  .pn-etapa { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 12px minmax(0, 1fr) 44px 48px; gap: 10px; align-items: center; min-height: 44px; padding: 0 8px; border-radius: 12px; font-size: 14px; border-bottom: 1px solid var(--vidro-linha); }
  .pn-etapa:last-child { border-bottom: 0; }
  .pn-etapa:hover { background: var(--vidro-item); }
  .pn-etapa i { width: 10px; height: 10px; border-radius: 50%; }
  .pn-etapa .pn-nome { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .pn-etapa b { text-align: right; font-weight: 800; font-variant-numeric: tabular-nums; }
  .pn-etapa small { text-align: right; font-size: 12.5px; color: var(--sub); font-variant-numeric: tabular-nums; }
  .pn-etapa.pn-nula { color: var(--sub); }
  .pn-etapa.pn-nula .pn-nome { font-weight: 500; }
  @media (min-width: 700px) { .pn-etapas.pn-duas { grid-template-columns: 1fr 1fr; column-gap: 18px; } .pn-etapas.pn-duas .pn-etapa:nth-last-child(2) { border-bottom: 0; } }

  /* ---------- ranking ---------- */
  .pn-online { display: flex; flex-wrap: wrap; gap: 6px; }
  .pn-pil { display: inline-flex; align-items: center; gap: 7px; padding: 4px 12px 4px 4px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-size: 13px; font-weight: 600; }
  .pn-pil .pn-ini { width: 26px; height: 26px; font-size: 10.5px; }
  .pn-pil.pn-ninguem { padding: 6px 12px; color: var(--sub); font-weight: 500; }
  .pn-ini { flex: none; position: relative; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 800; color: var(--texto);
            background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-ini.pn-ouro { background: var(--marca-menta); color: var(--pn-sobre); box-shadow: 0 0 14px color-mix(in srgb, var(--marca-menta) 55%, transparent); }
  .pn-ini.pn-robo { background: var(--marca-gradiente); color: #fff; box-shadow: 0 0 12px color-mix(in srgb, var(--marca-menta) 45%, transparent); }
  .pn-ini.pn-robo svg { width: 18px; height: 18px; }
  .pn-luz { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: var(--marca-menta); box-shadow: 0 0 8px color-mix(in srgb, var(--marca-menta) 90%, transparent); border: 2px solid var(--fundo); }
  .pn-rank { display: grid; gap: 8px; }
  .pn-rank-cab, .pn-pessoa { display: grid; grid-template-columns: 22px minmax(0, 1fr) 76px 76px 88px; gap: 10px; align-items: center; }
  .pn-rank-cab { font-size: 12px; color: var(--sub); font-weight: 600; padding: 0 12px; }
  .pn-rank-cab span:nth-child(n+3) { text-align: right; }
  .pn-pessoa { padding: 8px 12px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-pessoa.pn-eu { box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--pn-linha) 60%, transparent); }
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
    .pn-pessoa { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 8px; padding: 12px; }
    .pn-pos { display: none; }
    .pn-quem { grid-column: 1 / -1; }
    .pn-m { text-align: left; display: grid; gap: 1px; padding: 6px 10px; border-radius: 12px; background: var(--vidro-item); }
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
  .pn-vs-barra { display: flex; gap: 4px; height: 12px; }
  .pn-vs-barra i { display: block; border-radius: 999px; min-width: 6px; }
  .pn-vs-barra .pn-b-ia { background: var(--pn-linha); box-shadow: 0 0 10px color-mix(in srgb, var(--pn-linha) 60%, transparent); }
  .pn-vs-barra .pn-b-eq { background: var(--pn-linha-2); }
  .pn-vs-barra.pn-vs-vazia { border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-chave { display: flex; gap: 14px; font-size: 12.5px; color: var(--sub); }
  .pn-chave span { display: inline-flex; align-items: center; gap: 6px; }
  .pn-chave i { width: 9px; height: 9px; border-radius: 50%; }

  /* ---------- o que aconteceu hoje ---------- */
  .pn-fatos { display: grid; gap: 8px; }
  @media (min-width: 1000px) { .pn-fatos { grid-template-columns: 1fr 1fr; } }
  .pn-fato { all: unset; box-sizing: border-box; width: 100%; min-height: 56px; display: flex; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 18px;
             background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); transition: transform .15s ease, background .15s ease; }
  button.pn-fato { cursor: pointer; }
  button.pn-fato:hover { background: var(--vidro-ativo); transform: translateY(-1px); }
  .pn-fato .pn-ic { flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--texto); }
  .pn-fato .pn-ic svg { width: 18px; height: 18px; }
  .pn-fato .pn-ic.pn-t-agendamento { background: var(--marca-menta); color: var(--pn-sobre); box-shadow: 0 0 12px color-mix(in srgb, var(--marca-menta) 50%, transparent); }
  .pn-fato .pn-ic.pn-t-ia_assumiu { background: var(--marca-gradiente); color: #fff; box-shadow: 0 0 12px color-mix(in srgb, var(--marca-azul) 45%, transparent); }
  .pn-fato .pn-ic.pn-t-pediu_ajuda, .pn-fato .pn-ic.pn-t-falha { background: color-mix(in srgb, var(--marca-menta) 20%, transparent); color: var(--pn-coral); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-menta) 50%, transparent); }
  .pn-fato .pn-ic.pn-t-lembrete { color: #c99700; } [data-tema="escuro"] .pn-fato .pn-ic.pn-t-lembrete { color: #f5b800; }
  .pn-fato .pn-corpo { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .pn-fato .pn-l1 { display: flex; gap: 8px; align-items: baseline; }
  .pn-fato .pn-l1 b { flex: 1; min-width: 0; font-size: 14.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-fato .pn-l1 time { font-size: 12px; color: var(--sub); flex: none; font-variant-numeric: tabular-nums; }
  .pn-fato .pn-l2 { font-size: 13px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-ligacoes { display: flex; align-items: center; gap: 12px; font-size: 14px; padding: 10px 12px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .pn-ligacoes .pn-ic { flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--pn-apoio) 30%, transparent); color: var(--texto); }
  .pn-ligacoes svg { width: 18px; height: 18px; }
  .pn-ligacoes span { color: var(--sub); }
  .pn-mais { justify-self: center; }

  /* ---------- avisos, esqueleto e erro ---------- */
  .pn-aviso { display: flex; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 20px; font-size: 14px; line-height: 1.45; color: var(--sub);
              background: var(--vidro-fundo); border: 1px dashed var(--vidro-borda); -webkit-backdrop-filter: blur(22px); backdrop-filter: blur(22px); }
  .pn-aviso b { color: var(--texto); display: block; font-size: 15px; }
  .pn-aviso .pn-ic { flex: none; width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; background: var(--marca-menta); color: var(--pn-sobre); box-shadow: 0 0 14px color-mix(in srgb, var(--marca-menta) 45%, transparent); }
  .pn-aviso .pn-ic svg { width: 20px; height: 20px; }
  .pn-nota { font-size: 13px; color: var(--aviso-txt); background: var(--aviso); border-radius: 14px; padding: 9px 14px; }
  .pn-esq { background: var(--vidro-item); border-radius: 10px; animation: pn-pulso 1.3s ease-in-out infinite; }
  @keyframes pn-pulso { 50% { opacity: .45; } }
  .pn-erro { justify-items: center; text-align: center; padding: 36px 20px; color: var(--sub); font-size: 14.5px; }
  .pn-erro b { color: var(--texto); font-size: 17px; }
  @media (prefers-reduced-motion: reduce) {
    .pn-esq, .pn-girando svg { animation: none; }
    .pn-redondo, .pn-fato, .pn-botao, .pn-anel .pn-arco, .pn-pilha i { transition: none; }
    .pn-redondo:hover, button.pn-fato:hover, .pn-botao:hover { transform: none; }
  }
  `;

  const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const IC = {
    recarregar: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    sobe: '<svg viewBox="0 0 12 12" width="9" height="9" fill="currentColor"><path d="M6 2l4.5 6h-9z"/></svg>',
    desce: '<svg viewBox="0 0 12 12" width="9" height="9" fill="currentColor"><path d="M6 10L1.5 4h9z"/></svg>',
    pessoas: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/>'),
    agenda: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4"/>'),
    alvo: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>'),
    relogio: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    mais: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></svg>',
    abrir: svg('<path d="M7 17 17 7M9 7h8v8"/>'),
    baixar: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
    lapis: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    brilho: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" opacity=".75"/></svg>',
    agendamento: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4"/>'),
    pediu_ajuda: svg('<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17.2h.01"/>'),
    lembrete: svg('<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9Z"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/>'),
    followup: svg('<path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7Z"/>'),
    nova_cliente: svg('<circle cx="10" cy="8" r="3.6"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>'),
    falha: svg('<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
    telefone: svg('<path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 3.7 2 2 0 0 1 3.1 1.5h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>'),
    grafico: svg('<path d="M4 19c3-1 4-9 8-9s4 5 8-6"/><path d="M3 21h18"/>'),
  };
  IC.ia_assumiu = IC.brilho;

  // ---------- formatação ----------
  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  const fmtDec = (n, casas = 1) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: casas });
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
  const iniciais = (n) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const primeiroNome = (n) => String(n || '').split(/\s+/)[0];
  const plural = (n, um, varios) => `${fmtN(n)} ${n === 1 ? um : varios}`;
  const diaSemana = (iso) => SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
  const lerPeriodo = () => { try { const v = sessionStorage.getItem(CHAVE); return PERIODOS.some(([k]) => k === v) ? v : null; } catch { return null; } };
  const gravarPeriodo = (v) => { try { sessionStorage.setItem(CHAVE, v); } catch { /* sem armazenamento: fica só na memória */ } };

  // ---------- estado da tela (sobrevive entre aberturas da aba) ----------
  const s = { periodo: lerPeriodo() || 'hoje', cache: {}, extra: null, meta: undefined, timer: null, geracao: 0, caixa: null, ui: null, falhou: false, carregando: false, verTodos: false, editandoMeta: false, menuAberto: false, observador: null };

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
    if (valor == null || !isFinite(valor)) return null;
    const r = Math.round(valor * 10) / 10;
    const bom = menorMelhor ? r < 0 : r > 0;
    const cls = r === 0 ? 'pn-igual' : bom ? 'pn-bom' : 'pn-ruim';
    const txt = `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmtDec(Math.abs(r))}${sufixo} ${comparacao}`;
    return ui.el('span', { class: 'pn-selo ' + cls, html: (r > 0 ? IC.sobe : r < 0 ? IC.desce : '') + esc(txt) });
  }

  function numero(ui, icone, valor, rotulo, seloEl, opcoes = {}) {
    const el = ui.el;
    const v = el('span', { class: 'pn-num-v' + (opcoes.nada ? ' pn-nada' : ''), 'aria-label': opcoes.aria });
    if (valor instanceof Node) v.append(valor); else v.textContent = valor;
    return el('div', { class: 'pn-num', role: 'group', 'aria-label': rotulo },
      el('span', { class: 'pn-num-ic', html: icone, 'aria-hidden': 'true' }),
      el('span', { class: 'pn-num-txt' }, el('span', { class: 'pn-num-l1' }, v, seloEl), el('span', { class: 'pn-num-r', text: rotulo })));
  }

  function valorTempo(seg) {
    const p = partesTempo(seg);
    const f = document.createDocumentFragment();
    if (!p) { f.append('—'); return f; }
    p.forEach(([n, u]) => { f.append(String(n)); if (u) { const sm = document.createElement('small'); sm.textContent = u; f.append(sm); } else f.append(' '); });
    return f;
  }

  function cabecalho(ui, d) {
    const el = ui.el;
    const escopo = d?.escopo;
    const quem = escopo === 'pessoal' ? 'Seus números' : escopo === 'unidades' ? `Suas unidades${(ui.estado.eu?.unidades || []).length ? ': ' + ui.estado.eu.unidades.map((u) => ui.UNIDADE[u] || u).join(', ') : ''}` : escopo === 'empresa' ? 'Toda a empresa' : '';
    const sub = el('div', { class: 'pn-sub' });
    if (quem) sub.append(el('b', { text: quem }));
    if (d?._em) sub.append(el('span', { text: `${quem ? '· ' : ''}atualizado às ${ui.hm(d._em)}` }));
    else if (!d) sub.append(el('span', { text: 'Carregando os números…' }));
    const rec = botaoRedondo(ui, IC.recarregar, 'Atualizar agora', () => carregar(true));
    if (s.carregando) rec.classList.add('pn-girando');
    const titulo = el('div', { class: 'pn-titulo' }, el('div', {}, el('h1', { class: 'titulo-grande', text: 'Dashboard' }), sub), rec);
    const cab = el('header', { class: 'pn-cab' }, titulo);
    if (d) cab.append(numeros(ui, d));
    return cab;
  }

  function numeros(ui, d) {
    const comp = COMPARA[d.periodo] || 'vs período anterior';
    const L = d.leads || {}, A = d.agendamentos || {}, PR = d.primeiraResposta || {};
    const sL = L.variacaoPct != null ? selo(ui, L.variacaoPct, '%', comp) : null;
    const tot = A.total || 0;
    const sA = A.anterior ? selo(ui, ((tot - A.anterior) / A.anterior) * 100, '%', comp) : null;
    const conv = A.conversaoPct, convAnt = A.conversaoAnteriorPct;
    const sC = conv != null && convAnt != null ? selo(ui, conv - convAnt, ' p.p.', comp) : null;
    const tempo = PR.geral?.mediaSeg;
    return ui.el('div', { class: 'pn-nums', role: 'list', 'aria-label': 'Números do período' },
      numero(ui, IC.pessoas, fmtN(L.total || 0), ROTULO_LEADS[d.periodo] || 'Leads', sL),
      numero(ui, IC.agenda, fmtN(tot), 'Agendamentos', sA),
      numero(ui, IC.alvo, fmtPct(conv), 'Conversão em agendamento', sC, { nada: conv == null }),
      numero(ui, IC.relogio, valorTempo(tempo), 'Tempo da 1ª resposta', null, { nada: tempo == null, aria: fmtTempo(tempo) }));
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

  function desenharCurva(host, d) {
    const largura = Math.max(260, host.clientWidth || 600);
    const altura = host.clientHeight || 260;
    const pontos = d.serie?.pontos || [];
    const porHora = d.serie?.unidade !== 'dia';
    const agora = d.periodo === 'hoje' ? horaBahia() : null;
    const vis = agora != null ? pontos.slice(0, agora + 1) : pontos; // hoje: a curva para na hora atual
    const max = teto(Math.max(1, ...vis.map((p) => Math.max(p.leads, p.agendamentos))));
    const esq = 30, dir = 12, topo = 14, baixo = 26;
    const W = largura - esq - dir, H = altura - topo - baixo;
    const x = (i) => esq + (pontos.length > 1 ? (i / (pontos.length - 1)) * W : W / 2);
    const y = (v) => topo + H - (v / max) * H;
    const ptsL = vis.map((p, i) => [x(i), y(p.leads)]);
    const ptsA = vis.map((p, i) => [x(i), y(p.agendamentos)]);
    const somaL = vis.reduce((a, p) => a + p.leads, 0);
    const media = vis.length ? somaL / vis.length : 0;
    const passo = porHora ? (largura < 520 ? 6 : 3) : pontos.length > 10 ? (largura < 520 ? 7 : 5) : 1;
    let h = `<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="${esc(rotuloAcessivel(d, vis, somaL))}" preserveAspectRatio="none">
      <defs><linearGradient id="pn-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--pn-linha);stop-opacity:.38"/><stop offset=".7" style="stop-color:var(--pn-linha);stop-opacity:.06"/><stop offset="1" style="stop-color:var(--pn-linha);stop-opacity:0"/></linearGradient></defs>`;
    for (const f of [0, 0.5, 1]) {
      const v = max * f;
      h += `<line class="pn-grade-l" x1="${esq}" x2="${largura - dir}" y1="${y(v)}" y2="${y(v)}"/><text class="pn-eixo-t" x="${esq - 8}" y="${y(v) + 4}" text-anchor="end">${fmtN(Math.round(v * 10) / 10)}</text>`;
    }
    pontos.forEach((p, i) => {
      const ultimo = i === pontos.length - 1;
      if (i % passo === 0 || (!porHora && ultimo && (pontos.length - 1) % passo > passo / 2)) {
        const ancora = i === 0 ? 'start' : ultimo ? 'end' : 'middle';
        h += `<text class="pn-eixo-t" x="${x(i)}" y="${altura - 6}" text-anchor="${ancora}">${esc(p.rotulo)}</text>`;
      }
    });
    if (somaL) {
      const ym = y(media);
      h += `<line class="pn-meta-l" x1="${esq}" x2="${largura - dir}" y1="${ym}" y2="${ym}"/>`;
      h += `<text class="pn-meta-t" x="${largura - dir}" y="${ym - 6}" text-anchor="end">média ${esc(fmtDec(media))}/${porHora ? 'h' : 'dia'}</text>`;
    }
    if (ptsL.length) {
      const linha = caminho(ptsL);
      h += `<path d="${linha}L${ptsL[ptsL.length - 1][0]},${topo + H}L${ptsL[0][0]},${topo + H}Z" fill="url(#pn-area)"/>`;
      h += `<path class="pn-t-ag" d="${caminho(ptsA)}"/>`;
      h += `<path class="pn-t-leads" d="${linha}"/>`;
      if (agora != null) { const [ax, ay] = ptsL[ptsL.length - 1]; h += `<circle class="pn-agora" cx="${ax}" cy="${ay}" r="4"/>`; }
    }
    h += `<g class="pn-foco" style="display:none"><line class="pn-guia" y1="${topo}" y2="${topo + H}"/><circle class="pn-ponto-2" r="4.5"/><circle class="pn-ponto" r="5.5"/></g></svg>`;
    host.innerHTML = h;
    const dica = document.createElement('div');
    dica.className = 'pn-dica-g';
    dica.hidden = true;
    host.append(dica);
    if (!somaL && !vis.some((p) => p.agendamentos)) {
      const sem = document.createElement('div');
      sem.className = 'pn-sem-dado';
      sem.innerHTML = `<span>${esc(`Nenhum lead ${NO_PERIODO[d.periodo]} ainda. A curva aparece quando as clientes chamarem.`)}</span>`;
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
      guia.setAttribute('x1', ptsL[i][0]); guia.setAttribute('x2', ptsL[i][0]);
      p1.setAttribute('cx', ptsL[i][0]); p1.setAttribute('cy', ptsL[i][1]);
      p2.setAttribute('cx', ptsA[i][0]); p2.setAttribute('cy', ptsA[i][1]);
      const titulo = porHora ? `${p.rotulo.replace('h', '')}h às ${Number(p.chave) + 1}h` : `${diaSemana(p.chave)}, ${p.rotulo}`;
      dica.innerHTML = `<b>${esc(titulo)}</b><div><i style="background:var(--pn-linha)"></i>Leads<strong>${fmtN(p.leads)}</strong></div><div><i style="background:var(--pn-linha-2)"></i>Agendamentos<strong>${fmtN(p.agendamentos)}</strong></div>`;
      dica.hidden = false;
      const xPx = (ptsL[i][0] / largura) * r.width;
      const dw = dica.offsetWidth || 140;
      dica.style.left = `${Math.max(0, Math.min(r.width - dw, xPx - dw / 2))}px`;
      const yPx = (Math.min(ptsL[i][1], ptsA[i][1]) / altura) * r.height;
      dica.style.top = `${Math.max(-8, yPx - (dica.offsetHeight || 70) - 14)}px`;
    };
    const esconder = () => { foco.style.display = 'none'; dica.hidden = true; };
    host.onpointermove = mostrar;
    host.onpointerdown = mostrar;
    host.onpointerleave = esconder;
  }

  function rotuloAcessivel(d, vis, soma) {
    if (!soma) return `Leads e agendamentos ${NO_PERIODO[d.periodo]}: nenhum lead.`;
    const pico = vis.reduce((a, p) => (p.leads > a.leads ? p : a), vis[0]);
    return `Leads e agendamentos ${NO_PERIODO[d.periodo]}: ${soma} leads, pico em ${pico.rotulo} com ${pico.leads}.`;
  }

  function exportarCsv(d) {
    const linhas = [[d.serie?.unidade === 'dia' ? 'Dia' : 'Hora', 'Leads', 'Agendamentos']];
    for (const p of d.serie?.pontos || []) linhas.push([d.serie.unidade === 'dia' ? p.chave : p.rotulo, p.leads, p.agendamentos]);
    const csv = '﻿' + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `sintonia-leads-${d.periodo}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function blocoCurva(ui, d) {
    const el = ui.el;
    const L = d.leads || {}, A = d.agendamentos || {};
    const trilho = el('div', { class: 'pn-trilho', role: 'group', 'aria-label': 'Período' },
      ...PERIODOS.map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(k === s.periodo), onclick: () => trocarPeriodo(k), text: t })));
    const bloco = el('section', { class: 'pn-p pn-curva', 'aria-labelledby': 'pn-t-curva' });
    const menu = el('div', { class: 'pn-menu', role: 'menu', hidden: s.menuAberto ? undefined : '' },
      el('button', { type: 'button', role: 'menuitem', onclick: () => { fecharMenu(); exportarCsv(d); } }, el('span', { html: IC.baixar, style: 'display:grid' }), 'Exportar CSV'),
      el('button', { type: 'button', role: 'menuitem', onclick: () => { fecharMenu(); carregar(true); } }, el('span', { html: IC.recarregar, style: 'display:grid' }), 'Atualizar agora'));
    const bMais = botaoRedondo(ui, IC.mais, 'Mais opções', (ev) => { ev.stopPropagation(); s.menuAberto = !s.menuAberto; menu.hidden = !s.menuAberto; bMais.setAttribute('aria-expanded', String(s.menuAberto)); }, { 'aria-haspopup': 'menu', 'aria-expanded': String(s.menuAberto) });
    const bAbrir = botaoRedondo(ui, IC.abrir, 'Abrir as conversas', () => ui.mostrar('conversas'));
    const esquerda = el('div', {},
      el('div', { class: 'pn-grande' }, el('b', { text: fmtN(L.total || 0) }),
        el('span', { text: `${(L.total || 0) === 1 ? 'lead' : 'leads'} ${NO_PERIODO[d.periodo]} · ${plural(A.total || 0, 'agendamento', 'agendamentos')}` })),
      el('div', { class: 'pn-leg' },
        el('span', {}, el('i', { class: 'pn-l-leads' }), 'Leads'),
        el('span', {}, el('i', { class: 'pn-l-ag' }), 'Agendamentos'),
        el('span', {}, el('i', { class: 'pn-l-media' }), d.serie?.unidade === 'dia' ? 'Média de leads por dia' : 'Média de leads por hora')));
    bloco.append(el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-curva', text: 'Leads e agendamentos' }), bMais, bAbrir),
      el('div', { class: 'pn-curva-cab' }, esquerda, el('div', { class: 'pn-curva-ctl' }, trilho)), menu);
    const host = el('div', { class: 'pn-grafico' });
    bloco.append(host);
    // Desenha quando já tem largura e redesenha quando a largura muda (sem esticar o texto).
    requestAnimationFrame(() => desenharCurva(host, d));
    s.observador?.disconnect();
    if ('ResizeObserver' in window) {
      let ultima = 0;
      s.observador = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w && Math.abs(w - ultima) > 2) { ultima = w; desenharCurva(host, d); } });
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
  function blocoMeta(ui, d) {
    const el = ui.el;
    const m = s.meta;
    const bloco = el('section', { class: 'pn-p pn-meta pn-g-meta', 'aria-labelledby': 'pn-t-meta' });
    const cab = el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-meta', text: 'Meta do mês' }));
    bloco.append(cab);
    if (m === undefined) { bloco.append(el('div', { class: 'pn-esq', style: 'height:176px;width:176px;border-radius:50%;justify-self:center' })); return bloco; }
    if (m === null) { bloco.append(el('div', { class: 'pn-vazio', text: 'Não deu para carregar a meta agora. Tentamos de novo na próxima atualização.' })); return bloco; }
    const nomeMes = MESES[Number(m.mes.slice(5, 7)) - 1] || '';
    if (m.podeEditar) cab.append(botaoRedondo(ui, IC.lapis, m.meta ? 'Mudar a meta' : 'Definir a meta', () => { s.editandoMeta = !s.editandoMeta; desenharTudo(); }));

    const pct = m.progressoPct;
    const R = 70, C = 2 * Math.PI * R;
    const frac = pct == null ? 0 : Math.min(1, pct / 100);
    const anel = el('div', { class: 'pn-anel', role: 'img', 'aria-label': m.meta ? `${fmtPct(pct)} da meta de ${m.meta} agendamentos em ${nomeMes}` : `${m.agendamentos} agendamentos em ${nomeMes}, sem meta definida` });
    anel.innerHTML = `<svg viewBox="0 0 176 176"><circle class="pn-trilha-a" cx="88" cy="88" r="${R}" fill="none" stroke-width="14"/>
      <circle class="pn-arco" cx="88" cy="88" r="${R}" fill="none" stroke-width="14" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(1)}" ${frac ? '' : 'style="display:none"'}/></svg>`;
    anel.append(el('div', { class: 'pn-anel-c' },
      el('b', { text: m.meta ? `${Math.round(pct)}%` : fmtN(m.agendamentos) }),
      el('span', { text: m.meta ? 'da meta do mês' : `${m.agendamentos === 1 ? 'agendamento' : 'agendamentos'} em ${nomeMes}` })));
    bloco.append(anel);
    bloco.append(el('div', { class: 'pn-meta-nums' },
      el('div', {}, el('span', { text: 'Agendados' }), el('b', { text: fmtN(m.agendamentos) })),
      el('div', {}, el('span', { text: 'Meta' }), el('b', { text: m.meta ? fmtN(m.meta) : '—' })),
      el('div', {}, el('span', { text: 'Dias restantes' }), el('b', { text: fmtN(m.diasRestantes) }))));

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
        el('label', { for: 'pn-meta-n', text: `Quantos agendamentos em ${nomeMes}?` }), input,
        el('button', { class: 'pn-botao pn-menta', type: 'submit', text: 'Salvar' }));
      if (m.meta) form.append(el('button', { class: 'pn-botao pn-vidro', type: 'button', text: 'Tirar meta', onclick: () => salvar(null) }));
      bloco.append(form);
      requestAnimationFrame(() => input.focus());
    } else {
      let txt;
      if (!m.meta) txt = m.podeEditar ? 'Sem meta definida. Toque no lápis e defina quantos agendamentos a loja quer no mês.' : 'A gestão ainda não definiu a meta deste mês.';
      else if (!m.faltam) txt = `Meta batida! ${plural(m.agendamentos, 'agendamento', 'agendamentos')} em ${nomeMes}.`;
      else txt = `Faltam ${plural(m.faltam, 'agendamento', 'agendamentos')}: cerca de ${fmtDec(m.faltam / Math.max(1, m.diasRestantes))} por dia até o fim de ${nomeMes}.`;
      bloco.append(el('div', { class: 'pn-meta-rodape', text: txt }));
      if (d.escopo && d.escopo !== 'empresa' && m.meta) bloco.append(el('div', { class: 'pn-vazio', style: 'font-size:12.5px', text: 'A meta é da empresa; o progresso conta os agendamentos que você vê.' }));
    }
    return bloco;
  }

  // ---------- funil por etapa ----------
  function blocoFunil(ui, d) {
    const el = ui.el;
    const f = Array.isArray(d.funil) ? d.funil : [];
    const total = f.reduce((a, x) => a + (x.conversas || 0), 0);
    const bloco = el('section', { class: 'pn-p pn-g-funil', 'aria-labelledby': 'pn-t-funil' },
      el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-funil', text: 'Funil por etapa' }), botaoRedondo(ui, IC.abrir, 'Abrir o Funil', () => ui.mostrar('funil'))),
      el('div', { class: 'pn-total' }, el('b', { text: fmtN(total) }), el('span', { text: `${total === 1 ? 'conversa' : 'conversas'} no funil agora` })));
    const nome = (x) => x.nome || ui.NOME_ETAPA[x.etapa] || x.etapa;
    const pilha = el('div', { class: 'pn-pilha' + (total ? '' : ' pn-pilha-vazia'), role: 'img', 'aria-label': total ? f.filter((x) => x.conversas).map((x) => `${nome(x)} ${x.conversas}`).join(', ') : 'Funil vazio' });
    for (const x of f) if (x.conversas) pilha.append(el('i', { style: `flex-grow:${x.conversas};background:${COR_ETAPA[x.etapa] || 'var(--pn-apoio)'}`, title: `${nome(x)}: ${x.conversas}` }));
    bloco.append(pilha);
    const lista = el('div', { class: 'pn-etapas' + (f.length > 4 ? ' pn-duas' : '') });
    for (const x of f) {
      const n = x.conversas || 0;
      const p = total ? Math.round((n / total) * 100) : 0;
      lista.append(el('button', { class: 'pn-etapa' + (n ? '' : ' pn-nula'), type: 'button', 'aria-label': `${nome(x)}: ${plural(n, 'conversa', 'conversas')}, ${p}%. Abrir o Funil`, onclick: () => ui.mostrar('funil') },
        el('i', { style: `background:${COR_ETAPA[x.etapa] || 'var(--pn-apoio)'}${n ? `;box-shadow:0 0 8px ${COR_ETAPA[x.etapa] || 'var(--pn-apoio)'}` : ';opacity:.45'}` }),
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
    if (!opcoes.ia && p.online) av.append(el('i', { class: 'pn-luz', title: 'online agora' }));
    const papel = opcoes.ia ? 'responde e agenda sozinha' : [primeiro ? '1º lugar' : null, eu ? 'você' : null, p.online ? 'online agora' : null].filter(Boolean).join(' · ') || (p.papel === 'recepcionista' ? 'Recepção' : 'Atendente');
    const m = (v, rot, txt) => el('span', { class: 'pn-m' + (!v ? ' pn-zero' : '') }, el('small', { text: rot }), txt ?? fmtN(v));
    return el('div', { class: 'pn-pessoa' + (eu && !opcoes.pessoal ? ' pn-eu' : ''), role: 'row' },
      el('span', { class: 'pn-pos', role: 'cell', text: opcoes.ia ? '' : `${pos}º` }),
      el('span', { class: 'pn-quem', role: 'cell' }, av, el('span', {}, el('b', { text: p.nome }), el('small', { text: papel }))),
      m(p.respostas, 'respostas'), m(p.agendamentos, 'agendamentos'),
      m(p.tempoMedioRespostaSeg != null ? 1 : 0, 'tempo médio', fmtTempo(p.tempoMedioRespostaSeg)));
  }

  function blocoRanking(ui, d) {
    const el = ui.el;
    const pessoal = d.escopo === 'pessoal';
    const rk = (Array.isArray(d.ranking) ? d.ranking.slice() : []).sort((a, b) => (b.agendamentos || 0) - (a.agendamentos || 0) || (b.respostas || 0) - (a.respostas || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const eq = d.equipe;
    const cab = el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-rank', text: pessoal ? 'Seu desempenho' : 'Ranking da equipe' }),
      el('span', { class: 'pn-dica', text: eq ? `${fmtN(eq.online)} de ${fmtN(eq.ativas)} online` : NO_PERIODO[d.periodo] }));
    if (!pessoal && ui.ehGestor?.(ui.estado.eu)) cab.append(botaoRedondo(ui, IC.abrir, 'Abrir a equipe', () => ui.mostrar('equipe')));
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
    const tab = el('div', { class: 'pn-rank', role: 'table', 'aria-label': pessoal ? 'Seus números' : 'Ranking da equipe' },
      el('div', { class: 'pn-rank-cab', role: 'row' }, ...['#', pessoal ? 'Você' : 'Atendente', 'Respostas', 'Agend.', 'Tempo méd.'].map((t) => el('span', { role: 'columnheader', text: t }))));
    rk.forEach((p, i) => tab.append(linhaPessoa(ui, p, i + 1, { pessoal, sozinha: pessoal || rk.length < 2 })));
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
      el('div', { class: 'pn-chave' }, el('span', {}, el('i', { class: 'pn-b-ia', style: 'background:var(--pn-linha)' }), 'IA da Sintonia'), el('span', {}, el('i', { style: 'background:var(--pn-linha-2)' }), 'Equipe')));
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

  // ---------- o que aconteceu hoje ----------
  function blocoHoje(ui, extra) {
    const el = ui.el;
    const fatos = Array.isArray(extra?.atualizacoes) ? extra.atualizacoes.slice().sort((a, b) => new Date(b.em) - new Date(a.em)) : null;
    const lig = Array.isArray(extra?.ligacoes?.hoje) ? extra.ligacoes.hoje : null;
    const cab = el('div', { class: 'pn-p-cab' }, el('h2', { id: 'pn-t-hoje', text: 'O que aconteceu hoje' }));
    if (fatos?.length) cab.append(el('span', { class: 'pn-dica', text: plural(fatos.length, 'registro', 'registros') }));
    const bloco = el('section', { class: 'pn-p pn-g-hoje', 'aria-labelledby': 'pn-t-hoje' }, cab);
    if (lig && lig.length) {
      const atendeu = lig.filter((x) => x.resultado === 'atendeu' || x.resultado === 'agendou').length;
      const agendou = lig.filter((x) => x.resultado === 'agendou').length;
      bloco.append(el('div', { class: 'pn-ligacoes' }, el('span', { class: 'pn-ic', html: IC.telefone, 'aria-hidden': 'true' }),
        el('div', {}, el('b', { text: plural(lig.length, 'ligação', 'ligações') }), el('span', { text: ` · ${atendeu ? `${atendeu} ${atendeu === 1 ? 'atendeu' : 'atenderam'}` : 'ninguém atendeu'} · ${agendou ? `${agendou} ${agendou === 1 ? 'agendou' : 'agendaram'}` : 'nenhum agendamento'}` }))));
    }
    if (!fatos) { bloco.append(el('div', { class: 'pn-vazio', text: 'Não deu para carregar as novidades de hoje agora. Tentamos de novo na próxima atualização.' })); return bloco; }
    if (!fatos.length) { bloco.append(el('div', { class: 'pn-vazio', text: 'Nada por aqui ainda hoje. Agendamentos, vezes que a IA assumiu, pedidos de ajuda, lembretes e follow-ups aparecem aqui conforme acontecem.' })); return bloco; }
    const LIMITE = 8;
    const lista = el('div', { class: 'pn-fatos' });
    (s.verTodos ? fatos : fatos.slice(0, LIMITE)).forEach((f) => {
      const tipo = IC[f.tipo] && f.tipo !== 'telefone' ? f.tipo : 'lembrete';
      const l2 = [f.cliente, f.detalhe].filter(Boolean).join(' · ');
      const filhos = [el('span', { class: 'pn-ic pn-t-' + tipo, html: IC[tipo], 'aria-hidden': 'true' }),
        el('span', { class: 'pn-corpo' }, el('span', { class: 'pn-l1' }, el('b', { text: f.titulo || 'Atualização' }), el('time', { datetime: f.em, text: f.em ? ui.hm(f.em) : '' })), l2 ? el('span', { class: 'pn-l2', text: l2 }) : null)];
      lista.append(f.conversaId
        ? el('button', { class: 'pn-fato', type: 'button', title: 'Abrir a conversa', onclick: () => ui.abrir(f.conversaId) }, ...filhos)
        : el('div', { class: 'pn-fato' }, ...filhos));
    });
    bloco.append(lista);
    if (fatos.length > LIMITE) bloco.append(el('button', { class: 'pn-botao pn-vidro pn-mais', type: 'button', text: s.verTodos ? 'Mostrar menos' : `Ver todos (${fatos.length})`, onclick: () => { s.verTodos = !s.verTodos; desenharTudo(); } }));
    return bloco;
  }

  const vazio = (d) => !d.leads?.total && !d.agendamentos?.total && !(d.funil || []).some((x) => x.conversas) && !(d.ranking || []).some((p) => p.respostas || p.agendamentos) && !d.tempoResposta?.geral?.n;

  function esqueleto(ui) {
    const el = ui.el, b = (st) => el('div', { class: 'pn-esq', style: st });
    const painel = (cls, alt) => el('div', { class: 'pn-p ' + cls }, b('height:16px;width:40%'), b(`height:${alt}px;width:100%`));
    return [el('div', { class: 'pn-p' }, b('height:16px;width:30%'), b('height:38px;width:45%'), b('height:240px;width:100%')),
      el('div', { class: 'pn-grade' }, painel('pn-g-meta', 230), painel('pn-g-funil', 230), painel('pn-g-rank', 180), painel('pn-g-iaeq', 180))];
  }

  function desenharTudo() {
    const { caixa, ui } = s;
    if (!caixa || !ui) return;
    const el = ui.el;
    const d = s.cache[s.periodo];
    const rolagem = caixa.scrollTop;
    const raiz = el('div', { class: 'pn', 'aria-busy': String(s.carregando) });
    raiz.append(cabecalho(ui, d));
    if (!d) {
      s.observador?.disconnect();
      if (s.falhou) {
        raiz.append(el('div', { class: 'pn-p pn-erro', role: 'alert' }, el('b', { text: 'Não deu para carregar o Dashboard' }),
          el('span', { text: s.falhou === true ? 'Verifique a internet e tente de novo.' : s.falhou }),
          el('button', { class: 'pn-botao pn-menta', type: 'button', text: 'Tentar de novo', onclick: () => carregar(true) })));
      } else raiz.append(...esqueleto(ui));
    } else {
      if (s.falhou) raiz.append(el('div', { class: 'pn-nota', role: 'status', text: 'Sem conexão no momento: mostrando os últimos números. Tentamos de novo a cada 30 segundos.' }));
      if (vazio(d)) raiz.append(el('div', { class: 'pn-aviso' }, el('span', { class: 'pn-ic', html: IC.grafico, 'aria-hidden': 'true' }),
        el('div', {}, el('b', { text: d.escopo === 'pessoal' ? `Seus números ${NO_PERIODO[d.periodo]} ainda estão zerados` : `Ainda sem movimento ${NO_PERIODO[d.periodo]}` }),
          d.escopo === 'pessoal' ? 'Quando as clientes começarem a chamar e você responder, seus leads, tempo de resposta e agendamentos aparecem aqui.' : 'Os números aparecem aqui assim que as clientes começarem a chamar no WhatsApp: leads, tempo de resposta, agendamentos e o ranking da equipe.')));
      raiz.append(blocoCurva(ui, d));
      raiz.append(el('div', { class: 'pn-grade' }, blocoMeta(ui, d), blocoFunil(ui, d), blocoRanking(ui, d), blocoIaEquipe(ui, d), blocoHoje(ui, s.extra)));
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
    const [painel, atualizacoes, ligacoes, meta] = await Promise.allSettled([
      ui.api(`/api/painel/completo?periodo=${encodeURIComponent(periodo)}`),
      ui.api('/api/atualizacoes'),
      ui.api('/api/ligacoes'),
      ui.api('/api/painel/meta'),
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
