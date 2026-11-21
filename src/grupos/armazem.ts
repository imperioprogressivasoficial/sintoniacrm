import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { TipoAnexo } from '../domain.js';

/**
 * Conversas de grupo (grupos do WhatsApp pela API não oficial): grupos, mensagens e até onde cada pessoa leu.
 * Tabelas próprias (db/migrations/410_grupos.sql): grupo nunca vira conversa de cliente.
 */

export interface Grupo {
  id: string;
  empresaId: string;
  canalId: string;
  unidade: string;
  jid: string;
  nome: string | null;
  participantes: number | null;
  temFoto: boolean;
  /** Endereço da foto guardada (a Evolution troca quando a foto muda). */
  fotoUrl: string | null;
  /** Quando nome e foto foram lidos da Evolution (null = ainda não). */
  infoEm: Date | null;
  ultimaEm: Date | null;
  /** Arquivado (como no WhatsApp): sai da lista principal e vai para "Arquivadas". */
  arquivado: boolean;
}

export interface AnexoGrupo {
  tipo: TipoAnexo;
  mimetype?: string;
  nomeArquivo?: string;
  duracaoSeg?: number;
  legenda?: string;
  tamanho?: number;
  voz?: boolean;
}

export interface MensagemGrupo {
  id: string;
  grupoId: string;
  idExterno: string;
  autor: 'equipe' | 'participante';
  participante: string | null;
  participanteJid: string | null;
  participanteNome: string | null;
  /** Equipe: quem enviou pela Sintonia, ou "celular da loja". */
  autorNome: string | null;
  usuarioId: string | null;
  texto: string;
  anexo: AnexoGrupo | null;
  /** O arquivo já está guardado aqui. */
  temMidia: boolean;
  historico: boolean;
  em: Date;
}

export type NovaMensagemGrupo = Omit<MensagemGrupo, 'id' | 'temMidia'>;

export interface ArmazemGrupos {
  /** Busca o grupo pelo número e jid; cria se não existir. */
  grupo(p: { empresaId: string; canalId: string; unidade: string; jid: string }): Promise<Grupo>;
  buscar(id: string): Promise<Grupo | undefined>;
  listar(empresaId: string): Promise<Grupo[]>;
  /** Última mensagem de cada grupo. */
  ultimas(grupoIds: string[]): Promise<Map<string, MensagemGrupo>>;
  /** Nome e quantas pessoas. `em` = quando foi lido da Evolution (null: só o nome, sem mexer no cache). */
  atualizarInfo(id: string, info: { nome?: string | null; participantes?: number | null }, em: Date | null): Promise<void>;
  guardarFoto(id: string, foto: { conteudo: Buffer; tipo: string } | null, url?: string | null): Promise<void>;
  arquivar(id: string, arquivado: boolean, em: Date): Promise<void>;
  foto(id: string): Promise<{ conteudo: Buffer; tipo: string } | undefined>;
  /**
   * Grava a mensagem (repetida pelo id externo é ignorada e devolve undefined).
   * `nossa`: envio da Sintonia; se o eco do webhook chegou antes, assume o nome de quem enviou.
   */
  adicionar(m: NovaMensagemGrupo, opcoes?: { nossa?: boolean }): Promise<MensagemGrupo | undefined>;
  /** Mais recentes primeiro na busca; devolve em ordem de tempo. `antes` pagina para trás. */
  mensagens(grupoId: string, limite: number, antes?: Date): Promise<MensagemGrupo[]>;
  mensagem(id: string): Promise<MensagemGrupo | undefined>;
  guardarMidia(mensagemId: string, conteudo: Buffer): Promise<void>;
  midia(mensagemId: string): Promise<Buffer | undefined>;
  lidas(usuarioId: string): Promise<Map<string, Date>>;
  marcarLida(usuarioId: string, grupoIds: string[], em: Date): Promise<void>;
  /** Mensagens de participantes (fora do histórico) depois do que a pessoa leu, por grupo. */
  naoLidas(usuarioId: string, grupoIds: string[]): Promise<Map<string, number>>;
}

const chaveGrupo = (empresaId: string, canalId: string, jid: string) => `${empresaId}|${canalId}|${jid}`;

export class ArmazemGruposMemoria implements ArmazemGrupos {
  private readonly grupos = new Map<string, Grupo>();
  private readonly fotos = new Map<string, { conteudo: Buffer; tipo: string }>();
  private readonly msgs: MensagemGrupo[] = [];
  private readonly midias = new Map<string, Buffer>();
  private readonly leituras = new Map<string, Map<string, Date>>();

