-- funil-atendimento (dono 28/11): o funil "Atendimento" passa a ter as etapas
--   Novo lead · Em atendimento · Reagendar · Sem resposta · Agendado <unidade> · Finalizado · Perdido
-- e o sistema move o lead sozinho por regras que a gestão liga/desliga (tabela funil_regras).
-- Nenhum lead é apagado e o histórico fica: quem muda de etapa ganha um evento "etapa_mudou" (motivo migracao_funil).
-- As etapas antigas (Novo lead antigo, Interessada, Manutenção) ficam guardadas, escondidas, para o histórico.
-- As etapas "Agendado <unidade>" (uma por unidade que agenda) são feitas pelo servidor ao subir, porque só ele sabe
-- quais unidades têm agenda (Conexões › Agenda). Pode rodar de novo sem estragar nada.
set local search_path to sintonia;

-- 1) Etapa do sistema de uma unidade só (Agendado Sumaré, Agendado Norte...).
alter table tags add column if not exists unidade text;
drop index if exists tags_chave_sistema;
create unique index if not exists tags_chave_sistema_unidade on tags (funil_id, chave_sistema, coalesce(unidade, '')) where chave_sistema is not null;

-- 2) conversas.etapa aceita as etapas novas.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'sintonia.conversas'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%etapa%' and pg_get_constraintdef(oid) not ilike '%sem_resposta%'
  loop
    execute format('alter table sintonia.conversas drop constraint %I', r.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'sintonia.conversas'::regclass and conname = 'conversas_etapa_check') then
    alter table sintonia.conversas add constraint conversas_etapa_check
      check (etapa in ('entrada','novo_lead','em_conversa','reagendar','sem_resposta','interessada','agendada','compareceu','manutencao','perdida')) not valid;
  end if;
end $$;

-- 3) Leads das etapas antigas vão para a mais próxima (com evento no histórico).
--    Novo lead antigo: se já houve conversa (a cliente escreveu e a loja respondeu depois) → Em atendimento; senão → Novo lead (entrada).
--    Interessada → Em atendimento. Manutenção → Finalizado.
with mudar as (
  select c.id, c.unidade, c.etapa as de,
         case c.etapa
           when 'interessada' then 'em_conversa'
           when 'manutencao' then 'compareceu'
           else case when c.ultima_mensagem_cliente is not null
                      and greatest(c.ultima_mensagem_equipe, c.ultima_mensagem_ia) > c.ultima_mensagem_cliente
                     then 'em_conversa' else 'entrada' end
         end as para
    from conversas c
   where c.etapa in ('novo_lead', 'interessada', 'manutencao')
), ev as (
  insert into eventos (tipo, conversa_id, unidade, em, dados)
  select 'etapa_mudou', m.id, m.unidade, now(), jsonb_build_object('de', m.de, 'para', m.para, 'motivo', 'migracao_funil')
    from mudar m
  returning 1
)
update conversas c set etapa = m.para from mudar m where c.id = m.id;

-- 4) Funil do sistema: as etapas antigas saem da tela (ficam no banco com "(antiga)" no nome, para o histórico).
update tags t
   set nome = t.nome || ' (antiga)', ordem = 90 + case t.chave_sistema when 'novo_lead' then 0 when 'interessada' then 1 else 2 end
  from funis f
 where f.id = t.funil_id and f.sistema and t.chave_sistema in ('novo_lead', 'interessada', 'manutencao')
   and t.nome not like '% (antiga)';

-- 5) Nomes novos (só quando a empresa não tinha mudado o nome e nenhuma outra etapa do funil já usa o nome novo).
with nomes(chave, antigo, novo, ordem) as (
  values ('entrada', 'entrada de leads', 'Novo lead', -1),
         ('em_conversa', 'em conversa', 'Em atendimento', 1),
         ('agendada', 'agendada', 'Agendado', 4),
         ('compareceu', 'compareceu', 'Finalizado', 20),
         ('perdida', 'perdida', 'Perdido', 21)
)
update tags t
   set nome = n.novo, ordem = n.ordem
  from funis f, nomes n
 where f.id = t.funil_id and f.sistema and t.chave_sistema = n.chave and lower(btrim(t.nome)) = n.antigo
   and not exists (select 1 from tags x where x.funil_id = t.funil_id and x.id <> t.id and lower(x.nome) = lower(n.novo));

-- 6) Etapas novas "Reagendar" e "Sem resposta" no funil do sistema. Se a empresa já tinha criado uma etapa com esse
--    nome no funil, ela passa a ser a do sistema (os leads que estão nela continuam lá).
with novas(chave, nome, cor, ordem) as (values ('reagendar', 'Reagendar', '#E5484D', 2), ('sem_resposta', 'Sem resposta', '#F76B15', 3))
update tags t
   set chave_sistema = n.chave
  from funis f, novas n
 where f.id = t.funil_id and f.sistema and t.chave_sistema is null and lower(btrim(t.nome)) = lower(n.nome)
   and not exists (select 1 from tags x where x.funil_id = t.funil_id and x.chave_sistema = n.chave);
insert into tags (id, empresa_id, nome, cor, ordem, criada_por, funil_id, chave_sistema)
select gen_random_uuid(), f.empresa_id, n.nome, n.cor, n.ordem, 'sistema', f.id, n.chave
  from funis f
  cross join (values ('reagendar', 'Reagendar', '#E5484D', 2), ('sem_resposta', 'Sem resposta', '#F76B15', 3)) as n(chave, nome, cor, ordem)
 where f.sistema
   and not exists (select 1 from tags t where t.funil_id = f.id and t.chave_sistema = n.chave)
   and not exists (select 1 from tags t where t.funil_id = f.id and lower(t.nome) = lower(n.nome))
on conflict do nothing;

-- 7) O cartão de cada lead que mudou acompanha (funil do sistema: a etapa da conversa manda; "desde" = agora).
update conversa_tags ct
   set tag_id = alvo.id, marcada_por = 'migração', marcada_em = now()
  from conversas c, funis f, tags atual,
       lateral (select t.id from tags t where t.funil_id = f.id and t.chave_sistema = c.etapa order by t.ordem, t.id limit 1) alvo
 where ct.conversa_id = c.id and f.empresa_id = c.empresa_id and f.sistema and ct.funil_id = f.id
   and atual.id = ct.tag_id and atual.chave_sistema is distinct from c.etapa
   and atual.chave_sistema in ('novo_lead', 'interessada', 'manutencao')
   and ct.tag_id <> alvo.id;

-- 8) Regras automáticas do funil (o que liga/desliga e os tempos): JSON validado pela aplicação.
create table if not exists funil_regras (
  empresa_id     text primary key,
  config         jsonb not null default '{}',
  atualizado_por text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
