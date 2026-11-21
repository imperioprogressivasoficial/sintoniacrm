import type { UnidadeId } from '../domain.js';
import { campoDaUnidade } from '../conexoes/conexoes.js';
import { EMPRESA_IMPERIO, empresaPadraoDasUnidades, existeUnidade, idsUnidades, nomeUnidade, UNIDADES_IMPERIO } from '../unidades.js';
import { ErroAgendamento } from './agendar.js';
import { AgendaAppBarber } from './appbarber.js';
import { AgendaAvec } from './avec.js';
import { NOMES_SISTEMA, type AgendaDaUnidade, type EscolhaAgenda, type RoteadorAgenda, type SistemaAgenda, type TipoSistemaAgenda } from './sistema.js';
import type { ClienteTrinks } from './trinks.js';

/**
 * Escolha do sistema de agenda POR UNIDADE (Conexões › Agenda) e o roteador que a IA, o Agendar e
 * as rotas usam. Sem escolha salva a unidade fica no Trinks, como sempre foi.
 */

/** Unidades que aparecem em Conexões › Agenda: as ativas do cadastro (Empresa › Unidades). */
export const unidadesAgenda = (): UnidadeId[] => idsUnidades();
export type UnidadeAgenda = UnidadeId;

/** Nomes dos campos de Conexões de cada unidade. */
export const camposAgenda = (u: UnidadeAgenda) => ({
  sistema: campoDaUnidade('agendaSistema', u),
  trinksEstabelecimento: campoDaUnidade('trinksEstabelecimento', u),
  avecToken: campoDaUnidade('avecToken', u),
  avecUnidade: campoDaUnidade('avecUnidade', u),
  appbarberToken: campoDaUnidade('appbarberToken', u),
  appbarberLoja: campoDaUnidade('appbarberLoja', u),
});

/**
 * Sem escolha salva: as unidades que já agendavam pelo Trinks antes do cadastro (as da Império com
 * estabelecimento conhecido) continuam no Trinks; unidade nova começa sem sistema de agenda ("nenhum").
 */
/** Estabelecimento do Trinks que a unidade já usava antes da tela de Conexões (só as da Império). */
export const estabelecimentoLegado = (u: string): string | null =>
  empresaPadraoDasUnidades() === EMPRESA_IMPERIO ? (UNIDADES_IMPERIO.find((x) => x.id === u)?.trinks ?? null) : null;

const padraoDa = (u: UnidadeAgenda): EscolhaAgenda => (estabelecimentoLegado(u) ? 'trinks' : 'nenhum');

/** Até onde cada adaptador vai hoje: só o Trinks lista, consulta horários e agenda de verdade. */
export const AGENDA_COMPLETA: Record<TipoSistemaAgenda, boolean> = { trinks: true, avec: false, appbarber: false };

export interface ConfigAgendaUnidade {
  unidade: UnidadeAgenda;
  nome: string;
  escolha: EscolhaAgenda;
  sistemaNome: string | null;
  /** Estabelecimento (Trinks), unidade (Avec) ou loja (AppBarber). */
  local: string | null;
  /** O que falta preencher na tela. */
  falta: string[];
  /** Tem o que a tela pede (credenciais e IDs). */
  conectada: boolean;
  /** Conectada E o adaptador já agenda (hoje só o Trinks). */
  pronta: boolean;
  /** Aviso quando conectada mas a integração ainda depende do fornecedor. */
  aviso: string | null;
}

type Ler = (campo: string) => string | undefined;

export function escolhaDe(valor: string | undefined, padrao: EscolhaAgenda = 'trinks'): EscolhaAgenda {
  return valor === 'avec' || valor === 'appbarber' || valor === 'nenhum' || valor === 'trinks' ? valor : padrao;
}

const ehUnidadeAgenda = (u: string): u is UnidadeAgenda => existeUnidade(u);

