-- marketing: Central de criativos. Busca as leads por data de chegada (primeiro toque) sem varrer a tabela toda.
set local search_path to sintonia;

create index if not exists origens_lead_chegada on origens_lead (em) where toque = 'primeiro';
