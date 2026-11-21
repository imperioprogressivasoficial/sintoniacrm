-- conversa-extra: silenciar e arquivar conversas de cliente, por pessoa (como "marcadas não lidas").
-- Silenciada = sem som, vibração e push dessa conversa para essa pessoa. Arquivada = sai da lista principal
-- até a cliente mandar mensagem nova (a regra fica no servidor: arquivada_em < ultima_mensagem_cliente = desarquivada).
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

create table if not exists conversas_pessoais (
  usuario_id        uuid not null references usuarios(id) on delete cascade,
  conversa_id       uuid not null references conversas(id) on delete cascade,
  empresa_id        text not null,
  silenciada_ate    timestamptz,
  silenciada_sempre boolean not null default false,
  arquivada_em      timestamptz,
  atualizado_em     timestamptz not null default now(),
  primary key (usuario_id, conversa_id)
);
-- O push procura quem silenciou uma conversa.
create index if not exists conversas_pessoais_silencio on conversas_pessoais (conversa_id) where silenciada_sempre or silenciada_ate is not null;
