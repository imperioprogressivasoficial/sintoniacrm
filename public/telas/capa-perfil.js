/* capa-perfil (dono 21/11): capa com foto atrás do perfil e atalhos escolhidos por pessoa.
 * - Capa: 5 paisagens prontas (public/capas/, créditos em public/capas/CREDITOS.txt), "Sem foto (só a cor)" ou a foto
 *   da própria pessoa (reduzida aqui para ~1200 px, WebP ou JPEG, até 400 KB; servidor: PUT/DELETE /api/conta/capa).
 * - Atalhos: os redondos de Configurações no celular, até 8, na ordem que a pessoa quiser (setas para subir/descer).
 * Tudo fica em /api/conta (preferencias.capa e preferencias.atalhos): vale em qualquer aparelho.
 * Registra window.SintoniaCapaPerfil = { carregar, prefs, pintar, trocarCapa, editarAtalhos, faixa }.
 * Avisa as telas com o evento "sintonia:capa-perfil" quando algo muda. Sem animação em loop. */
(() => {
  const CAPAS = [
    { id: 'montanha', nome: 'Montanha' },
    { id: 'praia', nome: 'Praia' },
    { id: 'por-do-sol', nome: 'Pôr do sol' },
    { id: 'floresta', nome: 'Floresta' },
    { id: 'cidade', nome: 'Cidade à noite' },
  ];
  const PADRAO = { capa: 'montanha', atalhos: ['atendimento:agenda', 'atendimento:respostas-rapidas', 'atendimento:rotina', 'aba:serena'], capaEm: null };
  const MAX = 8, LIMITE = 400 * 1024, CHAVE = 'sintonia.capa-perfil';
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    imagem: I('<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/>'),
    cima: I('<path d="m6 15 6-6 6 6"/>'),
    baixo: I('<path d="m6 9 6 6 6-6"/>'),
    tirar: I('<path d="M6 6l12 12M18 6 6 18"/>'),
    mais: I('<path d="M12 5v14M5 12h14"/>'),
    certo: I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    enviar: I('<path d="M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  };
  const CSS = `
  .cp-fundo { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
  .cp-fundo img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cp-fundo::after { content: ""; position: absolute; inset: 0;
    background: linear-gradient(180deg, rgba(6,18,38,.56) 0%, rgba(8,26,54,.2) 45%, rgba(6,18,38,.6) 100%), linear-gradient(160deg, rgba(13,34,64,.22), rgba(16,110,190,.06)); }
  html[data-tema="escuro"] .cp-fundo::after { background: linear-gradient(180deg, rgba(3,10,24,.7) 0%, rgba(4,14,32,.4) 45%, rgba(3,10,24,.8) 100%); }
  .cp-trocar { all: unset; box-sizing: border-box; cursor: pointer; position: absolute; z-index: 2; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 9px;
    border-radius: 999px; font-size: 12.5px; font-weight: 600; color: #fff; background: rgba(6,18,38,.42); box-shadow: inset 0 0 0 1px rgba(255,255,255,.22); -webkit-tap-highlight-color: transparent; }
  .cp-trocar svg { width: 16px; height: 16px; }
  .cp-trocar:active { background: rgba(6,18,38,.6); }
  .cp-trocar:focus-visible { outline: 2px solid #0ffcbe; outline-offset: 2px; }
  /* seletor de capa */
  .cp-grade { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .cp-op { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 6px; font-size: 13.5px; font-weight: 600; color: var(--texto); -webkit-tap-highlight-color: transparent; }
  .cp-op .cp-mini { position: relative; aspect-ratio: 5 / 3; border-radius: 14px; overflow: hidden; background: linear-gradient(160deg, #0d2240 0%, #123a6b 58%, #106ebe 100%); box-shadow: inset 0 0 0 1px var(--linha); }
  .cp-op .cp-mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cp-op[aria-checked="true"] .cp-mini { box-shadow: 0 0 0 2.5px var(--fundo), 0 0 0 4.5px #106ebe; }
  .cp-op .cp-marca { position: absolute; right: 8px; top: 8px; width: 26px; height: 26px; border-radius: 50%; display: none; place-items: center; background: #106ebe; color: #fff; }
  .cp-op .cp-marca svg { width: 16px; height: 16px; }
  .cp-op[aria-checked="true"] .cp-marca { display: grid; }
  .cp-op:focus-visible .cp-mini { outline: 2px solid #106ebe; outline-offset: 3px; }
  .cp-op.cp-envio .cp-mini { display: grid; place-items: center; background: color-mix(in srgb, #106ebe 8%, var(--fundo)); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #106ebe 35%, transparent); color: #106ebe; }
  html[data-tema="escuro"] .cp-op.cp-envio .cp-mini { background: rgba(255,255,255,.05); color: #6bb8ff; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.2); }
  .cp-op.cp-envio .cp-mini svg { width: 28px; height: 28px; }
  .cp-dica { margin: 14px 2px 0; font-size: 12.5px; color: var(--sub); line-height: 1.45; }
  .cp-link { all: unset; cursor: pointer; display: inline-block; margin-top: 12px; font-size: 14px; font-weight: 600; color: #dc2626; }
  .cp-ocupado { opacity: .55; pointer-events: none; }
  /* editor de atalhos */
  .cp-sec { margin: 18px 2px 8px; font-size: 13px; font-weight: 700; color: var(--texto); display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .cp-sec:first-child { margin-top: 2px; }
  .cp-sec small { font-weight: 500; color: var(--sub); font-size: 12.5px; }
  .cp-lista { display: grid; border-radius: 16px; overflow: hidden; background: var(--painel, var(--fundo)); box-shadow: inset 0 0 0 1px var(--linha); }
  .cp-linha { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 4px 6px 4px 14px; border-bottom: 1px solid var(--linha); }
  .cp-linha:last-child { border-bottom: 0; }
  .cp-linha .cp-ic { width: 34px; height: 34px; border-radius: 50%; flex: none; display: grid; place-items: center; color: #106ebe; background: color-mix(in srgb, #106ebe 9%, var(--fundo)); }
  html[data-tema="escuro"] .cp-linha .cp-ic { color: #6bb8ff; background: rgba(255,255,255,.07); }
  .cp-linha .cp-ic svg { width: 18px; height: 18px; }
  .cp-linha .cp-nome { flex: 1; min-width: 0; display: grid; gap: 1px; }
  .cp-linha .cp-nome b { font-size: 15px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-linha .cp-nome small { font-size: 12px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-bt { all: unset; box-sizing: border-box; cursor: pointer; flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--texto); -webkit-tap-highlight-color: transparent; }
  .cp-bt svg { width: 20px; height: 20px; }
  .cp-bt:active { background: var(--sel, rgba(13,34,64,.08)); }
  .cp-bt:disabled { opacity: .28; cursor: default; }
  .cp-bt:focus-visible { outline: 2px solid #106ebe; outline-offset: -2px; }
  .cp-bt.cp-x { color: #dc2626; }
  .cp-bt.cp-add { color: #106ebe; }
  html[data-tema="escuro"] .cp-bt.cp-add { color: #6bb8ff; }
  .cp-vazio { padding: 16px 14px; font-size: 14px; color: var(--sub); }
  .cp-ja { flex: none; font-size: 12px; color: var(--sub); padding: 0 10px; }
  /* faixa da Conta (computador e celular) */
  .cp-faixa { position: relative; overflow: hidden; border-radius: 22px; min-height: 150px; padding: 18px 20px; display: flex; align-items: flex-end; gap: 14px; color: #fff;
    background: linear-gradient(160deg, #0d2240 0%, #123a6b 58%, #106ebe 100%); }
  html[data-tema="escuro"] .cp-faixa { background: linear-gradient(160deg, #06142a 0%, #0c2a52 60%, #0d5aa0 100%); }
  .cp-faixa > :not(.cp-fundo) { position: relative; z-index: 1; }
  .cp-faixa > .cp-trocar { position: absolute; top: 14px; right: 14px; }
  .cp-faixa .cp-rosto { width: 64px; height: 64px; border-radius: 50%; flex: none; overflow: hidden; display: grid; place-items: center; font-size: 22px; font-weight: 700;
    background: linear-gradient(135deg, #1a8be0, #0a4c86); box-shadow: 0 0 0 2.5px rgba(255,255,255,.85); }
  .cp-faixa .cp-rosto img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cp-faixa .cp-quem { display: grid; gap: 2px; min-width: 0; }
  .cp-faixa .cp-quem b { font-size: 20px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cp-faixa .cp-quem small { font-size: 13.5px; color: rgba(255,255,255,.78); }
  @media (min-width: 761px) { .cp-faixa { min-height: 180px; padding: 22px 26px; } .cp-faixa .cp-rosto { width: 76px; height: 76px; font-size: 26px; } .cp-grade { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `;
  const css = () => { if (!document.getElementById('cp-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'cp-css', textContent: CSS })); };
  const ui = () => window.Sintonia?.ui;
  const el = (...a) => ui().el(...a);
  const avisar = () => dispatchEvent(new Event('sintonia:capa-perfil'));

  // ------------------------------------------------------------ preferências (servidor + cópia neste aparelho para pintar já)
  let atual = null, carregando = null, salvando = Promise.resolve();
  const euId = () => ui()?.estado?.eu?.id || '';
  const lerLocal = () => { try { const j = JSON.parse(localStorage.getItem(CHAVE) || 'null'); return j && j.id === euId() ? j : null; } catch { return null; } };
  const guardarLocal = () => { try { localStorage.setItem(CHAVE, JSON.stringify({ ...atual, id: euId() })); } catch {} };
  function usar(conta) {
    if (!conta?.preferencias) return;
    const novo = { capa: conta.preferencias.capa || PADRAO.capa, atalhos: Array.isArray(conta.preferencias.atalhos) ? conta.preferencias.atalhos : PADRAO.atalhos, capaEm: conta.capaEm || null };
    const mudou = JSON.stringify(novo) !== JSON.stringify(atual);
    atual = novo; guardarLocal();
    if (mudou) avisar();
  }
  function prefs() { if (!atual) atual = lerLocal(); return atual || PADRAO; }
  function carregar(forcar) {
    if (carregando && !forcar) return carregando;
    carregando = ui().api('/api/conta').then((c) => { usar(c); return prefs(); }).catch(() => prefs());
    return carregando;
  }
  function salvar(mudanca) {
    salvando = salvando.then(() => ui().api('/api/conta', { method: 'PATCH', body: JSON.stringify({ preferencias: mudanca }) }).then(usar))
      .catch((x) => { ui().toast(x.message || 'Não deu para salvar agora.'); carregar(true); });
    return salvando;
  }

  // ------------------------------------------------------------ capa
  const urlCapa = (p = prefs(), mini = false) => {
    if (p.capa === 'nenhuma') return null;
    if (p.capa === 'minha') return p.capaEm ? `/api/conta/capa?v=${p.capaEm}` : null;
    const c = CAPAS.find((x) => x.id === p.capa) || CAPAS[0];
    return `/capas/${c.id}${mini ? '-mini' : ''}.webp`;
  };
  /** Põe a foto (com o véu escuro por cima) no fundo de uma caixa: a capa de Configurações ou a faixa da Conta. */
  function pintar(caixa) {
    if (!caixa) return;
    css();
    const url = urlCapa();
    let fundo = caixa.querySelector(':scope > .cp-fundo');
    caixa.dataset.capa = prefs().capa;
    if (!url) { fundo?.remove(); return; }
    if (!fundo) { fundo = el('span', { class: 'cp-fundo', 'aria-hidden': 'true' }); caixa.prepend(fundo); }
    const img = fundo.querySelector('img');
    if (img && img.getAttribute('src') === url) return;
    const nova = el('img', { alt: '', decoding: 'async', src: url });
    nova.addEventListener('error', () => fundo.remove());
    fundo.replaceChildren(nova);
  }
  const botaoTrocar = () => { css(); return el('button', { class: 'cp-trocar', type: 'button', 'aria-label': 'Trocar a foto da capa', title: 'Trocar capa', onclick: (e) => { e.stopPropagation(); trocarCapa(); } }, el('span', { html: IC.imagem, 'aria-hidden': 'true' }), document.createTextNode('Capa')); };

  /** Reduz a foto escolhida para no máximo 1200 x 700 (corta no centro se for muito alta) e comprime até caber em 400 KB. */
  async function reduzir(arq) {
    const bmp = await createImageBitmap(arq);
    const L = Math.min(1200, bmp.width), alvoProp = 1200 / 700;
    let sw = bmp.width, sh = bmp.height, sx = 0, sy = 0;
    if (sw / sh < alvoProp) { sh = Math.round(sw / alvoProp); sy = Math.round((bmp.height - sh) / 2); }
    const tela = Object.assign(document.createElement('canvas'), { width: L, height: Math.round(L * (sh / sw)) });
    tela.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, tela.width, tela.height);
    bmp.close?.();
    // WebP quando o navegador sabe gerar (o Safari antigo devolve PNG: aí vai JPEG).
    const webp = tela.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
    const tipo = webp ? 'image/webp' : 'image/jpeg';
    for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
      const base64 = tela.toDataURL(tipo, q).split(',')[1];
      if (base64.length * 0.75 <= LIMITE - 4096) return { base64, mimetype: tipo };
    }
    throw new Error('Essa foto ficou grande demais. Tente outra.');
  }

  function trocarCapa() {
    css();
    window.SintoniaPainel.abrir({ id: 'capa-perfil', titulo: 'Foto da capa', montar: (corpo) => {
      const desenhar = () => {
        const p = prefs();
        const op = (id, nome, conteudo) => el('button', { class: 'cp-op', type: 'button', role: 'radio', 'aria-checked': String(p.capa === id), onclick: () => escolher(id) },
          el('span', { class: 'cp-mini' }, conteudo, el('span', { class: 'cp-marca', html: IC.certo, 'aria-hidden': 'true' })), document.createTextNode(nome));
        const grade = el('div', { class: 'cp-grade', role: 'radiogroup', 'aria-label': 'Escolha a capa' },
          ...CAPAS.map((c) => op(c.id, c.nome, el('img', { src: `/capas/${c.id}-mini.webp`, alt: '', loading: 'lazy', decoding: 'async' }))),
          op('nenhuma', 'Sem foto (só a cor)', null),
          p.capaEm ? op('minha', 'Minha foto', el('img', { src: `/api/conta/capa?v=${p.capaEm}`, alt: '', decoding: 'async' })) : null,
          el('button', { class: 'cp-op cp-envio', type: 'button', onclick: enviar }, el('span', { class: 'cp-mini', html: IC.enviar }), document.createTextNode(p.capaEm ? 'Trocar minha foto' : 'Enviar minha foto')));
        corpo.replaceChildren(...[grade,
          el('p', { class: 'cp-dica', text: 'A capa aparece atrás do seu nome em Configurações e na sua Conta. Só você vê. Fotos de paisagem do Unsplash, de uso livre.' }),
          p.capaEm ? el('button', { class: 'cp-link', type: 'button', text: 'Apagar minha foto', onclick: apagar }) : null].filter(Boolean));
      };
      const ocupado = (sim) => corpo.classList.toggle('cp-ocupado', sim);
      async function escolher(id) {
        if (prefs().capa === id) return;
        atual = { ...prefs(), capa: id }; avisar(); desenhar();
        await salvar({ capa: id }); desenhar();
      }
      function enviar() {
        const entrada = el('input', { type: 'file', accept: 'image/*' });
        entrada.addEventListener('change', async () => {
          const arq = entrada.files?.[0]; if (!arq) return;
          ocupado(true);
          try {
            const foto = await reduzir(arq);
            const c = await ui().api('/api/conta/capa', { method: 'PUT', body: JSON.stringify(foto) });
            usar(c); ui().toast('Capa salva ✓');
          } catch (x) { ui().toast(x.message || 'Não deu para usar essa foto.'); }
          ocupado(false); desenhar();
        });
        entrada.click();
      }
      async function apagar() {
        ocupado(true);
        try { usar(await ui().api('/api/conta/capa', { method: 'DELETE' })); ui().toast('Sua foto de capa foi apagada.'); } catch (x) { ui().toast(x.message); }
        ocupado(false); desenhar();
      }
      desenhar();
    } });
  }

  // ------------------------------------------------------------ atalhos
  /** catalogo: [{ id, nome, curto?, sub?, ic, secao, acao }] — só o que a pessoa pode abrir (a tela de Configurações monta). */
  function editarAtalhos(catalogo) {
    css();
    const porId = new Map(catalogo.map((c) => [c.id, c]));
    window.SintoniaPainel.abrir({ id: 'atalhos', titulo: 'Editar atalhos', montar: (corpo) => {
      const meus = () => prefs().atalhos.filter((id) => porId.has(id));
      const mudar = (lista) => { atual = { ...prefs(), atalhos: lista }; avisar(); desenhar(); salvar({ atalhos: lista }); };
      const ic = (c) => el('span', { class: 'cp-ic', html: c.ic || IC.mais, 'aria-hidden': 'true' });
      function desenhar() {
        const lista = meus(), cheio = lista.length >= MAX;
        const linhasMeus = lista.map((id, i) => {
          const c = porId.get(id);
          const mover = (d) => { const l = [...lista]; [l[i], l[i + d]] = [l[i + d], l[i]]; mudar(l); };
          return el('div', { class: 'cp-linha' }, ic(c), el('span', { class: 'cp-nome' }, el('b', { text: c.nome }), el('small', { text: c.secao })),
            el('button', { class: 'cp-bt', type: 'button', 'aria-label': `Subir ${c.nome}`, title: 'Subir', html: IC.cima, ...(i === 0 ? { disabled: '' } : {}), onclick: () => mover(-1) }),
            el('button', { class: 'cp-bt', type: 'button', 'aria-label': `Descer ${c.nome}`, title: 'Descer', html: IC.baixo, ...(i === lista.length - 1 ? { disabled: '' } : {}), onclick: () => mover(1) }),
            el('button', { class: 'cp-bt cp-x', type: 'button', 'aria-label': `Tirar ${c.nome} dos atalhos`, title: 'Tirar', html: IC.tirar, onclick: () => mudar(lista.filter((x) => x !== id)) }));
        });
        const secoes = [];
        for (const c of catalogo) { let s = secoes.find((x) => x.nome === c.secao); if (!s) secoes.push(s = { nome: c.secao, itens: [] }); s.itens.push(c); }
        const rolagem = corpo.closest('.pl-corpo'); const y = rolagem?.scrollTop || 0;
        corpo.replaceChildren(...[
          el('p', { class: 'cp-sec' }, document.createTextNode('Seus atalhos'), el('small', { text: `${lista.length} de ${MAX}` })),
          el('div', { class: 'cp-lista' }, ...(linhasMeus.length ? linhasMeus : [el('p', { class: 'cp-vazio', text: 'Nenhum atalho. Escolha abaixo o que você mais usa.' })])),
          el('p', { class: 'cp-dica', text: cheio ? `Você já tem ${MAX} atalhos. Tire um para pôr outro.` : 'Use as setas para mudar a ordem. Os atalhos aparecem em Configurações, abaixo da busca.' }),
          lista.join() === PADRAO.atalhos.filter((id) => porId.has(id)).join() ? null : el('button', { class: 'cp-link', type: 'button', style: 'color:#106ebe', text: 'Voltar aos atalhos de sempre', onclick: () => mudar([...PADRAO.atalhos]) }),
          ...secoes.flatMap((s) => [
            el('p', { class: 'cp-sec', text: s.nome }),
            el('div', { class: 'cp-lista' }, ...s.itens.map((c) => {
              const tem = lista.includes(c.id);
              return el('div', { class: 'cp-linha' }, ic(c), el('span', { class: 'cp-nome' }, el('b', { text: c.nome }), c.sub ? el('small', { text: c.sub }) : null),
                tem ? el('span', { class: 'cp-ja', text: 'Já está' })
                  : el('button', { class: 'cp-bt cp-add', type: 'button', 'aria-label': `Pôr ${c.nome} nos atalhos`, title: 'Adicionar', html: IC.mais, ...(cheio ? { disabled: '' } : {}), onclick: () => mudar([...lista, c.id]) }));
            })),
          ])].filter(Boolean));
        if (rolagem) rolagem.scrollTop = y;
      }
      desenhar();
    } });
  }

  // ------------------------------------------------------------ faixa da Conta (Perfil): capa + rosto + nome
  function faixa(conta) {
    css();
    if (conta) usar(conta);
    const rosto = el('span', { class: 'cp-rosto' });
    const url = window.SintoniaFotos?.url?.(conta?.id);
    if (url) rosto.append(el('img', { src: url, alt: '' })); else rosto.textContent = String(conta?.nome || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
    const caixa = el('div', { class: 'cp-faixa' }, rosto, el('span', { class: 'cp-quem' }, el('b', { text: conta?.nome || '' }), el('small', { text: conta?.papelNome || '' })), botaoTrocar());
    pintar(caixa);
    const aoMudar = () => { if (!caixa.isConnected) { removeEventListener('sintonia:capa-perfil', aoMudar); return; } pintar(caixa); };
    addEventListener('sintonia:capa-perfil', aoMudar);
    return caixa;
  }

  window.SintoniaCapaPerfil = { CAPAS, PADRAO, MAX, carregar, prefs, usar, pintar, botaoTrocar, trocarCapa, editarAtalhos, faixa, urlCapa };
})();
