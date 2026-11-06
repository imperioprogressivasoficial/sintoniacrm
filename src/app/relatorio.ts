import type { Evento } from '../store/repositorio.js';
import type { UnidadeId } from '../domain.js';
import { UNIDADES } from '../unidades.js';
import { dataISO, nomeDiaSemana } from '../util/tempo.js';

export interface Resumo {
  conversas: number;
  agendamentosIa: number;
  agendamentosEquipe: number;
  iaAssumiu: number;
  passouParaHumano: number;
  enviosAtivos: number;
  falhas: number;
  porUnidade: Partial<Record<UnidadeId, { conversas: number; agendamentos: number }>>;
  /** Desempenho de cada atendente no dia. */
  porAtendente: Record<string, DesempenhoAtendente>;
}

export interface DesempenhoAtendente {
  respostas: number;
  agendamentos: number;
  /** Tempo médio que a cliente esperou pela resposta dela, em minutos. */
  tempoMedioRespostaMin: number | null;
}

/** Soma os eventos do dia. Conversa conta uma vez, mesmo com várias mensagens. */
export function resumir(eventos: Evento[]): Resumo {
  const conversas = new Set<string>();
  const porUnidade: Resumo['porUnidade'] = {};
  const conversasPorUnidade = new Map<UnidadeId, Set<string>>();
  const r: Resumo = {
    conversas: 0,
    agendamentosIa: 0,
    agendamentosEquipe: 0,
    iaAssumiu: 0,
    passouParaHumano: 0,
    enviosAtivos: 0,
    falhas: 0,
    porUnidade,
    porAtendente: {},
  };
  const esperas = new Map<string, number[]>();
  const atendente = (nome: string) => (r.porAtendente[nome] ??= { respostas: 0, agendamentos: 0, tempoMedioRespostaMin: null });
  for (const e of eventos) {
    if (e.tipo === 'mensagem_cliente' && e.conversaId) {
      conversas.add(e.conversaId);
      if (e.unidade) {
        const s = conversasPorUnidade.get(e.unidade) ?? new Set();
        s.add(e.conversaId);
        conversasPorUnidade.set(e.unidade, s);
      }
    }
    if (e.tipo === 'agendamento_ia') r.agendamentosIa++;
    if (e.tipo === 'agendamento_equipe') r.agendamentosEquipe++;
    if ((e.tipo === 'agendamento_ia' || e.tipo === 'agendamento_equipe') && e.unidade) {
      const u = (porUnidade[e.unidade] ??= { conversas: 0, agendamentos: 0 });
      u.agendamentos++;
    }
    const nome = typeof e.dados?.atendente === 'string' ? e.dados.atendente : undefined;
    if (e.tipo === 'equipe_respondeu' && nome) {
      atendente(nome).respostas++;
      if (typeof e.dados?.tempoRespostaMs === 'number') {
        const l = esperas.get(nome) ?? [];
        l.push(e.dados.tempoRespostaMs);
        esperas.set(nome, l);
      }
    }
    if (e.tipo === 'agendamento_equipe' && nome) atendente(nome).agendamentos++;
    if (e.tipo === 'ia_assumiu') r.iaAssumiu++;
    if (e.tipo === 'passou_para_humano') r.passouParaHumano++;
    if (e.tipo === 'envio_ativo') r.enviosAtivos++;
    if (e.tipo === 'falha') r.falhas++;
  }
  r.conversas = conversas.size;
  for (const [nome, l] of esperas) {
    atendente(nome).tempoMedioRespostaMin = Math.round(l.reduce((a, b) => a + b, 0) / l.length / 60_000);
  }
  for (const [u, s] of conversasPorUnidade) {
    const x = (porUnidade[u] ??= { conversas: 0, agendamentos: 0 });
    x.conversas = s.size;
  }
  return r;
}

/** Texto do resumo que vai para o WhatsApp do Bruno, da Tássia e do Vinícius às 20h. */
export function textoRelatorio(r: Resumo, dia: Date, semAgendar: number): string {
  const total = r.agendamentosIa + r.agendamentosEquipe;
  const linhas = [
    `Resumo Sintonia · ${nomeDiaSemana(dia)}, ${dataISO(dia).split('-').reverse().join('/')}`,
    '',
    `${r.conversas} conversas`,
    `${total} agendamentos: ${r.agendamentosIa} pela IA, ${r.agendamentosEquipe} pela equipe`,
    `${semAgendar} conversaram e não agendaram (estão no follow-up)`,
    `${r.iaAssumiu} vezes a IA assumiu conversa sem resposta da equipe`,
  ];
  if (r.passouParaHumano) linhas.push(`${r.passouParaHumano} conversas passadas para a equipe`);
  if (r.enviosAtivos) linhas.push(`${r.enviosAtivos} lembretes e follow-ups enviados`);
  const unidades = Object.entries(r.porUnidade) as Array<[UnidadeId, { conversas: number; agendamentos: number }]>;
  if (unidades.length) {
    linhas.push('');
    for (const [u, v] of unidades) linhas.push(`${UNIDADES[u].nome}: ${v.conversas} conversas, ${v.agendamentos} agendamentos`);
  }
  const equipe = Object.entries(r.porAtendente).sort((a, b) => b[1].agendamentos - a[1].agendamentos);
  if (equipe.length) {
    linhas.push('', 'Equipe:');
    for (const [nome, d] of equipe) {
      const tempo = d.tempoMedioRespostaMin != null ? `, responde em ~${d.tempoMedioRespostaMin} min` : '';
      linhas.push(`${nome}: ${d.agendamentos} agendamentos, ${d.respostas} respostas${tempo}`);
    }
  }
  if (r.falhas) linhas.push('', `Atenção: ${r.falhas} falhas registradas hoje. Ver painel.`);
  return linhas.join('\n');
}
