import type pg from 'pg';

/** ia-aprende: o que fica guardado no banco (configuração, rodadas de estudo, aprendizados e conversas já lidas). */

export type Categoria = 'roteiro' | 'tom' | 'pergunta' | 'objecao' | 'fato' | 'evitar';
export const CATEGORIAS: Categoria[] = ['roteiro', 'tom', 'pergunta', 'objecao', 'fato', 'evitar'];
export type Acao = 'acrescentar' | 'pergunta' | 'corrigir';
export type SituacaoItem = 'pendente' | 'aplicado' | 'recusado' | 'desfeito';

export interface ConfigAprender {
  auto: boolean;
  ultimoEstudo: Date | null;
  atualizadoEm: Date | null;
  atualizadoPor: string | null;
}

/** Uma observação tirada de um lote de conversas (antes de juntar tudo). `conversas` = números das conversas na rodada. */
export interface Observacao {
  categoria: Categoria;
  texto: string;
  conversas: number[];
  exemplo?: string;
}

export interface ResultadoRodada {
  lidas: number;
  aprendizados: number;
  entraram: number;
  paraAprovar: number;
  reforcados: number;
}

export interface Rodada {
  id: string;
  empresaId: string;
  origem: 'conversas' | 'documento';
  situacao: 'estudando' | 'juntando' | 'pronta' | 'falhou';
  pedidaPor: string | null;
  criadaEm: Date;
  atualizadaEm: Date;
  terminadaEm: Date | null;
  /** Conversas da rodada, na ordem de leitura (id, até que mensagem, se agendou e o nome para tirar do texto; o nome some ao terminar). */
  conversas: Array<{ id: string; ate: string; agendou?: boolean; nome?: string }>;
  lidas: number;
  total: number;
  observacoes: Observacao[];
  tokensEntrada: number;
  tokensSaida: number;
  resultado: ResultadoRodada | null;
  erro: string | null;
  documentoNome: string | null;
  documentoTexto: string | null;
  documentoPdf: Buffer | null;
}

export interface Item {
  id: string;
  empresaId: string;
  rodadaId: string | null;
  /** 'conversas' ou 'documento: nome.pdf'. */
  origem: string;
  categoria: Categoria;
  acao: Acao;
  /** Chave da seção, 'perguntas-frequentes' ou o grupo (categoria) quando não há seção. */
  destino: string;
  titulo: string;
  texto: string;
  pergunta: string | null;
  resposta: string | null;
  /** Para "corrigir": o trecho da base que muda. */
  trechoAtual: string | null;
  conversas: number;
  exemplos: string[];
  conferir: boolean;
  contradiz: boolean;
  motivo: string | null;
  situacao: SituacaoItem;
  automatico: boolean;
  criadoEm: Date;
  decididoEm: Date | null;
  decididoPor: string | null;
  desfeitoEm: Date | null;
  desfeitoPor: string | null;
  /** O que foi mudado na base (para desfazer): seção, texto antes e depois. */
  aplicacao: { secao?: string; antes?: string; depois?: string } | null;
}

export interface ArmazemAprender {
  config(empresaId: string): Promise<ConfigAprender>;
  gravarConfig(empresaId: string, c: Partial<Pick<ConfigAprender, 'auto' | 'ultimoEstudo'>>, por: string | null, em: Date): Promise<ConfigAprender>;
  /** Cria a rodada. Devolve false se já há um estudo das conversas em andamento (uma por vez). */
  criarRodada(r: Rodada): Promise<boolean>;
  rodada(empresaId: string, id: string): Promise<Rodada | undefined>;
  gravarRodada(r: Rodada): Promise<void>;
  /** Pega a rodada para trabalhar se ninguém mexeu nela há `folgaMs` (retomar depois de reiniciar sem dois processos juntos). */
  reservarRodada(empresaId: string, id: string, agora: Date, folgaMs: number): Promise<boolean>;
  rodadas(empresaId: string, limite: number): Promise<Rodada[]>;
  /** Rodadas paradas no meio (estudando/juntando), de todas as empresas. */
  emAndamento(): Promise<Rodada[]>;
  itens(empresaId: string, situacoes?: SituacaoItem[]): Promise<Item[]>;
  item(empresaId: string, id: string): Promise<Item | undefined>;
  gravarItem(i: Item): Promise<void>;
  lidas(empresaId: string): Promise<Map<string, Date>>;
  marcarLidas(empresaId: string, l: Array<{ id: string; ate: Date }>): Promise<void>;
}

