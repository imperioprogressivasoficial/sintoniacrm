import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { nomeDoAparelho } from '../src/auth/acessos.js';
import { ContasMemoria, ContasPostgres, type Contas, type Papel, type Usuario } from '../src/auth/contas.js';
import { emailConvite } from '../src/auth/recuperacao.js';
import type { Recuperacao } from '../src/auth/rotas.js';
import { gerarHash } from '../src/auth/senha.js';
import { linkWhatsApp, telefoneWhatsApp } from '../src/auth/usuarios-rotas.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/**
 * usuarios: o sistema de usuários de ponta a ponta — convidar → abrir o link → criar a senha → entrar;
 * desativar derruba a sessão; link de nova senha gerado pela gestão; último admin protegido;
 * apagar só sem histórico; meus aparelhos conectados; e uma empresa nunca enxerga a outra.
 */

const SENHA = 'Imperio2026xyz';
const NOVA = 'MinhaSenha2026ok';
const hashPadrao = gerarHash(SENHA);

const ambientes: Array<{ nome: string; criar(): Promise<{ repo: Repositorio; contas: Contas }> }> = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria() }) },
  ...(temPostgres
    ? [{
        nome: 'postgres',
        criar: async () => {
          const pool = await poolDeTeste();
          await pool.query('delete from sintonia.acesso_perfis; delete from sintonia.acesso_auditoria');
          return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool) };
        },
      }]
    : []),
];

