import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Contas } from '../auth/contas.js';
import type { ArmazemComercial } from '../comercial/armazem.js';
import { calcularDesempenho } from '../desempenho/calculo.js';
import type { FonteDesempenho } from '../desempenho/fonte.js';
import { DIA } from '../util/tempo.js';
import { calcularCalculadora, catalogo, custoMensalClt, precoColaborador } from './catalogo.js';
import { calcularComparativo, ladosDoDesempenho } from './comparativo.js';
import type { PagamentoProvider } from './pagamento.js';
import { fimDoMes, inicioDoMes, TEXTO_MOTIVO, type Planos } from './porteiro.js';

/**
 * Plano e uso da IA (só administração e direção):
 * GET  /api/planos               plano atual, limites (5 h, semana, mês) com quando renovam, créditos, uso do mês,
 *                                pedidos e o padrão da calculadora (conversas/mês e tokens por conversa reais)
 * POST /api/planos/pedidos       { tipo: mudar_plano | recarga, plano?, recargaId? } → registra o pedido
 * PUT  /api/planos/custo-clt     { salario, encargosPct, beneficios, horasSemana } → custo do atendente da empresa
 * GET  /api/planos/comparativo   ?dias=30 → IA × atendente humano com os dados do Desempenho
 */
export interface OpcoesRotasPlanos {
  planos: Planos;
  pagamento: PagamentoProvider;
  empresaId: string;
  agora: () => Date;
  fonte?: FonteDesempenho;
  armazemComercial?: ArmazemComercial;
  contas?: Contas;
}

const erro = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });

