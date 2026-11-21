import type { PerdaComCliente } from './armazem.js';

/**
 * Relatório de perdas (Análises › Perdas): por motivo, pela etapa em que o lead estava, por quem atendia e pela
 * origem do lead. Entra a lista do período (uma perda por conversa e funil) já no escopo de quem pede.
 */
export interface EntradaRelatorioPerdas {
  perdas: PerdaComCliente[];
  /** Origem de cada conversa (mesmos nomes de Vendas › Campanhas e origens). */
  origens: Map<string, string>;
  /** Nome atual de cada pessoa da equipe (quem atendia pode ter mudado de nome). */
  nomes: Map<string, string>;
  /** Leads que chegaram no período (para a taxa de perda). */
  leads: number;
  /** Quantas perdas no período anterior de mesmo tamanho. */
  anterior: number;
  /** Nome de cada unidade. */
  unidades?: (id: string) => string;
  /** Quantas linhas da lista detalhada (a tela mostra as últimas; o CSV pede todas). */
  limiteLista?: number;
}

const pct = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);

type Grupo = { chave: string; nome: string; total: number; automaticas: number; motivos: Map<string, number> };

function agrupar(lista: PerdaComCliente[], chave: (p: PerdaComCliente) => [string, string]) {
  const m = new Map<string, Grupo>();
  for (const p of lista) {
    const [k, nome] = chave(p);
    const g = m.get(k) ?? { chave: k, nome, total: 0, automaticas: 0, motivos: new Map<string, number>() };
    g.total++;
    if (p.automatico) g.automaticas++;
    g.motivos.set(p.motivoNome, (g.motivos.get(p.motivoNome) ?? 0) + 1);
    m.set(k, g);
  }
  return [...m.values()]
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((g) => {
      const principal = [...g.motivos].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0];
      return { id: g.chave, nome: g.nome, total: g.total, pct: pct(g.total, lista.length), automaticas: g.automaticas, principal: principal ? { nome: principal[0], total: principal[1] } : null };
    });
}

export function analisarPerdas(e: EntradaRelatorioPerdas) {
  const l = e.perdas;
  const automaticas = l.filter((p) => p.automatico).length;
  const semMotivo = l.filter((p) => p.motivo === 'sem_motivo').length;
  const motivos = agrupar(l, (p) => [p.motivo, p.motivoNome]);
  const etapas = agrupar(l, (p) => [p.deEtapaNome ?? '—', p.deEtapaNome ?? 'Etapa apagada']);
  const atendentes = agrupar(l, (p) =>
    p.atendenteId ? [p.atendenteId, e.nomes.get(p.atendenteId) ?? p.atendenteNome ?? 'Atendente'] : p.motivo === 'ia' ? ['ia', 'Serena (IA)'] : ['sem', 'Sem responsável'],
  );
  const origens = agrupar(l, (p) => {
    const o = e.origens.get(p.conversaId) ?? 'WhatsApp';
    return [o, o];
  });
  const unidades = agrupar(l, (p) => [p.unidade, e.unidades?.(p.unidade) ?? p.unidade]);
  const detalhes = l
    .filter((p) => p.detalhe && !p.automatico)
    .slice(-30)
    .reverse()
    .map((p) => ({ conversaId: p.conversaId, cliente: p.cliente || 'Cliente', motivo: p.motivoNome, detalhe: p.detalhe!, em: p.em }));
  const lista = [...l]
    .reverse()
    .slice(0, e.limiteLista ?? 300)
    .map((p) => ({
      conversaId: p.conversaId,
      cliente: p.cliente || 'Cliente',
      em: p.em,
      motivo: p.motivoNome,
      detalhe: p.detalhe,
      etapa: p.deEtapaNome ?? '—',
      atendente: p.atendenteId ? (e.nomes.get(p.atendenteId) ?? p.atendenteNome ?? 'Atendente') : p.motivo === 'ia' ? 'Serena (IA)' : 'Sem responsável',
      por: p.porNome,
      origem: e.origens.get(p.conversaId) ?? 'WhatsApp',
      unidade: e.unidades?.(p.unidade) ?? p.unidade,
      automatico: p.automatico,
    }));
  return {
    totais: {
      perdas: l.length,
      manuais: l.length - automaticas,
      automaticas,
      semMotivo,
      leads: e.leads,
      /** Perdas ÷ leads que chegaram no período (aproximação: parte das perdas é de leads de antes). */
      taxaPct: e.leads ? pct(l.length, e.leads) : null,
      anterior: e.anterior,
      variacaoPct: e.anterior ? Math.round(((l.length - e.anterior) / e.anterior) * 1000) / 10 : null,
    },
    motivos,
    etapas,
    atendentes,
    origens,
    unidades,
    detalhes,
    lista,
    listaTotal: l.length,
  };
}
export type RelatorioPerdas = ReturnType<typeof analisarPerdas>;
