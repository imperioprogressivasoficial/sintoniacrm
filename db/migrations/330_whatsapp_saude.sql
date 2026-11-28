-- Saúde do WhatsApp não oficial (Evolution): estado de cada canal (conectado, desconectado, tentativas de
-- reconexão, última mensagem recebida) e do servidor ("__servidor__"). Sobrevive a reinícios, para não
-- repetir avisos de uma queda que já foi avisada. Ver src/channels/whatsapp-saude.ts.
set local search_path to sintonia;

create table if not exists whatsapp_saude (
  canal_id      text primary key,
  dados         jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
