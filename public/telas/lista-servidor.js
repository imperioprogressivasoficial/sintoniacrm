/* robustez: lista de Conversas sem o corte de 500 (window.SintoniaListaServidor).
 *
 * O servidor manda as conversas mais recentes (padrão 300) a cada 4 s, com ETag (sem novidade = 304, nada é baixado).
 * Este módulo completa a lista:
 *  - busca no servidor: ao digitar 2+ letras em "Pesquisar", pede /api/conversas?q= (nome, telefone ou texto das
 *    mensagens) e junta os achados na lista — acha cliente antiga que não estava entre as recentes;
 *  - rolagem infinita: perto do fim da lista, pede a página seguinte (?antes=<cursor>) e junta;
 *  - com filtro que deixa a lista quase vazia (ex.: "Não lidas"), vai buscando páginas mais antigas sozinho
 *    (até ~3.000 conversas) para o filtro achar as que existem.
 * A lista da tela continua sendo `estado.conversas` (app.html); `juntar` devolve a página recente + o que foi carregado
 * a mais, sem repetir, da mais recente para a mais antiga. Nada aqui muda o visual.
 */
(() => {
  const LIMITE = 300;
  const MAX_EXTRAS = 3000;
  let base = [];
  const extras = new Map();
  let achados = new Set();
  let termo = '';
  let fim = false;
  let carregando = null;
  let pedidoBusca = 0;

  const ordenar = (a, b) => (new Date(b.atualizadaEm) - new Date(a.atualizadaEm)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
  const cursorDe = (c) => {
    const s = `${new Date(c.atualizadaEm).toISOString()}|${c.id}`;
    return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const avisar = () => dispatchEvent(new CustomEvent('sintonia:lista'));

  async function pedir(qs) {
    const r = await fetch('/api/conversas?' + qs, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('lista ' + r.status);
    return r.json();
  }

  /** Página recente (do servidor) + o que foi carregado a mais. Sem `lista`, usa a última página recebida. */
  function juntar(lista) {
    if (Array.isArray(lista)) {
      base = lista;
      // Conversa que voltou para a página recente sai dos "a mais" (vale a versão nova).
      for (const c of lista) extras.delete(c.id);
    }
    if (!extras.size) return base.slice();
    const ids = new Set(base.map((c) => c.id));
    return [...base, ...[...extras.values()].filter((c) => !ids.has(c.id))].sort(ordenar);
  }

  async function maisAntigas() {
    if (fim || carregando || termo) return carregando;
    const todas = juntar();
    const ultima = todas.at(-1);
    if (!ultima || todas.length < LIMITE) { fim = todas.length < LIMITE && !!ultima; return; }
    if (extras.size >= MAX_EXTRAS) return;
    carregando = (async () => {
      try {
        const pagina = await pedir(`limite=${LIMITE}&antes=${encodeURIComponent(cursorDe(ultima))}`);
        for (const c of pagina) if (!base.some((b) => b.id === c.id)) extras.set(c.id, c);
        if (pagina.length < LIMITE) fim = true;
        if (pagina.length) avisar();
      } catch { /* sem rede: tenta de novo na próxima rolagem */ }
      finally { carregando = null; }
    })();
    return carregando;
  }

  async function buscar(texto) {
    const q = String(texto || '').trim();
    termo = q.length >= 2 ? q : '';
    const meu = ++pedidoBusca;
    if (!termo) { if (achados.size) { achados = new Set(); avisar(); } return; }
    await new Promise((r) => setTimeout(r, 280)); // espera parar de digitar
    if (meu !== pedidoBusca) return;
    try {
      const lista = await pedir(`limite=100&q=${encodeURIComponent(termo)}`);
      if (meu !== pedidoBusca) return;
      achados = new Set(lista.map((c) => c.id));
      for (const c of lista) if (!base.some((b) => b.id === c.id)) extras.set(c.id, c);
      avisar();
    } catch { /* busca local continua valendo */ }
  }

  /** A busca do servidor achou esta conversa (pelo texto de alguma mensagem, por exemplo)? */
  const achou = (id) => !!termo && achados.has(id);

  // Busca: os dois campos (lista e menu lateral) já se espelham no app.html.
  for (const id of ['busca', 'lt-busca']) document.getElementById(id)?.addEventListener('input', (e) => void buscar(e.target.value));

  // Rolagem infinita: perto do fim da caixa que rola a lista.
  const perto = (el) => el && el.scrollHeight - el.scrollTop - el.clientHeight < 900;
  document.addEventListener('scroll', (e) => {
    const t = e.target;
    const itens = document.getElementById('itens');
    if (!itens || !t || !(t === document || (t.contains && t.contains(itens)))) return;
    const caixa = t === document ? document.scrollingElement : t;
    if (perto(caixa)) void maisAntigas();
  }, { capture: true, passive: true });

  // Filtro que deixou a lista quase vazia: busca mais antigas sozinho (uma página de cada vez).
  let conferindo = false;
  function conferirPoucas() {
    if (conferindo) return;
    conferindo = true;
    requestAnimationFrame(() => {
      conferindo = false;
      const itens = document.getElementById('itens');
      if (!itens || !itens.offsetParent) return;
      if (itens.querySelectorAll('.item').length < 30) void maisAntigas();
    });
  }
  addEventListener('sintonia:lista', conferirPoucas);
  document.addEventListener('click', (e) => { if (e.target.closest?.('#filtros, .pilula-filtro, #painel-filtros')) setTimeout(conferirPoucas, 50); }, true);

  window.SintoniaListaServidor = { juntar, buscar, achou, maisAntigas, conferirPoucas, situacao: () => ({ base: base.length, extras: extras.size, fim, termo }) };
})();
