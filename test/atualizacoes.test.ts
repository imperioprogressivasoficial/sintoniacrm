import { describe, expect, it } from 'vitest';
import { atualizacoesDeHoje } from '../src/app/atualizacoes.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

describe('Atualizações do dia', () => {
  it('descreve o que importa, do mais novo ao mais antigo, só de hoje (Bahia)', async () => {
    const repo = new RepositorioMemoria();
    const agora = new Date('2026-11-07T18:00:00Z'); // 15h na Bahia
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'x', telefone: '5571988887777', nome: 'Juliana', agora });
    const ev = (tipo: never, em: string, dados?: Record<string, unknown>) => repo.registrarEvento({ tipo, conversaId: conversa.id, unidade: 'norte', em: new Date(em), dados });
    await ev('conversa_nova' as never, '2026-11-07T12:00:00Z');
    await ev('mensagem_cliente' as never, '2026-11-07T12:00:01Z'); // ruído: não aparece
    await ev('agendamento_ia' as never, '2026-11-07T13:00:00Z', { servico: 'Progressiva', inicio: '2026-11-08T13:00:00Z' });
    await ev('envio_ativo' as never, '2026-11-07T14:00:00Z', { tipo: 'lembrete_2h' });
    await ev('ia_assumiu' as never, '2026-11-06T20:00:00Z'); // ontem (17h Bahia de ontem): não aparece
    const lista = await atualizacoesDeHoje(repo, agora);
    expect(lista.map((a) => a.titulo)).toEqual([
      'Lembrete de 2 horas antes enviado',
      'A IA agendou Progressiva',
      'Nova cliente chamou no WhatsApp',
    ]);
    expect(lista[1]).toMatchObject({ cliente: 'Juliana', detalhe: '08/11 às 10:00', tipo: 'agendamento' });
    const filtrada = await atualizacoesDeHoje(repo, agora, (_c, tipo) => tipo !== 'lembrete');
    expect(filtrada).toHaveLength(2);
  });
});
