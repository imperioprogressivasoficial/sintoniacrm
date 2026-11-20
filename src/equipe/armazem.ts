import type pg from 'pg';

/**
 * Onde ficam as conversas de equipe (chat interno): salas, quem participa e as mensagens.
 * db/migrations/420_equipe_chat.sql. A memória serve para os testes e para rodar sem banco.
 */

export type TipoSala = 'direta' | 'grupo';

export interface Sala {
  id: string;
  empresaId: string;
  tipo: TipoSala;
  nome?: string;
  geral: boolean;
  chave?: string;
  criadaPor?: string;
  criadaEm: Date;
  ultimaEm: Date;
}

export interface Membro {
  salaId: string;
  usuarioId: string;
  /** Número (seq) da última mensagem que a pessoa leu. */
  lidaSeq: number;
  entrouEm: Date;
}

export interface MensagemEquipe {
  /** Ordem de chegada (cresce sempre): serve para "não lidas" e para buscar só as novas. */
  seq: number;
  id: string;
  salaId: string;
  empresaId: string;
  autorId: string;
  autorNome: string;
  texto: string;
  respostaA?: string;
  conversaId?: string;
  em: Date;
}

export type NovaMensagem = Omit<MensagemEquipe, 'seq'>;

export interface ArmazemEquipe {
  /** Cria a sala com os membros. Se já existe uma com a mesma chave na empresa, devolve a que existe. */
  criarSala(s: Sala, membros: string[]): Promise<Sala>;
  sala(id: string): Promise<Sala | undefined>;
  salaPorChave(empresaId: string, chave: string): Promise<Sala | undefined>;
  /** Salas da empresa de que a pessoa participa. */
  salasDe(empresaId: string, usuarioId: string): Promise<Sala[]>;
  membros(salaIds: string[]): Promise<Membro[]>;
  /** Põe pessoas na sala (quem já está fica como está). Entram com tudo o que já existe marcado como lido. */
  adicionarMembros(salaId: string, usuarioIds: string[], em: Date): Promise<void>;
  removerMembro(salaId: string, usuarioId: string): Promise<void>;
  renomear(salaId: string, nome: string): Promise<void>;
  gravar(m: NovaMensagem): Promise<MensagemEquipe>;
  mensagem(id: string): Promise<MensagemEquipe | undefined>;
  /** Mensagens da sala em ordem de chegada: as mais novas (limite), as depois de um seq ou as antes de um seq. */
  mensagens(salaId: string, o: { depois?: number; antes?: number; limite: number }): Promise<MensagemEquipe[]>;
  /** Última mensagem de cada sala. */
  ultimas(salaIds: string[]): Promise<Map<string, MensagemEquipe>>;
  /** Não lidas da pessoa em cada sala (mensagens de outras pessoas depois da última que ela leu). */
  naoLidas(usuarioId: string, salaIds: string[]): Promise<Map<string, number>>;
  /** Marca como lida até a última mensagem da sala (ou até o seq dado). Nunca volta atrás. */
  marcarLida(salaId: string, usuarioId: string, ateSeq?: number): Promise<number>;
}

export class ArmazemEquipeMemoria implements ArmazemEquipe {
  salas = new Map<string, Sala>();
  membrosDe = new Map<string, Map<string, Membro>>();
  msgs: MensagemEquipe[] = [];
  private seq = 0;

