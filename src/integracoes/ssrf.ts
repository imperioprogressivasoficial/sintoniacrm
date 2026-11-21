import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Proteção contra SSRF nos webhooks: o servidor da Sintonia só chama endereços públicos da internet.
 * Bloqueia localhost, redes privadas, link-local (inclui o 169.254.169.254 dos metadados de nuvem),
 * CGNAT, multicast, faixas reservadas e os nomes internos de nuvem. Em produção, só https.
 * A conferência acontece ao cadastrar (com DNS) e de novo a cada entrega, no momento da conexão
 * (`lookupSeguro`), para um DNS que muda de resposta (rebinding) não passar.
 */

export class ErroDestino extends Error {
  readonly statusCode = 400;
  readonly codigo = 'destino_bloqueado';
}

const v4ParaNumero = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const FAIXAS_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
const BLOQUEIOS_V4 = FAIXAS_V4.map(([base, bits]) => ({ base: v4ParaNumero(base), mascara: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0 }));

function v4Bloqueado(ip: string): boolean {
  const n = v4ParaNumero(ip) >>> 0;
  return BLOQUEIOS_V4.some((f) => ((n & f.mascara) >>> 0) === ((f.base & f.mascara) >>> 0));
}

/** Expande um IPv6 em 8 grupos de 16 bits (aceita "::" e o final em IPv4). */
function gruposV6(ip: string): number[] | undefined {
  let s = ip.toLowerCase().split('%')[0]!;
  // Final em IPv4 ("::ffff:127.0.0.1"): vira dois grupos hexadecimais.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const n = v4ParaNumero(v4[1]!) >>> 0;
    s = s.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const partes = s.split('::');
  if (partes.length > 2) return undefined;
  const parte = (x: string) => (x ? x.split(':').map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : NaN)) : []);
  const a = parte(partes[0]!);
  const b = partes.length === 2 ? parte(partes[1]!) : [];
  const faltam = 8 - a.length - b.length;
  if (partes.length === 1 ? faltam !== 0 : faltam < 1) return undefined;
  const g = [...a, ...Array(partes.length === 2 ? faltam : 0).fill(0), ...b];
  return g.length === 8 && g.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? g : undefined;
}

