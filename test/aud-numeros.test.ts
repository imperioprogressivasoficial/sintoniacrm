import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { CacheLid } from '../src/channels/lid-cache.js';
import { CanalEvolution, lerWebhookEvolution } from '../src/channels/evolution.js';
import { lerWebhookMeta } from '../src/channels/meta.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { normalizarCelular, normalizarTelefoneWhats, telefoneDoJid } from '../src/util/telefone.js';
import { fabricas } from './repos.js';

// ---------------------------------------------------------------- B) números de fora do Brasil e fixos
describe('aud-numeros: telefone que chega pelo WhatsApp', () => {
  it('celular brasileiro continua igualzinho (com e sem o 9)', () => {
    expect(telefoneDoJid('5571988124471@s.whatsapp.net')).toBe('5571988124471');
    expect(telefoneDoJid('557188124471@s.whatsapp.net')).toBe('5571988124471'); // ganha o 9, como antes
    expect(telefoneDoJid('5571988124471:12@s.whatsapp.net')).toBe('5571988124471');
    // Para todo número que já passava, o resultado é o mesmo de antes (não duplica conversa).
    for (const n of ['5571988124471', '557188124471', '5511987654321', '551196543210']) expect(normalizarTelefoneWhats(n)).toBe(normalizarCelular(n));
  });

  it('fixo brasileiro passa sem ganhar o 9', () => {
    expect(telefoneDoJid('557133334444@s.whatsapp.net')).toBe('557133334444');
    expect(telefoneDoJid('551125551234@s.whatsapp.net')).toBe('551125551234');
  });

  it('número de outro país passa como veio (8 a 15 dígitos)', () => {
    expect(telefoneDoJid('14155552671@s.whatsapp.net')).toBe('14155552671'); // EUA
    expect(telefoneDoJid('19295551234@s.whatsapp.net')).toBe('19295551234'); // EUA (não vira DDD 19)
    expect(telefoneDoJid('351912345678@s.whatsapp.net')).toBe('351912345678'); // Portugal
    expect(telefoneDoJid('447911123456@s.whatsapp.net')).toBe('447911123456'); // Reino Unido
    expect(telefoneDoJid('5491123456789@s.whatsapp.net')).toBe('5491123456789'); // Argentina
  });

  it('recusa o que não é telefone', () => {
    expect(telefoneDoJid('120363025@g.us')).toBeNull();
    expect(telefoneDoJid('status@broadcast')).toBeNull();
    expect(telefoneDoJid('123456789012345@lid')).toBeNull(); // código @lid não é número
    expect(telefoneDoJid('1234567@s.whatsapp.net')).toBeNull(); // curto demais
    expect(telefoneDoJid('1234567890123456@s.whatsapp.net')).toBeNull(); // longo demais
    expect(telefoneDoJid('557112345678@s.whatsapp.net')).toBeNull(); // Brasil com número que não existe
    expect(telefoneDoJid('55719881244710@s.whatsapp.net')).toBeNull(); // Brasil com dígitos a mais
    expect(telefoneDoJid('')).toBeNull();
  });

  it('webhook da Evolution e da API oficial não descartam mais número de fora e fixo', () => {
    const ev = lerWebhookEvolution({
      event: 'messages.upsert', instance: 'sintonia-x',
      data: [
        { key: { remoteJid: '351912345678@s.whatsapp.net', fromMe: false, id: 'E1' }, message: { conversation: 'olá' }, messageTimestamp: 1763900000 },
        { key: { remoteJid: '557133334444@s.whatsapp.net', fromMe: false, id: 'E2' }, message: { conversation: 'oi' }, messageTimestamp: 1763900000 },
      ],
    });
    expect(ev.map((m) => m.telefone)).toEqual(['351912345678', '557133334444']);
    const meta = lerWebhookMeta({
      object: 'whatsapp_business_account',
      entry: [{ id: 'w', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'pn1' }, contacts: [{ wa_id: '14155552671', profile: { name: 'John' } }], messages: [{ from: '14155552671', id: 'wamid.1', timestamp: '1763900000', type: 'text', text: { body: 'hi' } }] } }] }],
    });
    expect(meta.map((m) => m.telefone)).toEqual(['14155552671']);
  });
});

