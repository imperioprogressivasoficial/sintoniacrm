import { normalizarCelular, partesTrinks } from '../util/telefone.js';
import { MIN, HORA } from '../util/tempo.js';
import { ClienteHttpFila, type MetodoHttp } from './fila-http.js';
import {
  ErroAgenda,
  type AgendamentoDoSistema,
  type ClienteAgenda,
  type DadosNovoAgendamento,
  type FiltrosHorarios,
  type ProfissionalAgenda,
  type ProfissionalComHorarios,
  type ServicoAgenda,
  type SistemaAgenda,
} from './sistema.js';

/**
 * Cliente da API do Trinks (https://api.trinks.com/v1), conforme o OpenAPI público
 * em trinks.readme.io. Autenticação: header X-Api-Key + header estabelecimentoId.
 *
 * Cuidados com a cota (a mesma chave é usada pelo cashback no n8n):
 * - fila única com pausa mínima entre chamadas;
 * - nova tentativa com espera crescente em 429;
 * - cache de serviços/profissionais (horas) e de horários vagos (minutos).
 */

export type TrinksServico = ServicoAgenda;
export type TrinksProfissional = ProfissionalAgenda;
export type TrinksProfissionalComAgenda = ProfissionalComHorarios;
export type TrinksCliente = ClienteAgenda;
export type TrinksAgendamento = AgendamentoDoSistema;

interface Paginado<T> {
  page: number;
  totalPages: number;
  data: T[] | null;
}

export class ErroTrinks extends ErroAgenda {}

