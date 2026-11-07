import { z } from 'zod';

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

const Passo = z.object({
  /** Espera depois do passo anterior (ou do começo da cadência), em horas. */
  esperaHoras: z.number().min(0.25).max(24 * 400),
  /** Mensagem com variáveis {nome} {primeiro_nome} {servico} {unidade} {data} {hora}. */
  texto: z.string().trim().max(1500).default(''),
  /** A IA escreve a mensagem com este objetivo (quando há chave da IA; sem chave, vai o texto). */
  ia: z.boolean().default(false),
  objetivo: z.string().trim().max(600).default(''),
  /** Também por e-mail (modelo do E-mail marketing), se a cliente tiver e-mail na ficha. */
  email: z.boolean().default(false),
  emailModeloId: z.string().uuid().nullable().default(null),
});
export type Passo = z.infer<typeof Passo>;

const Cadencia = z.object({
  id: z.enum(SITUACOES),
  ligada: z.boolean().default(false),
  /** A cliente respondeu: para a cadência (no pós-atendimento costuma ficar desligado). */
  pararSeResponder: z.boolean().default(true),
  passos: z.array(Passo).min(1).max(6),
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

/** Modelos prontos (a tela oferece; a configuração inicial nasce deles, tudo desligado). */
export const MODELOS_CADENCIA: Record<Situacao, Omit<Cadencia, 'ligada'>> = {
  sem_resposta: {
    id: 'sem_resposta',
    pararSeResponder: true,
    passos: [
      { esperaHoras: 3, texto: 'Oi, {primeiro_nome}! Conseguiu ver minha mensagem? Fico à disposição para tirar qualquer dúvida 😊', ia: true, objetivo: 'Retomar a conversa com leveza e perguntar se ficou alguma dúvida.', email: false, emailModeloId: null },
      { esperaHoras: h(1), texto: '{primeiro_nome}, ainda pensando no seu cabelo? Temos horários essa semana na {unidade}. Quer que eu veja um para você?', ia: true, objetivo: 'Oferecer ajuda para escolher um horário, sem pressionar.', email: false, emailModeloId: null },
      { esperaHoras: h(3), texto: 'Oi, {primeiro_nome}! Vou deixar sua conversa aqui guardadinha. Quando quiser agendar, é só me chamar 💙', ia: false, objetivo: '', email: false, emailModeloId: null },
    ],
  },
  preco_sem_agendar: {
    id: 'preco_sem_agendar',
    pararSeResponder: true,
    passos: [
      { esperaHoras: 2, texto: '{primeiro_nome}, conseguiu ver os valores? Se quiser, já deixo um horário reservado para você na {unidade} 😉', ia: true, objetivo: 'A cliente pediu preço e não agendou: tirar dúvidas e convidar para agendar.', email: false, emailModeloId: null },
      { esperaHoras: h(1), texto: 'Oi, {primeiro_nome}! Lembrando que a avaliação do fio é gratuita. Quer agendar um horário?', ia: true, objetivo: 'Reforçar o valor do serviço e convidar para agendar.', email: false, emailModeloId: null },
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
      { esperaHoras: h(1), texto: 'Oi, {primeiro_nome}! Como ficou seu cabelo depois do {servico}? Qualquer dúvida sobre os cuidados, é só chamar 💙', ia: false, objetivo: '', email: false, emailModeloId: null },
      { esperaHoras: h(29), texto: '{primeiro_nome}, já faz um mês do seu {servico}! Como está o cabelo? Se quiser, já vejo um horário de hidratação para você.', ia: false, objetivo: '', email: false, emailModeloId: null },
      { esperaHoras: h(30), texto: 'Oi, {primeiro_nome}! Dois meses do seu {servico}. Que tal já reservar sua manutenção na {unidade}?', ia: false, objetivo: '', email: false, emailModeloId: null },
      { esperaHoras: h(30), texto: '{primeiro_nome}, chegou a hora da manutenção do seu {servico} (90 dias) ✨ Quer que eu reserve um horário?', ia: true, objetivo: 'Convidar para a manutenção de 90 dias da progressiva.', email: true, emailModeloId: null },
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

export const TEXTOS_CONFIRMACAO = {
  texto: 'Olá, {primeiro_nome}! Passando para confirmar seu horário de {servico} na {unidade}, {data} às {hora}.\n\nResponda com o número:\n1 - Confirmo\n2 - Preciso remarcar',
  textoLembrete: 'Oi, {primeiro_nome}! Seu horário de {servico} é hoje às {hora} na {unidade}.\n\nResponda:\n1 - Confirmo\n2 - Preciso remarcar',
  textoLembreteConfirmado: 'Oi, {primeiro_nome}! Te esperamos hoje às {hora} na {unidade} para o seu {servico}. Até já 💙',
  textoConfirmado: 'Perfeito, {primeiro_nome}! Seu horário de {data} às {hora} está confirmado ✅ Te esperamos na {unidade}.',
  textoRemarcar: 'Tudo bem, {primeiro_nome}! Já avisei a equipe e logo te chamamos para remarcar 💙',
};

export function configPadrao(): ConfigFollowup {
  return ConfigFollowup.parse({
    cadencias: SITUACOES.map((id) => ({ ...MODELOS_CADENCIA[id], ligada: false })),
    confirmacao: {
      ligada: true,
      unidades: { norte: { ligada: true, horasAntes: [24, 2] }, sumare: { ligada: true, horasAntes: [24, 2] } },
      ...TEXTOS_CONFIRMACAO,
      email: true,
      emailModeloId: null,
      tagRemarcar: 'Quer remarcar',
    },
  });
}

/** Junta o que está gravado com o padrão (cadência que faltar volta desligada, com o modelo pronto). */
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
    .replace(/\{unidade\}/g, (v.unidade ?? '').trim() || 'Império Progressivas')
    .replace(/\{data\}/g, (v.data ?? '').trim())
    .replace(/\{hora\}/g, (v.hora ?? '').trim())
    .replace(/[ \t]+([,.!?])/g, '$1');
}
