/**
 * Horário da Bahia. America/Bahia é UTC-3 o ano todo (sem horário de verão),
 * então um deslocamento fixo é exato e evita depender do fuso do servidor.
 */
const OFFSET_MIN = -3 * 60;

export interface PartesData {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  diaSemana: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

export function partesBahia(d: Date): PartesData {
  const local = new Date(d.getTime() + OFFSET_MIN * 60_000);
  return {
    ano: local.getUTCFullYear(),
    mes: local.getUTCMonth() + 1,
    dia: local.getUTCDate(),
    hora: local.getUTCHours(),
    minuto: local.getUTCMinutes(),
    diaSemana: local.getUTCDay() as PartesData['diaSemana'],
  };
}

/** Constrói o instante correspondente a uma data/hora local da Bahia. */
export function bahia(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  return new Date(Date.UTC(ano, mes - 1, dia, hora, minuto) - OFFSET_MIN * 60_000);
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** "AAAA-MM-DD" no horário da Bahia. */
export function dataISO(d: Date): string {
  const p = partesBahia(d);
  return `${p.ano}-${p2(p.mes)}-${p2(p.dia)}`;
}

/** "HH:mm" no horário da Bahia. */
export function horaHHmm(d: Date): string {
  const p = partesBahia(d);
  return `${p2(p.hora)}:${p2(p.minuto)}`;
}

/** Data/hora local sem fuso, no formato que o Trinks espera: "2026-10-01T14:30:00". */
export function dataHoraLocalTrinks(d: Date): string {
  return `${dataISO(d)}T${horaHHmm(d)}:00`;
}

/** Interpreta "AAAA-MM-DD" + "HH:mm" como horário da Bahia. */
export function deDataEHora(data: string, hora: string): Date {
  const md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const mh = /^(\d{1,2}):(\d{2})$/.exec(hora);
  if (!md || !mh) throw new Error(`Data/hora inválida: ${data} ${hora}`);
  return bahia(Number(md[1]), Number(md[2]), Number(md[3]), Number(mh[1]), Number(mh[2]));
}

export function minutosDoDia(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export const MIN = 60_000;
export const HORA = 60 * MIN;
export const DIA = 24 * HORA;

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export function nomeDiaSemana(d: Date): string {
  return DIAS[partesBahia(d).diaSemana]!;
}
