-- serena-regras (dono 28/11): horários que a IA oferece por unidade e espelho da agenda do sistema (Trinks).
-- Aditiva: só preenche o que está vazio nas unidades da Império e cria tabelas novas.
set local search_path to sintonia;

-- 1) Horários padrão da Império (Empresa › Unidades): só onde a unidade ainda não tem nenhum.
update unidades set dados = coalesce(dados, '{}'::jsonb) || '{"horariosPadrao": ["09:00", "12:30", "15:30"], "ultimoHorarioEspecial": "18:00"}'::jsonb
 where empresa_id = 'imperio' and id = 'sumare' and coalesce(jsonb_array_length(dados->'horariosPadrao'), 0) = 0;
update unidades set dados = coalesce(dados, '{}'::jsonb) || '{"horariosPadrao": ["09:00", "12:30", "15:30", "18:00"]}'::jsonb
 where empresa_id = 'imperio' and id = 'norte' and coalesce(jsonb_array_length(dados->'horariosPadrao'), 0) = 0;

-- 2) Espelho da agenda: horários livres de cada dia (próximos 14 dias) por unidade, atualizado em segundo plano.
create table if not exists espelho_agenda_dias (
  empresa_id     text not null,
  unidade        text not null,
  data           date not null,
  servico_id     bigint not null,
  vagos          jsonb not null default '[]',   -- [{ "profissionalId": 7, "horarios": ["09:00", ...] }]
  atualizado_em  timestamptz not null default now(),
  primary key (empresa_id, unidade, data, servico_id)
);

-- 3) Espelho da agenda: tudo que está marcado na unidade (o que a recepção marca direto no sistema também).
create table if not exists espelho_agenda_marcados (
  empresa_id     text not null,
  unidade        text not null,
  inicio         date not null,
  fim            date not null,
  itens          jsonb not null default '[]',
  atualizado_em  timestamptz not null default now(),
  primary key (empresa_id, unidade)
);
