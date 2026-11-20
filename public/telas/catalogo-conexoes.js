/* Conexões no jeito "Adicionar um conector": uma lista com logo, nome, descrição e botão Conectar.
 * Tocar abre só a seção daquela ferramenta (as seções de configuração continuam as mesmas da página);
 * "‹ Todas as conexões" volta para a lista. O estado (Conectado) vem do que já está salvo. */
(() => {
  const L = window.LOGOS_CONEXOES || {};
  const $ = (id) => document.getElementById(id);
  const svgMarca = (k, cor) => {
    const l = L[k];
    return l ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${cor || l.cor}" d="${l.path}"/></svg>` : '';
  };
  const OUTLOOK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="5" width="13" height="14" rx="2" fill="#28a8ea"/><path d="M9 8l6.5 4.5L22 8" fill="none" stroke="#fff" stroke-width="1.6"/><rect x="2" y="6.5" width="10" height="11" rx="2" fill="#0a64c8"/><circle cx="7" cy="12" r="2.6" fill="none" stroke="#fff" stroke-width="1.7"/></svg>';
  const RELATORIO = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="#3aa0ff" stroke-width="2" stroke-linecap="round"><path d="M5 20V11M11 20V5M17 20v-6M22 20H2"/></svg>';

  // [id, seção, nome, descrição, logo, cor do logo (opcional)]
  const ITENS = [
    ['whatsapp', 'nao-oficial', 'WhatsApp', 'Ligue os números da loja por QR Code ou código e responda tudo na Sintonia.', () => svgMarca('whatsapp')],
    ['instagram', 'instagram', 'Instagram', 'Mensagens diretas da conta profissional viram conversas na Sintonia.', () => svgMarca('instagram')],
    ['messenger', 'messenger', 'Facebook', 'Mensagens da sua Página do Facebook junto com o WhatsApp.', () => svgMarca('facebook')],
    ['tiktok', 'tiktok', 'TikTok', 'Quem preenche o formulário do anúncio vira lead na hora.', () => svgMarca('tiktok', 'var(--cx-tiktok)')],
    ['agenda', 'agenda', 'Agenda (Trinks, Avec, AppBarber)', 'Veja horários livres e agende direto pela conversa.', () => svgMarca('agenda')],
    ['gmail', 'email', 'Gmail', 'Envie e-mails para as clientes pela sua conta do Gmail.', () => svgMarca('gmail')],
    ['outlook', 'email', 'Outlook', 'Envie e-mails pela sua conta da Microsoft.', () => OUTLOOK],
    ['hostinger', 'email', 'E-mail Hostinger', 'Use o e-mail do seu domínio para falar com as clientes.', () => svgMarca('hostinger')],
    ['capi', 'capi', 'Meta Ads', 'Avisa a Meta quando o lead agenda e comparece, para o anúncio aprender.', () => svgMarca('meta')],
    ['relatorio', 'relatorio', 'Relatório do dia', 'Resumo das 20h no WhatsApp de quem você escolher.', () => RELATORIO],
  ];

  const css = document.createElement('style');
  css.textContent = `
  :root { --cx-tile: #ffffff; --cx-tile-borda: rgba(8,36,63,.08); --cx-bt: #08243f; --cx-bt-txt: #fff; --cx-tiktok: #111; }
  html[data-tema="escuro"] { --cx-tile: #151a22; --cx-tile-borda: rgba(255,255,255,.08); --cx-bt: #fff; --cx-bt-txt: #05080d; --cx-tiktok: #fff; }
  #catalogo { background: none !important; box-shadow: none !important; padding: 0 !important; }
  .cx-busca { display: flex; align-items: center; gap: 10px; height: 50px; border-radius: 16px; padding: 0 16px; margin: 4px 0 8px;
    background: var(--vidro-item, rgba(255,255,255,.7)); box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(8,36,63,.08)); }
  .cx-busca svg { width: 20px; height: 20px; flex: none; color: var(--sub); }
  .cx-busca input { all: unset; flex: 1; font-size: 16px; color: var(--texto); }
  .cx-busca input::placeholder { color: var(--sub); }
  .cx-lista { display: grid; }
  .cx-item { display: flex; align-items: center; gap: 14px; padding: 12px 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .cx-logo { width: 52px; height: 52px; border-radius: 15px; flex: none; display: grid; place-items: center; background: var(--cx-tile); box-shadow: inset 0 0 0 1px var(--cx-tile-borda); }
  .cx-logo svg { width: 28px; height: 28px; }
  .cx-tx { flex: 1; min-width: 0; }
  .cx-tx b { display: block; font-size: 16.5px; font-weight: 500; color: var(--texto); }
  .cx-tx span { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 14px; line-height: 1.38; color: var(--sub); margin-top: 2px; }
  .cx-bt { all: unset; flex: none; cursor: pointer; height: 40px; padding: 0 18px; border-radius: 999px; display: grid; place-items: center; font-size: 15px; font-weight: 600;
    background: var(--cx-bt); color: var(--cx-bt-txt); }
  .cx-bt.ok { background: transparent; color: #0b8f6a; box-shadow: inset 0 0 0 1.5px rgba(15,157,107,.35); }
  html[data-tema="escuro"] .cx-bt.ok { color: #0ffcbe; box-shadow: inset 0 0 0 1.5px rgba(15,252,190,.35); }
  .cx-extras { margin: 18px 0 8px; font-size: 13.5px; color: var(--sub); line-height: 1.6; }
  .cx-extras a { color: var(--marca-azul, #106ebe); font-weight: 600; text-decoration: none; }
  html[data-tema="escuro"] .cx-extras a { color: #0ffcbe; }
  .cx-vazio { color: var(--sub); font-size: 14px; padding: 18px 0; }
  .cx-voltar { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: 14.5px; color: var(--marca-azul, #106ebe); margin: 2px 0 12px; }
  html[data-tema="escuro"] .cx-voltar { color: #0ffcbe; }
  body.cx-detalhe main > section:not(.cx-aberta), body.cx-detalhe main > .grupo, body.cx-detalhe .atalhos { display: none !important; }
  body:not(.cx-detalhe) main > section:not(#catalogo), body:not(.cx-detalhe) main > .grupo, body:not(.cx-detalhe) .atalhos { display: none !important; }
  body.cx-detalhe #cx-voltar-bar { display: block; } #cx-voltar-bar { display: none; }
  `;
  document.head.append(css);

  const estado = {};
  function desenhar(filtro = '') {
    const q = filtro.trim().toLowerCase();
    const lista = $('cx-lista');
    const itens = ITENS.filter(([, , nome, desc]) => !q || (nome + ' ' + desc).toLowerCase().includes(q));
    if (!itens.length) { lista.innerHTML = '<p class="cx-vazio">Nenhuma ferramenta com esse nome.</p>'; return; }
    lista.replaceChildren(...itens.map(([id, sec, nome, desc, logo]) => {
      const ok = Boolean(estado[id]);
      const linha = document.createElement('div');
      linha.className = 'cx-item'; linha.setAttribute('role', 'button'); linha.tabIndex = 0;
      linha.innerHTML = `<span class="cx-logo">${logo()}</span><div class="cx-tx"><b></b><span></span></div><button type="button" class="cx-bt${ok ? ' ok' : ''}">${ok ? 'Conectado' : 'Conectar'}</button>`;
      linha.querySelector('b').textContent = nome; linha.querySelector('.cx-tx span').textContent = desc;
      const abrir = () => abrirSecao(sec);
      linha.addEventListener('click', abrir);
      linha.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(); });
      return linha;
    }));
  }
  function abrirSecao(sec) {
    document.querySelectorAll('main > section.cx-aberta').forEach((s) => s.classList.remove('cx-aberta'));
    const s = $(sec); if (!s) return;
    s.hidden = false; s.classList.add('cx-aberta');
    document.body.classList.add('cx-detalhe');
    history.pushState({ cx: sec }, '', '#' + sec);
    scrollTo(0, 0);
  }
  function voltar() {
    document.body.classList.remove('cx-detalhe');
    document.querySelectorAll('main > section.cx-aberta').forEach((s) => s.classList.remove('cx-aberta'));
    if (location.hash) history.replaceState(null, '', location.pathname);
    carregarEstado();
  }
  addEventListener('popstate', () => { if (document.body.classList.contains('cx-detalhe')) voltar(); });

  async function carregarEstado() {
    const pega = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [r, wa, emails] = await Promise.all([pega('/api/conexoes'), pega('/api/conexoes/whatsapp/canais'), pega('/api/email/contas')]);
    const c = r?.campos || {};
    const def = (k) => Boolean(c[k]?.definido);
    const lig = (k) => c[k]?.valor === '1';
    estado.whatsapp = Boolean(wa?.canais?.some((k) => k.estado === 'conectada'));
    estado.ia = def('anthropicApiKey');
    estado.transcricao = def('openaiApiKey');
    estado.agenda = def('trinksApiKey') || ['agendaSistemaNorte', 'agendaSistemaSumare'].some((k) => c[k]?.valor && c[k].valor !== 'nenhum');
    estado.messenger = lig('messengerLigado'); estado.instagram = lig('instagramLigado'); estado.tiktok = lig('tiktokLigado');
    estado.capi = lig('capiLigado');
    estado.relatorio = Boolean(r?.destinosRelatorio?.length);
    const contas = Array.isArray(emails) ? emails : emails?.contas || [];
    const tem = (p) => contas.some((k) => (k.predefinicao || '').includes(p));
    estado.gmail = tem('gmail'); estado.outlook = tem('outlook'); estado.hostinger = tem('hostinger');
    desenhar($('cx-q')?.value || '');
  }

  function montar() {
    const main = document.querySelector('main'); if (!main || $('catalogo')) return;
    const sec = document.createElement('section'); sec.id = 'catalogo';
    sec.innerHTML = `<label class="cx-busca"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="cx-q" type="search" placeholder="Busque uma ferramenta" aria-label="Buscar ferramenta"></label><div class="cx-lista" id="cx-lista"></div>`;
    const barra = document.createElement('div'); barra.id = 'cx-voltar-bar';
    barra.innerHTML = '<button type="button" class="cx-voltar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>Todas as conexões</button>';
    barra.querySelector('button').addEventListener('click', () => history.back());
    const extras = document.createElement('div'); extras.className = 'cx-extras';
    extras.innerHTML = '<span>Outras configurações:</span> <a href="#ia" data-sec="ia">Chave da IA (Serena)</a> · <a href="#transcricao" data-sec="transcricao">Transcrição de áudio</a>';
    extras.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); abrirSecao(a.dataset.sec); }));
    sec.append(extras);
    main.prepend(sec, barra);
    $('cx-q').addEventListener('input', (e) => desenhar(e.target.value));
    desenhar();
    carregarEstado();
    // Link direto (ex.: /conexoes#nao-oficial) abre a ferramenta.
    const alvo = location.hash.slice(1);
    if (alvo && $(alvo) && alvo !== 'catalogo') { history.replaceState(null, '', location.pathname); abrirSecao(alvo); }
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', montar); else montar();
})();
