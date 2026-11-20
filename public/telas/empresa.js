/* Empresa (Empresa e conta › Empresa): os dados da empresa em seções lado a lado, na largura do painel.
 * Registra window.SintoniaTelas.empresa = { desenhar(caixa, ui) }. Só junta o que já existe no servidor:
 * nome (GET/PATCH /api/empresa), unidades e pessoas (/api/equipe), plano (/api/planos), situação das
 * conexões (/api/situacao) e meta do mês (/api/painel/meta). Texto do servidor entra por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ep { width: 100%; min-width: 0; display: grid; gap: 16px; }
  .ep-topo { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .ep-topo h1 { margin: 0; font-size: 28px; letter-spacing: -.01em; }
  .ep-topo p { margin: 4px 0 0; color: var(--sub); font-size: 14.5px; }
  .ep-grade { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr)); align-items: stretch; }
  .ep-c { border-radius: 24px; padding: 18px; display: grid; gap: 12px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); min-width: 0; align-content: start; }
  .ep-c h2 { margin: 0; font-size: 17px; display: flex; align-items: center; gap: 10px; }
  .ep-c h2 i { width: 34px; height: 34px; border-radius: 12px; flex: none; display: grid; place-items: center; color: var(--marca-azul); background: color-mix(in srgb, #106ebe 12%, transparent); }
  html[data-tema="escuro"] .ep-c h2 i { color: var(--marca-menta); background: color-mix(in srgb, #0ffcbe 14%, transparent); }
  .ep-c h2 i svg { width: 18px; height: 18px; }
  .ep-sub { margin: 0; font-size: 13px; color: var(--sub); line-height: 1.45; }
  .ep-form { display: grid; gap: 8px; }
  .ep-form label { display: grid; gap: 5px; font-size: 13px; font-weight: 600; color: var(--sub); }
  .ep-form input { font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 10px 12px; min-width: 0; }
  .ep-linhas { display: grid; }
  .ep-linha { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 2px; border-top: 1px solid var(--vidro-borda); font-size: 14px; min-width: 0; }
  .ep-linha:first-child { border-top: 0; }
  .ep-linha span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ep-linha b { flex: none; font-variant-numeric: tabular-nums; }
  .ep-linha small { color: var(--sub); font-size: 12.5px; }
  .ep-ok { color: #0b8f6a; } html[data-tema="escuro"] .ep-ok { color: #0ffcbe; }
  .ep-nao { color: #c2410c; } html[data-tema="escuro"] .ep-nao { color: #fb923c; }
  .ep-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
  .ep-bt { all: unset; cursor: pointer; box-sizing: border-box; padding: 8px 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; background: var(--vidro-ativo, rgba(255,255,255,.7)); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .ep-bt.forte { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; box-shadow: 0 8px 18px rgba(16,110,190,.28); }
  .ep-bt:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .ep-bt[disabled] { opacity: .5; cursor: default; }
  .ep-barra { height: 10px; border-radius: 999px; background: var(--vidro-item); overflow: hidden; }
  .ep-barra i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #106ebe, #3aa0ff); }
  .ep-grande { font-size: 26px; font-weight: 700; letter-spacing: -.01em; }
  .ep-erro { color: var(--erro, #c43a3a); font-size: 13px; margin: 0; min-height: 1em; }
  `;
  const IC = {
    empresa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4"/></svg>',
    unidade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    equipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>',
    plano: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h4"/></svg>',
    conexao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v4"/></svg>',
    meta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
  };
  const PAPEL = { admin: 'Administração', direcao: 'Direção', gerente: 'Gerente', atendente: 'Atendente', recepcionista: 'Recepcionista' };
  let ui, caixa;

  const css = () => { if (!document.getElementById('ep-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'ep-css', textContent: CSS })); };

  async function desenhar(c, u) {
    ui = u; caixa = c; css();
    const el = ui.el;
    caixa.replaceChildren(el('p', { class: 'ep-sub', text: 'Carregando…' }));
    const [emp, eq, pl, sit, meta] = await Promise.all([
      ui.api('/api/empresa').catch(() => null),
      ui.api('/api/equipe').catch(() => null),
      ui.api('/api/planos').catch(() => null),
      ui.api('/api/situacao').catch(() => null),
      ui.api('/api/painel/meta').catch(() => null),
    ]);
    if (!caixa.isConnected) return;
    const cartao = (ic, titulo, ...filhos) => el('section', { class: 'ep-c' }, el('h2', {}, el('i', { html: IC[ic] }), document.createTextNode(titulo)), ...filhos);
    const linha = (rot, valor, cls) => el('div', { class: 'ep-linha' }, el('span', { text: rot }), el('b', { class: cls || '', text: valor }));
    const nomeUn = (x) => ui.UNIDADE?.[x] || x;
    const podeEditar = ['admin', 'direcao'].includes(ui.estado?.eu?.papel);

    // Dados da empresa
    const nome = el('input', { name: 'nome', minlength: '2', maxlength: '80', required: '', autocomplete: 'organization', value: emp?.nome || '' });
    if (!podeEditar) nome.setAttribute('disabled', '');
    const erro = el('p', { class: 'ep-erro', role: 'alert' });
    const salvar = el('button', { class: 'ep-bt forte', type: 'submit', text: 'Salvar nome' });
    if (!podeEditar) salvar.setAttribute('disabled', '');
    const form = el('form', { class: 'ep-form' }, el('label', {}, document.createTextNode('Nome da empresa'), nome),
      el('p', { class: 'ep-sub', text: 'Aparece no topo do menu, na Conta e nos relatórios.' }), erro, el('div', { class: 'ep-acoes' }, salvar));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.textContent = '';
      try {
        const r = await ui.api('/api/empresa', { method: 'PATCH', body: JSON.stringify({ nome: nome.value.trim() }) });
        ui.toast('Nome salvo ✓');
        const topo = document.getElementById('lt-empresa'); if (topo && r?.nome) topo.textContent = r.nome;
      } catch (x) { erro.textContent = x.message; }
    });
    const quandoMudou = emp?.atualizadaEm ? `Última mudança: ${ui.quando(emp.atualizadaEm)}${emp.atualizadaPor ? ' · ' + emp.atualizadaPor : ''}` : '';
    const secDados = cartao('empresa', 'Dados da empresa', form, quandoMudou ? el('p', { class: 'ep-sub', text: quandoMudou }) : null);

    // Unidades
    const pessoas = eq?.pessoas || [];
    const unidades = eq?.unidades || Object.keys(ui.UNIDADE || {});
    const conversas = ui.estado?.conversas || [];
    const secUnid = cartao('unidade', `Unidades (${unidades.length})`,
      unidades.length ? el('div', { class: 'ep-linhas' }, ...unidades.map((x) => {
        const n = pessoas.filter((p) => p.ativo && p.unidades?.includes(x)).length;
        const c = conversas.filter((k) => k.unidade === x).length;
        return el('div', { class: 'ep-linha' }, el('span', { text: nomeUn(x) }), el('small', { text: `${n} ${n === 1 ? 'pessoa' : 'pessoas'} · ${c} ${c === 1 ? 'conversa' : 'conversas'}` }));
      })) : el('p', { class: 'ep-sub', text: 'Nenhuma unidade cadastrada.' }));

    // Equipe
    const ativas = pessoas.filter((p) => p.ativo);
    const porPapel = Object.keys(PAPEL).map((k) => [k, ativas.filter((p) => p.papel === k).length]).filter(([, n]) => n);
    const secEquipe = cartao('equipe', 'Equipe',
      el('div', { class: 'ep-grande', text: `${ativas.length} ${ativas.length === 1 ? 'pessoa ativa' : 'pessoas ativas'}` }),
      porPapel.length ? el('div', { class: 'ep-linhas' }, ...porPapel.map(([k, n]) => linha(PAPEL[k], String(n)))) : null,
      el('div', { class: 'ep-acoes' }, el('button', { class: 'ep-bt', type: 'button', text: 'Atendentes e acessos', onclick: () => ui.mostrar('acessos') })));

    // Plano
    const secPlano = cartao('plano', 'Plano',
      pl?.plano ? el('div', { class: 'ep-grande', text: pl.plano.nome }) : el('p', { class: 'ep-sub', text: 'Não deu para ler o plano agora.' }),
      pl?.plano?.precoTexto ? el('p', { class: 'ep-sub', text: pl.plano.precoTexto }) : null,
      el('div', { class: 'ep-acoes' }, el('button', { class: 'ep-bt', type: 'button', text: 'Plano e uso da IA', onclick: () => ui.mostrar('planos') })));

    // Conexões
    const s = sit || {};
    const secCon = cartao('conexao', 'Conexões',
      el('div', { class: 'ep-linhas' },
        linha('WhatsApp', s.numerosReais ? `${s.numerosReais} ${s.numerosReais === 1 ? 'número conectado' : 'números conectados'}` : 'Nenhum número', s.numerosReais ? 'ep-ok' : 'ep-nao'),
        linha('IA (Serena)', s.iaLigada ? 'Ligada' : 'Desligada', s.iaLigada ? 'ep-ok' : 'ep-nao'),
        linha('Agenda', s.agendaLigada ? 'Ligada' : 'Desligada', s.agendaLigada ? 'ep-ok' : 'ep-nao')),
      el('div', { class: 'ep-acoes' }, el('a', { class: 'ep-bt', href: '/conexoes', text: 'Abrir Conexões' })));

    // Meta do mês
    let secMeta = null;
    if (meta && !meta.oculta && meta.meta) {
      const feito = Number(meta.agendamentos || 0), alvo = Number(meta.meta || 0);
      const pct = alvo > 0 ? Math.min(100, Math.round((feito / alvo) * 100)) : 0;
      const barra = el('div', { class: 'ep-barra' }, el('i')); barra.firstChild.style.width = pct + '%';
      secMeta = cartao('meta', 'Meta do mês',
        el('div', { class: 'ep-grande', text: `${feito} de ${alvo}` }), el('p', { class: 'ep-sub', text: `agendamentos no mês · ${pct}%` }), barra,
        el('p', { class: 'ep-sub', text: 'Muda no Dashboard, no cartão da meta.' }));
    }

    caixa.replaceChildren(el('div', { class: 'ep' },
      el('div', { class: 'ep-topo' }, el('div', {}, el('h1', { text: 'Empresa' }), el('p', { text: 'Os dados da empresa, as unidades, a equipe, o plano e as conexões num lugar só.' }))),
      el('div', { class: 'ep-grade' }, secDados, secUnid, secEquipe, secPlano, secCon, secMeta)));
  }

  window.SintoniaTelas.empresa = { desenhar };
})();
