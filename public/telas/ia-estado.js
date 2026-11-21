/* ia-completa: "O que a IA faz" (Automações › Agente de IA): está pronta? o que falta? o que cada agente pode fazer?
 * Aba do estúdio de agentes (/telas/agentes-ia.js chama window.SintoniaTelas.iaEstado.desenhar(ctx)).
 * Lê GET /api/ia/estado (e ?testar=1 para chamar a agenda de cada unidade agora). Texto do servidor sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ICONE = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9"/></svg>',
    falta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
    neutro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    escudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 6v5c0 4.5 3 8.2 7 10 4-1.8 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
  };
  const CSS = `
  .iae-estado { display: flex; gap: 14px; align-items: center; min-width: 0; }
  .iae-estado .iae-sinal { width: 46px; height: 46px; border-radius: 15px; flex: none; display: grid; place-items: center; }
  .iae-estado .iae-sinal svg { width: 26px; height: 26px; }
  .iae-estado.ok .iae-sinal { background: rgba(15,252,190,.18); color: #0a9f7a; box-shadow: inset 0 0 0 1px rgba(15,252,190,.5); }
  .iae-estado.falta .iae-sinal { background: rgba(245,184,0,.16); color: #b88a00; box-shadow: inset 0 0 0 1px rgba(245,184,0,.45); }
  [data-tema="escuro"] .iae-estado.ok .iae-sinal { color: var(--marca-menta); }
  .iae-estado b { font-size: 18px; font-weight: 800; display: block; }
  .iae-linhas { display: grid; gap: 2px; }
  .iae-linha { display: flex; gap: 10px; align-items: flex-start; padding: 9px 2px; border-top: 1px solid var(--linha); min-width: 0; }
  .iae-linha:first-child { border-top: 0; }
  .iae-ic { width: 20px; height: 20px; flex: none; display: inline-grid; }
  .iae-ic svg { width: 100%; height: 100%; }
  .iae-linha > .iae-ic { margin-top: 1px; }
  .iae-linha.ok > .iae-ic { color: #0a9f7a; }
  [data-tema="escuro"] .iae-linha.ok > .iae-ic { color: var(--marca-menta); }
  .iae-linha.falta > .iae-ic { color: #c98f00; }
  .iae-linha.neutro > .iae-ic { color: var(--sub); }
  .agx-vidro h2 .iae-ic { color: var(--marca-azul); }
  [data-tema="escuro"] .agx-vidro h2 .iae-ic { color: var(--marca-menta); }
  .iae-linha .agx-txt { display: grid; gap: 2px; min-width: 0; flex: 1; overflow-wrap: anywhere; }
  .iae-linha .agx-txt b { font-size: 14.5px; }
  .iae-linha .agx-txt span { font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .iae-linha .agx-txt span.iae-onde { font-size: 12.5px; font-weight: 650; color: var(--marca-azul); }
  [data-tema="escuro"] .iae-linha .agx-txt span.iae-onde { color: var(--marca-menta); }
  .iae-grade { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); }
  .iae-grade > .agx-vidro { align-content: start; }
  .iae-ferr { display: grid; gap: 6px; padding: 11px 0; border-top: 1px solid var(--linha); }
  .iae-ferr:first-of-type { border-top: 0; }
  .iae-ferr b { font-size: 15px; }
  .iae-ferr > span { font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .iae-quem { display: flex; flex-wrap: wrap; gap: 6px; }
  .iae-quem .agx-pil.desl { opacity: .62; text-decoration: line-through; text-decoration-thickness: 1px; }
  `;
  function estilo() {
    if (document.getElementById('iae-css')) return;
    document.head.append(Object.assign(document.createElement('style'), { id: 'iae-css', textContent: CSS }));
  }

  const hora = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

  async function desenhar(ctx, testar = false) {
    estilo();
    const { el, ui, conteudo } = ctx;
    const d = await ui.api('/api/ia/estado' + (testar ? '?testar=1' : ''));
    if (!ctx.vivo()) return;
    const linha = (tipo, titulo, texto, onde) => el('div', { class: 'iae-linha ' + tipo },
      el('span', { class: 'iae-ic', html: ICONE[tipo], 'aria-hidden': 'true' }),
      el('span', { class: 'agx-txt' }, el('b', { text: titulo }), texto ? el('span', { text: texto }) : null, onde ? el('span', { class: 'iae-onde', text: 'Onde: ' + onde }) : null));

    // ---- pronta?
    const pronto = d.pronta && !d.falta.length;
    const cab = el('div', { class: 'iae-estado ' + (pronto ? 'ok' : 'falta') },
      el('span', { class: 'iae-sinal', html: pronto ? ICONE.ok : ICONE.falta, 'aria-hidden': 'true' }),
      el('span', { class: 'agx-txt', style: 'display:grid;gap:2px;min-width:0' },
        el('b', { text: pronto ? 'A IA está pronta para atender' : d.pronta ? 'A IA atende, mas dá para melhorar' : 'A IA ainda não está pronta' }),
        el('span', { class: 'agx-sub', text: pronto ? 'Tudo ligado: chave, WhatsApp e agenda respondendo.' : `${d.falta.length} ${d.falta.length === 1 ? 'coisa falta' : 'coisas faltam'} para ela fazer tudo.` })));
    const faltas = d.falta.length ? el('div', { class: 'iae-linhas' }, ...d.falta.map((f) => linha('falta', f.texto, null, f.onde))) : null;

    // ---- situação
    const sit = el('div', { class: 'iae-linhas' },
      linha(d.chave.ok ? 'ok' : 'falta', 'Chave da IA', d.chave.texto),
      ...d.whatsapp.map((w) => linha(w.conectado ? 'ok' : 'falta', `WhatsApp · ${w.nome}`, w.conectado ? 'Conectado.' : 'Sem número conectado.')),
      linha(d.novas.modoPadrao === 'humano' && !d.novas.porUnidade.some((u) => u.iaPrimeiro) ? 'falta' : 'ok', 'Conversas novas', d.novas.texto),
      ...d.novas.porUnidade.filter((u) => u.iaPrimeiro).map((u) => linha('ok', `IA atende primeiro · ${u.nome}`, `Agente ${u.agente}${u.quando === 'fora_do_horario' ? ', fora do horário' : u.quando === 'faixa' ? ', num horário' : ', sempre'}.`)),
      linha(d.sentidos.audio ? 'ok' : 'falta', 'Áudios e fotos', `${d.sentidos.textoAudio} Vê as fotos que a cliente manda.`));

    const agendas = el('div', { class: 'iae-linhas' }, ...d.agendas.map((a) => linha(a.semAgenda ? 'neutro' : a.ok ? 'ok' : 'falta', `${a.nome}${a.sistema ? ` · ${a.sistema}` : ''}`, a.texto + (a.ultimaEm ? ` (conferido às ${hora(a.ultimaEm)})` : ''))));
    const testarBtn = el('button', { class: 'agx-botao peq', type: 'button', text: 'Testar agenda agora' });
    testarBtn.addEventListener('click', async () => {
      testarBtn.disabled = true; testarBtn.textContent = 'Testando…';
      try { await desenhar(ctx, true); ui.toast('Agenda conferida'); } catch (x) { ui.toast((x && x.message) || 'Não deu para testar.'); testarBtn.disabled = false; testarBtn.textContent = 'Testar agenda agora'; }
    });

    // ---- ferramentas por agente
    const quem = [{ nome: d.padrao.nome, ligadas: d.padrao.ligadas, ativo: true }, ...d.agentes.map((a) => ({ nome: a.nome + (a.ativo ? '' : ' (desligado)'), ligadas: a.ligadas, ativo: a.ativo }))];
    const ferr = el('div', {}, ...d.ferramentas.map((f) => el('div', { class: 'iae-ferr' },
      el('b', { text: f.nome }), el('span', { text: f.oQueFaz }),
      el('div', { class: 'iae-quem' }, ...quem.map((q) => {
        const on = q.ligadas.includes(f.id);
        return el('span', { class: 'agx-pil ' + (on && q.ativo ? 'menta' : 'desl'), title: on ? 'Ligada' : 'Desligada', 'aria-label': `${q.nome}: ${on ? 'ligada' : 'desligada'}` }, el('i'), el('span', { text: q.nome }));
      })))));

    const protecoes = el('div', { class: 'iae-linhas' }, ...d.protecoes.map((p) => linha('ok', p, null)));
    const limite = d.limiteConversaDia ? `Limite por conversa: ${Math.round(d.limiteConversaDia / 1000)} mil tokens por dia (ao chegar no limite, a conversa vai para a equipe com aviso).` : 'Sem limite de uso por conversa.';

    conteudo.replaceChildren(
      el('div', { class: 'agx-topo' }, el('div', { style: 'display:grid;gap:4px;min-width:0' }, el('h1', { text: 'O que a IA faz' }),
        el('p', { class: 'agx-sub', text: 'Tudo que a IA consegue fazer sozinha no WhatsApp, o que está ligado em cada agente e o que falta para funcionar.' }))),
      el('div', { class: 'agx-vidro' }, cab, faltas),
      el('div', { class: 'iae-grade' },
        el('div', { class: 'agx-vidro' }, el('h2', { text: 'Situação' }), sit),
        el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { class: 'iae-ic', html: ICONE.agenda, 'aria-hidden': 'true' }), el('span', { text: 'Agenda por unidade' })), agendas, el('div', {}, testarBtn))),
      el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { text: 'O que ela pode fazer' }), el('small', { text: 'verde = ligado' })),
        el('p', { class: 'agx-sub', text: 'A IA padrão faz tudo. Nos agentes do estúdio, ligue ou desligue em Agentes › (agente) › Ferramentas permitidas.' }), ferr),
      el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { class: 'iae-ic', html: ICONE.escudo, 'aria-hidden': 'true' }), el('span', { text: 'Proteções sempre ligadas' })), protecoes, el('p', { class: 'agx-sub', text: limite })));
  }

  window.SintoniaTelas.iaEstado = { desenhar: (ctx) => desenhar(ctx, false) };
})();
