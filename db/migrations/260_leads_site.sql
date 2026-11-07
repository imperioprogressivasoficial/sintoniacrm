-- Leads da página de vendas: dados do pop-up (e-mail, setor, faturamento, plano) e a demonstração agendada.
set local search_path to sintonia;

alter table interessados add column if not exists email text;
alter table interessados add column if not exists setor text;
alter table interessados add column if not exists faturamento text;
alter table interessados add column if not exists plano text;
-- Resumo (sha256) do token que só o navegador de quem enviou conhece: permite agendar sem login.
alter table interessados add column if not exists token_hash text;
alter table interessados add column if not exists demo_em timestamptz;
alter table interessados add column if not exists demo_marcada_em timestamptz;

-- Um horário de demonstração por vez.
create unique index if not exists interessados_demo_em_unico on interessados (demo_em) where demo_em is not null;
