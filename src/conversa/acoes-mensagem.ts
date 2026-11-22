import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import type { Conversa, Mensagem } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import type { AcaoRecebida, AlvoMensagem, CanalWhatsApp, MidiaEnvio } from '../channels/tipos.js';
import type { Usuario } from '../auth/contas.js';
import type { ClienteClaude } from '../ai/agente.js';
import type { Auditoria } from '../seguranca/auditoria.js';
import { contatoVazio, type ArmazemContatos } from '../contatos/contatos.js';
import { ehGestor, podeVer } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import { partesBahia } from '../util/tempo.js';

/**
 * menu-mensagem: o que dá para fazer ao segurar uma mensagem da conversa (como no WhatsApp do iPhone).
 * Reagir, responder citando, encaminhar, editar, apagar (para todos ou só daqui), fixar no topo, favoritar,
 * levar para as observações da ficha e traduzir. Guardado na migração 730 (nada é apagado do banco de verdade).
 *
 * O que vai também para o WhatsApp depende do canal (CanalWhatsApp, métodos opcionais):
 * - Evolution: reação, resposta citando, editar (até 15 min) e apagar para todos;
 * - API oficial (Meta): reação e resposta citando; editar e apagar para todos não existem lá.
 * Mensagem sem id no WhatsApp (ex.: nota do sistema, importada sem id) só tem as ações da Sintonia.
 *
 * Quem pode: quem vê a conversa reage, responde, fixa, favorita e anota. Editar e apagar: a gestão pode tudo;
 * quem atende só as mensagens que ela mesma mandou.
 */

export type Apagada = 'todos' | 'aqui' | 'cliente';
export interface Reacao {
  /** 'cliente', 'loja' (pelo celular da loja) ou 'u:<id da pessoa>'. */
  quem: string;
  nome: string | null;
  emoji: string;
  em: Date;
}
export interface ExtrasMensagem {
  citadaId: string | null;
  apagada: Apagada | null;
  apagadaPor: string | null;
  apagadaEm: Date | null;
  editadaEm: Date | null;
  editadaPor: string | null;
  textoOriginal: string | null;
}
export interface Fixada {
  mensagemId: string;
  por: string | null;
  em: Date;
}
export interface AcoesDaConversa {
  reacoes: Map<string, Reacao[]>;
  extras: Map<string, ExtrasMensagem>;
  favoritas: Set<string>;
  fixada: Fixada | null;
}

export interface ArmazemAcoesMensagem {
  /** emoji vazio ou null tira a reação desta pessoa. */
  reagir(conversaId: string, mensagemId: string, quem: string, nome: string | null, emoji: string | null, em: Date): Promise<void>;
  favoritar(usuarioId: string, conversaId: string, mensagemId: string, sim: boolean, em: Date): Promise<void>;
  /** Favoritas da pessoa (mais nova primeiro). */
  favoritas(usuarioId: string, limite?: number): Promise<Array<{ mensagemId: string; conversaId: string; em: Date }>>;
  fixar(conversaId: string, mensagemId: string | null, por: string | null, em: Date): Promise<void>;
  /** Grava (junta) o que aconteceu com a mensagem. */
  marcar(conversaId: string, mensagemId: string, p: Partial<ExtrasMensagem>): Promise<void>;
  extras(mensagemId: string): Promise<ExtrasMensagem | undefined>;
  daConversa(conversaId: string, usuarioId: string | null): Promise<AcoesDaConversa>;
  /** Quando a mensagem foi entregue/lida (só o Postgres sabe a hora). */
  entregaEm?(mensagemId: string): Promise<Date | null>;
}

const extrasVazio = (): ExtrasMensagem => ({ citadaId: null, apagada: null, apagadaPor: null, apagadaEm: null, editadaEm: null, editadaPor: null, textoOriginal: null });

