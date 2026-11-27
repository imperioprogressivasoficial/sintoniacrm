import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { acessosPara } from '../src/auth/acessos.js';
import { ContasMemoria, ContasPostgres, type Contas, type Papel } from '../src/auth/contas.js';
import { ItemEquipe, MSG_NEUTRA, semearEquipe, situacaoDaChave, textoPrimeiroAcesso } from '../src/auth/primeiro-acesso.js';
import { gerarHash } from '../src/auth/senha.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/**
 * primeiro-acesso: semente da equipe (SINTONIA_EQUIPE_INICIAL), o link único /primeiro-acesso (e-mail → senha → entra),
 * a chave por empresa (desligada por padrão, fecha em 14 dias), a resposta neutra, o limite de tentativas e a foto
 * de perfil pedida logo ao entrar.
 */

const SENHA = 'Imperio2026xyz';
const NOVA = 'MinhaSenha2026ok';
const hashPadrao = gerarHash(SENHA);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64');

const ambientes: Array<{ nome: string; criar(): Promise<{ repo: Repositorio; contas: Contas }> }> = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria() }) },
  ...(temPostgres
    ? [{
        nome: 'postgres',
        criar: async () => {
          const pool = await poolDeTeste();
          await pool.query('delete from sintonia.acesso_perfis; delete from sintonia.acesso_auditoria; delete from sintonia.primeiro_acesso');
          return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool) };
        },
      }]
    : []),
];

const EQUIPE = JSON.stringify([
  { nome: 'Ana Lima', email: 'Ana.Lima@exemplo.com', papel: 'atendente', unidades: ['sumare'] },
  { nome: 'Caio Souza', email: 'caio@exemplo.com', papel: 'Administração', unidades: [] },
  { nome: 'Duda Reis', email: 'duda@exemplo.com', papel: 'gerente', unidades: ['norte'] },
  { nome: 'X', email: 'curto@exemplo.com', papel: 'atendente' }, // nome curto demais
  { nome: 'Sem Email', email: 'nao-e-email', papel: 'atendente' },
  { nome: 'Papel Errado', email: 'papel@exemplo.com', papel: 'chefe' },
  { nome: 'Bruno Outro Nome', email: 'bruno@exemplo.com', papel: 'atendente' }, // já existe: não muda nada
]);

async function montar(amb: (typeof ambientes)[number]) {
  const { repo, contas } = await amb.criar();
  const relogio = { t: bahia(2026, 11, 27, 10) };
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora: () => relogio.t });
  const app = criarServidor({ sintonia, repo, agora: () => relogio.t, auth: { contas, agora: () => relogio.t, empresaPadrao: 'imperio' } });
  const h = await hashPadrao;
  const pessoa = (nome: string, email: string, papel: Papel, unidades: string[] = [], empresaId = 'imperio') =>
    contas.criarUsuario({ empresaId, nome, email, papel, unidades, senhaHash: h });
  const bruno = await pessoa('Bruno Batista', 'bruno@exemplo.com', 'admin');
  const gil = await pessoa('Gil Norte', 'gil@exemplo.com', 'gerente', ['norte']);
  const logs: string[] = [];
  const semente = await semearEquipe({ contas, acessos: acessosPara(contas), empresaId: 'imperio', bruto: EQUIPE, agora: () => relogio.t, log: (m) => logs.push(m) });
  let ip = 0;
  const novoIp = () => `10.9.0.${++ip}`;
  const entrar = async (email: string, senha = SENHA) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha }, remoteAddress: novoIp() });
    expect(r.statusCode, r.body).toBe(200);
    return String(r.headers['set-cookie']).split(';')[0]!;
  };
  const cookies = new Map<string, string>();
  const como = async (email: string, method: 'GET' | 'PUT' | 'POST', url: string, payload?: object) => {
    if (!cookies.has(email)) cookies.set(email, await entrar(email));
    return app.inject({ method, url, headers: { cookie: cookies.get(email)! }, ...(payload ? { payload } : {}) });
  };
  const ligar = async (ligado = true) => {
    const r = await como('bruno@exemplo.com', 'PUT', '/api/acessos/primeiro-acesso', { ligado });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };
  const email = (e: string, remoteAddress = novoIp()) => app.inject({ method: 'POST', url: '/api/auth/primeiro-acesso/email', payload: { email: e }, remoteAddress });
  const criar = (e: string, senha = NOVA, remoteAddress = novoIp(), headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url: '/api/auth/primeiro-acesso', payload: { email: e, senha }, remoteAddress, headers });
  return { app, contas, relogio, bruno, gil, semente, logs, entrar, como, ligar, email, criar, sairDeTodos: () => cookies.clear() };
}

