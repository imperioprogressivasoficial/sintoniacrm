import { z } from 'zod';
import type { Conversa } from '../domain.js';

/**
 * Filtro completo dos leads do pipeline (painel "Filtrar" do CRM, como no Kommo).
 * Vale para o quadro, para a lista e para a transmissão. Tudo é aplicado no servidor (as colunas são paginadas:
 * filtrar só o que já veio esconderia leads). Na memória (testes sem banco) os filtros que dependem de outras
 * tabelas — tarefas da Rotina, leituras por pessoa e campos da ficha — não se aplicam.
 */

const Uuid = z.string().uuid();
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.');

export const FiltroLeads = z.object({
  /** Só os leads de quem está vendo (vira `donas` no servidor). */
  meus: z.boolean().default(false),
  /** Ganhos: Compareceu (funil do sistema) ou a última etapa; perdidos: a etapa "Perdida". */
  situacao: z.enum(['ganhos', 'perdidos']).optional(),
  /** Tarefas abertas da Rotina ligadas à conversa. */
  tarefas: z.enum(['com', 'sem']).optional(),
  /** Só os leads da lixeira (excluídos e recuperáveis). */
  excluidos: z.boolean().default(false),
  /** Tags soltas: tem qualquer uma (ou todas, com `tagsTodas`). */
  tags: z.array(Uuid).max(30).default([]),
  tagsTodas: z.boolean().default(false),
  /** Só estas etapas do pipeline. */
  etapas: z.array(Uuid).max(60).default([]),
  /** Responsáveis ('sem' = sem responsável). */
  donas: z.array(z.union([Uuid, z.literal('sem')])).max(50).default([]),
  /** Nome ou telefone. */
  nome: z.string().trim().max(80).optional(),
  criadaDe: Data.optional(),
  criadaAte: Data.optional(),
  atualizadaDe: Data.optional(),
  atualizadaAte: Data.optional(),
  valorMin: z.number().min(0).max(10_000_000).optional(),
  valorMax: z.number().min(0).max(10_000_000).optional(),
  /** A última mensagem é da cliente e ninguém respondeu há pelo menos X horas. */
  semRespostaHoras: z.number().int().min(1).max(24 * 365).optional(),
  /** Com conversa (já trocou mensagem), sem conversa ou com mensagem não lida (por quem está vendo). */
  conversa: z.enum(['com', 'sem', 'nao_lidas']).optional(),
  /** Campos personalizados da ficha: `exato` compara o valor inteiro; senão, "contém". */
  campos: z.array(z.object({ id: Uuid, valor: z.string().trim().min(1).max(200), exato: z.boolean().default(false) })).max(10).default([]),
  /** Produtos e serviços vinculados ao lead (Empresa › Produtos e serviços): tem qualquer um deles. */
  produtos: z.array(Uuid).max(30).default([]),
  /** produtos-lead: categorias do cadastro: tem algum produto de qualquer uma delas. */
  categorias: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  /** produtos-lead: "propriedade vinculada" = empresa ligada ao contato (chave de Clientes › Empresas: "cnpj:…" ou "nome:…"). */
  empresas: z.array(z.string().trim().min(3).max(200)).max(20).default([]),
});
export type FiltroLeads = z.infer<typeof FiltroLeads>;

/** Lê o filtro que vem na URL (`?filtro=<json>`). Texto inválido = erro 400 com mensagem simples. */
export function lerFiltro(texto: string | undefined): FiltroLeads | undefined {
  if (!texto) return undefined;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    throw Object.assign(new Error('Filtro inválido.'), { statusCode: 400 });
  }
  const r = FiltroLeads.safeParse(bruto);
  if (!r.success) throw Object.assign(new Error(`Filtro inválido: ${r.error.issues[0]?.message ?? ''}`.trim()), { statusCode: 400 });
  return r.data;
}

/** O filtro tem alguma coisa ligada? */
export function filtroVazio(f: FiltroLeads | undefined): boolean {
  if (!f) return true;
  return (
    !f.meus && !f.situacao && !f.tarefas && !f.excluidos && !f.tags.length && !f.etapas.length && !f.donas.length && !f.nome &&
    !f.criadaDe && !f.criadaAte && !f.atualizadaDe && !f.atualizadaAte && f.valorMin === undefined && f.valorMax === undefined &&
    !f.semRespostaHoras && !f.conversa && !f.campos.length && !f.produtos.length && !f.categorias.length && !f.empresas.length
  );
}

