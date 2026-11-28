/* reagendar (dono 28/11): o botão de agenda do topo da conversa (#topo-agendar) abre um menu curto:
 * - a cliente JÁ tem horário futuro: "Reagendar" (mostra o horário atual), "Novo agendamento" e "Agendar para outra pessoa";
 * - sem horário: "Agendar" e "Agendar para outra pessoa".
 * "Reagendar" é uma folha própria (#d-reagendar): o horário atual (dia, hora, unidade), os dias em botões e os horários
 * livres da unidade em grade (sem citar profissional). O servidor marca o novo ANTES de desmarcar o antigo
 * (POST /api/conversas/:id/remarcar, a mesma ferramenta da IA). Mais de um horário futuro: escolhe qual remarcar.
 * "Agendar para outra pessoa" usa a folha Agendar de sempre (#d-agendar) com o nome completo e os dados dela; o
 * app.html manda junto o que extraAgendar() devolve (paraOutra). Texto do servidor entra sempre por textContent.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ui = () => window.Sintonia?.ui;
  if (window.SintoniaTelas?.agendaTopo) return;

  function el(tag, a = {}, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(a)) {
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v; // só ícones fixos deste arquivo
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) n.append(f);
    return n;
  }
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    trocar: svg('<path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/>'),
    novo: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>'),
    outra: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M17.5 8v6M14.5 11h6"/>'),
    cal: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    seta: svg('<path d="m9 6 6 6-6 6"/>'),
  };

  // ---------------------------------------------------------------- estilo
  document.head.append(el('style', { id: 'agt-estilo', text: `
  #d-agt-menu { width: min(340px, calc(100vw - 24px)); margin: 0; padding: 6px; border-radius: 16px; background: var(--fundo) !important; }
  #d-agt-menu::backdrop { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; }
  #d-reagendar { background: var(--fundo) !important; }
  .agt-item { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 8px 12px; border-radius: 12px; color: var(--texto); }
  .agt-item:hover, .agt-item:focus-visible { background: color-mix(in srgb, var(--marca-azul, #106ebe) 9%, transparent); }
  .agt-item:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: -2px; }
  .agt-item .agt-ic { flex: none; width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; color: var(--marca-azul, #106ebe); background: color-mix(in srgb, var(--marca-azul, #106ebe) 10%, transparent); }
  .agt-item .agt-ic svg { width: 20px; height: 20px; }
  .agt-item .agt-txt { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .agt-item b { font-size: 15px; font-weight: 600; }
  .agt-item small { font-size: 12.5px; color: var(--sub); overflow-wrap: anywhere; }
  .agt-item.agt-destaque .agt-ic { color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .agt-nota { font-size: 12.5px; color: var(--sub); padding: 6px 12px 8px; }
  html[data-tema="escuro"] .agt-item .agt-ic { color: var(--marca-menta, #0ffcbe); background: color-mix(in srgb, var(--marca-menta, #0ffcbe) 10%, transparent); }
  html[data-tema="escuro"] .agt-item.agt-destaque .agt-ic { color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  html[data-tema="escuro"] .agt-item:hover, html[data-tema="escuro"] .agt-item:focus-visible { background: color-mix(in srgb, var(--marca-menta, #0ffcbe) 8%, transparent); }

  #d-reagendar { width: min(480px, calc(100vw - 24px)); }
  #d-reagendar form { gap: 14px; }
  #d-reagendar h2 { font-size: 19px; }
  .agt-atual { position: relative; display: grid; gap: 2px; padding: 12px 14px; border-radius: 14px; background: var(--entrada); border: 1px solid var(--linha); overflow: hidden; }
  .agt-atual::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, #0ffcbe, #3aa0ff); }
  .agt-atual small { font-size: 12px; font-weight: 600; color: var(--sub); text-transform: uppercase; letter-spacing: .3px; }
  .agt-atual b { font-size: 16px; font-weight: 600; color: var(--texto); }
  .agt-atual span { font-size: 13.5px; color: var(--sub); overflow-wrap: anywhere; }
  .agt-atual.agt-riscado b { text-decoration: line-through; text-decoration-thickness: 1px; color: var(--sub); }
  .agt-rotulo { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; color: var(--sub); }
  .agt-rotulo small { font-weight: 400; font-size: 12px; }
  .agt-campo { display: grid; gap: 6px; min-width: 0; }
  #d-reagendar .agc-outra input { flex: 1; min-width: 0; min-height: 40px; padding: 6px 10px; border-radius: 10px; font-size: 15px; }
  #d-reagendar .agt-msg { font-size: 13.5px; color: var(--sub); }
  .agt-novo { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--texto); }
  .agt-novo b { font-weight: 600; }
  .agt-lista { display: grid; gap: 8px; }
  .agt-escolha { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 56px; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--linha); background: var(--entrada); color: var(--texto); }
  .agt-escolha:hover, .agt-escolha:focus-visible { border-color: var(--marca-azul, #106ebe); }
  .agt-escolha .agt-txt { flex: 1; display: grid; gap: 2px; min-width: 0; }
  .agt-escolha b { font-size: 15px; font-weight: 600; }
  .agt-escolha small { font-size: 12.5px; color: var(--sub); overflow-wrap: anywhere; }
  .agt-escolha svg { width: 18px; height: 18px; color: var(--sub); flex: none; }
  #agt-outra-campos { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
  #agt-outra-campos label:first-child { grid-column: 1 / -1; }
  #agt-outra-campos label { min-width: 0; font-size: 13px; font-weight: 600; }
  #agt-outra-campos input { width: 100%; min-width: 0; box-sizing: border-box; font-weight: 400; }
  #agt-outra-campos[hidden] { display: none; }
  html[data-tema="escuro"] #d-reagendar input[type=date], html[data-tema="escuro"] #agt-outra-campos input[type=date] { color-scheme: dark; }
  @media (max-width: 760px) {
    #d-agt-menu { width: 100vw; max-width: 100vw; margin: auto auto 0 !important; border-radius: 20px 20px 0 0; padding: 8px 8px calc(12px + env(safe-area-inset-bottom)); }
    #d-agt-menu::backdrop { background: rgba(11,20,26,.45); }
    #d-reagendar form .rodape { position: sticky; bottom: calc(-14px - env(safe-area-inset-bottom)); background: var(--fundo); margin: 0 -16px calc(-14px - env(safe-area-inset-bottom)); padding: 10px 16px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--linha); }
    #d-reagendar { width: 100vw; max-width: 100vw; margin: auto auto 0; border-radius: 20px 20px 0 0; max-height: 92vh; }
    #d-reagendar form { padding: 16px 16px calc(14px + env(safe-area-inset-bottom)); gap: 12px; }
    #d-reagendar .agc-outra input, #agt-outra-campos input { font-size: 16px; }
    #agt-outra-campos { grid-template-columns: 1fr; }
  }
  ` }));

  // ---------------------------------------------------------------- horários marcados (com cache curto)
  const cache = new Map(); // conversaId -> { em, p }
  function marcados(id) {
    const c = cache.get(id);
    if (c && Date.now() - c.em < 60_000) return c.p;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    const p = fetch(`/api/conversas/${encodeURIComponent(id)}/horarios-marcados`, { credentials: 'same-origin', signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : { horarios: [] }))
      .catch(() => ({ horarios: [], falhou: true }))
      .then((j) => { clearTimeout(t); if (j.falhou) cache.delete(id); return { unidadeNome: j.unidadeNome || '', horarios: Array.isArray(j.horarios) ? j.horarios : [] }; });
    cache.set(id, { em: Date.now(), p });
    return p;
  }
  const conversaAberta = () => ui()?.estado?.aberta || null;

  const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const isoLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const meioDia = (iso) => new Date(iso + 'T12:00:00');
  function diaCurto(iso) {
    const hoje = isoLocal(new Date());
    const amanha = isoLocal(new Date(Date.now() + 864e5));
    if (iso === hoje) return 'hoje';
    if (iso === amanha) return 'amanhã';
    return meioDia(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'numeric' }).replace('.', '');
  }
  const diaLongo = (iso) => { const s = meioDia(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1); };

  // ---------------------------------------------------------------- menu do botão
  const menu = el('dialog', { id: 'd-agt-menu', 'aria-label': 'Agendar' });
  document.body.append(menu);
  menu.addEventListener('click', (e) => { if (e.target === menu) menu.close(); });

  function item({ ic, titulo, sub, destaque, onclick, id }) {
    return el('button', { type: 'button', class: `agt-item${destaque ? ' agt-destaque' : ''}`, id, onclick },
      el('span', { class: 'agt-ic', html: ic }),
      el('span', { class: 'agt-txt' }, el('b', { text: titulo }), sub ? el('small', { text: sub }) : null));
  }
  function posicionar(botao) {
    if (matchMedia('(max-width: 760px)').matches) { menu.style.cssText = ''; return; }
    const r = botao.getBoundingClientRect();
    const w = menu.offsetWidth || 340;
    menu.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w))}px`;
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.position = 'fixed'; menu.style.right = 'auto'; menu.style.bottom = 'auto';
  }
  function desenharMenu(id, dados) {
    const fechar = (f) => () => { menu.close(); f(); };
    const futuros = dados?.horarios || [];
    const itens = [];
    if (futuros.length) {
      const h = futuros[0];
      const sub = futuros.length > 1 ? `${futuros.length} horários marcados · o próximo: ${diaCurto(h.data)} às ${h.hora}` : `${diaCurto(h.data)} às ${h.hora}${dados.unidadeNome ? ` · ${dados.unidadeNome}` : ''}`;
      itens.push(item({ id: 'agt-reagendar', ic: IC.trocar, titulo: 'Reagendar', sub, destaque: true, onclick: fechar(() => abrirReagendar(id, dados)) }));
      itens.push(item({ id: 'agt-novo', ic: IC.novo, titulo: 'Novo agendamento', sub: 'Mais um horário para ela', onclick: fechar(() => abrirAgendar(false)) }));
    } else {
      itens.push(item({ id: 'agt-novo', ic: IC.novo, titulo: 'Agendar', sub: 'Horário para esta cliente', destaque: !dados ? false : true, onclick: fechar(() => abrirAgendar(false)) }));
    }
    itens.push(item({ id: 'agt-outra', ic: IC.outra, titulo: 'Agendar para outra pessoa', sub: 'Marca no cadastro dela', onclick: fechar(() => abrirAgendar(true)) }));
    if (!dados) itens.push(el('div', { class: 'agt-nota', 'aria-live': 'polite', text: 'Conferindo se ela já tem horário…' }));
    menu.replaceChildren(...itens);
  }
  async function abrirMenu(botao) {
    const id = conversaAberta(); if (!id) return;
    desenharMenu(id, null);
    if (!menu.open) menu.showModal();
    posicionar(botao);
    menu.querySelector('.agt-item')?.focus({ preventScroll: true });
    const dados = await marcados(id);
    if (!menu.open || conversaAberta() !== id) return;
    const foco = document.activeElement?.id;
    desenharMenu(id, dados);
    posicionar(botao);
    (menu.querySelector(foco === 'agt-outra' ? '#agt-outra' : '.agt-item'))?.focus({ preventScroll: true });
  }

  // O clique no botão do topo chega aqui antes do app.html (fase de captura) e vira o menu.
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('#topo-agendar') : null;
    if (!b || !ui()) return;
    e.preventDefault(); e.stopPropagation();
    void abrirMenu(b);
  }, true);
  // Começa a conferir assim que o dedo/mouse encosta (a resposta chega junto com o menu).
  document.addEventListener('pointerdown', (e) => {
    const b = e.target instanceof Element ? e.target.closest('#topo-agendar') : null;
    const id = b && conversaAberta();
    if (id) void marcados(id);
  }, true);

  // ---------------------------------------------------------------- Agendar / Agendar para outra pessoa (folha de sempre)
  const dlgAg = $('d-agendar');
  let outra = false;
  let campos = null;
  const tituloAg = dlgAg?.querySelector('h2');
  const nomeAg = $('ag-nome');
  const rotuloNome = nomeAg?.closest('label');
  const textoRotulo = rotuloNome ? [...rotuloNome.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()) : null;
  const original = { titulo: tituloAg?.textContent || 'Agendar', rotulo: textoRotulo?.textContent || 'Nome da cliente ' };
  function montarCampos() {
    if (campos || !rotuloNome) return campos;
    campos = el('div', { id: 'agt-outra-campos', hidden: true },
      el('label', {}, 'Telefone dela (opcional) ', el('input', { id: 'agt-outra-tel', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: '(71) 99999-9999', maxlength: '30' })),
      el('label', {}, 'Nascimento (opcional) ', el('input', { id: 'agt-outra-nasc', type: 'date' })),
      el('label', {}, 'E-mail (opcional) ', el('input', { id: 'agt-outra-email', type: 'email', autocomplete: 'off', maxlength: '200', placeholder: 'nome@email.com' })));
    rotuloNome.after(campos);
    return campos;
  }
  function modoOutra(ligar) {
    outra = ligar;
    if (!dlgAg) return;
    if (tituloAg) tituloAg.textContent = ligar ? 'Agendar para outra pessoa' : original.titulo;
    if (textoRotulo) textoRotulo.textContent = ligar ? 'Nome completo da outra pessoa ' : original.rotulo;
    const c = montarCampos();
    if (c) {
      c.hidden = !ligar;
      if (ligar) c.querySelectorAll('input').forEach((i) => { i.value = ''; });
    }
    if (nomeAg) { if (ligar) { nomeAg.value = ''; nomeAg.placeholder = 'Nome e sobrenome'; } else nomeAg.placeholder = ''; }
  }
  function abrirAgendar(paraOutra) {
    const u = ui(); if (!u?.abrirAgendar) return;
    modoOutra(false);
    void u.abrirAgendar();
    if (paraOutra) { modoOutra(true); setTimeout(() => nomeAg?.focus(), 60); }
  }
  dlgAg?.addEventListener('close', () => { if (outra) modoOutra(false); });
  // Nome completo antes de mandar (o servidor confere de novo).
  dlgAg?.addEventListener('submit', (e) => {
    if (!outra || e.submitter?.value !== 'ok') return;
    const partes = (nomeAg?.value || '').trim().split(/\s+/).filter(Boolean);
    if (partes.length < 2) { e.preventDefault(); e.stopPropagation(); $('ag-erro').textContent = 'Informe o nome completo da outra pessoa (nome e sobrenome).'; nomeAg?.focus(); }
  }, true);
  /** O que o app.html junta ao POST /agendar (vazio quando o horário é da própria cliente). */
  function extraAgendar() {
    if (!outra) return {};
    const v = (id) => ($(id)?.value || '').trim();
    const p = {};
    if (v('agt-outra-tel')) p.telefone = v('agt-outra-tel');
    if (v('agt-outra-nasc')) p.dataNascimento = v('agt-outra-nasc');
    if (v('agt-outra-email')) p.email = v('agt-outra-email');
    return { paraOutra: p };
  }

  // ---------------------------------------------------------------- Reagendar
  const DIAS = 7;
  const dlg = el('dialog', { id: 'd-reagendar', 'aria-labelledby': 'agt-titulo' });
  const form = el('form', { method: 'dialog' });
  dlg.append(form);
  document.body.append(dlg);
  const st = { id: null, dados: null, atual: null, data: null, hora: null, horas: [], carregando: false, pedido: 0 };

  function escolherQual() {
    const { dados } = st;
    form.replaceChildren(
      el('h2', { id: 'agt-titulo', text: 'Reagendar' }),
      el('div', { class: 'agt-msg', text: 'Ela tem mais de um horário marcado. Qual você quer remarcar?' }),
      el('div', { class: 'agt-lista' }, ...dados.horarios.map((h) => el('button', { type: 'button', class: 'agt-escolha', onclick: () => { st.atual = h; st.data = null; st.hora = null; desenhar(); } },
        el('span', { class: 'agt-txt' }, el('b', { text: `${diaLongo(h.data)} · ${h.hora}` }), el('small', { text: [h.servico, dados.unidadeNome].filter(Boolean).join(' · ') })),
        el('span', { html: IC.seta, style: 'display:grid' })))),
      el('div', { class: 'rodape' }, el('button', { class: 'botao leve', value: 'cancelar', formnovalidate: true, text: 'Fechar' })));
  }

  function desenhar() {
    const { atual, dados } = st;
    if (!atual) return escolherQual();
    const base = new Date();
    const dias = Array.from({ length: DIAS }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return isoLocal(d); });
    const outraData = el('input', { type: 'date', id: 'agt-data', min: isoLocal(base), value: st.data && !dias.includes(st.data) ? st.data : '', 'aria-label': 'Outra data' });
    outraData.addEventListener('change', () => { if (outraData.value) trocarDia(outraData.value); });
    const grade = el('div', { class: 'agc-dias', role: 'group', 'aria-label': 'Novo dia' }, ...dias.map((v, i) => {
      const d = meioDia(v);
      return el('button', { type: 'button', class: 'agc-dia', 'aria-pressed': String(v === st.data), 'aria-label': d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }), onclick: () => trocarDia(v) },
        el('small', { text: i === 0 ? 'hoje' : i === 1 ? 'amanhã' : DSEM[d.getDay()] }), el('b', { text: String(d.getDate()) }));
    }));
    const horas = el('div', { class: 'agc-horas', id: 'agt-horas', 'aria-live': 'polite' });
    if (!st.data) horas.append(el('div', { class: 'agt-msg', text: 'Escolha o novo dia.' }));
    else if (st.carregando) horas.append(el('div', { class: 'agt-msg', text: 'Buscando horários livres…' }));
    else if (st.erroHoras) horas.append(el('div', { class: 'erro-txt', text: st.erroHoras }));
    else if (!st.horas.length) horas.append(el('div', { class: 'agt-msg', text: 'Sem horário livre nesse dia. Tente outro dia.' }));
    else {
      const turnos = [['Manhã', (h) => h < '12:00'], ['Tarde', (h) => h >= '12:00' && h < '18:00'], ['Noite', (h) => h >= '18:00']];
      for (const [nome, cabe] of turnos) {
        const hs = st.horas.filter(cabe);
        if (!hs.length) continue;
        horas.append(el('div', { class: 'agc-turno', text: nome }), el('div', { class: 'agc-grade', role: 'group', 'aria-label': nome }, ...hs.map((h) => el('button', {
          type: 'button', class: 'agc-hora', 'aria-pressed': String(h === st.hora), text: h,
          onclick: () => { st.hora = h; desenhar(); $('agt-ok')?.focus({ preventScroll: true }); },
        }))));
      }
    }
    const podeEnviar = !ui()?.estado?.eu || ui()?.estado?.eu?.permissoes?.responder !== false;
    const confirmar = el('input', { type: 'checkbox', id: 'agt-confirmar', checked: st.confirmar !== false && podeEnviar ? true : null });
    confirmar.addEventListener('change', () => { st.confirmar = confirmar.checked; });
    const ok = el('button', { class: 'botao', id: 'agt-ok', value: 'ok', disabled: !(st.data && st.hora) || st.enviando ? true : null, text: st.enviando ? 'Remarcando…' : 'Remarcar' });
    form.replaceChildren(
      el('h2', { id: 'agt-titulo', text: 'Reagendar' }),
      el('div', { class: `agt-atual${st.data && st.hora ? ' agt-riscado' : ''}` },
        el('small', { text: 'Horário atual' }),
        el('b', { text: `${diaLongo(atual.data)} · ${atual.hora}` }),
        el('span', { text: [atual.servico, dados.unidadeNome].filter(Boolean).join(' · ') })),
      st.data && st.hora ? el('div', { class: 'agt-novo' }, el('span', { html: IC.seta, style: 'display:grid;width:18px;height:18px' }), el('span', { text: 'Novo: ' }), el('b', { text: `${diaLongo(st.data)} · ${st.hora}` })) : null,
      el('div', { class: 'agt-campo' }, el('div', { class: 'agt-rotulo' }, el('span', { text: 'Novo dia' }), st.data ? el('small', { text: diaLongo(st.data) }) : null), grade,
        el('label', { class: `agc-outra${st.data && !dias.includes(st.data) ? ' agc-ativa' : ''}` }, el('span', { html: IC.cal, style: 'display:grid' }), el('span', { text: 'Outra data' }), outraData)),
      el('div', { class: 'agt-campo' }, el('div', { class: 'agt-rotulo' }, el('span', { text: 'Novo horário' })), horas),
      el('label', { class: 'opcao' }, confirmar, ' Enviar confirmação do novo horário para a cliente'),
      el('div', { class: 'agt-msg', text: 'O novo horário é marcado antes de desmarcar o antigo.' }),
      el('div', { id: 'agt-erro', class: 'erro-txt', text: st.erro || '' }),
      el('div', { class: 'rodape' },
        st.dados.horarios.length > 1 ? el('button', { type: 'button', class: 'botao leve', text: 'Voltar', onclick: () => { st.atual = null; st.erro = ''; desenhar(); } }) : null,
        el('button', { class: 'botao leve', value: 'cancelar', formnovalidate: true, text: 'Fechar' }), ok));
  }

  async function trocarDia(v) {
    st.data = v; st.hora = null; st.horas = []; st.erroHoras = ''; st.erro = ''; st.carregando = true;
    const n = ++st.pedido;
    desenhar();
    try {
      const q = new URLSearchParams({ unidade: ui()?.estado?.detalhe?.conversa?.unidade || '', data: v, servicoId: String(st.atual.servicoId || '') });
      if (!st.atual.servicoId) throw new Error('Não deu para saber o serviço deste horário. Remarque pela agenda.');
      const lista = await ui().api('/api/agenda/horarios?' + q);
      if (n !== st.pedido) return;
      const todas = [...new Set((Array.isArray(lista) ? lista : []).flatMap((p) => p.horarios || []))].map((h) => String(h).padStart(5, '0')).sort();
      st.horas = todas.filter((h) => !(v === st.atual.data && h === st.atual.hora));
    } catch (x) {
      if (n !== st.pedido) return;
      st.erroHoras = x.message || 'Não deu para buscar os horários agora.';
    }
    st.carregando = false;
    desenhar();
  }

  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    if (!st.data || !st.hora || st.enviando) return;
    st.enviando = true; st.erro = ''; desenhar();
    try {
      const r = await ui().post(`/api/conversas/${encodeURIComponent(st.id)}/remarcar`, { agendamentoId: st.atual.id, data: st.data, hora: st.hora, enviarConfirmacao: $('agt-confirmar')?.checked ?? true, atendente: ui()?.estado?.eu?.nome || undefined });
      cache.delete(st.id);
      dlg.close();
      ui().toast(`Remarcado ✓ ${diaCurto(st.data)} às ${st.hora}${r && r.aviso ? ` — ${r.aviso}` : ''}`);
      await ui().atualizar?.();
    } catch (x) {
      st.erro = x.message || 'Não deu para remarcar.';
      if (x.status === 409 && st.data) { const erro = st.erro; await trocarDia(st.data); st.erro = erro; }
    } finally {
      st.enviando = false;
      if (dlg.open) desenhar();
    }
  });

  function abrirReagendar(id, dados) {
    Object.assign(st, { id, dados, atual: dados.horarios.length === 1 ? dados.horarios[0] : null, data: null, hora: null, horas: [], erro: '', erroHoras: '', confirmar: true, enviando: false });
    desenhar();
    dlg.showModal();
  }

  window.SintoniaTelas = window.SintoniaTelas || {};
  window.SintoniaTelas.agendaTopo = { extraAgendar, abrirMenu: () => { const b = $('topo-agendar'); if (b) void abrirMenu(b); } };
})();
