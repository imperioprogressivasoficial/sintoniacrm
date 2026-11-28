import { z } from 'zod';
import type { UnidadeId } from './domain.js';

/**
 * Unidades (lojas, filiais) em vigor no servidor.
 *
 * A fonte é o cadastro (Empresa › Unidades, src/empresa/cadastro.ts): o index carrega o cadastro ao subir e
 * a cada mudança chama `definirUnidades`. Aqui fica só o cache em memória, para o atendimento (IA, bot,
 * horário, agenda) não ir ao banco a cada mensagem. Uma empresa pode ter 1, 2 ou 50 unidades com o nome que quiser.
 *
 * `UNIDADES[id]` continua funcionando (é uma vista do cache da empresa padrão): devolve sempre um objeto,
 * mesmo para um id que não está no cadastro (nome = o próprio id, sem horário), para nada quebrar com dado antigo.
 */

/** Dia da semana como em Date.getDay(): 0 = domingo … 6 = sábado. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Faixa de funcionamento em "HH:mm". */
export interface Faixa {
  abre: string;
  fecha: string;
}

export interface Unidade {
  id: UnidadeId;
  /** Nome que vai nas mensagens para os clientes (ex.: "Salvador Norte Shopping"). */
  nome: string;
  /** Nome curto, como aparece no app (ex.: "Salvador Norte"). */
  nomeApp: string;
  trinksEstabelecimentoId: string | null;
  horario: Partial<Record<DiaSemana, Faixa>>;
  agendaAberta: boolean;
  ativa: boolean;
  ordem: number;
  /** serena-regras: horários que a IA oferece (os livres do dia). Vazio = os livres da agenda. */
  horariosPadrao: string[];
  /** serena-regras: até que hora a IA pode marcar quando a cliente pede outro horário (null = só os padrão). */
  ultimoHorarioEspecial: string | null;
  /** serena-regras: serviço do sistema de agenda em que a IA marca (null = a IA escolhe). */
  servicoPadraoId: number | null;
  /** serena-regras: endereço do cadastro em uma linha ('' = sem endereço no cadastro). */
  endereco: string;
}

/** O que o cadastro entrega para o cache. */
export interface UnidadeDoCadastro {
  id: string;
  nome: string;
  /** Nome para clientes (vazio = o nome). */
  nomeCliente?: string;
  ativa: boolean;
  ordem: number;
  /** Já resolvido (o da unidade ou o da empresa); null = sem horário (a equipe nunca está "aberta"). */
  horario: Partial<Record<DiaSemana, Faixa>> | null;
  /* serena-regras (opcionais: quem não manda fica sem padrão) */
  horariosPadrao?: string[];
  ultimoHorarioEspecial?: string | null;
  servicoPadraoId?: number | null;
  endereco?: string;
}

/** Agenda de cada unidade: vem das Conexões (o index liga isto ao subir). */
export type AgendaDaUnidadeCfg = (id: string) => { trinksEstabelecimentoId: string | null; agendaAberta: boolean };

// ---------------------------------------------------------------- dados que a Império já tinha

// Horário de shopping da Império (era o padrão de antes do cadastro). Só semeia o cadastro dela.
export const HORARIO_SHOPPING: Partial<Record<DiaSemana, Faixa>> = {
  1: { abre: '10:00', fecha: '22:00' },
  2: { abre: '10:00', fecha: '22:00' },
  3: { abre: '10:00', fecha: '22:00' },
  4: { abre: '10:00', fecha: '22:00' },
  5: { abre: '10:00', fecha: '22:00' },
  6: { abre: '10:00', fecha: '22:00' },
  0: { abre: '14:00', fecha: '20:00' },
};

/**
 * Unidades da Império (empresa "imperio") de antes do cadastro: semeiam o cadastro dela no 1º uso e valem
 * enquanto o cadastro não carrega (testes em memória). Nenhuma outra empresa recebe estas unidades.
 */
export const UNIDADES_IMPERIO: ReadonlyArray<UnidadeDoCadastro & { trinks: string | null }> = [
  { id: 'norte', nome: 'Salvador Norte', nomeCliente: 'Salvador Norte Shopping', ativa: true, ordem: 0, horario: HORARIO_SHOPPING, trinks: '240643' },
  { id: 'sumare', nome: 'Sumaré', nomeCliente: 'Shopping Sumaré', ativa: true, ordem: 1, horario: HORARIO_SHOPPING, trinks: '222074' },
  { id: 'feira', nome: 'Feira de Santana', nomeCliente: 'Feira de Santana', ativa: true, ordem: 2, horario: {}, trinks: null },
];
/**
 * serena-regras (dono 28/11): horários que a IA oferece em cada unidade da Império; o Sumaré marca até 18:00 quando a
 * cliente pede outro horário. Só semeiam o cadastro dela (e a migração 777); depois vale o que a gestão editar.
 */
