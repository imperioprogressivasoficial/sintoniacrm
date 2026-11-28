import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { LAYOUT_MAX_BYTES, LayoutsPainelMemoria, LayoutsPainelPostgres, type LayoutPainel } from '../src/painel/layout.js';
import { poolDeTeste, temPostgres } from './repos.js';

const exemplo: LayoutPainel = {
  versao: 1,
  blocos: [
    { id: 'heroi', coluna: 'principal', metrica: 'vendido' },
    { id: 'cartoes', coluna: 'principal', metricas: ['leads', 'agendamentos', 'conversao', 'primeira'] },
    { id: 'meta', coluna: 'lateral', metrica: 'agendamentos' },
    { id: 'vendido', coluna: 'lateral', metrica: 'agMes' },
    { id: 'funil', coluna: 'lateral', oculto: true },
    { id: 'origem', coluna: 'principal' },
  ],
};

async function montar() {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const app = criarServidor({ sintonia, repo, auth: { contas }, layoutsPainel: new LayoutsPainelMemoria() });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  return { app, bruno: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com') };
}

describe('Dashboard personalizado (layout por pessoa)', () => {
  it('começa vazio, guarda o de cada pessoa e volta ao padrão', async () => {
    const { app, bruno, carla } = await montar();
    const ler = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/painel/layout', headers: { cookie } })).json();
    expect(await ler(bruno)).toEqual({ layout: null, guardaNoServidor: true });
    const r = await app.inject({ method: 'PUT', url: '/api/painel/layout', headers: { cookie: bruno }, payload: exemplo });
    expect(r.statusCode).toBe(200);
    expect((await ler(bruno)).layout).toEqual(exemplo);
    // cada um tem o seu
    expect((await ler(carla)).layout).toBeNull();
    await app.inject({ method: 'DELETE', url: '/api/painel/layout', headers: { cookie: bruno } });
    expect((await ler(bruno)).layout).toBeNull();
  });

  it('recusa forma errada, bloco repetido e layout grande demais', async () => {
    const { app, bruno } = await montar();
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/painel/layout', headers: { cookie: bruno }, payload: payload as object });
    expect((await put({ versao: 1, blocos: [{ id: 'heroi', coluna: 'meio' }] })).statusCode).toBe(400);
    expect((await put({ versao: 1, blocos: [{ id: 'heroi', coluna: 'principal' }, { id: 'heroi', coluna: 'lateral' }] })).statusCode).toBe(400);
    expect((await put({ versao: 1, blocos: [{ id: '<script>', coluna: 'principal' }] })).statusCode).toBe(400);
    expect((await put({ versao: 1, blocos: [], extra: 'x' })).statusCode).toBe(400);
    const grande = { versao: 1, blocos: [{ id: 'heroi', coluna: 'principal', metrica: 'vendido', lixo: 'x'.repeat(LAYOUT_MAX_BYTES) }] };
    expect([400, 413]).toContain((await put(grande)).statusCode);
    expect((await app.inject({ method: 'GET', url: '/api/painel/layout', headers: { cookie: bruno } })).json().layout).toBeNull();
  });

  it('sem login a rota avisa que guarda só no navegador', async () => {
    const repo = new RepositorioMemoria();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const app = criarServidor({ sintonia, repo, layoutsPainel: new LayoutsPainelMemoria() });
    expect((await app.inject({ method: 'GET', url: '/api/painel/layout' })).json()).toEqual({ layout: null, guardaNoServidor: false });
    expect((await app.inject({ method: 'PUT', url: '/api/painel/layout', payload: exemplo })).statusCode).toBe(400);
  });
});

describe.runIf(temPostgres)('Dashboard personalizado no Postgres', () => {
  it('grava, troca e apaga', async () => {
    const pool = await poolDeTeste();
    const u = (await pool.query<{ id: string }>(`insert into sintonia.usuarios (id, empresa_id, nome, email, papel, unidades, senha_hash)
      values (gen_random_uuid(), 'imperio', 'Teste', 'layout@x.com', 'admin', '{}', 'x') returning id`)).rows[0]!.id;
    const l = new LayoutsPainelPostgres(pool);
    expect(await l.ler(u)).toBeUndefined();
    await l.gravar(u, exemplo);
    expect(await l.ler(u)).toEqual(exemplo);
    await l.gravar(u, { versao: 1, blocos: [{ id: 'heroi', coluna: 'principal' }] });
    expect((await l.ler(u))!.blocos).toHaveLength(1);
    await l.apagar(u);
    expect(await l.ler(u)).toBeUndefined();
  });
});
