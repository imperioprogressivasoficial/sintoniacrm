import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Conversa } from '../domain.js';
import type { ArmazemCadastro, Produto, TipoProduto } from './cadastro.js';

/**
 * produtos-lead: produtos e serviços vinculados ao lead (como no Kommo). Migração 520.
 * - Cada lead (conversa) tem itens do cadastro de Empresa › Produtos e serviços: quantidade, preço do momento
 *   (o preço do cadastro quando entrou; dá para mudar) e desconto opcional (em reais, no total da linha).
 * - O mesmo produto entra uma vez só: adicionar de novo soma a quantidade.
 * - Opção da empresa (ligada por padrão): com produtos, o valor do lead (cartão do CRM) vira a soma deles.
 *   Sem produtos, o valor digitado à mão continua (e volta quando os produtos saem).
 * - O filtro do Pipeline (produtos e categorias) e o Exportar usam daqui.
 * Tudo por empresa: a conversa precisa ser da empresa, e o produto também.
 */

export interface ItemLead {
  id: string;
  conversaId: string;
  /** null = o produto foi apagado do cadastro (o item fica com o nome e o preço de quando entrou). */
  produtoId: string | null;
  nome: string;
  tipo: TipoProduto;
  categoria: string | null;
  quantidade: number;
  /** Preço unitário (R$). */
  preco: number;
  /** Desconto (R$) no total da linha. */
  desconto: number;
  criadoEm: Date;
  atualizadoEm: Date;
  atualizadoPor: string | null;
}
export type ItemNovo = Pick<ItemLead, 'produtoId' | 'nome' | 'tipo' | 'categoria' | 'quantidade' | 'preco' | 'desconto'>;
export type ItemEdicao = Partial<Pick<ItemLead, 'quantidade' | 'preco' | 'desconto'>>;

export interface EstadoValor {
  /** Valor digitado à mão antes dos produtos (null = não tinha). */
  valorManual: number | null;
  /** A última soma gravada como valor do lead. */
  ultimaSoma: number;
}

export const LIMITE_ITENS = 100;
export const centavos = (n: number) => Math.round(n * 100) / 100;
/** Total da linha: quantidade × preço − desconto (nunca negativo). */
export const totalItem = (i: Pick<ItemLead, 'quantidade' | 'preco' | 'desconto'>) => Math.max(0, centavos(i.quantidade * i.preco - i.desconto));
export const totalItens = (l: Array<Pick<ItemLead, 'quantidade' | 'preco' | 'desconto'>>) => centavos(l.reduce((s, i) => s + totalItem(i), 0));

export interface ArmazemProdutosLead {
  itens(empresaId: string, conversaId: string): Promise<ItemLead[]>;
  /** Itens de várias conversas (exportar, análises, cartões). */
  itensDe(empresaId: string, conversaIds: string[]): Promise<Map<string, ItemLead[]>>;
  /** Grava o item; se o produto já está no lead, soma a quantidade (e atualiza o preço e o desconto). */
  adicionar(empresaId: string, conversaId: string, item: ItemNovo, por: string): Promise<ItemLead>;
  alterar(empresaId: string, conversaId: string, id: string, campos: ItemEdicao, por: string): Promise<ItemLead | undefined>;
  remover(empresaId: string, conversaId: string, id: string): Promise<boolean>;
  /** Conversas da empresa com algum destes produtos. */
  conversasCom(empresaId: string, produtoIds: string[]): Promise<string[]>;
  estadoValor(conversaId: string): Promise<EstadoValor | undefined>;
  gravarEstadoValor(conversaId: string, e: EstadoValor | null): Promise<void>;
  config(empresaId: string): Promise<{ valorPelaSoma: boolean }>;
  gravarConfig(empresaId: string, c: { valorPelaSoma: boolean }, por: string): Promise<void>;
}

// ---------------------------------------------------------------- memória

