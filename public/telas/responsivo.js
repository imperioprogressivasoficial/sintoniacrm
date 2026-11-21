/* Responsividade: o comportamento que acompanha o /responsivo.css.
 * - ficha da cliente em seções que abrem e fecham (principal aberta; no celular as outras recolhidas)
 * - CRM no celular: filtros recolhidos num botão "Filtros"
 * - faixas roláveis (chips, números) esmaecem na borda quando há mais conteúdo
 * Só reorganiza o que já existe no app.html; não muda nenhuma regra de negócio. */
(() => {
  const $ = (id) => document.getElementById(id);
  const celular = matchMedia('(max-width: 760px)');
  const SVG = {
    filtro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  };
  const criar = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (html) e.innerHTML = html; return e; };

  // ---------- ficha: seções que abrem e fecham ----------
  function secao(titulo, filhos, { classe = '', aberta = true } = {}) {
    const d = criar('details', { class: 'rs-secao ' + classe });
    if (aberta) d.open = true;
    const s = criar('summary');
    s.append(document.createTextNode(titulo));
    const corpo = criar('div', { class: 'rs-corpo' });
    corpo.append(...filhos.filter(Boolean));
    d.append(s, corpo);
    return d;
  }
  function montarFicha() {
    const form = $('f-contato');
    if (!form || form.dataset.rs) return;
    form.dataset.rs = '1';
    const fechadaNoCel = !celular.matches;
    const rotulo = (nome) => form.querySelector(`[name="${nome}"]`)?.closest('label');
    const h3 = form.querySelector('h3');
    const erro = $('f-erro'), rodape = form.querySelector('.rodape-ficha');
    const dados = secao('Dados da cliente', [rotulo('nome'), rotulo('email'), rotulo('nascimento'), rotulo('observacoes')], { classe: 'rs-dados', aberta: true });
    const campos = secao('Campos personalizados', [$('f-campos'), $('f-editar-campos')], { classe: 'rs-campos', aberta: fechadaNoCel });
    const empresa = secao('Empresa', [form.querySelector('.interruptor'), form.querySelector('#f-empresa')], { classe: 'rs-empresa', aberta: fechadaNoCel });
    h3?.remove();
    form.prepend(dados, campos, empresa);
    form.append(erro, rodape);
    // bloco de atendimento (etapa, unidade, dona, origem…)
    const etapa = $('f-etapa')?.closest('.bloco');
    if (etapa && !etapa.querySelector('.rs-secao')) {
      const t = etapa.querySelector('h3');
      const filhos = [...etapa.children].filter((x) => x !== t);
      etapa.append(secao('Atendimento e origem', [t ? Object.assign(criar('p', { class: 'info', style: 'margin:0' }), { textContent: 'Etapa do funil (a IA move sozinha)' }) : null, ...filhos], { classe: 'rs-origem', aberta: fechadaNoCel }));
      t?.remove();
    }
    for (const [id, titulo, aberta] of [['f-resumo-bloco', 'Resumo da IA', true], ['f-etiquetas-bloco', 'Etiquetas', fechadaNoCel]]) {
      const b = $(id);
      if (!b || b.querySelector('.rs-secao')) continue;
      const t = b.querySelector('h3');
      const filhos = [...b.children].filter((x) => x !== t);
      t?.remove();
      b.append(secao(titulo, filhos, { aberta }));
    }
    // ordem de leitura: resumo da IA logo depois do perfil
    const perfil = document.querySelector('#ficha .perfil'), resumo = $('f-resumo-bloco');
    if (perfil && resumo) perfil.after(resumo);
  }

  // ---------- CRM: botão Filtros no celular ----------
  function montarCrm() {
    const abas = $('funil-abas');
    if (!abas || $('rs-filtros-crm')) return;
    const b = criar('button', { class: 'chip rs-filtros-crm', id: 'rs-filtros-crm', type: 'button', 'aria-pressed': 'false', 'aria-controls': 'funil', title: 'Mostrar filtros' }, SVG.filtro);
    b.append(document.createTextNode('Filtros'));
    const ponto = criar('i', { class: 'rs-ponto', hidden: '' });
    b.append(ponto);
    b.addEventListener('click', () => {
      const v = $('v-funil'), aberto = !v.classList.contains('rs-filtros-abertos');
      v.classList.toggle('rs-filtros-abertos', aberto);
      b.setAttribute('aria-pressed', String(aberto));
      if (aberto) v.querySelector('.fn-busca input')?.focus({ preventScroll: true });
    });
    // bolinha quando há filtro ativo (busca preenchida) com a barra fechada
    document.addEventListener('input', (e) => { if (e.target.closest?.('.fn-busca')) ponto.hidden = !e.target.value; });
    abas.after(b); // fora do grupo Quadro/Ligar hoje: aquele grupo troca de aba a cada clique
  }

  // ---------- faixas roláveis com esmaecer ----------
  const faixas = new WeakSet();
  function marcarFaixa(f) {
    const ajustar = () => {
      const max = f.scrollWidth - f.clientWidth;
      f.classList.toggle('rs-tem-esq', f.scrollLeft > 2);
      f.classList.toggle('rs-tem-dir', max > 2 && f.scrollLeft < max - 2);
    };
    if (!faixas.has(f)) {
      faixas.add(f);
      f.classList.add('rs-faixa');
      f.addEventListener('scroll', ajustar, { passive: true });
      new ResizeObserver(ajustar).observe(f);
      new MutationObserver(ajustar).observe(f, { childList: true, subtree: true });
    }
    ajustar();
  }
  const SELETOR_FAIXAS = '.filtros, .fn-numeros, .fn-trilho, .au-filtros, .ag-seg';
  function varrerFaixas() { document.querySelectorAll(SELETOR_FAIXAS).forEach(marcarFaixa); }

  function iniciar() {
    montarFicha();
    montarCrm();
    varrerFaixas();
    // as telas desenham depois (ao abrir a aba): procura faixas novas sem custo alto
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(varrerFaixas, 150); }).observe(document.querySelector('.area') || document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
