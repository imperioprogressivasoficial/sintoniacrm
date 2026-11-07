import type pg from 'pg';
import { ETAPAS, NOME_ETAPA, type Conversa, type Etapa } from '../domain.js';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import type { Usuario } from '../auth/contas.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { bahia, DIA, MIN, partesBahia } from '../util/tempo.js';
import { sqlEscopo } from './escopo-sql.js';

/**
 * Painel da gestão. Os números saem dos eventos (sintonia.eventos) e do estado atual das conversas.
 * Duas fontes com o mesmo contrato: memória (testes, uso local) e Postgres, que agrega no banco
 * (30 dias × ~110 leads/dia × muitos eventos não passam pela memória do servidor).
 */

export const PERIODOS = ['hoje', 'ontem', '7d', '30d'] as const;
export type Periodo = (typeof PERIODOS)[number];

/** Soma e quantidade (para tirar média sem perder precisão ao juntar). */
export interface Soma {
  somaMs: number;
  n: number;
}
const zero = (): Soma => ({ somaMs: 0, n: 0 });
const somar = (a: Soma, b: Soma): Soma => ({ somaMs: a.somaMs + b.somaMs, n: a.n + b.n });

export interface AtividadeAtendente {
  /** Id da usuária quando o evento guardou (eventos antigos só têm o nome). */
  id: string | null;
  nome: string;
  respostas: number;
  agendamentos: number;
  ligacoes: number;
  tempo: Soma;
}

export interface DadosPeriodo {
  leads: number;
  /** 24 posições, hora da Bahia em que a conversa nova chegou. */
  leadsPorHora: number[];
  primeiraResposta: { equipe: Soma; ia: Soma };
  resposta: { equipe: Soma; ia: Soma };
  agendamentos: { ia: number; equipe: number };
  atendentes: AtividadeAtendente[];
}

export interface DadosAgora {
  funil: Record<Etapa, number>;
  /** usuarioId → quantas conversas ela é dona agora. */
  donas: Map<string, number>;
  /** Quem deu sinal de vida (digitando ou respondeu) desde o instante pedido. */
  online: Set<string>;
}

export interface FontePainel {
  /** Eventos com em ∈ [inicio, fim). A primeira resposta é procurada até `ate` (pode ser depois do fim). */
  periodo(inicio: Date, fim: Date, escopo: EscopoVisao, ate: Date): Promise<DadosPeriodo>;
  agora(escopo: EscopoVisao, onlineDesde: Date): Promise<DadosAgora>;
}

const TIPOS_RESPOSTA = ['ia_respondeu', 'equipe_respondeu'] as const;
const horaBahia = (d: Date) => partesBahia(d).hora;
const tempoDe = (e: Pick<Evento, 'dados'>) => (typeof e.dados?.tempoRespostaMs === 'number' ? e.dados.tempoRespostaMs : undefined);
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const chaveAtendente = (id: string | null, nome: string) => id ?? `nome:${nome.toLowerCase()}`;
const funilVazio = () => Object.fromEntries(ETAPAS.map((e) => [e, 0])) as Record<Etapa, number>;

function juntarAtendente(mapa: Map<string, AtividadeAtendente>, id: string | null, nome: string): AtividadeAtendente {
  const k = chaveAtendente(id, nome);
  let a = mapa.get(k);
  if (!a) {
    a = { id, nome, respostas: 0, agendamentos: 0, ligacoes: 0, tempo: zero() };
    mapa.set(k, a);
  }
  return a;
}

// ---------------------------------------------------------------- memória

export class PainelMemoria implements FontePainel {
  constructor(private readonly repo: Repositorio) {}

  private async conversasNoEscopo(escopo: EscopoVisao): Promise<Map<string, Conversa>> {
    return new Map((await this.repo.listarConversas()).filter((c) => noEscopo(escopo, c)).map((c) => [c.id, c]));
  }

