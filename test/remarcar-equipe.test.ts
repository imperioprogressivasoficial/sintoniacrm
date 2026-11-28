import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgendamentoDoSistema } from '../src/agenda/sistema.js';
import type { Agenda } from '../src/ai/ferramentas.js';
import { REGRAS_ATENDIMENTO } from '../src/ai/regras-atendimento.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import type { RegistroAuditoria } from '../src/seguranca/auditoria.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';

/** reagendar (dono 28/11): "Reagendar" e "Agendar para outra pessoa" no botão de agenda do topo da conversa. */

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
  const passos: string[] = [];
  const criados: Array<Record<string, unknown>> = [];
  const clientesCriados: Array<{ nome: string; telefone: string; extras?: unknown }> = [];
  const marcados: AgendamentoDoSistema[] = [
    { id: 500, servico: { id: 1, nome: 'Progressiva Império' }, profissional: { id: 7, nome: 'Jéssica' }, dataHoraInicio: '2026-11-05T09:00:00', duracaoEmMinutos: 180, valor: 290 }, // já passou
    { id: 501, servico: { id: 1, nome: 'Progressiva Império' }, profissional: { id: 7, nome: 'Jéssica' }, dataHoraInicio: '2026-11-07T15:00:00', duracaoEmMinutos: 180, valor: 290 },
  ];
  let ocupar = false;
  const agenda: Agenda = {
    listarServicos: async () => [{ id: 1, nome: 'Progressiva Império', duracaoEmMinutos: 180, preco: 320, valorPromocional: 290, visivelParaCliente: true }],
    listarProfissionais: async () => [
      { id: 7, nome: 'Jéssica Santos', apelido: 'Jéssica', possuiAgenda: true },
      { id: 8, nome: 'Ana Lima', apelido: 'Ana', possuiAgenda: true },
    ],
    horariosVagos: async (_e, _d, o) =>
      [
        { id: 7, nome: 'Jéssica', horariosVagos: ['14:00'] },
        { id: 8, nome: 'Ana', horariosVagos: ['14:00', '16:30'] },
      ].filter((p) => !o?.profissionalId || p.id === o.profissionalId),
    buscarClientePorTelefone: async (_e, tel) => (tel === '5571988124471' ? { id: 55, nome: 'Marina Souza' } : null),
    buscarClientesPorNome: async () => [],
    criarCliente: async (_e, nome, telefone, extras) => {
      clientesCriados.push({ nome, telefone, extras });
      return 66;
    },
    criarAgendamento: async (_e, dados) => {
      if (ocupar) throw Object.assign(new Error('ocupado'), { status: 409 });
      passos.push(`criou ${dados.data} ${dados.hora}`);
      criados.push(dados);
      return 999;
    },
    listarAgendamentosDoCliente: async (_e, clienteId) => (clienteId === 55 ? marcados : []),
    cancelarAgendamento: async (_e, id) => {
      passos.push(`cancelou ${id}`);
    },
  };
  const auditoria: RegistroAuditoria[] = [];
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: { executar: async () => ({ texto: 'Oi!', acoes: [], recusou: false }) },
    agora: () => quinta(10),
  });
  const app = criarServidor({
    sintonia,
    repo,
    agenda,
    agora: () => quinta(10),
    protecao: { auditoria: { registrar: async (r) => void auditoria.push(r), listar: async () => [] } },
  });
  return { app, repo, sintonia, enviados, criados, passos, clientesCriados, auditoria, ocupar: () => (ocupar = true) };
}