export class ArmazemProdutosLeadMemoria implements ArmazemProdutosLead {
  private readonly lista: Array<ItemLead & { empresaId: string }> = [];
  private readonly estados = new Map<string, EstadoValor>();
  private readonly configs = new Map<string, boolean>();
  private sai = (i: ItemLead & { empresaId: string }): ItemLead => {
    const { empresaId: _e, ...r } = i;
    return structuredClone(r);
  };
  async itens(empresaId: string, conversaId: string) {
    return this.lista.filter((i) => i.empresaId === empresaId && i.conversaId === conversaId).map(this.sai);
  }
  async itensDe(empresaId: string, conversaIds: string[]) {
    const ids = new Set(conversaIds);
    const m = new Map<string, ItemLead[]>();
    for (const i of this.lista) if (i.empresaId === empresaId && ids.has(i.conversaId)) m.set(i.conversaId, [...(m.get(i.conversaId) ?? []), this.sai(i)]);
    return m;
  }
  async adicionar(empresaId: string, conversaId: string, item: ItemNovo, por: string) {
    const agora = new Date();
    const ja = item.produtoId ? this.lista.find((i) => i.empresaId === empresaId && i.conversaId === conversaId && i.produtoId === item.produtoId) : undefined;
    if (ja) {
      Object.assign(ja, { quantidade: Math.min(9999, ja.quantidade + item.quantidade), preco: item.preco, desconto: item.desconto, nome: item.nome, tipo: item.tipo, categoria: item.categoria, atualizadoEm: agora, atualizadoPor: por });
      return this.sai(ja);
    }
    const novo = { ...item, id: randomUUID(), empresaId, conversaId, criadoEm: agora, atualizadoEm: agora, atualizadoPor: por };
    this.lista.push(novo);
    return this.sai(novo);
  }
  async alterar(empresaId: string, conversaId: string, id: string, campos: ItemEdicao, por: string) {
    const i = this.lista.find((x) => x.id === id && x.empresaId === empresaId && x.conversaId === conversaId);
    if (!i) return undefined;
    for (const k of ['quantidade', 'preco', 'desconto'] as const) if (campos[k] !== undefined) i[k] = campos[k]!;
    i.atualizadoEm = new Date();
    i.atualizadoPor = por;
    return this.sai(i);
  }
  async remover(empresaId: string, conversaId: string, id: string) {
    const n = this.lista.findIndex((x) => x.id === id && x.empresaId === empresaId && x.conversaId === conversaId);
    if (n < 0) return false;
    this.lista.splice(n, 1);
    return true;
  }
  async conversasCom(empresaId: string, produtoIds: string[]) {
    const ids = new Set(produtoIds);
    return [...new Set(this.lista.filter((i) => i.empresaId === empresaId && i.produtoId && ids.has(i.produtoId)).map((i) => i.conversaId))];
  }
  async estadoValor(conversaId: string) {
    const e = this.estados.get(conversaId);
    return e ? { ...e } : undefined;
  }
  async gravarEstadoValor(conversaId: string, e: EstadoValor | null) {
    if (e) this.estados.set(conversaId, { ...e });
    else this.estados.delete(conversaId);
  }
  async config(empresaId: string) {
    return { valorPelaSoma: this.configs.get(empresaId) ?? true };
  }
  async gravarConfig(empresaId: string, c: { valorPelaSoma: boolean }) {
    this.configs.set(empresaId, c.valorPelaSoma);
  }
}

// ---------------------------------------------------------------- postgres

interface LinhaItem {
  id: string;
  conversa_id: string;
  produto_id: string | null;
  nome: string;
  tipo: TipoProduto;
  categoria: string | null;
  quantidade: number;
  preco: string;
  desconto: string;
  criado_em: Date;
  atualizado_em: Date;
  atualizado_por: string | null;
}
const COLUNAS = `id::text as id, conversa_id::text as conversa_id, produto_id::text as produto_id, nome, tipo, categoria, quantidade,
  preco::text as preco, desconto::text as desconto, criado_em, atualizado_em, atualizado_por`;
