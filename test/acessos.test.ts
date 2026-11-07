import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { escopoDe, podeVer } from '../src/auth/acesso.js';
import { ContasMemoria, ContasPostgres, PAPEIS, type Contas, type Papel, type Usuario } from '../src/auth/contas.js';
import { CHAVES, comNivel, dentroDoHorario, perfilPadrao, recusaAjustes, resolver } from '../src/auth/permissoes.js';
import { gerarHash } from '../src/auth/senha.js';
import { seriaUltimoAdmin } from '../src/auth/usuarios-rotas.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { Conversa } from '../src/domain.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

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

async function montar(amb: (typeof ambientes)[number]) {
  const { repo, contas } = await amb.criar();
  const relogio = { t: quinta(14) };
  const canal: CanalWhatsApp = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: `out-${Math.random()}` }) };
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal },
    ],
    agente: { executar: async () => ({ texto: 'Sugestão', acoes: [], recusou: false }) },
    agora: () => relogio.t,
  });
  const app = criarServidor({ sintonia, repo, agora: () => relogio.t, auth: { contas, agora: () => relogio.t } });
  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    direcao: await pessoa('Diana Reis', 'direcao', []),
    gerente: await pessoa('Gil Norte', 'gerente', ['norte']),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
    rita: await pessoa('Rita Recepção', 'recepcionista', ['sumare']),
  };
  const entrar = async (email: string, senha = SENHA) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha }, headers: { 'user-agent': 'Teste/1.0' } });
    const c = String(r.headers['set-cookie'] ?? '').split(';')[0]!;
    return { r, cookie: c };
  };
  const cookies = new Map<string, string>();
  const cookieDe = async (u: Usuario) => {
    if (!cookies.has(u.id)) cookies.set(u.id, (await entrar(u.email)).cookie);
    return cookies.get(u.id)!;
  };
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: await cookieDe(u) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  let tel = 0;
  const conversa = async (unidade: 'norte' | 'sumare', nome: string): Promise<Conversa> => {
    const telefone = `55719881300${++tel}`;
    await sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome, texto: 'Oi', deMim: false, idExterno: `in-${tel}`, em: relogio.t });
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const esperar = () => new Promise((r) => setTimeout(r, 3100)); // cache de permissões (3 s)
  return { app, contas, gente, como, entrar, cookieDe, conversa, relogio, sintonia, esperar };
}

