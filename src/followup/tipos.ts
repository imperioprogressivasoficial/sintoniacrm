import { z } from 'zod';
import { identidade } from '../empresa/identidade.js';
import { idsUnidades } from '../unidades.js';

/**
 * Follow-up automático (cadências por situação) e confirmação automática de agenda.
 * A configuração é um JSON da empresa (tabela followup_config), validado aqui.
 */

export const SITUACOES = ['sem_resposta', 'preco_sem_agendar', 'faltou', 'pos_atendimento', 'orcamento'] as const;
export type Situacao = (typeof SITUACOES)[number];

export const NOME_SITUACAO: Record<Situacao, string> = {
  sem_resposta: 'Não respondeu',
  preco_sem_agendar: 'Pediu preço e não agendou',
  faltou: 'Faltou ao agendamento',
  pos_atendimento: 'Pós-atendimento e manutenção',
  orcamento: 'Orçamento enviado',
};

/** Quando cada cadência começa (texto da tela). */
export const GATILHO_SITUACAO: Record<Situacao, string> = {
  sem_resposta: 'Começa quando a loja (IA ou equipe) responde e a cliente some.',
  preco_sem_agendar: 'Começa quando a cliente pergunta preço/valor e ainda não agendou.',
  faltou: 'Começa quando a conversa recebe a tag "Faltou".',
  pos_atendimento: 'Começa no fim do horário agendado (conta a partir do atendimento).',
  orcamento: 'Começa quando a conversa recebe a tag "Orçamento".',
};

/** followup-minutos: as esperas valem em minutos (mínimo 1 minuto), horas ou dias. */
export const UNIDADES_ESPERA = ['min', 'h', 'd'] as const;
export type UnidadeEspera = (typeof UNIDADES_ESPERA)[number];
const MIN_HORAS = 1 / 60;
const MAX_HORAS = 24 * 400;

const PassoCampos = z.object({
  /**
   * Espera depois do passo anterior (ou do começo da cadência), em horas (pode ser fração: 5 min = 5/60).
   * followup-minutos: mínimo 1 minuto (antes era 15 min); sempre em minutos inteiros. A entrada também aceita
   * `esperaMinutos` (vira esperaHoras); as configurações antigas (só esperaHoras) continuam valendo igual.
   */
  esperaHoras: z
    .number()
    .min(MIN_HORAS - 1e-9)
    .max(MAX_HORAS)
    .transform((h) => Math.max(1, Math.round(h * 60)) / 60),
  /** followup-minutos: como a tela mostra a espera (minutos, horas ou dias). Sem ela, a tela escolhe pelo número. */
  unidade: z.enum(UNIDADES_ESPERA).optional(),
  /** Mensagem com variáveis {nome} {primeiro_nome} {servico} {unidade} {data} {hora}. */
  texto: z.string().trim().max(1500).default(''),
  /** A IA escreve a mensagem com este objetivo (quando há chave da IA; sem chave, vai o texto). */
  ia: z.boolean().default(false),
  objetivo: z.string().trim().max(600).default(''),
  /** Também por e-mail (modelo do E-mail marketing), se a cliente tiver e-mail na ficha. */
  email: z.boolean().default(false),
  emailModeloId: z.string().uuid().nullable().default(null),
});

const Passo = z.preprocess((bruto) => {
  // followup-minutos: { esperaMinutos: 5 } é o mesmo que { esperaHoras: 5/60 }.
  if (!bruto || typeof bruto !== 'object') return bruto;
  const { esperaMinutos, ...resto } = bruto as Record<string, unknown>;
  if (typeof esperaMinutos === 'number' && Number.isFinite(esperaMinutos)) return { unidade: 'min', ...resto, esperaHoras: esperaMinutos / 60 };
  return resto;
}, PassoCampos);
export type Passo = z.infer<typeof PassoCampos>;

/** followup-minutos: espera do passo em milissegundos (minutos inteiros, no mínimo 1). */
export const esperaMs = (p: Pick<Passo, 'esperaHoras'>): number => Math.max(1, Math.round(p.esperaHoras * 60)) * 60_000;

/**
 * followup-minutos: "toque curto" = espera de menos de 1 hora (ex.: 5 e 15 minutos). Só vale com a conversa quente
 * (a última mensagem da loja é de hoje) e sai no máximo uma vez por dia na mesma conversa.
 */
export const TOQUE_CURTO_MS = 60 * 60_000;
export const ehToqueCurto = (p: Pick<Passo, 'esperaHoras'>): boolean => esperaMs(p) < TOQUE_CURTO_MS;

