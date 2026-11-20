import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

function montar(comLogin = true) {
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const auth = { contas: new ContasMemoria(), agora: () => new Date('2026-11-20T15:00:00Z'), duracaoHoras: 12 };
  return criarServidor({ sintonia, repo, ...(comLogin ? { auth } : {}) });
}
const HTML = { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' };

describe('Cabeçalho x-sintonia (distingue o nosso servidor do proxy durante uma publicação)', () => {
  it('vai em toda resposta: saúde, páginas, redirecionamento, 401, 404, erro de validação e arquivos', async () => {
    const app = montar();
    const respostas = await Promise.all([
      app.inject({ url: '/saude' }),
      app.inject({ url: '/entrar', headers: HTML }),
      app.inject({ url: '/app', headers: HTML }), // sem login: redireciona
      app.inject({ url: '/api/conversas' }), // 401
      app.inject({ url: '/nao-existe', headers: HTML }),
      app.inject({ url: '/api/auth/nao-existe', method: 'POST', payload: {} }),
      app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'x' } }), // 400
      app.inject({ url: '/sw.js' }),
      app.inject({ url: '/telas/atualizando.js' }),
    ]);
    expect(respostas.map((r) => r.statusCode)).toEqual([200, 200, 302, 401, 404, 401, 400, 200, 200]);
    for (const r of respostas) {
      expect(r.headers['x-sintonia']).toBe('1');
      expect(String(r.headers['x-sintonia-versao'])).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    }
    // a versão é a mesma enquanto o servidor estiver no ar
    expect(new Set(respostas.map((r) => r.headers['x-sintonia-versao'])).size).toBe(1);
  });

  it('também no 304 (arquivo sem mudança) e na resposta de erro interno', async () => {
    const app = montar();
    app.get('/teste-quebra', async () => { throw new Error('boom'); });
    const js = await app.inject({ url: '/telas/atualizando.js' });
    const r304 = await app.inject({ url: '/telas/atualizando.js', headers: { 'if-none-match': String(js.headers.etag) } });
    expect(r304.statusCode).toBe(304);
    expect(r304.headers['x-sintonia']).toBe('1');
    const r500 = await app.inject({ url: '/teste-quebra' });
    expect(r500.statusCode).toBe(500);
    expect(r500.headers['x-sintonia']).toBe('1');
  });
});

describe('Página 404 da Sintonia', () => {
  it('navegação por endereço que não existe recebe a página bonita com "Voltar para a Sintonia"', async () => {
    const r = await montar().inject({ url: '/qualquer/coisa?x=1', headers: HTML });
    expect(r.statusCode).toBe(404);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.headers['cache-control']).toMatch(/no-store/);
    expect(r.body).toContain('Voltar para a Sintonia');
    expect(r.body).toContain('href="/app"');
    // o caminho entra na tela só por textContent, nunca no HTML do servidor
    expect(r.body).not.toContain('/qualquer/coisa');
  });

  it('API, webhooks, POST e quem não pede HTML continuam recebendo JSON', async () => {
    const app = montar(false); // sem login: a API desconhecida chega ao 404 (com login, dá 401 antes)
    for (const r of [
      await app.inject({ url: '/api/auth/nada', headers: HTML }),
      await app.inject({ url: '/webhooks/nada', headers: HTML }),
      await app.inject({ url: '/nada', method: 'POST', headers: HTML, payload: {} }),
      await app.inject({ url: '/nada' }),
    ]) {
      expect(r.statusCode).toBe(404);
      expect(r.headers['content-type']).toMatch(/application\/json/);
      expect(r.json()).toEqual({ erro: 'Endereço não encontrado.', statusCode: 404 });
    }
  });
});

describe('Página "Estamos atualizando melhorias"', () => {
  it('é autossuficiente: o script vem dentro, sem buscar nada no servidor', async () => {
    const r = await montar().inject({ url: '/atualizando.html' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.body).toContain('window.SINTONIA_ATUALIZANDO_PAGINA = true');
    expect(r.body).toContain('Estamos atualizando ');
    expect(r.body).not.toContain('data-embutir');
    expect(r.body).not.toMatch(/<(script|link|img)[^>]+(src|href)="\//);
  });

  it('o service worker guarda só essa página e confere o cabeçalho do nosso servidor', async () => {
    const r = await montar().inject({ url: '/sw.js' });
    expect(r.body).toContain("const PAGINA = '/atualizando.html'");
    expect(r.body).toContain("headers.get('x-sintonia')");
    expect(r.body).toContain("req.mode !== 'navigate'");
  });
});