export class AcoesMensagemMemoria implements ArmazemAcoesMensagem {
  private reacoes = new Map<string, { conversaId: string; lista: Map<string, Reacao> }>();
  private favs = new Map<string, Map<string, { conversaId: string; em: Date }>>();
  private fixadas = new Map<string, Fixada>();
  private ext = new Map<string, ExtrasMensagem & { conversaId: string }>();
  async reagir(conversaId: string, mensagemId: string, quem: string, nome: string | null, emoji: string | null, em: Date) {
    const r = this.reacoes.get(mensagemId) ?? { conversaId, lista: new Map() };
    if (emoji) r.lista.set(quem, { quem, nome, emoji, em });
    else r.lista.delete(quem);
    this.reacoes.set(mensagemId, r);
  }
  async favoritar(usuarioId: string, conversaId: string, mensagemId: string, sim: boolean, em: Date) {
    const f = this.favs.get(usuarioId) ?? new Map();
    if (sim) f.set(mensagemId, { conversaId, em });
    else f.delete(mensagemId);
    this.favs.set(usuarioId, f);
  }
  async favoritas(usuarioId: string, limite = 200) {
    return [...(this.favs.get(usuarioId) ?? new Map<string, { conversaId: string; em: Date }>())]
      .map(([mensagemId, v]) => ({ mensagemId, conversaId: v.conversaId, em: v.em }))
      .sort((a, b) => b.em.getTime() - a.em.getTime())
      .slice(0, limite);
  }
  async fixar(conversaId: string, mensagemId: string | null, por: string | null, em: Date) {
    if (mensagemId) this.fixadas.set(conversaId, { mensagemId, por, em });
    else this.fixadas.delete(conversaId);
  }
  async marcar(conversaId: string, mensagemId: string, p: Partial<ExtrasMensagem>) {
    this.ext.set(mensagemId, { ...extrasVazio(), ...this.ext.get(mensagemId), ...p, conversaId });
  }
  async extras(mensagemId: string) {
    const e = this.ext.get(mensagemId);
    if (!e) return undefined;
    const { conversaId: _c, ...resto } = e;
    return resto;
  }
  async daConversa(conversaId: string, usuarioId: string | null): Promise<AcoesDaConversa> {
    const reacoes = new Map<string, Reacao[]>();
    for (const [id, r] of this.reacoes) if (r.conversaId === conversaId && r.lista.size) reacoes.set(id, [...r.lista.values()].sort((a, b) => a.em.getTime() - b.em.getTime()));
    const extras = new Map<string, ExtrasMensagem>();
    for (const [id, e] of this.ext) if (e.conversaId === conversaId) { const { conversaId: _c, ...resto } = e; extras.set(id, resto); }
    const favoritas = new Set<string>();
    if (usuarioId) for (const [id, v] of this.favs.get(usuarioId) ?? []) if (v.conversaId === conversaId) favoritas.add(id);
    return { reacoes, extras, favoritas, fixada: this.fixadas.get(conversaId) ?? null };
  }
}

export class AcoesMensagemPostgres implements ArmazemAcoesMensagem {
  constructor(private readonly pool: pg.Pool) {}
  async reagir(conversaId: string, mensagemId: string, quem: string, nome: string | null, emoji: string | null, em: Date) {
    if (!emoji) {
      await this.pool.query('delete from sintonia.mensagem_reacoes where mensagem_id = $1 and quem = $2', [mensagemId, quem]);
      return;
    }
    await this.pool.query(
      `insert into sintonia.mensagem_reacoes (mensagem_id, conversa_id, quem, nome, emoji, em) values ($1, $2, $3, $4, $5, $6)
       on conflict (mensagem_id, quem) do update set emoji = excluded.emoji, nome = coalesce(excluded.nome, mensagem_reacoes.nome), em = excluded.em`,
      [mensagemId, conversaId, quem, nome, emoji, em],
    );
  }
  async favoritar(usuarioId: string, conversaId: string, mensagemId: string, sim: boolean, em: Date) {
    if (sim)
      await this.pool.query(
        `insert into sintonia.mensagem_favoritas (usuario_id, mensagem_id, conversa_id, em) values ($1, $2, $3, $4) on conflict (usuario_id, mensagem_id) do nothing`,
        [usuarioId, mensagemId, conversaId, em],
      );
    else await this.pool.query('delete from sintonia.mensagem_favoritas where usuario_id = $1 and mensagem_id = $2', [usuarioId, mensagemId]);
  }
  async favoritas(usuarioId: string, limite = 200) {
    const { rows } = await this.pool.query<{ mensagem_id: string; conversa_id: string; em: Date }>(
      'select mensagem_id, conversa_id, em from sintonia.mensagem_favoritas where usuario_id = $1 order by em desc limit $2',
      [usuarioId, limite],
    );
    return rows.map((r) => ({ mensagemId: r.mensagem_id, conversaId: r.conversa_id, em: r.em }));
  }
  async fixar(conversaId: string, mensagemId: string | null, por: string | null, em: Date) {
    if (!mensagemId) {
      await this.pool.query('delete from sintonia.conversa_fixada where conversa_id = $1', [conversaId]);
      return;
    }
    await this.pool.query(
      `insert into sintonia.conversa_fixada (conversa_id, mensagem_id, por, em) values ($1, $2, $3, $4)
       on conflict (conversa_id) do update set mensagem_id = excluded.mensagem_id, por = excluded.por, em = excluded.em`,
      [conversaId, mensagemId, por, em],
    );
  }
  async marcar(conversaId: string, mensagemId: string, p: Partial<ExtrasMensagem>) {
    const col: Record<keyof ExtrasMensagem, string> = {
      citadaId: 'citada_id', apagada: 'apagada', apagadaPor: 'apagada_por', apagadaEm: 'apagada_em', editadaEm: 'editada_em', editadaPor: 'editada_por', textoOriginal: 'texto_original',
    };
    const chaves = (Object.keys(p) as Array<keyof ExtrasMensagem>).filter((k) => p[k] !== undefined);
    if (!chaves.length) return;
    const nomes = chaves.map((k) => col[k]);
    const valores = chaves.map((k) => p[k]);
    await this.pool.query(
      `insert into sintonia.mensagem_extras (mensagem_id, conversa_id, ${nomes.join(', ')}) values ($1, $2, ${nomes.map((_, i) => `$${i + 3}`).join(', ')})
       on conflict (mensagem_id) do update set ${nomes.map((n) => `${n} = excluded.${n}`).join(', ')}`,
      [mensagemId, conversaId, ...valores],
    );
  }
  private static extras(r: Record<string, unknown>): ExtrasMensagem {
    return {
      citadaId: (r.citada_id as string | null) ?? null,
      apagada: (r.apagada as Apagada | null) ?? null,
      apagadaPor: (r.apagada_por as string | null) ?? null,
      apagadaEm: (r.apagada_em as Date | null) ?? null,
      editadaEm: (r.editada_em as Date | null) ?? null,
      editadaPor: (r.editada_por as string | null) ?? null,
      textoOriginal: (r.texto_original as string | null) ?? null,
    };
  }
  async extras(mensagemId: string) {
    const { rows } = await this.pool.query('select * from sintonia.mensagem_extras where mensagem_id = $1', [mensagemId]);
    return rows[0] ? AcoesMensagemPostgres.extras(rows[0]) : undefined;
  }
  async daConversa(conversaId: string, usuarioId: string | null): Promise<AcoesDaConversa> {
    const [r, e, f, x] = await Promise.all([
      this.pool.query<{ mensagem_id: string; quem: string; nome: string | null; emoji: string; em: Date }>(
        'select mensagem_id, quem, nome, emoji, em from sintonia.mensagem_reacoes where conversa_id = $1 order by em',
        [conversaId],
      ),
      this.pool.query('select * from sintonia.mensagem_extras where conversa_id = $1', [conversaId]),
      usuarioId
        ? this.pool.query<{ mensagem_id: string }>('select mensagem_id from sintonia.mensagem_favoritas where conversa_id = $1 and usuario_id = $2', [conversaId, usuarioId])
        : Promise.resolve({ rows: [] as Array<{ mensagem_id: string }> }),
      this.pool.query<{ mensagem_id: string; por: string | null; em: Date }>('select mensagem_id, por, em from sintonia.conversa_fixada where conversa_id = $1', [conversaId]),
    ]);
    const reacoes = new Map<string, Reacao[]>();
    for (const l of r.rows) reacoes.set(l.mensagem_id, [...(reacoes.get(l.mensagem_id) ?? []), { quem: l.quem, nome: l.nome, emoji: l.emoji, em: l.em }]);
    const extras = new Map<string, ExtrasMensagem>(e.rows.map((l) => [l.mensagem_id as string, AcoesMensagemPostgres.extras(l)]));
    const fx = x.rows[0];
    return { reacoes, extras, favoritas: new Set(f.rows.map((l) => l.mensagem_id)), fixada: fx ? { mensagemId: fx.mensagem_id, por: fx.por, em: fx.em } : null };
  }
  async entregaEm(mensagemId: string) {
    const { rows } = await this.pool.query<{ entrega_em: Date | null }>('select entrega_em from sintonia.mensagens where id = $1', [mensagemId]);
    return rows[0]?.entrega_em ?? null;
  }
}

