-- Empresa (nome de exibição e configuração da IA) e tags (etiquetas) criadas pela empresa.
-- Escrita para poder rodar de novo sem estragar nada (tudo "if not exists" / "on conflict do nothing").
set local search_path to sintonia;

-- A tabela empresas já existe desde a 001; ganha a configuração da IA e quem mexeu por último.
alter table empresas
  add column if not exists config_ia      jsonb not null default '{}',
  add column if not exists atualizada_em  timestamptz,
  add column if not exists atualizada_por text;

create table if not exists tags (
  id          uuid primary key,
  empresa_id  text not null,
  nome        text not null,
  cor         text not null,             -- hex de uma cor da paleta fixa (src/tags/tags.ts)
  ordem       integer not null default 0,
  criada_por  text,
  criada_em   timestamptz not null default now()
);
-- Nome único por empresa, sem diferenciar maiúsculas.
-- (Depois da 010 o índice certo é tags_nome_funil: este só é criado se ele ainda não existe.)
do $$ begin
  if to_regclass('tags_nome_funil') is null then
    create unique index if not exists tags_nome on tags (empresa_id, lower(nome));
  end if;
end $$;

-- Tag marcada numa conversa. Tabela própria (e não o array conversas.etiquetas) para que marcar/desmarcar
-- nunca seja sobrescrito por quem grava a conversa inteira ao mesmo tempo (IA, envio, funil).
create table if not exists conversa_tags (
  conversa_id  uuid not null references conversas(id) on delete cascade,
  tag_id       uuid not null references tags(id) on delete cascade,
  marcada_por  text,
  marcada_em   timestamptz not null default now(),
  primary key (conversa_id, tag_id)
);
create index if not exists conversa_tags_tag on conversa_tags (tag_id);

-- Migração segura do que já existia: cada etiqueta de texto vira uma tag da empresa e fica marcada
-- nas mesmas conversas. "precisa da equipe" é um aviso do sistema (a IA pediu ajuda) e continua só no array.
-- O array conversas.etiquetas não é apagado (volta atrás sem perder nada).
with nomes as (
  select c.empresa_id, min(left(btrim(e.nome), 30)) as nome, lower(left(btrim(e.nome), 30)) as chave
    from conversas c cross join lateral unnest(c.etiquetas) as e(nome)
   where btrim(e.nome) <> '' and lower(btrim(e.nome)) <> 'precisa da equipe'
   group by c.empresa_id, lower(left(btrim(e.nome), 30))
), numeradas as (
  select n.*, (row_number() over (partition by n.empresa_id order by n.chave) - 1)::int as i
    from nomes n
   where not exists (select 1 from tags t where t.empresa_id = n.empresa_id and lower(t.nome) = n.chave)
)
insert into tags (id, empresa_id, nome, cor, ordem, criada_por)
select gen_random_uuid(), empresa_id, nome,
       (array['#E5484D','#F76B15','#D4A017','#30A46C','#12A594','#0090FF','#3E63DD','#8E4EC6','#D6409F','#8B8D98'])[1 + i % 10],
       1000 + i, 'migração'
  from numeradas
on conflict do nothing;

insert into conversa_tags (conversa_id, tag_id, marcada_por)
select distinct c.id, t.id, 'migração'
  from conversas c
  cross join lateral unnest(c.etiquetas) as e(nome)
  join tags t on t.empresa_id = c.empresa_id and lower(t.nome) = lower(left(btrim(e.nome), 30))
on conflict do nothing;