/** Configuração da agenda de uma unidade, lida das Conexões (ler = conexoes.get). */
export function configAgendaDa(ler: Ler, u: UnidadeAgenda): ConfigAgendaUnidade {
  const c = camposAgenda(u);
  const escolha = escolhaDe(ler(c.sistema), padraoDa(u));
  // Só o nome do cadastro: unidadeDe() pergunta a agenda para cá (index), e daria volta.
  const nome = nomeUnidade(u);
  const falta: string[] = [];
  let local: string | null = null;
  if (escolha === 'trinks') {
    // O estabelecimento em uso: o da tela, senão o que a unidade já usava antes (src/unidades.ts).
    local = ler(c.trinksEstabelecimento) || estabelecimentoLegado(u);
    if (!ler('trinksApiKey')) falta.push('Chave da API do Trinks');
    if (!local) falta.push(`ID do estabelecimento no Trinks (${nome})`);
  } else if (escolha === 'avec') {
    local = ler(c.avecUnidade) || u;
    if (!ler(c.avecToken)) falta.push(`Token da API da Avec (${nome})`);
    if (!ler('avecUrl')) falta.push('URL base da API da Avec');
  } else if (escolha === 'appbarber') {
    local = ler(c.appbarberLoja) || null;
    if (!ler(c.appbarberToken)) falta.push(`Token do AppBarber (${nome})`);
    if (!local) falta.push(`ID da loja no AppBarber (${nome})`);
  }
  const conectada = escolha !== 'nenhum' && falta.length === 0;
  const tipo = escolha === 'nenhum' ? null : escolha;
  const completa = tipo ? AGENDA_COMPLETA[tipo] : false;
  const aviso =
    tipo && !completa
      ? `Integração aguardando credenciais/documentação da ${NOMES_SISTEMA[tipo]}: o Agendar e a IA ainda não marcam horário por ela.`
      : null;
  return {
    unidade: u,
    nome,
    escolha,
    sistemaNome: tipo ? NOMES_SISTEMA[tipo] : null,
    local,
    falta,
    conectada,
    pronta: conectada && completa,
    aviso,
  };
}

export interface OpcoesRoteador {
  ler: Ler;
  trinks: ClienteTrinks;
  fetchFn?: typeof fetch;
  intervaloMs?: number;
}

/** Roteador: cada unidade no sistema escolhido. Adaptadores Avec/AppBarber são guardados por token (fila e cache por conta). */
export class AgendasDasUnidades implements RoteadorAgenda {
  private readonly adaptadores = new Map<string, SistemaAgenda>();

  constructor(private readonly o: OpcoesRoteador) {}

  config(u: UnidadeAgenda): ConfigAgendaUnidade {
    return configAgendaDa(this.o.ler, u);
  }

  configs(): ConfigAgendaUnidade[] {
    return unidadesAgenda().map((u) => this.config(u));
  }

  /** Alguma unidade agenda de verdade? */
  algumaPronta(): boolean {
    return this.configs().some((c) => c.pronta);
  }

  /** O sistema de uma unidade, mesmo sem tudo preenchido (para o "Testar" da tela). */
  sistemaDa(u: UnidadeAgenda): SistemaAgenda | null {
    const cfg = this.config(u);
    const c = camposAgenda(u);
    if (cfg.escolha === 'nenhum') return null;
    if (cfg.escolha === 'trinks') return this.o.trinks;
    const token = this.o.ler(cfg.escolha === 'avec' ? c.avecToken : c.appbarberToken) ?? '';
    const url = this.o.ler(cfg.escolha === 'avec' ? 'avecUrl' : 'appbarberUrl');
    const chave = `${cfg.escolha}:${url ?? ''}:${token}`;
    let a = this.adaptadores.get(chave);
    if (!a) {
      const op = { token, baseUrl: url, fetchFn: this.o.fetchFn, intervaloMs: this.o.intervaloMs };
      a = cfg.escolha === 'avec' ? new AgendaAvec(op) : new AgendaAppBarber(op);
      this.adaptadores.set(chave, a);
    }
    return a;
  }

  paraUnidade(unidade: UnidadeId): AgendaDaUnidade {
    const u = { nome: nomeUnidade(unidade) };
    if (!ehUnidadeAgenda(unidade)) {
      throw new ErroAgendamento('sem_agenda', `A unidade ${u.nome} ainda não tem agenda.`);
    }
    const cfg = this.config(unidade);
    if (cfg.escolha === 'nenhum') {
      throw new ErroAgendamento('sem_agenda', `A unidade ${cfg.nome} não usa sistema de agenda (Conexões › Agenda).`);
    }
    if (cfg.falta.length) {
      throw new ErroAgendamento('sem_agenda', `A agenda (${cfg.sistemaNome}) de ${cfg.nome} ainda não está conectada: falta ${cfg.falta.join(', ')}.`);
    }
    return { sistema: this.sistemaDa(unidade)!, tipo: cfg.escolha, local: cfg.local! };
  }
}