const CONFIG_PADRAO: ConfigAprender = { auto: true, ultimoEstudo: null, atualizadoEm: null, atualizadoPor: null };
const copia = <T>(x: T): T => structuredClone(x);

export class ArmazemAprenderMemoria implements ArmazemAprender {
  private cfg = new Map<string, ConfigAprender>();
  private rods = new Map<string, Rodada>();
  private its = new Map<string, Item>();
  private lid = new Map<string, Map<string, Date>>();

  async config(empresaId: string) {
    return copia(this.cfg.get(empresaId) ?? CONFIG_PADRAO);
  }
  async gravarConfig(empresaId: string, c: Partial<Pick<ConfigAprender, 'auto' | 'ultimoEstudo'>>, por: string | null, em: Date) {
    const atual = await this.config(empresaId);
    const novo = { ...atual, ...c, ...(c.auto !== undefined ? { atualizadoEm: em, atualizadoPor: por } : {}) };
    this.cfg.set(empresaId, novo);
    return copia(novo);
  }
  async criarRodada(r: Rodada) {
    if (r.origem === 'conversas' && [...this.rods.values()].some((x) => x.empresaId === r.empresaId && x.origem === 'conversas' && (x.situacao === 'estudando' || x.situacao === 'juntando'))) return false;
    this.rods.set(r.id, copia(r));
    return true;
  }
  async rodada(empresaId: string, id: string) {
    const r = this.rods.get(id);
    return r && r.empresaId === empresaId ? copia(r) : undefined;
  }
  async gravarRodada(r: Rodada) {
    this.rods.set(r.id, copia(r));
  }
  async reservarRodada(empresaId: string, id: string, agora: Date, folgaMs: number) {
    const r = this.rods.get(id);
    if (!r || r.empresaId !== empresaId || !(r.situacao === 'estudando' || r.situacao === 'juntando')) return false;
    if (agora.getTime() - r.atualizadaEm.getTime() < folgaMs) return false;
    r.atualizadaEm = agora;
    return true;
  }
  async rodadas(empresaId: string, limite: number) {
    return [...this.rods.values()]
      .filter((r) => r.empresaId === empresaId)
      .sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime())
      .slice(0, limite)
      .map(copia);
  }
  async emAndamento() {
    return [...this.rods.values()].filter((r) => r.situacao === 'estudando' || r.situacao === 'juntando').map(copia);
  }
  async itens(empresaId: string, situacoes?: SituacaoItem[]) {
    return [...this.its.values()]
      .filter((i) => i.empresaId === empresaId && (!situacoes || situacoes.includes(i.situacao)))
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
      .map(copia);
  }
  async item(empresaId: string, id: string) {
    const i = this.its.get(id);
    return i && i.empresaId === empresaId ? copia(i) : undefined;
  }
  async gravarItem(i: Item) {
    this.its.set(i.id, copia(i));
  }
  async lidas(empresaId: string) {
    return new Map(this.lid.get(empresaId) ?? []);
  }
  async marcarLidas(empresaId: string, l: Array<{ id: string; ate: Date }>) {
    const m = this.lid.get(empresaId) ?? new Map<string, Date>();
    for (const x of l) m.set(x.id, x.ate);
    this.lid.set(empresaId, m);
  }
}

type Linha = Record<string, unknown>;
const data = (v: unknown) => (v ? new Date(v as string) : null);

const paraRodada = (l: Linha): Rodada => ({
  id: l.id as string,
  empresaId: l.empresa_id as string,
  origem: l.origem as Rodada['origem'],
  situacao: l.situacao as Rodada['situacao'],
  pedidaPor: (l.pedida_por as string) ?? null,
  criadaEm: new Date(l.criada_em as string),
  atualizadaEm: new Date(l.atualizada_em as string),
  terminadaEm: data(l.terminada_em),
  conversas: (l.conversas as Rodada['conversas']) ?? [],
  lidas: Number(l.lidas),
  total: Number(l.total),
  observacoes: (l.observacoes as Observacao[]) ?? [],
  tokensEntrada: Number(l.tokens_entrada),
  tokensSaida: Number(l.tokens_saida),
  resultado: (l.resultado as ResultadoRodada) ?? null,
  erro: (l.erro as string) ?? null,
  documentoNome: (l.documento_nome as string) ?? null,
  documentoTexto: (l.documento_texto as string) ?? null,
  documentoPdf: (l.documento_pdf as Buffer) ?? null,
});

