import type { DadosDesempenho, Desempenho } from '../desempenho/calculo.js';

/**
 * calculadora: "Quanto a IA economiza" (visão da gestão, aba da Inteligência). Função pura.
 *
 * Números reais vêm do Desempenho (src/desempenho): mensagens e conversas que a IA respondeu, agendamentos e valor
 * da IA, 1ª resposta da IA e da equipe e quantas respostas da IA saíram com a unidade fechada.
 * O custo de uma pessoa (salário, encargos, benefícios, jornada) e o tempo que uma pessoa leva por mensagem são
 * da empresa (a gestão ajusta na tela).
 *
 * Fórmulas:
 * - custo de uma pessoa por mês = salário × (1 + encargos%) + benefícios;
 * - horas de uma pessoa por mês = jornada semanal × 52 ÷ 12; custo da hora = custo por mês ÷ horas por mês;
 * - horas que a IA poupou = mensagens da IA × minutos por mensagem ÷ 60; valem horas × custo da hora;
 * - custo da IA no período = custo da IA por mês × dias ÷ 30; saldo = valor das horas − custo da IA;
 * - equivale a = horas poupadas ÷ horas de uma pessoa no período (dias ÷ 30 de um mês);
 * - atender 24 h com gente = ⌈168 ÷ jornada⌉ pessoas × custo de uma pessoa (a IA cobre as 168 h da semana).
 */

export interface CustoEquipe {
  /** Salário bruto médio de quem atende (R$/mês). */
  salario: number;
  /** Encargos e provisões (INSS patronal, FGTS, 13º, férias...) em % do salário. */
  encargosPct: number;
  /** Benefícios por pessoa (R$/mês): vale-transporte, refeição... */
  beneficios: number;
  /** Jornada semanal (h). Com o fim da escala 6x1 (EC 141/2026): 44 → 42 → 40 h. */
  horasSemana: number;
  /** Quanto tempo uma pessoa leva, em média, para ler e responder uma mensagem (min). */
  minutosPorMensagem: number;
  /** Quanto a empresa paga pela IA por mês (R$). */
  custoIaMes: number;
}

export const CUSTO_PADRAO: CustoEquipe = { salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 40, minutosPorMensagem: 2, custoIaMes: 1997 };

export interface UsoReal {
  dias: number;
  mensagensIa: number;
  conversasIa: number;
  /** Mensagens da IA enviadas com a unidade da conversa fechada (noite, domingo, feriado). */
  foraDoHorarioIa: number;
  agendamentosIa: number;
  valorIa: number;
  respostaIaMs: number | null;
  respostaEquipeMs: number | null;
  mensagensEquipe: number;
}

export interface Economia {
  dias: number;
  custo: CustoEquipe;
  pessoa: { mes: number; hora: number; horasMes: number };
  real: UsoReal;
  /** Horas de trabalho que a IA poupou no período. */
  horasPoupadas: number;
  valorHoras: number;
  custoIaPeriodo: number;
  /** Valor das horas − custo da IA no período (negativo = ainda não compensou). */
  saldoPeriodo: number;
  /** O saldo levado para 30 dias. */
  saldoMes: number;
  /** Quantas pessoas trabalhando a jornada inteira dariam conta do que a IA fez. */
  pessoasEquivalentes: number;
  /** Atender 24 h, 7 dias com gente × com a IA (por mês). */
  cobertura24h: { pessoas: number; custoMes: number; custoIaMes: number; economiaMes: number };
  respostaVezesMaisRapida: number | null;
  /** Há números reais suficientes (a IA respondeu alguma mensagem no período)? */
  temDados: boolean;
}

const c2 = (n: number) => Math.round(n * 100) / 100;
const c1 = (n: number) => Math.round(n * 10) / 10;

export function custoPessoaMes(c: Pick<CustoEquipe, 'salario' | 'encargosPct' | 'beneficios'>): number {
  return c2(c.salario * (1 + c.encargosPct / 100) + c.beneficios);
}

export function calcularEconomia(real: UsoReal, custo: CustoEquipe): Economia {
  const dias = Math.max(1, real.dias);
  const mes = custoPessoaMes(custo);
  const horasMes = (custo.horasSemana * 52) / 12;
  const hora = horasMes > 0 ? mes / horasMes : 0;
  const horasPoupadas = c1((real.mensagensIa * custo.minutosPorMensagem) / 60);
  const valorHoras = c2(horasPoupadas * hora);
  const custoIaPeriodo = c2((custo.custoIaMes * dias) / 30);
  const saldoPeriodo = c2(valorHoras - custoIaPeriodo);
  const horasPessoaPeriodo = (horasMes * dias) / 30;
  const pessoas24h = custo.horasSemana > 0 ? Math.ceil(168 / custo.horasSemana) : 0;
  return {
    dias,
    custo,
    pessoa: { mes, hora: c2(hora), horasMes: c1(horasMes) },
    real,
    horasPoupadas,
    valorHoras,
    custoIaPeriodo,
    saldoPeriodo,
    saldoMes: c2((saldoPeriodo * 30) / dias),
    pessoasEquivalentes: horasPessoaPeriodo > 0 ? c1(horasPoupadas / horasPessoaPeriodo) : 0,
    cobertura24h: { pessoas: pessoas24h, custoMes: c2(pessoas24h * mes), custoIaMes: c2(custo.custoIaMes), economiaMes: c2(pessoas24h * mes - custo.custoIaMes) },
    respostaVezesMaisRapida: real.respostaIaMs && real.respostaEquipeMs ? c1(real.respostaEquipeMs / real.respostaIaMs) : null,
    temDados: real.mensagensIa > 0,
  };
}

/**
 * Uso real da IA no período a partir do Desempenho já calculado e dos dados crus.
 * `aberta(unidade, em)`: a unidade estava aberta naquele instante? null = a unidade não tem horário (não conta).
 */
export function usoRealDoDesempenho(
  d: Desempenho,
  dados: DadosDesempenho,
  inicio: Date,
  fim: Date,
  dias: number,
  aberta: (unidade: string, em: Date) => boolean | null,
): UsoReal {
  const conversas = new Set<string>();
  let mensagens = 0;
  let fora = 0;
  for (const m of dados.mensagens) {
    if (m.autor !== 'ia' || m.em < inicio || m.em >= fim) continue;
    mensagens++;
    conversas.add(m.conversaId);
    const unidade = dados.conversas.get(m.conversaId)?.unidade;
    if (unidade && aberta(unidade, m.em) === false) fora++;
  }
  return {
    dias,
    mensagensIa: mensagens,
    conversasIa: conversas.size,
    foraDoHorarioIa: fora,
    agendamentosIa: d.iaEquipe.ia.agendamentos,
    valorIa: d.iaEquipe.ia.valor,
    respostaIaMs: d.iaEquipe.ia.primeiraMediaMs,
    respostaEquipeMs: d.iaEquipe.equipe.primeiraMediaMs,
    mensagensEquipe: d.iaEquipe.equipe.mensagens,
  };
}
