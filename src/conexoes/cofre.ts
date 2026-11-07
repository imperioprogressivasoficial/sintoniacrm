import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifra as chaves (IA, Trinks, Evolution) antes de irem para o banco: quem abrir uma cópia do banco
 * não lê as chaves. A chave do cofre vem do ambiente do servidor (SINTONIA_SEGREDO ou, na falta dele,
 * da própria conexão do banco, que já é secreta e estável).
 */
export class Cofre {
  private readonly chave: Buffer;
  constructor(segredo: string) {
    if (!segredo) throw new Error('Cofre sem segredo');
    this.chave = createHash('sha256').update(`sintonia-cofre:${segredo}`).digest();
  }
  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chave, iv);
    const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join('.');
  }
  decifrar(cifrado: string): string {
    const [v, iv, tag, dados] = cifrado.split('.');
    if (v !== 'v1' || !iv || !tag || !dados) throw new Error('Valor cifrado inválido');
    const d = createDecipheriv('aes-256-gcm', this.chave, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8');
  }
}