  async grupo(p: { empresaId: string; canalId: string; unidade: string; jid: string }) {
    const k = chaveGrupo(p.empresaId, p.canalId, p.jid);
    let g = this.grupos.get(k);
    if (!g) {
      g = { id: randomUUID(), ...p, nome: null, participantes: null, temFoto: false, fotoUrl: null, infoEm: null, ultimaEm: null, arquivado: false };
      this.grupos.set(k, g);
    }
    return { ...g };
  }
  private porId(id: string) {
    return [...this.grupos.values()].find((g) => g.id === id);
  }
  async buscar(id: string) {
    const g = this.porId(id);
    return g ? { ...g } : undefined;
  }
  async listar(empresaId: string) {
    return [...this.grupos.values()]
      .filter((g) => g.empresaId === empresaId)
      .sort((a, b) => (b.ultimaEm?.getTime() ?? 0) - (a.ultimaEm?.getTime() ?? 0))
      .map((g) => ({ ...g }));
  }
  async ultimas(ids: string[]) {
    const r = new Map<string, MensagemGrupo>();
    for (const m of this.msgs) {
      if (!ids.includes(m.grupoId)) continue;
      const a = r.get(m.grupoId);
      if (!a || a.em <= m.em) r.set(m.grupoId, { ...m });
    }
    return r;
  }
  async atualizarInfo(id: string, info: { nome?: string | null; participantes?: number | null }, em: Date | null) {
    const g = this.porId(id);
    if (!g) return;
    if (info.nome !== undefined && info.nome !== null) g.nome = info.nome;
    if (info.participantes !== undefined && info.participantes !== null) g.participantes = info.participantes;
    if (em) g.infoEm = em;
  }
  async guardarFoto(id: string, foto: { conteudo: Buffer; tipo: string } | null, url?: string | null) {
    const g = this.porId(id);
    if (!g) return;
    if (foto) this.fotos.set(id, foto);
    else this.fotos.delete(id);
    g.temFoto = Boolean(foto);
    g.fotoUrl = foto ? (url ?? null) : null;
  }
  async arquivar(id: string, arquivado: boolean) {
    const g = this.porId(id);
    if (g) g.arquivado = arquivado;
  }
  async foto(id: string) {
    return this.fotos.get(id);
  }
  async adicionar(m: NovaMensagemGrupo, opcoes: { nossa?: boolean } = {}) {
    const ja = this.msgs.find((x) => x.grupoId === m.grupoId && x.idExterno === m.idExterno);
    if (ja) {
      if (opcoes.nossa) Object.assign(ja, { autor: 'equipe', autorNome: m.autorNome, usuarioId: m.usuarioId });
      return undefined;
    }
    const nova: MensagemGrupo = { ...m, id: randomUUID(), temMidia: false };
    this.msgs.push(nova);
    const g = this.porId(m.grupoId);
    if (g && (!g.ultimaEm || g.ultimaEm < m.em)) g.ultimaEm = m.em;
    return { ...nova };
  }
  async mensagens(grupoId: string, limite: number, antes?: Date) {
    return this.msgs
      .filter((m) => m.grupoId === grupoId && (!antes || m.em < antes))
      .sort((a, b) => a.em.getTime() - b.em.getTime())
      .slice(-limite)
      .map((m) => ({ ...m }));
  }
  async mensagem(id: string) {
    const m = this.msgs.find((x) => x.id === id);
    return m ? { ...m } : undefined;
  }
  async guardarMidia(mensagemId: string, conteudo: Buffer) {
    this.midias.set(mensagemId, conteudo);
    const m = this.msgs.find((x) => x.id === mensagemId);
    if (m) m.temMidia = true;
  }
  async midia(mensagemId: string) {
    return this.midias.get(mensagemId);
  }
  async lidas(u: string) {
    return new Map(this.leituras.get(u) ?? []);
  }
  async marcarLida(u: string, ids: string[], em: Date) {
    const m = this.leituras.get(u) ?? new Map<string, Date>();
    for (const id of ids) if (!m.has(id) || m.get(id)! < em) m.set(id, em);
    this.leituras.set(u, m);
  }
  async naoLidas(u: string, ids: string[]) {
    const lidas = this.leituras.get(u) ?? new Map<string, Date>();
    const r = new Map<string, number>();
    for (const m of this.msgs) {
      if (!ids.includes(m.grupoId) || m.autor !== 'participante' || m.historico) continue;
      const ate = lidas.get(m.grupoId);
      if (ate && m.em <= ate) continue;
      r.set(m.grupoId, (r.get(m.grupoId) ?? 0) + 1);
    }
    return r;
  }
}

