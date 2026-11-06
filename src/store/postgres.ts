import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Conversa, Etapa, Mensagem, ModoAtendimento, UnidadeId } from '../domain.js';
import type { Evento, Repositorio, Tarefa, TipoEvento } from './repositorio.js';

/** Repositório de produção: tudo no Postgres, esquema "sintonia". Mesmo contrato do RepositorioMemoria. */

interface LinhaConversa {
  id: string;
  empresa_id: string;
  unidade: string;
  canal_id: string;
  telefone: string;
  nome: string | null;
  modo: string;
  etapa: string;
  trinks_cliente_id: number | null;
  pausa_ia_ate: Date | null;
  ultima_mensagem_cliente: Date | null;
  ultima_mensagem_equipe: Date | null;
  ultima_mensagem_ia: Date | null;
  etiquetas: string[];
  resumo: string | null;
  criada_em: Date;
  atualizada_em: Date;
}

const ou = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

function paraConversa(l: LinhaConversa): Conversa {
  return {
    id: l.id,
    empresaId: l.empresa_id,
    unidade: l.unidade as UnidadeId,
    canalId: l.canal_id,
    telefone: l.telefone,
    nome: ou(l.nome),
    modo: l.modo as ModoAtendimento,
    etapa: l.etapa as Etapa,
    trinksClienteId: ou(l.trinks_cliente_id),
    pausaIaAte: ou(l.pausa_ia_ate),
    ultimaMensagemCliente: ou(l.ultima_mensagem_cliente),
    ultimaMensagemEquipe: ou(l.ultima_mensagem_equipe),
    ultimaMensagemIa: ou(l.ultima_mensagem_ia),
    etiquetas: l.etiquetas ?? [],
    resumo: ou(l.resumo),
    criadaEm: l.criada_em,
    atualizadaEm: l.atualizada_em,
  };
}

const COLUNAS_CONVERSA = `id, empresa_id, unidade, canal_id, telefone, nome, modo, etapa, trinks_cliente_id, pausa_ia_ate,
  ultima_mensagem_cliente, ultima_mensagem_equipe, ultima_mensagem_ia, etiquetas, resumo, criada_em, atualizada_em`;

export class RepositorioPostgres implements Repositorio {
  constructor(private readonly pool: pg.Pool) {}

  async buscarConversa(id: string) {
    const { rows } = await this.pool.query<LinhaConversa>(
      `select ${COLUNAS_CONVERSA} from sintonia.conversas where id = $1`,
      [id],
    );
    return rows[0] ? paraConversa(rows[0]) : undefined;
  }

  async buscarOuCriarConversa(d: {
    empresaId: string;
    unidade: UnidadeId;
    canalId: string;
    telefone: string;
    nome?: string;
    agora: Date;
  }) {
    // Insere se não existe; se existe, só completa o nome que faltava. Seguro com dois processos ao mesmo tempo.
    const { rows } = await this.pool.query<LinhaConversa & { nova: boolean }>(
      `insert into sintonia.conversas (id, empresa_id, unidade, canal_id, telefone, nome, criada_em, atualizada_em)
       values ($1, $2, $3, $4, $5, $6, $7, $7)
       on conflict (empresa_id, unidade, telefone)
         do update set nome = coalesce(sintonia.conversas.nome, excluded.nome)
       returning ${COLUNAS_CONVERSA}, (xmax = 0) as nova`,
      [randomUUID(), d.empresaId, d.unidade, d.canalId, d.telefone, d.nome ?? null, d.agora],
    );
    const l = rows[0]!;
    return { conversa: paraConversa(l), nova: l.nova };
  }

  async salvarConversa(c: Conversa) {
    await this.pool.query(
      `update sintonia.conversas set
         nome = $2, modo = $3, etapa = $4, trinks_cliente_id = $5, pausa_ia_ate = $6,
         ultima_mensagem_cliente = $7, ultima_mensagem_equipe = $8, ultima_mensagem_ia = $9,
         etiquetas = $10, resumo = $11, atualizada_em = $12, canal_id = $13
       where id = $1`,
      [
        c.id,
        c.nome ?? null,
        c.modo,
        c.etapa,
        c.trinksClienteId ?? null,
        c.pausaIaAte ?? null,
        c.ultimaMensagemCliente ?? null,
        c.ultimaMensagemEquipe ?? null,
        c.ultimaMensagemIa ?? null,
        c.etiquetas,
        c.resumo ?? null,
        c.atualizadaEm,
        c.canalId,
      ],
    );
  }

  async listarConversas() {
    const { rows } = await this.pool.query<LinhaConversa>(
      `select ${COLUNAS_CONVERSA} from sintonia.conversas order by atualizada_em desc limit 500`,
    );
    return rows.map(paraConversa);
  }