const paraItem = (l: Linha): Item => ({
  id: l.id as string,
  empresaId: l.empresa_id as string,
  rodadaId: (l.rodada_id as string) ?? null,
  origem: l.origem as string,
  categoria: l.categoria as Categoria,
  acao: l.acao as Acao,
  destino: l.destino as string,
  titulo: l.titulo as string,
  texto: l.texto as string,
  pergunta: (l.pergunta as string) ?? null,
  resposta: (l.resposta as string) ?? null,
  trechoAtual: (l.trecho_atual as string) ?? null,
  conversas: Number(l.conversas),
  exemplos: (l.exemplos as string[]) ?? [],
  conferir: Boolean(l.conferir),
  contradiz: Boolean(l.contradiz),
  motivo: (l.motivo as string) ?? null,
  situacao: l.situacao as SituacaoItem,
  automatico: Boolean(l.automatico),
  criadoEm: new Date(l.criado_em as string),
  decididoEm: data(l.decidido_em),
  decididoPor: (l.decidido_por as string) ?? null,
  desfeitoEm: data(l.desfeito_em),
  desfeitoPor: (l.desfeito_por as string) ?? null,
  aplicacao: (l.aplicacao as Item['aplicacao']) ?? null,
});

const COLUNAS_RODADA = 'id, empresa_id, origem, situacao, pedida_por, criada_em, atualizada_em, terminada_em, conversas, lidas, total, observacoes, tokens_entrada, tokens_saida, resultado, erro, documento_nome, documento_texto, documento_pdf';
const valoresRodada = (r: Rodada) => [
  r.id, r.empresaId, r.origem, r.situacao, r.pedidaPor, r.criadaEm, r.atualizadaEm, r.terminadaEm,
  JSON.stringify(r.conversas), r.lidas, r.total, JSON.stringify(r.observacoes), r.tokensEntrada, r.tokensSaida,
  r.resultado ? JSON.stringify(r.resultado) : null, r.erro, r.documentoNome, r.documentoTexto, r.documentoPdf,
];

export class ArmazemAprenderPostgres implements ArmazemAprender {
  constructor(private readonly pool: pg.Pool) {}

