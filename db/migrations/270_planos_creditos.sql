-- Planos da IA com limites de uso (5 h, semana, mês) e créditos (src/planos, docs/PLANOS.md).
-- tokens_credito: quantos tokens da chamada foram pagos com créditos (a chamada aconteceu com algum limite estourado).
-- As colunas ia_uso.dentro_horario e ia_assinaturas.adicional_fora ficam por compatibilidade e são ignoradas.
set local search_path to sintonia;

alter table ia_uso add column if not exists tokens_credito bigint not null default 0;
update ia_assinaturas set plano = 'essencial' where plano = 'gratis';
