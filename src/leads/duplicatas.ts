import { chaveTelefone } from './telefone-br.js';

/**
 * Detecção de leads duplicados. Um "lead" é um telefone da empresa: a ficha do contato (se houver) e as
 * conversas com esse número (uma por unidade). Duplicata = dois telefones diferentes que parecem a mesma pessoa:
 * - mesmo número normalizado (com/sem 55, com/sem o 9º dígito, com máscara);
 * - mesmo e-mail;
 * - nomes muito parecidos com o mesmo final de telefone (4 últimos dígitos).
 * Funções puras: o serviço (leads.ts) monta a lista e aplica as marcações de "não é duplicata".
 */

export interface LeadParaComparar {
  telefone: string;
  nome?: string | null;
  email?: string | null;
}

export type MotivoDuplicata = 'telefone' | 'email' | 'nome';

export const NOME_MOTIVO: Record<MotivoDuplicata, string> = {
  telefone: 'Mesmo telefone',
  email: 'Mesmo e-mail',
  nome: 'Nome parecido e mesmo final de telefone',
};

export interface GrupoDuplicata {
  /** Chave estável do grupo (telefones em ordem, separados por "|"). */
  id: string;
  telefones: string[];
  motivos: MotivoDuplicata[];
}

/** "Maria José da Silva" → "maria jose da silva" (sem acento, sem pontuação). */
export function normalizarNome(n: string | null | undefined): string {
  return String(n ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let ant = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(ant[j]! + 1, atual[j - 1]! + 1, ant[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    ant = atual;
  }
  return ant[b.length]!;
}

const POUCO = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const palavras = (n: string) => n.split(' ').filter((p) => p.length > 1 && !POUCO.has(p));

/** Nomes "muito parecidos": iguais sem acento, quase iguais (erro de digitação) ou um contido no outro com o mesmo primeiro nome. */
export function nomesParecidos(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizarNome(a);
  const y = normalizarNome(b);
  if (x.length < 3 || y.length < 3) return false;
  if (x === y) return true;
  const maior = Math.max(x.length, y.length);
  if (1 - levenshtein(x, y) / maior >= 0.85) return true;
  const px = palavras(x);
  const py = palavras(y);
  if (!px.length || !py.length || px[0] !== py[0]) return false;
  const [menor, outro] = px.length <= py.length ? [px, new Set(py)] : [py, new Set(px)];
  return menor.length >= 2 && menor.every((p) => outro.has(p));
}

const par = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const chavePar = par;

/**
 * Agrupa os leads duplicados. `naoDuplicatas` são pares (chavePar) marcados pela equipe como pessoas diferentes:
 * esses pares não juntam grupo.
 */
export function encontrarDuplicatas(leads: LeadParaComparar[], naoDuplicatas: Set<string> = new Set()): GrupoDuplicata[] {
  const porTel = new Map<string, LeadParaComparar>();
  for (const l of leads) if (l.telefone && !porTel.has(l.telefone)) porTel.set(l.telefone, l);
  const lista = [...porTel.values()];
  const arestas = new Map<string, Set<MotivoDuplicata>>();
  const ligar = (a: string, b: string, m: MotivoDuplicata) => {
    if (a === b) return;
    const k = par(a, b);
    if (naoDuplicatas.has(k)) return;
    const s = arestas.get(k) ?? new Set();
    s.add(m);
    arestas.set(k, s);
  };
  const baldes = (chave: (l: LeadParaComparar) => string | null) => {
    const m = new Map<string, LeadParaComparar[]>();
    for (const l of lista) {
      const k = chave(l);
      if (!k) continue;
      const b = m.get(k) ?? [];
      b.push(l);
      m.set(k, b);
    }
    return [...m.values()].filter((b) => b.length > 1);
  };
  for (const b of baldes((l) => chaveTelefone(l.telefone))) for (let i = 1; i < b.length; i++) for (let j = 0; j < i; j++) ligar(b[i]!.telefone, b[j]!.telefone, 'telefone');
  for (const b of baldes((l) => (l.email ? l.email.trim().toLowerCase() : null))) for (let i = 1; i < b.length; i++) for (let j = 0; j < i; j++) ligar(b[i]!.telefone, b[j]!.telefone, 'email');
  // Nome parecido só é comparado dentro do mesmo final de telefone (evita comparar todo mundo com todo mundo).
  for (const b of baldes((l) => {
    const d = chaveTelefone(l.telefone);
    return d.length >= 8 ? d.slice(-4) : null;
  })) {
    for (let i = 1; i < b.length; i++) {
      for (let j = 0; j < i; j++) {
        if (chaveTelefone(b[i]!.telefone) === chaveTelefone(b[j]!.telefone)) continue; // já ligado por telefone
        if (nomesParecidos(b[i]!.nome, b[j]!.nome)) ligar(b[i]!.telefone, b[j]!.telefone, 'nome');
      }
    }
  }

  // Componentes conexos (union-find).
  const pai = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (pai.get(r) && pai.get(r) !== r) r = pai.get(r)!;
    pai.set(x, r);
    return r;
  };
  for (const k of arestas.keys()) {
    const [a, b] = k.split('|') as [string, string];
    if (!pai.has(a)) pai.set(a, a);
    if (!pai.has(b)) pai.set(b, b);
    const ra = raiz(a);
    const rb = raiz(b);
    if (ra !== rb) pai.set(ra, rb);
  }
  const grupos = new Map<string, { telefones: Set<string>; motivos: Set<MotivoDuplicata> }>();
  for (const [k, motivos] of arestas) {
    const [a, b] = k.split('|') as [string, string];
    const r = raiz(a);
    const g = grupos.get(r) ?? { telefones: new Set(), motivos: new Set() };
    g.telefones.add(a);
    g.telefones.add(b);
    for (const m of motivos) g.motivos.add(m);
    grupos.set(r, g);
  }
  const ordem: MotivoDuplicata[] = ['telefone', 'email', 'nome'];
  return [...grupos.values()]
    .map((g) => {
      const telefones = [...g.telefones].sort();
      return { id: telefones.join('|'), telefones, motivos: ordem.filter((m) => g.motivos.has(m)) };
    })
    .sort((a, b) => ordem.indexOf(a.motivos[0]!) - ordem.indexOf(b.motivos[0]!) || a.id.localeCompare(b.id));
}
