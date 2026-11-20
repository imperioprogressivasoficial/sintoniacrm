-- "Marcar como não lida" do WhatsApp, por pessoa: a conversa fica com a bolinha de não lida
-- até essa pessoa abrir a conversa (ou marcar como lida), mesmo que a última mensagem seja da equipe.
set local search_path to sintonia;

create table if not exists marcadas_nao_lidas (
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  conversa_id uuid not null references conversas(id) on delete cascade,
  em          timestamptz not null default now(),
  primary key (usuario_id, conversa_id)
);
