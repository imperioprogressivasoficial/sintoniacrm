import type pg from 'pg';
import { z } from 'zod';
import type { Conversa, ModoAtendimento } from '../domain.js';
import type { Auditoria } from '../seguranca/auditoria.js';
import { bahia, DIA, MIN, HORA, partesBahia } from '../util/tempo.js';

/**
 * serena-chave: chave geral "Serena ligada / pausada" da empresa (Automações › Agente de IA e tela Serena).
 *
 * Pausada, é como se faltasse a chave da IA, mas sem mexer na chave:
 *  - a Serena não responde, não sugere, não segue sozinha (follow-ups, lembretes, retorno), os agentes do estúdio
 *    não agem e a cobertura do "Disponível" não passa conversas para ela;
 *  - conversa nova nasce em "Minha resposta" (equipe);
 *  - o modo de cada conversa NÃO muda: ao ligar de novo, tudo volta como estava;
 *  - o chat da Serena dentro do app (a equipe conversando com ela) continua funcionando.
 *
 * A pausa vence sozinha: passou do `ate`, conta como ligada (conferido a cada leitura; sem relógio próprio).
 * A volta automática é registrada UMA vez (auditoria, aviso para a equipe e retomada das conversas recentes).
 *
 * Ao ligar de novo: conversas no modo IA com a última mensagem da cliente sem resposta há menos de 30 min recebem
 * resposta; as mais antigas ficam com a equipe (não responder alguém horas depois).
 */

/** Quanto tempo depois da mensagem da cliente a Serena ainda responde quando volta da pausa. */
export const RETOMAR_ATE_MS = 30 * MIN;

export interface PausaSerena {
  pausada: boolean;
  /** Até quando (null = até alguém ligar de novo). */
  ate: Date | null;
  por: string | null;
  porId: string | null;
  em: Date | null;
  motivo: string | null;
}

/** A última pausa que terminou: a janela em que a equipe ficou com tudo. */
export interface UltimaPausa {
  de: Date;
  ate: Date;
  /** "ligou" (alguém ligou) ou "venceu" (passou da hora). */
  como: 'ligou' | 'venceu';
  por: string | null;
}

export interface RegistroPausa {
  atual: PausaSerena;
  ultima: UltimaPausa | null;
}

export const SEM_PAUSA: PausaSerena = { pausada: false, ate: null, por: null, porId: null, em: null, motivo: null };

const data = z.preprocess((v) => (typeof v === 'string' || v instanceof Date ? new Date(v) : v), z.date().refine((d) => !Number.isNaN(d.getTime())));
const EsquemaGuardado = z.object({
  pausada: z.boolean().catch(false),
  ate: data.nullable().catch(null),
  por: z.string().max(120).nullable().catch(null),
  porId: z.string().max(80).nullable().catch(null),
  em: data.nullable().catch(null),
  motivo: z.string().max(300).nullable().catch(null),
  ultima: z
    .object({ de: data, ate: data, como: z.enum(['ligou', 'venceu']).catch('ligou'), por: z.string().max(120).nullable().catch(null) })
    .nullable()
    .catch(null),
});

/** Lê o que veio do banco sem confiar: formato estranho = Serena ligada. */
export function normalizarPausa(bruto: unknown): RegistroPausa {
  const o = bruto && typeof bruto === 'object' ? (bruto as Record<string, unknown>) : {};
  const r = EsquemaGuardado.safeParse({ pausada: false, ate: null, por: null, porId: null, em: null, motivo: null, ultima: null, ...o });
  if (!r.success) return { atual: { ...SEM_PAUSA }, ultima: null };
  const { ultima, ...atual } = r.data;
  return { atual: atual.pausada ? atual : { ...SEM_PAUSA }, ultima: ultima ?? null };
}

const paraGuardar = (r: RegistroPausa) => ({
  pausada: r.atual.pausada,
  ate: r.atual.ate?.toISOString() ?? null,
  por: r.atual.por,
  porId: r.atual.porId,
  em: r.atual.em?.toISOString() ?? null,
  motivo: r.atual.motivo,
  ultima: r.ultima ? { de: r.ultima.de.toISOString(), ate: r.ultima.ate.toISOString(), como: r.ultima.como, por: r.ultima.por } : null,
});

