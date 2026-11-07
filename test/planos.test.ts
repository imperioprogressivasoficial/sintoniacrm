import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { PedidoAgente } from '../src/ai/agente.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemPlanosMemoria, ArmazemPlanosPostgres, type ArmazemPlanos } from '../src/planos/armazem.js';
import { CONFIG_SUGERIDA, catalogo, custoMensalClt, custoUsd, dentroDaJanela, horasDaJanela, precoAdicionalFora, precoExpediente } from '../src/planos/catalogo.js';
import { calcularComparativo } from '../src/planos/comparativo.js';
import { anotadorDe, comContexto, comPorteiro, medirCliente } from '../src/planos/medidor.js';
import { PagamentoManual } from '../src/planos/pagamento.js';
import { Planos } from '../src/planos/porteiro.js';
import { registrarPlanos } from '../src/planos/rotas.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const EMP = 'loja';
/** Segunda, 9/11/2026, horário da Bahia. */
const seg = (hora: number, min = 0) => bahia(2026, 11, 9, hora, min);
const espera = () => new Promise((r) => setTimeout(r, 5));

function planosCom(armazem: ArmazemPlanos = new ArmazemPlanosMemoria()) {
  return new Planos({ armazem, fundadoras: ['imperio'] });
}
async function assinar(p: Planos, plano: 'gratis' | 'expediente' | 'fundador', adicionalFora = false) {
  await p.armazem.gravarAssinatura({ empresaId: EMP, plano, adicionalFora, status: 'ativa', atualizadaEm: seg(8), atualizadaPor: 'teste' });
}
const uso = (tokens: number) => ({ entrada: tokens, saida: 0, cacheLeitura: 0, cacheEscrita: 0 });

describe('catálogo e fórmulas', () => {
  it('CLT, metade, adicional e janela de 44 h', () => {
    expect(custoMensalClt({ salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 44 })).toBe(3660);
    expect(precoExpediente(CONFIG_SUGERIDA)).toBe(1830);
    expect(precoAdicionalFora(CONFIG_SUGERIDA)).toBe(915);
    expect(horasDaJanela(CONFIG_SUGERIDA.janela)).toBe(44);
    expect(catalogo(CONFIG_SUGERIDA).map((p) => p.id)).toEqual(['gratis', 'expediente', 'fundador']);
  });
  it('custo por token (US$ por milhão) e janela com feriado', () => {
    expect(custoUsd(CONFIG_SUGERIDA, 'claude-opus-5-5', { entrada: 1_000_000, saida: 100_000, cacheLeitura: 1_000_000, cacheEscrita: 0 })).toBeCloseTo(4 + 2 + 0.2);
    expect(dentroDaJanela(seg(10), CONFIG_SUGERIDA.janela, [])).toBe(true);
    expect(dentroDaJanela(seg(16), CONFIG_SUGERIDA.janela, [])).toBe(false);
    expect(dentroDaJanela(bahia(2026, 11, 8, 10), CONFIG_SUGERIDA.janela, [])).toBe(false); // domingo
    expect(dentroDaJanela(bahia(2026, 11, 20, 10), CONFIG_SUGERIDA.janela, CONFIG_SUGERIDA.feriados)).toBe(false); // feriado (sexta)
  });
});

describe('medição de uso', () => {
  it('anota cada chamada com conversa, tokens, custo e dentro/fora; soma por dia e mês', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    let agora = seg(10);
    const falso = {
      beta: {
        messages: {
          create: async (args: { model: string }) => ({ model: args.model, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, content: [] }),
        },
      },
    };
    const cliente = medirCliente(falso, anotadorDe(p, EMP, () => agora));
    await comContexto({ conversaId: 'c1', origem: 'agente', dentro: true }, () => cliente.beta.messages.create({ model: 'claude-opus-5-5' }));
    agora = seg(21);
    await cliente.beta.messages.create({ model: 'claude-opus-5-5' }); // sem contexto: origem "outro", horário pela janela
    await espera();
    const a = p.armazem as ArmazemPlanosMemoria;
    expect(a.usos).toHaveLength(2);
    expect(a.usos[0]).toMatchObject({ conversaId: 'c1', origem: 'agente', entrada: 1000, saida: 200, cacheLeitura: 5000, dentroHorario: true });
    expect(a.usos[0]!.custoUsd).toBeCloseTo((1000 * 4 + 200 * 20 + 5000 * 0.2) / 1e6);
    expect(a.usos[1]).toMatchObject({ conversaId: null, origem: 'outro', dentroHorario: false });
    const r = await p.armazem.resumo(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1));
    expect(r.tokens).toBe(12400);
    expect(r.tokensDentro).toBe(6200);
    expect(r.tokensFora).toBe(6200);
    expect(r.conversas).toBe(1);
    expect(r.porDia).toHaveLength(1);
    expect(r.porDia[0]!.dia).toBe('2026-11-09');
  });
});

