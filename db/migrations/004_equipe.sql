-- Equipe: dona (responsável) de cada conversa e quem está respondendo agora (anti-duplicidade).
set local search_path to sintonia;

-- Sem chave estrangeira de propósito: usuárias nunca são apagadas, só desativadas,
-- e o nome fica guardado junto para a tela não precisar consultar a equipe.
alter table conversas
  add column responsavel_id   uuid,
  add column responsavel_nome text;
create index conversas_responsavel on conversas (responsavel_id) where responsavel_id is not null;

-- Quem está digitando em cada conversa. "desde" marca o início da sequência de digitação:
-- quem começou primeiro tem a vez; a sequência acaba se a pessoa fica ~60 s sem digitar.
create table digitando (
  conversa_id  uuid not null references conversas(id) on delete cascade,
  usuario_id   uuid not null,
  nome         text not null,
  desde        timestamptz not null,
  em           timestamptz not null,
  primary key (conversa_id, usuario_id)
);
