import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { Preferencias } from '../src/conta/conta.js';
import { DadosUnidade } from '../src/empresa/cadastro.js';
import { canalVozDesligado, RECURSOS_LIGACOES, type CanalVoz } from '../src/ligacoes/canal-voz.js';
import { ArmazemChamadasMemoria } from '../src/ligacoes/chamadas.js';
import { registrarLigacoes } from '../src/ligacoes/rotas.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { ambientes, montarGestao, quinta } from './gestao-ambiente.js';

/** ligacoes-modos: cada ligação guarda por onde foi (telefone, WhatsApp ou VoIP); a linha VoIP e a Serena ligando ficam travadas. */
type Item = { cliente: string | null; telefone: string; direcao: string; modo: string | null };

describe('Linha VoIP desligada e Serena ligando (travadas)', () => {
  it('o canal desligado responde "não configurado" e não tenta ligar', async () => {
    expect(canalVozDesligado.configurado).toBe(false);
    expect(await canalVozDesligado.ligar('', '5571988130001')).toEqual({ ok: false, motivo: 'nao_configurado', mensagem: expect.stringContaining('não está configurada') });
    expect(RECURSOS_LIGACOES.ligacoesIa).toBe(false);
  });

  it('com uma linha de verdade (no futuro), o modo VoIP liga e registra "voip"', async () => {
    const pedidos: Array<[string, string]> = [];
    const linha: CanalVoz = { nome: 'teste', configurado: true, ligar: async (de, para) => (pedidos.push([de, para]), { ok: true, mensagem: 'ok', idExterno: 'sip-1' }) };
    const app = Fastify();
    const chamadas = new ArmazemChamadasMemoria();
    registrarLigacoes(app, { repo: new RepositorioMemoria(), chamadas, empresaId: 'imperio', agora: () => new Date('2026-11-21T15:00:00Z'), canalVoz: linha });
    expect((await app.inject({ method: 'GET', url: '/api/ligacoes/modos' })).json().modos[2]).toEqual({ id: 'voip', disponivel: true, emBreve: false });
    const r = await app.inject({ method: 'POST', url: '/api/ligacoes/efetuada', payload: { telefone: '(71) 98813-0001', modo: 'voip' } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ modo: 'voip' });
    expect(pedidos).toEqual([['', '5571988130001']]);
    const [x] = await chamadas.listar({ empresaId: 'imperio', limite: 5 }, () => true);
    expect(x).toMatchObject({ modo: 'voip', idExterno: 'sip-1', direcao: 'efetuada' });
    await app.close();
  });

  it('preferência da pessoa e padrão da unidade aceitam só telefone ou WhatsApp', () => {
    expect(Preferencias.parse({}).modoLigacao).toBeUndefined();
    expect(Preferencias.parse({ modoLigacao: 'whatsapp' }).modoLigacao).toBe('whatsapp');
    expect(Preferencias.parse({ modoLigacao: 'voip' }).modoLigacao).toBeUndefined();
    expect(DadosUnidade.parse({}).modoLigacao).toBe('telefone');
    expect(DadosUnidade.parse({ modoLigacao: 'whatsapp' }).modoLigacao).toBe('whatsapp');
    expect(DadosUnidade.parse({ modoLigacao: 'qualquer' }).modoLigacao).toBe('telefone');
  });
});

describe.each(ambientes)('Modos de ligar ($nome)', (amb) => {
  it('registra o modo usado em cada ligação; VoIP travada não registra nada', async () => {
    const g = await montarGestao(amb, { chamadas: true, inicio: quinta(14) });
    const marina = await g.conversa('norte', 'Marina');
    const passa = () => { g.relogio.t = new Date(g.relogio.t.getTime() + 60_000); };
    const lista = async () => ((await g.como(g.gente.carla, 'GET', '/api/ligacoes/historico')).json() as { itens: Item[] }).itens;

    const modos = (await g.como(g.gente.carla, 'GET', '/api/ligacoes/modos')).json();
    expect(modos).toEqual({
      modos: [{ id: 'telefone', disponivel: true }, { id: 'whatsapp', disponivel: true }, { id: 'voip', disponivel: false, emBreve: true }],
      ligacoesIa: { disponivel: false, emBreve: true },
    });

    // Sem dizer o modo: telefone (como antes).
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { conversaId: marina.id })).json()).toMatchObject({ modo: 'telefone' });
    passa();
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { conversaId: marina.id, modo: 'whatsapp' })).statusCode).toBe(201);
    passa();
    // VoIP: ainda não há linha. Responde "não configurado" e não entra no histórico.
    const voip = await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { conversaId: marina.id, modo: 'voip' });
    expect(voip.statusCode).toBe(409);
    expect(voip.json().message ?? voip.json().erro ?? JSON.stringify(voip.json())).toMatch(/VoIP/);
    expect((await g.como(g.gente.carla, 'POST', '/api/ligacoes/efetuada', { conversaId: marina.id, modo: 'fax' })).statusCode).toBe(400);
    // A ligação avisada pelo WhatsApp (evento CALL) fica como "whatsapp".
    passa();
    await g.app.inject({ method: 'POST', url: '/webhooks/evolution', payload: { event: 'call', instance: 'imperio-norte', data: { id: 'W9', from: `${marina.telefone}@s.whatsapp.net`, status: 'offer' } } });

    expect((await lista()).map((x) => [x.direcao, x.modo])).toEqual([
      ['perdida', 'whatsapp'],
      ['efetuada', 'whatsapp'],
      ['efetuada', 'telefone'],
    ]);
    // O resultado registrado depois (com o modo) quando a ligação não passou pela tela Ligações.
    passa();
    expect((await g.como(g.gente.carla, 'POST', `/api/conversas/${marina.id}/ligacao`, { resultado: 'agendou', modo: 'whatsapp' })).statusCode).toBe(200);
    expect((await lista())[0]).toMatchObject({ direcao: 'efetuada', modo: 'whatsapp' });
  });
});
