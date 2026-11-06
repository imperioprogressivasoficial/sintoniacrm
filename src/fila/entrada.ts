import type pg from 'pg';
import type { MensagemRecebida } from '../channels/tipos.js';

/**
 * Fila de entrada do WhatsApp.
 *
 * - O webhook só grava aqui e responde na hora; nada se perde num pico ou numa queda.
 * - Mensagens da MESMA cliente saem uma de cada vez e em ordem; clientes diferentes em paralelo.
 * - Quem pega uma mensagem tem um prazo (reserva). Se o processo cair, o prazo vence e outro pega.
 * - Erro: nova tentativa com espera crescente; depois de MAX_TENTATIVAS vai para a lista de falhas.
 */

export const MAX_TENTATIVAS = 5;
export const RESERVA_MS = 2 * 60_000;

export interface ItemFila {
  id: number;
  mensagem: MensagemRecebida;
  tentativas: number;
}

export interface FalhaFila {
  id: number;
  mensagem: MensagemRecebida;
  tentativas: number;
  erro: string;
}

export interface FilaEntrada {
  /** Grava as mensagens; repetidas (mesmo id do WhatsApp) são ignoradas. Retorna quantas entraram. */
  enfileirar(canal: string, mensagens: MensagemRecebida[]): Promise<number>;
  /** Pega até `limite` mensagens prontas, no máximo uma por cliente. */
  reivindicar(agora: Date, limite: number): Promise<ItemFila[]>;
  concluir(id: number, agora: Date): Promise<void>;
  falhar(id: number, erro: string, agora: Date): Promise<void>;
  /** Para o painel de saúde. */
  situacao(): Promise<{ pendentes: number; processando: number; falhas: number }>;
  falhas(limite?: number): Promise<FalhaFila[]>;
  /** Devolve uma falha para a fila (depois de corrigido o problema). */
  reprocessar(id: number, agora: Date): Promise<void>;
}

export const chaveConversa = (m: Pick<MensagemRecebida, 'canalId' | 'telefone'>) => `${m.canalId}|${m.telefone}`;

/** Espera antes da próxima tentativa: 5 s, 10 s, 20 s, 40 s... */
export const esperaTentativa = (tentativas: number) => 5_000 * 2 ** Math.max(0, tentativas - 1);

// ---------------------------------------------------------------- memória

interface LinhaMemoria {
  id: number;
  canal: string;
  idExterno: string;
  chave: string;
  mensagem: MensagemRecebida;
  status: 'pendente' | 'processando' | 'feita' | 'falhou';
  tentativas: number;
  proxima: number;
  reservadaAte: number;
  erro?: string;
}

export class FilaMemoria implements FilaEntrada {
  private linhas: LinhaMemoria[] = [];
  private seq = 0;

  async enfileirar(canal: string, mensagens: MensagemRecebida[]) {
    let n = 0;
    for (const m of mensagens) {
      if (this.linhas.some((l) => l.idExterno === m.idExterno)) continue;
      this.linhas.push({
        id: ++this.seq,
        canal,
        idExterno: m.idExterno,
        chave: chaveConversa(m),
        mensagem: m,
        status: 'pendente',
        tentativas: 0,
        proxima: 0,
        reservadaAte: 0,
      });
      n++;
    }
    return n;
  }

  async reivindicar(agora: Date, limite: number) {
    const t = agora.getTime();
    const primeiraPorChave = new Map<string, LinhaMemoria>();
    for (const l of this.linhas) {
      if (l.status !== 'pendente' && l.status !== 'processando') continue;
      if (!primeiraPorChave.has(l.chave)) primeiraPorChave.set(l.chave, l);
    }
    const prontas = [...primeiraPorChave.values()]
      .filter((l) => l.proxima <= t && (l.status === 'pendente' || l.reservadaAte < t))
      .sort((a, b) => a.id - b.id)
      .slice(0, limite);
    for (const l of prontas) {
      l.status = 'processando';
      l.reservadaAte = t + RESERVA_MS;
      l.tentativas++;
    }
    return prontas.map((l) => ({ id: l.id, mensagem: l.mensagem, tentativas: l.tentativas }));
  }

  async concluir(id: number) {
    const l = this.linhas.find((x) => x.id === id);
    if (l) l.status = 'feita';
  }

  async falhar(id: number, erro: string, agora: Date) {
    const l = this.linhas.find((x) => x.id === id);
    if (!l) return;
    l.erro = erro;
    l.reservadaAte = 0;
    if (l.tentativas >= MAX_TENTATIVAS) l.status = 'falhou';
    else {
      l.status = 'pendente';
      l.proxima = agora.getTime() + esperaTentativa(l.tentativas);
    }
  }

  async situacao() {
    const conta = (s: LinhaMemoria['status']) => this.linhas.filter((l) => l.status === s).length;
    return { pendentes: conta('pendente'), processando: conta('processando'), falhas: conta('falhou') };
  }

