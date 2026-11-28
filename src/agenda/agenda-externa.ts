import type pg from 'pg';
import type { Conversa, UnidadeId } from '../domain.js';
import { normalizarCelular } from '../util/telefone.js';
import { bahia, MIN } from '../util/tempo.js';
import type { ItemAgenda } from './agenda-dia.js';
import { ErroIntegracaoPendente, NOMES_SISTEMA, type AgendamentoDaAgenda, type RoteadorAgenda, type TipoSistemaAgenda } from './sistema.js';

/**
 * A agenda do sistema do salão (Trinks; Avec e AppBarber quando houver API) na aba Agenda, junto com o que a
 * Sintonia marcou. Assim aparece também o que a recepção marca direto no sistema.
 *
 * - Cache por unidade + período de 1 minuto (a tela confere a cada 20 s): nunca mais de uma chamada por minuto
 *   para a mesma unidade e período, nem quando várias pessoas estão com a agenda aberta. Falha também fica guardada
 *   1 minuto, para não insistir numa API fora do ar.
 * - Espera no máximo `esperaMs`; se o sistema demorar, a tela recebe só o da Sintonia e um aviso. A chamada segue
 *   e, quando volta, fica no cache para a próxima conferida.
 */

export type FonteAgenda = 'sintonia' | TipoSistemaAgenda;

/** Um horário vindo do sistema, já no formato da tela. */
export interface ItemExterno {
  fonte: TipoSistemaAgenda;
  /** ID do agendamento no sistema. */
  sistemaId: number;
  unidade: UnidadeId;
  cliente: string | null;
  clienteId: number | null;
  telefone: string | null;
  servico: string | null;
  profissional: string | null;
  inicio: Date;
  duracaoMin: number;
  cancelado: boolean;
}

export interface ResultadoExterno {
  itens: ItemExterno[];
  /** Texto curto para a tela quando o sistema não respondeu. */
  aviso?: string;
}

type Guardado = { expira: number; promessa: Promise<{ itens: ItemExterno[] } | { erro: string }> };

export interface OpcoesAgendaExterna {
  roteador: RoteadorAgenda;
  /** Prazo do cache (padrão 60 s). */
  ttlMs?: number;
  /** Quanto a tela espera o sistema antes de seguir sem ele (padrão 8 s). */
  esperaMs?: number;
  agora?: () => number;
  log?: (msg: string, detalhe?: string) => void;
  /**
   * serena-regras (item 9): o espelho da agenda (src/agenda/espelho.ts). Quando cobre o período e está em dia, a aba
   * responde dele na hora, sem chamar o sistema. null = consulte o sistema.
   */
  espelho?: () => { marcadosDe(unidade: UnidadeId, dataInicio: string, dataFim: string): { agendamentos: AgendamentoDaAgenda[]; apelidos: Map<number, string> } | null } | null;
}

