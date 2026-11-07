import type pg from 'pg';
import type { Conversa, UnidadeId } from '../domain.js';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import type { Evento, Repositorio } from '../store/repositorio.js';

/**
 * Agenda (aba Agenda): os horários marcados pela Sintonia (IA ou equipe pelo botão "Agendar"), lidos dos eventos
 * agendamento_ia / agendamento_equipe. A integração com o Trinks não tem listagem da agenda inteira do salão
 * (só por cliente), então o que foi marcado direto no Trinks não aparece aqui.
 */

export interface ItemAgenda {
  /** trinksId quando há; senão, conversa + horário. */
  id: string;
  trinksId: number | null;
  conversaId: string;
  cliente: string | null;
  telefone: string;
  unidade: UnidadeId;
  servico: string | null;
  profissional: string | null;
  inicio: Date;
  duracaoMin: number;
  /** Quem marcou: "IA" ou o nome da atendente. */
  por: string;
  porIa: boolean;
  marcadoEm: Date;
}

const TIPOS = ['agendamento_ia', 'agendamento_equipe'] as const;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function paraItem(e: Evento, c: Pick<Conversa, 'id' | 'nome' | 'telefone' | 'unidade'>): ItemAgenda | null {
  const inicio = str(e.dados?.inicio);
  if (!inicio || Number.isNaN(Date.parse(inicio))) return null;
  const trinksId = typeof e.dados?.trinksId === 'number' ? e.dados.trinksId : null;
  const porIa = e.tipo === 'agendamento_ia';
  return {
    id: trinksId ? `t${trinksId}` : `${c.id}-${inicio}`,
    trinksId,
    conversaId: c.id,
    cliente: c.nome ?? null,
    telefone: c.telefone,
    unidade: (e.unidade ?? c.unidade) as UnidadeId,
    servico: str(e.dados?.servico),
    profissional: str(e.dados?.profissional),
    inicio: new Date(inicio),
    duracaoMin: typeof e.dados?.duracaoMin === 'number' && e.dados.duracaoMin > 0 ? e.dados.duracaoMin : 60,
    por: porIa ? 'IA' : (str(e.dados?.atendente) ?? 'Equipe'),
    porIa,
    marcadoEm: e.em,
  };
}

/** Agendamentos com horário em [inicio, fim), das conversas no escopo, em ordem de horário. */
export async function agendamentosEntre(repo: Repositorio, inicio: Date, fim: Date, escopo: EscopoVisao): Promise<ItemAgenda[]> {
  const pool = (repo as { pool?: pg.Pool }).pool;
  const itens: ItemAgenda[] = [];
  if (pool) {
    const { rows } = await pool.query<{ tipo: Evento['tipo']; unidade: string | null; dados: Record<string, unknown>; em: Date; id: string; nome: string | null; telefone: string; c_unidade: string; empresa_id: string; responsavel_id: string | null }>(
      `select e.tipo, e.unidade, e.dados, e.em, c.id, c.nome, c.telefone, c.unidade as c_unidade, c.empresa_id, c.responsavel_id::text as responsavel_id
         from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
        where e.tipo = any($1::text[]) and (e.dados->>'inicio') >= $2 and (e.dados->>'inicio') < $3`,
      [TIPOS, inicio.toISOString(), fim.toISOString()],
    );
    for (const r of rows) {
      const c = { id: r.id, nome: r.nome ?? undefined, telefone: r.telefone, unidade: r.c_unidade as UnidadeId };
      if (!noEscopo(escopo, { empresaId: r.empresa_id, unidade: c.unidade, responsavelId: r.responsavel_id ?? undefined })) continue;
      const i = paraItem({ tipo: r.tipo, unidade: (r.unidade ?? undefined) as UnidadeId | undefined, dados: r.dados, em: r.em, conversaId: r.id }, c);
      if (i) itens.push(i);
    }
  } else {
    const conversas = new Map((await repo.listarConversas()).filter((c) => noEscopo(escopo, c)).map((c) => [c.id, c]));
    for (const e of await repo.eventosEntre(new Date(0), new Date(8.64e15))) {
      if (!(TIPOS as readonly string[]).includes(e.tipo) || !e.conversaId) continue;
      const c = conversas.get(e.conversaId);
      if (!c) continue;
      const i = paraItem(e, c);
      if (i && i.inicio >= inicio && i.inicio < fim) itens.push(i);
    }
  }
  // O mesmo agendamento registrado duas vezes (ex.: conversas mescladas) aparece uma vez só.
  const unicos = new Map<string, ItemAgenda>();
  for (const i of itens) {
    const antes = unicos.get(i.id);
    if (!antes || antes.marcadoEm < i.marcadoEm) unicos.set(i.id, i);
  }
  return [...unicos.values()].sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || (a.cliente ?? '').localeCompare(b.cliente ?? '', 'pt-BR'));
}
