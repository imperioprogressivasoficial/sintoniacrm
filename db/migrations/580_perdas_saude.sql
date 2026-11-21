-- perdas-saude: motivo de perda obrigatório no Pipeline, relatório de perdas e o painel de saúde da gestão.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Lista de motivos de perda de cada empresa (preço, sem horário, sumiu, concorrência, outro…): JSON validado pela aplicação.
create table if not exists perdas_config (
  empresa_id     text primary key,
  config         jsonb not null default '{}',
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);

-- Cada vez que um lead foi para uma etapa de perda (de qualquer funil): o motivo, de que etapa saiu, quem atendia,
-- quem marcou e se foi automático (IA, follow-ups esgotados, automação). Os nomes ficam copiados (renomear depois
-- não muda o passado).
create table if not exists perdas (
  id              uuid primary key,
  empresa_id      text not null,
  conversa_id     uuid not null,
  funil_id        uuid not null,
  etapa_id        uuid,
  de_etapa_id     uuid,
  de_etapa_nome   text,
  motivo          text not null,
  motivo_nome     text not null,
  detalhe         text,
  automatico      boolean not null default false,
  atendente_id    text,
  atendente_nome  text,
  por_id          text,
  por_nome        text not null,
  unidade         text not null,
  em              timestamptz not null
);
create index if not exists perdas_periodo on perdas (empresa_id, em);
create index if not exists perdas_conversa on perdas (conversa_id, funil_id, em desc);

-- Painel de saúde: tempo até a mensagem aparecer (mensagens concluídas nas últimas horas) e mídias que falharam.
create index if not exists entrada_feitas on entrada (feita_em) where status = 'feita';
create index if not exists midias_falhas on midias (criada_em) where situacao = 'falhou';
