-- Foto (rosto) de cada pessoa da equipe: opcional, já reduzida pela tela (~256 px), guardada aqui.
-- Sai junto quando a pessoa é apagada (as atendentes da demonstração, por exemplo).
set local search_path to sintonia;

create table if not exists usuario_fotos (
  usuario_id     uuid primary key references usuarios(id) on delete cascade,
  conteudo       bytea not null,
  tipo           text not null,
  atualizada_em  timestamptz not null default now()
);
