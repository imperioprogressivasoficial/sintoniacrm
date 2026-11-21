-- Chaves e configurações das conexões (IA, Trinks, Evolution), cifradas pela aplicação.
set local search_path to sintonia;

create table conexoes (
  chave          text primary key,
  valor          text not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);
