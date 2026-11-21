import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { normalizarConfig } from '../src/empresa/empresa.js';
import { bahia } from '../src/util/tempo.js';
import { fabricas } from './repos.js';

/* Assinatura nas respostas da IA (dono 21/11): liga/desliga, nome e posição. */
class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: string[] = [];
  lerWebhook() { return []; }
  async enviarTexto(_c: string, _t: string, texto: string) { this.enviados.push(texto); return { idExterno: `out-${this.enviados.length}` }; }
}
const agente = { async executar(_p: PedidoAgente): Promise<RespostaAgente> { return { texto: 'Oi! Posso ajudar?', acoes: [], recusou: false }; } };
const madrugada = bahia(2026, 11, 5, 2, 0);

describe.each(fabricas)('assinatura da IA ($nome)', (f) => {
  for (const [nome, a, esperado] of [
    ['desligada: sem nome', { ligada: false, texto: 'Serena', posicao: 'inicio' as const }, 'Oi! Posso ajudar?'],
    ['no começo', { ligada: true, texto: 'Serena', posicao: 'inicio' as const }, '*Serena:*\nOi! Posso ajudar?'],
    ['no fim, com outro nome', { ligada: true, texto: 'Ana *IA*', posicao: 'fim' as const }, 'Oi! Posso ajudar?\n\n_Ana IA_'],
  ] as const) {
    it(nome, async () => {
      const repo = await f.criar();
      const canal = new CanalFalso();
      const s = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'c', unidade: 'norte', canal }], agente, agora: () => madrugada, assinaturaIa: async () => a });
      await s.receber({ canalId: 'c', telefone: '5571988124471', nome: 'Marina', texto: 'vcs abrem domingo?', deMim: false, idExterno: 'in-' + nome, em: madrugada });
      expect(canal.enviados).toEqual([esperado]);
      const [c] = await repo.listarConversas();
      const msgs = await repo.mensagens(c!.id);
      expect(msgs.find((m) => m.autor === 'ia')!.texto).toBe(esperado); // o que a equipe vê é o que saiu
    });
  }
});

describe('configuração da assinatura', () => {
  it('padrão desligada com "Serena"; nome vazio volta para "Serena"', () => {
    expect(normalizarConfig({}).assinatura).toEqual({ ligada: false, texto: 'Serena', posicao: 'inicio' });
    expect(normalizarConfig({ assinatura: { ligada: true, texto: '' } }).assinatura).toEqual({ ligada: true, texto: 'Serena', posicao: 'inicio' });
  });
});
