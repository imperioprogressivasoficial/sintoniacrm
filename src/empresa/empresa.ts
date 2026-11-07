import type pg from 'pg';
import { z } from 'zod';
import type { ModoAtendimento } from '../domain.js';
import { REGRAS_PADRAO, type RegrasAtendimento } from '../engine/atendimento.js';

/**
 * A empresa (a conta): nome de exibição e a configuração da IA.
 * Gravado na tabela sintonia.empresas (criada na 001; colunas novas na 007).
 */

export interface ConfigIA {
  /** Modo em que as conversas novas nascem. */
  modoPadrao: ModoAtendimento;
  /** "IA assume quando ninguém responde" (copiloto em horário de loja). */
  assumirSemResposta: { ligado: boolean; minutos: number };
  /** A IA pode marcar sozinha as tags que já existem. */
  marcarTags: boolean;
}

export const CONFIG_IA_PADRAO: ConfigIA = {
  modoPadrao: 'copiloto',
  assumirSemResposta: { ligado: true, minutos: REGRAS_PADRAO.assumirAposMin },
  marcarTags: false,
};

/** O que a tela pode mudar (tudo opcional: só muda o que vier). */
export const AlteracaoConfigIA = z.object({
  modoPadrao: z.enum(['humano', 'copiloto', 'ia']).optional(),
  assumirSemResposta: z
    .object({ ligado: z.boolean().optional(), minutos: z.number().int().min(1).max(240).optional() })
    .optional(),
  marcarTags: z.boolean().optional(),
});
export type AlteracaoConfigIA = z.infer<typeof AlteracaoConfigIA>;

/** Lê o que veio do banco sem confiar: campo estranho ou faltando vira o padrão. */
export function normalizarConfig(bruto: unknown): ConfigIA {
  const r = AlteracaoConfigIA.safeParse(bruto ?? {});
  const v = r.success ? r.data : {};
  return {
    modoPadrao: v.modoPadrao ?? CONFIG_IA_PADRAO.modoPadrao,
    assumirSemResposta: {
      ligado: v.assumirSemResposta?.ligado ?? CONFIG_IA_PADRAO.assumirSemResposta.ligado,
      minutos: v.assumirSemResposta?.minutos ?? CONFIG_IA_PADRAO.assumirSemResposta.minutos,
    },
    marcarTags: v.marcarTags ?? CONFIG_IA_PADRAO.marcarTags,
  };
}

/** Configuração → regras do motor de atendimento (engine/atendimento.ts). */
export function regrasDaConfig(c: ConfigIA): Partial<RegrasAtendimento> & { modoPadrao: ModoAtendimento } {
  return { modoPadrao: c.modoPadrao, assumirLigado: c.assumirSemResposta.ligado, assumirAposMin: c.assumirSemResposta.minutos };
}

export interface RegistroEmpresa {
  id: string;
  nome: string;
  configIa: unknown;
  atualizadaEm: Date | null;
  atualizadaPor: string | null;
}

export interface ArmazemEmpresa {
  ler(id: string): Promise<RegistroEmpresa | undefined>;
  /** Cria a empresa se não existe (com este nome) e devolve o registro atual. */
  garantir(id: string, nome: string): Promise<RegistroEmpresa>;
  gravarNome(id: string, nome: string, por: string, em: Date): Promise<void>;
  gravarConfigIa(id: string, config: ConfigIA, por: string, em: Date): Promise<void>;
}

export class ArmazemEmpresaMemoria implements ArmazemEmpresa {
  private readonly dados = new Map<string, RegistroEmpresa>();
  async ler(id: string) {
    const r = this.dados.get(id);
    return r ? { ...r } : undefined;
  }
  async garantir(id: string, nome: string) {
    if (!this.dados.has(id)) this.dados.set(id, { id, nome, configIa: {}, atualizadaEm: null, atualizadaPor: null });
    return { ...this.dados.get(id)! };
  }
  async gravarNome(id: string, nome: string, por: string, em: Date) {
    const r = await this.garantir(id, nome);
    this.dados.set(id, { ...r, nome, atualizadaEm: em, atualizadaPor: por });
  }
  async gravarConfigIa(id: string, config: ConfigIA, por: string, em: Date) {
    const r = this.dados.get(id) ?? (await this.garantir(id, id));
    this.dados.set(id, { ...r, configIa: structuredClone(config), atualizadaEm: em, atualizadaPor: por });
  }
}

