import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { analisarFunil, analisarHorarios, analisarRecorrencia, analisarVendas, gradeDe, resumirGrade, variacao } from '../src/analises/calculo.js';
import { FonteAnalisesMemoria, FonteAnalisesPostgres, type FonteAnalises } from '../src/analises/fonte.js';
import { OrigensConversa } from '../src/analises/origens.js';
import { registrarAnalises } from '../src/analises/rotas.js';
import type { Usuario } from '../src/auth/contas.js';
import { ArmazemComercialMemoria } from '../src/comercial/armazem.js';
import { ConfigComercial, type Venda } from '../src/comercial/calculo.js';
import { FonteComercialMemoria, FonteComercialPostgres, type FonteComercial } from '../src/comercial/fonte.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia, DIA, HORA } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/** Sexta, 20/11/2026 (horário da Bahia). */
const h = (dia: number, hora = 10, min = 0, mes = 11) => bahia(2026, mes, dia, hora, min);
const EMP = 'emp-a';
const OUTRA = 'emp-b';
const ANA = '00000000-0000-4000-8000-0000000000a1';
const BIA = '00000000-0000-4000-8000-0000000000b1';
const precos = [{ servico: 'Selagem', valor: 150 }];

const venda = (p: Partial<Venda> & { em: Date }): Venda => ({
  conversaId: 'c1',
  unidade: 'norte',
  servico: 'Progressiva',
  atendenteId: ANA,
  atendenteNome: 'Ana',
  responsavelId: ANA,
  porIa: false,
  valor: 200,
  compareceu: false,
  primeiroNome: 'Carla',
  ...p,
});

describe('análises: vendas e receita', () => {
  it('receita por dia, por quem vendeu, por serviço, ticket médio e variação', () => {
    const r = analisarVendas({
      vendas: [
        venda({ conversaId: 'c1', em: h(18), valor: 200, compareceu: true }),
        venda({ conversaId: 'c2', em: h(18, 15), servico: 'Selagem', valor: null }), // preço da tabela: 150
        venda({ conversaId: 'c3', em: h(19), porIa: true, atendenteId: null, atendenteNome: null, servico: null, valor: null }), // sem valor
        venda({ conversaId: 'c4', em: h(20), atendenteId: BIA, atendenteNome: 'Bia', unidade: 'sumare', valor: 300, compareceu: true }),
      ],
      anteriores: [venda({ em: h(10), valor: 325 })],
      precos,
      dias: ['2026-11-18', '2026-11-19', '2026-11-20'],
      origens: new Map([['c1', 'Instagram'], ['c2', 'Instagram'], ['c4', 'Indicação']]),
      leads: [
        { conversaId: 'c1', origem: 'Instagram' },
        { conversaId: 'c2', origem: 'Instagram' },
        { conversaId: 'c5', origem: 'Instagram' },
        { conversaId: 'c6', origem: 'Google' },
      ],
    });
    expect(r.totais).toMatchObject({ vendas: 4, receita: 650, ticketMedio: 216.67, semValor: 1, compareceram: 2, receitaConfirmada: 500, comparecimentoPct: 50 });
    expect(r.totais.variacaoReceitaPct).toBe(100); // 650 contra 325
    expect(r.totais.ia).toMatchObject({ vendas: 1, receita: 0 });
    expect(r.dias).toEqual([
      { dia: '2026-11-18', vendas: 2, receita: 350 },
      { dia: '2026-11-19', vendas: 1, receita: 0 },
      { dia: '2026-11-20', vendas: 1, receita: 300 },
    ]);
    expect(r.atendentes.map((a) => [a.nome, a.vendas, a.receita])).toEqual([['Ana', 2, 350], ['Bia', 1, 300], ['IA da Sintonia', 1, 0]]);
    expect(r.servicos.map((s) => [s.nome, s.vendas, s.receita])).toEqual([['Progressiva', 2, 500], ['Selagem', 1, 150], ['Serviço não informado', 1, 0]]);
    expect(r.unidades.map((u) => [u.unidade, u.receita])).toEqual([['norte', 350], ['sumare', 300]]);
    // Origens: Instagram trouxe 3 leads, 2 compraram (66,7%); a conversa sem origem conhecida conta como WhatsApp.
    const ig = r.origens.find((o) => o.origem === 'Instagram')!;
    expect(ig).toMatchObject({ leads: 3, viraramVenda: 2, conversaoPct: 66.7, vendas: 2, receita: 350 });
    expect(r.origens.find((o) => o.origem === 'Google')).toMatchObject({ leads: 1, viraramVenda: 0, vendas: 0 });
    expect(r.origens.find((o) => o.origem === 'WhatsApp')).toMatchObject({ leads: 0, vendas: 1 });
    expect(variacao(10, 0)).toBeNull();
  });
});

