import type pg from 'pg';
import { ContasMemoria, ContasPostgres, novoToken, resumoToken, type Contas, type Papel } from './contas.js';
import { limparAjustes, limparHorario, type Ajustes, type Horario } from './permissoes.js';

/** Onde ficam perfis, ajustes por pessoa, convites, sessões e auditoria (memória ou Postgres). */

export interface ExtrasUsuario {
  ajustes: Ajustes;
  trocarSenha: boolean;
  horario: Horario | null;
  ultimoAcesso: Date | null;
}

export interface SessaoInfo {
  id: string;
  criadaEm: Date;
  expiraEm: Date;
  usadaEm: Date | null;
  aparelho: string | null;
  ip: string | null;
}

export interface EventoAuditoria {
  empresaId: string;
  autorId: string | null;
  autorNome: string;
  alvoId?: string | null;
  alvoNome?: string | null;
  acao: string;
  detalhe?: string | null;
  em?: Date;
}

export type TipoConvite = 'convite' | 'redefinir';

export interface Acessos {
  perfis(empresaId: string): Promise<Partial<Record<Papel, Ajustes>>>;
  salvarPerfil(empresaId: string, papel: Papel, ajustes: Ajustes): Promise<void>;
  extras(usuarioId: string): Promise<ExtrasUsuario>;
  salvarExtras(usuarioId: string, campos: Partial<Omit<ExtrasUsuario, 'ultimoAcesso'>>): Promise<void>;
  registrarAcesso(usuarioId: string, em: Date): Promise<void>;
  /** Marca a sessão com aparelho/ip e o último uso. */
  marcarSessao(token: string, dados: { aparelho?: string; ip?: string; em: Date }): Promise<void>;
  sessoes(usuarioId: string, agora: Date): Promise<SessaoInfo[]>;
  /** Encerra uma sessão pelo id curto. Devolve se havia. */
  encerrarSessao(usuarioId: string, id: string): Promise<boolean>;
  criarConvite(usuarioId: string, tipo: TipoConvite, expiraEm: Date): Promise<string>;
  /** Convite válido (não usado, não vencido): devolve a pessoa. */
  verConvite(token: string, agora: Date): Promise<{ usuarioId: string; tipo: TipoConvite } | undefined>;
  /** Gasta o convite (e invalida os outros da pessoa). */
  usarConvite(token: string, agora: Date): Promise<{ usuarioId: string; tipo: TipoConvite } | undefined>;
  auditar(e: EventoAuditoria): Promise<void>;
  auditoria(empresaId: string, limite: number): Promise<Array<Required<Omit<EventoAuditoria, 'em'>> & { em: Date }>>;
}

const idDaSessao = (hash: string) => hash.slice(0, 16);
const semExtras = (): ExtrasUsuario => ({ ajustes: {}, trocarSenha: false, horario: null, ultimoAcesso: null });

// ---------------------------------------------------------------- memória

export class AcessosMemoria implements Acessos {
  private perfisMap = new Map<string, Ajustes>();
  private extrasMap = new Map<string, ExtrasUsuario>();
  private sessaoMeta = new Map<string, { aparelho?: string; ip?: string; usadaEm: Date; criadaEm: Date }>();
  private convites = new Map<string, { usuarioId: string; tipo: TipoConvite; expiraEm: Date; usado?: Date }>();
  private eventos: Array<Required<Omit<EventoAuditoria, 'em'>> & { em: Date }> = [];

  constructor(private readonly contas: ContasMemoria) {}

