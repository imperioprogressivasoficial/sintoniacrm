/* gestos-whats: nota de voz igual ao WhatsApp do iPhone e do Android (pedido do dono, 27/11).
 * - Campo vazio: o botão da direita é o microfone. SEGURAR começa a gravar na hora (vibra onde o aparelho deixa):
 *   o botão cresce, aparece a faixa com a bolinha vermelha piscando, o tempo correndo e "‹ Deslize para cancelar".
 * - SOLTAR envia. Deslizar para a ESQUERDA cancela (a lixeira "engole" o áudio). Deslizar para CIMA trava (cadeado):
 *   aí dá para soltar o dedo e aparecem Apagar, Pausar/Continuar e Enviar.
 * - Toque rápido (sem segurar) não grava: mostra a dica "Segure para gravar, solte para enviar".
 * - Microfone: na primeira vez só pede a permissão (sem gravar). Se a pessoa negar, explica como liberar.
 * - Teclado: Enter ou Espaço no microfone começa já travado. ESC ou trocar de conversa descarta.
 * Funciona com dedo e com mouse (pointer events; touch-action: none no botão).
 * O áudio sai pelo mesmo caminho dos outros arquivos: window.SintoniaEnvio.arquivo (app.html) → POST /api/conversas/:id/enviar-midia.
 * Animações só com transform/opacity; a bolinha só pisca enquanto grava; com "reduzir movimento" nada se mexe. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  const $ = (id) => document.getElementById(id);
  const botao = $('enviar'), texto = $('texto');
  const compor = botao && botao.closest('.compor');
  if (!ui || !botao || !texto || !compor) return;
  const { el, toast, estado } = ui;

  const TOQUE_MS = 300;        // soltou antes disso sem arrastar = foi um toque, não grava
  const TRAVA_PX = 72;         // quanto subir para travar
  const MAX_S = 15 * 60;       // 15 minutos no máximo
  const CHAVE = 'sintonia.microfone';
  const calmo = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vibrar = (p) => { try { navigator.vibrate?.(p); } catch {} };

  const tr = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const IC = {
    lixeira: tr('<g class="ga-tampa"><path d="M4.5 7h15M9.5 7V4.75h5V7"/></g><path d="M6.5 7l.85 12.25c.05.7.65 1.25 1.35 1.25h6.6c.7 0 1.3-.55 1.35-1.25L17.5 7M10 11v5.5M14 11v5.5"/>'),
    cadeado: tr('<rect x="5.5" y="10.5" width="13" height="10" rx="2.6"/><path class="ga-alca-aberta" d="M8.5 10.5V7.25a3.5 3.5 0 0 1 6.9-.8"/><path class="ga-alca-fechada" d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/><path d="M12 14.5v2"/>'),
    subir: tr('<path d="m7.5 14 4.5-4.5 4.5 4.5"/>'),
    pausar: tr('<rect x="7.25" y="5.5" width="3" height="13" rx="1.2"/><rect x="13.75" y="5.5" width="3" height="13" rx="1.2"/>'),
    mic: tr('<rect x="8.75" y="3" width="6.5" height="11.25" rx="3.25"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>'),
    enviar: tr('<path d="M20.5 12 4.75 4.5l2.6 7.5-2.6 7.5L20.5 12Z"/><path d="M7.35 12h6.4"/>'),
  };

  const ESTILO = `
  #enviar { touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
  /* enquanto grava: o campo e os botões da linha somem (o microfone fica no lugar dele) */
  .compor.ga-on > .caixa { visibility: hidden; }
  .compor.ga-on .linha-compor > :not(#enviar) { opacity: 0; pointer-events: none; transition: opacity .15s ease; }
  .compor.ga-travado .linha-compor > #enviar { opacity: 0; pointer-events: none; }
  #chat-aberto #enviar.ga-segurando, #enviar.ga-segurando { position: relative; z-index: 6; scale: 1.55; transform-origin: 72% 72%; /* cresce para dentro da tela */ translate: var(--ga-x, 0px) var(--ga-y, 0px);
    background: linear-gradient(135deg, #106ebe, #3aa0ff) !important; color: #fff !important;
    box-shadow: 0 0 0 6px rgba(58,160,255,.18), 0 8px 22px rgba(16,110,190,.38) !important;
    transition: scale .22s cubic-bezier(.34,1.56,.64,1), translate .2s cubic-bezier(.2,.8,.2,1); }
  #enviar.ga-segurando.ga-arrastando { transition: scale .22s cubic-bezier(.34,1.56,.64,1); }
  @media (pointer: fine) { #chat-aberto #enviar.ga-segurando, #enviar.ga-segurando { scale: 1.3; } }

  /* faixa: no lugar do campo de mensagem */
  .ga-faixa { position: absolute; z-index: 4; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 0 16px; overflow: hidden;
    color: var(--texto); font-size: 15px; opacity: 0; transition: opacity .14s ease; }
  .ga-faixa.ga-ver { opacity: 1; }
  .ga-faixa[hidden], .ga-trava[hidden], .ga-acoes[hidden], .ga-toque[hidden] { display: none; }
  .ga-sinal { position: relative; width: 22px; height: 22px; flex: none; display: grid; place-items: center; }
  .ga-ponto { width: 11px; height: 11px; border-radius: 50%; background: var(--gravando, #ea0038); }
  .ga-faixa[data-estado="gravando"] .ga-ponto { animation: ga-pisca 1s ease-in-out infinite; }
  .ga-faixa[data-estado="pausado"] .ga-ponto { background: var(--sub); }
  @keyframes ga-pisca { 50% { opacity: .2; } }
  .ga-lixo { position: absolute; inset: 0; display: grid; place-items: center; color: #e5252a; opacity: 0; }
  html[data-tema="escuro"] .ga-lixo { color: #ff6b6b; }
  .ga-lixo svg { width: 22px; height: 22px; overflow: visible; }
  .ga-lixo .ga-tampa { transform-box: fill-box; transform-origin: 0% 100%; }
  .ga-cai { position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; color: #e5252a; opacity: 0; }
  .ga-cai svg { width: 14px; height: 14px; }
  .ga-tempo { font-variant-numeric: tabular-nums; font-size: 16.5px; min-width: 42px; flex: none; }
  .ga-dica { flex: 1; min-width: 0; display: flex; justify-content: center; color: var(--sub); font-size: 14.5px; white-space: nowrap; }
  .ga-dica span { display: inline-block; will-change: transform, opacity; }
  .ga-estado { flex: 1; color: var(--sub); font-size: 14.5px; display: none; }
  .ga-faixa[data-modo="travado"] .ga-dica { display: none; }
  .ga-faixa[data-modo="travado"] .ga-estado { display: block; }
  /* lixeira engolindo o áudio (cancelar) */
  .ga-faixa.ga-jogando .ga-ponto { opacity: 0; animation: none; }
  .ga-faixa.ga-jogando .ga-tempo, .ga-faixa.ga-jogando .ga-dica, .ga-faixa.ga-jogando .ga-estado { opacity: 0; transition: opacity .12s ease; }
  .ga-faixa.ga-jogando .ga-lixo { animation: ga-lixo .62s cubic-bezier(.3,.7,.3,1) both; }
  .ga-faixa.ga-jogando .ga-tampa { animation: ga-tampa .62s ease both; }
  .ga-faixa.ga-jogando .ga-cai { animation: ga-cai .62s cubic-bezier(.5,0,.8,.4) both; }
  @keyframes ga-lixo { 0% { opacity: 0; transform: translateY(8px) scale(.6); } 18% { opacity: 1; transform: translateY(0) scale(1.12); } 30%, 78% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: translateY(6px) scale(.9); } }
  @keyframes ga-tampa { 0%, 14% { transform: none; } 26%, 52% { transform: rotate(-38deg) translateY(-1px); } 64%, 100% { transform: none; } }
  @keyframes ga-cai { 0%, 16% { opacity: 0; transform: translateY(-30px) scale(.9); } 24% { opacity: 1; transform: translateY(-30px); } 54% { opacity: 1; transform: translateY(-2px) scale(.7); } 60%, 100% { opacity: 0; transform: translateY(2px) scale(.5); } }

  /* cadeado: acima do microfone, para travar subindo o dedo */
  .ga-trava { position: absolute; z-index: 5; width: 44px; height: 92px; box-sizing: border-box; border-radius: 22px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 11px 0 8px;
    background: var(--fundo); color: var(--sub); border: 1px solid var(--linha); box-shadow: 0 8px 22px rgba(4,18,31,.16);
    opacity: 0; transform: translateY(14px); transition: opacity .2s ease, transform .24s cubic-bezier(.34,1.56,.64,1); pointer-events: none; }
  html[data-tema="escuro"] .ga-trava { background: #0d2c4b; box-shadow: 0 8px 22px rgba(0,0,0,.4); }
  .ga-trava.ga-ver { opacity: 1; transform: translateY(var(--ga-ty, 0px)); }
  .ga-trava.ga-arrastando { transition: opacity .2s ease; }
  .ga-trava svg { width: 22px; height: 22px; }
  .ga-trava .ga-cadeado { color: var(--texto); }
  .ga-trava .ga-alca-fechada { opacity: 0; }
  .ga-trava.ga-fechou .ga-alca-aberta { opacity: 0; } .ga-trava.ga-fechou .ga-alca-fechada { opacity: 1; }
  .ga-trava.ga-fechou .ga-cadeado { color: var(--marca-azul, #106ebe); }
  html[data-tema="escuro"] .ga-trava.ga-fechou .ga-cadeado { color: #0ffcbe; }
  .ga-trava .ga-seta { opacity: var(--ga-seta, 1); }

  /* travado: apagar, pausar/continuar e enviar na linha de baixo */
  .ga-acoes { position: absolute; z-index: 5; display: flex; align-items: center; justify-content: space-between; opacity: 0; transform: translateY(6px); transition: opacity .16s ease, transform .2s cubic-bezier(.2,.8,.2,1); }
  .ga-acoes.ga-ver { opacity: 1; transform: none; }
  .ga-acoes button { all: unset; box-sizing: border-box; cursor: pointer; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); -webkit-tap-highlight-color: transparent; }
  .ga-acoes button svg { width: 23px; height: 23px; }
  .ga-acoes button:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 2px; }
  .ga-acoes .ga-apagar { color: #e5252a; } html[data-tema="escuro"] .ga-acoes .ga-apagar { color: #ff6b6b; }
  .ga-acoes .ga-pausa { box-shadow: inset 0 0 0 1.5px var(--linha); }
  .ga-acoes .ga-mandar { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 4px 14px rgba(16,110,190,.32); }
  .ga-acoes .ga-mandar svg { width: 21px; height: 21px; }
  .ga-acoes button:active { transform: scale(.92); }
  .ga-acoes button[disabled] { opacity: .45; cursor: default; }

  /* dica do toque rápido */
  .ga-toque { position: absolute; z-index: 7; max-width: min(280px, calc(100vw - 32px)); padding: 9px 13px; border-radius: 12px; background: #0d2240; color: #fff; font-size: 14px; line-height: 19px; font-weight: 500;
    box-shadow: 0 10px 28px rgba(4,18,31,.28); opacity: 0; transform: translateY(6px) scale(.96); transform-origin: bottom right; transition: opacity .16s ease, transform .22s cubic-bezier(.34,1.56,.64,1); pointer-events: none; }
  html[data-tema="escuro"] .ga-toque { background: #163a5f; box-shadow: 0 10px 28px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.08); }
  .ga-toque.ga-ver { opacity: 1; transform: none; }
  .ga-toque::after { content: ""; position: absolute; right: var(--ga-seta-x, 16px); bottom: -6px; width: 12px; height: 12px; background: inherit; transform: rotate(45deg); border-radius: 2px; }

  @media (prefers-reduced-motion: reduce) {
    #chat-aberto #enviar.ga-segurando, #enviar.ga-segurando { transition: none; }
    .ga-faixa, .ga-trava, .ga-acoes, .ga-toque, .compor.ga-on .linha-compor > :not(#enviar) { transition: none !important; }
    .ga-faixa[data-estado="gravando"] .ga-ponto { animation: none; }
  }
  `;
  document.head.append(el('style', { id: 'ga-css', text: ESTILO }));

  // ------------------------------------------------------------ peças na barra de digitar
  const ponto = el('span', { class: 'ga-ponto' });
  const lixo = el('span', { class: 'ga-lixo', html: IC.lixeira });
  const cai = el('span', { class: 'ga-cai', html: IC.mic });
  const tempo = el('span', { class: 'ga-tempo', text: '0:00' });
  const dicaTxt = el('span', { text: '‹ Deslize para cancelar' });
  const estadoTxt = el('span', { class: 'ga-estado', text: 'Gravando…' });
  const faixa = el('div', { class: 'ga-faixa', hidden: '', role: 'status', 'aria-label': 'Gravando áudio' },
    el('span', { class: 'ga-sinal' }, ponto, lixo, cai), tempo, el('span', { class: 'ga-dica' }, dicaTxt), estadoTxt);
  const trava = el('div', { class: 'ga-trava', hidden: '', 'aria-hidden': 'true' },
    el('span', { class: 'ga-cadeado', html: IC.cadeado, style: 'display:grid' }), el('span', { class: 'ga-seta', html: IC.subir, style: 'display:grid' }));
  const btApagar = el('button', { type: 'button', class: 'ga-apagar', title: 'Apagar', 'aria-label': 'Apagar gravação', html: IC.lixeira });
  const btPausa = el('button', { type: 'button', class: 'ga-pausa', title: 'Pausar', 'aria-label': 'Pausar gravação', html: IC.pausar });
  const btMandar = el('button', { type: 'button', class: 'ga-mandar', title: 'Enviar', 'aria-label': 'Enviar áudio', html: IC.enviar });
  const acoes = el('div', { class: 'ga-acoes', hidden: '' }, btApagar, btPausa, btMandar);
  const dicaToque = el('div', { class: 'ga-toque', hidden: '', role: 'status', text: 'Segure para gravar, solte para enviar' });
  compor.append(faixa, trava, acoes, dicaToque);

  // ------------------------------------------------------------ estado
  const S = {
    fase: 'livre',            // livre | pedindo | segurando | travado | saindo
    pid: null, x0: 0, y0: 0, t0: 0, eixo: null, soltou: false, teclado: false,
    geracao: 0, stream: null, rec: null, partes: null, conversa: null,
    inicio: 0, acumulado: 0, pausado: false, relogio: 0, mostrado: '',
  };
  const ativo = () => S.fase !== 'livre' && S.fase !== 'pedindo';

  // ------------------------------------------------------------ microfone
  let permissao = 'perguntar'; // ok | negada | perguntar
  try { if (localStorage.getItem(CHAVE) === 'ok') permissao = 'ok'; } catch {}
  const lembrar = (v) => { try { if (v) localStorage.setItem(CHAVE, v); else localStorage.removeItem(CHAVE); } catch {} };
  try {
    navigator.permissions?.query({ name: 'microphone' }).then((st) => {
      const ler = () => { if (st.state === 'granted') { permissao = 'ok'; lembrar('ok'); } else if (st.state === 'denied') { permissao = 'negada'; lembrar(null); } };
      ler(); st.onchange = ler;
    }).catch(() => {});
  } catch {}
  const suporta = () => Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  function semSuporte() {
    toast(window.isSecureContext === false ? 'Para gravar áudio, abra a Sintonia pelo endereço seguro (https).' : 'Este navegador não grava áudio. Atualize o navegador ou use outro aparelho.');
  }
  function erroMicrofone(x) {
    const nome = x?.name || '';
    if (nome === 'NotAllowedError' || nome === 'SecurityError' || nome === 'PermissionDeniedError') {
      permissao = 'negada'; lembrar(null);
      toast('O microfone está bloqueado. Para gravar, libere o microfone para a Sintonia: toque no ícone ao lado do endereço do site (ou nos Ajustes do aparelho) e permita.');
    } else if (nome === 'NotFoundError' || nome === 'DevicesNotFoundError') toast('Nenhum microfone encontrado neste aparelho.');
    else if (nome === 'NotReadableError' || nome === 'TrackStartError') toast('O microfone está sendo usado por outro app. Feche o outro app e tente de novo.');
    else toast('Não deu para usar o microfone agora. Tente de novo.');
  }
  const pedirMicrofone = () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  function tipoGravacao() {
    for (const t of ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']) if (window.MediaRecorder?.isTypeSupported?.(t)) return t;
    return '';
  }

  /** Primeira vez: só pede a permissão (sem gravar), como o WhatsApp. */
  async function pedirPrimeiraVez() {
    S.fase = 'pedindo';
    try {
      const s = await pedirMicrofone();
      s.getTracks().forEach((t) => t.stop());
      permissao = 'ok'; lembrar('ok');
      toast('Microfone liberado ✓ Agora é só segurar o microfone para gravar.');
    } catch (x) { erroMicrofone(x); }
    finally { S.fase = 'livre'; }
  }

  async function abrirGravador() {
    const g = S.geracao;
    let stream;
    try { stream = await pedirMicrofone(); }
    catch (x) { if (g !== S.geracao) return; erroMicrofone(x); fecharTudo('rapido'); return; }
    if (g !== S.geracao || !ativo()) { stream.getTracks().forEach((t) => t.stop()); return; }
    permissao = 'ok'; lembrar('ok');
    const tipo = tipoGravacao();
    let rec;
    try { rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined); }
    catch { stream.getTracks().forEach((t) => t.stop()); semSuporte(); fecharTudo('rapido'); return; }
    const partes = [];
    rec.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) partes.push(e.data); });
    try { rec.start(250); } catch { stream.getTracks().forEach((t) => t.stop()); toast('Não deu para começar a gravar. Tente de novo.'); fecharTudo('rapido'); return; }
    Object.assign(S, { stream, rec, partes, inicio: performance.now(), acumulado: 0, pausado: false });
    faixa.dataset.estado = 'gravando';
    btPausa.hidden = typeof rec.pause !== 'function';
    btPausa.disabled = false;
    clearInterval(S.relogio);
    S.relogio = setInterval(tique, 200);
    tique();
    // Soltou o dedo enquanto o aparelho ainda abria o microfone (ou perguntava a permissão): fica travado.
    if (S.soltou && S.fase === 'segurando') travar();
  }

  const segundos = () => (S.acumulado + (S.rec && !S.pausado ? performance.now() - S.inicio : 0)) / 1000;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function tique() {
    const s = segundos(); const t = mmss(s);
    if (t !== S.mostrado) { S.mostrado = t; tempo.textContent = t; }
    if (s >= MAX_S) { toast('Chegou a 15 minutos: o áudio foi enviado.'); concluir('enviar'); }
  }

  /** Para o gravador e, se for o caso, manda o áudio. */
  function pararGravador(acao) {
    const { rec, stream, partes, conversa } = S;
    const dur = segundos();
    S.geracao++;
    clearInterval(S.relogio);
    Object.assign(S, { rec: null, stream: null, partes: null });
    if (!rec) { stream?.getTracks().forEach((t) => t.stop()); if (acao === 'enviar') toast('Áudio muito curto. Segure o microfone enquanto fala.'); return; }
    rec.addEventListener('stop', () => {
      stream?.getTracks().forEach((t) => t.stop());
      if (acao !== 'enviar') return;
      if (dur < 1) { toast('Áudio muito curto. Segure o microfone enquanto fala.'); return; }
      const mimetype = (rec.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(partes, { type: mimetype });
      if (!window.SintoniaEnvio?.arquivo) { toast('Não deu para enviar o áudio. Recarregue a página.'); return; }
      window.SintoniaEnvio.arquivo({ blob, tipo: 'audio', mimetype, duracaoSeg: Math.max(1, Math.round(dur)) }, conversa);
    }, { once: true });
    try { if (rec.state !== 'inactive') rec.stop(); else rec.dispatchEvent(new Event('stop')); }
    catch { stream?.getTracks().forEach((t) => t.stop()); }
  }

  // ------------------------------------------------------------ tela
  function medir() {
    const rc = compor.getBoundingClientRect();
    const caixa = compor.querySelector(':scope > .caixa');
    const rx = (caixa || botao).getBoundingClientRect();
    const rb = botao.getBoundingClientRect();
    const linha = botao.closest('.linha-compor');
    const rl = linha ? linha.getBoundingClientRect() : rb;
    const doisAndares = rb.top >= rx.bottom - 2; // campo em cima, botões embaixo (o normal da Sintonia)
    const cs = caixa ? getComputedStyle(caixa) : null;
    Object.assign(faixa.style, {
      left: (rx.left - rc.left) + 'px', top: (rx.top - rc.top) + 'px', height: rx.height + 'px',
      width: (doisAndares ? rx.width : Math.max(120, rb.left - rx.left - 8)) + 'px',
      background: cs && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : 'var(--painel)',
      borderRadius: cs ? cs.borderRadius : '22px',
    });
    // cadeado: em cima do microfone
    const mx = rb.left - rc.left + rb.width / 2;
    Object.assign(trava.style, { left: (mx - 22) + 'px', top: (rb.top - rc.top - 92 - 22) + 'px' });
    // botões do modo travado: linha de baixo, com o Enviar no lugar do microfone
    const esq = doisAndares ? rl.left : rx.left;
    Object.assign(acoes.style, {
      left: (esq - rc.left + 2) + 'px', top: ((doisAndares ? rl.top : rb.top) - rc.top) + 'px',
      width: (rb.right - esq - 2) + 'px', height: (doisAndares ? rl.height : rb.height) + 'px',
    });
    // dica do toque: em cima do microfone, alinhada pela direita
    Object.assign(dicaToque.style, { right: Math.max(8, rc.right - rb.right - 4) + 'px', bottom: (rc.bottom - rb.top + 10) + 'px' });
    dicaToque.style.setProperty('--ga-seta-x', Math.max(10, rb.width / 2 - 6 + 4) + 'px');
    S.doisAndares = doisAndares;
  }

  function mostrarGravando() {
    medir();
    tempo.textContent = '0:00'; S.mostrado = '0:00';
    dicaTxt.style.transform = ''; dicaTxt.style.opacity = '';
    faixa.classList.remove('ga-jogando');
    faixa.dataset.modo = 'segurar'; faixa.dataset.estado = 'abrindo';
    estadoTxt.textContent = 'Gravando…';
    faixa.hidden = false; trava.hidden = false; acoes.hidden = true;
    trava.classList.remove('ga-fechou', 'ga-arrastando'); trava.style.setProperty('--ga-ty', '0px'); trava.style.setProperty('--ga-seta', '1');
    compor.classList.add('ga-on');
    botao.classList.add('ga-segurando');
    botao.style.setProperty('--ga-x', '0px'); botao.style.setProperty('--ga-y', '0px');
    void faixa.offsetWidth; // aplica o estado inicial antes da transição
    faixa.classList.add('ga-ver');
    setTimeout(() => { if (S.fase === 'segurando') trava.classList.add('ga-ver'); }, calmo() ? 0 : 90);
  }

  function travar() {
    if (S.fase !== 'segurando') return;
    S.fase = 'travado';
    vibrar(10);
    trava.classList.add('ga-fechou');
    botao.classList.remove('ga-arrastando');
    botao.style.setProperty('--ga-x', '0px'); botao.style.setProperty('--ga-y', '0px');
    botao.classList.remove('ga-segurando');
    compor.classList.add('ga-travado');
    faixa.dataset.modo = 'travado';
    estadoTxt.textContent = S.pausado ? 'Pausado' : 'Gravando…';
    btPausa.disabled = !S.rec;
    acertarPausa();
    acoes.hidden = false; void acoes.offsetWidth; acoes.classList.add('ga-ver');
    setTimeout(() => { trava.classList.remove('ga-ver'); setTimeout(() => { if (S.fase !== 'segurando') trava.hidden = true; }, calmo() ? 0 : 220); }, calmo() ? 0 : 260);
    if (S.teclado) setTimeout(() => btMandar.focus({ preventScroll: true }), 30);
  }

  function acertarPausa() {
    btPausa.innerHTML = S.pausado ? IC.mic : IC.pausar;
    btPausa.title = S.pausado ? 'Continuar gravando' : 'Pausar';
    btPausa.setAttribute('aria-label', btPausa.title);
  }

  /** Fecha a faixa: 'enviou' some rápido; 'lixeira' mostra a lixeira engolindo; 'rapido' some na hora. */
  function fecharTudo(como) {
    S.fase = 'saindo';
    S.pid = null;
    clearInterval(S.relogio);
    const reduzido = calmo();
    botao.classList.remove('ga-arrastando');
    botao.style.setProperty('--ga-x', '0px'); botao.style.setProperty('--ga-y', '0px');
    trava.classList.remove('ga-ver'); acoes.classList.remove('ga-ver');
    const fim = () => {
      faixa.hidden = true; trava.hidden = true; acoes.hidden = true;
      faixa.classList.remove('ga-ver', 'ga-jogando');
      compor.classList.remove('ga-on', 'ga-travado');
      botao.classList.remove('ga-segurando');
      S.fase = 'livre'; S.teclado = false; S.soltou = false;
    };
    if (como === 'lixeira' && !reduzido) {
      botao.classList.remove('ga-segurando');
      compor.classList.remove('ga-travado');
      faixa.dataset.estado = 'parado';
      faixa.classList.add('ga-jogando');
      vibrar([12, 50, 12]);
      setTimeout(() => { faixa.classList.remove('ga-ver'); setTimeout(fim, 150); }, 620);
      return;
    }
    botao.classList.remove('ga-segurando');
    faixa.classList.remove('ga-ver');
    if (reduzido || como === 'rapido') fim(); else setTimeout(fim, 150);
  }

  function concluir(acao) {
    if (!ativo() || S.fase === 'saindo') return;
    pararGravador(acao);
    fecharTudo(acao === 'enviar' ? 'enviou' : acao === 'lixeira' ? 'lixeira' : 'rapido');
  }

  let dicaTimer = 0;
  function mostrarDica() {
    medir();
    clearTimeout(dicaTimer);
    dicaToque.hidden = false; void dicaToque.offsetWidth; dicaToque.classList.add('ga-ver');
    dicaTimer = setTimeout(() => { dicaToque.classList.remove('ga-ver'); dicaTimer = setTimeout(() => { dicaToque.hidden = true; }, 200); }, 1900);
  }
  function esconderDica() { clearTimeout(dicaTimer); dicaToque.classList.remove('ga-ver'); dicaToque.hidden = true; }

  // ------------------------------------------------------------ começar
  function comecar({ teclado = false } = {}) {
    if (S.fase !== 'livre' || !estado.aberta) return false;
    esconderDica();
    if (!suporta()) { semSuporte(); return false; }
    if (permissao === 'negada') { erroMicrofone({ name: 'NotAllowedError' }); return false; }
    if (permissao !== 'ok') { pedirPrimeiraVez(); return false; }
    S.geracao++;
    Object.assign(S, { fase: 'segurando', conversa: estado.aberta, teclado, soltou: teclado, eixo: null });
    mostrarGravando();
    vibrar(15);
    abrirGravador();
    if (teclado) travar();
    return true;
  }

  // ------------------------------------------------------------ gesto no microfone
  const limiteCancelar = () => Math.max(80, Math.min(140, compor.getBoundingClientRect().width * 0.32));
  botao.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || texto.value.trim() || !estado.aberta || botao.disabled) return;
    e.preventDefault(); // sem foco/seleção; o "click" do app não grava nada com o campo vazio
    if (S.fase !== 'livre') return;
    Object.assign(S, { pid: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), eixo: null, soltou: false });
    try { botao.setPointerCapture(e.pointerId); } catch {}
    if (!comecar()) S.pid = null;
  });
  botao.addEventListener('pointermove', (e) => {
    if (S.fase !== 'segurando' || e.pointerId !== S.pid) return;
    const dx = Math.min(0, e.clientX - S.x0), dy = Math.min(0, e.clientY - S.y0);
    if (Math.max(-dx, -dy) < 8) { // voltou para perto do começo: solta o eixo
      if (S.eixo) { S.eixo = null; botao.classList.remove('ga-arrastando'); botao.style.setProperty('--ga-x', '0px'); botao.style.setProperty('--ga-y', '0px'); dicaTxt.style.transform = ''; dicaTxt.style.opacity = ''; trava.classList.remove('ga-arrastando'); trava.style.setProperty('--ga-ty', '0px'); trava.style.setProperty('--ga-seta', '1'); }
      return;
    }
    if (!S.eixo) { S.eixo = -dx >= -dy ? 'x' : 'y'; botao.classList.add('ga-arrastando'); }
    if (S.eixo === 'x') {
      const lim = limiteCancelar();
      const p = Math.min(1, -dx / lim);
      botao.style.setProperty('--ga-x', Math.max(dx, -lim) + 'px'); botao.style.setProperty('--ga-y', '0px');
      dicaTxt.style.transform = `translateX(${Math.round(dx * 0.55)}px)`; dicaTxt.style.opacity = String(1 - p * 0.85);
      if (-dx >= lim) concluir('lixeira');
    } else {
      const p = Math.min(1, -dy / TRAVA_PX);
      botao.style.setProperty('--ga-y', Math.max(dy, -TRAVA_PX - 12) + 'px'); botao.style.setProperty('--ga-x', '0px');
      trava.classList.add('ga-arrastando');
      trava.style.setProperty('--ga-ty', Math.round(-p * 18) + 'px'); trava.style.setProperty('--ga-seta', String(1 - p));
      if (p >= 1) travar();
    }
  });
  const soltar = (e) => {
    if (e.pointerId !== S.pid) return;
    S.pid = null;
    if (S.fase !== 'segurando') return;
    const rapido = performance.now() - S.t0 < TOQUE_MS && !S.eixo;
    if (rapido && e.type === 'pointerup') { concluir('rapido'); mostrarDica(); return; }
    if (e.type !== 'pointerup' || !S.rec) { S.soltou = true; travar(); return; } // interrompido, ou o microfone ainda abrindo
    concluir('enviar');
  };
  botao.addEventListener('pointerup', soltar);
  botao.addEventListener('pointercancel', soltar);
  botao.addEventListener('lostpointercapture', soltar);
  botao.addEventListener('contextmenu', (e) => { if (ativo() || !texto.value.trim()) e.preventDefault(); });
  // saiu do app no meio do "segurar": continua gravando travado (decide depois)
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.fase === 'segurando') { S.pid = null; travar(); } });

  // ------------------------------------------------------------ modo travado
  btApagar.addEventListener('click', () => concluir('lixeira'));
  btMandar.addEventListener('click', () => concluir('enviar'));
  btPausa.addEventListener('click', () => {
    const rec = S.rec; if (!rec || S.fase !== 'travado') return;
    try {
      if (!S.pausado && rec.state === 'recording') { rec.pause(); S.acumulado += performance.now() - S.inicio; S.pausado = true; }
      else if (S.pausado && rec.state === 'paused') { rec.resume(); S.inicio = performance.now(); S.pausado = false; }
    } catch { return; }
    faixa.dataset.estado = S.pausado ? 'pausado' : 'gravando';
    estadoTxt.textContent = S.pausado ? 'Pausado' : 'Gravando…';
    acertarPausa();
    vibrar(8);
  });

  window.SintoniaGravar = {
    ativo,
    /** Descarta a gravação (ESC). Com { rapido: true } some na hora, sem a lixeira (troca de conversa). */
    cancelar: ({ rapido = false } = {}) => { if (ativo()) concluir(rapido ? 'rapido' : 'lixeira'); },
    teclado: () => comecar({ teclado: true }),
  };
})();
