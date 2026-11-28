-- meta-historico: conversas antigas do Instagram (Direct) e do Facebook (Messenger) ao conectar.
-- Uma linha por rede com o andamento: onde a leitura parou na Graph API da Meta (cursor da página seguinte),
-- quantas conversas e mensagens já entraram e se terminou ou deu erro. Se o app reiniciar no meio,
-- a importação continua do cursor guardado (src/conexoes/historico-meta.ts). Aditiva: só cria a tabela.
set local search_path to sintonia;

create table if not exists meta_historico (
  rede          text primary key check (rede in ('messenger', 'instagram')),
  situacao      text not null check (situacao in ('rodando', 'pronto', 'erro')),
  conta_id      text not null default '',
  cursor        text,
  paginas       integer not null default 0,
  lidas         integer not null default 0,
  conversas     integer not null default 0,
  mensagens     integer not null default 0,
  corte         timestamptz not null,
  erro          text,
  iniciado_em   timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  terminado_em  timestamptz
);