const deLinha = (r: LinhaItem): ItemLead => ({
  id: r.id,
  conversaId: r.conversa_id,
  produtoId: r.produto_id,
  nome: r.nome,
  tipo: r.tipo,
  categoria: r.categoria,
  quantidade: Number(r.quantidade),
  preco: Number(r.preco),
  desconto: Number(r.desconto),
  criadoEm: r.criado_em,
  atualizadoEm: r.atualizado_em,
  atualizadoPor: r.atualizado_por,
});
const ehUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class ArmazemProdutosLeadPostgres implements ArmazemProdutosLead {
  constructor(private readonly pool: pg.Pool) {}
  async itens(empresaId: string, conversaId: string) {
    if (!ehUuid(conversaId)) return [];
    const { rows } = await this.pool.query<LinhaItem>(`select ${COLUNAS} from sintonia.lead_produtos where empresa_id = $1 and conversa_id = $2 order by criado_em, id`, [empresaId, conversaId]);
    return rows.map(deLinha);
  }
  async itensDe(empresaId: string, conversaIds: string[]) {
    const ids = conversaIds.filter(ehUuid);
    const m = new Map<string, ItemLead[]>();
    if (!ids.length) return m;
    const { rows } = await this.pool.query<LinhaItem>(`select ${COLUNAS} from sintonia.lead_produtos where empresa_id = $1 and conversa_id = any($2::uuid[]) order by criado_em, id`, [empresaId, ids]);
    for (const r of rows) m.set(r.conversa_id, [...(m.get(r.conversa_id) ?? []), deLinha(r)]);
    return m;
  }
  async adicionar(empresaId: string, conversaId: string, i: ItemNovo, por: string) {
    const { rows } = await this.pool.query<LinhaItem>(
      `insert into sintonia.lead_produtos (empresa_id, conversa_id, produto_id, nome, tipo, categoria, quantidade, preco, desconto, atualizado_por)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (conversa_id, produto_id) where produto_id is not null do update set
         quantidade = least(9999, sintonia.lead_produtos.quantidade + excluded.quantidade), preco = excluded.preco, desconto = excluded.desconto,
         nome = excluded.nome, tipo = excluded.tipo, categoria = excluded.categoria, atualizado_em = now(), atualizado_por = excluded.atualizado_por
       returning ${COLUNAS}`,
      [empresaId, conversaId, i.produtoId, i.nome, i.tipo, i.categoria, i.quantidade, i.preco, i.desconto, por],
    );
    return deLinha(rows[0]!);
  }
  async alterar(empresaId: string, conversaId: string, id: string, c: ItemEdicao, por: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<LinhaItem>(
      `update sintonia.lead_produtos set quantidade = coalesce($4, quantidade), preco = coalesce($5, preco), desconto = coalesce($6, desconto),
              atualizado_em = now(), atualizado_por = $7
        where id = $1 and empresa_id = $2 and conversa_id = $3 returning ${COLUNAS}`,
      [id, empresaId, conversaId, c.quantidade ?? null, c.preco ?? null, c.desconto ?? null, por],
    );
    return rows[0] ? deLinha(rows[0]) : undefined;
  }
  async remover(empresaId: string, conversaId: string, id: string) {
    if (!ehUuid(id)) return false;
    const r = await this.pool.query('delete from sintonia.lead_produtos where id = $1 and empresa_id = $2 and conversa_id = $3', [id, empresaId, conversaId]);
    return (r.rowCount ?? 0) > 0;
  }
  async conversasCom(empresaId: string, produtoIds: string[]) {
    const ids = produtoIds.filter(ehUuid);
    if (!ids.length) return [];
    const { rows } = await this.pool.query<{ id: string }>(
      'select distinct conversa_id::text as id from sintonia.lead_produtos where empresa_id = $1 and produto_id = any($2::uuid[])',
      [empresaId, ids],
    );
    return rows.map((r) => r.id);
  }
  async estadoValor(conversaId: string) {
    const { rows } = await this.pool.query<{ valor_manual: string | null; ultima_soma: string }>(
      'select valor_manual::text as valor_manual, ultima_soma::text as ultima_soma from sintonia.lead_produtos_valor where conversa_id = $1',
      [conversaId],
    );
    const r = rows[0];
    return r ? { valorManual: r.valor_manual === null ? null : Number(r.valor_manual), ultimaSoma: Number(r.ultima_soma) } : undefined;
  }
  async gravarEstadoValor(conversaId: string, e: EstadoValor | null) {
    if (!e) await this.pool.query('delete from sintonia.lead_produtos_valor where conversa_id = $1', [conversaId]);
    else
      await this.pool.query(
        `insert into sintonia.lead_produtos_valor (conversa_id, valor_manual, ultima_soma) values ($1, $2, $3)
         on conflict (conversa_id) do update set valor_manual = excluded.valor_manual, ultima_soma = excluded.ultima_soma`,
        [conversaId, e.valorManual, e.ultimaSoma],
      );
  }
  async config(empresaId: string) {
    const { rows } = await this.pool.query<{ v: boolean }>('select valor_pela_soma as v from sintonia.lead_produtos_config where empresa_id = $1', [empresaId]);
    return { valorPelaSoma: rows[0]?.v ?? true };
  }
  async gravarConfig(empresaId: string, c: { valorPelaSoma: boolean }, por: string) {
    await this.pool.query(
      `insert into sintonia.lead_produtos_config (empresa_id, valor_pela_soma, atualizado_em, atualizado_por) values ($1, $2, now(), $3)
       on conflict (empresa_id) do update set valor_pela_soma = excluded.valor_pela_soma, atualizado_em = now(), atualizado_por = excluded.atualizado_por`,
      [empresaId, c.valorPelaSoma, por],
    );
  }
}

