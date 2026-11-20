import type pg from 'pg';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import type { Repositorio } from '../store/repositorio.js';
import { DIA } from '../util/tempo.js';
import { gradeDe, gradeVazia, type AgendamentoCliente, type ConversaFunil, type Grade, type MudancaEtapa, type SerieHorario } from './calculo.js';

/**
 * De onde saem os dados das Análises (só leitura). O Postgres agrega no banco (contagens por dia da semana e hora
 * já vêm somadas); a memória serve os testes e o uso local. Sempre no escopo de quem pede (empresa, unidades e,
 * para quem só vê as próprias conversas, a dona) e, com `atendente`, só as conversas de que ela é a dona.
 */
export interface LeadDoPeriodo {
  conversaId: string;
  em: Date;
  importado: boolean;
  canalId: string;
}

export interface FonteAnalises {
  leads(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string): Promise<LeadDoPeriodo[]>;
  grades(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string): Promise<Record<SerieHorario, Grade>>;
  funil(desde: Date, agora: Date, escopo: EscopoVisao, atendente?: string): Promise<{ mudancas: MudancaEtapa[]; conversas: ConversaFunil[] }>;
  agendamentos(desde: Date, ate: Date, escopo: EscopoVisao, atendente?: string): Promise<AgendamentoCliente[]>;
}

const TIPOS_LEAD = ['conversa_nova', 'lead_importado'];
const TIPOS_AG = ['agendamento_ia', 'agendamento_equipe'];
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
/** Quanto tempo para trás olhar as mudanças de etapa (para saber desde quando a conversa estava na etapa). */
export const HISTORICO_FUNIL_MS = 365 * DIA;

export class FonteAnalisesPostgres implements FonteAnalises {
  constructor(private readonly pool: pg.Pool) {}

  /** Condição de escopo + dona (atendente) sobre `c`, acrescentando os valores em params. */
  private onde(escopo: EscopoVisao, atendente: string | undefined, params: unknown[]): string {
    let w = sqlEscopo(escopo, 'c', params);
    if (atendente) {
      params.push(atendente);
      w += ` and c.responsavel_id::text = $${params.length}`;
    }
    return w;
  }

  async leads(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string): Promise<LeadDoPeriodo[]> {
    const p: unknown[] = [inicio, fim, TIPOS_LEAD];
    const w = this.onde(escopo, atendente, p);
    const r = await this.pool.query<{ conversa_id: string; em: Date; tipo: string; canal_id: string }>(
      `select distinct on (e.conversa_id) e.conversa_id::text as conversa_id, e.em, e.tipo, c.canal_id
         from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
        where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${w}
        order by e.conversa_id, e.em`,
      p,
    );
    return r.rows.map((x) => ({ conversaId: x.conversa_id, em: x.em, importado: x.tipo === 'lead_importado', canalId: x.canal_id }));
  }

  async grades(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string): Promise<Record<SerieHorario, Grade>> {
    const local = (col: string) => `extract(dow from ${col} at time zone 'America/Bahia')::int as d, extract(hour from ${col} at time zone 'America/Bahia')::int as h`;
    const pl: unknown[] = [inicio, fim, TIPOS_LEAD];
    const wl = this.onde(escopo, atendente, pl);
    const pm: unknown[] = [inicio, fim];
    const wm = this.onde(escopo, atendente, pm);
    const pa: unknown[] = [inicio, fim, TIPOS_AG];
    const wa = this.onde(escopo, atendente, pa);
    type Linha = { d: number; h: number; n: number };
    const [l, m, a] = await Promise.all([
      this.pool.query<Linha>(
        `select x.d, x.h, count(*)::int as n from (
           select distinct on (e.conversa_id) ${local('e.em')}
             from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
            where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${wl}
            order by e.conversa_id, e.em) x
         group by x.d, x.h`,
        pl,
      ),
      this.pool.query<Linha>(
        `select ${local('m.em')}, count(*)::int as n
           from sintonia.mensagens m join sintonia.conversas c on c.id = m.conversa_id
          where m.em >= $1 and m.em < $2 and m.autor = 'cliente' and ${wm}
          group by 1, 2`,
        pm,
      ),
      this.pool.query<Linha>(
        `select ${local('e.em')}, count(*)::int as n
           from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${wa}
          group by 1, 2`,
        pa,
      ),
    ]);
    const montar = (linhas: Linha[]) => {
      const g = gradeVazia();
      for (const r of linhas) g[r.d]![r.h]! += r.n;
      return g;
    };
    return { leads: montar(l.rows), mensagens: montar(m.rows), agendamentos: montar(a.rows) };
  }

  async funil(desde: Date, agora: Date, escopo: EscopoVisao, atendente?: string) {
    const pm: unknown[] = [desde, agora];
    const wm = this.onde(escopo, atendente, pm);
    const pc: unknown[] = [];
    const wc = this.onde(escopo, atendente, pc);
    const [m, c] = await Promise.all([
      this.pool.query<{ conversa_id: string; em: Date; de: string | null; para: string; motivo: string | null }>(
        `select e.conversa_id::text as conversa_id, e.em, e.dados->>'de' as de, e.dados->>'para' as para, e.dados->>'motivo' as motivo
           from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where e.em >= $1 and e.em <= $2 and e.tipo = 'etapa_mudou' and e.dados->>'para' is not null and ${wm}
          order by e.em`,
        pm,
      ),
      this.pool.query<{ id: string; nome: string | null; unidade: string; etapa: string; criada_em: Date }>(
        `select c.id::text as id, c.nome, c.unidade, c.etapa, c.criada_em from sintonia.conversas c where ${wc}`,
        pc,
      ),
    ]);
    return {
      mudancas: m.rows.map((r) => ({ conversaId: r.conversa_id, em: r.em, de: r.de, para: r.para, motivo: r.motivo })),
      conversas: c.rows.map((r) => ({ id: r.id, nome: r.nome, unidade: r.unidade, etapa: r.etapa, criadaEm: r.criada_em })),
    };
  }

