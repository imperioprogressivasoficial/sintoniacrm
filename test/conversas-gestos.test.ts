import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { LeiturasMemoria, LeiturasPostgres, type Leituras } from '../src/app/leituras.js';
import { poolDeTeste, temPostgres } from './repos.js';

// Gestos da lista de Conversas (public/telas/conversas-gestos.js): "marcar como não lida" à mão e a prévia (segurar o dedo).
async function montar() {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = new RepositorioMemoria();
  const numeros = [{ canalId: 'teste-norte', unidade: 'norte' as const, canal: new CanalTeste() }];
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const agora = new Date('2026-11-20T12:00:00Z');
  const { conversa: norte } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: '5571988887777', nome: 'Juliana', agora });
  const { conversa: sumare } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'teste-sumare', telefone: '5571977776666', nome: 'Bia', agora });
  for (let i = 0; i < 45; i++) {
    await repo.adicionarMensagem({ conversaId: norte.id, autor: i % 2 ? 'equipe' : 'cliente', autorNome: i % 2 ? 'Carla' : undefined, texto: `mensagem ${i}`, em: new Date(agora.getTime() + i * 60_000) });
  }
  const app = criarServidor({ sintonia, repo, auth: { contas }, leituras: new LeiturasMemoria() });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  return { app, norte, sumare, admin: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com') };
}
type Linha = { id: string; lidaAte: string | null; marcadaNaoLida: boolean };
const lista = async (app: Awaited<ReturnType<typeof montar>>['app'], cookie: string) =>
  (await app.inject({ method: 'GET', url: '/api/conversas', headers: { cookie } })).json() as Linha[];

describe('Marcar como não lida à mão (arrastar a linha)', () => {
  it('fica marcada só para quem marcou, até abrir a conversa', async () => {
    const { app, admin, carla, norte } = await montar();
    expect((await lista(app, admin)).find((c) => c.id === norte.id)!.marcadaNaoLida).toBe(false);
    const r = await app.inject({ method: 'POST', url: '/api/conversas/nao-lidas', headers: { cookie: admin }, payload: { ids: [norte.id] } });
    expect(r.json()).toMatchObject({ ok: true, marcadas: 1 });
    expect((await lista(app, admin)).find((c) => c.id === norte.id)!.marcadaNaoLida).toBe(true);
    expect((await lista(app, carla)).find((c) => c.id === norte.id)!.marcadaNaoLida).toBe(false);
    // abrir a conversa desmarca
    await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}`, headers: { cookie: admin } });
    expect((await lista(app, admin)).find((c) => c.id === norte.id)!.marcadaNaoLida).toBe(false);
  });

  it('"marcar como lida" desmarca; não dá para marcar conversa que não vê', async () => {
    const { app, admin, carla, norte, sumare } = await montar();
    await app.inject({ method: 'POST', url: '/api/conversas/nao-lidas', headers: { cookie: carla }, payload: { ids: [norte.id, sumare.id] } });
    expect((await lista(app, carla)).find((c) => c.id === norte.id)!.marcadaNaoLida).toBe(true);
    await app.inject({ method: 'POST', url: '/api/conversas/lidas', headers: { cookie: carla }, payload: { ids: [norte.id] } });
    const depois = (await lista(app, carla)).find((c) => c.id === norte.id)!;
    expect(depois.marcadaNaoLida).toBe(false);
    expect(depois.lidaAte).not.toBeNull();
    // a Carla não vê a Sumaré: nada foi marcado para ela lá (e o admin não é afetado)
    expect((await lista(app, admin)).every((c) => !c.marcadaNaoLida)).toBe(true);
  });
});

describe('Prévia da conversa (segurar o dedo)', () => {
  it('traz as últimas mensagens em ordem e NÃO marca como lida', async () => {
    const { app, admin, norte } = await montar();
    const r = await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/previa`, headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    const d = r.json() as { conversa: { id: string; nome: string }; mensagens: Array<{ texto: string; autor: string; autorNome?: string }> };
    expect(d.conversa).toMatchObject({ id: norte.id, nome: 'Juliana' });
    expect(d.mensagens).toHaveLength(30);
    expect(d.mensagens.at(-1)!.texto).toBe('mensagem 44');
    expect(d.mensagens[0]!.texto).toBe('mensagem 15');
    expect(d.mensagens.find((m) => m.autor === 'equipe')!.autorNome).toBe('Carla');
    expect((await lista(app, admin)).find((c) => c.id === norte.id)!.lidaAte).toBeNull();
  });

  it('respeita o limite e quem pode ver a conversa', async () => {
    const { app, admin, carla, sumare, norte } = await montar();
    const r = await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/previa?limite=5`, headers: { cookie: admin } });
    expect((r.json() as { mensagens: unknown[] }).mensagens).toHaveLength(5);
    expect((await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/previa?limite=500`, headers: { cookie: admin } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/conversas/${sumare.id}/previa`, headers: { cookie: carla } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/previa` })).statusCode).toBe(401);
  });
});

describe.runIf(temPostgres)('Marcadas como não lidas no Postgres', () => {
  it('marca, some ao ler e é por pessoa', async () => {
    const pool = await poolDeTeste();
    const novo = async (email: string) => (await pool.query<{ id: string }>(`insert into sintonia.usuarios (id, empresa_id, nome, email, papel, unidades, senha_hash)
      values (gen_random_uuid(), 'imperio', 'Teste', $1, 'admin', '{}', 'x') returning id`, [email])).rows[0]!.id;
    const u = await novo('gestos1@x.com'); const outro = await novo('gestos2@x.com');
    const c = (await pool.query<{ id: string }>(`insert into sintonia.conversas (id, empresa_id, unidade, canal_id, telefone, modo, criada_em, atualizada_em)
      values (gen_random_uuid(), 'imperio', 'norte', 'teste', '5571900001111', 'ia', now(), now()) returning id`)).rows[0]!.id;
    const l: Leituras = new LeiturasPostgres(pool);
    await l.marcar(u, [c], new Date('2026-01-02'));
    await l.desmarcar(u, [c]);
    expect((await l.doUsuario(u)).size).toBe(0);
    expect([...(await l.marcadasNaoLidas(u))]).toEqual([c]);
    expect((await l.marcadasNaoLidas(outro)).size).toBe(0);
    await l.desmarcar(u, [c]); // de novo: não duplica
    expect((await l.marcadasNaoLidas(u)).size).toBe(1);
    await l.marcar(u, [c], new Date('2026-01-03'));
    expect((await l.marcadasNaoLidas(u)).size).toBe(0);
  });
});
