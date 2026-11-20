/* Cantos chanfrados (escolha do dono em 20/11): SÓ no cartão do lead do funil (CRM), no computador.
 * O resto do sistema continua com os cantos arredondados de sempre. */
(() => {
  const css = `@media (min-width: 761px) {
  #v-funil .fn-cartao { border-radius: 4px !important;
    clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
}`;
  document.head.append(Object.assign(document.createElement('style'), { id: 'chanfro-css', textContent: css }));
})();
