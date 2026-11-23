import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Auditoria } from '../seguranca/auditoria.js';
import type { RepositorioMemoria } from '../store/repositorio.js';

/**
 * trocar-numero: a loja trocou o WhatsApp de um canal (instância da Evolution "sintonia-…") por outro número.
 *
 * - O número conectado em cada canal fica guardado (sintonia.whatsapp_numeros, migração 770). Quando o canal
 *   conecta com um número diferente do guardado, a troca fica pendente e a tela de Conexões pergunta o que fazer
 *   com as conversas do número anterior: Manter, Arquivar ou Apagar.
 * - Sem número guardado (primeira vez, ou dados de antes desta versão): só pergunta se alguém acabou de conectar
 *   pela tela (QR Code ou código) e o canal já tinha conversas de antes. Um canal que só aparece conectado
 *   (sem ninguém pareando) apenas guarda o número, sem perguntar nada.
 * - "Conversas do número anterior" = do mesmo canal e da mesma loja, criadas antes da troca e sem nenhuma mensagem
 *   depois dela (a cliente que já escreveu para o número novo fica de fora).
 * - Arquivar: sai da lista, dos contadores, da busca, do Pipeline e dos relatórios para todo mundo; dá para consultar
 *   em Conversas › "Arquivadas do número antigo" e desarquivar. Mensagem nova da cliente tira do arquivo.
 * - Apagar (só administração e direção, digitando APAGAR): apaga de verdade, em lotes pequenos (uma transação por
 *   lote), com andamento. Agendamentos (vendas) ficam nos relatórios sem a ligação com a conversa; reuniões, tarefas
 *   da rotina, chat da equipe e custo da IA também só perdem a ligação. Contato que só existia por causa dessas
 *   conversas é apagado. Fica registrado na auditoria.
 */

export type Acao = 'manter' | 'arquivar' | 'apagar';

/** Quanto tempo as cópias de segurança guardam o banco (scripts/gerar-deploy.mjs: 7 diárias + as de domingo do mês). */
export const AVISO_COPIAS =
  'As cópias de segurança do sistema ainda guardam esses dados por um tempo: as diárias por 7 dias e as de domingo por até 5 semanas. Depois somem sozinhas.';

export interface RegistroNumero {
  canalId: string;
  empresaId: string;
  unidade: string | null;
  numero: string | null;
  conectadoEm: Date | null;
  pareandoDesde: Date | null;
  trocaEm: Date | null;
  numeroAnterior: string | null;
  trocaPendente: boolean;
}

export interface ArmazemNumeros {
  ler(canalId: string): Promise<RegistroNumero | undefined>;
  gravar(r: RegistroNumero): Promise<void>;
}

/** As conversas de um número: canal + loja, criadas antes do corte e sem mensagem depois dele. */
export interface AlvoNumero {
  empresaId: string;
  canalId: string;
  unidade: string;
  corte: Date;
  /** Leva também as que já estão arquivadas (apagar leva; arquivar não precisa). */
  arquivadas: boolean;
}

export interface Resumo {
  conversas: number;
  mensagens: number;
  /** Fotos, áudios, vídeos e documentos. */
  midias: number;
  /** Contatos (fichas) que só existem por causa dessas conversas. */
  contatos: number;
}
const zero = (): Resumo => ({ conversas: 0, mensagens: 0, midias: 0, contatos: 0 });

export interface LimpezaNumero {
  resumo(alvo: AlvoNumero): Promise<Resumo>;
  arquivar(alvo: AlvoNumero, em: Date): Promise<number>;
  /** Apaga até `limite` conversas do alvo (uma transação). Devolve o que saiu; conversas = 0 quando acabou. */
  apagarLote(alvo: AlvoNumero, limite: number): Promise<Resumo>;
  /** Quantas conversas do canal estão arquivadas agora. */
  arquivadas(empresaId: string, canalId: string): Promise<number>;
}

export interface Quem {
  id?: string | null;
  nome?: string | null;
  papel: string;
}
export const podeApagar = (q: Pick<Quem, 'papel'>) => q.papel === 'admin' || q.papel === 'direcao';

export interface Trabalho {
  id: string;
  canalId: string;
  estado: 'apagando' | 'pronto' | 'erro';
  total: Resumo;
  feito: Resumo;
  erro?: string;
  inicio: Date;
  fim?: Date;
}

export interface SituacaoTroca {
  trocaEm: Date;
  numeroAnterior: string | null;
  numeroNovo: string | null;
  resumo: Resumo;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });
