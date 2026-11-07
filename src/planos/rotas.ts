import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Contas } from '../auth/contas.js';
import type { ArmazemComercial } from '../comercial/armazem.js';
import { calcularDesempenho } from '../desempenho/calculo.js';
import type { FonteDesempenho } from '../desempenho/fonte.js';
import { DIA } from '../util/tempo.js';
import { catalogo, custoMensalClt, horasDaJanela, precoAdicionalFora, precoExpediente } from './catalogo.js';
import { calcularComparativo, ladosDoDesempenho } from './comparativo.js';
import type { PagamentoProvider } from './pagamento.js';
import { fimDoMes, inicioDoMes, TEXTO_MOTIVO, type MotivoBloqueio, type Planos } from './porteiro.js';

/**
 * Plano e uso da IA (só administração e direção):
 * GET  /api/planos               plano atual, janela, cota e uso do mês (por dia, dentro × fora), pedidos
 * POST /api/planos/pedidos       { tipo: mudar_plano | adicional_fora | recarga, plano?, recargaId? } → registra o pedido
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
    const [{ assinatura: a, uso, cota }, decisao, pedidos, bloqueios] = await Promise.all([
      o.planos.cotaDoMes(emp, agora),
      o.planos.decidir(emp, agora),
      o.planos.armazem.pedidos(emp, 10),
      o.planos.armazem.bloqueios(emp, inicioDoMes(agora), fimDoMes(agora)),
    ]);
    const cfg = o.planos.configDe(a);
    const plano = o.planos.plano(a);
    return {
      assinatura: { plano: a.plano, adicionalFora: a.adicionalFora, status: a.status },
      plano,
      catalogo: catalogo(cfg),
      precos: { custoClt: custoMensalClt(cfg.clt), expediente: precoExpediente(cfg), adicionalFora: precoAdicionalFora(cfg), fatorPreco: cfg.fatorPreco, adicionalForaPct: cfg.adicionalForaPct, cambio: cfg.cambio },
      clt: cfg.clt,
      janela: cfg.janela,
      horasJanela: horasDaJanela(cfg.janela),
      feriados: cfg.feriados,
      recargas: cfg.recargas,
      agora: decisao.pode ? { pode: true, dentro: decisao.dentro } : { pode: false, dentro: decisao.dentro, motivo: decisao.motivo, texto: decisao.texto },
      cota,
      uso: { ...uso, custoReais: Math.round(uso.custoUsd * cfg.cambio * 100) / 100 },
      mes: { inicio: inicioDoMes(agora).toISOString(), fim: fimDoMes(agora).toISOString() },
      pedidos,
      bloqueios: bloqueios.map((b) => ({ ...b, texto: TEXTO_MOTIVO[b.motivo as MotivoBloqueio] ?? b.motivo })),
      pagamento: { provedor: o.pagamento.nome, ativo: o.pagamento.ativo },
      sugestao: true,
    };
  });

  const CorpoPedido = z.discriminatedUnion('tipo', [
    z.object({ tipo: z.literal('mudar_plano'), plano: z.enum(['gratis', 'expediente']) }),
    z.object({ tipo: z.literal('adicional_fora'), ligar: z.boolean().default(true) }),
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
      descricao = `Recarga ${r.nome}`;
    } else if (corpo.tipo === 'mudar_plano') {
      valor = corpo.plano === 'expediente' ? precoExpediente(cfg) : 0;
      dados = { plano: corpo.plano, de: a.plano, valor };
      descricao = `Plano ${corpo.plano === 'expediente' ? 'IA Expediente' : 'Grátis'}`;
    } else {
      valor = corpo.ligar ? precoAdicionalFora(cfg) : 0;
      dados = { ligar: corpo.ligar, valor };
      descricao = 'Adicional Fora do horário';
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
    // Fundador não paga: compara com o preço que pagaria no IA Expediente (+ adicional, já que roda 24 h).
    const cfgClt = { ...cfg, clt };
    const precoIa = plano.ilimitado ? precoExpediente(cfgClt) + precoAdicionalFora(cfgClt) : (plano.preco ?? 0) + (a.adicionalFora ? precoAdicionalFora(cfgClt) : 0);
    const horasIa = plano.ilimitado || a.adicionalFora ? 168 : plano.horasSemana;
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
    return { ...c, clt, plano: plano.id, precoReferencia: plano.ilimitado, periodo: { inicio: inicio.toISOString(), fim: agora.toISOString() } };
  });
}
