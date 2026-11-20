-- Radar: a equipe coloca uma conversa no radar dizendo o que vigiar ("se ela falar que recebeu o salário",
-- "se não responder até sexta"). A IA confere cada mensagem nova da cliente; prazo vencido também dispara.
-- Ao disparar: avisa quem colocou (sino + push) e, se escolhido, a IA responde.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Uma conversa está no radar no máximo uma vez (tirar do radar apaga a linha; o histórico fica).
create table if not exists radar_conversas (
  conversa_id      uuid primary key,
  empresa_id       text not null,
  vigiar           text not null,
  prazo            timestamptz,
  acao             text not null default 'avisar' check (acao in ('avisar', 'ia')),
  instrucao        text,
  dono_id          text,
  dono_nome        text,
  estado           text not null default 'vigiando' check (estado in ('vigiando', 'disparou')),
  motivo           text,                       -- por que disparou (frase curta da IA, ou "chegou o prazo")
  disparado_em     timestamptz,
  visto_em         timestamptz,
  -- "A IA responde": esperando a resposta sair (pela IA da conversa ou pelo próprio radar).
  resposta         text check (resposta in ('pendente', 'feita', 'nao_saiu')),  -- null = não pediu resposta da IA
  resposta_ate     timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);
create index if not exists radar_conversas_empresa on radar_conversas (empresa_id);
create index if not exists radar_conversas_prazo on radar_conversas (prazo) where estado = 'vigiando' and prazo is not null;
create index if not exists radar_conversas_resposta on radar_conversas (resposta_ate) where resposta = 'pendente';

-- Histórico: quando entrou, quando disparou, o que fez, quando saiu.
create table if not exists radar_historico (
  id           bigserial primary key,
  empresa_id   text not null,
  conversa_id  uuid not null,
  tipo         text not null,
  texto        text not null,
  por          text,
  em           timestamptz not null default now()
);
create index if not exists radar_historico_conversa on radar_historico (conversa_id, em desc);
