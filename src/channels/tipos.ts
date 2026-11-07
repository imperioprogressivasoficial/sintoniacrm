import type { TipoAnexo } from '../domain.js';
import type { ReferenciaAnuncio } from '../rastreio/referencia.js';

/**
 * Conector de canal. O resto do sistema não sabe se o WhatsApp é a Evolution (QR Code)
 * ou a API oficial da Meta: trocar de um para o outro não exige reescrever nada.
 */

export interface MensagemRecebida {
  /** Nome da instância/número que recebeu (para saber a unidade). */
  canalId: string;
  telefone: string;
  nome?: string;
  texto: string;
  /** true quando quem escreveu foi o próprio número da loja (atendente pelo celular, ou a própria Sintonia). */
  deMim: boolean;
  idExterno: string;
  em: Date;
  /** Mídia que veio junto (o `texto` já traz o marcador para a IA, ex.: "[foto] legenda"). */
  anexo?: AnexoRecebido;
  /** Anúncio de clique para WhatsApp que trouxe a cliente (referral / externalAdReply). */
  referencia?: ReferenciaAnuncio;
  /**
   * Rede social de onde veio (Messenger = facebook, Instagram Direct = instagram, TikTok = tiktok).
   * Nesses canais `telefone` é o identificador da rede com prefixo (fb:<PSID>, ig:<IGSID>, tt:<open_id>).
   */
  rede?: 'facebook' | 'instagram' | 'tiktok';
}

export interface AnexoRecebido {
  tipo: TipoAnexo;
  mimetype?: string;
  nomeArquivo?: string;
  duracaoSeg?: number;
  legenda?: string;
  /** Tamanho informado pelo WhatsApp, em bytes. */
  tamanho?: number;
  voz?: boolean;
  /** Conteúdo já presente no webhook (Evolution com "base64" ligado, ou simulador). Sem ele, é baixado depois. */
  base64?: string;
  /** Id da mídia no canal, quando é diferente do id da mensagem (API oficial: o media id da Graph API). */
  ref?: string;
}

/** Arquivo baixado do canal. */
export interface MidiaBaixada {
  conteudo: Buffer;
  mimetype?: string;
  nomeArquivo?: string;
}

/** Arquivo que a equipe envia pelo app. */
export interface MidiaEnvio {
  tipo: 'imagem' | 'video' | 'documento' | 'audio';
  conteudo: Buffer;
  mimetype: string;
  nomeArquivo?: string;
  legenda?: string;
}

export interface EnvioResultado {
  idExterno: string;
}

/** Situação de entrega de uma mensagem que a loja enviou. */
export type StatusEntrega = 'enviada' | 'entregue' | 'lida' | 'falhou';

/** Aviso de entrega/leitura que o canal manda pelo webhook. */
export interface StatusRecebido {
  canalId: string;
  idExterno: string;
  status: StatusEntrega;
  em: Date;
  telefone?: string;
  erro?: string;
}

/** Modelo de mensagem aprovado (API oficial): única forma de escrever fora da janela de 24 h. */
export interface ModeloEnvio {
  nome: string;
  /** Código do idioma do modelo, ex.: "pt_BR". */
  idioma: string;
  /** Valores das variáveis {{1}}, {{2}}... do corpo, em ordem. */
  parametros?: string[];
  /** Cabeçalho de imagem do modelo: id da mídia já enviada em /media (transmissões). */
  cabecalhoImagemId?: string;
}

export interface ModeloAprovado {
  nome: string;
  idioma: string;
  categoria: string;
  status: string;
  /** Texto do corpo, com as variáveis {{1}}, {{2}}... */
  corpo: string;
  variaveis: number;
}

export interface CanalWhatsApp {
  readonly tipo: 'evolution' | 'meta' | 'teste' | 'messenger' | 'instagram' | 'tiktok';
  /** Converte o corpo do webhook em mensagens de texto. Ignora o que não é conversa (status, grupos etc.). */
  lerWebhook(corpo: unknown): MensagemRecebida[];
  /** Avisos de entrega e leitura que vieram no webhook. Opcional. */
  lerStatus?(corpo: unknown): StatusRecebido[];
  enviarTexto(canalId: string, telefone: string, texto: string): Promise<EnvioResultado>;
  /**
   * Baixa a mídia de uma mensagem recebida (pelo id dela no canal; `ref` é o id da mídia, quando o canal usa um à parte).
   * Opcional: sem ele, a mídia não é guardada.
   */
  baixarMidia?(canalId: string, idExterno: string, ref?: string): Promise<MidiaBaixada>;
  /** Envia um modelo aprovado (API oficial). */
  enviarModelo?(canalId: string, telefone: string, modelo: ModeloEnvio): Promise<EnvioResultado>;
  /** Modelos aprovados da conta (API oficial). */
  listarModelos?(canalId: string): Promise<ModeloAprovado[]>;
  /** Marca a mensagem recebida como lida (os dois tiques azuis para a cliente). */
  marcarLida?(canalId: string, idExterno: string): Promise<void>;
  /** Envia foto, vídeo, documento ou nota de voz. Opcional: canal sem suporte recusa o envio de arquivo. */
  enviarMidia?(canalId: string, telefone: string, midia: MidiaEnvio): Promise<EnvioResultado>;
  /** Foto de perfil do WhatsApp da cliente (null quando ela não tem foto ou esconde). Opcional: a API oficial não oferece. */
  buscarFoto?(canalId: string, telefone: string): Promise<FotoPerfil | null>;
  /** Nome (e foto) da cliente na rede social (Messenger/Instagram). Opcional. */
  perfil?(canalId: string, telefone: string): Promise<{ nome?: string; usuario?: string; fotoUrl?: string }>;
}

export interface FotoPerfil {
  conteudo: Buffer;
  tipo: string;
}
