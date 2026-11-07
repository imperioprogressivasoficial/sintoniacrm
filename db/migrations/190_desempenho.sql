-- Desempenho do atendimento: mensagens por período (sem varrer a tabela) e a fila de quem espera resposta.
set local search_path to sintonia;

create index if not exists mensagens_periodo on mensagens (em) where autor <> 'sistema';
create index if not exists conversas_esperando on conversas (ultima_mensagem_cliente)
  where ultima_mensagem_cliente is not null;
