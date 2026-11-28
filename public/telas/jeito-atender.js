/* serena-config: tela "Jeito de atender" da IA (Inteligência › Comportamento › Jeito de atender).
 * Registra window.SintoniaJeitoAtender = { cartao(ui), abrir(ui) }.
 * Tudo que vem do servidor entra por textContent/value (nunca como HTML). Grava em /api/ia/jeito; os horários padrão
 * são os da unidade (PATCH /api/unidades/:id), para não ter dois lugares com a mesma informação. */
(() => {
  const CSS = `
  .jx-cartao { display: flex; align-items: center; gap: 12px; padding: 14px; }
  .jx-cartao .jx-txt { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .jx-cartao b { font-size: 16px; font-weight: 650; }
  .jx-cartao .jx-txt > span { font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .jx-ic { width: 38px; height: 38px; border-radius: 11px; flex: none; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .jx-ic svg { width: 20px; height: 20px; }

  dialog.jx { padding: 0; margin: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border: 0; border-radius: 0; display: none; flex-direction: column; background: var(--painel); color: var(--texto); }
  dialog.jx[open] { display: flex; }
  dialog.jx::backdrop { background: rgba(6, 16, 32, .55); }
  @media (min-width: 761px) { dialog.jx { margin: auto; width: min(1060px, calc(100vw - 48px)); height: min(900px, calc(100dvh - 48px)); border-radius: 20px; border: 1px solid var(--linha); box-shadow: 0 24px 70px rgba(0,0,0,.35); overflow: hidden; } }
  .jx-topo { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); background: var(--fundo); border-bottom: 1px solid var(--linha); position: relative; }
  .jx-topo::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, transparent, #0ffcbe, #3aa0ff, transparent); opacity: .7; }
  .jx-topo h2 { margin: 0; font-size: 17px; font-weight: 700; text-align: center; white-space: nowrap; }
  .jx-topo .jx-esq { justify-self: start; } .jx-topo .jx-dir { justify-self: end; }
  .jx-link { all: unset; cursor: pointer; font-size: 15.5px; color: var(--marca-azul, #106ebe); padding: 8px 6px; border-radius: 8px; }
  .jx-link:focus-visible, .jx-mini:focus-visible, .jx-chip:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  html[data-tema="escuro"] .jx-link, html[data-tema="escuro"] .jx-mini { color: #0ffcbe; }
  .jx-salvar { all: unset; cursor: pointer; font-size: 15px; font-weight: 700; color: #fff; padding: 8px 18px; border-radius: 999px; background: linear-gradient(90deg, #106ebe, #3aa0ff); }
  .jx-salvar[disabled] { opacity: .45; cursor: default; }
  .jx-corpo { flex: 1; min-height: 0; display: grid; grid-template-rows: auto 1fr; }
  @media (min-width: 900px) { .jx-corpo { grid-template-columns: 210px minmax(0, 1fr); grid-template-rows: none; } }
  .jx-nav { display: flex; gap: 6px; overflow-x: auto; padding: 10px 12px; border-bottom: 1px solid var(--linha); background: var(--fundo); scrollbar-width: none; }
  .jx-nav::-webkit-scrollbar { display: none; }
  @media (min-width: 900px) { .jx-nav { flex-direction: column; overflow: visible; border-bottom: 0; border-right: 1px solid var(--linha); padding: 14px 10px; } }
  .jx-chip { all: unset; cursor: pointer; white-space: nowrap; font-size: 14px; font-weight: 600; color: var(--sub); padding: 7px 13px; border-radius: 999px; }
  @media (min-width: 900px) { .jx-chip { border-radius: 10px; padding: 9px 12px; } }
  .jx-chip[aria-current="true"] { color: var(--texto); background: color-mix(in srgb, #3aa0ff 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, #3aa0ff 45%, transparent); }
  .jx-rolo { overflow-y: auto; padding: 16px 16px 40px; display: grid; gap: 18px; align-content: start; }
  @media (min-width: 900px) { .jx-rolo { padding: 20px 26px 60px; } }
  .jx-grupo { display: grid; gap: 12px; scroll-margin-top: 10px; }
  .jx-grupo > h3 { margin: 4px 2px 0; font-size: 19px; font-weight: 750; }
  .jx-grupo > p { margin: -6px 2px 0; font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .jx-caixa { background: var(--fundo); border: 1px solid var(--linha); border-radius: 16px; padding: 14px; display: grid; gap: 14px; }
  .jx-campo { display: grid; gap: 6px; min-width: 0; }
  .jx-rot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .jx-rot label, .jx-rot b { font-size: 14.5px; font-weight: 650; color: var(--texto); }
  .jx-rot .jx-esp { flex: 1; }
  .jx-mini { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600; color: var(--marca-azul, #106ebe); padding: 2px 4px; border-radius: 6px; }
  .jx-mini[hidden] { display: none; }
  .jx-ajuda { font-size: 12.5px; color: var(--sub); line-height: 1.4; margin: 0; }
  .jx-conta { font-size: 11.5px; color: var(--sub); text-align: right; margin-top: -2px; }
  .jx-conta.alto { color: #e26b2c; }
  .jx-in { font: inherit; font-size: 15.5px; color: var(--texto); background: var(--entrada, var(--painel)); border: 1px solid var(--linha); border-radius: 12px; padding: 10px 12px; width: 100%; box-sizing: border-box; min-width: 0; }
  textarea.jx-in { resize: vertical; line-height: 1.45; min-height: 74px; }
  .jx-in:focus { outline: 2px solid #3aa0ff; outline-offset: -1px; }
  .jx-in:disabled { opacity: .7; }
  .jx-linha { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); align-items: end; }
  .jx-rolo::after { content: ""; height: 35vh; }
  .jx-modelo { border: 1px solid var(--linha); border-radius: 12px; padding: 10px; display: grid; gap: 8px; }
  .jx-modelo .jx-rot { justify-content: space-between; }
  .jx-perigo { all: unset; cursor: pointer; font-size: 12.5px; font-weight: 600; color: #e5484d; padding: 2px 4px; }
  .jx-mais { all: unset; cursor: pointer; font-size: 14px; font-weight: 650; color: var(--marca-azul, #106ebe); padding: 6px 2px; }
  html[data-tema="escuro"] .jx-mais { color: #0ffcbe; }
  .jx-aviso { border-radius: 14px; padding: 11px 13px; font-size: 13.5px; line-height: 1.45; background: var(--aviso, #fff4d6); color: var(--aviso-txt, #5b4300); }
  .jx-nota { font-size: 13px; color: var(--sub); line-height: 1.4; }
  .jx-previa { display: grid; gap: 8px; padding: 12px; border-radius: 14px; background-color: var(--chat, var(--painel)); }
  .jx-previa small { font-size: 12px; font-weight: 700; color: var(--sub); text-transform: uppercase; letter-spacing: .04em; }
  .jx-bal { justify-self: end; max-width: 88%; padding: 8px 12px; border-radius: 14px 14px 4px 14px; background: color-mix(in srgb, #3aa0ff 18%, var(--fundo)); font-size: 14.5px; line-height: 1.4; white-space: pre-wrap; overflow-wrap: anywhere; }
  .jx-bal.vazio { opacity: .6; font-style: italic; }
  .jx-hist { display: grid; }
  .jx-hist div { padding: 10px 2px; border-bottom: 1px solid var(--linha); display: grid; gap: 2px; font-size: 13.5px; }
  .jx-hist div:last-child { border-bottom: 0; }
  .jx-hist b { font-weight: 650; }
  .jx-hist span { color: var(--sub); }
  .jx-erro { color: #e5484d; font-size: 13px; }
  .jx-erro:empty { display: none; }
  .jx-emojis { display: flex; flex-wrap: wrap; gap: 6px; }
  .jx-emojis button { all: unset; cursor: pointer; font-size: 20px; width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; border: 1px solid var(--linha); background: var(--painel); }
  .jx-emojis button[aria-pressed="true"] { border-color: #3aa0ff; box-shadow: 0 0 0 2px color-mix(in srgb, #3aa0ff 35%, transparent); background: color-mix(in srgb, #3aa0ff 12%, var(--fundo)); }
  `;
  const SVG_FALA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4.5"/></svg>';
  const EMOJIS_SUGERIDOS = ['✅', '💜', '✨', '💖', '🙏', '👋', '😊', '🥰', '📅', '⏰', '📍', '💇‍♀️'];
  const NOMES_CAMPOS = {
    'identidade.nome': 'Nome', 'identidade.apresentacao': 'Apresentação', 'identidade.boasVindasNova': 'Boas-vindas de cliente nova', 'identidade.boasVindasVolta': 'Boas-vindas de quem volta',
    'tom.tomEstilo': 'Tom e estilo', 'tom.fazer': 'O que fazer', 'tom.evitar': 'O que evitar', 'tom.emojis': 'Emojis',
    'mensagens.linhasMin': 'Linhas por mensagem', 'mensagens.linhasMax': 'Linhas por mensagem', 'mensagens.maxMensagens': 'Mensagens seguidas', 'mensagens.confirmacao': 'Confirmação por unidade', 'mensagens.modelos': 'Mensagens prontas',
    'agendamento.roteiro': 'Roteiro de agendamento', 'agendamento.dadosClienteNova': 'Dados da cliente nova', tabelas: 'Tabelas de preço',
    'avancado.modelo': 'Modelo da IA', 'avancado.esforco': 'Esforço', 'avancado.digitando': 'Tempo de "digitando"', semente: 'Texto inicial',
  };
  const NOME_MODELO = { '': 'Padrão do servidor', 'claude-opus-5-5': 'Claude Opus 5.5 (mais caprichado)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5 (mais rápido e barato)' };
  const NOME_ESFORCO = { '': 'Padrão do servidor', low: 'Baixo (responde mais rápido)', medium: 'Médio', high: 'Alto (pensa mais antes de responder)' };

  const estilo = () => {
    if (document.getElementById('estilo-jeito')) return;
    const s = document.createElement('style');
    s.id = 'estilo-jeito';
    s.textContent = CSS;
    document.head.append(s);
  };
  const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** "9" → "09:00", "9h30" → "09:30", "12:30" fica. */
  const hora = (x) => {
    const m = /^(\d{1,2})(?:[:h](\d{2})?)?h?$/i.exec(String(x).trim());
    return m ? `${m[1].padStart(2, '0')}:${m[2] || '00'}` : String(x).trim();
  };
  const linhas = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const emojisDe = (t) => [...String(t || '').matchAll(/\p{Extended_Pictographic}[\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\p{Extended_Pictographic}]*/gu)].map((m) => m[0].replace(/\u{FE0F}/gu, ''));
  const boasVindas = (j, qual, nome, primeiro) => {
    const ap = (j.identidade.apresentacao || '').trim();
    const bv = ((qual === 'nova' ? j.identidade.boasVindasNova : j.identidade.boasVindasVolta) || '').trim();
    const marca = /\[APRESENTA[ÇC][ÃA]O\]/gi;
    let t = !bv ? ap : marca.test(bv) ? bv.replace(marca, ap).replace(/\s{2,}/g, ' ').trim() : [bv, ap].filter(Boolean).join(' ');
    return t.replace(/\[SEU NOME\]/gi, nome || 'Serena').replace(/\[PRIMEIRO NOME\]/gi, primeiro);
  };

  /** Caixa de texto do tamanho do conteúdo (até 420 px). */
  const crescer = (t) => { t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight + 2, 420)}px`; };
  const crescerEm = (raiz) => requestAnimationFrame(() => raiz.querySelectorAll('textarea').forEach(crescer));

  function cartao(ui) {
    estilo();
    const { el } = ui;
    return el('div', { class: 'iax-cartao' },
      el('div', { class: 'jx-cartao' },
        el('span', { class: 'jx-ic', html: SVG_FALA, 'aria-hidden': 'true' }),
        el('span', { class: 'jx-txt' }, el('b', { text: 'Jeito de atender' }),
          el('span', { text: 'Nome, apresentação, tom, emojis, tamanho das mensagens, roteiro de agendamento e mensagens prontas.' })),
        el('button', { class: 'iax-acao', type: 'button', onclick: () => abrir(ui) }, el('span', { text: 'Abrir' }))));
  }

  async function abrir(ui) {
    estilo();
    const { el, api, toast } = ui;
    let dados;
    try { dados = await api('/api/ia/jeito'); } catch (x) { toast(x.message || 'Não deu para abrir agora.'); return; }

    const pode = Boolean(dados.podeEditar);
    const orig = { jeito: structuredClone(dados.jeito), nome: dados.nome, tabelas: { ...dados.tabelas }, unidades: structuredClone(dados.unidades) };
    const v = structuredClone(orig); // o que está na tela
    const padrao = dados.padrao;
    const nomesUnidade = Object.fromEntries((dados.unidades || []).map((u) => [u.id, u.nome]));

    const repintar = []; // listas que se redesenham depois de salvar (o objeto da tela é trocado pelo do servidor)
    const btnSalvar = el('button', { class: 'jx-salvar', type: 'button', text: 'Salvar', disabled: '' });
    const erroGeral = el('div', { class: 'jx-erro', role: 'alert' });
    const mudou = () => !igual(v, orig);
    const marcar = () => { btnSalvar.disabled = !pode || !mudou(); pintarPrevia(); };

    // ---------- peças
    const caminho = (c) => c.split('.');
    const ler = (c) => caminho(c).reduce((o, k) => (o == null ? o : o[k]), v.jeito);
    const gravar = (c, valor) => { const p = caminho(c); const ult = p.pop(); p.reduce((o, k) => o[k], v.jeito)[ult] = valor; };
    const doPadrao = (c) => caminho(c).reduce((o, k) => (o == null ? o : o[k]), padrao);

    const contador = (inp, max) => {
      const c = el('div', { class: 'jx-conta' });
      const p = () => { const n = inp.value.length; c.textContent = `${n}/${max}`; c.classList.toggle('alto', n > max * 0.9); };
      inp.addEventListener('input', p); p();
      return c;
    };
    const botaoPadrao = (estaNoPadrao, voltar) => {
      const b = el('button', { class: 'jx-mini', type: 'button', text: 'Voltar ao padrão' });
      const ver = () => { b.hidden = !pode || estaNoPadrao(); };
      b.addEventListener('click', () => { voltar(); ver(); marcar(); });
      return { b, ver };
    };
    /** Campo de texto (input ou textarea) ligado a um caminho do jeito. */
    const campoTexto = (c, rotulo, ajuda, { max = 600, area = false, linhasArea = 3, placeholder = '', lista = false } = {}) => {
      const id = `jx-${c.replace(/\./g, '-')}`;
      const valorTela = () => (lista ? (ler(c) || []).join('\n') : ler(c) || '');
      const inp = area || lista ? el('textarea', { class: 'jx-in', id, rows: String(linhasArea), placeholder }) : el('input', { class: 'jx-in', id, type: 'text', placeholder });
      inp.maxLength = lista ? max * 30 : max;
      inp.value = valorTela();
      inp.disabled = !pode;
      const pb = botaoPadrao(() => igual(ler(c), doPadrao(c)), () => { gravar(c, structuredClone(doPadrao(c))); inp.value = valorTela(); inp.dispatchEvent(new Event('input')); });
      inp.addEventListener('input', () => { gravar(c, lista ? linhas(inp.value) : inp.value); pb.ver(); marcar(); });
      pb.ver();
      return el('div', { class: 'jx-campo' },
        el('div', { class: 'jx-rot' }, el('label', { for: id, text: rotulo }), el('span', { class: 'jx-esp' }), pb.b),
        ajuda ? el('p', { class: 'jx-ajuda', text: ajuda }) : null,
        inp, lista ? null : contador(inp, max));
    };
    /** Lista de itens, um por caixa (ex.: passos do roteiro), com adicionar e remover. */
    const campoItens = (c, rotulo, ajuda, { max = 800, maxItens = 15, placeholder = '', nomeItem = 'Passo' } = {}) => {
      const caixaL = el('div', { class: 'jx-campo' });
      const pintar = () => {
        const l = ler(c);
        const pb = botaoPadrao(() => igual(ler(c), doPadrao(c)), () => { gravar(c, structuredClone(doPadrao(c))); pintar(); });
        pb.ver();
        caixaL.replaceChildren(
          el('div', { class: 'jx-rot' }, el('b', { text: rotulo }), el('span', { class: 'jx-esp' }), pb.b),
          ajuda ? el('p', { class: 'jx-ajuda', text: ajuda }) : null,
          ...l.map((item, i) => {
            const ta = el('textarea', { class: 'jx-in', rows: '2', maxlength: String(max), 'aria-label': `${nomeItem} ${i + 1}`, placeholder, disabled: pode ? null : '' });
            ta.value = item;
            ta.addEventListener('input', () => { l[i] = ta.value; pb.ver(); marcar(); });
            return el('div', { class: 'jx-modelo' },
              el('div', { class: 'jx-rot' }, el('b', { text: `${nomeItem} ${i + 1}` }),
                pode ? el('button', { class: 'jx-perigo', type: 'button', text: 'Remover', onclick: () => { l.splice(i, 1); pintar(); marcar(); } }) : null),
              ta);
          }),
          pode && l.length < maxItens ? el('button', { class: 'jx-mais', type: 'button', text: `+ Adicionar ${nomeItem.toLowerCase()}`, onclick: () => { l.push(''); pintar(); marcar(); caixaL.querySelector('.jx-modelo:last-of-type textarea')?.focus(); } }) : null);
        crescerEm(caixaL);
      };
      pintar();
      repintar.push(pintar);
      return caixaL;
    };
    const campoNumero = (c, rotulo, { min, max, passo = 1, escala = 1, sufixo = '' }) => {
      const id = `jx-${c.replace(/\./g, '-')}`;
      const inp = el('input', { class: 'jx-in', id, type: 'number', min: String(min / escala), max: String(max / escala), step: String(passo), inputmode: 'decimal' });
      inp.value = String((ler(c) ?? 0) / escala);
      inp.disabled = !pode;
      const pb = botaoPadrao(() => ler(c) === doPadrao(c), () => { gravar(c, doPadrao(c)); inp.value = String(doPadrao(c) / escala); });
      inp.addEventListener('input', () => { const n = Math.round(Number(inp.value) * escala); if (Number.isFinite(n)) gravar(c, n); pb.ver(); marcar(); });
      pb.ver();
      return el('div', { class: 'jx-campo' }, el('div', { class: 'jx-rot' }, el('label', { for: id, text: rotulo + (sufixo ? ` (${sufixo})` : '') }), el('span', { class: 'jx-esp' }), pb.b), inp);
    };
    const campoEscolha = (c, rotulo, ajuda, opcoes, nomes) => {
      const id = `jx-${c.replace(/\./g, '-')}`;
      const sel = el('select', { class: 'jx-in', id }, ...opcoes.map((o) => el('option', { value: o, text: nomes[o] || o })));
      sel.value = ler(c) || '';
      sel.disabled = !pode;
      const pb = botaoPadrao(() => ler(c) === doPadrao(c), () => { gravar(c, doPadrao(c)); sel.value = doPadrao(c); });
      sel.addEventListener('change', () => { gravar(c, sel.value); pb.ver(); marcar(); });
      pb.ver();
      return el('div', { class: 'jx-campo' }, el('div', { class: 'jx-rot' }, el('label', { for: id, text: rotulo }), el('span', { class: 'jx-esp' }), pb.b), ajuda ? el('p', { class: 'jx-ajuda', text: ajuda }) : null, sel);
    };
    const grupo = (id, titulo, sub, ...filhos) => el('section', { class: 'jx-grupo', id: `jx-g-${id}`, 'data-g': id }, el('h3', { text: titulo }), sub ? el('p', { text: sub }) : null, ...filhos);
    const caixa = (...f) => el('div', { class: 'jx-caixa' }, ...f);

    // ---------- Identidade (com a prévia)
    const inpNome = el('input', { class: 'jx-in', id: 'jx-nome', type: 'text', maxlength: '40', placeholder: 'Ex.: Serena, Ana, Bia' });
    inpNome.value = v.nome || '';
    inpNome.disabled = !pode;
    inpNome.addEventListener('input', () => { v.nome = inpNome.value; marcar(); });
    const previaNova = el('div', { class: 'jx-bal' }), previaVolta = el('div', { class: 'jx-bal' });
    const tituloPrevia = el('small');
    function pintarPrevia() {
      const nome = (v.nome || '').trim() || 'Serena';
      tituloPrevia.textContent = `Como a ${nome} se apresenta`;
      const n = boasVindas(v.jeito, 'nova', nome, 'Marina'), r = boasVindas(v.jeito, 'volta', nome, 'Marina');
      previaNova.textContent = n || 'Sem texto: a IA se apresenta do jeito dela.';
      previaNova.classList.toggle('vazio', !n);
      previaVolta.textContent = r || 'Sem texto: a IA se apresenta do jeito dela.';
      previaVolta.classList.toggle('vazio', !r);
    }
    const caixaPrevia = caixa(el('div', { class: 'jx-previa', 'aria-live': 'polite' },
        tituloPrevia,
        el('span', { class: 'jx-nota', text: 'Cliente nova' }), previaNova,
        el('span', { class: 'jx-nota', text: 'Cliente que volta (ex.: Marina)' }), previaVolta));
    const gIdent = grupo('identidade', 'Identidade', 'Quem atende e como ela se apresenta na primeira mensagem.',
      caixaPrevia,
      caixa(
        el('div', { class: 'jx-campo' }, el('div', { class: 'jx-rot' }, el('label', { for: 'jx-nome', text: 'Nome da atendente' })),
          el('p', { class: 'jx-ajuda', text: 'É o mesmo nome da assinatura das respostas. Entra no lugar de [SEU NOME].' }), inpNome),
        campoTexto('identidade.apresentacao', 'Apresentação', 'Como ela se apresenta. Use [SEU NOME] para o nome.', { max: 600, area: true, linhasArea: 2, placeholder: 'Ex.: Eu sou a [SEU NOME] e vou seguir com o seu atendimento.' }),
        campoTexto('identidade.boasVindasNova', 'Boas-vindas de cliente nova', 'Primeira mensagem para quem nunca veio. [APRESENTAÇÃO] mostra onde entra a apresentação (sem a marca, ela vem depois).', { max: 600, area: true, linhasArea: 2, placeholder: 'Ex.: Olá, bem-vinda à [nome da empresa]! [APRESENTAÇÃO]' }),
        campoTexto('identidade.boasVindasVolta', 'Boas-vindas de quem volta', 'Para quem já é cliente. [PRIMEIRO NOME] vira o primeiro nome do cadastro.', { max: 600, area: true, linhasArea: 2, placeholder: 'Ex.: Que bom ter você de volta, [PRIMEIRO NOME]! [APRESENTAÇÃO]' })));

    // ---------- Tom e estilo
    const caixaEmojis = el('div', { class: 'jx-emojis', role: 'group', 'aria-label': 'Emojis permitidos' });
    const inpEmojis = el('input', { class: 'jx-in', id: 'jx-tom-emojis', type: 'text', maxlength: '60', placeholder: 'Vazio = nenhum emoji' });
    const pintarEmojis = () => {
      const ativos = new Set(emojisDe(v.jeito.tom.emojis));
      caixaEmojis.replaceChildren(...EMOJIS_SUGERIDOS.map((e) => {
        const b = el('button', { type: 'button', 'aria-pressed': String(ativos.has(e.replace(/\u{FE0F}/gu, ''))), 'aria-label': `Emoji ${e}`, text: e, disabled: pode ? null : '' });
        b.addEventListener('click', () => {
          const l = emojisDe(v.jeito.tom.emojis);
          const k = e.replace(/\u{FE0F}/gu, '');
          const novo = l.includes(k) ? l.filter((x) => x !== k) : [...l, k];
          v.jeito.tom.emojis = novo.join(' ');
          inpEmojis.value = v.jeito.tom.emojis; pbEmo.ver(); pintarEmojis(); marcar();
        });
        return b;
      }));
    };
    inpEmojis.value = v.jeito.tom.emojis;
    inpEmojis.disabled = !pode;
    const pbEmo = botaoPadrao(() => igual(emojisDe(v.jeito.tom.emojis), emojisDe(padrao.tom.emojis)), () => { v.jeito.tom.emojis = padrao.tom.emojis; inpEmojis.value = padrao.tom.emojis; pintarEmojis(); });
    inpEmojis.addEventListener('input', () => { v.jeito.tom.emojis = inpEmojis.value; pbEmo.ver(); pintarEmojis(); marcar(); });
    pbEmo.ver(); pintarEmojis();
    const gTom = grupo('tom', 'Tom e estilo', 'O jeito de escrever. As regras de segurança (não inventar preço ou horário, não citar profissional, chamar a equipe quando pedem) continuam valendo.',
      caixa(
        campoTexto('tom.tomEstilo', 'Tom e estilo', 'Descreva como ela escreve: formal ou próxima, frases curtas, pontuação, gírias.', { max: 2000, area: true, linhasArea: 5, placeholder: 'Ex.: Cordial, leve e acolhedora, como alguém da equipe no WhatsApp. Frases curtas e naturais.' }),
        campoTexto('tom.fazer', 'O que fazer', 'Um item por linha.', { max: 300, lista: true, linhasArea: 4, placeholder: 'Ex.: Chamar a cliente pelo primeiro nome às vezes\nConduzir sempre para o agendamento' }),
        campoTexto('tom.evitar', 'O que evitar', 'Um item por linha.', { max: 300, lista: true, linhasArea: 4, placeholder: 'Ex.: Mandar textão\nPedir de novo um dado que a cliente já deu' }),
        el('div', { class: 'jx-campo' },
          el('div', { class: 'jx-rot' }, el('label', { for: 'jx-tom-emojis', text: 'Emojis permitidos' }), el('span', { class: 'jx-esp' }), pbEmo.b),
          el('p', { class: 'jx-ajuda', text: 'Só estes saem para a cliente; qualquer outro é tirado antes de enviar. Toque para ligar ou desligar, ou escreva no campo.' }),
          caixaEmojis, inpEmojis)));

    // ---------- Mensagens
    const listaConf = el('div', { class: 'jx-caixa' });
    const pintarConf = () => {
      const ids = [...new Set([...(dados.unidades || []).map((u) => u.id), ...v.jeito.mensagens.confirmacao.map((c) => c.unidade)])];
      listaConf.replaceChildren(el('p', { class: 'jx-ajuda', text: 'A mensagem que vai depois de agendar, uma por unidade. Use [DATA] e [HORÁRIO]. Vazia: a IA monta uma curta com data, horário e endereço.' }),
        ...ids.map((uid) => {
          const achar = () => v.jeito.mensagens.confirmacao.find((c) => c.unidade === uid);
          const ta = el('textarea', { class: 'jx-in', rows: '6', maxlength: '1500', id: `jx-conf-${uid}`, placeholder: 'Ex.: Agendamento confirmado ✅\nData: [DATA]\nHorário: [HORÁRIO]\nLocal: endereço da unidade\nAté breve!' });
          ta.value = achar()?.texto || '';
          ta.disabled = !pode;
          const doPad = () => (padrao.mensagens.confirmacao || []).find((c) => c.unidade === uid)?.texto || '';
          const pb = botaoPadrao(() => (achar()?.texto || '') === doPad(), () => { aplicar(doPad()); ta.value = doPad(); });
          const aplicar = (t) => {
            const l = v.jeito.mensagens.confirmacao.filter((c) => c.unidade !== uid);
            v.jeito.mensagens.confirmacao = t.trim() ? [...l, { unidade: uid, texto: t }] : l;
          };
          ta.addEventListener('input', () => { aplicar(ta.value); pb.ver(); marcar(); });
          pb.ver();
          return el('div', { class: 'jx-campo' }, el('div', { class: 'jx-rot' }, el('label', { for: `jx-conf-${uid}`, text: `Confirmação · ${nomesUnidade[uid] || uid}` }), el('span', { class: 'jx-esp' }), pb.b), ta, contador(ta, 1500));
        }));
      crescerEm(listaConf);
    };
    pintarConf();
    const listaModelos = el('div', { class: 'jx-caixa' });
    const pintarModelos = () => {
      const l = v.jeito.mensagens.modelos;
      const pb = botaoPadrao(() => igual(v.jeito.mensagens.modelos, padrao.mensagens.modelos), () => { v.jeito.mensagens.modelos = structuredClone(padrao.mensagens.modelos); pintarModelos(); });
      pb.ver();
      listaModelos.replaceChildren(
        el('div', { class: 'jx-rot' }, el('b', { text: 'Mensagens prontas' }), el('span', { class: 'jx-esp' }), pb.b),
        el('p', { class: 'jx-ajuda', text: 'Textos que a IA usa como estão (remarcar, endereço das unidades, pedido de dados…). Entre colchetes o que ela troca, ex.: [NOME].' }),
        ...l.map((m, i) => {
          const tit = el('input', { class: 'jx-in', type: 'text', maxlength: '80', value: m.titulo, 'aria-label': 'Nome da mensagem', placeholder: 'Ex.: Remarcar', disabled: pode ? null : '' });
          const tx = el('textarea', { class: 'jx-in', rows: '3', maxlength: '1500', 'aria-label': 'Texto da mensagem', placeholder: 'Texto da mensagem', disabled: pode ? null : '' });
          tx.value = m.texto;
          tit.addEventListener('input', () => { l[i].titulo = tit.value; pb.ver(); marcar(); });
          tx.addEventListener('input', () => { l[i].texto = tx.value; pb.ver(); marcar(); });
          return el('div', { class: 'jx-modelo' }, el('div', { class: 'jx-rot' }, tit, pode ? el('button', { class: 'jx-perigo', type: 'button', text: 'Remover', onclick: () => { l.splice(i, 1); pintarModelos(); marcar(); } }) : null), tx);
        }),
        pode && l.length < 30 ? el('button', { class: 'jx-mais', type: 'button', text: '+ Adicionar mensagem pronta', onclick: () => { l.push({ titulo: '', texto: '' }); pintarModelos(); marcar(); listaModelos.querySelector('.jx-modelo:last-of-type input')?.focus(); } }) : null);
      crescerEm(listaModelos);
    };
    pintarModelos();
    const gMsg = grupo('mensagens', 'Mensagens', 'Tamanho de cada mensagem, quantas seguidas e os textos prontos.',
      caixa(el('div', { class: 'jx-linha' },
        campoNumero('mensagens.linhasMin', 'Linhas por mensagem: mínimo', { min: 1, max: 10 }),
        campoNumero('mensagens.linhasMax', 'Linhas por mensagem: máximo', { min: 1, max: 10 }),
        campoNumero('mensagens.maxMensagens', 'Mensagens seguidas, no máximo', { min: 1, max: 5 })),
      el('p', { class: 'jx-ajuda', text: 'Padrão: 1 a 3 linhas, até 3 mensagens. A confirmação do agendamento pode ser maior.' })),
      listaConf, listaModelos);

    // ---------- Agendamento (roteiro, dados, horários das unidades)
    const caixaHor = el('div', { class: 'jx-caixa' });
    const pintarHorarios = () => {
      caixaHor.replaceChildren(el('div', { class: 'jx-rot' }, el('b', { text: 'Horários padrão por unidade' })),
        el('p', { class: 'jx-ajuda', text: dados.podeEditarUnidades ? 'Os horários que a IA oferece (os que estiverem livres no dia), separados por espaço. Vazio: ela oferece os livres da agenda. É o mesmo campo de Empresa › Unidades.' : 'Os horários que a IA oferece. Só a direção muda (Empresa › Unidades).' }),
        ...(v.unidades.length ? v.unidades.map((u) => {
          const inp = el('input', { class: 'jx-in', type: 'text', maxlength: '200', id: `jx-hor-${u.id}`, placeholder: 'Ex.: 09:00 12:30 15:30', inputmode: 'numeric', disabled: dados.podeEditarUnidades && pode ? null : '' });
          inp.value = (u.horariosPadrao || []).join(' ');
          inp.addEventListener('input', () => { u.horariosPadrao = inp.value.split(/[\s,;]+/).filter(Boolean).map(hora); marcar(); });
          return el('div', { class: 'jx-campo' }, el('label', { for: `jx-hor-${u.id}`, text: u.nome }), inp,
            u.ultimoHorarioEspecial ? el('span', { class: 'jx-nota', text: `Se a cliente pedir outro horário, marca até ${u.ultimoHorarioEspecial}.` }) : null);
        }) : [el('span', { class: 'jx-nota', text: 'Nenhuma unidade cadastrada.' })]));
    };
    pintarHorarios();
    const gAg = grupo('agendamento', 'Agendamento', 'O passo a passo até marcar e o que pedir para a cliente nova.',
      caixa(
        campoItens('agendamento.roteiro', 'Roteiro de agendamento (passos)', 'Na ordem. A IA segue este caminho sem pular as regras de segurança.', { max: 800, maxItens: 15, placeholder: 'Ex.: Perguntar para qual unidade ela quer agendar', nomeItem: 'Passo' }),
        campoTexto('agendamento.dadosClienteNova', 'Dados pedidos à cliente nova', 'Um por linha. Pedidos depois que ela escolhe o horário; quem já tem cadastro não informa nada. O telefone é o do WhatsApp.', { max: 120, lista: true, linhasArea: 4, placeholder: 'Ex.: nome completo\ndata de nascimento\ne-mail' })),
      caixaHor);

    // ---------- Tabelas
    const campoTabela = (k, rotulo, exemplo) => {
      const inp = el('input', { class: 'jx-in', id: `jx-tab-${k}`, type: 'text', maxlength: '120', placeholder: exemplo, disabled: pode ? null : '' });
      inp.value = v.tabelas[k] || '';
      inp.addEventListener('input', () => { v.tabelas[k] = inp.value; marcar(); });
      return el('div', { class: 'jx-campo' }, el('label', { for: `jx-tab-${k}`, text: rotulo }), inp);
    };
    const gTab = grupo('tabelas', 'Tabelas de preço', 'O nome (ou parte do nome) da imagem da tabela em Empresa › Documentos. Vai sozinha depois de cada agendamento e quando a cliente pergunta preço.',
      caixa(campoTabela('clienteNova', 'Tabela para cliente nova', 'Ex.: Tabela primeira visita'), campoTabela('jaCliente', 'Tabela para quem já é cliente', 'Ex.: Tabela de preços'),
        el('p', { class: 'jx-ajuda', text: 'Vazio: a tabela não vai sozinha depois do agendamento.' })));

    // ---------- Avançado
    const gAv = grupo('avancado', 'Avançado', 'Mexa só se precisar. O padrão já funciona bem.',
      caixa(
        campoEscolha('avancado.modelo', 'Modelo da IA', 'Qual IA responde as clientes.', (dados.opcoes?.modelos || ['']), NOME_MODELO),
        campoEscolha('avancado.esforco', 'Esforço', 'Quanto ela pensa antes de responder. Mais esforço = resposta mais caprichada, porém mais lenta.', (dados.opcoes?.esforcos || ['']), NOME_ESFORCO)),
      caixa(el('div', { class: 'jx-rot' }, el('b', { text: 'Tempo de "digitando…"' })),
        el('p', { class: 'jx-ajuda', text: 'Antes de cada mensagem aparece "digitando…" pelo tempo de uma pessoa escrever: um tempo fixo mais um pouco por letra, entre o mínimo e o máximo.' }),
        el('div', { class: 'jx-linha' },
          campoNumero('avancado.digitando.baseMs', 'Tempo fixo', { min: 0, max: 5000, passo: 0.1, escala: 1000, sufixo: 's' }),
          campoNumero('avancado.digitando.porLetraMs', 'Por letra', { min: 0, max: 200, passo: 1, sufixo: 'milésimos de segundo' }),
          campoNumero('avancado.digitando.minMs', 'Mínimo', { min: 0, max: 8000, passo: 0.1, escala: 1000, sufixo: 's' }),
          campoNumero('avancado.digitando.maxMs', 'Máximo', { min: 0, max: 8000, passo: 0.1, escala: 1000, sufixo: 's' }))));

    // ---------- Histórico
    const caixaHist = el('div', { class: 'jx-caixa jx-hist' }, el('span', { class: 'jx-nota', text: 'Carregando…' }));
    const carregarHist = () => api('/api/ia/jeito/historico').then((r) => {
      const l = r.versoes || [];
      caixaHist.replaceChildren(...(l.length ? l.map((x) => el('div', {},
        el('b', { text: `${x.por || 'Alguém'} · ${new Date(x.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` }),
        el('span', { text: [...new Set((x.campos || []).map((c) => NOMES_CAMPOS[c] || c))].join(', ') || 'Sem mudança' })))
        : [el('span', { class: 'jx-nota', text: 'Ninguém mudou ainda: vale o padrão.' })]));
    }, () => caixaHist.replaceChildren(el('span', { class: 'jx-nota', text: 'Não deu para ver o histórico agora.' })));
    carregarHist();
    const gHist = grupo('historico', 'Histórico', 'Quem mudou o jeito de atender e quando.', caixaHist);

    // ---------- montar
    const grupos = [gIdent, gTom, gMsg, gAg, gTab, gAv, gHist];
    const nomesGrupo = ['Identidade', 'Tom e estilo', 'Mensagens', 'Agendamento', 'Tabelas', 'Avançado', 'Histórico'];
    const rolo = el('div', { class: 'jx-rolo' },
      ...(dados.avisos || []).map((a) => el('div', { class: 'jx-aviso', text: a })),
      !pode ? el('div', { class: 'jx-aviso', text: 'Você pode ver, mas só a gestão e quem cuida da IA mudam o jeito de atender.' }) : null,
      erroGeral, ...grupos);
    const chips = grupos.map((g, i) => el('button', { class: 'jx-chip', type: 'button', text: nomesGrupo[i], 'aria-current': i === 0 ? 'true' : 'false', onclick: () => g.scrollIntoView({ behavior: 'smooth', block: 'start' }) }));
    const nav = el('nav', { class: 'jx-nav', 'aria-label': 'Partes do jeito de atender' }, ...chips);
    rolo.addEventListener('scroll', () => {
      const topo = rolo.getBoundingClientRect().top;
      let atual = 0;
      grupos.forEach((g, i) => { if (g.getBoundingClientRect().top - topo < 80) atual = i; });
      chips.forEach((c, i) => {
        const era = c.getAttribute('aria-current') === 'true';
        c.setAttribute('aria-current', String(i === atual));
        if (i === atual && !era && innerWidth < 900) c.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      });
    }, { passive: true });

    const dlg = el('dialog', { class: 'jx', 'aria-label': 'Jeito de atender' },
      el('div', { class: 'jx-topo' },
        el('button', { class: 'jx-link jx-esq', type: 'button', text: 'Fechar', onclick: () => fechar() }),
        el('h2', { text: 'Jeito de atender' }),
        el('span', { class: 'jx-dir' }, btnSalvar)),
      el('div', { class: 'jx-corpo' }, nav, rolo));
    const fechar = async () => {
      if (mudou() && pode && !window.confirm('Sair sem salvar as mudanças?')) return;
      dlg.close();
    };
    dlg.addEventListener('cancel', (e) => { if (mudou() && pode) { e.preventDefault(); fechar(); } });
    dlg.addEventListener('close', () => dlg.remove());

    btnSalvar.addEventListener('click', async () => {
      erroGeral.textContent = '';
      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Salvando…';
      const alt = {};
      for (const g of ['identidade', 'tom', 'mensagens', 'agendamento', 'avancado']) {
        for (const k of Object.keys(v.jeito[g])) {
          if (!igual(v.jeito[g][k], orig.jeito[g][k])) (alt[g] ||= {})[k] = v.jeito[g][k];
        }
      }
      if (alt.agendamento?.roteiro) alt.agendamento.roteiro = alt.agendamento.roteiro.map((x) => x.trim()).filter(Boolean);
      if (alt.mensagens?.modelos) alt.mensagens.modelos = alt.mensagens.modelos.filter((m) => m.titulo.trim() || m.texto.trim());
      const corpo = { jeito: alt };
      if ((v.nome || '').trim() !== (orig.nome || '').trim()) corpo.nome = (v.nome || '').trim();
      if (!igual(v.tabelas, orig.tabelas)) corpo.tabelas = v.tabelas;
      try {
        const r = await api('/api/ia/jeito', { method: 'PUT', body: JSON.stringify(corpo) });
        for (const u of v.unidades) {
          const antes = orig.unidades.find((x) => x.id === u.id);
          if (dados.podeEditarUnidades && antes && !igual(antes.horariosPadrao, u.horariosPadrao)) {
            await api(`/api/unidades/${encodeURIComponent(u.id)}`, { method: 'PATCH', body: JSON.stringify({ horariosPadrao: u.horariosPadrao }) });
            antes.horariosPadrao = [...u.horariosPadrao];
          }
        }
        orig.jeito = structuredClone(r.jeito); v.jeito = structuredClone(r.jeito);
        orig.nome = r.nome; v.nome = r.nome;
        orig.tabelas = { ...r.tabelas }; v.tabelas = { ...r.tabelas };
        pintarConf(); pintarModelos(); repintar.forEach((f) => f());
        toast('Salvo ✓ Vale na próxima resposta da IA.');
        carregarHist();
      } catch (x) {
        erroGeral.textContent = x.message || 'Não deu para salvar.';
        erroGeral.scrollIntoView({ block: 'nearest' });
      } finally {
        btnSalvar.textContent = 'Salvar';
        marcar();
      }
    });

    pintarPrevia();
    document.body.append(dlg);
    dlg.showModal();
    // Caixas de texto crescem com o conteúdo (até um limite), para ver os itens inteiros.
    dlg.addEventListener('input', (e) => { if (e.target instanceof HTMLTextAreaElement) crescer(e.target); });
    dlg.querySelectorAll('textarea').forEach(crescer);
  }

  window.SintoniaJeitoAtender = { cartao, abrir };
})();
