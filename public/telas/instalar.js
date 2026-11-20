/* Instalar o app (PWA) e ligar as notificações no celular. Registra window.SintoniaInstalar = { itens(), abrir(), instalado() }.
 * - Android / Chrome / Edge: usa o evento beforeinstallprompt (o pedido de instalação do próprio navegador).
 * - iPhone / iPad no Safari: mostra o passo a passo "Compartilhar › Adicionar à Tela de Início".
 * - Já instalado (display-mode: standalone): o item some. No iPhone instalado, se as notificações ainda não
 *   foram pedidas, aparece "Ativar notificações" (o pedido sai do toque da pessoa, como o iPhone exige).
 * Os itens entram no grupo "Você" do menu Mais (public/app.html).
 */
(() => {
  const ehIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const ehAndroid = /Android/.test(navigator.userAgent);
  const instalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let pedido = null; // o evento beforeinstallprompt guardado para usar no toque

  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pedido = e; });
  addEventListener('appinstalled', () => { pedido = null; window.Sintonia?.ui?.toast?.('Pronto: a Sintonia está na sua tela inicial.'); });

  const CSS = `
  .ins-passos { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; counter-reset: passo; }
  .ins-passos li { counter-increment: passo; display: flex; gap: 12px; align-items: flex-start; padding: 14px; border-radius: 16px; background: var(--painel); box-shadow: inset 0 0 0 1px var(--linha); font-size: 15px; line-height: 1.45; }
  .ins-passos li::before { content: counter(passo); flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 13px; color: #fff; background: var(--marca-azul, #106ebe); }
  .ins-passos li > span { flex: 1; min-width: 0; padding-top: 2px; }
  .ins-passos svg { display: inline-block; width: 18px; height: 18px; vertical-align: -3px; margin: 0 2px; }
  .ins-dica { margin: 14px 2px 0; font-size: 13.5px; color: var(--sub); line-height: 1.5; }
  .ins-bt { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 100%; min-height: 48px; margin-top: 16px; border-radius: 14px; font-weight: 700; font-size: 15px; color: #fff; background: var(--marca-azul, #106ebe); }
  .ins-bt:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 2px; }
  `;
  const ICONE = {
    instalar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M12 8v6M9.5 11.5 12 14l2.5-2.5"/><path d="M10.5 18.5h3"/></svg>',
    sino: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    compartilhar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Compartilhar"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-label="Adicionar"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  };
  let estilo = false;
  const el = (tag, at = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(at)) { if (v == null || v === false) continue; if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
    e.append(...filhos.filter(Boolean));
    return e;
  };
  const li = (html) => el('li', {}, el('span', { html })); // o texto num span só: o número é o ::before

  const toast = (t) => window.Sintonia?.ui?.toast?.(t);

  function pagina(titulo, montar) {
    if (!estilo) { estilo = true; document.head.append(el('style', { id: 'instalar-css', text: CSS })); }
    const P = window.SintoniaPainel;
    if (!P) return;
    const op = { id: 'instalar', titulo, montar };
    if (P.aberto()) P.empurrar(op); else P.abrir(op);
  }

  /** Passo a passo do iPhone (Safari): Compartilhar › Adicionar à Tela de Início. */
  function ajudaIphone() {
    pagina('Adicionar à Tela de Início', (corpo) => corpo.append(
      el('p', { class: 'ins-dica', style: 'margin:0 2px 14px', text: 'No iPhone, a Sintonia vira app pelo Safari. Leva 10 segundos:' }),
      el('ol', { class: 'ins-passos' },
        li(`Toque em <b>Compartilhar</b> ${ICONE.compartilhar} na barra do Safari (embaixo ou em cima da tela).`),
        li(`Role a lista e toque em <b>Adicionar à Tela de Início</b> ${ICONE.mais}.`),
        li('Toque em <b>Adicionar</b>, no canto de cima.'),
        li('Abra a Sintonia pelo ícone novo e, em <b>Mais › Notificações</b>, toque em <b>Ativar notificações</b>.')),
      el('p', { class: 'ins-dica', text: 'Não achou "Adicionar à Tela de Início"? Confira se está no Safari (no Chrome do iPhone fica no menu Compartilhar também) e se o iPhone está no iOS 16.4 ou mais novo, para receber as notificações.' })));
  }

  /** Sem o pedido do navegador (já recusado, ou navegador que não oferece): onde fica a opção no menu. */
  function ajudaNavegador() {
    pagina('Instalar o app', (corpo) => corpo.append(
      el('ol', { class: 'ins-passos' },
        ...(ehAndroid
          ? [li('Toque no menu do navegador <b>⋮</b> (no canto de cima).'), li('Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.'), li('Confirme. A Sintonia aparece junto dos seus apps.')]
          : [li('No Chrome ou no Edge, clique no ícone de <b>instalar</b> na barra de endereço (um computador com uma seta).'), li('Ou abra o menu <b>⋮</b> e escolha <b>Instalar Sintonia</b> (no Edge: <b>Apps › Instalar este site como app</b>).'), li('Confirme. A Sintonia abre na própria janela, como um app.')])),
      el('p', { class: 'ins-dica', text: 'Se a opção não aparecer, o app já pode estar instalado neste aparelho, ou este navegador não instala sites.' })));
  }

  async function abrir() {
    if (instalado()) { toast('A Sintonia já está instalada neste aparelho.'); return; }
    if (pedido) {
      const e = pedido; pedido = null;
      try {
        await e.prompt();
        const r = await e.userChoice;
        if (r?.outcome === 'accepted') toast('Instalando a Sintonia…');
      } catch { ajudaNavegador(); }
      return;
    }
    if (ehIOS) ajudaIphone(); else ajudaNavegador();
  }

  /** Itens do grupo "Você" do Mais (só o que faz sentido neste aparelho, agora). */
  function itens() {
    const lista = [];
    if (!instalado()) {
      lista.push({ nome: 'Instalar o app', sub: ehIOS ? 'Pôr a Sintonia na Tela de Início' : 'Abrir a Sintonia como um app', ic: ICONE.instalar, cor: '#0f766e', acao: abrir });
    } else if ('Notification' in window && 'PushManager' in window && Notification.permission === 'default') {
      // App instalado (no iPhone, o único jeito de ter push) e notificações ainda não pedidas.
      lista.push({ nome: 'Ativar notificações', sub: 'Receber os avisos neste aparelho', ic: ICONE.sino, cor: '#ef4444', acao: () => window.SintoniaTelas?.notificacoes?.ativarPush?.() });
    }
    return lista;
  }

  window.SintoniaInstalar = { itens, abrir, instalado, ajudaIphone };
})();
