-- relatorio-dia: relatórios automáticos pelo WhatsApp (a Serena como gerente de vendas).
-- A configuração (ligado, quem recebe e quais relatórios, horários, por qual número sai) fica numa linha por empresa.
-- Cada envio fica registrado com a chave única (empresa, relatório, referência, destinatário): com mais de um
-- processo rodando, só um consegue gravar a linha e enviar — o mesmo relatório nunca sai duas vezes para ninguém.
set local search_path to sintonia;

create table if not exists relatorio_envio_config (
  empresa_id      text primary key,
  dados           jsonb not null default '{}'::jsonb,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);

create table if not exists relatorio_envios (
  id            uuid primary key,
  empresa_id    text not null,
  -- agenda | fechamento | semanal | mensal | teste
  relatorio     text not null,
  -- Dia (AAAA-MM-DD), segunda da semana (AAAA-MM-DD) ou mês (AAAA-MM); no teste, o minuto.
  referencia    text not null,
  -- "grupo:<id do grupo>" ou "numero:<só dígitos>": um grupo conta como um destinatário.
  destino       text not null,
  destino_nome  text,
  situacao      text not null default 'enviando' check (situacao in ('enviando', 'enviado', 'falhou', 'pulado')),
  erro          text,
  tentativas    integer not null default 1,
  texto         text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, relatorio, referencia, destino)
);
create index if not exists relatorio_envios_recentes on relatorio_envios (empresa_id, criado_em desc);
