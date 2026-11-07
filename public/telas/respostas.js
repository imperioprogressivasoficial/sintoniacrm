/* Tela "Respostas rápidas" (Configurações): registra window.SintoniaTelas.respostas = { desenhar(caixa, ui) }.
 * Cria, edita e apaga os atalhos que aparecem ao digitar "/" na conversa. Usa o mesmo armazenamento da conversa
 * (/api/respostas-rapidas): da empresa (a gestão cuida) ou pessoais (só a pessoa vê).
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const s = { caixa: null, ui: null, lista: [], editando: null, erro: '', busca: '' };

  async function carregar() {
    try { s.lista = await s.ui.api('/api/respostas-rapidas'); s.erro = ''; } catch (x) { s.erro = x.message; }
  }

  function formulario() {
    const u = s.ui, el = u.el;
    const r = s.editando;
    const gestor = u.ehGestor(u.estado.eu || {});
    const atalho = el('input', { class: 'ds-campo', name: 'atalho', maxlength: '30', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'preco', required: '' });
    const texto = el('textarea', { class: 'ds-campo', name: 'texto', maxlength: '3000', required: '', rows: '5', placeholder: 'Oi {nome}! A progressiva na unidade {unidade}…', style: 'height:auto;padding:10px 12px;resize:vertical' });
    atalho.value = r ? r.atalho : ''; texto.value = r ? r.texto : '';
    const pessoal = el('input', { type: 'checkbox', name: 'pessoal' });
    const erro = el('div', { class: 'erro-txt', role: 'alert' });
    const inserir = (v) => { const i = texto.selectionStart ?? texto.value.length; texto.value = texto.value.slice(0, i) + v + texto.value.slice(texto.selectionEnd ?? i); texto.focus(); };
    const salvar = el('button', { class: 'botao', type: 'submit', text: r ? 'Salvar' : 'Criar resposta' });
    const form = el('form', { class: 'ds-card', style: 'display:grid;gap:12px;align-content:start' },
      el('h2', { text: r ? `Editar /${r.atalho}` : 'Nova resposta', style: 'margin:0;font-size:17px' }),
      el('label', { style: 'display:grid;gap:6px;font-size:13px;color:var(--sub)' }, 'Atalho (o que vem depois da /)', atalho),
      el('label', { style: 'display:grid;gap:6px;font-size:13px;color:var(--sub)' }, 'Texto', texto),
      el('div', { class: 'ds-cab-acoes' }, ...['{nome}', '{unidade}', '{atendente}'].map((v) => el('button', { class: 'ds-pilula', type: 'button', text: v, style: 'cursor:pointer', onclick: () => inserir(v) }))),
      el('span', { style: 'font-size:12.5px;color:var(--sub)', text: '{nome} vira o primeiro nome da cliente, {unidade} a unidade e {atendente} o seu nome.' }),
      !r && gestor ? el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:14px' }, pessoal, 'Só para mim (as outras pessoas não veem)') : null,
      !r && !gestor ? el('span', { style: 'font-size:12.5px;color:var(--sub)', text: 'Esta resposta fica só para você. As da empresa são criadas pela gestão.' }) : null,
      erro,
      el('div', { class: 'ds-cab-acoes' },
        r ? el('button', { class: 'botao leve', type: 'button', text: 'Apagar', onclick: async () => {
          if (!confirm(`Apagar a resposta /${r.atalho}?`)) return;
          try { await u.api('/api/respostas-rapidas/' + r.id, { method: 'DELETE' }); s.editando = null; await carregar(); desenhar(); u.toast('Resposta apagada'); } catch (x) { erro.textContent = x.message; }
        } }) : null,
        r ? el('button', { class: 'botao leve', type: 'button', text: 'Cancelar', onclick: () => { s.editando = null; desenhar(); } }) : null,
        salvar));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.textContent = ''; salvar.disabled = true;
      try {
        if (r) await u.api('/api/respostas-rapidas/' + r.id, { method: 'PATCH', body: JSON.stringify({ atalho: atalho.value, texto: texto.value }) });
        else await u.post('/api/respostas-rapidas', { atalho: atalho.value, texto: texto.value, ...(gestor ? { pessoal: pessoal.checked } : {}) });
        u.toast(r ? 'Resposta salva ✓' : 'Resposta criada ✓');
        s.editando = null; await carregar(); desenhar();
      } catch (x) { erro.textContent = x.message; salvar.disabled = false; }
    });
    return form;
  }

  function lista() {
    const u = s.ui, el = u.el;
    const q = s.busca.trim().toLowerCase();
    const itens = s.lista.filter((r) => !q || r.atalho.includes(q) || r.texto.toLowerCase().includes(q));
    if (s.erro) return el('div', { class: 'ds-card ds-vazio', text: s.erro });
    if (!itens.length) return el('div', { class: 'ds-card ds-vazio', text: s.lista.length ? 'Nenhuma resposta com essa busca.' : 'Nenhuma resposta ainda. Crie a primeira ao lado: depois é só digitar / no campo de mensagem.' });
    return el('div', { class: 'ds-card sem-padding' }, el('table', { class: 'ds-tabela' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Atalho' }), el('th', { text: 'Texto' }), el('th', { text: 'De quem' }))),
      el('tbody', {}, ...itens.map((r) => {
        const tr = el('tr', { tabindex: '0', 'aria-current': s.editando?.id === r.id ? 'true' : null, title: r.podeEditar ? 'Editar' : 'Só a gestão muda as respostas da empresa' },
          el('td', {}, el('b', { text: '/' + r.atalho, style: 'font-weight:600;color:var(--marca-azul)' })),
          el('td', { text: r.texto.length > 90 ? r.texto.slice(0, 89) + '…' : r.texto, style: 'white-space:normal;color:var(--sub)' }),
          el('td', {}, el('span', { class: 'ds-pilula', text: r.pessoal ? 'Minha' : 'Empresa' })));
        const abrir = () => { if (!r.podeEditar) { u.toast('Só a gestão muda as respostas da empresa.'); return; } s.editando = r; desenhar(); s.caixa.querySelector('input[name="atalho"]')?.focus(); };
        tr.addEventListener('click', abrir);
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
        return tr;
      }))));
  }

  function desenhar() {
    const u = s.ui, el = u.el;
    if (!s.caixa) return;
    const busca = el('input', { type: 'search', placeholder: 'Buscar atalho ou texto', 'aria-label': 'Buscar resposta' });
    busca.value = s.busca;
    const caixaLista = el('div');
    busca.addEventListener('input', () => { s.busca = busca.value; caixaLista.replaceChildren(lista()); });
    caixaLista.append(lista());
    s.caixa.replaceChildren(el('div', { class: 'ds-tela' },
      el('div', { class: 'ds-cab-tela' },
        el('div', { class: 'ds-cab-txt' }, el('h1', { class: 'titulo-grande', text: 'Respostas rápidas' }), el('p', { text: 'Textos prontos para a conversa: digite / no campo de mensagem e escolha.' })),
        el('div', { class: 'ds-cab-acoes' }, el('button', { class: 'botao', type: 'button', text: 'Nova resposta', onclick: () => { s.editando = null; desenhar(); s.caixa.querySelector('input[name="atalho"]')?.focus(); } }))),
      el('div', { class: 'ds-filtros' }, el('label', { class: 'ds-campo ds-busca', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }, busca)),
      el('div', { class: 'rr-tela-grade' }, caixaLista, formulario())));
  }

  window.SintoniaTelas.respostas = {
    async desenhar(caixa, ui) {
      s.caixa = caixa; s.ui = ui;
      if (!document.getElementById('estilo-respostas')) {
        const st = document.createElement('style'); st.id = 'estilo-respostas';
        st.textContent = '.rr-tela-grade { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; } @media (min-width: 1100px) { .rr-tela-grade { grid-template-columns: minmax(0, 1.4fr) minmax(320px, 1fr); } } .rr-tela-grade tr[aria-current="true"] { background: var(--vidro-ativo); }';
        document.head.append(st);
      }
      await carregar();
      desenhar();
    },
  };
})();
