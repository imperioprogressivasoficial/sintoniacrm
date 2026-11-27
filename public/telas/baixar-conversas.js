/* treinar-ia (dono 27/11): "Baixar todas as conversas" no ⋯ da lista de Conversas, só para a gestão.
 * Um arquivo .txt com todas as conversas, por padrão sem dados pessoais das clientes, para estudar o jeito da equipe
 * e treinar a IA. Rota: GET /api/conversas/exportar-todas (?completo=1 traz nomes e telefones). */
(() => {
  const GESTAO = new Set(['admin', 'direcao', 'gerente']);
  const IC = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
  const el = (tag, at = {}, ...f) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(at)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v); } e.append(...f.filter(Boolean)); return e; };
  const CSS = `.bx-dlg{border:0;border-radius:22px;padding:0;width:min(420px,calc(100vw - 32px));background:var(--painel,#fff);color:var(--texto,#0d2240);box-shadow:0 24px 70px rgba(13,34,64,.28)}
  .bx-dlg::backdrop{background:rgba(13,34,64,.38)}
  .bx-dlg form{display:grid;gap:12px;padding:22px 20px 18px;margin:0}
  .bx-dlg h2{margin:0;font-size:18px}.bx-dlg p{margin:0;font-size:14px;line-height:1.45;color:var(--sub,#5b6b82)}
  .bx-op{display:flex;gap:10px;align-items:flex-start;padding:12px;border-radius:14px;border:1px solid var(--linha,#dbe5f1);cursor:pointer;font-size:14px}
  .bx-op input{margin-top:3px;accent-color:#106ebe}.bx-op small{display:block;color:var(--sub,#5b6b82);font-size:12.5px;margin-top:2px}
  .bx-bt{display:grid;grid-template-columns:1fr 1fr;gap:10px}.bx-bt button{all:unset;box-sizing:border-box;cursor:pointer;height:46px;border-radius:14px;display:grid;place-items:center;font-weight:600;font-size:15px}
  .bx-bt .vai{background:#106ebe;color:#fff}.bx-bt .nao{background:var(--vidro-item,rgba(13,34,64,.06))}
  .bx-bt button:focus-visible{outline:2px solid #106ebe;outline-offset:2px}`;
  let css = false;
  function abrir() {
    if (!css) { css = true; document.head.append(el('style', { text: CSS })); }
    const sem = el('input', { type: 'radio', name: 'bx', value: '0' }); sem.checked = true;
    const com = el('input', { type: 'radio', name: 'bx', value: '1' });
    const vai = el('button', { type: 'button', class: 'vai', text: 'Baixar' });
    const nao = el('button', { type: 'button', class: 'nao', text: 'Cancelar' });
    const d = el('dialog', { class: 'bx-dlg', 'aria-labelledby': 'bx-tit' }, el('form', { method: 'dialog' },
      el('h2', { id: 'bx-tit', text: 'Baixar todas as conversas' }),
      el('p', { text: 'Um arquivo de texto com todas as conversas que você vê, da mais recente para a mais antiga. Serve para estudar o atendimento e treinar a IA.' }),
      el('label', { class: 'bx-op' }, sem, el('span', { text: 'Sem dados pessoais (recomendado)' }, el('small', { text: 'O nome da cliente vira "Cliente" e saem telefones, e-mails e CPF.' }))),
      el('label', { class: 'bx-op' }, com, el('span', { text: 'Completo' }, el('small', { text: 'Com nome e telefone das clientes. Guarde com cuidado.' }))),
      el('div', { class: 'bx-bt' }, nao, vai)));
    nao.addEventListener('click', () => d.close());
    vai.addEventListener('click', () => {
      const a = el('a', { href: `/api/conversas/exportar-todas${com.checked ? '?completo=1' : ''}`, download: '' });
      document.body.append(a); a.click(); a.remove();
      window.Sintonia?.ui?.toast?.('Preparando o arquivo… o download começa em instantes.');
      d.close();
    });
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal(); vai.focus();
  }
  function ligar() {
    const ui = window.Sintonia && window.Sintonia.ui;
    const menu = document.getElementById('menu-lista');
    const eu = ui?.estado?.eu;
    if (!menu || !eu) return setTimeout(ligar, 800);
    if (!GESTAO.has(eu.papel) || menu.querySelector('[data-acao="baixar-todas"]')) return;
    const b = el('button', { role: 'menuitem', 'data-acao': 'baixar-todas', html: IC });
    b.append(el('span', { text: 'Baixar todas as conversas' }));
    b.addEventListener('click', () => { menu.hidden = true; abrir(); });
    menu.append(b);
  }
  ligar();
  window.SintoniaBaixarConversas = { abrir };
})();
