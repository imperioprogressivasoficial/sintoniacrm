-- Base de conhecimento da IA no banco, em seções editáveis, com histórico e perguntas frequentes.
set local search_path to sintonia;

create table if not exists base_secoes (
  empresa_id      text not null,
  chave           text not null,           -- ex.: 'quem-somos'
  titulo          text not null,
  ordem           integer not null default 0,
  conteudo        text not null,
  atualizada_em   timestamptz not null default now(),
  atualizada_por  text,
  primary key (empresa_id, chave)
);

-- Histórico: cada versão gravada (as mais antigas são podadas pela aplicação).
create table if not exists base_versoes (
  id          bigserial primary key,
  empresa_id  text not null,
  chave       text not null,
  titulo      text not null,
  conteudo    text not null,
  em          timestamptz not null default now(),
  por         text
);
create index if not exists base_versoes_secao on base_versoes (empresa_id, chave, em desc);

create table if not exists base_faq (
  id              uuid primary key,
  empresa_id      text not null,
  pergunta        text not null,
  resposta        text not null,
  ordem           integer not null default 0,
  criada_em       timestamptz not null default now(),
  atualizada_em   timestamptz not null default now(),
  atualizada_por  text
);
create index if not exists base_faq_empresa on base_faq (empresa_id, ordem);
