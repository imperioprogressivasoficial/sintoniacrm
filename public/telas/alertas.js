/* Alertas da Sintonia: registra window.SintoniaTelas.alertas = { sons, tocarMensagem, tocarAlarme, secoesPreferencias, atualizar }.
 * - Som (e vibração) a cada mensagem nova da cliente em qualquer conversa que a pessoa vê, com o app aberto.
 * - Cliente esperando além do limite (regras por unidade, /api/espera): faixa vermelha fixa no topo que leva à conversa,
 *   alarme repetido até alguém responder ou a pessoa silenciar, e destaque vermelho na lista com o tempo correndo.
 * - Seções "Cada mensagem" e "Cliente esperando" das preferências (Mais › Notificações).
 * Sons em Web Audio (sem arquivo). Estilos com prefixo .esp-, só tokens do ds.css (mais o vermelho de alerta local).
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, post, el, toast } = ui;
  const $ = (id) => document.getElementById(id);

  const CSS = `
  :root { --esp-vermelho: #d4253a; --esp-vermelho-forte: #a50f24; --esp-vermelho-suave: rgba(212, 37, 58, .10); --esp-h: 0px; }
  [data-tema="escuro"] { --esp-vermelho: #ff5468; --esp-vermelho-forte: #ff2d47; --esp-vermelho-suave: rgba(255, 84, 104, .16); }
  body.esp-com-faixa { --esp-h: calc(46px + env(safe-area-inset-top, 0px)); }
  body.esp-com-faixa .casca { margin-top: var(--esp-h); height: calc(100vh - var(--esp-h)); height: calc(100dvh - var(--esp-h)); }
  .esp-faixa { position: fixed; top: 0; left: 0; right: 0; z-index: 70; height: var(--esp-h); box-sizing: border-box; padding: env(safe-area-inset-top, 0px) 8px 0 14px;
    display: flex; align-items: center; gap: 10px; color: #fff; font: 600 14px/1.2 var(--fonte);
    background: linear-gradient(90deg, var(--esp-vermelho-forte), var(--esp-vermelho)); box-shadow: 0 6px 20px rgba(165, 15, 36, .35); }
  .esp-faixa.esp-n1 { background: linear-gradient(90deg, #b3471a, #d9731f); box-shadow: 0 6px 20px rgba(179, 71, 26, .3); }
  .esp-faixa[hidden] { display: none; }
  .esp-faixa .esp-ir { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; padding: 8px 0; }
  .esp-faixa .esp-ir span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .esp-faixa .esp-ir b { font-weight: 800; }
  .esp-pulso { width: 10px; height: 10px; flex: none; border-radius: 50%; background: #fff; box-shadow: 0 0 0 0 rgba(255,255,255,.7); animation: esp-pulso 1.4s ease-out infinite; }
  @keyframes esp-pulso { 0% { box-shadow: 0 0 0 0 rgba(255,255,255,.7) } 100% { box-shadow: 0 0 0 10px rgba(255,255,255,0) } }
  @media (prefers-reduced-motion: reduce) { .esp-pulso { animation: none; } }
  .esp-faixa .esp-silenciar { flex: none; height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.55); background: rgba(255,255,255,.14); color: #fff; font: 700 12.5px/1 var(--fonte); cursor: pointer; }
  .esp-faixa .esp-silenciar[aria-pressed="true"] { background: rgba(255,255,255,.3); }
  .esp-menu { position: fixed; z-index: 71; right: 8px; top: calc(var(--esp-h) + 6px); min-width: 190px; padding: 6px; border-radius: 16px; background: var(--vidro-forte); border: 1px solid var(--vidro-borda);
    box-shadow: var(--vidro-brilho), 0 18px 44px rgba(0,0,0,.22); -webkit-backdrop-filter: blur(22px) saturate(1.5); backdrop-filter: blur(22px) saturate(1.5); }
  .esp-menu button { display: block; width: 100%; text-align: left; padding: 10px 12px; border: 0; border-radius: 10px; background: none; color: var(--texto); font: 500 14px/1.2 var(--fonte); cursor: pointer; }
  .esp-menu button:hover, .esp-menu button:focus-visible { background: var(--vidro-item); }
  .esp-menu small { display: block; padding: 6px 12px 4px; color: var(--sub); font: 600 11.5px/1.2 var(--fonte); text-transform: uppercase; letter-spacing: .04em; }
  #itens .item.esp-item { box-shadow: inset 3px 0 0 var(--esp-vermelho); background: var(--esp-vermelho-suave); }
  #itens .item.esp-item.esp-item-1 { box-shadow: inset 3px 0 0 #d9731f; background: rgba(217, 115, 31, .09); }
  .esp-tempo { flex: none; display: inline-flex; align-items: center; gap: 4px; margin-left: 6px; padding: 2px 8px; border-radius: 999px; font: 700 11.5px/1.3 var(--fonte); color: #fff; background: var(--esp-vermelho); font-variant-numeric: tabular-nums; }
  .esp-item-1 .esp-tempo { background: #d9731f; }
  .esp-tempo svg { width: 12px; height: 12px; }
  .esp-regra { display: grid; gap: 8px; padding: 10px 0; border-top: 1px solid var(--vidro-linha); }
  .esp-regra:first-of-type { border-top: 0; }
  .esp-regra b { font-weight: 700; }
  .esp-campos { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; color: var(--sub); font: 500 13px/1.3 var(--fonte); }
  .esp-campos label { display: inline-flex; align-items: center; gap: 6px; }
  .esp-campos input[type="number"], .esp-campos input[type="time"], .nt-pref select { width: auto; min-width: 64px; height: 34px; padding: 0 8px; border-radius: 10px; border: 1px solid var(--linha); background: var(--entrada); color: var(--texto); font: 500 14px var(--fonte); }
  .esp-campos input[type="number"] { width: 64px; }
  .nt-pref input[type="range"] { width: 140px; accent-color: var(--marca-azul); }
  `;
  if (!$('estilo-alertas')) document.head.append(el('style', { id: 'estilo-alertas', text: CSS }));

  // ---------------------------------------------------------------- preferências da pessoa
  let prefs = null;
  const carregarPrefs = async () => { prefs = await api('/api/notificacoes/preferencias').catch(() => prefs); return prefs; };
  const pm = () => (prefs && prefs.mensagens) || { push: true, som: true, vibrar: true, tipoSom: 'gota', volume: 70 };
  const pe = () => (prefs && prefs.espera) || { push: true, alarme: true, volume: 80, silencioAte: null };
  addEventListener('sintonia:preferencias', (e) => { if (e.detail) prefs = e.detail; });

  // ---------------------------------------------------------------- sons (Web Audio)
  let audio;
  const prep = () => { try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch {} };
  addEventListener('pointerdown', prep, { capture: true });
  addEventListener('keydown', prep, { capture: true });
  /** Uma nota: frequência inicial → final, forma, início, duração e volume relativo. */
  function nota(f0, f1, tipo, ini, dur, v, ganho) {
    const t = audio.currentTime + ini;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = tipo; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * ganho), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const SONS = {
    gota: { nome: 'Gota', tocar: (g) => { nota(1350, 520, 'sine', 0, 0.16, 0.5, g); nota(1750, 900, 'sine', 0.1, 0.14, 0.32, g); } },
    bolha: { nome: 'Bolha', tocar: (g) => { nota(420, 900, 'sine', 0, 0.09, 0.55, g); nota(620, 1300, 'sine', 0.11, 0.1, 0.45, g); } },
    sininho: { nome: 'Sininho', tocar: (g) => { nota(1568, 1568, 'triangle', 0, 0.42, 0.42, g); nota(2093, 2093, 'sine', 0.07, 0.5, 0.26, g); } },
    duplo: { nome: 'Toque duplo', tocar: (g) => { nota(988, 988, 'square', 0, 0.07, 0.16, g); nota(1319, 1319, 'square', 0.12, 0.09, 0.16, g); } },
  };
  function tocarMensagem(tipo, volume) {
    try {
      prep(); if (!audio || audio.state !== 'running') return false;
      const v = (volume ?? pm().volume) / 100; if (v <= 0) return false;
      (SONS[tipo || pm().tipoSom] || SONS.gota).tocar(v * 0.6);
      return true;
    } catch { return false; }
  }
  /** Alarme de cliente esperando: sirene curta (mais longa no alerta forte). */
  function tocarAlarme(nivel = 2, volume) {
    try {
      prep(); if (!audio || audio.state !== 'running') return false;
      const v = (volume ?? pe().volume) / 100; if (v <= 0) return false;
      const voltas = nivel >= 2 ? 3 : 2;
      for (let i = 0; i < voltas; i++) { nota(880, 880, 'sawtooth', i * 0.36, 0.16, 0.22, v); nota(660, 660, 'sawtooth', i * 0.36 + 0.18, 0.16, 0.22, v); }
      return true;
    } catch { return false; }
  }
  const vibrar = (padrao) => { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(padrao); } catch {} };

  // ---------------------------------------------------------------- som a cada mensagem nova
  const vistas = new Map(); // conversaId -> última mensagem da cliente já vista (ms)
  let primeira = true;
  let silencioNp = false;
  addEventListener('sintonia:notificacoes', (e) => { silencioNp = Boolean(e.detail && e.detail.s); });
  function verMensagens() {
    const lista = ui.estado.conversas || [];
    let novas = 0;
    for (const c of lista) {
      const t = c.ultimaMensagemCliente ? new Date(c.ultimaMensagemCliente).getTime() : 0;
      const antes = vistas.get(c.id);
      if (!primeira && t && (antes === undefined ? Date.now() - t < 60_000 : t > antes)) novas++;
      vistas.set(c.id, t);
    }
    primeira = false;
    if (!novas) return;
    if (silencioNp) return;
    const m = pm();
    if (m.som) tocarMensagem(m.tipoSom, m.volume);
    if (m.vibrar) vibrar([120, 60, 120]);
    agendarEspera(800); // pode ter mudado quem está esperando
  }
  let ultimaLista = null;
  setInterval(() => { if (ui.estado.conversas !== ultimaLista) { ultimaLista = ui.estado.conversas; verMensagens(); decorarLista(); } }, 500);

  // ---------------------------------------------------------------- cliente esperando
  const esp = { itens: [], silencioAte: null, desvio: 0, ultimoAlarme: 0 };
  let faixa, menu;
  const silenciado = () => Boolean(esp.silencioAte && new Date(esp.silencioAte).getTime() > Date.now());
  const minutosDe = (it) => Math.max(0, Math.floor((Date.now() - esp.desvio - new Date(it.desde).getTime()) / 60000));
  const tempoTxt = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

  async function buscarEspera() {
    try {
      const r = await api('/api/espera');
      esp.itens = r.itens || []; esp.silencioAte = r.silencioAte;
      esp.desvio = Date.now() - new Date(r.agora).getTime();
    } catch { return; }
    desenharFaixa(); decorarLista(); talvezAlarme();
  }
  let tEspera;
  function agendarEspera(ms) { clearTimeout(tEspera); tEspera = setTimeout(buscarEspera, ms); }

  function montarFaixa() {
    faixa = el('div', { class: 'esp-faixa', id: 'esp-faixa', role: 'alert', hidden: '' });
    const ir = el('button', { class: 'esp-ir', id: 'esp-ir', onclick: () => { const it = esp.itens[0]; if (it) ui.abrir(it.conversaId); } });
    const sil = el('button', { class: 'esp-silenciar', id: 'esp-silenciar', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); abrirMenu(); } });
    faixa.append(ir, sil);
    document.body.append(faixa);
  }
  function desenharFaixa() {
    if (!faixa) montarFaixa();
    const itens = esp.itens;
    if (!itens.length) { faixa.hidden = true; document.body.classList.remove('esp-com-faixa'); fecharMenu(); return; }
    const forte = itens.some((x) => x.nivel >= 2);
    faixa.classList.toggle('esp-n1', !forte);
    const p = itens[0];
    const n = itens.length;
    const ir = $('esp-ir');
    ir.replaceChildren(el('i', { class: 'esp-pulso', 'aria-hidden': 'true' }),
      el('span', {}, el('b', { text: n === 1 ? '1 cliente esperando' : `${n} clientes esperando` }), ` — ${p.nome} há `, el('b', { class: 'esp-relogio', 'data-desde': p.desde, text: tempoTxt(minutosDe(p)) })));
    ir.setAttribute('aria-label', `${n} cliente(s) esperando. Abrir a conversa com ${p.nome}`);
    const s = $('esp-silenciar');
    const sil = silenciado();
    s.textContent = sil ? `Silenciado até ${new Date(esp.silencioAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Silenciar';
    s.setAttribute('aria-pressed', String(sil));
    faixa.hidden = false; document.body.classList.add('esp-com-faixa');
  }
  function fecharMenu() { menu?.remove(); menu = null; }
  function abrirMenu() {
    if (menu) return fecharMenu();
    menu = el('div', { class: 'esp-menu', role: 'menu' }, el('small', { text: 'Silenciar o alarme' }));
    for (const m of [5, 15, 30, 60]) menu.append(el('button', { role: 'menuitem', text: `Por ${m} minutos`, onclick: () => silenciar(m) }));
    if (silenciado()) menu.append(el('button', { role: 'menuitem', text: 'Voltar a tocar agora', onclick: () => silenciar(0) }));
    document.body.append(menu);
    menu.querySelector('button')?.focus();
  }
  addEventListener('click', (e) => { if (menu && !menu.contains(e.target)) fecharMenu(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(); });
  async function silenciar(min) {
    fecharMenu();
    try {
      const r = await post('/api/espera/silenciar', { minutos: min });
      esp.silencioAte = r.silencioAte;
      if (prefs?.espera) prefs.espera.silencioAte = r.silencioAte;
      toast(min ? `Alarme silenciado por ${min} minutos.` : 'O alarme volta a tocar.');
    } catch (x) { toast(x.message); }
    desenharFaixa();
  }

  function talvezAlarme() {
    if (!esp.itens.length || silenciado() || silencioNp || !pe().alarme) return;
    const nivel = Math.max(...esp.itens.map((x) => x.nivel));
    const cada = Math.min(...esp.itens.map((x) => x.repetirSeg || 45)) * 1000;
    if (Date.now() - esp.ultimoAlarme < cada) return;
    esp.ultimoAlarme = Date.now();
    tocarAlarme(nivel);
    vibrar(nivel >= 2 ? [300, 120, 300, 120, 600] : [250, 120, 250]);
  }

  const RELOGIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/></svg>';
  function decorarLista() {
    const caixa = $('itens'); if (!caixa) return;
    const por = new Map(esp.itens.map((x) => [x.conversaId, x]));
    for (const b of caixa.querySelectorAll('.item[data-id]')) {
      const it = por.get(b.dataset.id);
      b.classList.toggle('esp-item', Boolean(it));
      b.classList.toggle('esp-item-1', Boolean(it && it.nivel < 2));
      let selo = b.querySelector('.esp-tempo');
      if (!it) { selo?.remove(); continue; }
      if (!selo) {
        selo = el('span', { class: 'esp-tempo', html: RELOGIO });
        selo.append(el('span'));
        (b.querySelector('.l1') || b).append(selo);
      }
      selo.dataset.desde = it.desde;
      selo.title = `Esperando resposta há ${tempoTxt(minutosDe(it))}`;
      selo.lastChild.textContent = tempoTxt(minutosDe(it));
    }
  }
  // Lista redesenhada pelo app: põe o destaque de volta na hora.
  const obs = new MutationObserver(() => { if (esp.itens.length) decorarLista(); });
  const ligarObs = () => { const c = $('itens'); if (c) obs.observe(c, { childList: true }); else setTimeout(ligarObs, 300); };
  ligarObs();

  // Relógio: tempo correndo na faixa e na lista, alarme repetido.
  setInterval(() => {
    if (!esp.itens.length) return;
    for (const r of document.querySelectorAll('.esp-relogio, .esp-tempo')) {
      const min = Math.max(0, Math.floor((Date.now() - esp.desvio - new Date(r.dataset.desde).getTime()) / 60000));
      const alvo = r.classList.contains('esp-tempo') ? r.lastChild : r;
      const t = tempoTxt(min); if (alvo.textContent !== t) alvo.textContent = t;
    }
    if (faixa && !faixa.hidden && silenciado() === false && $('esp-silenciar').getAttribute('aria-pressed') === 'true') desenharFaixa();
    talvezAlarme();
  }, 1000);
  setInterval(buscarEspera, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) buscarEspera(); });

  // ---------------------------------------------------------------- preferências (Mais › Notificações)
  async function salvar(campos) {
    try { prefs = await api('/api/notificacoes/preferencias', { method: 'PUT', body: JSON.stringify(campos) }); dispatchEvent(new CustomEvent('sintonia:preferencias', { detail: prefs })); }
    catch (x) { toast(x.message); }
  }
  const chave = (checked, onchange, rotulo) => {
    const i = el('input', { type: 'checkbox', role: 'switch', 'aria-label': rotulo });
    i.checked = checked; i.addEventListener('change', () => onchange(i.checked));
    return el('label', { class: 'nt-chave' }, i, el('i'));
  };
  const linha = (titulo, sub, controle) => el('div', { class: 'nt-linha' }, el('span', {}, titulo, sub ? el('small', { text: sub }) : null), controle);
  const volume = (valor, rotulo, aoMudar) => {
    const r = el('input', { type: 'range', min: '0', max: '100', step: '5', value: String(valor), 'aria-label': rotulo });
    r.addEventListener('change', () => aoMudar(Number(r.value)));
    return r;
  };

  /** Seções extras do diálogo de preferências (chamado por /telas/notificacoes.js). */
  async function secoesPreferencias(p) {
    prefs = p;
    const m = p.mensagens, e = p.espera;
    const tipo = el('select', { 'aria-label': 'Tipo de som da mensagem' }, ...Object.entries(SONS).map(([k, s]) => el('option', { value: k, text: s.nome })));
    tipo.value = m.tipoSom;
    tipo.addEventListener('change', () => { salvar({ mensagens: { tipoSom: tipo.value } }); prep(); setTimeout(() => tocarMensagem(tipo.value), 30); });
    const secMsg = el('div', { class: 'nt-secao', id: 'nt-sec-mensagens' }, el('h3', { text: 'Cada mensagem' }),
      linha('Avisar no celular a cada mensagem', 'O celular toca de novo a cada mensagem nova (na mesma notificação da conversa).', chave(m.push, (v) => salvar({ mensagens: { push: v } }), 'Push a cada mensagem')),
      linha('Som de mensagem no app', 'Com o app aberto, a cada mensagem nova em qualquer conversa sua.', chave(m.som, (v) => { salvar({ mensagens: { som: v } }); if (v) tocarMensagem(); }, 'Som de mensagem')),
      linha('Vibrar o celular', navigator.vibrate ? 'Junto com o som.' : 'Este aparelho não vibra pelo navegador.', chave(m.vibrar, (v) => { salvar({ mensagens: { vibrar: v } }); if (v) vibrar([120, 60, 120]); }, 'Vibrar')),
      linha('Tipo de som', '', tipo),
      linha('Volume', '', volume(m.volume, 'Volume do som de mensagem', (v) => { salvar({ mensagens: { volume: v } }); prep(); setTimeout(() => tocarMensagem(undefined, v), 30); })),
      el('div', { class: 'nt-acoes' }, el('button', { class: 'nt-botao', text: 'Testar som de mensagem', onclick: () => { prep(); setTimeout(() => { tocarMensagem(tipo.value); vibrar([120, 60, 120]); }, 30); } })));

    const secEsp = el('div', { class: 'nt-secao', id: 'nt-sec-espera' }, el('h3', { text: 'Cliente esperando' }),
      linha('Avisar no celular', 'Quando uma cliente passa do limite sem resposta.', chave(e.push, (v) => salvar({ espera: { push: v } }), 'Push de cliente esperando')),
      linha('Alarme repetido no app', 'Toca de novo até alguém responder ou você silenciar.', chave(e.alarme, (v) => salvar({ espera: { alarme: v } }), 'Alarme repetido')),
      linha('Volume do alarme', '', volume(e.volume, 'Volume do alarme', (v) => { salvar({ espera: { volume: v } }); prep(); setTimeout(() => tocarAlarme(1, v), 30); })),
      el('div', { class: 'nt-acoes' }, el('button', { class: 'nt-botao', text: 'Testar alarme', onclick: () => { prep(); setTimeout(() => { tocarAlarme(2); vibrar([300, 120, 300]); }, 30); } })));

    // Limites por unidade (a gestão muda; as demais pessoas veem).
    const regras = await api('/api/espera/regras').catch(() => null);
    if (regras && regras.unidades.length) {
      const caixa = el('div', {});
      for (const un of regras.unidades) {
        const r = un.regra;
        const num = (valor, rotulo, min, max) => el('input', { type: 'number', min: String(min), max: String(max), value: String(valor), 'aria-label': rotulo, disabled: regras.podeEditar ? undefined : '' });
        const aviso = num(r.avisoMin, `Aviso em minutos, ${un.nome}`, 1, 240);
        const forte = num(r.forteMin, `Alerta forte em minutos, ${un.nome}`, 2, 480);
        const repetir = num(r.repetirSeg, `Repetir alarme a cada segundos, ${un.nome}`, 15, 600);
        const abre = el('input', { type: 'time', value: r.abre || '', 'aria-label': `Abre, ${un.nome}`, disabled: regras.podeEditar ? undefined : '' });
        const fecha = el('input', { type: 'time', value: r.fecha || '', 'aria-label': `Fecha, ${un.nome}`, disabled: regras.podeEditar ? undefined : '' });
        const ligado = el('input', { type: 'checkbox', role: 'switch', 'aria-label': `Alertas de espera, ${un.nome}`, disabled: regras.podeEditar ? undefined : '' }); ligado.checked = r.ligado;
        const soHorario = el('input', { type: 'checkbox', 'aria-label': `Só com a loja aberta, ${un.nome}`, disabled: regras.podeEditar ? undefined : '' }); soHorario.checked = r.soNoHorario;
        const gravar = async () => {
          const corpo = { ligado: ligado.checked, avisoMin: Number(aviso.value), forteMin: Number(forte.value), repetirSeg: Number(repetir.value), soNoHorario: soHorario.checked, abre: abre.value || null, fecha: fecha.value || null };
          if ((corpo.abre && !corpo.fecha) || (!corpo.abre && corpo.fecha)) return;
          try { await api(`/api/espera/regras/${un.id}`, { method: 'PUT', body: JSON.stringify(corpo) }); toast(`Alertas de ${un.nome} salvos.`); agendarEspera(300); }
          catch (x) { toast(x.message); }
        };
        for (const i of [aviso, forte, repetir, abre, fecha, ligado, soHorario]) i.addEventListener('change', gravar);
        caixa.append(el('div', { class: 'esp-regra' },
          el('div', { class: 'nt-linha' }, el('span', {}, el('b', { text: un.nome })), el('label', { class: 'nt-chave' }, ligado, el('i'))),
          el('div', { class: 'esp-campos' },
            el('label', {}, 'Aviso em', aviso, 'min'),
            el('label', {}, 'Alerta forte em', forte, 'min'),
            el('label', {}, 'Repetir alarme a cada', repetir, 's')),
          el('div', { class: 'esp-campos' },
            el('label', {}, soHorario, 'Só com a loja aberta'),
            el('label', {}, 'das', abre), el('label', {}, 'às', fecha)),
          el('small', { class: 'nt-dica', text: 'Horário vazio = o horário cadastrado da unidade. Sem alerta quando a IA atende sozinha ou um bot/follow-up conduz a conversa.' })));
      }
      secEsp.append(el('h3', { text: regras.podeEditar ? 'Limites por unidade (gestão)' : 'Limites da sua unidade' }), caixa);
    }
    return [secMsg, secEsp];
  }

  // ---------------------------------------------------------------- início
  (async () => {
    for (let i = 0; i < 50 && !ui.estado.eu; i++) await new Promise((r) => setTimeout(r, 100));
    await carregarPrefs();
    buscarEspera();
  })();

  window.SintoniaTelas.alertas = { sons: SONS, tocarMensagem, tocarAlarme, secoesPreferencias, atualizar: buscarEspera, prefs: () => prefs };
})();
