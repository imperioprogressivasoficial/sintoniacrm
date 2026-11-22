import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalEvolution, lerStatusEvolution } from '../src/channels/evolution.js';
import { CanalMeta, lerStatusMeta } from '../src/channels/meta.js';
import { criarServidor } from '../src/server.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { fabricas } from './repos.js';

/**
 * Vistos das mensagens da loja, como no WhatsApp:
 * ✓ saiu (enviada) → ✓✓ cinza (entregue) → ✓✓ azul (lida) → microfone azul (ouvida, só áudio de voz).
 * Só avança: um aviso atrasado nunca volta atrás.
 */

const TEL = '5571988124471';
const JID = `${TEL}@s.whatsapp.net`;

/** messages.update da Evolution v2 (formato do Baileys service). */
const atualizacao = (keyId: string, status: string | number, extra: Record<string, unknown> = {}) => ({
  event: 'messages.update',
  instance: 'imperio-norte',
  data: { messageId: 'cm3abc', keyId, remoteJid: JID, fromMe: true, participant: null, status, instanceId: 'x', datetime: 1793980100000, ...extra },
  destination: 'https://sintonia.exemplo/webhooks/evolution',
  date_time: '2026-11-05T02:15:00.000Z',
  sender: '557133334444@s.whatsapp.net',
});

describe('Evolution: lerStatusEvolution', () => {
  it('SERVER_ACK = enviada, DELIVERY_ACK = entregue, READ = lida, PLAYED = ouvida', () => {
    const s = (st: string) => lerStatusEvolution(atualizacao('3EB0A', st))[0]?.status;
    expect(s('SERVER_ACK')).toBe('enviada');
    expect(s('DELIVERY_ACK')).toBe('entregue');
    expect(s('READ')).toBe('lida');
    expect(s('PLAYED')).toBe('ouvida');
    expect(s('ERROR')).toBe('falhou');
    expect(lerStatusEvolution(atualizacao('3EB0A', 'READ'))[0]).toEqual({ canalId: 'imperio-norte', idExterno: '3EB0A', status: 'lida', em: new Date(1793980100000), telefone: TEL });
  });

  it('relógio (PENDING), apagada e avisos das mensagens da cliente ficam de fora', () => {
    expect(lerStatusEvolution(atualizacao('3EB0A', 'PENDING'))).toEqual([]);
    expect(lerStatusEvolution(atualizacao('3EB0A', 'DELETED'))).toEqual([]);
    expect(lerStatusEvolution(atualizacao('3EB0A', 'READ', { fromMe: false }))).toEqual([]);
    expect(lerStatusEvolution({ ...atualizacao('3EB0A', 'READ'), event: 'messages.upsert' })).toEqual([]);
    expect(lerStatusEvolution(null)).toEqual([]);
  });

  it('aceita o formato antigo (key + update, status em número) e lista', () => {
    const antigo = { event: 'MESSAGES_UPDATE', instance: 'imperio-norte', data: [
      { key: { id: 'A1', remoteJid: JID, fromMe: true }, update: { status: 3 } },
      { key: { id: 'A2', remoteJid: JID, fromMe: true }, update: { status: 5 } },
    ] };
    expect(lerStatusEvolution(antigo).map((x) => [x.idExterno, x.status])).toEqual([['A1', 'entregue'], ['A2', 'ouvida']]);
    expect(new CanalEvolution('http://evo', 'k').lerStatus(antigo)).toHaveLength(2);
  });
});

describe('Meta: sent / delivered / read / played', () => {
  const corpo = (status: string) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'W', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5571', phone_number_id: '1122' }, statuses: [{ id: 'wamid.X', status, timestamp: '1793980100', recipient_id: TEL }] } }] }],
  });
  it('vira enviada, entregue, lida e ouvida (played: a Meta manda quando a cliente toca o áudio de voz)', () => {
    expect(['sent', 'delivered', 'read', 'played'].map((s) => lerStatusMeta(corpo(s))[0]?.status)).toEqual(['enviada', 'entregue', 'lida', 'ouvida']);
  });
});