  async periodo(inicio: Date, fim: Date, escopo: EscopoVisao, ate: Date): Promise<DadosPeriodo> {
    const conversas = await this.conversasNoEscopo(escopo);
    const limite = new Date(Math.max(fim.getTime(), ate.getTime()) + 1);
    const todos = (await this.repo.eventosEntre(inicio, limite)).filter((e) => e.conversaId && conversas.has(e.conversaId));
    const dentro = todos.filter((e) => e.em.getTime() < fim.getTime());
    const r: DadosPeriodo = {
      leads: 0,
      leadsPorHora: Array(24).fill(0),
      primeiraResposta: { equipe: zero(), ia: zero() },
      resposta: { equipe: zero(), ia: zero() },
      agendamentos: { ia: 0, equipe: 0 },
      atendentes: [],
    };
    const atendentes = new Map<string, AtividadeAtendente>();
    for (const e of dentro) {
      if (e.tipo === 'conversa_nova') {
        r.leads++;
        r.leadsPorHora[horaBahia(e.em)] = (r.leadsPorHora[horaBahia(e.em)] ?? 0) + 1;
        const primeira = todos.find((x) => x.conversaId === e.conversaId && (TIPOS_RESPOSTA as readonly string[]).includes(x.tipo) && x.em >= e.em);
        if (primeira) {
          const lado = primeira.tipo === 'ia_respondeu' ? 'ia' : 'equipe';
          r.primeiraResposta[lado] = somar(r.primeiraResposta[lado], { somaMs: primeira.em.getTime() - e.em.getTime(), n: 1 });
        }
      }
      const t = tempoDe(e);
      if (e.tipo === 'ia_respondeu' && t !== undefined) r.resposta.ia = somar(r.resposta.ia, { somaMs: t, n: 1 });
      if (e.tipo === 'equipe_respondeu' && t !== undefined) r.resposta.equipe = somar(r.resposta.equipe, { somaMs: t, n: 1 });
      if (e.tipo === 'agendamento_ia') r.agendamentos.ia++;
      if (e.tipo === 'agendamento_equipe') r.agendamentos.equipe++;
      if (e.tipo === 'equipe_respondeu' || e.tipo === 'agendamento_equipe' || e.tipo === 'ligacao') {
        const id = texto(e.dados?.atendenteId) ?? null;
        const nome = texto(e.dados?.atendente) ?? '';
        if (!id && !nome) continue;
        const a = juntarAtendente(atendentes, id, nome);
        if (nome) a.nome = nome;
        if (e.tipo === 'equipe_respondeu') {
          a.respostas++;
          if (t !== undefined) a.tempo = somar(a.tempo, { somaMs: t, n: 1 });
        }
        if (e.tipo === 'agendamento_equipe') a.agendamentos++;
        if (e.tipo === 'ligacao') a.ligacoes++;
      }
    }
    r.atendentes = [...atendentes.values()];
    return r;
  }

  async agora(escopo: EscopoVisao, onlineDesde: Date): Promise<DadosAgora> {
    const conversas = await this.conversasNoEscopo(escopo);
    const funil = funilVazio();
    const donas = new Map<string, number>();
    for (const c of conversas.values()) {
      funil[c.etapa]++;
      if (c.responsavelId) donas.set(c.responsavelId, (donas.get(c.responsavelId) ?? 0) + 1);
    }
    // "Online" olha a empresa toda (quem está trabalhando), não só as conversas visíveis.
    const online = new Set<string>();
    const daEmpresa = (await this.repo.listarConversas()).filter((c) => !escopo.empresaId || c.empresaId === escopo.empresaId);
    for (const c of daEmpresa) for (const d of await this.repo.digitando(c.id, onlineDesde)) online.add(d.usuarioId);
    const ids = new Set(daEmpresa.map((c) => c.id));
    for (const e of await this.repo.eventosEntre(onlineDesde, new Date(8.64e15))) {
      const id = texto(e.dados?.atendenteId);
      if (e.tipo === 'equipe_respondeu' && id && e.conversaId && ids.has(e.conversaId)) online.add(id);
    }
    return { funil, donas, online };
  }
}

// ---------------------------------------------------------------- Postgres

export class PainelPostgres implements FontePainel {
  constructor(private readonly pool: pg.Pool) {}

