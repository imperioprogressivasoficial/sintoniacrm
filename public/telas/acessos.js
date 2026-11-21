/* Usuários e acessos: pessoas (convidar, editar, desativar, redefinir senha, sessões, horário),
 * perfis × permissões (chaves liga/desliga) e auditoria. Também esconde do menu o que a pessoa
 * não pode e pede a troca de senha obrigatória. Registra window.SintoniaTelas.acessos.
 * Estilos em <style id="estilo-acessos">, prefixo .ac-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ac-fundo { position: fixed; inset: 0; z-index: 60; overflow-y: auto; overflow-x: hidden; background: var(--fundo, #f4f7fb); background-image: var(--aurora, none); padding: max(16px, env(safe-area-inset-top)) 16px 120px; box-sizing: border-box; }
  .ac-tela { max-width: 980px; margin: 0 auto; display: grid; gap: 16px; min-width: 0; font-family: var(--fonte); color: var(--texto, #08243f); }
  .ac-topo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ac-topo h1 { margin: 0; font-family: var(--fonte-titulo); font-size: clamp(26px, 6vw, 36px); font-weight: 700; flex: 1 1 200px; }
  .ac-voltar { all: unset; cursor: pointer; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--vidro-item, rgba(127,127,127,.1)); box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(127,127,127,.25)); }
  .ac-voltar svg { width: 20px; height: 20px; }
  .ac-abas { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo, rgba(255,255,255,.6)); border: 1px solid var(--vidro-borda, rgba(127,127,127,.2)); max-width: 100%; overflow-x: auto; }
  .ac-aba { all: unset; cursor: pointer; padding: 0 16px; min-height: 40px; display: inline-flex; align-items: center; border-radius: 999px; font-weight: 700; font-size: 14px; color: var(--sub, #5b6b7e); white-space: nowrap; }
  .ac-aba[aria-selected="true"] { background: color-mix(in srgb, #0ffcbe 28%, transparent); color: var(--texto); box-shadow: inset 0 0 0 1px color-mix(in srgb, #0ffcbe 60%, transparent) !important; }
  .ac-painel { border-radius: 24px; padding: 16px; display: grid; gap: 12px; min-width: 0; background: var(--vidro-fundo, rgba(255,255,255,.7)); border: 1px solid var(--vidro-borda, rgba(127,127,127,.2)); box-shadow: var(--vidro-brilho, none); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  .ac-painel h2 { margin: 0; font-size: 16px; font-weight: 700; } .ac-painel h2 small { display: block; font-size: 12.5px; font-weight: 500; color: var(--sub); margin-top: 3px; }
  .ac-lista { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); }
  .ac-pessoa { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 4px; padding: 14px; border-radius: 18px; background: var(--vidro-item, rgba(127,127,127,.08)); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-width: 0; }
  .ac-pessoa:hover { transform: translateY(-1px); } .ac-pessoa.inativa { opacity: .6; }
  .ac-pessoa b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-pessoa span { font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-selos { display: flex; flex-wrap: wrap; gap: 4px; }
  .ac-selo { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, #106ebe 14%, transparent); color: var(--texto); }
  .ac-selo.coral { background: color-mix(in srgb, #ff7a59 22%, transparent); } .ac-selo.menta { background: color-mix(in srgb, #0ffcbe 30%, transparent); }
  .ac-botao { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 18px; border-radius: 999px; background: var(--marca-menta, #0ffcbe); color: #071d33; font-weight: 700; font-size: 14.5px; box-shadow: 0 6px 20px rgba(15,252,190,.25); }
  .ac-botao.leve { background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); font-weight: 700; }
  .ac-botao.perigo { background: transparent; color: #d4553a; box-shadow: inset 0 0 0 1px #ff7a59; }
  .ac-botao:focus-visible, .ac-aba:focus-visible, .ac-pessoa:focus-visible { outline: 2px solid #106ebe; outline-offset: 2px; }
  .ac-linha { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 2px; border-top: 1px solid var(--vidro-borda); min-height: 44px; }
  .ac-linha:first-child { border-top: 0; } .ac-linha span { font-size: 14px; } .ac-linha small { display: block; font-size: 12px; color: var(--sub); }
  .ac-chave { position: relative; width: 46px; height: 28px; flex: none; } .ac-chave input { opacity: 0; position: absolute; inset: 0; margin: 0; cursor: pointer; z-index: 1; }
  .ac-chave i { position: absolute; inset: 0; border-radius: 999px; background: rgba(127,127,127,.35); transition: background .18s; }
  .ac-chave i::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); transition: transform .18s; }
  .ac-chave input:checked + i { background: #19c3a6; } .ac-chave input:checked + i::after { transform: translateX(18px); }
  .ac-chave input:disabled + i { opacity: .45; } .ac-chave input:focus-visible + i { outline: 2px solid #106ebe; outline-offset: 2px; }
  .ac-grupo { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--sub); margin: 10px 0 0; }
  .ac-form { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
  .ac-form label { display: grid; gap: 5px; font-size: 12.5px; font-weight: 700; color: var(--sub); min-width: 0; }
  .ac-form input, .ac-form select, .ac-sel { font: inherit; font-size: 15px; color: var(--texto); background: var(--vidro-item); border: 1px solid var(--vidro-borda); border-radius: 12px; padding: 10px 12px; min-width: 0; width: 100%; box-sizing: border-box; min-height: 44px; }
  .ac-form .ac-largo { grid-column: 1 / -1; }
  .ac-tela input[type=checkbox], .ac-tela input[type=radio], .ac-dlg input[type=checkbox], .ac-dlg input[type=radio] { width: 18px; height: 18px; min-height: 0; padding: 0; margin: 0; flex: none; accent-color: #106ebe; }
  .ac-dlg form, .ac-dlg details, .ac-dlg .ac-linha { min-width: 0; } .ac-linha > span { min-width: 0; }
  .ac-checks { display: flex; flex-wrap: wrap; gap: 8px; } .ac-checks label { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; color: var(--texto); font-weight: 600; padding: 6px 12px; border-radius: 999px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-height: 32px; }
  .ac-acoes { display: flex; flex-wrap: wrap; gap: 8px; }
  .ac-erro { color: #c43a3a; font-size: 13.5px; font-weight: 600; min-height: 1em; }
  .ac-dlg { border: 0; padding: 0; border-radius: 26px; width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); background: var(--vidro-forte, #fff); color: var(--texto); box-shadow: 0 30px 80px rgba(4,23,43,.35); }
  .ac-dlg::backdrop { background: rgba(4,23,43,.45); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
  .ac-dlg > div { padding: 18px; display: grid; gap: 14px; overflow-y: auto; overflow-x: hidden; grid-template-columns: minmax(0, 1fr); max-height: calc(100dvh - 24px); box-sizing: border-box; }
  .ac-dlg h2 { margin: 0; font-size: 20px; font-weight: 700; }
  .ac-link { font-size: 13px; padding: 10px 12px; border-radius: 12px; background: var(--vidro-item); overflow-wrap: anywhere; user-select: all; }
  .ac-ev { display: grid; gap: 2px; padding: 10px 2px; border-top: 1px solid var(--vidro-borda); font-size: 13.5px; } .ac-ev:first-child { border-top: 0; } .ac-ev small { color: var(--sub); }
  .ac-pills { display: flex; gap: 6px; flex-wrap: wrap; }
  @media (prefers-reduced-motion: reduce) { .ac-chave i, .ac-chave i::after { transition: none; } }
  /* usuarios: foto na lista, avisos de envio e o resultado do convite (link para copiar ou mandar pelo WhatsApp) */
  .ac-ini { overflow: hidden; } .ac-ini img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ac-aviso { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 16px; font-size: 13.5px; line-height: 1.45; background: color-mix(in srgb, #106ebe 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, #106ebe 30%, transparent); }
  .ac-aviso.ok { background: color-mix(in srgb, #0ffcbe 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, #19c3a6 55%, transparent); }
  .ac-aviso.atencao { background: color-mix(in srgb, #ffb020 14%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, #ffb020 50%, transparent); }
  .ac-aviso svg { flex: none; width: 20px; height: 20px; margin-top: 1px; } .ac-aviso b { font-weight: 700; } .ac-aviso p { margin: 0; }
  .ac-link { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
  .ac-zap { background: #25d366 !important; color: #06301a !important; box-shadow: 0 6px 20px rgba(37,211,102,.25) !important; }
  .ac-zap svg, .ac-botao svg { width: 18px; height: 18px; flex: none; }
  .ac-foto-linha { display: flex; align-items: center; gap: 12px; } .ac-foto-linha .ac-ini { width: 56px; height: 56px; font-size: 18px; }
  .ac-acoes.ac-separa { border-top: 1px solid var(--vidro-borda); padding-top: 12px; }
  .ac-dica-campo { font-weight: 500; font-size: 12px; color: var(--sub); }
  .ac-dlg p.info, .ac-dlg .ac-erro { margin: 0; } .ac-dlg .ac-erro:empty { display: none; }
  .ac-dlg .ac-grupo { margin: 4px 0 0; }
  /* usuarios: a janela fica opaca (no escuro o vidro deixava ler a lista por trás) */
  .ac-dlg { background: #f7fafd; -webkit-backdrop-filter: none; backdrop-filter: none; }
  html[data-tema="escuro"] .ac-dlg { background: #0c2340; }
  .ac-dlg::backdrop { background: rgba(4,23,43,.6); }
  html[data-tema="escuro"] .ac-aviso.atencao { background: color-mix(in srgb, #ffb020 12%, transparent); }
  /* layout-telas: "Atendentes e acessos" dentro do painel (vista), na largura toda, com tabela de pessoas
     e a grade "quem vê o quê" (permissões × papéis). */
  .ac-vista { max-width: none; width: 100%; }
  .ac-vista .ac-topo h1 { font-size: 28px; font-weight: 700; flex: 1 1 260px; }
  .ac-dica { margin: 0; font-size: 13.5px; color: var(--sub); line-height: 1.45; }
  .ac-papeis { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); }
  .ac-papel { display: grid; gap: 4px; padding: 12px 14px; border-radius: 16px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-width: 0; }
  .ac-papel b { font-size: 14.5px; display: flex; justify-content: space-between; gap: 8px; }
  .ac-papel b small { font-size: 12px; color: var(--sub); font-weight: 700; }
  .ac-papel span { font-size: 12.5px; color: var(--sub); line-height: 1.35; }
  .ac-tab { width: 100%; border-collapse: collapse; font-size: 14px; }
  .ac-tab th { text-align: left; font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); padding: 8px 10px; border-bottom: 1px solid var(--vidro-borda); white-space: nowrap; }
  .ac-tab td { padding: 10px; border-bottom: 1px solid var(--vidro-borda); vertical-align: middle; min-width: 0; }
  .ac-tab tr:last-child td { border-bottom: 0; }
  .ac-tab tbody tr { cursor: pointer; } .ac-tab tbody tr:hover td { background: var(--sel, rgba(127,127,127,.06)); }
  .ac-tab tbody tr.inativa { opacity: .6; }
  .ac-quem { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .ac-ini { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .ac-quem div { min-width: 0; display: grid; } .ac-quem b { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-quem small, .ac-tab td small { font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-tab .ac-botao { min-height: 36px; padding: 0 14px; font-size: 13.5px; white-space: nowrap; }
  @media (max-width: 899px) {
    .ac-tab thead { display: none; }
    .ac-tab, .ac-tab tbody { display: grid; gap: 10px; }
    .ac-tab tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 12px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
    .ac-tab td { padding: 0; border: 0; } .ac-tab td:first-child { grid-column: 1 / -1; }
    .ac-tab td[data-r]::before { content: attr(data-r) ": "; color: var(--sub); font-size: 12.5px; }
    .ac-tab td.ac-fim { grid-column: 2; grid-row: 2 / span 4; align-self: center; }
  }
  .ac-matriz-caixa { overflow-x: auto; margin: 0 -4px; padding: 0 4px; }
  .ac-matriz { width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed; min-width: 760px; }
  .ac-matriz th:first-child { width: 24%; }
  .ac-matriz th, .ac-matriz td { padding: 8px 10px; border-bottom: 1px solid var(--vidro-borda); text-align: center; }
  .ac-matriz th:first-child, .ac-matriz td:first-child { text-align: left; }
  .ac-matriz thead th { font-size: 13px; font-weight: 700; position: sticky; top: 0; background: var(--vidro-forte, var(--fundo)); }
  .ac-matriz thead th small { display: block; font-size: 11.5px; font-weight: 600; color: var(--sub); }
  .ac-matriz .ac-mg td { font-size: 11.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); padding-top: 16px; text-align: left; }
  .ac-matriz .ac-chave { display: inline-block; vertical-align: middle; }
  .ac-matriz select.ac-sel { width: 100%; max-width: 220px; min-height: 36px; padding: 6px 8px; font-size: 12.5px; text-overflow: ellipsis; }
  `;
  const MENU = { painel: 'dashboard', funil: 'crm_ver', automacoes: 'automacoes', transmissoes: 'transmissoes', relatorios: 'relatorios', email: 'email_marketing', equipe: 'equipe', acessos: 'equipe' };
  const PAPEL = { atendente: 'Atendente', recepcionista: 'Recepcionista', gerente: 'Gerente', direcao: 'Direção', admin: 'Administração' };
  /* unidades: nomes do cadastro (Empresa › Unidades) */
  const UNID = new Proxy({}, { get: (_, u) => dados?.nomesUnidades?.[u] || window.Sintonia?.ui?.UNIDADE?.[u] || u });
  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const h = (tag, props = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k in e && typeof v !== 'string') e[k] = v; else e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f);
    return e;
  };
  const api = async (url, opcoes = {}) => {
    const r = await fetch(url, { credentials: 'same-origin', ...opcoes, headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) } });
    const j = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(j?.erro || 'Não deu certo. Tente de novo.'), { status: r.status, dados: j });
    return j;
  };
  const enviar = (url, metodo, corpo) => api(url, { method: metodo, body: JSON.stringify(corpo ?? {}) });
  const toast = (t) => (window.Sintonia?.ui?.toast ? window.Sintonia.ui.toast(t) : alert(t));
  const quando = (iso) => {
    if (!iso) return 'nunca entrou';
    const d = new Date(iso); const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 2) return 'agora há pouco'; if (min < 60) return `há ${min} min`; if (min < 1440) return `há ${Math.round(min / 60)} h`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
  const chave = (marcada, aoMudar, desativada) => h('span', { class: 'ac-chave' }, h('input', { type: 'checkbox', role: 'switch', checked: !!marcada, disabled: !!desativada, onchange: (e) => aoMudar(e.target.checked) }), h('i'));
  const IC = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const SVG_EMAIL = IC('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>');
  const SVG_OK = IC('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>');
  const SVG_INFO = IC('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>');
  const SVG_COPIAR = IC('<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>');
  const SVG_ZAP = IC('<path d="M4 20l1.3-4A8 8 0 1 1 8 18.7Z"/><path d="M9.5 9.5c.3 1.6 1.5 3.6 4 4.6l1.2-1.1 1.8.8-.4 1.7c-3.6.2-7.2-3.4-7.3-7l1.7-.4.8 1.8Z"/>');
  const SVG_VOLTAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

  let eu = null, cat = null, dados = null, aba = 'pessoas', raiz = null, perfilSel = 'atendente', naVista = false;

  // ------------------------------------------------------------ menu e troca de senha
  function aplicarMenu() {
    const p = eu?.permissoes; if (!p) return;
    for (const [vista, perm] of Object.entries(MENU)) document.querySelectorAll(`[data-vista="${vista}"]`).forEach((b) => { if (!p[perm] && !b.hidden) b.hidden = true; });
    if (!p.importar_leads && !p.exportar) document.querySelectorAll('[data-vista="leads"]').forEach((b) => { if (!b.hidden) b.hidden = true; });
    const cx = document.getElementById('lt-conexoes'); if (cx && !p.conexoes && !cx.hidden) cx.hidden = true;
  }
  function pedirTrocaDeSenha() {
    const d = h('dialog', { class: 'ac-dlg', id: 'ac-trocar' });
    const erro = h('p', { class: 'ac-erro', role: 'alert' });
    const f = h('form', { class: 'ac-form', onsubmit: async (e) => {
      e.preventDefault();
      try { await enviar('/api/auth/senha', 'POST', { atual: f.atual.value, nova: f.nova.value }); d.close(); toast('Senha trocada. Bom trabalho!'); location.reload(); }
      catch (x) { erro.textContent = x.message; }
    } },
      h('label', { class: 'ac-largo' }, 'Senha provisória (a que você recebeu)', h('input', { name: 'atual', type: 'password', autocomplete: 'current-password', required: true })),
      h('label', { class: 'ac-largo' }, 'Nova senha (10+ caracteres, letras e números)', h('input', { name: 'nova', type: 'password', autocomplete: 'new-password', minLength: 10, required: true })),
      erro, h('div', { class: 'ac-acoes ac-largo' }, h('button', { class: 'ac-botao', type: 'submit', text: 'Trocar senha' })));
    d.append(h('div', {}, h('h2', { text: 'Crie sua senha' }), h('p', { class: 'info', text: 'Por segurança, troque a senha provisória antes de continuar.' }), f));
    d.addEventListener('cancel', (e) => e.preventDefault());
    document.body.append(d); d.showModal();
  }

  // ------------------------------------------------------------ tela
  async function abrir(qual = 'pessoas') {
    aba = qual;
    if (!document.getElementById('estilo-acessos')) document.head.append(h('style', { id: 'estilo-acessos', text: CSS }));
    if (!naVista) raiz?.remove();
    naVista = false;
    raiz = h('div', { class: 'ac-fundo', role: 'region', 'aria-label': 'Usuários e acessos' });
    document.body.append(raiz);
    document.documentElement.style.overflow = 'hidden';
    await carregar();
  }
  function fechar() { if (naVista) return; raiz?.remove(); raiz = null; document.documentElement.style.overflow = ''; }
  /* layout-telas: monta a mesma tela dentro de uma vista do painel (Empresa e conta › Atendentes e acessos). */
  async function desenharNaVista(caixa) {
    if (!document.getElementById('estilo-acessos')) document.head.append(h('style', { id: 'estilo-acessos', text: CSS }));
    if (!naVista) raiz?.remove();
    document.documentElement.style.overflow = '';
    if (!eu) { try { eu = await api('/api/auth/eu'); } catch {} }
    naVista = true; raiz = caixa;
    await carregar();
  }
  const largo = () => matchMedia('(min-width: 900px)').matches;
  async function carregar() {
    try { [cat, dados] = await Promise.all([api('/api/acessos/catalogo'), api('/api/acessos/usuarios')]); }
    catch (x) { raiz.replaceChildren(h('div', { class: 'ac-tela' + (naVista ? ' ac-vista' : '') }, cabecalho(), h('p', { class: 'ac-erro', text: x.message }))); return; }
    if (!cat.perfisEditaveis.includes(perfilSel)) perfilSel = cat.perfisEditaveis[0] || 'atendente';
    desenhar();
  }
  function cabecalho() {
    return h('div', { class: 'ac-topo' }, naVista ? null : h('button', { class: 'ac-voltar', 'aria-label': 'Voltar', html: SVG_VOLTAR, onclick: fechar }), h('h1', { text: naVista ? 'Atendentes e acessos' : 'Usuários e acessos' }),
      aba === 'pessoas' ? h('button', { class: 'ac-botao', text: '+ Convidar pessoa', onclick: () => abrirPessoa(null) }) : null);
  }
  async function desenhar() {
    const abas = h('div', { class: 'ac-abas', role: 'tablist' }, ...[['pessoas', 'Pessoas'], ['perfis', 'Perfis e permissões'], ['auditoria', 'Registro']].map(([id, nome]) =>
      h('button', { class: 'ac-aba', role: 'tab', 'aria-selected': String(aba === id), text: nome, onclick: () => { aba = id; desenhar(); } })));
    let corpo;
    if (aba === 'pessoas') corpo = telaPessoas();
    else if (aba === 'perfis') corpo = telaPerfis();
    else corpo = await telaAuditoria();
    raiz.replaceChildren(h('div', { class: 'ac-tela' + (naVista ? ' ac-vista' : '') }, cabecalho(), abas, corpo));
  }

  const siglaDe = (nome) => { const ini = String(nome || '').split(/\s+/).filter(Boolean); return ((ini[0] || '?')[0] + (ini.length > 1 ? ini[ini.length - 1][0] : '')).toUpperCase(); };
  /** Rosto da pessoa (foto, se houver; senão as iniciais). */
  const rosto = (id, sigla) => {
    const c = h('span', { class: 'ac-ini', 'aria-hidden': 'true', text: sigla });
    const url = window.SintoniaFotos?.url?.(id);
    if (url) { const img = h('img', { src: url, alt: '', loading: 'lazy' }); img.addEventListener('error', () => { img.remove(); c.textContent = sigla; }); c.textContent = ''; c.append(img); }
    return c;
  };
  const nomesUnidades = (p) => p.unidades.map((u) => UNID[u]).join(', ') || (['admin', 'direcao'].includes(p.papel) ? 'Todas as unidades' : 'Sem unidade');
  const nivelNome = (id) => cat?.niveis?.find((n) => n.id === id)?.nome || id;
  function resumoPapeis() {
    return h('div', { class: 'ac-papeis' }, ...cat.papeis.map((pp) => {
      const perms = cat.perfis[pp.id] || {};
      const pode = cat.catalogo.filter((c) => perms[c.chave]).length;
      const qtd = dados.pessoas.filter((p) => p.papel === pp.id && p.ativo).length;
      return h('div', { class: 'ac-papel' }, h('b', {}, pp.nome, h('small', { text: `${qtd} ${qtd === 1 ? 'pessoa' : 'pessoas'}` })),
        h('span', { text: `Conversas: ${nivelNome(perms.conversas)}` }), h('span', { text: `${pode} de ${cat.catalogo.length} permissões ligadas` }));
    }));
  }
  function tabelaPessoas() {
    const linhas = dados.pessoas.map((p) => {
      const sigla = siglaDe(p.nome);
      const conv = { ...(cat.perfis[p.papel] || {}), ...(p.ajustes || {}) }.conversas;
      const selos = h('div', { class: 'ac-selos' },
        !p.ativo ? h('span', { class: 'ac-selo coral', text: 'Desativada' }) : p.nuncaEntrou ? h('span', { class: 'ac-selo', text: p.convite?.tipo === 'convite' ? 'Convite enviado' : 'Ainda não entrou' }) : h('span', { class: 'ac-selo menta', text: 'Ativa' }),
        p.trocarSenha ? h('span', { class: 'ac-selo', text: 'Troca de senha pendente' }) : null,
        p.horario ? h('span', { class: 'ac-selo', text: `${p.horario.inicio}–${p.horario.fim}` }) : null,
        Object.keys(p.ajustes || {}).length ? h('span', { class: 'ac-selo', text: 'Permissões próprias' }) : null);
      return h('tr', { class: p.ativo ? '' : 'inativa', tabindex: '0', onclick: () => abrirPessoa(p), onkeydown: (e) => { if (e.key === 'Enter') abrirPessoa(p); } },
        h('td', {}, h('div', { class: 'ac-quem' }, rosto(p.id, sigla), h('div', {}, h('b', { text: p.eu ? `${p.nome} (você)` : p.nome }), h('small', { text: p.email })))),
        h('td', { 'data-r': 'Papel', text: PAPEL[p.papel] || p.papel }),
        h('td', { 'data-r': 'Unidades', text: nomesUnidades(p) }),
        h('td', { 'data-r': 'Vê conversas', text: nivelNome(conv) }),
        h('td', { 'data-r': 'Último acesso' }, document.createTextNode(quando(p.ultimoAcesso)), p.sessoesAtivas ? h('small', { style: 'display:block', text: `${p.sessoesAtivas} aparelho${p.sessoesAtivas > 1 ? 's' : ''} conectado${p.sessoesAtivas > 1 ? 's' : ''}` }) : null),
        h('td', {}, selos),
        h('td', { class: 'ac-fim' }, p.podeGerenciar ? h('button', { class: 'ac-botao leve', type: 'button', text: 'Editar', onclick: (e) => { e.stopPropagation(); abrirPessoa(p); } }) : null));
    });
    return h('table', { class: 'ac-tab' },
      h('thead', {}, h('tr', {}, ...['Pessoa', 'Papel', 'Unidades', 'Vê conversas', 'Último acesso', 'Situação', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...linhas));
  }
  function telaPessoas() {
    if (naVista) {
      const ativas = dados.pessoas.filter((p) => p.ativo).length;
      return h('div', { style: 'display:grid;gap:16px;min-width:0' },
        dados.envio && !dados.envio.email && eu?.papel && ['admin', 'direcao'].includes(eu.papel)
          ? avisoEnvio('atencao', 'Convites e senhas novas saem por link: você copia ou manda pelo WhatsApp. Para irem também por e-mail, ligue o e-mail do sistema em Conexões › E-mail.')
          : null,
        h('section', { class: 'ac-painel' }, h('h2', {}, 'Como funciona o acesso', h('small', { text: 'Convide por link (a pessoa cria a própria senha). O papel diz o que ela pode fazer; as unidades dizem de onde ela vê as conversas. Toque numa pessoa para mudar.' })), resumoPapeis()),
        h('section', { class: 'ac-painel' }, h('h2', {}, `${dados.pessoas.length} pessoas · ${ativas} ativas`, h('small', { text: eu?.papel === 'gerente' ? 'Quem trabalha nas suas unidades. Você cadastra atendentes e recepcionistas.' : 'Quem entra no Sintonia, o que cada pessoa vê e quando.' })), tabelaPessoas()));
    }
    const cartoes = dados.pessoas.map((p) => h('button', { class: 'ac-pessoa' + (p.ativo ? '' : ' inativa'), onclick: () => abrirPessoa(p) },
      h('b', { text: p.eu ? `${p.nome} (você)` : p.nome }),
      h('span', { text: `${PAPEL[p.papel]} · ${p.unidades.map((u) => UNID[u] || u).join(', ') || (['admin', 'direcao'].includes(p.papel) ? 'Todas as unidades' : 'Sem unidade')}` }),
      h('span', { text: p.email }),
      h('span', { text: `Último acesso: ${quando(p.ultimoAcesso)}${p.sessoesAtivas ? ` · ${p.sessoesAtivas} aparelho${p.sessoesAtivas > 1 ? 's' : ''} conectado${p.sessoesAtivas > 1 ? 's' : ''}` : ''}` }),
      h('div', { class: 'ac-selos' },
        !p.ativo ? h('span', { class: 'ac-selo coral', text: 'Desativada' }) : null,
        p.trocarSenha ? h('span', { class: 'ac-selo', text: 'Troca de senha pendente' }) : null,
        p.horario ? h('span', { class: 'ac-selo', text: `${p.horario.inicio}–${p.horario.fim}` }) : null,
        Object.keys(p.ajustes || {}).length ? h('span', { class: 'ac-selo menta', text: 'Permissões próprias' }) : null)));
    return h('section', { class: 'ac-painel' }, h('h2', {}, `${dados.pessoas.length} pessoas`, h('small', { text: eu.papel === 'gerente' ? 'Quem trabalha nas suas unidades. Você cadastra atendentes e recepcionistas.' : 'Quem entra no Sintonia, o que cada pessoa vê e quando.' })), h('div', { class: 'ac-lista' }, ...cartoes));
  }

  function listaPermissoes(perms, aoMudar, podeMudar) {
    const linhas = [h('div', { class: 'ac-linha' }, h('span', {}, 'Ver conversas', h('small', { text: 'Até onde enxerga as conversas' })),
      h('select', { class: 'ac-sel', style: 'width:auto;max-width:60%', disabled: !podeMudar('conversas'), onchange: (e) => aoMudar('conversas', e.target.value) },
        ...cat.niveis.map((n) => h('option', { value: n.id, text: n.nome, selected: perms.conversas === n.id }))))];
    let grupo = '';
    for (const c of cat.catalogo) {
      if (c.grupo !== grupo) { grupo = c.grupo; linhas.push(h('p', { class: 'ac-grupo', text: grupo })); }
      linhas.push(h('div', { class: 'ac-linha' }, h('span', { text: c.nome }), chave(perms[c.chave], (v) => aoMudar(c.chave, v), !podeMudar(c.chave))));
    }
    return linhas;
  }

  function matrizPerfis() {
    const editaveis = cat.perfisEditaveis;
    const salvar = async (papel, k, v) => {
      try { const r = await enviar(`/api/acessos/perfis/${papel}`, 'PUT', { permissoes: { [k]: v } }); cat.perfis[papel] = r.perfil; toast(`Perfil ${PAPEL[papel]} atualizado.`); }
      catch (x) { toast(x.message); }
      desenhar();
    };
    const linhas = [h('tr', {}, h('td', { text: 'Ver conversas' }), ...cat.papeis.map((pp) => h('td', {},
      h('select', { class: 'ac-sel', 'aria-label': `Ver conversas: ${pp.nome}`, disabled: !editaveis.includes(pp.id), onchange: (e) => salvar(pp.id, 'conversas', e.target.value) },
        ...cat.niveis.map((n) => h('option', { value: n.id, text: n.nome, selected: cat.perfis[pp.id]?.conversas === n.id }))))))];
    let grupo = '';
    for (const c of cat.catalogo) {
      if (c.grupo !== grupo) { grupo = c.grupo; linhas.push(h('tr', { class: 'ac-mg' }, h('td', { colspan: String(cat.papeis.length + 1), text: grupo }))); }
      linhas.push(h('tr', {}, h('td', { text: c.nome }), ...cat.papeis.map((pp) => h('td', {}, chave(cat.perfis[pp.id]?.[c.chave], (v) => salvar(pp.id, c.chave, v), !editaveis.includes(pp.id))))));
    }
    return h('section', { class: 'ac-painel' },
      h('h2', {}, 'Quem vê o quê', h('small', { text: editaveis.length ? 'Cada coluna é um papel. Ligue e desligue o que cada papel pode fazer: vale para todo mundo desse papel (menos quem tem permissões próprias).' : 'Só a direção e a administração mudam os perfis. Aqui você vê como estão.' })),
      h('div', { class: 'ac-matriz-caixa' }, h('table', { class: 'ac-matriz' },
        h('thead', {}, h('tr', {}, h('th', { text: 'Permissão' }), ...cat.papeis.map((pp) => h('th', {}, pp.nome, h('small', { text: editaveis.includes(pp.id) ? 'editável' : 'fixo' }))))),
        h('tbody', {}, ...linhas))));
  }
  function telaPerfis() {
    if (naVista && largo()) return matrizPerfis();
    const editaveis = cat.perfisEditaveis;
    const pills = h('div', { class: 'ac-pills' }, ...cat.papeis.map((p) => h('button', { class: 'ac-aba', 'aria-selected': String(perfilSel === p.id), style: 'box-shadow: inset 0 0 0 1px var(--vidro-borda)', text: p.nome, onclick: () => { perfilSel = p.id; desenhar(); } })));
    const perms = cat.perfis[perfilSel];
    const pode = editaveis.includes(perfilSel);
    const salvar = async (k, v) => {
      try { const r = await enviar(`/api/acessos/perfis/${perfilSel}`, 'PUT', { permissoes: { [k]: v } }); cat.perfis[perfilSel] = r.perfil; toast(`Perfil ${PAPEL[perfilSel]} atualizado.`); }
      catch (x) { toast(x.message); }
      desenhar();
    };
    const restaurar = async () => {
      const padrao = cat.padrao[perfilSel];
      try { const r = await enviar(`/api/acessos/perfis/${perfilSel}`, 'PUT', { permissoes: padrao }); cat.perfis[perfilSel] = r.perfil; toast('Perfil voltou ao padrão.'); } catch (x) { toast(x.message); }
      desenhar();
    };
    return h('section', { class: 'ac-painel' },
      h('h2', {}, 'Perfis', h('small', { text: pode ? 'Ligue e desligue o que cada papel pode fazer. Vale para todo mundo desse papel (menos quem tem permissões próprias).' : 'Só a direção e a administração mudam os perfis. Aqui você vê como estão.' })),
      pills, h('div', {}, ...listaPermissoes(perms, salvar, () => pode)),
      pode ? h('div', { class: 'ac-acoes' }, h('button', { class: 'ac-botao leve', text: 'Voltar ao padrão', onclick: restaurar })) : null);
  }

  async function telaAuditoria() {
    let r; try { r = await api('/api/acessos/auditoria?limite=100'); } catch (x) { return h('p', { class: 'ac-erro', text: x.message }); }
    const ev = r.eventos.map((e) => h('div', { class: 'ac-ev' }, h('span', {}, h('b', { text: e.autorNome }), ` ${e.acao}`, e.alvoNome && e.alvoNome !== e.autorNome ? ` ${e.alvoNome}` : ''), e.detalhe ? h('small', { text: e.detalhe }) : null, h('small', { text: quando(e.em) })));
    return h('section', { class: 'ac-painel' }, h('h2', {}, 'Registro', h('small', { text: 'Quem mudou o quê nos acessos.' })), ev.length ? h('div', {}, ...ev) : h('p', { class: 'info', text: 'Nada registrado ainda.' }));
  }

  // ------------------------------------------------------------ janela da pessoa
  function janela(titulo, ...conteudo) {
    const d = h('dialog', { class: 'ac-dlg' }, h('div', {}, h('h2', { text: titulo }), ...conteudo));
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal();
    return d;
  }
  /* usuarios: aviso de como o link chega à pessoa (e-mail do sistema ligado ou não) */
  function avisoEnvio(tipo, texto, ...extra) {
    return h('div', { class: 'ac-aviso' + (tipo ? ' ' + tipo : ''), role: 'note', html: tipo === 'ok' ? SVG_OK : tipo === 'atencao' ? SVG_INFO : SVG_EMAIL }, h('div', { style: 'display:grid;gap:4px;min-width:0' }, h('p', { text: texto }), ...extra));
  }
  const ateQuando = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  /** Resultado de um convite/link: diz se saiu por e-mail e oferece copiar ou mandar pelo WhatsApp. */
  function mostrarLink(titulo, r, nome) {
    const primeiro = String(nome || '').split(' ')[0] || 'a pessoa';
    const e = r.email || {};
    const status = e.enviado
      ? avisoEnvio('ok', `Enviamos o ${r.tipo === 'convite' ? 'convite' : 'link'} para ${e.para}. Se ${primeiro} não achar, confira o spam ou mande o link abaixo pelo WhatsApp.`)
      : e.configurado
        ? avisoEnvio('atencao', `O e-mail para ${e.para} não saiu agora. Mande o link abaixo pelo WhatsApp ou copie e envie como preferir.`)
        : avisoEnvio('atencao', 'O e-mail do sistema ainda não está ligado, então nada foi enviado sozinho. Copie o link ou mande pelo WhatsApp.', h('small', { class: 'ac-dica-campo', text: 'Para os próximos irem por e-mail: Conexões › E-mail (só a direção e a administração).' }));
    const copiar = h('button', { class: 'ac-botao', type: 'button', html: SVG_COPIAR, onclick: async () => {
      try { await navigator.clipboard.writeText(r.link); copiar.lastChild.textContent = 'Copiado ✓'; toast('Link copiado.'); }
      catch { const sel = getSelection(); const rg = document.createRange(); rg.selectNodeContents(caixaLink); sel.removeAllRanges(); sel.addRange(rg); toast('Link selecionado: copie com o menu do aparelho.'); }
    } }, h('span', { text: 'Copiar link' }));
    const zap = h('a', { class: 'ac-botao ac-zap', href: r.whatsapp || `https://wa.me/?text=${encodeURIComponent(r.texto || r.link)}`, target: '_blank', rel: 'noopener', html: SVG_ZAP }, h('span', { text: r.telefone ? `Mandar no WhatsApp de ${primeiro}` : 'Mandar no WhatsApp' }));
    const caixaLink = h('div', { class: 'ac-link', text: r.link });
    const d = janela(titulo, status,
      h('p', { class: 'info', text: r.tipo === 'convite' ? `${primeiro} abre o link, cria a própria senha e já entra.` : `${primeiro} abre o link, cria uma senha nova e já entra. A senha antiga para de valer.` }),
      caixaLink,
      h('p', { class: 'info', text: `Vale até ${ateQuando(r.expiraEm)} e funciona uma vez só.${r.telefone ? '' : ' Sem telefone cadastrado, o WhatsApp abre para você escolher a conversa.'}` }),
      h('div', { class: 'ac-acoes' }, copiar, zap, h('button', { class: 'ac-botao leve', type: 'button', text: 'Pronto', onclick: () => d.close() })));
    return d;
  }
  const camposUnidades = (marcadas) => h('div', { class: 'ac-checks' }, ...dados.unidades.map((u) => h('label', {}, h('input', { type: 'checkbox', name: 'unidades', value: u, checked: marcadas.includes(u) }), UNID[u] || u)));
  const unidadesDe = (f) => [...f.querySelectorAll('input[name="unidades"]:checked')].map((i) => i.value);
  function camposHorario(hor) {
    const caixa = h('div', { class: 'ac-largo', style: 'display:grid;gap:8px' });
    const liga = h('input', { type: 'checkbox', name: 'temHorario', checked: !!hor });
    const dias = h('div', { class: 'ac-checks' }, ...DIAS.map((n, i) => h('label', {}, h('input', { type: 'checkbox', name: 'dias', value: String(i), checked: hor ? hor.dias.includes(i) : i >= 1 && i <= 6 }), n)));
    const ini = h('input', { type: 'time', name: 'inicio', value: hor?.inicio || '08:00' }), fim = h('input', { type: 'time', name: 'fim', value: hor?.fim || '19:00' });
    const det = h('div', { style: 'display:grid;gap:8px' }, dias, h('div', { class: 'ac-form' }, h('label', {}, 'Das', ini), h('label', {}, 'Até', fim)));
    const sync = () => { det.hidden = !liga.checked; }; liga.addEventListener('change', sync); sync();
    caixa.append(h('label', { style: 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--texto)' }, liga, 'Só entrar em horário de trabalho'), det);
    return caixa;
  }
  const horarioDe = (f) => (f.temHorario.checked ? { dias: [...f.querySelectorAll('input[name="dias"]:checked')].map((i) => Number(i.value)), inicio: f.inicio.value, fim: f.fim.value } : null);

  /** Foto escolhida pela gestão: reduz para 256 px (como em Conta › Perfil) e salva. */
  async function enviarFoto(id, aoTerminar) {
    const i = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
    i.addEventListener('change', async () => {
      const arq = i.files?.[0]; if (!arq) return;
      try {
        const bmp = await createImageBitmap(arq); const lado = Math.min(bmp.width, bmp.height), t = 256;
        const tela = Object.assign(document.createElement('canvas'), { width: t, height: t });
        tela.getContext('2d').drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, t, t);
        await enviar(`/api/equipe/${id}/foto`, 'PUT', { base64: tela.toDataURL('image/jpeg', 0.85).split(',')[1], mimetype: 'image/jpeg' });
        await window.SintoniaFotos?.carregar?.(); toast('Foto salva.'); aoTerminar?.();
      } catch (x) { toast(x.message || 'Não deu para usar essa imagem.'); }
    });
    i.click();
  }

  function abrirPessoa(p) {
    if (!p) return novaPessoa();
    if (!p.podeGerenciar) return toast(p.eu ? 'Seus dados ficam em Conta (toque na sua foto).' : 'Você não pode mudar o acesso desta pessoa.');
    const erro = h('p', { class: 'ac-erro', role: 'alert' });
    const ajustes = { ...(p.ajustes || {}) };
    const efetiva = () => ({ ...cat.perfis[f.papel.value], ...ajustes });
    const permsCaixa = h('div');
    const desenharPerms = () => permsCaixa.replaceChildren(...listaPermissoes(efetiva(), (k, v) => { if (cat.perfis[f.papel.value][k] === v) delete ajustes[k]; else ajustes[k] = v; desenharPerms(); }, (k) => eu.papel === 'admin' || (dados.minhas[k] === true || (k === 'conversas'))));
    const fotoCaixa = h('span');
    const pintarFoto = () => fotoCaixa.replaceChildren(rosto(p.id, siglaDe(p.nome)));
    pintarFoto();
    const temFoto = () => !!window.SintoniaFotos?.url?.(p.id);
    const btFoto = h('button', { class: 'ac-botao leve', type: 'button', text: temFoto() ? 'Trocar foto' : 'Pôr foto', onclick: () => enviarFoto(p.id, () => { pintarFoto(); btFoto.textContent = 'Trocar foto'; btTirar.hidden = false; carregar(); }) });
    const btTirar = h('button', { class: 'ac-botao leve', type: 'button', text: 'Tirar foto', hidden: !temFoto(), onclick: async () => { try { await api(`/api/equipe/${p.id}/foto`, { method: 'DELETE' }); await window.SintoniaFotos?.carregar?.(); pintarFoto(); btTirar.hidden = true; btFoto.textContent = 'Pôr foto'; carregar(); } catch (x) { toast(x.message); } } });
    const f = h('form', { class: 'ac-form', onsubmit: async (e) => {
      e.preventDefault(); erro.textContent = '';
      const bt = f.querySelector('button[type=submit]'); bt.disabled = true;
      try {
        await enviar(`/api/acessos/usuarios/${p.id}`, 'PATCH', { nome: f.nome.value.trim(), email: f.email.value.trim(), telefone: f.telefone.value.trim(), papel: f.papel.value, unidades: unidadesDe(f), ajustes, horario: horarioDe(f), trocarSenha: f.trocar.checked });
        d.close(); toast('Pessoa atualizada.'); carregar();
      } catch (x) { erro.textContent = x.message; bt.disabled = false; }
    } },
      h('div', { class: 'ac-largo ac-foto-linha' }, fotoCaixa, h('div', { class: 'ac-acoes' }, btFoto, btTirar)),
      h('label', { class: 'ac-largo' }, 'Nome', h('input', { name: 'nome', value: p.nome, required: true, minLength: 2, maxLength: 120, autocomplete: 'off' })),
      h('label', {}, 'E-mail de login', h('input', { name: 'email', type: 'email', value: p.email, required: true, autocomplete: 'off' })),
      h('label', {}, h('span', {}, 'WhatsApp ', h('span', { class: 'ac-dica-campo', text: '(opcional)' })), h('input', { name: 'telefone', type: 'tel', inputmode: 'tel', value: p.telefone || '', placeholder: '(71) 99999-0000', autocomplete: 'off', maxLength: 30 })),
      h('label', {}, 'Papel', h('select', { name: 'papel', onchange: desenharPerms }, ...dados.papeis.map((x) => h('option', { value: x, text: PAPEL[x], selected: x === p.papel })))),
      h('label', { class: 'ac-largo' }, 'Unidades', camposUnidades(p.unidades)),
      camposHorario(p.horario),
      h('label', { class: 'ac-largo', style: 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--texto)' }, h('input', { type: 'checkbox', name: 'trocar', checked: p.trocarSenha }), 'Trocar a senha no próximo login'),
      h('details', { class: 'ac-largo' }, h('summary', { style: 'cursor:pointer;font-weight:700;color:var(--texto);min-height:32px' }, 'Permissões desta pessoa'), h('p', { class: 'info', text: 'Partem do perfil do papel (a grade "Quem vê o quê"). O que você mudar aqui vale só para ela.' }), permsCaixa),
      erro, h('div', { class: 'ac-acoes ac-largo' }, h('button', { class: 'ac-botao', type: 'submit', text: 'Salvar' }), h('button', { class: 'ac-botao leve', type: 'button', text: 'Fechar', onclick: () => d.close() })));
    desenharPerms();
    const sessoes = h('div', {}, h('p', { class: 'info', text: 'Carregando aparelhos…' }));
    const carregarSessoes = async () => {
      try {
        const r = await api(`/api/acessos/usuarios/${p.id}/sessoes`);
        sessoes.replaceChildren(...(r.sessoes.length ? r.sessoes.map((s) => h('div', { class: 'ac-linha' }, h('span', {}, s.aparelho || 'Aparelho', h('small', { text: `Usado ${quando(s.usadaEm || s.criadaEm)}${s.ip ? ` · ${s.ip}` : ''}` })),
          h('button', { class: 'ac-botao leve', type: 'button', text: 'Desconectar', onclick: async () => { try { await api(`/api/acessos/usuarios/${p.id}/sessoes/${s.id}`, { method: 'DELETE' }); toast('Aparelho desconectado.'); carregarSessoes(); } catch (x) { toast(x.message); } } })))
          : [h('p', { class: 'info', text: p.ativo ? 'Nenhum aparelho conectado agora.' : 'Desativada: não entra em nenhum aparelho.' })]));
      } catch (x) { sessoes.replaceChildren(h('p', { class: 'ac-erro', text: x.message })); }
    };
    const primeiro = p.nome.split(' ')[0];
    const confirmar = (bt, texto, acao) => { let armado = false; bt.addEventListener('click', async () => { if (!armado) { armado = true; bt.textContent = texto; return; } bt.disabled = true; try { await acao(); } catch (x) { erro.textContent = x.message; bt.disabled = false; } }); return bt; };
    const bAtivar = p.ativo
      ? confirmar(h('button', { class: 'ac-botao perigo', type: 'button', text: 'Desativar acesso' }), `Confirmar: tirar o acesso de ${primeiro}`, async () => { await enviar(`/api/acessos/usuarios/${p.id}/desativar`, 'POST'); d.close(); toast(`${primeiro} saiu de todos os aparelhos e não entra mais. O histórico continua guardado.`); carregar(); })
      : h('button', { class: 'ac-botao leve', type: 'button', text: 'Reativar acesso', onclick: async () => { try { await enviar(`/api/acessos/usuarios/${p.id}/reativar`, 'POST'); d.close(); toast('Acesso reativado.'); carregar(); } catch (x) { erro.textContent = x.message; } } });
    // Apagar só aparece para quem nunca entrou (convite errado, cadastro repetido). O servidor confere o histórico.
    const bApagar = p.nuncaEntrou ? confirmar(h('button', { class: 'ac-botao perigo', type: 'button', text: 'Apagar' }), `Confirmar: apagar ${primeiro}`, async () => { await api(`/api/acessos/usuarios/${p.id}`, { method: 'DELETE' }); d.close(); toast(`${primeiro} foi apagada.`); carregar(); }) : null;
    const textoLink = p.nuncaEntrou ? 'Gerar novo convite' : 'Link para criar senha nova';
    const bLink = p.ativo ? h('button', { class: 'ac-botao leve', type: 'button', text: textoLink, onclick: async () => {
      bLink.disabled = true;
      try { const r = await enviar(`/api/acessos/usuarios/${p.id}/link`, 'POST', {}); d.close(); carregar(); mostrarLink(r.tipo === 'convite' ? 'Convite novo' : 'Link para senha nova', r, p.nome); }
      catch (x) { erro.textContent = x.message; bLink.disabled = false; }
    } }) : null;
    const situacao = !p.ativo ? 'Acesso desativado' : p.nuncaEntrou ? (p.convite ? `Convite em aberto até ${ateQuando(p.convite.expiraEm)}` : 'Ainda não entrou (o convite venceu: gere um novo)') : `Último acesso ${quando(p.ultimoAcesso)}`;
    const d = janela(p.nome, h('p', { class: 'info', text: `${PAPEL[p.papel]} · ${situacao}` }), f,
      h('h3', { class: 'ac-grupo', text: 'Senha e aparelhos' }),
      h('p', { class: 'info', text: dados.envio?.email ? 'O link vai para o e-mail da pessoa e aparece aqui para copiar ou mandar pelo WhatsApp.' : 'O e-mail do sistema não está ligado: o link aparece aqui para copiar ou mandar pelo WhatsApp.' }),
      sessoes,
      h('div', { class: 'ac-acoes' }, bLink,
        p.ativo ? h('button', { class: 'ac-botao leve', type: 'button', text: 'Desconectar de tudo', onclick: async () => { try { await enviar(`/api/acessos/usuarios/${p.id}/desconectar`, 'POST'); toast('Desconectada de todos os aparelhos.'); carregarSessoes(); } catch (x) { erro.textContent = x.message; } } }) : null),
      h('div', { class: 'ac-acoes ac-separa' }, bAtivar, bApagar));
    carregarSessoes();
  }

  function novaPessoa() {
    const erro = h('p', { class: 'ac-erro', role: 'alert' });
    const senhaCaixa = h('label', { class: 'ac-largo', hidden: true }, 'Senha provisória (10+ caracteres, letras e números)', h('input', { name: 'senha', type: 'text', autocomplete: 'off', minLength: 10 }));
    const validade = h('label', {}, 'O link vale por', h('select', { name: 'validade' }, h('option', { value: '24', text: '1 dia' }), h('option', { value: '72', text: '3 dias', selected: true }), h('option', { value: '168', text: '7 dias' })));
    const modo = h('details', { class: 'ac-largo' }, h('summary', { style: 'cursor:pointer;font-weight:700;color:var(--texto);min-height:32px;font-size:13.5px' }, 'Outra forma: senha provisória'),
      h('div', { class: 'ac-checks', style: 'margin-top:8px' },
        h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'convite', checked: true }), 'Link de convite (recomendado)'),
        h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'senha' }), 'Eu digito uma senha provisória')));
    modo.addEventListener('change', () => { const s = f.modo.value === 'senha'; senhaCaixa.hidden = !s; validade.hidden = s; f.senha.required = s; bt.textContent = s ? 'Adicionar pessoa' : 'Convidar e gerar link'; });
    const bt = h('button', { class: 'ac-botao', type: 'submit', text: 'Convidar e gerar link' });
    const f = h('form', { class: 'ac-form', onsubmit: async (e) => {
      e.preventDefault(); erro.textContent = '';
      const corpo = { nome: f.nome.value.trim(), email: f.email.value.trim(), telefone: f.telefone.value.trim(), papel: f.papel.value, unidades: unidadesDe(f), horario: horarioDe(f) };
      if (!corpo.telefone) delete corpo.telefone;
      if (f.modo.value === 'senha') Object.assign(corpo, { senha: f.senha.value, trocarSenha: true }); else corpo.validadeHoras = Number(f.validade.value);
      bt.disabled = true;
      try {
        const r = await enviar('/api/acessos/usuarios', 'POST', corpo);
        d.close(); carregar();
        if (r.link) mostrarLink('Convite pronto', r, corpo.nome);
        else toast('Pessoa adicionada. Ela troca a senha no primeiro login.');
      } catch (x) { erro.textContent = x.message; bt.disabled = false; }
    } },
      dados.envio?.email
        ? h('div', { class: 'ac-largo' }, avisoEnvio('ok', 'O convite vai para o e-mail da pessoa. Você também recebe o link para copiar ou mandar pelo WhatsApp.'))
        : h('div', { class: 'ac-largo' }, avisoEnvio('atencao', 'O e-mail do sistema ainda não está ligado. Sem problema: depois de convidar, você copia o link ou manda pelo WhatsApp.')),
      h('label', { class: 'ac-largo' }, 'Nome', h('input', { name: 'nome', required: true, minLength: 2, maxLength: 120, autocomplete: 'off' })),
      h('label', {}, 'E-mail (vai ser o login)', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      h('label', {}, h('span', {}, 'WhatsApp ', h('span', { class: 'ac-dica-campo', text: '(opcional, para mandar o link)' })), h('input', { name: 'telefone', type: 'tel', inputmode: 'tel', placeholder: '(71) 99999-0000', autocomplete: 'off', maxLength: 30 })),
      h('label', {}, 'Papel', h('select', { name: 'papel' }, ...dados.papeis.map((x) => h('option', { value: x, text: PAPEL[x] })))),
      validade,
      h('label', { class: 'ac-largo' }, 'Unidades', camposUnidades(dados.unidades.length === 1 ? dados.unidades : [])),
      camposHorario(null), modo, senhaCaixa, erro,
      h('div', { class: 'ac-acoes ac-largo' }, bt, h('button', { class: 'ac-botao leve', type: 'button', text: 'Cancelar', onclick: () => d.close() })));
    const d = janela('Convidar pessoa', f);
  }

  // ------------------------------------------------------------ ligação com a tela de Equipe
  function botaoNaEquipe() {
    const caixa = document.getElementById('equipe');
    if (!caixa || !eu?.permissoes?.equipe) return;
    const cab = caixa.querySelector('.cab');
    if (!cab || cab.querySelector('.ac-entrar')) return;
    cab.append(h('button', { class: 'botao ac-entrar', type: 'button', text: 'Usuários e acessos', onclick: () => abrir('pessoas') }));
  }

  window.SintoniaTelas.acessos = { abrir, fechar, desenhar: (caixa) => desenharNaVista(caixa) };
  addEventListener('load', async () => {
    try { eu = await api('/api/auth/eu'); } catch { return; }
    aplicarMenu();
    if (eu.trocarSenha) pedirTrocaDeSenha();
    const caixa = document.getElementById('equipe');
    if (caixa) new MutationObserver(botaoNaEquipe).observe(caixa, { childList: true });
    // O menu é redesenhado depois do login: reaplica quando o "Mais" e a lateral mudam.
    new MutationObserver(() => aplicarMenu()).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  });
})();
