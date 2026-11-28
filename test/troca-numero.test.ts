import { describe, expect, it } from 'vitest';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { FonteComercialMemoria, FonteComercialPostgres } from '../src/comercial/fonte.js';
import {
  ArmazemNumerosMemoria,
  ArmazemNumerosPostgres,
  LimpezaNumeroMemoria,
  LimpezaNumeroPostgres,
  TrocaNumero,
  type Quem,
} from '../src/conexoes/troca-numero.js';
import { AuditoriaMemoria } from '../src/seguranca/auditoria.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { sqlEscopo } from '../src/painel/escopo-sql.js';
import { fabricas, poolDeTeste, temPostgres } from './repos.js';

const EMPRESA = 'imperio';
const CANAL = 'sintonia-norte';
const ADMIN: Quem = { id: null, nome: 'Bruno', papel: 'admin' };
const ATENDENTE: Quem = { id: null, nome: 'Carla', papel: 'atendente' };
const t = (h: number) => new Date(Date.UTC(2026, 10, 20, h));
const NUMERO_VELHO = '5571999990000';
const NUMERO_NOVO = '5571988887777';

function montar(repo: Repositorio, relogio = { agora: t(10) }) {
  const auditoria = new AuditoriaMemoria();
  const limpeza = repo instanceof RepositorioPostgres ? new LimpezaNumeroPostgres(repo.pool) : new LimpezaNumeroMemoria(repo as RepositorioMemoria);
  const armazem = repo instanceof RepositorioPostgres ? new ArmazemNumerosPostgres(repo.pool) : new ArmazemNumerosMemoria();
  const troca = new TrocaNumero({
    empresaId: EMPRESA,
    armazem,
    limpeza,
    auditoria,
    canais: () => [{ canalId: CANAL, unidade: 'norte' }],
    agora: () => relogio.agora,
    lote: 2,
    pausa: async () => {},
  });
  return { troca, auditoria, relogio };
}

/** Conversa com mensagens nas horas dadas. */
async function conversa(repo: Repositorio, o: { telefone: string; unidade?: string; canal?: string; criada: Date; msgs: Date[]; midia?: boolean }) {
  const { conversa: c } = await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: o.unidade ?? 'norte', canalId: o.canal ?? CANAL, telefone: o.telefone, nome: `Cliente ${o.telefone.slice(-4)}`, agora: o.criada });
  for (const [i, em] of o.msgs.entries()) {
    await repo.adicionarMensagem({ conversaId: c.id, autor: 'cliente', texto: `oi ${i}`, idExterno: `${o.telefone}-${i}-${em.getTime()}`, em, ...(o.midia && i === 0 ? { anexo: { tipo: 'imagem', situacao: 'pendente' } } : {}) });
  }
  return c;
}

/** Cenário: Norte com 3 conversas do número velho, 1 que já falou com o número novo, 1 da Sumaré. */
async function cenario(repo: Repositorio) {
  const velha1 = await conversa(repo, { telefone: '5571911110001', criada: t(1), msgs: [t(1), t(2)], midia: true });
  const velha2 = await conversa(repo, { telefone: '5571911110002', criada: t(2), msgs: [t(2), t(3), t(4)] });
  const velha3 = await conversa(repo, { telefone: '5571911110003', criada: t(3), msgs: [t(3)] });
  const sumare = await conversa(repo, { telefone: '5571911110004', unidade: 'sumare', canal: 'sintonia-sumare', criada: t(1), msgs: [t(1)] });
  const instagram = await conversa(repo, { telefone: '178000000001', canal: 'ig-123', criada: t(1), msgs: [t(1)] });
  return { velha1, velha2, velha3, sumare, instagram };
}

