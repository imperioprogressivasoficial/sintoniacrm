/* balao-fantasma (pedido do dono 21/11): a sugestão de resposta da IA aparece DENTRO da conversa, como o último balão,
 * do lado direito (onde a resposta da loja vai ficar), tracejado e sem fundo, com o rótulo "Sugestão da Serena".
 * Embaixo do balão: Descartar, Editar e Enviar.
 * - Editar: põe o texto no campo de mensagem para mexer (o "Usar" de antes).
 * - Enviar: manda direto, pelo mesmo caminho do envio normal da atendente (ui.enviarTexto → POST /enviar),
 *   sem apagar o que estiver escrito no campo.
 * - Descartar: esconde aquela sugestão nesta aba (sessionStorage); não volta na atualização de 4 s.
 *   (O servidor não tem rota para descartar: a próxima sugestão nova aparece normalmente.)
 * Gancho no app.html (bloco "balao-fantasma" em desenharConversa): noFim(caixa, conversa, sugestao, mensagens).
 * O mesmo elemento é reposto a cada redesenho (não pisca nem treme) e entra antes do ajuste da rolagem.
 * A faixa antiga #sugestao fica escondida quando este arquivo está carregado. Sem animação em loop.
 * Texto vindo do servidor entra sempre por textContent. */
