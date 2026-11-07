import { normalizarCelular, partesTrinks } from '../util/telefone.js';
import { MIN, HORA } from '../util/tempo.js';

/**
 * Cliente da API do Trinks (https://api.trinks.com/v1), conforme o OpenAPI público
 * em trinks.readme.io. Autenticação: header X-Api-Key + header estabelecimentoId.
 *
 * Cuidados com a cota (a mesma chave é usada pelo cashback no n8n):
 * - fila única com pausa mínima entre chamadas;
 * - nova tentativa com espera crescente em 429;
 * - cache de serviços/profissionais (horas) e de horários vagos (minutos).
 */

export interface TrinksServico {
  id: number;
  nome: string;
  categoria?: string | null;
  duracaoEmMinutos: number;
  preco: number;
  valorPromocional?: number | null;
  visivelParaCliente?: boolean;
}

export interface TrinksProfissional {
  id: number;
  nome: string;
  apelido?: string | null;
  possuiAgenda?: boolean;
}

export interface TrinksProfissionalComAgenda {
  id: number;
  nome: string | null;
  horariosVagos: string[] | null;
}

export interface TrinksCliente {
  id: number;
  nome: string | null;
  telefones?: Array<{ ddi?: string | null; ddd?: string | null; telefone?: string | null }> | null;
}

export interface TrinksAgendamento {
  id: number;
  status?: { id: number; nome?: string | null };
  servico?: { id?: number; nome?: string | null };
  profissional?: { id?: number; nome?: string | null };
  dataHoraInicio: string;
  duracaoEmMinutos: number;
  valor: number;
}

interface Paginado<T> {
  page: number;
  totalPages: number;
  data: T[] | null;
}

export class ErroTrinks extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export interface OpcoesTrinks {
  apiKey: string;
  baseUrl?: string;
  /** Pausa mínima entre chamadas (ms). */
  intervaloMs?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export class ClienteTrinks {
  private readonly baseUrl: string;
  private readonly intervaloMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly agora: () => number;
  private readonly dormir: (ms: number) => Promise<void>;
  private fila: Promise<unknown> = Promise.resolve();
  private ultimaChamada = 0;
  private readonly cache = new Map<string, { expira: number; valor: unknown }>();
  /** Quantas chamadas reais foram feitas (para o painel de consumo). */
  chamadas = 0;

  constructor(private readonly opcoes: OpcoesTrinks) {
    this.baseUrl = (opcoes.baseUrl ?? 'https://api.trinks.com').replace(/\/$/, '');
    this.intervaloMs = opcoes.intervaloMs ?? 1200;
    this.fetchFn = opcoes.fetchFn ?? fetch;
    this.agora = opcoes.agora ?? Date.now;
    this.dormir = opcoes.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Troca a chave sem reiniciar (tela de Conexões). Limpa o cache, que pode ser de outra conta. */
  definirChave(apiKey: string): void {
    if (this.opcoes.apiKey === apiKey) return;
    this.opcoes.apiKey = apiKey;
    this.cache.clear();
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
    filtros: { servicoId?: number; profissionalId?: number; intervalos?: number } = {},
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
    return r.data ?? [];
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
    dados: {
      clienteId: number;
      servicoId: number;
      profissionalId: number;
      data: string;
      hora: string;
      duracaoEmMinutos: number;
      valor: number;
      observacoes?: string;
    },
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

  // ---------- infraestrutura ----------

  private invalidar(prefixo: string) {
    for (const k of this.cache.keys()) if (k.startsWith(prefixo)) this.cache.delete(k);
  }

  private async emCache<T>(chave: string, ttlMs: number, carregar: () => Promise<T>): Promise<T> {
    const c = this.cache.get(chave);
    if (c && c.expira > this.agora()) return c.valor as T;
    const valor = await carregar();
    this.cache.set(chave, { expira: this.agora() + ttlMs, valor });
    return valor;
  }

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

  /** Toda chamada passa por uma fila única: nunca duas ao mesmo tempo, sempre com pausa entre elas. */
  private pedir<T>(
    estabelecimentoId: string,
    metodo: 'GET' | 'POST' | 'PATCH',
    caminho: string,
    op: { query?: Record<string, string>; corpo?: unknown } = {},
  ): Promise<T> {
    const tarefa = this.fila.then(() => this.executar<T>(estabelecimentoId, metodo, caminho, op));
    this.fila = tarefa.catch(() => undefined);
    return tarefa;
  }

  private async executar<T>(
    estabelecimentoId: string,
    metodo: 'GET' | 'POST' | 'PATCH',
    caminho: string,
    op: { query?: Record<string, string>; corpo?: unknown },
  ): Promise<T> {
    const url = new URL(this.baseUrl + caminho);
    for (const [k, v] of Object.entries(op.query ?? {})) url.searchParams.set(k, v);

    for (let tentativa = 0; ; tentativa++) {
      const espera = this.ultimaChamada + this.intervaloMs - this.agora();
      if (espera > 0) await this.dormir(espera);
      this.ultimaChamada = this.agora();
      this.chamadas++;

      const resp = await this.fetchFn(url, {
        method: metodo,
        headers: {
          'X-Api-Key': this.opcoes.apiKey,
          estabelecimentoId,
          accept: 'application/json',
          ...(op.corpo ? { 'content-type': 'application/json' } : {}),
        },
        body: op.corpo ? JSON.stringify(op.corpo) : undefined,
      });

      if (resp.status === 429 && tentativa < 3) {
        await this.dormir(2000 * 2 ** tentativa);
        continue;
      }
      const texto = await resp.text();
      if (!resp.ok) throw new ErroTrinks(resp.status, `Trinks ${metodo} ${caminho} → ${resp.status}: ${texto.slice(0, 300)}`);
      return (texto ? JSON.parse(texto) : {}) as T;
    }
  }
}
