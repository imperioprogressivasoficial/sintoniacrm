-- Contas de acesso, sessões de login e interessados vindos da página de vendas.
set local search_path to sintonia;

create table usuarios (
  id          uuid primary key,
  empresa_id  text not null,
  nome        text not null,
  email       text not null,
  senha_hash  text not null,
  papel       text not null check (papel in ('atendente', 'recepcionista', 'gerente', 'direcao', 'admin')),
  unidades    text[] not null default '{}',
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create unique index usuarios_email on usuarios (lower(email));

-- Guardamos só o resumo (hash) do token: quem ler o banco não consegue entrar como ninguém.
create table sessoes (
  token_hash  text primary key,
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null
);
create index sessoes_usuario on sessoes (usuario_id);

create table interessados (
  id          bigserial primary key,
  nome        text not null,
  empresa     text,
  whatsapp    text not null,
  mensagem    text,
  origem      text,
  criado_em   timestamptz not null default now()
);
