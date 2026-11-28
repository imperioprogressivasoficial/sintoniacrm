import { randomUUID } from 'node:crypto';
import type { Aprendido, BaseConhecimento } from '../ai/base.js';
import { CHAVE_FAQ } from '../ai/base.js';
import { textoDoPdf } from '../agentes-ia/importar.js';
import { comContexto } from '../planos/medidor.js';
import { CONFIG_SUGERIDA, custoUsd } from '../planos/catalogo.js';
import type { Mensagem } from '../domain.js';
import { anonimizar } from './anonimizar.js';
import type { ArmazemAprender, Categoria, Item, Observacao, ResultadoRodada, Rodada } from './armazem.js';
import type { FonteConversas } from './fonte.js';
import type { ConversaLote, IaAprender, Proposta, UsoIa } from './ia.js';

/**
 * ia-aprende: a IA aprende com a equipe.
 * - "Estudar as conversas": em segundo plano, lê as conversas em que a equipe atendeu (primeiro as que agendaram),
 *   sem dados pessoais, em lotes de ~10, e no fim junta tudo em aprendizados (só o que é novo ou diferente da base).
 *   O andamento fica no banco depois de cada lote: se o app reiniciar, continua de onde parou.
 * - "Aprender sozinha" (ligada por padrão): estuda as conversas novas todo dia (ou antes, se juntar muitas) e põe
 *   na memória o que aparece em 3+ conversas sem contrariar a base nem citar valores. O resto espera a gestão.
 * - Documento (PDF ou texto) do dono: a IA propõe o que muda na base; a gestão aprova.
 * - A memória (aprendizados aplicados) entra no texto da IA que atende (base.ts: montarTexto, com limite).
 */

export const MINIMO_CONVERSAS_AUTO = 3;
const DIA_MS = 24 * 3600_000;

export interface OpcoesAprender {
  empresaId: string;
  armazem: ArmazemAprender;
  fonte: FonteConversas;
  base: BaseConhecimento;
  ia: IaAprender;
  /** A chave da IA está configurada (Conexões)? */
  iaLigada: () => boolean;
  modelo?: () => string;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Máximo de conversas por rodada (custo), tamanho do lote, conversas novas que antecipam o estudo diário. */
  limites?: { porRodada?: number; lote?: number; novasParaEstudar?: number; folgaMs?: number };
}

const erro = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });
/** Valores em dinheiro nunca entram sozinhos. */
export const temValor = (t: string) => /R\$\s?\d|\b\d+(?:[.,]\d+)?\s?(?:reais|real)\b/i.test(t);
const LIMITE_CONVERSA = 6000;
const LIMITE_MENSAGEM = 400;

export class Aprender {
  private readonly trabalhos = new Map<string, Promise<void>>();
  private readonly porRodada: number;
  private readonly lote: number;
  private readonly novasParaEstudar: number;
  private readonly folgaMs: number;

  constructor(private readonly o: OpcoesAprender) {
    this.porRodada = o.limites?.porRodada ?? 300;
    this.lote = o.limites?.lote ?? 10;
    this.novasParaEstudar = o.limites?.novasParaEstudar ?? 20;
    this.folgaMs = o.limites?.folgaMs ?? 10 * 60_000;
  }

  get empresaId() {
    return this.o.empresaId;
  }
  private agora() {
    return (this.o.agora ?? (() => new Date()))();
  }
  private log(msg: string, extra?: unknown) {
    this.o.log?.(msg, extra);
  }

  /** Espera os trabalhos em segundo plano (testes e desligamento). */
  async esperar(): Promise<void> {
    while (this.trabalhos.size) await Promise.allSettled([...this.trabalhos.values()]);
  }

  // ------------------------------------------------------------------ estado e configuração

  async estado() {
    const [config, rodadas, pendentes, aplicados] = await Promise.all([
      this.o.armazem.config(this.empresaId),
      this.o.armazem.rodadas(this.empresaId, 20),
      this.o.armazem.itens(this.empresaId, ['pendente']),
      this.o.armazem.itens(this.empresaId, ['aplicado']),
    ]);
    const daConversa = rodadas.find((r) => r.origem === 'conversas');
    const documentos = rodadas.filter((r) => r.origem === 'documento').slice(0, 5);
    return {
      iaLigada: this.o.iaLigada(),
      config: { auto: config.auto, ultimoEstudo: config.ultimoEstudo },
      rodada: daConversa ? this.resumoRodada(daConversa) : null,
      documentos: documentos.map((r) => this.resumoRodada(r)),
      pendentes: pendentes.length,
      aprendidos: aplicados.length,
    };
  }

