-- CRM em escala (dezenas de milhares de leads por mês):
-- - quadro: colunas paginadas por etapa, ordenadas pela última atividade (atualizada_em desc, id);
-- - busca do quadro por nome (trigramas) e por dígitos do telefone;
-- - valor do negócio no cartão do CRM.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Índices que o quadro já usa e continuam valendo: conversa_tags_quadro (funil_id, tag_id, marcada_em)
-- para os cartões de cada coluna e conversas_recentes (empresa_id, atualizada_em desc).

-- Busca: trigramas no nome e no telefone (ilike '%texto%' usa o índice). Sem a extensão, a busca
-- continua funcionando, só sem índice.
do $$
begin
  create extension if not exists pg_trgm with schema public;
  execute 'create index if not exists conversas_nome_trgm on sintonia.conversas using gin (nome public.gin_trgm_ops)';
  execute 'create index if not exists conversas_telefone_trgm on sintonia.conversas using gin (telefone public.gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm indisponível (%): a busca do CRM roda sem índice de trigramas', sqlerrm;
end $$;

-- Valor do negócio (R$) de cada cliente no CRM. Separado da conversa: só existe quando alguém preenche.
create table if not exists cartao_valores (
  conversa_id     uuid primary key references conversas(id) on delete cascade,
  valor           numeric(12, 2) not null check (valor >= 0),
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);
