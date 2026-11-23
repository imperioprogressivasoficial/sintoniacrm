-- trocar-numero: trocar o WhatsApp de uma loja (canal) por outro número.
-- 1) Arquivo da empresa: conversa arquivada sai da lista, dos contadores, da busca, do Pipeline e dos relatórios
--    para todo mundo (diferente do arquivo pessoal da 510). Dá para consultar e desarquivar depois.
--    Mensagem nova da cliente tira do arquivo sozinha.
-- 2) Número conectado em cada canal (instância da Evolution "sintonia-…"): para saber quando entrou outro número
--    e perguntar o que fazer com as conversas do número anterior.
-- Aditiva: só acrescenta colunas e uma tabela.
set local search_path to sintonia;

alter table conversas add column if not exists arquivada_em timestamptz;
alter table conversas add column if not exists arquivada_motivo text;
create index if not exists conversas_arquivadas on conversas (empresa_id, arquivada_em desc) where arquivada_em is not null;
-- As conversas de um canal (o que entra na troca de número).
create index if not exists conversas_canal on conversas (empresa_id, canal_id, unidade);

create table if not exists whatsapp_numeros (
  canal_id        text primary key,
  empresa_id      text not null,
  unidade         text,
  -- Número conectado agora (só dígitos, com DDI).
  numero          text,
  conectado_em    timestamptz,
  -- Alguém pediu QR Code ou código na tela (conectar de novo): a próxima conexão pode ser outro número.
  pareando_desde  timestamptz,
  -- Troca detectada: quando o número novo conectou (corte) e qual era o anterior (null = não se sabe).
  troca_em        timestamptz,
  numero_anterior text,
  troca_pendente  boolean not null default false,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