describe('análises: horários de pico', () => {
  it('grade dia × hora no horário da Bahia, pico, hora e dia mais cheios e a faixa de 3 horas', () => {
    // 20/11/2026 é sexta (5). 23h30 da Bahia já é sábado em UTC: tem de ficar na sexta.
    const datas = [h(20, 18), h(20, 18, 30), h(20, 19), h(20, 20), h(20, 23, 30), h(16, 9)];
    const g = gradeDe(datas);
    expect(g[5]![18]).toBe(2);
    expect(g[5]![23]).toBe(1);
    expect(g[1]![9]).toBe(1);
    const r = resumirGrade(g);
    expect(r.total).toBe(6);
    expect(r.pico).toEqual({ diaSemana: 5, hora: 18, total: 2 });
    expect(r.horaPico).toBe(18);
    expect(r.diaPico).toBe(5);
    expect(r.faixa).toMatchObject({ de: 18, ate: 21, total: 4, pct: 66.7 });
    const vazio = analisarHorarios({ leads: gradeDe([]), mensagens: g, agendamentos: gradeDe([]) });
    expect(vazio.leads).toMatchObject({ total: 0, pico: null, horaPico: null, faixa: null });
    expect(vazio.mensagens.total).toBe(6);
  });
});

describe('análises: funil', () => {
  it('tempo parado em cada etapa, quem está parado agora e motivos de perda', () => {
    const inicio = h(14, 0);
    const fim = h(20, 12);
    const r = analisarFunil({
      inicio,
      fim,
      agora: fim,
      conversas: [
        { id: 'a', nome: 'Ana', unidade: 'norte', etapa: 'agendada', criadaEm: h(15, 8) },
        { id: 'b', nome: 'Bia', unidade: 'norte', etapa: 'perdida', criadaEm: h(15, 8) },
        { id: 'c', nome: 'Cris', unidade: 'sumare', etapa: 'em_conversa', criadaEm: h(10, 8) },
        { id: 'd', nome: null, unidade: 'norte', etapa: 'novo_lead', criadaEm: h(20, 10) },
      ],
      mudancas: [
        { conversaId: 'a', em: h(15, 10), de: 'novo_lead', para: 'em_conversa' }, // 2 h em novo lead
        { conversaId: 'a', em: h(15, 16), de: 'em_conversa', para: 'agendada' }, // 6 h em conversa
        { conversaId: 'b', em: h(15, 9), de: 'novo_lead', para: 'em_conversa' }, // 1 h
        { conversaId: 'b', em: h(16, 9), de: 'em_conversa', para: 'perdida', motivo: 'Achou caro' }, // 24 h
        { conversaId: 'c', em: h(10, 9), de: 'novo_lead', para: 'em_conversa' }, // antes do período: não conta como saída
      ],
    });
    const etapa = (k: string) => r.etapas.find((e) => e.etapa === k)!;
    expect(etapa('novo_lead')).toMatchObject({ saidas: 2, mediaMs: 1.5 * HORA, agora: 1 });
    expect(etapa('em_conversa')).toMatchObject({ saidas: 2, mediaMs: 15 * HORA, medianaMs: 15 * HORA, agora: 1 });
    expect(etapa('em_conversa').destinos.map((d) => [d.para, d.total, d.pct])).toEqual([['agendada', 1, 50], ['perdida', 1, 50]]);
    // Parada agora: Cris está em conversa desde 10/11 9h (10 dias e 3 h); Ana agendada desde 15/11 16h.
    expect(r.paradas[0]).toMatchObject({ conversaId: 'c', etapa: 'em_conversa', paradoMs: 10 * DIA + 3 * HORA });
    expect(r.paradas.map((p) => p.conversaId)).toEqual(['c', 'a', 'd']);
    expect(r.paradas.at(-1)!.cliente).toBe('Cliente');
    expect(r.perdas).toEqual({ total: 1, motivos: [{ nome: 'Achou caro', total: 1, pct: 100 }], etapas: [{ nome: 'Em conversa', total: 1, pct: 100 }] });
  });
});

