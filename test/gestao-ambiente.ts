import type pg from 'pg';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { ArmazemBaseMemoria, ArmazemBasePostgres, BaseConhecimento } from '../src/ai/base.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas, type Papel, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { ArmazemChamadasMemoria, ArmazemChamadasPostgres } from '../src/ligacoes/chamadas.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemEmpresaMemoria, ArmazemEmpresaPostgres, Empresa, regrasDaConfig } from '../src/empresa/empresa.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags, TagsDaIa } from '../src/tags/tags.js';
import type { RespostaSimulacao, PedidoSimulacao } from '../src/ai/simulacao.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/** Quinta, 5/11/2026 (horário da Bahia). */
export const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);
const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);

export const BASE_TESTE = `# Título que não vira seção

## Quem somos
- Império Progressivas.
- Endereço: [PREENCHER]

## Jeito de falar
Curto e caloroso.

## Perguntas frequentes
[PREENCHER — cole aqui as perguntas]
`;

export interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; contas: Contas; pool?: pg.Pool }>;
}

export const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), pool };
          },
        },
      ]
    : []),
];

export class AgenteFalso {
  pedidos: PedidoAgente[] = [];
  constructor(public resposta: (p: PedidoAgente) => RespostaAgente = () => ({ texto: 'Sugestão', acoes: [], recusou: false })) {}
  async executar(p: PedidoAgente) {
    this.pedidos.push(p);
    return this.resposta(p);
  }
}

export async function montarGestao(
  amb: Ambiente,
  opcoes: {
    agente?: AgenteFalso;
    simularIa?: (p: Omit<PedidoSimulacao, 'agora'>) => Promise<RespostaSimulacao>;
    iaLigada?: () => boolean;
    inicio?: Date;
    /** Relógio compartilhado (ex.: com um agente falso que "pensa" alguns segundos). */
    relogio?: { t: Date };
    /** Liga a tela Ligações (histórico) e o webhook da Evolution. */
    chamadas?: boolean;
  } = {},
) {
  const { repo, contas, pool } = await amb.criar();
  const relogio = opcoes.relogio ?? { t: opcoes.inicio ?? quinta(14) };
  const agora = () => relogio.t;
  const enviados: Array<{ telefone: string; texto: string }> = [];
  const canal: CanalWhatsApp = {
    tipo: 'evolution',
    lerWebhook: () => [],
    enviarTexto: async (_c, telefone, texto) => {
      enviados.push({ telefone, texto });
      return { idExterno: `out-${Math.random()}` };
    },
  };
  // cacheMs 0: no teste, cada leitura vai ao armazém (como outro processo veria depois do cache).
  const empresa = new Empresa(pool ? new ArmazemEmpresaPostgres(pool) : new ArmazemEmpresaMemoria(), 'imperio', 'Império Progressivas', { cacheMs: 0, agora });
  const tags = new Tags(pool ? new ArmazemTagsPostgres(pool) : new ArmazemTagsMemoria(() => repo.listarConversas()), 'imperio', agora);
  const tagsDaIa = new TagsDaIa(tags, async () => (await empresa.configIa()).marcarTags);
  const base = new BaseConhecimento(pool ? new ArmazemBasePostgres(pool) : new ArmazemBaseMemoria(), 'imperio', () => BASE_TESTE, { cacheMs: 0, agora });
  const agente = opcoes.agente ?? new AgenteFalso();
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal },
    ],
    agente,
    agora,
    configIa: async () => regrasDaConfig(await empresa.configIa()),
    tagsIa: tagsDaIa,
  });
  const app = criarServidor({
    sintonia,
    repo,
    agora,
    auth: { contas, agora },
    gestao: { tags, empresa, base, simularIa: opcoes.simularIa, iaLigada: opcoes.iaLigada, tagsDaIa: () => tagsDaIa.nomes() },
    ...(opcoes.chamadas
      ? { chamadas: { armazem: pool ? new ArmazemChamadasPostgres(pool) : new ArmazemChamadasMemoria(), empresaId: 'imperio' }, evolution: { canal } }
      : {}),
  });

  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    direcao: await pessoa('Diana Reis', 'direcao', []),
    gerenteNorte: await pessoa('Gil Norte', 'gerente', ['norte']),
    gerenteSumare: await pessoa('Sara Sumare', 'gerente', ['sumare']),
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
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie: await cookieDe(u) }, ...(payload !== undefined ? { payload: payload as object } : {}) });

  let tel = 0;
  /** Uma cliente nova escreve agora. */
  const conversa = async (unidade: 'norte' | 'sumare', nome: string, texto = 'Oi, quanto custa?'): Promise<Conversa> => {
    const telefone = `55719881300${String(++tel).padStart(2, '0')}`;
    await sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome, texto, deMim: false, idExterno: `in-${unidade}-${tel}-${Math.random()}`, em: relogio.t });
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  /** A mesma cliente escreve de novo. */
  const escreve = async (c: Conversa, texto: string) =>
    sintonia.receber({ canalId: `imperio-${c.unidade}`, telefone: c.telefone, nome: c.nome, texto, deMim: false, idExterno: `in-${Math.random()}`, em: relogio.t });

  return { app, repo, contas, pool, sintonia, relogio, gente, como, conversa, escreve, enviados, empresa, tags, base, agente };
}
