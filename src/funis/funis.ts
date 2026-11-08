import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { ETAPAS, NOME_ETAPA, type Conversa, type Etapa, type ModoAtendimento, type UnidadeId } from '../domain.js';
import { noEscopo, type EscopoVisao } from '../auth/acesso.js';
import { sqlEscopo } from '../painel/escopo-sql.js';
import type { Repositorio } from '../store/repositorio.js';
import { CORES_TAGS, ErroTag, validarCor, validarNome, type ArmazemTags, type DelegadoEtapas, type Tag, type TagResumo, type Tags } from '../tags/tags.js';

/**
 * Funis por tags. Um funil é um grupo de tags exclusivas: cada tag do funil é uma etapa (coluna do quadro)
 * e, dentro de um funil, a conversa tem no máximo uma etapa. Mover o cartão = trocar a tag; trocar a tag
 * (POST /api/conversas/:id/tags) = mover o cartão.
 *
 * O funil do sistema "Atendimento" espelha a etapa fixa da conversa (conversa.etapa, que a IA e o motor movem):
 * - o motor/IA mudou conversa.etapa → a tag acompanha (gancho etapaMudou da Sintonia);
 * - alguém moveu o cartão para uma etapa do sistema → conversa.etapa acompanha (aqui, em moverSobTrava).
 * Cada lado só escreve no outro, nunca chama o outro de volta: não há laço.
 */

export interface Funil {
  id: string;
  empresaId: string;
  nome: string;
  ordem: number;
  /** O funil do sistema ("Atendimento"): não pode ser apagado; suas etapas não podem ser apagadas. */
  sistema: boolean;
  criadaPor: string | null;
  criadaEm: Date;
}

/** Etapa = tag com funilId. */
export type EtapaFunil = Tag & { funilId: string };

/** Quem move: pessoa da equipe, IA, o motor ("Sintonia") ou uma automação. */
export interface QuemMove {
  nome: string;
  id?: string | null;
}

/** Um cartão mudou de etapa (ou entrou/saiu do funil). */
export interface MovimentoEtapa {
  conversa: Conversa;
  funil: Funil;
  /** Etapa (tag) anterior; null = estava fora do funil. */
  de: string | null;
  /** Etapa (tag) nova; null = saiu do funil. */
  para: string | null;
  por: QuemMove;
  automatico: boolean;
}

/** Cartão do quadro. */
export interface Cartao {
  conversaId: string;
  nome: string | null;
  telefone: string;
  unidade: UnidadeId;
  modo: ModoAtendimento;
  /** Etapa fixa (funil do sistema). */
  etapa: Etapa;
  dona: { id: string; nome: string | null } | null;
  /** Tags soltas da conversa. */
  tags: TagResumo[];
  ultima: { autor: string; autorNome: string | null; texto: string; em: Date } | null;
  /** Desde quando está nesta etapa. */
  desde: Date;
  atualizadaEm: Date;
  /** Valor do negócio (R$), quando alguém preencheu. */
  valor: number | null;
}

/** Resultado da busca do quadro (lista que aparece debaixo do campo). */
export interface AchadoQuadro {
  conversaId: string;
  nome: string | null;
  telefone: string;
  unidade: UnidadeId;
  modo: ModoAtendimento;
  dona: { id: string; nome: string | null } | null;
  etapa: { id: string; nome: string; cor: string };
}

export interface FiltroQuadro {
  escopo: EscopoVisao;
  unidade?: UnidadeId;
  busca?: string;
  /** Só esta coluna (para "carregar mais"). */
  etapaId?: string;
  /** Só desta atendente ('sem' = sem atendente). */
  dona?: string;
  /** Cursor do "carregar mais" (o último cartão já carregado): mais rápido que offset em colunas enormes. */
  apos?: { em: Date; id: string };
  /** Conta como "parada" quem está na etapa desde antes disto (padrão: 3 dias antes de agora). */
  paradaAntes?: Date;
  offset: number;
  limite: number;
}

/** Linha do quadro antes de juntar as tags (o armazém devolve; a classe completa). */
export type LinhaQuadro = Omit<Cartao, 'tags'> & { tagId: string };

export class ErroFunil extends ErroTag {}

export interface ArmazemFunis {
  listar(empresaId: string): Promise<Funil[]>;
  buscar(id: string): Promise<Funil | undefined>;
  /** Recusa (409) nome repetido na empresa ou um segundo funil do sistema. */
  criar(f: Funil): Promise<void>;
  atualizar(id: string, campos: Partial<Pick<Funil, 'nome' | 'ordem'>>): Promise<void>;
  apagar(id: string): Promise<void>;
  /** Conversas visíveis em cada etapa do funil. */
  contar(funilId: string, escopo: EscopoVisao): Promise<Map<string, number>>;
  /** Totais por coluna (com os filtros) e a página de cartões de cada coluna. */
  quadro(funilId: string, f: FiltroQuadro): Promise<{ totais: Map<string, number>; paradas: Map<string, number>; linhas: LinhaQuadro[] }>;
  /** Busca no quadro por nome ou dígitos do telefone (no máximo `limite`). */
  buscarCartoes(funilId: string, termo: string, escopo: EscopoVisao, limite: number): Promise<AchadoQuadro[]>;
  /** Valor do negócio (R$) de uma conversa; null apaga. */
  definirValor(conversaId: string, valor: number | null, por: string): Promise<void>;
  valor(conversaId: string): Promise<number | null>;
  /**
   * Funil do sistema ⇄ conversa.etapa: a etapa da conversa manda. Põe no funil quem está fora e corrige
   * quem está na etapa errada. Devolve quantas marcações mudaram.
   */
  sincronizarSistema(empresaId: string, funilId: string, em: Date): Promise<number>;
}