const digitos = (n: string | null | undefined) => {
  const d = String(n ?? '').split('@')[0]!.replace(/\D/g, '');
  return d.length >= 8 ? d : null;
};

export interface OpcoesTroca {
  empresaId: string;
  armazem: ArmazemNumeros;
  limpeza: LimpezaNumero;
  auditoria?: Auditoria;
  /** Loja de cada canal (Conexões): para o webhook de conexão. */
  canais?: () => Array<{ canalId: string; unidade: string }>;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Conversas por lote ao apagar. */
  lote?: number;
  /** Respiro entre um lote e outro (o servidor segue atendendo). */
  pausa?: () => Promise<void>;
}

export class TrocaNumero {
  private readonly agora: () => Date;
  private readonly trabalhos = new Map<string, Trabalho>();
  private readonly rodando = new Map<string, Promise<void>>();

  constructor(private readonly o: OpcoesTroca) {
    this.agora = o.agora ?? (() => new Date());
  }

  private novo(canalId: string, unidade: string | null): RegistroNumero {
    return { canalId, empresaId: this.o.empresaId, unidade, numero: null, conectadoEm: null, pareandoDesde: null, trocaEm: null, numeroAnterior: null, trocaPendente: false };
  }

  /** Alguém pediu QR Code ou código na tela: a próxima conexão pode ser outro número. */
  async pareando(canalId: string, unidade: string): Promise<void> {
    const r = (await this.o.armazem.ler(canalId)) ?? this.novo(canalId, unidade);
    await this.o.armazem.gravar({ ...r, unidade, pareandoDesde: this.agora() });
  }

  /**
   * O canal está conectado com este número (lido da Evolution ou do aviso de conexão).
   * Devolve true quando detectou a troca agora.
   */
  async observar(canalId: string, unidade: string, numeroBruto: string | null | undefined): Promise<boolean> {
    const numero = digitos(numeroBruto);
    if (!numero) return false;
    const atual = await this.o.armazem.ler(canalId);
    const r = atual ?? this.novo(canalId, unidade);
    if (r.numero === numero) {
      if (r.pareandoDesde || r.unidade !== unidade) await this.o.armazem.gravar({ ...r, unidade, pareandoDesde: null });
      return false;
    }
    const agora = this.agora();
    // Outro número no lugar de um conhecido, ou alguém acabou de conectar um canal sem número guardado.
    const troca = Boolean(r.numero) || Boolean(r.pareandoDesde);
    await this.o.armazem.gravar({
      ...r,
      unidade,
      numero,
      conectadoEm: agora,
      pareandoDesde: null,
      ...(troca ? { trocaEm: agora, numeroAnterior: r.numero, trocaPendente: true } : {}),
    });
    if (troca) this.o.log?.('WhatsApp: outro número conectado no canal', { canalId, anterior: r.numero ? 'conhecido' : 'desconhecido' });
    return troca;
  }

  /** Aviso de conexão da Evolution (connection.update com state "open" e wuid). Nunca lança. */
  async aoWebhook(corpo: unknown): Promise<void> {
    try {
      const c = corpo as { event?: unknown; instance?: unknown; data?: Record<string, unknown> };
      const evento = String(c?.event ?? '').toLowerCase().replace(/_/g, '.');
      if (evento !== 'connection.update' || !c.data || c.data.state !== 'open') return;
      const instancia = typeof c.instance === 'string' ? c.instance : String(c.data.instance ?? '');
      const canal = this.o.canais?.().find((x) => x.canalId === instancia);
      if (!canal) return;
      await this.observar(canal.canalId, canal.unidade, String(c.data.wuid ?? c.data.ownerJid ?? ''));
    } catch (e) {
      this.o.log?.('Falha ao ler o número conectado do WhatsApp', String(e));
    }
  }

  private alvo(canalId: string, unidade: string, corte: Date, arquivadas: boolean): AlvoNumero {
    return { empresaId: this.o.empresaId, canalId, unidade, corte, arquivadas };
  }

  /** Troca esperando a decisão, com o que existe do número anterior. Sem nada para decidir, encerra a pendência. */
  async situacao(canalId: string, unidade: string): Promise<SituacaoTroca | null> {
    const r = await this.o.armazem.ler(canalId);
    if (!r?.trocaPendente || !r.trocaEm) return null;
    const resumo = await this.o.limpeza.resumo(this.alvo(canalId, unidade, r.trocaEm, false));
    if (!resumo.conversas) {
      await this.o.armazem.gravar({ ...r, trocaPendente: false });
      return null;
    }
    return { trocaEm: r.trocaEm, numeroAnterior: r.numeroAnterior, numeroNovo: r.numero, resumo };
  }

