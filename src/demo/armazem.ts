import type pg from 'pg';
import type { ContasMemoria } from '../auth/contas.js';
import { canalTesteDa } from '../channels/teste.js';
import type { ContatosMemoria } from '../contatos/contatos.js';
import type { ArmazemNotificacoesMemoria } from '../notificacoes/armazem.js';
import { RepositorioMemoria } from '../store/repositorio.js';
import type { ArmazemTagsMemoria } from '../tags/tags.js';
import { ehEmailDemo, ehTelefoneDemo, PREFIXO_TELEFONE_DEMO } from './dados.js';
import type { PlanoDemo } from './gerador.js';

/**
 * Onde a demonstração fica registrada e como ela é gravada/apagada.
 * Registro = (tipo, id) de tudo o que o gerador criou. Apagar mexe só no que está no registro E tem a marca da
 * demonstração (telefone 55719990…, canal de teste, e-mail nome.demo@exemplo.com): duas travas, nunca um dado real.
 */
export const TIPOS_REGISTRO = ['conversa', 'contato', 'usuario', 'tag', 'funil', 'campo', 'resposta', 'automacao', 'notificacao', 'meta'] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];
export type Registros = Record<TipoRegistro, string[]>;

export const registrosVazios = (): Registros => Object.fromEntries(TIPOS_REGISTRO.map((t) => [t, []])) as unknown as Registros;

export interface ApagadoConversas {
  conversas: number;
  mensagens: number;
  eventos: number;
  contatos: number;
}

export interface ArmazemDemo {
  registros(empresaId: string): Promise<Registros>;
  registrar(empresaId: string, tipo: TipoRegistro, chaves: string[]): Promise<void>;
  esquecer(empresaId: string, tipo: TipoRegistro, chaves?: string[]): Promise<void>;
  /** Grava conversas, mensagens, eventos, etapas/tags e fichas (no Postgres, numa transação só) e registra conversas e fichas. */
  gravar(empresaId: string, plano: PlanoDemo): Promise<void>;
  /** Apaga as conversas (com mensagens, eventos, tarefas, marcações, notificações...) e as fichas dos telefones. */
  apagarConversas(empresaId: string, ids: string[], telefones: string[]): Promise<ApagadoConversas>;
  /** Tira a dona (atendente de demonstração) das conversas que sobraram e apaga as contas (e as fotos delas). */
  apagarUsuarios(empresaId: string, ids: string[]): Promise<number>;
  apagarNotificacoes(ids: string[]): Promise<number>;
  /** Alguma ficha (que sobrou) tem valor neste campo? */
  campoEmUso(empresaId: string, campoId: string): Promise<boolean>;
  /** Conversas de demonstração (as automações de "conversa parada" e o relatório diário as ignoram). */
  conversasDemo(empresaId: string): Promise<Set<string>>;
}

// ---------------------------------------------------------------- memória

export interface LojasMemoria {
  repo: RepositorioMemoria;
  tags: ArmazemTagsMemoria;
  contatos: ContatosMemoria;
  contas: ContasMemoria;
  notificacoes?: ArmazemNotificacoesMemoria;
}

export class ArmazemDemoMemoria implements ArmazemDemo {
  private readonly reg = new Map<string, Registros>();
  constructor(private readonly m: LojasMemoria) {}

