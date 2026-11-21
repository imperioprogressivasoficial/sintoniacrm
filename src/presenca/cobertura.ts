import type pg from 'pg';
import type { Contas, Usuario } from '../auth/contas.js';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { PREFIXO_NOTA_IA } from '../ai/prompt.js';
import { statusDe, type Presencas, type StatusPresenca } from './presenca.js';

/**
 * ia-completa: a IA cobre quem saiu do ar.
 * - A pessoa desliga "Disponível para atender" (fim do turno, almoço): as conversas abertas dela que estão em
 *   "Só eu" passam para a IA (só onde há IA para a conversa), com uma marca de quem a IA está cobrindo.
 *   A dona continua a mesma: nada é transferido.
 * - A pessoa volta a ficar disponível: as conversas que AINDA estão com a marca e com a IA voltam para "Só eu" e a
 *   marca sai. Se alguém mudou o modo à mão no meio (ou a IA passou para a equipe, ou a conversa mudou de dona),
 *   fica como está.
 * - Para a IA, em cada resposta: quantas pessoas estão disponíveis agora (da unidade da conversa) e se a
 *   responsável pela conversa está disponível.
 * Tabela: db/migrations/610_cobertura_ia.sql.
 */

export interface Cobertura {
  conversaId: string;
  usuarioId: string;
  usuarioNome: string | null;
  modoAntes: string;
  desde: Date;
}

export interface ArmazemCobertura {
  marcar(c: Cobertura): Promise<void>;
  daPessoa(usuarioId: string): Promise<Cobertura[]>;
  daConversa(conversaId: string): Promise<Cobertura | undefined>;
  tirar(conversaId: string): Promise<void>;
}

export class ArmazemCoberturaMemoria implements ArmazemCobertura {
  private readonly dados = new Map<string, Cobertura>();
  async marcar(c: Cobertura) {
    this.dados.set(c.conversaId, { ...c });
  }
  async daPessoa(usuarioId: string) {
    return [...this.dados.values()].filter((c) => c.usuarioId === usuarioId).map((c) => ({ ...c }));
  }
  async daConversa(conversaId: string) {
    const c = this.dados.get(conversaId);
    return c ? { ...c } : undefined;
  }
  async tirar(conversaId: string) {
    this.dados.delete(conversaId);
  }
}

export class ArmazemCoberturaPostgres implements ArmazemCobertura {
  constructor(private readonly pool: pg.Pool) {}
  async marcar(c: Cobertura) {
    await this.pool.query(
      `insert into sintonia.cobertura_ia (conversa_id, usuario_id, usuario_nome, modo_antes, desde) values ($1,$2,$3,$4,$5)
       on conflict (conversa_id) do update set usuario_id = excluded.usuario_id, usuario_nome = excluded.usuario_nome, modo_antes = excluded.modo_antes, desde = excluded.desde`,
      [c.conversaId, c.usuarioId, c.usuarioNome, c.modoAntes, c.desde],
    );
  }
  private linha = (r: Record<string, unknown>): Cobertura => ({
    conversaId: String(r.conversa_id),
    usuarioId: String(r.usuario_id),
    usuarioNome: r.usuario_nome ? String(r.usuario_nome) : null,
    modoAntes: String(r.modo_antes),
    desde: new Date(r.desde as string),
  });
  async daPessoa(usuarioId: string) {
    const { rows } = await this.pool.query('select * from sintonia.cobertura_ia where usuario_id = $1', [usuarioId]);
    return rows.map(this.linha);
  }
  async daConversa(conversaId: string) {
    const { rows } = await this.pool.query('select * from sintonia.cobertura_ia where conversa_id = $1', [conversaId]);
    return rows[0] ? this.linha(rows[0]) : undefined;
  }
  async tirar(conversaId: string) {
    await this.pool.query('delete from sintonia.cobertura_ia where conversa_id = $1', [conversaId]);
  }
}

