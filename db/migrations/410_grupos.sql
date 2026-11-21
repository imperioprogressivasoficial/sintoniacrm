-- Conversas de grupo: os grupos do WhatsApp (API não oficial) em tabelas próprias.
-- Grupo NÃO é conversa de cliente: sem IA, funil, alarme, "esperando resposta" nem automações.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

create table if not exists grupos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    text not null,
  canal_id      text not null,                 -- instância da Evolution que recebe o grupo
  unidade       text not null,                 -- unidade do número (quem vê segue a regra das conversas)
  jid           text not null,                 -- "1203...@g.us"
  nome          text,
  participantes integer,
  foto          bytea,
  foto_tipo     text,
  info_em       timestamptz,                   -- quando nome e foto foram lidos da Evolution (cache)
  ultima_em     timestamptz,
  criado_em     timestamptz not null default now(),
  unique (empresa_id, canal_id, jid)
);
create index if not exists grupos_recentes on grupos (empresa_id, ultima_em desc nulls last);

create table if not exists grupo_mensagens (
  id                uuid primary key default gen_random_uuid(),
  grupo_id          uuid not null references grupos(id) on delete cascade,
  id_externo        text not null,
  autor             text not null check (autor in ('equipe', 'participante')),
  participante      text,                      -- número de quem mandou (só dígitos), quando o WhatsApp informa
  participante_jid  text,
  participante_nome text,                      -- nome do perfil (pushName)
  autor_nome        text,                      -- equipe: quem enviou pela Sintonia, ou "celular da loja"
  usuario_id        text,
  texto             text not null,
  anexo             jsonb,
  midia             bytea,
  historico         boolean not null default false,  -- veio do histórico (não conta como não lida)
  em                timestamptz not null,
  criado_em         timestamptz not null default now(),
  unique (grupo_id, id_externo)
);
create index if not exists grupo_mensagens_recentes on grupo_mensagens (grupo_id, em desc);

-- Até onde cada pessoa leu cada grupo (não lidas por pessoa).
create table if not exists grupo_leituras (
  usuario_id text not null,
  grupo_id   uuid not null references grupos(id) on delete cascade,
  lida_ate   timestamptz not null,
  primary key (usuario_id, grupo_id)
);
