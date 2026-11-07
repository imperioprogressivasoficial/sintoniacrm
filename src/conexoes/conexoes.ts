import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { UnidadeId } from '../domain.js';
import { Cofre } from './cofre.js';

/** O que pode ser configurado pela tela de Conexões. */
export const CAMPOS = {
  anthropicApiKey: { segredo: true },
  trinksApiKey: { segredo: true },
  evolutionUrl: { segredo: false },
  evolutionApiKey: { segredo: true },
  /** Gerado pela Sintonia; vai no cabeçalho do webhook das instâncias que ela cria. */
  webhookToken: { segredo: true },
  /** JSON: [{ "canalId": "sintonia-norte", "unidade": "norte" }] */
  numeros: { segredo: false },
  /** Telefones (só dígitos, separados por vírgula) que recebem o relatório do dia. */
  relatorioDestinos: { segredo: false },
} as const;
export type Campo = keyof typeof CAMPOS;
export type ValoresConexao = Partial<Record<Campo, string>>;

export const NumeroConectadoCfg = z.object({ canalId: z.string().min(1), unidade: z.enum(['norte', 'sumare', 'feira']) });
export type NumeroCfg = { canalId: string; unidade: UnidadeId };

export interface ArmazemConexoes {
  lerTudo(): Promise<Record<string, string>>;
  gravar(chave: string, valor: string | null, quem: string): Promise<void>;
}

export class ArmazemMemoria implements ArmazemConexoes {
  readonly dados = new Map<string, string>();
  async lerTudo() {
    return Object.fromEntries(this.dados);
  }
  async gravar(chave: string, valor: string | null) {
    if (valor === null) this.dados.delete(chave);
    else this.dados.set(chave, valor);
  }
}

export class ArmazemPostgres implements ArmazemConexoes {
  constructor(private readonly pool: pg.Pool) {}
  async lerTudo() {
    const { rows } = await this.pool.query<{ chave: string; valor: string }>('select chave, valor from sintonia.conexoes');
    return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  }
  async gravar(chave: string, valor: string | null, quem: string) {
    if (valor === null) {
      await this.pool.query('delete from sintonia.conexoes where chave = $1', [chave]);
      return;
    }
    await this.pool.query(
      `insert into sintonia.conexoes (chave, valor, atualizado_em, atualizado_por) values ($1, $2, now(), $3)
       on conflict (chave) do update set valor = excluded.valor, atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [chave, valor, quem],
    );
  }
}

/**
 * Conexões em vigor: o que foi salvo pela tela vale por cima das variáveis de ambiente.
 * Ao salvar, avisa quem precisa trocar de chave na hora (IA, Trinks, números do WhatsApp), sem reiniciar.
 */
export class Conexoes {
  private valores: ValoresConexao = {};
  private readonly ouvintes: Array<(v: ValoresConexao) => void> = [];

  constructor(
    private readonly armazem: ArmazemConexoes,
    private readonly cofre: Cofre,
    private readonly doAmbiente: ValoresConexao = {},
    private readonly log: (msg: string, extra?: unknown) => void = () => {},
  ) {}

  async carregar(): Promise<void> {
    const brutos = await this.armazem.lerTudo();
    const salvos: ValoresConexao = {};
    for (const [chave, valor] of Object.entries(brutos)) {
      if (!(chave in CAMPOS)) continue;
      try {
        salvos[chave as Campo] = this.cofre.decifrar(valor);
      } catch {
        this.log(`Conexão "${chave}" não pôde ser lida (segredo do servidor mudou?)`);
      }
    }
    this.valores = { ...limpar(this.doAmbiente), ...salvos };
    if (!this.valores.webhookToken) await this.salvar({ webhookToken: randomBytes(24).toString('hex') }, 'sistema');
    else this.avisar();
  }

  get(campo: Campo): string | undefined {
    return this.valores[campo] || undefined;
  }

  numeros(): NumeroCfg[] {
    try {
      return z.array(NumeroConectadoCfg).parse(JSON.parse(this.valores.numeros || '[]'));
    } catch {
      return [];
    }
  }

  destinosRelatorio(): string[] {
    return (this.valores.relatorioDestinos ?? '').split(',').map((s) => s.replace(/\D/g, '')).filter((s) => s.length >= 10);
  }

  /** Grava (cifrado) e aplica. String vazia apaga o campo salvo e volta ao valor do ambiente, se houver. */
  async salvar(parcial: ValoresConexao, quem: string): Promise<void> {
    for (const [campo, valor] of Object.entries(parcial) as Array<[Campo, string | undefined]>) {
      if (!(campo in CAMPOS) || valor === undefined) continue;
      const v = valor.trim();
      await this.armazem.gravar(campo, v ? this.cofre.cifrar(v) : null, quem);
      if (v) this.valores[campo] = v;
      else if (this.doAmbiente[campo]) this.valores[campo] = this.doAmbiente[campo];
      else delete this.valores[campo];
    }
    this.avisar();
  }

  aoMudar(fn: (v: ValoresConexao) => void): void {
    this.ouvintes.push(fn);
  }

  /** Para a tela: nunca devolve o segredo, só se existe e o final dele. */
  resumo() {
    const campos = Object.fromEntries(
      (Object.keys(CAMPOS) as Campo[]).map((c) => {
        const v = this.valores[c];
        return [c, CAMPOS[c].segredo ? { definido: Boolean(v), final: v ? v.slice(-4) : null } : { definido: Boolean(v), valor: v ?? null }];
      }),
    );
    return { campos, numeros: this.numeros(), destinosRelatorio: this.destinosRelatorio() };
  }

  private avisar() {
    for (const fn of this.ouvintes) {
      try {
        fn(this.valores);
      } catch (e) {
        this.log('Falha ao aplicar conexões', String(e));
      }
    }
  }
}

function limpar(v: ValoresConexao): ValoresConexao {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' && x.trim())) as ValoresConexao;
}
