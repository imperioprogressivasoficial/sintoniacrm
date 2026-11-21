/* Conversas de equipe: chat interno entre as pessoas da empresa (não passa pelo WhatsApp).
 * Servidor: src/equipe (rotas /api/equipe/chat/...). Vista "chat-equipe" do app ("equipe" já é Atendentes e acessos).
 * - Computador: lista à esquerda (foto, nome, online/offline, prévia, horário, não lidas) e o chat à direita,
 *   no mesmo visual da tela de Conversas (.lista, .item, .bal, .compor).
 * - Celular: lista em tela cheia; o chat abre por cima, com voltar.
 * - "+ Nova conversa" (escolher pessoa) e "Novo grupo" (nome + pessoas). O "Geral" com todo mundo nasce sozinho.
 * - Responder a uma mensagem e compartilhar uma conversa de cliente (cartão que abre a conversa para quem pode vê-la).
 * - Atualiza sozinho (consulta leve a cada 8 s, só o resumo; recarrega só o que mudou). Sem animação em loop.
 * Registra window.SintoniaTelas.equipe = { desenhar(caixa, ui), abrir(salaId?), vista: 'chat-equipe' }.
 * Mostra #lt-chat-equipe no menu e mantém #lt-chat-equipe-qtd com o total não lido. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const VISTA = 'chat-equipe';
  const CSS = `
  .ceq { flex: 1; min-width: 0; min-height: 0; display: flex; background: var(--fundo); }
  .ceq .lista-topo h1.titulo-grande { margin: 2px 0 4px; }
  .ceq .ceq-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
  .ceq .ceq-bt { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 13px; border-radius: 999px;
    font-size: 13.5px; font-weight: 600; color: var(--texto); background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); }
  .ceq .ceq-bt.prim { color: #fff; background: linear-gradient(90deg, #106ebe, #3aa0ff); box-shadow: none; }
  .ceq .ceq-bt svg { width: 16px; height: 16px; }
  .ceq .ceq-bt:focus-visible, .ceq-card:focus-visible, .ceq-linha:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  .ceq-av { position: relative; flex: none; display: inline-grid; }
  .ceq-av .avatar { color: #fff; }
  .ceq-av .avatar.grupo { background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .ceq-av .avatar.geral { background: #0d2240; }
  html[data-tema="escuro"] .ceq-av .avatar.geral { background: #1b3a5f; }
  .ceq-av .avatar svg { width: 54%; height: 54%; }
  .ceq-pres { position: absolute; right: 1px; bottom: 1px; width: 12px; height: 12px; border-radius: 50%; background: #9aa7b4; box-shadow: 0 0 0 2.5px var(--fundo); }
  .ceq-pres.on { background: #16a34a; }
  .ceq .item .previa b { font-weight: 600; color: var(--texto); }
  .ceq .item.tem-nova .nome { font-weight: 700; }
  .ceq .item .hora.nova { color: #106ebe; font-weight: 600; }
  html[data-tema="escuro"] .ceq .item .hora.nova { color: #0ffcbe; }
  .ceq .ceq-vazio { padding: 28px 18px; color: var(--sub); font-size: 14px; text-align: center; }
  .ceq .chat-topo .quem span.on { color: #16a34a; }
  .ceq .sem-conversa { border-bottom-color: #106ebe; }
  .ceq .sem-conversa svg { width: 64px; height: 64px; color: #106ebe; }
  html[data-tema="escuro"] .ceq .sem-conversa svg { color: #0ffcbe; }
  .ceq .msgs { gap: 0; }
  .ceq .bal { cursor: default; }
  .ceq .bal .autor.eq { color: #106ebe; }
  html[data-tema="escuro"] .ceq .bal .autor.eq { color: #0ffcbe; }
  .ceq .bal.alvo { box-shadow: 0 0 0 2px #3aa0ff; }
  .ceq-cit { display: block; margin: 1px 0 5px; padding: 5px 8px; border-radius: 6px; border-left: 3px solid #3aa0ff; background: color-mix(in srgb, var(--texto) 6%, transparent); cursor: pointer; white-space: normal; }
  .ceq-cit b { display: block; font-size: 12.5px; font-weight: 600; color: #106ebe; }
  html[data-tema="escuro"] .ceq-cit b { color: #3aa0ff; }
  html[data-tema="escuro"] .ceq .bal.env .ceq-cit { border-left-color: #0ffcbe; background: rgba(0,0,0,.18); }
  html[data-tema="escuro"] .ceq .bal.env .ceq-cit b { color: #0ffcbe; }
  html[data-tema="escuro"] .ceq .bal.env .ceq-cit span { color: rgba(255,255,255,.78); }
  .ceq-cit span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; color: var(--sub); }
  .ceq-card { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; width: 100%; min-width: 220px; margin: 3px 0 4px; padding: 9px 10px; border-radius: 10px;
    background: color-mix(in srgb, var(--fundo) 70%, transparent); box-shadow: inset 0 0 0 1px var(--linha); white-space: normal; }
  .ceq-card .ic { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .ceq-card .ic svg { width: 18px; height: 18px; }
  .ceq-card .t { flex: 1; min-width: 0; display: grid; }
  .ceq-card .t b { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ceq-card .t small { font-size: 12px; color: var(--sub); }
  .ceq-card .seta { width: 16px; height: 16px; color: var(--sub); flex: none; }
  .ceq-card.bloq { cursor: default; opacity: .75; }
  .ceq-card.bloq .ic { background: #9aa7b4; }
  .ceq-resp-bt { all: unset; cursor: pointer; position: absolute; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; border-radius: 50%; display: none; place-items: center;
    background: var(--painel); color: var(--sub); box-shadow: var(--sombra); }
  .ceq-resp-bt svg { width: 16px; height: 16px; }
  .ceq .bal.rec .ceq-resp-bt { right: -40px; }
  .ceq .bal.env .ceq-resp-bt { left: -40px; }
  @media (hover: hover) { .ceq .bal:hover .ceq-resp-bt, .ceq .ceq-resp-bt:focus-visible { display: grid; } }
  .ceq .meta .ck { width: 16px; height: 11px; color: var(--sub); }
  .ceq .meta .ck.vista { color: #3aa0ff; }
  .ceq-mais { align-self: center; margin: 6px 0 10px; }
  .ceq-extra { flex: none; background: var(--painel); padding: 6px 12px 0; display: grid; gap: 6px; }
  .ceq-extra[hidden] { display: none; }
  .ceq-extra .citacao { border-left-color: #3aa0ff; }
  .ceq-extra .citacao b { color: #106ebe; }
  html[data-tema="escuro"] .ceq-extra .citacao b { color: #3aa0ff; }
  .ceq-extra .fechar { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .ceq-extra .fechar svg { width: 16px; height: 16px; }
  .ceq .compor .ceq-enviar svg { width: 22px; height: 22px; }
  .ceq .ceq-anexar { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--linha); font-size: 13.5px; font-weight: 600; color: var(--texto); }
  .ceq .ceq-anexar svg { width: 17px; height: 17px; }
  .ceq .ceq-anexar:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  @media (min-width: 761px) { .ceq .lista-topo > .titulo { display: none; } .ceq .lista-topo { padding-top: 18px; } }
  .ceq .compor .ceq-enviar:disabled { opacity: .45; cursor: default; }
  .ceq .compor .ceq-conta { font-size: 11px; color: var(--sub); align-self: center; padding: 0 4px; }
  /* Painel lateral (Nova conversa, Novo grupo, Compartilhar, Grupo) */
  .ceq-pl { display: grid; gap: 10px; padding: 12px 14px 24px; }
  .ceq-pl .busca { background: var(--painel); }
  .ceq-pl input.ceq-nome { all: unset; box-sizing: border-box; width: 100%; height: 42px; padding: 0 12px; border-radius: 10px; background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); font-size: 15px; color: var(--texto); }
  .ceq-pl label.rot { font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); margin-top: 4px; }
  .ceq-linha { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 6px; border-radius: 10px; }
  .ceq-linha:hover { background: var(--hover); }
  .ceq-linha .t { flex: 1; min-width: 0; display: grid; }
  .ceq-linha .t b { font-weight: 600; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ceq-linha .t small { color: var(--sub); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ceq-linha input[type=checkbox] { width: 20px; height: 20px; accent-color: #106ebe; flex: none; }
  .ceq-pl .ceq-bt { justify-content: center; height: 44px; font-size: 15px; }
  .ceq-pl .ceq-bt.perigo { color: #b3261e; }
  html[data-tema="escuro"] .ceq-pl .ceq-bt.perigo { color: #ff9a92; }
  .ceq-pl .ceq-bt:disabled { opacity: .5; cursor: default; }
  @media (max-width: 760px) {
    .ceq .lista { width: 100%; }
    .ceq .chat { display: none; }
    .ceq.abrindo .lista { display: none; }
    .ceq.abrindo .chat { display: flex; }
    .ceq .lista-topo .titulo { justify-content: flex-end; }
    .ceq-av .avatar { width: 54px; height: 54px; }
    .ceq .item .ceq-av { margin-top: 15px; }
    .ceq .chat-topo .ceq-av .avatar { width: 40px; height: 40px; margin: 0; }
    .ceq-pres { width: 14px; height: 14px; }
    .ceq .bal { max-width: 82%; }
  }
  `;
  if (!document.getElementById('ceq-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'ceq-css', textContent: CSS }));

  const SVG = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    mais: SVG('<path d="M12 5v14M5 12h14"/>', 2.2),
    grupo: SVG('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>'),
    geral: SVG('<path d="M3 21h18"/><path d="M5 21V8l7-4 7 4v13"/><path d="M9.5 21v-5h5v5"/><path d="M9 11h.01M15 11h.01"/>', 2),
    chat: SVG('<path d="M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/><path d="M17 9h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v2.5L16 19h-4a2 2 0 0 1-2-2"/>'),
    voltar: SVG('<path d="m15 5-7 7 7 7"/>', 2.4),
    enviar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87Z"/></svg>',
    responder: SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 2),
    fechar: SVG('<path d="M6 6l12 12M18 6 6 18"/>', 2.2),
    conversa: SVG('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/>'),
    anexar: SVG('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M12 8v7M8.5 11.5h7"/>'),
    seta: SVG('<path d="m9 6 6 6-6 6"/>', 2.2),
    cadeado: SVG('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    busca: SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 2),
  };
  const CHECK = '<svg class="ck" viewBox="0 0 16 11" fill="currentColor"><path d="M11.07.65 4.98 8.15 2.7 5.92a.5.5 0 0 0-.7.71l2.67 2.6a.5.5 0 0 0 .73-.04L11.84 1.3a.5.5 0 0 0-.77-.64Zm3.79 0-6.08 7.5-.9-.88-.7.71 1.29 1.25a.5.5 0 0 0 .73-.04L15.63 1.3a.5.5 0 0 0-.77-.64Z"/></svg>';
  const CORES = ['#00a884', '#027eb5', '#7f66ff', '#e26b2c', '#c4407b', '#1f8a70', '#a0522d', '#5b6ee1'];
  const cor = (n) => { let h = 0; for (const ch of String(n || '')) h = (h * 31 + ch.codePointAt(0)) >>> 0; return CORES[h % CORES.length]; };
  const iniciais = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const $ = (id) => document.getElementById(id);

  const st = {
    ui: null, caixa: null, montado: false,
    salas: [], linhas: new Map(), aberta: null, msgs: [], vistoAte: 0, mais: false,
    resposta: null, anexo: null, busca: '', versao: '', naoLidas: 0, pessoas: null, ocupado: false, rascunhos: new Map(),
  };
  const el = (...a) => st.ui.el(...a);

  // ---------------------------------------------------------------- pedaços

  function avPessoa(nome, id, online) {
    const a = el('span', { class: 'avatar p', text: iniciais(nome), style: `background:${cor(nome)}` });
    window.SintoniaFotos?.aplicar(a, id);
    const w = el('span', { class: 'ceq-av' }, a);
    if (online !== undefined) w.append(el('i', { class: 'ceq-pres' + (online ? ' on' : ''), title: online ? 'Online' : 'Offline', 'aria-label': online ? 'Online' : 'Offline' }));
    return w;
  }
  function avSala(s) {
    if (s.tipo === 'direta') return avPessoa(s.nome, s.pessoaId, s.online);
    return el('span', { class: 'ceq-av' }, el('span', { class: 'avatar p ' + (s.geral ? 'geral' : 'grupo'), html: s.geral ? IC.geral : IC.grupo }));
  }
  const subSala = (s) => (s.tipo === 'direta' ? (s.online ? 'Online' : 'Offline') : s.geral ? `Todas as pessoas da empresa · ${s.membros}` : `${s.membros} pessoas`);

  function previa(s) {
    if (!s.ultima) return el('span', { class: 'previa', text: s.geral ? 'Grupo com todas as pessoas da empresa' : 'Nenhuma mensagem ainda' });
    const p = el('span', { class: 'previa' });
    if (s.ultima.eu) p.append(el('b', { text: 'Você: ' }));
    else if (s.tipo === 'grupo') p.append(el('b', { text: `${String(s.ultima.autorNome).split(' ')[0]}: ` }));
    p.append(document.createTextNode(s.ultima.texto));
    return p;
  }

  // ---------------------------------------------------------------- montar a tela

  function montar() {
    const caixa = st.caixa;
    caixa.classList.add('ceq');
    const btNova = el('button', { class: 'ceq-bt prim', type: 'button', html: IC.mais, onclick: novaConversa }); btNova.append(' Nova conversa');
    const btGrupo = el('button', { class: 'ceq-bt', type: 'button', html: IC.grupo, onclick: () => novoGrupo() }); btGrupo.append(' Novo grupo');
    const busca = el('input', { type: 'search', placeholder: 'Pesquisar', 'aria-label': 'Pesquisar conversas da equipe' });
    busca.addEventListener('input', () => { st.busca = busca.value.toLowerCase(); desenharLista(); });
    /* topo-lista: no celular, a mesma barra de cima de Conversas (⋯ com Novo grupo; + abre Nova conversa) */
    const titulo = window.SintoniaTopoLista
      ? window.SintoniaTopoLista({ menu: [{ nome: 'Novo grupo', ic: IC.grupo, acao: () => novoGrupo() }], acao: { titulo: 'Nova conversa', ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>', onclick: novaConversa } })
      : el('div', { class: 'titulo' }, el('span', { class: 'espaco' }), window.SintoniaTopoGrupo ? el('span', { class: 'so-cel' }, window.SintoniaTopoGrupo()) : null);
    const abasEq = window.SintoniaAbasConversas?.barra?.('chat-equipe');
    const lista = el('div', { class: 'lista' },
      el('div', { class: 'lista-topo' },
        titulo,
        el('div', { class: 'titulo-linha' }, el('h1', { class: 'titulo-grande', text: 'Equipe' })),
        abasEq || null,
        el('div', { class: 'ceq-acoes' }, btNova, btGrupo),
        el('label', { class: 'busca', html: IC.busca }, busca)),
      el('div', { class: 'itens', id: 'ceq-itens', role: 'list' }));

    const vazio = el('div', { class: 'sem-conversa', id: 'ceq-vazio' }, el('div', {},
      el('span', { html: IC.chat }),
      el('h2', { text: 'Conversas de equipe' }),
      el('p', { text: 'Fale com as pessoas da empresa sem sair da Sintonia. Nada daqui vai para o WhatsApp das clientes.' })));
    const topo = el('header', { class: 'chat-topo' },
      el('button', { class: 'voltar', type: 'button', 'aria-label': 'Voltar', html: IC.voltar, onclick: fecharChat }),
      el('span', { id: 'ceq-topo-av' }),
      el('div', { class: 'quem', role: 'button', tabindex: '0', id: 'ceq-quem', onclick: detalhes, onkeydown: (e) => { if (e.key === 'Enter') detalhes(); } },
        el('b', { id: 'ceq-topo-nome' }), el('span', { id: 'ceq-topo-sub' })));
    const msgs = el('div', { class: 'msgs', id: 'ceq-msgs', 'aria-live': 'polite' });
    const extra = el('div', { class: 'ceq-extra', id: 'ceq-extra', hidden: '' });
    const texto = el('textarea', { id: 'ceq-texto', rows: '1', placeholder: 'Mensagem para a equipe', maxlength: '4000', 'aria-label': 'Mensagem' });
    const enviarBt = el('button', { class: 'icone falar ceq-enviar', id: 'ceq-enviar', type: 'button', title: 'Enviar', 'aria-label': 'Enviar', html: IC.enviar, onclick: enviar });
    const anexarBt = el('button', { class: 'ceq-anexar', type: 'button', title: 'Compartilhar uma conversa de cliente', html: IC.anexar, onclick: escolherConversa }); anexarBt.append('Conversa de cliente');
    texto.addEventListener('input', () => { texto.style.height = 'auto'; texto.style.height = Math.min(texto.scrollHeight, 120) + 'px'; if (st.aberta) st.rascunhos.set(st.aberta, texto.value); botaoEnviar(); });
    texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover: hover)').matches) { e.preventDefault(); enviar(); } });
    const compor = el('div', { class: 'compor' }, el('div', { class: 'caixa' }, texto), el('div', { class: 'linha-compor' }, anexarBt, el('span', { class: 'espaco' }), enviarBt));
    const aberto = el('div', { id: 'ceq-aberto', style: 'display:none;flex:1;min-height:0;flex-direction:column' }, topo, msgs, extra, compor);
    const chat = el('div', { class: 'chat' }, vazio, aberto);
    caixa.replaceChildren(lista, chat);
    msgs.addEventListener('scroll', () => { if (msgs.scrollTop < 40 && st.mais && !st.ocupado) antigas(); });
    st.montado = true;
    botaoEnviar();
  }

  function botaoEnviar() {
    const t = $('ceq-texto'); if (!t) return;
    $('ceq-enviar').disabled = !t.value.trim() && !st.anexo;
  }

  // ---------------------------------------------------------------- lista

  function desenharLista() {
    const itens = $('ceq-itens'); if (!itens) return;
    const visiveis = st.salas.filter((s) => !st.busca || s.nome.toLowerCase().includes(st.busca) || (s.ultima?.texto || '').toLowerCase().includes(st.busca));
    const ordem = [];
    for (const s of visiveis) {
      let li = st.linhas.get(s.id);
      const chave = JSON.stringify([s.nome, s.online, s.ultima, s.naoLidas, s.membros, st.aberta === s.id, window.SintoniaFotos?.url(s.pessoaId)]);
      if (!li || li.dataset.chave !== chave) {
        const novo = el('button', { class: 'item' + (s.naoLidas ? ' tem-nova' : ''), type: 'button', role: 'listitem', 'aria-current': String(st.aberta === s.id), onclick: () => abrirSala(s.id) },
          avSala(s),
          el('div', { class: 'corpo' },
            el('div', { class: 'l1' }, el('span', { class: 'nome', text: s.nome }), el('span', { class: 'hora' + (s.naoLidas ? ' nova' : ''), text: s.ultima ? st.ui.horaLista(s.ultima.em) : '' })),
            el('div', { class: 'l2' }, previa(s), s.naoLidas ? el('span', { class: 'badge', text: String(s.naoLidas), 'aria-label': `${s.naoLidas} não lidas` }) : null)));
        novo.dataset.chave = chave; novo.dataset.id = s.id;
        if (li) li.replaceWith(novo);
        li = novo; st.linhas.set(s.id, li);
      }
      ordem.push(li);
    }
    const atual = [...itens.children];
    if (atual.length !== ordem.length || atual.some((x, i) => x !== ordem[i])) itens.replaceChildren(...ordem);
    if (!ordem.length) itens.replaceChildren(el('div', { class: 'ceq-vazio', text: st.busca ? 'Nada encontrado.' : 'Nenhuma conversa ainda.' }));
    for (const [id, li] of st.linhas) if (!st.salas.some((s) => s.id === id)) { li.remove(); st.linhas.delete(id); }
  }

  function contador(n) {
    st.naoLidas = n;
    const q = $('lt-chat-equipe-qtd');
    if (q) { q.hidden = !n; q.textContent = n > 99 ? '99+' : String(n); }
    dispatchEvent(new CustomEvent('sintonia:equipe-chat', { detail: { naoLidas: n } }));
  }

  async function carregarLista() {
    const r = await st.ui.api('/api/equipe/chat');
    st.salas = r.salas || [];
    contador(r.naoLidas || 0);
    desenharLista();
    const a = st.salas.find((s) => s.id === st.aberta);
    if (a) desenharTopo(a);
  }

  // ---------------------------------------------------------------- chat

  const salaAberta = () => st.salas.find((s) => s.id === st.aberta);

  function desenharTopo(s) {
    $('ceq-topo-av').replaceChildren(avSala(s));
    $('ceq-topo-nome').textContent = s.nome;
    const sub = $('ceq-topo-sub'); sub.textContent = subSala(s); sub.className = s.tipo === 'direta' && s.online ? 'on' : '';
    $('ceq-quem').setAttribute('aria-label', s.tipo === 'grupo' ? 'Ver pessoas do grupo' : s.nome);
  }

  async function abrirSala(id) {
    if (!st.montado) return;
    st.aberta = id; st.resposta = null; st.anexo = null; st.msgs = []; st.vistoAte = 0;
    desenharExtra();
    const t = $('ceq-texto'); t.value = st.rascunhos.get(id) || ''; t.style.height = 'auto'; botaoEnviar();
    const s = salaAberta();
    $('ceq-vazio').style.display = 'none';
    $('ceq-aberto').style.display = 'flex';
    st.caixa.classList.add('abrindo');
    if (innerWidth <= 760) { document.querySelector('.casca')?.classList.add('em-conversa'); st.escondeuBarra = true; }
    if (s) desenharTopo(s);
    desenharLista();
    $('ceq-msgs').replaceChildren();
    try {
      const r = await st.ui.api(`/api/equipe/chat/salas/${id}/mensagens?limite=60`);
      if (st.aberta !== id) return;
      st.msgs = r.mensagens; st.vistoAte = r.vistoAte; st.mais = r.mais;
      desenharMensagens(true);
      await lida(id);
    } catch (x) { st.ui.toast(x.message); }
    if (innerWidth > 760) $('ceq-texto').focus();
  }

  function fecharChat() {
    st.aberta = null;
    st.caixa.classList.remove('abrindo');
    $('ceq-aberto').style.display = 'none';
    $('ceq-vazio').style.display = '';
    devolverBarra();
    desenharLista();
  }
  function devolverBarra() {
    if (st.escondeuBarra && !document.querySelector('#v-conversas.abrindo')) document.querySelector('.casca')?.classList.remove('em-conversa');
    st.escondeuBarra = false;
  }

  async function lida(id) {
    const s = st.salas.find((x) => x.id === id);
    if (!s || !s.naoLidas || document.hidden) return;
    try { await st.ui.post(`/api/equipe/chat/salas/${id}/lida`); } catch { return; }
    contador(Math.max(0, st.naoLidas - s.naoLidas));
    s.naoLidas = 0;
    desenharLista();
  }

  const DIA = (d) => new Date(d).toDateString();
  function rotuloDia(d) {
    const x = new Date(d), h = new Date(), ontem = new Date(h); ontem.setDate(h.getDate() - 1);
    if (x.toDateString() === h.toDateString()) return 'Hoje';
    if (x.toDateString() === ontem.toDateString()) return 'Ontem';
    return (h - x) < 6 * 864e5 ? x.toLocaleDateString('pt-BR', { weekday: 'long' }) : x.toLocaleDateString('pt-BR');
  }

  function balao(m, ant) {
    const s = salaAberta();
    const primeira = !ant || ant.autorId !== m.autorId || DIA(ant.em) !== DIA(m.em) || (new Date(m.em) - new Date(ant.em)) > 5 * 60e3;
    const b = el('div', { class: 'bal ' + (m.eu ? 'env' : 'rec') + (primeira ? ' primeira' : ''), id: 'ceq-m-' + m.id });
    b.dataset.seq = m.seq;
    if (primeira && !m.eu && s?.tipo === 'grupo') b.append(el('span', { class: 'autor eq', text: m.autorNome }));
    if (m.resposta) {
      const c = el('span', { class: 'ceq-cit', role: 'button', tabindex: '0', title: 'Ver a mensagem respondida' }, el('b', { text: m.resposta.autorNome }), el('span', { text: m.resposta.texto }));
      c.addEventListener('click', () => irPara(m.resposta.id));
      b.append(c);
    }
    if (m.conversa) b.append(cartao(m.conversa));
    if (m.texto) b.append(el('span', { text: m.texto }));
    const meta = el('span', { class: 'meta', text: st.ui.hm(m.em) });
    if (m.eu) meta.insertAdjacentHTML('beforeend', CHECK);
    b.append(meta);
    const rb = el('button', { class: 'ceq-resp-bt', type: 'button', title: 'Responder', 'aria-label': 'Responder esta mensagem', html: IC.responder, onclick: () => responder(m) });
    b.append(rb);
    // No celular: segurar a mensagem responde.
    let t;
    b.addEventListener('touchstart', () => { t = setTimeout(() => { navigator.vibrate?.(10); responder(m); }, 450); }, { passive: true });
    for (const ev of ['touchend', 'touchmove', 'touchcancel']) b.addEventListener(ev, () => clearTimeout(t), { passive: true });
    return b;
  }

  function cartao(c) {
    if (c.bloqueada) {
      return el('div', { class: 'ceq-card bloq', role: 'note' }, el('span', { class: 'ic', html: IC.cadeado }),
        el('span', { class: 't' }, el('b', { text: 'Conversa de cliente' }), el('small', { text: 'Você não tem acesso a esta conversa.' })));
    }
    return el('button', { class: 'ceq-card', type: 'button', title: 'Abrir a conversa', onclick: () => st.ui.abrir(c.id) },
      el('span', { class: 'ic', html: IC.conversa }),
      el('span', { class: 't' }, el('b', { text: c.nome }), el('small', { text: `Conversa de cliente${st.ui.UNIDADE?.[c.unidade] ? ' · ' + (st.ui.UNIDADE[c.unidade].nome || st.ui.UNIDADE[c.unidade]) : ''} · toque para abrir` })),
      el('span', { class: 'seta', html: IC.seta }));
  }

  function marcarVistos() {
    for (const b of $('ceq-msgs').querySelectorAll('.bal.env')) b.querySelector('.ck')?.classList.toggle('vista', Number(b.dataset.seq) <= st.vistoAte);
  }

  function desenharMensagens(rolar) {
    const caixa = $('ceq-msgs');
    const nos = [];
    if (st.mais) nos.push(el('button', { class: 'ceq-bt ceq-mais', type: 'button', text: 'Ver mensagens anteriores', onclick: antigas }));
    let ant = null;
    for (const m of st.msgs) {
      if (!ant || DIA(ant.em) !== DIA(m.em)) nos.push(el('div', { class: 'dia', text: rotuloDia(m.em) }));
      nos.push(balao(m, ant)); ant = m;
    }
    if (!st.msgs.length) nos.push(el('div', { class: 'dia', text: salaAberta()?.tipo === 'direta' ? 'Comece a conversa. Só vocês dois veem.' : 'Comece a conversa. Só quem está no grupo vê.' }));
    caixa.replaceChildren(...nos);
    marcarVistos();
    if (rolar) caixa.scrollTop = caixa.scrollHeight;
  }

  function acrescentar(novas) {
    const caixa = $('ceq-msgs');
    const noFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 120;
    if (!st.msgs.length) { st.msgs.push(...novas); desenharMensagens(true); return; }
    for (const m of novas) {
      if (st.msgs.some((x) => x.id === m.id)) continue;
      const ant = st.msgs[st.msgs.length - 1];
      if (ant && DIA(ant.em) !== DIA(m.em)) caixa.append(el('div', { class: 'dia', text: rotuloDia(m.em) }));
      caixa.append(balao(m, ant));
      st.msgs.push(m);
    }
    marcarVistos();
    if (noFim || novas.some((m) => m.eu)) caixa.scrollTop = caixa.scrollHeight;
  }

  async function antigas() {
    if (!st.aberta || !st.msgs.length || st.ocupado) return;
    st.ocupado = true;
    const id = st.aberta;
    try {
      const r = await st.ui.api(`/api/equipe/chat/salas/${id}/mensagens?antes=${st.msgs[0].seq}&limite=60`);
      if (st.aberta !== id) return;
      const caixa = $('ceq-msgs'); const h = caixa.scrollHeight;
      st.msgs = [...r.mensagens, ...st.msgs]; st.mais = r.mais;
      desenharMensagens(false);
      caixa.scrollTop = caixa.scrollHeight - h;
    } catch (x) { st.ui.toast(x.message); } finally { st.ocupado = false; }
  }

  function irPara(id) {
    const b = $('ceq-m-' + id);
    if (!b) { st.ui.toast('Essa mensagem é mais antiga. Role para cima para ver.'); return; }
    b.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    b.classList.add('alvo'); setTimeout(() => b.classList.remove('alvo'), 1600);
  }

  // ---------------------------------------------------------------- escrever

  function responder(m) {
    st.resposta = m; desenharExtra(); $('ceq-texto').focus();
  }
  function desenharExtra() {
    const x = $('ceq-extra'); if (!x) return;
    const partes = [];
    if (st.resposta) partes.push(el('div', { class: 'citacao' }, el('div', { class: 't' }, el('b', { text: `Respondendo a ${st.resposta.eu ? 'você' : st.resposta.autorNome}` }), el('span', { text: st.resposta.texto || 'Conversa compartilhada' })),
      el('button', { class: 'fechar', type: 'button', 'aria-label': 'Cancelar resposta', html: IC.fechar, onclick: () => { st.resposta = null; desenharExtra(); } })));
    if (st.anexo) partes.push(el('div', { class: 'citacao' }, el('div', { class: 't' }, el('b', { text: 'Conversa de cliente' }), el('span', { text: st.anexo.nome })),
      el('button', { class: 'fechar', type: 'button', 'aria-label': 'Tirar a conversa', html: IC.fechar, onclick: () => { st.anexo = null; desenharExtra(); botaoEnviar(); } })));
    x.replaceChildren(...partes); x.hidden = !partes.length;
  }

  async function enviar() {
    const t = $('ceq-texto');
    const texto = t.value.trim();
    if ((!texto && !st.anexo) || !st.aberta || st.enviando) return;
    if (texto.length > 4000) { st.ui.toast('A mensagem pode ter até 4000 letras.'); return; }
    st.enviando = true; $('ceq-enviar').disabled = true;
    const id = st.aberta;
    try {
      const r = await st.ui.post(`/api/equipe/chat/salas/${id}/mensagens`, { texto, ...(st.resposta ? { respostaA: st.resposta.id } : {}), ...(st.anexo ? { conversaId: st.anexo.id } : {}) });
      if (st.aberta === id) { t.value = ''; t.style.height = 'auto'; } st.rascunhos.delete(id); st.resposta = null; st.anexo = null; desenharExtra();
      if (st.aberta === id) acrescentar([r.mensagem]);
      const s = st.salas.find((x) => x.id === id);
      if (s) { s.ultima = { autorId: r.mensagem.autorId, autorNome: r.mensagem.autorNome, eu: true, texto: r.mensagem.texto || 'Compartilhou uma conversa', em: r.mensagem.em }; st.salas = [s, ...st.salas.filter((x) => x !== s)]; desenharLista(); }
    } catch (x) { st.ui.toast(x.message); } finally { st.enviando = false; botaoEnviar(); }
  }

  // ---------------------------------------------------------------- painéis (Nova conversa, Novo grupo, Compartilhar, Grupo)

  const painel = () => window.SintoniaPainel;
  async function pessoas() {
    const r = await st.ui.api('/api/equipe/chat/pessoas');
    st.pessoas = r.pessoas || [];
    return st.pessoas;
  }
  const PAPEL = { atendente: 'Atendente', recepcionista: 'Recepção', gerente: 'Gerência', direcao: 'Direção', admin: 'Administração' };
  function campoBusca(aoMudar, ph = 'Pesquisar pessoa') {
    const i = el('input', { type: 'search', placeholder: ph, 'aria-label': ph });
    i.addEventListener('input', () => aoMudar(i.value.toLowerCase()));
    return el('label', { class: 'busca', html: IC.busca }, i);
  }

  async function novaConversa() {
    let lista;
    try { lista = await pessoas(); } catch (x) { st.ui.toast(x.message); return; }
    const linhas = el('div', { role: 'list' });
    const desenhar = (q = '') => linhas.replaceChildren(...lista.filter((p) => !q || p.nome.toLowerCase().includes(q)).map((p) =>
      el('button', { class: 'ceq-linha', type: 'button', role: 'listitem', onclick: async () => {
        try { const r = await st.ui.post('/api/equipe/chat/direta', { pessoaId: p.id }); painel()?.fechar(); await carregarLista(); abrirSala(r.id); } catch (x) { st.ui.toast(x.message); }
      } }, avPessoa(p.nome, p.id, p.online), el('span', { class: 't' }, el('b', { text: p.nome }), el('small', { text: `${PAPEL[p.papel] || ''} · ${p.online ? 'Online' : 'Offline'}` })))));
    desenhar();
    if (!lista.length) linhas.append(el('div', { class: 'ceq-vazio', text: 'Ainda não há outras pessoas na equipe.' }));
    const grupoBt = el('button', { class: 'ceq-linha', type: 'button', onclick: () => novoGrupo(true) }, avSala({ tipo: 'grupo' }), el('span', { class: 't' }, el('b', { text: 'Novo grupo' }), el('small', { text: 'Escolha um nome e as pessoas' })));
    abrirPainel({ titulo: 'Nova conversa', id: 'ceq-nova', montar: (c) => c.append(el('div', { class: 'ceq-pl' }, campoBusca(desenhar), grupoBt, el('label', { class: 'rot', text: 'Pessoas' }), linhas)) });
  }

  async function novoGrupo(empilhar) {
    let lista;
    try { lista = st.pessoas && empilhar ? st.pessoas : await pessoas(); } catch (x) { st.ui.toast(x.message); return; }
    const nome = el('input', { class: 'ceq-nome', maxlength: '60', placeholder: 'Ex.: Recepção, Gerência, Turno da tarde', 'aria-label': 'Nome do grupo' });
    const marcadas = new Set();
    const criar = el('button', { class: 'ceq-bt prim', type: 'button', text: 'Criar grupo', disabled: '' });
    const conferir = () => { criar.disabled = !nome.value.trim() || !marcadas.size; };
    nome.addEventListener('input', conferir);
    const linhas = escolhaPessoas(lista, marcadas, conferir);
    criar.addEventListener('click', async () => {
      criar.disabled = true;
      try { const r = await st.ui.post('/api/equipe/chat/grupos', { nome: nome.value.trim(), pessoas: [...marcadas] }); painel()?.fechar(); await carregarLista(); abrirSala(r.id); }
      catch (x) { st.ui.toast(x.message); conferir(); }
    });
    const pag = { titulo: 'Novo grupo', id: 'ceq-grupo', montar: (c) => { c.append(el('div', { class: 'ceq-pl' }, el('label', { class: 'rot', text: 'Nome do grupo' }), nome, el('label', { class: 'rot', text: 'Pessoas' }), linhas.busca, linhas.lista, criar)); setTimeout(() => nome.focus(), 250); } };
    if (empilhar && painel()?.aberto?.()) painel().empurrar(pag); else abrirPainel(pag);
  }

  function escolhaPessoas(lista, marcadas, aoMudar) {
    const caixa = el('div', { role: 'group', 'aria-label': 'Pessoas' });
    const desenhar = (q = '') => caixa.replaceChildren(...lista.filter((p) => !q || p.nome.toLowerCase().includes(q)).map((p) => {
      const chk = el('input', { type: 'checkbox', 'aria-label': p.nome });
      chk.checked = marcadas.has(p.id);
      chk.addEventListener('change', () => { if (chk.checked) marcadas.add(p.id); else marcadas.delete(p.id); aoMudar(); });
      return el('label', { class: 'ceq-linha' }, avPessoa(p.nome, p.id, p.online), el('span', { class: 't' }, el('b', { text: p.nome }), el('small', { text: PAPEL[p.papel] || '' })), chk);
    }));
    desenhar();
    return { busca: campoBusca(desenhar), lista: caixa };
  }

  function escolherConversa() {
    const conversas = (st.ui.estado.conversas || []).slice().sort((a, b) => new Date(b.atualizadaEm || 0) - new Date(a.atualizadaEm || 0));
    const linhas = el('div', { role: 'list' });
    const desenhar = (q = '') => {
      const l = conversas.filter((c) => !q || st.ui.nomeDe(c).toLowerCase().includes(q) || String(c.telefone || '').includes(q)).slice(0, 80);
      linhas.replaceChildren(...l.map((c) => el('button', { class: 'ceq-linha', type: 'button', role: 'listitem', onclick: () => { st.anexo = { id: c.id, nome: st.ui.nomeDe(c) }; desenharExtra(); botaoEnviar(); painel()?.fechar(); $('ceq-texto').focus(); } },
        st.ui.avatar(c, 'p'), el('span', { class: 't' }, el('b', { text: st.ui.nomeDe(c) }), el('small', { text: st.ui.formatarTel(c.telefone) })))));
      if (!l.length) linhas.append(el('div', { class: 'ceq-vazio', text: 'Nenhuma conversa encontrada.' }));
    };
    desenhar();
    abrirPainel({ titulo: 'Compartilhar conversa', id: 'ceq-compartilhar', montar: (c) => c.append(el('div', { class: 'ceq-pl' },
      el('small', { style: 'color:var(--sub)', text: 'A conversa aparece como um cartão. Só quem tem acesso a ela consegue abrir.' }), campoBusca(desenhar, 'Pesquisar cliente'), linhas)) });
  }

  async function detalhes() {
    const s = salaAberta();
    if (!s || s.tipo !== 'grupo') return;
    const membros = el('div', { role: 'list' }, ...(s.geral ? [el('div', { class: 'ceq-vazio', text: 'Todas as pessoas ativas da empresa estão neste grupo.' })] : [
      ...s.pessoas.map((p) => el('div', { class: 'ceq-linha', role: 'listitem' }, avPessoa(p.nome, p.id, p.online), el('span', { class: 't' }, el('b', { text: p.nome }), el('small', { text: p.online ? 'Online' : 'Offline' })))),
      el('div', { class: 'ceq-linha', role: 'listitem' }, avPessoa(st.ui.estado.eu?.nome || 'Você', st.ui.estado.eu?.id), el('span', { class: 't' }, el('b', { text: 'Você' }))),
    ]));
    const partes = [el('label', { class: 'rot', text: `${s.membros} pessoas` }), membros];
    if (!s.geral) {
      const nome = el('input', { class: 'ceq-nome', maxlength: '60', value: s.nome, 'aria-label': 'Nome do grupo' });
      const salvar = el('button', { class: 'ceq-bt', type: 'button', text: 'Salvar nome', onclick: async () => {
        try { await st.ui.api(`/api/equipe/chat/salas/${s.id}`, { method: 'PATCH', body: JSON.stringify({ nome: nome.value.trim() }) }); st.ui.toast('Nome salvo ✓'); await carregarLista(); } catch (x) { st.ui.toast(x.message); }
      } });
      const add = el('button', { class: 'ceq-bt', type: 'button', html: IC.mais, onclick: () => adicionar(s) }); add.append(' Adicionar pessoas');
      const sair = el('button', { class: 'ceq-bt perigo', type: 'button', text: 'Sair do grupo', onclick: async () => {
        if (!confirm(`Sair do grupo "${s.nome}"? Você deixa de ver as mensagens.`)) return;
        try { await st.ui.post(`/api/equipe/chat/salas/${s.id}/sair`); painel()?.fechar(); fecharChat(); await carregarLista(); } catch (x) { st.ui.toast(x.message); }
      } });
      partes.unshift(el('label', { class: 'rot', text: 'Nome do grupo' }), nome, salvar);
      partes.push(add, sair);
    }
    abrirPainel({ titulo: s.nome, id: 'ceq-detalhes', montar: (c) => c.append(el('div', { class: 'ceq-pl' }, ...partes)) });
  }

  async function adicionar(s) {
    let lista;
    try { lista = (await pessoas()).filter((p) => !s.pessoas.some((x) => x.id === p.id)); } catch (x) { st.ui.toast(x.message); return; }
    const marcadas = new Set();
    const ok = el('button', { class: 'ceq-bt prim', type: 'button', text: 'Adicionar', disabled: '' });
    const linhas = escolhaPessoas(lista, marcadas, () => { ok.disabled = !marcadas.size; });
    ok.addEventListener('click', async () => {
      try { await st.ui.api(`/api/equipe/chat/salas/${s.id}`, { method: 'PATCH', body: JSON.stringify({ adicionar: [...marcadas] }) }); painel()?.fechar(); st.ui.toast('Pessoas adicionadas ✓'); await carregarLista(); }
      catch (x) { st.ui.toast(x.message); }
    });
    const pag = { titulo: 'Adicionar pessoas', montar: (c) => c.append(el('div', { class: 'ceq-pl' }, lista.length ? linhas.busca : null, lista.length ? linhas.lista : el('div', { class: 'ceq-vazio', text: 'Todas as pessoas já estão no grupo.' }), ok)) };
    if (painel()?.aberto?.()) painel().empurrar(pag); else abrirPainel(pag);
  }

  function abrirPainel(p) {
    if (painel()) painel().abrir(p);
    else st.ui.toast('Não foi possível abrir agora. Tente de novo.');
  }

  // ---------------------------------------------------------------- atualizar sozinho

  async function conferir() {
    if (!st.ui || document.hidden) return;
    let r;
    try { r = await st.ui.api('/api/equipe/chat/resumo'); } catch { return; }
    contador(r.naoLidas);
    if (r.versao === st.versao) return;
    st.versao = r.versao;
    if (st.ui.estado.vista !== VISTA || !st.montado) return;
    await carregarLista().catch(() => {});
    if (st.aberta) await novasDaAberta();
  }
  async function novasDaAberta() {
    const id = st.aberta;
    const ult = st.msgs.length ? st.msgs[st.msgs.length - 1].seq : 0;
    try {
      const r = await st.ui.api(`/api/equipe/chat/salas/${id}/mensagens?depois=${ult}&limite=200`);
      if (st.aberta !== id) return;
      st.vistoAte = r.vistoAte;
      if (r.mensagens.length) acrescentar(r.mensagens); else marcarVistos();
      await lida(id);
    } catch {}
  }

  // ---------------------------------------------------------------- entrada

  async function desenhar(caixa, ui) {
    st.ui = ui;
    if (st.caixa !== caixa || !st.montado || !caixa.querySelector('#ceq-itens')) { st.caixa = caixa; st.linhas.clear(); montar(); }
    // Celular: a aba Conversas da barra fica acesa (Conversas › Equipe).
    document.querySelector('.trilho .nav[data-vista="conversas"]')?.setAttribute('aria-current', 'page');
    try { await carregarLista(); } catch (x) { ui.toast(x.message); return; }
    if (st.abrirDepois) { const id = st.abrirDepois; st.abrirDepois = null; abrirSala(id); }
    else if (st.aberta) novasDaAberta();
  }

  async function iniciar() {
    for (let i = 0; i < 100 && !(window.Sintonia?.ui?.estado?.eu); i++) await new Promise((r) => setTimeout(r, 150));
    const ui = window.Sintonia?.ui; if (!ui) return;
    st.ui = ui;
    const bt = $('lt-chat-equipe'); if (bt) bt.hidden = false;
    conferir();
    setInterval(conferir, 8000);
    addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
    addEventListener('sintonia:fotos', () => { st.linhas.clear(); desenharLista(); });
    // Saiu da tela com o chat aberto no celular: a barra de baixo volta.
    setInterval(() => { if (st.escondeuBarra && ui.estado.vista !== VISTA) devolverBarra(); }, 1000);
  }

  window.SintoniaTelas.equipe = {
    vista: VISTA,
    desenhar,
    /** Abre a tela (e, se pedir, uma conversa da equipe). */
    abrir(salaId) { if (salaId) st.abrirDepois = salaId; window.Sintonia?.mostrar?.(VISTA); },
    naoLidas: () => st.naoLidas,
  };
  iniciar();
})();
