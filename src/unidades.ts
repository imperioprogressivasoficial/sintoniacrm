import type { UnidadeId } from './domain.js';

/** Dia da semana como em Date.getDay(): 0 = domingo … 6 = sábado. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Faixa de funcionamento em "HH:mm". */
export interface Faixa {
  abre: string;
  fecha: string;
}

export interface Unidade {
  id: UnidadeId;
  nome: string;
  /** Header `estabelecimentoId` da API do Trinks. null = unidade ainda sem Trinks. */
  trinksEstabelecimentoId: string | null;
  /** Horário de atendimento da equipe. Fora dele a IA atende sozinha. */
  horario: Partial<Record<DiaSemana, Faixa>>;
  /** Unidade aberta para agendamento? (Feira está em obras.) */
  agendaAberta: boolean;
}

// IDs do Trinks confirmados no fluxo "Retoquei | Aniversário" do n8n.
// Horários abaixo são PADRÃO DE SHOPPING e precisam ser confirmados pela Império.
const HORARIO_SHOPPING: Unidade['horario'] = {
  1: { abre: '10:00', fecha: '22:00' },
  2: { abre: '10:00', fecha: '22:00' },
  3: { abre: '10:00', fecha: '22:00' },
  4: { abre: '10:00', fecha: '22:00' },
  5: { abre: '10:00', fecha: '22:00' },
  6: { abre: '10:00', fecha: '22:00' },
  0: { abre: '14:00', fecha: '20:00' },
};

export const UNIDADES: Record<UnidadeId, Unidade> = {
  norte: {
    id: 'norte',
    nome: 'Salvador Norte Shopping',
    trinksEstabelecimentoId: '240643',
    horario: HORARIO_SHOPPING,
    agendaAberta: true,
  },
  sumare: {
    id: 'sumare',
    nome: 'Shopping Sumaré',
    trinksEstabelecimentoId: '222074',
    horario: HORARIO_SHOPPING,
    agendaAberta: true,
  },
  feira: {
    id: 'feira',
    nome: 'Feira de Santana',
    trinksEstabelecimentoId: null,
    horario: {},
    agendaAberta: false,
  },
};

export function unidadePorNome(texto: string): Unidade | undefined {
  const t = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (t.includes('norte')) return UNIDADES.norte;
  if (t.includes('sumare')) return UNIDADES.sumare;
  if (t.includes('feira')) return UNIDADES.feira;
  return undefined;
}
