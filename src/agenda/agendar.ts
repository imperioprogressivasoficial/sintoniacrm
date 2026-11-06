import type { Agendamento, Conversa, UnidadeId } from '../domain.js';
import type { Agenda } from '../ai/ferramentas.js';
import { ErroTrinks } from './trinks.js';
import { UNIDADES } from '../unidades.js';
import { deDataEHora, dataISO, DIA, horaHHmm } from '../util/tempo.js';

/**
 * Um único caminho para marcar horário no Trinks, usado tanto pela IA quanto pelo
 * botão "Agendar" do CRM. Assim as regras (cliente certa, preço do Trinks,
 * conferência de conflito) são sempre as mesmas, não importa quem agendou.
 */

export interface PedidoAgendamento {
  unidade: UnidadeId;
  servicoId: number;
  profissionalId: number;
  data: string; // AAAA-MM-DD
  hora: string; // HH:mm
  /** Usado só se a cliente ainda não tiver cadastro no Trinks. */
  nomeCliente: string;
  /** Quem agendou, gravado na observação do Trinks. */
  origem: string;
}

export interface ResultadoAgendamento {
  agendamento: Agendamento;
  clienteTrinksId: number;
  valor: number;
}

export class ErroAgendamento extends Error {
  constructor(
    readonly codigo: 'sem_agenda' | 'servico' | 'horario_ocupado' | 'data_passada',
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export function estabelecimentoDa(unidade: UnidadeId): string {
  const u = UNIDADES[unidade];
  if (!u.agendaAberta || !u.trinksEstabelecimentoId) {
    throw new ErroAgendamento('sem_agenda', `A unidade ${u.nome} ainda não tem agenda no Trinks.`);
  }
  return u.trinksEstabelecimentoId;
}

export async function agendarNoTrinks(
  agenda: Agenda,
  conversa: Conversa,
  p: PedidoAgendamento,
  agora: Date,
): Promise<ResultadoAgendamento> {
  const est = estabelecimentoDa(p.unidade);
  const hora = p.hora.padStart(5, '0');
  const inicio = deDataEHora(p.data, hora);
  if (inicio.getTime() <= agora.getTime()) {
    throw new ErroAgendamento('data_passada', 'Esse horário já passou.');
  }

  const servico = (await agenda.listarServicos(est)).find((s) => s.id === p.servicoId);
  if (!servico) throw new ErroAgendamento('servico', 'Serviço não encontrado no Trinks.');
  const profissional = (await agenda.listarProfissionais(est)).find((x) => x.id === p.profissionalId);

  let clienteId =
    conversa.trinksClienteId ?? (await agenda.buscarClientePorTelefone(est, conversa.telefone))?.id;
  if (!clienteId) clienteId = await agenda.criarCliente(est, p.nomeCliente, conversa.telefone);

  const valor = servico.valorPromocional ?? servico.preco;
  try {
    const trinksId = await agenda.criarAgendamento(est, {
      clienteId,
      servicoId: servico.id,
      profissionalId: p.profissionalId,
      data: p.data,
      hora,
      duracaoEmMinutos: servico.duracaoEmMinutos,
      valor,
      observacoes: `Agendado por ${p.origem} (Sintonia)`,
    });
    return {
      clienteTrinksId: clienteId,
      valor,
      agendamento: {
        trinksId,
        unidade: p.unidade,
        servico: servico.nome,
        profissional: profissional?.apelido || profissional?.nome,
        inicio,
        duracaoMin: servico.duracaoEmMinutos,
      },
    };
  } catch (e) {
    if (e instanceof ErroTrinks && e.status === 409) {
      throw new ErroAgendamento('horario_ocupado', `O horário ${hora} de ${p.data} acabou de ser ocupado. Escolha outro.`);
    }
    throw e;
  }
}

/** Horários livres de um dia, já sem os que passaram (o Trinks devolve os de hoje que já foram). */
export async function horariosLivres(
  agenda: Agenda,
  unidade: UnidadeId,
  data: string,
  servicoId: number,
  profissionalId: number | undefined,
  agora: Date,
): Promise<Array<{ profissionalId: number; profissional: string | null; horarios: string[] }>> {
  if (data < dataISO(agora)) return [];
  if (data > dataISO(new Date(agora.getTime() + 120 * DIA))) return [];
  const est = estabelecimentoDa(unidade);
  const lista = await agenda.horariosVagos(est, data, { servicoId, profissionalId });
  const limite = agora.getTime() + 30 * 60_000;
  return lista
    .map((p) => ({
      profissionalId: p.id,
      profissional: p.nome,
      horarios: (p.horariosVagos ?? []).filter((h) => deDataEHora(data, h).getTime() > limite),
    }))
    .filter((p) => p.horarios.length > 0);
}

/** Mensagem de confirmação padrão que a atendente pode mandar ao agendar pelo botão. */
export function textoConfirmacao(nome: string | undefined, r: ResultadoAgendamento): string {
  const a = r.agendamento;
  const dia = dataISO(a.inicio).split('-').reverse().slice(0, 2).join('/');
  const hora = horaHHmm(a.inicio);
  const com = a.profissional ? ` com ${a.profissional}` : '';
  const primeiro = nome?.split(' ')[0];
  return `${primeiro ? `Prontinho, ${primeiro}! ` : 'Prontinho! '}Seu horário está confirmado: ${a.servico}, dia ${dia} às ${hora}${com}, no ${UNIDADES[a.unidade].nome}. Te mando um lembrete na véspera.`;
}
