import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { Sintonia } from '../src/app/sintonia.js';
import type { Papel, Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ContatosMemoria, ContatosPostgres } from '../src/contatos/contatos.js';
import { ArmazemFunisMemoria, ArmazemFunisPostgres, Funis } from '../src/funis/funis.js';
import { ArmazemIntegracoesMemoria, ArmazemIntegracoesPostgres } from '../src/integracoes/armazem.js';
import { assinaturaValida, gerarChave, hashConfere, mascarar, prefixoDe } from '../src/integracoes/chaves.js';
import { conferirDestino, ipBloqueado, lookupSeguro } from '../src/integracoes/ssrf.js';
import { montarIntegracoes } from '../src/integracoes/rotas.js';
import type { Transporte } from '../src/integracoes/webhooks.js';
import { observarEventos } from '../src/notificacoes/notificador.js';
import { criarServidor } from '../src/server.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags } from '../src/tags/tags.js';
import { ambientes, quinta, AgenteFalso, type Ambiente } from './gestao-ambiente.js';

const hashPadrao = gerarHash('Imperio2026xyz');

type Pedido = Parameters<Transporte>[0];

async function montar(amb: Ambiente, opcoes: { limiteFalhas?: number; maxTentativas?: number } = {}) {
  const { repo, contas, pool } = await amb.criar();
  if (pool) {
    await pool.query('truncate sintonia.api_chaves, sintonia.api_uso, sintonia.webhooks, sintonia.webhook_entregas, sintonia.reunioes, sintonia.links_reuniao, sintonia.rotina_tarefas cascade');
  }
  const relogio = { t: quinta(14) };
  const agora = () => relogio.t;
  const enviados: Array<{ canalId: string; telefone: string; texto: string }> = [];
  const canal: CanalWhatsApp = {
    tipo: 'evolution',
    lerWebhook: () => [],
    enviarTexto: async (canalId, telefone, texto) => {
      enviados.push({ canalId, telefone, texto });
      return { idExterno: `out-${Math.random()}` };
    },
  };
  const armazemTags = pool ? new ArmazemTagsPostgres(pool) : new ArmazemTagsMemoria(() => repo.listarConversas());
  const tags = new Tags(armazemTags, 'imperio', agora);
  let sintonia!: Sintonia;
  const funis = new Funis({ armazem: pool ? new ArmazemFunisPostgres(pool) : new ArmazemFunisMemoria(repo, armazemTags as ArmazemTagsMemoria), armazemTags, tags, repo, empresaId: 'imperio', agora, comConversa: (id, fn) => sintonia.comConversa(id, fn) });
  tags.usarFunis(funis);
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal },
    ],
    agente: new AgenteFalso(),
    agora,
  });
  await funis.garantirSistema();

  // Transporte falso dos webhooks: guarda o pedido e responde o que o teste mandar.
  const pedidos: Pedido[] = [];
  let respostaHttp: (p: Pedido) => Promise<{ status: number; corpo: string }> = async () => ({ status: 200, corpo: 'ok' });
  const avisos: Array<{ titulo: string; texto: string }> = [];
  const dns = new Map<string, string[]>([['hooks.exemplo.com', ['93.184.216.34']], ['interno.exemplo.com', ['192.168.0.10']]]);
  const integracoes = montarIntegracoes({
    armazem: pool ? new ArmazemIntegracoesPostgres(pool) : new ArmazemIntegracoesMemoria(),
    cofre: new Cofre('teste-integracoes'),
    repo,
    sintonia,
    canalDa: (u) => (u === 'norte' || u === 'sumare' ? { canalId: `imperio-${u}` } : { erro: 'Sem WhatsApp' }),
    contatos: pool ? new ContatosPostgres(pool) : new ContatosMemoria(),
    tags: (e) => (e === 'imperio' ? tags : undefined),
    funis: (e) => (e === 'imperio' ? funis : undefined),
    nomes: { funil: async (id) => (await funis.listar()).find((f) => f.id === id)?.nome, etapa: async (id) => (await armazemTags.buscar(id))?.nome },
    pool,
    contas,
    producao: true,
    resolver: async (h) => {
      const ips = dns.get(h);
      if (!ips) throw new Error('ENOTFOUND');
      return ips;
    },
    transporte: async (p) => {
      pedidos.push(p);
      return respostaHttp(p);
    },
    avisar: async (a) => void avisos.push(a),
    agora,
    limiteFalhas: opcoes.limiteFalhas,
    maxTentativas: opcoes.maxTentativas,
  });
  observarEventos(repo, (e) => integracoes.aoEvento(e));
  const app = criarServidor({ sintonia, repo, agora, auth: { contas, agora }, gestao: { tags }, aoReuniao: integracoes.aoReuniao, ...(pool ? { poolReunioes: pool } : {}) });
  integracoes.registrar(app);

  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, empresaId = 'imperio') =>
    contas.criarUsuario({ empresaId, nome, email: `${nome.split(' ')[0]!.toLowerCase()}@${empresaId}.com`, papel, unidades: papel === 'atendente' ? ['norte'] : [], senhaHash: h });
  const gente = { admin: await pessoa('Bruno Batista', 'admin'), carla: await pessoa('Carla Lima', 'atendente'), outraAdmin: await pessoa('Olga Outra', 'admin', 'outra') };
  const cookies = new Map<string, string>();
  const cookieDe = async (u: Usuario) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 400 * 86400_000))}`));
    return c;
  };
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: await cookieDe(u) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const comChave = (chave: string | undefined, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: chave ? { authorization: `Bearer ${chave}` } : {}, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const novaChave = async (escopos: string[], extra: Record<string, unknown> = {}, quem: Usuario = gente.admin) => {
    const r = await como(quem, 'POST', '/api/integracoes/chaves', { nome: 'Teste', escopos, ...extra });
    expect(r.statusCode).toBe(201);
    return r.json() as { chave: string; info: { id: string; prefixo: string } };
  };
  let tel = 0;
  const conversa = async (nome: string, texto = 'Oi, quanto custa?') => {
    const telefone = `55719881400${String(++tel).padStart(2, '0')}`;
    await sintonia.receber({ canalId: 'imperio-norte', telefone, nome, texto, deMim: false, idExterno: `in-${tel}-${Math.random()}`, em: relogio.t });
    await integracoes.webhooks.ocioso();
    // Relógio anda 1 s: mensagens seguidas não ficam no mesmo instante.
    relogio.t = new Date(relogio.t.getTime() + 1000);
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const andarFila = async () => {
    await integracoes.webhooks.ocioso();
    return integracoes.webhooks.tick();
  };
  return {
    app, repo, pool, contas, relogio, enviados, tags, funis, sintonia, integracoes, pedidos, avisos, gente, como, comChave, novaChave, conversa, andarFila,
    responder: (f: typeof respostaHttp) => { respostaHttp = f; },
  };
}

describe('chaves e SSRF (funções puras)', () => {
  it('gera chave sk_ com prefixo visível e confere só a chave certa', () => {
    const g = gerarChave();
    expect(g.chave).toMatch(/^sk_[a-z2-9]{10}_[A-Za-z0-9_-]{43}$/);
    expect(prefixoDe(g.chave)).toBe(g.prefixo);
    expect(hashConfere(g.chave, g.hash)).toBe(true);
    expect(hashConfere(`${g.chave.slice(0, -1)}${g.chave.endsWith('x') ? 'y' : 'x'}`, g.hash)).toBe(false); // teste instável corrigido: a chave podia já terminar em x
    expect(g.hash).not.toContain(g.chave.slice(14));
    expect(mascarar(g.chave)).not.toContain(g.chave.slice(15, 40));
  });

  it('bloqueia IPs internos, privados, de metadados e as formas disfarçadas', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.5.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:c0a8:0101::1']) {
      expect(ipBloqueado(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(ipBloqueado(ip), ip).toBe(false);
    const o = { producao: true, resolver: async (h: string) => (h === 'bom.com' ? ['93.184.216.34'] : h === 'ruim.com' ? ['93.184.216.34', '10.0.0.1'] : []) };
    for (const url of ['http://bom.com/x', 'https://localhost/x', 'https://app.localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest/meta-data', 'https://metadata.google.internal/', 'https://2130706433/', 'https://0x7f.1/', 'https://ruim.com/x', 'https://usuario:senha@bom.com/x', 'ftp://bom.com/x', 'https://naoexiste.com/']) {
      await expect(conferirDestino(url, o), url).rejects.toMatchObject({ codigo: 'destino_bloqueado' });
    }
    await expect(conferirDestino('https://bom.com/webhook', o)).resolves.toBeInstanceOf(URL);
    // Fora de produção, http só com a liberação explícita de desenvolvimento.
    await expect(conferirDestino('http://localhost:4000/x', { producao: false, permitirLocal: true })).resolves.toBeInstanceOf(URL);
    await expect(conferirDestino('http://localhost:4000/x', { producao: true, permitirLocal: true })).rejects.toBeTruthy();
  });

  it('lookupSeguro recusa conectar num nome que resolve para rede interna', async () => {
    const r = await new Promise<{ erro: NodeJS.ErrnoException | null }>((ok) => lookupSeguro(false)('localhost', {}, (erro) => ok({ erro })));
    expect(r.erro?.code).toBe('EDESTINO');
    // O mesmo nome passa quando o desenvolvimento libera local.
    const livre = await new Promise<{ erro: NodeJS.ErrnoException | null; ip: unknown }>((ok) => lookupSeguro(true)('localhost', {}, (erro, ip) => ok({ erro, ip })));
    expect(livre.erro).toBeNull();
  });

  it('assinatura do webhook: confere, recusa adulterada e recusa velha', () => {
    const corpo = '{"a":1}';
    const t = 1_763_647_391;
    // O mesmo cálculo do exemplo em Node da documentação.
    const c = `t=${t},v1=${createHmac('sha256', 'whsec_x').update(`${t}.${corpo}`).digest('hex')}`;
    expect(assinaturaValida('whsec_x', c, corpo, t + 10)).toBe(true);
    expect(assinaturaValida('whsec_x', c, '{"a":2}', t + 10)).toBe(false);
    expect(assinaturaValida('whsec_y', c, corpo, t + 10)).toBe(false);
    expect(assinaturaValida('whsec_x', c, corpo, t + 3600)).toBe(false);
  });
});

for (const amb of ambientes) {
  describe(`integrações (${amb.nome})`, () => {
    it('só a administração e a direção criam chaves; a chave aparece uma vez e nunca o hash', async () => {
      const t = await montar(amb);
      expect((await t.como(t.gente.carla, 'POST', '/api/integracoes/chaves', { nome: 'X', escopos: ['contatos:ler'] })).statusCode).toBe(403);
      expect((await t.como(t.gente.carla, 'GET', '/api/integracoes')).statusCode).toBe(403);
      expect((await t.como(t.gente.admin, 'POST', '/api/integracoes/chaves', { nome: 'X', escopos: ['tudo:ler'] })).statusCode).toBe(400);
      const { chave, info } = await t.novaChave(['contatos:ler']);
      const lista = await t.como(t.gente.admin, 'GET', '/api/integracoes');
      expect(lista.statusCode).toBe(200);
      const texto = lista.body;
      expect(texto).not.toContain(chave);
      expect(texto).not.toContain('"hash"');
      expect(lista.json().chaves[0]).toMatchObject({ id: info.id, prefixo: info.prefixo, situacao: 'ativa' });
    });

    it('autentica pela chave: sem chave, chave errada, revogada e vencida dão 401; cookie não vale na API v1', async () => {
      const t = await montar(amb);
      const { chave, info } = await t.novaChave(['contatos:ler'], { expiraEmDias: 1 });
      const sem = await t.comChave(undefined, 'GET', '/api/v1/eu');
      expect(sem.statusCode).toBe(401);
      expect(sem.json().erro.codigo).toBe('nao_autenticado');
      expect(sem.headers['www-authenticate']).toContain('Bearer');
      expect((await t.comChave(`${chave.slice(0, -2)}xx`, 'GET', '/api/v1/eu')).json().erro.codigo).toBe('chave_invalida');
      expect((await t.comChave('sk_abc', 'GET', '/api/v1/eu')).json().erro.codigo).toBe('chave_invalida');
      // A sessão da tela não abre a API pública.
      expect((await t.como(t.gente.admin, 'GET', '/api/v1/eu')).statusCode).toBe(401);
      const ok = await t.comChave(chave, 'GET', '/api/v1/eu');
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ empresaId: 'imperio', chave: { id: info.id, escopos: ['contatos:ler'] } });
      // Vencida.
      t.relogio.t = new Date(t.relogio.t.getTime() + 2 * 86400_000);
      t.integracoes.autenticador.esquecer();
      expect((await t.comChave(chave, 'GET', '/api/v1/eu')).json().erro.codigo).toBe('chave_expirada');
      // Revogada.
      const outra = await t.novaChave(['contatos:ler']);
      expect((await t.comChave(outra.chave, 'GET', '/api/v1/eu')).statusCode).toBe(200);
      expect((await t.como(t.gente.admin, 'POST', `/api/integracoes/chaves/${outra.info.id}/revogar`)).statusCode).toBe(200);
      expect((await t.comChave(outra.chave, 'GET', '/api/v1/eu')).json().erro.codigo).toBe('chave_revogada');
      void info;
    });

    it('confere o escopo de cada rota (escrever inclui ler) e responde erro padronizado', async () => {
      const t = await montar(amb);
      const c = await t.conversa('Maria');
      const leitura = await t.novaChave(['conversas:ler']);
      expect((await t.comChave(leitura.chave, 'GET', '/api/v1/conversas')).statusCode).toBe(200);
      const negado = await t.comChave(leitura.chave, 'POST', `/api/v1/conversas/${c.id}/mensagens`, { texto: 'oi' });
      expect(negado.statusCode).toBe(403);
      expect(negado.json()).toEqual({ erro: { codigo: 'sem_permissao', mensagem: expect.any(String), escopoNecessario: 'mensagens:escrever' } });
      const escrita = await t.novaChave(['contatos:escrever']);
      expect((await t.comChave(escrita.chave, 'GET', '/api/v1/contatos')).statusCode).toBe(200);
      const invalido = await t.comChave(escrita.chave, 'POST', '/api/v1/contatos', { telefone: '12345678' });
      expect(invalido.statusCode).toBe(400);
      expect(invalido.json().erro.codigo).toBe('telefone_invalido');
      expect((await t.comChave(escrita.chave, 'GET', '/api/v1/nao-existe')).json().erro.codigo).toBe('rota_inexistente');
    });

    it('isola as empresas: a chave de uma não vê nem mexe na conversa da outra', async () => {
      const t = await montar(amb);
      const minha = await t.conversa('Maria Imperio');
      const { conversa: daOutra } = await t.repo.buscarOuCriarConversa({ empresaId: 'outra', unidade: 'norte', canalId: 'outra-norte', telefone: '5571999990000', nome: 'Cliente da Outra', agora: t.relogio.t });
      const imperio = await t.novaChave(['conversas:ler', 'mensagens:escrever', 'contatos:ler', 'tags:escrever']);
      const outra = await t.novaChave(['conversas:ler', 'mensagens:escrever', 'tags:ler'], {}, t.gente.outraAdmin);
      const lista = (await t.comChave(imperio.chave, 'GET', '/api/v1/conversas')).json();
      expect(lista.dados.map((c: { id: string }) => c.id)).toEqual([minha.id]);
      expect((await t.comChave(imperio.chave, 'GET', `/api/v1/conversas/${daOutra.id}`)).statusCode).toBe(404);
      expect((await t.comChave(imperio.chave, 'POST', `/api/v1/conversas/${daOutra.id}/mensagens`, { texto: 'invadindo' })).statusCode).toBe(404);
      expect((await t.comChave(imperio.chave, 'GET', '/api/v1/contatos/5571999990000')).statusCode).toBe(404);
      const daOutraLista = (await t.comChave(outra.chave, 'GET', '/api/v1/conversas')).json();
      expect(daOutraLista.dados.map((c: { id: string }) => c.id)).toEqual([daOutra.id]);
      expect((await t.comChave(outra.chave, 'GET', `/api/v1/conversas/${minha.id}`)).statusCode).toBe(404);
      // As tags desta instalação são da Império: a outra empresa não as alcança.
      expect((await t.comChave(outra.chave, 'GET', '/api/v1/tags')).statusCode).toBe(501);
      expect(t.enviados.some((e) => e.texto === 'invadindo')).toBe(false);
      // A tela de uma empresa não mostra as chaves da outra.
      expect((await t.como(t.gente.admin, 'GET', '/api/integracoes')).json().chaves).toHaveLength(1);
      expect((await t.como(t.gente.admin, 'POST', `/api/integracoes/chaves/${outra.info.id}/revogar`)).statusCode).toBe(404);
    });

    it('limita as chamadas por chave e manda os cabeçalhos X-RateLimit', async () => {
      const t = await montar(amb);
      const { chave } = await t.novaChave(['contatos:ler'], { limiteMinuto: 5 });
      for (let i = 0; i < 5; i++) {
        const r = await t.comChave(chave, 'GET', '/api/v1/eu');
        expect(r.statusCode).toBe(200);
        expect(r.headers['x-ratelimit-limit']).toBe('5');
        expect(r.headers['x-ratelimit-remaining']).toBe(String(4 - i));
      }
      const r = await t.comChave(chave, 'GET', '/api/v1/eu');
      expect(r.statusCode).toBe(429);
      expect(r.json().erro.codigo).toBe('limite_excedido');
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
      // Outra chave tem o próprio limite.
      expect((await t.comChave((await t.novaChave(['contatos:ler'])).chave, 'GET', '/api/v1/eu')).statusCode).toBe(200);
      t.relogio.t = new Date(t.relogio.t.getTime() + 61_000);
      expect((await t.comChave(chave, 'GET', '/api/v1/eu')).statusCode).toBe(200);
    });

    it('envia mensagem pela API pelo mesmo caminho da tela (conversa e número novo) e registra o uso', async () => {
      const t = await montar(amb);
      const c = await t.conversa('Maria');
      const { chave, info } = await t.novaChave(['mensagens:escrever', 'conversas:ler']);
      const r = await t.comChave(chave, 'POST', `/api/v1/conversas/${c.id}/mensagens`, { texto: 'Seu pedido saiu!' });
      expect(r.statusCode).toBe(201);
      expect(r.json().mensagem).toMatchObject({ autor: 'equipe', autorNome: 'Teste (integração)', texto: 'Seu pedido saiu!' });
      expect(t.enviados).toContainEqual({ canalId: 'imperio-norte', telefone: c.telefone, texto: 'Seu pedido saiu!' });
      const depois = (await t.repo.buscarConversa(c.id))!;
      expect(depois.ultimaMensagemEquipe).toBeTruthy();
      const mensagens = (await t.comChave(chave, 'GET', `/api/v1/conversas/${c.id}/mensagens?limite=1`)).json();
      expect(mensagens.dados).toHaveLength(1);
      expect(mensagens.dados[0].texto).toBe('Seu pedido saiu!');
      expect(mensagens.proximoCursor).toBeTruthy();
      const anterior = (await t.comChave(chave, 'GET', `/api/v1/conversas/${c.id}/mensagens?limite=5&cursor=${mensagens.proximoCursor}`)).json();
      expect(anterior.dados.map((m: { texto: string }) => m.texto)).toEqual(['Oi, quanto custa?']);
      expect((await t.comChave(chave, 'GET', '/api/v1/conversas?cursor=lixo')).json().erro.codigo).toBe('cursor_invalido');

      const novo = await t.comChave(chave, 'POST', '/api/v1/mensagens', { telefone: '(71) 98877-6655', texto: 'Olá, tudo bem?', nome: 'Joana' });
      expect(novo.statusCode).toBe(201);
      expect(novo.json().conversaNova).toBe(true);
      expect(t.enviados).toContainEqual({ canalId: 'imperio-norte', telefone: '5571988776655', texto: 'Olá, tudo bem?' });
      // O mesmo número de novo: reaproveita a conversa.
      expect((await t.comChave(chave, 'POST', '/api/v1/mensagens', { telefone: '5571988776655', texto: 'De novo' })).json().conversaNova).toBe(false);

      await new Promise((ok) => setTimeout(ok, 30));
      const uso = (await t.como(t.gente.admin, 'GET', `/api/integracoes/chaves/${info.id}/uso`)).json().uso;
      expect(uso.length).toBeGreaterThanOrEqual(4);
      expect(uso.some((u: { rota: string; status: number }) => u.rota === 'POST /api/v1/mensagens' && u.status === 201)).toBe(true);
      expect(JSON.stringify(uso)).not.toContain(chave);
    });

    it('contatos: cria, busca, atualiza a ficha; lead muda de etapa e tag aplica pela API', async () => {
      const t = await montar(amb);
      await t.tags.criar({ nome: 'Cliente VIP' }, 'teste');
      const { chave } = await t.novaChave(['contatos:escrever', 'funis:escrever', 'tags:escrever', 'conversas:ler']);
      const criado = await t.comChave(chave, 'POST', '/api/v1/contatos', { telefone: '71 98811-2233', nome: 'Paula', email: 'paula@exemplo.com', observacoes: 'Veio do site' });
      expect(criado.statusCode).toBe(201);
      expect(criado.json().contato).toMatchObject({ telefone: '5571988112233', nome: 'Paula', email: 'paula@exemplo.com' });
      expect((await t.comChave(chave, 'POST', '/api/v1/contatos', { telefone: '5571988112233' })).statusCode).toBe(200);
      const busca = (await t.comChave(chave, 'GET', '/api/v1/contatos?busca=paul')).json();
      expect(busca.dados).toHaveLength(1);
      const alterado = await t.comChave(chave, 'PATCH', '/api/v1/contatos/5571988112233', { nome: 'Paula Lima' });
      expect(alterado.json().nome).toBe('Paula Lima');
      const conversaId = criado.json().contato.conversas[0].id as string;
      expect((await t.repo.buscarConversa(conversaId))!.nome).toBe('Paula Lima');
      // etapa-entrada: lead criado pela API nasce na "Entrada de leads".
      expect((await t.repo.buscarConversa(conversaId))!.etapa).toBe('entrada');

      const movido = await t.comChave(chave, 'POST', `/api/v1/conversas/${conversaId}/etapa`, { etapa: 'Reagendar' });
      expect(movido.statusCode).toBe(200);
      expect(movido.json().conversa.etapa).toBe('reagendar');
      expect((await t.comChave(chave, 'POST', `/api/v1/conversas/${conversaId}/etapa`, { etapa: 'Não existe' })).statusCode).toBe(404);
      expect((await t.comChave(chave, 'PUT', `/api/v1/conversas/${conversaId}/valor`, { valor: 1200.5 })).json().valor).toBe(1200.5);
      const tag = await t.comChave(chave, 'POST', `/api/v1/conversas/${conversaId}/tags`, { nome: 'cliente vip' });
      expect(tag.json().tags.map((x: { nome: string }) => x.nome)).toEqual(['Cliente VIP']);
      const funis = (await t.comChave(chave, 'GET', '/api/v1/funis')).json();
      expect(funis.dados[0].etapas.find((e: { nome: string }) => e.nome === 'Reagendar').leads).toBe(1);
    });

    it('webhook: entrega assinada (HMAC com timestamp) quando a cliente manda mensagem', async () => {
      const t = await montar(amb);
      const r = await t.como(t.gente.admin, 'POST', '/api/integracoes/webhooks', { nome: 'Meu sistema', url: 'https://hooks.exemplo.com/sintonia', eventos: ['mensagem.recebida', 'contato.criado'] });
      expect(r.statusCode).toBe(201);
      const { segredo, webhook } = r.json();
      expect(segredo).toMatch(/^whsec_/);
      expect((await t.como(t.gente.admin, 'GET', '/api/integracoes')).body).not.toContain(segredo);
      await t.conversa('Maria', 'Quero agendar');
      expect(await t.andarFila()).toBe(2);
      const recebida = t.pedidos.find((p) => p.cabecalhos['sintonia-evento'] === 'mensagem.recebida')!;
      expect(recebida.url.toString()).toBe('https://hooks.exemplo.com/sintonia');
      const corpo = JSON.parse(recebida.corpo);
      expect(corpo).toMatchObject({ tipo: 'mensagem.recebida', empresaId: 'imperio', dados: { mensagem: { texto: 'Quero agendar', autor: 'cliente' }, conversa: { nome: 'Maria' } } });
      const agoraSeg = Math.floor(t.relogio.t.getTime() / 1000);
      expect(assinaturaValida(segredo, recebida.cabecalhos['sintonia-assinatura'], recebida.corpo, agoraSeg)).toBe(true);
      expect(assinaturaValida(segredo, recebida.cabecalhos['sintonia-assinatura'], recebida.corpo.replace('agendar', 'cancelar'), agoraSeg)).toBe(false);
      expect(t.pedidos.some((p) => p.cabecalhos['sintonia-evento'] === 'contato.criado')).toBe(true);
      // Histórico com status e resposta; segunda volta da fila não entrega de novo.
      expect(await t.andarFila()).toBe(0);
      const hist = (await t.como(t.gente.admin, 'GET', `/api/integracoes/webhooks/${webhook.id}/entregas`)).json().entregas;
      expect(hist.map((e: { status: string; ultimoHttp: number }) => [e.status, e.ultimoHttp])).toEqual([['entregue', 200], ['entregue', 200]]);
      const detalhe = (await t.como(t.gente.admin, 'GET', `/api/integracoes/entregas/${hist[0].id}`)).json().entrega;
      expect(detalhe.ultimaResposta).toBe('ok');
      // Mensagem enviada não assinada: não vira entrega.
      const c = (await t.repo.listarConversas())[0]!;
      await t.sintonia.equipeEnviou(c.id, 'Oi!', 'Carla');
      expect(await t.andarFila()).toBe(0);
    });

    it('webhook: tenta de novo com espera crescente, desiste depois do máximo e desliga sozinho após muitas falhas (com aviso)', async () => {
      const t = await montar(amb, { limiteFalhas: 4, maxTentativas: 3 });
      t.responder(async () => ({ status: 500, corpo: 'erro' }));
      const w = (await t.como(t.gente.admin, 'POST', '/api/integracoes/webhooks', { url: 'https://hooks.exemplo.com/x', eventos: ['mensagem.recebida'] })).json().webhook;
      await t.conversa('Ana', 'Oi');
      expect(await t.andarFila()).toBe(1);
      let e = (await t.como(t.gente.admin, 'GET', `/api/integracoes/webhooks/${w.id}/entregas`)).json().entregas[0];
      expect(e).toMatchObject({ status: 'pendente', tentativas: 1, ultimoHttp: 500 });
      const espera1 = new Date(e.proximaEm).getTime() - t.relogio.t.getTime();
      expect(espera1).toBeGreaterThanOrEqual(54_000);
      expect(espera1).toBeLessThanOrEqual(66_000);
      // Antes da hora, não tenta.
      expect(await t.andarFila()).toBe(0);
      t.relogio.t = new Date(t.relogio.t.getTime() + 70_000);
      expect(await t.andarFila()).toBe(1);
      e = (await t.como(t.gente.admin, 'GET', `/api/integracoes/webhooks/${w.id}/entregas`)).json().entregas[0];
      const espera2 = new Date(e.proximaEm).getTime() - t.relogio.t.getTime();
      expect(espera2).toBeGreaterThan(4 * 60_000);
      t.relogio.t = new Date(t.relogio.t.getTime() + 6 * 60_000);
      expect(await t.andarFila()).toBe(1);
      e = (await t.como(t.gente.admin, 'GET', `/api/integracoes/webhooks/${w.id}/entregas`)).json().entregas[0];
      expect(e).toMatchObject({ status: 'falhou', tentativas: 3 });
      // Quarta falha seguida (outra mensagem): desliga e avisa a gestão.
      await t.conversa('Bia', 'Oi');
      expect(await t.andarFila()).toBe(1);
      const tela = (await t.como(t.gente.admin, 'GET', '/api/integracoes')).json().webhooks[0];
      expect(tela).toMatchObject({ ativo: false, falhasSeguidas: 4 });
      expect(tela.desligadoMotivo).toContain('4 falhas');
      expect(t.avisos[0]?.titulo).toBe('Webhook desligado');
      // Desligado: evento novo não entra na fila; reenviar pede para ligar.
      await t.conversa('Cris', 'Oi');
      expect(await t.andarFila()).toBe(0);
      expect((await t.como(t.gente.admin, 'POST', `/api/integracoes/entregas/${e.id}/reenviar`)).statusCode).toBe(409);
      // Ligou de novo e o sistema voltou: reenviar entrega na hora.
      t.responder(async () => ({ status: 204, corpo: '' }));
      expect((await t.como(t.gente.admin, 'PATCH', `/api/integracoes/webhooks/${w.id}`, { ativo: true })).json().webhook).toMatchObject({ ativo: true, falhasSeguidas: 0 });
      const re = (await t.como(t.gente.admin, 'POST', `/api/integracoes/entregas/${e.id}/reenviar`)).json().entrega;
      expect(re).toMatchObject({ status: 'entregue', ultimoHttp: 204, eventoId: e.eventoId });
    });

    it('webhook: "Enviar teste", troca de segredo e bloqueio de SSRF no cadastro', async () => {
      const t = await montar(amb);
      for (const url of ['http://hooks.exemplo.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest/meta-data/', 'https://interno.exemplo.com/x', 'https://[::ffff:10.0.0.1]/x']) {
        const r = await t.como(t.gente.admin, 'POST', '/api/integracoes/webhooks', { url, eventos: ['mensagem.recebida'] });
        expect(r.statusCode, url).toBe(400);
        expect(r.json().codigo, url).toBe('destino_bloqueado');
      }
      expect((await t.como(t.gente.admin, 'POST', '/api/integracoes/webhooks', { url: 'https://hooks.exemplo.com/x', eventos: ['nada'] })).statusCode).toBe(400);
      const { webhook, segredo } = (await t.como(t.gente.admin, 'POST', '/api/integracoes/webhooks', { url: 'https://hooks.exemplo.com/x', eventos: ['nps.respondido'] })).json();
      const teste = (await t.como(t.gente.admin, 'POST', `/api/integracoes/webhooks/${webhook.id}/teste`)).json().entrega;
      expect(teste).toMatchObject({ status: 'entregue', evento: 'webhook.teste', teste: true });
      expect(assinaturaValida(segredo, t.pedidos[0]!.cabecalhos['sintonia-assinatura'], t.pedidos[0]!.corpo, Math.floor(t.relogio.t.getTime() / 1000))).toBe(true);
      // Trocar a URL para um IP interno também é bloqueado.
      expect((await t.como(t.gente.admin, 'PATCH', `/api/integracoes/webhooks/${webhook.id}`, { url: 'https://10.0.0.2/x' })).statusCode).toBe(400);
      const novo = (await t.como(t.gente.admin, 'POST', `/api/integracoes/webhooks/${webhook.id}/segredo`)).json().segredo;
      expect(novo).not.toBe(segredo);
      expect((await t.como(t.gente.admin, 'GET', `/api/integracoes/webhooks/${webhook.id}/segredo`)).json().segredo).toBe(novo);
      expect((await t.como(t.gente.carla, 'GET', `/api/integracoes/webhooks/${webhook.id}/segredo`)).statusCode).toBe(403);
    });

    it('webhook: etapa mudou e tag aplicada viram eventos com os nomes', async () => {
      const t = await montar(amb);
      await t.tags.criar({ nome: 'Retorno' }, 'teste');
      await t.como(t.gente.admin, 'POST', '/api/integracoes/webhooks', { url: 'https://hooks.exemplo.com/x', eventos: ['lead.etapa_mudou', 'tag.aplicada'] });
      const c = await t.conversa('Maria');
      const { chave } = await t.novaChave(['funis:escrever', 'tags:escrever']);
      await t.comChave(chave, 'POST', `/api/v1/conversas/${c.id}/etapa`, { etapa: 'Agendado' });
      await t.comChave(chave, 'POST', `/api/v1/conversas/${c.id}/tags`, { nome: 'Retorno' });
      await t.andarFila();
      const corpos = t.pedidos.map((p) => JSON.parse(p.corpo));
      const etapa = corpos.find((x) => x.tipo === 'lead.etapa_mudou' && x.dados.para?.nome === 'Agendado');
      expect(etapa.dados).toMatchObject({ funil: { nome: 'Atendimento' }, por: 'Teste (integração)' });
      expect(corpos.find((x) => x.tipo === 'tag.aplicada').dados).toMatchObject({ tag: { nome: 'Retorno' }, por: 'Teste (integração)' });
    });

    it('MCP: initialize, tools/list só com o que a chave pode e tools/call', async () => {
      const t = await montar(amb);
      const c = await t.conversa('Maria Clara', 'Oi, tudo bem?');
      const { chave } = await t.novaChave(['contatos:ler', 'conversas:ler', 'mensagens:ler']);
      const rpc = (corpo: unknown, k: string = chave) => t.app.inject({ method: 'POST', url: '/mcp', headers: { ...(k ? { authorization: `Bearer ${k}` } : {}), accept: 'application/json, text/event-stream' }, payload: corpo as object });
      expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, '')).statusCode).toBe(401);
      const ini = (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } } })).json();
      expect(ini.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sintonia' } });
      expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).statusCode).toBe(202);
      const lista = (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
      const nomes = lista.result.tools.map((x: { name: string }) => x.name);
      expect(nomes).toEqual(expect.arrayContaining(['buscar_contato', 'ver_conversa', 'listar_conversas']));
      expect(nomes).not.toContain('enviar_mensagem');
      expect(lista.result.tools[0].inputSchema.type).toBe('object');
      const busca = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'buscar_contato', arguments: { busca: 'clara' } } })).json();
      expect(busca.result.isError).toBeUndefined();
      expect(busca.result.structuredContent.dados[0].telefone).toBe(c.telefone);
      expect(busca.result.content[0].type).toBe('text');
      const ver = (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'ver_conversa', arguments: { conversaId: c.id } } })).json();
      expect(ver.result.structuredContent.mensagens[0].texto).toBe('Oi, tudo bem?');
      const negado = (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'enviar_mensagem', arguments: { conversaId: c.id, texto: 'oi' } } })).json();
      expect(negado.result.isError).toBe(true);
      expect(t.enviados).toHaveLength(0);
      expect((await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nao_existe' } })).json().error.code).toBe(-32602);
      expect((await rpc({ jsonrpc: '2.0', id: 7, method: 'metodo/estranho' })).json().error.code).toBe(-32601);
      // Com o escopo, a ferramenta envia pelo mesmo caminho da API.
      const envio = await t.novaChave(['mensagens:escrever']);
      const ok = (await rpc({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'enviar_mensagem', arguments: { conversaId: c.id, texto: 'Oi pelo MCP' } } }, envio.chave)).json();
      expect(ok.result.isError).toBeUndefined();
      expect(t.enviados.map((e) => e.texto)).toEqual(['Oi pelo MCP']);
      // Outra empresa: não acha a conversa.
      const outra = await t.novaChave(['conversas:ler', 'mensagens:ler'], {}, t.gente.outraAdmin);
      const fora = (await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'ver_conversa', arguments: { conversaId: c.id } } }, outra.chave)).json();
      expect(fora.result.isError).toBe(true);
      // Navegador de outro site: recusado.
      const site = await t.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${chave}`, origin: 'https://site-malicioso.com' }, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } });
      expect(site.statusCode).toBe(403);
      expect((await t.app.inject({ method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${chave}` } })).statusCode).toBe(405);
    });

    it('documentação pública e openapi.json sem dado de empresa', async () => {
      const t = await montar(amb);
      await t.conversa('Maria Secreta');
      const doc = await t.app.inject({ method: 'GET', url: '/desenvolvedores' });
      expect(doc.statusCode).toBe(200);
      expect(doc.headers['content-type']).toContain('text/html');
      const api = await t.app.inject({ method: 'GET', url: '/openapi.json' });
      expect(api.statusCode).toBe(200);
      const j = api.json();
      expect(j.openapi).toBe('3.1.0');
      expect(Object.keys(j.paths)).toContain('/api/v1/conversas/{id}/mensagens');
      expect(Object.keys(j.webhooks)).toContain('mensagem.recebida');
      expect(api.body).not.toContain('Maria Secreta');
    });

    if (amb.nome === 'postgres') {
      it('agendamento por link e tarefa pela API (com webhook agendamento.criado/cancelado)', async () => {
        const t = await montar(amb);
        await t.como(t.gente.admin, 'POST', '/api/integracoes/webhooks', { url: 'https://hooks.exemplo.com/x', eventos: ['agendamento.criado', 'agendamento.cancelado'] });
        const link = (await t.como(t.gente.admin, 'POST', '/api/reunioes/links', { titulo: 'Consulta', duracao_min: 30, dias: [0, 1, 2, 3, 4, 5, 6], inicio: '09:00', fim: '18:00', antecedencia_h: 0, janela_dias: 10 })).json();
        const { chave } = await t.novaChave(['agendamentos:escrever', 'tarefas:escrever']);
        const links = (await t.comChave(chave, 'GET', '/api/v1/agendamentos/links')).json();
        expect(links.dados[0].id).toBe(link.id);
        const amanha = new Date(t.relogio.t.getTime() + 86400_000 - 3 * 3600_000).toISOString().slice(0, 10);
        const ag = await t.comChave(chave, 'POST', '/api/v1/agendamentos', { linkId: link.id, data: amanha, hora: '10:00', nome: 'Maria', telefone: '5571988112233' });
        expect(ag.statusCode).toBe(201);
        expect((await t.comChave(chave, 'POST', '/api/v1/agendamentos', { linkId: link.id, data: amanha, hora: '10:00', nome: 'Outra', telefone: '5571988112234' })).statusCode).toBe(409);
        const lista = (await t.comChave(chave, 'GET', '/api/v1/agendamentos')).json();
        expect(lista.dados.map((x: { id: string }) => x.id)).toContain(ag.json().id);
        expect((await t.comChave(chave, 'POST', `/api/v1/agendamentos/${ag.json().id}/cancelar`)).json()).toMatchObject({ status: 'cancelado', mudou: true });
        await t.andarFila();
        expect(t.pedidos.map((p) => p.cabecalhos['sintonia-evento']).sort()).toEqual(['agendamento.cancelado', 'agendamento.criado']);

        const tarefa = await t.comChave(chave, 'POST', '/api/v1/tarefas', { titulo: 'Ligar para a Maria', prioridade: 'alta' });
        expect(tarefa.statusCode).toBe(201);
        expect(tarefa.json()).toMatchObject({ responsavelId: t.gente.admin.id, prioridade: 'alta', feita: false });
        expect((await t.comChave(chave, 'POST', '/api/v1/tarefas', { titulo: 'X', responsavelId: t.gente.outraAdmin.id })).statusCode).toBe(400);
        expect((await t.comChave(chave, 'GET', '/api/v1/tarefas')).json().dados).toHaveLength(1);
      }, 20_000);
    }
  });
}
