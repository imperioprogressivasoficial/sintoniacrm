-- Transcrição dos áudios das conversas: feita uma vez, guardada para sempre.
set local search_path to sintonia;

create table transcricoes (
  mensagem_id  uuid primary key references mensagens(id) on delete cascade,
  conversa_id  uuid not null references conversas(id) on delete cascade,
  texto        text not null,
  modelo       text,
  criada_por   text,
  criada_em    timestamptz not null default now()
);
create index transcricoes_conversa on transcricoes (conversa_id);
