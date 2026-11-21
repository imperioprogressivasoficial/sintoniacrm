import { randomUUID } from 'node:crypto';
import { request as pedirHttp } from 'node:http';
import { request as pedirHttps } from 'node:https';
import type { Conversa, Mensagem } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import type { ArmazemIntegracoes, Entrega, Webhook } from './armazem.js';
import { EVENTO_TESTE, TIPOS_EVENTO, type TipoEvento } from './catalogo.js';
import { cabecalhoAssinatura, gerarSegredoWebhook } from './chaves.js';
import { conferirDestino, conferirUrl, ErroDestino, lookupSeguro, type OpcoesDestino } from './ssrf.js';

/**
 * Webhooks de saída: a empresa cadastra URLs e escolhe os eventos; a Sintonia avisa com um POST assinado.
 * - Os eventos saem dos pontos onde as coisas já acontecem (repo.registrarEvento, via observarEventos),
 *   sem mudar o comportamento de ninguém: aqui só se lê e se enfileira.
 * - Fila persistente (webhook_entregas) com novas tentativas e espera crescente; depois de muitas falhas
 *   seguidas o webhook se desliga sozinho e a gestão recebe um aviso.
 * - Assinatura: cabeçalho `Sintonia-Assinatura: t=<segundos>,v1=<HMAC-SHA256 hex de "t.corpo">`.
 */

export class ErroWebhook extends Error {
  constructor(
    msg: string,
    readonly statusCode = 400,
    readonly codigo = 'dados_invalidos',
  ) {
    super(msg);
  }
}

/** Uma chamada HTTP de entrega (troque nos testes). */
export type Transporte = (p: { url: URL; corpo: string; cabecalhos: Record<string, string>; timeoutMs: number }) => Promise<{ status: number; corpo: string }>;

const LIMITE_RESPOSTA = 16 * 1024;

/** POST de verdade, sem seguir redirecionamento e conferindo o IP na hora de conectar. */
export function transporteHttp(permitirLocal = false): Transporte {
  return ({ url, corpo, cabecalhos, timeoutMs }) =>
    new Promise((ok, falha) => {
      const pedir = url.protocol === 'https:' ? pedirHttps : pedirHttp;
      const req = pedir(
        url,
        {
          method: 'POST',
          headers: { ...cabecalhos, 'content-length': String(Buffer.byteLength(corpo)) },
          lookup: lookupSeguro(permitirLocal) as never,
          timeout: timeoutMs,
        },
        (res) => {
          const partes: Buffer[] = [];
          let tamanho = 0;
          res.on('data', (b: Buffer) => {
            if (tamanho < LIMITE_RESPOSTA) partes.push(b);
            tamanho += b.length;
            if (tamanho > 1024 * 1024) res.destroy();
          });
          res.on('end', () => ok({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8').slice(0, LIMITE_RESPOSTA) }));
          res.on('error', falha);
        },
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error(`Sem resposta em ${Math.round(timeoutMs / 1000)} s`), { code: 'ETIMEDOUT' })));
      req.on('error', falha);
      req.end(corpo);
    });
}

/** Espera antes de cada nova tentativa: 1 min, 5 min, 30 min, 2 h, 5 h, 10 h, 24 h. */
export const ESPERAS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 5 * 3600_000, 10 * 3600_000, 24 * 3600_000];

export interface OpcoesWebhooks extends Pick<OpcoesDestino, 'producao' | 'permitirLocal' | 'resolver'> {
  armazem: ArmazemIntegracoes;
  cofre: { cifrar(t: string): string; decifrar(t: string): string };
  repo: Pick<Repositorio, 'buscarConversa' | 'mensagens'>;
  /** Nomes do funil e da etapa (para o corpo do evento "lead.etapa_mudou"). */
  nomes?: { funil(id: string): Promise<string | undefined>; etapa(id: string): Promise<string | undefined> };
  transporte?: Transporte;
  /** Aviso para a gestão (sino) quando um webhook é desligado. */
  avisar?: (a: { titulo: string; texto: string; chave: string; vista?: string }) => Promise<unknown>;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Falhas seguidas até desligar sozinho (padrão 20). */
  limiteFalhas?: number;
  /** Tentativas por entrega (padrão 8: a primeira e mais 7). */
  maxTentativas?: number;
  timeoutMs?: number;
}