describe('primeiro-acesso: peças puras', () => {
  it('papel por nome ("Administração", "Direção") ou por id; unidades em minúsculas e sem repetir', () => {
    expect(ItemEquipe.parse({ nome: 'Caio', email: 'C@X.COM', papel: 'Administração' })).toEqual({ nome: 'Caio', email: 'c@x.com', papel: 'admin', unidades: [] });
    expect(ItemEquipe.parse({ nome: 'Lu', email: 'l@x.com', papel: 'Direção' }).papel).toBe('direcao');
    expect(ItemEquipe.parse({ nome: 'Ana', email: 'a@x.com', papel: 'atendente', unidades: ['Sumare', 'sumare'] }).unidades).toEqual(['sumare']);
    expect(ItemEquipe.safeParse({ nome: 'Ana', email: 'a@x.com', papel: 'chefe' }).success).toBe(false);
  });
  it('situação da chave: desligada, ligada até a data, encerrada depois', () => {
    const agora = new Date('2026-11-27T12:00:00Z');
    expect(situacaoDaChave({ ligadoAte: null, ligadoEm: null, ligadoPor: null }, agora)).toBe('desligada');
    expect(situacaoDaChave({ ligadoAte: new Date('2026-12-01T00:00:00Z'), ligadoEm: agora, ligadoPor: 'B' }, agora)).toBe('ligada');
    expect(situacaoDaChave({ ligadoAte: new Date('2026-11-27T11:59:59Z'), ligadoEm: agora, ligadoPor: 'B' }, agora)).toBe('encerrada');
  });
  it('texto para o grupo da equipe traz o link e a validade', () => {
    const t = textoPrimeiroAcesso('https://app.exemplo.com/primeiro-acesso', new Date('2026-12-11T13:00:00Z'));
    expect(t).toContain('https://app.exemplo.com/primeiro-acesso');
    expect(t).toContain('11/12');
  });
  it('semente: JSON inválido ou que não é lista é ignorado com aviso, sem quebrar', async () => {
    const contas = new ContasMemoria();
    const logs: string[] = [];
    expect((await semearEquipe({ contas, empresaId: 'imperio', bruto: '{nao json', log: (m) => logs.push(m) })).criados).toEqual([]);
    expect((await semearEquipe({ contas, empresaId: 'imperio', bruto: '{"nome":"x"}', log: (m) => logs.push(m) })).criados).toEqual([]);
    expect((await semearEquipe({ contas, empresaId: 'imperio', bruto: undefined })).criados).toEqual([]);
    expect(logs.join('\n')).toMatch(/não é um JSON válido/);
    expect(logs.join('\n')).toMatch(/precisa ser uma lista/);
    expect(contas.usuarios).toHaveLength(0);
  });
});

