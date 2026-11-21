-- Área de desenvolvedores (Integrações): chaves de API, uso da API, webhooks de saída e a fila de entregas.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Chaves de API por empresa. A chave inteira nunca fica guardada: só o prefixo (aberto) e o SHA-256.
create table if not exists api_chaves (
  id              uuid primary key,
  empresa_id      text not null,
  nome            text not null,
  prefixo         text not null unique,
  hash            text not null,
  escopos         text[] not null default '{}',
  limite_minuto   int not null default 60,
  criada_por      text,
  criada_por_nome text,
  criada_em       timestamptz not null default now(),
  expira_em       timestamptz,
  ultimo_uso_em   timestamptz,
  ultimo_ip       text,
  revogada_em     timestamptz,
  revogada_por    text
);
create index if not exists api_chaves_empresa on api_chaves (empresa_id, criada_em desc);

-- Cada chamada feita com uma chave (API ou MCP), para a tela mostrar o uso. Apagado depois de 30 dias.
create table if not exists api_uso (
  id         bigserial primary key,
  chave_id   uuid not null,
  empresa_id text not null,
  origem     text not null default 'api',
  metodo     text not null,
  rota       text not null,
  status     int not null,
  duracao_ms int not null default 0,
  ip         text,
  em         timestamptz not null default now()
);
create index if not exists api_uso_chave on api_uso (chave_id, em desc);
create index if not exists api_uso_empresa on api_uso (empresa_id, em desc);

-- Webhooks de saída: para onde a Sintonia avisa os eventos. O segredo de assinatura fica cifrado (cofre).
create table if not exists webhooks (
  id                uuid primary key,
  empresa_id        text not null,
  nome              text not null,
  url               text not null,
  eventos           text[] not null default '{}',
  segredo_cifrado   text not null,
  ativo             boolean not null default true,
  desligado_motivo  text,
  desligado_em      timestamptz,
  falhas_seguidas   int not null default 0,
  ultimo_sucesso_em timestamptz,
  ultima_falha_em   timestamptz,
  criado_por        text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index if not exists webhooks_empresa on webhooks (empresa_id, criado_em);

-- Fila persistente das entregas (com novas tentativas e espera crescente) e o histórico delas.
create table if not exists webhook_entregas (
  id              uuid primary key,
  webhook_id      uuid not null references webhooks(id) on delete cascade,
  empresa_id      text not null,
  evento          text not null,
  evento_id       text not null,
  corpo           jsonb not null,
  status          text not null default 'pendente',
  tentativas      int not null default 0,
  proxima_em      timestamptz,
  reservada_ate   timestamptz,
  ultimo_http     int,
  ultima_resposta text,
  ultimo_erro     text,
  duracao_ms      int,
  teste           boolean not null default false,
  criada_em       timestamptz not null default now(),
  entregue_em     timestamptz,
  atualizada_em   timestamptz not null default now()
);
create index if not exists webhook_entregas_fila on webhook_entregas (proxima_em) where status = 'pendente';
create index if not exists webhook_entregas_historico on webhook_entregas (webhook_id, criada_em desc, id desc);
create index if not exists webhook_entregas_limpeza on webhook_entregas (criada_em);
