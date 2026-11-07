import type pg from 'pg';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import type { Repositorio } from '../store/repositorio.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import { primeiroNome, type Atendimento, type Venda } from './calculo.js';

/**
 * De onde saem os números do comercial: os eventos agendamento_ia / agendamento_equipe (venda),
 * etapa_mudou → compareceu (comparecimento, em qualquer momento depois do agendamento) e equipe_respondeu
 * (conversas atendidas e 1ª resposta). Postgres agrega no banco; a memória serve os testes e o uso local.
 */
export interface DadosComercial {
  vendas: Venda[];
  atendimento: Atendimento[];
}

export interface FonteComercial {
  carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<DadosComercial>;
}

const TIPOS = ['agendamento_ia', 'agendamento_equipe'];
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

function venda(tipo: string, em: Date, unidade: string, dados: Record<string, unknown> | undefined, c: { id: string; nome?: string | null; responsavelId?: string | null }, compareceu: boolean): Venda {
  const porIa = tipo === 'agendamento_ia';
  return {
    conversaId: c.id,
    unidade,
    servico: str(dados?.servico),
    atendenteId: porIa ? null : str(dados?.atendenteId),
    atendenteNome: porIa ? null : str(dados?.atendente),
    responsavelId: c.responsavelId ?? null,
    porIa,
    em,
    valor: num(dados?.valor),
    compareceu,
    primeiroNome: primeiroNome(c.nome),
  };
}

export class FonteComercialPostgres implements FonteComercial {
  constructor(private readonly pool: pg.Pool) {}

  async carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<DadosComercial> {
    const p1: unknown[] = [inicio, fim, TIPOS];
    const onde1 = sqlEscopo(escopo, 'c', p1);
    const p2: unknown[] = [inicio, fim];
    const onde2 = sqlEscopo(escopo, 'c', p2);
    const [v, a] = await Promise.all([
      this.pool.query<{ tipo: string; em: Date; unidade: string; dados: Record<string, unknown>; id: string; nome: string | null; responsavel_id: string | null; compareceu: boolean }>(
        `select e.tipo, e.em, coalesce(e.unidade, c.unidade) as unidade, e.dados, c.id, c.nome, c.responsavel_id::text as responsavel_id,
                (c.etapa = 'compareceu' or exists (select 1 from sintonia.eventos x where x.conversa_id = e.conversa_id and x.tipo = 'etapa_mudou'
                                                    and x.dados->>'para' = 'compareceu' and x.em >= e.em)) as compareceu
           from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${onde1}
          order by e.em`,
        p1,
      ),
      this.pool.query<{ id: string; nome: string | null; conversas: number; st: number; nt: number }>(
        `select s.id, max(s.nome) as nome, count(*)::int as conversas,
                coalesce(sum(s.t), 0)::float8 as st, count(s.t)::int as nt
           from (select distinct on (e.dados->>'atendenteId', e.conversa_id)
                        e.dados->>'atendenteId' as id, e.dados->>'atendente' as nome,
                        case when jsonb_typeof(e.dados->'tempoRespostaMs') = 'number' then (e.dados->>'tempoRespostaMs')::float8 end as t
                   from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
                  where e.em >= $1 and e.em < $2 and e.tipo = 'equipe_respondeu' and e.dados->>'atendenteId' is not null and ${onde2}
                  order by e.dados->>'atendenteId', e.conversa_id, e.em) s
          group by s.id`,
        p2,
      ),
    ]);
    return {
      vendas: v.rows.map((r) => venda(r.tipo, r.em, r.unidade, r.dados, { id: r.id, nome: r.nome, responsavelId: r.responsavel_id }, r.compareceu)),
      atendimento: a.rows.map((r) => ({ id: r.id, nome: r.nome ?? 'Atendente', conversas: r.conversas, primeiraMs: r.st, primeiraN: r.nt })),
    };
  }
}

export class FonteComercialMemoria implements FonteComercial {
  constructor(private readonly repo: Repositorio) {}

  async carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<DadosComercial> {
    const conversas = new Map((await this.repo.listarConversas()).filter((c) => noEscopo(escopo, c)).map((c) => [c.id, c]));
    const eventos = (await this.repo.eventosEntre(inicio, new Date(8.64e15))).filter((e) => e.conversaId && conversas.has(e.conversaId));
    const vendas: Venda[] = [];
    const porAtendente = new Map<string, { nome: string; conversas: Map<string, number | null> }>();
    for (const e of eventos) {
      if (e.em >= fim) continue;
      const c = conversas.get(e.conversaId!)!;
      if (TIPOS.includes(e.tipo)) {
        const comp = c.etapa === 'compareceu' || eventos.some((x) => x.conversaId === c.id && x.tipo === 'etapa_mudou' && x.dados?.para === 'compareceu' && x.em >= e.em);
        vendas.push(venda(e.tipo, e.em, e.unidade ?? c.unidade, e.dados, { id: c.id, nome: c.nome, responsavelId: c.responsavelId }, comp));
      }
      if (e.tipo === 'equipe_respondeu') {
        const id = str(e.dados?.atendenteId);
        if (!id) continue;
        let a = porAtendente.get(id);
        if (!a) porAtendente.set(id, (a = { nome: str(e.dados?.atendente) ?? 'Atendente', conversas: new Map() }));
        if (!a.conversas.has(c.id)) a.conversas.set(c.id, typeof e.dados?.tempoRespostaMs === 'number' ? e.dados.tempoRespostaMs : null);
      }
    }
    vendas.sort((a, b) => a.em.getTime() - b.em.getTime());
    const atendimento = [...porAtendente].map(([id, a]) => {
      const tempos = [...a.conversas.values()].filter((t): t is number => t !== null);
      return { id, nome: a.nome, conversas: a.conversas.size, primeiraMs: tempos.reduce((s, t) => s + t, 0), primeiraN: tempos.length };
    });
    return { vendas, atendimento };
  }
}
