-- clientes-tags: grupo (categoria) opcional de cada tag, para organizar a tela Vendas › Tags
-- (ex.: "Interesse", "Origem", "Situação"). Texto livre, curto; vazio = sem grupo.
set local search_path to sintonia;

alter table tags add column if not exists grupo text;