  private maxSeq(salaId: string) {
    let m = 0;
    for (const x of this.msgs) if (x.salaId === salaId && x.seq > m) m = x.seq;
    return m;
  }
  async criarSala(s: Sala, membros: string[]) {
    if (s.chave) {
      const ja = await this.salaPorChave(s.empresaId, s.chave);
      if (ja) return ja;
    }
    this.salas.set(s.id, { ...s });
    this.membrosDe.set(s.id, new Map());
    await this.adicionarMembros(s.id, membros, s.criadaEm);
    return { ...s };
  }
  async sala(id: string) {
    const s = this.salas.get(id);
    return s ? { ...s } : undefined;
  }
  async salaPorChave(empresaId: string, chave: string) {
    for (const s of this.salas.values()) if (s.empresaId === empresaId && s.chave === chave) return { ...s };
    return undefined;
  }
  async salasDe(empresaId: string, usuarioId: string) {
    return [...this.salas.values()].filter((s) => s.empresaId === empresaId && this.membrosDe.get(s.id)?.has(usuarioId)).map((s) => ({ ...s }));
  }
  async membros(salaIds: string[]) {
    return salaIds.flatMap((id) => [...(this.membrosDe.get(id)?.values() ?? [])].map((m) => ({ ...m })));
  }
  async adicionarMembros(salaId: string, usuarioIds: string[], em: Date) {
    const m = this.membrosDe.get(salaId);
    if (!m) return;
    const lida = this.maxSeq(salaId);
    for (const u of usuarioIds) if (!m.has(u)) m.set(u, { salaId, usuarioId: u, lidaSeq: lida, entrouEm: em });
  }
  async removerMembro(salaId: string, usuarioId: string) {
    this.membrosDe.get(salaId)?.delete(usuarioId);
  }
  async renomear(salaId: string, nome: string) {
    const s = this.salas.get(salaId);
    if (s) s.nome = nome;
  }
  async gravar(m: NovaMensagem) {
    const nova = { ...m, seq: ++this.seq };
    this.msgs.push(nova);
    const s = this.salas.get(m.salaId);
    if (s) s.ultimaEm = m.em;
    return { ...nova };
  }
  async mensagem(id: string) {
    const m = this.msgs.find((x) => x.id === id);
    return m ? { ...m } : undefined;
  }
  async mensagens(salaId: string, o: { depois?: number; antes?: number; limite: number }) {
    let l = this.msgs.filter((x) => x.salaId === salaId);
    if (o.depois !== undefined) return l.filter((x) => x.seq > o.depois!).slice(0, o.limite).map((x) => ({ ...x }));
    if (o.antes !== undefined) l = l.filter((x) => x.seq < o.antes!);
    return l.slice(-o.limite).map((x) => ({ ...x }));
  }
  async ultimas(salaIds: string[]) {
    const r = new Map<string, MensagemEquipe>();
    for (const m of this.msgs) if (salaIds.includes(m.salaId)) r.set(m.salaId, { ...m });
    return r;
  }
  async naoLidas(usuarioId: string, salaIds: string[]) {
    const r = new Map<string, number>();
    for (const id of salaIds) {
      const eu = this.membrosDe.get(id)?.get(usuarioId);
      if (!eu) continue;
      r.set(id, this.msgs.filter((m) => m.salaId === id && m.seq > eu.lidaSeq && m.autorId !== usuarioId).length);
    }
    return r;
  }
  async marcarLida(salaId: string, usuarioId: string, ateSeq?: number) {
    const eu = this.membrosDe.get(salaId)?.get(usuarioId);
    if (!eu) return 0;
    const alvo = Math.min(ateSeq ?? Infinity, this.maxSeq(salaId));
    if (alvo > eu.lidaSeq) eu.lidaSeq = alvo;
    return eu.lidaSeq;
  }
}