  async periodo(inicio: Date, fim: Date, escopo: EscopoVisao, ate: Date): Promise<DadosPeriodo> {
    const consulta = async <T extends pg.QueryResultRow>(sql: (onde: string) => string, extra: unknown[] = []) => {
      const params: unknown[] = [inicio, fim, ...extra];
      const onde = sqlEscopo(escopo, 'c', params);
      return (await this.pool.query<T>(sql(onde), params)).rows;
    };
    const ehNumero = `jsonb_typeof(e.dados->'tempoRespostaMs') = 'number'`;
    const [porTipo, porHora, primeira, atend] = await Promise.all([
      consulta<{ tipo: string; n: number; nt: number; st: number }>(
        (onde) => `select e.tipo, count(*)::int as n,
                          count(*) filter (where ${ehNumero})::int as nt,
                          coalesce(sum((e.dados->>'tempoRespostaMs')::float8) filter (where ${ehNumero}), 0)::float8 as st
                     from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
                    where e.em >= $1 and e.em < $2
                      and e.tipo in ('conversa_nova', 'ia_respondeu', 'equipe_respondeu', 'agendamento_ia', 'agendamento_equipe')
                      and ${onde}
                    group by e.tipo`,
      ),
      consulta<{ h: number; n: number }>(
        // Hora da Bahia: UTC-3 fixo (sem horário de verão), igual a util/tempo.ts.
        (onde) => `select extract(hour from (e.em at time zone 'UTC') - interval '3 hours')::int as h, count(*)::int as n
                     from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
                    where e.em >= $1 and e.em < $2 and e.tipo = 'conversa_nova' and ${onde}
                    group by 1`,
      ),
      consulta<{ tipo: string; n: number; st: number }>(
        (onde) => `select r.tipo, count(*)::int as n, coalesce(sum(extract(epoch from (r.em - e.em)) * 1000), 0)::float8 as st
                     from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
                     cross join lateral (
                       select x.tipo, x.em from sintonia.eventos x
                        where x.conversa_id = e.conversa_id and x.tipo in ('ia_respondeu', 'equipe_respondeu')
                          and x.em >= e.em and x.em <= $3
                        order by x.em, x.id limit 1) r
                    where e.em >= $1 and e.em < $2 and e.tipo = 'conversa_nova' and ${onde}
                    group by r.tipo`,
        [ate],
      ),
      consulta<{ id: string | null; nome: string; tipo: string; n: number; nt: number; st: number }>(
        (onde) => `select nullif(btrim(e.dados->>'atendenteId'), '') as id, coalesce(btrim(e.dados->>'atendente'), '') as nome, e.tipo,
                          count(*)::int as n,
                          count(*) filter (where ${ehNumero})::int as nt,
                          coalesce(sum((e.dados->>'tempoRespostaMs')::float8) filter (where ${ehNumero}), 0)::float8 as st
                     from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
                    where e.em >= $1 and e.em < $2 and e.tipo in ('equipe_respondeu', 'agendamento_equipe', 'ligacao')
                      and (nullif(btrim(e.dados->>'atendenteId'), '') is not null or nullif(btrim(e.dados->>'atendente'), '') is not null)
                      and ${onde}
                    group by 1, 2, 3`,
      ),
    ]);

    const tipo = (t: string) => porTipo.find((x) => x.tipo === t);
    const leadsPorHora: number[] = Array(24).fill(0);
    for (const x of porHora) leadsPorHora[x.h] = x.n;
    const pr = (t: string): Soma => {
      const x = primeira.find((y) => y.tipo === t);
      return x ? { somaMs: x.st, n: x.n } : zero();
    };
    const atendentes = new Map<string, AtividadeAtendente>();
    for (const x of atend) {
      const a = juntarAtendente(atendentes, x.id, x.nome);
      if (x.nome) a.nome = x.nome;
      if (x.tipo === 'equipe_respondeu') {
        a.respostas += x.n;
        a.tempo = somar(a.tempo, { somaMs: x.st, n: x.nt });
      }
      if (x.tipo === 'agendamento_equipe') a.agendamentos += x.n;
      if (x.tipo === 'ligacao') a.ligacoes += x.n;
    }
    return {
      leads: tipo('conversa_nova')?.n ?? 0,
      leadsPorHora,
      primeiraResposta: { equipe: pr('equipe_respondeu'), ia: pr('ia_respondeu') },
      resposta: {
        equipe: { somaMs: tipo('equipe_respondeu')?.st ?? 0, n: tipo('equipe_respondeu')?.nt ?? 0 },
        ia: { somaMs: tipo('ia_respondeu')?.st ?? 0, n: tipo('ia_respondeu')?.nt ?? 0 },
      },
      agendamentos: { ia: tipo('agendamento_ia')?.n ?? 0, equipe: tipo('agendamento_equipe')?.n ?? 0 },
      atendentes: [...atendentes.values()],
    };
  }

