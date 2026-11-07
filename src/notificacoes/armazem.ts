import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { InscricaoPush, Notificacao, NovaNotificacao, Preferencias } from './tipos.js';

/** Cursor da rolagem infinita: a última notificação já mostrada. */
export interface Cursor {
  em: Date;
  id: string;
}

export interface ArmazemNotificacoes {
  criar(n: NovaNotificacao): Promise<Notificacao>;
  /** Notificação não lida da mesma conversa (de um destes tipos), para juntar mensagens em rajada. */
  grupoAberto(usuarioId: string, conversaId: string, tipos: string[]): Promise<Notificacao | undefined>;
  /** Junta mais uma mensagem: novo texto, contador + `somar`, sobe para o topo. */
  somar(id: string, campos: { texto: string; em: Date; somar: number }): Promise<Notificacao | undefined>;
  /** Já existe notificação com esta chave para a pessoa (desde `desde`, se informado)? */
  existeChave(usuarioId: string, chave: string, desde?: Date): Promise<boolean>;
  /** Mais nova primeiro; só as que já valem (criada_em <= agora). */
  listar(usuarioId: string, agora: Date, limite: number, antes?: Cursor): Promise<Notificacao[]>;
  /** Não lidas e "versão" (última mudança, em ms) para o app saber quando buscar de novo. */
  resumo(usuarioId: string, agora: Date): Promise<{ naoLidas: number; versao: number }>;
  marcarLida(usuarioId: string, id: string, em: Date): Promise<boolean>;
  marcarTodas(usuarioId: string, em: Date): Promise<number>;
  marcarDaConversa(usuarioId: string, conversaId: string, em: Date): Promise<number>;
  /** Push que já venceu e ainda não saiu (lembretes marcados para depois). Já marca como entregue. */
  reivindicarEntregas(agora: Date, limite?: number): Promise<Notificacao[]>;
  marcarEntregue(id: string, em: Date): Promise<void>;

  preferencias(usuarioId: string): Promise<Partial<Preferencias> | undefined>;
  salvarPreferencias(usuarioId: string, p: Preferencias): Promise<void>;

  inscricoes(usuarioId: string): Promise<InscricaoPush[]>;
  inscrever(i: InscricaoPush): Promise<void>;
  /** Com usuarioId, só remove se for dessa pessoa. */
  removerInscricao(endpoint: string, usuarioId?: string): Promise<boolean>;
  usouInscricao(endpoint: string, em: Date): Promise<void>;

  /** Configuração do push (chaves VAPID). */
  config(chave: string): Promise<string | undefined>;
  /** Grava só se ainda não existe e devolve o que ficou guardado (dois processos nunca geram chaves diferentes). */
  gravarConfigSeNova(chave: string, valor: string): Promise<string>;
}

const copia = (n: Notificacao): Notificacao => ({ ...n });
const depoisDe = (n: Notificacao, c: Cursor) =>
  n.atualizadaEm.getTime() < c.em.getTime() || (n.atualizadaEm.getTime() === c.em.getTime() && n.id < c.id);

export class ArmazemNotificacoesMemoria implements ArmazemNotificacoes {
  itens: Notificacao[] = [];
  prefs = new Map<string, Preferencias>();
  push = new Map<string, InscricaoPush>();
  cfg = new Map<string, string>();

