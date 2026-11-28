import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';

/**
 * Dashboard personalizado: cada pessoa arruma o seu (ordem dos blocos, blocos tirados, a métrica de cada bloco,
 * os relatórios que adicionou). Guardado como um JSON pequeno por pessoa (db/migrations/300_painel_layout.sql).
 * O servidor só confere a forma e o tamanho; quem sabe desenhar cada bloco é a tela (public/telas/painel.js).
 */

/** Tamanho máximo do JSON guardado (bytes). Um layout normal tem menos de 2 KB. */
export const LAYOUT_MAX_BYTES = 8 * 1024;

const Id = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Identificador de bloco inválido.');
const Metrica = z.string().regex(/^[a-zA-Z0-9-]{1,30}$/, 'Métrica inválida.');

export const LayoutPainel = z
  .object({
    versao: z.literal(1),
    blocos: z
      .array(
        z
          .object({
            id: Id,
            /** Coluna no computador: principal (larga) ou lateral. */
            coluna: z.enum(['principal', 'lateral']),
            oculto: z.boolean().optional(),
            /** Métrica escolhida no lápis (bloco de número e o grande do topo). */
            metrica: Metrica.optional(),
            /** Cartões de números: uma métrica por cartão. */
            metricas: z.array(Metrica).max(6).optional(),
          })
          .strict(),
      )
      .max(40)
      .refine((bs) => new Set(bs.map((b) => b.id)).size === bs.length, 'Bloco repetido.'),
  })
  .strict();
export type LayoutPainel = z.infer<typeof LayoutPainel>;

export interface LayoutsPainel {
  ler(usuarioId: string): Promise<LayoutPainel | undefined>;
  gravar(usuarioId: string, layout: LayoutPainel): Promise<void>;
  apagar(usuarioId: string): Promise<void>;
}

export class LayoutsPainelMemoria implements LayoutsPainel {
  private readonly dados = new Map<string, LayoutPainel>();
  async ler(u: string) {
    const l = this.dados.get(u);
    return l ? (JSON.parse(JSON.stringify(l)) as LayoutPainel) : undefined;
  }
  async gravar(u: string, l: LayoutPainel) {
    this.dados.set(u, JSON.parse(JSON.stringify(l)) as LayoutPainel);
  }
  async apagar(u: string) {
    this.dados.delete(u);
  }
}

export class LayoutsPainelPostgres implements LayoutsPainel {
  constructor(private readonly pool: pg.Pool) {}
  async ler(u: string) {
    const { rows } = await this.pool.query<{ dados: unknown }>('select dados from sintonia.painel_layouts where usuario_id = $1', [u]);
    if (!rows[0]) return undefined;
    // Um layout antigo que não confere mais com a forma atual é ignorado (a tela volta ao padrão).
    const r = LayoutPainel.safeParse(rows[0].dados);
    return r.success ? r.data : undefined;
  }
  async gravar(u: string, l: LayoutPainel) {
    await this.pool.query(
      `insert into sintonia.painel_layouts (usuario_id, dados, atualizado_em) values ($1, $2, now())
       on conflict (usuario_id) do update set dados = excluded.dados, atualizado_em = now()`,
      [u, JSON.stringify(l)],
    );
  }
  async apagar(u: string) {
    await this.pool.query('delete from sintonia.painel_layouts where usuario_id = $1', [u]);
  }
}

/** GET/PUT/DELETE /api/painel/layout: o layout do Dashboard de quem está entrando (cada um mexe só no seu). */
export function registrarLayoutPainel(app: FastifyInstance, layouts: LayoutsPainel): void {
  const semConta = () => Object.assign(new Error('Entre com a sua conta para guardar o seu Dashboard.'), { statusCode: 400, codigo: 'sem_conta' });
  app.get('/api/painel/layout', async (req) => {
    // Sem login (teste local): a tela guarda só neste navegador.
    if (!req.usuario) return { layout: null, guardaNoServidor: false };
    return { layout: (await layouts.ler(req.usuario.id)) ?? null, guardaNoServidor: true };
  });
  app.put('/api/painel/layout', { bodyLimit: LAYOUT_MAX_BYTES * 2 }, async (req) => {
    if (!req.usuario) throw semConta();
    if (JSON.stringify(req.body ?? null).length > LAYOUT_MAX_BYTES) throw Object.assign(new Error('Esse Dashboard ficou grande demais para guardar.'), { statusCode: 413 });
    const layout = LayoutPainel.parse(req.body);
    await layouts.gravar(req.usuario.id, layout);
    return { layout };
  });
  app.delete('/api/painel/layout', async (req) => {
    if (!req.usuario) throw semConta();
    await layouts.apagar(req.usuario.id);
    return { layout: null };
  });
}
