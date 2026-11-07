import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { Contas, Usuario } from '../src/auth/contas.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemComercialMemoria } from '../src/comercial/armazem.js';
import {
  calcularComissao,
  comissaoCsv,
  ConfigComercial,
  janelaRanking,
  metaDaEquipe,
  montarRanking,
  primeiroNome,
  progresso,
  servicosMaisAgendados,
  valorDe,
  type Venda,
} from '../src/comercial/calculo.js';
import { FonteComercialMemoria, type FonteComercial } from '../src/comercial/fonte.js';
import { registrarComercial } from '../src/comercial/rotas.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';

const dia = (d: number, h = 10) => bahia(2026, 11, d, h);
let n = 0;
const venda = (v: Partial<Venda>): Venda => ({
  conversaId: `c${++n}`,
  unidade: 'norte',
  servico: 'Progressiva',
  atendenteId: 'ana',
  atendenteNome: 'Ana Souza',
  responsavelId: null,
  porIa: false,
  em: dia(3),
  valor: null,
  compareceu: true,
  primeiroNome: 'Maria',
  ...v,
});
const cfg = (c: unknown = {}) => ConfigComercial.parse(c);
const pessoas = [
  { id: 'ana', nome: 'Ana Souza', unidades: ['norte'] },
  { id: 'bia', nome: 'Bia Lima', unidades: ['sumare'] },
];

describe('comissão', () => {
  const precos = [{ servico: 'Progressiva', valor: 200 }, { servico: 'Selagem', valor: 150 }];

  it('percentual sobre o valor, só de quem COMPARECEU', () => {
    const c = cfg({ comissao: { ligada: true, regras: [{ tipo: 'percentual', valor: 10 }] }, precos });
    const r = calcularComissao([venda({}), venda({ compareceu: false }), venda({ servico: 'selagem' })], c, pessoas);
    const ana = r.find((x) => x.id === 'ana')!;
    expect(ana.agendamentos).toBe(3);
    expect(ana.compareceram).toBe(2);
    expect(ana.vendido).toBe(350);
    expect(ana.comissao).toBe(35);
    expect(r.find((x) => x.id === 'bia')!.comissao).toBe(0);
  });

  it('valor fixo por serviço vence a regra geral; valor gravado no agendamento vence a tabela', () => {
    const c = cfg({ comissao: { regras: [{ tipo: 'percentual', valor: 5 }, { servico: 'PROGRESSIVA', tipo: 'fixo', valor: 25 }] }, precos });
    expect(valorDe({ valor: 330, servico: 'Progressiva' }, c.precos)).toBe(330);
    expect(valorDe({ valor: null, servico: 'Hidratação' }, c.precos)).toBe(0);
    const r = calcularComissao([venda({ valor: 330 }), venda({ servico: 'Selagem' })], c, pessoas);
    expect(r[0]!.comissao).toBe(25 + 7.5);
  });

  it('IA agendou: só conta para a dona da conversa se a gestão desmarcar "só quem agendou"', () => {
    const v = venda({ porIa: true, atendenteId: null, atendenteNome: null, responsavelId: 'bia' });
    const regras = [{ tipo: 'fixo', valor: 10 }];
    expect(calcularComissao([v], cfg({ comissao: { regras, soQuemAgendou: true } }), pessoas).find((x) => x.id === 'bia')!.comissao).toBe(0);
    expect(calcularComissao([v], cfg({ comissao: { regras, soQuemAgendou: false } }), pessoas).find((x) => x.id === 'bia')!.comissao).toBe(10);
  });

  it('CSV em português com total por atendente', () => {
    const csv = comissaoCsv(calcularComissao([venda({ em: dia(5) })], cfg({ comissao: { regras: [{ tipo: 'percentual', valor: 10 }] }, precos }), pessoas));
    expect(csv).toContain('Ana Souza;05/11/2026;norte;Progressiva;200,00;10%;20,00');
    expect(csv).toContain('TOTAL Ana Souza');
  });
});

