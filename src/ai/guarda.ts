/**
 * ia-completa: as travas de segurança da IA de atendimento, num lugar só (usadas pelo agente padrão e pelos agentes
 * do estúdio). Tudo aqui é determinístico: não depende do modelo "se comportar".
 *
 * - Preço: todo valor em reais que a IA escreve precisa ter vindo do sistema (agenda, cadastro de produtos, base de
 *   conhecimento ou produtos do lead). Valor inventado não sai para a cliente.
 * - WhatsApp: resposta sem markdown e partida em mensagens curtas (no máximo 3), nunca um "textão".
 * - Feriados nacionais: a IA avisa a cliente quando o dia escolhido é feriado.
 * - Custo: limite de uso da IA por conversa por dia, com aviso para a equipe.
 */

// ---------------------------------------------------------------- preços

/** Converte "1.250,50" / "150" / "150,00" / "150.00" em centavos. */
function centavosDe(bruto: string): number | null {
  let t = bruto.trim();
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Valores em reais citados num texto ("R$ 150", "R$1.250,00", "150 reais"), em centavos. */
export function precosDoTexto(texto: string): number[] {
  const r: number[] = [];
  for (const m of texto.matchAll(/R\$\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/gi)) {
    const c = centavosDe(m[1]!);
    if (c !== null) r.push(c);
  }
  for (const m of texto.matchAll(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(?:reais|real)\b/gi)) {
    const c = centavosDe(m[1]!);
    if (c !== null) r.push(c);
  }
  return r;
}

/** Junta ao conjunto os valores de um resultado de ferramenta (chaves com "preco", "valor", "total"). */
export function anotarPrecosDe(obj: unknown, conhecidos: Set<number>, profundidade = 0): void {
  if (profundidade > 6 || obj === null || obj === undefined) return;
  if (Array.isArray(obj)) {
    for (const x of obj) anotarPrecosDe(x, conhecidos, profundidade + 1);
    return;
  }
  if (typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'number' && /preco|valor|total|desconto/i.test(k) && Number.isFinite(v)) conhecidos.add(Math.round(v * 100));
    else if (typeof v === 'string' && /preco|valor|total/i.test(k)) for (const c of precosDoTexto(v)) conhecidos.add(c);
    else if (typeof v === 'object') anotarPrecosDe(v, conhecidos, profundidade + 1);
  }
}

/** Valores que aparecem em textos de referência (base de conhecimento, produtos do lead). */
export function precosConhecidosDe(textos: Array<string | null | undefined>): Set<number> {
  const s = new Set<number>();
  for (const t of textos) if (t) for (const c of precosDoTexto(t)) s.add(c);
  return s;
}

/**
 * Valores da resposta que NÃO vieram do sistema. Somas simples de dois valores conhecidos (ex.: dois serviços)
 * e o dobro/triplo de um valor (quantidade) também valem.
 */
export function precosInventados(texto: string, conhecidos: Set<number>): number[] {
  const lista = [...conhecidos];
  const vale = (c: number) => {
    if (conhecidos.has(c)) return true;
    for (const a of lista) {
      if (c === a * 2 || c === a * 3) return true;
      for (const b of lista) if (a + b === c) return true;
    }
    return false;
  };
  return [...new Set(precosDoTexto(texto))].filter((c) => !vale(c));
}

export const reais = (centavos: number) => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

// ---------------------------------------------------------------- WhatsApp

/** Tamanho máximo de cada mensagem e quantas mensagens a IA manda de uma vez. */
export const LIMITE_MENSAGEM = 700;
export const MAX_PARTES = 3;

