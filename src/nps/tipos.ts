import { z } from 'zod';

/**
 * Finalizar atendimento e pesquisa de satisfação (NPS).
 *
 * Ao finalizar um atendimento (com um motivo), a cliente pode receber pelo WhatsApp a pergunta
 * "De 0 a 10, quanto você recomendaria…?". A nota é lida da mensagem seguinte dela ("10", "nota 9", "9/10"…);
 * depois vem o comentário opcional. NPS = % de promotores (9–10) − % de detratores (0–6).
 */

export const MOTIVOS_FINALIZACAO = ['resolvido', 'venda_feita', 'agendado', 'sem_interesse', 'sem_resposta', 'outro'] as const;
export type MotivoFinalizacao = (typeof MOTIVOS_FINALIZACAO)[number];

export const NOME_MOTIVO: Record<MotivoFinalizacao, string> = {
  resolvido: 'Resolvido',
  venda_feita: 'Venda feita ou serviço realizado',
  agendado: 'Agendou',
  sem_interesse: 'Sem interesse',
  sem_resposta: 'A cliente não respondeu',
  outro: 'Outro motivo',
};

export const TEXTOS_NPS = {
  pergunta:
    'Oi, {primeiro_nome}! Obrigado por falar com a gente. De 0 a 10, quanto você recomendaria o nosso atendimento para um amigo ou familiar? Responda só com o número 😊',
  textoComentario: 'Obrigado pela nota! Se quiser, conte em poucas palavras o motivo. Sua opinião ajuda a gente a melhorar.',
  agradecimento: 'Muito obrigado, {primeiro_nome}! Sua opinião é muito importante para nós 💙',
};

const Texto = (max: number) => z.string().trim().min(1).max(max);