// ---------------------------------------------------------------------------------------- regras

/** O WhatsApp só deixa editar até 15 minutos depois de mandar. */
export const PRAZO_EDITAR_MS = 15 * 60_000;
/** E apagar para todos até cerca de 2 dias depois. */
export const PRAZO_APAGAR_MS = 48 * 3600_000;
export const EMOJIS_RAPIDOS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '✅'] as const;

const daLoja = (m: Mensagem) => m.autor === 'equipe' || m.autor === 'ia';
/** Editar e apagar: a gestão pode tudo; quem atende, só o que ela mesma mandou. Sem login (teste local): liberado. */
export function podeMexerNaMensagem(u: Pick<Usuario, 'papel' | 'nome'> | undefined, m: Mensagem): boolean {
  if (!u) return true;
  if (ehGestor(u)) return true;
  return m.autor === 'equipe' && (m.autorNome ?? '').trim().toLocaleLowerCase('pt-BR') === u.nome.trim().toLocaleLowerCase('pt-BR');
}

/** O que a mensagem mostra no menu (a tela usa para esconder o que não dá). */
export function acoesPossiveis(
  m: Mensagem,
  o: { u?: Pick<Usuario, 'papel' | 'nome'>; canal?: CanalWhatsApp; agora: Date; apagada: Apagada | null; transcrita: boolean },
) {
  const noWhatsApp = Boolean(m.idExterno && o.canal);
  const idade = o.agora.getTime() - new Date(m.em).getTime();
  const mexe = podeMexerNaMensagem(o.u, m);
  const texto = !m.anexo && m.autor !== 'sistema';
  return {
    reagir: !o.apagada && m.autor !== 'sistema',
    reagirNoWhatsApp: Boolean(noWhatsApp && o.canal?.enviarReacao),
    responder: !o.apagada && m.autor !== 'sistema',
    encaminhar: !o.apagada && m.autor !== 'sistema',
    copiar: !o.apagada && Boolean(m.texto) && (texto || Boolean(m.anexo?.legenda)),
    editar: !o.apagada && texto && m.autor === 'equipe' && mexe && idade < PRAZO_EDITAR_MS,
    editarNoWhatsApp: Boolean(noWhatsApp && o.canal?.editarTexto),
    apagarParaTodos: !o.apagada && daLoja(m) && mexe && Boolean(noWhatsApp && o.canal?.apagarParaTodos) && idade < PRAZO_APAGAR_MS,
    apagarAqui: o.apagada !== 'aqui' && mexe && m.autor !== 'sistema',
    transcrever: !o.apagada && (m.anexo?.tipo === 'audio' || m.anexo?.tipo === 'video') && !o.transcrita,
  };
}

