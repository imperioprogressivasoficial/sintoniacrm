-- automacao-vendas: rodízio automático de leads (src/rodizio/rodizio.ts).
-- Configuração por unidade (ligado, regra, quem participa) e o registro de cada distribuição
-- (serve para o rodízio justo: a próxima vez é de quem recebeu há mais tempo).
set local search_path to sintonia;

create table if not exists rodizio_config (
  empresa_id     text not null,
  unidade        text not null,
  ligado         boolean not null default false,
  regra          text not null default 'rodizio' check (regra in ('rodizio', 'carga')),
  participantes  text[] not null default '{}',
  atualizado_em  timestamptz not null default now(),
  atualizado_por text,
  primary key (empresa_id, unidade)
);

create table if not exists rodizio_atribuicoes (
  conversa_id  uuid primary key references conversas(id) on delete cascade,
  empresa_id   text not null,
  unidade      text not null,
  usuario_id   text not null,
  usuario_nome text not null,
  regra        text not null,
  em           timestamptz not null
);
create index if not exists rodizio_atribuicoes_vez on rodizio_atribuicoes (empresa_id, unidade, usuario_id, em desc);
create index if not exists rodizio_atribuicoes_recentes on rodizio_atribuicoes (empresa_id, unidade, em desc);

-- automacao-vendas: gatilho "sem resposta há X tempo" procura conversas pela espera (cliente e equipe).
create index if not exists conversas_ultima_cliente on conversas (empresa_id, ultima_mensagem_cliente);
