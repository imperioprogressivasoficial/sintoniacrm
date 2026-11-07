/**
 * Modelo de negócio da IA (docs/PLANOS.md):
 * - Essencial: CRM completo SEM IA (grátis no 1º ano, depois R$ 497/mês);
 * - Colaborador de IA: R$ 1.997/mês, IA 24 h com limites de uso no estilo Claude (janela móvel de 5 h, semana e mês).
 *   Estourou qualquer limite, a IA só continua com créditos (recargas);
 * - Empresarial: sob medida (sem preço), limites personalizados na assinatura;
 * - Fundador: a conta original, sem limite e sem cobrança.
 *
 * TODOS os valores abaixo são SUGESTÃO para o dono ajustar (preços, limites, recargas, câmbio, custo do atendente).
 * As fórmulas ficam em funções puras para a tela, o porteiro e os testes usarem as mesmas contas.
 */

/** `gratis` é o id antigo do Essencial (assinaturas gravadas antes da troca de nome). */
export type PlanoId = 'essencial' | 'expediente' | 'empresarial' | 'fundador';
export type PlanoIdGravado = PlanoId | 'gratis';

/** Aceita o id antigo (`gratis`) e devolve o atual. Id desconhecido vira Essencial. */
export function normalizarPlano(id: string | null | undefined): PlanoId {
  if (id === 'gratis') return 'essencial';
  return id === 'expediente' || id === 'empresarial' || id === 'fundador' || id === 'essencial' ? id : 'essencial';
}

/** Custo de um atendente CLT (base do comparativo e da calculadora). SUGESTÃO. */
export interface CustoClt {
  /** Salário bruto mensal (R$). */
  salario: number;
  /** Encargos e provisões sobre o salário (INSS patronal, FGTS, 13º, férias + 1/3, etc.), em %. */
  encargosPct: number;
  /** Benefícios mensais (vale-transporte, refeição...), R$. */
  beneficios: number;
  /** Carga semanal (h). */
  horasSemana: number;
}

