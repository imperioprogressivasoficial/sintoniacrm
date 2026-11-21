import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { ehGestor } from '../auth/acesso.js';
import type { Contas, Usuario } from '../auth/contas.js';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { nomeOuTelefone } from '../contatos/nome.js';

/**
 * Rotina do vendedor (Atendimento › Rotina): "o vendedor tem rotinas e tarefas que precisa fazer, para não se perder".
 * - Tarefas: título, prazo, responsável, conversa ligada, prioridade, feita/não feita.
 * - Rotina: itens de checklist que se repetem (todo dia, dias da semana ou uma vez por semana);
 *   cada dia vira o checklist da pessoa, com progresso (3 de 5).
 * Gestor (gerente, direção, admin) vê a equipe toda e filtra por pessoa; o vendedor vê só as suas.
 * Tabelas: db/migrations/340_rotina.sql. Datas sempre no fuso da Bahia (UTC−3, sem horário de verão).
 */

const FUSO_MS = 3 * 3600_000;
/** 'YYYY-MM-DD' de um instante, na Bahia. */
export const dataBahia = (d: Date) => new Date(d.getTime() - FUSO_MS).toISOString().slice(0, 10);
/** Início do dia (00:00 na Bahia) de uma data 'YYYY-MM-DD'. */
export const inicioDoDia = (data: string) => new Date(`${data}T00:00:00-03:00`);
/** Dia da semana (0 = domingo) de uma data 'YYYY-MM-DD'. */
export const diaDaSemana = (data: string) => new Date(`${data}T12:00:00-03:00`).getUTCDay();
const somarDias = (data: string, n: number) => dataBahia(new Date(inicioDoDia(data).getTime() + n * 86400_000 + 12 * 3600_000));
/** Segunda-feira da semana da data (a semana vai de segunda a domingo). */
export const segundaDaSemana = (data: string) => somarDias(data, -((diaDaSemana(data) + 6) % 7));

export type Frequencia = 'diaria' | 'dias' | 'semanal';
export interface ItemRotina { id: string; titulo: string; frequencia: Frequencia; dias: number[]; ate: string | null; paraId: string | null; ativa: boolean; ordem: number; criadoPor: string | null }

/** O item entra no checklist deste dia? */
export function valeNoDia(item: Pick<ItemRotina, 'frequencia' | 'dias' | 'ativa'>, data: string): boolean {
  if (!item.ativa) return false;
  if (item.frequencia === 'dias') return item.dias.includes(diaDaSemana(data));
  return true; // diária, e a semanal aparece todo dia até ser feita na semana
}
/** Período em que a marcação vale: o próprio dia, ou a segunda-feira no item semanal. */
export const periodoDe = (item: Pick<ItemRotina, 'frequencia'>, data: string) => (item.frequencia === 'semanal' ? segundaDaSemana(data) : data);

export type Visao = 'hoje' | 'atrasadas' | 'proximas' | 'feitas';
/** Em que visão a tarefa cai agora. Sem prazo fica em "Próximas". */
export function visaoDa(t: { feita: boolean; venceEm: Date | null }, agora: Date): Visao {
  if (t.feita) return 'feitas';
  if (!t.venceEm) return 'proximas';
  if (t.venceEm.getTime() < agora.getTime()) return 'atrasadas';
  const amanha = inicioDoDia(somarDias(dataBahia(agora), 1));
  return t.venceEm < amanha ? 'hoje' : 'proximas';
}

const HM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato 10:00.');
const Id = z.string().uuid();
const IdPessoa = z.string().trim().min(1).max(64);

export const DadosTarefa = z.object({
  titulo: z.string().trim().min(2, 'Escreva o que precisa ser feito.').max(140),
  descricao: z.string().trim().max(2000).default(''),
  venceEm: z.string().datetime({ offset: true }).nullable().default(null),
  responsavelId: IdPessoa.optional(),
  conversaId: Id.nullable().optional(),
  prioridade: z.enum(['baixa', 'normal', 'alta']).default('normal'),
}).strict();

export const DadosItem = z.object({
  titulo: z.string().trim().min(2, 'Escreva o item da rotina.').max(140),
  frequencia: z.enum(['diaria', 'dias', 'semanal']),
  dias: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  ate: HM.nullable().default(null),
  paraId: IdPessoa.nullable().default(null),
  ativa: z.boolean().default(true),
  ordem: z.number().int().min(0).max(9999).default(0),
}).strict().refine((d) => d.frequencia !== 'dias' || d.dias.length > 0, { message: 'Escolha pelo menos um dia.', path: ['dias'] });

