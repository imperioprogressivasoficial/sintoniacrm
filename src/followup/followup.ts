import type { Conversa } from '../domain.js';
import type { PedidoAgente, RespostaAgente } from '../ai/agente.js';
import { ajustarParaJanelaAtiva, estaAberta, proximaAbertura } from '../engine/horario.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { UNIDADES } from '../unidades.js';
import { DIA, HORA, MIN, partesBahia } from '../util/tempo.js';
import type { ArmazemFollowup } from './armazem.js';
import {
  ConfigFollowup,
  NOME_SITUACAO,
  normalizarConfig,
  lerResposta,
  preencher,
  SITUACOES,
  type Confirmacao,
  type EnvioFollowup,
  type Situacao,
  type StatusConfirmacao,
} from './tipos.js';

/**
 * Follow-up automático configurável e confirmação automática de agenda.
 *
 * - Ouve os eventos da Sintonia (agendamento, resposta da loja, tag marcada, equipe assumiu) e programa envios
 *   numa fila persistente (followup_envios). A chave de cada envio é única: nada sai duas vezes, nem depois de reiniciar.
 * - O relógio (tick) envia o que venceu, sob a trava da conversa, respeitando o horário da unidade.
 * - A resposta da cliente chega pelo gancho mensagemCliente (já sob a trava): para as cadências e lê "1"/"2" da confirmação.
 */

export interface SintoniaParaFollowup {
  comConversa<T>(conversaId: string, fn: (c: Conversa) => Promise<T>): Promise<T | undefined>;
  enviarAutomatico(c: Conversa, texto: string, autorNome: string): Promise<string>;
}

export interface EmailParaFollowup {
  deAutomacao(p: { conversa: Conversa; modeloId: string; chave: string; variaveis?: Record<string, string> }): Promise<{ ok: true; detalhe: string } | { ok: false; motivo: string }>;
  modeloExiste?(id: string): Promise<boolean>;
  salvarModelo?(id: string | null, bruto: unknown, quem: string): Promise<{ id: string }>;
}

export interface TagsParaFollowup {
  porNome(nome: string): Promise<{ id: string; nome: string } | undefined>;
  criar(dados: { nome: string }, por: string): Promise<{ id: string; nome: string }>;
  marcar(c: Conversa, tagId: string, por: string): Promise<unknown>;
}

export interface OpcoesFollowup {
  empresaId: string;
  armazem: ArmazemFollowup;
  repo: Repositorio;
  sintonia: () => SintoniaParaFollowup;
  /** IA para "a IA escreve a mensagem com este objetivo". Só é usada quando `iaDisponivel()` diz que há chave. */
  agente?: { executar(p: PedidoAgente): Promise<RespostaAgente> };
  iaDisponivel?: () => boolean;
  email?: EmailParaFollowup;
  tags?: TagsParaFollowup;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

const AUTOR_FOLLOWUP = 'Follow-up';
const AUTOR_CONFIRMACAO = 'Confirmação de agenda';
const RESERVA_MS = 5 * MIN;
/** Cadências "de venda": param quando a cliente agenda. */
const DE_VENDA: Situacao[] = ['sem_resposta', 'preco_sem_agendar', 'orcamento', 'faltou'];
const PEDIU_PRECO = /\b(pre[cç]os?|valor(es)?|quanto (custa|fica|é|e|sai|cobra|cobram|seria)|tabela de pre[cç]o)\b/i;
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const dois = (n: number) => String(n).padStart(2, '0');
export function dataHora(d: Date): { data: string; hora: string } {
  const p = partesBahia(d);
  return { data: `${DIAS[p.diaSemana]}, ${dois(p.dia)}/${dois(p.mes)}`, hora: `${dois(p.hora)}:${dois(p.minuto)}` };
}

export class Followup {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private cache?: { cfg: ConfigFollowup; ate: number };
  private fila: Promise<void> = Promise.resolve();
  private rodando = false;

