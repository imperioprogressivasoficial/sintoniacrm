import type pg from 'pg';
import type { Confirmacao, EnvioFollowup, EstadoEnvio, StatusConfirmacao } from './tipos.js';

/** Onde o follow-up guarda configuração, fila de envios, confirmações e pausas. */
export interface ArmazemFollowup {
  lerConfig(empresaId: string): Promise<unknown | undefined>;
  gravarConfig(empresaId: string, config: unknown, por: string): Promise<void>;

  /** Programa um envio; a chave é única (programar de novo a mesma chave não faz nada). Retorna se entrou. */
  programar(empresaId: string, e: Omit<EnvioFollowup, 'id' | 'estado' | 'criadoEm'>, agora: Date): Promise<boolean>;
  /** Cancela os pendentes da conversa (de um tipo/situações). Retorna quantos. */
  cancelar(conversaId: string, filtro: { tipo?: EnvioFollowup['tipo']; situacoes?: string[]; exceto?: string[]; dadosAgendamentoDiferente?: string }, motivo: string): Promise<number>;
  /** Pega os vencidos (e os presos em "enviando" com a reserva vencida), marcando como "enviando". */
  reivindicar(empresaId: string, agora: Date, limite: number, reservaMs: number): Promise<EnvioFollowup[]>;
  concluir(id: string, estado: EstadoEnvio, detalhe: string | null, em: Date): Promise<void>;
  /** Devolve para a fila em outro horário (ex.: loja fechada). */
  adiar(id: string, quando: Date): Promise<void>;
  envios(conversaId: string): Promise<EnvioFollowup[]>;
  contarEnviados(conversaId: string, tipo: EnvioFollowup['tipo'], desde: Date): Promise<number>;

  salvarConfirmacao(empresaId: string, c: Omit<Confirmacao, 'status' | 'perguntadoEm' | 'respondidoEm' | 'resposta'>): Promise<void>;
  confirmacao(empresaId: string, agendamento: string): Promise<Confirmacao | undefined>;
  confirmacoesDa(conversaId: string): Promise<Confirmacao[]>;
  confirmacoesEntre(empresaId: string, inicio: Date, fim: Date): Promise<Confirmacao[]>;
  marcarConfirmacao(empresaId: string, agendamento: string, campos: { status?: StatusConfirmacao; perguntadoEm?: Date; respondidoEm?: Date; resposta?: string }): Promise<void>;
  /** Perguntadas e sem resposta perto do horário: viram "sem resposta". */
  semResposta(empresaId: string, ate: Date): Promise<number>;

  pausado(conversaId: string): Promise<boolean>;
  pausar(conversaId: string, por: string, em: Date): Promise<void>;
  retomar(conversaId: string): Promise<void>;
}

const copia = <T>(x: T): T => ({ ...x });

export class ArmazemFollowupMemoria implements ArmazemFollowup {
  private configs = new Map<string, unknown>();
  private lista: Array<EnvioFollowup & { empresaId: string; reservadaAte?: Date }> = [];
  private confs = new Map<string, Confirmacao & { empresaId: string }>();
  private pausas = new Set<string>();
  private seq = 0;

