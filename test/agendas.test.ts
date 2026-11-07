import { describe, expect, it } from 'vitest';
import { agendar, agendaDaUnidade, horariosLivres } from '../src/agenda/agendar.js';
import { AgendaAppBarber } from '../src/agenda/appbarber.js';
import { AgendaAvec, dataAvec } from '../src/agenda/avec.js';
import { ErroAgenda, ErroIntegracaoPendente, type SistemaAgenda } from '../src/agenda/sistema.js';
import { ClienteTrinks, ErroTrinks } from '../src/agenda/trinks.js';
import { AgendasDasUnidades, configAgendaDa } from '../src/agenda/unidades-agenda.js';
import { executarFerramenta } from '../src/ai/ferramentas.js';
import { ArmazemMemoria, Conexoes } from '../src/conexoes/conexoes.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { criarServidor } from '../src/server.js';
import type { Conversa } from '../src/domain.js';
import { bahia } from '../src/util/tempo.js';

/** fetch falso: responde por "MÉTODO /caminho" (prefixo) e guarda as chamadas. */
function fetchFalso(rotas: Record<string, (url: URL, init: RequestInit) => { status?: number; corpo: unknown }>) {
  const chamadas: Array<{ url: URL; init: RequestInit }> = [];
  const fn = (async (entrada: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(entrada));
    chamadas.push({ url, init });
    const chave = `${init.method ?? 'GET'} ${url.pathname}`;
    const rota = Object.entries(rotas).find(([k]) => chave.startsWith(k));
    if (!rota) return new Response('não encontrado', { status: 404 });
    const r = rota[1](url, init);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, chamadas };
}

const semEspera = { agora: () => 1_000_000, dormir: async () => {} };
const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);
const conversa = { id: 'c1', telefone: '5571988124471', unidade: 'norte', trinksClienteId: 55 } as unknown as Conversa;

function trinksFalso() {
  return fetchFalso({
    'GET /v1/servicos': () => ({ corpo: { page: 1, totalPages: 1, data: [{ id: 1, nome: 'Progressiva', duracaoEmMinutos: 180, preco: 320, valorPromocional: 290 }] } }),
    'GET /v1/profissionais': () => ({ corpo: { page: 1, totalPages: 1, data: [{ id: 7, nome: 'Jéssica Santos', apelido: 'Jéssica' }] } }),
    'GET /v1/agendamentos/profissionais/': () => ({ corpo: { page: 1, totalPages: 1, data: [{ id: 7, nome: 'Jéssica', horariosVagos: ['14:00', '16:30'] }] } }),
    'POST /v1/agendamentos': () => ({ corpo: { id: 999 } }),
    'PATCH /v1/agendamentos/999/status/cancelado': () => ({ corpo: {} }),
    'GET /v1/agendamentos': () => ({ corpo: { page: 1, totalPages: 1, data: [{ id: 3, status: { id: 9, nome: 'Cancelado' }, dataHoraInicio: '2026-11-10T10:00:00', duracaoEmMinutos: 60, valor: 1 }] } }),
  });
}

/** Conexões em memória, com o que a tela teria salvo. */
async function conexoesCom(valores: Record<string, string>) {
  const c = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await c.carregar();
  await c.salvar(valores, 'teste');
  return c;
}

