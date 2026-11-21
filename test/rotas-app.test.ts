import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { voltaSegura } from '../src/web/paginas.js';

/* rotas-fontes: endereços do app (/app/dashboard, /app/conversas/<id>…) servem o app e voltam depois do login. */
async function montar() {
  const contas = new ContasMemoria();
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await gerarHash('Imperio2026xyz') });
  const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => new Date('2026-11-20T15:00:00Z'), duracaoHoras: 12 } });
  const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: 'Imperio2026xyz' } });
  const cookie = String(r.headers['set-cookie']).split(';')[0]!;
  return { app, cookie };
}

describe('Endereços do app (/app/*)', () => {
  it('sem login: vai para /entrar?volta=<endereço>', async () => {
    const { app } = await montar();
    for (const url of ['/app/dashboard', '/app/conversas/0b6c2c1e-1111-4222-8333-444455556666', '/app/pipelines/abc', '/app/analises/vendas?x=1']) {
      const r = await app.inject({ url });
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe('/entrar?volta=' + encodeURIComponent(url));
    }
    expect((await app.inject({ url: '/app' })).headers.location).toBe('/entrar');
  });

  it('com login: serve o mesmo app.html (com versões nos arquivos) e sem cache', async () => {
    const { app, cookie } = await montar();
    const raiz = await app.inject({ url: '/app', headers: { cookie } });
    for (const url of ['/app/dashboard', '/app/conversas/xyz', '/app/pipelines/f1', '/app/analises/horarios', '/app/configuracoes', '/app/qualquer/coisa']) {
      const r = await app.inject({ url, headers: { cookie } });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.headers['cache-control']).toContain('no-store');
      expect(r.headers['x-frame-options']).toBe('DENY');
      expect(r.body).toBe(raiz.body);
    }
    expect(raiz.body).toMatch(/\/telas\/rotas\.js\?v=[0-9a-f]{10}/);
    expect((await app.inject({ url: '/telas/rotas.js' })).headers['content-type']).toContain('javascript');
  });

  it('já logada no /entrar?volta=…: volta para o endereço do app; endereço de fora é ignorado', async () => {
    const { app, cookie } = await montar();
    const ir = async (volta: string) => (await app.inject({ url: '/entrar?volta=' + encodeURIComponent(volta), headers: { cookie } })).headers.location;
    expect(await ir('/app/conversas/abc')).toBe('/app/conversas/abc');
    expect(await ir('/app/analises/vendas')).toBe('/app/analises/vendas');
    expect(await ir('https://golpe.com/app')).toBe('/app');
    expect(await ir('//golpe.com/app')).toBe('/app');
    expect(await ir('/application')).toBe('/app');
    expect(await ir('/app/\\golpe.com')).toBe('/app');
  });

  it('voltaSegura só aceita caminhos do próprio app', () => {
    expect(voltaSegura('/app')).toBe('/app');
    expect(voltaSegura('/app/pipelines/1?x=2')).toBe('/app/pipelines/1?x=2');
    expect(voltaSegura('/conexoes')).toBe('/conexoes');
    for (const v of ['/', '/apps', 'app/x', '//x.com', '/app//x.com', '/app/%2F%2Fx.com', '/app/a b', '/app\\x', 'javascript:alert(1)', 5, null, '/app/' + 'a'.repeat(400)]) expect(voltaSegura(v)).toBeNull();
  });
});
