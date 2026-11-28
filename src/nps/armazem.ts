import type pg from 'pg';
import { ABERTAS, type EstadoPesquisa, type Finalizacao, type MotivoFinalizacao, type Pesquisa } from './tipos.js';

/** Onde ficam a configuração da pesquisa, os atendimentos finalizados e as pesquisas (com as respostas). */
export interface ArmazemNps {
  lerConfig(empresaId: string): Promise<unknown | undefined>;
  gravarConfig(empresaId: string, config: unknown, por: string): Promise<void>;

  salvarFinalizacao(f: Finalizacao): Promise<void>;
  finalizacoesDa(conversaId: string, limite: number): Promise<Finalizacao[]>;
  finalizacoesEntre(empresaId: string, inicio: Date, fim: Date): Promise<Finalizacao[]>;
  /** Quando cada conversa foi finalizada pela última vez (só as que já foram). Usado no selo verde da lista. */
  ultimasFinalizacoes(conversaIds: string[]): Promise<Map<string, Date>>;

  salvarPesquisa(p: Pesquisa): Promise<void>;
  /** A pesquisa aberta (esperando nota ou comentário) mais nova da conversa. */
  aberta(conversaId: string): Promise<Pesquisa | undefined>;
  /** Fecha as abertas de uma conversa (nova finalização substitui a anterior). */
  fecharAbertas(conversaId: string, estado: EstadoPesquisa, detalhe: string): Promise<void>;
  /** Abertas com o prazo vencido viram "expirada" (ou "respondida", se já têm nota). Retorna quantas. */
  vencer(empresaId: string, agora: Date): Promise<number>;
  /** Enviadas ou respondidas no período. */
  pesquisasEntre(empresaId: string, inicio: Date, fim: Date): Promise<Pesquisa[]>;
  pesquisasDa(conversaId: string, limite: number): Promise<Pesquisa[]>;
}

const copia = <T>(x: T): T => structuredClone(x);
const dentro = (d: Date | null, i: Date, f: Date) => Boolean(d && d.getTime() >= i.getTime() && d.getTime() < f.getTime());

export class ArmazemNpsMemoria implements ArmazemNps {
  private configs = new Map<string, unknown>();
  private finalizacoes: Finalizacao[] = [];
  private pesquisas = new Map<string, Pesquisa>();

  async lerConfig(empresaId: string) {
    return this.configs.has(empresaId) ? copia(this.configs.get(empresaId)) : undefined;
  }
  async gravarConfig(empresaId: string, config: unknown) {
    this.configs.set(empresaId, copia(config));
  }
  async salvarFinalizacao(f: Finalizacao) {
    this.finalizacoes.push(copia(f));
  }
  async finalizacoesDa(conversaId: string, limite: number) {
    return this.finalizacoes
      .filter((f) => f.conversaId === conversaId)
      .sort((a, b) => b.em.getTime() - a.em.getTime())
      .slice(0, limite)
      .map(copia);
  }
  async finalizacoesEntre(empresaId: string, inicio: Date, fim: Date) {
    return this.finalizacoes.filter((f) => f.empresaId === empresaId && dentro(f.em, inicio, fim)).map(copia);
  }
  async ultimasFinalizacoes(conversaIds: string[]) {
    const quer = new Set(conversaIds);
    const r = new Map<string, Date>();
    for (const f of this.finalizacoes) if (quer.has(f.conversaId) && (!r.has(f.conversaId) || f.em > r.get(f.conversaId)!)) r.set(f.conversaId, new Date(f.em));
    return r;
  }
  async salvarPesquisa(p: Pesquisa) {
    this.pesquisas.set(p.id, copia(p));
  }
  async aberta(conversaId: string) {
    const l = [...this.pesquisas.values()].filter((p) => p.conversaId === conversaId && ABERTAS.includes(p.estado)).sort((a, b) => b.enviadaEm.getTime() - a.enviadaEm.getTime());
    return l[0] ? copia(l[0]) : undefined;
  }
  async fecharAbertas(conversaId: string, estado: EstadoPesquisa, detalhe: string) {
    for (const p of this.pesquisas.values()) {
      if (p.conversaId !== conversaId || !ABERTAS.includes(p.estado)) continue;
      p.estado = p.nota !== null ? 'respondida' : estado;
      p.detalhe = detalhe;
    }
  }
  async vencer(empresaId: string, agora: Date) {
    let n = 0;
    for (const p of this.pesquisas.values()) {
      if (p.empresaId !== empresaId || !ABERTAS.includes(p.estado) || p.expiraEm.getTime() > agora.getTime()) continue;
      p.estado = p.nota !== null ? 'respondida' : 'expirada';
      p.detalhe = p.nota !== null ? 'sem comentário' : 'sem resposta no prazo';
      n++;
    }
    return n;
  }
  async pesquisasEntre(empresaId: string, inicio: Date, fim: Date) {
    return [...this.pesquisas.values()].filter((p) => p.empresaId === empresaId && (dentro(p.enviadaEm, inicio, fim) || dentro(p.respondidaEm, inicio, fim))).map(copia);
  }
  async pesquisasDa(conversaId: string, limite: number) {
    return [...this.pesquisas.values()]
      .filter((p) => p.conversaId === conversaId)
      .sort((a, b) => b.enviadaEm.getTime() - a.enviadaEm.getTime())
      .slice(0, limite)
      .map(copia);
  }
}