  constructor(private readonly o: OpcoesFollowup) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  // ------------------------------------------------------------ configuração

  async config(): Promise<ConfigFollowup> {
    if (this.cache && this.cache.ate > Date.now()) return this.cache.cfg;
    const cfg = normalizarConfig(await this.o.armazem.lerConfig(this.o.empresaId));
    this.cache = { cfg, ate: Date.now() + 5000 };
    return cfg;
  }

  async salvarConfig(bruto: unknown, por: string): Promise<ConfigFollowup> {
    const cfg = normalizarConfig(ConfigFollowup.parse(bruto));
    await this.o.armazem.gravarConfig(this.o.empresaId, cfg, por);
    this.cache = undefined;
    return cfg;
  }

  /**
   * O que o motor antigo da Sintonia continua fazendo: os follow-ups fixos (1h/1d/3d) saem quando a cadência
   * "Não respondeu" está ligada; os lembretes fixos (véspera/2h) saem quando a confirmação de agenda está ligada na unidade.
   */
  async motor(c: Pick<Conversa, 'unidade'>): Promise<{ followups: boolean; lembretes: boolean }> {
    const cfg = await this.config().catch(() => undefined);
    if (!cfg) return { followups: true, lembretes: true };
    const semResposta = cfg.cadencias.find((x) => x.id === 'sem_resposta');
    const unidade = cfg.confirmacao.unidades[c.unidade];
    return { followups: !semResposta?.ligada, lembretes: !(cfg.confirmacao.ligada && unidade?.ligada !== false) };
  }

  // ------------------------------------------------------------ eventos

  /** Ouvinte dos eventos (observarEventos). Pode ser chamado sob a trava: só registra e enfileira. */
  aoEvento(e: Evento): void {
    this.fila = this.fila.then(() => this.tratar(e)).catch((x) => this.log('Falha no follow-up (evento)', { tipo: e.tipo, erro: String(x) }));
  }

  /** Espera os eventos enfileirados (testes). */
  async ocioso(): Promise<void> {
    await this.fila;
  }

  private async tratar(e: Evento): Promise<void> {
    if (!e.conversaId) return;
    const id = e.conversaId;
    const cfg = await this.config();
    const d = e.dados ?? {};
    switch (e.tipo) {
      case 'agendamento_ia':
      case 'agendamento_equipe': {
        await this.o.armazem.cancelar(id, { tipo: 'cadencia', situacoes: DE_VENDA }, 'agendou');
        await this.programarConfirmacao(id, e);
        const inicio = typeof d.inicio === 'string' ? new Date(d.inicio) : undefined;
        if (inicio && !Number.isNaN(inicio.getTime())) {
          const fim = new Date(inicio.getTime() + (typeof d.duracaoMin === 'number' ? d.duracaoMin : 60) * MIN);
          await this.o.armazem.cancelar(id, { tipo: 'cadencia', situacoes: ['pos_atendimento'] }, 'novo agendamento');
          await this.comecar(id, 'pos_atendimento', fim, { servico: typeof d.servico === 'string' ? d.servico : null });
        }
        return;
      }
      case 'ia_respondeu':
        await this.comecarSemResposta(id, e.em);
        return;
      case 'equipe_respondeu':
        if (cfg.pararQuandoEquipeAssume) await this.o.armazem.cancelar(id, { tipo: 'cadencia', exceto: ['pos_atendimento'] }, 'a equipe respondeu');
        else await this.comecarSemResposta(id, e.em);
        return;
      case 'transferencia':
        if (cfg.pararQuandoEquipeAssume && d.paraId) await this.o.armazem.cancelar(id, { tipo: 'cadencia', exceto: ['pos_atendimento'] }, 'a equipe assumiu');
        return;
      case 'passou_para_humano':
        await this.o.armazem.cancelar(id, { tipo: 'cadencia', exceto: ['pos_atendimento'] }, 'passou para a equipe');
        return;
      case 'etapa_mudou':
        if (d.para === 'perdida') await this.o.armazem.cancelar(id, { tipo: 'cadencia' }, 'conversa perdida');
        return;
      case 'tag_marcada': {
        const nome = String(d.nome ?? '');
        if (/falt/i.test(nome)) await this.comecar(id, 'faltou', e.em);
        else if (/or[cç]amento/i.test(nome)) await this.comecar(id, 'orcamento', e.em);
        return;
      }
      default:
        return;
    }
  }

