/* etapa-entrada: o que acontece quando o lead entra numa etapa do Pipeline (o ícone de automação da coluna).
 * Registra:
 * - window.SintoniaEtapaFixa = { eh(etapa), cadeado() }: a "Entrada de leads" (etapa fixa, chave 'entrada') e o
 *   cadeadinho que aparece ao lado do nome dela (dica "Etapa fixa") nas colunas, na lista, no Foco e no celular.
 * - window.SintoniaTelas.etapaAcoes = { abrir({ funil, etapa, aoMudar }) }: a caixa "Quando o lead entrar nesta etapa…"
 *   com as automações e bots que já estão ligados à etapa (liga/desliga e editar) e uma grade de opções para criar:
 *   cada uma abre o criador certo (automação simples ou bot) já com o gatilho da etapa preenchido.
 * Sem exemplos prontos (dono 21/11): os passos nascem vazios e a pessoa escreve.
 * Todo texto que vem do servidor entra por textContent, nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const L = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    cadeado: L('<rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'),
    simples: L('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>'),
    bot: L('<rect x="4" y="8" width="16" height="12" rx="4"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>'),
    ia: L('<path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9Z"/><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z"/>'),
    sequencia: L('<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v4a2.5 2.5 0 0 1-2.5 2.5H9l-3 2.5V13h0a2.5 2.5 0 0 1-2-2.5Z"/><circle cx="17.5" cy="16.5" r="3.5"/><path d="M17.5 15v1.6l1 .9"/>'),
    email: L('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/>'),
    tarefa: L('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    webhook: L('<path d="M10 14a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.1-1.1"/>'),
    mover: L('<path d="M4 12h12M12 7l5 5-5 5"/><path d="M20 5v14"/>'),
    nps: L('<path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8Z"/>'),
    rodizio: L('<path d="M19.5 8.5A8 8 0 0 0 5 7.5M4.5 15.5A8 8 0 0 0 19 16.5"/><path d="M19.5 4v4.5H15M4.5 20v-4.5H9"/>'),
    fechar: L('<path d="M6 6l12 12M18 6 6 18"/>'),
    seta: L('<path d="m9 6 6 6-6 6"/>'),
    mais: L('<path d="M12 5v14M5 12h14"/>'),
  };

  const ehEntrada = (e) => Boolean(e && e.chaveSistema === 'entrada');
  /** O cadeadinho da etapa fixa (dica "Etapa fixa"). */
  function cadeado() {
    estiloGlobal();
    const s = document.createElement('span');
    s.className = 'ea-cadeado';
    s.title = 'Etapa fixa: não muda de nome nem sai do lugar';
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', 'Etapa fixa');
    s.innerHTML = IC.cadeado;
    return s;
  }
  window.SintoniaEtapaFixa = { eh: ehEntrada, cadeado };

  // ---------- estilo ----------
  function estiloGlobal() {
    if (document.getElementById('estilo-etapa-fixa')) return;
    const st = document.createElement('style');
    st.id = 'estilo-etapa-fixa';
    st.textContent = `
  .ea-cadeado { display: inline-grid; place-items: center; flex: none; width: 15px; height: 15px; margin-left: 5px; color: var(--sub); vertical-align: -2px; cursor: help; }
  .ea-cadeado svg { width: 100%; height: 100%; }`;
    document.head.append(st);
  }
  function estilo() {
    estiloGlobal();
    if (document.getElementById('estilo-etapa-acoes')) return;
    const st = document.createElement('style');
    st.id = 'estilo-etapa-acoes';
    st.textContent = `
  dialog.ea-caixa { width: min(980px, calc(100vw - 24px)); max-width: none; max-height: calc(100dvh - 32px); padding: 0; border-radius: 26px; overflow: auto; border: 1px solid var(--ea-borda); background: var(--fundo, #fff); color: var(--texto); box-shadow: 0 30px 80px rgba(4,23,43,.35); }
  dialog.ea-caixa:focus { outline: none; }
  dialog.ea-caixa { --ea-cartao: #f3f6fa; --ea-borda: rgba(13,34,64,.10); }
  html[data-tema="escuro"] dialog.ea-caixa { --ea-cartao: rgba(255,255,255,.06); --ea-borda: rgba(255,255,255,.12); }
  dialog.ea-caixa::backdrop { background: rgba(4,23,43,.45); }
  .ea-topo { display: flex; align-items: flex-start; gap: 12px; padding: 18px 16px 10px 22px; }
  .ea-topo-txt { flex: 1; min-width: 0; display: grid; gap: 4px; }
  .ea-topo h2 { margin: 0; display: flex; align-items: center; gap: 8px; font-family: var(--fonte-titulo); font-size: 22px; letter-spacing: -.02em; }
  .ea-topo h2 .ea-pt { width: 11px; height: 11px; border-radius: 50%; background: var(--cor, #8B8D98); flex: none; }
  .ea-topo p { margin: 0; color: var(--sub); font-size: 14px; line-height: 1.45; }
  .ea-x { all: unset; cursor: pointer; flex: none; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: var(--sub); background: var(--ea-cartao); box-shadow: inset 0 0 0 1px var(--ea-borda); }
  .ea-x svg { width: 18px; height: 18px; }
  .ea-x:focus-visible, .ea-op:focus-visible, .ea-item:focus-visible, .ea-quando button:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 2px; }
  .ea-corpo { padding: 4px 22px 24px; display: grid; gap: 18px; }
  .ea-sec { display: grid; gap: 10px; }
  .ea-sec-t { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--sub); }
  .ea-n { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; font-size: 12px; font-weight: 700; letter-spacing: 0; background: #0d2240; color: #fff; }
  html[data-tema="escuro"] .ea-n { background: #fff; color: #0d2240; }
  .ea-quando { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--ea-cartao); box-shadow: inset 0 0 0 1px var(--ea-borda); justify-self: start; max-width: 100%; }
  .ea-quando button { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 999px; font-size: 14px; font-weight: 600; color: var(--sub); white-space: nowrap; }
  .ea-quando button[aria-pressed="true"] { background: #0d2240; color: #fff; }
  html[data-tema="escuro"] .ea-quando button[aria-pressed="true"] { background: #fff; color: #0d2240; }
  .ea-grade { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
  .ea-op { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 1fr; gap: 6px; align-content: start; padding: 14px; border-radius: 18px; background: var(--ea-cartao); box-shadow: inset 0 0 0 1px var(--ea-borda); min-height: 128px; transition: box-shadow .15s ease, transform .15s ease; }
  .ea-op:hover:not([aria-disabled="true"]) { box-shadow: inset 0 0 0 1.5px var(--marca-azul, #106ebe); }
  .ea-op:active:not([aria-disabled="true"]) { transform: scale(.98); }
  .ea-op .ea-ic { width: 40px; height: 40px; margin-bottom: 2px; border-radius: 12px; display: grid; place-items: center; color: var(--marca-azul, #106ebe); background: color-mix(in srgb, var(--marca-azul, #106ebe) 12%, transparent); }
  html[data-tema="escuro"] .ea-op .ea-ic { color: #9fd0ff; background: rgba(159,208,255,.12); }
  .ea-op .ea-ic svg { width: 22px; height: 22px; }
  .ea-op b { font-size: 15px; line-height: 1.2; }
  .ea-op small { font-size: 12.5px; line-height: 1.35; color: var(--sub); }
  .ea-op[aria-disabled="true"] { cursor: default; opacity: .55; }
  .ea-op .ea-breve { justify-self: start; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--ea-cartao); box-shadow: inset 0 0 0 1px var(--ea-borda); color: var(--sub); }
  .ea-lista { display: grid; gap: 8px; }
  .ea-item { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 14px; border-radius: 16px; background: var(--ea-cartao); box-shadow: inset 0 0 0 1px var(--ea-borda); }
  .ea-item .ea-ic { flex: none; width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; color: var(--sub); background: color-mix(in srgb, var(--sub) 12%, transparent); }
  .ea-item .ea-ic svg { width: 19px; height: 19px; }
  .ea-item-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .ea-item-txt b { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ea-item-txt small { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ea-item .ea-seta { flex: none; width: 18px; height: 18px; color: var(--sub); }
  .ea-chave { appearance: none; -webkit-appearance: none; margin: 0; flex: none; width: 46px; height: 28px; border-radius: 999px; background: color-mix(in srgb, var(--sub) 22%, transparent); position: relative; cursor: pointer; transition: background .2s ease; }
  .ea-chave::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); transition: transform .2s ease; }
  .ea-chave:checked { background: var(--marca-azul, #106ebe); }
  .ea-chave:checked::after { transform: translateX(18px); }
  .ea-chave:focus-visible { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 2px; }
  .ea-vazio { padding: 12px 14px; border-radius: 16px; font-size: 14px; color: var(--sub); border: 1px dashed var(--ea-borda); }
  .ea-fixa { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 16px; font-size: 13.5px; line-height: 1.45; color: var(--texto); background: color-mix(in srgb, #94a3b8 14%, transparent); }
  .ea-fixa .ea-cadeado { margin: 1px 0 0; width: 17px; height: 17px; }
  @media (max-width: 1100px) and (min-width: 761px) { .ea-grade { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  @media (max-width: 760px) {
    dialog.ea-caixa { width: 100vw; max-height: 92dvh; margin: auto auto 0; border-radius: 24px 24px 0 0; padding-bottom: env(safe-area-inset-bottom); }
    .ea-topo { padding: 16px 14px 8px 18px; }
    .ea-corpo { padding: 4px 16px 22px; }
    .ea-grade { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .ea-op { padding: 12px; min-height: 112px; }
    .ea-op .ea-ic { width: 36px; height: 36px; }
    .ea-quando { justify-self: stretch; }
    .ea-quando button { flex: 1; text-align: center; padding: 8px 6px; font-size: 13.5px; }
  }`;
    document.head.append(st);
  }

  const UI = () => window.Sintonia.ui;
  const horasTexto = (h) => (h % 24 === 0 ? `${h / 24} dia${h === 24 ? '' : 's'}` : `${h} h`);

  /**
   * Opções da grade. `tipo`: 'auto' = automação simples (passosTipos = passos que já nascem, vazios);
   * 'bot' = bot (blocos já ligados, vazios). Tudo usa o que já existe no servidor.
   */
  const OPCOES = [
    { id: 'simples', ic: IC.simples, nome: 'Automação simples', info: 'Passos em lista: mensagem, esperar, mover…', tipo: 'auto', passos: ['enviar_mensagem'] },
    { id: 'bot', ic: IC.bot, nome: 'Bot (fluxo)', info: 'Conversa guiada com menu, perguntas e caminhos', tipo: 'bot', blocos: [] },
    { id: 'ia', ic: IC.ia, nome: 'Agente de IA', info: 'Um agente do estúdio conduz com um objetivo', tipo: 'bot', blocos: ['agente_ia'] },
    { id: 'sequencia', ic: IC.sequencia, nome: 'Sequência de follow-up', info: 'Mensagens com espera entre elas', tipo: 'auto', passos: ['enviar_mensagem', 'esperar', 'enviar_mensagem'] },
    { id: 'email', ic: IC.email, nome: 'E-mail', info: 'Manda um modelo do E-mail marketing', tipo: 'auto', passos: ['enviar_email'] },
    { id: 'tarefa', ic: IC.tarefa, nome: 'Tarefa para a equipe', info: 'Cria uma tarefa na Rotina de quem atende', tipo: 'auto', passos: ['criar_tarefa'] },
    { id: 'webhook', ic: IC.webhook, nome: 'Webhook / integração', info: 'Avisa outro sistema com os dados do lead', tipo: 'bot', blocos: ['webhook'] },
    { id: 'mover', ic: IC.mover, nome: 'Mover, etiqueta ou responsável', info: 'Atalho: escolha o que fazer', tipo: 'auto', passos: [] },
    { id: 'nps', ic: IC.nps, nome: 'Pesquisa de satisfação', info: 'Pergunta a nota de 0 a 10', tipo: 'auto', passos: ['pesquisa_nps'] },
    { id: 'rodizio', ic: IC.rodizio, nome: 'Distribuir no rodízio', info: 'Passa para a próxima pessoa da vez', tipo: 'auto', passos: ['distribuir_rodizio'] },
  ];

  async function abrir({ funil, etapa, aoMudar } = {}) {
    if (!etapa) return;
    const ui = UI(); const { el } = ui;
    estilo();
    const A = window.SintoniaTelas.automacoes;
    const B = window.SintoniaTelas.bot;
    if (!A) { ui.toast('As automações ainda estão carregando.'); return; }
    const funilId = funil && !funil.sistema ? funil.id : null;
    const st = { quando: 'entrou', autos: [], bots: [] };
    const depois = () => { if (aoMudar) aoMudar(); };

    const d = el('dialog', { class: 'ea-caixa', tabindex: '-1', 'aria-label': `Automações da etapa ${etapa.nome}` });
    const fechar = () => d.close();
    const titulo = el('h2', {}, el('span', { class: 'ea-pt', style: `--cor:${etapa.cor || '#8B8D98'}` }), el('span', { text: etapa.nome }));
    if (ehEntrada(etapa)) titulo.append(cadeado());
    const sub = el('p', { text: ehEntrada(etapa) ? 'Quando o lead chegar (todo lead novo entra aqui)…' : 'Quando o lead entrar nesta etapa…' });
    d.append(el('div', { class: 'ea-topo' }, el('div', { class: 'ea-topo-txt' }, titulo, sub), el('button', { class: 'ea-x', type: 'button', 'aria-label': 'Fechar', html: IC.fechar, onclick: fechar })));
    const corpo = el('div', { class: 'ea-corpo' });
    d.append(corpo);

    const secLista = el('div', { class: 'ea-sec' });
    const secCriar = el('div', { class: 'ea-sec' });
    if (ehEntrada(etapa)) {
      const c = cadeado(); c.removeAttribute('title');
      corpo.append(el('div', { class: 'ea-fixa' }, c, el('span', { text: 'Etapa fixa de todo funil. Todo lead novo chega aqui (WhatsApp, formulário, API, planilha) e vai para a etapa seguinte quando alguém da equipe ou a IA responde, ou quando alguém mover. O nome não muda e ela fica sempre em primeiro; automações podem.' })));
    }
    corpo.append(secLista, secCriar);

    const nomeNovo = () => (st.quando === 'parada' ? `Parada em ${etapa.nome}` : `Ao entrar em ${etapa.nome}`);
    const gatilho = () => (st.quando === 'parada' ? { tipo: 'parada_na_etapa', etapaId: etapa.id, horas: 24 } : { tipo: 'entrou_na_etapa', etapaId: etapa.id });

    async function carregar() {
      const [autos, bots] = await Promise.all([ui.api('/api/automacoes').catch(() => []), B ? ui.api('/api/bots').catch(() => []) : Promise.resolve([])]);
      st.autos = (Array.isArray(autos) ? autos : []).filter((a) => a.gatilho && a.gatilho.etapaId === etapa.id && (a.gatilho.tipo === 'entrou_na_etapa' || a.gatilho.tipo === 'parada_na_etapa'));
      st.bots = (Array.isArray(bots) ? bots : []).filter((b) => b.gatilho && b.gatilho.tipo === 'entrou_na_etapa' && b.gatilho.etapaId === etapa.id);
    }

    function chave(ligada, rotulo, aoMudar) {
      const c = el('input', { type: 'checkbox', class: 'ea-chave', role: 'switch', 'aria-label': rotulo });
      c.checked = !!ligada;
      c.addEventListener('click', (e) => e.stopPropagation());
      c.addEventListener('change', () => aoMudar(c.checked, c));
      return c;
    }
    function item({ ic, nome, info, ligada, ligar, editar }) {
      const sw = chave(ligada, `Ligar ou desligar ${nome}`, ligar);
      const b = el('div', { class: 'ea-item', role: 'button', tabindex: '0', onclick: editar, onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) editar(); } },
        el('span', { class: 'ea-ic', html: ic }), el('span', { class: 'ea-item-txt' }, el('b', { text: nome }), el('small', { text: info })), sw, el('span', { class: 'ea-seta', html: IC.seta, 'aria-hidden': 'true' }));
      return b;
    }

    function desenharLista() {
      const n = st.autos.length + st.bots.length;
      const t = el('div', { class: 'ea-sec-t' }, el('span', { text: 'Nesta etapa' }));
      if (n) t.append(el('span', { class: 'ea-n', text: String(n) }));
      const lista = el('div', { class: 'ea-lista' });
      for (const a of st.autos) {
        const quando = a.gatilho.tipo === 'parada_na_etapa' ? `Parada há ${horasTexto(a.gatilho.horas || 24)}` : 'Ao entrar';
        lista.append(item({
          ic: IC.simples, nome: a.nome, info: `${quando} · automação · ${(a.passos || []).length} passo${(a.passos || []).length === 1 ? '' : 's'}`, ligada: a.ligada,
          ligar: async (v, c) => { try { const r = await ui.post(`/api/automacoes/${a.id}/${v ? 'ligar' : 'desligar'}`); a.ligada = r.ligada; ui.toast(a.ligada ? `“${a.nome}” ligada` : `“${a.nome}” desligada`); depois(); } catch (x) { c.checked = !v; ui.toast(x.message); } },
          editar: () => { fechar(); A.abrirEditor({ automacao: a, aoSalvar: depois }); },
        }));
      }
      for (const b of st.bots) {
        lista.append(item({
          ic: IC.bot, nome: b.nome, info: `Ao entrar · bot${b.publicadoEm ? '' : ' · rascunho (publique no editor)'}`, ligada: b.ligado,
          ligar: async (v, c) => { try { const r = await ui.post(`/api/bots/${b.id}/${v ? 'ligar' : 'desligar'}`); b.ligado = r.ligado ?? v; ui.toast(b.ligado ? `“${b.nome}” ligado` : `“${b.nome}” desligado`); depois(); } catch (x) { c.checked = !v; ui.toast(x.message); } },
          editar: () => { fechar(); B.abrirEditor(b.id, depois); },
        }));
      }
      if (!n) lista.append(el('div', { class: 'ea-vazio', text: 'Nada ligado a esta etapa ainda. Escolha abaixo o que deve acontecer.' }));
      secLista.replaceChildren(t, lista);
    }

    function desenharCriar() {
      const seg = el('div', { class: 'ea-quando', role: 'group', 'aria-label': 'Quando' },
        ...[['entrou', 'Ao entrar na etapa'], ['parada', 'Parada há um tempo']].map(([k, n]) => el('button', { type: 'button', 'aria-pressed': String(st.quando === k), text: n, onclick: () => { if (st.quando === k) return; st.quando = k; desenharCriar(); } })));
      const grade = el('div', { class: 'ea-grade' });
      for (const o of OPCOES) {
        // Bots começam ao entrar na etapa (o gatilho "parada" é só da automação simples).
        const semBot = o.tipo === 'bot' && !B;
        const soAoEntrar = o.tipo === 'bot' && st.quando === 'parada';
        const desligada = semBot || soAoEntrar;
        const b = el('button', { class: 'ea-op', type: 'button', 'aria-disabled': desligada ? 'true' : null, title: soAoEntrar ? 'Bots começam quando o lead entra na etapa' : o.info },
          el('span', { class: 'ea-ic', html: o.ic }), el('b', { text: o.nome }), el('small', { text: soAoEntrar ? 'Só “ao entrar na etapa”' : o.info }));
        if (semBot) b.append(el('span', { class: 'ea-breve', text: 'Em breve' }));
        b.addEventListener('click', () => { if (!desligada) criar(o); });
        grade.append(b);
      }
      secCriar.replaceChildren(el('div', { class: 'ea-sec-t' }, el('span', { text: 'Criar' })), seg, grade);
    }

    function criar(o) {
      fechar();
      if (o.tipo === 'bot') {
        B.novoBot({ nome: `${o.id === 'bot' ? 'Bot' : o.nome} · ${etapa.nome}`, gatilho: { tipo: 'entrou_na_etapa', etapaId: etapa.id }, blocos: o.blocos, aoMudar: depois,
          dica: o.blocos.length ? `Começa quando o lead entrar em “${etapa.nome}”, já com o bloco ${o.nome}. Você preenche no editor.` : undefined });
        return;
      }
      A.abrirEditor({ funilId, gatilho: gatilho(), nome: o.id === 'simples' ? nomeNovo() : `${o.nome} · ${etapa.nome}`, passosTipos: o.passos, aoSalvar: depois });
    }

    desenharCriar();
    secLista.replaceChildren(el('div', { class: 'ea-sec-t' }, el('span', { text: 'Nesta etapa' })), el('div', { class: 'ea-vazio', text: 'Carregando…' }));
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => { if (e.target === d) fechar(); });
    document.body.append(d);
    d.showModal();
    d.focus(); // sem anel de foco no X ao abrir
    try { await carregar(); } catch { /* sem lista: só a grade */ }
    desenharLista();
  }

  window.SintoniaTelas.etapaAcoes = { abrir };
})();
