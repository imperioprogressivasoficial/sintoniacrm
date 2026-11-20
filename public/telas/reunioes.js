/* Agendamento online (como o Cal.com, dentro da Sintonia): links de agendamento e as reuniões marcadas.
 * Registra window.SintoniaTelas.reunioes = { desenhar(caixa, ui) }. Servidor: src/reunioes/reunioes.ts.
 * A página que o contato abre é /r/<slug> (public/reuniao.html). Texto do servidor entra por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .rn { max-width: 980px; margin: 0 auto; display: grid; gap: 16px; }
  .rn-topo { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .rn-topo h1 { margin: 0; font-size: 28px; letter-spacing: -.01em; }
  .rn-topo p { margin: 4px 0 0; color: var(--sub); font-size: 14.5px; }
  .rn-cartao { border-radius: 24px; padding: 18px; display: grid; gap: 12px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); position: relative; min-width: 0; }
  .rn-cartao h2 { margin: 0; font-size: 17px; }
  .rn-link { display: grid; gap: 8px; padding: 14px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .rn-link.off { opacity: .6; }
  .rn-link-cab { display: flex; align-items: center; gap: 10px; }
  .rn-link-cab b { flex: 1; min-width: 0; font-size: 15.5px; }
  .rn-meta { color: var(--sub); font-size: 13px; }
  .rn-url { font-size: 13px; color: var(--marca-azul); word-break: break-all; }
  html[data-tema="escuro"] .rn-url { color: var(--marca-menta); }
  .rn-acoes { display: flex; gap: 6px; flex-wrap: wrap; }
  .rn-bt { all: unset; cursor: pointer; box-sizing: border-box; padding: 8px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; background: var(--vidro-ativo, rgba(255,255,255,.7)); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .rn-bt.forte { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 8px 18px rgba(16,110,190,.28); }
  .rn-bt.perigo { color: var(--erro, #c43a3a); }
  .rn-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .rn-vazio { color: var(--sub); font-size: 14px; margin: 0; }
  .rn-reu { display: flex; align-items: center; gap: 12px; padding: 10px 2px; border-bottom: 1px solid var(--vidro-borda); }
  .rn-reu:last-child { border-bottom: 0; }
  .rn-quando { flex: none; width: 64px; text-align: center; border-radius: 14px; padding: 6px 4px; background: var(--vidro-item); font-size: 12px; color: var(--sub); }
  .rn-quando b { display: block; font-size: 17px; color: var(--texto); }
  .rn-reu > div { flex: 1; min-width: 0; }
  .rn-reu.cancelada { opacity: .5; text-decoration: line-through; }
  dialog.rn-d { border: 0; border-radius: 26px; padding: 22px; width: min(480px, calc(100vw - 24px)); background: var(--vidro-forte, var(--painel)); color: var(--texto); box-shadow: var(--vidro-brilho); }
  dialog.rn-d::backdrop { background: rgba(4,12,20,.55); }
  .rn-form { display: grid; gap: 12px; }
  .rn-form label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; color: var(--sub); }
  .rn-form input, .rn-form select, .rn-form textarea { font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 10px 12px; }
  .rn-dois { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .rn-dias { display: flex; gap: 6px; flex-wrap: wrap; }
  .rn-dias button { all: unset; cursor: pointer; width: 42px; height: 38px; border-radius: 12px; display: grid; place-items: center; font-size: 13px; font-weight: 600; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .rn-dias button[aria-pressed="true"] { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: none; }
  .rn-erro { color: var(--erro, #c43a3a); font-size: 13px; margin: 0; }
  `;
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const resumoDias = (ds) => { const s = [...ds].sort(); if (s.join() === '1,2,3,4,5') return 'seg a sex'; if (s.join() === '1,2,3,4,5,6') return 'seg a sáb'; if (s.length === 7) return 'todos os dias'; return s.map((d) => DIAS[d].toLowerCase()).join(', '); };
  const urlDe = (slug) => `${location.origin}/r/${slug}`;
  let ui, caixa;

  const css = () => { if (!document.getElementById('rn-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'rn-css', textContent: CSS })); };
  async function desenhar(c, u) {
    ui = u; caixa = c;
    css();
    const el = ui.el;
    caixa.replaceChildren(el('p', { class: 'rn-vazio', text: 'Carregando…' }));
    let d;
    try { d = await ui.api('/api/reunioes'); } catch (e) { caixa.replaceChildren(el('p', { class: 'rn-vazio', text: e.message })); return; }
    const novo = el('button', { class: 'rn-bt forte', type: 'button', text: '+ Novo link', onclick: () => editar(null) });
    const links = d.links.length ? d.links.map((l) => {
      const copiar = el('button', { class: 'rn-bt forte', type: 'button', text: 'Copiar link', onclick: async () => { try { await navigator.clipboard.writeText(urlDe(l.slug)); ui.toast('Link copiado. Agora é só mandar para o contato.'); } catch { ui.toast(urlDe(l.slug)); } } });
      return el('div', { class: 'rn-link' + (l.ativo ? '' : ' off') },
        el('div', { class: 'rn-link-cab' }, el('b', { text: l.titulo }), el('span', { class: 'rn-meta', text: l.ativo ? 'Ligado' : 'Desligado' })),
        el('span', { class: 'rn-meta', text: `${l.duracao_min} min · ${resumoDias(l.dias)} · ${l.inicio}–${l.fim}${l.local ? ' · ' + l.local : ''}` }),
        el('a', { class: 'rn-url', href: urlDe(l.slug), target: '_blank', rel: 'noopener', text: urlDe(l.slug) }),
        el('div', { class: 'rn-acoes' }, copiar,
          el('button', { class: 'rn-bt', type: 'button', text: 'Editar', onclick: () => editar(l) }),
          el('button', { class: 'rn-bt', type: 'button', text: l.ativo ? 'Desligar' : 'Ligar', onclick: async () => { await ui.api(`/api/reunioes/links/${l.id}`, { method: 'PUT', body: JSON.stringify({ ...l, ativo: !l.ativo }) }); desenhar(caixa, ui); } }),
          el('button', { class: 'rn-bt perigo', type: 'button', text: 'Apagar', onclick: async () => { if (!confirm(`Apagar o link "${l.titulo}"? As reuniões marcadas por ele também saem.`)) return; await ui.api(`/api/reunioes/links/${l.id}`, { method: 'DELETE' }); desenhar(caixa, ui); } })));
    }) : [el('p', { class: 'rn-vazio', text: 'Nenhum link ainda. Crie o primeiro (ex.: "Reunião de 30 minutos") e mande para o contato escolher o horário.' })];
    const reunioes = d.proximas.length ? d.proximas.map((r) => {
      const ini = new Date(r.inicio);
      const dia = ini.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Bahia' });
      const hora = ini.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' });
      const contato = [r.telefone, r.email].filter(Boolean).join(' · ');
      return el('div', { class: 'rn-reu' + (r.status === 'cancelada' ? ' cancelada' : '') },
        el('span', { class: 'rn-quando' }, document.createTextNode(dia), el('b', { text: hora })),
        el('div', {}, el('b', { text: r.nome }), el('div', { class: 'rn-meta', text: `${r.titulo}${contato ? ' · ' + contato : ''}` }), r.observacao ? el('div', { class: 'rn-meta', text: `“${r.observacao}”` }) : null),
        r.status === 'marcada' ? el('button', { class: 'rn-bt perigo', type: 'button', text: 'Cancelar', onclick: async () => { if (!confirm(`Cancelar a reunião com ${r.nome}?`)) return; await ui.post(`/api/reunioes/${r.id}/cancelar`); desenhar(caixa, ui); } }) : el('span', { class: 'rn-meta', text: 'Cancelada' }));
    }) : [el('p', { class: 'rn-vazio', text: 'Nenhuma reunião marcada ainda.' })];
    caixa.replaceChildren(el('div', { class: 'rn' },
      el('div', { class: 'rn-topo' }, el('div', {}, el('h1', { text: 'Agendamento online' }), el('p', { text: 'Crie um link, mande para o contato e ele escolhe o horário sozinho.' })), novo),
      el('section', { class: 'rn-cartao' }, el('h2', { text: 'Seus links' }), ...links),
      el('section', { class: 'rn-cartao' }, el('h2', { text: 'Próximas reuniões' }), ...reunioes)));
  }

  function editar(l) {
    const el = ui.el;
    const v = l || { titulo: '', descricao: '', duracao_min: 30, dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00', antecedencia_h: 2, janela_dias: 21, local: '', ativo: true };
    const dias = new Set(v.dias);
    const campo = (rot, input) => el('label', {}, document.createTextNode(rot), input);
    const titulo = el('input', { value: v.titulo, maxlength: '80', placeholder: 'Ex.: Reunião de 30 minutos' });
    const dur = el('select', {}, ...[15, 20, 30, 45, 60, 90, 120].map((m) => { const o = el('option', { value: String(m), text: `${m} minutos` }); if (m === v.duracao_min) o.selected = true; return o; }));
    const ini = el('input', { type: 'time', value: v.inicio }); const fim = el('input', { type: 'time', value: v.fim });
    const ant = el('select', {}, ...[[0, 'Pode marcar para já'], [1, '1 hora antes'], [2, '2 horas antes'], [12, '12 horas antes'], [24, '1 dia antes'], [48, '2 dias antes']].map(([h, t]) => { const o = el('option', { value: String(h), text: t }); if (h === v.antecedencia_h) o.selected = true; return o; }));
    const local = el('input', { value: v.local, maxlength: '300', placeholder: 'Link do Meet, endereço ou "ligação de WhatsApp"' });
    const desc = el('textarea', { rows: '3', maxlength: '600', placeholder: 'O que vai ser conversado (aparece na página)' }); desc.value = v.descricao;
    const botoesDias = el('div', { class: 'rn-dias', role: 'group', 'aria-label': 'Dias da semana' }, ...DIAS.map((n, i) => {
      const b = el('button', { type: 'button', text: n, 'aria-pressed': String(dias.has(i)) });
      b.addEventListener('click', () => { dias.has(i) ? dias.delete(i) : dias.add(i); b.setAttribute('aria-pressed', String(dias.has(i))); });
      return b;
    }));
    const erro = el('p', { class: 'rn-erro', role: 'alert', hidden: '' });
    const d = el('dialog', { class: 'rn-d' });
    const salvar = el('button', { class: 'rn-bt forte', type: 'submit', text: l ? 'Salvar' : 'Criar link' });
    const form = el('form', { class: 'rn-form' },
      el('h2', { text: l ? 'Editar link' : 'Novo link de agendamento', style: 'margin:0' }),
      campo('Nome', titulo), el('div', { class: 'rn-dois' }, campo('Duração', dur), campo('Antecedência mínima', ant)),
      el('label', {}, document.createTextNode('Dias'), botoesDias),
      el('div', { class: 'rn-dois' }, campo('Das', ini), campo('Até', fim)),
      campo('Local', local), campo('Descrição', desc), erro,
      el('div', { class: 'rn-acoes', style: 'justify-content:flex-end' }, el('button', { class: 'rn-bt', type: 'button', text: 'Cancelar', onclick: () => d.close() }), salvar));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.hidden = true;
      const corpo = { titulo: titulo.value, descricao: desc.value, duracao_min: Number(dur.value), dias: [...dias], inicio: ini.value, fim: fim.value, antecedencia_h: Number(ant.value), janela_dias: v.janela_dias, local: local.value, ativo: v.ativo };
      try {
        if (l) await ui.api(`/api/reunioes/links/${l.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
        else await ui.post('/api/reunioes/links', corpo);
        d.close(); ui.toast(l ? 'Link salvo.' : 'Link criado. Toque em "Copiar link" e mande para o contato.'); desenhar(caixa, ui);
      } catch (x) { erro.textContent = x.message; erro.hidden = false; }
    });
    d.append(form); document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal(); titulo.focus();
  }

  window.SintoniaTelas.reunioes = { desenhar, css };
})();