  async criar(n: NovaNotificacao) {
    const nova: Notificacao = { ...n, id: randomUUID(), contador: n.contador ?? 1, atualizadaEm: n.criadaEm };
    this.itens.push(nova);
    return copia(nova);
  }
  async grupoAberto(usuarioId: string, conversaId: string, tipos: string[]) {
    const n = this.itens
      .filter((x) => x.usuarioId === usuarioId && x.conversaId === conversaId && !x.lidaEm && tipos.includes(x.tipo))
      .sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime())[0];
    return n && copia(n);
  }
  async somar(id: string, c: { texto: string; em: Date; somar: number }) {
    const n = this.itens.find((x) => x.id === id);
    if (!n) return undefined;
    Object.assign(n, { texto: c.texto, contador: n.contador + c.somar, atualizadaEm: c.em });
    return copia(n);
  }
  async existeChave(usuarioId: string, chave: string, desde?: Date) {
    return this.itens.some((x) => x.usuarioId === usuarioId && x.chave === chave && (!desde || x.criadaEm.getTime() >= desde.getTime()));
  }
  async listar(usuarioId: string, agora: Date, limite: number, antes?: Cursor) {
    return this.itens
      .filter((x) => x.usuarioId === usuarioId && x.criadaEm.getTime() <= agora.getTime() && (!antes || depoisDe(x, antes)))
      .sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, limite)
      .map(copia);
  }
  async resumo(usuarioId: string, agora: Date) {
    const minhas = this.itens.filter((x) => x.usuarioId === usuarioId && x.criadaEm.getTime() <= agora.getTime());
    return {
      naoLidas: minhas.filter((x) => !x.lidaEm).length,
      versao: Math.max(0, ...minhas.map((x) => Math.max(x.atualizadaEm.getTime(), x.lidaEm?.getTime() ?? 0))),
    };
  }
  async marcarLida(usuarioId: string, id: string, em: Date) {
    const n = this.itens.find((x) => x.id === id && x.usuarioId === usuarioId);
    if (!n) return false;
    n.lidaEm ??= em;
    return true;
  }
  async marcarTodas(usuarioId: string, em: Date) {
    let k = 0;
    for (const n of this.itens) if (n.usuarioId === usuarioId && !n.lidaEm && n.criadaEm.getTime() <= em.getTime()) (n.lidaEm = em), k++;
    return k;
  }
  async marcarDaConversa(usuarioId: string, conversaId: string, em: Date) {
    let k = 0;
    for (const n of this.itens) if (n.usuarioId === usuarioId && n.conversaId === conversaId && !n.lidaEm && n.criadaEm.getTime() <= em.getTime()) (n.lidaEm = em), k++;
    return k;
  }
  async reivindicarEntregas(agora: Date, limite = 50) {
    const lista = this.itens.filter((x) => !x.entregueEm && x.criadaEm.getTime() <= agora.getTime()).slice(0, limite);
    for (const n of lista) n.entregueEm = agora;
    return lista.map(copia);
  }
  async marcarEntregue(id: string, em: Date) {
    const n = this.itens.find((x) => x.id === id);
    if (n) n.entregueEm = em;
  }
  async preferencias(usuarioId: string) {
    const p = this.prefs.get(usuarioId);
    return p && structuredClone(p);
  }
  async salvarPreferencias(usuarioId: string, p: Preferencias) {
    this.prefs.set(usuarioId, structuredClone(p));
  }
  async inscricoes(usuarioId: string) {
    return [...this.push.values()].filter((i) => i.usuarioId === usuarioId).map((i) => ({ ...i }));
  }
  async inscrever(i: InscricaoPush) {
    this.push.set(i.endpoint, { ...i });
  }
  async removerInscricao(endpoint: string, usuarioId?: string) {
    const i = this.push.get(endpoint);
    if (!i || (usuarioId && i.usuarioId !== usuarioId)) return false;
    return this.push.delete(endpoint);
  }
  async usouInscricao() {}
  async config(chave: string) {
    return this.cfg.get(chave);
  }
  async gravarConfigSeNova(chave: string, valor: string) {
    if (!this.cfg.has(chave)) this.cfg.set(chave, valor);
    return this.cfg.get(chave)!;
  }
}