// ---------------------------------------------------------------- A) dois números na mesma unidade
class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ canal: string; telefone: string; texto: string }> = [];
  lerWebhook() { return []; }
  async enviarTexto(canal: string, telefone: string, texto: string) {
    this.enviados.push({ canal, telefone, texto });
    return { idExterno: `out-${this.enviados.length}` };
  }
}

describe.each(fabricas)('aud-numeros: cliente que escreve pelo outro WhatsApp da unidade ($nome)', (f) => {
  async function montar() {
    const repo = await f.criar();
    const canal = new CanalFalso();
    const relogio = { t: new Date('2026-11-26T15:00:00Z') };
    const s = new Sintonia({
      empresaId: 'imperio', repo,
      numeros: [{ canalId: 'whats-1', unidade: 'norte', canal }, { canalId: 'whats-2', unidade: 'norte', canal }],
      agente: { executar: async () => ({ texto: 'Oi!', acoes: [], recusou: false }) },
      agora: () => relogio.t,
    });
    return { s, repo, canal, relogio };
  }
  let seq = 0;
  const msg = (canalId: string, em: Date, extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
    canalId, telefone: '5571988124471', nome: 'Marina', texto: 'oi', deMim: false, idExterno: `aud-${++seq}-${Math.random()}`, em, ...extra,
  });

  it('a resposta sai pelo número que a cliente usou por último', async () => {
    const { s, repo, canal, relogio } = await montar();
    await s.receber(msg('whats-1', relogio.t));
    const [c] = await repo.listarConversas();
    expect(c!.canalId).toBe('whats-1');
    relogio.t = new Date(relogio.t.getTime() + 60_000);
    await s.receber(msg('whats-2', relogio.t));
    const todas = await repo.listarConversas();
    expect(todas).toHaveLength(1); // continua uma conversa só
    expect(todas[0]!.canalId).toBe('whats-2');
    await s.equipeEnviou(todas[0]!.id, 'Pode vir às 15h', 'Ana');
    expect(canal.enviados.at(-1)).toMatchObject({ canal: 'whats-2', texto: 'Pode vir às 15h' });
  });

  it('mensagem atrasada, do celular da loja ou histórico importado não troca o número', async () => {
    const { s, repo, relogio } = await montar();
    const t0 = relogio.t;
    await s.receber(msg('whats-1', t0));
    // mensagem antiga (anterior à última da cliente) chegando atrasada pelo número 2
    await s.receber(msg('whats-2', new Date(t0.getTime() - 3600_000)));
    expect((await repo.listarConversas())[0]!.canalId).toBe('whats-1');
    // a loja escreveu pelo número 2 (fromMe)
    await s.receber(msg('whats-2', new Date(t0.getTime() + 60_000), { deMim: true, texto: 'oi Marina' }));
    expect((await repo.listarConversas())[0]!.canalId).toBe('whats-1');
    // histórico puxado do número 2
    await s.importarHistorico([msg('whats-2', new Date(t0.getTime() + 120_000))]);
    expect((await repo.listarConversas())[0]!.canalId).toBe('whats-1');
  });
});

// ---------------------------------------------------------------- C) contato "@lid" sem número no webhook ao vivo
const lid = (id: string, jid: string, extra: Record<string, unknown> = {}) => ({
  key: { remoteJid: jid, fromMe: false, id, ...extra },
  pushName: 'Ana',
  message: { conversation: `oi ${id}` },
  messageTimestamp: 1763900000,
});

