-- Dono 21/11: mensagens mandadas pelo WhatsApp do celular não aparecem mais como "celular da loja", e sim com o nome
-- de uma pessoa: a dona da conversa; sem dona, "Equipe". Pode rodar de novo sem estragar nada.
update sintonia.mensagens m
   set autor_nome = coalesce(nullif(trim(c.responsavel_nome), ''), 'Equipe')
  from sintonia.conversas c
 where m.conversa_id = c.id and m.autor_nome = 'celular da loja';

update sintonia.grupo_mensagens set autor_nome = 'Equipe' where autor_nome = 'celular da loja';
