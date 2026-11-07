import { describe, expect, it } from 'vitest';
import { escopoDe, noEscopo, podeVer } from '../src/auth/acesso.js';
import type { Usuario } from '../src/auth/contas.js';
import type { Conversa } from '../src/domain.js';
import { janela } from '../src/painel/painel.js';
import { bahia } from '../src/util/tempo.js';
import { AgenteFalso, ambientes, montarGestao } from './gestao-ambiente.js';

const quarta = (h: number, m = 0) => bahia(2026, 11, 4, h, m);
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

/**
 * Cenário (horário da Bahia):
 * - quarta 11:00 e 19:00: uma cliente nova no Norte em cada horário (a IA assume 15 min depois);
 * - quinta 09:00 Marina (Norte), loja fechada: a IA responde em 30 s;
 * - quinta 14:00 Joana (Norte): a Carla responde às 14:05 e agenda às 14:10;
 * - quinta 15:00 Paula (Sumaré): a Rita responde às 15:10 e registra uma ligação;
 * - quinta 16:00 Fernanda (Norte): ninguém responde, a IA assume às 16:15 (+30 s) e agenda;
 * - quinta 17:55 a Bia abre a conversa da Marina (online); o painel é pedido às 18:00.
 */
async function cenario(amb: (typeof ambientes)[number]) {
  const relogio = { t: quarta(11) };
  const agente = new AgenteFalso((p) => {
    if (!p.tipoAtivo) relogio.t = new Date(relogio.t.getTime() + 30_000); // a IA "pensa" 30 s
    if (p.conversa.nome === 'Fernanda' && p.modo === 'responder' && !p.tipoAtivo) {
      return {
        texto: 'Agendado!',
        acoes: [{ tipo: 'agendou', clienteTrinksId: 1, agendamento: { trinksId: 9, unidade: 'norte', servico: 'Progressiva', inicio: quinta(20), duracaoMin: 180 } }],
        recusou: false,
      };
    }
    return { texto: 'Oi! Posso ajudar?', acoes: [], recusou: false };
  });
  const g = await montarGestao(amb, { agente, relogio });
  const mover = (d: Date) => {
    relogio.t = d;
  };

  await g.conversa('norte', 'Ontem Manhã');
  mover(quarta(11, 15));
  await g.sintonia.tick(); // ninguém respondeu: a IA assume
  mover(quarta(19));
  await g.conversa('norte', 'Ontem Noite');
  mover(quarta(19, 15));
  await g.sintonia.tick();

  mover(quinta(9));
  const marina = await g.conversa('norte', 'Marina');
  mover(quinta(14));
  const joana = await g.conversa('norte', 'Joana');
  mover(quinta(14, 5));
  await g.como(g.gente.carla, 'POST', `/api/conversas/${joana.id}/enviar`, { texto: 'Oi Joana! Quer marcar?' });
  mover(quinta(14, 10));
  await g.sintonia.equipeAgendou(
    joana.id,
    { tipo: 'agendou', clienteTrinksId: 5, agendamento: { trinksId: 77, unidade: 'norte', servico: 'Progressiva', inicio: quinta(19), duracaoMin: 180 } },
    'Carla Lima',
    g.gente.carla,
  );
  mover(quinta(15));
  const paula = await g.conversa('sumare', 'Paula');
  mover(quinta(15, 10));
  await g.como(g.gente.rita, 'POST', `/api/conversas/${paula.id}/enviar`, { texto: 'Oi Paula!' });
  mover(quinta(15, 20));
  expect((await g.como(g.gente.rita, 'POST', `/api/conversas/${paula.id}/ligacao`, { resultado: 'atendeu' })).statusCode).toBe(200);
  mover(quinta(16));
  const fernanda = await g.conversa('norte', 'Fernanda');
  mover(quinta(16, 15));
  await g.sintonia.tick();
  mover(quinta(17, 55));
  await g.como(g.gente.bia, 'POST', `/api/conversas/${marina.id}/digitando`, {});
  mover(quinta(18));
  return { ...g, marina, joana, paula, fernanda };
}

