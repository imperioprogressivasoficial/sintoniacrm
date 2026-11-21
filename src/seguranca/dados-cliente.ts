import type pg from 'pg';

/**
 * banco-seguranca: LGPD — o cliente pede "quero ver tudo o que vocês têm sobre mim" ou "apaguem meus dados".
 *
 * Quem é o cliente: o telefone dele em qualquer formato (ou uma conversa dele). Vale para todas as conversas
 * da empresa com o mesmo número (todas as unidades) e para a ficha do contato.
 *
 * - exportar: um JSON com tudo o que aponta para essas conversas ou para esse telefone, tabela por tabela
 *   (achadas pelo próprio banco: tabela nova entra sozinha). Arquivos (fotos, áudios) entram só como descrição.
 * - anonimizar: apaga o que identifica a pessoa (nome, telefone, textos, arquivos, ficha, memória da IA) e
 *   mantém os números do negócio sem dono (a conversa existiu, em que etapa ficou, valores, NPS sem comentário).
 *   O telefone continua só na lista de "não quero receber mensagens" (transmissao_optout), se ele tiver pedido,
 *   para nunca mais receber transmissão — é o mínimo para respeitar o próprio pedido.
 */

export class ErroDadosCliente extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

/** Tabelas da equipe (quem leu, favoritos, notificações) e filas internas: não são dados do cliente. */
const FORA_DA_EXPORTACAO = new Set([
  'conversas', 'leituras', 'marcadas_nao_lidas', 'digitando', 'contatos_favoritos', 'conversas_pessoais', 'notificacoes',
  'entrada', 'historico_entrada', 'enviados', 'migracoes', 'auditoria', 'ia_uso', 'ia_bloqueios',
]);
export const TEXTO_APAGADO = '[apagado a pedido do cliente]';
export const NOME_ANONIMO = 'Cliente anônimo';

export interface ClienteEncontrado {
  chave: string | null;
  conversas: Array<{ id: string; unidade: string; nome: string | null; telefone: string }>;
  telefones: string[];
  temFicha: boolean;
}

export class DadosCliente {
  constructor(private readonly pool: pg.Pool) {}

  /** Conversas e ficha do cliente na empresa (pelo telefone em qualquer formato, ou por uma conversa dele). */
  async encontrar(empresaId: string, p: { telefone?: string; conversaId?: string }, c: pg.Pool | pg.PoolClient = this.pool): Promise<ClienteEncontrado> {
    let telefone = p.telefone?.trim();
    if (!telefone && p.conversaId) {
      const r = await c.query<{ telefone: string }>('select telefone from sintonia.conversas where id = $1 and empresa_id = $2', [p.conversaId, empresaId]);
      telefone = r.rows[0]?.telefone;
      if (!telefone) throw new ErroDadosCliente('Conversa não encontrada.', 404);
    }
    if (!telefone) throw new ErroDadosCliente('Informe o telefone do cliente.');
    const { rows: [k] } = await c.query<{ chave: string | null }>('select sintonia.telefone_chave($1) as chave', [telefone]);
    const chave = k?.chave ?? null;
    const { rows: conversas } = await c.query<{ id: string; unidade: string; nome: string | null; telefone: string }>(
      `select id, unidade, nome, telefone from sintonia.conversas
        where empresa_id = $1 and (telefone = $2 or ($3::text is not null and telefone_chave = $3)) order by criada_em`,
      [empresaId, telefone, chave],
    );
    const { rows: fichas } = await c.query<{ telefone: string }>(
      `select telefone from sintonia.contatos where empresa_id = $1 and (telefone = $2 or ($3::text is not null and telefone_chave = $3))`,
      [empresaId, telefone, chave],
    );
    const telefones = [...new Set([...conversas.map((x) => x.telefone), ...fichas.map((x) => x.telefone)])];
    return { chave, conversas, telefones, temFicha: fichas.length > 0 };
  }

