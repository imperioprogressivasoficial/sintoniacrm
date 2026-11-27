/* ia-aprende: "Aprender com a equipe" dentro de Inteligência › Treinamento.
 * window.SintoniaTelas.aprender.cartao(ui) devolve o cartão que fica no Treinamento (resumo + "Enviar PDF ou texto");
 * tocar nele abre a tela cheia: estudar as conversas agora, andamento, chave "Aprender sozinha", propostas para aprovar
 * (aprovar / editar e aprovar / recusar) e "O que a IA aprendeu" (desfazer).
 * Tudo que vem do servidor (e da IA) entra por textContent (el(..., { text })), nunca como HTML. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const SVG = {
    livro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5 12 3l8 3.5-8 3.5Z"/><path d="M7 8.5v5c0 1.7 2.2 3 5 3s5-1.3 5-3v-5"/><path d="M20 6.5V12"/></svg>',
    arquivo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20Z"/><path d="M14 3.5V8h4"/><path d="M12 11v6M9.5 13.5 12 11l2.5 2.5"/></svg>',
    seta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    brilho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7Z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4.5M12 17.2v.1"/></svg>',
  };
  const CATEGORIA = { roteiro: 'Como conduz até agendar', tom: 'Jeito de escrever', pergunta: 'Pergunta frequente', objecao: 'Objeção', fato: 'Informação do negócio', evitar: 'O que evitar' };

  const CSS = `
  .apx-cartao { background: var(--fundo); border: 1px solid var(--linha); border-radius: 16px; overflow: hidden; position: relative; }
  .apx-cartao::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); opacity: .9; }
  .apx-linha { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; min-height: 60px; border-bottom: 1px solid var(--linha); }
  .apx-linha:last-child { border-bottom: 0; }
  .apx-linha:hover { background: var(--hover); }
  .apx-ic { width: 36px; height: 36px; border-radius: 11px; flex: none; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .apx-ic.menta { background: #0d2240; color: #0ffcbe; }
  .apx-ic svg { width: 20px; height: 20px; }
  .apx-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .apx-txt b { font-size: 16px; font-weight: 650; }
  .apx-txt span { font-size: 13.5px; color: var(--sub); line-height: 1.35; }
  .apx-seta { width: 18px; height: 18px; color: var(--sub); flex: none; }
  .apx-seta svg { width: 100%; height: 100%; }
  .apx-qtd { flex: none; font-size: 12px; font-weight: 750; border-radius: 999px; padding: 3px 9px; background: #0ffcbe; color: #0d2240; }

  dialog.apx-tela { padding: 0; margin: 0; width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; border: 0; border-radius: 0; display: none; flex-direction: column; background: var(--painel, var(--fundo)); color: var(--texto); }
  dialog.apx-tela[open] { display: flex; }
  @media (min-width: 761px) { dialog.apx-tela { margin: auto; width: min(980px, calc(100vw - 48px)); height: min(900px, calc(100dvh - 48px)); border-radius: 20px; border: 1px solid var(--linha); box-shadow: 0 24px 70px rgba(0,0,0,.35); } }
  .apx-topo { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top)); border-bottom: 1px solid var(--linha); background: var(--fundo); }
  .apx-topo h2 { margin: 0; font-size: 17px; font-weight: 750; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .apx-topo .apx-fechar { justify-self: start; }
  .apx-texto-btn { all: unset; cursor: pointer; font-size: 16px; color: #106ebe; padding: 8px 6px; border-radius: 8px; }
  [data-tema="escuro"] .apx-texto-btn { color: #0ffcbe; }
  .apx-corpo { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px; display: block; }
  .apx-grade { display: grid; gap: 18px; align-content: start; }
  @media (min-width: 900px) { .apx-corpo { padding: 20px; } .apx-grade { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; } .apx-largo { grid-column: 1 / -1; } }
  .apx-bloco { display: grid; gap: 10px; min-width: 0; align-content: start; }
  .apx-bloco > h3 { margin: 0 4px; font-size: 18px; font-weight: 750; display: flex; align-items: center; gap: 8px; }
  .apx-bloco > h3 small { font-size: 13px; color: var(--sub); font-weight: 600; }
  .apx-sub { margin: -4px 4px 0; font-size: 13.5px; color: var(--sub); line-height: 1.45; }

  .apx-heroi { border-radius: 18px; padding: 18px; display: grid; gap: 12px; color: #fff; background: radial-gradient(120% 140% at 100% 0%, rgba(15,252,190,.22), transparent 55%), linear-gradient(135deg, #0d2240, #123866); border: 1px solid rgba(15,252,190,.28); position: relative; overflow: hidden; }
  .apx-heroi::after { content: ""; position: absolute; left: 18px; right: 18px; bottom: 0; height: 1.5px; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); opacity: .8; }
  .apx-heroi b.apx-grande { font-size: 22px; line-height: 1.2; font-weight: 750; }
  .apx-heroi p { margin: 0; font-size: 14px; line-height: 1.45; color: rgba(255,255,255,.82); }
  .apx-barra { height: 8px; border-radius: 999px; background: rgba(255,255,255,.14); overflow: hidden; }
  .apx-barra i { display: block; height: 100%; width: 0; border-radius: inherit; background: linear-gradient(90deg, #0ffcbe, #3aa0ff); transition: width .6s ease; }
  .apx-nums { display: flex; flex-wrap: wrap; gap: 8px; }
  .apx-num { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 8px 12px; display: grid; gap: 1px; min-width: 92px; }
  .apx-num b { font-size: 20px; font-weight: 750; }
  .apx-num span { font-size: 12.5px; color: rgba(255,255,255,.75); }
  .apx-acoes { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .apx-primario { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 15px; font-weight: 700; padding: 11px 18px; border-radius: 999px; color: #fff; background: linear-gradient(90deg, #106ebe, #3aa0ff); box-shadow: 0 6px 18px rgba(16,110,190,.35); }
  .apx-primario svg { width: 18px; height: 18px; }
  .apx-primario[disabled] { opacity: .55; cursor: default; box-shadow: none; }
  .apx-leve { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 650; padding: 9px 14px; border-radius: 999px; border: 1px solid var(--linha); background: var(--fundo); color: var(--texto); }
  .apx-leve:hover { background: var(--hover); }
  .apx-leve svg { width: 16px; height: 16px; }
  .apx-heroi .apx-leve { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.2); color: #fff; }
  .apx-perigo { color: #e5484d; }
  .apx-gasto { font-size: 12.5px; color: rgba(255,255,255,.7); }
  .apx-erro { font-size: 13.5px; color: #ffb0a8; }

  .apx-opcao { display: flex; align-items: center; gap: 12px; padding: 14px; }
  .apx-int { all: unset; cursor: pointer; flex: none; width: 51px; height: 31px; border-radius: 999px; background: var(--linha); position: relative; transition: background .2s; }
  .apx-int::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,.25); transition: transform .2s; }
  .apx-int[aria-checked="true"] { background: linear-gradient(90deg, #106ebe, #3aa0ff); }
  .apx-int[aria-checked="true"]::after { transform: translateX(20px); }
  .apx-int:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }

  .apx-doc { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--linha); font-size: 13.5px; }
  .apx-doc span { flex: 1; min-width: 0; color: var(--sub); overflow-wrap: anywhere; }
  .apx-doc b { color: var(--texto); font-weight: 650; }

  .apx-item { background: var(--fundo); border: 1px solid var(--linha); border-radius: 16px; padding: 14px; display: grid; gap: 9px; min-width: 0; }
  .apx-item.desfeito { opacity: .6; }
  .apx-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .apx-chip { font-size: 12px; font-weight: 650; border-radius: 999px; padding: 3px 9px; background: var(--hover); color: var(--sub); }
  .apx-chip.cat { background: rgba(16,110,190,.12); color: #106ebe; }
  [data-tema="escuro"] .apx-chip.cat { background: rgba(15,252,190,.12); color: #0ffcbe; }
  .apx-chip.auto { background: #0d2240; color: #0ffcbe; }
  .apx-item h4 { margin: 0; font-size: 16px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
  .apx-corpo-txt { margin: 0; font-size: 14.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .apx-meta { font-size: 12.5px; color: var(--sub); line-height: 1.4; }
  .apx-conferir { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.4; padding: 8px 10px; border-radius: 10px; background: var(--aviso, #fff4d6); color: var(--aviso-txt, #6b4a00); }
  .apx-conferir svg { width: 16px; height: 16px; flex: none; margin-top: 1px; }
  .apx-troca { display: grid; gap: 4px; font-size: 13.5px; }
  .apx-troca del { color: var(--sub); }
  .apx-troca ins { text-decoration: none; font-weight: 600; }
  .apx-exemplo { margin: 0; padding: 6px 10px; border-left: 2px solid #3aa0ff; font-size: 13px; color: var(--sub); line-height: 1.45; overflow-wrap: anywhere; }
  .apx-vazio { padding: 20px 16px; text-align: center; color: var(--sub); font-size: 14px; line-height: 1.45; background: var(--fundo); border: 1px dashed var(--linha); border-radius: 16px; }
  .apx-mais { justify-self: center; }

  dialog.apx-folha { padding: 0; width: min(560px, calc(100vw - 24px)); border-radius: 18px; border: 1px solid var(--linha); background: var(--fundo); color: var(--texto); }
  .apx-folha-corpo { padding: 20px; display: grid; gap: 12px; }
  .apx-folha-corpo h2 { margin: 0; font-size: 19px; }
  .apx-folha-corpo p { margin: 0; color: var(--sub); font-size: 14px; line-height: 1.45; }
  .apx-folha-corpo label { display: grid; gap: 6px; font-size: 13.5px; color: var(--sub); }
  .apx-campo { font: inherit; font-size: 16px; color: var(--texto); background: var(--entrada, var(--painel)); border: 1px solid var(--linha); border-radius: 12px; padding: 10px 12px; width: 100%; box-sizing: border-box; }
  textarea.apx-campo { resize: vertical; min-height: 110px; line-height: 1.45; }
  .apx-rodape { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
  @media (max-width: 760px) { .apx-corpo { padding: 14px 14px calc(24px + env(safe-area-inset-bottom)); } .apx-heroi b.apx-grande { font-size: 20px; } }
  `;
  const estilo = () => {
    if (document.getElementById('estilo-aprender')) return;
    const s = document.createElement('style');
    s.id = 'estilo-aprender';
    s.textContent = CSS;
    document.head.append(s);
  };

  const data = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às') : '');
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const erroTxt = (x) => (x && x.message) || 'Algo deu errado.';
  const lerBase64 = (arquivo) => new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => falha(new Error('Não deu para ler o arquivo.'));
    r.readAsDataURL(arquivo);
  });
  const resumoRodada = (r) => {
    if (!r) return 'Ainda não estudou as conversas.';
    if (r.situacao === 'estudando') return `Lendo as conversas: ${r.lidas} de ${r.total}`;
    if (r.situacao === 'juntando') return 'Juntando o que aprendeu…';
    if (r.situacao === 'falhou') return `Parou em ${r.lidas} de ${r.total} conversas.`;
    const x = r.resultado || {};
    if (!r.total) return `Nenhuma conversa nova da equipe (${data(r.terminadaEm)}).`;
    return `${plural(x.lidas || 0, 'conversa lida', 'conversas lidas')}, ${plural(x.aprendizados || 0, 'aprendizado', 'aprendizados')} (${x.entraram || 0} entraram, ${x.paraAprovar || 0} para aprovar)`;
  };
  const trabalhando = (e) => Boolean(e && ((e.rodada && ['estudando', 'juntando'].includes(e.rodada.situacao)) || (e.documentos || []).some((d) => ['estudando', 'juntando'].includes(d.situacao))));

  // ------------------------------------------------------------------ cartão no Treinamento
  function cartao(ui) {
    estilo();
    const { el } = ui;
    const sub = el('span', { text: 'A IA lê como a equipe atende e aprende o mesmo jeito.' });
    const qtd = el('span', { class: 'apx-qtd', hidden: '' });
    const caixa = el('div', { class: 'apx-cartao' },
      el('button', { class: 'apx-linha', type: 'button', onclick: () => abrir(ui) },
        el('span', { class: 'apx-ic', html: SVG.livro, 'aria-hidden': 'true' }),
        el('span', { class: 'apx-txt' }, el('b', { text: 'Aprender com a equipe' }), sub), qtd,
        el('span', { class: 'apx-seta', html: SVG.seta, 'aria-hidden': 'true' })),
      el('button', { class: 'apx-linha', type: 'button', onclick: () => abrir(ui, { enviar: true }) },
        el('span', { class: 'apx-ic menta', html: SVG.arquivo, 'aria-hidden': 'true' }),
        el('span', { class: 'apx-txt' }, el('b', { text: 'Enviar PDF ou texto' }), el('span', { text: 'Como funciona o atendimento, regras, preços: a IA propõe o que muda.' })),
        el('span', { class: 'apx-seta', html: SVG.seta, 'aria-hidden': 'true' })));
    ui.api('/api/ia/aprender').then((e) => {
      if (trabalhando(e)) sub.textContent = resumoRodada(e.rodada);
      else sub.textContent = e.aprendidos ? `${plural(e.aprendidos, 'coisa aprendida', 'coisas aprendidas')}. ${e.config.auto ? 'Aprende sozinha todo dia.' : 'Aprender sozinha: desligada.'}` : sub.textContent;
      if (e.pendentes) { qtd.hidden = false; qtd.textContent = `${e.pendentes} para aprovar`; }
    }).catch(() => {});
    return caixa;
  }

  // ------------------------------------------------------------------ tela cheia
  function abrir(ui, opcoes = {}) {
    estilo();
    const { el, toast } = ui;
    const api = ui.api;
    const enviarJson = (url, metodo, corpo) => api(url, { method: metodo, body: JSON.stringify(corpo ?? {}) });
    const grade = el('div', { class: 'apx-grade' });
    const corpo = el('div', { class: 'apx-corpo' }, grade);
    const dlg = el('dialog', { class: 'apx-tela', 'aria-label': 'Aprender com a equipe' },
      el('div', { class: 'apx-topo' },
        el('button', { class: 'apx-texto-btn apx-fechar', type: 'button', text: 'Fechar', onclick: () => dlg.close() }),
        el('h2', { text: 'Aprender com a equipe' }), el('span')),
      corpo);
    const arquivo = el('input', { type: 'file', accept: '.pdf,.txt,.md,application/pdf,text/plain', hidden: '' });
    dlg.append(arquivo);
    let vivo = true;
    let timer = 0;
    let secoes = [];
    let verTodosAprendidos = false;
    dlg.addEventListener('close', () => { vivo = false; clearTimeout(timer); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();

    const dialogo = (titulo, partes, botoes) => {
      const d = el('dialog', { class: 'apx-folha' });
      const fechar = () => d.close();
      d.append(el('div', { class: 'apx-folha-corpo' }, el('h2', { text: titulo }), ...partes, el('div', { class: 'apx-rodape' }, ...botoes(fechar))));
      d.addEventListener('close', () => d.remove());
      dlg.append(d);
      d.showModal();
      return d;
    };
    const nomeDestino = (i) => {
      if (i.destino === 'perguntas-frequentes') return 'Perguntas frequentes';
      const s = secoes.find((x) => x.chave === i.destino);
      return s ? s.titulo : `Aprendido com a equipe › ${CATEGORIA[i.destino] || CATEGORIA[i.categoria] || 'Outros'}`;
    };

    async function enviarArquivo(f) {
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) return toast('Arquivo grande demais (até 10 MB).');
      try {
        const base64 = await lerBase64(f);
        await ui.post('/api/ia/aprender/documento', { nome: f.name, base64 });
        toast('A IA está lendo o documento ✓');
        carregar();
      } catch (x) { toast(erroTxt(x)); }
    }
    arquivo.addEventListener('change', () => { const f = arquivo.files && arquivo.files[0]; arquivo.value = ''; enviarArquivo(f); });
    const colarTexto = () => {
      const nome = el('input', { class: 'apx-campo', maxlength: '150', placeholder: 'Ex.: como-atendemos', value: 'texto' });
      const t = el('textarea', { class: 'apx-campo', placeholder: 'Cole aqui o texto (roteiro, regras, perguntas e respostas…)', maxlength: '200000' });
      dialogo('Colar um texto', [el('p', { text: 'A IA lê e propõe o que muda no Treinamento. Nada entra sem você aprovar.' }), el('label', {}, el('span', { text: 'Nome' }), nome), t], (fechar) => [
        el('button', { class: 'apx-leve', type: 'button', text: 'Cancelar', onclick: fechar }),
        el('button', { class: 'apx-primario', type: 'button', text: 'Enviar', onclick: async () => {
          if (!t.value.trim()) return toast('Cole o texto primeiro.');
          try { await ui.post('/api/ia/aprender/documento', { nome: `${(nome.value.trim() || 'texto').replace(/\.(txt|md|pdf)$/i, '')}.txt`, texto: t.value }); fechar(); toast('A IA está lendo o texto ✓'); carregar(); } catch (x) { toast(erroTxt(x)); }
        } })]);
    };

    function cartaoItem(i, pendente) {
      const chips = el('div', { class: 'apx-chips' }, el('span', { class: 'apx-chip cat', text: CATEGORIA[i.categoria] || 'Aprendizado' }));
      if (!pendente && i.automatico) chips.append(el('span', { class: 'apx-chip auto', text: 'Aprendeu sozinha' }));
      if (i.situacao === 'desfeito') chips.append(el('span', { class: 'apx-chip', text: 'Desfeito' }));
      const origem = i.origem === 'conversas' ? `Visto em ${plural(i.conversas, 'conversa', 'conversas')} da equipe` : `Do ${i.origem.replace(/^documento: /, 'documento ')}`;
      const partes = [chips, el('h4', { text: i.titulo })];
      if (i.acao === 'corrigir' && i.trechoAtual) partes.push(el('div', { class: 'apx-troca' }, el('span', { class: 'apx-meta', text: 'Hoje está:' }), el('del', { text: i.trechoAtual }), el('span', { class: 'apx-meta', text: 'Fica:' }), el('ins', { text: i.texto })));
      else if (i.acao === 'pergunta') partes.push(el('p', { class: 'apx-corpo-txt' }, el('b', { text: i.pergunta || '' }), el('br'), el('span', { text: i.resposta || '' })));
      else partes.push(el('p', { class: 'apx-corpo-txt', text: i.texto }));
      if (i.conferir || i.contradiz) partes.push(el('div', { class: 'apx-conferir' }, el('span', { html: SVG.alerta, 'aria-hidden': 'true' }), el('span', { text: `Conferir: ${i.motivo || 'diferente do que está no Treinamento.'}` })));
      for (const ex of (i.exemplos || []).slice(0, 2)) partes.push(el('blockquote', { class: 'apx-exemplo', text: ex }));
      const quando = pendente ? '' : i.situacao === 'desfeito' ? ` · desfeito por ${i.desfeitoPor || '—'} em ${data(i.desfeitoEm)}` : ` · ${i.automatico ? 'entrou sozinho' : `aprovado por ${i.decididoPor || '—'}`} em ${data(i.decididoEm)}`;
      partes.push(el('div', { class: 'apx-meta', text: `${origem} · Entra em: ${nomeDestino(i)}${quando}` }));
      if (pendente) {
        partes.push(el('div', { class: 'apx-acoes' },
          el('button', { class: 'apx-primario', type: 'button', onclick: () => decidir(i, 'aprovar', {}) }, el('span', { html: SVG.ok, 'aria-hidden': 'true' }), el('span', { text: 'Aprovar' })),
          el('button', { class: 'apx-leve', type: 'button', text: 'Editar e aprovar', onclick: () => editar(i) }),
          el('button', { class: 'apx-leve apx-perigo', type: 'button', text: 'Recusar', onclick: () => decidir(i, 'recusar') })));
      } else if (i.situacao === 'aplicado') {
        partes.push(el('div', { class: 'apx-acoes' }, el('button', { class: 'apx-leve', type: 'button', onclick: () => desfazer(i) }, el('span', { html: SVG.voltar, 'aria-hidden': 'true' }), el('span', { text: 'Desfazer' }))));
      }
      return el('article', { class: `apx-item${i.situacao === 'desfeito' ? ' desfeito' : ''}` }, ...partes);
    }

    async function decidir(i, acao, corpoEd) {
      try {
        await ui.post(`/api/ia/aprender/itens/${encodeURIComponent(i.id)}/${acao}`, corpoEd || {});
        toast(acao === 'aprovar' ? 'Entrou na memória da IA ✓' : 'Recusado');
        carregar();
      } catch (x) { toast(erroTxt(x)); }
    }
    function editar(i) {
      const campos = [];
      const texto = el('textarea', { class: 'apx-campo', maxlength: '2000' }); texto.value = i.texto;
      const perg = el('input', { class: 'apx-campo', maxlength: '500' }); perg.value = i.pergunta || '';
      const resp = el('textarea', { class: 'apx-campo', maxlength: '2000' }); resp.value = i.resposta || '';
      if (i.acao === 'pergunta') campos.push(el('label', {}, el('span', { text: 'Pergunta da cliente' }), perg), el('label', {}, el('span', { text: 'Resposta' }), resp));
      else campos.push(el('label', {}, el('span', { text: i.acao === 'corrigir' ? 'Texto novo (substitui o trecho)' : 'O que a IA vai saber' }), texto));
      let destino = null;
      if (i.acao === 'acrescentar') {
        destino = el('select', { class: 'apx-campo' });
        for (const s of secoes) destino.append(el('option', { value: s.chave, text: s.titulo }));
        for (const [k, v] of Object.entries(CATEGORIA)) destino.append(el('option', { value: k, text: `Aprendido com a equipe › ${v}` }));
        destino.value = i.destino;
        campos.push(el('label', {}, el('span', { text: 'Entra em' }), destino));
      }
      dialogo('Editar e aprovar', campos, (fechar) => [
        el('button', { class: 'apx-leve', type: 'button', text: 'Cancelar', onclick: fechar }),
        el('button', { class: 'apx-primario', type: 'button', text: 'Aprovar', onclick: async () => {
          const c = i.acao === 'pergunta' ? { pergunta: perg.value.trim(), resposta: resp.value.trim() } : { texto: texto.value.trim() };
          if (destino) c.destino = destino.value;
          if (Object.values(c).some((v) => !v)) return toast('Preencha os campos.');
          fechar(); decidir(i, 'aprovar', c);
        } })]);
    }
    function desfazer(i) {
      dialogo('Desfazer este aprendizado?', [el('p', { text: i.acao === 'corrigir' ? 'O trecho volta ao que era antes no Treinamento.' : 'A IA deixa de usar isso nas respostas.' })], (fechar) => [
        el('button', { class: 'apx-leve', type: 'button', text: 'Cancelar', onclick: fechar }),
        el('button', { class: 'apx-primario', type: 'button', text: 'Desfazer', onclick: async () => {
          fechar();
          try { await ui.post(`/api/ia/aprender/itens/${encodeURIComponent(i.id)}/desfazer`, {}); toast('Desfeito ✓'); carregar(); } catch (x) { toast(erroTxt(x)); }
        } })]);
    }

    function heroi(e) {
      const r = e.rodada;
      const ocupado = r && ['estudando', 'juntando'].includes(r.situacao);
      const partes = [el('b', { class: 'apx-grande', text: ocupado ? 'A IA está estudando as conversas' : 'A IA aprende com a sua equipe' }),
        el('p', { text: 'Ela lê as conversas em que a equipe atendeu (primeiro as que viraram agendamento), sem nomes nem telefones, e aprende o roteiro, o jeito de escrever, as perguntas e as respostas.' })];
      if (ocupado) {
        const barra = el('div', { class: 'apx-barra', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(r.total || 1), 'aria-valuenow': String(r.lidas) }, el('i'));
        requestAnimationFrame(() => { barra.firstChild.style.width = `${r.situacao === 'juntando' ? 100 : Math.round((100 * r.lidas) / Math.max(1, r.total))}%`; });
        partes.push(el('p', { text: resumoRodada(r) }), barra);
      } else if (r && r.situacao === 'pronta' && r.resultado) {
        const x = r.resultado;
        partes.push(el('p', { text: `Último estudo: ${data(r.terminadaEm)}${r.pedidaPor ? ` · ${r.pedidaPor}` : ''}` }),
          el('div', { class: 'apx-nums' },
            el('div', { class: 'apx-num' }, el('b', { text: String(x.lidas) }), el('span', { text: 'conversas lidas' })),
            el('div', { class: 'apx-num' }, el('b', { text: String(x.aprendizados) }), el('span', { text: 'aprendizados' })),
            el('div', { class: 'apx-num' }, el('b', { text: String(x.entraram) }), el('span', { text: 'entraram' })),
            el('div', { class: 'apx-num' }, el('b', { text: String(x.paraAprovar) }), el('span', { text: 'para aprovar' }))));
      } else if (r && r.situacao === 'falhou') {
        partes.push(el('p', { text: resumoRodada(r) }), el('span', { class: 'apx-erro', text: r.erro || '' }));
      }
      const botao = el('button', { class: 'apx-primario', type: 'button', disabled: ocupado || !e.iaLigada ? '' : null, onclick: async () => {
        botao.disabled = true;
        try { await ui.post('/api/ia/aprender/estudar', {}); toast('A IA começou a estudar ✓'); } catch (x) { toast(erroTxt(x)); }
        carregar();
      } }, el('span', { html: SVG.brilho, 'aria-hidden': 'true' }), el('span', { text: r && r.situacao === 'falhou' ? 'Continuar o estudo' : 'Estudar as conversas agora' }));
      partes.push(el('div', { class: 'apx-acoes' }, botao,
        r && (r.gastoUsd || 0) > 0 ? el('span', { class: 'apx-gasto', text: `Gasto do último estudo: cerca de US$ ${r.gastoUsd.toFixed(2).replace('.', ',')}` }) : null));
      if (!e.iaLigada) partes.push(el('p', { text: 'Configure a chave da IA em Conexões para ela estudar.' }));
      return el('section', { class: 'apx-heroi apx-largo' }, ...partes);
    }

    function blocoAjustes(e) {
      const int = el('button', { class: 'apx-int', type: 'button', role: 'switch', 'aria-checked': String(Boolean(e.config.auto)), 'aria-label': 'Aprender sozinha' });
      int.addEventListener('click', async () => {
        const v = int.getAttribute('aria-checked') !== 'true';
        int.setAttribute('aria-checked', String(v));
        try { await enviarJson('/api/ia/aprender/config', 'PATCH', { auto: v }); toast(v ? 'Aprender sozinha: ligada' : 'Aprender sozinha: desligada'); } catch (x) { int.setAttribute('aria-checked', String(!v)); toast(erroTxt(x)); }
      });
      const docs = (e.documentos || []).slice(0, 3).map((d) => el('div', { class: 'apx-doc' },
        el('span', {}, el('b', { text: d.documentoNome || 'Documento' }), el('span', { text: ` · ${['estudando', 'juntando'].includes(d.situacao) ? 'a IA está lendo…' : d.situacao === 'falhou' ? `não deu: ${d.erro || ''}` : plural((d.resultado || {}).paraAprovar || 0, 'proposta', 'propostas')}` }))));
      return el('section', { class: 'apx-bloco' },
        el('h3', { text: 'Como ela aprende' }),
        el('div', { class: 'apx-cartao' },
          el('div', { class: 'apx-opcao' },
            el('span', { class: 'apx-txt' }, el('b', { text: 'Aprender sozinha' }),
              el('span', { text: 'Ligada: estuda as conversas novas todo dia e já usa o que a equipe repete em 3 ou mais conversas. Valores e o que muda o Treinamento sempre esperam você. Desligada: só estuda quando você mandar e tudo espera aprovação.' })),
            int)),
        el('div', { class: 'apx-cartao' },
          el('button', { class: 'apx-linha', type: 'button', onclick: () => arquivo.click() },
            el('span', { class: 'apx-ic menta', html: SVG.arquivo, 'aria-hidden': 'true' }),
            el('span', { class: 'apx-txt' }, el('b', { text: 'Enviar PDF ou texto' }), el('span', { text: 'A IA lê e propõe o que muda. Você aprova.' }))),
          el('button', { class: 'apx-linha', type: 'button', onclick: colarTexto },
            el('span', { class: 'apx-ic', html: SVG.livro, 'aria-hidden': 'true' }),
            el('span', { class: 'apx-txt' }, el('b', { text: 'Colar um texto' }), el('span', { text: 'Roteiro, regras, perguntas e respostas.' }))),
          ...docs));
    }

    async function carregar() {
      clearTimeout(timer);
      try {
        const [e, pend, apr, base] = await Promise.all([
          api('/api/ia/aprender'),
          api('/api/ia/aprender/itens?lista=pendentes'),
          api('/api/ia/aprender/itens?lista=aprendidos'),
          secoes.length ? Promise.resolve(null) : api('/api/ia/base').catch(() => null),
        ]);
        if (!vivo) return;
        if (base) secoes = base.secoes || [];
        const ordemPend = [...pend].sort((a, b) => b.conversas - a.conversas);
        const aprendidos = verTodosAprendidos ? apr : apr.slice(0, 20);
        grade.replaceChildren(
          heroi(e),
          el('section', { class: 'apx-bloco' },
            el('h3', {}, el('span', { text: 'Para aprovar' }), el('small', { text: pend.length ? String(pend.length) : '' })),
            el('p', { class: 'apx-sub', text: 'O que a IA viu e quer pôr na memória. Os mais vistos vêm primeiro.' }),
            ...(ordemPend.length ? ordemPend.map((i) => cartaoItem(i, true)) : [el('div', { class: 'apx-vazio', text: 'Nada esperando por você agora.' })])),
          el('section', { class: 'apx-bloco' },
            el('h3', {}, el('span', { text: 'O que a IA aprendeu' }), el('small', { text: apr.length ? String(apr.filter((x) => x.situacao === 'aplicado').length) : '' })),
            el('p', { class: 'apx-sub', text: 'Ela já usa isso nas respostas. Desfazer tira da memória.' }),
            ...(aprendidos.length ? aprendidos.map((i) => cartaoItem(i, false)) : [el('div', { class: 'apx-vazio', text: 'Ainda nada. Depois do primeiro estudo, aparece aqui.' })]),
            apr.length > aprendidos.length ? el('button', { class: 'apx-leve apx-mais', type: 'button', text: `Ver todos (${apr.length})`, onclick: () => { verTodosAprendidos = true; carregar(); } }) : null),
          blocoAjustes(e));
        if (opcoes.enviar) { opcoes.enviar = false; arquivo.click(); }
        if (trabalhando(e)) timer = setTimeout(carregar, 3000);
      } catch (x) {
        if (!vivo) return;
        grade.replaceChildren(el('div', { class: 'apx-vazio apx-largo' }, el('b', { text: 'Não deu para abrir. ' }), el('span', { text: erroTxt(x) }), el('br'),
          el('button', { class: 'apx-leve', type: 'button', text: 'Tentar de novo', onclick: carregar })));
      }
    }
    grade.append(el('div', { class: 'apx-vazio apx-largo', text: 'Carregando…' }));
    carregar();
  }

  window.SintoniaTelas.aprender = { cartao, abrir };
})();