for (const fabrica of fabricas) {
  describe(`Troca de número (${fabrica.nome})`, () => {
    const criar = async () => {
      const repo = await fabrica.criar();
      if (repo instanceof RepositorioPostgres) await repo.pool.query('truncate sintonia.whatsapp_numeros');
      return repo;
    };
    it('detecta outro número no canal; o mesmo número de novo não pergunta nada', async () => {
      const repo = await criar();
      const { troca, relogio } = montar(repo);
      await cenario(repo);
      // Primeira vez que vê o canal conectado (ninguém pareando): só guarda o número.
      expect(await troca.observar(CANAL, 'norte', `${NUMERO_VELHO}@s.whatsapp.net`)).toBe(false);
      expect(await troca.situacao(CANAL, 'norte')).toBeNull();
      // Reconectou o mesmo número: nada.
      await troca.pareando(CANAL, 'norte');
      expect(await troca.observar(CANAL, 'norte', NUMERO_VELHO)).toBe(false);
      // Outro número.
      relogio.agora = t(5);
      expect(await troca.observar(CANAL, 'norte', NUMERO_NOVO)).toBe(true);
      const s = await troca.situacao(CANAL, 'norte');
      expect(s).toMatchObject({ numeroAnterior: NUMERO_VELHO, numeroNovo: NUMERO_NOVO, resumo: { conversas: 3, mensagens: 6, midias: 1 } });
      expect(s!.trocaEm).toEqual(t(5));
    });

    it('sem número guardado: pergunta só se alguém acabou de conectar e há conversas de antes', async () => {
      const repo = await criar();
      const { troca, relogio } = montar(repo);
      relogio.agora = t(5);
      // Canal sem conversas: nada a decidir.
      await troca.pareando('sintonia-cvazio', 'norte');
      expect(await troca.observar('sintonia-cvazio', 'norte', NUMERO_NOVO)).toBe(true);
      expect(await troca.situacao('sintonia-cvazio', 'norte')).toBeNull();
      // Canal da Norte com conversas antigas, número anterior desconhecido.
      await cenario(repo);
      await troca.pareando(CANAL, 'norte');
      expect(await troca.observar(CANAL, 'norte', NUMERO_NOVO)).toBe(true);
      expect(await troca.situacao(CANAL, 'norte')).toMatchObject({ numeroAnterior: null, resumo: { conversas: 3 } });
    });

    it('aviso de conexão da Evolution (connection.update com wuid) também guarda e compara o número', async () => {
      const repo = await criar();
      const { troca, relogio } = montar(repo);
      await cenario(repo);
      await troca.aoWebhook({ event: 'connection.update', instance: CANAL, data: { state: 'open', wuid: `${NUMERO_VELHO}@s.whatsapp.net` } });
      relogio.agora = t(5);
      await troca.aoWebhook({ event: 'CONNECTION_UPDATE', instance: CANAL, data: { state: 'open', wuid: `${NUMERO_NOVO}@s.whatsapp.net` } });
      expect((await troca.situacao(CANAL, 'norte'))?.numeroAnterior).toBe(NUMERO_VELHO);
      // Instância de fora da Sintonia: ignorada.
      await troca.aoWebhook({ event: 'connection.update', instance: 'assia', data: { state: 'open', wuid: '5571000000000@s.whatsapp.net' } });
    });

    it('Manter: tudo continua como está e a pergunta some', async () => {
      const repo = await criar();
      const { troca, relogio } = montar(repo);
      await cenario(repo);
      await troca.observar(CANAL, 'norte', NUMERO_VELHO);
      relogio.agora = t(5);
      await troca.observar(CANAL, 'norte', NUMERO_NOVO);
      await troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'manter', quem: ADMIN, origem: 'troca' });
      expect(await troca.situacao(CANAL, 'norte')).toBeNull();
      expect(await repo.listarConversas({ empresaId: EMPRESA })).toHaveLength(5);
    });

    it('Arquivar: some da lista e da busca para todo mundo, aparece em "Arquivadas do número antigo" e volta com mensagem nova', async () => {
      const repo = await criar();
      const { troca, relogio, auditoria } = montar(repo);
      const { velha1, velha2, velha3, sumare } = await cenario(repo);
      // Cliente da velha2 escreveu para o número novo depois da troca: fica de fora.
      await troca.observar(CANAL, 'norte', NUMERO_VELHO);
      relogio.agora = t(5);
      await troca.observar(CANAL, 'norte', NUMERO_NOVO);
      await repo.adicionarMensagem({ conversaId: velha2.id, autor: 'cliente', texto: 'oi número novo', idExterno: 'novo-1', em: t(6) });
      relogio.agora = t(7);
      // Atendente não decide.
      await expect(troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'arquivar', quem: ATENDENTE, origem: 'troca' })).rejects.toMatchObject({ statusCode: 403 });
      const r = await troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'arquivar', quem: ADMIN, origem: 'troca' });
      expect(r.arquivadas).toBe(2);
      const lista = (await repo.listarConversas({ empresaId: EMPRESA })).map((c) => c.id);
      expect(lista).not.toContain(velha1.id);
      expect(lista).not.toContain(velha3.id);
      expect(lista).toEqual(expect.arrayContaining([velha2.id, sumare.id]));
      // Por id (abrir a conversa) continua achando.
      expect((await repo.listarConversas({ ids: [velha1.id] }))[0]?.arquivadaEm).toEqual(t(7));
      // Lista de Conversas: fora; filtro das arquivadas: só elas.
      const pagina = await repo.paginaConversas({ escopo: { empresaId: EMPRESA }, limite: 50 });
      expect(pagina.conversas.map((c) => c.id)).not.toContain(velha1.id);
      const arq = await repo.paginaConversas({ escopo: { empresaId: EMPRESA }, limite: 50, arquivadas: true });
      expect(arq.conversas.map((c) => c.id).sort()).toEqual([velha1.id, velha3.id].sort());
      // Busca nas mensagens não traz as arquivadas.
      expect((await repo.buscarMensagens({ texto: 'oi 0', escopo: { empresaId: EMPRESA }, limite: 50 })).map((m) => m.conversaId)).not.toContain(velha1.id);
      expect(auditoria.linhas.at(-1)).toMatchObject({ acao: 'arquivou as conversas de um WhatsApp', alvo: CANAL, detalhe: { conversas: 2, unidade: 'norte' } });
      // A cliente escreveu de novo: volta para a lista.
      await repo.buscarOuCriarConversa({ empresaId: EMPRESA, unidade: 'norte', canalId: CANAL, telefone: velha1.telefone, agora: t(8) });
      expect((await repo.listarConversas({ empresaId: EMPRESA })).map((c) => c.id)).toContain(velha1.id);
      // Desarquivar à mão.
      expect(await repo.arquivarConversas(EMPRESA, [velha3.id], null)).toBe(1);
      expect((await repo.listarConversas({ empresaId: EMPRESA })).map((c) => c.id)).toContain(velha3.id);
    });

    it('Apagar: só as do número anterior desta loja; vendas ficam sem a conversa; auditoria registrada', async () => {
      const repo = await criar();
      const { troca, relogio, auditoria } = montar(repo);
      const { velha1, velha2, velha3, sumare, instagram } = await cenario(repo);
      await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: velha1.id, unidade: 'norte', em: t(2), dados: { valor: 120, servico: 'Progressiva', atendenteId: 'u1', atendente: 'Carla' } });
      await repo.registrarEvento({ tipo: 'equipe_respondeu', conversaId: velha1.id, unidade: 'norte', em: t(2), dados: { atendenteId: 'u1' } });
      await troca.observar(CANAL, 'norte', NUMERO_VELHO);
      relogio.agora = t(5);
      await troca.observar(CANAL, 'norte', NUMERO_NOVO);
      // Conversa nova (número novo) depois da troca: não sai. Nem a de outra loja que passou pelo mesmo canal.
      const nova = await conversa(repo, { telefone: '5571922220001', criada: t(6), msgs: [t(6)] });
      const outraLoja = await conversa(repo, { telefone: '5571922220002', unidade: 'sumare', criada: t(1), msgs: [t(1)] });
      relogio.agora = t(7);
      await expect(troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'apagar', quem: ATENDENTE, origem: 'troca', confirmacao: 'APAGAR' })).rejects.toMatchObject({ statusCode: 403 });
      await expect(troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'apagar', quem: ADMIN, origem: 'troca', confirmacao: 'sim' })).rejects.toMatchObject({ statusCode: 400 });
      const r = await troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'apagar', quem: ADMIN, origem: 'troca', confirmacao: 'apagar' });
      expect(r.trabalho).toMatchObject({ estado: 'apagando', total: { conversas: 3, mensagens: 6, midias: 1 } });
      await troca.ocioso();
      const fim = troca.trabalho(r.trabalho!.id)!;
      expect(fim).toMatchObject({ estado: 'pronto', feito: { conversas: 3, mensagens: 6, midias: 1 } });
      const ficaram = (await repo.listarConversas({ incluirArquivadas: true })).map((c) => c.id).sort();
      expect(ficaram).toEqual([sumare.id, instagram.id, nova.id, outraLoja.id].sort());
      for (const c of [velha1, velha2, velha3]) {
        expect(await repo.buscarConversa(c.id)).toBeUndefined();
        expect(await repo.mensagens(c.id)).toHaveLength(0);
      }
      expect(await repo.mensagens(sumare.id)).toHaveLength(1);
      // A venda continua (sem a conversa); o resto do histórico da conversa saiu.
      const ev = await repo.eventosEntre(t(0), t(23));
      expect(ev.filter((e) => e.tipo === 'equipe_respondeu')).toHaveLength(0);
      const venda = ev.find((e) => e.tipo === 'agendamento_equipe')!;
      expect(venda.conversaId).toBeUndefined();
      expect(venda.dados).toMatchObject({ valor: 120, empresaId: EMPRESA, conversaApagada: true });
      // E segue no comercial.
      const fonte = repo instanceof RepositorioPostgres ? new FonteComercialPostgres(repo.pool) : new FonteComercialMemoria(repo);
      const dados = await fonte.carregar(t(0), t(23), { empresaId: EMPRESA });
      expect(dados.vendas).toHaveLength(1);
      expect(dados.vendas[0]).toMatchObject({ valor: 120, unidade: 'norte', atendenteId: 'u1' });
      expect(auditoria.linhas.at(-1)).toMatchObject({ acao: 'apagou os dados de um WhatsApp', alvo: CANAL, autorNome: 'Bruno', papel: 'admin', detalhe: { unidade: 'norte', conversas: 3, mensagens: 6, midias: 1, terminou: true } });
      // A pergunta da troca já foi respondida.
      expect(await troca.situacao(CANAL, 'norte')).toBeNull();
    });

    it('"Apagar os dados deste WhatsApp": a qualquer hora, todas do canal (arquivadas também), nunca de outra loja', async () => {
      const repo = await criar();
      const { troca, relogio } = montar(repo);
      const { velha1, sumare, instagram } = await cenario(repo);
      await repo.arquivarConversas(EMPRESA, [velha1.id], t(4));
      relogio.agora = t(9);
      const d = await troca.dados(CANAL, 'norte');
      expect(d).toMatchObject({ resumo: { conversas: 3, mensagens: 6 }, arquivadas: 1, ativas: 2 });
      expect(d.aviso).toContain('7 dias');
      await expect(troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'apagar', quem: { papel: 'gerente' }, origem: 'tudo', confirmacao: 'APAGAR' })).rejects.toMatchObject({ statusCode: 403 });
      const r = await troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'apagar', quem: { papel: 'direcao', nome: 'Diretora' }, origem: 'tudo', confirmacao: 'APAGAR' });
      await troca.ocioso();
      expect(troca.trabalho(r.trabalho!.id)?.feito.conversas).toBe(3);
      expect((await repo.listarConversas({ incluirArquivadas: true })).map((c) => c.id).sort()).toEqual([sumare.id, instagram.id].sort());
    });
  });
}

