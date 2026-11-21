/* rotas-celular (pedido do dono em 21/11): no celular, toda tela "de dentro" (Agenda, Respostas, Rotina, Clientes,
 * Relatórios…, as que não têm aba própria na barra de baixo) ganha no topo, à esquerda, o botão "Voltar": uma bolinha
 * com a seta (o mesmo .icone.redondo do app) e o nome de onde a pessoa veio ("Atendimento", "Configurações",
 * "Dashboard"…). Tocar nele volta EXATAMENTE para lá: veio de Configurações › Atendimento → volta para Configurações
 * com a área Atendimento aberta de novo, no mesmo ponto da rolagem. Entrou direto pelo endereço → vai para Configurações.
 *
 *   window.SintoniaVoltar = {
 *     saida(de, para)  // rotas.js pergunta ao criar uma entrada: { origem (fica na entrada nova), reabrir (na de onde saiu) }
 *     reabrir(m)       // rotas.js chama ao voltar para uma entrada com state.reabrir: reabre a área e a rolagem
 *     voltar(op)       // botão / arrastar da borda (fluidez.js): volta para a origem
 *     dentro()         // true se a tela aberta agora é "de dentro" (tem o botão): a borda esquerda volta
 *     destino()        // vista que vai aparecer ao voltar (para a fluidez.js mostrar por baixo enquanto arrasta)
 *     atualizar()      // redesenha o botão e acende a aba certa da barra
 *     guardar(st)      // cópia das origens em sessionStorage (se o navegador perder o history.state)
 *   }
 * A barra de baixo: na tela de dentro, fica acesa a aba de onde ela veio (Configurações, se veio de lá ou do endereço).
 * No computador nada muda (lá tem o menu lateral). Sem animação em loop; "reduzir movimento" troca direto. */
