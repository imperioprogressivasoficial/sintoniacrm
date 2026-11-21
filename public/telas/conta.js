/* empresa-conta: Conta da pessoa logada (abre pelo nome/foto no rodapé do menu, #lt-eu, e pelo perfil no Mais do celular).
 * Abas: Perfil, Área de trabalho, Notificações, Privacidade, E-mail e Integrações (API, webhooks, MCP — tela do agente
 * "integracoes": window.SintoniaTelas.integracoes.desenhar(caixa, ui), se existir). Dados: /api/conta (src/conta/conta.ts),
 * foto em /api/equipe/:id/foto, senha em /api/auth/senha, notificações em telas/notificacoes.js,
 * excluir a conta em /api/conta/excluir (sem-pagamento: a aba Faturamento saiu; entrou Privacidade, pedida pela App Store).
 * Usa as peças de window.SintoniaEC (telas/empresa.js). Registra window.SintoniaTelas.conta = { desenhar(caixa, ui), irAba(aba) }. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const CSS = `
  .ct-perfil { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .ct-foto { width: 88px; height: 88px; border-radius: 50%; flex: none; display: grid; place-items: center; overflow: hidden; font-size: 28px; font-weight: 700; color: #fff; background: linear-gradient(135deg, #1a8be0, #0a4c86); box-shadow: 0 0 0 3px var(--ec-cartao), 0 0 0 4.5px var(--ec-borda); }
  .ct-foto img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ct-perfil .ct-quem { display: grid; gap: 4px; min-width: 0; flex: 1 1 200px; }
  .ct-perfil .ct-quem b { font-size: 20px; }
  .ct-previa { display: grid; gap: 6px; padding: 12px; border-radius: 16px; background: var(--ec-campo); }
  .ct-bolha { justify-self: end; max-width: 85%; padding: 8px 11px 6px; border-radius: 14px 14px 4px 14px; background: #d9fdd3; color: #0b1b12; font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-break: break-word; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
  html[data-tema="escuro"] .ct-bolha { background: #005c4b; color: #e9fff6; }
  .ct-bolha b { font-weight: 700; } .ct-bolha i { font-style: italic; }
  /* sem-pagamento: aba Privacidade (links legais e excluir a conta) */
  .ct-links { display: grid; gap: 8px; }
  .ct-link { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 16px; color: var(--texto); text-decoration: none; background: var(--ec-campo); font-weight: 600; font-size: 14.5px; }
  .ct-link small { display: block; font-weight: 400; color: var(--sub); font-size: 12.5px; }
  .ct-link > span { flex: 1; min-width: 0; }
  .ct-link svg { width: 18px; height: 18px; flex: none; color: var(--sub); }
  .ct-link:focus-visible { outline: 2px solid #106ebe; outline-offset: 2px; }
  .ct-perigo { box-shadow: inset 0 0 0 1.5px rgba(220, 38, 38, .35), var(--ec-sombra) !important; }
  .ct-confirma { font: inherit; font-size: 16px; letter-spacing: .08em; text-transform: uppercase; }
  .ct-nt .nt-pref-corpo { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); align-items: start; }
  .ct-nt .nt-secao { background: var(--ec-cartao); box-shadow: inset 0 0 0 1px var(--ec-borda), var(--ec-sombra); border-radius: 22px; padding: 10px; }
  /* densidade compacta (Conta › Área de trabalho): lista de conversas e telas mais juntas */
  html[data-densidade="compacta"] .item { height: 60px; }
  html[data-densidade="compacta"] .item .nome { font-size: 15.5px; }
  html[data-densidade="compacta"] .item .previa { font-size: 13px; }
  html[data-densidade="compacta"] .painel { gap: 10px; }
  html[data-densidade="compacta"] .ec-c, html[data-densidade="compacta"] .pn-b { padding: 12px 14px; }
  `;
  let ui, EC, caixa, conta = null;
  let aba = 'perfil';
  const ABAS = [
    ['perfil', 'Perfil', 'equipe'],
    ['trabalho', 'Área de trabalho', 'geral'],
    ['notificacoes', 'Notificações', '<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>'],
    ['privacidade', 'Privacidade', 'acesso'], /* sem-pagamento: no lugar de Faturamento */
    ['email', 'Configuração de e-mail', '<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>'],
    ['integracoes', 'Integrações', '<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/></svg>'],
  ];
  const TELAS = [['conversas', 'Conversas'], ['painel', 'Dashboard'], ['funil', 'CRM'], ['agenda', 'Agenda'], ['ligacoes', 'Ligações'], ['clientes', 'Clientes'], ['serena', 'Serena'], ['rotina', 'Rotina']];
  const el = (...a) => ui.el(...a);
  /** replaceChildren sem os vazios (null viraria o texto "null"). */
  const encher = (c, ...f) => c.replaceChildren(...f.flat().filter((x) => x != null && x !== false));
  const css = () => { EC.css(); if (!document.getElementById('ct-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'ct-css', textContent: CSS })); };
  const iniciais = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const souDirecao = () => ['admin', 'direcao'].includes(ui?.estado?.eu?.papel);

  function irAba(a) { if (a === 'faturamento') a = 'privacidade'; if (ABAS.some(([id]) => id === a)) aba = a; }

  async function desenhar(c, u) {
    ui = u; caixa = c; EC = window.SintoniaEC; if (!EC) { c.textContent = 'Carregando…'; return; }
    EC.iniciar(u); css();
    caixa.classList.add('ec-caixa');
    if (!caixa.firstChild) caixa.replaceChildren(el('p', { class: 'ec-carregando', text: 'Carregando…' }));
    conta = await ui.api('/api/conta').catch(() => null);
    if (!caixa.isConnected) return;
    const corpo = el('div', { style: 'display:grid;gap:16px;min-width:0' });
    const sair = EC.botao('Sair', async () => { try { localStorage.removeItem('sintonia.fz.lista'); } catch {} await ui.api('/api/auth/sair', { method: 'POST', body: '{}' }).catch(() => {}); location.href = '/entrar'; }, 'perigo', '<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>');
    caixa.replaceChildren(el('div', { class: 'ec' },
      el('div', { class: 'ec-topo' }, el('div', { class: 'ec-tit' }, el('h1', { text: 'Conta' }), el('p', { text: conta ? `${conta.nome} · ${conta.papelNome}` : 'Suas informações e preferências.' })), sair,
        window.SintoniaTopoGrupo ? window.SintoniaTopoGrupo() : null),
      EC.abas(ABAS, aba, (a) => { aba = a; desenhar(caixa, ui); }),
      corpo));
    if (!conta) { corpo.append(el('p', { class: 'ec-erro', text: 'Não deu para carregar a sua conta agora.' })); return; }
    const telas = { perfil: telaPerfil, trabalho: telaTrabalho, notificacoes: telaNotificacoes, privacidade: telaPrivacidade, email: telaEmail, integracoes: telaIntegracoes };
    try { await telas[aba](corpo); } catch (x) { encher(corpo, el('p', { class: 'ec-erro', text: x.message || 'Não deu para carregar agora.' })); }
  }
  const redesenhar = () => caixa && desenhar(caixa, ui);
  const salvarConta = async (mudanca) => {
    conta = await ui.api('/api/conta', { method: 'PATCH', body: JSON.stringify(mudanca) });
    if (ui.estado?.eu && conta) { ui.estado.eu.nome = conta.nome; ui.estado.eu.email = conta.email; }
    const n = document.getElementById('lt-eu-nome'); if (n) n.textContent = conta.nome;
    const m = document.getElementById('lt-eu-email'); if (m) m.textContent = conta.email;
    return conta;
  };

  /* usuarios: aparelhos conectados à própria conta: sair de um ou de todos os outros */
  function aparelhos() {
    const lista = el('div', { class: 'ec-linhas' }, el('p', { class: 'ec-sub', text: 'Carregando…' }));
    const erro = el('p', { class: 'ec-erro', role: 'alert' });
    const quando = (iso) => {
      if (!iso) return 'agora';
      const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
      if (min < 2) return 'agora há pouco'; if (min < 60) return `há ${min} min`; if (min < 1440) return `há ${Math.round(min / 60)} h`;
      return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    };
    const sairOutras = EC.botao('Sair de todos os outros', async () => {
      erro.textContent = ''; sairOutras.disabled = true;
      try { const r = await ui.api('/api/auth/sessoes/sair-das-outras', { method: 'POST', body: '{}' }); ui.toast(r.encerradas ? `Pronto: ${r.encerradas} ${r.encerradas === 1 ? 'aparelho saiu' : 'aparelhos saíram'}.` : 'Só este aparelho está conectado.'); carregar(); }
      catch (x) { erro.textContent = x.message; }
      sairOutras.disabled = false;
    }, 'mini');
    async function carregar() {
      let r; try { r = await ui.api('/api/auth/sessoes'); } catch (x) { encher(lista, el('p', { class: 'ec-erro', text: x.message || 'Não deu para ver os aparelhos agora.' })); return; }
      const outras = r.sessoes.filter((s) => !s.atual).length;
      sairOutras.hidden = outras === 0;
      encher(lista, r.sessoes.map((s) => el('div', { class: 'ec-linha' },
        el('span', { style: 'display:grid;gap:2px;min-width:0' }, el('b', { text: s.aparelho, style: 'font-weight:600' }), el('small', { class: 'ec-sub', text: s.atual ? 'Este aparelho' : `Usado ${quando(s.usadaEm || s.criadaEm)}${s.ip ? ` · ${s.ip}` : ''}` })),
        s.atual ? el('span', { class: 'ec-sub', text: 'Você está aqui' }) : EC.botao('Sair', async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await ui.api(`/api/auth/sessoes/${s.id}`, { method: 'DELETE' }); ui.toast(`${s.aparelho} desconectado.`); carregar(); }
          catch (x) { erro.textContent = x.message; b.disabled = false; }
        }, 'mini'))));
    }
    carregar();
    return el('div', { style: 'display:grid;gap:8px;min-width:0;margin-top:6px' }, el('b', { text: 'Aparelhos conectados', style: 'font-size:14px' }), lista, erro, el('div', { class: 'ec-acoes' }, sairOutras));
  }

  // ------------------------------------------------------------ perfil
  function telaPerfil(corpo) {
    const { cartao, entrada, campo, chave, opcao, seg, botao } = EC;
    const foto = el('div', { class: 'ct-foto' });
    const pintarFoto = () => { const url = window.SintoniaFotos?.url(conta.id); foto.replaceChildren(); if (url) foto.append(el('img', { src: url, alt: '' })); else foto.textContent = iniciais(conta.nome); btTirar.hidden = !url; };
    const enviarFoto = () => EC.escolherArquivo('image/*', async (arq) => {
      try {
        const bmp = await createImageBitmap(arq); const lado = Math.min(bmp.width, bmp.height), t = 256;
        const tela = Object.assign(document.createElement('canvas'), { width: t, height: t });
        tela.getContext('2d').drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) / 2, lado, lado, 0, 0, t, t);
        await ui.api(`/api/equipe/${conta.id}/foto`, { method: 'PUT', body: JSON.stringify({ base64: tela.toDataURL('image/jpeg', 0.85).split(',')[1], mimetype: 'image/jpeg' }) });
        await window.SintoniaFotos?.carregar(); pintarFoto(); ui.toast('Foto salva ✓');
      } catch (x) { ui.toast(x.message || 'Não deu para usar essa imagem.'); }
    });
    const btTirar = botao('Tirar foto', async () => { try { await ui.api(`/api/equipe/${conta.id}/foto`, { method: 'DELETE' }); await window.SintoniaFotos?.carregar(); pintarFoto(); } catch (x) { ui.toast(x.message); } }, 'mini perigo');
    pintarFoto();
    const nomesUn = (conta.unidades || []).map((u) => ui.UNIDADE?.[u] || u).join(', ') || (souDirecao() ? 'Todas as unidades' : 'Nenhuma ainda');

    // dados pessoais
    const nome = entrada({ value: conta.nome, maxlength: '120', autocomplete: 'name' });
    const tel = entrada({ value: conta.telefone || '', inputmode: 'tel', maxlength: '30', autocomplete: 'tel', placeholder: '(71) 99999-0000' });
    const erro = el('p', { class: 'ec-erro', role: 'alert' });
    const salvar = botao('Salvar', async () => {
      erro.textContent = '';
      if (nome.value.trim().length < 2) { erro.textContent = 'O nome precisa de pelo menos 2 letras.'; nome.focus(); return; }
      salvar.disabled = true;
      try { await salvarConta({ nome: nome.value.trim(), telefone: tel.value.trim() }); ui.toast('Perfil salvo ✓'); caixa.querySelector('.ec-topo p').textContent = `${conta.nome} · ${conta.papelNome}`; }
      catch (x) { erro.textContent = x.message; }
      salvar.disabled = false;
    }, 'azul');
    const email = el('div', { class: 'ec-linha', style: 'border:0;padding:0' }, el('span', { text: conta.email }), conta.podeTrocarEmail ? botao('Trocar e-mail', trocarEmail, 'mini') : null);
    const senha = botao('Trocar senha', () => {
      const d = document.getElementById('d-trocar-senha'); if (!d) return;
      document.getElementById('f-trocar-senha')?.reset(); const e = document.getElementById('t-erro'); if (e) e.textContent = '';
      d.showModal();
    }, '', '<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/></svg>');
    const secPerfil = cartao('equipe', 'Perfil',
      el('div', { class: 'ct-perfil' }, foto, el('div', { class: 'ct-quem' }, el('b', { text: conta.nome }), el('span', { class: 'ec-sub', text: `${conta.papelNome} · ${nomesUn}` }),
        el('div', { class: 'ec-acoes' }, botao(window.SintoniaFotos?.url(conta.id) ? 'Trocar foto' : 'Pôr foto', enviarFoto, 'mini', 'imagem'), btTirar))),
      el('div', { class: 'ec-form' }, campo('Nome', nome, { cheio: true, dica: 'Como a equipe e os relatórios te chamam.' }), campo('Telefone', tel, { cheio: true })),
      erro, el('div', { class: 'ec-acoes ec-fim' }, salvar));
    const secAcesso = cartao('acesso', 'Login e segurança',
      el('div', { class: 'ec-campo' }, document.createTextNode('E-mail de login'), email),
      el('p', { class: 'ec-sub', text: 'Trocar a senha encerra a sua sessão nos outros aparelhos (este continua).' }),
      el('div', { class: 'ec-acoes' }, senha),
      aparelhos());

    // assinatura
    const a = { ...conta.assinatura };
    const texto = entrada({ value: a.texto || '', maxlength: '60', placeholder: conta.nome.split(' ')[0] });
    const bolha = el('div', { class: 'ct-bolha' });
    const previa = () => {
      const quem = (texto.value.trim() || conta.nome.split(' ')[0]).replace(/[*_~]/g, '');
      bolha.replaceChildren();
      if (!a.ligada) { bolha.textContent = 'Olá! Seu horário está confirmado para amanhã às 15h.'; return; }
      if (a.posicao === 'inicio') bolha.append(el('b', { text: `${quem}:` }), document.createTextNode('\nOlá! Seu horário está confirmado para amanhã às 15h.'));
      else bolha.append(document.createTextNode('Olá! Seu horário está confirmado para amanhã às 15h.\n\n'), el('i', { text: quem }));
    };
    texto.addEventListener('input', previa);
    const posicao = seg([['inicio', 'No começo'], ['fim', 'No fim']], a.posicao, (v) => { a.posicao = v; previa(); }, 'Onde vai a assinatura');
    const erroA = el('p', { class: 'ec-erro', role: 'alert' });
    const salvarA = botao('Salvar assinatura', async () => {
      erroA.textContent = '';
      try { await salvarConta({ assinatura: { ligada: a.ligada, texto: texto.value.trim(), posicao: a.posicao } }); ui.toast('Assinatura salva ✓'); } catch (x) { erroA.textContent = x.message; }
    }, 'azul');
    previa();
    const secAss = cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c3-1 4-6 6-6s1 5 3 5 2-3 4-3 2 2 5 2"/><path d="M3 21h18"/></svg>', 'Assinatura das mensagens',
      el('p', { class: 'ec-sub', text: 'Quando ligada, as mensagens que você manda para clientes pela conversa saem com o seu nome. A IA não usa a sua assinatura.' }),
      opcao('Pôr meu nome nas mensagens', null, chave(a.ligada, (v) => { a.ligada = v; previa(); }, 'Pôr meu nome nas mensagens')),
      el('div', { class: 'ec-form' }, campo('Nome na assinatura', texto, { dica: 'Vazio: o seu primeiro nome.' }), el('span', { class: 'ec-campo' }, document.createTextNode('Onde vai'), posicao)),
      el('div', { class: 'ct-previa' }, el('span', { class: 'ec-sub', text: 'Como a cliente vê' }), bolha),
      erroA, el('div', { class: 'ec-acoes ec-fim' }, salvarA));
    encher(corpo, el('div', { class: 'ec-grade ec-2' }, secPerfil, el('div', { style: 'display:grid;gap:16px;min-width:0' }, secAcesso, secAss)));
  }
  function trocarEmail() {
    EC.janela('Trocar e-mail de login', (form, fechar) => {
      const novo = EC.entrada({ type: 'email', maxlength: '200', autocomplete: 'email', placeholder: 'novo@empresa.com' });
      const senha = EC.entrada({ type: 'password', maxlength: '200', autocomplete: 'current-password' });
      const erro = el('p', { class: 'ec-erro', role: 'alert' });
      form.append(el('p', { class: 'ec-sub', text: `Hoje: ${conta.email}. Depois de trocar, entre com o e-mail novo.` }), el('div', { class: 'ec-form' }, EC.campo('E-mail novo', novo, { cheio: true }), EC.campo('Sua senha', senha, { cheio: true, dica: 'Para confirmar que é você.' })), erro);
      const ok = EC.botao('Trocar', async () => {
        erro.textContent = '';
        if (!novo.value.trim() || !senha.value) { erro.textContent = 'Preencha o e-mail novo e a sua senha.'; return; }
        ok.disabled = true;
        try { conta = await ui.api('/api/conta/email', { method: 'POST', body: JSON.stringify({ email: novo.value.trim(), senha: senha.value }) }); const m = document.getElementById('lt-eu-email'); if (m) m.textContent = conta.email; if (ui.estado?.eu) ui.estado.eu.email = conta.email; ui.toast('E-mail trocado ✓'); fechar(); redesenhar(); }
        catch (x) { erro.textContent = x.message; ok.disabled = false; }
      }, 'azul');
      setTimeout(() => novo.focus(), 50);
      return [EC.botao('Cancelar', fechar), ok];
    });
  }

  // ------------------------------------------------------------ área de trabalho
  function telaTrabalho(corpo) {
    const { cartao, seg, opcao, chave, botao } = EC;
    const p = conta.preferencias;
    const salvarPref = async (mud, msg) => { try { await salvarConta({ preferencias: mud }); aplicarPreferencias(conta.preferencias, true); if (msg) ui.toast(msg); } catch (x) { ui.toast(x.message); } };
    const tema = seg([['claro', 'Claro'], ['escuro', 'Escuro'], ['auto', 'Automático']], window.SintoniaTema?.get?.() || p.tema, (v) => salvarPref({ tema: v }), 'Tema');
    const densidade = seg([['confortavel', 'Confortável'], ['compacta', 'Compacta']], p.densidade, (v) => salvarPref({ densidade: v }), 'Densidade');
    const tela = el('select', { class: 'ec-sel', 'aria-label': 'Tela inicial' }, ...TELAS.map(([v, n]) => el('option', { value: v, text: n })));
    tela.value = p.telaInicial;
    tela.addEventListener('change', () => salvarPref({ telaInicial: tela.value }, 'Tela inicial salva ✓'));
    const idioma = el('select', { class: 'ec-sel', 'aria-label': 'Idioma' }, el('option', { value: 'pt-BR', text: 'Português (Brasil)' })); /* sem-pagamento: sem opções "em breve" */
    idioma.value = p.idioma;
    const bolinha = window.Sintonia?.acessoRapido?.ligada?.() ?? true;
    encher(corpo, el('div', { class: 'ec-grade ec-2' },
      cartao('geral', 'Aparência',
        opcao('Tema', 'Automático segue o modo claro ou escuro do aparelho.', tema),
        opcao('Densidade', 'Compacta mostra mais conversas na tela.', densidade),
        el('p', { class: 'ec-sub', text: 'Vale em todos os aparelhos em que você entrar.' })),
      cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 3l9 8M5 10v10h14V10"/></svg>', 'Ao abrir a Sintonia',
        opcao('Tela inicial', 'A primeira tela quando você abre o app.', tela),
        opcao('Idioma', 'A Sintonia está em português do Brasil.', idioma)),
      window.SintoniaPapelParede ? window.SintoniaPapelParede.cartao(EC) : null, /* conversa-extra: papel de parede das conversas */
      /* Personalizar Dashboard (pedido do dono 21/11: saiu do topo do Dashboard no celular e veio para cá) */
      window.SintoniaTelas?.painel?.personalizar ? cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>', 'Dashboard',
        el('p', { class: 'ec-sub', text: 'Escolha os blocos, tire o que não usa e arrume na ordem que preferir.' }),
        el('div', { class: 'ec-acoes' }, botao('Personalizar Dashboard', () => window.SintoniaTelas.painel.personalizar(), 'mini'))) : null,
      cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="4"/></svg>', 'Acesso rápido',
        opcao('Mostrar a bolinha de atalhos', 'Fica na borda da tela (some com uma conversa aberta no celular). Vale só neste aparelho.', chave(bolinha, (v) => window.Sintonia?.acessoRapido?.definir?.(v), 'Mostrar a bolinha')),
        el('div', { class: 'ec-acoes' }, botao('Escolher e ordenar os atalhos', () => window.Sintonia?.acessoRapido?.editar?.(), 'mini'))),
      window.SintoniaInstalar ? cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>', 'App no celular',
        el('p', { class: 'ec-sub', text: window.SintoniaInstalar.instalado?.() ? 'A Sintonia já está instalada neste aparelho.' : 'Instale a Sintonia na tela de início para abrir como app e receber avisos.' }),
        window.SintoniaInstalar.instalado?.() ? null : el('div', { class: 'ec-acoes' }, botao('Como instalar', () => window.SintoniaInstalar.abrir?.(), 'mini'))) : null));
  }

  // ------------------------------------------------------------ notificações
  async function telaNotificacoes(corpo) {
    const nt = window.SintoniaTelas?.notificacoes;
    const caixaNt = el('div', { class: 'ct-nt' }, el('p', { class: 'ec-carregando', text: 'Carregando…' }));
    encher(corpo, el('p', { class: 'ec-sub', text: 'O que avisar, som, aviso no celular e horário de silêncio. Cada pessoa escolhe as suas.' }), caixaNt);
    if (!nt?.preferencias) { caixaNt.replaceChildren(el('p', { class: 'ec-sub', text: 'As notificações ainda estão carregando. Tente de novo em instantes.' })); return; }
    await nt.preferencias({ caixa: caixaNt });
  }

  // ------------------------------------------------------------ privacidade (sem-pagamento: App Store 5.1.1)
  const SETA_FORA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';
  function telaPrivacidade(corpo) {
    const { cartao, botao } = EC;
    const link = (href, titulo, sub) => { const a = el('a', { class: 'ct-link', href, target: '_blank', rel: 'noopener' }, el('span', {}, document.createTextNode(titulo), el('small', { text: sub }))); a.insertAdjacentHTML('beforeend', SETA_FORA); return a; };
    const secLinks = cartao('doc', 'Privacidade e termos',
      el('p', { class: 'ec-sub', text: 'Como a Sintonia usa e protege os dados, as regras de uso e como falar com a gente.' }),
      el('div', { class: 'ct-links' },
        link('/privacidade', 'Política de privacidade', 'Que dados usamos, para quê e os seus direitos (LGPD)'),
        link('/termos', 'Termos de uso', 'As regras para usar a Sintonia'),
        link('/suporte', 'Suporte', 'WhatsApp, e-mail e recado para a nossa equipe')));
    const secDados = cartao('equipe', 'Seus dados',
      el('div', { class: 'ec-linhas' },
        el('div', { class: 'ec-linha' }, el('span', { text: 'Nome' }), el('b', { text: conta.nome })),
        el('div', { class: 'ec-linha' }, el('span', { text: 'E-mail de login' }), el('b', { text: conta.email })),
        el('div', { class: 'ec-linha' }, el('span', { text: 'Telefone' }), el('b', { text: conta.telefone || 'Não informado' }))),
      el('p', { class: 'ec-sub', text: 'Para mudar, vá em Perfil. Para pedir uma cópia dos seus dados, fale com o Suporte.' }),
      el('div', { class: 'ec-acoes' }, botao('Ir para Perfil', () => { aba = 'perfil'; redesenhar(); }, 'mini')));
    const secExcluir = cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>', 'Excluir minha conta',
      el('p', { class: 'ec-sub', text: 'Seu acesso é desligado e os seus dados pessoais são apagados: nome, e-mail, telefone, foto e preferências. As conversas e vendas da empresa continuam, aparecendo como "Usuário excluído". Não dá para desfazer.' }),
      el('div', { class: 'ec-acoes' }, botao('Excluir minha conta', excluirConta, 'perigo')));
    secExcluir.classList.add('ct-perigo');
    encher(corpo, el('div', { class: 'ec-grade ec-2' }, secLinks, el('div', { style: 'display:grid;gap:16px;min-width:0' }, secDados, secExcluir)));
  }
  function excluirConta() {
    EC.janela('Excluir minha conta', (form, fechar) => {
      const campo = EC.entrada({ class: 'ec-in ct-confirma', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '20', placeholder: 'EXCLUIR', 'aria-label': 'Digite EXCLUIR para confirmar' });
      const erro = el('p', { class: 'ec-erro', role: 'alert' });
      form.append(
        el('p', { text: 'Tem certeza? Seu acesso à Sintonia é desligado na hora e os seus dados pessoais são apagados. Isso não pode ser desfeito.' }),
        el('p', { class: 'ec-sub', text: 'Se você é a única pessoa com acesso de administração da empresa, passe esse acesso para outra pessoa antes.' }),
        EC.campo('Para confirmar, digite EXCLUIR', campo, { cheio: true }), erro);
      const ok = EC.botao('Excluir de vez', async () => {
        erro.textContent = '';
        if (campo.value.trim().toUpperCase() !== 'EXCLUIR') { erro.textContent = 'Digite EXCLUIR para confirmar.'; campo.focus(); return; }
        ok.disabled = true;
        try {
          await ui.api('/api/conta/excluir', { method: 'POST', body: JSON.stringify({ confirmacao: campo.value.trim() }) });
          try { localStorage.removeItem('sintonia.fz.lista'); } catch {}
          fechar();
          location.href = '/entrar?conta=excluida';
        } catch (x) { erro.textContent = x.message || 'Não deu para excluir agora. Tente de novo.'; ok.disabled = false; }
      }, 'perigo');
      campo.addEventListener('input', () => { ok.disabled = campo.value.trim().toUpperCase() !== 'EXCLUIR'; });
      ok.disabled = true;
      setTimeout(() => campo.focus(), 50);
      return [EC.botao('Cancelar', fechar), ok];
    });
  }

  // ------------------------------------------------------------ e-mail
  async function telaEmail(corpo) {
    const { cartao, botao, vazio } = EC;
    let contas = null, erro = null;
    try { contas = await ui.api('/api/email/contas'); } catch (x) { erro = x; }
    const lista = Array.isArray(contas) ? contas : contas?.contas || [];
    const secLogin = cartao('equipe', 'Seu e-mail',
      el('div', { class: 'ec-linhas' }, el('div', { class: 'ec-linha' }, el('span', { text: 'Login' }), el('b', { text: conta.email }))),
      el('p', { class: 'ec-sub', text: 'É por ele que você entra e recebe o link de "esqueci a senha". Para trocar, vá em Perfil.' }),
      el('div', { class: 'ec-acoes' }, botao('Ir para Perfil', () => { aba = 'perfil'; redesenhar(); }, 'mini')));
    let secEnvio;
    if (erro) {
      secEnvio = cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>', 'Contas que enviam e-mail',
        el('p', { class: 'ec-sub', text: erro.status === 403 ? 'As contas de envio (e-mail marketing e avisos) ficam com a gestão.' : erro.message || 'Não deu para ler agora.' }));
    } else {
      secEnvio = cartao('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>', 'Contas que enviam e-mail',
        el('p', { class: 'ec-sub', text: 'As caixas que mandam o e-mail marketing da empresa (SMTP da Hostinger, Gmail, Outlook ou provedor por API).' }),
        lista.length ? el('div', { class: 'ec-linhas' }, ...lista.map((c) => el('div', { class: 'ec-linha' },
          el('span', {}, el('b', { text: c.nome }), document.createElement('br'), el('small', { class: 'ec-sub', text: `${c.remetenteEmail || c.usuario || ''}${c.imapLigado ? ' · lê respostas' : ''}` })),
          el('span', { class: 'ec-pil ' + (!c.ativa ? '' : c.testeErro ? 'ruim' : c.testadaEm ? 'bom' : 'aviso'), text: !c.ativa ? 'Desligada' : c.testeErro ? 'Com erro' : c.testadaEm ? 'Funcionando' : 'Não testada' }))))
          : vazio('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>', 'Nenhuma conta de envio', 'Conecte uma caixa de e-mail para mandar campanhas e avisos.'),
        souDirecao() ? el('div', { class: 'ec-acoes' }, el('a', { class: 'ec-bt azul', href: '/conexoes#email', text: lista.length ? 'Configurar em Conexões' : 'Conectar e-mail' })) : el('p', { class: 'ec-sub', text: 'Quem configura é a direção ou a administração, em Conexões › E-mail.' }));
    }
    encher(corpo, el('div', { class: 'ec-grade ec-2' }, secLogin, secEnvio));
  }

  // ------------------------------------------------------------ integrações (tela do agente "integracoes")
  async function telaIntegracoes(corpo) {
    const caixaInt = el('div', { style: 'display:grid;gap:16px;min-width:0' });
    encher(corpo, caixaInt);
    const tela = window.SintoniaTelas?.integracoes;
    if (tela?.desenhar) { await tela.desenhar(caixaInt, ui); return; }
    encher(caixaInt, el('section', { class: 'ec-c' }, EC.vazio('<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/></svg>',
      'Integrações (API, webhooks, MCP)', 'Não deu para abrir as integrações agora. Feche e abra a tela de novo.')));
  }

  // ------------------------------------------------------------ preferências valendo no app
  function aplicarPreferencias(p, agora) {
    if (!p) return;
    document.documentElement.dataset.densidade = p.densidade || 'confortavel';
    if (agora && p.tema && window.SintoniaTema?.get?.() !== p.tema) window.SintoniaTema?.definir?.(p.tema);
  }
  (async () => {
    for (let i = 0; i < 80 && !(window.Sintonia?.ui && window.Sintonia.ui.estado?.eu); i++) await new Promise((r) => setTimeout(r, 100));
    const u = window.Sintonia?.ui; if (!u) return;
    if (!document.getElementById('ct-css') && window.SintoniaEC) { ui = u; EC = window.SintoniaEC; EC.iniciar(u); css(); }
    const c = await u.api('/api/conta').catch(() => null);
    if (!c) return;
    conta = c;
    const p = c.preferencias;
    window.SintoniaContaPrefs = p; dispatchEvent(new Event('sintonia:conta')); /* conversa-extra: papel de parede (telas/papel-parede.js) */
    document.documentElement.dataset.densidade = p.densidade || 'confortavel';
    // Tema salvo na conta: vale num aparelho novo (sem escolha feita aqui ainda).
    let local = null; try { local = localStorage.getItem('sintonia.tema'); } catch {}
    if (!local && p.tema !== 'auto') window.SintoniaTema?.definir?.(p.tema);
    // Tela inicial: só ao abrir o app sem endereço próprio (link de conversa, rota) e ainda nas Conversas.
    const semRota = (location.pathname === '/app' || location.pathname === '/app/') && !location.hash;
    if (semRota && p.telaInicial && p.telaInicial !== 'conversas' && u.estado.vista === 'conversas' && document.getElementById('v-' + p.telaInicial)) u.mostrar(p.telaInicial);
  })();

  window.SintoniaTelas.conta = { desenhar, irAba };
})();
