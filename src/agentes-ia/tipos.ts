import { z } from 'zod';

/**
 * Estúdio de agentes de IA: tipos, validação e padrões.
 * O "jeito Sintonia" de configurar: persona e tom, regras, padrões de resposta, exemplos,
 * conhecimento, memória, ferramentas permitidas e quando passar para a equipe.
 */

export const FERRAMENTAS_AGENTE = ['responder', 'agendar', 'mover_etapa', 'marcar_tag', 'transferir', 'lembrete_ligacao', 'consultar_agenda'] as const;
export type FerramentaAgente = (typeof FERRAMENTAS_AGENTE)[number];

export const NOME_FERRAMENTA: Record<FerramentaAgente, string> = {
  responder: 'Responder a cliente',
  agendar: 'Agendar no Trinks',
  mover_etapa: 'Mover etapa no CRM',
  marcar_tag: 'Marcar tag',
  transferir: 'Transferir para a equipe',
  lembrete_ligacao: 'Criar lembrete de ligação',
  consultar_agenda: 'Consultar agenda e serviços',
};

export const CHAVES_MEMORIA = ['tipo_cabelo', 'comprimento', 'ultima_quimica', 'preferencia_horario', 'objecao', 'gestante', 'unidade_preferida', 'outro'] as const;
export const NOME_MEMORIA: Record<(typeof CHAVES_MEMORIA)[number], string> = {
  tipo_cabelo: 'Tipo de cabelo',
  comprimento: 'Comprimento',
  ultima_quimica: 'Última química',
  preferencia_horario: 'Horário preferido',
  objecao: 'Objeção',
  gestante: 'Gestante / amamentando',
  unidade_preferida: 'Unidade preferida',
  outro: 'Outro',
};

