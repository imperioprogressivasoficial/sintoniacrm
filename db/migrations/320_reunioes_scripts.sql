-- Link de agendamento (como o Cal.com, dentro da Sintonia): a pessoa manda o link e o contato escolhe o horário.
-- E os scripts de venda (roteiros por etapa do funil), em Vendas › Scripts.
set local search_path to sintonia;

create table if not exists links_reuniao (
  id            uuid primary key,
  empresa_id    text not null,
  slug          text not null unique,
  titulo        text not null,
  descricao     text not null default '',
  duracao_min   int  not null check (duracao_min between 10 and 240),
  dias          int[] not null,              -- 0 = domingo … 6 = sábado
  inicio        text not null,               -- 'HH:MM' (horário da Bahia)
  fim           text not null,
  antecedencia_h int not null default 2,
  janela_dias   int not null default 21,
  local         text not null default '',    -- ex.: link do Meet, endereço, "ligação"
  ativo         boolean not null default true,
  criado_por    text,
  criado_em     timestamptz not null default now()
);
create index if not exists links_reuniao_empresa on links_reuniao (empresa_id);

create table if not exists reunioes (
  id          uuid primary key,
  link_id     uuid not null references links_reuniao(id) on delete cascade,
  empresa_id  text not null,
  nome        text not null,
  telefone    text,
  email       text,
  observacao  text not null default '',
  inicio      timestamptz not null,
  fim         timestamptz not null,
  status      text not null default 'marcada' check (status in ('marcada', 'cancelada')),
  criado_em   timestamptz not null default now()
);
-- Um horário só pode ser marcado uma vez por link.
create unique index if not exists reunioes_horario on reunioes (link_id, inicio) where status = 'marcada';
create index if not exists reunioes_empresa on reunioes (empresa_id, inicio);

create table if not exists scripts_venda (
  id         uuid primary key,
  empresa_id text not null,
  titulo     text not null,
  etapa      text not null default '',
  texto      text not null,
  ordem      int  not null default 0,
  criado_em  timestamptz not null default now()
);
create index if not exists scripts_venda_empresa on scripts_venda (empresa_id, ordem);
