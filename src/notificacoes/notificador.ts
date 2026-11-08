import type { Contas, Usuario } from '../auth/contas.js';
import { ehGestor, podeVer, veTudo } from '../auth/acesso.js';
import { ehEmailDemo } from '../demo/dados.js';
import type { Conversa } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { UNIDADES } from '../unidades.js';
import { MIN } from '../util/tempo.js';
import type { ArmazemNotificacoes, Cursor } from './armazem.js';
import type { CargaPush, ChavesPush, EnviadorPush } from './push.js';
import { avaliarEspera, EsquemaRegraEspera, regraDa, type RegraEspera, type RegrasEspera } from './espera.js';
import { completarPreferencias, emNaoPerturbe, esperaSilenciada, TIPOS_VISIVEIS, type Notificacao, type Preferencias, type TipoNotificacao } from './tipos.js';
import type { UnidadeId } from '../domain.js';

/**
 * Transforma o que acontece (eventos do motor, das automações e da equipe) em notificações para
 * cada pessoa que pode ver a conversa, respeitando papel, unidade, dona e as preferências de cada uma.
 * Também manda o push (Web Push) para os aparelhos inscritos.
 */
export interface OpcoesNotificador {
  armazem: ArmazemNotificacoes;
  contas: Pick<Contas, 'listarUsuarios'>;
  repo: Pick<Repositorio, 'buscarConversa' | 'mensagens' | 'listarConversas'>;
  empresaId: string;
  push?: { chaves: ChavesPush; enviador: EnviadorPush; assunto: string };
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Padrão do aviso de "cliente esperando" quando a gestão não configurou (minutos; padrão 5). */
  esperaMin?: number;
  /** A conversa está com bot ou follow-up conduzindo? (aí não há alerta de espera). */
  automacaoAtiva?: (conversaId: string) => Promise<boolean>;
}

/** Item da faixa "clientes esperando" do app. */
export interface EsperaParaTela {
  conversaId: string;
  nome: string;
  unidade: UnidadeId;
  nivel: 1 | 2;
  desde: Date;
  minutos: number;
  dona: string | null;
  repetirSeg: number;
}

/** Falhas que valem notificação (só para a administração e a direção, no máximo uma por hora de cada). */
const FALHAS: Array<{ classe: string; teste: RegExp; titulo: string; texto: string }> = [
  {
    classe: 'whatsapp',
    teste: /evolution|whatsapp|baileys|connection closed|not connected|desconectad|instance|econnrefused|graph api|meta respondeu/i,
    titulo: 'O WhatsApp parou de enviar',
    texto: 'Uma mensagem não saiu: o número pode estar desconectado. Confira em Conexões.',
  },
  {
    classe: 'ia',
    teste: /anthropic|x-api-key|api[ _-]?key|authentication_error|invalid.*key|credit balance|\b401\b/i,
    titulo: 'A chave da IA foi recusada',
    texto: 'A IA não está conseguindo responder. Confira a chave da IA em Conexões.',
  },
];
export const classificarFalha = (erro: string) => FALHAS.find((f) => f.teste.test(erro));