describe('porteiro', () => {
  it('plano Grátis: sem IA', async () => {
    const p = planosCom();
    expect(await p.decidir(EMP, seg(10))).toMatchObject({ pode: false, motivo: 'sem_plano' });
  });
  it('IA Expediente: dentro do horário pode, fora não; com o adicional pode', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    expect(await p.decidir(EMP, seg(10))).toMatchObject({ pode: true, dentro: true });
    expect(await p.decidir(EMP, seg(23))).toMatchObject({ pode: false, motivo: 'fora_do_horario' });
    await assinar(p, 'expediente', true);
    expect(await p.decidir(EMP, seg(23))).toMatchObject({ pode: true, dentro: false });
  });
  it('sem cota bloqueia; a recarga paga libera no mesmo mês', async () => {
    const p = planosCom();
    await assinar(p, 'expediente');
    await p.registrarUso({ empresaId: EMP, em: seg(9), conversaId: 'c1', origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(CONFIG_SUGERIDA.cotaTokens) });
    expect(await p.decidir(EMP, seg(10))).toMatchObject({ pode: false, motivo: 'sem_cota' });
    const ped = await p.armazem.criarPedido({ empresaId: EMP, tipo: 'recarga', dados: { tokens: 5_000_000 }, status: 'pendente', criadoEm: seg(10), pagoEm: null, por: 'x' });
    expect(await p.decidir(EMP, seg(10, 5))).toMatchObject({ pode: false }); // pedido pendente não credita
    await p.confirmarPedido(EMP, ped.id, seg(10, 10));
    expect(await p.decidir(EMP, seg(10, 15))).toMatchObject({ pode: true });
    const { cota } = await p.cotaDoMes(EMP, seg(11));
    expect(cota).toMatchObject({ base: CONFIG_SUGERIDA.cotaTokens, recargas: 5_000_000, restantes: 5_000_000 });
  });
  it('Fundador (conta original, sem assinatura gravada): IA sempre, sem cota e 24 h', async () => {
    const p = planosCom();
    await p.registrarUso({ empresaId: 'imperio', em: seg(9), conversaId: 'c', origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(10 * CONFIG_SUGERIDA.cotaTokens) });
    expect(await p.decidir('imperio', bahia(2026, 11, 8, 3))).toMatchObject({ pode: true, ilimitado: true });
    expect((await p.assinatura('imperio')).plano).toBe('fundador');
    expect((await p.assinatura('outra')).plano).toBe('gratis');
  });
  it('comPorteiro: bloqueada, a IA não roda e a conversa vai para a equipe com o motivo', async () => {
    const p = planosCom();
    let chamou = 0;
    const agente = { executar: async () => (chamou++, { texto: 'oi', acoes: [], recusou: false }) };
    const g = comPorteiro(agente, { planos: p, empresaId: EMP });
    const pedido = { conversa: { id: 'c9' } as Conversa, mensagens: [], agora: seg(10), modo: 'responder' } as PedidoAgente;
    const r = await g.executar(pedido);
    expect(chamou).toBe(0);
    expect(r.texto).toBe('');
    expect(r.acoes).toEqual([{ tipo: 'passar_para_humano', motivo: expect.stringContaining('Grátis') }]);
    expect((p.armazem as ArmazemPlanosMemoria).bloq).toMatchObject([{ conversaId: 'c9', motivo: 'sem_plano' }]);
    // Envio ativo bloqueado: só não envia (não tira a conversa da IA).
    expect((await g.executar({ ...pedido, tipoAtivo: 'followup_3d' } as PedidoAgente)).acoes).toEqual([]);
    await assinar(p, 'expediente');
    expect((await g.executar(pedido)).texto).toBe('oi');
    expect(chamou).toBe(1);
  });
});

