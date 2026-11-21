/* rotas-fontes: endereços organizados do app (window.SintoniaRotas).
 *   Cada tela tem um endereço próprio, em português e estável: /app/dashboard, /app/conversas, /app/conversas/<id>,
 *   /app/pipelines/<funilId>, /app/clientes, /app/agenda, /app/analises/<aba>, /app/configuracoes…
 *   - Trocar de tela = uma entrada nova no histórico (pushState); voltar/avançar do navegador e o voltar do Android
 *     andam pelas telas (popstate). Voltar com uma conversa aberta fecha a conversa (não sai do app).
 *   - Recarregar a página mantém a tela; link direto abre a tela (o servidor serve o app.html para /app/*).
 *   - Links antigos continuam valendo: /app#vista=chat-equipe, /app#conversa=<id>, /app#criativos.
 *   - O painel lateral (painel-lateral.js) também usa o histórico, na mesma URL: quando o próprio app volta no
 *     histórico (history.back/go), o estado da tela é que vale e o endereço é acertado depois.
 * Os nomes internos das vistas (#v-*) não mudam: CAMINHO faz o mapa vista ⇄ caminho.
 * Ganchos no app.html: mostrar(), abrir() e fecharConversa() chamam SintoniaRotas.mudou(). */
(() => {
  const ui = window.Sintonia?.ui;
  if (!ui || !history.pushState) return;
  const $ = (id) => document.getElementById(id);
  const estado = ui.estado;

  // vista interna → caminho no endereço (o que a pessoa vê)
  const CAMINHO = {
    conversas: 'conversas', funil: 'pipelines', painel: 'dashboard', serena: 'serena', ligacoes: 'ligacoes',
    agenda: 'agenda', clientes: 'clientes', tags: 'tags', respostas: 'respostas-rapidas', reunioes: 'agendamento-online',
    grupos: 'grupos', 'chat-equipe': 'chat-equipe', rotina: 'rotina', scripts: 'scripts',
    automacoes: 'fluxos', bot: 'chatbot', ia: 'agente-ia',
    relatorios: 'relatorios', desempenho: 'desempenho', analises: 'analises', comercial: 'comercial',
    transmissoes: 'transmissoes', email: 'email-marketing', links: 'rastreamento', criativos: 'criativos',
    acessos: 'acessos', empresa: 'empresa', planos: 'plano', equipe: 'equipe', configuracoes: 'configuracoes',
    conta: 'conta', agendadas: 'mensagens-agendadas', integracoes: 'integracoes', // telas que chegaram junto (empresa-conta, msg-agendada, integracoes)
  };
  const VISTA = {};
  for (const [v, c] of Object.entries(CAMINHO)) { VISTA[c] = v; if (!VISTA[v]) VISTA[v] = v; }
  Object.assign(VISTA, { inicio: 'painel', crm: 'funil', funil: 'funil', vendas: 'funil', pipeline: 'funil', 'agente-de-ia': 'ia',
    respostas: 'respostas', relatorio: 'relatorios', atendimento: 'desempenho', mais: 'configuracoes',
    'email': 'email', importar: 'leads', leads: 'leads' });
  const ABAS_CLIENTES = new Set(['clientes', 'empresas', 'importar', 'exportar']);

  const celular = () => innerWidth <= 760;
  const T = () => window.SintoniaTelas || {};
  /** Conversa aberta na tela agora (no celular só conta se está na frente da lista). */
  function conversaAberta() {
    if (estado.vista !== 'conversas' || !estado.aberta) return null;
    if (celular() && !$('v-conversas')?.classList.contains('abrindo')) return null;
    return String(estado.aberta);
  }
  const limpo = (x) => (x == null ? '' : String(x).slice(0, 120));
  /** Endereço da tela que está aberta. */
  function caminhoAtual() {
    const v = estado.vista;
    let sub = '';
    if (v === 'conversas') sub = conversaAberta() || '';
    else if (v === 'funil') { try { sub = limpo(T().funil?.atual?.()); } catch {} }
    else if (v === 'analises') { try { sub = limpo(T().analises?.aba?.()); } catch {} }
    else if (v === 'automacoes') { try { sub = limpo(T().automacoes?.aba?.()); } catch {} } // atendimento-extra: /app/fluxos/follow-up
    return '/app/' + (CAMINHO[v] || encodeURIComponent(v)) + (sub ? '/' + encodeURIComponent(sub) : '');
  }
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return ''; } };
  /** Lê o endereço: { vista, sub } (vista null = /app puro ou desconhecido). */
  function lerCaminho(p = location.pathname) {
    const partes = p.replace(/^\/app\/?/, '').split('/').filter(Boolean).map(dec);
    if (!partes.length) return { vista: null, sub: '' };
    let vista = VISTA[partes[0]] || null;
    let sub = (partes[1] || '').slice(0, 120);
    if (vista === 'leads') { vista = 'clientes'; sub = 'importar'; }
    if (vista === 'clientes' && sub && !ABAS_CLIENTES.has(sub)) sub = '';
    return { vista, sub };
  }
  /** Links antigos: #vista=…, #conversa=…, #criativos. Devolve null se não for um deles. */
  function lerHashAntigo() {
    const h = location.hash.slice(1);
    if (!h) return null;
    if (h === 'criativos') return { vista: 'criativos', sub: '' };
    const q = new URLSearchParams(h);
    const id = q.get('conversa'), v = q.get('vista');
    if (id) return { vista: 'conversas', sub: id.slice(0, 120) };
    if (v && !v.startsWith('conexoes')) { const r = lerCaminho('/app/' + v); return r.vista ? r : { vista: v, sub: '' }; }
    return null;
  }

  // ---------------------------------------------------------------- voltas do próprio app no histórico
  // O painel lateral e este arquivo voltam no histórico para desfazer entradas (fechar painel, fechar conversa).
  // Enquanto essa volta não termina, o estado da tela é que vale: nada de aplicar o endereço velho por cima.
  let pendentes = 0, atrasado = false, tempo = 0;
  const hb = history.back.bind(history), hg = history.go.bind(history);
  const contar = () => { pendentes++; clearTimeout(tempo); tempo = setTimeout(() => { pendentes = 0; if (atrasado) { atrasado = false; mudou(); } }, 1200); };
  try {
    history.back = () => { contar(); hb(); };
    history.go = (n) => { if (n) contar(); hg(n); };
  } catch { /* navegador não deixa trocar: segue sem a proteção */ }

  let pronto = false, aplicando = false;
  const marca = (anterior) => ({ ...(history.state && typeof history.state === 'object' ? history.state : {}), sintoniaRota: 1, rotaAnterior: anterior });
  function trocarEndereco(novo, empurrar) {
    if (novo === location.pathname) return;
    try {
      if (empurrar) history.pushState({ sintoniaRota: 1, rotaAnterior: location.pathname }, '', novo); // entrada nova: sem o estado do painel
      else history.replaceState(marca(history.state?.rotaAnterior), '', novo + location.search + location.hash);
    } catch {}
  }

  /** A tela mudou (mostrar, abrir conversa, fechar conversa, clique numa aba): o endereço acompanha.
   *  op.fechar: fechou a conversa — se a entrada anterior é a lista, volta nela (não empilha). */
  function mudou(op = {}) {
    if (!pronto || aplicando) return;
    if (pendentes > 0) { atrasado = true; return; }
    const novo = caminhoAtual();
    if (novo === location.pathname) return;
    const st = history.state || {};
    if (op.fechar && st.sintoniaRota && !st.sintoniaPainel && st.rotaAnterior === novo) { contar(); atrasado = true; hb(); return; }
    trocarEndereco(novo, !op.trocar);
  }

  /** Mostra a tela pedida pelo endereço (recarregar, link direto, voltar/avançar). */
  function aplicar(r) {
    if (!r?.vista) return;
    aplicando = true;
    try {
      const t = T();
      if (r.vista === 'funil' && r.sub) t.funil?.abrirFunil?.(r.sub);
      if (r.vista === 'analises' && r.sub && r.sub !== t.analises?.aba?.()) t.analises?.focar?.(r.sub);
      if (r.vista === 'clientes' && r.sub) t.clientes?.irAba?.(r.sub);
      if (r.vista === 'automacoes') t.automacoes?.irAba?.(r.sub || 'fluxos', false); // atendimento-extra
      if (r.vista !== estado.vista || (r.sub && r.vista !== 'conversas') || r.vista === 'automacoes') ui.mostrar(r.vista);
      if (r.vista === 'conversas') {
        const aberta = conversaAberta();
        if (r.sub && r.sub !== aberta) ui.abrir(r.sub);
        else if (!r.sub && aberta) {
          if (celular()) $('voltar')?.click();
          else ui.fecharConversa?.();
        }
      }
    } catch (x) { console.error(x); } finally { aplicando = false; }
    // a tela pode ter ido para outro lugar (ex.: atendente não configura a IA → Serena): o endereço acompanha
    setTimeout(() => { if (!pendentes) trocarEndereco(caminhoAtual(), false); }, 0);
  }

  addEventListener('popstate', (e) => {
    if (!pronto) return;
    if (pendentes > 0) {
      pendentes--;
      if (!pendentes) clearTimeout(tempo);
      setTimeout(() => { if (!pendentes) { atrasado = false; mudou(); } }, 0);
      return;
    }
    if (e.state?.sintoniaPainel && window.SintoniaPainel?.aberto?.()) return; // o painel cuida das próprias páginas
    const r = lerCaminho();
    if (!r.vista) { setTimeout(() => trocarEndereco(caminhoAtual(), false), 0); return; }
    aplicar(r);
  });

  // Voltar da conversa (seta, arrastar da borda no celular): fecha sem empilhar outra entrada.
  $('voltar')?.addEventListener('click', () => mudou({ fechar: true }));
  // Abas dentro da tela (pipeline escolhido, aba das Análises): mudam no clique, o endereço vem logo depois.
  const depois = () => setTimeout(() => mudou(), 0);
  document.addEventListener('click', depois, true);
  document.addEventListener('change', depois, true);
  // O que muda sozinho (ex.: pipeline padrão carregado): acerta o endereço sem criar entrada nova.
  setInterval(() => { if (pronto && !pendentes && !aplicando && !document.hidden) mudou({ trocar: true }); }, 1500);

  // ---------------------------------------------------------------- abertura
  const r0 = lerHashAntigo() || lerCaminho();
  const doHash = !!lerHashAntigo();
  if (doHash) { try { history.replaceState(history.state, '', location.pathname + location.search); } catch {} } // o link antigo é tratado aqui
  (async () => {
    // espera o app saber quem entrou (a tela da IA, por exemplo, muda conforme o papel)
    for (let i = 0; i < 80 && !estado.eu; i++) await new Promise((ok) => setTimeout(ok, 100));
    if (r0.vista) aplicar(r0);
    pronto = true;
    setTimeout(() => {
      try { history.replaceState(marca(history.state?.rotaAnterior), '', caminhoAtual() + location.search + location.hash); } catch {}
    }, 0);
  })();

  window.SintoniaRotas = { mudou, caminho: caminhoAtual, ler: lerCaminho, CAMINHO, ir: (caminho) => { const r = lerCaminho(caminho); if (r.vista) { aplicar(r); setTimeout(() => mudou(), 0); } } };
})();
