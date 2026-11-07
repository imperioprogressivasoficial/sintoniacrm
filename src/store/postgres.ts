import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Anexo, Conversa, Etapa, Mensagem, ModoAtendimento, SituacaoAnexo, TipoAnexo, UnidadeId } from '../domain.js';
import { VALIDADE_DIGITANDO_MS, type Evento, type MidiaPendente, type Repositorio, type Tarefa, type TipoEvento } from './repositorio.js';

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
  responsavel_id: string | null;
  responsavel_nome: string | null;
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
    responsavelId: ou(l.responsavel_id),
    responsavelNome: ou(l.responsavel_nome),
    criadaEm: l.criada_em,
    atualizadaEm: l.atualizada_em,
  };
}

const COLUNAS_CONVERSA = `id, empresa_id, unidade, canal_id, telefone, nome, modo, etapa, trinks_cliente_id, pausa_ia_ate,
  ultima_mensagem_cliente, ultima_mensagem_equipe, ultima_mensagem_ia, etiquetas, resumo, responsavel_id, responsavel_nome, criada_em, atualizada_em`;

/** Mensagem com os dados da mídia (sem o arquivo). */
interface LinhaMensagem {
  id: string;
  conversa_id: string;
  autor: Mensagem['autor'];
  autor_nome: string | null;
  texto: string;
  id_externo: string | null;
  em: Date;
  md_tipo: TipoAnexo | null;
  md_mimetype: string | null;
  md_nome_arquivo: string | null;
  md_duracao_seg: number | null;
  md_legenda: string | null;
  md_tamanho: string | null;
  md_voz: boolean | null;
  md_situacao: SituacaoAnexo | null;
}

const COLUNAS_MENSAGEM = `m.id, m.conversa_id, m.autor, m.autor_nome, m.texto, m.id_externo, m.em,
  md.tipo as md_tipo, md.mimetype as md_mimetype, md.nome_arquivo as md_nome_arquivo, md.duracao_seg as md_duracao_seg,
  md.legenda as md_legenda, md.tamanho as md_tamanho, md.voz as md_voz, md.situacao as md_situacao`;

function anexoDa(l: Omit<LinhaMensagem, 'id' | 'conversa_id' | 'autor' | 'autor_nome' | 'texto' | 'id_externo' | 'em'>): Anexo | undefined {
  if (!l.md_tipo || !l.md_situacao) return undefined;
  const a: Anexo = { tipo: l.md_tipo, situacao: l.md_situacao };
  if (l.md_mimetype) a.mimetype = l.md_mimetype;
  if (l.md_nome_arquivo) a.nomeArquivo = l.md_nome_arquivo;
  if (l.md_duracao_seg !== null) a.duracaoSeg = l.md_duracao_seg;
  if (l.md_legenda) a.legenda = l.md_legenda;
  if (l.md_tamanho !== null) a.tamanho = Number(l.md_tamanho);
  if (l.md_voz) a.voz = true;
  return a;
}

function paraMensagem(r: LinhaMensagem): Mensagem {
  const m: Mensagem = {
    id: r.id,
    conversaId: r.conversa_id,
    autor: r.autor,
    autorNome: ou(r.autor_nome),
    texto: r.texto,
    idExterno: ou(r.id_externo),
    em: r.em,
  };
  const anexo = anexoDa(r);
  if (anexo) m.anexo = anexo;
  return m;
}

