/* Notificações da Sintonia: registra window.SintoniaTelas.notificacoes = { abrir(), fechar(), preferencias(), verificar() }.
 * Sino com contador (barra lateral no computador, topo das Conversas no celular), painel de vidro com a lista,
 * aviso (toast) + som quando chega algo novo com o app aberto, contador no título e no ícone da aba,
 * preferências (tipos, som, push no celular, não perturbe) e o push de verdade (service worker /sw.js).
 * O contador chega no cabeçalho x-notificacoes das chamadas que o app já faz (evento "sintonia:notificacoes").
 * Estilos próprios em <style id="estilo-notificacoes">, tudo com prefixo .nt- e só com os tokens do ds.css.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, post, el, toast } = ui;
  const $ = (id) => document.getElementById(id);

  const CSS = `
  .nt-bolinha { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: grid; place-items: center;
    font: 800 10.5px/1 var(--fonte); background: var(--badge); color: var(--badge-txt); box-shadow: 0 0 0 2px var(--fundo), 0 0 10px color-mix(in srgb, var(--badge) 60%, transparent); pointer-events: none; }
  #sino-cel { position: relative; }
  @media (min-width: 761px) { #sino-cel { display: none !important; } }
  #sino-cel svg, #lt-sino svg { transform-origin: 50% 10%; }
  .nt-balanca svg { animation: nt-balanca .9s ease; }
  @keyframes nt-balanca { 0%,100% { transform: rotate(0) } 15% { transform: rotate(14deg) } 30% { transform: rotate(-12deg) } 45% { transform: rotate(8deg) } 60% { transform: rotate(-5deg) } 75% { transform: rotate(2deg) } }
  @media (prefers-reduced-motion: reduce) { .nt-balanca svg { animation: none; } }

  .nt-fundo { position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,.18); opacity: 0; transition: opacity .2s ease; }
  .nt-fundo.nt-ver { opacity: 1; }
  .nt-painel { position: fixed; z-index: 81; display: flex; flex-direction: column; min-height: 0; color: var(--texto); font-family: var(--fonte);
    background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho), 0 24px 60px rgba(0,0,0,.22);
    -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); transition: transform .24s cubic-bezier(.2,.8,.2,1), opacity .2s ease; }
  @media (min-width: 761px) {
    .nt-painel { top: 12px; width: 430px; max-height: calc(100vh - 24px); border-radius: 26px; opacity: 0; transform: translateY(-6px) scale(.98); transform-origin: top right; }
    .nt-painel.nt-ver { opacity: 1; transform: none; }
    .nt-fundo { background: transparent; }
  }
  @media (max-width: 760px) {
    .nt-painel { left: 0; right: 0; bottom: 0; max-height: 86vh; border-radius: 26px 26px 0 0; transform: translateY(100%); padding-bottom: env(safe-area-inset-bottom); }
    .nt-painel.nt-ver { transform: none; }
  }
  .nt-alca { width: 40px; height: 5px; border-radius: 3px; background: var(--sub); opacity: .35; margin: 8px auto 0; }
  @media (min-width: 761px) { .nt-alca { display: none; } }
  .nt-cab { display: flex; align-items: center; gap: 8px; padding: 14px 16px 8px 20px; }
  .nt-cab h2 { margin: 0; font-size: 22px; font-weight: 800; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nt-curto { display: none; }
  @media (max-width: 420px) { .nt-longo { display: none; } .nt-curto { display: inline; } }
  .nt-botao { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 999px; font: 700 13px var(--fonte); white-space: nowrap; flex: none;
    color: var(--marca-azul); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  [data-tema="escuro"] .nt-botao { color: var(--texto); }
  .nt-botao:hover { background: var(--vidro-ativo); }
  .nt-botao[disabled] { opacity: .45; cursor: default; }
  .nt-icone { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .nt-icone svg { width: 18px; height: 18px; }
  .nt-botao:focus-visible, .nt-icone:focus-visible, .nt-item:focus-visible, .nt-chave input:focus-visible + i { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .nt-lista { overflow-y: auto; overscroll-behavior: contain; padding: 0 10px 14px; min-height: 120px; }
  .nt-grupo { font-size: 11.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--sub); padding: 14px 10px 6px; }
  .nt-item { all: unset; cursor: pointer; box-sizing: border-box; display: flex; gap: 12px; width: 100%; padding: 11px 10px; border-radius: 16px; position: relative; align-items: flex-start; }
  .nt-item:hover { background: var(--vidro-item); }
  .nt-item.nt-nova { background: color-mix(in srgb, var(--marca-azul) 9%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 18%, transparent); }
  [data-tema="escuro"] .nt-item.nt-nova { background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
  .nt-item + .nt-item { margin-top: 2px; }
  .nt-ic { flex: none; width: 40px; height: 40px; border-radius: 14px; display: grid; place-items: center; color: #fff; background: var(--marca-gradiente); box-shadow: var(--brilho-azul); }
  .nt-ic svg { width: 20px; height: 20px; }
  .nt-ic.nt-ic-acento { background: var(--marca-menta); color: var(--badge-txt); box-shadow: 0 6px 18px color-mix(in srgb, var(--marca-menta) 40%, transparent); }
  .nt-ic.nt-ic-alerta { background: var(--aviso); color: var(--aviso-txt); box-shadow: none; }
  .nt-corpo { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .nt-titulo { font-size: 15px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
  .nt-nova .nt-titulo { font-weight: 800; }
  .nt-texto { font-size: 13.5px; color: var(--sub); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .nt-quando { font-size: 12px; color: var(--sub); white-space: nowrap; }
  .nt-ponto { position: absolute; right: 12px; top: 16px; width: 9px; height: 9px; border-radius: 50%; background: var(--badge); box-shadow: 0 0 8px var(--badge); }
  .nt-nova .nt-quando { padding-right: 16px; }
  .nt-vazio { text-align: center; padding: 34px 20px 40px; color: var(--sub); font-size: 14.5px; line-height: 1.45; }
  .nt-vazio b { display: block; color: var(--texto); font-size: 16px; margin: 10px 0 4px; }
  .nt-vazio svg { width: 44px; height: 44px; color: var(--marca-azul); opacity: .7; }
  .nt-fim { text-align: center; font-size: 12.5px; color: var(--sub); padding: 12px; }
  .nt-convite { margin: 0 16px 8px; padding: 12px 14px; border-radius: 16px; display: flex; gap: 10px; align-items: center; font-size: 13.5px; line-height: 1.35;
    background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .nt-convite span { flex: 1; }

  .nt-toast { position: fixed; z-index: 90; display: flex; gap: 12px; align-items: center; cursor: pointer; color: var(--texto); font-family: var(--fonte);
    padding: 12px 14px; border-radius: 20px; background: var(--vidro-forte); border: 1px solid var(--vidro-borda); box-shadow: var(--vidro-brilho), 0 18px 44px rgba(0,0,0,.22);
    -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .2s ease; opacity: 0; }
  .nt-toast.nt-ver { opacity: 1; transform: none !important; }
  @media (min-width: 761px) { .nt-toast { top: 18px; right: 18px; width: 360px; transform: translateY(-12px); } }
  @media (max-width: 760px) { .nt-toast { top: calc(10px + env(safe-area-inset-top)); left: 12px; right: 12px; transform: translateY(-120%); } }
  .nt-toast .nt-corpo { gap: 1px; }
  .nt-toast .nt-fechar { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); flex: none; }
  .nt-toast .nt-fechar svg { width: 15px; height: 15px; }

  .nt-pref { max-width: 520px; width: calc(100vw - 24px); padding: 0; border: 1px solid var(--vidro-borda); border-radius: 26px; color: var(--texto); font-family: var(--fonte);
    background: var(--vidro-forte); box-shadow: var(--vidro-brilho), 0 24px 60px rgba(0,0,0,.25); -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  .nt-pref::backdrop { background: rgba(0,0,0,.3); }
  @media (max-width: 760px) { .nt-pref { margin: auto 0 0; width: 100vw; max-width: none; max-height: 92vh; border-radius: 26px 26px 0 0; } }
  .nt-pref-corpo { padding: 4px 18px 20px; display: grid; gap: 14px; overflow-y: auto; max-height: calc(92vh - 70px); }
  .nt-secao { display: grid; gap: 2px; padding: 6px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .nt-secao h3 { margin: 6px 10px 4px; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--sub); }
  .nt-linha { display: flex; align-items: center; gap: 12px; min-height: 46px; padding: 4px 10px; border-radius: 12px; font-size: 15px; }
  .nt-linha > span { flex: 1; min-width: 0; }
  .nt-linha small { display: block; color: var(--sub); font-size: 12.5px; line-height: 1.35; margin-top: 2px; }
  .nt-chave { position: relative; flex: none; cursor: pointer; }
  .nt-chave input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .nt-chave i { display: block; width: 46px; height: 28px; border-radius: 999px; background: var(--vidro-ativo); box-shadow: inset 0 0 0 1px var(--vidro-borda); position: relative; transition: background .2s ease; }
  .nt-chave i::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .2s ease; }
  .nt-chave input:checked + i { background: var(--marca-azul); }
  [data-tema="escuro"] .nt-chave input:checked + i { background: var(--marca-menta); }
  .nt-chave input:checked + i::after { transform: translateX(18px); }
  .nt-chave input:disabled + i { opacity: .45; }
  .nt-horas { display: flex; gap: 10px; align-items: center; padding: 4px 10px 8px; font-size: 14px; color: var(--sub); flex-wrap: wrap; }
  .nt-horas input { font: 600 15px var(--fonte); color: var(--texto); background: var(--entrada); border: 1px solid var(--linha); border-radius: 10px; padding: 6px 8px; }
  .nt-dica { font-size: 13px; line-height: 1.45; color: var(--aviso-txt); background: var(--aviso); border-radius: 14px; padding: 10px 12px; margin: 4px 4px 6px; }
  .nt-acoes { display: flex; gap: 8px; flex-wrap: wrap; padding: 6px 4px 2px; }
  `;
  if (!$('estilo-notificacoes')) document.head.append(el('style', { id: 'estilo-notificacoes', text: CSS }));

  const SVG = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
  const IC = {
    sino: SVG('<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    nova_cliente: SVG('<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6"/>'),
    mensagem: SVG('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/>'),
    ia_equipe: SVG('<path d="M12 3l1.6 4.6L18 9.2l-4.4 1.6L12 15.4l-1.6-4.6L6 9.2l4.4-1.6L12 3Z"/><path d="M5 21a7 7 0 0 1 14 0"/>'),
    espera: SVG('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/>'),
    transferida: SVG('<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>'),
    agendamento: SVG('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M9 15l2 2 4-4"/>'),
    lembrete_ligacao: SVG('<path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/>'),
    falha: SVG('<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4M12 17.5v.01"/>'),
    teste: SVG('<path d="m5 12 4 4 10-10"/>'),
    fechar: SVG('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2.2"'),
    engrenagem: SVG('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20.9 10H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  };
  const CLASSE_IC = { nova_cliente: 'nt-ic-acento', falha: 'nt-ic-alerta', espera: 'nt-ic-alerta' };
  const TIPOS = [
    ['nova_cliente', 'Nova cliente', 'Alguém novo chamou no WhatsApp da sua unidade.'],
    ['mensagem', 'Mensagem da cliente', 'Nas suas conversas (ou nas sem dona, quando a IA não responde sozinha). No sino, várias seguidas viram um aviso só.'],
    ['ia_equipe', 'A IA passou para a equipe', 'Quando a IA pede ajuda de uma pessoa.'],
    ['espera', 'Cliente esperando', 'Ninguém respondeu além do limite da unidade (aviso e alerta forte).'],
    ['transferida', 'Conversa passada para você', ''],
    ['agendamento', 'Agendamento feito', 'Pela IA ou pela equipe, nas suas conversas (e para a gestão).'],
    ['lembrete_ligacao', 'Lembrete de ligação', 'Criado pelas automações, na hora marcada.'],
    ['falha', 'Falhas importantes', 'WhatsApp desconectado ou chave da IA recusada (só administração e direção).'],
  ];

  const est = { itens: [], proximo: null, carregando: false, aberto: false, n: 0, versao: null, silencio: false, prefs: null, tituloBase: document.title.replace(/^\(\d+\+?\)\s*/, ''), toastAtual: null, vistas: new Set() };

  // ---------------------------------------------------------------- tempo
  const diaDe = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const grupoDe = (d) => { const hoje = diaDe(Date.now()); const g = diaDe(d); return g === hoje ? 'Hoje' : g === hoje - 864e5 ? 'Ontem' : 'Antes'; };
  function relativo(d) {
    const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (grupoDe(d) === 'Hoje') return `há ${Math.floor(s / 3600)} h`;
    const hm = new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (grupoDe(d) === 'Ontem') return `ontem, ${hm}`;
    return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + `, ${hm}`;
  }
  const textoDe = (n) => (n.contador > 1 ? `${n.texto} · ${n.contador} mensagens` : n.texto);

  // ---------------------------------------------------------------- contador, título, ícone da aba
  const iconeOriginal = document.querySelector('link[rel="icon"][sizes="64x64"]') || document.querySelector('link[rel="icon"]');
  const hrefOriginal = iconeOriginal ? iconeOriginal.href : '/favicon-64.png';
  let imgIcone;
  function desenharIcone(n) {
    if (!iconeOriginal) return;
    if (!n) { iconeOriginal.href = hrefOriginal; return; }
    const pintar = () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d');
      g.drawImage(imgIcone, 0, 0, 64, 64);
      const cor = getComputedStyle(document.documentElement).getPropertyValue('--badge').trim() || 'red';
      g.beginPath(); g.arc(48, 16, 15, 0, 2 * Math.PI); g.fillStyle = cor; g.fill();
      g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke();
      try { iconeOriginal.href = c.toDataURL('image/png'); } catch {}
    };
    if (imgIcone?.complete && imgIcone.naturalWidth) return pintar();
    imgIcone = new Image(); imgIcone.onload = pintar; imgIcone.src = hrefOriginal;
  }
  function mostrarContador(n) {
    est.n = n;
    const txt = n > 99 ? '99+' : String(n);
    for (const id of ['lt-sino-qtd', 'sino-cel-qtd']) { const b = $(id); if (b) { b.hidden = !n; b.textContent = txt; } }
    for (const id of ['lt-sino', 'sino-cel']) { const b = $(id); if (b) b.setAttribute('aria-label', n ? `Notificações, ${n} não lida${n > 1 ? 's' : ''}` : 'Notificações'); }
    document.title = n ? `(${txt}) ${est.tituloBase}` : est.tituloBase;
    desenharIcone(n);
    if ($('nt-marcar')) $('nt-marcar').disabled = !n;
  }
  const balancar = () => ['lt-sino', 'sino-cel'].forEach((id) => { const b = $(id); if (!b) return; b.classList.remove('nt-balanca'); void b.offsetWidth; b.classList.add('nt-balanca'); });

  // ---------------------------------------------------------------- som (Web Audio, sem arquivo)
  let audio;
  const prepararAudio = () => { try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {} };
  addEventListener('pointerdown', prepararAudio, { once: true, capture: true });
  addEventListener('keydown', prepararAudio, { once: true, capture: true });
  function tocar() {
    // O som é o mesmo da mensagem nova (padrão: Futurista), desenhado em /telas/alertas.js.
    const al = window.SintoniaTelas.alertas;
    if (al?.tocarMensagem && al.tocarMensagem()) return;
    try {
      prepararAudio(); if (!audio || audio.state !== 'running') return;
      const t = audio.currentTime;
      [[880, 0], [1318.5, 0.11]].forEach(([f, atraso]) => {
        const o = audio.createOscillator(), v = audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        v.gain.setValueAtTime(0.0001, t + atraso);
        v.gain.exponentialRampToValueAtTime(0.09, t + atraso + 0.015);
        v.gain.exponentialRampToValueAtTime(0.0001, t + atraso + 0.22);
        o.connect(v).connect(audio.destination); o.start(t + atraso); o.stop(t + atraso + 0.25);
      });
    } catch {}
  }

  // ---------------------------------------------------------------- abrir o que a notificação aponta
  function irPara(n) {
    if (n.conversaId) { ui.abrir(n.conversaId); return; }
    if (n.vista === 'conexoes') { location.href = '/conexoes'; return; }
    if (n.vista) ui.mostrar(n.vista);
  }
  async function tocarItem(n) {
    fechar();
    if (!n.lida) {
      n.lida = true; mostrarContador(Math.max(0, est.n - 1));
      post(`/api/notificacoes/${n.id}/lida`).catch(() => {});
    }
    irPara(n);
  }

  // ---------------------------------------------------------------- toast
  function mostrarToast(n) {
    est.toastAtual?.remove();
    const t = el('div', { class: 'nt-toast', role: 'status', 'aria-live': 'polite' });
    const ic = el('span', { class: 'nt-ic ' + (CLASSE_IC[n.tipo] || ''), html: IC[n.tipo] || IC.sino });
    const fechar = el('button', { class: 'nt-fechar', 'aria-label': 'Dispensar', html: IC.fechar });
    t.append(ic, el('div', { class: 'nt-corpo' }, el('b', { class: 'nt-titulo', text: n.titulo }), el('span', { class: 'nt-texto', text: textoDe(n) })), fechar);
    const some = () => { t.classList.remove('nt-ver'); setTimeout(() => t.remove(), 300); if (est.toastAtual === t) est.toastAtual = null; };
    fechar.addEventListener('click', (e) => { e.stopPropagation(); some(); });
    t.addEventListener('click', () => { some(); tocarItem(n); });
    document.body.append(t); est.toastAtual = t;
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('nt-ver')));
    setTimeout(some, 6500);
  }

  // ---------------------------------------------------------------- busca
  async function buscar(mais = false) {
    if (est.carregando || (mais && !est.proximo)) return null;
    est.carregando = true;
    try {
      const q = new URLSearchParams({ limite: '20' });
      if (mais) q.set('antes', est.proximo);
      const r = await api('/api/notificacoes?' + q);
      est.itens = mais ? est.itens.concat(r.itens.filter((x) => !est.itens.some((y) => y.id === x.id))) : r.itens;
      est.proximo = r.proximo; est.silencio = r.silencio;
      mostrarContador(r.naoLidas);
      if (r.versao) est.versao = Math.max(est.versao ?? 0, r.versao);
      return r;
    } finally { est.carregando = false; }
  }

  /** Chegou versão nova pelo cabeçalho: busca, e avisa (toast + som) do que é novo e ainda não lido. */
  async function novidades(versaoAntiga) {
    const r = await buscar(false).catch(() => null);
    if (!r) return;
    if (est.aberto) desenharLista();
    const novas = r.itens.filter((n) => !n.lida && new Date(n.em).getTime() > versaoAntiga && !est.vistas.has(n.id + ':' + n.em));
    novas.forEach((n) => est.vistas.add(n.id + ':' + n.em));
    if (!novas.length) return;
    balancar();
    // A conversa já está aberta na tela: não precisa de aviso.
    const fora = novas.filter((n) => !(n.conversaId && ui.estado.aberta === n.conversaId && !document.hidden));
    if (!fora.length) return;
    if (!est.aberto) mostrarToast(fora[0]);
    // Mensagem da cliente já tem o som próprio (/telas/alertas.js): sem toque em dobro.
    const soMensagens = fora.every((n) => n.tipo === 'mensagem' || n.tipo === 'nova_cliente') && est.prefs?.mensagens?.som !== false && window.SintoniaTelas.alertas;
    if (fora.some((n) => n.tipo === 'espera')) window.SintoniaTelas.alertas?.atualizar();
    if (!est.silencio && (est.prefs?.som ?? true) && !soMensagens) tocar();
  }

  addEventListener('sintonia:notificacoes', (e) => {
    const { n = 0, v = 0, s = 0 } = e.detail || {};
    est.silencio = Boolean(s);
    if (n !== est.n) mostrarContador(n);
    if (est.versao === null) { est.versao = v; return; } // primeira leitura: só o contador
    if (v > est.versao) { const antiga = est.versao; est.versao = v; novidades(antiga); }
  });

  // ---------------------------------------------------------------- painel
  let fundo, painel, lista, sentinela, observador;
  function montarPainel() {
    fundo = el('div', { class: 'nt-fundo', onclick: fechar });
    painel = el('section', { class: 'nt-painel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Notificações', tabindex: '-1' });
    const marcar = el('button', { class: 'nt-botao', id: 'nt-marcar', title: 'Marcar todas como lidas', onclick: marcarTodas }, el('span', { class: 'nt-longo', text: 'Marcar todas como lidas' }), el('span', { class: 'nt-curto', text: 'Ler todas' }));
    const pref = el('button', { class: 'nt-icone', title: 'Preferências de notificação', 'aria-label': 'Preferências de notificação', html: IC.engrenagem, onclick: () => { fechar(); abrirPreferencias(); } });
    const x = el('button', { class: 'nt-icone', title: 'Fechar', 'aria-label': 'Fechar', html: IC.fechar, onclick: fechar });
    lista = el('div', { class: 'nt-lista', id: 'nt-lista' });
    painel.append(el('div', { class: 'nt-alca' }), el('div', { class: 'nt-cab' }, el('h2', { text: 'Notificações' }), marcar, pref, x), el('div', { id: 'nt-convite' }), lista);
    painel.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    // Puxar a folha para baixo fecha (celular).
    let y0 = null;
    painel.addEventListener('touchstart', (e) => { y0 = lista.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    painel.addEventListener('touchmove', (e) => { if (y0 !== null && e.touches[0].clientY - y0 > 90) { y0 = null; fechar(); } }, { passive: true });
    document.body.append(fundo, painel);
    observador = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) buscar(true).then((r) => r && desenharLista()); }, { root: lista, rootMargin: '120px' });
  }

  function desenharLista() {
    if (!lista) return;
    observador?.disconnect();
    if (!est.itens.length) {
      lista.replaceChildren(el('div', { class: 'nt-vazio', html: IC.sino }, ));
      lista.firstChild.append(el('b', { text: 'Nada por aqui ainda' }), el('span', { text: 'Novas clientes, mensagens, agendamentos e lembretes aparecem aqui.' }));
      return;
    }
    const frag = [];
    let grupo = '';
    for (const n of est.itens) {
      const g = grupoDe(n.em);
      if (g !== grupo) { grupo = g; frag.push(el('div', { class: 'nt-grupo', text: g })); }
      const b = el('button', { class: 'nt-item' + (n.lida ? '' : ' nt-nova'), 'data-id': n.id, onclick: () => tocarItem(n) },
        el('span', { class: 'nt-ic ' + (CLASSE_IC[n.tipo] || ''), html: IC[n.tipo] || IC.sino }),
        el('span', { class: 'nt-corpo' }, el('span', { class: 'nt-titulo', text: n.titulo }), n.texto ? el('span', { class: 'nt-texto', text: textoDe(n) }) : null, el('span', { class: 'nt-quando', text: relativo(n.em) })),
        n.lida ? null : el('i', { class: 'nt-ponto', 'aria-label': 'não lida' }));
      frag.push(b);
    }
    sentinela = el('div', { class: 'nt-fim', text: est.proximo ? 'Carregando…' : 'Isso é tudo.' });
    frag.push(sentinela);
    lista.replaceChildren(...frag);
    if (est.proximo) observador.observe(sentinela);
  }

  function desenharConvite() {
    const c = $('nt-convite'); if (!c) return;
    c.replaceChildren();
    if (!('Notification' in window) || Notification.permission !== 'default' || est.prefs?.push === false) return;
    c.append(el('div', { class: 'nt-convite' }, el('span', { text: 'Receba os avisos mesmo com o app fechado.' }), el('button', { class: 'nt-botao', text: 'Ativar', onclick: async () => { await ligarPush(true); desenharConvite(); } })));
  }

  function posicionar() {
    if (!painel) return;
    // Computador: abre embaixo do sininho do topo, alinhado à direita. Celular: folha que sobe de baixo.
    const sino = $('lt-sino');
    if (matchMedia('(min-width: 761px)').matches && sino && sino.offsetParent) {
      const r = sino.getBoundingClientRect();
      painel.style.left = 'auto';
      painel.style.right = `${Math.max(12, Math.round(innerWidth - r.right))}px`;
      painel.style.top = `${Math.round(r.bottom + 8)}px`;
      painel.style.maxHeight = `calc(100vh - ${Math.round(r.bottom + 20)}px)`;
    } else if (matchMedia('(min-width: 761px)').matches) {
      // Computador sem sino no topo (aberto pelo menu): mesmo lugar, no canto superior direito.
      painel.style.left = 'auto'; painel.style.right = '16px'; painel.style.top = '64px'; painel.style.maxHeight = 'calc(100vh - 80px)';
    } else { painel.style.left = ''; painel.style.right = ''; painel.style.top = ''; painel.style.maxHeight = ''; }
  }

  async function abrir() {
    if (!painel) montarPainel();
    est.aberto = true; posicionar();
    fundo.hidden = false; painel.hidden = false;
    requestAnimationFrame(() => { fundo.classList.add('nt-ver'); painel.classList.add('nt-ver'); });
    ['lt-sino', 'sino-cel'].forEach((id) => $(id)?.setAttribute('aria-expanded', 'true'));
    desenharLista(); desenharConvite();
    painel.focus({ preventScroll: true });
    await buscar(false).catch(() => {});
    desenharLista();
  }
  function fechar() {
    if (!painel || !est.aberto) return;
    est.aberto = false;
    fundo.classList.remove('nt-ver'); painel.classList.remove('nt-ver');
    ['lt-sino', 'sino-cel'].forEach((id) => $(id)?.setAttribute('aria-expanded', 'false'));
    setTimeout(() => { if (!est.aberto) { fundo.hidden = true; painel.hidden = true; } }, 260);
  }
  async function marcarTodas() {
    await post('/api/notificacoes/lidas').catch(() => {});
    est.itens.forEach((n) => (n.lida = true));
    mostrarContador(0); desenharLista(); toast('Tudo marcado como lido.');
  }
  addEventListener('resize', posicionar);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && est.aberto) fechar(); });

  for (const id of ['lt-sino', 'sino-cel']) {
    const b = $(id);
    if (b) { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.addEventListener('click', () => (est.aberto ? fechar() : abrir())); }
  }

  // ---------------------------------------------------------------- push (service worker)
  const ehIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushSuportado = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let registro = null;
  async function registrarSW() {
    if (!('serviceWorker' in navigator)) return null;
    try { registro = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch { registro = null; }
    return registro;
  }
  const chaveBytes = (b64) => { const p = '='.repeat((4 - (b64.length % 4)) % 4); const s = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

  /** Pede permissão (se `pedir`), inscreve o aparelho e grava no servidor. Devolve true se ficou inscrito. */
  async function ligarPush(pedir) {
    if (!pushSuportado) { toast(ehIOS && !instalado ? 'No iPhone, adicione a Sintonia à Tela de Início primeiro.' : 'Este navegador não recebe notificações.'); return false; }
    let perm = Notification.permission;
    if (perm === 'default' && pedir) perm = await Notification.requestPermission();
    if (perm !== 'granted') { if (pedir) toast(perm === 'denied' ? 'As notificações estão bloqueadas nas configurações do navegador.' : 'Permissão não concedida.'); return false; }
    try {
      const reg = registro || (await registrarSW()) || (await navigator.serviceWorker.ready);
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { chave } = await api('/api/push/chave');
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveBytes(chave) });
      }
      await post('/api/push/inscrever', sub.toJSON());
      return true;
    } catch (x) {
      if (pedir) toast('Não foi possível ativar neste aparelho: ' + (x.message || 'erro'));
      return false;
    }
  }
  async function desligarPush() {
    try {
      const reg = registro || (await navigator.serviceWorker.getRegistration('/'));
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) { await post('/api/push/sair', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    } catch {}
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.tipo === 'sintonia:abrir') { irPara(m.dados || {}); buscar(false).catch(() => {}); }
      if (m.tipo === 'sintonia:push') { const antiga = est.versao ?? 0; novidades(antiga); }
      if (m.tipo === 'sintonia:reinscrever' && est.prefs?.push !== false) ligarPush(false);
    });
  }

  // ---------------------------------------------------------------- preferências
  let dlg;
  async function salvar(campos) {
    try { est.prefs = { ...est.prefs, ...(await api('/api/notificacoes/preferencias', { method: 'PUT', body: JSON.stringify(campos) })) }; dispatchEvent(new CustomEvent('sintonia:preferencias', { detail: est.prefs })); }
    catch (x) { toast(x.message); }
  }
  const chave = (checked, onchange, rotulo, disabled = false) => {
    const i = el('input', { type: 'checkbox', role: 'switch', 'aria-label': rotulo });
    i.checked = checked; i.disabled = disabled; i.addEventListener('change', () => onchange(i.checked, i));
    return el('label', { class: 'nt-chave' }, i, el('i'));
  };
  const linhaPref = (titulo, sub, controle) => el('div', { class: 'nt-linha' }, el('span', {}, titulo, sub ? el('small', { text: sub }) : null), controle);

  async function abrirPreferencias() {
    const p = await api('/api/notificacoes/preferencias').catch((x) => { toast(x.message); return null; });
    if (!p) return;
    est.prefs = p;
    dlg?.remove();
    dlg = el('dialog', { class: 'nt-pref', 'aria-label': 'Preferências de notificação' });
    const corpo = el('div', { class: 'nt-pref-corpo' });
    const x = el('button', { class: 'nt-icone', 'aria-label': 'Fechar', html: IC.fechar, onclick: () => dlg.close() });
    dlg.append(el('div', { class: 'nt-alca' }), el('div', { class: 'nt-cab' }, el('h2', { text: 'Notificações' }), x), corpo);

    // Celular / computador (push)
    const permissao = 'Notification' in window ? Notification.permission : 'indisponivel';
    const estadoPush = el('small');
    const atualizarEstadoPush = async () => {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/').catch(() => null) : null;
      const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription().catch(() => null) : null;
      const perm = 'Notification' in window ? Notification.permission : 'indisponivel';
      estadoPush.textContent = !pushSuportado ? (ehIOS && !instalado ? 'Disponível depois de adicionar à Tela de Início.' : 'Este navegador não recebe notificações.')
        : perm === 'denied' ? 'Bloqueado nas configurações do navegador.'
        : sub && est.prefs.push ? 'Ativo neste aparelho.' : 'Desligado neste aparelho.';
      return Boolean(sub);
    };
    const inscrito = await atualizarEstadoPush();
    const chavePush = chave(Boolean(p.push && inscrito && permissao === 'granted'), async (ligado, input) => {
      if (ligado) {
        const ok = await ligarPush(true);
        input.checked = ok;
        if (ok) { await salvar({ push: true }); toast('Pronto: este aparelho vai receber os avisos.'); }
      } else { await desligarPush(); await salvar({ push: false }); }
      atualizarEstadoPush();
    }, 'Receber no celular', !p.pushDisponivel || (!pushSuportado && !ehIOS));
    const secPush = el('div', { class: 'nt-secao' }, el('h3', { text: 'Neste aparelho' }),
      el('div', { class: 'nt-linha' }, el('span', {}, 'Receber no celular', estadoPush), chavePush));
    if (ehIOS && !instalado) secPush.append(el('div', { class: 'nt-dica', text: 'No iPhone: abra a Sintonia no Safari, toque em Compartilhar (o quadrado com a seta) e depois em "Adicionar à Tela de Início". Abra pelo ícone novo e ligue esta opção. Precisa do iOS 16.4 ou mais novo.' }));
    else secPush.append(el('div', { class: 'nt-linha' }, el('small', { text: 'O aviso chega mesmo com o app fechado. Tocar nele abre a conversa.' })));
    secPush.append(linhaPref('Som no app', 'Um toque curto quando chega algo com o app aberto.', chave(p.som, (v) => { salvar({ som: v }); if (v) tocar(); }, 'Som no app')));
    secPush.append(el('div', { class: 'nt-acoes' },
      el('button', { class: 'nt-botao', text: 'Testar som', onclick: () => { prepararAudio(); setTimeout(tocar, 30); } }),
      el('button', { class: 'nt-botao', text: 'Enviar notificação de teste', onclick: async () => { const r = await post('/api/notificacoes/teste').catch((x2) => toast(x2.message)); if (r) toast(r.aparelhos ? `Enviada para ${r.aparelhos} aparelho(s).` : 'Enviada para o sino (nenhum aparelho com push ligado).'); } })));

    // Não perturbe
    const np = p.naoPerturbe;
    const inicio = el('input', { type: 'time', value: np.inicio, 'aria-label': 'Início do não perturbe' });
    const fim = el('input', { type: 'time', value: np.fim, 'aria-label': 'Fim do não perturbe' });
    const horas = el('div', { class: 'nt-horas' }, 'Das', inicio, 'às', fim);
    horas.hidden = !np.ligado;
    const salvarHoras = () => { if (inicio.value && fim.value) salvar({ naoPerturbe: { ligado: true, inicio: inicio.value, fim: fim.value } }); };
    inicio.addEventListener('change', salvarHoras); fim.addEventListener('change', salvarHoras);
    const secNp = el('div', { class: 'nt-secao' }, el('h3', { text: 'Não perturbe' }),
      linhaPref('Silenciar em um horário', 'Os avisos continuam no sino, mas o celular não toca.', chave(np.ligado, (v) => { horas.hidden = !v; salvar({ naoPerturbe: { ligado: v, inicio: inicio.value || '22:00', fim: fim.value || '07:00' } }); }, 'Não perturbe')),
      horas);

    // Tipos
    const souGestao = ['admin', 'direcao'].includes(ui.estado.eu?.papel);
    const secTipos = el('div', { class: 'nt-secao' }, el('h3', { text: 'O que avisar' }),
      ...TIPOS.filter(([t]) => t !== 'falha' || souGestao).map(([t, titulo, sub]) => linhaPref(titulo, sub, chave(p.tipos[t] !== false, (v) => salvar({ tipos: { [t]: v } }), titulo))));

    const extras = window.SintoniaTelas.alertas ? await window.SintoniaTelas.alertas.secoesPreferencias(p).catch(() => []) : [];
    corpo.append(secPush, ...extras, secNp, secTipos);
    document.body.append(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }

  // ---------------------------------------------------------------- chegada por link (#conversa=<id>)
  function seguirHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const id = h.get('conversa'), vista = h.get('vista');
    if (!id && !vista) return;
    history.replaceState(null, '', location.pathname + location.search);
    irPara({ conversaId: id, vista });
  }
  addEventListener('hashchange', seguirHash);

  // ---------------------------------------------------------------- início
  (async () => {
    await registrarSW();
    // Espera o app saber quem está logada antes de abrir a conversa do link.
    for (let i = 0; i < 50 && !ui.estado.eu; i++) await new Promise((r) => setTimeout(r, 100));
    seguirHash();
    est.prefs = await api('/api/notificacoes/preferencias').catch(() => null);
    await buscar(false).catch(() => {});
    // Já tinha permitido: renova a inscrição (o navegador pode ter trocado o endereço).
    if (pushSuportado && Notification.permission === 'granted' && est.prefs?.push) ligarPush(false);
  })();

  window.SintoniaTelas.notificacoes = { abrir, fechar, preferencias: abrirPreferencias, verificar: () => novidades(est.versao ?? 0), tocar };
})();
