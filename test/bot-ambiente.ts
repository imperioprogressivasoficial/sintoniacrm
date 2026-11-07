import type pg from 'pg';
import { Sintonia } from '../src/app/sintonia.js';
import { ArmazemAutomacoesMemoria, ArmazemAutomacoesPostgres, Automacoes, ligarFunis, type ArmazemAutomacoes } from '../src/automacoes/automacoes.js';
import { ArmazemBotsMemoria, ArmazemBotsPostgres, Bots, ligarBots, type ArmazemBots } from '../src/bot/bot.js';
import { registrarBots } from '../src/bot/rotas.js';
import type { Contas, Papel, Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { ContatosMemoria, ContatosPostgres, type ArmazemContatos } from '../src/contatos/contatos.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemFunisMemoria, ArmazemFunisPostgres, Funis, type ArmazemFunis } from '../src/funis/funis.js';
import { registrarFunis } from '../src/rotas/funis.js';
import { criarServidor } from '../src/server.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags, type ArmazemTags } from '../src/tags/tags.js';
import { AgenteFalso, ambientes, quinta, type Ambiente } from './gestao-ambiente.js';

export { ambientes, quinta, AgenteFalso };

const hashPadrao = gerarHash('Imperio2026xyz');

interface Base {
  repo: Repositorio;
  contas: Contas;
  pool?: pg.Pool;
  relogio: { t: Date };
  enviados: Array<{ canalId: string; telefone: string; texto: string; midia?: boolean }>;
  webhooks: Array<{ url: string; corpo: unknown }>;
  armazens: { tags: ArmazemTags; funis: ArmazemFunis; automacoes: ArmazemAutomacoes; bots: ArmazemBots; contatos: ArmazemContatos };
}

/** Uma "instância do servidor" com funis, automações e bots sobre o mesmo banco. */
function instancia(b: Base, agente: AgenteFalso) {
  const agora = () => b.relogio.t;
  const canal = (tipo: CanalWhatsApp['tipo']): CanalWhatsApp => ({
    tipo,
    lerWebhook: () => [],
    enviarTexto: async (canalId, telefone, texto) => {
      b.enviados.push({ canalId, telefone, texto });
      return { idExterno: `out-${Math.random()}` };
    },
    enviarMidia: async (canalId, telefone, m) => {
      b.enviados.push({ canalId, telefone, texto: m.legenda ?? '', midia: true });
      return { idExterno: `out-${Math.random()}` };
    },
  });
  const armazens = b.pool
    ? {
        tags: new ArmazemTagsPostgres(b.pool),
        funis: new ArmazemFunisPostgres(b.pool),
        automacoes: new ArmazemAutomacoesPostgres(b.pool),
        bots: new ArmazemBotsPostgres(b.pool),
        contatos: new ContatosPostgres(b.pool),
      }
    : b.armazens;
  const tags = new Tags(armazens.tags, 'imperio', agora);
  let sintonia: Sintonia;
  const funis = new Funis({ armazem: armazens.funis, armazemTags: armazens.tags, tags, repo: b.repo, empresaId: 'imperio', agora, comConversa: (id, fn) => sintonia.comConversa(id, fn) });
  const automacoes = new Automacoes({ armazem: armazens.automacoes, repo: b.repo, empresaId: 'imperio', sintonia: () => sintonia, funis, tags, contas: b.contas, agora });
  const fetchFalso = (async (url: string | URL, init?: RequestInit) => {
    b.webhooks.push({ url: String(url), corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).includes('falha')) return new Response('x', { status: 500 });
    return new Response(JSON.stringify({ protocolo: 'A123' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const bots = new Bots({
    armazem: armazens.bots,
    repo: b.repo,
    empresaId: 'imperio',
    sintonia: () => sintonia,
    funis,
    tags,
    contas: b.contas,
    contatos: armazens.contatos,
    envios: armazens.automacoes,
    fetch: fetchFalso,
    agora,
  });
  const ganchos = ligarBots(ligarFunis({ tags, funis, automacoes }), { bots, funis, tags });
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo: b.repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal: canal('evolution') },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal: canal('evolution') },
      { canalId: 'teste-norte', unidade: 'norte', canal: canal('teste') },
    ],
    agente,
    agora,
    ganchos,
  });
  const app = criarServidor({ sintonia, repo: b.repo, agora, auth: { contas: b.contas, agora }, gestao: { tags } });
  registrarFunis(app, { repo: b.repo, funis, automacoes });
  registrarBots(app, { repo: b.repo, bots });
  return { sintonia, funis, automacoes, bots, tags, app, armazens };
}

export async function montarBot(amb: Ambiente, opcoes: { agente?: AgenteFalso; inicio?: Date } = {}) {
  const { repo, contas, pool } = await amb.criar();
  if (pool) await pool.query('truncate sintonia.bot_fluxos, sintonia.bot_execucoes, sintonia.bot_midias cascade');
  const relogio = { t: opcoes.inicio ?? quinta(14) };
  const armazemTags = new ArmazemTagsMemoria(() => repo.listarConversas());
  const b: Base = {
    repo,
    contas,
    pool,
    relogio,
    enviados: [],
    webhooks: [],
    armazens: {
      tags: armazemTags,
      funis: new ArmazemFunisMemoria(repo, armazemTags),
      automacoes: new ArmazemAutomacoesMemoria(armazemTags),
      bots: new ArmazemBotsMemoria(),
      contatos: new ContatosMemoria(),
    },
  };
  const agente = opcoes.agente ?? new AgenteFalso();
  let atual = instancia(b, agente);
  const sistema = await atual.funis.garantirSistema();
  const etapasSistema = new Map((await atual.funis.etapas(sistema.id)).map((e) => [e.chaveSistema!, e.id]));

  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
  };
  const cookies = new Map<string, string>();
  const cookieDe = async (u: Usuario) => {
    let c = cookies.get(u.id);
    if (!c) {
      c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 400 * 24 * 3600_000))}`;
      cookies.set(u.id, c);
    }
    return c;
  };
  const ocioso = async () => {
    await atual.automacoes.ocioso();
    await atual.bots.ocioso();
  };
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const r = await atual.app.inject({ method, url, headers: { cookie: await cookieDe(u) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    await ocioso();
    return r;
  };

  let tel = 0;
  const conversa = async (unidade: 'norte' | 'sumare', nome: string, texto = 'Oi', canalId = `imperio-${unidade}`): Promise<Conversa> => {
    const telefone = `55719881400${String(++tel).padStart(2, '0')}`;
    await atual.sintonia.receber({ canalId, telefone, nome, texto, deMim: false, idExterno: `in-${unidade}-${tel}-${Math.random()}`, em: relogio.t });
    await ocioso();
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const escreve = async (c: Conversa, texto: string, deMim = false) => {
    await atual.sintonia.receber({ canalId: c.canalId, telefone: c.telefone, nome: c.nome, texto, deMim, idExterno: `in-${Math.random()}`, em: relogio.t });
    await ocioso();
  };
  const tick = async () => {
    await atual.automacoes.tick();
    await atual.bots.tick();
    await ocioso();
  };
  const avancar = (min: number) => {
    relogio.t = new Date(relogio.t.getTime() + min * 60_000);
  };
  const buscar = async (id: string) => (await repo.buscarConversa(id))!;
  /** Textos que a loja mandou para a conversa (na ordem). */
  const enviadosPara = (c: Conversa) => b.enviados.filter((x) => x.telefone === c.telefone).map((x) => x.texto);

  return {
    repo,
    contas,
    pool,
    relogio,
    gente,
    agente,
    enviados: b.enviados,
    webhooks: b.webhooks,
    sistema,
    etapasSistema,
    get app() {
      return atual.app;
    },
    get funis() {
      return atual.funis;
    },
    get bots() {
      return atual.bots;
    },
    get tags() {
      return atual.tags;
    },
    get sintonia() {
      return atual.sintonia;
    },
    get armazens() {
      return atual.armazens;
    },
    reiniciar() {
      atual = instancia(b, agente);
    },
    como,
    conversa,
    escreve,
    tick,
    avancar,
    buscar,
    enviadosPara,
    ocioso,
  };
}
