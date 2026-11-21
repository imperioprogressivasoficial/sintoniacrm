import { randomUUID } from 'node:crypto';
import type { EscopoVisao } from '../auth/acesso.js';
import type { Conversa } from '../domain.js';
import { ehEtapaDePerda, type Funis, type MovimentoEtapa } from '../funis/funis.js';
import type { ArmazemPerdas, PerdaComCliente } from './armazem.js';
import {
  ConfigPerdas,
  MOTIVO_OUTRO,
  MOTIVOS_AUTOMATICOS,
  normalizarConfigPerdas,
  PerdaInformada,
  type MotivoPerda,
  type Perda,
  type ResumoPerda,
} from './tipos.js';

/** Erro com o código HTTP e, no 409 do motivo obrigatório, o que a tela precisa para perguntar. */
export class ErroPerda extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface OpcoesPerdas {
  armazem: ArmazemPerdas;
  funis: Funis;
  empresaId: string;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

interface Pendente {
  motivo: string;
  nome: string;
  detalhe: string | null;
}

/**
 * Motivo de perda: a lista da empresa, a regra "pediu o motivo antes de mover para uma etapa de perda" e o registro
 * de cada perda (pela tela ou automática). O registro vem do aviso de movimento dos funis (Funis.aoMover): vale
 * para qualquer caminho que mova o cartão; quem moveu pela tela deixa o motivo aqui antes (antesDeMover).
 */
export class Perdas {
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  /** Motivo informado pela tela, esperando o movimento (chave conversa|funil). */
  private readonly pendentes = new Map<string, Pendente>();
  private cache: { ate: number; cfg: ConfigPerdas } | null = null;

  constructor(private readonly o: OpcoesPerdas) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
    o.funis.aoMover((m) => this.aoMover(m));
  }

  get empresaId(): string {
    return this.o.empresaId;
  }

  // ---------- lista de motivos ----------

  async config(): Promise<ConfigPerdas> {
    const t = Date.now();
    if (this.cache && this.cache.ate > t) return this.cache.cfg;
    const cfg = normalizarConfigPerdas(await this.o.armazem.lerConfig(this.o.empresaId));
    this.cache = { ate: t + 10_000, cfg };
    return cfg;
  }

  /** Motivos para escolher (só os ativos). */
  async motivos(): Promise<MotivoPerda[]> {
    return (await this.config()).motivos.filter((m) => m.ativo);
  }

  async salvarConfig(bruto: unknown, por: string): Promise<ConfigPerdas> {
    const r = ConfigPerdas.safeParse(bruto);
    if (!r.success) throw new ErroPerda(r.error.issues[0]?.message ?? 'Lista de motivos inválida.', 400);
    const cfg = normalizarConfigPerdas(r.data);
    await this.o.armazem.gravarConfig(this.o.empresaId, cfg, por, this.agora());
    this.cache = null;
    return cfg;
  }

  /** Nome atual do motivo (a gestão pode ter renomeado), ou o nome gravado na hora. */
  private nomeAtual(cfg: ConfigPerdas, motivo: string, gravado: string): string {
    return cfg.motivos.find((m) => m.id === motivo)?.nome ?? MOTIVOS_AUTOMATICOS[motivo] ?? gravado;
  }

  // ---------- antes de mover pela tela ----------

  /**
   * Chamado pela rota de mover (pessoa da equipe). Se a etapa nova é de perda e o lead ainda não está nela, exige
   * o motivo: sem motivo, 409 com a lista (a tela pergunta e manda de novo). Devolve a função que limpa o motivo
   * guardado (chame depois do movimento, deu certo ou não).
   */
  async antesDeMover(c: Conversa, funilId: string, etapaId: string | null, informada: unknown): Promise<() => void> {
    const nada = () => {};
    if (!etapaId) return nada;
    const funil = await this.o.funis.exigir(funilId).catch(() => undefined);
    if (!funil) return nada;
    const etapa = (await this.o.funis.etapas(funilId)).find((e) => e.id === etapaId);
    if (!etapa || !ehEtapaDePerda(funil, etapa)) return nada;
    const atual = (await this.o.funis.daConversa(c)).find((x) => x.funilId === funilId)?.etapa?.id;
    if (atual === etapaId) return nada;
    const motivos = await this.motivos();
    const pedir = (msg: string, status = 409) =>
      new ErroPerda(msg, status, { codigo: 'motivo_perda', etapa: etapa.nome, cliente: c.nome ?? null, motivos: motivos.map((m) => ({ id: m.id, nome: m.nome, pedeTexto: m.pedeTexto })) });
    if (informada === undefined || informada === null) throw pedir(`Para mover para “${etapa.nome}”, conte o motivo da perda.`);
    const p = PerdaInformada.safeParse(informada);
    if (!p.success) throw pedir('Escolha o motivo da perda.', 400);
    const m = motivos.find((x) => x.id === p.data.motivo);
    if (!m) throw pedir('Esse motivo não está mais na lista. Escolha outro.', 400);
    const detalhe = p.data.detalhe?.trim() || null;
    if ((m.pedeTexto || m.id === MOTIVO_OUTRO) && (!detalhe || detalhe.length < 2)) throw pedir(`Em “${m.nome}”, escreva o motivo em poucas palavras.`, 400);
    const chave = `${c.id}|${funilId}`;
    this.pendentes.set(chave, { motivo: m.id, nome: m.nome, detalhe });
    if (this.pendentes.size > 2000) this.pendentes.clear();
    return () => this.pendentes.delete(chave);
  }

