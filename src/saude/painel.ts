import { monitorEventLoopDelay } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import type pg from 'pg';
import type { Repositorio } from '../store/repositorio.js';

/**
 * perdas-saude: painel de saúde para a gestão (Análises › Saúde do sistema).
 *
 * Junta, num pedido só, o que diz se o sistema está dando conta: filas (entrada do WhatsApp e da IA), quanto tempo a
 * mensagem leva para aparecer, falhas da IA (e a pausa por chave recusada), mídias, números de WhatsApp, o processo
 * (memória, tempo no ar, atraso do processador) e o banco. Nada de segredo sai daqui: só números, estados e textos
 * de erro curtos com chaves/tokens apagados.
 */

const HORA = 3_600_000;

export interface TemposEntrada {
  total: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  porHora: Array<{ hora: string; total: number; p50Ms: number | null; p95Ms: number | null }>;
}
export interface FalhasIa {
  ultimaHora: number;
  ultimas24h: number;
  ultimaEm: Date | null;
  ultimoErro: string | null;
}
export interface SaudeMidias {
  pendentes: number;
  /** Pendentes que já falharam pelo menos uma vez (estão esperando nova tentativa). */
  tentando: number;
  falhas24h: number;
}
export interface SaudeBanco {
  ok: boolean;
  latenciaMs: number | null;
  tamanhoBytes: number | null;
  conexoes: number | null;
  erro: string | null;
}

/** De onde saem os números que moram no banco (Postgres no servidor; memória nos testes). */
export interface FonteSaude {
  tempos(desde: Date, agora: Date): Promise<TemposEntrada | null>;
  falhasIa(agora: Date): Promise<FalhasIa>;
  midias(agora: Date): Promise<SaudeMidias | null>;
  banco(): Promise<SaudeBanco | null>;
}

/** Tira do texto do erro o que pode ser segredo (chaves, tokens, senhas em URL) e corta. */
export function limparErro(t: unknown, max = 140): string {
  return String(t ?? '')
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, '[chave]')
    .replace(/\b(bearer|token|apikey|api_key|api-key|senha|password|secret|authorization)\b\s*[:=]?\s*\S+/gi, '$1 [oculto]')
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, '$1[oculto]@')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[oculto]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const quantil = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const i = Math.floor(pos);
  const f = pos - i;
  return Math.round(s[i]! + (s[Math.min(i + 1, s.length - 1)]! - s[i]!) * f);
};

export class FonteSaudePostgres implements FonteSaude {
  constructor(private readonly pool: pg.Pool) {}

  async tempos(desde: Date): Promise<TemposEntrada> {
    const [geral, hora] = await Promise.all([
      this.pool.query<{ total: number; p50: number | null; p95: number | null; max: number | null }>(
        `select count(*)::int as total,
                percentile_cont(0.5) within group (order by extract(epoch from feita_em - criada_em)) * 1000 as p50,
                percentile_cont(0.95) within group (order by extract(epoch from feita_em - criada_em)) * 1000 as p95,
                max(extract(epoch from feita_em - criada_em)) * 1000 as max
           from sintonia.entrada where status = 'feita' and feita_em >= $1`,
        [desde],
      ),
      this.pool.query<{ hora: Date; total: number; p50: number | null; p95: number | null }>(
        `select date_trunc('hour', feita_em) as hora, count(*)::int as total,
                percentile_cont(0.5) within group (order by extract(epoch from feita_em - criada_em)) * 1000 as p50,
                percentile_cont(0.95) within group (order by extract(epoch from feita_em - criada_em)) * 1000 as p95
           from sintonia.entrada where status = 'feita' and feita_em >= $1
          group by 1 order by 1`,
        [desde],
      ),
    ]);
    const g = geral.rows[0];
    const n = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Math.max(0, Math.round(Number(v))));
    return {
      total: g?.total ?? 0,
      p50Ms: n(g?.p50),
      p95Ms: n(g?.p95),
      maxMs: n(g?.max),
      porHora: hora.rows.map((r) => ({ hora: new Date(r.hora).toISOString(), total: r.total, p50Ms: n(r.p50), p95Ms: n(r.p95) })),
    };
  }

  async falhasIa(agora: Date): Promise<FalhasIa> {
    const { rows } = await this.pool.query<{ hora: number; dia: number; ultima: Date | null; erro: string | null }>(
      `select count(*) filter (where em >= $2)::int as hora, count(*)::int as dia, max(em) as ultima,
              (array_agg(dados->>'erro' order by em desc))[1] as erro
         from sintonia.eventos where tipo = 'falha' and em >= $1 and dados->>'etapa' = 'processar'`,
      [new Date(agora.getTime() - 24 * HORA), new Date(agora.getTime() - HORA)],
    );
    const r = rows[0];
    return { ultimaHora: r?.hora ?? 0, ultimas24h: r?.dia ?? 0, ultimaEm: r?.ultima ?? null, ultimoErro: r?.erro ? limparErro(r.erro) : null };
  }

  async midias(agora: Date): Promise<SaudeMidias> {
    const [p, f] = await Promise.all([
      this.pool.query<{ pendentes: number; tentando: number }>(
        `select count(*)::int as pendentes, count(*) filter (where tentativas > 0 and erro is not null)::int as tentando
           from sintonia.midias where situacao = 'pendente'`,
      ),
      this.pool.query<{ n: number }>(`select count(*)::int as n from sintonia.midias where situacao = 'falhou' and criada_em >= $1`, [new Date(agora.getTime() - 24 * HORA)]),
    ]);
    return { pendentes: p.rows[0]?.pendentes ?? 0, tentando: p.rows[0]?.tentando ?? 0, falhas24h: f.rows[0]?.n ?? 0 };
  }

  async banco(): Promise<SaudeBanco> {
    const t0 = performance.now();
    try {
      await this.pool.query('select 1');
      const latenciaMs = Math.round((performance.now() - t0) * 10) / 10;
      const { rows } = await this.pool.query<{ tamanho: string; conexoes: number }>(
        `select pg_database_size(current_database())::text as tamanho,
                (select count(*)::int from pg_stat_activity where datname = current_database()) as conexoes`,
      );
      return { ok: true, latenciaMs, tamanhoBytes: Number(rows[0]?.tamanho ?? 0) || null, conexoes: rows[0]?.conexoes ?? null, erro: null };
    } catch (e) {
      return { ok: false, latenciaMs: null, tamanhoBytes: null, conexoes: null, erro: limparErro((e as Error)?.message ?? e) };
    }
  }
}