describe('análises: clientes que voltaram', () => {
  it('novas × quem voltou, intervalo entre visitas, frequência, fiéis e sumidas', () => {
    const inicio = h(1, 0);
    const fim = h(20, 12);
    const ag = (conversaId: string, em: Date, p: { nome?: string; valor?: number | null; servico?: string } = {}) => ({ conversaId, em, nome: p.nome ?? conversaId, servico: p.servico ?? 'Selagem', valor: p.valor ?? null, compareceu: true });
    const r = analisarRecorrencia({
      inicio,
      fim,
      agora: fim,
      precos,
      agendamentos: [
        ag('ana', h(10, 10, 0, 10)), // outubro
        ag('ana', h(10, 10)), // voltou em novembro (31 dias depois)
        ag('ana', h(10, 12)), // remarcação no mesmo dia: mesma visita
        ag('bia', h(5, 10), { valor: 300 }), // nova
        ag('bia', h(15, 10), { valor: 300 }), // nova e veio 2x no período
        ag('cris', h(1, 10, 0, 8)), // agosto: sumida (111 dias)
        ag('duda', h(1, 10, 0, 10)), // outubro: 50 dias, ainda não sumida
      ],
    });
    expect(r).toMatchObject({ clientes: 2, novas: 1, voltaram: 1, retornoPct: 50, maisDeUmaNoPeriodo: 1, receitaNovas: 600, receitaVoltaram: 150 });
    expect(r.intervaloMedianoDias).toBe(20.5); // 10 dias (Bia) e 31 dias (Ana)
    expect(r.frequencia.map((f) => f.total)).toEqual([0, 2, 0, 0]);
    expect(r.fieis.map((f) => [f.conversaId, f.visitas])).toEqual([['bia', 2], ['ana', 2]]);
    expect(r.sumidas.total).toBe(1);
    expect(r.sumidas.lista[0]).toMatchObject({ conversaId: 'cris', diasSem: 111, ultimoServico: 'Selagem' });
  });
});

// ---------------------------------------------------------------- rotas e banco

async function cenario(repo: Repositorio = new RepositorioMemoria()) {
  const nova = async (empresaId: string, tel: string, nome: string, dona: string | null, unidade: 'norte' | 'sumare' = 'norte', criada = h(18, 9)) => {
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId, unidade, canalId: 'x', telefone: tel, nome, agora: criada });
    if (dona) await repo.salvarConversa({ ...conversa, responsavelId: dona, responsavelNome: dona === ANA ? 'Ana' : 'Bia' });
    await repo.registrarEvento({ tipo: 'conversa_nova', conversaId: conversa.id, unidade, em: criada });
    return conversa.id;
  };
  const c1 = await nova(EMP, '5571900000001', 'Carla', ANA);
  await repo.adicionarMensagem({ conversaId: c1, autor: 'cliente', texto: 'oi', em: h(18, 9) });
  await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c1, unidade: 'norte', em: h(18, 10), dados: { de: 'novo_lead', para: 'em_conversa' } });
  await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: c1, unidade: 'norte', em: h(18, 11), dados: { atendente: 'Ana', atendenteId: ANA, servico: 'Progressiva', valor: 250 } });
  await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c1, unidade: 'norte', em: h(18, 11), dados: { de: 'em_conversa', para: 'agendada' } });
  const c2 = await nova(EMP, '5571900000002', 'Duda', BIA, 'sumare');
  await repo.adicionarMensagem({ conversaId: c2, autor: 'cliente', texto: 'oi', em: h(18, 9, 30) });
  await repo.registrarEvento({ tipo: 'agendamento_ia', conversaId: c2, unidade: 'sumare', em: h(19, 15), dados: { servico: 'Selagem' } });
  await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c2, unidade: 'sumare', em: h(19, 16), dados: { de: 'novo_lead', para: 'perdida', motivo: 'faltou' } });
  // Outra empresa: nada disso pode aparecer para a empresa A.
  const x = await nova(OUTRA, '5571900000009', 'Zezé', null);
  await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: x, unidade: 'norte', em: h(18, 12), dados: { atendente: 'Zé', atendenteId: 'ze', servico: 'Progressiva', valor: 9999 } });
  await repo.adicionarMensagem({ conversaId: x, autor: 'cliente', texto: 'oi', em: h(18, 12) });
  for (const [id, etapa] of [[c1, 'agendada'], [c2, 'perdida']] as const) await repo.salvarConversa({ ...(await repo.buscarConversa(id))!, etapa });
  return { repo, c1, c2 };
}

const usuario = (empresaId: string, p: Partial<Usuario> = {}): Usuario => ({ id: 'u-' + empresaId, empresaId, nome: 'Gestora', email: 'g@x', papel: 'admin', unidades: ['norte', 'sumare'], ativo: true, ...p });