interface LinhaGrupo {
  id: string;
  empresa_id: string;
  canal_id: string;
  unidade: string;
  jid: string;
  nome: string | null;
  participantes: number | null;
  tem_foto: boolean;
  foto_url: string | null;
  info_em: Date | null;
  ultima_em: Date | null;
  arquivado: boolean;
}
const COLUNAS_GRUPO = 'id, empresa_id, canal_id, unidade, jid, nome, participantes, foto is not null as tem_foto, foto_url, info_em, ultima_em, arquivado';
const doGrupo = (r: LinhaGrupo): Grupo => ({
  id: r.id,
  empresaId: r.empresa_id,
  canalId: r.canal_id,
  unidade: r.unidade,
  jid: r.jid,
  nome: r.nome,
  participantes: r.participantes,
  temFoto: r.tem_foto,
  fotoUrl: r.foto_url,
  infoEm: r.info_em,
  ultimaEm: r.ultima_em,
  arquivado: r.arquivado,
});

interface LinhaMensagem {
  id: string;
  grupo_id: string;
  id_externo: string;
  autor: 'equipe' | 'participante';
  participante: string | null;
  participante_jid: string | null;
  participante_nome: string | null;
  autor_nome: string | null;
  usuario_id: string | null;
  texto: string;
  anexo: AnexoGrupo | null;
  tem_midia: boolean;
  historico: boolean;
  em: Date;
}
const COLUNAS_MSG =
  'id, grupo_id, id_externo, autor, participante, participante_jid, participante_nome, autor_nome, usuario_id, texto, anexo, midia is not null as tem_midia, historico, em';
