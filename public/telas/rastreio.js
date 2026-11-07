/* Rastreamento de leads na tela: selo de origem (lista de Conversas e cartão do CRM), seção "Origem" na ficha,
 * filtro por origem/campanha e a tela de links rastreados (window.SintoniaTelas.links).
 * Registra window.SintoniaRastreio. Estilos em <style id="estilo-rastreio">, prefixo .ra-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ra-selo { display: inline-flex; align-items: center; gap: 4px; max-width: 190px; font-size: 11.5px; font-weight: 700; line-height: 1.2; padding: 2px 8px 2px 6px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    background: color-mix(in srgb, var(--ra-cor) 16%, transparent); color: var(--ra-txt, var(--texto)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ra-cor) 40%, transparent); }
  .ra-selo i { font-style: normal; font-size: 11px; }
  .ra-ic { display: inline-grid; place-items: center; width: 16px; height: 16px; flex: none; vertical-align: -3px; color: var(--sub, #6b7280); }
  .ra-ic svg { width: 16px; height: 16px; display: block; }
  .item .l1 .ra-ic { margin: 0 2px 0 4px; }
  #c-nome .ra-ic { display: inline-grid; margin-left: 6px; vertical-align: -2px; }
  @media (max-width: 760px) { .item .l2 .ra-selo { display: none; } }
  .fn-nome .ra-ic { margin-right: 5px; vertical-align: -2px; }
  .ra-ficha h3 .ra-ic { width: 18px; height: 18px; } .ra-ficha h3 .ra-ic svg { width: 18px; height: 18px; }
  .ra-selo span { overflow: hidden; text-overflow: ellipsis; }
  .ra-anuncio { --ra-cor: #106ebe; } .ra-link { --ra-cor: #19c3a6; } .ra-organico { --ra-cor: #9db8ff; } .ra-indicacao { --ra-cor: #f5b800; } .ra-outro { --ra-cor: #8b8d98; }
  .fn-cartao .ra-selo { background: rgba(255,255,255,.55); color: var(--tx); box-shadow: inset 0 0 0 1px var(--vd-b); }
  html[data-tema="escuro"] .fn-cartao .ra-selo { background: rgba(255,255,255,.14); }
  .ra-ficha { display: grid; gap: 10px; }
  .ra-ficha h3 { display: flex; align-items: center; gap: 8px; }
  .ra-criativo { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 10px; align-items: center; padding: 10px; border-radius: 14px; background: var(--vidro-item, rgba(127,127,127,.08)); box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(127,127,127,.2)); text-decoration: none; color: inherit; }
  .ra-criativo img, .ra-criativo .ra-sem { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; background: color-mix(in srgb, #106ebe 18%, transparent); display: grid; place-items: center; font-size: 26px; }
  .ra-criativo b { display: block; font-size: 14px; line-height: 1.3; }
  .ra-criativo small { display: block; font-size: 12.5px; color: var(--sub); line-height: 1.35; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .ra-dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 13.5px; }
  .ra-dl dt { color: var(--sub); }
  .ra-dl dd { margin: 0; text-align: right; overflow-wrap: anywhere; font-weight: 600; }
  .ra-vazio { font-size: 13.5px; color: var(--sub); line-height: 1.45; }
  .ra-filtro { display: inline-flex; }

  /* tela de links */
  .ra-tela { display: grid; gap: 16px; max-width: 1100px; margin: 0 auto; width: 100%; padding-bottom: 110px; min-width: 0; }
  .ra-painel { border-radius: 24px; padding: 18px; display: grid; gap: 14px; min-width: 0; background: var(--vidro-fundo); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  .ra-painel h2 { margin: 0; font-size: 16px; font-weight: 800; }
  .ra-painel h2 small { display: block; font-size: 12.5px; font-weight: 500; color: var(--sub); margin-top: 3px; line-height: 1.4; }
  .ra-form { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
  .ra-form label { display: grid; gap: 5px; font-size: 12.5px; font-weight: 700; color: var(--sub); min-width: 0; }
  .ra-form input, .ra-form select { font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 10px 12px; min-width: 0; width: 100%; box-sizing: border-box; }
  .ra-form .ra-largo { grid-column: 1 / -1; }
  .ra-botao { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 18px; border-radius: 999px; background: var(--marca-menta, #0ffcbe); color: #071d33; font-weight: 800; font-size: 14.5px; }
  .ra-botao.leve { background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-weight: 700; }
  .ra-botao:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 2px; }
  .ra-erro { color: #c43a3a; font-size: 13.5px; font-weight: 600; }
  .ra-links { display: grid; gap: 10px; }
  .ra-item { display: grid; gap: 8px; padding: 14px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-width: 0; }
  .ra-item .ra-l1 { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
  .ra-item .ra-l1 b { font-size: 15px; }
  .ra-item .ra-l1 span { font-size: 12.5px; color: var(--sub); }
  .ra-copia { display: flex; gap: 6px; min-width: 0; }
  .ra-copia input { flex: 1; min-width: 0; font-family: ui-monospace, Menlo, monospace; font-size: 13px; background: var(--vidro-ativo); border: 1px solid var(--vidro-borda); border-radius: 10px; padding: 9px 10px; color: var(--texto); }
  .ra-numeros { display: flex; gap: 16px; font-size: 13px; color: var(--sub); flex-wrap: wrap; }
  .ra-numeros b { color: var(--texto); font-size: 16px; font-variant-numeric: tabular-nums; margin-right: 4px; }
  .ra-dica { font-size: 13px; color: var(--sub); line-height: 1.5; }
  .ra-dica code { font-size: 12px; background: var(--vidro-ativo); padding: 1px 5px; border-radius: 6px; overflow-wrap: anywhere; }
  `;
  /** Ícones próprios (16px), legíveis no claro e no escuro. */
  const SVG_ICONE = {
    instagram: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="4.2" fill="#E1306C"/><path d="M1 10.5V11a4 4 0 0 0 4 4h6a4 4 0 0 0 3.9-3.2Z" fill="#F77737" opacity=".7"/><rect x="3.6" y="3.6" width="8.8" height="8.8" rx="2.8" fill="none" stroke="#fff" stroke-width="1.4"/><circle cx="8" cy="8" r="2.1" fill="none" stroke="#fff" stroke-width="1.4"/><circle cx="11" cy="5" r=".8" fill="#fff"/></svg>',
    facebook: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="#1877F2"/><path d="M8.9 15.2V9.6h1.8l.3-2.1H8.9V6.2c0-.6.2-1 1-1h1.1V3.3c-.2 0-.8-.1-1.6-.1-1.6 0-2.7 1-2.7 2.8v1.5H5v2.1h1.7v5.6Z" fill="#fff"/></svg>',
    whatsapp: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="#25D366"/><path d="M4.1 12.1l.6-2.1a3.9 3.9 0 1 1 1.5 1.5Z" fill="none" stroke="#fff" stroke-width="1.1" stroke-linejoin="round"/><path d="M6.6 6.1c.1-.3.3-.3.5-.3l.3.6c0 .1 0 .2-.1.3l-.2.2c.2.5.6.9 1.1 1.1l.2-.2c.1-.1.2-.1.3-.1l.6.3c0 .2 0 .4-.3.5-.4.2-.9.1-1.5-.3a3 3 0 0 1-1-1.1c-.2-.4-.1-.8.1-1Z" fill="#fff"/></svg>',
    google_ads: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="4" fill="#fff" stroke="#DADCE0"/><path d="M6.6 3.6 3.4 9.2" stroke="#FBBC04" stroke-width="2.6" stroke-linecap="round"/><path d="M6.6 3.6l3.6 6.2" stroke="#4285F4" stroke-width="2.6" stroke-linecap="round"/><circle cx="4" cy="11.4" r="1.6" fill="#34A853"/><circle cx="11.5" cy="11.6" r="0" fill="none"/></svg>',
    indicacao: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="#F5B800"/><circle cx="6" cy="6.3" r="1.6" fill="#3a2a00"/><circle cx="10.3" cy="6.8" r="1.3" fill="#3a2a00"/><path d="M3.3 11.6c.3-1.6 1.4-2.5 2.7-2.5s2.4.9 2.7 2.5ZM8.9 11.6c.2-1.2 1-1.9 1.9-1.9s1.6.7 1.8 1.9Z" fill="#3a2a00"/></svg>',
    estabelecimento: '<svg viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="4" fill="#19C3A6"/><path d="M3.6 6.6 4.5 4h7l.9 2.6c0 .8-.6 1.3-1.3 1.3s-1.3-.5-1.3-1.3c0 .8-.6 1.3-1.3 1.3s-1.3-.5-1.3-1.3c0 .8-.6 1.3-1.3 1.3s-1.3-.5-1.3-1.3Z" fill="#fff"/><path d="M4.5 8.6V12h7V8.6M7 12V9.8h2V12" fill="none" stroke="#fff" stroke-width="1.1"/></svg>',
    desconhecido: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.3" fill="#8B8D98" fill-opacity=".28" stroke="#8B8D98" stroke-opacity=".7"/><path d="M6.3 6.3a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.6-.9 1.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11.3" r=".85" fill="currentColor"/></svg>',
  };
  const NOME_ICONE = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp (direto)', google_ads: 'Google Ads', indicacao: 'Indicação', estabelecimento: 'Passou na loja', desconhecido: 'Origem desconhecida' };
  const ICONE = { anuncio_meta: '📣', link: '🔗', organico: '🌱', indicacao: '🤝', outro: '•' };
  const CLASSE = { anuncio_meta: 'ra-anuncio', link: 'ra-link', organico: 'ra-organico', indicacao: 'ra-indicacao', outro: 'ra-outro' };
  const NOME_CANAL = { anuncio_meta: 'Anúncio (Meta)', link: 'Link rastreado', organico: 'Orgânico', indicacao: 'Indicação', outro: 'Outro' };
  const s = { selos: {}, em: 0, buscando: null, filtro: '' };

  function estilo() {
    if (document.getElementById('estilo-rastreio')) return;
    const st = document.createElement('style');
    st.id = 'estilo-rastreio';
    st.textContent = CSS;
    document.head.append(st);
  }
  const ui = () => window.Sintonia && window.Sintonia.ui;

  async function carregarSelos(forcar) {
    if (!ui()) return;
    if (!forcar && Date.now() - s.em < 20000) return;
    if (s.buscando) return s.buscando;
    s.buscando = ui().api('/api/rastreio/selos').then((r) => {
      const antes = JSON.stringify(s.selos);
      s.selos = r || {}; s.em = Date.now();
      if (antes !== JSON.stringify(s.selos)) { ui().desenharLista?.(); window.SintoniaTelas.funil?.redesenhar?.(); }
    }).catch(() => {}).finally(() => { s.buscando = null; });
    return s.buscando;
  }

  /** Ícone da origem: aceita a origem que veio da API ({ icone }) ou o id da conversa (cache dos selos). */
  function iconeEl(x) {
    const ic = (x && typeof x === 'object' ? x.icone : s.selos[x]?.icone) || 'desconhecido';
    const rot = (x && typeof x === 'object' && x.rotulo) || (typeof x === 'string' && s.selos[x]?.rotulo) || '';
    const nome = NOME_ICONE[ic] || NOME_ICONE.desconhecido;
    const e = document.createElement('span');
    e.className = `ra-ic ra-ic-${ic}`;
    e.setAttribute('role', 'img');
    e.setAttribute('aria-label', `Origem: ${nome}`);
    e.title = rot && rot !== nome ? `Origem: ${nome} · ${rot}` : `Origem: ${nome}`;
    e.innerHTML = SVG_ICONE[ic] || SVG_ICONE.desconhecido;
    return e;
  }

  function seloEl(id) {
    const x = s.selos[id];
    if (!x || !ui()) return null;
    const e = ui().el('span', { class: `ra-selo ${CLASSE[x.canal] || 'ra-outro'}`, title: `Origem: ${x.rotulo}` }, ui().el('i', { text: ICONE[x.canal] || '•', 'aria-hidden': 'true' }), ui().el('span', { text: x.rotulo }));
    return e;
  }

  /** Filtro: '' (todas), 'canal:anuncio_meta', 'campanha:<nome>', 'sem'. */
  function passa(id) {
    if (!s.filtro) return true;
    const x = s.selos[id];
    if (s.filtro === 'sem') return !x;
    const [tipo, ...resto] = s.filtro.split(':');
    const v = resto.join(':');
    if (tipo === 'icone') return (x?.icone || 'desconhecido') === v;
    if (!x) return false;
    return tipo === 'canal' ? x.canal === v : x.campanha === v;
  }
  function opcoesFiltro() {
    const canais = new Set(); const campanhas = new Set();
    for (const x of Object.values(s.selos)) { canais.add(x.canal); if (x.campanha) campanhas.add(x.campanha); }
    return [
      { nome: 'Todas as origens', valor: '' },
      ...Object.keys(NOME_ICONE).map((ic) => ({ nome: NOME_ICONE[ic], valor: `icone:${ic}`, icone: ic })),
      ...[...canais].map((c) => ({ nome: `${ICONE[c] || ''} ${NOME_CANAL[c] || c}`, valor: `canal:${c}` })),
      ...[...campanhas].sort().map((c) => ({ nome: `📣 Campanha: ${c}`, valor: `campanha:${c}` })),
      { nome: 'Sem origem identificada', valor: 'sem' },
    ];
  }
  /** Botão de filtro (lista de Conversas e CRM). */
  function botaoFiltro(aoMudar) {
    const u = ui();
    const b = u.el('button', { class: 'chip ra-filtro', type: 'button', 'aria-pressed': String(!!s.filtro), title: 'Filtrar por origem ou campanha' });
    const rotulo = () => {
      const o = opcoesFiltro().find((x) => x.valor === s.filtro);
      b.replaceChildren();
      if (o?.icone) b.append(iconeEl({ icone: o.icone }), document.createTextNode(' '));
      b.append(document.createTextNode(s.filtro && o ? o.nome.trim() : '📣 Origem'));
      b.setAttribute('aria-pressed', String(!!s.filtro));
    };
    rotulo();
    b.addEventListener('click', async () => {
      await carregarSelos(true);
      const sel = u.el('select', { 'aria-label': 'Origem', style: 'position:fixed;opacity:0;pointer-events:none' }, ...opcoesFiltro().map((o) => u.el('option', { value: o.valor, text: o.nome })));
      // Escolha simples e nativa (no celular abre a lista do sistema).
      sel.value = s.filtro;
      document.body.append(sel);
      sel.addEventListener('change', () => { s.filtro = sel.value; rotulo(); aoMudar(); sel.remove(); });
      sel.addEventListener('blur', () => setTimeout(() => sel.remove(), 300));
      if (sel.showPicker) { try { sel.showPicker(); return; } catch {} }
      sel.focus(); sel.click();
    });
    return b;
  }

  // ---------- ficha ----------
  const quando = (d) => (d ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).format(new Date(d)) : '—');
  async function ficha(conversa, caixa) {
    const u = ui(); if (!u || !caixa) return;
    estilo();
    let r;
    try { r = await u.api(`/api/conversas/${conversa.id}/origem`); } catch (x) { caixa.replaceChildren(u.el('h3', { text: 'Origem' }), u.el('div', { class: 'ra-vazio', text: x.message })); return; }
    const el = u.el;
    const o = r.primeiro;
    const cab = el('h3', {}, iconeEl(r.selo || { icone: 'desconhecido' }), 'Origem', o ? seloLivre(r.selo) : null);
    if (!o) {
      caixa.replaceChildren(cab, el('div', { class: 'ra-vazio', text: 'Ainda sem origem identificada. Quando a cliente vem de um anúncio de clique para WhatsApp ou de um link rastreado, a origem aparece aqui sozinha.' }));
      return;
    }
    const linha = (rot, v) => (v ? [el('dt', { text: rot }), el('dd', { text: v })] : []);
    const filhos = [cab];
    if (o.canal === 'anuncio_meta') {
      const img = o.anuncioMiniatura || o.anuncioMidiaUrl;
      const criativo = el(o.anuncioUrl ? 'a' : 'div', { class: 'ra-criativo', ...(o.anuncioUrl ? { href: o.anuncioUrl, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir o anúncio' } : {}) },
        img ? el('img', { src: img, alt: 'Criativo do anúncio', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(el('span', { class: 'ra-sem', text: '📣' })) }) : el('span', { class: 'ra-sem', text: '📣' }),
        el('div', {}, el('b', { text: o.anuncioTitulo || o.adNome || 'Anúncio' }), o.anuncioTexto ? el('small', { text: o.anuncioTexto }) : null));
      filhos.push(criativo);
    }
    const dl = el('dl', { class: 'ra-dl' },
      ...linha('Canal', NOME_CANAL[o.canal] || o.canal),
      ...linha('Rede', o.fonte ? o.fonte.charAt(0).toUpperCase() + o.fonte.slice(1) : ''),
      ...linha('Campanha', o.campaignNome || o.campaignId),
      ...linha('Conjunto', o.adsetNome || o.adsetId),
      ...linha('Anúncio', o.adNome || o.adId),
      ...linha('Link', r.link ? `${r.link.nome} (/l/${r.link.codigo})` : ''),
      ...linha('Código', o.codigo),
      ...linha('utm_source', o.utmSource), ...linha('utm_medium', o.utmMedium), ...linha('utm_campaign', o.utmCampaign), ...linha('utm_content', o.utmContent), ...linha('utm_term', o.utmTerm),
      ...linha('Indicada por', o.indicadoPor),
      ...linha('Detalhe', o.canal !== 'link' ? o.detalhe : ''),
      ...linha('Clique do anúncio', o.ctwaClid ? 'registrado ✓ (vai para a API de Conversões)' : ''),
      ...linha('fbclid / gclid', o.fbclid || o.gclid ? 'registrado ✓' : ''),
      ...linha('Chegou em', quando(o.em)),
      ...linha('Quem identificou', o.origemPor === 'automatico' ? 'Automático' : o.origemPor === 'ia' ? 'IA (pela conversa)' : 'Equipe'),
      ...linha('Primeira mensagem', o.primeiraMensagem ? `“${o.primeiraMensagem.slice(0, 140)}”` : ''));
    filhos.push(dl);
    const ul = r.ultimo;
    if (ul && (ul.adId !== o.adId || ul.codigo !== o.codigo || ul.canal !== o.canal)) {
      filhos.push(el('div', { class: 'ra-vazio' }, 'Último toque: ', seloLivre({ canal: ul.canal, rotulo: ul.campaignNome || ul.utmCampaign || ul.anuncioTitulo || ul.detalhe || NOME_CANAL[ul.canal] }), ` em ${quando(ul.em)}`));
    }
    caixa.replaceChildren(...filhos);
  }
  function seloLivre(x) {
    const el = ui().el;
    return el('span', { class: `ra-selo ${CLASSE[x.canal] || 'ra-outro'}` }, el('i', { text: ICONE[x.canal] || '•', 'aria-hidden': 'true' }), el('span', { text: x.rotulo }));
  }

  // ---------- tela de links rastreados ----------
  const t = { caixa: null, dados: null, erro: '' };
  const NUMERO_CHAVE = 'sintonia.links.numero.';
  const lembrar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const lembrado = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  async function carregarLinks() {
    try { t.dados = await ui().api('/api/rastreio/links'); t.erro = ''; } catch (x) { t.erro = x.message; }
    desenharLinks();
  }
  function desenharLinks() {
    const u = ui(); const el = u.el; if (!t.caixa) return;
    const base = location.origin;
    const form = el('form', { class: 'ra-form', autocomplete: 'off' });
    const campo = (rot, nome, extra = {}) => el('label', { class: extra.largo ? 'ra-largo' : '' }, rot, el(extra.tag || 'input', { name: nome, ...extra.at }, ...(extra.opcoes || [])));
    form.append(
      campo('Nome do link', 'nome', { at: { required: '', maxlength: '60', placeholder: 'Ex.: Link Bio Instagram' } }),
      campo('Unidade', 'unidade', { tag: 'select', opcoes: [el('option', { value: 'norte', text: 'Salvador Norte' }), el('option', { value: 'sumare', text: 'Sumaré' })] }),
      campo('WhatsApp da unidade (com DDD)', 'numero', { at: { required: '', inputmode: 'tel', placeholder: '55 71 99999-9999' } }),
      campo('Código no endereço (opcional)', 'codigo', { at: { maxlength: '40', placeholder: 'bio-insta', pattern: '[a-z0-9][a-z0-9-]{1,39}' } }),
      campo('Mensagem que a cliente envia', 'mensagem', { largo: true, at: { maxlength: '300', value: 'Olá! Quero saber mais sobre a progressiva.' } }),
      campo('utm_source', 'utmSource', { at: { placeholder: 'instagram' } }),
      campo('utm_medium', 'utmMedium', { at: { placeholder: 'bio' } }),
      campo('utm_campaign', 'utmCampaign', { at: { placeholder: 'progressiva-nov' } }),
      campo('utm_content', 'utmContent', { at: { placeholder: 'video-antes-depois' } }),
      el('div', { class: 'ra-largo', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, el('button', { class: 'ra-botao', type: 'submit', text: 'Criar link' }), el('span', { class: 'ra-erro', id: 'ra-erro' })));
    const unid = form.elements.unidade; const num = form.elements.numero;
    const preencherNumero = () => { num.value = lembrado(NUMERO_CHAVE + unid.value); };
    unid.addEventListener('change', preencherNumero); preencherNumero();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form); const corpo = {};
      for (const [k, v] of f.entries()) if (String(v).trim()) corpo[k] = String(v).trim();
      try {
        await u.post('/api/rastreio/links', corpo);
        lembrar(NUMERO_CHAVE + corpo.unidade, corpo.numero);
        u.toast('Link criado ✓'); await carregarLinks();
      } catch (x) { form.querySelector('#ra-erro').textContent = x.message; }
    });
    const links = t.dados?.links || [];
    const lista = el('div', { class: 'ra-links' }, ...(links.length ? links.map((l) => {
      const url = `${base}/l/${l.codigo}`;
      const inp = el('input', { readonly: '', value: url, 'aria-label': `Endereço do link ${l.nome}` });
      return el('div', { class: 'ra-item' },
        el('div', { class: 'ra-l1' }, el('b', { text: l.nome }), el('span', { text: [l.unidade === 'norte' ? 'Salvador Norte' : 'Sumaré', l.utmSource && `utm_source=${l.utmSource}`, l.utmCampaign && `utm_campaign=${l.utmCampaign}`, l.ativo ? '' : 'desligado'].filter(Boolean).join(' · ') })),
        el('div', { class: 'ra-copia' }, inp, el('button', { class: 'ra-botao leve', type: 'button', text: 'Copiar', onclick: async () => { try { await navigator.clipboard.writeText(url); u.toast('Link copiado'); } catch { inp.select(); } } })),
        el('div', { class: 'ra-numeros' }, el('span', {}, el('b', { text: String(l.cliques) }), 'cliques'), el('span', {}, el('b', { text: String(l.leads) }), 'conversas'), el('span', {}, el('b', { text: l.cliques ? `${Math.round((l.leads / l.cliques) * 100)}%` : '—' }), 'viraram conversa'),
          el('button', { class: 'ra-botao leve', type: 'button', style: 'min-height:36px;padding:0 14px;margin-left:auto', text: l.ativo ? 'Desligar' : 'Ligar', onclick: async () => { try { await u.api(`/api/rastreio/links/${l.id}`, { method: 'PATCH', body: JSON.stringify({ ativo: !l.ativo }) }); carregarLinks(); } catch (x) { u.toast(x.message); } } })));
    }) : [el('div', { class: 'ra-vazio', text: t.erro || 'Nenhum link ainda. Crie o primeiro acima (ex.: o link da bio do Instagram).' })]));
    t.caixa.replaceChildren(el('div', { class: 'ra-tela' },
      el('section', { class: 'ra-painel', 'aria-label': 'Criar link rastreado' },
        el('h2', {}, 'Links rastreados', el('small', { text: 'Cada clique ganha um código curto que vai na mensagem do WhatsApp. Quando a cliente envia, a conversa fica ligada ao clique (com as UTMs, fbclid e gclid).' })),
        form,
        el('p', { class: 'ra-dica', html: 'Dica: dá para acrescentar UTMs no próprio endereço, e elas valem por cima das do link: <code>/l/bio?utm_campaign=black-friday</code>. Nos anúncios da Meta, use <code>utm_source=meta&amp;utm_campaign={{campaign.name}}&amp;utm_content={{ad.name}}</code>.' })),
      el('section', { class: 'ra-painel', 'aria-label': 'Links' }, el('h2', { text: 'Seus links' }), lista)));
  }

  window.SintoniaTelas.links = {
    async desenhar(caixa) { estilo(); t.caixa = caixa; desenharLinks(); await carregarLinks(); },
  };
  window.SintoniaRastreio = { iconeEl, seloEl, passa, botaoFiltro, ficha, carregarSelos, selo: (id) => s.selos[id] };
  estilo();
  const iniciar = () => {
    if (!ui()) return setTimeout(iniciar, 300);
    const filtros = document.getElementById('filtros');
    if (filtros && !filtros.querySelector('.ra-filtro')) filtros.append(botaoFiltro(() => ui().desenharLista?.()));
    carregarSelos(true);
    setInterval(() => carregarSelos(false), 20000);
  };
  iniciar();
})();
