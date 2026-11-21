/* perdas-saude: painel de saúde para a gestão (Análises › Saúde do sistema). Registra window.SintoniaSaude:
 *   montar(caixa, ui)  desenha e pede /api/saude/painel a cada 15 s enquanto a caixa está na tela e a aba visível;
 *                      ao sair da tela (caixa fora do documento) para de pedir sozinho.
 * Mostra: estado geral e avisos, filas (entrada e IA), tempo até a mensagem aparecer (p50/p95 das últimas horas),
 * IA (falhas e pausa por chave recusada), mídias, números de WhatsApp, processo (memória, tempo no ar) e banco.
 * Usa o visual das Análises (.rl-/.an-). Sem animação em loop; texto do servidor sempre por textContent.
 */
(() => {
  const INTERVALO = 15_000;
  const CSS = `
  .sd { display: grid; gap: 16px; }
  .sd-geral { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: center; border-radius: 24px; padding: 16px 18px; }
  .sd-luz { width: 14px; height: 14px; border-radius: 50%; background: #19c3a6; box-shadow: 0 0 0 4px color-mix(in srgb, #19c3a6 22%, transparent); }
  .sd-geral[data-nivel="atencao"] .sd-luz { background: #f5b800; box-shadow: 0 0 0 4px color-mix(in srgb, #f5b800 24%, transparent); }
  .sd-geral[data-nivel="problema"] .sd-luz { background: #e5383b; box-shadow: 0 0 0 4px color-mix(in srgb, #e5383b 22%, transparent); }
  .sd-geral b { font-size: 17px; font-weight: 800; display: block; }
  .sd-geral small { color: var(--sub); font-size: 13px; }
  .sd-alertas { display: grid; gap: 6px; margin: 8px 0 0; padding: 0; list-style: none; }
  .sd-alertas li { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; line-height: 1.4; }
  .sd-alertas li::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; background: #f5b800; }
  .sd-alertas li.problema::before { background: #e5383b; }
  .sd-num { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); }
  .sd-n { display: grid; gap: 2px; padding: 10px 12px; border-radius: 16px; background: var(--vidro-item); min-width: 0; }
  .sd-n small { font-size: 12px; color: var(--sub); font-weight: 600; }
  .sd-n b { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .sd-n.ruim b { color: #c2410c; } html[data-tema="escuro"] .sd-n.ruim b { color: #ff9a7f; }
  .sd-n.bom b { color: #0a8f7a; } html[data-tema="escuro"] .sd-n.bom b { color: #0ffcbe; }
  .sd-canais { display: grid; gap: 8px; }
  .sd-canal { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 16px; background: var(--vidro-item); }
  .sd-canal i { width: 10px; height: 10px; border-radius: 50%; background: #19c3a6; }
  .sd-canal[data-estado="desconectado"] i, .sd-canal[data-estado="nunca"] i { background: #e5383b; }
  .sd-canal[data-estado="conectando"] i, .sd-canal[data-estado="desligado"] i { background: #f5b800; }
  .sd-canal b { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
  .sd-canal small { font-size: 12.5px; color: var(--sub); }
  .sd-canal span:last-child { font-size: 12.5px; font-weight: 700; color: var(--sub); text-align: right; }
  .sd-horas { display: grid; gap: 6px; }
  .sd-hora { display: grid; grid-template-columns: 46px minmax(0, 1fr) 92px; gap: 10px; align-items: center; font-size: 12.5px; color: var(--sub); font-variant-numeric: tabular-nums; }
  .sd-hora .rl-trilha { height: 8px; }
  .sd-hora b { text-align: right; color: var(--texto); }
  .sd-rodape { font-size: 12.5px; color: var(--sub); display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; }
  .sd-rodape button { all: unset; cursor: pointer; font-weight: 800; color: var(--azul-serie, #106ebe); }
  .sd-rodape button:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; border-radius: 6px; }
  @media (max-width: 560px) { .sd-geral { grid-template-columns: auto minmax(0, 1fr); } .sd-geral > :last-child { grid-column: 1 / -1; } .sd-n b { font-size: 18px; } }
  `;

  function estilo() {
    window.SintoniaTelas?.relatorios?.estilo?.();
    if (document.getElementById('estilo-saude')) return;
    const st = document.createElement('style');
    st.id = 'estilo-saude';
    st.textContent = CSS;
    document.head.append(st);
  }

  const fmtN = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
  const fmtMs = (ms) => {
    if (ms == null) return '—';
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0).replace('.', ',')} s`;
    return `${Math.round(s / 60)} min`;
  };
  const fmtMB = (b) => (b == null ? '—' : b >= 1073741824 ? `${(b / 1073741824).toFixed(1).replace('.', ',')} GB` : `${Math.round(b / 1048576)} MB`);
  const fmtNoAr = (seg) => {
    if (seg == null) return '—';
    const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600), m = Math.floor((seg % 3600) / 60);
    return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  };
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const quando = (iso) => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return 'agora';
    if (ms < 3_600_000) return `há ${Math.round(ms / 60_000)} min`;
    if (ms < 86_400_000) return `há ${Math.round(ms / 3_600_000)} h`;
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };
  const ESTADO = { conectado: 'Conectado', conectando: 'Conectando', desconectado: 'Desconectado', desligado: 'Desligado', nunca: 'Nunca conectou' };

  function desenhar(caixa, ui, r, erro, quandoPediu) {
    const el = ui.el;
    const painel = (titulo, sub, classe, ...filhos) => el('section', { class: `rl-painel rl-vidro ${classe}`, 'aria-label': titulo },
      el('div', { class: 'rl-cab' }, el('h2', {}, titulo, sub ? el('small', { text: sub }) : null)), ...filhos);
    const num = (rot, valor, tipo) => el('div', { class: 'sd-n' + (tipo ? ' ' + tipo : ''), role: 'listitem' }, el('small', { text: rot }), el('b', { text: valor }));
    const nums = (...xs) => el('div', { class: 'sd-num', role: 'list' }, ...xs);
    const vazio = (t) => el('div', { class: 'rl-vazio', text: t });
    if (!r) {
      caixa.replaceChildren(erro
        ? el('div', { class: 'rl-erro rl-vidro', role: 'alert' }, el('b', { text: 'Não deu para ver a saúde do sistema' }), el('span', { text: erro }))
        : el('div', { class: 'rl-esq', style: 'height:220px' }));
      return;
    }
    const L = r.limites || {};
    const titulo = { ok: 'Tudo funcionando', atencao: 'Funcionando, com pontos de atenção', problema: 'Precisa de atenção agora' }[r.nivel] || 'Situação';
    const geral = el('div', { class: 'sd-geral rl-vidro', 'data-nivel': r.nivel, role: 'status' },
      el('span', { class: 'sd-luz', 'aria-hidden': 'true' }),
      el('div', {}, el('b', { text: titulo }),
        r.alertas.length ? el('ul', { class: 'sd-alertas' }, ...r.alertas.map((a) => el('li', { class: a.nivel, text: a.texto }))) : el('small', { text: 'Filas andando, mensagens aparecendo rápido, IA e WhatsApp respondendo.' })),
      el('small', { text: erro ? `Sem atualizar: ${erro}` : `Atualizado às ${hora(quandoPediu)}` }));

    const fe = r.fila?.entrada, fi = r.fila?.ia;
    const filas = painel('Filas', 'mensagens que chegaram do WhatsApp e conversas esperando a IA', 'rl-g6',
      nums(
        num('Entrada: esperando', fmtN(fe?.pendentes), fe && fe.pendentes >= (L.filaEntradaPendentes || 50) ? 'ruim' : ''),
        num('Entrada: processando', fmtN(fe?.processando)),
        num('Entrada: falharam', fmtN(fe?.falhas), fe?.falhas ? 'ruim' : 'bom'),
        num('Guardadas no disco', fmtN(r.fila?.reservaEmDisco ?? 0), r.fila?.reservaEmDisco ? 'ruim' : ''),
        num('IA: esperando', fi ? fmtN(fi.esperando) : '—', fi && fi.esperando >= (L.filaIaEsperando || 30) ? 'ruim' : ''),
        num('IA: pensando agora', fi ? fmtN(fi.pensando) : '—'),
        num('IA: feitas desde que ligou', fi ? fmtN(fi.feitas) : '—')));

    const ap = r.aparecer;
    const max = Math.max(1, ...(ap?.porHora || []).map((h) => h.p95Ms || 0));
    const aparecer = painel('Tempo até a mensagem aparecer', ap ? `da chegada pelo WhatsApp até estar na conversa · últimas ${ap.horas} h` : 'da chegada pelo WhatsApp até estar na conversa', 'rl-g6',
      ap ? nums(
        num('Metade em até (p50)', fmtMs(ap.p50Ms), ap.p50Ms != null && ap.p50Ms < 1000 ? 'bom' : ''),
        num('95% em até (p95)', fmtMs(ap.p95Ms), ap.p95Ms != null && ap.p95Ms > (L.p95AparecerMs || 2000) ? 'ruim' : ap.p95Ms != null ? 'bom' : ''),
        num('A mais lenta', fmtMs(ap.maxMs)),
        num('Mensagens', fmtN(ap.total))) : vazio('Sem medição neste servidor.'),
      ap && ap.porHora.length ? el('div', { class: 'sd-horas', role: 'list', 'aria-label': 'Por hora: p50 e p95' }, ...ap.porHora.slice(-8).map((h) => el('div', { class: 'sd-hora', role: 'listitem' },
        el('span', { text: hora(h.hora) }),
        el('span', { class: 'rl-trilha', 'aria-hidden': 'true' }, el('i', { style: `width:${Math.max(2, ((h.p95Ms || 0) / max) * 100)}%;background:${(h.p95Ms || 0) > (L.p95AparecerMs || 2000) ? '#ff7a59' : 'linear-gradient(90deg,#106ebe,#3aa0ff)'}` })),
        el('b', { text: `${fmtMs(h.p50Ms)} · ${fmtMs(h.p95Ms)}` })))) : ap ? vazio('Nenhuma mensagem chegou nestas horas.') : null);

    const ia = r.ia || {};
    const f = ia.falhas;
    const iaP = painel('Inteligência artificial', ia.pausada ? `pausada até ${hora(ia.pausadaAte)} (chave recusada)` : ia.ligada === false ? 'desligada (falta a chave em Conexões)' : 'respondendo normalmente', 'rl-g6',
      nums(
        num('Situação', ia.pausada ? 'Pausada' : ia.ligada === false ? 'Desligada' : 'Ligada', ia.pausada ? 'ruim' : ia.ligada === false ? '' : 'bom'),
        num('Falhas na última hora', fmtN(f?.ultimaHora), f && f.ultimaHora >= (L.falhasIaHora || 5) ? 'ruim' : ''),
        num('Falhas em 24 h', fmtN(f?.ultimas24h)),
        num('Última falha', quando(f?.ultimaEm))),
      f?.ultimoErro ? el('div', { class: 'rl-vazio', text: `Último erro: ${f.ultimoErro}` }) : null);

    const md = r.midias;
    const midias = painel('Fotos, áudios e arquivos', 'download das mídias que as clientes mandam', 'rl-g6',
      md ? nums(
        num('Baixando agora', fmtN(md.pendentes)),
        num('Tentando de novo', fmtN(md.tentando), md.tentando ? 'ruim' : ''),
        num('Não baixaram (24 h)', fmtN(md.falhas24h), md.falhas24h >= (L.midiasFalhas24h || 10) ? 'ruim' : md.falhas24h ? '' : 'bom')) : vazio('Sem medição neste servidor.'));

    const w = r.whatsapp;
    const whats = painel('Números de WhatsApp', w ? (w.servidor.ok ? 'servidor do WhatsApp respondendo' : 'o servidor do WhatsApp não está respondendo') : null, 'rl-g6',
      w && w.canais.length ? el('div', { class: 'sd-canais', role: 'list' }, ...w.canais.map((c) => el('div', { class: 'sd-canal', role: 'listitem', 'data-estado': c.estado },
        el('i', { 'aria-hidden': 'true' }),
        el('span', {}, el('b', { text: c.nome || c.id }), el('small', { text: c.estado === 'conectado' ? `última mensagem ${quando(c.ultimaMensagemEm)}` : c.motivo || (c.precisaParear ? 'precisa ler o QR Code em Conexões' : c.reconectando ? 'tentando reconectar' : '') })),
        el('span', { text: `${ESTADO[c.estado] || c.estado} · ${quando(c.desde)}` }))))
        : vazio('Nenhum número de WhatsApp conectado.'));

    const p = r.processo;
    const atr = p?.atrasoMs;
    const proc = painel('O aplicativo no servidor', p ? `ligado desde ${new Date(p.iniciadoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · Node ${p.node}` : null, 'rl-g6',
      p ? nums(
        num('Memória em uso', fmtMB(p.memoria.rss), p.memoria.rss > (L.memoriaRssBytes || 838860800) ? 'ruim' : ''),
        num('Memória do JavaScript', `${fmtMB(p.memoria.heapUsado)} de ${fmtMB(p.memoria.limiteHeap)}`),
        num('Tempo no ar', fmtNoAr(p.noArSeg)),
        num('Folga do processador', atr ? (atr.p99 > (L.atrasoProcessadorMs || 200) ? `apertado (${fmtMs(atr.p99)})` : `ok (${fmtMs(atr.p99)})`) : '—', atr && atr.p99 > (L.atrasoProcessadorMs || 200) ? 'ruim' : atr ? 'bom' : '')) : vazio('—'));

    const b = r.banco;
    const banco = painel('Banco de dados', b ? (b.ok ? 'respondendo' : 'sem resposta') : 'sem banco neste servidor (memória)', 'rl-g6',
      b ? nums(
        num('Responde em', b.latenciaMs == null ? '—' : fmtMs(b.latenciaMs), b.ok === false || (b.latenciaMs != null && b.latenciaMs > (L.bancoLatenciaMs || 200)) ? 'ruim' : b.latenciaMs != null ? 'bom' : ''),
        num('Tamanho', fmtMB(b.tamanhoBytes)),
        num('Conexões abertas', fmtN(b.conexoes)),
        num('Do app (livres / total)', b.pool ? `${fmtN(b.pool.livres)} / ${fmtN(b.pool.total)}` : '—'),
        num('Esperando conexão', b.pool ? fmtN(b.pool.esperando) : '—', b.pool?.esperando ? 'ruim' : '')) : vazio('Os dados ficam só na memória do app.'),
      b?.erro ? el('div', { class: 'rl-vazio', text: `Erro: ${b.erro}` }) : null);

    const rodape = el('div', { class: 'sd-rodape' },
      el('span', { text: 'Atualiza sozinho a cada 15 s enquanto esta tela está aberta.' }),
      el('button', { type: 'button', class: 'so-pc', text: 'Atualizar agora', onclick: () => caixa.dispatchEvent(new Event('sd-agora')) }));
    caixa.replaceChildren(el('div', { class: 'sd' }, geral, el('div', { class: 'rl-grade' }, filas, aparecer, iaP, whats, midias, proc, banco), rodape));
  }

  function montar(caixa, ui) {
    estilo();
    let ultimo = null;
    let erro = null;
    let quandoPediu = null;
    let timer = 0;
    let pedindo = false;
    const vivo = () => caixa.isConnected;
    async function pedir() {
      if (!vivo() || pedindo) return;
      if (document.visibilityState === 'hidden') { agendar(); return; }
      pedindo = true;
      try {
        ultimo = await ui.api('/api/saude/painel');
        erro = null;
        quandoPediu = new Date().toISOString();
      } catch (x) {
        erro = x.message || 'Verifique a internet.';
      } finally {
        pedindo = false;
      }
      if (!vivo()) return;
      desenhar(caixa, ui, ultimo, erro, quandoPediu || new Date().toISOString());
      agendar();
    }
    function agendar() {
      clearTimeout(timer);
      if (vivo()) timer = setTimeout(pedir, INTERVALO);
    }
    const aoVoltar = () => { if (!vivo()) { removeEventListener('visibilitychange', aoVoltar); return; } if (document.visibilityState === 'visible') pedir(); };
    addEventListener('visibilitychange', aoVoltar);
    caixa.addEventListener('sd-agora', () => { clearTimeout(timer); pedir(); });
    desenhar(caixa, ui, null, null, null);
    // A caixa só entra na página depois que a tela Análises termina de montar: pede no próximo instante.
    setTimeout(pedir, 0);
  }

  window.SintoniaSaude = { montar };
})();
