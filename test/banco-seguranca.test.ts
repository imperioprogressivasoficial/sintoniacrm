import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria } from '../src/auth/contas.js';
import { LIMITES_LOGIN } from '../src/auth/limite-login.js';
import { gerarHash } from '../src/auth/senha.js';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { importarLink } from '../src/agentes-ia/importar.js';
import { buscarSeguro, ErroDestino } from '../src/integracoes/ssrf.js';
import { chaveTelefone } from '../src/leads/telefone-br.js';
import { AuditoriaMemoria, AuditoriaPostgres, resumoCliente } from '../src/seguranca/auditoria.js';
import { DadosCliente, NOME_ANONIMO, TEXTO_APAGADO } from '../src/seguranca/dados-cliente.js';
import { LIMITES_SENSIVEIS, modoCsp, politicaCsp } from '../src/seguranca/protecao.js';
import { criarServidor, type DependenciasServidor } from '../src/server.js';
import { migrar, separarComandos } from '../src/store/migrar.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';

async function montar(o: { repo?: Repositorio; extras?: Partial<DependenciasServidor> } = {}) {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash(SENHA);
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = o.repo ?? new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const auditoria = new AuditoriaMemoria();
  const app = criarServidor({ sintonia, repo, auth: { contas }, ...o.extras, protecao: { empresaId: 'imperio', auditoria, ...o.extras?.protecao } });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: SENHA } })).headers['set-cookie']).split(';')[0]!;
  return { app, repo, contas, auditoria, entrar };
}

