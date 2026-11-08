-- Tela "Ligações" (como a aba Ligações do WhatsApp): histórico de chamadas, favoritos e limpeza por pessoa.
-- Só o que é real: "efetuada" quando alguém toca em Ligar no app (a ligação sai do celular; não há VoIP),
-- "recebida"/"perdida" quando o WhatsApp (Evolution, evento CALL) avisa. Sem duração inventada.
set local search_path to sintonia;

create table if not exists chamadas (
  id              uuid primary key,
  empresa_id      text not null,
  conversa_id     uuid references conversas(id) on delete cascade,
  telefone        text not null,
  direcao         text not null check (direcao in ('efetuada', 'recebida', 'perdida')),
  -- resultado informado depois (atendeu, nao_atendeu, agendou, caixa_postal) ou o status do WhatsApp
  resultado       text,
  atendente_id    uuid,
  atendente_nome  text,
  unidade         text,
  em              timestamptz not null,
  origem          text not null default 'app' check (origem in ('app', 'whatsapp', 'demo')),
  id_externo      text,
  criada_em       timestamptz not null default now()
);
create index if not exists chamadas_recentes on chamadas (empresa_id, em desc, id desc);
create index if not exists chamadas_conversa on chamadas (conversa_id);
create unique index if not exists chamadas_externo on chamadas (empresa_id, id_externo) where id_externo is not null;

create table if not exists contatos_favoritos (
  usuario_id   uuid not null,
  conversa_id  uuid not null references conversas(id) on delete cascade,
  criado_em    timestamptz not null default now(),
  primary key (usuario_id, conversa_id)
);

-- "Limpar histórico" de cada pessoa: esconde o que veio antes (não apaga para a equipe).
create table if not exists chamadas_limpeza (
  usuario_id  uuid primary key,
  ate         timestamptz not null
);
