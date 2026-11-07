import type pg from 'pg';

/** Até onde cada pessoa leu cada conversa. "Não lida" = a cliente escreveu depois disso. */
export interface Leituras {
  doUsuario(usuarioId: string): Promise<Map<string, Date>>;
  /** Marca como lidas até `em`. Nunca volta atrás (um "lida" antigo não apaga um mais novo). */
  marcar(usuarioId: string, conversaIds: string[], em: Date): Promise<void>;
  /** Volta a conversa para não lida (o "marcar como não lida" do WhatsApp). */
  desmarcar(usuarioId: string, conversaIds: string[]): Promise<void>;
}

export class LeiturasMemoria implements Leituras {
  private readonly dados = new Map<string, Map<string, Date>>();
  async doUsuario(u: string) {
    return new Map(this.dados.get(u) ?? []);
  }
  async marcar(u: string, ids: string[], em: Date) {
    const m = this.dados.get(u) ?? new Map<string, Date>();
    for (const id of ids) if (!m.has(id) || m.get(id)! < em) m.set(id, em);
    this.dados.set(u, m);
  }
  async desmarcar(u: string, ids: string[]) {
    const m = this.dados.get(u);
    for (const id of ids) m?.delete(id);
  }
}

export class LeiturasPostgres implements Leituras {
  constructor(private readonly pool: pg.Pool) {}
  async doUsuario(u: string) {
    const { rows } = await this.pool.query<{ conversa_id: string; lida_ate: Date }>('select conversa_id, lida_ate from sintonia.leituras where usuario_id = $1', [u]);
    return new Map(rows.map((r) => [r.conversa_id, r.lida_ate]));
  }
  async marcar(u: string, ids: string[], em: Date) {
    if (!ids.length) return;
    await this.pool.query(
      `insert into sintonia.leituras (usuario_id, conversa_id, lida_ate) select $1, unnest($2::uuid[]), $3
       on conflict (usuario_id, conversa_id) do update set lida_ate = greatest(sintonia.leituras.lida_ate, excluded.lida_ate)`,
      [u, ids, em],
    );
  }
  async desmarcar(u: string, ids: string[]) {
    if (!ids.length) return;
    await this.pool.query('delete from sintonia.leituras where usuario_id = $1 and conversa_id = any($2::uuid[])', [u, ids]);
  }
}
