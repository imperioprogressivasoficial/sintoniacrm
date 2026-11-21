import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Conversa } from '../domain.js';

/**
 * conversa-extra: o que cada pessoa decide só para ela numa conversa de cliente — silenciar e arquivar.
 *
 * Por que é por pessoa (e não da empresa inteira): cada atendente organiza a própria lista, como no WhatsApp.
 * Se a Carla arquiva uma cliente que já foi resolvida para ela, a gerente que acompanha a mesma conversa
 * continua vendo — ninguém some com uma cliente da lista de outra pessoa sem querer. É o mesmo modelo das
 * "marcadas como não lidas" (src/app/leituras.ts).
 *
 * Regras:
 * - Silenciar: por 8 horas, 1 semana ou sempre. Silenciada = sem som, vibração e push dessa conversa para essa pessoa.
 *   A conversa continua na lista, com a bolinha de não lida e o sino cortado.
 * - Arquivar: sai da lista principal e vai para "Arquivadas". Mensagem nova da CLIENTE tira do arquivo sozinha
 *   (diferente dos grupos), para nenhuma cliente ficar esquecida. Não muda nada no Pipeline, na IA nem nos alarmes.
 * Guardado em sintonia.conversas_pessoais (migração 510).
 */

export interface EstadoPessoal {
  /** Silenciada até quando (null = não silenciada, ou silenciada para sempre: veja `sempre`). */
  silenciadaAte: Date | null;
  silenciadaSempre: boolean;
  /** Quando a pessoa arquivou (null = não arquivada). */
  arquivadaEm: Date | null;
}

export const DURACOES = ['8h', '1sem', 'sempre', 'nao'] as const;
export type Duracao = (typeof DURACOES)[number];
const HORA = 3600_000;

/** Até quando vale o silêncio pedido (null = tirar o silêncio). */
export function fimDoSilencio(d: Duracao, agora: Date): Date | 'sempre' | null {
  if (d === 'nao') return null;
  if (d === 'sempre') return 'sempre';
  return new Date(agora.getTime() + (d === '8h' ? 8 : 7 * 24) * HORA);
}

export const estaSilenciada = (e: EstadoPessoal | undefined, agora: Date): boolean =>
  Boolean(e && (e.silenciadaSempre || (e.silenciadaAte && e.silenciadaAte.getTime() > agora.getTime())));

/** Arquivada e a cliente não escreveu depois disso. */
export const estaArquivada = (e: EstadoPessoal | undefined, ultimaMensagemCliente?: Date | null): boolean =>
  Boolean(e?.arquivadaEm && !(ultimaMensagemCliente && new Date(ultimaMensagemCliente).getTime() > e.arquivadaEm.getTime()));

export interface ConversasPessoais {
  doUsuario(usuarioId: string): Promise<Map<string, EstadoPessoal>>;
  silenciar(usuarioId: string, empresaId: string, conversaIds: string[], ate: Date | 'sempre' | null): Promise<void>;
  arquivar(usuarioId: string, empresaId: string, conversaIds: string[], arquivar: boolean, em: Date): Promise<void>;
  /** Pessoas (ids) que silenciaram esta conversa agora (para o push). */
  silenciaramAgora(conversaId: string, agora: Date): Promise<Set<string>>;
}

const vazio = (): EstadoPessoal => ({ silenciadaAte: null, silenciadaSempre: false, arquivadaEm: null });

export class ConversasPessoaisMemoria implements ConversasPessoais {
  private readonly m = new Map<string, Map<string, EstadoPessoal & { empresaId: string }>>();
  private mexer(u: string, empresaId: string, id: string, f: (e: EstadoPessoal) => void) {
    const doU = this.m.get(u) ?? new Map();
    const e = doU.get(id) ?? { ...vazio(), empresaId };
    f(e);
    doU.set(id, e);
    this.m.set(u, doU);
  }
  async doUsuario(u: string) {
    const r = new Map<string, EstadoPessoal>();
    for (const [id, e] of this.m.get(u) ?? []) r.set(id, { silenciadaAte: e.silenciadaAte, silenciadaSempre: e.silenciadaSempre, arquivadaEm: e.arquivadaEm });
    return r;
  }
  async silenciar(u: string, empresaId: string, ids: string[], ate: Date | 'sempre' | null) {
    for (const id of ids)
      this.mexer(u, empresaId, id, (e) => {
        e.silenciadaSempre = ate === 'sempre';
        e.silenciadaAte = ate instanceof Date ? ate : null;
      });
  }
  async arquivar(u: string, empresaId: string, ids: string[], arquivar: boolean, em: Date) {
    for (const id of ids) this.mexer(u, empresaId, id, (e) => void (e.arquivadaEm = arquivar ? em : null));
  }
  async silenciaramAgora(conversaId: string, agora: Date) {
    const s = new Set<string>();
    for (const [u, doU] of this.m) if (estaSilenciada(doU.get(conversaId), agora)) s.add(u);
    return s;
  }
}

