import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { MidiaEnvio } from '../channels/tipos.js';
import { unidadeDe } from '../unidades.js';
import { normalizarAtalho } from './respostas.js';

/**
 * Fluxos de mensagens (Respostas rápidas › Fluxos), como o "fluxo" do WhatsApp Voice:
 * uma sequência de passos (texto, áudio, foto, vídeo, documento), cada um com um tempo de espera antes
 * e, se quiser, "digitando…" ou "gravando áudio…" aparecendo para a cliente durante o fim da espera.
 *
 * Na conversa, a atendente escolhe o fluxo (no mesmo "/" das respostas rápidas) e o SERVIDOR envia
 * passo a passo — a tela pode fechar. Cada disparo vira uma linha em `fluxo_envios` (fila persistente:
 * sobrevive a reinício, e com vários processos cada passo sai uma vez só, por reserva com "skip locked").
 * Parar cancela os passos que faltam. Se a cliente responder no meio, cada fluxo diz: continuar ou parar.
 */

export const TIPOS_PASSO = ['texto', 'audio', 'imagem', 'video', 'documento'] as const;
export type TipoPasso = (typeof TIPOS_PASSO)[number];
export const PRESENCAS = ['nenhuma', 'digitando', 'gravando'] as const;
export type Presenca = (typeof PRESENCAS)[number];

/** Maior arquivo de um passo: 16 MB (o limite do WhatsApp para áudio e vídeo). */
export const LIMITE_MIDIA_FLUXO = 16 * 1024 * 1024;
/** Mais passos que isso vira spam. */
export const MAX_PASSOS = 20;
/** Maior espera antes de um passo: 24 horas. */
export const MAX_ESPERA_SEG = 24 * 3600;
/** "Digitando…" aparece no máximo nos últimos 25 s da espera (o WhatsApp apaga o aviso depois de uns 25 s). */
export const MAX_PRESENCA_SEG = 25;
/** Sem espera, mas com "digitando…": o aviso aparece por 3 s antes do envio. */
export const PRESENCA_MINIMA_SEG = 3;

export interface Passo {
  id: string;
  tipo: TipoPasso;
  /** Texto (passo de texto) ou legenda (foto, vídeo, documento). Aceita {nome}, {unidade}, {atendente}. */
  texto: string;
  /** Arquivo do passo (áudio, foto, vídeo, documento), guardado em fluxo_midias. */
  midiaId?: string;
  /** Nome do arquivo, para mostrar no editor e mandar no documento. */
  midiaNome?: string;
  /** Duração do áudio gravado (segundos), para o editor. */
  duracaoSeg?: number;
  /** Espera antes deste passo (o primeiro conta a partir do disparo). */
  esperaSeg: number;
  presenca: Presenca;
}

export type SeClienteResponder = 'continuar' | 'parar';

export interface Fluxo {
  id: string;
  atalho: string;
  nome: string;
  passos: Passo[];
  seClienteResponder: SeClienteResponder;
  /** null = da empresa. */
  usuarioId: string | null;
  criadaPor: string | null;
  atualizadaEm: Date;
}

export interface MidiaFluxo {
  id: string;
  empresaId: string;
  nome: string | null;
  mimetype: string;
  tamanho: number;
  conteudo: Buffer;
  criadoEm: Date;
}

export type SituacaoEnvio = 'andando' | 'concluido' | 'parado' | 'erro';

export interface EnvioFluxo {
  id: string;
  empresaId: string;
  conversaId: string;
  fluxoId: string | null;
  nome: string;
  passos: Passo[];
  seClienteResponder: SeClienteResponder;
  /** Próximo passo (índice). */
  passo: number;
  fase: 'presenca' | 'enviar';
  proximoEm: Date;
  situacao: SituacaoEnvio;
  motivo: string | null;
  iniciadoPor: string;
  iniciadoPorId: string | null;
  iniciadoEm: Date;
  atualizadoEm: Date;
}

// ------------------------------------------------------------ validação

const Uuid = z.string().uuid();