  private async comecarSemResposta(conversaId: string, em: Date): Promise<void> {
    const pendentes = (await this.o.armazem.envios(conversaId)).filter((x) => x.tipo === 'cadencia' && x.estado === 'pendente');
    // Uma cadência específica (preço, orçamento, falta) em andamento vale mais que a genérica.
    if (pendentes.some((x) => x.situacao !== 'sem_resposta' && x.situacao !== 'pos_atendimento')) return;
    await this.comecar(conversaId, 'sem_resposta', em);
  }

  /** Começa (ou recomeça) uma cadência a partir de `base`: programa o primeiro passo. */
  private async comecar(conversaId: string, situacao: Situacao, base: Date, extra: Record<string, unknown> = {}): Promise<boolean> {
    const cfg = await this.config();
    const cad = cfg.cadencias.find((c) => c.id === situacao);
    if (!cad?.ligada) return false;
    if (await this.o.armazem.pausado(conversaId)) return false;
    const c = await this.o.repo.buscarConversa(conversaId);
    if (!c || c.empresaId !== this.o.empresaId) return false;
    if (DE_VENDA.includes(situacao) && situacao !== 'faltou' && (c.etapa === 'agendada' || c.etapa === 'compareceu' || c.etapa === 'perdida')) return false;
    if (situacao !== 'pos_atendimento' && c.modo === 'humano' && cfg.pararQuandoEquipeAssume) return false;
    await this.o.armazem.cancelar(conversaId, { tipo: 'cadencia', situacoes: situacao === 'sem_resposta' ? ['sem_resposta'] : [situacao, 'sem_resposta'] }, 'recomeçou');
    const primeiro = cad.passos[0]!;
    return this.o.armazem.programar(
      this.o.empresaId,
      {
        conversaId,
        tipo: 'cadencia',
        situacao,
        passo: 0,
        total: cad.passos.length,
        chave: `cad:${conversaId}:${situacao}:${base.getTime()}:0`,
        quando: new Date(base.getTime() + primeiro.esperaHoras * HORA),
        dados: { base: base.toISOString(), ...extra },
      },
      this.agora(),
    );
  }

  /** Agendamento novo: guarda a confirmação (status "Aguardando") e programa a mensagem X horas antes e os lembretes. */
  private async programarConfirmacao(conversaId: string, e: Evento): Promise<void> {
    const d = e.dados ?? {};
    if (typeof d.inicio !== 'string' || Number.isNaN(Date.parse(d.inicio))) return;
    const inicio = new Date(d.inicio);
    const agora = this.agora();
    if (inicio.getTime() <= agora.getTime()) return;
    const c = await this.o.repo.buscarConversa(conversaId);
    if (!c) return;
    const unidade = e.unidade ?? c.unidade;
    const agendamento = typeof d.trinksId === 'number' ? `t${d.trinksId}` : `${conversaId}-${d.inicio}`;
    const servico = typeof d.servico === 'string' ? d.servico : null;
    const profissional = typeof d.profissional === 'string' ? d.profissional : null;
    await this.o.armazem.salvarConfirmacao(this.o.empresaId, { agendamento, conversaId, unidade, inicio, servico, profissional });
    // Remarcou: os envios do horário antigo desta conversa não saem mais.
    await this.o.armazem.cancelar(conversaId, { tipo: 'confirmacao', dadosAgendamentoDiferente: agendamento }, 'remarcado');
    const cfg = await this.config();
    const u = cfg.confirmacao.unidades[unidade];
    if (!cfg.confirmacao.ligada || u?.ligada === false) return;
    const horas = [...new Set(u?.horasAntes ?? [24, 2])].sort((a, b) => b - a);
    for (const [i, h] of horas.entries()) {
      let quando = new Date(inicio.getTime() - h * HORA);
      if (quando.getTime() <= agora.getTime()) {
        // Marcado em cima da hora: a confirmação sai já, se ainda faltam 3 horas ou mais. Os lembretes que passaram, não.
        if (i === 0 && inicio.getTime() - agora.getTime() >= 3 * HORA) quando = agora;
        else continue;
      }
      await this.o.armazem.programar(
        this.o.empresaId,
        {
          conversaId,
          tipo: 'confirmacao',
          situacao: i === 0 ? 'confirmacao' : 'lembrete',
          passo: i,
          total: horas.length,
          chave: `conf:${agendamento}:${h}`,
          quando,
          dados: { agendamento, inicio: inicio.toISOString(), servico, profissional, horas: h },
        },
        agora,
      );
    }
  }

