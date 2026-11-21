import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import type { Sintonia } from '../app/sintonia.js';
import type { Contas } from '../auth/contas.js';
import { aplicarEdicao, contatoVazio, EdicaoContato, type ArmazemContatos, type Contato } from '../contatos/contatos.js';
import { ETAPAS, type Conversa, type ModoAtendimento, type UnidadeId } from '../domain.js';
import type { Funis } from '../funis/funis.js';
import { agendamentosEntre } from '../agenda/agenda-dia.js';
import { horariosLivres, instante, type LinkReuniao } from '../reunioes/reunioes.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Tags } from '../tags/tags.js';
import { normalizarCelular } from '../util/telefone.js';
import { resumoConversa, resumoMensagem } from './webhooks.js';

/**
 * O que a API pública (/api/v1) e o MCP (/mcp) fazem, num lugar só. Sempre na empresa da chave:
 * nada daqui recebe empresaId de fora. Os envios e mudanças passam pelos mesmos caminhos da tela
 * (Sintonia.equipeEnviou, Funis.mover, Tags.marcar...), então eventos, automações e webhooks valem igual.
 */

export class ErroApi extends Error {
  constructor(
    readonly statusCode: number,
    readonly codigo: string,
    msg: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(msg);
  }
}

export const naoEncontrado = (o = 'Registro') => new ErroApi(404, 'nao_encontrado', `${o} não encontrado.`);
const indisponivel = (o: string) => new ErroApi(501, 'indisponivel', `${o} não está disponível nesta instalação.`);

/** Quem está chamando: a chave (e a empresa dela). */
export interface Contexto {
  empresaId: string;
  chaveId: string;
  nomeChave: string;
  /** Quem criou a chave (responsável padrão das tarefas criadas por ela). */
  criadaPor: string | null;
}

export interface OpcoesServicoApi {
  repo: Repositorio;
  sintonia: Pick<Sintonia, 'equipeEnviou' | 'mudarModo' | 'renomearCliente'>;
  /** Por qual número a unidade fala (o mesmo da tela "Nova conversa"). */
  canalDa?: (unidade: UnidadeId) => { canalId: string } | { erro: string };
  modoInicial?: () => Promise<ModoAtendimento>;
  contatos?: ArmazemContatos;
  /** Tags e funis da empresa (as instâncias são de uma empresa só). */
  tags?: (empresaId: string) => Tags | undefined;
  funis?: (empresaId: string) => Funis | undefined;
  /** Banco: agendamentos por link (reuniões) e tarefas (rotina). */
  pool?: pg.Pool;
  contas?: Pick<Contas, 'listarUsuarios'>;
  /** Avisado quando a API marca ou cancela uma reunião (webhook "agendamento.*"). */
  aoReuniao?: (tipo: 'criado' | 'cancelado', empresaId: string, reuniao: Record<string, unknown>) => void;
  agora?: () => Date;
}

// ------------------------------------------------------------------ paginação por cursor

export interface Pagina<T> {
  dados: T[];
  proximoCursor: string | null;
}

export const codificarCursor = (em: Date | string, id: string) => Buffer.from(JSON.stringify({ e: new Date(em).toISOString(), i: id })).toString('base64url');
export function lerCursor(c: string | undefined): { em: Date; id: string } | undefined {
  if (!c) return undefined;
  try {
    const j = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as { e?: unknown; i?: unknown };
    if (typeof j.e !== 'string' || typeof j.i !== 'string' || Number.isNaN(Date.parse(j.e)) || j.i.length > 100) throw new Error();
    return { em: new Date(j.e), id: j.i };
  } catch {
    throw new ErroApi(400, 'cursor_invalido', 'Cursor inválido. Use o proximoCursor que veio na página anterior.');
  }
}

/** Ordem do mais novo para o mais velho, com o id como desempate; corta depois do cursor. */
function paginar<T>(lista: T[], em: (x: T) => Date, id: (x: T) => string, limite: number, cursor?: string): Pagina<T> {
  const c = lerCursor(cursor);
  const ordenada = [...lista].sort((a, b) => em(b).getTime() - em(a).getTime() || (id(a) < id(b) ? 1 : id(a) > id(b) ? -1 : 0));
  const depois = c ? ordenada.filter((x) => em(x).getTime() < c.em.getTime() || (em(x).getTime() === c.em.getTime() && id(x) < c.id)) : ordenada;
  const dados = depois.slice(0, limite);
  const ultimo = dados.at(-1);
  return { dados, proximoCursor: depois.length > limite && ultimo ? codificarCursor(em(ultimo), id(ultimo)) : null };
}

// ------------------------------------------------------------------ esquemas de entrada

