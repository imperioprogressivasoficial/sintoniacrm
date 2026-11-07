import type { ArmazemPlanos, Assinatura, ResumoUso } from './armazem.js';
import { CONFIG_SUGERIDA, custoUsd, dentroDaJanela, planoPorId, tokensDe, type ConfigPlanos, type Plano, type Uso } from './catalogo.js';
import { bahia, partesBahia } from '../util/tempo.js';

/**
 * Porteiro da IA: antes de a IA agir, diz se a empresa pode usar a IA AGORA
 * (plano com IA e ativo, dentro da janela ou com o adicional, e com cota ou recarga no mês).
 * Também registra o uso de cada chamada (custo estimado e se foi dentro ou fora do horário).
 */

export type MotivoBloqueio = 'sem_plano' | 'suspensa' | 'fora_do_horario' | 'sem_cota';
export const TEXTO_MOTIVO: Record<MotivoBloqueio, string> = {
  sem_plano: 'A empresa está no plano Grátis (CRM sem IA): a equipe atende.',
  suspensa: 'A assinatura da IA está suspensa: a equipe atende.',
  fora_do_horario: 'Fora do horário do plano e sem créditos para a IA: a equipe atende.',
  sem_cota: 'A cota de IA do mês acabou (sem recarga): a equipe atende.',
};

export type Decisao =
  | { pode: true; dentro: boolean; ilimitado: boolean }
  | { pode: false; dentro: boolean; motivo: MotivoBloqueio; texto: string };

export interface Cota {
  /** null = ilimitada. */
  base: number | null;
  recargas: number;
  total: number | null;
  usados: number;
  restantes: number | null;
  pct: number | null;
}

export const inicioDoMes = (d: Date) => {
  const p = partesBahia(d);
  return bahia(p.ano, p.mes, 1);
};
export const fimDoMes = (d: Date) => {
  const p = partesBahia(d);
  return p.mes === 12 ? bahia(p.ano + 1, 1, 1) : bahia(p.ano, p.mes + 1, 1);
};

export interface OpcoesPlanos {
  armazem: ArmazemPlanos;
  config?: ConfigPlanos;
  /** Empresas que entram no plano Fundador quando não têm assinatura gravada (a conta original). */
  fundadoras?: string[];
  log?: (msg: string, extra?: unknown) => void;
}

export class Planos {
  readonly armazem: ArmazemPlanos;
  readonly base: ConfigPlanos;
  private readonly fundadoras: Set<string>;
  private readonly log: (msg: string, extra?: unknown) => void;

  constructor(o: OpcoesPlanos) {
    this.armazem = o.armazem;
    this.base = o.config ?? CONFIG_SUGERIDA;
    this.fundadoras = new Set(o.fundadoras ?? []);
    this.log = o.log ?? (() => {});
  }

  /** Assinatura gravada, ou a padrão: Fundador para a conta original, Grátis para as outras. */
  async assinatura(empresaId: string): Promise<Assinatura> {
    const a = await this.armazem.assinatura(empresaId);
    if (a) return a;
    return { empresaId, plano: this.fundadoras.has(empresaId) ? 'fundador' : 'gratis', adicionalFora: false, status: 'ativa', atualizadaEm: new Date(0), atualizadaPor: null };
  }

  /** Configuração da empresa: a sugerida com os ajustes dela por cima. */
  configDe(a: Assinatura): ConfigPlanos {
    return { ...this.base, clt: { ...this.base.clt, ...(a.clt ?? {}) }, janela: a.janela ?? this.base.janela, feriados: a.feriados ?? this.base.feriados };
  }

  plano(a: Assinatura): Plano {
    return planoPorId(this.configDe(a), a.plano);
  }

  cotaDe(a: Assinatura, uso: ResumoUso, recargas: number): Cota {
    const p = this.plano(a);
    if (p.cotaTokens === null) return { base: null, recargas, total: null, usados: uso.tokens, restantes: null, pct: null };
    const base = Math.round(p.cotaTokens * (a.adicionalFora ? 1 + this.configDe(a).adicionalCotaPct / 100 : 1));
    const total = base + recargas;
    return { base, recargas, total, usados: uso.tokens, restantes: Math.max(0, total - uso.tokens), pct: total > 0 ? Math.min(100, Math.round((uso.tokens / total) * 1000) / 10) : 100 };
  }