  private resumoRodada(r: Rodada) {
    const uso = { entrada: r.tokensEntrada, saida: r.tokensSaida, cacheLeitura: 0, cacheEscrita: 0 };
    return {
      id: r.id,
      origem: r.origem,
      situacao: r.situacao,
      lidas: r.lidas,
      total: r.total,
      criadaEm: r.criadaEm,
      terminadaEm: r.terminadaEm,
      pedidaPor: r.pedidaPor,
      resultado: r.resultado,
      erro: r.erro,
      documentoNome: r.documentoNome,
      gastoUsd: Math.round(custoUsd(CONFIG_SUGERIDA, this.o.modelo?.() ?? 'claude-opus-5-5', uso) * 100) / 100,
    };
  }

  async configurar(c: { auto: boolean }, por: string) {
    const cfg = await this.o.armazem.gravarConfig(this.empresaId, { auto: c.auto }, por, this.agora());
    return { auto: cfg.auto, ultimoEstudo: cfg.ultimoEstudo };
  }

  async itens(lista: 'pendentes' | 'aprendidos' | 'todos') {
    const sit = lista === 'pendentes' ? (['pendente'] as const) : lista === 'aprendidos' ? (['aplicado', 'desfeito'] as const) : undefined;
    const l = await this.o.armazem.itens(this.empresaId, sit ? [...sit] : undefined);
    return l.map(({ empresaId: _e, aplicacao: _a, ...x }) => x);
  }

  /* conhecimento-arquivo: Empresa › Documentos › Conhecimento da IA lê a base, os aplicados e os documentos enviados. */
  get baseConhecimento(): BaseConhecimento {
    return this.o.base;
  }
  /** Documentos (PDF/texto) que o dono mandou para a IA estudar: só nome, data, quem e situação. */
  async documentosEnviados(limite = 300) {
    return (await this.o.armazem.rodadas(this.empresaId, limite))
      .filter((r) => r.origem === 'documento')
      .map((r) => ({ nome: r.documentoNome ?? 'Documento', enviadoEm: r.criadaEm, enviadoPor: r.pedidaPor, situacao: r.situacao }));
  }

  /** O que a IA que atende usa (aprendizados aplicados que viram memória; "corrigir" já mudou a própria base). */
  async memoria(): Promise<Aprendido[]> {
    const l = await this.o.armazem.itens(this.empresaId, ['aplicado']);
    return l
      .filter((i) => i.acao !== 'corrigir')
      .map((i) => ({
        destino: i.destino,
        categoria: i.categoria,
        texto: i.texto,
        ...(i.pergunta ? { pergunta: i.pergunta } : {}),
        ...(i.resposta ? { resposta: i.resposta } : {}),
        conversas: i.conversas,
        em: i.decididoEm ?? i.criadoEm,
      }));
  }

  // ------------------------------------------------------------------ estudar as conversas