const erro = (statusCode: number, msg: string) => Object.assign(new Error(msg), { statusCode });
/** Valida o corpo e devolve a primeira mensagem amigável (a tela mostra o texto). */
function ler<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo);
  if (!r.success) {
    const i = r.error.issues[0];
    // Mensagens escritas aqui (título curto, dia não escolhido…) vão como estão; as automáticas viram um aviso simples.
    const nossa = i && ['too_small', 'too_big', 'custom', 'invalid_format'].includes(i.code) && !/^(Too|Invalid)/.test(i.message);
    throw erro(400, nossa ? i.message : 'Confira os dados.');
  }
  return r.data;
}

export interface OpcoesRotina {
  pool: pg.Pool;
  contas?: Contas;
  repo?: Repositorio;
  /** Quem pode ver a conversa (mesma regra das conversas). */
  visivelPara?: (req: FastifyRequest) => (c: Conversa) => boolean;
  agora?: () => Date;
}

const linhaTarefa = (r: Record<string, unknown>, agora: Date, nomes: Map<string, string>) => {
  const venceEm = r.vence_em ? new Date(r.vence_em as string) : null;
  const feita = Boolean(r.feita);
  return {
    id: String(r.id), titulo: String(r.titulo), descricao: String(r.descricao ?? ''),
    venceEm: venceEm?.toISOString() ?? null,
    responsavelId: String(r.responsavel_id), responsavelNome: nomes.get(String(r.responsavel_id)) ?? 'Pessoa removida',
    conversaId: r.conversa_id ? String(r.conversa_id) : null, clienteNome: r.cliente_nome ? String(r.cliente_nome) : null,
    prioridade: String(r.prioridade), feita, feitaEm: r.feita_em ? new Date(r.feita_em as string).toISOString() : null,
    visao: visaoDa({ feita, venceEm }, agora),
  };
};
const linhaItem = (r: Record<string, unknown>): ItemRotina => ({
  id: String(r.id), titulo: String(r.titulo), frequencia: r.frequencia as Frequencia, dias: (r.dias as number[]) ?? [],
  ate: r.ate ? String(r.ate) : null, paraId: r.para_id ? String(r.para_id) : null, ativa: Boolean(r.ativa), ordem: Number(r.ordem),
  criadoPor: r.criado_por ? String(r.criado_por) : null,
});