describe('comparativo IA × humano', () => {
  it('custo por agendamento, horas cobertas e economia', () => {
    const c = calcularComparativo({
      dias: 30,
      clt: { salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 44 },
      precoIaMensal: 1830,
      horasIaSemana: 44,
      custoApiPeriodo: 120,
      ia: { conversas: 300, agendamentos: 60, respostaMs: 20_000 },
      equipe: { conversas: 200, agendamentos: 40, respostaMs: 600_000, atendentes: 2 },
    });
    expect(c.custoCltMensal).toBe(3660);
    expect(c.ia.custoPorAgendamento).toBe(30.5);
    expect(c.equipe.custoPeriodo).toBe(7320);
    expect(c.equipe.custoPorAgendamento).toBe(183);
    expect(c.equipe.horasSemana).toBe(88);
    expect(c.cltsEquivalentes).toBe(1);
    expect(c.economiaMensal).toBe(1830);
    expect(c.iaMaisBarataPorAgendamento).toBe(true);
    expect(c.respostaVezesMaisRapida).toBe(30);
  });
  it('24 h: a IA equivale a ~3,8 CLTs; sem agendamento não divide por zero', () => {
    const c = calcularComparativo({
      dias: 7,
      clt: { salario: 1800, encargosPct: 70, beneficios: 600, horasSemana: 44 },
      precoIaMensal: 2745,
      horasIaSemana: 168,
      custoApiPeriodo: 0,
      ia: { conversas: 0, agendamentos: 0, respostaMs: null },
      equipe: { conversas: 0, agendamentos: 0, respostaMs: null, atendentes: 0 },
    });
    expect(c.cltsEquivalentes).toBe(3.8);
    expect(c.economiaMensal).toBe(Math.round((3.8 * 3660 - 2745) * 100) / 100);
    expect(c.ia.custoPorAgendamento).toBeNull();
    expect(c.iaMaisBarataPorAgendamento).toBeNull();
  });
});

describe('rotas /api/planos', () => {
  async function app(papel: string) {
    const p = planosCom();
    const a = Fastify();
    a.addHook('onRequest', async (req) => {
      (req as { usuario?: unknown }).usuario = { id: 'u1', nome: 'Bruno', empresaId: 'imperio', papel };
    });
    registrarPlanos(a, { planos: p, pagamento: new PagamentoManual(), empresaId: 'imperio', agora: () => seg(10) });
    return { a, p };
  }
  it('admin vê o plano Fundador e registra pedido de recarga (sem cobrança real)', async () => {
    const { a, p } = await app('admin');
    const r = await a.inject({ method: 'GET', url: '/api/planos' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ assinatura: { plano: 'fundador' }, agora: { pode: true }, pagamento: { ativo: false } });
    const ped = await a.inject({ method: 'POST', url: '/api/planos/pedidos', payload: { tipo: 'recarga', recargaId: 'r5' } });
    expect(ped.json()).toMatchObject({ pedido: { status: 'pendente', dados: { tokens: 5_000_000 } }, pagamentoAtivo: false });
    expect(ped.json().mensagem).toContain('Em breve');
    expect(await p.armazem.pedidos('imperio')).toHaveLength(1);
    const comp = await a.inject({ method: 'GET', url: '/api/planos/comparativo?dias=30&salario=2000' });
    expect(comp.statusCode).toBe(200);
    expect(comp.json()).toMatchObject({ precoReferencia: true, ia: { horasSemana: 168 } });
  });
  it('atendente não entra', async () => {
    const { a } = await app('atendente');
    expect((await a.inject({ method: 'GET', url: '/api/planos' })).statusCode).toBe(403);
  });
});

describe.skipIf(!temPostgres)('planos no Postgres', () => {
  it('grava uso, assinatura, pedidos e bloqueios e soma igual à memória', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.ia_uso, sintonia.ia_assinaturas, sintonia.ia_pedidos, sintonia.ia_bloqueios');
    const p = planosCom(new ArmazemPlanosPostgres(pool));
    await assinar(p, 'expediente');
    await p.registrarUso({ empresaId: EMP, em: seg(10), conversaId: 'c1', origem: 'agente', modelo: 'claude-opus-5-5', uso: { entrada: 100, saida: 50, cacheLeitura: 10, cacheEscrita: 5 } });
    await p.registrarUso({ empresaId: EMP, em: seg(22), conversaId: 'c2', origem: 'agente', modelo: 'claude-opus-5-5', uso: uso(40) });
    const r = await p.armazem.resumo(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1));
    expect(r).toMatchObject({ tokens: 205, tokensDentro: 165, tokensFora: 40, conversas: 2, chamadas: 2 });
    expect(r.porDia.map((d) => d.dia)).toEqual(['2026-11-09']);
    expect((await p.assinatura(EMP)).plano).toBe('expediente');
    const ped = await p.armazem.criarPedido({ empresaId: EMP, tipo: 'recarga', dados: { tokens: 7 }, status: 'pendente', criadoEm: seg(10), pagoEm: null, por: null });
    await p.confirmarPedido(EMP, ped.id, seg(11));
    expect(await p.armazem.tokensRecargas(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1))).toBe(7);
    await p.armazem.registrarBloqueio({ empresaId: EMP, em: seg(23), conversaId: 'c3', motivo: 'fora_do_horario' });
    expect(await p.armazem.bloqueios(EMP, bahia(2026, 11, 1), bahia(2026, 12, 1))).toEqual([{ motivo: 'fora_do_horario', total: 1 }]);
  });
});