/** Memória (testes e uso local sem banco): tempos medidos neste processo e falhas pelos eventos. */
export class FonteSaudeMemoria implements FonteSaude {
  /** Tempo de cada mensagem até aparecer (registrado por quem processa a fila). */
  private readonly medidas: Array<{ em: number; ms: number }> = [];
  constructor(private readonly repo: Repositorio) {}

  medir(ms: number, em = Date.now()): void {
    this.medidas.push({ em, ms });
    if (this.medidas.length > 20_000) this.medidas.splice(0, 5_000);
  }

  async tempos(desde: Date): Promise<TemposEntrada | null> {
    const l = this.medidas.filter((m) => m.em >= desde.getTime());
    const horas = new Map<number, number[]>();
    for (const m of l) {
      const h = Math.floor(m.em / HORA) * HORA;
      horas.set(h, [...(horas.get(h) ?? []), m.ms]);
    }
    const ms = l.map((m) => m.ms);
    return {
      total: l.length,
      p50Ms: quantil(ms, 0.5),
      p95Ms: quantil(ms, 0.95),
      maxMs: ms.length ? Math.max(...ms) : null,
      porHora: [...horas].sort((a, b) => a[0] - b[0]).map(([h, xs]) => ({ hora: new Date(h).toISOString(), total: xs.length, p50Ms: quantil(xs, 0.5), p95Ms: quantil(xs, 0.95) })),
    };
  }

  async falhasIa(agora: Date): Promise<FalhasIa> {
    const ev = (await this.repo.eventosEntre(new Date(agora.getTime() - 24 * HORA), new Date(agora.getTime() + 1))).filter((e) => e.tipo === 'falha' && e.dados?.etapa === 'processar');
    ev.sort((a, b) => a.em.getTime() - b.em.getTime());
    const ultima = ev.at(-1);
    return {
      ultimaHora: ev.filter((e) => e.em.getTime() >= agora.getTime() - HORA).length,
      ultimas24h: ev.length,
      ultimaEm: ultima?.em ?? null,
      ultimoErro: ultima?.dados?.erro ? limparErro(ultima.dados.erro) : null,
    };
  }

  async midias(): Promise<SaudeMidias | null> {
    return null;
  }

  async banco(): Promise<SaudeBanco | null> {
    return null;
  }
}

export interface CanalSaude {
  id: string;
  nome: string;
  estado: string;
  desde: string;
  motivo: string | null;
  precisaParear: boolean;
  reconectando: boolean;
  ultimaMensagemEm: string | null;
}