  /** Tudo o que o banco tem sobre o cliente, em JSON. */
  async exportar(empresaId: string, p: { telefone?: string; conversaId?: string }, agora = new Date()) {
    const cli = await this.encontrar(empresaId, p);
    if (!cli.conversas.length && !cli.temFicha) throw new ErroDadosCliente('Não encontramos ninguém com esse telefone.', 404);
    const ids = cli.conversas.map((x) => x.id);
    const colunas = await this.colunas();
    const tabelas: Record<string, unknown[]> = {};
    const { rows: conversas } = await this.pool.query<{ linha: unknown }>(
      `select to_jsonb(x) - 'sugestao' as linha from sintonia.conversas x where x.id = any($1::uuid[]) order by x.criada_em`,
      [ids],
    );
    tabelas.conversas = conversas.map((r) => r.linha);
    for (const [tabela, cols] of colunas) {
      if (FORA_DA_EXPORTACAO.has(tabela)) continue;
      const porConversa = cols.get('conversa_id');
      const porTelefone = cols.has('telefone') && cols.has('empresa_id');
      if (!porConversa && !porTelefone) continue;
      const binarios = [...cols].filter(([, tipo]) => tipo === 'bytea').map(([nome]) => nome);
      const condicoes: string[] = [];
      if (porConversa === 'uuid') condicoes.push('x.conversa_id = any($1::text[]::uuid[])');
      else if (porConversa) condicoes.push('x.conversa_id::text = any($1::text[])');
      if (porTelefone) condicoes.push('(x.empresa_id = $2 and x.telefone = any($3::text[]))');
      const sql = `with valores as (select $1::text[] as c, $2::text as e, $3::text[] as t) select to_jsonb(x)${binarios.map((b) => ` - '${b}'`).join('')} as linha from sintonia.${tabela} x where ${condicoes.join(' or ')}`;
      const { rows } = await this.pool.query<{ linha: unknown }>(sql, [ids, empresaId, cli.telefones]);
      if (rows.length) tabelas[tabela] = rows.map((r) => r.linha);
    }
    // Arquivos das mensagens: só a descrição (tipo, nome, tamanho). O arquivo em si é entregue à parte, se pedido.
    const { rows: midias } = await this.pool.query<{ linha: unknown }>(
      `select to_jsonb(md) - 'conteudo' as linha from sintonia.midias md join sintonia.mensagens m on m.id = md.mensagem_id
        where m.conversa_id = any($1::uuid[])`,
      [ids],
    );
    if (midias.length) tabelas.midias = midias.map((r) => r.linha);
    const { rows: tags } = await this.pool.query<{ conversa_id: string; tag: string; marcada_em: Date }>(
      `select ct.conversa_id, t.nome as tag, ct.marcada_em from sintonia.conversa_tags ct join sintonia.tags t on t.id = ct.tag_id
        where ct.conversa_id = any($1::uuid[]) order by ct.marcada_em`,
      [ids],
    );
    if (tags.length) tabelas.tags_das_conversas = tags;
    const { rows: foto } = await this.pool.query('select 1 from sintonia.fotos where telefone = any($1::text[]) limit 1', [cli.telefones]);
    return {
      geradoEm: agora.toISOString(),
      empresaId,
      cliente: { telefones: cli.telefones, conversas: cli.conversas.length, unidades: [...new Set(cli.conversas.map((x) => x.unidade))], temFotoDePerfil: foto.length > 0 },
      observacao: 'Arquivos (fotos, áudios, documentos) aparecem só como descrição em "midias". Senhas e chaves do sistema não fazem parte dos dados do cliente.',
      tabelas,
    };
  }

