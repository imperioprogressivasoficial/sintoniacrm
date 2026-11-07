import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { UNIDADES } from '../unidades.js';
import { bahia, DIA, HORA, MIN, partesBahia } from '../util/tempo.js';

/** Aba IA: o que a IA fez hoje (horário da Bahia) e o que ela está conduzindo agora. */

/** Conversa em modo IA com atividade nesta janela conta como "conduzindo agora". */
export const JANELA_CONDUZINDO_MS = 2 * HORA;

export async function iaHoje(repo: Repositorio, agora: Date, podeVer: (c: Conversa) => boolean = () => true) {
  const p = partesBahia(agora);
  const inicio = bahia(p.ano, p.mes, p.dia);
  const [eventos, todas] = await Promise.all([repo.eventosEntre(inicio, new Date(inicio.getTime() + DIA)), repo.listarConversas()]);
  const conversas = new Map(todas.filter(podeVer).map((c) => [c.id, c]));
  const meus = eventos.filter((e) => e.conversaId && conversas.has(e.conversaId));
  const nome = (id?: string) => (id ? (conversas.get(id)?.nome ?? null) : null);

  const atendidas = new Set<string>();
  let respostas = 0;
  let assumiu = 0;
  let tagsMarcadas = 0;
  let somaMs = 0;
  let n = 0;
  const envios: Record<string, number> = {};
  const agendamentos: Array<{ conversaId: string; cliente: string | null; servico: string | null; inicio: string | null; em: Date }> = [];
  const pediuAjuda: Array<{ conversaId: string; cliente: string | null; motivo: string | null; em: Date }> = [];
  for (const e of meus) {
    const id = e.conversaId!;
    if (e.tipo === 'ia_respondeu') {
      atendidas.add(id);
      respostas++;
      if (typeof e.dados?.tempoRespostaMs === 'number') {
        somaMs += e.dados.tempoRespostaMs;
        n++;
      }
    }
    if (e.tipo === 'ia_assumiu') assumiu++;
    if (e.tipo === 'tag_marcada' && e.dados?.por === 'IA') tagsMarcadas++;
    if (e.tipo === 'envio_ativo') {
      const t = String(e.dados?.tipo ?? 'outro');
      envios[t] = (envios[t] ?? 0) + 1;
    }
    if (e.tipo === 'agendamento_ia') {
      agendamentos.push({
        conversaId: id,
        cliente: nome(id),
        servico: typeof e.dados?.servico === 'string' ? e.dados.servico : null,
        inicio: typeof e.dados?.inicio === 'string' ? e.dados.inicio : null,
        em: e.em,
      });
    }
    if (e.tipo === 'passou_para_humano') {
      pediuAjuda.push({ conversaId: id, cliente: nome(id), motivo: typeof e.dados?.motivo === 'string' ? e.dados.motivo : null, em: e.em });
    }
  }
  const lembretes = Object.entries(envios).filter(([t]) => t.startsWith('lembrete')).reduce((s, [, v]) => s + v, 0);
  const totalEnvios = Object.values(envios).reduce((s, v) => s + v, 0);

  const ultimaAtividade = (c: Conversa) => Math.max(c.ultimaMensagemCliente?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
  const conduzindo = [...conversas.values()]
    .filter((c) => c.modo === 'ia' && agora.getTime() - ultimaAtividade(c) <= JANELA_CONDUZINDO_MS && ultimaAtividade(c) > 0)
    .sort((a, b) => ultimaAtividade(b) - ultimaAtividade(a))
    .slice(0, 50);
  const conduzindoAgora = await Promise.all(
    conduzindo.map(async (c) => {
      const m = (await repo.mensagens(c.id, 1))[0];
      const ult = ultimaAtividade(c);
      return {
        conversaId: c.id,
        nome: c.nome ?? null,
        telefone: c.telefone,
        unidade: c.unidade,
        unidadeNome: UNIDADES[c.unidade].nome,
        etapa: c.etapa,
        ultimaMensagem: m ? { autor: m.autor, texto: m.texto.slice(0, 140), em: m.em } : null,
        ultimaAtividade: new Date(ult),
        haMin: Math.max(0, Math.floor((agora.getTime() - ult) / MIN)),
      };
    }),
  );

  return {
    dia: `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`,
    conversasAtendidas: atendidas.size,
    respostas,
    assumiu,
    agendamentos: { total: agendamentos.length, lista: agendamentos.sort((a, b) => b.em.getTime() - a.em.getTime()) },
    pediuAjuda: { total: pediuAjuda.length, lista: pediuAjuda.sort((a, b) => b.em.getTime() - a.em.getTime()) },
    envios: { total: totalEnvios, lembretes, followups: totalEnvios - lembretes, porTipo: envios },
    tagsMarcadas,
    tempoMedioRespostaSeg: n ? Math.round(somaMs / n / 1000) : null,
    conduzindoAgora,
  };
}
