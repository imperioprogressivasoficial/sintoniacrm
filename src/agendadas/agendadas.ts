import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { MidiaEnvio } from '../channels/tipos.js';
import { LIMITE_ENVIO, semPrefixoDataUrl, tamanhoBase64, tipoPeloMimetype } from '../midia.js';
import { deDataEHora } from '../util/tempo.js';

/**
 * msg-agendada: mensagens agendadas na conversa ("Agendar envio", como o "Programar envio" de outros apps).
 *
 * A pessoa escreve, escolhe dia e hora (horário da empresa, America/Bahia) e o SERVIDOR envia na hora,
 * pelo mesmo caminho de uma mensagem da equipe (WhatsApp oficial ou Evolution), com o nome de quem agendou.
 * - O estado fica no banco: reiniciar o servidor não perde nada.
 * - Cada mensagem sai uma vez só: a reserva troca 'agendada' por 'enviando' numa atualização só
 *   (com vários processos, "skip locked"). Se o servidor cair no meio do envio, ela NÃO é reenviada
 *   às cegas: vira "falhou" com o aviso para conferir na conversa.
 * - Falhou (WhatsApp desconectado, por exemplo): tenta de novo depois de 1, 5 e 15 minutos;
 *   depois marca "falhou" e avisa quem agendou (sino + push).
 * - Conversa apagada: nada sai (a linha some junto, ou é cancelada se a conversa sumir antes do envio).
 */

export const SITUACOES_AGENDADA = ['agendada', 'enviando', 'enviada', 'cancelada', 'falhou'] as const;
export type SituacaoAgendada = (typeof SITUACOES_AGENDADA)[number];
export type TipoAnexoAgendado = MidiaEnvio['tipo'];

/** Esperas (segundos) antes de cada nova tentativa. 3 novas tentativas = 4 no total. */
export const ESPERAS_PADRAO = [60, 300, 900];
/** Mais atrasada que isso (servidor fora do ar na hora): não sai atrasada, vira "falhou". */
export const ATRASO_MAXIMO_MS = 6 * 3600_000;
/** 'enviando' há mais que isso: o servidor caiu no meio do envio. */
export const RESERVA_PRESA_MS = 10 * 60_000;
/** Até quanto tempo para a frente dá para agendar. */
export const MAX_DIAS_FRENTE = 366;
export const MAX_TEXTO = 4096;

export interface AnexoAgendado {
  tipo: TipoAnexoAgendado;
  mimetype: string;
  nome: string | null;
  tamanho: number;
}

export interface MensagemAgendada {
  id: string;
  empresaId: string;
  conversaId: string;
  texto: string;
  anexo: AnexoAgendado | null;
  /** Quando a pessoa pediu para sair. */
  enviarEm: Date;
  /** Próxima tentativa do relógio (igual a enviarEm até a primeira falha). */
  tentarEm: Date;
  situacao: SituacaoAgendada;
  erro: string | null;
  tentativas: number;
  criadoPor: string;
  criadoPorId: string | null;
  criadoEm: Date;
  atualizadoEm: Date;
  enviadoEm: Date | null;
  canceladoPor: string | null;
}

export interface NovoAnexo extends AnexoAgendado {
  conteudo: Buffer;
}

export interface NovaAgendada {
  empresaId: string;
  conversaId: string;
  texto: string;
  anexo: NovoAnexo | null;
  enviarEm: Date;
  criadoPor: string;
  criadoPorId: string | null;
  agora: Date;
}

export interface MudancaAgendada {
  texto?: string;
  enviarEm?: Date;
  /** null = tira o anexo; undefined = mantém. */
  anexo?: NovoAnexo | null;
}

export interface FiltroAgendadas {
  criadoPorId?: string;
  situacoes?: SituacaoAgendada[];
  conversaId?: string;
  limite?: number;
}

export class ErroNaoEditavel extends Error {
  constructor(s: SituacaoAgendada) {
    super(
      s === 'enviada'
        ? 'Esta mensagem já foi enviada.'
        : s === 'enviando'
          ? 'Esta mensagem está saindo agora.'
          : 'Esta mensagem foi cancelada.',
    );
  }
}