describe.each(ambientes)('primeiro-acesso de ponta a ponta ($nome)', (amb) => {
  it('semente: cria quem falta (sem senha), ignora inválidos com log e nunca mexe em quem já existe', async () => {
    const t = await montar(amb);
    expect(t.semente.criados.sort()).toEqual(['ana.lima@exemplo.com', 'caio@exemplo.com', 'duda@exemplo.com']);
    expect(t.semente.existentes).toEqual(['bruno@exemplo.com']);
    expect(t.semente.invalidos).toBe(3);
    expect(t.logs.filter((l) => /item \d+ ignorado/.test(l))).toHaveLength(3);
    expect(t.logs.join('\n')).not.toContain('nao-e-email@'); // nada de e-mail inteiro no log
    const ana = await t.contas.buscarPorEmail('ana.lima@exemplo.com');
    expect(ana).toMatchObject({ nome: 'Ana Lima', papel: 'atendente', unidades: ['sumare'], ativo: true, semSenha: true });
    expect((await t.contas.buscarPorEmail('caio@exemplo.com'))?.papel).toBe('admin');
    // Quem já existia continua igual (nome, papel e senha).
    const bruno = await t.contas.buscarPorEmail('bruno@exemplo.com');
    expect(bruno).toMatchObject({ nome: 'Bruno Batista', papel: 'admin', semSenha: false });
    await t.entrar('bruno@exemplo.com');
    // Rodar de novo (cada vez que o servidor sobe) não cria nada em dobro.
    const de_novo = await semearEquipe({ contas: t.contas, empresaId: 'imperio', bruto: EQUIPE });
    expect(de_novo.criados).toEqual([]);
    expect((await t.contas.listarUsuarios('imperio')).length).toBe(5);
    // Sem senha: ninguém entra pela tela Entrar com senha nenhuma.
    const r = await t.app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'ana.lima@exemplo.com', senha: SENHA }, remoteAddress: '10.8.8.8' });
    expect(r.statusCode).toBe(401);
  });

  it('chave desligada por padrão: a página diz que o acesso ainda não foi liberado (para qualquer e-mail)', async () => {
    const t = await montar(amb);
    const st = await t.app.inject({ method: 'GET', url: '/api/auth/primeiro-acesso' });
    expect(st.statusCode).toBe(200);
    expect(st.json()).toMatchObject({ liberado: false, motivo: 'desligada' });
    for (const e of ['ana.lima@exemplo.com', 'ninguem@exemplo.com']) {
      const r = await t.email(e);
      expect(r.json()).toMatchObject({ ok: false, fechado: true, motivo: 'desligada' });
      const c = await t.criar(e);
      expect(c.json()).toMatchObject({ ok: false, fechado: true });
    }
    expect((await t.contas.buscarPorEmail('ana.lima@exemplo.com'))?.semSenha).toBe(true);
  });

  it('sucesso: liga a chave, e-mail → senha → entra logada; registra na auditoria; depois o link não vale mais para ela', async () => {
    const t = await montar(amb);
    const ligada = await t.ligar();
    expect(ligada).toMatchObject({ ligado: true, situacao: 'ligada', podeMudar: true, dias: 14 });
    expect(new Date(ligada.ate).getTime() - t.relogio.t.getTime()).toBe(14 * 86_400_000);
    expect(ligada.link).toMatch(/\/primeiro-acesso$/);
    expect(ligada.whatsapp).toMatch(/^https:\/\/wa\.me\/\?text=/);
    // Quem ainda não entrou (a semente toda; Bruno já entrou ao ligar).
    expect(ligada.faltam.map((p: { email: string }) => p.email).sort()).toEqual(['ana.lima@exemplo.com', 'caio@exemplo.com', 'duda@exemplo.com', 'gil@exemplo.com']);
    expect(ligada.faltam.find((p: { email: string }) => p.email === 'gil@exemplo.com').podeUsar).toBe(false);
    expect(ligada.faltam.find((p: { email: string }) => p.email === 'caio@exemplo.com').podeUsar).toBe(true);

    expect((await t.app.inject({ method: 'GET', url: '/api/auth/primeiro-acesso' })).json()).toMatchObject({ liberado: true, ate: ligada.ate });
    const passo1 = await t.email('  ANA.LIMA@exemplo.com ');
    expect(passo1.statusCode).toBe(200);
    expect(passo1.json()).toEqual({ ok: true, nome: 'Ana' });
    // Senha fraca: a mesma regra do resto do sistema.
    const fraca = await t.criar('ana.lima@exemplo.com', 'curta1');
    expect(fraca.statusCode).toBe(400);
    expect(fraca.json().erro).toMatch(/10 caracteres/);
    const passo2 = await t.criar('ana.lima@exemplo.com');
    expect(passo2.statusCode, passo2.body).toBe(200);
    expect(passo2.json()).toMatchObject({ ok: true });
    const cookie = String(passo2.headers['set-cookie']).split(';')[0]!;
    expect(cookie).toMatch(/^sintonia_sessao=/);
    const eu = await t.app.inject({ method: 'GET', url: '/api/auth/eu', headers: { cookie } });
    expect(eu.statusCode).toBe(200);
    expect(eu.json()).toMatchObject({ email: 'ana.lima@exemplo.com', papel: 'atendente' });
    // A senha criada vale na tela Entrar.
    await t.entrar('ana.lima@exemplo.com', NOVA);
    expect((await t.contas.buscarPorEmail('ana.lima@exemplo.com'))?.semSenha).toBe(false);
    // Auditoria.
    const aud = await t.como('bruno@exemplo.com', 'GET', '/api/acessos/auditoria');
    expect(aud.json().eventos.map((e: { acao: string }) => e.acao)).toEqual(expect.arrayContaining(['criou a senha pelo primeiro acesso', 'ligou o primeiro acesso pelo link']));
    // De novo: já tem senha → resposta neutra.
    expect((await t.email('ana.lima@exemplo.com')).json()).toEqual({ ok: false, mensagem: MSG_NEUTRA });
    expect((await t.criar('ana.lima@exemplo.com', 'OutraSenha2026x')).json()).toEqual({ ok: false, mensagem: MSG_NEUTRA });
    await t.entrar('ana.lima@exemplo.com', NOVA); // a senha dela não mudou
    // Ana sai da lista de quem ainda não entrou.
    const depois = await t.como('bruno@exemplo.com', 'GET', '/api/acessos/primeiro-acesso');
    expect(depois.json().faltam.map((p: { email: string }) => p.email)).not.toContain('ana.lima@exemplo.com');
  });

  it('e-mail desconhecido, conta que já tem senha e conta desativada: a mesma resposta neutra', async () => {
    const t = await montar(amb);
    await t.ligar();
    const duda = (await t.contas.buscarPorEmail('duda@exemplo.com'))!;
    await t.contas.atualizarUsuario(duda.id, { ativo: false });
    const respostas = [];
    for (const e of ['ninguem@exemplo.com', 'gil@exemplo.com', 'duda@exemplo.com']) {
      const r1 = await t.email(e);
      const r2 = await t.criar(e);
      expect(r1.statusCode).toBe(200);
      expect(r2.statusCode).toBe(200);
      respostas.push(r1.body, r2.body);
    }
    expect(new Set(respostas)).toEqual(new Set([JSON.stringify({ ok: false, mensagem: MSG_NEUTRA })]));
    // Gil continua com a senha dele; Duda continua sem senha e desativada.
    await t.entrar('gil@exemplo.com');
    expect(await t.contas.buscarPorEmail('duda@exemplo.com')).toMatchObject({ ativo: false, semSenha: true });
  });

  it('a chave fecha sozinha depois de 14 dias; desligar fecha na hora; só admin e direção mudam', async () => {
    const t = await montar(amb);
    // Gerente vê, mas não liga.
    const g = await t.como('gil@exemplo.com', 'PUT', '/api/acessos/primeiro-acesso', { ligado: true });
    expect(g.statusCode).toBe(403);
    expect((await t.como('gil@exemplo.com', 'GET', '/api/acessos/primeiro-acesso')).json()).toMatchObject({ ligado: false, podeMudar: false });
    // Atendente nem vê (não cuida da equipe).
    await t.contas.criarUsuario({ empresaId: 'imperio', nome: 'Lia Atende', email: 'lia@exemplo.com', papel: 'atendente', unidades: ['norte'], senhaHash: await hashPadrao });
    expect((await t.como('lia@exemplo.com', 'GET', '/api/acessos/primeiro-acesso')).statusCode).toBe(403);
    // Sem login: 401.
    expect((await t.app.inject({ method: 'GET', url: '/api/acessos/primeiro-acesso' })).statusCode).toBe(401);

    await t.ligar();
    t.relogio.t = new Date(t.relogio.t.getTime() + 14 * 86_400_000 + 60_000);
    t.sairDeTodos(); // a sessão de 12 h venceu
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/primeiro-acesso' })).json()).toMatchObject({ liberado: false, motivo: 'encerrada' });
    expect((await t.email('caio@exemplo.com')).json()).toMatchObject({ ok: false, fechado: true, motivo: 'encerrada' });
    expect((await t.criar('caio@exemplo.com')).json()).toMatchObject({ ok: false, fechado: true, motivo: 'encerrada' });
    expect((await t.como('bruno@exemplo.com', 'GET', '/api/acessos/primeiro-acesso')).json()).toMatchObject({ ligado: false, situacao: 'encerrada', ate: null });
    // Liga de novo e desliga: fecha na hora.
    await t.ligar(true);
    expect((await t.email('caio@exemplo.com')).json()).toMatchObject({ ok: true, nome: 'Caio' });
    expect(await t.ligar(false)).toMatchObject({ ligado: false, situacao: 'desligada' });
    expect((await t.criar('caio@exemplo.com')).json()).toMatchObject({ ok: false, fechado: true, motivo: 'desligada' });
  });

  it('limite de tentativas por endereço e por e-mail', async () => {
    const t = await montar(amb);
    await t.ligar();
    // Por e-mail: de endereços diferentes, a partir da 7ª tentativa no mesmo e-mail em 15 min.
    const codigos: number[] = [];
    for (let i = 0; i < 8; i++) codigos.push((await t.email('caio@exemplo.com')).statusCode);
    expect(codigos.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(codigos[6]).toBe(429);
    const bloqueado = await t.criar('caio@exemplo.com');
    expect(bloqueado.statusCode).toBe(429);
    expect(bloqueado.json().esperaSeg).toBeGreaterThan(0);
    expect((await t.contas.buscarPorEmail('caio@exemplo.com'))?.semSenha).toBe(true);
    // Por endereço: o mesmo endereço testando vários e-mails para na 21ª.
    const ip = '10.66.0.1';
    const porIp: number[] = [];
    for (let i = 0; i < 21; i++) porIp.push((await t.email(`pessoa${i}@exemplo.com`, ip)).statusCode);
    expect(porIp.filter((c) => c === 200)).toHaveLength(20);
    expect(porIp[20]).toBe(429);
    // Depois da janela, volta a funcionar.
    t.relogio.t = new Date(t.relogio.t.getTime() + 16 * 60_000);
    expect((await t.email('caio@exemplo.com', ip)).json()).toMatchObject({ ok: true });
  });

  it('pedido de outro site (Origin diferente) é recusado', async () => {
    const t = await montar(amb);
    await t.ligar();
    const r = await t.criar('caio@exemplo.com', NOVA, '10.5.5.5', { origin: 'https://site-ruim.com', host: 'localhost:80' });
    expect(r.statusCode).toBe(403);
    expect((await t.contas.buscarPorEmail('caio@exemplo.com'))?.semSenha).toBe(true);
  });

  it('quem é convidado pela tela (sem senha) também pode usar o link único', async () => {
    const t = await montar(amb);
    await t.ligar();
    const c = await t.como('bruno@exemplo.com', 'POST', '/api/acessos/usuarios', { nome: 'Rita Nova', email: 'rita@exemplo.com', papel: 'recepcionista', unidades: ['sumare'] });
    expect(c.statusCode, c.body).toBe(201);
    expect((await t.email('rita@exemplo.com')).json()).toEqual({ ok: true, nome: 'Rita' });
    expect((await t.criar('rita@exemplo.com')).json()).toMatchObject({ ok: true });
  });

  it('foto de perfil: quem não tem é chamado logo ao entrar; atendente não pula, a gestão pode; com foto, para de pedir', async () => {
    const t = await montar(amb);
    await t.ligar();
    const r = await t.criar('ana.lima@exemplo.com');
    const cookie = String(r.headers['set-cookie']).split(';')[0]!;
    const eu = async (c: string) => (await t.app.inject({ method: 'GET', url: '/api/auth/eu', headers: { cookie: c } })).json();
    const ana = await eu(cookie);
    expect(ana).toMatchObject({ pedirFoto: true, podePularFoto: false });
    // Gestão pode deixar para depois.
    expect(await eu(await t.entrar('bruno@exemplo.com'))).toMatchObject({ pedirFoto: true, podePularFoto: true });
    expect(await eu(await t.entrar('gil@exemplo.com'))).toMatchObject({ pedirFoto: true, podePularFoto: true });
    // Põe a foto (o mesmo envio da Conta › Perfil) e não pede mais.
    const put = await t.app.inject({ method: 'PUT', url: `/api/equipe/${ana.id}/foto`, headers: { cookie }, payload: { base64: jpg, mimetype: 'image/jpeg' } });
    expect(put.statusCode, put.body).toBe(200);
    expect(await eu(cookie)).toMatchObject({ pedirFoto: false });
    // Tirar a foto volta a pedir.
    await t.app.inject({ method: 'DELETE', url: `/api/equipe/${ana.id}/foto`, headers: { cookie } });
    expect(await eu(cookie)).toMatchObject({ pedirFoto: true });
  });

  it('páginas: /primeiro-acesso é pública; logada vai para o app; a tela da foto está no app', async () => {
    const t = await montar(amb);
    const p = await t.app.inject({ method: 'GET', url: '/primeiro-acesso' });
    expect(p.statusCode).toBe(200);
    expect(p.body).toContain('Primeiro acesso');
    expect(p.body).toContain('/api/auth/primeiro-acesso/email');
    const logada = await t.app.inject({ method: 'GET', url: '/primeiro-acesso', headers: { cookie: await t.entrar('bruno@exemplo.com') } });
    expect(logada.statusCode).toBe(302);
    expect(logada.headers.location).toBe('/app');
    expect((await t.app.inject({ method: 'GET', url: '/telas/foto-perfil.js' })).statusCode).toBe(200);
    const app = await t.app.inject({ method: 'GET', url: '/app', headers: { cookie: await t.entrar('bruno@exemplo.com') } });
    expect(app.body).toMatch(/\/telas\/foto-perfil\.js\?v=/);
  });
});