  // ------------------------------------------------------------ resposta da cliente (sob a trava)

  /**
   * Gancho mensagemCliente (já SOB a trava da conversa; não pode pedir a trava de novo).
   * Para as cadências, lê a resposta da confirmação e começa "pediu preço" quando for o caso.
   */
  async mensagemCliente(c: Conversa, m: { texto: string }): Promise<void> {
    const cfg = await this.config();
    const param = cfg.cadencias.filter((x) => x.pararSeResponder).map((x) => x.id as string);
    if (param.length) await this.o.armazem.cancelar(c.id, { tipo: 'cadencia', situacoes: param }, 'a cliente respondeu');
    const leu = await this.lerConfirmacao(c, m.texto, cfg);
    if (!leu && PEDIU_PRECO.test(m.texto) && c.etapa !== 'agendada' && c.etapa !== 'compareceu') await this.comecar(c.id, 'preco_sem_agendar', this.agora());
  }

  private async lerConfirmacao(c: Conversa, texto: string, cfg: ConfigFollowup): Promise<boolean> {
    const agora = this.agora();
    const abertas = (await this.o.armazem.confirmacoesDa(c.id))
      .filter((x) => (x.status === 'aguardando' || x.status === 'sem_resposta') && x.perguntadoEm && x.inicio.getTime() > agora.getTime() - 2 * HORA)
      .sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
    const conf = abertas[0];
    if (!conf) return false;
    const r = lerResposta(texto);
    if (!r) return false;
    await this.o.armazem.marcarConfirmacao(this.o.empresaId, conf.agendamento, { status: r, respondidoEm: agora, resposta: texto.slice(0, 200) });
    const v = this.variaveis(c, conf);
    const resposta = r === 'confirmado' ? cfg.confirmacao.textoConfirmado : cfg.confirmacao.textoRemarcar;
    if (resposta.trim()) {
      try {
        // Respondida aqui: a IA não responde de novo ao "1"/"2".
        await this.o.sintonia().enviarAutomatico(c, preencher(resposta, v), AUTOR_CONFIRMACAO);
        await this.o.repo.salvarConversa(c);
      } catch (x) {
        this.log('Falha ao responder a confirmação', String(x));
      }
    }
    if (r === 'remarcar') {
      // Tag e etapa ficam para o relógio (fora da trava: marcar tag pode mover o cartão do funil).
      await this.o.armazem.programar(
        this.o.empresaId,
        { conversaId: c.id, tipo: 'confirmacao', situacao: 'remarcar_acao', passo: 0, total: 1, chave: `remarcar:${conf.agendamento}`, quando: agora, dados: { agendamento: conf.agendamento } },
        agora,
      );
      // Os lembretes que faltavam deste horário não saem.
      await this.o.armazem.cancelar(c.id, { tipo: 'confirmacao', situacoes: ['confirmacao', 'lembrete'] }, 'quer remarcar');
    }
    await this.o.repo.registrarEvento({
      tipo: 'confirmacao',
      conversaId: c.id,
      unidade: c.unidade,
      em: agora,
      dados: { status: r, agendamento: conf.agendamento, inicio: conf.inicio.toISOString(), servico: conf.servico, ...dataHora(conf.inicio) },
    });
    return true;
  }

