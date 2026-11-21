-- Notificações da equipe (sino do app e push no celular/computador).
-- Uma linha por pessoa: a mesma novidade vira uma notificação para cada pessoa que pode ver a conversa.
set local search_path to sintonia;

create table notificacoes (
  id            uuid primary key,
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  tipo          text not null,
  titulo        text not null,
  texto         text not null default '',
  conversa_id   uuid references conversas(id) on delete cascade,
  -- Tela do app que a notificação abre quando não é de uma conversa (ex.: conexoes, ligacoes).
  vista         text,
  -- Mensagens em rajada viram uma notificação só: quantas já foram juntadas nela.
  contador      integer not null default 1,
  -- Evita repetir a mesma notificação (falha: uma por hora; lembrete e espera: uma por ocorrência).
  chave         text,
  -- Pode estar no futuro (lembrete de ligação marcado para mais tarde): só aparece a partir daí.
  criada_em     timestamptz not null,
  atualizada_em timestamptz not null,
  lida_em       timestamptz,
  -- Quando o push saiu (ou foi dispensado). Nulo = ainda não entregue.
  entregue_em   timestamptz
);
-- Lista do sino (mais nova primeiro) e "não lidas da pessoa".
create index notificacoes_lista on notificacoes (usuario_id, atualizada_em desc, id desc);
create index notificacoes_nao_lidas on notificacoes (usuario_id, atualizada_em desc) where lida_em is null;
-- Agrupamento das mensagens em rajada: a não lida da mesma conversa.
create index notificacoes_grupo on notificacoes (usuario_id, conversa_id, tipo) where lida_em is null;
create index notificacoes_chave on notificacoes (usuario_id, chave, criada_em desc) where chave is not null;
-- Push que ainda falta mandar (lembretes marcados para mais tarde).
create index notificacoes_a_entregar on notificacoes (criada_em) where entregue_em is null;

-- Preferências de cada pessoa (tipos, som, push, não perturbe).
create table notificacao_preferencias (
  usuario_id    uuid primary key references usuarios(id) on delete cascade,
  dados         jsonb not null,
  atualizada_em timestamptz not null default now()
);

-- Aparelhos inscritos no push (Web Push). Um endpoint é de um navegador de um aparelho.
create table push_inscricoes (
  endpoint      text primary key,
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  p256dh        text not null,
  auth          text not null,
  agente        text,
  criada_em     timestamptz not null default now(),
  usada_em      timestamptz
);
create index push_inscricoes_usuario on push_inscricoes (usuario_id);

-- Chaves VAPID do servidor (geradas uma vez; a privada vai cifrada pelo Cofre).
create table push_config (
  chave     text primary key,
  valor     text not null,
  criado_em timestamptz not null default now()
);
