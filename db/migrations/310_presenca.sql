-- Presença da equipe: "Disponível para atender" (online) ou "fora do ar" (offline), uma linha por pessoa.
-- Antes ficava num serviço à parte (deploy/presenca, arquivo JSON). Quem nunca mexeu no interruptor conta como online.
set local search_path to sintonia;

create table if not exists presencas (
  usuario_id    uuid primary key references usuarios(id) on delete cascade,
  status        text not null check (status in ('online', 'offline')),
  atualizado_em timestamptz not null default now()
);
