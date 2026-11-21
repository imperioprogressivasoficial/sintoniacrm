/* fluidez2: modo "Ocultar dados dos clientes" (para mostrar a tela a alguém, gravar vídeo, apresentar).
 * Ligado, nomes, números e fotos das clientes ficam desfocados em todas as telas (lista, topo da conversa, ficha,
 * Pipeline, Clientes, Ligações, notificações, Dashboard...). As mensagens continuam legíveis.
 * Como funciona: html.privacidade + desfoque (CSS) no que está marcado com data-privado. A marcação é automática:
 * todo nome/número que passa por window.SintoniaFone (rotulo/formatar — o app inteiro usa) fica conhecido, e o texto
 * igual a ele (ou que o contém, como "Nova mensagem de Ana") ganha data-privado. Telefone em qualquer formato também.
 * Fotos das clientes: .avatar.foto e qualquer imagem de /api/conversas/<id>/foto.
 * A escolha fica no aparelho (vale na hora, antes da tela aparecer) e na conta (preferencias.ocultarDados).
 * Carregado sem "defer" no <head>, logo depois de /telas/fone.js. Sem nada rodando quando está desligado. */
(() => {
  'use strict';
  if (window.SintoniaPrivacidade) return;
  const CHAVE = 'sintonia.privacidade';
  const raiz = document.documentElement;
  let local = null;
  try { local = localStorage.getItem(CHAVE); } catch {}
  let ligada = local === '1';
  raiz.classList.toggle('privacidade', ligada);

  const css = document.createElement('style');
  css.id = 'privacidade-css';
  css.textContent = `
  html.privacidade [data-privado], html.privacidade .avatar.foto, html.privacidade img[src*="/api/conversas/"][src$="/foto"],
  html.privacidade #f-contato input:not([type=checkbox]), html.privacidade #f-contato textarea, html.privacidade [data-privado-sempre] {
    filter: blur(6px); transition: filter .2s ease; }
  html.privacidade .avatar.foto { filter: blur(5px) saturate(.8); }
  @media print { html.privacidade [data-privado] { filter: blur(6px); } }`;
  document.head.appendChild(css);

  // ---- nomes e números conhecidos (vêm do SintoniaFone)
  const conhecidos = new Set();
  let regex = null;
  const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const conhecer = (s) => {
    const t = String(s == null ? '' : s).trim();
    if (t.length < 3 || conhecidos.has(t)) return;
    conhecidos.add(t); regex = null;
    if (ligada) agendar(document.body);
  };
  const FONE = /(\+\d{1,3}[\s(]*\d{2}\)?\s?\d{4,5}[-\s]?\d{4})|(\(\d{2}\)\s?\d{4,5}-\d{4})|(\b55\d{10,11}\b)/;
  function embrulhar() {
    const f = window.SintoniaFone;
    if (!f || f.__privacidade) return Boolean(f);
    const rotulo = f.rotulo, formatar = f.formatar;
    f.rotulo = function (nome, tel) { const r = rotulo.apply(this, arguments); conhecer(r); if (nome && /\p{L}/u.test(String(nome))) conhecer(nome); return r; };
    f.formatar = function () { const r = formatar.apply(this, arguments); if (/\d{4}/.test(r)) conhecer(r); return r; };
    f.__privacidade = true;
    return true;
  }
  if (!embrulhar()) addEventListener('DOMContentLoaded', embrulhar, { once: true });

  // ---- marcação
  const PULAR = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'svg', 'SVG']);
  const sensivel = (t) => {
    if (!t || t.length > 200) return false;
    const x = t.trim();
    if (x.length < 3) return false;
    if (conhecidos.has(x) || FONE.test(x)) return true;
    if (!conhecidos.size) return false;
    if (!regex) {
      const nomes = [...conhecidos].filter((n) => n.length >= 4).sort((a, b) => b.length - a.length).slice(0, 2000).map(escapar);
      regex = nomes.length ? new RegExp(`(^|[^\\p{L}])(${nomes.join('|')})($|[^\\p{L}])`, 'u') : /$^/;
    }
    return regex.test(x);
  };
  function marcarTexto(no) {
    const pai = no.parentElement;
    if (!pai || pai === document.body || PULAR.has(pai.tagName) || pai.closest('[data-privado], .sem-privacidade')) return;
    if (sensivel(no.nodeValue)) pai.setAttribute('data-privado', '');
  }
  function varrer(r) {
    if (!r) return;
    if (r.nodeType === 3) return marcarTexto(r);
    if (r.nodeType !== 1 || PULAR.has(r.tagName)) return;
    const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) marcarTexto(n);
  }
  let pendentes = new Set(), marcado = false;
  function agendar(n) {
    if (!n) return;
    pendentes.add(n);
    if (marcado) return;
    marcado = true;
    requestAnimationFrame(() => { marcado = false; const l = pendentes; pendentes = new Set(); for (const x of l) if (x.isConnected) varrer(x); });
  }
  const observador = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') agendar(m.target);
      else for (const n of m.addedNodes) agendar(n);
    }
  });
  function ligar() {
    if (!document.body) { addEventListener('DOMContentLoaded', ligar, { once: true }); return; }
    observador.observe(document.body, { childList: true, subtree: true, characterData: true });
    agendar(document.body);
  }

  function aplicar(v) {
    ligada = Boolean(v);
    raiz.classList.toggle('privacidade', ligada);
    if (ligada) ligar(); else { observador.disconnect(); pendentes.clear(); }
    document.querySelectorAll('[data-acao="privacidade"] span').forEach((s) => { s.textContent = ligada ? 'Mostrar dados dos clientes' : 'Ocultar dados dos clientes'; });
    dispatchEvent(new Event('sintonia:privacidade'));
  }
  /** Liga/desliga: guarda no aparelho e na conta (preferencias.ocultarDados). */
  function definir(v) {
    aplicar(v);
    try { localStorage.setItem(CHAVE, ligada ? '1' : '0'); } catch {}
    if (window.SintoniaContaPrefs) window.SintoniaContaPrefs.ocultarDados = ligada;
    fetch('/api/conta', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preferencias: { ocultarDados: ligada } }) }).catch(() => {});
    window.Sintonia?.ui?.toast?.(ligada ? 'Dados dos clientes ocultos. Para mostrar de novo, toque no olho ao lado do Radar.' : 'Dados dos clientes à mostra.');
  }
  // Aparelho sem escolha feita: vale o que está salvo na conta (aberto em outro aparelho).
  addEventListener('sintonia:conta', () => {
    let l = null; try { l = localStorage.getItem(CHAVE); } catch {}
    const p = window.SintoniaContaPrefs;
    if (l == null && p && typeof p.ocultarDados === 'boolean' && p.ocultarDados !== ligada) aplicar(p.ocultarDados);
  });
  if (ligada) ligar();
  addEventListener('DOMContentLoaded', () => aplicar(ligada), { once: true });

  window.SintoniaPrivacidade = { ligada: () => ligada, definir, alternar: () => definir(!ligada), marcar: varrer, sensivel };
  /* Chave rápida no topo de Conversas, ao lado do Radar (dono 21/11): um olho que liga/desliga o modo oculto. */
  const OLHO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OLHO_FECHADO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3.2 4.1M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function chipOculto() {
    const radar = document.querySelector('#filtros .chip-radar');
    if (!radar || document.getElementById('chip-oculto')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'chip-oculto'; b.className = 'chip chip-oculto';
    const pintar = () => { b.setAttribute('aria-pressed', String(ligada)); b.innerHTML = (ligada ? OLHO_FECHADO : OLHO) + '<span>' + (ligada ? 'Oculto' : 'Ocultar') + '</span>'; b.title = ligada ? 'Mostrar nomes, números e fotos' : 'Ocultar nomes, números e fotos dos clientes'; };
    pintar();
    b.addEventListener('click', () => definir(!ligada));
    addEventListener('sintonia:privacidade', pintar);
    /* os filtros desmarcam todos os chips ao trocar: o do olho volta a mostrar o estado dele */
    document.getElementById('filtros')?.addEventListener('click', () => setTimeout(pintar, 0));
    radar.after(b);
  }
  const cssOculto = document.createElement('style');
  cssOculto.textContent = '#filtros .chip-oculto { display: inline-flex; align-items: center; gap: 6px; } #filtros .chip-oculto svg { width: 16px; height: 16px; flex: none; }';
  document.head.append(cssOculto);
  chipOculto(); addEventListener('DOMContentLoaded', chipOculto, { once: true }); setTimeout(chipOculto, 1500);
})();