for (const f of fabricas) {
  describe(`Vistos gravados (${f.nome})`, () => {
    async function montar() {
      const repo: Repositorio = await f.criar();
      const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
      const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: TEL, agora: new Date() });
      await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'equipe', texto: 'Oi!', em: new Date(), idExterno: 'TXT1' });
      await repo.adicionarMensagem({ conversaId: conversa.id, autor: 'equipe', texto: '[áudio]', em: new Date(Date.now() + 1000), idExterno: 'AUD1', anexo: { tipo: 'audio', voz: true, mimetype: 'audio/ogg', situacao: 'pronta' } });
      const lista = (l: Parameters<Sintonia['statusRecebidos']>[0]) => sintonia.statusRecebidos(l);
      const app = criarServidor({
        sintonia,
        repo,
        evolution: { canal: new CanalEvolution('http://evo', 'k'), status: lista },
        meta: { canal: new CanalMeta({ token: 'T' }), verifyTokens: [], segredos: [], semAssinatura: true, status: lista },
      });
      const entrega = async () => Object.fromEntries((await repo.mensagens(conversa.id)).map((m) => [m.idExterno, m.entrega ?? null]));
      const evo = (keyId: string, status: string) => app.inject({ method: 'POST', url: '/webhooks/evolution', payload: atualizacao(keyId, status) });
      return { app, repo, entrega, evo };
    }

    it('mensagem nova sem aviso: sem status (a tela mostra um ✓)', async () => {
      const { entrega } = await montar();
      expect(await entrega()).toEqual({ TXT1: null, AUD1: null });
    });

    it('Evolution: SERVER_ACK → DELIVERY_ACK → READ → PLAYED no áudio', async () => {
      const { entrega, evo } = await montar();
      expect((await evo('AUD1', 'SERVER_ACK')).json()).toEqual({ status: 1 });
      expect((await entrega()).AUD1).toBe('enviada');
      await evo('AUD1', 'DELIVERY_ACK');
      expect((await entrega()).AUD1).toBe('entregue');
      await evo('AUD1', 'READ');
      expect((await entrega()).AUD1).toBe('lida');
      await evo('AUD1', 'PLAYED');
      expect((await entrega()).AUD1).toBe('ouvida');
      expect((await entrega()).TXT1).toBeNull();
    });

    it('fora de ordem nunca volta atrás', async () => {
      const { entrega, evo } = await montar();
      await evo('TXT1', 'READ');
      await evo('TXT1', 'DELIVERY_ACK'); // chegou atrasado
      await evo('TXT1', 'SERVER_ACK');
      expect((await entrega()).TXT1).toBe('lida');
      await evo('AUD1', 'PLAYED');
      await evo('AUD1', 'READ');
      expect((await entrega()).AUD1).toBe('ouvida');
    });

    it('"ouvida" só vale para áudio: num texto conta como lida', async () => {
      const { entrega, evo } = await montar();
      await evo('TXT1', 'PLAYED');
      expect((await entrega()).TXT1).toBe('lida');
    });

    it('Meta: sent → delivered → read → played, e read atrasado não apaga o ouvido', async () => {
      const { app, entrega } = await montar();
      const meta = (id: string, status: string) => app.inject({ method: 'POST', url: '/webhook/meta', payload: {
        object: 'whatsapp_business_account',
        entry: [{ id: 'W', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '5571', phone_number_id: '1122' }, statuses: [{ id, status, timestamp: '1793980100', recipient_id: TEL }] } }] }],
      } });
      await meta('TXT1', 'sent');
      expect((await entrega()).TXT1).toBe('enviada');
      await meta('TXT1', 'delivered');
      expect((await entrega()).TXT1).toBe('entregue');
      await meta('TXT1', 'read');
      expect((await entrega()).TXT1).toBe('lida');
      await meta('AUD1', 'played');
      await meta('AUD1', 'read');
      expect((await entrega()).AUD1).toBe('ouvida');
    });

    it('a lista de conversas leva o visto da última mensagem', async () => {
      const { repo, evo } = await montar();
      await evo('AUD1', 'DELIVERY_ACK');
      const ultimas = await repo.ultimasMensagens();
      expect([...ultimas.values()][0]?.entrega).toBe('entregue');
    });
  });
}
