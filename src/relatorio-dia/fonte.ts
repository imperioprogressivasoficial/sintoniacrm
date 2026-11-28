import type pg from 'pg';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import type { Conversa } from '../domain.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { DIA, MIN } from '../util/tempo.js';
import { SILENCIO_RETORNO_MS, type AgendamentoBruto, type ChegadaBruta, type DadosRelatorioDia, type RetomadaBruta } from './calculo.js';

/**
 * relatorio-dia: de onde saem os dados do "Dia a dia" (só leitura). Sempre da empresa inteira (o telefone que já
 * agendou numa unidade é Retorno na outra); quem vê o quê (unidades, só as próprias) é filtrado no cálculo.
 * Postgres para valer; memória para os testes e o uso local.
 */
export interface LeadParado {
  conversaId: string;
  nome: string | null;
  unidade: string;
  responsavelId: string | null;
  /** Última mensagem da cliente, ainda sem resposta. */
  desde: Date;
}

export interface FonteRelatorioDia {
  /** Entradas em [inicio, fim), agendamentos de `HISTORICO_MS` antes do início até o fim, e retomadas em [inicio, fim). */
  carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<DadosRelatorioDia>;
  /** Conversas em que a cliente escreveu por último há mais de 30 min (e menos de 7 dias) e ninguém respondeu. */
  parados(escopo: EscopoVisao, agora: Date): Promise<LeadParado[]>;
}

/** Quanto olhar para trás para saber quem já tinha agendado (Retorno). */
export const HISTORICO_MS = 400 * DIA;
export const PARADO_APOS_MS = 30 * MIN;
const PARADO_ATE_MS = 7 * DIA;

const TIPOS_LEAD = ['conversa_nova', 'lead_importado'];
const TIPOS_AG = ['agendamento_ia', 'agendamento_equipe'];
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const remarcado = (d: Record<string, unknown> | null | undefined) => Boolean(d && (d.remarcadoDe || d.remarcado === true));
/** Só a empresa (o resto do escopo é filtro do cálculo). */
const daEmpresa = (e: EscopoVisao): EscopoVisao => (e.empresaId ? { empresaId: e.empresaId } : {});

export class FonteRelatorioDiaPostgres implements FonteRelatorioDia {
  constructor(private readonly pool: pg.Pool) {}

