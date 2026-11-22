import { z } from 'zod';
import { MOTIVOS_FINALIZACAO } from '../nps/tipos.js';
import { zIdUnidade } from '../unidades.js';

/**
 * Formato das automações: um gatilho e uma lista de passos. Tudo em JSON simples, para a tela montar
 * (e para gravar como está no banco). Os nomes dos campos seguem o que a tela usa.
 */

/** Unidade de um gatilho/ação: id do cadastro (Empresa › Unidades); aqui só o formato, o fluxo fica guardado. */
const UnidadeAuto = zIdUnidade();
export const MODOS = ['ia', 'copiloto', 'humano'] as const;
/** automacao-vendas: de quem é a vez de responder no gatilho "sem resposta". */
export const QUEM_SEM_RESPOSTA = ['equipe', 'cliente'] as const;
/** automacao-vendas: "qualquer" = feito de qualquer jeito (IA, equipe ou link online); "confirmou" = a cliente confirmou. */
export const QUANDO_AGENDOU = ['qualquer', 'ia', 'equipe', 'online', 'confirmou'] as const;
export type QuandoAgendou = (typeof QUANDO_AGENDOU)[number];

const id = z.string().trim().min(1).max(100);
/** etapa-entrada: prioridade da tarefa criada por automação (igual à da Rotina). */
export const PRIORIDADES = ['baixa', 'normal', 'alta'] as const;

export const Gatilho = z.discriminatedUnion('tipo', [
  /** A conversa entrou nesta etapa (por qualquer caminho: pessoa, IA, motor ou outra automação). */
  z.object({ tipo: z.literal('entrou_na_etapa'), etapaId: id }),
  /** A conversa está parada nesta etapa há `horas` (uma vez por estadia na etapa). */
  z.object({ tipo: z.literal('parada_na_etapa'), etapaId: id, horas: z.number().min(1).max(24 * 60) }),
  /** Primeira mensagem de uma cliente (opcional: só de uma unidade). */
  z.object({ tipo: z.literal('nova_conversa'), unidade: UnidadeAuto.optional() }),
  /** O "bot": mensagem da cliente que contém (ou é exatamente) uma das palavras. Só mensagens de cliente. */
  z.object({
    tipo: z.literal('palavra_chave'),
    palavras: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
    modo: z.enum(['contem', 'exata']).default('contem'),
  }),
  /** Uma tag foi marcada na conversa (solta ou etapa). */
  z.object({ tipo: z.literal('tag_marcada'), tagId: id }),
  /** Dia do aniversário da cliente (data de nascimento da ficha). Uma vez por ano. */
  z.object({ tipo: z.literal('aniversario') }),
  /** `dias` depois de a conversa entrar na etapa "Compareceu" (uma vez por comparecimento). */
  z.object({ tipo: z.literal('dias_apos_compareceu'), dias: z.number().int().min(0).max(365) }),
  /** Alguém finalizou o atendimento (opcional: só com estes motivos; vazio = qualquer motivo). */
  z.object({ tipo: z.literal('atendimento_finalizado'), motivos: z.array(z.enum(MOTIVOS_FINALIZACAO)).max(MOTIVOS_FINALIZACAO.length).default([]) }),
  /** A cliente respondeu a pesquisa de satisfação com uma nota entre `min` e `max` (0 a 10). */
  z.object({ tipo: z.literal('nota_nps'), min: z.number().int().min(0).max(10).default(0), max: z.number().int().min(0).max(10).default(10) }),
  /*
   * automacao-vendas: gatilhos que faltavam (auditoria, item 17).
   * sem_resposta: quem = 'equipe' → a cliente escreveu e a loja (equipe ou IA) não respondeu há `minutos`;
   * quem = 'cliente' → a loja escreveu e a cliente não responde há `minutos`. Uma vez por silêncio da cliente
   * (a próxima mensagem dela recomeça), e só para esperas que começaram depois de a automação ser criada.
   */
  z.object({ tipo: z.literal('sem_resposta'), quem: z.enum(QUEM_SEM_RESPOSTA), minutos: z.number().int().min(5).max(60 * 24 * 30) }),
  /** Agendamento feito (pela IA, pela equipe ou pelo link de agendamento online) ou a cliente confirmou o horário. */
  z.object({ tipo: z.literal('agendou'), quando: z.enum(QUANDO_AGENDOU).default('qualquer') }),
  /** Qualquer mensagem da cliente (opcional: só de uma unidade). */
  z.object({ tipo: z.literal('mensagem_recebida'), unidade: UnidadeAuto.optional() }),
]);
export type Gatilho = z.infer<typeof Gatilho>;