// ------------------------------------------------------------ validação

const DATA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const HORA = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM');

export const EntradaAnexo = z.object({
  base64: z.string().min(1),
  mimetype: z
    .string()
    .trim()
    .max(150)
    .regex(/^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/, 'Tipo de arquivo inválido'),
  nomeArquivo: z.string().trim().min(1).max(200).optional(),
});

/** Corpo de criar/editar: dia e hora no horário da empresa (ou o instante pronto, em ISO). */
export const EntradaAgendada = z.object({
  texto: z.string().max(MAX_TEXTO, `Até ${MAX_TEXTO} letras.`).optional(),
  data: DATA.optional(),
  hora: HORA.optional(),
  enviarEm: z.string().datetime({ offset: true }).optional(),
  anexo: EntradaAnexo.optional(),
  removerAnexo: z.boolean().optional(),
});
export type EntradaAgendada = z.infer<typeof EntradaAgendada>;

const erro400 = (msg: string) => Object.assign(new Error(msg), { statusCode: 400 });

/** O instante pedido (data + hora da Bahia, ou ISO). undefined = não veio. */
export function instanteDe(b: Pick<EntradaAgendada, 'data' | 'hora' | 'enviarEm'>): Date | undefined {
  if (b.enviarEm) return new Date(b.enviarEm);
  if (b.data || b.hora) {
    if (!b.data || !b.hora) throw erro400('Escolha o dia e a hora.');
    return deDataEHora(b.data, b.hora);
  }
  return undefined;
}

/** Confere que o horário é daqui para a frente e não longe demais. */
export function conferirHorario(quando: Date, agora: Date): void {
  if (Number.isNaN(quando.getTime())) throw erro400('Dia ou hora inválidos.');
  if (quando.getTime() <= agora.getTime()) throw erro400('Escolha um horário daqui para a frente.');
  if (quando.getTime() > agora.getTime() + MAX_DIAS_FRENTE * 86_400_000) throw erro400('Dá para agendar até um ano para a frente.');
}

/** Lê o anexo enviado pela tela (base64), com o limite do WhatsApp. */
export function anexoDe(a: z.infer<typeof EntradaAnexo>): NovoAnexo {
  const base64 = semPrefixoDataUrl(a.base64).replace(/\s/g, '');
  const tamanho = tamanhoBase64(base64);
  if (tamanho === 0) throw erro400('Arquivo vazio.');
  if (tamanho > LIMITE_ENVIO) throw Object.assign(new Error(`Arquivo grande demais: o limite é ${LIMITE_ENVIO / 1024 / 1024} MB.`), { statusCode: 413 });
  const mimetype = a.mimetype.toLowerCase();
  const pelo = tipoPeloMimetype(mimetype);
  const tipo: TipoAnexoAgendado = pelo === 'figurinha' ? 'imagem' : pelo;
  const conteudo = Buffer.from(base64, 'base64');
  return { tipo, mimetype, nome: a.nomeArquivo ?? null, tamanho: conteudo.length, conteudo };
}

// ------------------------------------------------------------ armazenamento

