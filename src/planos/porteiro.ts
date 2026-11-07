import type { ArmazemPlanos, Assinatura, ResumoUso } from './armazem.js';
import { CONFIG_SUGERIDA, custoUsd, normalizarPlano, planoPorId, tokensDe, type ConfigPlanos, type Limites, type Plano, type Uso } from './catalogo.js';
import { bahia, HORA, partesBahia } from '../util/tempo.js';

/**
 * Porteiro da IA: antes de a IA agir, diz se a empresa pode usar a IA AGORA.
 * - Essencial: nunca (CRM sem IA). Fundador: sempre, sem limite.
 * - Colaborador de IA / Empresarial: IA 24 h dentro dos limites de uso (janela móvel de 5 h, semana e mês).
 *   Estourou QUALQUER limite, a IA só continua com créditos (recargas pagas). Sem crédito, para.
 * Também registra o uso de cada chamada: tokens, custo estimado e quanto saiu dos créditos.
 */

export type MotivoBloqueio = 'sem_plano' | 'suspensa' | 'sem_credito';
/** Textos dos motivos (inclui os antigos, que podem estar no histórico de bloqueios). */
export const TEXTO_MOTIVO: Record<string, string> = {
  sem_plano: 'A empresa está no plano Essencial (CRM sem IA): a equipe atende.',
  suspensa: 'A assinatura da IA está suspensa: a equipe atende.',
  sem_credito: 'A IA atingiu o limite de uso e não há créditos: a equipe atende.',
  fora_do_horario: 'Fora do horário do plano antigo: a equipe atendeu.',
  sem_cota: 'A cota do mês acabou (plano antigo): a equipe atendeu.',
};

export type Decisao = { pode: true; ilimitado: boolean; usandoCreditos: boolean } | { pode: false; motivo: MotivoBloqueio; texto: string };

export type IdLimite = keyof Limites;
const NOME_LIMITE: Record<IdLimite, string> = { cincoHoras: 'Últimas 5 horas', semana: 'Semana', mes: 'Mês' };

export interface EstadoLimite {
  id: IdLimite;
  nome: string;
  /** null = sem limite. */
  limite: number | null;
  usados: number;
  restantes: number | null;
  pct: number | null;
  estourou: boolean;
  /** Quando o limite volta/renova (ISO). 5 h: quando o uso cai abaixo do limite (estourado) ou quando o uso mais antigo sai da janela. */
  renovaEm: string | null;
  /** "volta às 15h20", "renova segunda", "renova dia 1º/12". */
  texto: string;
}

export interface Creditos {
  /** Tokens de recargas pagas (desde sempre). */
  comprados: number;
  /** Tokens pagos com créditos (desde sempre). */
  usados: number;
  saldo: number;
}

export interface Situacao {
  assinatura: Assinatura;
  plano: Plano;
  ilimitado: boolean;
  limites: EstadoLimite[];
  creditos: Creditos;
  /** Algum limite estourado agora. */
  estourou: boolean;
  /** A IA está rodando com créditos agora. */
  usandoCreditos: boolean;
}

const CINCO_HORAS = 5 * HORA;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const inicioDoMes = (d: Date) => {
  const p = partesBahia(d);
  return bahia(p.ano, p.mes, 1);
};
export const fimDoMes = (d: Date) => {
  const p = partesBahia(d);
  return p.mes === 12 ? bahia(p.ano + 1, 1, 1) : bahia(p.ano, p.mes + 1, 1);
};
/** Semana de segunda 0h a domingo 23h59 (horário da Bahia). */
export const inicioDaSemana = (d: Date) => {
  const p = partesBahia(d);
  return bahia(p.ano, p.mes, p.dia - ((p.diaSemana + 6) % 7));
};
export const fimDaSemana = (d: Date) => {
  const p = partesBahia(d);
  return bahia(p.ano, p.mes, p.dia - ((p.diaSemana + 6) % 7) + 7);
};

