-- Botão principal do cartão no CRM do celular, escolhido em cada funil (pipeline):
-- agendar, ganho (marcar como ganho), venda (fechar venda) ou proposta (enviar proposta).
-- Vazio = o padrão da tela (Agendar no funil do sistema, Marcar como ganho nos outros).
set local search_path to sintonia;

alter table funis add column if not exists acao_principal text;
alter table funis drop constraint if exists funis_acao_principal;
alter table funis add constraint funis_acao_principal
  check (acao_principal is null or acao_principal in ('agendar', 'ganho', 'venda', 'proposta'));