/** "2026-11-10T10:00:00" sem fuso é a hora do salão (Bahia); com fuso, vale o fuso. */
export function horaDoSistema(texto: string | null | undefined): Date | null {
  if (!texto) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(texto.trim());
  if (m) return bahia(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!);
  const t = Date.parse(texto);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Primeiro celular que dá para reconhecer na cliente devolvida pelo sistema. */
export function telefoneDaCliente(c: AgendamentoDaAgenda['cliente']): string | null {
  if (!c) return null;
  const solto = c as unknown as Record<string, unknown>;
  for (const t of c.telefones ?? []) {
    const extra = t as unknown as Record<string, unknown>;
    const n = normalizarCelular(`${t.ddi ?? ''}${t.ddd ?? ''}${t.telefone ?? extra.numero ?? ''}`) ?? normalizarCelular(`${t.ddd ?? ''}${t.telefone ?? extra.numero ?? ''}`);
    if (n) return n;
  }
  for (const k of ['celular', 'telefone', 'telefoneCelular']) {
    const n = typeof solto[k] === 'string' ? normalizarCelular(solto[k] as string) : null;
    if (n) return n;
  }
  return null;
}

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Converte um agendamento do sistema no item da tela. Devolve null se faltar o horário. */
export function paraItemExterno(a: AgendamentoDaAgenda, fonte: TipoSistemaAgenda, unidade: UnidadeId, apelidos?: Map<number, string>): ItemExterno | null {
  const inicio = horaDoSistema(a.dataHoraInicio);
  if (!inicio) return null;
  const profId = a.profissional?.id;
  return {
    fonte,
    sistemaId: a.id,
    unidade,
    cliente: texto(a.cliente?.nome),
    clienteId: typeof a.cliente?.id === 'number' ? a.cliente.id : null,
    telefone: telefoneDaCliente(a.cliente),
    servico: texto(a.servico?.nome),
    // A Sintonia guarda o apelido da profissional: usando o mesmo nome, a cor na tela é a mesma.
    profissional: (typeof profId === 'number' ? apelidos?.get(profId) : undefined) ?? texto(a.profissional?.nome),
    inicio,
    duracaoMin: typeof a.duracaoEmMinutos === 'number' && a.duracaoEmMinutos > 0 ? a.duracaoEmMinutos : 60,
    // Status 9 = cancelado no Trinks (o adaptador já marca; aqui vale também para quem não passou por ele).
    cancelado: Boolean(a.cancelado) || (fonte === 'trinks' && a.status?.id === 9),
  };
}

export class AgendaExterna {
  private readonly cache = new Map<string, Guardado>();
  private readonly ttlMs: number;
  private readonly esperaMs: number;
  private readonly agora: () => number;
  /** Chamadas reais ao sistema (testes e painel). */
  chamadas = 0;

  constructor(private readonly o: OpcoesAgendaExterna) {
    this.ttlMs = o.ttlMs ?? 60_000;
    this.esperaMs = o.esperaMs ?? 8_000;
    this.agora = o.agora ?? Date.now;
  }

  /** Horários do sistema da unidade entre duas datas (AAAA-MM-DD, inclusas). Nunca lança erro. */
  async daUnidade(unidade: UnidadeId, dataInicio: string, dataFim: string): Promise<ResultadoExterno> {
    let agenda;
    try {
      agenda = this.o.roteador.paraUnidade(unidade);
    } catch {
      return { itens: [] }; // unidade sem sistema de agenda (ou sem chave): só a Sintonia
    }
    const { sistema, tipo, local } = agenda;
    const nome = NOMES_SISTEMA[tipo];
    if (!sistema.listarAgendamentosDoPeriodo) return { itens: [] };
    const doEspelho = this.o.espelho?.()?.marcadosDe(unidade, dataInicio, dataFim);
    if (doEspelho) {
      return { itens: doEspelho.agendamentos.map((a) => paraItemExterno(a, tipo, unidade, doEspelho.apelidos)).filter((i): i is ItemExterno => Boolean(i)) };
    }

    const chave = `${unidade}:${tipo}:${local}:${dataInicio}:${dataFim}`;
    for (const [k, g] of this.cache) if (g.expira <= this.agora()) this.cache.delete(k);
    let g = this.cache.get(chave);
    if (!g) {
      this.chamadas++;
      const novo: Guardado = { expira: Number.POSITIVE_INFINITY, promessa: Promise.resolve({ itens: [] }) };
      novo.promessa = (async () => {
        try {
          const lista = await sistema.listarAgendamentosDoPeriodo!(local, dataInicio, dataFim);
          const apelidos = new Map<number, string>();
          try {
            for (const p of await sistema.listarProfissionais(local)) apelidos.set(p.id, p.apelido || p.nome);
          } catch {
            /* sem a lista, fica o nome que veio no agendamento */
          }
          return { itens: lista.map((a) => paraItemExterno(a, tipo, unidade, apelidos)).filter((i): i is ItemExterno => Boolean(i)) };
        } catch (e) {
          if (e instanceof ErroIntegracaoPendente) {
            return { erro: `A agenda da ${nome} ainda não mostra aqui o que é marcado direto lá.` };
          }
          this.o.log?.(`Agenda: o ${nome} não respondeu (${unidade})`, String(e));
          return { erro: `O ${nome} não respondeu agora. Mostrando só o que foi marcado pela Sintonia.` };
        } finally {
          novo.expira = this.agora() + this.ttlMs;
        }
      })();
      g = novo;
      this.cache.set(chave, g);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const demorou = new Promise<'demorou'>((r) => {
      timer = setTimeout(() => r('demorou'), this.esperaMs);
    });
    const r = await Promise.race([g.promessa, demorou]);
    clearTimeout(timer);
    if (r === 'demorou') return { itens: [], aviso: `O ${nome} está demorando para responder. Mostrando só o que foi marcado pela Sintonia.` };
    return 'erro' in r ? { itens: [], aviso: r.erro } : { itens: r.itens };
  }

  /** Várias unidades de uma vez; os avisos repetidos viram um só. */
  async dasUnidades(unidades: UnidadeId[], dataInicio: string, dataFim: string): Promise<ResultadoExterno> {
    const rs = await Promise.all(unidades.map((u) => this.daUnidade(u, dataInicio, dataFim)));
    const avisos = [...new Set(rs.map((r) => r.aviso).filter((a): a is string => Boolean(a)))];
    return { itens: rs.flatMap((r) => r.itens), ...(avisos.length ? { aviso: avisos.join(' ') } : {}) };
  }
}

// ------------------------------------------------------------ juntar com a Sintonia

/** O que a tela recebe: o item da Sintonia (ou o do sistema) com a origem marcada. */
export interface ItemAgendaTela {
  id: string;
  trinksId: number | null;
  conversaId: string | null;
  cliente: string | null;
  telefone: string;
  unidade: UnidadeId;
  servico: string | null;
  profissional: string | null;
  inicio: Date;
  fim: Date;
  duracaoMin: number;
  por: string;
  porIa: boolean;
  marcadoEm: Date | null;
  fonte: FonteAgenda;
  podeAbrir: boolean;
}

type ConversaMin = Pick<Conversa, 'id' | 'telefone' | 'unidade' | 'atualizadaEm'> & Partial<Pick<Conversa, 'trinksClienteId' | 'nome'>>;

/** Mesmo id que a Sintonia dá ao horário marcado por ela (`t` + id no sistema), para casar com as confirmações. */
export const idExterno = (i: Pick<ItemExterno, 'fonte' | 'sistemaId'>) => (i.fonte === 'trinks' ? `t${i.sistemaId}` : `${i.fonte}:${i.sistemaId}`);

/**
 * Junta os horários da Sintonia com os do sistema.
 * - O mesmo agendamento (mesma unidade e mesmo id no sistema) aparece uma vez, como da Sintonia (abre a conversa).
 *   Se no sistema ele foi cancelado, sai da agenda.
 * - Cancelados no sistema não entram.
 * - Os só do sistema procuram a conversa pelo id da cliente no Trinks e pelo celular; sem conversa, ficam com o
 *   nome que veio do sistema e sem abrir.
 */
export function mesclarAgenda(
  sintonia: ItemAgenda[],
  externos: ItemExterno[],
  conversaDe: (i: ItemExterno) => ConversaMin | undefined,
  podeAbrir: (conversaId: string) => boolean,
): ItemAgendaTela[] {
  const doSistema = new Map<string, ItemExterno>();
  for (const e of externos) doSistema.set(`${e.unidade}:${e.sistemaId}`, e);
  const usados = new Set<string>();
  const saida: ItemAgendaTela[] = [];
  for (const i of sintonia) {
    const k = i.trinksId != null ? `${i.unidade}:${i.trinksId}` : null;
    const e = k ? doSistema.get(k) : undefined;
    if (k && e) usados.add(k);
    if (e?.cancelado) continue;
    saida.push({ ...i, fim: new Date(i.inicio.getTime() + i.duracaoMin * MIN), fonte: 'sintonia', podeAbrir: podeAbrir(i.conversaId) });
  }
  for (const [k, e] of doSistema) {
    if (usados.has(k) || e.cancelado) continue;
    const c = conversaDe(e);
    saida.push({
      id: idExterno(e),
      trinksId: e.fonte === 'trinks' ? e.sistemaId : null,
      conversaId: c?.id ?? null,
      cliente: e.cliente ?? c?.nome ?? null,
      telefone: c?.telefone ?? e.telefone ?? '',
      unidade: e.unidade,
      servico: e.servico,
      profissional: e.profissional,
      inicio: e.inicio,
      fim: new Date(e.inicio.getTime() + e.duracaoMin * MIN),
      duracaoMin: e.duracaoMin,
      por: NOMES_SISTEMA[e.fonte],
      porIa: false,
      marcadoEm: null,
      fonte: e.fonte,
      podeAbrir: Boolean(c && podeAbrir(c.id)),
    });
  }
  return saida.sort((a, b) => a.inicio.getTime() - b.inicio.getTime() || (a.cliente ?? '').localeCompare(b.cliente ?? '', 'pt-BR'));
}

/**
 * Procura as conversas das clientes que vieram do sistema: pelo id da cliente no Trinks (guardado quando a Sintonia
 * agenda) e pelo celular. Com várias, prefere a da mesma unidade e, depois, a mais recente.
 */
export async function conversasDasClientes(
  fonte: { pool?: pg.Pool; listarConversas(): Promise<Conversa[]> },
  empresaId: string,
  externos: ItemExterno[],
): Promise<(i: ItemExterno) => ConversaMin | undefined> {
  const telefones = [...new Set(externos.map((e) => e.telefone).filter((t): t is string => Boolean(t)))];
  const clientes = [...new Set(externos.filter((e) => e.fonte === 'trinks' && e.clienteId != null).map((e) => e.clienteId!))];
  let lista: ConversaMin[] = [];
  if (telefones.length || clientes.length) {
    if (fonte.pool) {
      const { rows } = await fonte.pool.query<{ id: string; telefone: string; unidade: string; atualizada_em: Date; trinks_cliente_id: number | null; nome: string | null }>(
        `select id, telefone, unidade, atualizada_em, trinks_cliente_id, nome from sintonia.conversas
          where empresa_id = $1 and (telefone = any($2::text[]) or trinks_cliente_id = any($3::bigint[]))`,
        [empresaId, telefones, clientes],
      );
      lista = rows.map((r) => ({
        id: r.id,
        telefone: r.telefone,
        unidade: r.unidade as UnidadeId,
        atualizadaEm: r.atualizada_em,
        trinksClienteId: r.trinks_cliente_id ?? undefined,
        nome: r.nome ?? undefined,
      }));
    } else {
      const tel = new Set(telefones);
      const cli = new Set(clientes);
      lista = (await fonte.listarConversas()).filter(
        (c) => c.empresaId === empresaId && (tel.has(c.telefone) || (c.trinksClienteId != null && cli.has(c.trinksClienteId))),
      );
    }
  }
  const melhor = (cs: ConversaMin[], unidade: UnidadeId) =>
    [...cs].sort((a, b) => Number(b.unidade === unidade) - Number(a.unidade === unidade) || b.atualizadaEm.getTime() - a.atualizadaEm.getTime())[0];
  return (e) => {
    if (e.fonte === 'trinks' && e.clienteId != null) {
      const c = melhor(lista.filter((x) => x.trinksClienteId === e.clienteId), e.unidade);
      if (c) return c;
    }
    return e.telefone ? melhor(lista.filter((x) => x.telefone === e.telefone), e.unidade) : undefined;
  };
}