const hhmm = (h: number, m: number) => (m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`);

/** "volta às 15h20", "volta amanhã às 9h", "renova segunda", "renova dia 1º/12" (horário da Bahia). */
export function textoQuando(alvo: Date, agora: Date, verbo: string): string {
  const a = partesBahia(alvo);
  const meiaNoite = a.hora === 0 && a.minuto === 0;
  const dias = Math.round((bahia(a.ano, a.mes, a.dia).getTime() - inicioDia(agora).getTime()) / (24 * HORA));
  const quando = meiaNoite ? '' : ` às ${hhmm(a.hora, a.minuto)}`;
  if (dias <= 0) return `${verbo}${quando || ' à meia-noite'}`;
  if (dias === 1 && !meiaNoite) return `${verbo} amanhã${quando}`;
  if (dias <= 7 && !(meiaNoite && a.dia === 1)) return `${verbo} ${DIAS[a.diaSemana]}${quando}`;
  return `${verbo} dia ${a.dia === 1 ? '1º' : a.dia}/${String(a.mes).padStart(2, '0')}${quando}`;
}
const inicioDia = (d: Date) => {
  const p = partesBahia(d);
  return bahia(p.ano, p.mes, p.dia);
};

export interface OpcoesPlanos {
  armazem: ArmazemPlanos;
  config?: ConfigPlanos;
  /** Empresas que entram no plano Fundador quando não têm assinatura gravada (a conta original). */
  fundadoras?: string[];
  log?: (msg: string, extra?: unknown) => void;
}

const SEMPRE = new Date(0);
const NUNCA = new Date(Date.UTC(9999, 0, 1));

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

  /** Assinatura gravada, ou a padrão: Fundador para a conta original, Essencial para as outras. */
  async assinatura(empresaId: string): Promise<Assinatura> {
    const a = await this.armazem.assinatura(empresaId);
    if (a) return { ...a, plano: normalizarPlano(a.plano) };
    return { empresaId, plano: this.fundadoras.has(empresaId) ? 'fundador' : 'essencial', status: 'ativa', atualizadaEm: new Date(0), atualizadaPor: null };
  }

  /** Configuração da empresa: a sugerida com os ajustes dela por cima (custo do atendente e limites personalizados). */
  configDe(a: Assinatura): ConfigPlanos {
    return { ...this.base, clt: { ...this.base.clt, ...(a.clt ?? {}) }, limites: { ...this.base.limites, ...(a.limites ?? {}) } };
  }

  plano(a: Assinatura): Plano {
    return planoPorId(this.configDe(a), a.plano);
  }

  /** Limites, uso em cada janela, quando renova e saldo de créditos. */
  async situacao(empresaId: string, agora: Date): Promise<Situacao> {
    const a = await this.assinatura(empresaId);
    const p = this.plano(a);
    const ate = new Date(agora.getTime() + 1);
    const [comprados, usados] = await Promise.all([this.armazem.tokensRecargas(empresaId, SEMPRE, NUNCA), this.armazem.tokensCredito(empresaId)]);
    const creditos = { comprados, usados, saldo: Math.max(0, comprados - usados) };
    if (!p.ia || p.ilimitado || !p.limites) {
      const mes = await this.armazem.tokensPlano(empresaId, inicioDoMes(agora), ate);
      const lim = (id: IdLimite): EstadoLimite => ({ id, nome: NOME_LIMITE[id], limite: p.ilimitado ? null : 0, usados: id === 'mes' ? mes : 0, restantes: p.ilimitado ? null : 0, pct: p.ilimitado ? null : 0, estourou: false, renovaEm: null, texto: p.ilimitado ? 'sem limite' : 'sem IA neste plano' });
      return { assinatura: a, plano: p, ilimitado: Boolean(p.ilimitado), limites: [lim('cincoHoras'), lim('semana'), lim('mes')], creditos, estourou: false, usandoCreditos: false };
    }
    const L = p.limites;
    const [usos5, semana, mes] = await Promise.all([
      this.armazem.usosPlano(empresaId, new Date(agora.getTime() - CINCO_HORAS), ate),
      L.semana === null ? Promise.resolve(0) : this.armazem.tokensPlano(empresaId, inicioDaSemana(agora), ate),
      this.armazem.tokensPlano(empresaId, inicioDoMes(agora), ate),
    ]);
    const em5 = usos5.reduce((s, u) => s + u.tokens, 0);
    const estado = (id: IdLimite, usadosJ: number, renova: Date | null): EstadoLimite => {
      const limite = L[id];
      const estourou = limite !== null && usadosJ >= limite;
      return {
        id,
        nome: NOME_LIMITE[id],
        limite,
        usados: usadosJ,
        restantes: limite === null ? null : Math.max(0, limite - usadosJ),
        pct: limite === null ? null : limite > 0 ? Math.min(100, Math.round((usadosJ / limite) * 1000) / 10) : 100,
        estourou,
        renovaEm: renova ? renova.toISOString() : null,
        texto: limite === null ? 'sem limite' : !renova ? 'sem uso nas últimas 5 horas' : textoQuando(renova, agora, id !== 'cincoHoras' ? 'renova' : estourou ? 'volta' : 'libera espaço'),
      };
    };
    // Janela móvel de 5 h: estourada, volta quando sair da janela o uso que a deixa abaixo do limite;
    // senão, mostra quando o uso mais antigo da janela sai dela.
    let volta5: Date | null = null;
    if (usos5.length) {
      volta5 = new Date(usos5[0]!.em.getTime() + CINCO_HORAS);
      if (L.cincoHoras !== null && em5 >= L.cincoHoras) {
        let resta = em5;
        for (const u of usos5) {
          resta -= u.tokens;
          if (resta < L.cincoHoras) {
            volta5 = new Date(u.em.getTime() + CINCO_HORAS);
            break;
          }
        }
      }
    }
    const limites = [estado('cincoHoras', em5, volta5), estado('semana', semana, fimDaSemana(agora)), estado('mes', mes, fimDoMes(agora))];
    const estourou = limites.some((l) => l.estourou);
    return { assinatura: a, plano: p, ilimitado: false, limites, creditos, estourou, usandoCreditos: estourou && creditos.saldo > 0 };
  }

  /** A empresa pode usar a IA agora? */
  async decidir(empresaId: string, agora: Date): Promise<Decisao> {
    const a = await this.assinatura(empresaId);
    const p = this.plano(a);
    const nao = (motivo: MotivoBloqueio, extra = ''): Decisao => ({ pode: false, motivo, texto: TEXTO_MOTIVO[motivo]! + extra });
    if (a.status !== 'ativa') return nao('suspensa');
    if (p.ilimitado) return { pode: true, ilimitado: true, usandoCreditos: false };
    if (!p.ia) return nao('sem_plano');
    const s = await this.situacao(empresaId, agora);
    if (!s.estourou) return { pode: true, ilimitado: false, usandoCreditos: false };
    if (s.creditos.saldo > 0) return { pode: true, ilimitado: false, usandoCreditos: true };
    const est = s.limites.filter((l) => l.estourou).map((l) => `${l.nome.toLowerCase()}: ${l.texto}`);
    return nao('sem_credito', ` Limite atingido (${est.join('; ')}).`);
  }

  /** Uso do mês (para a tela e o comparativo). */
  async usoDoMes(empresaId: string, agora: Date): Promise<ResumoUso> {
    return this.armazem.resumo(empresaId, inicioDoMes(agora), fimDoMes(agora));
  }

  /**
   * Pagamento confirmado (hoje à mão; no futuro, o webhook do PagamentoProvider): marca o pedido como pago
   * e aplica: recarga soma créditos; mudar_plano troca o plano. Pedidos antigos de adicional só ficam pagos.
   */
  async confirmarPedido(empresaId: string, id: string, agora: Date, por: string | null = null) {
    const p = await this.armazem.marcarPedido(empresaId, id, 'pago', agora);
    if (!p) return null;
    if (p.tipo === 'mudar_plano' && typeof p.dados.plano === 'string') {
      const a = await this.assinatura(empresaId);
      await this.armazem.gravarAssinatura({ ...a, plano: normalizarPlano(p.dados.plano), status: 'ativa', atualizadaEm: agora, atualizadaPor: por });
    }
    return p;
  }

  /** Registra uma chamada à API. Com algum limite estourado, os tokens saem dos créditos. Nunca lança. */
  async registrarUso(r: { empresaId: string; em: Date; conversaId: string | null; origem: string; modelo: string; uso: Uso }): Promise<void> {
    try {
      const s = await this.situacao(r.empresaId, r.em);
      const tokens = tokensDe(r.uso);
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
        custoUsd: custoUsd(this.configDe(s.assinatura), r.modelo, r.uso),
        // Só o que o saldo cobre sai dos créditos; o resto (corrida entre chamadas) conta no plano e não vira dívida.
        tokensCredito: s.plano.ia && !s.ilimitado && s.estourou ? Math.min(tokens, s.creditos.saldo) : 0,
      });
    } catch (e) {
      this.log('Falha ao registrar o uso da IA', { erro: String(e), tokens: tokensDe(r.uso) });
    }
  }
}
