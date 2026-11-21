/* Conversas de grupo (Conversas › Conversas de grupo): só os grupos do WhatsApp (API não oficial).
 * Registra window.SintoniaTelas.grupos = { desenhar(caixa, ui) }. Servidor: src/grupos (rotas /api/grupos/...).
 * Grupo não é conversa de cliente: sem IA, funil, alarme nem "esperando resposta".
 * Computador: lista à esquerda e o chat à direita (mesmo visual de Conversas). Celular: lista em tela cheia e o chat por cima.
 * Atualiza sozinho (lista e chat) sem redesenhar tudo. Texto do servidor entra sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  #grupos.painel { padding: 0; gap: 0; display: flex; overflow: hidden; background: var(--fundo); }
  .gp { flex: 1; min-width: 0; min-height: 0; display: flex; }
  .gp .lista-topo .titulo-linha { display: flex; align-items: center; gap: 10px; }
  .gp .lista-topo .titulo-linha h1 { flex: 1; min-width: 0; }
  .gp-sinc { all: unset; cursor: pointer; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--painel); flex: none; }
  .gp-sinc svg { width: 19px; height: 19px; }
  .gp-sinc:disabled { opacity: .5; cursor: default; }
  .gp-sinc.girando svg { animation: gp-girar 1s linear infinite; }
  @keyframes gp-girar { to { transform: rotate(360deg); } }
  .gp .avatar.gp-av { background: var(--boneco-fundo); color: var(--boneco); position: relative; overflow: hidden; }
  .gp .avatar.gp-av svg { width: 56%; height: 56%; }
  .gp .avatar.gp-av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .gp .item .previa b { font-weight: 500; color: var(--texto); }
  /* Arquivadas (como no WhatsApp): linha no topo da lista e a lista própria */
  .gp .avatar.gp-arq-av { background: transparent; color: var(--sub); }
  .gp .avatar.gp-arq-av svg { width: 24px; height: 24px; }
  .gp .item.gp-arq-linha { height: 56px; min-height: 56px; }
  .gp .item.gp-arq-linha .corpo { min-height: 56px; padding-top: 0; padding-bottom: 0; justify-content: center; }
  .gp .item.gp-arq-linha .nome { font-weight: 600; font-size: 16px; }
  .gp .item.gp-arq-linha .hora { color: var(--sub); font-weight: 600; }
  .gp .item.gp-arq-linha .badge { margin-left: 6px; }
  @media (max-width: 760px) {
    .gp .item.gp-arq-linha { align-items: center; min-height: 60px; height: 60px; }
    .gp .item.gp-arq-linha .avatar { margin-top: 0; width: 54px; height: 32px; }
    .gp .item.gp-arq-linha .corpo { min-height: 60px; padding: 0 14px 0 0; }
  }
  .gp-volta-arq { all: unset; cursor: pointer; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--painel); flex: none; }
  .gp-volta-arq svg { width: 22px; height: 22px; }
  .gp-buscando { padding: 2px 16px 8px; font-size: 13px; color: var(--sub); }
  .gp-arq-aviso { padding: 4px 16px 10px; font-size: 13px; line-height: 18px; color: var(--sub); }
  .gp-chat .chat-topo .gp-acao { all: unset; cursor: pointer; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); flex: none; }
  .gp-chat .chat-topo .gp-acao:hover { background: var(--hover); }
  .gp-chat .chat-topo .gp-acao svg { width: 21px; height: 21px; }
  .gp-chat .chat-topo .gp-acao:disabled { opacity: .5; cursor: default; }
  .gp-vazio { padding: 40px 24px; text-align: center; color: var(--sub); font-size: 14px; line-height: 20px; display: grid; gap: 12px; justify-items: center; }
  .gp-vazio b { color: var(--texto); font-weight: 600; font-size: 15px; }
  .gp-chat .chat-topo .quem { cursor: default; }
  .gp-chat .chat-topo .quem span::after { content: none !important; }
  .gp-chat .sem-conversa svg { width: 64px; height: 64px; color: var(--sub); opacity: .6; }
  .gp-chat .sem-conversa b { display: block; color: var(--texto); font-size: 18px; font-weight: 600; margin: 14px 0 6px; }
  .gp-msgs .bal .autor { font-weight: 600; }
  .gp-msgs .gp-antigas { all: unset; cursor: pointer; align-self: center; font-size: 13px; font-weight: 600; color: var(--sub); background: var(--data); box-shadow: var(--sombra); padding: 6px 14px; border-radius: 999px; margin: 6px 0 4px; }
  .gp-msgs .bal img.gp-img { display: block; max-width: min(320px, 100%); max-height: 360px; border-radius: 6px; cursor: zoom-in; background: var(--painel); }
  .gp-msgs .bal.gp-fig { background: transparent; box-shadow: none; }
  .gp-msgs .bal.gp-fig::before { display: none; }
  .gp-msgs .bal.gp-fig img.gp-img { width: 140px; height: 140px; object-fit: contain; background: transparent; cursor: default; }
  .gp-msgs .bal video { display: block; max-width: min(320px, 100%); max-height: 360px; border-radius: 6px; background: #000; }
  .gp-msgs .bal audio { display: block; width: min(280px, 64vw); height: 40px; }
  .gp-msgs .gp-doc { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; background: color-mix(in srgb, var(--texto) 6%, transparent); color: var(--texto); text-decoration: none; min-width: 180px; }
  .gp-msgs .gp-doc svg { width: 26px; height: 26px; flex: none; }
  .gp-msgs .gp-doc span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .gp-msgs .gp-falhou { color: var(--sub); font-style: italic; }
  .gp-msgs .bal .legenda { display: block; padding: 5px 2px 0; }
  .gp-msgs .bal.midia { max-width: min(332px, 85%); }
  .gp .compor .gp-grav { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 4px; }
  .gp .compor .gp-grav .ponto { width: 10px; height: 10px; border-radius: 50%; background: var(--gravando, #e5484d); }
  .gp .compor .gp-grav .relogio { font-size: 16px; font-variant-numeric: tabular-nums; min-width: 44px; }
  .gp .compor .gp-grav .dica { flex: 1; color: var(--sub); font-size: 14px; }
  .gp .compor .gp-enviar { color: #fff !important; background: linear-gradient(135deg, #106ebe, #3aa0ff); border-radius: 50%; width: 40px; height: 40px; }
  .gp .compor .gp-enviar svg { width: 20px; height: 20px; }
  .gp .compor .icone:disabled { opacity: .5; }
  .gp-zoom { position: fixed; inset: 0; z-index: 60; background: rgba(0,0,0,.85); display: grid; place-items: center; cursor: zoom-out; }
  .gp-zoom img { max-width: 94vw; max-height: 90vh; border-radius: 8px; }
  /* cor do nome de cada participante (claro e escuro) */
  .gp-n0 { color: #0a7f6f; } .gp-n1 { color: #1565c0; } .gp-n2 { color: #7048e8; } .gp-n3 { color: #c2410c; }
  .gp-n4 { color: #be185d; } .gp-n5 { color: #2f7d32; } .gp-n6 { color: #9a5b13; } .gp-n7 { color: #0e7490; }
  html[data-tema="escuro"] .gp-n0 { color: #3ddbb9; } html[data-tema="escuro"] .gp-n1 { color: #6cb4ff; }
  html[data-tema="escuro"] .gp-n2 { color: #b39dff; } html[data-tema="escuro"] .gp-n3 { color: #ff9d66; }
  html[data-tema="escuro"] .gp-n4 { color: #ff8fc2; } html[data-tema="escuro"] .gp-n5 { color: #7fd88a; }
  html[data-tema="escuro"] .gp-n6 { color: #f2c063; } html[data-tema="escuro"] .gp-n7 { color: #5fd6ee; }
  @media (max-width: 760px) {
    .gp .gp-chat { display: none; }
    .gp.abrindo .gp-lista { display: none; }
    .gp.abrindo .gp-chat { display: flex; }
    .gp .lista-topo .titulo-linha h1 { position: static; transform: none; }
    .gp .gp-itens { padding-bottom: 96px; }
    .gp .lista-topo { padding-top: 14px; }
  }
  `;

  const ICONE_GRUPO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/></svg>';
  const ICONE_SINC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>';
  const ICONE_VOLTAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 5-7 7 7 7"/></svg>';
  const ICONE_CLIPE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const ICONE_CAMERA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z"/><circle cx="12" cy="12.5" r="3.5"/></svg>';
  const ICONE_MIC = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V5a3.5 3.5 0 1 0-7 0v6a3.5 3.5 0 0 0 3.5 3.5Zm6-3.5a.9.9 0 0 0-1.8 0 4.2 4.2 0 0 1-8.4 0 .9.9 0 0 0-1.8 0 6 6 0 0 0 5.1 5.9V20H8.5a.9.9 0 0 0 0 1.8h7a.9.9 0 0 0 0-1.8h-2.6v-3.1A6 6 0 0 0 18 11Z"/></svg>';
  const ICONE_ENVIAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87Z"/></svg>';
  const ICONE_LIXO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/></svg>';
  const ICONE_ARQUIVO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M10 12.5h4"/></svg>';
  const ICONE_DESARQUIVAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5M12 12v5"/></svg>';
  const ICONE_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg>';
  const CHECK = '<svg viewBox="0 0 16 11" fill="currentColor"><path d="M11.07.65 4.98 8.15 2.7 5.92a.5.5 0 0 0-.7.71l2.67 2.6a.5.5 0 0 0 .73-.04L11.84 1.3a.5.5 0 0 0-.77-.64Zm3.79 0-6.08 7.5-.9-.88-.7.71 1.29 1.25a.5.5 0 0 0 .73-.04L15.63 1.3a.5.5 0 0 0-.77-.64Z"/></svg>';
  const LIMITE = 16 * 1024 * 1024;
  const ROTULO_ANEXO = { imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', documento: 'Documento', figurinha: 'Figurinha' };

  // ---------- estado ----------
  const s = {
    ui: null, caixa: null, raiz: null,
    grupos: [], carregou: false, podeSincronizar: false, busca: '',
    arquivo: false, arquivadas: { total: 0, naoLidas: 0 }, buscando: false,
    aberto: null, msgs: [], mais: false, assinatura: '',
    linhas: new Map(), avatares: new Map(),
    timerLista: 0, timerChat: 0, enviando: false, grav: null,
  };
  const $ = (sel, raiz = s.raiz) => raiz?.querySelector(sel);
  const el = (...a) => s.ui.el(...a);

  let estilo = false;
  function garantirEstilo() {
    if (estilo) return; estilo = true;
    document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  }

  // ---------- utilidades ----------
  const hm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const diaChave = (d) => new Date(d).toDateString();
  function rotuloDia(d) {
    const x = new Date(d), h = new Date(), ontem = new Date(h); ontem.setDate(h.getDate() - 1);
    if (x.toDateString() === h.toDateString()) return 'Hoje';
    if (x.toDateString() === ontem.toDateString()) return 'Ontem';
    return (h - x) < 6 * 864e5 ? x.toLocaleDateString('pt-BR', { weekday: 'long' }) : x.toLocaleDateString('pt-BR');
  }
  const horaLista = (d) => { if (!d) return ''; const r = rotuloDia(d); return r === 'Hoje' ? hm(d) : r; };
  const corDe = (chave) => { let h = 0; for (const ch of String(chave || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return 'gp-n' + (h % 8); };
  const ehCelular = () => matchMedia('(max-width: 760px)').matches;
  const ativa = () => document.getElementById('v-grupos')?.classList.contains('ativa');
  const textoPrevia = (u) => {
    if (!u) return '';
    if (u.anexo && /^\[[^\]]+\]\s*$/.test(u.texto || '')) return ROTULO_ANEXO[u.anexo] || 'Arquivo';
    return String(u.texto || '').replace(/^\[(foto|vídeo|video|áudio|audio|documento|figurinha)[^\]]*\]\s*/i, (m) => (ROTULO_ANEXO[u.anexo] ? ROTULO_ANEXO[u.anexo] + ': ' : m)).replace(/\s+/g, ' ');
  };

  function avatarGrupo(g, classe = '') {
    let a = s.avatares.get(g.id + classe);
    const querFoto = Boolean(g.temFoto);
    if (a && a.dataset.foto === String(querFoto)) return a;
    a = el('span', { class: 'avatar gp-av ' + classe, html: ICONE_GRUPO, 'data-foto': String(querFoto) });
    if (querFoto) {
      const img = el('img', { alt: '', loading: 'lazy', src: `/api/grupos/${g.id}/foto` });
      img.addEventListener('error', () => img.remove());
      a.append(img);
    }
    s.avatares.set(g.id + classe, a);
    return a;
  }

  // ---------- contador do menu ----------
  function atualizarMenu(total) {
    const item = document.getElementById('lt-grupos-wa');
    if (item && item.hidden) item.hidden = false;
    const qtd = document.getElementById('lt-grupos-qtd');
    if (!qtd) return;
    const txt = total > 0 ? String(total > 99 ? '99+' : total) : '';
    if (qtd.textContent !== txt) qtd.textContent = txt;
    if (qtd.hidden !== !txt) qtd.hidden = !txt;
    window.SintoniaAbasConversas?.contar?.('grupos', total);
  }

  async function carregarLista() {
    let r;
    try { r = await (s.ui ? s.ui.api('/api/grupos') : fetch('/api/grupos').then((x) => (x.ok ? x.json() : Promise.reject(x)))); } catch { return; }
    s.grupos = Array.isArray(r.grupos) ? r.grupos : [];
    s.podeSincronizar = Boolean(r.podeSincronizar);
    s.arquivadas = r.arquivadas || { total: 0, naoLidas: 0 };
    s.buscando = Boolean(r.buscando);
    s.carregou = true;
    atualizarMenu(Number(r.naoLidas) || 0);
    if (s.raiz && ativa()) desenharLista();
  }

  // ---------- tela ----------
  function montar() {
    const busca = el('input', { type: 'search', placeholder: 'Pesquisar grupo', 'aria-label': 'Pesquisar grupo' });
    busca.addEventListener('input', () => { s.busca = busca.value.toLowerCase(); desenharLista(); });
    const sinc = el('button', { class: 'gp-sinc', type: 'button', title: 'Buscar grupos do WhatsApp', 'aria-label': 'Buscar grupos do WhatsApp', html: ICONE_SINC, hidden: '' });
    sinc.addEventListener('click', sincronizar);
    const voltaArq = el('button', { class: 'gp-volta-arq', type: 'button', title: 'Voltar aos grupos', 'aria-label': 'Voltar aos grupos', html: ICONE_VOLTAR, hidden: '' });
    voltaArq.addEventListener('click', () => trocarArquivo(false));
    /* topo-lista: no celular, a mesma barra de cima de Conversas (⋯ com as opções, lua e sino) */
    const barraCima = window.SintoniaTopoLista?.({ menu: [
      { id: 'sinc', nome: 'Buscar grupos do WhatsApp', ic: ICONE_SINC, acao: sincronizar },
      { id: 'arq', nome: 'Grupos arquivados', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/></svg>', acao: () => trocarArquivo(true) },
    ] });
    const topo = el('div', { class: 'lista-topo' }, barraCima || null,
      el('div', { class: 'titulo-linha' }, voltaArq, el('h1', { class: 'titulo-grande gp-titulo', text: 'Grupos' }), sinc),
      el('div', { class: 'linha-busca' }, el('label', { class: 'busca' }, Object.assign(el('span'), { innerHTML: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }).firstChild, busca)));
    const abas = window.SintoniaAbasConversas?.barra?.('grupos');
    if (abas) topo.querySelector(':scope > .titulo-linha').after(abas);
    const lista = el('div', { class: 'lista gp-lista' }, topo,
      el('div', { class: 'gp-arq-aviso', hidden: '', text: 'Grupos arquivados ficam aqui, mesmo quando chega mensagem nova. Eles não contam no número do menu.' }),
      el('div', { class: 'gp-buscando', hidden: '', role: 'status', text: 'Buscando todos os grupos do WhatsApp…' }),
      el('div', { class: 'itens gp-itens', role: 'list' }));
    const chat = el('div', { class: 'chat gp-chat' });
    s.raiz = el('div', { class: 'gp' }, lista, chat);
    s.caixa.replaceChildren(s.raiz);
    s.linhas.clear();
    desenharVazioChat();
  }

  function desenharVazioChat() {
    const chat = $('.gp-chat');
    chat.replaceChildren(el('div', { class: 'sem-conversa' }, el('div', {},
      Object.assign(el('span'), { innerHTML: ICONE_GRUPO }).firstChild,
      el('b', { text: 'Conversas de grupo' }),
      el('p', { text: 'Os grupos do WhatsApp da loja aparecem aqui. Escolha um grupo para ler e responder. Aqui não tem IA, funil nem alarme de cliente esperando.' }))));
  }

  function trocarArquivo(sim) {
    s.arquivo = sim;
    const caixa = $('.gp-itens'); if (caixa) caixa.scrollTop = 0;
    desenharLista();
  }

  function desenharLista() {
    const caixa = $('.gp-itens'); if (!caixa) return;
    if (s.arquivo && !s.arquivadas.total) s.arquivo = false;
    const sinc = $('.gp-sinc'); if (sinc) sinc.hidden = !s.podeSincronizar || s.arquivo;
    const itSinc = $('.tl-menu [data-id="sinc"]'); if (itSinc) itSinc.hidden = !s.podeSincronizar;
    const itArq = $('.tl-menu [data-id="arq"]'); if (itArq) itArq.hidden = s.arquivo || !s.arquivadas?.total;
    const volta = $('.gp-volta-arq'); if (volta) volta.hidden = !s.arquivo;
    const titulo = $('.gp-titulo'); const t = s.arquivo ? 'Arquivadas' : 'Grupos'; if (titulo && titulo.textContent !== t) titulo.textContent = t;
    const abas = $('.cv-abas'); if (abas) abas.style.display = s.arquivo ? 'none' : '';
    const aviso = $('.gp-arq-aviso'); if (aviso) aviso.hidden = !s.arquivo;
    const busc = $('.gp-buscando'); if (busc) busc.hidden = !s.buscando || s.arquivo;
    const lista = s.grupos.filter((g) => Boolean(g.arquivado) === s.arquivo && (!s.busca || String(g.nome || '').toLowerCase().includes(s.busca)));
    // Linhas da lista: "Arquivadas (N)" no topo (como no WhatsApp) e os grupos.
    const itens = [];
    if (!s.arquivo && !s.busca && s.arquivadas.total > 0) itens.push({ id: 'arquivadas', ass: JSON.stringify(s.arquivadas), criar: linhaArquivadas });
    for (const g of lista) itens.push({ id: g.id, ass: JSON.stringify([g.nome, g.temFoto, g.naoLidas, g.ultima, g.ultimaEm, g.participantes, s.aberto === g.id]), criar: () => linhaGrupo(g) });
    if (!itens.length) {
      s.linhas.clear();
      const v = el('div', { class: 'gp-vazio' });
      if (!s.carregou) v.append(el('span', { text: 'Carregando grupos…' }));
      else if (s.busca && (s.grupos.length)) v.append(el('b', { text: 'Nenhum grupo com esse nome.' }));
      else if (s.buscando) v.append(el('b', { text: 'Buscando os grupos do WhatsApp…' }), el('span', { text: 'Com muitos grupos, isso pode levar alguns minutos. Eles vão aparecendo aqui.' }));
      else {
        v.append(el('b', { text: 'Nenhum grupo ainda.' }), el('span', { text: 'Assim que alguém escrever num grupo do WhatsApp da loja, ele aparece aqui.' }));
        if (s.podeSincronizar) v.append(el('button', { class: 'botao leve', type: 'button', text: 'Buscar grupos do WhatsApp', onclick: sincronizar }));
      }
      caixa.replaceChildren(v);
      return;
    }
    caixa.querySelector('.gp-vazio')?.remove();
    const vistos = new Set();
    let anterior = null;
    for (const it of itens) {
      vistos.add(it.id);
      let linha = s.linhas.get(it.id);
      if (!linha || linha.dataset.ass !== it.ass) {
        const nova = it.criar();
        nova.dataset.ass = it.ass;
        if (linha) linha.replaceWith(nova);
        linha = nova; s.linhas.set(it.id, linha);
      }
      // Ordem: só move o que mudou de lugar.
      const esperado = anterior ? anterior.nextSibling : caixa.firstChild;
      if (esperado !== linha) caixa.insertBefore(linha, esperado);
      anterior = linha;
    }
    for (const [id, linha] of s.linhas) if (!vistos.has(id)) { linha.remove(); s.linhas.delete(id); }
  }

  function linhaArquivadas() {
    const a = s.arquivadas;
    return el('button', { class: 'item gp-arq-linha', type: 'button', role: 'listitem', 'aria-label': `Arquivadas: ${a.total} grupo${a.total === 1 ? '' : 's'}${a.naoLidas ? `, ${a.naoLidas} com mensagem não lida` : ''}`, onclick: () => trocarArquivo(true) },
      el('span', { class: 'avatar gp-av gp-arq-av', html: ICONE_ARQUIVO }),
      el('div', { class: 'corpo' },
        el('div', { class: 'l1' }, el('span', { class: 'nome', text: 'Arquivadas' }),
          a.naoLidas ? el('span', { class: 'badge', text: a.naoLidas > 99 ? '99+' : String(a.naoLidas), title: 'Grupos arquivados com mensagem não lida' }) : el('span', { class: 'hora', text: String(a.total) }))));
  }

  function linhaGrupo(g) {
    const u = g.ultima;
    const previa = el('span', { class: 'previa' });
    if (u && u.autor === 'equipe') previa.insertAdjacentHTML('beforeend', CHECK);
    if (u) previa.append(el('b', { text: (u.autor === 'equipe' ? 'Você' : u.nome) + ': ' }), document.createTextNode(textoPrevia(u)));
    else previa.append(document.createTextNode(g.participantes ? `${g.participantes} pessoas` : 'Sem mensagens ainda'));
    const nova = g.naoLidas > 0;
    const l2 = el('div', { class: 'l2' }, previa);
    if (nova) l2.append(el('span', { class: 'badge', text: g.naoLidas > 99 ? '99+' : String(g.naoLidas), 'aria-label': `${g.naoLidas} não lidas` }));
    return el('button', { class: 'item', type: 'button', role: 'listitem', 'data-id': g.id, 'aria-current': String(s.aberto === g.id), onclick: () => abrir(g.id) },
      avatarGrupo(g),
      el('div', { class: 'corpo' },
        el('div', { class: 'l1' }, el('span', { class: 'nome', text: g.nome || 'Grupo do WhatsApp' }), el('span', { class: 'hora' + (nova ? ' nova' : ''), text: horaLista(u ? u.em : g.ultimaEm) })),
        l2));
  }

  async function sincronizar() {
    const bt = $('.gp-sinc');
    if (bt) { bt.disabled = true; bt.classList.add('girando'); }
    s.ui.toast('Buscando os grupos do WhatsApp…');
    try {
      const r = await s.ui.post('/api/grupos/sincronizar');
      if (r.emAndamento) s.ui.toast('Ainda buscando: com muitos grupos demora um pouco. Eles vão aparecendo na lista.');
      else s.ui.toast(r.grupos ? `${r.grupos} grupo${r.grupos === 1 ? '' : 's'} no WhatsApp${r.novos ? ` (${r.novos} novo${r.novos === 1 ? '' : 's'})` : ''}.` : 'Nenhum grupo encontrado neste WhatsApp.');
      await carregarLista();
    } catch (e) { s.ui.toast(e.message || 'Não deu para buscar os grupos agora.'); }
    finally { if (bt) { bt.disabled = false; bt.classList.remove('girando'); } }
  }

  // ---------- chat ----------
  async function abrir(id) {
    if (s.grav) pararGravacao(true);
    s.aberto = id; s.msgs = []; s.assinatura = ''; s.mais = false;
    const g = s.grupos.find((x) => x.id === id);
    if (g) { g.naoLidas = 0; atualizarMenu(s.grupos.filter((x) => x.naoLidas > 0).length); }
    s.raiz.classList.add('abrindo');
    if (ehCelular()) document.getElementById('casca')?.classList.add('em-conversa');
    desenharLista();
    montarChat(g);
    await carregarMensagens(true);
    s.ui.post(`/api/grupos/${id}/lida`).catch(() => {});
    agendarChat();
  }

  function fechar() {
    if (s.grav) pararGravacao(true);
    s.raiz?.classList.remove('abrindo');
    document.getElementById('casca')?.classList.remove('em-conversa');
    if (ehCelular()) { s.aberto = null; desenharLista(); }
  }

  function montarChat(g) {
    const chat = $('.gp-chat');
    const voltar = el('button', { class: 'voltar', type: 'button', 'aria-label': 'Voltar', html: ICONE_VOLTAR });
    voltar.addEventListener('click', fechar);
    const quem = el('div', { class: 'quem' }, el('b', { class: 'gp-nome', text: g?.nome || 'Grupo do WhatsApp' }), el('span', { class: 'gp-sub', text: subtitulo(g) }));
    const msgs = el('div', { class: 'msgs gp-msgs' });
    const texto = el('textarea', { rows: '1', placeholder: 'Mensagem para o grupo', 'aria-label': 'Mensagem para o grupo' });
    const arq = el('input', { type: 'file', hidden: '' });
    const foto = el('input', { type: 'file', accept: 'image/*,video/*', hidden: '' });
    const btArq = el('button', { class: 'icone', type: 'button', title: 'Enviar arquivo', 'aria-label': 'Enviar arquivo', html: ICONE_CLIPE });
    const btFoto = el('button', { class: 'icone', type: 'button', title: 'Foto ou vídeo', 'aria-label': 'Enviar foto ou vídeo', html: ICONE_CAMERA });
    const btEnviar = el('button', { class: 'icone falar gp-enviar', type: 'button', title: 'Gravar áudio', 'aria-label': 'Gravar áudio', html: ICONE_MIC });
    btArq.addEventListener('click', () => arq.click());
    btFoto.addEventListener('click', () => foto.click());
    arq.addEventListener('change', () => { if (arq.files[0]) enviarArquivo(arq.files[0]); arq.value = ''; });
    foto.addEventListener('change', () => { if (foto.files[0]) enviarArquivo(foto.files[0]); foto.value = ''; });
    const trocar = () => { const tem = texto.value.trim().length > 0; btEnviar.innerHTML = tem ? ICONE_ENVIAR : ICONE_MIC; btEnviar.title = tem ? 'Enviar' : 'Gravar áudio'; btEnviar.setAttribute('aria-label', btEnviar.title); };
    texto.addEventListener('input', () => { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 120) + 'px'; trocar(); });
    texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !ehCelular()) { e.preventDefault(); enviarTexto(); } });
    btEnviar.addEventListener('click', () => (texto.value.trim() ? enviarTexto() : gravar()));
    const compor = el('div', { class: 'compor' },
      el('div', { class: 'caixa' }, texto),
      el('div', { class: 'linha-compor gp-linha' }, el('span', { class: 'espaco' }), btArq, btFoto, btEnviar),
      arq, foto);
    chat.replaceChildren(
      el('header', { class: 'chat-topo' }, voltar, avatarGrupo(g || { id: s.aberto }, 'p'), quem, botaoArquivar(g)),
      msgs, compor);
    s.trocarBotao = trocar;
    if (!ehCelular()) texto.focus({ preventScroll: true });
  }

  function botaoArquivar(g) {
    const bt = el('button', { class: 'gp-acao gp-bt-arq', type: 'button' });
    const pintar = (arq) => { bt.dataset.arq = String(arq); bt.innerHTML = arq ? ICONE_DESARQUIVAR : ICONE_ARQUIVO; bt.title = arq ? 'Desarquivar grupo' : 'Arquivar grupo'; bt.setAttribute('aria-label', bt.title); };
    pintar(Boolean(g?.arquivado));
    bt.pintar = pintar;
    bt.addEventListener('click', async () => {
      const id = s.aberto; if (!id) return;
      const arquivar = bt.dataset.arq !== 'true';
      bt.disabled = true;
      try {
        const r = await s.ui.post(`/api/grupos/${id}/arquivar`, { arquivar });
        pintar(r.arquivado);
        const x = s.grupos.find((y) => y.id === id); if (x) x.arquivado = r.arquivado;
        s.ui.toast(r.arquivado
          ? (r.noCelular ? 'Grupo arquivado aqui e no WhatsApp do celular.' : 'Grupo arquivado na Sintonia (o celular não aceitou agora).')
          : (r.noCelular ? 'Grupo desarquivado aqui e no WhatsApp do celular.' : 'Grupo desarquivado na Sintonia.'));
        await carregarLista();
        if (ehCelular()) fechar();
      } catch (e) { s.ui.toast(e.message || 'Não deu para arquivar agora.'); }
      finally { bt.disabled = false; }
    });
    return bt;
  }

  const subtitulo = (g) => [g?.participantes ? `${g.participantes} pessoas` : '', 'Grupo do WhatsApp'].filter(Boolean).join(' · ');

  async function carregarMensagens(primeira) {
    const id = s.aberto; if (!id) return;
    let r;
    try { r = await s.ui.api(`/api/grupos/${id}/mensagens?limite=80`); }
    catch (e) { if (primeira) { s.ui.toast(e.message || 'Não deu para abrir o grupo.'); } return; }
    if (s.aberto !== id) return;
    // Mensagens antigas já carregadas (Ver anteriores) continuam na tela.
    const ids = new Set(r.mensagens.map((m) => m.id));
    const antigas = s.msgs.filter((m) => !ids.has(m.id) && r.mensagens.length && new Date(m.em) < new Date(r.mensagens[0].em));
    const novas = [...antigas, ...r.mensagens];
    if (primeira) s.mais = Boolean(r.mais);
    const ass = novas.map((m) => m.id).join(',') + '|' + s.mais;
    const nome = $('.gp-nome'); if (nome && nome.textContent !== r.grupo.nome) nome.textContent = r.grupo.nome;
    const sub = $('.gp-sub'); const st = subtitulo(r.grupo); if (sub && sub.textContent !== st) sub.textContent = st;
    const btArq = $('.gp-bt-arq'); if (btArq && !btArq.disabled && btArq.dataset.arq !== String(Boolean(r.grupo.arquivado))) btArq.pintar(Boolean(r.grupo.arquivado));
    if (ass === s.assinatura) return;
    const chegou = !primeira && novas.length > s.msgs.length;
    s.msgs = novas; s.assinatura = ass;
    desenharMensagens(primeira);
    if (chegou && !document.hidden) s.ui.post(`/api/grupos/${id}/lida`).catch(() => {});
  }

  async function verAnteriores(bt) {
    const id = s.aberto; const primeira = s.msgs[0]; if (!id || !primeira) return;
    bt.disabled = true;
    let r; try { r = await s.ui.api(`/api/grupos/${id}/mensagens?limite=80&antes=${encodeURIComponent(new Date(primeira.em).toISOString())}`); } catch { bt.disabled = false; return; }
    if (s.aberto !== id) return;
    const caixa = $('.gp-msgs'); const altura = caixa.scrollHeight;
    const ids = new Set(s.msgs.map((m) => m.id));
    s.msgs = [...r.mensagens.filter((m) => !ids.has(m.id)), ...s.msgs];
    s.mais = Boolean(r.mais);
    s.assinatura = s.msgs.map((m) => m.id).join(',') + '|' + s.mais;
    desenharMensagens(false);
    caixa.scrollTop = caixa.scrollHeight - altura;
  }

  function desenharMensagens(rolarFim) {
    const caixa = $('.gp-msgs'); if (!caixa) return;
    const noFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
    const frag = document.createDocumentFragment();
    if (s.mais) { const bt = el('button', { class: 'gp-antigas', type: 'button', text: 'Ver mensagens anteriores' }); bt.addEventListener('click', () => verAnteriores(bt)); frag.append(bt); }
    let dia = '', anterior = '';
    for (const m of s.msgs) {
      if (diaChave(m.em) !== dia) { dia = diaChave(m.em); anterior = ''; frag.append(el('div', { class: 'dia', text: rotuloDia(m.em) })); }
      const lado = m.autor === 'equipe' ? 'env' : 'rec';
      const quem = m.autor + '|' + (m.chave || m.nome);
      const bal = el('div', { class: `bal ${lado}${quem !== anterior ? ' primeira' : ''}`, 'data-id': m.id });
      if (quem !== anterior) bal.append(el('span', { class: 'autor ' + (lado === 'env' ? 'eq' : corDe(m.chave || m.nome)), text: m.nome }));
      if (m.anexo) balaoMidia(bal, m); else bal.append(document.createTextNode(m.texto));
      const meta = el('span', { class: 'meta', text: hm(m.em) }); if (lado === 'env') meta.insertAdjacentHTML('beforeend', CHECK);
      (bal.querySelector(':scope > .legenda') || bal).append(meta);
      frag.append(bal); anterior = quem;
    }
    if (!s.msgs.length) frag.append(el('div', { class: 'sistema', text: 'Sem mensagens neste grupo ainda.' }));
    caixa.replaceChildren(frag);
    if (rolarFim || noFim) caixa.scrollTop = caixa.scrollHeight;
  }

  function balaoMidia(bal, m) {
    const url = `/api/grupos/${s.aberto}/midias/${m.id}`;
    const a = m.anexo;
    const falhou = () => el('span', { class: 'gp-falhou', text: `${ROTULO_ANEXO[a.tipo] || 'Arquivo'} indisponível` });
    if (a.tipo === 'imagem' || a.tipo === 'figurinha') {
      bal.classList.add('midia'); if (a.tipo === 'figurinha') bal.classList.add('gp-fig');
      const img = el('img', { class: 'gp-img', alt: a.legenda || 'Foto', loading: 'lazy', src: url });
      img.addEventListener('error', () => img.replaceWith(falhou()));
      if (a.tipo === 'imagem') img.addEventListener('click', () => { const z = el('div', { class: 'gp-zoom', role: 'dialog', 'aria-label': 'Foto' }, el('img', { alt: '', src: url })); z.addEventListener('click', () => z.remove()); document.body.append(z); });
      bal.append(img);
    } else if (a.tipo === 'video') {
      bal.classList.add('midia');
      const v = el('video', { controls: '', preload: 'none', src: url, playsinline: '' }); v.addEventListener('error', () => v.replaceWith(falhou()));
      bal.append(v);
    } else if (a.tipo === 'audio') {
      const au = el('audio', { controls: '', preload: 'none', src: url }); au.addEventListener('error', () => au.replaceWith(falhou()));
      bal.append(au);
    } else {
      const d = el('a', { class: 'gp-doc', href: url + '?baixar=1', download: a.nomeArquivo || '' });
      d.insertAdjacentHTML('beforeend', ICONE_DOC); d.append(el('span', { text: a.nomeArquivo || 'Documento' }));
      bal.append(d);
    }
    if (a.legenda) bal.append(el('span', { class: 'legenda', text: a.legenda }));
  }

  // ---------- envio ----------
  async function enviarTexto() {
    const texto = $('.gp-chat textarea'); const id = s.aberto;
    const t = texto?.value.trim(); if (!t || !id || s.enviando) return;
    s.enviando = true;
    try {
      const r = await s.ui.post(`/api/grupos/${id}/enviar`, { texto: t });
      texto.value = ''; texto.style.height = 'auto'; s.trocarBotao?.();
      if (s.aberto === id && r.mensagem && !s.msgs.some((m) => m.id === r.mensagem.id)) {
        s.msgs.push(r.mensagem); s.assinatura = ''; desenharMensagens(true);
      }
      carregarLista();
    } catch (e) { s.ui.toast(e.message || 'Não deu para enviar.'); }
    finally { s.enviando = false; }
  }

  const lerBase64 = (blob) => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => erro(r.error); r.readAsDataURL(blob); });

  async function enviarArquivo(arquivo, extra = {}) {
    const id = s.aberto; if (!id) return;
    if (arquivo.size > LIMITE) { s.ui.toast('Arquivo grande demais: o limite é 16 MB.'); return; }
    const mimetype = (arquivo.type || 'application/octet-stream').toLowerCase();
    const tipo = extra.tipo || (mimetype.startsWith('image/') ? 'imagem' : mimetype.startsWith('video/') ? 'video' : mimetype.startsWith('audio/') ? 'audio' : 'documento');
    const texto = $('.gp-chat textarea');
    const legenda = tipo === 'imagem' || tipo === 'video' || tipo === 'documento' ? (texto?.value.trim() || undefined) : undefined;
    s.ui.toast(tipo === 'audio' ? 'Enviando áudio…' : 'Enviando arquivo…');
    try {
      const base64 = await lerBase64(arquivo);
      const r = await s.ui.post(`/api/grupos/${id}/enviar-midia`, { tipo, base64, mimetype, nomeArquivo: arquivo.name || undefined, legenda, ...(extra.duracaoSeg ? { duracaoSeg: extra.duracaoSeg } : {}) });
      if (legenda && texto) { texto.value = ''; s.trocarBotao?.(); }
      if (s.aberto === id && r.mensagem && !s.msgs.some((m) => m.id === r.mensagem.id)) { s.msgs.push(r.mensagem); s.assinatura = ''; desenharMensagens(true); }
      carregarLista();
    } catch (e) { s.ui.toast(e.message || 'Não deu para enviar o arquivo.'); }
  }

  // Nota de voz: toca no microfone para gravar; enviar ou apagar.
  async function gravar() {
    if (s.grav || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { if (!s.grav) s.ui.toast('Este navegador não grava áudio.'); return; }
    let fluxo;
    try { fluxo = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { s.ui.toast('Libere o microfone para gravar.'); return; }
    const tipo = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
    const rec = new MediaRecorder(fluxo, tipo ? { mimeType: tipo } : undefined);
    const pedacos = []; rec.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
    const inicio = Date.now();
    const relogio = el('span', { class: 'relogio', text: '0:00' });
    const cancelar = el('button', { class: 'icone', type: 'button', title: 'Apagar gravação', 'aria-label': 'Apagar gravação', html: ICONE_LIXO });
    const enviar = el('button', { class: 'icone falar gp-enviar', type: 'button', title: 'Enviar áudio', 'aria-label': 'Enviar áudio', html: ICONE_ENVIAR });
    const barra = el('div', { class: 'gp-grav' }, cancelar, el('span', { class: 'ponto' }), relogio, el('span', { class: 'dica', text: 'Gravando…' }), enviar);
    const compor = $('.gp-chat .compor');
    compor.querySelector('.caixa').hidden = true; compor.querySelector('.gp-linha').hidden = true; compor.prepend(barra);
    s.grav = { rec, fluxo, barra, inicio, relogio: setInterval(() => { const seg = Math.floor((Date.now() - inicio) / 1000); relogio.textContent = `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`; }, 500) };
    rec.onstop = () => {
      const g = s.grav; s.grav = null;
      clearInterval(g.relogio); fluxo.getTracks().forEach((t) => t.stop());
      barra.remove(); compor.querySelector('.caixa').hidden = false; compor.querySelector('.gp-linha').hidden = false;
      if (g.cancelado || !pedacos.length) return;
      const blob = new Blob(pedacos, { type: (rec.mimeType || 'audio/ogg').split(';')[0] });
      enviarArquivo(new File([blob], 'audio', { type: blob.type }), { tipo: 'audio', duracaoSeg: Math.round((Date.now() - inicio) / 1000) });
    };
    cancelar.addEventListener('click', () => pararGravacao(true));
    enviar.addEventListener('click', () => pararGravacao(false));
    rec.start();
  }
  function pararGravacao(cancelado) {
    if (!s.grav) return;
    s.grav.cancelado = cancelado;
    try { s.grav.rec.stop(); } catch { s.grav = null; }
  }

  // ---------- atualização sozinha ----------
  function agendar() {
    clearTimeout(s.timerLista);
    // Na tela: lista a cada 4 s. Fora dela: só o contador do menu, a cada 20 s.
    s.timerLista = setTimeout(async () => { if (!document.hidden) await carregarLista(); agendar(); }, ativa() ? 4000 : 20000);
    agendarChat();
  }
  function agendarChat() {
    clearTimeout(s.timerChat);
    // Chat aberto: mensagens novas a cada 3 s (só redesenha se mudou).
    if (ativa() && s.aberto) s.timerChat = setTimeout(async () => { if (!document.hidden) await carregarMensagens(false); agendarChat(); }, 3000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { carregarLista(); if (ativa() && s.aberto) carregarMensagens(false); } });

  window.SintoniaTelas.grupos = {
    desenhar(caixa, ui) {
      garantirEstilo();
      s.ui = ui;
      // No celular, a aba Conversas da barra de baixo continua acesa (Conversas › Grupos).
      document.querySelector('.trilho .nav[data-vista="conversas"]')?.setAttribute('aria-current', 'page');
      if (s.caixa !== caixa || !caixa.contains(s.raiz)) { s.caixa = caixa; montar(); }
      if (ehCelular() && !s.raiz.classList.contains('abrindo')) document.getElementById('casca')?.classList.remove('em-conversa');
      desenharLista();
      carregarLista().then(agendar);
      if (s.aberto) carregarMensagens(false);
    },
    /** Total de grupos com mensagem não lida (para outras telas). */
    naoLidas: () => s.grupos.filter((g) => g.naoLidas > 0).length,
  };

  // Ao carregar: mostra o item do menu e mantém o contador de não lidas.
  const iniciar = () => {
    const item = document.getElementById('lt-grupos-wa'); if (item) item.hidden = false;
    if (window.Sintonia?.ui) s.ui = window.Sintonia.ui;
    carregarLista().then(agendar);
  };
  if (document.readyState === 'complete') iniciar(); else addEventListener('load', iniciar, { once: true });
})();
