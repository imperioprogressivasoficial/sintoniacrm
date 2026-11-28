import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { LeiturasMemoria, LeiturasPostgres, type Leituras } from '../src/app/leituras.js';
import { poolDeTeste, temPostgres } from './repos.js';

async function montar() {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = new RepositorioMemoria();
  const numeros = [{ canalId: 'teste-norte', unidade: 'norte' as const, canal: new CanalTeste() }];
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const agora = new Date();
  const { conversa: norte } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571988887777', nome: 'Juliana', agora });
  const { conversa: sumare } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'teste-sumare', telefone: '5571977776666', nome: 'Bia', agora });
  const app = criarServidor({ sintonia, repo, auth: { contas }, leituras: new LeiturasMemoria() });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  return { app, norte, sumare, admin: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com') };
}
const lista = async (app: Awaited<ReturnType<typeof montar>>['app'], cookie: string) =>
  (await app.inject({ method: 'GET', url: '/api/conversas', headers: { cookie } })).json() as Array<{ id: string; lidaAte: string | null }>;

describe('Lidas por pessoa', () => {
  it('marcar tudo como lido vale só para quem marcou e só para o que ela vê', async () => {
    const { app, admin, carla, norte, sumare } = await montar();
    expect((await lista(app, carla)).every((c) => c.lidaAte === null)).toBe(true);
    const r = await app.inject({ method: 'POST', url: '/api/conversas/lidas', headers: { cookie: carla }, payload: { todas: true } });
    expect(r.json()).toMatchObject({ ok: true, marcadas: 1 }); // a Carla só vê a Norte
    expect((await lista(app, carla)).find((c) => c.id === norte.id)!.lidaAte).not.toBeNull();
    expect((await lista(app, admin)).every((c) => c.lidaAte === null)).toBe(true);
    // não consegue marcar a conversa que não vê
    await app.inject({ method: 'POST', url: '/api/conversas/lidas', headers: { cookie: carla }, payload: { ids: [sumare.id] } });
    expect((await lista(app, admin)).find((c) => c.id === sumare.id)!.lidaAte).toBeNull();
  });

  it('abrir a conversa marca como lida; "não lida" desfaz', async () => {
    const { app, admin, norte } = await montar();
    await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}`, headers: { cookie: admin } });
    expect((await lista(app, admin)).find((c) => c.id === norte.id)!.lidaAte).not.toBeNull();
    await app.inject({ method: 'POST', url: '/api/conversas/nao-lidas', headers: { cookie: admin }, payload: { ids: [norte.id] } });
    expect((await lista(app, admin)).find((c) => c.id === norte.id)!.lidaAte).toBeNull();
  });
});

describe.runIf(temPostgres)('Lidas por pessoa no Postgres', () => {
  it('grava, nunca volta atrás e desmarca', async () => {
    const pool = await poolDeTeste();
    const u = (await pool.query<{ id: string }>(`insert into sintonia.usuarios (id, empresa_id, nome, email, papel, unidades, senha_hash)
      values (gen_random_uuid(), 'imperio', 'Teste', 'leitura@x.com', 'admin', '{}', 'x') returning id`)).rows[0]!.id;
    const c = (await pool.query<{ id: string }>('select id from sintonia.conversas limit 1')).rows[0]?.id;
    const l: Leituras = new LeiturasPostgres(pool);
    if (!c) return;
    await l.marcar(u, [c], new Date('2026-01-02'));
    await l.marcar(u, [c], new Date('2026-01-01'));
    expect((await l.doUsuario(u)).get(c)!.toISOString()).toBe(new Date('2026-01-02').toISOString());
    await l.desmarcar(u, [c]);
    expect((await l.doUsuario(u)).size).toBe(0);
  });
});
