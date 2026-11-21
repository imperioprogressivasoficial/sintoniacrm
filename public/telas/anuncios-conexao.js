/* marketing: Conexões › Anúncios da Meta. Duas partes, cada uma com a sua situação clara:
 * 1) Conta de anúncios (token ads_read + número da conta): a Central de criativos lê gasto, cliques e CTR.
 * 2) API de Conversões (dataset + token): avisa a Meta quando a lead do anúncio agenda e comparece.
 * Usa os estilos da própria página de Conexões (section, .cartao, .campos, .botao, .estado, .res, details.passos).
 * Tokens nunca voltam para a tela: só "salvo, termina em ABCD". Textos do servidor entram sempre por textContent.
 */
(() => {
  const caixa = document.getElementById('capi');
  if (!caixa) return;
  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const CSS = `
  #capi .an-parte { border-radius: 18px; padding: 16px; display: grid; gap: 12px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); min-width: 0; }
  #capi .an-cab { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  #capi .an-cab h3 { flex: 1; min-width: 0; }
  #capi .an-cab > .estado { flex: none; }
  #capi .an-cab h3 { font-size: 16px; }
  #capi .an-parte > p { margin-top: -6px; font-size: 13.5px; }
  #capi .an-cab { align-items: center; }
  #capi .an-sit { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 14px; font-size: 13.5px; line-height: 1.45; font-weight: 600; color: var(--texto);
    background: color-mix(in srgb, var(--sub) 8%, transparent); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  #capi .an-sit i { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; background: var(--sub); }
  #capi .an-sit.ok { background: var(--ok-fundo); } #capi .an-sit.ok i { background: var(--ok); }
  #capi .an-sit.erro { background: color-mix(in srgb, var(--erro) 10%, transparent); } #capi .an-sit.erro i { background: var(--erro); }
  #capi .an-sit.pausada i { background: #e0a800; }
  #capi .an-campos { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); align-items: start; }
  #capi .an-campos label { align-content: start; }
  #capi .an-campos .dica { color: var(--sub); line-height: 1.35; }
  #capi .an-chave { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: var(--texto); }
  #capi .an-chave input { width: 22px; height: 22px; flex: none; accent-color: var(--marca-azul, #106ebe); }
  #capi .an-botoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  #capi .an-botoes .res { flex-basis: 100%; }
  #capi .an-botoes .an-sair { margin-left: auto; }
  @media (max-width: 560px) { #capi .an-botoes .botao { flex: 1 1 auto; } #capi .an-botoes .an-sair { margin-left: 0; } }
  #capi select { font: inherit; font-size: 15px; padding: 10px 12px; border-radius: 12px; background: var(--vidro-item); border: 1px solid var(--vidro-borda); color: var(--texto); min-width: 0; width: 100%; }
  #capi .an-etapa { display: grid; grid-template-columns: auto minmax(0, 1.4fr) minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  @media (max-width: 560px) { #capi .an-etapa { grid-template-columns: auto minmax(0, 1fr) auto; } #capi .an-etapa input[type=text] { grid-column: 1 / -1; grid-row: 2; } }
  #capi .an-etapa input[type=checkbox] { width: 20px; height: 20px; }
  #capi details.passos > div { display: grid; gap: 12px; padding: 4px 0 14px; }
  #capi .an-reg { display: grid; gap: 8px; }
  #capi .an-reg .cartao p { overflow-wrap: anywhere; }
  #capi .an-mono { font-family: var(--fonte-mono); font-size: 12px; overflow-wrap: anywhere; }
  `;
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);

  const el = (tag, props = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'value') e[k] = v;
      else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f != null && f !== false) e.append(f);
    return e;
  };
  const api = async (url, opcoes = {}) => {
    const r = await fetch(url, { ...opcoes, headers: opcoes.body ? { 'content-type': 'application/json' } : undefined });
    if (r.status === 401) { location.href = '/entrar'; throw new Error('Sua sessão acabou. Entre de novo.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || j.message || j.detalhes?.[0]?.message || 'Não deu certo. Tente de novo.');
    return j;
  };
  const quando = (d) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).format(new Date(d));
  const ocupado = async (b, fn) => { b.setAttribute('aria-busy', 'true'); try { await fn(); } finally { b.removeAttribute('aria-busy'); } };
  const dizer = (res, ok, texto) => { res.className = 'res ' + (ok ? 'ok' : 'erro'); res.textContent = texto; };

  const ROTULO = { lead: 'Virou lead (chamou pelo anúncio ou link)', qualificado: 'Ficou interessada', agendada: 'Agendou', compareceu: 'Compareceu (com valor)' };
  const NOME_SIT = { ok: 'Conectada', faltando: 'Não conectada', erro: 'Com problema', pausada: 'Pausada', nao_conferida: 'Conferindo…' };
  let d = null; let funis = [];
  const abertos = new Set();

  function situacao(s) {
    return el('div', { class: `an-sit ${s.estado}`, role: 'status' }, el('i', { 'aria-hidden': 'true' }), el('span', { text: s.texto }));
  }
  function campo(rotulo, input, dica) {
    return el('label', {}, rotulo, input, dica ? el('span', { class: 'dica', text: dica }) : null);
  }
  function detalhes(id, titulo, ...filhos) {
    const det = el('details', { class: 'passos' }, el('summary', { text: titulo }), el('div', {}, ...filhos));
    det.open = abertos.has(id);
    det.addEventListener('toggle', () => (det.open ? abertos.add(id) : abertos.delete(id)));
    return det;
  }
  const passos = (...itens) => el('ol', { style: 'margin:0;padding-left:20px;display:grid;gap:8px;font-size:14px;color:var(--sub);line-height:1.5' }, ...itens.map((t) => el('li', { text: t })));

  // ---------- 1) conta de anúncios ----------
  function parteAnuncios() {
    const s = d.situacao.anuncios;
    const conta = el('input', { id: 'an-conta', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 123456789012345 ou act_123…', value: d.adsConta || '' });
    const token = el('input', { id: 'an-token', type: 'password', autocomplete: 'off', placeholder: d.adsToken.definido ? `Salvo (termina em ${d.adsToken.final}). Cole outro para trocar.` : d.token.definido ? 'Vazio = usa o token da API de Conversões' : 'Cole o token' });
    const res = el('span', { class: 'res', role: 'status' });
    const conectado = Boolean(d.adsConta || d.adsToken.definido);
    const salvar = el('button', { class: 'botao', type: 'button', text: 'Salvar e conferir', onclick: () => ocupado(salvar, async () => {
      const corpo = { adsConta: conta.value.trim() };
      if (token.value.trim()) corpo.adsToken = token.value.trim();
      if (!corpo.adsConta) { dizer(res, false, 'Cole o número da conta de anúncios.'); conta.focus(); return; }
      if (!corpo.adsToken && !d.adsToken.definido && !d.token.definido) { dizer(res, false, 'Cole o token de acesso.'); token.focus(); return; }
      try {
        await api('/api/rastreio/capi', { method: 'PUT', body: JSON.stringify(corpo) });
        d = await api('/api/rastreio/capi/conferir', { method: 'POST', body: '{}' });
        desenhar();
      } catch (x) { dizer(res, false, x.message); }
    }) });
    const sair = conectado ? el('button', { class: 'botao perigo an-sair', type: 'button', text: 'Desconectar', onclick: () => desconectar('anuncios', sair, res, 'Desconectar a conta de anúncios? A Central de criativos deixa de mostrar gasto e custo (os leads continuam).') }) : null;
    return el('div', { class: 'an-parte', id: 'an-anuncios' },
      el('div', { class: 'an-cab' }, el('h3', { text: 'Conta de anúncios' }), el('span', { class: 'estado' + (s.estado === 'ok' ? ' ok' : s.estado === 'erro' ? ' erro' : ''), text: NOME_SIT[s.estado] })),
      el('p', { text: 'Para a Central de criativos mostrar quanto cada anúncio gastou, os cliques e o custo por lead e por venda.' }),
      situacao(s),
      el('div', { class: 'an-campos' },
        campo('Número da conta de anúncios', conta, 'Pode colar o endereço do Gerenciador de Anúncios: a gente acha o número.'),
        campo('Token de acesso (leitura de anúncios)', token, 'Precisa da permissão ads_read.')),
      el('div', { class: 'an-botoes' }, salvar, sair, res),
      detalhes('passos-anuncios', 'Como pegar o número e o token',
        passos('Abra o Gerenciador de Anúncios. O número da conta aparece no menu de contas, embaixo do nome (ou no endereço, depois de "act=").',
          'Em Configurações do negócio › Usuários do sistema, crie (ou abra) um usuário do sistema e dê acesso à conta de anúncios.',
          'Toque em "Gerar token", escolha o app e marque a permissão ads_read. Copie e cole aqui.',
          'Salve e confira: a Sintonia mostra o nome da conta quando está tudo certo.')));
  }

  // ---------- 2) API de Conversões ----------
  function parteConversoes() {
    const s = d.situacao.conversoes;
    const ligado = el('input', { type: 'checkbox', id: 'capi-ligado', checked: d.ligado });
    const dataset = el('input', { id: 'capi-dataset', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 1234567890123456', value: d.datasetId });
    const token = el('input', { id: 'capi-token', type: 'password', autocomplete: 'off', placeholder: d.token.definido ? `Salvo (termina em ${d.token.final}). Cole outro para trocar.` : 'Cole o token' });
    const teste = el('input', { id: 'capi-teste', autocomplete: 'off', placeholder: 'TEST12345', value: d.testeCodigo });
    const waba = el('input', { id: 'capi-waba', inputmode: 'numeric', autocomplete: 'off', value: d.wabaId });
    const page = el('input', { id: 'capi-page', inputmode: 'numeric', autocomplete: 'off', value: d.pageId });
    const valor = el('input', { id: 'capi-valor', inputmode: 'decimal', autocomplete: 'off', placeholder: '250,00', value: d.valorPadrao });
    const versao = el('input', { id: 'capi-versao', autocomplete: 'off', placeholder: 'v27.0', value: d.versao });
    const res = el('span', { class: 'res', role: 'status' });

    const regras = ['lead', 'qualificado', 'agendada', 'compareceu'].map((k) => {
      const r = d.eventos[k];
      const lig = el('input', { type: 'checkbox', checked: r.ligado, style: 'width:20px;height:20px' });
      const site = el('input', { value: r.site, placeholder: d.padrao[k].site, autocomplete: 'off' });
      const msg = el('select', {}, el('option', { value: '', text: '— usar o caminho do telefone —' }), ...d.eventosMensagem.map((n) => el('option', { value: n, text: n })));
      msg.value = r.mensagem;
      return { k, lig, site, msg, cartao: el('div', { class: 'cartao' }, el('div', { class: 'cab' }, el('b', { text: ROTULO[k] }), el('label', { class: 'an-chave', style: 'font-size:13px' }, lig, 'Ligado')), campo('Nome do evento (links e telefone)', site), campo('Nome do evento (anúncio de clique para WhatsApp)', msg)) };
    });
    const etapas = el('div', { style: 'display:grid;gap:8px' });
    const opcoesEtapa = () => funis.flatMap((f) => (f.etapas || []).map((e) => [e.id, `${f.nome} › ${e.nome}`]));
    const linhaEtapa = (x) => {
      const sel = el('select', { 'aria-label': 'Etapa', class: 'an-etapa-sel' }, ...opcoesEtapa().map(([v, t]) => el('option', { value: v, text: t })));
      if (x?.etapaId) sel.value = x.etapaId;
      const nome = el('input', { type: 'text', class: 'an-etapa-nome', value: x?.nome || '', placeholder: 'AvaliacaoMarcada', 'aria-label': 'Nome do evento', autocomplete: 'off' });
      const lig = el('input', { type: 'checkbox', class: 'an-etapa-lig', checked: x ? x.ligado : true, 'aria-label': 'Ligado' });
      const linha = el('div', { class: 'an-etapa' }, lig, sel, nome, el('button', { class: 'botao perigo mini', type: 'button', text: 'Tirar', onclick: () => linha.remove() }));
      return linha;
    };
    etapas.append(...d.eventos.etapas.map(linhaEtapa));
    const maisEtapa = el('button', { class: 'botao leve mini', type: 'button', text: '+ Evento por etapa', onclick: () => {
      if (!opcoesEtapa().length) { dizer(res, false, 'Crie antes um funil com etapas no CRM.'); return; }
      etapas.append(linhaEtapa(null));
    } });

    const corpo = () => {
      const eventos = { etapas: [...etapas.querySelectorAll('.an-etapa')].map((l) => ({ etapaId: l.querySelector('.an-etapa-sel').value, nome: l.querySelector('.an-etapa-nome').value.trim(), ligado: l.querySelector('.an-etapa-lig').checked })).filter((x) => x.etapaId && x.nome) };
      for (const r of regras) eventos[r.k] = { ligado: r.lig.checked, site: r.site.value.trim(), mensagem: r.msg.value };
      const c = { ligado: ligado.checked, datasetId: dataset.value.trim(), testeCodigo: teste.value.trim(), wabaId: waba.value.trim(), pageId: page.value.trim(), valorPadrao: valor.value.trim(), versao: versao.value.trim(), eventos };
      if (token.value.trim()) c.token = token.value.trim();
      return c;
    };
    const salvarAgora = async () => { d = await api('/api/rastreio/capi', { method: 'PUT', body: JSON.stringify(corpo()) }); };
    const salvar = el('button', { class: 'botao', type: 'button', text: 'Salvar e conferir', onclick: () => ocupado(salvar, async () => {
      if (!dataset.value.trim() && !token.value.trim() && !d.token.definido && !ligado.checked) { dizer(res, false, 'Cole o Dataset (Pixel) ID e o token para conectar.'); dataset.focus(); return; }
      try {
        await salvarAgora();
        if (d.datasetId && d.token.definido) d = await api('/api/rastreio/capi/conferir', { method: 'POST', body: '{}' });
        desenhar();
        dizer(document.querySelector('#an-conversoes .res'), d.situacao.conversoes.estado !== 'erro', d.situacao.conversoes.estado === 'erro' ? 'Salvo, mas a Meta recusou. Veja acima.' : 'Salvo ✓');
      } catch (x) { dizer(res, false, x.message); }
    }) });
    // O teste usa o que está na tela: salva antes (antes, testava o que estava salvo e confundia).
    const testar = el('button', { class: 'botao leve', type: 'button', text: 'Enviar evento de teste', onclick: () => ocupado(testar, async () => {
      if (!teste.value.trim()) { dizer(res, false, 'Cole o código de evento de teste (Gerenciador de Eventos › Eventos de teste) para não misturar com os dados reais.'); teste.focus(); return; }
      try {
        await salvarAgora();
        const r = await api('/api/rastreio/capi/teste', { method: 'POST', body: '{}' });
        d = await api('/api/rastreio/capi');
        desenhar();
        dizer(document.querySelector('#an-conversoes .res'), r.ok, r.ok ? 'Evento de teste enviado ✓ Confira em "Eventos de teste" no Gerenciador de Eventos.' : `A Meta recusou: ${(r.evento.resposta || '').slice(0, 240)}`);
      } catch (x) { dizer(res, false, x.message); }
    }) });
    const conectada = Boolean(d.datasetId || d.token.definido);
    const sair = conectada ? el('button', { class: 'botao perigo an-sair', type: 'button', text: 'Desconectar', onclick: () => desconectar('conversoes', sair, res, 'Desconectar a API de Conversões? A Sintonia para de avisar a Meta e apaga o token e o Dataset ID salvos.') }) : null;

    const reg = d.registro || [];
    const COR = { enviado: 'ok', pendente: '', erro: 'erro', desistiu: 'erro' };
    const NOME = { enviado: 'Enviado', pendente: 'Na fila', erro: 'Recusado', desistiu: 'Sem resposta' };
    const registro = el('div', { class: 'an-reg' }, ...(reg.length ? reg.slice(0, 15).map((e) => {
      const c = el('div', { class: 'cartao' },
        el('div', { class: 'cab' }, el('b', { text: `${e.nome}${e.teste ? ' (teste)' : ''}` }), el('span', { class: 'estado ' + (COR[e.situacao] || ''), text: NOME[e.situacao] || e.situacao })),
        el('p', { text: `${quando(e.criadoEm)} · ${e.origem === 'business_messaging' ? 'anúncio de WhatsApp' : 'telefone em hash'} · ${e.tentativas} tentativa(s)` }),
        e.resposta && e.situacao !== 'enviado' ? el('p', { class: 'an-mono', text: `Resposta da Meta: ${e.resposta.slice(0, 300)}` }) : null);
      if (e.situacao === 'erro' || e.situacao === 'desistiu') {
        const b = el('button', { class: 'botao leve mini', type: 'button', text: 'Reenviar', onclick: () => ocupado(b, async () => { try { await api(`/api/rastreio/capi/eventos/${e.id}/reenviar`, { method: 'POST', body: '{}' }); d = await api('/api/rastreio/capi'); desenhar(); } catch (x) { dizer(res, false, x.message); } }) });
        c.append(el('div', { class: 'linha' }, b));
      }
      return c;
    }) : [el('p', { text: 'Nenhum evento enviado ainda.' })]));
    const falhas = reg.filter((e) => e.situacao === 'erro' || e.situacao === 'desistiu').length;

    return el('div', { class: 'an-parte', id: 'an-conversoes' },
      el('div', { class: 'an-cab' }, el('h3', { text: 'API de Conversões' }), el('span', { class: 'estado' + (s.estado === 'ok' ? ' ok' : s.estado === 'erro' ? ' erro' : ''), text: NOME_SIT[s.estado] })),
      el('p', { text: 'Avisa a Meta quando a cliente do anúncio vira lead, agenda e comparece. Assim os anúncios procuram gente que agenda, não só quem chama. Telefone e e-mail vão sempre embaralhados (hash).' }),
      situacao(s),
      el('label', { class: 'an-chave' }, ligado, 'Enviar eventos para a Meta'),
      el('div', { class: 'an-campos' },
        campo('Dataset ID (Pixel ID)', dataset, 'Só os números. Fica no Gerenciador de Eventos.'),
        campo('Token da API de Conversões', token),
        campo('Código de evento de teste (opcional)', teste, 'Com ele, os eventos vão só para "Eventos de teste". Apague depois de testar.')),
      el('div', { class: 'an-botoes' }, salvar, testar, sair, res),
      detalhes('avancado', 'Ajustes avançados',
        el('div', { class: 'an-campos' },
          campo('WhatsApp Business Account ID', waba, 'Vazio = o da unidade na API oficial.'),
          campo('Page ID do Facebook (opcional)', page),
          campo('Valor padrão de uma venda (R$)', valor, 'Quando o cartão e o agendamento não têm valor.'),
          campo('Versão da Graph API', versao)),
        el('h3', { text: 'Nomes dos eventos' }),
        el('p', { text: 'Já vêm prontos. Mude só se a sua agência pedir.' }),
        el('div', { class: 'cartoes' }, ...regras.map((r) => r.cartao)),
        el('h3', { text: 'Eventos por etapa do CRM' }),
        el('p', { text: 'Quando o cartão entra na etapa, a Sintonia manda o evento com este nome (sem espaços nem acentos, ex.: AvaliacaoMarcada).' }),
        etapas, el('div', { class: 'linha' }, maisEtapa),
        el('p', { text: 'Depois de mudar aqui, toque em "Salvar e conferir".' })),
      detalhes('passos-capi', 'Passo a passo na Meta',
        passos('No Gerenciador de Eventos, crie ou abra o conjunto de dados (dataset/pixel) e copie o ID.',
          'Em Configurações › API de Conversões › Gerar token de acesso, gere o token e cole aqui.',
          'Para anúncios de clique para WhatsApp: em Configurações do negócio › Fontes de dados, ligue o conjunto de dados à conta do WhatsApp Business e à Página.',
          'Na aba "Eventos de teste", copie o código, cole aqui e toque em "Enviar evento de teste". Depois apague o código para os eventos contarem de verdade.',
          'Nos anúncios que levam para um link, em Parâmetros de URL use: utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}')),
      detalhes('registro', `Últimos envios${reg.length ? ` (${reg.length}${falhas ? `, ${falhas} com problema` : ''})` : ''}`, registro));
  }

  async function desconectar(parte, botao, res, pergunta) {
    if (!confirm(pergunta)) return;
    await ocupado(botao, async () => {
      try { d = await api('/api/rastreio/capi/desconectar', { method: 'POST', body: JSON.stringify({ parte }) }); desenhar(); }
      catch (x) { dizer(res, false, x.message); }
    });
  }

  function desenhar() {
    const cab = el('h2', { id: 't-capi' }, el('span', { class: 'ic' }), el('span', {}, 'Anúncios da Meta', el('small', { text: 'Resultado dos anúncios e aviso à Meta de quem agenda' })));
    cab.firstChild.innerHTML = ICONE;
    if (!d) { caixa.replaceChildren(cab, el('p', { text: 'Carregando…' })); return; }
    caixa.replaceChildren(cab,
      el('p', {}, 'Os leads de anúncio de clique para WhatsApp já aparecem na ', el('a', { href: '/app#criativos', text: 'Central de criativos' }), ' sem conectar nada. Conecte a conta de anúncios para ver também gasto e custo por lead.'),
      parteAnuncios(), parteConversoes());
  }

  async function carregar() {
    desenhar();
    try { [d, funis] = await Promise.all([api('/api/rastreio/capi'), api('/api/funis').catch(() => [])]); funis = Array.isArray(funis) ? funis : funis?.funis || []; }
    catch (x) { caixa.replaceChildren(el('h2', { id: 't-capi', text: 'Anúncios da Meta' }), el('p', { class: 'res erro', text: x.message })); return; }
    desenhar();
    // Conta preenchida mas ainda não conferida (ex.: o servidor reiniciou): confere sozinho, uma vez.
    if (d.situacao.anuncios.estado === 'nao_conferida') {
      try { d = await api('/api/rastreio/capi/conferir', { method: 'POST', body: '{}' }); } catch { /* fica como estava */ }
      desenhar();
    }
  }
  carregar();
})();
