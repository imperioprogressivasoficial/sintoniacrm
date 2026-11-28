/* agendar-compacto (dono 27/11): o Agendar da conversa (#d-agendar) mostrava a lista inteira de serviços e de
 * profissionais em <select> e, no celular, o select esticava a folha (o nome mais comprido mandava na largura).
 * Agora: Serviço e Profissional mostram até 5 (os mais marcados na unidade; sem histórico, em ordem alfabética)
 * e uma busca que filtra a partir de 3 letras (sem acento, sem diferenciar maiúsculas, por qualquer palavra do
 * nome); o escolhido vira uma pílula com "trocar". Data em botões (hoje e os próximos dias) + "Outra data", e os
 * horários em grade, um botão por hora (a profissional é escolhida em seguida, quando há mais de uma).
 *
 * Só a interface muda: os <select id="ag-servico">, <select id="ag-prof">, o <input id="ag-data"> e os botões de
 * #ag-horarios continuam no lugar (escondidos) e o código de sempre (app.html) agenda com eles, no Trinks, Avec ou
 * AppBarber. Esta tela só escolhe neles e dispara o "change". Texto do servidor entra sempre por textContent.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const dlg = $('d-agendar');
  const selServ = $('ag-servico'), selProf = $('ag-prof'), selUni = $('ag-unidade'), data = $('ag-data'), caixaHoras = $('ag-horarios');
  if (!dlg || !selServ || !selProf || !data || !caixaHoras || dlg.dataset.agc) return;
  dlg.dataset.agc = '1';

  const MAX = 5;      // itens visíveis em cada lista
  const MIN_BUSCA = 3; // letras para começar a filtrar
  const DIAS = 7;     // botões de data

  // ---------------------------------------------------------------- utilidades
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
  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const IC = {
    lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  // ---------------------------------------------------------------- estilo
  document.head.append(el('style', { id: 'agc-estilo', text: `
  #d-agendar { width: min(480px, calc(100vw - 24px)); }
  #d-agendar form { gap: 12px; min-width: 0; }
  #d-agendar #ag-corpo { gap: 14px !important; min-width: 0; }
  #d-agendar #ag-corpo > * { min-width: 0; }
  #d-agendar select { max-width: 100%; width: 100%; }
  #d-agendar .agc-oculto { display: none !important; }
  #d-agendar h2 { font-size: 19px; }
  #d-agendar #ag-corpo > label:not(.opcao) { font-size: 13px; font-weight: 600; }
  #d-agendar #ag-corpo > .opcao { align-items: center; font-size: 14.5px; min-height: 44px; }
  #d-agendar #ag-corpo > .opcao input { width: 20px; height: 20px; min-height: 0; margin: 0; flex: none; }
  .agc-campo { display: grid; gap: 6px; min-width: 0; }
  .agc-rotulo { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 13px; font-weight: 600; color: var(--sub); }
  .agc-rotulo small { font-weight: 400; font-size: 12px; }
  .agc-pilula { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 7px 8px 7px 12px;
    border-radius: 12px; border: 1px solid color-mix(in srgb, var(--marca-azul, #106ebe) 45%, transparent); background: color-mix(in srgb, var(--marca-azul, #106ebe) 8%, var(--entrada)); color: var(--texto); min-width: 0; }
  .agc-pilula .agc-txt { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .agc-pilula b { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; line-height: 1.25; }
  .agc-pilula small { font-size: 12.5px; color: var(--sub); }
  .agc-pilula .agc-trocar { flex: none; font-size: 13.5px; font-weight: 700; color: var(--marca-azul, #106ebe); padding: 6px 8px; border-radius: 8px; }
  .agc-pilula[aria-disabled="true"] { cursor: default; border-color: var(--linha); background: var(--entrada); }
  .agc-pilula[aria-disabled="true"] b { font-weight: 400; color: var(--sub); }
  .agc-busca { display: flex; align-items: center; gap: 8px; min-height: 44px; box-sizing: border-box; padding: 0 6px 0 12px; border-radius: 12px; border: 1px solid var(--linha); background: var(--entrada); color: var(--sub); }
  .agc-busca:focus-within { border-color: var(--marca-azul, #106ebe); }
  .agc-busca svg { width: 18px; height: 18px; flex: none; }
  #d-agendar .agc-busca input { all: unset; flex: 1; min-width: 0; min-height: 40px; font-size: 15px; color: var(--texto); }
  .agc-busca input::placeholder { color: var(--sub); opacity: .85; }
  .agc-busca input::-webkit-search-cancel-button { display: none; }
  .agc-ic { all: unset; cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; color: var(--sub); flex: none; }
  .agc-ic svg { width: 18px; height: 18px; }
  .agc-lista { display: grid; border: 1px solid var(--linha); border-radius: 12px; overflow: hidden; }
  .agc-opcao { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 12px; color: var(--texto); font-size: 14.5px; }
  .agc-opcao + .agc-opcao { border-top: 1px solid var(--linha); }
  .agc-opcao span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .agc-opcao small { flex: none; color: var(--sub); font-size: 12.5px; }
  .agc-opcao mark { background: color-mix(in srgb, var(--marca-menta, #0ffcbe) 45%, transparent); color: inherit; border-radius: 3px; }
  .agc-opcao[aria-selected="true"] { background: color-mix(in srgb, var(--marca-azul, #106ebe) 12%, transparent); font-weight: 600; }
  .agc-opcao:hover, .agc-opcao:focus-visible { background: color-mix(in srgb, var(--marca-azul, #106ebe) 8%, transparent); }
  .agc-lista[hidden], .agc-nota[hidden] { display: none; }
  .agc-nota { font-size: 12.5px; color: var(--sub); line-height: 1.35; }
  .agc-dias { display: grid; grid-template-columns: repeat(${DIAS}, minmax(0, 1fr)); gap: 5px; }
  .agc-dia { all: unset; box-sizing: border-box; cursor: pointer; display: grid; place-items: center; gap: 0; min-height: 48px; padding: 4px 0; border-radius: 12px; border: 1px solid var(--linha); background: var(--entrada); color: var(--texto); text-align: center; }
  .agc-dia small { font-size: 11px; color: var(--sub); text-transform: lowercase; line-height: 1.2; }
  .agc-dia b { font-size: 16px; font-weight: 600; line-height: 1.2; }
  .agc-dia[aria-pressed="true"], .agc-hora[aria-pressed="true"], .agc-com[aria-pressed="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); border-color: transparent; color: #fff; }
  .agc-dia[aria-pressed="true"] small { color: rgba(255,255,255,.85); }
  .agc-outra { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--sub); }
  .agc-outra svg { width: 17px; height: 17px; flex: none; }
  #d-agendar .agc-outra input { flex: 1; min-width: 0; min-height: 40px; padding: 6px 10px; border-radius: 10px; font-size: 15px; }
  .agc-outra.agc-ativa input { border-color: var(--marca-azul, #106ebe); box-shadow: 0 0 0 1px var(--marca-azul, #106ebe); }
  .agc-turno { font-size: 12px; font-weight: 600; color: var(--sub); margin: 4px 0 -2px; }
  .agc-horas { display: grid; gap: 6px; margin-top: 6px; }
  .agc-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(68px, 1fr)); gap: 6px; }
  .agc-hora, .agc-com { all: unset; box-sizing: border-box; cursor: pointer; display: grid; place-items: center; min-height: 44px; padding: 0 8px; border-radius: 12px; border: 1px solid var(--linha); background: var(--entrada); color: var(--texto); font-size: 14.5px; font-variant-numeric: tabular-nums; }
  .agc-com-linha { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--sub); }
  .agc-mais { all: unset; box-sizing: border-box; cursor: pointer; display: inline-grid; place-items: center; min-height: 44px; font-size: 13px; font-weight: 700; color: var(--marca-azul, #106ebe); padding: 0 8px; }
  html[data-tema="escuro"] .agc-mais { color: var(--marca-menta, #0ffcbe); }
  .agc-com { min-height: 40px; font-size: 13.5px; padding: 0 12px; border-radius: 999px; }
  .agc-dia:focus-visible, .agc-hora:focus-visible, .agc-com:focus-visible, .agc-pilula:focus-visible, .agc-opcao:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 1px; }
  html[data-tema="escuro"] .agc-pilula .agc-trocar { color: var(--marca-menta, #0ffcbe); }
  html[data-tema="escuro"] .agc-pilula { border-color: color-mix(in srgb, var(--marca-menta, #0ffcbe) 40%, transparent); background: color-mix(in srgb, var(--marca-menta, #0ffcbe) 6%, var(--entrada)); }
  html[data-tema="escuro"] .agc-busca:focus-within, html[data-tema="escuro"] .agc-outra.agc-ativa input { border-color: var(--marca-menta, #0ffcbe); box-shadow: none; }
  html[data-tema="escuro"] .agc-opcao[aria-selected="true"] { background: color-mix(in srgb, var(--marca-menta, #0ffcbe) 12%, transparent); }
  html[data-tema="escuro"] #d-agendar input[type=date] { color-scheme: dark; }
  html[data-tema="escuro"] .agc-opcao mark { background: color-mix(in srgb, var(--marca-menta, #0ffcbe) 30%, transparent); }
  @media (max-width: 760px) {
    #d-agendar { width: 100vw; }
    #d-agendar form { padding: 14px 16px 0; gap: 10px; }
    #d-agendar .rodape { margin: 0 -16px; padding-left: 16px; padding-right: 16px; }
    #d-agendar .agc-busca input, #d-agendar .agc-outra input { font-size: 16px; } /* 16 px: o iPhone não dá zoom no campo */
    .agc-dias { gap: 4px; }
    .agc-dia small { font-size: 10.5px; letter-spacing: -.1px; }
    .agc-grade { grid-template-columns: repeat(auto-fill, minmax(60px, 1fr)); }
    .agc-hora { font-size: 14px; padding: 0 4px; }
  }
  @media (hover: hover) { .agc-dia:hover, .agc-hora:hover, .agc-com:hover { border-color: var(--marca-azul, #106ebe); } }
  ` }));

  // ---------------------------------------------------------------- mais usados (servidor) + recentes (este aparelho)
  const usados = new Map(); // unidade -> { servicos: Map(nome -> vezes), profissionais: Map }
  const buscando = new Set();
  function carregarUsados(unidade) {
    if (!unidade || usados.has(unidade) || buscando.has(unidade)) return;
    buscando.add(unidade);
    fetch('/api/agenda/mais-usados?unidade=' + encodeURIComponent(unidade), { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { servicos: [], profissionais: [] }))
      .catch(() => ({ servicos: [], profissionais: [] }))
      .then((j) => {
        const mapa = (l) => new Map((Array.isArray(l) ? l : []).map((x) => [semAcento(x.nome), Number(x.vezes) || 0]));
        usados.set(unidade, { servicos: mapa(j.servicos), profissionais: mapa(j.profissionais) });
        buscando.delete(unidade);
        desenharListas();
      });
  }
  const chaveRec = (tipo) => `sintonia.agendar.recentes.${selUni?.value || '-'}.${tipo}`;
  function recentes(tipo) { try { const v = JSON.parse(localStorage.getItem(chaveRec(tipo)) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
  function lembrar(tipo, nome) {
    try { const l = [semAcento(nome), ...recentes(tipo).filter((x) => x !== semAcento(nome))].slice(0, MAX); localStorage.setItem(chaveRec(tipo), JSON.stringify(l)); } catch { /* sem armazenamento: tudo bem */ }
  }

  // ---------------------------------------------------------------- Serviço e Profissional (até 5 + busca)
  /** O texto do <option> do serviço é "Nome · 60 min · R$ 80,00" (app.html): separa nome e detalhe. */
  function lerServico(o) {
    const m = /^(.*) · (\d+ min · R\$ .*)$/.exec(o.textContent || '');
    return { id: o.value, nome: m ? m[1] : o.textContent, det: m ? m[2] : '' };
  }
  const lerProf = (o) => ({ id: o.value, nome: o.textContent, det: '' });

  function criarSeletor(o) {
    const st = { aberto: false, termo: '' };
    const raiz = el('div', { class: 'agc-campo', id: o.id });
    const rotuloLabel = o.select.closest('label');
    (rotuloLabel || o.select).after(raiz);
    rotuloLabel?.classList.add('agc-oculto');

    const itens = () => [...o.select.options].filter((x) => x.value !== '').map(o.ler);
    const rank = (lista) => {
      const u = usados.get(selUni?.value)?.[o.tipoUsados] || new Map();
      const rec = recentes(o.tipo);
      const pos = (n) => { const i = rec.indexOf(semAcento(n)); return i < 0 ? 99 : i; };
      return lista.slice().sort((a, b) => pos(a.nome) - pos(b.nome) || (u.get(semAcento(b.nome)) || 0) - (u.get(semAcento(a.nome)) || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
    };
    const temHistorico = () => (usados.get(selUni?.value)?.[o.tipoUsados]?.size || 0) + recentes(o.tipo).length > 0;

    function filtrar() {
      const todos = itens();
      const q = semAcento(st.termo);
      if (q.length < MIN_BUSCA) return { lista: rank(todos).slice(0, MAX), total: todos.length, achados: todos.length, buscou: false };
      const partes = q.split(' ').filter(Boolean);
      const achados = todos.filter((i) => { const n = semAcento(i.nome); return partes.every((p) => n.includes(p)); });
      // Quem tem uma palavra que COMEÇA com o que foi digitado vem antes.
      const comeca = (i) => (semAcento(i.nome).split(' ').some((w) => w.startsWith(partes[0])) ? 0 : 1);
      const ord = rank(achados).sort((a, b) => comeca(a) - comeca(b));
      return { lista: ord.slice(0, MAX), total: todos.length, achados: achados.length, buscou: true };
    }

    function realce(nome) {
      const q = semAcento(st.termo);
      if (q.length < MIN_BUSCA) return [nome];
      const p = q.split(' ')[0];
      // procura no texto sem acento, mas recorta no original (mesmo tamanho quando a normalização não muda o comprimento)
      const base = semAcento(nome);
      const i = base.length === nome.length ? base.indexOf(p) : -1;
      if (i < 0) return [nome];
      return [nome.slice(0, i), el('mark', { text: nome.slice(i, i + p.length) }), nome.slice(i + p.length)];
    }

    function escolher(item) {
      o.select.value = item ? item.id : '';
      if (item) lembrar(o.tipo, item.nome);
      st.aberto = false; st.termo = '';
      o.select.dispatchEvent(new Event('change', { bubbles: true }));
      desenhar();
      raiz.querySelector('.agc-pilula')?.focus({ preventScroll: true });
    }

    function desenhar() {
      const atual = o.select.selectedOptions[0];
      const valor = o.select.value;
      const rot = el('div', { class: 'agc-rotulo' }, el('span', { text: o.rotulo }));
      if (o.select.disabled) {
        raiz.replaceChildren(rot, el('div', { class: 'agc-pilula', 'aria-disabled': 'true' }, el('span', { class: 'agc-txt' }, el('b', { text: atual?.textContent || '' }))));
        return;
      }
      if (!st.aberto && (valor || o.qualquer)) {
        const it = valor ? o.ler(atual) : { nome: o.qualquer, det: '' };
        raiz.replaceChildren(rot, el('button', { type: 'button', class: 'agc-pilula', 'aria-label': `${o.rotulo}: ${it.nome}. Trocar`, onclick: () => abrir() },
          el('span', { class: 'agc-txt' }, el('b', { text: it.nome }), it.det ? el('small', { text: it.det }) : null),
          el('span', { class: 'agc-trocar', text: 'trocar' })));
        return;
      }
      const r = filtrar();
      const campo = el('input', { type: 'search', id: `${o.id}-busca`, placeholder: o.placeholder, 'aria-label': o.placeholder, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', value: st.termo });
      campo.addEventListener('input', () => { st.termo = campo.value; desenharLista(); });
      campo.addEventListener('keydown', (e) => {
        // Enter não envia o formulário: escolhe o primeiro da lista. Esc volta para a pílula.
        if (e.key === 'Enter') { e.preventDefault(); const p = filtrar().lista[0]; if (p && (semAcento(st.termo).length >= MIN_BUSCA || filtrar().lista.length === 1)) escolher(p); }
        else if (e.key === 'Escape' && (valor || o.qualquer)) { e.preventDefault(); e.stopPropagation(); st.aberto = false; st.termo = ''; desenhar(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); raiz.querySelector('.agc-opcao')?.focus(); }
      });
      const fechar = (valor || o.qualquer) ? el('button', { type: 'button', class: 'agc-ic', 'aria-label': 'Cancelar a troca', title: 'Cancelar', html: IC.x, onclick: () => { st.aberto = false; st.termo = ''; desenhar(); } }) : null;
      const lista = el('div', { class: 'agc-lista', role: 'listbox', 'aria-label': o.rotulo });
      const nota = el('div', { class: 'agc-nota', 'aria-live': 'polite' });
      raiz.replaceChildren(rot, el('label', { class: 'agc-busca' }, el('span', { html: IC.lupa, style: 'display:grid' }), campo, fechar), lista, nota);
      function desenharLista() {
        const f = filtrar();
        const ops = [];
        if (o.qualquer && !f.buscou) ops.push({ id: '', nome: o.qualquer, det: '' });
        ops.push(...f.lista);
        lista.hidden = !ops.length;
        lista.replaceChildren(...ops.map((it) => el('button', {
          type: 'button', class: 'agc-opcao', role: 'option', 'aria-selected': String(it.id === valor),
          onclick: () => escolher(it.id === '' ? null : it),
          onkeydown: (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.nextElementSibling?.focus(); }
            if (e.key === 'ArrowUp') { e.preventDefault(); (e.currentTarget.previousElementSibling || campo).focus(); }
          },
        }, el('span', {}, ...(it.id === '' ? [it.nome] : realce(it.nome))), it.det ? el('small', { text: it.det.split(' · ')[0] }) : null)));
        const q = semAcento(st.termo);
        let t = '';
        if (!f.total) t = o.vazio;
        else if (f.buscou && !f.achados) t = `Nada com “${st.termo.trim()}”. Tente outra palavra.`;
        else if (f.buscou && f.achados > MAX) t = `Mais ${f.achados - MAX} — continue digitando.`;
        else if (!f.buscou && f.total > MAX) t = q.length ? `Digite ${MIN_BUSCA} letras para buscar entre os ${f.total}.` : `${temHistorico() ? 'Os mais marcados aqui' : 'Os primeiros em ordem alfabética'}. Busque para ver os outros ${f.total - Math.min(MAX, f.total)}.`;
        nota.textContent = t;
        nota.hidden = !t;
      }
      desenharLista();
      if (st.focar) { st.focar = false; campo.focus({ preventScroll: false }); }
    }
    function abrir() { st.aberto = true; st.termo = ''; st.focar = true; desenhar(); }
    function reiniciar() { st.aberto = !o.select.value && !o.qualquer; st.termo = ''; desenhar(); }

    new MutationObserver(() => { if (!o.select.value && !o.qualquer) st.aberto = true; desenhar(); }).observe(o.select, { childList: true, attributes: true, attributeFilter: ['disabled'] });
    o.select.addEventListener('change', () => { if (!st.aberto) desenhar(); });
    return { desenhar, reiniciar };
  }

  const servico = criarSeletor({ id: 'agc-servico', tipo: 'servico', tipoUsados: 'servicos', select: selServ, rotulo: 'Serviço', placeholder: 'Buscar serviço', ler: lerServico, vazio: 'Nenhum serviço disponível nesta unidade.' });
  const prof = criarSeletor({ id: 'agc-prof', tipo: 'prof', tipoUsados: 'profissionais', select: selProf, rotulo: 'Profissional', placeholder: 'Buscar profissional', ler: lerProf, qualquer: 'Qualquer uma', vazio: '' });
  function desenharListas() { servico.desenhar(); prof.desenhar(); }

  // ---------------------------------------------------------------- Data: hoje + próximos dias + "Outra data"
  const DSEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const caixaData = el('div', { class: 'agc-campo', id: 'agc-data' });
  const rotuloData = data.closest('label');
  (rotuloData || data).after(caixaData);
  const outra = el('label', { class: 'agc-outra' }, el('span', { html: IC.cal, style: 'display:grid' }), el('span', { text: 'Outra data' }));
  outra.append(data); // o mesmo campo de sempre (id ag-data), agora aqui
  rotuloData?.classList.add('agc-oculto');
  caixaData.append(outra); // fica no documento desde já: o app.html procura #ag-data antes de abrir
  function desenharData() {
    const base = data.min ? new Date(data.min + 'T12:00:00') : new Date();
    const dias = Array.from({ length: DIAS }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return d; });
    const valor = data.value;
    const grade = el('div', { class: 'agc-dias', role: 'group', 'aria-label': 'Dia' }, ...dias.map((d, i) => {
      const v = iso(d);
      const nome = i === 0 && v === iso(new Date()) ? 'hoje' : i === 1 && dias[0] && iso(dias[0]) === iso(new Date()) ? 'amanhã' : DSEM[d.getDay()];
      return el('button', {
        type: 'button', class: 'agc-dia', 'aria-pressed': String(v === valor), disabled: data.disabled,
        'aria-label': d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }),
        onclick: () => { if (data.value === v) return; data.value = v; data.dispatchEvent(new Event('change', { bubbles: true })); desenharData(); },
      }, el('small', { text: nome }), el('b', { text: String(d.getDate()) }));
    }));
    outra.classList.toggle('agc-ativa', Boolean(valor) && !dias.some((d) => iso(d) === valor));
    caixaData.replaceChildren(el('div', { class: 'agc-rotulo' }, el('span', { text: 'Data' }), valor ? el('small', { text: new Date(valor + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) }) : null), grade, outra);
  }
  data.addEventListener('change', desenharData);
  data.addEventListener('input', desenharData);

  // ---------------------------------------------------------------- Horário: um botão por hora (a profissional depois)
  const horasRotulo = caixaHoras.previousElementSibling; // o "Horário" de sempre
  const caixaHorasNova = el('div', { class: 'agc-horas', id: 'agc-horas', 'aria-live': 'polite' });
  caixaHoras.after(caixaHorasNova);
  caixaHoras.classList.add('agc-oculto');
  if (horasRotulo) { horasRotulo.classList.add('agc-rotulo'); horasRotulo.classList.remove('info'); }
  let horaVista = null; // hora tocada (para mostrar "com quem")
  let verTodasCom = false;
  function desenharHoras() {
    const botoes = [...caixaHoras.querySelectorAll('button')];
    if (!botoes.length) { caixaHorasNova.replaceChildren(...[...caixaHoras.childNodes].map((n) => n.cloneNode(true))); horaVista = null; return; }
    const porHora = new Map();
    for (const b of botoes) {
      const t = b.textContent || '';
      const m = /^(\d{1,2}:\d{2})(?: · (.*))?$/.exec(t.trim());
      if (!m) continue;
      const h = m[1].padStart(5, '0');
      if (!porHora.has(h)) porHora.set(h, []);
      porHora.get(h).push({ b, prof: m[2] || '' });
    }
    const marcado = botoes.find((b) => b.getAttribute('aria-pressed') === 'true');
    const horaMarcada = marcado ? (/^(\d{1,2}:\d{2})/.exec(marcado.textContent.trim())?.[1] || '').padStart(5, '0') : null;
    if (horaMarcada) horaVista = horaMarcada;
    const horas = [...porHora.keys()].sort();
    const turnos = [['Manhã', (h) => h < '12:00'], ['Tarde', (h) => h >= '12:00' && h < '18:00'], ['Noite', (h) => h >= '18:00']];
    const partes = [];
    const ops = horaVista ? porHora.get(horaVista) : null;
    let linhaCom = null;
    if (ops && ops.some((x) => x.prof)) {
      linhaCom = el('div', { class: 'agc-com-linha' }, el('span', { text: ops.length > 1 ? `Às ${horaVista}, com:` : `Às ${horaVista}, com` }));
      if (ops.length === 1) linhaCom.append(el('b', { text: ops[0].prof }));
      else {
        // até 5 (a escolhida sempre entre elas); o resto num "mais N"
        const ord = ops.slice().sort((a, b) => (b.b === marcado) - (a.b === marcado));
        const visiveis = verTodasCom || ord.length <= MAX ? ord : ord.slice(0, MAX - 1);
        linhaCom.append(...visiveis.map((x) => el('button', { type: 'button', class: 'agc-com', 'aria-pressed': String(x.b === marcado), text: x.prof, onclick: () => x.b.click() })));
        if (visiveis.length < ord.length) linhaCom.append(el('button', { type: 'button', class: 'agc-mais', text: `mais ${ord.length - visiveis.length}`, onclick: () => { verTodasCom = true; desenharHoras(); } }));
      }
    }
    for (const [nome, cabe] of turnos) {
      const hs = horas.filter(cabe);
      if (!hs.length) continue;
      partes.push(el('div', { class: 'agc-turno', text: nome }), el('div', { class: 'agc-grade', role: 'group', 'aria-label': nome }, ...hs.map((h) => el('button', {
        type: 'button', class: 'agc-hora', 'aria-pressed': String(h === horaMarcada), text: h,
        onclick: () => {
          const op = porHora.get(h);
          const antes = marcado ? op.find((x) => x.b === marcado) || op.find((x) => marcado.textContent.endsWith(' · ' + x.prof) && x.prof) : null;
          if (horaVista !== h) verTodasCom = false;
          horaVista = h;
          (antes || op[0]).b.click();
        },
      }))));
      if (linhaCom && hs.includes(horaVista)) partes.push(linhaCom);
    }
    caixaHorasNova.replaceChildren(...partes);
  }
  new MutationObserver(desenharHoras).observe(caixaHoras, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });

  // ---------------------------------------------------------------- Unidade: só aparece quando há mais de uma
  function desenharUnidade() {
    const l = selUni?.closest('label'); if (!l) return;
    l.classList.toggle('agc-oculto', selUni.options.length <= 1);
  }
  if (selUni) {
    new MutationObserver(desenharUnidade).observe(selUni, { childList: true });
    selUni.addEventListener('change', () => carregarUsados(selUni.value));
  }

  // ---------------------------------------------------------------- ao abrir
  function aoAbrir() {
    desenharUnidade();
    carregarUsados(selUni?.value);
    servico.reiniciar(); prof.reiniciar();
    desenharData(); desenharHoras();
  }
  new MutationObserver(() => { if (dlg.open) aoAbrir(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  if (dlg.open) aoAbrir();
  window.SintoniaTelas = window.SintoniaTelas || {};
  window.SintoniaTelas.agendarCompacto = { atualizar: aoAbrir };
})();
