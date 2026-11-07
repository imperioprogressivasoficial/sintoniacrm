import { describe, expect, it } from 'vitest';
import { Conteudo, MODELOS_PRONTOS, montarEmail, trocarVariaveis } from '../src/email/blocos.js';
import { ErroEnvio, erroDoSmtp } from '../src/email/transporte.js';
import { montarEmail as montarAmbiente } from './email-ambiente.js';
import { temPostgres } from './repos.js';

const conteudo = (blocos: unknown[]) => Conteudo.parse({ tema: {}, blocos });

describe('E-mail: HTML gerado pelos blocos', () => {
  it('tabelas com estilo inline, prévia escondida, 2 colunas, botão, descadastro e variáveis escapadas', () => {
    const c = conteudo([
      { tipo: 'titulo', texto: 'Olá, {primeiro_nome}!' },
      { tipo: 'texto', texto: 'Seu **liso** te espera. Veja [o site](https://imperio.com.br/promo?a=1&b=2).\nAté já.' },
      { tipo: 'imagem', url: 'https://img.test/a.jpg', alt: 'Foto', link: 'https://imperio.com.br/foto' },
      { tipo: 'botao', texto: 'Agendar', url: 'https://wa.me/5571999999999' },
      { tipo: 'divisor' },
      { tipo: 'colunas', esquerda: [{ tipo: 'texto', texto: 'Esquerda <b>' }], direita: [{ tipo: 'botao', texto: 'Direita', url: 'https://imperio.com.br/d' }] },
    ]);
    const m = montarEmail(c, { assunto: 'Promo', preheader: 'Só hoje', descadastro: 'https://crm/e/d/x', pixel: 'https://crm/e/a/x.gif', rastrear: (i) => `https://crm/e/c/x/${i}` });
    expect(m.html).toContain('<!DOCTYPE html>');
    expect(m.html).toContain('role="presentation"');
    expect(m.html).toMatch(/<td class="coluna" width="50%"/);
    expect(m.html).toContain('.coluna { display:block !important; width:100% !important; }');
    expect(m.html).toContain('Só hoje'); // texto de pré-visualização
    expect(m.html).toContain('href="https://crm/e/d/x"');
    expect(m.html).toContain('src="https://crm/e/a/x.gif"');
    expect(m.html).toContain('<strong>liso</strong>');
    expect(m.html).toContain('Esquerda &lt;b&gt;'); // nada de HTML vindo do texto
    // Todos os links viraram rastreados, na ordem; o original fica na lista.
    expect(m.links).toEqual(['https://imperio.com.br/promo?a=1&b=2', 'https://imperio.com.br/foto', 'https://wa.me/5571999999999', 'https://imperio.com.br/d']);
    expect(m.html).not.toContain('href="https://wa.me');
    expect(m.html).toContain('href="https://crm/e/c/x/2"');
    const final = trocarVariaveis(m.html, { nome: 'Ana <Maria>' }, true);
    expect(final).toContain('Olá, Ana!');
    expect(trocarVariaveis('{nome} - {primeiro_nome}', { nome: '<x> y' }, true)).toBe('&lt;x&gt; y - &lt;x&gt;');
    expect(trocarVariaveis('Oi {primeiro_nome}', {}, false)).toBe('Oi cliente');
    expect(m.texto).toContain('Agendar: https://wa.me/5571999999999');
    expect(m.texto).toContain('https://crm/e/d/x');
  });

  it('recusa link perigoso e cor inválida; modelos prontos são válidos', () => {
    expect(() => conteudo([{ tipo: 'botao', texto: 'x', url: 'javascript:alert(1)' }])).toThrow();
    expect(() => Conteudo.parse({ tema: { destaque: 'azul' }, blocos: [] })).toThrow();
    for (const mp of MODELOS_PRONTOS) expect(() => Conteudo.parse(mp.conteudo)).not.toThrow();
  });

  it('classifica erros do SMTP: 5xx de destinatário é permanente (bounce), 4xx tenta de novo', () => {
    expect(erroDoSmtp({ responseCode: 550, code: 'EENVELOPE', response: '550 5.1.1 User unknown' }).permanente).toBe(true);
    expect(erroDoSmtp({ responseCode: 451, response: '451 try later' }).permanente).toBe(false);
    expect(erroDoSmtp({ code: 'EAUTH', response: '535 auth failed' }).message).toMatch(/^Login recusado/);
  });
});

