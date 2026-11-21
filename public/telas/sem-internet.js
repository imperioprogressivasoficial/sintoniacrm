/* sem-pagamento: aviso de "sem internet" dentro do app (App Store: o app não pode travar nem dar erro estranho offline).
 * Quando o aparelho perde a conexão, aparece uma faixa simples no topo; quando volta, ela some e o app segue normal.
 * Sem animação em loop: só um fade curto ao aparecer. Funciona no claro e no escuro. */
(() => {
  if (window.SintoniaSemInternet) return;
  const CSS = `
  .si-faixa { position: fixed; z-index: 2147483000; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 10px); transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px; width: max-content; max-width: min(560px, calc(100vw - 24px)); box-sizing: border-box; padding: 10px 16px; border-radius: 16px;
    font: 600 14px/1.35 "Poppins", ui-sans-serif, system-ui, -apple-system, sans-serif; color: #0d2240; background: #fff7e0;
    box-shadow: 0 10px 30px rgba(8, 36, 63, .18), inset 0 0 0 1px rgba(217, 119, 6, .35); transition: opacity .2s ease; }
  .si-faixa[hidden] { display: none; }
  .si-faixa svg { width: 20px; height: 20px; flex: none; color: #b45309; }
  .si-faixa small { display: block; font-weight: 400; font-size: 12.5px; color: #5a4a1a; }
  html[data-tema="escuro"] .si-faixa { color: #fdf3d6; background: #3a2c08; box-shadow: 0 10px 30px rgba(0, 0, 0, .4), inset 0 0 0 1px rgba(251, 191, 36, .35); }
  html[data-tema="escuro"] .si-faixa svg { color: #fbbf24; }
  html[data-tema="escuro"] .si-faixa small { color: #e9d9a8; }
  @media (prefers-reduced-motion: reduce) { .si-faixa { transition: none; } }`;
  let faixa = null;
  const montar = () => {
    if (faixa) return faixa;
    document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
    faixa = document.createElement('div');
    faixa.className = 'si-faixa';
    faixa.setAttribute('role', 'status');
    faixa.setAttribute('aria-live', 'polite');
    faixa.hidden = true;
    faixa.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><path d="M3 3l18 18"/><circle cx="12" cy="19" r="1"/></svg>';
    const txt = document.createElement('span');
    const b = document.createElement('b'); b.textContent = 'Sem internet agora';
    const s = document.createElement('small'); s.textContent = 'Confira o Wi-Fi ou os dados móveis. Quando a conexão voltar, a Sintonia atualiza sozinha.';
    txt.append(b, s);
    faixa.append(txt);
    document.body.append(faixa);
    return faixa;
  };
  const atualizar = () => {
    const off = navigator.onLine === false;
    if (!off && !faixa) return;
    montar().hidden = !off;
  };
  addEventListener('offline', atualizar);
  addEventListener('online', atualizar);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', atualizar); else atualizar();
  window.SintoniaSemInternet = { atualizar };
})();
