import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { ConfigComercial, configPadrao } from './calculo.js';

/** Configuração comercial da empresa (metas, comissão, preços) e o token do Painel na TV. */
export interface RegistroComercial {
  cfg: ConfigComercial;
  tvToken: string | null;
  tvCriadoEm: Date | null;
  atualizadoEm: Date | null;
  atualizadoPor: string | null;
}

export interface ArmazemComercial {
  ler(empresaId: string): Promise<RegistroComercial>;
  salvar(empresaId: string, cfg: ConfigComercial, por: string): Promise<void>;
  /** null revoga. */
  definirToken(empresaId: string, token: string | null, em: Date): Promise<void>;
  empresaDoToken(token: string): Promise<string | undefined>;
}

/** Token da TV: 32 bytes aleatórios em base64url (43 caracteres), impossível de adivinhar. */
export const novoTokenTv = () => randomBytes(32).toString('base64url');
export const tokenValido = (t: string) => /^[A-Za-z0-9_-]{40,64}$/.test(t);
const resumo = (t: string) => createHash('sha256').update(t).digest();
const iguais = (a: string, b: string) => timingSafeEqual(resumo(a), resumo(b));

const lerCfg = (j: unknown): ConfigComercial => {
  const r = ConfigComercial.safeParse(j ?? {});
  return r.success ? r.data : configPadrao();
};

export class ArmazemComercialMemoria implements ArmazemComercial {
  private readonly m = new Map<string, RegistroComercial>();
  async ler(empresaId: string): Promise<RegistroComercial> {
    const r = this.m.get(empresaId);
    return r ? { ...r, cfg: structuredClone(r.cfg) } : { cfg: configPadrao(), tvToken: null, tvCriadoEm: null, atualizadoEm: null, atualizadoPor: null };
  }
  async salvar(empresaId: string, cfg: ConfigComercial, por: string) {
    const r = await this.ler(empresaId);
    this.m.set(empresaId, { ...r, cfg: structuredClone(cfg), atualizadoEm: new Date(), atualizadoPor: por });
  }
  async definirToken(empresaId: string, token: string | null, em: Date) {
    const r = await this.ler(empresaId);
    this.m.set(empresaId, { ...r, tvToken: token, tvCriadoEm: token ? em : null });
  }
  async empresaDoToken(token: string) {
    for (const [id, r] of this.m) if (r.tvToken && iguais(r.tvToken, token)) return id;
    return undefined;
  }
}

export class ArmazemComercialPostgres implements ArmazemComercial {
  constructor(private readonly pool: pg.Pool) {}
  async ler(empresaId: string): Promise<RegistroComercial> {
    const { rows } = await this.pool.query<{ dados: unknown; tv_token: string | null; tv_criado_em: Date | null; atualizado_em: Date; atualizado_por: string | null }>(
      'select dados, tv_token, tv_criado_em, atualizado_em, atualizado_por from sintonia.comercial_config where empresa_id = $1',
      [empresaId],
    );
    const r = rows[0];
    if (!r) return { cfg: configPadrao(), tvToken: null, tvCriadoEm: null, atualizadoEm: null, atualizadoPor: null };
    return { cfg: lerCfg(r.dados), tvToken: r.tv_token, tvCriadoEm: r.tv_criado_em, atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por };
  }
  async salvar(empresaId: string, cfg: ConfigComercial, por: string) {
    await this.pool.query(
      `insert into sintonia.comercial_config (empresa_id, dados, atualizado_em, atualizado_por) values ($1, $2, now(), $3)
       on conflict (empresa_id) do update set dados = excluded.dados, atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [empresaId, JSON.stringify(cfg), por],
    );
  }
  async definirToken(empresaId: string, token: string | null, em: Date) {
    await this.pool.query(
      `insert into sintonia.comercial_config (empresa_id, tv_token, tv_criado_em) values ($1, $2, $3)
       on conflict (empresa_id) do update set tv_token = excluded.tv_token, tv_criado_em = excluded.tv_criado_em`,
      [empresaId, token, token ? em : null],
    );
  }
  async empresaDoToken(token: string) {
    const { rows } = await this.pool.query<{ empresa_id: string; tv_token: string }>(
      'select empresa_id, tv_token from sintonia.comercial_config where tv_token = $1',
      [token],
    );
    const r = rows[0];
    return r && iguais(r.tv_token, token) ? r.empresa_id : undefined;
  }
}
