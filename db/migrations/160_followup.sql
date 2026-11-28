-- Follow-up automático configurável (cadências por situação) e confirmação automática de agenda.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Configuração da empresa (cadências, confirmação por unidade, limites): um JSON validado pela aplicação.
create table if not exists followup_config (
  empresa_id    text primary key,
  config        jsonb not null default '{}',
  atualizado_por text,
  atualizado_em timestamptz not null default now()
);

-- Cada envio programado (fila persistente). `chave` única: o mesmo passo nunca é programado/enviado duas vezes.
create table if not exists followup_envios (
  id            bigserial primary key,
  empresa_id    text not null,
  conversa_id   uuid not null,
  tipo          text not null check (tipo in ('cadencia', 'confirmacao')),
  situacao      text not null,                          -- id da cadência, ou 'confirmacao'
  passo         integer not null default 0,
  total         integer not null default 1,
  chave         text not null unique,
  quando        timestamptz not null,
  estado        text not null default 'pendente'
                check (estado in ('pendente', 'enviando', 'enviado', 'cancelado', 'pulado', 'falhou')),
  reservada_ate timestamptz,
  dados         jsonb not null default '{}',
  detalhe       text,
  criado_em     timestamptz not null default now(),
  enviado_em    timestamptz
);
create index if not exists followup_envios_prontos on followup_envios (quando) where estado = 'pendente';
create index if not exists followup_envios_reservados on followup_envios (reservada_ate) where estado = 'enviando';
create index if not exists followup_envios_conversa on followup_envios (conversa_id, criado_em desc);

-- Confirmação de cada agendamento: status visto na Agenda e na conversa.
create table if not exists agenda_confirmacoes (
  empresa_id    text not null,
  agendamento   text not null,                          -- id do item da Agenda (t<trinksId> ou conversa-inicio)
  conversa_id   uuid not null,
  unidade       text not null,
  inicio        timestamptz not null,
  servico       text,
  profissional  text,
  status        text not null default 'aguardando'
                check (status in ('aguardando', 'confirmado', 'remarcar', 'sem_resposta')),
  perguntado_em timestamptz,
  respondido_em timestamptz,
  resposta      text,
  criado_em     timestamptz not null default now(),
  primary key (empresa_id, agendamento)
);
create index if not exists agenda_confirmacoes_conversa on agenda_confirmacoes (conversa_id, inicio desc);

-- Conversas com follow-up pausado pela equipe (botão "pausar" no selo da conversa).
create table if not exists followup_pausas (
  conversa_id   uuid primary key,
  por           text,
  em            timestamptz not null default now()
);

-- E-mail com variáveis próprias do envio ({servico}, {data}...): confirmação e follow-up.
alter table email_envios add column if not exists variaveis jsonb;
