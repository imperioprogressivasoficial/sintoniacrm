import type { TipoAnexo } from './domain.js';

/** Maior arquivo guardado no banco (recebido). Acima disso ficam só os dados (tipo, nome, tamanho). */
export const LIMITE_MIDIA = 16 * 1024 * 1024;
/** Maior arquivo que a equipe envia pelo app (o WhatsApp aceita até 16 MB em vídeo e áudio). */
export const LIMITE_ENVIO = 16 * 1024 * 1024;
/** Arquivo que já vem dentro do webhook (opção "base64" da Evolution) só é aproveitado até este tamanho,
 * para não encher a fila de entrada; acima disso é baixado à parte. */
export const LIMITE_INLINE = 5 * 1024 * 1024;

/**
 * atendimento-extra: mídias do histórico e do "Resgatar mensagens" (baixadas por trás, depois das que acabaram de chegar).
 * - dias: só as dos últimos 30 dias são baixadas sozinhas; as mais antigas ficam com o botão "Baixar" na conversa.
 * - maxBytes: arquivo maior que isso (quando o WhatsApp informa o tamanho) também fica para baixar com o botão.
 * - maxPorVez: no máximo tantas mídias entram na fila de uma importação (as demais ficam com o botão).
 */
export const HISTORICO_MIDIA = { dias: 30, maxBytes: 10 * 1024 * 1024, maxPorVez: 400 };

/** velocidade: maior miniatura guardada (bytes do JPEG). As do WhatsApp têm 1–6 KB; maior que isso é ignorada. */
export const LIMITE_MINIATURA = 9 * 1024;

/**
 * velocidade: miniatura (jpegThumbnail) do jeito que chega no webhook — texto em base64, Buffer em JSON
 * ({ type: 'Buffer', data: [...] }) ou bytes numerados ({ "0": 255, "1": 216, ... }) — conferida e em base64.
 * Só JPEG de verdade e pequeno; qualquer outra coisa vira undefined (a foto aparece sem miniatura, como antes).
 */
export function miniaturaJpeg(v: unknown): string | undefined {
  let b: Buffer | undefined;
  try {
    if (typeof v === 'string') {
      const t = v.trim();
      if (!t || t.length > LIMITE_MINIATURA * 2 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return undefined;
      b = Buffer.from(t, 'base64');
    } else if (v && typeof v === 'object') {
      const o = v as { type?: unknown; data?: unknown };
      const lista = o.type === 'Buffer' && Array.isArray(o.data) ? o.data : Object.keys(o).length && Object.keys(o).length <= LIMITE_MINIATURA && Object.keys(o).every((k, i) => k === String(i)) ? Object.values(o) : null;
      if (!lista || lista.length > LIMITE_MINIATURA || !lista.every((x) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 255)) return undefined;
      b = Buffer.from(lista as number[]);
    }
  } catch { return undefined; }
  if (!b || b.length < 100 || b.length > LIMITE_MINIATURA) return undefined;
  if (b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return undefined; // começa como JPEG
  return b.toString('base64');
}

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

/**
 * seguranca-abertura: tipos que o navegador mostra dentro da página sem rodar nada (foto, áudio, vídeo, PDF).
 * HTML, SVG, XHTML, XML e o resto vão sempre como download.
 */
export const EXIBIVEL_SEGURO = /^(image\/(jpeg|png|gif|webp|heic|heif|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/;

/** Cabeçalhos para devolver um arquivo que alguém enviou: nada dele roda no endereço do app (sandbox), e tipo perigoso vira download. */
export function cabecalhosArquivo(mimetype: string, nome = 'arquivo'): Record<string, string> {
  const base = (mimetype.split(';')[0] ?? '').trim().toLowerCase();
  const exibe = EXIBIVEL_SEGURO.test(base);
  return {
    'content-type': exibe ? mimetype : 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
    'content-disposition': `${exibe ? 'inline' : 'attachment'}; ${nomeParaCabecalho(nome)}`,
  };
}

/** O arquivo existe, mas passa do limite de guardar: ficam só os dados dele. */
export class ErroMidiaGrande extends Error {
  constructor(readonly tamanho: number) {
    super(`Arquivo grande demais (${tamanho} bytes)`);
  }
}
