import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { DIA } from '../util/tempo.js';

/**
 * Aba "Ligações": quem precisa de uma ligação e o registro do que aconteceu.
 * A ligação em si sai do celular da atendente (telefone ou WhatsApp): a Evolution não faz chamadas de voz.
 */

export type MotivoLigacao = 'nao_responde' | 'interessada_sem_agendar' | 'faltou';
export type ResultadoLigacao = 'atendeu' | 'nao_atendeu' | 'agendou' | 'caixa_postal';

export interface SugestaoLigacao {
  conversaId: string;
  cliente: string | null;
  telefone: string;
  unidade: Conversa['unidade'];
  motivo: MotivoLigacao;
  texto: string;
  desde: Date;
}

const HORA = 3600_000;
const RESULTADOS: Record<ResultadoLigacao, string> = {
  atendeu: 'atendeu',
  nao_atendeu: 'não atendeu',
  agendou: 'agendou',
  caixa_postal: 'caiu na caixa postal',
};

const dias = (ms: number) => Math.max(1, Math.round(ms / DIA));

/** Quem ligar hoje. Não repete quem já recebeu ligação nas últimas 20 horas. */
export async function quemLigar(
  repo: Repositorio,
  agora: Date,
  podeVer: (c: Conversa) => boolean = () => true,
): Promise<SugestaoLigacao[]> {
  const semana = new Date(agora.getTime() - 7 * DIA);
  const eventos = await repo.eventosEntre(semana, new Date(agora.getTime() + 1));
  const ligouRecente = new Set(eventos.filter((e) => e.tipo === 'ligacao' && agora.getTime() - e.em.getTime() < 20 * HORA).map((e) => e.conversaId));
  const faltas = new Map<string, Date>();
  for (const e of eventos) if (e.tipo === 'envio_ativo' && e.dados?.tipo === 'recuperar_falta' && e.conversaId) faltas.set(e.conversaId, e.em);

  const saida: SugestaoLigacao[] = [];
  for (const c of await repo.listarConversas()) {
    if (!podeVer(c) || ligouRecente.has(c.id)) continue;
    const base = { conversaId: c.id, cliente: c.nome ?? null, telefone: c.telefone, unidade: c.unidade };
    const falta = faltas.get(c.id);
    if (falta) {
      saida.push({ ...base, motivo: 'faltou', texto: 'Faltou ao horário: ligar para remarcar', desde: falta });
      continue;
    }
    if (c.etapa === 'agendada' || c.etapa === 'compareceu' || c.etapa === 'perdida') continue;
    const cliente = c.ultimaMensagemCliente?.getTime() ?? 0;
    const nossa = Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
    // Nós falamos por último e ela sumiu há mais de 1 dia (e menos de 7).
    if (nossa > cliente && agora.getTime() - nossa > DIA && agora.getTime() - nossa < 7 * DIA) {
      saida.push({
        ...base,
        motivo: c.etapa === 'interessada' ? 'interessada_sem_agendar' : 'nao_responde',
        texto: c.etapa === 'interessada' ? `Interessada e não agendou: sem resposta há ${dias(agora.getTime() - nossa)} dia(s)` : `Não responde há ${dias(agora.getTime() - nossa)} dia(s)`,
        desde: new Date(nossa),
      });
    }
  }
  const peso: Record<MotivoLigacao, number> = { faltou: 0, interessada_sem_agendar: 1, nao_responde: 2 };
  return saida.sort((a, b) => peso[a.motivo] - peso[b.motivo] || a.desde.getTime() - b.desde.getTime());
}

/** Registra o resultado: aparece na conversa (para todo mundo ver) e conta no histórico. */
export async function registrarLigacao(
  repo: Repositorio,
  c: Conversa,
  p: { resultado: ResultadoLigacao; nota?: string; atendente: string; atendenteId?: string; agora: Date },
): Promise<void> {
  const nota = p.nota?.trim();
  await repo.adicionarMensagem({
    conversaId: c.id,
    autor: 'sistema',
    texto: `📞 ${p.atendente} ligou: ${RESULTADOS[p.resultado]}${nota ? ` · ${nota}` : ''}`,
    em: p.agora,
  });
  await repo.registrarEvento({ tipo: 'ligacao', conversaId: c.id, unidade: c.unidade, em: p.agora, dados: { resultado: p.resultado, atendente: p.atendente, atendenteId: p.atendenteId, nota } });
}

/** Ligações registradas hoje (mais novas primeiro). */
export async function ligacoesDoDia(repo: Repositorio, inicio: Date, fim: Date, podeVer: (c: Conversa | undefined) => boolean = () => true) {
  const conversas = new Map((await repo.listarConversas()).map((c) => [c.id, c]));
  return (await repo.eventosEntre(inicio, fim))
    .filter((e) => e.tipo === 'ligacao' && podeVer(e.conversaId ? conversas.get(e.conversaId) : undefined))
    .map((e) => ({
      conversaId: e.conversaId,
      cliente: (e.conversaId && conversas.get(e.conversaId)?.nome) || null,
      em: e.em,
      resultado: e.dados?.resultado as ResultadoLigacao,
      atendente: String(e.dados?.atendente ?? ''),
      nota: (e.dados?.nota as string | undefined) ?? null,
    }))
    .sort((a, b) => b.em.getTime() - a.em.getTime());
}