  async falhas(limite = 50) {
    return this.linhas
      .filter((l) => l.status === 'falhou')
      .slice(0, limite)
      .map((l) => ({ id: l.id, mensagem: l.mensagem, tentativas: l.tentativas, erro: l.erro ?? '' }));
  }

  async reprocessar(id: number, agora: Date) {
    const l = this.linhas.find((x) => x.id === id && x.status === 'falhou');
    if (l) Object.assign(l, { status: 'pendente', tentativas: 0, proxima: agora.getTime(), erro: undefined });
  }
}

// ---------------------------------------------------------------- Postgres

/** A mensagem vai como JSON; a data volta como texto e é convertida aqui. */
function lerMensagem(j: MensagemRecebida & { em: string | Date }): MensagemRecebida {
  return { ...j, em: new Date(j.em) };
}

export class FilaPostgres implements FilaEntrada {
  /** `reservaMs`: prazo para concluir antes que outro trabalhador retome (menor só em testes). */
  constructor(
    private readonly pool: pg.Pool,
    private readonly reservaMs = RESERVA_MS,
  ) {}

  async enfileirar(canal: string, mensagens: MensagemRecebida[]) {
    let n = 0;
    for (const m of mensagens) {
      const r = await this.pool.query(
        `insert into sintonia.entrada (canal, id_externo, conversa_chave, mensagem)
         values ($1, $2, $3, $4) on conflict (id_externo) do nothing`,
        [canal, m.idExterno, chaveConversa(m), JSON.stringify(m)],
      );
      n += r.rowCount ?? 0;
    }
    return n;
  }

  async reivindicar(agora: Date, limite: number) {
    // Para cada cliente, só a mensagem mais antiga ainda não concluída é candidata.
    // Se ela estiver com outro trabalhador (reserva válida) ou esperando nova tentativa,
    // as seguintes daquela cliente esperam: a ordem nunca se inverte.
    const { rows } = await this.pool.query<{ id: string; mensagem: MensagemRecebida & { em: string }; tentativas: number }>(
      `with primeiras as (
         select distinct on (conversa_chave) id
           from sintonia.entrada
          where status in ('pendente', 'processando')
          order by conversa_chave, id
       ),
       prontas as (
         select e.id from sintonia.entrada e
           join primeiras p on p.id = e.id
          where e.proxima_tentativa <= $1
            and (e.status = 'pendente' or e.reservada_ate < $1)
          order by e.id
          limit $2
          for update of e skip locked
       )
       update sintonia.entrada e
          set status = 'processando',
              reservada_ate = $1::timestamptz + make_interval(secs => $3::double precision / 1000),
              tentativas = e.tentativas + 1
         from prontas
        where e.id = prontas.id
          and (e.status = 'pendente' or e.reservada_ate < $1)
       returning e.id, e.mensagem, e.tentativas`,
      [agora, limite, this.reservaMs],
    );
    return rows
      .map((r) => ({ id: Number(r.id), mensagem: lerMensagem(r.mensagem), tentativas: r.tentativas }))
      .sort((a, b) => a.id - b.id);
  }

  async concluir(id: number, agora: Date) {
    await this.pool.query(
      `update sintonia.entrada set status = 'feita', feita_em = $2, reservada_ate = null, erro = null where id = $1`,
      [id, agora],
    );
  }

  async falhar(id: number, erro: string, agora: Date) {
    await this.pool.query(
      `update sintonia.entrada
          set erro = $2,
              reservada_ate = null,
              status = case when tentativas >= $4 then 'falhou' else 'pendente' end,
              proxima_tentativa = $3::timestamptz
                + make_interval(secs => 5 * power(2, greatest(tentativas - 1, 0)))
        where id = $1`,
      [id, erro.slice(0, 2000), agora, MAX_TENTATIVAS],
    );
  }

  async situacao() {
    const { rows } = await this.pool.query<{ status: string; n: string }>(
      `select status, count(*) as n from sintonia.entrada where status <> 'feita' group by status`,
    );
    const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return { pendentes: n('pendente'), processando: n('processando'), falhas: n('falhou') };
  }

  async falhas(limite = 50) {
    const { rows } = await this.pool.query<{ id: string; mensagem: MensagemRecebida & { em: string }; tentativas: number; erro: string | null }>(
      `select id, mensagem, tentativas, erro from sintonia.entrada where status = 'falhou' order by criada_em desc limit $1`,
      [limite],
    );
    return rows.map((r) => ({ id: Number(r.id), mensagem: lerMensagem(r.mensagem), tentativas: r.tentativas, erro: r.erro ?? '' }));
  }

  async reprocessar(id: number, agora: Date) {
    await this.pool.query(
      `update sintonia.entrada set status = 'pendente', tentativas = 0, proxima_tentativa = $2, erro = null
        where id = $1 and status = 'falhou'`,
      [id, agora],
    );
  }
}
