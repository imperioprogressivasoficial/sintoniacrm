import type pg from 'pg';
import type { UnidadeId } from '../domain.js';
import { unidadeDe, unidadesComAgenda } from '../unidades.js';
import { dataISO, DIA, MIN } from '../util/tempo.js';
import { horaDoSistema } from './agenda-externa.js';
import { agendaDaUnidade } from './agendar.js';
import type { AgendamentoDaAgenda, FonteAgenda, ServicoAgenda } from './sistema.js';

/**
 * serena-regras (item 9): espelho da agenda do sistema do salão (Trinks) por unidade, para os próximos 14 dias.
 *
 * - Guarda os horários livres de cada dia (no serviço padrão da unidade) e tudo o que está marcado no período.
 * - Atualiza em segundo plano, aos poucos: a cada rodada (1 min) só as entradas mais velhas, no máximo `porRodada`
 *   chamadas (os 3 primeiros dias a cada 3 min, os outros a cada 20 min). Assim a cota da API (fila-http.ts, a mesma
 *   chave do cashback) nunca leva mais que umas 4 chamadas por minuto.
 * - Logo depois de cada agendamento ou cancelamento (`sujar`), o dia volta a ser lido na hora.
 * - Fica no banco (sobrevive a reinício; vários processos leem o mesmo) e em memória (resposta imediata).
 * A IA usa o espelho para responder rápido "quais horários livres"; antes de gravar um agendamento, ela confere
 * sempre no sistema de verdade (ferramentas.ts: conferirLivre e o próprio criarAgendamento do Trinks).
 */

export interface VagosProfissional {
  profissionalId: number;
  profissional: string | null;
  horarios: string[];
}

export interface DiaEspelho {
  unidade: UnidadeId;
  data: string;
  servicoId: number;
  vagos: VagosProfissional[];
  atualizadoEm: Date;
}

export interface MarcadosEspelho {
  unidade: UnidadeId;
  inicio: string;
  fim: string;
  agendamentos: AgendamentoDaAgenda[];
  /** Apelido de cada profissional (mesma cor na aba Agenda). */
  apelidos: Record<string, string>;
  atualizadoEm: Date;
}

export interface ArmazemEspelho {
  dias(empresaId: string): Promise<DiaEspelho[]>;
  gravarDia(empresaId: string, d: DiaEspelho): Promise<void>;
  marcados(empresaId: string): Promise<MarcadosEspelho[]>;
  gravarMarcados(empresaId: string, m: MarcadosEspelho): Promise<void>;
  /** Apaga os dias que já passaram. */
  limparAntes(empresaId: string, data: string): Promise<void>;
}

export class ArmazemEspelhoMemoria implements ArmazemEspelho {
  private readonly d = new Map<string, DiaEspelho>();
  private readonly m = new Map<string, MarcadosEspelho>();
  async dias(empresaId: string) {
    return [...this.d.entries()].filter(([k]) => k.startsWith(`${empresaId}|`)).map(([, v]) => structuredClone(v));
  }
  async gravarDia(empresaId: string, d: DiaEspelho) {
    this.d.set(`${empresaId}|${d.unidade}|${d.data}|${d.servicoId}`, structuredClone(d));
  }
  async marcados(empresaId: string) {
    return [...this.m.entries()].filter(([k]) => k.startsWith(`${empresaId}|`)).map(([, v]) => structuredClone(v));
  }
  async gravarMarcados(empresaId: string, m: MarcadosEspelho) {
    this.m.set(`${empresaId}|${m.unidade}`, structuredClone(m));
  }
  async limparAntes(empresaId: string, data: string) {
    for (const [k, v] of this.d) if (k.startsWith(`${empresaId}|`) && v.data < data) this.d.delete(k);
  }
}

