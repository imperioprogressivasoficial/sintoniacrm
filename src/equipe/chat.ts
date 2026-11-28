import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { podeVer } from '../auth/acesso.js';
import type { Contas, Usuario } from '../auth/contas.js';
import { ehEmailDemo } from '../demo/dados.js';
import type { Conversa } from '../domain.js';
import { statusDe, type Presencas } from '../presenca/presenca.js';
import type { Repositorio } from '../store/repositorio.js';
import type { ArmazemEquipe, MensagemEquipe, Sala } from './armazem.js';
import { nomeOuTelefone } from '../contatos/nome.js';

/**
 * Conversas de equipe: chat interno entre as pessoas da empresa (não passa pelo WhatsApp).
 * - Direta: uma conversa por par de pessoas.
 * - Grupo: nome e pessoas escolhidas por quem cria; o "Geral" (todas as pessoas ativas) nasce sozinho.
 * - Mensagem: texto (até 4000), pode responder a outra mensagem e pode levar uma conversa de cliente
 *   (só quem pode ver aquela conversa vê o nome dela e consegue abrir).
 * Ninguém lê nem escreve numa sala de que não participa, e nada cruza de uma empresa para outra.
 */

export class ErroEquipe extends Error {
  constructor(
    msg: string,
    readonly statusCode: number,
  ) {
    super(msg);
  }
}

export const LIMITE_TEXTO = 4000;
const nao = (msg = 'Conversa não encontrada.') => new ErroEquipe(msg, 404);

const Id = z.string().min(1).max(80);
const Uuid = z.string().uuid();
export const EsquemaDireta = z.object({ pessoaId: Id });
export const EsquemaGrupo = z.object({
  nome: z.string().trim().min(1, 'Dê um nome ao grupo.').max(60),
  pessoas: z.array(Id).min(1, 'Escolha pelo menos uma pessoa.').max(200),
});
export const EsquemaEdicao = z.object({
  nome: z.string().trim().min(1).max(60).optional(),
  adicionar: z.array(Id).max(200).optional(),
});
export const EsquemaMensagem = z
  .object({
    texto: z.string().max(LIMITE_TEXTO, `A mensagem pode ter até ${LIMITE_TEXTO} letras.`).default(''),
    respostaA: Uuid.optional(),
    conversaId: Uuid.optional(),
  })
  .transform((m) => ({ ...m, texto: m.texto.trim() }))
  .refine((m) => m.texto.length > 0 || m.conversaId, { message: 'Escreva a mensagem.', path: ['texto'] });
export const EsquemaLeitura = z.object({
  depois: z.coerce.number().int().min(0).optional(),
  antes: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(60),
});

export interface Aviso {
  /** Quem recebe (nunca quem escreveu). */
  para: string[];
  titulo: string;
  texto: string;
  salaId: string;
}

export interface OpcoesChatEquipe {
  armazem: ArmazemEquipe;
  contas: Pick<Contas, 'listarUsuarios'>;
  repo: Pick<Repositorio, 'buscarConversa'>;
  presencas?: Presencas;
  /** Aviso de mensagem nova (push). Erros aqui nunca impedem o envio. */
  avisar?: (a: Aviso) => Promise<void> | void;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

export interface PessoaChat {
  id: string;
  nome: string;
  papel: Usuario['papel'];
  online: boolean;
}

const curto = (t: string, n = 120) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const TXT_CONVERSA = 'Compartilhou uma conversa';

export class ChatEquipe {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  /** Para não refazer o "Geral" a cada consulta. */
  private geralFeito = new Map<string, number>();
  private fila: Promise<void> = Promise.resolve();

  /** Termina quando os avisos pendentes saíram (testes e desligamento). */
  ocioso(): Promise<void> {
    return this.fila;
  }

  constructor(private readonly o: OpcoesChatEquipe) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  // ---------------------------------------------------------------- pessoas

  /** Pessoas ativas da empresa (sem as contas da demonstração, a não ser a própria). */
  private async gente(eu: Usuario): Promise<Usuario[]> {
    const todas = await this.o.contas.listarUsuarios(eu.empresaId);
    return todas.filter((u) => u.empresaId === eu.empresaId && (u.id === eu.id || (u.ativo && !ehEmailDemo(u.email))));
  }

