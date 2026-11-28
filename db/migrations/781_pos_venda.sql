-- pos-venda (dono 28/11): funil "Pós-venda" (Conscientização, Retorno 30 dias, Manutenção 60 dias, Retorno 90 dias,
-- Voltou, Inativa) com automações por etapa até a cliente voltar. Meta: 4 visitas no ano.
-- O funil e as automações são criados pelo sistema (src/pos-venda): na Império, uma vez, ao subir; em qualquer empresa,
-- pelo botão "Criar funil pós-venda sugerido". Aqui só fica a configuração (aditiva, não mexe em nada que já existe).
set local search_path to sintonia;

create table if not exists pos_venda_config (
  empresa_id      text primary key,
  -- Funil criado pela sugestão (apagar o funil não traz a sugestão de volta sozinha: semeado_em fica).
  funil_id        uuid references funis(id) on delete set null,
  -- Meta de visitas por cliente em 12 meses (editável no topo do funil).
  meta_visitas    int not null default 4 check (meta_visitas between 1 and 52),
  -- Quando a sugestão foi criada (nunca é recriada por cima do que a equipe editou).
  semeado_em      timestamptz,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);

-- Visitas no ano: atendimentos (conversa chegou em Finalizado/Compareceu) por conversa e data.
create index if not exists eventos_compareceu on eventos (conversa_id, em)
  where tipo = 'etapa_mudou' and dados->>'para' = 'compareceu';
