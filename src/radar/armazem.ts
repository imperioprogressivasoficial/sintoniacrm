import type pg from 'pg';
import type { HistoricoRadar, ItemRadar } from './tipos.js';

/** Onde o radar guarda as conversas vigiadas e o histórico. */
export interface ArmazemRadar {
  obter(conversaId: string): Promise<ItemRadar | undefined>;
  listar(empresaId: string): Promise<ItemRadar[]>;
  /** Coloca (ou substitui) a conversa no radar. */
  salvar(item: ItemRadar): Promise<void>;
  apagar(conversaId: string): Promise<boolean>;
  atualizar(conversaId: string, campos: Partial<Pick<ItemRadar, 'vistoEm' | 'resposta' | 'respostaAte' | 'atualizadoEm'>>): Promise<void>;
  /** Passa de "vigiando" para "disparou" só uma vez (dois processos não disparam em dobro). */
  disparar(conversaId: string, campos: { motivo: string; disparadoEm: Date; resposta?: ItemRadar['resposta']; respostaAte?: Date }): Promise<boolean>;
  /** Vigiando com prazo vencido. */
  vencidos(empresaId: string, agora: Date): Promise<ItemRadar[]>;
  /** "A IA responde" esperando a resposta e com a hora de agir vencida. */
  respostasPendentes(empresaId: string, agora: Date): Promise<ItemRadar[]>;
  registrar(empresaId: string, h: HistoricoRadar): Promise<void>;
  historico(conversaId: string, limite?: number): Promise<HistoricoRadar[]>;
}

const copia = (x: ItemRadar): ItemRadar => ({ ...x });

export class ArmazemRadarMemoria implements ArmazemRadar {
  private itens = new Map<string, ItemRadar>();
  private hist: Array<HistoricoRadar & { empresaId: string }> = [];

  async obter(id: string) {
    const x = this.itens.get(id);
    return x ? copia(x) : undefined;
  }
  async listar(empresaId: string) {
    return [...this.itens.values()].filter((x) => x.empresaId === empresaId).map(copia);
  }
  async salvar(item: ItemRadar) {
    this.itens.set(item.conversaId, copia(item));
  }
  async apagar(id: string) {
    return this.itens.delete(id);
  }
  async atualizar(id: string, campos: Parameters<ArmazemRadar['atualizar']>[1]) {
    const x = this.itens.get(id);
    if (x) Object.assign(x, campos);
  }
  async disparar(id: string, campos: Parameters<ArmazemRadar['disparar']>[1]) {
    const x = this.itens.get(id);
    if (!x || x.estado !== 'vigiando') return false;
    Object.assign(x, { estado: 'disparou', motivo: campos.motivo, disparadoEm: campos.disparadoEm, vistoEm: undefined, resposta: campos.resposta, respostaAte: campos.respostaAte, atualizadoEm: campos.disparadoEm });
    return true;
  }
  async vencidos(empresaId: string, agora: Date) {
    return (await this.listar(empresaId)).filter((x) => x.estado === 'vigiando' && x.prazo && x.prazo.getTime() <= agora.getTime());
  }
  async respostasPendentes(empresaId: string, agora: Date) {
    return (await this.listar(empresaId)).filter((x) => x.resposta === 'pendente' && (x.respostaAte?.getTime() ?? 0) <= agora.getTime());
  }
  async registrar(empresaId: string, h: HistoricoRadar) {
    this.hist.push({ ...h, empresaId });
  }
  async historico(id: string, limite = 30) {
    return this.hist
      .filter((h) => h.conversaId === id)
      .reverse() // mesmo horário: o mais novo primeiro
      .sort((a, b) => b.em.getTime() - a.em.getTime())
      .slice(0, limite)
      .map(({ empresaId: _e, ...h }) => h);
  }
}

type Linha = {
  conversa_id: string;
  empresa_id: string;
  vigiar: string;
  prazo: Date | null;
  acao: ItemRadar['acao'];
  instrucao: string | null;
  dono_id: string | null;
  dono_nome: string | null;
  estado: ItemRadar['estado'];
  motivo: string | null;
  disparado_em: Date | null;
  visto_em: Date | null;
  resposta: ItemRadar['resposta'] | null;
  resposta_ate: Date | null;
  criado_em: Date;
  atualizado_em: Date;
};

const deLinha = (r: Linha): ItemRadar => ({
  conversaId: r.conversa_id,
  empresaId: r.empresa_id,
  vigiar: r.vigiar,
  ...(r.prazo ? { prazo: r.prazo } : {}),
  acao: r.acao,
  ...(r.instrucao ? { instrucao: r.instrucao } : {}),
  ...(r.dono_id ? { donoId: r.dono_id } : {}),
  ...(r.dono_nome ? { donoNome: r.dono_nome } : {}),
  estado: r.estado,
  ...(r.motivo ? { motivo: r.motivo } : {}),
  ...(r.disparado_em ? { disparadoEm: r.disparado_em } : {}),
  ...(r.visto_em ? { vistoEm: r.visto_em } : {}),
  ...(r.resposta ? { resposta: r.resposta } : {}),
  ...(r.resposta_ate ? { respostaAte: r.resposta_ate } : {}),
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
});

