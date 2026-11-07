import type { TipoAnexo } from './domain.js';

/** Maior arquivo guardado no banco (recebido). Acima disso ficam só os dados (tipo, nome, tamanho). */
export const LIMITE_MIDIA = 16 * 1024 * 1024;
/** Maior arquivo que a equipe envia pelo app (o WhatsApp aceita até 16 MB em vídeo e áudio). */
export const LIMITE_ENVIO = 16 * 1024 * 1024;
/** Arquivo que já vem dentro do webhook (opção "base64" da Evolution) só é aproveitado até este tamanho,
 * para não encher a fila de entrada; acima disso é baixado à parte. */
export const LIMITE_INLINE = 5 * 1024 * 1024;

/** Marcador que vai no texto da mensagem: é o que a IA lê (ela não vê a mídia). */
export function textoDoAnexo(tipo: TipoAnexo, legenda?: string, nomeArquivo?: string): string {
  const marcador =
    tipo === 'imagem'
      ? '[foto]'
      : tipo === 'audio'
        ? '[áudio]'
        : tipo === 'video'
          ? '[vídeo]'
          : tipo === 'figurinha'
            ? '[figurinha]'
            : nomeArquivo
              ? `[documento: ${nomeArquivo}]`
              : '[documento]';
  const l = legenda?.trim();
  return l ? `${marcador} ${l}` : marcador;
}

/** Tipo de anexo a partir do mimetype (envio pelo app e simulador). */
export function tipoPeloMimetype(mimetype: string): TipoAnexo {
  const m = mimetype.toLowerCase();
  if (m === 'image/webp') return 'figurinha';
  if (m.startsWith('image/')) return 'imagem';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  return 'documento';
}

/** Tamanho real de um conteúdo em base64 (sem decodificar). */
export function tamanhoBase64(b64: string): number {
  const limpo = b64.replace(/\s/g, '');
  const pad = limpo.endsWith('==') ? 2 : limpo.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((limpo.length * 3) / 4) - pad);
}

/** Tira o prefixo "data:...;base64," se vier. */
export const semPrefixoDataUrl = (b64: string) => b64.replace(/^data:[^,]*,/, '');

/** Nome de arquivo seguro para o cabeçalho Content-Disposition. */
export function nomeParaCabecalho(nome: string): string {
  const ascii = nome.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

/** O arquivo existe, mas passa do limite de guardar: ficam só os dados dele. */
export class ErroMidiaGrande extends Error {
  constructor(readonly tamanho: number) {
    super(`Arquivo grande demais (${tamanho} bytes)`);
  }
}