describe('metas', () => {
  it('progresso de agendamentos e de valor; equipe = soma das individuais quando não há meta própria', () => {
    const c = cfg({ metas: { atendentes: { ana: { agendamentos: 10 }, bia: { agendamentos: 5, valor: 1000 } } }, precos: [{ servico: 'Progressiva', valor: 200 }] });
    expect(metaDaEquipe(c)).toEqual({ agendamentos: 15, valor: 1000 });
    const p = progresso([venda({}), venda({ compareceu: false })], c.metas.atendentes.ana, c);
    expect(p).toMatchObject({ agendamentos: 2, valor: 200, pctAgendamentos: 20, pctValor: null });
    expect(metaDaEquipe(cfg({ metas: { equipe: { agendamentos: 50 } } }))).toEqual({ agendamentos: 50 });
  });

  it('serviços mais agendados por quantidade e unidade', () => {
    const s = servicosMaisAgendados([venda({}), venda({ unidade: 'sumare' }), venda({ servico: 'Selagem' })], cfg());
    expect(s[0]).toMatchObject({ servico: 'Progressiva', agendamentos: 2, porUnidade: { norte: 1, sumare: 1 } });
    expect(s[1]!.servico).toBe('Selagem');
  });
});

describe('ranking', () => {
  it('ordena, dá medalhas, mostra quem subiu/desceu e a meta do período', () => {
    const c = cfg({ metas: { atendentes: { bia: { agendamentos: 30 } } } });
    const atual = { vendas: [venda({ atendenteId: 'bia', atendenteNome: 'Bia' }), venda({ atendenteId: 'bia' }), venda({})], atendimento: [{ id: 'ana', nome: 'Ana', conversas: 4, primeiraMs: 60_000, primeiraN: 2 }] };
    const anterior = { vendas: [venda({}), venda({})], atendimento: [] };
    const r = montarRanking({ atual, anterior, pessoas, cfg: c, criterio: 'agendamentos', fatorMeta: 0.5 });
    expect(r.map((x) => [x.id, x.posicao, x.medalha, x.variacao])).toEqual([
      ['bia', 1, 'ouro', null],
      ['ana', 2, 'prata', -1],
    ]);
    expect(r[0]!.meta).toEqual({ agendamentos: 15, valor: null, progressoPct: 13.3 });
    expect(r[1]).toMatchObject({ conversao: 25, tempoSeg: 30 });
    const porTempo = montarRanking({ atual, anterior, pessoas, cfg: c, criterio: 'tempo' });
    expect(porTempo[0]!.id).toBe('ana');
  });

  it('janelas: semana começa na segunda e o período anterior tem o mesmo tempo corrido', () => {
    const agora = bahia(2026, 11, 7, 15); // sábado
    const s = janelaRanking('semana', agora);
    expect(s.inicio).toEqual(bahia(2026, 11, 2));
    expect(s.fimAnterior).toEqual(bahia(2026, 10, 31, 15));
    const m = janelaRanking('mes', bahia(2026, 1, 10));
    expect(m.inicioAnterior).toEqual(bahia(2025, 12, 1));
  });

  it('a fonte em memória marca compareceu pelo evento de etapa depois do agendamento', async () => {
    const repo = new RepositorioMemoria();
    const c: Conversa = { id: 'conv-1', empresaId: 'emp', unidade: 'norte', canalId: 'teste', telefone: '5571999990000', nome: 'Joana Silva Santos', modo: 'ia', etapa: 'agendada', etiquetas: [], criadaEm: dia(1), atualizadaEm: dia(1) };
    await repo.salvarConversa(c);
    await repo.registrarEvento({ tipo: 'agendamento_equipe', conversaId: c.id, unidade: 'norte', em: dia(3), dados: { atendenteId: 'ana', atendente: 'Ana', servico: 'Selagem', valor: 180 } });
    await repo.registrarEvento({ tipo: 'etapa_mudou', conversaId: c.id, unidade: 'norte', em: dia(6), dados: { de: 'agendada', para: 'compareceu' } });
    const d = await new FonteComercialMemoria(repo).carregar(dia(1), dia(5), {});
    expect(d.vendas).toHaveLength(1);
    expect(d.vendas[0]).toMatchObject({ compareceu: true, valor: 180, primeiroNome: 'Joana', atendenteId: 'ana' });
  });
});

