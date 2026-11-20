/* Celular (≤760px): troca simples "Conversas · Grupos · Equipe" no topo da lista de Conversas, abaixo do título,
 * e no topo das telas de Grupos e de Equipe (para voltar). No computador o menu lateral em cascata já faz isso.
 * A aba Equipe só aparece se window.SintoniaTelas.equipe existir (tela feita à parte).
 * Registra window.SintoniaAbasConversas = { barra(atual), contar(vista, n) }: cada tela chama barra('grupos'|'chat-equipe').
 * A aba Equipe abre o chat interno (vista "chat-equipe", window.SintoniaTelas.equipe.abrir()). */
(() => {
  const CSS = `
  .cv-abas { display: none; }
  @media (max-width: 760px) {
    .cv-abas { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: color-mix(in srgb, var(--texto) 7%, transparent); }
    .cv-aba { all: unset; cursor: pointer; flex: 1; box-sizing: border-box; height: 32px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      font-size: 14px; font-weight: 600; color: var(--sub); -webkit-tap-highlight-color: transparent; }
    .cv-aba[aria-selected="true"] { background: var(--fundo); color: var(--texto); box-shadow: 0 1px 3px rgba(0,0,0,.12), inset 0 0 0 1px var(--linha); }
    html[data-tema="escuro"] .cv-aba[aria-selected="true"] { background: color-mix(in srgb, var(--texto) 14%, transparent); box-shadow: none; }
    .cv-aba:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 1px; }
    .cv-aba i { font-style: normal; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; display: inline-grid; place-items: center;
      font-size: 11px; font-weight: 700; background: var(--badge, #0ffcbe); color: var(--badge-txt, #0d2240); }
    .cv-aba i:empty { display: none; }
  }`;
  const ABAS = [
    { vista: 'conversas', nome: 'Conversas' },
    { vista: 'grupos', nome: 'Grupos' },
    // Chat interno da equipe: vista "chat-equipe" ("equipe" é a tela Atendentes e acessos; nunca mostrar('equipe')).
    { vista: 'chat-equipe', nome: 'Equipe', so: () => Boolean(window.SintoniaTelas?.equipe),
      abrir: () => (window.SintoniaTelas?.equipe?.abrir ? window.SintoniaTelas.equipe.abrir() : (window.Sintonia?.ui?.mostrar || window.Sintonia?.mostrar)?.('chat-equipe')) },
  ];
  /** "equipe" (nome antigo) vale como "chat-equipe". */
  const normal = (v) => (v === 'equipe' ? 'chat-equipe' : v);
  const barras = new Set();
  const contagens = {};

  function preencher(b) {
    const atual = b.dataset.atual;
    b.replaceChildren();
    for (const a of ABAS) {
      if (a.so && !a.so()) continue;
      const bt = document.createElement('button');
      bt.type = 'button'; bt.className = 'cv-aba'; bt.setAttribute('role', 'tab'); bt.dataset.vista = a.vista;
      bt.setAttribute('aria-selected', String(a.vista === atual));
      bt.append(document.createTextNode(a.nome));
      const n = document.createElement('i'); n.textContent = a.vista !== atual && contagens[a.vista] > 0 ? String(contagens[a.vista] > 99 ? '99+' : contagens[a.vista]) : '';
      bt.append(n);
      bt.addEventListener('click', () => { if (a.vista === atual) return; if (a.abrir) a.abrir(); else window.Sintonia?.mostrar?.(a.vista); });
      b.append(bt);
    }
  }

  function barra(atual) {
    if (!document.getElementById('cv-abas-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'cv-abas-css', textContent: CSS }));
    const b = document.createElement('div');
    b.className = 'cv-abas'; b.setAttribute('role', 'tablist'); b.setAttribute('aria-label', 'Tipo de conversa'); b.dataset.atual = normal(atual);
    preencher(b); barras.add(b);
    return b;
  }

  function contar(vista, n) {
    vista = normal(vista);
    if (contagens[vista] === n) return;
    contagens[vista] = n;
    for (const b of barras) { if (b.isConnected) preencher(b); else barras.delete(b); }
  }

  window.SintoniaAbasConversas = { barra, contar, refazer: () => barras.forEach((b) => b.isConnected && preencher(b)) };

  // Lista de Conversas: logo abaixo do título.
  function colocarNaLista() {
    const titulo = document.querySelector('#v-conversas .lista-topo .titulo-linha');
    if (!titulo || titulo.parentElement.querySelector(':scope > .cv-abas')) return;
    titulo.after(barra('conversas'));
  }
  colocarNaLista();
  // A tela de Equipe pode carregar depois: refaz as barras para a aba aparecer.
  addEventListener('load', () => { colocarNaLista(); window.SintoniaAbasConversas.refazer(); }, { once: true });
})();