describe('senha provisória da equipe inicial', () => {
  it('aplica uma vez em quem ainda não criou a senha e obriga a trocar ao entrar', async () => {
    const contas = new ContasMemoria();
    const acessos = acessosPara(contas);
    const base = JSON.stringify([{ nome: 'Ana Lima', email: 'ana@exemplo.com', papel: 'atendente', unidades: ['sumare'] }]);
    await semearEquipe({ contas, acessos, empresaId: 'imperio', bruto: base });
    const hash = await gerarHash('Provisoria2026xyz');
    const com = JSON.stringify([{ nome: 'Ana Lima', email: 'ana@exemplo.com', papel: 'atendente', unidades: ['sumare'], senhaProvisoriaHash: hash }]);
    await semearEquipe({ contas, acessos, empresaId: 'imperio', bruto: com });
    const u = await contas.buscarPorEmail('ana@exemplo.com');
    expect(u?.senhaHash).toBe(hash);
    expect(u?.semSenha).toBe(false);
    expect((await acessos!.extras(u!.id)).trocarSenha).toBe(true);
    // Já trocou a senha: a semente não mexe de novo.
    await contas.definirSenha(u!.id, await gerarHash('MinhaSenha2026abc'));
    await semearEquipe({ contas, acessos, empresaId: 'imperio', bruto: com });
    expect((await contas.buscarPorEmail('ana@exemplo.com'))?.senhaHash).not.toBe(hash);
  });
});