interface LinhaPesquisa {
  id: string;
  empresa_id: string;
  conversa_id: string;
  finalizacao_id: string | null;
  unidade: string;
  atendente_id: string | null;
  atendente_nome: string | null;
  motivo: string | null;
  estado: EstadoPesquisa;
  enviada_em: Date;
  expira_em: Date;
  nota: number | null;
  comentario: string | null;
  respondida_em: Date | null;
  detalhe: string | null;
}
const daLinha = (r: LinhaPesquisa): Pesquisa => ({
  id: r.id,
  empresaId: r.empresa_id,
  conversaId: r.conversa_id,
  finalizacaoId: r.finalizacao_id,
  unidade: r.unidade,
  atendenteId: r.atendente_id,
  atendenteNome: r.atendente_nome,
  motivo: r.motivo as MotivoFinalizacao | null,
  estado: r.estado,
  enviadaEm: r.enviada_em,
  expiraEm: r.expira_em,
  nota: r.nota,
  comentario: r.comentario,
  respondidaEm: r.respondida_em,
  detalhe: r.detalhe,
});
interface LinhaFinalizacao {
  id: string;
  empresa_id: string;
  conversa_id: string;
  unidade: string;
  motivo: string;
  observacao: string | null;
  atendente_id: string | null;
  atendente_nome: string | null;
  por_id: string | null;
  por_nome: string;
  em: Date;
}
const finalizacaoDaLinha = (r: LinhaFinalizacao): Finalizacao => ({
  id: r.id,
  empresaId: r.empresa_id,
  conversaId: r.conversa_id,
  unidade: r.unidade,
  motivo: r.motivo as MotivoFinalizacao,
  observacao: r.observacao,
  atendenteId: r.atendente_id,
  atendenteNome: r.atendente_nome,
  porId: r.por_id,
  porNome: r.por_nome,
  em: r.em,
});
const COLUNAS_P = 'id::text, empresa_id, conversa_id::text, finalizacao_id::text, unidade, atendente_id, atendente_nome, motivo, estado, enviada_em, expira_em, nota, comentario, respondida_em, detalhe';
const COLUNAS_F = 'id::text, empresa_id, conversa_id::text, unidade, motivo, observacao, atendente_id, atendente_nome, por_id, por_nome, em';

export class ArmazemNpsPostgres implements ArmazemNps {
  constructor(private readonly pool: pg.Pool) {}

