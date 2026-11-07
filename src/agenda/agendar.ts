import type { Agendamento, Conversa, UnidadeId } from '../domain.js';
import { ehRoteador, ErroAgenda, NOMES_SISTEMA, type AgendaDaUnidade, type FonteAgenda } from './sistema.js';
import { UNIDADES } from '../unidades.js';
import { deDataEHora, dataISO, DIA, horaHHmm } from '../util/tempo.js';

/**
 * Um único caminho para marcar horário no sistema de agenda da unidade (Trinks, Avec ou AppBarber),
 * usado tanto pela IA quanto pelo botão "Agendar" do CRM. Assim as regras (cliente certa, preço do
 * sistema, conferência de conflito) são sempre as mesmas, não importa quem agendou.
 */

export interface PedidoAgendamento {
  unidade: UnidadeId;
  servicoId: number;
  profissionalId: number;
  data: string; // AAAA-MM-DD
  hora: string; // HH:mm
  /** Usado só se a cliente ainda não tiver cadastro no sistema de agenda. */
  nomeCliente: string;
  /** Quem agendou, gravado na observação do agendamento. */
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

/**
 * Sistema e local (estabelecimento/loja) da unidade. Com um roteador, vale a escolha de Conexões › Agenda;
 * com um sistema só (jeito antigo e testes), é o Trinks com o estabelecimento de src/unidades.ts.
 */
export function agendaDaUnidade(fonte: FonteAgenda, unidade: UnidadeId): AgendaDaUnidade {
  if (ehRoteador(fonte)) return fonte.paraUnidade(unidade);
  return { sistema: fonte, tipo: fonte.sistema ?? 'trinks', local: estabelecimentoDa(unidade) };
}

export async function agendar(
  fonte: FonteAgenda,
  conversa: Conversa,
  p: PedidoAgendamento,
  agora: Date,
): Promise<ResultadoAgendamento> {
  const { sistema: agenda, tipo, local: est } = agendaDaUnidade(fonte, p.unidade);
  const nomeSistema = NOMES_SISTEMA[tipo];
  const hora = p.hora.padStart(5, '0');
  const inicio = deDataEHora(p.data, hora);
  if (inicio.getTime() <= agora.getTime()) {
    throw new ErroAgendamento('data_passada', 'Esse horário já passou.');
  }

  const servico = (await agenda.listarServicos(est)).find((s) => s.id === p.servicoId);
  if (!servico) throw new ErroAgendamento('servico', `Serviço não encontrado no ${nomeSistema}.`);
  const profissional = (await agenda.listarProfissionais(est)).find((x) => x.id === p.profissionalId);

  // O id guardado na conversa é do Trinks: em outro sistema, a cliente é procurada pelo telefone.
  let clienteId =
    (tipo === 'trinks' ? conversa.trinksClienteId : undefined) ?? (await agenda.buscarClientePorTelefone(est, conversa.telefone))?.id;
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
    if (e instanceof ErroAgenda && e.status === 409) {
      throw new ErroAgendamento('horario_ocupado', `O horário ${hora} de ${p.data} acabou de ser ocupado. Escolha outro.`);
    }
    throw e;
  }
}

/** Nome antigo, mantido para quem já importa. */
export const agendarNoTrinks = agendar;

/** Horários livres de um dia, já sem os que passaram (o Trinks devolve os de hoje que já foram). */
export async function horariosLivres(
  fonte: FonteAgenda,
  unidade: UnidadeId,
  data: string,
  servicoId: number,
  profissionalId: number | undefined,
  agora: Date,
): Promise<Array<{ profissionalId: number; profissional: string | null; horarios: string[] }>> {
  if (data < dataISO(agora)) return [];
  if (data > dataISO(new Date(agora.getTime() + 120 * DIA))) return [];
  const { sistema, local } = agendaDaUnidade(fonte, unidade);
  const lista = await sistema.horariosVagos(local, data, { servicoId, profissionalId });
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