/** Até onde uma condição pode ter condição dentro. */
export const PROFUNDIDADE_CONDICAO = 3;
/** Passos no total (contando os de dentro das condições). */
export const LIMITE_PASSOS = 40;

export type Passo =
  | { tipo: 'enviar_mensagem'; texto: string; so_no_horario: boolean }
  | { tipo: 'esperar'; minutos: number }
  | { tipo: 'mudar_modo'; modo: (typeof MODOS)[number] }
  | { tipo: 'fluxo_ia'; objetivo: string; dias: number }
  | { tipo: 'mover_etapa'; funilId: string; etapaId: string }
  | { tipo: 'marcar_tag'; tagId: string }
  | { tipo: 'desmarcar_tag'; tagId: string }
  | { tipo: 'atribuir'; usuarioId: string | null; unidade?: string }
  | { tipo: 'lembrete_ligacao'; em_minutos: number; texto?: string }
  | { tipo: 'enviar_transmissao'; transmissaoId: string }
  | { tipo: 'enviar_email'; modeloId: string }
  /* etapa-entrada: passos que usam o que já existe (Rotina, Rodízio, Pesquisa de satisfação). */
  | { tipo: 'criar_tarefa'; titulo: string; em_minutos: number; prioridade: (typeof PRIORIDADES)[number] }
  | { tipo: 'distribuir_rodizio' }
  | { tipo: 'pesquisa_nps' }
  | {
      tipo: 'condicao';
      se: 'cliente_respondeu' | 'tem_tag' | 'modo' | 'horario_loja';
      valor?: string;
      entao: Passo[];
      senao: Passo[];
    };

export const Passo: z.ZodType<Passo, unknown> = z.lazy(() =>
  z.discriminatedUnion('tipo', [
    /** Variáveis: {primeiro_nome} {nome} {unidade} {atendente}. so_no_horario (padrão true): fora do horário da loja, espera a abertura. */
    z.object({ tipo: z.literal('enviar_mensagem'), texto: z.string().trim().min(1).max(1000), so_no_horario: z.boolean().default(true) }),
    z.object({ tipo: z.literal('esperar'), minutos: z.number().int().min(1).max(60 * 24 * 30) }),
    z.object({ tipo: z.literal('mudar_modo'), modo: z.enum(MODOS) }),
    /** Põe a conversa com a IA e passa o objetivo como instrução extra (vale por `dias`, padrão 7, enquanto estiver com a IA). */
    z.object({ tipo: z.literal('fluxo_ia'), objetivo: z.string().trim().min(3).max(1000), dias: z.number().int().min(1).max(30).default(7) }),
    z.object({ tipo: z.literal('mover_etapa'), funilId: id, etapaId: id }),
    z.object({ tipo: z.literal('marcar_tag'), tagId: id }),
    z.object({ tipo: z.literal('desmarcar_tag'), tagId: id }),
    /** usuarioId null = deixa sem dona. Com `unidade`, só vale para conversas dessa unidade (nas outras o passo é pulado). */
    z.object({ tipo: z.literal('atribuir'), usuarioId: id.nullable(), unidade: UnidadeAuto.optional() }),
    /** Aparece em "Ligar hoje" a partir do dia em que vence (até 6 dias à frente). */
    z.object({ tipo: z.literal('lembrete_ligacao'), em_minutos: z.number().int().min(0).max(6 * 24 * 60), texto: z.string().trim().min(1).max(200).optional() }),
    /** Põe a conversa numa transmissão automática ligada (src/transmissoes): sai pela fila, com ritmo, modelo e opt-out. */
    z.object({ tipo: z.literal('enviar_transmissao'), transmissaoId: id }),
    /** E-mail marketing: manda o modelo salvo para o e-mail da ficha (entra na fila, com ritmo e descadastro). */
    z.object({ tipo: z.literal('enviar_email'), modeloId: id }),
    /** etapa-entrada: tarefa para a equipe (Agenda › Rotina), para a dona da conversa (sem dona: a gestão). Prazo em minutos. */
    z.object({ tipo: z.literal('criar_tarefa'), titulo: z.string().trim().min(2).max(120), em_minutos: z.number().int().min(0).max(30 * 24 * 60).default(0), prioridade: z.enum(PRIORIDADES).default('normal') }),
    /** etapa-entrada: passa a conversa para a próxima pessoa do rodízio de leads da unidade (Atendimento › Rodízio precisa estar ligado). */
    z.object({ tipo: z.literal('distribuir_rodizio') }),
    /** etapa-entrada: manda a pergunta da pesquisa de satisfação (Automações › Pesquisa de satisfação precisa estar ligada). */
    z.object({ tipo: z.literal('pesquisa_nps') }),
    z.object({
      tipo: z.literal('condicao'),
      se: z.enum(['cliente_respondeu', 'tem_tag', 'modo', 'horario_loja']),
      valor: z.string().trim().min(1).max(100).optional(),
      entao: z.array(Passo).max(LIMITE_PASSOS).default([]),
      senao: z.array(Passo).max(LIMITE_PASSOS).default([]),
    }),
  ]),
) as z.ZodType<Passo, unknown>;

