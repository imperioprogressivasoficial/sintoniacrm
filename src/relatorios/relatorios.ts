import type pg from 'pg';
import type { Conversa, UnidadeId } from '../domain.js';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import type { Usuario } from '../auth/contas.js';
import { ehCanalTeste } from '../channels/teste.js';
import type { ArmazemContatos } from '../contatos/contatos.js';
import type { ArmazemLeads } from '../leads/armazem.js';
import type { Evento, Repositorio, TipoEvento } from '../store/repositorio.js';
import type { Tags } from '../tags/tags.js';
import { gerarCsv, type Celula } from '../util/csv.js';
import { bahia, dataISO, DIA } from '../util/tempo.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import { janela } from '../painel/painel.js';

/**
 * Relatórios da gestão (aba Relatórios). Tudo sai dos eventos (sintonia.eventos) e do estado atual das conversas,
 * como o painel (src/painel): a janela "hoje/7/30 dias" é a mesma do painel e o filtro de quem vê o quê é o mesmo
 * (escopo + sqlEscopo). No Postgres só os eventos dos tipos usados são lidos, já filtrados no banco.
 */

export const PERIODOS_RELATORIO = ['hoje', '7d', '30d', 'personalizado'] as const;
export type PeriodoRelatorio = (typeof PERIODOS_RELATORIO)[number];
export const RELATORIOS = ['origem', 'conversao', 'atendentes', 'ia-equipe', 'perdas', 'tags'] as const;
export type NomeRelatorio = (typeof RELATORIOS)[number];

export interface FiltroRelatorio {
  periodo: PeriodoRelatorio;
  /** AAAA-MM-DD (horário da Bahia), só no personalizado. */
  de?: string;
  ate?: string;
  unidade?: UnidadeId;
  /** usuarioId: só as conversas que são dela ou em que ela atuou; na tabela da equipe, só ela. */
  atendente?: string;
}

export interface OpcoesRelatorios {
  repo: Repositorio;
  empresaId: string;
  tags?: Tags;
  contatos?: ArmazemContatos;
  leads?: ArmazemLeads;
}

const TIPOS: TipoEvento[] = [
  'conversa_nova',
  'lead_importado',
  'ia_respondeu',
  'equipe_respondeu',
  'agendamento_ia',
  'agendamento_equipe',
  'ia_assumiu',
  'passou_para_humano',
  'ligacao',
  'etapa_mudou',
  'tag_marcada',
];

const MAX_DIAS = 92;

/** Início e fim do período (horário da Bahia). Personalizado: de 00:00 do "de" até o fim do "ate". */
export function periodoRelatorio(f: FiltroRelatorio, agora: Date): { inicio: Date; fim: Date; dias: number } {
  if (f.periodo !== 'personalizado') {
    const j = janela(f.periodo, agora);
    return { inicio: j.inicio, fim: j.fim, dias: j.dias };
  }
  const ler = (s: string | undefined) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
    if (!m) throw Object.assign(new Error('Escolha as datas do período.'), { statusCode: 400 });
    return bahia(Number(m[1]), Number(m[2]), Number(m[3]));
  };
  const inicio = ler(f.de);
  const ultimo = ler(f.ate ?? f.de);
  if (ultimo < inicio) throw Object.assign(new Error('A data final vem antes da inicial.'), { statusCode: 400 });
  const dias = Math.round((ultimo.getTime() - inicio.getTime()) / DIA) + 1;
  if (dias > MAX_DIAS) throw Object.assign(new Error(`Escolha no máximo ${MAX_DIAS} dias.`), { statusCode: 400 });
  const fim = new Date(Math.min(ultimo.getTime() + DIA, agora.getTime()));
  return { inicio, fim, dias };
}