export function registrarRotina(app: FastifyInstance, o: OpcoesRotina): void {
  const { pool } = o;
  const agora = o.agora ?? (() => new Date());

  const eu = (req: FastifyRequest): Usuario => {
    if (!req.usuario) throw erro(401, 'Faça login para continuar.');
    return req.usuario;
  };
  /** Pessoas ativas da empresa (para nomes e para escolher responsável). */
  const equipe = async (u: Usuario): Promise<Array<{ id: string; nome: string }>> => {
    const todos = o.contas ? await o.contas.listarUsuarios(u.empresaId) : [];
    const lista = todos.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: p.nome }));
    if (!lista.some((p) => p.id === u.id)) lista.push({ id: u.id, nome: u.nome });
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  };
  const nomesDe = async (u: Usuario) => new Map((await equipe(u)).map((p) => [p.id, p.nome]));
  /** Pessoa a filtrar: vendedor sempre ele mesmo; gestor escolhe ('todos' = equipe toda). */
  const alvo = (u: Usuario, pedida: unknown): string | null => {
    if (!ehGestor(u)) return u.id;
    const p = typeof pedida === 'string' && pedida ? pedida : 'todos';
    return p === 'todos' ? null : IdPessoa.parse(p);
  };
  /** Responsável válido: vendedor só ele mesmo; gestor qualquer pessoa ativa da empresa. */
  const responsavelValido = async (u: Usuario, id: string | undefined | null): Promise<string> => {
    const r = id || u.id;
    if (r === u.id) return r;
    if (!ehGestor(u)) throw erro(403, 'Você só pode criar tarefas e rotinas para você.');
    if (!(await equipe(u)).some((p) => p.id === r)) throw erro(400, 'Essa pessoa não está na equipe.');
    return r;
  };
  /** Conversa ligada: tem que ser da empresa e visível para quem está criando. */
  const conversaLigada = async (req: FastifyRequest, u: Usuario, id: string | null | undefined) => {
    if (!id) return { conversaId: null, clienteNome: null };
    const c = await o.repo?.buscarConversa(id).catch(() => undefined);
    if (!c || c.empresaId !== u.empresaId || (o.visivelPara && !o.visivelPara(req)(c))) throw erro(404, 'Conversa não encontrada.');
    return { conversaId: c.id, clienteNome: nomeOuTelefone(c.nome, c.telefone) };
  };
  /** Tarefa que a pessoa pode mexer: a dela (responsável ou criadora) ou, para o gestor, qualquer uma da empresa. */
  const tarefaDe = async (u: Usuario, idBruto: string) => {
    const id = Id.parse(idBruto);
    const { rows } = await pool.query('select * from sintonia.rotina_tarefas where id = $1 and empresa_id = $2', [id, u.empresaId]);
    const t = rows[0];
    if (!t || (!ehGestor(u) && t.responsavel_id !== u.id && t.criado_por !== u.id)) throw erro(404, 'Tarefa não encontrada.');
    return t as Record<string, unknown>;
  };

  // ---------- tarefas ----------
  app.get('/api/rotina/tarefas', async (req) => {
    const u = eu(req);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const visao = z.enum(['hoje', 'atrasadas', 'proximas', 'feitas']).default('hoje').parse(q.visao || undefined);
    const pessoa = alvo(u, q.pessoa);
    const agoraJa = agora();
    const amanha = inicioDoDia(somarDias(dataBahia(agoraJa), 1));
    const filtroPessoa = pessoa ? 'and responsavel_id = $2' : 'and $2::text is null';
    const conta = await pool.query(
      `select count(*) filter (where not feita and vence_em < $3)::int as atrasadas,
              count(*) filter (where not feita and vence_em >= $3 and vence_em < $4)::int as hoje,
              count(*) filter (where not feita and (vence_em is null or vence_em >= $4))::int as proximas,
              count(*) filter (where feita)::int as feitas
         from sintonia.rotina_tarefas where empresa_id = $1 ${filtroPessoa}`, [u.empresaId, pessoa, agoraJa, amanha]);
    const onde = {
      atrasadas: 'not feita and vence_em < $3 order by vence_em',
      hoje: 'not feita and vence_em >= $3 and vence_em < $4 order by vence_em',
      proximas: 'not feita and (vence_em is null or vence_em >= $4) order by vence_em nulls last, criada_em',
      feitas: 'feita order by feita_em desc limit 200',
    }[visao];
    const { rows } = await pool.query(
      `select * from sintonia.rotina_tarefas where empresa_id = $1 ${filtroPessoa} and $3::timestamptz is not null and $4::timestamptz is not null and ${onde}`,
      [u.empresaId, pessoa, agoraJa, amanha]);
    const pessoas = await equipe(u);
    const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
    return {
      visao, contagem: conta.rows[0], tarefas: rows.map((r) => linhaTarefa(r, agoraJa, nomes)),
      gestor: ehGestor(u), eu: u.id, equipe: ehGestor(u) ? pessoas : pessoas.filter((p) => p.id === u.id),
    };
  });

  app.post('/api/rotina/tarefas', async (req) => {
    const u = eu(req);
    const d = ler(DadosTarefa, req.body);
    const responsavelId = await responsavelValido(u, d.responsavelId);
    const lig = await conversaLigada(req, u, d.conversaId);
    const id = randomUUID();
    await pool.query(
      `insert into sintonia.rotina_tarefas (id, empresa_id, titulo, descricao, vence_em, responsavel_id, criado_por, conversa_id, cliente_nome, prioridade)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, u.empresaId, d.titulo, d.descricao, d.venceEm, responsavelId, u.id, lig.conversaId, lig.clienteNome, d.prioridade]);
    return { id };
  });

  app.put('/api/rotina/tarefas/:id', async (req) => {
    const u = eu(req);
    const t = await tarefaDe(u, (req.params as { id: string }).id);
    const d = ler(DadosTarefa, req.body);
    const responsavelId = d.responsavelId && d.responsavelId !== t.responsavel_id ? await responsavelValido(u, d.responsavelId) : String(t.responsavel_id);
    const lig = d.conversaId === undefined
      ? { conversaId: t.conversa_id ?? null, clienteNome: t.cliente_nome ?? null }
      : d.conversaId === t.conversa_id ? { conversaId: t.conversa_id, clienteNome: t.cliente_nome } : await conversaLigada(req, u, d.conversaId);
    await pool.query(
      `update sintonia.rotina_tarefas set titulo=$3, descricao=$4, vence_em=$5, responsavel_id=$6, conversa_id=$7, cliente_nome=$8, prioridade=$9
        where id=$1 and empresa_id=$2`,
      [t.id, u.empresaId, d.titulo, d.descricao, d.venceEm, responsavelId, lig.conversaId, lig.clienteNome, d.prioridade]);
    return { ok: true };
  });

  app.post('/api/rotina/tarefas/:id/feita', async (req) => {
    const u = eu(req);
    const t = await tarefaDe(u, (req.params as { id: string }).id);
    const { feita } = z.object({ feita: z.boolean() }).strict().parse(req.body);
    await pool.query('update sintonia.rotina_tarefas set feita=$3, feita_em=$4 where id=$1 and empresa_id=$2', [t.id, u.empresaId, feita, feita ? agora() : null]);
    return { ok: true };
  });

  app.delete('/api/rotina/tarefas/:id', async (req) => {
    const u = eu(req);
    const t = await tarefaDe(u, (req.params as { id: string }).id);
    await pool.query('delete from sintonia.rotina_tarefas where id=$1 and empresa_id=$2', [t.id, u.empresaId]);
    return { ok: true };
  });

  /** Tarefas abertas de uma conversa (para mostrar dentro dela, se a tela quiser). */
  app.get('/api/rotina/conversa/:id', async (req) => {
    const u = eu(req);
    const lig = await conversaLigada(req, u, Id.parse((req.params as { id: string }).id));
    const { rows } = await pool.query(
      `select * from sintonia.rotina_tarefas where empresa_id=$1 and conversa_id=$2 and not feita ${ehGestor(u) ? '' : 'and responsavel_id = $3'} order by vence_em nulls last`,
      ehGestor(u) ? [u.empresaId, lig.conversaId] : [u.empresaId, lig.conversaId, u.id]);
    const agoraJa = agora();
    const nomes = await nomesDe(u);
    return { tarefas: rows.map((r) => linhaTarefa(r, agoraJa, nomes)) };
  });

  // ---------- rotina (checklist que se repete) ----------
  const itensDa = async (u: Usuario) =>
    (await pool.query('select * from sintonia.rotina_itens where empresa_id=$1 order by ordem, criada_em', [u.empresaId])).rows.map(linhaItem);
  const podeMexerNoItem = (u: Usuario, i: ItemRotina) => ehGestor(u) || (i.paraId === u.id && i.criadoPor === u.id);
  const itemDe = async (u: Usuario, idBruto: string) => {
    const { rows } = await pool.query('select * from sintonia.rotina_itens where id=$1 and empresa_id=$2', [Id.parse(idBruto), u.empresaId]);
    const i = rows[0] ? linhaItem(rows[0]) : null;
    if (!i || (!ehGestor(u) && i.paraId !== null && i.paraId !== u.id)) throw erro(404, 'Item da rotina não encontrado.');
    return i;
  };

  /** Checklist do dia de uma pessoa (itens que valem no dia + o que já foi marcado). */
  const checklist = async (pessoaId: string, data: string, itens: ItemRotina[]) => {
    const doDia = itens.filter((i) => (i.paraId === null || i.paraId === pessoaId) && valeNoDia(i, data));
    if (!doDia.length) return { itens: [], feitas: 0, total: 0 };
    const { rows } = await pool.query(
      'select item_id, periodo::text as periodo, feita_em from sintonia.rotina_marcas where usuario_id=$1 and item_id = any($2::uuid[]) and periodo in ($3::date, $4::date)',
      [pessoaId, doDia.map((i) => i.id), data, segundaDaSemana(data)]);
    const marcas = new Map(rows.map((r) => [`${r.item_id}|${r.periodo}`, new Date(r.feita_em).toISOString()]));
    const lista = doDia.map((i) => {
      const feitaEm = marcas.get(`${i.id}|${periodoDe(i, data)}`) ?? null;
      return { id: i.id, titulo: i.titulo, frequencia: i.frequencia, dias: i.dias, ate: i.ate, paraId: i.paraId, feita: Boolean(feitaEm), feitaEm };
    });
    return { itens: lista, feitas: lista.filter((i) => i.feita).length, total: lista.length };
  };

  app.get('/api/rotina/dia', async (req) => {
    const u = eu(req);
    const q = (req.query ?? {}) as Record<string, unknown>;
    const data = q.data ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(q.data) : dataBahia(agora());
    const itens = await itensDa(u);
    const meu = await checklist(u.id, data, itens);
    // Gestor: progresso de cada pessoa da equipe no dia.
    let equipeProgresso: Array<{ id: string; nome: string; feitas: number; total: number }> | undefined;
    if (ehGestor(u)) {
      equipeProgresso = [];
      for (const p of await equipe(u)) {
        const c = p.id === u.id ? meu : await checklist(p.id, data, itens);
        if (c.total) equipeProgresso.push({ id: p.id, nome: p.nome, feitas: c.feitas, total: c.total });
      }
    }
    return { data, ...meu, equipe: equipeProgresso };
  });

  app.post('/api/rotina/dia/:id', async (req) => {
    const u = eu(req);
    const i = await itemDe(u, (req.params as { id: string }).id);
    const { feita } = z.object({ feita: z.boolean() }).strict().parse(req.body);
    const hoje = dataBahia(agora());
    if (!valeNoDia(i, hoje) || (i.paraId !== null && i.paraId !== u.id)) throw erro(400, 'Esse item não está na sua rotina de hoje.');
    const periodo = periodoDe(i, hoje);
    if (feita) await pool.query('insert into sintonia.rotina_marcas (item_id, usuario_id, periodo, feita_em) values ($1,$2,$3,$4) on conflict do nothing', [i.id, u.id, periodo, agora()]);
    else await pool.query('delete from sintonia.rotina_marcas where item_id=$1 and usuario_id=$2 and periodo=$3', [i.id, u.id, periodo]);
    return { ok: true };
  });

  app.get('/api/rotina/itens', async (req) => {
    const u = eu(req);
    const todos = await itensDa(u);
    const visiveis = ehGestor(u) ? todos : todos.filter((i) => i.paraId === null || i.paraId === u.id);
    const nomes = await nomesDe(u);
    return {
      itens: visiveis.map((i) => ({ ...i, paraNome: i.paraId ? nomes.get(i.paraId) ?? 'Pessoa removida' : null, podeEditar: podeMexerNoItem(u, i) })),
      gestor: ehGestor(u),
    };
  });
  app.post('/api/rotina/itens', async (req) => {
    const u = eu(req);
    const d = ler(DadosItem, req.body);
    // Vendedor cria só para si; "toda a equipe" (null) é do gestor.
    const paraId = d.paraId === null ? (ehGestor(u) ? null : u.id) : await responsavelValido(u, d.paraId);
    const id = randomUUID();
    await pool.query(
      'insert into sintonia.rotina_itens (id, empresa_id, titulo, frequencia, dias, ate, para_id, ativa, ordem, criado_por) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, u.empresaId, d.titulo, d.frequencia, d.frequencia === 'dias' ? d.dias : [], d.ate, paraId, d.ativa, d.ordem, u.id]);
    return { id };
  });
  app.put('/api/rotina/itens/:id', async (req) => {
    const u = eu(req);
    const i = await itemDe(u, (req.params as { id: string }).id);
    if (!podeMexerNoItem(u, i)) throw erro(403, 'Só a gestão muda esse item da rotina.');
    const d = ler(DadosItem, req.body);
    const paraId = d.paraId === null ? (ehGestor(u) ? null : u.id) : await responsavelValido(u, d.paraId);
    await pool.query(
      'update sintonia.rotina_itens set titulo=$3, frequencia=$4, dias=$5, ate=$6, para_id=$7, ativa=$8, ordem=$9 where id=$1 and empresa_id=$2',
      [i.id, u.empresaId, d.titulo, d.frequencia, d.frequencia === 'dias' ? d.dias : [], d.ate, paraId, d.ativa, d.ordem]);
    return { ok: true };
  });
  app.delete('/api/rotina/itens/:id', async (req) => {
    const u = eu(req);
    const i = await itemDe(u, (req.params as { id: string }).id);
    if (!podeMexerNoItem(u, i)) throw erro(403, 'Só a gestão apaga esse item da rotina.');
    await pool.query('delete from sintonia.rotina_itens where id=$1 and empresa_id=$2', [i.id, u.empresaId]);
    return { ok: true };
  });

  /** Para o selo do menu: minhas tarefas atrasadas, as de hoje e o progresso da rotina de hoje. */
  app.get('/api/rotina/resumo', async (req) => {
    const u = eu(req);
    const agoraJa = agora();
    const hoje = dataBahia(agoraJa);
    const { rows } = await pool.query(
      `select count(*) filter (where vence_em < $3)::int as atrasadas,
              count(*) filter (where vence_em >= $3 and vence_em < $4)::int as hoje
         from sintonia.rotina_tarefas where empresa_id=$1 and responsavel_id=$2 and not feita`,
      [u.empresaId, u.id, agoraJa, inicioDoDia(somarDias(hoje, 1))]);
    const c = await checklist(u.id, hoje, await itensDa(u));
    return { atrasadas: rows[0].atrasadas, hoje: rows[0].hoje, rotinaFeitas: c.feitas, rotinaTotal: c.total };
  });
}