describe('permissões: regras puras', () => {
  it('perfis padrão reproduzem o comportamento de antes', () => {
    expect(perfilPadrao('atendente').conversas).toBe('minhas');
    expect(perfilPadrao('gerente').conversas).toBe('unidade');
    expect(perfilPadrao('direcao').conversas).toBe('todas');
    for (const p of ['atendente', 'recepcionista'] as Papel[]) {
      const pp = perfilPadrao(p);
      expect(pp.responder && pp.crm_ver && pp.dashboard).toBe(true);
      expect(pp.transmissoes || pp.equipe || pp.relatorios || pp.conexoes).toBe(false);
    }
    expect(perfilPadrao('gerente').equipe).toBe(true);
    expect(perfilPadrao('gerente').conexoes).toBe(false);
    expect(CHAVES.every((c) => perfilPadrao('admin')[c])).toBe(true);
    // Sem ajuste, a visão de conversas é a mesma de antes.
    const conv = { empresaId: 'imperio', unidade: 'norte', responsavelId: 'outra' } as Conversa;
    for (const papel of PAPEIS) {
      const u = { id: 'x', nome: 'X', papel, unidades: ['norte'], empresaId: 'imperio', email: '', ativo: true } as Usuario;
      expect(podeVer(comNivel(u, perfilPadrao(papel)), conv)).toBe(podeVer(u, conv));
      expect(escopoDe(comNivel(u, perfilPadrao(papel)))).toEqual(escopoDe(u));
    }
  });

  it('ajuste da pessoa passa por cima do perfil, que passa por cima do padrão', () => {
    const r = resolver('atendente', { relatorios: true, conversas: 'unidade' }, { relatorios: false, transmissoes: true });
    expect(r.relatorios).toBe(false);
    expect(r.transmissoes).toBe(true);
    expect(r.conversas).toBe('unidade');
  });

  it('anti-escalada, último admin e horário', () => {
    expect(recusaAjustes(perfilPadrao('gerente'), { conexoes: true })).toMatch(/não pode liberar/);
    expect(recusaAjustes(perfilPadrao('gerente'), { conversas: 'todas' })).toMatch(/visão/);
    expect(recusaAjustes(perfilPadrao('gerente'), { transmissoes: true })).toBeNull();
    const a = { id: 'a', empresaId: 'e', papel: 'admin', ativo: true } as Usuario;
    const b = { id: 'b', empresaId: 'e', papel: 'admin', ativo: true } as Usuario;
    expect(seriaUltimoAdmin([a], a, { ativo: false })).toBe(true);
    expect(seriaUltimoAdmin([a], a, { papel: 'direcao' })).toBe(true);
    expect(seriaUltimoAdmin([a, b], a, { ativo: false })).toBe(false);
    const h = { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' };
    expect(dentroDoHorario(h, quinta(14))).toBe(true);
    expect(dentroDoHorario(h, quinta(19))).toBe(false);
    expect(dentroDoHorario(h, bahia(2026, 11, 8, 10))).toBe(false); // domingo
  });
});

describe.each(ambientes)('Usuários e acessos ($nome)', (amb) => {
  it('rotas negam 403 sem a permissão e liberam quando o perfil ou a pessoa ganha', async () => {
    const { gente, como, conversa, esperar } = await montar(amb);
    expect((await como(gente.carla, 'GET', '/api/equipe')).statusCode).toBe(403);
    expect((await como(gente.carla, 'GET', '/api/acessos/usuarios')).statusCode).toBe(403);
    const eu = (await como(gente.carla, 'GET', '/api/auth/eu')).json();
    expect(eu.permissoes.conversas).toBe('minhas');

    // Gerente tira "responder" da Carla: enviar dá 403.
    const c = await conversa('norte', 'Marina');
    expect((await como(gente.gerente, 'PATCH', `/api/acessos/usuarios/${gente.carla.id}`, { ajustes: { responder: false } })).statusCode).toBe(200);
    await esperar();
    expect((await como(gente.carla, 'POST', `/api/conversas/${c.id}/enviar`, { texto: 'oi' })).statusCode).toBe(403);

    // Direção dá "equipe" ao perfil Atendente: Carla passa a ver a equipe.
    expect((await como(gente.direcao, 'PUT', '/api/acessos/perfis/atendente', { permissoes: { equipe: true } })).statusCode).toBe(200);
    await esperar();
    expect((await como(gente.carla, 'GET', '/api/equipe')).statusCode).toBe(200);
    // Gerente não edita perfis.
    expect((await como(gente.gerente, 'PUT', '/api/acessos/perfis/atendente', { permissoes: { demo: true } })).statusCode).toBe(403);
    // Direção não mexe no perfil da Administração.
    expect((await como(gente.direcao, 'PUT', '/api/acessos/perfis/admin', { permissoes: { demo: false } })).statusCode).toBe(403);

    // Ver conversas "todas" para a Rita (só sumaré): passa a ver a do norte.
    expect((await como(gente.rita, 'GET', `/api/conversas/${c.id}`)).statusCode).toBe(404);
    expect((await como(gente.admin, 'PATCH', `/api/acessos/usuarios/${gente.rita.id}`, { ajustes: { conversas: 'todas' } })).statusCode).toBe(200);
    await esperar();
    expect((await como(gente.rita, 'GET', `/api/conversas/${c.id}`)).statusCode).toBe(200);

    const aud = (await como(gente.admin, 'GET', '/api/acessos/auditoria')).json();
    expect(aud.eventos.map((e: { acao: string }) => e.acao)).toEqual(expect.arrayContaining(['editou', 'perfil']));
  }, 20_000);

  it('gerente não escala: nem papel acima, nem permissão que ele não tem, nem outra unidade', async () => {
    const { gente, como } = await montar(amb);
    const novo = (papel: string, unidades: string[], extra = {}) =>
      como(gente.gerente, 'POST', '/api/acessos/usuarios', { nome: 'Nova Pessoa', email: `n${Math.random()}@imperio.com`, papel, unidades, senha: 'Provisoria123', ...extra });
    expect((await novo('gerente', ['norte'])).statusCode).toBe(403);
    expect((await novo('atendente', ['sumare'])).statusCode).toBe(403);
    expect((await novo('atendente', ['norte'], { ajustes: { conexoes: true } })).statusCode).toBe(403);
    expect((await novo('atendente', ['norte'])).statusCode).toBe(201);
    expect((await como(gente.gerente, 'PATCH', `/api/acessos/usuarios/${gente.carla.id}`, { papel: 'direcao' })).statusCode).toBe(403);
    expect((await como(gente.gerente, 'PATCH', `/api/acessos/usuarios/${gente.rita.id}`, { trocarSenha: true })).statusCode).toBe(404);
    expect((await como(gente.gerente, 'POST', `/api/acessos/usuarios/${gente.direcao.id}/desativar`)).statusCode).toBe(404);
  });

  it('último admin não sai; desativado não entra e perde as sessões', async () => {
    const { app, gente, como, entrar } = await montar(amb);
    expect((await como(gente.admin, 'POST', `/api/acessos/usuarios/${gente.admin.id}/desativar`)).statusCode).toBe(403);
    // Segundo admin: um pode desativar o outro enquanto sobrar alguém.
    const segundo = (await como(gente.admin, 'POST', '/api/acessos/usuarios', { nome: 'Ana Admin', email: 'ana@imperio.com', papel: 'admin', unidades: [], senha: 'Provisoria123' })).json().pessoa;
    expect((await como(gente.admin, 'POST', `/api/acessos/usuarios/${segundo.id}/desativar`)).statusCode).toBe(200);

    const carla = await entrar(gente.carla.email);
    expect((await app.inject({ method: 'GET', url: '/api/auth/eu', headers: { cookie: carla.cookie } })).statusCode).toBe(200);
    expect((await como(gente.gerente, 'POST', `/api/acessos/usuarios/${gente.carla.id}/desativar`)).statusCode).toBe(200);
    expect((await entrar(gente.carla.email)).r.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/eu', headers: { cookie: carla.cookie } })).statusCode).toBe(401);
    expect((await como(gente.gerente, 'POST', `/api/acessos/usuarios/${gente.carla.id}/reativar`)).statusCode).toBe(200);
    expect((await entrar(gente.carla.email)).r.statusCode).toBe(200);
  });

  it('sessões ativas: lista e desconecta', async () => {
    const { app, gente, como, entrar } = await montar(amb);
    const s1 = await entrar(gente.carla.email);
    await entrar(gente.carla.email);
    const l = (await como(gente.gerente, 'GET', `/api/acessos/usuarios/${gente.carla.id}/sessoes`)).json();
    expect(l.sessoes.length).toBe(2);
    expect(l.sessoes[0].aparelho).toBe('Teste/1.0');
    for (const s of l.sessoes) expect((await como(gente.gerente, 'DELETE', `/api/acessos/usuarios/${gente.carla.id}/sessoes/${s.id}`)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/eu', headers: { cookie: s1.cookie } })).statusCode).toBe(401);
    const lista = (await como(gente.gerente, 'GET', '/api/acessos/usuarios')).json();
    const c = lista.pessoas.find((p: { id: string }) => p.id === gente.carla.id);
    expect(c.sessoesAtivas).toBe(0);
    expect(c.ultimoAcesso).toBeTruthy();
  });

  it('convite com validade, troca de senha obrigatória e horário permitido', async () => {
    const { app, gente, como, entrar, relogio } = await montar(amb);
    const r = await como(gente.gerente, 'POST', '/api/acessos/usuarios', { nome: 'Lia Nova', email: 'lia@imperio.com', papel: 'atendente', unidades: ['norte'], validadeHoras: 2 });
    expect(r.statusCode).toBe(201);
    const t = new URL(r.json().link).searchParams.get('t')!;
    expect((await app.inject({ method: 'GET', url: `/api/auth/convite?t=${t}` })).json().email).toBe('lia@imperio.com');
    expect((await app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t, senha: 'curta' } })).statusCode).toBe(400);
    relogio.t = new Date(relogio.t.getTime() + 3 * 3600_000); // venceu
    expect((await app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t, senha: 'MinhaSenha2026' } })).statusCode).toBe(404);
    relogio.t = quinta(14);
    const lia = (await como(gente.gerente, 'GET', '/api/acessos/usuarios')).json().pessoas.find((p: { email: string }) => p.email === 'lia@imperio.com');
    const red = (await como(gente.gerente, 'POST', `/api/acessos/usuarios/${lia.id}/redefinir`, {})).json();
    const t2 = new URL(red.link).searchParams.get('t')!;
    expect((await app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t: t2, senha: 'MinhaSenha2026' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/convite', payload: { t: t2, senha: 'OutraSenha2026' } })).statusCode).toBe(404); // já usado
    expect((await entrar('lia@imperio.com', 'MinhaSenha2026')).r.statusCode).toBe(200);

    // Senha provisória: trocar no primeiro login; até lá só /eu e /senha.
    await como(gente.admin, 'POST', '/api/acessos/usuarios', { nome: 'Ivo Prov', email: 'ivo@imperio.com', papel: 'atendente', unidades: ['norte'], senha: 'Provisoria123' });
    const ivo = await entrar('ivo@imperio.com', 'Provisoria123');
    expect(ivo.r.json().trocarSenha).toBe(true);
    const h = { cookie: ivo.cookie };
    expect((await app.inject({ method: 'GET', url: '/api/conversas', headers: h })).json().trocarSenha).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/auth/senha', headers: h, payload: { atual: 'Provisoria123', nova: 'NovaSenha2026' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/conversas', headers: h })).statusCode).toBe(200);

    // Horário permitido: fora dele, nem entra.
    const horario = { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' };
    expect((await como(gente.gerente, 'PATCH', `/api/acessos/usuarios/${gente.carla.id}`, { horario })).statusCode).toBe(200);
    relogio.t = quinta(20);
    expect((await entrar(gente.carla.email)).r.statusCode).toBe(403);
    relogio.t = quinta(10);
    expect((await entrar(gente.carla.email)).r.statusCode).toBe(200);
  });
});