export const PROVEDORES = ['anthropic', 'openai'] as const;
export type Provedor = (typeof PROVEDORES)[number];
export const MODELOS: Record<Provedor, Array<{ id: string; nome: string }>> = {
  anthropic: [
    { id: 'claude-opus-5-5', nome: 'Claude Opus 5.5 (padrão, mais capaz)' },
    { id: 'claude-sonnet-5-5', nome: 'Claude Sonnet 5.5 (rápido)' },
    { id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5 (mais barato)' },
  ],
  openai: [
    { id: 'gpt-4.1', nome: 'GPT-4.1' },
    { id: 'gpt-4.1-mini', nome: 'GPT-4.1 mini' },
  ],
};

const texto = (max: number) => z.string().trim().max(max);

export const ConfigAgente = z.object({
  persona: z
    .object({
      quemE: texto(1500).default(''),
      comoFala: texto(1500).default(''),
      emojis: z.boolean().default(true),
      tamanho: z.enum(['curta', 'media', 'longa']).default('curta'),
    })
    .default({ quemE: '', comoFala: '', emojis: true, tamanho: 'curta' }),
  regras: z
    .object({ sempre: z.array(texto(300)).max(40).default([]), nunca: z.array(texto(300)).max(40).default([]) })
    .default({ sempre: [], nunca: [] }),
  padroes: z.array(z.object({ situacao: texto(80).min(1), resposta: texto(1500).min(1) })).max(40).default([]),
  exemplos: z.array(z.object({ cliente: texto(800).min(1), resposta: texto(1500).min(1) })).max(30).default([]),
  ferramentas: z.array(z.enum(FERRAMENTAS_AGENTE)).default(['responder', 'consultar_agenda', 'agendar', 'mover_etapa', 'transferir']),
  passagem: z
    .object({
      reclamacao: z.boolean().default(true),
      pedidoPessoa: z.boolean().default(true),
      irritada: z.boolean().default(true),
      naoSabe: z.boolean().default(true),
      valorAcimaDe: z.number().min(0).max(1_000_000).nullable().default(null),
      palavras: z.array(texto(60).min(1)).max(40).default([]),
    })
    .default({ reclamacao: true, pedidoPessoa: true, irritada: true, naoSabe: true, valorAcimaDe: null, palavras: [] }),
  /** Usa também a base de conhecimento geral da empresa (aba Treinamento). */
  usarBaseGeral: z.boolean().default(true),
  /** Lê e grava a memória por cliente. */
  memoriaCliente: z.boolean().default(true),
});
export type ConfigAgente = z.infer<typeof ConfigAgente>;

export interface AgenteIa {
  id: string;
  empresaId: string;
  nome: string;
  avatar: string;
  unidades: string[];
  provedor: Provedor;
  modelo: string;
  chaveCifrada: string | null;
  /** 0 = formal, 100 = descontraída. */
  criatividade: number;
  config: ConfigAgente;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
  atualizadoPor: string | null;
}

/** O que a tela vê (nunca a chave). */
export function publico(a: AgenteIa) {
  const { chaveCifrada, ...resto } = a;
  return { ...resto, temChavePropria: Boolean(chaveCifrada) };
}

export const AgenteNovo = z.object({
  nome: texto(60).min(1),
  avatar: z.string().max(200_000).optional(),
  unidades: z.array(z.enum(['norte', 'sumare'])).max(3).optional(),
  provedor: z.enum(PROVEDORES).optional(),
  modelo: texto(80).min(1).optional(),
  /** string = nova chave; null = apagar a chave própria; ausente = não mexe. */
  chave: z.string().trim().max(400).nullable().optional(),
  criatividade: z.number().int().min(0).max(100).optional(),
  config: ConfigAgente.partial().optional(),
  ativo: z.boolean().optional(),
});
export type AgenteNovo = z.infer<typeof AgenteNovo>;

export function configPadrao(): ConfigAgente {
  return ConfigAgente.parse({});
}

/** Um agente pronto para começar, com o jeito Império. */
export function modeloImperio(): Pick<AgenteIa, 'nome' | 'avatar' | 'criatividade'> & { config: ConfigAgente } {
  return {
    nome: 'Lia',
    avatar: '💇‍♀️',
    criatividade: 60,
    config: ConfigAgente.parse({
      persona: {
        quemE: 'Lia, consultora da Império Progressivas, especialista em alisamento e progressiva.',
        comoFala: 'Calorosa, próxima e direta, como uma amiga que entende de cabelo. Chama a cliente pelo nome.',
        emojis: true,
        tamanho: 'curta',
      },
      regras: {
        sempre: ['Sempre oferecer um horário concreto no fim da resposta', 'Sempre perguntar o nome se ainda não souber'],
        nunca: ['Nunca dar preço sem perguntar o comprimento do cabelo', 'Nunca prometer resultado garantido'],
      },
      padroes: [
        { situacao: 'Preço', resposta: 'O valor depende do comprimento do seu cabelo. Ele bate no ombro, no meio das costas ou na cintura?' },
        { situacao: 'Gestante', resposta: 'Para gestantes e lactantes temos uma opção sem formol. Posso te explicar?' },
      ],
      exemplos: [{ cliente: 'quanto é a progressiva?', resposta: 'Oi! 😊 O valor depende do comprimento. Seu cabelo bate no ombro, no meio das costas ou na cintura?' }],
    }),
  };
}

export interface Conhecimento {
  id: string;
  agenteId: string;
  tipo: 'texto' | 'faq' | 'link' | 'arquivo';
  titulo: string;
  conteudo: string;
  origem: string | null;
  criadoEm: Date;
  criadoPor: string | null;
}

export interface MemoriaCliente {
  telefone: string;
  chave: string;
  valor: string;
  agenteId: string | null;
  conversaId: string | null;
  fonte: string;
  atualizadoEm: Date;
}

export interface Aprendizado {
  id: string;
  agenteId: string;
  texto: string;
  origem: Record<string, unknown>;
  situacao: 'pendente' | 'aprovado' | 'recusado';
  criadoEm: Date;
  decididoPor: string | null;
  decididoEm: Date | null;
}

/** IA atende primeiro: por unidade, com horário e regras de passagem. */
export const ConfigUnidadeControle = z.object({
  ligado: z.boolean().default(false),
  agenteId: z.string().nullable().default(null),
  /** sempre | fora_do_horario (só quando a loja está fechada) | faixa (entre inicio e fim). */
  quando: z.enum(['sempre', 'fora_do_horario', 'faixa']).default('sempre'),
  inicio: z.string().regex(/^\d{2}:\d{2}$/).default('08:00'),
  fim: z.string().regex(/^\d{2}:\d{2}$/).default('20:00'),
  /** Volta para a IA se a equipe não responder em N minutos depois que a IA passou (null = não volta). */
  voltarAposMin: z.number().int().min(5).max(24 * 60).nullable().default(null),
  /** A IA retoma conversas paradas (follow-ups). */
  retomarParadas: z.boolean().default(true),
});
export type ConfigUnidadeControle = z.infer<typeof ConfigUnidadeControle>;

export const ConfigControle = z.object({
  norte: ConfigUnidadeControle.default(ConfigUnidadeControle.parse({})),
  sumare: ConfigUnidadeControle.default(ConfigUnidadeControle.parse({})),
});
export type ConfigControle = z.infer<typeof ConfigControle>;

export interface RegistroComando {
  id: string;
  empresaId: string;
  texto: string;
  plano: unknown;
  situacao: 'planejado' | 'executado' | 'cancelado';
  por: string;
  porId: string | null;
  criadoEm: Date;
  executadoEm: Date | null;
  resultado: unknown;
}
