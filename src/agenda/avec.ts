import { HORA } from '../util/tempo.js';
import { ClienteHttpFila } from './fila-http.js';
import {
  ErroAgenda,
  ErroIntegracaoPendente,
  type AgendamentoDoSistema,
  type ClienteAgenda,
  type DadosNovoAgendamento,
  type ProfissionalAgenda,
  type ProfissionalComHorarios,
  type ServicoAgenda,
  type SistemaAgenda,
} from './sistema.js';

/**
 * Avec (avec.app / Avec Salão). Ver docs/AGENDAS.md.
 *
 * O que a Avec documenta em público (doc.api.avec.beauty) é só a API de RELATÓRIOS, de leitura:
 *   GET {base}/reports/{código}?page=1&limit=250&inicio=dd/mm/aaaa&fim=dd/mm/aaaa
 *   header Authorization: {token}   (o token é gerado no painel da Avec, por unidade)
 * A URL base na documentação é um exemplo ("prod.your-api-server.com"), então ela vem da tela de Conexões.
 *
 * Não há, na documentação pública, catálogo de serviços/profissionais com duração e preço, horários livres,
 * cadastro de cliente nem criar/cancelar agendamento. Essas partes respondem com erro claro até a Avec
 * mandar a documentação de parceiro; a fila, o cache e a autenticação já estão prontos para recebê-las.
 */

export class ErroAvec extends ErroAgenda {}

export interface OpcoesAvec {
  token: string;
  /** URL base da API (a documentação pública só mostra um endereço de exemplo). */
  baseUrl?: string;
  intervaloMs?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

/** Datas no formato que os relatórios da Avec pedem (dd/mm/aaaa). */
export const dataAvec = (iso: string) => iso.split('-').reverse().join('/');

export class AgendaAvec extends ClienteHttpFila implements SistemaAgenda {
  readonly sistema = 'avec' as const;
  protected readonly rotulo = 'Avec';
  private readonly temUrl: boolean;

  constructor(private readonly opcoes: OpcoesAvec) {
    super({ ...opcoes, baseUrl: opcoes.baseUrl || 'https://avec.invalid' });
    this.temUrl = Boolean(opcoes.baseUrl);
  }

  protected erroHttp(status: number, mensagem: string): Error {
    return new ErroAvec(status, mensagem);
  }

  /**
   * Lê um relatório (confirmado na documentação: rota, paginação até 250 e o header Authorization).
   * O formato do corpo da resposta NÃO está documentado: aceitamos uma lista direta ou { data: [...] }.
   */
  async relatorio(codigo: string, parametros: Record<string, string> = {}, maxPaginas = 20): Promise<unknown[]> {
    if (!this.temUrl) throw new ErroIntegracaoPendente('avec', 'falta a URL base da API em Conexões › Agenda');
    if (!this.opcoes.token) throw new ErroIntegracaoPendente('avec', 'falta o token da API');
    return this.emCache(`rel:${codigo}:${JSON.stringify(parametros)}:${maxPaginas}`, HORA, async () => {
      const itens: unknown[] = [];
      for (let pagina = 1; pagina <= maxPaginas; pagina++) {
        const r = await this.enfileirar<unknown>('GET', `/reports/${encodeURIComponent(codigo)}`, {
          query: { page: String(pagina), limit: '250', ...parametros },
          cabecalhos: { Authorization: this.opcoes.token },
        });
        const lista = Array.isArray(r) ? r : Array.isArray((r as { data?: unknown }).data) ? (r as { data: unknown[] }).data : [];
        itens.push(...lista);
        if (lista.length < 250) break;
      }
      return itens;
    });
  }

  /** Lê o relatório 0001 (aniversariantes de hoje), que existe em toda conta: confere URL e token. */
  async testar(): Promise<string> {
    const hoje = dataAvec(new Date(this.agora()).toISOString().slice(0, 10));
    const lista = await this.relatorio('0001', { inicio: hoje, fim: hoje }, 1);
    return `Avec respondendo (relatório de aniversariantes: ${lista.length} hoje). Agendar pela Sintonia ainda depende da documentação de agendamento da Avec.`;
  }

  async listarServicos(): Promise<ServicoAgenda[]> {
    throw new ErroIntegracaoPendente('avec', 'catálogo de serviços com duração e preço');
  }
  async listarProfissionais(): Promise<ProfissionalAgenda[]> {
    throw new ErroIntegracaoPendente('avec', 'lista de profissionais');
  }
  async horariosVagos(): Promise<ProfissionalComHorarios[]> {
    throw new ErroIntegracaoPendente('avec', 'horários livres');
  }
  async buscarClientePorTelefone(): Promise<ClienteAgenda | null> {
    throw new ErroIntegracaoPendente('avec', 'busca de cliente por telefone');
  }
  async criarCliente(): Promise<number> {
    throw new ErroIntegracaoPendente('avec', 'cadastro de cliente');
  }
  async criarAgendamento(_local: string, _dados: DadosNovoAgendamento): Promise<number> {
    throw new ErroIntegracaoPendente('avec', 'criar agendamento');
  }
  async cancelarAgendamento(): Promise<void> {
    throw new ErroIntegracaoPendente('avec', 'cancelar agendamento');
  }
  async listarAgendamentosDoCliente(): Promise<AgendamentoDoSistema[]> {
    throw new ErroIntegracaoPendente('avec', 'agendamentos da cliente');
  }
}
