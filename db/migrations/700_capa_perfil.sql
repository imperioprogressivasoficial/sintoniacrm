-- capa-perfil (dono 21/11): foto de capa que a própria pessoa manda para o topo de Configurações / Conta.
-- Já reduzida pela tela (~1200 px, até 400 KB). As 5 capas prontas ficam em public/capas/ (não vêm para o banco).
-- A escolha (praia, montanha, ..., nenhuma, minha) e os atalhos ficam em perfis_usuario.preferencias.
set local search_path to sintonia;

create table if not exists usuario_capas (
  usuario_id     uuid primary key references usuarios(id) on delete cascade,
  conteudo       bytea not null,
  tipo           text not null,
  atualizada_em  timestamptz not null default now()
);
