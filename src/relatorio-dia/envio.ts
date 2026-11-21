import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { formatarTelefoneBR, normalizarTelefoneBR } from '../leads/telefone-br.js';
import { bahia, MIN, partesBahia } from '../util/tempo.js';

/**
 * relatorio-dia: relatórios automáticos pelo WhatsApp (a Serena como gerente de vendas).
 * - Configuração por empresa (tabela relatorio_envio_config): ligado, quem recebe (grupos do WhatsApp e números),
 *   o que cada destinatário recebe, horários, por qual número sai e de qual unidade são os números.
 *   TUDO COMEÇA DESLIGADO e sem ninguém na lista.
 * - Cada envio é uma linha em relatorio_envios com chave única (empresa, relatório, referência, destinatário):
 *   quem grava a linha primeiro envia; os outros processos pulam. Envio que ficou "enviando" (o servidor caiu no
 *   meio) não é repetido às cegas. Falha é registrada e tentada de novo até 3 vezes (5 min entre elas).
 * - Entre 22:00 e 07:00 nada sai atrasado: só no horário marcado (até 15 min depois). Fora disso, até 3 h de atraso.
 */

export const RELATORIOS = ['agenda', 'fechamento', 'semanal', 'mensal'] as const;
export type TipoRelatorio = (typeof RELATORIOS)[number];
export const NOME_RELATORIO: Record<TipoRelatorio, string> = {
  agenda: 'Agenda da manhã',
  fechamento: 'Fechamento do dia',
  semanal: 'Resumo da semana',
  mensal: 'Fechamento do mês',
};

const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:MM).');

export const Destinatario = z.object({
  id: z.string().min(1).max(40).default(() => randomUUID()),
  tipo: z.enum(['grupo', 'numero']),
  /** Grupo: id do grupo na Sintonia. Número: só dígitos, com 55. */
  destino: z.string().trim().min(1).max(80),
  nome: z.string().trim().max(80).default(''),
  /** Pessoa da equipe (quando o número veio da Conta dela). */
  usuarioId: z.string().max(64).nullable().default(null),
  relatorios: z.array(z.enum(RELATORIOS)).max(RELATORIOS.length).default([]),
});
export type Destinatario = z.infer<typeof Destinatario>;

export const ConfigEnvio = z.object({
  ligado: z.boolean().default(false),
  /** Unidade cujo número de WhatsApp envia (null = o primeiro número conectado). */
  unidadeEnvio: z.string().max(40).nullable().default(null),
  /** Números de qual unidade (null = todas). */
  unidade: z.string().max(40).nullable().default(null),
  horarios: z
    .object({
      agenda: Hora.default('08:00'),
      fechamento: Hora.default('21:00'),
      semanal: Hora.default('08:30'),
      /** 0 = domingo … 6 = sábado (segunda por padrão). */
      semanalDia: z.number().int().min(0).max(6).default(1),
      mensal: Hora.default('09:00'),
      /** Dia do mês (1 a 28). */
      mensalDia: z.number().int().min(1).max(28).default(1),
    })
    .prefault({}),
  destinatarios: z.array(Destinatario).max(30).default([]),
});
export type ConfigEnvio = z.infer<typeof ConfigEnvio>;
export const configEnvioPadrao = (): ConfigEnvio => ConfigEnvio.parse({});

/** "grupo:<id>" ou "numero:<dígitos>": a chave do destinatário no registro (um grupo conta como um). */
export const chaveDestino = (d: Pick<Destinatario, 'tipo' | 'destino'>) => `${d.tipo}:${d.tipo === 'numero' ? d.destino.replace(/\D/g, '') : d.destino}`;

/** Número digitado → só dígitos com 55 (ou erro em português). */
export function numeroDestino(bruto: string): string {
  const n = normalizarTelefoneBR(bruto);
  if (!n.ok) throw Object.assign(new Error(`Número inválido: ${n.motivo}.`), { statusCode: 400 });
  return n.telefone;
}
export const numeroBonito = (d: string) => formatarTelefoneBR(d);