export class ArmazemEspelhoPostgres implements ArmazemEspelho {
  constructor(private readonly pool: pg.Pool) {}
  async dias(empresaId: string) {
    const { rows } = await this.pool.query<{ unidade: string; data: string; servico_id: string; vagos: VagosProfissional[]; atualizado_em: Date }>(
      `select unidade, to_char(data, 'YYYY-MM-DD') as data, servico_id, vagos, atualizado_em from sintonia.espelho_agenda_dias where empresa_id = $1`,
      [empresaId],
    );
    return rows.map((r) => ({ unidade: r.unidade, data: r.data, servicoId: Number(r.servico_id), vagos: Array.isArray(r.vagos) ? r.vagos : [], atualizadoEm: r.atualizado_em }));
  }
  async gravarDia(empresaId: string, d: DiaEspelho) {
    await this.pool.query(
      `insert into sintonia.espelho_agenda_dias (empresa_id, unidade, data, servico_id, vagos, atualizado_em) values ($1, $2, $3, $4, $5, $6)
       on conflict (empresa_id, unidade, data, servico_id) do update set vagos = excluded.vagos, atualizado_em = excluded.atualizado_em`,
      [empresaId, d.unidade, d.data, d.servicoId, JSON.stringify(d.vagos), d.atualizadoEm],
    );
  }
  async marcados(empresaId: string) {
    const { rows } = await this.pool.query<{ unidade: string; inicio: string; fim: string; itens: { agendamentos?: AgendamentoDaAgenda[]; apelidos?: Record<string, string> }; atualizado_em: Date }>(
      `select unidade, to_char(inicio, 'YYYY-MM-DD') as inicio, to_char(fim, 'YYYY-MM-DD') as fim, itens, atualizado_em from sintonia.espelho_agenda_marcados where empresa_id = $1`,
      [empresaId],
    );
    return rows.map((r) => ({
      unidade: r.unidade,
      inicio: r.inicio,
      fim: r.fim,
      agendamentos: Array.isArray(r.itens?.agendamentos) ? r.itens.agendamentos : [],
      apelidos: r.itens?.apelidos && typeof r.itens.apelidos === 'object' ? r.itens.apelidos : {},
      atualizadoEm: r.atualizado_em,
    }));
  }
  async gravarMarcados(empresaId: string, m: MarcadosEspelho) {
    await this.pool.query(
      `insert into sintonia.espelho_agenda_marcados (empresa_id, unidade, inicio, fim, itens, atualizado_em) values ($1, $2, $3, $4, $5, $6)
       on conflict (empresa_id, unidade) do update set inicio = excluded.inicio, fim = excluded.fim, itens = excluded.itens, atualizado_em = excluded.atualizado_em`,
      [empresaId, m.unidade, m.inicio, m.fim, JSON.stringify({ agendamentos: m.agendamentos, apelidos: m.apelidos }), m.atualizadoEm],
    );
  }
  async limparAntes(empresaId: string, data: string) {
    await this.pool.query('delete from sintonia.espelho_agenda_dias where empresa_id = $1 and data < $2', [empresaId, data]);
  }
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * tabela-fim (dono 28/11): palavras do serviço em que a IA marca quando a unidade não tem "serviço padrão para agendar"
 * (Empresa › Unidades). Ex.: "Progressiva Espelhada Essencial" (o nome no sistema de agenda pode variar).
 */
export const NOME_SERVICO_PADRAO = 'essencial';

/** O serviço com "Essencial" no nome; vários: o de "progressiva"/"espelhada", depois o de nome mais curto. */
export function servicoPeloNome(servicos: ServicoAgenda[], palavra = NOME_SERVICO_PADRAO): ServicoAgenda | null {
  const alvo = semAcento(palavra);
  const achados = servicos.filter((s) => semAcento(s.nome).includes(alvo));
  const pontos = (s: ServicoAgenda) => (semAcento(s.nome).includes('progressiva') ? 2 : 0) + (semAcento(s.nome).includes('espelhada') ? 1 : 0);
  return achados.sort((a, b) => pontos(b) - pontos(a) || a.nome.length - b.nome.length)[0] ?? null;
}

/**
 * Serviço em que a IA marca na unidade (sem perguntar procedimento à cliente): o "serviço padrão para agendar" do
 * cadastro (Empresa › Unidades); senão o serviço com "Essencial" no nome (tabela-fim); senão um com "avaliação" no
 * nome; senão, se a agenda só tem um, esse. null = a IA precisa escolher pela lista (ver_servicos).
 */
export function servicoParaAgendar(unidade: UnidadeId, servicos: ServicoAgenda[]): ServicoAgenda | null {
  const padrao = unidadeDe(unidade).servicoPadraoId;
  if (padrao) return servicos.find((s) => s.id === padrao) ?? null;
  const visiveis = servicos.filter((s) => s.visivelParaCliente !== false);
  const essencial = servicoPeloNome(visiveis);
  if (essencial) return essencial;
  const avaliacao = visiveis.filter((s) => semAcento(s.nome).includes('avaliac'));
  if (avaliacao.length === 1) return avaliacao[0]!;
  return visiveis.length === 1 ? visiveis[0]! : null;
}

export interface OpcoesEspelho {
  empresaId: string;
  fonte: FonteAgenda;
  armazem: ArmazemEspelho;
  /** Unidades espelhadas (padrão: as que agendam). */
  unidades?: () => UnidadeId[];
  agora?: () => Date;
  /** Quantos dias à frente (padrão 14, contando hoje). */
  dias?: number;
  /** Idade máxima dos 3 primeiros dias e da lista de marcados (padrão 3 min). */
  ttlPertoMs?: number;
  /** Idade máxima dos outros dias (padrão 20 min). */
  ttlLongeMs?: number;
  /** Máximo de leituras por rodada (padrão 4). */
  porRodada?: number;
  log?: (msg: string, detalhe?: string) => void;
}

type Tarefa = { tipo: 'dia'; unidade: UnidadeId; data: string; servicoId: number; idade: number } | { tipo: 'marcados'; unidade: UnidadeId; idade: number };

export class EspelhoAgenda {
  private readonly dias = new Map<string, DiaEspelho>();
  private readonly marc = new Map<string, MarcadosEspelho>();
  /** O que precisa ser relido (valor = vez em que sujou: sujar de novo durante a leitura não se perde). */
  private readonly sujos = new Map<string, number>();
  private vez = 0;
  private readonly agora: () => Date;
  private rodando: Promise<void> | null = null;
  private outraRodada = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Leituras feitas no sistema (testes e painel). */
  leituras = 0;

