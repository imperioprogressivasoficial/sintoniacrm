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
}