  // ------------------------------------------------------------ relógio

  async tick(): Promise<{ enviados: number }> {
    if (this.rodando) return { enviados: 0 };
    this.rodando = true;
    let enviados = 0;
    try {
      const agora = this.agora();
      await this.o.armazem.semResposta(this.o.empresaId, new Date(agora.getTime() + HORA)).catch(() => 0);
      const lista = await this.o.armazem.reivindicar(this.o.empresaId, agora, 50, RESERVA_MS);
      for (const e of lista) {
        try {
          const r = await this.executar(e);
          if (r === 'enviado') enviados++;
        } catch (x) {
          this.log('Falha no envio do follow-up', { id: e.id, erro: String(x) });
          await this.o.armazem.concluir(e.id, 'falhou', String((x as Error)?.message ?? x).slice(0, 300), this.agora());
        }
      }
    } finally {
      this.rodando = false;
    }
    return { enviados };
  }

  private async executar(e: EnvioFollowup): Promise<string> {
    const fim = async (estado: 'enviado' | 'cancelado' | 'pulado' | 'falhou', detalhe: string | null) => {
      await this.o.armazem.concluir(e.id, estado, detalhe, this.agora());
      return estado;
    };
    const c0 = await this.o.repo.buscarConversa(e.conversaId);
    if (!c0) return fim('cancelado', 'conversa não existe');
    if (e.situacao === 'remarcar_acao') {
      await this.acaoRemarcar(c0);
      return fim('enviado', null);
    }
    const cfg = await this.config();

    // Horário da unidade.
    const agora = this.agora();
    const unidade = UNIDADES[c0.unidade];
    if (cfg.respeitarHorario && unidade && !estaAberta(unidade, agora)) {
      const abre = proximaAbertura(unidade, agora);
      if (e.tipo === 'confirmacao') {
        const inicio = new Date(String(e.dados.inicio));
        const limite = inicio.getTime() - 30 * MIN;
        if (abre && abre.getTime() <= limite) {
          await this.o.armazem.adiar(e.id, abre);
          return 'adiado';
        }
        // Não dá para esperar a loja abrir: vale a janela educada (8h–20h30), se ainda der tempo.
        const janela = ajustarParaJanelaAtiva(agora);
        if (janela.getTime() > limite) return fim('pulado', 'fora do horário');
        if (janela.getTime() > agora.getTime()) {
          await this.o.armazem.adiar(e.id, janela);
          return 'adiado';
        }
      } else {
        await this.o.armazem.adiar(e.id, abre ?? ajustarParaJanelaAtiva(new Date(agora.getTime() + MIN)));
        return 'adiado';
      }
    }

    if (e.tipo === 'confirmacao') return this.enviarConfirmacao(e, cfg, fim);
    return this.enviarCadencia(e, cfg, fim);
  }