interface LinhaEmpresa {
  id: string;
  nome: string;
  config_ia: unknown;
  atualizada_em: Date | null;
  atualizada_por: string | null;
}
const paraRegistro = (l: LinhaEmpresa): RegistroEmpresa => ({
  id: l.id,
  nome: l.nome,
  configIa: l.config_ia,
  atualizadaEm: l.atualizada_em,
  atualizadaPor: l.atualizada_por,
});

export class ArmazemEmpresaPostgres implements ArmazemEmpresa {
  constructor(private readonly pool: pg.Pool) {}
  async ler(id: string) {
    const { rows } = await this.pool.query<LinhaEmpresa>(
      'select id, nome, config_ia, atualizada_em, atualizada_por from sintonia.empresas where id = $1',
      [id],
    );
    return rows[0] ? paraRegistro(rows[0]) : undefined;
  }
  async garantir(id: string, nome: string) {
    await this.pool.query('insert into sintonia.empresas (id, nome) values ($1, $2) on conflict (id) do nothing', [id, nome]);
    return (await this.ler(id))!;
  }
  async gravarNome(id: string, nome: string, por: string, em: Date) {
    await this.pool.query(
      `insert into sintonia.empresas (id, nome, atualizada_em, atualizada_por) values ($1, $2, $3, $4)
       on conflict (id) do update set nome = excluded.nome, atualizada_em = excluded.atualizada_em, atualizada_por = excluded.atualizada_por`,
      [id, nome, em, por],
    );
  }
  async gravarConfigIa(id: string, config: ConfigIA, por: string, em: Date) {
    await this.pool.query(
      `insert into sintonia.empresas (id, nome, config_ia, atualizada_em, atualizada_por) values ($1, $1, $2, $3, $4)
       on conflict (id) do update set config_ia = excluded.config_ia, atualizada_em = excluded.atualizada_em, atualizada_por = excluded.atualizada_por`,
      [id, JSON.stringify(config), em, por],
    );
  }
}

/**
 * Empresa em vigor. Guarda uma cópia por poucos segundos: com vários processos, a mudança feita
 * em um vale nos outros logo depois (sem reiniciar); no processo que gravou, vale na hora.
 */
export class Empresa {
  private cache?: { r: RegistroEmpresa; ate: number };

  constructor(
    private readonly armazem: ArmazemEmpresa,
    readonly id: string,
    private readonly nomePadrao: string,
    private readonly opcoes: { cacheMs?: number; agora?: () => Date } = {},
  ) {}

  private agora() {
    return (this.opcoes.agora ?? (() => new Date()))();
  }

  private async registro(): Promise<RegistroEmpresa> {
    const t = Date.now();
    if (this.cache && this.cache.ate > t) return this.cache.r;
    const r = (await this.armazem.ler(this.id)) ?? (await this.armazem.garantir(this.id, this.nomePadrao));
    this.cache = { r, ate: t + (this.opcoes.cacheMs ?? 5000) };
    return r;
  }

  private esquecer() {
    this.cache = undefined;
  }

  async dados() {
    const r = await this.registro();
    return { id: r.id, nome: r.nome, atualizadaEm: r.atualizadaEm, atualizadaPor: r.atualizadaPor };
  }

  async renomear(nome: string, por: string) {
    await this.armazem.gravarNome(this.id, nome, por, this.agora());
    this.esquecer();
    return this.dados();
  }

  async configIa(): Promise<ConfigIA> {
    return normalizarConfig((await this.registro()).configIa);
  }

  async alterarConfigIa(alteracao: AlteracaoConfigIA, por: string): Promise<ConfigIA> {
    const atual = await this.configIa();
    const nova: ConfigIA = {
      modoPadrao: alteracao.modoPadrao ?? atual.modoPadrao,
      assumirSemResposta: { ...atual.assumirSemResposta, ...dropUndef(alteracao.assumirSemResposta ?? {}) },
      marcarTags: alteracao.marcarTags ?? atual.marcarTags,
    };
    await this.armazem.gravarConfigIa(this.id, nova, por, this.agora());
    this.esquecer();
    return this.configIa();
  }
}

const dropUndef = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
