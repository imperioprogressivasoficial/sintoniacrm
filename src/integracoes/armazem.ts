import type pg from 'pg';

/** Chaves de API, uso, webhooks e entregas: em memória (testes, uso local) ou no Postgres (500_integracoes.sql). */

export interface ChaveApi {
  id: string;
  empresaId: string;
  nome: string;
  /** "sk_abcdefghij": a parte aberta da chave. */
  prefixo: string;
  hash: string;
  escopos: string[];
  limiteMinuto: number;
  criadaPor: string | null;
  criadaPorNome: string | null;
  criadaEm: Date;
  expiraEm: Date | null;
  ultimoUsoEm: Date | null;
  ultimoIp: string | null;
  revogadaEm: Date | null;
}

export interface UsoApi {
  chaveId: string;
  empresaId: string;
  origem: 'api' | 'mcp';
  metodo: string;
  rota: string;
  status: number;
  duracaoMs: number;
  ip: string | null;
  em: Date;
}

export interface Webhook {
  id: string;
  empresaId: string;
  nome: string;
  url: string;
  eventos: string[];
  segredoCifrado: string;
  ativo: boolean;
  desligadoMotivo: string | null;
  desligadoEm: Date | null;
  falhasSeguidas: number;
  ultimoSucessoEm: Date | null;
  ultimaFalhaEm: Date | null;
  criadoPor: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

export type StatusEntrega = 'pendente' | 'entregue' | 'falhou' | 'cancelada';

export interface Entrega {
  id: string;
  webhookId: string;
  empresaId: string;
  evento: string;
  eventoId: string;
  corpo: Record<string, unknown>;
  status: StatusEntrega;
  tentativas: number;
  proximaEm: Date | null;
  reservadaAte: Date | null;
  ultimoHttp: number | null;
  ultimaResposta: string | null;
  ultimoErro: string | null;
  duracaoMs: number | null;
  teste: boolean;
  criadaEm: Date;
  entregueEm: Date | null;
  atualizadaEm: Date;
}

export type CamposWebhook = Partial<Pick<Webhook, 'nome' | 'url' | 'eventos' | 'segredoCifrado' | 'ativo' | 'desligadoMotivo' | 'desligadoEm' | 'falhasSeguidas'>>;
export type CamposEntrega = Partial<Pick<Entrega, 'status' | 'proximaEm' | 'reservadaAte' | 'ultimoHttp' | 'ultimaResposta' | 'ultimoErro' | 'duracaoMs' | 'entregueEm'>>;

export interface ArmazemIntegracoes {
  // ---- chaves
  criarChave(c: ChaveApi): Promise<void>;
  chavePorPrefixo(prefixo: string): Promise<ChaveApi | undefined>;
  chaves(empresaId: string): Promise<ChaveApi[]>;
  chave(empresaId: string, id: string): Promise<ChaveApi | undefined>;
  revogarChave(empresaId: string, id: string, em: Date, por: string): Promise<boolean>;
  marcarUsoChave(id: string, em: Date, ip: string | null): Promise<void>;
  registrarUso(lista: UsoApi[]): Promise<void>;
  usoDaChave(empresaId: string, chaveId: string, limite: number): Promise<UsoApi[]>;
  /** Chamadas e erros (status ≥ 400) de cada chave desde `desde`. */
  resumoUso(empresaId: string, desde: Date): Promise<Map<string, { total: number; erros: number }>>;

  // ---- webhooks
  criarWebhook(w: Webhook): Promise<void>;
  webhooks(empresaId: string): Promise<Webhook[]>;
  webhook(empresaId: string, id: string): Promise<Webhook | undefined>;
  /** Todos os ligados, de todas as empresas (cache de quem assina cada evento). */
  webhooksAtivos(): Promise<Webhook[]>;
  atualizarWebhook(empresaId: string, id: string, campos: CamposWebhook, em: Date): Promise<boolean>;
  apagarWebhook(empresaId: string, id: string): Promise<boolean>;
  /** Anota sucesso (zera as falhas seguidas) ou falha (soma 1). Devolve as falhas seguidas depois disso. */
  resultadoWebhook(id: string, sucesso: boolean, em: Date): Promise<number>;