// ------------------------------------------------------------------------------------------------ migrações seguras
describe('Migrações seguras para o banco no ar', () => {
  it('separa os comandos sem quebrar texto, nomes entre aspas, blocos $$ e comentários', () => {
    const sql = `-- sintonia: sem-transacao
create index concurrently if not exists a on t (x); -- comentário; com ponto e vírgula
insert into t values ('a;b', 'it''s');
do $$ begin perform 1; perform 2; end $$;
/* bloco; de comentário */ select "co;luna" from t;
create function f() returns int language sql as $corpo$ select 1; $corpo$`;
    const c = separarComandos(sql);
    expect(c).toHaveLength(5);
    expect(c[1]).toBe("insert into t values ('a;b', 'it''s')");
    expect(c[2]).toBe('do $$ begin perform 1; perform 2; end $$');
    expect(c[3]).toContain('"co;luna"');
    expect(c[4]).toContain('$corpo$ select 1; $corpo$');
  });

  it.runIf(temPostgres)('arquivo "sem-transacao" cria índice concurrently e refaz um índice que ficou pela metade', async () => {
    const pool = await poolDeTeste();
    const pasta = mkdtempSync(path.join(tmpdir(), 'migr-'));
    try {
      await pool.query('drop table if exists sintonia.teste_migr cascade');
      await pool.query('create table sintonia.teste_migr (x int)');
      await pool.query('insert into sintonia.teste_migr values (1), (1), (2)');
      // Índice único com repetidos: o Postgres deixa um índice inválido (é o que sobra de uma queda no meio).
      await pool.query('create unique index concurrently teste_migr_x on sintonia.teste_migr (x)').catch(() => {});
      const { rows: antes } = await pool.query("select indisvalid from pg_index where indexrelid = 'sintonia.teste_migr_x'::regclass");
      expect(antes[0]?.indisvalid).toBe(false);
      writeFileSync(path.join(pasta, '900_teste_a.sql'), 'set local search_path to sintonia;\nalter table teste_migr add column if not exists y text;');
      writeFileSync(
        path.join(pasta, '901_teste_b.sql'),
        "-- sintonia: sem-transacao\ncreate index concurrently if not exists teste_migr_x on sintonia.teste_migr (x);\ndo $$ begin update sintonia.teste_migr set y = 'ok'; commit; end $$;",
      );
      const aplicadas = await migrar(pool, pathToFileURL(pasta + '/'));
      expect(aplicadas).toEqual(['900_teste_a.sql', '901_teste_b.sql']);
      const { rows: depois } = await pool.query("select indisvalid, indisunique from pg_index where indexrelid = 'sintonia.teste_migr_x'::regclass");
      expect(depois[0]).toEqual({ indisvalid: true, indisunique: false });
      expect((await pool.query("select count(*)::int as n from sintonia.teste_migr where y = 'ok'")).rows[0].n).toBe(3);
      // De novo: nada para aplicar.
      expect(await migrar(pool, pathToFileURL(pasta + '/'))).toEqual([]);
    } finally {
      await pool.query("delete from sintonia.migracoes where versao like '90%_teste_%'");
      await pool.query('drop table if exists sintonia.teste_migr cascade');
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});

// ------------------------------------------------------------------------------------------------ banco organizado
describe.runIf(temPostgres)('Banco organizado (630/631)', () => {
  it('telefone normalizado no banco é igual ao do código (chaveTelefone)', async () => {
    const pool = await poolDeTeste();
    const exemplos = ['+55 (71) 98812-4471', '71 8812-4471', '5571988124471', '071988124471', '0 41 71 98812 4471', '(71) 3333-4444', '0055 71 98812 4471', '988124471', '+1 415 555 0100', '55 00 98812 4471', '12345', '7188124471', '55718812447'];
    const { rows } = await pool.query<{ t: string; chave: string }>('select t, sintonia.telefone_chave(t) as chave from unnest($1::text[]) t', [exemplos]);
    for (const r of rows) expect([r.t, r.chave]).toEqual([r.t, chaveTelefone(r.t)]);
    const { rows: s } = await pool.query("select sintonia.telefone_chave('ig:12345') as ig, sintonia.telefone_chave('anonimo-abc') as anon, sintonia.telefone_chave('') as vazio");
    expect(s[0]).toEqual({ ig: 'ig:12345', anon: null, vazio: null });
  });

  it('preenche o telefone normalizado sozinho e mostra possíveis duplicatas sem juntar nada', async () => {
    const pool = await poolDeTeste();
    const repo = new RepositorioPostgres(pool);
    const agora = new Date();
    const a = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'c1', telefone: '5571988124471', nome: 'Maria', agora })).conversa;
    const b = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'c2', telefone: '5571988124471', nome: 'Maria S.', agora })).conversa;
    await pool.query("insert into sintonia.contatos (empresa_id, telefone, nome) values ('imperio', '71 8812-4471', 'Maria da Silva')");
    const { rows: ch } = await pool.query('select telefone_chave from sintonia.conversas where id = any($1::uuid[])', [[a.id, b.id]]);
    expect(ch.map((r) => r.telefone_chave)).toEqual(['5571988124471', '5571988124471']);
    const { rows: dup } = await pool.query("select * from sintonia.possiveis_duplicatas where empresa_id = 'imperio' and telefone_chave = '5571988124471'");
    expect(dup).toHaveLength(1);
    expect(dup[0].motivo).toBe('mesmo número escrito de jeitos diferentes');
    expect(dup[0].telefones.sort()).toEqual(['5571988124471', '71 8812-4471']);
    expect(dup[0].unidades).toEqual(['norte', 'sumare']);
    expect((await pool.query('select count(*)::int as n from sintonia.conversas')).rows[0].n).toBe(2); // nada foi juntado
    // Trocar o telefone recalcula a chave.
    await pool.query("update sintonia.conversas set telefone = '5571999990000' where id = $1", [b.id]);
    expect((await pool.query('select telefone_chave from sintonia.conversas where id = $1', [b.id])).rows[0].telefone_chave).toBe('5571999990000');
  });

  it('datas de criação/alteração novas e ligação com a conversa (apagar a conversa leva o histórico dela)', async () => {
    const pool = await poolDeTeste();
    const repo = new RepositorioPostgres(pool);
    const c = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'c1', telefone: '5571988120000', nome: 'Ana', agora: new Date() })).conversa;
    await pool.query('insert into sintonia.followup_pausas (conversa_id) values ($1)', [c.id]);
    await pool.query("insert into sintonia.memoria_cliente (empresa_id, telefone, chave, valor, conversa_id) values ('imperio', '5571988120000', 'cor', 'azul', $1)", [c.id]);
    // Ligação nova recusa conversa que não existe.
    await expect(pool.query("insert into sintonia.memoria_cliente (empresa_id, telefone, chave, valor, conversa_id) values ('imperio', '1', 'x', 'y', '00000000-0000-4000-8000-00000000abcd')")).rejects.toThrow(/foreign key|chave estrangeira/i);
    await pool.query('delete from sintonia.conversas where id = $1', [c.id]);
    expect((await pool.query('select count(*)::int as n from sintonia.followup_pausas where conversa_id = $1', [c.id])).rows[0].n).toBe(0);
    const mem = (await pool.query("select conversa_id from sintonia.memoria_cliente where empresa_id = 'imperio' and telefone = '5571988120000'")).rows;
    expect(mem).toEqual([{ conversa_id: null }]); // a memória fica, sem a ligação
    // Gatilho de "atualizado_em" numa tabela que não guardava quando mudou.
    await pool.query("insert into sintonia.campos_contato (id, empresa_id, nome, tipo) values (gen_random_uuid(), 'imperio', 'Cor', 'texto')");
    const antes = (await pool.query("select atualizado_em from sintonia.campos_contato where nome = 'Cor'")).rows[0].atualizado_em as Date;
    await new Promise((r) => setTimeout(r, 20));
    await pool.query("update sintonia.campos_contato set nome = 'Cor favorita' where nome = 'Cor'");
    const depois = (await pool.query("select atualizado_em from sintonia.campos_contato where nome = 'Cor favorita'")).rows[0].atualizado_em as Date;
    expect(depois.getTime()).toBeGreaterThan(antes.getTime());
    // Ligações validadas onde não havia nada solto; e a vista de órfãos responde.
    expect((await pool.query("select bool_and(convalidated) as ok from pg_constraint where conname like '%\\_conversa\\_fk'")).rows[0].ok).toBe(true);
    expect((await pool.query('select count(*)::int as n from sintonia.orfaos')).rows[0].n).toBeGreaterThan(5);
  });

  it('auditoria só acrescenta: alterar ou apagar uma linha é recusado', async () => {
    const pool = await poolDeTeste();
    const a = new AuditoriaPostgres(pool);
    await a.registrar({ empresaId: 'teste-audit', acao: 'entrou', autorNome: 'Bruno', detalhe: { email: 'b@x.com' } });
    const [l] = await a.listar('teste-audit');
    expect(l).toMatchObject({ acao: 'entrou', autorNome: 'Bruno', detalhe: { email: 'b@x.com' } });
    await expect(pool.query("update sintonia.auditoria set acao = 'x' where empresa_id = 'teste-audit'")).rejects.toThrow(/não pode ser alterado/);
    await expect(pool.query("delete from sintonia.auditoria where empresa_id = 'teste-audit'")).rejects.toThrow(/não pode ser alterado/);
  });
});

