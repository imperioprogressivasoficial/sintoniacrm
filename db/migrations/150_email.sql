-- E-mail marketing: contas remetentes (SMTP/IMAP ou API), modelos, campanhas, fila de envio,
-- rastreio (abertura, clique), descadastros e erros permanentes (bounce).
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Conta remetente. Senhas e chaves vão cifradas pela aplicação (Cofre), nunca em texto.
create table if not exists email_contas (
  id               uuid primary key,
  empresa_id       text not null,
  nome             text not null,                        -- ex.: "Império (Hostinger)"
  provedor         text not null default 'smtp' check (provedor in ('smtp', 'resend', 'brevo')),
  predefinicao     text,                                 -- hostinger | gmail | outlook | outro
  smtp_host        text,
  smtp_porta       integer,
  smtp_seguranca   text not null default 'ssl' check (smtp_seguranca in ('ssl', 'starttls', 'nenhuma')),
  usuario          text,
  senha_cifrada    text,
  api_chave_cifrada text,
  remetente_nome   text not null,
  remetente_email  text not null,
  responder_para   text,
  imap_ligado      boolean not null default false,
  imap_host        text,
  imap_porta       integer,
  imap_ultimo_uid  bigint not null default 0,
  imap_lido_em     timestamptz,
  imap_erro        text,
  por_minuto       integer not null default 20 check (por_minuto between 1 and 600),
  limite_diario    integer not null default 300 check (limite_diario between 1 and 100000),
  ativa            boolean not null default true,
  testada_em       timestamptz,
  teste_erro       text,
  criada_por       text,
  criada_em        timestamptz not null default now(),
  atualizada_em    timestamptz not null default now()
);
create index if not exists email_contas_empresa on email_contas (empresa_id);

-- Modelo salvo (usado pelas campanhas e pelo passo "enviar e-mail" das automações).
create table if not exists email_modelos (
  id           uuid primary key,
  empresa_id   text not null,
  nome         text not null,
  assunto      text not null default '',
  preheader    text not null default '',
  conteudo     jsonb not null default '{}',               -- { tema, blocos }
  conta_id     uuid references email_contas(id) on delete set null,
  criado_por   text,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists email_modelos_empresa on email_modelos (empresa_id);

create table if not exists email_campanhas (
  id              uuid primary key,
  empresa_id      text not null,
  nome            text not null,
  conta_id        uuid references email_contas(id) on delete set null,
  assunto         text not null default '',
  preheader       text not null default '',
  conteudo        jsonb not null default '{}',
  publico         jsonb not null default '{}',             -- filtros (tags, etapas, unidades, quantidade...)
  estado          text not null default 'rascunho'
                  check (estado in ('rascunho', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada')),
  agendada_para   timestamptz,
  base_url        text,                                    -- endereço público para os links de rastreio
  total           integer not null default 0,
  iniciada_em     timestamptz,
  concluida_em    timestamptz,
  criada_por      text,
  criada_em       timestamptz not null default now(),
  atualizada_em   timestamptz not null default now()
);
create index if not exists email_campanhas_empresa on email_campanhas (empresa_id, criada_em desc);
create index if not exists email_campanhas_agendadas on email_campanhas (agendada_para) where estado = 'agendada';

-- Um e-mail a enviar (fila persistente). Campanha: um por destinatário (único por e-mail).
-- Automação: chave única da execução/passo (repetir o passo não envia de novo).
create table if not exists email_envios (
  id              bigserial primary key,
  empresa_id      text not null,
  token           text not null unique,                    -- imprevisível: rastreio e descadastro
  campanha_id     uuid references email_campanhas(id) on delete cascade,
  modelo_id       uuid references email_modelos(id) on delete set null,
  conta_id        uuid references email_contas(id) on delete set null,
  chave           text unique,                             -- idempotência das automações
  email           text not null,
  nome            text,
  telefone        text,
  conversa_id     uuid,
  unidade         text,
  estado          text not null default 'pendente'
                  check (estado in ('pendente', 'enviando', 'enviado', 'erro', 'bounce', 'cancelado', 'suprimido')),
  tentativas      integer not null default 0,
  proxima_em      timestamptz not null default now(),
  reservada_ate   timestamptz,
  assunto         text,
  links           text[] not null default '{}',
  message_id      text,
  enviado_em      timestamptz,
  aberto_em       timestamptz,
  aberturas       integer not null default 0,
  clicado_em      timestamptz,
  cliques         integer not null default 0,
  respondido_em   timestamptz,
  descadastro_em  timestamptz,
  erro            text,
  criado_em       timestamptz not null default now()
);
create unique index if not exists email_envios_campanha_email on email_envios (campanha_id, lower(email)) where campanha_id is not null;
create index if not exists email_envios_prontos on email_envios (proxima_em) where estado = 'pendente';
create index if not exists email_envios_reservados on email_envios (reservada_ate) where estado = 'enviando';
create index if not exists email_envios_conta_enviado on email_envios (conta_id, enviado_em) where enviado_em is not null;
create index if not exists email_envios_telefone on email_envios (empresa_id, telefone, criado_em desc);
create index if not exists email_envios_email on email_envios (empresa_id, lower(email), criado_em desc);
create index if not exists email_envios_message_id on email_envios (message_id) where message_id is not null;

-- Quem não recebe mais: descadastro, erro permanente (bounce), reclamação ou retirada manual.
create table if not exists email_supressoes (
  empresa_id   text not null,
  email        text not null,                              -- sempre minúsculo
  motivo       text not null check (motivo in ('descadastro', 'bounce', 'reclamacao', 'manual')),
  detalhe      text,
  envio_id     bigint,
  em           timestamptz not null default now(),
  primary key (empresa_id, email)
);

-- Histórico: aberturas, cliques, respostas, bounces, descadastros (ficha da cliente e relatórios).
create table if not exists email_eventos (
  id          bigserial primary key,
  empresa_id  text not null,
  envio_id    bigint references email_envios(id) on delete cascade,
  tipo        text not null check (tipo in ('enviado', 'aberto', 'clicado', 'respondeu', 'bounce', 'descadastro', 'erro')),
  detalhe     text,
  em          timestamptz not null default now()
);
create index if not exists email_eventos_envio on email_eventos (envio_id, em);
