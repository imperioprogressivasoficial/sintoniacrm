import { z } from 'zod';
import { ETAPAS } from '../domain.js';

/**
 * Formato das transmissões (disparo em massa). Tudo em JSON simples: a tela monta, o banco guarda como está.
 * Nomes dos campos seguem a tela.
 */

export const UNIDADES_TRANSMISSAO = ['norte', 'sumare'] as const;
export type UnidadeTransmissao = (typeof UNIDADES_TRANSMISSAO)[number];
export const CANAIS = ['oficial', 'nao_oficial'] as const;
export type CanalTransmissao = (typeof CANAIS)[number];

export const STATUS_CAMPANHA = ['rascunho', 'aguardando_modelo', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada'] as const;
export type StatusCampanha = (typeof STATUS_CAMPANHA)[number];
export const STATUS_DESTINO = ['fila', 'enviando', 'enviada', 'entregue', 'lida', 'respondeu', 'falhou', 'descadastrou', 'pulada'] as const;
export type StatusDestino = (typeof STATUS_DESTINO)[number];

const id = z.string().trim().min(1).max(100);

/** Quem recebe. Tags = "qualquer uma delas" (ou todas); etapas de funil também são tags. */
export const Publico = z.object({
  tags: z.array(id).max(20).default([]),
  tagsTodas: z.boolean().default(false),
  semTags: z.array(id).max(20).default([]),
  /** Etapas do funil do sistema (novo_lead, agendada...). Vazio = todas. */
  etapas: z.array(z.enum(ETAPAS)).max(ETAPAS.length).default([]),
  /** Quantas pessoas (null = todas as que passam no filtro). */
  quantidade: z.number().int().min(1).max(100_000).nullable().default(null),
  /** Quando há mais gente que a quantidade: sorteio ou quem falou com a loja por último. */
  ordem: z.enum(['aleatorio', 'recentes']).default('recentes'),
  /** Fora quem recebeu qualquer transmissão nos últimos N dias (0 = não exclui). */
  excluirRecebeuDias: z.number().int().min(0).max(365).default(7),
  /** Fora quem está conversando com a loja agora (mensagem nas últimas 24 h). */
  excluirConversaAberta: z.boolean().default(true),
});
export type Publico = z.infer<typeof Publico>;

/** De onde vem cada variável: campo da ficha ou texto fixo. `padrao` entra quando o campo está vazio. */
export const Variavel = z.object({
  fonte: z.string().trim().min(1).max(120),
  padrao: z.string().trim().max(60).default(''),
});
export type Variavel = z.infer<typeof Variavel>;

export const ModeloEscolhido = z.object({
  nome: z.string().trim().min(1).max(512),
  idioma: z.string().trim().min(2).max(10).default('pt_BR'),
  corpo: z.string().max(1100).default(''),
  /** Cabeçalho do modelo: TEXT, IMAGE... (IMAGE pede a imagem da campanha). */
  cabecalho: z.string().max(20).optional(),
});

export const Mensagem = z.object({
  /** API não oficial: texto com {primeiro_nome}, {nome}, {unidade}, {campo:Nome} e variações {Oi|Olá}. */
  texto: z.string().max(4000).default(''),
  /** API oficial: modelo aprovado e o que vai em cada {{1}}, {{2}}... */
  modelo: ModeloEscolhido.nullable().default(null),
  variaveis: z.array(Variavel).max(20).default([]),
});
export type Mensagem = z.infer<typeof Mensagem>;

/** Gatilho das transmissões automáticas: cada pessoa entra uma vez (no aniversário, uma vez por ano). */
export const GatilhoTransmissao = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('entrou_na_etapa'), etapaId: id }),
  z.object({ tipo: z.literal('tag_marcada'), tagId: id }),
  z.object({ tipo: z.literal('aniversario') }),
  z.object({ tipo: z.literal('dias_apos_compareceu'), dias: z.number().int().min(1).max(365) }),
]);
export type GatilhoTransmissao = z.infer<typeof GatilhoTransmissao>;

/** Ritmo e janela. Padrões seguros: oficial ~20/min; não oficial 8–25 s entre envios, pausa de 5 min a cada 30. */
export const Envio = z.object({
  /** Janela de horário permitido (hora da Bahia): de `inicio` até antes de `fim`. */
  janelaInicio: z.number().int().min(0).max(23).default(8),
  janelaFim: z.number().int().min(1).max(24).default(20),
  /** Também aos domingos? */
  domingo: z.boolean().default(false),
  /** API oficial: mensagens por minuto. */
  porMinuto: z.number().int().min(1).max(600).default(20),
  /** API não oficial: intervalo aleatório entre envios (segundos). */
  intervaloMin: z.number().int().min(3).max(600).default(8),
  intervaloMax: z.number().int().min(3).max(1200).default(25),
  /** Pausa de `pausaMin` minutos a cada `pausaCada` mensagens (0 = sem pausa). */
  pausaCada: z.number().int().min(0).max(1000).default(30),
  pausaMin: z.number().int().min(0).max(240).default(5),
  /** Teto por número por dia (todas as transmissões somadas). */
  limiteDia: z.number().int().min(1).max(100_000).default(200),
  gatilho: GatilhoTransmissao.nullable().default(null),
});
export type Envio = z.infer<typeof Envio>;

export const CampanhaNova = z.object({
  nome: z.string().trim().min(1).max(80),
  unidade: z.enum(UNIDADES_TRANSMISSAO),
  canal: z.enum(CANAIS),
  modo: z.enum(['manual', 'automatico']).default('manual'),
  publico: Publico.default(Publico.parse({})),
  mensagem: Mensagem.default(Mensagem.parse({})),
  envio: Envio.default(Envio.parse({})),
});
export type CampanhaNova = z.infer<typeof CampanhaNova>;

export const CampanhaAlteracao = CampanhaNova.partial();

/** Limites recomendados, para a tela mostrar e para os padrões. */
export const LIMITES = {
  oficial: {
    porMinuto: 20,
    limiteDia: 1000,
    texto:
      'API oficial: o limite é o "tier" do número na Meta (começa em 1.000 conversas iniciadas por dia e sobe com boa qualidade). Use só modelos aprovados; ~20 por minuto é seguro. Se muita gente bloquear ou denunciar, a qualidade cai e o limite diminui.',
  },
  nao_oficial: {
    intervaloMin: 8,
    intervaloMax: 25,
    pausaCada: 30,
    pausaMin: 5,
    limiteDia: 200,
    texto:
      'API não oficial (QR Code): o WhatsApp pode BLOQUEAR o número se perceber disparo em massa. Envie só para quem já conhece a loja, devagar (8–25 s entre mensagens, pausa a cada 30), no máximo ~200 por dia num número aquecido (comece com 50), com variações de texto e sempre com a opção de sair.',
  },
} as const;
