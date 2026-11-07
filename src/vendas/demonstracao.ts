/**
 * Horários da demonstração marcada pela página de vendas: próximos dias úteis (seg. a sex.),
 * das 9h às 18h no horário de Brasília (UTC-3, sem horário de verão), de 30 em 30 minutos.
 */

const FUSO_MS = -3 * 60 * 60_000;
export const DIAS_DEMONSTRACAO = 10;
/** Antecedência mínima para um horário aparecer como livre. */
const ANTECEDENCIA_MS = 2 * 60 * 60_000;

export interface DiaDemonstracao {
  data: string; // AAAA-MM-DD (Brasília)
  horas: string[]; // HH:MM
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

/** Data e hora de Brasília → instante. */
export function instanteBrasilia(data: string, hora: string): Date | undefined {
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const mh = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!md || !mh) return undefined;
  const [a, m, d, h, min] = [md[1], md[2], md[3], mh[1], mh[2]].map(Number) as [number, number, number, number, number];
  const utc = Date.UTC(a, m - 1, d, h, min) - FUSO_MS;
  const volta = new Date(utc + FUSO_MS);
  if (volta.getUTCFullYear() !== a || volta.getUTCMonth() !== m - 1 || volta.getUTCDate() !== d || volta.getUTCHours() !== h) return undefined;
  return new Date(utc);
}

/** Todas as horas de início possíveis num dia (9h00 a 17h30). */
export const HORAS_DEMONSTRACAO = Array.from({ length: 18 }, (_, i) => `${doisDigitos(9 + Math.floor(i / 2))}:${i % 2 ? '30' : '00'}`);

/** Os próximos dias úteis com as horas ainda livres (sem as ocupadas e sem as que estão perto demais). */
export function diasDemonstracao(agora: Date, ocupadas: Date[] = [], dias = DIAS_DEMONSTRACAO): DiaDemonstracao[] {
  const tomadas = new Set(ocupadas.map((d) => d.getTime()));
  const local = new Date(agora.getTime() + FUSO_MS);
  const saida: DiaDemonstracao[] = [];
  for (let i = 0; saida.length < dias && i < dias * 2 + 7; i++) {
    const dia = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i));
    const semana = dia.getUTCDay();
    if (semana === 0 || semana === 6) continue;
    const data = `${dia.getUTCFullYear()}-${doisDigitos(dia.getUTCMonth() + 1)}-${doisDigitos(dia.getUTCDate())}`;
    const horas = HORAS_DEMONSTRACAO.filter((h) => {
      const t = instanteBrasilia(data, h)!.getTime();
      return t - agora.getTime() >= ANTECEDENCIA_MS && !tomadas.has(t);
    });
    if (horas.length) saida.push({ data, horas });
  }
  return saida;
}

/** Confere se data/hora é um horário oferecido (ignorando os ocupados, que o banco confere). */
export function horarioValido(data: string, hora: string, agora: Date): Date | undefined {
  const dia = diasDemonstracao(agora).find((d) => d.data === data);
  if (!dia || !dia.horas.includes(hora)) return undefined;
  return instanteBrasilia(data, hora);
}

/** Intervalo coberto pela lista de dias (para buscar os ocupados). */
export function janelaDemonstracao(agora: Date): { de: Date; ate: Date } {
  return { de: agora, ate: new Date(agora.getTime() + (DIAS_DEMONSTRACAO * 2 + 8) * 24 * 60 * 60_000) };
}