// ---------------------------------------------------------------------------------------- rotas

export interface OpcoesAcoesMensagem {
  repo: Repositorio;
  empresaId: string;
  armazem: ArmazemAcoesMensagem;
  sintonia: {
    equipeEnviou(conversaId: string, texto: string, atendente: string, quem?: Usuario, opcoes?: { citada?: AlvoMensagem & { texto: string }; id?: string }): Promise<void>;
    equipeEnviouMidia(conversaId: string, midia: MidiaEnvio & { duracaoSeg?: number }, atendente: string, quem?: Usuario): Promise<{ mensagemId: string }>;
    canalDaConversa(c: Conversa): { canalId: string; canal: CanalWhatsApp } | undefined;
  };
  contatos?: ArmazemContatos;
  auditoria?: Auditoria;
  /** Transcrições já feitas (para não mostrar "Transcrever" de novo). */
  transcritas?: (conversaId: string) => Promise<Set<string>>;
  /** IA para "Traduzir" (sem chave: aviso claro). */
  ia?: { claude: ClienteClaude; modelo: string; ligada: () => boolean };
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

const erro = (msg: string, statusCode: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(msg), { statusCode, ...extra });
const ID = z.string().uuid();
const Emoji = z.string().max(16).refine((v) => !/[<>\n\r\t]/.test(v), 'Emoji inválido');

/** Trecho curto para a citação/faixa (texto do servidor vai para a tela por textContent). */
const trecho = (m: Mensagem) => (m.anexo?.legenda || m.texto || '').slice(0, 300);

/** Acrescenta a nota às observações da ficha, com data e quem (limite de 4000 letras da ficha). */
export function juntarNota(atual: string | null, nota: string, quem: string, em: Date): string {
  const p = partesBahia(em);
  const dois = (n: number) => String(n).padStart(2, '0');
  const linha = `[${dois(p.dia)}/${dois(p.mes)} ${dois(p.hora)}:${dois(p.minuto)} · ${quem}] ${nota.trim()}`;
  const tudo = atual?.trim() ? `${atual.trim()}\n\n${linha}` : linha;
  if (tudo.length > 4000) throw erro('As observações da ficha estão cheias (4000 letras). Apague um pouco na ficha antes de juntar esta.', 413);
  return tudo;
}

export interface ServicoAcoesMensagem {
  /** O que a tela precisa para desenhar a conversa (vai junto do GET /api/conversas/:id). */
  daConversa(c: Conversa, u?: Usuario): Promise<unknown>;
  /** Reação, apagou ou editou que veio pelo webhook. */
  aoReceber(lista: AcaoRecebida[]): Promise<number>;
  /** Registra as rotas (depois de criarServidor, como as outras de conversa). */
  registrar(app: FastifyInstance): void;
}

export function criarAcoesMensagem(o: OpcoesAcoesMensagem): ServicoAcoesMensagem {
  const agora = o.agora ?? (() => new Date());
  const log = o.log ?? (() => {});
  const visivel = (req: FastifyRequest, c: Conversa) => !req.usuario || podeVer(req.usuario, c);
  const quemSou = (req: FastifyRequest) => (req.usuario ? `u:${req.usuario.id}` : 'u:teste');
  const nomeSou = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';

  async function conversaDe(req: FastifyRequest, id = (req.params as { id: string }).id): Promise<Conversa> {
    const c = ID.safeParse(id).success ? await o.repo.buscarConversa(id).catch(() => undefined) : undefined;
    if (!c || c.empresaId !== o.empresaId || !visivel(req, c)) throw erro('Conversa não encontrada', 404);
    return c;
  }
  async function mensagemDe(req: FastifyRequest): Promise<{ c: Conversa; m: Mensagem }> {
    const c = await conversaDe(req);
    const msgId = (req.params as { msgId: string }).msgId;
    const m = ID.safeParse(msgId).success && o.repo.mensagemPorId ? await o.repo.mensagemPorId(msgId) : undefined;
    if (!m || m.conversaId !== c.id) throw erro('Mensagem não encontrada', 404);
    return { c, m };
  }
  const alvo = (c: Conversa, m: Mensagem): AlvoMensagem | null => (m.idExterno ? { idExterno: m.idExterno, telefone: c.telefone, deMim: m.autor !== 'cliente' } : null);
  const responde = (req: FastifyRequest) => {
    if (req.usuario && !pode(req, 'responder')) throw erro('Você não tem permissão para responder clientes.', 403);
  };
  const auditar = (req: FastifyRequest, acao: string, c: Conversa, m: Mensagem, detalhe: Record<string, unknown>) => {
    if (!o.auditoria) return;
    void o.auditoria
      .registrar({ empresaId: o.empresaId, acao, autorId: req.usuario?.id ?? null, autorNome: req.usuario?.nome ?? null, papel: req.usuario?.papel ?? null, alvo: `mensagem:${m.id}`, detalhe: { conversaId: c.id, ...detalhe }, em: agora() })
      .catch((e) => log('Falha ao gravar a auditoria', String(e)));
  };
  /** Erro do canal em palavras simples (a ação local já valeu). */
  const motivo = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Não enviada:\s*/i, '').slice(0, 200);