export const resumoConversa = (c: Conversa) => ({
  id: c.id,
  telefone: c.telefone,
  nome: c.nome ?? null,
  unidade: c.unidade,
  etapa: c.etapa,
  modo: c.modo,
  responsavel: c.responsavelId ? { id: c.responsavelId, nome: c.responsavelNome ?? null } : null,
});

export const resumoMensagem = (m: Mensagem) => ({
  id: m.id,
  autor: m.autor,
  autorNome: m.autorNome ?? null,
  texto: m.texto,
  em: m.em.toISOString(),
  ...(m.anexo ? { anexo: { tipo: m.anexo.tipo, mimetype: m.anexo.mimetype ?? null, nomeArquivo: m.anexo.nomeArquivo ?? null, legenda: m.anexo.legenda ?? null } } : {}),
  ...(m.entrega ? { entrega: m.entrega } : {}),
});

const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const LIMITE_NOME = 80;

export class Webhooks {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly transporte: Transporte;
  private readonly limiteFalhas: number;
  private readonly maxTentativas: number;
  private cache?: { ate: number; lista: Webhook[] };
  private rodando = false;
  private ultimaLimpeza = 0;
  /** Entregas em andamento (para o desligamento limpo esperar). */
  private emAndamento = new Set<Promise<unknown>>();

