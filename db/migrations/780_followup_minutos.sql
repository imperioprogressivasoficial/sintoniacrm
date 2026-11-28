-- followup-minutos (pedido do dono, 28/11/2026): acompanhamento quando a cliente para de responder, em minutos.
-- "Não coloca só o modo operante: isso tem que estar na tela de Follow-up, que eu desligo e personalizo depois."
--
-- 1) Império: a cadência "Não respondeu" fica LIGADA com o modelo sugerido (SUGESTAO_SEM_RESPOSTA em
--    src/followup/tipos.ts; test/followup-minutos.test.ts confere que os dois continuam iguais):
--    5 min, +15 min, +1 dia (a IA escreve com um objetivo; o texto é a reserva), +2 dias (cai no 3º dia).
--    Só preenche se a cadência da Império ainda está vazia (nunca escrita). Se alguém já escreveu, fica como está.
--    Empresa nova continua nascendo vazia e desligada (sem-exemplos); a tela oferece "Usar modelo sugerido".
-- 2) Índice para a tela contar "enviadas hoje".
-- Pode rodar de novo sem estragar nada.
set local search_path to sintonia;

with nova(c) as (
  values ('{
    "id": "sem_resposta",
    "ligada": true,
    "pararSeResponder": true,
    "passos": [
      {"esperaMinutos": 5, "unidade": "min", "texto": "Oi, ainda está por aí?", "ia": false, "objetivo": "", "email": false, "emailModeloId": null},
      {"esperaMinutos": 15, "unidade": "min", "texto": "Consegui te ajudar? Se quiser, já deixo seu horário separado.", "ia": false, "objetivo": "", "email": false, "emailModeloId": null},
      {"esperaMinutos": 1440, "unidade": "d", "texto": "Oi, {primeiro_nome}! Passando para saber se ainda quer agendar. Se quiser, já vejo os horários para você.", "ia": true, "objetivo": "Retomar a conversa de ontem com leveza: lembrar em uma frase o que ela queria (o serviço, a unidade ou o horário que estava vendo) e perguntar se quer que você reserve. Curta, sem pressionar e sem repetir a mensagem anterior.", "email": false, "emailModeloId": null},
      {"esperaMinutos": 2880, "unidade": "d", "texto": "Oi, {primeiro_nome}! Vou deixar nossa conversa guardada por aqui. Quando quiser, é só me chamar que eu vejo um horário para você 💜", "ia": false, "objetivo": "", "email": false, "emailModeloId": null}
    ]
  }'::jsonb)
),
atual as (
  select f.empresa_id,
         case when jsonb_typeof(f.config->'cadencias') = 'array' then f.config->'cadencias' else '[]'::jsonb end as cads
    from followup_config f
   where f.empresa_id = 'imperio'
),
vazia as (
  -- A cadência "Não respondeu" da Império não existe ou não tem nenhuma mensagem.
  select a.empresa_id, a.cads
    from atual a
   where not exists (
           select 1 from jsonb_array_elements(a.cads) e
            where e->>'id' = 'sem_resposta' and jsonb_typeof(e->'passos') = 'array' and jsonb_array_length(e->'passos') > 0)
),
trocada as (
  select v.empresa_id,
         case when exists (select 1 from jsonb_array_elements(v.cads) e where e->>'id' = 'sem_resposta')
              then (select jsonb_agg(case when x.e->>'id' = 'sem_resposta' then n.c else x.e end order by x.o)
                      from jsonb_array_elements(v.cads) with ordinality as x(e, o))
              else v.cads || jsonb_build_array(n.c)
         end as cads
    from vazia v cross join nova n
)
update followup_config f
   set config = jsonb_set(coalesce(f.config, '{}'::jsonb), '{cadencias}', t.cads),
       atualizado_por = 'Sintonia (modelo sugerido)',
       atualizado_em = now()
  from trocada t
 where t.empresa_id = f.empresa_id;

-- Império sem configuração gravada ainda (nunca abriu a tela): nasce só com esta cadência; o resto vem do padrão.
-- (Não depende da linha em empresas: num banco novo ela só nasce quando o app sobe, depois das migrações.)
insert into followup_config (empresa_id, config, atualizado_por)
select 'imperio',
       jsonb_build_object('cadencias', jsonb_build_array(n.c)),
       'Sintonia (modelo sugerido)'
  from (values ('{
    "id": "sem_resposta",
    "ligada": true,
    "pararSeResponder": true,
    "passos": [
      {"esperaMinutos": 5, "unidade": "min", "texto": "Oi, ainda está por aí?", "ia": false, "objetivo": "", "email": false, "emailModeloId": null},
      {"esperaMinutos": 15, "unidade": "min", "texto": "Consegui te ajudar? Se quiser, já deixo seu horário separado.", "ia": false, "objetivo": "", "email": false, "emailModeloId": null},
      {"esperaMinutos": 1440, "unidade": "d", "texto": "Oi, {primeiro_nome}! Passando para saber se ainda quer agendar. Se quiser, já vejo os horários para você.", "ia": true, "objetivo": "Retomar a conversa de ontem com leveza: lembrar em uma frase o que ela queria (o serviço, a unidade ou o horário que estava vendo) e perguntar se quer que você reserve. Curta, sem pressionar e sem repetir a mensagem anterior.", "email": false, "emailModeloId": null},
      {"esperaMinutos": 2880, "unidade": "d", "texto": "Oi, {primeiro_nome}! Vou deixar nossa conversa guardada por aqui. Quando quiser, é só me chamar que eu vejo um horário para você 💜", "ia": false, "objetivo": "", "email": false, "emailModeloId": null}
    ]
  }'::jsonb)) as n(c)
on conflict (empresa_id) do nothing;

create index if not exists followup_envios_enviados_hoje on followup_envios (empresa_id, enviado_em) where estado = 'enviado';
