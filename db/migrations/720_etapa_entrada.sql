-- etapa-entrada (21/11): etapa fixa "Entrada de leads" (bolinha cinza) antes de "Novo lead", em TODO funil.
-- Todo lead novo nasce nela e sai na primeira resposta da loja (equipe ou IA). Não renomeia, não apaga, fica sempre
-- em primeiro; pode ter automações.
-- Só acrescenta: ninguém muda de etapa (quem já existe fica onde está). Pode rodar de novo sem estragar nada.
set local search_path to sintonia;

-- 1) A etapa fixa da conversa (conversas.etapa) passa a aceitar 'entrada'.
--    A regra antiga sai e entra a nova. "not valid": as linhas que já existem passaram na regra antiga (mais estreita),
--    então não precisa varrer a tabela inteira com ela travada.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'sintonia.conversas'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%etapa%' and pg_get_constraintdef(oid) not ilike '%entrada%'
  loop
    execute format('alter table sintonia.conversas drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'sintonia.conversas'::regclass and conname = 'conversas_etapa_check') then
    alter table sintonia.conversas add constraint conversas_etapa_check
      check (etapa in ('entrada','novo_lead','em_conversa','interessada','agendada','compareceu','manutencao','perdida')) not valid;
  end if;
end $$;

-- 2) Funis criados pela empresa que já têm uma etapa chamada "Entrada de leads": ela vira a etapa fixa
--    (os leads que estão nela continuam lá). No funil do sistema isso não acontece (lá a etapa fixa espelha conversas.etapa).
update tags t
   set chave_sistema = 'entrada', cor = '#94a3b8', ordem = -1
  from funis f
 where f.id = t.funil_id and not f.sistema
   and t.chave_sistema is null and lower(btrim(t.nome)) = 'entrada de leads'
   and not exists (select 1 from tags x where x.funil_id = t.funil_id and x.chave_sistema = 'entrada');

-- 3) Todo funil (o do sistema e os da empresa) ganha a "Entrada de leads", antes de todas as outras (ordem -1).
insert into tags (id, empresa_id, nome, cor, ordem, criada_por, funil_id, chave_sistema)
select gen_random_uuid(), f.empresa_id, 'Entrada de leads', '#94a3b8', -1, 'sistema', f.id, 'entrada'
  from funis f
 where not exists (select 1 from tags t where t.funil_id = f.id and t.chave_sistema = 'entrada')
on conflict do nothing;
