import { inflateSync } from 'node:zlib';

/** Importação simples de conhecimento: página da web (texto) e arquivo .txt ou .pdf. */

export const LIMITE_TEXTO = 40_000;

export function textoDoHtml(html: string): string {
  const semLixo = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const ent: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return semLixo
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, c: string) => {
      if (c[0] === '#') return String.fromCodePoint(c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : Number(c.slice(1)));
      return ent[c.toLowerCase()] ?? m;
    })
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, LIMITE_TEXTO);
}

export function tituloDoHtml(html: string): string | undefined {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || undefined;
}

/** Baixa a página (só http/https, sem endereços internos) e devolve o texto. */
export async function importarLink(url: string, f: typeof fetch = fetch): Promise<{ titulo: string; texto: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw Object.assign(new Error('Link inválido.'), { statusCode: 400 });
  }
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1)/.test(u.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname)) {
    throw Object.assign(new Error('Use um link público (http ou https).'), { statusCode: 400 });
  }
  const r = await f(u, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Sintonia/1.0 (importar conhecimento)' } }).catch((e: unknown) => {
    throw Object.assign(new Error(`Não deu para abrir o link: ${String((e as Error).message ?? e)}`), { statusCode: 502 });
  });
  if (!r.ok) throw Object.assign(new Error(`A página respondeu ${r.status}.`), { statusCode: 502 });
  const html = (await r.text()).slice(0, 3_000_000);
  const texto = textoDoHtml(html);
  if (!texto) throw Object.assign(new Error('A página não tem texto para importar.'), { statusCode: 422 });
  return { titulo: tituloDoHtml(html) ?? u.hostname, texto };
}

/** Texto de um PDF simples (texto em fluxos, comprimidos ou não). PDF escaneado (imagem) não tem texto. */
export function textoDoPdf(buf: Buffer): string {
  const bruto = buf.toString('latin1');
  const partes: string[] = [];
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) {
    let conteudo = m[1]!;
    try {
      conteudo = inflateSync(Buffer.from(conteudo, 'latin1')).toString('latin1');
    } catch {
      /* fluxo não comprimido */
    }
    const linhas: string[] = [];
    for (const bloco of conteudo.matchAll(/\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^)\\])*)\)\s*(?:Tj|'|")|(T\*|ET|Td|TD)/g)) {
      if (bloco[3]) {
        linhas.push('\n');
        continue;
      }
      const src = bloco[1] ?? `(${bloco[2]})`;
      for (const s of src.matchAll(/\(((?:\\.|[^)\\])*)\)/g)) linhas.push(desescapar(s[1]!));
    }
    const t = linhas.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    if (t && /[a-zA-Zà-ú]{3}/.test(t)) partes.push(t);
  }
  return partes.join('\n').slice(0, LIMITE_TEXTO);
}

function desescapar(s: string): string {
  return s
    .replace(/\\([nrtbf()\\])/g, (_m, c: string) => ({ n: '\n', r: '', t: ' ', b: '', f: '', '(': '(', ')': ')', '\\': '\\' })[c] ?? c)
    .replace(/\\(\d{1,3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
}