const nomeRepetido = (e: unknown) => (e as { code?: string }).code === '23505';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resumir = (texto: string) => (texto.length > 120 ? `${texto.slice(0, 119)}…` : texto);
const soDigitos = (s: string) => s.replace(/\D/g, '');
const DIA_MS = 24 * 3600_000;
/** Busca por telefone só quando o texto parece telefone (sem letras e com pelo menos 3 dígitos). */
const digitosDaBusca = (busca: string) => (/\p{L}/u.test(busca) ? '' : soDigitos(busca).length >= 3 ? soDigitos(busca) : '');

// ---------------------------------------------------------------- memória

export class ArmazemFunisMemoria implements ArmazemFunis {
  private readonly funis = new Map<string, Funil>();

  constructor(
    private readonly repo: Repositorio,
    private readonly tags: ArmazemTags,
  ) {}

  async listar(empresaId: string) {
    return [...this.funis.values()].filter((f) => f.empresaId === empresaId).map((f) => ({ ...f }));
  }
  async buscar(id: string) {
    const f = this.funis.get(id);
    return f ? { ...f } : undefined;
  }
  private repetido(empresaId: string, nome: string, exceto?: string) {
    return [...this.funis.values()].some((f) => f.empresaId === empresaId && f.id !== exceto && f.nome.toLowerCase() === nome.toLowerCase());
  }
  async criar(f: Funil) {
    if (this.repetido(f.empresaId, f.nome)) throw new ErroFunil(`Já existe o funil "${f.nome}".`, 409);
    if (f.sistema && [...this.funis.values()].some((x) => x.empresaId === f.empresaId && x.sistema)) throw new ErroFunil('O funil do sistema já existe.', 409);
    this.funis.set(f.id, { ...f });
  }
  async atualizar(id: string, campos: Partial<Pick<Funil, 'nome' | 'ordem'>>) {
    const f = this.funis.get(id);
    if (!f) return;
    if (campos.nome !== undefined && this.repetido(f.empresaId, campos.nome, id)) throw new ErroFunil(`Já existe o funil "${campos.nome}".`, 409);
    if (campos.nome !== undefined) f.nome = campos.nome;
    if (campos.ordem !== undefined) f.ordem = campos.ordem;
  }
  async apagar(id: string) {
    const f = this.funis.get(id);
    if (!f) return;
    // As etapas (tags) do funil vão junto, e com elas as marcações.
    for (const t of await this.tags.listar(f.empresaId)) if (t.funilId === id) await this.tags.apagar(t.id);
    this.funis.delete(id);
  }
  private async conversasPorId() {
    return new Map((await this.repo.listarConversas()).map((c) => [c.id, c]));
  }
  async contar(funilId: string, escopo: EscopoVisao) {
    const conversas = await this.conversasPorId();
    const r = new Map<string, number>();
    for (const m of await this.tags.etapasDoFunil(funilId)) {
      const c = conversas.get(m.conversaId);
      if (c && noEscopo(escopo, c)) r.set(m.tagId, (r.get(m.tagId) ?? 0) + 1);
    }
    return r;
  }
  private readonly valores = new Map<string, number>();
  async definirValor(conversaId: string, valor: number | null) {
    if (valor === null) this.valores.delete(conversaId);
    else this.valores.set(conversaId, valor);
  }
  async valor(conversaId: string) {
    return this.valores.get(conversaId) ?? null;
  }
  async quadro(funilId: string, f: FiltroQuadro) {
    const [conversas, ultimas] = await Promise.all([this.conversasPorId(), this.repo.ultimasMensagens()]);
    const busca = f.busca?.trim().toLowerCase();
    const digitos = busca ? digitosDaBusca(busca) : '';
    const porColuna = new Map<string, LinhaQuadro[]>();
    const paradas = new Map<string, number>();
    const limiteParada = (f.paradaAntes ?? new Date(Date.now() - 3 * DIA_MS)).getTime();
    for (const m of await this.tags.etapasDoFunil(funilId)) {
      const c = conversas.get(m.conversaId);
      if (!c || !noEscopo(f.escopo, c)) continue;
      if (f.unidade && c.unidade !== f.unidade) continue;
      if (f.etapaId && m.tagId !== f.etapaId) continue;
      if (f.dona && (f.dona === 'sem' ? c.responsavelId : c.responsavelId !== f.dona)) continue;
      if (busca && !(c.nome ?? '').toLowerCase().includes(busca) && !(digitos && c.telefone.includes(digitos))) continue;
      if (m.desde.getTime() < limiteParada) paradas.set(m.tagId, (paradas.get(m.tagId) ?? 0) + 1);
      const u = ultimas.get(c.id);
      const l: LinhaQuadro = {
        ...cartaoBase(c, m.desde),
        tagId: m.tagId,
        ultima: u ? { autor: u.autor, autorNome: u.autorNome ?? null, texto: resumir(u.texto), em: u.em } : null,
        valor: this.valores.get(c.id) ?? null,
      };
      porColuna.set(m.tagId, [...(porColuna.get(m.tagId) ?? []), l]);
    }
    const totais = new Map<string, number>();
    const linhas: LinhaQuadro[] = [];
    for (const [tagId, lista] of porColuna) {
      totais.set(tagId, lista.length);
      lista.sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime() || a.conversaId.localeCompare(b.conversaId));
      const depois = f.apos ? lista.filter((l) => l.atualizadaEm.getTime() < f.apos!.em.getTime() || (l.atualizadaEm.getTime() === f.apos!.em.getTime() && l.conversaId > f.apos!.id)) : lista.slice(f.offset);
      linhas.push(...depois.slice(0, f.limite));
    }
    return { totais, paradas, linhas };
  }
  async buscarCartoes(funilId: string, termo: string, escopo: EscopoVisao, limite: number) {
    const conversas = await this.conversasPorId();
    const etapas = new Map((await this.tags.listar(this.empresaDoFunil(funilId) ?? '')).map((t) => [t.id, t]));
    const busca = termo.trim().toLowerCase();
    const digitos = digitosDaBusca(busca);
    const achados: Array<AchadoQuadro & { atualizadaEm: Date; prefixo: boolean }> = [];
    for (const m of await this.tags.etapasDoFunil(funilId)) {
      const c = conversas.get(m.conversaId);
      const t = etapas.get(m.tagId);
      if (!c || !t || !noEscopo(escopo, c)) continue;
      const nome = (c.nome ?? '').toLowerCase();
      if (!nome.includes(busca) && !(digitos && c.telefone.includes(digitos))) continue;
      achados.push({ conversaId: c.id, nome: c.nome ?? null, telefone: c.telefone, unidade: c.unidade, modo: c.modo, dona: c.responsavelId ? { id: c.responsavelId, nome: c.responsavelNome ?? null } : null,
        etapa: { id: t.id, nome: t.nome, cor: t.cor }, atualizadaEm: c.atualizadaEm, prefixo: nome.startsWith(busca) });
    }
    achados.sort((a, b) => Number(b.prefixo) - Number(a.prefixo) || b.atualizadaEm.getTime() - a.atualizadaEm.getTime());
    return achados.slice(0, limite).map(({ atualizadaEm: _a, prefixo: _p, ...x }) => x);
  }
  private empresaDoFunil(funilId: string) {
    return this.funis.get(funilId)?.empresaId;
  }
  async sincronizarSistema(empresaId: string, funilId: string, em: Date) {
    const porChave = new Map((await this.tags.listar(empresaId)).filter((t) => t.funilId === funilId && t.chaveSistema).map((t) => [t.chaveSistema!, t.id]));
    let n = 0;
    for (const c of await this.repo.listarConversas()) {
      if (c.empresaId !== empresaId) continue;
      const tagId = porChave.get(c.etapa);
      if (tagId && (await this.tags.marcarEtapa(c.id, tagId, funilId, 'sincronia', em)).mudou) n++;
    }
    return n;
  }
}