  private async enviarCadencia(e: EnvioFollowup, cfg: ConfigFollowup, fim: (estado: 'enviado' | 'cancelado' | 'pulado' | 'falhou', detalhe: string | null) => Promise<string>): Promise<string> {
    const cad = cfg.cadencias.find((x) => x.id === e.situacao);
    const passo = cad?.passos[e.passo];
    if (!cad?.ligada || !passo) return fim('cancelado', 'cadência desligada');
    if (await this.o.armazem.pausado(e.conversaId)) return fim('cancelado', 'pausado pela equipe');
    const base = new Date(String(e.dados.base ?? e.criadoEm.toISOString()));
    const desde = new Date(this.agora().getTime() - 7 * DIA);
    if ((await this.o.armazem.contarEnviados(e.conversaId, 'cadencia', desde)) >= cfg.limiteSemana) return fim('pulado', 'limite de mensagens por cliente');

    const r = await this.o.sintonia().comConversa(e.conversaId, async (c) => {
      if (c.modo === 'humano' && cfg.pararQuandoEquipeAssume && e.situacao !== 'pos_atendimento') return { estado: 'cancelado' as const, detalhe: 'a equipe assumiu' };
      if (cad.pararSeResponder && (c.ultimaMensagemCliente?.getTime() ?? 0) > base.getTime()) {
        // A última palavra é da cliente e já passou do começo: ela respondeu.
        const ultLoja = Math.max(c.ultimaMensagemIa?.getTime() ?? 0, c.ultimaMensagemEquipe?.getTime() ?? 0);
        if (e.situacao !== 'sem_resposta' || (c.ultimaMensagemCliente?.getTime() ?? 0) > ultLoja) return { estado: 'cancelado' as const, detalhe: 'a cliente respondeu' };
      }
      if (DE_VENDA.includes(e.situacao as Situacao) && e.situacao !== 'faltou' && (c.etapa === 'agendada' || c.etapa === 'compareceu' || c.etapa === 'perdida')) return { estado: 'cancelado' as const, detalhe: 'agendou' };
      const v = this.variaveis(c, { servico: typeof e.dados.servico === 'string' ? e.dados.servico : null });
      let texto = preencher(passo.texto, v);
      if (passo.ia && passo.objetivo && this.o.agente && this.o.iaDisponivel?.()) {
        try {
          const ia = await this.o.agente.executar({
            conversa: c,
            mensagens: await this.o.repo.mensagens(c.id),
            agora: this.agora(),
            modo: 'responder',
            objetivo: `Mensagem de follow-up (${NOME_SITUACAO[e.situacao as Situacao]}), passo ${e.passo + 1} de ${e.total}. Objetivo: ${passo.objetivo} Escreva uma mensagem curta e natural para enviar agora à cliente.`,
          });
          if (ia.texto.trim()) texto = ia.texto.trim();
        } catch (x) {
          this.log('IA não escreveu o follow-up; vai o texto da cadência', String(x));
        }
      }
      if (!texto.trim()) return { estado: 'pulado' as const, detalhe: 'mensagem vazia' };
      await this.o.sintonia().enviarAutomatico(c, texto, AUTOR_FOLLOWUP);
      await this.o.repo.salvarConversa(c);
      await this.o.armazem.concluir(e.id, 'enviado', null, this.agora());
      if (passo.email && passo.emailModeloId && this.o.email) {
        const r = await this.o.email.deAutomacao({ conversa: c, modeloId: passo.emailModeloId, chave: `fu:${e.chave}`, variaveis: this.paraEmail(v) }).catch((x) => ({ ok: false as const, motivo: String(x) }));
        if (!r.ok) this.log('E-mail do follow-up não saiu', r.motivo);
      }
      return { estado: 'enviado' as const, detalhe: null, conversa: c };
    });
    if (!r) return fim('cancelado', 'conversa não existe');
    if (r.estado !== 'enviado') return fim(r.estado, r.detalhe);
    await this.o.repo.registrarEvento({ tipo: 'followup', conversaId: e.conversaId, unidade: r.conversa.unidade, em: this.agora(), dados: { situacao: e.situacao, passo: e.passo + 1, total: e.total } });
    // Próximo passo: conta a partir de agora.
    const prox = cad.passos[e.passo + 1];
    if (prox) {
      await this.o.armazem.programar(
        this.o.empresaId,
        { conversaId: e.conversaId, tipo: 'cadencia', situacao: e.situacao, passo: e.passo + 1, total: cad.passos.length, chave: e.chave.replace(/:\d+$/, `:${e.passo + 1}`), quando: new Date(this.agora().getTime() + prox.esperaHoras * HORA), dados: e.dados },
        this.agora(),
      );
    }
    return 'enviado';
  }