describe('Painel na TV (token)', () => {
  const usuarios: Usuario[] = [
    { id: 'ana', empresaId: 'emp', nome: 'Ana Souza', email: 'a@x', papel: 'atendente', unidades: ['norte'], ativo: true },
    { id: 'gi', empresaId: 'emp', nome: 'Gi Gerente', email: 'g@x', papel: 'gerente', unidades: ['norte', 'sumare'], ativo: true },
  ];
  const contas = {
    listarUsuarios: async () => usuarios,
    buscarPorId: async (id: string) => usuarios.find((u) => u.id === id),
    fotoDe: async () => undefined,
    fotosDaEmpresa: async () => new Map(),
  } as unknown as Contas;
  const fonte: FonteComercial = {
    carregar: async () => ({
      vendas: [venda({ em: new Date(Date.now() - 60_000), primeiroNome: 'Maria' })],
      atendimento: [],
    }),
  };

  async function montar(usuario?: Usuario) {
    const app = Fastify();
    const armazem = new ArmazemComercialMemoria();
    app.addHook('onRequest', async (req) => {
      if (usuario) (req as { usuario?: Usuario }).usuario = usuario;
    });
    registrarComercial(app, { armazem, fonte, contas, empresaId: 'emp', agora: () => new Date(), unidades: ['norte', 'sumare'] });
    await app.ready();
    return { app, armazem };
  }

  it('gera, serve sem login e sem dados pessoais, e para de valer ao revogar', async () => {
    const { app } = await montar(usuarios[1]);
    const g = await app.inject({ method: 'POST', url: '/api/comercial/tv' });
    expect(g.statusCode).toBe(200);
    const { caminho, token } = g.json() as { caminho: string; token: string };
    expect(token.length).toBeGreaterThanOrEqual(40);
    const d = await app.inject({ url: `${caminho}/dados` });
    expect(d.statusCode).toBe(200);
    expect(d.headers['cache-control']).toBe('no-store');
    const corpo = d.body;
    expect(corpo).not.toContain('5571');
    expect(corpo).not.toContain('conversaId');
    expect(corpo).not.toContain('c1');
    expect(d.json().ultimos[0]).toMatchObject({ cliente: 'Maria', servico: 'Progressiva', por: 'Ana' });
    expect(d.json().ranking[0]).toMatchObject({ nome: 'Ana', posicao: 1 });

    // sem nome da cliente se a gestão desligar
    await app.inject({ method: 'PUT', url: '/api/comercial/config', payload: { tv: { ultimosNomes: false } } });
    expect((await app.inject({ url: `${caminho}/dados` })).json().ultimos[0].cliente).toBeNull();

    await app.inject({ method: 'DELETE', url: '/api/comercial/tv' });
    expect((await app.inject({ url: `${caminho}/dados` })).statusCode).toBe(404);
    expect((await app.inject({ url: '/tv/curto/dados' })).statusCode).toBe(404);
    expect((await app.inject({ url: `/tv/${'A'.repeat(43)}/dados` })).statusCode).toBe(404);
  });

  it('só a gestão gera o link e muda metas; a atendente vê só a comissão dela', async () => {
    const { app } = await montar(usuarios[0]);
    expect((await app.inject({ method: 'POST', url: '/api/comercial/tv' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/comercial/config', payload: { metas: {} } })).statusCode).toBe(403);
    const c = (await app.inject({ url: '/api/comercial/comissao' })).json() as { atendentes: { id: string }[] };
    expect(c.atendentes.map((a) => a.id)).toEqual(['ana']);
    const r = await app.inject({ url: '/api/comercial/resumo?periodo=dia' });
    expect(r.statusCode).toBe(200);
    expect(r.json().minha).toMatchObject({ agendamentos: 1 });
  });

  it('primeiro nome nunca leva sobrenome nem número', () => {
    expect(primeiroNome('maria DA silva')).toBe('Maria');
    expect(primeiroNome('5571999')).toBeNull();
  });
});
