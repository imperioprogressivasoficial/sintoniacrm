import { z } from 'zod';
import { minutosDoDia, partesBahia } from '../util/tempo.js';

/** Tipos de notificação (cada um pode ser ligado/desligado nas preferências). */
export const TIPOS_NOTIFICACAO = ['nova_cliente', 'mensagem', 'ia_equipe', 'espera', 'transferida', 'agendamento', 'lembrete_ligacao', 'falha'] as const;
export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number] | 'teste';

export const NOME_TIPO: Record<(typeof TIPOS_NOTIFICACAO)[number], string> = {
  nova_cliente: 'Nova cliente',
  mensagem: 'Mensagem da cliente',
  ia_equipe: 'A IA passou para a equipe',
  espera: 'Cliente esperando resposta',
  transferida: 'Conversa passada para você',
  agendamento: 'Agendamento feito',
  lembrete_ligacao: 'Lembrete de ligação',
  falha: 'Falhas (WhatsApp, chave da IA)',
};

export interface Notificacao {
  id: string;
  usuarioId: string;
  tipo: TipoNotificacao;
  titulo: string;
  texto: string;
  conversaId?: string;
  /** Tela do app que abre quando não é de conversa (ex.: conexoes, ligacoes). */
  vista?: string;
  /** Quantas mensagens foram juntadas nesta notificação. */
  contador: number;
  chave?: string;
  criadaEm: Date;
  atualizadaEm: Date;
  lidaEm?: Date;
  entregueEm?: Date;
}

export type NovaNotificacao = Omit<Notificacao, 'id' | 'atualizadaEm' | 'lidaEm' | 'entregueEm' | 'contador'> & { contador?: number; entregueEm?: Date };

export interface InscricaoPush {
  endpoint: string;
  usuarioId: string;
  p256dh: string;
  auth: string;
  agente?: string;
}

const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const EsquemaPreferencias = z.object({
  tipos: z.object(Object.fromEntries(TIPOS_NOTIFICACAO.map((t) => [t, z.boolean()])) as Record<(typeof TIPOS_NOTIFICACAO)[number], z.ZodBoolean>).partial(),
  som: z.boolean(),
  push: z.boolean(),
  naoPerturbe: z.object({ ligado: z.boolean(), inicio: HORA, fim: HORA }),
});
export type Preferencias = {
  tipos: Record<(typeof TIPOS_NOTIFICACAO)[number], boolean>;
  som: boolean;
  push: boolean;
  naoPerturbe: { ligado: boolean; inicio: string; fim: string };
};

export const PREFERENCIAS_PADRAO: Preferencias = {
  tipos: Object.fromEntries(TIPOS_NOTIFICACAO.map((t) => [t, true])) as Preferencias['tipos'],
  som: true,
  push: true,
  naoPerturbe: { ligado: false, inicio: '22:00', fim: '07:00' },
};

/** Junta o que está guardado com o padrão (tipos novos nascem ligados). */
export function completarPreferencias(p?: Partial<Preferencias> | null): Preferencias {
  return {
    tipos: { ...PREFERENCIAS_PADRAO.tipos, ...(p?.tipos ?? {}) },
    som: p?.som ?? PREFERENCIAS_PADRAO.som,
    push: p?.push ?? PREFERENCIAS_PADRAO.push,
    naoPerturbe: { ...PREFERENCIAS_PADRAO.naoPerturbe, ...(p?.naoPerturbe ?? {}) },
  };
}

/** Está no horário de "não perturbe" (horário da Bahia)? Aceita faixa que passa da meia-noite (22:00–07:00). */
export function emNaoPerturbe(p: Preferencias, agora: Date): boolean {
  if (!p.naoPerturbe.ligado) return false;
  const h = partesBahia(agora);
  const m = h.hora * 60 + h.minuto;
  const ini = minutosDoDia(p.naoPerturbe.inicio);
  const fim = minutosDoDia(p.naoPerturbe.fim);
  if (ini === fim) return false;
  return ini < fim ? m >= ini && m < fim : m >= ini || m < fim;
}
