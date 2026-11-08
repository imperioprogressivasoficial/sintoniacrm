import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { UnidadeId } from '../domain.js';

/**
 * Histórico de ligações (tela "Ligações", como a aba do WhatsApp).
 * Só o que é real:
 * - "efetuada": alguém tocou em Ligar no app (a ligação sai do celular dela; a Sintonia não faz VoIP,
 *   então não há duração e o resultado só existe se ela contar depois);
 * - "recebida"/"perdida": o WhatsApp avisou (Evolution, evento CALL). Sem o aviso, nada é inventado.
 */

export type Direcao = 'efetuada' | 'recebida' | 'perdida';

export interface Chamada {
  id: string;
  empresaId: string;
  conversaId: string | null;
  telefone: string;
  direcao: Direcao;
  resultado: string | null;
  atendenteId: string | null;
  atendenteNome: string | null;
  unidade: UnidadeId | null;
  em: Date;
  origem: 'app' | 'whatsapp' | 'demo';
  idExterno: string | null;
}

export type NovaChamada = Omit<Chamada, 'id' | 'resultado' | 'idExterno'> & { resultado?: string | null; idExterno?: string | null };

export interface FiltroChamadas {
  empresaId: string;
  /** Só perdidas. */
  perdidas?: boolean;
  /** Esconde o que veio antes (a pessoa limpou o histórico). */
  desde?: Date;
  /** Cursor: a última já mostrada. */
  antes?: { em: Date; id: string };
  limite: number;
}

export interface ArmazemChamadas {
  registrar(c: NovaChamada): Promise<Chamada>;
  /** Mesma chamada do WhatsApp avisada de novo: atualiza a direção (ex.: perdida → recebida). */
  porIdExterno(empresaId: string, idExterno: string): Promise<Chamada | undefined>;
  atualizar(id: string, campos: Partial<Pick<Chamada, 'direcao' | 'resultado'>>): Promise<Chamada | undefined>;
  buscar(id: string): Promise<Chamada | undefined>;
  /** Mais novas primeiro (quem pode ver é filtrado por quem chama, com `podeVer`). */
  listar(f: FiltroChamadas, podeVer: (c: Chamada) => boolean): Promise<Chamada[]>;
  limpeza(usuarioId: string): Promise<Date | undefined>;
  limpar(usuarioId: string, ate: Date): Promise<void>;
  favoritos(usuarioId: string): Promise<string[]>;
  favoritar(usuarioId: string, conversaId: string, sim: boolean): Promise<void>;
}

// ---------------------------------------------------------------- memória

export class ArmazemChamadasMemoria implements ArmazemChamadas {
  private readonly itens: Chamada[] = [];
  private readonly limpezas = new Map<string, Date>();
  private readonly favs = new Map<string, Set<string>>();
  async registrar(c: NovaChamada) {
    const n: Chamada = { resultado: null, idExterno: null, ...c, id: randomUUID() };
    this.itens.push(n);
    return { ...n };
  }
  async porIdExterno(empresaId: string, idExterno: string) {
    const c = this.itens.find((x) => x.empresaId === empresaId && x.idExterno === idExterno);
    return c ? { ...c } : undefined;
  }
  async atualizar(id: string, campos: Partial<Pick<Chamada, 'direcao' | 'resultado'>>) {
    const c = this.itens.find((x) => x.id === id);
    if (!c) return undefined;
    Object.assign(c, Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined)));
    return { ...c };
  }
  async buscar(id: string) {
    const c = this.itens.find((x) => x.id === id);
    return c ? { ...c } : undefined;
  }
  async listar(f: FiltroChamadas, podeVer: (c: Chamada) => boolean) {
    return this.itens
      .filter((c) => c.empresaId === f.empresaId && (!f.perdidas || c.direcao === 'perdida') && (!f.desde || c.em > f.desde))
      .filter((c) => !f.antes || c.em < f.antes.em || (c.em.getTime() === f.antes.em.getTime() && c.id < f.antes.id))
      .sort((a, b) => b.em.getTime() - a.em.getTime() || (a.id < b.id ? 1 : -1))
      .filter(podeVer)
      .slice(0, f.limite)
      .map((c) => ({ ...c }));
  }
  async limpeza(usuarioId: string) {
    return this.limpezas.get(usuarioId);
  }
  async limpar(usuarioId: string, ate: Date) {
    this.limpezas.set(usuarioId, ate);
  }
  async favoritos(usuarioId: string) {
    return [...(this.favs.get(usuarioId) ?? [])];
  }
  async favoritar(usuarioId: string, conversaId: string, sim: boolean) {
    const s = this.favs.get(usuarioId) ?? new Set<string>();
    if (sim) s.add(conversaId);
    else s.delete(conversaId);
    this.favs.set(usuarioId, s);
  }
}

