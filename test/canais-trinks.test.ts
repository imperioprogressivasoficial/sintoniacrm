import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { lerWebhookEvolution } from '../src/channels/evolution.js';
import { assinaturaMetaValida, lerWebhookMeta } from '../src/channels/meta.js';
import { ClienteTrinks, ErroTrinks } from '../src/agenda/trinks.js';

describe('webhook da Evolution', () => {
  const base = {
    event: 'messages.upsert',
    instance: 'imperio-norte',
    data: {
      key: { remoteJid: '5571988124471@s.whatsapp.net', fromMe: false, id: 'ABC' },
      pushName: 'Marina',
      message: { conversation: 'Quanto fica a progressiva?' },
      messageTimestamp: 1793980000,
    },
  };

  it('lê mensagem de texto da cliente', () => {
    const [m] = lerWebhookEvolution(base);
    expect(m).toMatchObject({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina', deMim: false, idExterno: 'ABC' });
    expect(m!.texto).toBe('Quanto fica a progressiva?');
  });

  it('aceita o nome do evento em maiúsculas (MESSAGES_UPSERT)', () => {
    expect(lerWebhookEvolution({ ...base, event: 'MESSAGES_UPSERT' })).toHaveLength(1);
  });

  it('marca mensagens enviadas pelo celular da loja', () => {
    const [m] = lerWebhookEvolution({ ...base, data: { ...base.data, key: { ...base.data.key, fromMe: true } } });
    expect(m!.deMim).toBe(true);
    expect(m!.nome).toBeUndefined();
  });

  it('ignora grupos, status e eventos que não são mensagem', () => {
    expect(lerWebhookEvolution({ ...base, data: { ...base.data, key: { ...base.data.key, remoteJid: '1203@g.us' } } })).toHaveLength(0);
    expect(lerWebhookEvolution({ ...base, event: 'connection.update' })).toHaveLength(0);
    expect(lerWebhookEvolution({ qualquer: 'coisa' })).toHaveLength(0);
  });

  it('áudio vira marcador para a IA pedir em texto', () => {
    const [m] = lerWebhookEvolution({ ...base, data: { ...base.data, message: { audioMessage: {} } } });
    expect(m!.texto).toBe('[áudio]');
  });
});

describe('webhook da Meta (API oficial)', () => {
  const corpo = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: '1122' },
              contacts: [{ wa_id: '5571988124471', profile: { name: 'Marina' } }],
              messages: [{ from: '5571988124471', id: 'wamid.1', timestamp: '1793980000', type: 'text', text: { body: 'Oi' } }],
            },
          },
        ],
      },
    ],
  };

  it('lê mensagem de texto', () => {
    expect(lerWebhookMeta(corpo)).toEqual([
      expect.objectContaining({ canalId: '1122', telefone: '5571988124471', nome: 'Marina', texto: 'Oi', deMim: false }),
    ]);
  });

  it('confere a assinatura do webhook', () => {
    const bruto = JSON.stringify(corpo);
    const sig = 'sha256=' + createHmac('sha256', 'segredo').update(bruto).digest('hex');
    expect(assinaturaMetaValida(bruto, sig, 'segredo')).toBe(true);
    expect(assinaturaMetaValida(bruto, sig, 'outro')).toBe(false);
    expect(assinaturaMetaValida(bruto, undefined, 'segredo')).toBe(false);
  });
});

/** fetch falso que responde por rota e registra as chamadas. */
function fetchFalso(rotas: Record<string, (url: URL, init: RequestInit) => { status?: number; corpo: unknown }>) {
  const chamadas: Array<{ url: URL; init: RequestInit }> = [];
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    chamadas.push({ url, init });
    const chave = `${init.method ?? 'GET'} ${url.pathname}`;
    const rota = Object.entries(rotas).find(([k]) => chave.startsWith(k));
    if (!rota) return new Response('não encontrado', { status: 404 });
    const r = rota[1](url, init);
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, chamadas };
}

function relogio() {
  let t = 1_000_000;
  const esperas: number[] = [];
  return {
    agora: () => t,
    dormir: async (ms: number) => {
      esperas.push(ms);
      t += ms;
    },
    esperas,
  };
}

