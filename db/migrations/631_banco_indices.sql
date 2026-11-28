-- sintonia: sem-transacao
-- banco-seguranca: preenchimento em lotes e índices sem travar o banco no ar.
-- Este arquivo roda comando por comando, fora de transação (src/store/migrar.ts). Por isso:
--  * "create index concurrently" cria o índice sem bloquear quem grava na tabela;
--  * o preenchimento do telefone normalizado grava 2.000 linhas por vez e confirma (commit) a cada lote;
--  * todo comando pode rodar de novo sem estragar nada (se o app cair no meio, o arquivo roda outra vez).

-- ---------------------------------------------------------------- 1. Telefone normalizado das linhas antigas
do $$
declare
  n int;
begin
  loop
    update sintonia.conversas c set telefone_chave = sintonia.telefone_chave(c.telefone)
     where c.id in (select id from sintonia.conversas
                     where telefone_chave is distinct from sintonia.telefone_chave(telefone) limit 2000);
    get diagnostics n = row_count;
    commit;
    exit when n = 0;
  end loop;
  loop
    update sintonia.contatos k set telefone_chave = sintonia.telefone_chave(k.telefone)
     where (k.empresa_id, k.telefone) in (select empresa_id, telefone from sintonia.contatos
                                           where telefone_chave is distinct from sintonia.telefone_chave(telefone) limit 2000);
    get diagnostics n = row_count;
    commit;
    exit when n = 0;
  end loop;
end $$;

-- ---------------------------------------------------------------- 2. Índices das buscas mais usadas
-- Lista de Conversas por unidade (atendente e gerente veem só as unidades delas), da mais recente para a mais antiga.
create index concurrently if not exists conversas_unidade_recentes on sintonia.conversas (empresa_id, unidade, atualizada_em desc, id desc);
-- Achar a pessoa pelo telefone em qualquer formato, e as possíveis duplicatas.
create index concurrently if not exists conversas_telefone_chave on sintonia.conversas (empresa_id, telefone_chave) where telefone_chave is not null;
create index concurrently if not exists contatos_telefone_chave on sintonia.contatos (empresa_id, telefone_chave) where telefone_chave is not null;
-- Busca da ficha pelo nome (a de conversas por nome, telefone e texto já existe: 280 e 550).
create index concurrently if not exists contatos_nome_trgm on sintonia.contatos using gin (nome gin_trgm_ops);

-- ---------------------------------------------------------------- 3. Índices para apagar/juntar conversa sem varrer tabelas
-- Cada tabela ligada a uma conversa precisa de índice na coluna da ligação: sem ele, apagar uma conversa
-- (ou juntar duplicatas, ou atender um pedido de apagar dados) lê a tabela inteira, uma vez por conversa.
create index concurrently if not exists tarefas_conversa_todas on sintonia.tarefas (conversa_id);
create index concurrently if not exists automacao_execucoes_conversa on sintonia.automacao_execucoes (conversa_id);
create index concurrently if not exists bot_execucoes_conversa on sintonia.bot_execucoes (conversa_id);
create index concurrently if not exists capi_eventos_conversa on sintonia.capi_eventos (conversa_id) where conversa_id is not null;
create index concurrently if not exists cliques_link_conversa on sintonia.cliques_link (conversa_id) where conversa_id is not null;
create index concurrently if not exists contatos_favoritos_conversa on sintonia.contatos_favoritos (conversa_id);
create index concurrently if not exists conversas_pessoais_conversa on sintonia.conversas_pessoais (conversa_id);
create index concurrently if not exists leads_excluidos_conversa on sintonia.leads_excluidos (conversa_id);
create index concurrently if not exists leituras_conversa on sintonia.leituras (conversa_id);
create index concurrently if not exists marcadas_nao_lidas_conversa on sintonia.marcadas_nao_lidas (conversa_id);
create index concurrently if not exists notificacoes_conversa on sintonia.notificacoes (conversa_id) where conversa_id is not null;
-- As ligações novas da 630.
create index concurrently if not exists nps_pesquisas_conversa on sintonia.nps_pesquisas (conversa_id);
create index concurrently if not exists memoria_cliente_conversa on sintonia.memoria_cliente (conversa_id) where conversa_id is not null;
create index concurrently if not exists reunioes_conversa on sintonia.reunioes (conversa_id) where conversa_id is not null;
create index concurrently if not exists transmissao_destinos_conversa on sintonia.transmissao_destinos (conversa_id) where conversa_id is not null;
create index concurrently if not exists email_envios_conversa on sintonia.email_envios (conversa_id) where conversa_id is not null;

-- ---------------------------------------------------------------- 4. Conferir as ligações novas nas linhas antigas
-- "validate" não bloqueia quem grava. Só confere onde não há nada solto: com linha solta, a ligação continua valendo
-- para o que entrar daqui para frente e a vista sintonia.orfaos mostra o que sobrou (nada é apagado sozinho).
do $$
declare
  r record;
  soltas boolean;
begin
  for r in select c.conrelid::regclass::text as tabela, c.conname
             from pg_constraint c
            where c.connamespace = 'sintonia'::regnamespace and c.contype = 'f' and not c.convalidated
              and c.conname like '%\_conversa\_fk'
  loop
    execute format('select exists (select 1 from %s x where x.conversa_id is not null and not exists (select 1 from sintonia.conversas c where c.id = x.conversa_id))', r.tabela)
      into soltas;
    if soltas then
      raise notice 'Ligação % não conferida: há linhas soltas (veja sintonia.orfaos)', r.conname;
    else
      execute format('alter table %s validate constraint %I', r.tabela, r.conname);
    end if;
    commit;
  end loop;
end $$;

analyze sintonia.conversas;
analyze sintonia.contatos;
