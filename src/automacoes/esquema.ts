import { z } from 'zod';

/**
 * Formato das automações: um gatilho e uma lista de passos. Tudo em JSON simples, para a tela montar
 * (e para gravar como está no banco). Os nomes dos campos seguem o que a tela usa.
 */

export const UNIDADES_AUTOMACAO = ['norte', 'sumare', 'feira'] as const;
export const MODOS = ['ia', 'copiloto', 'humano'] as const;

const id = z.string().trim().min(1).max(100);

export const Gatilho = z.discriminatedUnion('tipo', [
  /** A conversa entrou nesta etapa (por qualquer caminho: pessoa, IA, motor ou outra automação). */
  z.object({ tipo: z.literal('entrou_na_etapa'), etapaId: id }),
  /** A conversa está parada nesta etapa há `horas` (uma vez por estadia na etapa). */
  z.object({ tipo: z.literal('parada_na_etapa'), etapaId: id, horas: z.number().min(1).max(24 * 60) }),
  /** Primeira mensagem de uma cliente (opcional: só de uma unidade). */
  z.object({ tipo: z.literal('nova_conversa'), unidade: z.enum(UNIDADES_AUTOMACAO).optional() }),
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
  | { tipo: 'atribuir'; usuarioId: string | null; unidade?: (typeof UNIDADES_AUTOMACAO)[number] }
  | { tipo: 'lembrete_ligacao'; em_minutos: number; texto?: string }
  | { tipo: 'enviar_email'; modeloId: string }
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
    z.object({ tipo: z.literal('atribuir'), usuarioId: id.nullable(), unidade: z.enum(UNIDADES_AUTOMACAO).optional() }),
    /** Aparece em "Ligar hoje" a partir do dia em que vence (até 6 dias à frente). */
    z.object({ tipo: z.literal('lembrete_ligacao'), em_minutos: z.number().int().min(0).max(6 * 24 * 60), texto: z.string().trim().min(1).max(200).optional() }),
    /** E-mail marketing: manda o modelo salvo para o e-mail da ficha (entra na fila, com ritmo e descadastro). */
    z.object({ tipo: z.literal('enviar_email'), modeloId: id }),
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

/** Troca {primeiro_nome} {nome} {unidade} {atendente} no texto. */
export function preencher(texto: string, v: { nome?: string; unidade: string; atendente?: string }): string {
  const nome = v.nome?.trim() || '';
  const primeiro = nome.split(/\s+/)[0] ?? '';
  return texto
    .replace(/\{primeiro_nome\}/g, primeiro)
    .replace(/\{nome\}/g, nome)
    .replace(/\{unidade\}/g, v.unidade)
    .replace(/\{atendente\}/g, v.atendente?.trim() || 'nossa equipe')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
