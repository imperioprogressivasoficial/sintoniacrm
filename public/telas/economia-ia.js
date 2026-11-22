/* calculadora: "Quanto a IA economiza" (Inteligência › Quanto economiza). Para a gestão provar que a IA compensa.
 * Aba do estúdio de agentes (/telas/agentes-ia.js chama window.SintoniaTelas.economiaIa.desenhar(ctx)).
 * Lê GET /api/economia-ia?dias=7|30|90 (números reais: mensagens, conversas, fora do horário, agendamentos e
 * 1ª resposta da IA) e mostra a conta com o custo de uma pessoa. Os campos mudam a conta na hora (sem gravar);
 * administração e direção gravam para a empresa (PUT /api/economia-ia/custo).
 * Não vende nada: sem tabela de preços, compra ou link de pagamento. Texto do servidor sempre por textContent. */
window.SintoniaTelas = window.SintoniaTelas || {};
(() => {
  const ICONE = {
    msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11.6a8.3 8.3 0 0 1-12.3 7.3L3.5 20l1.2-4A8.3 8.3 0 1 1 20 11.6Z"/></svg>',
    pessoas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>',
    lua: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
    agenda: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17M8.5 14.5l2 2 4-4"/></svg>',
    relogio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    raio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12l1-8Z"/></svg>',
    ajuste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    sol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  };
  const CSS = `
  .ecx { display: grid; gap: 16px; min-width: 0; }
  .ecx-heroi { position: relative; overflow: hidden; display: grid; gap: 6px; padding: 20px; border-radius: 22px; color: #fff; background: linear-gradient(150deg, #0d2240, #0a3563 60%, #106ebe); box-shadow: 0 18px 44px rgba(13,34,64,.22); }
  .ecx-heroi::after { content: ''; position: absolute; left: 20px; right: 20px; bottom: 0; height: 1px; background: linear-gradient(90deg, transparent, #0ffcbe, #3aa0ff, transparent); opacity: .9; }
  .ecx-heroi .ecx-rot { font-size: 13.5px; font-weight: 650; color: rgba(255,255,255,.8); }
  .ecx-heroi .ecx-valor { font: 800 clamp(34px, 6vw, 54px)/1.05 var(--fonte-titulo, inherit); letter-spacing: -.02em; color: #0ffcbe; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .ecx-heroi.menos .ecx-valor { color: #fff; }
  .ecx-heroi p { margin: 0; font-size: 14.5px; line-height: 1.45; color: rgba(255,255,255,.88); }
  .ecx-heroi p b { color: #fff; }
  .ecx-blocos { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  @media (min-width: 900px) { .ecx-blocos { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .ecx-bloco { display: grid; gap: 4px; align-content: start; padding: 14px; border-radius: 18px; background: var(--vidro-fundo, var(--fundo)); border: 1px solid var(--vidro-borda, var(--linha)); box-shadow: var(--vidro-brilho, none); min-width: 0; }
  .ecx-ic { flex: none; width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: rgba(16,110,190,.1); color: var(--marca-azul, #106ebe); }
  [data-tema="escuro"] .ecx-ic { background: rgba(15,252,190,.12); color: var(--marca-menta, #0ffcbe); }
  .ecx-ic svg { width: 18px; height: 18px; }
  .ecx-bloco b { font: 800 24px/1.15 var(--fonte-titulo, inherit); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .ecx-bloco span { font-size: 13px; color: var(--sub); line-height: 1.35; }
  .ecx-duas { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
  .ecx-duas > .agx-vidro { align-content: start; }
  .ecx-barras { display: grid; gap: 12px; }
  .ecx-barra { display: grid; gap: 6px; }
  .ecx-barra-cab { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; }
  .ecx-barra-cab b { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ecx-trilho { height: 12px; border-radius: 999px; background: var(--linha); overflow: hidden; }
  .ecx-trilho i { display: block; height: 100%; width: var(--w, 0%); border-radius: inherit; background: linear-gradient(90deg, #106ebe, #3aa0ff); transition: width .45s cubic-bezier(.2,.8,.2,1); }
  .ecx-trilho.menta i { background: linear-gradient(90deg, #3aa0ff, #0ffcbe); }
  .ecx-trilho.gente i { background: linear-gradient(90deg, #f08a6c, #ffb199); }
  .ecx-campos { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); align-items: end; }
  @media (min-width: 560px) { .ecx-campos { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (min-width: 1000px) { .ecx-campos { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .ecx-campos > .agx-campo { min-width: 0; }
  .ecx-campos > .agx-campo > .ecx-entrada { font-size: 15px; font-weight: 600; color: var(--texto); }
  .ecx-entrada { display: flex; align-items: center; gap: 6px; padding: 0 12px; min-width: 0; min-height: 44px; border-radius: 14px; border: 1px solid var(--linha); background: var(--entrada, var(--fundo)); }
  .ecx-entrada:focus-within { border-color: var(--marca-azul, #106ebe); box-shadow: 0 0 0 3px rgba(16,110,190,.18); }
  .ecx-entrada i { font-style: normal; font-size: 13px; color: var(--sub); flex: none; }
  .ecx-entrada input { all: unset; flex: 1 1 0; width: 0; min-width: 0; font-size: 15px; font-weight: 600; color: var(--texto); font-variant-numeric: tabular-nums; }
  .ecx-entrada input::-webkit-inner-spin-button, .ecx-entrada input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .ecx-entrada input[type=number] { -moz-appearance: textfield; }
  .ecx-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .ecx-nota { margin: 0; font-size: 12.5px; color: var(--sub); line-height: 1.5; }
  .ecx-vazio { display: flex; gap: 12px; align-items: flex-start; }
  .ecx-vazio .ecx-ic { flex: none; }
  @media (prefers-reduced-motion: reduce) { .ecx-trilho i { transition: none; } }
  `;
  function estilo() {
    if (document.getElementById('ecx-css')) return;
    document.head.append(Object.assign(document.createElement('style'), { id: 'ecx-css', textContent: CSS }));
  }

  const brl = (n) => (n < 0 ? '− ' : '') + 'R$ ' + Math.round(Math.abs(n)).toLocaleString('pt-BR');
  const num = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const plural = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;
  const tempo = (ms) => {
    if (ms == null) return '—';
    const s = ms / 1000;
    if (s < 60) return `${Math.max(1, Math.round(s))} s`;
    const m = s / 60;
    return m < 60 ? `${Math.round(m)} min` : `${num(Math.round((m / 60) * 10) / 10)} h`;
  };
  const CAMPOS = [
    ['salario', 'Salário por pessoa', 'R$', '', 50],
    ['encargosPct', 'Encargos (INSS, FGTS, férias…)', '', '%', 1],
    ['beneficios', 'Benefícios por pessoa', 'R$', '', 50],
    ['horasSemana', 'Jornada', '', 'h por semana', 1],
    ['minutosPorMensagem', 'Tempo por mensagem', '', 'min', 0.5],
    ['custoIaMes', 'O que a empresa paga pela IA', 'R$', 'por mês', 1],
  ];
  let dias = 30;
  let rascunho = null; // valores digitados ainda não gravados

  async function desenhar(ctx) {
    estilo();
    const { el, ui, conteudo } = ctx;
    const consulta = () => {
      const q = new URLSearchParams({ dias: String(dias) });
      if (rascunho) for (const [k, v] of Object.entries(rascunho)) if (v !== '' && Number.isFinite(Number(v))) q.set(k, String(v));
      return ui.api('/api/economia-ia?' + q.toString());
    };
    let d = await consulta();
    if (!ctx.vivo()) return;

    const caixa = el('div', { class: 'ecx' });
    const periodo = el('div', { class: 'agx-seg', role: 'group', 'aria-label': 'Período' },
      ...[[7, '7 dias'], [30, '30 dias'], [90, '90 dias']].map(([v, nome]) => el('button', { type: 'button', 'aria-pressed': String(v === dias), text: nome, onclick: () => { if (dias === v) return; dias = v; desenhar(ctx).catch((x) => ui.toast((x && x.message) || 'Não deu para carregar.')); } })));
    const resultado = el('div', { class: 'ecx' });

    const pintar = () => {
      const r = d.real;
      const ganhou = d.saldoPeriodo >= 0;
      const nos = `nos últimos ${d.dias} dias`;
      const heroi = d.temDados
        ? el('div', { class: 'ecx-heroi' + (ganhou ? '' : ' menos'), role: 'status' },
          el('span', { class: 'ecx-rot', text: ganhou ? `A IA economizou ${nos}` : `Em horas de trabalho, a IA ainda não se pagou ${nos}. Faltam` }),
          el('span', { class: 'ecx-valor', text: brl(Math.abs(d.saldoPeriodo)) }),
          d.pessoasEquivalentes >= 0.1
            ? el('p', {}, el('span', { text: 'Ela fez o trabalho de ' }), el('b', { text: plural(d.pessoasEquivalentes, 'pessoa', 'pessoas') }),
              el('span', { text: ` na jornada inteira: ${num(d.horasPoupadas)} h que valem ${brl(d.valorHoras)}, contra ${brl(d.custoIaPeriodo)} da IA no período.` }))
            : el('p', { text: `Ela fez ${num(d.horasPoupadas)} h de trabalho, que valem ${brl(d.valorHoras)}, contra ${brl(d.custoIaPeriodo)} da IA no período.` }),
          r.valorIa > 0
            ? el('p', {}, el('span', { text: 'E agendou ' }), el('b', { text: brl(r.valorIa) }),
              el('span', { text: ` em ${plural(r.agendamentosIa, 'atendimento', 'atendimentos')}` + (r.valorIa >= d.custoIaPeriodo ? `: ${num(Math.floor((r.valorIa / Math.max(1, d.custoIaPeriodo)) * 10) / 10)}× o que ela custou no período.` : '.') }))
            : null,
          el('p', { text: ganhou ? `No ritmo de hoje, a economia é de ${brl(d.saldoMes)} por mês.` : 'Quanto mais conversas a IA atende, mais ela se paga. Veja abaixo quanto custaria atender 24 h só com gente.' }))
        : el('div', { class: 'agx-vidro ecx-vazio', role: 'status' }, el('span', { class: 'ecx-ic', html: ICONE.msg, 'aria-hidden': 'true' }),
          el('span', { style: 'display:grid;gap:4px' }, el('b', { text: `A IA não respondeu nenhuma mensagem ${nos}.` }),
            el('span', { class: 'agx-sub', text: 'Quando ela começar a atender, esta conta usa os números reais da sua empresa. Enquanto isso, veja quanto custaria atender 24 h só com gente.' })));

      const bloco = (ic, valor, texto) => el('div', { class: 'ecx-bloco' }, el('span', { class: 'ecx-ic', html: ICONE[ic], 'aria-hidden': 'true' }), el('b', { text: valor }), el('span', { text: texto }));
      const blocos = el('div', { class: 'ecx-blocos' },
        bloco('msg', num(r.mensagensIa), 'mensagens respondidas pela IA'),
        bloco('pessoas', num(r.conversasIa), r.conversasIa === 1 ? 'cliente atendida pela IA' : 'clientes atendidas pela IA'),
        bloco('lua', num(r.foraDoHorarioIa), 'respostas com a loja fechada (noite, domingo, feriado)'),
        bloco('agenda', num(r.agendamentosIa), r.valorIa > 0 ? `agendamentos feitos pela IA · ${brl(r.valorIa)}` : 'agendamentos feitos pela IA'),
        bloco('relogio', `${num(d.horasPoupadas)} h`, 'de trabalho que a equipe não precisou fazer'),
        bloco('raio', tempo(r.respostaIaMs), d.respostaVezesMaisRapida && d.respostaVezesMaisRapida > 1 ? `1ª resposta da IA: ${num(d.respostaVezesMaisRapida)}× mais rápida que a da equipe (${tempo(r.respostaEquipeMs)})` : `1ª resposta da IA${r.respostaEquipeMs ? ` · equipe: ${tempo(r.respostaEquipeMs)}` : ''}`));

      const barra = (rot, valor, maior, classe) => el('div', { class: 'ecx-barra' },
        el('div', { class: 'ecx-barra-cab' }, el('span', { text: rot }), el('b', { text: brl(valor) })),
        el('div', { class: 'ecx-trilho ' + (classe || ''), 'aria-hidden': 'true' }, el('i', { style: `--w:${Math.max(2, Math.round((Math.max(0, valor) / Math.max(1, maior)) * 100))}%` })));
      const maior1 = Math.max(d.valorHoras, d.custoIaPeriodo);
      const c24 = d.cobertura24h;
      const comparar = el('div', { class: 'ecx-duas' },
        el('div', { class: 'agx-vidro' }, el('h2', { text: 'O trabalho da IA × o que ela custa' }),
          el('div', { class: 'ecx-barras' },
            barra(`Valor das ${num(d.horasPoupadas)} h de trabalho`, d.valorHoras, maior1, 'menta'),
            barra(`IA em ${d.dias} dias`, d.custoIaPeriodo, maior1)),
          el('p', { class: 'ecx-nota', text: `Uma pessoa custa ${brl(d.pessoa.mes)} por mês (${brl(d.pessoa.hora)} por hora de trabalho).` })),
        el('div', { class: 'agx-vidro' }, el('h2', {}, el('span', { class: 'ecx-ic', html: ICONE.sol, 'aria-hidden': 'true' }), el('span', { text: 'Atender 24 h, 7 dias' })),
          el('div', { class: 'ecx-barras' },
            barra(`Só com gente: ${plural(c24.pessoas, 'pessoa', 'pessoas')} de ${num(d.custo.horasSemana)} h`, c24.custoMes, Math.max(c24.custoMes, c24.custoIaMes), 'gente'),
            barra('Com a IA', c24.custoIaMes, Math.max(c24.custoMes, c24.custoIaMes), 'menta')),
          el('p', { class: 'ecx-nota', text: c24.economiaMes > 0 ? `A IA cobre as 168 h da semana por ${brl(c24.economiaMes)} a menos por mês.` : 'Com estes números, cobrir 24 h com gente sai mais barato.' })));
      resultado.replaceChildren(heroi, blocos, comparar);
    };

    // ---- ajustes
    let espera = null;
    const valores = () => Object.fromEntries(CAMPOS.map(([k]) => [k, campos[k].value]));
    const recalcular = () => {
      clearTimeout(espera);
      espera = setTimeout(async () => {
        rascunho = valores();
        try { d = await consulta(); if (ctx.vivo()) { pintar(); marcar(); } } catch (x) { ui.toast((x && x.message) || 'Confira os números.'); }
      }, 350);
    };
    const campos = {};
    const grade = el('div', { class: 'ecx-campos' }, ...CAMPOS.map(([k, rot, pre, suf, passo]) => {
      const inp = el('input', { type: 'number', inputmode: 'decimal', min: '0', step: String(passo), value: String(d.custo[k]), 'aria-label': rot });
      inp.addEventListener('input', recalcular);
      campos[k] = inp;
      return el('label', { class: 'agx-campo' }, el('span', { text: rot }), el('span', { class: 'ecx-entrada' }, pre ? el('i', { text: pre }) : null, inp, suf ? el('i', { text: suf }) : null));
    }));
    const mudou = () => CAMPOS.some(([k]) => Number(campos[k].value) !== Number(d.gravado[k]));
    const gravar = el('button', { class: 'agx-botao primario', type: 'button', text: 'Salvar para a empresa' });
    const desfazer = el('button', { class: 'agx-botao', type: 'button', text: 'Voltar ao salvo' });
    const marcar = () => { const m = mudou(); gravar.hidden = !d.podeGravar || !m; desfazer.hidden = !m; };
    gravar.addEventListener('click', async () => {
      gravar.disabled = true;
      try {
        const corpo = Object.fromEntries(CAMPOS.map(([k]) => [k, Number(campos[k].value)]));
        await ui.api('/api/economia-ia/custo', { method: 'PUT', body: JSON.stringify(corpo) });
        rascunho = null; d = await consulta(); if (ctx.vivo()) { pintar(); marcar(); }
        ui.toast('Salvo ✓');
      } catch (x) { ui.toast((x && x.message) || 'Não deu para salvar. Confira os números.'); } finally { gravar.disabled = false; }
    });
    desfazer.addEventListener('click', async () => {
      rascunho = null;
      for (const [k] of CAMPOS) campos[k].value = String(d.gravado[k]);
      try { d = await consulta(); if (ctx.vivo()) { pintar(); marcar(); } } catch {}
    });
    const ajustes = el('div', { class: 'agx-vidro' },
      el('h2', {}, el('span', { class: 'ecx-ic', html: ICONE.ajuste, 'aria-hidden': 'true' }), el('span', { text: 'O custo da sua equipe' })),
      el('p', { class: 'agx-sub', text: d.podeGravar ? 'Coloque os números da sua empresa. A conta muda na hora; salve para ficar assim para toda a gestão.' : 'Mude os números para ver a conta. Quem salva para a empresa é a administração ou a direção.' }),
      grade, el('div', { class: 'ecx-acoes' }, gravar, desfazer),
      el('p', { class: 'ecx-nota', text: 'Como a conta é feita: uma pessoa custa salário + encargos + benefícios por mês e trabalha a jornada × 52 semanas ÷ 12. Cada mensagem que a IA respondeu poupou o tempo de uma pessoa ler e responder. "Loja fechada" usa o horário de cada unidade (Empresa › Unidades). Agendamentos e valores vêm do Desempenho. É uma estimativa para ajudar a decidir.' }));

    pintar();
    marcar();
    caixa.append(
      el('div', { class: 'agx-topo' },
        el('div', { style: 'display:grid;gap:4px;min-width:0' }, el('h1', { text: 'Quanto a IA economiza' }),
          el('p', { class: 'agx-sub', text: 'A conta com o que a IA fez de verdade na sua empresa, comparada ao custo de uma pessoa.' })),
        periodo),
      resultado, ajustes);
    conteudo.replaceChildren(caixa);
  }

  window.SintoniaTelas.economiaIa = { desenhar };
})();
