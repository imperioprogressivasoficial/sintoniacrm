import { describe, expect, it } from 'vitest';
import { AgendaExterna, horaDoSistema, mesclarAgenda, paraItemExterno, type ItemExterno } from '../src/agenda/agenda-externa.js';
import type { ItemAgenda } from '../src/agenda/agenda-dia.js';
import { AgendaAppBarber } from '../src/agenda/appbarber.js';
import { AgendaAvec } from '../src/agenda/avec.js';
import { ErroIntegracaoPendente } from '../src/agenda/sistema.js';
import { ClienteTrinks } from '../src/agenda/trinks.js';
import { bahia } from '../src/util/tempo.js';

/** fetch falso no mesmo jeito de test/agendas.test.ts: responde por "MÉTODO /caminho" e guarda as chamadas. */
function fetchFalso(rotas: Record<string, (url: URL) => { status?: number; corpo: unknown }>) {
  const chamadas: URL[] = [];
  const fn = (async (entrada: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(entrada));
    chamadas.push(url);
    const chave = `${init.method ?? 'GET'} ${url.pathname}`;
    const rota = Object.entries(rotas).find(([k]) => chave.startsWith(k));
    if (!rota) return new Response('não encontrado', { status: 404 });
    const r = rota[1](url);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, chamadas };
}

const semEspera = { agora: () => 1_000_000, dormir: async () => {} };
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

/** Como o Trinks devolve GET /v1/agendamentos (paginado, com cliente, serviço, profissional e status). */
const pagina = (page: number, totalPages: number, data: unknown[]) => ({ corpo: { page, totalPages, data } });
const agTrinks = (id: number, hora: string, extra: Record<string, unknown> = {}) => ({
  id,
  cliente: { id: 100 + id, nome: `Cliente ${id}`, telefones: [{ ddi: '55', ddd: '71', telefone: `98812${String(id).padStart(4, '0')}` }] },
  servico: { id: 1, nome: 'Progressiva' },
  profissional: { id: 7, nome: 'Jéssica Santos' },
  dataHoraInicio: `2026-11-05T${hora}:00`,
  duracaoEmMinutos: 90,
  valor: 290,
  status: { id: 1, nome: 'Agendado' },
  ...extra,
});

describe('Trinks: agenda inteira do estabelecimento', () => {
  it('GET /v1/agendamentos com dataInicio/dataFim, sem clienteId, todas as páginas, cancelado marcado', async () => {
    const f = fetchFalso({
      'GET /v1/agendamentos': (url) =>
        url.searchParams.get('page') === '1' ? pagina(1, 2, [agTrinks(1, '09:00'), agTrinks(2, '10:30')]) : pagina(2, 2, [agTrinks(3, '14:00', { status: { id: 9, nome: 'Cancelado' } })]),
    });
    const t = new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, ...semEspera });
    const lista = await t.listarAgendamentosDoPeriodo('240643', '2026-11-05', '2026-11-18');
    expect(lista.map((a) => [a.id, a.cancelado])).toEqual([[1, false], [2, false], [3, true]]);
    expect(f.chamadas).toHaveLength(2);
    const q = f.chamadas[0]!.searchParams;
    expect([q.get('dataInicio'), q.get('dataFim'), q.get('clienteId'), q.get('pageSize')]).toEqual(['2026-11-05', '2026-11-18', null, '50']);
  });

  it('converte para o item da tela: hora do salão, celular da cliente e apelido da profissional', () => {
    const i = paraItemExterno(agTrinks(4, '19:00') as never, 'trinks', 'norte', new Map([[7, 'Jéssica']]))!;
    expect(i).toMatchObject({ fonte: 'trinks', sistemaId: 4, cliente: 'Cliente 4', clienteId: 104, telefone: '5571988120004', profissional: 'Jéssica', servico: 'Progressiva', duracaoMin: 90 });
    expect(i.inicio.getTime()).toBe(quinta(19).getTime());
    // sem telefone, sem profissional e sem horário
    expect(paraItemExterno({ id: 5, dataHoraInicio: '2026-11-05T08:00:00', duracaoEmMinutos: 0, valor: 0, cliente: { id: 1, nome: ' ' } }, 'trinks', 'norte')).toMatchObject({ telefone: null, cliente: null, profissional: null, duracaoMin: 60 });
    expect(paraItemExterno({ id: 6, dataHoraInicio: '', duracaoEmMinutos: 30, valor: 0 }, 'trinks', 'norte')).toBeNull();
    expect(horaDoSistema('2026-11-05T19:00:00Z')!.toISOString()).toBe('2026-11-05T19:00:00.000Z');
  });

  it('Avec e AppBarber não listam a agenda do salão (sem documentação) e não chamam a rede', async () => {
    const f = fetchFalso({});
    await expect(new AgendaAvec({ token: 't', baseUrl: 'https://x.test', fetchFn: f.fn }).listarAgendamentosDoPeriodo()).rejects.toBeInstanceOf(ErroIntegracaoPendente);
    await expect(new AgendaAppBarber({ token: 't', fetchFn: f.fn }).listarAgendamentosDoPeriodo()).rejects.toBeInstanceOf(ErroIntegracaoPendente);
    expect(f.chamadas).toHaveLength(0);
  });
});