// ---------------------------------------------------------------- quando enviar

/** Até quanto tempo depois do horário ainda sai (servidor fora do ar na hora). */
export const ATRASO_MAXIMO_MS = 3 * 60 * MIN;
/** Na madrugada (22:00–07:00), só até isto depois do horário marcado. */
export const TOLERANCIA_SILENCIO_MS = 15 * MIN;
export const MAX_TENTATIVAS = 3;
export const ESPERA_NOVA_TENTATIVA_MS = 5 * MIN;

/** Entre 22:00 e 06:59 (Bahia). */
export const naMadrugada = (agora: Date) => {
  const h = partesBahia(agora).hora;
  return h >= 22 || h < 7;
};

export function horarioMarcado(hhmm: string, base: Date): Date {
  const p = partesBahia(base);
  const [h, m] = hhmm.split(':').map(Number);
  return bahia(p.ano, p.mes, p.dia, h ?? 0, m ?? 0);
}

/**
 * Pode sair agora um relatório marcado para `marcado`? Nunca antes; até 3 h depois; e na madrugada só no próprio
 * horário (até 15 min de folga), nunca atrasado.
 */
export function podeEnviar(agora: Date, marcado: Date): boolean {
  const atraso = agora.getTime() - marcado.getTime();
  if (atraso < 0 || atraso > ATRASO_MAXIMO_MS) return false;
  if (naMadrugada(agora) && atraso > TOLERANCIA_SILENCIO_MS) return false;
  return true;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * O relatório tem vez hoje? Devolve a referência (a chave do "uma vez só") e a hora marcada.
 * agenda e fechamento: todo dia (referência = o dia). semanal: no dia da semana escolhido (referência = o dia).
 * mensal: no dia do mês escolhido (referência = o mês fechado, AAAA-MM).
 */
export function vezDoRelatorio(rel: TipoRelatorio, cfg: ConfigEnvio, agora: Date): { referencia: string; marcado: Date } | null {
  const p = partesBahia(agora);
  const dia = `${p.ano}-${p2(p.mes)}-${p2(p.dia)}`;
  const h = cfg.horarios;
  if (rel === 'agenda') return { referencia: dia, marcado: horarioMarcado(h.agenda, agora) };
  if (rel === 'fechamento') return { referencia: dia, marcado: horarioMarcado(h.fechamento, agora) };
  if (rel === 'semanal') return p.diaSemana === h.semanalDia ? { referencia: dia, marcado: horarioMarcado(h.semanal, agora) } : null;
  if (p.dia !== h.mensalDia) return null;
  const mesAnt = p.mes === 1 ? `${p.ano - 1}-12` : `${p.ano}-${p2(p.mes - 1)}`;
  return { referencia: mesAnt, marcado: horarioMarcado(h.mensal, agora) };
}

// ---------------------------------------------------------------- armazém

export type SituacaoEnvio = 'enviando' | 'enviado' | 'falhou' | 'pulado';
export interface RegistroEnvio {
  id: string;
  relatorio: string;
  referencia: string;
  destino: string;
  destinoNome: string | null;
  situacao: SituacaoEnvio;
  erro: string | null;
  tentativas: number;
  criadoEm: Date;
  atualizadoEm: Date;
}
export interface NovaReserva {
  empresaId: string;
  relatorio: string;
  referencia: string;
  destino: string;
  destinoNome: string | null;
  texto: string;
  agora: Date;
}

export interface ArmazemEnvioRelatorio {
  lerConfig(empresaId: string): Promise<{ cfg: ConfigEnvio; atualizadoEm: Date | null; atualizadoPor: string | null }>;
  salvarConfig(empresaId: string, cfg: ConfigEnvio, por: string): Promise<void>;
  /** Grava a linha "enviando"; devolve o id, ou null se a chave já existe (outro processo/rodada já enviou). */
  reservar(r: NovaReserva): Promise<string | null>;
  /** Falhou há mais de 5 min e com menos de 3 tentativas: volta para "enviando" (só um consegue). */
  retomarFalha(empresaId: string, relatorio: string, referencia: string, destino: string, agora: Date): Promise<string | null>;
  concluir(id: string, situacao: 'enviado' | 'falhou', erro: string | null, agora: Date): Promise<void>;
  /** Chaves de destinatário já registradas para relatório + referência (para não montar o texto à toa). */
  registrados(empresaId: string, relatorio: string, referencia: string): Promise<Map<string, SituacaoEnvio>>;
  recentes(empresaId: string, limite?: number): Promise<RegistroEnvio[]>;
}

const lerCfg = (j: unknown): ConfigEnvio => {
  const r = ConfigEnvio.safeParse(j ?? {});
  return r.success ? r.data : configEnvioPadrao();
};

export class ArmazemEnvioRelatorioMemoria implements ArmazemEnvioRelatorio {
  private readonly cfgs = new Map<string, { cfg: ConfigEnvio; atualizadoEm: Date; atualizadoPor: string }>();
  readonly linhas: Array<RegistroEnvio & { empresaId: string; texto: string }> = [];
  async lerConfig(empresaId: string) {
    const r = this.cfgs.get(empresaId);
    return r ? { ...r, cfg: structuredClone(r.cfg) } : { cfg: configEnvioPadrao(), atualizadoEm: null, atualizadoPor: null };
  }
  async salvarConfig(empresaId: string, cfg: ConfigEnvio, por: string) {
    this.cfgs.set(empresaId, { cfg: structuredClone(cfg), atualizadoEm: new Date(), atualizadoPor: por });
  }
  async reservar(r: NovaReserva) {
    if (this.linhas.some((l) => l.empresaId === r.empresaId && l.relatorio === r.relatorio && l.referencia === r.referencia && l.destino === r.destino)) return null;
    const id = randomUUID();
    this.linhas.push({ id, empresaId: r.empresaId, relatorio: r.relatorio, referencia: r.referencia, destino: r.destino, destinoNome: r.destinoNome, situacao: 'enviando', erro: null, tentativas: 1, texto: r.texto, criadoEm: r.agora, atualizadoEm: r.agora });
    return id;
  }
  async retomarFalha(empresaId: string, relatorio: string, referencia: string, destino: string, agora: Date) {
    const l = this.linhas.find((x) => x.empresaId === empresaId && x.relatorio === relatorio && x.referencia === referencia && x.destino === destino);
    if (!l || l.situacao !== 'falhou' || l.tentativas >= MAX_TENTATIVAS || agora.getTime() - l.atualizadoEm.getTime() < ESPERA_NOVA_TENTATIVA_MS) return null;
    Object.assign(l, { situacao: 'enviando', tentativas: l.tentativas + 1, atualizadoEm: agora });
    return l.id;
  }
  async concluir(id: string, situacao: 'enviado' | 'falhou', erro: string | null, agora: Date) {
    const l = this.linhas.find((x) => x.id === id);
    if (l) Object.assign(l, { situacao, erro, atualizadoEm: agora });
  }
  async registrados(empresaId: string, relatorio: string, referencia: string) {
    return new Map(this.linhas.filter((l) => l.empresaId === empresaId && l.relatorio === relatorio && l.referencia === referencia).map((l) => [l.destino, l.situacao]));
  }
  async recentes(empresaId: string, limite = 30) {
    return this.linhas
      .filter((l) => l.empresaId === empresaId)
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
      .slice(0, limite)
      .map(({ empresaId: _e, texto: _t, ...r }) => ({ ...r }));
  }
}

type Linha = { id: string; relatorio: string; referencia: string; destino: string; destino_nome: string | null; situacao: SituacaoEnvio; erro: string | null; tentativas: number; criado_em: Date; atualizado_em: Date };
const registro = (l: Linha): RegistroEnvio => ({
  id: l.id, relatorio: l.relatorio, referencia: l.referencia, destino: l.destino, destinoNome: l.destino_nome, situacao: l.situacao,
  erro: l.erro, tentativas: l.tentativas, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
});

export class ArmazemEnvioRelatorioPostgres implements ArmazemEnvioRelatorio {
  constructor(private readonly pool: pg.Pool) {}
  async lerConfig(empresaId: string) {
    const { rows } = await this.pool.query<{ dados: unknown; atualizado_em: Date; atualizado_por: string | null }>(
      'select dados, atualizado_em, atualizado_por from sintonia.relatorio_envio_config where empresa_id = $1',
      [empresaId],
    );
    const r = rows[0];
    return r ? { cfg: lerCfg(r.dados), atualizadoEm: r.atualizado_em, atualizadoPor: r.atualizado_por } : { cfg: configEnvioPadrao(), atualizadoEm: null, atualizadoPor: null };
  }
  async salvarConfig(empresaId: string, cfg: ConfigEnvio, por: string) {
    await this.pool.query(
      `insert into sintonia.relatorio_envio_config (empresa_id, dados, atualizado_em, atualizado_por) values ($1, $2, now(), $3)
       on conflict (empresa_id) do update set dados = excluded.dados, atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [empresaId, JSON.stringify(cfg), por],
    );
  }
  async reservar(r: NovaReserva) {
    const { rows } = await this.pool.query<{ id: string }>(
      `insert into sintonia.relatorio_envios (id, empresa_id, relatorio, referencia, destino, destino_nome, texto, criado_em, atualizado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       on conflict (empresa_id, relatorio, referencia, destino) do nothing returning id`,
      [randomUUID(), r.empresaId, r.relatorio, r.referencia, r.destino, r.destinoNome, r.texto, r.agora],
    );
    return rows[0]?.id ?? null;
  }
  async retomarFalha(empresaId: string, relatorio: string, referencia: string, destino: string, agora: Date) {
    const { rows } = await this.pool.query<{ id: string }>(
      `update sintonia.relatorio_envios set situacao = 'enviando', tentativas = tentativas + 1, atualizado_em = $5
        where empresa_id = $1 and relatorio = $2 and referencia = $3 and destino = $4
          and situacao = 'falhou' and tentativas < $6 and atualizado_em <= $7
       returning id`,
      [empresaId, relatorio, referencia, destino, agora, MAX_TENTATIVAS, new Date(agora.getTime() - ESPERA_NOVA_TENTATIVA_MS)],
    );
    return rows[0]?.id ?? null;
  }
  async concluir(id: string, situacao: 'enviado' | 'falhou', erro: string | null, agora: Date) {
    await this.pool.query('update sintonia.relatorio_envios set situacao = $2, erro = $3, atualizado_em = $4 where id = $1', [id, situacao, erro?.slice(0, 500) ?? null, agora]);
  }
  async registrados(empresaId: string, relatorio: string, referencia: string) {
    const { rows } = await this.pool.query<{ destino: string; situacao: SituacaoEnvio }>(
      'select destino, situacao from sintonia.relatorio_envios where empresa_id = $1 and relatorio = $2 and referencia = $3',
      [empresaId, relatorio, referencia],
    );
    return new Map(rows.map((r) => [r.destino, r.situacao]));
  }
  async recentes(empresaId: string, limite = 30) {
    const { rows } = await this.pool.query<Linha>(
      `select id::text as id, relatorio, referencia, destino, destino_nome, situacao, erro, tentativas, criado_em, atualizado_em
         from sintonia.relatorio_envios where empresa_id = $1 order by criado_em desc limit $2`,
      [empresaId, limite],
    );
    return rows.map(registro);
  }
}