describe('cliente do Trinks', () => {
  it('manda X-Api-Key e estabelecimentoId, e espaça as chamadas', async () => {
    const r = relogio();
    const f = fetchFalso({ 'GET /v1/servicos': () => ({ corpo: { page: 1, totalPages: 1, data: [{ id: 1, nome: 'Progressiva', duracaoEmMinutos: 180, preco: 320 }] } }) });
    const t = new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, intervaloMs: 1000, agora: r.agora, dormir: r.dormir });
    await t.listarServicos('240643');
    await t.listarProfissionais('240643').catch(() => {});
    const h = f.chamadas[0]!.init.headers as Record<string, string>;
    expect(h['X-Api-Key']).toBe('k');
    expect(h.estabelecimentoId).toBe('240643');
    expect(r.esperas).toContain(1000);
  });

  it('usa cache: duas clientes perguntando o mesmo dia gastam uma chamada', async () => {
    const r = relogio();
    const f = fetchFalso({
      'GET /v1/agendamentos/profissionais/2026-11-07': () => ({ corpo: { page: 1, totalPages: 1, data: [{ id: 7, nome: 'Jéssica', horariosVagos: ['10:00'] }] } }),
    });
    const t = new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, agora: r.agora, dormir: r.dormir });
    await t.horariosVagos('240643', '2026-11-07', { servicoId: 1 });
    await t.horariosVagos('240643', '2026-11-07', { servicoId: 1 });
    expect(f.chamadas).toHaveLength(1);
    expect(f.chamadas[0]!.url.searchParams.get('servicoId')).toBe('1');
  });

  it('tenta de novo quando o Trinks devolve 429', async () => {
    const r = relogio();
    let n = 0;
    const f = fetchFalso({
      'GET /v1/servicos': () => (++n < 3 ? { status: 429, corpo: {} } : { corpo: { page: 1, totalPages: 1, data: [] } }),
    });
    const t = new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, agora: r.agora, dormir: r.dormir });
    await expect(t.listarServicos('1')).resolves.toEqual([]);
    expect(n).toBe(3);
  });

  it('não grava agendamento em horário que deixou de estar livre', async () => {
    const r = relogio();
    const f = fetchFalso({
      'GET /v1/agendamentos/profissionais/': () => ({ corpo: { page: 1, totalPages: 1, data: [{ id: 7, nome: 'Jéssica', horariosVagos: ['14:00'] }] } }),
      'POST /v1/agendamentos': () => ({ corpo: { id: 999 } }),
    });
    const t = new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, agora: r.agora, dormir: r.dormir });
    const dados = { clienteId: 1, servicoId: 1, profissionalId: 7, data: '2026-11-07', duracaoEmMinutos: 180, valor: 320 };
    await expect(t.criarAgendamento('240643', { ...dados, hora: '10:00' })).rejects.toBeInstanceOf(ErroTrinks);
    await expect(t.criarAgendamento('240643', { ...dados, hora: '14:00' })).resolves.toBe(999);
    const post = f.chamadas.find((c) => c.init.method === 'POST')!;
    expect(JSON.parse(String(post.init.body))).toMatchObject({ dataHoraInicio: '2026-11-07T14:00:00', confirmado: true });
  });

  it('acha a cliente pelo celular exato, mesmo com formatos diferentes', async () => {
    const r = relogio();
    const f = fetchFalso({
      'GET /v1/clientes': () => ({
        corpo: {
          page: 1,
          totalPages: 1,
          data: [
            { id: 1, nome: 'Outra', telefones: [{ ddd: '71', telefone: '988124470' }] },
            { id: 2, nome: 'Marina', telefones: [{ ddi: '55', ddd: '71', telefone: '88124471' }] },
          ],
        },
      }),
    });
    const t = new ClienteTrinks({ apiKey: 'k', fetchFn: f.fn, agora: r.agora, dormir: r.dormir });
    expect((await t.buscarClientePorTelefone('240643', '5571988124471'))?.id).toBe(2);
  });
});
