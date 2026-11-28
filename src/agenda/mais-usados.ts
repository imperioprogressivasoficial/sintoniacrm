import type pg from 'pg';
import type { UnidadeId } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';

/**
 * agendar-compacto: os serviços e profissionais mais marcados numa unidade (pela IA ou pela equipe no botão
 * "Agendar"), lidos dos eventos agendamento_ia / agendamento_equipe. O Agendar da conversa mostra estes primeiro,
 * no lugar da lista inteira. Os eventos guardam o NOME do serviço e da profissional (não o ID), então a tela casa
 * pelo nome.
 */

export interface ItemMaisUsado {
  nome: string;
  vezes: number;
}

export interface MaisUsados {
  servicos: ItemMaisUsado[];
  profissionais: ItemMaisUsado[];
}

const TIPOS = ['agendamento_ia', 'agendamento_equipe'];
const LIMITE = 30;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Conta e ordena: mais vezes primeiro; empate = o mais recente primeiro; depois o nome. */
export function contarMaisUsados(itens: Array<{ servico?: string | null; profissional?: string | null; em: Date }>): MaisUsados {
  const contar = (campo: 'servico' | 'profissional') => {
    const m = new Map<string, { nome: string; vezes: number; ultimo: number }>();
    for (const i of itens) {
      const nome = str(i[campo]);
      if (!nome) continue;
      const chave = nome.toLocaleLowerCase('pt-BR');
      const x = m.get(chave) ?? { nome, vezes: 0, ultimo: 0 };
      x.vezes += 1;
      if (i.em.getTime() >= x.ultimo) { x.ultimo = i.em.getTime(); x.nome = nome; }
      m.set(chave, x);
    }
    return [...m.values()]
      .sort((a, b) => b.vezes - a.vezes || b.ultimo - a.ultimo || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, LIMITE)
      .map(({ nome, vezes }) => ({ nome, vezes }));
  };
  return { servicos: contar('servico'), profissionais: contar('profissional') };
}

/** Agendamentos marcados pela Sintonia na unidade desde `desde` (pela data em que foram marcados). */
export async function maisUsadosDaUnidade(repo: Repositorio, empresaId: string, unidade: UnidadeId, desde: Date): Promise<MaisUsados> {
  const pool = (repo as { pool?: pg.Pool }).pool;
  if (pool) {
    const { rows } = await pool.query<{ servico: string | null; profissional: string | null; em: Date }>(
      `select e.dados->>'servico' as servico, e.dados->>'profissional' as profissional, e.em
         from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
        where e.tipo = any($1::text[]) and e.em >= $2 and c.empresa_id = $3 and coalesce(e.unidade, c.unidade) = $4
        order by e.em desc
        limit 2000`,
      [TIPOS, desde, empresaId, unidade],
    );
    return contarMaisUsados(rows);
  }
  const conversas = new Map((await repo.listarConversas()).filter((c) => (c.empresaId ?? empresaId) === empresaId).map((c) => [c.id, c]));
  const itens: Array<{ servico: string | null; profissional: string | null; em: Date }> = [];
  for (const e of await repo.eventosEntre(desde, new Date(8.64e15))) {
    if (!TIPOS.includes(e.tipo) || !e.conversaId) continue;
    const c = conversas.get(e.conversaId);
    if (!c || (e.unidade ?? c.unidade) !== unidade) continue;
    itens.push({ servico: str(e.dados?.servico), profissional: str(e.dados?.profissional), em: e.em });
  }
  return contarMaisUsados(itens);
}
