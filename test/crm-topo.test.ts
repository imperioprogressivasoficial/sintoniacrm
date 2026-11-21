import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FiltroLeads, lerFiltro, filtroVazio, inicioDia, fimDia } from '../src/funis/filtro-leads.js';
import { ambientes, montarFunis } from './funis-ambiente.js';

/**
 * Topo do Pipeline (crm-topo): filtro completo no servidor (quadro e lista), lixeira de leads recuperável
 * e os ids filtrados para a "Nova transmissão".
 */
type Coluna = { etapa: { id: string; chaveSistema: string | null }; total: number; cartoes: Array<{ conversaId: string; nome: string; criadaEm?: string }> };
type Quadro = { colunas: Coluna[]; avisos: string[] };

const q = (filtro: unknown) => `?limite=50&filtro=${encodeURIComponent(JSON.stringify(filtro))}`;
const nomes = (r: Quadro) => r.colunas.flatMap((c) => c.cartoes.map((x) => x.nome)).sort();

describe('filtro-leads: leitura e datas', () => {
  it('lê o JSON da URL, aplica os padrões e recusa o que não serve', () => {
    expect(lerFiltro(undefined)).toBeUndefined();
    const f = lerFiltro('{"meus":true,"tags":[]}')!;
    expect(f).toMatchObject({ meus: true, excluidos: false, tags: [], etapas: [], donas: [], campos: [], produtos: [] });
    expect(filtroVazio(f)).toBe(false);
    expect(filtroVazio(FiltroLeads.parse({}))).toBe(true);
    expect(() => lerFiltro('{nao é json')).toThrow(/Filtro inválido/);
    expect(() => lerFiltro('{"tags":["x"]}')).toThrow(/Filtro inválido/);
    expect(() => lerFiltro('{"criadaDe":"20/11/2026"}')).toThrow(/AAAA-MM-DD/);
    expect(() => lerFiltro('{"valorMin":-1}')).toThrow();
  });
  it('dias na Bahia: "de" começa 00:00 (UTC−3) e "até" inclui o dia inteiro', () => {
    expect(inicioDia('2026-11-20').toISOString()).toBe('2026-11-20T03:00:00.000Z');
    expect(fimDia('2026-11-20').toISOString()).toBe('2026-11-21T03:00:00.000Z');
  });
});