  /**
   * Começa (ou continua, se a última parou com erro no meio) o estudo das conversas da equipe.
   * Só as conversas novas desde a última leitura de cada uma. Volta logo; o trabalho segue em segundo plano.
   */
  async estudar(por: string): Promise<ReturnType<Aprender['resumoRodada']>> {
    if (!this.o.iaLigada()) throw erro(409, 'Configure a chave da IA em Conexões para a IA estudar as conversas.');
    const ultima = (await this.o.armazem.rodadas(this.empresaId, 5)).find((r) => r.origem === 'conversas');
    if (ultima && (ultima.situacao === 'estudando' || ultima.situacao === 'juntando')) {
      this.iniciar(ultima.id);
      return this.resumoRodada(ultima);
    }
    if (ultima && ultima.situacao === 'falhou' && ultima.lidas < ultima.total) {
      ultima.situacao = 'estudando';
      ultima.erro = null;
      ultima.atualizadaEm = this.agora();
      ultima.pedidaPor = por;
      await this.o.armazem.gravarRodada(ultima);
      this.iniciar(ultima.id);
      return this.resumoRodada(ultima);
    }
    const lidas = await this.o.armazem.lidas(this.empresaId);
    const candidatas = await this.o.fonte.candidatas(this.empresaId, lidas, this.porRodada);
    const agora = this.agora();
    const r: Rodada = {
      id: randomUUID(),
      empresaId: this.empresaId,
      origem: 'conversas',
      situacao: candidatas.length ? 'estudando' : 'pronta',
      pedidaPor: por,
      criadaEm: agora,
      atualizadaEm: agora,
      terminadaEm: candidatas.length ? null : agora,
      conversas: candidatas.map((c) => ({ id: c.id, ate: c.ultimaEquipe.toISOString(), agendou: c.agendou, ...(c.nome ? { nome: c.nome } : {}) })),
      lidas: 0,
      total: candidatas.length,
      observacoes: [],
      tokensEntrada: 0,
      tokensSaida: 0,
      resultado: candidatas.length ? null : { lidas: 0, aprendizados: 0, entraram: 0, paraAprovar: 0, reforcados: 0 },
      erro: null,
      documentoNome: null,
      documentoTexto: null,
      documentoPdf: null,
    };
    if (!(await this.o.armazem.criarRodada(r))) throw erro(409, 'A IA já está estudando as conversas.');
    if (candidatas.length) this.iniciar(r.id);
    else await this.o.armazem.gravarConfig(this.empresaId, { ultimoEstudo: agora }, null, agora);
    return this.resumoRodada(r);
  }

  private iniciar(id: string) {
    if (this.trabalhos.has(id)) return;
    const p = comContexto({ conversaId: null, origem: 'aprender' }, () => this.processar(id))
      .catch((e) => this.log('Estudo das conversas: falhou', String((e as Error)?.message ?? e)))
      .finally(() => this.trabalhos.delete(id));
    this.trabalhos.set(id, p);
  }

  /** Retoma rodadas que pararam no meio (app reiniciou). Chamado ao subir e a cada volta do relógio. */
  async retomar(): Promise<number> {
    let n = 0;
    for (const r of await this.o.armazem.emAndamento()) {
      if (r.empresaId !== this.empresaId || this.trabalhos.has(r.id)) continue;
      if (!this.o.iaLigada()) continue;
      if (!(await this.o.armazem.reservarRodada(this.empresaId, r.id, this.agora(), this.folgaMs))) continue;
      this.log(`Estudo ${r.origem === 'documento' ? `do documento ${r.documentoNome}` : 'das conversas'}: continuando de onde parou (${r.lidas} de ${r.total})`);
      this.iniciar(r.id);
      n++;
    }
    return n;
  }

  /**
   * Relógio (a cada poucos minutos): retoma o que parou e, com "Aprender sozinha" ligada e a IA configurada,
   * estuda sozinha: na primeira vez (se houver conversas da equipe), depois todo dia, ou antes se juntar muitas novas.
   */
  async tick(): Promise<'estudando' | 'nada'> {
    await this.retomar();
    if (!this.o.iaLigada()) return 'nada';
    const cfg = await this.o.armazem.config(this.empresaId);
    if (!cfg.auto) return 'nada';
    const ultima = (await this.o.armazem.rodadas(this.empresaId, 5)).find((r) => r.origem === 'conversas');
    if (ultima && (ultima.situacao === 'estudando' || ultima.situacao === 'juntando')) return 'nada';
    const agora = this.agora();
    const desde = cfg.ultimoEstudo ? agora.getTime() - cfg.ultimoEstudo.getTime() : Infinity;
    if (ultima?.situacao === 'falhou' && agora.getTime() - ultima.atualizadaEm.getTime() < DIA_MS) return 'nada';
    let estudar = false;
    if (desde >= DIA_MS) estudar = (await this.o.fonte.candidatas(this.empresaId, await this.o.armazem.lidas(this.empresaId), 1)).length > 0;
    else if (desde >= 3600_000) estudar = (await this.o.fonte.candidatas(this.empresaId, await this.o.armazem.lidas(this.empresaId), this.novasParaEstudar)).length >= this.novasParaEstudar;
    if (!estudar) return 'nada';
    await this.estudar(cfg.ultimoEstudo ? 'automático' : 'automático (primeira vez)');
    return 'estudando';
  }

