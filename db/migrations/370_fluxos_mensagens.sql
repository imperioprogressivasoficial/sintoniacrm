-- Fluxos de mensagens (Respostas rápidas › Fluxos): uma sequência de passos (texto, áudio, foto, vídeo, documento)
-- com espera entre eles e "digitando…/gravando áudio…" antes. A atendente escolhe na conversa e o servidor envia sozinho.
set local search_path to sintonia;

-- O modelo do fluxo. usuario_id vazio = da empresa (a gestão cuida); preenchido = pessoal de quem criou.
create table fluxos_mensagens (
  id                  uuid primary key,
  empresa_id          text not null,
  usuario_id          uuid references usuarios(id) on delete cascade,
  atalho              text not null,
  nome                text not null,
  -- [{ id, tipo, texto, midiaId, esperaSeg, presenca }]
  passos              jsonb not null default '[]',
  -- Se a cliente responder no meio: 'continuar' ou 'parar'.
  se_cliente_responder text not null default 'parar',
  criada_por          text,
  atualizada_em       timestamptz not null default now()
);
create unique index fluxos_mensagens_empresa on fluxos_mensagens (empresa_id, atalho) where usuario_id is null;
create unique index fluxos_mensagens_pessoal on fluxos_mensagens (empresa_id, usuario_id, atalho) where usuario_id is not null;

-- Arquivos dos passos (áudio gravado, foto, vídeo, documento). Até 16 MB cada (limite do WhatsApp).
create table fluxo_midias (
  id         uuid primary key,
  empresa_id text not null,
  nome       text,
  mimetype   text not null,
  tamanho    integer not null,
  conteudo   bytea not null,
  criado_em  timestamptz not null default now()
);
create index fluxo_midias_empresa on fluxo_midias (empresa_id, criado_em);

-- Cada vez que um fluxo é disparado numa conversa: a fila persistente dos passos (sobrevive a reinício do servidor).
create table fluxo_envios (
  id                   uuid primary key,
  empresa_id           text not null,
  conversa_id          uuid not null references conversas(id) on delete cascade,
  fluxo_id             uuid,
  nome                 text not null,
  -- Cópia dos passos na hora do disparo: editar o fluxo depois não muda o que já está saindo.
  passos               jsonb not null,
  se_cliente_responder text not null,
  -- Índice do próximo passo (0 = primeiro). Igual ao total = acabou.
  passo                integer not null default 0,
  -- 'presenca' = falta mostrar "digitando…"; 'enviar' = falta enviar o passo.
  fase                 text not null default 'enviar',
  proximo_em           timestamptz not null,
  situacao             text not null default 'andando', -- andando | concluido | parado | erro
  motivo               text,
  iniciado_por         text not null,
  iniciado_por_id      text,
  iniciado_em          timestamptz not null default now(),
  reservado_ate        timestamptz,
  atualizado_em        timestamptz not null default now()
);
create index fluxo_envios_fila on fluxo_envios (proximo_em) where situacao = 'andando';
create index fluxo_envios_conversa on fluxo_envios (conversa_id, iniciado_em desc);
-- Um fluxo por vez em cada conversa.
create unique index fluxo_envios_um_por_conversa on fluxo_envios (conversa_id) where situacao = 'andando';
