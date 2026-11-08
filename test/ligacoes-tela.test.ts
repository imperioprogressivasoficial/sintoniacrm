import { describe, expect, it } from 'vitest';
import { direcaoDoAviso, lerChamadasEvolution } from '../src/ligacoes/chamadas.js';
import { ambientes, montarGestao, quinta } from './gestao-ambiente.js';

/** Tela Ligações: histórico real (efetuadas pelo app, recebidas/perdidas pelo WhatsApp), favoritos, programar e limpar. */
type Item = { id: string; conversaId: string | null; cliente: string | null; telefone: string; direcao: string; resultado: string | null; atendente: string | null; origem: string };

describe('Evento CALL da Evolution', () => {
  it('lê a ligação (um item ou lista), ignora grupo e outros eventos', () => {
    const um = { event: 'call', instance: 'imperio-norte', data: { id: 'C1', from: '5571988130001@s.whatsapp.net', status: 'offer', date: 1762600000 } };
    expect(lerChamadasEvolution(um)).toEqual([{ instancia: 'imperio-norte', idExterno: 'C1', telefone: '5571988130001', status: 'offer', em: new Date(1762600000 * 1000) }]);
    expect(lerChamadasEvolution({ ...um, event: 'CALL', data: [um.data, { ...um.data, id: 'C2', from: '1203630@g.us' }] })).toHaveLength(1);
    expect(lerChamadasEvolution({ ...um, event: 'messages.upsert' })).toEqual([]);
    expect(lerChamadasEvolution({ nada: 1 })).toEqual([]);
    expect(direcaoDoAviso('offer')).toBe('perdida');
    expect(direcaoDoAviso('timeout')).toBe('perdida');
    expect(direcaoDoAviso('accept')).toBe('recebida');
  });
});

describe.each(ambientes)('Tela Ligações ($nome)', (amb) => {
  it('Ligar registra "efetuada" (sem duração), o resultado vai na mesma; o WhatsApp registra perdida/recebida', async () => {
    const g = await montarGestao(amb, { chamadas: true, inicio: quinta(14) });
    const marina = await g.conversa('norte', 'Marina');
    const paula = await g.conversa('sumare', 'Paula');
    const lista = async (u = g.gente.carla, filtro = 'todas') => ((await g.como(u, 'GET', `/api/ligacoes/historico?filtro=${filtro}`)).json() as { itens: Item[] }).itens;

    const r = await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { conversaId: marina.id });
    expect(r.statusCode).toBe(201);
    expect((await g.como(g.gente.carla, 'POST', `/api/conversas/${marina.id}/ligacao`, { resultado: 'atendeu', chamadaId: r.json().id })).statusCode).toBe(200);
    // Número digitado (Teclado): sem conversa, só quem ligou e a gestão veem.
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { telefone: '(71) 3333-4444' })).statusCode).toBe(201);
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { telefone: '12' })).statusCode).toBe(400);
    // Conversa que a Carla não vê.
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { conversaId: paula.id })).statusCode).toBe(404);

    // O WhatsApp avisa: Paula ligou e ninguém atendeu; depois, outra que foi atendida.
    const aviso = (id: string, from: string, status: string) => g.app.inject({ method: 'POST', url: '/webhooks/evolution', payload: { event: 'call', instance: 'imperio-sumare', data: { id, from: `${from}@s.whatsapp.net`, status } } });
    expect((await aviso('W1', paula.telefone, 'offer')).json()).toMatchObject({ chamadas: 1 });
    await aviso('W1', paula.telefone, 'timeout'); // mesma chamada: não duplica
    await aviso('W2', marina.telefone, 'offer');
    await aviso('W2', marina.telefone, 'accept'); // atendeu no celular da loja

    const daCarla = await lista();
    expect(daCarla.map((x) => [x.cliente, x.direcao, x.resultado])).toEqual([
      ['Marina', 'recebida', 'accept'],
      [null, 'efetuada', null],
      ['Marina', 'efetuada', 'atendeu'],
    ]);
    expect(daCarla[2]).toMatchObject({ atendente: 'Carla Lima', origem: 'app' });
    expect(JSON.stringify(daCarla)).not.toMatch(/duracao/);
    expect((await lista(g.gente.carla, 'perdidas')).length).toBe(0);
    const daRita = await lista(g.gente.rita, 'perdidas');
    expect(daRita.map((x) => [x.cliente, x.direcao])).toEqual([['Paula', 'perdida']]);
    expect((await lista(g.gente.bia)).some((x) => x.telefone === '557133334444' || x.telefone === '7133334444')).toBe(false); // número digitado pela Carla
    expect((await lista(g.gente.admin)).length).toBe(4);

    // Limpar histórico: some só para quem limpou.
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/limpar', {})).statusCode).toBe(200);
    expect(await lista()).toEqual([]);
    expect((await lista(g.gente.admin)).length).toBe(4);
  });

  it('favoritos por pessoa e ligação programada entra em "programadas para hoje"', async () => {
    const g = await montarGestao(amb, { chamadas: true, inicio: quinta(10) });
    const marina = await g.conversa('norte', 'Marina');
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/favoritos', { conversaId: marina.id, favorito: true })).json()).toEqual({ ok: true, favorito: true });
    expect((await g.como(g.gente.carla, 'GET', '/api/ligacoes/favoritos')).json()).toEqual([expect.objectContaining({ conversaId: marina.id, nome: 'Marina' })]);
    expect((await g.como(g.gente.bia, 'GET', '/api/ligacoes/favoritos')).json()).toEqual([]);
    const quando = new Date(g.relogio.t.getTime() + 2 * 3600_000).toISOString();
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/programar', { conversaId: marina.id, quando, texto: 'Confirmar a progressiva' })).statusCode).toBe(201);
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/programar', { conversaId: marina.id, quando: new Date(g.relogio.t.getTime() - 3600_000).toISOString() })).statusCode).toBe(400);
    const sug = (await g.como(g.gente.carla, 'GET', '/api/ligacoes')).json().sugestoes as Array<{ conversaId: string; motivo: string; texto: string }>;
    expect(sug.find((x) => x.conversaId === marina.id)).toMatchObject({ motivo: 'lembrete', texto: expect.stringContaining('Confirmar a progressiva') });
  });
});
