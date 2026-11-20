/* marketing: Central de criativos (Marketing › Central de criativos). Quais anúncios trouxeram leads,
 * agendamentos e vendas. Vem das conversas (anúncio de clique para WhatsApp e links com utm_content);
 * com a conta de anúncios conectada (Conexões › Anúncios), soma gasto, cliques, CTR e custo.
 * Registra window.SintoniaTelas.criativos. Estilos em <style id="estilo-criativos">, prefixo .cr-.
 * Textos do servidor entram sempre por textContent; imagem só https, sem referrer.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .cr { --cr-cartao: #ffffff; --cr-borda: rgba(8, 36, 63, .07); --cr-sombra: 0 4px 16px rgba(8, 36, 63, .06); --cr-seg: #ffffff; --cr-seg-on: #08243f; --cr-seg-on-txt: #fff;
        --cr-mini: #eef3f8; --cr-bom: #0b7a5a; --cr-bom-fundo: #e3fbf3; --cr-aviso: #fff6db; --cr-aviso-txt: #5e4b00; --cr-ruim: #b42318; --cr-ruim-fundo: #fdecec; --cr-img: #e8eef5;
        display: grid; gap: 16px; width: 100%; max-width: 1600px; margin: 0 auto; min-width: 0; padding-bottom: 36px; color: var(--texto); }
  html[data-tema="escuro"] .cr { --cr-cartao: rgba(255, 255, 255, .05); --cr-borda: rgba(255, 255, 255, .08); --cr-sombra: none; --cr-seg: rgba(255, 255, 255, .07); --cr-seg-on: #eaf3fc; --cr-seg-on-txt: #08243f;
        --cr-mini: rgba(255, 255, 255, .07); --cr-bom: #0ffcbe; --cr-bom-fundo: rgba(15, 252, 190, .12); --cr-aviso: #2a2410; --cr-aviso-txt: #ffd47a; --cr-ruim: #ff9a9c; --cr-ruim-fundo: rgba(255, 122, 122, .14); --cr-img: rgba(255, 255, 255, .06); }
  @media (min-width: 761px) { #v-criativos > .painel { padding: 22px 28px 0; } }
  @media (max-width: 760px) { .cr { padding-bottom: 120px; gap: 14px; } }
  .cr button, .cr select { font-family: inherit; }
  .cr :focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  .cr-topo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
  .cr-titulo { flex: 1; min-width: 200px; }
  .cr-titulo h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
  .cr-titulo p { margin: 3px 0 0; font-size: 13px; color: var(--sub); }
  .cr-barra-cel { display: none; justify-content: flex-end; }
  @media (max-width: 760px) { .cr-barra-cel { display: flex; } .cr-titulo h1 { font-size: 26px; } }
  .cr-trilho { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--cr-seg); box-shadow: inset 0 0 0 1px var(--cr-borda); max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .cr-trilho::-webkit-scrollbar { display: none; }
  .cr-trilho button { all: unset; box-sizing: border-box; cursor: pointer; min-height: 32px; padding: 0 12px; display: inline-grid; place-items: center; border-radius: 999px; font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .cr-trilho button[aria-pressed="true"] { background: var(--cr-seg-on); color: var(--cr-seg-on-txt); font-weight: 700; }
  .cr-filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; min-width: 0; }
  .cr-filtros label { position: relative; display: inline-flex; align-items: center; min-width: 0; flex: 0 1 auto; }
  .cr-filtros label span { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 11.5px; font-weight: 700; color: var(--sub); pointer-events: none; }
  .cr-filtros select { appearance: none; -webkit-appearance: none; height: 38px; border-radius: 999px; border: 0; padding: 0 30px 0 0; font-size: 13px; font-weight: 700; color: var(--texto); background: var(--cr-seg); box-shadow: inset 0 0 0 1px var(--cr-borda); max-width: 260px; min-width: 0; text-overflow: ellipsis;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237b8ea2' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; background-size: 16px; }
  @media (max-width: 760px) { .cr-filtros { display: grid; grid-template-columns: 1fr 1fr; } .cr-filtros label { display: flex; } .cr-filtros select { width: 100%; max-width: none; } .cr-filtros label:last-child { grid-column: 1 / -1; } .cr-topo .cr-trilho { width: 100%; justify-content: space-between; } }
  .cr-aviso { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; padding: 12px 14px; border-radius: 18px; background: var(--cr-aviso); color: var(--cr-aviso-txt); font-size: 13.5px; line-height: 1.45; }
  .cr-aviso.ruim { background: var(--cr-ruim-fundo); color: var(--cr-ruim); }
  .cr-aviso p { margin: 0; flex: 1; min-width: 220px; }
  .cr-aviso a { flex: none; text-decoration: none; font-weight: 800; font-size: 13px; padding: 9px 14px; border-radius: 999px; background: #08243f; color: #fff; }
  html[data-tema="escuro"] .cr-aviso a { background: #eaf3fc; color: #08243f; }
  .cr-totais { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  @media (max-width: 760px) { .cr-totais { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; } .cr-total { padding: 10px 12px; border-radius: 16px; } .cr-total b { font-size: 17px; } .cr-total em { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cr-trilho button { padding: 0 9px; font-size: 12px; flex: 1 0 auto; } .cr-aviso a { flex: 1 1 100%; text-align: center; } }
  .cr-total { padding: 14px 16px; border-radius: 20px; background: var(--cr-cartao); box-shadow: var(--cr-sombra), inset 0 0 0 1px var(--cr-borda); min-width: 0; }
  .cr-total small { display: block; font-size: 12px; color: var(--sub); }
  .cr-total b { display: block; font-size: 22px; font-weight: 800; letter-spacing: -.02em; margin-top: 4px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cr-total em { display: block; font-style: normal; font-size: 11.5px; color: var(--sub); margin-top: 2px; }
  .cr-grade { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .cr-cartao { display: grid; grid-template-rows: auto 1fr; border-radius: 22px; overflow: hidden; background: var(--cr-cartao); box-shadow: var(--cr-sombra), inset 0 0 0 1px var(--cr-borda); min-width: 0; }
  .cr-img { position: relative; aspect-ratio: 4 / 3; background: var(--cr-img); display: grid; place-items: center; overflow: hidden; }
  .cr-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cr-img .cr-sem { color: var(--sub); }
  .cr-img .cr-sem svg { width: 34px; height: 34px; }
  .cr-pos { position: absolute; left: 10px; top: 10px; min-width: 26px; height: 26px; padding: 0 8px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center; font-size: 12px; font-weight: 800; background: rgba(4, 18, 31, .72); color: #fff; }
  .cr-tag { position: absolute; right: 10px; top: 10px; display: inline-flex; gap: 5px; align-items: center; height: 26px; padding: 0 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; background: rgba(255, 255, 255, .92); color: #08243f; }
  .cr-tag svg { width: 14px; height: 14px; }
  .cr-corpo { padding: 14px; display: grid; gap: 10px; align-content: start; min-width: 0; }
  .cr-nome b { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 14.5px; line-height: 1.3; }
  .cr-nome small { display: block; margin-top: 3px; font-size: 12px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cr-nums { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .cr-num { padding: 8px; border-radius: 12px; background: var(--cr-mini); min-width: 0; }
  .cr-num small { display: block; font-size: 11px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cr-num b { display: block; font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cr-num i { display: block; font-style: normal; font-size: 11px; color: var(--sub); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cr-num.bom b { color: var(--cr-bom); }
  .cr-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; color: var(--sub); }
  .cr-meta b { color: var(--texto); font-weight: 700; }
  .cr-meta .ruim { color: var(--cr-ruim); font-weight: 700; }
  .cr-ver { font-size: 12.5px; font-weight: 700; color: #106ebe; text-decoration: none; justify-self: start; }
  html[data-tema="escuro"] .cr-ver { color: #7cc4ff; }
  .cr-texto { font-size: 12.5px; color: var(--sub); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0; }
  /* celular: lista */
  @media (max-width: 760px) {
    .cr-grade { grid-template-columns: 1fr; gap: 10px; }
    .cr-cartao { grid-template-columns: 84px minmax(0, 1fr); grid-template-rows: auto; border-radius: 18px; }
    .cr-img { aspect-ratio: auto; min-height: 100%; }
    .cr-img img { position: absolute; inset: 0; }
    .cr-pos { left: 6px; top: 6px; min-width: 22px; height: 22px; font-size: 11px; padding: 0 6px; }
    .cr-tag { display: none; }
    .cr-corpo { padding: 10px 12px; gap: 8px; }
    .cr-nums { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .cr-num { padding: 6px 7px; }
    .cr-num b { font-size: 14px; }
    .cr-texto { display: none; }
  }
  .cr-vazio { padding: 28px 20px; border-radius: 22px; text-align: center; background: var(--cr-cartao); box-shadow: inset 0 0 0 1px var(--cr-borda); display: grid; gap: 8px; justify-items: center; }
  .cr-vazio b { font-size: 16px; }
  .cr-vazio p { margin: 0; max-width: 560px; color: var(--sub); font-size: 13.5px; line-height: 1.5; }
  .cr-esqueleto { height: 260px; border-radius: 22px; background: var(--cr-cartao); box-shadow: inset 0 0 0 1px var(--cr-borda); opacity: .7; }
  .cr-rodape { font-size: 12px; color: var(--sub); text-align: center; line-height: 1.5; }
  `;
  const SVG = {
    imagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="13" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  };
  const PERIODOS = [['7d', '7 dias'], ['30d', '30 dias'], ['90d', '90 dias'], ['mes', 'Este mês'], ['mes_passado', 'Mês passado']];
  const ORDENS = [['vendas', 'Mais vendas (R$)'], ['leads', 'Mais leads'], ['agendamentos', 'Mais agendamentos'], ['custo', 'Menor custo por lead'], ['gasto', 'Maior gasto']];
  const REDE = { instagram: 'Instagram', facebook: 'Facebook', meta: 'Meta', google: 'Google', tiktok: 'TikTok', whatsapp: 'WhatsApp' };
  const lembrar = (k, v) => { try { localStorage.setItem('sintonia.criativos.' + k, v); } catch {} };
  const lembrado = (k, padrao) => { try { return localStorage.getItem('sintonia.criativos.' + k) || padrao; } catch { return padrao; } };
  const s = { caixa: null, ui: null, dados: null, erro: '', carregando: false, periodo: lembrado('periodo', '30d'), ordem: lembrado('ordem', 'vendas'), unidade: '', campanha: '', pedido: 0 };

  const brl = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: v >= 1000 ? 0 : 2 }));
  /** R$ curto para caber no quadrinho: R$ 950, R$ 1,3 mil, R$ 2,1 mi. */
  const brlCurto = (v) => (v === null || v === undefined ? '—' : v < 1000 ? 'R$ ' + Math.round(v).toLocaleString('pt-BR') : 'R$ ' + new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(v));
  const n = (v) => (v === null || v === undefined ? '—' : v.toLocaleString('pt-BR'));
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const seguro = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

  function estilo() {
    if (document.getElementById('estilo-criativos')) return;
    const st = document.createElement('style'); st.id = 'estilo-criativos'; st.textContent = CSS; document.head.append(st);
  }

  async function carregar() {
    const ui = s.ui; if (!ui) return;
    const meu = ++s.pedido;
    s.carregando = true; desenhar();
    const q = new URLSearchParams({ periodo: s.periodo, ordem: s.ordem });
    if (s.unidade) q.set('unidade', s.unidade);
    if (s.campanha) q.set('campanha', s.campanha);
    try { const r = await ui.api('/api/rastreio/criativos?' + q); if (meu !== s.pedido) return; s.dados = r; s.erro = ''; }
    catch (x) { if (meu !== s.pedido) return; s.erro = x.message || 'Não deu para carregar agora.'; }
    s.carregando = false; desenhar();
  }

  function filtros(el) {
    const d = s.dados;
    const sel = (rot, valor, opcoes, aoMudar) => {
      const x = el('select', { 'aria-label': rot, onchange: (e) => aoMudar(e.target.value) }, ...opcoes.map(([v, t]) => el('option', { value: v, text: t })));
      x.value = valor;
      // O rótulo fica dentro da pílula, à esquerda do valor.
      const span = el('span', { text: rot });
      requestAnimationFrame(() => { x.style.paddingLeft = `${span.offsetWidth + 20}px`; });
      return el('label', {}, span, x);
    };
    const UNI = s.ui.UNIDADE || {};
    const unidades = [['', 'Todas'], ...((d?.unidades || []).map((u) => [u, UNI[u] || u]))];
    if (s.unidade && !unidades.some(([v]) => v === s.unidade)) unidades.push([s.unidade, UNI[s.unidade] || s.unidade]);
    const camps = [['', 'Todas'], ...((d?.campanhas || []).map((c) => [c.chave, c.nome]))];
    if (s.campanha && !camps.some(([v]) => v === s.campanha)) camps.push([s.campanha, 'Campanha escolhida']);
    return el('div', { class: 'cr-filtros' },
      sel('Unidade', s.unidade, unidades, (v) => { s.unidade = v; carregar(); }),
      sel('Campanha', s.campanha, camps, (v) => { s.campanha = v; carregar(); }),
      sel('Ordem', s.ordem, ORDENS, (v) => { s.ordem = v; lembrar('ordem', v); carregar(); }));
  }

  function cartao(el, c, i, comGasto) {
    const img = seguro(c.imagem);
    const quadro = el('div', { class: 'cr-img' });
    if (img) {
      const im = el('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
      im.addEventListener('error', () => im.replaceWith(el('span', { class: 'cr-sem', html: c.tipo === 'link' ? SVG.link : SVG.imagem })));
      quadro.append(im);
    } else quadro.append(el('span', { class: 'cr-sem', html: c.tipo === 'link' ? SVG.link : c.video ? SVG.video : SVG.imagem }));
    quadro.append(el('span', { class: 'cr-pos', text: String(i + 1), 'aria-hidden': 'true' }));
    const rede = c.tipo === 'link' ? 'Link' : REDE[c.rede] || (c.rede ? c.rede.charAt(0).toUpperCase() + c.rede.slice(1) : '');
    if (rede || c.video) quadro.append(el('span', { class: 'cr-tag' }, c.video ? el('span', { html: SVG.video, style: 'display:inline-grid' }) : null, rede || 'Vídeo'));
    const sub = [c.campanha?.nome, c.conjunto].filter(Boolean).join(' · ') || (c.tipo === 'link' ? 'Link rastreado' : 'Anúncio de clique para WhatsApp');
    const num = (rot, val, extra, bom, dica) => el('div', { class: 'cr-num' + (bom ? ' bom' : ''), title: dica || `${rot}: ${val}${extra ? ` (${extra})` : ''}` }, el('small', { text: rot }), el('b', { text: val }), extra ? el('i', { text: extra }) : null);
    const nums = el('div', { class: 'cr-nums' },
      num('Leads', n(c.leads)),
      num('Agendaram', n(c.agendaram), c.leads ? pct(c.agendaram, c.leads) : ''),
      num('Vendas', c.valor > 0 ? brlCurto(c.valor) : n(c.vendas), c.valor > 0 ? `${c.vendas} venda${c.vendas === 1 ? '' : 's'}` : '', c.vendas > 0, c.valor > 0 ? `${brl(c.valor)} em ${c.vendas} venda(s)` : ''));
    const meta = [];
    if (comGasto) {
      if (c.gasto === null) meta.push(el('span', { text: 'Sem dados de gasto' }));
      else {
        meta.push(el('span', {}, 'Gasto ', el('b', { text: brl(c.gasto) })));
        meta.push(el('span', {}, 'Custo/lead ', c.leads ? el('b', { text: brl(c.custoLead) }) : el('span', { class: 'ruim', text: 'sem lead' })));
        if (c.vendas) meta.push(el('span', {}, 'Custo/venda ', el('b', { text: brl(c.custoVenda) })));
        if (c.ctr !== null) meta.push(el('span', {}, 'CTR ', el('b', { text: `${c.ctr.toLocaleString('pt-BR')}%` })));
        if (c.retorno !== null && c.valor > 0) meta.push(el('span', {}, 'Retorno ', el('b', { text: `${c.retorno.toLocaleString('pt-BR')}x` })));
      }
    }
    if (c.vendasSemValor) meta.push(el('span', { text: `${c.vendasSemValor} venda(s) sem valor no cartão` }));
    const url = seguro(c.url);
    return el('article', { class: 'cr-cartao', 'aria-label': `${i + 1}º: ${c.titulo}` }, quadro,
      el('div', { class: 'cr-corpo' },
        el('div', { class: 'cr-nome' }, el('b', { text: c.titulo, title: c.titulo }), el('small', { text: sub, title: sub })),
        c.texto ? el('p', { class: 'cr-texto', text: c.texto }) : null,
        nums,
        meta.length ? el('div', { class: 'cr-meta' }, ...meta) : null,
        url ? el('a', { class: 'cr-ver', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Ver anúncio ↗' }) : null));
  }

  function desenhar() {
    const ui = s.ui; if (!s.caixa || !ui) return;
    const el = ui.el; const d = s.dados;
    const trilho = el('div', { class: 'cr-trilho', role: 'group', 'aria-label': 'Período' }, ...PERIODOS.map(([v, t]) =>
      el('button', { type: 'button', 'aria-pressed': String(s.periodo === v), text: t, onclick: () => { s.periodo = v; lembrar('periodo', v); carregar(); } })));
    const filhos = [
      el('div', { class: 'cr-barra-cel' }, window.SintoniaTopoGrupo ? window.SintoniaTopoGrupo() : null),
      el('div', { class: 'cr-topo' }, el('div', { class: 'cr-titulo' }, el('h1', { text: 'Central de criativos' }), el('p', { text: 'Quais anúncios trazem leads, agendamentos e vendas' })), trilho),
      filtros(el),
    ];
    if (s.erro) filhos.push(el('div', { class: 'cr-aviso ruim', role: 'alert' }, el('p', { text: s.erro }), el('a', { href: '#', text: 'Tentar de novo', onclick: (e) => { e.preventDefault(); carregar(); } })));
    if (d && !d.meta?.conectada && d.veGasto) {
      filhos.push(el('div', { class: 'cr-aviso' },
        el('p', { text: d.podeConectar ? 'Aqui aparece o que veio das conversas. Conecte a conta de anúncios da Meta para ver também quanto cada anúncio gastou e o custo por lead e por venda.' : 'Aqui aparece o que veio das conversas. Para ver gasto e custo por lead, peça à administração para conectar a conta de anúncios em Conexões.' }),
        d.podeConectar ? el('a', { href: '/conexoes#capi', text: 'Conectar' }) : null));
    }
    if (d?.meta?.erro) filhos.push(el('div', { class: 'cr-aviso ruim' }, el('p', { text: `Não deu para ler o gasto na Meta: ${d.meta.erro}` }), d.podeConectar ? el('a', { href: '/conexoes#capi', text: 'Ver conexão' }) : null));

    if (!d && s.carregando) {
      filhos.push(el('div', { class: 'cr-grade', 'aria-busy': 'true' }, ...[0, 1, 2, 3].map(() => el('div', { class: 'cr-esqueleto' }))));
    } else if (d) {
      const t = d.totais; const comGasto = t.gasto !== null;
      const total = (rot, val, extra) => el('div', { class: 'cr-total' }, el('small', { text: rot }), el('b', { text: val, title: val }), extra ? el('em', { text: extra }) : null);
      const totais = [
        total('Leads', n(t.leads), 'de anúncio'),
        total('Agendaram', n(t.agendaram), t.leads ? `${pct(t.agendaram, t.leads)} dos leads` : ''),
        total('Vendas', innerWidth <= 760 ? brlCurto(t.valor) : brl(t.valor), `${n(t.vendas)} venda${t.vendas === 1 ? '' : 's'}`),
      ];
      if (comGasto) totais.push(total('Gasto', brl(t.gasto)), total('Custo por lead', brl(t.custoLead), t.custoVenda !== null ? `${brl(t.custoVenda)} por venda` : ''), total('Retorno', t.retorno !== null ? `${t.retorno.toLocaleString('pt-BR')}x` : '—', 'vendas ÷ gasto'));
      filhos.push(el('div', { class: 'cr-totais', 'aria-busy': String(s.carregando) }, ...totais));
      if (d.criativos.length) {
        filhos.push(el('div', { class: 'cr-grade', 'aria-busy': String(s.carregando) }, ...d.criativos.map((c, i) => cartao(el, c, i, comGasto))));
        filhos.push(el('p', { class: 'cr-rodape', text: `Leads que chegaram de ${d.desde.split('-').reverse().join('/')} a ${d.ate.split('-').reverse().join('/')}. Agendamento e venda contam para o anúncio que trouxe a cliente, mesmo se aconteceram depois. Venda = compareceu ou fechou no funil; o valor vem do cartão, do agendamento ou da tabela de preços.` }));
      } else {
        filhos.push(el('div', { class: 'cr-vazio' },
          el('b', { text: s.unidade || s.campanha ? 'Nada com esses filtros' : 'Nenhum lead de anúncio neste período' }),
          el('p', { text: 'Quando uma cliente chama no WhatsApp por um anúncio de clique para WhatsApp, a Sintonia guarda o anúncio (imagem, título e texto) e mostra aqui quantas vieram, agendaram e compraram. Links rastreados com utm_content também entram.' })));
      }
    }
    s.caixa.replaceChildren(el('div', { class: 'cr' }, ...filhos));
  }

  window.SintoniaTelas.criativos = {
    desenhar(caixa, ui) { estilo(); s.caixa = caixa; s.ui = ui || window.Sintonia?.ui; desenhar(); carregar(); },
  };

  // A tela se desenha quando a vista fica ativa (sem mexer no roteador do app.html).
  const ligar = () => {
    const sec = document.getElementById('v-criativos');
    const ui = window.Sintonia?.ui;
    if (!sec || !ui) return setTimeout(ligar, 300);
    const abrir = () => window.SintoniaTelas.criativos.desenhar(document.getElementById('criativos'), window.Sintonia.ui);
    let ativa = sec.classList.contains('ativa');
    if (ativa) abrir();
    new MutationObserver(() => { const agora = sec.classList.contains('ativa'); if (agora && !ativa) abrir(); ativa = agora; }).observe(sec, { attributes: true, attributeFilter: ['class'] });
    if (location.hash === '#criativos') { window.Sintonia.mostrar?.('criativos'); history.replaceState(null, '', location.pathname + location.search); }
  };
  ligar();
})();
