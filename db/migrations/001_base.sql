-- Sintonia: base do banco próprio (Postgres).
-- Tudo fica no esquema "sintonia", separado de qualquer outro sistema no mesmo servidor.

create schema if not exists sintonia;
set local search_path to sintonia;

create table empresas (
  id         text primary key,                 -- ex.: 'imperio'
  nome       text not null,
  criada_em  timestamptz not null default now()
);

create table conversas (
  id                       uuid primary key,
  empresa_id               text not null,
  unidade                  text not null,
  canal_id                 text not null,       -- instância Evolution ou phone_number_id da Meta
  telefone                 text not null,       -- 55 + DDD + número, só dígitos
  nome                     text,
  modo                     text not null default 'copiloto' check (modo in ('ia', 'copiloto', 'humano')),
  etapa                    text not null default 'novo_lead'
                           check (etapa in ('novo_lead','em_conversa','interessada','agendada','compareceu','manutencao','perdida')),
  trinks_cliente_id        integer,
  pausa_ia_ate             timestamptz,
  ultima_mensagem_cliente  timestamptz,
  ultima_mensagem_equipe   timestamptz,
  ultima_mensagem_ia       timestamptz,
  etiquetas                text[] not null default '{}',
  resumo                   text,
  sugestao                 text,
  criada_em                timestamptz not null,
  atualizada_em            timestamptz not null,
  unique (empresa_id, unidade, telefone)
);
create index conversas_recentes on conversas (empresa_id, atualizada_em desc);
create index conversas_etapa on conversas (empresa_id, etapa);

create table mensagens (
  id           uuid primary key,
  conversa_id  uuid not null references conversas(id) on delete cascade,
  autor        text not null check (autor in ('cliente', 'ia', 'equipe', 'sistema')),
  autor_nome   text,
  texto        text not null,
  id_externo   text unique,                      -- id no WhatsApp: evita processar duas vezes
  em           timestamptz not null
);
create index mensagens_conversa on mensagens (conversa_id, em);

-- Ids das mensagens que a própria Sintonia enviou (para não confundir com a atendente).
create table enviados (
  id_externo  text primary key,
  em          timestamptz not null default now()
);

-- Lembretes, follow-ups, manutenção e reavaliações de "quem responde".
create table tarefas (
  id           uuid primary key,
  conversa_id  uuid not null references conversas(id) on delete cascade,
  tipo         text not null,
  quando       timestamptz not null,
  feita        boolean not null default false,
  criada_em    timestamptz not null default now()
);
create index tarefas_pendentes on tarefas (quando) where not feita;
create index tarefas_conversa on tarefas (conversa_id) where not feita;

-- Tudo que aconteceu: alimenta o relatório diário e o painel.
create table eventos (
  id           bigserial primary key,
  conversa_id  uuid,
  unidade      text,
  tipo         text not null,
  dados        jsonb,
  em           timestamptz not null
);
create index eventos_periodo on eventos (em);

-- Fila de entrada: toda mensagem do WhatsApp é gravada aqui antes de qualquer outra coisa.
create table entrada (
  id                 bigserial primary key,
  canal              text not null,              -- 'evolution' | 'meta'
  id_externo         text not null unique,       -- mesmo webhook duas vezes = uma linha só
  conversa_chave     text not null,              -- canal_id + telefone: mensagens da mesma cliente em ordem
  mensagem           jsonb not null,
  status             text not null default 'pendente' check (status in ('pendente', 'processando', 'feita', 'falhou')),
  tentativas         integer not null default 0,
  proxima_tentativa  timestamptz not null default now(),
  reservada_ate      timestamptz,
  erro               text,
  criada_em          timestamptz not null default now(),
  feita_em           timestamptz
);
create index entrada_pronta on entrada (proxima_tentativa, id) where status in ('pendente', 'processando');
create index entrada_falhas on entrada (criada_em) where status = 'falhou';
