import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Contas } from '../auth/contas.js';
import { pode } from '../auth/permissoes.js';
import type { ArmazemComercial } from '../comercial/armazem.js';
import { calcularDesempenho } from '../desempenho/calculo.js';
import type { FonteDesempenho } from '../desempenho/fonte.js';
import { estaAberta } from '../engine/horario.js';
import type { Planos } from '../planos/porteiro.js';
import { unidadeDe } from '../unidades.js';
import { DIA } from '../util/tempo.js';
import { calcularEconomia, CUSTO_PADRAO, usoRealDoDesempenho, type CustoEquipe } from './calculo.js';

/**
 * calculadora: "Quanto a IA economiza" (Inteligência › Quanto economiza). Não vende nada: só mostra a conta.
 * GET /api/economia-ia?dias=30[&salario=&encargosPct=&beneficios=&horasSemana=&minutosPorMensagem=&custoIaMes=]
 *     números reais do período + a conta com o custo da equipe (o gravado, ou o que veio na consulta, sem gravar).
 *     Quem vê relatórios vê.
 * PUT /api/economia-ia/custo { salario, encargosPct, beneficios, horasSemana, minutosPorMensagem, custoIaMes }
 *     grava o custo da equipe da empresa (administração e direção).
 */
export interface OpcoesEconomiaIa {
  fonte: FonteDesempenho;
  planos: Planos;
  armazemComercial?: ArmazemComercial;
  contas?: Contas;
  empresaId: string;
  agora: () => Date;
}

const erro = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });
const PAPEIS_EQUIPE = new Set(['atendente', 'recepcionista', 'gerente']);

const Campos = {
  salario: z.coerce.number().min(0).max(100_000),
  encargosPct: z.coerce.number().min(0).max(300),
  beneficios: z.coerce.number().min(0).max(100_000),
  horasSemana: z.coerce.number().min(1).max(80),
  minutosPorMensagem: z.coerce.number().min(0.1).max(60),
  custoIaMes: z.coerce.number().min(0).max(1_000_000),
};
const Corpo = z.object(Campos).strict();
const Filtro = z.object({
  dias: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'Escolha 7, 30 ou 90 dias.').default(30),
  salario: Campos.salario.optional(),
  encargosPct: Campos.encargosPct.optional(),
  beneficios: Campos.beneficios.optional(),
  horasSemana: Campos.horasSemana.optional(),
  minutosPorMensagem: Campos.minutosPorMensagem.optional(),
  custoIaMes: Campos.custoIaMes.optional(),
});

/** Custo gravado da empresa (o novo `economia`, depois o antigo custo do atendente do plano, depois o padrão). */
export function custoGravado(a: { clt?: Partial<Record<string, number>>; economia?: Record<string, number> }): CustoEquipe {
  const base: CustoEquipe = { ...CUSTO_PADRAO };
  const antigo = a.clt ?? {};
  for (const k of ['salario', 'encargosPct', 'beneficios', 'horasSemana'] as const) if (typeof antigo[k] === 'number') base[k] = antigo[k]!;
  const novo = Corpo.partial().safeParse(a.economia ?? {});
  return novo.success ? { ...base, ...novo.data } : base;
}

export function registrarEconomiaIa(app: FastifyInstance, o: OpcoesEconomiaIa): void {
  const empresa = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;

  app.get('/api/economia-ia', async (req) => {
    if (!pode(req, 'relatorios')) throw erro(403, 'Esta conta fica com quem vê os relatórios. Fale com a gestão.');
    const f = Filtro.parse(req.query);
    const emp = empresa(req);
    const agora = o.agora();
    const inicio = new Date(agora.getTime() - f.dias * DIA);
    const a = await o.planos.assinatura(emp);
    const gravado = custoGravado(a);
    const { dias, ...sobrepor } = f;
    const custo: CustoEquipe = { ...gravado, ...Object.fromEntries(Object.entries(sobrepor).filter(([, v]) => v !== undefined)) };
    const esc = { empresaId: emp };
    const [dados, pessoas, reg] = await Promise.all([
      o.fonte.carregar(inicio, agora, agora, esc),
      o.contas ? o.contas.listarUsuarios(emp) : Promise.resolve([]),
      o.armazemComercial?.ler(emp),
    ]);
    const equipe = pessoas.filter((p) => PAPEIS_EQUIPE.has(p.papel)).map((p) => ({ id: p.id, nome: p.nome }));
    const d = calcularDesempenho({ dados, inicio, fim: agora, agora, pessoas: equipe, precos: reg?.cfg.precos ?? [], limiteMin: 15 });
    const aberta = (unidade: string, em: Date) => {
      const u = unidadeDe(unidade, emp);
      return Object.keys(u.horario).length ? estaAberta(u, em) : null;
    };
    const real = usoRealDoDesempenho(d, dados, inicio, agora, dias, aberta);
    return {
      ...calcularEconomia(real, custo),
      gravado,
      podeGravar: ['admin', 'direcao'].includes(req.usuario?.papel ?? ''),
      periodo: { inicio: inicio.toISOString(), fim: agora.toISOString() },
    };
  });

  app.put('/api/economia-ia/custo', async (req) => {
    const u = req.usuario;
    if (!u || !['admin', 'direcao'].includes(u.papel)) throw erro(403, 'Quem ajusta o custo da equipe é a administração ou a direção.');
    const corpo = Corpo.parse(req.body);
    const emp = empresa(req);
    const a = await o.planos.assinatura(emp);
    await o.planos.armazem.gravarAssinatura({ ...a, economia: corpo, atualizadaEm: o.agora(), atualizadaPor: u.nome });
    return { custo: corpo };
  });
}