function v6Bloqueado(ip: string): boolean {
  const g = gruposV6(ip);
  if (!g) return true; // não deu para entender: não arrisca
  const tudoZero = (de: number, ate: number) => g.slice(de, ate).every((x) => x === 0);
  if (tudoZero(0, 8)) return true; // ::
  if (tudoZero(0, 7) && g[7] === 1) return true; // ::1
  const v4de = (a: number, b: number) => `${a >>> 8}.${a & 255}.${b >>> 8}.${b & 255}`;
  // ::ffff:a.b.c.d (mapeado), ::a.b.c.d (compatível), 64:ff9b::a.b.c.d (NAT64): vale a regra do IPv4 de dentro.
  if (tudoZero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return v4Bloqueado(v4de(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b && tudoZero(2, 6)) return v4Bloqueado(v4de(g[6]!, g[7]!));
  const p = g[0]!;
  if ((p & 0xfe00) === 0xfc00) return true; // fc00::/7 (rede privada)
  if ((p & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  if ((p & 0xffc0) === 0xfec0) return true; // fec0::/10 (site-local antigo)
  if ((p & 0xff00) === 0xff00) return true; // multicast
  if (p === 0x2001 && g[1] === 0x0db8) return true; // documentação
  if (p === 0x0100 && tudoZero(1, 4)) return true; // 100::/64 (descarte)
  if (p === 0x2002) return v4Bloqueado(v4de(g[1]!, g[2]!)); // 6to4 aponta para um IPv4
  return false;
}

/** O IP é interno, privado, reservado ou de metadados? */
export function ipBloqueado(ip: string): boolean {
  const tipo = isIP(ip);
  if (tipo === 4) return v4Bloqueado(ip);
  if (tipo === 6) return v6Bloqueado(ip);
  return true;
}

const NOMES_INTERNOS = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|arpa)$/i;
const NOMES_METADADOS = new Set(['metadata', 'metadata.google.internal', 'instance-data', 'instance-data.ec2.internal', 'metadata.azure.com', 'kubernetes.default', 'kubernetes.default.svc']);

export interface OpcoesDestino {
  /** Produção: só https. */
  producao: boolean;
  /** Desenvolvimento: libera localhost e rede local (nunca em produção). */
  permitirLocal?: boolean;
  /** banco-seguranca: aceita http:// público (baixar imagem ou página de terceiros); a rede interna continua bloqueada. */
  permitirHttp?: boolean;
  /** Resolve o nome (troque nos testes). */
  resolver?: (host: string) => Promise<string[]>;
}

export const resolverDns = (host: string) =>
  new Promise<string[]>((ok, falha) => dnsLookup(host, { all: true, verbatim: true }, (e, l) => (e ? falha(e) : ok((l as LookupAddress[]).map((x) => x.address)))));

/** Confere o endereço só pelo texto (sem DNS). Devolve a URL normalizada. */
export function conferirUrl(bruta: string, o: Pick<OpcoesDestino, 'producao' | 'permitirLocal' | 'permitirHttp'>): URL {
  let url: URL;
  try {
    url = new URL(bruta.trim());
  } catch {
    throw new ErroDestino('Endereço inválido. Use algo como https://seu-sistema.com/webhooks/sintonia.');
  }
  if (bruta.length > 2000) throw new ErroDestino('Endereço longo demais.');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ErroDestino('Use um endereço https://.');
  if (url.protocol === 'http:' && !o.permitirHttp && (o.producao || !o.permitirLocal)) throw new ErroDestino('Por segurança, o endereço precisa começar com https://.');
  if (url.username || url.password) throw new ErroDestino('Não coloque usuário e senha no endereço. Use o segredo do webhook para conferir a assinatura.');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) throw new ErroDestino('Endereço sem servidor.');
  const livre = o.permitirLocal && !o.producao;
  if (!livre) {
    if (NOMES_METADADOS.has(host) || NOMES_INTERNOS.test(host) || !host.includes('.') && !isIP(host)) {
      throw new ErroDestino('Esse endereço é interno. Use um endereço público da internet.');
    }
    if (isIP(host) && ipBloqueado(host)) throw new ErroDestino('Esse endereço aponta para uma rede interna e foi bloqueado.');
    // Formas disfarçadas de IP ("0x7f.1", "2130706433") que o navegador entenderia como IP.
    if (/^[\d.x]+$/i.test(host) && !isIP(host)) throw new ErroDestino('Endereço inválido.');
  }
  url.hash = '';
  return url;
}

/** Confere o endereço e o DNS dele (todos os IPs precisam ser públicos). */
export async function conferirDestino(bruta: string, o: OpcoesDestino): Promise<URL> {
  const url = conferirUrl(bruta, o);
  if (o.permitirLocal && !o.producao) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return url;
  let ips: string[];
  try {
    ips = await (o.resolver ?? resolverDns)(host);
  } catch {
    throw new ErroDestino('Não encontramos esse endereço na internet. Confira se está certo.');
  }
  if (!ips.length) throw new ErroDestino('Não encontramos esse endereço na internet. Confira se está certo.');
  if (ips.some(ipBloqueado)) throw new ErroDestino('Esse endereço aponta para uma rede interna e foi bloqueado.');
  return url;
}

type Callback = (erro: NodeJS.ErrnoException | null, endereco: string | LookupAddress[], familia?: number) => void;

/**
 * `lookup` para http.request/https.request: resolve e recusa a conexão se algum IP for interno.
 * Assim a checagem vale no momento exato da conexão (sem brecha entre conferir e conectar).
 */
export function lookupSeguro(permitirLocal = false) {
  return (host: string, opcoes: { all?: boolean } | number | undefined, cb: Callback) => {
    const all = typeof opcoes === 'object' && opcoes?.all;
    dnsLookup(host, { all: true, verbatim: true }, (e, lista) => {
      if (e) return cb(e, '', 0);
      const ips = lista as LookupAddress[];
      if (!permitirLocal && (!ips.length || ips.some((x) => ipBloqueado(x.address)))) {
        return cb(Object.assign(new Error('Destino bloqueado: o endereço aponta para uma rede interna.'), { code: 'EDESTINO' }), '', 0);
      }
      if (all) return cb(null, ips);
      const p = ips[0]!;
      cb(null, p.address, p.family);
    });
  };
}

/**
 * banco-seguranca: busca um endereço de terceiros (imagem do bot, página para a base da IA, webhook do bot) sem deixar
 * o servidor ser usado para chegar na rede interna (banco, Evolution, n8n, metadados da nuvem).
 * - Confere o endereço (texto) e, com a rede de verdade, o DNS: todos os IPs precisam ser públicos.
 * - Segue no máximo 3 redirecionamentos, conferindo cada destino de novo (um site público não manda para dentro).
 * Com `fetchFn` de teste e sem `resolver`, só a conferência do texto vale (os testes não têm DNS).
 */
export async function buscarSeguro(
  bruta: string | URL,
  init: RequestInit = {},
  o: { fetchFn?: typeof fetch; resolver?: (host: string) => Promise<string[]>; maxRedirecionamentos?: number; permitirHttp?: boolean } = {},
): Promise<Response> {
  const f = o.fetchFn ?? fetch;
  const resolver = o.resolver ?? (o.fetchFn ? undefined : resolverDns);
  const regras: OpcoesDestino = { producao: true, permitirHttp: o.permitirHttp ?? true };
  let atual = String(bruta);
  for (let salto = 0; ; salto++) {
    const url = resolver ? await conferirDestino(atual, { ...regras, resolver }) : conferirUrl(atual, regras);
    const r = await f(url, { ...init, redirect: 'manual' });
    const destino = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!destino) return r;
    if (salto >= (o.maxRedirecionamentos ?? 3)) throw new ErroDestino('O endereço redireciona vezes demais.');
    atual = new URL(destino, url).toString();
  }
}