  /** Tudo o que existe deste canal agora (botão "Apagar os dados deste WhatsApp"). */
  async dados(canalId: string, unidade: string): Promise<{ resumo: Resumo; ativas: number; arquivadas: number; aviso: string }> {
    const resumo = await this.o.limpeza.resumo(this.alvo(canalId, unidade, this.agora(), true));
    const arquivadas = await this.o.limpeza.arquivadas(this.o.empresaId, canalId);
    return { resumo, ativas: Math.max(0, resumo.conversas - arquivadas), arquivadas, aviso: AVISO_COPIAS };
  }

  /**
   * Decide o que fazer com as conversas.
   * - `origem: 'troca'`: as do número anterior (pendência da troca). `origem: 'tudo'`: todas do canal até agora.
   * - apagar exige administração ou direção e a palavra APAGAR; começa por trás e devolve o trabalho.
   */
  async decidir(p: { canalId: string; unidade: string; acao: Acao; quem: Quem; origem: 'troca' | 'tudo'; confirmacao?: string }): Promise<{ arquivadas?: number; trabalho?: Trabalho }> {
    if (!podeApagar(p.quem)) throw erro('Só a administração e a direção decidem o que fazer com as conversas de um número.', 403);
    const r = (await this.o.armazem.ler(p.canalId)) ?? this.novo(p.canalId, p.unidade);
    let corte: Date;
    if (p.origem === 'troca') {
      if (!r.trocaPendente || !r.trocaEm) throw erro('Não há troca de número esperando decisão.', 409);
      corte = r.trocaEm;
    } else {
      if (p.acao === 'manter') return {};
      corte = this.agora();
    }
    const fechar = async () => {
      if (p.origem === 'troca') await this.o.armazem.gravar({ ...r, trocaPendente: false });
    };
    if (p.acao === 'manter') {
      await fechar();
      return {};
    }
    if (p.acao === 'arquivar') {
      const n = await this.o.limpeza.arquivar(this.alvo(p.canalId, p.unidade, corte, false), this.agora());
      await fechar();
      await this.auditar(p.quem, 'arquivou as conversas de um WhatsApp', p.canalId, { unidade: p.unidade, conversas: n, origem: p.origem, corte: corte.toISOString(), ...(p.origem === 'troca' ? { numeroAnteriorConhecido: Boolean(r.numeroAnterior) } : {}) });
      return { arquivadas: n };
    }
    if (String(p.confirmacao ?? '').trim().toUpperCase() !== 'APAGAR') throw erro('Para apagar, digite APAGAR.', 400);
    if (this.rodando.has(p.canalId)) throw erro('Já estamos apagando os dados deste WhatsApp. Aguarde terminar.', 409);
    // Na troca: as que estavam na pergunta (as já arquivadas antes ficam; o botão "Apagar os dados" leva todas).
    const alvo = this.alvo(p.canalId, p.unidade, corte, p.origem === 'tudo');
    const total = await this.o.limpeza.resumo(alvo);
    const t: Trabalho = { id: randomUUID(), canalId: p.canalId, estado: 'apagando', total, feito: zero(), inicio: this.agora() };
    this.trabalhos.set(t.id, t);
    await fechar();
    const corrida = this.apagar(t, alvo, p.quem, p.origem).finally(() => this.rodando.delete(p.canalId));
    this.rodando.set(p.canalId, corrida);
    return { trabalho: { ...t } };
  }