describe.skipIf(!temPostgres)('Troca de número (Postgres): o que é só da conversa sai, o resto perde a ligação', () => {
  it('contatos, reuniões, tarefas, valores do cartão, tags, mídias', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.whatsapp_numeros, sintonia.reunioes, sintonia.rotina_tarefas, sintonia.cartao_valores restart identity cascade');
    const repo = new RepositorioPostgres(pool);
    const { troca, relogio } = montar(repo);
    const so = await conversa(repo, { telefone: '5571933330001', criada: t(1), msgs: [t(1)], midia: true });
    const dupla = await conversa(repo, { telefone: '5571933330002', criada: t(1), msgs: [t(1)] });
    // A mesma cliente também fala com a Sumaré: o contato dela fica.
    await conversa(repo, { telefone: '5571933330002', unidade: 'sumare', canal: 'sintonia-sumare', criada: t(1), msgs: [t(1)] });
    await pool.query(`insert into sintonia.contatos (empresa_id, telefone, nome) values ($1, $2, 'Só'), ($1, $3, 'Dupla')`, [EMPRESA, so.telefone, dupla.telefone]);
    await pool.query(`insert into sintonia.cartao_valores (conversa_id, valor) values ($1, 300)`, [so.id]);
    await pool.query('truncate sintonia.links_reuniao cascade');
    await pool.query(
      `insert into sintonia.links_reuniao (id, empresa_id, slug, titulo, duracao_min, dias, inicio, fim) values ('00000000-0000-4000-8000-000000000001', $1, 'troca', 'Avaliação', 30, '{1}', '09:00', '18:00')`,
      [EMPRESA],
    );
    await pool.query(
      `insert into sintonia.reunioes (id, link_id, empresa_id, nome, telefone, inicio, fim, status, conversa_id)
       values (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', $1, 'Só', $2, now(), now() + interval '30 minutes', 'marcada', $3)`,
      [EMPRESA, so.telefone, so.id],
    );
    await pool.query(
      `insert into sintonia.rotina_tarefas (id, empresa_id, titulo, responsavel_id, conversa_id) values (gen_random_uuid(), $1, 'Ligar para ela', 'u1', $2)`,
      [EMPRESA, so.id],
    );
    relogio.agora = t(5);
    const antes = await troca.dados(CANAL, 'norte');
    expect(antes.resumo).toMatchObject({ conversas: 2, mensagens: 2, midias: 1, contatos: 1 });
    const r = await troca.decidir({ canalId: CANAL, unidade: 'norte', acao: 'apagar', quem: ADMIN, origem: 'tudo', confirmacao: 'APAGAR' });
    await troca.ocioso();
    expect(troca.trabalho(r.trabalho!.id)).toMatchObject({ estado: 'pronto', feito: { conversas: 2, contatos: 1 } });
    const contatos = (await pool.query<{ telefone: string }>('select telefone from sintonia.contatos where empresa_id = $1', [EMPRESA])).rows.map((x) => x.telefone);
    expect(contatos).toEqual([dupla.telefone]);
    expect((await pool.query('select 1 from sintonia.cartao_valores where conversa_id = $1', [so.id])).rowCount).toBe(0);
    expect((await pool.query('select 1 from sintonia.midias')).rowCount).toBe(0);
    const reuniao = await pool.query<{ conversa_id: string | null }>('select conversa_id from sintonia.reunioes where telefone = $1', [so.telefone]);
    expect(reuniao.rows).toEqual([{ conversa_id: null }]);
    const tarefa = await pool.query<{ conversa_id: string | null }>(`select conversa_id from sintonia.rotina_tarefas where titulo = 'Ligar para ela'`);
    expect(tarefa.rows).toEqual([{ conversa_id: null }]);
    // Nada solto.
    const orfaos = await pool.query<{ tabela: string; linhas: string }>(`select tabela, linhas from sintonia.orfaos where linhas > 0 and tabela not like '%sem empresa%'`);
    expect(orfaos.rows).toEqual([]);
  });

  it('relatórios e Pipeline (sqlEscopo) deixam as arquivadas de fora; o comercial mantém as vendas', async () => {
    const pool = await poolDeTeste();
    const repo = new RepositorioPostgres(pool);
    const a = await conversa(repo, { telefone: '5571944440001', criada: t(1), msgs: [t(1)] });
    const b = await conversa(repo, { telefone: '5571944440002', criada: t(1), msgs: [t(1)] });
    await repo.registrarEvento({ tipo: 'agendamento_ia', conversaId: a.id, unidade: 'norte', em: t(2), dados: { valor: 50 } });
    await repo.arquivarConversas(EMPRESA, [a.id], t(3));
    const p: unknown[] = [];
    const { rows } = await pool.query<{ id: string }>(`select c.id from sintonia.conversas c where ${sqlEscopo({ empresaId: EMPRESA }, 'c', p)}`, p);
    expect(rows.map((r) => r.id)).toEqual([b.id]);
    const vendas = (await new FonteComercialPostgres(pool).carregar(t(0), t(23), { empresaId: EMPRESA })).vendas;
    expect(vendas.map((v) => v.conversaId)).toEqual([a.id]);
  });
});