export const DadosPasso = z
  .object({
    id: z.string().max(60).optional(),
    tipo: z.enum(TIPOS_PASSO),
    texto: z.string().max(3000).optional().default(''),
    midiaId: Uuid.optional(),
    midiaNome: z.string().trim().max(200).optional(),
    duracaoSeg: z.number().min(0).max(4 * 3600).optional(),
    esperaSeg: z.number().int('A espera é em segundos inteiros.').min(0).max(MAX_ESPERA_SEG, 'A espera vai até 24 horas.').default(0),
    presenca: z.enum(PRESENCAS).default('nenhuma'),
  })
  .superRefine((p, ctx) => {
    if (p.tipo === 'texto' && !p.texto.trim()) ctx.addIssue({ code: 'custom', message: 'Um passo de texto está vazio.', path: ['texto'] });
    if (p.tipo !== 'texto' && !p.midiaId) ctx.addIssue({ code: 'custom', message: 'Falta o arquivo de um passo (áudio, foto, vídeo ou documento).', path: ['midiaId'] });
  })
  .transform(
    (p): Passo => ({
      id: p.id || randomUUID(),
      tipo: p.tipo,
      texto: p.tipo === 'audio' ? '' : p.texto.trim(),
      ...(p.tipo !== 'texto' && p.midiaId ? { midiaId: p.midiaId } : {}),
      ...(p.tipo !== 'texto' && p.midiaNome ? { midiaNome: p.midiaNome } : {}),
      ...(p.tipo === 'audio' && p.duracaoSeg !== undefined ? { duracaoSeg: Math.round(p.duracaoSeg) } : {}),
      esperaSeg: p.esperaSeg,
      presenca: p.presenca,
    }),
  );

const Atalho = z
  .string()
  .max(40)
  .transform(normalizarAtalho)
  .pipe(z.string().min(1, 'Escolha um atalho curto, como /boas-vindas.').max(30, 'Atalho longo demais (até 30 letras).'));

export const DadosFluxo = z.object({
  atalho: Atalho,
  nome: z.string().trim().min(1, 'Dê um nome ao fluxo.').max(80),
  passos: z.array(DadosPasso).min(1, 'Coloque pelo menos um passo.').max(MAX_PASSOS, `Até ${MAX_PASSOS} passos por fluxo.`),
  seClienteResponder: z.enum(['continuar', 'parar']).default('parar'),
});
export type EntradaFluxo = z.infer<typeof DadosFluxo>;

export class ErroAtalhoFluxoRepetido extends Error {
  constructor(atalho: string) {
    super(`Já existe o fluxo /${atalho}.`);
  }
}
export class ErroFluxoAndando extends Error {
  constructor() {
    super('Já tem um fluxo sendo enviado nesta conversa. Pare o atual antes de começar outro.');
  }
}

// ------------------------------------------------------------ texto e tempos

const primeiro = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] ?? '';