type Painel = {
  escopo: string;
  leads: { total: number; anterior: number; variacaoPct: number | null };
  primeiraResposta: Record<'geral' | 'equipe' | 'ia', { mediaSeg: number | null; n: number }>;
  tempoResposta: Record<'geral' | 'equipe' | 'ia', { mediaSeg: number | null; n: number }>;
  agendamentos: { ia: number; equipe: number; total: number; anterior: number; conversaoPct: number | null };
  leadsPorHora: number[];
  funil: Array<{ etapa: string; conversas: number }>;
  ranking: Array<{ nome: string; respostas: number; agendamentos: number; tempoMedioRespostaSeg: number | null; conversasDona: number; ligacoes: number; online: boolean }>;
  equipe: { ativas: number; online: number; onlineNomes: string[] } | null;
};
type Serie = { unidade: 'hora' | 'dia'; pontos: Array<{ chave: string; rotulo: string; leads: number; agendamentos: number }> };
const horas = (pares: Record<number, number>) => Array.from({ length: 24 }, (_, h) => pares[h] ?? 0);

describe.each(ambientes)('Painel da gestão ($nome)', (amb) => {
  it('confere os números de hoje, a comparação com ontem e o horário da Bahia', async () => {
    const g = await cenario(amb);
    const r = await g.como(g.gente.admin, 'GET', '/api/painel/completo?periodo=hoje');
    expect(r.statusCode).toBe(200);
    const p = r.json() as Painel;
    expect(p.escopo).toBe('empresa');
    // Ontem até as 18h só a das 11h conta.
    expect(p.leads).toEqual({ total: 4, anterior: 1, variacaoPct: 300 });
    expect(p.leadsPorHora).toEqual(horas({ 9: 1, 14: 1, 15: 1, 16: 1 }));
    expect(p.primeiraResposta).toEqual({
      geral: { mediaSeg: 465, n: 4 },
      equipe: { mediaSeg: 450, n: 2 },
      ia: { mediaSeg: 480, n: 2 },
    });
    expect(p.tempoResposta).toEqual({
      geral: { mediaSeg: 465, n: 4 },
      equipe: { mediaSeg: 450, n: 2 },
      ia: { mediaSeg: 480, n: 2 },
    });
    expect(p.agendamentos).toMatchObject({ ia: 1, equipe: 1, total: 2, anterior: 0, conversaoPct: 50 });

    const conversas = await g.repo.listarConversas();
    const esperado = (etapa: string) => conversas.filter((c) => c.etapa === etapa).length;
    expect(p.funil.find((f) => f.etapa === 'agendada')!.conversas).toBe(2);
    for (const f of p.funil) expect(f.conversas).toBe(esperado(f.etapa));

    expect(p.ranking.map((x) => x.nome)).toEqual(['Carla Lima', 'Rita Recepção', 'Bia Souza']);
    expect(p.ranking[0]).toEqual({ usuarioId: g.gente.carla.id, nome: 'Carla Lima', papel: 'atendente', respostas: 1, agendamentos: 1, tempoMedioRespostaSeg: 300, conversasDona: 1, ligacoes: 0, online: false });
    expect(p.ranking[1]).toMatchObject({ respostas: 1, agendamentos: 0, tempoMedioRespostaSeg: 600, conversasDona: 1, ligacoes: 1 });
    expect(p.ranking[2]).toMatchObject({ respostas: 0, tempoMedioRespostaSeg: null, online: true });
    expect(p.equipe).toEqual({ ativas: 3, online: 1, onlineNomes: ['Bia Souza'] });
  });

  it('ontem, 7 e 30 dias, e período inválido', async () => {
    const g = await cenario(amb);
    const ontem = (await g.como(g.gente.direcao, 'GET', '/api/painel/completo?periodo=ontem')).json() as Painel;
    expect(ontem.leads).toEqual({ total: 2, anterior: 0, variacaoPct: null });
    expect(ontem.leadsPorHora).toEqual(horas({ 11: 1, 19: 1 }));
    expect(ontem.agendamentos.conversaoPct).toBe(0);
    expect(ontem.primeiraResposta.ia).toEqual({ mediaSeg: 930, n: 2 }); // 15 min de prazo + 30 s pensando
    expect(ontem.ranking.every((x) => x.respostas === 0)).toBe(true);
    const sete = (await g.como(g.gente.admin, 'GET', '/api/painel/completo?periodo=7d')).json() as Painel;
    expect(sete.leads.total).toBe(6);
    expect(sete.leadsPorHora).toEqual(horas({ 9: 1, 11: 1, 14: 1, 15: 1, 16: 1, 19: 1 }));
    expect(((await g.como(g.gente.admin, 'GET', '/api/painel/completo?periodo=30d')).json() as Painel).leads.total).toBe(6);
    // Curva: 7 dias por dia (hoje é o último ponto), hoje por hora.
    const serie7 = (sete as unknown as { serie: Serie }).serie;
    expect(serie7.unidade).toBe('dia');
    expect(serie7.pontos).toHaveLength(7);
    expect(serie7.pontos.at(-1)).toEqual({ chave: '2026-11-05', rotulo: '05/11', leads: 4, agendamentos: 2 });
    expect(serie7.pontos.at(-2)).toEqual({ chave: '2026-11-04', rotulo: '04/11', leads: 2, agendamentos: 0 });
    expect(serie7.pontos[0]!.chave).toBe('2026-10-30');
    const hoje = (await g.como(g.gente.admin, 'GET', '/api/painel/completo?periodo=hoje')).json() as { serie: Serie };
    expect(hoje.serie.unidade).toBe('hora');
    expect(hoje.serie.pontos.map((x) => x.leads)).toEqual(horas({ 9: 1, 14: 1, 15: 1, 16: 1 }));
    expect(hoje.serie.pontos.map((x) => x.agendamentos)).toEqual(horas({ 14: 1, 16: 1 }));
    expect((await g.como(g.gente.admin, 'GET', '/api/painel/completo?periodo=ano')).statusCode).toBe(400);
    // Sem período: hoje.
    expect(((await g.como(g.gente.admin, 'GET', '/api/painel/completo')).json() as Painel).leads.total).toBe(4);
  });

  it('cada um vê o que pode: gerente a unidade, atendente só os números dela', async () => {
    const g = await cenario(amb);
    const norte = (await g.como(g.gente.gerenteNorte, 'GET', '/api/painel/completo')).json() as Painel;
    expect(norte.escopo).toBe('unidades');
    expect(norte.leads).toEqual({ total: 3, anterior: 1, variacaoPct: 200 });
    expect(norte.agendamentos).toMatchObject({ ia: 1, equipe: 1 });
    expect(norte.ranking.map((x) => x.nome)).toEqual(['Carla Lima', 'Bia Souza']);
    expect(norte.equipe).toEqual({ ativas: 2, online: 1, onlineNomes: ['Bia Souza'] });

    const carla = (await g.como(g.gente.carla, 'GET', '/api/painel/completo')).json() as Painel;
    expect(carla.escopo).toBe('pessoal');
    expect(carla.leads.total).toBe(3); // a dela (Joana) e as sem dona da unidade
    expect(carla.ranking.map((x) => x.nome)).toEqual(['Carla Lima']);
    expect(carla.equipe).toBeNull();

    const rita = (await g.como(g.gente.rita, 'GET', '/api/painel/completo')).json() as Painel;
    expect(rita.leads.total).toBe(1);
    expect(rita.primeiraResposta.equipe).toEqual({ mediaSeg: 600, n: 1 });
    expect(rita.ranking).toEqual([expect.objectContaining({ nome: 'Rita Recepção', ligacoes: 1, respostas: 1 })]);
    expect(rita.funil.reduce((s, f) => s + f.conversas, 0)).toBe(1);
  });
});