(() => {
  const ui = window.Sintonia && window.Sintonia.ui;
  if (!ui) return;
  const $ = (id) => document.getElementById(id);
  const CHAVE = 'sintonia.sugestoesDescartadas';
  const MAX_GUARDADAS = 200;

  const CSS = `
  #msgs .bf-sug { position: relative; order: 50; align-self: flex-end; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
    max-width: min(65%, 560px); margin: 12px 0 6px; }
  #msgs .bf-rot { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; line-height: 18px; color: var(--sub); }
  #msgs .bf-rot img, #msgs .bf-rot .bf-ic { width: 18px; height: 18px; border-radius: 50%; object-fit: cover; flex: none; display: block;
    box-shadow: 0 0 0 1.5px color-mix(in srgb, #3aa0ff 55%, transparent); }
  #msgs .bf-rot .bf-ic { display: grid; place-items: center; color: #3aa0ff; box-shadow: none; }
  #msgs .bf-rot .bf-ic svg { width: 16px; height: 16px; }
  #msgs .bal.bf-bal { align-self: flex-end; max-width: 100%; margin: 0; background: transparent; box-shadow: none;
    border: 1.5px dashed color-mix(in srgb, #3aa0ff 70%, transparent); border-radius: 12px; padding: 7px 11px 8px; color: var(--sub); }
  #msgs .bal.bf-bal::before { display: none; }
  #msgs .bf-acoes { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
  #msgs .bf-bt { font: 600 12.5px/1 var(--fonte, inherit); padding: 7px 12px; border-radius: 999px; cursor: pointer; min-height: 30px;
    border: 1px solid var(--linha); background: var(--painel, #fff); color: var(--texto); box-shadow: var(--sombra, none); }
  #msgs .bf-bt:hover { border-color: color-mix(in srgb, #3aa0ff 50%, var(--linha)); }
  #msgs .bf-bt:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  #msgs .bf-bt.p { background: #106ebe; border-color: #106ebe; color: #fff; }
  #msgs .bf-bt.p:hover { background: #0e63ab; border-color: #0e63ab; }
  #msgs .bf-bt[disabled] { opacity: .6; cursor: default; }
  html[data-tema="escuro"] #msgs .bf-bt.p { background: #0ffcbe; border-color: #0ffcbe; color: #0d2240; }
  html[data-tema="escuro"] #msgs .bf-bt.p:hover { background: #45ffd0; border-color: #45ffd0; }
  @media (max-width: 760px) { #msgs .bf-sug { max-width: 85%; } #msgs .bf-bt { padding: 8px 13px; min-height: 34px; } }
  `;
  const BRILHO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7L12 3.5Z"/></svg>';
  { const s = document.createElement('style'); s.id = 'balao-fantasma-css'; s.textContent = CSS; document.head.append(s); }

  /** Chave curta de uma sugestão (conversa + texto), para guardar o que foi descartado ou enviado. */
  const chaveDe = (conversaId, texto) => {
    let h = 5381; const s = String(texto);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${conversaId}:${s.length}:${(h >>> 0).toString(36)}`;
  };
  const lerGuardadas = () => { try { const v = JSON.parse(sessionStorage.getItem(CHAVE) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const memoria = new Set(lerGuardadas()); // vale mesmo se o sessionStorage estiver bloqueado
  function guardar(chave) {
    memoria.add(chave);
    const lista = [...memoria].slice(-MAX_GUARDADAS);
    try { sessionStorage.setItem(CHAVE, JSON.stringify(lista)); } catch {}
  }

  /** A sugestão responde à última mensagem da cliente: se a equipe (ou a IA) já respondeu depois, ela ficou velha. */
  function jaRespondida(mensagens) {
    for (let i = (mensagens || []).length - 1; i >= 0; i--) {
      const a = mensagens[i].autor;
      if (a === 'sistema') continue;
      return a !== 'cliente';
    }
    return false;
  }

  let atual = null; // { chave, no, conversaId, texto }

  function montar(conversaId, texto) {
    const el = ui.el;
    const chave = chaveDe(conversaId, texto);
    const foto = window.SintoniaSerenaFoto;
    const rotulo = el('div', { class: 'bf-rot' },
      foto ? el('img', { src: foto, alt: '', width: '18', height: '18', decoding: 'async' }) : el('span', { class: 'bf-ic', html: BRILHO }),
      el('span', { text: 'Sugestão da Serena' }));
    const bal = el('div', { class: 'bal env bf-bal', 'data-autor': 'sugestao' });
    bal.textContent = texto;
    const bt = (txt, classe, titulo, fn) => { const b = el('button', { type: 'button', class: 'bf-bt' + (classe ? ' ' + classe : ''), title: titulo, text: txt }); b.addEventListener('click', fn); return b; };
    const descartar = bt('Descartar', '', 'Esconder esta sugestão', () => { guardar(chave); tirar(); });
    const editar = bt('Editar', '', 'Pôr o texto no campo para mudar antes de enviar', () => ui.usarTexto(texto));
    const enviar = bt('Enviar', 'p', 'Enviar esta resposta agora', async () => {
      if (ui.estado.aberta !== conversaId) return;
      const botoes = [descartar, editar, enviar];
      botoes.forEach((b) => { b.disabled = true; }); enviar.textContent = 'Enviando…';
      let ok = false;
      try {
        if (typeof ui.enviarTexto === 'function') ok = await ui.enviarTexto(texto);
        else { ui.usarTexto(texto); $('enviar')?.click(); ok = false; }
      } catch { ok = false; }
      if (ok) { guardar(chave); tirar(); return; }
      botoes.forEach((b) => { b.disabled = false; }); enviar.textContent = 'Enviar';
    });
    const no = el('div', { class: 'bf-sug', 'data-bf': '1', role: 'group', 'aria-label': 'Sugestão de resposta da Serena' },
      rotulo, bal, el('div', { class: 'bf-acoes' }, descartar, editar, enviar));
    return { chave, no, conversaId, texto };
  }

  /** Tira o balão da tela sem mexer na rolagem de quem está lendo mais acima. */
  function tirar() {
    if (!atual) return;
    const caixa = atual.no.parentNode;
    const noFim = caixa ? caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80 : false;
    atual.no.remove(); atual = null;
    if (caixa && noFim) caixa.scrollTop = caixa.scrollHeight;
  }

  /** Chamado no fim de desenharConversa (antes da rolagem). Devolve true se o balão está na tela. */
  function noFim(caixa, c, sugestao, mensagens) {
    if (!caixa || !c) return false;
    caixa.querySelectorAll(':scope > [data-bf]').forEach((x) => { if (!atual || x !== atual.no) x.remove(); });
    const texto = typeof sugestao === 'string' ? sugestao.trim() : '';
    if (!texto || c.modo === 'humano' || jaRespondida(mensagens) || memoria.has(chaveDe(c.id, texto))) {
      if (atual) { atual.no.remove(); atual = null; }
      return false;
    }
    if (!atual || atual.chave !== chaveDe(c.id, texto)) { if (atual) atual.no.remove(); atual = montar(c.id, texto); }
    if (atual.no.parentNode !== caixa || caixa.lastElementChild !== atual.no) caixa.append(atual.no); // o mesmo elemento: não pisca
    return true;
  }

  window.SintoniaBalaoFantasma = { noFim, chaveDe, _jaRespondida: jaRespondida };

  // A conversa pode ter sido desenhada antes deste arquivo carregar: troca a faixa antiga pelo balão agora.
  const d = ui.estado?.detalhe; const caixa = $('msgs');
  if (d?.conversa && caixa && caixa.dataset.conversa === d.conversa.id) {
    const estavaNoFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
    if (noFim(caixa, d.conversa, d.sugestao, d.mensagens)) { const f = $('sugestao'); if (f) f.hidden = true; if (estavaNoFim) caixa.scrollTop = caixa.scrollHeight; }
  }
})();
