/* Tela "Plano e uso da IA" (só administração e direção). Ponto de entrada: window.SintoniaPlanos.abrir()
 * (abre em painel próprio, por cima do app) ou window.SintoniaTelas.planos.desenhar(caixa) para montar numa vista.
 * Mostra plano atual e janela, cota e uso do mês (por dia em SVG, dentro × fora do horário), pedidos
 * (mudar de plano, fora do horário, recarga: sem cobrança real ainda) e o comparativo IA × atendente humano.
 * Dados: GET /api/planos, POST /api/planos/pedidos, GET /api/planos/comparativo, PUT /api/planos/custo-clt.
 * Estilos em <style id="estilo-planos">, prefixo .pl-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const CSS = `
  .pl-fundo { position: fixed; inset: 0; z-index: 80; background: var(--fundo, #f4f6fa); overflow-y: auto; overflow-x: hidden; -webkit-overflow-scrolling: touch; }
  .pl { --azul: var(--marca-azul, #106ebe); --menta: var(--marca-menta, #0fbf8f); --coral: #ff7a59; color: var(--texto, #0b1b2b);
        max-width: 1100px; margin: 0 auto; padding: 18px 16px 120px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; box-sizing: border-box; font-family: inherit; }
  .pl * { box-sizing: border-box; }
  .pl-topo { display: flex; align-items: center; gap: 12px; }
  .pl-topo h1 { margin: 0; font-size: 30px; letter-spacing: -.02em; flex: 1; min-width: 0; }
  .pl-topo small { display: block; font-size: 13px; color: var(--sub, #5b6b7b); font-weight: 600; letter-spacing: 0; }
  .pl-fechar { all: unset; cursor: pointer; width: 44px; height: 44px; border-radius: 999px; display: grid; place-items: center; font-size: 22px; background: var(--vidro-item, rgba(0,0,0,.05)); }
  .pl-c { background: var(--vidro-fundo, #fff); border: 1px solid var(--vidro-borda, rgba(0,0,0,.08)); border-radius: 20px; padding: 16px 18px; min-width: 0; box-shadow: var(--vidro-brilho, none); }
  .pl-c h2 { margin: 0 0 10px; font-size: 18px; }
  .pl-g2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 820px) { .pl-g2 { grid-template-columns: minmax(0, 1fr); } .pl-topo h1 { font-size: 24px; } }
  .pl-plano { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px; }
  .pl-plano b { font-size: 26px; letter-spacing: -.02em; }
  .pl-selo { display: inline-block; font-size: 12px; font-weight: 800; padding: 4px 10px; border-radius: 999px; background: color-mix(in srgb, var(--menta) 18%, transparent); color: color-mix(in srgb, var(--menta) 60%, var(--texto, #000)); }
  .pl-selo.pl-nao { background: color-mix(in srgb, var(--coral) 18%, transparent); color: color-mix(in srgb, var(--coral) 70%, var(--texto, #000)); }
  .pl-sub { color: var(--sub, #5b6b7b); font-size: 13.5px; margin: 6px 0 0; }
  .pl-sug { font-size: 12px; color: var(--sub, #5b6b7b); font-style: italic; }
  .pl-janela { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; margin-top: 10px; font-size: 12px; text-align: center; }
  .pl-janela div { padding: 6px 2px; border-radius: 10px; background: var(--vidro-item, rgba(0,0,0,.05)); }
  .pl-janela div.pl-on { background: color-mix(in srgb, var(--azul) 16%, transparent); font-weight: 700; }
  .pl-janela span { display: block; font-size: 10.5px; color: var(--sub, #5b6b7b); font-weight: 600; }
  .pl-barra { height: 14px; border-radius: 999px; background: var(--vidro-item, rgba(0,0,0,.07)); overflow: hidden; display: flex; }
  .pl-barra i { display: block; height: 100%; background: var(--azul); }
  .pl-barra i.pl-fora { background: #8b5cf6; }
  .pl-barra i.pl-alto { background: var(--coral); }
  .pl-barra i.pl-livre { background: color-mix(in srgb, var(--menta) 55%, transparent); }
  .pl-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 12px; }
  .pl-nums div b { display: block; font-size: 21px; font-variant-numeric: tabular-nums; }
  .pl-nums div span { font-size: 12px; color: var(--sub, #5b6b7b); font-weight: 600; }
  .pl-leg { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub, #5b6b7b); margin-top: 6px; }
  .pl-leg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; background: var(--azul); }
  .pl-leg i.pl-fora { background: #8b5cf6; }
  .pl-svg { width: 100%; height: 160px; display: block; }
  .pl-svg text { font-size: 10px; fill: var(--sub, #5b6b7b); }
  .pl-acoes { display: flex; flex-wrap: wrap; gap: 8px; }
  .pl-bt { all: unset; cursor: pointer; padding: 11px 16px; border-radius: 999px; font-weight: 700; font-size: 14px; background: var(--azul); color: #fff; min-height: 20px; }
  .pl-bt.pl-sec { background: color-mix(in srgb, var(--azul) 10%, transparent); color: var(--texto, #000); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--azul) 30%, transparent); }
  .pl-bt:focus-visible, .pl-fechar:focus-visible { outline: 2px solid var(--menta); outline-offset: 2px; }
  .pl-aviso { margin-top: 10px; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--azul) 10%, transparent); font-size: 13.5px; }
  .pl-escolha { display: grid; gap: 8px; margin-top: 10px; }
  .pl-escolha button { all: unset; cursor: pointer; padding: 12px 14px; border-radius: 14px; background: color-mix(in srgb, var(--azul) 7%, transparent); box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(0,0,0,.08)); }
  .pl-escolha button b { display: block; }
  .pl-escolha button span { font-size: 12.5px; color: var(--sub, #5b6b7b); }
  .pl-campos { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 12px; }
  .pl-campos label { display: grid; gap: 4px; font-size: 12px; font-weight: 700; color: var(--sub, #5b6b7b); }
  .pl-campos input, .pl-campos select { font: inherit; font-size: 15px; padding: 10px 12px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--texto, #000) 18%, transparent); background: color-mix(in srgb, var(--texto, #000) 4%, transparent); color: var(--texto, #000); min-width: 0; width: 100%; }
  .pl-tab { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
  .pl-tab th, .pl-tab td { padding: 10px 8px; border-bottom: 1px solid var(--vidro-linha, rgba(0,0,0,.08)); text-align: right; }
  .pl-tab th:first-child, .pl-tab td:first-child { text-align: left; }
  .pl-tab th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .03em; color: var(--sub, #5b6b7b); }
  .pl-tab td.pl-ganha { color: color-mix(in srgb, var(--menta) 65%, var(--texto, #000)); font-weight: 800; }
  .pl-economia { margin-top: 12px; padding: 14px 16px; border-radius: 16px; background: color-mix(in srgb, var(--menta) 14%, transparent); }
  .pl-economia b { font-size: 24px; display: block; }
  .pl-lista { list-style: none; margin: 0; padding: 0; font-size: 13.5px; }
  .pl-lista li { padding: 8px 0; border-bottom: 1px solid var(--vidro-linha, rgba(0,0,0,.07)); display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
  `;

  const brl = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const num = (n) => (n == null ? '—' : n.toLocaleString('pt-BR'));
  const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : n >= 1e3 ? `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : num(n));
  const tempo = (ms) => (ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const TIPO = { mudar_plano: 'Mudar de plano', adicional_fora: 'Fora do horário', recarga: 'Recarga' };
  const STATUS = { pendente: 'aguardando pagamento', pago: 'ativo', cancelado: 'cancelado' };

  async function api(url, opcoes = {}) {
    const r = await fetch(url, { credentials: 'same-origin', ...opcoes, headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.erro || `Erro ${r.status}`);
    return j;
  }
  const aviso = (t) => (window.Sintonia?.ui?.toast ? window.Sintonia.ui.toast(t) : alert(t));

  function estilo() {
    if (document.getElementById('estilo-planos')) return;
    const s = document.createElement('style');
    s.id = 'estilo-planos';
    s.textContent = CSS;
    document.head.append(s);
  }

  function graficoDias(porDia, mesInicio) {
    const ini = new Date(mesInicio);
    const n = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0)).getUTCDate();
    const ym = ini.toISOString().slice(0, 7);
    const mapa = new Map(porDia.map((d) => [d.dia, d]));
    const dias = Array.from({ length: n }, (_, i) => mapa.get(`${ym}-${String(i + 1).padStart(2, '0')}`) || { tokensDentro: 0, tokensFora: 0 });
    const max = Math.max(1, ...dias.map((d) => d.tokensDentro + d.tokensFora));
    const W = 620, H = 160, B = 18, L = 4;
    const lw = (W - L * 2) / n;
    const bars = dias.map((d, i) => {
      const x = L + i * lw + 1;
      const w = Math.max(1, lw - 2);
      const hd = ((H - B - 6) * d.tokensDentro) / max;
      const hf = ((H - B - 6) * d.tokensFora) / max;
      const t = `${i + 1}: ${tok(d.tokensDentro + d.tokensFora)} tokens`;
      return `<g><title>${t}</title><rect x="${x}" y="${H - B - hd}" width="${w}" height="${hd}" rx="2" fill="var(--azul)"/><rect x="${x}" y="${H - B - hd - hf}" width="${w}" height="${hf}" rx="2" fill="#8b5cf6"/></g>`
        + ((i + 1) % 5 === 1 ? `<text x="${x + w / 2}" y="${H - 4}" text-anchor="middle">${i + 1}</text>` : '');
    });
    return `<svg class="pl-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Tokens por dia do mês">${bars.join('')}</svg>`;
  }

  function janelaHtml(j) {
    return `<div class="pl-janela">${[1, 2, 3, 4, 5, 6, 0].map((d) => {
      const f = j[d];
      return `<div class="${f ? 'pl-on' : ''}">${DIAS[d]}<span>${f ? `${f.abre}–${f.fecha}` : 'fora'}</span></div>`;
    }).join('')}</div>`;
  }

  async function desenhar(caixa) {
    estilo();
    caixa.innerHTML = '<div class="pl"><p class="pl-sub">Carregando…</p></div>';
    let d;
    try { d = await api('/api/planos'); } catch (e) { caixa.innerHTML = `<div class="pl"><div class="pl-c">${esc(e.message)}</div></div>`; return; }
    const p = d.plano;
    const cota = d.cota;
    const usados = d.uso.tokens;
    const pct = cota.pct;
    const dentroPct = usados ? (d.uso.tokensDentro / usados) * 100 : 0;
    const raiz = document.createElement('div');
    raiz.className = 'pl';
    raiz.innerHTML = `
      <div class="pl-topo"><h1>Plano e uso da IA<small>O CRM é grátis. A IA é uma assinatura com limite de uso.</small></h1>${caixa.classList.contains('pl-fundo') ? '<button class="pl-fechar" data-ac="fechar" aria-label="Fechar">×</button>' : ''}</div>
      <div class="pl-g2">
        <section class="pl-c">
          <h2>Plano atual</h2>
          <div class="pl-plano"><b>${esc(p.nome)}</b><span>${p.preco == null ? 'sem cobrança' : `${brl(p.preco)}/mês`}${d.assinatura.adicionalFora ? ` + ${brl(d.precos.adicionalFora)} fora do horário` : ''}</span>
            <span class="pl-selo ${d.agora.pode ? '' : 'pl-nao'}">${d.agora.pode ? 'IA atendendo agora' : 'IA parada agora'}</span></div>
          <p class="pl-sub">${esc(p.descricao)}</p>
          ${d.agora.pode ? '' : `<div class="pl-aviso">${esc(d.agora.texto)}</div>`}
          <p class="pl-sub"><b>Janela do plano</b> (${num(d.horasJanela)} h/semana${p.ilimitado || d.assinatura.adicionalFora ? '; com fora do horário: 24 h, todos os dias' : ''})</p>
          ${janelaHtml(d.janela)}
          <p class="pl-sub">Feriados contam como fora do horário. Agora: ${d.agora.dentro ? 'dentro' : 'fora'} da janela.</p>
          <div class="pl-acoes" style="margin-top:12px">
            <button class="pl-bt" data-ac="plano">Mudar de plano</button>
            <button class="pl-bt pl-sec" data-ac="recarga">Recarregar</button>
          </div>
          <div data-escolha></div>
          <p class="pl-sug" style="margin-top:10px">CRM: grátis no 1º ano, depois R$ 497/mês (sem IA). Funcionário de IA: R$ 1.997/mês no horário de expediente. Fora do horário (noite, madrugada, domingo e feriado) ou acima da cota, a IA usa créditos adicionais. Empresarial ou personalizado: fale com a gente.</p>
        </section>
        <section class="pl-c">
          <h2>Uso do mês</h2>
          <div class="pl-barra" aria-label="Cota usada"><i class="${pct == null ? 'pl-livre' : pct >= 90 ? 'pl-alto' : ''}" style="width:${pct == null ? 100 : pct}%"></i></div>
          <p class="pl-sub">${cota.total == null ? `${tok(usados)} tokens usados · cota ilimitada` : `${tok(usados)} de ${tok(cota.total)} tokens (${num(pct)}%)${cota.recargas ? ` · inclui ${tok(cota.recargas)} de recarga` : ''}`}</p>
          <div class="pl-nums">
            <div><b>${tok(usados)}</b><span>tokens no mês</span></div>
            <div><b>${brl(d.uso.custoReais)}</b><span>custo estimado da API</span></div>
            <div><b>${num(d.uso.conversas)}</b><span>conversas com IA</span></div>
            <div><b>${num(d.uso.chamadas)}</b><span>chamadas à IA</span></div>
          </div>
          <h2 style="margin-top:16px">Dentro × fora do horário</h2>
          <div class="pl-barra"><i style="width:${dentroPct}%"></i><i class="pl-fora" style="width:${usados ? 100 - dentroPct : 0}%"></i></div>
          <div class="pl-leg"><span><i></i>Dentro: ${tok(d.uso.tokensDentro)}</span><span><i class="pl-fora"></i>Fora: ${tok(d.uso.tokensFora)}</span>${d.bloqueios.length ? `<span>Paradas da IA no mês: ${d.bloqueios.map((b) => `${b.total}× ${esc(b.motivo.replace(/_/g, ' '))}`).join(', ')}</span>` : ''}</div>
        </section>
      </div>
      <section class="pl-c">
        <h2>Uso por dia</h2>
        ${graficoDias(d.uso.porDia, d.mes.inicio)}
        <div class="pl-leg"><span><i></i>Dentro do horário</span><span><i class="pl-fora"></i>Fora do horário</span></div>
      </section>
      <section class="pl-c" data-comp>
        <h2>IA × atendente humano</h2>
        <div class="pl-campos">
          <label>Salário do atendente (R$)<input type="number" inputmode="decimal" min="0" step="50" name="salario" value="${d.clt.salario}"></label>
          <label>Encargos (%)<input type="number" inputmode="decimal" min="0" step="1" name="encargosPct" value="${d.clt.encargosPct}"></label>
          <label>Benefícios (R$/mês)<input type="number" inputmode="decimal" min="0" step="10" name="beneficios" value="${d.clt.beneficios}"></label>
          <label>Período<select name="dias"><option value="7">7 dias</option><option value="30" selected>30 dias</option><option value="90">90 dias</option></select></label>
        </div>
        <div class="pl-acoes"><button class="pl-bt" data-ac="comparar">Recalcular</button><button class="pl-bt pl-sec" data-ac="salvar-clt">Salvar custo do atendente</button></div>
        <div data-resultado style="margin-top:12px"></div>
      </section>
      <section class="pl-c">
        <h2>Pedidos</h2>
        ${d.pedidos.length ? `<ul class="pl-lista">${d.pedidos.map((x) => `<li><span>${TIPO[x.tipo] || x.tipo}${x.dados.plano ? `: ${esc(x.dados.plano)}` : ''}${x.dados.tokens ? `: ${tok(x.dados.tokens)} tokens` : ''}</span><span>${new Date(x.criadoEm).toLocaleDateString('pt-BR')} · ${STATUS[x.status] || x.status}</span></li>`).join('')}</ul>` : '<p class="pl-sub">Nenhum pedido ainda.</p>'}
        <p class="pl-sug" style="margin-top:8px">${d.pagamento.ativo ? '' : 'Em breve: pagamento pela plataforma. Os pedidos ficam registrados e a equipe Sintonia ativa.'}</p>
      </section>`;
    caixa.replaceChildren(raiz);

    const escolha = raiz.querySelector('[data-escolha]');
    const pedir = async (corpo) => {
      try {
        const r = await api('/api/planos/pedidos', { method: 'POST', body: JSON.stringify(corpo) });
        aviso(r.mensagem || 'Pedido registrado.');
        desenhar(caixa);
      } catch (e) { aviso(e.message); }
    };
    const opcoes = (itens) => {
      escolha.innerHTML = `<div class="pl-escolha">${itens.map((x, i) => `<button data-i="${i}"><b>${esc(x.titulo)}</b><span>${esc(x.sub)}</span></button>`).join('')}</div>`;
      escolha.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => pedir(itens[Number(b.dataset.i)].corpo)));
    };
    const comp = raiz.querySelector('[data-comp]');
    const valores = () => Object.fromEntries([...comp.querySelectorAll('input,select')].map((i) => [i.name, Number(i.value)]));

    async function comparar() {
      const v = valores();
      const alvo = comp.querySelector('[data-resultado]');
      alvo.innerHTML = '<p class="pl-sub">Calculando…</p>';
      try {
        const c = await api(`/api/planos/comparativo?${new URLSearchParams(Object.entries(v).map(([k, x]) => [k, String(x)]))}`);
        const melhor = (a, b, menor = true) => (a == null || b == null ? ['', ''] : (menor ? a < b : a > b) ? ['pl-ganha', ''] : a === b ? ['', ''] : ['', 'pl-ganha']);
        const linha = (nome, a, b, fmt, menor) => { const [ca, cb] = melhor(a, b, menor); return `<tr><td>${nome}</td><td class="${ca}">${fmt(a)}</td><td class="${cb}">${fmt(b)}</td></tr>`; };
        alvo.innerHTML = `<div style="overflow-x:auto"><table class="pl-tab"><thead><tr><th>Últimos ${c.dias} dias</th><th>IA</th><th>Equipe (${c.equipe.atendentes} atend.)</th></tr></thead><tbody>
          ${linha('Custo no período', c.ia.custoPeriodo, c.equipe.custoPeriodo, brl, true)}
          ${linha('Conversas atendidas', c.ia.conversas, c.equipe.conversas, num, false)}
          ${linha('Agendamentos', c.ia.agendamentos, c.equipe.agendamentos, num, false)}
          ${linha('1ª resposta (média)', c.ia.respostaMs, c.equipe.respostaMs, tempo, true)}
          ${linha('Custo por agendamento', c.ia.custoPorAgendamento, c.equipe.custoPorAgendamento, brl, true)}
          ${linha('Custo por conversa', c.ia.custoPorConversa, c.equipe.custoPorConversa, brl, true)}
          ${linha('Horas cobertas por semana', c.ia.horasSemana, c.equipe.horasSemana, (x) => `${num(x)} h`, false)}
        </tbody></table></div>
        <div class="pl-economia"><span>Economia estimada por mês</span><b>${brl(c.economiaMensal)}</b>
          <span class="pl-sub">Cobrir ${num(c.ia.horasSemana)} h/semana com gente pede ${num(c.cltsEquivalentes)} atendente(s) CLT a ${brl(c.custoCltMensal)} cada; a IA custa ${brl(c.ia.custoMensal)}/mês${c.precoReferencia ? ' (preço de referência: a conta Fundador não paga)' : ''}.${c.respostaVezesMaisRapida ? ` A IA responde ${num(c.respostaVezesMaisRapida)}× mais rápido.` : ''} Custo real estimado da API no período: ${brl(c.custoApiPeriodo)}.</span></div>`;
      } catch (e) { alvo.innerHTML = `<p class="pl-sub">${esc(e.message)}</p>`; }
    }

    raiz.addEventListener('click', async (ev) => {
      const ac = ev.target.closest('[data-ac]')?.dataset.ac;
      if (!ac) return;
      if (ac === 'fechar') fechar();
      if (ac === 'plano') opcoes(d.catalogo.filter((x) => x.id !== 'fundador' && x.id !== d.assinatura.plano).map((x) => ({ titulo: `${x.nome} · ${x.preco ? `${brl(x.preco)}/mês` : 'grátis'}`, sub: x.descricao, corpo: { tipo: 'mudar_plano', plano: x.id } })));
      if (ac === 'fora') opcoes([{ titulo: d.assinatura.adicionalFora ? 'Desligar o adicional' : `Fora do horário · +${brl(d.precos.adicionalFora)}/mês`, sub: 'Noite, madrugada, domingo e feriado: a IA atende 24 h.', corpo: { tipo: 'adicional_fora', ligar: !d.assinatura.adicionalFora } }]);
      if (ac === 'recarga') opcoes(d.recargas.map((r) => ({ titulo: `${r.nome} · ${brl(r.preco)}`, sub: 'Vale no mês da compra, depois que a cota acabar.', corpo: { tipo: 'recarga', recargaId: r.id } })));
      if (ac === 'comparar') comparar();
      if (ac === 'salvar-clt') {
        const v = valores();
        try { await api('/api/planos/custo-clt', { method: 'PUT', body: JSON.stringify({ salario: v.salario, encargosPct: v.encargosPct, beneficios: v.beneficios }) }); aviso('Custo do atendente salvo.'); desenhar(caixa); } catch (e) { aviso(e.message); }
      }
    });
    comparar();
  }

  let painel;
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  function fechar() {
    painel?.remove();
    painel = undefined;
    document.removeEventListener('keydown', tecla);
  }
  function abrir() {
    fechar();
    painel = document.createElement('div');
    painel.className = 'pl-fundo';
    painel.setAttribute('role', 'dialog');
    painel.setAttribute('aria-label', 'Plano e uso da IA');
    document.body.append(painel);
    document.addEventListener('keydown', tecla);
    desenhar(painel);
  }

  window.SintoniaTelas.planos = { desenhar };
  window.SintoniaPlanos = { abrir, fechar, desenhar };
})();
