import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoDe, type EscopoVisao } from '../auth/acesso.js';
import type { Contas } from '../auth/contas.js';
import { pode } from '../auth/permissoes.js';
import type { ArmazemComercial } from '../comercial/armazem.js';
import type { FonteComercial } from '../comercial/fonte.js';
import { ehCanalTeste } from '../channels/teste.js';
import { UNIDADES_LEADS } from '../leads/leads.js';
import { periodoRelatorio, PERIODOS_RELATORIO } from '../relatorios/relatorios.js';
import { UNIDADES } from '../unidades.js';
import { gerarCsv, nomeArquivo, type Celula } from '../util/csv.js';
import { dataISO, DIA } from '../util/tempo.js';
import { analisarFunil, analisarHorarios, analisarRecorrencia, analisarVendas, NOMES_DIA } from './calculo.js';
import { HISTORICO_FUNIL_MS, type FonteAnalises } from './fonte.js';
import type { OrigensConversa } from './origens.js';

/**
 * Análises da gestão (menu Análises): GET /api/analises/:tipo e GET /api/analises/:tipo/csv?tabela=…
 * tipos: vendas (receita por dia, atendente, serviço, unidade e origem), horarios (picos de leads, mensagens e
 * agendamentos), funil (tempo parado por etapa e motivos de perda) e clientes (quem voltou, fiéis e sumidas).
 * Mesmos filtros do Relatório geral: período (hoje, 7 e 30 dias ou datas), unidade e atendente.
 * Ver: permissão "relatorios". Exportar CSV: também "exportar".
 */
export interface OpcoesAnalises {
  fonte: FonteAnalises;
  comercial: FonteComercial;
  armazemComercial: ArmazemComercial;
  origens?: OrigensConversa;
  contas?: Contas;
  /** produtos-lead: receita por produto/serviço vinculado aos leads que compraram no período. */
  produtosVinculados?: (empresaId: string, conversaIds: string[]) => Promise<Array<{ nome: string; tipo: string; categoria: string | null; leads: number; quantidade: number; receita: number }>>;
  /** Empresa quando não há login (uso local / testes). */
  empresaId: string;
  agora: () => Date;
}

export const TIPOS_ANALISE = ['vendas', 'horarios', 'funil', 'clientes'] as const;
export type TipoAnalise = (typeof TIPOS_ANALISE)[number];
export const TABELAS: Record<TipoAnalise, readonly string[]> = {
  vendas: ['dias', 'atendentes', 'servicos', 'produtos', 'origens', 'unidades'],
  horarios: ['leads', 'mensagens', 'agendamentos'],
  funil: ['etapas', 'paradas', 'perdas'],
  clientes: ['resumo', 'fieis', 'sumidas'],
};

const erro = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const FiltroAnalise = z.object({
  periodo: z.enum(PERIODOS_RELATORIO).default('30d'),
  de: Data.optional(),
  ate: Data.optional(),
  unidade: z.enum(UNIDADES_LEADS).optional(),
  atendente: z.string().min(1).max(80).optional(),
});
export type FiltroAnalise = z.infer<typeof FiltroAnalise>;

