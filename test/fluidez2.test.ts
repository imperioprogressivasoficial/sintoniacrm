import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { ArmazemPerfisMemoria, registrarConta } from '../src/conta/conta.js';
import { escolherCompressao } from '../src/web/compressao.js';
import { mesmaEtag } from '../src/web/paginas.js';

const CanalFalso = class implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  lerWebhook() { return []; }
  async enviarTexto() { return { idExterno: `out-${Math.random().toString(36).slice(2)}` }; }
};

/* fluidez2: o app chega comprimido e as telas ficam guardadas no aparelho (endereço com ?v=<versão>). */
async function montar() {
  const contas = new ContasMemoria();
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal: new CanalFalso() }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'admin', unidades: ['norte'], senhaHash: await gerarHash('Imperio2026xyz') });
  const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => new Date('2026-11-20T15:00:00Z'), duracaoHoras: 12 } });
  registrarConta(app, { contas, perfis: new ArmazemPerfisMemoria() });
  const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: 'Imperio2026xyz' } });
  const cookie = String(r.headers['set-cookie']).split(';')[0]!;
  return { app, cookie, sintonia };
}

describe('fluidez2: compressão', () => {
  it('escolhe brotli, depois gzip; q=0 desliga', () => {
    expect(escolherCompressao('gzip, deflate, br')).toBe('br');
    expect(escolherCompressao('gzip')).toBe('gzip');
    expect(escolherCompressao('br;q=0, gzip')).toBe('gzip');
    expect(escolherCompressao('identity')).toBeNull();
    expect(escolherCompressao(undefined)).toBeNull();
  });

  it('o app (HTML) e as telas (JS) saem comprimidos e voltam iguais', async () => {
    const { app, cookie } = await montar();
    const puro = await app.inject({ url: '/app', headers: { cookie } });
    expect(puro.headers['content-encoding']).toBeUndefined();
    const br = await app.inject({ url: '/app', headers: { cookie, 'accept-encoding': 'gzip, br' } });
    expect(br.headers['content-encoding']).toBe('br');
    expect(String(br.headers.vary)).toContain('accept-encoding');
    expect(br.rawPayload.length).toBeLessThan(puro.rawPayload.length / 3);
    expect(brotliDecompressSync(br.rawPayload).toString('utf8')).toBe(puro.body);
    const js = await app.inject({ url: '/telas/puxar.js', headers: { 'accept-encoding': 'gzip' } });
    expect(js.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(js.rawPayload).toString('utf8')).toContain('px-veu');
  });

  it('JSON da API sai comprimido; resposta pequena e 304 não', async () => {
    const { app, cookie, sintonia } = await montar();
    for (let i = 0; i < 40; i++) await sintonia.receber({ canalId: 'imperio-norte', deMim: false, telefone: `55719900000${String(i).padStart(2, '0')}`, nome: `Cliente ${i}`, texto: 'Oi, quero marcar um horário para sábado de manhã', idExterno: `x${i}`, em: new Date('2026-11-20T14:00:00Z') });
    const puro = await app.inject({ url: '/api/conversas', headers: { cookie } });
    expect(puro.statusCode).toBe(200);
    const r = await app.inject({ url: '/api/conversas', headers: { cookie, 'accept-encoding': 'br' } });
    expect(r.headers['content-encoding']).toBe('br');
    expect(JSON.parse(brotliDecompressSync(r.rawPayload).toString('utf8'))).toEqual(JSON.parse(puro.body));
    const denovo = await app.inject({ url: '/api/conversas', headers: { cookie, 'accept-encoding': 'br', 'if-none-match': String(r.headers.etag) } });
    expect(denovo.statusCode).toBe(304);
    expect(denovo.headers['content-encoding']).toBeUndefined();
    const pequeno = await app.inject({ url: '/api/auth/eu', headers: { cookie, 'accept-encoding': 'br' } });
    expect(pequeno.headers['content-encoding']).toBeUndefined();
  });
});