interface Linha {
  id: string;
  usuario_id: string;
  tipo: string;
  titulo: string;
  texto: string;
  conversa_id: string | null;
  vista: string | null;
  contador: number;
  chave: string | null;
  criada_em: Date;
  atualizada_em: Date;
  lida_em: Date | null;
  entregue_em: Date | null;
}
const daLinha = (r: Linha): Notificacao => ({
  id: r.id,
  usuarioId: r.usuario_id,
  tipo: r.tipo as Notificacao['tipo'],
  titulo: r.titulo,
  texto: r.texto,
  contador: r.contador,
  criadaEm: r.criada_em,
  atualizadaEm: r.atualizada_em,
  ...(r.conversa_id ? { conversaId: r.conversa_id } : {}),
  ...(r.vista ? { vista: r.vista } : {}),
  ...(r.chave ? { chave: r.chave } : {}),
  ...(r.lida_em ? { lidaEm: r.lida_em } : {}),
  ...(r.entregue_em ? { entregueEm: r.entregue_em } : {}),
});

const T = 'sintonia.notificacoes';

export class ArmazemNotificacoesPostgres implements ArmazemNotificacoes {
  constructor(private readonly pool: pg.Pool) {}

  async criar(n: NovaNotificacao) {
    const { rows } = await this.pool.query<Linha>(
      `insert into ${T} (id, usuario_id, tipo, titulo, texto, conversa_id, vista, contador, chave, criada_em, atualizada_em, entregue_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11) returning *`,
      [randomUUID(), n.usuarioId, n.tipo, n.titulo, n.texto, n.conversaId ?? null, n.vista ?? null, n.contador ?? 1, n.chave ?? null, n.criadaEm, n.entregueEm ?? null],
    );
    return daLinha(rows[0]!);
  }
  async grupoAberto(usuarioId: string, conversaId: string, tipos: string[]) {
    const { rows } = await this.pool.query<Linha>(
      `select * from ${T} where usuario_id = $1 and conversa_id = $2 and tipo = any($3) and lida_em is null order by atualizada_em desc limit 1`,
      [usuarioId, conversaId, tipos],
    );
    return rows[0] && daLinha(rows[0]);
  }
  async somar(id: string, c: { texto: string; em: Date; somar: number }) {
    const { rows } = await this.pool.query<Linha>(
      `update ${T} set texto = $2, contador = contador + $3, atualizada_em = greatest(atualizada_em, $4) where id = $1 returning *`,
      [id, c.texto, c.somar, c.em],
    );
    return rows[0] && daLinha(rows[0]);
  }
  async existeChave(usuarioId: string, chave: string, desde?: Date) {
    const { rowCount } = await this.pool.query(
      `select 1 from ${T} where usuario_id = $1 and chave = $2 and ($3::timestamptz is null or criada_em >= $3) limit 1`,
      [usuarioId, chave, desde ?? null],
    );
    return Boolean(rowCount);
  }
  async listar(usuarioId: string, agora: Date, limite: number, antes?: Cursor) {
    const { rows } = await this.pool.query<Linha>(
      `select * from ${T} where usuario_id = $1 and criada_em <= $2
         and ($3::timestamptz is null or (atualizada_em, id) < ($3, $4::uuid))
       order by atualizada_em desc, id desc limit $5`,
      [usuarioId, agora, antes?.em ?? null, antes?.id ?? '00000000-0000-0000-0000-000000000000', limite],
    );
    return rows.map(daLinha);
  }
  async resumo(usuarioId: string, agora: Date) {
    const { rows } = await this.pool.query<{ n: string; v: Date | null }>(
      `select count(*) filter (where lida_em is null) as n, max(greatest(atualizada_em, coalesce(lida_em, atualizada_em))) as v
         from ${T} where usuario_id = $1 and criada_em <= $2`,
      [usuarioId, agora],
    );
    return { naoLidas: Number(rows[0]?.n ?? 0), versao: rows[0]?.v?.getTime() ?? 0 };
  }
  async marcarLida(usuarioId: string, id: string, em: Date) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
    const { rowCount } = await this.pool.query(`update ${T} set lida_em = coalesce(lida_em, $3) where id = $1 and usuario_id = $2`, [id, usuarioId, em]);
    return Boolean(rowCount);
  }
  async marcarTodas(usuarioId: string, em: Date) {
    const { rowCount } = await this.pool.query(`update ${T} set lida_em = $2 where usuario_id = $1 and lida_em is null and criada_em <= $2`, [usuarioId, em]);
    return rowCount ?? 0;
  }
  async marcarDaConversa(usuarioId: string, conversaId: string, em: Date) {
    const { rowCount } = await this.pool.query(
      `update ${T} set lida_em = $3 where usuario_id = $1 and conversa_id = $2 and lida_em is null and criada_em <= $3`,
      [usuarioId, conversaId, em],
    );
    return rowCount ?? 0;
  }
  async reivindicarEntregas(agora: Date, limite = 50) {
    // skip locked: com vários processos, cada push sai uma vez só.
    const { rows } = await this.pool.query<Linha>(
      `update ${T} set entregue_em = $1 where id in (
         select id from ${T} where entregue_em is null and criada_em <= $1 order by criada_em limit $2 for update skip locked
       ) returning *`,
      [agora, limite],
    );
    return rows.map(daLinha);
  }
  async marcarEntregue(id: string, em: Date) {
    await this.pool.query(`update ${T} set entregue_em = $2 where id = $1`, [id, em]);
  }
  async preferencias(usuarioId: string) {
    const { rows } = await this.pool.query<{ dados: Partial<Preferencias> }>('select dados from sintonia.notificacao_preferencias where usuario_id = $1', [usuarioId]);
    return rows[0]?.dados;
  }
  async salvarPreferencias(usuarioId: string, p: Preferencias) {
    await this.pool.query(
      `insert into sintonia.notificacao_preferencias (usuario_id, dados, atualizada_em) values ($1, $2, now())
       on conflict (usuario_id) do update set dados = excluded.dados, atualizada_em = now()`,
      [usuarioId, JSON.stringify(p)],
    );
  }
  async inscricoes(usuarioId: string) {
    const { rows } = await this.pool.query<{ endpoint: string; usuario_id: string; p256dh: string; auth: string; agente: string | null }>(
      'select endpoint, usuario_id, p256dh, auth, agente from sintonia.push_inscricoes where usuario_id = $1',
      [usuarioId],
    );
    return rows.map((r) => ({ endpoint: r.endpoint, usuarioId: r.usuario_id, p256dh: r.p256dh, auth: r.auth, ...(r.agente ? { agente: r.agente } : {}) }));
  }
  async inscrever(i: InscricaoPush) {
    // O mesmo aparelho, se trocar de pessoa logada, passa a receber só a nova.
    await this.pool.query(
      `insert into sintonia.push_inscricoes (endpoint, usuario_id, p256dh, auth, agente) values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth, agente = excluded.agente`,
      [i.endpoint, i.usuarioId, i.p256dh, i.auth, i.agente ?? null],
    );
  }
  async removerInscricao(endpoint: string, usuarioId?: string) {
    const { rowCount } = await this.pool.query(
      'delete from sintonia.push_inscricoes where endpoint = $1 and ($2::uuid is null or usuario_id = $2)',
      [endpoint, usuarioId ?? null],
    );
    return Boolean(rowCount);
  }
  async usouInscricao(endpoint: string, em: Date) {
    await this.pool.query('update sintonia.push_inscricoes set usada_em = $2 where endpoint = $1', [endpoint, em]);
  }
  async config(chave: string) {
    const { rows } = await this.pool.query<{ valor: string }>('select valor from sintonia.push_config where chave = $1', [chave]);
    return rows[0]?.valor;
  }
  async gravarConfigSeNova(chave: string, valor: string) {
    await this.pool.query('insert into sintonia.push_config (chave, valor) values ($1, $2) on conflict (chave) do nothing', [chave, valor]);
    return (await this.config(chave))!;
  }
}
