import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { disponiveis, PresencasMemoria, PresencasPostgres } from '../src/presenca/presenca.js';
import { poolDeTeste, temPostgres } from './repos.js';

async function montar() {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  const bruno = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  const carla = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const outra = await contas.criarUsuario({ empresaId: 'outra', nome: 'Zé', email: 'ze@outra.com', papel: 'admin', unidades: [], senhaHash });
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const presencas = new PresencasMemoria();
  const app = criarServidor({ sintonia, repo, auth: { contas }, presencas });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  return { app, presencas, ids: { bruno: bruno.id, carla: carla.id, outra: outra.id }, bruno: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com') };
}

describe('Presença da equipe (/api/presenca)', () => {
  it('começa online, a pessoa muda só a própria e a gestão vê a equipe', async () => {
    const { app, ids, bruno, carla } = await montar();
    const ler = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/presenca', headers: { cookie } })).json();
    // a atendente vê só a si mesma (como no serviço antigo)
    expect(await ler(carla)).toEqual({ eu: ids.carla, status: { [ids.carla]: 'online' } });
    const r = await app.inject({ method: 'PUT', url: '/api/presenca', headers: { cookie: carla }, payload: { status: 'offline' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, status: 'offline' });
    expect((await ler(carla)).status[ids.carla]).toBe('offline');
    // a gestão vê a própria e a da equipe, nunca a de outra empresa
    const g = await ler(bruno);
    expect(g.eu).toBe(ids.bruno);
    expect(g.status).toEqual({ [ids.bruno]: 'online', [ids.carla]: 'offline' });
    expect(g.status[ids.outra]).toBeUndefined();
  });

  it('recusa status inválido e quem não entrou', async () => {
    const { app, carla } = await montar();
    expect((await app.inject({ method: 'PUT', url: '/api/presenca', headers: { cookie: carla }, payload: { status: 'ausente' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/presenca', headers: { cookie: carla }, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/presenca' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/presenca', payload: { status: 'online' } })).statusCode).toBe(401);
  });

  it('disponiveis() separa quem está fora do ar (para transferir e distribuir)', async () => {
    const p = new PresencasMemoria();
    await p.gravar('a', 'offline');
    await p.gravar('b', 'online');
    expect(await disponiveis(p, ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });
});

describe.runIf(temPostgres)('Presença no Postgres', () => {
  it('grava, troca e some quando a pessoa é apagada', async () => {
    const pool = await poolDeTeste();
    const u = (await pool.query<{ id: string }>(`insert into sintonia.usuarios (id, empresa_id, nome, email, papel, unidades, senha_hash)
      values (gen_random_uuid(), 'imperio', 'Teste', 'presenca@x.com', 'atendente', '{}', 'x') returning id`)).rows[0]!.id;
    const p = new PresencasPostgres(pool);
    expect(await p.ler([u, 'nao-e-uuid'])).toEqual({});
    await p.gravar(u, 'offline');
    expect(await p.ler([u])).toEqual({ [u]: 'offline' });
    await p.gravar(u, 'online');
    expect(await p.ler([u])).toEqual({ [u]: 'online' });
    expect(await disponiveis(p, [u])).toEqual([u]);
    await pool.query('delete from sintonia.usuarios where id = $1', [u]);
    expect(await p.ler([u])).toEqual({});
  });
});