  // ---- entregas
  enfileirar(lista: Entrega[]): Promise<void>;
  /** Pega as pendentes vencidas e reserva por `reservaMs` (com vários processos, cada uma sai para um só). Soma 1 tentativa. */
  reivindicar(agora: Date, limite: number, reservaMs: number): Promise<Entrega[]>;
  atualizarEntrega(id: string, campos: CamposEntrega, em: Date): Promise<void>;
  entrega(empresaId: string, id: string): Promise<Entrega | undefined>;
  /** Histórico de um webhook, do mais novo para o mais velho; `antes` = cursor. */
  entregas(empresaId: string, webhookId: string, limite: number, antes?: { em: Date; id: string }): Promise<Entrega[]>;
  /** Pendentes do webhook viram canceladas (webhook desligado ou apagado). */
  cancelarPendentes(webhookId: string, motivo: string, em: Date): Promise<number>;
  /** Contagem das entregas do webhook nas últimas 24 h, por status. */
  contagem(empresaId: string, webhookId: string, desde: Date): Promise<Record<StatusEntrega, number>>;
  limpar(antesDe: Date): Promise<void>;
}

const copia = <T>(x: T): T => structuredClone(x);
const cmpEntrega = (a: Entrega, b: Entrega) => b.criadaEm.getTime() - a.criadaEm.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export class ArmazemIntegracoesMemoria implements ArmazemIntegracoes {
  private readonly listaChaves: ChaveApi[] = [];
  private readonly usos: UsoApi[] = [];
  private readonly ganchos: Webhook[] = [];
  private readonly filaEntregas: Entrega[] = [];

  async criarChave(c: ChaveApi) {
    if (this.listaChaves.some((x) => x.prefixo === c.prefixo)) throw Object.assign(new Error('prefixo repetido'), { code: '23505' });
    this.listaChaves.push(copia(c));
  }
  async chavePorPrefixo(prefixo: string) {
    const c = this.listaChaves.find((x) => x.prefixo === prefixo);
    return c ? copia(c) : undefined;
  }
  async chaves(empresaId: string) {
    return this.listaChaves.filter((c) => c.empresaId === empresaId).sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime()).map(copia);
  }
  async chave(empresaId: string, id: string) {
    const c = this.listaChaves.find((x) => x.empresaId === empresaId && x.id === id);
    return c ? copia(c) : undefined;
  }
  async revogarChave(empresaId: string, id: string, em: Date) {
    const c = this.listaChaves.find((x) => x.empresaId === empresaId && x.id === id && !x.revogadaEm);
    if (!c) return false;
    c.revogadaEm = em;
    return true;
  }
  async marcarUsoChave(id: string, em: Date, ip: string | null) {
    const c = this.listaChaves.find((x) => x.id === id);
    if (c) Object.assign(c, { ultimoUsoEm: em, ultimoIp: ip });
  }
  async registrarUso(lista: UsoApi[]) {
    this.usos.push(...lista.map(copia));
    if (this.usos.length > 20_000) this.usos.splice(0, this.usos.length - 20_000);
  }
  async usoDaChave(empresaId: string, chaveId: string, limite: number) {
    return this.usos.filter((u) => u.empresaId === empresaId && u.chaveId === chaveId).sort((a, b) => b.em.getTime() - a.em.getTime()).slice(0, limite).map(copia);
  }
  async resumoUso(empresaId: string, desde: Date) {
    const r = new Map<string, { total: number; erros: number }>();
    for (const u of this.usos) {
      if (u.empresaId !== empresaId || u.em < desde) continue;
      const x = r.get(u.chaveId) ?? { total: 0, erros: 0 };
      x.total++;
      if (u.status >= 400) x.erros++;
      r.set(u.chaveId, x);
    }
    return r;
  }