describe.each(ambientes)('Meta do mês do Dashboard ($nome)', (amb) => {
  it('começa sem meta, a gestão define, todos veem o progresso do seu alcance', async () => {
    const g = await cenario(amb);
    const vazia = await g.como(g.gente.admin, 'GET', '/api/painel/meta');
    expect(vazia.statusCode).toBe(200);
    expect(vazia.json()).toMatchObject({ mes: '2026-11', meta: null, agendamentos: 2, ia: 1, equipe: 1, progressoPct: null, faltam: null, diasNoMes: 30, diasRestantes: 26, podeEditar: true });

    // Atendente não muda a meta.
    expect((await g.como(g.gente.carla, 'PUT', '/api/painel/meta', { agendamentosMes: 50 })).statusCode).toBe(403);
    // Valor inválido.
    expect((await g.como(g.gente.admin, 'PUT', '/api/painel/meta', { agendamentosMes: -3 })).statusCode).toBe(400);
    expect((await g.como(g.gente.admin, 'PUT', '/api/painel/meta', { agendamentosMes: 2.5 })).statusCode).toBe(400);

    const ok = await g.como(g.gente.gerenteNorte, 'PUT', '/api/painel/meta', { agendamentosMes: 8 });
    expect(ok.statusCode).toBe(200);
    // A gerente do Norte vê o progresso só da unidade dela (os 2 agendamentos são do Norte).
    expect(ok.json()).toMatchObject({ meta: 8, agendamentos: 2, progressoPct: 25, faltam: 6, atualizadaPor: 'Gil Norte' });

    const carla = (await g.como(g.gente.carla, 'GET', '/api/painel/meta')).json();
    expect(carla).toMatchObject({ meta: 8, podeEditar: false });
    const rita = (await g.como(g.gente.rita, 'GET', '/api/painel/meta')).json();
    expect(rita).toMatchObject({ meta: 8, agendamentos: 0, progressoPct: 0, faltam: 8 });

    // Tirar a meta.
    expect((await g.como(g.gente.direcao, 'PUT', '/api/painel/meta', { agendamentosMes: null })).json()).toMatchObject({ meta: null, progressoPct: null });
    expect((await g.empresa.meta()).agendamentosMes).toBeNull();
  });
});