async function montar(repo: Repositorio, u?: Usuario, fonte: FonteAnalises = new FonteAnalisesMemoria(repo), comercial: FonteComercial = new FonteComercialMemoria(repo)) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    if (u) (req as { usuario?: Usuario }).usuario = u;
  });
  const armazem = new ArmazemComercialMemoria();
  await armazem.salvar(EMP, ConfigComercial.parse({ precos }), 'teste');
  registrarAnalises(app, { fonte, comercial, armazemComercial: armazem, origens: new OrigensConversa({ repo }), empresaId: EMP, agora: () => h(20, 12) });
  return app;
}

describe('análises: rotas', () => {
  it('cada análise respeita a empresa de quem pede, a unidade e o atendente; CSV sai igual à tela', async () => {
    const { repo } = await cenario();
    const app = await montar(repo, usuario(EMP));
    const v = (await app.inject({ url: '/api/analises/vendas?periodo=7d' })).json();
    expect(v.totais).toMatchObject({ vendas: 2, receita: 400 }); // 250 + Selagem pela tabela (150); a outra empresa (9999) fica fora
    expect(v.opcoes.unidades.length).toBeGreaterThan(0);
    const soNorte = (await app.inject({ url: '/api/analises/vendas?periodo=7d&unidade=norte' })).json();
    expect(soNorte.totais.vendas).toBe(1);
    const daAna = (await app.inject({ url: `/api/analises/vendas?periodo=7d&atendente=${ANA}` })).json();
    expect(daAna.totais).toMatchObject({ vendas: 1, receita: 250 });

    const ho = (await app.inject({ url: '/api/analises/horarios?periodo=7d' })).json();
    expect(ho.leads.total).toBe(2);
    expect(ho.mensagens.total).toBe(2);
    expect(ho.agendamentos.total).toBe(2);

    const fu = (await app.inject({ url: '/api/analises/funil?periodo=7d' })).json();
    expect(fu.perdas.motivos).toEqual([{ nome: 'Faltou ao horário', total: 1, pct: 100 }]);
    expect(fu.paradas.map((p: { cliente: string }) => p.cliente)).toEqual(['Carla']);

    const cl = (await app.inject({ url: '/api/analises/clientes?periodo=7d' })).json();
    expect(cl).toMatchObject({ clientes: 2, novas: 2, voltaram: 0 });

    const csv = await app.inject({ url: '/api/analises/vendas/csv?periodo=7d&tabela=servicos' });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Progressiva;1;250;250');
    expect(csv.body).not.toContain('9999');
    expect((await app.inject({ url: '/api/analises/vendas/csv?tabela=nada' })).statusCode).toBe(400);
    expect((await app.inject({ url: '/api/analises/nada' })).statusCode).not.toBe(200);

    // Pela empresa B, só os números dela.
    const b = await montar(repo, usuario(OUTRA));
    expect((await b.inject({ url: '/api/analises/vendas?periodo=7d' })).json().totais).toMatchObject({ vendas: 1, receita: 9999 });
  });

  it('só a gestão vê; exportar pede permissão de exportar; unidade fora do alcance é recusada', async () => {
    const { repo } = await cenario();
    const atendente = await montar(repo, usuario(EMP, { papel: 'atendente', unidades: ['norte'] }));
    expect((await atendente.inject({ url: '/api/analises/vendas' })).statusCode).toBe(403);
    const gerente = await montar(repo, usuario(EMP, { papel: 'gerente', unidades: ['norte'] }));
    const r = await gerente.inject({ url: '/api/analises/vendas?periodo=7d&unidade=sumare' });
    expect(r.statusCode).toBe(403);
    const ok = (await gerente.inject({ url: '/api/analises/vendas?periodo=7d' })).json();
    expect(ok.totais.vendas).toBe(1); // só a unidade dele
  });
});

describe.skipIf(!temPostgres)('análises: Postgres dá o mesmo que a memória', () => {
  it('mesmos números nas quatro análises', async () => {
    const pool = await poolDeTeste();
    const repoPg = new RepositorioPostgres(pool);
    await cenario(repoPg);
    const pgApp = await montar(repoPg, usuario(EMP), new FonteAnalisesPostgres(pool), new FonteComercialPostgres(pool));
    const { repo } = await cenario();
    const memApp = await montar(repo, usuario(EMP));
    const sem = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'conversaId' || k === 'opcoes' ? undefined : v)));
    for (const t of ['vendas', 'horarios', 'funil', 'clientes']) {
      const a = (await pgApp.inject({ url: `/api/analises/${t}?periodo=7d` })).json();
      const b = (await memApp.inject({ url: `/api/analises/${t}?periodo=7d` })).json();
      expect(sem(a), t).toEqual(sem(b));
    }
  });
});