  async criarWebhook(w: Webhook) {
    this.ganchos.push(copia(w));
  }
  async webhooks(empresaId: string) {
    return this.ganchos.filter((w) => w.empresaId === empresaId).sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime()).map(copia);
  }
  async webhook(empresaId: string, id: string) {
    const w = this.ganchos.find((x) => x.empresaId === empresaId && x.id === id);
    return w ? copia(w) : undefined;
  }
  async webhooksAtivos() {
    return this.ganchos.filter((w) => w.ativo).map(copia);
  }
  async atualizarWebhook(empresaId: string, id: string, campos: CamposWebhook, em: Date) {
    const w = this.ganchos.find((x) => x.empresaId === empresaId && x.id === id);
    if (!w) return false;
    Object.assign(w, copia(campos), { atualizadoEm: em });
    return true;
  }
  async apagarWebhook(empresaId: string, id: string) {
    const i = this.ganchos.findIndex((x) => x.empresaId === empresaId && x.id === id);
    if (i < 0) return false;
    this.ganchos.splice(i, 1);
    for (let j = this.filaEntregas.length - 1; j >= 0; j--) if (this.filaEntregas[j]!.webhookId === id) this.filaEntregas.splice(j, 1);
    return true;
  }
  async resultadoWebhook(id: string, sucesso: boolean, em: Date) {
    const w = this.ganchos.find((x) => x.id === id);
    if (!w) return 0;
    if (sucesso) Object.assign(w, { falhasSeguidas: 0, ultimoSucessoEm: em });
    else Object.assign(w, { falhasSeguidas: w.falhasSeguidas + 1, ultimaFalhaEm: em });
    return w.falhasSeguidas;
  }

  async enfileirar(lista: Entrega[]) {
    this.filaEntregas.push(...lista.map(copia));
  }
  async reivindicar(agora: Date, limite: number, reservaMs: number) {
    const t = agora.getTime();
    const vencidas = this.filaEntregas
      .filter((e) => e.status === 'pendente' && e.proximaEm && e.proximaEm.getTime() <= t && (!e.reservadaAte || e.reservadaAte.getTime() < t))
      .sort((a, b) => a.proximaEm!.getTime() - b.proximaEm!.getTime())
      .slice(0, limite);
    for (const e of vencidas) {
      e.reservadaAte = new Date(t + reservaMs);
      e.tentativas++;
    }
    return vencidas.map(copia);
  }
  async atualizarEntrega(id: string, campos: CamposEntrega, em: Date) {
    const e = this.filaEntregas.find((x) => x.id === id);
    if (e) Object.assign(e, copia(campos), { atualizadaEm: em });
  }
  async entrega(empresaId: string, id: string) {
    const e = this.filaEntregas.find((x) => x.empresaId === empresaId && x.id === id);
    return e ? copia(e) : undefined;
  }
  async entregas(empresaId: string, webhookId: string, limite: number, antes?: { em: Date; id: string }) {
    return this.filaEntregas
      .filter((e) => e.empresaId === empresaId && e.webhookId === webhookId)
      .sort(cmpEntrega)
      .filter((e) => !antes || e.criadaEm.getTime() < antes.em.getTime() || (e.criadaEm.getTime() === antes.em.getTime() && e.id < antes.id))
      .slice(0, limite)
      .map(copia);
  }
  async cancelarPendentes(webhookId: string, motivo: string, em: Date) {
    let n = 0;
    for (const e of this.filaEntregas) {
      if (e.webhookId !== webhookId || e.status !== 'pendente') continue;
      Object.assign(e, { status: 'cancelada', ultimoErro: motivo, proximaEm: null, atualizadaEm: em });
      n++;
    }
    return n;
  }
  async contagem(empresaId: string, webhookId: string, desde: Date) {
    const r: Record<StatusEntrega, number> = { pendente: 0, entregue: 0, falhou: 0, cancelada: 0 };
    for (const e of this.filaEntregas) if (e.empresaId === empresaId && e.webhookId === webhookId && e.criadaEm >= desde) r[e.status]++;
    return r;
  }
  async limpar(antesDe: Date) {
    for (let i = this.filaEntregas.length - 1; i >= 0; i--) if (this.filaEntregas[i]!.criadaEm < antesDe && this.filaEntregas[i]!.status !== 'pendente') this.filaEntregas.splice(i, 1);
    for (let i = this.usos.length - 1; i >= 0; i--) if (this.usos[i]!.em < antesDe) this.usos.splice(i, 1);
  }
}

// ------------------------------------------------------------------ Postgres