  constructor(private readonly o: OpcoesEspelho) {
    this.agora = o.agora ?? (() => new Date());
  }

  private chaveDia = (u: string, data: string, servicoId: number) => `${u}|${data}|${servicoId}`;

  /** Lê o que já estava no banco (ao subir). */
  async carregar(): Promise<void> {
    for (const d of await this.o.armazem.dias(this.o.empresaId)) this.dias.set(this.chaveDia(d.unidade, d.data, d.servicoId), d);
    for (const m of await this.o.armazem.marcados(this.o.empresaId)) this.marc.set(m.unidade, m);
  }

  /** Liga a atualização em segundo plano (padrão: a cada minuto). */
  iniciar(intervaloMs = 60_000): void {
    this.parar();
    this.timer = setInterval(() => void this.rodada().catch(() => undefined), intervaloMs);
    (this.timer as { unref?: () => void }).unref?.();
    void this.rodada().catch(() => undefined);
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Datas espelhadas: hoje + os próximos (dias - 1). */
  datas(): string[] {
    const hoje = this.agora();
    return Array.from({ length: this.o.dias ?? 14 }, (_, i) => dataISO(new Date(hoje.getTime() + i * DIA)));
  }

  /**
   * Algo mudou na agenda da unidade (a Sintonia agendou, remarcou ou cancelou): o dia (ou a unidade toda) e a lista de
   * marcados voltam a ser lidos agora, em segundo plano.
   */
  sujar(unidade: UnidadeId, data?: string): void {
    this.sujos.set(`m|${unidade}`, ++this.vez);
    this.sujos.set(data ? `d|${unidade}|${data}` : `d|${unidade}|*`, this.vez);
    void this.rodada().catch(() => undefined);
  }

  /** Horários livres do dia no serviço espelhado, se o espelho está em dia (até `maxIdadeMs`). null = consulte o sistema. */
  vagosDe(unidade: UnidadeId, data: string, servicoId: number, maxIdadeMs = 10 * MIN): VagosProfissional[] | null {
    if (this.sujo(`d|${unidade}|${data}`)) return null;
    const d = this.dias.get(this.chaveDia(unidade, data, servicoId));
    if (!d || this.agora().getTime() - d.atualizadoEm.getTime() > maxIdadeMs) return null;
    return structuredClone(d.vagos);
  }

  /** Tudo que está marcado na unidade entre duas datas (inclusas), se o espelho cobre o período e está em dia. */
  marcadosDe(unidade: UnidadeId, dataInicio: string, dataFim: string, maxIdadeMs = 4 * MIN): { agendamentos: AgendamentoDaAgenda[]; apelidos: Map<number, string> } | null {
    if (this.sujo(`m|${unidade}`)) return null;
    const m = this.marc.get(unidade);
    if (!m || this.agora().getTime() - m.atualizadoEm.getTime() > maxIdadeMs) return null;
    if (dataInicio < m.inicio || dataFim > m.fim) return null;
    const agendamentos = m.agendamentos.filter((a) => {
      const d = horaDoSistema(a.dataHoraInicio);
      if (!d) return false;
      const dia = dataISO(d);
      return dia >= dataInicio && dia <= dataFim;
    });
    return { agendamentos: structuredClone(agendamentos), apelidos: new Map(Object.entries(m.apelidos).map(([k, v]) => [Number(k), v])) };
  }

  private sujo(k: string): boolean {
    if (this.sujos.has(k)) return true;
    const [tipo, u] = k.split('|');
    return tipo === 'd' && this.sujos.has(`d|${u}|*`);
  }

  /** Uma rodada de atualização. Rodadas pedidas enquanto outra corre viram uma só, logo em seguida. */
  rodada(): Promise<void> {
    if (this.rodando) {
      this.outraRodada = true;
      return this.rodando;
    }
    this.rodando = (async () => {
      try {
        do {
          this.outraRodada = false;
          await this.umaRodada();
        } while (this.outraRodada && this.sujos.size);
      } finally {
        this.rodando = null;
      }
    })();
    return this.rodando;
  }

  private unidades(): UnidadeId[] {
    return (this.o.unidades ?? unidadesComAgenda)();
  }

  private async umaRodada(): Promise<void> {
    const agora = this.agora().getTime();
    const datas = this.datas();
    const ttlPerto = this.o.ttlPertoMs ?? 3 * MIN;
    const ttlLonge = this.o.ttlLongeMs ?? 20 * MIN;
    const tarefas: Tarefa[] = [];
    for (const u of this.unidades()) {
      let agenda;
      try {
        agenda = agendaDaUnidade(this.o.fonte, u);
      } catch {
        continue; // unidade sem sistema de agenda conectado
      }
      const m = this.marc.get(u);
      const idadeM = this.sujo(`m|${u}`) ? Number.POSITIVE_INFINITY : m && m.inicio === datas[0] ? agora - m.atualizadoEm.getTime() : Number.POSITIVE_INFINITY;
      if (agenda.sistema.listarAgendamentosDoPeriodo && idadeM > ttlPerto) tarefas.push({ tipo: 'marcados', unidade: u, idade: idadeM });
      let servico: ServicoAgenda | null = null;
      try {
        servico = servicoParaAgendar(u, await agenda.sistema.listarServicos(agenda.local));
      } catch {
        servico = null;
      }
      if (!servico) continue;
      for (const [i, data] of datas.entries()) {
        const d = this.dias.get(this.chaveDia(u, data, servico.id));
        const idade = this.sujo(`d|${u}|${data}`) || !d ? Number.POSITIVE_INFINITY : agora - d.atualizadoEm.getTime();
        if (idade > (i < 3 ? ttlPerto : ttlLonge)) tarefas.push({ tipo: 'dia', unidade: u, data, servicoId: servico.id, idade });
      }
    }
    // As mais velhas primeiro (as sujas e as que nunca foram lidas: idade infinita); entre iguais, os dias mais perto.
    tarefas.sort((a, b) => b.idade - a.idade);
    for (const t of tarefas.slice(0, this.o.porRodada ?? 4)) {
      try {
        if (t.tipo === 'dia') await this.lerDia(t.unidade, t.data, t.servicoId);
        else await this.lerMarcados(t.unidade, datas[0]!, datas.at(-1)!);
      } catch (e) {
        this.o.log?.(`Espelho da agenda: falha ao ler ${t.tipo === 'dia' ? `${t.unidade} ${t.data}` : `marcados de ${t.unidade}`}`, String(e));
      }
    }
    // Dias que passaram saem da memória e do banco.
    for (const [k, d] of this.dias) if (d.data < datas[0]!) this.dias.delete(k);
    await this.o.armazem.limparAntes(this.o.empresaId, datas[0]!).catch(() => undefined);
  }

  private async lerDia(unidade: UnidadeId, data: string, servicoId: number): Promise<void> {
    const { sistema, local } = agendaDaUnidade(this.o.fonte, unidade);
    const k = `d|${unidade}|${data}`;
    const marca = this.sujos.get(k);
    const marcaTudo = this.sujos.get(`d|${unidade}|*`);
    this.leituras++;
    const lista = await sistema.horariosVagos(local, data, { servicoId });
    if (this.sujos.get(k) === marca) this.sujos.delete(k);
    const d: DiaEspelho = {
      unidade,
      data,
      servicoId,
      vagos: lista.map((p) => ({ profissionalId: p.id, profissional: p.nome, horarios: [...(p.horariosVagos ?? [])] })),
      atualizadoEm: this.agora(),
    };
    this.dias.set(this.chaveDia(unidade, data, servicoId), d);
    // Unidade inteira suja: some só depois de reler o último dia pendente.
    if (marcaTudo !== undefined && this.sujos.get(`d|${unidade}|*`) === marcaTudo && data === this.datas().at(-1)) this.sujos.delete(`d|${unidade}|*`);
    await this.o.armazem.gravarDia(this.o.empresaId, d).catch((e) => this.o.log?.('Espelho da agenda: falha ao gravar', String(e)));
  }

  private async lerMarcados(unidade: UnidadeId, inicio: string, fim: string): Promise<void> {
    const { sistema, local } = agendaDaUnidade(this.o.fonte, unidade);
    if (!sistema.listarAgendamentosDoPeriodo) return;
    const marca = this.sujos.get(`m|${unidade}`);
    this.leituras++;
    const agendamentos = await sistema.listarAgendamentosDoPeriodo(local, inicio, fim);
    if (this.sujos.get(`m|${unidade}`) === marca) this.sujos.delete(`m|${unidade}`);
    const apelidos: Record<string, string> = {};
    try {
      for (const p of await sistema.listarProfissionais(local)) apelidos[String(p.id)] = p.apelido || p.nome;
    } catch {
      /* sem a lista, fica o nome que veio no agendamento */
    }
    const m: MarcadosEspelho = { unidade, inicio, fim, agendamentos, apelidos, atualizadoEm: this.agora() };
    this.marc.set(unidade, m);
    await this.o.armazem.gravarMarcados(this.o.empresaId, m).catch((e) => this.o.log?.('Espelho da agenda: falha ao gravar', String(e)));
  }
}

// ---------------------------------------------------------------- espelho em uso no servidor

let ativo: EspelhoAgenda | null = null;
/** O index liga o espelho ao subir (testes ligam e desligam). */
export function definirEspelho(e: EspelhoAgenda | null): void {
  ativo = e;
}
export const espelhoAtivo = (): EspelhoAgenda | null => ativo;
