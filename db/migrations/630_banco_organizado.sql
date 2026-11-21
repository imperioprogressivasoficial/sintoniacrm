-- banco-seguranca: clientes e leads organizados, sem perder nada.
-- Tudo aqui é aditivo e pode rodar de novo (if not exists / create or replace). Nada é apagado nem reescrito.
-- Só mexe no "catálogo" das tabelas (instantâneo): os índices pesados e o preenchimento em lotes ficam na 631,
-- que roda fora de transação (create index concurrently não trava a gravação).
set local search_path to sintonia;

-- ---------------------------------------------------------------- 1. Telefone normalizado
-- Mesma regra de src/leads/telefone-br.ts (chaveTelefone): 55 + DDD + número, só dígitos; celular com o 9º dígito.
-- "+55 (71) 98812-4471", "71 8812-4471" e "5571988124471" dão a mesma chave. O teste test/banco-organizado.test.ts
-- confere que o banco e o código dizem o mesmo.
-- Diferenças de propósito (o código não chama com estes): identificador de rede social ("ig:123", "fb:", "tt:")
-- fica como está (em minúsculas); texto com letras que não é rede social (ex.: cliente anonimizado) não tem chave.
create or replace function telefone_chave(bruto text) returns text
language plpgsql immutable parallel safe as $$
declare
  texto text := btrim(coalesce(bruto, ''));
  d text;
  com_mais boolean;
  ddd int;
  local text;
begin
  if texto = '' then return null; end if;
  if texto ~* '^(fb|ig|tt):' then return lower(texto); end if;
  if texto ~ '[A-Za-z]' then return null; end if;
  d := regexp_replace(texto, '\D', '', 'g');
  if d = '' then return null; end if;
  com_mais := left(texto, 1) = '+';
  if left(d, 2) = '00' then d := substr(d, 3); end if;
  if com_mais and left(d, 2) <> '55' then return regexp_replace(texto, '\D', '', 'g'); end if;
  if left(d, 1) = '0' and length(d) in (13, 14) then d := substr(d, 4);
  elsif left(d, 1) = '0' and length(d) in (11, 12) then d := substr(d, 2);
  end if;
  if length(d) in (8, 9) then return regexp_replace(texto, '\D', '', 'g'); end if; -- sem DDD: não dá para saber
  if length(d) in (10, 11) then d := '55' || d; end if;
  if length(d) not in (12, 13) or left(d, 2) <> '55' then return regexp_replace(texto, '\D', '', 'g'); end if;
  ddd := substr(d, 3, 2)::int;
  if ddd not in (11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,
                 54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99) then
    return regexp_replace(texto, '\D', '', 'g');
  end if;
  local := substr(d, 5);
  if length(local) = 8 then
    if local ~ '^[6-9]' then local := '9' || local;
    elsif local !~ '^[2-5]' then return regexp_replace(texto, '\D', '', 'g');
    end if;
  elsif left(local, 1) <> '9' then
    return regexp_replace(texto, '\D', '', 'g');
  end if;
  return '55' || substr(d, 3, 2) || local;
end $$;

-- Coluna nova, sem valor padrão: entra na hora, sem reescrever a tabela. O preenchimento das linhas antigas
-- é feito em lotes pequenos na 631; daqui para frente o gatilho preenche sozinho.
alter table conversas add column if not exists telefone_chave text;
alter table contatos add column if not exists telefone_chave text;

create or replace function preencher_telefone_chave() returns trigger language plpgsql as $$
begin
  new.telefone_chave := sintonia.telefone_chave(new.telefone);
  return new;
end $$;

create or replace trigger conversas_telefone_chave before insert or update of telefone on conversas
  for each row execute function preencher_telefone_chave();
create or replace trigger contatos_telefone_chave before insert or update of telefone on contatos
  for each row execute function preencher_telefone_chave();

