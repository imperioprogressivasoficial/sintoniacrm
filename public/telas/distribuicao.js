/* automacao-vendas: Atendimento › Distribuição e prazos (gestão).
 * - Rodízio automático de leads por unidade (/api/rodizio): ligado/desligado, regra (rodízio justo ou menor carga) e
 *   quem participa. Conversa nova de cliente vai sozinha para quem está "Disponível para atender".
 * - Prazos de resposta (SLA) por unidade: primeira resposta e por etapa do funil, e quando escalar para a gerência.
 *   Reaproveita as regras de espera que já existem (/api/espera/regras; os mesmos alertas do sino e da faixa).
 * Registra window.SintoniaTelas.distribuicao = { desenhar(caixa, ui) }. Texto do servidor entra por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .dz { width: 100%; min-width: 0; display: grid; gap: 16px; }
  .dz-topo h1 { margin: 0; font-size: 28px; letter-spacing: -.01em; }
  .dz-topo p { margin: 4px 0 0; color: var(--sub); font-size: 14.5px; max-width: 760px; }
  .dz-unidade { border-radius: 24px; padding: 18px; display: grid; gap: 16px; background: var(--vidro-fundo, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)), var(--vidro-brilho, none); min-width: 0; }
  .dz-unidade > h2 { margin: 0; font-size: 19px; display: flex; align-items: center; gap: 10px; }
  .dz-grade { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 980px) { .dz-grade { grid-template-columns: 1fr; } }
  .dz-bloco { display: grid; gap: 12px; padding: 14px; border-radius: 18px; background: var(--vidro-item, var(--fundo)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); min-width: 0; }
  .dz-bloco h3 { margin: 0; font-size: 15.5px; display: flex; align-items: center; gap: 8px; }
  .dz-bloco h3 svg { width: 19px; height: 19px; flex: none; color: var(--marca-azul, #106ebe); }
  html[data-tema="escuro"] .dz-bloco h3 svg { color: var(--marca-menta, #0ffcbe); }
  .dz-dica { margin: 0; font-size: 12.5px; line-height: 1.4; color: var(--sub); }
  .dz-linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
  .dz-linha > span { display: grid; gap: 2px; min-width: 0; font-size: 14.5px; font-weight: 600; }
  .dz-linha > span small { font-weight: 500; font-size: 12.5px; color: var(--sub); }
  .dz-chave { position: relative; flex: none; width: 46px; height: 28px; }
  .dz-chave input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; z-index: 1; }
  .dz-chave i { position: absolute; inset: 0; border-radius: 999px; background: var(--linha, #cfd8e3); transition: background .2s; }
  .dz-chave i::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
  .dz-chave input:checked + i { background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .dz-chave input:checked + i::after { transform: translateX(18px); }
  .dz-chave input:focus-visible + i { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; }
  .dz-chave input:disabled { cursor: default; }
  .dz-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px; border-radius: 16px; background: var(--vidro-borda, rgba(13,34,64,.06)); }
  .dz-seg button { all: unset; cursor: pointer; box-sizing: border-box; padding: 8px 10px; border-radius: 12px; display: grid; gap: 2px; text-align: left; font-size: 13.5px; font-weight: 700; color: var(--texto); }
  .dz-seg button small { font-size: 11.5px; font-weight: 500; color: var(--sub); }
  .dz-seg button[aria-pressed="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 6px 16px rgba(16,110,190,.25); }
  .dz-seg button[aria-pressed="true"] small { color: rgba(255,255,255,.85); }
  .dz-seg button:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 1px; }
  .dz-seg button:disabled { cursor: default; opacity: .8; }
  .dz-pessoas { display: grid; gap: 6px; }
  .dz-pessoa { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 14px; background: var(--painel, rgba(255,255,255,.6)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); min-width: 0; cursor: pointer; }
  .dz-pessoa input { width: 18px; height: 18px; flex: none; accent-color: #106ebe; margin: 0; }
  .dz-pessoa .dz-nome { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .dz-pessoa .dz-nome b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dz-pessoa .dz-nome small { font-size: 12px; color: var(--sub); }
  .dz-pill { flex: none; display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
  .dz-pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .dz-pill.on { color: #0b7a52; background: rgba(15,190,130,.12); }
  .dz-pill.off { color: var(--sub); background: var(--vidro-borda, rgba(13,34,64,.06)); }
  html[data-tema="escuro"] .dz-pill.on { color: #5ef0b8; background: rgba(15,252,190,.1); }
  .dz-campos { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .dz-campo { display: grid; gap: 4px; align-content: end; font-size: 12.5px; font-weight: 600; color: var(--sub); min-width: 0; }
  .dz-campo div { display: flex; align-items: center; gap: 6px; color: var(--sub); font-weight: 500; }
  .dz-campo input { box-sizing: border-box; width: 100%; min-width: 0; height: 40px; padding: 0 10px; border-radius: 12px; border: 1px solid var(--linha); background: var(--painel); color: var(--texto); font: inherit; font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .dz-campo input:focus { outline: 2px solid var(--marca-azul, #106ebe); outline-offset: 0; border-color: transparent; }
  .dz-campo input::placeholder { color: var(--sub); font-weight: 500; }
  .dz-campo.destaque input { border-color: color-mix(in srgb, var(--marca-azul, #106ebe) 45%, var(--linha)); }
  .dz-cores { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--sub); }
  .dz-cores span { display: inline-flex; align-items: center; gap: 6px; }
  .dz-cores i { width: 10px; height: 10px; border-radius: 3px; }
  .dz-recentes { border-radius: 24px; padding: 18px; display: grid; gap: 10px; background: var(--vidro-fundo, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .dz-recentes h2 { margin: 0; font-size: 17px; }
  .dz-rec { display: flex; align-items: center; gap: 10px; font-size: 13.5px; min-width: 0; padding: 6px 0; border-top: 1px solid var(--vidro-borda, var(--linha)); }
  .dz-rec:first-of-type { border-top: 0; }
  .dz-rec button { all: unset; cursor: pointer; font-weight: 700; color: var(--marca-azul, #106ebe); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  html[data-tema="escuro"] .dz-rec button { color: var(--marca-menta, #0ffcbe); }
  .dz-rec span { color: var(--sub); white-space: nowrap; }
  .dz-rec .dz-quem { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--texto); }
  .dz-vazio { color: var(--sub); font-size: 14px; margin: 0; }
  @media (max-width: 760px) {
    .dz-topo h1 { font-size: 24px; }
    .dz-unidade, .dz-recentes { padding: 14px; border-radius: 20px; }
    .dz-bloco { padding: 12px; }
    .dz-campos { grid-template-columns: 1fr 1fr; }
  }
  `;
  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const SVG = {
    rodizio: ic('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7"/><path d="M20 4v4.7h-4.7"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3"/><path d="M4 20v-4.7h4.7"/>'),
    prazo: ic('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M9.5 3h5"/>'),
  };
  // Etapas fixas do funil "Atendimento" (o motor e a IA movem a conversa por elas).
  const ETAPAS = [['entrada', 'Entrada de leads'] /* etapa-entrada */, ['novo_lead', 'Novo lead'], ['em_conversa', 'Em conversa'], ['interessada', 'Interessada'], ['agendada', 'Agendada'], ['compareceu', 'Compareceu'], ['manutencao', 'Manutenção'], ['perdida', 'Perdida']];
  const PAPEL = { atendente: 'Atendente', recepcionista: 'Recepção', gerente: 'Gerente', direcao: 'Direção', admin: 'Administração' };

  const estado = { caixa: null, rodizio: null, regras: null };
  function estilo() { if (!document.getElementById('dz-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'dz-css', textContent: CSS })); }

  async function desenhar(caixa, ui) {
    estilo();
    estado.caixa = caixa;
    if (!estado.rodizio) caixa.replaceChildren(ui.el('p', { class: 'dz-vazio', text: 'Carregando…' }));
    try {
      const [r, g] = await Promise.all([ui.api('/api/rodizio'), ui.api('/api/espera/regras')]);
      estado.rodizio = r; estado.regras = g;
    } catch (x) {
      caixa.replaceChildren(ui.el('p', { class: 'dz-vazio', text: x.message || 'Não foi possível abrir agora.' }));
      return;
    }
    pintar(ui);
  }

  function chave(ui, marcado, rotulo, aoMudar, desligado) {
    const i = ui.el('input', { type: 'checkbox', role: 'switch', 'aria-label': rotulo, disabled: desligado ? '' : undefined });
    i.checked = Boolean(marcado);
    i.addEventListener('change', () => aoMudar(i.checked));
    return ui.el('label', { class: 'dz-chave' }, i, ui.el('i'));
  }

  function blocoRodizio(ui, un, podeEditar) {
    const el = ui.el;
    const cfg = { ...un.config, participantes: [...(un.config.participantes || [])] };
    const salvar = async (mudou) => {
      Object.assign(cfg, mudou);
      try {
        const r = await ui.api(`/api/rodizio/${encodeURIComponent(un.id)}`, { method: 'PUT', body: JSON.stringify(mudou) });
        un.config = r.config; ui.toast(`Rodízio de ${un.nome} salvo.`);
      } catch (x) { ui.toast(x.message); }
      pintar(ui);
    };
    const seg = (valor, titulo, sub) => el('button', { type: 'button', 'aria-pressed': String(cfg.regra === valor), disabled: podeEditar ? undefined : '', onclick: () => { if (cfg.regra !== valor) salvar({ regra: valor }); } }, document.createTextNode(titulo), el('small', { text: sub }));
    const escolhidos = cfg.participantes.length ? new Set(cfg.participantes) : new Set(un.pessoas.filter((p) => p.participa).map((p) => p.id));
    const pessoas = el('div', { class: 'dz-pessoas', role: 'group', 'aria-label': `Quem participa, ${un.nome}` });
    for (const p of un.pessoas) {
      const c = el('input', { type: 'checkbox', 'aria-label': `${p.nome} participa do rodízio`, disabled: podeEditar ? undefined : '' });
      c.checked = escolhidos.has(p.id);
      c.addEventListener('change', () => {
        if (c.checked) escolhidos.add(p.id); else escolhidos.delete(p.id);
        salvar({ participantes: [...escolhidos] });
      });
      pessoas.append(el('label', { class: 'dz-pessoa' }, c,
        el('span', { class: 'dz-nome' }, el('b', { text: p.nome }), el('small', { text: `${PAPEL[p.papel] || p.papel} · hoje: ${p.recebidasHoje} · em andamento: ${p.carga}` })),
        el('span', { class: 'dz-pill ' + (p.disponivel ? 'on' : 'off'), text: p.disponivel ? 'Disponível' : 'Fora do ar' })));
    }
    if (!un.pessoas.length) pessoas.append(el('p', { class: 'dz-vazio', text: 'Ninguém da equipe atende esta unidade ainda (Configurações › Atendentes e acessos).' }));
    return el('section', { class: 'dz-bloco' },
      el('h3', { html: SVG.rodizio }, document.createTextNode('Rodízio de leads')),
      el('div', { class: 'dz-linha' }, el('span', {}, document.createTextNode('Distribuir conversas novas sozinho'), el('small', { text: 'Cliente que escreve pela primeira vez já chega com dona.' })),
        chave(ui, cfg.ligado, `Rodízio automático, ${un.nome}`, (v) => salvar({ ligado: v }), !podeEditar)),
      el('div', { class: 'dz-seg', role: 'group', 'aria-label': 'Como escolher' },
        seg('rodizio', 'Rodízio', 'Um de cada vez, na ordem'),
        seg('carga', 'Menor carga', 'Quem tem menos conversas abertas')),
      el('p', { class: 'dz-dica', text: 'Só recebe quem está “Disponível para atender” e pode responder clientes. Ninguém marcado = todas as atendentes e recepcionistas da unidade. Se a IA atende primeiro, a conversa vai para alguém quando a IA passar para a equipe. Quem recebe é avisado no sino e no celular.' }),
      pessoas);
  }

  function blocoPrazos(ui, un, regraInfo, podeEditar) {
    const el = ui.el;
    const r = regraInfo.regra;
    const num = (valor, rotulo, ph, min, max) => el('input', { type: 'number', inputmode: 'numeric', min: String(min), max: String(max), value: valor == null ? '' : String(valor), placeholder: ph, 'aria-label': rotulo, disabled: podeEditar ? undefined : '' });
    const campo = (titulo, input, destaque) => el('label', { class: 'dz-campo' + (destaque ? ' destaque' : '') }, document.createTextNode(titulo), el('div', {}, input, document.createTextNode('min')));
    const aviso = num(r.avisoMin, `Prazo padrão em minutos, ${un.nome}`, '', 1, 240);
    const escalar = num(Math.max(1, r.forteMin - r.avisoMin), `Escalar depois de mais quantos minutos, ${un.nome}`, '', 1, 240);
    const primeira = num(r.primeiraMin, `Prazo da primeira resposta, ${un.nome}`, 'padrão', 1, 1440);
    const porEtapa = ETAPAS.map(([id, nome]) => [id, nome, num(r.etapas?.[id], `Prazo da etapa ${nome}, ${un.nome}`, 'padrão', 1, 1440)]);
    const gravar = async () => {
      const a = Number(aviso.value), e = Number(escalar.value);
      if (!(a >= 1) || !(e >= 1)) return;
      const etapas = {};
      for (const [id, , inp] of porEtapa) { const v = Number(inp.value); if (inp.value !== '' && v >= 1) etapas[id] = Math.round(v); }
      const corpo = { avisoMin: Math.round(a), forteMin: Math.round(a + e), primeiraMin: primeira.value !== '' && Number(primeira.value) >= 1 ? Math.round(Number(primeira.value)) : null, etapas };
      try {
        const res = await ui.api(`/api/espera/regras/${encodeURIComponent(un.id)}`, { method: 'PUT', body: JSON.stringify(corpo) });
        regraInfo.regra = res.regra; ui.toast(`Prazos de ${un.nome} salvos.`);
      } catch (x) { ui.toast(x.message); }
    };
    for (const i of [aviso, escalar, primeira, ...porEtapa.map((x) => x[2])]) i.addEventListener('change', gravar);
    return el('section', { class: 'dz-bloco' },
      el('h3', { html: SVG.prazo }, document.createTextNode('Prazo de resposta (cliente esperando)')),
      el('p', { class: 'dz-dica', text: 'Passou do prazo sem resposta: avisa quem é dona da conversa (ou a unidade). Continuou sem resposta: escala para a gerência. Vazio = vale o prazo padrão.' }),
      el('div', { class: 'dz-campos' },
        campo('Primeira resposta', primeira, true),
        ...porEtapa.map(([, nome, inp]) => campo(nome, inp))),
      el('div', { class: 'dz-campos' },
        campo('Prazo padrão', aviso),
        campo('Escalar para a gerência depois de mais', escalar)),
      r.ligado ? null : el('p', { class: 'dz-dica', text: 'Os alertas de espera desta unidade estão desligados (Configurações › Notificações).' }),
      el('div', { class: 'dz-cores', 'aria-label': 'Cores do tempo na lista de conversas' },
        el('span', {}, el('i', { style: 'background:var(--texto,#0d2240)' }), document.createTextNode('dentro do prazo')),
        el('span', {}, el('i', { style: 'background:#f5b700' }), document.createTextNode('prazo estourou')),
        el('span', {}, el('i', { style: 'background:#e53935' }), document.createTextNode('escalada para a gerência'))));
  }

  function pintar(ui) {
    const el = ui.el, caixa = estado.caixa; if (!caixa || !estado.rodizio) return;
    const r = estado.rodizio, regras = estado.regras || { unidades: [], podeEditar: false };
    const cartoes = r.unidades.map((un) => {
      const regraInfo = regras.unidades.find((x) => x.id === un.id);
      return el('article', { class: 'dz-unidade' }, el('h2', { text: un.nome }),
        el('div', { class: 'dz-grade' }, blocoRodizio(ui, un, r.podeEditar), regraInfo ? blocoPrazos(ui, un, regraInfo, regras.podeEditar) : null));
    });
    const rec = el('section', { class: 'dz-recentes' }, el('h2', { text: 'Últimas distribuições' }));
    if (!r.recentes.length) rec.append(el('p', { class: 'dz-vazio', text: 'Nenhuma conversa distribuída pelo rodízio ainda.' }));
    for (const a of r.recentes) {
      const quando = new Date(a.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      rec.append(el('div', { class: 'dz-rec' },
        el('button', { type: 'button', text: 'Abrir conversa', onclick: () => ui.abrir?.(a.conversaId) }),
        el('span', { class: 'dz-quem', text: `→ ${a.usuarioNome} · ${a.unidadeNome}` }),
        el('span', { text: quando })));
    }
    caixa.replaceChildren(el('div', { class: 'dz' },
      el('div', { class: 'dz-topo' }, el('h1', { text: 'Distribuição e prazos' }),
        el('p', { text: 'Lead respondido em minutos vende mais. Aqui você liga o rodízio automático e define o prazo de resposta de cada etapa.' })),
      ...(cartoes.length ? cartoes : [el('p', { class: 'dz-vazio', text: 'Nenhuma unidade para mostrar.' })]),
      rec));
  }

  window.SintoniaTelas.distribuicao = { desenhar };
})();
