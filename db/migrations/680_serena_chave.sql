-- serena-chave (pedido do dono, 21/11/2026): chave geral "Serena ligada / pausada" da empresa.
-- Pausada, a Serena não atende clientes (não responde, não sugere, não segue sozinha); a equipe atende tudo.
-- Guarda: pausada, até quando (null = até alguém ligar de novo), quem pausou, quando e o motivo,
-- e a última pausa que acabou (para não responder, depois, quem esperou mais de 30 min durante a pausa).
-- Pode rodar de novo sem estragar nada.
set local search_path to sintonia;

alter table empresas
  add column if not exists pausa_serena jsonb not null default '{}'::jsonb;
