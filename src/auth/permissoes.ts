import type { FastifyRequest } from 'fastify';
import type { Papel, Usuario } from './contas.js';

/**
 * Permissões granulares. Cada papel tem um PERFIL padrão (igual ao comportamento de antes:
 * quem já existe não perde nem ganha nada). A empresa pode ajustar o perfil de um papel, e
 * cada pessoa pode ter ajustes próprios por cima do perfil. Tudo é função pura, menos `pode`,
 * que lê o que o login já resolveu na requisição.
 */

export type NivelConversas = 'minhas' | 'unidade' | 'todas';
export const NIVEIS_CONVERSAS: readonly NivelConversas[] = ['minhas', 'unidade', 'todas'];
export const NOME_NIVEL: Record<NivelConversas, string> = {
  minhas: 'Só as minhas (e as sem dona)',
  unidade: 'Todas da unidade',
  todas: 'Todas as unidades',
};

export const CHAVES = [
  'responder',
  'assumir_transferir',
  'crm_ver',
  'crm_mover',
  'funis_editar',
  'dashboard',
  'relatorios',
  'comissoes',
  'exportar',
  'importar_leads',
  'transmissoes',
  'email_marketing',
  'automacoes',
  'agentes_ia',
  'conexoes',
  'equipe',
  'demo',
  'apagar_conversas',
] as const;
export type Chave = (typeof CHAVES)[number];
export type Permissao = Chave | 'conversas';

export type Permissoes = { conversas: NivelConversas } & Record<Chave, boolean>;
export type Ajustes = Partial<Permissoes>;

export const CATALOGO: ReadonlyArray<{ chave: Chave; nome: string; grupo: string }> = [
  { chave: 'responder', nome: 'Responder clientes', grupo: 'Conversas' },
  { chave: 'assumir_transferir', nome: 'Assumir e transferir conversas', grupo: 'Conversas' },
  { chave: 'apagar_conversas', nome: 'Apagar conversas', grupo: 'Conversas' },
  { chave: 'crm_ver', nome: 'Ver o CRM', grupo: 'CRM' },
  { chave: 'crm_mover', nome: 'Mover etapas', grupo: 'CRM' },
  { chave: 'funis_editar', nome: 'Editar funis', grupo: 'CRM' },
  { chave: 'dashboard', nome: 'Ver o Dashboard', grupo: 'Números' },
  { chave: 'relatorios', nome: 'Ver relatórios', grupo: 'Números' },
  { chave: 'comissoes', nome: 'Ver comissões', grupo: 'Números' },
  { chave: 'exportar', nome: 'Exportar dados', grupo: 'Dados' },
  { chave: 'importar_leads', nome: 'Importar leads', grupo: 'Dados' },
  { chave: 'demo', nome: 'Dados de demonstração', grupo: 'Dados' },
  { chave: 'transmissoes', nome: 'Transmissões', grupo: 'Marketing' },
  { chave: 'email_marketing', nome: 'E-mail marketing', grupo: 'Marketing' },
  { chave: 'automacoes', nome: 'Automações e bots', grupo: 'Marketing' },
  { chave: 'agentes_ia', nome: 'Agentes de IA', grupo: 'Configuração' },
  { chave: 'conexoes', nome: 'Conexões', grupo: 'Configuração' },
  { chave: 'equipe', nome: 'Equipe e usuários', grupo: 'Configuração' },
];

const GESTAO: Chave[] = [
  'funis_editar',
  'relatorios',
  'comissoes',
  'exportar',
  'importar_leads',
  'transmissoes',
  'email_marketing',
  'automacoes',
  'agentes_ia',
  'equipe',
];
const DIRECAO: Chave[] = ['conexoes', 'demo', 'apagar_conversas'];
const TODOS: Chave[] = ['responder', 'assumir_transferir', 'crm_ver', 'crm_mover', 'dashboard'];

/** Perfil padrão de cada papel: o mesmo que o sistema fazia antes das permissões granulares. */
export function perfilPadrao(papel: Papel): Permissoes {
  const gestor = papel === 'gerente' || papel === 'direcao' || papel === 'admin';
  const topo = papel === 'direcao' || papel === 'admin';
  const p = { conversas: topo ? 'todas' : papel === 'gerente' ? 'unidade' : 'minhas' } as Permissoes;
  for (const c of CHAVES) p[c] = TODOS.includes(c) || (gestor && GESTAO.includes(c)) || (topo && DIRECAO.includes(c));
  return p;
}

/** Só o que é válido (chaves conhecidas, valores do tipo certo). */
export function limparAjustes(bruto: unknown): Ajustes {
  const a: Ajustes = {};
  if (!bruto || typeof bruto !== 'object') return a;
  const o = bruto as Record<string, unknown>;
  if (typeof o.conversas === 'string' && (NIVEIS_CONVERSAS as string[]).includes(o.conversas)) a.conversas = o.conversas as NivelConversas;
  for (const c of CHAVES) if (typeof o[c] === 'boolean') a[c] = o[c] as boolean;
  return a;
}

/** Padrão do papel ← ajuste do perfil na empresa ← ajuste da pessoa. */
export function resolver(papel: Papel, perfil?: Ajustes, pessoa?: Ajustes): Permissoes {
  return { ...perfilPadrao(papel), ...limparAjustes(perfil), ...limparAjustes(pessoa) };
}