const data = (v: unknown) => (v ? new Date(v as string) : null);
const linhaChave = (r: Record<string, unknown>): ChaveApi => ({
  id: String(r.id),
  empresaId: String(r.empresa_id),
  nome: String(r.nome),
  prefixo: String(r.prefixo),
  hash: String(r.hash),
  escopos: (r.escopos as string[]) ?? [],
  limiteMinuto: Number(r.limite_minuto),
  criadaPor: (r.criada_por as string) ?? null,
  criadaPorNome: (r.criada_por_nome as string) ?? null,
  criadaEm: new Date(r.criada_em as string),
  expiraEm: data(r.expira_em),
  ultimoUsoEm: data(r.ultimo_uso_em),
  ultimoIp: (r.ultimo_ip as string) ?? null,
  revogadaEm: data(r.revogada_em),
});
const linhaUso = (r: Record<string, unknown>): UsoApi => ({
  chaveId: String(r.chave_id),
  empresaId: String(r.empresa_id),
  origem: r.origem === 'mcp' ? 'mcp' : 'api',
  metodo: String(r.metodo),
  rota: String(r.rota),
  status: Number(r.status),
  duracaoMs: Number(r.duracao_ms),
  ip: (r.ip as string) ?? null,
  em: new Date(r.em as string),
});
const linhaWebhook = (r: Record<string, unknown>): Webhook => ({
  id: String(r.id),
  empresaId: String(r.empresa_id),
  nome: String(r.nome),
  url: String(r.url),
  eventos: (r.eventos as string[]) ?? [],
  segredoCifrado: String(r.segredo_cifrado),
  ativo: Boolean(r.ativo),
  desligadoMotivo: (r.desligado_motivo as string) ?? null,
  desligadoEm: data(r.desligado_em),
  falhasSeguidas: Number(r.falhas_seguidas),
  ultimoSucessoEm: data(r.ultimo_sucesso_em),
  ultimaFalhaEm: data(r.ultima_falha_em),
  criadoPor: (r.criado_por as string) ?? null,
  criadoEm: new Date(r.criado_em as string),
  atualizadoEm: new Date(r.atualizado_em as string),
});
const linhaEntrega = (r: Record<string, unknown>): Entrega => ({
  id: String(r.id),
  webhookId: String(r.webhook_id),
  empresaId: String(r.empresa_id),
  evento: String(r.evento),
  eventoId: String(r.evento_id),
  corpo: (r.corpo as Record<string, unknown>) ?? {},
  status: r.status as StatusEntrega,
  tentativas: Number(r.tentativas),
  proximaEm: data(r.proxima_em),
  reservadaAte: data(r.reservada_ate),
  ultimoHttp: r.ultimo_http === null || r.ultimo_http === undefined ? null : Number(r.ultimo_http),
  ultimaResposta: (r.ultima_resposta as string) ?? null,
  ultimoErro: (r.ultimo_erro as string) ?? null,
  duracaoMs: r.duracao_ms === null || r.duracao_ms === undefined ? null : Number(r.duracao_ms),
  teste: Boolean(r.teste),
  criadaEm: new Date(r.criada_em as string),
  entregueEm: data(r.entregue_em),
  atualizadaEm: new Date(r.atualizada_em as string),
});

const COLUNAS_WEBHOOK: Record<keyof CamposWebhook, string> = {
  nome: 'nome', url: 'url', eventos: 'eventos', segredoCifrado: 'segredo_cifrado', ativo: 'ativo',
  desligadoMotivo: 'desligado_motivo', desligadoEm: 'desligado_em', falhasSeguidas: 'falhas_seguidas',
};
const COLUNAS_ENTREGA: Record<keyof CamposEntrega, string> = {
  status: 'status', proximaEm: 'proxima_em', reservadaAte: 'reservada_ate', ultimoHttp: 'ultimo_http',
  ultimaResposta: 'ultima_resposta', ultimoErro: 'ultimo_erro', duracaoMs: 'duracao_ms', entregueEm: 'entregue_em',
};

/** "set a=$3, b=$4" com as colunas permitidas (nunca vindas de fora). */
function montarSet<T extends object>(campos: T, colunas: Record<string, string>, inicio: number): { sql: string; valores: unknown[] } {
  const partes: string[] = [];
  const valores: unknown[] = [];
  for (const [k, v] of Object.entries(campos)) {
    const col = colunas[k];
    if (!col || v === undefined) continue;
    valores.push(v);
    partes.push(`${col} = $${inicio + valores.length - 1}`);
  }
  return { sql: partes.join(', '), valores };
}

export class ArmazemIntegracoesPostgres implements ArmazemIntegracoes {
  constructor(private readonly pool: pg.Pool) {}