  private async enviarConfirmacao(e: EnvioFollowup, cfg: ConfigFollowup, fim: (estado: 'enviado' | 'cancelado' | 'pulado' | 'falhou', detalhe: string | null) => Promise<string>): Promise<string> {
    const agendamento = String(e.dados.agendamento ?? '');
    const conf = await this.o.armazem.confirmacao(this.o.empresaId, agendamento);
    if (!conf) return fim('cancelado', 'agendamento não encontrado');
    if (!cfg.confirmacao.ligada || cfg.confirmacao.unidades[conf.unidade]?.ligada === false) return fim('cancelado', 'confirmação desligada');
    if (conf.status === 'remarcar') return fim('cancelado', 'quer remarcar');
    if (conf.inicio.getTime() <= this.agora().getTime() + 15 * MIN) return fim('pulado', 'horário já chegou');
    const r = await this.o.sintonia().comConversa(e.conversaId, async (c) => {
      const v = this.variaveis(c, conf);
      const molde = e.situacao === 'confirmacao' ? cfg.confirmacao.texto : conf.status === 'confirmado' ? cfg.confirmacao.textoLembreteConfirmado : cfg.confirmacao.textoLembrete;
      await this.o.sintonia().enviarAutomatico(c, preencher(molde, v), AUTOR_CONFIRMACAO);
      await this.o.repo.salvarConversa(c);
      await this.o.armazem.concluir(e.id, 'enviado', null, this.agora());
      return { c, v };
    });
    if (!r) return fim('cancelado', 'conversa não existe');
    if (conf.status !== 'confirmado') await this.o.armazem.marcarConfirmacao(this.o.empresaId, agendamento, { perguntadoEm: this.agora(), ...(conf.status === 'sem_resposta' ? { status: 'aguardando' as StatusConfirmacao } : {}) });
    await this.o.repo.registrarEvento({ tipo: 'followup', conversaId: e.conversaId, unidade: r.c.unidade, em: this.agora(), dados: { situacao: e.situacao, agendamento, passo: e.passo + 1, total: e.total } });
    if (cfg.confirmacao.email && this.o.email) {
      const modeloId = await this.modeloConfirmacao(cfg).catch((x) => (this.log('Sem modelo de e-mail da confirmação', String(x)), null));
      if (modeloId) {
        const x = await this.o.email.deAutomacao({ conversa: r.c, modeloId, chave: `conf-email:${e.chave}`, variaveis: this.paraEmail(r.v) }).catch((y) => ({ ok: false as const, motivo: String(y) }));
        if (!x.ok) this.log('E-mail da confirmação não saiu', x.motivo);
      }
    }
    return 'enviado';
  }

  /** Modelo de e-mail da confirmação: o escolhido na tela, ou um pronto criado na primeira vez. */
  private async modeloConfirmacao(cfg: ConfigFollowup): Promise<string | null> {
    const email = this.o.email;
    if (!email) return null;
    const id = cfg.confirmacao.emailModeloId;
    if (id && (!email.modeloExiste || (await email.modeloExiste(id)))) return id;
    if (!email.salvarModelo) return null;
    const m = await email.salvarModelo(
      null,
      {
        nome: 'Confirmação de agendamento (Sintonia)',
        assunto: 'Seu horário de {servico}: {data} às {hora}',
        preheader: 'Confirme pelo WhatsApp: 1 - Confirmo / 2 - Preciso remarcar',
        conteudo: {
          blocos: [
            { tipo: 'titulo', texto: 'Seu horário está chegando ✨', tamanho: 'grande', alinhar: 'esquerda' },
            { tipo: 'texto', texto: 'Olá, {primeiro_nome}!\n\nSeu horário de **{servico}** na **{unidade}** é **{data} às {hora}**.\n\nPara confirmar, responda no WhatsApp: **1 - Confirmo** ou **2 - Preciso remarcar**.', alinhar: 'esquerda' },
            { tipo: 'texto', texto: 'Até lá! 💙\nEquipe Império Progressivas', alinhar: 'esquerda' },
          ],
        },
      },
      'Sintonia',
    );
    await this.o.armazem.gravarConfig(this.o.empresaId, { ...cfg, confirmacao: { ...cfg.confirmacao, emailModeloId: m.id } }, 'Sintonia');
    this.cache = undefined;
    return m.id;
  }

