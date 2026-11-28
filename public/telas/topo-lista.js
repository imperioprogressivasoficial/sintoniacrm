/* Topo igual nas três listas do celular (pedido do dono em 21/11): Conversas, Grupos e Equipe com a mesma barra de cima
 * — ⋯ (opções da tela) à esquerda, a pílula lua + sino e o botão de ação redondo à direita —, o mesmo fundo em
 * degradê (sem a caixa branca) e a mesma busca em caixa. No computador nada muda (a barra de cima é só do celular).
 * window.SintoniaTopoLista({ menu: [{ nome, ic, acao }], acao: { ic, titulo, onclick, escuro } }) → elemento .titulo */
(() => {
  const CSS = `
  .tl-topo { display: none; }
  @media (max-width: 760px) {
    .tl-topo { display: flex; align-items: center; gap: 10px; height: 46px; position: relative; }
    .tl-topo .espaco { flex: 1; }
    .tl-topo .tl-menu { position: absolute; top: 54px; left: 0; }
    /* as telas de Grupos e de Equipe sem a caixa branca por trás: o mesmo degradê de Conversas */
    #v-grupos > .painel, #v-chat-equipe > .ceq { background: transparent; }
    .gp .lista-topo, .ceq .lista-topo { padding-top: 6px; }
    .gp .lista-topo .titulo-grande, .ceq .lista-topo h1.titulo-grande { margin: 2px 0 8px; }
    /* no celular o que estava solto no título vai para a barra de cima */
    .gp .titulo-linha > .gp-sinc, .ceq .ceq-acoes { display: none !important; }
  }`;
  const PONTOS = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

  function criar({ menu = [], acao = null } = {}) {
    if (!document.getElementById('tl-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'tl-css', textContent: CSS }));
    const topo = document.createElement('div'); topo.className = 'titulo tl-topo';
    const caixaMenu = document.createElement('div'); caixaMenu.className = 'menu-lista tl-menu'; caixaMenu.hidden = true; caixaMenu.setAttribute('role', 'menu');
    for (const m of menu) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); if (m.id) b.dataset.id = m.id;
      b.innerHTML = m.ic || ''; const t = document.createElement('span'); t.textContent = m.nome; b.append(t);
      b.addEventListener('click', () => { caixaMenu.hidden = true; m.acao(); });
      caixaMenu.append(b);
    }
    const mais = document.createElement('button'); mais.type = 'button'; mais.className = 'icone redondo'; mais.title = 'Mais opções'; mais.setAttribute('aria-label', 'Mais opções'); mais.innerHTML = PONTOS;
    mais.addEventListener('click', (e) => { e.stopPropagation(); caixaMenu.hidden = !caixaMenu.hidden; });
    document.addEventListener('pointerdown', (e) => { if (!caixaMenu.hidden && !caixaMenu.contains(e.target) && e.target !== mais && !mais.contains(e.target)) caixaMenu.hidden = true; }, true);
    // ⋯ só aparece quando o menu tem alguma opção à mostra (ex.: Grupos sem arquivados)
    const conferir = () => { mais.style.visibility = [...caixaMenu.children].some((b) => !b.hidden) ? '' : 'hidden'; };
    conferir(); new MutationObserver(conferir).observe(caixaMenu, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    const espaco = document.createElement('span'); espaco.className = 'espaco';
    topo.append(mais, espaco);
    if (window.SintoniaTopoGrupo) topo.append(window.SintoniaTopoGrupo());
    if (acao) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'icone redondo' + (acao.escuro === false ? '' : ' branco') + (acao.classe ? ' ' + acao.classe : '');
      b.title = acao.titulo; b.setAttribute('aria-label', acao.titulo); b.innerHTML = acao.ic;
      b.addEventListener('click', acao.onclick);
      topo.append(b); topo.acao = b;
    }
    topo.append(caixaMenu);
    return topo;
  }
  window.SintoniaTopoLista = criar;
})();
