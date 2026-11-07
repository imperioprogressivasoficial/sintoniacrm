-- Respostas rápidas da tela de conversa: "/preco" vira o texto pronto.
-- usuario_id vazio = da empresa (a gestão cuida); preenchido = pessoal de quem criou.
set local search_path to sintonia;

create table respostas_rapidas (
  id             uuid primary key,
  empresa_id     text not null,
  usuario_id     uuid references usuarios(id) on delete cascade,
  atalho         text not null,
  texto          text not null,
  criada_por     text,
  atualizada_em  timestamptz not null default now()
);
-- Um atalho por empresa (respostas da empresa) e um por pessoa (respostas pessoais).
create unique index respostas_rapidas_empresa on respostas_rapidas (empresa_id, atalho) where usuario_id is null;
create unique index respostas_rapidas_pessoal on respostas_rapidas (empresa_id, usuario_id, atalho) where usuario_id is not null;
