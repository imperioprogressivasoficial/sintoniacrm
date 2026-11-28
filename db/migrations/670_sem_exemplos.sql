-- sem-exemplos (pedido do dono, 21/11/2026): "não quero nada de exemplo em Fluxos, Chatbot e Follow-up; eu crio".
-- Tira do banco só o que a Sintonia criou sozinha como exemplo e que a empresa nunca mexeu nem ligou.
-- Nunca apaga o que alguém criou ou editou, nem o que está ligado ou já rodou.
-- Pode rodar de novo sem estragar nada (na 2ª vez não acha mais nada).
set local search_path to sintonia;

-- 1) Follow-up: a configuração nascia com as mensagens de exemplo em cada cadência (MODELOS_CADENCIA,
--    src/followup/tipos.ts — as duas versões que já existiram: 07/11 e 20/11). Cadência DESLIGADA cujas mensagens
--    são exatamente as do exemplo (texto, espera, IA, objetivo e e-mail iguais) fica vazia. Ligada ou mexida, fica como está.
--    A confirmação de agenda não muda (é a função, não um exemplo).
with modelos(id, passos) as (
  values
    ('sem_resposta', '[{"esperaHoras":24,"texto":"Oi, {primeiro_nome}! Conseguiu ver minha mensagem? Fico à disposição para tirar qualquer dúvida 😊","ia":false,"objetivo":"Retomar a conversa com leveza e perguntar se ficou alguma dúvida.","email":false,"emailModeloId":null},{"esperaHoras":48,"texto":"{primeiro_nome}, passando para saber se ainda posso te ajudar. Se quiser, me conta o que você precisa que eu te ajudo por aqui.","ia":false,"objetivo":"Oferecer ajuda de novo, sem pressionar.","email":false,"emailModeloId":null},{"esperaHoras":96,"texto":"Oi, {primeiro_nome}! Vou deixar nossa conversa guardada por aqui. Quando quiser continuar, é só me chamar 💙","ia":false,"objetivo":"","email":false,"emailModeloId":null}]'::jsonb),
    ('preco_sem_agendar', '[{"esperaHoras":2,"texto":"{primeiro_nome}, conseguiu ver os valores? Se quiser, já deixo um horário reservado para você 😉","ia":true,"objetivo":"A cliente pediu preço e não agendou: tirar dúvidas e convidar para agendar.","email":false,"emailModeloId":null},{"esperaHoras":24,"texto":"Oi, {primeiro_nome}! Ficou alguma dúvida sobre os valores ou o que está incluído? Posso te explicar e já ver um horário.","ia":true,"objetivo":"Reforçar o valor do serviço e convidar para agendar.","email":false,"emailModeloId":null},{"esperaHoras":72,"texto":"{primeiro_nome}, essa semana ainda tenho alguns horários livres. Posso reservar um para você?","ia":false,"objetivo":"","email":false,"emailModeloId":null}]'::jsonb),
    ('faltou', '[{"esperaHoras":2,"texto":"Oi, {primeiro_nome}! Sentimos sua falta hoje na {unidade}. Aconteceu alguma coisa? Posso remarcar seu horário 💙","ia":true,"objetivo":"A cliente faltou: acolher sem cobrar e oferecer remarcar.","email":false,"emailModeloId":null},{"esperaHoras":48,"texto":"{primeiro_nome}, vamos remarcar seu {servico}? Me diz o melhor dia que eu vejo os horários.","ia":false,"objetivo":"","email":false,"emailModeloId":null}]'::jsonb),
    ('pos_atendimento', '[{"esperaHoras":24,"texto":"Oi, {primeiro_nome}! Como você está depois do {servico}? Qualquer dúvida sobre os cuidados, é só chamar 💙","ia":false,"objetivo":"","email":false,"emailModeloId":null},{"esperaHoras":696,"texto":"{primeiro_nome}, já faz um mês do seu {servico}! Como está tudo? Se quiser, já vejo um horário de manutenção para você.","ia":false,"objetivo":"","email":false,"emailModeloId":null},{"esperaHoras":720,"texto":"Oi, {primeiro_nome}! Dois meses do seu {servico}. Que tal já reservar sua manutenção na {unidade}?","ia":false,"objetivo":"","email":false,"emailModeloId":null},{"esperaHoras":720,"texto":"{primeiro_nome}, chegou a hora da manutenção do seu {servico} (90 dias) ✨ Quer que eu reserve um horário?","ia":true,"objetivo":"Convidar para a manutenção de 90 dias.","email":true,"emailModeloId":null}]'::jsonb),
    ('orcamento', '[{"esperaHoras":24,"texto":"Oi, {primeiro_nome}! Conseguiu ver o orçamento que te mandei? Posso ajudar em alguma dúvida?","ia":true,"objetivo":"Saber se a cliente viu o orçamento e tirar dúvidas.","email":false,"emailModeloId":null},{"esperaHoras":72,"texto":"{primeiro_nome}, o orçamento continua de pé! Quer que eu reserve um horário para você?","ia":false,"objetivo":"","email":false,"emailModeloId":null}]'::jsonb),
    ('sem_resposta', '[{"esperaHoras":3,"texto":"Oi, {primeiro_nome}! Conseguiu ver minha mensagem? Fico à disposição para tirar qualquer dúvida 😊","ia":true,"objetivo":"Retomar a conversa com leveza e perguntar se ficou alguma dúvida.","email":false,"emailModeloId":null},{"esperaHoras":24,"texto":"{primeiro_nome}, ainda pensando no seu cabelo? Temos horários essa semana na {unidade}. Quer que eu veja um para você?","ia":true,"objetivo":"Oferecer ajuda para escolher um horário, sem pressionar.","email":false,"emailModeloId":null},{"esperaHoras":72,"texto":"Oi, {primeiro_nome}! Vou deixar sua conversa aqui guardadinha. Quando quiser agendar, é só me chamar 💙","ia":false,"objetivo":"","email":false,"emailModeloId":null}]'::jsonb),
    ('preco_sem_agendar', '[{"esperaHoras":2,"texto":"{primeiro_nome}, conseguiu ver os valores? Se quiser, já deixo um horário reservado para você na {unidade} 😉","ia":true,"objetivo":"A cliente pediu preço e não agendou: tirar dúvidas e convidar para agendar.","email":false,"emailModeloId":null},{"esperaHoras":24,"texto":"Oi, {primeiro_nome}! Lembrando que a avaliação do fio é gratuita. Quer agendar um horário?","ia":true,"objetivo":"Reforçar o valor do serviço e convidar para agendar.","email":false,"emailModeloId":null},{"esperaHoras":72,"texto":"{primeiro_nome}, essa semana ainda tenho alguns horários livres. Posso reservar um para você?","ia":false,"objetivo":"","email":false,"emailModeloId":null}]'::jsonb),
    ('pos_atendimento', '[{"esperaHoras":24,"texto":"Oi, {primeiro_nome}! Como ficou seu cabelo depois do {servico}? Qualquer dúvida sobre os cuidados, é só chamar 💙","ia":false,"objetivo":"","email":false,"emailModeloId":null},{"esperaHoras":696,"texto":"{primeiro_nome}, já faz um mês do seu {servico}! Como está o cabelo? Se quiser, já vejo um horário de hidratação para você.","ia":false,"objetivo":"","email":false,"emailModeloId":null},{"esperaHoras":720,"texto":"Oi, {primeiro_nome}! Dois meses do seu {servico}. Que tal já reservar sua manutenção na {unidade}?","ia":false,"objetivo":"","email":false,"emailModeloId":null},{"esperaHoras":720,"texto":"{primeiro_nome}, chegou a hora da manutenção do seu {servico} (90 dias) ✨ Quer que eu reserve um horário?","ia":true,"objetivo":"Convidar para a manutenção de 90 dias da progressiva.","email":true,"emailModeloId":null}]'::jsonb)
),
cadencias as (
  select f.empresa_id, e.c, e.o,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'esperaHoras', p->'esperaHoras',
                   'texto', coalesce(p->>'texto', ''),
                   'ia', coalesce(p->'ia', 'false'::jsonb),
                   'objetivo', coalesce(p->>'objetivo', ''),
                   'email', coalesce(p->'email', 'false'::jsonb),
                   'emailModeloId', coalesce(p->'emailModeloId', 'null'::jsonb)) order by i), '[]'::jsonb)
            from jsonb_array_elements(case when jsonb_typeof(e.c->'passos') = 'array' then e.c->'passos' else '[]'::jsonb end)
                 with ordinality as x(p, i)) as passos
    from followup_config f
    cross join lateral jsonb_array_elements(case when jsonb_typeof(f.config->'cadencias') = 'array' then f.config->'cadencias' else '[]'::jsonb end)
         with ordinality as e(c, o)
),
novas as (
  select empresa_id,
         jsonb_agg(case
                     when coalesce(c->>'ligada', 'false') <> 'true'
                      and jsonb_array_length(passos) > 0
                      and exists (select 1 from modelos m where m.id = c->>'id' and m.passos = cadencias.passos)
                     then jsonb_set(c, '{passos}', '[]'::jsonb)
                     else c
                   end order by o) as lista
    from cadencias
   group by empresa_id
)
update followup_config f
   set config = jsonb_set(f.config, '{cadencias}', n.lista)
  from novas n
 where n.empresa_id = f.empresa_id
   and n.lista is distinct from f.config->'cadencias';