  async agora(escopo: EscopoVisao, onlineDesde: Date): Promise<DadosAgora> {
    const p1: unknown[] = [];
    const onde = sqlEscopo(escopo, 'c', p1);
    const p2: unknown[] = [onlineDesde];
    const daEmpresa = sqlEscopo({ empresaId: escopo.empresaId }, 'c', p2);
    const [etapas, donas, online] = await Promise.all([
      this.pool.query<{ etapa: Etapa; n: number }>(`select c.etapa, count(*)::int as n from sintonia.conversas c where ${onde} group by c.etapa`, p1),
      this.pool.query<{ id: string; n: number }>(
        `select c.responsavel_id::text as id, count(*)::int as n from sintonia.conversas c where c.responsavel_id is not null and ${onde} group by 1`,
        p1,
      ),
      this.pool.query<{ id: string }>(
        `select d.usuario_id::text as id from sintonia.digitando d join sintonia.conversas c on c.id = d.conversa_id
          where d.em >= $1 and ${daEmpresa}
         union
         select e.dados->>'atendenteId' from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where e.em >= $1 and e.tipo = 'equipe_respondeu' and nullif(e.dados->>'atendenteId', '') is not null and ${daEmpresa}`,
        p2,
      ),
    ]);
    const funil = funilVazio();
    for (const x of etapas.rows) funil[x.etapa] = x.n;
    return { funil, donas: new Map(donas.rows.map((x) => [x.id, x.n])), online: new Set(online.rows.map((x) => x.id)) };
  }
}

/** Fonte certa para o repositório em uso. */
export function fontePainelPara(repo: Repositorio): FontePainel {
  const pool = (repo as { pool?: pg.Pool }).pool;
  return pool ? new PainelPostgres(pool) : new PainelMemoria(repo);
}

// ---------------------------------------------------------------- montagem

/** Início e fim do período e do período anterior de mesmo tamanho (horário da Bahia). */
export function janela(periodo: Periodo, agora: Date) {
  const p = partesBahia(agora);
  const hoje = bahia(p.ano, p.mes, p.dia);
  const dias = periodo === 'hoje' || periodo === 'ontem' ? 1 : periodo === '7d' ? 7 : 30;
  const inicio = periodo === 'ontem' ? new Date(hoje.getTime() - DIA) : new Date(hoje.getTime() - (dias - 1) * DIA);
  const fim = periodo === 'ontem' ? hoje : agora;
  // "Hoje até agora" compara com "ontem até a mesma hora".
  const desloca = dias * DIA;
  return { inicio, fim, dias, anterior: { inicio: new Date(inicio.getTime() - desloca), fim: new Date(fim.getTime() - desloca) } };
}

const media = (s: Soma) => ({ mediaSeg: s.n ? Math.round(s.somaMs / s.n / 1000) : null, n: s.n });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

export interface OpcoesPainel {
  periodo: Periodo;
  agora: Date;
  escopo: EscopoVisao;
  /** Quem pede (sem login: undefined, vê como gestão). */
  usuario?: Pick<Usuario, 'id' | 'nome' | 'papel' | 'unidades'>;
  /** Equipe da empresa (para o ranking e "ativas/online"); sem login, fica de fora. */
  equipe?: Usuario[];
}

const PAPEIS_ATENDIMENTO = new Set(['atendente', 'recepcionista']);
const ONLINE_MIN = 10;