export class RepositorioPostgres implements Repositorio {
  constructor(readonly pool: pg.Pool) {}

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
         etiquetas = $10, resumo = $11, atualizada_em = $12, canal_id = $13,
         responsavel_id = $14, responsavel_nome = $15
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
        c.responsavelId ?? null,
        c.responsavelNome ?? null,
      ],
    );
  }

  async listarConversas() {
    const { rows } = await this.pool.query<LinhaConversa>(
      `select ${COLUNAS_CONVERSA} from sintonia.conversas order by atualizada_em desc limit 500`,
    );
    return rows.map(paraConversa);
  }

  async adicionarMensagem(m: Omit<Mensagem, 'id'> & { id?: string }) {
    const valores = [m.id ?? randomUUID(), m.conversaId, m.autor, m.autorNome ?? null, m.texto, m.idExterno || null, m.em];
    const inserir = `insert into sintonia.mensagens (id, conversa_id, autor, autor_nome, texto, id_externo, em)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id_externo) do nothing`;
    if (!m.anexo) {
      const r = await this.pool.query(inserir, valores);
      return (r.rowCount ?? 0) > 0;
    }
    // Mensagem e dados da mídia num comando só: ou entram os dois, ou nenhum (mensagem repetida).
    const a = m.anexo;
    const r = await this.pool.query(
      `with nova as (${inserir} returning id)
       insert into sintonia.midias (mensagem_id, tipo, mimetype, nome_arquivo, duracao_seg, legenda, tamanho, voz, situacao)
       select id, $8, $9, $10, $11, $12, $13, $14, $15 from nova`,
      [...valores, a.tipo, a.mimetype ?? null, a.nomeArquivo ?? null, a.duracaoSeg ?? null, a.legenda ?? null, a.tamanho ?? null, a.voz ?? false, a.situacao],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async midia(mensagemId: string) {
    const { rows } = await this.pool.query<LinhaMensagem & { conteudo: Buffer | null }>(
      `select ${COLUNAS_MENSAGEM}, md.conteudo
         from sintonia.midias md join sintonia.mensagens m on m.id = md.mensagem_id
        where md.mensagem_id = $1`,
      [mensagemId],
    );
    const r = rows[0];
    if (!r) return undefined;
    return { conversaId: r.conversa_id, anexo: anexoDa(r)!, conteudo: r.conteudo };
  }

  async guardarMidia(mensagemId: string, r: { conteudo: Buffer; mimetype?: string; nomeArquivo?: string }) {
    await this.pool.query(
      `update sintonia.midias set conteudo = $2, tamanho = $3, situacao = 'pronta', erro = null,
         mimetype = coalesce(mimetype, $4), nome_arquivo = coalesce(nome_arquivo, $5)
       where mensagem_id = $1`,
      [mensagemId, r.conteudo, r.conteudo.length, r.mimetype ?? null, r.nomeArquivo ?? null],
    );
  }

  async midiaGrande(mensagemId: string, tamanho?: number) {
    await this.pool.query(
      `update sintonia.midias set situacao = 'grande', conteudo = null, tamanho = coalesce($2, tamanho) where mensagem_id = $1`,
      [mensagemId, tamanho ?? null],
    );
  }

  async falhaMidia(mensagemId: string, erro: string, proxima?: Date) {
    await this.pool.query(
      `update sintonia.midias set erro = $2,
         proxima_tentativa = coalesce($3, proxima_tentativa),
         situacao = case when $3::timestamptz is null then 'falhou' else situacao end
       where mensagem_id = $1 and situacao = 'pendente'`,
      [mensagemId, erro.slice(0, 1000), proxima ?? null],
    );
  }

  async reivindicarMidias(agora: Date, limite = 10, reservaMs = 5 * 60_000) {
    // "skip locked": dois processos nunca baixam a mesma mídia; a reserva vence se o processo cair.
    const { rows } = await this.pool.query<{ mensagem_id: string; conversa_id: string; canal_id: string; id_externo: string; tentativas: number }>(
      `with prontas as (
         select md.mensagem_id from sintonia.midias md
          where md.situacao = 'pendente' and md.proxima_tentativa <= $1
          order by md.proxima_tentativa
          limit $2
          for update skip locked
       )
       update sintonia.midias md
          set tentativas = md.tentativas + 1,
              proxima_tentativa = $1::timestamptz + make_interval(secs => $3::double precision / 1000)
         from prontas, sintonia.mensagens m, sintonia.conversas c
        where md.mensagem_id = prontas.mensagem_id and m.id = md.mensagem_id and c.id = m.conversa_id
          and m.id_externo is not null
       returning md.mensagem_id, m.conversa_id, c.canal_id, m.id_externo, md.tentativas`,
      [agora, limite, reservaMs],
    );
    return rows.map(
      (r): MidiaPendente => ({ mensagemId: r.mensagem_id, conversaId: r.conversa_id, canalId: r.canal_id, idExterno: r.id_externo, tentativas: r.tentativas }),
    );
  }

  async rebaixarMidia(mensagemId: string, agora: Date) {
    const r = await this.pool.query(
      `update sintonia.midias set situacao = 'pendente', tentativas = 0, proxima_tentativa = $2, erro = null
        where mensagem_id = $1 and situacao = 'falhou'`,
      [mensagemId, agora],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async foto(telefone: string) {
    const { rows } = await this.pool.query<{ conteudo: Buffer | null; tipo: string | null; atualizada_em: Date }>(
      'select conteudo, tipo, atualizada_em from sintonia.fotos where telefone = $1',
      [telefone],
    );
    const r = rows[0];
    return r ? { conteudo: r.conteudo, tipo: r.tipo, atualizadaEm: r.atualizada_em } : undefined;
  }

  async salvarFoto(telefone: string, foto: { conteudo: Buffer; tipo: string } | null, em: Date) {
    await this.pool.query(
      `insert into sintonia.fotos (telefone, conteudo, tipo, atualizada_em) values ($1, $2, $3, $4)
       on conflict (telefone) do update set conteudo = excluded.conteudo, tipo = excluded.tipo, atualizada_em = excluded.atualizada_em`,
      [telefone, foto?.conteudo ?? null, foto?.tipo ?? null, em],
    );
  }

  async ultimasMensagens() {
    const { rows } = await this.pool.query<LinhaMensagem>(
      `select distinct on (m.conversa_id) ${COLUNAS_MENSAGEM}
         from sintonia.mensagens m left join sintonia.midias md on md.mensagem_id = m.id
        order by m.conversa_id, m.em desc, m.id desc`,
    );
    return new Map(rows.map((r) => [r.conversa_id, paraMensagem(r)]));
  }

  async mensagens(conversaId: string, limite = 40) {
    const { rows } = await this.pool.query<LinhaMensagem>(
      `select * from (
         select ${COLUNAS_MENSAGEM}
           from sintonia.mensagens m left join sintonia.midias md on md.mensagem_id = m.id
          where m.conversa_id = $1
          order by m.em desc, m.id desc limit $2
       ) ultimas order by em asc`,
      [conversaId, limite],
    );
    return rows.map(paraMensagem);
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

  async registrarDigitando(conversaId: string, quem: { usuarioId: string; nome: string }, em: Date) {
    // A sequência continua se o último sinal foi há pouco; senão recomeça agora.
    await this.pool.query(
      `insert into sintonia.digitando (conversa_id, usuario_id, nome, desde, em) values ($1, $2, $3, $4, $4)
       on conflict (conversa_id, usuario_id) do update set
         nome = excluded.nome,
         desde = case when sintonia.digitando.em >= excluded.em - make_interval(secs => $5) then sintonia.digitando.desde else excluded.em end,
         em = excluded.em`,
      [conversaId, quem.usuarioId, quem.nome, em, VALIDADE_DIGITANDO_MS / 1000],
    );
  }

  async digitando(conversaId: string, desde: Date) {
    const { rows } = await this.pool.query<{ usuario_id: string; nome: string; desde: Date; em: Date }>(
      'select usuario_id, nome, desde, em from sintonia.digitando where conversa_id = $1 and em >= $2 order by desde, usuario_id',
      [conversaId, desde],
    );
    return rows.map((r) => ({ usuarioId: r.usuario_id, nome: r.nome, desde: r.desde, em: r.em }));
  }

  async pararDigitando(conversaId: string, usuarioId: string) {
    await this.pool.query('delete from sintonia.digitando where conversa_id = $1 and usuario_id = $2', [conversaId, usuarioId]);
  }
}
