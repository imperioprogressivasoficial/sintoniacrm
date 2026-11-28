-- Meta do mês do Dashboard (aba Painel): número de agendamentos que a gestão quer no mês.
-- Guardada na própria empresa, junto da configuração da IA. Pode rodar de novo sem estragar nada.
set local search_path to sintonia;

alter table empresas
  add column if not exists meta_painel jsonb not null default '{}';