// ---------------------------------------------------------------- armazém

export interface ArmazemPausa {
  ler(empresaId: string): Promise<unknown>;
  gravar(empresaId: string, valor: ReturnType<typeof paraGuardar>): Promise<void>;
  /**
   * Grava só se a pausa guardada ainda é a mesma (pausada e com o mesmo `em`): entre vários processos,
   * só um registra a volta automática. Devolve true se gravou.
   */
  trocarSe(empresaId: string, emEsperado: string, valor: ReturnType<typeof paraGuardar>): Promise<boolean>;
}

export class ArmazemPausaMemoria implements ArmazemPausa {
  private readonly dados = new Map<string, unknown>();
  async ler(empresaId: string) {
    const v = this.dados.get(empresaId);
    return v ? structuredClone(v) : {};
  }
  async gravar(empresaId: string, valor: ReturnType<typeof paraGuardar>) {
    this.dados.set(empresaId, structuredClone(valor));
  }
  async trocarSe(empresaId: string, emEsperado: string, valor: ReturnType<typeof paraGuardar>) {
    const atual = normalizarPausa(this.dados.get(empresaId)).atual;
    if (!atual.pausada || atual.em?.toISOString() !== emEsperado) return false;
    this.dados.set(empresaId, structuredClone(valor));
    return true;
  }
}

