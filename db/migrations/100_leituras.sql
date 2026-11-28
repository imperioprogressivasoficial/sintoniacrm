-- Até onde cada pessoa já leu cada conversa (o "não lida" do WhatsApp, por atendente).
set local search_path to sintonia;

create table leituras (
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  conversa_id uuid not null references conversas(id) on delete cascade,
  lida_ate    timestamptz not null,
  primary key (usuario_id, conversa_id)
);
