/* Tela "painel" da Sintonia: registra window.SintoniaTelas.painel = { desenhar(caixa, ui) }.
 * Dashboard da gestão (ou "Seus números" da atendente): cartões, leads por hora, funil, equipe e o que aconteceu hoje.
 * Sem bibliotecas: gráficos em HTML/CSS com rótulos acessíveis. Estilos próprios em <style id="estilo-painel">, tudo com prefixo .pn-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const PERIODOS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['7d', '7 dias'], ['30d', '30 dias']];
  const COMPARA = { hoje: 'vs ontem até agora', ontem: 'vs anteontem', '7d': 'vs 7 dias antes', '30d': 'vs 30 dias antes' };
  const NO_PERIODO = { hoje: 'hoje', ontem: 'ontem', '7d': 'nos últimos 7 dias', '30d': 'nos últimos 30 dias' };
  const CHAVE = 'sintonia.painel.periodo';
  const INTERVALO = 30000;

  const CSS = `
  .pn-caixa.pn-caixa { padding: 14px 16px 0; gap: 0; }
  .pn { display: grid; gap: 14px; padding-bottom: 28px; min-width: 0; }
  @media (max-width: 760px) { .pn { padding-bottom: 110px; } }
  .pn-topo { display: flex; align-items: flex-end; gap: 10px; }
  .pn-topo h1.titulo-grande { margin: 2px 0 0 !important; }
  .pn-topo .pn-espaco { flex: 1; }
  .pn-sub { color: var(--sub); font-size: 14px; margin-top: -6px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .pn-sub b { color: var(--texto); font-weight: 600; }
  .pn-recarregar { all: unset; cursor: pointer; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; background: var(--fundo); color: var(--texto); border: 1px solid var(--linha); margin-bottom: 4px; }
  .pn-recarregar svg { width: 19px; height: 19px; }
  .pn-recarregar:focus-visible, .pn-periodos .chip:focus-visible, .pn-etapa:focus-visible, .pn-fato:focus-visible, .pn-mais:focus-visible, .pn-tentar:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .pn-girando svg { animation: pn-gira .9s linear infinite; }
  @keyframes pn-gira { to { transform: rotate(360deg); } }
  .pn-periodos { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding: 2px 0; }
  .pn-periodos::-webkit-scrollbar { display: none; }
  .pn-periodos .chip { background: var(--fundo); padding: 8px 15px; font-size: 14.5px; font-weight: 500; }
  .pn-periodos .chip[aria-pressed="true"] { background: var(--chip-ativo); color: var(--chip-ativo-txt); font-weight: 700; box-shadow: 0 0 0 1px rgba(15, 252, 190, .35); }

  .pn-aviso { display: flex; gap: 12px; align-items: flex-start; background: var(--fundo); border-radius: 18px; padding: 14px 16px; font-size: 14.5px; line-height: 1.4; color: var(--sub); border: 1px dashed var(--linha); }
  .pn-aviso b { color: var(--texto); display: block; font-size: 15.5px; margin-bottom: 2px; }
  .pn-aviso .pn-ic { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--marca-gradiente); box-shadow: var(--brilho-azul); }
  .pn-aviso .pn-ic svg { width: 20px; height: 20px; }
  .pn-nota { font-size: 13px; color: var(--aviso-txt); background: var(--aviso); border-radius: 12px; padding: 8px 12px; }

  .pn-cartoes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  @media (min-width: 1000px) { .pn-cartoes { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; } }
  .pn-cartao { background: var(--fundo); border-radius: 18px; padding: 14px 14px 13px; display: flex; flex-direction: column; gap: 6px; min-width: 0; position: relative; }
  .pn-cartao.pn-forte { box-shadow: 0 0 0 1px rgba(15, 252, 190, .28), 0 8px 26px rgba(16, 110, 190, .16); }
  .pn-rotulo { font-size: 13px; color: var(--sub); font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .pn-valor { font-size: 32px; font-weight: 800; letter-spacing: -.03em; line-height: 1.05; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-valor small { font-size: .5em; font-weight: 700; letter-spacing: 0; color: var(--sub); margin: 0 4px 0 2px; }
  .pn-valor small:last-child { margin-right: 0; }
  .pn-valor.pn-nada { color: var(--sub); font-weight: 600; }
  .pn-linha-mini { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; font-size: 12.5px; color: var(--sub); }
  .pn-delta { display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px; border-radius: 999px; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pn-delta.pn-sobe { background: var(--chip-ativo); color: var(--chip-ativo-txt); }
  .pn-delta.pn-desce { background: var(--aviso); color: var(--aviso-txt); }
  .pn-delta.pn-igual { background: var(--painel); color: var(--sub); }
  .pn-delta svg { width: 11px; height: 11px; }
  .pn-dupla { display: grid; gap: 3px; margin-top: 2px; }
  .pn-dupla div { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--sub); }
  .pn-dupla b { color: var(--texto); font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pn-bolinha { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; vertical-align: 1px; }
  .pn-b-ia { background: var(--marca-menta); box-shadow: 0 0 6px rgba(15, 252, 190, .8); }
  .pn-b-eq { background: var(--marca-azul); }
  .pn-divisao { display: flex; height: 7px; border-radius: 999px; overflow: hidden; background: var(--painel); margin-top: 3px; }
  .pn-divisao i { display: block; height: 100%; }
  .pn-divisao .pn-d-ia { background: var(--marca-menta); }
  .pn-divisao .pn-d-eq { background: var(--marca-azul); }

  .pn-grade { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 1100px) { .pn-grade { grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); align-items: start; } }
  .pn-bloco { background: var(--fundo); border-radius: 18px; padding: 16px; min-width: 0; display: grid; gap: 12px; align-content: start; }
  .pn-cab-bloco { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .pn-cab-bloco h2 { margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -.01em; }
  .pn-cab-bloco span { font-size: 13px; color: var(--sub); }
  .pn-vazio-bloco { font-size: 14px; color: var(--sub); line-height: 1.45; padding: 2px 0; }

  /* leads por hora */
  .pn-horas { display: grid; gap: 6px; }
  @media (min-width: 1100px) { .pn-barras { height: 205px !important; } }
  .pn-barras { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 3px; align-items: end; height: 150px; padding-top: 20px; border-bottom: 1px solid var(--linha); }
  .pn-barras.pn-barras-vazias { height: 56px !important; }
  .pn-col { position: relative; height: 100%; display: flex; align-items: flex-end; }
  .pn-barra { width: 100%; min-height: 3px; border-radius: 5px 5px 2px 2px; background: linear-gradient(180deg, #1a8be0 0%, #106ebe 55%, #0bc7a8 100%); opacity: .9; transition: height .35s ease; }
  .pn-col.pn-zero .pn-barra { background: var(--linha); opacity: 1; }
  .pn-col.pn-futuro .pn-barra { background: transparent; border: 1px dashed var(--linha); border-bottom: 0; min-height: 6px; }
  .pn-col.pn-agora .pn-barra { background: linear-gradient(180deg, #0ffcbe 0%, #0bc7a8 60%, #106ebe 100%); opacity: 1; box-shadow: var(--brilho-menta); }
  .pn-col.pn-agora.pn-zero .pn-barra { box-shadow: 0 0 8px rgba(15, 252, 190, .8); background: var(--marca-menta); }
  .pn-col em { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(var(--h) + 3px); font-style: normal; font-size: 11px; font-weight: 700; color: var(--texto); white-space: nowrap; }
  .pn-eixo { display: grid; grid-template-columns: repeat(24, minmax(0, 1fr)); gap: 3px; font-size: 11px; color: var(--sub); font-variant-numeric: tabular-nums; }
  .pn-eixo span { text-align: center; white-space: nowrap; overflow: visible; }
  .pn-eixo span.pn-ag { color: var(--verde); font-weight: 700; }
  .pn-legenda { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub); }

  /* funil */
  .pn-etapas { display: grid; gap: 4px; }
  .pn-etapa { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: minmax(92px, 34%) minmax(0, 1fr) 42px; align-items: center; gap: 10px; padding: 7px 6px; border-radius: 10px; font-size: 14.5px; }
  .pn-etapa:hover { background: var(--hover); }
  .pn-etapa .pn-nome { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-etapa .pn-trilha { height: 12px; border-radius: 999px; background: var(--painel); overflow: hidden; }
  .pn-etapa .pn-trilha i { display: block; height: 100%; border-radius: 999px; background: var(--marca-gradiente); min-width: 0; transition: width .35s ease; }
  .pn-etapa.pn-perdida .pn-trilha i { background: var(--sub); opacity: .55; }
  .pn-etapa b { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .pn-etapa.pn-nula { color: var(--sub); }
  .pn-ver { font-size: 13px; color: var(--verde); font-weight: 600; }

  /* equipe */
  .pn-equipe { container-type: inline-size; }
  .pn-online { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13.5px; color: var(--sub); }
  .pn-online .pn-pilula { display: inline-flex; align-items: center; gap: 6px; background: var(--painel); border-radius: 999px; padding: 4px 10px; color: var(--texto); font-weight: 500; }
  .pn-luz { width: 9px; height: 9px; border-radius: 50%; background: var(--marca-menta); box-shadow: 0 0 8px rgba(15, 252, 190, .85); display: inline-block; flex: none; }
  .pn-luz.pn-off { background: var(--linha); box-shadow: none; }
  .pn-tabela { display: grid; }
  .pn-pessoa, .pn-cabeca { display: grid; grid-template-columns: 22px minmax(170px, 2.6fr) repeat(5, minmax(54px, 1fr)); align-items: center; gap: 8px; padding: 9px 4px; border-bottom: 1px solid var(--linha); }
  .pn-cabeca { font-size: 12px; color: var(--sub); font-weight: 600; padding-top: 0; }
  .pn-cabeca span:nth-child(n+3), .pn-pessoa .pn-n { text-align: right; }
  .pn-pessoa:last-child { border-bottom: 0; }
  .pn-pos { font-size: 13px; color: var(--sub); font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; }
  .pn-quem { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .pn-quem .pn-txt { min-width: 0; display: grid; }
  .pn-quem .pn-txt b { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-quem .pn-txt span { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-av { position: relative; flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 13.5px; font-weight: 700; background: var(--sel); color: var(--texto); }
  .pn-av .pn-luz { position: absolute; right: -1px; bottom: -1px; border: 2px solid var(--fundo); width: 11px; height: 11px; }
  .pn-av.pn-ouro { background: var(--marca-gradiente); color: #fff; box-shadow: var(--brilho-azul); }
  .pn-av.pn-robo { background: var(--marca-gradiente); color: #fff; box-shadow: 0 0 12px rgba(15, 252, 190, .5); }
  .pn-av.pn-robo svg { width: 18px; height: 18px; }
  .pn-medalha { width: 24px; height: 24px; flex: none; filter: drop-shadow(0 0 6px rgba(15, 252, 190, .6)); }
  .pn-n { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pn-n.pn-zero { color: var(--sub); font-weight: 500; }
  .pn-n small { display: none; }
  .pn-pessoa.pn-eu { background: var(--sel); border-radius: 12px; border-bottom-color: transparent; }
  .pn-pessoa.pn-ia-linha { border-top: 1px dashed var(--linha); }
  @container (max-width: 620px) {
    .pn-cabeca { display: none; }
    .pn-tabela { gap: 8px; }
    .pn-pessoa { grid-template-columns: 1.15fr 1fr 1.6fr 1.25fr 1.1fr; gap: 10px 6px; padding: 12px; border: 0; border-radius: 14px; background: var(--painel); }
    .pn-pessoa:last-child { border-bottom: 0; }
    .pn-pessoa.pn-eu { background: var(--sel); box-shadow: inset 0 0 0 1px rgba(15, 252, 190, .35); }
    .pn-pessoa.pn-ia-linha { border-top: 0; }
    .pn-pos { display: none; }
    .pn-quem { grid-column: 1 / -1; }
    .pn-pessoa .pn-n { text-align: left; display: grid; gap: 1px; font-size: 15px; font-weight: 700; min-width: 0; }
    .pn-n small { display: block; font-size: 11px; font-weight: 500; color: var(--sub); letter-spacing: .01em; }
  }

  /* o que aconteceu hoje */
  .pn-ligacoes { display: flex; align-items: center; gap: 10px; background: var(--painel); border-radius: 14px; padding: 10px 12px; font-size: 14px; }
  .pn-ligacoes svg { width: 18px; height: 18px; color: var(--verde); flex: none; }
  .pn-ligacoes span { color: var(--sub); }
  .pn-fatos { display: grid; }
  .pn-fato { all: unset; box-sizing: border-box; width: 100%; display: flex; gap: 12px; align-items: flex-start; padding: 10px 4px; border-bottom: 1px solid var(--linha); border-radius: 0; }
  .pn-fato:last-child { border-bottom: 0; }
  button.pn-fato { cursor: pointer; }
  button.pn-fato:hover { background: var(--hover); }
  .pn-fato .pn-ic { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--painel); color: var(--icone); }
  .pn-fato .pn-ic svg { width: 18px; height: 18px; }
  .pn-fato .pn-ic.pn-t-agendamento { background: var(--marca-gradiente); color: #fff; box-shadow: var(--brilho-azul); }
  .pn-fato .pn-ic.pn-t-ia_assumiu { background: var(--chip-ativo); color: var(--chip-ativo-txt); }
  .pn-fato .pn-ic.pn-t-pediu_ajuda, .pn-fato .pn-ic.pn-t-falha { background: var(--aviso); color: var(--aviso-txt); }
  .pn-fato .pn-ic.pn-t-nova_cliente { background: var(--sel); color: var(--verde); }
  .pn-fato .pn-corpo { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .pn-fato .pn-l1 { display: flex; gap: 8px; align-items: baseline; }
  .pn-fato .pn-l1 b { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pn-fato .pn-l1 time { font-size: 12.5px; color: var(--sub); flex: none; font-variant-numeric: tabular-nums; }
  .pn-fato .pn-l2 { font-size: 13.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .pn-mais { all: unset; cursor: pointer; justify-self: center; font-size: 14px; font-weight: 600; color: var(--verde); padding: 6px 12px; border-radius: 999px; }
  .pn-mais:hover { background: var(--hover); }

  /* esqueleto e erro */
  .pn-esq { background: var(--linha); border-radius: 8px; animation: pn-pulso 1.3s ease-in-out infinite; }
  @keyframes pn-pulso { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) { .pn-esq, .pn-girando svg { animation: none; } .pn-barra, .pn-etapa .pn-trilha i { transition: none; } }
  .pn-erro { background: var(--fundo); border-radius: 18px; padding: 32px 20px; display: grid; gap: 12px; justify-items: center; text-align: center; color: var(--sub); font-size: 14.5px; }
  .pn-erro b { color: var(--texto); font-size: 17px; }
  .pn-tentar { all: unset; cursor: pointer; background: var(--marca-gradiente); color: #fff; font-weight: 700; font-size: 15px; padding: 10px 20px; border-radius: 999px; box-shadow: var(--brilho-azul); }
  `;

  const IC = {
    recarregar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    sobe: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M6 2l4.5 6h-9z"/></svg>',
    desce: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M6 10L1.5 4h9z"/></svg>',
    brilho: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" opacity=".75"/></svg>',
    agendamento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4"/></svg>',
    pediu_ajuda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.8M12 17.2h.01"/></svg>',
    lembrete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15 18 9Z"/><path d="M10.3 20a1.9 1.9 0 0 0 3.4 0"/></svg>',
    followup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10 14"/><path d="M21 3l-7 18-4-7-7-4 18-7Z"/></svg>',
    nova_cliente: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.6"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/></svg>',
    falha: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>',
    telefone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 3.7 2 2 0 0 1 3.1 1.5h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
    grafico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20V11M11 20V5M17 20v-6M3 20h18"/></svg>',
    medalha: '<svg class="pn-medalha" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h4l2 6H9z" fill="#106ebe"/><path d="M17 2h-4l-2 6h4z" fill="#0a4c86"/><circle cx="12" cy="15" r="7" fill="#0ffcbe"/><circle cx="12" cy="15" r="5.2" fill="none" stroke="#063a4d" stroke-opacity=".35"/><text x="12" y="18.4" text-anchor="middle" font-size="9" font-weight="800" fill="#063a4d" font-family="system-ui, sans-serif">1</text></svg>',
  };
  IC.ia_assumiu = IC.brilho;

  // ---------- formatação ----------
  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
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
  const fmtPct = (v) => (v == null ? '—' : `${String(Math.round(v * 10) / 10).replace('.', ',')}%`);
  const horaBahia = () => Number(new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', hourCycle: 'h23', timeZone: 'America/Bahia' }).format(new Date()));
  const iniciais = (n) => (n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const primeiroNome = (n) => String(n || '').split(/\s+/)[0];
  const lerPeriodo = () => { try { const v = sessionStorage.getItem(CHAVE); return PERIODOS.some(([k]) => k === v) ? v : null; } catch { return null; } };
  const gravarPeriodo = (v) => { try { sessionStorage.setItem(CHAVE, v); } catch { /* sem armazenamento: fica só na memória */ } };

  // ---------- estado da tela (sobrevive entre aberturas da aba) ----------
  const s = { periodo: lerPeriodo() || 'hoje', cache: {}, extra: null, timer: null, geracao: 0, caixa: null, ui: null, falhou: false, carregando: false, verTodos: false };

  function estilo() {
    if (document.getElementById('estilo-painel')) return;
    const st = document.createElement('style');
    st.id = 'estilo-painel';
    st.textContent = CSS;
    document.head.append(st);
  }

  // ---------- desenho ----------
  function cabecalho(ui, d) {
    const el = ui.el;
    const escopo = d?.escopo;
    const quem = escopo === 'pessoal' ? 'Seus números' : escopo === 'unidades' ? `Suas unidades${(ui.estado.eu?.unidades || []).length ? ': ' + ui.estado.eu.unidades.map((u) => ui.UNIDADE[u] || u).join(', ') : ''}` : escopo === 'empresa' ? 'Toda a empresa' : '';
    const botao = el('button', { class: 'pn-recarregar' + (s.carregando ? ' pn-girando' : ''), type: 'button', title: 'Atualizar agora', 'aria-label': 'Atualizar agora', html: IC.recarregar, onclick: () => carregar(true) });
    const sub = el('div', { class: 'pn-sub' });
    if (quem) sub.append(el('b', { text: quem }));
    if (d?._em) sub.append(el('span', { text: `${quem ? '· ' : ''}atualizado às ${ui.hm(d._em)}` }));
    const pilulas = el('div', { class: 'pn-periodos', role: 'group', 'aria-label': 'Período' },
      ...PERIODOS.map(([k, t]) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(k === s.periodo), onclick: () => trocarPeriodo(k), text: t })));
    return [el('div', { class: 'pn-topo' }, el('h1', { class: 'titulo-grande', text: 'Dashboard' }), el('span', { class: 'pn-espaco' }), botao), sub, pilulas];
  }

  function delta(ui, atual, anterior, pct, sufixo = '%') {
    const el = ui.el;
    if (pct == null) {
      if (!anterior && atual) return el('span', { class: 'pn-delta pn-sobe', html: IC.sobe + ' novo' });
      return null;
    }
    const r = Math.round(pct * 10) / 10;
    const cls = r > 0 ? 'pn-sobe' : r < 0 ? 'pn-desce' : 'pn-igual';
    const txt = (r > 0 ? '+' : '') + String(r).replace('.', ',') + sufixo;
    return el('span', { class: 'pn-delta ' + cls, html: (r > 0 ? IC.sobe : r < 0 ? IC.desce : '') + ' ' + txt });
  }

  function valorTempo(ui, seg) {
    const p = partesTempo(seg);
    const v = ui.el('div', { class: 'pn-valor' + (p ? '' : ' pn-nada'), 'aria-label': fmtTempo(seg) });
    if (!p) { v.textContent = '—'; return v; }
    for (const [n, u] of p) { v.append(String(n)); if (u) v.append(ui.el('small', { text: u })); else v.append(' '); }
    return v;
  }

  function cartoes(ui, d) {
    const el = ui.el;
    const comp = COMPARA[d.periodo] || 'vs período anterior';
    const L = d.leads || {}, A = d.agendamentos || {}, PR = d.primeiraResposta || {};
    const dL = delta(ui, L.total, L.anterior, L.variacaoPct);
    const leads = el('div', { class: 'pn-cartao pn-forte' },
      el('div', { class: 'pn-rotulo', text: 'Leads' }),
      el('div', { class: 'pn-valor', text: fmtN(L.total || 0) }),
      el('div', { class: 'pn-linha-mini' }, dL, el('span', { text: `${comp}: ${fmtN(L.anterior || 0)}` })));

    const tempo = el('div', { class: 'pn-cartao' },
      el('div', { class: 'pn-rotulo', text: 'Tempo da 1ª resposta' }),
      valorTempo(ui, PR.geral?.mediaSeg),
      el('div', { class: 'pn-dupla' },
        el('div', {}, el('span', {}, el('i', { class: 'pn-bolinha pn-b-eq' }), 'Equipe'), el('b', { text: fmtTempo(PR.equipe?.mediaSeg) })),
        el('div', {}, el('span', {}, el('i', { class: 'pn-bolinha pn-b-ia' }), 'IA'), el('b', { text: fmtTempo(PR.ia?.mediaSeg) }))));

    const tot = A.total || 0;
    const pIa = tot ? Math.round(((A.ia || 0) / tot) * 100) : 0;
    const dA = delta(ui, tot, A.anterior, A.anterior ? ((tot - A.anterior) / A.anterior) * 100 : null);
    const ag = el('div', { class: 'pn-cartao' },
      el('div', { class: 'pn-rotulo', text: 'Agendamentos' }),
      el('div', { class: 'pn-valor', text: fmtN(tot) }),
      el('div', { class: 'pn-divisao', role: 'img', 'aria-label': `IA ${A.ia || 0}, equipe ${A.equipe || 0}` },
        el('i', { class: 'pn-d-ia', style: `width:${pIa}%` }), el('i', { class: 'pn-d-eq', style: `width:${tot ? 100 - pIa : 0}%` })),
      el('div', { class: 'pn-linha-mini' },
        el('span', {}, el('i', { class: 'pn-bolinha pn-b-ia' }), `IA ${fmtN(A.ia || 0)}`),
        el('span', {}, el('i', { class: 'pn-bolinha pn-b-eq' }), `Equipe ${fmtN(A.equipe || 0)}`), dA));

    const conv = A.conversaoPct, convAnt = A.conversaoAnteriorPct;
    const dC = conv != null && convAnt != null ? delta(ui, conv, convAnt, conv - convAnt, ' p.p.') : null;
    const conversao = el('div', { class: 'pn-cartao' },
      el('div', { class: 'pn-rotulo', text: 'Conversão' }),
      el('div', { class: 'pn-valor' + (conv == null ? ' pn-nada' : ''), text: fmtPct(conv) }),
      el('div', { class: 'pn-linha-mini' }, dC, el('span', { text: conv == null ? 'agendamentos ÷ leads' : `${comp}: ${fmtPct(convAnt)}` })));
    return el('div', { class: 'pn-cartoes' }, leads, tempo, ag, conversao);
  }

  function blocoHoras(ui, d) {
    const el = ui.el;
    const h = Array.isArray(d.leadsPorHora) && d.leadsPorHora.length === 24 ? d.leadsPorHora : new Array(24).fill(0);
    const max = Math.max(0, ...h);
    const soma = h.reduce((a, b) => a + b, 0);
    const ehHoje = d.periodo === 'hoje';
    const agora = ehHoje ? horaBahia() : -1;
    const pico = max ? h.indexOf(max) : -1;
    const barras = el('div', { class: 'pn-barras' + (soma ? '' : ' pn-barras-vazias'), role: 'img', 'aria-label': soma ? `Leads por hora: ${soma} no total, pico às ${pico}h com ${max}.` : 'Leads por hora: nenhum lead neste período.' });
    h.forEach((n, i) => {
      const alt = max ? Math.max(n ? 6 : 0, Math.round((n / max) * 100)) : 0;
      const futuro = ehHoje && i > agora;
      const col = el('div', { class: 'pn-col' + (n ? '' : ' pn-zero') + (futuro ? ' pn-futuro' : '') + (i === agora ? ' pn-agora' : ''), title: `${i}h: ${n} lead${n === 1 ? '' : 's'}`, style: `--h:${alt}%` },
        el('div', { class: 'pn-barra', style: `height:${alt}%` }));
      if (n && (i === pico || i === agora)) col.append(el('em', { text: String(n), 'aria-hidden': 'true' }));
      barras.append(col);
    });
    const eixo = el('div', { class: 'pn-eixo', 'aria-hidden': 'true' }, ...h.map((_, i) => el('span', { class: i === agora ? 'pn-ag' : '', text: i % 6 === 0 || i === 23 ? `${i}h` : '' })));
    const sub = d.periodo === '7d' || d.periodo === '30d' ? `soma ${NO_PERIODO[d.periodo]}` : `${fmtN(soma)} ${soma === 1 ? 'lead' : 'leads'} ${NO_PERIODO[d.periodo]}`;
    const bloco = el('section', { class: 'pn-bloco', 'aria-labelledby': 'pn-t-horas' },
      el('div', { class: 'pn-cab-bloco' }, el('h2', { id: 'pn-t-horas', text: 'Leads por hora' }), el('span', { text: sub })),
      el('div', { class: 'pn-horas' }, barras, eixo));
    if (!soma) bloco.append(el('div', { class: 'pn-vazio-bloco', text: 'Nenhuma cliente nova chamou neste período ainda. Cada conversa nova vira uma barra na hora em que chegou (horário da Bahia).' }));
    else if (ehHoje) bloco.append(el('div', { class: 'pn-legenda' }, el('span', {}, el('i', { class: 'pn-bolinha pn-b-ia' }), `agora (${agora}h)`), el('span', { text: `pico às ${pico}h` })));
    return bloco;
  }

  function blocoFunil(ui, d) {
    const el = ui.el;
    const f = Array.isArray(d.funil) ? d.funil : [];
    const max = Math.max(0, ...f.map((x) => x.conversas || 0));
    const total = f.reduce((a, x) => a + (x.conversas || 0), 0);
    const bloco = el('section', { class: 'pn-bloco', 'aria-labelledby': 'pn-t-funil' },
      el('div', { class: 'pn-cab-bloco' }, el('h2', { id: 'pn-t-funil', text: 'Funil agora' }), el('span', { text: `${fmtN(total)} ${total === 1 ? 'conversa' : 'conversas'}` })));
    const lista = el('div', { class: 'pn-etapas' });
    for (const x of f) {
      const n = x.conversas || 0;
      const nome = x.nome || ui.NOME_ETAPA[x.etapa] || x.etapa;
      lista.append(el('button', { class: 'pn-etapa' + (n ? '' : ' pn-nula') + (x.etapa === 'perdida' ? ' pn-perdida' : ''), type: 'button', 'aria-label': `${nome}: ${n} ${n === 1 ? 'conversa' : 'conversas'}. Abrir o Funil`, onclick: () => ui.mostrar('funil') },
        el('span', { class: 'pn-nome', text: nome }),
        el('span', { class: 'pn-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${max ? Math.max(n ? 3 : 0, (n / max) * 100) : 0}%` })),
        el('b', { text: fmtN(n) })));
    }
    bloco.append(lista);
    bloco.append(total
      ? el('span', { class: 'pn-ver', text: 'Toque numa etapa para abrir o Funil →' })
      : el('div', { class: 'pn-vazio-bloco', text: 'Ainda não há conversas no funil. Elas entram em “Novo lead” assim que a cliente chama.' }));
    return bloco;
  }

  function linhaPessoa(ui, p, pos, opcoes = {}) {
    const el = ui.el;
    const eu = ui.estado.eu?.id && p.usuarioId === ui.estado.eu.id;
    const primeiro = pos === 1 && !opcoes.sozinha && (p.agendamentos > 0 || p.respostas > 0);
    const av = opcoes.ia
      ? el('span', { class: 'pn-av pn-robo', html: IC.brilho, 'aria-hidden': 'true' })
      : el('span', { class: 'pn-av' + (primeiro ? ' pn-ouro' : ''), 'aria-hidden': 'true', text: iniciais(p.nome) });
    if (!opcoes.ia && p.online) av.append(el('i', { class: 'pn-luz', title: 'online agora' }));
    const papel = opcoes.ia ? 'responde e agenda sozinha' : [eu ? 'você' : null, p.online ? 'online agora' : null].filter(Boolean).join(' · ') || (p.papel === 'recepcionista' ? 'Recepção' : 'Atendente');
    const quem = el('div', { class: 'pn-quem' }, av, el('div', { class: 'pn-txt' }, el('b', { text: p.nome }), el('span', { text: papel })));
    if (primeiro) quem.append(el('span', { html: IC.medalha, title: '1º lugar', role: 'img', 'aria-label': '1º lugar', style: 'display:grid;flex:none' }));
    const n = (v, rot, txt) => el('span', { class: 'pn-n' + (!v ? ' pn-zero' : '') }, el('small', { text: rot }), txt ?? fmtN(v));
    return el('div', { class: 'pn-pessoa' + (eu && !opcoes.pessoal ? ' pn-eu' : '') + (opcoes.ia ? ' pn-ia-linha' : ''), role: 'row' },
      el('span', { class: 'pn-pos', text: opcoes.ia ? '' : String(pos) }), quem,
      n(p.respostas, 'respostas'), n(p.agendamentos, 'agend.'),
      n(p.tempoMedioRespostaSeg != null ? 1 : 0, 'tempo méd.', fmtTempo(p.tempoMedioRespostaSeg)),
      n(p.conversasDona, 'conversas', p.conversasDona == null ? '—' : undefined), n(p.ligacoes, 'ligações', p.ligacoes == null ? '—' : undefined));
  }

  function blocoEquipe(ui, d) {
    const el = ui.el;
    const pessoal = d.escopo === 'pessoal';
    const rk = (Array.isArray(d.ranking) ? d.ranking.slice() : []).sort((a, b) => (b.agendamentos || 0) - (a.agendamentos || 0) || (b.respostas || 0) - (a.respostas || 0) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    const eq = d.equipe;
    const cab = el('div', { class: 'pn-cab-bloco' }, el('h2', { id: 'pn-t-equipe', text: pessoal ? 'Seu desempenho' : 'Equipe' }));
    if (eq) cab.append(el('span', { text: `${fmtN(eq.ativas)} ${eq.ativas === 1 ? 'ativa' : 'ativas'} · ${fmtN(eq.online)} online agora` }));
    else cab.append(el('span', { text: NO_PERIODO[d.periodo] }));
    const bloco = el('section', { class: 'pn-bloco pn-equipe', 'aria-labelledby': 'pn-t-equipe' }, cab);
    if (eq) {
      const on = el('div', { class: 'pn-online' });
      if (eq.onlineNomes?.length) eq.onlineNomes.forEach((nm) => on.append(el('span', { class: 'pn-pilula' }, el('i', { class: 'pn-luz' }), primeiroNome(nm))));
      else on.append(el('span', { class: 'pn-pilula' }, el('i', { class: 'pn-luz pn-off' }), 'Ninguém online agora'));
      bloco.append(on);
    }
    const A = d.agendamentos || {}, TR = d.tempoResposta || {};
    const temIa = !pessoal && ((TR.ia?.n || 0) > 0 || (A.ia || 0) > 0);
    if (!rk.length && !temIa) {
      bloco.append(el('div', { class: 'pn-vazio-bloco', text: pessoal ? 'Assim que você responder as clientes, suas respostas, agendamentos e tempo médio aparecem aqui.' : 'Nenhuma atendente ativa no seu alcance. Cadastre a equipe na aba Equipe para ver o ranking aqui.' }));
      return bloco;
    }
    const tab = el('div', { class: 'pn-tabela', role: 'table', 'aria-label': pessoal ? 'Seus números' : 'Ranking da equipe' },
      el('div', { class: 'pn-cabeca', role: 'row' }, ...['#', pessoal ? 'Você' : 'Atendente', 'Respostas', 'Agend.', 'Tempo méd.', 'Conversas', 'Ligações'].map((t) => el('span', { role: 'columnheader', text: t }))));
    rk.forEach((p, i) => tab.append(linhaPessoa(ui, p, i + 1, { pessoal, sozinha: pessoal || rk.length < 2 })));
    if (temIa) tab.append(linhaPessoa(ui, { nome: 'IA da Sintonia', respostas: TR.ia?.n || 0, agendamentos: A.ia || 0, tempoMedioRespostaSeg: TR.ia?.mediaSeg ?? null, conversasDona: null, ligacoes: null }, 0, { ia: true }));
    bloco.append(tab);
    if (!pessoal && rk.length && rk.every((p) => !p.respostas && !p.agendamentos)) bloco.append(el('div', { class: 'pn-vazio-bloco', text: `Ninguém da equipe respondeu ${NO_PERIODO[d.periodo]} ainda. Cada resposta e cada agendamento entram aqui, com o tempo que a cliente esperou.` }));
    return bloco;
  }

  function blocoHoje(ui, extra) {
    const el = ui.el;
    const fatos = Array.isArray(extra?.atualizacoes) ? extra.atualizacoes.slice().sort((a, b) => new Date(b.em) - new Date(a.em)) : null;
    const lig = Array.isArray(extra?.ligacoes?.hoje) ? extra.ligacoes.hoje : null;
    const cab = el('div', { class: 'pn-cab-bloco' }, el('h2', { id: 'pn-t-hoje', text: 'O que aconteceu hoje' }));
    if (fatos) cab.append(el('span', { text: fatos.length ? `${fatos.length} ${fatos.length === 1 ? 'registro' : 'registros'}` : '' }));
    const bloco = el('section', { class: 'pn-bloco', 'aria-labelledby': 'pn-t-hoje' }, cab);
    if (lig && lig.length) {
      const atendeu = lig.filter((x) => x.resultado === 'atendeu' || x.resultado === 'agendou').length;
      const agendou = lig.filter((x) => x.resultado === 'agendou').length;
      bloco.append(el('div', { class: 'pn-ligacoes' }, el('span', { html: IC.telefone, style: 'display:grid' }),
        el('div', {}, el('b', { text: `${lig.length} ${lig.length === 1 ? 'ligação' : 'ligações'}` }), el('span', { text: ` · ${atendeu ? `${atendeu} ${atendeu === 1 ? 'atendeu' : 'atenderam'}` : 'ninguém atendeu'} · ${agendou ? `${agendou} ${agendou === 1 ? 'agendou' : 'agendaram'}` : 'nenhum agendamento'}` }))));
    }
    if (!fatos) { bloco.append(el('div', { class: 'pn-vazio-bloco', text: 'Não deu para carregar as novidades de hoje agora. Tentamos de novo na próxima atualização.' })); return bloco; }
    if (!fatos.length) { bloco.append(el('div', { class: 'pn-vazio-bloco', text: 'Nada por aqui ainda hoje. Agendamentos, vezes que a IA assumiu, pedidos de ajuda, lembretes e follow-ups aparecem aqui conforme acontecem.' })); return bloco; }
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
    if (fatos.length > LIMITE) bloco.append(el('button', { class: 'pn-mais', type: 'button', text: s.verTodos ? 'Mostrar menos' : `Ver todos (${fatos.length})`, onclick: () => { s.verTodos = !s.verTodos; desenharTudo(); } }));
    return bloco;
  }

  const vazio = (d) => !d.leads?.total && !d.agendamentos?.total && !(d.funil || []).some((x) => x.conversas) && !(d.ranking || []).some((p) => p.respostas || p.agendamentos) && !d.tempoResposta?.geral?.n;

  function esqueleto(ui) {
    const el = ui.el, b = (st) => el('div', { class: 'pn-esq', style: st });
    const cartao = () => el('div', { class: 'pn-cartao' }, b('height:13px;width:55%'), b('height:30px;width:70%;margin-top:4px'), b('height:11px;width:85%'));
    const bloco = (alt) => el('div', { class: 'pn-bloco' }, b('height:17px;width:40%'), b(`height:${alt}px;width:100%`));
    return [el('div', { class: 'pn-cartoes' }, cartao(), cartao(), cartao(), cartao()),
      el('div', { class: 'pn-grade' }, bloco(150), bloco(150), bloco(190), bloco(190))];
  }

  function desenharTudo() {
    const { caixa, ui } = s;
    if (!caixa || !ui) return;
    const el = ui.el;
    const d = s.cache[s.periodo];
    const raiz = el('div', { class: 'pn', 'aria-busy': String(s.carregando) });
    raiz.append(...cabecalho(ui, d));
    if (!d) {
      if (s.falhou) {
        raiz.append(el('div', { class: 'pn-erro', role: 'alert' }, el('b', { text: 'Não deu para carregar o painel' }),
          el('span', { text: s.falhou === true ? 'Verifique a internet e tente de novo.' : s.falhou }),
          el('button', { class: 'pn-tentar', type: 'button', text: 'Tentar de novo', onclick: () => carregar(true) })));
      } else raiz.append(...esqueleto(ui));
    } else {
      if (s.falhou) raiz.append(el('div', { class: 'pn-nota', role: 'status', text: 'Sem conexão no momento: mostrando os últimos números. Tentamos de novo a cada 30 segundos.' }));
      if (vazio(d)) raiz.append(el('div', { class: 'pn-aviso' }, el('span', { class: 'pn-ic', html: IC.grafico, 'aria-hidden': 'true' }),
        el('div', {}, el('b', { text: d.escopo === 'pessoal' ? `Seus números ${NO_PERIODO[d.periodo]} ainda estão zerados` : `Ainda sem movimento ${NO_PERIODO[d.periodo]}` }),
          d.escopo === 'pessoal' ? 'Quando as clientes começarem a chamar e você responder, seus leads, tempo de resposta e agendamentos aparecem aqui.' : 'Os números aparecem aqui assim que as clientes começarem a chamar no WhatsApp: leads, tempo de resposta, agendamentos e o ranking da equipe.')));
      raiz.append(cartoes(ui, d));
      raiz.append(el('div', { class: 'pn-grade' }, blocoHoras(ui, d), blocoFunil(ui, d), blocoEquipe(ui, d), blocoHoje(ui, s.extra)));
    }
    caixa.replaceChildren(raiz);
  }

  const visivel = () => s.caixa && s.caixa.isConnected && s.caixa.offsetParent !== null;

  async function carregar(manual) {
    const { ui } = s;
    const g = ++s.geracao;
    const periodo = s.periodo;
    s.carregando = true;
    if (manual) desenharTudo();
    const [painel, atualizacoes, ligacoes] = await Promise.allSettled([
      ui.api(`/api/painel/completo?periodo=${encodeURIComponent(periodo)}`),
      ui.api('/api/atualizacoes'),
      ui.api('/api/ligacoes'),
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
    if (s.caixa?.isConnected) desenharTudo();
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
