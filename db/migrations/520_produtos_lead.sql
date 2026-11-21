-- produtos-lead: produtos e serviços vinculados ao lead (como no Kommo). Um lead (conversa) pode ter vários itens
-- do cadastro de Empresa › Produtos e serviços, cada um com quantidade, preço do momento e desconto opcional.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

create table if not exists lead_produtos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     text not null,
  conversa_id    uuid not null references conversas(id) on delete cascade,
  -- null = o produto foi apagado do cadastro; o item fica com o nome e o preço de quando entrou
  produto_id     uuid references produtos(id) on delete set null,
  nome           text not null,
  tipo           text not null check (tipo in ('produto', 'servico')),
  categoria      text,
  quantidade     integer not null default 1 check (quantidade between 1 and 9999),
  preco          numeric(12, 2) not null default 0 check (preco >= 0),   -- preço unitário no momento em que entrou
  desconto       numeric(12, 2) not null default 0 check (desconto >= 0), -- em reais, no total da linha
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);
-- o mesmo produto entra uma vez só no lead (adicionar de novo soma a quantidade)
create unique index if not exists lead_produtos_unico on lead_produtos (conversa_id, produto_id) where produto_id is not null;
create index if not exists lead_produtos_conversa on lead_produtos (conversa_id, criado_em);
create index if not exists lead_produtos_produto on lead_produtos (empresa_id, produto_id);

-- Valor do lead calculado pelos produtos: guarda o valor digitado à mão antes (para voltar quando os produtos saem)
-- e a última soma gravada (se alguém mudar o valor à mão depois, a mudança vale como valor digitado).
create table if not exists lead_produtos_valor (
  conversa_id  uuid primary key references conversas(id) on delete cascade,
  valor_manual numeric(12, 2),
  ultima_soma  numeric(12, 2) not null
);

-- Opção da empresa: o valor do lead vira a soma dos produtos quando houver produtos (ligada por padrão).
create table if not exists lead_produtos_config (
  empresa_id      text primary key,
  valor_pela_soma boolean not null default true,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  text
);