const Cadencia = z.object({
  id: z.enum(SITUACOES),
  ligada: z.boolean().default(false),
  /** A cliente respondeu: para a cadência (no pós-atendimento costuma ficar desligado). */
  pararSeResponder: z.boolean().default(true),
  /* sem-exemplos: a cadência nasce vazia (a pessoa escreve as mensagens); para ligar, precisa de pelo menos uma (Followup.salvarConfig). */
  passos: z.array(Passo).max(6).default([]),
});
export type Cadencia = z.infer<typeof Cadencia>;

const UnidadeConfirmacao = z.object({
  ligada: z.boolean().default(true),
  /** Horas antes do horário: o primeiro é a confirmação, os outros são lembretes. Ex.: [24, 2]. */
  horasAntes: z.array(z.number().min(0.5).max(24 * 7)).min(1).max(3).default([24, 2]),
});

const Confirmacao = z.object({
  ligada: z.boolean().default(true),
  unidades: z.record(z.string(), UnidadeConfirmacao).default({}),
  texto: z.string().trim().min(1).max(1500),
  textoLembrete: z.string().trim().min(1).max(1500),
  textoLembreteConfirmado: z.string().trim().min(1).max(1500),
  textoConfirmado: z.string().trim().max(800).default(''),
  textoRemarcar: z.string().trim().max(800).default(''),
  email: z.boolean().default(true),
  emailModeloId: z.string().uuid().nullable().default(null),
  /** Tag marcada quando a cliente pede para remarcar (o funil por tags acompanha). */
  tagRemarcar: z.string().trim().min(1).max(30).default('Quer remarcar'),
});
export type ConfigConfirmacao = z.infer<typeof Confirmacao>;

export const ConfigFollowup = z.object({
  cadencias: z.array(Cadencia).default([]),
  confirmacao: Confirmacao,
  /** Máximo de mensagens de follow-up por cliente em 7 dias (todas as cadências somadas). */
  limiteSemana: z.number().int().min(1).max(30).default(4),
  /** Só envia com a unidade aberta (senão espera a próxima abertura). */
  respeitarHorario: z.boolean().default(true),
  /** Para a cadência quando alguém da equipe responde ou assume a conversa. */
  pararQuandoEquipeAssume: z.boolean().default(true),
});
export type ConfigFollowup = z.infer<typeof ConfigFollowup>;

const h = (dias: number) => dias * 24;

/**
 * Modelos de cadência. sem-exemplos (pedido do dono, 21/11): a tela não oferece mais e a configuração inicial
 * NÃO nasce deles (cada cadência começa vazia). Ficam aqui, sem uso na tela, para a futura Ajuda
 * ("Ajuda: um exemplo e o passo a passo"). A migração 670 usa estes textos para reconhecer cadências de exemplo
 * nunca mexidas (test/sem-exemplos.test.ts confere que os dois continuam iguais).
 */
