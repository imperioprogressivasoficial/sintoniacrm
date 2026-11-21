/* conversa-extra: silenciar e arquivar conversas de cliente (como no WhatsApp) — window.SintoniaConversaExtra.
 * Tudo é por pessoa (src/conversa/pessoal.ts): o que a Carla silencia ou arquiva não muda nada para a gerente.
 * - Silenciar por 8 horas, 1 semana ou sempre: sem som, vibração e push dessa conversa (alertas.js e o servidor
 *   respeitam); a linha ganha o sino cortado e a bolinha de não lida fica cinza.
 * - Arquivar: sai da lista e vai para "Arquivadas (N)", no topo da lista. Mensagem nova da cliente tira do
 *   arquivo sozinha. Continua no Pipeline, com a IA e com os alarmes de espera.
 * Ganchos: app.html (bloco "conversa-extra": filtradas → passa(c), desenharLista → topoLista()/sino(c), contador
 * sem as arquivadas), conversas-gestos.js (acoes(c) no "Mais" e no segurar; fazer(acao, c)) e conversa-extras.js
 * (secaoMenu(c, fechar) na folha "Atendimento e IA", com o atalho do papel de parede).
 * Também troca o pontinho de "IA atendendo" (chip da conversa, folha e filtro) pela foto da Serena.
 * Texto vindo do servidor entra sempre por textContent. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const { api, post, el, toast, estado } = ui;

  const ic = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const SVG = {
    sino: ic('<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    sinoCortado: ic('<path d="M8.6 5.1A6 6 0 0 1 18 11v4"/><path d="M6 11v5l-1.5 2H17"/><path d="M10 20a2 2 0 0 0 4 0"/><path d="M3.5 3.5l17 17"/>'),
    arquivo: ic('<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M10 12.5h4"/>'),
    desarquivar: ic('<rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path d="M12 17.5v-6M9.5 14 12 11.5 14.5 14"/>'),
    papel: ic('<rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="m4 16 4.5-4.5 3.5 3.5 2.5-2.5L20 18"/><circle cx="15.5" cy="8.5" r="1.6"/>'),
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  const foto = window.SintoniaSerenaFoto;
  const CSS = `
  #itens .item .cx-sino { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; color: var(--sub); margin-left: 4px; }
  #itens .item .cx-sino svg { width: 16px; height: 16px; }
  #itens .item:has(.cx-sino) .badge { background: color-mix(in srgb, var(--sub) 70%, transparent) !important; color: #fff; box-shadow: none; }
  /* Arquivadas: o mesmo visual da tela de Grupos */
  #itens .item.cx-arq-linha { height: 56px; min-height: 56px; }
  #itens .item.cx-arq-linha .avatar { background: transparent; color: var(--sub); display: grid; place-items: center; box-shadow: none; }
  #itens .item.cx-arq-linha .avatar svg { width: 24px; height: 24px; }
  #itens .item.cx-arq-linha .corpo { min-height: 56px; padding-top: 0; padding-bottom: 0; justify-content: center; }
  #itens .item.cx-arq-linha .nome { font-weight: 600; font-size: 16px; }
  #itens .item.cx-arq-linha .hora { color: var(--sub); font-weight: 600; }
  #itens .item.cx-arq-linha .badge { margin-left: 6px; }
  @media (max-width: 760px) {
    #itens .item.cx-arq-linha { align-items: center; min-height: 60px; height: 60px; }
    #itens .item.cx-arq-linha .avatar { margin-top: 0; width: 54px; height: 32px; }
    #itens .item.cx-arq-linha .corpo { min-height: 60px; padding: 0 14px 0 0; }
  }
  #itens .cx-arq-aviso { padding: 4px 16px 10px; font-size: 13px; line-height: 18px; color: var(--sub); }
  .cx-volta-arq { all: unset; cursor: pointer; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); background: var(--painel); flex: none; margin-right: 8px; }
  .cx-volta-arq svg { width: 22px; height: 22px; }
  .cx-volta-arq[hidden] { display: none; }
  #v-conversas .titulo-linha:has(.cx-volta-arq:not([hidden])) { display: flex; align-items: center; }
  /* folha do silenciar */
  .cx-sil .folha-lista button[aria-pressed="true"] b::after { content: " ✓"; color: #106ebe; }
  html[data-tema="escuro"] .cx-sil .folha-lista button[aria-pressed="true"] b::after { color: #0ffcbe; }
  .cx-sil-sub { margin: -2px 4px 12px; font-size: 14px; color: var(--sub); text-align: center; }
  ${foto ? `
  /* foto da Serena no lugar do pontinho de "IA atendendo" */
  html .linha-compor .modo[data-m="ia"] i, html .modo[data-m="ia"] i, html .cx-status.ia > i, html #filtros .chip[data-f="ia"] .luz {
    width: 20px; height: 20px; border-radius: 50%; background: #0d2240 center / cover no-repeat url("${foto}"); box-shadow: 0 0 0 1.5px rgba(15,252,190,.65); }
  .cx-status.ia > i { width: 28px; height: 28px; }
  ` : ''}`;
  document.head.append(Object.assign(document.createElement('style'), { id: 'cx-extra-css', textContent: CSS }));

  // ------------------------------------------------------------ arquivadas
  let arquivo = false;
  const arquivadas = () => (estado.conversas || []).filter((c) => c.arquivada);
  /** Gancho de filtradas(): fora do arquivo some a arquivada; no arquivo, só elas. Pesquisando, aparece tudo (como no WhatsApp). */
  function passa(c) {
    if (estado.busca) return true;
    return Boolean(c.arquivada) === arquivo;
  }
  let linhaArq = null, linhaArqAss = '', aviso = null;
  /** Gancho de desenharLista(): a linha "Arquivadas (N)" no topo, ou o aviso quando o arquivo está aberto. */
  function topoLista() {
    const lista = arquivadas();
    if (arquivo && !lista.length) trocar(false, true);
    pintarTopo();
    if (estado.busca) return null;
    if (arquivo) {
      aviso ??= el('div', { class: 'cx-arq-aviso', text: 'Voltam para a lista quando a cliente manda mensagem nova. Arquivar é só para você: a equipe continua vendo, e a IA, o Pipeline e os alarmes seguem normais.' });
      return aviso;
    }
    if (!lista.length) return null;
    const naoLidas = lista.filter((c) => ui.naoLida(c)).length;
    const ass = `${lista.length}|${naoLidas}`;
    if (linhaArq && ass === linhaArqAss) return linhaArq;
    linhaArqAss = ass;
    linhaArq = el('button', { class: 'item cx-arq-linha', type: 'button', 'aria-label': `Arquivadas: ${lista.length} conversa${lista.length === 1 ? '' : 's'}${naoLidas ? `, ${naoLidas} não lida${naoLidas === 1 ? '' : 's'}` : ''}`, onclick: () => trocar(true) },
      el('span', { class: 'avatar', html: SVG.arquivo }),
      el('div', { class: 'corpo' },
        el('div', { class: 'l1' }, el('span', { class: 'nome', text: 'Arquivadas' }),
          naoLidas ? el('span', { class: 'badge', text: naoLidas > 99 ? '99+' : String(naoLidas), title: 'Conversas arquivadas não lidas' }) : el('span', { class: 'hora', text: String(lista.length) }))));
    return linhaArq;
  }
  let volta = null;
  function pintarTopo() {
    const linha = document.querySelector('#v-conversas .titulo-linha');
    const h1 = linha?.querySelector('h1');
    if (!linha || !h1) return;
    if (!volta) {
      volta = el('button', { class: 'cx-volta-arq', type: 'button', title: 'Voltar às conversas', 'aria-label': 'Voltar às conversas', html: SVG.voltar, hidden: '', onclick: () => trocar(false) });
      linha.insertBefore(volta, h1);
    }
    volta.hidden = !arquivo;
    const t = arquivo ? 'Arquivadas' : 'Conversas';
    if (h1.textContent !== t) h1.textContent = t;
    const abas = document.querySelector('#v-conversas .cv-abas'); if (abas) abas.style.display = arquivo ? 'none' : '';
  }
  function trocar(sim, semDesenhar) {
    if (arquivo === sim) return;
    arquivo = sim;
    const caixa = document.getElementById('itens'); if (caixa) caixa.scrollTop = 0;
    pintarTopo();
    if (!semDesenhar) ui.desenharLista();
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && arquivo && ui.estado.vista === 'conversas' && !document.querySelector('dialog[open]') && !ui.estado.aberta) trocar(false); });

  // ------------------------------------------------------------ silenciada
  const ateTxt = (c) => {
    if (!c.silenciadaAte) return 'Silenciada para sempre';
    const d = new Date(c.silenciadaAte);
    const hoje = new Date().toDateString() === d.toDateString();
    return `Silenciada até ${hoje ? 'as ' : ''}${d.toLocaleString('pt-BR', hoje ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
  };
  /** Gancho da linha da lista: o sino cortado. */
  function sino(c) {
    if (!c.silenciada) return '';
    return el('span', { class: 'cx-sino', title: ateTxt(c), 'aria-label': ateTxt(c), html: SVG.sinoCortado });
  }
  const silenciada = (id) => Boolean((estado.conversas || []).find((c) => c.id === id)?.silenciada);

  async function silenciar(c, duracao) {
    try {
      const r = await post('/api/conversas/silenciar', { ids: [c.id], duracao });
      if (!r.conversas) { toast('Essa conversa não está mais na sua lista.'); return; }
      c.silenciada = r.silenciada; c.silenciadaAte = r.silenciadaAte;
      toast(duracao === 'nao' ? 'O som desta conversa voltou.' : duracao === 'sempre' ? 'Conversa silenciada para sempre.' : duracao === '8h' ? 'Conversa silenciada por 8 horas.' : 'Conversa silenciada por 1 semana.');
      redesenhar();
    } catch (x) { toast(x.message || 'Não deu agora.'); }
  }
  async function arquivar(c, sim) {
    try {
      const r = await post('/api/conversas/arquivar', { ids: [c.id], arquivar: sim });
      if (!r.conversas) { toast('Essa conversa não está mais na sua lista.'); return; }
      c.arquivada = sim;
      toast(sim ? 'Conversa arquivada. Ela volta sozinha quando a cliente escrever.' : 'Conversa de volta na lista.');
      // Arquivou a conversa aberta no celular: volta para a lista, como no WhatsApp.
      if (sim && estado.aberta === c.id && innerWidth <= 760) document.getElementById('voltar')?.click();
      redesenhar();
    } catch (x) { toast(x.message || 'Não deu agora.'); }
  }
  function redesenhar() {
    window.SintoniaTelas?.conversasGestos?.fechar?.();
    ui.desenharLista();
    ui.atualizar?.();
  }

  // ------------------------------------------------------------ folhas
  function folha(id, titulo, sub) {
    document.getElementById(id)?.remove();
    const d = el('dialog', { class: 'folha cx-sil', id, 'aria-label': titulo });
    const corpo = el('div', {});
    d.append(el('div', { class: 'folha-topo' }, el('span'), el('h2', { text: titulo }), el('button', { type: 'button', class: 'icone fechar-folha', 'aria-label': 'Fechar', html: SVG.fechar, onclick: () => d.close() })),
      sub ? el('p', { class: 'cx-sil-sub', text: sub }) : null, corpo);
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => setTimeout(() => d.remove(), 300));
    document.body.append(d);
    d.showModal();
    return { d, corpo };
  }
  const item = (svg, titulo, sub, onclick, extra = {}) => el('button', { type: 'button', html: svg, onclick, ...extra }, el('span', {}, el('b', { text: titulo }), sub ? el('small', { text: sub }) : null));

  /** Escolher por quanto tempo silenciar (ou voltar o som). */
  function escolherSilencio(c) {
    const { d, corpo } = folha('cx-folha-sil', 'Silenciar conversa', c.silenciada ? ateTxt(c) : 'Sem som, vibração e aviso no celular desta conversa. Só para você.');
    const vai = (dur) => () => { d.close(); silenciar(c, dur); };
    corpo.append(el('div', { class: 'folha-lista' },
      item(SVG.sinoCortado, '8 horas', null, vai('8h')),
      item(SVG.sinoCortado, '1 semana', null, vai('1sem')),
      item(SVG.sinoCortado, 'Sempre', null, vai('sempre'), { 'aria-pressed': String(Boolean(c.silenciada && !c.silenciadaAte)) }),
      c.silenciada ? item(SVG.sino, 'Ativar o som', 'Volta a tocar e avisar desta conversa', vai('nao')) : null));
  }

  /** Ações para os gestos da lista (segurar e "Mais"). */
  function acoes(c) {
    return [
      { acao: 'cx-silenciar', svg: c.silenciada ? SVG.sino : SVG.sinoCortado, texto: c.silenciada ? 'Ativar o som' : 'Silenciar', sub: c.silenciada ? ateTxt(c) : 'Sem som e sem aviso desta conversa' },
      { acao: 'cx-arquivar', svg: c.arquivada ? SVG.desarquivar : SVG.arquivo, texto: c.arquivada ? 'Desarquivar' : 'Arquivar', sub: c.arquivada ? 'Volta para a lista de conversas' : 'Sai da lista até a cliente escrever de novo' },
    ];
  }
  function fazer(acao, c) {
    if (acao === 'cx-silenciar') return c.silenciada ? silenciar(c, 'nao') : escolherSilencio(c);
    if (acao === 'cx-arquivar') return arquivar(c, !c.arquivada);
    if (acao === 'cx-papel') return window.SintoniaPapelParede?.abrir?.();
  }

  /** Seção "Esta conversa" na folha "Atendimento e IA" (o menu da conversa aberta). */
  function secaoMenu(cAberta, fechar) {
    const c = (estado.conversas || []).find((x) => x.id === cAberta.id) || cAberta;
    const ir = (fn) => () => { fechar(); setTimeout(fn, 60); };
    const op = (svg, titulo, sub, onclick) => el('button', { type: 'button', class: 'cx-op neutra', onclick }, el('i', { html: svg }), el('span', {}, el('b', { text: titulo }), sub ? el('small', { text: sub }) : null));
    return [
      el('div', { class: 'cx-secao', text: 'Esta conversa' }),
      el('div', { class: 'folha-lista' },
        op(c.silenciada ? SVG.sino : SVG.sinoCortado, c.silenciada ? 'Ativar o som' : 'Silenciar', c.silenciada ? ateTxt(c) : 'Por 8 horas, 1 semana ou sempre', ir(() => (c.silenciada ? silenciar(c, 'nao') : escolherSilencio(c)))),
        op(c.arquivada ? SVG.desarquivar : SVG.arquivo, c.arquivada ? 'Desarquivar' : 'Arquivar', c.arquivada ? 'Volta para a lista de conversas' : 'Sai da lista até a cliente escrever de novo', ir(() => arquivar(c, !c.arquivada))),
        window.SintoniaPapelParede ? op(SVG.papel, 'Papel de parede', 'O fundo das suas conversas', ir(() => window.SintoniaPapelParede.abrir())) : null),
    ];
  }

  window.SintoniaConversaExtra = { passa, topoLista, sino, silenciada, acoes, fazer, secaoMenu, emArquivo: () => arquivo, sair: () => trocar(false) };
  // Primeiro desenho com os ganchos (a lista pode ter sido desenhada antes deste arquivo carregar).
  if (estado.conversas?.length) ui.desenharLista();
})();