(() => {
  const ui = window.Sintonia?.ui;
  if (!ui) return;
  const $ = (id) => document.getElementById(id);
  const estado = ui.estado;
  const celular = () => innerWidth <= 760;
  const reduzido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const R = () => window.SintoniaRotas;

  /** Abas da barra de baixo (têm lugar próprio: não ganham botão). */
  const ABAS = new Set(['painel', 'ligacoes', 'serena', 'conversas', 'configuracoes']);
  /** Telas que fazem parte de Conversas no celular (Funil, Grupos, Equipe): só têm botão se vieram de outro lugar. */
  const DE_CONVERSAS = new Set(['funil', 'grupos', 'chat-equipe']);
  const NOMES = {
    painel: 'Dashboard', ligacoes: 'Ligações', serena: 'Serena', conversas: 'Conversas', configuracoes: 'Configurações',
    funil: 'Pipeline', agenda: 'Agenda', respostas: 'Respostas rápidas', reunioes: 'Agendamento online', rotina: 'Rotina',
    agendadas: 'Mensagens agendadas', distribuicao: 'Distribuição', scripts: 'Scripts', tags: 'Tags', clientes: 'Clientes',
    transmissoes: 'Transmissões', email: 'E-mail marketing', links: 'Links', criativos: 'Criativos', automacoes: 'Automações',
    bot: 'Chatbot', ia: 'Agente de IA', relatorios: 'Relatórios', desempenho: 'Desempenho', analises: 'Análises',
    comercial: 'Comercial', acessos: 'Acessos', empresa: 'Empresa', integracoes: 'Integrações', conta: 'Conta',
    grupos: 'Grupos', 'chat-equipe': 'Equipe', equipe: 'Equipe',
  };
  const curto = (t) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > 22 ? t.slice(0, 21).trimEnd() + '…' : t; };
  const tituloDe = (v) => NOMES[v] || curto($('v-' + v)?.querySelector('h1')?.textContent) || 'Voltar';
  const rolador = (v) => { const s = $('v-' + v); return s?.querySelector(':scope > .painel') || s; };

  // ------------------------------------------------------------------ o que estava aberto no último toque
  // O item da área de Configurações fecha o painel e só depois troca de tela: o toque guarda a área e a rolagem.
  let toque = null;
  document.addEventListener('click', (e) => {
    const alvo = e.target instanceof Element ? e.target : null;
    if (!alvo || alvo.closest('.rv-voltar')) return;
    const v = estado.vista;
    const t = { quando: Date.now(), vista: v, rolagem: rolador(v)?.scrollTop || 0, painel: null };
    const d = alvo.closest('dialog.pl');
    const id = d?.dataset.id || '';
    if (d && id.startsWith('cfg-')) {
      const pag = window.SintoniaPainel?.atual?.();
      t.painel = { id, titulo: curto(pag?.el?.querySelector('.pl-topo h2')?.textContent || ''), rolagem: pag?.corpo?.scrollTop || 0 };
    }
    toque = t;
  }, true);

  /** Origem de uma entrada nova que sai de `de` (endereço atual) para a tela `vPara`. */
  function calcular(de, vPara) {
    const st = history.state && typeof history.state === 'object' ? history.state : {};
    const vDe = R()?.ler?.(de)?.vista || null;
    if (!vDe) return { origem: null, reabrir: null };
    if (vDe === vPara) {
      // mesma tela (outra aba das Análises, outro pipeline, abrir conversa): herda a origem, com um passo a mais
      return { origem: st.origem ? { ...st.origem, passos: Math.min(20, (Number(st.origem.passos) || 1) + 1) } : null, reabrir: st.reabrir || null };
    }
    const t = toque && Date.now() - toque.quando < 2500 && toque.vista === vDe ? toque : null;
    const painel = t?.painel && vDe === 'configuracoes' ? t.painel : null;
    const aba = ABAS.has(vDe) ? vDe : st.origem?.aba || (DE_CONVERSAS.has(vDe) ? 'conversas' : 'configuracoes');
    const origem = { caminho: de, vista: vDe, titulo: painel?.titulo || tituloDe(vDe), aba };
    const reabrir = painel || t?.rolagem ? { vista: vDe, rolagem: t?.rolagem || 0, ...(painel ? { painel: { id: painel.id, titulo: painel.titulo, rolagem: painel.rolagem } } : {}) } : null;
    return { origem, reabrir };
  }
  function saida(de, para) {
    const r = calcular(de, R()?.ler?.(para)?.vista || null);
    if (r.origem && r.origem.vista !== (R()?.ler?.(para)?.vista)) toque = null; // usado: não vale para a próxima troca
    return r;
  }

  // ------------------------------------------------------------------ cópia em sessionStorage
  const CHAVE = 'sintonia.rotas.origens';
  function lerSessao() { try { const l = JSON.parse(sessionStorage.getItem(CHAVE) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } }
  function guardar(st) {
    if (!st?.seq) return;
    try {
      const l = lerSessao().filter((x) => x.seq !== st.seq);
      l.push({ seq: st.seq, caminho: location.pathname, origem: st.origem || null });
      sessionStorage.setItem(CHAVE, JSON.stringify(l.slice(-30)));
    } catch { /* sem armazenamento: fica só no histórico */ }
  }

  /** De onde veio a tela aberta agora (null = sem origem: o botão leva para Configurações). */
  function origemAtual() {
    const aqui = R()?.ler?.(location.pathname)?.vista;
    // a tela já trocou e o endereço ainda não (o painel está fechando): a origem é a entrada atual
    if (aqui && aqui !== estado.vista) return calcular(location.pathname, estado.vista).origem;
    const st = history.state;
    if (st && 'origem' in st) return st.origem || null;
    const l = lerSessao();
    const x = st?.seq ? l.find((y) => y.seq === st.seq) : [...l].reverse().find((y) => y.caminho === location.pathname);
    return x?.origem || null;
  }
  function dentro(v = estado.vista, o = origemAtual()) {
    if (!celular() || !v || ABAS.has(v) || !$('v-' + v)) return false;
    if (DE_CONVERSAS.has(v) && (!o || o.vista === 'conversas' || DE_CONVERSAS.has(o.vista))) return false;
    return true;
  }
  const destino = () => { const o = origemAtual(); return o?.vista && $('v-' + o.vista) ? o.vista : 'configuracoes'; };

  // ------------------------------------------------------------------ botão "Voltar" e aba acesa
  const CSS = `
  .vista > .rv-topo { display: none; }
  @media (max-width: 760px) {
    .area > .vista.ativa.rv-com { flex-direction: column; }
    .area > .vista.rv-com > :not(.rv-topo) { flex: 1 1 auto; min-height: 0; }
    .vista > .rv-topo { display: flex; flex: none; align-items: center; padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 0; position: relative; z-index: 3; }
    .rv-voltar { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; max-width: 100%; min-height: 44px; padding: 0 12px 0 0; border-radius: 999px; color: var(--texto); font: inherit; font-size: 15.5px; font-weight: 600; letter-spacing: -.01em; -webkit-tap-highlight-color: transparent; }
    .rv-voltar .icone.redondo { width: 40px; height: 40px; flex: none; }
    .rv-voltar .icone.redondo svg { width: 22px; height: 22px; }
    .rv-voltar .rv-rot { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rv-voltar:active .icone.redondo { scale: .94; }
    .rv-voltar:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; }
    /* a tela de baixo já cuida do topo: sem o espaço do entalhe duas vezes, e o título encosta no botão */
    .rv-com .ag-barra { padding-top: 4px; min-height: 56px; }
    .rv-com > .painel { padding-top: 6px; }
    .rv-com > .painel.ag-caixa { padding-top: 0; }
  }
  /* arrastar da borda (fluidez.js): a tela de onde veio aparece por baixo */
  @media (max-width: 760px) {
    .area > .vista.fz-baixo { display: flex; position: absolute; z-index: 0; pointer-events: none; }
    .area > .vista.fz-cima { position: relative; z-index: 1; box-shadow: -12px 0 32px rgba(4, 18, 31, .18); background: var(--fundo, #f4f7fb); background-image: var(--aurora, none); }
  }`;
  if (!$('voltar-celular-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'voltar-celular-css', textContent: CSS }));
  const SETA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';

  function tirarBotoes(exceto) {
    document.querySelectorAll('.area > .vista > .rv-topo').forEach((t) => { if (t.parentElement !== exceto) { t.parentElement.classList.remove('rv-com'); t.remove(); } });
  }
  function acenderAba(o) {
    if (!celular() || ABAS.has(estado.vista)) return;
    const navs = [...document.querySelectorAll('.trilho .nav[data-vista]')];
    if (navs.some((b) => b.getAttribute('aria-current') === 'page')) return;
    const aba = o?.aba && ABAS.has(o.aba) ? o.aba : DE_CONVERSAS.has(estado.vista) ? 'conversas' : 'configuracoes';
    navs.find((b) => b.dataset.vista === aba)?.setAttribute('aria-current', 'page');
  }
  function atualizar() {
    const v = estado.vista;
    const s = $('v-' + v);
    const o = origemAtual();
    if (!dentro(v, o)) { tirarBotoes(null); acenderAba(o); return; }
    tirarBotoes(s);
    let topo = s.querySelector(':scope > .rv-topo');
    if (!topo) {
      const bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'rv-voltar';
      bt.innerHTML = `<span class="icone redondo">${SETA}</span><span class="rv-rot"></span>`;
      bt.addEventListener('click', () => voltar());
      topo = document.createElement('div'); topo.className = 'rv-topo'; topo.append(bt);
      s.prepend(topo);
    }
    const nome = o?.titulo || 'Configurações';
    topo.querySelector('.rv-rot').textContent = nome;
    topo.firstChild.setAttribute('aria-label', 'Voltar para ' + nome);
    s.classList.add('rv-com');
    acenderAba(o);
  }

  // ------------------------------------------------------------------ voltar
  let animarVolta = 0;
  function voltar(op = {}) {
    if (!op.arrastou && !reduzido()) animarVolta = Date.now();
    return R()?.voltar?.() ?? false;
  }
  /** Reabre o que estava aberto na entrada para onde a pessoa voltou (área de Configurações e rolagens). */
  function reabrir(m) {
    if (!m || !celular()) return;
    const rolar = () => { const r = rolador(estado.vista); if (r && m.rolagem && m.vista === estado.vista) r.scrollTop = m.rolagem; };
    rolar(); requestAnimationFrame(rolar);
    if (!m.painel?.id || estado.vista !== 'configuracoes' || window.SintoniaPainel?.aberto?.()) return;
    let ok = false;
    try { ok = window.SintoniaConfigArea?.(m.painel.id) ?? false; } catch (x) { console.error(x); }
    if (!ok) { // sem o gancho: toca no botão da área com o mesmo nome
      const b = [...document.querySelectorAll('#configuracoes .cfg-area')].find((x) => x.querySelector('b')?.textContent === m.painel.titulo);
      if (b) { b.click(); ok = true; }
    }
    const P = window.SintoniaPainel;
    if (!ok || !P?.aberto?.()) return;
    const pag = P.atual();
    if (pag?.corpo && m.painel.rolagem) { pag.corpo.scrollTop = m.painel.rolagem; requestAnimationFrame(() => { pag.corpo.scrollTop = m.painel.rolagem; }); }
    // voltar não "entra pela direita": o painel já está no lugar e a página chega de leve pela esquerda (como no iPhone)
    const d = P.elemento?.();
    if (d && pag?.el) {
      d.style.transition = 'none'; d.classList.add('ver'); void d.offsetWidth;
      requestAnimationFrame(() => { d.style.transition = ''; });
      if (!reduzido()) {
        pag.el.style.transition = 'none'; pag.el.classList.add('atras'); void pag.el.offsetWidth; pag.el.style.transition = '';
        requestAnimationFrame(() => pag.el.classList.remove('atras'));
      }
    }
    animarVolta = 0;
  }

  // ------------------------------------------------------------------ troca de tela: botão, aba acesa e animação de volta
  let ativa = document.querySelector('.area > .vista.ativa');
  const aoTrocar = () => {
    const agora = document.querySelector('.area > .vista.ativa');
    if (agora === ativa) return;
    ativa = agora;
    atualizar();
    if (animarVolta && Date.now() - animarVolta < 900 && agora && celular() && !window.SintoniaPainel?.aberto?.()) {
      try { agora.animate([{ transform: 'translate3d(-14%,0,0)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }); } catch {}
    }
    animarVolta = 0;
  };
  const obs = new MutationObserver(aoTrocar);
  document.querySelectorAll('.area > .vista').forEach((s) => obs.observe(s, { attributes: true, attributeFilter: ['class'] }));
  let largo = !celular();
  addEventListener('resize', () => { if (largo !== !celular()) { largo = !celular(); atualizar(); } });

  window.SintoniaVoltar = { saida, reabrir, voltar, dentro: () => dentro(), destino, atualizar, guardar, origem: origemAtual };
  setTimeout(atualizar, 0);
})();
