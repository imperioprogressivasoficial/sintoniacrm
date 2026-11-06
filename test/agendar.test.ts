import { describe, expect, it } from 'vitest';
import { ErroTrinks } from '../src/agenda/trinks.js';
import type { Agenda } from '../src/ai/ferramentas.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';

const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

function montar() {
  const enviados: Array<{ telefone: string; texto: string }> = [];
  const canal: CanalWhatsApp = {
    tipo: 'evolution',
    lerWebhook: () => [],
    enviarTexto: async (_c, telefone, texto) => {
      enviados.push({ telefone, texto });
      return { idExterno: `out-${enviados.length}` };
    },
  };
  const criados: Array<Record<string, unknown>> = [];
  let ocupar = false;
  const agenda: Agenda = {
    listarServicos: async () => [
      { id: 1, nome: 'Progressiva Império', duracaoEmMinutos: 180, preco: 320, valorPromocional: 290, visivelParaCliente: true },
      { id: 2, nome: 'Interno', duracaoEmMinutos: 10, preco: 0, visivelParaCliente: false },
    ],
    listarProfissionais: async () => [{ id: 7, nome: 'Jéssica Santos', apelido: 'Jéssica', possuiAgenda: true }],
    horariosVagos: async () => [{ id: 7, nome: 'Jéssica', horariosVagos: ['09:00', '14:00', '16:30'] }],
    buscarClientePorTelefone: async () => null,
    criarCliente: async () => 55,
    criarAgendamento: async (_e, dados) => {
      if (ocupar) throw new ErroTrinks(409, 'ocupado');
      criados.push(dados);
      return 999;
    },
    listarAgendamentosDoCliente: async () => [],
  };
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: { executar: async () => ({ texto: 'Oi!', acoes: [], recusou: false }) },
    agora: () => quinta(10),
  });
  const app = criarServidor({ sintonia, repo, agenda, agora: () => quinta(10) });
  return { app, repo, sintonia, enviados, criados, ocupar: () => (ocupar = true) };
}

async function conversaCom(repo: RepositorioMemoria, sintonia: Sintonia) {
  await sintonia.receber({
    canalId: 'imperio-norte',
    telefone: '5571988124471',
    nome: 'Marina Souza',
    texto: 'Quero marcar progressiva',
    deMim: false,
    idExterno: 'in-1',
    em: quinta(10),
  });
  return (await repo.listarConversas())[0]!;
}

describe('Botão "Agendar" do CRM', () => {
  it('lista serviços visíveis com o preço de hoje e as profissionais', async () => {
    const { app } = montar();
    const s = await app.inject({ url: '/api/agenda/servicos?unidade=norte' });
    expect(s.json()).toEqual([{ id: 1, nome: 'Progressiva Império', categoria: null, duracaoMin: 180, preco: 320, precoHoje: 290 }]);
    const p = await app.inject({ url: '/api/agenda/profissionais?unidade=norte' });
    expect(p.json()).toEqual([{ id: 7, nome: 'Jéssica' }]);
  });

  it('mostra só horários que ainda não passaram', async () => {
    const { app } = montar();
    const r = await app.inject({ url: '/api/agenda/horarios?unidade=norte&data=2026-11-05&servicoId=1' });
    expect(r.json()).toEqual([{ profissionalId: 7, profissional: 'Jéssica', horarios: ['14:00', '16:30'] }]);
  });

  it('agenda no Trinks, confirma para a cliente e conta para a atendente', async () => {
    const { app, repo, sintonia, enviados, criados } = montar();
    const c = await conversaCom(repo, sintonia);
    const r = await app.inject({
      method: 'POST',
      url: `/api/conversas/${c.id}/agendar`,
      payload: { unidade: 'norte', servicoId: 1, profissionalId: 7, data: '2026-11-07', hora: '14:00', nomeCliente: 'Marina Souza', atendente: 'Carla' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, agendamentoId: 999, valor: 290 });
    expect(criados[0]).toMatchObject({ clienteId: 55, servicoId: 1, profissionalId: 7, data: '2026-11-07', hora: '14:00', valor: 290 });
    expect(criados[0]!.observacoes).toContain('Carla pelo CRM');

    const conversa = await repo.buscarConversa(c.id);
    expect(conversa!.etapa).toBe('agendada');
    expect((await repo.tarefasPendentes(c.id)).map((t) => t.tipo)).toEqual(['lembrete_vespera', 'lembrete_2h']);
    expect(enviados.at(-1)!.texto).toBe(
      'Prontinho, Marina! Seu horário está confirmado: Progressiva Império, dia 07/11 às 14:00 com Jéssica, no Salvador Norte Shopping. Te mando um lembrete na véspera.',
    );

    const painel = (await app.inject({ url: '/api/painel' })).json();
    expect(painel.agendamentosEquipe).toBe(1);
    expect(painel.porAtendente.Carla).toMatchObject({ agendamentos: 1, respostas: 1 });
  });

  it('horário que acabou de ser ocupado devolve 409 com mensagem clara', async () => {
    const { app, repo, sintonia, ocupar } = montar();
    const c = await conversaCom(repo, sintonia);
    ocupar();
    const r = await app.inject({
      method: 'POST',
      url: `/api/conversas/${c.id}/agendar`,
      payload: { unidade: 'norte', servicoId: 1, profissionalId: 7, data: '2026-11-07', hora: '14:00', nomeCliente: 'Marina Souza', atendente: 'Carla' },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().erro).toContain('acabou de ser ocupado');
  });

  it('Feira (sem agenda) e horário no passado são recusados', async () => {
    const { app, repo, sintonia } = montar();
    const c = await conversaCom(repo, sintonia);
    const base = { servicoId: 1, profissionalId: 7, nomeCliente: 'Marina Souza', atendente: 'Carla' };
    const feira = await app.inject({ method: 'POST', url: `/api/conversas/${c.id}/agendar`, payload: { ...base, unidade: 'feira', data: '2026-11-07', hora: '14:00' } });
    expect(feira.statusCode).toBe(400);
    const passado = await app.inject({ method: 'POST', url: `/api/conversas/${c.id}/agendar`, payload: { ...base, unidade: 'norte', data: '2026-11-05', hora: '09:00' } });
    expect(passado.statusCode).toBe(400);
    expect(passado.json().codigo).toBe('data_passada');
  });

  it('conversa inexistente devolve 404', async () => {
    const { app } = montar();
    const r = await app.inject({
      method: 'POST',
      url: '/api/conversas/nao-existe/agendar',
      payload: { unidade: 'norte', servicoId: 1, profissionalId: 7, data: '2026-11-07', hora: '14:00', nomeCliente: 'Marina Souza', atendente: 'Carla' },
    });
    expect(r.statusCode).toBe(404);
  });
});
