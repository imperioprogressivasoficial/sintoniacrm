import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';

export const PAPEIS = ['atendente', 'recepcionista', 'gerente', 'direcao', 'admin'] as const;
export type Papel = (typeof PAPEIS)[number];

export interface Usuario {
  id: string;
  empresaId: string;
  nome: string;
  email: string;
  papel: Papel;
  unidades: string[];
  ativo: boolean;
}

export interface UsuarioComSenha extends Usuario {
  senhaHash: string;
}

export interface Interessado {
  nome: string;
  empresa?: string;
  whatsapp: string;
  mensagem?: string;
  origem?: string;
}

export interface Contas {
  criarUsuario(u: Omit<Usuario, 'id' | 'ativo'> & { senhaHash: string }): Promise<Usuario>;
  buscarPorEmail(email: string): Promise<UsuarioComSenha | undefined>;
  /** Cria a sessão e devolve o token (só o resumo dele fica guardado). */
  criarSessao(usuarioId: string, expiraEm: Date): Promise<string>;
  /** Usuário dono do token, se a sessão existe, não venceu e a conta está ativa. */
  usuarioDaSessao(token: string, agora: Date): Promise<Usuario | undefined>;
  encerrarSessao(token: string): Promise<void>;
  registrarInteressado(i: Interessado): Promise<void>;

  // ---- equipe ----
  listarUsuarios(empresaId: string): Promise<Usuario[]>;
  buscarPorId(id: string): Promise<UsuarioComSenha | undefined>;
  /** Muda papel, unidades e/ou se está ativa. Devolve a usuária atualizada (undefined se não existe). */
  atualizarUsuario(id: string, campos: Partial<Pick<Usuario, 'papel' | 'unidades' | 'ativo'>>): Promise<Usuario | undefined>;
  definirSenha(id: string, senhaHash: string): Promise<void>;
  /** Encerra todas as sessões da usuária, menos a do token informado (se houver). */
  encerrarSessoesDe(usuarioId: string, excetoToken?: string): Promise<void>;
}

export const novoToken = () => randomBytes(32).toString('base64url');
export const resumoToken = (token: string) => createHash('sha256').update(token).digest('hex');

// ---------------------------------------------------------------- memória

export class ContasMemoria implements Contas {
  usuarios: UsuarioComSenha[] = [];
  sessoes = new Map<string, { usuarioId: string; expiraEm: Date }>();
  interessados: Interessado[] = [];

  async criarUsuario(u: Omit<Usuario, 'id' | 'ativo'> & { senhaHash: string }) {
    if (this.usuarios.some((x) => x.email.toLowerCase() === u.email.toLowerCase())) {
      throw new Error('Já existe um usuário com esse e-mail.');
    }
    const novo: UsuarioComSenha = { ...u, id: randomUUID(), ativo: true };
    this.usuarios.push(novo);
    const { senhaHash: _, ...publico } = novo;
    return publico;
  }

  async buscarPorEmail(email: string) {
    return this.usuarios.find((x) => x.email.toLowerCase() === email.toLowerCase());
  }

  async criarSessao(usuarioId: string, expiraEm: Date) {
    const token = novoToken();
    this.sessoes.set(resumoToken(token), { usuarioId, expiraEm });
    return token;
  }

  async usuarioDaSessao(token: string, agora: Date) {
    const s = this.sessoes.get(resumoToken(token));
    if (!s || s.expiraEm.getTime() <= agora.getTime()) return undefined;
    const u = this.usuarios.find((x) => x.id === s.usuarioId && x.ativo);
    if (!u) return undefined;
    const { senhaHash: _, ...publico } = u;
    return publico;
  }

  async encerrarSessao(token: string) {
    this.sessoes.delete(resumoToken(token));
  }

  async registrarInteressado(i: Interessado) {
    this.interessados.push(i);
  }