  private async processar(id: string): Promise<void> {
    const r = await this.o.armazem.rodada(this.empresaId, id);
    if (!r || (r.situacao !== 'estudando' && r.situacao !== 'juntando')) return;
    try {
      if (r.origem === 'documento') return await this.processarDocumento(r);
      const textoBase = await this.o.base.texto();
      const equipe = await this.o.fonte.nomesEquipe(this.empresaId).catch(() => []);
      while (r.situacao === 'estudando' && r.lidas < r.total) {
        const fatia = r.conversas.slice(r.lidas, r.lidas + this.lote);
        const lote: ConversaLote[] = [];
        for (const [i, c] of fatia.entries()) {
          const msgs = await this.o.fonte.mensagens(c.id);
          lote.push({ n: r.lidas + i + 1, agendou: Boolean(c.agendou), linhas: linhasDaConversa(msgs, { clientes: c.nome ? [c.nome] : [], equipe }) });
        }
        const com = lote.filter((c) => c.linhas.length);
        if (com.length) {
          const { observacoes, uso } = await this.o.ia.observar(textoBase, com).catch((e: Error & { uso?: UsoIa }) => {
            if (e.uso) this.somar(r, e.uso);
            throw e;
          });
          this.somar(r, uso);
          r.observacoes.push(...observacoes.map((x) => ({ ...x, texto: anonimizar(x.texto, { equipe }), ...(x.exemplo ? { exemplo: anonimizar(x.exemplo, { clientes: fatia.flatMap((c) => (c.nome ? [c.nome] : [])), equipe }) } : {}) })));
        }
        r.lidas += fatia.length;
        if (r.lidas >= r.total) r.situacao = 'juntando';
        r.atualizadaEm = this.agora();
        await this.o.armazem.gravarRodada(r);
      }
      // juntar
      const resultado = await this.juntar(r, textoBase, equipe);
      const agora = this.agora();
      await this.o.armazem.marcarLidas(this.empresaId, r.conversas.map((c) => ({ id: c.id, ate: new Date(c.ate) })));
      await this.o.armazem.gravarConfig(this.empresaId, { ultimoEstudo: agora }, null, agora);
      r.situacao = 'pronta';
      r.resultado = resultado;
      r.terminadaEm = agora;
      r.atualizadaEm = agora;
      r.conversas = r.conversas.map(({ id: cid, ate }) => ({ id: cid, ate })); // os nomes saem do banco
      await this.o.armazem.gravarRodada(r);
      this.o.base.esquecer();
      this.log(`Estudo das conversas: ${resultado.lidas} lidas, ${resultado.aprendizados} aprendizados (${resultado.entraram} entraram, ${resultado.paraAprovar} para aprovar)`);
    } catch (e) {
      r.situacao = 'falhou';
      r.erro = String((e as Error)?.message ?? e).slice(0, 300);
      r.atualizadaEm = this.agora();
      await this.o.armazem.gravarRodada(r).catch(() => {});
      throw e;
    }
  }

  private somar(r: Rodada, uso: UsoIa) {
    r.tokensEntrada += uso.entrada;
    r.tokensSaida += uso.saida;
  }

  private async juntar(r: Rodada, textoBase: string, equipe: string[]): Promise<ResultadoRodada> {
    const res: ResultadoRodada = { lidas: r.total, aprendizados: 0, entraram: 0, paraAprovar: 0, reforcados: 0 };
    if (!r.observacoes.length) return res;
    const secoes = await this.o.base.secoes();
    const existentes = (await this.o.armazem.itens(this.empresaId, ['pendente', 'aplicado'])).slice(0, 200);
    const { propostas, uso } = await this.o.ia.juntar(
      textoBase,
      secoes.map((s) => ({ chave: s.chave, titulo: s.titulo })),
      r.observacoes,
      existentes.map((i) => ({ id: i.id, categoria: i.categoria, titulo: i.titulo, texto: i.texto, situacao: i.situacao })),
    );
    this.somar(r, uso);
    const cfg = await this.o.armazem.config(this.empresaId);
    const clientes = r.conversas.flatMap((c) => (c.nome ? [c.nome] : []));
    for (const p of propostas) {
      const obs = p.observacoes.map((n) => r.observacoes[n - 1]).filter((x): x is Observacao => Boolean(x));
      const conversas = new Set(obs.flatMap((o) => o.conversas)).size;
      const exemplos = [...p.exemplos, ...obs.flatMap((o) => (o.exemplo ? [o.exemplo] : []))]
        .map((t) => anonimizar(t, { clientes, equipe }).slice(0, 240))
        .filter(Boolean)
        .slice(0, 2);
      const reforcar = p.reforca_id ? existentes.find((i) => i.id === p.reforca_id) : undefined;
      if (reforcar) {
        const atual = (await this.o.armazem.item(this.empresaId, reforcar.id))!;
        atual.conversas += conversas;
        atual.exemplos = [...atual.exemplos, ...exemplos].slice(0, 2);
        await this.o.armazem.gravarItem(atual);
        res.reforcados++;
        if (atual.situacao === 'pendente' && this.podeEntrarSozinho(atual, cfg.auto)) {
          await this.aplicar(atual, 'IA (aprendeu sozinha)', true);
          res.entraram++;
        }
        continue;
      }
      const item = await this.novoItem(r, p, { origem: 'conversas', conversas, exemplos, equipe, clientes });
      if (!item) continue;
      res.aprendizados++;
      if (this.podeEntrarSozinho(item, cfg.auto)) {
        await this.aplicar(item, 'IA (aprendeu sozinha)', true);
        res.entraram++;
      } else {
        await this.o.armazem.gravarItem(item);
        res.paraAprovar++;
      }
    }
    return res;
  }