-- ---------------------------------------------------------------- 2. Possíveis duplicatas (só mostra; nunca junta sozinho)
-- A tela CRM › ⋯ › Localizar duplicatas continua sendo o lugar de decidir e mesclar. Esta vista serve para
-- conferir no banco (e para o relatório): a mesma pessoa escrita de jeitos diferentes, ou em mais de uma unidade.
create or replace view possiveis_duplicatas as
with pessoas as (
  select empresa_id, telefone_chave, telefone, unidade, id as conversa_id, nome, null::text as email
    from conversas where telefone_chave is not null and telefone_chave !~ '^(fb|ig|tt):'
  union all
  select empresa_id, telefone_chave, telefone, null, null, nome, email
    from contatos where telefone_chave is not null
),
por_numero as (
  select empresa_id, telefone_chave,
         array_agg(distinct telefone order by telefone) as telefones,
         array_agg(distinct unidade order by unidade) filter (where unidade is not null) as unidades,
         array_agg(distinct conversa_id) filter (where conversa_id is not null) as conversas,
         array_agg(distinct nome order by nome) filter (where nome is not null) as nomes
    from pessoas group by empresa_id, telefone_chave
)
select empresa_id, telefone_chave,
       case when cardinality(telefones) > 1 then 'mesmo número escrito de jeitos diferentes'
            else 'mesmo número em mais de uma unidade' end as motivo,
       telefones, coalesce(unidades, '{}') as unidades, coalesce(conversas, '{}') as conversas, coalesce(nomes, '{}') as nomes
  from por_numero
 where cardinality(telefones) > 1 or coalesce(cardinality(conversas), 0) > 1
union all
select k.empresa_id, null, 'mesmo e-mail em contatos diferentes',
       array_agg(distinct k.telefone order by k.telefone), '{}', '{}',
       array_agg(distinct k.nome order by k.nome) filter (where k.nome is not null)
  from contatos k
 where k.email is not null and btrim(k.email) <> ''
 group by k.empresa_id, lower(btrim(k.email))
having count(distinct coalesce(k.telefone_chave, k.telefone)) > 1;

-- ---------------------------------------------------------------- 3. Quando foi criado / quando mudou
-- Linhas antigas ficam com a data em branco (não inventamos quando nasceram); as novas recebem a hora certa.
-- "atualizado_em" novo é mantido por um gatilho (o código não precisa saber dele).
create or replace function tocar_atualizado_em() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

do $$
declare
  t text;
