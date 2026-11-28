import { describe, expect, it } from 'vitest';
import { ArmazemEnvioRelatorioMemoria } from '../src/relatorio-dia/envio.js';
import { semearRelatorio } from '../src/relatorio-dia/semente.js';

describe('relatórios automáticos: quem recebe vem da publicação', () => {
  it('acrescenta pelo e-mail (WhatsApp do perfil), liga o envio e manda o de agora uma vez só', async () => {
    const armazem = new ArmazemEnvioRelatorioMemoria();
    const enviados: string[][] = [];
    const servico = { enviarAgora: async (_r: string, ref: string, d: Array<{ destino: string }>) => { enviados.push([ref, ...d.map((x) => x.destino)]); return d.length; } };
    const pessoas: Record<string, { id: string; nome: string; telefone: string }> = {
      'ana@x.com': { id: 'u1', nome: 'Ana Lima', telefone: '71 99999-8888' },
      'caio@x.com': { id: 'u2', nome: 'Caio', telefone: '' },
    };
    const bruto = JSON.stringify({ destinatarios: [{ email: 'ana@x.com' }, { email: 'caio@x.com' }, { nome: 'Davi', numero: '71988887777' }], relatorios: ['agenda', 'fechamento'], agora: { id: 'hoje', relatorio: 'fechamento' } });
    const logs: string[] = [];
    const r = await semearRelatorio({ armazem, servico: servico as never, empresaId: 'imperio', bruto, pessoa: async (e) => pessoas[e], log: (m) => logs.push(m) });
    expect(r.acrescentados).toBe(2);
    const { cfg } = await armazem.lerConfig('imperio');
    expect(cfg.ligado).toBe(true);
    expect(cfg.destinatarios.map((d) => [d.nome, d.destino, d.usuarioId])).toEqual([['Ana Lima', '5571999998888', 'u1'], ['Davi', '5571988887777', null]]);
    expect(logs.some((l) => l.includes('Caio'))).toBe(true);
    // Rodar de novo não duplica ninguém
    await semearRelatorio({ armazem, servico: servico as never, empresaId: 'imperio', bruto, pessoa: async (e) => pessoas[e] });
    expect((await armazem.lerConfig('imperio')).cfg.destinatarios).toHaveLength(2);
    expect(enviados[0]).toEqual(['agora:hoje', '5571999998888', '5571988887777']);
  });
});