// ------------------------------------------------------------------------------------------------ LGPD
describe.runIf(temPostgres)('LGPD: exportar e apagar os dados de um cliente', () => {
  async function cenario() {
    const pool = await poolDeTeste();
    const repo = new RepositorioPostgres(pool);
    const agora = new Date();
    const a = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'c1', telefone: '5571988124471', nome: 'Maria Cliente', agora })).conversa;
    const b = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'c2', telefone: '557188124471', nome: 'Maria', agora })).conversa;
    const outra = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'c1', telefone: '5571999998888', nome: 'Outra Pessoa', agora })).conversa;
    await repo.adicionarMensagem({ conversaId: a.id, autor: 'cliente', texto: 'Meu CPF é 123.456.789-00', em: agora, idExterno: 'x1' });
    await repo.adicionarMensagem({ conversaId: b.id, autor: 'equipe', autorNome: 'Carla', texto: 'Oi Maria, tudo bem?', em: agora });
    await repo.adicionarMensagem({ conversaId: outra.id, autor: 'cliente', texto: 'Mensagem de outra pessoa', em: agora });
    await pool.query("insert into sintonia.contatos (empresa_id, telefone, nome, email) values ('imperio', '5571988124471', 'Maria Cliente', 'maria@exemplo.com')");
    await pool.query("insert into sintonia.memoria_cliente (empresa_id, telefone, chave, valor, conversa_id) values ('imperio', '5571988124471', 'alergia', 'amônia', $1)", [a.id]);
    return { pool, repo, a, b, outra };
  }

  it('exporta tudo (todas as unidades, ficha e memória) e só a gestão pode', async () => {
    const { pool, repo, a, b } = await cenario();
    const { app, entrar, auditoria } = await montar({ repo, extras: { protecao: { dadosCliente: new DadosCliente(pool) } } });
    const carla = await entrar('carla@imperio.com');
    expect((await app.inject({ url: '/api/lgpd/cliente/exportar?telefone=71988124471', headers: { cookie: carla } })).statusCode).toBe(403);
    const bruno = await entrar('bruno@imperio.com');
    const quem = (await app.inject({ url: '/api/lgpd/cliente?telefone=(71)%2098812-4471', headers: { cookie: bruno } })).json();
    expect(quem.conversas.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id].sort());
    const r = await app.inject({ url: '/api/lgpd/cliente/exportar?telefone=%2B55%2071%2098812-4471', headers: { cookie: bruno } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="dados-cliente-/);
    const j = r.json();
    expect(j.tabelas.conversas).toHaveLength(2);
    expect(j.tabelas.mensagens.map((m: { texto: string }) => m.texto).sort()).toEqual(['Meu CPF é 123.456.789-00', 'Oi Maria, tudo bem?']);
    expect(JSON.stringify(j)).not.toContain('outra pessoa');
    expect(j.tabelas.contatos[0]).toMatchObject({ email: 'maria@exemplo.com' });
    expect(j.tabelas.memoria_cliente[0]).toMatchObject({ valor: 'amônia' });
    const reg = auditoria.linhas.find((l) => l.acao.startsWith('exportou dados de um cliente'));
    expect(reg).toMatchObject({ autorNome: 'Bruno', alvo: resumoCliente('5571988124471') });
    expect(JSON.stringify(auditoria.linhas)).not.toContain('988124471');
  });

  it('anonimiza a pedido: some o que identifica, ficam os números do negócio; pede a palavra APAGAR', async () => {
    const { pool, repo, a, b, outra } = await cenario();
    const { app, entrar, auditoria } = await montar({ repo, extras: { protecao: { dadosCliente: new DadosCliente(pool) } } });
    const bruno = await entrar('bruno@imperio.com');
    const sem = await app.inject({ method: 'POST', url: '/api/lgpd/cliente/anonimizar', headers: { cookie: bruno }, payload: { telefone: '71988124471', confirmar: 'sim' } });
    expect(sem.statusCode).toBe(400);
    const carla = await entrar('carla@imperio.com');
    expect((await app.inject({ method: 'POST', url: '/api/lgpd/cliente/anonimizar', headers: { cookie: carla }, payload: { telefone: '71988124471', confirmar: 'APAGAR' } })).statusCode).toBe(403);
    const r = await app.inject({ method: 'POST', url: '/api/lgpd/cliente/anonimizar', headers: { cookie: bruno }, payload: { conversaId: a.id, confirmar: 'APAGAR' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, conversas: 2 });
    const convs = (await pool.query('select id, nome, telefone, unidade, etapa from sintonia.conversas where id = any($1::uuid[])', [[a.id, b.id]])).rows;
    for (const c of convs) {
      expect(c.nome).toBe(NOME_ANONIMO);
      expect(c.telefone).toMatch(/^anonimo-[0-9a-f]{32}$/);
      expect(c.etapa).toBeTruthy(); // os números do negócio ficam
    }
    const textos = (await pool.query('select texto, autor_nome from sintonia.mensagens where conversa_id = any($1::uuid[])', [[a.id, b.id]])).rows;
    expect(textos.every((m) => m.texto === TEXTO_APAGADO)).toBe(true);
    expect((await pool.query("select count(*)::int as n from sintonia.contatos where empresa_id = 'imperio' and telefone = '5571988124471'")).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int as n from sintonia.memoria_cliente where telefone = '5571988124471'")).rows[0].n).toBe(0);
    // A outra pessoa não foi tocada.
    expect((await repo.mensagens(outra.id))[0]!.texto).toBe('Mensagem de outra pessoa');
    expect(auditoria.linhas.find((l) => l.acao.startsWith('apagou dados de um cliente'))).toMatchObject({ autorNome: 'Bruno', alvo: resumoCliente('5571988124471') });
    // Depois disso, ninguém mais acha esse telefone.
    expect((await app.inject({ url: '/api/lgpd/cliente/exportar?telefone=5571988124471', headers: { cookie: bruno } })).statusCode).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------ servidor
describe('Proteções do servidor', () => {
  it('cabeçalhos de segurança em toda resposta; CSP só relatório por padrão', async () => {
    const { app } = await montar();
    const r = await app.inject({ url: '/entrar' });
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(r.headers['permissions-policy']).toContain('geolocation=()');
    expect(r.headers['content-security-policy-report-only']).toBe(politicaCsp());
    expect(r.headers['content-security-policy']).toBeUndefined();
    expect(r.headers['strict-transport-security']).toBeUndefined(); // sem HTTPS (teste local)
    const api = await app.inject({ url: '/api/auth/eu', headers: { 'x-forwarded-proto': 'https' } });
    expect(api.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(api.headers['x-content-type-options']).toBe('nosniff');
    // Aviso da CSP é aceito sem login.
    const aviso = await app.inject({ method: 'POST', url: '/seguranca/csp', headers: { 'content-type': 'application/csp-report' }, payload: JSON.stringify({ 'csp-report': { 'document-uri': 'https://x/app', 'violated-directive': 'img-src', 'blocked-uri': 'https://y' } }) });
    expect(aviso.statusCode).toBe(204);
  });

  it('CSP de verdade só com SINTONIA_CSP=bloquear; página de agendamento pode ir dentro de outro site', async () => {
    expect(modoCsp(undefined)).toBe('relatorio');
    expect(modoCsp('bloquear')).toBe('bloquear');
    expect(modoCsp('0')).toBe('desligado');
    const { app } = await montar({ extras: { protecao: { csp: 'bloquear', https: true } } });
    const r = await app.inject({ url: '/entrar' });
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(r.headers['strict-transport-security']).toContain('max-age=');
    expect(politicaCsp({ embutivel: true })).not.toContain('frame-ancestors');
  });

  it('recusa caminho com ../ (não lê arquivos fora da pasta pública)', async () => {
    const { app, entrar } = await montar();
    const bruno = await entrar('bruno@imperio.com');
    for (const url of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/app/../../package.json', '/vendas/..%2f..%2f.env', '/estilo.css/..%2f..%2fsrc%2fconfig.ts', '/app/..%2f..%2fdb%2fmigrations%2f001_base.sql']) {
      const r = await app.inject({ url, headers: { cookie: bruno } });
      expect(r.body).not.toContain('"dependencies"');
      expect(r.body).not.toContain('root:');
      expect(r.body).not.toContain('create table');
      expect(r.body).not.toContain('DATABASE_URL');
    }
    const midia = await app.inject({ url: '/api/conversas/00000000-0000-4000-8000-000000000001/midias/..%2f..%2fetc%2fpasswd', headers: { cookie: bruno } });
    expect(midia.statusCode).toBe(404);
  });

  it('pedido que muda dados vindo de outro site é recusado', async () => {
    const { app, entrar } = await montar();
    const bruno = await entrar('bruno@imperio.com');
    const fora = await app.inject({ method: 'POST', url: '/api/auth/sair', headers: { cookie: bruno, origin: 'https://site-malicioso.com', host: 'sintonia.exemplo' } });
    expect(fora.statusCode).toBe(403);
    const daqui = await app.inject({ method: 'POST', url: '/api/auth/sair', headers: { cookie: bruno, origin: 'https://sintonia.exemplo', host: 'sintonia.exemplo' } });
    expect(daqui.statusCode).toBe(200);
  });

  it('login: muitas senhas erradas bloqueiam (429) e ficam na auditoria, sem a senha', async () => {
    const { app, auditoria } = await montar();
    const codigos: number[] = [];
    for (let i = 0; i < LIMITES_LOGIN.par.erros + 1; i++) {
      codigos.push((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: 'errada-' + i } })).statusCode);
    }
    expect(codigos.slice(0, LIMITES_LOGIN.par.erros)).toEqual(Array(LIMITES_LOGIN.par.erros).fill(401));
    expect(codigos.at(-1)).toBe(429);
    // Nem a senha certa entra enquanto está bloqueado.
    expect((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email: 'carla@imperio.com', senha: SENHA } })).statusCode).toBe(429);
    await new Promise((r) => setTimeout(r, 10));
    expect(auditoria.linhas.filter((l) => l.acao === 'senha errada')).toHaveLength(LIMITES_LOGIN.par.erros);
    expect(auditoria.linhas.some((l) => l.acao.startsWith('acesso bloqueado'))).toBe(true);
    expect(JSON.stringify(auditoria.linhas)).not.toContain('errada-');
  });

  it('auditoria de ações sensíveis: entrar e trocar a senha; só a gestão lê o registro', async () => {
    const { app, entrar, auditoria } = await montar();
    const bruno = await entrar('bruno@imperio.com');
    const carla = await entrar('carla@imperio.com');
    expect((await app.inject({ method: 'POST', url: '/api/auth/senha', headers: { cookie: carla }, payload: { atual: SENHA, nova: 'OutraSenha2026x' } })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(auditoria.linhas.map((l) => l.acao)).toEqual(expect.arrayContaining(['entrou', 'trocou a própria senha']));
    expect(JSON.stringify(auditoria.linhas)).not.toContain('OutraSenha2026x');
    // A sessão de quem trocou a senha continua (as outras dela são encerradas); só a gestão lê o registro.
    expect((await app.inject({ url: '/api/seguranca/auditoria', headers: { cookie: carla } })).statusCode).toBe(403);
    const lista = (await app.inject({ url: '/api/seguranca/auditoria', headers: { cookie: bruno } })).json();
    expect(lista.registros[0]).toMatchObject({ acao: 'trocou a própria senha', autorNome: 'Carla' });
  });

  it('limite de exportações por pessoa', async () => {
    const { app, entrar } = await montar();
    const bruno = await entrar('bruno@imperio.com');
    let ultimo = 0;
    for (let i = 0; i <= LIMITES_SENSIVEIS.exportar.maximo; i++) ultimo = (await app.inject({ method: 'POST', url: '/api/leads/exportar', headers: { cookie: bruno }, payload: {} })).statusCode;
    expect(ultimo).toBe(429);
  });

  it('webhook da Evolution sem o token certo é recusado', async () => {
    const repo = new RepositorioMemoria();
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const canal = { lerWebhook: () => [] } as unknown as import('../src/channels/tipos.js').CanalWhatsApp;
    const app = criarServidor({ sintonia, repo, evolution: { canal, token: 'segredo-do-webhook-123' } });
    const corpo = { event: 'messages.upsert', instance: 'x', data: {} };
    expect((await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: corpo })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: corpo, headers: { 'x-sintonia-token': 'errado' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: corpo, headers: { 'x-sintonia-token': 'segredo-do-webhook-123' } })).statusCode).toBe(200);
  });
});

