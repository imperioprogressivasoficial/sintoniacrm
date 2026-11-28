-- tabela-fim (dono 28/11): a imagem da tabela de preços que o sistema manda depois da confirmação de cada agendamento
-- da IA. Cliente nova: "Seu Primeiro Alisamento"; quem já era cliente: "Liso Infinito". Fica na configuração da IA
-- da empresa (config_ia.tabelaAgendamento) e pode ser trocado por empresa. Aditiva: só preenche se ainda não existe.
set local search_path to sintonia;

update empresas
   set config_ia = coalesce(config_ia, '{}'::jsonb) || '{"tabelaAgendamento": {"clienteNova": "Seu Primeiro Alisamento", "jaCliente": "Liso Infinito"}}'::jsonb
 where id = 'imperio' and not (coalesce(config_ia, '{}'::jsonb) ? 'tabelaAgendamento');