// ---------------------------------------------------------------- rotas (Conexões e Conversas)

function evolutionFalsa(numero: { atual: string }) {
  const f = (async (url: string | URL | Request) => {
    const u = new URL(String(url));
    if (u.pathname === '/instance/fetchInstances') {
      return new Response(JSON.stringify([{ name: CANAL, connectionStatus: 'open', ownerJid: `${numero.atual}@s.whatsapp.net`, profileName: 'Norte' }]));
    }
    if (u.pathname.startsWith('/instance/connect/') || u.pathname === '/instance/create') return new Response(JSON.stringify({ base64: 'QR' }));
    return new Response('{}');
  }) as typeof fetch;
  return f;
}

async function montarServidor() {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: EMPRESA, nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: EMPRESA, nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await conexoes.carregar();
  await conexoes.salvar({ evolutionUrl: 'https://evo.exemplo', evolutionApiKey: 'k', numeros: JSON.stringify([{ canalId: CANAL, unidade: 'norte', nome: 'Norte' }]) }, 'teste');
  const repo = new RepositorioMemoria();
  const relogio = { agora: t(10) };
  const { troca, auditoria } = montar(repo, relogio);
  const numero = { atual: NUMERO_VELHO };
  const sintonia = new Sintonia({ empresaId: EMPRESA, repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const app = criarServidor({
    sintonia,
    repo,
    auth: { contas },
    conexoes: { conexoes, fetchFn: evolutionFalsa(numero), trocaNumero: troca, testarIA: async () => {}, testarTrinks: async () => ({ resumo: '' }) },
  });
  const entrar = async (email: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } });
    return String(r.headers['set-cookie']).split(';')[0]!;
  };
  return { app, repo, troca, auditoria, relogio, numero, entrar };
}

