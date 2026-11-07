import type { DadosDesempenho, Desempenho } from '../desempenho/calculo.js';
import { custoMensalClt, type CustoClt } from './catalogo.js';

/**
 * Comparativo IA × atendente humano (função pura). Os números de atendimento vêm do Desempenho
 * (src/desempenho): conversas, agendamentos e 1ª resposta da IA e da equipe no mesmo período.
 *
 * Fórmulas (docs/PLANOS.md):
 * - custo do período = custo mensal × dias / 30 (equipe: custo de 1 CLT × atendentes ativas no período, mínimo 1);
 * - custo por agendamento = custo do período ÷ agendamentos; custo por conversa idem;
 * - horas cobertas por semana: IA = janela do plano (168 h com o adicional); equipe = 44 h × atendentes;
 * - economia estimada por mês = (CLTs necessários para cobrir as horas da IA × custo CLT) − preço do plano.
 */

export interface LadoEntrada {
  conversas: number;
  agendamentos: number;
  /** Média da 1ª resposta (ms). */
  respostaMs: number | null;
}

export interface EntradaComparativo {
  dias: number;
  clt: CustoClt;
  /** Preço mensal do plano da IA (R$), com o adicional se houver. */
  precoIaMensal: number;
  /** Horas por semana que a IA cobre (janela do plano). */
  horasIaSemana: number;
  /** Custo estimado da API no período (R$), só informativo. */
  custoApiPeriodo: number;
  ia: LadoEntrada;
  equipe: LadoEntrada & { atendentes: number };
}

export interface Lado {
  custoPeriodo: number;
  custoMensal: number;
  conversas: number;
  agendamentos: number;
  respostaMs: number | null;
  custoPorAgendamento: number | null;
  custoPorConversa: number | null;
  horasSemana: number;
}

export interface Comparativo {
  dias: number;
  custoCltMensal: number;
  ia: Lado;
  equipe: Lado & { atendentes: number };
  /** Quantos atendentes CLT seriam precisos para cobrir as horas da IA. */
  cltsEquivalentes: number;
  economiaMensal: number;
  /** IA mais barata por agendamento? null sem agendamentos de um dos lados. */
  iaMaisBarataPorAgendamento: boolean | null;
  respostaVezesMaisRapida: number | null;
  custoApiPeriodo: number;
}

const c2 = (n: number) => Math.round(n * 100) / 100;
const por = (custo: number, n: number) => (n > 0 ? c2(custo / n) : null);

export function calcularComparativo(e: EntradaComparativo): Comparativo {
  const custoClt = custoMensalClt(e.clt);
  const fator = e.dias / 30;
  const atendentes = Math.max(1, e.equipe.atendentes);
  const iaPer = c2(e.precoIaMensal * fator);
  const eqMensal = c2(custoClt * atendentes);
  const eqPer = c2(eqMensal * fator);
  const ia: Lado = {
    custoPeriodo: iaPer,
    custoMensal: c2(e.precoIaMensal),
    conversas: e.ia.conversas,
    agendamentos: e.ia.agendamentos,
    respostaMs: e.ia.respostaMs,
    custoPorAgendamento: por(iaPer, e.ia.agendamentos),
    custoPorConversa: por(iaPer, e.ia.conversas),
    horasSemana: e.horasIaSemana,
  };
  const equipe = {
    custoPeriodo: eqPer,
    custoMensal: eqMensal,
    conversas: e.equipe.conversas,
    agendamentos: e.equipe.agendamentos,
    respostaMs: e.equipe.respostaMs,
    custoPorAgendamento: por(eqPer, e.equipe.agendamentos),
    custoPorConversa: por(eqPer, e.equipe.conversas),
    horasSemana: c2(e.clt.horasSemana * atendentes),
    atendentes,
  };
  const cltsEquivalentes = e.clt.horasSemana > 0 ? Math.round((e.horasIaSemana / e.clt.horasSemana) * 10) / 10 : 0;
  return {
    dias: e.dias,
    custoCltMensal: custoClt,
    ia,
    equipe,
    cltsEquivalentes,
    economiaMensal: c2(cltsEquivalentes * custoClt - e.precoIaMensal),
    iaMaisBarataPorAgendamento: ia.custoPorAgendamento !== null && equipe.custoPorAgendamento !== null ? ia.custoPorAgendamento < equipe.custoPorAgendamento : null,
    respostaVezesMaisRapida: ia.respostaMs && equipe.respostaMs ? Math.round((equipe.respostaMs / ia.respostaMs) * 10) / 10 : null,
    custoApiPeriodo: c2(e.custoApiPeriodo),
  };
}

/** IA × equipe a partir do Desempenho já calculado e dos dados crus (conversas distintas de cada lado). */
export function ladosDoDesempenho(d: Desempenho, dados: DadosDesempenho, inicio: Date, fim: Date): { ia: LadoEntrada; equipe: LadoEntrada & { atendentes: number } } {
  const ia = new Set<string>();
  const eq = new Set<string>();
  for (const m of dados.mensagens) {
    if (m.em < inicio || m.em >= fim) continue;
    if (m.autor === 'ia') ia.add(m.conversaId);
    if (m.autor === 'equipe') eq.add(m.conversaId);
  }
  return {
    ia: { conversas: ia.size, agendamentos: d.iaEquipe.ia.agendamentos, respostaMs: d.iaEquipe.ia.primeiraMediaMs },
    equipe: { conversas: eq.size, agendamentos: d.iaEquipe.equipe.agendamentos, respostaMs: d.iaEquipe.equipe.primeiraMediaMs, atendentes: d.atendentes.filter((a) => a.conversas > 0 || a.mensagens > 0).length },
  };
}