  async agendamentos(desde: Date, ate: Date, escopo: EscopoVisao, atendente?: string): Promise<AgendamentoCliente[]> {
    const p: unknown[] = [desde, ate, TIPOS_AG];
    const w = this.onde(escopo, atendente, p);
    const r = await this.pool.query<{ conversa_id: string; em: Date; nome: string | null; dados: Record<string, unknown> | null; compareceu: boolean }>(
      `select e.conversa_id::text as conversa_id, e.em, c.nome, e.dados,
              (c.etapa = 'compareceu' or exists (select 1 from sintonia.eventos x where x.conversa_id = e.conversa_id and x.tipo = 'etapa_mudou'
                                                  and x.dados->>'para' = 'compareceu' and x.em >= e.em)) as compareceu
         from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
        where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${w}
        order by e.em`,
      p,
    );
    return r.rows.map((x) => ({ conversaId: x.conversa_id, em: x.em, nome: x.nome, servico: str(x.dados?.servico), valor: num(x.dados?.valor), compareceu: x.compareceu }));
  }
}

export class FonteAnalisesMemoria implements FonteAnalises {
  constructor(private readonly repo: Repositorio) {}

  private async conversas(escopo: EscopoVisao, atendente?: string) {
    return new Map(
      (await this.repo.listarConversas()).filter((c) => noEscopo(escopo, c) && (!atendente || c.responsavelId === atendente)).map((c) => [c.id, c]),
    );
  }

  private async eventos(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string) {
    const cs = await this.conversas(escopo, atendente);
    const ev = (await this.repo.eventosEntre(inicio, fim)).filter((e) => e.conversaId && cs.has(e.conversaId) && e.em < fim);
    return { cs, ev };
  }

  async leads(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string): Promise<LeadDoPeriodo[]> {
    const { cs, ev } = await this.eventos(inicio, fim, escopo, atendente);
    const vistos = new Map<string, LeadDoPeriodo>();
    for (const e of [...ev].sort((a, b) => a.em.getTime() - b.em.getTime())) {
      if (!TIPOS_LEAD.includes(e.tipo) || vistos.has(e.conversaId!)) continue;
      vistos.set(e.conversaId!, { conversaId: e.conversaId!, em: e.em, importado: e.tipo === 'lead_importado', canalId: cs.get(e.conversaId!)!.canalId });
    }
    return [...vistos.values()];
  }

  async grades(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string): Promise<Record<SerieHorario, Grade>> {
    const { cs, ev } = await this.eventos(inicio, fim, escopo, atendente);
    const leads = (await this.leads(inicio, fim, escopo, atendente)).map((l) => l.em);
    const ags = ev.filter((e) => TIPOS_AG.includes(e.tipo)).map((e) => e.em);
    const msgs: Date[] = [];
    for (const id of cs.keys()) for (const m of await this.repo.mensagens(id, 1_000_000)) if (m.autor === 'cliente' && m.em >= inicio && m.em < fim) msgs.push(m.em);
    return { leads: gradeDe(leads), mensagens: gradeDe(msgs), agendamentos: gradeDe(ags) };
  }

  async funil(desde: Date, agora: Date, escopo: EscopoVisao, atendente?: string) {
    const { cs, ev } = await this.eventos(desde, new Date(agora.getTime() + 1), escopo, atendente);
    const mudancas: MudancaEtapa[] = ev
      .filter((e) => e.tipo === 'etapa_mudou' && str(e.dados?.para))
      .map((e) => ({ conversaId: e.conversaId!, em: e.em, de: str(e.dados?.de), para: str(e.dados?.para)!, motivo: str(e.dados?.motivo) }));
    const conversas: ConversaFunil[] = [...cs.values()].map((c) => ({ id: c.id, nome: c.nome ?? null, unidade: c.unidade, etapa: c.etapa, criadaEm: c.criadaEm }));
    return { mudancas, conversas };
  }

  async agendamentos(desde: Date, ate: Date, escopo: EscopoVisao, atendente?: string): Promise<AgendamentoCliente[]> {
    const { cs } = await this.eventos(desde, ate, escopo, atendente);
    const todos = (await this.repo.eventosEntre(desde, new Date(8.64e15))).filter((e) => e.conversaId && cs.has(e.conversaId));
    return todos
      .filter((e) => TIPOS_AG.includes(e.tipo) && e.em < ate)
      .sort((a, b) => a.em.getTime() - b.em.getTime())
      .map((e) => {
        const c = cs.get(e.conversaId!)!;
        const compareceu = c.etapa === 'compareceu' || todos.some((x) => x.conversaId === c.id && x.tipo === 'etapa_mudou' && x.dados?.para === 'compareceu' && x.em >= e.em);
        return { conversaId: c.id, em: e.em, nome: c.nome ?? null, servico: str(e.dados?.servico), valor: num(e.dados?.valor), compareceu };
      });
  }
}
