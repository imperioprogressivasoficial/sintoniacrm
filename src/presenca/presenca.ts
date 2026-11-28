import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { apareceNaEquipe } from '../auth/acesso.js';
import type { Contas } from '../auth/contas.js';
import { pode } from '../auth/permissoes.js';

/**
 * Presença da equipe: cada pessoa diz se está "Disponível para atender" (online) ou fora do ar (offline).
 * Guardada no banco (db/migrations/310_presenca.sql). Quem nunca mexeu no interruptor conta como online.
 * Substitui o serviço separado deploy/presenca (mesma rota, mesmo formato de pedido e resposta).
 */

export type StatusPresenca = 'online' | 'offline';
export const STATUS_PADRAO: StatusPresenca = 'online';

export interface Presencas {
  /** Status guardado de cada pessoa pedida (só as que já mexeram no interruptor). */
  ler(usuarioIds: string[]): Promise<Record<string, StatusPresenca>>;
  gravar(usuarioId: string, status: StatusPresenca): Promise<void>;
}

/** Status de cada pessoa, com o padrão (online) para quem nunca mexeu. */
export async function statusDe(p: Presencas, ids: string[]): Promise<Record<string, StatusPresenca>> {
  const unicos = [...new Set(ids)];
  const guardado = unicos.length ? await p.ler(unicos) : {};
  return Object.fromEntries(unicos.map((id) => [id, guardado[id] ?? STATUS_PADRAO]));
}

/** Das pessoas pedidas, só as que estão disponíveis para atender (para transferir ou distribuir conversas). */
export async function disponiveis(p: Presencas, ids: string[]): Promise<string[]> {
  const s = await statusDe(p, ids);
  return ids.filter((id) => s[id] === 'online');
}

export class PresencasMemoria implements Presencas {
  private readonly dados = new Map<string, StatusPresenca>();
  async ler(ids: string[]) {
    const r: Record<string, StatusPresenca> = {};
    for (const id of ids) {
      const s = this.dados.get(id);
      if (s) r[id] = s;
    }
    return r;
  }
  async gravar(id: string, status: StatusPresenca) {
    this.dados.set(id, status);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PresencasPostgres implements Presencas {
  constructor(private readonly pool: pg.Pool) {}
  async ler(ids: string[]) {
    const validos = ids.filter((id) => UUID.test(id));
    if (!validos.length) return {};
    const { rows } = await this.pool.query<{ usuario_id: string; status: StatusPresenca }>(
      'select usuario_id, status from sintonia.presencas where usuario_id = any($1::uuid[])',
      [validos],
    );
    return Object.fromEntries(rows.map((r) => [r.usuario_id, r.status]));
  }
  async gravar(id: string, status: StatusPresenca) {
    await this.pool.query(
      `insert into sintonia.presencas (usuario_id, status, atualizado_em) values ($1, $2, now())
       on conflict (usuario_id) do update set status = excluded.status, atualizado_em = now()`,
      [id, status],
    );
  }
}

const Pedido = z.object({ status: z.enum(['online', 'offline']) });

/**
 * GET /api/presenca  → { eu, status: { [id]: 'online' | 'offline' } }: a própria pessoa e, para quem cuida da equipe,
 *                      as pessoas da equipe que ela enxerga (igual ao serviço antigo, que usava /api/equipe).
 * PUT /api/presenca  { status } → { ok: true, status }: muda só o da própria pessoa.
 */
export function registrarPresenca(
  app: FastifyInstance,
  o: { presencas: Presencas; contas?: Contas; aoMudar?: (u: import('../auth/contas.js').Usuario, status: StatusPresenca) => Promise<unknown> },
): void {
  app.get('/api/presenca', async (req, reply) => {
    const eu = req.usuario;
    if (!eu) return reply.code(401).send({ erro: 'Entre de novo.' });
    const ids = [eu.id];
    if (o.contas && pode(req, 'equipe')) {
      const todos = await o.contas.listarUsuarios(eu.empresaId);
      for (const u of todos) if (u.id !== eu.id && apareceNaEquipe(eu, u)) ids.push(u.id);
    }
    reply.header('cache-control', 'no-store');
    return { eu: eu.id, status: await statusDe(o.presencas, ids) };
  });
  app.put('/api/presenca', { bodyLimit: 1000 }, async (req, reply) => {
    const eu = req.usuario;
    if (!eu) return reply.code(401).send({ erro: 'Entre de novo.' });
    const b = Pedido.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ erro: 'Status inválido.' });
    const antes = (await statusDe(o.presencas, [eu.id]))[eu.id];
    await o.presencas.gravar(eu.id, b.data.status);
    // ia-completa: ficou indisponível = a IA cobre as conversas dela; voltou = devolve (src/presenca/cobertura.ts).
    if (o.aoMudar && antes !== b.data.status) {
      try {
        const r = (await o.aoMudar(eu, b.data.status)) as { cobertas?: number; devolvidas?: number } | undefined;
        return { ok: true, status: b.data.status, ...(r ?? {}) };
      } catch (e) {
        req.log.error(e, 'Falha na cobertura da IA');
      }
    }
    return { ok: true, status: b.data.status };
  });
}