describe('Rotas da troca de número', () => {
  it('a tela vê a troca, a atendente não decide, o admin arquiva; Conversas mostra as arquivadas e a gestão desarquiva', async () => {
    const { app, repo, relogio, numero, entrar, auditoria } = await montarServidor();
    const { velha1, velha2 } = await cenario(repo);
    const admin = await entrar('bruno@imperio.com');
    const carla = await entrar('carla@imperio.com');
    // Primeira leitura: guarda o número velho.
    let l = (await app.inject({ url: '/api/conexoes/whatsapp/canais', headers: { cookie: admin } })).json();
    expect(l.canais[0]).toMatchObject({ id: CANAL, estado: 'conectada', troca: null });
    // Conecta outro número.
    relogio.agora = t(11);
    await app.inject({ method: 'POST', url: `/api/conexoes/whatsapp/canais/${CANAL}/conectar`, headers: { cookie: admin }, payload: {} });
    numero.atual = NUMERO_NOVO;
    l = (await app.inject({ url: '/api/conexoes/whatsapp/canais', headers: { cookie: admin } })).json();
    expect(l.canais[0].troca).toMatchObject({ numeroAnterior: NUMERO_VELHO, numeroNovo: NUMERO_NOVO, conversas: 3, mensagens: 6, midias: 1 });
    // Atendente não chega nem perto.
    expect((await app.inject({ method: 'POST', url: `/api/conexoes/whatsapp/canais/${CANAL}/troca`, headers: { cookie: carla }, payload: { acao: 'apagar', confirmacao: 'APAGAR' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/conexoes/whatsapp/canais/${CANAL}/troca`, headers: { cookie: admin }, payload: { acao: 'sumir' } })).statusCode).toBe(400);
    const r = await app.inject({ method: 'POST', url: `/api/conexoes/whatsapp/canais/${CANAL}/troca`, headers: { cookie: admin }, payload: { acao: 'arquivar' } });
    expect(r.json()).toMatchObject({ ok: true, arquivadas: 3 });
    expect(auditoria.linhas.some((x) => x.acao === 'arquivou as conversas de um WhatsApp' && x.autorNome === 'Bruno')).toBe(true);
    l = (await app.inject({ url: '/api/conexoes/whatsapp/canais', headers: { cookie: admin } })).json();
    expect(l.canais[0].troca).toBeNull();
    // Conversas: fora da lista; no filtro das arquivadas.
    const lista = (await app.inject({ url: '/api/conversas', headers: { cookie: admin } })).json();
    expect(lista.map((c: { id: string }) => c.id)).not.toContain(velha1.id);
    const arq = (await app.inject({ url: '/api/conversas/arquivadas-numero', headers: { cookie: admin } })).json();
    expect(arq.conversas).toHaveLength(3);
    expect(arq.podeDesarquivar).toBe(true);
    // A atendente vê as que já via, mas não desarquiva.
    const arqCarla = (await app.inject({ url: '/api/conversas/arquivadas-numero', headers: { cookie: carla } })).json();
    expect(arqCarla.podeDesarquivar).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/conversas/desarquivar-numero', headers: { cookie: carla }, payload: { ids: [velha1.id] } })).statusCode).toBe(403);
    const d = await app.inject({ method: 'POST', url: '/api/conversas/desarquivar-numero', headers: { cookie: admin }, payload: { ids: [velha1.id, velha2.id] } });
    expect(d.json()).toEqual({ ok: true, desarquivadas: 2 });
  });

  it('botão "Apagar os dados deste WhatsApp": mostra o que vai sumir, exige APAGAR e mostra o andamento', async () => {
    const { app, repo, entrar } = await montarServidor();
    await cenario(repo);
    const admin = await entrar('bruno@imperio.com');
    const carla = await entrar('carla@imperio.com');
    expect((await app.inject({ url: `/api/conexoes/whatsapp/canais/${CANAL}/dados`, headers: { cookie: carla } })).statusCode).toBe(403);
    const d = (await app.inject({ url: `/api/conexoes/whatsapp/canais/${CANAL}/dados`, headers: { cookie: admin } })).json();
    expect(d).toMatchObject({ resumo: { conversas: 3, mensagens: 6, midias: 1 }, ativas: 3, arquivadas: 0 });
    expect((await app.inject({ method: 'POST', url: `/api/conexoes/whatsapp/canais/${CANAL}/dados`, headers: { cookie: admin }, payload: { acao: 'apagar' } })).statusCode).toBe(400);
    const r = (await app.inject({ method: 'POST', url: `/api/conexoes/whatsapp/canais/${CANAL}/dados`, headers: { cookie: admin }, payload: { acao: 'apagar', confirmacao: 'APAGAR' } })).json();
    expect(r.trabalho).toMatchObject({ estado: 'apagando', total: { conversas: 3 } });
    let p = (await app.inject({ url: `/api/conexoes/whatsapp/apagando/${r.trabalho.id}`, headers: { cookie: admin } })).json();
    for (let i = 0; i < 50 && p.estado === 'apagando'; i++) {
      await new Promise((ok) => setTimeout(ok, 5));
      p = (await app.inject({ url: `/api/conexoes/whatsapp/apagando/${r.trabalho.id}`, headers: { cookie: admin } })).json();
    }
    expect(p).toMatchObject({ estado: 'pronto', feito: { conversas: 3, mensagens: 6 } });
    expect((await repo.listarConversas({ incluirArquivadas: true })).filter((c) => c.unidade === 'norte' && c.canalId === CANAL)).toHaveLength(0);
  });
});