export interface ArmazemAgendadas {
  criar(n: NovaAgendada): Promise<MensagemAgendada>;
  obter(empresaId: string, id: string): Promise<MensagemAgendada | undefined>;
  conteudoAnexo(empresaId: string, id: string): Promise<Buffer | undefined>;
  listar(empresaId: string, f: FiltroAgendadas): Promise<MensagemAgendada[]>;
  /** Só muda o que ainda não saiu ('agendada' ou 'falhou'); volta a 'agendada' do zero. Outra situação → ErroNaoEditavel. */
  alterar(empresaId: string, id: string, m: MudancaAgendada, agora: Date): Promise<MensagemAgendada | undefined>;
  /** Cancela o que ainda não saiu. Outra situação → ErroNaoEditavel. */
  cancelar(empresaId: string, id: string, por: string, agora: Date): Promise<MensagemAgendada | undefined>;
  /** Reserva as vencidas ('agendada' → 'enviando' de uma vez). Cada uma vai para um processo só. */
  reservar(agora: Date, limite: number): Promise<MensagemAgendada[]>;
  /** Reserva esta (Enviar agora), se ainda não saiu. */
  reservarUma(empresaId: string, id: string, agora: Date): Promise<MensagemAgendada | undefined>;
  /** Saiu. Só vale se estava 'enviando'. */
  concluir(id: string, agora: Date): Promise<boolean>;
  /** Falhou, mas tenta de novo em `tentarEm`. */
  reagendar(id: string, erro: string, tentarEm: Date, agora: Date): Promise<boolean>;
  /** Encerra sem enviar ('falhou' ou 'cancelada'). Só vale se estava 'enviando'. */
  encerrar(id: string, situacao: 'falhou' | 'cancelada', erro: string, contaTentativa: boolean, agora: Date): Promise<boolean>;
  /** 'enviando' reservadas antes de `antesDe` (o servidor caiu no meio): viram 'falhou'. Devolve as que mudaram. */
  soltarPresas(antesDe: Date, erro: string, agora: Date): Promise<MensagemAgendada[]>;
}

const copia = <T>(x: T): T => structuredClone(x);
const EDITAVEIS: SituacaoAgendada[] = ['agendada', 'falhou'];

type LinhaMemoria = MensagemAgendada & { conteudo: Buffer | null; reservadoEm: Date | null };

export class AgendadasMemoria implements ArmazemAgendadas {
  private readonly linhas = new Map<string, LinhaMemoria>();

