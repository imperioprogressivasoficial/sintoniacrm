-- unidades: as unidades e a identidade da empresa passam a vir do cadastro (Empresa › Unidades e Empresa › Dados).
-- Nada é apagado; escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- 1) A Império continua se apresentando igual: o que estava fixo no código ("salões de alisamento e progressiva
--    em Salvador") passa a estar no cadastro dela, onde a direção pode mudar. Só preenche o que está vazio.
update empresas
   set dados = jsonb_set(coalesce(dados, '{}'::jsonb), '{segmento}', to_jsonb('Salões de alisamento e progressiva'::text), true)
 where id = 'imperio' and coalesce(dados->>'segmento', '') = '';
update empresas
   set dados = jsonb_set(
         coalesce(dados, '{}'::jsonb), '{endereco}',
         coalesce(dados->'endereco', '{}'::jsonb)
           || jsonb_build_object('cidade', coalesce(nullif(dados->'endereco'->>'cidade', ''), 'Salvador'),
                                 'uf', coalesce(nullif(dados->'endereco'->>'uf', ''), 'BA')),
         true)
 where id = 'imperio' and (coalesce(dados->'endereco'->>'cidade', '') = '' or coalesce(dados->'endereco'->>'uf', '') = '');

-- 2) Nome que vai nas mensagens para as clientes (antes fixo em src/unidades.ts): só nas unidades da Império que
--    ainda têm o nome com que foram criadas e nenhum "nome para clientes".
update unidades set dados = coalesce(dados, '{}'::jsonb) || '{"nomeCliente": "Salvador Norte Shopping"}'::jsonb
 where empresa_id = 'imperio' and id = 'norte' and coalesce(dados->>'nomeCliente', '') = '';
update unidades set dados = coalesce(dados, '{}'::jsonb) || '{"nomeCliente": "Shopping Sumaré"}'::jsonb
 where empresa_id = 'imperio' and id = 'sumare' and coalesce(dados->>'nomeCliente', '') = '';

-- 3) Dado antigo continua válido: unidade que aparece em conversas ou nas pessoas e não está no cadastro entra
--    nele (com o próprio id como nome, para a direção renomear). Só em empresa que já tem cadastro de unidades
--    (a que ainda não tem é semeada pelo servidor no 1º uso, com os nomes certos).
insert into unidades (empresa_id, id, nome, ordem)
select x.empresa_id, x.unidade, x.unidade, 100
  from (
    select distinct empresa_id, unidade from conversas
    union
    select distinct empresa_id, unnest(unidades) from usuarios
  ) x
 where x.unidade ~ '^[a-z0-9][a-z0-9-]{0,39}$'
   and exists (select 1 from unidades u where u.empresa_id = x.empresa_id)
   and not exists (select 1 from unidades u where u.empresa_id = x.empresa_id and u.id = x.unidade)
on conflict (empresa_id, id) do nothing;
