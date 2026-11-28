-- Ficha do contato (cliente) e campos personalizados criados pela empresa.
set local search_path to sintonia;

create table contatos (
  empresa_id     text not null,
  telefone       text not null,
  nome           text,
  email          text,
  nascimento     date,
  observacoes    text,
  pessoa         text not null default 'fisica' check (pessoa in ('fisica', 'juridica')),
  empresa        jsonb not null default '{}',
  campos         jsonb not null default '{}',
  atualizado_em  timestamptz not null default now(),
  atualizado_por text,
  primary key (empresa_id, telefone)
);

create table campos_contato (
  id          uuid primary key,
  empresa_id  text not null,
  nome        text not null,
  tipo        text not null check (tipo in ('texto', 'numero', 'data', 'lista', 'sim_nao')),
  opcoes      text[] not null default '{}',
  ordem       integer not null default 0,
  criado_em   timestamptz not null default now()
);
create unique index campos_contato_nome on campos_contato (empresa_id, lower(nome));