  async lerConfig(empresaId: string) {
    return this.configs.get(empresaId);
  }
  async gravarConfig(empresaId: string, config: unknown) {
    this.configs.set(empresaId, JSON.parse(JSON.stringify(config)));
  }
  async programar(empresaId: string, e: Omit<EnvioFollowup, 'id' | 'estado' | 'criadoEm'>, agora: Date) {
    if (this.lista.some((x) => x.chave === e.chave)) return false;
    this.lista.push({ ...e, id: String(++this.seq), estado: 'pendente', criadoEm: agora, empresaId });
    return true;
  }
  async cancelar(conversaId: string, f: Parameters<ArmazemFollowup['cancelar']>[1], motivo: string) {
    let n = 0;
    for (const x of this.lista) {
      if (x.conversaId !== conversaId || x.estado !== 'pendente') continue;
      if (f.tipo && x.tipo !== f.tipo) continue;
      if (f.situacoes && !f.situacoes.includes(x.situacao)) continue;
      if (f.exceto && f.exceto.includes(x.situacao)) continue;
      if (f.dadosAgendamentoDiferente !== undefined && x.dados.agendamento === f.dadosAgendamentoDiferente) continue;
      x.estado = 'cancelado';
      x.detalhe = motivo;
      n++;
    }
    return n;
  }
  async reivindicar(empresaId: string, agora: Date, limite: number, reservaMs: number) {
    const prontos = this.lista
      .filter((x) => x.empresaId === empresaId && ((x.estado === 'pendente' && x.quando <= agora) || (x.estado === 'enviando' && x.reservadaAte && x.reservadaAte < agora)))
      .sort((a, b) => a.quando.getTime() - b.quando.getTime())
      .slice(0, limite);
    for (const x of prontos) {
      x.estado = 'enviando';
      x.reservadaAte = new Date(agora.getTime() + reservaMs);
    }
    return prontos.map(copia);
  }
  async concluir(id: string, estado: EstadoEnvio, detalhe: string | null, em: Date) {
    const x = this.lista.find((y) => y.id === id);
    if (!x) return;
    x.estado = estado;
    x.detalhe = detalhe;
    x.reservadaAte = undefined;
    if (estado === 'enviado') x.enviadoEm = em;
  }
  async adiar(id: string, quando: Date) {
    const x = this.lista.find((y) => y.id === id);
    if (!x) return;
    x.estado = 'pendente';
    x.quando = quando;
    x.reservadaAte = undefined;
  }
  async envios(conversaId: string) {
    return this.lista.filter((x) => x.conversaId === conversaId).sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime() || Number(b.id) - Number(a.id)).map(copia);
  }
  async contarEnviados(conversaId: string, tipo: EnvioFollowup['tipo'], desde: Date) {
    return this.lista.filter((x) => x.conversaId === conversaId && x.tipo === tipo && x.estado === 'enviado' && x.enviadoEm && x.enviadoEm >= desde).length;
  }
  async salvarConfirmacao(empresaId: string, c: Omit<Confirmacao, 'status' | 'perguntadoEm' | 'respondidoEm' | 'resposta'>) {
    const k = `${empresaId}|${c.agendamento}`;
    const antes = this.confs.get(k);
    this.confs.set(k, { ...c, empresaId, status: antes?.status ?? 'aguardando', perguntadoEm: antes?.perguntadoEm ?? null, respondidoEm: antes?.respondidoEm ?? null, resposta: antes?.resposta ?? null });
  }
  async confirmacao(empresaId: string, agendamento: string) {
    const c = this.confs.get(`${empresaId}|${agendamento}`);
    return c ? copia(c) : undefined;
  }
  async confirmacoesDa(conversaId: string) {
    return [...this.confs.values()].filter((c) => c.conversaId === conversaId).sort((a, b) => b.inicio.getTime() - a.inicio.getTime()).map(copia);
  }
  async confirmacoesEntre(empresaId: string, inicio: Date, fim: Date) {
    return [...this.confs.values()].filter((c) => c.empresaId === empresaId && c.inicio >= inicio && c.inicio < fim).map(copia);
  }
  async marcarConfirmacao(empresaId: string, agendamento: string, campos: Parameters<ArmazemFollowup['marcarConfirmacao']>[2]) {
    const c = this.confs.get(`${empresaId}|${agendamento}`);
    if (!c) return;
    if (campos.status) c.status = campos.status;
    if (campos.perguntadoEm) c.perguntadoEm = campos.perguntadoEm;
    if (campos.respondidoEm) c.respondidoEm = campos.respondidoEm;
    if (campos.resposta !== undefined) c.resposta = campos.resposta;
  }
  async semResposta(empresaId: string, ate: Date) {
    let n = 0;
    for (const c of this.confs.values()) {
      if (c.empresaId === empresaId && c.status === 'aguardando' && c.perguntadoEm && c.inicio <= ate) {
        c.status = 'sem_resposta';
        n++;
      }
    }
    return n;
  }
  async pausado(conversaId: string) {
    return this.pausas.has(conversaId);
  }
  async pausar(conversaId: string) {
    this.pausas.add(conversaId);
  }
  async retomar(conversaId: string) {
    this.pausas.delete(conversaId);
  }
}