export const HORARIOS_PADRAO_IMPERIO: Readonly<Record<string, { horariosPadrao: string[]; ultimoHorarioEspecial?: string }>> = {
  norte: { horariosPadrao: ['09:00', '12:30', '15:30', '18:00'] },
  sumare: { horariosPadrao: ['09:00', '12:30', '15:30'], ultimoHorarioEspecial: '18:00' },
};
/** Empresa dona das unidades acima. */
export const EMPRESA_IMPERIO = 'imperio';
/** Ids que já existiam antes do cadastro (os campos de Conexões deles têm nome antigo: "...Norte", "...Sumare"). */
export const IDS_LEGADOS = ['norte', 'sumare', 'feira'] as const;

/** Unidade inicial de uma empresa nova (sem nada no cadastro). */
export const UNIDADE_INICIAL = { id: 'principal', nome: 'Unidade principal' } as const;

// ---------------------------------------------------------------- cache

let empresaPadrao = EMPRESA_IMPERIO;
const cache = new Map<string, UnidadeDoCadastro[]>();

const agendaLegada: AgendaDaUnidadeCfg = (id) => {
  const u = UNIDADES_IMPERIO.find((x) => x.id === id);
  return { trinksEstabelecimentoId: u?.trinks ?? null, agendaAberta: Boolean(u?.trinks) };
};
let agendaDe: AgendaDaUnidadeCfg = agendaLegada;

/** Empresa usada quando ninguém diz qual (o servidor atende uma empresa: SINTONIA_EMPRESA_ID). */
export function definirEmpresaPadrao(id: string): void {
  empresaPadrao = id;
}
export const empresaPadraoDasUnidades = () => empresaPadrao;

/** Troca o cache de uma empresa pelo que está no cadastro. */
export function definirUnidades(empresaId: string, lista: UnidadeDoCadastro[]): void {
  cache.set(
    empresaId,
    [...lista].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')).map((u) => ({ ...u })),
  );
}

/** Liga a agenda (estabelecimento do Trinks e se a unidade agenda) às Conexões. */
export function definirAgendaDasUnidades(fn: AgendaDaUnidadeCfg | null): void {
  agendaDe = fn ?? agendaLegada;
}

/** Volta ao começo (testes). */
export function reiniciarUnidades(): void {
  cache.clear();
  empresaPadrao = EMPRESA_IMPERIO;
  agendaDe = agendaLegada;
}

function listaDa(empresaId?: string): UnidadeDoCadastro[] {
  // Empresa que não está no cache: vale a padrão (o servidor atende uma empresa só; SINTONIA_EMPRESA_ID).
  const l = (empresaId !== undefined ? cache.get(empresaId) : undefined) ?? cache.get(empresaPadrao);
  if (l) return l;
  // Antes de o cadastro carregar: só a Império tem unidades conhecidas.
  return empresaPadrao === EMPRESA_IMPERIO ? [...UNIDADES_IMPERIO] : [];
}

function montar(u: UnidadeDoCadastro): Unidade {
  const ag = agendaDe(u.id);
  return {
    id: u.id,
    nome: u.nomeCliente?.trim() || u.nome,
    nomeApp: u.nome,
    trinksEstabelecimentoId: ag.trinksEstabelecimentoId,
    horario: u.horario ?? {},
    agendaAberta: ag.agendaAberta,
    ativa: u.ativa,
    ordem: u.ordem,
    horariosPadrao: [...(u.horariosPadrao ?? [])],
    ultimoHorarioEspecial: u.ultimoHorarioEspecial || null,
    servicoPadraoId: u.servicoPadraoId ?? null,
    endereco: u.endereco ?? '',
  };
}

/** Unidade fora do cadastro (dado antigo): o id vira o nome e ela nunca está "aberta". */
const avulsa = (id: string): Unidade => ({ id, nome: id, nomeApp: id, trinksEstabelecimentoId: null, horario: {}, agendaAberta: false, ativa: false, ordem: 999, horariosPadrao: [], ultimoHorarioEspecial: null, servicoPadraoId: null, endereco: '' });

/** A unidade (sempre devolve algo: id desconhecido vira uma unidade sem horário com o próprio id como nome). */
export function unidadeDe(id: string | null | undefined, empresaId?: string): Unidade {
  const s = String(id ?? '');
  const u = listaDa(empresaId).find((x) => x.id === s);
  return u ? montar(u) : avulsa(s);
}

/** A unidade está no cadastro da empresa? (ativa ou não) */
export function existeUnidade(id: string | null | undefined, empresaId?: string, op: { ativa?: boolean } = {}): boolean {
  const u = listaDa(empresaId).find((x) => x.id === id);
  return Boolean(u && (!op.ativa || u.ativa));
}

/** Unidades da empresa, na ordem do cadastro. Por padrão só as ativas. */
export function unidadesDa(empresaId?: string, op: { inativas?: boolean } = {}): Unidade[] {
  return listaDa(empresaId)
    .filter((u) => op.inativas || u.ativa)
    .map(montar);
}