  private async apagar(t: Trabalho, alvo: AlvoNumero, quem: Quem, origem: 'troca' | 'tudo'): Promise<void> {
    const lote = this.o.lote ?? 25;
    const pausa = this.o.pausa ?? (() => new Promise<void>((ok) => setTimeout(ok, 30)));
    try {
      // Sem laço infinito: no máximo uma volta por conversa (+ folga).
      for (let i = 0; i <= t.total.conversas + 5; i++) {
        const r = await this.o.limpeza.apagarLote(alvo, lote);
        if (!r.conversas) break;
        t.feito = { conversas: t.feito.conversas + r.conversas, mensagens: t.feito.mensagens + r.mensagens, midias: t.feito.midias + r.midias, contatos: t.feito.contatos + r.contatos };
        await pausa();
      }
      t.estado = 'pronto';
    } catch (e) {
      t.estado = 'erro';
      t.erro = 'Parou no meio: ' + String((e as Error).message ?? e).slice(0, 200) + '. O que já saiu não volta; toque em apagar de novo para continuar.';
      this.o.log?.('Falha ao apagar os dados de um WhatsApp', String(e));
    }
    t.fim = this.agora();
    await this.auditar(quem, 'apagou os dados de um WhatsApp', t.canalId, {
      unidade: alvo.unidade,
      origem,
      corte: alvo.corte.toISOString(),
      conversas: t.feito.conversas,
      mensagens: t.feito.mensagens,
      midias: t.feito.midias,
      contatos: t.feito.contatos,
      terminou: t.estado === 'pronto',
    });
  }

  private async auditar(quem: Quem, acao: string, alvo: string, detalhe: Record<string, unknown>) {
    await this.o.auditoria
      ?.registrar({ empresaId: this.o.empresaId, acao, autorId: quem.id ?? null, autorNome: quem.nome ?? null, papel: quem.papel, alvo, detalhe, em: this.agora() })
      .catch((e) => this.o.log?.('Falha ao gravar a auditoria', String(e)));
  }

  trabalho(id: string): Trabalho | undefined {
    const t = this.trabalhos.get(id);
    return t ? { ...t } : undefined;
  }

  /** Termina quando o que está apagando acabar (testes). */
  async ocioso(): Promise<void> {
    await Promise.all([...this.rodando.values()]);
  }
}

// ---------------------------------------------------------------- guardar o número de cada canal

export class ArmazemNumerosMemoria implements ArmazemNumeros {
  readonly linhas = new Map<string, RegistroNumero>();
  async ler(canalId: string) {
    const r = this.linhas.get(canalId);
    return r ? { ...r } : undefined;
  }
  async gravar(r: RegistroNumero) {
    this.linhas.set(r.canalId, { ...r });
  }
}

export class ArmazemNumerosPostgres implements ArmazemNumeros {
  constructor(private readonly pool: pg.Pool) {}
  async ler(canalId: string) {
    const { rows } = await this.pool.query<{
      canal_id: string; empresa_id: string; unidade: string | null; numero: string | null; conectado_em: Date | null; pareando_desde: Date | null;
      troca_em: Date | null; numero_anterior: string | null; troca_pendente: boolean;
    }>('select * from sintonia.whatsapp_numeros where canal_id = $1', [canalId]);
    const x = rows[0];
    if (!x) return undefined;
    return {
      canalId: x.canal_id, empresaId: x.empresa_id, unidade: x.unidade, numero: x.numero, conectadoEm: x.conectado_em, pareandoDesde: x.pareando_desde,
      trocaEm: x.troca_em, numeroAnterior: x.numero_anterior, trocaPendente: x.troca_pendente,
    };
  }
  async gravar(r: RegistroNumero) {
    await this.pool.query(
      `insert into sintonia.whatsapp_numeros (canal_id, empresa_id, unidade, numero, conectado_em, pareando_desde, troca_em, numero_anterior, troca_pendente)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (canal_id) do update set empresa_id = excluded.empresa_id, unidade = excluded.unidade, numero = excluded.numero,
         conectado_em = excluded.conectado_em, pareando_desde = excluded.pareando_desde, troca_em = excluded.troca_em,
         numero_anterior = excluded.numero_anterior, troca_pendente = excluded.troca_pendente, atualizado_em = now()`,
      [r.canalId, r.empresaId, r.unidade, r.numero, r.conectadoEm, r.pareandoDesde, r.trocaEm, r.numeroAnterior, r.trocaPendente],
    );
  }
}

// ---------------------------------------------------------------- arquivar e apagar no banco

/** As conversas do alvo (sobre `c`): $1 empresa, $2 canal, $3 loja, $4 corte, $5 leva arquivadas. */
const ALVO = `c.empresa_id = $1 and c.canal_id = $2 and c.unidade = $3 and c.criada_em < $4
  and ($5::boolean or c.arquivada_em is null)
  and not exists (select 1 from sintonia.mensagens m where m.conversa_id = c.id and m.em >= $4)`;
