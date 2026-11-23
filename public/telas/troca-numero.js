/* trocar-numero: Conexões › WhatsApp — o que fazer com as conversas quando a loja troca o número do canal,
 * e o botão fixo "Apagar os dados deste WhatsApp" embaixo de cada canal.
 *
 * window.SintoniaTrocaNumero.itens(canal, recarregar) -> [aviso da troca pendente?, botão vermelho discreto]
 * window.SintoniaTrocaNumero.abrir(canal, 'troca' | 'tudo', recarregar)
 *   'troca': outro número conectou (canal.troca vem de GET /api/conexoes/whatsapp/canais): Manter, Arquivar ou Apagar.
 *   'tudo':  todas as conversas do canal até agora (GET/POST /api/conexoes/whatsapp/canais/:id/dados): Arquivar ou Apagar.
 * Apagar: mostra o que vai sumir, pede para digitar APAGAR e acompanha o andamento (GET /api/conexoes/whatsapp/apagando/:id).
 * Usa as classes wa-* da folha do WhatsApp (conexoes.html). Sem animação em loop: a barra só anda quando o número muda.
 * Todo texto do servidor entra por textContent. */
(() => {
  const css = document.createElement('style');
  css.textContent = `
  .tn-canal { border-bottom: 1px solid var(--vidro-borda); }
  .tn-canal:last-child { border-bottom: 0; }
  .tn-canal > .wa-item { border-bottom: 0; }
  .tn-apagar { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin: -4px 0 10px 58px; padding: 4px 0; font-size: 12.5px; font-weight: 600; color: var(--erro); opacity: .82; }
  .tn-apagar svg { width: 15px; height: 15px; flex: none; }
  .tn-apagar:hover { opacity: 1; text-decoration: underline; }
  .tn-apagar:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; border-radius: 6px; }
  @media (max-width: 520px) { .tn-apagar { margin-left: 4px; } }
  .tn-aviso { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin: 0 0 10px 58px; padding: 10px 12px; border-radius: 14px; background: var(--aviso); color: var(--aviso-txt); font-size: 13.5px; line-height: 1.45; }
  .tn-aviso span { flex: 1 1 220px; min-width: 0; }
  .tn-aviso .botao { padding: 8px 14px; font-size: 13.5px; }
  @media (max-width: 520px) { .tn-aviso { margin-left: 0; } }
  .tn-aviso-topo { margin: 0 0 8px; }
  body.cx-detalhe #tn-topo { display: none; }
  .tn-folha { text-align: left; }
  .tn-folha h2 { text-align: center; padding: 0 34px; }
  .tn-folha .wa-sub { text-align: center; }
  .tn-nums { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-top: -4px; }
  .tn-nums span { font-size: 12.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); color: var(--sub); }
  .tn-nums span b { color: var(--texto); font-weight: 700; }
  .tn-pergunta { font-size: 15px; font-weight: 700; color: var(--texto); text-align: center; margin: 2px 0 0; }
  .tn-ops { display: grid; gap: 8px; }
  .tn-op { all: unset; box-sizing: border-box; cursor: pointer; text-align: left; display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; align-items: center; padding: 12px 14px; border-radius: 16px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .tn-op:hover { background: var(--vidro-ativo); }
  .tn-op:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .tn-op[aria-busy="true"] { opacity: .6; pointer-events: none; }
  .tn-op i { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; background: color-mix(in srgb, var(--marca-azul) 12%, transparent); color: var(--marca-azul); }
  .tn-op i svg { width: 20px; height: 20px; }
  .tn-op b { display: block; font-size: 15px; color: var(--texto); }
  .tn-op small { display: block; font-size: 12.5px; line-height: 1.4; color: var(--sub); margin-top: 2px; }
  .tn-op.perigo i { background: color-mix(in srgb, var(--erro) 13%, transparent); color: var(--erro); }
  .tn-op.perigo b { color: var(--erro); }
  @media (prefers-color-scheme: dark) { .tn-op i { color: #8fe9de; background: rgba(15, 252, 190, .1); } .tn-op.perigo i { color: var(--erro); background: color-mix(in srgb, var(--erro) 16%, transparent); } }
  .tn-some { text-align: left; margin: 0; padding: 12px 14px 12px 32px; border-radius: 14px; background: color-mix(in srgb, var(--erro) 8%, var(--vidro-item)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--erro) 30%, transparent); font-size: 14px; line-height: 1.7; color: var(--texto); }
  .tn-some b { font-weight: 700; }
  .tn-nota { font-size: 12.5px; line-height: 1.45; color: var(--sub); margin: 0; }
  .tn-campo { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: var(--sub); }
  .tn-campo input { font: inherit; font-size: 17px; font-weight: 700; letter-spacing: .12em; text-align: center; text-transform: uppercase; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--vidro-borda); background: var(--vidro-item); color: var(--texto); }
  .tn-campo input:focus { outline: 2px solid color-mix(in srgb, var(--erro) 60%, transparent); outline-offset: 1px; }
  .tn-vermelho { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; border-radius: 999px; padding: 14px 18px; font-size: 15px; font-weight: 700; color: #fff; background: #c43a3a; }
  .tn-vermelho:disabled { opacity: .4; cursor: not-allowed; }
  .tn-vermelho:not(:disabled):hover { filter: brightness(1.07); }
  .tn-vermelho:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .tn-barra { height: 8px; border-radius: 4px; background: color-mix(in srgb, var(--sub) 20%, transparent); overflow: hidden; }
  .tn-barra i { display: block; height: 100%; width: 0; border-radius: 4px; background: linear-gradient(90deg, #106ebe, #3aa0ff); transition: width .4s ease; }
  .tn-andamento { font-size: 15px; font-weight: 700; text-align: center; color: var(--texto); font-variant-numeric: tabular-nums; }
  .tn-erro { color: var(--erro); font-size: 13px; margin: 0; text-align: center; }
  @media (prefers-reduced-motion: reduce) { .tn-barra i { transition: none; } }
  `;
  document.head.append(css);

  const el = (tag, props = {}, ...filhos) => { const e = document.createElement(tag); Object.assign(e, props); e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false)); return e; };
  const api = async (url, opcoes = {}) => {
    const r = await fetch(url, { ...opcoes, headers: opcoes.body ? { 'content-type': 'application/json' } : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.erro || (r.status === 403 ? 'Só a administração e a direção podem fazer isso.' : 'Algo deu errado. Tente de novo.')), { status: r.status });
    return j;
  };
  const n = (x) => Number(x || 0).toLocaleString('pt-BR');
  const plural = (x, um, varios) => `${n(x)} ${Number(x) === 1 ? um : varios}`;
  const tel = (t) => { const d = String(t || '').replace(/^55/, ''); return d.length >= 10 ? `+55 ${d.slice(0, 2)} ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : (t || ''); };
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    manter: svg('<path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.4A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="m8.5 11.8 2.4 2.4 4.6-4.7"/>'),
    arquivar: svg('<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M10 12.5h4"/>'),
    apagar: svg('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  };

  // ------------------------------------------------------------ a folha
  const folha = el('dialog', { className: 'wa-folha wa-menu tn-folha', id: 'd-troca-numero' });
  folha.setAttribute('aria-labelledby', 'tn-titulo');
  const corpo = el('div', { className: 'wa-etapa' });
  const fechar = el('button', { className: 'wa-fechar', type: 'button', textContent: '✕' });
  fechar.setAttribute('aria-label', 'Fechar');
  folha.append(el('div', { className: 'wa-puxa' }), corpo, fechar);
  const montar = () => { if (!folha.isConnected) document.body.append(folha); };
  let estado = null; // { canal, origem, resumo, aviso, recarregar, trabalho, timer }
  const encerrar = () => { clearTimeout(estado?.timer); folha.close(); const r = estado?.recarregar; estado = null; r?.(); };
  fechar.addEventListener('click', encerrar);
  folha.addEventListener('cancel', (e) => { e.preventDefault(); encerrar(); });
  folha.addEventListener('click', (e) => { if (e.target === folha && estado?.passo !== 'apagando') encerrar(); });

  const titulo = (t) => el('h2', { id: 'tn-titulo', textContent: t });
  const sub = (t) => el('p', { className: 'wa-sub', textContent: t });
  function opcao(acao, nome, texto, perigo) {
    const b = el('button', { className: 'tn-op' + (perigo ? ' perigo' : ''), type: 'button' });
    b.append(el('i', { innerHTML: IC[acao] }), el('span', {}, el('b', { textContent: nome }), el('small', { textContent: texto })));
    b.addEventListener('click', () => escolher(acao, b));
    return b;
  }
  const erroBox = () => el('p', { className: 'tn-erro', hidden: true });

  function passoEscolha() {
    const { canal, origem, resumo } = estado;
    estado.passo = 'escolha';
    const qtd = resumo.conversas;
    const partes = [];
    if (origem === 'troca') {
      const t = canal.troca;
      partes.push(titulo(t.numeroAnterior ? 'Este WhatsApp agora é outro número' : 'WhatsApp conectado'));
      partes.push(t.numeroAnterior
        ? el('div', { className: 'tn-nums' }, el('span', {}, 'Antes: ', el('b', { textContent: tel(t.numeroAnterior) })), el('span', {}, 'Agora: ', el('b', { textContent: tel(t.numeroNovo) })))
        : sub(`O canal “${canal.nome}” já tinha conversas de antes desta conexão${t.numeroNovo ? ` (agora é o ${tel(t.numeroNovo)})` : ''}.`));
      partes.push(el('p', { className: 'tn-pergunta', textContent: `O que fazer com ${t.numeroAnterior ? 'as' : 'essas'} ${plural(qtd, 'conversa', 'conversas')} ${t.numeroAnterior ? 'do número anterior' : 'de antes'}?` }));
      partes.push(el('div', { className: 'tn-ops' },
        opcao('manter', 'Manter', 'Continuam na lista, como estão hoje.'),
        opcao('arquivar', 'Arquivar', 'Saem da lista de todo mundo. Dá para ver e desarquivar em Conversas › Arquivadas do número antigo.'),
        opcao('apagar', 'Apagar', 'Somem de vez, com mensagens, fotos e áudios. Não dá para desfazer.', true)));
    } else {
      partes.push(titulo('Apagar os dados deste WhatsApp'));
      partes.push(sub(`Canal “${canal.nome}”: ${plural(qtd, 'conversa', 'conversas')}${estado.arquivadas ? ` (${n(estado.arquivadas)} já ${estado.arquivadas === 1 ? 'arquivada' : 'arquivadas'})` : ''} · ${plural(resumo.mensagens, 'mensagem', 'mensagens')}.`));
      if (!qtd) partes.push(el('p', { className: 'tn-pergunta', textContent: 'Não há conversas deste WhatsApp para arquivar ou apagar.' }));
      else {
        partes.push(el('p', { className: 'tn-pergunta', textContent: 'O que fazer com elas?' }));
        partes.push(el('div', { className: 'tn-ops' },
          estado.ativas ? opcao('arquivar', 'Arquivar', 'Saem da lista de todo mundo. Dá para ver e desarquivar em Conversas › Arquivadas do número antigo.') : null,
          opcao('apagar', 'Apagar', 'Somem de vez, com mensagens, fotos e áudios. Não dá para desfazer.', true)));
      }
    }
    estado.erro = erroBox();
    const cancelar = el('button', { className: 'wa-link', type: 'button', textContent: origem === 'troca' ? 'Decidir depois' : 'Cancelar' });
    cancelar.addEventListener('click', encerrar);
    corpo.replaceChildren(...partes, estado.erro, el('div', { className: 'wa-botoes' }, cancelar));
  }

  async function escolher(acao, botao) {
    const { canal, origem } = estado;
    if (acao === 'apagar') return passoConfirmar();
    botao.setAttribute('aria-busy', 'true');
    estado.erro.hidden = true;
    try {
      const url = origem === 'troca' ? `/api/conexoes/whatsapp/canais/${encodeURIComponent(canal.id)}/troca` : `/api/conexoes/whatsapp/canais/${encodeURIComponent(canal.id)}/dados`;
      const r = await api(url, { method: 'POST', body: JSON.stringify({ acao }) });
      if (acao === 'manter') return encerrar();
      passoPronto('Pronto', r.arquivadas
        ? `${plural(r.arquivadas, 'conversa arquivada', 'conversas arquivadas')}. Estão em Conversas › Arquivadas do número antigo, para consultar ou desarquivar quando quiser.`
        : 'Não havia conversas para arquivar.');
    } catch (x) { estado.erro.textContent = x.message; estado.erro.hidden = false; }
    finally { botao.removeAttribute('aria-busy'); }
  }

  function passoConfirmar() {
    const { resumo, aviso } = estado;
    estado.passo = 'confirmar';
    const itens = [
      el('li', {}, el('b', { textContent: plural(resumo.conversas, 'conversa', 'conversas') })),
      el('li', {}, el('b', { textContent: plural(resumo.mensagens, 'mensagem', 'mensagens') })),
      resumo.midias ? el('li', {}, el('b', { textContent: n(resumo.midias) }), ` ${resumo.midias === 1 ? 'foto, áudio ou arquivo' : 'fotos, áudios e arquivos'}`) : null,
      resumo.contatos ? el('li', {}, el('b', { textContent: plural(resumo.contatos, 'contato', 'contatos') }), ' que só existem por causa delas') : null,
      el('li', {}, 'Notas, etiquetas, etapa no Pipeline, follow-ups e mensagens agendadas delas'),
    ];
    const campo = el('input', { type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'APAGAR' });
    campo.setAttribute('aria-label', 'Digite APAGAR para confirmar');
    const apagar = el('button', { className: 'tn-vermelho', type: 'button', textContent: 'Apagar de vez', disabled: true });
    campo.addEventListener('input', () => { apagar.disabled = campo.value.trim().toUpperCase() !== 'APAGAR'; });
    campo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !apagar.disabled) apagar.click(); });
    const voltar = el('button', { className: 'wa-link', type: 'button', textContent: 'Voltar' });
    voltar.addEventListener('click', passoEscolha);
    estado.erro = erroBox();
    apagar.addEventListener('click', async () => {
      apagar.disabled = true; apagar.textContent = 'Começando…'; estado.erro.hidden = true;
      const { canal, origem } = estado;
      try {
        const url = origem === 'troca' ? `/api/conexoes/whatsapp/canais/${encodeURIComponent(canal.id)}/troca` : `/api/conexoes/whatsapp/canais/${encodeURIComponent(canal.id)}/dados`;
        const r = await api(url, { method: 'POST', body: JSON.stringify({ acao: 'apagar', confirmacao: campo.value.trim() }) });
        if (r.trabalho) passoApagando(r.trabalho);
        else passoPronto('Pronto', 'Não havia nada para apagar.');
      } catch (x) { estado.erro.textContent = x.message; estado.erro.hidden = false; apagar.textContent = 'Apagar de vez'; apagar.disabled = false; }
    });
    corpo.replaceChildren(
      titulo('Apagar de vez?'),
      sub('Isto não tem volta. Vai sumir da Sintonia:'),
      el('ul', { className: 'tn-some' }, ...itens.filter(Boolean)),
      el('p', { className: 'tn-nota', textContent: 'Agendamentos e vendas já registrados continuam nos relatórios, só sem a ligação com a conversa.' }),
      aviso ? el('p', { className: 'tn-nota', textContent: aviso }) : null,
      el('label', { className: 'tn-campo' }, 'Para confirmar, digite APAGAR', campo),
      estado.erro,
      el('div', { className: 'wa-botoes' }, apagar, voltar),
    );
    setTimeout(() => campo.focus(), 60);
  }

  function passoApagando(t) {
    estado.passo = 'apagando';
    const barra = el('i');
    const texto = el('p', { className: 'tn-andamento', textContent: 'Apagando…' });
    texto.setAttribute('role', 'status'); texto.setAttribute('aria-live', 'polite');
    corpo.replaceChildren(
      titulo('Apagando'),
      sub('Pode fechar esta janela: a Sintonia continua apagando e o atendimento segue normal.'),
      el('div', { className: 'tn-barra' }, barra),
      texto,
    );
    const mostrar = (x) => {
      const porMsg = x.total.mensagens > 0;
      const feito = porMsg ? x.feito.mensagens : x.feito.conversas;
      const total = porMsg ? x.total.mensagens : x.total.conversas;
      barra.style.width = `${total ? Math.min(100, Math.round((feito / total) * 100)) : 100}%`;
      texto.textContent = `Apagando… ${n(feito)} de ${n(total)} ${porMsg ? 'mensagens' : 'conversas'}`;
    };
    mostrar(t);
    const conferir = async () => {
      if (!estado || estado.passo !== 'apagando') return;
      let x;
      try { x = await api(`/api/conexoes/whatsapp/apagando/${encodeURIComponent(t.id)}`); }
      catch (e) { texto.textContent = e.message; return; }
      if (!estado || estado.passo !== 'apagando') return;
      if (x.estado === 'apagando') { mostrar(x); estado.timer = setTimeout(conferir, 1000); return; }
      if (x.estado === 'pronto') return passoPronto('Pronto', `Pronto: ${plural(x.feito.conversas, 'conversa apagada', 'conversas apagadas')} (${plural(x.feito.mensagens, 'mensagem', 'mensagens')}).`);
      passoPronto('Não terminou', x.erro || 'Parou no meio. Tente de novo.', true);
    };
    estado.timer = setTimeout(conferir, 700);
  }

  function passoPronto(t, texto, falhou) {
    estado.passo = 'pronto';
    const ok = el('button', { className: 'botao wa-pri', type: 'button', textContent: 'Fechar' });
    ok.addEventListener('click', encerrar);
    corpo.replaceChildren(
      falhou ? null : el('div', { className: 'wa-check', innerHTML: IC.ok }),
      titulo(t),
      el('p', { className: 'wa-sub', textContent: texto, role: 'status' }),
      el('div', { className: 'wa-botoes' }, ok),
    );
  }

  async function abrir(canal, origem, recarregar) {
    montar();
    estado = { canal, origem, recarregar, passo: 'carregando' };
    corpo.replaceChildren(titulo(origem === 'troca' ? 'Outro número conectado' : 'Apagar os dados deste WhatsApp'), sub('Contando as conversas…'));
    if (!folha.open) folha.showModal();
    if (origem === 'troca') {
      const t = canal.troca;
      estado.resumo = { conversas: t.conversas, mensagens: t.mensagens, midias: t.midias, contatos: t.contatos };
      estado.aviso = t.aviso;
      return passoEscolha();
    }
    try {
      const d = await api(`/api/conexoes/whatsapp/canais/${encodeURIComponent(canal.id)}/dados`);
      if (!estado) return;
      Object.assign(estado, { resumo: d.resumo, aviso: d.aviso, arquivadas: d.arquivadas, ativas: d.ativas });
      passoEscolha();
    } catch (x) { corpo.replaceChildren(titulo('Não deu para abrir'), el('p', { className: 'tn-erro', textContent: x.message })); }
  }

  /** O que vai embaixo da linha do canal: aviso da troca pendente e o botão fixo. */
  function itens(canal, recarregar) {
    const lista = [];
    if (canal.troca) {
      const b = el('button', { className: 'botao leve', type: 'button', textContent: 'Decidir' });
      b.addEventListener('click', () => abrir(canal, 'troca', recarregar));
      lista.push(el('div', { className: 'tn-aviso' }, el('span', { textContent: `Outro número conectou. Falta decidir o que fazer com ${plural(canal.troca.conversas, 'conversa', 'conversas')} do número anterior.` }), b));
    }
    /* grupos do número antigo (dono 23/11): botão próprio, só aparece quando há grupos de antes do número de agora */
    const grupos = el('button', { className: 'tn-apagar', type: 'button', innerHTML: IC.apagar, hidden: true });
    fetch(`/api/conexoes/whatsapp/canais/${encodeURIComponent(canal.id)}/grupos-antigos`, { credentials: 'same-origin' })
      .then((x) => (x.ok ? x.json() : null)).then((g) => {
        if (!g?.grupos) return;
        grupos.append(`Apagar os grupos do número antigo (${g.grupos})`); grupos.hidden = false;
      }).catch(() => {});
    grupos.addEventListener('click', async () => {
      const c = window.prompt('Os grupos do número antigo (as conversas de grupo e as mensagens deles) vão sumir da Sintonia. Isso não pode ser desfeito.\nOs grupos do número novo ficam.\n\nPara confirmar, digite APAGAR:');
      if (c == null) return;
      try {
        const r = await fetch(`/api/conexoes/whatsapp/canais/${encodeURIComponent(canal.id)}/grupos-antigos`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmacao: c }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || j.message || 'Não deu para apagar agora.');
        window.alert(`Pronto: ${j.grupos} ${j.grupos === 1 ? 'grupo apagado' : 'grupos apagados'}.`);
        grupos.hidden = true; recarregar?.();
      } catch (x) { window.alert(x.message); }
    });
    lista.push(grupos);
    const apagar = el('button', { className: 'tn-apagar', type: 'button', innerHTML: IC.apagar });
    apagar.append('Apagar os dados deste WhatsApp');
    apagar.addEventListener('click', () => abrir(canal, 'tudo', recarregar));
    lista.push(apagar);
    return lista;
  }

  /* Na lista de conexões (catálogo), a troca pendente aparece logo no topo: ninguém precisa achar o canal para decidir. */
  async function avisoNoTopo() {
    const main = document.querySelector('main');
    if (!main) return;
    document.getElementById('tn-topo')?.remove();
    const r = await fetch('/api/conexoes/whatsapp/canais').then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const pendentes = (r?.canais || []).filter((k) => k.troca);
    if (!pendentes.length) return;
    const caixa = el('div', { id: 'tn-topo' });
    for (const k of pendentes) {
      const b = el('button', { className: 'botao leve', type: 'button', textContent: 'Decidir' });
      b.addEventListener('click', () => abrir(k, 'troca', avisoNoTopo));
      caixa.append(el('div', { className: 'tn-aviso tn-aviso-topo' }, el('span', { textContent: `WhatsApp “${k.nome}”: outro número conectou. Falta decidir o que fazer com ${plural(k.troca.conversas, 'conversa', 'conversas')} do número anterior.` }), b));
    }
    main.prepend(caixa);
  }
  const iniciar = () => setTimeout(avisoNoTopo, 300);
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', iniciar); else iniciar();

  window.SintoniaTrocaNumero = { itens, abrir, avisoNoTopo };
})();