export const MODELOS_CADENCIA: Record<Situacao, Omit<Cadencia, 'ligada'>> = {
  // Régua "sem resposta: 1 dia, 3 dias, 7 dias" (as esperas somam: 1 + 2 + 4 dias). Para quando a cliente responde.
  sem_resposta: {
    id: 'sem_resposta',
    pararSeResponder: true,
    passos: [
      { esperaHoras: h(1), texto: 'Oi, {primeiro_nome}! Conseguiu ver minha mensagem? Fico à disposição para tirar qualquer dúvida 😊', ia: false, objetivo: 'Retomar a conversa com leveza e perguntar se ficou alguma dúvida.', email: false, emailModeloId: null },
      { esperaHoras: h(2), texto: '{primeiro_nome}, passando para saber se ainda posso te ajudar. Se quiser, me conta o que você precisa que eu te ajudo por aqui.', ia: false, objetivo: 'Oferecer ajuda de novo, sem pressionar.', email: false, emailModeloId: null },
      { esperaHoras: h(4), texto: 'Oi, {primeiro_nome}! Vou deixar nossa conversa guardada por aqui. Quando quiser continuar, é só me chamar 💙', ia: false, objetivo: '', email: false, emailModeloId: null },
    ],
  },
  preco_sem_agendar: {
    id: 'preco_sem_agendar',
    pararSeResponder: true,
    passos: [
      { esperaHoras: 2, texto: '{primeiro_nome}, conseguiu ver os valores? Se quiser, já deixo um horário reservado para você 😉', ia: true, objetivo: 'A cliente pediu preço e não agendou: tirar dúvidas e convidar para agendar.', email: false, emailModeloId: null },
      { esperaHoras: h(1), texto: 'Oi, {primeiro_nome}! Ficou alguma dúvida sobre os valores ou o que está incluído? Posso te explicar e já ver um horário.', ia: true, objetivo: 'Reforçar o valor do serviço e convidar para agendar.', email: false, emailModeloId: null },
      { esperaHoras: h(3), texto: '{primeiro_nome}, essa semana ainda tenho alguns horários livres. Posso reservar um para você?', ia: false, objetivo: '', email: false, emailModeloId: null },
    ],
  },
  faltou: {
    id: 'faltou',
    pararSeResponder: true,
    passos: [
      { esperaHoras: 2, texto: 'Oi, {primeiro_nome}! Sentimos sua falta hoje na {unidade}. Aconteceu alguma coisa? Posso remarcar seu horário 💙', ia: true, objetivo: 'A cliente faltou: acolher sem cobrar e oferecer remarcar.', email: false, emailModeloId: null },
      { esperaHoras: h(2), texto: '{primeiro_nome}, vamos remarcar seu {servico}? Me diz o melhor dia que eu vejo os horários.', ia: false, objetivo: '', email: false, emailModeloId: null },
    ],
  },
  pos_atendimento: {
    id: 'pos_atendimento',
    pararSeResponder: false,
    passos: [
      { esperaHoras: h(1), texto: 'Oi, {primeiro_nome}! Como você está depois do {servico}? Qualquer dúvida sobre os cuidados, é só chamar 💙', ia: false, objetivo: '', email: false, emailModeloId: null },
      { esperaHoras: h(29), texto: '{primeiro_nome}, já faz um mês do seu {servico}! Como está tudo? Se quiser, já vejo um horário de manutenção para você.', ia: false, objetivo: '', email: false, emailModeloId: null },
      { esperaHoras: h(30), texto: 'Oi, {primeiro_nome}! Dois meses do seu {servico}. Que tal já reservar sua manutenção na {unidade}?', ia: false, objetivo: '', email: false, emailModeloId: null },
      { esperaHoras: h(30), texto: '{primeiro_nome}, chegou a hora da manutenção do seu {servico} (90 dias) ✨ Quer que eu reserve um horário?', ia: true, objetivo: 'Convidar para a manutenção de 90 dias.', email: true, emailModeloId: null },
    ],
  },
  orcamento: {
    id: 'orcamento',
    pararSeResponder: true,
    passos: [
      { esperaHoras: h(1), texto: 'Oi, {primeiro_nome}! Conseguiu ver o orçamento que te mandei? Posso ajudar em alguma dúvida?', ia: true, objetivo: 'Saber se a cliente viu o orçamento e tirar dúvidas.', email: false, emailModeloId: null },
      { esperaHoras: h(3), texto: '{primeiro_nome}, o orçamento continua de pé! Quer que eu reserve um horário para você?', ia: false, objetivo: '', email: false, emailModeloId: null },
    ],
  },
};

/**
 * followup-minutos (pedido do dono, 28/11): o modelo sugerido de "Não respondeu", em minutos e depois mais espaçado.
 * Nunca nasce sozinho numa empresa nova (sem-exemplos): a tela oferece "Usar modelo sugerido" na cadência vazia,
 * a pessoa vê, edita e salva. A migração 780 aplica este mesmo modelo, ligado, só na Império (quando a cadência
 * dela ainda estava vazia); test/followup-minutos.test.ts confere que os dois continuam iguais.
 * As esperas somam: 5 min, +15 min, +1 dia, +2 dias (a última cai no 3º dia).
 */
export const SUGESTAO_SEM_RESPOSTA: Passo[] = [
  { esperaHoras: 5 / 60, unidade: 'min', texto: 'Oi, ainda está por aí?', ia: false, objetivo: '', email: false, emailModeloId: null },
  { esperaHoras: 15 / 60, unidade: 'min', texto: 'Consegui te ajudar? Se quiser, já deixo seu horário separado.', ia: false, objetivo: '', email: false, emailModeloId: null },
  {
    esperaHoras: 24,
    unidade: 'd',
    texto: 'Oi, {primeiro_nome}! Passando para saber se ainda quer agendar. Se quiser, já vejo os horários para você.',
    ia: true,
    objetivo: 'Retomar a conversa de ontem com leveza: lembrar em uma frase o que ela queria (o serviço, a unidade ou o horário que estava vendo) e perguntar se quer que você reserve. Curta, sem pressionar e sem repetir a mensagem anterior.',
    email: false,
    emailModeloId: null,
  },
  { esperaHoras: 48, unidade: 'd', texto: 'Oi, {primeiro_nome}! Vou deixar nossa conversa guardada por aqui. Quando quiser, é só me chamar que eu vejo um horário para você 💜', ia: false, objetivo: '', email: false, emailModeloId: null },
];