const UNIDADE = z.enum(['norte', 'sumare', 'feira']);
export const Limite = z.coerce.number().int().min(1).max(100).default(25);
const Telefone = z.string().trim().min(8).max(40);
const Texto = z.string().trim().min(1, 'Escreva a mensagem.').max(4096);

export const FiltroContatos = z.object({ busca: z.string().trim().max(80).optional(), limite: Limite, cursor: z.string().max(400).optional() });
export const NovoContato = EdicaoContato.extend({ telefone: Telefone, unidade: UNIDADE.optional() });
export const FiltroConversas = z.object({
  limite: Limite,
  cursor: z.string().max(400).optional(),
  unidade: UNIDADE.optional(),
  etapa: z.enum(ETAPAS).optional(),
  telefone: z.string().max(40).optional(),
  atualizadaDesde: z.string().datetime({ offset: true }).optional(),
});
export const FiltroMensagens = z.object({ limite: Limite, cursor: z.string().max(400).optional() });
export const EnvioNumero = z.object({ telefone: Telefone, texto: Texto, nome: z.string().trim().max(80).optional(), unidade: UNIDADE.optional() });
export const MoverLead = z.object({ funilId: z.string().min(1).max(64).optional(), etapaId: z.string().min(1).max(64).optional(), etapa: z.string().trim().min(1).max(60).optional() })
  .refine((d) => d.etapaId || d.etapa, 'Informe etapaId ou o nome da etapa (etapa).');
export const ValorLead = z.object({ valor: z.number().min(0).max(10_000_000).nullable() });
export const AplicarTag = z.object({ tagId: z.string().min(1).max(64).optional(), nome: z.string().trim().min(1).max(40).optional() }).refine((d) => d.tagId || d.nome, 'Informe tagId ou nome.');
export const FiltroAgendamentos = z.object({ de: z.string().datetime({ offset: true }).optional(), ate: z.string().datetime({ offset: true }).optional() });
export const NovoAgendamento = z.object({
  linkId: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.'),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a hora no formato 09:00.'),
  nome: z.string().trim().min(2).max(120),
  telefone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(160).optional(),
  observacao: z.string().trim().max(800).optional(),
});
export const FiltroTarefas = z.object({
  situacao: z.enum(['abertas', 'feitas', 'todas']).default('abertas'),
  responsavelId: z.string().max(64).optional(),
  conversaId: z.string().uuid().optional(),
  limite: Limite,
  cursor: z.string().max(400).optional(),
});
export const NovaTarefa = z.object({
  titulo: z.string().trim().min(2).max(140),
  descricao: z.string().trim().max(2000).default(''),
  venceEm: z.string().datetime({ offset: true }).nullable().default(null),
  responsavelId: z.string().trim().min(1).max(64).optional(),
  conversaId: z.string().uuid().nullable().optional(),
  prioridade: z.enum(['baixa', 'normal', 'alta']).default('normal'),
});

// ------------------------------------------------------------------ serviço

export class ServicoApi {
  private readonly agora: () => Date;
  constructor(private readonly o: OpcoesServicoApi) {
    this.agora = o.agora ?? (() => new Date());
  }

  private autor(ctx: Contexto) {
    return `${ctx.nomeChave} (integração)`;
  }

  private async conversasDa(ctx: Contexto): Promise<Conversa[]> {
    return (await this.o.repo.listarConversas()).filter((c) => c.empresaId === ctx.empresaId);
  }