  private pub(l: LinhaMemoria): MensagemAgendada {
    const { conteudo: _c, reservadoEm: _r, ...m } = l;
    return copia(m);
  }
  async criar(n: NovaAgendada) {
    const id = randomUUID();
    const { conteudo, ...anexo } = n.anexo ?? ({} as NovoAnexo);
    this.linhas.set(id, {
      id,
      empresaId: n.empresaId,
      conversaId: n.conversaId,
      texto: n.texto,
      anexo: n.anexo ? (anexo as AnexoAgendado) : null,
      enviarEm: n.enviarEm,
      tentarEm: n.enviarEm,
      situacao: 'agendada',
      erro: null,
      tentativas: 0,
      criadoPor: n.criadoPor,
      criadoPorId: n.criadoPorId,
      criadoEm: n.agora,
      atualizadoEm: n.agora,
      enviadoEm: null,
      canceladoPor: null,
      conteudo: n.anexo ? conteudo : null,
      reservadoEm: null,
    });
    return this.pub(this.linhas.get(id)!);
  }
  async obter(empresaId: string, id: string) {
    const l = this.linhas.get(id);
    return l && l.empresaId === empresaId ? this.pub(l) : undefined;
  }
  async conteudoAnexo(empresaId: string, id: string) {
    const l = this.linhas.get(id);
    return l && l.empresaId === empresaId && l.conteudo ? Buffer.from(l.conteudo) : undefined;
  }
  async listar(empresaId: string, f: FiltroAgendadas) {
    return [...this.linhas.values()]
      .filter(
        (l) =>
          l.empresaId === empresaId &&
          (!f.criadoPorId || l.criadoPorId === f.criadoPorId) &&
          (!f.conversaId || l.conversaId === f.conversaId) &&
          (!f.situacoes?.length || f.situacoes.includes(l.situacao)),
      )
      .sort((a, b) => a.enviarEm.getTime() - b.enviarEm.getTime())
      .slice(0, f.limite ?? 300)
      .map((l) => this.pub(l));
  }
  async alterar(empresaId: string, id: string, m: MudancaAgendada, agora: Date) {
    const l = this.linhas.get(id);
    if (!l || l.empresaId !== empresaId) return undefined;
    if (!EDITAVEIS.includes(l.situacao)) throw new ErroNaoEditavel(l.situacao);
    if (m.texto !== undefined) l.texto = m.texto;
    if (m.enviarEm) l.enviarEm = m.enviarEm;
    if (m.anexo === null) {
      l.anexo = null;
      l.conteudo = null;
    } else if (m.anexo) {
      const { conteudo, ...a } = m.anexo;
      l.anexo = a;
      l.conteudo = conteudo;
    }
    Object.assign(l, { situacao: 'agendada', tentativas: 0, erro: null, tentarEm: l.enviarEm, atualizadoEm: agora });
    return this.pub(l);
  }
  async cancelar(empresaId: string, id: string, por: string, agora: Date) {
    const l = this.linhas.get(id);
    if (!l || l.empresaId !== empresaId) return undefined;
    if (!EDITAVEIS.includes(l.situacao)) throw new ErroNaoEditavel(l.situacao);
    Object.assign(l, { situacao: 'cancelada', canceladoPor: por, atualizadoEm: agora });
    return this.pub(l);
  }
  async reservar(agora: Date, limite: number) {
    const vencidas = [...this.linhas.values()]
      .filter((l) => l.situacao === 'agendada' && l.tentarEm <= agora)
      .sort((a, b) => a.tentarEm.getTime() - b.tentarEm.getTime())
      .slice(0, limite);
    for (const l of vencidas) Object.assign(l, { situacao: 'enviando', reservadoEm: agora, atualizadoEm: agora });
    return vencidas.map((l) => this.pub(l));
  }
  async reservarUma(empresaId: string, id: string, agora: Date) {
    const l = this.linhas.get(id);
    if (!l || l.empresaId !== empresaId) return undefined;
    if (!EDITAVEIS.includes(l.situacao)) throw new ErroNaoEditavel(l.situacao);
    Object.assign(l, { situacao: 'enviando', reservadoEm: agora, atualizadoEm: agora });
    return this.pub(l);
  }
  private mudarSeEnviando(id: string, mudar: (l: LinhaMemoria) => void) {
    const l = this.linhas.get(id);
    if (!l || l.situacao !== 'enviando') return false;
    mudar(l);
    return true;
  }
  async concluir(id: string, agora: Date) {
    return this.mudarSeEnviando(id, (l) => Object.assign(l, { situacao: 'enviada', enviadoEm: agora, erro: null, tentativas: l.tentativas + 1, reservadoEm: null, atualizadoEm: agora }));
  }
  async reagendar(id: string, erro: string, tentarEm: Date, agora: Date) {
    return this.mudarSeEnviando(id, (l) => Object.assign(l, { situacao: 'agendada', erro, tentarEm, tentativas: l.tentativas + 1, reservadoEm: null, atualizadoEm: agora }));
  }
  async encerrar(id: string, situacao: 'falhou' | 'cancelada', erro: string, contaTentativa: boolean, agora: Date) {
    return this.mudarSeEnviando(id, (l) => Object.assign(l, { situacao, erro, tentativas: l.tentativas + (contaTentativa ? 1 : 0), reservadoEm: null, atualizadoEm: agora }));
  }
  async soltarPresas(antesDe: Date, erro: string, agora: Date) {
    const presas = [...this.linhas.values()].filter((l) => l.situacao === 'enviando' && l.reservadoEm && l.reservadoEm < antesDe);
    for (const l of presas) Object.assign(l, { situacao: 'falhou', erro, reservadoEm: null, atualizadoEm: agora });
    return presas.map((l) => this.pub(l));
  }

  /** Só para testes: a conversa foi apagada (no Postgres, o "on delete cascade" faz isso). */
  apagarDaConversa(conversaId: string) {
    for (const [id, l] of this.linhas) if (l.conversaId === conversaId) this.linhas.delete(id);
  }
}

