import type pg from 'pg';
import { z } from 'zod';
import type { Conversa, Etapa } from '../domain.js';
import type { RegrasMotor } from '../engine/etapas.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import type { Tag } from '../tags/tags.js';
import { type DiaSemana, unidadeDe } from '../unidades.js';
import { MIN, minutosDoDia, partesBahia } from '../util/tempo.js';
import type { Funis } from './funis.js';

/**
 * funil-atendimento (dono 28/11): regras automáticas do funil "Atendimento". O sistema (e a IA) move o lead sozinho:
 *   - lead novo chega → Novo lead (fixo: é a etapa de entrada); quem estava em Perdido/Finalizado e volta a escrever → Novo lead;
 *   - a loja (IA ou equipe) respondeu → Em atendimento;
 *   - a cliente pediu para remarcar / não vai conseguir ir / cancelou / faltou → Reagendar;
 *   - a loja respondeu e a cliente não responde há X min → Sem resposta (ela responde → Em atendimento);
 *   - agendou ou remarcou → Agendado <unidade do horário>;
 *   - passou o fim do horário agendado (+ X min) → Finalizado (o pós-venda começa aqui: chave 'compareceu');
 *   - Perdido continua com a equipe ou a IA, sempre com motivo.
 * E o alerta "lead parado em Novo lead": sem resposta da loja há N min, avisa a equipe.
 *
 * Cada regra liga/desliga e tem o tempo editável em Pipeline › Regras automáticas (GET/PUT /api/funis/regras).
 * Mover à mão sempre vence: as regras de tempo não mexem em quem a equipe moveu depois do momento que elas contam.
 * As regras de evento (mensagem, resposta, agenda) estão no motor (src/engine/etapas.ts, lidas por `regrasMotor`);
 * as de tempo e o alerta rodam aqui, no relógio (`tick`).
 */

const Ligada = z.object({ ligado: z.boolean() });
export const EsquemaRegrasFunil = z.object({
  voltouEscrever: Ligada,
  lojaRespondeu: Ligada,
  remarcar: Ligada.extend({ tag: z.string().trim().min(1).max(30) }),
  semResposta: Ligada.extend({ minutos: z.number().int().min(5).max(30 * 24 * 60) }),
  agendou: Ligada,
  finalizado: Ligada.extend({ minutos: z.number().int().min(0).max(24 * 60) }),
  alertaEntrada: Ligada.extend({ minutos: z.number().int().min(1).max(24 * 60), soNoHorario: z.boolean() }),
});
export type RegrasFunilCfg = z.infer<typeof EsquemaRegrasFunil>;

/** Já nascem preenchidas e ligadas (a Império e toda empresa nova). */
export const REGRAS_FUNIL_PADRAO: RegrasFunilCfg = {
  voltouEscrever: { ligado: true },
  lojaRespondeu: { ligado: true },
  remarcar: { ligado: true, tag: 'Quer remarcar' },
  semResposta: { ligado: true, minutos: 60 },
  agendou: { ligado: true },
  finalizado: { ligado: true, minutos: 30 },
  alertaEntrada: { ligado: true, minutos: 10, soNoHorario: true },
};

/** Junta o que está gravado (pode ser antigo ou parcial) com o padrão; o que não passar na validação volta ao padrão. */
export function normalizarRegrasFunil(bruto: unknown): RegrasFunilCfg {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const r = { ...REGRAS_FUNIL_PADRAO } as Record<string, unknown>;
  for (const k of Object.keys(REGRAS_FUNIL_PADRAO) as Array<keyof RegrasFunilCfg>) {
    const v = b[k];
    if (!v || typeof v !== 'object') continue;
    const junto = { ...REGRAS_FUNIL_PADRAO[k], ...(v as object) };
    const ok = EsquemaRegrasFunil.shape[k].safeParse(junto);
    if (ok.success) r[k] = ok.data;
  }
  return r as RegrasFunilCfg;
}

