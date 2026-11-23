import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalTeste } from '../src/channels/teste.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { LeiturasMemoria } from '../src/app/leituras.js';
import { poolDeTeste, temPostgres } from './repos.js';

// Topo da conversa como o WhatsApp Web (public/telas/topo-conversa.js): Pesquisar em todas as mensagens e Exportar (.txt).
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
  // 300 mensagens: a tela só carrega as 200 últimas; a pesquisa acha também as antigas
  for (let i = 0; i < 300; i++) {
    await repo.adicionarMensagem({ conversaId: norte.id, autor: i % 2 ? 'equipe' : 'cliente', autorNome: i % 2 ? 'Carla' : undefined, texto: i === 5 ? 'Quero a SELAGEM 100% de novo' : `mensagem ${i}`, em: new Date(agora.getTime() + i * 60_000) });
  }
  await repo.adicionarMensagem({ conversaId: sumare.id, autor: 'cliente', texto: 'selagem na Sumaré', em: agora });
  const app = criarServidor({ sintonia, repo, auth: { contas }, leituras: new LeiturasMemoria() });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  return { app, norte, sumare, admin: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com') };
}

describe('Pesquisar dentro da conversa (lupa do topo)', () => {
  it('acha mensagens antigas, sem diferenciar maiúsculas; termo curto não pesquisa', async () => {
    const { app, admin, norte } = await montar();
    const r = await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/busca?q=selagem`, headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados).toHaveLength(1);
    expect(r.json().resultados[0]).toMatchObject({ texto: 'Quero a SELAGEM 100% de novo', autor: 'equipe', autorNome: 'Carla' });
    // as mais recentes primeiro, no máximo 50
    const muitas = (await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/busca?q=mensagem`, headers: { cookie: admin } })).json().resultados;
    expect(muitas).toHaveLength(50);
    expect(muitas[0].texto).toBe('mensagem 299');
    expect((await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/busca?q=s`, headers: { cookie: admin } })).json().resultados).toEqual([]);
  });

  it('só pesquisa em conversa que a pessoa vê', async () => {
    const { app, carla, sumare } = await montar();
    const r = await app.inject({ method: 'GET', url: `/api/conversas/${sumare.id}/busca?q=selagem`, headers: { cookie: carla } });
    expect(r.statusCode).toBe(404);
  });
});

describe('Exportar conversa (⋯ do topo)', () => {
  it('baixa um .txt com todas as mensagens, na hora da Bahia', async () => {
    const { app, admin, norte } = await montar();
    const r = await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/exportar`, headers: { cookie: admin } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/plain');
    expect(String(r.headers['content-disposition'])).toContain('attachment');
    const linhas = r.body.split('\r\n');
    expect(linhas[0]).toContain('Conversa com Juliana (5571988887777)');
    expect(linhas.filter((l) => l.startsWith('['))).toHaveLength(300);
    expect(r.body).toContain('[20/11/2026 09:00] Juliana: mensagem 0');
    expect(r.body).toContain('[20/11/2026 09:01] Carla: mensagem 1');
  });

  it('atendente sem permissão de exportar não baixa', async () => {
    const { app, carla, norte } = await montar();
    const r = await app.inject({ method: 'GET', url: `/api/conversas/${norte.id}/exportar`, headers: { cookie: carla } });
    expect(r.statusCode).toBe(403);
  });
});

describe.skipIf(!temPostgres)('Pesquisar dentro da conversa (postgres)', () => {
  it('ilike com % e _ do texto tratados como letras', async () => {
    const pool = await poolDeTeste();
    const repo = new RepositorioPostgres(pool);
    const agora = new Date();
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'teste-norte', telefone: `5571${Date.now() % 1e8}`, nome: 'Teste busca', agora });
    await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'cliente', texto: 'desconto de 10% hoje', em: agora });
    await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'cliente', texto: 'desconto de 10 reais', em: new Date(agora.getTime() + 1000) });
    expect((await repo.buscarNaConversa(conversa.id, '10%')).map((m) => m.texto)).toEqual(['desconto de 10% hoje']);
    expect((await repo.buscarNaConversa(conversa.id, 'DESCONTO')).map((m) => m.texto)).toEqual(['desconto de 10 reais', 'desconto de 10% hoje']);
  });
});

describe('Faixa "Sincronizando suas conversas" (GET /api/sincronizando)', () => {
  it('sem histórico chegando: nada ativo', async () => {
    const { app, carla } = await montar();
    const r = await app.inject({ method: 'GET', url: '/api/sincronizando', headers: { cookie: carla } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ativo: false, canais: [] });
  });
});
