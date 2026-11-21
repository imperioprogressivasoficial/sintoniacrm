-- notificacoes2 (21/11): avisos repetidos viram um item só por pessoa, com o contador de quantas vezes aconteceram.
--  * "A chave da IA foi recusada" / "O WhatsApp parou de enviar" (chave falha:<classe>), que chegavam de novo a cada hora;
--  * "Fulana pausou/ligou a Serena" (chave serena-chave-<tipo>-<hora>), que passa a usar a chave fixa "serena-chave".
-- Fica a linha mais nova de cada grupo (com o título, o texto e o estado de lida dela); as outras somem.
-- Avisos de espera antigos que ninguém leu ficam como lidos: o sino agora mostra quem está esperando de verdade.
-- Pode rodar de novo sem estragar nada.
with marcadas as (
  select id,
         case when chave like 'serena-chave-%' then 'serena-chave' else chave end as grupo,
         row_number() over (partition by usuario_id, case when chave like 'serena-chave-%' then 'serena-chave' else chave end
                            order by atualizada_em desc, id desc) as pos,
         sum(contador) over (partition by usuario_id, case when chave like 'serena-chave-%' then 'serena-chave' else chave end) as total
    from sintonia.notificacoes
   where chave like 'falha:%' or chave like 'serena-chave%'
),
apagadas as (
  delete from sintonia.notificacoes n using marcadas m where n.id = m.id and m.pos > 1 returning n.id
)
update sintonia.notificacoes n
   set contador = m.total, chave = m.grupo
  from marcadas m
 where n.id = m.id and m.pos = 1;

update sintonia.notificacoes set lida_em = now()
 where tipo = 'espera' and lida_em is null and atualizada_em < now() - interval '1 day';