  async carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<DadosRelatorioDia> {
    const emp = daEmpresa(escopo);
    const pc: unknown[] = [inicio, fim, TIPOS_LEAD];
    const wc = sqlEscopo(emp, 'c', pc);
    const pa: unknown[] = [new Date(inicio.getTime() - HISTORICO_MS), fim, TIPOS_AG, TIPOS_LEAD, inicio];
    const wa = sqlEscopo(emp, 'c', pa);
    const pr: unknown[] = [inicio, fim, TIPOS_AG, `${Math.round(SILENCIO_RETORNO_MS / 1000)} seconds`];
    const wr = sqlEscopo(emp, 'c', pr);
    type Conv = { conversa_id: string; telefone: string; nome: string | null; unidade: string; responsavel_id: string | null };
    const [c, a, r] = await Promise.all([
      this.pool.query<Conv & { em: Date; tipo: string; primeira: Date | null }>(
        `with prim as (
           select distinct on (e.conversa_id) e.conversa_id, e.em, e.tipo
             from sintonia.eventos e
            where e.tipo = any($3::text[])
              and e.conversa_id in (select x.conversa_id from sintonia.eventos x where x.tipo = any($3::text[]) and x.em >= $1 and x.em < $2)
            order by e.conversa_id, e.em)
         select p.conversa_id::text as conversa_id, p.em, p.tipo, c.telefone, c.nome, c.unidade, c.responsavel_id::text as responsavel_id,
                (select min(m.em) from sintonia.mensagens m where m.conversa_id = p.conversa_id) as primeira
           from prim p join sintonia.conversas c on c.id = p.conversa_id
          where p.em >= $1 and p.em < $2 and ${wc}`,
        pc,
      ),
      this.pool.query<Conv & { em: Date; tipo: string; dados: Record<string, unknown> | null; compareceu: boolean | null; faltou: boolean | null; chegada_em: Date | null; chegada_tipo: string | null; primeira: Date | null }>(
        `select e.conversa_id::text as conversa_id, e.em, e.tipo, e.dados, c.telefone, c.nome, c.unidade, c.responsavel_id::text as responsavel_id,
                case when e.em >= $5 then (c.etapa = 'compareceu' or exists (select 1 from sintonia.eventos x where x.conversa_id = e.conversa_id and x.tipo = 'etapa_mudou'
                                                    and x.dados->>'para' = 'compareceu' and x.em >= e.em)) end as compareceu,
                case when e.em >= $5 then exists (select 1 from sintonia.eventos x where x.conversa_id = e.conversa_id and x.tipo = 'etapa_mudou'
                                                    and x.dados->>'motivo' = 'cliente_faltou' and x.em >= e.em) end as faltou,
                ch.em as chegada_em, ch.tipo as chegada_tipo,
                case when e.em >= $5 then (select min(m.em) from sintonia.mensagens m where m.conversa_id = e.conversa_id) end as primeira
           from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
           left join lateral (select y.em, y.tipo from sintonia.eventos y where y.conversa_id = e.conversa_id and y.tipo = any($4::text[]) order by y.em limit 1) ch on true
          where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${wa}
          order by e.em`,
        pa,
      ),
      this.pool.query<Conv & { em: Date }>(
        `select distinct on (e.conversa_id) e.conversa_id::text as conversa_id, e.em, c.telefone, c.nome, c.unidade, c.responsavel_id::text as responsavel_id
           from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where e.tipo = 'mensagem_cliente' and e.em >= $1 and e.em < $2 and ${wr}
            and not exists (select 1 from sintonia.eventos x where x.conversa_id = e.conversa_id and x.tipo = 'mensagem_cliente'
                             and x.em < e.em and x.em >= e.em - $4::interval)
            and exists (select 1 from sintonia.eventos y where y.conversa_id = e.conversa_id and y.tipo = any($3::text[]) and y.em < e.em)
          order by e.conversa_id, e.em`,
        pr,
      ),
    ]);
    const conv = (x: Conv) => ({ conversaId: x.conversa_id, telefone: x.telefone, nome: x.nome, unidade: x.unidade, responsavelId: x.responsavel_id });
    return {
      chegadas: c.rows.map((x) => ({ ...conv(x), em: x.em, tipo: x.tipo === 'lead_importado' ? 'lead_importado' : 'conversa_nova', primeiraMensagemEm: x.primeira })),
      agendamentos: a.rows.map((x) => ({
        ...conv(x),
        em: x.em,
        porIa: x.tipo === 'agendamento_ia',
        atendenteId: x.tipo === 'agendamento_ia' ? null : str(x.dados?.atendenteId),
        atendenteNome: x.tipo === 'agendamento_ia' ? null : str(x.dados?.atendente),
        remarcado: remarcado(x.dados),
        compareceu: Boolean(x.compareceu),
        faltou: Boolean(x.faltou),
        chegadaEm: x.chegada_em,
        chegadaTipo: x.chegada_tipo === 'conversa_nova' || x.chegada_tipo === 'lead_importado' ? x.chegada_tipo : null,
        primeiraMensagemEm: x.primeira,
      })),
      retomadas: r.rows.map((x) => ({ ...conv(x), em: x.em })),
    };
  }

  async parados(escopo: EscopoVisao, agora: Date): Promise<LeadParado[]> {
    const p: unknown[] = [new Date(agora.getTime() - PARADO_APOS_MS), new Date(agora.getTime() - PARADO_ATE_MS)];
    const w = sqlEscopo(escopo, 'c', p);
    const r = await this.pool.query<{ id: string; nome: string | null; unidade: string; responsavel_id: string | null; desde: Date }>(
      `select c.id::text as id, c.nome, c.unidade, c.responsavel_id::text as responsavel_id, c.ultima_mensagem_cliente as desde
         from sintonia.conversas c
        where c.ultima_mensagem_cliente < $1 and c.ultima_mensagem_cliente > $2
          and c.ultima_mensagem_cliente > coalesce(greatest(c.ultima_mensagem_equipe, c.ultima_mensagem_ia), '-infinity'::timestamptz)
          and c.etapa <> 'perdida' and ${w}
        order by c.ultima_mensagem_cliente
        limit 500`,
      p,
    );
    return r.rows.map((x) => ({ conversaId: x.id, nome: x.nome, unidade: x.unidade, responsavelId: x.responsavel_id, desde: x.desde }));
  }
}

export class FonteRelatorioDiaMemoria implements FonteRelatorioDia {
  constructor(private readonly repo: Repositorio) {}

