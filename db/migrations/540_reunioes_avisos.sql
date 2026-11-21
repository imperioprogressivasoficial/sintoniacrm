-- atendimento-extra: avisos do agendamento online (link /r/<slug>).
-- No link: confirmação pelo WhatsApp para o contato (ligada/desligada) e lembrete antes da reunião (minutos; 0 = sem lembrete).
-- Na reunião: código para o próprio contato desmarcar pelo link, quando o lembrete saiu, quem cancelou e a conversa do contato.
set local search_path to sintonia;

alter table links_reuniao add column if not exists whatsapp_cliente boolean not null default true;
alter table links_reuniao add column if not exists lembrete_min int not null default 60 check (lembrete_min between 0 and 1440);

alter table reunioes add column if not exists codigo_cancelar text;
alter table reunioes add column if not exists lembrete_em timestamptz;
alter table reunioes add column if not exists cancelada_por text check (cancelada_por in ('cliente', 'equipe'));
alter table reunioes add column if not exists cancelada_em timestamptz;
alter table reunioes add column if not exists conversa_id uuid;

create unique index if not exists reunioes_codigo_cancelar on reunioes (codigo_cancelar) where codigo_cancelar is not null;
-- O relógio procura as reuniões marcadas que ainda não tiveram lembrete.
create index if not exists reunioes_lembrete on reunioes (inicio) where status = 'marcada' and lembrete_em is null;
