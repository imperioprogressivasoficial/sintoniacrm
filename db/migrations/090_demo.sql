-- Dados de demonstração (Conta › Mais › Dados de demonstração).
-- Cada coisa criada pelo gerador fica registrada aqui (tipo + id): apagar a demonstração remove só o que está
-- nesta lista, nunca um dado real. Pode rodar de novo sem estragar nada.
set local search_path to sintonia;

create table if not exists demo_registros (
  empresa_id  text not null,
  -- conversa, usuario, tag, funil, campo, resposta, automacao, notificacao, contato, meta
  tipo        text not null,
  chave       text not null,
  criado_em   timestamptz not null default now(),
  primary key (empresa_id, tipo, chave)
);
-- "Esta conversa é de demonstração?" (automações de conversa parada e relatório diário a ignoram).
create index if not exists demo_registros_chave on demo_registros (tipo, chave);