  /** O que a tela precisa para desenhar a conversa (vai junto do GET /api/conversas/:id). */
  async function daConversa(c: Conversa, u?: Usuario) {
    const a = await o.armazem.daConversa(c.id, u?.id ?? (u ? null : 'teste'));
    const citadas = new Map<string, Mensagem>();
    for (const e of a.extras.values()) {
      if (e.citadaId && !citadas.has(e.citadaId) && o.repo.mensagemPorId) {
        const m = await o.repo.mensagemPorId(e.citadaId).catch(() => undefined);
        if (m && m.conversaId === c.id) citadas.set(e.citadaId, m);
      }
    }
    const eu = u ? `u:${u.id}` : 'u:teste';
    const reacoes: Record<string, Array<{ emoji: string; nome: string | null; minha: boolean; cliente: boolean }>> = {};
    for (const [id, lista] of a.reacoes) reacoes[id] = lista.map((r) => ({ emoji: r.emoji, nome: r.quem === 'cliente' ? null : r.nome, minha: r.quem === eu, cliente: r.quem === 'cliente' }));
    const citacoes: Record<string, { id: string; autor: Mensagem['autor']; autorNome: string | null; texto: string; tipo: string | null; apagada: boolean }> = {};
    const apagadas: Record<string, Apagada> = {};
    const editadas: Record<string, Date> = {};
    for (const [id, e] of a.extras) {
      const cm = e.citadaId ? citadas.get(e.citadaId) : undefined;
      if (cm) citacoes[id] = { id: cm.id, autor: cm.autor, autorNome: cm.autorNome ?? null, texto: a.extras.get(cm.id)?.apagada ? '' : trecho(cm), tipo: cm.anexo?.tipo ?? null, apagada: Boolean(a.extras.get(cm.id)?.apagada) };
      if (e.apagada) apagadas[id] = e.apagada;
      if (e.editadaEm) editadas[id] = e.editadaEm;
    }
    let fixada = null;
    if (a.fixada && o.repo.mensagemPorId && !a.extras.get(a.fixada.mensagemId)?.apagada) {
      const m = await o.repo.mensagemPorId(a.fixada.mensagemId).catch(() => undefined);
      if (m && m.conversaId === c.id) fixada = { mensagemId: m.id, autor: m.autor, autorNome: m.autorNome ?? null, texto: trecho(m), tipo: m.anexo?.tipo ?? null, por: a.fixada.por, em: a.fixada.em };
    }
    const n = o.sintonia.canalDaConversa(c);
    return {
      reacoes, citacoes, apagadas, editadas, favoritas: [...a.favoritas], fixada,
      canal: { tipo: n?.canal.tipo ?? null, reagir: Boolean(n?.canal.enviarReacao), citar: Boolean(n?.canal.enviarCitando), editar: Boolean(n?.canal.editarTexto), apagar: Boolean(n?.canal.apagarParaTodos) },
      prazos: { editarMin: PRAZO_EDITAR_MS / 60_000, apagarHoras: PRAZO_APAGAR_MS / 3600_000 },
    };
  }

