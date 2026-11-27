import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * seguranca-abertura (27/11): antes de abrir a Sintonia para a equipe (atendentes da Sumaré e administradores),
 * sobe o app DE VERDADE (src/index.ts, em memória) com todas as rotas que ele registra, lista as rotas pelo próprio
 * Fastify (gancho onRoute, test/varredura-preload.mjs) e, logada como atendente da Sumaré:
 * - chama TODAS as rotas GET da API (inclusive com o id direto de coisas da Norte) e confere que nenhuma devolve
 *   dado da Norte;
 * - chama todas as rotas que mudam dados nas áreas de gestão e confere que todas recusam;
 * - tenta escrever em conversa da Norte com pedido válido (IDOR) e tenta mudar o próprio acesso.
 */

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SENHA_ADMIN = 'Imperio2026x';
const SENHA = 'Imperio2026xyz!';
/** Marca que só existe em dado da Norte: se aparecer numa resposta para a atendente da Sumaré, vazou. */
const MARCA = 'XNORTEX';
const TEL_NORTE = '5599900000001';
const TEL_SUMARE = '5599900000002';
const VAZOU = new RegExp(`${MARCA}|${TEL_NORTE}|carla\\.norte@t\\.com|norte\\.ficha@t\\.com`);

interface Resposta {
  s: number;
  t: string;
  h: Headers;
}

let app: ChildProcess | undefined;
let pasta = '';
let base = '';
let rotas: Array<[string, string]> = [];
let saida = '';