describe('Janela do período (horário da Bahia)', () => {
  it('hoje compara com ontem até a mesma hora; 7d e 30d contam o dia de hoje', () => {
    const agora = bahia(2026, 11, 5, 1, 30); // 04:30 UTC
    const h = janela('hoje', agora);
    expect(h.inicio).toEqual(bahia(2026, 11, 5));
    expect(h.anterior).toEqual({ inicio: bahia(2026, 11, 4), fim: bahia(2026, 11, 4, 1, 30) });
    expect(janela('ontem', agora)).toMatchObject({ inicio: bahia(2026, 11, 4), fim: bahia(2026, 11, 5) });
    expect(janela('7d', agora).inicio).toEqual(bahia(2026, 10, 30));
    expect(janela('30d', agora).anterior.inicio).toEqual(bahia(2026, 9, 7));
  });
});

describe('Escopo de visão = podeVer', () => {
  it('diz o mesmo que podeVer para todos os papéis e conversas', () => {
    const pessoas: Usuario[] = (
      [
        ['a', 'admin', []],
        ['d', 'direcao', []],
        ['g', 'gerente', ['norte']],
        ['c', 'atendente', ['norte']],
        ['r', 'recepcionista', ['sumare', 'norte']],
        ['n', 'atendente', []],
      ] as const
    ).map(([id, papel, unidades]) => ({ id, empresaId: 'imperio', nome: id, email: id, papel, unidades: [...unidades], ativo: true }));
    const outra: Usuario = { ...pessoas[0]!, id: 'x', empresaId: 'outra' };
    for (const u of [...pessoas, outra]) {
      for (const empresaId of ['imperio', 'outra']) {
        for (const unidade of ['norte', 'sumare'] as const) {
          for (const responsavelId of [undefined, 'c', 'r', 'g']) {
            const c = { id: '1', empresaId, unidade, responsavelId } as Conversa;
            expect(noEscopo(escopoDe(u), c), `${u.papel} ${empresaId} ${unidade} ${responsavelId}`).toBe(podeVer(u, c));
          }
        }
      }
    }
  });
});
