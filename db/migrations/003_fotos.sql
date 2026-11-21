-- Foto de perfil do WhatsApp de cada cliente, guardada aqui (os links do WhatsApp expiram).
create table if not exists sintonia.fotos (
  telefone text primary key,
  conteudo bytea,
  tipo text,
  atualizada_em timestamptz not null
);