describe('interface SistemaAgenda', () => {
  it('o Trinks implementa a interface inteira, inclusive cancelar e testar', async () => {
    const f = trinksFalso();
    const t: SistemaAgenda = new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, ...semEspera });
    expect(t.sistema).toBe('trinks');
    expect(await t.testar('240643')).toBe('1 profissionais');
    await t.cancelarAgendamento('240643', 999);
    const patch = f.chamadas.find((c) => c.init.method === 'PATCH')!;
    expect(patch.url.pathname).toBe('/v1/agendamentos/999/status/cancelado');
    expect((patch.init.headers as Record<string, string>).estabelecimentoId).toBe('240643');
    const lista = await t.listarAgendamentosDoCliente('240643', 55);
    expect(lista[0]!.cancelado).toBe(true);
  });

  it('o erro do Trinks continua sendo ErroTrinks e também ErroAgenda (409 = horário ocupado)', () => {
    const e = new ErroTrinks(409, 'x');
    expect(e).toBeInstanceOf(ErroAgenda);
    expect(e.status).toBe(409);
  });

  it('Avec: lê relatório com o header Authorization, paginação e datas dd/mm/aaaa', async () => {
    const f = fetchFalso({ 'GET /reports/0001': () => ({ corpo: { data: [{ nome: 'Ana' }] } }) });
    const a = new AgendaAvec({ token: 'tok-avec', baseUrl: 'https://api.exemplo-avec.test', fetchFn: f.fn, ...semEspera });
    expect(await a.relatorio('0001', { inicio: dataAvec('2026-11-05'), fim: dataAvec('2026-11-05') })).toEqual([{ nome: 'Ana' }]);
    const c = f.chamadas[0]!;
    expect((c.init.headers as Record<string, string>).Authorization).toBe('tok-avec');
    expect(c.url.searchParams.get('page')).toBe('1');
    expect(c.url.searchParams.get('limit')).toBe('250');
    expect(c.url.searchParams.get('inicio')).toBe('05/11/2026');
    // cache: a mesma consulta não gasta outra chamada
    await a.relatorio('0001', { inicio: '05/11/2026', fim: '05/11/2026' });
    expect(f.chamadas).toHaveLength(1);
    expect(await a.testar()).toMatch(/Avec respondendo/);
  });

  it('Avec: tenta de novo no 429, como o Trinks', async () => {
    let n = 0;
    const f = fetchFalso({ 'GET /reports/0001': () => (++n < 3 ? { status: 429, corpo: {} } : { corpo: [] }) });
    const a = new AgendaAvec({ token: 't', baseUrl: 'https://api.exemplo-avec.test', fetchFn: f.fn, ...semEspera });
    await expect(a.relatorio('0001')).resolves.toEqual([]);
    expect(n).toBe(3);
  });

  it('Avec e AppBarber: o que não está documentado responde com erro claro, sem chamar a rede', async () => {
    const f = fetchFalso({});
    const avec = new AgendaAvec({ token: 't', baseUrl: 'https://api.exemplo-avec.test', fetchFn: f.fn, ...semEspera });
    const app = new AgendaAppBarber({ token: 't', fetchFn: f.fn, ...semEspera });
    await expect(avec.listarServicos()).rejects.toBeInstanceOf(ErroIntegracaoPendente);
    await expect(avec.criarAgendamento('x', {} as never)).rejects.toThrow('Integração aguardando credenciais/documentação da Avec');
    await expect(app.horariosVagos()).rejects.toThrow('Integração aguardando credenciais/documentação da AppBarber');
    await expect(app.testar()).rejects.toBeInstanceOf(ErroIntegracaoPendente);
    await expect(new AgendaAvec({ token: 't', fetchFn: f.fn }).testar()).rejects.toThrow(/URL base/);
    expect(f.chamadas).toHaveLength(0);
  });
});

