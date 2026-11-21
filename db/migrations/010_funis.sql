-- Funis por tags: um funil é um grupo de tags exclusivas (cada tag do funil é uma etapa/coluna).
-- Dentro de um funil a conversa tem no máximo uma tag. O funil do sistema "Atendimento" espelha a
-- etapa fixa da conversa (conversas.etapa) e é criado aqui para toda empresa que já existe.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

create table if not exists funis (
  id          uuid primary key,
  empresa_id  text not null,
  nome        text not null,
  ordem       integer not null default 0,
  sistema     boolean not null default false,
  criada_por  text,
  criada_em   timestamptz not null default now()
);
-- Um só funil do sistema por empresa; nome único por empresa (sem diferenciar maiúsculas).
create unique index if not exists funis_sistema on funis (empresa_id) where sistema;
create unique index if not exists funis_nome on funis (empresa_id, lower(nome));

-- A tag pode ser etapa de um funil (funil_id) ou solta (null, como sempre foi).
alter table tags
  add column if not exists funil_id       uuid references funis(id) on delete cascade,
  add column if not exists chave_sistema  text;
-- O nome passa a ser único entre as soltas e dentro de cada funil (duas colunas "Novo" em funis diferentes podem).
drop index if exists tags_nome;
create unique index if not exists tags_nome_funil
  on tags (empresa_id, coalesce(funil_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(nome));
create unique index if not exists tags_chave_sistema on tags (funil_id, chave_sistema) where chave_sistema is not null;
create index if not exists tags_funil on tags (funil_id) where funil_id is not null;

-- Na marcação, o funil fica copiado para garantir no banco "uma etapa por funil por conversa".
-- marcada_em = desde quando a conversa está nessa etapa.
alter table conversa_tags add column if not exists funil_id uuid;
create unique index if not exists conversa_tags_funil on conversa_tags (conversa_id, funil_id) where funil_id is not null;
create index if not exists conversa_tags_quadro on conversa_tags (funil_id, tag_id, marcada_em) where funil_id is not null;

-- Funil do sistema para cada empresa conhecida (empresas cadastradas e as que já têm conversas).
insert into funis (id, empresa_id, nome, ordem, sistema, criada_por)
select gen_random_uuid(), e.empresa_id, 'Atendimento', 0, true, 'sistema'
  from (select id as empresa_id from empresas union select distinct empresa_id from conversas) e
 where not exists (select 1 from funis f where f.empresa_id = e.empresa_id and f.sistema)
on conflict do nothing;

-- As 7 etapas fixas viram etapas-tag do funil do sistema.
insert into tags (id, empresa_id, nome, cor, ordem, criada_por, funil_id, chave_sistema)
select gen_random_uuid(), f.empresa_id, x.nome, x.cor, x.ordem, 'sistema', f.id, x.chave
  from funis f
  cross join (values
    ('novo_lead', 'Novo lead', '#0090FF', 0),
    ('em_conversa', 'Em conversa', '#12A594', 1),
    ('interessada', 'Interessada', '#D4A017', 2),
    ('agendada', 'Agendada', '#3E63DD', 3),
    ('compareceu', 'Compareceu', '#30A46C', 4),
    ('manutencao', 'Manutenção', '#8E4EC6', 5),
    ('perdida', 'Perdida', '#8B8D98', 6)
  ) as x(chave, nome, cor, ordem)
 where f.sistema
   and not exists (select 1 from tags t where t.funil_id = f.id and t.chave_sistema = x.chave)
on conflict do nothing;

-- Toda conversa entra no funil do sistema na etapa em que está. "Desde": a última mudança de etapa registrada
-- (ou a criação da conversa).
insert into conversa_tags (conversa_id, tag_id, funil_id, marcada_por, marcada_em)
select c.id, t.id, t.funil_id, 'migração',
       coalesce((select max(e.em) from eventos e where e.conversa_id = c.id and e.tipo = 'etapa_mudou'), c.criada_em)
  from conversas c
  join funis f on f.empresa_id = c.empresa_id and f.sistema
  join tags t on t.funil_id = f.id and t.chave_sistema = c.etapa
on conflict do nothing;