// ---------------------------------------------------------------- serviço

export class ErroProdutosLead extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

/** O valor do negócio do cartão do CRM (Funis.valor / Funis.definirValor). */
export interface ValorDoLead {
  valor(c: Conversa): Promise<number | null>;
  definirValor(c: Conversa, valor: number | null, por: string): Promise<number | null>;
}

export interface OpcoesProdutosLead {
  armazem: ArmazemProdutosLead;
  cadastro: ArmazemCadastro;
  valor: ValorDoLead;
}

/** Item como sai para a tela: com o total da linha e o nome/categoria atuais do cadastro (se o produto ainda existe). */
export type ItemPublico = ItemLead & { total: number; ativo: boolean | null };

const dinheiro = (n: number) => `R$ ${n.toFixed(2).replace('.', ',')}`;

export class ProdutosLead {
  constructor(private readonly o: OpcoesProdutosLead) {}

  private async catalogo(empresaId: string) {
    return new Map((await this.o.cadastro.produtos(empresaId)).map((p) => [p.id, p]));
  }
  private publico(i: ItemLead, cat: Map<string, Produto>): ItemPublico {
    const p = i.produtoId ? cat.get(i.produtoId) : undefined;
    return { ...i, nome: p?.nome ?? i.nome, categoria: p ? p.categoria : i.categoria, tipo: p?.tipo ?? i.tipo, total: totalItem(i), ativo: p ? p.ativo : null };
  }

  /** Itens do lead, o total e a opção da empresa. */
  async daConversa(c: Conversa) {
    const [itens, cat, cfg, valor] = await Promise.all([this.o.armazem.itens(c.empresaId, c.id), this.catalogo(c.empresaId), this.o.armazem.config(c.empresaId), this.o.valor.valor(c)]);
    const lista = itens.map((i) => this.publico(i, cat));
    return { itens: lista, total: totalItens(lista), valor, valorPelaSoma: cfg.valorPelaSoma, valorCalculado: cfg.valorPelaSoma && lista.length > 0 };
  }

  async adicionar(c: Conversa, d: { produtoId: string; quantidade?: number; preco?: number | null; desconto?: number }, por: string) {
    const p = await this.o.cadastro.produto(c.empresaId, d.produtoId);
    if (!p) throw new ErroProdutosLead('Produto ou serviço não encontrado.', 404);
    const itens = await this.o.armazem.itens(c.empresaId, c.id);
    const ja = itens.find((i) => i.produtoId === p.id);
    if (!ja && !p.ativo) throw new ErroProdutosLead('Este produto está desativado no cadastro.', 409);
    if (!ja && itens.length >= LIMITE_ITENS) throw new ErroProdutosLead(`Um lead pode ter até ${LIMITE_ITENS} produtos e serviços.`, 400);
    const preco = centavos(d.preco ?? (ja ? ja.preco : (p.preco ?? 0)));
    await this.o.armazem.adicionar(
      c.empresaId,
      c.id,
      { produtoId: p.id, nome: p.nome, tipo: p.tipo, categoria: p.categoria, quantidade: d.quantidade ?? 1, preco, desconto: centavos(d.desconto ?? ja?.desconto ?? 0) },
      por,
    );
    await this.sincronizarValor(c, por);
    return this.daConversa(c);
  }

  async alterar(c: Conversa, id: string, campos: ItemEdicao, por: string) {
    const r = await this.o.armazem.alterar(c.empresaId, c.id, id, {
      quantidade: campos.quantidade,
      preco: campos.preco === undefined ? undefined : centavos(campos.preco),
      desconto: campos.desconto === undefined ? undefined : centavos(campos.desconto),
    }, por);
    if (!r) throw new ErroProdutosLead('Este item não está mais no lead.', 404);
    await this.sincronizarValor(c, por);
    return this.daConversa(c);
  }

  async remover(c: Conversa, id: string, por: string) {
    if (!(await this.o.armazem.remover(c.empresaId, c.id, id))) throw new ErroProdutosLead('Este item não está mais no lead.', 404);
    await this.sincronizarValor(c, por);
    return this.daConversa(c);
  }

  async config(empresaId: string) {
    return this.o.armazem.config(empresaId);
  }
  async gravarConfig(empresaId: string, valorPelaSoma: boolean, por: string) {
    await this.o.armazem.gravarConfig(empresaId, { valorPelaSoma }, por);
    return this.o.armazem.config(empresaId);
  }

