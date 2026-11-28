/* Notificações da Sintonia: registra window.SintoniaTelas.notificacoes = { abrir(), fechar(), preferencias(), verificar() }.
 * Sino com contador (barra lateral no computador, topo das Conversas no celular), lista no painel lateral
 * (só o que pede ação; clientes esperando viram um item só; problemas fixos no topo),
 * aviso (toast) + som quando chega algo novo com o app aberto, contador no título e no ícone da aba,
 * preferências (tipos, som, push no celular, não perturbe) e o push de verdade (service worker /sw.js).
 * O contador chega no cabeçalho x-notificacoes das chamadas que o app já faz (evento "sintonia:notificacoes").
 * Estilos próprios em <style id="estilo-notificacoes">, tudo com prefixo .nt- e só com os tokens do ds.css.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, post, el, toast } = ui;
  const $ = (id) => document.getElementById(id);

  const CSS = `
  .nt-bolinha { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center;
    font: 800 10.5px/1 var(--fonte); background: var(--badge); color: var(--badge-txt); box-shadow: 0 0 0 2px var(--fundo); pointer-events: none; }
  /* notificacoes2: no escuro, contador branco com o número azul-marinho, sem brilho */
  [data-tema="escuro"] .nt-bolinha, [data-tema="escuro"] .nt-qtd, [data-tema="escuro"] .nt-chip i { background: #fff; color: #0d2240; }
  #sino-cel { position: relative; }
  @media (min-width: 761px) { #sino-cel { display: none !important; } }
  #sino-cel svg, #lt-sino svg { transform-origin: 50% 10%; }
  .nt-balanca svg { animation: nt-balanca .9s ease; }
  @keyframes nt-balanca { 0%,100% { transform: rotate(0) } 15% { transform: rotate(14deg) } 30% { transform: rotate(-12deg) } 45% { transform: rotate(8deg) } 60% { transform: rotate(-5deg) } 75% { transform: rotate(2deg) } }
  @media (prefers-reduced-motion: reduce) { .nt-balanca svg { animation: none; } }

  .nt-fundo { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,.18); opacity: 0; transition: opacity .2s ease; }
  .nt-fundo.nt-ver { opacity: 1; }
  .nt-painel { position: fixed; z-index: 81; display: flex; flex-direction: column; min-height: 0; color: var(--texto); font-family: var(--fonte);
    background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho), 0 24px 60px rgba(0,0,0,.22);
    -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); transition: transform .24s cubic-bezier(.2,.8,.2,1), opacity .2s ease; }
  @media (min-width: 761px) {
    .nt-painel { top: 12px; width: 430px; max-height: calc(100vh - 24px); border-radius: 26px; opacity: 0; transform: translateY(-6px) scale(.98); transform-origin: top right; }
    .nt-painel.nt-ver { opacity: 1; transform: none; }
    .nt-fundo { background: transparent; }
  }
  @media (max-width: 760px) {
    .nt-painel { left: 0; right: 0; bottom: 0; max-height: 86vh; border-radius: 26px 26px 0 0; transform: translateY(100%); padding-bottom: env(safe-area-inset-bottom); }
    .nt-painel.nt-ver { transform: none; }
  }
  .nt-alca { width: 40px; height: 5px; border-radius: 3px; background: var(--sub); opacity: .35; margin: 8px auto 0; }
  @media (min-width: 761px) { .nt-alca { display: none; } }
  .nt-cab { display: flex; align-items: center; gap: 8px; padding: 14px 16px 8px 20px; }
  .nt-cab h2 { margin: 0; font-size: 22px; font-weight: 800; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nt-curto { display: none; }
  @media (max-width: 420px) { .nt-longo { display: none; } .nt-curto { display: inline; } }
  .nt-botao { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; font: 700 13px var(--fonte); white-space: nowrap; flex: none;
    color: var(--marca-azul); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  [data-tema="escuro"] .nt-botao { color: var(--texto); }
  .nt-botao.nt-ativar, [data-tema="escuro"] .nt-botao.nt-ativar { height: 44px; padding: 0 18px; font-size: 15px; color: #fff; background: var(--marca-azul, #106ebe); }
  .nt-botao:hover { background: var(--vidro-ativo); }
  .nt-botao[disabled] { opacity: .45; cursor: default; }
  .nt-icone { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .nt-icone svg { width: 18px; height: 18px; }
  .nt-botao:focus-visible, .nt-icone:focus-visible, .nt-item:focus-visible, .nt-chave input:focus-visible + i { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  /* lista no painel lateral: linhas compactas (como iOS/WhatsApp) */
  .nt-topo-lista { display: flex; align-items: center; justify-content: flex-end; margin: -6px 0 4px; min-height: 30px; }
  .nt-link { all: unset; cursor: pointer; font-size: 13.5px; font-weight: 700; color: var(--marca-azul); padding: 4px 2px; }
  [data-tema="escuro"] .nt-link { color: var(--marca-menta); }
  .nt-link[disabled] { opacity: .4; cursor: default; }
  .nt-lista { margin: 0 -16px; }
  .nt-grupo { font-size: 11.5px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--sub); padding: 14px 16px 4px; }
  .nt-item { all: unset; cursor: pointer; box-sizing: border-box; display: flex; gap: 12px; width: 100%; padding: 10px 16px; align-items: center; position: relative; }
  .nt-item:hover { background: var(--sel); }
  .nt-item + .nt-item .nt-corpo { box-shadow: 0 -1px 0 var(--linha); }
  .nt-corpo { flex: 1; min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 8px; row-gap: 1px; padding: 2px 0; margin: -10px 0; padding: 10px 0; }
  .nt-ic { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; color: var(--cor-ic, var(--marca-azul)); background: color-mix(in srgb, var(--cor-ic, var(--marca-azul)) 14%, transparent); }
  .nt-ic svg { width: 17px; height: 17px; }
  .nt-ic.t-espera { --cor-ic: #d97706; } .nt-ic.t-ia_equipe { --cor-ic: #0a8f7a; } .nt-ic.t-transferida { --cor-ic: #106ebe; }
  .nt-ic.t-agenda_mudou { --cor-ic: #7c3aed; } .nt-ic.t-reuniao { --cor-ic: #0e7490; } .nt-ic.t-lembrete_ligacao { --cor-ic: #0369a1; } .nt-ic.t-radar { --cor-ic: #106ebe; } .nt-ic.t-nps_baixa { --cor-ic: #d97706; } .nt-ic.t-falha, .nt-ic.t-problema { --cor-ic: #dc2626; }
  [data-tema="escuro"] .nt-ic { background: color-mix(in srgb, var(--cor-ic, var(--marca-azul)) 26%, transparent); filter: brightness(1.35); }
  .nt-titulo { font-size: 15px; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nt-nova .nt-titulo { font-weight: 800; }
  .nt-texto { grid-column: 1 / -1; font-size: 13.5px; color: var(--sub); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nt-quando { font-size: 12px; color: var(--sub); white-space: nowrap; align-self: center; display: inline-flex; align-items: center; gap: 6px; }
  .nt-ponto { width: 8px; height: 8px; border-radius: 50%; background: var(--marca-azul); flex: none; }
  [data-tema="escuro"] .nt-ponto { background: var(--marca-menta); }
  .nt-vazio { text-align: center; padding: 40px 20px; color: var(--sub); font-size: 15px; font-weight: 600; }
  .nt-fim { text-align: center; font-size: 12.5px; color: var(--sub); padding: 12px; }
  .nt-convite { margin: 0 0 8px; padding: 8px 8px 8px 12px; border-radius: 12px; display: flex; gap: 8px; align-items: center; font-size: 13px; line-height: 1.3;
    background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--linha); }
  .nt-convite span { flex: 1; color: var(--sub); }
  .nt-convite .nt-botao { height: 30px; padding: 0 12px; font-size: 12.5px; }
  .nt-convite .nt-x { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .nt-convite .nt-x svg { width: 14px; height: 14px; }

  .nt-toast { position: fixed; z-index: 90; display: flex; gap: 12px; align-items: center; cursor: pointer; color: var(--texto); font-family: var(--fonte);
    padding: 12px 14px; border-radius: 20px; background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho), 0 18px 44px rgba(0,0,0,.22);
    -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .2s ease; opacity: 0; }
  .nt-toast.nt-ver { opacity: 1; transform: none !important; }
  @media (min-width: 761px) { .nt-toast { top: 18px; right: 18px; width: 360px; transform: translateY(-12px); } }
  @media (max-width: 760px) { .nt-toast { top: calc(10px + env(safe-area-inset-top)); left: 12px; right: 12px; transform: translateY(-120%); } }
  .nt-toast .nt-corpo { gap: 1px; }
  .nt-toast .nt-fechar { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; }
  .nt-toast .nt-fechar svg { width: 15px; height: 15px; }

  .nt-pref { max-width: 520px; width: calc(100vw - 24px); padding: 0; border: 1px solid var(--vidro-borda); border-radius: 26px; color: var(--texto); font-family: var(--fonte);
    background: var(--vidro-forte); box-shadow: var(--vidro-brilho), 0 24px 60px rgba(0,0,0,.25); -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  .nt-pref::backdrop { background: rgba(0,0,0,.3); }
  @media (max-width: 760px) { .nt-pref { margin: auto 0 0; width: 100vw; max-width: none; max-height: 92vh; border-radius: 26px 26px 0 0; } }
  .nt-pref-corpo { display: grid; gap: 14px; }
  .nt-secao { display: grid; gap: 2px; padding: 6px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .nt-secao h3 { margin: 6px 10px 4px; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--sub); }
  .nt-linha { display: flex; align-items: center; gap: 12px; min-height: 46px; padding: 4px 10px; border-radius: 12px; font-size: 15px; }
  .nt-linha > span { flex: 1; min-width: 0; }
  .nt-linha small { display: block; color: var(--sub); font-size: 12.5px; line-height: 1.35; margin-top: 2px; }
  .nt-chave { position: relative; flex: none; cursor: pointer; }
  .nt-chave input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .nt-chave i { display: block; width: 46px; height: 28px; border-radius: 999px; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); position: relative; transition: background .2s ease; }
  .nt-chave i::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .2s ease; }
  .nt-chave input:checked + i { background: var(--marca-azul); }
  [data-tema="escuro"] .nt-chave input:checked + i { background: var(--marca-menta); }
  .nt-chave input:checked + i::after { transform: translateX(18px); }
  .nt-chave input:disabled + i { opacity: .45; }
  .nt-horas { display: flex; gap: 10px; align-items: center; padding: 4px 10px 8px; font-size: 14px; color: var(--sub); flex-wrap: wrap; }
  .nt-horas input { font: 600 15px var(--fonte); color: var(--texto); background: var(--entrada); border: 1px solid var(--linha); border-radius: 10px; padding: 6px 8px; }
  .nt-dica { font-size: 13px; line-height: 1.45; color: var(--aviso-txt); background: var(--aviso); border-radius: 14px; padding: 10px 12px; margin: 4px 4px 6px; }
  .nt-acoes { display: flex; gap: 8px; flex-wrap: wrap; padding: 6px 4px 2px; }
  /* ---------- notificacoes2: modelo C "Precisa de você" ---------- */
  .nt-painel-c { --nt-urg: #dc2626; --nt-at: #d97706; display: block; }
  [data-tema="escuro"] .nt-painel-c, [data-tema="escuro"] .nt-lista-h { --nt-urg: #ff7b7b; --nt-at: #ffb547; }
  .nt-qtd { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; font: 800 11.5px/1 var(--fonte); letter-spacing: 0; text-transform: none; background: var(--badge); color: var(--badge-txt); }
  .nt-faixa { display: flex; align-items: center; gap: 8px; margin: 2px 2px 10px; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--nt-urg); }
  .nt-faixa .nt-qtd { background: var(--nt-urg); color: #fff; }
  [data-tema="escuro"] .nt-faixa .nt-qtd { background: #fff; color: #0d2240; }
  .nt-card { position: relative; overflow: hidden; margin: 0 0 10px; padding: 12px 14px 12px 16px; border-radius: 18px; background: var(--painel); border: 1px solid var(--linha); max-height: 640px; }
  .nt-card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--nt-cor, var(--marca-azul)); }
  .nt-card.urg { --nt-cor: var(--nt-urg); } .nt-card.at { --nt-cor: var(--nt-at); }
  .nt-card-topo { display: flex; gap: 10px; align-items: flex-start; }
  .nt-card-topo > div { flex: 1; min-width: 0; }
  .nt-card .nt-titulo { white-space: normal; font-weight: 700; }
  .nt-card .nt-texto { white-space: normal; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; margin-top: 1px; }
  .nt-rotulo { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--nt-cor); margin-bottom: 1px; }
  .nt-rotulo span + span { color: var(--sub); font-weight: 600; letter-spacing: 0; text-transform: none; font-size: 12px; white-space: nowrap; }
  .nt-card-bts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-left: 42px; }
  .nt-card-bts:empty { display: none; }
  .nt-bt { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 34px; padding: 0 14px; border-radius: 999px; font: 700 13px var(--fonte); white-space: nowrap; background: var(--marca-azul, #106ebe); color: #fff; flex: none; }
  [data-tema="escuro"] .nt-bt { background: #fff; color: #0d2240; }
  .nt-bt.leve, [data-tema="escuro"] .nt-bt.leve { background: var(--fundo); color: var(--texto); box-shadow: inset 0 0 0 1px var(--linha); }
  .nt-bt:hover { filter: brightness(1.07); }
  .nt-bt:focus-visible, .nt-cat:focus-visible, .nt-chip:focus-visible, .nt-mini:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  [data-tema="escuro"] :is(.nt-bt, .nt-cat, .nt-chip, .nt-mini):focus-visible { outline-color: var(--marca-menta); }
  .nt-pessoas { margin-top: 8px; }
  .nt-pessoa { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--linha); }
  .nt-av { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font: 800 11.5px var(--fonte); color: #fff; }
  .nt-nm { flex: 1; min-width: 0; }
  .nt-nm b { display: block; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nt-nm small { display: block; font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nt-min { font-size: 12.5px; font-weight: 800; white-space: nowrap; color: var(--nt-at); }
  .nt-min.urg { color: var(--nt-urg); }
  .nt-pessoa .nt-bt { height: 30px; padding: 0 12px; font-size: 12.5px; }
  .nt-mais { display: block; margin: 6px 0 0 auto; }
  .nt-ok { display: flex; gap: 12px; align-items: center; padding: 14px; margin: 0 0 10px; border-radius: 18px; background: color-mix(in srgb, #0a8f7a 9%, var(--fundo)); border: 1px solid color-mix(in srgb, #0a8f7a 30%, var(--linha)); }
  .nt-ok b { display: block; font-size: 15px; } .nt-ok span { font-size: 13px; color: var(--sub); }
  .nt-ic.t-ok { --cor-ic: #0a8f7a; }
  [data-tema="escuro"] .nt-ic.t-ok { --cor-ic: #0ffcbe; }
  .nt-grupo-saber { display: flex; align-items: center; justify-content: space-between; padding: 12px 2px 6px; }
  .nt-grupo-saber .nt-link, .nt-lista-h .nt-grupo .nt-link { font-size: 12.5px; letter-spacing: 0; text-transform: none; }
  .nt-cats { border: 1px solid var(--linha); border-radius: 18px; overflow: hidden; background: var(--fundo); }
  .nt-cat { all: unset; cursor: pointer; box-sizing: border-box; width: 100%; display: flex; gap: 12px; align-items: center; padding: 11px 14px; }
  .nt-cat:hover { background: var(--sel); }
  .nt-cats > * + * { border-top: 1px solid var(--linha); }
  .nt-cat-corpo { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .nt-cat-nome { display: flex; align-items: center; gap: 8px; font-size: 15px; }
  .nt-cat-nome b { font-weight: 700; } .nt-cat.nt-nova .nt-cat-nome b { font-weight: 800; }
  .nt-total { font-size: 12.5px; color: var(--sub); font-weight: 600; }
  .nt-cat .nt-texto { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nt-seta { flex: none; display: grid; color: var(--sub); transition: transform .2s ease; }
  .nt-seta svg { width: 18px; height: 18px; }
  .nt-cat[aria-expanded="true"] .nt-seta { transform: rotate(90deg); }
  .nt-cat-lista { background: var(--painel); }
  .nt-cat-lista .nt-item { padding: 9px 14px 9px 18px; }
  .nt-ic.k-clientes { --cor-ic: #106ebe; } .nt-ic.k-agenda { --cor-ic: #7c3aed; } .nt-ic.k-equipe { --cor-ic: #0a8f7a; } .nt-ic.k-sistema { --cor-ic: #dc2626; }
  .nt-hist { display: block; margin: 16px auto 4px; }
  /* histórico: filtros por assunto, limpar (arrastar no celular, botões no computador) */
  .nt-chips { display: flex; gap: 6px; overflow-x: auto; margin: -4px -16px 6px; padding: 0 16px 6px; scrollbar-width: none; }
  .nt-chips::-webkit-scrollbar { display: none; }
  .nt-chip { all: unset; cursor: pointer; box-sizing: border-box; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; font: 600 13px var(--fonte); white-space: nowrap; color: var(--texto); background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); }
  .nt-chip i { font-style: normal; font-size: 11px; font-weight: 800; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: inline-grid; place-items: center; background: var(--badge); color: var(--badge-txt); }
  .nt-chip[aria-pressed="true"] { background: var(--marca-azul); color: #fff; box-shadow: none; }
  .nt-chip[aria-pressed="true"] i { background: #fff; color: #0d2240; }
  [data-tema="escuro"] .nt-chip[aria-pressed="true"] { background: #fff; color: #0d2240; }
  [data-tema="escuro"] .nt-chip[aria-pressed="true"] i { background: #0d2240; color: #fff; }
  .nt-chip-pt { width: 8px; height: 8px; border-radius: 50%; background: var(--cor-pt); }
  .nt-chip.k-clientes { --cor-pt: #106ebe; } .nt-chip.k-agenda { --cor-pt: #7c3aed; } .nt-chip.k-equipe { --cor-pt: #0a8f7a; } .nt-chip.k-sistema { --cor-pt: #dc2626; }
  [data-tema="escuro"] .nt-chip.k-clientes { --cor-pt: #5fb0ff; } [data-tema="escuro"] .nt-chip.k-agenda { --cor-pt: #b69bff; } [data-tema="escuro"] .nt-chip.k-equipe { --cor-pt: #0ffcbe; } [data-tema="escuro"] .nt-chip.k-sistema { --cor-pt: #ff7b7b; }
  .nt-lista-h .nt-grupo { display: flex; align-items: center; justify-content: space-between; }
  .nt-linha-h { position: relative; overflow: hidden; max-height: 240px; }
  .nt-fundo-limpar { position: absolute; inset: 0; display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding-right: 20px; background: #dc2626; color: #fff; font: 700 13px var(--fonte); }
  .nt-fundo-limpar svg { width: 18px; height: 18px; }
  .nt-linha-h > .nt-item { position: relative; z-index: 1; background: var(--fundo); touch-action: pan-y; user-select: none; -webkit-user-select: none; }
  .nt-linha-h > .nt-item:hover { background: var(--sel); }
  .nt-linha-h + .nt-linha-h .nt-corpo { box-shadow: 0 -1px 0 var(--linha); }
  .nt-h-acoes { display: none; gap: 4px; }
  .nt-mini { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); }
  .nt-mini svg { width: 14px; height: 14px; }
  @media (hover: hover) and (min-width: 761px) {
    .nt-linha-h:hover .nt-h-acoes, .nt-linha-h:focus-within .nt-h-acoes { display: inline-flex; }
    .nt-linha-h:hover .nt-quando-tx, .nt-linha-h:hover .nt-ponto { display: none; }
  }
  .nt-saindo { transition: opacity .2s ease, max-height .24s ease .04s; opacity: 0; max-height: 0 !important; }
  .nt-dica-limpar { display: flex; align-items: center; gap: 8px; margin: 0 16px 6px; padding: 8px 8px 8px 12px; border-radius: 12px; font-size: 12.5px; color: var(--sub); background: var(--painel); }
  .nt-dica-limpar span { flex: 1; }
  .nt-dica-limpar .nt-x { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .nt-dica-limpar .nt-x svg { width: 13px; height: 13px; }
  @media (prefers-reduced-motion: reduce) { .nt-saindo, .nt-seta { transition: none; } }
  @media (min-width: 761px) {
    .nt-card { padding: 11px 13px 11px 15px; }
    .nt-card-bts { padding-left: 38px; }
  }
  
  /* layout-telas: no computador, preferências em 2 colunas (painel largo) e linhas mais densas; o sino também mais denso */
  @media (min-width: 761px) {
    dialog.pl.larga .nt-pref-corpo { display: block; columns: 2 250px; column-gap: 14px; }
    dialog.pl.larga:has(.nt-pref-corpo) { width: min(820px, max(620px, calc(100vw - 300px))); }
    dialog.pl.larga .nt-pref-corpo > * { break-inside: avoid; margin-bottom: 14px; }
    .nt-pref-corpo .nt-linha { min-height: 40px; padding: 3px 10px; font-size: 14px; gap: 10px; }
    .nt-pref-corpo .nt-linha small { font-size: 12px; line-height: 1.3; margin-top: 1px; }
    .nt-pref-corpo .nt-secao h3 { margin: 4px 10px 2px; font-size: 11.5px; }
    .nt-item { padding: 7px 16px; gap: 10px; }
    .nt-corpo { margin: -7px 0; padding: 7px 0; }
    .nt-ic { width: 28px; height: 28px; } .nt-ic svg { width: 15px; height: 15px; }
    .nt-titulo { font-size: 14px; }
    .nt-texto { font-size: 12.5px; }
    .nt-grupo { padding: 10px 16px 2px; }
  }
  `;
  if (!$('estilo-notificacoes')) document.head.append(el('style', { id: 'estilo-notificacoes', text: CSS }));

  const SVG = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const IC = {
    sino: SVG('<path class="ic-cheio" d="M12 4a5.5 5.5 0 0 1 5.5 5.5v4.2l1.6 2.3a.8.8 0 0 1-.7 1.2H5.6a.8.8 0 0 1-.7-1.2l1.6-2.3V9.5A5.5 5.5 0 0 1 12 4Z"/><path d="M10.2 20.2h3.6"/><path d="M3 7.5a6 6 0 0 1 1.8-3M21 7.5a6 6 0 0 0-1.8-3"/>'),
    nova_cliente: SVG('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>'),
    mensagem: SVG('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/>'),
    ia_equipe: SVG('<path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6L12 3Z"/><path d="M5 21a7 7 0 0 1 14 0"/>'),
    espera: SVG('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
    transferida: SVG('<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>'),
    agendamento: SVG('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>'),
    lembrete_ligacao: SVG('<path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/>'),
    falha: SVG('<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17.5v.01"/>'),
    nps_baixa: SVG('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>'),
    teste: SVG('<path d="m5 12 4 4 10-10"/>'),
    radar: SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" opacity=".5"/><path d="M12 12 18 6"/>'),
    fechar: SVG('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2.2"'),
    engrenagem: SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  };
  IC.equipe = SVG('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.5 14.2a5 5 0 0 1 5.5 5.3"/>'); /* notificacoes2 */
  IC.seta = SVG('<path d="m9 6 6 6-6 6"/>');
  IC.lixo = SVG('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>');
  IC.agenda_mudou = IC.agendamento; IC.problema = IC.falha; IC.reuniao = IC.agendamento; /* atendimento-extra */
  IC.lead_parado = IC.espera; /* funil-atendimento */
  const CLASSE_IC = new Proxy({}, { get: (_, t) => `t-${String(t)}` });
  // Só o que pede ação (o servidor não cria mais "nova cliente", "mensagem" nem "a IA agendou").
  const TIPOS = [
    ['espera', 'Clientes esperando resposta', 'Ninguém respondeu além do limite da unidade. No sino, todas viram um item só.'],
    /* funil-atendimento */ ['lead_parado', 'Lead parado em Novo lead', 'Lead novo sem resposta da loja além do tempo das Regras automáticas do funil.'],
    ['ia_equipe', 'A IA passou para a equipe', 'Quando a IA precisa de uma pessoa (com o motivo).'],
    ['transferida', 'Conversa passada para você', 'Transferida ou atribuída a você.'],
    ['agenda_mudou', 'Agendamento cancelado ou remarcado', 'Quando a cliente pede para remarcar.'],
    /* atendimento-extra */ ['reuniao', 'Reunião online', 'Alguém marcou ou desmarcou pelo link de agendamento, e o lembrete antes da reunião.'],
    ['lembrete_ligacao', 'Lembrete de ligação', 'Ligações programadas, na hora marcada.'],
    ['radar', 'Radar disparou', 'Aconteceu o que você pediu para vigiar numa conversa (ou chegou o prazo).'],
    ['nps_baixa', 'Nota baixa na pesquisa de satisfação', 'Cliente deu nota de 0 a 6 (só para a gestão).'],
    ['falha', 'Problemas que impedem o trabalho', 'WhatsApp desconectado, chave da IA, agenda (só administração e direção).'],
  ];

  const est = { problemas: [], esperando: [], abertas: new Set(), itens: [], proximo: null, carregando: false, aberto: false, n: 0, versao: null, silencio: false, prefs: null, tituloBase: document.title.replace(/^\(\d+\+?\)\s*/, ''), toastAtual: null, vistas: new Set() };

  // ---------------------------------------------------------------- tempo
  const diaDe = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const grupoDe = (d) => { const hoje = diaDe(Date.now()); const g = diaDe(d); return g === hoje ? 'Hoje' : g === hoje - 864e5 ? 'Ontem' : 'Antes'; };
  function relativo(d) {
    const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (grupoDe(d) === 'Hoje') return `há ${Math.floor(s / 3600)} h`;
    const hm = new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (grupoDe(d) === 'Ontem') return `ontem, ${hm}`;
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + `, ${hm}`;
  }
  // notificacoes2: aviso que se repetiu vira um item só com "(26×)".
  const textoDe = (n) => (n.contador > 1 ? `${n.texto} (${n.contador}×)` : n.texto);

  // ---------------------------------------------------------------- contador, título, ícone da aba
  const iconeOriginal = document.querySelector('link[rel="icon"][sizes="64x64"]') || document.querySelector('link[rel="icon"]');
  const hrefOriginal = iconeOriginal ? iconeOriginal.href : '/favicon-64.png';
  let imgIcone;
  function desenharIcone(n) {
    if (!iconeOriginal) return;
    if (!n) { iconeOriginal.href = hrefOriginal; return; }
    const pintar = () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      g.drawImage(imgIcone, 0, 0, 64, 64);
      const cor = getComputedStyle(document.documentElement).getPropertyValue('--badge').trim() || 'red';
      g.beginPath(); g.arc(48, 16, 15, 0, 2 * Math.PI); g.fillStyle = cor; g.fill();
      g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
      try { iconeOriginal.href = c.toDataURL('image/png'); } catch {}
    };
    if (imgIcone?.complete && imgIcone.naturalWidth) return pintar();
    imgIcone = new Image(); imgIcone.onload = pintar; imgIcone.src = hrefOriginal;
  }
  function mostrarContador(n) {
    est.n = n;
    const txt = n > 99 ? '99+' : String(n);
    for (const id of ['lt-sino-qtd', 'sino-cel-qtd']) { const b = $(id); if (b) { b.hidden = !n; b.textContent = txt; } }
    for (const id of ['lt-sino', 'sino-cel']) { const b = $(id); if (b) b.setAttribute('aria-label', n ? `Notificações, ${n} precisa${n > 1 ? 'm' : ''} de você` : 'Notificações'); }
    document.title = n ? `(${txt}) ${est.tituloBase}` : est.tituloBase;
    desenharIcone(n);
    if ($('nt-marcar')) $('nt-marcar').disabled = !n;
  }
  const balancar = () => ['lt-sino', 'sino-cel'].forEach((id) => { const b = $(id); if (!b) return; b.classList.remove('nt-balanca'); void b.offsetWidth; b.classList.add('nt-balanca'); });

  // ---------------------------------------------------------------- som (Web Audio, sem arquivo)
  let audio;
  const prepararAudio = () => { try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {} };
  addEventListener('pointerdown', prepararAudio, { once: true, capture: true });
  addEventListener('keydown', prepararAudio, { once: true, capture: true });
  function tocar() {
    // O som é o mesmo da mensagem nova (padrão: Futurista), desenhado em /telas/alertas.js.
    const al = window.SintoniaTelas.alertas;
    if (al?.tocarMensagem && al.tocarMensagem()) return;
    try {
      prepararAudio(); if (!audio || audio.state !== 'running') return;
      const t = audio.currentTime;
      [[880, 0], [1318.5, 0.11]].forEach(([f, atraso]) => {
        const o = audio.createOscillator(), v = audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        v.gain.setValueAtTime(0.0001, t + atraso);
        v.gain.exponentialRampToValueAtTime(0.09, t + atraso + 0.015);
        v.gain.exponentialRampToValueAtTime(0.0001, t + atraso + 0.22);
        o.connect(v).connect(audio.destination); o.start(t + atraso); o.stop(t + atraso + 0.25);
      });
    } catch {}
  }

  // ---------------------------------------------------------------- abrir o que a notificação aponta
  function irPara(n) {
    if (n.conversaId) { ui.abrir(n.conversaId); return; }
    // "conexoes" ou "conexoes#nao-oficial" (aviso do WhatsApp): abre a tela de Conexões no lugar certo.
    if (n.vista && n.vista.split('#')[0] === 'conexoes') { location.href = '/' + n.vista; return; }
    if (n.vista) ui.mostrar(n.vista);
  }
  async function tocarItem(n) {
    fechar();
    if (n.sinteticaEspera) { irPara(n); return; }
    if (!n.lida) {
      if (pedeAcao(n)) mostrarContador(Math.max(0, est.n - 1)); /* notificacoes2: o número conta só o que pede ação */
      n.lida = true;
      post(`/api/notificacoes/${n.id}/lida`).catch(() => {});
    }
    irPara(n);
  }

  // ---------------------------------------------------------------- toast
  function mostrarToast(n) {
    est.toastAtual?.remove();
    const t = el('div', { class: 'nt-toast', role: 'status', 'aria-live': 'polite' });
    const ic = el('span', { class: 'nt-ic ' + (CLASSE_IC[n.tipo] || ''), html: IC[n.tipo] || IC.sino });
    const fechar = el('button', { class: 'nt-fechar', 'aria-label': 'Dispensar', html: IC.fechar });
    t.append(ic, el('div', { class: 'nt-corpo' }, el('b', { class: 'nt-titulo', text: n.titulo }), el('span', { class: 'nt-texto', text: textoDe(n) })), fechar);
    const some = () => { t.classList.remove('nt-ver'); setTimeout(() => t.remove(), 300); if (est.toastAtual === t) est.toastAtual = null; };
    fechar.addEventListener('click', (e) => { e.stopPropagation(); some(); });
    t.addEventListener('click', () => { some(); tocarItem(n); });
    document.body.append(t); est.toastAtual = t;
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('nt-ver')));
    setTimeout(some, 6500);
  }

  // ---------------------------------------------------------------- busca
  async function buscar(mais = false) {
    if (est.carregando || (mais && !est.proximo)) return null;
    est.carregando = true;
    try {
      const q = new URLSearchParams({ limite: '20' });
      if (mais) q.set('antes', est.proximo);
      const r = await api('/api/notificacoes?' + q);
      est.itens = mais ? est.itens.concat(r.itens.filter((x) => !est.itens.some((y) => y.id === x.id))) : r.itens;
      est.proximo = r.proximo; est.silencio = r.silencio; est.problemas = r.problemas || [];
      if (!mais) est.esperando = r.esperando || []; /* notificacoes2: quem está esperando de verdade */
      mostrarContador(r.naoLidas);
      if (r.versao) est.versao = Math.max(est.versao ?? 0, r.versao);
      return r;
    } finally { est.carregando = false; }
  }

  /** Chegou versão nova pelo cabeçalho: busca, e avisa (toast + som) do que é novo e ainda não lido. */
  async function novidades(versaoAntiga) {
    const antes = new Set(est.esperando.map((x) => x.conversaId));
    const r = await buscar(false).catch(() => null);
    if (!r) return;
    /* notificacoes2: cliente que começou a esperar agora (a espera não vem mais nas notificações da lista) */
    const novaEspera = est.esperando.find((x) => !antes.has(x.conversaId) && !est.vistas.has('espera:' + x.conversaId + ':' + x.desde));
    if (novaEspera) {
      est.vistas.add('espera:' + novaEspera.conversaId + ':' + novaEspera.desde);
      r.itens = r.itens.concat({ id: 'espera-' + novaEspera.conversaId, tipo: 'espera', titulo: `${novaEspera.nome} está esperando`, texto: `Sem resposta há ${novaEspera.minutos} min`, contador: 1, conversaId: novaEspera.conversaId, em: new Date().toISOString(), lida: false, sinteticaEspera: true });
    }
    if (est.aberto) desenharLista();
    const novas = r.itens.filter((n) => !n.lida && new Date(n.em).getTime() > versaoAntiga && !est.vistas.has(n.id + ':' + n.em));
    novas.forEach((n) => est.vistas.add(n.id + ':' + n.em));
    if (!novas.length) return;
    balancar();
    // A conversa já está aberta na tela: não precisa de aviso.
    const fora = novas.filter((n) => !(n.conversaId && ui.estado.aberta === n.conversaId && !document.hidden));
    if (!fora.length) return;
    if (!est.aberto) mostrarToast(fora[0]);
    // Mensagem da cliente já tem o som próprio (/telas/alertas.js): sem toque em dobro.
    const soMensagens = fora.every((n) => n.tipo === 'mensagem' || n.tipo === 'nova_cliente') && est.prefs?.mensagens?.som !== false && window.SintoniaTelas.alertas;
    if (fora.some((n) => n.tipo === 'espera')) window.SintoniaTelas.alertas?.atualizar();
    if (!est.silencio && (est.prefs?.som ?? true) && !soMensagens) tocar();
  }

  addEventListener('sintonia:notificacoes', (e) => {
    const { n = 0, v = 0, s = 0 } = e.detail || {};
    est.silencio = Boolean(s);
    if (n !== est.n) mostrarContador(n);
    if (est.versao === null) { est.versao = v; return; } // primeira leitura: só o contador
    if (v > est.versao) { const antiga = est.versao; est.versao = v; novidades(antiga); }
  });

  // ---------------------------------------------------------------- painel (página do painel lateral)
  /* notificacoes2: modelo C "Precisa de você" (escolhido pelo dono em 21/11).
   * No topo, só o que pede ação: clientes esperando (Responder), a IA pediu ajuda (Assumir), conversa passada para você
   * (Responder) e problemas (Resolver / Lembrar em 1 h). Embaixo, "Para saber" em blocos por assunto
   * (Clientes, Agenda, Equipe, Sistema) que abrem. O histórico completo tem filtros por assunto e limpar. */
  let lista;
  const P = () => window.SintoniaPainel;
  const nomesCurto = (nomes) => (nomes.length <= 2 ? nomes.join(' e ') : `${nomes.slice(0, 2).join(', ')} e mais ${nomes.length - 2}`);
  const CATS = [['clientes', 'Clientes'], ['agenda', 'Agenda'], ['equipe', 'Equipe'], ['sistema', 'Sistema']];
  const IC_CAT = { clientes: IC.mensagem, agenda: IC.agendamento, equipe: IC.equipe, sistema: IC.falha };
  /** Assunto de cada aviso (as mesmas quatro caixas do histórico). */
  function categoria(n) {
    if (n.tipo === 'falha') return 'sistema';
    if (n.tipo === 'agenda_mudou' || n.tipo === 'reuniao' || n.tipo === 'lembrete_ligacao') return 'agenda';
    if (n.tipo === 'transferida' || n.tipo === 'teste' || (n.tipo === 'ia_equipe' && !n.conversaId)) return 'equipe';
    return 'clientes';
  }
  /** Pede uma ação sua (o mesmo critério do servidor, src/notificacoes/tipos.ts: pedeAcao). */
  const pedeAcao = (n) => !n.lida && (n.tipo === 'transferida' || n.tipo === 'falha' || (n.tipo === 'ia_equipe' && Boolean(n.conversaId)));
  const iniciais = (nome) => String(nome || '?').replace(/^\+/, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
  const CORES_AV = ['#106ebe', '#0a8f7a', '#7c3aed', '#c2410c', '#0369a1', '#be185d', '#4d7c0f'];
  const corDe = (s) => CORES_AV[[...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % CORES_AV.length];
  const primeiroNome = (s) => String(s || '').trim().split(/\s+/)[0] || '';
  /** Quanto tempo esperando, curto: "6 min", "2 h", "1 h 20", "1 dia". */
  const tempoEspera = (m) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h${m % 60 && m < 600 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${Math.floor(m / 1440)} dia${m >= 2880 ? 's' : ''}`);

  /** Marca como lidas (no servidor também) e ajusta o número do sino. */
  function marcarLidas(ns) {
    const novas = ns.filter((n) => !n.lida);
    if (!novas.length) return;
    const acoes = novas.filter(pedeAcao).length;
    for (const n of novas) { n.lida = true; post(`/api/notificacoes/${n.id}/lida`).catch(() => {}); }
    if (acoes) mostrarContador(Math.max(0, est.n - acoes));
    desenharLista();
  }
  async function assumir(n) {
    marcarLidas([n]);
    fechar();
    try { await post(`/api/conversas/${n.conversaId}/assumir`); toast('A conversa agora é sua.'); } catch (x) { toast(x.message || 'Não deu para assumir.'); }
    ui.abrir(n.conversaId);
  }
  async function lembrarDepois(n) {
    const r = await post(`/api/notificacoes/${n.id}/adiar`, { minutos: 60 }).catch((x) => { toast(x.message); return null; });
    if (!r) return;
    est.itens = est.itens.filter((x) => x.id !== n.id);
    if (!n.lida) mostrarContador(Math.max(0, est.n - 1));
    desenharLista(); toast('Combinado: aviso de novo em 1 hora.');
  }
  async function lembrarProblema(pr) {
    const r = await post('/api/notificacoes/problemas/adiar', { chave: pr.chave, minutos: 60 }).catch((x) => { toast(x.message); return null; });
    if (!r) return;
    est.problemas = est.problemas.filter((x) => x.chave !== pr.chave);
    mostrarContador(Math.max(0, est.n - 1));
    desenharLista(); toast('Combinado: aviso de novo em 1 hora.');
  }

  const botao = (texto, onclick, leve = false) => el('button', { class: 'nt-bt' + (leve ? ' leve' : ''), type: 'button', text: texto, onclick });
  function cartao({ classe, ic, icClasse, rotulo, quando, titulo, texto, botoes }) {
    return el('div', { class: 'nt-card ' + classe },
      el('div', { class: 'nt-card-topo' }, el('span', { class: 'nt-ic ' + icClasse, html: ic }),
        el('div', {}, el('div', { class: 'nt-rotulo' }, el('span', { text: rotulo }), quando ? el('span', { text: quando }) : null),
          el('div', { class: 'nt-titulo', text: titulo }), texto ? el('div', { class: 'nt-texto', text: texto }) : null)),
      el('div', { class: 'nt-card-bts' }, ...botoes));
  }
  function cartaoEspera(esperas) {
    const qtd = esperas.length;
    const mostrar = esperas.slice(0, 6);
    return el('div', { class: 'nt-card urg' },
      el('div', { class: 'nt-card-topo' }, el('span', { class: 'nt-ic t-espera', html: IC.espera }),
        el('div', {}, el('div', { class: 'nt-titulo', text: qtd === 1 ? '1 cliente esperando resposta' : `${qtd} clientes esperando resposta` }),
          el('div', { class: 'nt-texto', text: 'Ninguém respondeu dentro do prazo. A que espera há mais tempo vem primeiro.' }))),
      el('div', { class: 'nt-pessoas' }, ...mostrar.map((x) => el('div', { class: 'nt-pessoa' },
        el('span', { class: 'nt-av', style: `background:${corDe(x.nome)}`, text: iniciais(x.nome), 'aria-hidden': 'true' }),
        el('span', { class: 'nt-nm' }, el('b', { text: x.nome }), el('small', { text: x.dona ? `Com ${primeiroNome(x.dona)}` : 'Sem dona' })),
        el('span', { class: 'nt-min' + (x.nivel === 2 ? ' urg' : ''), text: tempoEspera(x.minutos) }),
        el('button', { class: 'nt-bt', type: 'button', text: 'Responder', 'aria-label': `Responder ${x.nome}`, onclick: () => { fechar(); ui.abrir(x.conversaId); } })))),
      qtd > mostrar.length ? el('button', { class: 'nt-link nt-mais', type: 'button', text: `Ver as ${qtd} em Conversas`, onclick: () => abrirEsperando(esperas) }) : null);
  }
  function cartaoProblema(pr) {
    return cartao({ classe: 'urg', ic: IC.falha, icClasse: 't-problema', rotulo: 'Impede o trabalho', titulo: pr.titulo, texto: pr.texto,
      botoes: [botao('Resolver', () => { fechar(); irPara({ vista: pr.vista }); }), botao('Lembrar em 1 h', () => lembrarProblema(pr), true)] });
  }
  function cartaoAcao(n) {
    const quando = relativo(n.em);
    if (n.tipo === 'ia_equipe') return cartao({ classe: 'at', ic: IC.ia_equipe, icClasse: 't-ia_equipe', rotulo: 'A IA pediu ajuda', quando, titulo: n.titulo, texto: textoDe(n),
      botoes: [botao('Assumir', () => assumir(n)), botao('Depois', () => marcarLidas([n]), true)] });
    if (n.tipo === 'transferida') return cartao({ classe: 'at', ic: IC.transferida, icClasse: 't-transferida', rotulo: 'Para você', quando, titulo: n.titulo, texto: textoDe(n),
      botoes: [botao('Responder', () => tocarItem(n)), botao('Depois', () => marcarLidas([n]), true)] });
    return cartao({ classe: 'urg', ic: IC.falha, icClasse: 't-falha', rotulo: 'Impede o trabalho', quando, titulo: n.titulo, texto: textoDe(n),
      botoes: [botao(n.conversaId ? 'Abrir' : 'Resolver', () => tocarItem(n)), botao('Lembrar em 1 h', () => lembrarDepois(n), true)] });
  }
  /** Uma linha de aviso (Para saber e histórico). */
  function linhaAviso(n, tag = 'button') {
    const props = tag === 'button' ? { class: 'nt-item' + (n.lida ? '' : ' nt-nova'), type: 'button', 'data-id': n.id, onclick: () => tocarItem(n) }
      : { class: 'nt-item' + (n.lida ? '' : ' nt-nova'), role: 'button', tabindex: '0', 'data-id': n.id };
    return el(tag, props,
      el('span', { class: 'nt-ic ' + CLASSE_IC[n.tipo], html: IC[n.tipo] || IC.sino }),
      el('span', { class: 'nt-corpo' }, el('span', { class: 'nt-titulo', text: n.titulo }),
        el('span', { class: 'nt-quando' }, el('span', { class: 'nt-quando-tx', text: relativo(n.em) }), n.lida ? null : el('i', { class: 'nt-ponto', 'aria-label': 'não lida' })),
        n.texto ? el('span', { class: 'nt-texto', text: textoDe(n) }) : null));
  }

  function desenharLista() {
    if (!lista || !lista.isConnected) return;
    const frag = [];
    const acoes = est.itens.filter(pedeAcao);
    const total = est.esperando.length + est.problemas.length + acoes.length;
    if (total) {
      frag.push(el('div', { class: 'nt-faixa' }, el('span', { text: 'Precisa de você' }), el('span', { class: 'nt-qtd', text: String(total) })));
      if (est.esperando.length) frag.push(cartaoEspera(est.esperando));
      for (const pr of est.problemas) frag.push(cartaoProblema(pr));
      for (const n of acoes) frag.push(cartaoAcao(n));
    } else {
      frag.push(el('div', { class: 'nt-ok' }, el('span', { class: 'nt-ic t-ok', html: IC.teste }),
        el('div', {}, el('b', { text: 'Nada precisa de você agora' }), el('span', { text: 'Quando uma cliente esperar ou a IA pedir ajuda, aparece aqui no topo.' }))));
    }
    const resto = est.itens.filter((n) => !pedeAcao(n));
    if (resto.length) {
      const novas = resto.filter((n) => !n.lida);
      frag.push(el('div', { class: 'nt-grupo nt-grupo-saber' }, el('span', { text: 'Para saber' }),
        el('button', { class: 'nt-link', type: 'button', text: 'Marcar como lido', disabled: novas.length ? undefined : '', onclick: () => marcarLidas(novas) })));
      const caixa = el('div', { class: 'nt-cats' });
      for (const [c, nome] of CATS) {
        const l = resto.filter((n) => categoria(n) === c);
        if (!l.length) continue;
        const nn = l.filter((n) => !n.lida).length;
        const aberta = est.abertas.has(c);
        caixa.append(el('button', { class: 'nt-cat' + (nn ? ' nt-nova' : ''), type: 'button', 'aria-expanded': String(aberta), 'data-cat': c,
          onclick: () => { if (aberta) est.abertas.delete(c); else est.abertas.add(c); desenharLista(); } },
          el('span', { class: 'nt-ic k-' + c, html: IC_CAT[c] }),
          el('span', { class: 'nt-cat-corpo' },
            el('span', { class: 'nt-cat-nome' }, el('b', { text: nome }), nn ? el('span', { class: 'nt-qtd', text: String(nn), 'aria-label': `${nn} não lida${nn > 1 ? 's' : ''}` }) : el('span', { class: 'nt-total', text: String(l.length) })),
            el('span', { class: 'nt-texto', text: l.slice(0, 2).map((n) => n.titulo).join(' · ') + (l.length > 2 ? ` · +${l.length - 2}` : '') })),
          el('span', { class: 'nt-seta', html: IC.seta })));
        if (aberta) caixa.append(el('div', { class: 'nt-cat-lista' }, ...l.map((n) => linhaAviso(n))));
      }
      frag.push(caixa);
    }
    frag.push(el('button', { class: 'nt-link nt-hist', type: 'button', text: 'Ver histórico completo', onclick: abrirHistorico }));
    lista.replaceChildren(...frag);
    const marcar = $('nt-marcar'); if (marcar) marcar.disabled = !est.itens.some((n) => !n.lida);
  }

  /** Mais de 6 esperando: abre a lista de Conversas no filtro "Esperando". */
  function abrirEsperando(esperas) {
    fechar();
    const ids = [...new Set(esperas.map((n) => n.conversaId).filter(Boolean))];
    if (ids.length === 1) { ui.abrir(ids[0]); return; }
    ui.mostrar('conversas');
    if (innerWidth <= 760 && ui.estado.aberta) $('voltar')?.click();
    document.querySelector('[data-f="esperando"]')?.click();
  }

  // ---------------------------------------------------------------- histórico completo (filtros + limpar)
  function abrirHistorico() {
    const h = { itens: [], proximo: null, filtro: 'tudo', carregando: false, erro: '' };
    let corpoH;
    let dica = innerWidth <= 760;
    try { if (localStorage.getItem('sintonia.nt.dica-limpar') === 'vista') dica = false; } catch {}
    async function carregar(mais) {
      if (h.carregando) return;
      h.carregando = true; desenhar();
      try {
        const q = new URLSearchParams({ limite: '50' });
        if (mais && h.proximo) q.set('antes', h.proximo);
        const r = await api('/api/notificacoes?' + q);
        h.itens = mais ? h.itens.concat(r.itens.filter((x) => !h.itens.some((y) => y.id === x.id))) : r.itens;
        h.proximo = r.proximo; h.erro = '';
      } catch (x) { h.erro = x.message || 'Não deu para carregar.'; }
      h.carregando = false; desenhar();
    }
    async function limpar(ns) {
      const ids = ns.map((n) => n.id);
      corpoH?.querySelectorAll(ids.map((id) => `[data-linha="${id}"]`).join(',')).forEach((e) => { e.style.maxHeight = e.offsetHeight + 'px'; void e.offsetHeight; e.classList.add('nt-saindo'); });
      const r = await post('/api/notificacoes/limpar', { ids }).catch((x) => { toast(x.message); return null; });
      if (!r) { desenhar(); return; }
      const acoes = ns.filter(pedeAcao).length;
      setTimeout(() => {
        h.itens = h.itens.filter((n) => !ids.includes(n.id));
        est.itens = est.itens.filter((n) => !ids.includes(n.id));
        if (acoes) mostrarContador(Math.max(0, est.n - acoes));
        desenhar();
      }, 260);
    }
    function ler(n) { marcarLidas([n]); const x = h.itens.find((y) => y.id === n.id); if (x) x.lida = true; desenhar(); }
    function linhaHist(n) {
      const item = linhaAviso(n, 'div');
      item.querySelector('.nt-quando').append(el('span', { class: 'nt-h-acoes' },
        n.lida ? null : el('button', { class: 'nt-mini', type: 'button', title: 'Marcar como lida', 'aria-label': 'Marcar como lida', html: IC.teste, onclick: (e) => { e.stopPropagation(); ler(n); } }),
        el('button', { class: 'nt-mini', type: 'button', title: 'Limpar', 'aria-label': 'Limpar este aviso', html: IC.fechar, onclick: (e) => { e.stopPropagation(); limpar([n]); } })));
      // Arrastar para a esquerda limpa (celular; também com o mouse).
      let x0 = null, y0 = 0, dx = 0, arrastou = false;
      item.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; x0 = e.clientX; y0 = e.clientY; dx = 0; arrastou = false; });
      item.addEventListener('pointermove', (e) => {
        if (x0 == null) return;
        const ddx = e.clientX - x0, ddy = e.clientY - y0;
        if (!arrastou && Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy)) { arrastou = true; try { item.setPointerCapture(e.pointerId); } catch {} }
        if (arrastou) { dx = Math.min(0, ddx); item.style.transform = `translateX(${dx}px)`; }
      });
      const soltar = () => {
        if (x0 == null) return;
        x0 = null;
        if (!arrastou) return;
        item.style.transition = 'transform .18s ease';
        if (dx < -90) { item.style.transform = 'translateX(-105%)'; try { localStorage.setItem('sintonia.nt.dica-limpar', 'vista'); } catch {} limpar([n]); }
        else { item.style.transform = ''; setTimeout(() => { item.style.transition = ''; }, 200); }
      };
      item.addEventListener('pointerup', soltar);
      item.addEventListener('pointercancel', soltar);
      item.addEventListener('click', (e) => { if (arrastou || e.target.closest('button')) return; tocarItem(n); });
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter') tocarItem(n); if (e.key === 'Delete') limpar([n]); });
      return el('div', { class: 'nt-linha-h', 'data-linha': n.id }, el('div', { class: 'nt-fundo-limpar', 'aria-hidden': 'true' }, el('span', { html: IC.lixo }), 'Limpar'), item);
    }
    function desenhar() {
      if (!corpoH || !corpoH.isConnected) return;
      const conta = (c) => h.itens.filter((n) => !n.lida && (c === 'tudo' || categoria(n) === c)).length;
      const chips = el('div', { class: 'nt-chips', role: 'group', 'aria-label': 'Filtrar por assunto' },
        ...[['tudo', 'Tudo'], ...CATS].map(([c, nome]) => {
          const n = conta(c);
          return el('button', { class: 'nt-chip k-' + c, type: 'button', 'aria-pressed': String(h.filtro === c), onclick: () => { h.filtro = c; desenhar(); } },
            c === 'tudo' ? null : el('span', { class: 'nt-chip-pt', 'aria-hidden': 'true' }), nome, n ? el('i', { text: String(n) }) : null);
        }));
      const filtrados = h.itens.filter((n) => h.filtro === 'tudo' || categoria(n) === h.filtro);
      const corpo = [];
      if (dica && filtrados.length) corpo.push(el('div', { class: 'nt-dica-limpar' }, el('span', { text: 'Dica: arraste um aviso para a esquerda para limpar.' }),
        el('button', { class: 'nt-x', type: 'button', 'aria-label': 'Fechar dica', html: IC.fechar, onclick: () => { dica = false; try { localStorage.setItem('sintonia.nt.dica-limpar', 'vista'); } catch {} desenhar(); } })));
      let grupo = '', doGrupo = [];
      const fecharGrupo = () => {
        if (!doGrupo.length) return;
        const ns = doGrupo;
        corpo.push(el('div', { class: 'nt-grupo' }, el('span', { text: grupo }), el('button', { class: 'nt-link', type: 'button', text: 'Limpar', 'aria-label': `Limpar os avisos de ${grupo.toLowerCase()}`, onclick: () => limpar(ns) })));
        for (const n of ns) corpo.push(linhaHist(n));
      };
      for (const n of filtrados) {
        const g = grupoDe(n.em);
        if (g !== grupo) { fecharGrupo(); grupo = g; doGrupo = []; }
        doGrupo.push(n);
      }
      fecharGrupo();
      if (!filtrados.length && !h.carregando) corpo.push(el('div', { class: 'nt-vazio' }, h.erro || (h.filtro === 'tudo' ? 'Nenhum aviso por aqui.' : `Nada em ${CATS.find((x) => x[0] === h.filtro)[1]}.`)));
      if (h.carregando) corpo.push(el('div', { class: 'nt-fim', text: 'Carregando…' }));
      else if (h.proximo) corpo.push(el('button', { class: 'nt-link nt-hist', type: 'button', text: 'Carregar mais', onclick: () => carregar(true) }));
      corpoH.replaceChildren(chips, el('div', { class: 'nt-lista nt-lista-h' }, ...corpo));
    }
    P().empurrar({ id: 'nt-historico', titulo: 'Histórico', montar: (corpo) => { corpoH = corpo; desenhar(); carregar(false); }, aoSair: () => { desenharLista(); } });
  }

  function desenharConvite(caixa) {
    if (!caixa) return;
    caixa.replaceChildren();
    let dispensado = false; try { dispensado = localStorage.getItem('sintonia.nt.convite') === 'fechado'; } catch {}
    if (dispensado || !('Notification' in window) || Notification.permission !== 'default' || est.prefs?.push === false) return;
    caixa.append(el('div', { class: 'nt-convite' }, el('span', { text: 'Receba os avisos mesmo com o app fechado.' }),
      el('button', { class: 'nt-botao', text: 'Ativar', onclick: async () => { await ligarPush(true); desenharConvite(caixa); } }),
      el('button', { class: 'nt-x', 'aria-label': 'Dispensar', html: IC.fechar, onclick: () => { try { localStorage.setItem('sintonia.nt.convite', 'fechado'); } catch {} desenharConvite(caixa); } })));
  }

  async function abrir() {
    const pref = el('button', { class: 'pl-bt', type: 'button', title: 'Preferências de notificação', 'aria-label': 'Preferências de notificação', html: IC.engrenagem, onclick: () => abrirPreferencias({ empurrar: true }) });
    est.aberto = true;
    ['lt-sino', 'sino-cel'].forEach((id) => $(id)?.setAttribute('aria-expanded', 'true'));
    P().abrir({ id: 'notificacoes', titulo: 'Notificações', acoes: [pref], aoFechar: () => { est.aberto = false; ['lt-sino', 'sino-cel'].forEach((id) => $(id)?.setAttribute('aria-expanded', 'false')); },
      montar: (corpo) => {
        const convite = el('div', { id: 'nt-convite' });
        lista = el('div', { class: 'nt-painel-c', id: 'nt-lista' });
        corpo.append(el('div', { class: 'nt-topo-lista' }, el('button', { class: 'nt-link', id: 'nt-marcar', type: 'button', text: 'Marcar tudo como lido', onclick: marcarTodas })), convite, lista);
        desenharConvite(convite);
        desenharLista();
      } });
    await buscar(false).catch(() => {});
    desenharLista();
  }
  function fechar() {
    if (P()?.aberto('notificacoes')) P().fechar();
    est.aberto = false;
  }
  /** Marca todos os avisos como lidos: os que pedem ação descem para "Para saber"; esperas e problemas continuam no topo. */
  async function marcarTodas() {
    await post('/api/notificacoes/lidas').catch(() => {});
    est.itens.forEach((n) => (n.lida = true));
    mostrarContador(est.esperando.length + est.problemas.length); desenharLista(); toast('Tudo marcado como lido.');
  }

  for (const id of ['lt-sino', 'sino-cel']) {
    const b = $(id);
    if (b) { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.addEventListener('click', () => (P()?.aberto('notificacoes') ? fechar() : abrir())); }
  }

  // ---------------------------------------------------------------- push (service worker)
  const ehIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSuportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let registro = null;
  async function registrarSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { registro = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch { registro = null; }
    return registro;
  }
  const chaveBytes = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

  /** Pede permissão (se `pedir`), inscreve o aparelho e grava no servidor. Devolve true se ficou inscrito. */
  async function ligarPush(pedir) {
    if (!pushSuportado) { toast(ehIOS && !instalado ? 'No iPhone, adicione a Sintonia à Tela de Início primeiro.' : 'Este navegador não recebe notificações.'); return false; }
    let perm = Notification.permission;
    if (perm === 'default' && pedir) perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (pedir) toast(perm === 'denied' ? 'As notificações estão bloqueadas nas configurações do navegador.' : 'Permissão não concedida.'); return false; }
    try {
      const reg = registro || (await registrarSW()) || (await navigator.serviceWorker.ready);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { chave } = await api('/api/push/chave');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(chave) });
      }
      await post('/api/push/inscrever', sub.toJSON());
      return true;
    } catch (x) {
      if (pedir) toast('Não foi possível ativar neste aparelho: ' + (x.message || 'erro'));
      return false;
    }
  }
  /** "Ativar notificações": pede a permissão no toque, inscreve o aparelho e liga a preferência. */
  async function ativarPush() {
    const ok = await ligarPush(true);
    if (ok) { await salvar({ push: true }); toast('Pronto: este aparelho vai receber os avisos.'); }
    return ok;
  }
  async function desligarPush() {
    try {
      const reg = registro || (await navigator.serviceWorker.getRegistration('/'));
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) { await post('/api/push/sair', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.tipo === 'sintonia:abrir') { irPara(m.dados || {}); buscar(false).catch(() => {}); }
      if (m.tipo === 'sintonia:push') { const antiga = est.versao ?? 0; novidades(antiga); }
      if (m.tipo === 'sintonia:reinscrever' && est.prefs?.push !== false) ligarPush(false);
    });
  }

  // ---------------------------------------------------------------- preferências
  async function salvar(campos) {
    try { est.prefs = { ...est.prefs, ...(await api('/api/notificacoes/preferencias', { method: 'PUT', body: JSON.stringify(campos) })) }; dispatchEvent(new CustomEvent('sintonia:preferencias', { detail: est.prefs })); }
    catch (x) { toast(x.message); }
  }
  const chave = (checked, onchange, rotulo, disabled = false) => {
    const i = el('input', { type: 'checkbox', role: 'switch', 'aria-label': rotulo });
    i.checked = checked; i.disabled = disabled; i.addEventListener('change', () => onchange(i.checked, i));
    return el('label', { class: 'nt-chave' }, i, el('i'));
  };
  const linhaPref = (titulo, sub, controle) => el('div', { class: 'nt-linha' }, el('span', {}, titulo, sub ? el('small', { text: sub }) : null), controle);

  async function abrirPreferencias(op = {}) {
    const p = await api('/api/notificacoes/preferencias').catch((x) => { toast(x.message); return null; });
    if (!p) return;
    est.prefs = p;
    const corpo = el('div', { class: 'nt-pref-corpo' });

    // Celular / computador (push)
    const permissao = 'Notification' in window ? Notification.permission : 'indisponivel';
    const estadoPush = el('small');
    const atualizarEstadoPush = async () => {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/').catch(() => null) : null;
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
      const perm = 'Notification' in window ? Notification.permission : 'indisponivel';
      estadoPush.textContent = !pushSuportado ? (ehIOS && !instalado ? 'Disponível depois de adicionar à Tela de Início.' : 'Este navegador não recebe notificações.')
        : perm === 'denied' ? 'Bloqueado nas configurações do navegador.'
        : sub && est.prefs.push ? 'Ativo neste aparelho.' : 'Desligado neste aparelho.';
      return Boolean(sub);
    };
    const inscrito = await atualizarEstadoPush();
    const chavePush = chave(Boolean(p.push && inscrito && permissao === 'granted'), async (ligado, input) => {
      if (ligado) {
        const ok = await ligarPush(true);
        input.checked = ok;
        if (ok) { await salvar({ push: true }); toast('Pronto: este aparelho vai receber os avisos.'); }
      } else { await desligarPush(); await salvar({ push: false }); }
      atualizarEstadoPush();
    }, 'Receber no celular', !p.pushDisponivel || (!pushSuportado && !ehIOS));
    const secPush = el('div', { class: 'nt-secao' }, el('h3', { text: 'Neste aparelho' }),
      el('div', { class: 'nt-linha' }, el('span', {}, 'Receber no celular', estadoPush), chavePush));
    // Botão claro para o 1º pedido: o iPhone (app na Tela de Início) só deixa pedir a partir de um toque.
    if (pushSuportado && 'Notification' in window && Notification.permission === 'default') {
      const ativar = el('button', { class: 'nt-botao nt-ativar', type: 'button', text: 'Ativar notificações', onclick: async () => {
        const ok = await ativarPush();
        const inp = chavePush.querySelector('input'); if (inp) inp.checked = ok;
        if (ok || Notification.permission !== 'default') ativar.remove();
        atualizarEstadoPush();
      } });
      secPush.append(el('div', { class: 'nt-acoes' }, ativar));
    }
    if (ehIOS && !instalado) secPush.append(el('div', { class: 'nt-dica', text: 'No iPhone: abra a Sintonia no Safari, toque em Compartilhar (o quadrado com a seta) e depois em "Adicionar à Tela de Início". Abra pelo ícone novo e ligue esta opção. Precisa do iOS 16.4 ou mais novo.' }));
    else secPush.append(el('div', { class: 'nt-linha' }, el('small', { text: 'O aviso chega mesmo com o app fechado. Tocar nele abre a conversa.' })));
    secPush.append(linhaPref('Som no app', 'Um toque curto quando chega algo com o app aberto.', chave(p.som, (v) => { salvar({ som: v }); if (v) tocar(); }, 'Som no app')));
    secPush.append(el('div', { class: 'nt-acoes' },
      el('button', { class: 'nt-botao', text: 'Testar som', onclick: () => { prepararAudio(); setTimeout(tocar, 30); } }),
      el('button', { class: 'nt-botao', text: 'Enviar notificação de teste', onclick: async () => { const r = await post('/api/notificacoes/teste').catch((x2) => toast(x2.message)); if (r) toast(r.aparelhos ? `Enviada para ${r.aparelhos} aparelho(s).` : 'Enviada para o sino (nenhum aparelho com push ligado).'); } })));

    // Não perturbe
    const np = p.naoPerturbe;
    const inicio = el('input', { type: 'time', value: np.inicio, 'aria-label': 'Início do não perturbe' });
    const fim = el('input', { type: 'time', value: np.fim, 'aria-label': 'Fim do não perturbe' });
    const horas = el('div', { class: 'nt-horas' }, 'Das', inicio, 'às', fim);
    horas.hidden = !np.ligado;
    const salvarHoras = () => { if (inicio.value && fim.value) salvar({ naoPerturbe: { ligado: true, inicio: inicio.value, fim: fim.value } }); };
    inicio.addEventListener('change', salvarHoras); fim.addEventListener('change', salvarHoras);
    const secNp = el('div', { class: 'nt-secao' }, el('h3', { text: 'Não perturbe' }),
      linhaPref('Silenciar em um horário', 'Os avisos continuam no sino, mas o celular não toca.', chave(np.ligado, (v) => { horas.hidden = !v; salvar({ naoPerturbe: { ligado: v, inicio: inicio.value || '22:00', fim: fim.value || '07:00' } }); }, 'Não perturbe')),
      horas);

    // Tipos
    const souGestao = ['admin', 'direcao'].includes(ui.estado.eu?.papel);
    const secTipos = el('div', { class: 'nt-secao' }, el('h3', { text: 'O que avisar' }),
      ...TIPOS.filter(([t]) => t !== 'falha' || souGestao).map(([t, titulo, sub]) => linhaPref(titulo, sub, chave(p.tipos[t] !== false, (v) => salvar({ tipos: { [t]: v } }), titulo))));

    const extras = window.SintoniaTelas.alertas ? await window.SintoniaTelas.alertas.secoesPreferencias(p).catch(() => []) : [];
    corpo.append(secTipos, secPush, ...extras, secNp);
    /* empresa-conta: Conta › Notificações monta as mesmas preferências dentro da tela (sem painel lateral) */
    if (op.caixa) { op.caixa.replaceChildren(corpo); return; }
    const pagina = { id: 'nt-preferencias', titulo: 'Preferências', larga: true, montar: (c) => c.append(corpo) };
    if (op.empurrar && P().aberto()) P().empurrar(pagina); else P().abrir(pagina);
  }

  // ---------------------------------------------------------------- chegada por link (#conversa=<id>)
  function seguirHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const id = h.get('conversa'), vista = h.get('vista');
    if (!id && !vista) return;
    history.replaceState(null, '', location.pathname + location.search);
    irPara({ conversaId: id, vista });
  }
  addEventListener('hashchange', seguirHash);

  // ---------------------------------------------------------------- início
  (async () => {
    await registrarSW();
    // Espera o app saber quem está logada antes de abrir a conversa do link.
    for (let i = 0; i < 50 && !ui.estado.eu; i++) await new Promise((r) => setTimeout(r, 100));
    seguirHash();
    est.prefs = await api('/api/notificacoes/preferencias').catch(() => null);
    await buscar(false).catch(() => {});
    // Já tinha permitido: renova a inscrição (o navegador pode ter trocado o endereço).
    if (pushSuportado && Notification.permission === 'granted' && est.prefs?.push) ligarPush(false);
  })();

  window.SintoniaTelas.notificacoes = { abrir, fechar, preferencias: abrirPreferencias, ativarPush, verificar: () => novidades(est.versao ?? 0), tocar };
})();