  function registrar(app: FastifyInstance) {
    // ---- o que dá para fazer com esta mensagem (a tela pergunta ao abrir o menu)
    app.get('/api/conversas/:id/mensagens/:msgId/acoes', async (req) => {
      const { c, m } = await mensagemDe(req);
      const e = await o.armazem.extras(m.id);
      const transcrita = o.transcritas ? (await o.transcritas(c.id).catch(() => new Set<string>())).has(m.id) : false;
      const n = o.sintonia.canalDaConversa(c);
      return acoesPossiveis(m, { u: req.usuario, canal: n?.canal, agora: agora(), apagada: e?.apagada ?? null, transcrita });
    });

    // ---- Dados: quem mandou e como está a entrega
    app.get('/api/conversas/:id/mensagens/:msgId/dados', async (req) => {
      const { c, m } = await mensagemDe(req);
      const e = await o.armazem.extras(m.id);
      const reacoes = (await o.armazem.daConversa(c.id, null)).reacoes.get(m.id) ?? [];
      return {
        autor: m.autor,
        autorNome: m.autor === 'cliente' ? c.nome ?? null : m.autor === 'ia' ? 'IA da Sintonia' : m.autorNome ?? 'Equipe',
        em: m.em,
        entrega: m.entrega ?? null,
        entregaEm: o.armazem.entregaEm ? await o.armazem.entregaEm(m.id).catch(() => null) : null,
        noWhatsApp: Boolean(m.idExterno),
        editadaEm: e?.editadaEm ?? null,
        editadaPor: e?.editadaPor ?? null,
        apagada: e?.apagada ?? null,
        apagadaPor: e?.apagadaPor ?? null,
        apagadaEm: e?.apagadaEm ?? null,
        reacoes: reacoes.map((r) => ({ emoji: r.emoji, nome: r.quem === 'cliente' ? c.nome ?? 'Cliente' : r.nome, em: r.em })),
      };
    });

    // ---- Reagir
    const CorpoReacao = z.object({ emoji: Emoji.nullable() });
    app.post('/api/conversas/:id/mensagens/:msgId/reacao', async (req) => {
      const b = CorpoReacao.parse(req.body);
      responde(req);
      const { c, m } = await mensagemDe(req);
      if (m.autor === 'sistema') throw erro('Não dá para reagir a um aviso do sistema.', 400);
      if ((await o.armazem.extras(m.id))?.apagada) throw erro('Esta mensagem foi apagada.', 409);
      const emoji = b.emoji?.trim() || null;
      await o.armazem.reagir(c.id, m.id, quemSou(req), nomeSou(req), emoji, agora());
      const a = alvo(c, m);
      const n = o.sintonia.canalDaConversa(c);
      if (!a || !n?.canal.enviarReacao) return { ok: true, noWhatsApp: false, aviso: a ? 'Este canal não recebe reações: ficou só na Sintonia.' : 'Esta mensagem não está no WhatsApp: a reação ficou só na Sintonia.' };
      try {
        await n.canal.enviarReacao(n.canalId, a, emoji ?? '');
        return { ok: true, noWhatsApp: true };
      } catch (e) {
        log('Reação não chegou ao WhatsApp', String(e));
        return { ok: true, noWhatsApp: false, aviso: `A reação ficou na Sintonia, mas não chegou ao WhatsApp: ${motivo(e)}` };
      }
    });

    // ---- Responder citando
    const CorpoResponder = z.object({ texto: z.string().trim().min(1, 'Escreva a resposta.').max(4096), citadaId: ID, atendente: z.string().min(1).max(120).optional() });
    app.post('/api/conversas/:id/responder', async (req) => {
      const b = CorpoResponder.parse(req.body);
      responde(req);
      const c = await conversaDe(req);
      const citada = o.repo.mensagemPorId ? await o.repo.mensagemPorId(b.citadaId) : undefined;
      if (!citada || citada.conversaId !== c.id) throw erro('A mensagem que você está respondendo não está nesta conversa.', 404);
      const a = alvo(c, citada);
      const id = randomUUID();
      const atendente = req.usuario?.nome ?? b.atendente ?? 'Equipe';
      await o.sintonia.equipeEnviou(c.id, b.texto, atendente, req.usuario, { id, ...(a ? { citada: { ...a, texto: trecho(citada) || citada.texto } } : {}) });
      await o.armazem.marcar(c.id, id, { citadaId: citada.id });
      return { ok: true, id, citadoNoWhatsApp: Boolean(a && o.sintonia.canalDaConversa(c)?.canal.enviarCitando) };
    });

    // ---- Encaminhar para outra conversa
    const CorpoEncaminhar = z.object({ para: ID });
    app.post('/api/conversas/:id/mensagens/:msgId/encaminhar', async (req) => {
      const b = CorpoEncaminhar.parse(req.body);
      responde(req);
      const { m } = await mensagemDe(req);
      if ((await o.armazem.extras(m.id))?.apagada) throw erro('Esta mensagem foi apagada.', 409);
      const destino = await conversaDe(req, b.para);
      const atendente = req.usuario?.nome ?? 'Equipe';
      if (m.anexo) {
        const md = await o.repo.midia(m.id);
        const tipo = m.anexo.tipo === 'figurinha' ? null : m.anexo.tipo;
        if (tipo && md?.conteudo && md.anexo.situacao === 'pronta') {
          await o.sintonia.equipeEnviouMidia(destino.id, {
            tipo, conteudo: md.conteudo, mimetype: md.anexo.mimetype ?? 'application/octet-stream',
            ...(md.anexo.nomeArquivo ? { nomeArquivo: md.anexo.nomeArquivo } : {}),
            ...(md.anexo.legenda ? { legenda: md.anexo.legenda } : {}),
            ...(md.anexo.duracaoSeg !== undefined ? { duracaoSeg: md.anexo.duracaoSeg } : {}),
          }, atendente, req.usuario);
          return { ok: true, conversaId: destino.id, comArquivo: true };
        }
        const legenda = m.anexo.legenda?.trim();
        if (!legenda) throw erro(tipo ? 'O arquivo desta mensagem ainda não foi baixado: não dá para encaminhar agora.' : 'Figurinha não dá para encaminhar pela Sintonia.', 409);
        await o.sintonia.equipeEnviou(destino.id, legenda, atendente, req.usuario);
        return { ok: true, conversaId: destino.id, comArquivo: false, aviso: 'O arquivo não pôde ir junto: foi só o texto.' };
      }
      await o.sintonia.equipeEnviou(destino.id, m.texto, atendente, req.usuario);
      return { ok: true, conversaId: destino.id, comArquivo: false };
    });

    // ---- Editar (só texto da loja, recente)
    const CorpoEditar = z.object({ texto: z.string().trim().min(1, 'Escreva o texto novo.').max(4096) });
    app.post('/api/conversas/:id/mensagens/:msgId/editar', async (req) => {
      const b = CorpoEditar.parse(req.body);
      const { c, m } = await mensagemDe(req);
      const e = await o.armazem.extras(m.id);
      if (e?.apagada) throw erro('Esta mensagem foi apagada.', 409);
      if (m.autor !== 'equipe' || m.anexo) throw erro('Só dá para editar mensagem de texto da equipe.', 400);
      if (!podeMexerNaMensagem(req.usuario, m)) throw erro('Você só pode editar as mensagens que você mandou.', 403);
      if (agora().getTime() - new Date(m.em).getTime() >= PRAZO_EDITAR_MS) throw erro('O WhatsApp só deixa editar até 15 minutos depois de mandar.', 409);
      if (b.texto === m.texto) return { ok: true, noWhatsApp: false };
      const a = alvo(c, m);
      const n = o.sintonia.canalDaConversa(c);
      let noWhatsApp = false;
      let aviso: string | undefined;
      if (a && n) {
        if (!n.canal.editarTexto) aviso = n.canal.tipo === 'meta' ? 'A API oficial do WhatsApp não deixa editar: a mensagem mudou só na Sintonia. A cliente continua vendo o texto antigo.' : 'Este canal não edita mensagens: mudou só na Sintonia.';
        else {
          await n.canal.editarTexto(n.canalId, a, b.texto); // se o WhatsApp recusar, nada muda (o erro vai para a tela)
          noWhatsApp = true;
        }
      } else aviso = 'Esta mensagem não está no WhatsApp: mudou só na Sintonia.';
      if (!o.repo.trocarTexto) throw erro('Editar ainda não está disponível.', 501);
      await o.repo.trocarTexto(m.id, b.texto);
      await o.armazem.marcar(c.id, m.id, { editadaEm: agora(), editadaPor: nomeSou(req), ...(e?.textoOriginal ? {} : { textoOriginal: m.texto }) });
      auditar(req, 'mensagem_editada', c, m, { noWhatsApp });
      return { ok: true, noWhatsApp, ...(aviso ? { aviso } : {}) };
    });

    // ---- Apagar: para todos (WhatsApp) ou só daqui (some na Sintonia; o banco guarda, por histórico)
    const CorpoApagar = z.object({ modo: z.enum(['todos', 'aqui']) });
    app.post('/api/conversas/:id/mensagens/:msgId/apagar', async (req) => {
      const b = CorpoApagar.parse(req.body);
      const { c, m } = await mensagemDe(req);
      if (m.autor === 'sistema') throw erro('Aviso do sistema não se apaga.', 400);
      if (!podeMexerNaMensagem(req.usuario, m)) throw erro(m.autor === 'cliente' ? 'Só a gestão apaga mensagens da cliente.' : 'Você só pode apagar as mensagens que você mandou.', 403);
      const e = await o.armazem.extras(m.id);
      if (b.modo === 'todos') {
        if (m.autor === 'cliente') throw erro('Mensagem da cliente não se apaga no WhatsApp dela. Use "Apagar só daqui".', 400);
        if (e?.apagada === 'todos') return { ok: true };
        if (agora().getTime() - new Date(m.em).getTime() >= PRAZO_APAGAR_MS) throw erro('O WhatsApp só deixa apagar para todos até 2 dias depois. Use "Apagar só daqui".', 409);
        const a = alvo(c, m);
        const n = o.sintonia.canalDaConversa(c);
        if (!a || !n) throw erro('Esta mensagem não está no WhatsApp. Use "Apagar só daqui".', 409);
        if (!n.canal.apagarParaTodos) throw erro(n.canal.tipo === 'meta' ? 'A API oficial do WhatsApp não deixa apagar para todos. Use "Apagar só daqui".' : 'Este canal não apaga para todos. Use "Apagar só daqui".', 409);
        await n.canal.apagarParaTodos(n.canalId, a);
      }
      await o.armazem.marcar(c.id, m.id, { apagada: b.modo, apagadaPor: nomeSou(req), apagadaEm: agora() });
      const fx = (await o.armazem.daConversa(c.id, null)).fixada;
      if (fx?.mensagemId === m.id) await o.armazem.fixar(c.id, null, null, agora());
      auditar(req, 'mensagem_apagada', c, m, { modo: b.modo, autor: m.autor });
      return { ok: true };
    });

    // ---- Fixar no topo da conversa (uma por conversa)
    const CorpoFixar = z.object({ fixar: z.boolean() });
    app.post('/api/conversas/:id/mensagens/:msgId/fixar', async (req) => {
      const b = CorpoFixar.parse(req.body);
      const { c, m } = await mensagemDe(req);
      if (b.fixar && (await o.armazem.extras(m.id))?.apagada) throw erro('Esta mensagem foi apagada.', 409);
      const atual = (await o.armazem.daConversa(c.id, null)).fixada;
      if (b.fixar) await o.armazem.fixar(c.id, m.id, nomeSou(req), agora());
      else if (atual?.mensagemId === m.id) await o.armazem.fixar(c.id, null, null, agora());
      return { ok: true };
    });

    // ---- Favoritar (estrela), por pessoa
    const CorpoFavorito = z.object({ favorito: z.boolean() });
    app.post('/api/conversas/:id/mensagens/:msgId/favorito', async (req) => {
      const b = CorpoFavorito.parse(req.body);
      const { c, m } = await mensagemDe(req);
      await o.armazem.favoritar(req.usuario?.id ?? 'teste', c.id, m.id, b.favorito, agora());
      return { ok: true };
    });
    /** Lista de mensagens favoritas da pessoa (só das conversas que ela ainda vê). */
    app.get('/api/mensagens/favoritas', async (req) => {
      const lista = await o.armazem.favoritas(req.usuario?.id ?? 'teste', 200);
      const saida = [];
      for (const f of lista) {
        const c = await o.repo.buscarConversa(f.conversaId).catch(() => undefined);
        if (!c || c.empresaId !== o.empresaId || !visivel(req, c)) continue;
        const m = o.repo.mensagemPorId ? await o.repo.mensagemPorId(f.mensagemId).catch(() => undefined) : undefined;
        if (!m) continue;
        saida.push({ mensagemId: m.id, conversaId: c.id, nome: c.nome ?? null, telefone: c.telefone, autor: m.autor, autorNome: m.autorNome ?? null, texto: trecho(m), tipo: m.anexo?.tipo ?? null, em: m.em, favoritadaEm: f.em });
      }
      return saida;
    });

    // ---- Adicionar às observações da ficha da cliente
    app.post('/api/conversas/:id/mensagens/:msgId/nota', async (req) => {
      const { c, m } = await mensagemDe(req);
      if (!o.contatos) throw erro('A ficha da cliente não está disponível.', 501);
      const texto = (m.anexo ? m.anexo.legenda || m.texto : m.texto).trim();
      if (!texto) throw erro('Esta mensagem não tem texto para levar às observações.', 400);
      const quem = m.autor === 'cliente' ? (c.nome || 'Cliente') : m.autor === 'ia' ? 'IA' : (m.autorNome || 'Equipe');
      const atual = (await o.contatos.obter(o.empresaId, c.telefone)) ?? contatoVazio(c.telefone, c.nome);
      const observacoes = juntarNota(atual.observacoes, `${quem}: ${texto}`, nomeSou(req), agora());
      await o.contatos.salvar(o.empresaId, { ...atual, observacoes }, req.usuario?.email ?? 'sistema');
      return { ok: true, observacoes };
    });

    // ---- Traduzir pela IA
    const CorpoTraduzir = z.object({ para: z.enum(['pt', 'en', 'es']).default('pt') });
    const IDIOMA = { pt: 'português do Brasil', en: 'inglês', es: 'espanhol' } as const;
    app.post('/api/conversas/:id/mensagens/:msgId/traduzir', async (req) => {
      const b = CorpoTraduzir.parse(req.body ?? {});
      const { m } = await mensagemDe(req);
      const texto = (m.anexo ? m.anexo.legenda ?? '' : m.texto).trim();
      if (!texto) throw erro('Esta mensagem não tem texto para traduzir.', 400);
      if (!o.ia || !o.ia.ligada()) throw erro('Para traduzir, configure a chave da IA (Anthropic) em Conexões.', 501, { codigo: 'sem_chave' });
      try {
        const resp = await o.ia.claude.beta.messages.create({
          model: o.ia.modelo,
          max_tokens: 2000,
          system: `Você traduz mensagens de WhatsApp para ${IDIOMA[b.para]}. Responda só com a tradução, sem comentários. Se já estiver nesse idioma, devolva o texto igual.`,
          messages: [{ role: 'user', content: texto.slice(0, 4000) }],
        });
        const t = resp.content.filter((x): x is Anthropic.Beta.Messages.BetaTextBlock => x.type === 'text').map((x) => x.text).join('\n').trim();
        if (!t) throw erro('A IA não devolveu a tradução agora. Tente de novo.', 424);
        return { ok: true, texto: t };
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401) throw erro('A chave da IA foi recusada. Confira em Conexões.', 501, { codigo: 'sem_chave' });
        if ((e as { statusCode?: number }).statusCode) throw e;
        throw erro('A IA está ocupada agora. Tente de novo em instantes.', 424);
      }
    });
  }

  /** Reação, apagou ou editou que veio pelo webhook (cliente ou o celular da loja). */
  async function aoReceber(lista: AcaoRecebida[]): Promise<number> {
    let n = 0;
    for (const a of lista) {
      const m = o.repo.mensagemPorIdExterno ? await o.repo.mensagemPorIdExterno(a.alvoIdExterno) : undefined;
      if (!m) continue;
      const c = await o.repo.buscarConversa(m.conversaId);
      if (!c || c.empresaId !== o.empresaId || c.telefone !== a.telefone) continue;
      if (a.tipo === 'reacao') await o.armazem.reagir(c.id, m.id, a.deMim ? 'loja' : 'cliente', a.deMim ? 'Celular da loja' : (a.nome ?? null), a.emoji || null, a.em);
      else if (a.tipo === 'apagou') {
        if ((await o.armazem.extras(m.id))?.apagada) continue;
        await o.armazem.marcar(c.id, m.id, { apagada: a.deMim ? 'todos' : 'cliente', apagadaPor: a.deMim ? 'Celular da loja' : (c.nome ?? 'Cliente'), apagadaEm: a.em });
      } else if (a.tipo === 'editou' && a.texto && o.repo.trocarTexto) {
        const e = await o.armazem.extras(m.id);
        await o.repo.trocarTexto(m.id, a.texto);
        await o.armazem.marcar(c.id, m.id, { editadaEm: a.em, editadaPor: a.deMim ? 'Celular da loja' : (c.nome ?? 'Cliente'), ...(e?.textoOriginal ? {} : { textoOriginal: m.texto }) });
      }
      n++;
    }
    return n;
  }

  return { daConversa, aoReceber, registrar };
}
