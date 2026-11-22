import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

/* velocidade: telas fora da primeira vista chegam sob demanda (public/telas/sob-demanda.js). */
const pasta = new URL('../public/', import.meta.url);
const html = readFileSync(new URL('app.html', pasta), 'utf8');
const carregador = readFileSync(new URL('telas/sob-demanda.js', pasta), 'utf8');
const modelo = /<template id="telas-sob-demanda">([\s\S]*?)<\/template>/.exec(html)?.[1] ?? '';
const noModelo = [...modelo.matchAll(/<script src="\/telas\/([a-z-]+)\.js"><\/script>/g)].map((m) => m[1]!);
const fora = html.replace(modelo, '');
/** Grupos do carregador: { nome: { arquivos, telas: { tela: { acoes, outros } } } } lidos do próprio arquivo (sem rodar). */
const grupos = (() => {
  const bloco = /const GRUPOS = (\{[\s\S]*?\n {2}\});/.exec(carregador)?.[1] ?? '{}';
  // tira a função "depois" (não é JSON) e lê o resto como objeto literal
  // eslint-disable-next-line no-new-func
  return new Function(`return (${bloco.replace(/depois: \(\) => [^,]+,/g, '')});`)() as Record<string, { arquivos: string[]; precisa?: string[]; telas: Record<string, { acoes?: string[]; outros?: string[] }> }>;
})();

describe('Telas sob demanda', () => {
  it('o carregador entra no <head> sem defer, antes das telas', () => {
    const i = html.indexOf('<script src="/telas/sob-demanda.js"></script>');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(html.indexOf('</head>'));
    expect(i).toBeLessThan(html.indexOf('<script src="/telas/serena.js" defer>'));
  });

  it('cada arquivo dos grupos está no <template>, e nenhum também carrega do jeito normal (rodaria duas vezes)', () => {
    const doCarregador = Object.values(grupos).flatMap((g) => g.arquivos);
    expect(new Set(doCarregador).size).toBe(doCarregador.length);
    expect([...noModelo].sort()).toEqual([...doCarregador].sort());
    for (const a of doCarregador) expect(fora).not.toContain(`src="/telas/${a}.js`);
    for (const g of Object.values(grupos)) for (const p of g.precisa ?? []) expect(grupos[p]).toBeTruthy();
  });

  it('os métodos do substituto existem de verdade na tela (nome a nome)', () => {
    for (const [nome, g] of Object.entries(grupos)) {
      const fonte = g.arquivos.map((a) => readFileSync(new URL(`telas/${a}.js`, pasta), 'utf8')).join('\n');
      for (const [tela, m] of Object.entries(g.telas)) {
        expect(fonte, `${nome}: registra SintoniaTelas.${tela}`).toMatch(new RegExp(`window\\.SintoniaTelas\\.${tela} = \\{`));
        for (const metodo of [...(m.acoes ?? []), ...(m.outros ?? [])]) expect(fonte, `${nome}: ${tela}.${metodo}`).toMatch(new RegExp(`\\b${metodo}\\b`));
      }
    }
  });

  it('as telas sob demanda não dependem do evento "load" (que já passou quando elas chegam)', () => {
    for (const a of Object.values(grupos).flatMap((g) => g.arquivos)) {
      const fonte = readFileSync(new URL(`telas/${a}.js`, pasta), 'utf8');
      const soLoad = fonte.match(/addEventListener\('load'[^\n]*/g) ?? [];
      for (const linha of soLoad) expect(fonte, `${a}: ${linha}`).toMatch(/readyState === 'complete'/);
    }
  });

  it('o servidor serve o carregador e põe ?v= nos endereços do <template>', async () => {
    const contas = new ContasMemoria();
    const repo = new RepositorioMemoria();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash: await gerarHash('Imperio2026xyz') });
    const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => new Date('2026-11-20T15:00:00Z'), duracaoHoras: 12 } });
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: 'Imperio2026xyz' } });
    const cookie = String(r.headers['set-cookie']).split(';')[0]!;
    const pagina = (await app.inject({ url: '/app/dashboard', headers: { cookie } })).body;
    expect(pagina).toMatch(/<script src="\/telas\/sob-demanda\.js\?v=[0-9a-f]{10}"><\/script>/);
    const tpl = /<template id="telas-sob-demanda">([\s\S]*?)<\/template>/.exec(pagina)?.[1] ?? '';
    expect(tpl).toMatch(/\/telas\/painel\.js\?v=[0-9a-f]{10}/);
    expect(tpl).toMatch(/\/telas\/funil\.js\?v=[0-9a-f]{10}/);
    const js = await app.inject({ url: '/telas/sob-demanda.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
  });
});