  async perfis(empresaId: string) {
    const r: Partial<Record<Papel, Ajustes>> = {};
    for (const [k, v] of this.perfisMap) if (k.startsWith(`${empresaId}|`)) r[k.split('|')[1] as Papel] = { ...v };
    return r;
  }
  async salvarPerfil(empresaId: string, papel: Papel, ajustes: Ajustes) {
    this.perfisMap.set(`${empresaId}|${papel}`, { ...ajustes });
  }
  async extras(usuarioId: string) {
    const e = this.extrasMap.get(usuarioId);
    return e ? { ...e, ajustes: { ...e.ajustes } } : semExtras();
  }
  async salvarExtras(usuarioId: string, campos: Partial<Omit<ExtrasUsuario, 'ultimoAcesso'>>) {
    this.extrasMap.set(usuarioId, { ...(await this.extras(usuarioId)), ...campos });
  }
  async registrarAcesso(usuarioId: string, em: Date) {
    this.extrasMap.set(usuarioId, { ...(await this.extras(usuarioId)), ultimoAcesso: em });
  }
  async marcarSessao(token: string, d: { aparelho?: string; ip?: string; em: Date }) {
    const h = resumoToken(token);
    const atual = this.sessaoMeta.get(h);
    this.sessaoMeta.set(h, { criadaEm: atual?.criadaEm ?? d.em, aparelho: d.aparelho ?? atual?.aparelho, ip: d.ip ?? atual?.ip, usadaEm: d.em });
  }
  async sessoes(usuarioId: string, agora: Date) {
    const l: SessaoInfo[] = [];
    for (const [h, s] of this.contas.sessoes) {
      if (s.usuarioId !== usuarioId || s.expiraEm <= agora) continue;
      const m = this.sessaoMeta.get(h);
      l.push({ id: idDaSessao(h), criadaEm: m?.criadaEm ?? agora, expiraEm: s.expiraEm, usadaEm: m?.usadaEm ?? null, aparelho: m?.aparelho ?? null, ip: m?.ip ?? null });
    }
    return l.sort((a, b) => (b.usadaEm?.getTime() ?? 0) - (a.usadaEm?.getTime() ?? 0));
  }
  async encerrarSessao(usuarioId: string, id: string) {
    for (const [h, s] of this.contas.sessoes) {
      if (s.usuarioId === usuarioId && idDaSessao(h) === id) {
        this.contas.sessoes.delete(h);
        return true;
      }
    }
    return false;
  }
  async criarConvite(usuarioId: string, tipo: TipoConvite, expiraEm: Date) {
    const token = novoToken();
    this.convites.set(resumoToken(token), { usuarioId, tipo, expiraEm });
    return token;
  }
  async verConvite(token: string, agora: Date) {
    const c = this.convites.get(resumoToken(token));
    if (!c || c.usado || c.expiraEm <= agora) return undefined;
    return { usuarioId: c.usuarioId, tipo: c.tipo };
  }
  async usarConvite(token: string, agora: Date) {
    const v = await this.verConvite(token, agora);
    if (!v) return undefined;
    for (const c of this.convites.values()) if (c.usuarioId === v.usuarioId && !c.usado) c.usado = agora;
    return v;
  }
  async auditar(e: EventoAuditoria) {
    this.eventos.unshift({ empresaId: e.empresaId, autorId: e.autorId, autorNome: e.autorNome, alvoId: e.alvoId ?? null, alvoNome: e.alvoNome ?? null, acao: e.acao, detalhe: e.detalhe ?? null, em: e.em ?? new Date() });
  }
  async auditoria(empresaId: string, limite: number) {
    return this.eventos.filter((e) => e.empresaId === empresaId).slice(0, limite);
  }
}

// ---------------------------------------------------------------- Postgres

export class AcessosPostgres implements Acessos {
  constructor(private readonly pool: pg.Pool) {}

