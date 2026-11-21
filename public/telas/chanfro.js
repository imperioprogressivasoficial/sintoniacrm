/* Cantos chanfrados (escolha do dono em 20/11): o cartão do lead do funil (CRM), no computador.
 * crm-topo (21/11): o mesmo chanfro vale no molde do Pipeline (colunas, quadro e lista), em /telas/funil-topo.js. */
(() => {
  const css = `@media (min-width: 761px) {
  #v-funil .fn-cartao { border-radius: 4px !important;
    clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
}`;
  document.head.append(Object.assign(document.createElement('style'), { id: 'chanfro-css', textContent: css }));
})();