/** Ids das unidades (ativas, por padrão). */
export const idsUnidades = (empresaId?: string, op: { inativas?: boolean } = {}): UnidadeId[] => unidadesDa(empresaId, op).map((u) => u.id);

/** Primeira unidade ativa (para quando é preciso escolher uma). */
export const primeiraUnidade = (empresaId?: string): UnidadeId => idsUnidades(empresaId)[0] ?? listaDa(empresaId)[0]?.id ?? UNIDADE_INICIAL.id;

/** Unidades que agendam (têm sistema de agenda escolhido em Conexões › Agenda). */
export const unidadesComAgenda = (empresaId?: string): UnidadeId[] => unidadesDa(empresaId).filter((u) => u.agendaAberta).map((u) => u.id);

/** Nome da unidade para clientes ('' sem unidade). Só lê o cadastro (não consulta a agenda). */
export function nomeUnidade(id: string | null | undefined, empresaId?: string): string {
  if (!id) return '';
  const u = listaDa(empresaId).find((x) => x.id === id);
  return u ? u.nomeCliente?.trim() || u.nome : id;
}

/** Formato do id de unidade (curto, só minúsculas, números e hífen). */
export const FORMATO_ID_UNIDADE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Zod: id de unidade que está no cadastro (da empresa padrão). `ativa` = só as ativas
 * (para criar coisa nova; filtros e dados antigos aceitam as desativadas).
 */
export const zUnidade = (op: { ativa?: boolean; mensagem?: string } = {}) =>
  z
    .string({ message: op.mensagem ?? 'Escolha a unidade.' })
    .trim()
    .regex(FORMATO_ID_UNIDADE, op.mensagem ?? 'Unidade inválida.')
    .refine((id) => existeUnidade(id, undefined, { ativa: op.ativa }), op.mensagem ?? 'Essa unidade não está cadastrada (Empresa › Unidades).');

/** Zod só do formato (para o que fica guardado: fluxos, automações). Quem confere se existe é quem salva. */
export const zIdUnidade = () => z.string().trim().regex(FORMATO_ID_UNIDADE, 'Unidade inválida.');

/**
 * Vista de compatibilidade: `UNIDADES[id]`, `id in UNIDADES` e `Object.keys(UNIDADES)` leem o cache da
 * empresa padrão. Código novo: prefira unidadeDe/unidadesDa.
 */
export const UNIDADES: Record<string, Unidade> = new Proxy({} as Record<string, Unidade>, {
  get: (_, id) => (typeof id === 'string' ? unidadeDe(id) : undefined),
  has: (_, id) => typeof id === 'string' && existeUnidade(id),
  ownKeys: () => listaDa().map((u) => u.id),
  getOwnPropertyDescriptor: (_, id) =>
    typeof id === 'string' && existeUnidade(id) ? { configurable: true, enumerable: true, writable: false, value: unidadeDe(id) } : undefined,
});

/** "Shopping Barra" no texto → a unidade (pelo nome, nome para clientes ou id; sem acento). */
export function unidadePorNome(texto: string, empresaId?: string): Unidade | undefined {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const t = norm(texto);
  const lista = unidadesDa(empresaId, { inativas: true });
  // Nome inteiro primeiro; depois a palavra mais marcante (a maior que não é comum a todas).
  const inteiro = lista.find((u) => t.includes(norm(u.nomeApp)) || t.includes(norm(u.nome)) || new RegExp(`\\b${u.id}\\b`).test(t));
  if (inteiro) return inteiro;
  const palavras = (u: Unidade) => norm(`${u.nomeApp} ${u.nome}`).split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !['shopping', 'unidade', 'loja', 'filial'].includes(p));
  return lista.find((u) => palavras(u).some((p) => new RegExp(`\\b${p}\\b`).test(t)));
}

/** Horário do cadastro (7 dias, src/empresa/cadastro.ts) → faixas por dia. */
export function faixasDoHorario(h: ReadonlyArray<{ dia: number; aberto: boolean; abre: string; fecha: string }> | null | undefined): Partial<Record<DiaSemana, Faixa>> {
  const r: Partial<Record<DiaSemana, Faixa>> = {};
  for (const d of h ?? []) if (d.aberto && d.dia >= 0 && d.dia <= 6) r[d.dia as DiaSemana] = { abre: d.abre, fecha: d.fecha };
  return r;
}

/** serena-regras: endereço do cadastro numa linha ("Av. Tancredo Neves, 148, 2º piso - Caminho das Árvores, Salvador/BA"). */
export function textoEndereco(e: { logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string } | null | undefined): string {
  if (!e) return '';
  const rua = [e.logradouro, e.numero].filter((x) => x?.trim()).join(', ');
  const linha = [rua, e.complemento?.trim()].filter(Boolean).join(', ');
  const cidade = [e.cidade?.trim(), e.uf?.trim()].filter(Boolean).join('/');
  return [linha, e.bairro?.trim(), cidade].filter(Boolean).join(' - ');
}
