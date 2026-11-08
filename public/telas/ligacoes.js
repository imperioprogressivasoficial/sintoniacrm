/* Tela "Ligações" (como a aba Ligações do WhatsApp): window.SintoniaTelas.ligacoes = { desenhar(caixa, ui), recarregar() }.
 * Só o que é real: a ligação sai do celular (tel:); o app registra quem ligou e quando ("Efetuada", sem duração).
 * "Recebida" e "Perdida" só aparecem quando o WhatsApp (Evolution, evento CALL) avisa.
 * No computador não finge ligar: mostra o número para ligar pelo celular (copiar) e registra quando a pessoa confirma.
 * Texto do servidor sempre por textContent. Páginas extras (Teclado, Programar, Favoritos) no painel lateral. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const SVG = {
    pontos: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    tel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h3.5l1.7 4.3-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    teclado: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="5" r="1.7"/><circle cx="12" cy="5" r="1.7"/><circle cx="18" cy="5" r="1.7"/><circle cx="6" cy="11" r="1.7"/><circle cx="12" cy="11" r="1.7"/><circle cx="18" cy="11" r="1.7"/><circle cx="6" cy="17" r="1.7"/><circle cx="12" cy="17" r="1.7"/><circle cx="18" cy="17" r="1.7"/><circle cx="12" cy="22" r="1.5"/></svg>',
    estrela: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/></svg>',
    estrelaCheia: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z"/></svg>',
    saiu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg>',
    chegou: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17M15 17H7V9"/></svg>',
    apagar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z"/><path d="m12 9 6 6M18 9l-6 6"/></svg>',
    copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>',
  };
  const CSS = `
  .lg { max-width: 760px; margin: 0 auto; padding: 4px 0 90px; }
  .lg-barra { display: flex; align-items: center; justify-content: space-between; padding: 4px 0; }
  .lg-barra .icone.redondo { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; }
  .lg-barra .icone.redondo svg { width: 22px; height: 22px; }
  .lg h1.titulo-grande { margin: 6px 0 14px; }
  .lg-acoes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
  .lg-acao { all: unset; cursor: pointer; display: grid; justify-items: center; gap: 6px; padding: 12px 4px; border-radius: 18px; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); font-size: 13px; font-weight: 650; color: var(--texto); text-align: center; }
  .lg-acao i { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: var(--marca-azul, #106ebe); }
  .lg-acao i svg { width: 21px; height: 21px; }
  .lg-acao b { font-weight: 650; }
  .lg-acao small { display: block; font-size: 11.5px; font-weight: 700; color: var(--marca-azul); }
  [data-tema="escuro"] .lg-acao small { color: var(--marca-menta); }
  .lg-acao:focus-visible, .lg-linha:focus-visible, .lg-ligar:focus-visible { outline: 2px solid var(--marca-menta); outline-offset: 2px; }
  .lg-cab { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 2px 6px; }
  .lg-cab h2 { margin: 0; font-size: 18px; }
  .lg-chips { display: flex; gap: 6px; }
  .lg-lista { border-radius: 18px; overflow: hidden; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--vidro-borda, var(--linha)); }
  .lg-linha { display: flex; align-items: center; gap: 12px; padding: 10px 12px; min-height: 64px; box-sizing: border-box; cursor: pointer; }
  .lg-linha + .lg-linha { border-top: 1px solid var(--linha); }
  .lg-linha:hover { background: var(--sel); }
  .lg-linha .avatar { width: 44px; height: 44px; flex: none; }
  .lg-txt { flex: 1; min-width: 0; display: grid; gap: 2px; }
  .lg-txt b { font-size: 16px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lg-txt b.perdida { color: #dc2626; } [data-tema="escuro"] .lg-txt b.perdida { color: #f87171; }
  .lg-txt small { font-size: 13px; color: var(--sub); display: flex; align-items: center; gap: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lg-txt small svg { width: 14px; height: 14px; flex: none; }
  .lg-quando { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
  .lg-ligar { all: unset; cursor: pointer; flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; color: var(--marca-azul); }
  [data-tema="escuro"] .lg-ligar { color: var(--marca-menta); }
  .lg-ligar:hover { background: var(--sel); }
  .lg-ligar svg { width: 21px; height: 21px; }
  .lg-vazio { padding: 26px 16px; text-align: center; color: var(--sub); font-size: 14.5px; }
  .lg-mais { all: unset; cursor: pointer; display: block; margin: 10px auto; padding: 10px 16px; border-radius: 999px; font-weight: 700; color: var(--marca-azul); }
  .lg-nota { font-size: 12.5px; color: var(--sub); margin: 10px 4px; line-height: 1.4; }
  /* teclado */
  .lg-visor { text-align: center; font-size: 32px; font-weight: 600; letter-spacing: .02em; min-height: 46px; margin: 12px 0 18px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .lg-teclas { display: grid; grid-template-columns: repeat(3, 76px); gap: 16px 26px; justify-content: center; }
  .lg-tecla { all: unset; cursor: pointer; width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; align-content: center; background: var(--vidro-item, var(--painel)); box-shadow: inset 0 0 0 1px var(--linha); font-size: 30px; font-weight: 500; color: var(--texto); }
  .lg-tecla small { font-size: 10px; letter-spacing: .14em; color: var(--sub); font-weight: 700; height: 12px; }
  .lg-tecla:active { background: var(--sel); }
  .lg-teclado-pe { display: grid; grid-template-columns: repeat(3, 76px); gap: 26px; justify-content: center; margin-top: 18px; align-items: center; }
  .lg-tecla.verde { background: #16a34a; color: #fff; box-shadow: none; }
  .lg-tecla.verde svg { width: 30px; height: 30px; }
  .lg-tecla.leve { background: transparent; box-shadow: none; }
  .lg-tecla.leve svg { width: 26px; height: 26px; color: var(--sub); }
  /* ligar pelo celular (computador) */
  .lg-pc { display: grid; gap: 14px; justify-items: center; text-align: center; padding: 10px 0; }
  .lg-pc .lg-num { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .lg-pc p { margin: 0; color: var(--sub); font-size: 14.5px; line-height: 1.45; max-width: 340px; }
  .lg-botoes { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .lg-botoes .botao { min-height: 46px; display: inline-flex; align-items: center; gap: 8px; padding: 0 20px; font-weight: 700; }
  .lg-botoes .botao svg { width: 18px; height: 18px; }
  .lg-form { display: grid; gap: 12px; }
  .lg-form label { display: grid; gap: 6px; font-size: 13.5px; color: var(--sub); }
  .lg-form input { font: inherit; font-size: 16px; color: var(--texto); background: var(--entrada); border: 1px solid var(--linha); border-radius: 12px; padding: 12px 14px; }
  .lg-sec { font-size: 12.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--sub); margin: 14px 4px 8px; }
  `;
  const s = { ui: null, caixa: null, filtro: 'todas', itens: [], proximo: null, sugestoes: null, carregando: false };
  const ehCelular = () => matchMedia('(max-width: 760px)').matches || /Android|iPhone|iPad/.test(navigator.userAgent);
  const P = () => window.SintoniaPainel;

  function estilo() {
    if (document.getElementById('ligacoes-css')) return;
    const st = document.createElement('style'); st.id = 'ligacoes-css'; st.textContent = CSS; document.head.append(st);
  }
  const telFmt = (t) => s.ui.formatarTel(String(t || ''));
  const telE164 = (t) => { const d = String(t || '').replace(/\D/g, ''); return d.length >= 12 ? `+${d}` : d.length >= 10 ? `+55${d}` : d; };
  function relativo(d) {
    const x = new Date(d); const agora = new Date();
    const dia = (q) => { const c = new Date(q); c.setHours(0, 0, 0, 0); return c.getTime(); };
    if (dia(x) === dia(agora)) return x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (dia(x) === dia(agora) - 864e5) return 'ontem';
    if (agora - x < 6 * 864e5) return x.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  // ---------- ligar ----------
  /** Ligar para uma cliente (conversa) ou um número. Celular: tel: + registro. Computador: mostra o número para ligar pelo celular. */
  async function ligar({ conversaId = null, telefone = '', nome = '' } = {}) {
    const ui = s.ui;
    const registrar = async () => {
      try { const r = await ui.post('/api/ligacoes/efetuada', conversaId ? { conversaId } : { telefone }); recarregar(); return r; } catch (x) { ui.toast(x.message); return null; }
    };
    if (ehCelular()) {
      const a = document.createElement('a'); a.href = `tel:${telE164(telefone)}`; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
      const r = await registrar();
      if (r && (r.conversaId || conversaId)) setTimeout(() => ui.abrirRegistroLigacao?.(r.conversaId || conversaId, nome || telFmt(telefone), r.id), 900);
      return;
    }
    const el = ui.el;
    const op = { id: 'ligar-pc', titulo: 'Ligar pelo celular', montar: (corpo) => {
      corpo.append(el('div', { class: 'lg-pc' },
        el('b', { text: nome || 'Número' }), el('span', { class: 'lg-num', text: telFmt(telefone) }),
        el('p', { text: 'A Sintonia não faz a ligação pelo computador. Ligue pelo seu celular (ou pelo WhatsApp) e toque em “Liguei” para registrar.' }),
        el('div', { class: 'lg-botoes' },
          el('button', { class: 'botao leve', type: 'button', html: SVG.copiar, onclick: async () => { try { await navigator.clipboard.writeText(telE164(telefone)); ui.toast('Número copiado ✓'); } catch { ui.toast('Não deu para copiar aqui.'); } } }, document.createTextNode('Copiar número')),
          el('a', { class: 'botao leve', href: `https://wa.me/${String(telE164(telefone)).replace(/\D/g, '')}`, target: '_blank', rel: 'noopener', text: 'Abrir no WhatsApp' }),
          el('button', { class: 'botao', type: 'button', html: SVG.tel, onclick: async () => {
            const r = await registrar(); P().fechar();
            if (r && (r.conversaId || conversaId)) setTimeout(() => ui.abrirRegistroLigacao?.(r.conversaId || conversaId, nome || telFmt(telefone), r.id), 300);
            else if (r) ui.toast('Ligação registrada ✓');
          } }, document.createTextNode('Liguei')))));
    } };
    if (P().aberto()) P().empurrar(op); else P().abrir(op);
  }
  const escolherELigar = (titulo = 'Nova ligação') => window.SintoniaConversa?.escolherContato?.({ titulo, rotuloNovo: 'Novo contato', aoEscolher: (c) => { P().fechar(); setTimeout(() => ligar({ conversaId: c.id, telefone: c.telefone, nome: s.ui.nomeDe(c) }), 260); } });

  // ---------- teclado ----------
  function teclado() {
    const el = s.ui.el;
    let num = '';
    const visor = el('div', { class: 'lg-visor', 'aria-live': 'polite' });
    const mostrar = () => { visor.textContent = num ? telFmt(num.length >= 10 ? '55' + num : num) : ''; };
    const LETRAS = { 2: 'ABC', 3: 'DEF', 4: 'GHI', 5: 'JKL', 6: 'MNO', 7: 'PQRS', 8: 'TUV', 9: 'WXYZ', 0: '+' };
    const tecla = (d) => el('button', { type: 'button', class: 'lg-tecla', 'aria-label': String(d), onclick: () => { if (num.length < 15) num += d; mostrar(); } }, el('span', { text: String(d) }), el('small', { text: LETRAS[d] || '' }));
    const corpoTeclado = el('div', {}, visor,
      el('div', { class: 'lg-teclas' }, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, '*', 0, '#'].map(tecla)),
      el('div', { class: 'lg-teclado-pe' }, el('span'),
        el('button', { type: 'button', class: 'lg-tecla verde', 'aria-label': 'Ligar', html: SVG.tel, onclick: () => { const d = num.replace(/\D/g, ''); if (d.length < 8) { s.ui.toast('Digite o número com DDD.'); return; } ligar({ telefone: d }); } }),
        el('button', { type: 'button', class: 'lg-tecla leve', 'aria-label': 'Apagar', html: SVG.apagar, onclick: () => { num = num.slice(0, -1); mostrar(); } })));
    const digitar = (e) => { if (/^[0-9*#]$/.test(e.key)) { num += e.key; mostrar(); } else if (e.key === 'Backspace') { num = num.slice(0, -1); mostrar(); } };
    P().abrir({ id: 'teclado', titulo: 'Teclado', montar: (corpo) => { corpo.append(corpoTeclado); addEventListener('keydown', digitar); }, aoFechar: () => removeEventListener('keydown', digitar) });
  }

  // ---------- favoritos ----------
  async function favoritos() {
    const ui = s.ui, el = ui.el;
    P().abrir({ id: 'favoritos', titulo: 'Favoritos', montar: async (corpo) => {
      const desenhar = async () => {
        let lista = [];
        try { lista = await ui.api('/api/ligacoes/favoritos'); } catch {}
        corpo.replaceChildren(
          lista.length ? el('div', { class: 'lg-lista' }, ...lista.map((f) => linhaContato({ id: f.conversaId, nome: f.nome, telefone: f.telefone, unidade: f.unidade }, async () => { await ui.post('/api/ligacoes/favoritos', { conversaId: f.conversaId, favorito: false }); desenhar(); })))
            : el('p', { class: 'lg-vazio', text: 'Nenhum favorito ainda. Adicione as clientes para quem você liga sempre.' }),
          el('button', { class: 'lg-mais', type: 'button', text: '+ Adicionar favorito', onclick: () => window.SintoniaConversa?.escolherContato?.({ titulo: 'Adicionar favorito', aoEscolher: async (c) => {
            try { await ui.post('/api/ligacoes/favoritos', { conversaId: c.id, favorito: true }); ui.toast('Favorito adicionado ⭐'); } catch (x) { ui.toast(x.message); }
            favoritos();
          } }) }),
          el('p', { class: 'lg-nota', text: 'Dica: na ficha da cliente também dá para marcar a estrela.' }));
      };
      corpo.append(el('p', { class: 'lg-vazio', text: 'Carregando…' }));
      desenhar();
    } });
  }
  function linhaContato(c, aoTirar) {
    const ui = s.ui, el = ui.el;
    return el('div', { class: 'lg-linha', role: 'button', tabindex: '0', onclick: () => ui.abrir(c.id) },
      ui.avatar({ id: c.id, nome: c.nome, telefone: c.telefone }),
      el('span', { class: 'lg-txt' }, el('b', { text: c.nome || telFmt(c.telefone) }), el('small', { text: `${telFmt(c.telefone)}${c.unidade ? ' · ' + (ui.UNIDADE[c.unidade] || c.unidade) : ''}` })),
      aoTirar ? el('button', { class: 'lg-ligar', type: 'button', title: 'Tirar dos favoritos', 'aria-label': 'Tirar dos favoritos', html: SVG.estrelaCheia, onclick: (e) => { e.stopPropagation(); aoTirar(); } }) : null,
      el('button', { class: 'lg-ligar', type: 'button', title: 'Ligar', 'aria-label': `Ligar para ${c.nome || telFmt(c.telefone)}`, html: SVG.tel, onclick: (e) => { e.stopPropagation(); ligar({ conversaId: c.id, telefone: c.telefone, nome: c.nome }); } }));
  }

  // ---------- programar (inclui o antigo "Ligar hoje" do CRM) ----------
  const MOTIVO = { lembrete: 'Programada', faltou: 'Faltou', interessada_sem_agendar: 'Interessada', nao_responde: 'Sumiu' };
  async function programar() {
    const ui = s.ui, el = ui.el;
    P().abrir({ id: 'programar', titulo: 'Programar', montar: async (corpo) => {
      corpo.append(el('p', { class: 'lg-vazio', text: 'Carregando…' }));
      let r = { sugestoes: [] };
      try { r = await ui.api('/api/ligacoes'); s.sugestoes = r.sugestoes; } catch {}
      const prog = r.sugestoes.filter((x) => x.motivo === 'lembrete');
      const outras = r.sugestoes.filter((x) => x.motivo !== 'lembrete');
      const linha = (x) => linhaContato({ id: x.conversaId, nome: x.cliente, telefone: x.telefone, unidade: x.unidade });
      const comMotivo = (x) => { const l = linha(x); l.querySelector('.lg-txt small').textContent = x.motivo === 'lembrete' ? `Programada · ${x.texto}` : x.texto; return l; };
      corpo.replaceChildren(
        el('div', { class: 'lg-botoes', style: 'justify-content:flex-start' }, el('button', { class: 'botao', type: 'button', html: SVG.relogio, onclick: () => window.SintoniaConversa?.escolherContato?.({ titulo: 'Programar ligação', aoEscolher: (c) => formProgramar(c) }) }, document.createTextNode('Programar ligação'))),
        el('div', { class: 'lg-sec', text: `Programadas para hoje (${prog.length})` }),
        prog.length ? el('div', { class: 'lg-lista' }, ...prog.map(comMotivo)) : el('p', { class: 'lg-vazio', text: 'Nenhuma ligação programada para hoje.' }),
        el('div', { class: 'lg-sec', text: `Para ligar (${outras.length})` }),
        outras.length ? el('div', { class: 'lg-lista' }, ...outras.map(comMotivo)) : el('p', { class: 'lg-vazio', text: 'Ninguém para ligar agora. Aqui aparecem quem faltou, quem se interessou e não agendou e quem parou de responder.' }));
    } });
  }
  function formProgramar(c) {
    const ui = s.ui, el = ui.el;
    const amanha = new Date(Date.now() + 3600_000); amanha.setMinutes(0, 0, 0);
    const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const quando = el('input', { type: 'datetime-local', value: local(amanha), min: local(new Date()) });
    const texto = el('input', { maxlength: '200', placeholder: 'Ex.: confirmar a progressiva de sábado' });
    const erro = el('div', { class: 'erro-txt', role: 'alert' });
    const salvar = el('button', { class: 'botao', type: 'submit', text: 'Programar' });
    const form = el('form', { class: 'lg-form' }, el('b', { text: ui.nomeDe(c) }), el('label', {}, document.createTextNode('Quando'), quando), el('label', {}, document.createTextNode('Lembrete (opcional)'), texto), erro, el('div', { class: 'lg-botoes', style: 'justify-content:flex-end' }, salvar));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); erro.textContent = '';
      const d = new Date(quando.value);
      if (Number.isNaN(d.getTime())) { erro.textContent = 'Escolha dia e hora.'; return; }
      salvar.disabled = true;
      try { await ui.post('/api/ligacoes/programar', { conversaId: c.id, quando: d.toISOString(), texto: texto.value.trim() || undefined }); ui.toast('Ligação programada ✓ Você recebe o lembrete na hora.'); programar(); }
      catch (x) { erro.textContent = x.message; } finally { salvar.disabled = false; }
    });
    P().empurrar({ id: 'programar-form', titulo: 'Programar ligação', montar: (corpo) => corpo.append(form) });
  }

  // ---------- tela ----------
  function menu(botao) {
    const ui = s.ui, el = ui.el;
    document.getElementById('lg-menu')?.remove();
    const m = el('div', { class: 'menu-lista', id: 'lg-menu', role: 'menu', style: 'position:absolute;z-index:30;left:0;top:52px' },
      el('button', { role: 'menuitem', type: 'button', html: SVG.relogio, onclick: () => { m.remove(); programar(); } }, el('span', { text: 'Ligações programadas' })),
      el('button', { role: 'menuitem', type: 'button', html: SVG.apagar, onclick: async () => { m.remove(); if (!confirm('Limpar o seu histórico de ligações? A equipe continua vendo.')) return; await ui.post('/api/ligacoes/limpar', {}); ui.toast('Histórico limpo ✓'); recarregar(); } }, el('span', { text: 'Limpar histórico' })));
    botao.parentElement.style.position = 'relative';
    botao.parentElement.append(m);
    setTimeout(() => document.addEventListener('click', function fora(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', fora); } }), 0);
  }

  function linhaChamada(x) {
    const ui = s.ui, el = ui.el;
    const nome = x.cliente || telFmt(x.telefone);
    const dir = { efetuada: ['Efetuada', SVG.saiu], recebida: ['Recebida', SVG.chegou], perdida: ['Perdida', SVG.chegou] }[x.direcao] || ['', ''];
    const RES = { atendeu: 'atendeu', nao_atendeu: 'não atendeu', agendou: 'agendou', caixa_postal: 'caixa postal' };
    const extra = [RES[x.resultado], x.unidade ? (ui.UNIDADE[x.unidade] || x.unidade) : null, x.atendente].filter(Boolean).join(' · ');
    const small = el('small', { html: dir[1] }); small.append(document.createTextNode(`${dir[0]}${extra ? ' · ' + extra : ''}`));
    return el('div', { class: 'lg-linha', role: 'button', tabindex: '0', title: x.conversaId ? 'Abrir a conversa' : '', onclick: () => { if (x.conversaId) ui.abrir(x.conversaId); },
      onkeydown: (e) => { if (e.key === 'Enter' && x.conversaId) ui.abrir(x.conversaId); } },
      ui.avatar({ id: x.conversaId || x.id, nome: x.cliente, telefone: x.telefone }),
      el('span', { class: 'lg-txt' }, el('b', { class: x.direcao === 'perdida' ? 'perdida' : '', text: nome }), small),
      el('span', { class: 'lg-quando', text: relativo(x.em) }),
      el('button', { class: 'lg-ligar', type: 'button', title: 'Ligar de volta', 'aria-label': `Ligar para ${nome}`, html: SVG.tel, onclick: (e) => { e.stopPropagation(); ligar({ conversaId: x.conversaId, telefone: x.telefone, nome: x.cliente || '' }); } }));
  }

  function desenhar() {
    const ui = s.ui, el = ui.el;
    if (!s.caixa) return;
    const btMenu = el('button', { class: 'icone redondo', type: 'button', title: 'Mais opções', 'aria-label': 'Mais opções das ligações', html: SVG.pontos, onclick: (e) => { e.stopPropagation(); menu(e.currentTarget); } });
    const btNovo = el('button', { class: 'icone redondo branco', type: 'button', title: 'Nova ligação', 'aria-label': 'Nova ligação', html: SVG.mais, onclick: () => escolherELigar() });
    const prog = (s.sugestoes || []).filter((x) => x.motivo === 'lembrete').length;
    const acao = (rot, ic, fn, extra) => el('button', { class: 'lg-acao', type: 'button', onclick: fn }, el('i', { html: ic }), el('b', { text: rot }), extra ? el('small', { text: extra }) : null);
    const chip = (v, rot) => el('button', { class: 'chip', type: 'button', 'aria-pressed': String(s.filtro === v), onclick: () => { s.filtro = v; s.itens = []; s.proximo = null; carregar(); } }, document.createTextNode(rot));
    const lista = s.itens.length ? el('div', { class: 'lg-lista', role: 'list' }, ...s.itens.map(linhaChamada))
      : el('p', { class: 'lg-vazio', text: s.carregando ? 'Carregando…' : s.filtro === 'perdidas' ? 'Nenhuma ligação perdida.' : 'Nenhuma ligação ainda. Toque em Ligar para começar.' });
    s.caixa.replaceChildren(el('div', { class: 'lg' },
      el('div', { class: 'lg-barra' }, btMenu, btNovo),
      el('h1', { class: 'titulo-grande', text: 'Ligações' }),
      el('div', { class: 'lg-acoes' },
        acao('Ligar', SVG.tel, () => escolherELigar('Ligar')),
        acao('Programar', SVG.relogio, programar, prog ? `${prog} hoje` : ''),
        acao('Teclado', SVG.teclado, teclado),
        acao('Favoritos', SVG.estrela, favoritos)),
      el('div', { class: 'lg-cab' }, el('h2', { text: 'Recentes' }), el('div', { class: 'lg-chips', role: 'group', 'aria-label': 'Filtro' }, chip('todas', 'Todas'), chip('perdidas', 'Perdidas'))),
      lista,
      s.proximo ? el('button', { class: 'lg-mais', type: 'button', text: 'Carregar mais', onclick: () => carregar(true) }) : null,
      el('p', { class: 'lg-nota', text: 'Efetuadas: registradas quando alguém toca em Ligar (a ligação sai do celular; sem duração). Recebidas e perdidas: avisadas pelo WhatsApp da loja.' })));
  }

  async function carregar(mais = false) {
    const ui = s.ui; if (!ui) return;
    s.carregando = true; if (!mais) desenhar();
    try {
      const q = new URLSearchParams({ filtro: s.filtro, limite: '30' });
      if (mais && s.proximo) q.set('antes', s.proximo);
      const [r, sug] = await Promise.all([ui.api('/api/ligacoes/historico?' + q), mais ? Promise.resolve(null) : ui.api('/api/ligacoes').catch(() => null)]);
      s.itens = mais ? s.itens.concat(r.itens) : r.itens; s.proximo = r.proximo;
      if (sug) s.sugestoes = sug.sugestoes;
    } catch (x) { ui.toast(x.message); }
    finally { s.carregando = false; if (s.caixa?.isConnected) desenhar(); }
  }
  function recarregar() { if (s.caixa?.isConnected && s.caixa.offsetParent !== null) carregar(); }

  window.SintoniaTelas.ligacoes = {
    async desenhar(caixa, ui) { estilo(); s.ui = ui; s.caixa = caixa; await carregar(); },
    recarregar, ligar: (o) => { if (!s.ui) s.ui = window.Sintonia?.ui; estilo(); return ligar(o); }, favoritos: () => { s.ui ||= window.Sintonia?.ui; estilo(); return favoritos(); },
  };
})();