  async pessoas(eu: Usuario): Promise<PessoaChat[]> {
    const g = await this.gente(eu);
    const on = this.o.presencas ? await statusDe(this.o.presencas, g.map((u) => u.id)) : {};
    return g
      .filter((u) => u.id !== eu.id)
      .map((u) => ({ id: u.id, nome: u.nome, papel: u.papel, online: (on[u.id] ?? 'online') === 'online' }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /** Garante o grupo "Geral" com todas as pessoas ativas da empresa (quem entra depois já entra nele). */
  private async garantirGeral(eu: Usuario): Promise<void> {
    const ult = this.geralFeito.get(eu.empresaId);
    const t = this.agora().getTime();
    if (ult && t - ult < 60_000) {
      const s = await this.o.armazem.salaPorChave(eu.empresaId, 'geral');
      if (s) {
        await this.o.armazem.adicionarMembros(s.id, [eu.id], this.agora());
        return;
      }
    }
    const ids = (await this.gente(eu)).map((u) => u.id);
    const em = this.agora();
    const s = await this.o.armazem.criarSala({ id: randomUUID(), empresaId: eu.empresaId, tipo: 'grupo', nome: 'Geral', geral: true, chave: 'geral', criadaEm: em, ultimaEm: em }, ids);
    await this.o.armazem.adicionarMembros(s.id, ids, em);
    this.geralFeito.set(eu.empresaId, t);
  }

  // ---------------------------------------------------------------- salas

  /** A sala, se a pessoa participa (e é da mesma empresa). Senão, "não encontrada". */
  private async salaDe(eu: Usuario, salaId: string): Promise<Sala> {
    const s = await this.o.armazem.sala(salaId);
    if (!s || s.empresaId !== eu.empresaId) throw nao();
    const m = await this.o.armazem.membros([s.id]);
    if (!m.some((x) => x.usuarioId === eu.id)) throw nao();
    return s;
  }

  /** Lista das salas da pessoa, com prévia, horário, não lidas e quem está na sala (mais recentes primeiro). */
  async listar(eu: Usuario) {
    await this.garantirGeral(eu);
    const salas = await this.o.armazem.salasDe(eu.empresaId, eu.id);
    const ids = salas.map((s) => s.id);
    const [membros, ultimas, naoLidas, gente] = await Promise.all([
      this.o.armazem.membros(ids),
      this.o.armazem.ultimas(ids),
      this.o.armazem.naoLidas(eu.id, ids),
      this.o.contas.listarUsuarios(eu.empresaId),
    ]);
    const porId = new Map(gente.filter((u) => u.empresaId === eu.empresaId).map((u) => [u.id, u]));
    const todosIds = [...new Set(membros.map((m) => m.usuarioId))];
    const on = this.o.presencas ? await statusDe(this.o.presencas, todosIds.filter((id) => porId.has(id))) : {};
    const lista = salas.map((s) => {
      const ms = membros.filter((m) => m.salaId === s.id && porId.has(m.usuarioId));
      const pessoas = ms.map((m) => {
        const u = porId.get(m.usuarioId)!;
        return { id: u.id, nome: u.nome, online: (on[u.id] ?? 'online') === 'online' && u.ativo, ativo: u.ativo };
      });
      const outro = s.tipo === 'direta' ? pessoas.find((p) => p.id !== eu.id) : undefined;
      const u = ultimas.get(s.id);
      return {
        id: s.id,
        tipo: s.tipo,
        geral: s.geral,
        nome: s.tipo === 'direta' ? (outro?.nome ?? 'Pessoa removida') : (s.nome ?? 'Grupo'),
        ...(outro ? { pessoaId: outro.id, online: outro.online } : {}),
        membros: pessoas.length,
        pessoas: s.geral ? [] : pessoas.filter((p) => p.id !== eu.id).map((p) => ({ id: p.id, nome: p.nome, online: p.online })),
        criadaPor: s.criadaPor ?? null,
        ultima: u
          ? { autorId: u.autorId, autorNome: u.autorNome, eu: u.autorId === eu.id, texto: curto(u.texto || TXT_CONVERSA), conversa: Boolean(u.conversaId), em: u.em }
          : null,
        naoLidas: naoLidas.get(s.id) ?? 0,
        quando: (u?.em ?? s.criadaEm).getTime(),
      };
    });
    lista.sort((a, b) => (a.ultima ? 0 : 1) - (b.ultima ? 0 : 1) || b.quando - a.quando || (a.geral ? -1 : b.geral ? 1 : 0));
    return { salas: lista.map(({ quando: _, ...r }) => r), naoLidas: lista.reduce((t, s) => t + s.naoLidas, 0) };
  }

  /** Total não lido e uma "versão" que muda quando chega mensagem ou sala nova (a tela só recarrega se mudou). */
  async resumo(eu: Usuario) {
    const salas = await this.o.armazem.salasDe(eu.empresaId, eu.id);
    const ids = salas.map((s) => s.id);
    const [n, ultimas] = await Promise.all([this.o.armazem.naoLidas(eu.id, ids), this.o.armazem.ultimas(ids)]);
    const total = [...n.values()].reduce((t, x) => t + x, 0);
    const maior = Math.max(0, ...[...ultimas.values()].map((m) => m.seq));
    return { naoLidas: total, versao: `${ids.length}.${maior}.${total}` };
  }

  /** Abre (ou cria) a conversa direta com outra pessoa ativa da mesma empresa. */
  async direta(eu: Usuario, bruto: unknown) {
    const { pessoaId } = EsquemaDireta.parse(bruto);
    if (pessoaId === eu.id) throw new ErroEquipe('Escolha outra pessoa.', 400);
    const outra = (await this.gente(eu)).find((u) => u.id === pessoaId);
    if (!outra) throw nao('Pessoa não encontrada.');
    const em = this.agora();
    const chave = `direta:${[eu.id, outra.id].sort().join(':')}`;
    const s = await this.o.armazem.criarSala({ id: randomUUID(), empresaId: eu.empresaId, tipo: 'direta', geral: false, chave, criadaPor: eu.id, criadaEm: em, ultimaEm: em }, [eu.id, outra.id]);
    return { id: s.id };
  }

  /** Cria um grupo com nome e pessoas (quem cria entra sempre). */
  async grupo(eu: Usuario, bruto: unknown) {
    const g = EsquemaGrupo.parse(bruto);
    const validos = await this.validas(eu, g.pessoas);
    const em = this.agora();
    const s = await this.o.armazem.criarSala({ id: randomUUID(), empresaId: eu.empresaId, tipo: 'grupo', nome: g.nome, geral: false, criadaPor: eu.id, criadaEm: em, ultimaEm: em }, [eu.id, ...validos]);
    return { id: s.id };
  }

  private async validas(eu: Usuario, ids: string[]): Promise<string[]> {
    const gente = new Set((await this.gente(eu)).map((u) => u.id));
    const fora = ids.filter((id) => !gente.has(id));
    if (fora.length) throw new ErroEquipe('Alguma pessoa escolhida não faz parte da empresa.', 400);
    return [...new Set(ids)].filter((id) => id !== eu.id);
  }

  /** Muda o nome do grupo e/ou põe mais pessoas (quem participa pode). O "Geral" não muda. */
  async editar(eu: Usuario, salaId: string, bruto: unknown) {
    const s = await this.salaDe(eu, salaId);
    const e = EsquemaEdicao.parse(bruto);
    if (s.tipo !== 'grupo' || s.geral) throw new ErroEquipe('Esta conversa não pode ser mudada.', 400);
    if (e.nome) await this.o.armazem.renomear(s.id, e.nome);
    if (e.adicionar?.length) await this.o.armazem.adicionarMembros(s.id, await this.validas(eu, e.adicionar), this.agora());
    return { ok: true };
  }

  /** Sai de um grupo (o "Geral" e as diretas não têm saída). */
  async sair(eu: Usuario, salaId: string) {
    const s = await this.salaDe(eu, salaId);
    if (s.tipo !== 'grupo' || s.geral) throw new ErroEquipe('Não dá para sair desta conversa.', 400);
    await this.o.armazem.removerMembro(s.id, eu.id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- mensagens

  /** Cartão da conversa de cliente compartilhada: só com nome para quem pode ver a conversa. */
  private async cartao(eu: Usuario, id: string, cache: Map<string, Conversa | undefined>) {
    if (!cache.has(id)) cache.set(id, await this.o.repo.buscarConversa(id).catch(() => undefined));
    const c = cache.get(id);
    if (!c || c.empresaId !== eu.empresaId || !podeVer(eu, c)) return { bloqueada: true as const };
    return { id: c.id, nome: nomeOuTelefone(c.nome, c.telefone), unidade: c.unidade };
  }

  private async ver(eu: Usuario, ms: MensagemEquipe[]) {
    const cache = new Map<string, Conversa | undefined>();
    const citadas = new Map<string, MensagemEquipe | undefined>();
    for (const m of ms) if (m.respostaA && !citadas.has(m.respostaA)) citadas.set(m.respostaA, ms.find((x) => x.id === m.respostaA) ?? (await this.o.armazem.mensagem(m.respostaA)));
    const r = [];
    for (const m of ms) {
      const q = m.respostaA ? citadas.get(m.respostaA) : undefined;
      r.push({
        seq: m.seq,
        id: m.id,
        autorId: m.autorId,
        autorNome: m.autorNome,
        eu: m.autorId === eu.id,
        texto: m.texto,
        em: m.em,
        ...(q && q.salaId === m.salaId ? { resposta: { id: q.id, autorNome: q.autorNome, texto: curto(q.texto || TXT_CONVERSA, 160) } } : {}),
        ...(m.conversaId ? { conversa: await this.cartao(eu, m.conversaId, cache) } : {}),
      });
    }
    return r;
  }

  /** Mensagens da sala (as últimas, as novas depois de um seq, ou as antigas antes de um seq) e até onde cada pessoa leu. */
  async mensagens(eu: Usuario, salaId: string, bruto: unknown) {
    const s = await this.salaDe(eu, salaId);
    const q = EsquemaLeitura.parse(bruto ?? {});
    const ms = await this.o.armazem.mensagens(s.id, { ...(q.depois !== undefined ? { depois: q.depois } : {}), ...(q.antes !== undefined ? { antes: q.antes } : {}), limite: q.limite });
    const membros = await this.o.armazem.membros([s.id]);
    // "Visto": a menor leitura das outras pessoas (direta: a da outra pessoa).
    const outros = membros.filter((m) => m.usuarioId !== eu.id).map((m) => m.lidaSeq);
    return { mensagens: await this.ver(eu, ms), vistoAte: outros.length ? Math.min(...outros) : 0, mais: q.depois === undefined && ms.length === q.limite };
  }

  async enviar(eu: Usuario, salaId: string, bruto: unknown) {
    const s = await this.salaDe(eu, salaId);
    const m = EsquemaMensagem.parse(bruto);
    if (m.respostaA) {
      const q = await this.o.armazem.mensagem(m.respostaA);
      if (!q || q.salaId !== s.id) throw new ErroEquipe('A mensagem respondida não está nesta conversa.', 400);
    }
    if (m.conversaId) {
      const c = await this.o.repo.buscarConversa(m.conversaId).catch(() => undefined);
      if (!c || c.empresaId !== eu.empresaId || !podeVer(eu, c)) throw nao('Conversa de cliente não encontrada.');
    }
    const nova = await this.o.armazem.gravar({
      id: randomUUID(),
      salaId: s.id,
      empresaId: eu.empresaId,
      autorId: eu.id,
      autorNome: eu.nome,
      texto: m.texto,
      ...(m.respostaA ? { respostaA: m.respostaA } : {}),
      ...(m.conversaId ? { conversaId: m.conversaId } : {}),
      em: this.agora(),
    });
    await this.o.armazem.marcarLida(s.id, eu.id, nova.seq);
    // O aviso (push) sai por trás: quem enviou não espera.
    this.fila = this.fila.then(() => this.avisar(eu, s, nova));
    const [visto] = await this.ver(eu, [nova]);
    return { mensagem: visto! };
  }

  private async avisar(eu: Usuario, s: Sala, m: MensagemEquipe) {
    if (!this.o.avisar) return;
    try {
      const para = (await this.o.armazem.membros([s.id])).map((x) => x.usuarioId).filter((id) => id !== eu.id);
      if (!para.length) return;
      const texto = curto(m.texto || TXT_CONVERSA, 140);
      await this.o.avisar({ para, salaId: s.id, titulo: s.tipo === 'direta' ? eu.nome : `${eu.nome} · ${s.nome ?? 'Grupo'}`, texto });
    } catch (x) {
      this.log('Falha no aviso do chat da equipe', String(x));
    }
  }

  async marcarLida(eu: Usuario, salaId: string) {
    const s = await this.salaDe(eu, salaId);
    await this.o.armazem.marcarLida(s.id, eu.id);
    return { ok: true };
  }
}
