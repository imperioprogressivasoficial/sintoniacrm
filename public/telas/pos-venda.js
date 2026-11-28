/* pos-venda: peças do funil pós-venda. Registra window.SintoniaPosVenda = { faixa, selo, ficha, itemMenu, criarSugerido, carregar }.
 * - faixa(caixa, q, ctx): no topo do quadro do funil pós-venda, "Média de visitas no ano" e a meta (a gestão muda a meta ali);
 * - selo(ui, cartao): "2 de 4 visitas no ano" no cartão (só vem no funil pós-venda);
 * - ficha(ui, conversaId): visitas no ano e a etapa do pós-venda, para a ficha do lead;
 * - itemMenu(ctx): "Criar funil pós-venda sugerido" no menu do CRM (gestão, quando ainda não existe).
 * Todo texto que vem do servidor entra por textContent. */
(() => {
  const CSS = `
  .pv-faixa { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 18px; margin: 0 20px 12px; padding: 12px 16px; border-radius: 20px; position: relative; overflow: hidden;
    background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); -webkit-backdrop-filter: blur(18px) saturate(1.4); backdrop-filter: blur(18px) saturate(1.4); }
  .pv-faixa::before { content: ''; position: absolute; left: 16px; right: 16px; top: 0; height: 1px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); opacity: .8; }
  .pv-faixa[hidden] { display: none; }
  .pv-num { display: grid; line-height: 1.15; min-width: 0; }
  .pv-num b { font-size: 24px; font-weight: 800; letter-spacing: -.02em; color: var(--texto); }
  .pv-num small { font-size: 12px; color: var(--sub); white-space: nowrap; }
  .pv-barra { flex: 1 1 160px; min-width: 120px; display: grid; gap: 6px; }
  .pv-trilho { height: 8px; border-radius: 999px; background: color-mix(in srgb, var(--texto) 10%, transparent); overflow: hidden; }
  .pv-trilho i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #106ebe, #3aa0ff); transition: width .4s ease; }
  .pv-barra small { font-size: 12px; color: var(--sub); }
  .pv-meta { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; height: 36px; padding: 0 14px; border-radius: 999px; font-size: 13.5px; font-weight: 700; color: var(--texto);
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); white-space: nowrap; }
  .pv-meta[aria-disabled="true"] { cursor: default; }
  .pv-meta:not([aria-disabled="true"]):hover { background: var(--vidro-ativo); }
  .pv-meta:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .pv-meta svg { width: 16px; height: 16px; }
  .pv-selo { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--sub); white-space: nowrap; }
  .pv-pontos { display: inline-flex; gap: 3px; }
  .pv-pontos i { width: 7px; height: 7px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--marca-azul) 55%, transparent); }
  .pv-pontos i.ok { background: linear-gradient(135deg, #106ebe, #3aa0ff); box-shadow: none; }
  html[data-tema="escuro"] .pv-pontos i { box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.4); }
  html[data-tema="escuro"] .pv-pontos i.ok { background: linear-gradient(135deg, #0ffcbe, #3aa0ff); }
  .pv-selo.bateu { color: #106ebe; }
  html[data-tema="escuro"] .pv-selo.bateu { color: var(--marca-menta); }
  .pv-ficha { display: grid; gap: 6px; font-size: 14px; color: var(--texto); }
  .pv-ficha small { color: var(--sub); font-size: 12.5px; }
  #funil.fc-on > .pv-faixa { display: none !important; } /* no celular a faixa vai dentro do pipeline do celular */
  .fc .pv-faixa { margin: 4px 16px 10px; }
  @media (max-width: 760px) {
    .pv-faixa { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; margin: 0 14px 10px; padding: 10px 12px 10px 14px; gap: 4px 12px; border-radius: 18px; }
    .pv-faixa[hidden] { display: none; }
    .pv-num b { font-size: 20px; }
    .pv-num small { font-size: 11px; white-space: normal; max-width: 9em; }
    .pv-barra { min-width: 0; gap: 4px; }
    .pv-barra small { font-size: 11px; line-height: 1.25; }
    .pv-meta { height: 32px; padding: 0 11px; font-size: 13px; gap: 5px; }
  }`;
  const IC = {
    alvo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
    volta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/></svg>',
  };
  let estilo = false;
  const garantirEstilo = () => {
    if (estilo) return;
    estilo = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
  };
  /** Configuração (funil, meta): guardada para o menu saber se o funil sugerido já existe. */
  const estado = { cfg: null, carregando: null };
  async function carregar(ui, forcar = false) {
    if (estado.cfg && !forcar) return estado.cfg;
    if (!estado.carregando || forcar) estado.carregando = ui.api('/api/pos-venda').then((c) => { estado.cfg = c; return c; }).catch(() => null).finally(() => { estado.carregando = null; });
    return estado.carregando;
  }
  const um = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const gestao = (ui) => Boolean(ui?.ehGestor?.(ui.estado?.eu));

  /** Bolinhas da meta: cheias até as visitas (no máximo 12 bolinhas). */
  function pontos(el, visitas, meta) {
    const total = Math.min(12, Math.max(meta, 1));
    return el('span', { class: 'pv-pontos', 'aria-hidden': 'true' }, ...Array.from({ length: total }, (_, i) => el('i', { class: i < visitas ? 'ok' : '' })));
  }

  function selo(ui, cartao) {
    if (!cartao || typeof cartao.visitasAno !== 'number') return null;
    garantirEstilo();
    const { el } = ui;
    const meta = estado.cfg?.metaVisitas || 4;
    const v = cartao.visitasAno;
    return el('span', { class: 'pv-selo' + (v >= meta ? ' bateu' : ''), title: `${v} visita${v === 1 ? '' : 's'} nos últimos 12 meses (meta ${meta})` },
      pontos(el, v, meta), el('span', { text: `${v} de ${meta} no ano` }));
  }

  async function mudarMeta(ctx) {
    const atual = estado.cfg?.metaVisitas || 4;
    const r = await ctx.pedir({ titulo: 'Meta de visitas no ano', aviso: 'Quantas vezes por ano a cliente deve voltar. Com 4, o caminho do pós-venda convida para voltar a cada 3 meses.',
      campos: [{ nome: 'meta', rotulo: 'Visitas por cliente em 12 meses', tipo: 'escolha', valor: String(atual), opcoes: Array.from({ length: 12 }, (_, i) => [String(i + 1), `${i + 1} vez${i ? 'es' : ''} por ano`]) }], ok: 'Salvar' });
    if (!r) return;
    const meta = Number(r.meta);
    if (!meta || meta === atual) return;
    const ok = await ctx.tentar(() => ctx.s.ui.api('/api/pos-venda', { method: 'PATCH', body: JSON.stringify({ metaVisitas: meta }) }), 'Meta salva ✓');
    if (ok) { estado.cfg = ok; ctx.carregarQuadro(); }
  }

  /** Faixa do topo do quadro. Some fora do funil pós-venda. */
  function faixa(caixa, q, ctx) {
    if (!caixa) return;
    const r = q && q.posVenda;
    caixa.hidden = !r;
    if (!r) { caixa.replaceChildren(); return; }
    garantirEstilo();
    const ui = ctx.s.ui;
    const { el } = ui;
    if (estado.cfg) estado.cfg.metaVisitas = r.meta;
    const pct = Math.max(0, Math.min(100, (r.media / Math.max(1, r.meta)) * 100));
    const podeMudar = gestao(ui);
    caixa.replaceChildren(
      el('div', { class: 'pv-num' }, el('b', { text: um(r.media) }), el('small', { text: 'média de visitas no ano' })),
      el('div', { class: 'pv-barra' },
        el('div', { class: 'pv-trilho', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(r.meta), 'aria-valuenow': String(r.media), 'aria-label': 'Média de visitas no ano em relação à meta' }, el('i', { style: `width:${pct}%` })),
        el('small', { text: r.clientes ? `${r.naMeta} de ${r.clientes} cliente${r.clientes === 1 ? '' : 's'} já ${r.naMeta === 1 ? 'bateu' : 'bateram'} a meta` : 'Ainda sem clientes no pós-venda' })),
      el('button', { class: 'pv-meta', type: 'button', 'aria-disabled': podeMudar ? null : 'true', title: podeMudar ? 'Mudar a meta' : 'Meta de visitas no ano', onclick: () => { if (podeMudar) mudarMeta(ctx); } },
        el('span', { html: IC.alvo, style: 'display:grid' }), el('span', { text: `Meta ${r.meta}` })),
    );
  }

  /** Bloco da ficha do lead: visitas no ano e a etapa do pós-venda. */
  function ficha(ui, conversaId) {
    garantirEstilo();
    const { el } = ui;
    const caixa = el('div', { class: 'pv-ficha' }, el('small', { text: 'Carregando…' }));
    ui.api(`/api/pos-venda/conversas/${encodeURIComponent(conversaId)}`).then((r) => {
      const quando = (r.dias || []).map((d) => d.split('-').reverse().slice(0, 2).join('/')).join(', ');
      caixa.replaceChildren(
        el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, pontos(el, r.visitasAno, r.meta),
          el('b', { text: `${r.visitasAno} de ${r.meta} visita${r.meta === 1 ? '' : 's'} nos últimos 12 meses` })),
        quando ? el('small', { text: `Atendimentos: ${quando}` }) : null,
        el('small', { text: r.etapa ? `No pós-venda: ${r.etapa.nome}` : r.funilId ? 'Fora do funil pós-venda' : 'O funil pós-venda ainda não foi criado' }));
    }).catch(() => caixa.replaceChildren(el('small', { text: 'Não deu para carregar as visitas.' })));
    return caixa;
  }

  async function criarSugerido(ctx) {
    const r = await ctx.pedir({ titulo: 'Criar funil pós-venda sugerido', ok: 'Criar',
      aviso: 'Cria o funil “Pós-venda” (Conscientização, Retorno 30 dias, Manutenção 60 dias, Retorno 90 dias, Voltou e Inativa) e as automações ligadas: quando a cliente chega em Finalizado, ela entra no pós-venda e recebe mensagens curtas por tempo até voltar. Meta: 4 visitas no ano. Dá para desligar e mudar tudo em Automações.' });
    if (!r) return;
    const f = await ctx.tentar(() => ctx.s.ui.post('/api/pos-venda/sugerido', {}), 'Funil pós-venda criado ✓');
    if (!f || !f.funilId) return;
    estado.cfg = f;
    await ctx.recarregar();
    window.SintoniaTelas?.funil?.abrirFunil?.(f.funilId);
  }

  /** Item do menu do CRM (gestão), só enquanto o funil sugerido não existe. */
  function itemMenu(ctx, icone) {
    const ui = ctx.s.ui;
    if (!gestao(ui) || !estado.cfg || estado.cfg.funilId) return null;
    return { nome: 'Criar funil pós-venda sugerido', info: 'Etapas e automações até a cliente voltar (meta 4 visitas no ano)', icone: icone || IC.volta, acao: () => criarSugerido(ctx) };
  }

  window.SintoniaPosVenda = { faixa, selo, ficha, itemMenu, criarSugerido, carregar, estado };
})();
