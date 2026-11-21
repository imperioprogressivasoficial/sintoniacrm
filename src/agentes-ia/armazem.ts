import type pg from 'pg';
import { ConfigAgente, ConfigControle, type AgenteIa, type Aprendizado, type Conhecimento, type MemoriaCliente, type RegistroComando } from './tipos.js';

/** Onde o estúdio de agentes guarda tudo. Memória (testes, sem banco) e Postgres (migração 130). */
export interface ArmazemAgentesIa {
  listar(empresaId: string): Promise<AgenteIa[]>;
  buscar(id: string): Promise<AgenteIa | undefined>;
  salvar(a: AgenteIa): Promise<void>;
  apagar(id: string): Promise<void>;

  conhecimentos(agenteId: string): Promise<Conhecimento[]>;
  adicionarConhecimento(k: Conhecimento): Promise<void>;
  apagarConhecimento(agenteId: string, id: string): Promise<boolean>;

  memoria(empresaId: string, telefone: string): Promise<MemoriaCliente[]>;
  gravarMemoria(empresaId: string, m: MemoriaCliente): Promise<void>;
  apagarMemoria(empresaId: string, telefone: string, chave: string): Promise<boolean>;
  memoriasRecentes(empresaId: string, limite: number): Promise<MemoriaCliente[]>;

  aprendizados(agenteId: string, situacao?: Aprendizado['situacao']): Promise<Aprendizado[]>;
  aprendizadosDaEmpresa(empresaId: string, situacao?: Aprendizado['situacao']): Promise<Aprendizado[]>;
  adicionarAprendizado(a: Aprendizado): Promise<void>;
  decidirAprendizado(id: string, situacao: 'aprovado' | 'recusado', por: string, em: Date, texto?: string): Promise<Aprendizado | undefined>;

  agenteDaConversa(conversaId: string): Promise<{ agenteId: string; desde: Date; motivo: string } | undefined>;
  definirAgenteDaConversa(conversaId: string, agenteId: string | null, motivo: string, em: Date): Promise<void>;
  conversasComAgente(): Promise<Array<{ conversaId: string; agenteId: string; desde: Date; motivo: string }>>;

  controle(empresaId: string): Promise<ConfigControle>;
  gravarControle(empresaId: string, c: ConfigControle, por: string, em: Date): Promise<void>;

  gravarComando(c: RegistroComando): Promise<void>;
  comando(id: string): Promise<RegistroComando | undefined>;
  comandos(empresaId: string, limite: number): Promise<RegistroComando[]>;
}

const clone = <T>(x: T): T => structuredClone(x);

export class ArmazemAgentesIaMemoria implements ArmazemAgentesIa {
  private agentes = new Map<string, AgenteIa>();
  private conh = new Map<string, Conhecimento>();
  private mem = new Map<string, MemoriaCliente & { empresaId: string }>();
  private apr = new Map<string, Aprendizado>();
  private donos = new Map<string, { agenteId: string; desde: Date; motivo: string }>();
  private ctrl = new Map<string, ConfigControle>();
  private cmds = new Map<string, RegistroComando>();

