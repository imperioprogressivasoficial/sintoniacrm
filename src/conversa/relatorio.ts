import type pg from 'pg';
import { NOME_ETAPA, type Conversa, type Etapa, type Mensagem } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';

/**
 * Relatório do cliente (ficha da conversa): quando chegou, quantas conversas e mensagens, agendamentos,
 * comparecimentos e faltas, quem atendeu, tempo médio de resposta da equipe e o caminho no funil.
 * Tudo sai do que já está guardado: mensagens e eventos (sintonia.eventos). Nada novo é gravado.
 */
export interface RelatorioCliente {
  chegouEm: string;
  conversas: number;
  mensagens: { total: number; cliente: number; equipe: number; ia: number };
  agendamentos: {
    total: number;
    servicos: string[];
    valorTotal: number | null;
    ultimo: AgendamentoResumo | null;
    proximo: AgendamentoResumo | null;
  };
  comparecimentos: number;
  faltas: number;
  ligacoes: number;
  atendentes: Array<{ nome: string; mensagens: number }>;
  iaMensagens: number;
  /** Média, em minutos, entre a cliente escrever e a equipe ou a IA responder. */
  tempoMedioRespostaMin: number | null;
  etapaAtual: { id: Etapa; nome: string };
  etapas: Array<{ de: string | null; para: string; nome: string; em: string; motivo: string | null }>;
}

export interface AgendamentoResumo {
  inicio: string;
  servico: string | null;
  profissional: string | null;
  valor: number | null;
  por: string;
}

/** Uma conversa nova começa quando a cliente volta a escrever depois de 12 horas sem mensagens. */
const NOVA_CONVERSA_MS = 12 * 60 * 60 * 1000;
const TIPOS = ['agendamento_ia', 'agendamento_equipe', 'etapa_mudou', 'ligacao', 'envio_ativo'];
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const nomeEtapa = (e: string) => (NOME_ETAPA as Record<string, string>)[e] ?? e;

