-- Conversas de equipe: chat interno da empresa (não passa pelo WhatsApp).
-- Conversa direta entre duas pessoas, grupos que alguém cria e o grupo "Geral" com todo mundo.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

create table if not exists equipe_salas (
  id           uuid primary key,
  empresa_id   text not null,
  tipo         text not null check (tipo in ('direta', 'grupo')),
  nome         text,                          -- só grupos (a direta mostra o nome da outra pessoa)
  geral        boolean not null default false, -- o grupo "Geral" com todas as pessoas da empresa
  chave        text,                          -- direta: 'direta:<id menor>:<id maior>'; geral: 'geral'
  criada_por   text,
  criada_em    timestamptz not null default now(),
  ultima_em    timestamptz not null default now()
);
create unique index if not exists equipe_salas_chave on equipe_salas (empresa_id, chave) where chave is not null;
create index if not exists equipe_salas_empresa on equipe_salas (empresa_id, ultima_em desc);

-- Quem participa de cada sala e até onde leu (número da última mensagem lida).
create table if not exists equipe_membros (
  sala_id      uuid not null references equipe_salas (id) on delete cascade,
  usuario_id   text not null,
  lida_seq     bigint not null default 0,
  entrou_em    timestamptz not null default now(),
  primary key (sala_id, usuario_id)
);
create index if not exists equipe_membros_usuario on equipe_membros (usuario_id);

-- Mensagens: texto, resposta a outra mensagem e, se for o caso, a conversa de cliente compartilhada.
create table if not exists equipe_mensagens (
  seq          bigserial primary key,
  id           uuid not null unique,
  sala_id      uuid not null references equipe_salas (id) on delete cascade,
  empresa_id   text not null,
  autor_id     text not null,
  autor_nome   text not null,
  texto        text not null default '',
  resposta_a   uuid,
  conversa_id  uuid,
  em           timestamptz not null default now()
);
create index if not exists equipe_mensagens_sala on equipe_mensagens (sala_id, seq desc);
