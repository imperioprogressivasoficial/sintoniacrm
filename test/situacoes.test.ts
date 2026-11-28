import { beforeEach, describe, expect, it } from 'vitest';
import { conhecerCliente, esquecerCliente, textoClienteConhecida } from '../src/ai/cliente-conhecida.js';
import { REGRAS_ATENDIMENTO, textoRegrasAtendimento } from '../src/ai/regras-atendimento.js';
import { carregarBase } from '../src/ai/prompt.js';
import { secoesDoMarkdown } from '../src/ai/base.js';
import type { FonteAgenda } from '../src/agenda/sistema.js';
import type { Conversa } from '../src/domain.js';
import { reiniciarUnidades } from '../src/unidades.js';
import { bahia } from '../src/util/tempo.js';

/**
 * situacoes (dono 28/11): a Serena sabe o que a cliente tem na agenda (horário futuro ou desmarcado) antes de responder,
 * e a base/regras trazem a árvore de situações em volta do agendamento.
 */

const TEL = '5571988120000';
const agora = bahia(2026, 11, 28, 10, 0); // sábado

type Item = { data: string; hora: string; statusId?: number; cancelado?: boolean };

function agendaCom(itens: Item[]): FonteAgenda {
  return {
    sistema: 'trinks',
    async buscarClientePorTelefone(_l: string, tel: string) {
      return tel === TEL ? { id: 55, nome: 'Marina Souza' } : null;
    },
    async listarAgendamentosDoCliente() {
      return itens.map((x, i) => ({
        id: 100 + i,
        servico: { id: 1, nome: 'Avaliação técnica' },
        profissional: { id: 7, nome: 'Jéssica' },
        dataHoraInicio: `${x.data}T${x.hora}:00`,
        duracaoEmMinutos: 60,
        valor: 0,
        ...(x.statusId ? { status: { id: x.statusId } } : {}),
        ...(x.cancelado ? { cancelado: true } : {}),
      }));
    },
  } as unknown as FonteAgenda;
}

const conversa = (): Conversa =>
  ({ id: 'c1', empresaId: 'imperio', unidade: 'sumare', canalId: 'imperio-sumare', telefone: TEL, nome: 'Marina Souza', modo: 'ia', etapa: 'em_conversa', etiquetas: [], criadaEm: agora, atualizadaEm: agora }) as Conversa;

beforeEach(() => {
  esquecerCliente();
  reiniciarUnidades();
});

describe('situacoes: <cliente_conhecida> com o que ela tem na agenda', () => {
  it('horário futuro: a IA já sabe que ela está agendada e lembra o horário em vez de recomeçar', async () => {
    const k = await conhecerCliente(agendaCom([{ data: '2026-12-05', hora: '09:00' }]), conversa(), agora);
    expect(k.proximoHorario).toMatchObject({ data: '2026-12-05', hora: '09:00' });
    expect(k.canceladoRecente ?? null).toBeNull();
    const t = textoClienteConhecida(k, false);
    expect(t).toContain('próximo horário marcado: sábado, 05/12/2026 às 09:00');
    expect(t).toContain('Ela JÁ está agendada');
    expect(t).toContain('Você já está agendada para sábado, 05/12, às 09:00');
    expect(t).not.toContain('nenhum na agenda');
  });

  it('cancelado na agenda (status 9 do Trinks): vai como desmarcado, com tato e oferta de novo horário', async () => {
    const k = await conhecerCliente(agendaCom([{ data: '2026-11-26', hora: '15:30', statusId: 9 }, { data: '2026-08-10', hora: '10:00' }]), conversa(), agora);
    expect(k.proximoHorario).toBeNull();
    expect(k.canceladoRecente).toMatchObject({ data: '2026-11-26', hora: '15:30' });
    expect(k.ultimoAtendimento).toMatchObject({ data: '2026-08-10' });
    const t = textoClienteConhecida(k, false);
    expect(t).toContain('horário desmarcado: quinta, 26/11/2026 às 15:30');
    expect(t).toContain('explique com tato');
    expect(t).toContain('ofereça um novo horário');
    expect(t).toContain('próximo horário marcado: nenhum na agenda agora');
    expect(t).toContain('não diga "você não está agendada"');
  });

  it('cancelado futuro também conta; cancelado de mais de 30 dias atrás não; com horário que vale, avisa qual vale', async () => {
    const fut = await conhecerCliente(agendaCom([{ data: '2026-12-02', hora: '12:30', cancelado: true }]), conversa(), agora);
    expect(fut.canceladoRecente).toMatchObject({ data: '2026-12-02' });
    esquecerCliente();
    const velho = await conhecerCliente(agendaCom([{ data: '2026-10-01', hora: '12:30', statusId: 9 }]), conversa(), agora);
    expect(velho.canceladoRecente ?? null).toBeNull();
    esquecerCliente();
    const trocou = await conhecerCliente(agendaCom([{ data: '2026-12-01', hora: '09:00', statusId: 9 }, { data: '2026-12-03', hora: '15:30' }]), conversa(), agora);
    const t = textoClienteConhecida(trocou, false);
    expect(t).toContain('o que vale é o próximo horário marcado');
    expect(t).toContain('próximo horário marcado: quinta, 03/12/2026 às 15:30');
  });

  it('agenda sem resposta: manda conferir com ver_agendamentos_da_cliente antes de dizer que não tem horário', () => {
    const t = textoClienteConhecida({ conhecida: false, nome: null, por: null, confirmar: false, unidade: null, clienteId: null, ultimoAtendimento: null, proximoHorario: null, semResposta: true }, false);
    expect(t).toContain('ver_agendamentos_da_cliente antes de responder');
    expect(t).not.toContain('nenhum na agenda');
  });
});

describe('situacoes: a árvore na base e o resumo nas regras', () => {
  it('a base tem a seção "Situações e como agir" com os casos principais', () => {
    const s = secoesDoMarkdown(carregarBase()).find((x) => x.titulo === 'Situações e como agir');
    expect(s).toBeTruthy();
    const c = s!.conteudo;
    for (const caso of ['Já agendada', 'Quer remarcar', 'Quer cancelar', 'Vai atrasar', 'desmarcado pela loja', 'não está na agenda', 'pós-atendimento', 'formol', 'falar com uma pessoa', 'Reclamação', 'Alergia', 'figurinha', '"Obrigada"', 'Some no meio', 'Número errado', 'Currículo', 'Produtos', 'desconto', 'estacionamento', 'outra pessoa', 'outro nome', 'Posso te ajudar em algo mais?']) {
      expect(c, caso).toContain(caso);
    }
    expect(c).toContain('Você já está agendada para');
    expect(c).toContain('10 minutos');
    expect(c).toContain('90 dias');
  });

  it('logo depois vem a seção "Atendimento que encanta e vende"', () => {
    const l = secoesDoMarkdown(carregarBase()).map((x) => x.titulo);
    expect(l[l.indexOf('Situações e como agir') + 1]).toBe('Atendimento que encanta e vende');
  });

  it('as regras citam as situações principais e a regra geral', () => {
    const r = REGRAS_ATENDIMENTO.join(' ');
    for (const t of ['reconheça o que ela disse', 'Posso te ajudar em algo mais?', 'Você já está agendada para', 'não está confirmado', 'horário desmarcado', 'ofereça remarcar', 'tolerância', 'passar_para_humano', '"obrigada"', 'figurinha', 'Número errado', 'sem repetir perguntas', 'para_outra_pessoa=true', 'Situações e como agir']) {
      expect(r, t).toContain(t);
    }
    expect(textoRegrasAtendimento()).toContain('Fim de conversa');
  });
});