const valoresAlvo = (a: AlvoNumero) => [a.empresaId, a.canalId, a.unidade, a.corte, a.arquivadas];
/** Outra conversa da empresa (fora das que vão sair) com o mesmo telefone do contato `k`. */
const OUTRA_CONVERSA = (k: string) => `exists (select 1 from sintonia.conversas x where x.empresa_id = ${k}.empresa_id
  and (x.telefone = ${k}.telefone or (${k}.telefone_chave is not null and x.telefone_chave = ${k}.telefone_chave)))`;

export class LimpezaNumeroPostgres implements LimpezaNumero {
  constructor(private readonly pool: pg.Pool) {}

  async resumo(a: AlvoNumero): Promise<Resumo> {
    const { rows } = await this.pool.query<Resumo>(
      `with alvo as materialized (select c.id, c.telefone from sintonia.conversas c where ${ALVO})
       select (select count(*) from alvo)::int as conversas,
              (select count(*) from sintonia.mensagens m where m.conversa_id in (select id from alvo))::int as mensagens,
              (select count(*) from sintonia.midias md join sintonia.mensagens m on m.id = md.mensagem_id
                where m.conversa_id in (select id from alvo))::int as midias,
              (select count(*) from sintonia.contatos k where k.empresa_id = $1 and k.telefone in (select telefone from alvo)
                and not exists (select 1 from sintonia.conversas x where x.empresa_id = $1 and x.id not in (select id from alvo)
                                 and (x.telefone = k.telefone or (k.telefone_chave is not null and x.telefone_chave = k.telefone_chave))))::int as contatos`,
      valoresAlvo(a),
    );
    return rows[0] ?? zero();
  }

  async arquivar(a: AlvoNumero, em: Date): Promise<number> {
    const r = await this.pool.query(
      `update sintonia.conversas c set arquivada_em = $6, arquivada_motivo = 'numero_antigo' where ${ALVO} and c.arquivada_em is null`,
      [...valoresAlvo(a), em],
    );
    return r.rowCount ?? 0;
  }

  async arquivadas(empresaId: string, canalId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      'select count(*)::int as n from sintonia.conversas where empresa_id = $1 and canal_id = $2 and arquivada_em is not null',
      [empresaId, canalId],
    );
    return rows[0]?.n ?? 0;
  }

  async apagarLote(a: AlvoNumero, limite: number): Promise<Resumo> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      // Espera curta por trava: nunca fica parado segurando o atendimento.
      await c.query("set local lock_timeout = '5s'");
      const { rows: alvo } = await c.query<{ id: string; telefone: string }>(
        `select c.id, c.telefone from sintonia.conversas c where ${ALVO} order by c.id limit $6 for update skip locked`,
        [...valoresAlvo(a), limite],
      );
      if (!alvo.length) {
        await c.query('commit');
        return zero();
      }
      const ids = alvo.map((x) => x.id);
      const tels = [...new Set(alvo.map((x) => x.telefone))];
      const chaves = tels.map((t) => `${a.canalId}|${t}`);
      const { rows: [conta] } = await c.query<{ mensagens: number; midias: number }>(
        `select (select count(*) from sintonia.mensagens where conversa_id = any($1::uuid[]))::int as mensagens,
                (select count(*) from sintonia.midias md join sintonia.mensagens m on m.id = md.mensagem_id where m.conversa_id = any($1::uuid[]))::int as midias`,
        [ids],
      );
      const passo = async (sql: string, valores: unknown[]): Promise<number> => {
        await c.query('savepoint passo');
        try {
          const r = await c.query(sql, valores);
          await c.query('release savepoint passo');
          return r.rowCount ?? 0;
        } catch (e) {
          const codigo = (e as { code?: string }).code;
          await c.query('rollback to savepoint passo');
          // 42P01 tabela não existe, 42703 coluna não existe (instalação mais antiga): pula.
          if (codigo !== '42P01' && codigo !== '42703') throw e;
          return 0;
        }
      };
      // Agendamentos (vendas) ficam nos relatórios: perdem a conversa e guardam a empresa, a dona e se compareceu.
      await passo(
        `update sintonia.eventos e set conversa_id = null,
           dados = coalesce(e.dados, '{}'::jsonb) || jsonb_build_object('empresaId', c.empresa_id, 'conversaApagada', true,
             'responsavelId', c.responsavel_id::text,
             'compareceu', (c.etapa = 'compareceu' or exists (select 1 from sintonia.eventos x where x.conversa_id = c.id and x.tipo = 'etapa_mudou'
                                                          and x.dados->>'para' = 'compareceu' and x.em >= e.em)))
          from sintonia.conversas c
         where c.id = e.conversa_id and e.conversa_id = any($1::uuid[]) and e.tipo in ('agendamento_ia', 'agendamento_equipe')`,
        [ids],
      );
      // O resto do histórico da conversa (mensagem nova, respostas, etapas, ligações…) vai junto.
      await passo('delete from sintonia.eventos where conversa_id = any($1::uuid[])', [ids]);
      // Fazem sentido sozinhos: só perdem a ligação com a conversa.
      await passo('update sintonia.reunioes set conversa_id = null where conversa_id = any($1::uuid[])', [ids]);
      await passo('update sintonia.rotina_tarefas set conversa_id = null where conversa_id = any($1::uuid[])', [ids]);
      await passo('update sintonia.equipe_mensagens set conversa_id = null where conversa_id = any($1::uuid[])', [ids]);
      await passo('update sintonia.ia_uso set conversa_id = null where conversa_id = any($1::text[])', [ids]);
      await passo('delete from sintonia.ia_bloqueios where conversa_id = any($1::text[])', [ids]);
      // Memória da IA sobre essas clientes e a fila de entrada já processada (tem o texto das mensagens).
      await passo('delete from sintonia.memoria_cliente where conversa_id = any($1::uuid[])', [ids]);
      await passo(`delete from sintonia.entrada where status in ('feita', 'falhou') and conversa_chave = any($1::text[]) and criada_em < $2`, [chaves, a.corte]);
      // A conversa: mensagens, mídias, transcrições, notas, reações, favoritas, fixadas, funil, tags, radar,
      // follow-ups, agendadas, fluxos, leituras, NPS, perdas, valores do cartão… saem junto (on delete cascade).
      const conversas = await passo('delete from sintonia.conversas where id = any($1::uuid[])', [ids]);
      // Contato, foto e memória que só existiam por causa dessas conversas.
      const contatos = await passo(`delete from sintonia.contatos k where k.empresa_id = $1 and k.telefone = any($2::text[]) and not ${OUTRA_CONVERSA('k')}`, [a.empresaId, tels]);
      await passo(
        `delete from sintonia.memoria_cliente mc where mc.empresa_id = $1 and mc.telefone = any($2::text[])
           and not exists (select 1 from sintonia.conversas x where x.empresa_id = $1 and x.telefone = mc.telefone)`,
        [a.empresaId, tels],
      );
      await passo('delete from sintonia.fotos f where f.telefone = any($1::text[]) and not exists (select 1 from sintonia.conversas x where x.telefone = f.telefone)', [tels]);
      await c.query('commit');
      return { conversas, mensagens: conta?.mensagens ?? 0, midias: conta?.midias ?? 0, contatos };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
}