export class ArmazemPausaPostgres implements ArmazemPausa {
  constructor(private readonly pool: pg.Pool) {}
  async ler(empresaId: string) {
    const { rows } = await this.pool.query<{ pausa_serena: unknown }>('select pausa_serena from sintonia.empresas where id = $1', [empresaId]);
    return rows[0]?.pausa_serena ?? {};
  }
  async gravar(empresaId: string, valor: ReturnType<typeof paraGuardar>) {
    await this.pool.query(
      `insert into sintonia.empresas (id, nome, pausa_serena) values ($1, $1, $2)
       on conflict (id) do update set pausa_serena = excluded.pausa_serena`,
      [empresaId, JSON.stringify(valor)],
    );
  }
  async trocarSe(empresaId: string, emEsperado: string, valor: ReturnType<typeof paraGuardar>) {
    const r = await this.pool.query(
      `update sintonia.empresas set pausa_serena = $3
        where id = $1 and pausa_serena->>'pausada' = 'true' and pausa_serena->>'em' = $2`,
      [empresaId, emEsperado, JSON.stringify(valor)],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

// ---------------------------------------------------------------- tempo

export const DURACOES = ['1h', 'amanha', 'indefinido'] as const;
export type Duracao = (typeof DURACOES)[number];

/** Até quando pausar: 1 hora, amanhã às 8h (horário da Bahia) ou até alguém ligar de novo (null). */
export function calcularAte(duracao: Duracao, agora: Date): Date | null {
  if (duracao === '1h') return new Date(agora.getTime() + HORA);
  if (duracao === 'amanha') {
    const p = partesBahia(agora);
    return bahia(p.ano, p.mes, p.dia + 1, 8, 0);
  }
  return null;
}

const DIAS_CURTOS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
/** "15h", "15h30". */
export const horaCurta = (d: Date) => {
  const p = partesBahia(d);
  return `${p.hora}h${p.minuto ? String(p.minuto).padStart(2, '0') : ''}`;
};
/** "até 15h", "até amanhã às 8h", "até sex., 28/11 às 8h" ou "até alguém ligar de novo". */
export function textoAte(ate: Date | null, agora: Date): string {
  if (!ate) return 'até alguém ligar de novo';
  const a = partesBahia(ate);
  const h = partesBahia(agora);
  const hoje = bahia(h.ano, h.mes, h.dia).getTime();
  const dia = bahia(a.ano, a.mes, a.dia).getTime();
  if (dia === hoje) return `até ${horaCurta(ate)}`;
  if (dia === hoje + DIA) return `até amanhã às ${horaCurta(ate)}`;
  return `até ${DIAS_CURTOS[a.diaSemana]}, ${String(a.dia).padStart(2, '0')}/${String(a.mes).padStart(2, '0')} às ${horaCurta(ate)}`;
}

// ---------------------------------------------------------------- a chave

export interface QuemMexeu {
  id?: string | null;
  nome: string;
  papel?: string | null;
  ip?: string | null;
}

export type MudancaPausa =
  | { tipo: 'pausou'; pausa: PausaSerena; por: QuemMexeu }
  | { tipo: 'ligou'; pausa: PausaSerena; ultima: UltimaPausa; por: QuemMexeu }
  | { tipo: 'voltou_sozinha'; pausa: PausaSerena; ultima: UltimaPausa };

export interface OpcoesChaveSerena {
  empresaId: string;
  armazem: ArmazemPausa;
  auditoria?: Auditoria;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

/** Estado para as telas (JSON). */
export interface EstadoPausaTela {
  pausada: boolean;
  ate: string | null;
  por: string | null;
  em: string | null;
  motivo: string | null;
  /** "até 15h", "até amanhã às 8h", "até alguém ligar de novo"; null quando ligada. */
  texto: string | null;
}

export class ChaveSerena {
  private registro: RegistroPausa = { atual: { ...SEM_PAUSA }, ultima: null };
  private readonly ouvintes: Array<(m: MudancaPausa) => Promise<void> | void> = [];
  private vencendo?: Promise<void>;
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;

  constructor(private readonly o: OpcoesChaveSerena) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  /** Lê do banco (ao subir e a cada volta do relógio: outro processo pode ter mexido). */
  async carregar(): Promise<void> {
    try {
      this.registro = normalizarPausa(await this.o.armazem.ler(this.o.empresaId));
    } catch (e) {
      this.log('Falha ao ler a chave da Serena (segue como estava)', String(e));
    }
    this.conferirVencimento();
  }

  /** Avisado a cada mudança (pausou, ligou, voltou sozinha). Falha no ouvinte nunca desfaz a mudança. */
  aoMudar(fn: (m: MudancaPausa) => Promise<void> | void): void {
    this.ouvintes.push(fn);
  }

  /** Está pausada agora? Confere a hora: pausa vencida conta como ligada (e registra a volta, uma vez). */
  pausada(): boolean {
    const p = this.registro.atual;
    if (!p.pausada) return false;
    if (p.ate && p.ate.getTime() <= this.agora().getTime()) {
      this.conferirVencimento();
      return false;
    }
    return true;
  }

  /** A pausa em vigor (ou SEM_PAUSA). */
  atual(): PausaSerena {
    return this.pausada() ? { ...this.registro.atual } : { ...SEM_PAUSA };
  }

  /** A última pausa que terminou (null = nenhuma). */
  ultima(): UltimaPausa | null {
    return this.registro.ultima ? { ...this.registro.ultima } : null;
  }

  paraTela(): EstadoPausaTela {
    const p = this.atual();
    return {
      pausada: p.pausada,
      ate: p.ate?.toISOString() ?? null,
      por: p.por,
      em: p.em?.toISOString() ?? null,
      motivo: p.motivo,
      texto: p.pausada ? textoAte(p.ate, this.agora()) : null,
    };
  }

  /**
   * A mensagem da cliente chegou durante a última pausa e já passou de 30 min: a Serena não responde mais
   * (fica com a equipe). A próxima mensagem da cliente volta ao normal.
   */
  respostaVencida(c: Pick<Conversa, 'ultimaMensagemCliente'>, agora = this.agora()): boolean {
    const u = this.registro.ultima;
    const cli = c.ultimaMensagemCliente?.getTime();
    if (!u || !cli) return false;
    if (cli < u.de.getTime() || cli >= u.ate.getTime()) return false;
    return agora.getTime() - cli >= RETOMAR_ATE_MS;
  }

  async pausar(p: { ate: Date | null; motivo?: string | null; duracao?: Duracao }, por: QuemMexeu): Promise<PausaSerena> {
    const agora = this.agora();
    if (p.ate && p.ate.getTime() <= agora.getTime()) throw Object.assign(new Error('Escolha uma hora que ainda não passou.'), { statusCode: 400 });
    const pausa: PausaSerena = { pausada: true, ate: p.ate, por: por.nome, porId: por.id ?? null, em: agora, motivo: p.motivo?.trim() || null };
    const novo: RegistroPausa = { atual: pausa, ultima: this.registro.ultima };
    await this.o.armazem.gravar(this.o.empresaId, paraGuardar(novo));
    this.registro = novo;
    this.vencendo = undefined;
    await this.auditar('serena_pausou', por, { ate: pausa.ate?.toISOString() ?? null, duracao: p.duracao ?? null, motivo: pausa.motivo });
    await this.avisar({ tipo: 'pausou', pausa, por });
    return { ...pausa };
  }

  /** Liga de novo. Já ligada: não faz nada (devolve false). */
  async ligar(por: QuemMexeu): Promise<boolean> {
    if (!this.pausada()) return false;
    const agora = this.agora();
    const antes = this.registro.atual;
    const ultima: UltimaPausa = { de: antes.em ?? agora, ate: agora, como: 'ligou', por: por.nome };
    const novo: RegistroPausa = { atual: { ...SEM_PAUSA }, ultima };
    await this.o.armazem.gravar(this.o.empresaId, paraGuardar(novo));
    this.registro = novo;
    await this.auditar('serena_ligou', por, { pausadaDesde: antes.em?.toISOString() ?? null, pausadaPor: antes.por });
    await this.avisar({ tipo: 'ligou', pausa: antes, ultima, por });
    return true;
  }

  /** Espera a volta automática em andamento (testes e desligamento). */
  async ocioso(): Promise<void> {
    await this.vencendo;
  }

  private conferirVencimento(): void {
    const p = this.registro.atual;
    if (!p.pausada || !p.ate || p.ate.getTime() > this.agora().getTime() || this.vencendo) return;
    this.vencendo = this.vencer(p).catch((e) => this.log('Falha ao registrar a volta da Serena', String(e)));
  }

  private async vencer(p: PausaSerena): Promise<void> {
    const ultima: UltimaPausa = { de: p.em ?? p.ate!, ate: p.ate!, como: 'venceu', por: null };
    const novo: RegistroPausa = { atual: { ...SEM_PAUSA }, ultima };
    // Só um processo registra a volta (os outros só leem o que ficou gravado).
    const ganhou = p.em ? await this.o.armazem.trocarSe(this.o.empresaId, p.em.toISOString(), paraGuardar(novo)) : (await this.o.armazem.gravar(this.o.empresaId, paraGuardar(novo)), true);
    this.registro = ganhou ? novo : normalizarPausa(await this.o.armazem.ler(this.o.empresaId));
    if (!ganhou) return;
    this.log(`A pausa da Serena acabou (${textoAte(p.ate, p.ate!)}): ela voltou a atender sozinha.`);
    await this.auditar('serena_voltou_sozinha', { nome: 'Sintonia' }, { pausadaPor: p.por, pausadaDesde: p.em?.toISOString() ?? null, ate: p.ate!.toISOString(), nota: 'A pausa acabou na hora marcada e a Serena voltou sozinha.' });
    await this.avisar({ tipo: 'voltou_sozinha', pausa: p, ultima });
  }

  private async auditar(acao: string, por: QuemMexeu, detalhe: Record<string, unknown>): Promise<void> {
    await this.o.auditoria
      ?.registrar({ empresaId: this.o.empresaId, acao, autorId: por.id ?? null, autorNome: por.nome, papel: por.papel ?? null, alvo: 'serena', detalhe, ip: por.ip ?? null, em: this.agora() })
      .catch((e) => this.log('Falha ao registrar a chave da Serena na auditoria', String(e)));
  }

  private async avisar(m: MudancaPausa): Promise<void> {
    for (const fn of this.ouvintes) {
      try {
        await fn(m);
      } catch (e) {
        this.log('Falha num aviso da chave da Serena', String(e));
      }
    }
  }
}

// ---------------------------------------------------------------- textos e retomada

/** Aviso para a equipe: "Fulana pausou a Serena até 15h", "Fulana ligou a Serena de novo", "A pausa acabou". */
export function avisoDaMudanca(m: MudancaPausa, agora: Date): { titulo: string; texto: string } {
  const primeiro = (n: string | null | undefined) => (n ?? '').trim().split(/\s+/)[0] || 'Alguém da gestão';
  if (m.tipo === 'pausou') {
    return {
      titulo: `${primeiro(m.por.nome)} pausou a Serena ${textoAte(m.pausa.ate, agora)}`,
      texto: `Enquanto isso a equipe atende tudo: a Serena não responde nem sugere às clientes, e as conversas novas entram em Minha resposta.${m.pausa.motivo ? ` Motivo: ${m.pausa.motivo}` : ''}`,
    };
  }
  if (m.tipo === 'ligou') {
    return { titulo: `${primeiro(m.por.nome)} ligou a Serena de novo`, texto: 'A Serena voltou a atender. Quem escreveu há menos de 30 minutos recebe resposta; as conversas mais antigas continuam com a equipe.' };
  }
  return { titulo: 'A Serena voltou a atender', texto: `A pausa acabou na hora marcada (${horaCurta(m.ultima.ate)}). Quem escreveu há menos de 30 minutos recebe resposta; as conversas mais antigas continuam com a equipe.` };
}

/**
 * Conversas para a Serena responder ao voltar: modo IA, última mensagem da cliente sem resposta e com menos de
 * 30 min. As outras ficam com a equipe (já aparecem em "Esperando").
 */
export function conversasParaRetomar<C extends Pick<Conversa, 'id' | 'modo' | 'ultimaMensagemCliente' | 'ultimaMensagemEquipe' | 'ultimaMensagemIa'>>(conversas: C[], agora: Date): C[] {
  return conversas.filter((c) => {
    if (c.modo !== 'ia') return false;
    const cli = c.ultimaMensagemCliente?.getTime() ?? 0;
    if (!cli || cli <= Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0)) return false;
    return agora.getTime() - cli < RETOMAR_ATE_MS;
  });
}

// ---------------------------------------------------------------- o portão da IA (um lugar só)

/**
 * O portão único da IA no atendimento: `iaAtiva()` = tem a chave da IA E a Serena não está pausada.
 * Usado onde antes se olhava só a chave (iaLigada / iaDisponivel / temIa).
 */
export function portaoIa(o: { chave: Pick<ChaveSerena, 'pausada'>; temChaveGeral: () => boolean; temIaPara?: (c: Conversa) => Promise<boolean> }) {
  const iaAtiva = () => o.temChaveGeral() && !o.chave.pausada();
  return {
    iaAtiva,
    /** Há IA para esta conversa agora (chave geral ou do agente dela) e a Serena não está pausada. */
    iaPara: async (c: Conversa): Promise<boolean> => !o.chave.pausada() && (o.temIaPara ? await o.temIaPara(c) : o.temChaveGeral()),
    /** Modo em que a conversa nova nasce: o padrão da empresa com IA ativa; pausada ou sem chave, "Minha resposta". */
    modoNovo: async (padrao: () => Promise<ModoAtendimento>): Promise<ModoAtendimento> => (iaAtiva() ? padrao() : 'humano'),
    /** Envolve o "IA atende primeiro": pausada, não escolhe agente (a conversa nasce com a equipe). */
    modoInicial:
      <A extends unknown[]>(fn: (...a: A) => Promise<ModoAtendimento | undefined>) =>
      async (...a: A): Promise<ModoAtendimento | undefined> =>
        o.chave.pausada() ? undefined : fn(...a),
  };
}
