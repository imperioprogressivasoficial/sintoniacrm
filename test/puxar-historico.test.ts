import { describe, expect, it } from 'vitest';
import { lerWebhookEvolution } from '../src/channels/evolution.js';
import { PuxarHistorico } from '../src/app/puxar-historico.js';
import type { MensagemRecebida } from '../src/channels/tipos.js';

const msg = (id: string, jid: string, extra: Record<string, unknown> = {}) => ({
  key: { remoteJid: jid, fromMe: false, id, ...extra },
  pushName: 'Ana',
  message: { conversation: `oi ${id}` },
  messageTimestamp: 1763900000,
});

describe('histórico do WhatsApp', () => {
  it('aceita o horário no formato longo do WhatsApp ({ low, high })', () => {
    const r = lerWebhookEvolution({ event: 'messages.set', instance: 'sintonia-x', data: [{ ...msg('A1', '5571999990000@s.whatsapp.net'), messageTimestamp: { low: 1763900000, high: 0, unsigned: true } }] });
    expect(r).toHaveLength(1);
    expect(r[0]!.em.getTime()).toBe(1763900000 * 1000);
  });

  it('aceita fromMe nulo e lista dentro de data.messages', () => {
    const r = lerWebhookEvolution({ event: 'messages.set', instance: 'sintonia-x', data: { messages: [msg('A2', '5571999990000@s.whatsapp.net', { fromMe: null })] } });
    expect(r).toHaveLength(1);
    expect(r[0]!.deMim).toBe(false);
  });

  it('puxa todas as páginas da Evolution e acha o número de quem vem só pelo código @lid', async () => {
    const paginas = [
      [msg('B1', '5571988887777@s.whatsapp.net'), msg('B2', '123456@lid')],
      [msg('B3', '999@lid', { remoteJidAlt: '5571977776666@s.whatsapp.net' }), msg('B4', '999@lid')],
    ];
    const recebidas: MensagemRecebida[] = [];
    const p = new PuxarHistorico({
      admin: () => ({
        paginaDeMensagens: async (_n, pagina) => ({ registros: paginas[pagina - 1] ?? [], paginas: 2, total: 4 }),
        mapaLid: async () => new Map([['123456@lid', '5571966665555@s.whatsapp.net']]),
      }),
      receber: async (_i, m) => { recebidas.push(...m); return m.length; },
    });
    const a = await p.puxar('sintonia-x');
    expect(a.lidas).toBe(4);
    expect(a.novas).toBe(4);
    expect(a.semNumero).toBe(0);
    expect(recebidas.map((m) => m.telefone).sort()).toEqual(['5571966665555', '5571977776666', '5571977776666', '5571988887777'].sort());
  });
});