  private daEmpresa(empresaId: string): Registros {
    let r = this.reg.get(empresaId);
    if (!r) this.reg.set(empresaId, (r = registrosVazios()));
    return r;
  }
  /** Síncrono, para o armazém de automações da memória. */
  ehConversaDemo(id: string): boolean {
    for (const r of this.reg.values()) if (r.conversa.includes(id)) return true;
    return false;
  }
  async registros(empresaId: string) {
    const r = this.daEmpresa(empresaId);
    return Object.fromEntries(TIPOS_REGISTRO.map((t) => [t, [...r[t]]])) as unknown as Registros;
  }
  async registrar(empresaId: string, tipo: TipoRegistro, chaves: string[]) {
    const r = this.daEmpresa(empresaId);
    r[tipo] = [...new Set([...r[tipo], ...chaves])];
  }
  async esquecer(empresaId: string, tipo: TipoRegistro, chaves?: string[]) {
    const r = this.daEmpresa(empresaId);
    r[tipo] = chaves ? r[tipo].filter((x) => !chaves.includes(x)) : [];
  }
  async gravar(empresaId: string, p: PlanoDemo) {
    const { repo, tags, contatos } = this.m;
    for (const c of p.conversas) await repo.salvarConversa(c); // na memória, salvar também cria
    for (const msg of p.mensagens) await repo.adicionarMensagem(msg);
    // Direto no armazém, sem o observador de eventos (que viraria notificação e push).
    for (const e of p.eventos) await RepositorioMemoria.prototype.registrarEvento.call(repo, e);
    for (const mk of p.marcacoes) {
      if (mk.funilId) await tags.marcarEtapa(mk.conversaId, mk.tagId, mk.funilId, mk.por, mk.em);
      else await tags.marcar(mk.conversaId, mk.tagId, mk.por, mk.em);
    }
    for (const f of p.contatos) {
      const { criadoEm: _, ...ficha } = f;
      await contatos.salvar(empresaId, ficha, f.atualizadoPor ?? 'Demonstração');
    }
    await this.registrar(empresaId, 'conversa', p.conversas.map((c) => c.id));
    await this.registrar(empresaId, 'contato', p.contatos.map((c) => c.telefone));
  }
  async apagarConversas(empresaId: string, ids: string[], telefones: string[]) {
    const { repo, tags, contatos } = this.m;
    const todas = await repo.listarConversas();
    const alvo = todas.filter((c) => ids.includes(c.id) && c.empresaId === empresaId && ehTelefoneDemo(c.telefone) && c.canalId === canalTesteDa(c.unidade)).map((c) => c.id);
    const r = await repo.apagarConversas(alvo);
    tags.esquecerConversas(alvo);
    if (this.m.notificacoes) this.m.notificacoes.itens = this.m.notificacoes.itens.filter((n) => !n.conversaId || !alvo.includes(n.conversaId));
    let fichas = 0;
    for (const t of telefones.filter(ehTelefoneDemo)) {
      if (await contatos.obter(empresaId, t)) fichas++;
      await contatos.apagar(empresaId, t);
    }
    return { conversas: alvo.length, ...r, contatos: fichas };
  }
  async apagarUsuarios(empresaId: string, ids: string[]) {
    const { contas, repo } = this.m;
    const alvo = contas.usuarios.filter((u) => ids.includes(u.id) && u.empresaId === empresaId && ehEmailDemo(u.email)).map((u) => u.id);
    for (const c of await repo.listarConversas()) {
      if (c.responsavelId && alvo.includes(c.responsavelId)) await repo.salvarConversa({ ...c, responsavelId: undefined, responsavelNome: undefined });
    }
    contas.usuarios = contas.usuarios.filter((u) => !alvo.includes(u.id));
    for (const id of alvo) contas.fotos.delete(id);
    for (const [k, s] of contas.sessoes) if (alvo.includes(s.usuarioId)) contas.sessoes.delete(k);
    if (this.m.notificacoes) this.m.notificacoes.itens = this.m.notificacoes.itens.filter((n) => !alvo.includes(n.usuarioId));
    return alvo.length;
  }
  async apagarNotificacoes(ids: string[]) {
    const n = this.m.notificacoes;
    if (!n) return 0;
    const antes = n.itens.length;
    n.itens = n.itens.filter((x) => !ids.includes(x.id));
    return antes - n.itens.length;
  }
  async campoEmUso(empresaId: string, campoId: string) {
    return (await this.m.contatos.listar(empresaId)).some((c) => c.campos[campoId] !== undefined && c.campos[campoId] !== null && c.campos[campoId] !== '');
  }
  async conversasDemo(empresaId: string) {
    return new Set(this.daEmpresa(empresaId).conversa);
  }
}

// ---------------------------------------------------------------- Postgres

export class ArmazemDemoPostgres implements ArmazemDemo {
  constructor(private readonly pool: pg.Pool) {}

  async registros(empresaId: string) {
    const { rows } = await this.pool.query<{ tipo: TipoRegistro; chave: string }>('select tipo, chave from sintonia.demo_registros where empresa_id = $1', [empresaId]);
    const r = registrosVazios();
    for (const x of rows) if (r[x.tipo]) r[x.tipo].push(x.chave);
    return r;
  }
  async registrar(empresaId: string, tipo: TipoRegistro, chaves: string[], cliente: pg.Pool | pg.PoolClient = this.pool) {
    if (!chaves.length) return;
    await cliente.query(
      `insert into sintonia.demo_registros (empresa_id, tipo, chave) select $1, $2, unnest($3::text[]) on conflict do nothing`,
      [empresaId, tipo, chaves],
    );
  }
  async esquecer(empresaId: string, tipo: TipoRegistro, chaves?: string[]) {
    if (chaves) await this.pool.query('delete from sintonia.demo_registros where empresa_id = $1 and tipo = $2 and chave = any($3::text[])', [empresaId, tipo, chaves]);
    else await this.pool.query('delete from sintonia.demo_registros where empresa_id = $1 and tipo = $2', [empresaId, tipo]);
  }

