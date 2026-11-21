-- Lixeira de leads do pipeline (crm-topo): "Excluir lead" tira o cartão do quadro sem apagar nada.
-- A conversa, a ficha e a etapa continuam; o lead só fica escondido no pipeline até alguém recuperar
-- (filtro "Excluídos" › Recuperar). Um registro por pipeline (funil) e conversa.
set local search_path to sintonia;

create table if not exists leads_excluidos (
  funil_id      uuid not null references funis(id) on delete cascade,
  conversa_id   uuid not null references conversas(id) on delete cascade,
  empresa_id    text not null,
  excluido_em   timestamptz not null default now(),
  excluido_por  text,
  primary key (funil_id, conversa_id)
);
create index if not exists leads_excluidos_empresa on leads_excluidos (empresa_id, excluido_em desc);