  async listar(empresaId: string) {
    return [...this.agentes.values()].filter((a) => a.empresaId === empresaId).sort((a, b) => +a.criadoEm - +b.criadoEm).map(clone);
  }
  async buscar(id: string) {
    const a = this.agentes.get(id);
    return a ? clone(a) : undefined;
  }
  async salvar(a: AgenteIa) {
    this.agentes.set(a.id, clone(a));
  }
  async apagar(id: string) {
    this.agentes.delete(id);
    for (const [k, v] of this.conh) if (v.agenteId === id) this.conh.delete(k);
    for (const [k, v] of this.apr) if (v.agenteId === id) this.apr.delete(k);
    for (const [k, v] of this.donos) if (v.agenteId === id) this.donos.delete(k);
  }
  async conhecimentos(agenteId: string) {
    return [...this.conh.values()].filter((k) => k.agenteId === agenteId).sort((a, b) => +a.criadoEm - +b.criadoEm).map(clone);
  }
  async adicionarConhecimento(k: Conhecimento) {
    this.conh.set(k.id, clone(k));
  }
  async apagarConhecimento(agenteId: string, id: string) {
    const k = this.conh.get(id);
    if (!k || k.agenteId !== agenteId) return false;
    return this.conh.delete(id);
  }
  async memoria(empresaId: string, telefone: string) {
    return [...this.mem.values()].filter((m) => m.empresaId === empresaId && m.telefone === telefone).map(({ empresaId: _e, ...m }) => clone(m));
  }
  async gravarMemoria(empresaId: string, m: MemoriaCliente) {
    this.mem.set(`${empresaId}|${m.telefone}|${m.chave}`, { ...clone(m), empresaId });
  }
  async apagarMemoria(empresaId: string, telefone: string, chave: string) {
    return this.mem.delete(`${empresaId}|${telefone}|${chave}`);
  }
  async memoriasRecentes(empresaId: string, limite: number) {
    return [...this.mem.values()]
      .filter((m) => m.empresaId === empresaId)
      .sort((a, b) => +b.atualizadoEm - +a.atualizadoEm)
      .slice(0, limite)
      .map(({ empresaId: _e, ...m }) => clone(m));
  }
  async aprendizados(agenteId: string, situacao?: Aprendizado['situacao']) {
    return [...this.apr.values()].filter((a) => a.agenteId === agenteId && (!situacao || a.situacao === situacao)).sort((a, b) => +b.criadoEm - +a.criadoEm).map(clone);
  }
  async aprendizadosDaEmpresa(empresaId: string, situacao?: Aprendizado['situacao']) {
    const meus = new Set([...this.agentes.values()].filter((a) => a.empresaId === empresaId).map((a) => a.id));
    return [...this.apr.values()].filter((a) => meus.has(a.agenteId) && (!situacao || a.situacao === situacao)).sort((a, b) => +b.criadoEm - +a.criadoEm).map(clone);
  }
  async adicionarAprendizado(a: Aprendizado) {
    this.apr.set(a.id, clone(a));
  }
  async decidirAprendizado(id: string, situacao: 'aprovado' | 'recusado', por: string, em: Date, texto?: string) {
    const a = this.apr.get(id);
    if (!a) return undefined;
    Object.assign(a, { situacao, decididoPor: por, decididoEm: em }, texto ? { texto } : {});
    return clone(a);
  }
  async agenteDaConversa(conversaId: string) {
    const d = this.donos.get(conversaId);
    return d ? clone(d) : undefined;
  }
  async definirAgenteDaConversa(conversaId: string, agenteId: string | null, motivo: string, em: Date) {
    if (!agenteId) this.donos.delete(conversaId);
    else this.donos.set(conversaId, { agenteId, desde: em, motivo });
  }
  async conversasComAgente() {
    return [...this.donos.entries()].map(([conversaId, d]) => ({ conversaId, ...clone(d) }));
  }
  async controle(empresaId: string) {
    return clone(this.ctrl.get(empresaId) ?? ConfigControle.parse({}));
  }
  async gravarControle(empresaId: string, c: ConfigControle) {
    this.ctrl.set(empresaId, clone(c));
  }
  async gravarComando(c: RegistroComando) {
    this.cmds.set(c.id, clone(c));
  }
  async comando(id: string) {
    const c = this.cmds.get(id);
    return c ? clone(c) : undefined;
  }
  async comandos(empresaId: string, limite: number) {
    return [...this.cmds.values()].filter((c) => c.empresaId === empresaId).sort((a, b) => +b.criadoEm - +a.criadoEm).slice(0, limite).map(clone);
  }
}

// ------------------------------------------------------------------ Postgres