export interface OpcoesCobertura {
  empresaId: string;
  armazem: ArmazemCobertura;
  repo: Pick<Repositorio, 'listarConversas' | 'adicionarMensagem' | 'registrarEvento' | 'salvarConversa'>;
  contas: Pick<Contas, 'listarUsuarios'>;
  presencas: Presencas;
  /** A conversa sob a trava (Sintonia.comConversa). */
  comConversa: <T>(id: string, fn: (c: Conversa) => Promise<T>) => Promise<T | undefined>;
  /** Há IA para esta conversa (chave geral ou do agente)? Sem IA, a conversa não é coberta. */
  temIa: (c: Conversa) => Promise<boolean>;
  /** A IA olha a conversa de novo (responde se a cliente está esperando). */
  reavaliar: (conversaId: string) => Promise<void>;
  /** Quem conta como "pessoa que atende" (padrão: toda pessoa ativa). */
  podeAtender?: (u: Usuario) => Promise<boolean>;
  /** Quando cada conversa foi finalizada (atendimento encerrado). */
  finalizadas?: (ids: string[]) => Promise<Map<string, Date>>;
  /** Nome da IA nas notas ("Serena assumiu..."). */
  nomeIa?: () => string;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

const primeiro = (nome: string | null | undefined) => (nome ?? '').trim().split(/\s+/)[0] || 'Alguém';

/** O que a IA sabe da equipe naquela conversa. */
export interface EquipeAgora {
  texto: string;
  disponiveis: number;
  responsavelDisponivel: boolean | null;
}

export class CoberturaIa {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  constructor(private readonly o: OpcoesCobertura) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  private nomeIa() {
    return this.o.nomeIa?.() || 'Serena';
  }

  /** PUT /api/presenca mudou o status da pessoa (chame só quando mudou). */
  async aoMudar(u: Usuario, status: StatusPresenca): Promise<{ cobertas: number; devolvidas: number }> {
    if (u.empresaId !== this.o.empresaId) return { cobertas: 0, devolvidas: 0 };
    return status === 'offline' ? { cobertas: await this.cobrir(u), devolvidas: 0 } : { cobertas: 0, devolvidas: await this.devolver(u) };
  }

  private async nota(c: Conversa, texto: string) {
    await this.o.repo.adicionarMensagem({ conversaId: c.id, autor: 'sistema', texto: `${PREFIXO_NOTA_IA}${texto}`, em: this.agora() }).catch(() => undefined);
  }

  /** A pessoa saiu do ar: a IA assume as conversas abertas dela em "Só eu". */
  async cobrir(u: Usuario): Promise<number> {
    const todas = (await this.o.repo.listarConversas({ empresaId: this.o.empresaId })).filter((c) => c.responsavelId === u.id && c.modo === 'humano' && c.etapa !== 'perdida');
    const fim = this.o.finalizadas ? await this.o.finalizadas(todas.map((c) => c.id)).catch(() => new Map<string, Date>()) : new Map<string, Date>();
    // Finalizada depois da última mensagem da cliente = atendimento encerrado: não precisa de cobertura.
    const abertas = todas.filter((c) => {
      const f = fim.get(c.id);
      return !f || (c.ultimaMensagemCliente?.getTime() ?? 0) > f.getTime();
    });
    let n = 0;
    for (const c0 of abertas) {
      try {
        if (!(await this.o.temIa(c0))) continue;
        const cobriu = await this.o.comConversa(c0.id, async (c) => {
          if (c.modo !== 'humano' || c.responsavelId !== u.id) return false;
          const em = this.agora();
          c.modo = 'ia';
          c.pausaIaAte = undefined;
          await this.o.repo.salvarConversa(c);
          await this.o.armazem.marcar({ conversaId: c.id, usuarioId: u.id, usuarioNome: u.nome, modoAntes: 'humano', desde: em });
          await this.nota(c, `${this.nomeIa()} assumiu: ${primeiro(u.nome)} ficou indisponível.`);
          await this.o.repo.registrarEvento({ tipo: 'ia_assumiu', conversaId: c.id, unidade: c.unidade, em, dados: { motivo: `${u.nome} ficou indisponível.`, cobertura: true, usuarioId: u.id, por: 'IA' } });
          return true;
        });
        if (!cobriu) continue;
        n++;
        // A cliente pode estar esperando: a IA olha agora.
        await this.o.reavaliar(c0.id).catch((e) => this.log('Cobertura: falha ao chamar a IA', String(e)));
      } catch (e) {
        this.log('Cobertura: falha ao passar a conversa para a IA', String(e));
      }
    }
    return n;
  }

