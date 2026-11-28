-- serena-config (dono 28/11): "Jeito de atender" da IA por empresa (Inteligência › Jeito de atender) e o histórico de
-- quem mudou. Aditiva: só cria tabelas novas. A Império nasce preenchida pelo servidor (knowledge/imperio.jeito.json),
-- uma vez só; o que a equipe editar nunca é sobrescrito.
set local search_path to sintonia;

create table if not exists jeito_atender (
  empresa_id      text primary key,
  config          jsonb not null default '{}',
  atualizada_em   timestamptz not null default now(),
  atualizada_por  text
);

create table if not exists jeito_atender_versoes (
  id          bigserial primary key,
  empresa_id  text not null,
  config      jsonb not null,
  campos      text[] not null default '{}',
  em          timestamptz not null default now(),
  por         text
);
create index if not exists jeito_atender_versoes_empresa on jeito_atender_versoes (empresa_id, em desc);
