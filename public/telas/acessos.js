/* Usuários e acessos: pessoas (convidar, editar, desativar, redefinir senha, sessões, horário),
 * perfis × permissões (chaves liga/desliga) e auditoria. Também esconde do menu o que a pessoa
 * não pode e pede a troca de senha obrigatória. Registra window.SintoniaTelas.acessos.
 * Estilos em <style id="estilo-acessos">, prefixo .ac-.
 */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ac-fundo { position: fixed; inset: 0; z-index: 60; overflow-y: auto; overflow-x: hidden; background: var(--fundo, #f4f7fb); background-image: var(--aurora, none); padding: max(16px, env(safe-area-inset-top)) 16px 120px; box-sizing: border-box; }
  .ac-tela { max-width: 980px; margin: 0 auto; display: grid; gap: 16px; min-width: 0; font-family: Poppins, system-ui, sans-serif; color: var(--texto, #08243f); }
  .ac-topo { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ac-topo h1 { margin: 0; font-family: Sintony, Poppins, sans-serif; font-size: clamp(26px, 6vw, 36px); font-weight: 800; flex: 1 1 200px; }
  .ac-voltar { all: unset; cursor: pointer; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--vidro-item, rgba(127,127,127,.1)); box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(127,127,127,.25)); }
  .ac-voltar svg { width: 20px; height: 20px; }
  .ac-abas { display: inline-flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo, rgba(255,255,255,.6)); border: 1px solid var(--vidro-borda, rgba(127,127,127,.2)); max-width: 100%; overflow-x: auto; }
  .ac-aba { all: unset; cursor: pointer; padding: 0 16px; min-height: 40px; display: inline-flex; align-items: center; border-radius: 999px; font-weight: 700; font-size: 14px; color: var(--sub, #5b6b7e); white-space: nowrap; }
  .ac-aba[aria-selected="true"] { background: color-mix(in srgb, #0ffcbe 28%, transparent); color: var(--texto); box-shadow: inset 0 0 0 1px color-mix(in srgb, #0ffcbe 60%, transparent) !important; }
  .ac-painel { border-radius: 24px; padding: 16px; display: grid; gap: 12px; min-width: 0; background: var(--vidro-fundo, rgba(255,255,255,.7)); border: 1px solid var(--vidro-borda, rgba(127,127,127,.2)); box-shadow: var(--vidro-brilho, none); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); }
  .ac-painel h2 { margin: 0; font-size: 16px; font-weight: 800; } .ac-painel h2 small { display: block; font-size: 12.5px; font-weight: 500; color: var(--sub); margin-top: 3px; }
  .ac-lista { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); }
  .ac-pessoa { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 4px; padding: 14px; border-radius: 18px; background: var(--vidro-item, rgba(127,127,127,.08)); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-width: 0; }
  .ac-pessoa:hover { transform: translateY(-1px); } .ac-pessoa.inativa { opacity: .6; }
  .ac-pessoa b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-pessoa span { font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ac-selos { display: flex; flex-wrap: wrap; gap: 4px; }
  .ac-selo { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, #106ebe 14%, transparent); color: var(--texto); }
  .ac-selo.coral { background: color-mix(in srgb, #ff7a59 22%, transparent); } .ac-selo.menta { background: color-mix(in srgb, #0ffcbe 30%, transparent); }
  .ac-botao { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 18px; border-radius: 999px; background: var(--marca-menta, #0ffcbe); color: #071d33; font-weight: 800; font-size: 14.5px; box-shadow: 0 6px 20px rgba(15,252,190,.25); }
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
  .ac-grupo { font-size: 12px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--sub); margin: 10px 0 0; }
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
  .ac-dlg h2 { margin: 0; font-size: 20px; font-weight: 800; }
  .ac-link { font-size: 13px; padding: 10px 12px; border-radius: 12px; background: var(--vidro-item); overflow-wrap: anywhere; user-select: all; }
  .ac-ev { display: grid; gap: 2px; padding: 10px 2px; border-top: 1px solid var(--vidro-borda); font-size: 13.5px; } .ac-ev:first-child { border-top: 0; } .ac-ev small { color: var(--sub); }
  .ac-pills { display: flex; gap: 6px; flex-wrap: wrap; }
  @media (prefers-reduced-motion: reduce) { .ac-chave i, .ac-chave i::after { transition: none; } }
  `;
  const MENU = { painel: 'dashboard', funil: 'crm_ver', automacoes: 'automacoes', transmissoes: 'transmissoes', relatorios: 'relatorios', email: 'email_marketing', equipe: 'equipe' };
  const PAPEL = { atendente: 'Atendente', recepcionista: 'Recepcionista', gerente: 'Gerente', direcao: 'Direção', admin: 'Administração' };
  const UNID = { norte: 'Norte', sumare: 'Sumaré', feira: 'Feira' };
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
  const SVG_VOLTAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

  let eu = null, cat = null, dados = null, aba = 'pessoas', raiz = null, perfilSel = 'atendente';

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
    raiz?.remove();
    raiz = h('div', { class: 'ac-fundo', role: 'region', 'aria-label': 'Usuários e acessos' });
    document.body.append(raiz);
    document.documentElement.style.overflow = 'hidden';
    await carregar();
  }
  function fechar() { raiz?.remove(); raiz = null; document.documentElement.style.overflow = ''; }
  async function carregar() {
    try { [cat, dados] = await Promise.all([api('/api/acessos/catalogo'), api('/api/acessos/usuarios')]); }
    catch (x) { raiz.replaceChildren(h('div', { class: 'ac-tela' }, cabecalho(), h('p', { class: 'ac-erro', text: x.message }))); return; }
    if (!cat.perfisEditaveis.includes(perfilSel)) perfilSel = cat.perfisEditaveis[0] || 'atendente';
    desenhar();
  }
  function cabecalho() {
    return h('div', { class: 'ac-topo' }, h('button', { class: 'ac-voltar', 'aria-label': 'Voltar', html: SVG_VOLTAR, onclick: fechar }), h('h1', { text: 'Usuários e acessos' }),
      aba === 'pessoas' ? h('button', { class: 'ac-botao', text: '+ Convidar pessoa', onclick: () => abrirPessoa(null) }) : null);
  }
  async function desenhar() {
    const abas = h('div', { class: 'ac-abas', role: 'tablist' }, ...[['pessoas', 'Pessoas'], ['perfis', 'Perfis e permissões'], ['auditoria', 'Registro']].map(([id, nome]) =>
      h('button', { class: 'ac-aba', role: 'tab', 'aria-selected': String(aba === id), text: nome, onclick: () => { aba = id; desenhar(); } })));
    let corpo;
    if (aba === 'pessoas') corpo = telaPessoas();
    else if (aba === 'perfis') corpo = telaPerfis();
    else corpo = await telaAuditoria();
    raiz.replaceChildren(h('div', { class: 'ac-tela' }, cabecalho(), abas, corpo));
  }

  function telaPessoas() {
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

  function telaPerfis() {
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
  function mostrarLink(titulo, r, texto) {
    janela(titulo, h('p', { class: 'info', text: texto }), h('div', { class: 'ac-link', text: r.link }), h('p', { class: 'info', text: `Vale até ${new Date(r.expiraEm).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}. Funciona uma vez só.` }),
      h('div', { class: 'ac-acoes' }, h('button', { class: 'ac-botao', text: 'Copiar link', onclick: async () => { try { await navigator.clipboard.writeText(r.link); toast('Link copiado.'); } catch { toast('Selecione o link e copie.'); } } }),
        h('a', { class: 'ac-botao leve', href: `https://wa.me/?text=${encodeURIComponent(`Seu acesso ao Sintonia: ${r.link}`)}`, target: '_blank', rel: 'noopener', text: 'Mandar no WhatsApp' })));
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

  function abrirPessoa(p) {
    if (!p) return novaPessoa();
    if (!p.podeGerenciar) return toast(p.eu ? 'Seus dados ficam em Conta.' : 'Você não pode mudar o acesso desta pessoa.');
    const erro = h('p', { class: 'ac-erro', role: 'alert' });
    const perfil = cat.perfis[p.papel];
    const ajustes = { ...(p.ajustes || {}) };
    const efetiva = () => ({ ...cat.perfis[f.papel.value], ...ajustes });
    const permsCaixa = h('div');
    const desenharPerms = () => permsCaixa.replaceChildren(...listaPermissoes(efetiva(), (k, v) => { if (cat.perfis[f.papel.value][k] === v) delete ajustes[k]; else ajustes[k] = v; desenharPerms(); }, (k) => eu.papel === 'admin' || (dados.minhas[k] === true || (k === 'conversas'))));
    const f = h('form', { class: 'ac-form', onsubmit: async (e) => {
      e.preventDefault();
      try {
        await enviar(`/api/acessos/usuarios/${p.id}`, 'PATCH', { papel: f.papel.value, unidades: unidadesDe(f), ajustes, horario: horarioDe(f), trocarSenha: f.trocar.checked });
        d.close(); toast('Acesso atualizado.'); carregar();
      } catch (x) { erro.textContent = x.message; }
    } },
      h('label', {}, 'Papel', h('select', { name: 'papel', onchange: desenharPerms }, ...dados.papeis.map((x) => h('option', { value: x, text: PAPEL[x], selected: x === p.papel })))),
      h('label', { class: 'ac-largo' }, 'Unidades', camposUnidades(p.unidades)),
      camposHorario(p.horario),
      h('label', { class: 'ac-largo', style: 'display:flex;align-items:center;gap:8px;font-size:14px;color:var(--texto)' }, h('input', { type: 'checkbox', name: 'trocar', checked: p.trocarSenha }), 'Trocar a senha no próximo login'),
      h('details', { class: 'ac-largo' }, h('summary', { style: 'cursor:pointer;font-weight:700;color:var(--texto);min-height:32px' }, 'Permissões desta pessoa'), h('p', { class: 'info', text: 'Partem do perfil do papel. O que você mudar aqui vale só para ela.' }), permsCaixa),
      erro, h('div', { class: 'ac-acoes ac-largo' }, h('button', { class: 'ac-botao', type: 'submit', text: 'Salvar' }), h('button', { class: 'ac-botao leve', type: 'button', text: 'Fechar', onclick: () => d.close() })));
    void perfil; desenharPerms();
    const sessoes = h('div', {}, h('p', { class: 'info', text: 'Carregando aparelhos…' }));
    const carregarSessoes = async () => {
      try {
        const r = await api(`/api/acessos/usuarios/${p.id}/sessoes`);
        sessoes.replaceChildren(...(r.sessoes.length ? r.sessoes.map((s) => h('div', { class: 'ac-linha' }, h('span', {}, (s.aparelho || 'Aparelho').replace(/\s*\(.*$/, '').slice(0, 40) || 'Aparelho', h('small', { text: `Usado ${quando(s.usadaEm || s.criadaEm)}${s.ip ? ` · ${s.ip}` : ''}` })),
          h('button', { class: 'ac-botao leve', type: 'button', text: 'Desconectar', onclick: async () => { try { await api(`/api/acessos/usuarios/${p.id}/sessoes/${s.id}`, { method: 'DELETE' }); toast('Aparelho desconectado.'); carregarSessoes(); } catch (x) { toast(x.message); } } })))
          : [h('p', { class: 'info', text: 'Nenhum aparelho conectado agora.' })]));
      } catch (x) { sessoes.replaceChildren(h('p', { class: 'ac-erro', text: x.message })); }
    };
    let confirmar = false;
    const bAtivar = h('button', { class: 'ac-botao ' + (p.ativo ? 'perigo' : 'leve'), type: 'button', text: p.ativo ? 'Desativar acesso' : 'Reativar acesso', onclick: async () => {
      if (p.ativo && !confirmar) { confirmar = true; bAtivar.textContent = `Confirmar: desativar ${p.nome.split(' ')[0]}`; return; }
      try { await enviar(`/api/acessos/usuarios/${p.id}/${p.ativo ? 'desativar' : 'reativar'}`, 'POST'); d.close(); toast(p.ativo ? 'Acesso desativado. O histórico continua guardado.' : 'Acesso reativado.'); carregar(); } catch (x) { erro.textContent = x.message; }
    } });
    const d = janela(p.nome, h('p', { class: 'info', text: `${p.email} · último acesso ${quando(p.ultimoAcesso)}` }), f,
      h('h3', { class: 'ac-grupo', text: 'Aparelhos conectados' }), sessoes,
      h('div', { class: 'ac-acoes' },
        h('button', { class: 'ac-botao leve', type: 'button', text: 'Link para redefinir senha', onclick: async () => { try { const r = await enviar(`/api/acessos/usuarios/${p.id}/redefinir`, 'POST', {}); d.close(); mostrarLink('Link para redefinir a senha', r, `Mande este link para ${p.nome.split(' ')[0]} criar uma senha nova.`); } catch (x) { erro.textContent = x.message; } } }),
        h('button', { class: 'ac-botao leve', type: 'button', text: 'Desconectar de tudo', onclick: async () => { try { await enviar(`/api/acessos/usuarios/${p.id}/desconectar`, 'POST'); toast('Desconectada de todos os aparelhos.'); carregarSessoes(); } catch (x) { erro.textContent = x.message; } } }),
        bAtivar));
    carregarSessoes();
  }

  function novaPessoa() {
    const erro = h('p', { class: 'ac-erro', role: 'alert' });
    const senhaCaixa = h('label', { class: 'ac-largo', hidden: true }, 'Senha provisória (10+ caracteres, letras e números)', h('input', { name: 'senha', type: 'text', autocomplete: 'off', minLength: 10 }));
    const validade = h('label', {}, 'Link vale por', h('select', { name: 'validade' }, h('option', { value: '24', text: '1 dia' }), h('option', { value: '72', text: '3 dias', selected: true }), h('option', { value: '168', text: '7 dias' })));
    const modo = h('div', { class: 'ac-checks ac-largo' },
      h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'convite', checked: true }), 'Link de convite'),
      h('label', {}, h('input', { type: 'radio', name: 'modo', value: 'senha' }), 'Senha provisória'));
    modo.addEventListener('change', () => { const s = f.modo.value === 'senha'; senhaCaixa.hidden = !s; validade.hidden = s; f.senha.required = s; });
    const f = h('form', { class: 'ac-form', onsubmit: async (e) => {
      e.preventDefault();
      const corpo = { nome: f.nome.value.trim(), email: f.email.value.trim(), papel: f.papel.value, unidades: unidadesDe(f), horario: horarioDe(f) };
      if (f.modo.value === 'senha') Object.assign(corpo, { senha: f.senha.value, trocarSenha: true }); else corpo.validadeHoras = Number(f.validade.value);
      try {
        const r = await enviar('/api/acessos/usuarios', 'POST', corpo);
        d.close(); carregar();
        if (r.link) mostrarLink('Convite criado', r, `Mande este link para ${corpo.nome.split(' ')[0]}: ela cria a própria senha e já entra.`);
        else toast('Pessoa adicionada. Ela troca a senha no primeiro login.');
      } catch (x) { erro.textContent = x.message; }
    } },
      h('label', { class: 'ac-largo' }, 'Nome', h('input', { name: 'nome', required: true, minLength: 2, autocomplete: 'off' })),
      h('label', { class: 'ac-largo' }, 'E-mail', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'off' })),
      h('label', {}, 'Papel', h('select', { name: 'papel' }, ...dados.papeis.map((x) => h('option', { value: x, text: PAPEL[x] })))),
      h('label', { class: 'ac-largo' }, 'Unidades', camposUnidades(dados.unidades.length === 1 ? dados.unidades : [])),
      modo, validade, senhaCaixa, camposHorario(null), erro,
      h('div', { class: 'ac-acoes ac-largo' }, h('button', { class: 'ac-botao', type: 'submit', text: 'Convidar' }), h('button', { class: 'ac-botao leve', type: 'button', text: 'Cancelar', onclick: () => d.close() })));
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

  window.SintoniaTelas.acessos = { abrir, fechar };
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