  /** Monta o aprendizado a partir da proposta da IA, conferindo seção e trecho. */
  private async novoItem(r: Rodada, p: Proposta, x: { origem: string; conversas: number; exemplos: string[]; equipe: string[]; clientes?: string[] }): Promise<Item | undefined> {
    const limpa = (t: string | null | undefined, max: number) => (t ? anonimizar(t, { clientes: x.clientes, equipe: x.equipe }).trim().slice(0, max) : null);
    const ehDoc = x.origem !== 'conversas';
    const tratar = (t: string | null | undefined, max: number) => (ehDoc ? (t ? t.trim().slice(0, max) : null) : limpa(t, max));
    const texto = tratar(p.texto, 2000);
    if (!texto) return undefined;
    const secoes = await this.o.base.secoes();
    let acao = p.acao as Item['acao'];
    let destino = p.destino.trim();
    let conferir = p.conferir;
    let motivo = tratar(p.motivo, 400);
    const pergunta = tratar(p.pergunta, 500);
    const resposta = tratar(p.resposta, 2000);
    let trecho = p.trecho_atual?.trim() || null;
    if (acao === 'pergunta') {
      if (!pergunta || !resposta) acao = 'acrescentar';
      else destino = CHAVE_FAQ;
    }
    if (acao === 'corrigir') {
      const s = secoes.find((y) => y.chave === destino);
      if (!s || !trecho || !s.conteudo.includes(trecho)) {
        acao = 'acrescentar';
        trecho = null;
        conferir = true;
        motivo ??= 'Muda algo que já está na base: confira antes.';
      }
    }
    if (acao !== 'pergunta' && !secoes.some((y) => y.chave === destino)) destino = p.categoria;
    const agora = this.agora();
    return {
      id: randomUUID(),
      empresaId: this.empresaId,
      rodadaId: r.id,
      origem: x.origem,
      categoria: p.categoria as Categoria,
      acao,
      destino,
      titulo: (tratar(p.titulo, 80) || texto.slice(0, 60)).trim(),
      texto,
      pergunta: acao === 'pergunta' ? pergunta : null,
      resposta: acao === 'pergunta' ? resposta : null,
      trechoAtual: acao === 'corrigir' ? trecho : null,
      conversas: x.conversas,
      exemplos: x.exemplos,
      conferir,
      contradiz: p.contradiz,
      motivo: conferir || p.contradiz ? motivo : null,
      situacao: 'pendente',
      automatico: false,
      criadoEm: agora,
      decididoEm: null,
      decididoPor: null,
      desfeitoEm: null,
      desfeitoPor: null,
      aplicacao: null,
    };
  }

  /** Regra de entrar sozinho: chave ligada, veio das conversas, 3+ conversas, não contradiz, nada a conferir, sem valores, sem mexer em texto da base. */
  podeEntrarSozinho(i: Pick<Item, 'origem' | 'conversas' | 'conferir' | 'contradiz' | 'acao' | 'texto' | 'resposta'>, auto: boolean): boolean {
    return (
      auto &&
      i.origem === 'conversas' &&
      i.conversas >= MINIMO_CONVERSAS_AUTO &&
      !i.conferir &&
      !i.contradiz &&
      i.acao !== 'corrigir' &&
      !temValor(`${i.texto} ${i.resposta ?? ''}`)
    );
  }

