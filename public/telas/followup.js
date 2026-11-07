/* Follow-up automático e confirmação de agenda (src/followup). Registra window.SintoniaTelas.followup = {
 *   desenhar(caixa, ui)                  — aba "Follow-up" dentro de Automações (cadências por situação + confirmação de agenda);
 *   seloConversa(caixa, conversaId, ui)  — faixa na conversa: "Follow-up 2/3 em 1 dia" com pausar, e o status da confirmação;
 *   seloConfirmacao(ui, status)          — selo da Agenda: Aguardando / Confirmado / Remarcar / Sem resposta }.
 * Texto do servidor entra sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const STATUS = {
    aguardando: ['Aguardando', 'fu-aguardando'],
    confirmado: ['Confirmado', 'fu-confirmado'],
    remarcar: ['Remarcar', 'fu-remarcar'],
    sem_resposta: ['Sem resposta', 'fu-semresp'],
  };
  const UNIDADES = { norte: 'Salvador Norte', sumare: 'Sumaré' };
  const VARIAVEIS = ['{primeiro_nome}', '{nome}', '{servico}', '{unidade}', '{data}', '{hora}'];

  const CSS = `
  .fu-selo { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 999px; font-size: 11.5px; font-weight: 700; font-style: normal; white-space: nowrap;
    background: var(--vidro-item, rgba(255,255,255,.5)); box-shadow: inset 0 0 0 1px var(--vidro-borda, rgba(16,110,190,.2)); color: var(--texto); }
  .fu-selo::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .9; }
  .fu-selo.fu-aguardando { color: #b07a00 !important; } .fu-selo.fu-confirmado { color: #087a5c !important; } .fu-selo.fu-remarcar { color: #c4313b !important; } .fu-selo.fu-semresp { color: #5a6b7d !important; }
  html[data-tema="escuro"] .fu-selo.fu-aguardando { color: #f5c542 !important; } html[data-tema="escuro"] .fu-selo.fu-confirmado { color: #0ffcbe !important; } html[data-tema="escuro"] .fu-selo.fu-remarcar { color: #ff8a8f !important; } html[data-tema="escuro"] .fu-selo.fu-semresp { color: #a9b8c8 !important; }
  .fu-faixa { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 12px; font-size: 12.5px; color: var(--sub); border-bottom: 1px solid var(--vidro-borda, var(--linha)); background: var(--vidro-fundo, transparent); }
  .fu-faixa[hidden] { display: none; }
  .fu-faixa b { color: var(--texto); font-weight: 700; }
  .fu-mini { all: unset; cursor: pointer; font-size: 12px; font-weight: 700; color: var(--marca-azul); padding: 4px 10px; border-radius: 999px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--marca-azul) 35%, transparent); }
  html[data-tema="escuro"] .fu-mini { color: var(--marca-menta); box-shadow: inset 0 0 0 1px rgba(15,252,190,.4); }
  .fu-tela { max-width: 980px; margin: 0 auto; display: grid; gap: 16px; }
  .fu-sub { margin: 0 2px; color: var(--sub); font-size: 14.5px; line-height: 1.45; }
  .fu-cartao { border-radius: 24px; padding: 18px; display: grid; gap: 14px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho);
    -webkit-backdrop-filter: blur(18px) saturate(1.4); backdrop-filter: blur(18px) saturate(1.4); min-width: 0; }
  .fu-cab { display: flex; align-items: flex-start; gap: 12px; }
  .fu-cab > div { flex: 1; min-width: 0; display: grid; gap: 3px; }
  .fu-cab h2 { margin: 0; font-family: var(--fonte-titulo); font-size: 18px; letter-spacing: -.01em; }
  .fu-cab small { color: var(--sub); font-size: 13px; line-height: 1.4; }
  .fu-chave { position: relative; flex: none; width: 48px; height: 28px; border-radius: 999px; cursor: pointer; background: rgba(90,107,125,.35); transition: background .2s; border: 0; padding: 0; }
  .fu-chave::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .2s; }
  .fu-chave[aria-checked="true"] { background: var(--marca-menta); box-shadow: 0 0 14px rgba(15,252,190,.45); }
  .fu-chave[aria-checked="true"]::after { transform: translateX(20px); }
  .fu-chave:focus-visible { outline: 2px solid var(--marca-azul); outline-offset: 2px; }
  .fu-passos { display: grid; gap: 10px; }
  .fu-passo { display: grid; gap: 8px; padding: 12px; border-radius: 18px; background: var(--vidro-item); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fu-linha { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
  .fu-linha label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .fu-num { width: 64px; }
  .fu-tela input[type=number], .fu-tela input[type=text], .fu-tela select, .fu-tela textarea { font: inherit; font-size: 14px; color: var(--texto); background: var(--entrada); border: 1px solid var(--linha); border-radius: 12px; padding: 8px 10px; box-sizing: border-box; min-width: 0; }
  .fu-tela textarea { width: 100%; min-height: 104px; resize: vertical; line-height: 1.4; }
  .fu-tela input[type=text].fu-larga { flex: 1 1 220px; }
  .fu-n { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; font-size: 12px; font-weight: 800; background: var(--marca-azul); color: #fff; flex: none; }
  .fu-x { all: unset; cursor: pointer; margin-left: auto; color: var(--sub); font-size: 13px; padding: 4px 8px; border-radius: 10px; }
  .fu-x:hover { color: #c4313b; }
  .fu-acoes { display: flex; gap: 8px; flex-wrap: wrap; }
  .fu-botao { all: unset; cursor: pointer; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 0 16px; border-radius: 999px; font-weight: 700; font-size: 14px;
    background: var(--vidro-item); color: var(--texto); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  .fu-botao.forte { background: var(--marca-menta); color: #071d33; box-shadow: 0 0 0 1px color-mix(in srgb, var(--marca-menta) 45%, transparent), 0 8px 26px color-mix(in srgb, var(--marca-menta) 36%, transparent); }
  .fu-salvar { position: sticky; bottom: 20px; z-index: 3; display: flex; justify-content: flex-end; }
  .fu-vars { font-size: 12px; color: var(--sub); }
  .fu-vars code { font-size: 11.5px; padding: 1px 5px; border-radius: 6px; background: var(--vidro-item); }
  .fu-unidades { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
  .fu-abas { display: inline-flex; gap: 2px; padding: 4px; border-radius: 999px; background: var(--vidro-fundo); box-shadow: inset 0 0 0 1px var(--vidro-borda), var(--vidro-brilho); justify-self: start; }
  .fu-abas button { all: unset; cursor: pointer; height: 36px; padding: 0 16px; border-radius: 999px; font-size: 14px; font-weight: 650; color: var(--sub); display: inline-flex; align-items: center; }
  .fu-abas button[aria-pressed="true"] { color: var(--texto); font-weight: 750; background: var(--vidro-ativo, rgba(255,255,255,.7)); box-shadow: inset 0 0 0 1px var(--vidro-borda); }
  @media (max-width: 860px) { .fu-cartao { padding: 14px; border-radius: 20px; } .fu-salvar { bottom: 104px; } }
  `;
  if (!document.getElementById('fu-css')) {
    const st = document.createElement('style');
    st.id = 'fu-css';
    st.textContent = CSS;
    document.head.append(st);
  }

  function seloConfirmacao(ui, status) {
    const [txt, cls] = STATUS[status] || STATUS.aguardando;
    return ui.el('span', { class: 'fu-selo ' + cls, title: 'Confirmação automática da agenda', text: txt });
  }

  function emQuanto(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 60000) return 'agora';
    const min = Math.round(ms / 60000);
    if (min < 60) return `em ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `em ${h} h`;
    const d = Math.round(h / 24);
    return `em ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }

  // ---------- faixa da conversa ----------
  const cacheConversa = { id: null, em: 0 };
  async function seloConversa(caixa, conversaId, ui, forcar) {
    if (!caixa || !conversaId) return;
    if (!forcar && cacheConversa.id === conversaId && Date.now() - cacheConversa.em < 20000) return;
    cacheConversa.id = conversaId; cacheConversa.em = Date.now();
    let d;
    try { d = await ui.api(`/api/followup/conversa/${conversaId}`); } catch { caixa.hidden = true; return; }
    const el = ui.el;
    const partes = [];
    if (d.cadencia) {
      partes.push(el('span', {}, el('b', { text: `Follow-up ${d.cadencia.passo}/${d.cadencia.total} ${emQuanto(d.cadencia.quando)}` }), el('span', { text: ` · ${d.cadencia.nome}` })));
      partes.push(el('button', { class: 'fu-mini', type: 'button', text: 'Pausar', onclick: async () => { try { await ui.post(`/api/followup/conversa/${conversaId}/pausar`, {}); ui.toast('Follow-up pausado nesta conversa.'); } catch (x) { ui.toast(x.message); } seloConversa(caixa, conversaId, ui, true); } }));
    } else if (d.pausado) {
      partes.push(el('span', { text: 'Follow-up pausado' }));
      partes.push(el('button', { class: 'fu-mini', type: 'button', text: 'Retomar', onclick: async () => { try { await ui.post(`/api/followup/conversa/${conversaId}/retomar`, {}); } catch (x) { ui.toast(x.message); } seloConversa(caixa, conversaId, ui, true); } }));
    }
    if (d.confirmacao) {
      const ini = new Date(d.confirmacao.inicio);
      const quando = ini.toLocaleString('pt-BR', { timeZone: 'America/Bahia', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      partes.push(el('span', { style: 'display:inline-flex;align-items:center;gap:6px' }, el('span', { text: `Agenda ${quando}` }), seloConfirmacao(ui, d.confirmacao.status)));
    }
    caixa.replaceChildren(...partes);
    caixa.hidden = partes.length === 0;
  }

  // ---------- aba Follow-up (Automações) ----------
  async function desenhar(caixa, ui) {
    const el = ui.el;
    const tela = el('div', { class: 'fu-tela' });
    caixa.replaceChildren(tela);
    tela.append(el('p', { class: 'fu-sub', text: 'Mensagens que a Sintonia manda sozinha quando a cliente some, e a confirmação de cada horário marcado. Tudo para quando a cliente responde ou alguém da equipe assume, e só sai com a loja aberta.' }));
    let dados, modelos = [];
    try { [dados, modelos] = await Promise.all([ui.api('/api/followup/config'), ui.api('/api/email/modelos').catch(() => [])]); } catch (x) { tela.append(el('p', { class: 'fu-sub', text: x.message })); return; }
    if (!Array.isArray(modelos)) modelos = modelos?.modelos || [];
    const cfg = dados.config;
    const situacao = Object.fromEntries(dados.situacoes.map((s) => [s.id, s]));

    const chave = (ligada, aoMudar, rotulo) => {
      const b = el('button', { class: 'fu-chave', type: 'button', role: 'switch', 'aria-checked': String(!!ligada), 'aria-label': rotulo });
      b.onclick = () => { const v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(v)); aoMudar(v); };
      return b;
    };
    const num = (valor, aoMudar, extra = {}) => { const i = el('input', { type: 'number', class: 'fu-num', min: '0', step: 'any', value: String(valor), ...extra }); i.oninput = () => aoMudar(Number(i.value)); return i; };
    const area = (valor, aoMudar, rotulo) => { const t = el('textarea', { 'aria-label': rotulo }); t.value = valor || ''; t.oninput = () => aoMudar(t.value); return t; };
    const seletorModelo = (valor, aoMudar) => {
      const s = el('select', { 'aria-label': 'Modelo de e-mail' }, el('option', { value: '', text: modelos.length ? 'Escolha o modelo de e-mail' : 'Nenhum modelo (E-mail marketing)' }), ...modelos.map((m) => el('option', { value: m.id, text: m.nome })));
      s.value = valor || ''; s.onchange = () => aoMudar(s.value || null); return s;
    };
    const vars = () => el('div', { class: 'fu-vars' }, 'Variáveis: ', ...VARIAVEIS.flatMap((v) => [el('code', { text: v }), ' ']));

    // Confirmação de agenda.
    const conf = cfg.confirmacao;
    const cConf = el('section', { class: 'fu-cartao' });
    const unidades = el('div', { class: 'fu-unidades' });
    for (const [u, nome] of Object.entries(UNIDADES)) {
      const uc = (conf.unidades[u] = conf.unidades[u] || { ligada: true, horasAntes: [24, 2] });
      const horas = el('div', { class: 'fu-linha' });
      const desenharHoras = () => horas.replaceChildren(...uc.horasAntes.map((h, k) => el('label', {}, num(h, (v) => { uc.horasAntes[k] = v; }, { 'aria-label': `${k === 0 ? 'Confirmação' : 'Lembrete'} horas antes` }), el('span', { text: k === 0 ? 'h antes (confirmação)' : 'h antes (lembrete)' }))),
        uc.horasAntes.length < 3 ? el('button', { class: 'fu-mini', type: 'button', text: '+ lembrete', onclick: () => { uc.horasAntes.push(1); desenharHoras(); } }) : null,
        uc.horasAntes.length > 1 ? el('button', { class: 'fu-x', type: 'button', text: 'tirar último', onclick: () => { uc.horasAntes.pop(); desenharHoras(); } }) : null);
      desenharHoras();
      unidades.append(el('div', { class: 'fu-passo' }, el('div', { class: 'fu-linha' }, el('b', { text: nome, style: 'flex:1' }), chave(uc.ligada, (v) => { uc.ligada = v; }, `Confirmação na unidade ${nome}`)), horas));
    }
    cConf.append(
      el('div', { class: 'fu-cab' }, el('div', {}, el('h2', { text: 'Confirmação automática de agenda' }), el('small', { text: 'Para cada horário marcado: mensagem no WhatsApp com "1 - Confirmo / 2 - Preciso remarcar". "1" confirma; "2" marca a tag, avisa a equipe e mostra "Remarcar" na Agenda.' })), chave(conf.ligada, (v) => { conf.ligada = v; }, 'Confirmação de agenda')),
      unidades,
      el('div', { class: 'fu-passo' }, el('b', { text: 'Mensagem de confirmação' }), area(conf.texto, (v) => { conf.texto = v; }, 'Mensagem de confirmação'),
        el('b', { text: 'Lembrete (ainda sem resposta)' }), area(conf.textoLembrete, (v) => { conf.textoLembrete = v; }, 'Lembrete'),
        el('b', { text: 'Lembrete (já confirmou)' }), area(conf.textoLembreteConfirmado, (v) => { conf.textoLembreteConfirmado = v; }, 'Lembrete confirmado'),
        el('b', { text: 'Resposta ao "1"' }), area(conf.textoConfirmado, (v) => { conf.textoConfirmado = v; }, 'Resposta ao 1'),
        el('b', { text: 'Resposta ao "2"' }), area(conf.textoRemarcar, (v) => { conf.textoRemarcar = v; }, 'Resposta ao 2'), vars()),
      el('div', { class: 'fu-linha' }, el('label', {}, (() => { const c = el('input', { type: 'checkbox' }); c.checked = conf.email; c.onchange = () => { conf.email = c.checked; }; return c; })(), el('span', { text: 'Também por e-mail (quem tem e-mail na ficha)' })),
        seletorModelo(conf.emailModeloId, (v) => { conf.emailModeloId = v; })),
      el('div', { class: 'fu-linha' }, el('span', { text: 'Tag para quem quer remarcar:' }), (() => { const i = el('input', { type: 'text', value: conf.tagRemarcar, maxlength: '30' }); i.oninput = () => { conf.tagRemarcar = i.value; }; return i; })()),
    );
    tela.append(cConf);

    // Cadências.
    for (const cad of cfg.cadencias) {
      const s = situacao[cad.id];
      const card = el('section', { class: 'fu-cartao' });
      const passos = el('div', { class: 'fu-passos' });
      const desenharPassos = () => passos.replaceChildren(...cad.passos.map((p, k) => {
        const dias = p.esperaHoras >= 24 && p.esperaHoras % 24 === 0;
        const unidade = el('select', { 'aria-label': 'Unidade de tempo' }, el('option', { value: 'h', text: 'horas' }), el('option', { value: 'd', text: 'dias' }));
        unidade.value = dias ? 'd' : 'h';
        const qtd = num(dias ? p.esperaHoras / 24 : p.esperaHoras, () => {}, { 'aria-label': 'Esperar' });
        const atualizar = () => { const n = Number(qtd.value) || 0; p.esperaHoras = Math.max(0.25, unidade.value === 'd' ? n * 24 : n); };
        qtd.oninput = atualizar; unidade.onchange = atualizar;
        const objetivo = el('input', { type: 'text', class: 'fu-larga', placeholder: 'Objetivo para a IA (ex.: convidar para agendar sem pressionar)', value: p.objetivo || '' });
        objetivo.oninput = () => { p.objetivo = objetivo.value; };
        objetivo.hidden = !p.ia;
        const ia = el('input', { type: 'checkbox' }); ia.checked = p.ia; ia.onchange = () => { p.ia = ia.checked; objetivo.hidden = !ia.checked; };
        const em = el('input', { type: 'checkbox' }); em.checked = p.email;
        const modelo = seletorModelo(p.emailModeloId, (v) => { p.emailModeloId = v; }); modelo.hidden = !p.email;
        em.onchange = () => { p.email = em.checked; modelo.hidden = !em.checked; };
        return el('div', { class: 'fu-passo' },
          el('div', { class: 'fu-linha' }, el('span', { class: 'fu-n', text: String(k + 1) }), el('span', { text: k === 0 ? 'Esperar' : 'Depois, esperar' }), qtd, unidade, el('span', { text: '→ mandar:' }),
            cad.passos.length > 1 ? el('button', { class: 'fu-x', type: 'button', text: 'Remover', onclick: () => { cad.passos.splice(k, 1); desenharPassos(); } }) : null),
          area(p.texto, (v) => { p.texto = v; }, `Mensagem do passo ${k + 1}`),
          el('div', { class: 'fu-linha' }, el('label', {}, ia, el('span', { text: 'A IA escreve com este objetivo' })), objetivo),
          el('div', { class: 'fu-linha' }, el('label', {}, em, el('span', { text: 'Também por e-mail' })), modelo));
      }));
      desenharPassos();
      card.append(
        el('div', { class: 'fu-cab' }, el('div', {}, el('h2', { text: s?.nome || cad.id }), el('small', { text: s?.gatilho || '' })), chave(cad.ligada, (v) => { cad.ligada = v; }, `Cadência ${s?.nome || cad.id}`)),
        passos,
        el('div', { class: 'fu-acoes' },
          cad.passos.length < 6 ? el('button', { class: 'fu-botao', type: 'button', text: '+ Passo', onclick: () => { cad.passos.push({ esperaHoras: 24, texto: '', ia: false, objetivo: '', email: false, emailModeloId: null }); desenharPassos(); } }) : null,
          el('button', { class: 'fu-botao', type: 'button', text: 'Usar modelo pronto', onclick: () => { cad.passos = JSON.parse(JSON.stringify(s.modelo.passos)); cad.pararSeResponder = s.modelo.pararSeResponder; desenharPassos(); ui.toast('Modelo pronto aplicado. Salve para valer.'); } }),
          el('label', { class: 'fu-linha' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = cad.pararSeResponder; c.onchange = () => { cad.pararSeResponder = c.checked; }; return c; })(), el('span', { text: 'Parar quando a cliente responder' }))),
        vars());
      tela.append(card);
    }

    // Regras gerais.
    const geral = el('section', { class: 'fu-cartao' },
      el('div', { class: 'fu-cab' }, el('div', {}, el('h2', { text: 'Regras gerais' }), el('small', { text: 'Valem para todas as cadências.' }))),
      el('div', { class: 'fu-linha' }, el('span', { text: 'No máximo' }), num(cfg.limiteSemana, (v) => { cfg.limiteSemana = Math.round(v); }, { min: '1', max: '30', 'aria-label': 'Limite por semana' }), el('span', { text: 'mensagens de follow-up por cliente a cada 7 dias' })),
      el('label', { class: 'fu-linha' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = cfg.respeitarHorario; c.onchange = () => { cfg.respeitarHorario = c.checked; }; return c; })(), el('span', { text: 'Só enviar com a loja aberta' })),
      el('label', { class: 'fu-linha' }, (() => { const c = el('input', { type: 'checkbox' }); c.checked = cfg.pararQuandoEquipeAssume; c.onchange = () => { cfg.pararQuandoEquipeAssume = c.checked; }; return c; })(), el('span', { text: 'Parar quando alguém da equipe responder ou assumir' })));
    tela.append(geral);

    const salvar = el('button', { class: 'fu-botao forte', type: 'button', text: 'Salvar follow-up' });
    salvar.onclick = async () => {
      salvar.disabled = true;
      try {
        const r = await ui.api('/api/followup/config', { method: 'PUT', body: JSON.stringify(cfg), headers: { 'content-type': 'application/json' } });
        Object.assign(cfg, r.config);
        ui.toast('Follow-up salvo. Já está valendo.');
      } catch (x) { ui.toast(x.message || 'Não deu para salvar.'); }
      salvar.disabled = false;
    };
    tela.append(el('div', { class: 'fu-salvar' }, salvar));
  }

  /** Abas "Automações | Follow-up" no topo da tela de Automações. */
  function abas(ui, ativa, aoTrocar) {
    const el = ui.el;
    return el('div', { class: 'fu-abas', role: 'group', 'aria-label': 'Automações ou follow-up' },
      ...[['automacoes', 'Automações'], ['followup', 'Follow-up']].map(([v, n]) => el('button', { type: 'button', 'aria-pressed': String(ativa === v), text: n, onclick: () => aoTrocar(v) })));
  }

  window.SintoniaTelas.followup = { desenhar, seloConversa, seloConfirmacao, abas };
})();
