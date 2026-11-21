/* Sair da Sintonia (dono 21/11): um jeito só de sair, usado pelo "Sair" do menu lateral, da Conta e do celular.
 * - Antes de sair, uma janela pergunta e, se a pessoa ainda está Disponível, mostra a chave para desligar ali mesmo
 *   (senão as clientes continuam sendo passadas para ela e a equipe acha que ela está atendendo).
 * - Depois, uma animação curta de saída ("Até logo, Fulana") e vai para /entrar. Sem nada em loop.
 * window.SintoniaSair() → abre a janela. Usa window.SintoniaPresencaEu ({ ligado, definir }) quando existe. */
(() => {
  const CSS = `
  .sair-dlg { border: 0; padding: 0; border-radius: 26px; width: min(400px, calc(100vw - 32px)); background: var(--painel, #fff); color: var(--texto, #0d2240);
    box-shadow: 0 24px 70px rgba(13,34,64,.28); }
  .sair-dlg::backdrop { background: rgba(13,34,64,.38); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .sair-dlg[open] { animation: sair-entra .22s cubic-bezier(.2,.8,.2,1); }
  @keyframes sair-entra { from { opacity: 0; transform: translateY(8px) scale(.97); } }
  .sair-dlg form { display: grid; gap: 14px; padding: 24px 22px 20px; margin: 0; }
  .sair-ic { width: 52px; height: 52px; border-radius: 18px; display: grid; place-items: center; margin: 0 auto 2px;
    background: color-mix(in srgb, #ef4444 12%, transparent); color: #dc2626; }
  .sair-ic svg { width: 26px; height: 26px; }
  .sair-dlg h2 { margin: 0; font-size: 20px; font-weight: 700; text-align: center; }
  .sair-dlg p { margin: 0; font-size: 14.5px; line-height: 1.45; color: var(--sub, #5b6b82); text-align: center; }
  .sair-pres { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 18px; border: 1px solid var(--linha, #dbe5f1);
    background: var(--vidro-item, rgba(16,110,190,.05)); cursor: pointer; }
  .sair-pres .bolinha { width: 10px; height: 10px; border-radius: 50%; background: #16a34a; flex: none; box-shadow: 0 0 0 4px color-mix(in srgb, #16a34a 18%, transparent); }
  .sair-pres.fora .bolinha { background: #ef4444; box-shadow: 0 0 0 4px color-mix(in srgb, #ef4444 18%, transparent); }
  .sair-pres span { flex: 1; min-width: 0; display: grid; }
  .sair-pres b { font-size: 15px; }
  .sair-pres small { font-size: 12.5px; color: var(--sub, #5b6b82); }
  .sair-pres input { position: absolute; opacity: 0; pointer-events: none; }
  .sair-pres i { width: 44px; height: 26px; border-radius: 999px; background: #cbd5e1; position: relative; flex: none; transition: background .2s; }
  .sair-pres i::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .2s; }
  .sair-pres input:checked + i { background: #16a34a; }
  .sair-pres input:checked + i::after { transform: translateX(18px); }
  .sair-pres input:focus-visible + i { outline: 2px solid #106ebe; outline-offset: 2px; }
  .sair-botoes { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 4px; }
  .sair-botoes button { all: unset; box-sizing: border-box; cursor: pointer; height: 48px; border-radius: 16px; display: grid; place-items: center;
    font-size: 15px; font-weight: 600; text-align: center; padding: 0 10px; }
  .sair-botoes .cancelar { background: var(--vidro-item, rgba(13,34,64,.06)); color: var(--texto, #0d2240); }
  .sair-botoes .vai { background: #dc2626; color: #fff; }
  .sair-botoes button:focus-visible { outline: 2px solid #106ebe; outline-offset: 2px; }
  .sair-botoes button[disabled] { opacity: .6; cursor: default; }
  .sair-sem { all: unset; cursor: pointer; justify-self: center; font-size: 13px; color: var(--sub, #5b6b82); text-decoration: underline; text-underline-offset: 3px; }
  .sair-sem[hidden] { display: none; }

  /* animação de saída: a tela recua e desfoca, entra o "Até logo" */
  html.saindo body > *:not(.sair-veu) { transition: transform .5s cubic-bezier(.4,0,.2,1), filter .5s, opacity .5s; transform: scale(.96); filter: blur(8px); opacity: .4; }
  .sair-veu { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; align-content: center; gap: 14px;
    background: radial-gradient(120% 90% at 50% 40%, #13305a 0%, #0d2240 60%, #081629 100%); color: #fff; opacity: 0; transition: opacity .45s ease; }
  .sair-veu.vis { opacity: 1; }
  .sair-veu .logo { width: 80px; height: 80px; object-fit: contain; filter: drop-shadow(0 4px 14px rgba(15,252,190,.35)); transform: translateY(8px) scale(.9); opacity: 0; transition: transform .5s cubic-bezier(.2,.8,.2,1) .15s, opacity .4s .15s; }
  .sair-veu b { font: 700 22px/1.2 Poppins, system-ui, sans-serif; transform: translateY(8px); opacity: 0; transition: transform .5s cubic-bezier(.2,.8,.2,1) .25s, opacity .4s .25s; }
  .sair-veu small { font: 400 14px/1.3 Poppins, system-ui, sans-serif; color: rgba(255,255,255,.7); opacity: 0; transition: opacity .4s .4s; }
  .sair-veu.vis .logo, .sair-veu.vis b { transform: none; opacity: 1; }
  .sair-veu.vis small { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .sair-dlg[open] { animation: none; } html.saindo body > *:not(.sair-veu) { transition: none; } .sair-veu, .sair-veu * { transition: none !important; } }
  `;
  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>';
  const el = (tag, at = {}, ...filhos) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(at)) { if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v; else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v); } e.append(...filhos.filter(Boolean)); return e; };
  let pronto = false;
  function css() { if (pronto) return; pronto = true; document.head.append(el('style', { id: 'sair-css', text: CSS })); }

  const primeiroNome = () => String(document.getElementById('lt-eu-nome')?.textContent || window.SintoniaContaNome || '').trim().split(/\s+/)[0] || '';

  async function sairDeVez() {
    try { localStorage.removeItem('sintonia.fz.lista'); } catch {}
    const nome = primeiroNome();
    const veu = el('div', { class: 'sair-veu', role: 'status', 'aria-live': 'polite' },
      el('img', { class: 'logo', src: '/simbolo-escuro.png', alt: '' }), el('b', { text: nome ? `Até logo, ${nome}!` : 'Até logo!' }), el('small', { text: 'Você saiu da Sintonia.' }));
    document.body.append(veu);
    document.documentElement.classList.add('saindo');
    requestAnimationFrame(() => requestAnimationFrame(() => veu.classList.add('vis')));
    const espera = new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 150 : 1100));
    await Promise.all([fetch('/api/auth/sair', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {}), espera]);
    location.href = '/entrar';
  }

  function abrir() {
    css();
    document.getElementById('sair-dlg')?.remove();
    const P = window.SintoniaPresencaEu;
    const temPresenca = Boolean(P && P.ligado() !== null);
    let ligado = temPresenca ? P.ligado() : false;

    const chave = el('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Disponível para atender' });
    chave.checked = ligado;
    const titulo = el('b'), sub = el('small');
    const linha = el('label', { class: 'sair-pres' }, el('span', { class: 'bolinha', 'aria-hidden': 'true' }), el('span', {}, titulo, sub), chave, el('i', { 'aria-hidden': 'true' }));
    const texto = el('p');
    const vai = el('button', { type: 'button', class: 'vai' });
    const cancelar = el('button', { type: 'button', class: 'cancelar', text: 'Cancelar' });
    const semDesligar = el('button', { type: 'button', class: 'sair-sem', text: 'Sair sem ficar indisponível' });
    const pintar = () => {
      linha.classList.toggle('fora', !chave.checked);
      titulo.textContent = chave.checked ? 'Disponível' : 'Indisponível';
      sub.textContent = chave.checked ? 'As clientes continuam vindo para você' : 'Ninguém novo é passado para você';
      texto.textContent = chave.checked
        ? 'Você ainda está disponível para atender. Desligue aqui antes de sair, para a equipe saber e as clientes irem para quem está online.'
        : 'Tudo certo: você está indisponível. Quando voltar, é só ligar de novo.';
      vai.textContent = chave.checked ? 'Desligar e sair' : 'Sair';
      semDesligar.hidden = !chave.checked;
    };
    chave.addEventListener('change', async () => { pintar(); try { await P.definir(chave.checked); } catch {} });

    const d = el('dialog', { class: 'sair-dlg', id: 'sair-dlg', 'aria-labelledby': 'sair-tit' });
    const form = el('form', { method: 'dialog' },
      el('div', { class: 'sair-ic', html: ICONE }),
      el('h2', { id: 'sair-tit', text: 'Sair da Sintonia?' }),
      temPresenca ? texto : el('p', { text: 'Você vai sair desta conta neste aparelho.' }),
      temPresenca ? linha : null,
      el('div', { class: 'sair-botoes' }, cancelar, vai),
      temPresenca ? semDesligar : null);
    d.append(form);
    if (temPresenca) pintar(); else vai.textContent = 'Sair';
    cancelar.addEventListener('click', () => d.close());
    const fim = async (desligar) => {
      vai.disabled = cancelar.disabled = true;
      if (desligar && temPresenca && P.ligado()) { try { await P.definir(false); } catch {} }
      d.close(); sairDeVez();
    };
    vai.addEventListener('click', () => fim(true));
    semDesligar.addEventListener('click', () => fim(false));
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => setTimeout(() => d.remove(), 200));
    document.body.append(d);
    d.showModal();
    vai.focus();
  }

  window.SintoniaSair = abrir;

  // Menu lateral do computador: o botão "Sair" (fica acima da sua foto)
  function ligarBotao() {
    const b = document.getElementById('lt-sair');
    if (!b || b.dataset.ligado) return;
    b.dataset.ligado = '1';
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); abrir(); });
  }
  ligarBotao(); addEventListener('DOMContentLoaded', ligarBotao, { once: true });
})();