  async adicionarMensagem(m: Omit<Mensagem, 'id'>) {
    const r = await this.pool.query(
      `insert into sintonia.mensagens (id, conversa_id, autor, autor_nome, texto, id_externo, em)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id_externo) do nothing`,
      [randomUUID(), m.conversaId, m.autor, m.autorNome ?? null, m.texto, m.idExterno || null, m.em],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async mensagens(conversaId: string, limite = 40) {
    const { rows } = await this.pool.query<{
      id: string;
      conversa_id: string;
      autor: Mensagem['autor'];
      autor_nome: string | null;
      texto: string;
      id_externo: string | null;
      em: Date;
    }>(
      `select * from (
         select id, conversa_id, autor, autor_nome, texto, id_externo, em
           from sintonia.mensagens where conversa_id = $1
          order by em desc, id desc limit $2
       ) ultimas order by em asc`,
      [conversaId, limite],
    );
    return rows.map((r) => ({
      id: r.id,
      conversaId: r.conversa_id,
      autor: r.autor,
      autorNome: ou(r.autor_nome),
      texto: r.texto,
      idExterno: ou(r.id_externo),
      em: r.em,
    }));
  }

  async registrarEnviadoPorNos(idExterno: string) {
    if (!idExterno) return;
    await this.pool.query('insert into sintonia.enviados (id_externo) values ($1) on conflict do nothing', [idExterno]);
  }

  async foiEnviadoPorNos(idExterno: string) {
    if (!idExterno) return false;
    const { rowCount } = await this.pool.query('select 1 from sintonia.enviados where id_externo = $1', [idExterno]);
    return (rowCount ?? 0) > 0;
  }

  async programar(t: Omit<Tarefa, 'id' | 'feita'>) {
    await this.pool.query('insert into sintonia.tarefas (id, conversa_id, tipo, quando) values ($1, $2, $3, $4)', [
      randomUUID(),
      t.conversaId,
      t.tipo,
      t.quando,
    ]);
  }

  async cancelarTarefas(conversaId: string, tipos?: Tarefa['tipo'][]) {
    if (tipos) {
      await this.pool.query(
        'update sintonia.tarefas set feita = true where conversa_id = $1 and not feita and tipo = any($2)',
        [conversaId, tipos],
      );
    } else {
      await this.pool.query('update sintonia.tarefas set feita = true where conversa_id = $1 and not feita', [conversaId]);
    }
  }

  async reivindicarTarefas(agora: Date, limite = 100) {
    // "skip locked": dois trabalhadores nunca pegam a mesma tarefa.
    const { rows } = await this.pool.query<{ id: string; conversa_id: string; tipo: Tarefa['tipo']; quando: Date }>(
      `update sintonia.tarefas set feita = true
        where id in (
          select id from sintonia.tarefas
           where not feita and quando <= $1
           order by quando
           limit $2
           for update skip locked)
       returning id, conversa_id, tipo, quando`,
      [agora, limite],
    );
    return rows
      .map((r) => ({ id: r.id, conversaId: r.conversa_id, tipo: r.tipo, quando: r.quando, feita: true }))
      .sort((a, b) => a.quando.getTime() - b.quando.getTime());
  }

  async registrarEvento(e: Evento) {
    await this.pool.query(
      'insert into sintonia.eventos (conversa_id, unidade, tipo, dados, em) values ($1, $2, $3, $4, $5)',
      [e.conversaId ?? null, e.unidade ?? null, e.tipo, e.dados ? JSON.stringify(e.dados) : null, e.em],
    );
  }

  async eventosEntre(inicio: Date, fim: Date) {
    const { rows } = await this.pool.query<{
      tipo: TipoEvento;
      conversa_id: string | null;
      unidade: UnidadeId | null;
      em: Date;
      dados: Record<string, unknown> | null;
    }>(
      'select tipo, conversa_id, unidade, em, dados from sintonia.eventos where em >= $1 and em < $2 order by em, id',
      [inicio, fim],
    );
    return rows.map((r) => ({
      tipo: r.tipo,
      conversaId: ou(r.conversa_id),
      unidade: ou(r.unidade),
      em: r.em,
      dados: ou(r.dados),
    }));
  }

  async guardarSugestao(conversaId: string, texto: string) {
    await this.pool.query('update sintonia.conversas set sugestao = $2 where id = $1', [conversaId, texto]);
  }

  async sugestao(conversaId: string) {
    const { rows } = await this.pool.query<{ sugestao: string | null }>(
      'select sugestao from sintonia.conversas where id = $1',
      [conversaId],
    );
    return ou(rows[0]?.sugestao ?? null);
  }

  /** Tarefas ainda por fazer de uma conversa (painel e testes). */
  async tarefasPendentes(conversaId: string) {
    const { rows } = await this.pool.query<{ id: string; conversa_id: string; tipo: Tarefa['tipo']; quando: Date }>(
      'select id, conversa_id, tipo, quando from sintonia.tarefas where conversa_id = $1 and not feita order by quando',
      [conversaId],
    );
    return rows.map((r) => ({ id: r.id, conversaId: r.conversa_id, tipo: r.tipo, quando: r.quando, feita: false }));
  }
}
