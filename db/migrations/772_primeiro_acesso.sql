-- primeiro-acesso: um link único (/primeiro-acesso) para a equipe criar a própria senha só com o e-mail.
-- 1) usuarios.sem_senha: a conta nasceu sem senha (convite ou semente SINTONIA_EQUIPE_INICIAL) e ninguém criou
--    uma ainda. Vira false assim que qualquer senha é definida (link, primeiro acesso, troca, gestão).
-- 2) primeiro_acesso: a chave "Primeiro acesso pelo link" por empresa. Desligada por padrão (sem linha ou
--    ligado_ate nulo). Ao ligar, vale até ligado_ate (14 dias) e fecha sozinha.
-- Aditiva: só acrescenta uma coluna e uma tabela.
set local search_path to sintonia;

alter table usuarios add column if not exists sem_senha boolean not null default false;

-- Quem foi convidado e nunca usou o convite nem entrou ainda está sem senha própria.
update usuarios u set sem_senha = true
 where exists (select 1 from acesso_convites c where c.usuario_id = u.id and c.tipo = 'convite')
   and not exists (select 1 from acesso_convites c where c.usuario_id = u.id and c.usado_em is not null)
   and not exists (select 1 from acesso_usuarios a where a.usuario_id = u.id and a.ultimo_acesso is not null);

create table if not exists primeiro_acesso (
  empresa_id  text primary key,
  ligado_ate  timestamptz,
  ligado_em   timestamptz,
  ligado_por  text
);
