/* Tela "agenda" da Sintonia: registra window.SintoniaTelas.agenda = { desenhar(caixa, ui), novo() }.
 * Funciona como o calendário do celular (Material 3): barra com menu ☰ (vistas e filtros), mês ▾ (mini calendário),
 * busca e "hoje"; vistas Programação, Dia, 3 dias, Semana e Mês; arrastar para o lado troca o período; toque num
 * horário vazio começa um agendamento ali; toque num horário marcado abre a folha de detalhes.
 * No computador (≥ 900 px): coluna da esquerda com "Criar", mini calendário e filtros, como a versão web.
 * Fonte: /api/agenda/agendamentos (horários da Sintonia e do sistema do salão, como o Trinks), lida em blocos de 14 dias — só o período à vista
 * e um bloco de cada lado. Estilos em telas/agenda.css (prefixo .ag-). Texto do servidor entra sempre por textContent.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const BLOCO = 14;          // dias por pedido ao servidor
  const INTERVALO = 20000;   // "em tempo real": confere a cada 20 s com a tela aberta
  const CHAVE = 'sintonia.agenda.v2';
  const TZ = 'America/Bahia';
  const N_CORES = 8;
  const VISTAS = [
    ['prog', 'Programação', 'a'],
    ['dia', 'Dia', 'd'],
    ['3dias', '3 dias', 'x'],
    ['semana', 'Semana', 'w'],
    ['mes', 'Mês', 'm'],
  ];
  const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const CURTO = { norte: 'Norte', sumare: 'Sumaré', feira: 'Feira' };
  const NOME_UNI = { norte: 'Salvador Norte Shopping', sumare: 'Shopping Sumaré', feira: 'Feira de Santana' };

  const sv = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const IC = {
    menu: sv('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    seta: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5z" fill="currentColor"/></svg>',
    busca: sv('<circle cx="10.5" cy="10.5" r="6"/><path d="m20 20-5-5"/>'),
    mais: sv('<path d="M12 5v14M5 12h14"/>', ' stroke-width="2.2"'),
    esq: sv('<path d="m14.5 6-6 6 6 6"/>'),
    dir: sv('<path d="m9.5 6 6 6-6 6"/>'),
    voltar: sv('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
    fechar: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
    prog: sv('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    dia: sv('<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9h16"/>'),
    d3: sv('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9.2 4v16M14.8 4v16"/>'),
    semana: sv('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 4v16M12 4v16M16.5 4v16"/>'),
    mes: sv('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.3h17M3.5 14.6h17M9.2 4v16M14.8 4v16"/>'),
    cal: sv('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    relogio: sv('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    tesoura: sv('<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.6 8 20 18M8.6 16 20 6"/>'),
    pessoa: sv('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.9-6 7.5-6s6.7 2.2 7.5 6"/>'),
    local: sv('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>'),
    check: sv('<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.5 2.5 5-5"/>'),
    brilho: sv('<path d="M12 3.5 13.8 9 19.5 11l-5.7 2-1.8 5.5-1.8-5.5L4.5 11l5.7-2Z"/>'),
    tel: sv('<path d="M5 4h3.5l1.6 4.2-2.2 1.4a11 11 0 0 0 6.5 6.5l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/>'),
    conversa: sv('<path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4.5 19.5l1.4-4.2A7.5 7.5 0 1 1 20 11.5Z"/>'),
    marca: sv('<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="15.5" cy="15.2" r="1.6" fill="currentColor" stroke="none"/>'),
  };
  const icHoje = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="16" rx="3"/><path d="M8 3v3M16 3v3" stroke-linecap="round"/><text x="12" y="16.6" text-anchor="middle">${n}</text></svg>`;

  // ---------- datas (horário da Bahia) ----------
  const fPartes = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function local(d) {
    const p = {};
    for (const x of fPartes.formatToParts(d)) p[x.type] = x.value;
    return { iso: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  }
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const hm = (d) => hhmm(local(d).min);
  const idx = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5);
  const deIdx = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
  const somar = (iso, n) => deIdx(idx(iso) + n);
  const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
  const fmt = (iso, o) => new Intl.DateTimeFormat('pt-BR', { ...o, timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
  const inicioSemana = (iso) => somar(iso, -dow(iso));
  const inicioMes = (iso) => iso.slice(0, 8) + '01';
  const somarMes = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 10);
  const nomeMes = (iso) => fmt(iso, { month: 'long' });
  const diaLongo = (iso) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  const semanaCurta = (iso) => fmt(iso, { weekday: 'short' }).replace('.', '');
  const inicioBahia = (iso) => new Date(iso + 'T00:00:00-03:00');

  // ---------- feriados (linha "dia inteiro", como os feriados do calendário) ----------
  const feriadosAno = new Map();
  function pascoa(a) {
    const b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4, g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3);
    const i = (19 * b + c - e - h + 15) % 30, k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451);
    const mes = Math.floor((i + m - 7 * n + 114) / 31), dia = ((i + m - 7 * n + 114) % 31) + 1;
    return `${a}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  function feriado(iso) {
    const ano = +iso.slice(0, 4);
    let m = feriadosAno.get(ano);
    if (!m) {
      m = new Map(Object.entries({
        '01-01': 'Confraternização Universal', '04-21': 'Tiradentes', '05-01': 'Dia do Trabalho', '06-24': 'São João',
        '07-02': 'Independência da Bahia', '09-07': 'Independência do Brasil', '10-12': 'Nossa Senhora Aparecida',
        '11-02': 'Finados', '11-15': 'Proclamação da República', '11-20': 'Dia da Consciência Negra',
        '12-08': 'Nossa Senhora da Conceição da Praia', '12-25': 'Natal',
      }).map(([k, v]) => [`${ano}-${k}`, v]));
      const p = pascoa(ano);
      m.set(somar(p, -48), 'Carnaval');
      m.set(somar(p, -47), 'Carnaval');
      m.set(somar(p, -2), 'Sexta-feira Santa');
      m.set(somar(p, 60), 'Corpus Christi');
      feriadosAno.set(ano, m);
    }
    return m.get(iso) || null;
  }

  // ---------- estado ----------
  const s = {
    caixa: null, ui: null, raiz: null, hoje: local(new Date()).iso, foco: null, vista: 'semana',
    offUni: new Set(), offProf: new Set(), cores: {}, ladoFechado: false,
    unidades: [], conf: {}, erro: null, carregando: 0, timer: null,
    miniAberto: false, miniMes: null, buscando: false, termo: '', rolagem: null, progDias: 42,
    arrastou: false, pc: false, fantasma: null,
  };
  const mqPc = matchMedia('(min-width: 900px)');
  const movimentoReduzido = matchMedia('(prefers-reduced-motion: reduce)');

  try {
    const g = JSON.parse(localStorage.getItem(CHAVE) || '{}');
    if (VISTAS.some(([v]) => v === g.vista)) s.vista = g.vista;
    s.offUni = new Set(g.offUni || []);
    s.offProf = new Set(g.offProf || []);
    s.cores = g.cores && typeof g.cores === 'object' ? g.cores : {};
    s.ladoFechado = Boolean(g.ladoFechado);
  } catch { /* sem armazenamento: segue o padrão */ }
  function guardar() {
    try { localStorage.setItem(CHAVE, JSON.stringify({ vista: s.vista, offUni: [...s.offUni], offProf: [...s.offProf], cores: s.cores, ladoFechado: s.ladoFechado })); } catch { /* ignora */ }
  }

  function estilo() {
    if (document.getElementById('estilo-agenda-g')) return Promise.resolve();
    const l = document.createElement('link');
    l.id = 'estilo-agenda-g';
    l.rel = 'stylesheet';
    l.href = '/telas/agenda.css';
    const pronto = new Promise((r) => { l.onload = r; l.onerror = r; setTimeout(r, 1500); });
    document.head.append(l);
    return pronto;
  }

  // ---------- dados: blocos de 14 dias ----------
  const cache = new Map();   // bloco -> { itens, assin }
  const pend = new Map();
  let porDia = new Map();
  let profs = [];
  const blocoDe = (iso) => Math.floor(idx(iso) / BLOCO);
  const blocoIni = (b) => deIdx(b * BLOCO);
  function blocosEntre(ini, n) { const r = []; for (let b = blocoDe(ini); b <= blocoDe(somar(ini, n - 1)); b++) r.push(b); return r; }

  function buscarBloco(b, forcar) {
    if (!forcar && cache.has(b)) return Promise.resolve(false);
    if (pend.has(b)) return pend.get(b);
    s.carregando++;
    marcarCarregando();
    const p = (async () => {
      const de = blocoIni(b);
      try {
        const r = await s.ui.api(`/api/agenda/agendamentos?de=${de}&dias=${BLOCO}`);
        if (Array.isArray(r.unidades)) s.unidades = r.unidades;
        let conf = {};
        try {
          const a = inicioBahia(de), z = new Date(a.getTime() + BLOCO * 864e5);
          conf = (await s.ui.api(`/api/followup/confirmacoes?de=${encodeURIComponent(a.toISOString())}&ate=${encodeURIComponent(z.toISOString())}`)).status || {};
        } catch { /* a confirmação não segura a agenda */ }
        const assin = JSON.stringify([r.itens, conf, r.aviso || '']);
        const antes = cache.get(b);
        cache.set(b, { itens: r.itens || [], assin, aviso: r.aviso || '' });
        Object.assign(s.conf, conf);
        s.erro = null;
        return !antes || antes.assin !== assin;
      } catch (x) {
        s.erro = x.message || 'Verifique a internet e tente de novo.';
        return !cache.has(b);
      } finally {
        pend.delete(b);
        s.carregando--;
        marcarCarregando();
      }
    })();
    pend.set(b, p);
    return p;
  }

  function reindexar() {
    porDia = new Map();
    const vistos = new Set();
    const nomes = new Set();
    for (const { itens } of cache.values()) {
      for (const i of itens) {
        if (vistos.has(i.id)) continue;
        vistos.add(i.id);
        const l = local(new Date(i.inicio));
        i._dia = l.iso;
        i._min = l.min;
        const f = local(new Date(i.fim));
        i._fimMin = f.iso === l.iso ? f.min : 1440;
        if (!porDia.has(l.iso)) porDia.set(l.iso, []);
        porDia.get(l.iso).push(i);
        if (i.profissional) nomes.add(i.profissional);
      }
    }
    desenharAviso();
    for (const l of porDia.values()) l.sort((a, b) => a._min - b._min || (a.cliente || '').localeCompare(b.cliente || '', 'pt-BR'));
    profs = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    atribuirCores();
  }

  /** Aviso discreto quando o sistema do salão (Trinks…) não respondeu: a agenda segue com o que é da Sintonia. */
  function desenharAviso() {
    if (!s.avisoEl) return;
    const textos = [...new Set([...cache.values()].map((c) => c.aviso).filter(Boolean))];
    s.avisoEl.textContent = textos.join(' ');
    s.avisoEl.hidden = !textos.length;
  }

  /** Cor de cada profissional: fixa no aparelho; a primeira escolha segue o nome (igual para a equipe toda), sem repetir enquanto houver cor livre. */
  function atribuirCores() {
    let mudou = false;
    const usadas = new Set(profs.filter((p) => p in s.cores).map((p) => s.cores[p]));
    for (const p of profs) {
      if (p in s.cores) continue;
      let h = 0;
      for (const ch of p.toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
      let k = h % N_CORES;
      for (let t = 0; t < N_CORES && usadas.has(k); t++) k = (k + 1) % N_CORES;
      s.cores[p] = k;
      usadas.add(k);
      mudou = true;
    }
    if (mudou) guardar();
  }
  const corDe = (nome) => (nome && nome in s.cores ? 'ag-c' + s.cores[nome] : 'ag-cx');

  async function garantir(ini, n, comVizinhos = true) {
    const bs = blocosEntre(ini, n);
    if (comVizinhos) bs.unshift(bs[0] - 1), bs.push(bs[bs.length - 1] + 1);
    const r = await Promise.all(bs.map((b) => buscarBloco(b)));
    if (r.some(Boolean)) {
      reindexar();
      if (visivel()) desenharConteudo();
    }
  }

  const passa = (i) => !s.offUni.has(i.unidade) && !s.offProf.has(i.profissional || '-');
  const doDia = (iso) => (porDia.get(iso) || []).filter(passa);

  // ---------- períodos ----------
  function periodo(vista = s.vista, foco = s.foco) {
    if (vista === 'dia') return { ini: foco, n: 1 };
    if (vista === '3dias') return { ini: foco, n: 3 };
    if (vista === 'semana') return { ini: inicioSemana(foco), n: 7 };
    if (vista === 'mes') {
      const m = inicioMes(foco), ini = inicioSemana(m), ult = somar(somarMes(m, 1), -1);
      return { ini, n: Math.ceil((idx(ult) - idx(ini) + 1) / 7) * 7 };
    }
    return { ini: somar(inicioSemana(foco), -7), n: s.progDias };
  }
  function deslocar(dir) {
    if (s.vista === 'mes') {
      const m = somarMes(inicioMes(s.foco), dir);
      s.foco = inicioMes(s.hoje) === m ? s.hoje : m;
    } else s.foco = somar(s.foco, dir * (s.vista === 'dia' ? 1 : s.vista === '3dias' ? 3 : 7));
  }

  // ---------- montagem ----------
  const el = (...a) => s.ui.el(...a);
  const visivel = () => s.caixa && s.caixa.isConnected && s.caixa.offsetParent !== null;
  function marcarCarregando() { s.raiz?.classList.toggle('ag-carregando', s.carregando > 0); }

  function montar() {
    s.pc = mqPc.matches;
    s.raiz = el('div', { class: 'ag' + (s.ladoFechado ? ' ag-sem-lado' : '') });
    s.lado = el('aside', { class: 'ag-lado', 'aria-label': 'Calendário e filtros' });
    s.barra = el('header', { class: 'ag-barra' });
    s.progresso = el('div', { class: 'ag-progresso', 'aria-hidden': 'true' });
    s.mini = el('div', { class: 'ag-mini-cel', hidden: '' });
    s.avisoEl = el('div', { class: 'ag-faixa', role: 'status', hidden: '' });
    s.conteudo = el('div', { class: 'ag-conteudo' });
    s.fab = el('button', { class: 'ag-fab', type: 'button', 'aria-label': 'Novo agendamento', html: IC.mais, onclick: () => novo() });
    s.raiz.append(s.lado, el('div', { class: 'ag-principal' }, s.barra, s.progresso, s.avisoEl, s.mini, s.conteudo, s.fab));
    s.caixa.replaceChildren(s.raiz);
    ligarArrasto(s.conteudo);
    ligarArrasto(s.mini, true);
    desenharTudo();
  }

  function desenharTudo() {
    if (!s.raiz) return;
    s.raiz.classList.toggle('ag-sem-lado', s.ladoFechado);
    desenharBarra();
    desenharLado();
    desenharMini();
    desenharConteudo();
    desenharAviso();
    marcarCarregando();
  }

  function titulo() {
    const { ini, n } = periodo();
    const ref = s.vista === 'semana' || s.vista === '3dias' ? (s.foco >= ini && s.foco < somar(ini, n) ? s.foco : ini) : s.foco;
    const fim = somar(ini, n - 1);
    if (s.pc && (s.vista === 'semana' || s.vista === '3dias') && ini.slice(0, 7) !== fim.slice(0, 7)) {
      const a = fmt(ini, { month: 'short' }).replace('.', ''), z = fmt(fim, { month: 'short' }).replace('.', '');
      return `${a} – ${z} de ${fim.slice(0, 4)}`;
    }
    const nome = nomeMes(ref);
    if (s.pc) return `${nome.replace(/^./, (c) => c.toUpperCase())} de ${ref.slice(0, 4)}`;
    return ref.slice(0, 4) !== s.hoje.slice(0, 4) ? `${nome} de ${ref.slice(0, 4)}` : nome;
  }

  function avatarEu() {
    const eu = s.ui.estado?.eu || {};
    const ini = String(eu.nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
    const b = el('button', { class: 'ag-eu', type: 'button', 'aria-label': `Sua conta${eu.nome ? ': ' + eu.nome : ''}`, title: eu.nome || 'Conta', text: ini, onclick: () => s.ui.mostrar('configuracoes') });
    try { window.SintoniaFotos?.aplicar(b, eu.id); } catch { /* sem foto */ }
    return b;
  }

  function desenharBarra() {
    const b = s.barra;
    if (s.buscando) {
      const campo = el('input', { class: 'ag-busca-campo', type: 'search', placeholder: 'Buscar cliente, serviço ou profissional', 'aria-label': 'Buscar na agenda', autocomplete: 'off', value: s.termo });
      campo.addEventListener('input', () => { s.termo = campo.value; desenharConteudo(); });
      campo.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); fecharBusca(); } });
      b.replaceChildren(
        el('button', { class: 'ag-ic', type: 'button', 'aria-label': 'Voltar', html: IC.voltar, onclick: fecharBusca }),
        campo,
        s.termo ? el('button', { class: 'ag-ic', type: 'button', 'aria-label': 'Limpar busca', html: IC.fechar, onclick: () => { s.termo = ''; desenharBarra(); desenharConteudo(); } }) : null);
      setTimeout(() => campo.focus(), 0);
      return;
    }
    const menu = el('button', { class: 'ag-ic' + (s.pc ? '' : ' ag-contido'), type: 'button', 'aria-label': s.pc ? (s.ladoFechado ? 'Mostrar menu principal' : 'Esconder menu principal') : 'Abrir menu da agenda', html: IC.menu, onclick: () => (s.pc ? alternarLado() : abrirGaveta()) });
    const busca = el('button', { class: 'ag-ic', type: 'button', 'aria-label': 'Buscar', title: 'Buscar', html: IC.busca, onclick: abrirBusca });
    if (s.pc) {
      const sel = el('select', { class: 'ag-sel-vista', 'aria-label': 'Vista', onchange: (e) => trocarVista(e.target.value) }, ...VISTAS.map(([v, t]) => el('option', { value: v, text: t })));
      sel.value = s.vista;
      const rot = s.vista === 'dia' ? 'dia' : s.vista === 'mes' ? 'mês' : 'período';
      b.replaceChildren(menu,
        el('button', { class: 'ag-bt-hoje', type: 'button', text: 'Hoje', title: diaLongo(s.hoje), onclick: irHoje }),
        el('button', { class: 'ag-ic', type: 'button', 'aria-label': `${rot.replace(/^./, (c) => c.toUpperCase())} anterior`, html: IC.esq, onclick: () => navegar(-1) }),
        el('button', { class: 'ag-ic', type: 'button', 'aria-label': `Próximo ${rot}`, html: IC.dir, onclick: () => navegar(1) }),
        el('h1', { class: 'ag-titulo', text: titulo(), 'aria-live': 'polite' }),
        el('div', { class: 'ag-espaco' }), busca, sel, avatarEu());
      return;
    }
    b.replaceChildren(menu,
      el('button', { class: 'ag-titulo', type: 'button', 'aria-expanded': String(s.miniAberto), 'aria-label': `${titulo()}. ${s.miniAberto ? 'Fechar' : 'Abrir'} calendário do mês`, onclick: alternarMini }, el('span', { text: titulo() }), el('span', { html: IC.seta, style: 'display:grid' })),
      el('div', { class: 'ag-espaco' }),
      el('div', { class: 'ag-pilula' }, busca, el('button', { class: 'ag-ic ag-ic-hoje', type: 'button', 'aria-label': `Ir para hoje, ${diaLongo(s.hoje)}`, title: 'Hoje', html: icHoje(Number(s.hoje.slice(8))), onclick: irHoje })),
      avatarEu());
  }

  // ---------- mini calendário ----------
  function miniMes(mesIso, comSetas) {
    const ini = inicioSemana(mesIso);
    const grade = el('div', { class: 'ag-mm-grade', role: 'grid', 'aria-label': `${nomeMes(mesIso)} de ${mesIso.slice(0, 4)}` }, ...LETRAS.map((l) => el('small', { text: l, 'aria-hidden': 'true' })));
    const { ini: vi, n: vn } = periodo();
    const vfim = somar(vi, vn);
    for (let k = 0; k < 42; k++) {
      const d = somar(ini, k);
      if (k >= 35 && d.slice(0, 7) !== mesIso.slice(0, 7)) break;
      const tem = doDia(d).length > 0;
      const sel = s.vista !== 'prog' && s.vista !== 'mes' ? d >= vi && d < vfim : d === s.foco;
      grade.append(el('button', {
        type: 'button', text: String(+d.slice(8)),
        class: [d.slice(0, 7) !== mesIso.slice(0, 7) ? 'ag-fora' : '', d === s.hoje ? 'ag-hj' : sel ? 'ag-sel' : '', tem ? 'ag-tem' : ''].join(' ').trim(),
        'aria-label': `${diaLongo(d)}${tem ? ', tem horários' : ''}`, 'aria-current': d === s.hoje ? 'date' : null,
        onclick: () => { s.foco = d; if (!s.pc) s.miniAberto = false; desenharTudo(); carregarVisivel(); },
      }));
    }
    const titulo = `${nomeMes(mesIso).replace(/^./, (c) => c.toUpperCase())} de ${mesIso.slice(0, 4)}`;
    return el('div', { class: 'ag-mm' },
      comSetas ? el('div', { class: 'ag-mm-cab' }, el('span', { text: titulo }), el('span', {},
        el('button', { class: 'ag-ic', type: 'button', 'aria-label': 'Mês anterior', html: IC.esq, onclick: () => mudarMini(-1) }),
        el('button', { class: 'ag-ic', type: 'button', 'aria-label': 'Próximo mês', html: IC.dir, onclick: () => mudarMini(1) }))) : null,
      grade);
  }
  function mudarMini(dir) {
    s.miniMes = somarMes(s.miniMes || inicioMes(s.foco), dir);
    garantir(inicioSemana(s.miniMes), 42, false);
    s.pc ? desenharLado() : desenharMini();
  }
  function desenharMini() {
    if (s.pc || !s.miniAberto) { s.mini.hidden = true; s.mini.replaceChildren(); return; }
    s.mini.hidden = false;
    s.mini.replaceChildren(miniMes(s.miniMes || inicioMes(s.foco), false));
  }
  function alternarMini() {
    s.miniAberto = !s.miniAberto;
    s.miniMes = inicioMes(s.foco);
    if (s.miniAberto) garantir(inicioSemana(s.miniMes), 42, false);
    desenharBarra();
    desenharMini();
  }

  // ---------- filtros (gaveta e coluna da esquerda) ----------
  function filtros() {
    const lista = [];
    const unis = s.unidades.length ? s.unidades : [];
    const chk = (cor, texto, ligado, fn, extra) => {
      const i = el('input', { type: 'checkbox' });
      i.checked = ligado;
      i.addEventListener('change', () => fn(i.checked));
      return el('label', { class: 'ag-chk ' + cor }, i, el('span', { text: texto }), extra ? el('em', { text: extra }) : null);
    };
    const aplicar = () => { guardar(); desenharMini(); desenharConteudo(); if (s.pc) desenharLado(); };
    if (unis.length > 1) {
      lista.push(el('div', { class: 'ag-sec', text: 'Unidades' }));
      for (const u of unis) lista.push(chk('ag-uni-' + u.id, CURTO[u.id] ? `${CURTO[u.id]}` : u.nome, !s.offUni.has(u.id), (v) => { v ? s.offUni.delete(u.id) : s.offUni.add(u.id); aplicar(); }, u.nome !== CURTO[u.id] ? u.nome.replace(/^Salvador /, '') : null));
    }
    lista.push(el('div', { class: 'ag-sec', text: 'Profissionais' }));
    if (!profs.length) lista.push(el('div', { class: 'ag-nota', text: 'As profissionais aparecem aqui conforme os horários carregam.' }));
    for (const p of profs) lista.push(chk(corDe(p), p, !s.offProf.has(p), (v) => { v ? s.offProf.delete(p) : s.offProf.add(p); aplicar(); }));
    lista.push(chk('ag-cx', 'Sem profissional', !s.offProf.has('-'), (v) => { v ? s.offProf.delete('-') : s.offProf.add('-'); aplicar(); }));
    lista.push(el('div', { class: 'ag-nota', text: 'Mostra os horários marcados pela Sintonia (IA e botão Agendar) e os marcados direto no sistema do salão, como o Trinks.' }));
    return lista;
  }

  function desenharLado() {
    if (!s.pc) { s.lado.replaceChildren(); return; }
    s.lado.replaceChildren(
      el('div', { class: 'ag-lado-topo' }, el('span', { html: IC.marca, style: 'display:grid' }), el('span', { text: 'Agenda' })),
      el('button', { class: 'ag-criar', type: 'button', html: IC.mais + '<span>Criar</span>', 'aria-label': 'Criar agendamento', onclick: () => novo() }),
      miniMes(s.miniMes || inicioMes(s.foco), true),
      ...filtros());
  }

  function abrirGaveta() {
    const d = el('dialog', { class: 'ag-dlg ag-gaveta', 'aria-label': 'Menu da agenda' });
    const item = ([v, t, tecla]) => el('button', {
      class: 'ag-item', type: 'button', 'aria-current': String(v === s.vista),
      html: { prog: IC.prog, dia: IC.dia, '3dias': IC.d3, semana: IC.semana, mes: IC.mes }[v],
      onclick: () => { d.close(); trocarVista(v); },
    }, el('span', { text: t }), s.pc ? el('kbd', { text: tecla.toUpperCase() }) : null);
    d.append(
      el('div', { class: 'ag-gav-topo' }, el('span', { html: IC.marca, style: 'display:grid' }), el('div', {}, el('span', { text: 'Agenda' }), el('small', { text: 'Sintonia · em tempo real' }))),
      ...VISTAS.map(item),
      el('div', { class: 'ag-div' }),
      ...filtros());
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    d.querySelector('.ag-item[aria-current="true"]')?.focus();
  }

  function alternarLado() { s.ladoFechado = !s.ladoFechado; guardar(); desenharTudo(); }

  // ---------- navegação ----------
  function trocarVista(v) {
    if (v === s.vista) return;
    s.vista = v;
    s.rolagem = null;
    guardar();
    desenharTudo();
    carregarVisivel();
  }
  function irHoje() {
    s.hoje = local(new Date()).iso;
    s.foco = s.hoje;
    s.miniMes = inicioMes(s.hoje);
    s.rolagem = null;
    desenharTudo();
    carregarVisivel();
  }
  /** Troca de período com o deslize (como arrastar com o dedo). */
  function navegar(dir) {
    if (s.vista === 'prog') { deslocar(dir); desenharTudo(); carregarVisivel(); return; }
    const trilhos = [...s.conteudo.querySelectorAll('.ag-trilho')];
    if (!trilhos.length || movimentoReduzido.matches) { deslocar(dir); desenharTudo(); carregarVisivel(); return; }
    soltar(trilhos, dir);
  }
  function soltar(trilhos, dir) {
    s.conteudo.classList.add('ag-anima');
    for (const t of trilhos) t.style.transform = dir ? `translateX(${dir > 0 ? '-66.6667%' : '0%'})` : '';
    let feito = false;
    const fim = () => {
      if (feito) return;
      feito = true;
      s.conteudo.classList.remove('ag-anima');
      if (dir) { deslocar(dir); desenharTudo(); carregarVisivel(); } else for (const t of trilhos) t.style.transform = '';
    };
    trilhos[0].addEventListener('transitionend', fim, { once: true });
    setTimeout(fim, 360);
  }

  /** Arrastar para o lado (dedo ou caneta): o conteúdo acompanha o dedo e troca de período ao soltar. */
  function ligarArrasto(alvo, ehMini) {
    let x0 = 0, y0 = 0, t0 = 0, id = null, modo = null, trilhos = [], largura = 1, dx = 0;
    alvo.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || s.buscando) return;
      if (!ehMini && s.vista === 'prog') return;
      x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); id = e.pointerId; modo = null; dx = 0;
      s.arrastou = false;
    });
    alvo.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const ddx = e.clientX - x0, ddy = e.clientY - y0;
      if (!modo) {
        if (Math.abs(ddx) > 10 && Math.abs(ddx) > Math.abs(ddy) * 1.2) {
          modo = 'h';
          s.arrastou = true;
          trilhos = ehMini ? [] : [...alvo.querySelectorAll('.ag-trilho')];
          largura = (trilhos[0]?.parentElement || alvo).clientWidth || 1;
          try { alvo.setPointerCapture(id); } catch { /* ignora */ }
          tirarFantasma();
        } else if (Math.abs(ddy) > 10) { modo = 'v'; }
      }
      if (modo === 'h') {
        dx = ddx;
        for (const t of trilhos) t.style.transform = `translateX(calc(-33.3333% + ${dx}px))`;
      }
    });
    const acabar = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (modo !== 'h') return;
      const vel = Math.abs(dx) / Math.max(1, performance.now() - t0);
      const dir = Math.abs(dx) > largura * 0.22 || (vel > 0.45 && Math.abs(dx) > 30) ? (dx < 0 ? 1 : -1) : 0;
      setTimeout(() => { s.arrastou = false; }, 60);
      if (ehMini) { if (dir) mudarMini(dir); return; }
      if (!trilhos.length) return;
      soltar(trilhos, dir);
    };
    alvo.addEventListener('pointerup', acabar);
    alvo.addEventListener('pointercancel', acabar);
  }

  // ---------- conteúdo ----------
  function desenharConteudo() {
    if (!s.conteudo) return;
    s.fantasma = null;
    if (s.buscando) return desenharBusca();
    if (s.erro && !cache.size) {
      s.conteudo.replaceChildren(el('div', { class: 'ag-vazio' }, el('span', { html: IC.cal, style: 'width:40px;height:40px;display:grid;color:var(--ag-acento)' }), el('b', { text: 'Não deu para carregar a agenda' }), el('span', { text: s.erro })));
      return;
    }
    if (s.vista === 'mes') return vistaMes();
    if (s.vista === 'prog') return vistaProg();
    return vistaGrade();
  }

  const tituloEv = (i) => [i.cliente || s.ui.formatarTel?.(i.telefone) || i.telefone, i.servico].filter(Boolean).join(' — ');
  const rotuloEv = (i) => `${tituloEv(i)}, ${diaLongo(i._dia)}, das ${hm(new Date(i.inicio))} às ${hm(new Date(i.fim))}${i.profissional ? ', com ' + i.profissional : ''}`;
  const jaFoi = (i) => new Date(i.fim) < new Date();

  /** Colunas lado a lado para horários que se cruzam (como no calendário). */
  function colunas(lista, H) {
    const min = (20 / H) * 60;
    const evs = lista.map((i) => ({ i, a: i._min, z: Math.max(i._fimMin, i._min + min) }));
    const out = [];
    let grupo = [], fimGrupo = -1;
    const fechar = () => {
      const cols = [];
      for (const e of grupo) {
        let c = cols.findIndex((z) => z <= e.a);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = e.z;
        e.col = c;
      }
      for (const e of grupo) e.ncol = cols.length;
      out.push(...grupo);
      grupo = [];
    };
    for (const e of evs) {
      if (grupo.length && e.a >= fimGrupo) fechar();
      grupo.push(e);
      fimGrupo = Math.max(fimGrupo, e.z);
    }
    if (grupo.length) fechar();
    return out;
  }

  function paneCab(ini, n) {
    const p = el('div', { class: 'ag-pcab', style: `--n:${n}` });
    for (let k = 0; k < n; k++) {
      const d = somar(ini, k);
      p.append(el('button', {
        class: 'ag-dcab' + (d === s.hoje ? ' ag-hj' : d < s.hoje ? ' ag-passado' : ''), type: 'button',
        'aria-label': `${diaLongo(d)}${d === s.hoje ? ', hoje' : ''}. Ver o dia`,
        onclick: () => { if (s.arrastou) return; s.foco = d; if (s.vista !== 'dia') trocarVista('dia'); },
      }, el('small', { text: n === 1 ? semanaCurta(d) : LETRAS[dow(d)] }), el('b', { text: String(+d.slice(8)) })));
    }
    return p;
  }
  function paneTodo(ini, n) {
    const p = el('div', { class: 'ag-ptodo', style: `--n:${n}` });
    for (let k = 0; k < n; k++) {
      const d = somar(ini, k);
      const f = feriado(d);
      p.append(el('div', {}, f ? el('button', { class: 'ag-chip ag-cf', type: 'button', text: f, title: f, 'aria-label': `Feriado: ${f}`, onclick: () => s.ui.toast?.(`${diaLongo(d)}: ${f}`) }) : null));
    }
    return p;
  }
  function paneGrade(ini, n, H) {
    const p = el('div', { class: 'ag-pane', style: `--n:${n}` });
    const agora = local(new Date());
    for (let k = 0; k < n; k++) {
      const d = somar(ini, k);
      const col = el('div', { class: 'ag-col', 'data-dia': d });
      for (const e of colunas(doDia(d), H)) {
        const i = e.i;
        const top = (e.a / 60) * H;
        const alt = Math.max(((i._fimMin - i._min) / 60) * H - 2, 18);
        const curto = alt < 36;
        const tempo = curto ? hm(new Date(i.inicio)) : `${hm(new Date(i.inicio))} – ${hm(new Date(i.fim))}`;
        col.append(el('button', {
          class: `ag-ev ${corDe(i.profissional)}${jaFoi(i) ? ' ag-passou' : ''}${curto ? ' ag-curto' : ''}${e.ncol > 1 && n >= 3 ? ' ag-estreito' : ''}`, type: 'button',
          style: `top:${top}px;height:${alt}px;left:calc(${(e.col / e.ncol) * 100}% + 1px);width:calc(${100 / e.ncol}% - 3px)`,
          'aria-label': rotuloEv(i),
          onclick: (ev) => { ev.stopPropagation(); if (!s.arrastou) abrirFolha(i); },
        }, el('b', { text: tituloEv(i) + (curto ? ', ' : '') }), el('span', { text: tempo })));
      }
      if (d === s.hoje) col.append(el('div', { class: 'ag-agora', style: `top:${(agora.min / 60) * H}px`, 'aria-hidden': 'true' }));
      p.append(col);
    }
    return p;
  }
  const trilho = (panes) => el('div', { class: 'ag-janela' }, el('div', { class: 'ag-trilho' }, ...panes));

  function vistaGrade() {
    const H = s.pc ? 48 : 56;
    const { ini, n } = periodo();
    const passo = n;
    const inis = [somar(ini, -passo), ini, somar(ini, passo)];
    const horas = el('div', { class: 'ag-horas', 'aria-hidden': 'true' });
    for (let h = 1; h < 24; h++) horas.append(el('span', { style: `top:${h * H}px`, text: `${String(h).padStart(2, '0')}:00` }));
    const corpo = trilho(inis.map((x) => paneGrade(x, n, H)));
    const rolo = el('div', { class: 'ag-rolo', 'data-vista': s.vista }, el('div', { class: 'ag-g-corpo' }, horas, corpo));
    const raiz = el('div', { class: `ag-g ag-n${n}` },
      el('div', { class: 'ag-g-cab' }, el('div', { class: 'ag-gut' }), trilho(inis.map((x) => paneCab(x, n)))),
      el('div', { class: 'ag-g-todo' }, el('div', { class: 'ag-gut' }), trilho(inis.map((x) => paneTodo(x, n)))),
      rolo);
    // Toque num horário vazio: começa um agendamento ali (de meia em meia hora).
    corpo.addEventListener('click', (e) => {
      if (s.arrastou) return;
      const col = e.target.closest('.ag-col');
      if (!col || e.target !== col || col.parentElement !== corpo.firstChild.children[1]) return;
      const y = e.clientY - col.getBoundingClientRect().top;
      const min = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((y / H) * 60) / 30) * 30));
      novoNoHorario(col, col.dataset.dia, min, H);
    });
    s.conteudo.replaceChildren(raiz);
    // largura da barra de rolagem: o cabeçalho acompanha a grade
    raiz.style.setProperty('--ag-sb', `${rolo.offsetWidth - rolo.clientWidth}px`);
    if (s.rolagem != null) rolo.scrollTop = s.rolagem;
    else {
      const temHoje = s.hoje >= ini && s.hoje < somar(ini, n);
      const alvo = temHoje ? local(new Date()).min / 60 - 1.5 : 7.5;
      rolo.scrollTop = Math.max(0, alvo * H);
      s.rolagem = rolo.scrollTop;
    }
    rolo.addEventListener('scroll', () => { s.rolagem = rolo.scrollTop; }, { passive: true });
  }

  function vistaMes() {
    const m = inicioMes(s.foco);
    const meses = [somarMes(m, -1), m, somarMes(m, 1)];
    const panes = meses.map((mes) => {
      const { ini, n } = periodo('mes', mes);
      const p = el('div', { class: 'ag-pmes', style: `grid-template-rows:repeat(${n / 7}, minmax(0, 1fr))` });
      for (let k = 0; k < n; k++) {
        const d = somar(ini, k);
        p.append(el('div', {
          class: 'ag-mdia' + (d.slice(0, 7) !== mes.slice(0, 7) ? ' ag-fora' : '') + (d === s.hoje ? ' ag-hj' : ''), 'data-dia': d, role: 'button', tabindex: mes === m ? '0' : '-1',
          'aria-label': `${diaLongo(d)}, ${doDia(d).length || 'nenhum'} ${doDia(d).length === 1 ? 'horário' : 'horários'}${feriado(d) ? ', ' + feriado(d) : ''}. Ver o dia`,
          onclick: () => { if (s.arrastou) return; s.foco = d; trocarVista('dia'); },
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.foco = d; trocarVista('dia'); } },
        }, el('b', { text: String(+d.slice(8)) })));
      }
      return p;
    });
    const sem = el('div', { class: 'ag-m-sem', 'aria-hidden': 'true' }, ...LETRAS.map((l, k) => el('small', { text: s.pc ? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][k].toUpperCase() : l })));
    s.conteudo.replaceChildren(el('div', { class: 'ag-m' }, sem, trilho(panes)));
    // Quantas faixas cabem em cada dia depende da altura: mede depois de pôr na tela.
    const celula = panes[1].firstChild;
    const altura = celula ? celula.clientHeight : 80;
    const faixa = s.pc ? 20 : 18;
    const cabem = Math.max(1, Math.floor((altura - 28) / faixa));
    for (const p of panes) {
      for (const c of p.children) {
        const d = c.dataset.dia;
        const f = feriado(d);
        const lista = [...(f ? [{ feriado: f }] : []), ...doDia(d)];
        const mostra = lista.length > cabem ? cabem - 1 : lista.length;
        for (const i of lista.slice(0, mostra)) {
          c.append(i.feriado
            ? el('span', { class: 'ag-mchip ag-cf', text: i.feriado, 'aria-hidden': 'true' })
            : el('span', { class: `ag-mchip ${corDe(i.profissional)}${jaFoi(i) ? ' ag-passou' : ''}`, text: s.pc ? `${hm(new Date(i.inicio))} ${i.cliente || ''}` : i.cliente || i.servico || 'Horário', 'aria-hidden': 'true' }));
        }
        if (lista.length > mostra) c.append(el('span', { class: 'ag-mmais', text: `+${lista.length - mostra}`, 'aria-hidden': 'true' }));
      }
    }
  }

  function cartao(i) {
    return el('button', {
      class: `ag-card ${corDe(i.profissional)}${jaFoi(i) ? ' ag-passou' : ''}`, type: 'button', 'aria-label': rotuloEv(i),
      onclick: () => abrirFolha(i),
    }, el('b', { text: tituloEv(i) }), el('span', { text: `${hm(new Date(i.inicio))} – ${hm(new Date(i.fim))}${i.profissional ? ' · ' + i.profissional : ''}` }));
  }
  function linhaDia(d, itens, f) {
    return el('div', { class: 'ag-pdia' + (d === s.hoje ? ' ag-hj' : ''), 'data-dia': d },
      el('button', { class: 'ag-pdia-data', type: 'button', 'aria-label': `${diaLongo(d)}. Ver o dia`, onclick: () => { s.foco = d; trocarVista('dia'); } },
        el('small', { text: semanaCurta(d) }), el('b', { text: String(+d.slice(8)) })),
      el('div', { class: 'ag-pdia-lista' },
        f ? el('div', { class: 'ag-card ag-feriado ag-cf' }, el('b', { text: f })) : null,
        ...itens.map(cartao),
        d === s.hoje && !itens.length ? el('div', { class: 'ag-livre-hj', text: 'Nenhum horário marcado hoje.' }) : null));
  }

  function vistaProg() {
    const { ini, n } = periodo();
    const lista = el('div', { class: 'ag-prog', 'data-vista': 'prog' });
    let mesAtual = null;
    let semanaAtual = null;
    let alvo = null;
    for (let k = 0; k < n; k++) {
      const d = somar(ini, k);
      if (d.slice(0, 7) !== mesAtual) {
        mesAtual = d.slice(0, 7);
        lista.append(el('div', { class: `ag-banner ag-b${+d.slice(5, 7) % 4}`, text: `${nomeMes(d).replace(/^./, (c) => c.toUpperCase())}${d.slice(0, 4) !== s.hoje.slice(0, 4) ? ' de ' + d.slice(0, 4) : ''}` }));
        semanaAtual = null;
      }
      const sem = inicioSemana(d);
      if (sem !== semanaAtual) {
        semanaAtual = sem;
        const fimS = somar(sem, 6);
        lista.append(el('div', { class: 'ag-semana-rot', text: `${+sem.slice(8)}${sem.slice(5, 7) !== fimS.slice(5, 7) ? ' de ' + fmt(sem, { month: 'short' }).replace('.', '') : ''} – ${+fimS.slice(8)} de ${fmt(fimS, { month: 'short' }).replace('.', '')}` }));
      }
      const itens = doDia(d);
      const f = feriado(d);
      if (itens.length || f || d === s.hoje) {
        const linha = linhaDia(d, itens, f);
        lista.append(linha);
        if (!alvo && d >= s.foco) alvo = linha;
      }
    }
    const fimL = el('div', { class: 'ag-mais-prog', text: 'Carregando mais dias…' });
    lista.append(fimL);
    s.conteudo.replaceChildren(lista);
    if (s.rolagem != null) lista.scrollTop = s.rolagem;
    else if (alvo) { lista.scrollTop = Math.max(0, alvo.offsetTop - 8); s.rolagem = lista.scrollTop; }
    lista.addEventListener('scroll', () => { s.rolagem = lista.scrollTop; }, { passive: true });
    // Rolou até o fim: mais 4 semanas (só os blocos novos).
    const obs = new IntersectionObserver((ent) => {
      if (!ent.some((e) => e.isIntersecting)) return;
      obs.disconnect();
      if (s.progDias >= 7 * 26) { fimL.textContent = 'Mostrando até 6 meses. Use o mini calendário para ir mais longe.'; return; }
      s.progDias += 28;
      const { ini: i2, n: n2 } = periodo();
      garantir(i2, n2, false).then(() => desenharConteudo());
    }, { root: lista, rootMargin: '300px' });
    obs.observe(fimL);
  }

  // ---------- busca ----------
  function abrirBusca() {
    s.buscando = true;
    s.termo = '';
    s.miniAberto = false;
    desenharBarra();
    desenharMini();
    desenharConteudo();
    // Busca de 2 semanas atrás até 8 semanas à frente (blocos de 14 dias, só uma vez).
    garantir(somar(s.hoje, -14), 70, false).then(() => s.buscando && desenharConteudo());
  }
  function fecharBusca() { s.buscando = false; s.termo = ''; desenharTudo(); }
  function desenharBusca() {
    const q = s.termo.trim().toLowerCase();
    const dig = q.replace(/\D/g, '');
    const caixa = el('div', { class: 'ag-res', role: 'region', 'aria-label': 'Resultados da busca' });
    if (!q) {
      caixa.append(el('div', { class: 'ag-nota', text: 'Digite o nome da cliente, o serviço, a profissional ou o telefone. A busca olha de 2 semanas atrás até 8 semanas à frente.' }));
    } else {
      const dias = [...porDia.keys()].sort();
      let achou = 0;
      for (const d of dias) {
        const itens = doDia(d).filter((i) => `${i.cliente || ''} ${i.servico || ''} ${i.profissional || ''}`.toLowerCase().includes(q) || (dig.length >= 3 && String(i.telefone).includes(dig)));
        if (!itens.length) continue;
        achou += itens.length;
        caixa.append(linhaDia(d, itens, null));
      }
      caixa.prepend(el('div', { class: 'ag-nota', 'aria-live': 'polite', text: achou ? `${achou} ${achou === 1 ? 'horário encontrado' : 'horários encontrados'}` : s.carregando ? 'Procurando…' : 'Nada encontrado.' }));
    }
    s.conteudo.replaceChildren(caixa);
  }

  // ---------- folha de detalhes ----------
  function abrirFolha(i) {
    const d = el('dialog', { class: 'ag-dlg ag-folha', 'aria-label': `Horário de ${i.cliente || 'cliente'}` });
    const ini = new Date(i.inicio), fim = new Date(i.fim);
    const passou = jaFoi(i);
    const conf = s.conf[i.id];
    const selo = !passou && conf && window.SintoniaTelas?.followup?.seloConfirmacao ? window.SintoniaTelas.followup.seloConfirmacao(s.ui, conf) : null;
    const linha = (ic, ...filhos) => el('div', { class: 'ag-linha' }, typeof ic === 'string' ? el('span', { html: ic, style: 'display:grid;justify-self:center;color:var(--ag-sub)' }) : ic, el('div', {}, ...filhos));
    const dur = i.duracaoMin >= 60 ? `${Math.floor(i.duracaoMin / 60)} h${i.duracaoMin % 60 ? ' ' + (i.duracaoMin % 60) + ' min' : ''}` : `${i.duracaoMin} min`;
    const tel = i.telefone ? s.ui.formatarTel?.(i.telefone) || i.telefone : '';
    const doSistema = i.fonte && i.fonte !== 'sintonia';
    d.append(
      el('div', { class: 'ag-alca', 'aria-hidden': 'true' }),
      el('div', { class: 'ag-folha-topo' }, el('button', { class: 'ag-ic', type: 'button', 'aria-label': 'Fechar', html: IC.fechar, onclick: () => d.close() })),
      el('div', { class: 'ag-folha-tit ' + corDe(i.profissional) }, el('span', { class: 'ag-quad', 'aria-hidden': 'true' }),
        el('div', {}, el('h2', { text: i.cliente || tel || 'Cliente' }), el('p', { text: `${diaLongo(i._dia)} · ${hm(ini)} – ${hm(fim)}` }, doSistema ? el('span', { class: 'ag-origem', text: i.por || 'Sistema' }) : null))),
      i.servico ? linha(IC.tesoura, el('span', { text: i.servico }), el('small', { text: dur })) : linha(IC.relogio, el('span', { text: dur })),
      linha(el('i', { class: corDe(i.profissional), 'aria-hidden': 'true' }), el('span', { text: i.profissional || 'Sem profissional definida' }), el('small', { text: 'Profissional' })),
      linha(IC.local, el('span', { text: NOME_UNI[i.unidade] || s.ui.UNIDADE?.[i.unidade] || i.unidade }), el('small', { text: 'Unidade' })),
      linha(IC.check, selo || el('span', { text: passou ? 'Já aconteceu' : 'Marcado' }), el('small', { text: selo ? 'Confirmação pelo WhatsApp' : 'Situação' })),
      doSistema
        ? linha(IC.pessoa, el('span', { text: `Marcado direto no ${i.por || 'sistema do salão'}` }), el('small', { text: 'Não foi pela Sintonia' }))
        : linha(i.porIa ? IC.brilho : IC.pessoa, el('span', { text: i.porIa ? 'Agendado pela IA, sozinha, pelo WhatsApp' : `Agendado por ${i.por || 'equipe'}` }), el('small', { text: `Marcado em ${new Date(i.marcadoEm).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` })),
      tel ? linha(IC.tel, el('span', { text: tel })) : null,
      el('div', { class: 'ag-acoes' },
        i.podeAbrir ? el('button', { class: 'ag-bt ag-cheio', type: 'button', html: IC.conversa + '<span>Abrir conversa</span>', onclick: () => { d.close(); s.ui.abrir(i.conversaId); } }) : null,
        i.podeAbrir && s.ui.agendar ? el('button', { class: 'ag-bt ag-borda', type: 'button', html: IC.cal + '<span>Agendar outro horário</span>', onclick: () => { d.close(); s.ui.agendar(i.conversaId); } }) : null),
      el('div', { class: 'ag-aviso', text: i.podeAbrir
        ? `Para remarcar ou cancelar, combine com a cliente na conversa e ajuste no ${doSistema ? i.por : 'Trinks'}.`
        : !i.conversaId ? 'Esta cliente ainda não tem conversa na Sintonia.' : 'Esta conversa é de outra atendente. Você vê o horário, mas não abre a conversa.' }));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => d.remove());
    ligarPuxarParaBaixo(d);
    document.body.append(d);
    d.showModal();
  }

  /** Folha de baixo: puxar para baixo fecha (no celular). */
  function ligarPuxarParaBaixo(d) {
    let y0 = null, dy = 0;
    d.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' || d.scrollTop > 0 || s.pc) return; y0 = e.clientY; dy = 0; });
    d.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); if (dy > 8) d.style.transform = `translateY(${dy}px)`; });
    const fim = () => { if (y0 == null) return; y0 = null; if (dy > 110) d.close(); else d.style.transform = ''; };
    d.addEventListener('pointerup', fim);
    d.addEventListener('pointercancel', fim);
  }

  // ---------- novo agendamento: escolhe a cliente e abre o "Agendar" de sempre ----------
  function tirarFantasma() { s.fantasma?.remove(); s.fantasma = null; }
  function novoNoHorario(col, dia, min, H) {
    tirarFantasma();
    const agora = local(new Date());
    if (dia < agora.iso || (dia === agora.iso && min + 30 <= agora.min)) { s.ui.toast?.('Esse horário já passou. Escolha um horário a partir de agora.'); return; }
    s.fantasma = el('div', { class: 'ag-fantasma', style: `top:${(min / 60) * H}px;height:${H - 2}px`, text: `Novo · ${hhmm(min)}`, 'aria-hidden': 'true' });
    col.append(s.fantasma);
    novo({ dia, min });
  }

  function novo(horario) {
    const ui = s.ui;
    const conversas = (ui.estado.conversas || []).slice().sort((a, b) => new Date(b.ultimaMensagemEm || b.atualizadaEm || 0) - new Date(a.ultimaMensagemEm || a.atualizadaEm || 0));
    const busca = el('input', { type: 'search', placeholder: 'Nome ou telefone da cliente', 'aria-label': 'Buscar cliente', autocomplete: 'off' });
    const res = el('div', { class: 'ag-novo-lista', role: 'listbox', 'aria-label': 'Clientes' });
    const d = el('dialog', { class: 'ag-dlg ag-folha', 'aria-label': 'Novo agendamento' });
    const listar = () => {
      const q = busca.value.trim().toLowerCase();
      const dig = q.replace(/\D/g, '');
      const achados = conversas.filter((c) => !q || (c.nome || '').toLowerCase().includes(q) || (dig.length >= 3 && String(c.telefone).includes(dig))).slice(0, 40);
      res.replaceChildren(...(achados.length
        ? achados.map((c) => el('button', { type: 'button', role: 'option', onclick: () => { d.close(); escolher(c, horario); } },
          ui.avatar(c, 'p'), el('b', { text: ui.nomeDe(c) }), el('span', { text: `${ui.UNIDADE[c.unidade] || c.unidade} · ${ui.NOME_ETAPA[c.etapa] || c.etapa}` })))
        : [el('div', { class: 'ag-nota', text: 'Nenhuma cliente encontrada. A cliente precisa ter uma conversa no CRM (chegou pelo WhatsApp ou foi importada em Leads).' })]));
    };
    busca.addEventListener('input', listar);
    d.append(el('div', { class: 'ag-novo' },
      el('div', {}, el('div', { class: 'ag-alca', 'aria-hidden': 'true' }), el('div', { class: 'ag-folha-topo' }, el('button', { class: 'ag-ic', type: 'button', 'aria-label': 'Fechar', html: IC.fechar, onclick: () => d.close() }))),
      el('div', {}, el('h2', { text: 'Novo agendamento' }), el('p', { text: horario ? `${diaLongo(horario.dia)} · ${hhmm(horario.min)} — escolha a cliente` : 'Escolha a cliente para abrir o Agendar' })),
      el('label', { class: 'ag-novo-busca' }, el('span', { html: IC.busca, style: 'display:grid' }), busca),
      res));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => { d.remove(); tirarFantasma(); });
    document.body.append(d);
    listar();
    d.showModal();
    if (s.pc) busca.focus();
  }

  /** Abre o Agendar de sempre (na conversa) e, se veio de um toque na grade, já põe o dia e procura a hora escolhida. */
  async function escolher(c, horario) {
    const ui = s.ui;
    if (!ui.agendar) { ui.abrir(c.id); return; }
    await ui.agendar(c.id);
    if (!horario) return;
    const data = document.getElementById('ag-data');
    const caixa = document.getElementById('ag-horarios');
    if (!data || data.disabled) return;
    if (horario.dia >= (data.min || '')) { data.value = horario.dia; data.dispatchEvent(new Event('change')); }
    if (!caixa) return;
    const hora = hhmm(horario.min);
    const marcar = () => {
      if (data.value !== horario.dia) return false;
      const b = [...caixa.querySelectorAll('button')].find((x) => x.textContent.startsWith(hora));
      if (b && b.getAttribute('aria-pressed') !== 'true') { b.click(); b.scrollIntoView?.({ block: 'nearest' }); return true; }
      return false;
    };
    const obs = new MutationObserver(() => { if (marcar()) obs.disconnect(); });
    obs.observe(caixa, { childList: true });
    setTimeout(() => obs.disconnect(), 60000);
    document.getElementById('d-agendar')?.addEventListener('close', () => obs.disconnect(), { once: true });
  }

  // ---------- teclado (computador) ----------
  function teclado(e) {
    if (!visivel() || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'k') { e.preventDefault(); navegar(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'j') { e.preventDefault(); navegar(1); }
    else if (e.key === 't') { e.preventDefault(); irHoje(); }
    else if (e.key === '/') { e.preventDefault(); abrirBusca(); }
    else if (e.key === 'c') { e.preventDefault(); novo(); }
    else {
      const v = VISTAS.find(([, , tecla]) => tecla === e.key.toLowerCase());
      if (v) { e.preventDefault(); trocarVista(v[0]); }
    }
  }

  // ---------- carregar e atualizar ----------
  function carregarVisivel() {
    const { ini, n } = periodo();
    return garantir(ini, n, s.vista !== 'prog');
  }
  async function atualizar() {
    const novoHoje = local(new Date()).iso;
    if (novoHoje !== s.hoje) { s.hoje = novoHoje; desenharTudo(); }
    const { ini, n } = periodo();
    const r = await Promise.all(blocosEntre(ini, Math.min(n, 70)).map((b) => buscarBloco(b, true)));
    if (r.some(Boolean)) { reindexar(); if (visivel() && !document.querySelector('dialog.ag-dlg[open]')) desenharConteudo(); }
    else moverAgora();
  }
  function moverAgora() {
    const H = s.pc ? 48 : 56;
    const m = local(new Date()).min;
    s.conteudo?.querySelectorAll('.ag-agora').forEach((a) => { a.style.top = `${(m / 60) * H}px`; });
  }

  let ligado = false;
  function ligarUmaVez() {
    if (ligado) return;
    ligado = true;
    document.addEventListener('keydown', teclado);
    let t = null;
    addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!visivel()) return;
        if (mqPc.matches !== s.pc) { s.pc = mqPc.matches; s.rolagem = null; s.miniAberto = false; desenharTudo(); }
        else if (s.vista !== 'prog') desenharConteudo();
      }, 150);
    });
  }

  window.SintoniaTelas.agenda = {
    /** Novo agendamento (escolhe a cliente e abre o Agendar). Precisa da tela já desenhada uma vez (s.ui). */
    novo: () => { if (s.ui) novo(); },
    async desenhar(caixa, ui) {
      s.ui = ui;
      s.caixa = caixa;
      caixa.classList.add('ag-caixa');
      const hoje = local(new Date()).iso;
      if (hoje !== s.hoje || !s.foco) { s.hoje = hoje; s.foco = hoje; }
      s.buscando = false;
      s.miniAberto = false;
      s.rolagem = null;
      ligarUmaVez();
      await estilo();
      montar();
      clearInterval(s.timer);
      s.timer = setInterval(() => {
        if (!visivel()) { clearInterval(s.timer); s.timer = null; return; }
        if (!document.hidden) atualizar();
      }, INTERVALO);
      await carregarVisivel();
      reindexar();
      desenharTudo();
    },
  };
})();