interface LinhaSala {
  id: string;
  empresa_id: string;
  tipo: TipoSala;
  nome: string | null;
  geral: boolean;
  chave: string | null;
  criada_por: string | null;
  criada_em: Date;
  ultima_em: Date;
}
interface LinhaMsg {
  seq: string;
  id: string;
  sala_id: string;
  empresa_id: string;
  autor_id: string;
  autor_nome: string;
  texto: string;
  resposta_a: string | null;
  conversa_id: string | null;
  em: Date;
}
const sala = (r: LinhaSala): Sala => ({
  id: r.id,
  empresaId: r.empresa_id,
  tipo: r.tipo,
  ...(r.nome ? { nome: r.nome } : {}),
  geral: r.geral,
  ...(r.chave ? { chave: r.chave } : {}),
  ...(r.criada_por ? { criadaPor: r.criada_por } : {}),
  criadaEm: r.criada_em,
  ultimaEm: r.ultima_em,
});
const msg = (r: LinhaMsg): MensagemEquipe => ({
  seq: Number(r.seq),
  id: r.id,
  salaId: r.sala_id,
  empresaId: r.empresa_id,
  autorId: r.autor_id,
  autorNome: r.autor_nome,
  texto: r.texto,
  ...(r.resposta_a ? { respostaA: r.resposta_a } : {}),
  ...(r.conversa_id ? { conversaId: r.conversa_id } : {}),
  em: r.em,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS_MSG = 'seq, id, sala_id, empresa_id, autor_id, autor_nome, texto, resposta_a, conversa_id, em';

export class ArmazemEquipePostgres implements ArmazemEquipe {
  constructor(private readonly pool: pg.Pool) {}

  async criarSala(s: Sala, membros: string[]) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const { rows } = await c.query<LinhaSala>(
        `insert into sintonia.equipe_salas (id, empresa_id, tipo, nome, geral, chave, criada_por, criada_em, ultima_em)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (empresa_id, chave) where chave is not null do nothing
         returning *`,
        [s.id, s.empresaId, s.tipo, s.nome ?? null, s.geral, s.chave ?? null, s.criadaPor ?? null, s.criadaEm, s.ultimaEm],
      );
      if (!rows[0]) {
        await c.query('rollback');
        return (await this.salaPorChave(s.empresaId, s.chave!))!;
      }
      if (membros.length)
        await c.query(
          `insert into sintonia.equipe_membros (sala_id, usuario_id, lida_seq, entrou_em)
           select $1, u, 0, $3 from unnest($2::text[]) u on conflict do nothing`,
          [s.id, [...new Set(membros)], s.criadaEm],
        );
      await c.query('commit');
      return sala(rows[0]);
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async sala(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaSala>('select * from sintonia.equipe_salas where id = $1', [id]);
    return rows[0] ? sala(rows[0]) : undefined;
  }
  async salaPorChave(empresaId: string, chave: string) {
    const { rows } = await this.pool.query<LinhaSala>('select * from sintonia.equipe_salas where empresa_id = $1 and chave = $2', [empresaId, chave]);
    return rows[0] ? sala(rows[0]) : undefined;
  }
  async salasDe(empresaId: string, usuarioId: string) {
    const { rows } = await this.pool.query<LinhaSala>(
      `select s.* from sintonia.equipe_salas s join sintonia.equipe_membros m on m.sala_id = s.id
       where s.empresa_id = $1 and m.usuario_id = $2`,
      [empresaId, usuarioId],
    );
    return rows.map(sala);
  }
  async membros(salaIds: string[]) {
    if (!salaIds.length) return [];
    const { rows } = await this.pool.query<{ sala_id: string; usuario_id: string; lida_seq: string; entrou_em: Date }>(
      'select sala_id, usuario_id, lida_seq, entrou_em from sintonia.equipe_membros where sala_id = any($1::uuid[])',
      [salaIds],
    );
    return rows.map((r) => ({ salaId: r.sala_id, usuarioId: r.usuario_id, lidaSeq: Number(r.lida_seq), entrouEm: r.entrou_em }));
  }
  async adicionarMembros(salaId: string, usuarioIds: string[], em: Date) {
    if (!usuarioIds.length) return;
    await this.pool.query(
      `insert into sintonia.equipe_membros (sala_id, usuario_id, lida_seq, entrou_em)
       select $1, u, coalesce((select max(seq) from sintonia.equipe_mensagens where sala_id = $1), 0), $3
       from unnest($2::text[]) u on conflict do nothing`,
      [salaId, [...new Set(usuarioIds)], em],
    );
  }
  async removerMembro(salaId: string, usuarioId: string) {
    await this.pool.query('delete from sintonia.equipe_membros where sala_id = $1 and usuario_id = $2', [salaId, usuarioId]);
  }
  async renomear(salaId: string, nome: string) {
    await this.pool.query('update sintonia.equipe_salas set nome = $2 where id = $1', [salaId, nome]);
  }
  async gravar(m: NovaMensagem) {
    const { rows } = await this.pool.query<LinhaMsg>(
      `with nova as (
         insert into sintonia.equipe_mensagens (id, sala_id, empresa_id, autor_id, autor_nome, texto, resposta_a, conversa_id, em)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLS_MSG}
       ), sala as (update sintonia.equipe_salas set ultima_em = $9 where id = $2)
       select * from nova`,
      [m.id, m.salaId, m.empresaId, m.autorId, m.autorNome, m.texto, m.respostaA ?? null, m.conversaId ?? null, m.em],
    );
    return msg(rows[0]!);
  }
  async mensagem(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaMsg>(`select ${COLS_MSG} from sintonia.equipe_mensagens where id = $1`, [id]);
    return rows[0] ? msg(rows[0]) : undefined;
  }
  async mensagens(salaId: string, o: { depois?: number; antes?: number; limite: number }) {
    if (o.depois !== undefined) {
      const { rows } = await this.pool.query<LinhaMsg>(
        `select ${COLS_MSG} from sintonia.equipe_mensagens where sala_id = $1 and seq > $2 order by seq limit $3`,
        [salaId, o.depois, o.limite],
      );
      return rows.map(msg);
    }
    const { rows } = await this.pool.query<LinhaMsg>(
      `select ${COLS_MSG} from sintonia.equipe_mensagens where sala_id = $1 and ($2::bigint is null or seq < $2) order by seq desc limit $3`,
      [salaId, o.antes ?? null, o.limite],
    );
    return rows.map(msg).reverse();
  }
  async ultimas(salaIds: string[]) {
    if (!salaIds.length) return new Map();
    const { rows } = await this.pool.query<LinhaMsg>(
      `select distinct on (sala_id) ${COLS_MSG} from sintonia.equipe_mensagens where sala_id = any($1::uuid[]) order by sala_id, seq desc`,
      [salaIds],
    );
    return new Map(rows.map((r) => [r.sala_id, msg(r)]));
  }
  async naoLidas(usuarioId: string, salaIds: string[]) {
    if (!salaIds.length) return new Map();
    const { rows } = await this.pool.query<{ sala_id: string; n: string }>(
      `select m.sala_id, count(x.seq) as n
       from sintonia.equipe_membros m
       left join sintonia.equipe_mensagens x on x.sala_id = m.sala_id and x.seq > m.lida_seq and x.autor_id <> m.usuario_id
       where m.usuario_id = $1 and m.sala_id = any($2::uuid[])
       group by m.sala_id`,
      [usuarioId, salaIds],
    );
    return new Map(rows.map((r) => [r.sala_id, Number(r.n)]));
  }
  async marcarLida(salaId: string, usuarioId: string, ateSeq?: number) {
    const { rows } = await this.pool.query<{ lida_seq: string }>(
      `update sintonia.equipe_membros m
       set lida_seq = greatest(m.lida_seq, least(coalesce($3::bigint, 9223372036854775807), coalesce((select max(seq) from sintonia.equipe_mensagens where sala_id = $1), 0)))
       where m.sala_id = $1 and m.usuario_id = $2 returning lida_seq`,
      [salaId, usuarioId, ateSeq ?? null],
    );
    return rows[0] ? Number(rows[0].lida_seq) : 0;
  }
}
