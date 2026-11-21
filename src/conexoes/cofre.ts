import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifra as chaves (IA, Trinks, Evolution) antes de irem para o banco: quem abrir uma cópia do banco
 * não lê as chaves. A chave do cofre vem do ambiente do servidor (SINTONIA_SEGREDO ou, na falta dele,
 * da própria conexão do banco, que já é secreta e estável).
 *
 * robustez: troca de chave sem perder nada (docs/SEGURANCA-SERVIDOR.md, "Chave do cofre"). O cofre aceita
 * chaves antigas só para LER: o que foi gravado com a chave antiga continua abrindo; tudo o que for gravado
 * de novo usa a chave principal. `precisaRegravar` diz se um valor ainda está na chave antiga.
 */
export class Cofre {
  private readonly chave: Buffer;
  private readonly antigas: Buffer[];
  constructor(segredo: string, antigos: string[] = []) {
    if (!segredo) throw new Error('Cofre sem segredo');
    this.chave = derivar(segredo);
    this.antigas = antigos.filter((a) => a && a !== segredo).map(derivar);
  }
  cifrar(texto: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.chave, iv);
    const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), dados.toString('base64')].join('.');
  }
  decifrar(cifrado: string): string {
    return this.abrir(cifrado).texto;
  }
  /** O valor está cifrado com uma chave antiga (abre, mas deveria ser regravado com a principal)? */
  precisaRegravar(cifrado: string): boolean {
    return this.abrir(cifrado).antiga;
  }
  /** Mesmo texto, cifrado com a chave principal (para a regravação). */
  recifrar(cifrado: string): string {
    return this.cifrar(this.decifrar(cifrado));
  }
  private abrir(cifrado: string): { texto: string; antiga: boolean } {
    const [v, iv, tag, dados] = cifrado.split('.');
    if (v !== 'v1' || !iv || !tag || !dados) throw new Error('Valor cifrado inválido');
    let erro: unknown;
    for (const [i, chave] of [this.chave, ...this.antigas].entries()) {
      try {
        const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(iv, 'base64'));
        d.setAuthTag(Buffer.from(tag, 'base64'));
        return { texto: Buffer.concat([d.update(Buffer.from(dados, 'base64')), d.final()]).toString('utf8'), antiga: i > 0 };
      } catch (e) {
        erro ??= e;
      }
    }
    throw erro;
  }
}

const derivar = (segredo: string) => createHash('sha256').update(`sintonia-cofre:${segredo}`).digest();
