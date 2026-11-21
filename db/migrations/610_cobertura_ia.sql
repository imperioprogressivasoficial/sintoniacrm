-- ia-completa: a IA cobre as conversas de quem ficou "indisponível" (fim do turno, almoço).
-- Uma linha por conversa coberta: de quem ela é e como estava antes. Ao voltar "Disponível", as conversas
-- ainda marcadas voltam para a pessoa (modo "Só eu") e a marca sai.
set local search_path to sintonia;

create table if not exists cobertura_ia (
  conversa_id   uuid primary key references conversas(id) on delete cascade,
  usuario_id    text not null,
  usuario_nome  text,
  modo_antes    text not null default 'humano',
  desde         timestamptz not null default now()
);
create index if not exists cobertura_ia_usuario on cobertura_ia (usuario_id);