  async cotaDoMes(empresaId: string, agora: Date): Promise<{ assinatura: Assinatura; uso: ResumoUso; cota: Cota }> {
    const a = await this.assinatura(empresaId);
    const ini = inicioDoMes(agora);
    const fim = fimDoMes(agora);
    const [uso, recargas] = await Promise.all([this.armazem.resumo(empresaId, ini, fim), this.armazem.tokensRecargas(empresaId, ini, fim)]);
    return { assinatura: a, uso, cota: this.cotaDe(a, uso, recargas) };
  }

  /** O instante está dentro da janela do plano? */
  dentro(a: Assinatura, agora: Date): boolean {
    const cfg = this.configDe(a);
    return dentroDaJanela(agora, cfg.janela, cfg.feriados);
  }

  /** A empresa pode usar a IA agora? */
  async decidir(empresaId: string, agora: Date): Promise<Decisao> {
    const a = await this.assinatura(empresaId);
    const dentro = this.dentro(a, agora);
    const p = this.plano(a);
    const nao = (motivo: MotivoBloqueio): Decisao => ({ pode: false, dentro, motivo, texto: TEXTO_MOTIVO[motivo] });
    if (a.status !== 'ativa') return nao('suspensa');
    if (p.ilimitado) return { pode: true, dentro, ilimitado: true };
    if (!p.ia) return nao('sem_plano');
    const { cota, uso } = await this.cotaDoMes(empresaId, agora);
    // Fora do expediente a IA só trabalha com créditos (recargas): cada token fora do horário sai do saldo de créditos.
    if (!dentro && !a.adicionalFora && cota.recargas - uso.tokensFora <= 0) return nao('fora_do_horario');
    if (cota.restantes !== null && cota.restantes <= 0) return nao('sem_cota');
    return { pode: true, dentro, ilimitado: false };
  }

  /**
   * Pagamento confirmado (hoje à mão; no futuro, o webhook do PagamentoProvider): marca o pedido como pago
   * e aplica: recarga soma tokens no mês; mudar_plano troca o plano; adicional_fora liga o adicional.
   */
  async confirmarPedido(empresaId: string, id: string, agora: Date, por: string | null = null) {
    const p = await this.armazem.marcarPedido(empresaId, id, 'pago', agora);
    if (!p) return null;
    if (p.tipo !== 'recarga') {
      const a = await this.assinatura(empresaId);
      if (p.tipo === 'mudar_plano' && typeof p.dados.plano === 'string') a.plano = p.dados.plano as Assinatura['plano'];
      if (p.tipo === 'adicional_fora') a.adicionalFora = p.dados.ligar !== false;
      await this.armazem.gravarAssinatura({ ...a, status: 'ativa', atualizadaEm: agora, atualizadaPor: por });
    }
    return p;
  }

  /** Registra uma chamada à API. Nunca lança: a medição não pode derrubar o atendimento. */
  async registrarUso(r: { empresaId: string; em: Date; conversaId: string | null; origem: string; modelo: string; uso: Uso; dentro?: boolean }): Promise<void> {
    try {
      const a = await this.assinatura(r.empresaId);
      await this.armazem.registrarUso({
        empresaId: r.empresaId,
        em: r.em,
        conversaId: r.conversaId,
        origem: r.origem,
        modelo: r.modelo,
        entrada: r.uso.entrada,
        saida: r.uso.saida,
        cacheLeitura: r.uso.cacheLeitura,
        cacheEscrita: r.uso.cacheEscrita,
        custoUsd: custoUsd(this.configDe(a), r.modelo, r.uso),
        dentroHorario: r.dentro ?? this.dentro(a, r.em),
      });
    } catch (e) {
      this.log('Falha ao registrar o uso da IA', { erro: String(e), tokens: tokensDe(r.uso) });
    }
  }
}
