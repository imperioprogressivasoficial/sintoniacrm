/**
 * Ícones da Sintonia (conversa-ux): um conjunto só, desenhado na mesma grade de 24px, traço 1.8,
 * pontas e cantos arredondados, sem preenchimento. Use em qualquer tela:
 *   window.SintoniaIcones.svg('ligar')          -> texto do <svg>
 *   window.SintoniaIcones.el('ligar', 'classe') -> elemento <svg>
 * O tamanho vem do CSS (width/height do svg); a cor, de `color` (currentColor).
 */
(function () {
  const P = {
    // conversa: topo
    voltar: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
    agendar: '<rect x="3.75" y="5" width="16.5" height="15.25" rx="3"/><path d="M3.75 9.75h16.5M8.25 3v3.5M15.75 3v3.5M12 12.75v4.5M9.75 15h4.5"/>',
    ligar: '<path d="M6.6 3.75h2.1c.5 0 .9.3 1 .8l.9 3.3c.1.4 0 .9-.4 1.1l-1.6 1.1a11.6 11.6 0 0 0 5.35 5.35l1.1-1.6c.25-.35.7-.5 1.1-.4l3.3.9c.5.1.8.5.8 1v2.1c0 1.15-.95 2.1-2.1 2.05C10.2 19.1 4.9 13.8 4.55 5.85A2.05 2.05 0 0 1 6.6 3.75Z"/>',
    radar: '<circle cx="12" cy="12" r="8.25"/><circle cx="12" cy="12" r="4.25"/><path d="M12 12l5.5-5.5"/>',
    // conversa: barra de envio
    mais: '<path d="M12 5v14M5 12h14"/>',
    respostas: '<path d="M20.25 11.6a8.25 8.25 0 0 1-12 7.35l-3.9 1.05 1.05-3.75A8.25 8.25 0 1 1 20.25 11.6Z"/><path d="m12.9 7.5-2.4 4.25h3l-2.4 4.25"/>',
    figurinha: '<path d="M20.25 12.75V7.5a3.75 3.75 0 0 0-3.75-3.75h-9A3.75 3.75 0 0 0 3.75 7.5v9a3.75 3.75 0 0 0 3.75 3.75h5.25"/><path d="M20.25 12.75h-3.75a3.75 3.75 0 0 0-3.75 3.75v3.75l7.5-7.5Z"/>',
    camera: '<path d="M3.75 9A2.25 2.25 0 0 1 6 6.75h1.6l1.5-2.25h5.8l1.5 2.25H18A2.25 2.25 0 0 1 20.25 9v8.25A2.25 2.25 0 0 1 18 19.5H6a2.25 2.25 0 0 1-2.25-2.25V9Z"/><circle cx="12" cy="12.75" r="3.4"/>',
    mic: '<rect x="8.75" y="3" width="6.5" height="11.25" rx="3.25"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    enviar: '<path d="M20.5 12 4.75 4.5l2.6 7.5-2.6 7.5L20.5 12Z"/><path d="M7.35 12h6.4"/>',
    lixeira: '<path d="M4.5 7h15M9.5 7V4.75h5V7M6.5 7l.85 12.25c.05.7.65 1.25 1.35 1.25h6.6c.7 0 1.3-.55 1.35-1.25L17.5 7M10 11v5.5M14 11v5.5"/>',
    documento: '<path d="M13.75 3.75H7.5A2.25 2.25 0 0 0 5.25 6v12A2.25 2.25 0 0 0 7.5 20.25h9A2.25 2.25 0 0 0 18.75 18V8.75l-5-5Z"/><path d="M13.75 3.75v5h5M9 13h6M9 16.5h4"/>',
    foto: '<rect x="3.75" y="4.5" width="16.5" height="15" rx="3"/><circle cx="9" cy="9.75" r="1.6"/><path d="m4.5 17.25 4.6-4.6a1.5 1.5 0 0 1 2.1 0l1.8 1.8m-1 1.55 2.6-2.6a1.5 1.5 0 0 1 2.1 0l3.55 3.55"/>',
    // ficha e ações
    copiar: '<rect x="8.25" y="8.25" width="12" height="12" rx="2.5"/><path d="M15.75 8.25V6.25a2.5 2.5 0 0 0-2.5-2.5h-7a2.5 2.5 0 0 0-2.5 2.5v7a2.5 2.5 0 0 0 2.5 2.5h2"/>',
    estrela: '<path d="m12 3.9 2.45 5 5.5.8-3.98 3.88.94 5.47L12 16.47l-4.91 2.58.94-5.47L4.05 9.7l5.5-.8L12 3.9Z"/>',
    etapa: '<path d="M4 6.75h9.5M4 12h12.5M4 17.25h16"/><circle cx="16.5" cy="6.75" r="1.75"/><circle cx="19.5" cy="12" r="1.75"/>',
    tag: '<path d="M3.75 12.4V5.25c0-.85.65-1.5 1.5-1.5h7.15c.4 0 .8.15 1.05.45l6.85 6.85c.6.6.6 1.55 0 2.1l-7.15 7.15c-.55.6-1.5.6-2.1 0L4.2 13.45a1.5 1.5 0 0 1-.45-1.05Z"/><circle cx="8.25" cy="8.25" r="1.35"/>',
    pessoa: '<circle cx="12" cy="8.25" r="3.75"/><path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0"/>',
    sem_pessoa: '<circle cx="12" cy="8.25" r="3.75" stroke-dasharray="2.4 2.2"/><path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" stroke-dasharray="2.4 2.2"/>',
    unidade: '<path d="M12 21s-6.75-5.6-6.75-11.25a6.75 6.75 0 0 1 13.5 0C18.75 15.4 12 21 12 21Z"/><circle cx="12" cy="9.75" r="2.4"/>',
    dinheiro: '<rect x="3" y="6" width="18" height="12" rx="2.75"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v.01M17.5 14.5v.01"/>',
    historico: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.75h3.75"/><path d="M12 8.25V12l2.6 1.6"/>',
    origem: '<path d="M10.25 13.75a3.75 3.75 0 0 0 5.3 0l3.2-3.2a3.75 3.75 0 0 0-5.3-5.3l-1.1 1.1"/><path d="M13.75 10.25a3.75 3.75 0 0 0-5.3 0l-3.2 3.2a3.75 3.75 0 0 0 5.3 5.3l1.1-1.1"/>',
    notas: '<path d="M14.5 4.75H6.75A2 2 0 0 0 4.75 6.75v10.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V9.5"/><path d="m17.75 3.5 2.75 2.75-7.25 7.25-3.5.75.75-3.5 7.25-7.25Z"/>',
    editar: '<path d="M4.5 19.5h4l10-10a2.83 2.83 0 0 0-4-4l-10 10v4Z"/><path d="m13.25 6.75 4 4"/>',
    texto: '<path d="M5 6.5h14M5 11h14M5 15.5h9"/>',
    seta: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    fechar: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    relogio: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.75V12l2.75 1.75"/>',
    check: '<path d="m5.5 12.5 4.25 4.25L18.5 8"/>',
    ia: '<path d="M12 3.75 13.6 8.4l4.65 1.6-4.65 1.6L12 16.25l-1.6-4.65L5.75 10l4.65-1.6L12 3.75Z"/><path d="M18.5 15.5l.6 1.65 1.65.6-1.65.6-.6 1.65-.6-1.65-1.65-.6 1.65-.6.6-1.65Z"/>',
  };
  const svg = (nome, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra ? ' ' + extra : ''}>${P[nome] || ''}</svg>`;
  function el(nome, classe) {
    const t = document.createElement('template');
    t.innerHTML = svg(nome, classe ? `class="${classe}"` : '');
    return t.content.firstChild;
  }
  window.SintoniaIcones = { svg, el, nomes: Object.keys(P) };
})();