  /** Conversa da empresa da chave (a de outra empresa dá 404: nem revela que existe). */
  async conversa(ctx: Contexto, id: string): Promise<Conversa> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw naoEncontrado('Conversa');
    const c = await this.o.repo.buscarConversa(id).catch(() => undefined);
    if (!c || c.empresaId !== ctx.empresaId) throw naoEncontrado('Conversa');
    return c;
  }

  private tags(ctx: Contexto): Tags {
    const t = this.o.tags?.(ctx.empresaId);
    if (!t) throw indisponivel('Tags');
    return t;
  }
  private funis(ctx: Contexto): Funis {
    const f = this.o.funis?.(ctx.empresaId);
    if (!f) throw indisponivel('Funis');
    return f;
  }
  private pool(o: string): pg.Pool {
    if (!this.o.pool) throw indisponivel(o);
    return this.o.pool;
  }

  // ---------------------------------------------------------------- contatos

  private async campos(ctx: Contexto) {
    return this.o.contatos ? this.o.contatos.campos(ctx.empresaId) : [];
  }

  private async montarContato(ctx: Contexto, telefone: string, conversas: Conversa[]) {
    const ficha: Contato = (this.o.contatos ? await this.o.contatos.obter(ctx.empresaId, telefone) : undefined) ?? contatoVazio(telefone, conversas[0]?.nome);
    const defs = await this.campos(ctx);
    const t = this.o.tags?.(ctx.empresaId);
    const mapa = t ? await t.dasConversas(conversas.map((c) => c.id)) : new Map();
    const tags = new Map<string, { id: string; nome: string; cor: string }>();
    for (const c of conversas) for (const x of mapa.get(c.id) ?? []) if (!x.funilId) tags.set(x.id, { id: x.id, nome: x.nome, cor: x.cor });
    const datas = conversas.map((c) => c.criadaEm.getTime());
    const atualizadas = conversas.map((c) => c.atualizadaEm.getTime());
    return {
      telefone,
      nome: ficha.nome ?? conversas.find((c) => c.nome)?.nome ?? null,
      email: ficha.email,
      nascimento: ficha.nascimento,
      observacoes: ficha.observacoes,
      pessoa: ficha.pessoa,
      empresa: ficha.empresa,
      campos: defs.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo, valor: ficha.campos[d.id] ?? null })),
      tags: [...tags.values()],
      conversas: conversas.map(resumoConversa),
      criadoEm: datas.length ? new Date(Math.min(...datas)).toISOString() : null,
      atualizadoEm: new Date(Math.max(...atualizadas, ficha.atualizadoEm?.getTime() ?? 0)).toISOString(),
    };
  }

  private agrupar(conversas: Conversa[]) {
    const porTel = new Map<string, Conversa[]>();
    for (const c of conversas) porTel.set(c.telefone, [...(porTel.get(c.telefone) ?? []), c]);
    return [...porTel.entries()].map(([telefone, lista]) => ({
      telefone,
      lista: lista.sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime()),
      em: new Date(Math.max(...lista.map((c) => c.atualizadaEm.getTime()))),
    }));
  }

  async listarContatos(ctx: Contexto, q: z.infer<typeof FiltroContatos>) {
    let grupos = this.agrupar(await this.conversasDa(ctx));
    if (q.busca) {
      const b = q.busca.toLowerCase();
      const dig = /\p{L}/u.test(q.busca) ? '' : q.busca.replace(/\D/g, '');
      grupos = grupos.filter((g) => (dig.length >= 3 && g.telefone.includes(dig)) || g.lista.some((c) => (c.nome ?? '').toLowerCase().includes(b)));
    }
    const p = paginar(grupos, (g) => g.em, (g) => g.telefone, q.limite, q.cursor);
    return { dados: await Promise.all(p.dados.map((g) => this.montarContato(ctx, g.telefone, g.lista))), proximoCursor: p.proximoCursor };
  }

  private telefoneValido(bruto: string): string {
    const t = normalizarCelular(bruto);
    if (!t) throw new ErroApi(400, 'telefone_invalido', 'Telefone inválido. Use DDI + DDD + número, por exemplo 5571988124471.');
    return t;
  }

  async contato(ctx: Contexto, telefoneBruto: string) {
    const telefone = this.telefoneValido(telefoneBruto);
    const lista = (await this.conversasDa(ctx)).filter((c) => c.telefone === telefone).sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime());
    const ficha = this.o.contatos ? await this.o.contatos.obter(ctx.empresaId, telefone) : undefined;
    if (!lista.length && !ficha) throw naoEncontrado('Contato');
    return this.montarContato(ctx, telefone, lista);
  }

  /** Unidade por onde falar: a pedida, senão a primeira com WhatsApp conectado. */
  private unidadePara(pedida?: UnidadeId): { unidade: UnidadeId; canalId: string } {
    if (!this.o.canalDa) throw indisponivel('O envio por número');
    const candidatas = pedida ? [pedida] : (UNIDADE.options as UnidadeId[]);
    for (const u of candidatas) {
      const c = this.o.canalDa(u);
      if ('canalId' in c) return { unidade: u, canalId: c.canalId };
    }
    const motivo = this.o.canalDa(candidatas[0]!);
    throw new ErroApi(409, 'sem_whatsapp', 'erro' in motivo ? motivo.erro : 'Nenhum WhatsApp conectado.');
  }

  /** Conversa do número (a mais recente da empresa) ou uma nova, como em "Novo contato" da tela. */
  private async conversaDoNumero(ctx: Contexto, telefone: string, nome?: string, unidade?: UnidadeId): Promise<{ conversa: Conversa; nova: boolean }> {
    const existentes = (await this.conversasDa(ctx)).filter((c) => c.telefone === telefone && (!unidade || c.unidade === unidade)).sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime());
    if (existentes[0]) return { conversa: existentes[0], nova: false };
    const destino = this.unidadePara(unidade);
    const agora = this.agora();
    const r = await this.o.repo.buscarOuCriarConversa({ empresaId: ctx.empresaId, unidade: destino.unidade, canalId: destino.canalId, telefone, nome: nome || undefined, agora });
    if (r.nova) {
      await this.o.repo.registrarEvento({ tipo: 'conversa_nova', conversaId: r.conversa.id, unidade: r.conversa.unidade, em: agora, dados: { por: this.autor(ctx), origem: 'api' } });
      if (this.o.modoInicial) await this.o.sintonia.mudarModo(r.conversa.id, await this.o.modoInicial());
    }
    return { conversa: (await this.o.repo.buscarConversa(r.conversa.id)) ?? r.conversa, nova: r.nova };
  }

  private async salvarFicha(ctx: Contexto, telefone: string, nomeConversa: string | undefined, edicao: z.infer<typeof EdicaoContato>) {
    if (!this.o.contatos) return;
    const defs = await this.campos(ctx);
    // Campos podem vir pelo id ou pelo nome.
    const campos = edicao.campos
      ? Object.fromEntries(Object.entries(edicao.campos).map(([k, v]) => [defs.find((d) => d.id === k || d.nome.toLowerCase() === k.toLowerCase())?.id ?? k, v]))
      : undefined;
    const atual = (await this.o.contatos.obter(ctx.empresaId, telefone)) ?? contatoVazio(telefone, nomeConversa);
    let nova: Contato;
    try {
      nova = aplicarEdicao(atual, { ...edicao, ...(campos ? { campos } : {}) }, defs);
    } catch (e) {
      throw new ErroApi(400, 'dados_invalidos', (e as Error).message);
    }
    await this.o.contatos.salvar(ctx.empresaId, nova, this.autor(ctx));
  }

  async criarContato(ctx: Contexto, d: z.infer<typeof NovoContato>) {
    const telefone = this.telefoneValido(d.telefone);
    const { telefone: _t, unidade, ...edicao } = d;
    const r = await this.conversaDoNumero(ctx, telefone, d.nome ?? undefined, unidade);
    if (Object.values(edicao).some((v) => v !== undefined)) await this.salvarFicha(ctx, telefone, r.conversa.nome, edicao);
    return { criado: r.nova, contato: await this.contato(ctx, telefone) };
  }

  async atualizarContato(ctx: Contexto, telefoneBruto: string, edicao: z.infer<typeof EdicaoContato>) {
    const telefone = this.telefoneValido(telefoneBruto);
    const conversas = (await this.conversasDa(ctx)).filter((c) => c.telefone === telefone);
    const ficha = this.o.contatos ? await this.o.contatos.obter(ctx.empresaId, telefone) : undefined;
    if (!conversas.length && !ficha) throw naoEncontrado('Contato');
    await this.salvarFicha(ctx, telefone, conversas[0]?.nome, edicao);
    if (edicao.nome !== undefined) for (const c of conversas) if ((c.nome ?? null) !== (edicao.nome ?? null)) await this.o.sintonia.renomearCliente(c.id, edicao.nome ?? null);
    return this.contato(ctx, telefone);
  }

  // ---------------------------------------------------------------- conversas e mensagens

  private async comTags(ctx: Contexto, lista: Conversa[]) {
    const t = this.o.tags?.(ctx.empresaId);
    const mapa = t ? await t.dasConversas(lista.map((c) => c.id)) : new Map();
    return lista.map((c) => ({
      ...resumoConversa(c),
      criadaEm: c.criadaEm.toISOString(),
      atualizadaEm: c.atualizadaEm.toISOString(),
      ultimaMensagemCliente: c.ultimaMensagemCliente?.toISOString() ?? null,
      ultimaMensagemEquipe: c.ultimaMensagemEquipe?.toISOString() ?? null,
      tags: (mapa.get(c.id) ?? []).filter((x: { funilId?: string }) => !x.funilId).map((x: { id: string; nome: string; cor: string }) => ({ id: x.id, nome: x.nome, cor: x.cor })),
    }));
  }

  async listarConversas(ctx: Contexto, q: z.infer<typeof FiltroConversas>) {
    const tel = q.telefone ? q.telefone.replace(/\D/g, '') : '';
    const desde = q.atualizadaDesde ? new Date(q.atualizadaDesde) : undefined;
    const lista = (await this.conversasDa(ctx)).filter(
      (c) => (!q.unidade || c.unidade === q.unidade) && (!q.etapa || c.etapa === q.etapa) && (!tel || c.telefone.includes(tel)) && (!desde || c.atualizadaEm >= desde),
    );
    const p = paginar(lista, (c) => c.atualizadaEm, (c) => c.id, q.limite, q.cursor);
    return { dados: await this.comTags(ctx, p.dados), proximoCursor: p.proximoCursor };
  }

  async verConversa(ctx: Contexto, id: string) {
    const c = await this.conversa(ctx, id);
    const [base] = await this.comTags(ctx, [c]);
    const f = this.o.funis?.(ctx.empresaId);
    const funis = f ? (await f.daConversa(c)).map((x) => ({ funilId: x.funilId, funilNome: x.funilNome, etapa: x.etapa ? { id: x.etapa.id, nome: x.etapa.nome } : null, desde: x.desde })) : [];
    return { ...base!, resumo: c.resumo ?? null, funis, valor: f ? await f.valor(c) : null };
  }

  async listarMensagens(ctx: Contexto, id: string, q: z.infer<typeof FiltroMensagens>) {
    const c = await this.conversa(ctx, id);
    // Vem em ordem cronológica: a posição desempata mensagens do mesmo instante.
    const lista = await this.o.repo.mensagens(c.id, 2000);
    const cur = lerCursor(q.cursor);
    let fim = lista.length;
    if (cur) {
      const i = lista.findIndex((m) => m.id === cur.id);
      fim = i >= 0 ? i : lista.filter((m) => m.em.getTime() < cur.em.getTime()).length;
    }
    const inicio = Math.max(0, fim - q.limite);
    const dados = lista.slice(inicio, fim).reverse();
    const ultimo = dados.at(-1);
    return { dados: dados.map(resumoMensagem), proximoCursor: inicio > 0 && ultimo ? codificarCursor(ultimo.em, ultimo.id) : null };
  }

  /** Envia pelo mesmo caminho da tela (WhatsApp oficial ou Evolution, janela de 24 h, follow-ups, eventos). */
  async enviarNaConversa(ctx: Contexto, id: string, textoBruto: string) {
    const texto = Texto.parse(textoBruto);
    const c = await this.conversa(ctx, id);
    await this.o.sintonia.equipeEnviou(c.id, texto, this.autor(ctx));
    const m = [...(await this.o.repo.mensagens(c.id, 5))].reverse().find((x) => x.autor === 'equipe' && x.texto === texto);
    return { conversaId: c.id, mensagem: m ? resumoMensagem(m) : null };
  }

  async enviarParaNumero(ctx: Contexto, d: z.infer<typeof EnvioNumero>) {
    const telefone = this.telefoneValido(d.telefone);
    const r = await this.conversaDoNumero(ctx, telefone, d.nome, d.unidade);
    try {
      return { ...(await this.enviarNaConversa(ctx, r.conversa.id, d.texto)), conversaNova: r.nova };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (e instanceof ErroApi) throw e;
      throw new ErroApi(status && status < 500 ? status : 502, (e as { codigo?: string }).codigo ?? 'envio_falhou', `A conversa está aberta, mas a mensagem não saiu: ${(e as Error).message}`, { conversaId: r.conversa.id });
    }
  }

  // ---------------------------------------------------------------- funis e leads

  async listarFunis(ctx: Contexto) {
    const f = this.funis(ctx);
    const lista = await f.listarComEtapas({ empresaId: ctx.empresaId });
    return {
      dados: lista.map((x) => ({
        id: x.id, nome: x.nome, sistema: x.sistema, leads: x.conversas,
        etapas: x.etapas.map((e) => ({ id: e.id, nome: e.nome, cor: e.cor, ordem: e.ordem, leads: e.conversas, ...(e.chaveSistema ? { chaveSistema: e.chaveSistema } : {}) })),
      })),
    };
  }

  async leadsDaEtapa(ctx: Contexto, funilId: string, etapaId: string, q: { limite: number; cursor?: string }) {
    const f = this.funis(ctx);
    await f.exigir(funilId).catch(() => { throw naoEncontrado('Funil'); });
    await f.exigirEtapa(funilId, etapaId).catch(() => { throw naoEncontrado('Etapa'); });
    const c = lerCursor(q.cursor);
    const r = await f.quadro(funilId, { escopo: { empresaId: ctx.empresaId }, etapaId, offset: 0, limite: q.limite, ...(c ? { apos: c } : {}) });
    const col = r.colunas[0];
    const cartoes = col?.cartoes ?? [];
    const ultimo = cartoes.at(-1);
    return {
      dados: cartoes.map((x) => ({
        conversaId: x.conversaId, nome: x.nome, telefone: x.telefone, unidade: x.unidade, etapa: x.etapa,
        valor: x.valor, desde: new Date(x.desde).toISOString(), atualizadaEm: new Date(x.atualizadaEm).toISOString(),
        responsavel: x.dona, tags: x.tags.map((t) => ({ id: t.id, nome: t.nome, cor: t.cor })),
      })),
      total: col?.total ?? 0,
      proximoCursor: cartoes.length === q.limite && ultimo ? codificarCursor(ultimo.atualizadaEm, ultimo.conversaId) : null,
    };
  }

  async moverLead(ctx: Contexto, conversaId: string, d: z.infer<typeof MoverLead>) {
    const f = this.funis(ctx);
    const c = await this.conversa(ctx, conversaId);
    const lista = await f.listar();
    let funilId = d.funilId;
    let etapaId = d.etapaId;
    if (funilId && !lista.some((x) => x.id === funilId)) throw naoEncontrado('Funil');
    if (!etapaId) {
      // Pelo nome da etapa: no funil pedido ou, sem funil, no do sistema e depois nos outros.
      const alvos = funilId ? lista.filter((x) => x.id === funilId) : lista;
      for (const x of alvos) {
        const e = (await f.etapas(x.id)).find((y) => y.nome.toLowerCase() === d.etapa!.toLowerCase());
        if (e) { funilId = x.id; etapaId = e.id; break; }
      }
      if (!etapaId) throw naoEncontrado('Etapa');
    }
    if (!funilId) {
      for (const x of lista) if ((await f.etapas(x.id)).some((y) => y.id === etapaId)) { funilId = x.id; break; }
      if (!funilId) throw naoEncontrado('Etapa');
    }
    await f.exigirEtapa(funilId, etapaId).catch(() => { throw naoEncontrado('Etapa'); });
    const r = await f.mover(c.id, funilId, etapaId, { nome: this.autor(ctx), id: null });
    return { mudou: r.mudou, conversa: await this.verConversa(ctx, c.id) };
  }

  async definirValor(ctx: Contexto, conversaId: string, valor: number | null) {
    const f = this.funis(ctx);
    const c = await this.conversa(ctx, conversaId);
    return { conversaId: c.id, valor: await f.definirValor(c, valor, this.autor(ctx)) };
  }

  // ---------------------------------------------------------------- tags

  async listarTags(ctx: Contexto) {
    const t = this.tags(ctx);
    return { dados: (await t.soltas()).map((x) => ({ id: x.id, nome: x.nome, cor: x.cor, grupo: x.grupo ?? null })) };
  }

  private async tagPedida(ctx: Contexto, d: { tagId?: string; nome?: string }) {
    const t = this.tags(ctx);
    if (d.tagId) {
      const tag = await t.exigir(d.tagId).catch(() => undefined);
      if (!tag) throw naoEncontrado('Tag');
      return tag;
    }
    const tag = await t.porNome(d.nome!);
    if (!tag) throw new ErroApi(404, 'nao_encontrado', `A tag "${d.nome}" não existe. Crie na tela Vendas › Tags ou use uma existente.`);
    return tag;
  }

  async aplicarTag(ctx: Contexto, conversaId: string, d: z.infer<typeof AplicarTag>) {
    const t = this.tags(ctx);
    const c = await this.conversa(ctx, conversaId);
    const tag = await this.tagPedida(ctx, d);
    const r = await t.marcar(c, tag.id, this.autor(ctx));
    if (r.mudou && !tag.funilId) await this.o.repo.registrarEvento({ tipo: 'tag_marcada', conversaId: c.id, unidade: c.unidade, em: this.agora(), dados: { tagId: tag.id, nome: tag.nome, por: this.autor(ctx), porId: null } });
    return { mudou: r.mudou, tags: (await t.daConversa(c.id)).filter((x) => !x.funilId).map((x) => ({ id: x.id, nome: x.nome, cor: x.cor })) };
  }

  async removerTag(ctx: Contexto, conversaId: string, tagId: string) {
    const t = this.tags(ctx);
    const c = await this.conversa(ctx, conversaId);
    const tag = await this.tagPedida(ctx, { tagId });
    const r = await t.desmarcar(c, tag.id, this.autor(ctx));
    if (r.mudou && !tag.funilId) await this.o.repo.registrarEvento({ tipo: 'tag_desmarcada', conversaId: c.id, unidade: c.unidade, em: this.agora(), dados: { tagId: tag.id, nome: tag.nome, por: this.autor(ctx), porId: null } });
    return { mudou: r.mudou, tags: (await t.daConversa(c.id)).filter((x) => !x.funilId).map((x) => ({ id: x.id, nome: x.nome, cor: x.cor })) };
  }

  // ---------------------------------------------------------------- agendamentos

  async listarAgendamentos(ctx: Contexto, q: z.infer<typeof FiltroAgendamentos>) {
    const agora = this.agora();
    const de = q.de ? new Date(q.de) : new Date(agora.getTime() - 86400_000);
    const ate = q.ate ? new Date(q.ate) : new Date(de.getTime() + 30 * 86400_000);
    if (ate.getTime() - de.getTime() > 93 * 86400_000) throw new ErroApi(400, 'periodo_longo', 'Peça no máximo 93 dias por vez.');
    if (ate <= de) throw new ErroApi(400, 'periodo_invalido', '"ate" precisa ser depois de "de".');
    const agenda = (await agendamentosEntre(this.o.repo, de, ate, { empresaId: ctx.empresaId })).map((a) => ({
      id: a.id, origem: 'agenda', status: 'marcado', inicio: a.inicio.toISOString(), fim: new Date(a.inicio.getTime() + a.duracaoMin * 60_000).toISOString(),
      duracaoMin: a.duracaoMin, titulo: a.servico, profissional: a.profissional, unidade: a.unidade,
      cliente: { nome: a.cliente, telefone: a.telefone, email: null }, conversaId: a.conversaId, por: a.por,
    }));
    const reunioes = this.o.pool
      ? (await this.o.pool.query(
          `select r.id, r.nome, r.telefone, r.email, r.observacao, r.inicio, r.fim, r.status, r.link_id, l.titulo, l.local
             from sintonia.reunioes r join sintonia.links_reuniao l on l.id = r.link_id
            where r.empresa_id = $1 and r.inicio < $3 and r.fim > $2 order by r.inicio limit 500`,
          [ctx.empresaId, de, ate],
        )).rows.map((r) => this.reuniaoParaApi(r))
      : [];
    return { dados: [...agenda, ...reunioes].sort((a, b) => a.inicio.localeCompare(b.inicio)), de: de.toISOString(), ate: ate.toISOString() };
  }

  private reuniaoParaApi(r: Record<string, unknown>) {
    const inicio = new Date(r.inicio as string);
    const fim = new Date(r.fim as string);
    return {
      id: String(r.id), origem: 'link', status: r.status === 'cancelada' ? 'cancelado' : 'marcado', inicio: inicio.toISOString(), fim: fim.toISOString(),
      duracaoMin: Math.round((fim.getTime() - inicio.getTime()) / 60_000), titulo: (r.titulo as string) ?? null, local: (r.local as string) || null,
      linkId: String(r.link_id), cliente: { nome: (r.nome as string) ?? null, telefone: (r.telefone as string) ?? null, email: (r.email as string) ?? null },
      observacao: (r.observacao as string) || null,
    };
  }

  async linksDeAgendamento(ctx: Contexto) {
    const pool = this.pool('O agendamento por link');
    const { rows } = await pool.query('select id, slug, titulo, duracao_min, ativo from sintonia.links_reuniao where empresa_id = $1 order by criado_em', [ctx.empresaId]);
    return { dados: rows.map((r) => ({ id: String(r.id), titulo: String(r.titulo), duracaoMin: Number(r.duracao_min), ativo: Boolean(r.ativo), slug: String(r.slug) })) };
  }

  async criarAgendamento(ctx: Contexto, d: z.infer<typeof NovoAgendamento>) {
    const pool = this.pool('O agendamento por link');
    if (!d.telefone && !d.email) throw new ErroApi(400, 'dados_invalidos', 'Informe o telefone ou o e-mail de quem vai participar.');
    const { rows } = await pool.query('select * from sintonia.links_reuniao where id = $1 and empresa_id = $2', [d.linkId, ctx.empresaId]);
    const link = rows[0] as (LinkReuniao & Record<string, unknown>) | undefined;
    if (!link || !link.ativo) throw naoEncontrado('Link de agendamento');
    const marcadas = (await pool.query(`select inicio, fim from sintonia.reunioes where link_id = $1 and status = 'marcada' and fim > now()`, [d.linkId])).rows;
    const livres = horariosLivres({ ...link, duracao_min: Number(link.duracao_min), antecedencia_h: Number(link.antecedencia_h), janela_dias: Number(link.janela_dias) }, marcadas, this.agora());
    if (!livres.some((x) => x.data === d.data && x.horarios.includes(d.hora))) throw new ErroApi(409, 'horario_ocupado', 'Esse horário não está livre. Veja os horários em /reservar/<slug> do link.');
    const inicio = instante(d.data, d.hora);
    const fim = new Date(inicio.getTime() + Number(link.duracao_min) * 60_000);
    const id = randomUUID();
    try {
      await pool.query(
        `insert into sintonia.reunioes (id, link_id, empresa_id, nome, telefone, email, observacao, inicio, fim) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, d.linkId, ctx.empresaId, d.nome, d.telefone ?? null, d.email ?? null, d.observacao ?? '', inicio, fim],
      );
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ErroApi(409, 'horario_ocupado', 'Esse horário acabou de ser ocupado.');
      throw e;
    }
    const r = this.reuniaoParaApi({ id, nome: d.nome, telefone: d.telefone, email: d.email, observacao: d.observacao, inicio, fim, status: 'marcada', link_id: d.linkId, titulo: link.titulo, local: link.local });
    this.o.aoReuniao?.('criado', ctx.empresaId, r);
    return r;
  }

  async cancelarAgendamento(ctx: Contexto, id: string) {
    const pool = this.pool('O agendamento por link');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroApi(400, 'so_link', 'Pela API dá para cancelar só os agendamentos feitos pelos links (origem "link").');
    const { rows } = await pool.query(
      `update sintonia.reunioes r set status = 'cancelada' from sintonia.links_reuniao l
        where r.id = $1 and r.empresa_id = $2 and l.id = r.link_id and r.status = 'marcada'
        returning r.*, l.titulo, l.local`,
      [id, ctx.empresaId],
    );
    if (!rows[0]) {
      const existe = await pool.query('select status from sintonia.reunioes where id = $1 and empresa_id = $2', [id, ctx.empresaId]);
      if (!existe.rows[0]) throw naoEncontrado('Agendamento');
      return { ...this.reuniaoParaApi({ ...existe.rows[0], id }), status: 'cancelado', mudou: false };
    }
    const r = this.reuniaoParaApi(rows[0]);
    this.o.aoReuniao?.('cancelado', ctx.empresaId, r);
    return { ...r, mudou: true };
  }

  // ---------------------------------------------------------------- tarefas (rotina)

  async listarTarefas(ctx: Contexto, q: z.infer<typeof FiltroTarefas>) {
    const pool = this.pool('As tarefas');
    const c = lerCursor(q.cursor);
    const { rows } = await pool.query(
      `select * from sintonia.rotina_tarefas
        where empresa_id = $1
          and ($2 = 'todas' or ($2 = 'feitas') = feita)
          and ($3::text is null or responsavel_id = $3)
          and ($4::uuid is null or conversa_id = $4)
          and ($5::timestamptz is null or (criada_em, id) < ($5, $6::uuid))
        order by criada_em desc, id desc limit $7`,
      [ctx.empresaId, q.situacao, q.responsavelId ?? null, q.conversaId ?? null, c?.em ?? null, c?.id ?? '00000000-0000-0000-0000-000000000000', q.limite + 1],
    );
    const pagina = rows.slice(0, q.limite);
    const ultimo = pagina.at(-1);
    return { dados: pagina.map((r) => this.tarefaParaApi(r)), proximoCursor: rows.length > q.limite && ultimo ? codificarCursor(ultimo.criada_em, String(ultimo.id)) : null };
  }

  private tarefaParaApi(r: Record<string, unknown>) {
    return {
      id: String(r.id), titulo: String(r.titulo), descricao: String(r.descricao ?? ''), venceEm: r.vence_em ? new Date(r.vence_em as string).toISOString() : null,
      responsavelId: String(r.responsavel_id), conversaId: r.conversa_id ? String(r.conversa_id) : null, prioridade: String(r.prioridade),
      feita: Boolean(r.feita), feitaEm: r.feita_em ? new Date(r.feita_em as string).toISOString() : null, criadaEm: new Date(r.criada_em as string).toISOString(),
    };
  }

  async criarTarefa(ctx: Contexto, d: z.infer<typeof NovaTarefa>) {
    const pool = this.pool('As tarefas');
    const equipe = this.o.contas ? (await this.o.contas.listarUsuarios(ctx.empresaId)).filter((u) => u.ativo) : [];
    const responsavelId = d.responsavelId ?? ctx.criadaPor;
    if (!responsavelId) throw new ErroApi(400, 'dados_invalidos', 'Informe responsavelId (a pessoa da equipe que vai fazer a tarefa).');
    if (this.o.contas && !equipe.some((u) => u.id === responsavelId)) throw new ErroApi(400, 'responsavel_invalido', 'Essa pessoa não está ativa na equipe.');
    const c = d.conversaId ? await this.conversa(ctx, d.conversaId) : undefined;
    const id = randomUUID();
    const { rows } = await pool.query(
      `insert into sintonia.rotina_tarefas (id, empresa_id, titulo, descricao, vence_em, responsavel_id, criado_por, conversa_id, cliente_nome, prioridade)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [id, ctx.empresaId, d.titulo, d.descricao, d.venceEm, responsavelId, `api:${ctx.chaveId}`, c?.id ?? null, c ? c.nome || c.telefone : null, d.prioridade],
    );
    return this.tarefaParaApi(rows[0]);
  }

  async equipe(ctx: Contexto) {
    const lista = this.o.contas ? await this.o.contas.listarUsuarios(ctx.empresaId) : [];
    return { dados: lista.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome, papel: u.papel, unidades: u.unidades })) };
  }
}
