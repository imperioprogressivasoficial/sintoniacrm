/* funil-atendimento (dono 28/11): Regras automáticas do funil "Atendimento".
 * O sistema (e a IA) move o lead sozinho; cada regra liga/desliga e o tempo é editável aqui, sem pedir para ninguém.
 * Abre num painel lateral (window.SintoniaPainel): window.SintoniaFunilRegras.abrir(ui).
 * - GET /api/funis/regras: regras + etapas do funil do sistema (nomes e cores para "→ Agendado Sumaré").
 * - PUT /api/funis/regras: grava só a regra que mudou (gestão). Quem não pode mudar vê, sem editar.
 * Texto do servidor entra sempre por textContent (ui.el(..., { text })). */
(() => {
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    entrar: I('<path d="M12 4v10M7.5 9.5 12 14l4.5-4.5"/><path d="M5 19h14"/>'),
    voltar: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    resposta: I('<path d="M4 5h16v11H8l-4 4Z"/><path d="M8 10h8"/>'),
    remarcar: I('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16"/><path d="m10 15 2 2 3-4"/>'),
    relogio: I('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'),
    agenda: I('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M4 10h16"/>'),
    feito: I('<circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    sino: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    cadeado: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
    mao: I('<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12"/><path d="M11 11.5V5a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 11.5V7a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.7-2.3L4 15.5a1.6 1.6 0 0 1 2.5-2L8 15"/>'),
    perda: I('<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  };
  const CSS = `
  .fr { display: grid; gap: 14px; }
  .fr-intro { margin: 0; color: var(--sub); font-size: 14px; line-height: 1.45; }
  .fr-trilha { display: flex; flex-wrap: wrap; gap: 6px; }
  .fr-etapa { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; background: color-mix(in srgb, var(--cor, #8B8D98) 14%, transparent); color: var(--texto); white-space: nowrap; }
  .fr-etapa i { width: 8px; height: 8px; border-radius: 50%; background: var(--cor, #8B8D98); flex: none; }
  .fr-cartao { display: grid; grid-template-columns: 36px 1fr auto; gap: 4px 12px; align-items: start; padding: 14px; border-radius: 18px; background: var(--painel); border: 1px solid var(--linha); }
  .fr-cartao.desligada { opacity: .72; }
  .fr-cartao > .fr-ic { width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #106ebe, #3aa0ff); }
  .fr-cartao > .fr-ic svg { width: 20px; height: 20px; }
  .fr-cartao h4 { margin: 0; font-size: 15px; font-weight: 700; line-height: 1.3; }
  .fr-cartao p { margin: 2px 0 0; font-size: 13.5px; color: var(--sub); line-height: 1.4; }
  .fr-para { grid-column: 2 / 4; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; color: var(--sub); }
  .fr-tempo { grid-column: 2 / 4; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 14px; }
  .fr-tempo input[type="number"] { width: 84px; height: 38px; box-sizing: border-box; border-radius: 10px; border: 1px solid var(--linha); background: var(--fundo); color: var(--texto); font: inherit; font-size: 15px; padding: 0 10px; }
  .fr-tempo input[type="text"] { width: 170px; height: 38px; box-sizing: border-box; border-radius: 10px; border: 1px solid var(--linha); background: var(--fundo); color: var(--texto); font: inherit; font-size: 15px; padding: 0 10px; }
  .fr-tempo input:focus-visible { outline: 2px solid var(--marca-menta, #0ffcbe); outline-offset: 1px; }
  .fr-tempo small { color: var(--sub); font-size: 12.5px; }
  .fr-tempo label { display: inline-flex; align-items: center; gap: 6px; color: var(--sub); font-size: 13.5px; cursor: pointer; }
  .fr-chave { appearance: none; -webkit-appearance: none; margin: 0; flex: none; width: 46px; height: 28px; border-radius: 999px; background: var(--linha); position: relative; cursor: pointer; transition: background .2s ease; }
  .fr-cartao .fr-chave { width: 46px !important; height: 28px !important; min-width: 0 !important; min-height: 0 !important; max-height: 28px; padding: 0 !important; border: 0 !important; }
  .fr-chave::after { content: ""; position: absolute; left: 3px; top: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .2s ease; }
  .fr-chave:checked { background: #0ffcbe; }
  .fr-chave:checked::after { transform: translateX(18px); }
  .fr-chave:disabled { cursor: default; opacity: .6; }
  .fr-chave:focus-visible { outline: 2px solid #3aa0ff; outline-offset: 2px; }
  .fr-fixa { color: var(--sub); display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; }
  .fr-fixa svg { width: 15px; height: 15px; }
  .fr-grupo { margin: 6px 2px 0; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--sub); }
  .fr-rodape { margin: 4px 2px 0; font-size: 12.5px; color: var(--sub); }
  .fr-aviso { padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, #3aa0ff 12%, transparent); font-size: 13.5px; line-height: 1.4; }
  @media (prefers-reduced-motion: reduce) { .fr-chave, .fr-chave::after { transition: none; } }
  `;
  function estilo() {
    if (document.getElementById('fr-estilo')) return;
    document.head.append(Object.assign(document.createElement('style'), { id: 'fr-estilo', textContent: CSS }));
  }
  const tempoBonito = (min) => (min >= 1440 && min % 1440 === 0 ? `${min / 1440} dia(s)` : min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`);

  async function abrir(ui) {
    const P = window.SintoniaPainel;
    if (!P || !ui) return;
    estilo();
    const { el } = ui;
    let dados = null;
    let corpo = null;
    let salvando = Promise.resolve();

    const etapa = (chave) => (dados?.etapas || []).filter((e) => e.chave === chave);
    const pilula = (e) => { const p = el('span', { class: 'fr-etapa' }, el('i'), el('span', { text: e.nome })); p.style.setProperty('--cor', e.cor || '#8B8D98'); return p; };
    const para = (chave, prefixo = 'Vai para') => el('div', { class: 'fr-para' }, el('span', { text: prefixo }), ...etapa(chave).map(pilula));

    function salvar(parte) {
      salvando = salvando.then(async () => {
        try {
          const r = await ui.api('/api/funis/regras', { method: 'PUT', body: JSON.stringify(parte) });
          if (r && r.regras) { dados = r; ui.toast('Regra salva'); } else { ui.toast('Não deu para salvar.'); }
        } catch (e) { ui.toast(e && e.status ? e.message : 'Não deu para salvar. Confira a internet.'); }
        desenhar();
      });
    }

    function chave(nomeRegra, rotulo) {
      const i = el('input', { type: 'checkbox', class: 'fr-chave', role: 'switch', 'aria-label': rotulo });
      i.checked = Boolean(dados.regras[nomeRegra].ligado);
      i.disabled = !dados.podeEditar;
      i.addEventListener('change', () => salvar({ [nomeRegra]: { ligado: i.checked } }));
      return i;
    }
    function minutos(nomeRegra, rotulo, depois, min, max) {
      const i = el('input', { type: 'number', min: String(min), max: String(max), step: '1', inputmode: 'numeric', 'aria-label': rotulo });
      i.value = String(dados.regras[nomeRegra].minutos);
      i.disabled = !dados.podeEditar;
      const dica = el('small', { text: `(${tempoBonito(dados.regras[nomeRegra].minutos)})` });
      i.addEventListener('change', () => {
        const n = Math.round(Number(i.value));
        if (!Number.isFinite(n) || n < min || n > max) { ui.toast(`Use de ${min} a ${tempoBonito(max)}.`); i.value = String(dados.regras[nomeRegra].minutos); return; }
        salvar({ [nomeRegra]: { minutos: n } });
      });
      return el('div', { class: 'fr-tempo' }, i, el('span', { text: 'minutos' }), dica, depois ? el('span', { text: depois }) : null);
    }
    function cartao({ icone, titulo, texto, regra, rotulo, extra = [], fixa = false }) {
      const ligada = fixa || Boolean(dados.regras[regra]?.ligado);
      return el('section', { class: 'fr-cartao' + (ligada ? '' : ' desligada') },
        el('span', { class: 'fr-ic', html: icone }),
        el('div', {}, el('h4', { text: titulo }), el('p', { text: texto })),
        fixa ? el('span', { class: 'fr-fixa', title: 'Sempre ligada' }, el('span', { html: IC.cadeado, style: 'display:grid' }), el('span', { text: 'Sempre' })) : chave(regra, rotulo || titulo),
        ...extra);
    }

    function desenhar() {
      if (!corpo) return;
      if (!dados) { corpo.replaceChildren(el('p', { class: 'fr-intro', text: 'Carregando…' })); return; }
      const r = dados.regras;
      const nomeTag = el('input', { type: 'text', maxlength: '30', 'aria-label': 'Nome da tag que pede para remarcar' });
      nomeTag.value = r.remarcar.tag; nomeTag.disabled = !dados.podeEditar;
      nomeTag.addEventListener('change', () => { const v = nomeTag.value.trim(); if (!v) { nomeTag.value = r.remarcar.tag; return; } salvar({ remarcar: { tag: v } }); });
      const soAberta = el('input', { type: 'checkbox' }); soAberta.checked = Boolean(r.alertaEntrada.soNoHorario); soAberta.disabled = !dados.podeEditar;
      soAberta.addEventListener('change', () => salvar({ alertaEntrada: { soNoHorario: soAberta.checked } }));
      const quando = dados.atualizadoEm ? new Date(dados.atualizadoEm) : null;

      corpo.replaceChildren(el('div', { class: 'fr' },
        el('p', { class: 'fr-intro', text: 'O sistema e a IA movem o lead sozinhos pelo funil Atendimento. Desligue o que não quiser e mude os tempos quando precisar.' }),
        el('div', { class: 'fr-trilha', 'aria-label': 'Etapas do funil' }, ...(dados.etapas || []).map(pilula)),
        dados.podeEditar ? null : el('div', { class: 'fr-aviso', text: 'Só a gestão muda estas regras. Você pode ver como o funil anda sozinho.' }),

        el('h3', { class: 'fr-grupo', text: 'Chegada e resposta' }),
        cartao({ icone: IC.entrar, titulo: 'Lead novo chegou', texto: 'Toda mensagem de um lead novo entra em Novo lead. Ninguém fica parado aqui: a IA ou a equipe responde.', fixa: true, extra: [para('entrada', 'Entra em')] }),
        cartao({ icone: IC.resposta, titulo: 'A loja respondeu', texto: 'Quando a IA ou alguém da equipe responde o lead em Novo lead.', regra: 'lojaRespondeu', extra: [para('em_conversa')] }),
        cartao({ icone: IC.voltar, titulo: 'Voltou a escrever', texto: 'Quem estava em Finalizado ou Perdido e mandou mensagem de novo volta para ser respondida.', regra: 'voltouEscrever', extra: [para('entrada')] }),
        cartao({ icone: IC.relogio, titulo: 'Cliente não responde', texto: 'A loja respondeu e a cliente ficou sem responder. Quando ela responder, volta para Em atendimento.', regra: 'semResposta', extra: [minutos('semResposta', 'Minutos sem resposta da cliente', 'depois da resposta da loja', 5, 43200), para('sem_resposta')] }),
        cartao({ icone: IC.sino, titulo: 'Alerta de lead parado', texto: 'Lead em Novo lead sem resposta da loja: a responsável (ou a unidade) e a gerência recebem um aviso.', regra: 'alertaEntrada', extra: [
          minutos('alertaEntrada', 'Minutos sem resposta para avisar', 'sem resposta', 1, 1440),
          el('div', { class: 'fr-tempo' }, el('label', {}, soAberta, el('span', { text: 'Só com a loja aberta (horário da unidade)' }))),
        ] }),

        el('h3', { class: 'fr-grupo', text: 'Agenda' }),
        cartao({ icone: IC.agenda, titulo: 'Agendou ou remarcou', texto: 'A IA ou a equipe marcou (ou remarcou) o horário. Vai para o Agendado da unidade do horário.', regra: 'agendou', extra: [para('agendada')] }),
        cartao({ icone: IC.remarcar, titulo: 'Pediu para remarcar', texto: 'A cliente disse que não vai conseguir ir, pediu para remarcar na confirmação, cancelou ou faltou.', regra: 'remarcar', extra: [
          el('div', { class: 'fr-tempo' }, el('span', { text: 'Também quando marcam a tag' }), nomeTag),
          para('reagendar'),
        ] }),
        cartao({ icone: IC.feito, titulo: 'Passou o horário', texto: 'Terminou o horário agendado e ninguém marcou falta. O pós-venda começa aqui.', regra: 'finalizado', extra: [minutos('finalizado', 'Minutos depois do fim do horário', 'depois do fim do horário', 0, 1440), para('compareceu')] }),

        el('h3', { class: 'fr-grupo', text: 'Sempre com a equipe' }),
        cartao({ icone: IC.perda, titulo: 'Perdido', texto: 'Só a equipe ou a IA marcam, sempre com o motivo. O sistema nunca marca perda sozinho.', fixa: true, extra: [para('perdida', 'Etapa')] }),
        cartao({ icone: IC.mao, titulo: 'Mover à mão vence', texto: 'Se alguém da equipe mover o lead, as regras de tempo não mexem nele de novo pelo mesmo motivo.', fixa: true }),
        quando ? el('p', { class: 'fr-rodape', text: `Mudado por último por ${dados.atualizadoPor || 'alguém da equipe'} em ${quando.toLocaleDateString('pt-BR')} às ${quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` }) : null,
      ));
    }

    // Já com o painel aberto (ex.: Automações do pipeline): entra como página nova, com seta de voltar.
    if (P.aberto() && !P.aberto('funil-regras')) P.empurrar({ titulo: 'Regras automáticas', montar: (c) => { corpo = c; desenhar(); }, aoSair: () => { corpo = null; } });
    else P.abrir({ id: 'funil-regras', titulo: 'Regras automáticas', larga: true, montar: (c) => { corpo = c; desenhar(); }, aoFechar: () => { corpo = null; } });
    try {
      dados = await ui.api('/api/funis/regras');
    } catch { dados = null; }
    if (!dados || !dados.regras) { if (corpo) corpo.replaceChildren(el('p', { class: 'fr-intro', text: 'Não deu para carregar as regras agora.' })); return; }
    desenhar();
  }

  window.SintoniaFunilRegras = { abrir };
})();
