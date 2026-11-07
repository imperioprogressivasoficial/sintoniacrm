-- Gestão de acessos: permissões por perfil (papel) e por pessoa, convites, sessões e auditoria.
set local search_path to sintonia;

-- Ajustes da empresa sobre o perfil padrão de cada papel (só o que difere do padrão).
create table acesso_perfis (
  empresa_id  text not null,
  papel       text not null check (papel in ('atendente', 'recepcionista', 'gerente', 'direcao', 'admin')),
  permissoes  jsonb not null default '{}',
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, papel)
);

-- Por pessoa: ajustes de permissão, troca de senha obrigatória, horário permitido e último acesso.
create table acesso_usuarios (
  usuario_id     uuid primary key references usuarios(id) on delete cascade,
  permissoes     jsonb not null default '{}',
  trocar_senha   boolean not null default false,
  horario        jsonb,
  ultimo_acesso  timestamptz
);

-- Aparelho e uso de cada sessão (para a lista de sessões ativas com "desconectar").
alter table sessoes
  add column aparelho text,
  add column ip text,
  add column usada_em timestamptz;

-- Links de convite e de redefinição de senha: só o resumo do token fica guardado.
create table acesso_convites (
  token_hash  text primary key,
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  tipo        text not null check (tipo in ('convite', 'redefinir')),
  criado_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  usado_em    timestamptz
);
create index acesso_convites_usuario on acesso_convites (usuario_id);

-- Quem mudou o quê.
create table acesso_auditoria (
  id          bigserial primary key,
  empresa_id  text not null,
  autor_id    uuid,
  autor_nome  text not null,
  alvo_id     uuid,
  alvo_nome   text,
  acao        text not null,
  detalhe     text,
  em          timestamptz not null default now()
);
create index acesso_auditoria_empresa on acesso_auditoria (empresa_id, em desc);