function cartaoBase(c: Conversa, desde: Date): Omit<Cartao, 'tags' | 'ultima' | 'valor'> {
  return {
    conversaId: c.id,
    nome: c.nome ?? null,
    telefone: c.telefone,
    unidade: c.unidade,
    modo: c.modo,
    etapa: c.etapa,
    dona: c.responsavelId ? { id: c.responsavelId, nome: c.responsavelNome ?? null } : null,
    desde,
    atualizadaEm: c.atualizadaEm,
  };
}

// ---------------------------------------------------------------- Postgres

interface LinhaFunil {
  id: string;
  empresa_id: string;
  nome: string;
  ordem: number;
  sistema: boolean;
  criada_por: string | null;
  criada_em: Date;
}
const paraFunil = (l: LinhaFunil): Funil => ({
  id: l.id,
  empresaId: l.empresa_id,
  nome: l.nome,
  ordem: l.ordem,
  sistema: l.sistema,
  criadaPor: l.criada_por,
  criadaEm: l.criada_em,
});
const COLUNAS_FUNIL = 'id::text, empresa_id, nome, ordem, sistema, criada_por, criada_em';

export class ArmazemFunisPostgres implements ArmazemFunis {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string) {
    const { rows } = await this.pool.query<LinhaFunil>(`select ${COLUNAS_FUNIL} from sintonia.funis where empresa_id = $1`, [empresaId]);
    return rows.map(paraFunil);
  }
  async buscar(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<LinhaFunil>(`select ${COLUNAS_FUNIL} from sintonia.funis where id = $1`, [id]);
    return rows[0] ? paraFunil(rows[0]) : undefined;
  }
  async criar(f: Funil) {
    try {
      await this.pool.query(
        'insert into sintonia.funis (id, empresa_id, nome, ordem, sistema, criada_por, criada_em) values ($1, $2, $3, $4, $5, $6, $7)',
        [f.id, f.empresaId, f.nome, f.ordem, f.sistema, f.criadaPor, f.criadaEm],
      );
    } catch (e) {
      if (nomeRepetido(e)) throw new ErroFunil(f.sistema ? 'O funil do sistema já existe.' : `Já existe o funil "${f.nome}".`, 409);
      throw e;
    }
  }
  async atualizar(id: string, campos: Partial<Pick<Funil, 'nome' | 'ordem'>>) {
    try {
      await this.pool.query('update sintonia.funis set nome = coalesce($2, nome), ordem = coalesce($3, ordem) where id = $1', [
        id,
        campos.nome ?? null,
        campos.ordem ?? null,
      ]);
    } catch (e) {
      if (nomeRepetido(e)) throw new ErroFunil(`Já existe o funil "${campos.nome}".`, 409);
      throw e;
    }
  }
  async apagar(id: string) {
    // Etapas, marcações e automações do funil vão junto (on delete cascade).
    await this.pool.query('delete from sintonia.funis where id = $1', [id]);
  }
  async contar(funilId: string, escopo: EscopoVisao) {
    const params: unknown[] = [funilId];
    const onde = sqlEscopo(escopo, 'c', params);
    const { rows } = await this.pool.query<{ tag_id: string; n: number }>(
      `select ct.tag_id::text as tag_id, count(*)::int as n
         from sintonia.conversa_tags ct join sintonia.conversas c on c.id = ct.conversa_id
        where ct.funil_id = $1 and ${onde}
        group by ct.tag_id`,
      params,
    );
    return new Map(rows.map((r) => [r.tag_id, r.n]));
  }
  /** Filtros do quadro em SQL (conversa_tags ct + conversas c). */
  private filtrosQuadro(funilId: string, f: Pick<FiltroQuadro, 'escopo' | 'unidade' | 'busca' | 'dona'>, params: unknown[]): string {
    params.push(funilId);
    const partes = [`ct.funil_id = $${params.length}`, sqlEscopo(f.escopo, 'c', params)];
    if (f.unidade) {
      params.push(f.unidade);
      partes.push(`c.unidade = $${params.length}`);
    }
    if (f.dona === 'sem') partes.push('c.responsavel_id is null');
    else if (f.dona) {
      if (!UUID.test(f.dona)) partes.push('false');
      else {
        params.push(f.dona);
        partes.push(`c.responsavel_id = $${params.length}::uuid`);
      }
    }
    const busca = f.busca?.trim();
    if (busca) {
      params.push(`%${busca.replace(/[\\%_]/g, (x) => `\\${x}`)}%`);
      const iNome = params.length;
      const digitos = digitosDaBusca(busca);
      if (digitos) {
        params.push(`%${digitos}%`);
        partes.push(`(c.nome ilike $${iNome} or c.telefone like $${params.length})`);
      } else partes.push(`c.nome ilike $${iNome}`);
    }
    return partes.join(' and ');
  }
  /**
   * Quadro em escala: totais e paradas por coluna num só agregado; os cartões vêm por coluna
   * (lateral + limit), nunca o funil inteiro. "Carregar mais" usa cursor (atualizada_em, id) quando vem.
   */
  async quadro(funilId: string, f: FiltroQuadro) {
    if (f.etapaId && !UUID.test(f.etapaId)) return { totais: new Map(), paradas: new Map(), linhas: [] };
    const pAgg: unknown[] = [];
    let ondeAgg = this.filtrosQuadro(funilId, f, pAgg);
    if (f.etapaId) {
      pAgg.push(f.etapaId);
      ondeAgg += ` and ct.tag_id = $${pAgg.length}::uuid`;
    }
    pAgg.push(f.paradaAntes ?? new Date(Date.now() - 3 * DIA_MS));
    const iParada = pAgg.length;
    const agg = await this.pool.query<{ tag_id: string; n: number; paradas: number }>(
      `select ct.tag_id::text as tag_id, count(*)::int as n, (count(*) filter (where ct.marcada_em < $${iParada}))::int as paradas
         from sintonia.conversa_tags ct join sintonia.conversas c on c.id = ct.conversa_id
        where ${ondeAgg} group by ct.tag_id`,
      pAgg,
    );
    const totais = new Map(agg.rows.map((r) => [r.tag_id, r.n]));
    const paradas = new Map(agg.rows.map((r) => [r.tag_id, r.paradas]));
    const etapas = agg.rows.filter((r) => r.n > 0).map((r) => r.tag_id);
    if (!etapas.length) return { totais, paradas, linhas: [] };

    const params: unknown[] = [];
    const onde = this.filtrosQuadro(funilId, f, params);
    params.push(etapas);
    const iEtapas = params.length;
    let cursor = '';
    if (f.apos && UUID.test(f.apos.id)) {
      params.push(f.apos.em, f.apos.id);
      cursor = ` and (c.atualizada_em < $${params.length - 1} or (c.atualizada_em = $${params.length - 1} and c.id > $${params.length}::uuid))`;
    }
    params.push(f.limite, f.apos ? 0 : f.offset);
    const iLim = params.length - 1;
    const { rows } = await this.pool.query<{
      tag_id: string;
      marcada_em: Date;
      id: string;
      nome: string | null;
      telefone: string;
      unidade: UnidadeId;
      modo: ModoAtendimento;
      etapa: Etapa;
      responsavel_id: string | null;
      responsavel_nome: string | null;
      atualizada_em: Date;
      valor: string | null;
      um_autor: string | null;
      um_autor_nome: string | null;
      um_texto: string | null;
      um_em: Date | null;
    }>(
      `select e.tag_id::text as tag_id, x.*, v.valor::text as valor,
              um.autor as um_autor, um.autor_nome as um_autor_nome, left(um.texto, 200) as um_texto, um.em as um_em
         from unnest($${iEtapas}::uuid[]) as e(tag_id)
         cross join lateral (
           select ct.marcada_em, c.id::text as id, c.nome, c.telefone, c.unidade, c.modo, c.etapa,
                  c.responsavel_id::text as responsavel_id, c.responsavel_nome, c.atualizada_em
             from sintonia.conversa_tags ct join sintonia.conversas c on c.id = ct.conversa_id
            where ${onde} and ct.tag_id = e.tag_id${cursor}
            order by c.atualizada_em desc, c.id
            limit $${iLim} offset $${iLim + 1}
         ) x
         left join sintonia.cartao_valores v on v.conversa_id = x.id::uuid
         left join lateral (
           select m.autor, m.autor_nome, m.texto, m.em from sintonia.mensagens m
            where m.conversa_id = x.id::uuid order by m.em desc, m.id desc limit 1
         ) um on true
        order by e.tag_id, x.atualizada_em desc, x.id`,
      params,
    );
    return {
      totais,
      paradas,
      linhas: rows.map(
        (r): LinhaQuadro => ({
          tagId: r.tag_id,
          conversaId: r.id,
          nome: r.nome,
          telefone: r.telefone,
          unidade: r.unidade,
          modo: r.modo,
          etapa: r.etapa,
          dona: r.responsavel_id ? { id: r.responsavel_id, nome: r.responsavel_nome } : null,
          ultima: r.um_em ? { autor: r.um_autor!, autorNome: r.um_autor_nome, texto: resumir(r.um_texto ?? ''), em: r.um_em } : null,
          desde: r.marcada_em,
          atualizadaEm: r.atualizada_em,
          valor: r.valor === null ? null : Number(r.valor),
        }),
      ),
    };
  }
  async buscarCartoes(funilId: string, termo: string, escopo: EscopoVisao, limite: number) {
    const params: unknown[] = [];
    const onde = this.filtrosQuadro(funilId, { escopo, busca: termo }, params);
    params.push(termo.trim().replace(/[\\%_]/g, (x) => `\\${x}`) + '%', limite);
    const { rows } = await this.pool.query<{ id: string; nome: string | null; telefone: string; unidade: UnidadeId; modo: ModoAtendimento; responsavel_id: string | null; responsavel_nome: string | null; tag_id: string; tag_nome: string; tag_cor: string }>(
      `select c.id::text as id, c.nome, c.telefone, c.unidade, c.modo, c.responsavel_id::text as responsavel_id, c.responsavel_nome,
              t.id::text as tag_id, t.nome as tag_nome, t.cor as tag_cor
         from sintonia.conversa_tags ct
         join sintonia.conversas c on c.id = ct.conversa_id
         join sintonia.tags t on t.id = ct.tag_id
        where ${onde}
        order by (c.nome ilike $${params.length - 1}) desc, c.atualizada_em desc, c.id
        limit $${params.length}`,
      params,
    );
    return rows.map((r): AchadoQuadro => ({ conversaId: r.id, nome: r.nome, telefone: r.telefone, unidade: r.unidade, modo: r.modo, dona: r.responsavel_id ? { id: r.responsavel_id, nome: r.responsavel_nome } : null, etapa: { id: r.tag_id, nome: r.tag_nome, cor: r.tag_cor } }));
  }
  async definirValor(conversaId: string, valor: number | null, por: string) {
    if (valor === null) await this.pool.query('delete from sintonia.cartao_valores where conversa_id = $1', [conversaId]);
    else {
      await this.pool.query(
        `insert into sintonia.cartao_valores (conversa_id, valor, atualizado_em, atualizado_por) values ($1, $2, now(), $3)
         on conflict (conversa_id) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
        [conversaId, valor, por],
      );
    }
  }
  async valor(conversaId: string) {
    const { rows } = await this.pool.query<{ valor: string }>('select valor::text as valor from sintonia.cartao_valores where conversa_id = $1', [conversaId]);
    return rows[0] ? Number(rows[0].valor) : null;
  }
  async sincronizarSistema(empresaId: string, funilId: string, em: Date) {
    const r = await this.pool.query(
      `insert into sintonia.conversa_tags (conversa_id, tag_id, funil_id, marcada_por, marcada_em)
       select c.id, t.id, t.funil_id, 'sincronia', $3
         from sintonia.conversas c join sintonia.tags t on t.funil_id = $2 and t.chave_sistema = c.etapa
        where c.empresa_id = $1
       on conflict (conversa_id, funil_id) where funil_id is not null
         do update set tag_id = excluded.tag_id, marcada_por = excluded.marcada_por, marcada_em = excluded.marcada_em
         where sintonia.conversa_tags.tag_id <> excluded.tag_id`,
      [empresaId, funilId, em],
    );
    return r.rowCount ?? 0;
  }
}

// ---------------------------------------------------------------- regras

/** Cor de cada etapa do sistema (paleta das tags). */
const COR_SISTEMA: Record<Etapa, string> = {
  novo_lead: '#0090FF',
  em_conversa: '#12A594',
  interessada: '#D4A017',
  agendada: '#3E63DD',
  compareceu: '#30A46C',
  manutencao: '#8E4EC6',
  perdida: '#8B8D98',
};
const FOLLOWUPS = ['followup_1h', 'followup_1d', 'followup_3d'] as const;
export const LIMITE_FUNIS = 30;
export const LIMITE_ETAPAS = 30;

export interface OpcoesFunis {
  armazem: ArmazemFunis;
  armazemTags: ArmazemTags;
  tags: Tags;
  repo: Repositorio;
  empresaId: string;
  agora?: () => Date;
  /** Trava da conversa (Sintonia.comConversa): mover manualmente acontece sob ela. */
  comConversa: <T>(conversaId: string, fn: (c: Conversa) => Promise<T>) => Promise<T | undefined>;
  log?: (msg: string, extra?: unknown) => void;
}

function validarNomeFunil(bruto: string): string {
  const nome = bruto.replace(/\s+/g, ' ').trim();
  if (!nome) throw new ErroFunil('Dê um nome para o funil.', 400);
  if (nome.length > 40) throw new ErroFunil('O nome do funil pode ter até 40 letras.', 400);
  return nome;
}

const ordenarEtapas = <T extends Tag>(l: T[]) => l.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));

export class Funis implements DelegadoEtapas {
  readonly empresaId: string;
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly observadores: Array<(m: MovimentoEtapa) => Promise<void>> = [];
  private readonly aoApagarFunil: Array<(funilId: string) => Promise<void>> = [];
  /** Funil do sistema e suas etapas por chave (as chaves nunca mudam; os nomes são lidos de novo). */
  private sistemaCache?: { funil: Funil; porChave: Map<Etapa, string> };

  constructor(private readonly o: OpcoesFunis) {
    this.empresaId = o.empresaId;
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  /** Avisado a cada movimento de cartão (as automações escutam aqui). */
  aoMover(fn: (m: MovimentoEtapa) => Promise<void>): void {
    this.observadores.push(fn);
  }
  aoApagar(fn: (funilId: string) => Promise<void>): void {
    this.aoApagarFunil.push(fn);
  }

  // ---------- funil do sistema ----------

  /** Cria (se faltar) o funil "Atendimento" e as 7 etapas ligadas às etapas fixas. Idempotente. */
  async garantirSistema(): Promise<Funil> {
    if (this.sistemaCache) return this.sistemaCache.funil;
    let funil = (await this.o.armazem.listar(this.empresaId)).find((f) => f.sistema);
    if (!funil) {
      const novo: Funil = { id: randomUUID(), empresaId: this.empresaId, nome: 'Atendimento', ordem: 0, sistema: true, criadaPor: 'sistema', criadaEm: this.agora() };
      try {
        await this.o.armazem.criar(novo);
      } catch (e) {
        if (!(e instanceof ErroTag && e.statusCode === 409)) throw e;
      }
      funil = (await this.o.armazem.listar(this.empresaId)).find((f) => f.sistema)!;
    }
    const existentes = (await this.o.armazemTags.listar(this.empresaId)).filter((t) => t.funilId === funil.id);
    for (const [i, chave] of ETAPAS.entries()) {
      if (existentes.some((t) => t.chaveSistema === chave)) continue;
      try {
        await this.o.armazemTags.criar({
          id: randomUUID(),
          empresaId: this.empresaId,
          nome: NOME_ETAPA[chave],
          cor: COR_SISTEMA[chave],
          ordem: i,
          criadaPor: 'sistema',
          criadaEm: this.agora(),
          funilId: funil.id,
          chaveSistema: chave,
        });
      } catch (e) {
        if (!(e instanceof ErroTag && e.statusCode === 409)) throw e;
      }
    }
    const tags = (await this.o.armazemTags.listar(this.empresaId)).filter((t) => t.funilId === funil.id && t.chaveSistema);
    this.sistemaCache = { funil, porChave: new Map(tags.map((t) => [t.chaveSistema as Etapa, t.id])) };
    return funil;
  }

  /** Põe toda conversa no funil do sistema, na etapa em que ela está (conversa.etapa manda). Rode ao subir. */
  async sincronizarSistema(): Promise<number> {
    const f = await this.garantirSistema();
    return this.o.armazem.sincronizarSistema(this.empresaId, f.id, this.agora());
  }

  /** Gancho: o motor/IA mudou conversa.etapa. A tag do funil do sistema acompanha (sem mexer em conversa.etapa). */
  async etapaDoSistemaMudou(c: Conversa, de: Etapa, para: Etapa, por: 'IA' | 'Sintonia'): Promise<void> {
    if (c.empresaId !== this.empresaId) return;
    await this.garantirSistema();
    const { funil, porChave } = this.sistemaCache!;
    const tagId = porChave.get(para);
    if (!tagId) return;
    const r = await this.o.armazemTags.marcarEtapa(c.id, tagId, funil.id, por, this.agora());
    if (!r.mudou) return;
    await this.registrarMovimento({ conversa: c, funil, de: r.de ?? porChave.get(de) ?? null, para: tagId, por: { nome: por, id: null }, automatico: true });
  }

  /** Garante que a conversa está no funil do sistema (conversa criada por fora do motor). Sem evento. */
  async garantirNoSistema(c: Conversa): Promise<void> {
    if (c.empresaId !== this.empresaId) return;
    await this.garantirSistema();
    const { funil, porChave } = this.sistemaCache!;
    const atual = (await this.o.armazemTags.etapasDaConversa(c.id)).find((m) => m.funilId === funil.id);
    const tagId = porChave.get(c.etapa);
    if (tagId && atual?.tagId !== tagId) await this.o.armazemTags.marcarEtapa(c.id, tagId, funil.id, 'sincronia', this.agora());
  }

  // ---------- funis e etapas ----------

  async listar(): Promise<Funil[]> {
    await this.garantirSistema();
    return (await this.o.armazem.listar(this.empresaId)).sort(
      (a, b) => Number(b.sistema) - Number(a.sistema) || a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'),
    );
  }

  async exigir(id: string): Promise<Funil> {
    const f = await this.o.armazem.buscar(id);
    if (!f || f.empresaId !== this.empresaId) throw new ErroFunil('Funil não encontrado.', 404);
    return f;
  }

  async etapas(funilId: string): Promise<EtapaFunil[]> {
    return ordenarEtapas((await this.o.armazemTags.listar(this.empresaId)).filter((t): t is EtapaFunil => t.funilId === funilId));
  }

  async exigirEtapa(funilId: string, etapaId: string): Promise<EtapaFunil> {
    const t = await this.o.armazemTags.buscar(etapaId);
    if (!t || t.empresaId !== this.empresaId || t.funilId !== funilId) throw new ErroFunil('Etapa não encontrada neste funil.', 404);
    return t as EtapaFunil;
  }

  /** Funis com as etapas e quantas conversas visíveis há em cada uma. */
  async listarComEtapas(escopo: EscopoVisao) {
    const [funis, todas] = await Promise.all([this.listar(), this.o.armazemTags.listar(this.empresaId)]);
    return Promise.all(
      funis.map(async (f) => {
        const n = await this.o.armazem.contar(f.id, escopo);
        const etapas = ordenarEtapas(todas.filter((t) => t.funilId === f.id)).map((t) => ({ ...t, conversas: n.get(t.id) ?? 0 }));
        return { ...f, etapas, conversas: etapas.reduce((s, e) => s + e.conversas, 0) };
      }),
    );
  }

  async criar(dados: { nome: string; etapas?: Array<{ nome: string; cor?: string }> }, por: string): Promise<Funil> {
    const nome = validarNomeFunil(dados.nome);
    const lista = await this.listar();
    if (lista.length >= LIMITE_FUNIS) throw new ErroFunil(`Limite de ${LIMITE_FUNIS} funis.`, 400);
    if ((dados.etapas?.length ?? 0) > LIMITE_ETAPAS) throw new ErroFunil(`Um funil pode ter até ${LIMITE_ETAPAS} etapas.`, 400);
    // Valida tudo antes de gravar qualquer coisa.
    const etapas = (dados.etapas ?? []).map((e) => ({ nome: validarNome(e.nome), cor: e.cor ? validarCor(e.cor) : undefined }));
    const nomes = new Set<string>();
    for (const e of etapas) {
      if (nomes.has(e.nome.toLowerCase())) throw new ErroFunil(`Etapa "${e.nome}" repetida.`, 400);
      nomes.add(e.nome.toLowerCase());
    }
    const f: Funil = {
      id: randomUUID(),
      empresaId: this.empresaId,
      nome,
      ordem: lista.reduce((m, x) => Math.max(m, x.ordem), 0) + 1,
      sistema: false,
      criadaPor: por,
      criadaEm: this.agora(),
    };
    await this.o.armazem.criar(f);
    for (const e of etapas) await this.criarEtapa(f.id, e, por);
    return f;
  }

  async alterar(id: string, campos: { nome?: string; ordem?: number }): Promise<Funil> {
    await this.exigir(id);
    await this.o.armazem.atualizar(id, { nome: campos.nome !== undefined ? validarNomeFunil(campos.nome) : undefined, ordem: campos.ordem });
    if (this.sistemaCache?.funil.id === id) this.sistemaCache = undefined;
    return this.exigir(id);
  }

  /** Apaga o funil, as etapas, as marcações e as automações dele. O do sistema não. */
  async apagar(id: string): Promise<void> {
    const f = await this.exigir(id);
    if (f.sistema) throw new ErroFunil('O funil do sistema não pode ser apagado.', 409);
    await this.o.armazem.apagar(id);
    for (const fn of this.aoApagarFunil) await fn(id);
  }

  async criarEtapa(funilId: string, dados: { nome: string; cor?: string }, por: string): Promise<EtapaFunil> {
    await this.exigir(funilId);
    const etapas = await this.etapas(funilId);
    if (etapas.length >= LIMITE_ETAPAS) throw new ErroFunil(`Um funil pode ter até ${LIMITE_ETAPAS} etapas.`, 400);
    const t: EtapaFunil = {
      id: randomUUID(),
      empresaId: this.empresaId,
      nome: validarNome(dados.nome),
      cor: dados.cor ? validarCor(dados.cor) : CORES_TAGS[etapas.length % CORES_TAGS.length]!,
      ordem: etapas.reduce((m, x) => Math.max(m, x.ordem), -1) + 1,
      criadaPor: por,
      criadaEm: this.agora(),
      funilId,
      chaveSistema: null,
    };
    await this.o.armazemTags.criar(t);
    return t;
  }

  /** Renomear e recolorir (vale também para as etapas do sistema). */
  async alterarEtapa(funilId: string, etapaId: string, campos: { nome?: string; cor?: string }): Promise<EtapaFunil> {
    await this.exigirEtapa(funilId, etapaId);
    await this.o.armazemTags.atualizar(etapaId, {
      nome: campos.nome !== undefined ? validarNome(campos.nome) : undefined,
      cor: campos.cor !== undefined ? validarCor(campos.cor) : undefined,
    });
    return this.exigirEtapa(funilId, etapaId);
  }

  async reordenarEtapas(funilId: string, ids: string[]): Promise<EtapaFunil[]> {
    await this.exigir(funilId);
    const lista = await this.etapas(funilId);
    const conhecidas = new Set(lista.map((t) => t.id));
    if (ids.some((x) => !conhecidas.has(x))) throw new ErroFunil('Etapa não encontrada neste funil.', 404);
    const final = [...new Set(ids), ...lista.map((t) => t.id).filter((x) => !ids.includes(x))];
    for (const [i, id] of final.entries()) {
      if (lista.find((t) => t.id === id)!.ordem !== i) await this.o.armazemTags.atualizar(id, { ordem: i });
    }
    return this.etapas(funilId);
  }

  /**
   * Apaga a etapa. Com conversas nela, é preciso dizer para qual etapa do mesmo funil elas vão (`moverPara`).
   * Etapas do sistema não podem ser apagadas. Devolve quantas conversas foram movidas.
   */
  async apagarEtapa(funilId: string, etapaId: string, moverPara: string | undefined, por: string): Promise<number> {
    const etapa = await this.exigirEtapa(funilId, etapaId);
    if (etapa.chaveSistema) throw new ErroFunil('As etapas do funil do sistema podem ser renomeadas, mas não apagadas.', 409);
    const nelas = (await this.o.armazemTags.etapasDoFunil(funilId)).filter((m) => m.tagId === etapaId).length;
    let movidas = 0;
    if (nelas > 0) {
      if (!moverPara) {
        throw Object.assign(new ErroFunil(`Há ${nelas} conversa(s) nesta etapa. Escolha para qual etapa movê-las.`, 409), { codigo: 'etapa_com_conversas', conversas: nelas });
      }
      if (moverPara === etapaId) throw new ErroFunil('Escolha outra etapa para mover as conversas.', 400);
      await this.exigirEtapa(funilId, moverPara);
      movidas = await this.o.armazemTags.moverTodas(etapaId, moverPara, por, this.agora());
    }
    await this.o.armazemTags.apagar(etapaId);
    return movidas;
  }

  // ---------- cartões ----------

  /** Em que etapa de cada funil a conversa está. */
  async daConversa(c: Conversa) {
    const [funis, tags, marcas] = await Promise.all([this.listar(), this.o.armazemTags.listar(this.empresaId), this.o.armazemTags.etapasDaConversa(c.id)]);
    return funis.map((f) => {
      const m = marcas.find((x) => x.funilId === f.id);
      const t = m ? tags.find((x) => x.id === m.tagId) : undefined;
      return {
        funilId: f.id,
        funilNome: f.nome,
        sistema: f.sistema,
        etapa: t ? { id: t.id, nome: t.nome, cor: t.cor, chaveSistema: t.chaveSistema } : null,
        desde: m?.desde ?? null,
      };
    });
  }

  /** Quadro do funil: colunas (etapas) com uma página de cartões cada. */
  async quadro(funilId: string, filtro: FiltroQuadro) {
    const funil = await this.exigir(funilId);
    const etapas = (await this.etapas(funilId)).filter((e) => !filtro.etapaId || e.id === filtro.etapaId);
    const { totais, paradas, linhas } = await this.o.armazem.quadro(funilId, filtro);
    const tags = await this.o.tags.dasConversas(linhas.map((l) => l.conversaId));
    return {
      funil,
      colunas: etapas.map((e) => {
        const cartoes = linhas
          .filter((l) => l.tagId === e.id)
          .map(({ tagId: _t, ...l }): Cartao => ({ ...l, tags: (tags.get(l.conversaId) ?? []).filter((t) => !t.funilId) }));
        const total = totais.get(e.id) ?? 0;
        const ultimo = cartoes.at(-1);
        return {
          etapa: { id: e.id, nome: e.nome, cor: e.cor, ordem: e.ordem, chaveSistema: e.chaveSistema },
          total,
          /** Na etapa há mais de 3 dias (contado no servidor, com os filtros). */
          paradas: paradas.get(e.id) ?? 0,
          cartoes,
          offset: filtro.offset,
          mais: filtro.apos ? cartoes.length === filtro.limite : filtro.offset + cartoes.length < total,
          /** Cursor para o "carregar mais" desta coluna. */
          proximo: ultimo ? `${new Date(ultimo.atualizadaEm).toISOString()}|${ultimo.conversaId}` : null,
        };
      }),
    };
  }

  /** Busca no quadro do funil (nome ou telefone), para a lista que aparece debaixo do campo. */
  async buscar(funilId: string, termo: string, escopo: EscopoVisao, limite = 20): Promise<AchadoQuadro[]> {
    await this.exigir(funilId);
    if (termo.trim().length < 2) return [];
    return this.o.armazem.buscarCartoes(funilId, termo, escopo, limite);
  }
  async definirValor(c: Conversa, valor: number | null, por: string): Promise<number | null> {
    if (valor !== null && (!Number.isFinite(valor) || valor < 0 || valor > 10_000_000)) throw new ErroFunil('Valor inválido.', 400);
    await this.o.armazem.definirValor(c.id, valor === null ? null : Math.round(valor * 100) / 100, por);
    return this.o.armazem.valor(c.id);
  }
  valor(c: Conversa): Promise<number | null> {
    return this.o.armazem.valor(c.id);
  }

  /**
   * Move a conversa para a etapa (ou tira do funil, com etapaId null), já sob a trava da conversa.
   * No funil do sistema, conversa.etapa acompanha (quem chama grava a conversa). Devolve se mudou.
   */
  async moverSobTrava(c: Conversa, funilId: string, etapaId: string | null, por: QuemMove, automatico: boolean): Promise<{ mudou: boolean; de: string | null }> {
    const funil = await this.exigir(funilId);
    const agora = this.agora();
    if (etapaId === null) {
      if (funil.sistema) throw new ErroFunil('Toda conversa fica no funil do sistema: escolha uma etapa.', 400);
      const de = await this.o.armazemTags.tirarDoFunil(c.id, funilId);
      if (!de) return { mudou: false, de: null };
      await this.registrarMovimento({ conversa: c, funil, de, para: null, por, automatico });
      return { mudou: true, de };
    }
    const etapa = await this.exigirEtapa(funilId, etapaId);
    const r = await this.o.armazemTags.marcarEtapa(c.id, etapa.id, funilId, por.nome, agora);
    if (funil.sistema && etapa.chaveSistema && c.etapa !== etapa.chaveSistema) {
      // Escolha manual (pessoa ou automação): a etapa fixa acompanha, e o motor segue as regras de sempre.
      const de = c.etapa;
      c.etapa = etapa.chaveSistema as Etapa;
      await this.o.repo.registrarEvento({
        tipo: 'etapa_mudou',
        conversaId: c.id,
        unidade: c.unidade,
        em: agora,
        dados: { de, para: c.etapa, motivo: automatico ? 'automacao' : 'manual', por: por.nome, porId: por.id ?? null },
      });
      if (c.etapa === 'agendada' || c.etapa === 'compareceu' || c.etapa === 'perdida') await this.o.repo.cancelarTarefas(c.id, [...FOLLOWUPS]);
    }
    if (!r.mudou) return { mudou: false, de: r.de };
    await this.registrarMovimento({ conversa: c, funil, de: r.de, para: etapa.id, por, automatico });
    return { mudou: true, de: r.de };
  }

  /** Move pela tela (pega a trava da conversa). */
  async mover(conversaId: string, funilId: string, etapaId: string | null, por: QuemMove): Promise<{ mudou: boolean }> {
    const r = await this.o.comConversa(conversaId, async (c) => {
      const etapaAntes = c.etapa;
      const m = await this.moverSobTrava(c, funilId, etapaId, por, false);
      if (m.mudou || c.etapa !== etapaAntes) {
        c.atualizadaEm = this.agora();
        await this.o.repo.salvarConversa(c);
      }
      return m;
    });
    if (!r) throw new ErroFunil('Conversa não encontrada.', 404);
    return { mudou: r.mudou };
  }

  // DelegadoEtapas: POST/DELETE /api/conversas/:id/tags com uma tag que é etapa.
  async marcarEtapa(c: Conversa, tag: Tag, por: string): Promise<boolean> {
    return (await this.mover(c.id, tag.funilId!, tag.id, { nome: por })).mudou;
  }
  async desmarcarEtapa(c: Conversa, tag: Tag, por: string): Promise<boolean> {
    const atual = (await this.o.armazemTags.etapasDaConversa(c.id)).find((m) => m.funilId === tag.funilId);
    if (atual?.tagId !== tag.id) return false;
    return (await this.mover(c.id, tag.funilId!, null, { nome: por })).mudou;
  }

  private async registrarMovimento(m: MovimentoEtapa): Promise<void> {
    await this.o.repo.registrarEvento({
      tipo: 'etapa_movida',
      conversaId: m.conversa.id,
      unidade: m.conversa.unidade,
      em: this.agora(),
      dados: { funilId: m.funil.id, de: m.de, para: m.para, por: m.por.nome, porId: m.por.id ?? null, automatico: m.automatico },
    });
    for (const fn of this.observadores) {
      try {
        await fn(m);
      } catch (e) {
        this.log('Falha ao avisar movimento de etapa', String(e));
      }
    }
  }
}
