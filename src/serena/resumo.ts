import type { Conversa, UnidadeId } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { idsUnidades, unidadeDe } from '../unidades.js';
import { bahia, DIA, HORA, MIN, partesBahia } from '../util/tempo.js';
import { JANELA_CONDUZINDO_MS } from '../painel/ia-hoje.js';

/**
 * Tela "Serena" (botão do meio): o resumo barato que a tela pede ao abrir.
 * Nada aqui chama a IA: só conversas e eventos já gravados, filtrados pelo que a pessoa pode ver.
 * - precisa de você: conversas que a Serena passou para a equipe (e ninguém respondeu depois)
 *   e clientes esperando resposta da equipe há mais de 10 minutos;
 * - hoje: horários marcados pela Serena, respostas e tempo médio;
 * - agendado: ligações programadas daqui para a frente (lembretes de ligação ainda sem ligação depois).
 */

/** Cliente esperando a equipe por mais que isso entra em "Precisa de você". */
export const ESPERA_MINIMA_MS = 10 * MIN;
/** Passagem para a equipe vale por este tempo. */
const JANELA_PASSAGEM_MS = 2 * DIA;
/** Espera mais antiga que isso já é caso de Ligações, não de "agora". */
const JANELA_ESPERA_MS = 3 * DIA;
const LIMITE_LISTA = 20;

export interface ItemPrecisa {
  conversaId: string;
  nome: string | null;
  telefone: string;
  unidade: UnidadeId;
  unidadeNome: string;
  /** passou = a Serena passou para a equipe; esperando = cliente sem resposta da equipe. */
  tipo: 'passou' | 'esperando';
  motivo: string;
  desde: Date;
  haMin: number;
}

export interface ResumoSerena {
  /** A Serena atende primeiro em alguma unidade? null = não dá para saber (sem os agentes de IA). */
  ligada: boolean | null;
  unidades: Array<{ unidade: UnidadeId; nome: string; ligada: boolean }>;
  /** Quem pode ligar e desligar (gestão com a permissão dos agentes de IA). */
  podeLigar: boolean;
  /** Conversas que a Serena está conduzindo agora. */
  atendendo: number;
  precisa: { total: number; lista: ItemPrecisa[] };
  hoje: { marcados: number; respostas: number; conversas: number; tempoMedioSeg: number | null };
  agendado: { total: number; proximas: Array<{ conversaId: string; nome: string | null; quando: Date; texto: string }> };
}

/** "IA atende primeiro" de cada unidade do cadastro (chave = id da unidade). */
export type ControleSerena = Partial<Record<string, { ligado?: boolean; agenteId?: string | null }>>;

