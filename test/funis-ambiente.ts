import type pg from 'pg';
import { Sintonia } from '../src/app/sintonia.js';
import { ArmazemAutomacoesMemoria, ArmazemAutomacoesPostgres, Automacoes, type ArmazemAutomacoes } from '../src/automacoes/automacoes.js';
import type { Contas, Papel, Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemFunisMemoria, ArmazemFunisPostgres, Funis, type ArmazemFunis } from '../src/funis/funis.js';
import { registrarFunis } from '../src/rotas/funis.js';
import { criarServidor } from '../src/server.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags, type ArmazemTags } from '../src/tags/tags.js';
import { ligarFunis } from '../src/automacoes/automacoes.js';
import { AgenteFalso, ambientes, quinta, type Ambiente } from './gestao-ambiente.js';

export { ambientes, quinta, AgenteFalso };

const hashPadrao = gerarHash('Imperio2026xyz');

interface Base {
  repo: Repositorio;
  contas: Contas;
  pool?: pg.Pool;
  relogio: { t: Date };
  enviados: Array<{ canalId: string; telefone: string; texto: string }>;
  /** Memória: o "banco" é o mesmo objeto (sobrevive ao "reinício"). Postgres: cada instância cria os seus. */
  armazens: { tags: ArmazemTags; funis: ArmazemFunis; automacoes: ArmazemAutomacoes };
}

/** Uma "instância do servidor": Sintonia, funis, automações e a API, sobre o mesmo banco. */
function instancia(b: Base, agente: AgenteFalso, maxEncadeamento?: number) {
  const agora = () => b.relogio.t;
  const canal = (tipo: CanalWhatsApp['tipo']): CanalWhatsApp => ({
    tipo,
    lerWebhook: () => [],
    enviarTexto: async (canalId, telefone, texto) => {
      b.enviados.push({ canalId, telefone, texto });
      return { idExterno: `out-${Math.random()}` };
    },
  });
  const armazens = b.pool
    ? { tags: new ArmazemTagsPostgres(b.pool), funis: new ArmazemFunisPostgres(b.pool), automacoes: new ArmazemAutomacoesPostgres(b.pool) }
    : b.armazens;
  const tags = new Tags(armazens.tags, 'imperio', agora);
  let sintonia: Sintonia;
  const funis = new Funis({ armazem: armazens.funis, armazemTags: armazens.tags, tags, repo: b.repo, empresaId: 'imperio', agora, comConversa: (id, fn) => sintonia.comConversa(id, fn) });
  const automacoes = new Automacoes({ armazem: armazens.automacoes, repo: b.repo, empresaId: 'imperio', sintonia: () => sintonia, funis, tags, contas: b.contas, agora, maxEncadeamento });
  const ganchos = ligarFunis({ tags, funis, automacoes });
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
  return { sintonia, funis, automacoes, tags, app };
}

export async function montarFunis(amb: Ambiente, opcoes: { agente?: AgenteFalso; inicio?: Date; maxEncadeamento?: number } = {}) {
  const { repo, contas, pool } = await amb.criar();
  const relogio = { t: opcoes.inicio ?? quinta(14) };
  const armazemTags = new ArmazemTagsMemoria(() => repo.listarConversas());
  const b: Base = {
    repo,
    contas,
    pool,
    relogio,
    enviados: [],
    armazens: { tags: armazemTags, funis: new ArmazemFunisMemoria(repo, armazemTags), automacoes: new ArmazemAutomacoesMemoria(armazemTags) },
  };
  const agente = opcoes.agente ?? new AgenteFalso();
  let atual = instancia(b, agente, opcoes.maxEncadeamento);
  const sistema = await atual.funis.garantirSistema();
  const etapasSistema = new Map((await atual.funis.etapas(sistema.id)).map((e) => [e.chaveSistema!, e.id]));

  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    gerenteNorte: await pessoa('Gil Norte', 'gerente', ['norte']),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
    bia: await pessoa('Bia Souza', 'atendente', ['norte']),
    rita: await pessoa('Rita Recepção', 'recepcionista', ['sumare']),
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
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    const r = await atual.app.inject({ method, url, headers: { cookie: await cookieDe(u) }, ...(payload !== undefined ? { payload: payload as object } : {}) });
    await atual.automacoes.ocioso();
    return r;
  };

  let tel = 0;
  /** Uma cliente nova escreve agora (pelo número real da unidade, ou pelo de teste). */
  const conversa = async (unidade: 'norte' | 'sumare', nome: string, texto = 'Oi, quanto custa?', canalId = `imperio-${unidade}`): Promise<Conversa> => {
    const telefone = `55719881300${String(++tel).padStart(2, '0')}`;
    await atual.sintonia.receber({ canalId, telefone, nome, texto, deMim: false, idExterno: `in-${unidade}-${tel}-${Math.random()}`, em: relogio.t });
    await atual.automacoes.ocioso();
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  /** A mesma cliente escreve de novo. */
  const escreve = async (c: Conversa, texto: string, deMim = false) => {
    await atual.sintonia.receber({ canalId: c.canalId, telefone: c.telefone, nome: c.nome, texto, deMim, idExterno: `in-${Math.random()}`, em: relogio.t });
    await atual.automacoes.ocioso();
  };
  const tick = async () => {
    await atual.automacoes.tick();
    await atual.automacoes.ocioso();
  };
  const avancar = (min: number) => {
    relogio.t = new Date(relogio.t.getTime() + min * 60_000);
  };
  const buscar = async (id: string) => (await repo.buscarConversa(id))!;

  return {
    repo,
    contas,
    pool,
    relogio,
    gente,
    agente,
    enviados: b.enviados,
    sistema,
    etapasSistema,
    get app() {
      return atual.app;
    },
    get funis() {
      return atual.funis;
    },
    get automacoes() {
      return atual.automacoes;
    },
    get tags() {
      return atual.tags;
    },
    get sintonia() {
      return atual.sintonia;
    },
    /** "Reinício": nova Sintonia, novos funis e automações lendo do mesmo banco. */
    reiniciar() {
      atual = instancia(b, agente, opcoes.maxEncadeamento);
    },
    como,
    conversa,
    escreve,
    tick,
    avancar,
    buscar,
  };
}
