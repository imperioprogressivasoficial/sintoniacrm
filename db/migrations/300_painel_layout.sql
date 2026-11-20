-- Dashboard personalizado: o jeito que cada pessoa arrumou o seu Dashboard (ordem dos blocos, blocos tirados,
-- a métrica escolhida em cada bloco e os relatórios que ela adicionou). Um JSON pequeno por pessoa.
set local search_path to sintonia;

create table if not exists painel_layouts (
  usuario_id    uuid primary key references usuarios(id) on delete cascade,
  dados         jsonb not null,
  atualizado_em timestamptz not null default now()
);
