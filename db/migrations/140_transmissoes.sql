-- Transmissões (disparo em massa de WhatsApp): campanhas, destinatários (o funil de cada pessoa),
-- descadastros (opt-out), ritmo por número e modelos da API oficial enviados para aprovação.
set local search_path to sintonia;

create table if not exists transmissoes (
  id            uuid primary key,
  empresa_id    text not null,
  nome          text not null,
  unidade       text not null,
  -- 'oficial' = API oficial da Meta com modelo aprovado; 'nao_oficial' = Evolution (QR Code) com texto livre.
  canal         text not null check (canal in ('oficial', 'nao_oficial')),
  status        text not null default 'rascunho'
                check (status in ('rascunho', 'aguardando_modelo', 'agendada', 'enviando', 'pausada', 'concluida', 'cancelada')),
  -- 'manual' = envia agora/agendado para o público escolhido; 'automatico' = cada pessoa entra pelo gatilho.
  modo          text not null default 'manual' check (modo in ('manual', 'automatico')),
  publico       jsonb not null default '{}',
  mensagem      jsonb not null default '{}',
  envio         jsonb not null default '{}',
  agendada_para timestamptz,
  -- Número por onde sai (fixado ao começar): o ritmo é controlado por ele.
  canal_id      text,
  -- Tag marcada em quem responde (criada na primeira resposta).
  tag_id        uuid,
  imagem        bytea,
  imagem_tipo   text,
  imagem_meta   jsonb,
  erro          text,
  criada_por    text,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  iniciada_em   timestamptz,
  concluida_em  timestamptz
);
create index if not exists transmissoes_empresa on transmissoes (empresa_id, criada_em desc);
create index if not exists transmissoes_ativas on transmissoes (status) where status in ('agendada', 'enviando', 'aguardando_modelo');

-- Um destinatário por pessoa por campanha (ciclo: o ano, no aniversário; vazio nas outras): nunca duas vezes.
create table if not exists transmissao_destinos (
  id              bigserial primary key,
  transmissao_id  uuid not null references transmissoes(id) on delete cascade,
  telefone        text not null,
  ciclo           text not null default '',
  conversa_id     uuid,
  nome            text,
  status          text not null default 'fila'
                  check (status in ('fila', 'enviando', 'enviada', 'entregue', 'lida', 'respondeu', 'falhou', 'descadastrou', 'pulada')),
  texto           text,
  id_externo      text,
  erro            text,
  origem          text,
  entrou_em       timestamptz not null default now(),
  enviar_apos     timestamptz not null default now(),
  reservada_em    timestamptz,
  enviada_em      timestamptz,
  entregue_em     timestamptz,
  lida_em         timestamptz,
  respondeu_em    timestamptz,
  falhou_em       timestamptz,
  unique (transmissao_id, telefone, ciclo)
);
create index if not exists transmissao_destinos_fila on transmissao_destinos (transmissao_id, id) where status = 'fila';
create index if not exists transmissao_destinos_tel on transmissao_destinos (telefone, enviada_em desc);
create index if not exists transmissao_destinos_ext on transmissao_destinos (id_externo) where id_externo is not null;

-- Quem pediu para sair ("SAIR", "PARAR"...): nunca mais entra em transmissão.
create table if not exists transmissao_optout (
  empresa_id  text not null,
  telefone    text not null,
  em          timestamptz not null default now(),
  motivo      text,
  primary key (empresa_id, telefone)
);

-- Ritmo por número: quando o próximo envio pode sair e quantos já saíram em sequência (pausa a cada N).
create table if not exists transmissao_ritmo (
  canal_id    text primary key,
  proximo_em  timestamptz not null default now(),
  seguidos    integer not null default 0,
  dia         date,
  no_dia      integer not null default 0
);

-- Modelos da API oficial criados pela tela (e os que já existiam na WABA, ao sincronizar).
create table if not exists transmissao_modelos (
  id            uuid primary key,
  empresa_id    text not null,
  unidade       text not null,
  nome          text not null,
  idioma        text not null default 'pt_BR',
  categoria     text not null,
  componentes   jsonb not null default '[]',
  status        text not null default 'pendente',
  motivo        text,
  meta_id       text,
  criado_por    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, unidade, nome, idioma)
);
