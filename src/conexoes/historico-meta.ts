import type pg from 'pg';
import { ErroMeta } from '../channels/meta.js';
import type { PaginaConversasSocial } from '../channels/meta-social.js';
import type { MensagemRecebida } from '../channels/tipos.js';

/**
 * meta-historico: ao conectar o Instagram (Direct) ou o Facebook (Messenger), traz as conversas antigas para a
 * Sintonia, como já acontece com o WhatsApp (src/app/historico.ts).
 *
 * - Lê pela Graph API da Meta (Conversations API) as conversas mais recentes da conta, página por página
 *   (25 por vez, das mais novas para as mais antigas), até 300 conversas ou até chegar nas paradas há mais de 90 dias.
 *   De cada conversa vêm as 20 mensagens mais recentes (a Meta só dá detalhes dessas 20).
 * - Cada página vai para `importar` (o `Sintonia.importarHistorico` de sempre: sem IA, automações nem avisos).
 *   Mensagem repetida (mesmo id da Meta) não entra duas vezes.
 * - O andamento (cursor da próxima página e as contagens) fica no banco: se o app reiniciar no meio, continua de onde
 *   parou ao subir. Repetir a última página é seguro.
 * - Sem permissão para ler (pages_messaging / instagram_manage_messages), para com uma mensagem clara; as mensagens
 *   novas continuam chegando normalmente pelo webhook.
 */
export type RedeMeta = 'messenger' | 'instagram';
export type SituacaoHistoricoMeta = 'rodando' | 'pronto' | 'erro';

export interface EstadoHistoricoMeta {
  rede: RedeMeta;
  situacao: SituacaoHistoricoMeta;
  /** Conta (Página / conta do Instagram) em que a leitura começou: se mudar, começa de novo. */
  contaId: string;
  /** Cursor da próxima página na Graph API (vazio = a primeira). */
  cursor?: string;
  paginas: number;
  /** Conversas lidas da Meta (entraram ou já estavam). */
  lidas: number;
  /** Conversas que ganharam mensagens novas. */
  conversas: number;
  mensagens: number;
  /** Conversas paradas desde antes disto ficam de fora. */
  corte: Date;
  erro?: string;
  iniciadoEm: Date;
  atualizadoEm: Date;
  terminadoEm?: Date;
}

export interface ArmazemHistoricoMeta {
  ler(rede: RedeMeta): Promise<EstadoHistoricoMeta | undefined>;
  gravar(e: EstadoHistoricoMeta): Promise<void>;
  rodando(): Promise<EstadoHistoricoMeta[]>;
}

export class ArmazemHistoricoMetaMemoria implements ArmazemHistoricoMeta {
  private readonly linhas = new Map<RedeMeta, EstadoHistoricoMeta>();
  async ler(rede: RedeMeta) {
    const e = this.linhas.get(rede);
    return e ? { ...e } : undefined;
  }
  async gravar(e: EstadoHistoricoMeta) {
    this.linhas.set(e.rede, { ...e });
  }
  async rodando() {
    return [...this.linhas.values()].filter((e) => e.situacao === 'rodando').map((e) => ({ ...e }));
  }
}

interface LinhaHistoricoMeta {
  rede: RedeMeta;
  situacao: SituacaoHistoricoMeta;
  conta_id: string;
  cursor: string | null;
  paginas: number;
  lidas: number;
  conversas: number;
  mensagens: number;
  corte: Date;
  erro: string | null;
  iniciado_em: Date;
  atualizado_em: Date;
  terminado_em: Date | null;
}
const daLinha = (r: LinhaHistoricoMeta): EstadoHistoricoMeta => ({
  rede: r.rede, situacao: r.situacao, contaId: r.conta_id, paginas: r.paginas, lidas: r.lidas, conversas: r.conversas, mensagens: r.mensagens,
  corte: new Date(r.corte), iniciadoEm: new Date(r.iniciado_em), atualizadoEm: new Date(r.atualizado_em),
  ...(r.cursor ? { cursor: r.cursor } : {}), ...(r.erro ? { erro: r.erro } : {}), ...(r.terminado_em ? { terminadoEm: new Date(r.terminado_em) } : {}),
});