/** Preço de API por milhão de tokens, em US$ (tabela da Anthropic, out/2026). */
export interface PrecoModelo {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

/** Limites de uso em tokens. null = sem limite naquela janela. */
export interface Limites {
  /** Janela móvel: tokens nas últimas 5 horas. */
  cincoHoras: number | null;
  /** Semana corrente (segunda 0h a domingo 23h59, horário da Bahia). */
  semana: number | null;
  /** Mês corrente (dia 1º 0h ao fim do mês). */
  mes: number | null;
}

export interface ConfigPlanos {
  clt: CustoClt;
  /** Preço mensal do Colaborador de IA (R$). */
  precoColaborador: number;
  /** Preço do Essencial depois do 1º ano grátis (R$/mês). */
  precoEssencial: number;
  /** Limites do Colaborador de IA. SUGESTÃO. */
  limites: Limites;
  /** Conversas que o plano cobre por mês, em média (calculadora; o limite real é em tokens). */
  conversasPlano: number;
  /** Conversas que cada recarga de R$ 99 cobre, em média (calculadora). */
  conversasPorRecarga: number;
  /** Câmbio usado no custo estimado (R$ por US$). */
  cambio: number;
  precos: Record<string, PrecoModelo>;
  /** Pacotes de créditos (recargas). */
  recargas: Recarga[];
}

export interface Recarga {
  id: string;
  nome: string;
  tokens: number;
  preco: number;
}

export interface Plano {
  id: PlanoId;
  nome: string;
  descricao: string;
  /** O que o plano entrega (lista para a tela). */
  entregas: string[];
  ia: boolean;
  /** Preço mensal (R$); null = sob medida (Empresarial) ou sem cobrança (Fundador). */
  preco: number | null;
  /** Texto do preço para a tela. */
  precoTexto: string;
  /** Limites de uso; null = ilimitado. Essencial: zero (sem IA). */
  limites: Limites | null;
  /** Horas por semana em que a IA trabalha. */
  horasSemana: number;
  /** Meses grátis no início (o 1º ano do Essencial). */
  mesesGratis?: number;
  /** Fundador: IA sem limite, sem cobrança (conta original). */
  ilimitado?: boolean;
  sugestao: boolean;
}

/** Valores iniciais. TODOS SÃO SUGESTÃO: o dono ajusta aqui; limites do Empresarial vão na assinatura. */
export const CONFIG_SUGERIDA: ConfigPlanos = {
  // Jornada: EC 141/2026 (fim da escala 6x1) leva o limite de 44 h para 42 h e, um ano depois, para 40 h, sem reduzir salário.
  clt: { salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 40 },
  precoColaborador: 1997,
  precoEssencial: 497,
  limites: { cincoHoras: 2_500_000, semana: 12_000_000, mes: 40_000_000 },
  conversasPlano: 1500,
  conversasPorRecarga: 190,
  cambio: 5.5,
  precos: {
    'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
    'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
    'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 },
  },
  recargas: [
    { id: 'r5', nome: '+5 milhões de tokens', tokens: 5_000_000, preco: 99 },
    { id: 'r20', nome: '+20 milhões de tokens', tokens: 20_000_000, preco: 349 },
    { id: 'r50', nome: '+50 milhões de tokens', tokens: 50_000_000, preco: 790 },
  ],
};

const centavos = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Custo mensal de um CLT = salário × (1 + encargos) + benefícios. */
export function custoMensalClt(c: Pick<CustoClt, 'salario' | 'encargosPct' | 'beneficios'>): number {
  return centavos(c.salario * (1 + c.encargosPct / 100) + c.beneficios);
}

export function precoColaborador(cfg: ConfigPlanos): number {
  return cfg.precoColaborador;
}

export const SEM_IA: Limites = { cincoHoras: 0, semana: 0, mes: 0 };

export function catalogo(cfg: ConfigPlanos): Plano[] {
  return [
    {
      id: 'essencial',
      nome: 'Essencial',
      descricao: `CRM completo, sem IA: grátis no 1º ano, depois ${brl(cfg.precoEssencial)}/mês.`,
      entregas: ['Usuários, pipelines, leads e clientes ilimitados', 'Chatbot de fluxo (menus, perguntas, etiquetas e etapas)', 'A equipe atende: a IA não conversa nem responde'],
      ia: false,
      preco: cfg.precoEssencial,
      precoTexto: `Grátis no 1º ano, depois ${brl(cfg.precoEssencial)}/mês`,
      mesesGratis: 12,
      limites: SEM_IA,
      horasSemana: 0,
      sugestao: true,
    },
    {
      id: 'expediente',
      nome: 'Colaborador de IA',
      descricao: 'A IA trabalha 24 horas, todos os dias, com limites de uso (5 h, semana e mês). Passou do limite, continua com créditos.',
      entregas: ['Tudo do Essencial', 'Agente de IA atendendo 24 h', 'Copiloto: sugestões de resposta para a equipe', 'Relatórios automáticos de IA', 'IA organizando o CRM (etiquetas, etapas, tarefas)'],
      ia: true,
      preco: precoColaborador(cfg),
      precoTexto: `${brl(precoColaborador(cfg))}/mês`,
      limites: cfg.limites,
      horasSemana: 168,
      sugestao: true,
    },
    {
      id: 'empresarial',
      nome: 'Empresarial',
      descricao: 'Sob medida: vários agentes de IA, limites de uso personalizados para a empresa e acompanhamento próximo.',
      entregas: ['Tudo do Colaborador de IA', 'Vários agentes de IA', 'Limites de uso sob medida', 'Implantação acompanhada'],
      ia: true,
      preco: null,
      precoTexto: 'Sob medida: fale com a gente',
      limites: cfg.limites,
      horasSemana: 168,
      sugestao: true,
    },
    { id: 'fundador', nome: 'Fundador', descricao: 'Conta fundadora: IA sem limite, 24 h, sem cobrança.', entregas: ['Tudo, sem limite de uso'], ia: true, preco: null, precoTexto: 'Sem cobrança', limites: null, horasSemana: 168, ilimitado: true, sugestao: false },
  ];
}

export function planoPorId(cfg: ConfigPlanos, id: string): Plano {
  const n = normalizarPlano(id);
  return catalogo(cfg).find((p) => p.id === n)!;
}

export interface Uso {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

/** Tokens que contam no limite: tudo que a API cobra (entrada, saída e cache). */
export const tokensDe = (u: Uso) => u.entrada + u.saida + u.cacheLeitura + u.cacheEscrita;

/** Custo estimado em US$ = Σ tokens × preço por milhão. Modelo desconhecido usa o preço do Opus (o mais caro da tabela). */
export function custoUsd(cfg: ConfigPlanos, modelo: string, u: Uso): number {
  const p = cfg.precos[modelo] ?? Object.entries(cfg.precos).find(([k]) => modelo.startsWith(k))?.[1] ?? cfg.precos['claude-opus-5-5']!;
  return (u.entrada * p.entrada + u.saida * p.saida + u.cacheLeitura * p.cacheLeitura + u.cacheEscrita * p.cacheEscrita) / 1_000_000;
}

// ------------------------------------------------------------------ calculadora

/** Entradas da calculadora "Quanto custa ter a IA no seu negócio". */
export interface EntradaCalculadora {
  /** Atendentes que a IA cobre (1 a 10). */
  atendentes: number;
  salario: number;
  encargosPct: number;
  beneficios: number;
  conversasMes: number;
  /** Média real de tokens por conversa (medidor). Ausente: usa a média de referência (1.500 por plano, 190 por recarga). */
  tokensPorConversa?: number | null;
}

export interface Calculadora {
  custoFuncionariosMensal: number;
  custoFuncionariosAnual: number;
  /** Conversas que o plano cobre por mês e que cada recarga de R$ 99 cobre. */
  conversasPlano: number;
  conversasPorRecarga: number;
  recargasEstimadas: number;
  creditosEstimadosMensal: number;
  custoIaMensal: number;
  custoIaAnual: number;
  economiaMensal: number;
  economiaAnual: number;
  horasIaSemana: number;
  horasEquipeSemana: number;
  calibrada: boolean;
}

/**
 * Fórmula da calculadora (a mesma da página de vendas):
 * - funcionários = atendentes × (salário × (1 + encargos%) + benefícios); anual = × 12;
 * - créditos estimados = ⌈(conversas − conversas do plano) ÷ conversas por recarga⌉ × R$ 99 (0 se não passar);
 * - Colaborador de IA = R$ 1.997 + créditos estimados; economia = funcionários − IA; horas: 168 × 44 × atendentes.
 * Com a média real de tokens por conversa, conversas do plano = limite mensal ÷ média e por recarga = tokens da recarga ÷ média.
 */
export function calcularCalculadora(e: EntradaCalculadora, cfg: ConfigPlanos = CONFIG_SUGERIDA): Calculadora {
  const atendentes = Math.min(10, Math.max(1, Math.round(e.atendentes || 1)));
  const recarga = cfg.recargas[0]!;
  const tpc = e.tokensPorConversa && e.tokensPorConversa > 0 ? e.tokensPorConversa : null;
  const conversasPlano = tpc && cfg.limites.mes ? Math.max(1, Math.round(cfg.limites.mes / tpc)) : cfg.conversasPlano;
  const conversasPorRecarga = tpc ? Math.max(1, Math.round(recarga.tokens / tpc)) : cfg.conversasPorRecarga;
  const conversas = Math.max(0, e.conversasMes || 0);
  const recargasEstimadas = Math.ceil(Math.max(0, conversas - conversasPlano) / conversasPorRecarga);
  const creditos = centavos(recargasEstimadas * recarga.preco);
  const func = centavos(atendentes * custoMensalClt({ salario: e.salario, encargosPct: e.encargosPct, beneficios: e.beneficios }));
  const ia = centavos(cfg.precoColaborador + creditos);
  return {
    custoFuncionariosMensal: func,
    custoFuncionariosAnual: centavos(func * 12),
    conversasPlano,
    conversasPorRecarga,
    recargasEstimadas,
    creditosEstimadosMensal: creditos,
    custoIaMensal: ia,
    custoIaAnual: centavos(ia * 12),
    economiaMensal: centavos(func - ia),
    economiaAnual: centavos((func - ia) * 12),
    horasIaSemana: 168,
    horasEquipeSemana: cfg.clt.horasSemana * atendentes,
    calibrada: Boolean(tpc),
  };
}
