import type { Conversa } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { bahia, DIA, partesBahia } from '../util/tempo.js';

/** Aba "Atualizações": o que aconteceu hoje, em frases curtas, do mais novo para o mais antigo. */
export interface Atualizacao {
  tipo: 'agendamento' | 'ia_assumiu' | 'pediu_ajuda' | 'lembrete' | 'followup' | 'nova_cliente' | 'falha';
  em: Date;
  conversaId?: string;
  cliente?: string;
  titulo: string;
  detalhe?: string;
}

const ENVIOS: Record<string, { tipo: Atualizacao['tipo']; texto: string }> = {
  lembrete_vespera: { tipo: 'lembrete', texto: 'Lembrete da véspera enviado' },
  lembrete_2h: { tipo: 'lembrete', texto: 'Lembrete de 2 horas antes enviado' },
  followup_1h: { tipo: 'followup', texto: 'Follow-up enviado (sem resposta há 1 hora)' },
  followup_1d: { tipo: 'followup', texto: 'Follow-up enviado (sem resposta há 1 dia)' },
  followup_3d: { tipo: 'followup', texto: 'Último follow-up enviado (3 dias)' },
  recuperar_falta: { tipo: 'followup', texto: 'Mensagem para remarcar quem faltou' },
  manutencao_90d: { tipo: 'followup', texto: 'Convite para a manutenção (90 dias)' },
  pos_atendimento: { tipo: 'followup', texto: 'Mensagem de pós-atendimento enviada' },
};

const horaBahia = (iso: unknown) => {
  if (typeof iso !== 'string') return '';
  const p = partesBahia(new Date(iso));
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} às ${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
};

export function descrever(e: Evento, c: Conversa | undefined): Atualizacao | null {
  const base = { em: e.em, conversaId: e.conversaId, cliente: c?.nome ?? undefined };
  const d = e.dados ?? {};
  switch (e.tipo) {
    case 'agendamento_ia':
    case 'agendamento_equipe': {
      const quem = e.tipo === 'agendamento_ia' ? 'A IA' : String(d.atendente ?? 'A equipe');
      return { ...base, tipo: 'agendamento', titulo: `${quem} agendou ${String(d.servico ?? 'um horário')}`, detalhe: horaBahia(d.inicio) };
    }
    case 'ia_assumiu':
      return { ...base, tipo: 'ia_assumiu', titulo: 'A IA assumiu a conversa', detalhe: 'Ninguém da equipe respondeu a tempo' };
    case 'passou_para_humano':
      return { ...base, tipo: 'pediu_ajuda', titulo: 'A IA pediu ajuda da equipe', detalhe: d.motivo ? String(d.motivo) : undefined };
    case 'envio_ativo': {
      const info = ENVIOS[String(d.tipo)];
      return info ? { ...base, tipo: info.tipo, titulo: info.texto } : null;
    }
    case 'conversa_nova':
      return { ...base, tipo: 'nova_cliente', titulo: 'Nova cliente chamou no WhatsApp' };
    case 'falha':
      return { ...base, tipo: 'falha', titulo: 'Algo falhou e será tentado de novo', detalhe: d.erro ? String(d.erro).slice(0, 140) : undefined };
    default:
      return null;
  }
}

/** Atualizações de hoje (horário da Bahia). `podeVer` filtra pelo que a pessoa logada pode ver. */
export async function atualizacoesDeHoje(
  repo: Repositorio,
  agora: Date,
  podeVer: (c: Conversa | undefined, tipo: Atualizacao['tipo']) => boolean = () => true,
  limite = 200,
): Promise<Atualizacao[]> {
  const p = partesBahia(agora);
  const inicio = bahia(p.ano, p.mes, p.dia);
  const eventos = await repo.eventosEntre(inicio, new Date(inicio.getTime() + DIA));
  const conversas = new Map((await repo.listarConversas()).map((c) => [c.id, c]));
  const saida: Atualizacao[] = [];
  for (const e of eventos) {
    const c = e.conversaId ? conversas.get(e.conversaId) : undefined;
    const a = descrever(e, c);
    if (a && podeVer(c, a.tipo)) saida.push(a);
  }
  return saida.sort((x, y) => y.em.getTime() - x.em.getTime()).slice(0, limite);
}