export class ArmazemRadarPostgres implements ArmazemRadar {
  constructor(private readonly pool: pg.Pool) {}

  async obter(id: string) {
    const { rows } = await this.pool.query<Linha>('select * from sintonia.radar_conversas where conversa_id = $1', [id]);
    return rows[0] ? deLinha(rows[0]) : undefined;
  }
  async listar(empresaId: string) {
    const { rows } = await this.pool.query<Linha>('select * from sintonia.radar_conversas where empresa_id = $1 order by atualizado_em desc', [empresaId]);
    return rows.map(deLinha);
  }
  async salvar(x: ItemRadar) {
    await this.pool.query(
      `insert into sintonia.radar_conversas (conversa_id, empresa_id, vigiar, prazo, acao, instrucao, dono_id, dono_nome, estado, motivo, disparado_em, visto_em, resposta, resposta_ate, criado_em, atualizado_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (conversa_id) do update set vigiar = excluded.vigiar, prazo = excluded.prazo, acao = excluded.acao, instrucao = excluded.instrucao,
         dono_id = excluded.dono_id, dono_nome = excluded.dono_nome, estado = excluded.estado, motivo = excluded.motivo, disparado_em = excluded.disparado_em,
         visto_em = excluded.visto_em, resposta = excluded.resposta, resposta_ate = excluded.resposta_ate, atualizado_em = excluded.atualizado_em`,
      [x.conversaId, x.empresaId, x.vigiar, x.prazo ?? null, x.acao, x.instrucao ?? null, x.donoId ?? null, x.donoNome ?? null, x.estado, x.motivo ?? null, x.disparadoEm ?? null, x.vistoEm ?? null, x.resposta ?? null, x.respostaAte ?? null, x.criadoEm, x.atualizadoEm],
    );
  }
  async apagar(id: string) {
    const r = await this.pool.query('delete from sintonia.radar_conversas where conversa_id = $1', [id]);
    return (r.rowCount ?? 0) > 0;
  }
  async atualizar(id: string, campos: Parameters<ArmazemRadar['atualizar']>[1]) {
    const mapa: Record<string, string> = { vistoEm: 'visto_em', resposta: 'resposta', respostaAte: 'resposta_ate', atualizadoEm: 'atualizado_em' };
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const [k, v] of Object.entries(campos)) {
      if (!mapa[k]) continue;
      params.push(v ?? null);
      sets.push(`${mapa[k]} = $${params.length}`);
    }
    if (sets.length) await this.pool.query(`update sintonia.radar_conversas set ${sets.join(', ')} where conversa_id = $1`, params);
  }
  async disparar(id: string, c: Parameters<ArmazemRadar['disparar']>[1]) {
    const r = await this.pool.query(
      `update sintonia.radar_conversas set estado = 'disparou', motivo = $2, disparado_em = $3, visto_em = null, resposta = $4, resposta_ate = $5, atualizado_em = $3
       where conversa_id = $1 and estado = 'vigiando'`,
      [id, c.motivo, c.disparadoEm, c.resposta ?? null, c.respostaAte ?? null],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async vencidos(empresaId: string, agora: Date) {
    const { rows } = await this.pool.query<Linha>(
      `select * from sintonia.radar_conversas where empresa_id = $1 and estado = 'vigiando' and prazo is not null and prazo <= $2 order by prazo limit 50`,
      [empresaId, agora],
    );
    return rows.map(deLinha);
  }
  async respostasPendentes(empresaId: string, agora: Date) {
    const { rows } = await this.pool.query<Linha>(
      `select * from sintonia.radar_conversas where empresa_id = $1 and resposta = 'pendente' and coalesce(resposta_ate, '-infinity') <= $2 order by resposta_ate limit 20`,
      [empresaId, agora],
    );
    return rows.map(deLinha);
  }
  async registrar(empresaId: string, h: HistoricoRadar) {
    await this.pool.query('insert into sintonia.radar_historico (empresa_id, conversa_id, tipo, texto, por, em) values ($1,$2,$3,$4,$5,$6)', [empresaId, h.conversaId, h.tipo, h.texto, h.por ?? null, h.em]);
  }
  async historico(id: string, limite = 30) {
    const { rows } = await this.pool.query<{ conversa_id: string; tipo: HistoricoRadar['tipo']; texto: string; por: string | null; em: Date }>(
      'select conversa_id, tipo, texto, por, em from sintonia.radar_historico where conversa_id = $1 order by em desc, id desc limit $2',
      [id, limite],
    );
    return rows.map((r) => ({ conversaId: r.conversa_id, tipo: r.tipo, texto: r.texto, ...(r.por ? { por: r.por } : {}), em: r.em }));
  }
}