export function calcularRelatorio(c: Conversa, mensagens: Mensagem[], eventos: Evento[], agora: Date): RelatorioCliente {
  const msgs = mensagens.filter((m) => m.autor !== 'sistema').sort((a, b) => a.em.getTime() - b.em.getTime());
  const evs = eventos.filter((e) => e.conversaId === c.id).sort((a, b) => a.em.getTime() - b.em.getTime());
  const primeira = msgs[0]?.em;
  const chegou = primeira && primeira.getTime() < c.criadaEm.getTime() ? primeira : c.criadaEm;

  // Conversas (sessões) e tempo de resposta.
  let conversas = 0;
  let anterior: Date | null = null;
  let esperandoDesde: Date | null = null;
  const tempos: number[] = [];
  const porAtendente = new Map<string, number>();
  const contagem = { total: msgs.length, cliente: 0, equipe: 0, ia: 0 };
  for (const m of msgs) {
    if (!anterior || m.em.getTime() - anterior.getTime() > NOVA_CONVERSA_MS) conversas++;
    anterior = m.em;
    if (m.autor === 'cliente') {
      contagem.cliente++;
      esperandoDesde ??= m.em;
      continue;
    }
    if (m.autor === 'equipe') {
      contagem.equipe++;
      const n = str(m.autorNome) ?? 'Equipe';
      porAtendente.set(n, (porAtendente.get(n) ?? 0) + 1);
    }
    if (m.autor === 'ia') contagem.ia++;
    if (esperandoDesde) {
      const d = m.em.getTime() - esperandoDesde.getTime();
      // Resposta no mesmo dia de trabalho; esperas de dias distorcem a média.
      if (d >= 0 && d <= NOVA_CONVERSA_MS) tempos.push(d);
      esperandoDesde = null;
    }
  }

  // Agendamentos.
  const ags = evs
    .filter((e) => e.tipo === 'agendamento_ia' || e.tipo === 'agendamento_equipe')
    .map((e) => {
      const inicio = str(e.dados?.inicio);
      return {
        inicio: inicio && !Number.isNaN(Date.parse(inicio)) ? new Date(inicio) : e.em,
        servico: str(e.dados?.servico),
        profissional: str(e.dados?.profissional),
        valor: num(e.dados?.valor),
        por: e.tipo === 'agendamento_ia' ? 'IA' : (str(e.dados?.atendente) ?? 'Equipe'),
      };
    })
    .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const resumo = (a: (typeof ags)[number] | undefined): AgendamentoResumo | null =>
    a ? { inicio: a.inicio.toISOString(), servico: a.servico, profissional: a.profissional, valor: a.valor, por: a.por } : null;
  const passados = ags.filter((a) => a.inicio.getTime() <= agora.getTime());
  const futuros = ags.filter((a) => a.inicio.getTime() > agora.getTime());
  const valores = ags.map((a) => a.valor).filter((v): v is number => v !== null);

  const etapas = evs
    .filter((e) => e.tipo === 'etapa_mudou' && str(e.dados?.para))
    .map((e) => ({ de: str(e.dados?.de), para: String(e.dados!.para), nome: nomeEtapa(String(e.dados!.para)), em: e.em.toISOString(), motivo: str(e.dados?.motivo) }));
  const comparecimentos = etapas.filter((e) => e.para === 'compareceu').length || (c.etapa === 'compareceu' ? 1 : 0);
  const faltas = evs.filter((e) => (e.tipo === 'etapa_mudou' && e.dados?.motivo === 'cliente_faltou') || (e.tipo === 'envio_ativo' && e.dados?.tipo === 'recuperar_falta')).length;

  return {
    chegouEm: chegou.toISOString(),
    conversas,
    mensagens: contagem,
    agendamentos: {
      total: ags.length,
      servicos: [...new Set(ags.map((a) => a.servico).filter((s): s is string => !!s))],
      valorTotal: valores.length ? Math.round(valores.reduce((s, v) => s + v, 0) * 100) / 100 : null,
      ultimo: resumo(passados.at(-1)),
      proximo: resumo(futuros[0]),
    },
    comparecimentos,
    faltas,
    ligacoes: evs.filter((e) => e.tipo === 'ligacao').length,
    atendentes: [...porAtendente].map(([nome, mensagens]) => ({ nome, mensagens })).sort((a, b) => b.mensagens - a.mensagens),
    iaMensagens: contagem.ia,
    tempoMedioRespostaMin: tempos.length ? Math.round(tempos.reduce((s, v) => s + v, 0) / tempos.length / 6000) / 10 : null,
    etapaAtual: { id: c.etapa, nome: nomeEtapa(c.etapa) },
    etapas,
  };
}

/** Eventos desta conversa: no Postgres, direto pelo índice da conversa; na memória, filtrando. */
export async function eventosDaConversa(repo: Repositorio, conversaId: string, agora: Date): Promise<Evento[]> {
  const pool = (repo as { pool?: pg.Pool }).pool;
  if (pool) {
    const { rows } = await pool.query<{ tipo: Evento['tipo']; unidade: Evento['unidade'] | null; em: Date; dados: Record<string, unknown> | null }>(
      'select tipo, unidade, em, dados from sintonia.eventos where conversa_id = $1 and tipo = any($2) order by em, id',
      [conversaId, TIPOS],
    );
    return rows.map((r) => ({ tipo: r.tipo, conversaId, unidade: r.unidade ?? undefined, em: r.em, dados: r.dados ?? undefined }));
  }
  return (await repo.eventosEntre(new Date(0), new Date(agora.getTime() + 1))).filter((e) => e.conversaId === conversaId && TIPOS.includes(e.tipo));
}

export async function relatorioDaConversa(repo: Repositorio, c: Conversa, agora: Date): Promise<RelatorioCliente> {
  const [mensagens, eventos] = await Promise.all([repo.mensagens(c.id, 100_000), eventosDaConversa(repo, c.id, agora)]);
  return calcularRelatorio(c, mensagens, eventos, agora);
}