export async function montarPainel(fonte: FontePainel, o: OpcoesPainel) {
  const j = janela(o.periodo, o.agora);
  const [atual, anterior, agora] = await Promise.all([
    fonte.periodo(j.inicio, j.fim, o.escopo, o.agora),
    fonte.periodo(j.anterior.inicio, j.anterior.fim, o.escopo, o.agora),
    fonte.agora(o.escopo, new Date(o.agora.getTime() - ONLINE_MIN * MIN)),
  ]);
  const u = o.usuario;
  const pessoal = Boolean(u && !(u.papel === 'gerente' || u.papel === 'direcao' || u.papel === 'admin'));
  const veTodaEquipe = !u || u.papel === 'direcao' || u.papel === 'admin';

  // Equipe que entra no ranking: atendentes/recepcionistas ativas no alcance de quem pede.
  const equipe = (o.equipe ?? []).filter(
    (p) => p.ativo && (veTodaEquipe || (pessoal ? p.id === u!.id : p.unidades.some((x) => u!.unidades.includes(x)))),
  );
  const porNome = new Map((o.equipe ?? []).map((p) => [p.nome.toLowerCase(), p]));
  const porId = new Map((o.equipe ?? []).map((p) => [p.id, p]));

  interface Linha {
    usuarioId: string | null;
    nome: string;
    papel: string | null;
    respostas: number;
    agendamentos: number;
    ligacoes: number;
    tempo: Soma;
  }
  const linhas = new Map<string, Linha>();
  const linha = (id: string | null, nome: string) => {
    const pessoa = (id && porId.get(id)) || porNome.get(nome.toLowerCase());
    const k = pessoa ? pessoa.id : `nome:${nome.toLowerCase()}`;
    let l = linhas.get(k);
    if (!l) {
      l = { usuarioId: pessoa?.id ?? null, nome: pessoa?.nome ?? nome, papel: pessoa?.papel ?? null, respostas: 0, agendamentos: 0, ligacoes: 0, tempo: zero() };
      linhas.set(k, l);
    }
    return l;
  };
  for (const p of equipe) if (PAPEIS_ATENDIMENTO.has(p.papel)) linha(p.id, p.nome);
  for (const a of atual.atendentes) {
    const l = linha(a.id, a.nome);
    l.respostas += a.respostas;
    l.agendamentos += a.agendamentos;
    l.ligacoes += a.ligacoes;
    l.tempo = somar(l.tempo, a.tempo);
  }
  let ranking = [...linhas.values()].map((l) => ({
    usuarioId: l.usuarioId,
    nome: l.nome,
    papel: l.papel,
    respostas: l.respostas,
    agendamentos: l.agendamentos,
    tempoMedioRespostaSeg: media(l.tempo).mediaSeg,
    conversasDona: l.usuarioId ? (agora.donas.get(l.usuarioId) ?? 0) : 0,
    ligacoes: l.ligacoes,
    online: l.usuarioId ? agora.online.has(l.usuarioId) : false,
  }));
  if (pessoal) ranking = ranking.filter((r) => r.usuarioId === u!.id || r.nome.toLowerCase() === u!.nome.toLowerCase());
  ranking.sort((a, b) => b.agendamentos - a.agendamentos || b.respostas - a.respostas || a.nome.localeCompare(b.nome, 'pt-BR'));

  const totalAg = atual.agendamentos.ia + atual.agendamentos.equipe;
  const totalAgAnterior = anterior.agendamentos.ia + anterior.agendamentos.equipe;
  const atendentesEquipe = equipe.filter((p) => PAPEIS_ATENDIMENTO.has(p.papel));
  return {
    periodo: o.periodo,
    escopo: !u || veTodaEquipe ? 'empresa' : pessoal ? 'pessoal' : 'unidades',
    inicio: j.inicio,
    fim: j.fim,
    anterior: j.anterior,
    leads: { total: atual.leads, anterior: anterior.leads, variacaoPct: anterior.leads ? Math.round(((atual.leads - anterior.leads) / anterior.leads) * 100) : null },
    primeiraResposta: {
      geral: media(somar(atual.primeiraResposta.equipe, atual.primeiraResposta.ia)),
      equipe: media(atual.primeiraResposta.equipe),
      ia: media(atual.primeiraResposta.ia),
    },
    tempoResposta: {
      geral: media(somar(atual.resposta.equipe, atual.resposta.ia)),
      equipe: media(atual.resposta.equipe),
      ia: media(atual.resposta.ia),
    },
    agendamentos: {
      ia: atual.agendamentos.ia,
      equipe: atual.agendamentos.equipe,
      total: totalAg,
      anterior: totalAgAnterior,
      conversaoPct: pct(totalAg, atual.leads),
      conversaoAnteriorPct: pct(totalAgAnterior, anterior.leads),
    },
    leadsPorHora: atual.leadsPorHora,
    funil: ETAPAS.map((e) => ({ etapa: e, nome: NOME_ETAPA[e], conversas: agora.funil[e] })),
    ranking,
    equipe:
      o.equipe && !pessoal
        ? {
            ativas: atendentesEquipe.length,
            online: atendentesEquipe.filter((p) => agora.online.has(p.id)).length,
            onlineNomes: atendentesEquipe.filter((p) => agora.online.has(p.id)).map((p) => p.nome),
          }
        : null,
  };
}