const daMensagem = (r: LinhaMensagem): MensagemGrupo => ({
  id: r.id,
  grupoId: r.grupo_id,
  idExterno: r.id_externo,
  autor: r.autor,
  participante: r.participante,
  participanteJid: r.participante_jid,
  participanteNome: r.participante_nome,
  autorNome: r.autor_nome,
  usuarioId: r.usuario_id,
  texto: r.texto,
  anexo: r.anexo,
  temMidia: r.tem_midia,
  historico: r.historico,
  em: r.em,
});
const ehUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export class ArmazemGruposPostgres implements ArmazemGrupos {
  constructor(private readonly pool: pg.Pool) {}

  async grupo(p: { empresaId: string; canalId: string; unidade: string; jid: string }) {
    const { rows } = await this.pool.query<LinhaGrupo>(
      `insert into sintonia.grupos (empresa_id, canal_id, unidade, jid) values ($1, $2, $3, $4)
       on conflict (empresa_id, canal_id, jid) do update set unidade = excluded.unidade
       returning ${COLUNAS_GRUPO}`,
      [p.empresaId, p.canalId, p.unidade, p.jid],
    );
    return doGrupo(rows[0]!);
  }
  async buscar(id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<LinhaGrupo>(`select ${COLUNAS_GRUPO} from sintonia.grupos where id = $1`, [id]);
    return rows[0] ? doGrupo(rows[0]) : undefined;
  }
  async listar(empresaId: string) {
    const { rows } = await this.pool.query<LinhaGrupo>(
      `select ${COLUNAS_GRUPO} from sintonia.grupos where empresa_id = $1 order by ultima_em desc nulls last, criado_em desc limit 1000`,
      [empresaId],
    );
    return rows.map(doGrupo);
  }
  async ultimas(ids: string[]) {
    if (!ids.length) return new Map<string, MensagemGrupo>();
    const { rows } = await this.pool.query<LinhaMensagem>(
      `select distinct on (grupo_id) ${COLUNAS_MSG} from sintonia.grupo_mensagens where grupo_id = any($1::uuid[]) order by grupo_id, em desc, criado_em desc`,
      [ids],
    );
    return new Map(rows.map((r) => [r.grupo_id, daMensagem(r)]));
  }
  async atualizarInfo(id: string, info: { nome?: string | null; participantes?: number | null }, em: Date | null) {
    await this.pool.query(
      'update sintonia.grupos set nome = coalesce($2, nome), participantes = coalesce($3, participantes), info_em = coalesce($4, info_em) where id = $1',
      [id, info.nome ?? null, info.participantes ?? null, em],
    );
  }
  async guardarFoto(id: string, foto: { conteudo: Buffer; tipo: string } | null, url?: string | null) {
    await this.pool.query('update sintonia.grupos set foto = $2, foto_tipo = $3, foto_url = $4 where id = $1', [id, foto?.conteudo ?? null, foto?.tipo ?? null, foto ? (url ?? null) : null]);
  }
  async arquivar(id: string, arquivado: boolean, em: Date) {
    await this.pool.query('update sintonia.grupos set arquivado = $2, arquivado_em = case when $2 then $3::timestamptz else null end where id = $1', [id, arquivado, em]);
  }
  async foto(id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<{ foto: Buffer | null; foto_tipo: string | null }>('select foto, foto_tipo from sintonia.grupos where id = $1', [id]);
    const r = rows[0];
    return r?.foto ? { conteudo: r.foto, tipo: r.foto_tipo ?? 'image/jpeg' } : undefined;
  }
  async adicionar(m: NovaMensagemGrupo, opcoes: { nossa?: boolean } = {}) {
    const { rows } = await this.pool.query<LinhaMensagem>(
      `insert into sintonia.grupo_mensagens
         (grupo_id, id_externo, autor, participante, participante_jid, participante_nome, autor_nome, usuario_id, texto, anexo, historico, em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       on conflict (grupo_id, id_externo) do nothing
       returning ${COLUNAS_MSG}`,
      [m.grupoId, m.idExterno, m.autor, m.participante, m.participanteJid, m.participanteNome, m.autorNome, m.usuarioId, m.texto, m.anexo ? JSON.stringify(m.anexo) : null, m.historico, m.em],
    );
    if (!rows[0]) {
      // O eco do WhatsApp chegou antes da resposta do envio: a mensagem fica com o nome de quem enviou.
      if (opcoes.nossa) {
        await this.pool.query(
          `update sintonia.grupo_mensagens set autor = 'equipe', autor_nome = $3, usuario_id = $4 where grupo_id = $1 and id_externo = $2`,
          [m.grupoId, m.idExterno, m.autorNome, m.usuarioId],
        );
      }
      return undefined;
    }
    await this.pool.query('update sintonia.grupos set ultima_em = greatest(coalesce(ultima_em, $2), $2) where id = $1', [m.grupoId, m.em]);
    return daMensagem(rows[0]);
  }
  async mensagens(grupoId: string, limite: number, antes?: Date) {
    const { rows } = await this.pool.query<LinhaMensagem>(
      `select * from (select ${COLUNAS_MSG}, criado_em from sintonia.grupo_mensagens where grupo_id = $1 and ($3::timestamptz is null or em < $3)
         order by em desc, criado_em desc limit $2) x order by em, criado_em`,
      [grupoId, limite, antes ?? null],
    );
    return rows.map(daMensagem);
  }
  async mensagem(id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<LinhaMensagem>(`select ${COLUNAS_MSG} from sintonia.grupo_mensagens where id = $1`, [id]);
    return rows[0] ? daMensagem(rows[0]) : undefined;
  }
  async guardarMidia(mensagemId: string, conteudo: Buffer) {
    await this.pool.query('update sintonia.grupo_mensagens set midia = $2 where id = $1', [mensagemId, conteudo]);
  }
  async midia(mensagemId: string) {
    if (!ehUuid(mensagemId)) return undefined;
    const { rows } = await this.pool.query<{ midia: Buffer | null }>('select midia from sintonia.grupo_mensagens where id = $1', [mensagemId]);
    return rows[0]?.midia ?? undefined;
  }
  async lidas(u: string) {
    const { rows } = await this.pool.query<{ grupo_id: string; lida_ate: Date }>('select grupo_id, lida_ate from sintonia.grupo_leituras where usuario_id = $1', [u]);
    return new Map(rows.map((r) => [r.grupo_id, r.lida_ate]));
  }
  async marcarLida(u: string, ids: string[], em: Date) {
    if (!ids.length) return;
    await this.pool.query(
      `insert into sintonia.grupo_leituras (usuario_id, grupo_id, lida_ate) select $1, unnest($2::uuid[]), $3
       on conflict (usuario_id, grupo_id) do update set lida_ate = greatest(sintonia.grupo_leituras.lida_ate, excluded.lida_ate)`,
      [u, ids, em],
    );
  }
  async naoLidas(u: string, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const { rows } = await this.pool.query<{ grupo_id: string; n: string }>(
      `select m.grupo_id, count(*) as n from sintonia.grupo_mensagens m
         left join sintonia.grupo_leituras l on l.grupo_id = m.grupo_id and l.usuario_id = $1
        where m.grupo_id = any($2::uuid[]) and m.autor = 'participante' and not m.historico
          and (l.lida_ate is null or m.em > l.lida_ate)
        group by m.grupo_id`,
      [u, ids],
    );
    return new Map(rows.map((r) => [r.grupo_id, Number(r.n)]));
  }
}