export function registrarPlanos(app: FastifyInstance, o: OpcoesRotasPlanos): void {
  const exigir = (req: FastifyRequest) => {
    const u = req.usuario;
    if (!u || !['admin', 'direcao'].includes(u.papel)) throw erro(403, 'O plano da IA fica com a administração e a direção.');
    return u;
  };
  const empresa = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;

  app.get('/api/planos', async (req) => {
    exigir(req);
    const emp = empresa(req);
    const agora = o.agora();
    const [s, uso, ult30, decisao, pedidos, bloqueios] = await Promise.all([
      o.planos.situacao(emp, agora),
      o.planos.usoDoMes(emp, agora),
      o.planos.armazem.resumo(emp, new Date(agora.getTime() - 30 * DIA), agora),
      o.planos.decidir(emp, agora),
      o.planos.armazem.pedidos(emp, 10),
      o.planos.armazem.bloqueios(emp, inicioDoMes(agora), fimDoMes(agora)),
    ]);
    const a = s.assinatura;
    const cfg = o.planos.configDe(a);
    const plano = s.plano;
    // Padrão da calculadora: uso real dos últimos 30 dias. Conversas com mensagem no período (Desempenho);
    // sem essa fonte, as conversas em que a IA trabalhou (medidor). Tokens por conversa: média do medidor.
    let conversas30 = ult30.conversas;
    if (o.fonte) {
      const dados = await o.fonte.carregar(new Date(agora.getTime() - 30 * DIA), agora, agora, { empresaId: emp }).catch(() => null);
      if (dados) conversas30 = Math.max(conversas30, new Set(dados.mensagens.map((m) => m.conversaId)).size);
    }
    // Só calibra com amostra razoável (20+ conversas com IA) e média plausível (5 mil a 200 mil tokens); senão, referência.
    const media = ult30.conversas > 0 ? Math.round(ult30.tokens / ult30.conversas) : 0;
    const tokensPorConversa = ult30.conversas >= 20 && media >= 5_000 && media <= 200_000 ? media : null;
    return {
      assinatura: { plano: a.plano, status: a.status },
      plano,
      catalogo: catalogo(cfg).filter((x) => x.id !== 'fundador'),
      precos: { custoClt: custoMensalClt(cfg.clt), colaborador: precoColaborador(cfg), essencial: cfg.precoEssencial, cambio: cfg.cambio },
      clt: cfg.clt,
      recargas: cfg.recargas,
      agora: decisao.pode ? { pode: true, usandoCreditos: decisao.usandoCreditos } : { pode: false, motivo: decisao.motivo, texto: decisao.texto },
      limites: s.limites,
      creditos: s.creditos,
      ilimitado: s.ilimitado,
      estourou: s.estourou,
      calculadora: {
        conversasMes: conversas30 > 0 ? conversas30 : 1500,
        conversasReais: conversas30 > 0,
        tokensPorConversa,
        conversasPlano: cfg.conversasPlano,
        conversasPorRecarga: cfg.conversasPorRecarga,
        precoRecarga: cfg.recargas[0]!.preco,
        tokensRecarga: cfg.recargas[0]!.tokens,
        limiteMes: cfg.limites.mes,
        precoColaborador: precoColaborador(cfg),
      },
      uso: { ...uso, custoReais: Math.round(uso.custoUsd * cfg.cambio * 100) / 100 },
      mes: { inicio: inicioDoMes(agora).toISOString(), fim: fimDoMes(agora).toISOString() },
      pedidos,
      bloqueios: bloqueios.map((b) => ({ ...b, texto: TEXTO_MOTIVO[b.motivo] ?? b.motivo })),
      pagamento: { provedor: o.pagamento.nome, ativo: o.pagamento.ativo },
      sugestao: true,
    };
  });

  const CorpoPedido = z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('mudar_plano'), plano: z.enum(['essencial', 'gratis', 'expediente', 'empresarial']).transform((p) => (p === 'gratis' ? 'essencial' : p)) }),
    z.object({ tipo: z.literal('recarga'), recargaId: z.string().min(1).max(40) }),
  ]);

  app.post('/api/planos/pedidos', async (req) => {
    const u = exigir(req);
    const emp = empresa(req);
    const corpo = CorpoPedido.parse(req.body);
    const a = await o.planos.assinatura(emp);
    const cfg = o.planos.configDe(a);
    let dados: Record<string, unknown>;
    let valor: number;
    let descricao: string;
    if (corpo.tipo === 'recarga') {
      const r = cfg.recargas.find((x) => x.id === corpo.recargaId);
      if (!r) throw erro(400, 'Recarga não encontrada.');
      dados = { recargaId: r.id, tokens: r.tokens, valor: r.preco };
      valor = r.preco;
      descricao = `Créditos ${r.nome}`;
    } else {
      if (corpo.plano === a.plano) throw erro(400, 'A empresa já está neste plano.');
      const destino = catalogo(cfg).find((x) => x.id === corpo.plano)!;
      // Empresarial é sob medida: o pedido fica registrado e a equipe Sintonia entra em contato (sem valor).
      valor = destino.preco ?? 0;
      dados = { plano: corpo.plano, de: a.plano, valor, sobMedida: destino.preco === null };
      descricao = `Plano ${destino.nome}`;
    }
    const pedido = await o.planos.armazem.criarPedido({ empresaId: emp, tipo: corpo.tipo, dados, status: 'pendente', criadoEm: o.agora(), pagoEm: null, por: u.nome });
    const r = await o.pagamento.iniciar(pedido, valor, descricao);
    return { pedido, ...r, pagamentoAtivo: o.pagamento.ativo };
  });

  const CorpoClt = z.object({
    salario: z.number().min(0).max(100_000),
    encargosPct: z.number().min(0).max(300),
    beneficios: z.number().min(0).max(100_000).default(0),
    horasSemana: z.number().min(1).max(80).default(44),
  });
  app.put('/api/planos/custo-clt', async (req) => {
    const u = exigir(req);
    const emp = empresa(req);
    const clt = CorpoClt.parse(req.body);
    const a = await o.planos.assinatura(emp);
    await o.planos.armazem.gravarAssinatura({ ...a, clt, atualizadaEm: o.agora(), atualizadaPor: u.nome });
    return { clt, custoClt: custoMensalClt(clt) };
  });

  const FiltroComp = z.object({
    dias: z.coerce.number().int().min(1).max(90).default(30),
    salario: z.coerce.number().min(0).max(100_000).optional(),
    encargosPct: z.coerce.number().min(0).max(300).optional(),
    beneficios: z.coerce.number().min(0).max(100_000).optional(),
  });
  app.get('/api/planos/comparativo', async (req) => {
    exigir(req);
    const emp = empresa(req);
    const f = FiltroComp.parse(req.query);
    const agora = o.agora();
    const inicio = new Date(agora.getTime() - f.dias * DIA);
    const a = await o.planos.assinatura(emp);
    const cfg = o.planos.configDe(a);
    const clt = { ...cfg.clt, ...(f.salario !== undefined ? { salario: f.salario } : {}), ...(f.encargosPct !== undefined ? { encargosPct: f.encargosPct } : {}), ...(f.beneficios !== undefined ? { beneficios: f.beneficios } : {}) };
    const plano = o.planos.plano(a);
    // Fundador e Empresarial não têm preço de tabela: compara com o Colaborador de IA (R$ 1.997, IA 24 h).
    const referencia = plano.preco === null || !plano.ia;
    const precoIa = referencia ? precoColaborador(cfg) : plano.preco!;
    const horasIa = 168;
    const uso = await o.planos.armazem.resumo(emp, inicio, agora);
    let lados = { ia: { conversas: 0, agendamentos: 0, respostaMs: null as number | null }, equipe: { conversas: 0, agendamentos: 0, respostaMs: null as number | null, atendentes: 0 } };
    if (o.fonte) {
      const esc = { empresaId: emp };
      const [dados, pessoas, reg] = await Promise.all([
        o.fonte.carregar(inicio, agora, agora, esc),
        o.contas ? o.contas.listarUsuarios(emp) : Promise.resolve([]),
        o.armazemComercial?.ler(emp),
      ]);
      const equipe = pessoas.filter((p) => ['atendente', 'recepcionista', 'gerente'].includes(p.papel)).map((p) => ({ id: p.id, nome: p.nome }));
      const d = calcularDesempenho({ dados, inicio, fim: agora, agora, pessoas: equipe, precos: reg?.cfg.precos ?? [], limiteMin: 15 });
      lados = ladosDoDesempenho(d, dados, inicio, agora);
    }
    const c = calcularComparativo({ dias: f.dias, clt, precoIaMensal: precoIa, horasIaSemana: horasIa, custoApiPeriodo: uso.custoUsd * cfg.cambio, ...lados });
    return { ...c, clt, plano: plano.id, precoReferencia: referencia, periodo: { inicio: inicio.toISOString(), fim: agora.toISOString() } };
  });
}
