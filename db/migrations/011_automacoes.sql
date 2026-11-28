-- Automações dos funis: gatilho + lista de passos. Cada disparo vira uma execução gravada
-- (auditoria e retomada depois de queda). Escrita para poder rodar de novo.
set local search_path to sintonia;

create table if not exists automacoes (
  id             uuid primary key,
  empresa_id     text not null,
  funil_id       uuid references funis(id) on delete cascade,  -- null = automação geral
  nome           text not null,
  ligada         boolean not null default false,
  gatilho        jsonb not null,
  passos         jsonb not null,
  opcoes         jsonb not null default '{}',
  criada_por     text,
  criada_em      timestamptz not null default now(),
  atualizada_em  timestamptz not null default now()
);
create index if not exists automacoes_empresa on automacoes (empresa_id);

-- status: pendente (pronta para rodar em proxima_em; "esperando" se for no futuro), rodando (reservada até
-- reservada_ate; se o processo cair, volta a rodar quando a reserva vence), concluida, cancelada, erro.
-- fila = passos que ainda faltam (cópia no disparo: editar a automação não mexe no que já está rodando).
create table if not exists automacao_execucoes (
  id             uuid primary key,
  automacao_id   uuid not null references automacoes(id) on delete cascade,
  conversa_id    uuid not null references conversas(id) on delete cascade,
  chave          text not null,               -- o evento que disparou (não dispara duas vezes pelo mesmo)
  status         text not null check (status in ('pendente', 'rodando', 'concluida', 'cancelada', 'erro')),
  fila           jsonb not null,
  feitos         integer not null default 0,
  profundidade   integer not null default 0,
  teste          boolean not null default false,
  proxima_em     timestamptz not null,
  reservada_ate  timestamptz,
  log            jsonb not null default '[]',
  erro           text,
  criada_em      timestamptz not null,
  atualizada_em  timestamptz not null
);
create unique index if not exists execucoes_evento on automacao_execucoes (automacao_id, conversa_id, chave);
-- No máximo uma execução ativa da mesma automação por conversa (testes não contam).
create unique index if not exists execucoes_uma_ativa on automacao_execucoes (automacao_id, conversa_id)
  where status in ('pendente', 'rodando') and not teste;
create index if not exists execucoes_prontas on automacao_execucoes (proxima_em) where status in ('pendente', 'rodando');
create index if not exists execucoes_conversa on automacao_execucoes (conversa_id) where status in ('pendente', 'rodando');
create index if not exists execucoes_automacao on automacao_execucoes (automacao_id, criada_em desc);

-- Mensagens automáticas enviadas (limite por conversa por dia).
create table if not exists automacao_envios (
  id           bigserial primary key,
  conversa_id  uuid not null references conversas(id) on delete cascade,
  em           timestamptz not null
);
create index if not exists automacao_envios_conversa on automacao_envios (conversa_id, em);

-- Objetivo do "fluxo de IA" de cada conversa: vai como instrução extra no prompt enquanto a conversa estiver com a IA.
create table if not exists conversa_objetivos (
  conversa_id   uuid primary key references conversas(id) on delete cascade,
  objetivo      text not null,
  automacao_id  uuid,
  desde         timestamptz not null,
  ate           timestamptz not null
);

-- Configuração das automações da empresa.
create table if not exists automacoes_config (
  empresa_id     text primary key,
  limite_diario  integer not null default 3,
  atualizada_em  timestamptz not null default now(),
  atualizada_por text
);