describe.each(ambientes)('Pipeline: filtro completo e lixeira ($nome)', (amb) => {
  it('filtra no servidor: tags, etapas, ganhos/perdidos, meus, responsável, valor, sem resposta, datas e conversa', async () => {
    const m = await montarFunis(amb);
    const { como, gente, conversa, sistema, etapasSistema, escreve, avancar } = m;
    const ana = await conversa('norte', 'Ana');
    const bia = await conversa('norte', 'Bianca');
    const cris = await conversa('norte', 'Cristina');
    // Etiqueta "VIP" em Ana e Bianca; "Retorno" só na Bianca.
    const vip = (await como(gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
    const ret = (await como(gente.admin, 'POST', '/api/tags', { nome: 'Retorno' })).json() as { id: string };
    for (const [c, t] of [[ana, vip], [bia, vip], [bia, ret]] as const) expect((await como(gente.admin, 'POST', `/api/conversas/${c.id}/tags`, { tagId: t.id })).statusCode).toBe(200);
    // Etapas: Ana compareceu (ganho), Cristina perdida.
    await como(gente.admin, 'POST', `/api/conversas/${ana.id}/funis/${sistema.id}`, { etapaId: etapasSistema.get('compareceu') });
    await como(gente.admin, 'POST', `/api/conversas/${cris.id}/funis/${sistema.id}`, { etapaId: etapasSistema.get('perdida') });
    // Responsável: Carla fica com a Bianca. Valor: Ana R$ 300, Bianca R$ 80.
    expect((await como(gente.admin, 'POST', `/api/conversas/${bia.id}/transferir`, { usuarioId: gente.carla.id })).statusCode).toBe(200);
    await como(gente.admin, 'PUT', `/api/conversas/${ana.id}/valor`, { valor: 300 });
    await como(gente.admin, 'PUT', `/api/conversas/${bia.id}/valor`, { valor: 80 });

    const quadro = async (filtro: unknown, quem = gente.admin) => {
      const r = await como(quem, 'GET', `/api/funis/${sistema.id}/quadro${q(filtro)}`);
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as Quadro;
    };
    expect(nomes(await quadro({}))).toEqual(['Ana', 'Bianca', 'Cristina']);
    expect(nomes(await quadro({ tags: [vip.id] }))).toEqual(['Ana', 'Bianca']);
    expect(nomes(await quadro({ tags: [vip.id, ret.id], tagsTodas: true }))).toEqual(['Bianca']);
    expect(nomes(await quadro({ situacao: 'ganhos' }))).toEqual(['Ana']);
    expect(nomes(await quadro({ situacao: 'perdidos' }))).toEqual(['Cristina']);
    expect(nomes(await quadro({ etapas: [etapasSistema.get('perdida')] }))).toEqual(['Cristina']);
    expect(nomes(await quadro({ situacao: 'ganhos', etapas: [etapasSistema.get('perdida')] }))).toEqual([]);
    expect(nomes(await quadro({ meus: true }, gente.carla))).toEqual(['Bianca']);
    expect(nomes(await quadro({ donas: ['sem'] }))).toEqual(['Ana', 'Cristina']);
    expect(nomes(await quadro({ donas: [gente.carla.id] }))).toEqual(['Bianca']);
    expect(nomes(await quadro({ valorMin: 100 }))).toEqual(['Ana']);
    expect(nomes(await quadro({ valorMax: 100 }))).toEqual(['Bianca']);
    expect(nomes(await quadro({ nome: 'cris' }))).toEqual(['Cristina']);
    expect(nomes(await quadro({ conversa: 'com' }))).toEqual(['Ana', 'Bianca', 'Cristina']);
    expect(nomes(await quadro({ conversa: 'sem' }))).toEqual([]);
    // Datas de criação (dia na Bahia): todas foram criadas no mesmo dia do relógio do teste.
    const dia = new Date(m.relogio.t.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    expect(nomes(await quadro({ criadaDe: dia, criadaAte: dia }))).toHaveLength(3);
    expect(nomes(await quadro({ criadaAte: '2020-01-01' }))).toEqual([]);
    // Sem resposta: a equipe respondeu a Ana; Bianca e Cristina esperam. O filtro usa o relógio real.
    await escreve(ana, 'Respondido!', true);
    avancar(1);
    expect(nomes(await quadro({ conversa: 'nao_lidas' }))).toEqual(['Bianca', 'Cristina']);
    const horas = Math.ceil((Date.now() - m.relogio.t.getTime()) / 3600_000) + 1;
    expect(nomes(await quadro({ semRespostaHoras: 1 }))).toEqual(['Bianca', 'Cristina']);
    expect(nomes(await quadro({ semRespostaHoras: Math.max(1, horas + 48) }))).toEqual([]);
    // Produtos sem cadastro ligado: o filtro é ignorado e o quadro avisa.
    const p = await quadro({ produtos: [randomUUID()] });
    expect(p.avisos).toEqual(['produtos']);
    expect(nomes(p)).toHaveLength(3);
    // Filtro inválido: 400, mensagem simples.
    const ruim = await como(gente.admin, 'GET', `/api/funis/${sistema.id}/quadro?filtro=${encodeURIComponent('{"tags":["x"]}')}`);
    expect(ruim.statusCode).toBe(400);
    // Ids filtrados (para a transmissão): todas as colunas, sem página.
    const ids = (await como(gente.admin, 'GET', `/api/funis/${sistema.id}/ids?filtro=${encodeURIComponent(JSON.stringify({ tags: [vip.id] }))}`)).json() as { ids: string[]; limite: boolean };
    expect(ids.ids.sort()).toEqual([ana.id, bia.id].sort());
    expect(ids.limite).toBe(false);
    // O cartão traz quando o lead foi criado (coluna "Criado em" da lista).
    expect((await quadro({})).colunas.flatMap((c) => c.cartoes).every((x) => !!x.criadaEm)).toBe(true);
  });

  it('lixeira: excluir esconde do quadro, da contagem e da busca; "Excluídos" mostra; recuperar devolve', async () => {
    const m = await montarFunis(amb);
    const { como, gente, conversa, sistema } = m;
    const ana = await conversa('norte', 'Ana');
    await conversa('norte', 'Bianca');
    const contagem = async () => ((await como(gente.admin, 'GET', '/api/funis')).json() as Array<{ id: string; conversas: number }>).find((f) => f.id === sistema.id)!.conversas;
    const quadro = async (filtro?: unknown) => (await como(gente.admin, 'GET', `/api/funis/${sistema.id}/quadro${filtro ? q(filtro) : '?limite=50'}`)).json() as Quadro;
    expect(await contagem()).toBe(2);

    // Recepcionista de outra unidade não vê a conversa: 404. Sem permissão de CRM: 403.
    expect((await como(gente.rita, 'POST', `/api/funis/${sistema.id}/excluidos`, { ids: [ana.id] })).statusCode).toBe(404);
    expect((await como(gente.admin, 'POST', `/api/funis/${sistema.id}/excluidos`, { ids: ['nao-uuid'] })).statusCode).toBe(400);

    const r = await como(gente.carla, 'POST', `/api/funis/${sistema.id}/excluidos`, { ids: [ana.id] });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, excluidos: 1 });
    expect((await como(gente.carla, 'POST', `/api/funis/${sistema.id}/excluidos`, { ids: [ana.id] })).json()).toMatchObject({ excluidos: 0 });
    expect(nomes(await quadro())).toEqual(['Bianca']);
    expect(nomes(await quadro({ tags: [] }))).toEqual(['Bianca']);
    expect(await contagem()).toBe(1);
    expect(((await como(gente.admin, 'GET', `/api/funis/${sistema.id}/buscar?q=Ana`)).json() as unknown[]).length).toBe(0);
    expect(nomes(await quadro({ excluidos: true }))).toEqual(['Ana']);
    // A conversa continua existindo (nada foi apagado).
    expect((await como(gente.admin, 'GET', `/api/conversas/${ana.id}`)).statusCode).toBe(200);

    const v = await como(gente.carla, 'POST', `/api/funis/${sistema.id}/excluidos/recuperar`, { ids: [ana.id] });
    expect(v.json()).toMatchObject({ ok: true, recuperados: 1 });
    expect(nomes(await quadro())).toEqual(['Ana', 'Bianca']);
    expect(await contagem()).toBe(2);
    expect(nomes(await quadro({ excluidos: true }))).toEqual([]);
  });
});

const pg = ambientes.find((a) => a.nome === 'postgres');
describe.skipIf(!pg)('Pipeline: filtros que usam outras tabelas (postgres)', () => {
  it('tarefas da Rotina, não lidas por pessoa, campos da ficha e transmissão só para os leads escolhidos', async () => {
    const m = await montarFunis(pg!);
    const { como, gente, conversa, sistema } = m;
    const pool = m.pool!;
    const ana = await conversa('norte', 'Ana');
    const bia = await conversa('norte', 'Bianca');
    const quadro = async (filtro: unknown, quem = gente.admin) => nomes((await como(quem, 'GET', `/api/funis/${sistema.id}/quadro${q(filtro)}`)).json() as Quadro);

    // Tarefa aberta da Rotina ligada à Ana; a feita da Bianca não conta.
    await pool.query("DELETE FROM sintonia.rotina_tarefas WHERE empresa_id = 'imperio'");
    await pool.query(
      `insert into sintonia.rotina_tarefas (id, empresa_id, titulo, responsavel_id, conversa_id, feita) values ($1, 'imperio', 'Ligar', $3, $2, false), ($4, 'imperio', 'Feita', $3, $5, true)`,
      [randomUUID(), ana.id, gente.carla.id, randomUUID(), bia.id],
    );
    expect(await quadro({ tarefas: 'com' })).toEqual(['Ana']);
    expect(await quadro({ tarefas: 'sem' })).toEqual(['Bianca']);

    // Não lidas por pessoa: Carla leu a Ana; para ela só a Bianca está não lida. Bia (outra atendente) vê as duas.
    await pool.query('insert into sintonia.leituras (usuario_id, conversa_id, lida_ate) values ($1, $2, now() + interval \'1 day\')', [gente.carla.id, ana.id]);
    expect(await quadro({ conversa: 'nao_lidas' }, gente.carla)).toEqual(['Bianca']);
    expect(await quadro({ conversa: 'nao_lidas' }, gente.bia)).toEqual(['Ana', 'Bianca']);
    // "Marcar como não lida" volta a contar mesmo depois de lida.
    await pool.query('insert into sintonia.marcadas_nao_lidas (usuario_id, conversa_id) values ($1, $2)', [gente.carla.id, ana.id]);
    expect(await quadro({ conversa: 'nao_lidas' }, gente.carla)).toEqual(['Ana', 'Bianca']);

    // Campo personalizado da ficha (gravado direto no banco: as rotas da ficha não estão neste ambiente).
    const campo = randomUUID();
    await pool.query("insert into sintonia.campos_contato (id, empresa_id, nome, tipo) values ($1, 'imperio', 'Cidade', 'texto')", [campo]);
    await pool.query("insert into sintonia.contatos (empresa_id, telefone, nome, campos) values ('imperio', $1, 'Ana', $2)", [ana.telefone, JSON.stringify({ [campo]: 'Salvador' })]);
    expect(await quadro({ campos: [{ id: campo, valor: 'salv' }] })).toEqual(['Ana']);
    expect(await quadro({ campos: [{ id: campo, valor: 'salv', exato: true }] })).toEqual([]);
    expect(await quadro({ campos: [{ id: campo, valor: 'Salvador', exato: true }] })).toEqual(['Ana']);
  });
});