// ---------------------------------------------------------------- Postgres

interface Linha {
  id: string;
  empresa_id: string;
  conversa_id: string | null;
  telefone: string;
  direcao: Direcao;
  resultado: string | null;
  atendente_id: string | null;
  atendente_nome: string | null;
  unidade: UnidadeId | null;
  em: Date;
  origem: Chamada['origem'];
  id_externo: string | null;
}
const daLinha = (l: Linha): Chamada => ({
  id: l.id,
  empresaId: l.empresa_id,
  conversaId: l.conversa_id,
  telefone: l.telefone,
  direcao: l.direcao,
  resultado: l.resultado,
  atendenteId: l.atendente_id,
  atendenteNome: l.atendente_nome,
  unidade: l.unidade,
  em: l.em,
  origem: l.origem,
  idExterno: l.id_externo,
});
const COLUNAS = 'id::text, empresa_id, conversa_id::text, telefone, direcao, resultado, atendente_id::text, atendente_nome, unidade, em, origem, id_externo';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ArmazemChamadasPostgres implements ArmazemChamadas {
  constructor(private readonly pool: pg.Pool) {}
  async registrar(c: NovaChamada) {
    const { rows } = await this.pool.query<Linha>(
      `insert into sintonia.chamadas (id, empresa_id, conversa_id, telefone, direcao, resultado, atendente_id, atendente_nome, unidade, em, origem, id_externo)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning ${COLUNAS}`,
      [randomUUID(), c.empresaId, c.conversaId, c.telefone, c.direcao, c.resultado ?? null, c.atendenteId && UUID.test(c.atendenteId) ? c.atendenteId : null, c.atendenteNome, c.unidade, c.em, c.origem, c.idExterno ?? null],
    );
    return daLinha(rows[0]!);
  }
  async porIdExterno(empresaId: string, idExterno: string) {
    const { rows } = await this.pool.query<Linha>(`select ${COLUNAS} from sintonia.chamadas where empresa_id = $1 and id_externo = $2`, [empresaId, idExterno]);
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async atualizar(id: string, campos: Partial<Pick<Chamada, 'direcao' | 'resultado'>>) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<Linha>(
      `update sintonia.chamadas set direcao = coalesce($2, direcao), resultado = coalesce($3, resultado) where id = $1 returning ${COLUNAS}`,
      [id, campos.direcao ?? null, campos.resultado ?? null],
    );
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async buscar(id: string) {
    if (!UUID.test(id)) return undefined;
    const { rows } = await this.pool.query<Linha>(`select ${COLUNAS} from sintonia.chamadas where id = $1`, [id]);
    return rows[0] ? daLinha(rows[0]) : undefined;
  }
  async listar(f: FiltroChamadas, podeVer: (c: Chamada) => boolean) {
    // Busca em lotes e filtra quem pode ver (as regras de visão moram em podeVer), até encher a página.
    const saida: Chamada[] = [];
    let antes = f.antes;
    for (let volta = 0; volta < 10 && saida.length < f.limite; volta++) {
      const lote = Math.max(50, f.limite * 2);
      const { rows } = await this.pool.query<Linha>(
        `select ${COLUNAS} from sintonia.chamadas
          where empresa_id = $1 and ($2::boolean is not true or direcao = 'perdida') and ($3::timestamptz is null or em > $3)
            and ($4::timestamptz is null or (em, id) < ($4, $5::uuid))
          order by em desc, id desc limit $6`,
        [f.empresaId, f.perdidas ?? false, f.desde ?? null, antes?.em ?? null, antes?.id ?? '00000000-0000-0000-0000-000000000000', lote],
      );
      for (const l of rows) {
        const c = daLinha(l);
        if (podeVer(c)) saida.push(c);
        if (saida.length >= f.limite) break;
      }
      if (rows.length < lote) break;
      const ult = rows.at(-1)!;
      antes = { em: ult.em, id: ult.id };
    }
    return saida;
  }
  async limpeza(usuarioId: string) {
    if (!UUID.test(usuarioId)) return undefined;
    const { rows } = await this.pool.query<{ ate: Date }>('select ate from sintonia.chamadas_limpeza where usuario_id = $1', [usuarioId]);
    return rows[0]?.ate;
  }
  async limpar(usuarioId: string, ate: Date) {
    await this.pool.query(
      `insert into sintonia.chamadas_limpeza (usuario_id, ate) values ($1, $2) on conflict (usuario_id) do update set ate = excluded.ate`,
      [usuarioId, ate],
    );
  }
  async favoritos(usuarioId: string) {
    if (!UUID.test(usuarioId)) return [];
    const { rows } = await this.pool.query<{ id: string }>('select conversa_id::text as id from sintonia.contatos_favoritos where usuario_id = $1 order by criado_em', [usuarioId]);
    return rows.map((r) => r.id);
  }
  async favoritar(usuarioId: string, conversaId: string, sim: boolean) {
    if (sim) await this.pool.query('insert into sintonia.contatos_favoritos (usuario_id, conversa_id) values ($1, $2) on conflict do nothing', [usuarioId, conversaId]);
    else await this.pool.query('delete from sintonia.contatos_favoritos where usuario_id = $1 and conversa_id = $2', [usuarioId, conversaId]);
  }
}

// ---------------------------------------------------------------- WhatsApp (Evolution): evento CALL

/** Chamada de voz avisada pelo WhatsApp. `status` como a Evolution manda (offer, ringing, accept, reject, timeout…). */
export interface AvisoChamada {
  instancia: string;
  idExterno: string;
  telefone: string;
  status: string;
  /** Quando o WhatsApp diz que foi (sem data no aviso: null, e vale a hora em que chegou). */
  em: Date | null;
}

const ItemCall = z.object({
  id: z.string().min(1),
  from: z.string().min(5),
  status: z.string().min(1),
  date: z.union([z.string(), z.number()]).optional(),
  isGroup: z.boolean().optional(),
});
const CorpoCall = z.object({
  event: z.string(),
  instance: z.string().default(''),
  data: z.union([ItemCall, z.array(ItemCall)]),
});

/**
 * Lê o webhook CALL da Evolution v2 (Baileys): `{ event: 'call', instance, data: { id, from, status, date } }`
 * (às vezes `data` é uma lista). Qualquer outro evento: lista vazia. Ligações de grupo são ignoradas.
 */
export function lerChamadasEvolution(corpo: unknown): AvisoChamada[] {
  const r = CorpoCall.safeParse(corpo);
  if (!r.success) return [];
  if (r.data.event.toLowerCase().replace(/_/g, '.') !== 'call') return [];
  const lista = Array.isArray(r.data.data) ? r.data.data : [r.data.data];
  return lista
    .filter((x) => !x.isGroup && !x.from.includes('@g.us'))
    .map((x) => {
      const ms = typeof x.date === 'number' ? (x.date < 1e12 ? x.date * 1000 : x.date) : x.date ? Date.parse(x.date) : NaN;
      return { instancia: r.data.instance, idExterno: x.id, telefone: x.from.split('@')[0]!.replace(/\D/g, ''), status: x.status.toLowerCase(), em: Number.isNaN(ms) ? null : new Date(ms) };
    })
    .filter((x) => x.telefone.length >= 10);
}

/** O que o aviso vira: "accept" = recebida (alguém atendeu no celular da loja); o resto (offer, timeout, reject…) = perdida. */
export const direcaoDoAviso = (status: string): Direcao => (status === 'accept' || status === 'accepted' ? 'recebida' : 'perdida');
