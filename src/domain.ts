/**
 * Tipos centrais da Sintonia. Tudo nasce multiempresa:
 * Empresa → Unidades → Números de WhatsApp → Conversas.
 */

export type UnidadeId = 'norte' | 'sumare' | 'feira';

/** Quem conduz a conversa agora. */
export type ModoAtendimento =
  /** A IA responde sozinha. */
  | 'ia'
  /** A IA lê tudo e sugere; quem envia é a atendente. Se ninguém responder no prazo, a IA assume. */
  | 'copiloto'
  /** "Só eu": a IA não sugere nem responde, mas continua organizando o funil. */
  | 'humano';

export const ETAPAS = [
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
  novo_lead: 'Novo lead',
  em_conversa: 'Em conversa',
  interessada: 'Interessada',
  agendada: 'Agendada',
  compareceu: 'Compareceu',
  manutencao: 'Manutenção',
  perdida: 'Perdida',
};

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
