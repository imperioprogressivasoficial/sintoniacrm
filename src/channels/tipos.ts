import type { TipoAnexo } from '../domain.js';

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

export interface CanalWhatsApp {
  readonly tipo: 'evolution' | 'meta' | 'teste';
  /** Converte o corpo do webhook em mensagens de texto. Ignora o que não é conversa (status, grupos etc.). */
  lerWebhook(corpo: unknown): MensagemRecebida[];
  enviarTexto(canalId: string, telefone: string, texto: string): Promise<EnvioResultado>;
  /** Baixa a mídia de uma mensagem recebida (pelo id dela no canal). Opcional: sem ele, a mídia não é guardada. */
  baixarMidia?(canalId: string, idExterno: string): Promise<MidiaBaixada>;
  /** Envia foto, vídeo, documento ou nota de voz. Opcional: canal sem suporte recusa o envio de arquivo. */
  enviarMidia?(canalId: string, telefone: string, midia: MidiaEnvio): Promise<EnvioResultado>;
  /** Foto de perfil do WhatsApp da cliente (null quando ela não tem foto ou esconde). Opcional: a API oficial não oferece. */
  buscarFoto?(canalId: string, telefone: string): Promise<FotoPerfil | null>;
}

export interface FotoPerfil {
  conteudo: Buffer;
  tipo: string;
}
