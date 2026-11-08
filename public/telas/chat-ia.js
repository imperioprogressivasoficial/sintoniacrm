/* "Ajuda da IA": chat com a IA para a equipe do salão (window.SintoniaChatIa = { abrir, fechar, limpar }).
 * Abre pela bolinha de acesso rápido. Tela cheia no celular, painel grande no computador.
 * Fala com POST /api/ia/chat; o histórico fica só nesta aba (sessionStorage) e só as últimas 20 mensagens vão para a IA.
 * O texto da IA nunca entra como HTML: quebras de linha, listas e **negrito** viram elementos montados à mão. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { el, post, estado } = ui;
  const CHAVE = 'sintonia.chatIa';
  const MAX_TEXTO = 4000;
  const INICIOS = ['Como está o dia hoje?', 'Quem está esperando resposta?', 'Escreva uma mensagem para chamar clientes sumidas', 'Resuma os agendamentos de amanhã'];
  const SVG = {
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    nova: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l4-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/><path d="M13.5 7.5l3 3"/></svg>',
    enviar: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.4 20.4 21 12 3.4 3.6l-.01 6.53L15 12 3.39 13.87Z"/></svg>',
    brilho: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" opacity=".75"/></svg>',
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
  };

  const CSS = `
  dialog.cia { padding: 0; width: min(760px, calc(100vw - 48px)); height: min(86vh, 860px); max-height: none; border-radius: 28px; overflow: hidden; display: none; flex-direction: column; color: var(--texto); background: var(--fundo); }
  dialog.cia[open] { display: flex; }
  dialog.cia::backdrop { background: rgba(4, 18, 31, .45); }
  @media (max-width: 760px) { dialog.cia { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border-radius: 0; border: 0; } }
  .cia-topo { display: flex; align-items: center; gap: 10px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); border-bottom: 1px solid var(--linha); flex: none; }
  .cia-topo h2 { flex: 1; margin: 0; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 10px; min-width: 0; }
  .cia-marca { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; color: #06263f; background: linear-gradient(135deg, #0ffcbe 0%, #1a8be0 100%); box-shadow: 0 0 12px rgba(15,252,190,.35); }
  .cia-marca svg { width: 18px; height: 18px; }
  .cia-bt { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 40px; padding: 0 12px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--texto); background: var(--sel); }
  .cia-bt.redondo { width: 40px; padding: 0; justify-content: center; }
  .cia-bt svg { width: 18px; height: 18px; }
  .cia-bt:focus-visible, .cia-enviar:focus-visible, .cia-inicio:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .cia-msgs { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 18px 16px 8px; display: flex; flex-direction: column; gap: 12px; }
  .cia-vazio { margin: auto 0; display: grid; justify-items: center; gap: 14px; text-align: center; padding: 10px 4px 20px; }
  .cia-vazio .cia-marca { width: 56px; height: 56px; } .cia-vazio .cia-marca svg { width: 30px; height: 30px; }
  .cia-vazio h3 { margin: 0; font-size: 21px; }
  .cia-vazio p { margin: 0; color: var(--sub); font-size: 14.5px; line-height: 20px; max-width: 420px; }
  .cia-inicios { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; max-width: 560px; margin-top: 4px; }
  @media (max-width: 480px) { .cia-inicios { grid-template-columns: 1fr; } }
  .cia-inicio { all: unset; cursor: pointer; box-sizing: border-box; padding: 12px 14px; border-radius: 16px; font-size: 14.5px; line-height: 19px; text-align: left; color: var(--texto); background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--linha); }
  .cia-inicio:hover { box-shadow: inset 0 0 0 1.5px var(--marca-azul); }
  .cia-m { max-width: min(86%, 600px); padding: 10px 14px; border-radius: 20px; font-size: 15.5px; line-height: 22px; overflow-wrap: anywhere; }
  .cia-m.eu { align-self: flex-end; background: var(--marca-azul, #106ebe); color: #fff; border-bottom-right-radius: 6px; white-space: pre-wrap; }
  .cia-m.ia { align-self: flex-start; background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); border-bottom-left-radius: 6px; }
  .cia-m.ia p { margin: 0 0 8px; } .cia-m.ia p:last-child { margin-bottom: 0; }
  .cia-m.ia ul { margin: 0 0 8px; padding-left: 20px; } .cia-m.ia ul:last-child { margin-bottom: 0; }
  .cia-m.ia li { margin: 2px 0; }
  .cia-acoes { display: flex; gap: 6px; margin-top: 6px; }
  .cia-acoes button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--sub); padding: 4px 8px; border-radius: 999px; }
  .cia-acoes button:hover { background: var(--sel); color: var(--texto); }
  .cia-acoes svg { width: 15px; height: 15px; }
  .cia-digitando { align-self: flex-start; display: flex; gap: 5px; padding: 14px 16px; border-radius: 20px; background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); }
  .cia-digitando i { width: 8px; height: 8px; border-radius: 50%; background: var(--sub); animation: ciaPulo 1.2s ease-in-out infinite; }
  .cia-digitando i:nth-child(2) { animation-delay: .15s; } .cia-digitando i:nth-child(3) { animation-delay: .3s; }
  @keyframes ciaPulo { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-5px); opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .cia-digitando i { animation: none; } }
  .cia-aviso { align-self: stretch; margin: 0; padding: 12px 14px; border-radius: 14px; background: var(--aviso); color: var(--aviso-txt); font-size: 14px; line-height: 19px; }
  .cia-aviso a { color: inherit; font-weight: 700; }
  .cia-erro { align-self: stretch; margin: 0; padding: 10px 14px; border-radius: 14px; background: color-mix(in srgb, #e5484d 14%, transparent); font-size: 14px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .cia-erro button { all: unset; cursor: pointer; font-weight: 700; color: var(--azul, var(--marca-azul)); }
  .cia-compor { flex: none; display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); border-top: 1px solid var(--linha); }
  .cia-compor textarea { flex: 1; min-width: 0; resize: none; font: inherit; font-size: 16px; line-height: 22px; max-height: 160px; padding: 10px 16px; border-radius: 22px; color: var(--texto); background: var(--entrada, var(--painel)); border: 1px solid var(--linha); }
  .cia-compor textarea:focus { outline: none; border-color: var(--marca-azul); }
  .cia-enviar { all: unset; cursor: pointer; flex: none; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--marca-azul, #106ebe); }
  .cia-enviar[disabled] { opacity: .45; cursor: default; }
  .cia-enviar svg { width: 21px; height: 21px; }
  `;

  // ---------- estado (só nesta aba) ----------
  const ler = () => { try { const v = JSON.parse(sessionStorage.getItem(CHAVE) || '[]'); return Array.isArray(v) ? v.filter((m) => m && (m.papel === 'usuario' || m.papel === 'ia') && typeof m.texto === 'string') : []; } catch { return []; } };
  const gravar = () => { try { sessionStorage.setItem(CHAVE, JSON.stringify(mensagens.slice(-60))); } catch { /* sem armazenamento: só esta tela lembra */ } };
  let mensagens = ler();
  let enviando = false;
  let falha = null; // { texto, semChave }

  // ---------- texto da IA → elementos (sem innerHTML) ----------
  function comNegrito(linha) {
    const frag = document.createDocumentFragment();
    const partes = String(linha).split(/(\*\*[^*\n]+\*\*)/g);
    for (const p of partes) {
      if (!p) continue;
      if (/^\*\*[^*\n]+\*\*$/.test(p)) frag.append(el('b', { text: p.slice(2, -2) }));
      else frag.append(document.createTextNode(p));
    }
    return frag;
  }
  function formatar(texto) {
    const caixa = document.createDocumentFragment();
    let lista = null, par = null;
    for (const bruta of String(texto).replace(/\r/g, '').split('\n')) {
      const linha = bruta.replace(/^#{1,6}\s+/, '');
      const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(linha);
      if (item) {
        par = null;
        if (!lista) { lista = el('ul'); caixa.append(lista); }
        lista.append(el('li', {}, comNegrito(item[1])));
      } else if (!linha.trim()) { lista = null; par = null; }
      else {
        lista = null;
        if (par) par.append(el('br'), comNegrito(linha));
        else { par = el('p', {}, comNegrito(linha)); caixa.append(par); }
      }
    }
    return caixa;
  }

  // ---------- tela ----------
  let d, msgs, campo, enviar;
  function montar() {
    if (d) return;
    document.head.append(el('style', { id: 'chat-ia-css', text: CSS }));
    campo = el('textarea', { rows: '1', maxlength: String(MAX_TEXTO), placeholder: 'Pergunte à IA…', 'aria-label': 'Pergunta para a IA', enterkeyhint: 'send' });
    enviar = el('button', { type: 'button', class: 'cia-enviar', 'aria-label': 'Enviar', html: SVG.enviar, onclick: () => mandar(campo.value) });
    msgs = el('div', { class: 'cia-msgs', role: 'log', 'aria-live': 'polite' });
    d = el('dialog', { class: 'cia', id: 'd-chat-ia', 'aria-label': 'Ajuda da IA' },
      el('div', { class: 'cia-topo' },
        el('button', { type: 'button', class: 'cia-bt redondo', 'aria-label': 'Fechar', html: SVG.fechar, onclick: fechar }),
        el('h2', {}, el('span', { class: 'cia-marca', html: SVG.brilho }), el('span', { text: 'Ajuda da IA' })),
        el('button', { type: 'button', class: 'cia-bt', html: SVG.nova, title: 'Começar uma conversa nova', onclick: limpar }, el('span', { text: 'Nova conversa' }))),
      msgs,
      el('div', { class: 'cia-compor' }, campo, enviar));
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    campo.addEventListener('input', () => { ajustarCampo(); atualizarBotao(); });
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(min-width: 761px)').matches) { e.preventDefault(); mandar(campo.value); } });
    document.body.append(d);
  }
  const ajustarCampo = () => { campo.style.height = 'auto'; campo.style.height = Math.min(campo.scrollHeight + 2, 160) + 'px'; };
  const atualizarBotao = () => { enviar.disabled = enviando || !campo.value.trim(); };
  const ehAdmin = () => ['admin', 'direcao'].includes(estado.eu?.papel);
  const copiar = async (t) => { try { await navigator.clipboard.writeText(t); ui.toast('Copiado ✓'); } catch { ui.toast('Não deu para copiar aqui.'); } };

  function desenhar() {
    msgs.replaceChildren();
    if (!mensagens.length && !falha) {
      msgs.append(el('div', { class: 'cia-vazio' },
        el('span', { class: 'cia-marca', html: SVG.brilho }),
        el('h3', { text: `Oi${estado.eu?.nome ? ', ' + String(estado.eu.nome).split(/\s+/)[0] : ''}! Como posso ajudar?` }),
        el('p', { text: 'Pergunte sobre o dia, quem está esperando resposta, a agenda ou peça um texto para mandar às clientes. A IA responde com os dados que você pode ver aqui.' }),
        el('div', { class: 'cia-inicios' }, ...INICIOS.map((t) => el('button', { type: 'button', class: 'cia-inicio', text: t, onclick: () => mandar(t) })))));
    }
    for (const m of mensagens) {
      if (m.papel === 'usuario') msgs.append(el('div', { class: 'cia-m eu', text: m.texto }));
      else msgs.append(el('div', { class: 'cia-m ia' }, formatar(m.texto), el('div', { class: 'cia-acoes' }, el('button', { type: 'button', html: SVG.copiar, onclick: () => copiar(m.texto) }, document.createTextNode('Copiar')))));
    }
    if (enviando) msgs.append(el('div', { class: 'cia-digitando', 'aria-label': 'A IA está escrevendo' }, el('i'), el('i'), el('i')));
    if (falha?.semChave) {
      msgs.append(el('p', { class: 'cia-aviso' }, document.createTextNode('A IA ainda está desligada: falta configurar a chave da IA (Anthropic) em Conexões. '), ehAdmin() ? el('a', { href: '/conexoes', text: 'Abrir Conexões' }) : null));
    } else if (falha) {
      msgs.append(el('p', { class: 'cia-erro' }, el('span', { text: falha.texto }), el('button', { type: 'button', text: 'Tentar de novo', onclick: tentarDeNovo })));
    }
    atualizarBotao();
    requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
  }

  async function pedir() {
    enviando = true; falha = null; desenhar();
    try {
      const r = await post('/api/ia/chat', { mensagens: mensagens.slice(-20) });
      mensagens.push({ papel: 'ia', texto: String(r.texto || '') });
      gravar();
    } catch (x) {
      falha = { texto: x.message || 'Não deu certo agora.', semChave: x.status === 501 || /chave da IA/i.test(x.message || '') };
    } finally { enviando = false; if (d?.open) desenhar(); }
  }
  function mandar(texto) {
    const t = String(texto || '').trim().slice(0, MAX_TEXTO);
    if (!t || enviando) return;
    mensagens.push({ papel: 'usuario', texto: t }); gravar();
    campo.value = ''; ajustarCampo();
    pedir();
    campo.focus({ preventScroll: true });
  }
  function tentarDeNovo() { if (mensagens.at(-1)?.papel === 'usuario') pedir(); else { falha = null; desenhar(); } }
  function limpar() { mensagens = []; falha = null; gravar(); desenhar(); campo?.focus({ preventScroll: true }); }

  function abrir() {
    montar();
    if (!d.open) d.showModal();
    desenhar(); ajustarCampo();
    if (matchMedia('(min-width: 761px)').matches) campo.focus({ preventScroll: true });
  }
  function fechar() { d?.close(); }

  window.SintoniaChatIa = { abrir, fechar, limpar };
})();
