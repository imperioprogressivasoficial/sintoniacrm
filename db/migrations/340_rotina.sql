-- Rotina do vendedor (Atendimento › Rotina): tarefas com prazo e o checklist que se repete todo dia/semana.
-- Nomes com prefixo "rotina_" para não confundir com a tabela "tarefas" (lembretes internos do robô).
set local search_path to sintonia;

create table if not exists rotina_tarefas (
  id              uuid primary key,
  empresa_id      text not null,
  titulo          text not null,
  descricao       text not null default '',
  vence_em        timestamptz,                 -- sem prazo = null
  responsavel_id  text not null,
  criado_por      text,
  conversa_id     uuid,                        -- conversa ligada (opcional)
  cliente_nome    text,                        -- nome guardado para mostrar mesmo se a conversa sumir
  prioridade      text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta')),
  feita           boolean not null default false,
  feita_em        timestamptz,
  criada_em       timestamptz not null default now()
);
create index if not exists rotina_tarefas_pessoa on rotina_tarefas (empresa_id, responsavel_id, feita, vence_em);
create index if not exists rotina_tarefas_conversa on rotina_tarefas (conversa_id) where conversa_id is not null;

-- Itens do checklist que se repete. para_id null = vale para toda a equipe.
create table if not exists rotina_itens (
  id          uuid primary key,
  empresa_id  text not null,
  titulo      text not null,
  frequencia  text not null check (frequencia in ('diaria', 'dias', 'semanal')),
  dias        int[] not null default '{}',     -- 0 = domingo … 6 = sábado (para 'dias')
  ate         text,                            -- 'HH:MM' opcional ("até 10h")
  para_id     text,
  ativa       boolean not null default true,
  ordem       int not null default 0,
  criado_por  text,
  criada_em   timestamptz not null default now()
);
create index if not exists rotina_itens_empresa on rotina_itens (empresa_id, ordem);

-- Marcação de feito: um por pessoa por período (o dia, ou a segunda-feira da semana no 'semanal').
create table if not exists rotina_marcas (
  item_id     uuid not null references rotina_itens(id) on delete cascade,
  usuario_id  text not null,
  periodo     date not null,
  feita_em    timestamptz not null default now(),
  primary key (item_id, usuario_id, periodo)
);
