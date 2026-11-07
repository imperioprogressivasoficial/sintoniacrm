import type { UnidadeId } from '../domain.js';

/**
 * Interface comum dos sistemas de agenda dos salões (Trinks, Avec, AppBarber).
 *
 * Tudo recebe primeiro o `local`: o ID do estabelecimento (Trinks), da unidade (Avec) ou da loja (AppBarber).
 * Os formatos seguem os do Trinks, que foi o primeiro integrado: cada adaptador converte o que a API dele devolve.
 * IDs são numéricos (o Trinks e os relatórios da Avec usam números; quando a documentação do AppBarber
 * chegar, se os IDs forem texto, o adaptador mantém um mapa).
 */

export type TipoSistemaAgenda = 'trinks' | 'avec' | 'appbarber';
/** O que a unidade escolheu em Conexões › Agenda. */
export type EscolhaAgenda = TipoSistemaAgenda | 'nenhum';

export const SISTEMAS_AGENDA: readonly TipoSistemaAgenda[] = ['trinks', 'avec', 'appbarber'];
export const NOMES_SISTEMA: Record<TipoSistemaAgenda, string> = { trinks: 'Trinks', avec: 'Avec', appbarber: 'AppBarber' };

export interface ServicoAgenda {
  id: number;
  nome: string;
  categoria?: string | null;
  duracaoEmMinutos: number;
  preco: number;
  valorPromocional?: number | null;
  visivelParaCliente?: boolean;
}

export interface ProfissionalAgenda {
  id: number;
  nome: string;
  apelido?: string | null;
  possuiAgenda?: boolean;
}

export interface ProfissionalComHorarios {
  id: number;
  nome: string | null;
  /** "HH:mm" em que o serviço cabe. */
  horariosVagos: string[] | null;
}

export interface ClienteAgenda {
  id: number;
  nome: string | null;
  telefones?: Array<{ ddi?: string | null; ddd?: string | null; telefone?: string | null }> | null;
}

export interface AgendamentoDoSistema {
  id: number;
  status?: { id: number; nome?: string | null };
  /** Cancelado no sistema (cada adaptador traduz o status dele). */
  cancelado?: boolean;
  servico?: { id?: number; nome?: string | null };
  profissional?: { id?: number; nome?: string | null };
  dataHoraInicio: string;
  duracaoEmMinutos: number;
  valor: number;
}

export type DadosNovoAgendamento = {
  clienteId: number;
  servicoId: number;
  profissionalId: number;
  data: string; // AAAA-MM-DD
  hora: string; // HH:mm
  duracaoEmMinutos: number;
  valor: number;
  observacoes?: string;
};

export interface FiltrosHorarios {
  servicoId?: number;
  profissionalId?: number;
  /** De quantos em quantos minutos (Trinks: 30). */
  intervalos?: number;
}

export interface SistemaAgenda {
  readonly sistema: TipoSistemaAgenda;
  listarServicos(local: string): Promise<ServicoAgenda[]>;
  listarProfissionais(local: string): Promise<ProfissionalAgenda[]>;
  horariosVagos(local: string, data: string, filtros?: FiltrosHorarios): Promise<ProfissionalComHorarios[]>;
  buscarClientePorTelefone(local: string, telefone: string): Promise<ClienteAgenda | null>;
  criarCliente(local: string, nome: string, telefone: string): Promise<number>;
  /** Grava o agendamento. Deve recusar (ErroAgenda 409) horário que não está mais livre. */
  criarAgendamento(local: string, dados: DadosNovoAgendamento): Promise<number>;
  cancelarAgendamento(local: string, agendamentoId: number): Promise<void>;
  listarAgendamentosDoCliente(local: string, clienteId: number, dataInicio?: string, dataFim?: string): Promise<AgendamentoDoSistema[]>;
  /** Chamada barata para a tela de Conexões: devolve um resumo ("12 profissionais"). */
  testar(local: string): Promise<string>;
}

/**
 * O mínimo que o agendar e a IA usam. Os testes montam objetos assim (sem cancelar/testar);
 * os adaptadores de verdade implementam a SistemaAgenda inteira.
 */
export type AgendaBasica = Pick<
  SistemaAgenda,
  | 'listarServicos'
  | 'listarProfissionais'
  | 'horariosVagos'
  | 'buscarClientePorTelefone'
  | 'criarCliente'
  | 'criarAgendamento'
  | 'listarAgendamentosDoCliente'
> &
  Partial<Pick<SistemaAgenda, 'sistema' | 'cancelarAgendamento' | 'testar'>>;

/** O sistema e o local que valem para uma unidade. */
export interface AgendaDaUnidade {
  sistema: AgendaBasica;
  tipo: TipoSistemaAgenda;
  local: string;
}

/** Escolhe o sistema de agenda de cada unidade (Conexões › Agenda). */
export interface RoteadorAgenda {
  paraUnidade(unidade: UnidadeId): AgendaDaUnidade;
}

/** O que o agendar, a IA e as rotas recebem: um roteador por unidade ou, no jeito antigo, um sistema só (Trinks). */
export type FonteAgenda = AgendaBasica | RoteadorAgenda;

export const ehRoteador = (f: FonteAgenda): f is RoteadorAgenda => typeof (f as RoteadorAgenda).paraUnidade === 'function';

/** Erro de qualquer sistema de agenda. status 409 = horário ocupado; 501 = integração ainda não disponível. */
export class ErroAgenda extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** A parte da integração que ainda depende da documentação ou das credenciais do fornecedor. */
export class ErroIntegracaoPendente extends ErroAgenda {
  constructor(
    readonly tipo: TipoSistemaAgenda,
    oQue?: string,
  ) {
    super(501, `Integração aguardando credenciais/documentação da ${NOMES_SISTEMA[tipo]}${oQue ? ` (${oQue})` : ''}.`);
  }
}
