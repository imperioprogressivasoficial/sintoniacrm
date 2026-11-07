import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { CustoClt, Janela, PlanoId } from './catalogo.js';
import { dataISO } from '../util/tempo.js';

/**
 * Onde ficam o uso da IA (cada chamada à API), a assinatura da empresa, os pedidos (mudar de plano, adicional,
 * recarga) e os bloqueios do porteiro. Memória para os testes; Postgres (db/migrations/250_planos.sql) em produção.
 */

export interface RegistroUso {
  empresaId: string;
  em: Date;
  conversaId: string | null;
  /** agente, copiloto, comando, assistente... (de onde veio a chamada). */
  origem: string;
  modelo: string;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  custoUsd: number;
  dentroHorario: boolean;
}

export interface UsoDia {
  dia: string;
  chamadas: number;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  tokens: number;
  custoUsd: number;
  tokensDentro: number;
  tokensFora: number;
  conversas: number;
}

export interface ResumoUso extends Omit<UsoDia, 'dia'> {
  porDia: UsoDia[];
}

export interface Assinatura {
  empresaId: string;
  plano: PlanoId;
  adicionalFora: boolean;
  status: 'ativa' | 'suspensa';
  /** Ajustes da empresa por cima da configuração sugerida. */
  clt?: Partial<CustoClt>;
  janela?: Janela;
  feriados?: string[];
  atualizadaEm: Date;
  atualizadaPor: string | null;
}

export type TipoPedido = 'mudar_plano' | 'adicional_fora' | 'recarga';
export interface Pedido {
  id: string;
  empresaId: string;
  tipo: TipoPedido;
  /** plano pedido, recargaId, tokens, valor... */
  dados: Record<string, unknown>;
  /** pendente = aguardando pagamento; pago = creditado/aplicado. */
  status: 'pendente' | 'pago' | 'cancelado';
  criadoEm: Date;
  pagoEm: Date | null;
  por: string | null;
}

export interface Bloqueio {
  empresaId: string;
  em: Date;
  conversaId: string | null;
  motivo: string;
}

export interface ArmazemPlanos {
  registrarUso(u: RegistroUso): Promise<void>;
  resumo(empresaId: string, inicio: Date, fim: Date): Promise<ResumoUso>;
  assinatura(empresaId: string): Promise<Assinatura | null>;
  gravarAssinatura(a: Assinatura): Promise<void>;
  criarPedido(p: Omit<Pedido, 'id'>): Promise<Pedido>;
  marcarPedido(empresaId: string, id: string, status: Pedido['status'], em: Date): Promise<Pedido | null>;
  pedidos(empresaId: string, limite?: number): Promise<Pedido[]>;
  /** Tokens das recargas pagas no período (valem no mês em que foram pagas). */
  tokensRecargas(empresaId: string, inicio: Date, fim: Date): Promise<number>;
  registrarBloqueio(b: Bloqueio): Promise<void>;
  bloqueios(empresaId: string, inicio: Date, fim: Date): Promise<Array<{ motivo: string; total: number }>>;
}

const vazio = (dia: string): UsoDia => ({ dia, chamadas: 0, entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0, tokens: 0, custoUsd: 0, tokensDentro: 0, tokensFora: 0, conversas: 0 });

function somar(porDia: UsoDia[], conversas: number): ResumoUso {
  const t = vazio('');
  for (const d of porDia) for (const k of ['chamadas', 'entrada', 'saida', 'cacheLeitura', 'cacheEscrita', 'tokens', 'custoUsd', 'tokensDentro', 'tokensFora'] as const) t[k] += d[k];
  const { dia: _, ...resto } = t;
  return { ...resto, conversas, porDia };
}

export class ArmazemPlanosMemoria implements ArmazemPlanos {
  readonly usos: RegistroUso[] = [];
  private readonly ass = new Map<string, Assinatura>();
  private readonly ped: Pedido[] = [];
  readonly bloq: Bloqueio[] = [];