interface Linha {
  id: string;
  empresa_id: string;
  conversa_id: string;
  texto: string;
  anexo_tipo: TipoAnexoAgendado | null;
  anexo_mimetype: string | null;
  anexo_nome: string | null;
  anexo_tamanho: number | null;
  enviar_em: Date;
  tentar_em: Date;
  situacao: SituacaoAgendada;
  erro: string | null;
  tentativas: number;
  criado_por: string;
  criado_por_id: string | null;
  criado_em: Date;
  atualizado_em: Date;
  enviado_em: Date | null;
  cancelado_por: string | null;
}
/** Tudo menos o conteúdo do anexo (que só é lido na hora de enviar). */
const COLUNAS = `id, empresa_id, conversa_id, texto, anexo_tipo, anexo_mimetype, anexo_nome, anexo_tamanho, enviar_em, tentar_em,
  situacao, erro, tentativas, criado_por, criado_por_id, criado_em, atualizado_em, enviado_em, cancelado_por`;
const daLinha = (l: Linha): MensagemAgendada => ({
  id: l.id,
  empresaId: l.empresa_id,
  conversaId: l.conversa_id,
  texto: l.texto,
  anexo: l.anexo_tipo ? { tipo: l.anexo_tipo, mimetype: l.anexo_mimetype ?? 'application/octet-stream', nome: l.anexo_nome, tamanho: l.anexo_tamanho ?? 0 } : null,
  enviarEm: l.enviar_em,
  tentarEm: l.tentar_em,
  situacao: l.situacao,
  erro: l.erro,
  tentativas: l.tentativas,
  criadoPor: l.criado_por,
  criadoPorId: l.criado_por_id,
  criadoEm: l.criado_em,
  atualizadoEm: l.atualizado_em,
  enviadoEm: l.enviado_em,
  canceladoPor: l.cancelado_por,
});
const Uuid = z.string().uuid();
const ehUuid = (id: string) => Uuid.safeParse(id).success;

export class AgendadasPostgres implements ArmazemAgendadas {
  constructor(private readonly pool: pg.Pool) {}

