/* msg-agendada: mensagens agendadas (window.SintoniaAgendadas e window.SintoniaTelas.agendadas).
 * - Na caixa de texto da conversa: segurar o botão de enviar (celular), clicar com o botão direito nele ou na
 *   setinha ao lado (computador), ou "+" › "Agendar mensagem" abre "Agendar envio" (Hoje 18h, Amanhã 9h,
 *   Segunda 9h ou dia e hora escolhidos). O SERVIDOR envia na hora (src/agendadas), mesmo com o app fechado.
 * - Na conversa: as agendadas aparecem no fim como balões "Agendada para sex, 21/11 às 9:00";
 *   tocar = mudar, cancelar ou enviar agora.
 * - Atendimento › Mensagens agendadas: a lista geral (minhas/todas e situação).
 * Ganchos no app.html (blocos "msg-agendada"): noFim() no desenho da conversa, conversa() ao carregar, a vista
 * "agendadas" e os itens dos menus. Texto que vem do servidor entra sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const TZ = 'America/Bahia'; // horário da empresa (UTC-3 o ano todo, igual a Brasília)
  const ui = () => window.Sintonia?.ui;
  const $ = (id) => document.getElementById(id);
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const SVG = {
    relogio: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    seta: ic('<path d="m7 10 5 5 5-5"/>'),
    agendar: ic('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M9.5 3h5M19 6l1.5 1.5"/>'),
    enviar: ic('<path d="M4 12 20 4l-4 16-4-7-8-1Z"/><path d="m12 13 8-9"/>'),
    lixo: ic('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>'),
    clipe: ic('<path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/>'),
    fechar: ic('<path d="M6 6l12 12M18 6 6 18"/>'),
    alerta: ic('<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2h.01"/>'),
    calendario: ic('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  };
  const LIMITE_MB = 16;

  const CSS = `
  /* composição: setinha ao lado do enviar (computador) */
  #enviar { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  .ag-seta { all: unset; cursor: pointer; box-sizing: border-box; width: 26px; height: 44px; margin-left: -2px; border-radius: 10px; display: none; place-items: center; color: var(--sub); }
  .ag-seta svg { width: 18px; height: 18px; }
  .ag-seta:hover { background: var(--hover, rgba(0,0,0,.05)); color: var(--texto); }
  .ag-seta:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 1px; }
  @media (min-width: 761px) { .ag-seta.ver { display: grid; } }
  /* balões "Agendada para…" no fim da conversa */
  .ag-bloco { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; margin-top: 14px; }
  .ag-titulo { align-self: center; font-size: 12px; font-weight: 600; color: var(--sub); background: var(--data, var(--painel)); border-radius: 8px; padding: 4px 10px; box-shadow: var(--sombra); }
  .ag-bal { all: unset; box-sizing: border-box; cursor: pointer; position: relative; max-width: min(65%, 560px); padding: 6px 9px 7px; border-radius: 10px; font-size: 14.2px; line-height: 19px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--texto);
    background: color-mix(in srgb, var(--enviada) 55%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 35%, transparent); }
  .ag-bal:hover { background: color-mix(in srgb, var(--enviada) 75%, transparent); }
  .ag-bal:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .ag-bal .ag-quando { display: flex; align-items: center; gap: 5px; font-size: 12.3px; font-weight: 600; color: var(--marca-azul); line-height: 20px; white-space: normal; }
  html[data-tema="escuro"] .ag-bal .ag-quando { color: #7cc0ff; }
  .ag-bal .ag-quando svg { width: 15px; height: 15px; flex: none; }
  .ag-bal .ag-txt { opacity: .78; display: block; }
  .ag-bal .ag-arq { display: flex; align-items: center; gap: 6px; opacity: .78; font-size: 13.5px; }
  .ag-bal .ag-arq svg { width: 15px; height: 15px; flex: none; }
  .ag-bal .ag-rodape { display: block; text-align: right; font-size: 11px; color: var(--sub); margin-top: 2px; white-space: normal; }
  .ag-bal.falhou { box-shadow: inset 0 0 0 1.5px #e5484d; }
  .ag-bal.falhou .ag-quando { color: #d93036; }
  html[data-tema="escuro"] .ag-bal.falhou .ag-quando { color: #ff7b80; }
  @media (max-width: 760px) { .ag-bal { max-width: 85%; } }
  /* folha "Agendar envio" */
  dialog.ag-folha { border: 0; color: var(--texto); width: min(480px, 100vw); max-width: 100vw; box-sizing: border-box; margin: auto auto 0; border-radius: 22px 22px 0 0; padding: 14px 16px calc(18px + env(safe-area-inset-bottom)); background: var(--fundo); max-height: min(92vh, 92dvh); overflow-y: auto; overscroll-behavior: contain; }
  @media (min-width: 761px) { dialog.ag-folha { margin: auto; border-radius: 22px; padding: 20px 22px; } }
  dialog.ag-folha::backdrop { background: rgba(4,18,31,.45); }
  .ag-f { display: grid; gap: 14px; }
  .ag-f-topo { display: flex; align-items: center; gap: 10px; }
  .ag-f-topo h2 { margin: 0; font-size: 18px; flex: 1; display: flex; align-items: center; gap: 8px; }
  .ag-f-topo h2 i { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: var(--marca-gradiente); color: #fff; flex: none; }
  .ag-f-topo h2 i svg { width: 19px; height: 19px; }
  .ag-x { all: unset; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .ag-x:hover { background: var(--hover, rgba(0,0,0,.05)); }
  .ag-x svg { width: 20px; height: 20px; }
  .ag-f textarea { box-sizing: border-box; width: 100%; min-height: 96px; max-height: 40vh; resize: vertical; font: inherit; font-size: 15px; line-height: 1.4; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--linha); background: var(--painel); color: var(--texto); }
  .ag-f textarea:focus, .ag-f input:focus { outline: 2px solid var(--marca-azul); outline-offset: 0; border-color: transparent; }
  .ag-rot { font-size: 13px; font-weight: 600; color: var(--sub); margin: 0 0 -6px; }
  .ag-atalhos { display: flex; gap: 8px; flex-wrap: wrap; }
  .ag-atalho { all: unset; cursor: pointer; box-sizing: border-box; min-height: 40px; padding: 4px 14px; border-radius: 14px; display: grid; align-content: center; background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); font-size: 14px; font-weight: 600; text-align: left; }
  .ag-atalho small { display: block; font-size: 11.5px; font-weight: 500; color: var(--sub); }
  .ag-atalho[aria-pressed="true"] { background: var(--marca-gradiente); color: #fff; box-shadow: 0 4px 14px rgba(16,110,190,.28); }
  .ag-atalho[aria-pressed="true"] small { color: rgba(255,255,255,.85); }
  .ag-atalho:focus-visible, .ag-bt:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .ag-quando-campos { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 8px; }
  .ag-quando-campos input { box-sizing: border-box; width: 100%; height: 44px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--linha); background: var(--painel); color: var(--texto); font: inherit; font-size: 15px; color-scheme: light dark; }
  .ag-resumo { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--marca-azul) 9%, transparent); }
  .ag-resumo svg { width: 18px; height: 18px; flex: none; color: var(--marca-azul); }
  .ag-resumo.erro { background: rgba(229,72,77,.1); }
  .ag-resumo.erro svg { color: #e5484d; }
  .ag-arquivo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; color: var(--sub); }
  .ag-arquivo .ag-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 6px 6px 10px; border-radius: 999px; background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); color: var(--texto); max-width: 100%; }
  .ag-arquivo .ag-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
  .ag-arquivo svg { width: 16px; height: 16px; flex: none; }
  .ag-arquivo .ag-chip button { all: unset; cursor: pointer; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); }
  .ag-acoes { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: center; }
  .ag-acoes .ag-esq { margin-right: auto; display: flex; gap: 8px; flex-wrap: wrap; }
  .ag-bt { all: unset; cursor: pointer; box-sizing: border-box; min-height: 42px; padding: 0 16px; border-radius: 999px; display: inline-flex; align-items: center; gap: 7px; font-size: 14px; font-weight: 600; background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); color: var(--texto); white-space: nowrap; }
  .ag-bt svg { width: 17px; height: 17px; }
  .ag-bt.forte { background: var(--marca-gradiente); color: #fff; box-shadow: 0 6px 16px rgba(16,110,190,.28); }
  .ag-bt.perigo { color: #d93036; }
  html[data-tema="escuro"] .ag-bt.perigo { color: #ff7b80; }
  .ag-bt[disabled] { opacity: .5; cursor: default; }
  .ag-info { font-size: 13px; color: var(--sub); margin: 0; }
  .ag-erro-txt { font-size: 13.5px; margin: 0; padding: 10px 12px; border-radius: 12px; background: rgba(229,72,77,.1); }
  /* tela Atendimento › Mensagens agendadas */
  .ag-tela { width: 100%; min-width: 0; display: grid; gap: 16px; align-content: start; }
  .ag-tela-topo h1 { margin: 0; font-size: 28px; letter-spacing: -.01em; }
  .ag-tela-topo p { margin: 4px 0 0; color: var(--sub); font-size: 14.5px; }
  .ag-filtros { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .ag-seg { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .ag-seg button { all: unset; cursor: pointer; padding: 0 14px; min-height: 34px; display: inline-flex; align-items: center; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--sub); }
  .ag-seg button[aria-pressed="true"] { background: var(--marca-gradiente); color: #fff; }
  .ag-seg button:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .ag-sel { font: inherit; font-size: 13.5px; height: 42px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--vidro-borda, var(--linha)); background: var(--vidro-item, var(--painel)); color: var(--texto); }
  .ag-dia { font-size: 13px; font-weight: 700; color: var(--sub); text-transform: uppercase; letter-spacing: .05em; margin: 6px 2px -4px; }
  .ag-lista { display: grid; gap: 8px; }
  .ag-item { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 4px 14px; align-items: start; padding: 12px 14px; border-radius: 18px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); min-width: 0; }
  .ag-hora { grid-column: 1; grid-row: 1 / span 3; font-size: 18px; font-weight: 700; color: var(--marca-azul); line-height: 1.2; padding-top: 2px; }
  html[data-tema="escuro"] .ag-hora { color: #7cc0ff; }
  .ag-cli { all: unset; grid-column: 2; grid-row: 1; cursor: pointer; font-size: 15px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ag-cli:hover { text-decoration: underline; }
  .ag-cli:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; border-radius: 4px; }
  .ag-prev { grid-column: 2; font-size: 13.5px; color: var(--sub); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; white-space: pre-wrap; }
  .ag-meta { grid-column: 2; display: flex; gap: 6px 10px; flex-wrap: wrap; align-items: center; font-size: 12.5px; color: var(--sub); }
  .ag-pil { font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--vidro-borda, var(--linha)); color: var(--texto); }
  .ag-pil.agendada { background: color-mix(in srgb, var(--marca-azul) 14%, transparent); color: var(--marca-azul); }
  html[data-tema="escuro"] .ag-pil.agendada { color: #7cc0ff; }
  .ag-pil.enviada { background: color-mix(in srgb, var(--marca-menta) 22%, transparent); }
  .ag-pil.falhou { background: rgba(229,72,77,.14); color: #d93036; }
  html[data-tema="escuro"] .ag-pil.falhou { color: #ff7b80; }
  .ag-item-acoes { grid-row: 1 / span 3; grid-column: 3; display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .ag-item-acoes .ag-bt { min-height: 36px; padding: 0 12px; font-size: 13px; }
  @media (max-width: 760px) {
    .ag-tela-topo h1 { font-size: 24px; }
    .ag-item { grid-template-columns: 54px minmax(0, 1fr); }
    .ag-hora { grid-row: 1 / span 4; font-size: 16px; }
    .ag-cli { grid-row: 1; } .ag-prev { grid-row: 2; } .ag-meta { grid-row: 3; }
    .ag-item-acoes { grid-column: 2; grid-row: 4; justify-content: flex-start; margin-top: 4px; }
  }
  .ag-vazio { color: var(--sub); text-align: center; padding: 36px 12px; font-size: 14.5px; display: grid; gap: 8px; justify-items: center; }
  .ag-vazio svg { width: 34px; height: 34px; color: var(--marca-azul); opacity: .7; }
  `;
  let estiloPronto = false;
  function estilo() {
    if (estiloPronto) return;
    estiloPronto = true;
    document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  }

  // ------------------------------------------------------------ datas no horário da empresa
  const p2 = (n) => String(n).padStart(2, '0');
  const fmtPartes = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function partes(d) {
    const o = {};
    for (const p of fmtPartes.formatToParts(d)) o[p.type] = p.value;
    return { data: `${o.year}-${o.month}-${o.day}`, hora: `${o.hour === '24' ? '00' : o.hour}:${o.minute}`, h: Number(o.hour) % 24, m: Number(o.minute), dow: DOW[o.weekday] ?? 0 };
  }
  /** Dia + hora no horário da empresa → instante. */
  const instante = (data, hora) => new Date(`${data}T${hora.length === 4 ? '0' + hora : hora}:00-03:00`);
  function maisDias(data, n) {
    const [a, m, d] = data.split('-').map(Number);
    const x = new Date(Date.UTC(a, m - 1, d + n));
    return `${x.getUTCFullYear()}-${p2(x.getUTCMonth() + 1)}-${p2(x.getUTCDate())}`;
  }
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIAS_LONGOS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const horaCurta = (hhmm) => { const [h, m] = hhmm.split(':'); return `${Number(h)}:${m}`; };
  /** "hoje às 18:00", "amanhã às 9:00", "sex, 21/11 às 9:00". */
  function quandoTxt(d) {
    const p = partes(new Date(d)); const hoje = partes(new Date()).data;
    const [, mes, dia] = p.data.split('-');
    const h = horaCurta(p.hora);
    if (p.data === hoje) return `hoje às ${h}`;
    if (p.data === maisDias(hoje, 1)) return `amanhã às ${h}`;
    const ano = p.data.slice(0, 4) !== hoje.slice(0, 4) ? '/' + p.data.slice(0, 4) : '';
    return `${DIAS[p.dow]}, ${dia}/${mes}${ano} às ${h}`;
  }
  function diaTxt(d) {
    const p = partes(new Date(d)); const hoje = partes(new Date()).data;
    if (p.data === hoje) return 'Hoje';
    if (p.data === maisDias(hoje, 1)) return 'Amanhã';
    if (p.data === maisDias(hoje, -1)) return 'Ontem';
    const [a, mes, dia] = p.data.split('-');
    return `${DIAS_LONGOS[p.dow]}, ${dia}/${mes}${a !== hoje.slice(0, 4) ? '/' + a : ''}`;
  }
  /** Atalhos: Hoje 18h (se ainda dá), Amanhã 9h, Segunda 9h (se não for amanhã). */
  function atalhos() {
    const agora = partes(new Date());
    const lista = [];
    if (agora.h * 60 + agora.m < 17 * 60 + 55) lista.push({ nome: 'Hoje 18h', data: agora.data, hora: '18:00' });
    const amanha = maisDias(agora.data, 1);
    lista.push({ nome: 'Amanhã 9h', data: amanha, hora: '09:00' });
    const ate = ((1 - agora.dow + 7) % 7) || 7; // dias até a próxima segunda
    if (ate !== 1) lista.push({ nome: 'Segunda 9h', data: maisDias(agora.data, ate), hora: '09:00' });
    else lista.push({ nome: 'Terça 9h', data: maisDias(agora.data, 2), hora: '09:00' });
    return lista;
  }

  // ------------------------------------------------------------ dados
  const SIT = { agendada: 'Agendada', enviando: 'Enviando', enviada: 'Enviada', cancelada: 'Cancelada', falhou: 'Não enviada' };
  const cache = new Map(); // conversaId → { lista, em }
  let minhasPendentes = null;
  const PENDENTE = (m) => m.situacao === 'agendada' || m.situacao === 'enviando' || m.situacao === 'falhou';

  async function buscar(conversaId) {
    const r = await ui().api(`/api/conversas/${conversaId}/agendadas`);
    cache.set(conversaId, { lista: r.agendadas || [], em: Date.now() });
    return r.agendadas || [];
  }
  /** Chamado ao carregar a conversa (app.html): busca ao trocar de conversa, ao vencer um horário e a cada 30 s no máximo. */
  async function conversa(conversaId) {
    if (!conversaId || !ui()) return;
    const c = cache.get(conversaId);
    const venceu = c?.lista.some((m) => m.situacao !== 'falhou' && new Date(m.enviarEm).getTime() <= Date.now());
    if (c && !venceu && Date.now() - c.em < 30000) return;
    try { await buscar(conversaId); } catch { return; }
    if (ui().estado.aberta === conversaId) desenharBaloes();
  }

  // ------------------------------------------------------------ balões no fim da conversa
  function blocoBaloes(conversaId) {
    const u = ui(), el = u.el;
    const lista = (cache.get(conversaId)?.lista || []).filter(PENDENTE).sort((a, b) => new Date(a.enviarEm) - new Date(b.enviarEm));
    if (!lista.length) return null;
    estilo();
    const bloco = el('div', { class: 'ag-bloco', 'data-ag': '1' });
    bloco.append(el('div', { class: 'ag-titulo', text: lista.length === 1 ? 'Mensagem agendada' : `${lista.length} mensagens agendadas` }));
    for (const m of lista) {
      const falhou = m.situacao === 'falhou';
      const rot = falhou ? 'Não enviada · toque para ver' : m.situacao === 'enviando' ? 'Enviando agora…' : `Agendada para ${quandoTxt(m.enviarEm)}`;
      const b = el('button', { type: 'button', class: 'ag-bal' + (falhou ? ' falhou' : ''), 'aria-label': `${rot}. Toque para mudar, cancelar ou enviar agora.` });
      b.append(el('span', { class: 'ag-quando', html: falhou ? SVG.alerta : SVG.relogio }, document.createTextNode(rot)));
      if (m.anexo) b.append(el('span', { class: 'ag-arq', html: SVG.clipe }, document.createTextNode(m.anexo.nome || NOME_ANEXO[m.anexo.tipo] || 'Arquivo')));
      if (m.texto) b.append(el('span', { class: 'ag-txt', text: m.texto }));
      b.append(el('span', { class: 'ag-rodape', text: `agendada por ${primeiro(m.criadoPor)}` }));
      b.addEventListener('click', () => abrirFolha({ conversaId, item: m }));
      bloco.append(b);
    }
    return bloco;
  }
  const NOME_ANEXO = { imagem: 'Foto', video: 'Vídeo', audio: 'Áudio', documento: 'Documento' };
  const primeiro = (n) => String(n || '').trim().split(/\s+/)[0] || 'equipe';

  /** Gancho do desenho da conversa (app.html): põe os balões no fim, de forma síncrona (sem piscar). */
  function noFim(caixa, c) {
    if (!caixa || !c) return;
    caixa.querySelectorAll('[data-ag]').forEach((x) => x.remove());
    const b = blocoBaloes(c.id);
    if (b) caixa.append(b);
  }
  function desenharBaloes() {
    const caixa = $('msgs'); const id = ui()?.estado.aberta;
    if (!caixa || !id || caixa.dataset.conversa !== id) return;
    const noFimDaRolagem = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
    noFim(caixa, { id });
    if (noFimDaRolagem) caixa.scrollTop = caixa.scrollHeight;
  }

  // ------------------------------------------------------------ folha "Agendar envio"
  let folha = null;
  function lerArquivo(f) {
    return new Promise((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
      r.onerror = () => falha(new Error('Não deu para ler o arquivo.'));
      r.readAsDataURL(f);
    });
  }

  /** Abre a folha. Nova: { conversaId, texto }. Existente: { conversaId, item }. */
  function abrirFolha({ conversaId, texto = '', item = null, depois } = {}) {
    const u = ui(); if (!u || !conversaId) return;
    estilo();
    const el = u.el;
    folha?.remove();
    const d = el('dialog', { class: 'ag-folha', 'aria-label': item ? 'Mensagem agendada' : 'Agendar envio' });
    folha = d;
    const pode = !item || item.podeEditar;
    const st = { arquivo: null, anexoAtual: item?.anexo || null, removerAnexo: false, salvando: false };
    const p0 = item ? partes(new Date(item.enviarEm)) : null;
    const padrao = atalhos().find((a) => a.nome.startsWith('Amanhã'));
    const campoTexto = el('textarea', { placeholder: 'Mensagem', 'aria-label': 'Mensagem que vai ser enviada', maxlength: '4096' });
    campoTexto.value = item ? item.texto : texto;
    if (!pode) campoTexto.readOnly = true;
    const hoje = partes(new Date()).data;
    const campoData = el('input', { type: 'date', 'aria-label': 'Dia do envio', min: hoje });
    const campoHora = el('input', { type: 'time', 'aria-label': 'Hora do envio', step: '60' });
    campoData.value = p0 && item.situacao !== 'falhou' ? p0.data : padrao.data;
    campoHora.value = p0 && item.situacao !== 'falhou' ? p0.hora : padrao.hora;
    if (!pode) { campoData.disabled = true; campoHora.disabled = true; }
    const resumo = el('div', { class: 'ag-resumo', role: 'status' });
    const caixaAtalhos = el('div', { class: 'ag-atalhos', role: 'group', 'aria-label': 'Atalhos de horário' });
    const btsAtalho = [];
    for (const a of atalhos()) {
      const b = el('button', { type: 'button', class: 'ag-atalho', 'aria-pressed': 'false' }, document.createTextNode(a.nome), el('small', { text: quandoTxt(instante(a.data, a.hora)) }));
      b.addEventListener('click', () => { campoData.value = a.data; campoHora.value = a.hora; atualizar(); });
      b.dataset.v = a.data + ' ' + a.hora;
      btsAtalho.push(b); caixaAtalhos.append(b);
    }
    const valido = () => {
      if (!campoData.value || !campoHora.value) return 'Escolha o dia e a hora.';
      const t = instante(campoData.value, campoHora.value);
      if (Number.isNaN(t.getTime())) return 'Dia ou hora inválidos.';
      if (t.getTime() <= Date.now() + 15000) return 'Esse horário já passou. Escolha um daqui para a frente.';
      return null;
    };
    const btSalvar = el('button', { type: 'button', class: 'ag-bt forte', html: SVG.agendar }, document.createTextNode(item ? 'Salvar' : 'Agendar'));
    function atualizar() {
      const v = campoData.value + ' ' + campoHora.value;
      btsAtalho.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      const erro = valido();
      resumo.className = 'ag-resumo' + (erro ? ' erro' : '');
      resumo.innerHTML = erro ? SVG.alerta : SVG.relogio;
      resumo.append(document.createTextNode(erro || `Vai sair ${quandoTxt(instante(campoData.value, campoHora.value))} (horário de Brasília).`));
      btSalvar.disabled = Boolean(erro) || st.salvando;
    }
    campoData.addEventListener('input', atualizar); campoHora.addEventListener('input', atualizar);

    // anexo (opcional)
    const entrada = el('input', { type: 'file', hidden: '' });
    const linhaArq = el('div', { class: 'ag-arquivo' });
    function desenharArquivo() {
      const nome = st.arquivo ? st.arquivo.name : !st.removerAnexo && st.anexoAtual ? (st.anexoAtual.nome || NOME_ANEXO[st.anexoAtual.tipo] || 'Arquivo') : null;
      linhaArq.replaceChildren();
      if (nome) {
        const chip = el('span', { class: 'ag-chip', html: SVG.clipe }, el('span', { text: nome }));
        if (pode) chip.append(el('button', { type: 'button', html: SVG.fechar, 'aria-label': 'Tirar o arquivo', onclick: () => { st.arquivo = null; if (st.anexoAtual) st.removerAnexo = true; desenharArquivo(); } }));
        linhaArq.append(chip);
      } else if (pode) {
        linhaArq.append(el('button', { type: 'button', class: 'ag-bt', html: SVG.clipe, onclick: () => entrada.click() }, document.createTextNode('Anexar arquivo')), el('span', { text: `opcional, até ${LIMITE_MB} MB` }));
      }
    }
    entrada.addEventListener('change', () => {
      const f = entrada.files?.[0]; entrada.value = '';
      if (!f) return;
      if (f.size > LIMITE_MB * 1024 * 1024) { u.toast(`Arquivo grande demais: o limite é ${LIMITE_MB} MB.`); return; }
      st.arquivo = f; desenharArquivo();
    });
    desenharArquivo();

    const fechar = () => { d.close(); };
    d.addEventListener('close', () => { d.remove(); if (folha === d) folha = null; });
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });

    async function salvar() {
      if (st.salvando) return;
      const erro = valido(); if (erro) { u.toast(erro); return; }
      const t = campoTexto.value.trim();
      const temArquivo = st.arquivo || (st.anexoAtual && !st.removerAnexo);
      if (!t && !temArquivo) { u.toast('Escreva a mensagem ou anexe um arquivo.'); campoTexto.focus(); return; }
      st.salvando = true; atualizar();
      try {
        const corpo = { texto: t, data: campoData.value, hora: campoHora.value };
        if (st.arquivo) corpo.anexo = { base64: await lerArquivo(st.arquivo), mimetype: st.arquivo.type || 'application/octet-stream', nomeArquivo: st.arquivo.name };
        else if (st.removerAnexo) corpo.removerAnexo = true;
        const r = item
          ? await u.api(`/api/conversas/${conversaId}/agendadas/${item.id}`, { method: 'PATCH', body: JSON.stringify(corpo) })
          : await u.post(`/api/conversas/${conversaId}/agendadas`, corpo);
        fechar();
        u.toast(`Agendada para ${quandoTxt(r.enviarEm)} ✓`);
        if (!item) window.SintoniaAgendadas._limparComposicao?.(conversaId);
        await depoisDeMudar(conversaId); depois?.();
      } catch (x) { u.toast(x.message); }
      finally { st.salvando = false; if (d.open) atualizar(); }
    }
    btSalvar.addEventListener('click', salvar);
    campoTexto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); salvar(); } });

    async function acao(qual) {
      const u2 = ui();
      try {
        if (qual === 'cancelar') {
          if (!confirm('Cancelar esta mensagem agendada? Ela não vai ser enviada.')) return;
          await u2.post(`/api/conversas/${conversaId}/agendadas/${item.id}/cancelar`, {});
          u2.toast('Mensagem agendada cancelada.');
        } else {
          await u2.post(`/api/conversas/${conversaId}/agendadas/${item.id}/enviar`, {});
          u2.toast('Mensagem enviada ✓');
          if (u2.estado.aberta === conversaId) u2.atualizar?.();
        }
        fechar();
        await depoisDeMudar(conversaId); depois?.();
      } catch (x) { u2.toast(x.message); await depoisDeMudar(conversaId); }
    }

    const titulo = item ? (item.situacao === 'falhou' ? 'Mensagem não enviada' : 'Mensagem agendada') : 'Agendar envio';
    const corpo = el('div', { class: 'ag-f' },
      el('div', { class: 'ag-f-topo' }, el('h2', {}, el('i', { html: SVG.agendar }), document.createTextNode(titulo)), el('button', { type: 'button', class: 'ag-x', html: SVG.fechar, 'aria-label': 'Fechar', onclick: fechar })),
      item?.situacao === 'falhou' && item.erro ? el('p', { class: 'ag-erro-txt', text: item.erro }) : null,
      campoTexto, linhaArq, entrada,
      pode ? el('p', { class: 'ag-rot', text: 'Quando enviar' }) : null,
      pode ? caixaAtalhos : null,
      el('div', { class: 'ag-quando-campos' }, campoData, campoHora),
      resumo,
      item ? el('p', { class: 'ag-info', text: `Agendada por ${item.criadoPor}${pode ? '' : '. Só quem agendou (ou a gestão) pode mudar.'}` }) : el('p', { class: 'ag-info', text: 'Sai sozinha na hora marcada, com o seu nome, mesmo com o app fechado.' }),
      el('div', { class: 'ag-acoes' },
        item && pode ? el('div', { class: 'ag-esq' },
          el('button', { type: 'button', class: 'ag-bt perigo', html: SVG.lixo, onclick: () => acao('cancelar') }, document.createTextNode('Cancelar envio')),
          el('button', { type: 'button', class: 'ag-bt', html: SVG.enviar, onclick: () => acao('enviar') }, document.createTextNode('Enviar agora'))) : null,
        item && pode ? null : el('button', { type: 'button', class: 'ag-bt', onclick: fechar }, document.createTextNode(pode ? 'Voltar' : 'Fechar')),
        pode ? btSalvar : null));
    d.append(corpo);
    document.body.append(d);
    atualizar();
    d.showModal();
    if (pode && !item) { campoTexto.focus(); campoTexto.setSelectionRange(campoTexto.value.length, campoTexto.value.length); }
  }

  async function depoisDeMudar(conversaId) {
    try { await buscar(conversaId); } catch {}
    if (ui()?.estado.aberta === conversaId) desenharBaloes();
    contar();
    if (tela.caixa && ui()?.estado.vista === 'agendadas') desenharTela();
  }

  // ------------------------------------------------------------ ganchos na caixa de texto (sem mexer no HTML)
  function ligarComposicao() {
    const enviar = $('enviar'), texto = $('texto');
    if (!enviar || !texto || enviar.dataset.agLigado) return;
    enviar.dataset.agLigado = '1';
    estilo();
    const abrirAqui = () => { const id = ui()?.estado.aberta; if (id) abrirFolha({ conversaId: id, texto: texto.value.trim() }); };

    // setinha ao lado do enviar (só no computador e só com texto)
    const seta = Object.assign(document.createElement('button'), { type: 'button', className: 'ag-seta', innerHTML: SVG.seta, title: 'Agendar envio' });
    seta.setAttribute('aria-label', 'Agendar envio');
    seta.addEventListener('click', abrirAqui);
    enviar.after(seta);
    const mostrarSeta = () => seta.classList.toggle('ver', !enviar.classList.contains('mic-vazio') && Boolean(texto.value.trim()));
    new MutationObserver(mostrarSeta).observe(enviar, { attributes: true, attributeFilter: ['class'] });
    texto.addEventListener('input', mostrarSeta);
    mostrarSeta();

    // botão direito no enviar (computador)
    let segurou = false, timer = null, inicio = null;
    enviar.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (segurou || folha) return; // no toque, o "segurar" já abriu
      if (e.pointerType === 'touch' || matchMedia('(hover: none)').matches) return;
      abrirAqui();
    });
    // segurar o enviar (celular): meio segundo com texto escrito abre a folha, e o toque não envia
    enviar.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || !texto.value.trim()) return;
      segurou = false; inicio = { x: e.clientX, y: e.clientY };
      clearTimeout(timer);
      timer = setTimeout(() => { segurou = true; navigator.vibrate?.(12); abrirAqui(); }, 500);
    });
    const soltar = () => { clearTimeout(timer); timer = null; };
    enviar.addEventListener('pointerup', soltar);
    enviar.addEventListener('pointercancel', soltar);
    enviar.addEventListener('pointerleave', soltar);
    enviar.addEventListener('pointermove', (e) => { if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 12) soltar(); });
    document.addEventListener('click', (e) => {
      if (!segurou || !e.target.closest?.('#enviar')) return;
      segurou = false; e.preventDefault(); e.stopPropagation();
    }, true);

    // "+" › Agendar mensagem (serve também com a caixa vazia)
    const menu = $('menu-mais');
    if (menu && !menu.querySelector('#m-agendar')) {
      const b = document.createElement('button');
      b.id = 'm-agendar'; b.type = 'button';
      b.innerHTML = `<i style="background:#106ebe">${SVG.agendar}</i>`;
      b.append(document.createTextNode('Agendar mensagem'));
      b.addEventListener('click', () => { menu.hidden = true; abrirAqui(); });
      menu.append(b);
    }
  }
  /** Depois de agendar o que estava escrito, a caixa de texto fica limpa (como depois de enviar). */
  function limparComposicao(conversaId) {
    const texto = $('texto');
    if (!texto || ui()?.estado.aberta !== conversaId) return;
    texto.value = ''; texto.style.height = '';
    texto.dispatchEvent(new Event('input'));
  }

  // ------------------------------------------------------------ tela Atendimento › Mensagens agendadas
  const tela = { caixa: null, quem: 'minhas', situacao: 'pendentes', itens: [], carregando: false };
  try { const q = localStorage.getItem('sintonia.agendadas.quem'); if (q === 'todas' || q === 'minhas') tela.quem = q; } catch {}

  async function desenhar(caixa) {
    estilo();
    tela.caixa = caixa;
    if (!tela.itens.length) caixa.replaceChildren(ui().el('div', { class: 'ag-vazio', text: 'Carregando…' }));
    await carregarTela();
  }
  async function carregarTela() {
    const u = ui(); if (!u || !tela.caixa) return;
    try {
      const r = await u.api(`/api/agendadas?quem=${tela.quem}&situacao=${tela.situacao}`);
      tela.itens = r.agendadas || [];
      minhasPendentes = r.minhasPendentes ?? minhasPendentes;
      pintarContador();
    } catch (x) { u.toast(x.message); tela.itens = []; }
    desenharTela();
  }
  function desenharTela() {
    const u = ui(), el = u.el; const caixa = tela.caixa; if (!caixa) return;
    const seg = (valor, rot) => el('button', { type: 'button', 'aria-pressed': String(tela.quem === valor), onclick: () => { tela.quem = valor; try { localStorage.setItem('sintonia.agendadas.quem', valor); } catch {} carregarTela(); } }, document.createTextNode(rot));
    const sel = el('select', { class: 'ag-sel', 'aria-label': 'Situação' });
    for (const [v, n] of [['pendentes', 'Para enviar'], ['falhou', 'Não enviadas'], ['enviada', 'Enviadas'], ['cancelada', 'Canceladas'], ['todas', 'Todas']]) sel.append(el('option', { value: v, text: n }));
    sel.value = tela.situacao;
    sel.addEventListener('change', () => { tela.situacao = sel.value; carregarTela(); });
    const lista = el('div', { class: 'ag-lista' });
    if (!tela.itens.length) {
      lista.append(el('div', { class: 'ag-vazio', html: SVG.agendar }, el('span', { text: tela.situacao === 'pendentes' ? 'Nenhuma mensagem agendada para enviar.' : 'Nada por aqui.' }),
        el('small', { text: 'Na conversa, segure o botão de enviar (ou clique com o botão direito nele) para agendar.' })));
    }
    let dia = '';
    for (const m of tela.itens) {
      const d = diaTxt(m.enviarEm);
      if (d !== dia) { dia = d; lista.append(el('div', { class: 'ag-dia', text: d })); }
      const cli = m.conversa?.nome || u.formatarTel?.(m.conversa?.telefone) || m.conversa?.telefone || 'Cliente';
      const prev = [m.anexo ? `[${m.anexo.nome || NOME_ANEXO[m.anexo.tipo] || 'arquivo'}]` : '', m.texto].filter(Boolean).join(' ');
      const acoes = el('div', { class: 'ag-item-acoes' });
      if (PENDENTE(m) && m.situacao !== 'enviando') {
        acoes.append(el('button', { type: 'button', class: 'ag-bt', onclick: () => abrirFolha({ conversaId: m.conversaId, item: m, depois: carregarTela }) }, document.createTextNode(m.podeEditar ? 'Abrir' : 'Ver')));
      }
      const meta = el('div', { class: 'ag-meta' }, el('span', { class: 'ag-pil ' + m.situacao, text: SIT[m.situacao] || m.situacao }), el('span', { text: `por ${m.criadoPor}` }));
      if (m.situacao === 'enviada' && m.enviadoEm) meta.append(el('span', { text: `saiu ${quandoTxt(m.enviadoEm)}` }));
      if (m.situacao === 'cancelada' && m.canceladoPor) meta.append(el('span', { text: `cancelada por ${m.canceladoPor}` }));
      if (m.situacao === 'falhou' && m.erro) meta.append(el('span', { text: m.erro }));
      lista.append(el('div', { class: 'ag-item' },
        el('div', { class: 'ag-hora', text: horaCurta(partes(new Date(m.enviarEm)).hora) }),
        el('button', { type: 'button', class: 'ag-cli', text: cli, title: 'Abrir a conversa', onclick: () => u.abrir(m.conversaId) }),
        acoes,
        el('div', { class: 'ag-prev', text: prev }),
        meta));
    }
    caixa.replaceChildren(el('div', { class: 'ag-tela' },
      el('div', { class: 'ag-tela-topo' }, el('h1', { text: 'Mensagens agendadas' }), el('p', { text: 'O que vai sair sozinho nas conversas, na hora marcada (horário de Brasília).' })),
      el('div', { class: 'ag-filtros' }, el('div', { class: 'ag-seg', role: 'group', 'aria-label': 'De quem' }, seg('minhas', 'Minhas'), seg('todas', 'Todas')), sel),
      lista));
  }

  // contador "minhas para enviar" no menu lateral
  async function contar() {
    const u = ui(); if (!u?.estado?.eu) return;
    try { const r = await u.api('/api/agendadas?quem=minhas&situacao=pendentes'); minhasPendentes = r.minhasPendentes ?? 0; } catch { return; }
    pintarContador();
  }
  function pintarContador() {
    const q = $('lt-agendadas-qtd'); if (!q) return;
    q.hidden = !minhasPendentes; q.textContent = minhasPendentes ? String(minhasPendentes) : '';
  }

  function iniciar() {
    ligarComposicao();
    // o "eu" chega depois do login: conta quando estiver pronto
    let n = 0; const esperar = () => { if (ui()?.estado?.eu) contar(); else if (n++ < 40) setTimeout(esperar, 500); };
    esperar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.SintoniaAgendadas = { conversa, noFim, abrir: abrirFolha, quandoTxt, _limparComposicao: limparComposicao };
  /* atendimento-extra: menu Automações › Mensagens agendadas abre com "Todas" (o que vai sair sozinho na empresa). */
  const verTodas = () => { tela.quem = 'todas'; tela.situacao = 'pendentes'; };
  window.SintoniaTelas.agendadas = { desenhar, verTodas, valorMenu: () => (minhasPendentes ? String(minhasPendentes) : '') };
})();
