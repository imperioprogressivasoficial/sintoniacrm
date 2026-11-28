/* whatsapp-estavel: faixa "WhatsApp desconectado" no topo de Conversas.
 * Lê /api/whatsapp/saude (a cada 60 s e quando o app volta à tela). Some sozinha quando o canal volta.
 * A administração vê o botão "Reconectar" (abre Conexões › WhatsApp); o resto da equipe vê para avisar alguém.
 * Sem animação contínua; claro e escuro; textos sempre por textContent. */
(() => {
  const css = document.createElement('style');
  css.textContent = `
  .ws-faixa{margin:0 12px 8px;padding:10px 12px;border-radius:14px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;
    background:color-mix(in srgb,#e5484d 10%,var(--fundo,#fff));color:var(--texto);
    box-shadow:inset 0 0 0 1px color-mix(in srgb,#e5484d 38%,transparent)}
  .ws-faixa.ws-servidor{background:color-mix(in srgb,#f2a93b 13%,var(--fundo,#fff));box-shadow:inset 0 0 0 1px color-mix(in srgb,#f2a93b 45%,transparent)}
  .ws-faixa svg{width:22px;height:22px;flex:none;color:#e5484d}
  .ws-faixa.ws-servidor svg{color:#c27a12}
  .ws-faixa .ws-t{flex:1 1 200px;min-width:0;font-size:13px;line-height:1.3}
  .ws-faixa .ws-t b{display:block;font-size:13.5px}
  .ws-faixa .ws-t span{color:var(--sub);overflow-wrap:anywhere}
  .ws-faixa a{flex:none;margin-left:auto;text-decoration:none;font-size:13px;font-weight:700;padding:8px 12px;border-radius:999px;color:#fff;
    background:linear-gradient(90deg,#106ebe,#3aa0ff)}
  .ws-faixa a:focus-visible{outline:2px solid #0ffcbe;outline-offset:2px}
  html[data-tema="escuro"] .ws-faixa{background:color-mix(in srgb,#e5484d 18%,#0d2240)}
  html[data-tema="escuro"] .ws-faixa.ws-servidor{background:color-mix(in srgb,#f2a93b 16%,#0d2240)}
  html[data-tema="escuro"] .ws-faixa svg{color:#ff8a8a}
  html[data-tema="escuro"] .ws-faixa.ws-servidor svg{color:#f6c06b}`;
  document.head.appendChild(css);

  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.3-1.2A8.5 8.5 0 1 0 12 3.5Z"/><path d="M12 8.5v4.2M12 15.8v.01"/></svg>';

  let caixa = null;
  function lugar() {
    if (caixa && caixa.isConnected) return caixa;
    const itens = document.getElementById('itens');
    if (!itens || !itens.parentElement) return null;
    caixa = document.createElement('div');
    caixa.id = 'ws-faixas';
    caixa.setAttribute('role', 'status');
    caixa.setAttribute('aria-live', 'polite');
    itens.parentElement.insertBefore(caixa, itens);
    return caixa;
  }

  function faixa({ titulo, texto, servidor, link }) {
    const d = document.createElement('div');
    d.className = 'ws-faixa' + (servidor ? ' ws-servidor' : '');
    d.innerHTML = ICONE; // ícone fixo (sem dado do servidor)
    const t = document.createElement('div');
    t.className = 'ws-t';
    const b = document.createElement('b'); b.textContent = titulo;
    const s = document.createElement('span'); s.textContent = texto;
    t.append(b, s);
    d.append(t);
    if (link) {
      const a = document.createElement('a');
      a.href = '/conexoes#nao-oficial';
      a.textContent = 'Reconectar';
      d.append(a);
    }
    return d;
  }

  async function atualizar() {
    const alvo = lugar();
    if (!alvo) return;
    let r;
    try {
      const resp = await fetch('/api/whatsapp/saude', { credentials: 'same-origin' });
      if (!resp.ok) return;
      r = await resp.json();
    } catch { return; } // sem internet: a faixa fica como estava
    const lista = [];
    if (r.servidor && r.servidor.ok === false) {
      lista.push(faixa({
        servidor: true,
        titulo: 'Servidor do WhatsApp sem resposta',
        texto: 'As mensagens podem não chegar nem sair. A Sintonia continua tentando.',
      }));
    }
    for (const c of r.canais || []) {
      const acao = r.podeReconectar
        ? (c.reconectando ? 'Tentando religar sozinho. Se não voltar, toque em Reconectar.' : 'Toque em Reconectar.')
        : 'Avise a administração para reconectar.';
      lista.push(faixa({
        titulo: `WhatsApp ${c.nome} desconectado`,
        texto: `${c.motivo ? c.motivo + '. ' : ''}As mensagens deste número não chegam nem saem. ${acao}`,
        link: r.podeReconectar,
      }));
    }
    alvo.replaceChildren(...lista);
  }

  atualizar();
  setInterval(() => { if (!document.hidden) atualizar(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
  addEventListener('online', atualizar);
})();