export interface DepPainelSaude {
  fonte: FonteSaude;
  /** Fila de entrada do WhatsApp (pendentes, processando, falhas). */
  filaEntrada?: () => Promise<{ pendentes: number; processando: number; falhas: number }>;
  /** Mensagens guardadas no disco enquanto o banco estava fora (src/fila/reserva.ts). */
  reservaEmDisco?: () => Promise<number>;
  /** Fila da IA (src/app/fila-ia.ts). */
  filaIa?: () => { esperando: number; pensando: number; feitas: number };
  /** Até quando a IA está pausada por chave recusada (null = não está). */
  iaPausadaAte?: () => Date | null;
  /** Há chave da IA configurada? */
  iaLigada?: () => boolean;
  /** Números de WhatsApp (src/channels/whatsapp-saude.ts). */
  whatsapp?: () => { servidor: { ok: boolean; desde: string; erro: string | null }; canais: CanalSaude[] };
  /** Conexões do pool do app. */
  pool?: () => { total: number; livres: number; esperando: number };
  agora?: () => Date;
  /** Quantas horas olhar para o "tempo até aparecer" (padrão 3). */
  horas?: number;
}

export type Nivel = 'ok' | 'atencao' | 'problema';
export interface Alerta {
  nivel: Exclude<Nivel, 'ok'>;
  area: string;
  texto: string;
}

/** Limites dos avisos (iguais ao teste de carga: scripts/carga.mjs). */
export const LIMITES_SAUDE = {
  p95AparecerMs: 2_000,
  filaEntradaPendentes: 50,
  filaIaEsperando: 30,
  memoriaRssBytes: 800 * 1024 * 1024,
  bancoLatenciaMs: 200,
  atrasoProcessadorMs: 200,
  falhasIaHora: 5,
  midiasFalhas24h: 10,
};

export class PainelSaude {
  private readonly atraso: ReturnType<typeof monitorEventLoopDelay> | null;
  private readonly agora: () => Date;

  constructor(private readonly d: DepPainelSaude) {
    this.agora = d.agora ?? (() => new Date());
    // Atraso do processador (event loop): quanto uma tarefa espera para rodar. Amostra a cada 20 ms, custo mínimo.
    try {
      this.atraso = monitorEventLoopDelay({ resolution: 20 });
      this.atraso.enable();
    } catch {
      this.atraso = null;
    }
  }

  parar(): void {
    this.atraso?.disable();
  }