-- 2) Fluxos: as 3 automações "Exemplo: …" que os Dados de demonstração criavam (src/demo/demo.ts).
--    Só as que continuam exatamente como nasceram: criadas pela "Demonstração", registradas como demonstração,
--    desligadas, nunca alteradas (atualizada_em = criada_em) e sem nenhuma execução (nem de teste).
with exemplos as (
  select a.id, a.empresa_id
    from automacoes a
   where a.criada_por = 'Demonstração'
     and a.nome in ('Exemplo: Interessada há 1 dia → mensagem', 'Exemplo: Compareceu → Pós-venda', 'Exemplo: palavra "endereço" → resposta')
     and a.ligada = false
     and a.atualizada_em = a.criada_em
     and exists (select 1 from demo_registros r where r.empresa_id = a.empresa_id and r.tipo = 'automacao' and r.chave = a.id::text)
     and not exists (select 1 from automacao_execucoes x where x.automacao_id = a.id)
),
registros as (
  delete from demo_registros r using exemplos e
   where r.empresa_id = e.empresa_id and r.tipo = 'automacao' and r.chave = e.id::text
  returning 1
)
delete from automacoes a using exemplos e where a.id = e.id;

-- 3) Chatbot: nenhum bot nascia sozinho (os modelos só apareciam na tela, para a pessoa escolher). Nada a apagar.
