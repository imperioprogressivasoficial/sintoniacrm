-- Conversas de grupo: grupos arquivados (como no WhatsApp) e o endereço da foto (para só baixar de novo quando muda).
-- A Evolution v2.3.7 não conta quais conversas estão arquivadas no celular: o "arquivado" é guardado aqui
-- (e, quando dá, também é aplicado no celular pela Evolution).
set local search_path to sintonia;

alter table grupos add column if not exists arquivado boolean not null default false;
alter table grupos add column if not exists arquivado_em timestamptz;
alter table grupos add column if not exists foto_url text;