  async criar(n: NovaAgendada) {
    const a = n.anexo;
    const { rows } = await this.pool.query<Linha>(
      `insert into sintonia.mensagens_agendadas (id, empresa_id, conversa_id, texto, anexo_tipo, anexo_mimetype, anexo_nome, anexo_tamanho, anexo_conteudo,
         enviar_em, tentar_em, criado_por, criado_por_id, criado_em, atualizado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, $13, $13) returning ${COLUNAS}`,
      [randomUUID(), n.empresaId, n.conversaId, n.texto, a?.tipo ?? null, a?.mimetype ?? null, a?.nome ?? null, a?.tamanho ?? null, a?.conteudo ?? null, n.enviarEm, n.criadoPor, n.criadoPorId, n.agora],
    );
    return daLinha(rows[0]!);
  }
  async obter(empresaId: string, id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<Linha>(`select ${COLUNAS} from sintonia.mensagens_agendadas where empresa_id = $1 and id = $2`, [empresaId, id]);
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async conteudoAnexo(empresaId: string, id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<{ anexo_conteudo: Buffer | null }>('select anexo_conteudo from sintonia.mensagens_agendadas where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0]?.anexo_conteudo ?? undefined;
  }
  async listar(empresaId: string, f: FiltroAgendadas) {
    if (f.conversaId && !ehUuid(f.conversaId)) return [];
    const { rows } = await this.pool.query<Linha>(
      `select ${COLUNAS} from sintonia.mensagens_agendadas
        where empresa_id = $1 and ($2::text is null or criado_por_id = $2) and ($3::text[] is null or situacao = any($3))
          and ($4::uuid is null or conversa_id = $4)
        order by enviar_em limit $5`,
      [empresaId, f.criadoPorId ?? null, f.situacoes?.length ? f.situacoes : null, f.conversaId ?? null, f.limite ?? 300],
    );
    return rows.map(daLinha);
  }
  private async situacaoDe(empresaId: string, id: string): Promise<SituacaoAgendada | undefined> {
    const { rows } = await this.pool.query<{ situacao: SituacaoAgendada }>('select situacao from sintonia.mensagens_agendadas where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0]?.situacao;
  }
  async alterar(empresaId: string, id: string, m: MudancaAgendada, agora: Date) {
    if (!ehUuid(id)) return undefined;
    const trocaAnexo = m.anexo !== undefined;
    const a = m.anexo ?? null;
    const { rows } = await this.pool.query<Linha>(
      `update sintonia.mensagens_agendadas set
          texto = coalesce($3, texto),
          enviar_em = coalesce($4, enviar_em),
          tentar_em = coalesce($4, enviar_em),
          anexo_tipo = case when $5 then $6 else anexo_tipo end,
          anexo_mimetype = case when $5 then $7 else anexo_mimetype end,
          anexo_nome = case when $5 then $8 else anexo_nome end,
          anexo_tamanho = case when $5 then $9::integer else anexo_tamanho end,
          anexo_conteudo = case when $5 then $10::bytea else anexo_conteudo end,
          situacao = 'agendada', tentativas = 0, erro = null, atualizado_em = $11
        where empresa_id = $1 and id = $2 and situacao in ('agendada', 'falhou') returning ${COLUNAS}`,
      [empresaId, id, m.texto ?? null, m.enviarEm ?? null, trocaAnexo, a?.tipo ?? null, a?.mimetype ?? null, a?.nome ?? null, a?.tamanho ?? null, a?.conteudo ?? null, agora],
    );
    if (rows[0]) return daLinha(rows[0]);
    const s = await this.situacaoDe(empresaId, id);
    if (s) throw new ErroNaoEditavel(s);
    return undefined;
  }
  async cancelar(empresaId: string, id: string, por: string, agora: Date) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<Linha>(
      `update sintonia.mensagens_agendadas set situacao = 'cancelada', cancelado_por = $3, atualizado_em = $4
        where empresa_id = $1 and id = $2 and situacao in ('agendada', 'falhou') returning ${COLUNAS}`,
      [empresaId, id, por, agora],
    );
    if (rows[0]) return daLinha(rows[0]);
    const s = await this.situacaoDe(empresaId, id);
    if (s) throw new ErroNaoEditavel(s);
    return undefined;
  }
  async reservar(agora: Date, limite: number) {
    const { rows } = await this.pool.query<Linha>(
      `update sintonia.mensagens_agendadas set situacao = 'enviando', reservado_em = $1, atualizado_em = $1
        where id in (
          select id from sintonia.mensagens_agendadas
           where situacao = 'agendada' and tentar_em <= $1
           order by tentar_em limit $2 for update skip locked)
          and situacao = 'agendada'
        returning ${COLUNAS}`,
      [agora, limite],
    );
    return rows.map(daLinha).sort((a, b) => a.tentarEm.getTime() - b.tentarEm.getTime());
  }
  async reservarUma(empresaId: string, id: string, agora: Date) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<Linha>(
      `update sintonia.mensagens_agendadas set situacao = 'enviando', reservado_em = $3, atualizado_em = $3
        where empresa_id = $1 and id = $2 and situacao in ('agendada', 'falhou') returning ${COLUNAS}`,
      [empresaId, id, agora],
    );
    if (rows[0]) return daLinha(rows[0]);
    const s = await this.situacaoDe(empresaId, id);
    if (s) throw new ErroNaoEditavel(s);
    return undefined;
  }
  async concluir(id: string, agora: Date) {
    const r = await this.pool.query(
      `update sintonia.mensagens_agendadas set situacao = 'enviada', enviado_em = $2, erro = null, tentativas = tentativas + 1,
          reservado_em = null, atualizado_em = $2, anexo_conteudo = null
        where id = $1 and situacao = 'enviando'`,
      [id, agora],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async reagendar(id: string, erro: string, tentarEm: Date, agora: Date) {
    const r = await this.pool.query(
      `update sintonia.mensagens_agendadas set situacao = 'agendada', erro = $2, tentar_em = $3, tentativas = tentativas + 1,
          reservado_em = null, atualizado_em = $4
        where id = $1 and situacao = 'enviando'`,
      [id, erro, tentarEm, agora],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async encerrar(id: string, situacao: 'falhou' | 'cancelada', erro: string, contaTentativa: boolean, agora: Date) {
    const r = await this.pool.query(
      `update sintonia.mensagens_agendadas set situacao = $2, erro = $3, tentativas = tentativas + $4, reservado_em = null, atualizado_em = $5
        where id = $1 and situacao = 'enviando'`,
      [id, situacao, erro, contaTentativa ? 1 : 0, agora],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async soltarPresas(antesDe: Date, erro: string, agora: Date) {
    const { rows } = await this.pool.query<Linha>(
      `update sintonia.mensagens_agendadas set situacao = 'falhou', erro = $2, reservado_em = null, atualizado_em = $3
        where situacao = 'enviando' and reservado_em < $1 returning ${COLUNAS}`,
      [antesDe, erro, agora],
    );
    return rows.map(daLinha);
  }
}

// ------------------------------------------------------------ o relógio (envio pelo servidor)

/** Como o relógio fala com o resto do sistema: o MESMO caminho de uma mensagem da equipe pela conversa. */
export interface EnviadorAgendadas {
  conversa(conversaId: string): Promise<Conversa | undefined>;
  texto(conversaId: string, texto: string, atendente: string): Promise<void>;
  midia(conversaId: string, midia: MidiaEnvio, atendente: string): Promise<void>;
}

export interface OpcoesMotorAgendadas {
  armazem: ArmazemAgendadas;
  enviador: EnviadorAgendadas;
  /** Aviso para quem agendou quando não deu para enviar (sino + push). */
  avisar?: (m: MensagemAgendada, conversa: Conversa | undefined) => Promise<void>;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Esperas (s) antes de cada nova tentativa. */
  esperas?: number[];
  limite?: number;
}

const msgDe = (x: unknown) => (x instanceof Error ? x.message : String(x));
const ehConversaSumida = (x: unknown) => /Conversa não encontrada/i.test(msgDe(x));

export class MotorAgendadas {
  private rodando = false;
  private readonly agora: () => Date;
  private readonly esperas: number[];

  constructor(private readonly o: OpcoesMotorAgendadas) {
    this.agora = o.agora ?? (() => new Date());
    this.esperas = o.esperas ?? ESPERAS_PADRAO;
  }

  /** Tentativas no total (a primeira + as novas). */
  get maxTentativas(): number {
    return this.esperas.length + 1;
  }

  /** Uma volta do relógio: envia o que venceu. Devolve quantas foram tratadas. */
  async tick(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      const agora = this.agora();
      const presas = await this.o.armazem.soltarPresas(
        new Date(agora.getTime() - RESERVA_PRESA_MS),
        'O servidor reiniciou na hora do envio. Confira na conversa se a mensagem saiu antes de enviar de novo.',
        agora,
      );
      for (const m of presas) await this.avisar(m, undefined);
      const vencidas = await this.o.armazem.reservar(agora, this.o.limite ?? 30);
      // Conversas diferentes em paralelo; na mesma conversa, na ordem do horário.
      const porConversa = new Map<string, MensagemAgendada[]>();
      for (const m of vencidas) porConversa.set(m.conversaId, [...(porConversa.get(m.conversaId) ?? []), m]);
      await Promise.all([...porConversa.values()].map(async (lista) => {
        for (const m of lista) await this.enviar(m);
      }));
      return vencidas.length;
    } finally {
      this.rodando = false;
    }
  }

  /** "Enviar agora" na tela: reserva esta e envia já. Devolve como ficou. */
  async enviarAgora(empresaId: string, id: string): Promise<MensagemAgendada | undefined> {
    const m = await this.o.armazem.reservarUma(empresaId, id, this.agora());
    if (!m) return undefined;
    await this.enviar(m, true);
    return this.o.armazem.obter(empresaId, id);
  }

  private async avisar(m: MensagemAgendada, c: Conversa | undefined) {
    if (!this.o.avisar) return;
    await this.o.avisar(m, c).catch((x) => this.o.log?.('Falha ao avisar da mensagem agendada', msgDe(x)));
  }

  private async enviar(m: MensagemAgendada, naHora = false): Promise<void> {
    const a = this.o.armazem;
    let c: Conversa | undefined;
    try {
      c = await this.o.enviador.conversa(m.conversaId);
      if (!c || c.empresaId !== m.empresaId) {
        await a.encerrar(m.id, 'cancelada', 'A conversa foi apagada, então a mensagem não foi enviada.', false, this.agora());
        return;
      }
      // Servidor fora do ar na hora marcada: um "bom dia" não pode sair à noite.
      if (!naHora && m.tentativas === 0 && this.agora().getTime() - m.enviarEm.getTime() > ATRASO_MAXIMO_MS) {
        await a.encerrar(m.id, 'falhou', 'Passou muito da hora marcada (o sistema estava fora do ar). Envie agora ou escolha outro horário.', false, this.agora());
        await this.avisar({ ...m, situacao: 'falhou' }, c);
        return;
      }
      if (m.anexo) {
        const conteudo = await a.conteudoAnexo(m.empresaId, m.id);
        if (!conteudo) throw new Error('o arquivo anexado não existe mais');
        const legenda = m.anexo.tipo === 'audio' ? undefined : m.texto.trim() || undefined;
        await this.o.enviador.midia(c.id, { tipo: m.anexo.tipo, conteudo, mimetype: m.anexo.mimetype, ...(m.anexo.nome ? { nomeArquivo: m.anexo.nome } : {}), ...(legenda ? { legenda } : {}) }, m.criadoPor);
        // Áudio não tem legenda: o texto vai logo depois, numa mensagem à parte.
        if (m.anexo.tipo === 'audio' && m.texto.trim()) await this.o.enviador.texto(c.id, m.texto.trim(), m.criadoPor);
      } else {
        await this.o.enviador.texto(c.id, m.texto, m.criadoPor);
      }
      await a.concluir(m.id, this.agora());
    } catch (x) {
      const motivo = msgDe(x);
      this.o.log?.('Falha ao enviar mensagem agendada', { id: m.id, tentativa: m.tentativas + 1, erro: motivo });
      const agora = this.agora();
      if (ehConversaSumida(x)) {
        await a.encerrar(m.id, 'cancelada', 'A conversa foi apagada, então a mensagem não foi enviada.', false, agora).catch(() => undefined);
        return;
      }
      const feitas = m.tentativas + 1;
      // "Enviar agora" que falhou: a pessoa está olhando; volta para "falhou" sem esperar novas tentativas.
      if (!naHora && feitas < this.maxTentativas) {
        const espera = this.esperas[feitas - 1] ?? this.esperas.at(-1) ?? 60;
        await a.reagendar(m.id, motivo, new Date(agora.getTime() + espera * 1000), agora).catch(() => undefined);
        return;
      }
      const texto = naHora ? `Não foi enviada: ${motivo}` : `Não foi enviada depois de ${feitas} tentativas: ${motivo}`;
      await a.encerrar(m.id, 'falhou', texto, true, agora).catch(() => undefined);
      if (!naHora) await this.avisar({ ...m, situacao: 'falhou', erro: texto, tentativas: feitas }, c);
    }
  }
}

/** O que a tela recebe (sem o conteúdo do anexo). */
export function agendadaParaTela(m: MensagemAgendada, podeEditar: boolean) {
  return {
    id: m.id,
    conversaId: m.conversaId,
    texto: m.texto,
    anexo: m.anexo,
    enviarEm: m.enviarEm,
    situacao: m.situacao,
    erro: m.erro,
    tentativas: m.tentativas,
    criadoPor: m.criadoPor,
    criadoPorId: m.criadoPorId,
    criadoEm: m.criadoEm,
    enviadoEm: m.enviadoEm,
    canceladoPor: m.canceladoPor,
    podeEditar,
  };
}
