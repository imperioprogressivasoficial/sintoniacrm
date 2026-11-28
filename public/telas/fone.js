/* contato-nome: telefone no padrão do dono (21/11) em todas as telas — "+55 (71) 99220-0365".
 * Fixo com 8 dígitos: "+55 (71) 3333-4444". Aceita com ou sem 55, com ou sem o 9º dígito, com máscara ou não.
 * De outro país: "+<DDI> " e o resto agrupado ("+351 912 345 678", "+1 (415) 555-2671").
 * Só para mostrar: no banco o número continua só com dígitos. Mesma regra de src/leads/telefone-br.ts (formatarTelefoneBR).
 * Também decide o que mostrar como nome: nome com letra é nome; vazio, número ou só símbolos vira o telefone formatado. */
(function () {
  'use strict';
  const DDDS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53,
    54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
  const DDI_1 = new Set(['1', '7']);
  const DDI_2 = new Set(['20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55',
    '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98']);

  function agrupar(d) {
    if (d.length <= 4) return d;
    const g = [];
    let i = 0;
    while (d.length - i > 4) { g.push(d.slice(i, i + 3)); i += 3; }
    g.push(d.slice(i));
    return g.join(' ');
  }

  function formatar(t) {
    const texto = String(t == null ? '' : t).trim();
    if (!texto || /[a-z]/i.test(texto)) return texto;
    let d = texto.replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length < 8) return texto;
    const comMais = texto.startsWith('+');
    if (!comMais && (d.length === 10 || d.length === 11) && DDDS.has(Number(d.slice(0, 2))) && (d.length === 10 || d[2] === '9')) d = '55' + d;
    if (d.startsWith('55') && (d.length === 12 || d.length === 13) && DDDS.has(Number(d.slice(2, 4)))) {
      const ddd = d.slice(2, 4);
      let local = d.slice(4);
      if (local.length === 8 && /^[6-9]/.test(local)) local = '9' + local;
      if (local.length === 9) return `+55 (${ddd}) ${local.slice(0, 5)}-${local.slice(5)}`;
      return `+55 (${ddd}) ${local.slice(0, 4)}-${local.slice(4)}`;
    }
    const cc = DDI_1.has(d.slice(0, 1)) ? d.slice(0, 1) : DDI_2.has(d.slice(0, 2)) ? d.slice(0, 2) : d.slice(0, 3);
    const resto = d.slice(cc.length);
    if (cc === '1' && resto.length === 10) return `+1 (${resto.slice(0, 3)}) ${resto.slice(3, 6)}-${resto.slice(6)}`;
    return `+${cc} ${agrupar(resto)}`;
  }

  const LETRA = /\p{L}/u;
  /** Nome com pelo menos uma letra? (número, "...", emojis sozinhos não contam) */
  const temNome = (n) => LETRA.test(String(n == null ? '' : n));
  /** O que mostrar para a pessoa: o nome, ou o telefone formatado. */
  const rotulo = (nome, telefone) => (temNome(nome) ? String(nome).trim() : telefone ? formatar(telefone) : String(nome || '').trim() ? formatar(nome) : '');

  window.SintoniaFone = { formatar, temNome, rotulo };

  /* Nome muito grande (120 letras, ou uma palavra só sem espaço) nunca quebra a tela: uma linha com "…" onde ainda faltava
   * (lista, cabeçalho, cartões e chips já cortam); na ficha, até 3 linhas. */
  if (typeof document === 'undefined') return;
  const st = document.createElement('style');
  st.dataset.contatoNome = '';
  st.textContent = `
    .item .nome, #c-nome, .ct-pessoa b, .ft-nome span, .agx-txt b, .lg-txt b, .iax-txt b, .rt-chip span, .rt-cli, .cartao .t b {
      min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    html #ficha.cux-ficha .cux-heroi #f-nome, html #f-nome {
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; }
    .nt-texto, .nt-titulo { overflow-wrap: anywhere; }
  `;
  (document.head || document.documentElement).append(st);
})();