  async registrarUso(u: RegistroUso) {
    this.usos.push({ ...u });
  }
  async resumo(empresaId: string, inicio: Date, fim: Date) {
    const sel = this.usos.filter((u) => u.empresaId === empresaId && u.em >= inicio && u.em < fim);
    const dias = new Map<string, UsoDia & { cs: Set<string> }>();
    for (const u of sel) {
      const k = dataISO(u.em);
      const d = dias.get(k) ?? { ...vazio(k), cs: new Set<string>() };
      const tk = u.entrada + u.saida + u.cacheLeitura + u.cacheEscrita;
      d.chamadas++;
      d.entrada += u.entrada;
      d.saida += u.saida;
      d.cacheLeitura += u.cacheLeitura;
      d.cacheEscrita += u.cacheEscrita;
      d.tokens += tk;
      d.custoUsd += u.custoUsd;
      if (u.dentroHorario) d.tokensDentro += tk;
      else d.tokensFora += tk;
      if (u.conversaId) d.cs.add(u.conversaId);
      dias.set(k, d);
    }
    const porDia = [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)).map(({ cs, ...d }) => ({ ...d, conversas: cs.size }));
    return somar(porDia, new Set(sel.map((u) => u.conversaId).filter(Boolean)).size);
  }
  async assinatura(empresaId: string) {
    const a = this.ass.get(empresaId);
    return a ? { ...a } : null;
  }
  async gravarAssinatura(a: Assinatura) {
    this.ass.set(a.empresaId, { ...a });
  }
  async criarPedido(p: Omit<Pedido, 'id'>) {
    const n = { ...p, id: randomUUID() };
    this.ped.push(n);
    return { ...n };
  }
  async marcarPedido(empresaId: string, id: string, status: Pedido['status'], em: Date) {
    const p = this.ped.find((x) => x.id === id && x.empresaId === empresaId);
    if (!p) return null;
    p.status = status;
    p.pagoEm = status === 'pago' ? em : p.pagoEm;
    return { ...p };
  }
  async pedidos(empresaId: string, limite = 20) {
    return this.ped.filter((p) => p.empresaId === empresaId).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime()).slice(0, limite).map((p) => ({ ...p }));
  }
  async tokensRecargas(empresaId: string, inicio: Date, fim: Date) {
    return this.ped
      .filter((p) => p.empresaId === empresaId && p.tipo === 'recarga' && p.status === 'pago' && p.pagoEm && p.pagoEm >= inicio && p.pagoEm < fim)
      .reduce((s, p) => s + Number(p.dados.tokens ?? 0), 0);
  }
  async registrarBloqueio(b: Bloqueio) {
    this.bloq.push({ ...b });
  }
  async bloqueios(empresaId: string, inicio: Date, fim: Date) {
    const m = new Map<string, number>();
    for (const b of this.bloq) if (b.empresaId === empresaId && b.em >= inicio && b.em < fim) m.set(b.motivo, (m.get(b.motivo) ?? 0) + 1);
    return [...m].map(([motivo, total]) => ({ motivo, total }));
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type LinhaPedido = { id: string; empresa_id: string; tipo: TipoPedido; dados: Record<string, unknown>; status: Pedido['status']; criado_em: Date; pago_em: Date | null; por: string | null };
const pedidoDe = (r: LinhaPedido): Pedido => ({ id: r.id, empresaId: r.empresa_id, tipo: r.tipo, dados: r.dados ?? {}, status: r.status, criadoEm: r.criado_em, pagoEm: r.pago_em, por: r.por });

export class ArmazemPlanosPostgres implements ArmazemPlanos {
  constructor(private readonly pool: pg.Pool) {}

  async registrarUso(u: RegistroUso) {
    await this.pool.query(
      `insert into sintonia.ia_uso (empresa_id, em, conversa_id, origem, modelo, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo_usd, dentro_horario)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [u.empresaId, u.em, u.conversaId, u.origem, u.modelo, u.entrada, u.saida, u.cacheLeitura, u.cacheEscrita, u.custoUsd, u.dentroHorario],
    );
  }

  async resumo(empresaId: string, inicio: Date, fim: Date) {
    const { rows } = await this.pool.query<Record<string, string>>(
      `select to_char(em at time zone 'America/Bahia', 'YYYY-MM-DD') as dia, count(*) as chamadas,
              sum(tokens_entrada) as entrada, sum(tokens_saida) as saida, sum(tokens_cache_leitura) as cache_leitura, sum(tokens_cache_escrita) as cache_escrita,
              sum(custo_usd) as custo,
              sum(case when dentro_horario then tokens_entrada + tokens_saida + tokens_cache_leitura + tokens_cache_escrita else 0 end) as dentro,
              sum(case when dentro_horario then 0 else tokens_entrada + tokens_saida + tokens_cache_leitura + tokens_cache_escrita end) as fora,
              count(distinct conversa_id) as conversas
         from sintonia.ia_uso where empresa_id = $1 and em >= $2 and em < $3 group by 1 order by 1`,
      [empresaId, inicio, fim],
    );
    const porDia: UsoDia[] = rows.map((r) => {
      const d = { dia: r.dia!, chamadas: Number(r.chamadas), entrada: Number(r.entrada), saida: Number(r.saida), cacheLeitura: Number(r.cache_leitura), cacheEscrita: Number(r.cache_escrita), custoUsd: Number(r.custo), tokensDentro: Number(r.dentro), tokensFora: Number(r.fora), conversas: Number(r.conversas), tokens: 0 };
      d.tokens = d.entrada + d.saida + d.cacheLeitura + d.cacheEscrita;
      return d;
    });
    const c = await this.pool.query<{ n: string }>('select count(distinct conversa_id) as n from sintonia.ia_uso where empresa_id = $1 and em >= $2 and em < $3', [empresaId, inicio, fim]);
    return somar(porDia, Number(c.rows[0]?.n ?? 0));
  }

  async assinatura(empresaId: string) {
    const { rows } = await this.pool.query<{ plano: PlanoId; adicional_fora: boolean; status: Assinatura['status']; config: Record<string, unknown>; atualizada_em: Date; atualizada_por: string | null }>(
      'select plano, adicional_fora, status, config, atualizada_em, atualizada_por from sintonia.ia_assinaturas where empresa_id = $1',
      [empresaId],
    );
    const r = rows[0];
    if (!r) return null;
    const cfg = r.config ?? {};
    return {
      empresaId,
      plano: r.plano,
      adicionalFora: r.adicional_fora,
      status: r.status,
      clt: cfg.clt as Assinatura['clt'],
      janela: cfg.janela as Assinatura['janela'],
      feriados: cfg.feriados as Assinatura['feriados'],
      atualizadaEm: r.atualizada_em,
      atualizadaPor: r.atualizada_por,
    };
  }

  async gravarAssinatura(a: Assinatura) {
    await this.pool.query(
      `insert into sintonia.ia_assinaturas (empresa_id, plano, adicional_fora, status, config, atualizada_em, atualizada_por)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (empresa_id) do update set plano = excluded.plano, adicional_fora = excluded.adicional_fora, status = excluded.status,
         config = excluded.config, atualizada_em = excluded.atualizada_em, atualizada_por = excluded.atualizada_por`,
      [a.empresaId, a.plano, a.adicionalFora, a.status, JSON.stringify({ clt: a.clt, janela: a.janela, feriados: a.feriados }), a.atualizadaEm, a.atualizadaPor],
    );
  }

  async criarPedido(p: Omit<Pedido, 'id'>) {
    const { rows } = await this.pool.query<LinhaPedido>(
      `insert into sintonia.ia_pedidos (id, empresa_id, tipo, dados, status, criado_em, pago_em, por) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [randomUUID(), p.empresaId, p.tipo, JSON.stringify(p.dados), p.status, p.criadoEm, p.pagoEm, p.por],
    );
    return pedidoDe(rows[0]!);
  }

  async marcarPedido(empresaId: string, id: string, status: Pedido['status'], em: Date) {
    if (!UUID.test(id)) return null;
    const { rows } = await this.pool.query<LinhaPedido>(
      `update sintonia.ia_pedidos set status = $3, pago_em = case when $3 = 'pago' then $4 else pago_em end where empresa_id = $1 and id = $2 returning *`,
      [empresaId, id, status, em],
    );
    return rows[0] ? pedidoDe(rows[0]) : null;
  }

  async pedidos(empresaId: string, limite = 20) {
    const { rows } = await this.pool.query<LinhaPedido>('select * from sintonia.ia_pedidos where empresa_id = $1 order by criado_em desc limit $2', [empresaId, limite]);
    return rows.map(pedidoDe);
  }

  async tokensRecargas(empresaId: string, inicio: Date, fim: Date) {
    const { rows } = await this.pool.query<{ n: string | null }>(
      `select sum((dados->>'tokens')::bigint) as n from sintonia.ia_pedidos
        where empresa_id = $1 and tipo = 'recarga' and status = 'pago' and pago_em >= $2 and pago_em < $3`,
      [empresaId, inicio, fim],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async registrarBloqueio(b: Bloqueio) {
    await this.pool.query('insert into sintonia.ia_bloqueios (empresa_id, em, conversa_id, motivo) values ($1, $2, $3, $4)', [b.empresaId, b.em, b.conversaId, b.motivo]);
  }

  async bloqueios(empresaId: string, inicio: Date, fim: Date) {
    const { rows } = await this.pool.query<{ motivo: string; total: string }>(
      'select motivo, count(*) as total from sintonia.ia_bloqueios where empresa_id = $1 and em >= $2 and em < $3 group by motivo',
      [empresaId, inicio, fim],
    );
    return rows.map((r) => ({ motivo: r.motivo, total: Number(r.total) }));
  }
}
