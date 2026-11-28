/**
 * dono 28/11: a Serena também responde em áudio, com a voz grátis que já roda no servidor (Kokoro, voz pf_dora;
 * o mesmo serviço que o Espaço Rainha usa: projeto Docker "rainha-voz", rede n8n-trjk_default, porta 8880).
 * Pedido: POST { texto, voz, velocidade } → o arquivo de áudio. Sem o serviço (ou com erro), a resposta vai em texto.
 */
export interface Voz {
  falar(texto: string): Promise<{ conteudo: Buffer; mimetype: string }>;
}

/** Texto bom para falar: sem emoji, markdown, link nem marcadores. */
export function textoParaFala(t: string): string {
  return t
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[*_`#>•]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

export class VozKokoro implements Voz {
  constructor(
    private readonly url: string,
    private readonly o: { voz?: string; velocidade?: number; fetchFn?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async falar(texto: string) {
    const r = await (this.o.fetchFn ?? fetch)(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texto: textoParaFala(texto), voz: this.o.voz ?? 'pf_dora', velocidade: this.o.velocidade ?? 0.95 }),
      signal: AbortSignal.timeout(this.o.timeoutMs ?? 60_000),
    });
    if (!r.ok) throw new Error(`Servidor de voz respondeu ${r.status}`);
    const conteudo = Buffer.from(await r.arrayBuffer());
    if (conteudo.length < 500) throw new Error('Servidor de voz devolveu um áudio vazio');
    const tipo = (r.headers.get('content-type') ?? '').split(';')[0]!.trim();
    const mimetype = tipo.startsWith('audio/') ? tipo : conteudo.subarray(0, 4).toString('latin1') === 'OggS' ? 'audio/ogg' : conteudo.subarray(0, 4).toString('latin1') === 'RIFF' ? 'audio/wav' : 'audio/mpeg';
    return { conteudo, mimetype };
  }
}