  async carregar(inicio: Date, fim: Date, escopo: EscopoVisao): Promise<DadosRelatorioDia> {
    const emp = daEmpresa(escopo);
    const cs = new Map((await this.repo.listarConversas()).filter((c) => noEscopo(emp, c)).map((c) => [c.id, c]));
    const todos = (await this.repo.eventosEntre(new Date(0), new Date(8.64e15))).filter((e) => e.conversaId && cs.has(e.conversaId)).sort((a, b) => a.em.getTime() - b.em.getTime());
    const primeiraMsg = new Map<string, Date | null>();
    const primeira = async (id: string) => {
      if (!primeiraMsg.has(id)) {
        const ms = await this.repo.mensagens(id, 1_000_000);
        primeiraMsg.set(id, ms.length ? new Date(Math.min(...ms.map((m) => m.em.getTime()))) : null);
      }
      return primeiraMsg.get(id)!;
    };
    const chegadaDe = new Map<string, Evento>();
    for (const e of todos) if (TIPOS_LEAD.includes(e.tipo) && !chegadaDe.has(e.conversaId!)) chegadaDe.set(e.conversaId!, e);
    const conv = (c: Conversa) => ({ conversaId: c.id, telefone: c.telefone, nome: c.nome ?? null, unidade: c.unidade, responsavelId: c.responsavelId ?? null });

    const chegadas: ChegadaBruta[] = [];
    for (const [id, e] of chegadaDe) {
      if (e.em < inicio || e.em >= fim) continue;
      chegadas.push({ ...conv(cs.get(id)!), em: e.em, tipo: e.tipo === 'lead_importado' ? 'lead_importado' : 'conversa_nova', primeiraMensagemEm: await primeira(id) });
    }
    const desde = new Date(inicio.getTime() - HISTORICO_MS);
    const agendamentos: AgendamentoBruto[] = [];
    for (const e of todos) {
      if (!TIPOS_AG.includes(e.tipo) || e.em < desde || e.em >= fim) continue;
      const c = cs.get(e.conversaId!)!;
      const depois = todos.filter((x) => x.conversaId === c.id && x.tipo === 'etapa_mudou' && x.em >= e.em);
      const ch = chegadaDe.get(c.id);
      const porIa = e.tipo === 'agendamento_ia';
      agendamentos.push({
        ...conv(c),
        em: e.em,
        porIa,
        atendenteId: porIa ? null : str(e.dados?.atendenteId),
        atendenteNome: porIa ? null : str(e.dados?.atendente),
        remarcado: remarcado(e.dados),
        compareceu: e.em >= inicio && (c.etapa === 'compareceu' || depois.some((x) => x.dados?.para === 'compareceu')),
        faltou: e.em >= inicio && depois.some((x) => x.dados?.motivo === 'cliente_faltou'),
        chegadaEm: ch?.em ?? null,
        chegadaTipo: ch ? (ch.tipo === 'lead_importado' ? 'lead_importado' : 'conversa_nova') : null,
        primeiraMensagemEm: e.em >= inicio ? await primeira(c.id) : null,
      });
    }
    const retomadas: RetomadaBruta[] = [];
    const vistos = new Set<string>();
    for (const e of todos) {
      if (e.tipo !== 'mensagem_cliente' || e.em < inicio || e.em >= fim || vistos.has(e.conversaId!)) continue;
      const doc = todos.filter((x) => x.conversaId === e.conversaId && x.em < e.em);
      if (doc.some((x) => x.tipo === 'mensagem_cliente' && x.em.getTime() >= e.em.getTime() - SILENCIO_RETORNO_MS)) continue;
      if (!doc.some((x) => TIPOS_AG.includes(x.tipo))) continue;
      vistos.add(e.conversaId!);
      retomadas.push({ ...conv(cs.get(e.conversaId!)!), em: e.em });
    }
    return { chegadas, agendamentos, retomadas };
  }

  async parados(escopo: EscopoVisao, agora: Date): Promise<LeadParado[]> {
    const ate = agora.getTime() - PARADO_APOS_MS;
    const de = agora.getTime() - PARADO_ATE_MS;
    return (await this.repo.listarConversas())
      .filter((c) => noEscopo(escopo, c) && c.etapa !== 'perdida' && c.ultimaMensagemCliente)
      .filter((c) => {
        const t = c.ultimaMensagemCliente!.getTime();
        const resp = Math.max(c.ultimaMensagemEquipe?.getTime() ?? -Infinity, c.ultimaMensagemIa?.getTime() ?? -Infinity);
        return t < ate && t > de && t > resp;
      })
      .sort((a, b) => a.ultimaMensagemCliente!.getTime() - b.ultimaMensagemCliente!.getTime())
      .slice(0, 500)
      .map((c) => ({ conversaId: c.id, nome: c.nome ?? null, unidade: c.unidade, responsavelId: c.responsavelId ?? null, desde: c.ultimaMensagemCliente! }));
  }
}
