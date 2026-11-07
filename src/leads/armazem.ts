import type pg from 'pg';
import type { Contato, ContatosMemoria } from '../contatos/contatos.js';
import type { RepositorioMemoria } from '../store/repositorio.js';
import type { ArmazemTags } from '../tags/tags.js';

/**
 * O que a tela de Leads precisa do banco além do Repositorio e da ficha do contato:
 * listar fichas, apagar a ficha mesclada, juntar duas conversas e guardar os "não é duplicata".
 */
export interface ArmazemLeads {
  /** Todas as fichas da empresa, com quando nasceram. */
  contatos(empresaId: string): Promise<Array<Contato & { criadoEm: Date | null }>>;
  apagarContato(empresaId: string, telefone: string): Promise<void>;
  /**
   * Junta a conversa `deId` em `paraId`: mensagens (com mídias), eventos, tags (sem duplicar etapa de funil),
   * tarefas pendentes que a outra não tem e a data de criação mais antiga. Depois apaga `deId`.
   */
  unirConversas(deId: string, paraId: string): Promise<void>;
  /** Troca o telefone da conversa (mesclar quando a principal não tem conversa naquela unidade). */
  trocarTelefone(conversaId: string, telefone: string): Promise<void>;
  /** Pares "telefoneA|telefoneB" (em ordem) marcados como pessoas diferentes. */
  naoDuplicatas(empresaId: string): Promise<Set<string>>;
  marcarNaoDuplicata(empresaId: string, pares: Array<[string, string]>, por: string): Promise<void>;
}

const ordenar = ([a, b]: [string, string]): [string, string] => (a < b ? [a, b] : [b, a]);

export class ArmazemLeadsMemoria implements ArmazemLeads {
  private readonly nao = new Map<string, Set<string>>();
  constructor(
    private readonly repo: RepositorioMemoria,
    private readonly fichas: ContatosMemoria,
    private readonly tags?: ArmazemTags,
  ) {}

  async contatos(empresaId: string) {
    return (await this.fichas.listar(empresaId)).map((c) => ({ ...c, criadoEm: c.atualizadoEm }));
  }
  async apagarContato(empresaId: string, telefone: string) {
    await this.fichas.apagar(empresaId, telefone);
  }
  async unirConversas(deId: string, paraId: string) {
    const [de, para] = await Promise.all([this.repo.buscarConversa(deId), this.repo.buscarConversa(paraId)]);
    if (!de || !para) return;
    if (this.tags) {
      const etapasPara = new Set((await this.tags.etapasDaConversa(paraId)).map((m) => m.funilId));
      const etapasDe = new Map((await this.tags.etapasDaConversa(deId)).map((m) => [m.tagId, m]));
      for (const tagId of (await this.tags.marcacoes(para.empresaId, [deId])).get(deId) ?? []) {
        const etapa = etapasDe.get(tagId);
        if (etapa) {
          if (!etapasPara.has(etapa.funilId)) await this.tags.marcarEtapa(paraId, tagId, etapa.funilId, 'mescla', etapa.desde);
        } else await this.tags.marcar(paraId, tagId, 'mescla', new Date());
        await this.tags.desmarcar(deId, tagId);
      }
    }
    if (de.criadaEm < para.criadaEm) await this.repo.salvarConversa({ ...para, criadaEm: de.criadaEm });
    await this.repo.unirConversas(deId, paraId);
  }
  async trocarTelefone(conversaId: string, telefone: string) {
    const c = await this.repo.buscarConversa(conversaId);
    if (c) await this.repo.salvarConversa({ ...c, telefone });
  }
  async naoDuplicatas(empresaId: string) {
    return new Set(this.nao.get(empresaId) ?? []);
  }
  async marcarNaoDuplicata(empresaId: string, pares: Array<[string, string]>) {
    const s = this.nao.get(empresaId) ?? new Set<string>();
    for (const p of pares) s.add(ordenar(p).join('|'));
    this.nao.set(empresaId, s);
  }
}

export class ArmazemLeadsPostgres implements ArmazemLeads {
  constructor(private readonly pool: pg.Pool) {}