type Linha = pg.QueryResultRow;
const envioDe = (r: Linha): EnvioFollowup => ({
  id: String(r.id),
  conversaId: r.conversa_id,
  tipo: r.tipo,
  situacao: r.situacao,
  passo: r.passo,
  total: r.total,
  chave: r.chave,
  quando: r.quando,
  estado: r.estado,
  dados: r.dados ?? {},
  detalhe: r.detalhe,
  criadoEm: r.criado_em,
  enviadoEm: r.enviado_em,
});
const confDe = (r: Linha): Confirmacao => ({
  agendamento: r.agendamento,
  conversaId: r.conversa_id,
  unidade: r.unidade,
  inicio: r.inicio,
  servico: r.servico,
  profissional: r.profissional,
  status: r.status,
  perguntadoEm: r.perguntado_em,
  respondidoEm: r.respondido_em,
  resposta: r.resposta,
});

export class ArmazemFollowupPostgres implements ArmazemFollowup {
  constructor(private readonly pool: pg.Pool) {}

  async lerConfig(empresaId: string) {
    const { rows } = await this.pool.query('select config from sintonia.followup_config where empresa_id = $1', [empresaId]);
    return rows[0]?.config;
  }
  async gravarConfig(empresaId: string, config: unknown, por: string) {
    await this.pool.query(
      `insert into sintonia.followup_config (empresa_id, config, atualizado_por, atualizado_em) values ($1, $2, $3, now())
       on conflict (empresa_id) do update set config = excluded.config, atualizado_por = excluded.atualizado_por, atualizado_em = now()`,
      [empresaId, JSON.stringify(config), por],
    );
  }
  async programar(empresaId: string, e: Omit<EnvioFollowup, 'id' | 'estado' | 'criadoEm'>, agora: Date) {
    const r = await this.pool.query(
      `insert into sintonia.followup_envios (empresa_id, conversa_id, tipo, situacao, passo, total, chave, quando, dados, criado_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (chave) do nothing`,
      [empresaId, e.conversaId, e.tipo, e.situacao, e.passo, e.total, e.chave, e.quando, JSON.stringify(e.dados ?? {}), agora],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async cancelar(conversaId: string, f: Parameters<ArmazemFollowup['cancelar']>[1], motivo: string) {
    const params: unknown[] = [conversaId, motivo];
    const add = (v: unknown) => `$${params.push(v)}`;
    const w = [`conversa_id = $1`, `estado = 'pendente'`];
    if (f.tipo) w.push(`tipo = ${add(f.tipo)}`);
    if (f.situacoes) w.push(`situacao = any(${add(f.situacoes)}::text[])`);
    if (f.exceto) w.push(`not (situacao = any(${add(f.exceto)}::text[]))`);
    if (f.dadosAgendamentoDiferente !== undefined) w.push(`coalesce(dados->>'agendamento', '') <> ${add(f.dadosAgendamentoDiferente)}`);
    const r = await this.pool.query(`update sintonia.followup_envios set estado = 'cancelado', detalhe = $2 where ${w.join(' and ')}`, params);
    return r.rowCount ?? 0;
  }
  async reivindicar(empresaId: string, agora: Date, limite: number, reservaMs: number) {
    const { rows } = await this.pool.query(
      `update sintonia.followup_envios set estado = 'enviando', reservada_ate = $3
        where id in (select id from sintonia.followup_envios
                      where empresa_id = $1 and ((estado = 'pendente' and quando <= $2) or (estado = 'enviando' and reservada_ate < $2))
                      order by quando limit $4 for update skip locked)
        returning *`,
      [empresaId, agora, new Date(agora.getTime() + reservaMs), limite],
    );
    return rows.map(envioDe).sort((a, b) => a.quando.getTime() - b.quando.getTime());
  }
  async concluir(id: string, estado: EstadoEnvio, detalhe: string | null, em: Date) {
    await this.pool.query(
      `update sintonia.followup_envios set estado = $2, detalhe = $3, reservada_ate = null, enviado_em = case when $2 = 'enviado' then $4::timestamptz else enviado_em end where id = $1`,
      [id, estado, detalhe, em],
    );
  }
  async adiar(id: string, quando: Date) {
    await this.pool.query(`update sintonia.followup_envios set estado = 'pendente', quando = $2, reservada_ate = null where id = $1`, [id, quando]);
  }
  async envios(conversaId: string) {
    const { rows } = await this.pool.query('select * from sintonia.followup_envios where conversa_id = $1 order by criado_em desc, id desc limit 200', [conversaId]);
    return rows.map(envioDe);
  }
  async contarEnviados(conversaId: string, tipo: EnvioFollowup['tipo'], desde: Date) {
    const { rows } = await this.pool.query(`select count(*)::int as n from sintonia.followup_envios where conversa_id = $1 and tipo = $2 and estado = 'enviado' and enviado_em >= $3`, [conversaId, tipo, desde]);
    return rows[0]?.n ?? 0;
  }
  async salvarConfirmacao(empresaId: string, c: Omit<Confirmacao, 'status' | 'perguntadoEm' | 'respondidoEm' | 'resposta'>) {
    await this.pool.query(
      `insert into sintonia.agenda_confirmacoes (empresa_id, agendamento, conversa_id, unidade, inicio, servico, profissional)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (empresa_id, agendamento) do update set conversa_id = excluded.conversa_id, unidade = excluded.unidade, inicio = excluded.inicio,
         servico = excluded.servico, profissional = excluded.profissional`,
      [empresaId, c.agendamento, c.conversaId, c.unidade, c.inicio, c.servico, c.profissional],
    );
  }
  async confirmacao(empresaId: string, agendamento: string) {
    const { rows } = await this.pool.query('select * from sintonia.agenda_confirmacoes where empresa_id = $1 and agendamento = $2', [empresaId, agendamento]);
    return rows[0] ? confDe(rows[0]) : undefined;
  }
  async confirmacoesDa(conversaId: string) {
    const { rows } = await this.pool.query('select * from sintonia.agenda_confirmacoes where conversa_id = $1 order by inicio desc limit 20', [conversaId]);
    return rows.map(confDe);
  }
  async confirmacoesEntre(empresaId: string, inicio: Date, fim: Date) {
    const { rows } = await this.pool.query('select * from sintonia.agenda_confirmacoes where empresa_id = $1 and inicio >= $2 and inicio < $3', [empresaId, inicio, fim]);
    return rows.map(confDe);
  }
  async marcarConfirmacao(empresaId: string, agendamento: string, campos: Parameters<ArmazemFollowup['marcarConfirmacao']>[2]) {
    await this.pool.query(
      `update sintonia.agenda_confirmacoes set status = coalesce($3, status), perguntado_em = coalesce($4, perguntado_em),
         respondido_em = coalesce($5, respondido_em), resposta = coalesce($6, resposta)
        where empresa_id = $1 and agendamento = $2`,
      [empresaId, agendamento, campos.status ?? null, campos.perguntadoEm ?? null, campos.respondidoEm ?? null, campos.resposta ?? null],
    );
  }
  async semResposta(empresaId: string, ate: Date) {
    const r = await this.pool.query(
      `update sintonia.agenda_confirmacoes set status = 'sem_resposta' where empresa_id = $1 and status = 'aguardando' and perguntado_em is not null and inicio <= $2`,
      [empresaId, ate],
    );
    return r.rowCount ?? 0;
  }
  async pausado(conversaId: string) {
    const { rows } = await this.pool.query('select 1 from sintonia.followup_pausas where conversa_id = $1', [conversaId]);
    return rows.length > 0;
  }
  async pausar(conversaId: string, por: string, em: Date) {
    await this.pool.query('insert into sintonia.followup_pausas (conversa_id, por, em) values ($1,$2,$3) on conflict (conversa_id) do update set por = excluded.por, em = excluded.em', [conversaId, por, em]);
  }
  async retomar(conversaId: string) {
    await this.pool.query('delete from sintonia.followup_pausas where conversa_id = $1', [conversaId]);
  }
}