  async config(empresaId: string) {
    const { rows } = await this.pool.query('select auto, ultimo_estudo, atualizado_em, atualizado_por from sintonia.aprender_config where empresa_id = $1', [empresaId]);
    const l = rows[0];
    return l ? { auto: Boolean(l.auto), ultimoEstudo: data(l.ultimo_estudo), atualizadoEm: data(l.atualizado_em), atualizadoPor: l.atualizado_por ?? null } : { ...CONFIG_PADRAO };
  }
  async gravarConfig(empresaId: string, c: Partial<Pick<ConfigAprender, 'auto' | 'ultimoEstudo'>>, por: string | null, em: Date) {
    await this.pool.query(
      `insert into sintonia.aprender_config (empresa_id, auto, ultimo_estudo, atualizado_em, atualizado_por)
       values ($1, coalesce($2, true), $3, $4, $5)
       on conflict (empresa_id) do update set
         auto = coalesce($2, aprender_config.auto),
         ultimo_estudo = coalesce($3, aprender_config.ultimo_estudo),
         atualizado_em = case when $2::boolean is null then aprender_config.atualizado_em else $4 end,
         atualizado_por = case when $2::boolean is null then aprender_config.atualizado_por else $5 end`,
      [empresaId, c.auto ?? null, c.ultimoEstudo ?? null, em, c.auto !== undefined ? por : null],
    );
    return this.config(empresaId);
  }
  async criarRodada(r: Rodada) {
    try {
      await this.pool.query(`insert into sintonia.aprender_rodadas (${COLUNAS_RODADA}) values (${valoresRodada(r).map((_, i) => `$${i + 1}`).join(', ')})`, valoresRodada(r));
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return false;
      throw e;
    }
  }
  async rodada(empresaId: string, id: string) {
    const { rows } = await this.pool.query(`select ${COLUNAS_RODADA} from sintonia.aprender_rodadas where empresa_id = $1 and id = $2`, [empresaId, id]);
    return rows[0] ? paraRodada(rows[0]) : undefined;
  }
  async gravarRodada(r: Rodada) {
    const v = valoresRodada(r);
    await this.pool.query(
      `update sintonia.aprender_rodadas set ${COLUNAS_RODADA.split(', ')
        .slice(2)
        .map((c, i) => `${c} = $${i + 3}`)
        .join(', ')} where id = $1 and empresa_id = $2`,
      v,
    );
  }
  async reservarRodada(empresaId: string, id: string, agora: Date, folgaMs: number) {
    const r = await this.pool.query(
      `update sintonia.aprender_rodadas set atualizada_em = $3
        where empresa_id = $1 and id = $2 and situacao in ('estudando', 'juntando') and atualizada_em <= $4`,
      [empresaId, id, agora, new Date(agora.getTime() - folgaMs)],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async rodadas(empresaId: string, limite: number) {
    const { rows } = await this.pool.query(
      `select ${COLUNAS_RODADA.replace(', documento_pdf', ', null as documento_pdf')} from sintonia.aprender_rodadas where empresa_id = $1 order by criada_em desc limit $2`,
      [empresaId, limite],
    );
    return rows.map(paraRodada);
  }
  async emAndamento() {
    const { rows } = await this.pool.query(`select ${COLUNAS_RODADA} from sintonia.aprender_rodadas where situacao in ('estudando', 'juntando')`);
    return rows.map(paraRodada);
  }
  async itens(empresaId: string, situacoes?: SituacaoItem[]) {
    const { rows } = await this.pool.query(
      `select * from sintonia.aprender_itens where empresa_id = $1 ${situacoes ? 'and situacao = any($2)' : ''} order by criado_em desc limit 1000`,
      situacoes ? [empresaId, situacoes] : [empresaId],
    );
    return rows.map(paraItem);
  }
  async item(empresaId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
    const { rows } = await this.pool.query('select * from sintonia.aprender_itens where empresa_id = $1 and id = $2', [empresaId, id]);
    return rows[0] ? paraItem(rows[0]) : undefined;
  }
  async gravarItem(i: Item) {
    const v = [
      i.id, i.empresaId, i.rodadaId, i.origem, i.categoria, i.acao, i.destino, i.titulo, i.texto, i.pergunta, i.resposta, i.trechoAtual,
      i.conversas, JSON.stringify(i.exemplos), i.conferir, i.contradiz, i.motivo, i.situacao, i.automatico, i.criadoEm,
      i.decididoEm, i.decididoPor, i.desfeitoEm, i.desfeitoPor, i.aplicacao ? JSON.stringify(i.aplicacao) : null,
    ];
    const cols = 'id, empresa_id, rodada_id, origem, categoria, acao, destino, titulo, texto, pergunta, resposta, trecho_atual, conversas, exemplos, conferir, contradiz, motivo, situacao, automatico, criado_em, decidido_em, decidido_por, desfeito_em, desfeito_por, aplicacao';
    await this.pool.query(
      `insert into sintonia.aprender_itens (${cols}) values (${v.map((_, n) => `$${n + 1}`).join(', ')})
       on conflict (id) do update set ${cols
         .split(', ')
         .slice(3)
         .map((c) => `${c} = excluded.${c}`)
         .join(', ')}`,
      v,
    );
  }
  async lidas(empresaId: string) {
    const { rows } = await this.pool.query<{ conversa_id: string; ate: Date }>('select conversa_id, ate from sintonia.aprender_lidas where empresa_id = $1', [empresaId]);
    return new Map(rows.map((r) => [r.conversa_id, r.ate]));
  }
  async marcarLidas(empresaId: string, l: Array<{ id: string; ate: Date }>) {
    if (!l.length) return;
    await this.pool.query(
      `insert into sintonia.aprender_lidas (empresa_id, conversa_id, ate)
       select $1, x.id::uuid, x.ate::timestamptz from jsonb_to_recordset($2::jsonb) as x(id text, ate text)
       on conflict (empresa_id, conversa_id) do update set ate = greatest(aprender_lidas.ate, excluded.ate)`,
      [empresaId, JSON.stringify(l.map((x) => ({ id: x.id, ate: x.ate.toISOString() })))],
    );
  }
}