async function pedir(cookie: string, method: string, url: string, corpo?: unknown): Promise<Resposta> {
  const comCorpo = method !== 'GET' && method !== 'HEAD';
  const r = await fetch(base + url, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(comCorpo ? { 'content-type': 'application/json' } : {}) },
    ...(comCorpo ? { body: JSON.stringify(corpo ?? {}) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  return { s: r.status, t: await r.text(), h: r.headers };
}

async function entrar(email: string, senha: string): Promise<string> {
  const r = await fetch(base + '/api/auth/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, senha }) });
  if (r.status !== 200) throw new Error(`login ${email}: ${r.status} ${await r.text()}`);
  return String(r.headers.get('set-cookie') ?? '').split(';')[0]!;
}

const dados = {
  admin: '',
  ana: '',
  anaId: '',
  biaId: '',
  carlaId: '',
  norte: '',
  sumare: '',
  msgNorte: '',
  msgSumare: '',
};

/**
 * Em memória sempre; com SINTONIA_TESTE_PG, também com Postgres (num banco só desta varredura, criado e apagado aqui),
 * que liga as rotas que só existem com banco (e-mail, transmissões, rotina, reuniões...).
 */
const URL_PG = process.env.SINTONIA_TESTE_PG;
const modos: Array<{ nome: string; banco?: string }> = [{ nome: 'memória' }, ...(URL_PG ? [{ nome: 'postgres', banco: `${new URL(URL_PG).pathname.slice(1)}_varredura` }] : [])];

async function prepararBanco(nome: string): Promise<string> {
  const c = new pg.Client({ connectionString: URL_PG });
  await c.connect();
  try {
    await c.query(`drop database if exists "${nome}" with (force)`);
    await c.query(`create database "${nome}"`);
  } finally {
    await c.end();
  }
  const u = new URL(URL_PG!);
  u.pathname = `/${nome}`;
  return u.toString();
}

async function subir(banco?: string) {
  saida = '';
  pasta = mkdtempSync(join(tmpdir(), 'sintonia-varredura-'));
  const arquivo = join(pasta, 'rotas.txt');
  const porta = 41000 + Math.floor(Math.random() * 8000);
  base = `http://127.0.0.1:${porta}`;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['DATABASE_URL', 'SINTONIA_TESTE_PG', 'SINTONIA_URL_PUBLICA', 'ANTHROPIC_API_KEY', 'EVOLUTION_URL', 'EVOLUTION_API_KEY', 'SINTONIA_NUMEROS', 'SINTONIA_CSP']) delete env[k];
  if (banco) env.DATABASE_URL = await prepararBanco(banco);
  Object.assign(env, { PORT: String(porta), COOKIE_SEGURO: '0', ADMIN_NOME: 'Bruno Batista', ADMIN_EMAIL: 'bruno@teste.com', ADMIN_SENHA: SENHA_ADMIN, ROTAS_SAIDA: arquivo, SINTONIA_EMPRESA_ID: 'imperio' });
  app = spawn(process.execPath, ['--import', 'tsx', '--import', new URL('./varredura-preload.mjs', import.meta.url).href, 'src/index.ts'], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  app.stdout?.on('data', (b) => (saida = (saida + String(b)).slice(-4000)));
  app.stderr?.on('data', (b) => (saida = (saida + String(b)).slice(-4000)));
  for (let i = 0; ; i++) {
    const ok = await fetch(base + '/saude').then((r) => r.ok, () => false);
    if (ok) break;
    if (i > 120 || app.exitCode !== null) throw new Error(`O app não subiu:\n${saida}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  rotas = readFileSync(arquivo, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split(' ') as [string, string])
    .filter(([m, u]) => u.startsWith('/api/') && ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m));

  // ---- gente: admin (do ambiente), 2 atendentes da Sumaré e 1 atendente da Norte
  dados.admin = await entrar('bruno@teste.com', SENHA_ADMIN);
  const criar = async (nome: string, email: string, papel: string, unidades: string[]) => {
    const r = await pedir(dados.admin, 'POST', '/api/acessos/usuarios', { nome, email, papel, unidades, senha: SENHA, trocarSenha: false, telefone: '(71) 97777-0000' });
    if (r.s !== 201) throw new Error(`criar ${email}: ${r.s} ${r.t}`);
    return JSON.parse(r.t).pessoa.id as string;
  };
  dados.anaId = await criar('Ana Sumaré', 'ana.sumare@t.com', 'atendente', ['sumare']);
  dados.biaId = await criar('Bia Sumaré', 'bia.sumare@t.com', 'atendente', ['sumare']);
  dados.carlaId = await criar('Carla Norte', 'carla.norte@t.com', 'atendente', ['norte']);
  dados.ana = await entrar('ana.sumare@t.com', SENHA);

  // ---- clientes: uma na Norte (com a marca em tudo) e uma na Sumaré
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  for (const [unidade, nome, telefone] of [['norte', `Cliente ${MARCA}`, TEL_NORTE], ['sumare', 'Cliente Sumaré', TEL_SUMARE]] as const) {
    expect((await pedir(dados.admin, 'POST', '/api/teste/cliente', { unidade, nome, telefone, texto: `oi ${unidade === 'norte' ? MARCA : 'sumaré'}` })).s).toBe(200);
    expect((await pedir(dados.admin, 'POST', '/api/teste/cliente', { unidade, nome, telefone, midia: { base64: png, mimetype: 'image/png', nomeArquivo: `${unidade}.png` } })).s).toBe(200);
  }
  const lista = JSON.parse((await pedir(dados.admin, 'GET', '/api/conversas')).t) as unknown;
  const convs = (Array.isArray(lista) ? lista : (lista as { conversas: unknown[] }).conversas) as Array<{ id: string; telefone: string }>;
  dados.norte = convs.find((c) => c.telefone === TEL_NORTE)!.id;
  dados.sumare = convs.find((c) => c.telefone === TEL_SUMARE)!.id;
  dados.msgNorte = JSON.parse((await pedir(dados.admin, 'GET', `/api/conversas/${dados.norte}`)).t).mensagens.at(-1).id;
  dados.msgSumare = JSON.parse((await pedir(dados.admin, 'GET', `/api/conversas/${dados.sumare}`)).t).mensagens.at(-1).id;

  // ---- mais dado da Norte, feito pela administração (ficha, ligação, agendada, radar, favorita, nota)
  const amanha = new Date(Date.now() + 2 * 86400_000);
  const dia = new Date(amanha.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
  for (const [m, u, b] of [
    ['PUT', `/api/conversas/${dados.norte}/contato`, { email: 'norte.ficha@t.com', observacoes: `ficha ${MARCA}` }],
    ['POST', `/api/conversas/${dados.norte}/ligacao`, { resultado: 'atendeu', nota: `ligação ${MARCA}` }],
    ['POST', `/api/conversas/${dados.norte}/agendadas`, { texto: `agendada ${MARCA}`, data: dia, hora: '10:00' }],
    ['PUT', `/api/radar/conversa/${dados.norte}`, { vigiar: `radar ${MARCA}`, acao: 'avisar' }],
    ['POST', `/api/conversas/${dados.norte}/mensagens/${dados.msgNorte}/favorito`, { favorito: true }],
  ] as const) {
    const r = await pedir(dados.admin, m, u, b);
    expect(r.s, `${m} ${u}: ${r.t}`).toBeLessThan(300);
  }
}

async function parar(banco?: string) {
  const p = app;
  app = undefined;
  if (p && p.exitCode === null) {
    const saiu = new Promise((r) => p.once('exit', r));
    p.kill('SIGKILL');
    await saiu;
  }
  if (pasta) rmSync(pasta, { recursive: true, force: true });
  if (banco) {
    const c = new pg.Client({ connectionString: URL_PG });
    await c.connect();
    await c.query(`drop database if exists "${banco}" with (force)`).catch(() => undefined);
    await c.end();
  }
}

/** Valores para os parâmetros do caminho: o id direto de coisa da Norte. */
function caminho(rota: string, id: string): string {
  let primeiro = true;
  return rota.replace(/:([a-zA-Z]+)|\*/g, (_t, p: string | undefined) => {
    if (!p) return 'x';
    if (p === 'unidade') return 'norte';
    if (primeiro) {
      primeiro = false;
      return encodeURIComponent(id);
    }
    if (p === 'msgId' || p === 'mensagemId') return dados.msgNorte;
    if (p === 'unidade') return 'norte';
    if (p === 'telefone') return TEL_NORTE;
    return 'x';
  });
}

/** Ações que mudam dados nas áreas de gestão: a atendente nunca pode. */
const AREAS_GESTAO =
  /^\/api\/(conexoes|acessos|integracoes|planos|agentes-ia|automacoes|bots|transmissoes|email|comercial|cadastro|empresa|lgpd|demo|seguranca|rastreio|funis|tags|rodizio|relatorio-dia|ia|produtos|tabelas-preco|documentos|unidades|campos-contato|leads|fila|perdas|produtos-lead|espera\/regras|desempenho|analises|economia-ia|relatorios|grupos\/sincronizar|followup\/config|whatsapp)(\/|$)|^\/api\/equipe(\/:id(\/(senha|desativar|reativar))?)?$/;
/** O que fica nessas áreas mas é do dia a dia da atendente (cada rota confere a conversa ou a pessoa). */
const DO_DIA_A_DIA = [
  /^POST \/api\/agentes-ia\/:id\/aprendizados$/, // sugere uma correção para a gestão aprovar
  /^POST \/api\/funis\/:id\/excluidos(\/recuperar)?$/, // lixeira do pipeline (só conversas que ela vê)
  /^POST \/api\/ia\/chat$/, // Serena (age como a própria pessoa)
  /^POST \/api\/tags\/:id\/conversas$/, // marcar tag em massa (só conversas que ela vê)
  /^POST \/api\/leads-site(\/demonstracao)?$/, // formulário público da página de vendas
];
/** Não chamar: encerram a sessão da própria atendente no meio da varredura. */
const NAO_CHAMAR = /^(POST \/api\/auth\/sair|POST \/api\/auth\/sessoes|DELETE \/api\/auth\/sessoes|POST \/api\/conta\/excluir)/;

describe.each(modos)('Abertura para a equipe: varredura de todas as rotas como atendente da Sumaré ($nome)', (modo) => {
  beforeAll(() => subir(modo.banco), 120_000);
  afterAll(() => parar(modo.banco), 30_000);

  it('o app de verdade registra as rotas da API (lista tirada do próprio Fastify)', () => {
    expect(rotas.length).toBeGreaterThan(400);
    expect(rotas.map(([m, u]) => `${m} ${u}`)).toEqual(expect.arrayContaining(['GET /api/conversas', 'GET /api/conversas/:id', 'GET /api/acessos/usuarios', 'PUT /api/conexoes']));
    // Com banco entram as rotas que só existem com Postgres.
    if (modo.banco) expect(rotas.map(([m, u]) => `${m} ${u}`)).toEqual(expect.arrayContaining(['GET /api/reunioes', 'GET /api/rotina/dia', 'GET /api/transmissoes', 'GET /api/email/campanhas']));
  });

  it('nenhuma rota GET devolve conversa, mensagem, mídia, ficha, ligação, agendada ou radar da Norte (nem pelo id direto)', async () => {
    const vazou: string[] = [];
    const idsDaLista = new Map<string, string[]>();
    let chamadas = 0;
    for (const [m, rota] of rotas) {
      if (m !== 'GET') continue;
      const urls: string[] = [];
      if (!rota.includes(':') && !rota.includes('*')) urls.push(rota);
      else {
        // O id da conversa da Norte e os ids que a lista da administração mostra (agendadas, tags, funis, radar...).
        const raiz = rota.split('/:')[0]!;
        if (!idsDaLista.has(raiz)) {
          const t = (await pedir(dados.admin, 'GET', raiz).catch(() => ({ t: '' }))).t;
          idsDaLista.set(raiz, [...new Set([...t.matchAll(/"id":"([A-Za-z0-9_-]{6,64})"/g)].map((x) => x[1]!))].slice(0, 10));
        }
        for (const id of new Set([dados.norte, dados.msgNorte, ...idsDaLista.get(raiz)!])) urls.push(caminho(rota, id));
      }
      for (const url of urls) {
        const r = await pedir(dados.ana, 'GET', url);
        chamadas++;
        if (VAZOU.test(r.t)) vazou.push(`${url} → ${r.s} ${r.t.slice(0, 160)}`);
      }
    }
    expect(chamadas).toBeGreaterThan(200);
    expect(vazou).toEqual([]);
    // Controle: a administração vê a conversa da Norte (a marca existe e o teste enxergaria o vazamento).
    expect((await pedir(dados.admin, 'GET', `/api/conversas/${dados.norte}`)).t).toContain(MARCA);
    expect((await pedir(dados.ana, 'GET', `/api/conversas/${dados.sumare}`)).s).toBe(200);
  }, 180_000);

  it('nenhuma ação de gestão (conexões, chaves, acessos, IA, automações, cobrança, integrações, apagar) passa', async () => {
    const passou: string[] = [];
    let conferidas = 0;
    for (const [m, rota] of rotas) {
      if (m === 'GET' || NAO_CHAMAR.test(`${m} ${rota}`)) continue;
      if (!AREAS_GESTAO.test(rota) || DO_DIA_A_DIA.some((x) => x.test(`${m} ${rota}`))) continue;
      const r = await pedir(dados.ana, m, caminho(rota, dados.norte), {});
      conferidas++;
      if (![401, 403, 404, 405, 410].includes(r.s)) passou.push(`${m} ${rota} → ${r.s} ${r.t.slice(0, 120)}`);
    }
    expect(conferidas).toBeGreaterThan(150);
    expect(passou).toEqual([]);
    // Apagar conversa (de qualquer unidade) também não.
    expect([403, 404]).toContain((await pedir(dados.ana, 'DELETE', `/api/conversas/${dados.sumare}`)).s);
  }, 180_000);

  it('não escreve em conversa da Norte nem com o pedido certo (IDOR); na dela funciona', async () => {
    const funis = JSON.parse((await pedir(dados.admin, 'GET', '/api/funis')).t) as Array<{ id: string; etapas: Array<{ id: string }> }>;
    const tag = JSON.parse((await pedir(dados.admin, 'POST', '/api/tags', { nome: 'Teste varredura' })).t) as { id: string };
    const casos: Array<[string, string, unknown]> = [
      ['POST', '/api/conversas/:id/enviar', { texto: 'oi' }],
      ['POST', '/api/conversas/:id/enviar-midia', { base64: 'aGVsbG8=', mimetype: 'text/plain', nomeArquivo: 'a.txt', tipo: 'documento' }],
      ['POST', '/api/conversas/:id/responder', { texto: 'oi', citadaId: ':msg' }],
      ['POST', '/api/conversas/:id/assumir', {}],
      ['POST', '/api/conversas/:id/modo', { modo: 'humano' }],
      ['POST', '/api/conversas/:id/lida', {}],
      ['POST', '/api/conversas/:id/finalizar', { motivo: 'resolvido' }],
      ['POST', '/api/conversas/:id/ligacao', { resultado: 'atendeu' }],
      ['POST', '/api/conversas/:id/tags', { tagId: tag.id }],
      ['POST', `/api/conversas/:id/funis/${funis[0]!.id}`, { etapaId: funis[0]!.etapas[1]!.id }],
      ['PUT', '/api/conversas/:id/valor', { valor: 10 }],
      ['PUT', '/api/conversas/:id/contato', { observacoes: 'x' }],
      ['POST', '/api/conversas/:id/agendadas', { texto: 'oi', enviarEm: new Date(Date.now() + 86400_000).toISOString() }],
      ['POST', '/api/conversas/:id/mensagens/:msg/reacao', { emoji: '👍' }],
      ['POST', '/api/conversas/:id/mensagens/:msg/fixar', { fixar: true }],
      ['POST', '/api/conversas/:id/mensagens/:msg/nota', {}],
      ['POST', '/api/conversas/:id/mensagens/:msg/apagar', { modo: 'aqui' }],
      ['POST', '/api/conversas/:id/midias/:msg/baixar', {}],
      ['PUT', '/api/radar/conversa/:id', { vigiar: 'qualquer coisa', acao: 'avisar' }],
      ['POST', '/api/ligacoes/favoritos', { conversaId: ':id', favorito: true }],
      ['POST', '/api/ligacoes/programar', { conversaId: ':id', quando: new Date(Date.now() + 86400_000).toISOString() }],
    ];
    const montar = (s: string, conv: string, msg: string) => s.replaceAll(':id', conv).replaceAll(':msg', msg);
    const errado: string[] = [];
    for (const [m, u, corpo] of casos) {
      const naNorte = await pedir(dados.ana, m, montar(u, dados.norte, dados.msgNorte), JSON.parse(montar(JSON.stringify(corpo), dados.norte, dados.msgNorte)));
      if (naNorte.s !== 404 && naNorte.s !== 403) errado.push(`Norte: ${m} ${u} → ${naNorte.s} ${naNorte.t.slice(0, 100)}`);
      const naDela = await pedir(dados.ana, m, montar(u, dados.sumare, dados.msgSumare), JSON.parse(montar(JSON.stringify(corpo), dados.sumare, dados.msgSumare)));
      if (naDela.s === 404 || naDela.s === 400) errado.push(`Sumaré (dela): ${m} ${u} → ${naDela.s} ${naDela.t.slice(0, 100)}`);
    }
    expect(errado).toEqual([]);
    // A mídia da Norte não sai nem pelo endereço do arquivo.
    expect((await pedir(dados.ana, 'GET', `/api/conversas/${dados.norte}/midias/${dados.msgNorte}`)).s).toBe(404);
    expect((await pedir(dados.ana, 'GET', `/api/conversas/${dados.sumare}/midias/${dados.msgNorte}`)).s).toBe(404);
  }, 60_000);

  it('não muda o próprio papel, unidades ou permissões, nem os de colegas, e não lê e-mail/telefone de colegas', async () => {
    // Pela Conta (perfil): papel e unidades vindos no corpo são ignorados.
    await pedir(dados.ana, 'PATCH', '/api/conta', { papel: 'admin', unidades: ['norte'], permissoes: { conexoes: true } });
    for (const [m, u, b] of [
      ['PATCH', `/api/acessos/usuarios/${dados.anaId}`, { papel: 'admin', unidades: ['norte', 'sumare'], ajustes: { conversas: 'todas', conexoes: true, equipe: true } }],
      ['PATCH', `/api/acessos/usuarios/${dados.biaId}`, { papel: 'gerente' }],
      ['PATCH', `/api/equipe/${dados.anaId}`, { papel: 'admin', unidades: ['norte'] }],
      ['PUT', '/api/acessos/perfis/atendente', { permissoes: { conversas: 'todas', conexoes: true, equipe: true } }],
      ['POST', '/api/acessos/usuarios', { nome: 'Nova Admin', email: 'nova@t.com', papel: 'admin', unidades: [], senha: SENHA }],
      ['POST', `/api/acessos/usuarios/${dados.biaId}/redefinir`, {}],
      ['POST', `/api/equipe/${dados.biaId}/senha`, { senha: 'OutraSenha2026!' }],
      ['POST', `/api/acessos/usuarios/${dados.carlaId}/desativar`, {}],
    ] as const) {
      const r = await pedir(dados.ana, m, u, b);
      expect([403, 404], `${m} ${u}: ${r.s} ${r.t}`).toContain(r.s);
    }
    const eu = JSON.parse((await pedir(dados.ana, 'GET', '/api/auth/eu')).t);
    expect(eu).toMatchObject({ papel: 'atendente', unidades: ['sumare'] });
    expect(eu.permissoes).toMatchObject({ conversas: 'minhas', conexoes: false, equipe: false, exportar: false, apagar_conversas: false });
    // E-mail e telefone de colegas não saem em nenhuma rota que ela alcança (só o nome, no chat da equipe).
    for (const [m, rota] of rotas) {
      if (m !== 'GET' || rota.includes(':')) continue;
      const t = (await pedir(dados.ana, 'GET', rota)).t;
      expect(t, rota).not.toMatch(/bia\.sumare@t\.com|carla\.norte@t\.com|bruno@teste\.com/);
    }
    expect((await pedir(dados.ana, 'GET', '/api/equipe')).s).toBe(403);
    expect((await pedir(dados.ana, 'GET', '/api/acessos/usuarios')).s).toBe(403);
  }, 60_000);

  it('simulador de cliente: só nas unidades dela; anúncio só com endereço http(s) (javascript: viraria link na Origem)', async () => {
    expect((await pedir(dados.ana, 'POST', '/api/teste/cliente', { unidade: 'norte', nome: 'Falsa', telefone: '5599900000077', texto: 'oi' })).s).toBe(403);
    expect((await pedir(dados.ana, 'POST', '/api/teste/cliente', { unidade: 'sumare', nome: 'Teste Dela', telefone: '5599900000078', texto: 'oi' })).s).toBe(200);
    const anuncio = (url: string) => pedir(dados.admin, 'POST', '/api/teste/cliente', { unidade: 'sumare', nome: 'Anúncio', telefone: '5599900000079', texto: 'oi', anuncio: { titulo: 'x', url } });
    expect((await anuncio('javascript:alert(document.cookie)')).s).toBe(400);
    expect((await anuncio('data:text/html,<script>alert(1)</script>')).s).toBe(400);
    expect((await anuncio('https://fb.me/anuncio')).s).toBe(200);
  });

  it('conferir duplicata pelo e-mail não entrega o telefone de um contato de outra unidade', async () => {
    expect(JSON.parse((await pedir(dados.ana, 'GET', '/api/leads/conferir?email=norte.ficha@t.com')).t).duplicata).toEqual({ telefone: null, motivo: 'email' });
    expect(JSON.parse((await pedir(dados.admin, 'GET', '/api/leads/conferir?email=norte.ficha@t.com')).t).duplicata).toEqual({ telefone: TEL_NORTE, motivo: 'email' });
  });

  it('arquivo enviado como "imagem" do bot (SVG/XHTML com script) não roda no endereço do app', async () => {
    const enviar = async (nome: string, mimetype: string, conteudo: string) => {
      const r = await pedir(dados.admin, 'POST', '/api/bots/midias', { nome, mimetype, base64: Buffer.from(conteudo).toString('base64') });
      expect(r.s, r.t).toBe(201);
      return pedir(dados.admin, 'GET', JSON.parse(r.t).url as string);
    };
    for (const [nome, tipo] of [['a.svg', 'image/svg+xml'], ['a.xhtml', 'application/xhtml+xml']] as const) {
      const r = await enviar(nome, tipo, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      expect(r.h.get('content-type'), tipo).toBe('application/octet-stream');
      expect(r.h.get('content-disposition')).toMatch(/^attachment;/);
      expect(r.h.get('content-security-policy')).toContain('sandbox');
    }
    const png = await enviar('a.png', 'image/png', 'png');
    expect(png.h.get('content-type')).toBe('image/png');
    expect(png.h.get('content-disposition')).toMatch(/^inline;/);
    expect(png.h.get('content-security-policy')).toContain('sandbox');
    // E a atendente nem envia arquivo de bot.
    expect((await pedir(dados.ana, 'POST', '/api/bots/midias', { nome: 'a.png', mimetype: 'image/png', base64: 'cG5n' })).s).toBe(403);
  });

  it('câmera e microfone liberados só no app; páginas públicas e login sem', async () => {
    for (const url of ['/entrar', '/', '/api/auth/eu', '/esqueci-senha']) {
      const pp = (await pedir('', 'GET', url)).h.get('permissions-policy') ?? '';
      expect(pp, url).toContain('camera=()');
      expect(pp, url).toContain('microphone=()');
    }
    const app = await pedir(dados.ana, 'GET', '/app/conversas');
    expect(app.s).toBe(200);
    expect(app.h.get('permissions-policy')).toContain('microphone=(self)');
    expect(app.h.get('x-frame-options')).toBeTruthy();
  });
});
