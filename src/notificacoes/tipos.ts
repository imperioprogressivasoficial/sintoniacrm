import { z } from 'zod';
import { minutosDoDia, partesBahia } from '../util/tempo.js';

/** Tipos de notificação (cada um pode ser ligado/desligado nas preferências). */
export const TIPOS_NOTIFICACAO = ['nova_cliente', 'mensagem', 'ia_equipe', 'espera', 'transferida', 'agendamento', 'agenda_mudou', 'lembrete_ligacao', 'falha'] as const;
/**
 * O que ainda vira notificação (só o que pede ação). "nova_cliente", "mensagem" e "agendamento" (a IA agendou)
 * não são mais criadas, e as antigas desses tipos não aparecem no sino nem contam (filtro na leitura).
 */
export const TIPOS_VISIVEIS = ['espera', 'ia_equipe', 'transferida', 'agenda_mudou', 'lembrete_ligacao', 'falha', 'teste'] as const;
/** Categorias que aparecem nas preferências (engrenagem), na ordem da tela. */
export const TIPOS_PREFERENCIA = ['espera', 'ia_equipe', 'transferida', 'agenda_mudou', 'lembrete_ligacao', 'falha'] as const;
export type TipoNotificacao = (typeof TIPOS_NOTIFICACAO)[number] | 'teste';

export const NOME_TIPO: Record<(typeof TIPOS_NOTIFICACAO)[number], string> = {
  nova_cliente: 'Nova cliente',
  mensagem: 'Mensagem da cliente',
  ia_equipe: 'A IA passou para a equipe',
  espera: 'Cliente esperando resposta',
  transferida: 'Conversa passada para você',
  agendamento: 'Agendamento feito (não é mais avisado)',
  agenda_mudou: 'Agendamento cancelado ou remarcado',
  lembrete_ligacao: 'Lembrete de ligação',
  falha: 'Problemas que impedem o trabalho (WhatsApp, chave da IA)',
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

/** Sons de mensagem (Web Audio, desenhados no app). */
export const SONS_MENSAGEM = ['futurista', 'gota', 'bolha', 'sininho', 'duplo'] as const;
/** Alarmes de cliente esperando. */
export const SONS_ALARME = ['futurista', 'sirene'] as const;
export type SomAlarme = (typeof SONS_ALARME)[number];
export type SomMensagem = (typeof SONS_MENSAGEM)[number];

const HORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const EsquemaPreferencias = z.object({
  tipos: z.object(Object.fromEntries(TIPOS_NOTIFICACAO.map((t) => [t, z.boolean()])) as Record<(typeof TIPOS_NOTIFICACAO)[number], z.ZodBoolean>).partial(),
  som: z.boolean(),
  push: z.boolean(),
  naoPerturbe: z.object({ ligado: z.boolean(), inicio: HORA, fim: HORA }),
  mensagens: z.object({ push: z.boolean(), som: z.boolean(), vibrar: z.boolean(), tipoSom: z.enum(SONS_MENSAGEM), volume: z.number().int().min(0).max(100) }).partial(),
  espera: z.object({ push: z.boolean(), alarme: z.boolean(), tipoAlarme: z.enum(SONS_ALARME), volume: z.number().int().min(0).max(100), silencioAte: z.string().datetime().nullable() }).partial(),
});
export type Preferencias = {
  tipos: Record<(typeof TIPOS_NOTIFICACAO)[number], boolean>;
  som: boolean;
  push: boolean;
  naoPerturbe: { ligado: boolean; inicio: string; fim: string };
  /** Cada mensagem recebida: push que toca de novo, som e vibração com o app aberto. */
  mensagens: { push: boolean; som: boolean; vibrar: boolean; tipoSom: SomMensagem; volume: number };
  /** Cliente esperando: push dos alertas, alarme repetido no app e silêncio temporário (ISO ou null). */
  espera: { push: boolean; alarme: boolean; tipoAlarme: SomAlarme; volume: number; silencioAte: string | null };
};

export const PREFERENCIAS_PADRAO: Preferencias = {
  tipos: Object.fromEntries(TIPOS_NOTIFICACAO.map((t) => [t, true])) as Preferencias['tipos'],
  som: true,
  push: true,
  naoPerturbe: { ligado: false, inicio: '22:00', fim: '07:00' },
  mensagens: { push: true, som: true, vibrar: true, tipoSom: 'futurista', volume: 70 },
  espera: { push: true, alarme: true, tipoAlarme: 'futurista', volume: 80, silencioAte: null },
};

/** Junta o que está guardado com o padrão (tipos novos nascem ligados). */
export function completarPreferencias(p?: Partial<Preferencias> | null): Preferencias {
  return {
    tipos: { ...PREFERENCIAS_PADRAO.tipos, ...(p?.tipos ?? {}) },
    som: p?.som ?? PREFERENCIAS_PADRAO.som,
    push: p?.push ?? PREFERENCIAS_PADRAO.push,
    naoPerturbe: { ...PREFERENCIAS_PADRAO.naoPerturbe, ...(p?.naoPerturbe ?? {}) },
    mensagens: { ...PREFERENCIAS_PADRAO.mensagens, ...(p?.mensagens ?? {}) },
    espera: { ...PREFERENCIAS_PADRAO.espera, ...(p?.espera ?? {}) },
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

/** A pessoa silenciou os alertas de espera até um horário que ainda não passou? */
export function esperaSilenciada(p: Preferencias, agora: Date): boolean {
  return Boolean(p.espera.silencioAte && new Date(p.espera.silencioAte).getTime() > agora.getTime());
}