  async gravar(empresaId: string, p: PlanoDemo) {
    const c = await this.pool.connect();
    const j = (x: unknown) => JSON.stringify(x);
    try {
      await c.query('begin');
      await c.query('select pg_advisory_xact_lock(727090)');
      await c.query(
        `insert into sintonia.conversas (id, empresa_id, unidade, canal_id, telefone, nome, modo, etapa, ultima_mensagem_cliente, ultima_mensagem_equipe,
           ultima_mensagem_ia, etiquetas, responsavel_id, responsavel_nome, criada_em, atualizada_em)
         select x.id, x.empresa_id, x.unidade, x.canal_id, x.telefone, x.nome, x.modo, x.etapa, x.ultima_mensagem_cliente, x.ultima_mensagem_equipe,
                x.ultima_mensagem_ia, coalesce(x.etiquetas, '{}'), x.responsavel_id, x.responsavel_nome, x.criada_em, x.atualizada_em
           from jsonb_to_recordset($1::jsonb) as x(id uuid, empresa_id text, unidade text, canal_id text, telefone text, nome text, modo text, etapa text,
                ultima_mensagem_cliente timestamptz, ultima_mensagem_equipe timestamptz, ultima_mensagem_ia timestamptz, etiquetas text[],
                responsavel_id uuid, responsavel_nome text, criada_em timestamptz, atualizada_em timestamptz)`,
        [
          j(
            p.conversas.map((x) => ({
              id: x.id,
              empresa_id: x.empresaId,
              unidade: x.unidade,
              canal_id: x.canalId,
              telefone: x.telefone,
              nome: x.nome ?? null,
              modo: x.modo,
              etapa: x.etapa,
              ultima_mensagem_cliente: x.ultimaMensagemCliente ?? null,
              ultima_mensagem_equipe: x.ultimaMensagemEquipe ?? null,
              ultima_mensagem_ia: x.ultimaMensagemIa ?? null,
              etiquetas: x.etiquetas,
              responsavel_id: x.responsavelId ?? null,
              responsavel_nome: x.responsavelNome ?? null,
              criada_em: x.criadaEm,
              atualizada_em: x.atualizadaEm,
            })),
          ),
        ],
      );
      await c.query(
        `insert into sintonia.mensagens (id, conversa_id, autor, autor_nome, texto, id_externo, em)
         select x.id, x.conversa_id, x.autor, x.autor_nome, x.texto, x.id_externo, x.em
           from jsonb_to_recordset($1::jsonb) as x(id uuid, conversa_id uuid, autor text, autor_nome text, texto text, id_externo text, em timestamptz)`,
        [j(p.mensagens.map((m) => ({ id: m.id, conversa_id: m.conversaId, autor: m.autor, autor_nome: m.autorNome ?? null, texto: m.texto, id_externo: m.idExterno, em: m.em })))],
      );
      await c.query(
        `insert into sintonia.eventos (conversa_id, unidade, tipo, dados, em)
         select x.conversa_id, x.unidade, x.tipo, x.dados, x.em
           from jsonb_to_recordset($1::jsonb) as x(conversa_id uuid, unidade text, tipo text, dados jsonb, em timestamptz)
          order by x.em`,
        [j(p.eventos.map((e) => ({ conversa_id: e.conversaId ?? null, unidade: e.unidade ?? null, tipo: e.tipo, dados: e.dados ?? null, em: e.em })))],
      );
      await c.query(
        `insert into sintonia.conversa_tags (conversa_id, tag_id, funil_id, marcada_por, marcada_em)
         select x.conversa_id, x.tag_id, x.funil_id, x.por, x.em
           from jsonb_to_recordset($1::jsonb) as x(conversa_id uuid, tag_id uuid, funil_id uuid, por text, em timestamptz)
         on conflict do nothing`,
        [j(p.marcacoes.map((m) => ({ conversa_id: m.conversaId, tag_id: m.tagId, funil_id: m.funilId, por: m.por, em: m.em })))],
      );
      await c.query(
        `insert into sintonia.contatos (empresa_id, telefone, nome, email, nascimento, observacoes, pessoa, empresa, campos, atualizado_em, atualizado_por, criado_em)
         select $1, x.telefone, x.nome, x.email, x.nascimento, x.observacoes, 'fisica', '{}'::jsonb, coalesce(x.campos, '{}'::jsonb), x.atualizado_em, x.atualizado_por, x.criado_em
           from jsonb_to_recordset($2::jsonb) as x(telefone text, nome text, email text, nascimento date, observacoes text, campos jsonb,
                atualizado_em timestamptz, atualizado_por text, criado_em timestamptz)
          where x.telefone like '${PREFIXO_TELEFONE_DEMO}%'
         on conflict (empresa_id, telefone) do update set nome = excluded.nome, email = excluded.email, nascimento = excluded.nascimento,
           observacoes = excluded.observacoes, campos = excluded.campos, atualizado_em = excluded.atualizado_em,
           atualizado_por = excluded.atualizado_por, criado_em = excluded.criado_em`,
        [
          empresaId,
          j(
            p.contatos.map((f) => ({
              telefone: f.telefone,
              nome: f.nome,
              email: f.email,
              nascimento: f.nascimento,
              observacoes: f.observacoes,
              campos: f.campos,
              atualizado_em: f.atualizadoEm,
              atualizado_por: f.atualizadoPor,
              criado_em: f.criadoEm,
            })),
          ),
        ],
      );
      await this.registrar(empresaId, 'conversa', p.conversas.map((x) => x.id), c);
      await this.registrar(empresaId, 'contato', p.contatos.map((x) => x.telefone), c);
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async apagarConversas(empresaId: string, ids: string[], telefones: string[]) {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      // Só as registradas E com a marca da demonstração (telefone 55719990…, canal de teste).
      const { rows } = await c.query<{ id: string; telefone: string }>(
        `select id::text, telefone from sintonia.conversas
          where empresa_id = $1 and id::text = any($2::text[]) and telefone like '${PREFIXO_TELEFONE_DEMO}%' and canal_id like 'teste-%'`,
        [empresaId, ids],
      );
      const alvo = rows.map((r) => r.id);
      const tels = [...new Set([...telefones, ...rows.map((r) => r.telefone)])].filter(ehTelefoneDemo);
      const mensagens = (await c.query('select 1 from sintonia.mensagens where conversa_id::text = any($1::text[])', [alvo])).rowCount ?? 0;
      const eventos = (await c.query('delete from sintonia.eventos where conversa_id::text = any($1::text[])', [alvo])).rowCount ?? 0;
      // Mensagens, mídias, tarefas, marcações, execuções de automação, notificações... vão junto (on delete cascade).
      const conversas = (await c.query('delete from sintonia.conversas where id::text = any($1::text[])', [alvo])).rowCount ?? 0;
      const contatos = (await c.query('delete from sintonia.contatos where empresa_id = $1 and telefone = any($2::text[])', [empresaId, tels])).rowCount ?? 0;
      await c.query('delete from sintonia.fotos where telefone = any($1::text[])', [tels]);
      await c.query('delete from sintonia.nao_duplicatas where empresa_id = $1 and (telefone_a = any($2::text[]) or telefone_b = any($2::text[]))', [empresaId, tels]);
      await c.query(`delete from sintonia.demo_registros where empresa_id = $1 and tipo in ('conversa', 'contato')`, [empresaId]);
      await c.query('commit');
      return { conversas, mensagens, eventos, contatos };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async apagarUsuarios(empresaId: string, ids: string[]) {
    if (!ids.length) return 0;
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const { rows } = await c.query<{ id: string; email: string }>(
        'select id::text, email from sintonia.usuarios where empresa_id = $1 and id::text = any($2::text[])',
        [empresaId, ids],
      );
      const alvo = rows.filter((r) => ehEmailDemo(r.email)).map((r) => r.id);
      await c.query('update sintonia.conversas set responsavel_id = null, responsavel_nome = null where responsavel_id::text = any($1::text[])', [alvo]);
      await c.query('delete from sintonia.digitando where usuario_id::text = any($1::text[])', [alvo]);
      // Sessões, foto, notificações, respostas pessoais e push vão junto (on delete cascade).
      const n = (await c.query('delete from sintonia.usuarios where id::text = any($1::text[])', [alvo])).rowCount ?? 0;
      await c.query('commit');
      return n;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async apagarNotificacoes(ids: string[]) {
    if (!ids.length) return 0;
    return (await this.pool.query('delete from sintonia.notificacoes where id::text = any($1::text[])', [ids])).rowCount ?? 0;
  }

  async campoEmUso(empresaId: string, campoId: string) {
    const { rowCount } = await this.pool.query(
      `select 1 from sintonia.contatos where empresa_id = $1 and campos ? $2 and campos->>$2 is not null and campos->>$2 <> '' limit 1`,
      [empresaId, campoId],
    );
    return (rowCount ?? 0) > 0;
  }

  async conversasDemo(empresaId: string) {
    const { rows } = await this.pool.query<{ chave: string }>(`select chave from sintonia.demo_registros where empresa_id = $1 and tipo = 'conversa'`, [empresaId]);
    return new Set(rows.map((r) => r.chave));
  }
}