begin
  -- Tabelas sem a data de criação.
  foreach t in array array['cartao_valores','memoria_cliente','acesso_perfis','anuncios_meta','automacoes_config','base_secoes',
    'comercial_config','conexoes','conversas_pessoais','followup_config','ia_assinaturas','ia_controle','lead_produtos_config',
    'nps_config','perdas_config','painel_layouts','perfis_usuario','rodizio_config','notificacao_preferencias','origens_lead',
    'whatsapp_saude','fotos','usuario_fotos','lead_produtos_valor','tabela_preco_itens','acesso_usuarios']
  loop
    if to_regclass('sintonia.' || t) is not null
       and not exists (select 1 from information_schema.columns where table_schema = 'sintonia' and table_name = t and column_name in ('criado_em','criada_em')) then
      execute format('alter table sintonia.%I add column criado_em timestamptz', t);
      execute format('alter table sintonia.%I alter column criado_em set default now()', t);
    end if;
  end loop;
  -- Tabelas que mudam e não guardavam quando mudaram.
  foreach t in array array['tags','campos_contato','usuarios','interessados','funis','tarefas','lead_produtos_valor','tabela_preco_itens',
    'agentes_ia_conhecimento','links_reuniao','rotina_itens','scripts_venda','reunioes','rotina_tarefas','links_rastreados',
    'bot_midias','fluxo_midias','acesso_usuarios','chamadas','nps_pesquisas','atendimentos_finalizados']
  loop
    if to_regclass('sintonia.' || t) is not null
       and not exists (select 1 from information_schema.columns where table_schema = 'sintonia' and table_name = t and column_name in ('atualizado_em','atualizada_em')) then
      execute format('alter table sintonia.%I add column atualizado_em timestamptz', t);
      execute format('alter table sintonia.%I alter column atualizado_em set default now()', t);
      execute format('create or replace trigger %I before update on sintonia.%I for each row execute function sintonia.tocar_atualizado_em()', t || '_atualizado_em', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. Ligações que faltavam (chaves estrangeiras)
-- Tabelas que apontam para uma conversa sem a ligação no banco: ao apagar a conversa, o que era dela ficava solto.
-- "not valid": vale para tudo o que entrar daqui para frente, sem varrer a tabela agora (sem trava longa).
-- A conferência das linhas antigas (validate) fica na 631, só onde não há nada solto (vista "orfaos" mostra o resto).
-- Histórico de atendimento (NPS, perdas, finalizações, radar, follow-up) vai junto com a conversa apagada, como as
-- mensagens já iam; dados que fazem sentido sozinhos (memória da IA, envios de transmissão e e-mail) só perdem a ligação.
-- Reunião e tarefa da rotina ficam sem ligação de propósito: guardam a conversa como referência solta (podem vir de
-- outro lugar que não o banco de conversas). O pedido de apagar dados (LGPD) e a mescla de duplicatas cuidam delas.
do $$
declare
  r record;
begin
  for r in select * from (values
      ('conversa_agente_ia', 'cascade'), ('followup_pausas', 'cascade'), ('radar_conversas', 'cascade'),
      ('radar_historico', 'cascade'), ('atendimentos_finalizados', 'cascade'), ('nps_pesquisas', 'cascade'),
      ('perdas', 'cascade'), ('followup_envios', 'cascade'), ('agenda_confirmacoes', 'cascade'),
      ('memoria_cliente', 'set null'),
      ('transmissao_destinos', 'set null'), ('email_envios', 'set null')
    ) as x(tabela, ao_apagar)
  loop
    if to_regclass('sintonia.' || r.tabela) is not null
       and not exists (select 1 from pg_constraint where conname = r.tabela || '_conversa_fk' and conrelid = ('sintonia.' || r.tabela)::regclass) then
      execute format('alter table sintonia.%I add constraint %I foreign key (conversa_id) references sintonia.conversas(id) on delete %s not valid',
                     r.tabela, r.tabela || '_conversa_fk', r.ao_apagar);
    end if;
  end loop;
end $$;

-- O que está solto hoje (linhas que apontam para conversa que não existe mais). Só leitura: nada é apagado.
create or replace view orfaos as
select 'mensagens'::text as tabela, count(*) as linhas from mensagens x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'eventos', count(*) from eventos x where x.conversa_id is not null and not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'conversa_agente_ia', count(*) from conversa_agente_ia x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'followup_pausas', count(*) from followup_pausas x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'radar_conversas', count(*) from radar_conversas x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'radar_historico', count(*) from radar_historico x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'atendimentos_finalizados', count(*) from atendimentos_finalizados x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'nps_pesquisas', count(*) from nps_pesquisas x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'perdas', count(*) from perdas x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'followup_envios', count(*) from followup_envios x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'agenda_confirmacoes', count(*) from agenda_confirmacoes x where not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'memoria_cliente', count(*) from memoria_cliente x where x.conversa_id is not null and not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'transmissao_destinos', count(*) from transmissao_destinos x where x.conversa_id is not null and not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'email_envios', count(*) from email_envios x where x.conversa_id is not null and not exists (select 1 from conversas c where c.id = x.conversa_id)
union all select 'ficha sem empresa (contatos)', count(*) from contatos x where not exists (select 1 from empresas e where e.id = x.empresa_id)
union all select 'conversa sem empresa', count(*) from conversas x where not exists (select 1 from empresas e where e.id = x.empresa_id);

-- ---------------------------------------------------------------- 5. Registro de ações sensíveis (auditoria)
-- Entrar, bloqueio por senha errada, trocar senha, mexer em permissões e chaves, exportar e apagar dados de cliente.
-- Só acrescenta: nenhuma linha pode ser alterada nem apagada (gatilho abaixo). Telefone de cliente nunca entra
-- aqui em claro (só um resumo que não volta ao número), para o pedido de "apagar meus dados" valer de verdade.
create table if not exists auditoria (
  id          bigint generated always as identity primary key,
  empresa_id  text not null,
  em          timestamptz not null default now(),
  autor_id    uuid,
  autor_nome  text,
  papel       text,
  acao        text not null,
  alvo        text,
  detalhe     jsonb not null default '{}',
  ip          text
);
create index if not exists auditoria_empresa_em on auditoria (empresa_id, em desc);
create index if not exists auditoria_acao_em on auditoria (acao, em desc);

create or replace function auditoria_so_acrescenta() returns trigger language plpgsql as $$
begin
  raise exception 'O registro de auditoria não pode ser alterado nem apagado.';
end $$;
create or replace trigger auditoria_so_acrescenta before update or delete on auditoria
  for each row execute function auditoria_so_acrescenta();
