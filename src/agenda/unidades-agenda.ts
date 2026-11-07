import type { UnidadeId } from '../domain.js';
import { UNIDADES } from '../unidades.js';
import { ErroAgendamento } from './agendar.js';
import { AgendaAppBarber } from './appbarber.js';
import { AgendaAvec } from './avec.js';
import { NOMES_SISTEMA, type AgendaDaUnidade, type EscolhaAgenda, type RoteadorAgenda, type SistemaAgenda, type TipoSistemaAgenda } from './sistema.js';
import type { ClienteTrinks } from './trinks.js';

/**
 * Escolha do sistema de agenda POR UNIDADE (Conexões › Agenda) e o roteador que a IA, o Agendar e
 * as rotas usam. Sem escolha salva a unidade fica no Trinks, como sempre foi.
 */

export const UNIDADES_AGENDA = ['norte', 'sumare'] as const;
export type UnidadeAgenda = (typeof UNIDADES_AGENDA)[number];
const SUFIXO: Record<UnidadeAgenda, 'Norte' | 'Sumare'> = { norte: 'Norte', sumare: 'Sumare' };

/** Nomes dos campos de Conexões de cada unidade. */
export const camposAgenda = (u: UnidadeAgenda) => ({
  sistema: `agendaSistema${SUFIXO[u]}`,
  trinksEstabelecimento: `trinksEstabelecimento${SUFIXO[u]}`,
  avecToken: `avecToken${SUFIXO[u]}`,
  avecUnidade: `avecUnidade${SUFIXO[u]}`,
  appbarberToken: `appbarberToken${SUFIXO[u]}`,
  appbarberLoja: `appbarberLoja${SUFIXO[u]}`,
}) as const;

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

export function escolhaDe(valor: string | undefined): EscolhaAgenda {
  return valor === 'avec' || valor === 'appbarber' || valor === 'nenhum' || valor === 'trinks' ? valor : 'trinks';
}

const ehUnidadeAgenda = (u: string): u is UnidadeAgenda => (UNIDADES_AGENDA as readonly string[]).includes(u);

/** Configuração da agenda de uma unidade, lida das Conexões (ler = conexoes.get). */
export function configAgendaDa(ler: Ler, u: UnidadeAgenda): ConfigAgendaUnidade {
  const c = camposAgenda(u);
  const escolha = escolhaDe(ler(c.sistema));
  const nome = UNIDADES[u].nome;
  const falta: string[] = [];
  let local: string | null = null;
  if (escolha === 'trinks') {
    // O estabelecimento em uso: o da tela, senão o padrão de src/unidades.ts (o index aplica um sobre o outro).
    local = ler(c.trinksEstabelecimento) || UNIDADES[u].trinksEstabelecimentoId;
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
    return UNIDADES_AGENDA.map((u) => this.config(u));
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
    const u = UNIDADES[unidade];
    if (!ehUnidadeAgenda(unidade) || !u?.agendaAberta) {
      throw new ErroAgendamento('sem_agenda', `A unidade ${u?.nome ?? unidade} ainda não tem agenda.`);
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