  /**
   * Valor do lead = soma dos produtos (com a opção ligada e pelo menos um produto).
   * Guarda o valor digitado à mão antes, para voltar quando os produtos saem. Se alguém mudou o valor
   * à mão depois da última soma, a mudança passa a ser o "valor digitado".
   */
  async sincronizarValor(c: Conversa, por: string): Promise<void> {
    const [itens, cfg, estado, atual] = await Promise.all([this.o.armazem.itens(c.empresaId, c.id), this.o.armazem.config(c.empresaId), this.o.armazem.estadoValor(c.id), this.o.valor.valor(c)]);
    const nossa = estado && atual !== null && centavos(atual) === centavos(estado.ultimaSoma);
    const manual = nossa ? estado!.valorManual : atual;
    if (cfg.valorPelaSoma && itens.length) {
      const soma = totalItens(itens);
      if (atual === null || centavos(atual) !== soma) await this.o.valor.definirValor(c, soma, por);
      await this.o.armazem.gravarEstadoValor(c.id, { valorManual: manual, ultimaSoma: soma });
      return;
    }
    if (estado) {
      if (nossa) await this.o.valor.definirValor(c, estado.valorManual, por);
      await this.o.armazem.gravarEstadoValor(c.id, null);
    }
  }

  /**
   * Filtro do Pipeline: conversas com algum dos produtos E (se pedir) com algum produto das categorias.
   * Categoria = a do cadastro agora.
   */
  async conversasComFiltro(empresaId: string, f: { produtos: string[]; categorias: string[] }): Promise<string[]> {
    let ids: Set<string> | null = null;
    if (f.produtos.length) ids = new Set(await this.o.armazem.conversasCom(empresaId, f.produtos));
    if (f.categorias.length) {
      const cats = new Set(f.categorias.map((x) => x.trim().toLowerCase()));
      const daCategoria = (await this.o.cadastro.produtos(empresaId)).filter((p) => p.categoria && cats.has(p.categoria.trim().toLowerCase())).map((p) => p.id);
      const comCat = new Set(daCategoria.length ? await this.o.armazem.conversasCom(empresaId, daCategoria) : []);
      ids = ids ? new Set([...ids].filter((x) => comCat.has(x))) : comCat;
    }
    return [...(ids ?? [])];
  }

  /** Texto curto por conversa para o Exportar: "2× Escova; Hidratação". */
  async resumoDe(empresaId: string, conversaIds: string[]): Promise<Map<string, string>> {
    const [m, cat] = await Promise.all([this.o.armazem.itensDe(empresaId, conversaIds), this.catalogo(empresaId)]);
    const r = new Map<string, string>();
    for (const [id, itens] of m) r.set(id, itens.map((i) => this.publico(i, cat)).map((i) => (i.quantidade > 1 ? `${i.quantidade}× ${i.nome}` : i.nome)).join('; '));
    return r;
  }

  /** Para a IA: o que está vinculado ao lead (ou null, se nada). */
  async textoParaIa(c: Conversa): Promise<string | null> {
    const { itens, total } = await this.daConversa(c);
    if (!itens.length) return null;
    const linhas = itens.map((i) => `${i.quantidade}× ${i.nome} (${i.tipo === 'servico' ? 'serviço' : 'produto'}, ${dinheiro(i.preco)} cada${i.desconto ? `, desconto de ${dinheiro(i.desconto)}` : ''})`);
    return `Produtos e serviços que a equipe vinculou a esta cliente (interesse ou negócio em andamento): ${linhas.join('; ')}. Total: ${dinheiro(total)}.`;
  }

  /**
   * Receita por produto/serviço vinculado (Análises › Vendas): soma os itens das conversas que tiveram venda no período.
   * Cada conversa conta uma vez.
   */
  async porProduto(empresaId: string, conversaIds: string[]) {
    const [m, cat] = await Promise.all([this.o.armazem.itensDe(empresaId, [...new Set(conversaIds)]), this.catalogo(empresaId)]);
    const g = new Map<string, { nome: string; tipo: TipoProduto; categoria: string | null; leads: number; quantidade: number; receita: number }>();
    for (const itens of m.values()) {
      for (const bruto of itens) {
        const i = this.publico(bruto, cat);
        const chave = i.produtoId ?? `nome:${i.nome.toLowerCase()}`;
        const x = g.get(chave) ?? { nome: i.nome, tipo: i.tipo, categoria: i.categoria, leads: 0, quantidade: 0, receita: 0 };
        x.leads++;
        x.quantidade += i.quantidade;
        x.receita = centavos(x.receita + i.total);
        g.set(chave, x);
      }
    }
    return [...g.values()].sort((a, b) => b.receita - a.receita || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'));
  }
}