  private async acaoRemarcar(c: Conversa): Promise<void> {
    const cfg = await this.config();
    if (!this.o.tags) return;
    const nome = cfg.confirmacao.tagRemarcar;
    const tag = (await this.o.tags.porNome(nome)) ?? (await this.o.tags.criar({ nome }, 'Sintonia'));
    await this.o.tags.marcar(c, tag.id, 'Sintonia');
  }

  private variaveis(c: Conversa, conf: Partial<Pick<Confirmacao, 'servico' | 'inicio'>>): Record<string, string> {
    const dh = conf.inicio ? dataHora(conf.inicio) : { data: '', hora: '' };
    return { nome: c.nome ?? '', servico: conf.servico ?? '', unidade: UNIDADES[c.unidade]?.nome ?? '', data: dh.data, hora: dh.hora };
  }

  private paraEmail(v: Record<string, string>): Record<string, string> {
    return { servico: v.servico || 'atendimento', data: v.data ?? '', hora: v.hora ?? '' };
  }

  // ------------------------------------------------------------ telas

  /** Selo da conversa: cadência em andamento ("Follow-up 2/3 em 1 dia"), pausa e confirmação do próximo horário. */
  async seloDaConversa(conversaId: string) {
    const agora = this.agora();
    const [envios, pausado, confs] = await Promise.all([this.o.armazem.envios(conversaId), this.o.armazem.pausado(conversaId), this.o.armazem.confirmacoesDa(conversaId)]);
    const prox = envios.filter((x) => x.tipo === 'cadencia' && (x.estado === 'pendente' || x.estado === 'enviando')).sort((a, b) => a.quando.getTime() - b.quando.getTime())[0];
    const conf = confs.filter((x) => x.inicio.getTime() > agora.getTime() - 3 * HORA).sort((a, b) => a.inicio.getTime() - b.inicio.getTime())[0];
    return {
      pausado,
      cadencia: prox
        ? { situacao: prox.situacao, nome: NOME_SITUACAO[prox.situacao as Situacao] ?? prox.situacao, passo: prox.passo + 1, total: prox.total, quando: prox.quando }
        : null,
      confirmacao: conf ? { agendamento: conf.agendamento, status: conf.status, inicio: conf.inicio, servico: conf.servico } : null,
      historico: envios.slice(0, 20).map((x) => ({ situacao: x.situacao, passo: x.passo + 1, total: x.total, quando: x.quando, estado: x.estado, detalhe: x.detalhe ?? null })),
    };
  }

  async pausar(conversaId: string, por: string): Promise<void> {
    await this.o.armazem.pausar(conversaId, por, this.agora());
    await this.o.armazem.cancelar(conversaId, { tipo: 'cadencia' }, `pausado por ${por}`);
  }

  async retomar(conversaId: string): Promise<void> {
    await this.o.armazem.retomar(conversaId);
  }

  async confirmacoesEntre(inicio: Date, fim: Date): Promise<Confirmacao[]> {
    return this.o.armazem.confirmacoesEntre(this.o.empresaId, inicio, fim);
  }

  confirmacao(agendamento: string): Promise<Confirmacao | undefined> {
    return this.o.armazem.confirmacao(this.o.empresaId, agendamento);
  }

  /** Muda o status à mão (equipe confirmou por telefone, por exemplo). */
  async definirStatus(agendamento: string, status: StatusConfirmacao): Promise<boolean> {
    const c = await this.o.armazem.confirmacao(this.o.empresaId, agendamento);
    if (!c) return false;
    await this.o.armazem.marcarConfirmacao(this.o.empresaId, agendamento, { status, respondidoEm: this.agora() });
    return true;
  }
}

export { SITUACOES };