const ultimaNossa = (c: Conversa) => Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
const minutos = (ms: number) => Math.max(0, Math.floor(ms / MIN));
const espera = (min: number) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dia(s)`);

export function precisaDeVoce(conversas: Conversa[], eventos: Evento[], agora: Date): ItemPrecisa[] {
  const ag = agora.getTime();
  const porId = new Map(conversas.map((c) => [c.id, c]));
  const itens = new Map<string, ItemPrecisa>();
  const base = (c: Conversa) => ({ conversaId: c.id, nome: c.nome ?? null, telefone: c.telefone, unidade: c.unidade, unidadeNome: unidadeDe(c.unidade)?.nome ?? c.unidade });

  // 1) A Serena passou para a equipe e ninguém da equipe respondeu depois (a última passagem de cada conversa).
  const passagens = new Map<string, Evento>();
  for (const e of eventos) {
    if (e.tipo !== 'passou_para_humano' || !e.conversaId || ag - e.em.getTime() > JANELA_PASSAGEM_MS) continue;
    const atual = passagens.get(e.conversaId);
    if (!atual || e.em > atual.em) passagens.set(e.conversaId, e);
  }
  for (const [id, e] of passagens) {
    const c = porId.get(id);
    if (!c || c.modo === 'ia') continue;
    if ((c.ultimaMensagemEquipe?.getTime() ?? 0) >= e.em.getTime()) continue;
    const motivo = typeof e.dados?.motivo === 'string' && e.dados.motivo.trim() ? e.dados.motivo.trim() : 'A Serena passou para você.';
    itens.set(id, { ...base(c), tipo: 'passou', motivo, desde: e.em, haMin: minutos(ag - e.em.getTime()) });
  }

  // 2) Cliente esperando a equipe (fora do modo IA) há mais de 10 minutos.
  for (const c of conversas) {
    if (itens.has(c.id) || c.modo === 'ia') continue;
    const cli = c.ultimaMensagemCliente?.getTime() ?? 0;
    if (!cli || cli <= ultimaNossa(c)) continue;
    const ms = ag - cli;
    if (ms < ESPERA_MINIMA_MS || ms > JANELA_ESPERA_MS) continue;
    const min = minutos(ms);
    itens.set(c.id, { ...base(c), tipo: 'esperando', motivo: `Sem resposta há ${espera(min)}.`, desde: new Date(cli), haMin: min });
  }

  // Passagens primeiro; depois quem espera há mais tempo.
  return [...itens.values()].sort((a, b) => (a.tipo === b.tipo ? a.desde.getTime() - b.desde.getTime() : a.tipo === 'passou' ? -1 : 1));
}

export async function resumoSerena(
  repo: Pick<Repositorio, 'listarConversas' | 'eventosEntre'>,
  agora: Date,
  podeVer: (c: Conversa) => boolean,
  opcoes: { controle?: ControleSerena | null; podeLigar?: boolean } = {},
): Promise<ResumoSerena> {
  const ag = agora.getTime();
  const [todas, eventos] = await Promise.all([repo.listarConversas(), repo.eventosEntre(new Date(ag - 7 * DIA), new Date(ag + 1))]);
  const conversas = todas.filter(podeVer);
  const visiveis = new Set(conversas.map((c) => c.id));
  const meus = eventos.filter((e) => e.conversaId && visiveis.has(e.conversaId));

  // Hoje (horário da Bahia).
  const p = partesBahia(agora);
  const inicio = bahia(p.ano, p.mes, p.dia).getTime();
  let respostas = 0;
  let marcados = 0;
  let somaMs = 0;
  let n = 0;
  const atendidas = new Set<string>();
  for (const e of meus) {
    if (e.em.getTime() < inicio) continue;
    if (e.tipo === 'ia_respondeu') {
      respostas++;
      atendidas.add(e.conversaId!);
      if (typeof e.dados?.tempoRespostaMs === 'number') {
        somaMs += e.dados.tempoRespostaMs;
        n++;
      }
    }
    if (e.tipo === 'agendamento_ia') marcados++;
  }

  const atividade = (c: Conversa) => Math.max(c.ultimaMensagemCliente?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
  const atendendo = conversas.filter((c) => c.modo === 'ia' && atividade(c) > 0 && ag - atividade(c) <= JANELA_CONDUZINDO_MS).length;

  // Ligações programadas daqui para a frente que ainda não tiveram ligação depois de criadas.
  const porId = new Map(conversas.map((c) => [c.id, c]));
  const proximas = new Map<string, { conversaId: string; nome: string | null; quando: Date; texto: string }>();
  for (const e of meus) {
    if (e.tipo !== 'lembrete_ligacao' || e.dados?.teste) continue;
    const quando = new Date(String(e.dados?.quando ?? ''));
    if (Number.isNaN(quando.getTime()) || quando.getTime() < ag - HORA) continue;
    const ligou = meus.some((x) => x.tipo === 'ligacao' && x.conversaId === e.conversaId && x.em.getTime() >= e.em.getTime());
    if (ligou) continue;
    const atual = proximas.get(e.conversaId!);
    if (!atual || quando < atual.quando) proximas.set(e.conversaId!, { conversaId: e.conversaId!, nome: porId.get(e.conversaId!)?.nome ?? null, quando, texto: String(e.dados?.texto ?? 'Ligar para a cliente') });
  }
  const agendadas = [...proximas.values()].sort((a, b) => a.quando.getTime() - b.quando.getTime());

  const precisa = precisaDeVoce(conversas, meus, agora);

  const unidades = idsUnidades().map((u) => ({ unidade: u, nome: unidadeDe(u).nome, ligada: Boolean(opcoes.controle?.[u]?.ligado) }));
  return {
    ligada: opcoes.controle ? unidades.some((u) => u.ligada) : null,
    unidades,
    podeLigar: Boolean(opcoes.podeLigar && opcoes.controle),
    atendendo,
    precisa: { total: precisa.length, lista: precisa.slice(0, LIMITE_LISTA) },
    hoje: { marcados, respostas, conversas: atendidas.size, tempoMedioSeg: n ? Math.round(somaMs / n / 1000) : null },
    agendado: { total: agendadas.length, proximas: agendadas.slice(0, 10) },
  };
}
