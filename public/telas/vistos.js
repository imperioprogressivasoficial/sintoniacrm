/*
 * vistos: os "vistos" das mensagens da loja, iguais aos do WhatsApp.
 *   relógio      = ainda enviando (a Sintonia ainda não recebeu a confirmação do WhatsApp)
 *   ✓ cinza      = saiu, mas ainda não chegou no celular da cliente (sem internet, celular desligado)
 *   ✓✓ cinza     = chegou no celular da cliente
 *   ✓✓ azul      = a cliente viu
 *   ouvida       = áudio de voz tocado: ✓✓ azul e o microfone do balão fica azul
 *   alerta verm. = o WhatsApp avisou que não entregou
 * Mensagens antigas, sem aviso nenhum, contam como "saiu" (um ✓).
 * Registra window.SintoniaVistos = { estado(m), el(entrega), seloAudio(m) }.
 */
(() => {
  const AZUL = '#53bdeb'; // o mesmo azul dos vistos do WhatsApp
  const css = `
  :root { --vistos-cinza: #667781; --vistos-azul: ${AZUL}; --vistos-falha: #e5484d; --vistos-mic: #8696a0; }
  /* balão da loja no escuro é azul forte: cinza mais claro e azul mais claro, para dar para diferenciar */
  html[data-tema="escuro"] { --vistos-cinza: #8fa4b8; --vistos-falha: #ff6b6f; --vistos-mic: rgba(234, 243, 252, .62);
    --vistos-cinza-bal: rgba(234, 243, 252, .62); --vistos-azul-bal: #8fe3ff; }
  span.vistos { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 16px; height: 11px; color: var(--vistos-cinza); vertical-align: -1px; }
  .bal .meta span.vistos svg, .item .previa span.vistos svg { width: 16px; height: 11px; display: block; color: inherit !important; overflow: visible; margin: 0; }
  .bal .meta span.vistos[data-estado="enviando"] svg, .item .previa span.vistos[data-estado="enviando"] svg { width: 12px; }
  span.vistos[data-estado="lida"], span.vistos[data-estado="ouvida"] { color: var(--vistos-azul); }
  span.vistos[data-estado="falhou"] { color: var(--vistos-falha); }
  .bal.env .meta span.vistos { color: var(--vistos-cinza-bal, var(--vistos-cinza)); }
  .bal.env .meta span.vistos[data-estado="lida"], .bal.env .meta span.vistos[data-estado="ouvida"] { color: var(--vistos-azul-bal, var(--vistos-azul)); }
  .bal.env .meta span.vistos[data-estado="falhou"] { color: var(--vistos-falha); }
  /* foto ou vídeo sem legenda: a hora fica por cima da imagem (branca com sombra); o azul continua azul */
  .bal.midia.so-midia:not(.sem-sombra) .meta span.vistos[data-estado="enviando"],
  .bal.midia.so-midia:not(.sem-sombra) .meta span.vistos[data-estado="enviada"],
  .bal.midia.so-midia:not(.sem-sombra) .meta span.vistos[data-estado="entregue"] { color: var(--midia-meta); }
  .item .previa span.vistos { margin-right: 3px; }
  /* áudio de voz da loja: microfone cinza até a cliente ouvir, azul depois (como no WhatsApp) */
  .bal.env .audio .selo.nao-ouvida { color: var(--vistos-mic); }
  .bal.env .audio .selo.ouvida { color: var(--vistos-azul-bal, var(--vistos-azul)); }
  .bal.vistos-enviando { opacity: .85; }
  `;
  const st = document.createElement('style');
  st.id = 'vistos-css';
  st.textContent = css;
  (document.head || document.documentElement).append(st);

  // Traço fino e pontas arredondadas, como no WhatsApp. Só texto fixo (nada do servidor entra aqui).
  const UM = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.2 5.9 6 8.6l6.4-7"/></svg>';
  const DOIS = '<svg viewBox="0 0 16 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M.9 5.9 3.7 8.6l6.4-7"/><path d="m7.1 8.1.5.5 6.4-7"/></svg>';
  const RELOGIO = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="4.6"/><path d="M6 3.4V6l1.7 1.1"/></svg>';
  const FALHOU = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" style="width:14px!important;height:14px!important"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.3v4.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.4" r="1.05" fill="#fff"/></svg>';
  const DESENHO = { enviando: RELOGIO, enviada: UM, entregue: DOIS, lida: DOIS, ouvida: DOIS, falhou: FALHOU };
  const ROTULO = {
    enviando: 'Enviando…',
    enviada: 'Enviada (ainda não chegou no celular da cliente)',
    entregue: 'Entregue no celular da cliente',
    lida: 'Lida pela cliente',
    ouvida: 'A cliente ouviu o áudio',
    falhou: 'Não entregue: o WhatsApp avisou que a mensagem não chegou',
  };

  /** Estado dos vistos de uma mensagem (ou do valor de `entrega`). Sem aviso = saiu (um ✓). */
  function estado(m) {
    const e = typeof m === 'string' || m == null ? m : m.entrega;
    if (e === 'ouvida' && m && typeof m === 'object' && m.anexo && m.anexo.tipo !== 'audio') return 'lida';
    return Object.prototype.hasOwnProperty.call(DESENHO, e) ? e : 'enviada';
  }

  /** <span class="vistos"> com o desenho e o rótulo para leitor de tela. */
  function el(m) {
    const e = estado(m);
    const s = document.createElement('span');
    s.className = 'vistos';
    s.dataset.estado = e;
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', ROTULO[e]);
    s.title = ROTULO[e];
    s.innerHTML = DESENHO[e];
    return s;
  }

  /** Classe do microfone no balão de áudio de voz da loja: cinza até ouvir, azul depois. */
  const seloAudio = (m) => (!m || m.autor === 'cliente' || !m.anexo?.voz ? '' : estado(m) === 'ouvida' ? ' ouvida' : ' nao-ouvida');

  // ---------- relógio: balão "enviando" enquanto o servidor ainda não respondeu ----------
  const pendentes = new Map(); // token -> { conversaId, texto, em }
  let seq = 0;
  const hora = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  function balaoEnviando(p) {
    const b = document.createElement('div');
    b.className = 'bal env vistos-enviando';
    b.dataset.autor = 'enviando';
    b.append(document.createTextNode(p.texto));
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = hora(p.em);
    meta.append(el('enviando'));
    b.append(meta);
    return b;
  }
  /** Põe no fim da conversa os balões que ainda estão saindo (chamado a cada desenho da conversa). */
  function noFim(caixa, conversaId) {
    for (const p of pendentes.values()) if (p.conversaId === conversaId) caixa.append(p.no = balaoEnviando(p));
  }
  const enviando = {
    /** Mostra o balão com relógio já, antes da resposta do servidor. Devolve um código para tirar depois. */
    adicionar(conversaId, texto) {
      const token = ++seq;
      const p = { conversaId, texto: String(texto || ''), em: new Date() };
      pendentes.set(token, p);
      const caixa = document.getElementById('msgs');
      if (caixa && caixa.dataset.conversa === conversaId) { caixa.append(p.no = balaoEnviando(p)); caixa.scrollTop = caixa.scrollHeight; }
      return token;
    },
    /** Saiu (o balão de verdade vem no próximo desenho) ou deu erro: tira o balão provisório. */
    tirar(token) {
      const p = pendentes.get(token);
      pendentes.delete(token);
      p?.no?.remove();
    },
  };

  window.SintoniaVistos = { estado, el, seloAudio, noFim, enviando, ROTULO };
})();
