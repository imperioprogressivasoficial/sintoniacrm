-- menu-mensagem: o que dá para fazer ao segurar uma mensagem da conversa (como no WhatsApp do iPhone).
-- Reações (de quem atende e da cliente), favoritas por pessoa, mensagem fixada no topo da conversa e o que
-- aconteceu com cada mensagem (respondida citando outra, editada, apagada). Nada aqui apaga mensagem do banco:
-- "apagar" só marca, para o histórico continuar inteiro.
-- Escrita para poder rodar de novo sem estragar nada.
set local search_path to sintonia;

-- Uma reação por pessoa por mensagem (trocar o emoji substitui; tirar apaga a linha).
-- quem: 'cliente' (veio pelo WhatsApp), 'loja' (reagiu pelo celular da loja) ou 'u:<id da pessoa>' (pela Sintonia).
create table if not exists mensagem_reacoes (
  mensagem_id  uuid not null references mensagens(id) on delete cascade,
  conversa_id  uuid not null references conversas(id) on delete cascade,
  quem         text not null,
  nome         text,
  emoji        text not null,
  em           timestamptz not null default now(),
  primary key (mensagem_id, quem)
);
create index if not exists mensagem_reacoes_conversa on mensagem_reacoes (conversa_id);

-- Mensagens favoritas (estrela), por pessoa.
create table if not exists mensagem_favoritas (
  usuario_id   text not null,
  mensagem_id  uuid not null references mensagens(id) on delete cascade,
  conversa_id  uuid not null references conversas(id) on delete cascade,
  em           timestamptz not null default now(),
  primary key (usuario_id, mensagem_id)
);
create index if not exists mensagem_favoritas_conversa on mensagem_favoritas (conversa_id, usuario_id);

-- Uma mensagem fixada por conversa (faixa no topo).
create table if not exists conversa_fixada (
  conversa_id  uuid primary key references conversas(id) on delete cascade,
  mensagem_id  uuid not null references mensagens(id) on delete cascade,
  por          text,
  em           timestamptz not null default now()
);

-- O que aconteceu com a mensagem: citou outra (resposta), foi editada, foi apagada.
-- apagada: 'todos' (apagada no WhatsApp também), 'aqui' (só some na Sintonia) ou 'cliente' (a cliente apagou).
create table if not exists mensagem_extras (
  mensagem_id     uuid primary key references mensagens(id) on delete cascade,
  conversa_id     uuid not null references conversas(id) on delete cascade,
  citada_id       uuid references mensagens(id) on delete set null,
  apagada         text check (apagada in ('todos', 'aqui', 'cliente')),
  apagada_por     text,
  apagada_em      timestamptz,
  editada_em      timestamptz,
  editada_por     text,
  texto_original  text
);
create index if not exists mensagem_extras_conversa on mensagem_extras (conversa_id);
