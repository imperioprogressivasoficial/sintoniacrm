/* Selo de tempo da lista de conversas (pedido do dono em 20/11), no lugar do horário da última mensagem:
 * - Cliente esperando a nossa resposta: cronômetro correndo (4:07 · 1:04:12 · 2d 03h).
 *   Até 10 min = branco (vidro neutro) · de 10 min a 1 h = amarelo · mais de 1 h = vermelho.
 *   O horário em que a mensagem chegou continua visível, pequeno, na linha de baixo.
 * - Já respondemos e a cliente ainda não voltou: horário em vidro branco (a bola está com ela).
 * - Atendimento finalizado (e ela não escreveu depois): horário em verde com um ✓.
 * Registra window.SintoniaTelas.esperaSelo = { hora(c, u), chegou(c) }. O relógio atualiza só o texto, 1x por segundo,
 * e só quando há cronômetro na tela (nada de animação). */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ts-selo { flex: none; margin-left: auto; display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 8px; border-radius: 999px;
    font: 600 11.5px/1 var(--fonte, system-ui); font-variant-numeric: tabular-nums; letter-spacing: .01em; white-space: nowrap;
    color: var(--ts-cor); background: var(--ts-fundo); border: 1px solid var(--ts-borda); box-shadow: inset 0 1px 0 rgba(255,255,255,.35); }
  .ts-selo svg { width: 11px; height: 11px; flex: none; opacity: .85; }
  .ts-selo.neutro { --ts-cor: var(--sub, #5b6b80); --ts-fundo: rgba(255,255,255,.55); --ts-borda: rgba(13,34,64,.10); }
  .ts-selo.espera.neutro { --ts-cor: var(--texto, #0d2240); }
  .ts-selo.amarelo { --ts-cor: #8a5a00; --ts-fundo: rgba(245,183,0,.13); --ts-borda: rgba(245,183,0,.38); }
  .ts-selo.vermelho { --ts-cor: #b3261e; --ts-fundo: rgba(229,57,53,.09); --ts-borda: rgba(229,57,53,.30); }
  .ts-selo.verde { --ts-cor: #0b7a52; --ts-fundo: rgba(15,190,130,.10); --ts-borda: rgba(15,190,130,.32); }
  html[data-tema="escuro"] .ts-selo { box-shadow: inset 0 1px 0 rgba(255,255,255,.06); }
  html[data-tema="escuro"] .ts-selo.neutro { --ts-cor: rgba(255,255,255,.72); --ts-fundo: rgba(255,255,255,.07); --ts-borda: rgba(255,255,255,.12); }
  html[data-tema="escuro"] .ts-selo.espera.neutro { --ts-cor: #fff; }
  html[data-tema="escuro"] .ts-selo.amarelo { --ts-cor: #ffd666; --ts-fundo: rgba(255,200,40,.10); --ts-borda: rgba(255,200,40,.28); }
  html[data-tema="escuro"] .ts-selo.vermelho { --ts-cor: #ff9a92; --ts-fundo: rgba(255,90,80,.10); --ts-borda: rgba(255,90,80,.28); }
  html[data-tema="escuro"] .ts-selo.verde { --ts-cor: #5ef0b8; --ts-fundo: rgba(15,252,190,.08); --ts-borda: rgba(15,252,190,.24); }
  .ts-chegou { flex: none; font: 500 11px/1 var(--fonte, system-ui); color: var(--sub, #5b6b80); font-variant-numeric: tabular-nums; white-space: nowrap; }
  @media (max-width: 760px) {
    .ts-selo { height: 22px; padding: 0 9px; font-size: 12.5px; }
    .ts-chegou { font-size: 12px; margin-top: 3px; }
  }
  /* O destaque antigo (linha inteira vermelha + selo vermelho forte) sai: o selo novo já mostra a espera. */
  #itens .item.esp-item, #itens .item.esp-item.esp-item-1 { box-shadow: none; background: none; }
  #itens .esp-tempo { display: none; }
  `;
  if (!document.getElementById('ts-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'ts-css', textContent: CSS }));

  const RELOGIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M10 2.5h4"/></svg>';
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const ms = (d) => (d ? new Date(d).getTime() : 0);
  const dois = (n) => String(n).padStart(2, '0');
  const hm = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  /** Cronômetro: 0:42 · 4:07 · 1:04:12 · 2d 03h */
  function cronometro(seg) {
    seg = Math.max(0, Math.floor(seg));
    const d = Math.floor(seg / 86400), h = Math.floor((seg % 86400) / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
    if (d) return `${d}d ${dois(h)}h`;
    if (h) return `${h}:${dois(m)}:${dois(s)}`;
    return `${m}:${dois(s)}`;
  }
  const cor = (seg) => (seg >= 3600 ? 'vermelho' : seg >= 600 ? 'amarelo' : 'neutro');
  const esperando = (c) => { const cl = ms(c.ultimaMensagemCliente); return Boolean(cl) && cl > Math.max(ms(c.ultimaMensagemEquipe), ms(c.ultimaMensagemIa)); };
  const finalizada = (c) => Boolean(c.finalizadaEm) && ms(c.finalizadaEm) >= ms(c.ultimaMensagemCliente);

  function selo(classe, icone, texto, titulo) {
    const s = document.createElement('span');
    s.className = 'ts-selo ' + classe; s.title = titulo; s.setAttribute('aria-label', titulo);
    if (icone) s.insertAdjacentHTML('beforeend', icone);
    const t = document.createElement('span'); t.textContent = texto; s.append(t);
    return s;
  }

  /** O que vai no lugar do horário da linha. `textoHora` = o horário que a lista já mostraria (Hoje 14:32 / Ontem / 12/11). */
  function hora(c, textoHora) {
    if (finalizada(c)) return selo('verde', CHECK, textoHora, 'Atendimento finalizado');
    if (esperando(c)) {
      const seg = (Date.now() - ms(c.ultimaMensagemCliente)) / 1000;
      const s = selo('espera ' + cor(seg), RELOGIO, cronometro(seg), `Esperando resposta. Chegou às ${hm(c.ultimaMensagemCliente)}`);
      s.dataset.desde = String(ms(c.ultimaMensagemCliente));
      ligar();
      return s;
    }
    return selo('neutro', '', textoHora, 'Respondida. Esperando a cliente');
  }
  /** Horário em que chegou a mensagem que está esperando (vai na linha de baixo). Nada quando não está esperando. */
  function chegou(c, textoHora) {
    if (finalizada(c) || !esperando(c)) return null;
    const s = document.createElement('span');
    const d = new Date(c.ultimaMensagemCliente); const hoje = new Date(); const ontem = new Date(hoje.getTime() - 86400000);
    const dia = d.toDateString() === hoje.toDateString() ? '' : d.toDateString() === ontem.toDateString() ? 'Ontem ' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ';
    s.className = 'ts-chegou'; s.textContent = dia + hm(d); s.title = 'Horário em que a mensagem chegou';
    return s;
  }

  let relogio = null;
  function ligar() { if (!relogio) relogio = setInterval(tique, 1000); }
  function tique() {
    const todos = document.querySelectorAll('.ts-selo.espera[data-desde]');
    if (!todos.length) { clearInterval(relogio); relogio = null; return; }
    if (document.hidden) return;
    const agora = Date.now();
    for (const s of todos) {
      const seg = (agora - Number(s.dataset.desde)) / 1000;
      const t = cronometro(seg); const alvo = s.lastChild;
      if (alvo.textContent !== t) alvo.textContent = t;
      const c = cor(seg);
      if (!s.classList.contains(c)) { s.classList.remove('neutro', 'amarelo', 'vermelho'); s.classList.add(c); }
    }
  }

  window.SintoniaTelas.esperaSelo = { hora, chegou, cronometro };
})();
