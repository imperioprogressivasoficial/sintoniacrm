-- Rastreamento de leads: de onde cada conversa veio (anúncio de clique para WhatsApp, link rastreado,
-- orgânico, indicação), links rastreados com os cliques, nomes dos anúncios (cache da Graph API)
-- e a fila de eventos da API de Conversões da Meta (CAPI).
set local search_path to sintonia;

-- Links rastreados: /l/<codigo> grava o clique e manda para o wa.me da unidade com "(ref: XXXXX)".
create table links_rastreados (
  id            uuid primary key,
  empresa_id    text not null,
  codigo        text not null,
  nome          text not null,
  unidade       text not null,
  numero        text not null,
  mensagem      text not null,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  ativo         boolean not null default true,
  criado_por    text,
  criado_em     timestamptz not null default now()
);
create unique index links_rastreados_codigo on links_rastreados (lower(codigo));

-- Cada clique ganha um código curto (o "ref" que vai na mensagem) para ligar a conversa ao clique exato.
create table cliques_link (
  id            uuid primary key,
  link_id       uuid not null references links_rastreados(id) on delete cascade,
  ref           text not null unique,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  fbclid        text,
  gclid         text,
  user_agent    text,
  referencia    text,
  em            timestamptz not null default now(),
  conversa_id   uuid references conversas(id) on delete set null
);
create index cliques_link_link on cliques_link (link_id, em desc);

-- Origem por conversa: "primeiro" toque (fixo) e "ultimo" toque (atualiza a cada anúncio/link novo).
create table origens_lead (
  conversa_id        uuid not null references conversas(id) on delete cascade,
  toque              text not null check (toque in ('primeiro', 'ultimo')),
  canal              text not null check (canal in ('anuncio_meta', 'link', 'organico', 'indicacao', 'outro')),
  fonte              text,
  origem_por         text not null default 'automatico' check (origem_por in ('automatico', 'ia', 'equipe')),
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  utm_content        text,
  utm_term           text,
  campaign_id        text,
  campaign_nome      text,
  adset_id           text,
  adset_nome         text,
  ad_id              text,
  ad_nome            text,
  anuncio_titulo     text,
  anuncio_texto      text,
  anuncio_midia_tipo text,
  anuncio_midia_url  text,
  anuncio_miniatura  text,
  anuncio_url        text,
  anuncio_tipo       text,
  ctwa_clid          text,
  fbclid             text,
  gclid              text,
  link_id            uuid,
  clique_id          uuid,
  codigo             text,
  indicado_por       text,
  detalhe            text,
  primeira_mensagem  text,
  em                 timestamptz not null,
  atualizado_em      timestamptz not null default now(),
  primary key (conversa_id, toque)
);
create index origens_lead_ad on origens_lead (ad_id) where ad_id is not null;

-- Análise de origem pela IA em segundo plano: uma vez por conversa.
create table origem_ia (
  conversa_id  uuid primary key references conversas(id) on delete cascade,
  situacao     text not null default 'pendente' check (situacao in ('pendente', 'feita', 'erro')),
  tentativas   integer not null default 0,
  resultado    jsonb,
  em           timestamptz not null default now()
);

-- Nomes de anúncio/conjunto/campanha lidos da Graph API (cache).
create table anuncios_meta (
  ad_id          text primary key,
  ad_nome        text,
  adset_id       text,
  adset_nome     text,
  campaign_id    text,
  campaign_nome  text,
  erro           text,
  atualizado_em  timestamptz not null default now()
);

-- Fila e registro dos eventos enviados à API de Conversões da Meta.
create table capi_eventos (
  id             bigserial primary key,
  event_id       text not null unique,
  conversa_id    uuid references conversas(id) on delete set null,
  nome           text not null,
  chave          text not null,
  payload        jsonb not null,
  situacao       text not null default 'pendente' check (situacao in ('pendente', 'enviado', 'erro', 'desistiu')),
  tentativas     integer not null default 0,
  proxima_em     timestamptz not null default now(),
  resposta       text,
  teste          boolean not null default false,
  criado_em      timestamptz not null default now(),
  enviado_em     timestamptz
);
create index capi_eventos_pendentes on capi_eventos (proxima_em) where situacao = 'pendente';
create index capi_eventos_recentes on capi_eventos (criado_em desc);
