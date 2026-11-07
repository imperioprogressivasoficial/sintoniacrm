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
 * AppBarber (appbarber.com.br). Ver docs/AGENDAS.md.
 *
 * O AppBarber NÃO tem API pública documentada (nem portal de desenvolvedor, nem webhooks descritos no site).
 * Este adaptador já tem a fila, o cache e o lugar do token e do ID da loja; cada método responde com
 * erro claro até a documentação chegar. Quando chegar: preencher os métodos usando this.enfileirar(...)
 * e this.emCache(...), como no ClienteTrinks, e trocar os testes de "pendente" pelos de verdade.
 */

export class ErroAppBarber extends ErroAgenda {}

export interface OpcoesAppBarber {
  token: string;
  /** URL base da API, quando o AppBarber informar. */
  baseUrl?: string;
  intervaloMs?: number;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
}

export class AgendaAppBarber extends ClienteHttpFila implements SistemaAgenda {
  readonly sistema = 'appbarber' as const;
  protected readonly rotulo = 'AppBarber';

  constructor(protected readonly opcoes: OpcoesAppBarber) {
    super({ ...opcoes, baseUrl: opcoes.baseUrl || 'https://appbarber.invalid' });
  }

  protected erroHttp(status: number, mensagem: string): Error {
    return new ErroAppBarber(status, mensagem);
  }

  private pendente(oQue: string): never {
    throw new ErroIntegracaoPendente('appbarber', oQue);
  }

  async testar(): Promise<string> {
    if (!this.opcoes.token) this.pendente('falta o token da API');
    return this.pendente('o AppBarber não publica API; peça a documentação de integração ao comercial');
  }
  async listarServicos(): Promise<ServicoAgenda[]> {
    return this.pendente('lista de serviços');
  }
  async listarProfissionais(): Promise<ProfissionalAgenda[]> {
    return this.pendente('lista de profissionais');
  }
  async horariosVagos(): Promise<ProfissionalComHorarios[]> {
    return this.pendente('horários livres');
  }
  async buscarClientePorTelefone(): Promise<ClienteAgenda | null> {
    return this.pendente('busca de cliente por telefone');
  }
  async criarCliente(): Promise<number> {
    return this.pendente('cadastro de cliente');
  }
  async criarAgendamento(_local: string, _dados: DadosNovoAgendamento): Promise<number> {
    return this.pendente('criar agendamento');
  }
  async cancelarAgendamento(): Promise<void> {
    return this.pendente('cancelar agendamento');
  }
  async listarAgendamentosDoCliente(): Promise<AgendamentoDoSistema[]> {
    return this.pendente('agendamentos da cliente');
  }
}
