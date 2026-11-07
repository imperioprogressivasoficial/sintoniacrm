import { describe, expect, it } from 'vitest';
import { ContasMemoria, ContasPostgres, type Contas } from '../src/auth/contas.js';
import { conferirSenha, gerarHash, senhaFraca } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

describe('Senha', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const h = await gerarHash('Imperio2026xyz');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await conferirSenha('Imperio2026xyz', h)).toBe(true);
    expect(await conferirSenha('imperio2026xyz', h)).toBe(false);
    expect(await conferirSenha('qualquer', 'lixo')).toBe(false);
  });
  it('recusa senha fraca', () => {
    expect(senhaFraca('curta1')).toMatch(/10 caracteres/);
    expect(senhaFraca('somenteletras')).toMatch(/letras e números/);
    expect(senhaFraca('Imperio2026xyz')).toBeNull();
  });
});

async function montar(contas: Contas = new ContasMemoria()) {
  const relogio = { t: new Date('2026-11-06T15:00:00Z') };
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await gerarHash('Imperio2026xyz') });
  const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => relogio.t, duracaoHoras: 12 } });
  const entrar = (email: string, senha: string) => app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha } });
  const cookieDe = (r: { headers: Record<string, unknown> }) => String(r.headers['set-cookie']).split(';')[0]!;
  return { app, contas, relogio, entrar, cookieDe };
}

describe('Login', () => {
  it('sem login a API recusa; com login libera; ao sair, fecha', async () => {
    const { app, entrar, cookieDe } = await montar();
    expect((await app.inject({ url: '/api/conversas' })).statusCode).toBe(401);
    expect((await entrar('carla@imperio.com', 'errada123456')).statusCode).toBe(401);

    const ok = await entrar('CARLA@imperio.com', 'Imperio2026xyz');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ nome: 'Carla Lima', papel: 'atendente' });
    const setCookie = String(ok.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    const cookie = cookieDe(ok);

    expect((await app.inject({ url: '/api/conversas', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/auth/eu', headers: { cookie } })).json()).toEqual({ id: expect.any(String), nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], permissoes: expect.objectContaining({ conversas: 'minhas', responder: true, equipe: false }), trocarSenha: false });

    await app.inject({ method: 'POST', url: '/api/auth/sair', headers: { cookie }, payload: {} });
    expect((await app.inject({ url: '/api/conversas', headers: { cookie } })).statusCode).toBe(401);
  });

  it('a sessão vence depois do prazo', async () => {
    const { app, entrar, cookieDe, relogio } = await montar();
    const cookie = cookieDe(await entrar('carla@imperio.com', 'Imperio2026xyz'));
    relogio.t = new Date(relogio.t.getTime() + 13 * 3600_000);
    expect((await app.inject({ url: '/api/conversas', headers: { cookie } })).statusCode).toBe(401);
  });

  it('bloqueia depois de 5 senhas erradas, mesmo que a 6ª esteja certa', async () => {
    const { entrar } = await montar();
    for (let i = 0; i < 5; i++) expect((await entrar('carla@imperio.com', `errada${i}xxxxxx`)).statusCode).toBe(401);
    const r = await entrar('carla@imperio.com', 'Imperio2026xyz');
    expect(r.statusCode).toBe(429);
  });

  it('cookie inventado não entra', async () => {
    const { app } = await montar();
    expect((await app.inject({ url: '/api/conversas', headers: { cookie: 'sintonia_sessao=inventado' } })).statusCode).toBe(401);
  });

  it('webhook do WhatsApp não depende de login', async () => {
    const { app } = await montar();
    // sem Evolution configurada responde 404, mas nunca 401
    expect((await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: {} })).statusCode).toBe(404);
  });
});

describe('Páginas', () => {
  it('página de vendas e login abertas; o app pede login', async () => {
    const { app, entrar, cookieDe } = await montar();
    const vendas = await app.inject({ url: '/' });
    expect(vendas.statusCode).toBe(200);
    expect(vendas.headers['content-type']).toContain('text/html');
    expect(vendas.body).toContain('Nenhuma cliente sem resposta');
    expect((await app.inject({ url: '/vendas/mac-crm-1440.webp' })).headers['content-type']).toBe('image/webp');
    expect((await app.inject({ url: '/estilo.css' })).headers['content-type']).toContain('text/css');
    expect((await app.inject({ url: '/entrar' })).statusCode).toBe(200);

    const semLogin = await app.inject({ url: '/app' });
    expect(semLogin.statusCode).toBe(302);
    expect(semLogin.headers.location).toBe('/entrar');

    const cookie = cookieDe(await entrar('carla@imperio.com', 'Imperio2026xyz'));
    expect((await app.inject({ url: '/app', headers: { cookie } })).statusCode).toBe(200);
    const jaLogado = await app.inject({ url: '/entrar', headers: { cookie } });
    expect(jaLogado.statusCode).toBe(302);
    expect(jaLogado.headers.location).toBe('/app');
  });

  it('formulário de demonstração grava o interessado e ignora robôs', async () => {
    const contas = new ContasMemoria();
    const { app } = await montar(contas);
    const ok = await app.inject({ method: 'POST', url: '/api/contato', payload: { nome: 'Ana', empresa: 'Salão X', whatsapp: '(71) 9 8888-7777', mensagem: '40 por dia' } });
    expect(ok.statusCode).toBe(200);
    expect(contas.interessados).toEqual([{ nome: 'Ana', empresa: 'Salão X', whatsapp: '71988887777', mensagem: '40 por dia' }]);
    expect((await app.inject({ method: 'POST', url: '/api/contato', payload: { nome: 'Ana', whatsapp: '123' } })).statusCode).toBe(400);
    await app.inject({ method: 'POST', url: '/api/contato', payload: { nome: 'Robô', whatsapp: '71988887777', site: 'http://spam' } });
    expect(contas.interessados).toHaveLength(1);
  });
});

describe.runIf(temPostgres)('Contas no Postgres', () => {
  it('cria, entra, vence e não repete e-mail', async () => {
    const pool = await poolDeTeste();
    const contas = new ContasPostgres(pool);
    const u = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bia', email: 'Bia@Imperio.com', papel: 'gerente', unidades: ['sumare'], senhaHash: 'x' });
    await expect(contas.criarUsuario({ empresaId: 'imperio', nome: 'Outra', email: 'bia@imperio.com', papel: 'atendente', unidades: [], senhaHash: 'x' })).rejects.toThrow('Já existe');
    expect((await contas.buscarPorEmail('BIA@imperio.com'))?.id).toBe(u.id);
    const agora = new Date();
    const token = await contas.criarSessao(u.id, new Date(agora.getTime() + 60_000));
    expect((await contas.usuarioDaSessao(token, agora))?.nome).toBe('Bia');
    expect(await contas.usuarioDaSessao(token, new Date(agora.getTime() + 120_000))).toBeUndefined();
    await contas.encerrarSessao(token);
    expect(await contas.usuarioDaSessao(token, agora)).toBeUndefined();
    await contas.registrarInteressado({ nome: 'Ana', whatsapp: '71988887777' });
    const { rows } = await pool.query('select nome, whatsapp from sintonia.interessados');
    expect(rows).toEqual([{ nome: 'Ana', whatsapp: '71988887777' }]);
  });
});
