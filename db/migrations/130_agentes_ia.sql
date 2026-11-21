-- Estúdio de agentes de IA: vários agentes, cada um com persona, regras, exemplos, conhecimento e memória.

create table if not exists sintonia.agentes_ia (
  id             uuid primary key,
  empresa_id     text not null,
  nome           text not null,
  avatar         text not null default '✦',
  unidades       text[] not null default '{}',
  provedor       text not null default 'anthropic',
  modelo         text not null default 'claude-opus-5-5',
  -- Chave própria do agente, cifrada pelo Cofre (vazia = usa a chave geral de Conexões).
  chave_cifrada  text,
  -- 0 = formal, 100 = descontraída.
  criatividade   integer not null default 50,
  -- persona, regras, padrões, exemplos, ferramentas, passagem, usarBaseGeral (validado no código).
  config         jsonb not null default '{}'::jsonb,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);
create index if not exists agentes_ia_empresa on sintonia.agentes_ia (empresa_id);

-- Base de conhecimento própria de cada agente (textos, perguntas e respostas, links importados, arquivos).
create table if not exists sintonia.agentes_ia_conhecimento (
  id         uuid primary key,
  agente_id  uuid not null references sintonia.agentes_ia (id) on delete cascade,
  tipo       text not null,
  titulo     text not null,
  conteudo   text not null default '',
  origem     text,
  criado_em  timestamptz not null default now(),
  criado_por text
);
create index if not exists agentes_ia_conhecimento_agente on sintonia.agentes_ia_conhecimento (agente_id);

-- Memória por cliente: fatos que a IA aprende (tipo de cabelo, última química, horário preferido, objeções).
create table if not exists sintonia.memoria_cliente (
  empresa_id    text not null,
  telefone      text not null,
  chave         text not null,
  valor         text not null,
  agente_id     uuid,
  conversa_id   uuid,
  fonte         text not null default 'ia',
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, telefone, chave)
);

-- Memória do agente: aprendizados vindos das correções da equipe, que a gestão aprova.
create table if not exists sintonia.agentes_ia_aprendizados (
  id           uuid primary key,
  agente_id    uuid not null references sintonia.agentes_ia (id) on delete cascade,
  texto        text not null,
  origem       jsonb not null default '{}'::jsonb,
  situacao     text not null default 'pendente',
  criado_em    timestamptz not null default now(),
  decidido_por text,
  decidido_em  timestamptz
);
create index if not exists agentes_ia_aprendizados_agente on sintonia.agentes_ia_aprendizados (agente_id, situacao);

-- Qual agente está no controle de cada conversa (IA atende primeiro, bot, "devolver para a IA").
create table if not exists sintonia.conversa_agente_ia (
  conversa_id uuid primary key,
  agente_id   uuid not null references sintonia.agentes_ia (id) on delete cascade,
  desde       timestamptz not null default now(),
  motivo      text not null default 'ia_primeiro'
);

-- "IA atende primeiro" por unidade e horário (um registro por empresa).
create table if not exists sintonia.ia_controle (
  empresa_id    text primary key,
  config        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);

-- Comandos da gestão para a IA ("mova para Interessada quem pediu preço hoje"): plano, prévia, confirmação e auditoria.
create table if not exists sintonia.ia_comandos (
  id           uuid primary key,
  empresa_id   text not null,
  texto        text not null,
  plano        jsonb not null,
  situacao     text not null default 'planejado',
  por          text not null,
  por_id       text,
  criado_em    timestamptz not null default now(),
  executado_em timestamptz,
  resultado    jsonb
);
create index if not exists ia_comandos_empresa on sintonia.ia_comandos (empresa_id, criado_em desc);