// ------------------------------------------------------------------------------------------------ chaves e SSRF
describe('Chaves cifradas e downloads seguros', () => {
  it('chave gravada sem cifra (formato antigo) é lida e regravada cifrada (AES-GCM), sem perder nada', async () => {
    const armazem = new ArmazemMemoria();
    armazem.dados.set('anthropicApiKey', 'sk-ant-antiga-123');
    armazem.dados.set('evolutionUrl', 'https://evo.exemplo');
    const cofre = new Cofre('segredo-do-servidor');
    const c = new Conexoes(armazem, cofre);
    await c.carregar();
    expect(c.get('anthropicApiKey')).toBe('sk-ant-antiga-123');
    expect(c.get('evolutionUrl')).toBe('https://evo.exemplo');
    expect(armazem.dados.get('anthropicApiKey')).toMatch(/^v1\./);
    expect(armazem.dados.get('anthropicApiKey')).not.toContain('sk-ant');
    expect(cofre.decifrar(armazem.dados.get('anthropicApiKey')!)).toBe('sk-ant-antiga-123');
    // Lendo de novo (já cifrada), o valor é o mesmo.
    const d = new Conexoes(armazem, cofre);
    await d.carregar();
    expect(d.get('anthropicApiKey')).toBe('sk-ant-antiga-123');
  });

  it('não baixa endereço da rede interna (banco, Evolution, metadados), nem por redirecionamento', async () => {
    const chamados: string[] = [];
    const fetchFn = (async (u: URL | string) => {
      chamados.push(String(u));
      if (String(u).includes('redireciona')) return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      return new Response('<title>Ok</title><p>Texto da página</p>', { status: 200 });
    }) as typeof fetch;
    for (const u of ['http://127.0.0.1:5432/', 'http://sintonia-db:5432/', 'http://evolution:8080/instance', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://0x7f.1/', 'file:///etc/passwd']) {
      await expect(buscarSeguro(u, {}, { fetchFn })).rejects.toThrow();
    }
    await expect(buscarSeguro('https://site.exemplo.com/redireciona', {}, { fetchFn })).rejects.toBeInstanceOf(ErroDestino);
    expect(chamados).toEqual(['https://site.exemplo.com/redireciona']);
    await expect(buscarSeguro('https://8.8.8.8/x', {}, { fetchFn, resolver: async () => ['10.0.0.5'] })).resolves.toBeTruthy(); // IP público direto
    await expect(buscarSeguro('https://interno.exemplo.com/x', {}, { fetchFn, resolver: async () => ['10.0.0.5'] })).rejects.toBeInstanceOf(ErroDestino);
    // Importar conhecimento de um link: recusa a rede interna, aceita site público.
    await expect(importarLink('http://sintonia-db:5432/', fetchFn)).rejects.toThrow(/link público/);
    expect((await importarLink('https://site.exemplo.com/pagina', fetchFn)).titulo).toBe('Ok');
  });
});
