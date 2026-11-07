import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoDe, type EscopoVisao } from '../auth/acesso.js';
import type { Contas } from '../auth/contas.js';
import { pode } from '../auth/permissoes.js';
import type { ArmazemComercial } from '../comercial/armazem.js';
import { janela } from '../painel/painel.js';
import { periodoRelatorio } from '../relatorios/relatorios.js';
import { UNIDADES } from '../unidades.js';
import { calcularDesempenho, desempenhoCsv, montarFila, TABELAS_CSV, type TabelaCsv } from './calculo.js';
import type { FonteDesempenho } from './fonte.js';

/**
 * Desempenho do atendimento (visão do dono): /api/desempenho (tudo do período), /api/desempenho/fila (quem espera
 * resposta agora) e /api/desempenho/:tabela/csv. Quem pode ver relatórios vê; exportar pede "exportar".
 */
export interface OpcoesDesempenho {
  fonte: FonteDesempenho;
  armazem?: ArmazemComercial;
  contas?: Contas;
  empresaId: string;
  unidades: string[];
  agora: () => Date;
}

const erro = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const PAPEIS = new Set(['atendente', 'recepcionista', 'gerente']);

export function registrarDesempenho(app: FastifyInstance, o: OpcoesDesempenho): void {
  const Filtro = z.object({
    periodo: z.enum(['hoje', 'ontem', '7d', '30d', 'personalizado']).default('hoje'),
    de: Data.optional(),
    ate: Data.optional(),
    unidade: z.enum(o.unidades as [string, ...string[]]).optional(),
    atendente: z.string().min(1).max(80).optional(),
    limite: z.coerce.number().int().min(1).max(24 * 60).default(15),
  });
  type Filtro = z.infer<typeof Filtro>;
  const exigir = (req: FastifyRequest) => {
    if (!pode(req, 'relatorios')) throw erro(403, 'O Desempenho fica com quem vê os relatórios. Fale com a gestão.');
  };
  const escopo = (req: FastifyRequest, f: Filtro): EscopoVisao => {
    const base: EscopoVisao = { empresaId: req.usuario?.empresaId ?? o.empresaId, ...escopoDe(req.usuario) };
    // Desempenho é da equipe: quem vê relatórios vê o time das unidades dele, não só as conversas dele.
    delete base.donaOuSemDona;
    if (f.unidade) {
      if (base.unidades && !base.unidades.includes(f.unidade)) throw erro(403, 'Essa unidade não é sua.');
      base.unidades = [f.unidade];
    }
    return base;
  };
  const intervalo = (f: Filtro, agora: Date) => {
    if (f.periodo === 'ontem') {
      const j = janela('ontem', agora);
      return { inicio: j.inicio, fim: j.fim };
    }
    const r = periodoRelatorio({ periodo: f.periodo, de: f.de, ate: f.ate } as Parameters<typeof periodoRelatorio>[0], agora);
    return { inicio: r.inicio, fim: r.fim.getTime() > agora.getTime() ? agora : r.fim };
  };
  const equipe = async (req: FastifyRequest, esc: EscopoVisao) => {
    const todas = req.usuario && o.contas ? await o.contas.listarUsuarios(req.usuario.empresaId) : [];
    return todas.filter((p) => PAPEIS.has(p.papel) && (!esc.unidades || p.unidades.some((x) => esc.unidades!.includes(x))));
  };

  async function montar(req: FastifyRequest) {
    exigir(req);
    const f = Filtro.parse(req.query);
    const agora = o.agora();
    const esc = escopo(req, f);
    const { inicio, fim } = intervalo(f, agora);
    const [dados, pessoas, reg, esperando] = await Promise.all([
      o.fonte.carregar(inicio, fim, agora, esc),
      equipe(req, esc),
      o.armazem?.ler(esc.empresaId ?? o.empresaId),
      o.fonte.esperando(esc),
    ]);
    const d = calcularDesempenho({ dados, inicio, fim, agora, pessoas: pessoas.map((p) => ({ id: p.id, nome: p.nome })), precos: reg?.cfg.precos ?? [], limiteMin: f.limite, atendente: f.atendente });
    const fila = montarFila(esperando, agora, { atendente: f.atendente });
    const opcoes = {
      unidades: o.unidades.filter((u) => !esc.unidades || esc.unidades.includes(u) || f.unidade).map((u) => ({ id: u, nome: UNIDADES[u as keyof typeof UNIDADES]?.nome ?? u })),
      atendentes: pessoas.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    };
    return { f, d, fila, opcoes, agora };
  }

  app.get('/api/desempenho', async (req) => {
    const { d, fila, opcoes, agora } = await montar(req);
    return { ...d, fila, opcoes, agora: agora.toISOString() };
  });

  app.get('/api/desempenho/fila', async (req) => {
    const { fila, agora } = await montar(req);
    return { fila, agora: agora.toISOString() };
  });

  app.get('/api/desempenho/:tabela/csv', async (req, reply) => {
    if (!pode(req, 'exportar')) throw erro(403, 'Você não tem permissão para exportar. Fale com a gestão.');
    const tabela = z.enum(TABELAS_CSV).parse((req.params as { tabela: string }).tabela) as TabelaCsv;
    const { d, fila, f } = await montar(req);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="desempenho-${tabela}-${f.periodo}.csv"`)
      .header('cache-control', 'no-store')
      .send(desempenhoCsv(tabela, d, fila));
  });
}