async function conversaCom(repo: RepositorioMemoria, sintonia: Sintonia) {
  await sintonia.receber({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina Souza', texto: 'Oi', deMim: false, idExterno: 'in-1', em: quinta(10) });
  return (await repo.listarConversas())[0]!;
}

describe('Reagendar pela equipe (topo da conversa)', () => {
  it('lista só os horários futuros da cliente na unidade da conversa, sem profissional', async () => {
    const { app, repo, sintonia } = montar();
    const c = await conversaCom(repo, sintonia);
    const r = await app.inject({ url: `/api/conversas/${c.id}/horarios-marcados` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      unidade: 'norte',
      unidadeNome: 'Salvador Norte Shopping',
      horarios: [{ id: 501, data: '2026-11-07', hora: '15:00', servico: 'Progressiva Império', servicoId: 1, duracaoMin: 180 }],
    });
    expect(JSON.stringify(r.json())).not.toContain('Jéssica');
  });

  it('remarca: marca o novo ANTES de cancelar o antigo, confirma sem citar profissional e registra na auditoria', async () => {
    const { app, repo, sintonia, passos, criados, enviados, auditoria } = montar();
    const c = await conversaCom(repo, sintonia);
    const r = await app.inject({ method: 'POST', url: `/api/conversas/${c.id}/remarcar`, payload: { agendamentoId: 501, data: '2026-11-09', hora: '14:00', atendente: 'Carla' } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, agendamentoId: 999, data: '2026-11-09', hora: '14:00', cancelouAntigo: true });
    expect(passos).toEqual(['criou 2026-11-09 14:00', 'cancelou 501']);
    // A mesma profissional, que está livre às 14:00; observação diz quem remarcou.
    expect(criados[0]).toMatchObject({ clienteId: 55, profissionalId: 7, servicoId: 1 });
    expect(String(criados[0]!.observacoes)).toContain('Carla pelo CRM');
    expect(enviados.at(-1)!.texto).toBe('Prontinho, Marina! Seu horário está confirmado: Progressiva Império, dia 09/11 às 14:00, no Salvador Norte Shopping. Te mando um lembrete na véspera.');
    expect(auditoria.find((a) => a.acao === 'remarcou horário')).toMatchObject({ autorNome: 'Carla', detalhe: { agendamentoAntigo: 501, agendamentoNovo: 999 } });
  });

  it('horário novo ocupado ou horário que não é dela: 409 e nada é cancelado', async () => {
    const m = montar();
    const c = await conversaCom(m.repo, m.sintonia);
    const alheio = await m.app.inject({ method: 'POST', url: `/api/conversas/${c.id}/remarcar`, payload: { agendamentoId: 777, data: '2026-11-09', hora: '14:00', atendente: 'Carla' } });
    expect(alheio.statusCode).toBe(409);
    expect(alheio.json().erro).toContain('não está entre os horários futuros');
    const livre = await m.app.inject({ method: 'POST', url: `/api/conversas/${c.id}/remarcar`, payload: { agendamentoId: 501, data: '2026-11-09', hora: '11:00', atendente: 'Carla' } });
    expect(livre.statusCode).toBe(409);
    expect(livre.json().erro).toContain('antigo continua marcado');
    m.ocupar();
    const ocupado = await m.app.inject({ method: 'POST', url: `/api/conversas/${c.id}/remarcar`, payload: { agendamentoId: 501, data: '2026-11-09', hora: '14:00', atendente: 'Carla' } });
    expect(ocupado.statusCode).toBe(409);
    expect(m.passos.filter((p) => p.startsWith('cancelou'))).toEqual([]);
  });

  it('dados inválidos (zod) e conversa inexistente', async () => {
    const { app, repo, sintonia } = montar();
    const c = await conversaCom(repo, sintonia);
    expect((await app.inject({ method: 'POST', url: `/api/conversas/${c.id}/remarcar`, payload: { agendamentoId: 501, data: '9/11', hora: '14:00', atendente: 'Carla' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/conversas/nao-existe/remarcar', payload: { agendamentoId: 501, data: '2026-11-09', hora: '14:00', atendente: 'Carla' } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/conversas/nao-existe/horarios-marcados' })).statusCode).toBe(404);
  });
});

describe('Agendar para outra pessoa (equipe)', () => {
  const base = { unidade: 'norte', servicoId: 1, profissionalId: 7, data: '2026-11-07', hora: '14:00', atendente: 'Carla' };

  it('marca no cadastro DELA (criado com nome, telefone, nascimento e e-mail); o cadastro da dona não muda', async () => {
    const { app, repo, sintonia, criados, clientesCriados, enviados } = montar();
    const c = await conversaCom(repo, sintonia);
    const antes = (await repo.buscarConversa(c.id))!.trinksClienteId;
    const r = await app.inject({
      method: 'POST',
      url: `/api/conversas/${c.id}/agendar`,
      payload: { ...base, nomeCliente: 'Joana Souza Lima', paraOutra: { telefone: '(71) 99876-5432', dataNascimento: '1990-04-12', email: 'Joana@Email.com' } },
    });
    expect(r.statusCode).toBe(200);
    expect(clientesCriados).toEqual([{ nome: 'Joana Souza Lima', telefone: '5571998765432', extras: { dataNascimento: '1990-04-12', email: 'joana@email.com' } }]);
    expect(criados[0]).toMatchObject({ clienteId: 66 });
    expect((await repo.buscarConversa(c.id))!.trinksClienteId).toBe(antes);
    expect(enviados.at(-1)!.texto).toContain('O horário de Joana está confirmado');
  });

  it('pede nome completo e telefone válido', async () => {
    const { app, repo, sintonia } = montar();
    const c = await conversaCom(repo, sintonia);
    const curto = await app.inject({ method: 'POST', url: `/api/conversas/${c.id}/agendar`, payload: { ...base, nomeCliente: 'Joana', paraOutra: {} } });
    expect(curto.statusCode).toBe(400);
    expect(curto.json().erro).toContain('nome completo');
    const tel = await app.inject({ method: 'POST', url: `/api/conversas/${c.id}/agendar`, payload: { ...base, nomeCliente: 'Joana Lima', paraOutra: { telefone: '123' } } });
    expect(tel.statusCode).toBe(400);
  });
});

describe('IA: a cliente diz que não vai conseguir ir', () => {
  it('a regra manda oferecer remarcar e usar remarcar_agendamento (não cancelar)', () => {
    const r = REGRAS_ATENDIMENTO.find((x) => x.startsWith('Não vai conseguir ir'));
    expect(r).toBeDefined();
    expect(r).toContain('ver_agendamentos_da_cliente');
    expect(r).toContain('consultar_horarios');
    expect(r).toContain('remarcar_agendamento');
    expect(r).toMatch(/"2" ao lembrete/);
    expect(readFileSync(new URL('../knowledge/imperio.md', import.meta.url), 'utf8')).toMatch(/Não vai conseguir ir[\s\S]*ofereça remarcar/);
  });
});
