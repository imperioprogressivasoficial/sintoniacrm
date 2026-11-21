-- msg-agendada: mensagens agendadas na conversa ("Agendar envio" segurando o botão de enviar).
-- O relógio do servidor envia na hora (pelo mesmo caminho de uma mensagem da equipe) e o estado fica aqui:
-- sobrevive a reinício e cada mensagem sai uma vez só (a reserva troca 'agendada' por 'enviando' de uma vez).
set local search_path to sintonia;

create table mensagens_agendadas (
  id              uuid primary key,
  empresa_id      text not null,
  -- Conversa apagada leva junto o que estava agendado para ela (nada sai para ninguém).
  conversa_id     uuid not null references conversas(id) on delete cascade,
  texto           text not null default '',
  -- Anexo opcional (foto, vídeo, áudio ou documento, até 16 MB).
  anexo_tipo      text,
  anexo_mimetype  text,
  anexo_nome      text,
  anexo_tamanho   integer,
  anexo_conteudo  bytea,
  -- Quando a pessoa pediu para sair (é o que a tela mostra).
  enviar_em       timestamptz not null,
  -- Quando o relógio tenta de novo (igual a enviar_em até a primeira falha).
  tentar_em       timestamptz not null,
  situacao        text not null default 'agendada'
                  check (situacao in ('agendada', 'enviando', 'enviada', 'cancelada', 'falhou')),
  erro            text,
  tentativas      integer not null default 0,
  criado_por      text not null,
  criado_por_id   text,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  -- Quando passou para 'enviando' (reserva): se o servidor cair no meio, o relógio percebe depois.
  reservado_em    timestamptz,
  enviado_em      timestamptz,
  cancelado_por   text
);
create index mensagens_agendadas_fila on mensagens_agendadas (tentar_em) where situacao = 'agendada';
create index mensagens_agendadas_presas on mensagens_agendadas (reservado_em) where situacao = 'enviando';
create index mensagens_agendadas_conversa on mensagens_agendadas (conversa_id, enviar_em);
create index mensagens_agendadas_empresa on mensagens_agendadas (empresa_id, enviar_em desc);