describe('AgendaExterna: cache e falhas', () => {
  function montar(listar: () => Promise<unknown[]>, o: { esperaMs?: number; tipo?: 'trinks' | 'avec' } = {}) {
    let t = 0;
    let chamadas = 0;
    const roteador = {
      paraUnidade: (u: string) => {
        if (u === 'sumare') throw new Error('sem agenda');
        return {
          tipo: o.tipo ?? ('trinks' as const),
          local: '240643',
          sistema: {
            listarAgendamentosDoPeriodo: async () => (chamadas++, listar()),
            listarProfissionais: async () => [],
          } as never,
        };
      },
    };
    const ext = new AgendaExterna({ roteador, agora: () => t, esperaMs: o.esperaMs ?? 1000 });
    return { ext, chamadas: () => chamadas, passar: (ms: number) => (t += ms) };
  }

  it('guarda 60 s por unidade e período: as conferidas de 20 s não chamam o sistema de novo', async () => {
    const m = montar(async () => [agTrinks(1, '09:00')]);
    expect((await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18')).itens).toHaveLength(1);
    m.passar(20_000);
    await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18');
    m.passar(20_000);
    await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18');
    expect(m.chamadas()).toBe(1);
    await m.ext.daUnidade('norte', '2026-11-19', '2026-12-02'); // outro período: outra chamada
    expect(m.chamadas()).toBe(2);
    m.passar(21_000); // passou 1 minuto do primeiro
    await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18');
    expect(m.chamadas()).toBe(3);
  });

  it('pedidos ao mesmo tempo (várias pessoas com a agenda aberta) viram uma chamada só', async () => {
    const m = montar(async () => [agTrinks(1, '09:00')]);
    await Promise.all([1, 2, 3].map(() => m.ext.daUnidade('norte', '2026-11-05', '2026-11-18')));
    expect(m.chamadas()).toBe(1);
  });

  it('falha vira aviso (e também fica guardada 1 minuto); unidade sem sistema não dá aviso', async () => {
    const m = montar(async () => {
      throw new Error('Trinks GET /v1/agendamentos → 500');
    });
    const r = await m.ext.dasUnidades(['norte', 'sumare'], '2026-11-05', '2026-11-18');
    expect(r.itens).toEqual([]);
    expect(r.aviso).toBe('O Trinks não respondeu agora. Mostrando só o que foi marcado pela Sintonia.');
    await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18');
    expect(m.chamadas()).toBe(1);
  });

  it('se o sistema demora, a tela segue com aviso e o resultado fica no cache quando chega', async () => {
    let soltar!: (v: unknown[]) => void;
    const m = montar(() => new Promise((r) => (soltar = r)), { esperaMs: 10 });
    const r = await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18');
    expect(r).toEqual({ itens: [], aviso: 'O Trinks está demorando para responder. Mostrando só o que foi marcado pela Sintonia.' });
    soltar([agTrinks(1, '09:00')]);
    await new Promise((r) => setTimeout(r, 0));
    expect((await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18')).itens).toHaveLength(1);
    expect(m.chamadas()).toBe(1);
  });

  it('sistema ainda sem listagem (Avec) dá um aviso claro', async () => {
    const m = montar(async () => {
      throw new ErroIntegracaoPendente('avec', 'agenda do salão');
    }, { tipo: 'avec' });
    expect((await m.ext.daUnidade('norte', '2026-11-05', '2026-11-18')).aviso).toBe('A agenda da Avec ainda não mostra aqui o que é marcado direto lá.');
  });
});

describe('mesclarAgenda', () => {
  const daSintonia = (trinksId: number | null, h: number, conversaId = 'c1'): ItemAgenda => ({
    id: trinksId ? `t${trinksId}` : `${conversaId}-${h}`,
    trinksId,
    conversaId,
    cliente: 'Joana',
    telefone: '5571988120001',
    unidade: 'norte',
    servico: 'Progressiva',
    profissional: 'Jéssica',
    inicio: quinta(h),
    duracaoMin: 60,
    por: 'IA',
    porIa: true,
    marcadoEm: quinta(8),
  });
  const doSistema = (sistemaId: number, h: number, extra: Partial<ItemExterno> = {}): ItemExterno => ({
    fonte: 'trinks',
    sistemaId,
    unidade: 'norte',
    cliente: `Cliente ${sistemaId}`,
    clienteId: 100 + sistemaId,
    telefone: null,
    servico: 'Corte',
    profissional: 'Jéssica',
    inicio: quinta(h),
    duracaoMin: 30,
    cancelado: false,
    ...extra,
  });

  it('o mesmo agendamento aparece uma vez, como da Sintonia; outra unidade com o mesmo id não conta', () => {
    const r = mesclarAgenda([daSintonia(77, 10)], [doSistema(77, 10), doSistema(77, 11, { unidade: 'sumare' })], () => undefined, () => true);
    expect(r.map((i) => [i.id, i.fonte, i.unidade])).toEqual([
      ['t77', 'sintonia', 'norte'],
      ['t77', 'trinks', 'sumare'],
    ]);
    expect(r[0]).toMatchObject({ podeAbrir: true, conversaId: 'c1', porIa: true });
    expect(r[0]!.fim.getTime()).toBe(quinta(11).getTime());
  });

  it('cancelado no sistema sai da agenda, inclusive o que a Sintonia marcou', () => {
    const r = mesclarAgenda([daSintonia(77, 10), daSintonia(null, 12)], [doSistema(77, 10, { cancelado: true }), doSistema(78, 9, { cancelado: true })], () => undefined, () => true);
    expect(r.map((i) => i.id)).toEqual(['c1-12']);
  });

  it('só do sistema: com conversa abre (se a pessoa pode ver); sem conversa, nome do sistema e não abre', () => {
    const conversa = { id: 'c9', telefone: '5571988129999', unidade: 'norte' as const, atualizadaEm: quinta(8), nome: 'Marta (WhatsApp)' };
    const r = mesclarAgenda([], [doSistema(1, 9), doSistema(2, 10)], (e) => (e.sistemaId === 1 ? conversa : undefined), (id) => id === 'c9');
    expect(r[0]).toMatchObject({ id: 't1', conversaId: 'c9', telefone: '5571988129999', cliente: 'Cliente 1', fonte: 'trinks', por: 'Trinks', podeAbrir: true, marcadoEm: null });
    expect(r[1]).toMatchObject({ id: 't2', conversaId: null, telefone: '', podeAbrir: false });
    const semPermissao = mesclarAgenda([], [doSistema(1, 9)], () => conversa, () => false);
    expect(semPermissao[0]).toMatchObject({ conversaId: 'c9', podeAbrir: false });
  });
});