export const Opcoes = z
  .object({
    /** Se alguém da equipe responder, as execuções desta automação com envio pendente na conversa são canceladas. */
    parar_se_equipe_responder: z.boolean().default(true),
  })
  .default({ parar_se_equipe_responder: true });
export type Opcoes = z.infer<typeof Opcoes>;

export const AutomacaoNova = z.object({
  nome: z.string().trim().min(1).max(80),
  /** null/ausente = automação geral. */
  funilId: id.nullable().optional(),
  ligada: z.boolean().default(false),
  gatilho: Gatilho,
  passos: z.array(Passo).min(1).max(LIMITE_PASSOS),
  opcoes: Opcoes,
});
export type AutomacaoNova = z.infer<typeof AutomacaoNova>;

export const AutomacaoAlteracao = z
  .object({
    nome: z.string().trim().min(1).max(80).optional(),
    funilId: id.nullable().optional(),
    ligada: z.boolean().optional(),
    gatilho: Gatilho.optional(),
    passos: z.array(Passo).min(1).max(LIMITE_PASSOS).optional(),
    opcoes: z.object({ parar_se_equipe_responder: z.boolean().optional() }).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nada para mudar.');

/** Todos os passos, inclusive os de dentro das condições, com a profundidade de cada um. */
export function* percorrer(passos: Passo[], nivel = 0): Generator<{ passo: Passo; nivel: number }> {
  for (const p of passos) {
    yield { passo: p, nivel };
    if (p.tipo === 'condicao') {
      yield* percorrer(p.entao, nivel + 1);
      yield* percorrer(p.senao, nivel + 1);
    }
  }
}

/** Tira acentos, pontuação e espaços repetidos; tudo minúsculo (para comparar palavras-chave). */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A mensagem casa com a palavra-chave? `contem` = a palavra (ou expressão) aparece inteira; `exata` = a mensagem é só ela. */
export function casaPalavra(texto: string, palavras: string[], modo: 'contem' | 'exata'): boolean {
  const t = normalizar(texto);
  if (!t) return false;
  return palavras.some((p) => {
    const alvo = normalizar(p);
    if (!alvo) return false;
    return modo === 'exata' ? t === alvo : ` ${t} `.includes(` ${alvo} `);
  });
}

/**
 * Troca {primeiro_nome} {nome} {unidade} {atendente} no texto. `extras`: outras variáveis da empresa
 * (ex.: {link_avaliacao}, da pesquisa de satisfação).
 */
export function preencher(texto: string, v: { nome?: string; unidade: string; atendente?: string }, extras: Record<string, string> = {}): string {
  const nome = v.nome?.trim() || '';
  const primeiro = nome.split(/\s+/)[0] ?? '';
  for (const [k, valor] of Object.entries(extras)) if (/^[a-z_]{2,40}$/.test(k)) texto = texto.split(`{${k}}`).join(valor);
  return texto
    .replace(/\{primeiro_nome\}/g, primeiro)
    .replace(/\{nome\}/g, nome)
    .replace(/\{unidade\}/g, v.unidade)
    .replace(/\{atendente\}/g, v.atendente?.trim() || 'nossa equipe')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
