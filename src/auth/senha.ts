import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** Senhas com scrypt (resistente a força bruta). Formato: scrypt$N$r$p$sal$hash (base64). */

const N = 16384;
const R = 8;
const P = 1;
const TAMANHO = 64;

function scrypt(senha: string, sal: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((ok, erro) => {
    const opcoes: ScryptOptions = { N: n, r, p, maxmem: 64 * 1024 * 1024 };
    scryptCb(senha.normalize('NFKC'), sal, TAMANHO, opcoes, (e, chave) => (e ? erro(e) : ok(chave)));
  });
}

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(senha, sal, N, R, P);
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, sal, hash] = partes as [string, string, string, string, string, string];
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scrypt(senha, Buffer.from(sal, 'base64'), Number(n), Number(r), Number(p));
  return esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

/** Regra mínima: 10 caracteres, com letra e número. */
export function senhaFraca(senha: string): string | null {
  if (senha.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(senha) || !/\d/.test(senha)) return 'A senha precisa ter letras e números.';
  return null;
}