  async contatos(empresaId: string) {
    const { rows } = await this.pool.query<{
      telefone: string;
      nome: string | null;
      email: string | null;
      nascimento: string | null;
      observacoes: string | null;
      pessoa: 'fisica' | 'juridica';
      empresa: Contato['empresa'];
      campos: Contato['campos'];
      atualizado_em: Date;
      atualizado_por: string | null;
      criado_em: Date | null;
    }>(
      `select telefone, nome, email, to_char(nascimento, 'YYYY-MM-DD') as nascimento, observacoes, pessoa, empresa, campos,
              atualizado_em, atualizado_por, criado_em
         from sintonia.contatos where empresa_id = $1`,
      [empresaId],
    );
    return rows.map((r) => ({
      telefone: r.telefone,
      nome: r.nome,
      email: r.email,
      nascimento: r.nascimento,
      observacoes: r.observacoes,
      pessoa: r.pessoa,
      empresa: r.empresa ?? {},
      campos: r.campos ?? {},
      atualizadoEm: r.atualizado_em,
      atualizadoPor: r.atualizado_por,
      criadoEm: r.criado_em,
    }));
  }

  async apagarContato(empresaId: string, telefone: string) {
    await this.pool.query('delete from sintonia.contatos where empresa_id = $1 and telefone = $2', [empresaId, telefone]);
  }

  async unirConversas(deId: string, paraId: string) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      // As duas linhas travadas: ninguém grava nelas no meio da mescla.
      await c.query('select id from sintonia.conversas where id = any($1::uuid[]) order by id for update', [[deId, paraId]]);
      await c.query('update sintonia.mensagens set conversa_id = $2 where conversa_id = $1', [deId, paraId]);
      await c.query('update sintonia.eventos set conversa_id = $2 where conversa_id = $1', [deId, paraId]);
      await c.query(
        `update sintonia.tarefas t set conversa_id = $2
          where t.conversa_id = $1 and not t.feita
            and not exists (select 1 from sintonia.tarefas x where x.conversa_id = $2 and not x.feita and x.tipo = t.tipo)`,
        [deId, paraId],
      );
      // Tags soltas que faltam e etapas de funis em que a principal não está.
      await c.query(
        `insert into sintonia.conversa_tags (conversa_id, tag_id, funil_id, marcada_por, marcada_em)
         select $2, ct.tag_id, ct.funil_id, coalesce(ct.marcada_por, 'mescla'), ct.marcada_em
           from sintonia.conversa_tags ct
          where ct.conversa_id = $1
            and (ct.funil_id is null or not exists (select 1 from sintonia.conversa_tags y where y.conversa_id = $2 and y.funil_id = ct.funil_id))
         on conflict do nothing`,
        [deId, paraId],
      );
      await c.query(
        `update sintonia.conversas p set
            criada_em = least(p.criada_em, d.criada_em),
            sugestao = coalesce(p.sugestao, d.sugestao)
           from sintonia.conversas d
          where p.id = $2 and d.id = $1`,
        [deId, paraId],
      );
      await c.query('delete from sintonia.conversas where id = $1', [deId]);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async trocarTelefone(conversaId: string, telefone: string) {
    await this.pool.query('update sintonia.conversas set telefone = $2 where id = $1', [conversaId, telefone]);
  }

  async naoDuplicatas(empresaId: string) {
    const { rows } = await this.pool.query<{ a: string; b: string }>(
      'select telefone_a as a, telefone_b as b from sintonia.nao_duplicatas where empresa_id = $1',
      [empresaId],
    );
    return new Set(rows.map((r) => `${r.a}|${r.b}`));
  }

  async marcarNaoDuplicata(empresaId: string, pares: Array<[string, string]>, por: string) {
    for (const p of pares) {
      const [a, b] = ordenar(p);
      if (a === b) continue;
      await this.pool.query(
        `insert into sintonia.nao_duplicatas (empresa_id, telefone_a, telefone_b, marcada_por) values ($1, $2, $3, $4)
         on conflict do nothing`,
        [empresaId, a, b, por],
      );
    }
  }
}
