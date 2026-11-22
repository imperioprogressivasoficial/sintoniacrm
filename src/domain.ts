/**
 * Tipos centrais da Sintonia. Tudo nasce multiempresa:
 * Empresa → Unidades → Números de WhatsApp → Conversas.
 */

/**
 * Id da unidade (loja, filial): vem do cadastro da empresa (Empresa › Unidades, src/unidades.ts).
 * Texto curto e fixo ('norte', 'loja-centro'...); a validação é contra o cadastro (zUnidade).
 */
export type UnidadeId = string;

/** Quem conduz a conversa agora. */
export type ModoAtendimento =
  /** A IA responde sozinha. */
  | 'ia'
  /** A IA lê tudo e sugere; quem envia é a atendente. Se ninguém responder no prazo, a IA assume. */
  | 'copiloto'
  /** "Só eu": a IA não sugere nem responde, mas continua organizando o funil. */
  | 'humano';

export const ETAPAS = [
  /* etapa-entrada: etapa fixa de chegada (cinza). Todo lead novo nasce aqui e sai na 1ª resposta da loja (equipe ou IA). */
  'entrada',
  'novo_lead',
  'em_conversa',
  'interessada',
  'agendada',
  'compareceu',
  'manutencao',
  'perdida',
] as const;
export type Etapa = (typeof ETAPAS)[number];

export const NOME_ETAPA: Record<Etapa, string> = {
  entrada: 'Entrada de leads',
  novo_lead: 'Novo lead',
  em_conversa: 'Em conversa',
  interessada: 'Interessada',
  agendada: 'Agendada',
  compareceu: 'Compareceu',
  manutencao: 'Manutenção',
  perdida: 'Perdida',
};

/** etapa-entrada: a etapa fixa de chegada (primeira em todo funil; não renomeia, não apaga, não sai do lugar). */
export const ETAPA_ENTRADA = 'entrada' as const;
/** etapa-entrada: nome e cor (bolinha cinza) da etapa fixa de chegada, iguais em todo funil. */
export const NOME_ENTRADA = 'Entrada de leads';
export const COR_ENTRADA = '#94a3b8';
/** etapa-entrada: para as contas e os filtros, quem está na Entrada também é "Novo lead". */
export const ETAPAS_NOVO_LEAD: readonly Etapa[] = ['entrada', 'novo_lead'];
/** etapa-entrada: filtro por etapas com "Novo lead" escolhido pega também a Entrada de leads. */
export function expandirEtapas<T extends string>(lista: readonly T[]): T[] {
  return lista.includes('novo_lead' as T) && !lista.includes('entrada' as T) ? [...lista, 'entrada' as T] : [...lista];
}
/** etapa-entrada: a conversa está na etapa pedida (pedir "Novo lead" vale também para quem está na Entrada). */
export const naEtapa = (etapaDaConversa: string, pedida: string) => etapaDaConversa === pedida || (pedida === 'novo_lead' && etapaDaConversa === 'entrada');

/** Quem escreveu a mensagem. */
export type Autor = 'cliente' | 'ia' | 'equipe' | 'sistema';

export interface Mensagem {
  id: string;
  conversaId: string;
  autor: Autor;
  /** Nome da atendente quando autor = equipe. */
  autorNome?: string;
  texto: string;
  em: Date;
  /** Id da mensagem no canal (Evolution/Meta), para não processar duas vezes. */
  idExterno?: string;
  /** Foto, áudio, vídeo, documento ou figurinha. O `texto` continua com o marcador para a IA ("[foto] legenda"). */
  anexo?: Anexo;
  /**
   * Mensagem da loja: os "vistos" do WhatsApp. enviada = um ✓ (saiu, a cliente ainda não recebeu);
   * entregue = ✓✓ cinza; lida = ✓✓ azul; ouvida = só áudio de voz, a cliente tocou (microfone azul); falhou = não saiu.
   * Sem valor (mensagens antigas): vale como enviada.
   */
  entrega?: 'enviada' | 'entregue' | 'lida' | 'ouvida' | 'falhou';
}

export type TipoAnexo = 'imagem' | 'audio' | 'video' | 'documento' | 'figurinha';

/**
 * Situação do arquivo guardado:
 * pendente = ainda baixando (ou esperando nova tentativa); pronta = guardado no banco;
 * grande = passou do limite, só os dados ficam; falhou = não deu para baixar.
 */
export type SituacaoAnexo = 'pendente' | 'pronta' | 'grande' | 'falhou';

export interface Anexo {
  tipo: TipoAnexo;
  mimetype?: string;
  nomeArquivo?: string;
  /** Duração em segundos (áudio e vídeo). */
  duracaoSeg?: number;
  legenda?: string;
  /** Tamanho em bytes, quando conhecido. */
  tamanho?: number;
  /** Nota de voz (áudio gravado na hora). */
  voz?: boolean;
  situacao: SituacaoAnexo;
  /** velocidade: largura e altura da foto/vídeo informadas pelo WhatsApp (a caixa já nasce do tamanho certo). */
  largura?: number;
  altura?: number;
  /** velocidade: miniatura que o próprio WhatsApp manda (JPEG pequeno, base64), mostrada desfocada até a foto chegar.
   * Só vem no detalhe da conversa (GET /api/conversas/:id), nunca na lista. */
  miniatura?: string;
}

export interface Conversa {
  id: string;
  empresaId: string;
  unidade: UnidadeId;
  /** Número/instância de WhatsApp da loja por onde a conversa acontece. */
  canalId: string;
  /** Telefone da cliente com DDI, só dígitos. Ex.: 5571988124471 */
  telefone: string;
  nome?: string;
  modo: ModoAtendimento;
  etapa: Etapa;
  /** Id da cliente no Trinks, quando já existe. */
  trinksClienteId?: number;
  /** Até quando a IA fica em silêncio porque alguém da equipe está digitando/atuando. */
  pausaIaAte?: Date;
  ultimaMensagemCliente?: Date;
  ultimaMensagemEquipe?: Date;
  ultimaMensagemIa?: Date;
  etiquetas: string[];
  resumo?: string;
  /** Dona da conversa: a pessoa da equipe responsável por ela (vazio = sem dona). */
  responsavelId?: string;
  /** Nome da dona, para exibir sem consultar a equipe. */
  responsavelNome?: string;
  criadaEm: Date;
  atualizadaEm: Date;
}

export interface Agendamento {
  trinksId: number;
  unidade: UnidadeId;
  servico: string;
  profissional?: string;
  inicio: Date;
  duracaoMin: number;
}
