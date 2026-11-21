/* Topo da conversa aberta no jeito do WhatsApp Web (dono 21/11): Vídeo, Ligar, Agendar, Pesquisar e ⋯.
 * - Vídeo: abre a conversa no WhatsApp (lá é só tocar na câmera) ou cria uma sala de vídeo grátis e põe o link no campo.
 * - Pesquisar: procura em TODAS as mensagens da conversa (GET /api/conversas/:id/busca), não só nas que estão na tela.
 * - ⋯: o que a Sintonia já faz com uma conversa — ficha, radar, atendimento e IA, atribuir, etapa, tarefa, favorito,
 *   silenciar, arquivar, papel de parede, exportar (.txt), finalizar e fechar.
 * O Radar saiu do topo e foi para o ⋯ (a faixa do radar continua aparecendo embaixo do topo). O "Ocultar dados" mora em
 * Conta › Privacidade. Usa window.Sintonia.ui; texto vindo do servidor entra sempre por textContent. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, el, toast, estado } = ui;
  const $ = (id) => document.getElementById(id);
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const SVG = {
    video: ic('<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>'),
    lupa: ic('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
    pontos: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/></svg>',
    ficha: ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
    radar: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" opacity=".5"/><path d="M12 12 18.2 5.8"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>'),
    ia: ic('<path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7L12 3.5Z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>'),
    atribuir: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M17 8.5h5M19.5 6v5"/>'),
    etapa: ic('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>'),
    tarefa: ic('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    estrela: ic('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/>'),
    papel: ic('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="m4 16 4.5-4.5 3.5 3.5 2.5-2.5L20 18"/><circle cx="15.5" cy="8.5" r="1.6"/>'),
    baixar: ic('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
    finalizar: ic('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>'),
    fechar: ic('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
    x: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    cima: ic('<path d="m6 15 6-6 6 6"/>'),
    zap: ic('<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7Z"/><path d="M9.5 9.5c.3 1.6 1.5 3.6 4 4.6l1.2-1.1 1.8.8-.4 1.7c-3.6.2-7.2-3.4-7.3-7l1.7-.4.8 1.8Z"/>'),
    link: ic('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  };

  const CSS = `
  #chat-aberto .pilula-topo .tc-sep { width: 1px; height: 20px; background: var(--linha); margin: 0 2px; flex: none; }
  #chat-aberto .pilula-topo .icone[aria-expanded="true"] { background: var(--vidro-item, var(--hover)); }
  #topo-radar { display: none !important; }
  @media (max-width: 760px) {
    #topo-pesquisar, #chat-aberto .pilula-topo .tc-sep { display: none !important; }
    #chat-aberto .pilula-topo .icone { width: 36px !important; height: 38px !important; }
    #chat-aberto .pilula-topo .icone svg { width: 21px !important; height: 21px !important; }
  }
  .menu-lista.tc-menu { position: fixed; top: 0; left: auto; right: auto; z-index: 60; min-width: 250px; max-width: calc(100vw - 24px);
    overflow-y: auto; overscroll-behavior: contain; padding: 6px; border-radius: 18px; gap: 0; }
  .menu-lista.tc-menu button { min-height: 42px; font-size: 14.5px; font-weight: 500; gap: 12px; padding: 0 12px; border-radius: 12px; }
  .menu-lista.tc-menu svg { width: 20px; height: 20px; }
  .menu-lista.tc-menu hr { border: 0; height: 1px; background: var(--linha); margin: 4px 8px; }
  .menu-lista.tc-menu .tc-so-cel { display: none; }
  @media (max-width: 760px) { .menu-lista.tc-menu .tc-so-cel { display: flex; } }
  .menu-lista.tc-menu small { display: block; font-size: 12px; font-weight: 400; color: var(--sub); margin-top: 1px; }
  .menu-lista.tc-menu .tc-txt { display: grid; padding: 6px 0; }

  /* Pesquisar dentro da conversa */
  .tc-busca { position: relative; z-index: 5; margin: 0 12px 6px; padding: 8px; border-radius: 18px; background: var(--painel);
    border: 1px solid var(--linha); box-shadow: 0 8px 28px rgba(13,34,64,.12); display: grid; gap: 6px; }
  .tc-busca[hidden] { display: none; }
  .tc-busca .tc-linha { display: flex; align-items: center; gap: 6px; }
  .tc-busca .tc-campo { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 12px; background: var(--vidro-item, var(--hover)); }
  .tc-busca .tc-campo svg { width: 18px; height: 18px; color: var(--sub); flex: none; }
  .tc-busca input { all: unset; flex: 1; min-width: 0; font-size: 15px; color: var(--texto); }
  .tc-busca .tc-qtd { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .tc-busca .icone { width: 38px; height: 38px; border-radius: 12px; flex: none; color: var(--texto); }
  .tc-busca .icone svg { width: 20px; height: 20px; }
  .tc-busca .tc-res { max-height: min(46vh, 380px); overflow-y: auto; overscroll-behavior: contain; display: grid; gap: 2px; }
  .tc-busca .tc-res:empty { display: none; }
  .tc-busca .tc-item { all: unset; cursor: pointer; display: grid; gap: 2px; padding: 8px 10px; border-radius: 12px; }
  .tc-busca .tc-item:hover, .tc-busca .tc-item:focus-visible { background: var(--vidro-item, var(--hover)); }
  .tc-busca .tc-item small { font-size: 12px; color: var(--sub); }
  .tc-busca .tc-item span { font-size: 14px; color: var(--texto); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .tc-busca mark { background: color-mix(in srgb, #0ffcbe 55%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
  .tc-busca .tc-vazio { font-size: 13.5px; color: var(--sub); padding: 6px 10px 4px; }
  #msgs .bal.tc-achada { outline: 2px solid #0ffcbe; outline-offset: 2px; transition: outline-color .6s; }
  #msgs .bal.tc-achada.tc-apagando { outline-color: transparent; }
  html[data-tema="claro"] #msgs .bal.tc-achada { outline-color: #106ebe; }
  `;
  document.head.append(Object.assign(document.createElement('style'), { id: 'tc-css', textContent: CSS }));

  const conversaAberta = () => estado.detalhe?.conversa || null;
  const daLista = (c) => (estado.conversas || []).find((x) => x.id === c.id) || c;
  const soNumeros = (t) => String(t || '').replace(/\D/g, '');
  const gestos = () => window.SintoniaTelas?.conversasGestos;
  /* quem não tem a permissão "exportar" (atendentes) não vê o Exportar conversa */
  let permissoes = null; api('/api/auth/eu').then((eu) => { permissoes = eu?.permissoes || null; }).catch(() => {});

  // ------------------------------------------------------------ botões do topo
  function botao(id, titulo, svg, onclick) {
    const b = el('button', { type: 'button', class: 'icone', id, title: titulo, 'aria-label': titulo, html: svg });
    b.addEventListener('click', onclick);
    return b;
  }
  let montado = false;
  function montar() {
    const pilula = document.querySelector('#chat-aberto .pilula-topo');
    const ligar = $('topo-ligar'), agendar = $('topo-agendar');
    if (montado || !pilula || !ligar || !agendar) return;
    montado = true;
    const video = botao('topo-video', 'Chamada de vídeo', SVG.video, (e) => abrirVideo(e.currentTarget));
    const pesquisar = botao('topo-pesquisar', 'Pesquisar na conversa', SVG.lupa, () => abrirBusca());
    const mais = botao('topo-mais', 'Mais opções', SVG.pontos, (e) => { e.stopPropagation(); alternarMenu(e.currentTarget); });
    mais.setAttribute('aria-haspopup', 'menu'); mais.setAttribute('aria-expanded', 'false');
    const sep = el('span', { class: 'tc-sep', 'aria-hidden': 'true' });
    pilula.append(video, ligar, agendar, pesquisar, sep, mais);
    // sem telefone não há ligação nem vídeo: o vídeo some junto com o Ligar
    const espelhar = () => { video.hidden = ligar.hidden; };
    espelhar(); new MutationObserver(espelhar).observe(ligar, { attributes: true, attributeFilter: ['hidden'] });
  }

  // ------------------------------------------------------------ vídeo
  function abrirVideo(ancora) {
    const c = conversaAberta(); if (!c) return;
    const num = soNumeros(c.telefone);
    abrirMenu(ancora, [
      { svg: SVG.zap, texto: 'Pelo WhatsApp', sub: 'Abre a conversa dela no WhatsApp; lá, toque na câmera', fazer: () => { if (num) window.open(`https://wa.me/${num}`, '_blank', 'noopener'); } },
      { svg: SVG.link, texto: 'Mandar link de vídeo', sub: 'Cria uma sala grátis e põe o link no campo de mensagem', fazer: () => linkDeVideo(c) },
    ], 'Chamada de vídeo');
  }
  function linkDeVideo(c) {
    const letras = 'abcdefghijkmnpqrstuvwxyz23456789';
    const sorteio = Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => letras[n % letras.length]).join('');
    const url = `https://meet.jit.si/Sintonia-${sorteio}`;
    const primeiro = String(ui.nomeDe?.(c) || '').trim().split(/\s+/)[0] || '';
    ui.usarTexto?.(`${primeiro ? primeiro + ', v' : 'V'}amos conversar por vídeo? É só tocar no link: ${url}`);
    window.open(url, '_blank', 'noopener');
    toast('A sala abriu em outra aba. O link está no campo: é só enviar.');
  }

  // ------------------------------------------------------------ menu ⋯ (e o do vídeo)
  let menuAberto = null, ancoraAberta = null;
  function fecharMenu() {
    menuAberto?.remove(); menuAberto = null;
    ancoraAberta?.setAttribute('aria-expanded', 'false'); ancoraAberta = null;
  }
  function alternarMenu(ancora) { if (menuAberto && ancoraAberta === ancora) return fecharMenu(); abrirMenu(ancora, itensDoMenu(), 'Opções da conversa'); }
  function abrirMenu(ancora, itens, rotulo) {
    fecharMenu();
    const m = el('div', { class: 'menu-lista tc-menu', role: 'menu', 'aria-label': rotulo });
    for (const it of itens) {
      if (it === '-') { m.append(el('hr')); continue; }
      const b = el('button', { type: 'button', role: 'menuitem', html: it.svg, class: it.soCel ? 'tc-so-cel' : '' });
      const t = el('span', { class: it.sub ? 'tc-txt' : '' }, document.createTextNode(it.texto));
      if (it.sub) t.append(el('small', { text: it.sub }));
      b.append(t);
      b.addEventListener('click', () => { fecharMenu(); setTimeout(it.fazer, 30); });
      m.append(b);
    }
    document.body.append(m);
    const r = ancora.getBoundingClientRect();
    const larg = m.offsetWidth;
    m.style.top = `${Math.round(r.bottom + 6)}px`;
    m.style.left = `${Math.round(Math.max(12, Math.min(r.right - larg, innerWidth - larg - 12)))}px`;
    m.style.maxHeight = `${Math.max(200, innerHeight - r.bottom - 18)}px`;
    menuAberto = m; ancoraAberta = ancora; ancora.setAttribute('aria-expanded', 'true');
    m.querySelector('button')?.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', (e) => {
    if (menuAberto && !menuAberto.contains(e.target) && !ancoraAberta?.contains(e.target)) fecharMenu();
  }, true);
  addEventListener('resize', fecharMenu);
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menuAberto) { e.preventDefault(); const a = ancoraAberta; fecharMenu(); a?.focus(); return; }
    if (busca && !busca.hidden) { e.preventDefault(); fecharBusca(); }
  }, true);

  function itensDoMenu() {
    const c = conversaAberta(); if (!c) return [];
    const T = window.SintoniaTelas || {};
    const G = gestos();
    const viaGestos = (acao) => () => G?.fazer?.(acao, c.id);
    const extra = window.SintoniaConversaExtra;
    const fav = $('f-favorito');
    const favorita = fav?.getAttribute('aria-pressed') === 'true';
    const noRadar = Boolean(T.radar?.tem?.(c.id));
    return [
      { svg: SVG.ficha, texto: 'Dados do contato', fazer: () => ui.abrirFicha?.() },
      { svg: SVG.lupa, texto: 'Pesquisar', soCel: true, fazer: () => abrirBusca() },
      T.radar && G && { svg: SVG.radar, texto: noRadar ? 'Tirar do radar' : 'Colocar no radar', fazer: viaGestos('radar') },
      window.SintoniaConversa?.abrirMenuIa && { svg: SVG.ia, texto: 'Atendimento e IA', fazer: () => window.SintoniaConversa.abrirMenuIa() },
      G && { svg: SVG.atribuir, texto: 'Atribuir a alguém', fazer: viaGestos('atribuir') },
      G && { svg: SVG.etapa, texto: 'Mover de etapa', fazer: viaGestos('mover') },
      G && T.rotina?.novaTarefa && { svg: SVG.tarefa, texto: 'Criar tarefa', fazer: viaGestos('tarefa') },
      fav && { svg: SVG.estrela, texto: favorita ? 'Tirar dos favoritos' : 'Adicionar aos favoritos', fazer: () => fav.click() },
      '-',
      ...((extra?.acoes?.(daLista(c)) || []).map((o) => ({ svg: o.svg, texto: o.texto, fazer: () => extra.fazer(o.acao, daLista(c)) }))),
      window.SintoniaPapelParede && { svg: SVG.papel, texto: 'Papel de parede', fazer: () => window.SintoniaPapelParede.abrir() },
      (!permissoes || permissoes.exportar) && { svg: SVG.baixar, texto: 'Exportar conversa', fazer: () => exportar(c) },
      '-',
      G && T.nps?.finalizarNaConversa && { svg: SVG.finalizar, texto: 'Finalizar atendimento', fazer: viaGestos('finalizar') },
      { svg: SVG.fechar, texto: 'Fechar conversa', fazer: () => ui.fecharConversa?.() },
    ].filter(Boolean);
  }

  async function exportar(c) {
    try {
      const r = await fetch(`/api/conversas/${encodeURIComponent(c.id)}/exportar`, { credentials: 'same-origin' });
      if (!r.ok) { const j = await r.json().catch(() => null); throw new Error(j?.erro || j?.message || 'Não deu para exportar agora.'); }
      const blob = await r.blob();
      const nome = `Conversa ${String(ui.nomeDe?.(c) || 'cliente')}`.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) + '.txt';
      const a = el('a', { href: URL.createObjectURL(blob), download: nome });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Conversa exportada.');
    } catch (x) { toast(x.message || 'Não deu para exportar agora.'); }
  }

  // ------------------------------------------------------------ pesquisar na conversa
  let busca = null, campo = null, res = null, qtd = null, pedido = 0, espera = null;
  function montarBusca() {
    if (busca) return;
    campo = el('input', { type: 'search', placeholder: 'Pesquisar mensagens', 'aria-label': 'Pesquisar mensagens desta conversa', autocomplete: 'off', enterkeyhint: 'search' });
    qtd = el('span', { class: 'tc-qtd', 'aria-live': 'polite' });
    res = el('div', { class: 'tc-res', role: 'list' });
    const fechar = el('button', { type: 'button', class: 'icone', title: 'Fechar a pesquisa', 'aria-label': 'Fechar a pesquisa', html: SVG.x });
    fechar.addEventListener('click', fecharBusca);
    busca = el('div', { class: 'tc-busca', role: 'search', hidden: '' },
      el('div', { class: 'tc-linha' }, el('label', { class: 'tc-campo', html: SVG.lupa }, campo, qtd), fechar), res);
    campo.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(pesquisar, 220); });
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(espera); pesquisar().then(() => res.querySelector('.tc-item')?.click()); } });
    const topo = document.querySelector('#chat-aberto .chat-topo') || document.querySelector('#chat-aberto header');
    topo?.after(busca);
  }
  function abrirBusca() {
    if (!conversaAberta()) return;
    montarBusca();
    busca.hidden = false; $('topo-pesquisar')?.setAttribute('aria-expanded', 'true');
    campo.focus(); campo.select();
    if (campo.value.trim().length >= 2) pesquisar();
  }
  function fecharBusca() {
    if (!busca) return;
    busca.hidden = true; campo.value = ''; res.replaceChildren(); qtd.textContent = '';
    $('topo-pesquisar')?.setAttribute('aria-expanded', 'false');
  }
  function comDestaque(texto, termo) {
    const s = el('span');
    const baixo = texto.toLocaleLowerCase('pt-BR'), t = termo.toLocaleLowerCase('pt-BR');
    // começa um pouco antes da primeira ocorrência, para a parte achada aparecer
    let ini = Math.max(0, baixo.indexOf(t) - 40); if (ini > 0) { const esp = texto.indexOf(' ', ini); ini = esp > 0 && esp < ini + 15 ? esp + 1 : ini; }
    let i = ini;
    if (ini > 0) s.append('… ');
    while (i < texto.length) {
      const k = baixo.indexOf(t, i);
      if (k < 0) { s.append(texto.slice(i)); break; }
      s.append(texto.slice(i, k), el('mark', { text: texto.slice(k, k + t.length) }));
      i = k + t.length;
    }
    return s;
  }
  const dataCurta = (em) => {
    const d = new Date(em), hoje = new Date();
    const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === hoje.toDateString()) return `Hoje, ${hm}`;
    return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: d.getFullYear() === hoje.getFullYear() ? undefined : '2-digit' })}, ${hm}`;
  };
  async function pesquisar() {
    const c = conversaAberta(); const termo = campo.value.trim();
    if (!c || termo.length < 2) { res.replaceChildren(); qtd.textContent = ''; return; }
    const meu = ++pedido;
    let d; try { d = await api(`/api/conversas/${encodeURIComponent(c.id)}/busca?q=${encodeURIComponent(termo)}`); } catch (x) { if (meu === pedido) { res.replaceChildren(el('div', { class: 'tc-vazio', text: x.message || 'Não deu para pesquisar agora.' })); } return; }
    if (meu !== pedido) return;
    const lista = d.resultados || [];
    qtd.textContent = lista.length ? (lista.length >= 50 ? '50+ achadas' : `${lista.length} ${lista.length === 1 ? 'achada' : 'achadas'}`) : '';
    if (!lista.length) { res.replaceChildren(el('div', { class: 'tc-vazio', text: 'Nenhuma mensagem com esse texto.' })); return; }
    res.replaceChildren(...lista.map((m) => {
      const quem = m.autor === 'cliente' ? (ui.nomeDe?.(c) || 'Cliente') : m.autor === 'ia' ? 'IA' : m.autor === 'equipe' ? (m.autorNome || 'Equipe') : 'Sistema';
      const b = el('button', { type: 'button', class: 'tc-item', role: 'listitem' }, el('small', { text: `${dataCurta(m.em)} · ${quem}` }), comDestaque(String(m.texto || ''), termo));
      b.addEventListener('click', () => irPara(m.id));
      return b;
    }));
  }
  function irPara(id) {
    const bal = [...document.querySelectorAll('#msgs .bal')].find((b) => b.dataset.id === id);
    if (!bal) { toast('Essa mensagem é mais antiga do que as que estão na tela. O texto e a data estão aqui na pesquisa.'); return; }
    if (matchMedia('(max-width: 760px)').matches) fecharBusca();
    bal.scrollIntoView({ block: 'center', behavior: 'smooth' });
    bal.classList.remove('tc-apagando'); bal.classList.add('tc-achada');
    setTimeout(() => bal.classList.add('tc-apagando'), 1600);
    setTimeout(() => bal.classList.remove('tc-achada', 'tc-apagando'), 2400);
  }
  // trocou ou fechou a conversa: a pesquisa e o menu fecham
  let ultima = null;
  setInterval(() => { const id = estado.aberta || null; if (id !== ultima) { ultima = id; fecharMenu(); fecharBusca(); } }, 400);

  montar(); addEventListener('DOMContentLoaded', montar, { once: true }); setTimeout(montar, 1200);
  window.SintoniaTopoConversa = { abrirBusca, fecharBusca, abrirMenu: () => $('topo-mais') && alternarMenu($('topo-mais')) };
})();
