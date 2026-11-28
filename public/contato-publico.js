/* sem-pagamento: contato da Sintonia nas páginas públicas (vendas, login, suporte, privacidade e termos).
 * O número de WhatsApp vem do servidor (GET /api/publico/contato, variável SINTONIA_WHATSAPP_VENDAS).
 *   <a data-whats href="/suporte"><span data-whats-rotulo>Falar no WhatsApp</span></a>
 *     com número: abre o WhatsApp com a mensagem pronta (a do link em data-whats-texto, ex.: o plano escolhido);
 *     sem número: vai para o e-mail de suporte (se houver) ou para a página /suporte, e o rótulo vira "Fale com a gente"
 *     (ou o texto de data-sem-whats).
 *   [data-contato="whatsapp"] / [data-contato="email"]: mostram o número / e-mail (textContent).
 *   [data-so-whats] / [data-so-email]: só aparecem quando há número / e-mail.
 * Sem internet ou com o servidor fora, tudo fica como está no HTML (os links levam para /suporte). */
(() => {
  const formatar = (n) => {
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(n);
    return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : '+' + n;
  };
  const aplicar = (c) => {
    const w = c && typeof c.whatsapp === 'string' && /^\d{12,15}$/.test(c.whatsapp) ? c.whatsapp : '';
    const email = c && typeof c.email === 'string' && /^[^\s@<>"']+@[^\s@<>"']+$/.test(c.email) ? c.email : '';
    const msg = (c && typeof c.mensagem === 'string' && c.mensagem) || 'Olá! Quero conhecer a Sintonia.';
    document.querySelectorAll('a[data-whats]').forEach((a) => {
      const rot = a.querySelector('[data-whats-rotulo]');
      const texto = a.getAttribute('data-whats-texto') || msg;
      if (w) {
        a.href = `https://wa.me/${w}?text=${encodeURIComponent(texto)}`;
        a.target = '_blank';
        a.rel = 'noopener';
        return;
      }
      a.removeAttribute('target');
      if (email) a.href = `mailto:${email}?subject=${encodeURIComponent('Quero conhecer a Sintonia')}` + (a.hasAttribute('data-whats-texto') ? `&body=${encodeURIComponent(texto)}` : '');
      else a.href = a.getAttribute('data-sem') || '/suporte';
      if (rot) rot.textContent = a.getAttribute('data-sem-whats') || 'Fale com a gente';
    });
    document.querySelectorAll('[data-contato="whatsapp"]').forEach((e) => { e.textContent = w ? formatar(w) : ''; });
    document.querySelectorAll('[data-contato="email"]').forEach((e) => {
      e.textContent = email;
      if (e.tagName === 'A') e.href = email ? `mailto:${email}` : '#';
    });
    document.querySelectorAll('[data-so-whats]').forEach((e) => { e.hidden = !w; });
    document.querySelectorAll('[data-so-email]').forEach((e) => { e.hidden = !email; });
    document.querySelectorAll('[data-sem-contato]').forEach((e) => { e.hidden = Boolean(w || email); });
    document.documentElement.dataset.contato = w ? 'whatsapp' : email ? 'email' : 'nenhum';
  };
  const iniciar = () => {
    fetch('/api/publico/contato', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then(aplicar)
      .catch(() => aplicar(null));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