  // ---------- registro ----------

  private async aoMover(m: MovimentoEtapa): Promise<void> {
    if (!m.para || m.conversa.empresaId !== this.o.empresaId) return;
    const etapas = await this.o.funis.etapas(m.funil.id);
    const etapa = etapas.find((e) => e.id === m.para);
    const chave = `${m.conversa.id}|${m.funil.id}`;
    const pendente = this.pendentes.get(chave);
    this.pendentes.delete(chave);
    if (!etapa || !ehEtapaDePerda(m.funil, etapa)) return;
    const cfg = await this.config();
    const daLista = (id: string, reserva: string) => cfg.motivos.find((x) => x.id === id)?.nome ?? reserva;
    let motivo: Pendente;
    let automatico = m.automatico;
    if (pendente) motivo = pendente;
    else if (m.por.nome === 'IA') ((motivo = { motivo: 'ia', nome: MOTIVOS_AUTOMATICOS.ia!, detalhe: null }), (automatico = true));
    else if (m.por.nome === 'Sintonia') ((motivo = { motivo: 'sumiu', nome: daLista('sumiu', 'Sumiu (parou de responder)'), detalhe: 'Não respondeu aos follow-ups' }), (automatico = true));
    else if (m.automatico) motivo = { motivo: 'automacao', nome: MOTIVOS_AUTOMATICOS.automacao!, detalhe: m.por.nome ? `Automação: ${m.por.nome}`.slice(0, 300) : null };
    else motivo = { motivo: 'sem_motivo', nome: MOTIVOS_AUTOMATICOS.sem_motivo!, detalhe: null };
    const de = m.de ? etapas.find((e) => e.id === m.de) : undefined;
    const p: Perda = {
      id: randomUUID(),
      empresaId: m.conversa.empresaId,
      conversaId: m.conversa.id,
      funilId: m.funil.id,
      etapaId: etapa.id,
      deEtapaId: m.de,
      deEtapaNome: de?.nome ?? (m.de ? null : 'Fora do funil'),
      motivo: motivo.motivo,
      motivoNome: motivo.nome,
      detalhe: motivo.detalhe,
      automatico,
      atendenteId: m.conversa.responsavelId ?? null,
      atendenteNome: m.conversa.responsavelNome ?? null,
      porId: m.por.id ?? null,
      porNome: m.por.nome || 'Equipe',
      unidade: m.conversa.unidade,
      em: this.agora(),
    };
    try {
      await this.o.armazem.registrar(p);
    } catch (e) {
      this.log('Falha ao registrar a perda', String(e));
    }
  }

  // ---------- leitura ----------

  /** Motivo da perda dos cartões (só os que estão numa etapa de perda deste funil). */
  async dosCartoes(funilId: string, conversaIds: string[]): Promise<Record<string, ResumoPerda>> {
    if (!conversaIds.length) return {};
    const [mapa, cfg] = await Promise.all([this.o.armazem.ultimas(funilId, conversaIds), this.config()]);
    const r: Record<string, ResumoPerda> = {};
    for (const [id, p] of mapa) r[id] = { motivo: p.motivo, nome: this.nomeAtual(cfg, p.motivo, p.motivoNome), detalhe: p.detalhe, por: p.porNome, automatico: p.automatico, em: p.em };
    return r;
  }

  /** Perdas do período (uma por conversa e funil: a última), com o nome atual do motivo. */
  async doPeriodo(inicio: Date, fim: Date, escopo: EscopoVisao, atendente?: string): Promise<PerdaComCliente[]> {
    const [lista, cfg] = await Promise.all([this.o.armazem.listar({ inicio, fim, escopo: { ...escopo, empresaId: escopo.empresaId ?? this.o.empresaId }, atendente }), this.config()]);
    const ultima = new Map<string, PerdaComCliente>();
    for (const p of lista) ultima.set(`${p.conversaId}|${p.funilId}`, { ...p, motivoNome: this.nomeAtual(cfg, p.motivo, p.motivoNome) });
    return [...ultima.values()].sort((a, b) => a.em.getTime() - b.em.getTime());
  }
}