  /** A pessoa voltou: o que a IA ainda está cobrindo volta para ela; o que mudou à mão fica como está. */
  async devolver(u: Usuario): Promise<number> {
    let n = 0;
    for (const cob of await this.o.armazem.daPessoa(u.id)) {
      try {
        const voltou = await this.o.comConversa(cob.conversaId, async (c) => {
          if (c.modo !== 'ia' || c.responsavelId !== u.id) return false;
          c.modo = cob.modoAntes === 'copiloto' ? 'copiloto' : 'humano';
          await this.o.repo.salvarConversa(c);
          await this.nota(c, `${primeiro(u.nome)} voltou: conversa devolvida.`);
          await this.o.repo.registrarEvento({ tipo: 'ia_acao', conversaId: c.id, unidade: c.unidade, em: this.agora(), dados: { acao: 'cobertura_fim', usuarioId: u.id, motivo: `${u.nome} voltou.` } });
          return true;
        });
        await this.o.armazem.tirar(cob.conversaId);
        if (voltou) n++;
      } catch (e) {
        this.log('Cobertura: falha ao devolver a conversa', String(e));
      }
    }
    return n;
  }

  /**
   * Para a IA: quantas pessoas da unidade da conversa estão disponíveis agora e se a responsável está.
   * Falha na leitura = undefined (a IA segue sem essa informação).
   */
  async equipeAgora(c: Conversa): Promise<EquipeAgora | undefined> {
    try {
      const pessoas = (await this.o.contas.listarUsuarios(c.empresaId)).filter((u) => u.ativo && (!u.unidades.length || u.unidades.includes(c.unidade)));
      const atende: Usuario[] = [];
      for (const u of pessoas) if (!this.o.podeAtender || (await this.o.podeAtender(u).catch(() => true))) atende.push(u);
      const ids = atende.map((u) => u.id);
      if (c.responsavelId && !ids.includes(c.responsavelId)) ids.push(c.responsavelId);
      const st = await statusDe(this.o.presencas, ids);
      const livres = atende.filter((u) => st[u.id] === 'online');
      const nomes = livres.slice(0, 6).map((u) => primeiro(u.nome));
      const linhas = [
        `Equipe agora: ${livres.length} ${livres.length === 1 ? 'pessoa disponível' : 'pessoas disponíveis'} para atender${nomes.length ? ` (${nomes.join(', ')}${livres.length > nomes.length ? '…' : ''})` : ''}.`,
      ];
      let responsavelDisponivel: boolean | null = null;
      if (c.responsavelId) {
        const dona = pessoas.find((u) => u.id === c.responsavelId);
        responsavelDisponivel = st[c.responsavelId] === 'online' && Boolean(dona);
        linhas.push(`Responsável por esta conversa: ${primeiro(c.responsavelNome ?? dona?.nome)} — ${responsavelDisponivel ? 'disponível' : 'indisponível'}.`);
      } else linhas.push('Esta conversa ainda não tem responsável.');
      const cob = await this.o.armazem.daConversa(c.id).catch(() => undefined);
      if (cob && c.modo === 'ia') linhas.push(`Você está cobrindo ${primeiro(cob.usuarioNome)}, que ficou indisponível.`);
      return { texto: linhas.join('\n'), disponiveis: livres.length, responsavelDisponivel };
    } catch (e) {
      this.log('Cobertura: falha ao ler a equipe', String(e));
      return undefined;
    }
  }
}