const CONTA = { nome: 'Império (Hostinger)', predefinicao: 'hostinger', smtpHost: 'smtp.hostinger.com', smtpPorta: 465, smtpSeguranca: 'ssl', usuario: 'contato@imperio.com.br', senha: 'SenhaDaCaixa#1', remetenteNome: 'Império Progressivas', remetenteEmail: 'contato@imperio.com.br', responderPara: 'contato@imperio.com.br', porMinuto: 20, limiteDiario: 300 };
const BLOCOS = { tema: {}, blocos: [{ tipo: 'titulo', texto: 'Oi {primeiro_nome}' }, { tipo: 'botao', texto: 'Agendar', url: 'https://wa.me/5571999999999' }] };

describe.skipIf(!temPostgres)('E-mail marketing (Postgres)', () => {
  async function preparar(contaExtra: Record<string, unknown> = {}) {
    const m = await montarAmbiente();
    const r = await m.como(m.gente.admin, 'POST', '/api/email/contas', { ...CONTA, ...contaExtra });
    expect(r.statusCode, r.body).toBe(201);
    const conta = r.json() as { id: string };
    const campanha = async (publico: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => {
      const c = await m.como(m.gente.admin, 'POST', '/api/email/campanhas', { nome: 'Promo', contaId: conta.id, assunto: 'Oi {primeiro_nome}', preheader: 'Prévia', conteudo: BLOCOS, publico, ...extra });
      expect(c.statusCode, c.body).toBe(201);
      return c.json() as { id: string };
    };
    const tick = () => m.email.tick();
    const relatorio = async (id: string) => (await m.como(m.gente.admin, 'GET', `/api/email/campanhas/${id}/relatorio`)).json() as { funil: Record<string, number>; campanha: { estado: string } };
    return { ...m, conta, campanha, tick, relatorio };
  }

  it('contas: senha cifrada, nunca devolvida; só direção/administração configura; testar envia pelo transportador', async () => {
    const m = await preparar();
    const lista = (await m.como(m.gente.admin, 'GET', '/api/email/contas')).json() as Array<Record<string, unknown>>;
    expect(lista[0]).toMatchObject({ nome: 'Império (Hostinger)', senhaDefinida: true, smtpHost: 'smtp.hostinger.com' });
    expect(JSON.stringify(lista)).not.toContain('SenhaDaCaixa');
    const { rows } = await m.pool.query('select senha_cifrada from sintonia.email_contas');
    expect(rows[0].senha_cifrada).toMatch(/^v1\./);
    expect(rows[0].senha_cifrada).not.toContain('SenhaDaCaixa');
    expect((await m.como(m.gente.gerenteNorte, 'POST', '/api/email/contas', CONTA)).statusCode).toBe(403);
    expect((await m.como(m.gente.carla, 'GET', '/api/email/campanhas')).statusCode).toBe(403);
    expect((await m.como(null, 'GET', '/api/email/campanhas')).statusCode).toBe(401);
    // Alterar sem mandar a senha mantém a salva.
    expect((await m.como(m.gente.admin, 'PUT', `/api/email/contas/${m.conta.id}`, { ...CONTA, senha: '', nome: 'Hostinger' })).json()).toMatchObject({ nome: 'Hostinger', senhaDefinida: true });
    const t = await m.como(m.gente.admin, 'POST', `/api/email/contas/${m.conta.id}/testar`, {});
    expect(t.json()).toMatchObject({ ok: true });
    expect(m.falso.enviados.map((e) => e.para.email)).toEqual(['bruno@imperio.com']);
    m.falso.falharVerificacao = 'Login recusado pelo servidor de e-mail: 535';
    expect((await m.como(m.gente.admin, 'POST', `/api/email/contas/${m.conta.id}/testar`, { para: 'x@y.com' })).json()).toMatchObject({ ok: false, erro: expect.stringContaining('535') });
  });

  it('público: só e-mail válido, filtros por tag/etapa/unidade, quantidade e exclusão de descadastro e bounce', async () => {
    const m = await preparar();
    const ana = await m.cliente({ nome: 'Ana Souza', email: 'ana@exemplo.com' });
    const bia = await m.cliente({ nome: 'Bia Lima', email: 'BIA@exemplo.com ' });
    await m.cliente({ nome: 'Cris', email: 'cris-invalido' });
    await m.cliente({ nome: 'Duda' });
    await m.cliente({ nome: 'Eva Sumaré', email: 'eva@exemplo.com', unidade: 'sumare' });
    await m.cliente({ nome: 'Fê', email: 'fe@exemplo.com' });
    await m.cliente({ nome: 'Gi', email: 'gi@exemplo.com' });
    const contar = async (publico: Record<string, unknown>, u = m.gente.admin) => (await m.como(u, 'POST', '/api/email/publico/contar', { publico })).json() as { total: number; disponiveis: number; amostra: Array<{ email: string }> };
    expect((await contar({})).total).toBe(5);
    expect((await contar({ unidades: ['sumare'] })).amostra.map((x) => x.email)).toEqual(['eva@exemplo.com']);
    expect((await contar({}, m.gente.gerenteNorte)).total).toBe(4); // gerente só vê o Norte
    expect((await contar({ quantidade: 2 })).total).toBe(2);
    const tag = (await m.como(m.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
    await m.como(m.gente.admin, 'POST', `/api/conversas/${ana.id}/tags`, { tagId: tag.id });
    await m.como(m.gente.admin, 'POST', `/api/conversas/${bia.id}/tags`, { tagId: tag.id });
    expect((await contar({ tags: [tag.id] })).total).toBe(2);
    expect((await contar({ tagsExcluir: [tag.id] })).total).toBe(3);
    expect((await contar({ etapas: ['agendada'] })).total).toBe(0);
    await m.pool.query("insert into sintonia.email_supressoes (empresa_id, email, motivo) values ('imperio', 'ana@exemplo.com', 'descadastro'), ('imperio', 'bia@exemplo.com', 'bounce')");
    expect((await contar({ tags: [tag.id] })).total).toBe(0);
    expect((await contar({})).total).toBe(3);

    // A quantidade escolhida vira o tamanho da fila.
    const c = await m.campanha({ quantidade: 2 });
    expect((await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/enviar`, {})).json()).toMatchObject({ estado: 'enviando', total: 2 });
  });

  it('envio: ritmo por minuto, limite do dia, idempotente, pausar/retomar e conclui', async () => {
    const m = await preparar({ porMinuto: 2, limiteDiario: 3 });
    for (const n of ['a', 'b', 'c', 'd']) await m.cliente({ nome: `Cliente ${n.toUpperCase()}`, email: `${n}@exemplo.com` });
    const c = await m.campanha();
    expect((await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/enviar`, {})).json()).toMatchObject({ total: 4 });
    expect((await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/enviar`, {})).statusCode).toBe(409);
    await m.tick();
    expect(m.falso.enviados).toHaveLength(2);
    await m.tick();
    expect(m.falso.enviados).toHaveLength(2); // mesmo minuto: ritmo de 2/min
    m.avancar(1.1);
    await m.tick();
    expect(m.falso.enviados).toHaveLength(3); // limite do dia (3)
    m.avancar(5);
    await m.tick();
    expect(m.falso.enviados).toHaveLength(3);
    // Pausa: nada sai, nem no dia seguinte.
    expect((await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/pausar`)).json()).toMatchObject({ estado: 'pausada' });
    m.avancar(24 * 60);
    await m.tick();
    expect(m.falso.enviados).toHaveLength(3);
    await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/retomar`);
    await m.tick();
    expect(m.falso.enviados).toHaveLength(4);
    expect(new Set(m.falso.enviados.map((e) => e.para.email)).size).toBe(4); // cada uma uma vez só
    const e = m.falso.enviados[0]!;
    expect(e.assunto).toMatch(/^Oi Cliente$/);
    expect(e.cabecalhos?.['List-Unsubscribe']).toMatch(/^<https:\/\/crm\.imperio\.test\/e\/d\/[0-9a-f]{48}>$/);
    expect(e.cabecalhos?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(e.messageId).toMatch(/^<[0-9a-f]{48}@imperio\.com\.br>$/);
    expect(e.html).toContain('https://crm.imperio.test/e/a/');
    await m.tick();
    expect((await m.relatorio(c.id)).campanha.estado).toBe('concluida');
  });

  it('agendada começa na hora e a fila sobrevive a reinício (reserva vencida volta, sem repetir quem já recebeu)', async () => {
    const m = await preparar();
    for (const n of ['a', 'b', 'c']) await m.cliente({ nome: n, email: `${n}@exemplo.com` });
    const c = await m.campanha();
    const quando = new Date(m.relogio.t.getTime() + 60 * 60_000).toISOString();
    expect((await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/enviar`, { quando })).json()).toMatchObject({ estado: 'agendada' });
    await m.tick();
    expect(m.falso.enviados).toHaveLength(0);
    m.avancar(61);
    await m.email.tick();
    expect(m.falso.enviados).toHaveLength(3);
    const c2 = await m.campanha({}, { nome: 'Segunda' });
    await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c2.id}/enviar`, {});
    // Simula a queda: um envio ficou "enviando" (reservado) e o processo morreu antes de enviar.
    await m.pool.query("update sintonia.email_envios set estado = 'enviando', reservada_ate = $1 where campanha_id = $2 and email = 'a@exemplo.com'", [new Date(m.relogio.t.getTime() + 5 * 60_000), c2.id]);
    m.reiniciar();
    await m.email.tick();
    expect(m.falso.enviados).toHaveLength(5); // b e c; "a" está reservada pelo processo que caiu
    m.avancar(6); // a reserva venceu: volta para a fila
    await m.email.tick();
    expect(m.falso.enviados).toHaveLength(6);
    expect(m.falso.enviados.filter((e) => e.para.email === 'a@exemplo.com')).toHaveLength(2); // uma por campanha
  });

  it('abertura, clique (sem redirecionamento aberto), descadastro em um clique e funil', async () => {
    const m = await preparar();
    await m.cliente({ nome: 'Ana Souza', email: 'ana@exemplo.com' });
    await m.cliente({ nome: 'Bia', email: 'bia@exemplo.com' });
    const c = await m.campanha();
    await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/enviar`, {});
    await m.tick();
    const ana = m.falso.enviados.find((e) => e.para.email === 'ana@exemplo.com')!;
    const token = /e\/a\/([0-9a-f]{48})\.gif/.exec(ana.html)![1]!;
    const pixel = await m.como(null, 'GET', `/e/a/${token}.gif`);
    expect(pixel.statusCode).toBe(200);
    expect(pixel.headers['content-type']).toBe('image/gif');
    await m.como(null, 'GET', `/e/a/${token}.gif`);
    expect((await m.como(null, 'GET', '/e/a/naoexiste.gif')).statusCode).toBe(200); // não revela nada
    const clique = await m.como(null, 'GET', `/e/c/${token}/0`);
    expect(clique.statusCode).toBe(302);
    expect(clique.headers.location).toBe('https://wa.me/5571999999999');
    expect((await m.como(null, 'GET', `/e/c/${token}/9`)).statusCode).toBe(404);
    expect((await m.como(null, 'GET', `/e/c/${'0'.repeat(48)}/0`)).statusCode).toBe(404);
    const pagina = await m.como(null, 'GET', `/e/d/${token}`);
    expect(pagina.body).toContain('Confirmar descadastro');
    expect(pagina.body).not.toContain('ana@exemplo.com');
    // One-click (RFC 8058): o provedor faz POST com o formulário.
    const umClique = await m.como(null, 'POST', `/e/d/${token}`, 'List-Unsubscribe=One-Click', { 'content-type': 'application/x-www-form-urlencoded' });
    expect(umClique.statusCode).toBe(200);
    expect(umClique.body).toContain('an***@exemplo.com');
    const { funil } = await m.relatorio(c.id);
    expect(funil).toMatchObject({ total: 2, enviados: 2, abertos: 1, clicados: 1, descadastros: 1, bounces: 0 });
    const r = (await m.como(m.gente.admin, 'GET', `/api/email/campanhas/${c.id}/relatorio`)).json() as { links: Array<{ url: string; cliques: number }> };
    expect(r.links).toEqual([expect.objectContaining({ url: 'https://wa.me/5571999999999', cliques: 1 })]);
    // Descadastrada não entra mais em campanha nenhuma.
    expect(((await m.como(m.gente.admin, 'POST', '/api/email/publico/contar', { publico: {} })).json() as { total: number }).total).toBe(1);
  });

  it('bounce: 5xx do servidor suprime o e-mail; 4xx tenta de novo; aviso de erro e resposta lidos pelo IMAP', async () => {
    const m = await preparar({ imapLigado: true, imapHost: 'imap.hostinger.com', imapPorta: 993 });
    await m.cliente({ nome: 'Ana', email: 'ana@exemplo.com' });
    await m.cliente({ nome: 'Bia', email: 'bia@exemplo.com' });
    await m.cliente({ nome: 'Cris', email: 'cris@exemplo.com' });
    const ruim = await m.cliente({ nome: 'Duda', email: 'duda@exemplo.com' });
    m.falso.recusar.set('ana@exemplo.com', new ErroEnvio('550 5.1.1 User unknown', true, 550));
    m.falso.recusar.set('bia@exemplo.com', new ErroEnvio('451 tente depois', false, 451));
    const c = await m.campanha();
    await m.como(m.gente.admin, 'POST', `/api/email/campanhas/${c.id}/enviar`, {});
    await m.tick();
    const estados = async () => Object.fromEntries((await m.pool.query('select email, estado from sintonia.email_envios order by email')).rows.map((r) => [r.email, r.estado]));
    expect(await estados()).toMatchObject({ 'ana@exemplo.com': 'bounce', 'bia@exemplo.com': 'pendente', 'cris@exemplo.com': 'enviado', 'duda@exemplo.com': 'enviado' });
    m.falso.recusar.delete('bia@exemplo.com');
    m.avancar(3);
    await m.tick();
    expect((await estados())['bia@exemplo.com']).toBe('enviado');

    // Aviso de não entrega (DSN) chegando na caixa: acha o envio pelo cabeçalho original.
    const duda = m.falso.enviados.find((e) => e.para.email === 'duda@exemplo.com')!;
    const tokenDuda = duda.cabecalhos!['X-Sintonia-Envio']!;
    const dsn = `From: Mail Delivery System <MAILER-DAEMON@mx.hostinger.com>\r\nTo: contato@imperio.com.br\r\nSubject: Undelivered Mail Returned to Sender\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nNão foi possível entregar.\r\n--b\r\nContent-Type: message/delivery-status\r\n\r\nFinal-Recipient: rfc822; duda@exemplo.com\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 5.1.1 mailbox does not exist\r\n--b\r\nContent-Type: text/rfc822-headers\r\n\r\nX-Sintonia-Envio: ${tokenDuda}\r\nSubject: Oi Duda\r\n--b--\r\n`;
    const cris = m.falso.enviados.find((e) => e.para.email === 'cris@exemplo.com')!;
    const resposta = `From: Cris <cris@exemplo.com>\r\nTo: contato@imperio.com.br\r\nSubject: Re: Oi Cris\r\nIn-Reply-To: ${cris.messageId}\r\nReferences: ${cris.messageId}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nQuero agendar sábado!\r\n\r\nEm qui., Império escreveu:\r\n> Oi Cris\r\n`;
    const temporario = `From: MAILER-DAEMON@mx.test\r\nSubject: Delivery Status Notification (Delay)\r\nContent-Type: text/plain\r\n\r\nFinal-Recipient: rfc822; cris@exemplo.com\r\nStatus: 4.4.1\r\n`;
    m.lidas.push({ uid: 1, fonte: Buffer.from(dsn) }, { uid: 2, fonte: Buffer.from(resposta) }, { uid: 3, fonte: Buffer.from(temporario) });
    expect((await m.como(m.gente.admin, 'POST', '/api/email/contas/ler-caixas')).json()).toEqual({ lidas: 3 });
    expect(await estados()).toMatchObject({ 'duda@exemplo.com': 'bounce', 'cris@exemplo.com': 'enviado' });
    const { funil } = await m.relatorio(c.id);
    expect(funil).toMatchObject({ enviados: 3, bounces: 2, responderam: 1 });
    const sup = (await m.como(m.gente.admin, 'GET', '/api/email/supressoes')).json() as Array<{ email: string; motivo: string }>;
    expect(sup.map((s) => `${s.email}:${s.motivo}`).sort()).toEqual(['ana@exemplo.com:bounce', 'duda@exemplo.com:bounce']);

    // Ficha da cliente: histórico com a resposta.
    const h = (await m.como(m.gente.admin, 'GET', `/api/email/historico?email=cris@exemplo.com`)).json() as { envios: Array<{ estado: string; respondido_em: string | null; eventos: Array<{ tipo: string; detalhe: string }> }> };
    expect(h.envios[0]!.respondido_em).not.toBeNull();
    expect(h.envios[0]!.eventos.find((e) => e.tipo === 'respondeu')!.detalhe).toBe('Quero agendar sábado!');
    const hDuda = (await m.como(m.gente.admin, 'GET', `/api/email/historico?telefone=${ruim.telefone}`)).json() as { bloqueio: { motivo: string } };
    expect(hDuda.bloqueio.motivo).toBe('bounce');
  });

  it('prévia e "enviar teste para mim"', async () => {
    const m = await preparar();
    const p = (await m.como(m.gente.admin, 'POST', '/api/email/previa', { assunto: 'Oi {primeiro_nome}', conteudo: BLOCOS })).json() as { html: string; assunto: string };
    expect(p.assunto).toBe('Oi Maria');
    expect(p.html).toContain('Oi Maria');
    const c = await m.campanha();
    expect((await m.como(m.gente.gerenteNorte, 'POST', `/api/email/campanhas/${c.id}/teste`, {})).json()).toMatchObject({ ok: true, para: 'gil@imperio.com' });
    expect(m.falso.enviados[0]).toMatchObject({ assunto: '[TESTE] Oi Gil', para: { email: 'gil@imperio.com' } });
    expect(((await m.como(m.gente.admin, 'GET', '/api/email/modelos-prontos')).json() as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it('automação: passo "enviar e-mail" (entrou na etapa) e gatilho de aniversário, sem enviar duas vezes', async () => {
    const m = await preparar();
    const modelo = (await m.como(m.gente.admin, 'POST', '/api/email/modelos', { nome: 'Boas-vindas', assunto: 'Bem-vinda, {primeiro_nome}!', conteudo: BLOCOS })).json() as { id: string };
    const funil = (await m.como(m.gente.admin, 'POST', '/api/funis', { nome: 'Vendas', etapas: [{ nome: 'Lead' }, { nome: 'Proposta' }] })).json() as { id: string; etapas: Array<{ id: string }> };
    const auto = await m.como(m.gente.admin, 'POST', '/api/automacoes', { nome: 'E-mail de proposta', ligada: true, funilId: funil.id, gatilho: { tipo: 'entrou_na_etapa', etapaId: funil.etapas[1]!.id }, passos: [{ tipo: 'enviar_email', modeloId: modelo.id }] });
    expect(auto.statusCode, auto.body).toBe(201);
    expect((await m.como(m.gente.admin, 'POST', '/api/automacoes', { nome: 'x', gatilho: { tipo: 'aniversario' }, passos: [{ tipo: 'enviar_email', modeloId: '00000000-0000-0000-0000-000000000000' }] })).statusCode).toBe(400);
    const ana = await m.cliente({ nome: 'Ana Souza', email: 'ana@exemplo.com' });
    const semEmail = await m.cliente({ nome: 'Sem Email' });
    await m.como(m.gente.admin, 'POST', `/api/conversas/${ana.id}/funis/${funil.id}`, { etapaId: funil.etapas[1]!.id });
    await m.como(m.gente.admin, 'POST', `/api/conversas/${semEmail.id}/funis/${funil.id}`, { etapaId: funil.etapas[1]!.id });
    await m.tick();
    expect(m.falso.enviados.map((e) => `${e.para.email}|${e.assunto}`)).toEqual(['ana@exemplo.com|Bem-vinda, Ana!']);
    const execs = (await m.como(m.gente.admin, 'GET', `/api/automacoes/${(auto.json() as { id: string }).id}/execucoes`)).json() as Array<{ log: Array<{ passo: string; ok: boolean; detalhe: string }> }>;
    expect(execs.flatMap((x) => x.log.filter((l) => l.passo === 'enviar_email').map((l) => l.detalhe)).sort()).toEqual(['A cliente não tem e-mail válido na ficha.', 'E-mail "Boas-vindas" na fila para ana@exemplo.com.']);

    // Aniversário (data de hoje na Bahia), uma vez por ano.
    const niver = (await m.como(m.gente.admin, 'POST', '/api/email/modelos', { nome: 'Parabéns', assunto: 'Feliz aniversário, {primeiro_nome}!', conteudo: BLOCOS })).json() as { id: string };
    await m.como(m.gente.admin, 'POST', '/api/automacoes', { nome: 'Aniversário', ligada: true, gatilho: { tipo: 'aniversario' }, passos: [{ tipo: 'enviar_email', modeloId: niver.id }] });
    await m.cliente({ nome: 'Carol Niver', email: 'carol@exemplo.com', nascimento: '1990-11-05' });
    await m.cliente({ nome: 'Outra Data', email: 'outra@exemplo.com', nascimento: '1990-03-01' });
    await m.automacoes.tick();
    await m.automacoes.ocioso();
    await m.automacoes.tick();
    await m.automacoes.ocioso();
    await m.tick();
    expect(m.falso.enviados.filter((e) => e.assunto.startsWith('Feliz')).map((e) => e.para.email)).toEqual(['carol@exemplo.com']);
  });
});