  async perfis(empresaId: string) {
    const { rows } = await this.pool.query<{ papel: Papel; permissoes: unknown }>('select papel, permissoes from sintonia.acesso_perfis where empresa_id = $1', [empresaId]);
    return Object.fromEntries(rows.map((r) => [r.papel, limparAjustes(r.permissoes)])) as Partial<Record<Papel, Ajustes>>;
  }
  async salvarPerfil(empresaId: string, papel: Papel, ajustes: Ajustes) {
    await this.pool.query(
      `insert into sintonia.acesso_perfis (empresa_id, papel, permissoes, atualizado_em) values ($1, $2, $3, now())
       on conflict (empresa_id, papel) do update set permissoes = excluded.permissoes, atualizado_em = now()`,
      [empresaId, papel, JSON.stringify(ajustes)],
    );
  }
  async extras(usuarioId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(usuarioId)) return semExtras();
    const { rows } = await this.pool.query<{ permissoes: unknown; trocar_senha: boolean; horario: unknown; ultimo_acesso: Date | null }>(
      'select permissoes, trocar_senha, horario, ultimo_acesso from sintonia.acesso_usuarios where usuario_id = $1',
      [usuarioId],
    );
    const r = rows[0];
    return r ? { ajustes: limparAjustes(r.permissoes), trocarSenha: r.trocar_senha, horario: limparHorario(r.horario), ultimoAcesso: r.ultimo_acesso } : semExtras();
  }
  async salvarExtras(usuarioId: string, c: Partial<Omit<ExtrasUsuario, 'ultimoAcesso'>>) {
    const atual = await this.extras(usuarioId);
    const n = { ...atual, ...c };
    await this.pool.query(
      `insert into sintonia.acesso_usuarios (usuario_id, permissoes, trocar_senha, horario) values ($1, $2, $3, $4)
       on conflict (usuario_id) do update set permissoes = excluded.permissoes, trocar_senha = excluded.trocar_senha, horario = excluded.horario`,
      [usuarioId, JSON.stringify(n.ajustes), n.trocarSenha, n.horario ? JSON.stringify(n.horario) : null],
    );
  }
  async registrarAcesso(usuarioId: string, em: Date) {
    await this.pool.query(
      `insert into sintonia.acesso_usuarios (usuario_id, ultimo_acesso) values ($1, $2)
       on conflict (usuario_id) do update set ultimo_acesso = excluded.ultimo_acesso`,
      [usuarioId, em],
    );
  }
  async marcarSessao(token: string, d: { aparelho?: string; ip?: string; em: Date }) {
    await this.pool.query(
      'update sintonia.sessoes set aparelho = coalesce($2, aparelho), ip = coalesce($3, ip), usada_em = $4 where token_hash = $1',
      [resumoToken(token), d.aparelho ?? null, d.ip ?? null, d.em],
    );
  }
  async sessoes(usuarioId: string, agora: Date) {
    const { rows } = await this.pool.query<{ token_hash: string; criada_em: Date; expira_em: Date; usada_em: Date | null; aparelho: string | null; ip: string | null }>(
      `select token_hash, criada_em, expira_em, usada_em, aparelho, ip from sintonia.sessoes
        where usuario_id = $1 and expira_em > $2 order by usada_em desc nulls last, criada_em desc`,
      [usuarioId, agora],
    );
    return rows.map((r) => ({ id: idDaSessao(r.token_hash), criadaEm: r.criada_em, expiraEm: r.expira_em, usadaEm: r.usada_em, aparelho: r.aparelho, ip: r.ip }));
  }
  async encerrarSessao(usuarioId: string, id: string) {
    if (!/^[0-9a-f]{16}$/.test(id)) return false;
    const r = await this.pool.query('delete from sintonia.sessoes where usuario_id = $1 and left(token_hash, 16) = $2', [usuarioId, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async criarConvite(usuarioId: string, tipo: TipoConvite, expiraEm: Date) {
    const token = novoToken();
    await this.pool.query('insert into sintonia.acesso_convites (token_hash, usuario_id, tipo, expira_em) values ($1, $2, $3, $4)', [resumoToken(token), usuarioId, tipo, expiraEm]);
    return token;
  }
  async verConvite(token: string, agora: Date) {
    const { rows } = await this.pool.query<{ usuario_id: string; tipo: TipoConvite }>(
      'select usuario_id, tipo from sintonia.acesso_convites where token_hash = $1 and usado_em is null and expira_em > $2',
      [resumoToken(token), agora],
    );
    return rows[0] ? { usuarioId: rows[0].usuario_id, tipo: rows[0].tipo } : undefined;
  }
  async usarConvite(token: string, agora: Date) {
    const v = await this.verConvite(token, agora);
    if (!v) return undefined;
    await this.pool.query('update sintonia.acesso_convites set usado_em = $2 where usuario_id = $1 and usado_em is null', [v.usuarioId, agora]);
    return v;
  }
  async auditar(e: EventoAuditoria) {
    await this.pool.query(
      `insert into sintonia.acesso_auditoria (empresa_id, autor_id, autor_nome, alvo_id, alvo_nome, acao, detalhe, em)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [e.empresaId, e.autorId, e.autorNome, e.alvoId ?? null, e.alvoNome ?? null, e.acao, e.detalhe ?? null, e.em ?? new Date()],
    );
  }
  async auditoria(empresaId: string, limite: number) {
    const { rows } = await this.pool.query<{ empresa_id: string; autor_id: string | null; autor_nome: string; alvo_id: string | null; alvo_nome: string | null; acao: string; detalhe: string | null; em: Date }>(
      'select * from sintonia.acesso_auditoria where empresa_id = $1 order by em desc, id desc limit $2',
      [empresaId, limite],
    );
    return rows.map((r) => ({ empresaId: r.empresa_id, autorId: r.autor_id, autorNome: r.autor_nome, alvoId: r.alvo_id, alvoNome: r.alvo_nome, acao: r.acao, detalhe: r.detalhe, em: r.em }));
  }
}

/** Escolhe o armazenamento pelo tipo das contas (assim o index.ts não precisa mudar). */
export function acessosPara(contas: Contas): Acessos | undefined {
  if (contas instanceof ContasPostgres) return new AcessosPostgres(contas.pool);
  if (contas instanceof ContasMemoria) return new AcessosMemoria(contas);
  return undefined;
}
