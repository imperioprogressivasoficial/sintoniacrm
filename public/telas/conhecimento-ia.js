/* conhecimento-arquivo (dono 28/11): Empresa › Documentos › Conhecimento da IA — tudo o que a IA sabe agora, em 4 partes
 * (base de conhecimento, o que aprendeu com a equipe, documentos que estudou e regras fixas), lido na hora de
 * GET /api/ia/conhecimento (src/aprender/conhecimento.ts). Baixar (.md / .txt), copiar e buscar dentro do texto.
 * Só a gestão (mesma permissão do Treinamento da IA). Usa as peças de telas/empresa.js (window.SintoniaEC).
 * Texto do servidor entra sempre por textContent / createTextNode. */
(() => {
  const CSS = `
  .cia-cartao { position: relative; overflow: hidden; }
  .cia-cartao::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 1.5px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); opacity: .9; pointer-events: none; }
  .cia-cartao .cia-ico, .cia .cia-ico { background: linear-gradient(135deg, #106ebe, #3aa0ff); color: #fff; }
  .cia-nums { display: flex; flex-wrap: wrap; gap: 6px; }
  .cia { display: grid; gap: 14px; min-width: 0; }
  .cia-topo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .cia-topo > div { flex: 1 1 220px; min-width: 0; display: grid; gap: 2px; }
  .cia-topo h2 { margin: 0; font-size: 20px; letter-spacing: -.01em; }
  .cia-topo p { margin: 0; font-size: 13px; color: var(--sub); }
  @media (max-width: 760px) { .cia-topo { flex-wrap: nowrap; } .cia-topo > .cia-ico { display: none; } .cia-topo > div { flex: 1 1 0; } .cia-topo h2 { font-size: 18px; } .cia-topo p { font-size: 12px; } }
  .cia-barra { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .cia-barra .ec-busca { flex: 1 1 260px; }
  .cia-barra .ec-acoes { flex: none; }
  @media (max-width: 760px) { .cia-barra .ec-acoes { width: 100%; } .cia-barra .ec-acoes .ec-bt { flex: 1 1 0; padding: 0 8px; } }
  .cia-achou { margin: 0; font-size: 13px; color: var(--sub); }
  .cia-parte h2 .ec-pil { margin-left: auto; }
  .cia-bloco { display: grid; gap: 4px; padding: 12px 0 0; border-top: 1px solid var(--ec-borda); min-width: 0; }
  .cia-parte > .cia-bloco:first-of-type { border-top: 0; padding-top: 4px; }
  .cia-bloco > b { font-size: 14.5px; overflow-wrap: anywhere; }
  .cia-bloco > small { font-size: 12px; color: var(--sub); overflow-wrap: anywhere; }
  .cia-texto { margin: 0; font-size: 14px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--texto); }
  .cia mark { background: rgba(15, 252, 190, .45); color: inherit; border-radius: 3px; padding: 0 1px; }
  html[data-tema="escuro"] .cia mark { background: rgba(15, 252, 190, .3); }
  .cia-doc { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--ec-borda); font-size: 14px; min-width: 0; }
  .cia-doc:first-of-type { border-top: 0; }
  .cia-doc span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .cia-doc small { flex: none; color: var(--sub); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  `;
  const S = (d) => `<svg class="ec-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    ia: S('<path d="M12 3.5 13.9 8.6 19 10.5 13.9 12.4 12 17.5 10.1 12.4 5 10.5 10.1 8.6Z"/><path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7Z"/>'),
    base: S('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 7h8M8 11h6"/>'),
    aprendido: S('<path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Z"/><path d="M7 11.5V16c0 1.4 2.2 3 5 3s5-1.6 5-3v-4.5M21 9.5V15"/>'),
    documentos: S('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    regras: S('<path d="M9 5h11M9 12h11M9 19h11"/><path d="m3.5 5 1.2 1.2L7 4M3.5 12l1.2 1.2L7 11M3.5 19l1.2 1.2L7 18"/>'),
    voltar: S('<path d="m15 18-6-6 6-6"/>'),
    txt: S('<path d="M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>'),
  };
  const NUM = { base: 'seção', aprendido: 'aprendizado', documentos: 'documento', regras: 'regra' };
  const NUMS = { base: 'seções', aprendido: 'aprendizados', documentos: 'documentos', regras: 'regras' };
  const plural = (n, id) => `${n} ${n === 1 ? NUM[id] : NUMS[id]}`;
  const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const data = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '');
  const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const css = () => { if (!document.getElementById('cia-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'cia-css', textContent: CSS })); };
  const EC = () => window.SintoniaEC;

  /** Linha de detalhe de um bloco: data · quem · de onde veio. */
  const detalhe = (parte, b) => {
    if (parte.id === 'documentos') return b.em ? `Enviado em ${data(b.em)}` : '';
    if (parte.id === 'regras') return '';
    return [b.em ? `${parte.id === 'base' ? 'Atualizada' : 'Aprendido'} em ${data(b.em)}` : '', b.por || '', b.origem || ''].filter(Boolean).join(' · ');
  };

  // ------------------------------------------------------------ .md e .txt
  function emMarkdown(c, empresa) {
    const l = [`# Conhecimento da IA${empresa ? ` — ${empresa}` : ''}`, '', `Atualizado em ${dataHora(c.atualizadoEm) || '—'} · baixado em ${dataHora(c.geradoEm)}`, ''];
    c.partes.forEach((p, i) => {
      l.push(`## ${i + 1}. ${p.titulo}`, '', `_${p.descricao}_`, '');
      if (!p.blocos.length) { l.push('(nada ainda)', ''); return; }
      if (p.id === 'documentos') { for (const b of p.blocos) l.push(`- ${b.titulo} (${detalhe(p, b)})`); l.push(''); return; }
      if (p.id === 'regras') { for (const b of p.blocos) l.push(`- **${b.titulo}:** ${b.texto}`); l.push(''); return; }
      for (const b of p.blocos) {
        const d = detalhe(p, b);
        l.push(`### ${b.titulo}`, ...(d ? [`_${d}_`] : []), ...(p.id === 'aprendido' && b.grupo && b.grupo !== b.titulo ? [`Tipo: ${b.grupo}`] : []), '', b.texto || '', '');
      }
    });
    return l.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function emTexto(c, empresa) {
    const sub = (t, ch) => `${t}\n${ch.repeat(Math.min(60, Math.max(8, t.length)))}`;
    const l = [sub(`CONHECIMENTO DA IA${empresa ? ` — ${empresa.toUpperCase()}` : ''}`, '='), `Atualizado em ${dataHora(c.atualizadoEm) || '—'} · baixado em ${dataHora(c.geradoEm)}`, ''];
    c.partes.forEach((p, i) => {
      l.push('', sub(`${i + 1}. ${p.titulo.toUpperCase()}`, '='), p.descricao, '');
      if (!p.blocos.length) { l.push('(nada ainda)'); return; }
      if (p.id === 'documentos') { for (const b of p.blocos) l.push(`- ${b.titulo} (${detalhe(p, b)})`); return; }
      if (p.id === 'regras') { for (const b of p.blocos) l.push(`- ${b.titulo}: ${b.texto}`); return; }
      for (const b of p.blocos) {
        const d = [detalhe(p, b), p.id === 'aprendido' && b.grupo !== b.titulo ? b.grupo : ''].filter(Boolean).join(' · ');
        l.push(sub(b.titulo, '-'), ...(d ? [`(${d})`] : []), b.texto || '', '');
      }
    });
    return l.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  const nomeArquivo = (ext) => `conhecimento-da-ia-${new Date().toISOString().slice(0, 10)}.${ext}`;
  function baixar(texto, ext, tipo) {
    const url = URL.createObjectURL(new Blob([texto], { type: `${tipo};charset=utf-8` }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nomeArquivo(ext) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); return true; } catch {}
    const t = Object.assign(document.createElement('textarea'), { value: texto });
    t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    t.remove();
    return ok;
  }

  // ------------------------------------------------------------ busca com destaque (sem innerHTML)
  /** Texto com os trechos achados em <mark>. Ignora acento e maiúscula. */
  function marcado(texto, termo) {
    const s = String(texto || '');
    if (!termo) return [document.createTextNode(s)];
    let norm = ''; const pos = [];
    for (let i = 0; i < s.length; i++) { const n = normal(s[i]); for (let k = 0; k < n.length; k++) pos.push(i); norm += n; }
    const out = []; let de = 0; let i = norm.indexOf(termo);
    while (i >= 0 && termo) {
      const a = pos[i]; const b = (pos[i + termo.length - 1] ?? a) + 1;
      if (a > de) out.push(document.createTextNode(s.slice(de, a)));
      const m = document.createElement('mark'); m.textContent = s.slice(a, b); out.push(m);
      de = b; i = norm.indexOf(termo, i + termo.length);
    }
    if (de < s.length) out.push(document.createTextNode(s.slice(de)));
    return out;
  }
  const comTermo = (tag, cls, texto, termo) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...marcado(texto, termo)); return e; };

  // ------------------------------------------------------------ cartão em Empresa › Documentos
  /** Cartão de entrada (gestão). Devolve null se a pessoa não pode ver (403) ou a função não existe aqui. */
  async function cartao(ui, abrir, empresa = '') {
    css();
    const c = await ui.api('/api/ia/conhecimento').catch(() => null);
    if (!c?.partes) return null;
    const { el, botao } = { el: ui.el, botao: EC().botao };
    const nums = el('div', { class: 'cia-nums' }, ...c.partes.map((p) => el('span', { class: 'ec-pil azul', text: plural(p.blocos.length, p.id) })));
    return el('section', { class: 'ec-c cia-cartao' },
      el('h2', {}, el('span', { class: 'ec-ico cia-ico', html: IC.ia }), el('span', { class: 'ec-h2t', text: 'Conhecimento da IA' })),
      el('p', { class: 'ec-sub', text: 'Tudo o que a IA sabe agora, num lugar só: a base do treinamento, o que ela aprendeu com a equipe, os documentos que estudou e as regras de atendimento. Sempre atualizado; dá para baixar e usar depois.' }),
      nums,
      el('p', { class: 'ec-sub', text: c.atualizadoEm ? `Última atualização: ${dataHora(c.atualizadoEm)}` : 'Ainda sem mudanças registradas.' }),
      el('div', { class: 'ec-acoes' },
        botao('Abrir', () => abrir(c), 'azul', 'seta'),
        botao('Baixar (.md)', () => baixar(emMarkdown(c, empresa), 'md', 'text/markdown'), '', 'baixar')));
  }

  // ------------------------------------------------------------ tela completa
  async function desenhar(corpo, ui, o = {}) {
    css();
    const { botao } = EC();
    const el = ui.el;
    let c = o.dados || null;
    if (!c) {
      corpo.replaceChildren(el('p', { class: 'ec-carregando', text: 'Carregando…' }));
      try { c = await ui.api('/api/ia/conhecimento'); } catch (x) { corpo.replaceChildren(el('p', { class: 'ec-erro', text: x.message || 'Não deu para carregar agora.' })); return; }
    }
    if (!corpo.isConnected && o.dados == null) return;
    const empresa = o.empresa || '';
    let termo = '';
    let filtro = '';
    const lista = el('div', { style: 'display:grid;gap:14px;min-width:0' });
    const achou = el('p', { class: 'cia-achou', role: 'status' });

    const casa = (b) => !termo || normal(`${b.titulo}\n${b.texto}\n${b.grupo || ''}\n${b.origem || ''}`).includes(termo);
    function pintar() {
      let total = 0;
      const partes = c.partes.filter((p) => !filtro || p.id === filtro).map((p) => {
        const blocos = p.blocos.filter(casa);
        total += blocos.length;
        if (termo && !blocos.length) return null;
        const sec = el('section', { class: 'ec-c cia-parte', id: `cia-${p.id}` },
          el('h2', {}, el('span', { class: 'ec-ico', html: IC[p.id] }), el('span', { class: 'ec-h2t', text: p.titulo }), el('span', { class: 'ec-pil', text: termo ? `${blocos.length} de ${p.blocos.length}` : String(p.blocos.length) })),
          el('p', { class: 'ec-sub', text: p.descricao }));
        if (!blocos.length) { sec.append(el('p', { class: 'ec-sub', text: p.id === 'aprendido' ? 'Nada aprendido com a equipe ainda. Em Treinamento da IA › Aprender com a equipe ela estuda as conversas.' : p.id === 'documentos' ? 'Nenhum documento enviado para a IA estudar ainda.' : 'Nada aqui ainda.' })); return sec; }
        if (p.id === 'documentos') {
          for (const b of blocos) { const d = el('div', { class: 'cia-doc' }, el('span', { class: 'ec-ico', html: IC.documentos })); d.append(comTermo('span', '', b.titulo, termo), el('small', { text: data(b.em) })); sec.append(d); }
          return sec;
        }
        for (const b of blocos) {
          const bl = el('div', { class: 'cia-bloco' });
          bl.append(comTermo('b', '', b.titulo, termo));
          const d = [detalhe(p, b), p.id === 'aprendido' && b.grupo !== b.titulo ? b.grupo : ''].filter(Boolean).join(' · ');
          if (d) bl.append(el('small', { text: d }));
          if (b.texto) bl.append(comTermo('p', 'cia-texto', b.texto, termo));
          sec.append(bl);
        }
        return sec;
      }).filter(Boolean);
      lista.replaceChildren(...partes);
      achou.textContent = termo ? (total ? `${total} ${total === 1 ? 'trecho encontrado' : 'trechos encontrados'}` : 'Nada encontrado com esse texto.') : '';
      if (termo && !total) lista.replaceChildren(el('section', { class: 'ec-c' }, EC().vazio('busca', 'Nada encontrado', 'Tente outra palavra. A busca olha títulos e textos de todas as partes.')));
    }

    const busca = el('input', { type: 'search', placeholder: 'Buscar no conhecimento (ex.: preço, horário, unidade)', 'aria-label': 'Buscar no conhecimento da IA' });
    let espera;
    busca.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { termo = normal(busca.value.trim()); pintar(); }, 150); });
    const abas = EC().abas([['', 'Tudo', ''], ...c.partes.map((p) => [p.id, `${p.titulo.replace('O que aprendeu com a equipe', 'Aprendido').replace('Base de conhecimento', 'Base').replace('Documentos que ela estudou', 'Documentos').replace('Regras de atendimento', 'Regras')} · ${p.blocos.length}`, ''])], filtro, (id) => {
      filtro = id; abas.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String((i === 0 ? '' : c.partes[i - 1].id) === id))); pintar();
    });
    const btCopiar = botao('Copiar', async () => { const ok = await copiar(emMarkdown(c, empresa)); ui.toast(ok ? 'Copiado ✓' : 'Não deu para copiar. Use o Baixar.'); }, 'mini', 'copiar');
    corpo.replaceChildren(el('div', { class: 'cia' },
      el('div', { class: 'cia-topo' },
        o.voltar ? botao('', o.voltar, 'icone', IC.voltar) : null,
        el('span', { class: 'ec-ico cia-ico', html: IC.ia }),
        el('div', {}, el('h2', { text: 'Conhecimento da IA' }), el('p', { text: `Última atualização: ${dataHora(c.atualizadoEm) || '—'} · lido agora às ${new Date(c.geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` })),
        botao('Atualizar', () => desenhar(corpo, ui, { ...o, dados: null }), 'mini')),
      el('div', { class: 'cia-barra' },
        el('label', { class: 'ec-busca', html: EC().IC.busca }, busca),
        el('div', { class: 'ec-acoes' },
          botao('Baixar tudo (.md)', () => baixar(emMarkdown(c, empresa), 'md', 'text/markdown'), 'mini azul', 'baixar'),
          botao('Baixar (.txt)', () => baixar(emTexto(c, empresa), 'txt', 'text/plain'), 'mini', IC.txt),
          btCopiar)),
      abas, achou, lista));
    const voltarBt = corpo.querySelector('.cia-topo .ec-bt.icone'); if (voltarBt) voltarBt.setAttribute('aria-label', 'Voltar para Documentos');
    pintar();
  }

  window.SintoniaConhecimentoIA = { cartao, desenhar, emMarkdown, emTexto };
})();
