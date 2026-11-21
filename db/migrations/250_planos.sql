-- Modelo de negócio da IA (src/planos, docs/PLANOS.md): uso por chamada, assinatura, pedidos e bloqueios do porteiro.
set local search_path to sintonia;

create table if not exists ia_uso (
  id bigserial primary key,
  empresa_id text not null,
  em timestamptz not null,
  conversa_id text,
  origem text not null default 'agente',
  modelo text not null,
  tokens_entrada bigint not null default 0,
  tokens_saida bigint not null default 0,
  tokens_cache_leitura bigint not null default 0,
  tokens_cache_escrita bigint not null default 0,
  custo_usd numeric(14, 6) not null default 0,
  dentro_horario boolean not null
);
create index if not exists ia_uso_empresa_em on ia_uso (empresa_id, em);

create table if not exists ia_assinaturas (
  empresa_id text primary key,
  plano text not null,
  adicional_fora boolean not null default false,
  status text not null default 'ativa',
  config jsonb not null default '{}',
  atualizada_em timestamptz not null default now(),
  atualizada_por text
);

create table if not exists ia_pedidos (
  id uuid primary key,
  empresa_id text not null,
  tipo text not null,
  dados jsonb not null default '{}',
  status text not null default 'pendente',
  criado_em timestamptz not null default now(),
  pago_em timestamptz,
  por text
);
create index if not exists ia_pedidos_empresa on ia_pedidos (empresa_id, criado_em desc);

create table if not exists ia_bloqueios (
  id bigserial primary key,
  empresa_id text not null,
  em timestamptz not null,
  conversa_id text,
  motivo text not null
);
create index if not exists ia_bloqueios_empresa_em on ia_bloqueios (empresa_id, em);