describe('escolha do sistema por unidade', () => {
  it('sem escolha salva, a unidade continua no Trinks', async () => {
    const c = await conexoesCom({ trinksApiKey: 'k' });
    const cfg = configAgendaDa((k) => c.get(k as never), 'norte');
    expect(cfg).toMatchObject({ escolha: 'trinks', sistemaNome: 'Trinks', local: '240643', conectada: true, pronta: true, falta: [] });
  });

  it('cada unidade no seu sistema; o que falta aparece com o nome do sistema', async () => {
    const c = await conexoesCom({ trinksApiKey: 'k', agendaSistemaSumare: 'avec', agendaSistemaNorte: 'appbarber' });
    const r = new AgendasDasUnidades({ ler: (k) => c.get(k as never), trinks: new ClienteTrinks({ apiKey: 'k' }) });
    const [norte, sumare] = r.configs();
    expect(norte).toMatchObject({ escolha: 'appbarber', conectada: false, falta: ['Token do AppBarber (Salvador Norte Shopping)', 'ID da loja no AppBarber (Salvador Norte Shopping)'] });
    expect(sumare).toMatchObject({ escolha: 'avec', falta: ['Token da API da Avec (Shopping Sumaré)', 'URL base da API da Avec'] });
    expect(() => r.paraUnidade('sumare')).toThrow(/agenda \(Avec\) de Shopping Sumaré ainda não está conectada/);
    expect(r.algumaPronta()).toBe(false);

    await c.salvar({ avecTokenSumare: 'tok', avecUrl: 'https://api.exemplo-avec.test', agendaSistemaNorte: 'trinks' }, 'teste');
    expect(r.config('sumare')).toMatchObject({ conectada: true, pronta: false });
    expect(r.config('sumare').aviso).toMatch(/aguardando credenciais\/documentação da Avec/);
    expect(r.paraUnidade('sumare').tipo).toBe('avec');
    expect(r.paraUnidade('sumare').sistema).toBeInstanceOf(AgendaAvec);
    expect(r.paraUnidade('norte').sistema).toBeInstanceOf(ClienteTrinks);
    expect(r.algumaPronta()).toBe(true);
  });

  it('"nenhum" desliga a agenda da unidade', async () => {
    const c = await conexoesCom({ trinksApiKey: 'k', agendaSistemaNorte: 'nenhum' });
    const r = new AgendasDasUnidades({ ler: (k) => c.get(k as never), trinks: new ClienteTrinks({ apiKey: 'k' }) });
    expect(() => r.paraUnidade('norte')).toThrow(/não usa sistema de agenda/);
    expect(r.config('sumare').pronta).toBe(true);
  });

  it('o agendar usa o sistema da unidade: Trinks agenda, Avec dá o erro claro', async () => {
    const f = trinksFalso();
    const c = await conexoesCom({ trinksApiKey: 'k', agendaSistemaSumare: 'avec', avecTokenSumare: 'tok', avecUrl: 'https://api.exemplo-avec.test' });
    const r = new AgendasDasUnidades({ ler: (k) => c.get(k as never), trinks: new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, ...semEspera }), fetchFn: f.fn });
    const pedido = { unidade: 'norte' as const, servicoId: 1, profissionalId: 7, data: '2026-11-05', hora: '14:00', nomeCliente: 'Marina Souza', origem: 'teste' };
    const ok = await agendar(r, conversa, pedido, quinta(10));
    expect(ok).toMatchObject({ valor: 290, clienteTrinksId: 55, agendamento: { trinksId: 999, profissional: 'Jéssica' } });
    expect(await horariosLivres(r, 'norte', '2026-11-05', 1, undefined, quinta(10))).toEqual([{ profissionalId: 7, profissional: 'Jéssica', horarios: ['14:00', '16:30'] }]);
    await expect(agendar(r, { ...conversa, unidade: 'sumare' } as Conversa, { ...pedido, unidade: 'sumare' }, quinta(10))).rejects.toThrow(
      'Integração aguardando credenciais/documentação da Avec',
    );
  });

  it('as ferramentas da IA usam o sistema da unidade', async () => {
    const f = trinksFalso();
    const c = await conexoesCom({ trinksApiKey: 'k', agendaSistemaSumare: 'appbarber', appbarberTokenSumare: 't', appbarberLojaSumare: '12' });
    const r = new AgendasDasUnidades({ ler: (k) => c.get(k as never), trinks: new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, ...semEspera }) });
    const ctx = { agenda: r, conversa, agora: quinta(10), acoes: [], podeEscrever: true };
    const norte = await executarFerramenta('ver_servicos', { unidade: 'norte' }, ctx);
    expect(norte.erro).toBe(false);
    expect(JSON.parse(norte.conteudo)[0]).toMatchObject({ id: 1, preco_promocional_hoje: 290 });
    const sumare = await executarFerramenta('ver_servicos', { unidade: 'sumare' }, ctx);
    expect(sumare).toEqual({ erro: true, conteudo: 'Integração aguardando credenciais/documentação da AppBarber (lista de serviços).' });
    // agendamento cancelado no Trinks (status 9) não aparece para a IA
    expect((await executarFerramenta('ver_agendamentos_da_cliente', { unidade: 'norte' }, ctx)).conteudo).toBe('"Nenhum horário marcado."');
  });

  it('um sistema só (jeito antigo) continua valendo como Trinks', () => {
    const fake = { listarServicos: async () => [] } as never;
    expect(agendaDaUnidade(fake, 'norte')).toMatchObject({ tipo: 'trinks', local: '240643' });
  });
});

describe('rotas de Conexões › Agenda', () => {
  it('mostra o status por unidade e testa o sistema escolhido', async () => {
    const f = fetchFalso({ 'GET /reports/0001': () => ({ corpo: [] }) });
    const c = await conexoesCom({ agendaSistemaSumare: 'avec' });
    const agendas = new AgendasDasUnidades({ ler: (k) => c.get(k as never), trinks: new ClienteTrinks({ apiKey: '' }), fetchFn: f.fn, intervaloMs: 0 });
    const app = criarServidor({ sintonia: {} as never, repo: {} as never, conexoes: { conexoes: c, agendas, testarIA: async () => {}, testarTrinks: async () => ({ resumo: '' }) } });

    const st = (await app.inject({ url: '/api/conexoes/agenda' })).json();
    expect(st.unidades.map((u: { sistema: string }) => u.sistema)).toEqual(['trinks', 'avec']);
    expect(st.unidades[0].falta).toEqual(['Chave da API do Trinks']);

    const salvo = await app.inject({ method: 'PUT', url: '/api/conexoes', payload: { avecTokenSumare: 'tok', avecUrl: 'https://api.exemplo-avec.test', avecUnidadeSumare: '77' } });
    expect(salvo.statusCode).toBe(200);
    expect(salvo.json().campos.avecTokenSumare).toEqual({ definido: true, final: 'tok' });

    const t = (await app.inject({ method: 'POST', url: '/api/conexoes/agenda/sumare/testar' })).json();
    expect(t).toMatchObject({ ok: true });
    expect(t.mensagem).toMatch(/^Avec respondendo/);
    const sem = (await app.inject({ method: 'POST', url: '/api/conexoes/agenda/norte/testar' })).json();
    expect(sem).toEqual({ ok: false, erro: 'Falta preencher: Chave da API do Trinks.' });

    expect((await app.inject({ method: 'PUT', url: '/api/conexoes', payload: { agendaSistemaNorte: 'outro' } })).statusCode).toBe(400);
  });
});
