-- Índices para o painel da gestão agregar no banco (30 dias de eventos sem varrer a tabela toda).
set local search_path to sintonia;

-- Primeira resposta de cada conversa e eventos por conversa.
create index if not exists eventos_conversa on eventos (conversa_id, em);
-- Contagens por tipo num período (leads, respostas, agendamentos).
create index if not exists eventos_tipo_periodo on eventos (tipo, em);
-- "Online": quem deu sinal nos últimos minutos.
create index if not exists digitando_recente on digitando (em);