export const TEXTOS_CONFIRMACAO = {
  texto: 'Olá, {primeiro_nome}! Passando para confirmar seu horário de {servico} na {unidade}, {data} às {hora}.\n\nResponda com o número:\n1 - Confirmo\n2 - Preciso remarcar',
  textoLembrete: 'Oi, {primeiro_nome}! Seu horário de {servico} é hoje às {hora} na {unidade}.\n\nResponda:\n1 - Confirmo\n2 - Preciso remarcar',
  textoLembreteConfirmado: 'Oi, {primeiro_nome}! Te esperamos hoje às {hora} na {unidade} para o seu {servico}. Até já 💙',
  textoConfirmado: 'Perfeito, {primeiro_nome}! Seu horário de {data} às {hora} está confirmado ✅ Te esperamos na {unidade}.',
  textoRemarcar: 'Tudo bem, {primeiro_nome}! Já avisei a equipe e logo te chamamos para remarcar 💙',
};

export function configPadrao(): ConfigFollowup {
  return ConfigFollowup.parse({
    // sem-exemplos: cada cadência começa desligada e sem mensagens; a pessoa monta a sua.
    cadencias: SITUACOES.map((id) => ({ id, ligada: false, pararSeResponder: MODELOS_CADENCIA[id].pararSeResponder, passos: [] })),
    confirmacao: {
      ligada: true,
      // Uma por unidade ativa do cadastro (unidade nova sem linha aqui também recebe 24 h e 2 h antes).
      unidades: Object.fromEntries(idsUnidades().map((u) => [u, { ligada: true, horasAntes: [24, 2] }])),
      ...TEXTOS_CONFIRMACAO,
      email: true,
      emailModeloId: null,
      tagRemarcar: 'Quer remarcar',
    },
  });
}

/** Junta o que está gravado com o padrão (cadência que faltar volta desligada e vazia). */
export function normalizarConfig(bruto: unknown): ConfigFollowup {
  const padrao = configPadrao();
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Partial<ConfigFollowup>;
  const cfg = ConfigFollowup.parse({ ...padrao, ...b, confirmacao: { ...padrao.confirmacao, ...(b.confirmacao ?? {}) } });
  const porId = new Map(cfg.cadencias.map((c) => [c.id, c]));
  cfg.cadencias = SITUACOES.map((id) => porId.get(id) ?? padrao.cadencias.find((c) => c.id === id)!);
  return cfg;
}

export type StatusConfirmacao = 'aguardando' | 'confirmado' | 'remarcar' | 'sem_resposta';

export interface Confirmacao {
  agendamento: string;
  conversaId: string;
  unidade: string;
  inicio: Date;
  servico: string | null;
  profissional: string | null;
  status: StatusConfirmacao;
  perguntadoEm: Date | null;
  respondidoEm: Date | null;
  resposta: string | null;
}

export type EstadoEnvio = 'pendente' | 'enviando' | 'enviado' | 'cancelado' | 'pulado' | 'falhou';

export interface EnvioFollowup {
  id: string;
  conversaId: string;
  tipo: 'cadencia' | 'confirmacao';
  /** Id da cadência; 'confirmacao'/'lembrete' na confirmação; 'remarcar_acao' para a ação pós-resposta. */
  situacao: string;
  passo: number;
  total: number;
  chave: string;
  quando: Date;
  estado: EstadoEnvio;
  dados: Record<string, unknown>;
  detalhe?: string | null;
  criadoEm: Date;
  enviadoEm?: Date | null;
}

/** Lê a resposta da cliente à confirmação: 1/sim/confirmo → confirma; 2/remarcar/não → quer remarcar. */
export function lerResposta(texto: string): 'confirmado' | 'remarcar' | null {
  const t = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  if (/^2\b/.test(t) || /\b(remarc\w*|desmarc\w*|reagend\w*|cancel\w*|nao (vou|posso|consigo)|preciso mudar)\b/.test(t) || /^(nao|n)$/.test(t)) return 'remarcar';
  if (/^1\b/.test(t) || /^(sim|s|ok|okay|confirmo|confirmado|confirmada|confirmar|pode confirmar|claro|com certeza|certo|combinado|estarei|vou sim|to indo|estou indo)\b/.test(t) || /\bconfirm\w*\b/.test(t)) return 'confirmado';
  return null;
}

/** Troca as variáveis do texto. */
export function preencher(texto: string, v: Record<string, string | undefined | null>): string {
  const nome = (v.nome ?? '').trim();
  const primeiro = nome.split(/\s+/)[0] || '';
  return texto
    .replace(/\{primeiro_nome\}/g, primeiro || 'tudo bem')
    .replace(/\{nome\}/g, nome || 'cliente')
    .replace(/\{servico\}/g, (v.servico ?? '').trim() || 'atendimento')
    .replace(/\{unidade\}/g, (v.unidade ?? '').trim() || identidade().nome)
    .replace(/\{data\}/g, (v.data ?? '').trim())
    .replace(/\{hora\}/g, (v.hora ?? '').trim())
    .replace(/[ \t]+([,.!?])/g, '$1');
}
