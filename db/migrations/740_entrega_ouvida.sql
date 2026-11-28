-- Vistos do WhatsApp: o áudio de voz ganha o estado "ouvida" (a cliente tocou o áudio: microfone azul).
-- Aditiva: só troca a regra da coluna entrega para aceitar 'ouvida'; nenhum dado muda.
set local search_path to sintonia;

alter table mensagens drop constraint if exists mensagens_entrega_check;
alter table mensagens
  add constraint mensagens_entrega_check check (entrega in ('enviada', 'entregue', 'lida', 'ouvida', 'falhou'));