/** O que difere do padrão (é isso que se guarda, para o padrão poder evoluir). */
export function diferencaDoPadrao(papel: Papel, p: Ajustes): Ajustes {
  const padrao = perfilPadrao(papel);
  const d: Ajustes = {};
  const limpo = limparAjustes(p);
  for (const [k, v] of Object.entries(limpo)) if ((padrao as Record<string, unknown>)[k] !== v) (d as Record<string, unknown>)[k] = v;
  return d;
}

const ORDEM_NIVEL: Record<NivelConversas, number> = { minhas: 0, unidade: 1, todas: 2 };

/**
 * Anti-escalada: quem não é admin só pode dar a alguém o que ele mesmo tem.
 * Devolve o motivo da recusa, ou null.
 */
export function recusaAjustes(meu: Permissoes, ajustes: Ajustes): string | null {
  if (ajustes.conversas && ORDEM_NIVEL[ajustes.conversas] > ORDEM_NIVEL[meu.conversas]) return 'Você não pode dar uma visão de conversas maior que a sua.';
  for (const c of CHAVES) if (ajustes[c] === true && !meu[c]) return `Você não pode liberar "${CATALOGO.find((x) => x.chave === c)?.nome ?? c}", porque você mesmo não tem.`;
  return null;
}

// ---------------------------------------------------------------- horário permitido

export interface Horario {
  /** 0 = domingo ... 6 = sábado */
  dias: number[];
  inicio: string; // HH:mm
  fim: string; // HH:mm
}

export function limparHorario(bruto: unknown): Horario | null {
  if (!bruto || typeof bruto !== 'object') return null;
  const o = bruto as Record<string, unknown>;
  const hhmm = (v: unknown) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!hhmm(o.inicio) || !hhmm(o.fim) || !Array.isArray(o.dias)) return null;
  const dias = [...new Set(o.dias.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!dias.length) return null;
  return { dias, inicio: o.inicio as string, fim: o.fim as string };
}

/** Dentro do horário? (horário da Bahia, UTC-3 o ano todo) */
export function dentroDoHorario(h: Horario | null | undefined, agora: Date): boolean {
  if (!h) return true;
  const local = new Date(agora.getTime() - 3 * 3600_000);
  const dia = local.getUTCDay();
  const min = local.getUTCHours() * 60 + local.getUTCMinutes();
  const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  if (!h.dias.includes(dia)) return false;
  const ini = m(h.inicio);
  const fim = m(h.fim);
  return ini <= fim ? min >= ini && min < fim : min >= ini || min < fim;
}

// ---------------------------------------------------------------- na requisição

declare module 'fastify' {
  interface FastifyRequest {
    permissoes?: Permissoes;
  }
}

/** Permissões de quem fez o pedido (sem login = servidor de teste/sem auth: tudo liberado). */
export function permissoesDe(req: FastifyRequest): Permissoes | undefined {
  const u = req.usuario;
  if (!u) return undefined;
  return req.permissoes ?? perfilPadrao(u.papel);
}

/** Função central: esta pessoa pode isto? `conversas` responde se vê além das próprias. */
export function pode(req: FastifyRequest, p: Permissao): boolean {
  const perms = permissoesDe(req);
  if (!perms) return true;
  if (p === 'conversas') return perms.conversas !== 'minhas';
  return perms[p];
}

/** Recusa com 403 se a pessoa não pode. */
export function exigir(req: FastifyRequest, p: Permissao, msg = 'Você não tem permissão para isso. Fale com a gestão.'): void {
  if (!pode(req, p)) throw Object.assign(new Error(msg), { statusCode: 403 });
}

/** Põe na pessoa o nível de conversas, que podeVer/escopoDe usam. */
export const comNivel = (u: Usuario, p: Permissoes): Usuario => ({ ...u, verConversas: p.conversas });

/**
 * Rotas principais que só pedem uma permissão (além das regras de cada rota).
 * Ordem importa: a primeira que casar vale.
 */
export const ROTAS_PERMISSAO: ReadonlyArray<{ metodo?: string; padrao: RegExp; p: Chave }> = [
  { metodo: 'POST', padrao: /^\/api\/conversas\/[^/]+\/(enviar|modelo|revisar)$/, p: 'responder' },
  { metodo: 'POST', padrao: /^\/api\/conversas\/[^/]+\/(assumir|transferir)$/, p: 'assumir_transferir' },
  { metodo: 'DELETE', padrao: /^\/api\/conversas\/[^/]+$/, p: 'apagar_conversas' },
  { metodo: 'POST', padrao: /^\/api\/conversas\/[^/]+\/funis\//, p: 'crm_mover' },
  { metodo: 'GET', padrao: /^\/api\/funis(\/|$)/, p: 'crm_ver' },
  { padrao: /^\/api\/painel(\/|$)/, p: 'dashboard' },
  { padrao: /^\/api\/comissoes(\/|$)/, p: 'comissoes' },
  { padrao: /^\/api\/leads\/exportar/, p: 'exportar' },
  { padrao: /^\/api\/relatorios\/[^/]+\/csv/, p: 'exportar' },
  { padrao: /^\/api\/conexoes(\/|$)/, p: 'conexoes' },
  { padrao: /^\/api\/acessos\/usuarios/, p: 'equipe' },
];

export function permissaoDaRota(metodo: string, caminho: string): Chave | undefined {
  return ROTAS_PERMISSAO.find((r) => (!r.metodo || r.metodo === metodo) && r.padrao.test(caminho))?.p;
}
