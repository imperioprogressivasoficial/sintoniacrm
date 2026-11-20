/* Fluxos de mensagens (window.SintoniaFluxos), como o "fluxo" do WhatsApp Voice:
 * - editor: aba "Fluxos" da tela Respostas rápidas (passos de texto, áudio gravado ou arquivo, foto, vídeo e documento,
 *   cada um com espera antes e "digitando…/gravando áudio…"; arrastar ou setas para mudar a ordem);
 * - conversa: o fluxo aparece no "/" junto das respostas; escolhido, o SERVIDOR envia passo a passo
 *   e a faixa "Enviando fluxo 2 de 5 · Parar" mostra o andamento.
 * Texto que vem do servidor entra sempre por textContent. */
(() => {
  const SVG = {
    fluxo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M8.5 6h3a3 3 0 0 1 3 3v.5M8.5 18h3a3 3 0 0 0 3-3v-.5"/></svg>',
    texto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h8"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
    imagem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="9.5" r="1.8"/><path d="m4 18 5.5-5.5L13 16l3-3 4 4"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/></svg>',
    documento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg>',
    cima: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 6-6 6 6"/></svg>',
    baixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 10 6 6 6-6"/></svg>',
    lixo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>',
    alca: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    parar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  };
  const TIPOS = [
    ['texto', 'Texto'], ['audio', 'Áudio'], ['imagem', 'Foto'], ['video', 'Vídeo'], ['documento', 'Documento'],
  ];
  const NOME_TIPO = Object.fromEntries(TIPOS);
  const ACEITA = { audio: 'audio/*', imagem: 'image/*', video: 'video/*', documento: '' };
  const PRESENCA = [['nenhuma', 'Sem aviso'], ['digitando', 'Mostrar "digitando…"'], ['gravando', 'Mostrar "gravando áudio…"']];
  let LIMITE_MB = 16;

  const CSS = `
  .fx-abas { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .fx-abas button { all: unset; cursor: pointer; padding: 0 18px; min-height: 36px; display: inline-flex; align-items: center; gap: 8px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); }
  .fx-abas button svg { width: 18px; height: 18px; }
  .fx-abas button[aria-selected="true"] { background: var(--marca-gradiente); color: #fff; box-shadow: 0 4px 14px rgba(16,110,190,.28); }
  .fx-abas button:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .fx-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
  @media (min-width: 1100px) { .fx-grade { grid-template-columns: minmax(0, 1fr) minmax(420px, 1.25fr); } }
  .fx-lista { display: grid; gap: 8px; }
  .fx-item { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 40px 1fr auto; gap: 2px 12px; align-items: center; padding: 12px 14px; border-radius: 16px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .fx-item[aria-current="true"] { box-shadow: inset 0 0 0 2px var(--marca-azul); }
  .fx-item:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .fx-item i { grid-row: span 2; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; background: var(--marca-gradiente); color: #fff; }
  .fx-item i svg { width: 20px; height: 20px; }
  .fx-item b { font-weight: 600; color: var(--marca-azul); font-size: 14.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  html[data-tema="escuro"] .fx-item b { color: #7cc0ff; }
  .fx-item small { color: var(--sub); font-size: 12.5px; grid-column: 2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-item .ds-pilula { grid-row: span 2; }
  .fx-form { display: grid; gap: 14px; align-content: start; }
  .fx-form h2 { margin: 0; font-size: 17px; }
  .fx-form label.fx-rot { display: grid; gap: 6px; font-size: 13px; color: var(--sub); }
  .fx-linha2 { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
  @media (min-width: 560px) { .fx-linha2 { grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); } }
  .fx-atalho { display: flex; align-items: center; gap: 2px; }
  .fx-atalho b { color: var(--marca-azul); font-size: 16px; padding-left: 4px; }
  .fx-passos { display: grid; gap: 0; }
  .fx-passo { position: relative; display: grid; gap: 10px; padding: 12px; border-radius: 16px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .fx-passo.arrastando { opacity: .45; }
  .fx-passo.alvo { box-shadow: inset 0 0 0 2px var(--marca-azul); }
  .fx-cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .fx-num { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 12.5px; font-weight: 700; color: #fff; background: var(--marca-gradiente); flex: none; }
  .fx-alca { cursor: grab; color: var(--sub); display: grid; place-items: center; width: 24px; height: 32px; flex: none; touch-action: none; }
  .fx-alca svg { width: 16px; height: 16px; }
  .fx-tipos { display: flex; gap: 4px; flex-wrap: wrap; order: 3; flex-basis: 100%; }
  .fx-tipos button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; min-height: 32px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--sub); }
  .fx-tipos button svg { width: 16px; height: 16px; }
  .fx-tipos button[aria-pressed="true"] { background: var(--sel); color: var(--texto); }
  .fx-tipos button:focus-visible, .fx-icone:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 1px; }
  .fx-acoes { margin-left: auto; display: flex; gap: 2px; }
  .fx-icone { all: unset; cursor: pointer; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: var(--icone); }
  .fx-icone:hover { background: var(--hover); }
  .fx-icone[disabled] { opacity: .3; cursor: default; background: none; }
  .fx-icone svg { width: 18px; height: 18px; }
  .fx-espera { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; color: var(--sub); }
  .fx-espera svg { width: 17px; height: 17px; flex: none; }
  .fx-espera input { width: 70px; }
  .fx-espera .ds-campo { height: 36px; min-height: 36px; }
  .fx-espera select.ds-campo { width: auto; }
  .fx-arquivo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 12px; border: 1px dashed var(--linha); }
  .fx-arquivo span { font-size: 13.5px; color: var(--sub); min-width: 0; overflow-wrap: anywhere; }
  .fx-arquivo audio { width: min(100%, 300px); height: 36px; }
  .fx-arquivo img, .fx-arquivo video { max-width: 120px; max-height: 90px; border-radius: 10px; object-fit: cover; }
  .fx-arquivo .botao { min-height: 36px; padding: 0 14px; font-size: 13.5px; }
  .fx-gravando { color: var(--erro, #c43a3a); font-weight: 600; }
  .fx-ligacao { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 0; color: var(--sub); font-size: 12px; }
  .fx-ligacao::before { content: ""; width: 2px; height: 14px; border-radius: 2px; background: linear-gradient(#0ffcbe, #3aa0ff); opacity: .8; }
  .fx-add { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
  .fx-add button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; min-height: 36px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--marca-azul); background: var(--sel); }
  html[data-tema="escuro"] .fx-add button { color: #cfe6ff; }
  .fx-add button svg { width: 16px; height: 16px; }
  .fx-dica { font-size: 12.5px; color: var(--sub); margin: 0; }
  .fx-check { display: flex; gap: 8px; align-items: center; font-size: 14px; }
  /* faixa na conversa */
  .fx-faixa { display: flex; align-items: center; gap: 10px; padding: 8px 12px; font-size: 13.5px; border-bottom: 1px solid var(--vidro-borda, var(--linha)); background: color-mix(in srgb, var(--marca-azul) 10%, var(--vidro-fundo, transparent)); position: relative; }
  .fx-faixa[hidden] { display: none; }
  .fx-faixa::after { content: ""; position: absolute; left: 0; bottom: -1px; height: 1.5px; width: var(--fx-prog, 0%); background: linear-gradient(90deg, #0ffcbe, #3aa0ff); transition: width .4s ease; }
  .fx-faixa > i { width: 28px; height: 28px; border-radius: 9px; display: grid; place-items: center; flex: none; background: var(--marca-gradiente); color: #fff; }
  .fx-faixa > i svg { width: 16px; height: 16px; }
  .fx-faixa .fx-txt { min-width: 0; flex: 1; display: grid; }
  .fx-faixa .fx-txt b { font-weight: 600; color: var(--texto); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-faixa .fx-txt small { color: var(--sub); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-faixa.fim > i { background: var(--sel); color: var(--icone); }
  .fx-faixa button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; min-height: 34px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--texto); background: var(--vidro-ativo, var(--painel)); box-shadow: inset 0 0 0 1px var(--linha); flex: none; }
  .fx-faixa button svg { width: 15px; height: 15px; }
  .fx-faixa button:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .rr-item.fx-op b::before { content: ""; }
  .rr-item.fx-op small { color: var(--marca-azul); font-weight: 600; }
  html[data-tema="escuro"] .rr-item.fx-op small { color: #7cc0ff; }
  `;
  function estilo() {
    if (document.getElementById('estilo-fluxos-msg')) return;
    const st = document.createElement('style'); st.id = 'estilo-fluxos-msg'; st.textContent = CSS; document.head.append(st);
  }

  const ui = () => window.Sintonia?.ui;
  const fmtEspera = (s) => !s ? 'na hora' : s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
  const totalSeg = (f) => f.passos.reduce((t, p) => t + (p.esperaSeg || 0), 0);
  const resumoFluxo = (f) => `${f.passos.length} ${f.passos.length === 1 ? 'passo' : 'passos'}${totalSeg(f) ? ' · leva ' + fmtEspera(totalSeg(f)) : ''}`;

  // ------------------------------------------------------------ dados (cache para o "/" da conversa)
  let cache = null, cacheEm = 0;
  async function carregar(forcar) {
    if (!forcar && cache && Date.now() - cacheEm < 60000) return cache;
    try { const r = await ui().api('/api/fluxos-mensagens'); cache = r.fluxos; LIMITE_MB = r.limites?.arquivoMb || LIMITE_MB; cacheEm = Date.now(); } catch { cache = cache || []; }
    return cache;
  }
  // Carrega em segundo plano para o "/" já ter os fluxos.
  setTimeout(() => { if (ui()) carregar(); }, 1500);

  // ------------------------------------------------------------ editor (aba "Fluxos")
  const s = { caixa: null, lista: [], editando: null, passos: [], erro: '', busca: '' };
  let chave = 0;
  const novoPasso = (tipo = 'texto') => ({ k: ++chave, tipo, texto: '', esperaSeg: s.passos.length ? 3 : 0, presenca: tipo === 'audio' ? 'gravando' : 'digitando' });

  async function carregarLista() {
    try { s.lista = await carregar(true); s.erro = ''; } catch (x) { s.erro = x.message; }
  }

  function abrirFluxo(f) {
    s.editando = f;
    s.passos = f ? f.passos.map((p) => ({ ...p, k: ++chave })) : [novoPasso('texto')];
    desenharEditor();
    s.caixa.querySelector('input[name="fx-nome"]')?.focus();
  }

  function listaEl() {
    const u = ui(), el = u.el;
    const q = s.busca.trim().toLowerCase();
    const itens = s.lista.filter((f) => !q || f.atalho.includes(q) || f.nome.toLowerCase().includes(q));
    if (s.erro) return el('div', { class: 'ds-card ds-vazio', text: s.erro });
    if (!itens.length) return el('div', { class: 'ds-card ds-vazio', text: s.lista.length ? 'Nenhum fluxo com essa busca.' : 'Nenhum fluxo ainda. Monte o primeiro ao lado: uma sequência de mensagens, áudios e fotos que sai sozinha, com tempo entre elas.' });
    return el('div', { class: 'fx-lista' }, ...itens.map((f) => el('button', {
      type: 'button', class: 'fx-item', 'aria-current': String(s.editando?.id === f.id),
      title: f.podeEditar ? 'Editar' : 'Só a gestão muda os fluxos da empresa',
      onclick: () => { if (!f.podeEditar) { u.toast('Só a gestão muda os fluxos da empresa.'); return; } abrirFluxo(f); },
    }, el('i', { html: SVG.fluxo }), el('b', { text: `/${f.atalho} · ${f.nome}` }), el('span', { class: 'ds-pilula', text: f.pessoal ? 'Meu' : 'Empresa' }), el('small', { text: resumoFluxo(f) }))));
  }

  /** Espera em número + unidade (segundos, minutos, horas). */
  function campoEspera(p) {
    const el = ui().el;
    const un = p.esperaSeg && p.esperaSeg % 3600 === 0 ? 3600 : p.esperaSeg && p.esperaSeg % 60 === 0 ? 60 : 1;
    const num = el('input', { class: 'ds-campo', type: 'number', min: '0', max: '86400', step: '1', inputmode: 'numeric', 'aria-label': 'Tempo de espera' });
    num.value = String(Math.round((p.esperaSeg || 0) / un));
    const sel = el('select', { class: 'ds-campo', 'aria-label': 'Unidade do tempo' }, ...[[1, 'segundos'], [60, 'minutos'], [3600, 'horas']].map(([v, t]) => el('option', { value: String(v), text: t })));
    sel.value = String(un);
    const atualizar = () => { p.esperaSeg = Math.min(86400, Math.max(0, Math.round(Number(num.value || 0) * Number(sel.value)))); };
    num.addEventListener('input', atualizar); sel.addEventListener('change', atualizar);
    const pres = el('select', { class: 'ds-campo', 'aria-label': 'Aviso para a cliente antes' }, ...PRESENCA.map(([v, t]) => el('option', { value: v, text: t })));
    pres.value = p.presenca || 'nenhuma';
    pres.addEventListener('change', () => { p.presenca = pres.value; });
    return el('div', { class: 'fx-espera', html: SVG.relogio }, document.createTextNode('Esperar'), num, sel, document.createTextNode('e'), pres);
  }

  async function enviarArquivo(p, arquivo, aviso) {
    const u = ui();
    if (arquivo.size > LIMITE_MB * 1024 * 1024) { aviso(`Arquivo grande demais: o limite é ${LIMITE_MB} MB.`); return false; }
    aviso('Enviando arquivo…');
    const base64 = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = falha; r.readAsDataURL(arquivo); });
    try {
      const m = await u.post('/api/fluxos-mensagens/midias', { base64, mimetype: arquivo.type || 'application/octet-stream', nomeArquivo: arquivo.name || undefined });
      p.midiaId = m.id; p.midiaNome = arquivo.name || m.nome || undefined; p._mimetype = m.mimetype; p._tamanho = m.tamanho;
      return true;
    } catch (x) { aviso(x.message); return false; }
  }

  const gravacao = { rec: null, stream: null, passo: null, inicio: 0 };
  const tipoGravacao = () => { for (const t of ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']) if (window.MediaRecorder?.isTypeSupported?.(t)) return t; return ''; };
  async function gravar(p, redesenhar) {
    const u = ui();
    if (gravacao.rec) { gravacao.rec.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { u.toast('Este navegador não grava áudio. Escolha um arquivo.'); return; }
    try { gravacao.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { u.toast('Sem acesso ao microfone. Libere nas permissões do navegador.'); return; }
    const tipo = tipoGravacao();
    const pedacos = [];
    gravacao.rec = new MediaRecorder(gravacao.stream, tipo ? { mimeType: tipo } : undefined);
    gravacao.passo = p; gravacao.inicio = Date.now();
    gravacao.rec.ondataavailable = (e) => { if (e.data.size) pedacos.push(e.data); };
    gravacao.rec.onstop = async () => {
      const mimetype = (gravacao.rec.mimeType || 'audio/webm').split(';')[0];
      gravacao.stream.getTracks().forEach((t) => t.stop());
      const dur = Math.round((Date.now() - gravacao.inicio) / 1000);
      gravacao.rec = null; gravacao.passo = null;
      const ext = mimetype.includes('ogg') ? 'ogg' : mimetype.includes('mp4') ? 'm4a' : 'webm';
      const arq = new File(pedacos, `audio-gravado.${ext}`, { type: mimetype });
      if (await enviarArquivo(p, arq, (t) => u.toast(t))) { p.duracaoSeg = dur; p._local = URL.createObjectURL(arq); }
      redesenhar();
    };
    gravacao.rec.start();
    redesenhar();
  }

  function conteudoPasso(p, redesenhar) {
    const u = ui(), el = u.el;
    if (p.tipo === 'texto') {
      const t = el('textarea', { class: 'ds-campo', rows: '3', maxlength: '3000', placeholder: 'Oi {nome}! Tudo bem?', 'aria-label': 'Texto do passo', style: 'height:auto;padding:10px 12px;resize:vertical' });
      t.value = p.texto || ''; t.addEventListener('input', () => { p.texto = t.value; });
      return t;
    }
    const aviso = el('span');
    const nomeArq = p.midiaNome || (p.midiaId ? 'Arquivo enviado' : '');
    aviso.textContent = p.midiaId ? nomeArq + (p.duracaoSeg ? ` · ${p.duracaoSeg} s` : '') : `Nenhum arquivo ainda (até ${LIMITE_MB} MB).`;
    const entrada = el('input', { type: 'file', hidden: '', accept: ACEITA[p.tipo] || '' });
    entrada.addEventListener('change', async () => { const a = entrada.files?.[0]; if (!a) return; if (await enviarArquivo(p, a, (t) => { aviso.textContent = t; })) { p._local = URL.createObjectURL(a); p.duracaoSeg = undefined; redesenhar(); } });
    const src = p._local || (p.midiaId ? '/api/fluxos-mensagens/midias/' + p.midiaId : '');
    let previa = null;
    if (src && p.tipo === 'audio') previa = el('audio', { controls: '', preload: 'none', src });
    if (src && p.tipo === 'imagem') previa = el('img', { src, alt: '' });
    if (src && p.tipo === 'video') previa = el('video', { src, preload: 'metadata', muted: '' });
    const gravandoEste = gravacao.passo === p;
    const caixa = el('div', { class: 'fx-arquivo' }, previa, aviso,
      p.tipo === 'audio' ? el('button', { type: 'button', class: 'botao' + (gravandoEste ? '' : ' leve'), html: gravandoEste ? SVG.parar : SVG.audio, onclick: () => gravar(p, redesenhar) }, document.createTextNode(gravandoEste ? ' Parar gravação' : ' Gravar')) : null,
      el('button', { type: 'button', class: 'botao leve', text: p.midiaId ? 'Trocar arquivo' : 'Escolher arquivo', onclick: () => entrada.click() }), entrada);
    if (gravandoEste) aviso.replaceChildren(el('b', { class: 'fx-gravando', text: 'Gravando… fale agora' }));
    if (p.tipo === 'audio') return caixa;
    const leg = el('textarea', { class: 'ds-campo', rows: '2', maxlength: '3000', placeholder: 'Legenda (opcional)', 'aria-label': 'Legenda', style: 'height:auto;padding:10px 12px;resize:vertical' });
    leg.value = p.texto || ''; leg.addEventListener('input', () => { p.texto = leg.value; });
    return el('div', { style: 'display:grid;gap:8px' }, caixa, leg);
  }

  function passosEl() {
    const u = ui(), el = u.el;
    const caixa = el('div', { class: 'fx-passos' });
    const redesenhar = () => caixa.replaceWith(passosEl());
    let arrastado = null;
    s.passos.forEach((p, i) => {
      if (i > 0) caixa.append(el('div', { class: 'fx-ligacao', text: p.esperaSeg ? `espera ${fmtEspera(p.esperaSeg)}` : 'logo em seguida' }));
      const mover = (d) => { const j = i + d; if (j < 0 || j >= s.passos.length) return; [s.passos[i], s.passos[j]] = [s.passos[j], s.passos[i]]; redesenhar(); };
      const tipos = el('div', { class: 'fx-tipos', role: 'group', 'aria-label': 'Tipo do passo' }, ...TIPOS.map(([v, t]) => el('button', {
        type: 'button', 'aria-pressed': String(p.tipo === v), html: SVG[v],
        onclick: () => { if (p.tipo === v) return; if (p.tipo !== 'texto' && v !== 'texto' && p.tipo !== v) { p.midiaId = undefined; p.midiaNome = undefined; p._local = undefined; } p.tipo = v; if (v === 'audio' && p.presenca === 'digitando') p.presenca = 'gravando'; if (v !== 'audio' && p.presenca === 'gravando') p.presenca = 'digitando'; redesenhar(); },
      }, document.createTextNode(t))));
      const alca = el('span', { class: 'fx-alca', html: SVG.alca, title: 'Arraste para mudar a ordem', 'aria-hidden': 'true' });
      const cartao = el('div', { class: 'fx-passo', 'data-i': String(i) },
        el('div', { class: 'fx-cab' }, alca, el('span', { class: 'fx-num', text: String(i + 1) }), el('b', { text: `Passo ${i + 1}`, style: 'font-size:13.5px;font-weight:600' }), tipos,
          el('div', { class: 'fx-acoes' },
            el('button', { type: 'button', class: 'fx-icone', html: SVG.cima, 'aria-label': `Subir passo ${i + 1}`, disabled: i === 0 ? '' : null, onclick: () => mover(-1) }),
            el('button', { type: 'button', class: 'fx-icone', html: SVG.baixo, 'aria-label': `Descer passo ${i + 1}`, disabled: i === s.passos.length - 1 ? '' : null, onclick: () => mover(1) }),
            el('button', { type: 'button', class: 'fx-icone', html: SVG.lixo, 'aria-label': `Tirar passo ${i + 1}`, onclick: () => { s.passos.splice(i, 1); redesenhar(); } }))),
        campoEspera(p),
        conteudoPasso(p, redesenhar));
      // Arrastar pela alça (computador). No celular, as setas.
      alca.addEventListener('mousedown', () => { cartao.draggable = true; });
      cartao.addEventListener('dragstart', (e) => { arrastado = i; cartao.classList.add('arrastando'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      cartao.addEventListener('dragend', () => { cartao.draggable = false; cartao.classList.remove('arrastando'); caixa.querySelectorAll('.alvo').forEach((x) => x.classList.remove('alvo')); });
      cartao.addEventListener('dragover', (e) => { if (arrastado === null) return; e.preventDefault(); cartao.classList.add('alvo'); });
      cartao.addEventListener('dragleave', () => cartao.classList.remove('alvo'));
      cartao.addEventListener('drop', (e) => {
        e.preventDefault(); if (arrastado === null || arrastado === i) return;
        const [x] = s.passos.splice(arrastado, 1); s.passos.splice(i, 0, x); arrastado = null; redesenhar();
      });
      caixa.append(cartao);
    });
    const add = el('div', { class: 'fx-add' }, ...TIPOS.map(([v, t]) => el('button', { type: 'button', html: SVG.mais, onclick: () => {
      if (s.passos.length >= 20) { u.toast('Até 20 passos por fluxo.'); return; }
      s.passos.push(novoPasso(v)); redesenhar();
    } }, document.createTextNode(t))));
    caixa.append(add);
    return caixa;
  }

  function formularioEl() {
    const u = ui(), el = u.el;
    const f = s.editando;
    const gestor = u.ehGestor(u.estado.eu || {});
    const nome = el('input', { class: 'ds-campo', name: 'fx-nome', maxlength: '80', placeholder: 'Boas-vindas', required: '' });
    const atalho = el('input', { class: 'ds-campo', name: 'fx-atalho', maxlength: '30', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'boas-vindas', required: '' });
    nome.value = f?.nome || ''; atalho.value = f?.atalho || '';
    nome.addEventListener('input', () => { if (!f && !atalho.dataset.mexeu) atalho.value = nome.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30); });
    atalho.addEventListener('input', () => { atalho.dataset.mexeu = '1'; });
    const resp = el('select', { class: 'ds-campo', name: 'fx-resp' }, el('option', { value: 'parar', text: 'Parar o fluxo (não envia o resto)' }), el('option', { value: 'continuar', text: 'Continuar enviando' }));
    resp.value = f?.seClienteResponder || 'parar';
    const pessoal = el('input', { type: 'checkbox' });
    const erro = el('div', { class: 'erro-txt', role: 'alert' });
    const salvar = el('button', { class: 'botao', type: 'submit', text: f ? 'Salvar fluxo' : 'Criar fluxo' });
    const form = el('form', { class: 'ds-card fx-form' },
      el('h2', { text: f ? `Editar /${f.atalho}` : 'Novo fluxo' }),
      el('div', { class: 'fx-linha2' },
        el('label', { class: 'fx-rot' }, 'Nome', nome),
        el('label', { class: 'fx-rot' }, 'Atalho (digite / na conversa)', el('div', { class: 'fx-atalho ds-campo' }, el('b', { text: '/' }), Object.assign(atalho, { style: 'border:0;background:transparent;padding:0;height:auto;min-height:0;flex:1;min-width:0;box-shadow:none' })))),
      el('div', { class: 'fx-rot', style: 'display:grid;gap:6px;font-size:13px;color:var(--sub)' }, 'Passos', passosEl()),
      el('p', { class: 'fx-dica', text: `Texto e legenda aceitam {nome}, {unidade} e {atendente}. Arquivos até ${LIMITE_MB} MB. O aviso "digitando…" aparece para a cliente no fim da espera.` }),
      el('label', { class: 'fx-rot' }, 'Se a cliente responder no meio', resp),
      !f && gestor ? el('label', { class: 'fx-check' }, pessoal, 'Só para mim (as outras pessoas não veem)') : null,
      !f && !gestor ? el('p', { class: 'fx-dica', text: 'Este fluxo fica só para você. Os da empresa são criados pela gestão.' }) : null,
      erro,
      el('div', { class: 'ds-cab-acoes' },
        f ? el('button', { class: 'botao leve', type: 'button', text: 'Apagar', onclick: async () => {
          if (!confirm(`Apagar o fluxo /${f.atalho}?`)) return;
          try { await u.api('/api/fluxos-mensagens/' + f.id, { method: 'DELETE' }); s.editando = null; s.passos = [novoPasso()]; await carregarLista(); desenharEditor(); u.toast('Fluxo apagado'); } catch (x) { erro.textContent = x.message; }
        } }) : null,
        f ? el('button', { class: 'botao leve', type: 'button', text: 'Cancelar', onclick: () => abrirFluxo(null) }) : null,
        salvar));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.textContent = '';
      if (gravacao.rec) { erro.textContent = 'Termine a gravação do áudio antes de salvar.'; return; }
      const passos = s.passos.map((p) => ({ id: p.id, tipo: p.tipo, texto: p.tipo === 'audio' ? '' : (p.texto || ''), midiaId: p.tipo === 'texto' ? undefined : p.midiaId, midiaNome: p.tipo === 'texto' ? undefined : p.midiaNome, duracaoSeg: p.tipo === 'audio' ? p.duracaoSeg : undefined, esperaSeg: p.esperaSeg || 0, presenca: p.presenca || 'nenhuma' }));
      const faltaArq = passos.findIndex((p) => p.tipo !== 'texto' && !p.midiaId);
      if (faltaArq >= 0) { erro.textContent = `Falta o arquivo do passo ${faltaArq + 1}.`; return; }
      const vazio = passos.findIndex((p) => p.tipo === 'texto' && !p.texto.trim());
      if (vazio >= 0) { erro.textContent = `O passo ${vazio + 1} está sem texto.`; return; }
      salvar.disabled = true;
      const corpo = { nome: nome.value, atalho: atalho.value, passos, seClienteResponder: resp.value };
      try {
        const r = f ? await u.api('/api/fluxos-mensagens/' + f.id, { method: 'PATCH', body: JSON.stringify(corpo) }) : await u.post('/api/fluxos-mensagens', { ...corpo, ...(gestor ? { pessoal: pessoal.checked } : {}) });
        u.toast(f ? 'Fluxo salvo ✓' : 'Fluxo criado ✓ Use na conversa digitando /' + r.atalho);
        await carregarLista(); abrirFluxo(s.lista.find((x) => x.id === r.id) || null);
      } catch (x) { erro.textContent = x.message; salvar.disabled = false; }
    });
    return form;
  }

  function desenharEditor() {
    const u = ui(), el = u.el;
    if (!s.caixa) return;
    const busca = el('input', { type: 'search', placeholder: 'Buscar fluxo', 'aria-label': 'Buscar fluxo' });
    busca.value = s.busca;
    const caixaLista = el('div');
    busca.addEventListener('input', () => { s.busca = busca.value; caixaLista.replaceChildren(listaEl()); });
    caixaLista.append(listaEl());
    s.caixa.replaceChildren(
      el('div', { class: 'ds-filtros' }, el('label', { class: 'ds-campo ds-busca', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }, busca)),
      el('div', { class: 'fx-grade' }, caixaLista, formularioEl()));
  }

  /** Desenha o editor de fluxos dentro de `caixa` (aba "Fluxos" da tela Respostas rápidas). */
  async function editor(caixa) {
    estilo();
    s.caixa = caixa;
    if (!s.passos.length) s.passos = [novoPasso('texto')];
    await carregarLista();
    desenharEditor();
  }

  /** Abas "Respostas | Fluxos" (a tela Respostas rápidas põe no cabeçalho). */
  function abas(atual, trocar) {
    estilo();
    const el = ui().el;
    return el('div', { class: 'fx-abas', role: 'tablist', 'aria-label': 'Respostas ou fluxos' },
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(atual === 'respostas'), html: SVG.texto, onclick: () => trocar('respostas') }, document.createTextNode('Respostas')),
      el('button', { type: 'button', role: 'tab', 'aria-selected': String(atual === 'fluxos'), html: SVG.fluxo, onclick: () => trocar('fluxos') }, document.createTextNode('Fluxos')));
  }

  // ------------------------------------------------------------ na conversa: disparar e faixa de andamento
  const faixaEstado = { conversa: null, envio: null, timer: null, buscadoEm: 0, fimMostradoAte: 0 };

  async function iniciar(conversaId, fluxo) {
    const u = ui();
    try {
      const e = await u.post(`/api/conversas/${conversaId}/fluxos`, { fluxoId: fluxo.id });
      faixaEstado.conversa = conversaId; faixaEstado.envio = e; desenharFaixa();
      u.toast(`Fluxo "${fluxo.nome}" começou`);
      agendarFaixa();
    } catch (x) { u.toast(x.message); }
  }

  function desenharFaixa() {
    const u = ui(); const caixa = document.getElementById('fx-faixa');
    if (!u || !caixa) return;
    const e = faixaEstado.envio;
    const agora = Date.now();
    const andando = e && e.situacao === 'andando';
    const fimRecente = e && !andando && agora - new Date(e.atualizadoEm).getTime() < 20000;
    if (!e || (!andando && !fimRecente)) { caixa.hidden = true; caixa.replaceChildren(); return; }
    estilo();
    caixa.className = 'fx-faixa' + (andando ? '' : ' fim');
    caixa.hidden = false;
    const el = u.el;
    const prog = Math.round((e.enviados / Math.max(1, e.total)) * 100);
    caixa.style.setProperty('--fx-prog', prog + '%');
    let titulo, sub;
    if (andando) {
      titulo = `Enviando fluxo ${e.passoAtual} de ${e.total}`;
      const falta = Math.max(0, Math.round((new Date(e.proximoEm).getTime() - agora) / 1000));
      const oque = NOME_TIPO[e.tipoProximo] ? NOME_TIPO[e.tipoProximo].toLowerCase() : 'mensagem';
      sub = e.mostrando === 'digitando' ? `${e.nome} · ela vê "digitando…"` : e.mostrando === 'gravando' ? `${e.nome} · ela vê "gravando áudio…"` : falta > 1 ? `${e.nome} · próximo (${oque}) em ${fmtEspera(falta)}` : `${e.nome} · enviando ${oque}…`;
    } else if (e.situacao === 'concluido') { titulo = `Fluxo enviado ✓ (${e.total} de ${e.total})`; sub = e.nome; }
    else { titulo = e.situacao === 'erro' ? 'O fluxo parou por um erro' : `Fluxo parado (${e.enviados} de ${e.total} enviados)`; sub = e.motivo || e.nome; }
    caixa.replaceChildren(el('i', { html: SVG.fluxo }), el('div', { class: 'fx-txt', role: 'status' }, el('b', { text: titulo }), el('small', { text: sub })),
      andando ? el('button', { type: 'button', html: SVG.parar, 'aria-label': 'Parar o fluxo', onclick: parar }, document.createTextNode('Parar')) : null);
  }

  async function parar() {
    const u = ui(); const e = faixaEstado.envio; if (!e) return;
    try { const r = await u.post(`/api/conversas/${faixaEstado.conversa}/fluxos/${e.id}/parar`, {}); faixaEstado.envio = r.envio; desenharFaixa(); u.toast('Fluxo parado. O resto não será enviado.'); } catch (x) { u.toast(x.message); }
  }

  async function buscarFaixa() {
    const id = faixaEstado.conversa; if (!id) return;
    faixaEstado.buscadoEm = Date.now();
    try {
      const r = await ui().api(`/api/conversas/${id}/fluxos/andamento`);
      if (faixaEstado.conversa !== id) return;
      faixaEstado.envio = r.envio; desenharFaixa();
    } catch { /* a faixa some sozinha */ }
  }
  /** Enquanto um fluxo anda, atualiza a cada 2 s (e redesenha a contagem). Parado: nada roda. */
  function agendarFaixa() {
    clearTimeout(faixaEstado.timer);
    const e = faixaEstado.envio;
    if (!e) return;
    const andando = e.situacao === 'andando';
    const fimRecente = !andando && Date.now() - new Date(e.atualizadoEm).getTime() < 20000;
    if (!andando && !fimRecente) return;
    faixaEstado.timer = setTimeout(async () => { if (andando) await buscarFaixa(); else desenharFaixa(); agendarFaixa(); }, andando ? 2000 : 20500 - (Date.now() - new Date(e.atualizadoEm).getTime()));
  }
  /** Chamado pela tela de conversa a cada carga (app.html). Busca ao trocar de conversa e, sem fluxo andando, a cada 20 s. */
  async function faixa(conversaId) {
    if (!conversaId) return;
    const trocou = faixaEstado.conversa !== conversaId;
    if (trocou) { faixaEstado.conversa = conversaId; faixaEstado.envio = null; clearTimeout(faixaEstado.timer); desenharFaixa(); }
    if (!trocou && (faixaEstado.envio?.situacao === 'andando' || Date.now() - faixaEstado.buscadoEm < 20000)) return;
    await buscarFaixa();
    agendarFaixa();
  }

  window.SintoniaFluxos = { carregar, lista: () => cache || [], editor, abas, iniciar, faixa, resumo: resumoFluxo, SVG };
})();
