import type pg from 'pg';
import type { Mensagem } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehCanalTeste } from '../channels/teste.js';

/**
 * ia-aprende: de onde vêm as conversas para estudar. Só conversas em que a EQUIPE atendeu
 * (2+ mensagens da equipe e 1+ da cliente), fora as arquivadas e as do WhatsApp de teste.
 * Primeiro as que terminaram em agendamento, depois as com mais mensagens da equipe, depois as mais novas.
 */

export interface Candidata {
  id: string;
  nome?: string;
  /** Terminou em agendamento (etapa agendada/compareceu/manutenção ou agendamento registrado). */
  agendou: boolean;
  equipe: number;
  /** Última mensagem da equipe. */
  ultimaEquipe: Date;
}

export interface FonteConversas {
  /** Candidatas com mensagem da equipe depois de `lidas.get(id)` (ou nunca lidas), até `limite`. */
  candidatas(empresaId: string, lidas: Map<string, Date>, limite: number): Promise<Candidata[]>;
  mensagens(conversaId: string): Promise<Mensagem[]>;
  /** Nomes da equipe (para tirar das mensagens). */
  nomesEquipe(empresaId: string): Promise<string[]>;
}

export const ETAPAS_AGENDOU = ['agendada', 'compareceu', 'manutencao'];
const MENSAGENS_POR_CONVERSA = 80;

export const ordenarCandidatas = (l: Candidata[]) =>
  l.sort((a, b) => Number(b.agendou) - Number(a.agendou) || b.equipe - a.equipe || b.ultimaEquipe.getTime() - a.ultimaEquipe.getTime());

/** Fonte pelo Repositorio (memória ou qualquer banco): lê as conversas uma a uma. Serve para teste e sem banco. */
export class FonteConversasRepo implements FonteConversas {
  constructor(
    private readonly repo: Repositorio,
    private readonly equipe: (empresaId: string) => Promise<string[]> = async () => [],
  ) {}

  async candidatas(empresaId: string, lidas: Map<string, Date>, limite: number) {
    const conversas = (await this.repo.listarConversas({ empresaId })).filter((c) => c.empresaId === empresaId && !c.arquivadaEm && !ehCanalTeste(c.canalId));
    const eventos = await this.repo.eventosEntre(new Date(0), new Date(8.64e15));
    const agendaram = new Set(eventos.filter((e) => e.tipo === 'agendamento_equipe' || e.tipo === 'agendamento_ia').map((e) => e.conversaId));
    const saida: Candidata[] = [];
    for (const c of conversas) {
      if (!c.ultimaMensagemEquipe) continue;
      const lida = lidas.get(c.id);
      if (lida && c.ultimaMensagemEquipe.getTime() <= lida.getTime()) continue;
      const msgs = await this.repo.mensagens(c.id, MENSAGENS_POR_CONVERSA);
      const equipe = msgs.filter((m) => m.autor === 'equipe').length;
      if (equipe < 2 || !msgs.some((m) => m.autor === 'cliente')) continue;
      saida.push({ id: c.id, nome: c.nome, agendou: ETAPAS_AGENDOU.includes(c.etapa) || agendaram.has(c.id), equipe, ultimaEquipe: c.ultimaMensagemEquipe });
    }
    return ordenarCandidatas(saida).slice(0, limite);
  }
  mensagens(conversaId: string) {
    return this.repo.mensagens(conversaId, MENSAGENS_POR_CONVERSA);
  }
  nomesEquipe(empresaId: string) {
    return this.equipe(empresaId);
  }
}

/** Fonte direto no Postgres: uma consulta escolhe as conversas (rápido mesmo com milhares). */
export class FonteConversasPostgres implements FonteConversas {
  constructor(
    private readonly pool: pg.Pool,
    private readonly repo: Repositorio,
  ) {}

  async candidatas(empresaId: string, _lidas: Map<string, Date>, limite: number) {
    const { rows } = await this.pool.query<{ id: string; nome: string | null; agendou: boolean; equipe: number; ultima_equipe: Date }>(
      `select c.id, c.nome, c.ultima_mensagem_equipe as ultima_equipe,
              (c.etapa = any($3) or exists (select 1 from sintonia.eventos e where e.conversa_id = c.id and e.tipo in ('agendamento_equipe', 'agendamento_ia'))) as agendou,
              (select count(*)::int from sintonia.mensagens m where m.conversa_id = c.id and m.autor = 'equipe') as equipe
         from sintonia.conversas c
         left join sintonia.aprender_lidas l on l.empresa_id = c.empresa_id and l.conversa_id = c.id
        where c.empresa_id = $1 and c.arquivada_em is null and c.canal_id not like 'teste-%'
          and c.ultima_mensagem_equipe is not null
          and (l.ate is null or c.ultima_mensagem_equipe > l.ate)
          and exists (select 1 from sintonia.mensagens m where m.conversa_id = c.id and m.autor = 'cliente')
          and (select count(*) from sintonia.mensagens m where m.conversa_id = c.id and m.autor = 'equipe') >= 2
        order by agendou desc, equipe desc, c.ultima_mensagem_equipe desc
        limit $2`,
      [empresaId, limite, ETAPAS_AGENDOU],
    );
    return rows.map((r) => ({ id: r.id, nome: r.nome ?? undefined, agendou: r.agendou, equipe: r.equipe, ultimaEquipe: r.ultima_equipe }));
  }
  mensagens(conversaId: string) {
    return this.repo.mensagens(conversaId, MENSAGENS_POR_CONVERSA);
  }
  async nomesEquipe(empresaId: string) {
    const { rows } = await this.pool.query<{ nome: string }>('select nome from sintonia.usuarios where empresa_id = $1', [empresaId]);
    return rows.map((r) => r.nome);
  }
}
