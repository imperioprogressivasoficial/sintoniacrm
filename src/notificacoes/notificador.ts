import type { Contas, Usuario } from '../auth/contas.js';
import { ehGestor, podeVer, veTudo } from '../auth/acesso.js';
import { descrever } from '../app/atualizacoes.js';
import { ehEmailDemo } from '../demo/dados.js';
import type { Conversa } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { UNIDADES } from '../unidades.js';
import { DIA, MIN } from '../util/tempo.js';
import type { ArmazemNotificacoes, Cursor } from './armazem.js';
import type { CargaPush, ChavesPush, EnviadorPush } from './push.js';
import { completarPreferencias, emNaoPerturbe, type Notificacao, type Preferencias, type TipoNotificacao } from './tipos.js';

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
  /** Depois de quantos minutos sem resposta a cliente conta como "esperando" (padrão 10). */
  esperaMin?: number;
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

/** Tipos de notificação que juntam as mensagens da cliente enquanto não lidas. */
const AGRUPA = ['mensagem', 'nova_cliente'];

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
  private readonly recemNovas = new Set<string>();
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
      case 'conversa_nova': {
        const previa = await this.previa(c);
        this.recemNovas.add(c.id);
        for (const u of this.donaOuUnidade(us, c)) {
          await this.criar(u, { tipo: 'nova_cliente', titulo: `Nova cliente: ${nome}`, texto: previa ? `${unidade} · ${previa}` : unidade, conversaId: c.id, contador: 0 });
        }
        return;
      }
      case 'mensagem_cliente': {
        const previa = (await this.previa(c)) || 'Nova mensagem';
        const primeira = this.recemNovas.delete(c.id);
        const dona = this.dona(us, c);
        // Com dona, só ela. Sem dona, a unidade, quando a IA não responde sozinha (copiloto ou "Só eu").
        const alvos = dona.length ? dona : c.modo === 'ia' ? [] : this.linhaDeFrente(us, c);
        const ids = new Set(alvos.map((u) => u.id));
        // A notificação de "nova cliente" ainda não lida sempre recebe a mensagem (mesmo com a IA respondendo).
        for (const u of us) {
          if (ids.has(u.id)) continue;
          const g = await this.o.armazem.grupoAberto(u.id, c.id, ['nova_cliente']);
          if (g && podeVer(u, c)) await this.somar(u, g, `${unidade} · ${previa}`);
        }
        for (const u of alvos) {
          const g = await this.o.armazem.grupoAberto(u.id, c.id, AGRUPA);
          if (g) await this.somar(u, g, g.tipo === 'nova_cliente' ? `${unidade} · ${previa}` : previa);
          else if (!primeira) await this.criar(u, { tipo: 'mensagem', titulo: nome, texto: previa, conversaId: c.id });
        }
        return;
      }
      case 'passou_para_humano': {
        const motivo = d.motivo ? String(d.motivo) : 'a cliente precisa de alguém da equipe';
        for (const u of this.donaOuUnidade(us, c)) {
          await this.criar(u, { tipo: 'ia_equipe', titulo: `A IA passou ${nome} para a equipe`, texto: curto(`Motivo: ${motivo}`), conversaId: c.id });
        }
        return;
      }
      case 'ia_assumiu': {
        for (const u of this.dona(us, c)) {
          await this.criar(u, { tipo: 'espera', titulo: `A IA assumiu a conversa com ${nome}`, texto: 'Ninguém respondeu a tempo e a IA respondeu por você.', conversaId: c.id });
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
      case 'agendamento_ia':
      case 'agendamento_equipe': {
        const a = descrever(e, c);
        const quem = d.atendenteId ? String(d.atendenteId) : undefined;
        const alvos = new Map([...this.dona(us, c), ...this.gestao(us, c)].map((u) => [u.id, u]));
        for (const u of alvos.values()) {
          if (u.id === quem) continue; // quem agendou já sabe
          await this.criar(u, { tipo: 'agendamento', titulo: a?.titulo ?? 'Novo agendamento', texto: `${nome} · ${a?.detalhe || unidade}`, conversaId: c.id });
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

  /** Texto da última mensagem da cliente (prévia). */
  private async previa(c: Conversa): Promise<string> {
    const ms = await this.o.repo.mensagens(c.id, 6);
    const m = [...ms].reverse().find((x) => x.autor === 'cliente');
    return m ? curto(m.texto.replace(/\s+/g, ' ').trim()) : '';
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

  /** Cliente sem resposta há X minutos (IA desligada para ela, ou IA fora do ar): avisa a dona ou a unidade, uma vez por mensagem. */
  private async esperando(agora: Date): Promise<void> {
    const limite = (this.o.esperaMin ?? 10) * MIN;
    const conversas = await this.o.repo.listarConversas();
    let us: Usuario[] | undefined;
    for (const c of conversas) {
      if (c.empresaId !== this.o.empresaId || c.modo === 'ia') continue;
      const cl = c.ultimaMensagemCliente?.getTime() ?? 0;
      const resp = Math.max(c.ultimaMensagemEquipe?.getTime() ?? 0, c.ultimaMensagemIa?.getTime() ?? 0);
      const espera = agora.getTime() - cl;
      if (!cl || resp >= cl || espera < limite || espera > DIA) continue;
      us ??= await this.equipe();
      const chave = `espera:${c.id}:${cl}`;
      const min = Math.floor(espera / MIN);
      for (const u of this.donaOuUnidade(us, c)) {
        if (await this.o.armazem.existeChave(u.id, chave)) continue;
        await this.criar(u, { tipo: 'espera', titulo: `${nomeDa(c)} está esperando`, texto: `Sem resposta há ${min} minutos.`, conversaId: c.id, chave });
      }
    }
  }

  // ---------------------------------------------------------------- criar e entregar

  private async prefsDe(usuarioId: string): Promise<Preferencias> {
    return completarPreferencias(await this.o.armazem.preferencias(usuarioId));
  }

  private async criar(
    u: Usuario,
    n: { tipo: TipoNotificacao; titulo: string; texto: string; conversaId?: string; vista?: string; chave?: string; contador?: number; em?: Date },
  ): Promise<Notificacao | undefined> {
    const p = await this.prefsDe(u.id);
    if (n.tipo !== 'teste' && p.tipos[n.tipo] === false) return undefined;
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
      await this.entregar(criada, p).catch((x) => this.log('Falha no push', String(x)));
      this.aoCriar?.(criada);
    }
    return criada;
  }

  /** Mais uma mensagem na mesma notificação. O aparelho é atualizado em silêncio, no máximo uma vez por minuto. */
  private async somar(u: Usuario, g: Notificacao, texto: string): Promise<void> {
    const agora = this.agora();
    const n = await this.o.armazem.somar(g.id, { texto, em: agora, somar: 1 });
    if (!n) return;
    if (!g.entregueEm || agora.getTime() - g.entregueEm.getTime() >= MIN) {
      await this.o.armazem.marcarEntregue(n.id, agora);
      await this.entregar(n, undefined, true).catch((x) => this.log('Falha no push', String(x)));
    }
    void u;
  }

  /** Push para os aparelhos da pessoa (se ela quer e não está no "não perturbe"). Inscrição morta (404/410) é apagada. */
  async entregar(n: Notificacao, prefs?: Preferencias, silenciosa = false): Promise<number> {
    if (!this.o.push) return 0;
    const p = prefs ?? (await this.prefsDe(n.usuarioId));
    if (!p.push || emNaoPerturbe(p, this.agora())) return 0;
    const inscricoes = await this.o.armazem.inscricoes(n.usuarioId);
    if (!inscricoes.length) return 0;
    const chaves = await this.o.push.chaves.obter();
    const carga: CargaPush = {
      id: n.id,
      titulo: n.titulo,
      texto: n.contador > 1 ? `${n.texto} (${n.contador} mensagens)` : n.texto,
      etiqueta: n.conversaId ? `conversa-${n.conversaId}` : `notificacao-${n.tipo}`,
      ...(n.conversaId ? { conversaId: n.conversaId } : {}),
      ...(n.vista ? { vista: n.vista } : {}),
      ...(silenciosa ? { silenciosa: true } : {}),
    };
    let ok = 0;
    for (const i of inscricoes) {
      try {
        await this.o.push.enviador.enviar(i, JSON.stringify(carga), { ...chaves, assunto: this.o.push.assunto }, {
          ttlSeg: n.tipo === 'falha' ? 3600 : 6 * 3600,
          urgencia: n.tipo === 'mensagem' || n.tipo === 'nova_cliente' || n.tipo === 'ia_equipe' ? 'high' : 'normal',
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
    return this.o.armazem.listar(usuarioId, this.agora(), limite, antes);
  }
  resumo(usuarioId: string) {
    return this.o.armazem.resumo(usuarioId, this.agora());
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