/** Tira o markdown que o WhatsApp mostraria cru (títulos, negrito duplo, listas com "-"/"*", links markdown). */
export function limparMarkdown(texto: string): string {
  return texto
    .replace(/\r/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Parte a resposta em até `maxPartes` mensagens de até `limite` letras, cortando em parágrafo ou frase.
 * O que passar disso é cortado com "…" (a IA foi instruída a ser curta; isto é a rede de segurança).
 */
export function partirParaWhatsApp(bruto: string, limite = LIMITE_MENSAGEM, maxPartes = MAX_PARTES): string[] {
  // serena-regras (item 8): a IA separa as mensagens com uma linha só com "---" (1 a 3 mensagens naturais).
  const blocos = bruto.replace(/\r/g, '').split(/\n[ \t]*-{3,}[ \t]*(?:\n|$)|^[ \t]*-{3,}[ \t]*\n/);
  if (blocos.length > 1) {
    const partes = blocos.flatMap((b) => partirUm(b, limite, maxPartes)).filter(Boolean);
    if (partes.length <= maxPartes) return partes;
    // Mais partes que o limite: as que sobram vão juntas na última (nada se perde).
    const ficam = partes.slice(0, maxPartes - 1);
    return [...ficam, ...partirUm(partes.slice(maxPartes - 1).join('\n\n'), limite, 1)];
  }
  return partirUm(bruto, limite, maxPartes);
}

function partirUm(bruto: string, limite: number, maxPartes: number): string[] {
  const texto = limparMarkdown(bruto);
  if (!texto) return [];
  if (texto.length <= limite) return [texto];
  const pedacos: string[] = [];
  // Unidades: parágrafos; parágrafo longo vira frases; frase longa vira palavras.
  for (const par of texto.split(/\n{2,}/)) {
    if (par.length <= limite) pedacos.push(par);
    else
      for (const frase of par.split(/(?<=[.!?…])\s+/)) {
        if (frase.length <= limite) pedacos.push(frase);
        else {
          let atual = '';
          for (const palavra of frase.split(/\s+/)) {
            if ((atual + ' ' + palavra).trim().length > limite) {
              if (atual) pedacos.push(atual);
              atual = palavra.slice(0, limite);
            } else atual = (atual + ' ' + palavra).trim();
          }
          if (atual) pedacos.push(atual);
        }
      }
  }
  const partes: string[] = [];
  let atual = '';
  for (const p of pedacos) {
    const junto = atual ? `${atual}${p.includes('\n') || atual.includes('\n') ? '\n\n' : ' '}${p}` : p;
    if (junto.length <= limite) atual = junto;
    else {
      if (atual) partes.push(atual);
      atual = p;
    }
  }
  if (atual) partes.push(atual);
  if (partes.length <= maxPartes) return partes;
  const ficam = partes.slice(0, maxPartes);
  const ult = ficam[maxPartes - 1]!;
  ficam[maxPartes - 1] = ult.length > limite - 1 ? `${ult.slice(0, limite - 1)}…` : `${ult}…`;
  return ficam;
}

// ---------------------------------------------------------------- feriados nacionais

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC. */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

const FIXOS: Record<string, string> = {
  '01-01': 'Confraternização Universal',
  '04-21': 'Tiradentes',
  '05-01': 'Dia do Trabalho',
  '09-07': 'Independência do Brasil',
  '10-12': 'Nossa Senhora Aparecida',
  '11-02': 'Finados',
  '11-15': 'Proclamação da República',
  '11-20': 'Dia da Consciência Negra',
  '12-25': 'Natal',
};

/** Nome do feriado nacional (ou ponto facultativo nacional, como o Carnaval) da data AAAA-MM-DD; null se não for. */
export function feriadoNacional(data: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) return null;
  const fixo = FIXOS[`${m[2]}-${m[3]}`];
  if (fixo) return fixo;
  const p = pascoa(Number(m[1])).getTime();
  const dia = (n: number) => new Date(p + n * 86_400_000).toISOString().slice(0, 10);
  const moveis: Record<string, string> = {
    [dia(-48)]: 'Carnaval',
    [dia(-47)]: 'Carnaval',
    [dia(-2)]: 'Sexta-feira Santa',
    [dia(60)]: 'Corpus Christi',
  };
  return moveis[data] ?? null;
}

/** A data existe no calendário (recusa 2026-02-30)? */
export function dataValida(data: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.toISOString().slice(0, 10) === data;
}

// ---------------------------------------------------------------- custo por conversa

export interface UsoChamada {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

/** "Tokens equivalentes": leitura de cache custa ~1/10 de uma entrada normal. */
export const tokensEquivalentes = (u: UsoChamada) => u.entrada + u.saida + u.cacheEscrita + Math.round(u.cacheLeitura / 10);

/**
 * Limite de uso da IA por conversa por dia (proteção contra conversa em laço ou cliente que "conversa" sem parar).
 * Guarda em memória (some ao reiniciar: o limite volta a contar do zero, o que só deixa a IA mais livre).
 * O medidor de uso (src/planos/medidor.ts) chama `anotar` a cada chamada da IA, já com a conversa.
 */
export class GuardaCusto {
  private readonly uso = new Map<string, number>();
  private readonly avisados = new Set<string>();

  constructor(
    readonly limitePorConversaDia: number,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  private chave(conversaId: string, em = this.agora()) {
    return `${conversaId}|${new Date(em.getTime() - 3 * 3600_000).toISOString().slice(0, 10)}`;
  }

  anotar(conversaId: string | null, u: UsoChamada): void {
    if (!conversaId || this.limitePorConversaDia <= 0) return;
    const k = this.chave(conversaId);
    this.uso.set(k, (this.uso.get(k) ?? 0) + tokensEquivalentes(u));
    if (this.uso.size > 20_000) {
      // Só o dia de hoje importa: limpa o resto.
      const hoje = this.chave('', this.agora()).slice(1);
      for (const x of [...this.uso.keys()]) if (!x.endsWith(hoje)) this.uso.delete(x);
    }
  }

  usado(conversaId: string): number {
    return this.uso.get(this.chave(conversaId)) ?? 0;
  }

  /** 'ok' | 'perto' (80%: aviso uma vez) | 'estourou'. */
  situacao(conversaId: string): 'ok' | 'perto' | 'estourou' {
    if (this.limitePorConversaDia <= 0) return 'ok';
    const u = this.usado(conversaId);
    if (u >= this.limitePorConversaDia) return 'estourou';
    return u >= this.limitePorConversaDia * 0.8 ? 'perto' : 'ok';
  }

  /** true só na primeira vez do dia em que a conversa chega a esta situação (para avisar uma vez só). */
  primeiroAviso(conversaId: string, situacao: 'perto' | 'estourou'): boolean {
    const k = `${situacao}|${this.chave(conversaId)}`;
    if (this.avisados.has(k)) return false;
    this.avisados.add(k);
    if (this.avisados.size > 20_000) this.avisados.clear();
    return true;
  }
}
