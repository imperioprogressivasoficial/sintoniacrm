import { describe, expect, it } from 'vitest';
import { ligacoesDoDia, quemLigar, registrarLigacao } from '../src/app/ligacoes.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';

const H = 3600_000;

async function cenario() {
  const repo = new RepositorioMemoria();
  const agora = new Date('2026-11-07T18:00:00Z');
  const criar = async (nome: string, tel: string, extra: Record<string, unknown>) => {
    const { conversa } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'x', telefone: tel, nome, agora: new Date(agora.getTime() - 5 * 24 * H) });
    Object.assign(conversa, extra);
    await repo.salvarConversa(conversa);
    return conversa;
  };
  const sumiu = await criar('Ana', '5571900000001', { etapa: 'em_conversa', ultimaMensagemCliente: new Date(agora.getTime() - 50 * H), ultimaMensagemIa: new Date(agora.getTime() - 49 * H) });
  const interessada = await criar('Bia', '5571900000002', { etapa: 'interessada', ultimaMensagemCliente: new Date(agora.getTime() - 30 * H), ultimaMensagemEquipe: new Date(agora.getTime() - 29 * H) });
  await criar('Cris', '5571900000003', { etapa: 'em_conversa', ultimaMensagemCliente: new Date(agora.getTime() - 2 * H), ultimaMensagemIa: new Date(agora.getTime() - 1 * H) }); // recente: não liga
  await criar('Dani', '5571900000004', { etapa: 'agendada', ultimaMensagemCliente: new Date(agora.getTime() - 50 * H), ultimaMensagemIa: new Date(agora.getTime() - 49 * H) }); // agendada: não liga
  const faltou = await criar('Eva', '5571900000005', { etapa: 'agendada' });
  await repo.registrarEvento({ tipo: 'envio_ativo', conversaId: faltou.id, unidade: 'norte', em: new Date(agora.getTime() - 3 * H), dados: { tipo: 'recuperar_falta' } });
  return { repo, agora, sumiu, interessada, faltou };
}

describe('Ligações', () => {
  it('sugere quem ligar, na ordem: faltou, interessada, sumiu', async () => {
    const { repo, agora } = await cenario();
    const lista = await quemLigar(repo, agora);
    expect(lista.map((s) => [s.cliente, s.motivo])).toEqual([
      ['Eva', 'faltou'],
      ['Bia', 'interessada_sem_agendar'],
      ['Ana', 'nao_responde'],
    ]);
    expect(lista[2]!.texto).toBe('Não responde há 2 dia(s)');
  });

  it('registrar tira da lista, aparece na conversa e no histórico do dia', async () => {
    const { repo, agora, interessada } = await cenario();
    await registrarLigacao(repo, interessada, { resultado: 'nao_atendeu', nota: 'tentar à noite', atendente: 'Carla', agora });
    expect((await quemLigar(repo, agora)).map((s) => s.cliente)).toEqual(['Eva', 'Ana']);
    const msgs = await repo.mensagens(interessada.id);
    expect(msgs.at(-1)).toMatchObject({ autor: 'sistema', texto: '📞 Carla ligou: não atendeu · tentar à noite' });
    const hoje = await ligacoesDoDia(repo, new Date('2026-11-07T03:00:00Z'), new Date('2026-11-08T03:00:00Z'));
    expect(hoje).toEqual([expect.objectContaining({ cliente: 'Bia', resultado: 'nao_atendeu', atendente: 'Carla', nota: 'tentar à noite' })]);
    // no dia seguinte volta a sugerir
    expect((await quemLigar(repo, new Date(agora.getTime() + 21 * H))).map((s) => s.cliente)).toContain('Bia');
  });
});
