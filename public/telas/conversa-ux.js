/**
 * conversa-ux: acabamento da tela de conversa (pedidos do dono, 20/11).
 * - Ícones: um conjunto só (public/telas/icones.js), mesmo traço e tamanho no topo, na barra de envio e no menu "+".
 * - Anel das fotos: fio fino no degradê da marca (lista, topo da conversa, ficha), sem filtro caro.
 * - Barra de baixo: chip "Sem responsável" / "Responsável: Fulana" (com a foto), botões alinhados e do mesmo tamanho.
 * - Ficha da cliente: cartões no visual do Dashboard (topo com foto grande, ações rápidas, tags, valores,
 *   histórico, origem, dados e observações). Os campos continuam os mesmos (o app.html preenche pelos ids).
 * - Celular: a conversa entra direto, nunca com a logo (a logo só aparece no computador sem conversa aberta).
 * Gancho no app.html: desenharDono chama SintoniaConversaUx.chip(c).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const IC = () => window.SintoniaIcones;
  const ui = () => window.Sintonia && window.Sintonia.ui;

  const CSS = `
  /* ---------- celular: nada de logo na conversa (a conversa entra direto, com o fundo dela) ---------- */
  @media (max-width: 760px) { #sem-conversa { display: none !important; } }
  /* conversa aberta de outra tela, ainda chegando: sem "›" solto nem chip vazio */
  .chat-topo .quem #c-sub:empty::after { content: none !important; }
  #chat-aberto #modo:has(#modo-txt:empty) { visibility: hidden; }

  /* ---------- anel da marca nas fotos de cliente (lista, topo, ficha) ---------- */
  :root { --cux-anel: linear-gradient(135deg, #0ffcbe 0%, #3aa0ff 58%, #106ebe 100%); }
  html[data-tema="escuro"] { --cux-anel: linear-gradient(135deg, #0ffcbe 0%, #3aa0ff 100%); }
  #itens .item > .avatar:has(> img), #c-avatar:has(> img), #f-avatar:has(> img) {
    --cux-fio: 1.75px; box-shadow: none !important; background: var(--cux-anel) !important; }
  #c-avatar:has(> img) { --cux-fio: 1.75px; }
  #f-avatar:has(> img) { --cux-fio: 2.5px; }
  #itens .item > .avatar:has(> img) > img, #c-avatar:has(> img) > img, #f-avatar:has(> img) > img,
  #itens .item > .avatar:has(> img) > svg, #c-avatar:has(> img) > svg, #f-avatar:has(> img) > svg {
    position: absolute; inset: var(--cux-fio); width: calc(100% - 2 * var(--cux-fio)) !important; height: calc(100% - 2 * var(--cux-fio)) !important; border-radius: 50%; }
  #itens .item > .avatar:has(> img) > svg, #c-avatar:has(> img) > svg, #f-avatar:has(> img) > svg { background: var(--boneco-fundo); }

  /* ---------- topo da conversa: ícones do mesmo tamanho e peso ---------- */
  #chat-aberto .pilula-topo { gap: 0; padding: 2px 4px; }
  #chat-aberto .pilula-topo .icone { width: 40px; height: 40px; border-radius: 12px; color: var(--texto); }
  #chat-aberto .pilula-topo .icone svg { width: 22px; height: 22px; }
  #chat-aberto .pilula-topo .icone:hover { background: var(--vidro-item, var(--hover)); }
  #chat-aberto .voltar svg { width: 22px; height: 22px; }

  /* ---------- barra de envio ---------- */
  #chat-aberto .compor { gap: 8px; }
  #chat-aberto .linha-compor { gap: 2px; min-height: 40px; align-items: center; }
  #chat-aberto .linha-compor .icone { width: 40px; height: 40px; border-radius: 12px; color: var(--texto); margin: 0; }
  #chat-aberto .linha-compor .icone svg { width: 22px; height: 22px; }
  #chat-aberto .linha-compor .icone:not(.falar):hover { background: var(--vidro-item, var(--hover)); }
  #chat-aberto #enviar.falar, #chat-aberto #grav-enviar.falar { width: 42px !important; height: 42px !important; margin: 0 0 0 6px !important; border-radius: 50%;
    background: linear-gradient(135deg, #106ebe, #3aa0ff) !important; color: #fff !important; box-shadow: 0 6px 16px rgba(16, 110, 190, .28); }
  html[data-tema="escuro"] #chat-aberto #enviar.falar, html[data-tema="escuro"] #chat-aberto #grav-enviar.falar { box-shadow: 0 6px 18px rgba(58, 160, 255, .25); }
  #chat-aberto #enviar.falar svg, #chat-aberto #grav-enviar.falar svg { width: 21px; height: 21px; }
  #chat-aberto #grav-cancelar svg { width: 22px; height: 22px; }
  /* chip de quem atende: altura igual aos botões, texto claro, foto de quem é responsável */
  #chat-aberto .linha-compor .modo { height: 36px; padding: 0 10px 0 10px; gap: 7px; font-size: 13.5px; font-weight: 600; flex: 0 1 auto; min-width: 0; max-width: 280px; box-sizing: border-box; }
  #chat-aberto .linha-compor .espaco { flex: 1 1 0; min-width: 4px; }
  #chat-aberto .linha-compor .modo #modo-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #chat-aberto .linha-compor .modo > svg { flex: none; opacity: .6; }
  #chat-aberto .linha-compor .modo .cux-quem { flex: none; width: 22px; height: 22px; margin-left: -4px; border-radius: 50%; display: grid; place-items: center; overflow: hidden; position: relative;
    font-size: 9.5px; font-weight: 700; color: #fff; background: var(--marca-azul, #106ebe); }
  #chat-aberto .linha-compor .modo .cux-quem img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #chat-aberto .linha-compor .modo .cux-quem svg { width: 14px; height: 14px; color: var(--sub); }
  #chat-aberto .linha-compor .modo .cux-quem.cux-ninguem { background: transparent; box-shadow: inset 0 0 0 1.5px var(--linha); }
  #chat-aberto .linha-compor .modo.cux-com-quem > i { display: none; }
  @media (max-width: 760px) {
    #chat-aberto .compor { padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); }
    #chat-aberto .linha-compor .modo { height: 38px; font-size: 13.5px; }
  }

  /* menu "+" com os mesmos ícones */
  #menu-mais button > i svg { width: 20px; height: 20px; }

  /* ---------- áudio: botões de baixo alinhados com a onda ---------- */
  #msgs .audio-extras { margin: 0 0 0 56px; padding-right: 56px; gap: 6px; min-height: 28px; flex-wrap: nowrap; }
  #msgs .audio-extras button { white-space: nowrap; flex: none; }
  #msgs .audio-extras button { height: 26px; padding: 0 10px; font-size: 12px; }
  #msgs .audio-extras button svg { width: 14px; height: 14px; }
  #msgs .transcricao { margin: 8px 4px 0 6px; }

  /* ---------- ficha da cliente (visual do Dashboard) ---------- */
  #ficha.cux-ficha { background: transparent; gap: 12px; padding: 14px 14px calc(24px + env(safe-area-inset-bottom)); border-left: 0; }
  #ficha.cux-ficha > .topo { display: none; }
  #ficha.cux-ficha .bloco { background: none; padding: 0; }
  .cux-ficha { --cux-cartao: #ffffff; --cux-borda: rgba(8, 36, 63, .07); --cux-sombra: 0 4px 16px rgba(8, 36, 63, .06); --cux-mini: #eef3f8; }
  html[data-tema="escuro"] .cux-ficha { --cux-cartao: rgba(255, 255, 255, .05); --cux-borda: rgba(255, 255, 255, .09); --cux-sombra: none; --cux-mini: rgba(255, 255, 255, .06); }
  .cux-cartao { position: relative; border-radius: 22px; padding: 16px; display: grid; gap: 12px; background: var(--cux-cartao); box-shadow: inset 0 0 0 1px var(--cux-borda), var(--cux-sombra); min-width: 0; }
  .cux-cartao::after { content: ''; position: absolute; left: 18px; right: 18px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, transparent, #12d6a3, #3aa0ff, transparent); opacity: .5; pointer-events: none; }
  html[data-tema="escuro"] .cux-cartao::after { background: linear-gradient(90deg, transparent, #0ffcbe, #3aa0ff, transparent); }
  .cux-cab { display: flex; align-items: center; gap: 8px; min-height: 26px; }
  .cux-cab > i { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; flex: none; color: var(--marca-azul, #106ebe); background: rgba(16, 110, 190, .1); }
  html[data-tema="escuro"] .cux-cab > i { color: #7cc4ff; background: rgba(124, 196, 255, .14); }
  .cux-cab > i svg { width: 16px; height: 16px; }
  .cux-cab h3 { margin: 0 !important; font-size: 15px !important; font-weight: 700 !important; color: var(--texto) !important; flex: 1; min-width: 0; letter-spacing: -.005em; }
  .cux-cab .cux-link { all: unset; cursor: pointer; font-size: 13px; font-weight: 700; color: var(--marca-azul, #106ebe); padding: 4px 8px; border-radius: 8px; }
  html[data-tema="escuro"] .cux-cab .cux-link { color: #7cc4ff; }
  .cux-cab .cux-link:hover { background: var(--cux-mini); }

  /* topo: foto grande com o anel, nome, telefone, unidade, etapa e responsável */
  .cux-ficha .cux-heroi { text-align: center; padding: 22px 16px 18px; gap: 6px; justify-items: center; }
  #ficha.cux-ficha .cux-heroi #f-avatar { width: 108px; height: 108px; font-size: 38px; margin: 0 0 8px; }
  #ficha.cux-ficha .cux-heroi #f-nome { display: block; font-size: 22px; font-weight: 700; letter-spacing: -.01em; color: var(--texto); line-height: 1.2; max-width: 100%; overflow-wrap: anywhere; }
  .cux-tel { display: inline-flex; align-items: center; gap: 6px; color: var(--sub); font-size: 15px; font-variant-numeric: tabular-nums; }
  #ficha.cux-ficha .cux-tel #f-tel { color: var(--sub); font-size: 15px; }
  .cux-tel button { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--sub); }
  .cux-tel button:hover { background: var(--cux-mini); color: var(--texto); }
  .cux-tel button svg { width: 16px; height: 16px; }
  .cux-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 6px; }
  .cux-chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--texto); background: var(--cux-mini); max-width: 100%; }
  .cux-chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cux-chip svg { width: 14px; height: 14px; flex: none; color: var(--sub); }
  .cux-chip.etapa { color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .cux-chip.etapa svg { color: #fff; }
  .cux-chip .mini { width: 18px; height: 18px; margin-left: -4px; border-radius: 50%; overflow: hidden; position: relative; display: grid; place-items: center; font-size: 8.5px; font-weight: 700; color: #fff; background: var(--marca-azul, #106ebe); flex: none; }
  .cux-chip .mini img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  #ficha.cux-ficha .f-chegou { display: block; margin-top: 2px; font-size: 12.5px; color: var(--sub); }

  /* ações rápidas */
  .cux-acoes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
  .cux-acao { all: unset; box-sizing: border-box; cursor: pointer; display: grid; justify-items: center; gap: 6px; padding: 12px 4px 10px; border-radius: 18px; background: var(--cux-cartao);
    box-shadow: inset 0 0 0 1px var(--cux-borda), var(--cux-sombra); color: var(--texto); font-size: 12px; font-weight: 600; text-align: center; min-width: 0; }
  .cux-acao span { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cux-acao svg { width: 22px; height: 22px; color: var(--marca-azul, #106ebe); }
  html[data-tema="escuro"] .cux-acao svg { color: #7cc4ff; }
  .cux-acao:hover { background: var(--cux-mini); }
  .cux-acao[aria-pressed="true"] svg { fill: currentColor; }
  .cux-acao[hidden] { display: none; }
  #ficha.cux-ficha .acoes-perfil { display: none; }

  /* tags */
  .cux-tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .cux-tags .cux-vazio { color: var(--sub); font-size: 13.5px; }
  .cux-tag { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; color: var(--texto); background: var(--cux-mini); }
  .cux-tag i { width: 8px; height: 8px; border-radius: 50%; background: var(--cor, var(--marca-azul)); }
  .cux-etapa-linha { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--cux-mini); }
  .cux-etapa-linha b { font-size: 14px; flex: 1; min-width: 0; }
  .cux-etapa-linha small { color: var(--sub); font-size: 12px; display: block; font-weight: 500; }
  #ficha.cux-ficha #f-crm, #ficha.cux-ficha #f-etiquetas-bloco { display: none !important; }

  /* relatório (valores e agendamentos) */
  #ficha.cux-ficha #f-relatorio { background: none; padding: 0; }
  #ficha.cux-ficha #f-relatorio > h3 { display: none; }
  #ficha.cux-ficha .rl-numeros { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0 0 6px; }
  #ficha.cux-ficha .rl-num { background: var(--cux-mini); border: 0; border-radius: 14px; padding: 10px 12px; min-width: 0; }
  #ficha.cux-ficha .rl-num b { font-size: 17px; font-weight: 700; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -.01em; }
  #ficha.cux-ficha .rl-num span { font-size: 11.5px; color: var(--sub); }
  #ficha.cux-ficha .linha { font-size: 13.5px; padding: 9px 0; border-top: 1px solid var(--cux-borda); margin: 0; }
  #ficha.cux-ficha .linha span:last-child { text-align: right; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  /* histórico (linha do tempo) */
  .cux-tempo { list-style: none; margin: 0; padding: 0 0 0 4px; display: grid; gap: 0; }
  .cux-tempo li { position: relative; padding: 0 0 14px 22px; display: grid; gap: 1px; font-size: 13.5px; }
  .cux-tempo li::before { content: ''; position: absolute; left: 3px; top: 5px; width: 9px; height: 9px; border-radius: 50%; background: var(--cux-cartao); box-shadow: inset 0 0 0 2px #3aa0ff; }
  .cux-tempo li:first-child::before { background: linear-gradient(135deg, #0ffcbe, #3aa0ff); box-shadow: none; }
  .cux-tempo li::after { content: ''; position: absolute; left: 7px; top: 17px; bottom: 2px; width: 1.5px; background: var(--cux-borda); }
  .cux-tempo li:last-child { padding-bottom: 0; }
  .cux-tempo li:last-child::after { display: none; }
  .cux-tempo b { font-weight: 600; }
  .cux-tempo span { color: var(--sub); font-size: 12px; }
  /* origem */
  #ficha.cux-ficha #f-origem { background: none; padding: 0; }
  #ficha.cux-ficha #f-origem:empty { display: none; }
  /* dados (formulário) */
  #ficha.cux-ficha .ficha-form { background: none; padding: 0; display: grid; gap: 10px; }
  #ficha.cux-ficha .ficha-form > h3 { display: none; }
  #ficha.cux-ficha .ficha-form label:not(.interruptor), .cux-ficha .cux-obs label { display: grid; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--sub); }
  #ficha.cux-ficha .ficha-form input:not([type="checkbox"]), #ficha.cux-ficha .ficha-form select, #ficha.cux-ficha textarea {
    box-sizing: border-box; width: 100%; font: inherit; font-size: 15px; font-weight: 500; color: var(--texto); background: var(--cux-mini); border: 1px solid transparent; border-radius: 12px; padding: 10px 12px; margin: 0; }
  #ficha.cux-ficha .ficha-form input:focus, #ficha.cux-ficha textarea:focus, #ficha.cux-ficha .ficha-form select:focus { outline: none; border-color: #3aa0ff; box-shadow: 0 0 0 3px rgba(58, 160, 255, .18); }
  #ficha.cux-ficha textarea { resize: vertical; min-height: 84px; line-height: 1.4; }
  #ficha.cux-ficha .rodape-ficha { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .cux-obs .cux-salvar { justify-self: end; }
  /* atendimento */
  #ficha.cux-ficha .cux-sem-titulo > summary { display: none; }
  #ficha.cux-ficha .cux-sem-titulo, #ficha.cux-ficha .cux-sem-titulo > .rs-corpo { border: 0 !important; padding: 0 !important; margin: 0 !important; background: none !important; }
  #ficha.cux-ficha .cux-sem-titulo > .rs-corpo { display: grid; gap: 10px; }
  #ficha.cux-ficha .cux-atend .info { display: none; }
  #ficha.cux-ficha .rs-secao:not(.cux-sem-titulo) { border-radius: 14px; }
  #ficha.cux-ficha .em-ficha { padding: 12px 0 0 !important; border-top: 1px solid var(--cux-borda); }
  #ficha.cux-ficha .em-ficha h3 { display: flex; align-items: center; gap: 6px; font-size: 13px !important; font-weight: 700 !important; color: var(--sub) !important; }
  #ficha.cux-ficha .cux-atend select#f-etapa { display: none; }
  #ficha.cux-ficha .cux-atend > h3 { display: none; }
  #ficha.cux-ficha #f-resumo-bloco > h3 { display: none; }
  #ficha.cux-ficha #f-resumo { font-size: 14px !important; line-height: 1.5; }
  @media (max-width: 760px) {
    #ficha.cux-ficha { padding: 10px 12px calc(24px + env(safe-area-inset-bottom)); }
    .cux-acoes { gap: 6px; }
    .cux-acao { padding: 11px 2px 9px; font-size: 11.5px; }
  }
  `;

  function estilo() {
    if ($('conversa-ux-css')) return;
    const s = document.createElement('style'); s.id = 'conversa-ux-css'; s.textContent = CSS; document.head.append(s);
  }

  // ------------------------------------------------------------ ícones
  function trocar(alvo, nome) {
    if (!alvo || !IC()) return;
    const velho = alvo.querySelector(':scope > svg');
    const novo = IC().el(nome);
    if (velho) { for (const a of ['id', 'hidden']) if (velho.hasAttribute(a)) novo.setAttribute(a, velho.getAttribute(a)); velho.replaceWith(novo); }
    else alvo.prepend(novo);
  }
  function icones() {
    trocar($('topo-agendar'), 'agendar');
    trocar($('topo-ligar'), 'ligar');
    trocar($('voltar'), 'voltar');
    trocar($('mais'), 'mais');
    trocar($('figurinha'), 'respostas');
    trocar($('camera'), 'camera');
    trocar($('grav-cancelar'), 'lixeira');
    trocar($('grav-enviar'), 'enviar');
    // microfone e enviar: dois svgs no mesmo botão (o app troca pelo atributo hidden)
    const enviar = $('enviar');
    if (enviar && IC()) {
      const mic = $('ic-mic'), env = $('ic-enviar');
      if (mic) { const n = IC().el('mic'); n.id = 'ic-mic'; if (mic.hasAttribute('hidden')) n.setAttribute('hidden', ''); mic.replaceWith(n); }
      if (env) { const n = IC().el('enviar'); n.id = 'ic-enviar'; if (env.hasAttribute('hidden')) n.setAttribute('hidden', ''); env.replaceWith(n); }
    }
    const menu = { 'm-documento': 'documento', 'm-fotos': 'foto', 'm-respostas': 'respostas' };
    for (const [id, nome] of Object.entries(menu)) { const i = $(id)?.querySelector('i'); if (i) i.innerHTML = IC().svg(nome); }
  }

  // ------------------------------------------------------------ chip de quem atende
  const iniciais = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  function miniPessoa(classe, id, nome) {
    const s = document.createElement('span'); s.className = classe; s.textContent = iniciais(nome);
    const url = window.SintoniaFotos?.url?.(id);
    if (url) { const img = document.createElement('img'); img.alt = ''; img.src = url; img.addEventListener('error', () => img.remove()); s.append(img); }
    return s;
  }
  function chip(c) {
    const b = $('modo'); if (!b || !c) return;
    b.querySelector('.cux-quem')?.remove();
    const pessoa = c.modo !== 'ia' && c.responsavelId;
    const sem = c.modo !== 'ia' && !c.responsavelId && c.id && c.modo;
    b.classList.toggle('cux-com-quem', Boolean(pessoa || sem));
    if (pessoa) b.querySelector('#modo-txt')?.before(miniPessoa('cux-quem', c.responsavelId, c.responsavelNome));
    else if (sem) { const s = document.createElement('span'); s.className = 'cux-quem cux-ninguem'; s.innerHTML = IC()?.svg('pessoa') || ''; b.querySelector('#modo-txt')?.before(s); }
    b.title = pessoa ? `Responsável pela conversa: ${c.responsavelNome || 'outra pessoa'}. Toque para mudar.` : sem ? 'Ninguém é responsável por esta conversa ainda. Toque para assumir ou passar.' : 'Quem atende e ajuda da IA';
  }

  // ------------------------------------------------------------ ficha
  function cartao(classe, icone, titulo, ...filhos) {
    const s = document.createElement('section'); s.className = 'cux-cartao ' + classe;
    const cab = document.createElement('div'); cab.className = 'cux-cab';
    const i = document.createElement('i'); i.innerHTML = IC().svg(icone);
    const h = document.createElement('h3'); h.textContent = titulo;
    cab.append(i, h); s.append(cab, ...filhos.filter(Boolean));
    return s;
  }
  function botaoAcao(id, icone, rotulo, onclick) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cux-acao'; b.id = id;
    b.innerHTML = IC().svg(icone); const s = document.createElement('span'); s.textContent = rotulo; b.append(s);
    b.addEventListener('click', onclick); return b;
  }
  let fichaPronta = false;
  function montarFicha() {
    const f = $('ficha'); if (!f || fichaPronta || !IC()) return;
    fichaPronta = true;
    f.classList.add('cux-ficha');
    const perfil = f.querySelector('.bloco.perfil');
    const av = $('f-avatar'), nome = $('f-nome'), tel = $('f-tel'), chegou = $('f-chegou');

    // topo
    const copiar = document.createElement('button'); copiar.type = 'button'; copiar.title = 'Copiar número'; copiar.setAttribute('aria-label', 'Copiar número'); copiar.innerHTML = IC().svg('copiar');
    copiar.addEventListener('click', () => $('f-copiar')?.click());
    const linhaTel = document.createElement('div'); linhaTel.className = 'cux-tel'; linhaTel.append(tel, copiar);
    const chips = document.createElement('div'); chips.className = 'cux-chips'; chips.id = 'cux-chips';
    const heroi = document.createElement('section'); heroi.className = 'cux-cartao cux-heroi';
    heroi.append(av, nome, linhaTel, chips, chegou);
    perfil.after(heroi);
    perfil.hidden = true; perfil.style.display = 'none';
    // o app troca o #f-avatar com replaceWith: continua dentro do topo novo

    // ações rápidas
    const fav = $('f-favorito');
    const acoes = document.createElement('div'); acoes.className = 'cux-acoes';
    const ligar = botaoAcao('cux-ligar', 'ligar', 'Ligar', () => $('f-ligar')?.click());
    const agendar = botaoAcao('cux-agendar', 'agendar', 'Agendar', () => $('topo-agendar')?.click());
    const etapa = botaoAcao('cux-etapa', 'etapa', 'Etapa', () => $('f-crm')?.click());
    const radar = botaoAcao('cux-radar', 'radar', 'Radar', () => $('topo-radar')?.click());
    const favorito = botaoAcao('cux-fav', 'estrela', 'Favorito', () => fav?.click());
    if (!fav) favorito.hidden = true;
    acoes.append(ligar, agendar, etapa, radar, favorito);
    heroi.after(acoes);
    // o favorito do app (aria-pressed + texto) vira o estado do botão novo
    if (fav) new MutationObserver(() => { favorito.setAttribute('aria-pressed', fav.getAttribute('aria-pressed') || 'false'); favorito.querySelector('span').textContent = fav.getAttribute('aria-pressed') === 'true' ? 'Favorita' : 'Favorito'; })
      .observe(fav, { attributes: true, subtree: true, childList: true, characterData: true });

    // tags e etapa
    const etapaLinha = document.createElement('div'); etapaLinha.className = 'cux-etapa-linha'; etapaLinha.id = 'cux-etapa-linha';
    const tags = document.createElement('div'); tags.className = 'cux-tags'; tags.id = 'cux-tags';
    const cTags = cartao('cux-c-tags', 'tag', 'Etapa e tags', etapaLinha, tags);
    const editarTags = document.createElement('button'); editarTags.type = 'button'; editarTags.className = 'cux-link'; editarTags.textContent = 'Editar tags';
    editarTags.addEventListener('click', editarAsTags);
    cTags.querySelector('.cux-cab').append(editarTags);
    acoes.after(cTags);

    // valores e agendamentos (relatório), histórico e origem
    const rel = $('f-relatorio');
    const cValores = cartao('cux-c-valores', 'dinheiro', 'Valor e agendamentos', rel);
    cTags.after(cValores);
    const tempo = document.createElement('ol'); tempo.className = 'cux-tempo'; tempo.id = 'cux-tempo';
    const cHist = cartao('cux-c-hist', 'historico', 'Histórico', tempo);
    cValores.after(cHist);
    const origem = $('f-origem');
    const cOrigem = cartao('cux-c-origem', 'origem', 'Origem', origem);
    cHist.after(cOrigem);
    const vigiaOrigem = () => { cOrigem.hidden = !origem.childNodes.length; };
    new MutationObserver(vigiaOrigem).observe(origem, { childList: true }); vigiaOrigem();
    if (rel) new MutationObserver(() => historico()).observe(rel, { childList: true });

    // dados (formulário) e observações (o campo continua no mesmo formulário pelo atributo form)
    const form = $('f-contato');
    const cDados = cartao('cux-c-dados', 'pessoa', 'Dados', form);
    cOrigem.after(cDados);
    const obs = form.querySelector('textarea[name="observacoes"]');
    if (obs) {
      const lab = obs.closest('label');
      obs.setAttribute('form', 'f-contato');
      const salvar = document.createElement('button'); salvar.type = 'submit'; salvar.className = 'botao ds-primario cux-salvar'; salvar.setAttribute('form', 'f-contato'); salvar.textContent = 'Salvar observações';
      const cObs = cartao('cux-obs', 'notas', 'Observações', lab, salvar);
      cDados.after(cObs);
    }

    // atendimento (unidade, quem responde, responsável, última mensagem) e resumo da IA
    const atend = $('f-etapa')?.closest('.bloco');
    if (atend) { atend.classList.add('cux-atend'); const c = cartao('cux-c-atend', 'relogio', 'Atendimento', atend); (f.querySelector('.cux-obs') || cDados).after(c); }
    const resumo = $('f-resumo-bloco');
    if (resumo) { const wrap = cartao('cux-c-resumo', 'ia', 'Resumo da IA', resumo); wrap.hidden = resumo.hidden; new MutationObserver(() => { wrap.hidden = resumo.hidden; }).observe(resumo, { attributes: true, attributeFilter: ['hidden'] }); cTags.after(wrap); }

    // seções de abrir/fechar do responsivo.js que agora já têm o título no cartão: ficam sempre abertas, sem o título repetido
    f.querySelectorAll('.rs-dados, .cux-atend .rs-secao, #f-resumo-bloco .rs-secao').forEach((d) => { d.open = true; d.classList.add('cux-sem-titulo'); });

    // o app atualiza estes campos a cada desenho da ficha: refaz chips, tags e histórico
    for (const id of ['f-crm-resumo', 'f-dono', 'f-unidade', 'f-nome']) { const e = $(id); if (e) new MutationObserver(pintar).observe(e, { childList: true, characterData: true, subtree: true }); }
    pintar();
  }

  function conversaAtual() { return ui()?.estado?.detalhe?.conversa; }
  function chipEl(classe, icone, texto, antes) {
    const s = document.createElement('span'); s.className = 'cux-chip ' + classe;
    if (antes) s.append(antes); else if (icone) s.insertAdjacentHTML('afterbegin', IC().svg(icone));
    const t = document.createElement('span'); t.textContent = texto; s.append(t); return s;
  }
  function pintar() {
    const c = conversaAtual(); const u = ui(); if (!c || !u) return;
    const chips = $('cux-chips');
    if (chips) {
      const lista = [];
      const unidade = u.UNIDADE?.[c.unidade] || c.unidade;
      if (unidade) lista.push(chipEl('', 'unidade', unidade));
      const etapa = u.NOME_ETAPA?.[c.etapa];
      if (etapa) lista.push(chipEl('etapa', 'etapa', etapa));
      if (c.modo === 'ia') lista.push(chipEl('', 'ia', 'IA atendendo'));
      else if (c.responsavelId) lista.push(chipEl('', null, c.responsavelId === u.estado?.eu?.id ? 'Você' : (c.responsavelNome || 'Equipe'), miniPessoa('mini', c.responsavelId, c.responsavelNome)));
      else lista.push(chipEl('', 'sem_pessoa', 'Sem responsável'));
      chips.replaceChildren(...lista);
    }
    const etapaLinha = $('cux-etapa-linha');
    if (etapaLinha) {
      const b = document.createElement('b'); b.textContent = u.NOME_ETAPA?.[c.etapa] || 'Sem etapa';
      const sm = document.createElement('small'); sm.textContent = 'Etapa no funil'; b.prepend(sm);
      const mover = document.createElement('button'); mover.type = 'button'; mover.className = 'cux-link'; mover.style.cssText = 'all:unset;cursor:pointer;font-size:13px;font-weight:700;color:var(--marca-azul,#106ebe);padding:6px 8px;border-radius:8px';
      mover.textContent = 'Mover'; mover.addEventListener('click', () => $('f-crm')?.click());
      etapaLinha.replaceChildren(b, mover);
    }
    const tags = $('cux-tags');
    if (tags) {
      const lista = (c.tags || []).map((t) => { const s = document.createElement('span'); s.className = 'cux-tag'; s.style.setProperty('--cor', t.cor || ''); s.append(document.createElement('i'), document.createTextNode(t.nome)); return s; });
      if (!lista.length) { const v = document.createElement('span'); v.className = 'cux-vazio'; v.textContent = 'Nenhuma tag ainda.'; lista.push(v); }
      tags.replaceChildren(...lista);
    }
    const radar = $('cux-radar'); if (radar) radar.hidden = !$('topo-radar');
    const agendar = $('cux-agendar'); if (agendar) agendar.hidden = Boolean($('topo-agendar')?.hidden);
    historico();
    window.SintoniaProdutosLead?.ficha?.(c); /* produtos-lead: cartão "Produtos e serviços" */
  }
  function historico() {
    const lista = $('cux-tempo'); if (!lista) return;
    const c = conversaAtual(); const itens = [];
    const add = (titulo, quando) => { const li = document.createElement('li'); const b = document.createElement('b'); b.textContent = titulo; const s = document.createElement('span'); s.textContent = quando; li.append(b, s); itens.push(li); };
    // etapas do relatório (mais nova primeiro)
    document.querySelectorAll('#f-relatorio .rl-etapas li').forEach((li) => add('Etapa: ' + (li.querySelector('b')?.textContent || ''), li.querySelector('span')?.textContent || ''));
    const ultima = $('f-ultima')?.textContent; if (c && ultima) itens.unshift((() => { const li = document.createElement('li'); const b = document.createElement('b'); b.textContent = 'Última mensagem da cliente'; const s = document.createElement('span'); s.textContent = ultima; li.append(b, s); return li; })());
    const chegou = $('f-chegou')?.textContent; if (chegou) add('Primeiro contato', chegou.replace(/^Chegou em\s*/i, ''));
    lista.replaceChildren(...itens);
    lista.closest('.cux-cartao').hidden = !itens.length;
    // a lista antiga (dentro do relatório) fica só aqui
    const det = document.querySelector('#f-relatorio .rl-etapas'); if (det) det.hidden = true;
  }
  async function editarAsTags() {
    const c = conversaAtual(); const u = ui(); if (!c || !u) return;
    if (!window.SintoniaTags?.daConversa) { $('f-crm')?.click(); return; }
    await window.SintoniaTags.daConversa(c.id, { titulo: 'Tags da cliente', aoMudar: (tags) => { c.tags = tags; pintar(); } });
    u.estado.assinatura = ''; await u.atualizar?.();
  }

  // ------------------------------------------------------------ início
  function iniciar() {
    estilo();
    icones();
    montarFicha();
    const c = conversaAtual(); if (c) chip(c);
    // fotos da equipe chegam depois: refaz o chip
    addEventListener('sintonia:fotos', () => { const x = conversaAtual(); if (x) chip(x); pintar(); });
  }
  window.SintoniaConversaUx = { chip, pintar };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
