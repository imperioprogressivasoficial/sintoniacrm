-- ia-aprende: a IA aprende com as conversas da equipe e com documentos (PDF/texto) do dono.
-- aprender_config: chave "Aprender sozinha" (ligada por padrão) e quando estudou pela última vez.
-- aprender_rodadas: cada estudo (conversas ou documento), com o andamento salvo lote a lote (retoma depois de reiniciar).
-- aprender_itens: cada aprendizado (pendente, aplicado, recusado ou desfeito). Os aplicados viram a memória da IA.
-- aprender_lidas: até que mensagem cada conversa já foi estudada (o estudo diário só lê o que é novo).
-- Aditiva: só cria tabelas novas.
set local search_path to sintonia;

create table if not exists aprender_config (
  empresa_id      text primary key,
  auto            boolean not null default true,
  ultimo_estudo   timestamptz,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);

create table if not exists aprender_rodadas (
  id              uuid primary key,
  empresa_id      text not null,
  origem          text not null check (origem in ('conversas', 'documento')),
  situacao        text not null check (situacao in ('estudando', 'juntando', 'pronta', 'falhou')),
  pedida_por      text,
  criada_em       timestamptz not null default now(),
  atualizada_em   timestamptz not null default now(),
  terminada_em    timestamptz,
  conversas       jsonb not null default '[]',
  lidas           integer not null default 0,
  total           integer not null default 0,
  observacoes     jsonb not null default '[]',
  tokens_entrada  bigint not null default 0,
  tokens_saida    bigint not null default 0,
  resultado       jsonb,
  erro            text,
  documento_nome  text,
  documento_texto text,
  documento_pdf   bytea
);
create index if not exists aprender_rodadas_empresa on aprender_rodadas (empresa_id, criada_em desc);
-- Um estudo das conversas por vez em cada empresa.
create unique index if not exists aprender_rodadas_uma on aprender_rodadas (empresa_id)
  where origem = 'conversas' and situacao in ('estudando', 'juntando');

create table if not exists aprender_itens (
  id              uuid primary key,
  empresa_id      text not null,
  rodada_id       uuid,
  origem          text not null,
  categoria       text not null,
  acao            text not null check (acao in ('acrescentar', 'pergunta', 'corrigir')),
  destino         text not null,
  titulo          text not null,
  texto           text not null,
  pergunta        text,
  resposta        text,
  trecho_atual    text,
  conversas       integer not null default 0,
  exemplos        jsonb not null default '[]',
  conferir        boolean not null default false,
  contradiz       boolean not null default false,
  motivo          text,
  situacao        text not null check (situacao in ('pendente', 'aplicado', 'recusado', 'desfeito')),
  automatico      boolean not null default false,
  criado_em       timestamptz not null default now(),
  decidido_em     timestamptz,
  decidido_por    text,
  desfeito_em     timestamptz,
  desfeito_por    text,
  aplicacao       jsonb
);
create index if not exists aprender_itens_empresa on aprender_itens (empresa_id, situacao, criado_em desc);

create table if not exists aprender_lidas (
  empresa_id   text not null,
  conversa_id  uuid not null,
  ate          timestamptz not null,
  primary key (empresa_id, conversa_id)
);
