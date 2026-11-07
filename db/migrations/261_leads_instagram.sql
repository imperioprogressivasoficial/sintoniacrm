-- Leads da página de vendas: Instagram da empresa (o setor passou a ser opcional).
set local search_path to sintonia;

alter table interessados add column if not exists instagram text;
