/* Conexões → E-mail: contas remetentes do e-mail marketing (SMTP com predefinições Hostinger, Gmail e Outlook;
 * IMAP opcional para ler respostas e bounces; provedor por API Resend/Brevo). Usa os estilos da própria
 * página de Conexões (section, .cartao, .campos, .botao...). Senhas vão cifradas e nunca voltam para a tela.
 */
(() => {
  const ICONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
  const s = { contas: [], pre: {}, editando: null, res: {} };

  const el = (tag, props = {}, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f != null) e.append(f);
    return e;
  };
  const api = async (url, opcoes = {}) => {
    const r = await fetch(url, { ...opcoes, headers: opcoes.body ? { 'content-type': 'application/json' } : undefined });
    if (r.status === 401) { location.href = '/entrar'; throw new Error('sem sessão'); }
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || (j.detalhes?.[0]?.message) || `Erro ${r.status}`);
    return j;
  };
  const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }) : '');

  function vazia(pre = 'hostinger') {
    const p = s.pre[pre] || {};
    return { id: null, nome: p.nome ? `Império (${p.nome.split(' ')[0]})` : 'Império', provedor: 'smtp', predefinicao: pre, smtpHost: p.smtpHost || '', smtpPorta: p.smtpPorta || 465, smtpSeguranca: p.smtpSeguranca || 'ssl', usuario: '', senha: '', apiChave: '', remetenteNome: 'Império Progressivas', remetenteEmail: '', responderPara: '', imapLigado: false, imapHost: p.imapHost || '', imapPorta: p.imapPorta || 993, porMinuto: p.porMinuto || 20, limiteDiario: p.limiteDiario || 300, ativa: true, senhaDefinida: false, apiChaveDefinida: false };
  }

  function campo(rotulo, nome, attrs = {}, dica) {
    const c = s.editando;
    const i = el('input', { name: nome, ...attrs });
    if (attrs.type === 'checkbox') i.checked = Boolean(c[nome]); else i.value = c[nome] ?? '';
    i.addEventListener('input', () => { c[nome] = attrs.type === 'checkbox' ? i.checked : attrs.type === 'number' ? Number(i.value) : i.value; if (nome === 'usuario' && !c.remetenteEmail) { /* sugestão abaixo */ } });
    i.addEventListener('change', () => { if (attrs.type === 'checkbox') { c[nome] = i.checked; desenhar(); } });
    if (attrs.type === 'checkbox') return el('label', { style: 'display:flex;gap:10px;align-items:center;color:var(--texto);font-size:14px' }, i, rotulo);
    return el('label', {}, rotulo, i, dica ? el('span', { class: 'dica', text: dica }) : null);
  }
  function seletor(rotulo, nome, opcoes, aoMudar) {
    const c = s.editando;
    const sel = el('select', { name: nome, style: 'background:var(--vidro-item);border:1px solid var(--vidro-borda);border-radius:12px;padding:11px 12px;font:inherit;font-size:15px;color:var(--texto);width:100%' }, ...opcoes.map(([v, t]) => el('option', { value: v, text: t })));
    sel.value = c[nome] ?? '';
    sel.addEventListener('change', () => { c[nome] = sel.value; aoMudar?.(sel.value); });
    return el('label', {}, rotulo, sel);
  }

  function formulario() {
    const c = s.editando;
    const pre = s.pre[c.predefinicao] || {};
    const escolha = el('div', { class: 'escolha', style: 'grid-template-columns:repeat(4,minmax(0,1fr))', role: 'group', 'aria-label': 'Provedor' },
      ...[['hostinger', 'Hostinger'], ['gmail', 'Gmail'], ['outlook', 'Outlook'], ['outro', 'Outro']].map(([k, t]) => el('button', { type: 'button', 'aria-pressed': String(c.provedor === 'smtp' && c.predefinicao === k), onclick: () => {
        const p = s.pre[k];
        Object.assign(c, { provedor: 'smtp', predefinicao: k, smtpHost: p.smtpHost, smtpPorta: p.smtpPorta, smtpSeguranca: p.smtpSeguranca, imapHost: p.imapHost, imapPorta: p.imapPorta, porMinuto: p.porMinuto, limiteDiario: p.limiteDiario });
        desenhar();
      } }, t)));
    const smtp = c.provedor === 'smtp';
    return el('div', { class: 'cartao', id: 'email-form' },
      el('div', { class: 'cab' }, el('b', { text: c.id ? `Editar ${c.nome}` : 'Nova conta de e-mail' })),
      escolha,
      smtp && pre.dica ? el('p', { class: 'aviso', text: pre.dica }) : null,
      el('div', { class: 'campos' },
        campo('Nome da conta (só para você)', 'nome', { maxlength: 80 }),
        seletor('Como envia', 'provedor', [['smtp', 'SMTP (recomendado)'], ['resend', 'API Resend'], ['brevo', 'API Brevo']], () => desenhar())),
      smtp ? el('div', { class: 'campos' },
        campo('Servidor SMTP', 'smtpHost', { placeholder: 'smtp.hostinger.com' }),
        campo('Porta', 'smtpPorta', { type: 'number', min: 1, max: 65535, inputmode: 'numeric' }),
        seletor('Segurança', 'smtpSeguranca', [['ssl', 'SSL/TLS (porta 465)'], ['starttls', 'STARTTLS (porta 587)'], ['nenhuma', 'Nenhuma (não use)']]),
        campo('Usuário (e-mail completo)', 'usuario', { type: 'email', autocomplete: 'off', placeholder: 'contato@seudominio.com.br' }),
        campo(c.predefinicao === 'gmail' ? 'Senha de app (16 letras)' : 'Senha da caixa de e-mail', 'senha', { type: 'password', autocomplete: 'new-password', placeholder: c.senhaDefinida ? '•••••••• (salva — deixe vazio para manter)' : '' }))
        : el('div', { class: 'campos' }, campo(`Chave da API ${c.provedor === 'resend' ? 'Resend' : 'Brevo'}`, 'apiChave', { type: 'password', autocomplete: 'off', placeholder: c.apiChaveDefinida ? '•••••••• (salva)' : '' }, 'O domínio do remetente precisa estar verificado no provedor.')),
      el('div', { class: 'campos' },
        campo('Nome do remetente', 'remetenteNome', { maxlength: 80 }),
        campo('E-mail do remetente', 'remetenteEmail', { type: 'email', placeholder: 'contato@seudominio.com.br' }, smtp ? 'Normalmente o mesmo do usuário.' : null),
        campo('Responder para (opcional)', 'responderPara', { type: 'email', placeholder: 'atendimento@seudominio.com.br' })),
      el('div', { class: 'campos' },
        campo('E-mails por minuto', 'porMinuto', { type: 'number', min: 1, max: 600, inputmode: 'numeric' }, 'Devagar evita cair no spam.'),
        campo('Limite por dia', 'limiteDiario', { type: 'number', min: 1, max: 100000, inputmode: 'numeric' }, c.predefinicao === 'gmail' ? 'Gmail: até 500/dia (Workspace: 2.000).' : c.predefinicao === 'hostinger' ? 'Confira o limite do seu plano no hPanel.' : null)),
      smtp ? campo('Ler respostas e avisos de erro (IMAP)', 'imapLigado', { type: 'checkbox' }) : null,
      smtp && c.imapLigado ? el('div', { class: 'campos' }, campo('Servidor IMAP', 'imapHost', { placeholder: 'imap.hostinger.com' }), campo('Porta IMAP', 'imapPorta', { type: 'number', inputmode: 'numeric' }, 'Usa o mesmo usuário e senha. Respostas vão para a ficha da cliente; e-mails inexistentes saem da lista.')) : null,
      campo('Conta ligada', 'ativa', { type: 'checkbox' }),
      el('div', { class: 'linha' },
        el('button', { class: 'botao', type: 'button', onclick: salvar, text: 'Salvar conta' }),
        el('button', { class: 'botao leve', type: 'button', onclick: () => { s.editando = null; desenhar(); }, text: 'Cancelar' }),
        c.id ? el('button', { class: 'botao perigo', type: 'button', onclick: apagar, text: 'Apagar' }) : null,
        el('span', { class: 'res', id: 'res-email-form', role: 'status' })));
  }

  async function salvar() {
    const c = s.editando;
    const res = document.getElementById('res-email-form');
    const corpo = { ...c };
    for (const k of ['id', 'senhaDefinida', 'apiChaveDefinida', 'testadaEm', 'testeErro', 'imapLidoEm', 'imapErro', 'enviadosHoje']) delete corpo[k];
    if (!corpo.remetenteEmail && corpo.usuario?.includes('@')) corpo.remetenteEmail = corpo.usuario;
    for (const k of ['smtpPorta', 'imapPorta', 'porMinuto', 'limiteDiario']) corpo[k] = corpo[k] ? Number(corpo[k]) : undefined;
    try {
      await api(c.id ? `/api/email/contas/${c.id}` : '/api/email/contas', { method: c.id ? 'PUT' : 'POST', body: JSON.stringify(corpo) });
      s.editando = null;
      await carregar();
    } catch (e) { res.className = 'res erro'; res.textContent = e.message; }
  }
  async function apagar() {
    if (!confirm('Apagar esta conta? Os e-mails na fila dela serão cancelados.')) return;
    await api(`/api/email/contas/${s.editando.id}`, { method: 'DELETE' }).catch((e) => alert(e.message));
    s.editando = null;
    carregar();
  }
  async function testar(conta) {
    const para = prompt('Mandar o e-mail de teste para qual endereço?', '');
    if (para === null) return;
    s.res[conta.id] = { texto: 'Testando…' };
    desenhar();
    try {
      const r = await api(`/api/email/contas/${conta.id}/testar`, { method: 'POST', body: JSON.stringify(para.trim() ? { para: para.trim() } : {}) });
      s.res[conta.id] = r.ok ? { ok: true, texto: r.mensagem } : { texto: r.erro };
    } catch (e) { s.res[conta.id] = { texto: e.message }; }
    await carregar();
  }

  function cartaoConta(c) {
    const r = s.res[c.id];
    const estado = !c.ativa ? ['Desligada', ''] : c.testeErro ? ['Com erro', 'aviso'] : c.testadaEm ? ['Funcionando', 'ok'] : ['Não testada', ''];
    return el('div', { class: 'cartao' },
      el('div', { class: 'cab' }, el('b', { text: c.nome }), el('span', { class: 'estado ' + estado[1], text: estado[0] })),
      el('p', {}, el('b', { text: `${c.remetenteNome} <${c.remetenteEmail}>` }), el('br'), c.provedor === 'smtp' ? `SMTP ${c.smtpHost}:${c.smtpPorta} (${c.smtpSeguranca === 'ssl' ? 'SSL' : c.smtpSeguranca === 'starttls' ? 'STARTTLS' : 'sem criptografia'})` : `API ${c.provedor}`,
        el('br'), `Ritmo ${c.porMinuto}/min · ${c.limiteDiario}/dia · hoje ${c.enviadosHoje || 0}`,
        c.imapLigado ? el('span', {}, el('br'), `IMAP ${c.imapHost}${c.imapLidoEm ? ` · lido ${quando(c.imapLidoEm)}` : ''}`) : null),
      c.testeErro ? el('p', { class: 'res erro', text: c.testeErro }) : null,
      c.imapErro ? el('p', { class: 'res erro', text: `IMAP: ${c.imapErro}` }) : null,
      el('div', { class: 'linha' },
        el('button', { class: 'botao leve mini', type: 'button', onclick: () => testar(c), text: 'Testar (envia e-mail de teste)' }),
        el('button', { class: 'botao leve mini', type: 'button', onclick: () => { s.editando = { ...vazia(c.predefinicao || 'outro'), ...c, senha: '', apiChave: '' }; desenhar(); }, text: 'Editar' })),
      r ? el('span', { class: 'res ' + (r.ok ? 'ok' : r.texto === 'Testando…' ? '' : 'erro'), role: 'status', text: r.texto }) : null);
  }

  function desenhar() {
    const sec = document.getElementById('email');
    if (!sec) return;
    sec.replaceChildren(
      el('h2', { id: 't-email' }, el('span', { class: 'ic menta', html: ICONE }), el('span', {}, 'Contas de e-mail', el('small', { text: 'Remetentes das campanhas e dos e-mails automáticos' }))),
      el('p', { text: 'Conecte a caixa de e-mail da Império (Hostinger, Gmail/Google Workspace ou Outlook). A Sintonia envia pelo seu próprio servidor, no ritmo que você escolher, com descadastro em um clique.' }),
      s.contas.length ? el('div', { class: 'cartoes' }, ...s.contas.map(cartaoConta)) : el('p', { class: 'aviso', text: 'Nenhuma conta ainda. Adicione uma para começar a mandar e-mails.' }),
      s.editando ? formulario() : el('div', { class: 'linha' }, el('button', { class: 'botao', type: 'button', onclick: () => { s.editando = vazia('hostinger'); desenhar(); document.getElementById('email-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, text: '+ Adicionar conta de e-mail' })),
      el('details', { class: 'passos' }, el('summary', { text: 'Hostinger: passo a passo' }), el('ol', {},
        el('li', { html: 'No <b>hPanel</b>, abra <b>E-mails</b> e crie (ou escolha) a caixa, ex.: <code>contato@seudominio.com.br</code>.' }),
        el('li', { html: 'Aqui, toque em <b>Hostinger</b>: o servidor fica <code>smtp.hostinger.com</code>, porta <code>465</code> (SSL). Para ler respostas: <code>imap.hostinger.com</code>, porta <code>993</code>.' }),
        el('li', { html: 'Usuário = o e-mail completo; senha = a senha da caixa. Salve e toque em <b>Testar</b>.' }))),
      el('details', { class: 'passos' }, el('summary', { text: 'Gmail / Google Workspace: senha de app' }), el('ol', {},
        el('li', { html: 'Na Conta Google, ligue a <b>Verificação em duas etapas</b> (Segurança).' }),
        el('li', { html: 'Abra <b>Senhas de app</b> (myaccount.google.com/apppasswords), crie uma chamada "Sintonia" e copie as 16 letras.' }),
        el('li', { html: 'Aqui, toque em <b>Gmail</b>: <code>smtp.gmail.com</code>, porta <code>465</code>. Usuário = seu Gmail; senha = a senha de app.' }),
        el('li', { html: 'Limites do Google: cerca de 500 e-mails/dia no Gmail e 2.000 no Workspace.' }))),
      el('details', { class: 'passos' }, el('summary', { text: 'Para não cair no spam: SPF, DKIM e DMARC' }), el('ol', {},
        el('li', { html: '<b>SPF</b> diz quais servidores podem mandar e-mail pelo seu domínio. Na Hostinger já vem pronto; se mandar por outro (ex.: Gmail com domínio próprio), inclua-o no registro TXT <code>v=spf1 include:_spf.mail.hostinger.com ~all</code>.' }),
        el('li', { html: '<b>DKIM</b> é uma assinatura que prova que o e-mail é seu de verdade. Ligue no painel do provedor (Hostinger: E-mails → Configurações de DNS; Google Workspace: Admin → Gmail → Autenticar e-mail).' }),
        el('li', { html: '<b>DMARC</b> diz o que fazer com quem finge ser você. Comece com um TXT em <code>_dmarc.seudominio.com.br</code>: <code>v=DMARC1; p=none; rua=mailto:contato@seudominio.com.br</code>.' }),
        el('li', { html: 'Mande primeiro para poucas pessoas, aumente aos poucos e use sempre o mesmo remetente. O link de descadastro já vai em todo e-mail.' }))),
    );
  }

  async function carregar() {
    try {
      const [contas, pre] = await Promise.all([api('/api/email/contas'), Object.keys(s.pre).length ? s.pre : api('/api/email/predefinicoes')]);
      s.contas = contas;
      s.pre = pre;
    } catch (e) {
      const sec = document.getElementById('email');
      if (sec) sec.replaceChildren(el('h2', { id: 't-email' }, el('span', { class: 'ic menta', html: ICONE }), el('span', { text: 'Contas de e-mail' })), el('p', { class: 'res erro', text: e.message }));
      return;
    }
    desenhar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', carregar); else carregar();
})();