export interface OpcoesTrinks {
  apiKey: string;
  baseUrl?: string;
  /** Pausa mínima entre chamadas (ms). */
  intervaloMs?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export class ClienteTrinks extends ClienteHttpFila implements SistemaAgenda {
  readonly sistema = 'trinks' as const;
  protected readonly rotulo = 'Trinks';

  constructor(private readonly opcoes: OpcoesTrinks) {
    super({ ...opcoes, baseUrl: opcoes.baseUrl ?? 'https://api.trinks.com' });
  }

  protected erroHttp(status: number, mensagem: string): Error {
    return new ErroTrinks(status, mensagem);
  }

  /** Troca a chave sem reiniciar (tela de Conexões). Limpa o cache, que pode ser de outra conta. */
  definirChave(apiKey: string): void {
    if (this.opcoes.apiKey === apiKey) return;
    this.opcoes.apiKey = apiKey;
    this.limparCache();
  }

  // ---------- leitura (com cache) ----------

  async listarServicos(estabelecimentoId: string): Promise<TrinksServico[]> {
    return this.emCache(`servicos:${estabelecimentoId}`, 6 * HORA, () =>
      this.todasAsPaginas<TrinksServico>(estabelecimentoId, '/v1/servicos', { pageSize: '50' }),
    );
  }

  async listarProfissionais(estabelecimentoId: string): Promise<TrinksProfissional[]> {
    return this.emCache(`profissionais:${estabelecimentoId}`, 6 * HORA, () =>
      this.todasAsPaginas<TrinksProfissional>(estabelecimentoId, '/v1/profissionais', { pageSize: '50' }),
    );
  }

  /**
   * Horários vagos do dia por profissional. O Trinks já calcula onde cabe a duração do serviço.
   * Cache curto: o suficiente para várias clientes perguntando o mesmo dia não gastarem cota.
   */
  async horariosVagos(
    estabelecimentoId: string,
    data: string,
    filtros: FiltrosHorarios = {},
  ): Promise<TrinksProfissionalComAgenda[]> {
    const query: Record<string, string> = {};
    if (filtros.servicoId) query.servicoId = String(filtros.servicoId);
    if (filtros.profissionalId) query.profissionalId = String(filtros.profissionalId);
    query.intervalos = String(filtros.intervalos ?? 30);
    const chave = `vagos:${estabelecimentoId}:${data}:${JSON.stringify(query)}`;
    return this.emCache(chave, 5 * MIN, () =>
      this.todasAsPaginas<TrinksProfissionalComAgenda>(
        estabelecimentoId,
        `/v1/agendamentos/profissionais/${encodeURIComponent(data)}`,
        query,
        'page',
      ),
    );
  }

  /** Busca a cliente pelo celular. Confere o número exato, porque o Trinks busca por trecho. */
  async buscarClientePorTelefone(estabelecimentoId: string, telefone: string): Promise<TrinksCliente | null> {
    const alvo = normalizarCelular(telefone);
    if (!alvo) return null;
    const r = await this.pedir<Paginado<TrinksCliente>>(estabelecimentoId, 'GET', '/v1/clientes', {
      query: { Telefone: alvo.slice(2), PageSize: '50' },
    });
    for (const c of r.data ?? []) {
      for (const t of c.telefones ?? []) {
        const n = normalizarCelular(`${t.ddi ?? ''}${t.ddd ?? ''}${t.telefone ?? ''}`);
        if (n === alvo) return c;
      }
    }
    return null;
  }

  async listarAgendamentosDoCliente(
    estabelecimentoId: string,
    clienteId: number,
    dataInicio?: string,
    dataFim?: string,
  ): Promise<TrinksAgendamento[]> {
    const query: Record<string, string> = { clienteId: String(clienteId), pageSize: '50' };
    if (dataInicio) query.dataInicio = dataInicio;
    if (dataFim) query.dataFim = dataFim;
    const r = await this.pedir<Paginado<TrinksAgendamento>>(estabelecimentoId, 'GET', '/v1/agendamentos', { query });
    // Status 9 = cancelado no Trinks.
    return (r.data ?? []).map((a) => ({ ...a, cancelado: a.status?.id === 9 }));
  }

  // ---------- escrita ----------

  async criarCliente(estabelecimentoId: string, nome: string, telefone: string): Promise<number> {
    const tel = normalizarCelular(telefone);
    if (!tel) throw new Error(`Telefone inválido para cadastro: ${telefone}`);
    const p = partesTrinks(tel);
    const r = await this.pedir<{ id: number }>(estabelecimentoId, 'POST', '/v1/clientes', {
      corpo: { nome, telefones: [{ ddi: p.ddi, ddd: p.ddd, numero: p.numero, tipoId: 6 }] },
    });
    return r.id;
  }

  /**
   * Cria o agendamento. Atenção (regra do Trinks): a API NÃO confere conflito de horário.
   * Por isso sempre reconsultamos os horários vagos sem cache antes de gravar.
   */
  async criarAgendamento(
    estabelecimentoId: string,
    dados: DadosNovoAgendamento,
  ): Promise<number> {
    this.invalidar(`vagos:${estabelecimentoId}:${dados.data}:`);
    const agenda = await this.horariosVagos(estabelecimentoId, dados.data, {
      servicoId: dados.servicoId,
      profissionalId: dados.profissionalId,
    });
    const prof = agenda.find((p) => p.id === dados.profissionalId);
    if (!prof?.horariosVagos?.includes(dados.hora)) {
      throw new ErroTrinks(409, `O horário ${dados.hora} de ${dados.data} não está mais livre.`);
    }
    const r = await this.pedir<{ id: number }>(estabelecimentoId, 'POST', '/v1/agendamentos', {
      corpo: {
        clienteId: dados.clienteId,
        servicoId: dados.servicoId,
        profissionalId: dados.profissionalId,
        dataHoraInicio: `${dados.data}T${dados.hora}:00`,
        duracaoEmMinutos: dados.duracaoEmMinutos,
        valor: dados.valor,
        observacoes: dados.observacoes,
        confirmado: true,
      },
    });
    this.invalidar(`vagos:${estabelecimentoId}:${dados.data}:`);
    return r.id;
  }

  /** Cancela no Trinks (PATCH /v1/agendamentos/{id}/status/cancelado) e libera o cache de horários. */
  async cancelarAgendamento(estabelecimentoId: string, agendamentoId: number): Promise<void> {
    await this.pedir(estabelecimentoId, 'PATCH', `/v1/agendamentos/${agendamentoId}/status/cancelado`);
    this.invalidar(`vagos:${estabelecimentoId}:`);
  }

  async testar(estabelecimentoId: string): Promise<string> {
    return `${(await this.listarProfissionais(estabelecimentoId)).length} profissionais`;
  }

  // ---------- infraestrutura ----------

  private async todasAsPaginas<T>(
    estabelecimentoId: string,
    caminho: string,
    query: Record<string, string>,
    nomePagina = 'page',
  ): Promise<T[]> {
    const itens: T[] = [];
    for (let pagina = 1; pagina <= 20; pagina++) {
      const r = await this.pedir<Paginado<T>>(estabelecimentoId, 'GET', caminho, {
        query: { ...query, [nomePagina]: String(pagina) },
      });
      itens.push(...(r.data ?? []));
      if (pagina >= (r.totalPages ?? 1)) break;
    }
    return itens;
  }

  private pedir<T>(
    estabelecimentoId: string,
    metodo: MetodoHttp,
    caminho: string,
    op: { query?: Record<string, string>; corpo?: unknown } = {},
  ): Promise<T> {
    return this.enfileirar<T>(metodo, caminho, { ...op, cabecalhos: { 'X-Api-Key': this.opcoes.apiKey, estabelecimentoId } });
  }
}