  // ------------------------------------------------------------------ decidir, aplicar e desfazer

  private async aplicar(i: Item, por: string, automatico: boolean): Promise<Item> {
    const agora = this.agora();
    if (i.acao === 'corrigir') {
      const s = await this.o.base.exigirSecao(i.destino);
      if (!i.trechoAtual || !s.conteudo.includes(i.trechoAtual)) throw erro(409, 'Esse trecho mudou na base depois. Edite a seção direto no Treinamento.');
      await this.o.base.editar(i.destino, { conteudo: s.conteudo.replace(i.trechoAtual, i.texto) }, `${por} (aprendizado)`);
      i.aplicacao = { secao: i.destino, antes: i.trechoAtual, depois: i.texto };
    }
    i.situacao = 'aplicado';
    i.automatico = automatico;
    i.decididoEm = agora;
    i.decididoPor = por;
    await this.o.armazem.gravarItem(i);
    this.o.base.esquecer();
    return i;
  }

  private async exigirItem(id: string): Promise<Item> {
    const i = await this.o.armazem.item(this.empresaId, id);
    if (!i) throw erro(404, 'Aprendizado não encontrado.');
    return i;
  }

  async aprovar(id: string, edicao: { texto?: string; pergunta?: string; resposta?: string; destino?: string }, por: string) {
    const i = await this.exigirItem(id);
    if (i.situacao !== 'pendente') throw erro(409, 'Esse aprendizado já foi decidido.');
    if (edicao.texto !== undefined) i.texto = edicao.texto.trim();
    if (edicao.pergunta !== undefined && i.acao === 'pergunta') i.pergunta = edicao.pergunta.trim();
    if (edicao.resposta !== undefined && i.acao === 'pergunta') i.resposta = edicao.resposta.trim();
    if (edicao.destino !== undefined && i.acao === 'acrescentar') {
      const secoes = await this.o.base.secoes();
      if (!secoes.some((s) => s.chave === edicao.destino) && !['roteiro', 'tom', 'pergunta', 'objecao', 'fato', 'evitar'].includes(edicao.destino)) throw erro(400, 'Seção não encontrada.');
      i.destino = edicao.destino;
    }
    if (!i.texto) throw erro(400, 'Escreva o texto do aprendizado.');
    return semInterno(await this.aplicar(i, por, false));
  }

  async recusar(id: string, por: string) {
    const i = await this.exigirItem(id);
    if (i.situacao !== 'pendente') throw erro(409, 'Esse aprendizado já foi decidido.');
    i.situacao = 'recusado';
    i.decididoEm = this.agora();
    i.decididoPor = por;
    await this.o.armazem.gravarItem(i);
    return semInterno(i);
  }

  /** Tira da memória (e, em "corrigir", volta o trecho da base ao que era: a versão anterior fica no histórico da seção). */
  async desfazer(id: string, por: string) {
    const i = await this.exigirItem(id);
    if (i.situacao !== 'aplicado') throw erro(409, 'Só dá para desfazer o que está valendo.');
    if (i.acao === 'corrigir' && i.aplicacao?.secao) {
      const s = await this.o.base.exigirSecao(i.aplicacao.secao);
      const { antes = '', depois = '' } = i.aplicacao;
      if (!depois || !s.conteudo.includes(depois)) throw erro(409, 'A seção mudou depois disso. Volte a versão pelo histórico da seção.');
      await this.o.base.editar(s.chave, { conteudo: s.conteudo.replace(depois, antes) }, `${por} (desfez aprendizado)`);
    }
    i.situacao = 'desfeito';
    i.desfeitoEm = this.agora();
    i.desfeitoPor = por;
    await this.o.armazem.gravarItem(i);
    this.o.base.esquecer();
    return semInterno(i);
  }

  // ------------------------------------------------------------------ documentos do dono