async function montar(amb: (typeof ambientes)[number], opcoes: { email?: boolean } = {}) {
  const { repo, contas } = await amb.criar();
  const relogio = { t: bahia(2026, 11, 5, 14) };
  const convites: Array<{ para: string; link: string; horas: number; quem: string }> = [];
  const redefinicoes: Array<{ para: string; link: string }> = [];
  const recuperacao: Recuperacao = {
    canais: async () => ({ email: !!opcoes.email, whatsapp: false }),
    enviar: async (u, link) => {
      redefinicoes.push({ para: u.email, link });
      return ['e-mail'];
    },
    convidar: async (u, link, horas, quem) => {
      convites.push({ para: u.email, link, horas, quem });
      return true;
    },
  };
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora: () => relogio.t });
  const app = criarServidor({ sintonia, repo, agora: () => relogio.t, auth: { contas, agora: () => relogio.t, recuperacao } });
  const h = await hashPadrao;
  const pessoa = (empresaId: string, nome: string, papel: Papel, unidades: string[] = []) =>
    contas.criarUsuario({ empresaId, nome, email: `${nome.split(' ')[0]!.toLowerCase()}.${empresaId}@teste.com`, papel, unidades, senhaHash: h });
  const gente = {
    bruno: await pessoa('imperio', 'Bruno Batista', 'admin'),
    diana: await pessoa('imperio', 'Diana Reis', 'direcao'),
    gil: await pessoa('imperio', 'Gil Norte', 'gerente', ['norte']),
    // Outra empresa, com a própria administração.
    otto: await pessoa('outra', 'Otto Lopes', 'admin'),
  };
  let ip = 0;
  const entrar = (email: string, senha = SENHA, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36') =>
    app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha }, headers: { 'user-agent': ua }, remoteAddress: `10.7.0.${++ip}` });
  const cookieDe = async (email: string, senha = SENHA, ua?: string) => {
    const r = await entrar(email, senha, ua);
    expect(r.statusCode, r.body).toBe(200);
    return String(r.headers['set-cookie']).split(';')[0]!;
  };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    if (!cookies.has(u.id)) cookies.set(u.id, await cookieDe(u.email));
    return app.inject({ method, url, headers: { cookie: cookies.get(u.id)! }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  const comCookie = (cookie: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const tokenDe = (link: string) => new URL(link).searchParams.get('t')!;
  return { app, contas, relogio, gente, entrar, cookieDe, como, comCookie, tokenDe, convites, redefinicoes };
}

describe('usuarios: peças puras', () => {
  it('telefone e link do WhatsApp com o texto pronto', () => {
    expect(telefoneWhatsApp('(71) 99999-0000')).toBe('5571999990000');
    expect(telefoneWhatsApp('+55 71 99999-0000')).toBe('5571999990000');
    expect(telefoneWhatsApp('123')).toBe('');
    expect(linkWhatsApp('', 'oi')).toBe('https://wa.me/?text=oi');
    expect(linkWhatsApp('71 3333-4444', 'a b')).toBe('https://wa.me/557133334444?text=a%20b');
  });
  it('nome amigável do aparelho', () => {
    expect(nomeDoAparelho('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17.0 Mobile Safari/604.1')).toBe('Safari no iPhone');
    expect(nomeDoAparelho('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36')).toBe('Chrome no Windows');
    expect(nomeDoAparelho('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36')).toBe('Chrome no Android');
    expect(nomeDoAparelho(null)).toBe('Aparelho');
  });
  it('e-mail do convite escapa o nome e diz a validade', () => {
    const m = emailConvite('<b>Ana</b> Souza', 'Bruno', 'https://x/convite?t=abc', 72);
    expect(m.html).not.toContain('<b>Ana</b>');
    expect(m.texto).toContain('3 dias');
    expect(m.assunto).toContain('Bruno');
  });
});

describe.each(ambientes)('usuarios de ponta a ponta ($nome)', (amb) => {
  it('sem e-mail configurado: convite gera link (copiar/WhatsApp), a pessoa cria a senha e já entra', async () => {
    const t = await montar(amb, { email: false });
    const r = await t.como(t.gente.bruno, 'POST', '/api/acessos/usuarios', { nome: 'Carla Lima', email: 'carla@imperio.com', telefone: '(71) 98888-1234', papel: 'atendente', unidades: ['norte'] });
    expect(r.statusCode, r.body).toBe(201);
    const j = r.json();
    expect(j.email).toEqual({ configurado: false, enviado: false, para: 'carla@imperio.com' });
    expect(t.convites).toHaveLength(0);
    expect(j.link).toMatch(/\/convite\?t=/);
    expect(j.whatsapp).toMatch(/^https:\/\/wa\.me\/5571988881234\?text=/);
    expect(decodeURIComponent(j.whatsapp)).toContain(j.link);
    expect(j.pessoa).toMatchObject({ telefone: '(71) 98888-1234', nuncaEntrou: true, convite: { tipo: 'convite' } });
    // A tela sabe que não há e-mail.
    expect((await t.como(t.gente.bruno, 'GET', '/api/acessos/usuarios')).json().envio).toEqual({ email: false });

    // A pessoa abre o link: vê o nome dela e cria a senha.
    const token = t.tokenDe(j.link);
    const ver = await t.app.inject({ method: 'GET', url: `/api/auth/convite?t=${encodeURIComponent(token)}` });
    expect(ver.json()).toMatchObject({ nome: 'Carla Lima', email: 'carla@imperio.com', tipo: 'convite' });
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t: token, senha: 'curta1' } })).statusCode).toBe(400);
    const criar = await t.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t: token, senha: NOVA } });
    expect(criar.statusCode, criar.body).toBe(200);
    const entrou = await t.entrar('carla@imperio.com', NOVA);
    expect(entrou.statusCode).toBe(200);
    expect(entrou.json().trocarSenha).toBeUndefined();
    // Uso único.
    expect((await t.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t: token, senha: 'OutraSenha2026x' } })).statusCode).toBe(404);
    const lista = (await t.como(t.gente.bruno, 'GET', '/api/acessos/usuarios')).json().pessoas;
    expect(lista.find((p: { email: string }) => p.email === 'carla@imperio.com')).toMatchObject({ nuncaEntrou: false, convite: null });
  });

  it('com e-mail configurado: o convite também sai por e-mail; link vence no prazo', async () => {
    const t = await montar(amb, { email: true });
    const r = await t.como(t.gente.diana, 'POST', '/api/acessos/usuarios', { nome: 'Rita Recepção', email: 'rita@imperio.com', papel: 'recepcionista', unidades: ['norte'], validadeHoras: 1 });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().email).toMatchObject({ configurado: true, enviado: true });
    expect(r.json().whatsapp).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(t.convites).toEqual([{ para: 'rita@imperio.com', link: r.json().link, horas: 1, quem: 'Diana Reis' }]);
    t.relogio.t = new Date(t.relogio.t.getTime() + 2 * 3600_000);
    const token = t.tokenDe(r.json().link);
    expect((await t.app.inject({ method: 'GET', url: `/api/auth/convite?t=${encodeURIComponent(token)}` })).statusCode).toBe(404);
    // A gestão gera um convite novo (quem nunca entrou recebe "convite", não "nova senha").
    const novo = await t.como(t.gente.diana, 'POST', `/api/acessos/usuarios/${r.json().pessoa.id}/link`, {});
    expect(novo.statusCode, novo.body).toBe(200);
    expect(novo.json()).toMatchObject({ tipo: 'convite', email: { enviado: true } });
    expect(novo.json().link).toMatch(/\/convite\?t=/);
  });

  it('desativar: a sessão cai na hora e não entra mais; reativar volta', async () => {
    const t = await montar(amb);
    const carla = await t.contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla2@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await hashPadrao });
    const cookie = await t.cookieDe(carla.email);
    expect((await t.comCookie(cookie, 'GET', '/api/auth/eu')).statusCode).toBe(200);
    expect((await t.como(t.gente.bruno, 'POST', `/api/acessos/usuarios/${carla.id}/desativar`)).statusCode).toBe(200);
    expect((await t.comCookie(cookie, 'GET', '/api/auth/eu')).statusCode).toBe(401);
    expect((await t.entrar(carla.email)).statusCode).toBe(401);
    // Desativada não recebe link.
    expect((await t.como(t.gente.bruno, 'POST', `/api/acessos/usuarios/${carla.id}/link`, {})).statusCode).toBe(409);
    expect((await t.como(t.gente.bruno, 'POST', `/api/acessos/usuarios/${carla.id}/reativar`)).statusCode).toBe(200);
    expect((await t.entrar(carla.email)).statusCode).toBe(200);
  });

  it('redefinir por link (sem e-mail): senha antiga para de valer e as sessões caem', async () => {
    const t = await montar(amb, { email: false });
    const lia = await t.contas.criarUsuario({ empresaId: 'imperio', nome: 'Lia Souza', email: 'lia@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await hashPadrao });
    const cookie = await t.cookieDe(lia.email);
    await t.como(t.gente.bruno, 'PATCH', `/api/acessos/usuarios/${lia.id}`, { telefone: '71 99999-0000' });
    const r = await t.como(t.gente.bruno, 'POST', `/api/acessos/usuarios/${lia.id}/link`, {});
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ tipo: 'redefinir', email: { configurado: false, enviado: false } });
    expect(r.json().link).toMatch(/\/nova-senha\?t=/);
    expect(r.json().whatsapp).toMatch(/^https:\/\/wa\.me\/5571999990000\?text=/);
    expect(t.redefinicoes).toHaveLength(0);
    const ok = await t.app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t: t.tokenDe(r.json().link), senha: NOVA } });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await t.comCookie(cookie, 'GET', '/api/auth/eu')).statusCode).toBe(401);
    expect((await t.entrar(lia.email)).statusCode).toBe(401);
    expect((await t.entrar(lia.email, NOVA)).statusCode).toBe(200);
  });

  it('editar: nome, e-mail, telefone, papel e unidades; e-mail repetido é recusado', async () => {
    const t = await montar(amb);
    const r = await t.como(t.gente.bruno, 'POST', '/api/acessos/usuarios', { nome: 'Ana Erro', email: 'ana@errado.com', papel: 'atendente', unidades: ['norte'] });
    const id = r.json().pessoa.id;
    const e = await t.como(t.gente.bruno, 'PATCH', `/api/acessos/usuarios/${id}`, { nome: 'Ana Certa', email: 'ana@imperio.com', telefone: '(71) 90000-1111', papel: 'gerente', unidades: ['norte', 'sumare'] });
    expect(e.statusCode, e.body).toBe(200);
    expect(e.json()).toMatchObject({ nome: 'Ana Certa', email: 'ana@imperio.com', telefone: '(71) 90000-1111', papel: 'gerente', unidades: ['norte', 'sumare'] });
    expect((await t.como(t.gente.bruno, 'PATCH', `/api/acessos/usuarios/${id}`, { email: t.gente.diana.email })).statusCode).toBe(409);
    expect((await t.como(t.gente.bruno, 'PATCH', `/api/acessos/usuarios/${id}`, { telefone: 'abc' })).statusCode).toBe(400);
    expect((await t.como(t.gente.bruno, 'PATCH', `/api/acessos/usuarios/${id}`, { unidades: ['nao-existe'] })).statusCode).toBe(400);
  });

  it('último admin protegido: não desativa, não rebaixa, não apaga, não se mexe sozinho e não perde a equipe', async () => {
    const t = await montar(amb);
    const { bruno, diana } = t.gente;
    // Direção não mexe em admin; o admin não mexe em si mesmo.
    expect((await t.como(diana, 'POST', `/api/acessos/usuarios/${bruno.id}/desativar`)).statusCode).toBe(403);
    expect((await t.como(bruno, 'PATCH', `/api/acessos/usuarios/${bruno.id}`, { papel: 'atendente' })).statusCode).toBe(403);
    // Com um segundo admin, um pode rebaixar o outro; o que sobrou é protegido.
    const ana = await t.contas.criarUsuario({ empresaId: 'imperio', nome: 'Ana Admin', email: 'ana.adm@imperio.com', papel: 'admin', unidades: [], senhaHash: await hashPadrao });
    expect((await t.como(bruno, 'PATCH', `/api/acessos/usuarios/${ana.id}`, { papel: 'direcao' })).statusCode).toBe(200);
    expect((await t.como(bruno, 'PATCH', `/api/acessos/usuarios/${ana.id}`, { papel: 'admin' })).statusCode).toBe(200);
    // Ajuste próprio não tira a equipe de quem é Administração.
    expect((await t.como(bruno, 'PATCH', `/api/acessos/usuarios/${ana.id}`, { ajustes: { equipe: false } })).json().permissoes.equipe).toBe(true);
    await t.como(bruno, 'POST', `/api/acessos/usuarios/${ana.id}/desativar`);
    // Agora o Bruno é o único admin ativo: ele não se mexe, a direção não mexe nele, e a regra do servidor recusa.
    expect((await t.como(bruno, 'GET', '/api/acessos/usuarios')).json().admins).toBe(1);
    expect((await t.como(bruno, 'POST', `/api/acessos/usuarios/${bruno.id}/desativar`)).statusCode).toBe(403);
    expect((await t.como(diana, 'DELETE', `/api/acessos/usuarios/${bruno.id}`)).statusCode).toBe(403);
    const { seriaUltimoAdmin } = await import('../src/auth/usuarios-rotas.js');
    const todos = await t.contas.listarUsuarios('imperio');
    expect(seriaUltimoAdmin(todos, bruno, { ativo: false })).toBe(true);
    expect(seriaUltimoAdmin(todos, bruno, { papel: 'direcao' })).toBe(true);
    // Com a Ana de volta, ela pode desativar o Bruno, mas não apagar (ele tem histórico).
    await t.como(bruno, 'POST', `/api/acessos/usuarios/${ana.id}/reativar`);
    expect((await t.como(ana, 'DELETE', `/api/acessos/usuarios/${bruno.id}`)).statusCode).toBe(409);
    expect((await t.como(ana, 'POST', `/api/acessos/usuarios/${bruno.id}/desativar`)).statusCode).toBe(200);
    expect((await t.como(ana, 'GET', '/api/acessos/usuarios')).json().admins).toBe(1);
  });

  it('apagar: só quem nunca entrou e não tem histórico; os outros só desativam', async () => {
    const t = await montar(amb);
    const conv = await t.como(t.gente.bruno, 'POST', '/api/acessos/usuarios', { nome: 'Errada Cadastro', email: 'errada@imperio.com', papel: 'atendente', unidades: ['norte'] });
    const id = conv.json().pessoa.id;
    const token = t.tokenDe(conv.json().link);
    const apagar = await t.como(t.gente.bruno, 'DELETE', `/api/acessos/usuarios/${id}`);
    expect(apagar.statusCode, apagar.body).toBe(200);
    expect(await t.contas.buscarPorId(id)).toBeUndefined();
    // O link do convite apagado não abre mais.
    expect((await t.app.inject({ method: 'GET', url: `/api/auth/convite?t=${encodeURIComponent(token)}` })).statusCode).toBe(404);
    // Quem já entrou tem histórico.
    const lia = await t.contas.criarUsuario({ empresaId: 'imperio', nome: 'Lia Souza', email: 'lia3@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await hashPadrao });
    await t.cookieDe(lia.email);
    const nao = await t.como(t.gente.bruno, 'DELETE', `/api/acessos/usuarios/${lia.id}`);
    expect(nao.statusCode).toBe(409);
    expect(nao.json().erro).toMatch(/já entrou no Sintonia/);
    expect(await t.contas.buscarPorId(lia.id)).toBeDefined();
    // Gerente só apaga quem ele gerencia (atendente das unidades dele); direção não apaga admin.
    expect((await t.como(t.gente.gil, 'DELETE', `/api/acessos/usuarios/${t.gente.diana.id}`)).statusCode).toBe(404);
  });

  it('isolamento entre empresas: a outra administração não vê, não edita, não apaga e não gera link', async () => {
    const t = await montar(amb);
    const { otto, gil } = t.gente;
    const pessoas = (await t.como(otto, 'GET', '/api/acessos/usuarios')).json().pessoas as Array<{ email: string }>;
    expect(pessoas.map((p) => p.email)).toEqual([otto.email]);
    for (const [m, url, corpo] of [
      ['PATCH', `/api/acessos/usuarios/${gil.id}`, { nome: 'Invasor' }],
      ['POST', `/api/acessos/usuarios/${gil.id}/desativar`, undefined],
      ['POST', `/api/acessos/usuarios/${gil.id}/link`, {}],
      ['DELETE', `/api/acessos/usuarios/${gil.id}`, undefined],
      ['GET', `/api/acessos/usuarios/${gil.id}/sessoes`, undefined],
    ] as const) {
      expect((await t.como(otto, m, url, corpo)).statusCode, `${m} ${url}`).toBe(404);
    }
    expect((await t.contas.buscarPorId(gil.id))?.nome).toBe('Gil Norte');
    // O convite que a outra empresa cria fica nela.
    const r = await t.como(otto, 'POST', '/api/acessos/usuarios', { nome: 'Paula Outra', email: 'paula@outra.com', papel: 'atendente', unidades: [] });
    expect(r.statusCode, r.body).toBe(201);
    expect((await t.contas.buscarPorId(r.json().pessoa.id))?.empresaId).toBe('outra');
    expect((await t.como(t.gente.bruno, 'GET', '/api/acessos/usuarios')).json().pessoas.some((p: { email: string }) => p.email === 'paula@outra.com')).toBe(false);
  });

  it('meus aparelhos: lista com "este aparelho", sai de um, sai dos outros; trocar senha encerra os outros', async () => {
    const t = await montar(amb);
    const lia = await t.contas.criarUsuario({ empresaId: 'imperio', nome: 'Lia Souza', email: 'lia4@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await hashPadrao });
    const pc = await t.cookieDe(lia.email, SENHA, 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36');
    const cel = await t.cookieDe(lia.email, SENHA, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1');
    const tab = await t.cookieDe(lia.email, SENHA, 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36');
    const l = (await t.comCookie(pc, 'GET', '/api/auth/sessoes')).json().sessoes as Array<{ id: string; aparelho: string; atual: boolean }>;
    expect(l).toHaveLength(3);
    expect(l.filter((s) => s.atual).map((s) => s.aparelho)).toEqual(['Chrome no Windows']);
    expect(l.map((s) => s.aparelho).sort()).toEqual(['Chrome no Android', 'Chrome no Windows', 'Safari no iPhone']);
    // Sai do celular pelo computador.
    const doCel = l.find((s) => s.aparelho === 'Safari no iPhone')!;
    expect((await t.comCookie(pc, 'DELETE', `/api/auth/sessoes/${doCel.id}`)).json()).toEqual({ ok: true, saiu: false });
    expect((await t.comCookie(cel, 'GET', '/api/auth/eu')).statusCode).toBe(401);
    // Sessão de outra pessoa não se encerra por aqui.
    const doBruno = (await t.como(t.gente.bruno, 'GET', '/api/auth/sessoes')).json().sessoes[0].id;
    expect((await t.comCookie(pc, 'DELETE', `/api/auth/sessoes/${doBruno}`)).statusCode).toBe(404);
    expect((await t.comCookie(pc, 'DELETE', '/api/auth/sessoes/nao-e-id')).statusCode).toBe(404);
    // Sai dos outros: só o computador continua.
    expect((await t.comCookie(pc, 'POST', '/api/auth/sessoes/sair-das-outras', {})).json()).toMatchObject({ ok: true, encerradas: 1 });
    expect((await t.comCookie(tab, 'GET', '/api/auth/eu')).statusCode).toBe(401);
    expect((await t.comCookie(pc, 'GET', '/api/auth/eu')).statusCode).toBe(200);
    // Trocar a senha encerra os outros aparelhos (este continua).
    const outro = await t.cookieDe(lia.email);
    expect((await t.comCookie(pc, 'POST', '/api/auth/senha', { atual: SENHA, nova: NOVA })).statusCode).toBe(200);
    expect((await t.comCookie(outro, 'GET', '/api/auth/eu')).statusCode).toBe(401);
    expect((await t.comCookie(pc, 'GET', '/api/auth/eu')).statusCode).toBe(200);
    // Sair deste aparelho pelo próprio botão: apaga o cookie.
    const atual = (await t.comCookie(pc, 'GET', '/api/auth/sessoes')).json().sessoes.find((s: { atual: boolean }) => s.atual).id;
    const saiu = await t.comCookie(pc, 'DELETE', `/api/auth/sessoes/${atual}`);
    expect(saiu.json()).toEqual({ ok: true, saiu: true });
    expect(String(saiu.headers['set-cookie'])).toMatch(/Max-Age=0/);
    expect((await t.comCookie(pc, 'GET', '/api/auth/eu')).statusCode).toBe(401);
  });

  it('link de convite: limite de tentativas por endereço', async () => {
    const t = await montar(amb);
    let ultimo = 0;
    for (let i = 0; i < 32; i++) ultimo = (await t.app.inject({ method: 'GET', url: '/api/auth/convite?t=inventado-xxxxxxxx', remoteAddress: '10.50.0.1' })).statusCode;
    expect(ultimo).toBe(429);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/convite?t=inventado-xxxxxxxx', remoteAddress: '10.50.0.2' })).statusCode).toBe(404);
  });
});