  async criarChave(c: ChaveApi) {
    await this.pool.query(
      `insert into sintonia.api_chaves (id, empresa_id, nome, prefixo, hash, escopos, limite_minuto, criada_por, criada_por_nome, criada_em, expira_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.id, c.empresaId, c.nome, c.prefixo, c.hash, c.escopos, c.limiteMinuto, c.criadaPor, c.criadaPorNome, c.criadaEm, c.expiraEm],
    );
  }
  async chavePorPrefixo(prefixo: string) {
    const { rows } = await this.pool.query('select * from sintonia.api_chaves where prefixo = $1', [prefixo]);
    return rows[0] ? linhaChave(rows[0]) : undefined;
  }
  async chaves(empresaId: string) {
    const { rows } = await this.pool.query('select * from sintonia.api_chaves where empresa_id = $1 order by criada_em desc', [empresaId]);
    return rows.map(linhaChave);
  }
  async chave(empresaId: string, id: string) {
    const { rows } = await this.pool.query('select * from sintonia.api_chaves where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0] ? linhaChave(rows[0]) : undefined;
  }
  async revogarChave(empresaId: string, id: string, em: Date, por: string) {
    const r = await this.pool.query('update sintonia.api_chaves set revogada_em = $3, revogada_por = $4 where empresa_id = $1 and id = $2 and revogada_em is null', [empresaId, id, em, por]);
    return (r.rowCount ?? 0) > 0;
  }
  async marcarUsoChave(id: string, em: Date, ip: string | null) {
    await this.pool.query('update sintonia.api_chaves set ultimo_uso_em = $2, ultimo_ip = $3 where id = $1', [id, em, ip]);
  }
  async registrarUso(lista: UsoApi[]) {
    if (!lista.length) return;
    const valores: unknown[] = [];
    const linhas = lista.map((u, i) => {
      valores.push(u.chaveId, u.empresaId, u.origem, u.metodo, u.rota.slice(0, 200), u.status, u.duracaoMs, u.ip, u.em);
      const b = i * 9;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
    });
    await this.pool.query(`insert into sintonia.api_uso (chave_id, empresa_id, origem, metodo, rota, status, duracao_ms, ip, em) values ${linhas.join(',')}`, valores);
  }
  async usoDaChave(empresaId: string, chaveId: string, limite: number) {
    const { rows } = await this.pool.query('select * from sintonia.api_uso where empresa_id = $1 and chave_id = $2 order by em desc, id desc limit $3', [empresaId, chaveId, limite]);
    return rows.map(linhaUso);
  }
  async resumoUso(empresaId: string, desde: Date) {
    const { rows } = await this.pool.query(
      'select chave_id, count(*)::int as total, count(*) filter (where status >= 400)::int as erros from sintonia.api_uso where empresa_id = $1 and em >= $2 group by chave_id',
      [empresaId, desde],
    );
    return new Map(rows.map((r) => [String(r.chave_id), { total: Number(r.total), erros: Number(r.erros) }]));
  }

  async criarWebhook(w: Webhook) {
    await this.pool.query(
      `insert into sintonia.webhooks (id, empresa_id, nome, url, eventos, segredo_cifrado, ativo, criado_por, criado_em, atualizado_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [w.id, w.empresaId, w.nome, w.url, w.eventos, w.segredoCifrado, w.ativo, w.criadoPor, w.criadoEm, w.atualizadoEm],
    );
  }
  async webhooks(empresaId: string) {
    const { rows } = await this.pool.query('select * from sintonia.webhooks where empresa_id = $1 order by criado_em', [empresaId]);
    return rows.map(linhaWebhook);
  }
  async webhook(empresaId: string, id: string) {
    const { rows } = await this.pool.query('select * from sintonia.webhooks where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0] ? linhaWebhook(rows[0]) : undefined;
  }
  async webhooksAtivos() {
    const { rows } = await this.pool.query('select * from sintonia.webhooks where ativo');
    return rows.map(linhaWebhook);
  }
  async atualizarWebhook(empresaId: string, id: string, campos: CamposWebhook, em: Date) {
    const s = montarSet(campos, COLUNAS_WEBHOOK, 4);
    const r = await this.pool.query(
      `update sintonia.webhooks set atualizado_em = $3${s.sql ? `, ${s.sql}` : ''} where empresa_id = $1 and id = $2`,
      [empresaId, id, em, ...s.valores],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async apagarWebhook(empresaId: string, id: string) {
    const r = await this.pool.query('delete from sintonia.webhooks where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async resultadoWebhook(id: string, sucesso: boolean, em: Date) {
    const { rows } = await this.pool.query(
      sucesso
        ? 'update sintonia.webhooks set falhas_seguidas = 0, ultimo_sucesso_em = $2 where id = $1 returning falhas_seguidas'
        : 'update sintonia.webhooks set falhas_seguidas = falhas_seguidas + 1, ultima_falha_em = $2 where id = $1 returning falhas_seguidas',
      [id, em],
    );
    return rows[0] ? Number(rows[0].falhas_seguidas) : 0;
  }

  async enfileirar(lista: Entrega[]) {
    for (const e of lista) {
      await this.pool.query(
        `insert into sintonia.webhook_entregas (id, webhook_id, empresa_id, evento, evento_id, corpo, status, tentativas, proxima_em, teste, criada_em, atualizada_em, reservada_ate)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)`,
        [e.id, e.webhookId, e.empresaId, e.evento, e.eventoId, JSON.stringify(e.corpo), e.status, e.tentativas, e.proximaEm, e.teste, e.criadaEm, e.reservadaAte],
      );
    }
  }
  async reivindicar(agora: Date, limite: number, reservaMs: number) {
    const { rows } = await this.pool.query(
      `update sintonia.webhook_entregas e set reservada_ate = $2, tentativas = e.tentativas + 1
        where e.id in (
          select id from sintonia.webhook_entregas
           where status = 'pendente' and proxima_em <= $1 and (reservada_ate is null or reservada_ate < $1)
           order by proxima_em limit $3 for update skip locked)
        returning e.*`,
      [agora, new Date(agora.getTime() + reservaMs), limite],
    );
    return rows.map(linhaEntrega);
  }
  async atualizarEntrega(id: string, campos: CamposEntrega, em: Date) {
    const s = montarSet(campos, COLUNAS_ENTREGA, 3);
    await this.pool.query(`update sintonia.webhook_entregas set atualizada_em = $2${s.sql ? `, ${s.sql}` : ''} where id = $1`, [id, em, ...s.valores]);
  }
  async entrega(empresaId: string, id: string) {
    const { rows } = await this.pool.query('select * from sintonia.webhook_entregas where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0] ? linhaEntrega(rows[0]) : undefined;
  }
  async entregas(empresaId: string, webhookId: string, limite: number, antes?: { em: Date; id: string }) {
    const { rows } = await this.pool.query(
      `select * from sintonia.webhook_entregas where empresa_id = $1 and webhook_id = $2
          and ($4::timestamptz is null or (criada_em, id) < ($4, $5::uuid))
        order by criada_em desc, id desc limit $3`,
      [empresaId, webhookId, limite, antes?.em ?? null, antes?.id ?? '00000000-0000-0000-0000-000000000000'],
    );
    return rows.map(linhaEntrega);
  }
  async cancelarPendentes(webhookId: string, motivo: string, em: Date) {
    const r = await this.pool.query(
      `update sintonia.webhook_entregas set status = 'cancelada', ultimo_erro = $2, proxima_em = null, atualizada_em = $3 where webhook_id = $1 and status = 'pendente'`,
      [webhookId, motivo, em],
    );
    return r.rowCount ?? 0;
  }
  async contagem(empresaId: string, webhookId: string, desde: Date) {
    const { rows } = await this.pool.query(
      'select status, count(*)::int as n from sintonia.webhook_entregas where empresa_id = $1 and webhook_id = $2 and criada_em >= $3 group by status',
      [empresaId, webhookId, desde],
    );
    const r: Record<StatusEntrega, number> = { pendente: 0, entregue: 0, falhou: 0, cancelada: 0 };
    for (const x of rows) r[x.status as StatusEntrega] = Number(x.n);
    return r;
  }
  async limpar(antesDe: Date) {
    await this.pool.query(`delete from sintonia.webhook_entregas where criada_em < $1 and status <> 'pendente'`, [antesDe]);
    await this.pool.query('delete from sintonia.api_uso where em < $1', [antesDe]);
  }
}