/** Troca {nome}, {unidade} e {atendente}, como as respostas rápidas na tela. Variável sem valor some sem deixar espaço sobrando. */
export function preencherTexto(texto: string, c: Pick<Conversa, 'nome' | 'unidade'>, atendente: string): string {
  const valores: Record<string, string> = {
    nome: primeiro(c.nome),
    unidade: unidadeDe(c.unidade)?.nome ?? String(c.unidade ?? ''),
    atendente: primeiro(atendente),
  };
  let vazio = false;
  const t = texto.replace(/\{(nome|unidade|atendente)\}/gi, (_, k: string) => {
    const v = valores[k.toLowerCase()] ?? '';
    if (!v) vazio = true;
    return v;
  });
  return vazio ? t.replace(/[ \t]+([,!?.;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/^[ \t,]+/gm, '') : t;
}

/**
 * Quando o passo sai, a partir de `base` (disparo ou passo anterior).
 * Com "digitando…": o aviso aparece nos últimos segundos da espera (até 25 s); sem espera, por 3 s.
 */
export function agendaDoPasso(p: Pick<Passo, 'esperaSeg' | 'presenca'>, base: Date): { fase: 'presenca' | 'enviar'; quando: Date } {
  const espera = Math.max(0, p.esperaSeg);
  if (p.presenca === 'nenhuma') return { fase: 'enviar', quando: new Date(base.getTime() + espera * 1000) };
  const mostrar = duracaoPresenca(p);
  const total = Math.max(espera, mostrar);
  return { fase: 'presenca', quando: new Date(base.getTime() + (total - mostrar) * 1000) };
}
export const duracaoPresenca = (p: Pick<Passo, 'esperaSeg' | 'presenca'>) =>
  p.presenca === 'nenhuma' ? 0 : p.esperaSeg > 0 ? Math.min(p.esperaSeg, MAX_PRESENCA_SEG) : PRESENCA_MINIMA_SEG;

// ------------------------------------------------------------ armazenamento

export interface ArmazemFluxos {
  listar(empresaId: string, usuarioId: string | null): Promise<Fluxo[]>;
  obter(empresaId: string, id: string): Promise<Fluxo | undefined>;
  criar(empresaId: string, f: EntradaFluxo & { usuarioId: string | null; criadaPor: string }): Promise<Fluxo>;
  alterar(empresaId: string, id: string, f: Partial<EntradaFluxo>, quem: string): Promise<Fluxo | undefined>;
  apagar(empresaId: string, id: string): Promise<boolean>;

  guardarMidia(m: Omit<MidiaFluxo, 'criadoEm'>): Promise<void>;
  midia(empresaId: string, id: string): Promise<MidiaFluxo | undefined>;
  /** Apaga arquivos com mais de um dia que nenhum fluxo nem envio em andamento usa (enviados e desistidos no editor). */
  limparMidias(empresaId: string, antesDe: Date): Promise<number>;

  /** Cria o envio. Já tem um andando na conversa → ErroFluxoAndando. */
  iniciarEnvio(e: Omit<EnvioFluxo, 'id' | 'situacao' | 'motivo' | 'atualizadoEm'>): Promise<EnvioFluxo>;
  envio(empresaId: string, id: string): Promise<EnvioFluxo | undefined>;
  /** O envio em andamento na conversa, ou o último (para a tela mostrar "terminou"/"parou"). */
  envioDaConversa(empresaId: string, conversaId: string): Promise<EnvioFluxo | undefined>;
  /** Reserva os envios com passo vencido (cada um vai para um processo só, por `reservaMs`). */
  reivindicar(agora: Date, limite: number, reservaMs: number): Promise<EnvioFluxo[]>;
  /** Grava o próximo passo e solta a reserva. Só vale se ainda está andando (Parar no meio ganha). */
  avancar(id: string, prox: { passo: number; fase: 'presenca' | 'enviar'; proximoEm: Date }, agora: Date): Promise<boolean>;
  /** Encerra (concluido, parado, erro). Só se ainda está andando. */
  encerrar(id: string, situacao: Exclude<SituacaoEnvio, 'andando'>, motivo: string | null, agora: Date): Promise<boolean>;
}

const ordenar = (lista: Fluxo[]) =>
  lista.sort((a, b) => Number(a.usuarioId === null) - Number(b.usuarioId === null) || a.atalho.localeCompare(b.atalho));
const copia = <T>(x: T): T => structuredClone(x);
const usaMidia = (passos: Passo[], id: string) => passos.some((p) => p.midiaId === id);

export class FluxosMemoria implements ArmazemFluxos {
  private readonly fluxos = new Map<string, Fluxo & { empresaId: string }>();
  private readonly midias = new Map<string, MidiaFluxo>();
  private readonly envios = new Map<string, EnvioFluxo & { reservadoAte: Date | null }>();

  async listar(empresaId: string, usuarioId: string | null) {
    return ordenar(
      [...this.fluxos.values()]
        .filter((f) => f.empresaId === empresaId && (f.usuarioId === null || f.usuarioId === usuarioId))
        .map(({ empresaId: _e, ...f }) => copia(f)),
    );
  }
  async obter(empresaId: string, id: string) {
    const f = this.fluxos.get(id);
    if (!f || f.empresaId !== empresaId) return undefined;
    const { empresaId: _e, ...resto } = f;
    return copia(resto);
  }
  private conferir(empresaId: string, atalho: string, usuarioId: string | null, menos?: string) {
    for (const f of this.fluxos.values()) {
      if (f.id !== menos && f.empresaId === empresaId && f.usuarioId === usuarioId && f.atalho === atalho) throw new ErroAtalhoFluxoRepetido(atalho);
    }
  }
  async criar(empresaId: string, f: EntradaFluxo & { usuarioId: string | null; criadaPor: string }) {
    this.conferir(empresaId, f.atalho, f.usuarioId);
    const novo = { id: randomUUID(), empresaId, atalho: f.atalho, nome: f.nome, passos: copia(f.passos), seClienteResponder: f.seClienteResponder, usuarioId: f.usuarioId, criadaPor: f.criadaPor, atualizadaEm: new Date() };
    this.fluxos.set(novo.id, novo);
    return (await this.obter(empresaId, novo.id))!;
  }
  async alterar(empresaId: string, id: string, f: Partial<EntradaFluxo>, quem: string) {
    const atual = this.fluxos.get(id);
    if (!atual || atual.empresaId !== empresaId) return undefined;
    if (f.atalho !== undefined) this.conferir(empresaId, f.atalho, atual.usuarioId, id);
    for (const k of ['atalho', 'nome', 'passos', 'seClienteResponder'] as const) if (f[k] !== undefined) Object.assign(atual, { [k]: copia(f[k]) });
    atual.criadaPor = quem;
    atual.atualizadaEm = new Date();
    return this.obter(empresaId, id);
  }
  async apagar(empresaId: string, id: string) {
    const f = this.fluxos.get(id);
    if (!f || f.empresaId !== empresaId) return false;
    return this.fluxos.delete(id);
  }

  async guardarMidia(m: Omit<MidiaFluxo, 'criadoEm'>) {
    this.midias.set(m.id, { ...m, criadoEm: new Date() });
  }
  async midia(empresaId: string, id: string) {
    const m = this.midias.get(id);
    return m && m.empresaId === empresaId ? { ...m } : undefined;
  }
  async limparMidias(empresaId: string, antesDe: Date) {
    let n = 0;
    for (const m of [...this.midias.values()]) {
      if (m.empresaId !== empresaId || m.criadoEm >= antesDe) continue;
      const emUso =
        [...this.fluxos.values()].some((f) => f.empresaId === empresaId && usaMidia(f.passos, m.id)) ||
        [...this.envios.values()].some((e) => e.situacao === 'andando' && usaMidia(e.passos, m.id));
      if (!emUso && this.midias.delete(m.id)) n++;
    }
    return n;
  }

  async iniciarEnvio(e: Omit<EnvioFluxo, 'id' | 'situacao' | 'motivo' | 'atualizadoEm'>) {
    if ([...this.envios.values()].some((x) => x.conversaId === e.conversaId && x.situacao === 'andando')) throw new ErroFluxoAndando();
    const novo = { ...copia(e), id: randomUUID(), situacao: 'andando' as const, motivo: null, atualizadoEm: e.iniciadoEm, reservadoAte: null };
    this.envios.set(novo.id, novo);
    return this.semReserva(novo);
  }
  private semReserva(e: EnvioFluxo & { reservadoAte: Date | null }): EnvioFluxo {
    const { reservadoAte: _r, ...resto } = e;
    return copia(resto);
  }
  async envio(empresaId: string, id: string) {
    const e = this.envios.get(id);
    return e && e.empresaId === empresaId ? this.semReserva(e) : undefined;
  }
  async envioDaConversa(empresaId: string, conversaId: string) {
    const da = [...this.envios.values()].filter((e) => e.empresaId === empresaId && e.conversaId === conversaId);
    const andando = da.find((e) => e.situacao === 'andando');
    const ultimo = andando ?? da.sort((a, b) => b.iniciadoEm.getTime() - a.iniciadoEm.getTime())[0];
    return ultimo ? this.semReserva(ultimo) : undefined;
  }
  async reivindicar(agora: Date, limite: number, reservaMs: number) {
    const vencidos = [...this.envios.values()]
      .filter((e) => e.situacao === 'andando' && e.proximoEm <= agora && (!e.reservadoAte || e.reservadoAte < agora))
      .sort((a, b) => a.proximoEm.getTime() - b.proximoEm.getTime())
      .slice(0, limite);
    for (const e of vencidos) e.reservadoAte = new Date(agora.getTime() + reservaMs);
    return vencidos.map((e) => this.semReserva(e));
  }
  async avancar(id: string, prox: { passo: number; fase: 'presenca' | 'enviar'; proximoEm: Date }, agora: Date) {
    const e = this.envios.get(id);
    if (!e || e.situacao !== 'andando') return false;
    Object.assign(e, { passo: prox.passo, fase: prox.fase, proximoEm: prox.proximoEm, reservadoAte: null, atualizadoEm: agora });
    return true;
  }
  async encerrar(id: string, situacao: Exclude<SituacaoEnvio, 'andando'>, motivo: string | null, agora: Date) {
    const e = this.envios.get(id);
    if (!e || e.situacao !== 'andando') return false;
    Object.assign(e, { situacao, motivo, reservadoAte: null, atualizadoEm: agora });
    return true;
  }
}

interface LinhaFluxo {
  id: string;
  atalho: string;
  nome: string;
  passos: Passo[];
  se_cliente_responder: SeClienteResponder;
  usuario_id: string | null;
  criada_por: string | null;
  atualizada_em: Date;
}
const daLinha = (l: LinhaFluxo): Fluxo => ({
  id: l.id,
  atalho: l.atalho,
  nome: l.nome,
  passos: l.passos,
  seClienteResponder: l.se_cliente_responder,
  usuarioId: l.usuario_id,
  criadaPor: l.criada_por,
  atualizadaEm: l.atualizada_em,
});
interface LinhaEnvio {
  id: string;
  empresa_id: string;
  conversa_id: string;
  fluxo_id: string | null;
  nome: string;
  passos: Passo[];
  se_cliente_responder: SeClienteResponder;
  passo: number;
  fase: 'presenca' | 'enviar';
  proximo_em: Date;
  situacao: SituacaoEnvio;
  motivo: string | null;
  iniciado_por: string;
  iniciado_por_id: string | null;
  iniciado_em: Date;
  atualizado_em: Date;
}
const doEnvio = (l: LinhaEnvio): EnvioFluxo => ({
  id: l.id,
  empresaId: l.empresa_id,
  conversaId: l.conversa_id,
  fluxoId: l.fluxo_id,
  nome: l.nome,
  passos: l.passos,
  seClienteResponder: l.se_cliente_responder,
  passo: l.passo,
  fase: l.fase,
  proximoEm: l.proximo_em,
  situacao: l.situacao,
  motivo: l.motivo,
  iniciadoPor: l.iniciado_por,
  iniciadoPorId: l.iniciado_por_id,
  iniciadoEm: l.iniciado_em,
  atualizadoEm: l.atualizado_em,
});
const repetido = (e: unknown) => (e as { code?: string }).code === '23505';
const ehUuid = (id: string) => Uuid.safeParse(id).success;

export class FluxosPostgres implements ArmazemFluxos {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string, usuarioId: string | null) {
    const { rows } = await this.pool.query<LinhaFluxo>(
      'select * from sintonia.fluxos_mensagens where empresa_id = $1 and (usuario_id is null or usuario_id = $2)',
      [empresaId, usuarioId && ehUuid(usuarioId) ? usuarioId : null],
    );
    return ordenar(rows.map(daLinha));
  }
  async obter(empresaId: string, id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<LinhaFluxo>('select * from sintonia.fluxos_mensagens where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async criar(empresaId: string, f: EntradaFluxo & { usuarioId: string | null; criadaPor: string }) {
    try {
      const { rows } = await this.pool.query<LinhaFluxo>(
        `insert into sintonia.fluxos_mensagens (id, empresa_id, usuario_id, atalho, nome, passos, se_cliente_responder, criada_por)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
        [randomUUID(), empresaId, f.usuarioId, f.atalho, f.nome, JSON.stringify(f.passos), f.seClienteResponder, f.criadaPor],
      );
      return daLinha(rows[0]!);
    } catch (e) {
      if (repetido(e)) throw new ErroAtalhoFluxoRepetido(f.atalho);
      throw e;
    }
  }
  async alterar(empresaId: string, id: string, f: Partial<EntradaFluxo>, quem: string) {
    if (!ehUuid(id)) return undefined;
    try {
      const { rows } = await this.pool.query<LinhaFluxo>(
        `update sintonia.fluxos_mensagens set atalho = coalesce($3, atalho), nome = coalesce($4, nome), passos = coalesce($5::jsonb, passos),
           se_cliente_responder = coalesce($6, se_cliente_responder), criada_por = $7, atualizada_em = now()
         where empresa_id = $1 and id = $2 returning *`,
        [empresaId, id, f.atalho ?? null, f.nome ?? null, f.passos ? JSON.stringify(f.passos) : null, f.seClienteResponder ?? null, quem],
      );
      return rows[0] ? daLinha(rows[0]) : undefined;
    } catch (e) {
      if (repetido(e) && f.atalho) throw new ErroAtalhoFluxoRepetido(f.atalho);
      throw e;
    }
  }
  async apagar(empresaId: string, id: string) {
    if (!ehUuid(id)) return false;
    const r = await this.pool.query('delete from sintonia.fluxos_mensagens where empresa_id = $1 and id = $2', [empresaId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async guardarMidia(m: Omit<MidiaFluxo, 'criadoEm'>) {
    await this.pool.query('insert into sintonia.fluxo_midias (id, empresa_id, nome, mimetype, tamanho, conteudo) values ($1, $2, $3, $4, $5, $6)', [
      m.id,
      m.empresaId,
      m.nome,
      m.mimetype,
      m.tamanho,
      m.conteudo,
    ]);
  }
  async midia(empresaId: string, id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<{ id: string; empresa_id: string; nome: string | null; mimetype: string; tamanho: number; conteudo: Buffer; criado_em: Date }>(
      'select * from sintonia.fluxo_midias where empresa_id = $1 and id = $2',
      [empresaId, id],
    );
    const l = rows[0];
    return l ? { id: l.id, empresaId: l.empresa_id, nome: l.nome, mimetype: l.mimetype, tamanho: l.tamanho, conteudo: l.conteudo, criadoEm: l.criado_em } : undefined;
  }
  async limparMidias(empresaId: string, antesDe: Date) {
    const r = await this.pool.query(
      `delete from sintonia.fluxo_midias m where m.empresa_id = $1 and m.criado_em < $2
         and not exists (select 1 from sintonia.fluxos_mensagens f, jsonb_array_elements(f.passos) p
                         where f.empresa_id = m.empresa_id and p->>'midiaId' = m.id::text)
         and not exists (select 1 from sintonia.fluxo_envios e, jsonb_array_elements(e.passos) p
                         where e.empresa_id = m.empresa_id and e.situacao = 'andando' and p->>'midiaId' = m.id::text)`,
      [empresaId, antesDe],
    );
    return r.rowCount ?? 0;
  }

  async iniciarEnvio(e: Omit<EnvioFluxo, 'id' | 'situacao' | 'motivo' | 'atualizadoEm'>) {
    try {
      const { rows } = await this.pool.query<LinhaEnvio>(
        `insert into sintonia.fluxo_envios (id, empresa_id, conversa_id, fluxo_id, nome, passos, se_cliente_responder, passo, fase, proximo_em,
           iniciado_por, iniciado_por_id, iniciado_em, atualizado_em)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) returning *`,
        [randomUUID(), e.empresaId, e.conversaId, e.fluxoId, e.nome, JSON.stringify(e.passos), e.seClienteResponder, e.passo, e.fase, e.proximoEm, e.iniciadoPor, e.iniciadoPorId, e.iniciadoEm],
      );
      return doEnvio(rows[0]!);
    } catch (x) {
      if (repetido(x)) throw new ErroFluxoAndando();
      throw x;
    }
  }
  async envio(empresaId: string, id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<LinhaEnvio>('select * from sintonia.fluxo_envios where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0] ? doEnvio(rows[0]) : undefined;
  }
  async envioDaConversa(empresaId: string, conversaId: string) {
    if (!ehUuid(conversaId)) return undefined;
    const { rows } = await this.pool.query<LinhaEnvio>(
      `select * from sintonia.fluxo_envios where empresa_id = $1 and conversa_id = $2
       order by (situacao = 'andando') desc, iniciado_em desc limit 1`,
      [empresaId, conversaId],
    );
    return rows[0] ? doEnvio(rows[0]) : undefined;
  }
  async reivindicar(agora: Date, limite: number, reservaMs: number) {
    const { rows } = await this.pool.query<LinhaEnvio>(
      `update sintonia.fluxo_envios set reservado_ate = $1::timestamptz + make_interval(secs => $3::float8 / 1000)
       where id in (
         select id from sintonia.fluxo_envios
         where situacao = 'andando' and proximo_em <= $1 and (reservado_ate is null or reservado_ate < $1)
         order by proximo_em limit $2 for update skip locked)
       returning *`,
      [agora, limite, reservaMs],
    );
    return rows.map(doEnvio).sort((a, b) => a.proximoEm.getTime() - b.proximoEm.getTime());
  }
  async avancar(id: string, prox: { passo: number; fase: 'presenca' | 'enviar'; proximoEm: Date }, agora: Date) {
    const r = await this.pool.query(
      `update sintonia.fluxo_envios set passo = $2, fase = $3, proximo_em = $4, reservado_ate = null, atualizado_em = $5
       where id = $1 and situacao = 'andando'`,
      [id, prox.passo, prox.fase, prox.proximoEm, agora],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async encerrar(id: string, situacao: Exclude<SituacaoEnvio, 'andando'>, motivo: string | null, agora: Date) {
    const r = await this.pool.query(
      `update sintonia.fluxo_envios set situacao = $2, motivo = $3, reservado_ate = null, atualizado_em = $4 where id = $1 and situacao = 'andando'`,
      [id, situacao, motivo, agora],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

// ------------------------------------------------------------ o motor (envio pelo servidor)

/** Como o motor fala com o resto do sistema (Sintonia + canal). */
export interface EnviadorFluxo {
  conversa(conversaId: string): Promise<Conversa | undefined>;
  /** Envia texto como mensagem da equipe (em nome de quem disparou). */
  texto(conversaId: string, texto: string, atendente: string): Promise<void>;
  /** Envia arquivo como mensagem da equipe. */
  midia(conversaId: string, midia: MidiaEnvio & { duracaoSeg?: number }, atendente: string): Promise<void>;
  /** "digitando…" ou "gravando áudio…" para a cliente por `segundos`. Canal sem suporte: não faz nada. */
  presenca(conversaId: string, tipo: Exclude<Presenca, 'nenhuma'>, segundos: number): Promise<void>;
}

export interface OpcoesMotorFluxos {
  armazem: ArmazemFluxos;
  enviador: EnviadorFluxo;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Quantos envios por rodada. */
  limite?: number;
}

const tipoDaMidia = (t: TipoPasso): MidiaEnvio['tipo'] => (t === 'texto' ? 'documento' : t);

export class MotorFluxos {
  private rodando = false;
  private limpezaEm = 0;
  private readonly agora: () => Date;

  constructor(private readonly o: OpcoesMotorFluxos) {
    this.agora = o.agora ?? (() => new Date());
  }

  /** Dispara o fluxo na conversa: o primeiro passo fica agendado conforme a espera dele. */
  async iniciar(empresaId: string, conversaId: string, f: Fluxo, quem: { nome: string; id?: string | null }): Promise<EnvioFluxo> {
    if (!f.passos.length) throw Object.assign(new Error('Este fluxo não tem passos.'), { statusCode: 400 });
    const agora = this.agora();
    const a = agendaDoPasso(f.passos[0]!, agora);
    return this.o.armazem.iniciarEnvio({
      empresaId,
      conversaId,
      fluxoId: f.id,
      nome: f.nome,
      passos: f.passos,
      seClienteResponder: f.seClienteResponder,
      passo: 0,
      fase: a.fase,
      proximoEm: a.quando,
      iniciadoPor: quem.nome,
      iniciadoPorId: quem.id ?? null,
      iniciadoEm: agora,
    });
  }

  /** Parar: os passos que faltam não saem mais. */
  async parar(empresaId: string, envioId: string, por: string): Promise<EnvioFluxo | undefined> {
    const e = await this.o.armazem.envio(empresaId, envioId);
    if (!e) return undefined;
    await this.o.armazem.encerrar(e.id, 'parado', `Parado por ${por}.`, this.agora());
    return this.o.armazem.envio(empresaId, envioId);
  }

  /** Uma rodada: envia o que venceu. Chamado pelo relógio a cada segundo. */
  async tick(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      const vencidos = await this.o.armazem.reivindicar(this.agora(), this.o.limite ?? 20, 120_000);
      // Conversas diferentes em paralelo; cada envio é um passo só por rodada.
      await Promise.all(vencidos.map((e) => this.passo(e)));
      return vencidos.length;
    } finally {
      this.rodando = false;
    }
  }

  /** Limpeza de arquivos sem uso (uma vez por hora no máximo). */
  async limpar(empresaId: string): Promise<void> {
    const agora = this.agora().getTime();
    if (agora - this.limpezaEm < 3600_000) return;
    this.limpezaEm = agora;
    await this.o.armazem.limparMidias(empresaId, new Date(agora - 24 * 3600_000)).catch((e) => this.o.log?.('Falha ao limpar arquivos dos fluxos', String(e)));
  }

  private async passo(e: EnvioFluxo): Promise<void> {
    const a = this.o.armazem;
    try {
      const c = await this.o.enviador.conversa(e.conversaId);
      if (!c) {
        await a.encerrar(e.id, 'erro', 'A conversa não existe mais.', this.agora());
        return;
      }
      // A cliente respondeu depois do disparo e o fluxo é do tipo "parar".
      if (e.seClienteResponder === 'parar' && c.ultimaMensagemCliente && c.ultimaMensagemCliente.getTime() > e.iniciadoEm.getTime()) {
        await a.encerrar(e.id, 'parado', 'A cliente respondeu, então o fluxo parou.', this.agora());
        return;
      }
      const p = e.passos[e.passo];
      if (!p) {
        await a.encerrar(e.id, 'concluido', null, this.agora());
        return;
      }
      if (e.fase === 'presenca' && p.presenca !== 'nenhuma') {
        const seg = duracaoPresenca(p);
        // Não espera a resposta do canal (a Evolution segura a chamada enquanto mostra o aviso).
        void this.o.enviador.presenca(c.id, p.presenca, seg).catch((x) => this.o.log?.('Falha ao mostrar "digitando" do fluxo', String(x)));
        await a.avancar(e.id, { passo: e.passo, fase: 'enviar', proximoEm: new Date(this.agora().getTime() + seg * 1000) }, this.agora());
        return;
      }
      // Confere de novo logo antes de enviar: se pararam enquanto esperava, não sai.
      const atual = await a.envio(e.empresaId, e.id);
      if (!atual || atual.situacao !== 'andando') return;

      await this.enviarPasso(c, p, e.iniciadoPor, e.empresaId);
      const prox = e.passo + 1;
      const seguinte = e.passos[prox];
      if (!seguinte) {
        await a.encerrar(e.id, 'concluido', null, this.agora());
        return;
      }
      const ag = agendaDoPasso(seguinte, this.agora());
      await a.avancar(e.id, { passo: prox, fase: ag.fase, proximoEm: ag.quando }, this.agora());
    } catch (x) {
      const msg = x instanceof Error ? x.message : String(x);
      this.o.log?.('Falha no passo do fluxo', { envio: e.id, passo: e.passo, erro: msg });
      await a.encerrar(e.id, 'erro', `O passo ${e.passo + 1} não foi enviado: ${msg}`, this.agora()).catch(() => undefined);
    }
  }

  private async enviarPasso(c: Conversa, p: Passo, atendente: string, empresaId: string): Promise<void> {
    const texto = p.texto ? preencherTexto(p.texto, c, atendente) : '';
    if (p.tipo === 'texto') {
      await this.o.enviador.texto(c.id, texto, atendente);
      return;
    }
    const m = p.midiaId ? await this.o.armazem.midia(empresaId, p.midiaId) : undefined;
    if (!m) throw new Error('o arquivo deste passo não existe mais');
    await this.o.enviador.midia(
      c.id,
      {
        tipo: tipoDaMidia(p.tipo),
        conteudo: m.conteudo,
        mimetype: m.mimetype,
        ...(p.midiaNome || m.nome ? { nomeArquivo: p.midiaNome || m.nome || undefined } : {}),
        ...(texto && p.tipo !== 'audio' ? { legenda: texto } : {}),
        ...(p.tipo === 'audio' && p.duracaoSeg !== undefined ? { duracaoSeg: p.duracaoSeg } : {}),
      },
      atendente,
    );
  }
}

/** O que a tela mostra do envio (faixa "Enviando fluxo 2 de 5 · Parar"). */
export function envioParaTela(e: EnvioFluxo) {
  return {
    id: e.id,
    nome: e.nome,
    situacao: e.situacao,
    motivo: e.motivo,
    total: e.passos.length,
    /** Passo que está para sair (1 = primeiro). */
    passoAtual: Math.min(e.passo + 1, e.passos.length),
    enviados: e.situacao === 'concluido' ? e.passos.length : e.passo,
    tipoProximo: e.passos[e.passo]?.tipo ?? null,
    mostrando: e.situacao === 'andando' && e.fase === 'enviar' && (e.passos[e.passo]?.presenca ?? 'nenhuma') !== 'nenhuma' ? e.passos[e.passo]!.presenca : null,
    proximoEm: e.proximoEm,
    iniciadoPor: e.iniciadoPor,
    iniciadoEm: e.iniciadoEm,
    atualizadoEm: e.atualizadoEm,
  };
}
