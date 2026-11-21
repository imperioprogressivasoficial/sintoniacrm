-- ligacoes-modos: por onde cada ligação foi — 'telefone' (chip do celular), 'whatsapp' (abre o WhatsApp na conversa)
-- ou 'voip' (linha fixa da empresa pelo app; ainda travada). null = ligação antiga, de antes de guardar o jeito.
-- Só acrescenta; pode rodar de novo sem estragar nada.
set local search_path to sintonia;

alter table chamadas add column if not exists modo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chamadas_modo_valido' and conrelid = 'sintonia.chamadas'::regclass) then
    alter table chamadas add constraint chamadas_modo_valido check (modo is null or modo in ('telefone', 'whatsapp', 'voip'));
  end if;
end $$;

-- As avisadas pelo WhatsApp (evento CALL) foram, claro, pelo WhatsApp.
update chamadas set modo = 'whatsapp' where modo is null and origem = 'whatsapp';