  constructor(private readonly o: OpcoesWebhooks) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
    this.transporte = o.transporte ?? transporteHttp(Boolean(o.permitirLocal && !o.producao));
    this.limiteFalhas = o.limiteFalhas ?? 20;
    this.maxTentativas = o.maxTentativas ?? ESPERAS_MS.length + 1;
  }

  private destino() {
    return { producao: this.o.producao, permitirLocal: this.o.permitirLocal, resolver: this.o.resolver };
  }

  // ------------------------------------------------------------------ cadastro (tela Integrações)

  private validarEventos(eventos: string[]): TipoEvento[] {
    const unicos = [...new Set(eventos)];
    if (!unicos.length) throw new ErroWebhook('Escolha pelo menos um evento.');
    const ruins = unicos.filter((e) => !(TIPOS_EVENTO as readonly string[]).includes(e));
    if (ruins.length) throw new ErroWebhook(`Evento desconhecido: ${ruins.join(', ')}.`);
    return unicos as TipoEvento[];
  }

  private nomeValido(nome: string | undefined, url: URL): string {
    const n = (nome ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITE_NOME);
    return n || url.hostname;
  }

  async criar(empresaId: string, d: { nome?: string; url: string; eventos: string[] }, por: string | null): Promise<{ webhook: Webhook; segredo: string }> {
    const url = await conferirDestino(d.url, this.destino());
    const eventos = this.validarEventos(d.eventos);
    if ((await this.o.armazem.webhooks(empresaId)).length >= 20) throw new ErroWebhook('Limite de 20 webhooks por empresa.', 409, 'limite');
    const segredo = gerarSegredoWebhook();
    const agora = this.agora();
    const w: Webhook = {
      id: randomUUID(), empresaId, nome: this.nomeValido(d.nome, url), url: url.toString(), eventos, segredoCifrado: this.o.cofre.cifrar(segredo),
      ativo: true, desligadoMotivo: null, desligadoEm: null, falhasSeguidas: 0, ultimoSucessoEm: null, ultimaFalhaEm: null,
      criadoPor: por, criadoEm: agora, atualizadoEm: agora,
    };
    await this.o.armazem.criarWebhook(w);
    this.cache = undefined;
    return { webhook: w, segredo };
  }

  async exigir(empresaId: string, id: string): Promise<Webhook> {
    const w = await this.o.armazem.webhook(empresaId, id);
    if (!w) throw new ErroWebhook('Webhook não encontrado.', 404, 'nao_encontrado');
    return w;
  }

  async alterar(empresaId: string, id: string, d: { nome?: string; url?: string; eventos?: string[]; ativo?: boolean }): Promise<Webhook> {
    const atual = await this.exigir(empresaId, id);
    const campos: Parameters<ArmazemIntegracoes['atualizarWebhook']>[2] = {};
    const url = d.url !== undefined ? await conferirDestino(d.url, this.destino()) : new URL(atual.url);
    if (d.url !== undefined) campos.url = url.toString();
    if (d.nome !== undefined) campos.nome = this.nomeValido(d.nome, url);
    if (d.eventos !== undefined) campos.eventos = this.validarEventos(d.eventos);
    if (d.ativo === true && !atual.ativo) Object.assign(campos, { ativo: true, falhasSeguidas: 0, desligadoMotivo: null, desligadoEm: null });
    if (d.ativo === false && atual.ativo) Object.assign(campos, { ativo: false, desligadoMotivo: 'Desligado pela equipe', desligadoEm: this.agora() });
    await this.o.armazem.atualizarWebhook(empresaId, id, campos, this.agora());
    if (d.ativo === false && atual.ativo) await this.o.armazem.cancelarPendentes(id, 'Webhook desligado', this.agora());
    this.cache = undefined;
    return this.exigir(empresaId, id);
  }

  async apagar(empresaId: string, id: string): Promise<void> {
    if (!(await this.o.armazem.apagarWebhook(empresaId, id))) throw new ErroWebhook('Webhook não encontrado.', 404, 'nao_encontrado');
    this.cache = undefined;
  }

  async segredo(empresaId: string, id: string): Promise<string> {
    return this.o.cofre.decifrar((await this.exigir(empresaId, id)).segredoCifrado);
  }

  async trocarSegredo(empresaId: string, id: string): Promise<string> {
    await this.exigir(empresaId, id);
    const segredo = gerarSegredoWebhook();
    await this.o.armazem.atualizarWebhook(empresaId, id, { segredoCifrado: this.o.cofre.cifrar(segredo) }, this.agora());
    return segredo;
  }

  // ------------------------------------------------------------------ eventos

  private async ativos(): Promise<Webhook[]> {
    const t = Date.now();
    if (this.cache && this.cache.ate > t) return this.cache.lista;
    const lista = await this.o.armazem.webhooksAtivos();
    this.cache = { ate: t + 10_000, lista };
    return lista;
  }

  private novaEntrega(w: Pick<Webhook, 'id' | 'empresaId'>, evento: string, eventoId: string, corpo: Record<string, unknown>, teste = false): Entrega {
    const agora = this.agora();
    return {
      id: randomUUID(), webhookId: w.id, empresaId: w.empresaId, evento, eventoId, corpo, status: 'pendente', tentativas: 0, proximaEm: agora,
      reservadaAte: null, ultimoHttp: null, ultimaResposta: null, ultimoErro: null, duracaoMs: null, teste, criadaEm: agora, entregueEm: null, atualizadaEm: agora,
    };
  }

  /** Alguém assina este evento nesta empresa? (sem consultar nada além do cache) */
  async interessa(empresaId: string, tipo: TipoEvento): Promise<boolean> {
    return (await this.ativos()).some((w) => w.empresaId === empresaId && w.eventos.includes(tipo));
  }

  /** Enfileira o evento para cada webhook ligado da empresa que o assina. Devolve quantas entregas. */
  async emitir(empresaId: string, tipo: TipoEvento, dados: Record<string, unknown>, em?: Date): Promise<number> {
    const alvos = (await this.ativos()).filter((w) => w.empresaId === empresaId && w.eventos.includes(tipo));
    if (!alvos.length) return 0;
    const eventoId = `evt_${randomUUID().replace(/-/g, '')}`;
    const corpo = { id: eventoId, tipo, criadoEm: (em ?? this.agora()).toISOString(), empresaId, dados };
    await this.o.armazem.enfileirar(alvos.map((w) => this.novaEntrega(w, tipo, eventoId, corpo)));
    return alvos.length;
  }

  /** Ouvinte do repositório (observarEventos). Nunca lança e não segura quem registrou o evento. */
  aoEvento(e: Evento): void {
    const p = this.traduzir(e).catch((erro) => this.log('Falha ao preparar o webhook', { tipo: e.tipo, erro: String(erro).slice(0, 200) }));
    this.emAndamento.add(p);
    void p.finally(() => this.emAndamento.delete(p));
  }

  private tipoDe(e: Evento): TipoEvento | undefined {
    switch (e.tipo) {
      case 'mensagem_cliente': return 'mensagem.recebida';
      case 'equipe_respondeu': case 'ia_respondeu': case 'envio_ativo': return 'mensagem.enviada';
      case 'conversa_nova': case 'lead_importado': return 'contato.criado';
      case 'etapa_movida': return 'lead.etapa_mudou';
      case 'tag_marcada': return 'tag.aplicada';
      case 'tag_desmarcada': return 'tag.removida';
      case 'agendamento_ia': case 'agendamento_equipe': return 'agendamento.criado';
      case 'atendimento_finalizado': return 'atendimento.finalizado';
      case 'nps': return 'nps.respondido';
      default: return undefined;
    }
  }

  private async traduzir(e: Evento): Promise<number> {
    const tipo = this.tipoDe(e);
    if (!tipo || !e.conversaId) return 0;
    if (e.dados?.teste === true) return 0; // automações em modo de teste
    // Ninguém assina este evento: nada é consultado.
    if (!(await this.ativos()).some((w) => w.eventos.includes(tipo))) return 0;
    const c = await this.o.repo.buscarConversa(e.conversaId);
    if (!c || !(await this.interessa(c.empresaId, tipo))) return 0;
    const d = e.dados ?? {};
    const conversa = resumoConversa(c);
    let dados: Record<string, unknown>;
    switch (tipo) {
      case 'mensagem.recebida':
      case 'mensagem.enviada': {
        const ultimas = await this.o.repo.mensagens(c.id, 5);
        const m = [...ultimas].reverse().find((x) => (tipo === 'mensagem.recebida' ? x.autor === 'cliente' : x.autor !== 'cliente' && x.autor !== 'sistema'));
        if (!m) return 0;
        dados = { conversa, mensagem: resumoMensagem(m) };
        break;
      }
      case 'contato.criado':
        dados = { conversa, origem: e.tipo === 'lead_importado' ? 'importacao' : 'conversa' };
        break;
      case 'lead.etapa_mudou': {
        const nome = async (id: unknown, f: 'funil' | 'etapa') => (typeof id === 'string' ? ((await this.o.nomes?.[f](id).catch(() => undefined)) ?? null) : null);
        const etapa = async (id: unknown) => (typeof id === 'string' ? { id, nome: await nome(id, 'etapa') } : null);
        dados = {
          conversa,
          funil: { id: d.funilId ?? null, nome: await nome(d.funilId, 'funil') },
          de: await etapa(d.de),
          para: await etapa(d.para),
          por: texto(d.por),
          automatico: Boolean(d.automatico),
        };
        break;
      }
      case 'tag.aplicada':
      case 'tag.removida':
        dados = { conversa, tag: { id: d.tagId ?? null, nome: texto(d.nome) }, por: texto(d.por) };
        break;
      case 'agendamento.criado':
        dados = {
          conversa,
          agendamento: {
            id: typeof d.trinksId === 'number' ? `t${d.trinksId}` : `${c.id}-${texto(d.inicio) ?? ''}`,
            origem: 'agenda',
            inicio: texto(d.inicio),
            duracaoMin: typeof d.duracaoMin === 'number' ? d.duracaoMin : null,
            servico: texto(d.servico),
            profissional: texto(d.profissional),
            por: e.tipo === 'agendamento_ia' ? 'IA' : (texto(d.atendente) ?? 'Equipe'),
          },
        };
        break;
      case 'atendimento.finalizado':
        dados = {
          conversa,
          motivo: texto(d.motivo),
          motivoNome: texto(d.motivoNome),
          atendente: d.atendenteId || d.atendenteNome ? { id: d.atendenteId ?? null, nome: texto(d.atendenteNome) } : null,
          por: texto(d.porNome),
          pesquisa: texto(d.pesquisa),
        };
        break;
      case 'nps.respondido':
        dados = {
          conversa,
          nota: typeof d.nota === 'number' ? d.nota : null,
          categoria: texto(d.categoria),
          comentario: texto(d.comentario),
          atendente: d.atendenteId || d.atendenteNome ? { id: d.atendenteId ?? null, nome: texto(d.atendenteNome) } : null,
        };
        break;
      default:
        return 0;
    }
    return this.emitir(c.empresaId, tipo, dados, e.em);
  }

  // ------------------------------------------------------------------ entrega

  /** Anda a fila: entrega as vencidas (até 25 por volta, 5 ao mesmo tempo). */
  async tick(): Promise<number> {
    if (this.rodando) return 0;
    this.rodando = true;
    try {
      const agora = this.agora();
      if (agora.getTime() - this.ultimaLimpeza > 3600_000) {
        this.ultimaLimpeza = agora.getTime();
        await this.o.armazem.limpar(new Date(agora.getTime() - 30 * 86400_000)).catch((e) => this.log('Falha ao limpar o histórico dos webhooks', String(e)));
      }
      const lista = await this.o.armazem.reivindicar(agora, 25, 2 * 60_000);
      for (let i = 0; i < lista.length; i += 5) await Promise.all(lista.slice(i, i + 5).map((e) => this.processar(e)));
      return lista.length;
    } finally {
      this.rodando = false;
    }
  }

  /** Espera crescente, com um pouco de variação para os reenvios não saírem todos juntos. */
  private espera(tentativa: number): number {
    const base = ESPERAS_MS[Math.min(tentativa - 1, ESPERAS_MS.length - 1)]!;
    return Math.round(base * (0.9 + Math.random() * 0.2));
  }

  /** Uma tentativa de entrega (a entrega já foi reivindicada: `tentativas` conta esta). */
  async processar(e: Entrega): Promise<Entrega> {
    const agora = this.agora();
    const w = await this.o.armazem.webhook(e.empresaId, e.webhookId);
    const fim = async (campos: Parameters<ArmazemIntegracoes['atualizarEntrega']>[1]) => {
      await this.o.armazem.atualizarEntrega(e.id, { reservadaAte: null, ...campos }, this.agora());
      return { ...e, ...campos, reservadaAte: null } as Entrega;
    };
    if (!w) return fim({ status: 'cancelada', ultimoErro: 'Webhook apagado', proximaEm: null });
    if (!w.ativo && !e.teste) return fim({ status: 'cancelada', ultimoErro: 'Webhook desligado', proximaEm: null });

    const corpo = JSON.stringify(e.corpo);
    const t = Math.floor(agora.getTime() / 1000);
    const inicio = Date.now();
    let status: number | null = null;
    let resposta: string | null = null;
    let erro: string | null = null;
    try {
      const segredo = this.o.cofre.decifrar(w.segredoCifrado);
      const url = await conferirDestino(w.url, this.destino());
      const r = await this.transporte({
        url,
        corpo,
        timeoutMs: this.o.timeoutMs ?? 10_000,
        cabecalhos: {
          'content-type': 'application/json; charset=utf-8',
          'user-agent': 'Sintonia-Webhooks/1.0',
          'sintonia-evento': e.evento,
          'sintonia-evento-id': e.eventoId,
          'sintonia-entrega': e.id,
          'sintonia-tentativa': String(e.tentativas),
          'sintonia-assinatura': cabecalhoAssinatura(segredo, t, corpo),
        },
      });
      status = r.status;
      resposta = r.corpo.slice(0, 2000);
      if (r.status < 200 || r.status >= 300) erro = r.status >= 300 && r.status < 400 ? `Respondeu ${r.status} (redirecionamento não é seguido)` : `Respondeu ${r.status}`;
    } catch (x) {
      const code = (x as { code?: string }).code;
      erro = x instanceof ErroDestino || code === 'EDESTINO' ? `Destino bloqueado: ${(x as Error).message}` : code === 'ETIMEDOUT' ? 'Sem resposta em 10 s' : `Não conectou: ${String((x as Error).message ?? x).slice(0, 200)}`;
    }
    const duracaoMs = Date.now() - inicio;
    const base = { ultimoHttp: status, ultimaResposta: resposta, ultimoErro: erro, duracaoMs };
    if (!erro) {
      if (!e.teste) await this.o.armazem.resultadoWebhook(w.id, true, this.agora());
      return fim({ ...base, status: 'entregue', entregueEm: this.agora(), proximaEm: null });
    }
    // Teste: uma tentativa só, e não conta para desligar.
    if (e.teste) return fim({ ...base, status: 'falhou', proximaEm: null });
    const falhas = await this.o.armazem.resultadoWebhook(w.id, false, this.agora());
    const r = e.tentativas >= this.maxTentativas
      ? await fim({ ...base, status: 'falhou', proximaEm: null })
      : await fim({ ...base, status: 'pendente', proximaEm: new Date(this.agora().getTime() + this.espera(e.tentativas)) });
    if (falhas >= this.limiteFalhas && w.ativo) await this.desligar(w, falhas);
    return r;
  }

  private async desligar(w: Webhook, falhas: number): Promise<void> {
    const agora = this.agora();
    const motivo = `Desligado sozinho depois de ${falhas} falhas seguidas`;
    await this.o.armazem.atualizarWebhook(w.empresaId, w.id, { ativo: false, desligadoMotivo: motivo, desligadoEm: agora }, agora);
    await this.o.armazem.cancelarPendentes(w.id, 'Webhook desligado depois de muitas falhas', agora);
    this.cache = undefined;
    let host = w.url;
    try { host = new URL(w.url).host; } catch { /* fica a URL */ }
    this.log('Webhook desligado depois de muitas falhas', { webhook: w.id, host, falhas });
    await this.o.avisar?.({
      titulo: 'Webhook desligado',
      texto: `O endereço ${host} ("${w.nome}") falhou ${falhas} vezes seguidas e foi desligado. Confira o sistema que recebe e ligue de novo em Integrações › Webhooks.`,
      chave: `webhook-desligado-${w.id}-${agora.toISOString().slice(0, 10)}`,
      vista: 'integracoes',
    }).catch((x) => this.log('Falha ao avisar sobre o webhook desligado', String(x)));
  }

  /** Botão "Enviar teste": entrega agora um evento de exemplo e devolve o resultado. */
  async testar(empresaId: string, id: string): Promise<Entrega> {
    const w = await this.exigir(empresaId, id);
    conferirUrl(w.url, this.destino());
    const eventoId = `evt_teste_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const corpo = {
      id: eventoId, tipo: EVENTO_TESTE, criadoEm: this.agora().toISOString(), empresaId, teste: true,
      dados: { mensagem: 'Teste da Sintonia: se você recebeu isto, o webhook está funcionando.', webhook: { id: w.id, nome: w.nome } },
    };
    return this.agoraJa(this.novaEntrega(w, EVENTO_TESTE, eventoId, corpo, true));
  }

  /** Botão "Reenviar": nova entrega com o mesmo corpo (o mesmo id de evento, para o outro lado reconhecer). */
  async reenviar(empresaId: string, entregaId: string): Promise<Entrega> {
    const antiga = await this.o.armazem.entrega(empresaId, entregaId);
    if (!antiga) throw new ErroWebhook('Entrega não encontrada.', 404, 'nao_encontrado');
    const w = await this.exigir(empresaId, antiga.webhookId);
    if (!w.ativo) throw new ErroWebhook('Este webhook está desligado. Ligue de novo para reenviar.', 409, 'desligado');
    return this.agoraJa(this.novaEntrega(w, antiga.evento, antiga.eventoId, antiga.corpo, antiga.teste));
  }

  private async agoraJa(e: Entrega): Promise<Entrega> {
    // Grava já reservada (a fila não pega no meio) e com a tentativa contada.
    const agora = this.agora();
    const reservada = { ...e, tentativas: 1, reservadaAte: new Date(agora.getTime() + 60_000) };
    await this.o.armazem.enfileirar([reservada]);
    return this.processar(reservada);
  }

  /** Espera os eventos que ainda estão sendo preparados (desligamento limpo e testes). */
  async ocioso(): Promise<void> {
    while (this.emAndamento.size) await Promise.all([...this.emAndamento]);
  }
}
