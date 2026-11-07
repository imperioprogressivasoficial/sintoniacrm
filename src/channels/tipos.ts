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
}

export interface EnvioResultado {
  idExterno: string;
}

export interface CanalWhatsApp {
  readonly tipo: 'evolution' | 'meta' | 'teste';
  /** Converte o corpo do webhook em mensagens de texto. Ignora o que não é conversa (status, grupos etc.). */
  lerWebhook(corpo: unknown): MensagemRecebida[];
  enviarTexto(canalId: string, telefone: string, texto: string): Promise<EnvioResultado>;
  /** Foto de perfil do WhatsApp da cliente (null quando ela não tem foto ou esconde). Opcional: a API oficial não oferece. */
  buscarFoto?(canalId: string, telefone: string): Promise<FotoPerfil | null>;
}

export interface FotoPerfil {
  conteudo: Buffer;
  tipo: string;
}