async function lerEventos(repo: Repositorio, inicio: Date, fim: Date, escopo: EscopoVisao): Promise<Evento[]> {
  const pool = (repo as { pool?: pg.Pool }).pool;
  if (!pool) return (await repo.eventosEntre(inicio, fim)).filter((e) => e.conversaId && TIPOS.includes(e.tipo));
  const params: unknown[] = [inicio, fim, TIPOS];
  const onde = sqlEscopo(escopo, 'c', params);
  const { rows } = await pool.query<{ conversa_id: string; unidade: string | null; tipo: TipoEvento; dados: Record<string, unknown> | null; em: Date }>(
    `select e.conversa_id, e.unidade, e.tipo, e.dados, e.em
       from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
      where e.em >= $1 and e.em < $2 and e.tipo = any($3::text[]) and ${onde}
      order by e.em, e.id`,
    params,
  );
  return rows.map((r) => ({ tipo: r.tipo, conversaId: r.conversa_id, unidade: (r.unidade ?? undefined) as UnidadeId | undefined, em: r.em, dados: r.dados ?? undefined }));
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const tempoDe = (e: Evento) => (typeof e.dados?.tempoRespostaMs === 'number' ? e.dados.tempoRespostaMs : undefined);
const mediaSeg = (soma: number, n: number) => (n ? Math.round(soma / n / 1000) : null);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const MOTIVO_PERDA: Record<string, string> = {
  manual: 'Marcada pela equipe',
  automacao: 'Automação',
  followups_esgotados: 'Não respondeu aos follow-ups',
  ia_classificou: 'Classificada pela IA',
  faltou: 'Faltou ao horário',
};

export class Relatorios {
  constructor(private readonly o: OpcoesRelatorios) {}

  async gerar(f: FiltroRelatorio, o: { agora: Date; escopo: EscopoVisao; equipe?: Usuario[] }) {
    const { inicio, fim, dias } = periodoRelatorio(f, o.agora);
    const escopo: EscopoVisao = { empresaId: this.o.empresaId, ...o.escopo };
    if (f.unidade) {
      if (escopo.unidades && !escopo.unidades.includes(f.unidade)) throw Object.assign(new Error('Você não vê essa unidade.'), { statusCode: 403 });
      escopo.unidades = [f.unidade];
    }
    // Até agora: quem chegou no período e agendou depois também conta na conversão.
    const [todos, conversasTodas] = await Promise.all([lerEventos(this.o.repo, inicio, o.agora, escopo), this.o.repo.listarConversas()]);
    let conversas = new Map(conversasTodas.filter((c) => noEscopo(escopo, c)).map((c) => [c.id, c]));
    let eventos = todos.filter((e) => conversas.has(e.conversaId!));
    if (f.atendente) {
      const dela = new Set([...conversas.values()].filter((c) => c.responsavelId === f.atendente).map((c) => c.id));
      for (const e of eventos) if (str(e.dados?.atendenteId) === f.atendente) dela.add(e.conversaId!);
      conversas = new Map([...conversas].filter(([id]) => dela.has(id)));
      eventos = eventos.filter((e) => dela.has(e.conversaId!));
    }
    const noPeriodo = eventos.filter((e) => e.em < fim);

    // ---------- campos da ficha usados como "Origem" e "Motivo da perda" ----------
    const campos = this.o.contatos ? await this.o.contatos.campos(this.o.empresaId) : [];
    const campoOrigem = campos.find((c) => /^origem/.test(semAcento(c.nome)) || /como (nos )?conheceu/.test(semAcento(c.nome)));
    const campoMotivo = campos.find((c) => /motivo/.test(semAcento(c.nome)) && /perd/.test(semAcento(c.nome)));
    const fichas = (campoOrigem || campoMotivo) && this.o.leads ? new Map((await this.o.leads.contatos(this.o.empresaId)).map((x) => [x.telefone, x])) : new Map();
    const valorCampo = (c: Conversa | undefined, id: string | undefined) => {
      if (!c || !id) return undefined;
      const v = fichas.get(c.telefone)?.campos?.[id];
      return v === null || v === undefined || v === '' ? undefined : String(v);
    };

    // ---------- leads por origem / dia ----------
    const diasLista: string[] = [];
    for (let t = inicio.getTime(); t < fim.getTime(); t += DIA) diasLista.push(dataISO(new Date(t)));
    if (!diasLista.length) diasLista.push(dataISO(inicio));
    const porDia = new Map(diasLista.map((d) => [d, new Map<string, number>()]));
    const totalOrigem = new Map<string, number>();
    const entradas = noPeriodo.filter((e) => e.tipo === 'conversa_nova' || e.tipo === 'lead_importado');
    const jaContada = new Set<string>();
    for (const e of entradas) {
      if (jaContada.has(e.conversaId!)) continue;
      jaContada.add(e.conversaId!);
      const c = conversas.get(e.conversaId!);
      const origem = valorCampo(c, campoOrigem?.id) ?? (e.tipo === 'lead_importado' ? 'Importação' : c && ehCanalTeste(c.canalId) ? 'Simulador' : 'WhatsApp');
      const dia = dataISO(e.em);
      const m = porDia.get(dia) ?? new Map<string, number>();
      m.set(origem, (m.get(origem) ?? 0) + 1);
      porDia.set(dia, m);
      totalOrigem.set(origem, (totalOrigem.get(origem) ?? 0) + 1);
    }
    const origens = [...totalOrigem.entries()].sort((a, b) => b[1] - a[1]).map(([origem, total]) => ({ origem, total }));
    const origem = {
      total: jaContada.size,
      campo: campoOrigem?.nome ?? null,
      origens,
      dias: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, m]) => ({ dia, total: [...m.values()].reduce((a, b) => a + b, 0), porOrigem: Object.fromEntries(m) })),
    };

    // ---------- conversão (quem chegou no período) ----------
    const coorte = new Set(noPeriodo.filter((e) => e.tipo === 'conversa_nova').map((e) => e.conversaId!));
    const respondidas = new Set<string>();
    const agendaram = new Set<string>();
    const compareceram = new Set<string>();
    for (const e of eventos) {
      if (!coorte.has(e.conversaId!)) continue;
      if (e.tipo === 'ia_respondeu' || e.tipo === 'equipe_respondeu') respondidas.add(e.conversaId!);
      if (e.tipo === 'agendamento_ia' || e.tipo === 'agendamento_equipe') agendaram.add(e.conversaId!);
      if (e.tipo === 'etapa_mudou') {
        const para = str(e.dados?.para);
        if (para === 'agendada' || para === 'compareceu' || para === 'manutencao') agendaram.add(e.conversaId!);
        if (para === 'compareceu' || para === 'manutencao') compareceram.add(e.conversaId!);
      }
    }
    let perdidasCoorte = 0;
    for (const id of coorte) {
      const c = conversas.get(id);
      if (!c) continue;
      if (['em_conversa', 'interessada', 'agendada', 'compareceu', 'manutencao'].includes(c.etapa)) respondidas.add(id);
      if (c.etapa === 'agendada' || c.etapa === 'compareceu' || c.etapa === 'manutencao') agendaram.add(id);
      if (c.etapa === 'compareceu' || c.etapa === 'manutencao') compareceram.add(id);
      if (c.etapa === 'perdida') perdidasCoorte++;
    }
    for (const id of compareceram) agendaram.add(id);
    for (const id of agendaram) respondidas.add(id);
    const entraram = coorte.size;
    const conversao = {
      etapas: [
        { chave: 'entraram', nome: 'Entraram', total: entraram, pct: entraram ? 100 : null },
        { chave: 'responderam', nome: 'Foram atendidas', total: respondidas.size, pct: pct(respondidas.size, entraram) },
        { chave: 'agendaram', nome: 'Agendaram', total: agendaram.size, pct: pct(agendaram.size, entraram) },
        { chave: 'compareceram', nome: 'Compareceram', total: compareceram.size, pct: pct(compareceram.size, entraram) },
      ],
      perdidas: perdidasCoorte,
    };

    // ---------- primeira resposta de cada conversa nova ----------
    const ordenados = [...eventos].sort((a, b) => a.em.getTime() - b.em.getTime());
    const primeiraDe = new Map<string, Evento>();
    const chegada = new Map<string, Date>();
    for (const e of ordenados) {
      if (e.tipo === 'conversa_nova' && coorte.has(e.conversaId!) && !chegada.has(e.conversaId!)) chegada.set(e.conversaId!, e.em);
      if ((e.tipo === 'ia_respondeu' || e.tipo === 'equipe_respondeu') && chegada.has(e.conversaId!) && !primeiraDe.has(e.conversaId!)) primeiraDe.set(e.conversaId!, e);
    }

    // ---------- desempenho por atendente e IA × equipe ----------
    const porId = new Map((o.equipe ?? []).map((p) => [p.id, p]));
    const porNome = new Map((o.equipe ?? []).map((p) => [p.nome.toLowerCase(), p]));
    interface Linha { usuarioId: string | null; nome: string; respostas: number; somaResp: number; nResp: number; primeiras: number; somaPrim: number; agendamentos: number; ligacoes: number }
    const linhas = new Map<string, Linha>();
    const linha = (id: string | undefined, nome: string | undefined) => {
      const p = (id && porId.get(id)) || (nome ? porNome.get(nome.toLowerCase()) : undefined);
      const k = p?.id ?? id ?? `nome:${(nome ?? '').toLowerCase()}`;
      let l = linhas.get(k);
      if (!l) {
        l = { usuarioId: p?.id ?? id ?? null, nome: p?.nome ?? nome ?? 'Sem nome', respostas: 0, somaResp: 0, nResp: 0, primeiras: 0, somaPrim: 0, agendamentos: 0, ligacoes: 0 };
        linhas.set(k, l);
      }
      return l;
    };
    for (const p of o.equipe ?? []) {
      if (!p.ativo || !['atendente', 'recepcionista'].includes(p.papel)) continue;
      if (escopo.unidades && !p.unidades.some((u) => escopo.unidades!.includes(u))) continue;
      linha(p.id, p.nome);
    }
    const ia = { respostas: 0, somaResp: 0, nResp: 0, primeiras: 0, somaPrim: 0, agendamentos: 0, assumiu: 0, passouParaEquipe: 0 };
    const eq = { respostas: 0, somaResp: 0, nResp: 0, primeiras: 0, somaPrim: 0, agendamentos: 0 };
    for (const e of noPeriodo) {
      const t = tempoDe(e);
      if (e.tipo === 'ia_respondeu') {
        ia.respostas++;
        if (t !== undefined) { ia.somaResp += t; ia.nResp++; }
      }
      if (e.tipo === 'agendamento_ia') ia.agendamentos++;
      if (e.tipo === 'ia_assumiu') ia.assumiu++;
      if (e.tipo === 'passou_para_humano') ia.passouParaEquipe++;
      if (e.tipo === 'equipe_respondeu') {
        eq.respostas++;
        if (t !== undefined) { eq.somaResp += t; eq.nResp++; }
      }
      if (e.tipo === 'agendamento_equipe') eq.agendamentos++;
      if (e.tipo === 'equipe_respondeu' || e.tipo === 'agendamento_equipe' || e.tipo === 'ligacao') {
        const id = str(e.dados?.atendenteId);
        const nome = str(e.dados?.atendente);
        if (!id && !nome) continue;
        const l = linha(id, nome);
        if (e.tipo === 'equipe_respondeu') {
          l.respostas++;
          if (t !== undefined) { l.somaResp += t; l.nResp++; }
        }
        if (e.tipo === 'agendamento_equipe') l.agendamentos++;
        if (e.tipo === 'ligacao') l.ligacoes++;
      }
    }
    for (const [id, r] of primeiraDe) {
      const ms = r.em.getTime() - chegada.get(id)!.getTime();
      if (r.tipo === 'ia_respondeu') { ia.primeiras++; ia.somaPrim += ms; }
      else {
        eq.primeiras++;
        eq.somaPrim += ms;
        const l = linha(str(r.dados?.atendenteId), str(r.dados?.atendente));
        l.primeiras++;
        l.somaPrim += ms;
      }
    }
    const donas = new Map<string, number>();
    for (const c of conversas.values()) if (c.responsavelId) donas.set(c.responsavelId, (donas.get(c.responsavelId) ?? 0) + 1);
    const atendentes = [...linhas.values()]
      .filter((l) => !f.atendente || l.usuarioId === f.atendente)
      .map((l) => ({
        usuarioId: l.usuarioId,
        nome: l.nome,
        respostas: l.respostas,
        primeirasRespostas: l.primeiras,
        primeiraRespostaSeg: mediaSeg(l.somaPrim, l.primeiras),
        tempoMedioRespostaSeg: mediaSeg(l.somaResp, l.nResp),
        agendamentos: l.agendamentos,
        ligacoes: l.ligacoes,
        conversasDona: l.usuarioId ? (donas.get(l.usuarioId) ?? 0) : 0,
      }))
      .sort((a, b) => b.agendamentos - a.agendamentos || b.respostas - a.respostas || a.nome.localeCompare(b.nome, 'pt-BR'));
    const totalAg = ia.agendamentos + eq.agendamentos;
    const iaEquipe = {
      ia: { respostas: ia.respostas, primeirasRespostas: ia.primeiras, primeiraRespostaSeg: mediaSeg(ia.somaPrim, ia.primeiras), tempoMedioRespostaSeg: mediaSeg(ia.somaResp, ia.nResp), agendamentos: ia.agendamentos, agendamentosPct: pct(ia.agendamentos, totalAg), assumiu: ia.assumiu, passouParaEquipe: ia.passouParaEquipe },
      equipe: { respostas: eq.respostas, primeirasRespostas: eq.primeiras, primeiraRespostaSeg: mediaSeg(eq.somaPrim, eq.primeiras), tempoMedioRespostaSeg: mediaSeg(eq.somaResp, eq.nResp), agendamentos: eq.agendamentos, agendamentosPct: pct(eq.agendamentos, totalAg) },
    };

    // ---------- motivos de perda ----------
    const motivos = new Map<string, number>();
    let perdas = 0;
    const perdaContada = new Set<string>();
    for (const e of noPeriodo) {
      if (e.tipo !== 'etapa_mudou' || str(e.dados?.para) !== 'perdida' || perdaContada.has(e.conversaId!)) continue;
      perdaContada.add(e.conversaId!);
      perdas++;
      const bruto = valorCampo(conversas.get(e.conversaId!), campoMotivo?.id) ?? str(e.dados?.motivo) ?? 'Sem motivo';
      const nome = MOTIVO_PERDA[bruto] ?? bruto.charAt(0).toUpperCase() + bruto.slice(1);
      motivos.set(nome, (motivos.get(nome) ?? 0) + 1);
    }
    const perdasR = { total: perdas, campo: campoMotivo?.nome ?? null, motivos: [...motivos.entries()].sort((a, b) => b[1] - a[1]).map(([motivo, total]) => ({ motivo, total, pct: pct(total, perdas) })) };

    // ---------- tags mais usadas ----------
    const marcacoes = new Map<string, { nome: string; n: number }>();
    for (const e of noPeriodo) {
      if (e.tipo !== 'tag_marcada') continue;
      const id = str(e.dados?.tagId) ?? `nome:${str(e.dados?.nome) ?? '?'}`;
      const x = marcacoes.get(id) ?? { nome: str(e.dados?.nome) ?? '?', n: 0 };
      x.n++;
      marcacoes.set(id, x);
    }
    const listaTags = this.o.tags ? await this.o.tags.listar() : [];
    const agoraTags = this.o.tags ? await this.o.tags.dasConversas([...conversas.keys()]) : new Map<string, Array<{ id: string }>>();
    const comTag = new Map<string, number>();
    for (const ts of agoraTags.values()) for (const t of ts) comTag.set(t.id, (comTag.get(t.id) ?? 0) + 1);
    const ids = new Set([...marcacoes.keys(), ...comTag.keys()]);
    const tags = [...ids]
      .map((id) => {
        const t = listaTags.find((x) => x.id === id);
        return { tagId: t?.id ?? null, nome: t?.nome ?? marcacoes.get(id)?.nome ?? '?', cor: t?.cor ?? '#8B8D98', marcacoes: marcacoes.get(id)?.n ?? 0, conversasAgora: comTag.get(id) ?? 0 };
      })
      .filter((t) => t.marcacoes > 0 || t.conversasAgora > 0)
      .sort((a, b) => b.marcacoes - a.marcacoes || b.conversasAgora - a.conversasAgora || a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 30);

    return {
      periodo: f.periodo,
      inicio,
      fim,
      dias,
      unidade: f.unidade ?? null,
      atendente: f.atendente ?? null,
      origem,
      conversao,
      atendentes,
      iaEquipe,
      perdas: perdasR,
      tags,
    };
  }

  /** CSV de um relatório (o mesmo conteúdo da tela). */
  async csv(nome: NomeRelatorio, f: FiltroRelatorio, o: Parameters<Relatorios['gerar']>[1]): Promise<{ csv: string; arquivo: string }> {
    const r = await this.gerar(f, o);
    const seg = (s: number | null) => (s == null ? '' : s);
    const br = (d: string) => d.split('-').reverse().join('/');
    const sufixo = `${dataISO(r.inicio)}_a_${dataISO(new Date(r.fim.getTime() - 1))}${r.unidade ? '_' + r.unidade : ''}`;
    let cab: string[] = [];
    let linhas: Celula[][] = [];
    if (nome === 'origem') {
      const nomes = r.origem.origens.map((x) => x.origem);
      cab = ['Dia', 'Total', ...nomes];
      linhas = r.origem.dias.map((d) => [br(d.dia), d.total, ...nomes.map((n) => d.porOrigem[n] ?? 0)]);
      linhas.push(['Total', r.origem.total, ...r.origem.origens.map((x) => x.total)]);
    } else if (nome === 'conversao') {
      cab = ['Etapa', 'Conversas', '% de quem entrou'];
      linhas = r.conversao.etapas.map((e) => [e.nome, e.total, e.pct]);
      linhas.push(['Perdidas (até agora)', r.conversao.perdidas, pct(r.conversao.perdidas, r.conversao.etapas[0]!.total)]);
    } else if (nome === 'atendentes') {
      cab = ['Atendente', 'Respostas', '1ª resposta (média, s)', '1ªs respostas', 'Tempo médio de resposta (s)', 'Agendamentos', 'Ligações', 'Conversas como dona'];
      linhas = r.atendentes.map((a) => [a.nome, a.respostas, seg(a.primeiraRespostaSeg), a.primeirasRespostas, seg(a.tempoMedioRespostaSeg), a.agendamentos, a.ligacoes, a.conversasDona]);
    } else if (nome === 'ia-equipe') {
      cab = ['Quem', 'Respostas', '1ªs respostas', '1ª resposta (média, s)', 'Tempo médio de resposta (s)', 'Agendamentos', '% dos agendamentos'];
      const { ia, equipe } = r.iaEquipe;
      linhas = [
        ['IA', ia.respostas, ia.primeirasRespostas, seg(ia.primeiraRespostaSeg), seg(ia.tempoMedioRespostaSeg), ia.agendamentos, ia.agendamentosPct],
        ['Equipe', equipe.respostas, equipe.primeirasRespostas, seg(equipe.primeiraRespostaSeg), seg(equipe.tempoMedioRespostaSeg), equipe.agendamentos, equipe.agendamentosPct],
      ];
    } else if (nome === 'perdas') {
      cab = ['Motivo', 'Conversas', '%'];
      linhas = r.perdas.motivos.map((m) => [m.motivo, m.total, m.pct]);
    } else {
      cab = ['Tag', 'Marcações no período', 'Conversas com a tag agora'];
      linhas = r.tags.map((t) => [t.nome, t.marcacoes, t.conversasAgora]);
    }
    return { csv: gerarCsv(cab, linhas), arquivo: `relatorio-${nome}_${sufixo}.csv` };
  }
}
