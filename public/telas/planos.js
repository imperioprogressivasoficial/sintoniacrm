/* Tela "Plano e uso da IA" (só administração e direção). Ponto de entrada: window.SintoniaPlanos.abrir()
 * (abre em painel próprio, por cima do app) ou window.SintoniaTelas.planos.desenhar(caixa) para montar numa vista.
 * Mostra o plano atual, os limites de uso (5 h, semana, mês) com quando renovam, o saldo de créditos, os 3 planos,
 * a calculadora "Quanto custa ter a IA no seu negócio", o uso por dia (SVG), o comparativo IA × atendente humano
 * e os pedidos (mudar de plano, comprar créditos: sem cobrança real ainda).
 * A calculadora usa a mesma fórmula de src/planos/catalogo.ts (calcularCalculadora); window.SintoniaPlanos.calcular.
 * Dados: GET /api/planos, POST /api/planos/pedidos, GET /api/planos/comparativo, PUT /api/planos/custo-clt.
 * Estilos em <style id="estilo-planos">, prefixo .pl-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
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
  .pl-barra { height: 14px; border-radius: 999px; background: var(--vidro-item, rgba(0,0,0,.07)); overflow: hidden; display: flex; }
  .pl-barra i { display: block; height: 100%; background: var(--azul); }
  .pl-barra i.pl-credito { background: #8b5cf6; }
  .pl-barra i.pl-alto { background: var(--coral); }
  .pl-barra i.pl-livre { background: color-mix(in srgb, var(--menta) 55%, transparent); }
  .pl-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 12px; }
  .pl-nums div b { display: block; font-size: 21px; font-variant-numeric: tabular-nums; }
  .pl-nums div span { font-size: 12px; color: var(--sub, #5b6b7b); font-weight: 600; }
  .pl-leg { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--sub, #5b6b7b); margin-top: 6px; }
  .pl-leg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; background: var(--azul); }
  .pl-leg i.pl-credito { background: #8b5cf6; }
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
  .pl-lim { display: grid; gap: 12px; }
  .pl-lim-t { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 13.5px; margin-bottom: 5px; }
  .pl-lim-t b { font-size: 14px; }
  .pl-lim-t span { color: var(--sub, #5b6b7b); font-weight: 600; }
  .pl-lim-t em { font-style: normal; font-weight: 700; color: color-mix(in srgb, var(--azul) 70%, var(--texto, #000)); }
  .pl-lim-t em.pl-estourou { color: color-mix(in srgb, var(--coral) 75%, var(--texto, #000)); }
  .pl-cred { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 14px; padding: 12px 14px; border-radius: 14px; background: color-mix(in srgb, #8b5cf6 10%, transparent); }
  .pl-cred b { font-size: 20px; font-variant-numeric: tabular-nums; }
  .pl-planos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 900px) { .pl-planos { grid-template-columns: minmax(0, 1fr); } }
  .pl-pl { border-radius: 16px; padding: 14px 16px; box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(0,0,0,.08)); min-width: 0; }
  .pl-pl.pl-atual { box-shadow: inset 0 0 0 2px var(--azul); background: color-mix(in srgb, var(--azul) 5%, transparent); }
  .pl-pl h3 { margin: 0; font-size: 17px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .pl-pl .pl-preco { font-weight: 800; font-size: 15px; margin: 6px 0 8px; }
  .pl-pl ul { margin: 0; padding-left: 18px; font-size: 13.5px; display: grid; gap: 4px; }
  .pl-calc-res { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  .pl-calc-res div { padding: 12px 14px; border-radius: 14px; background: var(--vidro-item, rgba(0,0,0,.04)); min-width: 0; }
  .pl-calc-res b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
  .pl-calc-res span { font-size: 12px; color: var(--sub, #5b6b7b); font-weight: 600; }
  .pl-calc-res small { display: block; font-size: 12px; color: var(--sub, #5b6b7b); }
  .pl-calc-res .pl-eco { background: color-mix(in srgb, var(--menta) 16%, transparent); }
  .pl-lista li { padding: 8px 0; border-bottom: 1px solid var(--vidro-linha, rgba(0,0,0,.07)); display: flex; gap: 8px; justify-content: space-between; flex-wrap: wrap; }
  `;

  const brl = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const num = (n) => (n == null ? '—' : n.toLocaleString('pt-BR'));
  const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : n >= 1e3 ? `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : num(n));
  const tempo = (ms) => (ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)} s` : ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const TIPO = { mudar_plano: 'Mudar de plano', adicional_fora: 'Adicional (antigo)', recarga: 'Créditos' };
  const NOME_PLANO = { essencial: 'Essencial', gratis: 'Essencial', expediente: 'Colaborador de IA', empresarial: 'Empresarial', fundador: 'Fundador' };
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

  /** Mesma fórmula de calcularCalculadora (src/planos/catalogo.ts). `ref`: valores do plano vindos de /api/planos. */
  function calcular(e, ref = {}) {
    const r = { precoColaborador: 1997, conversasPlano: 1500, conversasPorRecarga: 190, precoRecarga: 99, tokensRecarga: 5e6, limiteMes: 4e7, ...ref };
    const c2 = (n) => Math.round(n * 100) / 100;
    const atend = Math.min(10, Math.max(1, Math.round(Number(e.atendentes) || 1)));
    const tpc = e.tokensPorConversa > 0 ? e.tokensPorConversa : null;
    const conversasPlano = tpc && r.limiteMes ? Math.max(1, Math.round(r.limiteMes / tpc)) : r.conversasPlano;
    const conversasPorRecarga = tpc ? Math.max(1, Math.round(r.tokensRecarga / tpc)) : r.conversasPorRecarga;
    const recargas = Math.ceil(Math.max(0, (Number(e.conversasMes) || 0) - conversasPlano) / conversasPorRecarga);
    const creditos = c2(recargas * r.precoRecarga);
    const func = c2(atend * c2((Number(e.salario) || 0) * (1 + (Number(e.encargosPct) || 0) / 100) + (Number(e.beneficios) || 0)));
    const ia = c2(r.precoColaborador + creditos);
    return { custoFuncionariosMensal: func, custoFuncionariosAnual: c2(func * 12), conversasPlano, conversasPorRecarga, recargasEstimadas: recargas, creditosEstimadosMensal: creditos, custoIaMensal: ia, custoIaAnual: c2(ia * 12), economiaMensal: c2(func - ia), economiaAnual: c2((func - ia) * 12), horasIaSemana: 168, horasEquipeSemana: 44 * atend, calibrada: Boolean(tpc) };
  }

  function graficoDias(porDia, mesInicio) {
    const ini = new Date(mesInicio);
    // O mês começa à meia-noite da Bahia (03:00 UTC): o dia/mês em UTC é o mesmo.
    const n = new Date(Date.UTC(ini.getUTCFullYear(), ini.getUTCMonth() + 1, 0)).getUTCDate();
    const ym = ini.toISOString().slice(0, 7);
    const mapa = new Map(porDia.map((d) => [d.dia, d]));
    const dias = Array.from({ length: n }, (_, i) => mapa.get(`${ym}-${String(i + 1).padStart(2, '0')}`) || { tokens: 0, tokensCredito: 0 });
    const max = Math.max(1, ...dias.map((d) => d.tokens));
    const W = 620, H = 160, B = 18, L = 4;
    const lw = (W - L * 2) / n;
    const bars = dias.map((d, i) => {
      const x = L + i * lw + 1;
      const w = Math.max(1, lw - 2);
      const plano = Math.max(0, d.tokens - (d.tokensCredito || 0));
      const hp = ((H - B - 6) * plano) / max;
      const hc = ((H - B - 6) * (d.tokensCredito || 0)) / max;
      const t = `${i + 1}: ${tok(d.tokens)} tokens${d.tokensCredito ? ` (${tok(d.tokensCredito)} de créditos)` : ''}`;
      return `<g><title>${t}</title><rect x="${x}" y="${H - B - hp}" width="${w}" height="${hp}" rx="2" fill="var(--azul)"/><rect x="${x}" y="${H - B - hp - hc}" width="${w}" height="${hc}" rx="2" fill="#8b5cf6"/></g>`
        + ((i + 1) % 5 === 1 ? `<text x="${x + w / 2}" y="${H - 4}" text-anchor="middle">${i + 1}</text>` : '');
    });
    return `<svg class="pl-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Tokens por dia do mês">${bars.join('')}</svg>`;
  }

  function limitesHtml(d) {
    if (!d.plano.ia) return '<p class="pl-sub">No Essencial a IA não conversa, não responde e não sugere: a equipe atende, e o chatbot de fluxo segue funcionando. Para ter a IA, mude para o Colaborador de IA.</p>';
    if (d.ilimitado) return `<p class="pl-sub">Conta fundadora: a IA trabalha sem limite de uso. ${tok(d.uso.tokens)} tokens neste mês.</p>`;
    return `<div class="pl-lim">${d.limites.map((l) => {
      const pct = l.pct == null ? 0 : l.pct;
      return `<div><div class="pl-lim-t"><b>${esc(l.nome)}</b><span>${l.limite == null ? `${tok(l.usados)} tokens · sem limite` : `${tok(l.usados)} de ${tok(l.limite)} (${num(pct)}%)`}</span></div>
        <div class="pl-barra" role="meter" aria-label="${esc(l.nome)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i class="${l.estourou ? 'pl-alto' : pct >= 80 ? 'pl-alto' : ''}" style="width:${l.limite == null ? 0 : pct}%"></i></div>
        <div class="pl-lim-t" style="margin:4px 0 0"><span>${l.estourou ? 'Limite atingido' : l.limite == null ? '' : `${tok(l.restantes)} livres`}</span><em class="${l.estourou ? 'pl-estourou' : ''}">${esc(l.texto)}</em></div></div>`;
    }).join('')}</div>`;
  }

  function planosHtml(d) {
    return `<div class="pl-planos">${d.catalogo.map((x) => `<div class="pl-pl ${x.id === d.assinatura.plano ? 'pl-atual' : ''}">
      <h3>${esc(x.nome)}${x.id === d.assinatura.plano ? '<span class="pl-selo">seu plano</span>' : ''}</h3>
      <div class="pl-preco">${esc(x.precoTexto)}</div>
      <ul>${x.entregas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      ${x.limites && x.ia ? `<p class="pl-sug" style="margin:8px 0 0">${x.id === 'empresarial' ? 'Limites sob medida para a empresa.' : `Limites: ${tok(x.limites.cincoHoras)} a cada 5 h, ${tok(x.limites.semana)} por semana, ${tok(x.limites.mes)} por mês. Passou, segue com créditos.`}</p>` : ''}
    </div>`).join('')}</div>`;
  }

  async function desenhar(caixa) {
    estilo();
    caixa.innerHTML = '<div class="pl"><p class="pl-sub">Carregando…</p></div>';
    let d;
    try { d = await api('/api/planos'); } catch (e) { caixa.innerHTML = `<div class="pl"><div class="pl-c">${esc(e.message)}</div></div>`; return; }
    const p = d.plano;
    const k = d.calculadora;
    const selo = !p.ia ? ['Sem IA neste plano', true] : d.agora.pode ? [d.agora.usandoCreditos ? 'IA usando créditos' : 'IA atendendo agora', false] : ['IA parada agora', true];
    const raiz = document.createElement('div');
    raiz.className = 'pl';
    raiz.innerHTML = `
      <div class="pl-topo"><h1>Plano e uso da IA<small>CRM completo para a equipe. A IA trabalha 24 horas com limites de uso, como um colaborador.</small></h1>${caixa.classList.contains('pl-fundo') ? '<button class="pl-fechar" data-ac="fechar" aria-label="Fechar">×</button>' : ''}</div>
      <div class="pl-g2">
        <section class="pl-c">
          <h2>Plano atual</h2>
          <div class="pl-plano"><b>${esc(p.nome)}</b><span>${esc(p.precoTexto)}</span>
            <span class="pl-selo ${selo[1] ? 'pl-nao' : ''}">${selo[0]}</span></div>
          <p class="pl-sub">${esc(p.descricao)}</p>
          ${d.agora.pode || !p.ia ? '' : `<div class="pl-aviso">${esc(d.agora.texto)} Nada se perde: as mensagens ficam salvas e a conversa vai para a equipe com o motivo registrado.</div>`}
          <div class="pl-acoes" style="margin-top:12px">
            <button class="pl-bt" data-ac="plano">Mudar de plano</button>
            <button class="pl-bt pl-sec" data-ac="recarga">Comprar créditos</button>
          </div>
          <div data-escolha></div>
          <p class="pl-sug" style="margin-top:10px">Valores sugeridos. Tudo funciona pelo navegador.</p>
        </section>
        <section class="pl-c">
          <h2>Limites de uso da IA</h2>
          ${limitesHtml(d)}
          ${p.ia && !d.ilimitado ? `<div class="pl-cred"><div><span class="pl-sub" style="margin:0;display:block">Saldo de créditos</span><b>${tok(d.creditos.saldo)} tokens</b></div><span class="pl-sub" style="margin:0">Os créditos só são usados depois que algum limite estoura.${d.creditos.usados ? ` Já usados: ${tok(d.creditos.usados)}.` : ''}</span></div>` : ''}
          <div class="pl-nums">
            <div><b>${tok(d.uso.tokens)}</b><span>tokens no mês</span></div>
            <div><b>${brl(d.uso.custoReais)}</b><span>custo estimado da API</span></div>
            <div><b>${num(d.uso.conversas)}</b><span>conversas com IA</span></div>
            <div><b>${num(d.uso.chamadas)}</b><span>chamadas à IA</span></div>
          </div>
          ${d.bloqueios.length ? `<p class="pl-sub">Paradas da IA no mês: ${d.bloqueios.map((b) => `${b.total}× ${esc(b.texto)}`).join(' · ')}</p>` : ''}
        </section>
      </div>
      <section class="pl-c">
        <h2>Planos</h2>
        ${planosHtml(d)}
      </section>
      <section class="pl-c" data-calc>
        <h2>Quanto custa ter a IA no seu negócio</h2>
        <div class="pl-campos">
          <label>Atendentes cobertos<input type="number" inputmode="numeric" min="1" max="10" step="1" name="atendentes" value="1"></label>
          <label>Salário (R$)<input type="number" inputmode="decimal" min="0" step="50" name="salario" value="1800"></label>
          <label>Encargos (%)<input type="number" inputmode="decimal" min="0" step="1" name="encargosPct" value="70"></label>
          <label>Benefícios (R$/mês)<input type="number" inputmode="decimal" min="0" step="10" name="beneficios" value="600"></label>
          <label>Conversas por mês<input type="number" inputmode="numeric" min="0" step="50" name="conversasMes" value="${k.conversasMes}"></label>
        </div>
        <p class="pl-sug" style="margin:-4px 0 12px">${k.conversasReais ? `Conversas por mês: média real da empresa nos últimos 30 dias.` : 'Sem dados de uso ainda: 1.500 conversas por mês de referência.'}${k.tokensPorConversa ? ` Créditos calibrados pela média real de ${tok(k.tokensPorConversa)} tokens por conversa.` : ''}</p>
        <div data-calc-res></div>
      </section>
      <section class="pl-c">
        <h2>Uso por dia</h2>
        ${graficoDias(d.uso.porDia, d.mes.inicio)}
        <div class="pl-leg"><span><i></i>Dentro dos limites</span><span><i class="pl-credito"></i>Pago com créditos</span></div>
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
        ${d.pedidos.length ? `<ul class="pl-lista">${d.pedidos.map((x) => `<li><span>${TIPO[x.tipo] || x.tipo}${x.dados.plano ? `: ${esc(NOME_PLANO[x.dados.plano] || x.dados.plano)}` : ''}${x.dados.tokens ? `: ${tok(x.dados.tokens)} tokens` : ''}</span><span>${new Date(x.criadoEm).toLocaleDateString('pt-BR')} · ${STATUS[x.status] || x.status}</span></li>`).join('')}</ul>` : '<p class="pl-sub">Nenhum pedido ainda.</p>'}
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

    const calc = raiz.querySelector('[data-calc]');
    const recalcular = () => {
      const v = Object.fromEntries([...calc.querySelectorAll('input')].map((i) => [i.name, Number(i.value)]));
      const c = calcular({ ...v, tokensPorConversa: k.tokensPorConversa }, k);
      calc.querySelector('[data-calc-res]').innerHTML = `<div class="pl-calc-res">
        <div><span>Funcionários (${num(Math.min(10, Math.max(1, Math.round(v.atendentes || 1))))})</span><b>${brl(c.custoFuncionariosMensal)}/mês</b><small>${brl(c.custoFuncionariosAnual)} por ano</small></div>
        <div><span>Colaborador de IA</span><b>${brl(c.custoIaMensal)}/mês</b><small>${brl(k.precoColaborador)} + ${c.recargasEstimadas ? `${num(c.recargasEstimadas)} recarga(s) estimada(s): ${brl(c.creditosEstimadosMensal)}` : 'sem créditos extras'} · ${brl(c.custoIaAnual)} por ano</small></div>
        <div class="pl-eco"><span>${c.economiaMensal >= 0 ? 'Economia' : 'Diferença'}</span><b>${brl(c.economiaMensal)}/mês</b><small>${brl(c.economiaAnual)} por ano</small></div>
        <div><span>Horas cobertas por semana</span><b>${num(c.horasIaSemana)} h × ${num(c.horasEquipeSemana)} h</b><small>IA 24 h, todos os dias × equipe (44 h cada)</small></div>
      </div>
      <p class="pl-sug" style="margin-top:8px">Estimativa. O plano cobre cerca de ${num(c.conversasPlano)} conversas por mês; cada recarga de ${brl(k.precoRecarga)} cobre cerca de ${num(c.conversasPorRecarga)}.${c.calibrada ? ' Conta calibrada pelo uso real da IA na empresa.' : ''}</p>`;
    };
    calc.addEventListener('input', recalcular);
    recalcular();

    const comp = raiz.querySelector('[data-comp]');
    const valores = () => Object.fromEntries([...comp.querySelectorAll('input,select')].map((i) => [i.name, Number(i.value)]));

    async function comparar() {
      const v = valores();
      const alvo = comp.querySelector('[data-resultado]');
      alvo.innerHTML = '<p class="pl-sub">Calculando…</p>';
      try {
        const c = await api(`/api/planos/comparativo?${new URLSearchParams(Object.entries(v).map(([k2, x]) => [k2, String(x)]))}`);
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
          <span class="pl-sub">Cobrir ${num(c.ia.horasSemana)} h/semana com gente pede ${num(c.cltsEquivalentes)} atendente(s) CLT a ${brl(c.custoCltMensal)} cada; a IA custa ${brl(c.ia.custoMensal)}/mês${c.precoReferencia ? ' (preço de referência do Colaborador de IA)' : ''}.${c.respostaVezesMaisRapida ? ` A IA responde ${num(c.respostaVezesMaisRapida)}× mais rápido.` : ''} Custo real estimado da API no período: ${brl(c.custoApiPeriodo)}.</span></div>`;
      } catch (e) { alvo.innerHTML = `<p class="pl-sub">${esc(e.message)}</p>`; }
    }

    raiz.addEventListener('click', async (ev) => {
      const ac = ev.target.closest('[data-ac]')?.dataset.ac;
      if (!ac) return;
      if (ac === 'fechar') fechar();
      if (ac === 'plano') opcoes(d.catalogo.filter((x) => x.id !== d.assinatura.plano).map((x) => ({ titulo: `${x.nome} · ${x.precoTexto}`, sub: x.descricao, corpo: { tipo: 'mudar_plano', plano: x.id } })));
      if (ac === 'recarga') opcoes(d.recargas.map((r) => ({ titulo: `${r.nome} · ${brl(r.preco)}`, sub: 'Créditos usados só depois que algum limite (5 h, semana ou mês) estourar.', corpo: { tipo: 'recarga', recargaId: r.id } })));
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
  window.SintoniaPlanos = { abrir, fechar, desenhar, calcular };
})();
