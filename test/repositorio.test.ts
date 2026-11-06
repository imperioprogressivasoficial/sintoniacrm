import { describe, expect, it } from 'vitest';
import { bahia, MIN } from '../src/util/tempo.js';
import { fabricas } from './repos.js';

const t0 = bahia(2026, 11, 5, 10);
const dados = { empresaId: 'imperio', unidade: 'norte' as const, canalId: 'imperio-norte', telefone: '5571988124471', agora: t0 };

describe.each(fabricas)('Repositório ($nome)', (f) => {
  it('cria a conversa uma vez só, mesmo com chegadas simultâneas', async () => {
    const repo = await f.criar();
    const rs = await Promise.all(Array.from({ length: 10 }, () => repo.buscarOuCriarConversa({ ...dados, nome: 'Marina' })));
    expect(new Set(rs.map((r) => r.conversa.id)).size).toBe(1);
    expect(rs.filter((r) => r.nova)).toHaveLength(1);
    expect(await repo.listarConversas()).toHaveLength(1);
  });

  it('completa o nome que faltava, sem sobrescrever o que já existe', async () => {
    const repo = await f.criar();
    await repo.buscarOuCriarConversa(dados);
    const a = await repo.buscarOuCriarConversa({ ...dados, nome: 'Marina' });
    expect(a.conversa.nome).toBe('Marina');
    const b = await repo.buscarOuCriarConversa({ ...dados, nome: 'Outro nome' });
    expect(b.conversa.nome).toBe('Marina');
  });

  it('salva e lê todos os campos da conversa', async () => {
    const repo = await f.criar();
    const { conversa } = await repo.buscarOuCriarConversa(dados);
    const editada = {
      ...conversa,
      modo: 'ia' as const,
      etapa: 'agendada' as const,
      trinksClienteId: 55,
      pausaIaAte: new Date(t0.getTime() + 10 * MIN),
      ultimaMensagemCliente: t0,
      ultimaMensagemIa: new Date(t0.getTime() + MIN),
      etiquetas: ['VIP', 'Manutenção'],
      resumo: 'Cliente fiel',
      atualizadaEm: new Date(t0.getTime() + 2 * MIN),
    };
    await repo.salvarConversa(editada);
    const lida = await repo.buscarConversa(conversa.id);
    expect(lida).toEqual(editada);
  });

  it('ignora mensagem repetida pelo id do WhatsApp e devolve as últimas em ordem', async () => {
    const repo = await f.criar();
    const { conversa } = await repo.buscarOuCriarConversa(dados);
    const m = (i: number) => ({ conversaId: conversa.id, autor: 'cliente' as const, texto: `msg ${i}`, em: new Date(t0.getTime() + i * MIN), idExterno: `w-${i}` });
    for (let i = 1; i <= 5; i++) expect(await repo.adicionarMensagem(m(i))).toBe(true);
    expect(await repo.adicionarMensagem(m(3))).toBe(false);
    // sem id externo (mensagem interna) nunca é tratada como repetida
    expect(await repo.adicionarMensagem({ ...m(6), idExterno: undefined })).toBe(true);
    expect(await repo.adicionarMensagem({ ...m(7), idExterno: undefined })).toBe(true);
    const ultimas = await repo.mensagens(conversa.id, 3);
    expect(ultimas.map((x) => x.texto)).toEqual(['msg 5', 'msg 6', 'msg 7']);
  });

  it('dois trabalhadores nunca pegam a mesma tarefa', async () => {
    const repo = await f.criar();
    const { conversa } = await repo.buscarOuCriarConversa(dados);
    for (let i = 0; i < 50; i++) {
      await repo.programar({ conversaId: conversa.id, tipo: 'followup_1h', quando: new Date(t0.getTime() + i * 1000) });
    }
    await repo.programar({ conversaId: conversa.id, tipo: 'followup_1d', quando: new Date(t0.getTime() + 60 * MIN) });
    const agora = new Date(t0.getTime() + 5 * MIN);
    const lotes = await Promise.all(Array.from({ length: 5 }, () => repo.reivindicarTarefas(agora, 20)));
    const ids = lotes.flat().map((t) => t.id);
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(await repo.reivindicarTarefas(agora)).toHaveLength(0);
    expect((await repo.tarefasPendentes(conversa.id)).map((t) => t.tipo)).toEqual(['followup_1d']);
  });

  it('cancela só os tipos pedidos', async () => {
    const repo = await f.criar();
    const { conversa } = await repo.buscarOuCriarConversa(dados);
    await repo.programar({ conversaId: conversa.id, tipo: 'followup_1h', quando: t0 });
    await repo.programar({ conversaId: conversa.id, tipo: 'lembrete_vespera', quando: t0 });
    await repo.cancelarTarefas(conversa.id, ['followup_1h']);
    expect((await repo.tarefasPendentes(conversa.id)).map((t) => t.tipo)).toEqual(['lembrete_vespera']);
    await repo.cancelarTarefas(conversa.id);
    expect(await repo.tarefasPendentes(conversa.id)).toHaveLength(0);
  });

  it('guarda eventos com dados e filtra por período', async () => {
    const repo = await f.criar();
    const { conversa } = await repo.buscarOuCriarConversa(dados);
    await repo.registrarEvento({ tipo: 'equipe_respondeu', conversaId: conversa.id, unidade: 'norte', em: t0, dados: { atendente: 'Carla', tempoRespostaMs: 60000 } });
    await repo.registrarEvento({ tipo: 'ia_respondeu', em: new Date(t0.getTime() + 25 * 60 * MIN) });
    const dia = await repo.eventosEntre(bahia(2026, 11, 5), bahia(2026, 11, 6));
    expect(dia).toEqual([{ tipo: 'equipe_respondeu', conversaId: conversa.id, unidade: 'norte', em: t0, dados: { atendente: 'Carla', tempoRespostaMs: 60000 } }]);
  });

  it('marca o que a própria Sintonia enviou e guarda a sugestão', async () => {
    const repo = await f.criar();
    const { conversa } = await repo.buscarOuCriarConversa(dados);
    await repo.registrarEnviadoPorNos('out-1');
    await repo.registrarEnviadoPorNos('out-1');
    await repo.registrarEnviadoPorNos('');
    expect(await repo.foiEnviadoPorNos('out-1')).toBe(true);
    expect(await repo.foiEnviadoPorNos('out-2')).toBe(false);
    expect(await repo.foiEnviadoPorNos('')).toBe(false);
    expect(await repo.sugestao(conversa.id)).toBeUndefined();
    await repo.guardarSugestao(conversa.id, 'Posso reservar sábado às 14h?');
    expect(await repo.sugestao(conversa.id)).toBe('Posso reservar sábado às 14h?');
  });
});