describe('fluidez2: guardar as telas no aparelho', () => {
  it('com a versão certa (?v=) fica guardado 1 ano; sem versão, confere a cada uso', async () => {
    const { app, cookie } = await montar();
    const html = (await app.inject({ url: '/app', headers: { cookie } })).body;
    const v = html.match(/\/telas\/puxar\.js\?v=([0-9a-f]{10})/)![1]!;
    const certo = await app.inject({ url: `/telas/puxar.js?v=${v}` });
    expect(certo.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const velho = await app.inject({ url: '/telas/puxar.js?v=0000000000' });
    expect(velho.headers['cache-control']).toBe('no-cache');
    const sem = await app.inject({ url: '/telas/puxar.js' });
    expect(sem.headers['cache-control']).toBe('no-cache');
    expect((await app.inject({ url: '/telas/puxar.js', headers: { 'if-none-match': String(sem.headers.etag) } })).statusCode).toBe(304);
    expect((await app.inject({ url: '/telas/puxar.js', headers: { 'if-none-match': 'W/' + String(sem.headers.etag) } })).statusCode).toBe(304);
    // o app em si continua sem guardar (sempre a versão nova) e o service worker nunca fica guardado
    expect((await app.inject({ url: '/app', headers: { cookie } })).headers['cache-control']).toContain('no-store');
    expect((await app.inject({ url: '/sw.js?v=qualquer' })).headers['cache-control']).toBe('no-cache');
    const css = html.match(/\/ds\.css\?v=([0-9a-f]{10})/)![1]!;
    expect((await app.inject({ url: `/ds.css?v=${css}` })).headers['cache-control']).toContain('immutable');
  });

  it('mesmaEtag aceita W/, lista e *', () => {
    expect(mesmaEtag('"a"', '"a"')).toBe(true);
    expect(mesmaEtag('W/"a"', '"a"')).toBe(true);
    expect(mesmaEtag('"b", "a"', '"a"')).toBe(true);
    expect(mesmaEtag('*', '"a"')).toBe(true);
    expect(mesmaEtag('"b"', '"a"')).toBe(false);
    expect(mesmaEtag(undefined, '"a"')).toBe(false);
  });
});

describe('fluidez2: Ocultar dados dos clientes', () => {
  it('a escolha fica na conta (preferencias.ocultarDados), começa desligada', async () => {
    const { app, cookie } = await montar();
    const como = (method: 'GET' | 'PATCH', payload?: unknown) => app.inject({ method, url: '/api/conta', headers: { cookie }, ...(payload ? { payload } : {}) });
    const c0 = await como('GET');
    expect(c0.statusCode).toBe(200);
    expect(c0.json().preferencias.ocultarDados).toBe(false);
    expect((await como('PATCH', { preferencias: { ocultarDados: 'sim' } })).statusCode).toBe(400);
    expect((await como('PATCH', { preferencias: { ocultarDados: true } })).json().preferencias).toMatchObject({ ocultarDados: true, densidade: 'confortavel' });
    expect((await como('PATCH', { preferencias: { densidade: 'compacta' } })).json().preferencias).toMatchObject({ ocultarDados: true, densidade: 'compacta' });
    expect((await como('GET')).json().preferencias.ocultarDados).toBe(true);
  });

  it('o app carrega o modo privacidade e a ordem de chegada antes de tudo, e tem o atalho no ⋯ das Conversas', async () => {
    const { app, cookie } = await montar();
    const html = (await app.inject({ url: '/app', headers: { cookie } })).body;
    const pos = (x: string) => html.indexOf(x);
    expect(pos('/telas/prioridade.js?v=')).toBeGreaterThan(0);
    expect(pos('/telas/privacidade.js?v=')).toBeGreaterThan(pos('/telas/fone.js?v='));
    expect(pos('/telas/privacidade.js?v=')).toBeLessThan(pos('</head>'));
    expect(html).toContain('data-acao="privacidade"');
    const js = await app.inject({ url: '/telas/privacidade.js' });
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('html.privacidade');
  });
});

