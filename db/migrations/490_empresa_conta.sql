-- empresa-conta: menu Empresa (dados, unidades, produtos e serviços, tabelas de preço, documentos) e Conta (perfil da pessoa).
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Dados da empresa além do nome: CNPJ, razão social, endereço, contato, fuso, horário de funcionamento e a logo.
alter table empresas add column if not exists dados jsonb not null default '{}'::jsonb;
alter table empresas add column if not exists logo bytea;
alter table empresas add column if not exists logo_tipo text;
alter table empresas add column if not exists logo_em timestamptz;

-- Unidades (lojas, filiais). O id é curto e fixo ('norte', 'sumare'... ou um apelido gerado do nome):
-- é o mesmo que as conversas e as pessoas guardam. Quando a empresa ainda não tem nenhuma, o servidor
-- cria as que o sistema já conhecia, para nada mudar de nome sem querer.
create table if not exists unidades (
  empresa_id    text not null,
  id            text not null,
  nome          text not null,
  dados         jsonb not null default '{}'::jsonb,   -- endereço, telefone, e-mail, horário
  ativa         boolean not null default true,
  ordem         integer not null default 0,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  atualizada_por text,
  primary key (empresa_id, id)
);

-- Produtos e serviços da empresa (o que ela vende). preco null = "sob consulta".
create table if not exists produtos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    text not null,
  nome          text not null,
  chave         text not null,                         -- nome sem acento e em minúsculas (não repete na empresa)
  tipo          text not null check (tipo in ('produto', 'servico')),
  categoria     text,
  preco         numeric(12, 2),
  duracao_min   integer,
  descricao     text,
  codigo        text,
  ativo         boolean not null default true,
  origem        text,                                  -- 'comercial' = veio da tabela de preços antiga do Comercial
  foto          bytea,
  foto_tipo     text,
  foto_em       timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  unique (empresa_id, chave)
);
create index if not exists produtos_empresa on produtos (empresa_id, ativo, tipo);

-- Tabelas de preço: preços diferentes do preço base (promoção, unidade, parceiro).
create table if not exists tabelas_preco (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    text not null,
  nome          text not null,
  descricao     text,
  unidade       text,                                  -- null = vale para todas
  ativa         boolean not null default true,
  inicio        date,
  fim           date,
  criada_em     timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  atualizada_por text
);
create index if not exists tabelas_preco_empresa on tabelas_preco (empresa_id);

create table if not exists tabela_preco_itens (
  tabela_id   uuid not null references tabelas_preco(id) on delete cascade,
  produto_id  uuid not null references produtos(id) on delete cascade,
  preco       numeric(12, 2) not null,
  primary key (tabela_id, produto_id)
);

-- Documentos da empresa (contrato, tabela, catálogo em PDF...). O arquivo fica no banco, como as mídias das conversas.
create table if not exists documentos_empresa (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    text not null,
  nome          text not null,
  categoria     text not null default 'outro',
  descricao     text,
  visivel       text not null default 'equipe' check (visivel in ('equipe', 'gestao')),
  mimetype      text not null,
  tamanho       integer not null,
  conteudo      bytea not null,
  enviado_por   text,
  enviado_em    timestamptz not null default now()
);
create index if not exists documentos_empresa_lista on documentos_empresa (empresa_id, enviado_em desc);

-- Perfil de cada pessoa (Conta): telefone, assinatura das mensagens e preferências da área de trabalho.
create table if not exists perfis_usuario (
  usuario_id    uuid primary key references usuarios(id) on delete cascade,
  telefone      text,
  assinatura    jsonb not null default '{}'::jsonb,
  preferencias  jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- A tabela de preços antiga do Comercial já foi copiada para Produtos e serviços? (só uma vez, sozinho;
-- depois disso, apagar um produto não o traz de volta).
alter table empresas add column if not exists produtos_importados_em timestamptz;
