/* Tela "Clientes" da Sintonia: registra window.SintoniaTelas.clientes = { desenhar(caixa, ui) }.
 * Todas as clientes que a pessoa pode ver (as mesmas conversas de /api/conversas, já com tags, origem e quem atende),
 * com busca, filtros (origem, etiqueta, unidade, chegada), paginação, exportar CSV e clique que abre a conversa.
 * Componentes do design system (ds.css): .ds-tela, .ds-cab-tela, .ds-filtros, .ds-card, .ds-tabela, .ds-pilula, .ds-paginas.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const POR_PAGINA = 25;
  const PERIODOS = [['', 'Qualquer data'], ['1', 'Chegou hoje'], ['7', 'Últimos 7 dias'], ['30', 'Últimos 30 dias'], ['90', 'Últimos 90 dias']];
  const CHAVE = 'sintonia.clientes.filtro';
  const ler = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch { return {}; } };
  const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify({ origem: s.origem, tag: s.tag, unidade: s.unidade, periodo: s.periodo })); } catch { /* sem armazenamento */ } };
  const s = { caixa: null, ui: null, busca: '', pagina: 0, origem: '', tag: '', unidade: '', periodo: '', ...ler() };
  const LUPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const data = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
  const ultimoContato = (c) => {
    const t = Math.max(...[c.ultimaMensagemCliente, c.ultimaMensagemEquipe, c.ultimaMensagemIa].map((x) => (x ? new Date(x).getTime() : 0)));
    return t ? new Date(t) : c.atualizadaEm ? new Date(c.atualizadaEm) : null;
  };
  const nomeOrigem = (c) => {
    const ic = window.SintoniaRastreio?.iconeEl(c.origem || c.id);
    return (ic?.getAttribute('aria-label') || 'Origem: desconhecida').replace(/^Origem:\s*/, '');
  };
  const iconeOrigem = (c) => (c.origem && c.origem.icone) || window.SintoniaRastreio?.selo?.(c.id)?.icone || 'desconhecido';
  const atendente = (c) => (c.modo === 'ia' ? 'IA' : c.responsavelNome || '—');

  function filtradas() {
    const u = s.ui; const lista = u.estado.conversas || [];
    const q = s.busca.trim().toLowerCase(); const qd = q.replace(/\D/g, '');
    const desde = s.periodo ? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (Number(s.periodo) - 1)); return d.getTime(); })() : 0;
    return lista.filter((c) => {
      if (q && !(`${c.nome || ''}`.toLowerCase().includes(q) || (qd && String(c.telefone).includes(qd)))) return false;
      if (s.unidade && c.unidade !== s.unidade) return false;
      if (s.tag && !(c.tags || []).some((t) => t.id === s.tag)) return false;
      if (s.origem && iconeOrigem(c) !== s.origem) return false;
      if (desde && !(c.criadaEm && new Date(c.criadaEm).getTime() >= desde)) return false;
      return true;
    }).sort((a, b) => new Date(b.criadaEm || 0) - new Date(a.criadaEm || 0));
  }

  function exportar(lista) {
    const u = s.ui;
    const esc = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const linhas = [['Nome', 'Telefone', 'Origem', 'Chegada', 'Último contato', 'Etapa', 'Atendente', 'Unidade', 'Etiquetas']]
      .concat(lista.map((c) => [c.nome || '', c.telefone, nomeOrigem(c), data(c.criadaEm), data(ultimoContato(c)), u.NOME_ETAPA[c.etapa] || c.etapa || '', atendente(c), u.UNIDADE[c.unidade] || c.unidade || '', (c.tags || []).map((t) => t.nome).join(', ')]));
    const blob = new Blob(['﻿' + linhas.map((l) => l.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    u.toast(`${lista.length} cliente${lista.length === 1 ? '' : 's'} exportada${lista.length === 1 ? '' : 's'}`);
  }

  function filtros() {
    const u = s.ui, el = u.el;
    const sel = (rot, chave, opcoes) => {
      const x = el('select', { 'aria-label': rot }, ...opcoes.map(([v, n]) => el('option', { value: v, text: n })));
      x.value = s[chave]; if (x.value !== s[chave]) { s[chave] = ''; x.value = ''; }
      x.addEventListener('change', () => { s[chave] = x.value; s.pagina = 0; gravar(); desenharTabela(); });
      return x;
    };
    const busca = el('input', { type: 'search', placeholder: 'Buscar por nome ou telefone', 'aria-label': 'Buscar cliente' });
    busca.value = s.busca;
    busca.addEventListener('input', () => { s.busca = busca.value; s.pagina = 0; desenharTabela(); });
    const origens = new Map();
    for (const c of u.estado.conversas || []) { const ic = iconeOrigem(c); if (!origens.has(ic)) origens.set(ic, nomeOrigem({ origem: { icone: ic } })); }
    const unidades = [...new Set((u.estado.conversas || []).map((c) => c.unidade).filter(Boolean))];
    return el('div', { class: 'ds-filtros' },
      el('label', { class: 'ds-campo ds-busca', html: LUPA }, busca),
      sel('Origem', 'origem', [['', 'Todas as origens'], ...[...origens].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))]),
      sel('Etiqueta', 'tag', [['', 'Todas as etiquetas'], ...(u.estado.tags || []).map((t) => [t.id, t.nome])]),
      unidades.length > 1 ? sel('Unidade', 'unidade', [['', 'Todas as unidades'], ...unidades.map((x) => [x, u.UNIDADE[x] || x])]) : null,
      sel('Chegada', 'periodo', PERIODOS));
  }

  let corpo = null;
  function desenharTabela() {
    const u = s.ui, el = u.el;
    if (!corpo) return;
    const lista = filtradas();
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    if (s.pagina >= paginas) s.pagina = paginas - 1;
    const pedaco = lista.slice(s.pagina * POR_PAGINA, (s.pagina + 1) * POR_PAGINA);
    const exportarBt = s.caixa.querySelector('[data-exportar]');
    if (exportarBt) exportarBt.onclick = () => exportar(lista);
    if (!lista.length) {
      corpo.replaceChildren(el('div', { class: 'ds-vazio', text: (u.estado.conversas || []).length ? 'Nenhuma cliente com esses filtros.' : 'Nenhuma cliente ainda. Assim que alguém chamar no WhatsApp, aparece aqui.' }));
      return;
    }
    const linha = (c) => {
      const tr = el('tr', { tabindex: '0', title: `Abrir a conversa com ${u.nomeDe(c)}` },
        el('td', { style: 'width:44px' }, u.avatar(c, 'p')),
        el('td', {}, el('b', { text: c.nome || '—', style: 'font-weight:600' })),
        el('td', { text: u.formatarTel(c.telefone) }),
        el('td', {}, el('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, window.SintoniaRastreio ? window.SintoniaRastreio.iconeEl(c.origem || c.id) : null, el('span', { text: nomeOrigem(c) }))),
        el('td', { text: data(c.criadaEm) }),
        el('td', { text: u.horaLista(ultimoContato(c)) || '—' }),
        el('td', {}, el('span', { class: 'ds-pilula', text: u.NOME_ETAPA[c.etapa] || c.etapa || '—' })),
        el('td', {}, el('span', { class: 'ds-pilula' + (c.modo === 'ia' ? ' ia' : ''), text: atendente(c) })));
      const abrir = () => u.abrir(c.id);
      tr.addEventListener('click', abrir);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
      return tr;
    };
    const ini = s.pagina * POR_PAGINA;
    const ir = (p) => { s.pagina = p; desenharTabela(); s.caixa.querySelector('.ds-rolagem')?.scrollTo?.(0, 0); };
    corpo.replaceChildren(
      el('div', { class: 'ds-rolagem' }, el('table', { class: 'ds-tabela' },
        el('thead', {}, el('tr', {}, ...['', 'Nome', 'Telefone', 'Origem', 'Chegada', 'Último contato', 'Etapa', 'Atendente'].map((t) => el('th', { text: t })))),
        el('tbody', {}, ...pedaco.map(linha)))),
      el('div', { class: 'ds-paginas' },
        el('span', { text: `${ini + 1}–${ini + pedaco.length} de ${lista.length}` }),
        el('div', { class: 'ds-cab-acoes' },
          el('button', { class: 'botao leve', type: 'button', text: 'Anterior', disabled: s.pagina === 0 ? '' : null, onclick: () => ir(s.pagina - 1) }),
          el('span', { text: `Página ${s.pagina + 1} de ${paginas}` }),
          el('button', { class: 'botao leve', type: 'button', text: 'Próxima', disabled: s.pagina >= paginas - 1 ? '' : null, onclick: () => ir(s.pagina + 1) }))));
  }

  window.SintoniaTelas.clientes = {
    desenhar(caixa, ui) {
      s.caixa = caixa; s.ui = ui;
      const el = ui.el;
      const total = (ui.estado.conversas || []).length;
      corpo = el('div', { class: 'ds-card sem-padding' });
      caixa.replaceChildren(el('div', { class: 'ds-tela' },
        el('div', { class: 'ds-cab-tela' },
          el('div', { class: 'ds-cab-txt' }, el('h1', { class: 'titulo-grande', text: 'Clientes' }), el('p', { text: `${total} cliente${total === 1 ? '' : 's'} · clique em uma para abrir a conversa` })),
          el('div', { class: 'ds-cab-acoes' }, el('button', { class: 'botao leve', type: 'button', 'data-exportar': '', text: 'Exportar CSV' }))),
        filtros(), corpo));
      desenharTabela();
    },
  };
})();
