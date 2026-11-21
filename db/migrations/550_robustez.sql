-- robustez (auditoria de 20/11): lista de Conversas leve com muito histórico, busca no servidor e histórico do
-- WhatsApp importado em lotes que sobrevivem a reinício. Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Última mensagem de cada conversa da página (LATERAL ... order by em desc, id desc limit 1): uma busca no índice
-- por conversa, em vez de ler e ordenar todas as mensagens a cada atualização da lista (antes: 250-280 ms com
-- 204 mil mensagens, ordenação de 28 MB em disco, crescendo junto com o histórico).
create index if not exists mensagens_ultima on mensagens (conversa_id, em desc, id desc);

-- Rolagem da lista por cursor (atualizada_em, id), da mais recente para a mais antiga.
create index if not exists conversas_lista on conversas (atualizada_em desc, id desc);

-- Busca da lista pelo texto das mensagens (ilike '%texto%' usa trigramas). Sem a extensão, a busca funciona sem índice.
do $$
begin
  create extension if not exists pg_trgm with schema public;
  execute 'create index if not exists mensagens_texto_trgm on sintonia.mensagens using gin (texto public.gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm indisponível (%): a busca por texto das mensagens roda sem índice', sqlerrm;
end $$;

-- Histórico do WhatsApp ao conectar (messages.set, até 40 MB): o webhook só grava aqui, em lotes, e responde.
-- Um importador por trás passa para as conversas aos poucos (src/app/historico.ts). Se o app reiniciar no meio,
-- o que falta continua aqui e a importação segue de onde parou (antes ficava em memória e se perdia).
create table if not exists historico_entrada (
  id          bigserial primary key,
  instancia   text not null default '',
  id_externo  text not null unique,
  em          timestamptz not null,
  mensagem    jsonb not null,
  criada_em   timestamptz not null default now()
);
create index if not exists historico_entrada_ordem on historico_entrada (em, id);