const formatarTel = (t: string) => {
  const d = t.replace(/^55/, '');
  return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : t;
};
const nomeDa = (c: Conversa) => c.nome || formatarTel(c.telefone);
const curto = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export class Notificador {
  private fila: Promise<void> = Promise.resolve();
  private equipeCache?: { em: number; lista: Promise<Usuario[]> };
  private ultimaEspera = 0;
  /** Conversas que acabaram de nascer: a primeira mensagem já está na notificação de "nova cliente". */
  /** Mensagens que já tocaram no aparelho de cada pessoa ("<usuario>:<mensagem>"): nunca repete. */
  private regrasCache?: { em: number; regras: Promise<RegrasEspera> };
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  /** Ouvintes de notificação nova (para avisar o app sem esperar o ciclo). */
  aoCriar?: (n: Notificacao) => void;

  constructor(private readonly o: OpcoesNotificador) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
  }

  /** Recebe um evento sem segurar quem o registrou: cada um é tratado em ordem, por trás. */
  aoEvento(e: Evento): void {
    this.fila = this.fila.then(() => this.tratar(e)).catch((x) => this.log('Falha ao notificar', String(x)));
  }

  /** Termina quando tudo o que chegou até agora foi tratado (testes e desligamento). */
  ocioso(): Promise<void> {
    return this.fila;
  }

  // ---------------------------------------------------------------- quem recebe

  private equipe(): Promise<Usuario[]> {
    const t = Date.now();
    if (!this.equipeCache || t - this.equipeCache.em > 5000) {
      // Atendentes da demonstração (nome.demo@exemplo.com) nunca recebem aviso nem tiram aviso de ninguém.
      this.equipeCache = { em: t, lista: this.o.contas.listarUsuarios(this.o.empresaId).then((l) => l.filter((u) => u.ativo && !ehEmailDemo(u.email))) };
    }
    return this.equipeCache.lista;
  }

  /** Atendentes e recepcionistas da unidade que veem a conversa; sem ninguém, a gerência; sem gerência, a direção. */
  private linhaDeFrente(us: Usuario[], c: Conversa): Usuario[] {
    const ve = us.filter((u) => podeVer(u, c));
    const frente = ve.filter((u) => !ehGestor(u));
    if (frente.length) return frente;
    const gerentes = ve.filter((u) => u.papel === 'gerente');
    return gerentes.length ? gerentes : ve.filter(veTudo);
  }
  private dona(us: Usuario[], c: Conversa): Usuario[] {
    return c.responsavelId ? us.filter((u) => u.id === c.responsavelId && podeVer(u, c)) : [];
  }
  private donaOuUnidade(us: Usuario[], c: Conversa): Usuario[] {
    const d = this.dona(us, c);
    return d.length ? d : this.linhaDeFrente(us, c);
  }
  /** Gerência da unidade, direção e administração. */
  private gestao(us: Usuario[], c: Conversa): Usuario[] {
    return us.filter((u) => ehGestor(u) && podeVer(u, c));
  }

  // ---------------------------------------------------------------- eventos

  private async tratar(e: Evento): Promise<void> {
    if (e.tipo === 'falha') return this.falha(e);
    if (!e.conversaId) return;
    const c = await this.o.repo.buscarConversa(e.conversaId);
    if (!c || c.empresaId !== this.o.empresaId) return;
    const us = await this.equipe();
    const d = e.dados ?? {};
    const nome = nomeDa(c);
    const unidade = UNIDADES[c.unidade]?.nome ?? c.unidade;

    switch (e.tipo) {
      // Cliente nova e cada mensagem não viram mais notificação: a lista de conversas (não lidas) já mostra,
      // e quem ficou sem resposta vira "clientes esperando resposta" (agrupado no sino).
      case 'conversa_nova':
      case 'mensagem_cliente':
        return;
      case 'passou_para_humano': {
        const motivo = d.motivo ? String(d.motivo) : 'a cliente precisa de alguém da equipe';
        for (const u of this.donaOuUnidade(us, c)) {
          await this.criar(u, { tipo: 'ia_equipe', titulo: `A IA passou ${nome} para a equipe`, texto: curto(`Motivo: ${motivo}`), conversaId: c.id });
        }
        return;
      }
      case 'transferencia': {
        const para = d.paraId ? String(d.paraId) : undefined;
        if (!para || (d.porId && String(d.porId) === para)) return; // assumiu ou primeira resposta: foi a própria pessoa
        const alvo = us.find((u) => u.id === para && podeVer(u, { ...c, responsavelId: para }));
        if (!alvo) return;
        const por = d.motivo === 'automacao' ? 'Uma automação' : String(d.porNome ?? 'A gerência');
        await this.criar(alvo, { tipo: 'transferida', titulo: 'Conversa passada para você', texto: `${por} passou a conversa com ${nome} (${unidade}) para você.`, conversaId: c.id });
        return;
      }
      // "A IA agendou" não vira notificação (aparece na Agenda e no Dashboard).
      case 'confirmacao': {
        // A cliente pediu para remarcar pela confirmação automática: a dona (ou a unidade) e a gerência ficam sabendo.
        if (d.status !== 'remarcar') return;
        const quando = d.data && d.hora ? `${String(d.data)} às ${String(d.hora)}` : '';
        const alvos = new Map([...this.donaOuUnidade(us, c), ...this.gestao(us, c)].map((u) => [u.id, u]));
        for (const u of alvos.values()) {
          await this.criar(u, { tipo: 'agenda_mudou', titulo: `${nome} quer remarcar`, texto: curto(`${d.servico ? String(d.servico) : 'Horário'}${quando ? ` · ${quando}` : ''} · ${unidade}`), conversaId: c.id });
        }
        return;
      }
      case 'lembrete_ligacao': {
        if (d.teste) return;
        const quando = typeof d.quando === 'string' ? new Date(d.quando) : this.agora();
        const chave = `lembrete:${c.id}:${quando.toISOString()}:${String(d.automacaoId ?? '')}`;
        for (const u of this.donaOuUnidade(us, c)) {
          if (await this.o.armazem.existeChave(u.id, chave)) continue;
          await this.criar(u, {
            tipo: 'lembrete_ligacao',
            titulo: `Ligar para ${nome}`,
            texto: curto(String(d.texto ?? 'Lembrete de ligação')),
            conversaId: c.id,
            chave,
            em: quando.getTime() > this.agora().getTime() ? quando : undefined,
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private async falha(e: Evento): Promise<void> {
    const f = classificarFalha(String(e.dados?.erro ?? ''));
    if (!f) return;
    const chave = `falha:${f.classe}`;
    const umaHora = new Date(this.agora().getTime() - 60 * MIN);
    for (const u of (await this.equipe()).filter(veTudo)) {
      if (await this.o.armazem.existeChave(u.id, chave, umaHora)) continue;
      await this.criar(u, { tipo: 'falha', titulo: f.titulo, texto: f.texto, vista: 'conexoes', chave });
    }
  }

  // ---------------------------------------------------------------- relógio

  /** A cada volta do relógio: push dos lembretes que venceram e "cliente esperando". */
  async tick(): Promise<void> {
    const agora = this.agora();
    for (const n of await this.o.armazem.reivindicarEntregas(agora)) {
      await this.entregar(n).catch((x) => this.log('Falha no push', String(x)));
      this.aoCriar?.(n);
    }
    if (agora.getTime() - this.ultimaEspera >= MIN) {
      this.ultimaEspera = agora.getTime();
      await this.esperando(agora);
    }
  }

  // ---------------------------------------------------------------- cliente esperando

  /** Regras de espera por unidade (guardadas pela gestão; cache curto). */
  regrasEspera(): Promise<RegrasEspera> {
    const t = Date.now();
    if (!this.regrasCache || t - this.regrasCache.em > 10_000) {
      this.regrasCache = {
        em: t,
        regras: this.o.armazem.config('espera-regras').then((v) => (v ? (JSON.parse(v) as RegrasEspera) : {})).catch(() => ({})),
      };
    }
    return this.regrasCache.regras;
  }
  regraDaUnidade(regras: RegrasEspera, unidade: UnidadeId): RegraEspera {
    const r = regraDa(regras, unidade);
    if (!regras[unidade] && this.o.esperaMin) return { ...r, avisoMin: this.o.esperaMin, forteMin: Math.max(r.forteMin, this.o.esperaMin + 1) };
    return r;
  }
  async salvarRegrasEspera(unidade: UnidadeId, bruto: unknown): Promise<RegraEspera> {
    const atual = await this.regrasEspera();
    const regra = EsquemaRegraEspera.parse({ ...this.regraDaUnidade(atual, unidade), ...(bruto as object) });
    const novas = { ...atual, [unidade]: regra };
    await this.o.armazem.gravarConfig('espera-regras', JSON.stringify(novas));
    this.regrasCache = { em: Date.now(), regras: Promise.resolve(novas) };
    return regra;
  }

  /** Conversas esperando além do limite (com o nível de cada uma). */
  private async esperas(agora: Date): Promise<Array<{ c: Conversa; nivel: 1 | 2; desde: Date; minutos: number; regra: RegraEspera }>> {
    const regras = await this.regrasEspera();
    const saida = [];
    for (const c of await this.o.repo.listarConversas()) {
      if (c.empresaId !== this.o.empresaId) continue;
      const regra = this.regraDaUnidade(regras, c.unidade);
      const s = avaliarEspera(c, regra, agora);
      if (!s.nivel || !s.desde) continue;
      // Bot ou follow-up conduzindo a conversa: ninguém precisa correr.
      if (this.o.automacaoAtiva && (await this.o.automacaoAtiva(c.id).catch(() => false))) continue;
      saida.push({ c, nivel: s.nivel, desde: s.desde, minutos: s.minutos, regra });
    }
    return saida;
  }

  /** Cliente sem resposta além do limite: aviso (dona ou unidade) e alerta forte (também a gestão), uma vez por nível e por mensagem. */
  private async esperando(agora: Date): Promise<void> {
    const lista = await this.esperas(agora);
    if (!lista.length) return;
    const us = await this.equipe();
    for (const { c, nivel, desde, minutos } of lista) {
      const alvos = new Map(this.donaOuUnidade(us, c).map((u) => [u.id, u]));
      if (nivel === 2) for (const u of this.gestao(us, c)) alvos.set(u.id, u);
      const base = `espera:${c.id}:${desde.getTime()}`;
      for (const u of alvos.values()) {
        // Passou dos dois limites de uma vez: só o alerta forte. Já avisada no nível: não repete.
        if (await this.o.armazem.existeChave(u.id, `${base}:${nivel}`)) continue;
        if (nivel === 1 && (await this.o.armazem.existeChave(u.id, `${base}:2`))) continue;
        const forte = nivel === 2;
        await this.criar(u, {
          tipo: 'espera',
          titulo: forte ? `Urgente: ${nomeDa(c)} espera há ${minutos} min` : `${nomeDa(c)} está esperando`,
          texto: forte ? 'Ninguém respondeu ainda. Responda agora ou passe para alguém.' : `Sem resposta há ${minutos} minutos.`,
          conversaId: c.id,
          chave: `${base}:${nivel}`,
          espera: true,
        });
      }
    }
  }

  /** Para a faixa do app: as esperas que esta pessoa vê. */
  async esperasPara(u: Usuario): Promise<EsperaParaTela[]> {
    const lista = await this.esperas(this.agora());
    return lista
      .filter(({ c }) => podeVer(u, c))
      .sort((a, b) => b.minutos - a.minutos)
      .map(({ c, nivel, desde, minutos, regra }) => ({
        conversaId: c.id,
        nome: nomeDa(c),
        unidade: c.unidade,
        nivel,
        desde,
        minutos,
        dona: c.responsavelNome ?? null,
        repetirSeg: regra.repetirSeg,
      }));
  }

  // ---------------------------------------------------------------- criar e entregar

  private async prefsDe(usuarioId: string): Promise<Preferencias> {
    return completarPreferencias(await this.o.armazem.preferencias(usuarioId));
  }

  private async criar(
    u: Usuario,
    n: { tipo: TipoNotificacao; titulo: string; texto: string; conversaId?: string; vista?: string; chave?: string; contador?: number; em?: Date; espera?: boolean },
  ): Promise<Notificacao | undefined> {
    const p = await this.prefsDe(u.id);
    if (n.tipo !== 'teste' && p.tipos[n.tipo] === false) return undefined;
    const semPush = Boolean(n.espera && (!p.espera.push || esperaSilenciada(p, this.agora())));
    const agora = this.agora();
    const futura = Boolean(n.em && n.em.getTime() > agora.getTime());
    const criada = await this.o.armazem.criar({
      usuarioId: u.id,
      tipo: n.tipo,
      titulo: n.titulo,
      texto: n.texto,
      criadaEm: futura ? n.em! : agora,
      ...(n.conversaId ? { conversaId: n.conversaId } : {}),
      ...(n.vista ? { vista: n.vista } : {}),
      ...(n.chave ? { chave: n.chave } : {}),
      ...(n.contador !== undefined ? { contador: n.contador } : {}),
      // Lembrete para depois: o relógio manda o push na hora certa.
      ...(futura ? {} : { entregueEm: agora }),
    });
    if (!futura) {
      if (!semPush) await this.entregar(criada, p, false, n.espera ? { etiqueta: `espera-${n.conversaId}`, insistente: true } : undefined).catch((x) => this.log('Falha no push', String(x)));
      this.aoCriar?.(criada);
    }
    return criada;
  }

  /** Push para os aparelhos da pessoa (se ela quer e não está no "não perturbe"). Inscrição morta (404/410) é apagada. */
  async entregar(n: Notificacao, prefs?: Preferencias, silenciosa = false, troca?: { titulo?: string; texto?: string; etiqueta?: string; insistente?: boolean }): Promise<number> {
    if (!this.o.push) return 0;
    const p = prefs ?? (await this.prefsDe(n.usuarioId));
    if (!p.push || emNaoPerturbe(p, this.agora())) return 0;
    const inscricoes = await this.o.armazem.inscricoes(n.usuarioId);
    if (!inscricoes.length) return 0;
    const chaves = await this.o.push.chaves.obter();
    const carga: CargaPush = {
      id: n.id,
      titulo: troca?.titulo ?? n.titulo,
      texto: troca?.texto ?? (n.contador > 1 ? `${n.texto} (${n.contador} mensagens)` : n.texto),
      etiqueta: troca?.etiqueta ?? (n.conversaId ? `conversa-${n.conversaId}` : `notificacao-${n.tipo}`),
      tipo: n.tipo,
      ...(troca?.insistente ? { insistente: true } : {}),
      ...(!silenciosa && p.mensagens.vibrar ? { vibrar: true } : {}),
      ...(n.conversaId ? { conversaId: n.conversaId } : {}),
      ...(n.vista ? { vista: n.vista } : {}),
      ...(silenciosa ? { silenciosa: true } : {}),
    };
    let ok = 0;
    for (const i of inscricoes) {
      try {
        await this.o.push.enviador.enviar(i, JSON.stringify(carga), { ...chaves, assunto: this.o.push.assunto }, {
          ttlSeg: n.tipo === 'falha' ? 3600 : 6 * 3600,
          urgencia: n.tipo === 'mensagem' || n.tipo === 'nova_cliente' || n.tipo === 'ia_equipe' || n.tipo === 'espera' ? 'high' : 'normal',
        });
        ok++;
        await this.o.armazem.usouInscricao(i.endpoint, this.agora());
      } catch (x) {
        const status = (x as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await this.o.armazem.removerInscricao(i.endpoint);
          this.log('Inscrição de push vencida removida', { usuario: n.usuarioId, status });
        } else this.log('Push recusado', { status, erro: String((x as Error).message ?? x).slice(0, 200) });
      }
    }
    return ok;
  }

  // ---------------------------------------------------------------- para as rotas

  async testar(u: Usuario): Promise<Notificacao | undefined> {
    return this.criar(u, { tipo: 'teste', titulo: 'Notificações ligadas', texto: 'É assim que os avisos da Sintonia vão chegar.' });
  }
  listar(usuarioId: string, limite: number, antes?: Cursor) {
    return this.o.armazem.listar(usuarioId, this.agora(), limite, antes, TIPOS_VISIVEIS);
  }
  /** Não lidas do sino: só os tipos que ainda valem, e os "clientes esperando" contam como um item só (agrupados). */
  async resumo(usuarioId: string) {
    const r = await this.o.armazem.resumo(usuarioId, this.agora(), TIPOS_VISIVEIS);
    return { naoLidas: r.naoLidas - r.esperaNaoLidas + (r.esperaNaoLidas > 0 ? 1 : 0), versao: r.versao };
  }
  async preferencias(usuarioId: string) {
    return this.prefsDe(usuarioId);
  }
}

/** Faz o repositório avisar o notificador de cada evento registrado (sem mudar quem registra). */
export function observarEventos<R extends Pick<Repositorio, 'registrarEvento'>>(repo: R, ouvinte: (e: Evento) => void): R {
  const original = repo.registrarEvento.bind(repo);
  repo.registrarEvento = async (e: Evento) => {
    await original(e);
    ouvinte(e);
  };
  return repo;
}
