import type pg from 'pg';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Perda } from './tipos.js';

/** Filtro do relatório de perdas: período, escopo de quem pede e, opcional, a atendente (quem atendia na hora). */
export interface FiltroPerdas {
  inicio: Date;
  fim: Date;
  escopo: EscopoVisao;
  atendente?: string;
}

export type PerdaComCliente = Perda & { cliente: string | null };

export interface ArmazemPerdas {
  lerConfig(empresaId: string): Promise<unknown | null>;
  gravarConfig(empresaId: string, config: unknown, por: string, em: Date): Promise<void>;
  registrar(p: Perda): Promise<void>;
  /** A perda mais recente de cada conversa neste funil. */
  ultimas(funilId: string, conversaIds: string[]): Promise<Map<string, Perda>>;
  /** Perdas do período no escopo (a conversa precisa estar no escopo de quem pede), mais antigas primeiro. */
  listar(f: FiltroPerdas): Promise<PerdaComCliente[]>;
}

export class ArmazemPerdasMemoria implements ArmazemPerdas {
  private readonly configs = new Map<string, unknown>();
  private readonly lista: Perda[] = [];
  constructor(private readonly repo: Repositorio) {}

  async lerConfig(empresaId: string) {
    return this.configs.get(empresaId) ?? null;
  }
  async gravarConfig(empresaId: string, config: unknown) {
    this.configs.set(empresaId, JSON.parse(JSON.stringify(config)));
  }
  async registrar(p: Perda) {
    this.lista.push({ ...p });
  }
  async ultimas(funilId: string, conversaIds: string[]) {
    const quer = new Set(conversaIds);
    const r = new Map<string, Perda>();
    for (const p of this.lista) {
      if (p.funilId !== funilId || !quer.has(p.conversaId)) continue;
      const atual = r.get(p.conversaId);
      if (!atual || atual.em.getTime() <= p.em.getTime()) r.set(p.conversaId, { ...p });
    }
    return r;
  }
  async listar(f: FiltroPerdas) {
    const conversas = new Map((await this.repo.listarConversas()).map((c) => [c.id, c]));
    return this.lista
      .filter((p) => {
        const c = conversas.get(p.conversaId);
        if (!c || !noEscopo(f.escopo, c)) return false;
        if (f.escopo.empresaId && p.empresaId !== f.escopo.empresaId) return false;
        if (f.atendente && p.atendenteId !== f.atendente) return false;
        return p.em >= f.inicio && p.em < f.fim;
      })
      .sort((a, b) => a.em.getTime() - b.em.getTime())
      .map((p) => ({ ...p, cliente: conversas.get(p.conversaId)?.nome ?? null }));
  }
}

interface Linha {
  id: string;
  empresa_id: string;
  conversa_id: string;
  funil_id: string;
  etapa_id: string | null;
  de_etapa_id: string | null;
  de_etapa_nome: string | null;
  motivo: string;
  motivo_nome: string;
  detalhe: string | null;
  automatico: boolean;
  atendente_id: string | null;
  atendente_nome: string | null;
  por_id: string | null;
  por_nome: string;
  unidade: string;
  em: Date;
}
const COLUNAS = `p.id::text, p.empresa_id, p.conversa_id::text, p.funil_id::text, p.etapa_id::text, p.de_etapa_id::text, p.de_etapa_nome,
  p.motivo, p.motivo_nome, p.detalhe, p.automatico, p.atendente_id, p.atendente_nome, p.por_id, p.por_nome, p.unidade, p.em`;
const paraPerda = (l: Linha): Perda => ({
  id: l.id,
  empresaId: l.empresa_id,
  conversaId: l.conversa_id,
  funilId: l.funil_id,
  etapaId: l.etapa_id,
  deEtapaId: l.de_etapa_id,
  deEtapaNome: l.de_etapa_nome,
  motivo: l.motivo,
  motivoNome: l.motivo_nome,
  detalhe: l.detalhe,
  automatico: l.automatico,
  atendenteId: l.atendente_id,
  atendenteNome: l.atendente_nome,
  porId: l.por_id,
  porNome: l.por_nome,
  unidade: l.unidade,
  em: l.em,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOuNulo = (v: string | null) => (v && UUID.test(v) ? v : null);

export class ArmazemPerdasPostgres implements ArmazemPerdas {
  constructor(private readonly pool: pg.Pool) {}

  async lerConfig(empresaId: string) {
    const { rows } = await this.pool.query<{ config: unknown }>('select config from sintonia.perdas_config where empresa_id = $1', [empresaId]);
    return rows[0]?.config ?? null;
  }
  async gravarConfig(empresaId: string, config: unknown, por: string, em: Date) {
    await this.pool.query(
      `insert into sintonia.perdas_config (empresa_id, config, atualizado_por, atualizado_em) values ($1, $2, $3, $4)
       on conflict (empresa_id) do update set config = excluded.config, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`,
      [empresaId, JSON.stringify(config), por, em],
    );
  }
  async registrar(p: Perda) {
    await this.pool.query(
      `insert into sintonia.perdas (id, empresa_id, conversa_id, funil_id, etapa_id, de_etapa_id, de_etapa_nome, motivo, motivo_nome, detalhe,
         automatico, atendente_id, atendente_nome, por_id, por_nome, unidade, em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [p.id, p.empresaId, p.conversaId, p.funilId, uuidOuNulo(p.etapaId), uuidOuNulo(p.deEtapaId), p.deEtapaNome, p.motivo, p.motivoNome, p.detalhe,
        p.automatico, p.atendenteId, p.atendenteNome, p.porId, p.porNome, p.unidade, p.em],
    );
  }
  async ultimas(funilId: string, conversaIds: string[]) {
    const ids = conversaIds.filter((x) => UUID.test(x));
    if (!ids.length || !UUID.test(funilId)) return new Map<string, Perda>();
    const { rows } = await this.pool.query<Linha>(
      `select distinct on (p.conversa_id) ${COLUNAS} from sintonia.perdas p
        where p.funil_id = $1 and p.conversa_id = any($2::uuid[])
        order by p.conversa_id, p.em desc`,
      [funilId, ids],
    );
    return new Map(rows.map((l) => [l.conversa_id, paraPerda(l)]));
  }
  async listar(f: FiltroPerdas) {
    const params: unknown[] = [f.inicio, f.fim];
    let w = sqlEscopo(f.escopo, 'c', params);
    if (f.escopo.empresaId) {
      params.push(f.escopo.empresaId);
      w += ` and p.empresa_id = $${params.length}`;
    }
    if (f.atendente) {
      params.push(f.atendente);
      w += ` and p.atendente_id = $${params.length}`;
    }
    const { rows } = await this.pool.query<Linha & { cliente: string | null }>(
      `select ${COLUNAS}, c.nome as cliente from sintonia.perdas p join sintonia.conversas c on c.id = p.conversa_id
        where p.em >= $1 and p.em < $2 and ${w}
        order by p.em, p.id
        limit 50000`,
      params,
    );
    return rows.map((l) => ({ ...paraPerda(l), cliente: l.cliente }));
  }
}
