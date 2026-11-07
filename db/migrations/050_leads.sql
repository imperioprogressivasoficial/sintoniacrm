-- Leads: importação/exportação e controle de duplicatas.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Quando a ficha nasceu (exportação "Criado em" de contatos sem conversa, como os importados).
alter table contatos add column if not exists criado_em timestamptz not null default now();
update contatos set criado_em = atualizado_em where criado_em > atualizado_em;

-- Busca por e-mail (duplicatas e importação).
create index if not exists contatos_email on contatos (empresa_id, lower(email)) where email is not null;

-- Pares de telefones que a equipe disse que NÃO são a mesma pessoa (telefone_a < telefone_b).
create table if not exists nao_duplicatas (
  empresa_id  text not null,
  telefone_a  text not null,
  telefone_b  text not null,
  marcada_por text,
  marcada_em  timestamptz not null default now(),
  primary key (empresa_id, telefone_a, telefone_b),
  check (telefone_a < telefone_b)
);

-- Agenda: agendamentos feitos pela Sintonia, procurados pelo horário marcado (dados.inicio).
create index if not exists eventos_agendamentos on eventos (((dados->>'inicio')))
  where tipo in ('agendamento_ia', 'agendamento_equipe');
