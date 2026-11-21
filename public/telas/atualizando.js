/* atualizando: tela "Estamos atualizando melhorias".
 *
 * Quando a Sintonia é publicada, o servidor do app reinicia por 1 a 2 minutos e, nesse tempo, quem responde é o
 * proxy (Traefik), com 404/502 "page not found". Este arquivo cuida para a pessoa nunca ver essa tela de erro:
 *
 * 1. Com o app aberto (app.html, conexoes.html, entrar.html carregam este arquivo no <head>): as chamadas a /api
 *    que caem (fetch rejeitado ou 404/502/503/504 SEM o cabeçalho x-sintonia, que só o nosso servidor manda)
 *    mostram uma camada por cima, em vez de mensagens de erro. A camada pergunta a /saude a cada 3 s e some sozinha.
 *    As chamadas que voltaram do proxy nunca chegaram ao servidor, então são repetidas quando ele volta (nada se perde).
 *    Se a versão do servidor mudou, a página recarrega (ou mostra um botão, se a pessoa estiver escrevendo algo).
 * 2. Na página /atualizando.html (guardada pelo service worker em public/sw.js e mostrada quando a navegação cai):
 *    o mesmo visual em tela cheia, que recarrega o endereço pedido assim que /saude responder.
 *
 * A animação (código correndo) só roda enquanto a tela está à vista, e para com prefers-reduced-motion.
 */