interface LinhaAgente {
  id: string;
  empresa_id: string;
  nome: string;
  avatar: string;
  unidades: string[];
  provedor: string;
  modelo: string;
  chave_cifrada: string | null;
  criatividade: number;
  config: unknown;
  ativo: boolean;
  criado_em: Date;
  atualizado_em: Date;
  atualizado_por: string | null;
}
const paraAgente = (l: LinhaAgente): AgenteIa => {
  const cfg = ConfigAgente.safeParse(l.config ?? {});
  return {
    id: l.id,
    empresaId: l.empresa_id,
    nome: l.nome,
    avatar: l.avatar,
    unidades: l.unidades ?? [],
    provedor: l.provedor === 'openai' ? 'openai' : 'anthropic',
    modelo: l.modelo,
    chaveCifrada: l.chave_cifrada,
    criatividade: l.criatividade,
    config: cfg.success ? cfg.data : ConfigAgente.parse({}),
    ativo: l.ativo,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    atualizadoPor: l.atualizado_por,
  };
};
const COL_AGENTE = 'id::text, empresa_id, nome, avatar, unidades, provedor, modelo, chave_cifrada, criatividade, config, ativo, criado_em, atualizado_em, atualizado_por';

const paraConh = (l: Record<string, unknown>): Conhecimento => ({
  id: String(l.id),
  agenteId: String(l.agente_id),
  tipo: l.tipo as Conhecimento['tipo'],
  titulo: String(l.titulo),
  conteudo: String(l.conteudo ?? ''),
  origem: (l.origem as string | null) ?? null,
  criadoEm: l.criado_em as Date,
  criadoPor: (l.criado_por as string | null) ?? null,
});
const paraMem = (l: Record<string, unknown>): MemoriaCliente => ({
  telefone: String(l.telefone),
  chave: String(l.chave),
  valor: String(l.valor),
  agenteId: (l.agente_id as string | null) ?? null,
  conversaId: (l.conversa_id as string | null) ?? null,
  fonte: String(l.fonte),
  atualizadoEm: l.atualizado_em as Date,
});
const paraApr = (l: Record<string, unknown>): Aprendizado => ({
  id: String(l.id),
  agenteId: String(l.agente_id),
  texto: String(l.texto),
  origem: (l.origem as Record<string, unknown>) ?? {},
  situacao: l.situacao as Aprendizado['situacao'],
  criadoEm: l.criado_em as Date,
  decididoPor: (l.decidido_por as string | null) ?? null,
  decididoEm: (l.decidido_em as Date | null) ?? null,
});
const paraCmd = (l: Record<string, unknown>): RegistroComando => ({
  id: String(l.id),
  empresaId: String(l.empresa_id),
  texto: String(l.texto),
  plano: l.plano,
  situacao: l.situacao as RegistroComando['situacao'],
  por: String(l.por),
  porId: (l.por_id as string | null) ?? null,
  criadoEm: l.criado_em as Date,
  executadoEm: (l.executado_em as Date | null) ?? null,
  resultado: l.resultado ?? null,
});
const ehUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class ArmazemAgentesIaPostgres implements ArmazemAgentesIa {
  constructor(private readonly pool: pg.Pool) {}

  async listar(empresaId: string) {
    const { rows } = await this.pool.query<LinhaAgente>(`select ${COL_AGENTE} from sintonia.agentes_ia where empresa_id = $1 order by criado_em`, [empresaId]);
    return rows.map(paraAgente);
  }
  async buscar(id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query<LinhaAgente>(`select ${COL_AGENTE} from sintonia.agentes_ia where id = $1`, [id]);
    return rows[0] ? paraAgente(rows[0]) : undefined;
  }
  async salvar(a: AgenteIa) {
    await this.pool.query(
      `insert into sintonia.agentes_ia (id, empresa_id, nome, avatar, unidades, provedor, modelo, chave_cifrada, criatividade, config, ativo, criado_em, atualizado_em, atualizado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (id) do update set nome = excluded.nome, avatar = excluded.avatar, unidades = excluded.unidades, provedor = excluded.provedor,
         modelo = excluded.modelo, chave_cifrada = excluded.chave_cifrada, criatividade = excluded.criatividade, config = excluded.config,
         ativo = excluded.ativo, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
      [a.id, a.empresaId, a.nome, a.avatar, a.unidades, a.provedor, a.modelo, a.chaveCifrada, a.criatividade, JSON.stringify(a.config), a.ativo, a.criadoEm, a.atualizadoEm, a.atualizadoPor],
    );
  }
  async apagar(id: string) {
    if (!ehUuid(id)) return;
    await this.pool.query('delete from sintonia.agentes_ia where id = $1', [id]);
  }

  async conhecimentos(agenteId: string) {
    if (!ehUuid(agenteId)) return [];
    const { rows } = await this.pool.query('select * from sintonia.agentes_ia_conhecimento where agente_id = $1 order by criado_em', [agenteId]);
    return rows.map(paraConh);
  }
  async adicionarConhecimento(k: Conhecimento) {
    await this.pool.query(
      'insert into sintonia.agentes_ia_conhecimento (id, agente_id, tipo, titulo, conteudo, origem, criado_em, criado_por) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [k.id, k.agenteId, k.tipo, k.titulo, k.conteudo, k.origem, k.criadoEm, k.criadoPor],
    );
  }
  async apagarConhecimento(agenteId: string, id: string) {
    if (!ehUuid(id) || !ehUuid(agenteId)) return false;
    const r = await this.pool.query('delete from sintonia.agentes_ia_conhecimento where id = $1 and agente_id = $2', [id, agenteId]);
    return (r.rowCount ?? 0) > 0;
  }

  async memoria(empresaId: string, telefone: string) {
    const { rows } = await this.pool.query('select telefone, chave, valor, agente_id::text, conversa_id::text, fonte, atualizado_em from sintonia.memoria_cliente where empresa_id = $1 and telefone = $2 order by chave', [empresaId, telefone]);
    return rows.map(paraMem);
  }
  async gravarMemoria(empresaId: string, m: MemoriaCliente) {
    await this.pool.query(
      `insert into sintonia.memoria_cliente (empresa_id, telefone, chave, valor, agente_id, conversa_id, fonte, atualizado_em) values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (empresa_id, telefone, chave) do update set valor = excluded.valor, agente_id = excluded.agente_id, conversa_id = excluded.conversa_id, fonte = excluded.fonte, atualizado_em = excluded.atualizado_em`,
      [empresaId, m.telefone, m.chave, m.valor, m.agenteId && ehUuid(m.agenteId) ? m.agenteId : null, m.conversaId && ehUuid(m.conversaId) ? m.conversaId : null, m.fonte, m.atualizadoEm],
    );
  }
  async apagarMemoria(empresaId: string, telefone: string, chave: string) {
    const r = await this.pool.query('delete from sintonia.memoria_cliente where empresa_id = $1 and telefone = $2 and chave = $3', [empresaId, telefone, chave]);
    return (r.rowCount ?? 0) > 0;
  }
  async memoriasRecentes(empresaId: string, limite: number) {
    const { rows } = await this.pool.query('select telefone, chave, valor, agente_id::text, conversa_id::text, fonte, atualizado_em from sintonia.memoria_cliente where empresa_id = $1 order by atualizado_em desc limit $2', [empresaId, limite]);
    return rows.map(paraMem);
  }

  async aprendizados(agenteId: string, situacao?: Aprendizado['situacao']) {
    if (!ehUuid(agenteId)) return [];
    const { rows } = await this.pool.query(
      `select * from sintonia.agentes_ia_aprendizados where agente_id = $1 ${situacao ? 'and situacao = $2' : ''} order by criado_em desc limit 300`,
      situacao ? [agenteId, situacao] : [agenteId],
    );
    return rows.map(paraApr);
  }
  async aprendizadosDaEmpresa(empresaId: string, situacao?: Aprendizado['situacao']) {
    const { rows } = await this.pool.query(
      `select p.* from sintonia.agentes_ia_aprendizados p join sintonia.agentes_ia a on a.id = p.agente_id
       where a.empresa_id = $1 ${situacao ? 'and p.situacao = $2' : ''} order by p.criado_em desc limit 300`,
      situacao ? [empresaId, situacao] : [empresaId],
    );
    return rows.map(paraApr);
  }
  async adicionarAprendizado(a: Aprendizado) {
    await this.pool.query('insert into sintonia.agentes_ia_aprendizados (id, agente_id, texto, origem, situacao, criado_em) values ($1,$2,$3,$4,$5,$6)', [a.id, a.agenteId, a.texto, JSON.stringify(a.origem), a.situacao, a.criadoEm]);
  }
  async decidirAprendizado(id: string, situacao: 'aprovado' | 'recusado', por: string, em: Date, texto?: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query(
      'update sintonia.agentes_ia_aprendizados set situacao = $2, decidido_por = $3, decidido_em = $4, texto = coalesce($5, texto) where id = $1 returning *',
      [id, situacao, por, em, texto ?? null],
    );
    return rows[0] ? paraApr(rows[0]) : undefined;
  }

  async agenteDaConversa(conversaId: string) {
    if (!ehUuid(conversaId)) return undefined;
    const { rows } = await this.pool.query('select agente_id::text, desde, motivo from sintonia.conversa_agente_ia where conversa_id = $1', [conversaId]);
    return rows[0] ? { agenteId: rows[0].agente_id as string, desde: rows[0].desde as Date, motivo: rows[0].motivo as string } : undefined;
  }
  async definirAgenteDaConversa(conversaId: string, agenteId: string | null, motivo: string, em: Date) {
    if (!ehUuid(conversaId)) return;
    if (!agenteId) {
      await this.pool.query('delete from sintonia.conversa_agente_ia where conversa_id = $1', [conversaId]);
      return;
    }
    await this.pool.query(
      `insert into sintonia.conversa_agente_ia (conversa_id, agente_id, desde, motivo) values ($1,$2,$3,$4)
       on conflict (conversa_id) do update set agente_id = excluded.agente_id, desde = excluded.desde, motivo = excluded.motivo`,
      [conversaId, agenteId, em, motivo],
    );
  }
  async conversasComAgente() {
    const { rows } = await this.pool.query('select conversa_id::text, agente_id::text, desde, motivo from sintonia.conversa_agente_ia');
    return rows.map((r) => ({ conversaId: r.conversa_id as string, agenteId: r.agente_id as string, desde: r.desde as Date, motivo: r.motivo as string }));
  }

  async controle(empresaId: string) {
    const { rows } = await this.pool.query('select config from sintonia.ia_controle where empresa_id = $1', [empresaId]);
    const r = ConfigControle.safeParse(rows[0]?.config ?? {});
    return r.success ? r.data : ConfigControle.parse({});
  }
  async gravarControle(empresaId: string, c: ConfigControle, por: string, em: Date) {
    await this.pool.query(
      `insert into sintonia.ia_controle (empresa_id, config, atualizado_em, atualizado_por) values ($1,$2,$3,$4)
       on conflict (empresa_id) do update set config = excluded.config, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`,
      [empresaId, JSON.stringify(c), em, por],
    );
  }

  async gravarComando(c: RegistroComando) {
    await this.pool.query(
      `insert into sintonia.ia_comandos (id, empresa_id, texto, plano, situacao, por, por_id, criado_em, executado_em, resultado) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set situacao = excluded.situacao, executado_em = excluded.executado_em, resultado = excluded.resultado`,
      [c.id, c.empresaId, c.texto, JSON.stringify(c.plano), c.situacao, c.por, c.porId, c.criadoEm, c.executadoEm, c.resultado == null ? null : JSON.stringify(c.resultado)],
    );
  }
  async comando(id: string) {
    if (!ehUuid(id)) return undefined;
    const { rows } = await this.pool.query('select * from sintonia.ia_comandos where id = $1', [id]);
    return rows[0] ? paraCmd(rows[0]) : undefined;
  }
  async comandos(empresaId: string, limite: number) {
    const { rows } = await this.pool.query('select * from sintonia.ia_comandos where empresa_id = $1 order by criado_em desc limit $2', [empresaId, limite]);
    return rows.map(paraCmd);
  }
}
