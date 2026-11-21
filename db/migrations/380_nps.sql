-- Finalizar atendimento e pesquisa de satisfação (NPS). Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Configuração da pesquisa (textos, ligada, motivos, link de avaliação): JSON validado pela aplicação.
create table if not exists nps_config (
  empresa_id     text primary key,
  config         jsonb not null default '{}',
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);

-- Cada atendimento finalizado (motivo, quem atendeu, quem finalizou).
create table if not exists atendimentos_finalizados (
  id             uuid primary key,
  empresa_id     text not null,
  conversa_id    uuid not null,
  unidade        text not null,
  motivo         text not null,
  observacao     text,
  atendente_id   text,
  atendente_nome text,
  por_id         text,
  por_nome       text not null,
  em             timestamptz not null
);
create index if not exists atendimentos_finalizados_periodo on atendimentos_finalizados (empresa_id, em);
create index if not exists atendimentos_finalizados_conversa on atendimentos_finalizados (conversa_id, em desc);

-- Cada pesquisa enviada e a resposta (nota 0–10 e comentário).
create table if not exists nps_pesquisas (
  id              uuid primary key,
  empresa_id      text not null,
  conversa_id     uuid not null,
  finalizacao_id  uuid,
  unidade         text not null,
  atendente_id    text,
  atendente_nome  text,
  motivo          text,
  estado          text not null check (estado in ('aguardando_nota', 'aguardando_comentario', 'respondida', 'expirada', 'nao_enviada')),
  enviada_em      timestamptz not null,
  expira_em       timestamptz not null,
  nota            integer check (nota between 0 and 10),
  comentario      text,
  respondida_em   timestamptz,
  detalhe         text
);
create index if not exists nps_pesquisas_abertas on nps_pesquisas (conversa_id) where estado in ('aguardando_nota', 'aguardando_comentario');
create index if not exists nps_pesquisas_vencendo on nps_pesquisas (expira_em) where estado in ('aguardando_nota', 'aguardando_comentario');
create index if not exists nps_pesquisas_enviadas on nps_pesquisas (empresa_id, enviada_em);
create index if not exists nps_pesquisas_respondidas on nps_pesquisas (empresa_id, respondida_em) where nota is not null;
