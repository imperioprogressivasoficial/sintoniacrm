/**
 * ia-aprende: tira dados pessoais do texto antes de mandar à IA (e de novo no que volta dela).
 * Telefones, e-mails, CPF/CNPJ, CEP, códigos longos e links com parâmetros somem; nomes conhecidos
 * (da cliente e da equipe) e nomes que a cliente diz ("meu nome é…", "aqui é a…") viram [cliente] / [atendente].
 */

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Palavras que parecem nome mas não são (para não apagar "Oi Bom dia"). */
const NAO_NOME = new Set(
  'oi ola bom boa dia tarde noite tudo bem sim nao obrigada obrigado amiga amor querida linda flor moca senhora senhor cliente equipe atendimento loja salao'.split(' '),
);

/** Partes de um nome que valem trocar (3+ letras, não palavras comuns). */
function partesDoNome(nome: string): string[] {
  return semAcento(nome)
    .split(/[^A-Za-z]+/)
    .filter((p) => p.length >= 3 && !NAO_NOME.has(p.toLowerCase()));
}

/** Expressão que acha o nome com ou sem acento, inteiro como palavra. */
function reDoNome(parte: string): RegExp {
  const letras = [...parte].map((c) => {
    const base = escapar(c);
    const variantes: Record<string, string> = { a: 'aáàâãä', e: 'eéèêë', i: 'iíìîï', o: 'oóòôõö', u: 'uúùûü', c: 'cç', n: 'nñ' };
    const v = variantes[c.toLowerCase()];
    return v ? `[${v}${v.toUpperCase()}]` : base;
  });
  return new RegExp(`(?<![\\p{L}\\d])${letras.join('')}(?![\\p{L}\\d])`, 'giu');
}

export interface NomesConhecidos {
  clientes?: string[];
  equipe?: string[];
}

export function anonimizar(texto: string, nomes: NomesConhecidos = {}): string {
  let t = String(texto ?? '');
  // e-mail
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');
  // links: mantém só o site (o resto pode ter códigos pessoais)
  t = t.replace(/\bhttps?:\/\/([^\s/?#]+)[^\s]*/gi, (_m, host: string) => `[link ${host}]`);
  // CPF e CNPJ escritos com pontuação (só números, sem pontuação, caem em telefone/número logo abaixo)
  t = t.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, '[documento]');
  t = t.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[documento]');
  // códigos longos (pix aleatório, protocolos)
  t = t.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[código]');
  // telefone: +55 (71) 98812-4471, 71988124471, 98812 4471 ...
  t = t.replace(/(?:\+?\d{2}[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g, (m) => (m.replace(/\D/g, '').length >= 8 ? '[telefone]' : m));
  t = t.replace(/\b\d{9,}\b/g, '[número]');
  // CEP
  t = t.replace(/\b\d{5}-\d{3}\b/g, '[cep]');
  // nomes que a cliente diz de si
  t = t.replace(/\b([Mm]eu nome [ée]|[Mm]e chamo|[Aa]qui [ée] (?:a|o)|[Ss]ou (?:a|o))\s+([A-ZÀ-Ý][\p{L}]+)(\s+[A-ZÀ-Ý][\p{L}]+)?/gu, (_m, frase: string) => `${frase} [cliente]`);
  // nomes conhecidos
  const trocar = (lista: string[] | undefined, marca: string) => {
    for (const nome of lista ?? []) for (const p of partesDoNome(nome)) t = t.replace(reDoNome(p), marca);
  };
  trocar(nomes.clientes, '[cliente]');
  trocar(nomes.equipe, '[atendente]');
  // "[cliente] [cliente]" (nome e sobrenome) vira um só
  t = t.replace(/\[(cliente|atendente)\](\s+\[\1\])+/g, '[$1]');
  return t;
}