export const ConfigNps = z.object({
  /** Manda a pesquisa ao finalizar o atendimento. */
  ligada: z.boolean().default(false),
  /** Só para estes motivos de finalização (a atendente ainda pode desmarcar na hora). */
  motivos: z.array(z.enum(MOTIVOS_FINALIZACAO)).max(MOTIVOS_FINALIZACAO.length).default(['resolvido', 'venda_feita', 'agendado', 'outro']),
  pergunta: Texto(800).default(TEXTOS_NPS.pergunta),
  /** Depois da nota, pede um comentário (opcional para a cliente). */
  pedirComentario: z.boolean().default(true),
  textoComentario: Texto(800).default(TEXTOS_NPS.textoComentario),
  agradecimento: Texto(800).default(TEXTOS_NPS.agradecimento),
  /** Por quanto tempo a resposta da cliente ainda conta como nota. */
  validadeHoras: z.number().int().min(1).max(24 * 14).default(72),
  /** Link de avaliação (Google, por exemplo): vira a variável {link_avaliacao} nas automações. */
  linkAvaliacao: z.union([z.literal(''), z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Use um link que comece com https://')]).default(''),
});
export type ConfigNps = z.infer<typeof ConfigNps>;

export function configNpsPadrao(): ConfigNps {
  return ConfigNps.parse({});
}

/** Junta o que está gravado com o padrão (campo que faltar ou estragar volta ao padrão). */
export function normalizarConfigNps(bruto: unknown): ConfigNps {
  const b = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  const r = ConfigNps.safeParse(b);
  if (r.success) return r.data;
  const padrao = configNpsPadrao() as Record<string, unknown>;
  const limpo: Record<string, unknown> = {};
  for (const k of Object.keys(padrao)) {
    const um = ConfigNps.shape[k as keyof typeof ConfigNps.shape].safeParse(b[k]);
    limpo[k] = um.success ? um.data : padrao[k];
  }
  return ConfigNps.parse(limpo);
}

export type EstadoPesquisa = 'aguardando_nota' | 'aguardando_comentario' | 'respondida' | 'expirada' | 'nao_enviada';
export const ABERTAS: EstadoPesquisa[] = ['aguardando_nota', 'aguardando_comentario'];

export interface Finalizacao {
  id: string;
  empresaId: string;
  conversaId: string;
  unidade: string;
  motivo: MotivoFinalizacao;
  observacao: string | null;
  /** Quem atendeu (a dona da conversa; sem dona, quem finalizou). */
  atendenteId: string | null;
  atendenteNome: string | null;
  porId: string | null;
  porNome: string;
  em: Date;
}

export interface Pesquisa {
  id: string;
  empresaId: string;
  conversaId: string;
  finalizacaoId: string | null;
  unidade: string;
  atendenteId: string | null;
  atendenteNome: string | null;
  motivo: MotivoFinalizacao | null;
  estado: EstadoPesquisa;
  enviadaEm: Date;
  expiraEm: Date;
  nota: number | null;
  comentario: string | null;
  respondidaEm: Date | null;
  detalhe: string | null;
}

export type Categoria = 'promotor' | 'neutro' | 'detrator';
export const categoria = (nota: number): Categoria => (nota >= 9 ? 'promotor' : nota >= 7 ? 'neutro' : 'detrator');

/** NPS de uma lista de notas: % promotores − % detratores (inteiro de −100 a 100), ou null sem notas. */
export function calcularNps(notas: number[]): { nps: number | null; total: number; promotores: number; neutros: number; detratores: number } {
  let promotores = 0;
  let neutros = 0;
  let detratores = 0;
  for (const n of notas) {
    const c = categoria(n);
    if (c === 'promotor') promotores++;
    else if (c === 'neutro') neutros++;
    else detratores++;
  }
  const total = notas.length;
  return { nps: total ? Math.round(((promotores - detratores) / total) * 100) : null, total, promotores, neutros, detratores };
}

// ------------------------------------------------------------------ leitura da nota

const NUMEROS_ESCRITOS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};
/** Palavras que costumam vir junto da nota e não são comentário. */
const ENCHIMENTO = new Set(
  'nota a o e eh minha meu sua seu dou daria dei te vou dar pra para voces vcs vc voce voces de do da acho que com certeza claro sim pontos ponto ok okay total tudo seria fica ai la aqui um uma merece merecem'.split(' '),
);
/** Sinais de que o número é hora, data ou dinheiro, não uma nota. */
const NAO_E_NOTA = /\b(h|hs|hr|hrs|hora|horas|min|mins|minuto|minutos|dias|mes|meses|ano|anos|semana|semanas|amanha|hoje|ontem|reais|real|vezes|kg|ml|cm)\b|\b(as|dia)\s+\d|\d\s*(h|hs|min|%|x)\b|\d[:h]\d|\$|%|\d{3,}/;

const normalizarTexto = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Lê a nota (0 a 10) de uma resposta curta da cliente: "10", "nota 9", "9/10", "8 de 10", "dez", "Nota 10, adorei!".
 * Devolve também o comentário quando ele veio junto ("10, adorei o atendimento"). Null quando não dá para ter certeza
 * (sem número, número fora de 0–10, mais de um número diferente, hora/data/valor, mensagem longa).
 */
export function lerNota(texto: string): { nota: number; comentario: string | null } | null {
  const original = String(texto ?? '').trim();
  if (!original || original.length > 400) return null;
  let t = normalizarTexto(original);
  // "9/10", "9 / 10", "8 de 10", "nota 9 de 0 a 10" → só a nota.
  t = t.replace(/\bde\s*0\s*a\s*10\b/g, ' ').replace(/(\d{1,2})\s*(?:\/|de)\s*10\b/g, '$1');
  if (/\d\s*[.,]\s*\d/.test(t)) return null; // 9,5 / 8.5: não é uma nota inteira
  if (NAO_E_NOTA.test(t)) return null;
  const palavras = t
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const digitos = palavras.filter((p) => /^\d+$/.test(p)).map(Number);
  let nota: number | undefined;
  if (digitos.length) {
    if (new Set(digitos).size !== 1) return null;
    nota = digitos[0]!;
  } else {
    const escritos = palavras.filter((p) => p in NUMEROS_ESCRITOS);
    // "um"/"uma" só contam quando são quase a resposta inteira ("nota um"); senão é artigo ("uma nota dez").
    const fortes = escritos.filter((p) => (p !== 'um' && p !== 'uma') || palavras.length <= 2).map((p) => NUMEROS_ESCRITOS[p]!);
    if (!fortes.length || new Set(fortes).size !== 1) return null;
    nota = fortes[0]!;
  }
  if (nota === undefined || !Number.isInteger(nota) || nota < 0 || nota > 10) return null;
  const resto = palavras.filter((p) => !/^\d+$/.test(p) && !(p in NUMEROS_ESCRITOS) && !ENCHIMENTO.has(p));
  if (resto.length > 12) return null; // mensagem longa com um número no meio: provavelmente não é a nota
  return { nota, comentario: resto.length >= 2 ? original.slice(0, 1000) : null };
}

/** Troca {primeiro_nome} {nome} {atendente} {unidade} no texto da pesquisa. */
export function preencherNps(texto: string, v: { nome?: string; atendente?: string | null; unidade?: string }): string {
  const nome = v.nome?.trim() || '';
  const primeiro = nome.split(/\s+/)[0] || '';
  return texto
    .replace(/\{primeiro_nome\}/g, primeiro)
    .replace(/\{nome\}/g, nome)
    .replace(/\{atendente\}/g, v.atendente?.trim() || 'nossa equipe')
    .replace(/\{unidade\}/g, v.unidade ?? '')
    .replace(/,\s*!/g, '!')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