  /** Recebe o PDF (base64) ou texto, guarda e a IA lê em segundo plano. Tudo o que ela propõe espera a gestão. */
  async enviarDocumento(f: { nome: string; base64?: string; texto?: string }, por: string) {
    if (!this.o.iaLigada()) throw erro(409, 'Configure a chave da IA em Conexões para a IA ler o documento.');
    let texto = f.texto?.trim() ?? '';
    let pdf: Buffer | null = null;
    if (f.base64) {
      const buf = Buffer.from(f.base64, 'base64');
      if (/\.pdf$/i.test(f.nome) || buf.subarray(0, 5).toString('latin1') === '%PDF-') {
        if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw erro(400, 'Esse arquivo não é um PDF.');
        texto = textoDoPdf(buf);
        // PDF escaneado ou com letras que o leitor simples não entende: a IA lê o próprio PDF.
        if (texto.replace(/\s+/g, '').length < 200) {
          texto = '';
          pdf = buf;
        }
      } else texto = buf.toString('utf8');
    }
    texto = texto.slice(0, 100_000);
    if (!texto && !pdf) throw erro(422, 'Não encontrei texto nesse arquivo.');
    const agora = this.agora();
    const r: Rodada = {
      id: randomUUID(),
      empresaId: this.empresaId,
      origem: 'documento',
      situacao: 'estudando',
      pedidaPor: por,
      criadaEm: agora,
      atualizadaEm: agora,
      terminadaEm: null,
      conversas: [],
      lidas: 0,
      total: 1,
      observacoes: [],
      tokensEntrada: 0,
      tokensSaida: 0,
      resultado: null,
      erro: null,
      documentoNome: f.nome,
      documentoTexto: texto || null,
      documentoPdf: pdf,
    };
    await this.o.armazem.criarRodada(r);
    this.iniciar(r.id);
    return this.resumoRodada(r);
  }

  private async processarDocumento(r: Rodada) {
    const base = await this.o.base.texto();
    const secoes = await this.o.base.secoes();
    const { propostas, uso } = await this.o.ia.documento(
      base,
      secoes.map((s) => ({ chave: s.chave, titulo: s.titulo })),
      { nome: r.documentoNome ?? 'documento', texto: r.documentoTexto, pdf: r.documentoPdf },
    );
    this.somar(r, uso);
    const res: ResultadoRodada = { lidas: 1, aprendizados: 0, entraram: 0, paraAprovar: 0, reforcados: 0 };
    for (const p of propostas) {
      const item = await this.novoItem(r, p, { origem: `documento: ${r.documentoNome ?? 'documento'}`, conversas: 0, exemplos: p.exemplos.map((e) => e.trim().slice(0, 240)).slice(0, 2), equipe: [] });
      if (!item) continue;
      await this.o.armazem.gravarItem(item);
      res.aprendizados++;
      res.paraAprovar++;
    }
    const agora = this.agora();
    r.situacao = 'pronta';
    r.lidas = 1;
    r.resultado = res;
    r.terminadaEm = agora;
    r.atualizadaEm = agora;
    r.documentoPdf = null;
    r.documentoTexto = null;
    await this.o.armazem.gravarRodada(r);
    this.log(`Documento ${r.documentoNome}: ${res.aprendizados} proposta(s) para aprovar`);
  }
}

const semInterno = ({ empresaId: _e, aplicacao: _a, ...x }: Item) => x;

/** Conversa em linhas "Cliente: ..." / "Equipe: ..." / "IA: ...", sem dados pessoais e com limite de tamanho. */
export function linhasDaConversa(msgs: Mensagem[], nomes: { clientes: string[]; equipe: string[] }): string[] {
  const equipe = [...new Set([...nomes.equipe, ...msgs.flatMap((m) => (m.autor === 'equipe' && m.autorNome ? [m.autorNome] : []))])];
  const linhas: string[] = [];
  let tam = 0;
  for (const m of msgs) {
    if (m.autor === 'sistema') continue;
    const texto = m.texto.replace(/\s+/g, ' ').trim();
    if (!texto) continue;
    const quem = m.autor === 'cliente' ? 'Cliente' : m.autor === 'equipe' ? 'Equipe' : 'IA';
    const l = `${quem}: ${anonimizar(texto.length > LIMITE_MENSAGEM ? `${texto.slice(0, LIMITE_MENSAGEM)}…` : texto, { clientes: nomes.clientes, equipe })}`;
    if (tam + l.length > LIMITE_CONVERSA) break;
    tam += l.length;
    linhas.push(l);
  }
  return linhas;
}