/** Datas do filtro são dias na Bahia (UTC−3): "de" = 00:00 do dia; "até" = 00:00 do dia seguinte (exclusivo). */
export const inicioDia = (d: string) => new Date(`${d}T00:00:00-03:00`);
export const fimDia = (d: string) => new Date(inicioDia(d).getTime() + 24 * 3600_000);

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (x) => `\\${x}`);
const soDigitos = (s: string) => s.replace(/\D/g, '');

/** O filtro já resolvido pelo serviço: `meus` virou `donas`, `situacao` virou `etapas`. */
export interface FiltroResolvido extends FiltroLeads {
  /** Etapas que passam (null = todas). Vazio = nenhuma. */
  etapasOk: string[] | null;
  usuarioId?: string;
  /** Conversas que têm os produtos escolhidos (null = não filtra por produto). */
  comProdutos?: string[] | null;
  /** produtos-lead: telefones dos contatos ligados às empresas escolhidas (null = não filtra por empresa). */
  comTelefones?: string[] | null;
}

/**
 * Condições SQL (conversas `c`, conversa_tags `ct` do funil) do filtro completo.
 * Empurra os valores em `params` e devolve o texto para juntar com "and".
 */
export function sqlFiltroLeads(f: FiltroResolvido, params: unknown[], agora: Date): string {
  const partes: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  // lixeira: por padrão, quem foi excluído não aparece; com "Excluídos", só eles
  partes.push(`${f.excluidos ? '' : 'not '}exists (select 1 from sintonia.leads_excluidos lx where lx.funil_id = ct.funil_id and lx.conversa_id = c.id)`);
  if (f.etapasOk) partes.push(f.etapasOk.length ? `ct.tag_id = any(${p(f.etapasOk)}::uuid[])` : 'false');
  if (f.donas.length) {
    const ids = f.donas.filter((d) => d !== 'sem');
    const sem = f.donas.includes('sem');
    const cond = [ids.length ? `c.responsavel_id = any(${p(ids)}::uuid[])` : '', sem ? 'c.responsavel_id is null' : ''].filter(Boolean);
    partes.push(`(${cond.join(' or ')})`);
  }
  if (f.tags.length) {
    const t = p(f.tags);
    partes.push(
      f.tagsTodas
        ? `(select count(distinct x.tag_id) from sintonia.conversa_tags x where x.conversa_id = c.id and x.tag_id = any(${t}::uuid[])) = cardinality(${t}::uuid[])`
        : `exists (select 1 from sintonia.conversa_tags x where x.conversa_id = c.id and x.tag_id = any(${t}::uuid[]))`,
    );
  }
  if (f.nome) {
    const dig = /\p{L}/u.test(f.nome) ? '' : soDigitos(f.nome);
    const n = p(`%${escaparLike(f.nome)}%`);
    partes.push(dig.length >= 3 ? `(c.nome ilike ${n} or c.telefone like ${p(`%${dig}%`)})` : `c.nome ilike ${n}`);
  }
  if (f.criadaDe) partes.push(`c.criada_em >= ${p(inicioDia(f.criadaDe))}`);
  if (f.criadaAte) partes.push(`c.criada_em < ${p(fimDia(f.criadaAte))}`);
  if (f.atualizadaDe) partes.push(`c.atualizada_em >= ${p(inicioDia(f.atualizadaDe))}`);
  if (f.atualizadaAte) partes.push(`c.atualizada_em < ${p(fimDia(f.atualizadaAte))}`);
  if (f.valorMin !== undefined || f.valorMax !== undefined) {
    const cond = ['vv.valor is not null'];
    if (f.valorMin !== undefined) cond.push(`vv.valor >= ${p(f.valorMin)}`);
    if (f.valorMax !== undefined) cond.push(`vv.valor <= ${p(f.valorMax)}`);
    partes.push(`exists (select 1 from sintonia.cartao_valores vv where vv.conversa_id = c.id and ${cond.join(' and ')})`);
  }
  // "esperando": a última mensagem é da cliente (mesma regra da lista de Conversas)
  const esperando = `c.ultima_mensagem_cliente is not null and c.ultima_mensagem_cliente > greatest(coalesce(c.ultima_mensagem_equipe, '-infinity'::timestamptz), coalesce(c.ultima_mensagem_ia, '-infinity'::timestamptz))`;
  if (f.semRespostaHoras) partes.push(`(${esperando} and c.ultima_mensagem_cliente < ${p(new Date(agora.getTime() - f.semRespostaHoras * 3600_000))})`);
  if (f.conversa === 'com') partes.push('exists (select 1 from sintonia.mensagens m where m.conversa_id = c.id)');
  if (f.conversa === 'sem') partes.push('not exists (select 1 from sintonia.mensagens m where m.conversa_id = c.id)');
  if (f.conversa === 'nao_lidas') {
    if (f.usuarioId) {
      const u = p(f.usuarioId);
      partes.push(
        `(exists (select 1 from sintonia.marcadas_nao_lidas mn where mn.usuario_id = ${u}::uuid and mn.conversa_id = c.id)
          or (${esperando} and not exists (select 1 from sintonia.leituras l where l.usuario_id = ${u}::uuid and l.conversa_id = c.id and l.lida_ate >= c.ultima_mensagem_cliente)))`,
      );
    } else partes.push(`(${esperando})`);
  }
  if (f.tarefas) {
    partes.push(`${f.tarefas === 'sem' ? 'not ' : ''}exists (select 1 from sintonia.rotina_tarefas rt where rt.conversa_id = c.id and rt.empresa_id = c.empresa_id and not rt.feita)`);
  }
  for (const campo of f.campos) {
    const id = p(campo.id);
    const v = p(campo.exato ? campo.valor : `%${escaparLike(campo.valor)}%`);
    partes.push(`exists (select 1 from sintonia.contatos k where k.empresa_id = c.empresa_id and k.telefone = c.telefone and (k.campos ->> ${id}) ilike ${v})`);
  }
  if (f.comProdutos) partes.push(f.comProdutos.length ? `c.id = any(${p(f.comProdutos)}::uuid[])` : 'false');
  if (f.comTelefones) partes.push(f.comTelefones.length ? `c.telefone = any(${p(f.comTelefones)}::text[])` : 'false');
  return partes.join(' and ');
}