  private processo() {
    const m = process.memoryUsage();
    // O histograma mede o intervalo inteiro do relógio de amostragem (20 ms): o atraso é o que passa disso.
    const ms = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? null : Math.max(0, Math.round((v / 1e6 - 20) * 10) / 10));
    const r = {
      memoria: { rss: m.rss, heapUsado: m.heapUsed, heapTotal: m.heapTotal, limiteHeap: getHeapStatistics().heap_size_limit, externa: m.external },
      noArSeg: Math.round(process.uptime()),
      iniciadoEm: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      node: process.version,
      atrasoMs: this.atraso && this.atraso.count ? { p50: ms(this.atraso.percentile(50)), p99: ms(this.atraso.percentile(99)), max: ms(this.atraso.max) } : null,
    };
    this.atraso?.reset();
    return r;
  }

  async montar() {
    const agora = this.agora();
    const horas = this.d.horas ?? 3;
    const seguro = async <T>(f: (() => Promise<T>) | undefined): Promise<T | null> => {
      if (!f) return null;
      try {
        return await f();
      } catch {
        return null;
      }
    };
    const [entrada, reserva, tempos, falhas, midias, banco] = await Promise.all([
      seguro(this.d.filaEntrada),
      seguro(this.d.reservaEmDisco),
      seguro(() => this.d.fonte.tempos(new Date(agora.getTime() - horas * HORA), agora)),
      seguro(() => this.d.fonte.falhasIa(agora)),
      seguro(() => this.d.fonte.midias(agora)),
      seguro(() => this.d.fonte.banco()),
    ]);
    const filaIa = this.d.filaIa ? this.d.filaIa() : null;
    const pausaAte = this.d.iaPausadaAte?.() ?? null;
    const pausada = Boolean(pausaAte && pausaAte.getTime() > agora.getTime());
    const whatsapp = this.d.whatsapp ? this.d.whatsapp() : null;
    const canais = (whatsapp?.canais ?? []).map((c) => ({ ...c, motivo: c.motivo ? limparErro(c.motivo) : null }));
    const processo = this.processo();
    const pool = this.d.pool ? this.d.pool() : null;

    const alertas: Alerta[] = [];
    const L = LIMITES_SAUDE;
    if (whatsapp && !whatsapp.servidor.ok) alertas.push({ nivel: 'problema', area: 'whatsapp', texto: 'O servidor do WhatsApp (Evolution) não está respondendo.' });
    for (const c of canais) {
      if (c.estado === 'desconectado') alertas.push({ nivel: 'problema', area: 'whatsapp', texto: c.precisaParear ? `${c.nome} saiu do WhatsApp: precisa ler o QR Code de novo em Conexões.` : `${c.nome} está desconectado${c.reconectando ? ' (tentando reconectar)' : ''}.` });
      else if (c.estado === 'conectando') alertas.push({ nivel: 'atencao', area: 'whatsapp', texto: `${c.nome} está conectando.` });
    }
    if (pausada) alertas.push({ nivel: 'problema', area: 'ia', texto: 'A IA está pausada porque a chave foi recusada. Confira a chave em Conexões; as conversas novas ficam com a equipe.' });
    else if (this.d.iaLigada && !this.d.iaLigada()) alertas.push({ nivel: 'atencao', area: 'ia', texto: 'A IA está desligada: falta a chave em Conexões.' });
    if (falhas && falhas.ultimaHora >= L.falhasIaHora) alertas.push({ nivel: 'atencao', area: 'ia', texto: `A IA falhou ${falhas.ultimaHora} vezes na última hora.` });
    if (entrada && entrada.falhas > 0) alertas.push({ nivel: 'atencao', area: 'fila', texto: `${entrada.falhas} ${entrada.falhas === 1 ? 'mensagem não entrou' : 'mensagens não entraram'} depois de várias tentativas.` });
    if (entrada && entrada.pendentes >= L.filaEntradaPendentes) alertas.push({ nivel: 'atencao', area: 'fila', texto: `${entrada.pendentes} mensagens esperando para entrar nas conversas.` });
    if (reserva) alertas.push({ nivel: 'atencao', area: 'fila', texto: `${reserva} ${reserva === 1 ? 'mensagem guardada' : 'mensagens guardadas'} no disco esperando o banco.` });
    if (filaIa && filaIa.esperando >= L.filaIaEsperando) alertas.push({ nivel: 'atencao', area: 'ia', texto: `${filaIa.esperando} conversas esperando a IA pensar.` });
    if (tempos?.p95Ms != null && tempos.total >= 5 && tempos.p95Ms > L.p95AparecerMs) alertas.push({ nivel: 'atencao', area: 'fila', texto: `As mensagens estão demorando para aparecer (95% em até ${(tempos.p95Ms / 1000).toFixed(1).replace('.', ',')} s).` });
    if (midias && midias.falhas24h >= L.midiasFalhas24h) alertas.push({ nivel: 'atencao', area: 'midias', texto: `${midias.falhas24h} fotos/áudios não baixaram nas últimas 24 h.` });
    if (banco && !banco.ok) alertas.push({ nivel: 'problema', area: 'banco', texto: 'O banco de dados não respondeu.' });
    else if (banco?.latenciaMs != null && banco.latenciaMs > L.bancoLatenciaMs) alertas.push({ nivel: 'atencao', area: 'banco', texto: `O banco está lento (${Math.round(banco.latenciaMs)} ms para responder).` });
    if (pool && pool.esperando > 0) alertas.push({ nivel: 'atencao', area: 'banco', texto: `${pool.esperando} pedidos esperando uma conexão com o banco.` });
    if (processo.memoria.rss > L.memoriaRssBytes) alertas.push({ nivel: 'atencao', area: 'processo', texto: `O app está usando muita memória (${Math.round(processo.memoria.rss / 1048576)} MB).` });
    if (processo.atrasoMs?.p99 != null && processo.atrasoMs.p99 > L.atrasoProcessadorMs) alertas.push({ nivel: 'atencao', area: 'processo', texto: 'O app está sobrecarregado (tarefas esperando para rodar).' });

    const nivel: Nivel = alertas.some((a) => a.nivel === 'problema') ? 'problema' : alertas.length ? 'atencao' : 'ok';
    return {
      em: agora,
      nivel,
      alertas,
      fila: { entrada, reservaEmDisco: reserva, ia: filaIa },
      aparecer: tempos ? { ...tempos, horas } : null,
      ia: { ligada: this.d.iaLigada ? this.d.iaLigada() : null, pausada, pausadaAte: pausada ? pausaAte : null, falhas },
      midias,
      whatsapp: whatsapp ? { servidor: { ok: whatsapp.servidor.ok, desde: whatsapp.servidor.desde, erro: whatsapp.servidor.erro ? limparErro(whatsapp.servidor.erro) : null }, canais } : null,
      processo,
      banco: banco ? { ...banco, pool } : pool ? { ok: true, latenciaMs: null, tamanhoBytes: null, conexoes: null, erro: null, pool } : null,
      limites: L,
    };
  }
}
export type RelatorioSaude = Awaited<ReturnType<PainelSaude['montar']>>;