export class ConversasPessoaisPostgres implements ConversasPessoais {
  constructor(private readonly pool: pg.Pool) {}
  async doUsuario(u: string) {
    const { rows } = await this.pool.query<{ conversa_id: string; silenciada_ate: Date | null; silenciada_sempre: boolean; arquivada_em: Date | null }>(
      'select conversa_id, silenciada_ate, silenciada_sempre, arquivada_em from sintonia.conversas_pessoais where usuario_id = $1',
      [u],
    );
    return new Map(rows.map((r) => [r.conversa_id, { silenciadaAte: r.silenciada_ate, silenciadaSempre: r.silenciada_sempre, arquivadaEm: r.arquivada_em }]));
  }
  async silenciar(u: string, empresaId: string, ids: string[], ate: Date | 'sempre' | null) {
    if (!ids.length) return;
    await this.pool.query(
      `insert into sintonia.conversas_pessoais (usuario_id, conversa_id, empresa_id, silenciada_ate, silenciada_sempre)
       select $1, unnest($2::uuid[]), $3, $4, $5
       on conflict (usuario_id, conversa_id) do update set silenciada_ate = excluded.silenciada_ate, silenciada_sempre = excluded.silenciada_sempre, atualizado_em = now()`,
      [u, ids, empresaId, ate instanceof Date ? ate : null, ate === 'sempre'],
    );
  }
  async arquivar(u: string, empresaId: string, ids: string[], arquivar: boolean, em: Date) {
    if (!ids.length) return;
    await this.pool.query(
      `insert into sintonia.conversas_pessoais (usuario_id, conversa_id, empresa_id, arquivada_em)
       select $1, unnest($2::uuid[]), $3, $4
       on conflict (usuario_id, conversa_id) do update set arquivada_em = excluded.arquivada_em, atualizado_em = now()`,
      [u, ids, empresaId, arquivar ? em : null],
    );
  }
  async silenciaramAgora(conversaId: string, agora: Date) {
    const { rows } = await this.pool.query<{ usuario_id: string }>(
      'select usuario_id from sintonia.conversas_pessoais where conversa_id = $1 and (silenciada_sempre or silenciada_ate > $2)',
      [conversaId, agora],
    );
    return new Set(rows.map((r) => r.usuario_id));
  }
}

/** Campos que a lista de conversas (/api/conversas) ganha para a pessoa logada. */
export function camposPessoais(e: EstadoPessoal | undefined, c: Pick<Conversa, 'ultimaMensagemCliente'>, agora: Date) {
  const silenciada = estaSilenciada(e, agora);
  return {
    silenciada,
    /** null com silenciada = para sempre. */
    silenciadaAte: silenciada && e && !e.silenciadaSempre && e.silenciadaAte ? e.silenciadaAte : null,
    arquivada: estaArquivada(e, c.ultimaMensagemCliente),
  };
}

const Ids = z.array(z.string().uuid()).min(1).max(500);
const CorpoSilenciar = z.object({ ids: Ids, duracao: z.enum(DURACOES) });
const CorpoArquivar = z.object({ ids: Ids, arquivar: z.boolean() });

export interface OpcoesConversasPessoais {
  pessoais: ConversasPessoais;
  /** Conversas que a pessoa logada pode ver (mesma regra da lista). */
  visiveis: (req: FastifyRequest) => Promise<Conversa[]>;
  agora?: () => Date;
}

export function registrarConversasPessoais(app: FastifyInstance, o: OpcoesConversasPessoais): void {
  const agora = o.agora ?? (() => new Date());
  /** Só as conversas desta empresa que a pessoa vê; as outras são ignoradas (não revela que existem). */
  const alvos = async (req: FastifyRequest, ids: string[]) => {
    const u = req.usuario;
    if (!u) throw Object.assign(new Error('Faça login para continuar.'), { statusCode: 401 });
    const pedidas = new Set(ids);
    const conv = (await o.visiveis(req)).filter((c) => pedidas.has(c.id) && (!u.empresaId || c.empresaId === u.empresaId));
    return { u, conv };
  };
  const validar = <S extends z.ZodTypeAny>(s: S, v: unknown): z.infer<S> => {
    const r = s.safeParse(v ?? {});
    if (!r.success) throw Object.assign(new Error('Confira os dados enviados.'), { statusCode: 400 });
    return r.data;
  };

  app.post('/api/conversas/silenciar', async (req) => {
    const b = validar(CorpoSilenciar, req.body);
    const { u, conv } = await alvos(req, b.ids);
    const ate = fimDoSilencio(b.duracao, agora());
    // Cada conversa guarda a empresa dela (a pessoa só alcança as da própria empresa).
    for (const [empresaId, ids] of agrupar(conv)) await o.pessoais.silenciar(u.id, empresaId, ids, ate);
    return { ok: true, conversas: conv.length, silenciadaAte: ate instanceof Date ? ate : null, sempre: ate === 'sempre', silenciada: ate !== null };
  });

  app.post('/api/conversas/arquivar', async (req) => {
    const b = validar(CorpoArquivar, req.body);
    const { u, conv } = await alvos(req, b.ids);
    for (const [empresaId, ids] of agrupar(conv)) await o.pessoais.arquivar(u.id, empresaId, ids, b.arquivar, agora());
    return { ok: true, conversas: conv.length, arquivada: b.arquivar };
  });
}

function agrupar(conv: Conversa[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const c of conv) m.set(c.empresaId, [...(m.get(c.empresaId) ?? []), c.id]);
  return m;
}