export class ArmazemHistoricoMetaPostgres implements ArmazemHistoricoMeta {
  constructor(private readonly pool: pg.Pool) {}
  async ler(rede: RedeMeta) {
    const { rows } = await this.pool.query<LinhaHistoricoMeta>('select * from sintonia.meta_historico where rede = $1', [rede]);
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async gravar(e: EstadoHistoricoMeta) {
    await this.pool.query(
      `insert into sintonia.meta_historico (rede, situacao, conta_id, cursor, paginas, lidas, conversas, mensagens, corte, erro, iniciado_em, atualizado_em, terminado_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict (rede) do update set situacao = excluded.situacao, conta_id = excluded.conta_id, cursor = excluded.cursor,
         paginas = excluded.paginas, lidas = excluded.lidas, conversas = excluded.conversas, mensagens = excluded.mensagens,
         corte = excluded.corte, erro = excluded.erro, iniciado_em = excluded.iniciado_em, atualizado_em = excluded.atualizado_em,
         terminado_em = excluded.terminado_em`,
      [e.rede, e.situacao, e.contaId, e.cursor ?? null, e.paginas, e.lidas, e.conversas, e.mensagens, e.corte, e.erro ?? null, e.iniciadoEm, e.atualizadoEm, e.terminadoEm ?? null],
    );
  }
  async rodando() {
    const { rows } = await this.pool.query<LinhaHistoricoMeta>("select * from sintonia.meta_historico where situacao = 'rodando'");
    return rows.map(daLinha);
  }
}

/** Limites da leitura: dá uma boa base de conversas sem demorar nem gastar a cota da Meta. */
export const LIMITES_HISTORICO_META = { dias: 90, conversas: 300, mensagensPorConversa: 20, porPagina: 25 };

export const SEM_PERMISSAO_HISTORICO =
  'A Meta não deu permissão para ler as conversas antigas. As mensagens novas continuam chegando normalmente. Para trazer as antigas, o app da Meta precisa da permissão de mensagens (pages_messaging no Facebook; instagram_manage_messages no Instagram) e, depois, toque em “Trazer conversas antigas” de novo.';
export const TOKEN_VENCIDO_HISTORICO = 'O token da conta venceu ou foi trocado: gere outro no painel da Meta, cole em Conexões e tente de novo.';

/** Erro que não adianta tentar de novo (falta permissão ou token): a mensagem já é a que vai para a tela. */
function erroDefinitivo(e: unknown): string | undefined {
  if (!(e instanceof ErroMeta)) return undefined;
  const c = e.codigo;
  if (c === 190 || c === 102 || c === 463 || c === 467) return TOKEN_VENCIDO_HISTORICO;
  // 10 / 200-299 = permissão; 3 = o app não tem a capacidade; 230 = falta pages_messaging; 403 sem código = recusado.
  if (c === 10 || c === 3 || c === 230 || (c !== undefined && c >= 200 && c <= 299) || (c === undefined && e.status === 403)) return SEM_PERMISSAO_HISTORICO;
  if (c === 100 && e.status === 400) return `A Meta recusou a leitura das conversas antigas: confira o ID da conta em Conexões. (${e.message.slice(0, 160)})`;
  return undefined;
}

export interface ContaHistoricoMeta {
  contaId: string;
  listar: (o: { depois?: string; porPagina: number; mensagens: number }) => Promise<PaginaConversasSocial>;
}

export interface OpcoesHistoricoMeta {
  armazem: ArmazemHistoricoMeta;
  /** A conta ligada agora (undefined = desligada ou incompleta). */
  conta: (rede: RedeMeta) => ContaHistoricoMeta | undefined;
  importar: (mensagens: MensagemRecebida[]) => Promise<{ conversas: number; mensagens: number }>;
  limites?: Partial<typeof LIMITES_HISTORICO_META>;
  /** Pausa entre páginas (não estoura o limite de chamadas da Meta). */
  pausaMs?: number;
  /** Espera entre tentativas depois de uma falha passageira (base; dobra a cada vez). */
  esperaFalhaMs?: number;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export class HistoricoMeta {
  private readonly rodadas = new Map<RedeMeta, Promise<void>>();
  private parar = false;
  private readonly lim: typeof LIMITES_HISTORICO_META;

  constructor(private readonly o: OpcoesHistoricoMeta) {
    this.lim = { ...LIMITES_HISTORICO_META, ...o.limites };
  }

  private agora() {
    return this.o.agora?.() ?? new Date();
  }

  /** Começa a trazer as conversas antigas (ou devolve o andamento, se já está trazendo). */
  async iniciar(rede: RedeMeta): Promise<EstadoHistoricoMeta> {
    const conta = this.o.conta(rede);
    if (!conta) throw Object.assign(new Error(rede === 'messenger' ? 'Ligue o Facebook Messenger e preencha a Página e o token primeiro.' : 'Ligue o Instagram Direct e preencha a conta e o token primeiro.'), { statusCode: 400 });
    const atual = await this.o.armazem.ler(rede);
    if (atual?.situacao === 'rodando' && atual.contaId === conta.contaId) {
      this.andar(rede);
      return atual;
    }
    const agora = this.agora();
    const novo: EstadoHistoricoMeta = {
      rede, situacao: 'rodando', contaId: conta.contaId, paginas: 0, lidas: 0, conversas: 0, mensagens: 0,
      corte: new Date(agora.getTime() - this.lim.dias * 86_400_000), iniciadoEm: agora, atualizadoEm: agora,
    };
    await this.o.armazem.gravar(novo);
    this.andar(rede);
    return novo;
  }

  situacao(rede: RedeMeta): Promise<EstadoHistoricoMeta | undefined> {
    return this.o.armazem.ler(rede);
  }

  /** Ao subir: continua o que ficou pela metade antes de reiniciar. */
  async continuar(): Promise<void> {
    for (const e of await this.o.armazem.rodando()) this.andar(e.rede);
  }

  /** Para depois da página em andamento (desligamento). O resto continua ao subir. */
  async encerrar(): Promise<void> {
    this.parar = true;
    await Promise.allSettled([...this.rodadas.values()]);
  }

  /** Espera terminar (testes). */
  async ocioso(): Promise<void> {
    while (this.rodadas.size) await Promise.allSettled([...this.rodadas.values()]);
  }

  private andar(rede: RedeMeta): void {
    if (this.rodadas.has(rede) || this.parar) return;
    const p = this.rodar(rede)
      .catch((e) => this.o.log?.('Histórico da Meta: falha inesperada', String(e)))
      .finally(() => this.rodadas.delete(rede));
    this.rodadas.set(rede, p);
  }

  private async rodar(rede: RedeMeta): Promise<void> {
    let falhas = 0;
    while (!this.parar) {
      const e = await this.o.armazem.ler(rede);
      if (!e || e.situacao !== 'rodando') return;
      const conta = this.o.conta(rede);
      const terminar = async (situacao: SituacaoHistoricoMeta, erro?: string) => {
        const agora = this.agora();
        await this.o.armazem.gravar({ ...e, situacao, ...(erro ? { erro } : {}), atualizadoEm: agora, terminadoEm: agora });
      };
      if (!conta || conta.contaId !== e.contaId) {
        await terminar('erro', 'A conta foi desligada ou trocada no meio: conecte de novo para trazer as conversas antigas.');
        return;
      }
      let prox: EstadoHistoricoMeta;
      let acabou: boolean;
      try {
        const pagina = await conta.listar({ ...(e.cursor ? { depois: e.cursor } : {}), porPagina: this.lim.porPagina, mensagens: this.lim.mensagensPorConversa });
        // As mais novas primeiro: a primeira parada antes do corte encerra a leitura.
        const cabem = Math.max(0, this.lim.conversas - e.lidas);
        const dentro = pagina.conversas.filter((c) => c.atualizada.getTime() >= e.corte.getTime()).slice(0, cabem);
        const mensagens = dentro.flatMap((c) => c.mensagens);
        const r = mensagens.length ? await this.o.importar(mensagens) : { conversas: 0, mensagens: 0 };
        acabou = dentro.length < pagina.conversas.length || !pagina.proximo || e.lidas + dentro.length >= this.lim.conversas;
        const agora = this.agora();
        prox = {
          ...e,
          paginas: e.paginas + 1, lidas: e.lidas + dentro.length, conversas: e.conversas + r.conversas, mensagens: e.mensagens + r.mensagens,
          atualizadoEm: agora,
          ...(acabou ? { situacao: 'pronto' as const, terminadoEm: agora } : {}),
        };
        delete prox.cursor;
        if (pagina.proximo && !acabou) prox.cursor = pagina.proximo;
      } catch (x) {
        // Sem permissão / token vencido: para na hora. Falha passageira (rede, banco): tenta de novo algumas vezes.
        const definitivo = erroDefinitivo(x);
        if (definitivo || ++falhas >= 4) {
          this.o.log?.(`Histórico da Meta (${rede}) parado`, String((x as Error).message ?? x));
          await terminar('erro', definitivo ?? `Não deu para ler as conversas antigas agora (${String((x as Error).message ?? x).slice(0, 200)}). As mensagens novas continuam chegando.`);
          return;
        }
        await dormir(Math.min((this.o.esperaFalhaMs ?? 2000) * 2 ** (falhas - 1), 30_000));
        continue;
      }
      falhas = 0;
      await this.o.armazem.gravar(prox);
      if (acabou) return;
      if (this.o.pausaMs) await dormir(this.o.pausaMs);
    }
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O que a tela mostra do andamento. */
export function andamentoParaTela(e: EstadoHistoricoMeta | undefined) {
  if (!e) return { situacao: 'parado' as const, lidas: 0, conversas: 0, mensagens: 0, limite: LIMITES_HISTORICO_META.conversas, dias: LIMITES_HISTORICO_META.dias };
  return {
    situacao: e.situacao,
    lidas: e.lidas,
    conversas: e.conversas,
    mensagens: e.mensagens,
    paginas: e.paginas,
    limite: LIMITES_HISTORICO_META.conversas,
    dias: LIMITES_HISTORICO_META.dias,
    erro: e.erro ?? null,
    iniciadoEm: e.iniciadoEm.toISOString(),
    terminadoEm: e.terminadoEm?.toISOString() ?? null,
  };
}
