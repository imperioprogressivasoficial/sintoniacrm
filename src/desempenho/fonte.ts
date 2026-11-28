import type pg from 'pg';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import type { Conversa } from '../domain.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import type { Repositorio } from '../store/repositorio.js';
import { DIA } from '../util/tempo.js';
import { NOVA_SESSAO_MS, type AgD, type Autor, type ConvD, type DadosDesempenho, type EvD } from './calculo.js';

/**
 * De onde saem os dados do Desempenho. O Postgres filtra tudo no banco (período, unidade, escopo) e devolve
 * só as colunas que as contas usam (sem texto das mensagens); a "1ª mensagem da cliente" de cada agendamento
 * e o comparecimento saem de subconsultas indexadas. A memória serve os testes e o uso local.
 */
export interface FonteDesempenho {
  carregar(inicio: Date, fim: Date, agora: Date, escopo: EscopoVisao): Promise<DadosDesempenho>;
  /** Conversas do escopo em que a última mensagem é da cliente (fila de agora). */
  esperando(escopo: EscopoVisao): Promise<ConvD[]>;
}

/** Eventos que o desempenho lê (agendamentos vêm à parte). */
export const TIPOS_EVENTO = ['ia_assumiu', 'etapa_mudou', 'lembrete_ligacao', 'ligacao', 'transferencia', 'equipe_respondeu'];
const TIPOS_AG = ['agendamento_ia', 'agendamento_equipe'];
const JANELA_PRIMEIRA = 30 * DIA;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

function agDe(tipo: string, conversaId: string, em: Date, unidade: string, dados: Record<string, unknown> | null | undefined, compareceu: boolean, primeira: Date | null): AgD {
  const porIa = tipo === 'agendamento_ia';
  return {
    conversaId,
    em,
    porIa,
    atendenteId: porIa ? null : str(dados?.atendenteId),
    atendenteNome: porIa ? null : str(dados?.atendente),
    servico: str(dados?.servico),
    profissional: str(dados?.profissional),
    unidade,
    valor: num(dados?.valor),
    compareceu,
    primeiraClienteEm: primeira,
  };
}

const convD = (c: Conversa): ConvD => ({
  id: c.id,
  nome: c.nome ?? null,
  telefone: c.telefone,
  unidade: c.unidade,
  etapa: c.etapa,
  responsavelId: c.responsavelId ?? null,
  responsavelNome: c.responsavelNome ?? null,
  ultimaMensagemCliente: c.ultimaMensagemCliente ?? null,
  ultimaMensagemEquipe: c.ultimaMensagemEquipe ?? null,
  ultimaMensagemIa: c.ultimaMensagemIa ?? null,
});

export class FonteDesempenhoMemoria implements FonteDesempenho {
  constructor(private readonly repo: Repositorio) {}

  async carregar(inicio: Date, fim: Date, agora: Date, escopo: EscopoVisao): Promise<DadosDesempenho> {
    const conversas = new Map((await this.repo.listarConversas()).filter((c) => noEscopo(escopo, c)).map((c) => [c.id, convD(c)]));
    const desde = inicio.getTime() - NOVA_SESSAO_MS;
    const mensagens = [];
    const clientes = new Map<string, Date[]>();
    for (const id of conversas.keys()) {
      for (const m of await this.repo.mensagens(id, 1_000_000)) {
        if (m.autor === 'cliente') clientes.set(id, [...(clientes.get(id) ?? []), m.em]);
        if (m.em.getTime() >= desde && m.em.getTime() < fim.getTime()) mensagens.push({ conversaId: id, autor: m.autor as Autor, autorNome: m.autorNome ?? null, em: m.em });
      }
    }
    const todos = (await this.repo.eventosEntre(inicio, new Date(agora.getTime() + 1))).filter((e) => e.conversaId && conversas.has(e.conversaId));
    const eventos: EvD[] = todos.filter((e) => TIPOS_EVENTO.includes(e.tipo)).map((e) => ({ tipo: e.tipo, conversaId: e.conversaId!, em: e.em, dados: e.dados ?? null }));
    const agendamentos = todos
      .filter((e) => TIPOS_AG.includes(e.tipo) && e.em.getTime() < fim.getTime())
      .map((e) => {
        const c = conversas.get(e.conversaId!)!;
        const comp = c.etapa === 'compareceu' || todos.some((x) => x.conversaId === c.id && x.tipo === 'etapa_mudou' && x.dados?.para === 'compareceu' && x.em >= e.em);
        const primeira = (clientes.get(c.id) ?? []).filter((t) => t.getTime() <= e.em.getTime() && t.getTime() >= e.em.getTime() - JANELA_PRIMEIRA).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
        return agDe(e.tipo, c.id, e.em, e.unidade ?? c.unidade, e.dados, comp, primeira);
      });
    return { mensagens, eventos, agendamentos, conversas };
  }

  async esperando(escopo: EscopoVisao): Promise<ConvD[]> {
    return (await this.repo.listarConversas()).filter((c) => noEscopo(escopo, c)).map(convD);
  }
}