(() => {
  if (window.SintoniaAtualizando) return;
  const PAGINA = Boolean(window.SINTONIA_ATUALIZANDO_PAGINA);
  const fetchOriginal = window.fetch.bind(window);

  // ------------------------------------------------------------------ visual
  const LINHAS = [
    ['k', 'const ', 'p', 'conversas = ', 'k', 'await ', 'p', 'sintonia.guardar()'],
    ['c', '// suas mensagens ficam salvas'],
    ['k', 'import ', 'p', '{ melhorias } ', 'k', 'from ', 's', "'./versao-nova'"],
    ['p', 'funil.etapas.', 'k', 'map', 'p', '((e) => e.conferir())'],
    ['k', 'await ', 'p', 'whatsapp.', 'k', 'reconectar', 'p', '()'],
    ['p', 'agenda.horarios = ', 's', "'sincronizados'"],
    ['k', 'if ', 'p', '(lead.novo) equipe.', 'k', 'avisar', 'p', '(lead)'],
    ['p', 'servidor.', 'k', 'iniciar', 'p', '({ porta: ', 's', '443', 'p', ' })'],
    ['c', '// instalando a versão nova'],
    ['k', 'export default ', 'p', 'sintonia'],
    ['p', 'ia.respostas.', 'k', 'treinar', 'p', '(base)'],
    ['k', 'for ', 'p', '(const m ', 'k', 'of ', 'p', 'melhorias) m.', 'k', 'aplicar', 'p', '()'],
    ['p', 'painel.metricas = ', 'k', 'calcular', 'p', '(hoje)'],
    ['k', 'return ', 'p', '{ ok: ', 'k', 'true', 'p', ' }'],
    ['p', 'notificacoes.', 'k', 'ligar', 'p', '()'],
    ['s', "'pronto em instantes'"],
    ['k', 'const ', 'p', 'saude = ', 'k', 'await ', 'p', 'fetch(', 's', "'/saude'", 'p', ')'],
    ['p', 'clientes.', 'k', 'ordenar', 'p', "('recentes')"],
    ['c', '// conferindo tudo antes de abrir'],
    ['p', 'testes.', 'k', 'rodar', 'p', '() ', 'c', '// ✓ passou'],
    ['k', 'let ', 'p', 'versao = ', 's', "'nova'"],
    ['p', 'banco.', 'k', 'migrar', 'p', '()'],
    ['k', 'await ', 'p', 'equipe.', 'k', 'presenca', 'p', '()'],
    ['p', 'cache.', 'k', 'limpar', 'p', '()'],
  ];
  const PASSOS = ['Guardando suas conversas', 'Instalando as melhorias', 'Conferindo o WhatsApp', 'Ligando tudo de novo', 'Quase pronto'];

  const CSS = `
.atz{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box;overflow:hidden;
  --atz-fonte:'Poppins', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;--atz-mono:ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  font-family:var(--atz-fonte);-webkit-font-smoothing:antialiased;
  --atz-fundo:linear-gradient(160deg,#041427,#0a2d52);--atz-texto:#e9f3ff;--atz-sub:rgba(233,243,255,.66);
  --atz-cod:rgba(233,243,255,.22);--atz-k:rgba(15,252,190,.55);--atz-s:rgba(58,160,255,.62);--atz-c:rgba(233,243,255,.16);
  --atz-cartao:rgba(6,25,47,.72);--atz-borda:rgba(233,243,255,.10);--atz-term:rgba(2,12,24,.62);--atz-ok:#0ffcbe;--atz-botao:rgba(233,243,255,.08);
  background:radial-gradient(60% 50% at 50% 40%,rgba(15,252,190,.12),transparent 70%),radial-gradient(80% 70% at 50% 110%,rgba(58,160,255,.22),transparent 70%),var(--atz-fundo);
  color:var(--atz-texto);opacity:1;transition:opacity .45s ease}
.atz[data-atz-tema="claro"]{--atz-fundo:linear-gradient(160deg,#f6faff,#e6f0fb);--atz-texto:#0d2240;--atz-sub:rgba(13,34,64,.66);
  --atz-cod:rgba(13,34,64,.16);--atz-k:rgba(16,110,190,.42);--atz-s:rgba(10,143,122,.48);--atz-c:rgba(13,34,64,.12);
  --atz-cartao:rgba(255,255,255,.82);--atz-borda:rgba(13,34,64,.10);--atz-term:#0d2240;--atz-ok:#0a8f7a;--atz-botao:rgba(16,110,190,.08);
  background:radial-gradient(60% 50% at 50% 40%,rgba(15,252,190,.16),transparent 70%),radial-gradient(80% 70% at 50% 110%,rgba(58,160,255,.18),transparent 70%),var(--atz-fundo)}
.atz.atz-saindo{opacity:0;pointer-events:none}
.atz.atz-entrando{opacity:0}
.atz-codigo{position:absolute;inset:0;display:flex;justify-content:space-between;gap:28px;padding:0 20px;pointer-events:none;
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 18%,#000 82%,transparent);mask-image:linear-gradient(180deg,transparent,#000 18%,#000 82%,transparent)}
.atz-col{flex:1 1 0;min-width:0;overflow:hidden;position:relative}
.atz-col pre{margin:0;font:500 12.5px/2.05 var(--atz-mono);color:var(--atz-cod);white-space:pre;
  animation:atz-sobe var(--atz-dur,30s) linear infinite;animation-delay:var(--atz-atraso,0s);will-change:transform}
.atz-col:nth-child(even) pre{filter:blur(.4px);opacity:.75}
.atz-col .k{color:var(--atz-k)} .atz-col .s{color:var(--atz-s)} .atz-col .c{color:var(--atz-c);font-style:italic}
@keyframes atz-sobe{from{transform:translateY(0)}to{transform:translateY(-50%)}}
.atz-cartao{position:relative;width:min(440px,100%);box-sizing:border-box;padding:30px 26px 24px;border-radius:22px;text-align:center;
  background:var(--atz-cartao);border:1px solid var(--atz-borda);box-shadow:0 30px 80px rgba(2,12,24,.35);
  -webkit-backdrop-filter:blur(14px) saturate(1.2);backdrop-filter:blur(14px) saturate(1.2)}
.atz-cartao::before{content:'';position:absolute;left:22px;right:22px;top:-1px;height:1.5px;border-radius:2px;background:linear-gradient(90deg,transparent,#0ffcbe,#3aa0ff,transparent)}
.atz-icone{width:64px;height:64px;margin:0 auto 14px;display:block}
.atz-icone .atz-giro{transform-origin:32px 32px;animation:atz-giro 1.6s linear infinite}
@keyframes atz-giro{to{transform:rotate(360deg)}}
.atz h1{margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-.01em}
.atz h1 b{background:linear-gradient(90deg,#106ebe,#3aa0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.atz[data-atz-tema="escuro"] h1 b{background:linear-gradient(90deg,#3aa0ff,#0ffcbe);-webkit-background-clip:text;background-clip:text}
.atz-sub{margin:8px auto 0;max-width:34ch;font-size:14px;line-height:1.5;color:var(--atz-sub)}
.atz-term{margin:20px 0 0;padding:12px 14px;border-radius:12px;background:var(--atz-term);text-align:left;
  font:500 12.5px/1.75 var(--atz-mono);color:rgba(233,243,255,.78);min-height:94px;box-sizing:border-box}
.atz-term div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.atz-term .ok::before{content:'✓ ';color:#0ffcbe}
.atz-term .agora::before{content:'› ';color:#3aa0ff}
.atz-term .agora::after{content:'▍';margin-left:2px;color:#0ffcbe;animation:atz-cursor 1s steps(1) infinite}
@keyframes atz-cursor{50%{opacity:0}}
.atz-barra{margin:18px 0 0;height:3px;border-radius:3px;overflow:hidden;background:var(--atz-botao)}
.atz-barra span{display:block;height:100%;width:40%;border-radius:3px;background:linear-gradient(90deg,#3aa0ff,#0ffcbe);animation:atz-vai 1.8s ease-in-out infinite}
@keyframes atz-vai{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
.atz-rodape{margin-top:14px;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:var(--atz-sub)}
.atz-rodape button{font:inherit;font-weight:600;color:inherit;background:var(--atz-botao);border:1px solid var(--atz-borda);border-radius:999px;padding:6px 12px;cursor:pointer}
.atz-rodape button:hover{color:var(--atz-texto)}
.atz-rodape button:focus-visible{outline:2px solid #3aa0ff;outline-offset:2px}
.atz-leve .atz-col:nth-child(n+5){display:none}
@media (max-width:600px){.atz-col:nth-child(n+3){display:none}.atz-cartao{padding:26px 18px 20px}.atz h1{font-size:20px}}
@media (prefers-reduced-motion:reduce){.atz-col pre,.atz-icone .atz-giro,.atz-barra span,.atz-term .agora::after{animation:none!important}.atz-barra span{width:100%;opacity:.5}.atz{transition:none}}
html.atz-ativo .toast{visibility:hidden!important}
.atz-aviso{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2147483600;display:flex;align-items:center;gap:12px;
  max-width:calc(100% - 32px);box-sizing:border-box;padding:10px 10px 10px 16px;border-radius:14px;background:#0d2240;color:#e9f3ff;box-shadow:0 12px 40px rgba(2,12,24,.35);
  font:500 13.5px/1.35 var(--atz-fonte)}
.atz-aviso button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:8px 14px;cursor:pointer;color:#0d2240;background:linear-gradient(90deg,#3aa0ff,#0ffcbe)}
`;

  function estilo() {
    if (document.getElementById('atz-estilo')) return;
    const s = document.createElement('style');
    s.id = 'atz-estilo';
    s.textContent = CSS;
    (document.head || document.documentElement).append(s);
  }

  function tema() {
    const t = document.documentElement.dataset.tema;
    if (t === 'escuro' || t === 'claro') return t;
    let pref = 'auto';
    try { pref = localStorage.getItem('sintonia.tema') || 'auto'; } catch {}
    if (pref === 'escuro' || pref === 'claro') return pref;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
  }

  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  };

  // Uma coluna: as linhas embaralhadas, duas vezes seguidas (a animação sobe metade e recomeça sem emenda).
  function coluna(i) {
    const col = el('div', 'atz-col');
    const pre = el('pre');
    const ordem = LINHAS.map((l, j) => [l, (j * 7 + i * 11) % LINHAS.length]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
    for (let volta = 0; volta < 2; volta++) {
      for (const partes of ordem) {
        for (let p = 0; p < partes.length; p += 2) {
          const tipo = partes[p];
          const s = el('span', tipo === 'p' ? '' : tipo, partes[p + 1]);
          pre.append(s);
        }
        pre.append('\n');
      }
    }
    pre.style.setProperty('--atz-dur', `${26 + ((i * 9) % 20)}s`);
    pre.style.setProperty('--atz-atraso', `-${(i * 5.3) % 20}s`);
    col.append(pre);
    return col;
  }

  const ICONE = '<svg class="atz-icone" viewBox="0 0 64 64" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="32" cy="32" r="26" stroke="currentColor" stroke-opacity=".12" stroke-width="1.5"/><g class="atz-giro"><circle cx="32" cy="32" r="26" pathLength="100" stroke="#0ffcbe" stroke-width="1.8" stroke-dasharray="30 100"/><circle cx="32" cy="32" r="26" pathLength="100" stroke="#3aa0ff" stroke-width="1.8" stroke-dasharray="14 100" stroke-dashoffset="-50"/></g><path d="M25 26.5 19.5 32l5.5 5.5M39 26.5 44.5 32 39 37.5M34.5 23.5l-5 17" stroke="currentColor" stroke-width="1.8"/></svg>';

  /** Monta a tela (página inteira ou camada por cima do app). Só texto fixo: nada vindo do servidor. */
  function montar({ leve = false } = {}) {
    estilo();
    const raiz = el('section', 'atz' + (leve ? ' atz-leve' : ''));
    raiz.setAttribute('role', 'alert');
    raiz.setAttribute('aria-live', 'assertive');
    raiz.dataset.atzTema = tema();
    const cod = el('div', 'atz-codigo');
    cod.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 7; i++) cod.append(coluna(i));
    const cartao = el('div', 'atz-cartao');
    cartao.insertAdjacentHTML('afterbegin', ICONE);
    const h1 = el('h1');
    h1.append('Estamos atualizando ', el('b', '', 'melhorias'));
    const sub = el('p', 'atz-sub', 'A Sintonia volta sozinha em instantes. Suas conversas estão guardadas e você não precisa fazer nada.');
    const term = el('div', 'atz-term');
    term.setAttribute('aria-hidden', 'true');
    const barra = el('div', 'atz-barra');
    barra.append(el('span'));
    const rodape = el('div', 'atz-rodape');
    const estado = el('span', 'atz-estado', 'Verificando…');
    const botao = el('button', '', 'Tentar agora');
    botao.type = 'button';
    rodape.append(estado); /* sem o botão "Tentar agora" (pedido do dono 20/11): só "Verificando"; ele volta sozinho */
    cartao.append(h1, sub, term, barra, rodape);
    raiz.append(cod, cartao);
    return { raiz, term, estado, botao, sub, h1 };
  }

  // Terminal com os passos: um a cada 1,6 s, só enquanto a tela está à vista (e parado se pedir menos movimento).
  function terminal(term) {
    let i = 0;
    let t = null;
    const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const desenhar = () => {
      term.replaceChildren();
      const ini = Math.max(0, i - 3);
      for (let j = ini; j <= i; j++) term.append(el('div', j < i ? 'ok' : 'agora', PASSOS[j % PASSOS.length]));
    };
    const passo = () => {
      if (document.hidden) return;
      if (i < PASSOS.length - 1) i++;
      desenhar();
    };
    return {
      ligar() { desenhar(); if (!calmo && !t) t = setInterval(passo, 1600); },
      desligar() { clearInterval(t); t = null; },
    };
  }

  // ------------------------------------------------------------------ servidor voltou?
  const doProxy = (r) => !r.headers.get('x-sintonia') && [404, 502, 503, 504].includes(r.status);
  async function servidorNoAr() {
    if (navigator.onLine === false) return false;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    try {
      const r = await fetchOriginal(`/saude?t=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin', signal: ctl.signal });
      return r.ok && Boolean(r.headers.get('x-sintonia')) ? r.headers.get('x-sintonia-versao') || '?' : false;
    } catch { return false; } finally { clearTimeout(t); }
  }

  /** Repete /saude a cada `cada` ms; chama `voltou(versao)` uma vez. Mostra a contagem em `estado`. */
  function vigiar(estado, botao, voltou, cada = 3000) {
    let parar = false;
    let espera = null;
    let acordar = null;
    const dormir = (ms) => new Promise((ok) => { acordar = ok; espera = setTimeout(ok, ms); });
    (async () => {
      for (let n = 0; !parar; n++) {
        if (estado) estado.textContent = navigator.onLine === false ? 'Sem internet neste aparelho. Esperando a conexão…' : 'Verificando…';
        const v = await servidorNoAr();
        if (parar) return;
        if (v) { parar = true; if (estado) estado.textContent = 'Pronto! Abrindo…'; voltou(v); return; }
        const ms = n < 40 ? cada : cada * 2;
        for (let s = Math.round(ms / 1000); s > 0 && !parar; s--) {
          if (estado && navigator.onLine !== false) estado.textContent = `Verificando de novo em ${s} s`;
          await dormir(1000);
        }
      }
    })();
    botao?.addEventListener('click', () => { clearTimeout(espera); acordar?.(); });
    addEventListener('online', () => { clearTimeout(espera); acordar?.(); });
    return () => { parar = true; clearTimeout(espera); acordar?.(); };
  }

  // ------------------------------------------------------------------ página inteira (/atualizando.html, servida pelo service worker)
  if (PAGINA) {
    const iniciar = () => {
      const tela = montar();
      document.body.append(tela.raiz);
      document.documentElement.style.background = tela.raiz.dataset.atzTema === 'escuro' ? '#041427' : '#f6faff';
      const t = terminal(tela.term);
      t.ligar();
      if (/[?&]previa\b/.test(location.search)) { tela.estado.textContent = 'Prévia da tela'; return; }
      vigiar(tela.estado, tela.botao, () => {
        // O service worker mostrou esta página no lugar do endereço pedido: basta recarregar.
        if (location.pathname === '/atualizando.html') location.replace('/app');
        else location.reload();
      });
    };
    if (document.body) iniciar(); else addEventListener('DOMContentLoaded', iniciar);
    window.SintoniaAtualizando = { pagina: true };
    return;
  }

  // ------------------------------------------------------------------ camada por cima do app
  let versaoInicial = null;
  let fora = false;
  let voltouAgora = null;
  let promessaVolta = null;
  let tela = null;
  let term = null;
  let pararVigia = null;
  let timerMostrar = null;

  function mostrarCamada() {
    if (tela || !fora) return;
    tela = montar({ leve: true });
    tela.raiz.classList.add('atz-entrando');
    document.body.append(tela.raiz);
    document.documentElement.classList.add('atz-ativo');
    requestAnimationFrame(() => requestAnimationFrame(() => tela?.raiz.classList.remove('atz-entrando')));
    term = terminal(tela.term);
    term.ligar();
    tela.botao.addEventListener('click', () => pararVigia && reiniciarVigia());
  }

  function esconderCamada() {
    clearTimeout(timerMostrar);
    document.documentElement.classList.remove('atz-ativo');
    if (!tela) return;
    const r = tela.raiz;
    term?.desligar();
    tela = null;
    r.classList.add('atz-saindo');
    setTimeout(() => r.remove(), 500);
  }

  function reiniciarVigia() {
    pararVigia?.();
    pararVigia = vigiar(tela?.estado, null, voltou);
  }

  function caiu() {
    if (fora) return promessaVolta;
    fora = true;
    promessaVolta = new Promise((ok) => { voltouAgora = ok; });
    // Uma falha rápida (meio segundo) não chega a mostrar a tela.
    timerMostrar = setTimeout(() => { mostrarCamada(); if (tela) reiniciarVigia(); }, 700);
    pararVigia = vigiar(null, null, voltou, 1500);
    return promessaVolta;
  }

  function voltou(versao) {
    pararVigia?.();
    pararVigia = null;
    fora = false;
    const mudou = versaoInicial && versao && versao !== '?' && versao !== versaoInicial;
    if (mudou) {
      // Versão nova no ar: recarrega para pegar as telas novas (se a pessoa estiver escrevendo, pergunta antes).
      if (!escrevendo()) { location.reload(); return; }
      avisoVersaoNova();
    }
    versaoInicial = versao && versao !== '?' ? versao : versaoInicial;
    esconderCamada();
    voltouAgora?.();
  }

  function escrevendo() {
    for (const c of document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]')) {
      const v = c.isContentEditable ? c.textContent : c.value;
      if (v && v.trim() && c.offsetParent !== null) return true;
    }
    return false;
  }

  function avisoVersaoNova() {
    if (document.querySelector('.atz-aviso')) return;
    estilo();
    const a = el('div', 'atz-aviso');
    a.setAttribute('role', 'status');
    const b = el('button', '', 'Atualizar');
    b.type = 'button';
    b.addEventListener('click', () => location.reload());
    a.append(el('span', '', 'A Sintonia ganhou melhorias. Atualize quando terminar o que está escrevendo.'), b);
    document.body.append(a);
  }

  const ESPERA_MAX = 15 * 60 * 1000;
  window.fetch = async function (entrada, opcoes) {
    let url;
    try { url = new URL(entrada instanceof Request ? entrada.url : String(entrada), location.href); } catch { return fetchOriginal(entrada, opcoes); }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return fetchOriginal(entrada, opcoes);
    const metodo = String(opcoes?.method || (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();
    const inicio = Date.now();
    for (;;) {
      if (fora) await promessaVolta;
      let r;
      try {
        r = await fetchOriginal(entrada instanceof Request ? entrada.clone() : entrada, opcoes);
      } catch (e) {
        // Cancelada pelo próprio app, ou sem internet no aparelho: segue o erro normal.
        if (e?.name === 'AbortError' || navigator.onLine === false) throw e;
        caiu();
        // A conexão caiu no meio: um envio (POST etc.) pode ter chegado. Não repete; avisa com texto simples.
        if (metodo !== 'GET' && metodo !== 'HEAD') throw new Error('A Sintonia está sendo atualizada. Confira e tente de novo em instantes.');
        if (Date.now() - inicio > ESPERA_MAX) throw e;
        continue;
      }
      if (doProxy(r)) {
        // Resposta do proxy: o pedido nem chegou ao servidor, então repetir depois é seguro (até para envios).
        caiu();
        if (Date.now() - inicio > ESPERA_MAX) throw new Error('A Sintonia está sendo atualizada. Tente de novo em instantes.');
        continue;
      }
      if (!versaoInicial && r.headers.get('x-sintonia-versao')) versaoInicial = r.headers.get('x-sintonia-versao');
      return r;
    }
  };

  // O service worker guarda a página de atualização (e cuida do push). Registra cedo, inclusive no login.
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}); });
  }

  window.SintoniaAtualizando = {
    /** Para teste e prévia: mostra a camada como se o servidor tivesse caído. */
    simular() { caiu(); },
    estaFora: () => fora,
  };
})();
