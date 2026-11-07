-- Comercial: metas individuais / por unidade / da equipe, regras de comissão, tabela de preços por serviço
-- e o token secreto do Painel na TV (sala comercial). Uma linha por empresa. Pode rodar de novo sem estragar nada.
set local search_path to sintonia;

create table if not exists comercial_config (
  empresa_id text primary key,
  dados jsonb not null default '{}',
  tv_token text,
  tv_criado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

create unique index if not exists comercial_config_tv_token on comercial_config (tv_token) where tv_token is not null;