describe('aud-numeros: mensagem ao vivo de contato @lid sem número', () => {
  it('completa pelo mapa da Evolution e guarda por 10 min', async () => {
    let buscas = 0;
    let t = 0;
    const cache = new CacheLid({ buscar: async () => { buscas++; return new Map([['111@lid', '5571966665555@s.whatsapp.net']]); }, agora: () => t });
    const corpo = await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: lid('L1', '111@lid') });
    expect(lerWebhookEvolution(corpo).map((m) => m.telefone)).toEqual(['5571966665555']);
    await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: [lid('L2', '222@lid')] });
    expect(buscas).toBe(1); // não busca de novo antes de 10 min
    t = 10 * 60_000;
    await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: [lid('L3', '222@lid')] });
    expect(buscas).toBe(2);
    // número que já vem na mensagem não dispara busca e ensina o mapa
    t = 11 * 60_000;
    await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: [lid('L4', '333@lid', { remoteJidAlt: '5571955554444@s.whatsapp.net' })] });
    const c2 = await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: [lid('L5', '333@lid')] });
    expect(lerWebhookEvolution(c2).map((m) => m.telefone)).toEqual(['5571955554444']);
    expect(buscas).toBe(2);
  });

  it('não segura o webhook: mapa demorado ou com erro segue sem ele, e registra no log 1 vez por minuto', async () => {
    const logs: Array<[string, unknown]> = [];
    let t = 0;
    let soltar: (m: Map<string, string>) => void = () => {};
    const cache = new CacheLid({ buscar: () => new Promise((ok) => { soltar = ok; }), esperaMs: 30, agora: () => t, log: (m, e) => logs.push([m, e]) });
    const inicio = Date.now();
    const corpo = await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: [lid('M1', '444@lid'), lid('M2', '555@lid')] });
    expect(Date.now() - inicio).toBeLessThan(1000);
    expect(lerWebhookEvolution(corpo)).toHaveLength(0);
    expect(logs).toEqual([['Mensagens do WhatsApp sem número (contato @lid) ficaram de fora', { instancia: 'sintonia-x', mensagens: 2 }]]);
    // a busca termina por trás e serve à próxima mensagem
    soltar(new Map([['444@lid', '5571944443333@s.whatsapp.net']]));
    await new Promise((ok) => setTimeout(ok, 5));
    t = 30_000;
    const c2 = await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: [lid('M3', '444@lid'), lid('M4', '555@lid')] });
    expect(lerWebhookEvolution(c2).map((m) => m.telefone)).toEqual(['5571944443333']);
    expect(logs).toHaveLength(1); // menos de 1 min: não loga de novo
    t = 61_000;
    await cache.completar({ event: 'messages.upsert', instance: 'sintonia-x', data: [lid('M5', '555@lid')] });
    expect(logs.at(-1)).toEqual(['Mensagens do WhatsApp sem número (contato @lid) ficaram de fora', { instancia: 'sintonia-x', mensagens: 2 }]);
    // erro na busca: segue sem o mapa
    const comErro = new CacheLid({ buscar: async () => { throw new Error('fora do ar'); } });
    const c3 = await comErro.completar({ event: 'messages.upsert', instance: 'sintonia-y', data: lid('M6', '666@lid') });
    expect(lerWebhookEvolution(c3)).toHaveLength(0);
  });

  it('o servidor completa o @lid antes de ler o webhook', async () => {
    const repo = new RepositorioMemoria();
    const recebidas: MensagemRecebida[] = [];
    const sintonia = { receber: async (m: MensagemRecebida) => { recebidas.push(m); } } as unknown as Sintonia;
    const app = criarServidor({
      sintonia, repo,
      evolution: { canal: new CanalEvolution('http://evo', 'k') },
      mapaLid: async (instancia) => new Map(instancia === 'sintonia-x' ? [['777@lid', '351912345678@s.whatsapp.net']] : []),
    });
    const r = await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: { event: 'messages.upsert', instance: 'sintonia-x', data: lid('S1', '777@lid') } });
    expect(r.json()).toMatchObject({ recebidas: 1 });
    await new Promise((ok) => setTimeout(ok, 5));
    expect(recebidas.map((m) => m.telefone)).toEqual(['351912345678']);
    await app.close();
  });
});