/** O mesmo filtro na memória (testes sem banco). Tarefas, leituras e campos da ficha não se aplicam aqui. */
export function passaFiltroLeads(
  f: FiltroResolvido,
  x: { conversa: Conversa; tagId: string; excluido: boolean; tags: string[]; valor: number | null; temMensagem: boolean },
  agora: Date,
): boolean {
  const c = x.conversa;
  if (x.excluido !== f.excluidos) return false;
  if (f.etapasOk && !f.etapasOk.includes(x.tagId)) return false;
  if (f.donas.length && !f.donas.some((d) => (d === 'sem' ? !c.responsavelId : c.responsavelId === d))) return false;
  if (f.tags.length && !(f.tagsTodas ? f.tags.every((t) => x.tags.includes(t)) : f.tags.some((t) => x.tags.includes(t)))) return false;
  if (f.nome) {
    const busca = f.nome.toLowerCase();
    const dig = /\p{L}/u.test(busca) ? '' : soDigitos(busca);
    if (!(c.nome ?? '').toLowerCase().includes(busca) && !(dig.length >= 3 && c.telefone.includes(dig))) return false;
  }
  const t = (d?: Date) => (d ? new Date(d).getTime() : 0);
  if (f.criadaDe && t(c.criadaEm) < inicioDia(f.criadaDe).getTime()) return false;
  if (f.criadaAte && t(c.criadaEm) >= fimDia(f.criadaAte).getTime()) return false;
  if (f.atualizadaDe && t(c.atualizadaEm) < inicioDia(f.atualizadaDe).getTime()) return false;
  if (f.atualizadaAte && t(c.atualizadaEm) >= fimDia(f.atualizadaAte).getTime()) return false;
  if (f.valorMin !== undefined && (x.valor === null || x.valor < f.valorMin)) return false;
  if (f.valorMax !== undefined && (x.valor === null || x.valor > f.valorMax)) return false;
  const esperando = !!c.ultimaMensagemCliente && t(c.ultimaMensagemCliente) > Math.max(t(c.ultimaMensagemEquipe), t(c.ultimaMensagemIa));
  if (f.semRespostaHoras && !(esperando && t(c.ultimaMensagemCliente) < agora.getTime() - f.semRespostaHoras * 3600_000)) return false;
  if (f.conversa === 'com' && !x.temMensagem) return false;
  if (f.conversa === 'sem' && x.temMensagem) return false;
  if (f.conversa === 'nao_lidas' && !esperando) return false;
  if (f.tarefas === 'com') return false; // sem Rotina na memória: ninguém tem tarefa
  if (f.campos.length) return false; // sem ficha na memória
  if (f.comProdutos && !f.comProdutos.includes(c.id)) return false;
  if (f.comTelefones && !f.comTelefones.includes(c.telefone)) return false;
  return true;
}