interface LinhaConv {
  id: string;
  nome: string | null;
  telefone: string;
  unidade: string;
  etapa: string;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  ultima_mensagem_cliente: Date | null;
  ultima_mensagem_equipe: Date | null;
  ultima_mensagem_ia: Date | null;
}
const daLinha = (r: LinhaConv): ConvD => ({
  id: r.id,
  nome: r.nome,
  telefone: r.telefone,
  unidade: r.unidade,
  etapa: r.etapa,
  responsavelId: r.responsavel_id,
  responsavelNome: r.responsavel_nome,
  ultimaMensagemCliente: r.ultima_mensagem_cliente,
  ultimaMensagemEquipe: r.ultima_mensagem_equipe,
  ultimaMensagemIa: r.ultima_mensagem_ia,
});
const COLUNAS_CONV = `c.id::text as id, c.nome, c.telefone, c.unidade, c.etapa, c.responsavel_id::text as responsavel_id, c.responsavel_nome,
  c.ultima_mensagem_cliente, c.ultima_mensagem_equipe, c.ultima_mensagem_ia`;

export class FonteDesempenhoPostgres implements FonteDesempenho {
  constructor(private readonly pool: pg.Pool) {}

  async carregar(inicio: Date, fim: Date, agora: Date, escopo: EscopoVisao): Promise<DadosDesempenho> {
    const desde = new Date(inicio.getTime() - NOVA_SESSAO_MS);
    const pm: unknown[] = [desde, fim];
    const om = sqlEscopo(escopo, 'c', pm);
    const pe: unknown[] = [inicio, agora, TIPOS_EVENTO];
    const oe = sqlEscopo(escopo, 'c', pe);
    const pa: unknown[] = [inicio, fim, TIPOS_AG, `${JANELA_PRIMEIRA / 1000} seconds`];
    const oa = sqlEscopo(escopo, 'c', pa);
    const [m, e, a] = await Promise.all([
      this.pool.query<{ conversa_id: string; autor: Autor; autor_nome: string | null; em: Date }>(
        `select m.conversa_id::text as conversa_id, m.autor, m.autor_nome, m.em
           from sintonia.mensagens m join sintonia.conversas c on c.id = m.conversa_id
          where m.em >= $1 and m.em < $2 and m.autor <> 'sistema' and ${om}`,
        pm,
      ),
      this.pool.query<{ tipo: string; conversa_id: string; em: Date; dados: Record<string, unknown> | null }>(
        `select e.tipo, e.conversa_id::text as conversa_id, e.em, e.dados
           from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where e.em >= $1 and e.em <= $2 and e.tipo = any($3::text[]) and ${oe}`,
        pe,
      ),
      this.pool.query<{ tipo: string; conversa_id: string; em: Date; unidade: string; dados: Record<string, unknown> | null; compareceu: boolean; primeira: Date | null }>(
        `select e.tipo, e.conversa_id::text as conversa_id, e.em, coalesce(e.unidade, c.unidade) as unidade, e.dados,
                (c.etapa = 'compareceu' or exists (select 1 from sintonia.eventos x where x.conversa_id = e.conversa_id and x.tipo = 'etapa_mudou'
                                                    and x.dados->>'para' = 'compareceu' and x.em >= e.em)) as compareceu,
                (select min(p.em) from sintonia.mensagens p where p.conversa_id = e.conversa_id and p.autor = 'cliente'
                    and p.em <= e.em and p.em >= e.em - $4::interval) as primeira
           from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${oa}`,
        pa,
      ),
    ]);
    const ids = new Set<string>([...m.rows.map((r) => r.conversa_id), ...e.rows.map((r) => r.conversa_id), ...a.rows.map((r) => r.conversa_id)]);
    const conversas = new Map<string, ConvD>();
    if (ids.size) {
      const c = await this.pool.query<LinhaConv>(`select ${COLUNAS_CONV} from sintonia.conversas c where c.id = any($1::uuid[])`, [[...ids]]);
      for (const r of c.rows) conversas.set(r.id, daLinha(r));
    }
    return {
      mensagens: m.rows.map((r) => ({ conversaId: r.conversa_id, autor: r.autor, autorNome: r.autor_nome, em: r.em })),
      eventos: e.rows.map((r) => ({ tipo: r.tipo, conversaId: r.conversa_id, em: r.em, dados: r.dados })),
      agendamentos: a.rows.map((r) => agDe(r.tipo, r.conversa_id, r.em, r.unidade, r.dados, r.compareceu, r.primeira)),
      conversas,
    };
  }

  async esperando(escopo: EscopoVisao): Promise<ConvD[]> {
    const p: unknown[] = [];
    const onde = sqlEscopo(escopo, 'c', p);
    const r = await this.pool.query<LinhaConv>(
      `select ${COLUNAS_CONV} from sintonia.conversas c
        where c.ultima_mensagem_cliente is not null
          and c.ultima_mensagem_cliente > greatest(coalesce(c.ultima_mensagem_equipe, '-infinity'), coalesce(c.ultima_mensagem_ia, '-infinity'))
          and ${onde}
        order by c.ultima_mensagem_cliente limit 300`,
      p,
    );
    return r.rows.map(daLinha);
  }
}
