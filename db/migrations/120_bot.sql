-- Construtor visual de bot (fluxos em grafo, estilo Salesbot). Escrita para poder rodar de novo.
set local search_path to sintonia;

-- rascunho = o que a tela está editando; publicado = a versão que roda (null = nunca publicado).
create table if not exists bot_fluxos (
  id             uuid primary key,
  empresa_id     text not null,
  nome           text not null,
  descricao      text,
  ligado         boolean not null default false,
  rascunho       jsonb not null,
  publicado      jsonb,
  versao         integer not null default 0,
  publicado_em   timestamptz,
  publicado_por  text,
  opcoes         jsonb not null default '{}',
  criado_por     text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists bot_fluxos_empresa on bot_fluxos (empresa_id);

-- Uma execução = o bot rodando numa conversa: guarda o bloco atual, a espera, as variáveis e o caminho.
-- grafo = cópia da versão em uso (publicar de novo não mexe em quem já está no meio).
-- status: pendente (roda em proxima_em; esperando se for no futuro), rodando (reservada), concluida, cancelada, erro.
create table if not exists bot_execucoes (
  id             uuid primary key,
  fluxo_id       uuid not null references bot_fluxos(id) on delete cascade,
  conversa_id    uuid not null references conversas(id) on delete cascade,
  chave          text not null,
  status         text not null check (status in ('pendente', 'rodando', 'concluida', 'cancelada', 'erro')),
  teste          boolean not null default false,
  versao         integer not null default 0,
  grafo          jsonb not null,
  estado         jsonb not null,
  log            jsonb not null default '[]',
  erro           text,
  proxima_em     timestamptz not null,
  reservada_ate  timestamptz,
  criada_em      timestamptz not null,
  atualizada_em  timestamptz not null
);
create unique index if not exists bot_execucoes_evento on bot_execucoes (fluxo_id, conversa_id, chave);
-- Um bot por vez em cada conversa (testes não contam).
create unique index if not exists bot_execucoes_uma_ativa on bot_execucoes (conversa_id) where status in ('pendente', 'rodando') and not teste;
create index if not exists bot_execucoes_prontas on bot_execucoes (proxima_em) where status in ('pendente', 'rodando');
create index if not exists bot_execucoes_conversa on bot_execucoes (conversa_id) where status in ('pendente', 'rodando');
create index if not exists bot_execucoes_fluxo on bot_execucoes (fluxo_id, criada_em desc);

-- Imagens/arquivos enviados pela tela do bot (bloco "Enviar mensagem").
create table if not exists bot_midias (
  id          uuid primary key,
  empresa_id  text not null,
  nome        text,
  mimetype    text not null,
  conteudo    bytea not null,
  criada_em   timestamptz not null default now()
);