/** Memória (testes e uso local): as mesmas regras sobre o RepositorioMemoria. Contatos ficam de fora (armazém à parte). */
export class LimpezaNumeroMemoria implements LimpezaNumero {
  constructor(private readonly repo: RepositorioMemoria) {}

  private async ids(a: AlvoNumero): Promise<string[]> {
    const todas = (await this.repo.listarConversas({ empresaId: a.empresaId, incluirArquivadas: true })).filter(
      (c) => c.canalId === a.canalId && c.unidade === a.unidade && c.criadaEm < a.corte && (a.arquivadas || !c.arquivadaEm),
    );
    const { ultima } = this.repo.contarMensagensMemoria(todas.map((c) => c.id));
    return todas.filter((c) => !(ultima.get(c.id) && ultima.get(c.id)! >= a.corte)).map((c) => c.id);
  }

  async resumo(a: AlvoNumero): Promise<Resumo> {
    const ids = await this.ids(a);
    const { mensagens, midias } = this.repo.contarMensagensMemoria(ids);
    return { conversas: ids.length, mensagens, midias, contatos: 0 };
  }

  async arquivar(a: AlvoNumero, em: Date): Promise<number> {
    return this.repo.arquivarConversas(a.empresaId, await this.ids({ ...a, arquivadas: false }), em, 'numero_antigo');
  }

  async arquivadas(empresaId: string, canalId: string): Promise<number> {
    return (await this.repo.listarConversas({ empresaId, incluirArquivadas: true })).filter((c) => c.canalId === canalId && c.arquivadaEm).length;
  }

  async apagarLote(a: AlvoNumero, limite: number): Promise<Resumo> {
    const ids = (await this.ids(a)).sort().slice(0, limite);
    return { ...this.repo.apagarConversasMemoria(ids), contatos: 0 };
  }
}