export function registrarAnalises(app: FastifyInstance, o: OpcoesAnalises): void {
  const empresaDe = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;
  const exige = (req: FastifyRequest) => {
    if (req.usuario && !pode(req, 'relatorios')) throw erro(403, 'As análises ficam com a gerência, a direção e a administração.');
  };
  const escopoDaReq = (req: FastifyRequest, f: FiltroAnalise): EscopoVisao => {
    const e: EscopoVisao = { ...escopoDe(req.usuario), empresaId: empresaDe(req) };
    if (f.unidade) {
      if (e.unidades && !e.unidades.includes(f.unidade)) throw erro(403, 'Você não vê essa unidade.');
      e.unidades = [f.unidade];
    }
    return e;
  };
  const equipeDe = async (req: FastifyRequest) => (o.contas ? await o.contas.listarUsuarios(empresaDe(req)).catch(() => []) : []);

  async function gerar(req: FastifyRequest, tipo: TipoAnalise, f: FiltroAnalise) {
    const agora = o.agora();
    const { inicio, fim, dias } = periodoRelatorio(f, agora);
    const escopo = escopoDaReq(req, f);
    const empresaId = empresaDe(req);
    const equipe = await equipeDe(req);
    const at = f.atendente;
    const base = { tipo, periodo: f.periodo, inicio, fim, dias, unidade: f.unidade ?? null, atendente: at ?? null };

    if (tipo === 'vendas') {
      const desloca = dias * DIA;
      const [atual, anterior, leads, reg] = await Promise.all([
        o.comercial.carregar(inicio, fim, escopo),
        o.comercial.carregar(new Date(inicio.getTime() - desloca), new Date(fim.getTime() - desloca), escopo),
        o.fonte.leads(inicio, fim, escopo, at),
        o.armazemComercial.ler(empresaId),
      ]);
      const filtrar = (vs: typeof atual.vendas) => (at ? vs.filter((v) => v.atendenteId === at) : vs);
      const vendas = filtrar(atual.vendas);
      const importadas = new Set(leads.filter((l) => l.importado).map((l) => l.conversaId));
      const reserva = new Map(leads.map((l) => [l.conversaId, l.importado ? 'Importação' : ehCanalTeste(l.canalId) ? 'Simulador' : 'WhatsApp']));
      const ids = [...new Set([...leads.map((l) => l.conversaId), ...vendas.map((v) => v.conversaId)])];
      const achadas = o.origens ? await o.origens.de(empresaId, ids, importadas) : new Map<string, string>();
      const origens = new Map(ids.map((id) => [id, achadas.get(id) ?? reserva.get(id) ?? 'WhatsApp']));
      const listaDias: string[] = [];
      for (let t = inicio.getTime(); t < fim.getTime(); t += DIA) listaDias.push(dataISO(new Date(t)));
      if (!listaDias.length) listaDias.push(dataISO(inicio));
      const r = analisarVendas({
        vendas,
        anteriores: filtrar(anterior.vendas),
        precos: reg.cfg.precos,
        dias: listaDias,
        origens,
        leads: leads.map((l) => ({ conversaId: l.conversaId, origem: origens.get(l.conversaId)! })),
        nomes: new Map(equipe.map((p) => [p.id, p.nome])),
      });
      const produtos = o.produtosVinculados ? await o.produtosVinculados(empresaId, vendas.map((v) => v.conversaId)).catch(() => []) : [];
      return { ...base, ...r, produtos, unidades: r.unidades.map((u) => ({ ...u, nome: UNIDADES[u.unidade as keyof typeof UNIDADES]?.nome ?? u.unidade })) };
    }
    if (tipo === 'horarios') return { ...base, ...analisarHorarios(await o.fonte.grades(inicio, fim, escopo, at)) };
    if (tipo === 'funil') {
      const d = await o.fonte.funil(new Date(inicio.getTime() - HISTORICO_FUNIL_MS), agora, escopo, at);
      return { ...base, ...analisarFunil({ ...d, inicio, fim, agora }) };
    }
    const [ags, reg] = await Promise.all([o.fonte.agendamentos(new Date(fim.getTime() - 365 * DIA), agora, escopo, at), o.armazemComercial.ler(empresaId)]);
    return { ...base, ...analisarRecorrencia({ agendamentos: ags, precos: reg.cfg.precos, inicio, fim, agora }) };
  }

  const opcoes = async (req: FastifyRequest) => {
    const esc: EscopoVisao = { ...escopoDe(req.usuario) };
    const unidades = UNIDADES_LEADS.filter((u) => !esc.unidades || esc.unidades.includes(u)).map((u) => ({ id: u, nome: UNIDADES[u].nome }));
    const atendentes = (await equipeDe(req))
      .filter((p) => ['atendente', 'recepcionista', 'gerente'].includes(p.papel) && (!esc.unidades || p.unidades.some((x) => esc.unidades!.includes(x))))
      .map((p) => ({ id: p.id, nome: p.nome, ativo: p.ativo }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return { unidades, atendentes };
  };

  /** Só as opções dos filtros (unidades e atendentes), para as abas que não vêm daqui (Satisfação, Painel da TV). */
  app.get('/api/analises/opcoes', async (req) => {
    exige(req);
    return opcoes(req);
  });

  app.get('/api/analises/:tipo', async (req) => {
    exige(req);
    const tipo = z.enum(TIPOS_ANALISE).parse((req.params as { tipo: string }).tipo);
    const f = FiltroAnalise.parse(req.query);
    const [r, op] = await Promise.all([gerar(req, tipo, f), opcoes(req)]);
    return { ...r, opcoes: op };
  });

  app.get('/api/analises/:tipo/csv', async (req, reply) => {
    exige(req);
    if (req.usuario && !pode(req, 'exportar')) throw erro(403, 'Você não tem permissão para exportar. Fale com a gestão.');
    const tipo = z.enum(TIPOS_ANALISE).parse((req.params as { tipo: string }).tipo);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const tabela = z.string().parse(q.tabela ?? TABELAS[tipo][0]);
    if (!TABELAS[tipo].includes(tabela)) throw erro(400, 'Tabela desconhecida.');
    const f = FiltroAnalise.parse(q);
    const r = await gerar(req, tipo, f);
    const { cab, linhas } = tabelaCsv(tipo, tabela, r as Record<string, unknown>);
    const sufixo = `${dataISO(r.inicio)}_a_${dataISO(new Date(r.fim.getTime() - 1))}${r.unidade ? '_' + r.unidade : ''}`;
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeArquivo(`analise-${tipo}-${tabela}_${sufixo}.csv`)}"`)
      .header('cache-control', 'no-store')
      .send(gerarCsv(cab, linhas));
  });
}

const br = (d: string) => d.split('-').reverse().join('/');
const dataBr = (d: Date) => br(dataISO(d));
const horas = (ms: number | null | undefined) => (ms == null ? '' : Math.round((ms / 3_600_000) * 10) / 10);

/** Cabeçalho e linhas de cada tabela exportável (o mesmo conteúdo da tela). */
export function tabelaCsv(tipo: TipoAnalise, tabela: string, r: Record<string, unknown>): { cab: string[]; linhas: Celula[][] } {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const x = r as any;
  if (tipo === 'vendas') {
    const cols = (rot: string) => [rot, 'Vendas', 'Receita (R$)', 'Ticket médio (R$)', 'Compareceram', 'Receita confirmada (R$)', 'Comparecimento (%)'];
    const lin = (nome: string, a: any): Celula[] => [nome, a.vendas, a.receita, a.ticketMedio, a.compareceram, a.receitaConfirmada, a.comparecimentoPct];
    if (tabela === 'dias') return { cab: ['Dia', 'Vendas', 'Receita (R$)'], linhas: x.dias.map((d: any) => [br(d.dia), d.vendas, d.receita]) };
    if (tabela === 'atendentes') return { cab: cols('Quem vendeu'), linhas: x.atendentes.map((a: any) => lin(a.nome, a)) };
    if (tabela === 'servicos') return { cab: cols('Serviço'), linhas: x.servicos.map((a: any) => lin(a.nome, a)) };
    if (tabela === 'produtos')
      return {
        cab: ['Produto ou serviço vinculado', 'Tipo', 'Categoria', 'Leads que compraram', 'Quantidade', 'Receita (R$)'],
        linhas: (x.produtos ?? []).map((a: any) => [a.nome, a.tipo === 'servico' ? 'Serviço' : 'Produto', a.categoria ?? '', a.leads, a.quantidade, a.receita]),
      };
    if (tabela === 'unidades') return { cab: cols('Unidade'), linhas: x.unidades.map((a: any) => lin(a.nome, a)) };
    return {
      cab: ['Origem', 'Leads no período', 'Leads que compraram', 'Conversão (%)', 'Vendas', 'Receita (R$)', 'Ticket médio (R$)'],
      linhas: x.origens.map((a: any) => [a.origem, a.leads, a.viraramVenda, a.conversaoPct, a.vendas, a.receita, a.ticketMedio]),
    };
  }
  if (tipo === 'horarios') {
    const s = x[tabela];
    return {
      cab: ['Dia da semana', ...Array.from({ length: 24 }, (_, h) => `${h}h`), 'Total'],
      linhas: (s.grade as number[][]).map((linha, d) => [NOMES_DIA[d]!, ...linha, s.porDiaSemana[d]]),
    };
  }
  if (tipo === 'funil') {
    if (tabela === 'etapas')
      return {
        cab: ['Etapa', 'Saíram no período', 'Tempo médio na etapa (h)', 'Tempo mediano na etapa (h)', 'Estão nela agora', 'Paradas agora há (mediana, h)'],
        linhas: x.etapas.map((e: any) => [e.nome, e.saidas, horas(e.mediaMs), horas(e.medianaMs), e.agora, horas(e.paradoAgoraMedianaMs)]),
      };
    if (tabela === 'paradas') return { cab: ['Cliente', 'Unidade', 'Etapa', 'Desde', 'Parada há (h)'], linhas: x.paradas.map((p: any) => [p.cliente, p.unidade, p.nomeEtapa, dataBr(new Date(p.desde)), horas(p.paradoMs)]) };
    return { cab: ['Motivo da perda', 'Conversas', '%'], linhas: x.perdas.motivos.map((m: any) => [m.nome, m.total, m.pct]) };
  }
  if (tabela === 'fieis') return { cab: ['Cliente', 'Visitas (12 meses)', 'Valor (R$)', 'Primeira', 'Última'], linhas: x.fieis.map((c: any) => [c.cliente, c.visitas, c.valor, dataBr(new Date(c.primeira)), dataBr(new Date(c.ultima))]) };
  if (tabela === 'sumidas') return { cab: ['Cliente', 'Visitas', 'Última visita', 'Dias sem agendar', 'Último serviço'], linhas: x.sumidas.lista.map((c: any) => [c.cliente, c.visitas, dataBr(new Date(c.ultima)), c.diasSem, c.ultimoServico]) };
  return {
    cab: ['Indicador', 'Valor'],
    linhas: [
      ['Clientes que agendaram no período', x.clientes],
      ['Novas (1ª vez)', x.novas],
      ['Voltaram (já tinham vindo)', x.voltaram],
      ['Taxa de retorno (%)', x.retornoPct],
      ['Agendaram mais de uma vez no período', x.maisDeUmaNoPeriodo],
      ['Intervalo mediano entre visitas (dias)', x.intervaloMedianoDias],
      ['Receita das novas (R$)', x.receitaNovas],
      ['Receita de quem voltou (R$)', x.receitaVoltaram],
      ...x.frequencia.map((f: any) => [`Clientes com ${f.faixa} em 12 meses`, f.total]),
    ],
  };
}