  async lerConfig(empresaId: string) {
    const { rows } = await this.pool.query<{ config: unknown }>('select config from sintonia.nps_config where empresa_id = $1', [empresaId]);
    return rows[0]?.config;
  }
  async gravarConfig(empresaId: string, config: unknown, por: string) {
    await this.pool.query(
      `insert into sintonia.nps_config (empresa_id, config, atualizado_por, atualizado_em) values ($1, $2, $3, now())
       on conflict (empresa_id) do update set config = excluded.config, atualizado_por = excluded.atualizado_por, atualizado_em = now()`,
      [empresaId, JSON.stringify(config), por],
    );
  }
  async salvarFinalizacao(f: Finalizacao) {
    await this.pool.query(
      `insert into sintonia.atendimentos_finalizados (id, empresa_id, conversa_id, unidade, motivo, observacao, atendente_id, atendente_nome, por_id, por_nome, em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [f.id, f.empresaId, f.conversaId, f.unidade, f.motivo, f.observacao, f.atendenteId, f.atendenteNome, f.porId, f.porNome, f.em],
    );
  }
  async finalizacoesDa(conversaId: string, limite: number) {
    const { rows } = await this.pool.query<LinhaFinalizacao>(`select ${COLUNAS_F} from sintonia.atendimentos_finalizados where conversa_id = $1 order by em desc limit $2`, [conversaId, limite]);
    return rows.map(finalizacaoDaLinha);
  }
  async ultimasFinalizacoes(conversaIds: string[]) {
    const r = new Map<string, Date>();
    if (!conversaIds.length) return r;
    const { rows } = await this.pool.query<{ conversa_id: string; em: Date }>(
      'select conversa_id, max(em) as em from sintonia.atendimentos_finalizados where conversa_id = any($1::uuid[]) group by conversa_id',
      [conversaIds],
    );
    for (const l of rows) r.set(l.conversa_id, new Date(l.em));
    return r;
  }
  async finalizacoesEntre(empresaId: string, inicio: Date, fim: Date) {
    const { rows } = await this.pool.query<LinhaFinalizacao>(`select ${COLUNAS_F} from sintonia.atendimentos_finalizados where empresa_id = $1 and em >= $2 and em < $3`, [
      empresaId,
      inicio,
      fim,
    ]);
    return rows.map(finalizacaoDaLinha);
  }
  async salvarPesquisa(p: Pesquisa) {
    await this.pool.query(
      `insert into sintonia.nps_pesquisas (id, empresa_id, conversa_id, finalizacao_id, unidade, atendente_id, atendente_nome, motivo, estado, enviada_em, expira_em, nota, comentario, respondida_em, detalhe)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict (id) do update set estado = excluded.estado, nota = excluded.nota, comentario = excluded.comentario,
         respondida_em = excluded.respondida_em, detalhe = excluded.detalhe, expira_em = excluded.expira_em`,
      [p.id, p.empresaId, p.conversaId, p.finalizacaoId, p.unidade, p.atendenteId, p.atendenteNome, p.motivo, p.estado, p.enviadaEm, p.expiraEm, p.nota, p.comentario, p.respondidaEm, p.detalhe],
    );
  }
  async aberta(conversaId: string) {
    const { rows } = await this.pool.query<LinhaPesquisa>(
      `select ${COLUNAS_P} from sintonia.nps_pesquisas where conversa_id = $1 and estado = any($2::text[]) order by enviada_em desc limit 1`,
      [conversaId, ABERTAS],
    );
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async fecharAbertas(conversaId: string, estado: EstadoPesquisa, detalhe: string) {
    await this.pool.query(
      `update sintonia.nps_pesquisas set estado = case when nota is not null then 'respondida' else $2 end, detalhe = $3
        where conversa_id = $1 and estado = any($4::text[])`,
      [conversaId, estado, detalhe, ABERTAS],
    );
  }
  async vencer(empresaId: string, agora: Date) {
    const r = await this.pool.query(
      `update sintonia.nps_pesquisas
          set estado = case when nota is not null then 'respondida' else 'expirada' end,
              detalhe = case when nota is not null then 'sem comentário' else 'sem resposta no prazo' end
        where empresa_id = $1 and estado = any($3::text[]) and expira_em <= $2`,
      [empresaId, agora, ABERTAS],
    );
    return r.rowCount ?? 0;
  }
  async pesquisasEntre(empresaId: string, inicio: Date, fim: Date) {
    const { rows } = await this.pool.query<LinhaPesquisa>(
      `select ${COLUNAS_P} from sintonia.nps_pesquisas
        where empresa_id = $1 and ((enviada_em >= $2 and enviada_em < $3) or (respondida_em >= $2 and respondida_em < $3))`,
      [empresaId, inicio, fim],
    );
    return rows.map(daLinha);
  }
  async pesquisasDa(conversaId: string, limite: number) {
    const { rows } = await this.pool.query<LinhaPesquisa>(`select ${COLUNAS_P} from sintonia.nps_pesquisas where conversa_id = $1 order by enviada_em desc limit $2`, [conversaId, limite]);
    return rows.map(daLinha);
  }
}