export const regrasDoMotor = (c: RegrasFunilCfg): RegrasMotor => ({
  voltouEscrever: c.voltouEscrever.ligado,
  lojaRespondeu: c.lojaRespondeu.ligado,
  remarcar: c.remarcar.ligado,
  agendou: c.agendou.ligado,
});

export class ErroRegrasFunil extends Error {
  constructor(
    message: string,
    readonly statusCode: 400,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------- armazém

export interface ArmazemRegrasFunil {
  ler(empresaId: string): Promise<{ config: unknown; atualizadoPor: string | null; atualizadoEm: Date | null } | null>;
  gravar(empresaId: string, config: RegrasFunilCfg, por: string, em: Date): Promise<void>;
}

export class ArmazemRegrasFunilMemoria implements ArmazemRegrasFunil {
  private readonly dados = new Map<string, { config: unknown; atualizadoPor: string | null; atualizadoEm: Date | null }>();
  async ler(empresaId: string) {
    const d = this.dados.get(empresaId);
    return d ? { ...d, config: structuredClone(d.config) } : null;
  }
  async gravar(empresaId: string, config: RegrasFunilCfg, por: string, em: Date) {
    this.dados.set(empresaId, { config: structuredClone(config), atualizadoPor: por, atualizadoEm: em });
  }
}

export class ArmazemRegrasFunilPostgres implements ArmazemRegrasFunil {
  constructor(private readonly pool: pg.Pool) {}
  async ler(empresaId: string) {
    const { rows } = await this.pool.query<{ config: unknown; atualizado_por: string | null; atualizado_em: Date | null }>(
      'select config, atualizado_por, atualizado_em from sintonia.funil_regras where empresa_id = $1',
      [empresaId],
    );
    return rows[0] ? { config: rows[0].config, atualizadoPor: rows[0].atualizado_por, atualizadoEm: rows[0].atualizado_em } : null;
  }
  async gravar(empresaId: string, config: RegrasFunilCfg, por: string, em: Date) {
    await this.pool.query(
      `insert into sintonia.funil_regras (empresa_id, config, atualizado_por, atualizado_em) values ($1, $2, $3, $4)
       on conflict (empresa_id) do update set config = excluded.config, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em`,
      [empresaId, JSON.stringify(config), por, em],
    );
  }
}

// ---------------------------------------------------------------- quem as regras de tempo procuram

/** Candidatos das regras de tempo (o serviço confere de novo sob a trava antes de mover). */
export interface FonteRegrasFunil {
  /** Em atendimento, a loja falou por último e a 1ª mensagem da loja depois da última da cliente é de antes de `antes`. */
  semResposta(empresaId: string, antes: Date, limite: number): Promise<Array<{ conversaId: string; desde: Date }>>;
  /** Agendado cujo horário (o último marcado) terminou antes de `antes`. */
  horarioPassou(empresaId: string, antes: Date, limite: number, desde?: Date): Promise<Array<{ conversaId: string; fim: Date }>>;
  /** Em Novo lead, a cliente escreveu entre `desde` e `antes` e a loja ainda não respondeu; sem alerta para essa mensagem. */
  paradas(empresaId: string, desde: Date, antes: Date, limite: number): Promise<Array<{ conversaId: string; desde: Date }>>;
}

const ultimaLoja = (c: Conversa) => Math.max(c.ultimaMensagemIa?.getTime() ?? 0, c.ultimaMensagemEquipe?.getTime() ?? 0);
const MANUAL = (e: Evento) => e.tipo === 'etapa_mudou' && e.dados?.motivo === 'manual';

/** Fonte em memória (testes e servidor sem banco): varre as conversas. */
export class FonteRegrasFunilMemoria implements FonteRegrasFunil {
  constructor(private readonly repo: Repositorio) {}
  private async eventos(c: Conversa) {
    return (await this.repo.eventosEntre(new Date(0), new Date(8.64e15))).filter((e) => e.conversaId === c.id);
  }
  async semResposta(empresaId: string, antes: Date, limite: number) {
    const r: Array<{ conversaId: string; desde: Date }> = [];
    for (const c of await this.repo.listarConversas({ empresaId })) {
      if (r.length >= limite) break;
      if (c.etapa !== 'em_conversa' || c.arquivadaEm) continue;
      const cli = c.ultimaMensagemCliente?.getTime() ?? -Infinity;
      if (!(ultimaLoja(c) >= cli)) continue;
      const loja = (await this.repo.mensagens(c.id, 500)).filter((m) => (m.autor === 'ia' || m.autor === 'equipe') && m.em.getTime() >= cli);
      const ref = loja.reduce<Date | undefined>((m, x) => (!m || x.em < m ? x.em : m), undefined);
      if (!ref || ref.getTime() > antes.getTime()) continue;
      if ((await this.eventos(c)).some((e) => MANUAL(e) && e.em.getTime() >= ref.getTime())) continue;
      r.push({ conversaId: c.id, desde: ref });
    }
    return r;
  }
  async horarioPassou(empresaId: string, antes: Date, limite: number, desde?: Date) {
    const r: Array<{ conversaId: string; fim: Date }> = [];
    for (const c of await this.repo.listarConversas({ empresaId })) {
      if (r.length >= limite) break;
      if (c.etapa !== 'agendada' || c.arquivadaEm) continue;
      const evs = await this.eventos(c);
      // O último marcado (no mesmo instante, o registrado por último: ex.: o remarcado).
      const ag = evs.filter((e) => (e.tipo === 'agendamento_ia' || e.tipo === 'agendamento_equipe') && typeof e.dados?.inicio === 'string').reduce<Evento | undefined>((m, e) => (!m || e.em.getTime() >= m.em.getTime() ? e : m), undefined);
      if (!ag) continue;
      const fim = new Date(new Date(String(ag.dados!.inicio)).getTime() + (Number(ag.dados!.duracaoMin) || 60) * MIN);
      if (!(fim.getTime() <= antes.getTime())) continue;
      if (desde && fim.getTime() < desde.getTime()) continue;
      if (evs.some((e) => MANUAL(e) && e.em.getTime() >= fim.getTime())) continue;
      r.push({ conversaId: c.id, fim });
    }
    return r;
  }
  async paradas(empresaId: string, desde: Date, antes: Date, limite: number) {
    const r: Array<{ conversaId: string; desde: Date }> = [];
    for (const c of await this.repo.listarConversas({ empresaId })) {
      if (r.length >= limite) break;
      if ((c.etapa !== 'entrada' && c.etapa !== 'novo_lead') || c.arquivadaEm || !c.ultimaMensagemCliente) continue;
      const cli = c.ultimaMensagemCliente;
      if (cli < desde || cli > antes || ultimaLoja(c) >= cli.getTime()) continue;
      if ((await this.eventos(c)).some((e) => e.tipo === 'lead_parado' && e.em.getTime() > cli.getTime())) continue;
      r.push({ conversaId: c.id, desde: cli });
    }
    return r;
  }
}

export class FonteRegrasFunilPostgres implements FonteRegrasFunil {
  constructor(private readonly pool: pg.Pool) {}
  async semResposta(empresaId: string, antes: Date, limite: number) {
    const { rows } = await this.pool.query<{ id: string; ref: Date }>(
      `select c.id, r.ref
         from sintonia.conversas c
         cross join lateral (select min(m.em) as ref from sintonia.mensagens m
                              where m.conversa_id = c.id and m.autor in ('ia', 'equipe')
                                and m.em >= coalesce(c.ultima_mensagem_cliente, '-infinity'::timestamptz)) r
        where c.empresa_id = $1 and c.etapa = 'em_conversa' and c.arquivada_em is null
          and greatest(c.ultima_mensagem_ia, c.ultima_mensagem_equipe) >= coalesce(c.ultima_mensagem_cliente, '-infinity'::timestamptz)
          and r.ref is not null and r.ref <= $2
          and not exists (select 1 from sintonia.eventos e where e.conversa_id = c.id and e.tipo = 'etapa_mudou'
                             and e.dados->>'motivo' = 'manual' and e.em >= r.ref)
        order by r.ref limit $3`,
      [empresaId, antes, limite],
    );
    return rows.map((x) => ({ conversaId: x.id, desde: x.ref }));
  }
  async horarioPassou(empresaId: string, antes: Date, limite: number, desde?: Date) {
    const { rows } = await this.pool.query<{ id: string; fim: Date }>(
      `select c.id, a.fim
         from sintonia.conversas c
         cross join lateral (select (e.dados->>'inicio')::timestamptz
                                    + make_interval(mins => coalesce(round(nullif(e.dados->>'duracaoMin', '')::numeric)::int, 60)) as fim
                               from sintonia.eventos e
                              where e.conversa_id = c.id and e.tipo in ('agendamento_ia', 'agendamento_equipe')
                                and e.dados->>'inicio' ~ '^\\d{4}-\\d{2}-\\d{2}T'
                                and coalesce(e.dados->>'duracaoMin', '0') ~ '^\\d+(\\.\\d+)?$'
                              order by e.em desc, e.id desc limit 1) a
        where c.empresa_id = $1 and c.etapa = 'agendada' and c.arquivada_em is null and a.fim <= $2
          and ($4::timestamptz is null or a.fim >= $4)
          and not exists (select 1 from sintonia.eventos e where e.conversa_id = c.id and e.tipo = 'etapa_mudou'
                             and e.dados->>'motivo' = 'manual' and e.em >= a.fim)
        order by a.fim limit $3`,
      [empresaId, antes, limite, desde ?? null],
    );
    return rows.map((x) => ({ conversaId: x.id, fim: x.fim }));
  }
  async paradas(empresaId: string, desde: Date, antes: Date, limite: number) {
    const { rows } = await this.pool.query<{ id: string; desde: Date }>(
      `select c.id, c.ultima_mensagem_cliente as desde
         from sintonia.conversas c
        where c.empresa_id = $1 and c.etapa in ('entrada', 'novo_lead') and c.arquivada_em is null
          and c.ultima_mensagem_cliente between $2 and $3
          and coalesce(greatest(c.ultima_mensagem_ia, c.ultima_mensagem_equipe), '-infinity'::timestamptz) < c.ultima_mensagem_cliente
          and not exists (select 1 from sintonia.eventos e where e.conversa_id = c.id and e.tipo = 'lead_parado' and e.em > c.ultima_mensagem_cliente)
        order by c.ultima_mensagem_cliente limit $4`,
      [empresaId, desde, antes, limite],
    );
    return rows.map((x) => ({ conversaId: x.id, desde: x.desde }));
  }
}

// ---------------------------------------------------------------- serviço

export interface OpcoesRegrasFunil {
  armazem: ArmazemRegrasFunil;
  fonte: FonteRegrasFunil;
  repo: Pick<Repositorio, 'registrarEvento' | 'salvarConversa'>;
  funis: Pick<Funis, 'moverNoSistema'>;
  empresaId: string;
  /** Trava da conversa (Sintonia.comConversa). */
  comConversa: <T>(conversaId: string, fn: (c: Conversa) => Promise<T>) => Promise<T | undefined>;
  /** A cliente pediu para remarcar: o motor move para "Reagendar" (Sintonia.pediuRemarcar). */
  pediuRemarcar: (conversaId: string, motivo: string) => Promise<boolean>;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

/** Quantas conversas cada regra de tempo move por volta do relógio (o resto fica para a próxima). */
const POR_VOLTA = 100;
const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** A unidade está aberta agora? Unidade sem nenhum horário cadastrado conta como sempre aberta. */
export function unidadeAberta(unidade: string, agora: Date): boolean {
  const h = unidadeDe(unidade).horario;
  if (!Object.keys(h).length) return true;
  const p = partesBahia(agora);
  const faixa = h[p.diaSemana as DiaSemana];
  if (!faixa) return false;
  const m = p.hora * 60 + p.minuto;
  const ini = minutosDoDia(faixa.abre);
  const fim = minutosDoDia(faixa.fecha);
  return ini < fim ? m >= ini && m < fim : m >= ini || m < fim;
}

export class RegrasFunil {
  private cache?: { em: number; cfg: Promise<RegrasFunilCfg> };
  private fila: Promise<void> = Promise.resolve();
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;

  constructor(private readonly o: OpcoesRegrasFunil) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  /** Regras em vigor (lidas do banco a cada 10 s no máximo). Falha na leitura: o padrão. */
  config(): Promise<RegrasFunilCfg> {
    const t = Date.now();
    if (!this.cache || t - this.cache.em > 10_000) {
      this.cache = { em: t, cfg: this.o.armazem.ler(this.o.empresaId).then((r) => normalizarRegrasFunil(r?.config)).catch(() => ({ ...REGRAS_FUNIL_PADRAO })) };
    }
    return this.cache.cfg;
  }

  async regrasMotor(): Promise<RegrasMotor> {
    return regrasDoMotor(await this.config());
  }

  /** Para a tela: as regras, quem mudou por último e quando. */
  async paraTela() {
    const r = await this.o.armazem.ler(this.o.empresaId).catch(() => null);
    return { regras: normalizarRegrasFunil(r?.config), padrao: REGRAS_FUNIL_PADRAO, atualizadoPor: r?.atualizadoPor ?? null, atualizadoEm: r?.atualizadoEm ?? null };
  }

  /** Grava (pode mandar só parte: o resto continua como estava). */
  async salvar(corpo: unknown, por: string) {
    const atual = await this.config();
    if (!corpo || typeof corpo !== 'object') throw new ErroRegrasFunil('Nada para salvar.', 400);
    const junto: Record<string, unknown> = { ...atual };
    for (const [k, v] of Object.entries(corpo as Record<string, unknown>)) {
      if (!(k in REGRAS_FUNIL_PADRAO)) continue;
      junto[k] = { ...(atual as Record<string, object>)[k], ...(v && typeof v === 'object' ? v : {}) };
    }
    const ok = EsquemaRegrasFunil.safeParse(junto);
    if (!ok.success) {
      const i = ok.error.issues[0];
      const campo = String(i?.path.at(-1) ?? '');
      const msg = campo === 'minutos' ? 'Tempo fora do limite permitido.' : campo === 'tag' ? 'Escreva o nome da tag (até 30 letras).' : 'Confira os campos.';
      throw new ErroRegrasFunil(msg, 400);
    }
    await this.o.armazem.gravar(this.o.empresaId, ok.data, por, this.agora());
    this.cache = undefined;
    return this.paraTela();
  }

  /** Termina quando o que está na fila (pedidos de remarcar) foi feito. */
  ocioso(): Promise<void> {
    return this.fila;
  }
  private enfileirar(fn: () => Promise<unknown>): void {
    this.fila = this.fila.then(fn).then(
      () => undefined,
      (e) => this.log('Falha numa regra automática do funil', String(e)),
    );
  }

  /** Eventos (observarEventos): a cliente respondeu "preciso remarcar" na confirmação de agenda → Reagendar. */
  aoEvento(e: Evento): void {
    if (e.tipo !== 'confirmacao' || e.dados?.status !== 'remarcar' || !e.conversaId) return;
    const id = e.conversaId;
    this.enfileirar(() => this.o.pediuRemarcar(id, 'pediu_remarcar'));
  }

  /** Tag marcada (Tags.aoMarcar): a tag de "quer remarcar" (padrão "Quer remarcar") → Reagendar. Fora da trava. */
  async aoMarcarTag(c: Conversa, tag: Tag): Promise<void> {
    if (c.empresaId !== this.o.empresaId || tag.funilId) return;
    const cfg = await this.config();
    if (!cfg.remarcar.ligado || sem(tag.nome) !== sem(cfg.remarcar.tag)) return;
    const id = c.id;
    this.enfileirar(() => this.o.pediuRemarcar(id, 'tag_remarcar'));
  }

  /** Relógio: Sem resposta, Finalizado e o alerta de lead parado em Novo lead. */
  async tick(): Promise<void> {
    const cfg = await this.config();
    const agora = this.agora();
    if (cfg.semResposta.ligado) await this.semResposta(cfg, agora).catch((e) => this.log('Falha na regra "Sem resposta" do funil', String(e)));
    if (cfg.finalizado.ligado) await this.finalizar(cfg, agora).catch((e) => this.log('Falha na regra "Finalizado" do funil', String(e)));
    if (cfg.alertaEntrada.ligado) await this.alertar(cfg, agora).catch((e) => this.log('Falha no alerta de lead parado', String(e)));
  }

  private async mover(conversaId: string, etapa: Etapa, confere: (c: Conversa) => boolean, motivo: string): Promise<boolean> {
    const r = await this.o.comConversa(conversaId, async (c) => {
      if (c.empresaId !== this.o.empresaId || !confere(c)) return false;
      const mudou = await this.o.funis.moverNoSistema(c, etapa, { motivo });
      if (mudou) {
        c.atualizadaEm = this.agora();
        await this.o.repo.salvarConversa(c);
      }
      return mudou;
    });
    return Boolean(r);
  }

  private async semResposta(cfg: RegrasFunilCfg, agora: Date): Promise<number> {
    const antes = new Date(agora.getTime() - cfg.semResposta.minutos * MIN);
    let n = 0;
    for (const x of await this.o.fonte.semResposta(this.o.empresaId, antes, POR_VOLTA)) {
      // Sob a trava: ainda em atendimento e a cliente não escreveu depois da resposta da loja.
      const ok = await this.mover(x.conversaId, 'sem_resposta', (c) => c.etapa === 'em_conversa' && (c.ultimaMensagemCliente?.getTime() ?? 0) <= x.desde.getTime(), 'sem_resposta');
      if (ok) n++;
    }
    return n;
  }

  private async finalizar(cfg: RegrasFunilCfg, agora: Date): Promise<number> {
    const antes = new Date(agora.getTime() - cfg.finalizado.minutos * MIN);
    let n = 0;
    // Só horários das últimas 48 h: horário antigo (de antes da regra existir) não vira "Finalizado" sozinho,
    // senão o pós-venda mandaria "obrigada pela visita" semanas depois. Esses a equipe move à mão.
    const desde = new Date(agora.getTime() - 48 * 60 * MIN);
    for (const x of await this.o.fonte.horarioPassou(this.o.empresaId, antes, POR_VOLTA, desde)) {
      if (await this.mover(x.conversaId, 'compareceu', (c) => c.etapa === 'agendada', 'horario_passou')) n++;
    }
    return n;
  }

  private async alertar(cfg: RegrasFunilCfg, agora: Date): Promise<number> {
    const antes = new Date(agora.getTime() - cfg.alertaEntrada.minutos * MIN);
    // Só a mensagem do último dia: lead largado há dias não é "parado agora" (o quadro mostra).
    const desde = new Date(agora.getTime() - 24 * 60 * MIN);
    let n = 0;
    for (const x of await this.o.fonte.paradas(this.o.empresaId, desde, antes, POR_VOLTA)) {
      const r = await this.o.comConversa(x.conversaId, async (c) => {
        if (c.empresaId !== this.o.empresaId) return false;
        if (cfg.alertaEntrada.soNoHorario && !unidadeAberta(c.unidade, agora)) return false;
        const minutos = Math.floor((agora.getTime() - x.desde.getTime()) / MIN);
        await this.o.repo.registrarEvento({ tipo: 'lead_parado', conversaId: c.id, unidade: c.unidade, em: agora, dados: { desde: x.desde.toISOString(), minutos, limite: cfg.alertaEntrada.minutos } });
        return true;
      });
      if (r) n++;
    }
    return n;
  }
}
