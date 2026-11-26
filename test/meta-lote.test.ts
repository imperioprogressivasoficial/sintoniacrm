import { describe, expect, it } from 'vitest';
import { lerStatusMeta, lerWebhookMeta } from '../src/channels/meta.js';

const msg = (id: string, extra: Record<string, unknown> = {}) => ({ from: '5571999990000', id, timestamp: '1763900000', type: 'text', text: { body: `oi ${id}` }, ...extra });

describe('API oficial: um item fora do formato não derruba o lote', () => {
  it('mensagem estranha e change sem metadata ficam de fora; as outras entram', () => {
    const corpo = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [
        { value: { metadata: { phone_number_id: 'P1' }, messages: [msg('A'), { from: 1, id: 'X' }, msg('B')], statuses: [{ id: 's1', status: 'read', timestamp: '1763900001' }, { id: 2 }] } },
        { value: { messages: [msg('C')] } },
      ] }],
    };
    expect(lerWebhookMeta(corpo).map((m) => m.idExterno)).toEqual(['A', 'B']);
    expect(lerStatusMeta(corpo).map((s) => s.idExterno)).toEqual(['s1']);
  });
});
