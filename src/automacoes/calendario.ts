import type pg from 'pg';
import { bahia, DIA, partesBahia } from '../util/tempo.js';
import type { CalendarioAutomacoes } from './automacoes.js';

/**
 * Gatilhos de calendário das automações, no Postgres:
 * - aniversário: data de nascimento da ficha é hoje (Bahia), a partir das 9h; uma vez por ano (chave aniversario:AAAA);
 * - X dias após comparecer: a conversa entrou em "Compareceu" há X dias (janela de 1 dia; chave pelo evento).
 * A conversa usada é a mais recente da cliente (mesmo telefone).
 */
export function calendarioPostgres(pool: pg.Pool, empresaId: string): CalendarioAutomacoes {
  return {
    async aniversariantes(agora) {
      const d = partesBahia(agora);
      if (d.hora < 9) return [];
      const { rows } = await pool.query<{ conversa_id: string }>(
        `select distinct on (ct.telefone) c.id as conversa_id
           from sintonia.contatos ct join sintonia.conversas c on c.empresa_id = ct.empresa_id and c.telefone = ct.telefone
          where ct.empresa_id = $1 and ct.nascimento is not null and extract(month from ct.nascimento) = $2 and extract(day from ct.nascimento) = $3
          order by ct.telefone, c.atualizada_em desc`,
        [empresaId, d.mes, d.dia],
      );
      return rows.map((r) => ({ conversaId: r.conversa_id, chave: `aniversario:${d.ano}` }));
    },
    async compareceramHa(dias, agora) {
      const d = partesBahia(agora);
      // Do início do dia (há X dias) até agora menos X dias: dispara no dia certo, a qualquer hora em que o relógio passe.
      const inicio = new Date(bahia(d.ano, d.mes, d.dia).getTime() - dias * DIA);
      const fim = new Date(agora.getTime() - dias * DIA);
      const { rows } = await pool.query<{ conversa_id: string; id: string }>(
        `select e.conversa_id, e.id from sintonia.eventos e join sintonia.conversas c on c.id = e.conversa_id
          where c.empresa_id = $1 and e.tipo = 'etapa_mudou' and e.dados->>'para' = 'compareceu' and e.em >= $2 and e.em <= $3`,
        [empresaId, inicio, fim],
      );
      return rows.map((r) => ({ conversaId: r.conversa_id, chave: `compareceu:${dias}:${r.id}` }));
    },
  };
}
