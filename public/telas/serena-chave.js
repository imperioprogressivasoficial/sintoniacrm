/* serena-chave: chave geral "Serena ligada / pausada" (pedido do dono, 21/11/2026).
 * window.SintoniaSerenaChave = {
 *   estado(), pausada(), carregar(),
 *   chave({ tamanho: 'grande' | 'pequena' }) → elemento da chave (Inteligência e Serena), que se atualiza sozinho,
 *   rotuloChip(c), dataChip(c) → chip de baixo da conversa ("Serena pausada · equipe atende").
 * }
 * Também põe a faixa "Serena pausada até 15h — a equipe atende tudo. [Ligar]" no topo de Conversas.
 * O estado vem de GET /api/ia/pausa (todo mundo vê; só a gestão muda com PUT). Confere de novo a cada 30 s com a
 * aba visível, e na hora em que a aba volta. Sem animação em loop: só a transição da chave quando ela muda.
 * Todo texto que vem do servidor entra por textContent. */
(() => {
  const ui = () => window.Sintonia?.ui;
  const el = (tag, props = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f != null) e.append(f);
    return e;
  };
  const toast = (t) => (ui()?.toast ? ui().toast(t) : null);
  // Ícones (texto fixo nosso): traço 1.8, pontas arredondadas.
  const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    pausa: I('<circle cx="12" cy="12" r="8.5"/><path d="M10 9v6M14 9v6"/>'),
    relogio: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    lua: I('<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a.6.6 0 0 0-.8-.7A8.6 8.6 0 1 0 20.2 15.4a.6.6 0 0 0-.7-.8Z"/>'),
    mao: I('<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V5a1.5 1.5 0 0 1 3 0v5M13 10.5V6.5a1.5 1.5 0 0 1 3 0V13"/><path d="M16 9.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.6 14a1.5 1.5 0 0 1 2.4-1.8L7 12.5"/>'),
    certo: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    chave: I('<circle cx="7.5" cy="15.5" r="4"/><path d="m10.4 12.6 9.1-9.1M16.5 6.5l2.5 2.5M14.5 8.5l2 2"/>'),
  };

  const CSS = `
  .sc-chave { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 12px; font-family: var(--fonte, inherit); color: var(--texto); -webkit-tap-highlight-color: transparent; }
  .sc-chave[aria-disabled="true"] { cursor: default; }
  .sc-chave:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 3px; border-radius: 16px; }
  .sc-trilho { position: relative; flex: none; width: 50px; height: 30px; border-radius: 999px; background: var(--linha, #d6dde6); box-shadow: inset 0 0 0 1px rgba(13,34,64,.08); transition: background .2s ease; }
  .sc-trilho::after { content: ""; position: absolute; left: 3px; top: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(13,34,64,.28); transition: transform .2s ease; }
  .sc-chave[aria-checked="true"] .sc-trilho { background: linear-gradient(90deg, #106ebe, #3aa0ff); box-shadow: none; }
  .sc-chave[aria-checked="true"] .sc-trilho::after { transform: translateX(20px); }
  .sc-chave[aria-disabled="true"] .sc-trilho { opacity: .55; }
  .sc-txt { display: grid; gap: 1px; min-width: 0; text-align: left; }
  .sc-txt b { font-size: 15px; font-weight: 650; line-height: 1.25; }
  .sc-txt small { font-size: 12.5px; color: var(--sub); line-height: 1.3; }
  /* grande: Inteligência (topo) */
  .sc-chave.grande { padding: 10px 16px 10px 12px; border-radius: 18px; background: var(--fundo); border: 1px solid var(--linha); min-height: 56px; max-width: 100%; }
  .sc-chave.grande .sc-txt b { font-size: 16px; }
  .sc-chave.grande .sc-txt { flex: 1; }
  @media (max-width: 760px) { .iax-topo .sc-chave.grande { width: 100%; } }
  .sc-chave.grande.pausada { background: var(--aviso, #fff6db); border-color: transparent; }
  .sc-chave.grande.pausada .sc-txt b { color: var(--aviso-txt, #5e4b00); }
  .sc-chave.grande.pausada .sc-txt small { color: var(--aviso-txt, #5e4b00); opacity: .85; }
  .sc-chave.grande.ligada { box-shadow: 0 0 0 1px rgba(15,252,190,.0); }
  .sc-chave.grande.ligada .sc-ic { color: #0aa57f; }
  .sc-ic { width: 22px; height: 22px; flex: none; display: grid; color: var(--sub); }
  .sc-chave.grande.pausada .sc-ic { color: var(--aviso-txt, #5e4b00); }
  .sc-ic svg { width: 22px; height: 22px; }
  /* pequena: Serena (ao lado do título) */
  .sc-chave.pequena { gap: 7px; padding: 4px 9px 4px 5px; border-radius: 999px; background: var(--srn-vidro, rgba(127,127,127,.08)); border: 1px solid var(--linha); }
  .sc-chave.pequena .sc-trilho { width: 30px; height: 18px; }
  .sc-chave.pequena .sc-trilho::after { width: 14px; height: 14px; left: 2px; top: 2px; }
  .sc-chave.pequena[aria-checked="true"] .sc-trilho::after { transform: translateX(12px); }
  .sc-chave.pequena .sc-txt b { font-size: 12.5px; font-weight: 600; white-space: nowrap; }
  .sc-chave.pequena .sc-txt small { display: none; }
  .sc-chave.pequena.pausada { background: var(--aviso, #fff6db); border-color: transparent; }
  .sc-chave.pequena.pausada .sc-txt b { color: var(--aviso-txt, #5e4b00); }
  @media (max-width: 760px) { .srn-cab .sc-chave.pequena { padding: 6px; } .srn-cab .sc-chave.pequena .sc-txt { display: none; } }

  /* folha "Pausar por quanto tempo?" */
  dialog.sc-folha { padding: 0; border: 0; width: min(460px, calc(100vw - 24px)); border-radius: 20px; background: var(--fundo); color: var(--texto); box-shadow: 0 24px 60px rgba(13,34,64,.28); }
  dialog.sc-folha::backdrop { background: rgba(7,20,39,.45); }
  .sc-folha-corpo { padding: 20px; display: grid; gap: 14px; font-family: var(--fonte, inherit); }
  .sc-folha h2 { margin: 0; font-size: 19px; font-weight: 700; }
  .sc-folha .sc-intro { margin: -6px 0 0; color: var(--sub); font-size: 14px; line-height: 1.45; }
  .sc-opcoes { display: grid; gap: 8px; }
  .sc-op { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--linha); background: var(--painel, transparent); font-size: 15px; font-weight: 550; }
  .sc-op i { width: 22px; height: 22px; flex: none; display: grid; color: var(--sub); }
  .sc-op i svg { width: 22px; height: 22px; }
  .sc-op span { flex: 1; min-width: 0; display: grid; }
  .sc-op small { font-size: 12.5px; font-weight: 400; color: var(--sub); }
  .sc-op .sc-marca { width: 20px; height: 20px; border-radius: 50%; border: 1.8px solid var(--linha); display: grid; place-items: center; color: #fff; }
  .sc-op .sc-marca svg { width: 13px; height: 13px; opacity: 0; }
  .sc-op[aria-checked="true"] { border-color: var(--marca-azul, #106ebe); box-shadow: inset 0 0 0 1px var(--marca-azul, #106ebe); }
  .sc-op[aria-checked="true"] i { color: var(--marca-azul, #106ebe); }
  .sc-op[aria-checked="true"] .sc-marca { background: var(--marca-azul, #106ebe); border-color: var(--marca-azul, #106ebe); }
  .sc-op[aria-checked="true"] .sc-marca svg { opacity: 1; }
  .sc-op:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 2px; }
  .sc-explica { margin: 0; padding: 12px 14px; border-radius: 14px; background: var(--painel, rgba(127,127,127,.06)); font-size: 13.5px; line-height: 1.45; color: var(--texto); display: grid; gap: 6px; }
  .sc-explica b { font-weight: 650; }
  .sc-explica ul { margin: 0; padding-left: 18px; display: grid; gap: 3px; color: var(--sub); }
  .sc-explica p { margin: 0; color: var(--sub); }
  .sc-rodape { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
  .sc-bt { all: unset; box-sizing: border-box; cursor: pointer; padding: 11px 18px; border-radius: 999px; font-size: 14.5px; font-weight: 600; text-align: center; }
  .sc-bt.leve { color: var(--texto); background: var(--painel, rgba(127,127,127,.1)); }
  .sc-bt.forte { color: #fff; background: #0d2240; }
  html[data-tema="escuro"] .sc-bt.forte { background: #e9f3ff; color: #0d2240; }
  .sc-bt[disabled] { opacity: .6; cursor: default; }
  .sc-bt:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 2px; }
  @media (max-width: 760px) {
    dialog.sc-folha { margin: auto auto 0; width: 100vw; max-width: 100vw; border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); }
    .sc-rodape { display: grid; grid-template-columns: 1fr 1fr; }
  }

  /* faixa no topo de Conversas */
  .sc-faixa { display: flex; align-items: center; gap: 10px; margin: 4px 12px 8px; padding: 9px 10px 9px 12px; border-radius: 14px; background: var(--aviso, #fff6db); color: var(--aviso-txt, #5e4b00); font-size: 13px; line-height: 1.35; }
  .sc-faixa[hidden] { display: none; }
  .sc-faixa > i { width: 20px; height: 20px; flex: none; display: grid; }
  .sc-faixa > i svg { width: 20px; height: 20px; }
  .sc-faixa > span { flex: 1; min-width: 0; }
  .sc-faixa b { font-weight: 650; }
  .sc-faixa button { all: unset; cursor: pointer; flex: none; padding: 6px 12px; border-radius: 999px; font-weight: 650; font-size: 12.5px; background: rgba(94,75,0,.12); color: inherit; }
  html[data-tema="escuro"] .sc-faixa button { background: rgba(255,212,122,.16); }
  .sc-faixa button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }

  /* chip de baixo da conversa: "Serena pausada · equipe atende" */
  .modo[data-m="pausada"] i { background: #e0a100 !important; box-shadow: none !important; }
  .linha-compor .modo[data-m="pausada"] { box-shadow: inset 0 0 0 1px rgba(224,161,0,.55); }
  @media (min-width: 761px) { #chat-aberto .linha-compor .modo[data-m="pausada"] { max-width: 320px; } }
  `;
  if (!document.getElementById('sc-css')) document.head.append(el('style', { id: 'sc-css', text: CSS }));

  // ---------------------------------------------------------------- estado
  let est = null; // { pausada, ate, por, em, motivo, texto, temChave, podeMudar }
  let pedido = null;
  const montadas = new Set();

  const doEstadoInicial = () => {
    const s = ui()?.estado?.situacao?.serena;
    if (!est && s) est = { ...s, temChave: Boolean(ui().estado.situacao.iaLigada), podeMudar: Boolean(ui().ehGestor?.(ui().estado.eu || {})) };
  };

  async function carregar() {
    if (pedido) return pedido;
    pedido = fetch('/api/ia/pausa', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) aplicar(j); return est; })
      .catch(() => est)
      .finally(() => { pedido = null; });
    return pedido;
  }

  function aplicar(novo) {
    const antes = est ? JSON.stringify(est) : '';
    est = novo;
    const st = ui()?.estado?.situacao;
    if (st) st.serena = { pausada: novo.pausada, ate: novo.ate, por: novo.por, em: novo.em, motivo: novo.motivo, texto: novo.texto };
    if (antes === JSON.stringify(est)) return;
    redesenhar();
    dispatchEvent(new CustomEvent('sintonia:serena-chave', { detail: { ...est } }));
  }

  const pausada = () => { doEstadoInicial(); return Boolean(est?.pausada); };

  // ---------------------------------------------------------------- textos
  const primeiro = (n) => String(n || '').trim().split(/\s+/)[0] || '';
  function textos(e, tamanho) {
    if (!e) return { b: tamanho === 'pequena' ? 'Serena' : 'Serena', s: 'Carregando…', on: false, desl: true };
    if (!e.temChave) return { b: tamanho === 'pequena' ? 'Desligada' : 'Serena desligada', s: 'Falta a chave em Conexões', on: false, desl: true };
    if (e.pausada) {
      const quem = primeiro(e.por);
      return {
        b: tamanho === 'pequena' ? `Pausada ${e.texto || ''}`.trim() : `Serena pausada ${e.texto || ''}`.trim(),
        s: e.podeMudar ? `A equipe atende tudo${quem ? ` · pausada por ${quem}` : ''}` : 'Só a gestão liga e desliga',
        on: false,
        desl: !e.podeMudar,
      };
    }
    return { b: tamanho === 'pequena' ? 'Ligada' : 'Serena ligada', s: e.podeMudar ? 'Atende as clientes sozinha' : 'Só a gestão liga e desliga', on: true, desl: !e.podeMudar };
  }

  // ---------------------------------------------------------------- a chave
  function chave(o = {}) {
    doEstadoInicial();
    const tamanho = o.tamanho === 'pequena' ? 'pequena' : 'grande';
    const b = el('button', { type: 'button', role: 'switch', class: `sc-chave ${tamanho}` });
    b.addEventListener('click', () => tocar(b));
    b._sc = tamanho;
    montadas.add(b);
    pintar(b);
    if (!est) carregar();
    return b;
  }
  function pintar(b) {
    const t = textos(est, b._sc);
    b.setAttribute('aria-checked', String(t.on));
    b.setAttribute('aria-disabled', String(t.desl));
    b.classList.toggle('pausada', Boolean(est?.pausada && est?.temChave));
    b.classList.toggle('ligada', t.on);
    b.title = !est ? '' : !est.temChave ? 'Falta a chave da IA em Conexões' : !est.podeMudar ? 'Só a gestão liga e desliga a Serena' : t.on ? 'Pausar a Serena' : 'Ligar a Serena de novo';
    b.setAttribute('aria-label', `${t.b}. ${t.s}`);
    const filhos = [];
    if (b._sc === 'grande') filhos.push(el('span', { class: 'sc-ic', html: est && !est.temChave ? IC.chave : est?.pausada ? IC.pausa : IC.certo }));
    filhos.push(el('span', { class: 'sc-txt' }, el('b', { text: t.b }), el('small', { text: t.s })));
    filhos.push(el('span', { class: 'sc-trilho', 'aria-hidden': 'true' }));
    if (b._sc === 'pequena') filhos.reverse();
    b.replaceChildren(...filhos);
  }
  async function tocar(b) {
    if (!est) { await carregar(); if (!est) return; }
    if (!est.temChave) { toast('Falta a chave da IA em Conexões.'); return; }
    if (!est.podeMudar) { toast('Só a gestão liga e desliga a Serena.'); return; }
    if (est.pausada) await mudar({ pausada: false }, 'Serena ligada de novo. Ela responde quem escreveu há menos de 30 min.');
    else abrirFolha();
  }

  async function mudar(corpo, aviso) {
    try {
      const r = await fetch('/api/ia/pausa', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não deu para mudar agora. Tente de novo.');
      aplicar(j);
      if (aviso) toast(typeof aviso === 'function' ? aviso(j) : aviso);
      return true;
    } catch (x) {
      toast(x.message);
      return false;
    }
  }

  // ---------------------------------------------------------------- folha "Pausar por quanto tempo?"
  function abrirFolha() {
    document.querySelector('dialog.sc-folha')?.remove();
    let escolha = '1h';
    const opcoes = [
      { id: '1h', ic: IC.relogio, t: '1 hora', s: 'Volta sozinha daqui a 1 hora' },
      { id: 'amanha', ic: IC.lua, t: 'Até amanhã às 8h', s: 'Volta sozinha amanhã de manhã' },
      { id: 'indefinido', ic: IC.mao, t: 'Até eu ligar de novo', s: 'Fica pausada até alguém da gestão ligar' },
    ];
    const grupo = el('div', { class: 'sc-opcoes', role: 'radiogroup', 'aria-label': 'Por quanto tempo' });
    const botoes = opcoes.map((op) => {
      const b = el('button', { type: 'button', role: 'radio', class: 'sc-op', 'aria-checked': String(op.id === escolha), onclick: () => marcar(op.id) },
        el('i', { html: op.ic }), el('span', {}, document.createTextNode(op.t), el('small', { text: op.s })), el('em', { class: 'sc-marca', html: IC.certo }));
      b.dataset.id = op.id;
      return b;
    });
    const marcar = (id) => { escolha = id; for (const b of botoes) b.setAttribute('aria-checked', String(b.dataset.id === id)); };
    grupo.append(...botoes);
    grupo.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const i = opcoes.findIndex((o) => o.id === escolha);
      const n = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : opcoes.length - 1)) % opcoes.length;
      marcar(opcoes[n].id); botoes[n].focus();
    });
    const pausar = el('button', { type: 'button', class: 'sc-bt forte', text: 'Pausar a Serena' });
    const dlg = el('dialog', { class: 'sc-folha', 'aria-labelledby': 'sc-folha-tit' },
      el('div', { class: 'sc-folha-corpo' },
        el('h2', { id: 'sc-folha-tit', text: 'Pausar por quanto tempo?' }),
        el('p', { class: 'sc-intro', text: 'A Serena para de atender as clientes e a equipe atende tudo. A chave da IA e as configurações não mudam.' }),
        grupo,
        el('div', { class: 'sc-explica' },
          el('b', { text: 'Enquanto estiver pausada' }),
          el('ul', {},
            el('li', { text: 'A Serena não responde, não sugere e não manda follow-up para as clientes.' }),
            el('li', { text: 'As conversas novas entram em Minha resposta.' }),
            el('li', { text: 'Quem estava com a Serena e escrever aparece em Esperando para a equipe.' }),
            el('li', { text: 'O chat da Serena aqui no app continua funcionando para a equipe.' })),
          el('b', { text: 'Quando ela voltar' }),
          el('p', { text: 'Responde só quem escreveu há menos de 30 minutos. As conversas mais antigas ficam com a equipe.' })),
        el('div', { class: 'sc-rodape' },
          el('button', { type: 'button', class: 'sc-bt leve', text: 'Cancelar', onclick: () => dlg.close() }),
          pausar)));
    pausar.addEventListener('click', async () => {
      pausar.disabled = true;
      const ok = await mudar({ pausada: true, duracao: escolha }, (j) => `Serena pausada ${j.texto || ''}. A equipe atende tudo.`.replace(/\s+\./, '.'));
      pausar.disabled = false;
      if (ok) dlg.close();
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    dlg.showModal();
    botoes[0].focus();
  }

  // ---------------------------------------------------------------- faixa de Conversas
  function faixa() {
    const lista = document.querySelector('#v-conversas .lista');
    const itens = document.getElementById('itens');
    if (!lista || !itens) return;
    let f = document.getElementById('sc-faixa');
    const mostrar = Boolean(est?.pausada && est?.temChave);
    if (!mostrar) { if (f) f.hidden = true; return; }
    if (!f) {
      f = el('div', { id: 'sc-faixa', class: 'sc-faixa', role: 'status' });
      itens.before(f);
    }
    f.hidden = false;
    f.replaceChildren(...[
      el('i', { html: IC.pausa }),
      el('span', {}, el('b', { text: `Serena pausada ${est.texto || ''}`.trim() }), document.createTextNode(' — a equipe atende tudo.')),
      est.podeMudar ? el('button', { type: 'button', text: 'Ligar', 'aria-label': 'Ligar a Serena de novo', onclick: () => mudar({ pausada: false }, 'Serena ligada de novo. Ela responde quem escreveu há menos de 30 min.') }) : null,
    ].filter(Boolean));
  }

  // ---------------------------------------------------------------- chip da conversa
  // No celular o chip é estreito: "Serena pausada" (a faixa e a folha do chip explicam o resto).
  const rotuloChip = (c) => (c && c.modo === 'ia' && pausada() ? (matchMedia('(max-width: 760px)').matches ? 'Serena pausada' : 'Serena pausada · equipe atende') : null);
  const dataChip = (c) => (c && c.modo === 'ia' && pausada() ? 'pausada' : c?.modo);
  function chip() {
    const c = ui()?.estado?.detalhe?.conversa;
    const b = document.getElementById('modo');
    const t = document.getElementById('modo-txt');
    if (!c || !b || !t || c.modo !== 'ia') return;
    b.title = pausada() ? 'Serena pausada: a equipe atende esta conversa. Toque para ver as opções.' : b.title;
    b.dataset.m = dataChip(c);
    t.textContent = rotuloChip(c) || 'IA atendendo';
  }

  function redesenhar() {
    for (const b of [...montadas]) { if (!b.isConnected) { montadas.delete(b); continue; } pintar(b); }
    faixa();
    chip();
  }

  window.SintoniaSerenaChave = { estado: () => (est ? { ...est } : null), pausada, carregar, chave, rotuloChip, dataChip };

  carregar();
  setInterval(() => { if (document.visibilityState !== 'hidden') carregar(); }, 30_000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') carregar(); });
  // A lista de Conversas é desenhada de novo de vez em quando: a faixa volta para o lugar dela.
  const obs = new MutationObserver(() => { if (est?.pausada && !document.getElementById('sc-faixa')) faixa(); });
  const raiz = document.querySelector('#v-conversas .lista');
  if (raiz) obs.observe(raiz, { childList: true });
})();
