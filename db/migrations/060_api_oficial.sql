-- WhatsApp oficial (Cloud API da Meta).
-- A mídia recebida pela API oficial é baixada por um id próprio (media id), diferente do id da mensagem.
-- As mensagens enviadas pela loja guardam o aviso de entrega/leitura que a Meta manda pelo webhook.
set local search_path to sintonia;

alter table midias add column if not exists ref_canal text;

alter table mensagens
  add column if not exists entrega text check (entrega in ('enviada', 'entregue', 'lida', 'falhou')),
  add column if not exists entrega_em timestamptz;