  async listarUsuarios(empresaId: string) {
    return this.usuarios
      .filter((u) => u.empresaId === empresaId)
      .map(({ senhaHash: _, ...publico }) => publico)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  async buscarPorId(id: string) {
    const u = this.usuarios.find((x) => x.id === id);
    return u ? { ...u } : undefined;
  }

  async atualizarUsuario(id: string, campos: Partial<Pick<Usuario, 'papel' | 'unidades' | 'ativo'>>) {
    const u = this.usuarios.find((x) => x.id === id);
    if (!u) return undefined;
    if (campos.papel !== undefined) u.papel = campos.papel;
    if (campos.unidades !== undefined) u.unidades = [...campos.unidades];
    if (campos.ativo !== undefined) u.ativo = campos.ativo;
    const { senhaHash: _, ...publico } = u;
    return { ...publico, unidades: [...publico.unidades] };
  }

  async definirSenha(id: string, senhaHash: string) {
    const u = this.usuarios.find((x) => x.id === id);
    if (u) u.senhaHash = senhaHash;
  }

  async encerrarSessoesDe(usuarioId: string, excetoToken?: string) {
    const manter = excetoToken ? resumoToken(excetoToken) : undefined;
    for (const [chave, s] of this.sessoes) if (s.usuarioId === usuarioId && chave !== manter) this.sessoes.delete(chave);
  }
}

// ---------------------------------------------------------------- Postgres

interface LinhaUsuario {
  id: string;
  empresa_id: string;
  nome: string;
  email: string;
  senha_hash: string;
  papel: Papel;
  unidades: string[];
  ativo: boolean;
}

const paraUsuario = (l: LinhaUsuario): Usuario => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  email: l.email,
  papel: l.papel,
  unidades: l.unidades ?? [],
  ativo: l.ativo,
});

export class ContasPostgres implements Contas {
  constructor(private readonly pool: pg.Pool) {}

  async criarUsuario(u: Omit<Usuario, 'id' | 'ativo'> & { senhaHash: string }) {
    try {
      const { rows } = await this.pool.query<LinhaUsuario>(
        `insert into sintonia.usuarios (id, empresa_id, nome, email, senha_hash, papel, unidades)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [randomUUID(), u.empresaId, u.nome, u.email, u.senhaHash, u.papel, u.unidades],
      );
      return paraUsuario(rows[0]!);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new Error('Já existe um usuário com esse e-mail.');
      throw e;
    }
  }

  async buscarPorEmail(email: string) {
    const { rows } = await this.pool.query<LinhaUsuario>('select * from sintonia.usuarios where lower(email) = lower($1)', [email]);
    return rows[0] ? { ...paraUsuario(rows[0]), senhaHash: rows[0].senha_hash } : undefined;
  }

  async criarSessao(usuarioId: string, expiraEm: Date) {
    const token = novoToken();
    await this.pool.query('insert into sintonia.sessoes (token_hash, usuario_id, expira_em) values ($1, $2, $3)', [
      resumoToken(token),
      usuarioId,
      expiraEm,
    ]);
    return token;
  }

  async usuarioDaSessao(token: string, agora: Date) {
    const { rows } = await this.pool.query<LinhaUsuario>(
      `select u.* from sintonia.sessoes s join sintonia.usuarios u on u.id = s.usuario_id
        where s.token_hash = $1 and s.expira_em > $2 and u.ativo`,
      [resumoToken(token), agora],
    );
    return rows[0] ? paraUsuario(rows[0]) : undefined;
  }

  async encerrarSessao(token: string) {
    await this.pool.query('delete from sintonia.sessoes where token_hash = $1', [resumoToken(token)]);
  }

  async registrarInteressado(i: Interessado) {
    await this.pool.query(
      'insert into sintonia.interessados (nome, empresa, whatsapp, mensagem, origem) values ($1, $2, $3, $4, $5)',
      [i.nome, i.empresa ?? null, i.whatsapp, i.mensagem ?? null, i.origem ?? null],
    );
  }

  async listarUsuarios(empresaId: string) {
    const { rows } = await this.pool.query<LinhaUsuario>(
      'select * from sintonia.usuarios where empresa_id = $1 order by nome',
      [empresaId],
    );
    return rows.map(paraUsuario);
  }

  async buscarPorId(id: string) {
    const { rows } = await this.pool.query<LinhaUsuario>('select * from sintonia.usuarios where id = $1', [id]);
    return rows[0] ? { ...paraUsuario(rows[0]), senhaHash: rows[0].senha_hash } : undefined;
  }

  async atualizarUsuario(id: string, campos: Partial<Pick<Usuario, 'papel' | 'unidades' | 'ativo'>>) {
    const { rows } = await this.pool.query<LinhaUsuario>(
      `update sintonia.usuarios set
         papel = coalesce($2, papel), unidades = coalesce($3, unidades), ativo = coalesce($4, ativo)
       where id = $1 returning *`,
      [id, campos.papel ?? null, campos.unidades ?? null, campos.ativo ?? null],
    );
    return rows[0] ? paraUsuario(rows[0]) : undefined;
  }

  async definirSenha(id: string, senhaHash: string) {
    await this.pool.query('update sintonia.usuarios set senha_hash = $2 where id = $1', [id, senhaHash]);
  }

  async encerrarSessoesDe(usuarioId: string, excetoToken?: string) {
    await this.pool.query('delete from sintonia.sessoes where usuario_id = $1 and token_hash is distinct from $2', [
      usuarioId,
      excetoToken ? resumoToken(excetoToken) : null,
    ]);
  }
}