  /**
   * Apaga o que identifica o cliente, numa transação só (ou tudo, ou nada). Devolve quantas linhas mudaram por tabela.
   * Tabela que não existe nesta instalação é pulada.
   */
  async anonimizar(empresaId: string, p: { telefone?: string; conversaId?: string }): Promise<{ conversas: number; alteracoes: Record<string, number> }> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const cli = await this.encontrar(empresaId, p, c);
      if (!cli.conversas.length && !cli.temFicha) throw new ErroDadosCliente('Não encontramos ninguém com esse telefone.', 404);
      const ids = cli.conversas.map((x) => x.id);
      // Ninguém grava nessas conversas durante a limpeza.
      await c.query('select id from sintonia.conversas where id = any($1::uuid[]) order by id for update', [ids]);
      const alteracoes: Record<string, number> = {};
      const passo = async (nome: string, sql: string) => {
        await c.query('savepoint passo');
        try {
          // Todo passo recebe os 3 valores ($1 conversas, $2 empresa, $3 telefones), mesmo se não usar algum.
          const r = await c.query(`with valores as (select $1::uuid[] as c, $2::text as e, $3::text[] as t) ${sql}`, [ids, empresaId, cli.telefones]);
          if (r.rowCount) alteracoes[nome] = (alteracoes[nome] ?? 0) + r.rowCount;
          await c.query('release savepoint passo');
        } catch (e) {
          const codigo = (e as { code?: string }).code;
          await c.query('rollback to savepoint passo');
          // 42P01 tabela não existe, 42703 coluna não existe (instalação mais antiga): pula.
          if (codigo !== '42P01' && codigo !== '42703') throw e;
        }
      };
      const C = 'conversa_id = any($1::uuid[])';
      const T = '(empresa_id = $2 and telefone = any($3::text[]))';
      // Arquivos e textos.
      await passo('midias', 'delete from sintonia.midias where mensagem_id in (select id from sintonia.mensagens where conversa_id = any($1::uuid[]))');
      await passo('transcricoes', `delete from sintonia.transcricoes where ${C}`);
      await passo('mensagens', `update sintonia.mensagens set texto = '${TEXTO_APAGADO}', autor_nome = case when autor = 'cliente' then null else autor_nome end where ${C}`);
      await passo('mensagens_agendadas', `delete from sintonia.mensagens_agendadas where ${C}`);
      await passo('followup_envios', `delete from sintonia.followup_envios where ${C}`);
      await passo('agenda_confirmacoes', `delete from sintonia.agenda_confirmacoes where ${C}`);
      await passo('radar_historico', `delete from sintonia.radar_historico where ${C}`);
      await passo('radar_conversas', `delete from sintonia.radar_conversas where ${C}`);
      await passo('memoria_cliente', `delete from sintonia.memoria_cliente where ${C} or ${T}`);
      await passo('contatos', `delete from sintonia.contatos where empresa_id = $2 and telefone = any($3::text[])`);
      await passo('nao_duplicatas', `delete from sintonia.nao_duplicatas where empresa_id = $2 and (telefone_a = any($3::text[]) or telefone_b = any($3::text[]))`);
      await passo('fotos', `delete from sintonia.fotos where telefone = any($3::text[])`);
      // Números do negócio ficam, sem o que identifica a pessoa.
      await passo('origens_lead', `update sintonia.origens_lead set primeira_mensagem = null, fbclid = null, gclid = null, ctwa_clid = null, indicado_por = null, detalhe = null where ${C}`);
      await passo('nps_pesquisas', `update sintonia.nps_pesquisas set comentario = null, detalhe = null where ${C}`);
      await passo('atendimentos_finalizados', `update sintonia.atendimentos_finalizados set observacao = null where ${C}`);
      await passo('perdas', `update sintonia.perdas set detalhe = null where ${C}`);
      await passo('reunioes', `update sintonia.reunioes set nome = '${NOME_ANONIMO}', telefone = 'anonimo', email = null, observacao = null where ${C} or ${T}`);
      await passo('chamadas', `update sintonia.chamadas set telefone = 'anonimo' where ${C} or ${T}`);
      await passo('email_envios', `update sintonia.email_envios set email = 'anonimo-' || id || '@anonimo.invalid', nome = null, telefone = null, variaveis = '{}' where ${C} or ${T}`);
      await passo('transmissao_destinos', `update sintonia.transmissao_destinos set telefone = 'anonimo-' || id, nome = null, texto = null where ${C}`);
      await passo('rotina_tarefas', `update sintonia.rotina_tarefas set cliente_nome = null, descricao = null where ${C}`);
      await passo('capi_eventos', `update sintonia.capi_eventos set payload = '{}' where ${C}`);
      await passo('bot_execucoes', `update sintonia.bot_execucoes set estado = '{}', log = '[]' where ${C}`);
      await passo('eventos', `update sintonia.eventos set dados = dados - array['nome','telefone','texto','email','mensagem','observacao','observacoes','resumo','comentario','detalhe'] where ${C} and dados is not null`);
      // Fila de entrada já processada: some o conteúdo da mensagem (o id fica, para a mesma mensagem não entrar de novo).
      await passo('entrada', `update sintonia.entrada set mensagem = '{"apagado": true}'::jsonb, conversa_chave = 'anonimo' where status in ('feita', 'falhou') and conversa_chave like any (select '%|' || t from unnest($3::text[]) t)`);
      // Por último a conversa: o telefone vira um código que não volta ao número (a lista e os relatórios seguem funcionando).
      await passo('conversas', `update sintonia.conversas set nome = '${NOME_ANONIMO}', telefone = 'anonimo-' || replace(id::text, '-', ''), resumo = null, sugestao = null, trinks_cliente_id = null, etiquetas = '{}' where id = any($1::uuid[])`);
      await c.query('commit');
      return { conversas: ids.length, alteracoes };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** Colunas (nome → tipo) de cada tabela do esquema sintonia. */
  private async colunas(): Promise<Map<string, Map<string, string>>> {
    const { rows } = await this.pool.query<{ tabela: string; coluna: string; tipo: string }>(
      `select c.table_name as tabela, c.column_name as coluna, c.udt_name as tipo
         from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'sintonia' and t.table_type = 'BASE TABLE' order by c.table_name, c.ordinal_position`,
    );
    const m = new Map<string, Map<string, string>>();
    for (const r of rows) {
      const t = m.get(r.tabela) ?? new Map<string, string>();
      t.set(r.coluna, r.tipo);
      m.set(r.tabela, t);
    }
    return m;
  }
}
