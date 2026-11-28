import type { Contas, Usuario } from '../auth/contas.js';
import { ehGestor, podeVer, veTudo } from '../auth/acesso.js';
import { ehEmailDemo } from '../demo/dados.js';
import type { Conversa } from '../domain.js';
import type { Evento, Repositorio } from '../store/repositorio.js';
import { unidadeDe } from '../unidades.js';
import { MIN } from '../util/tempo.js';
import type { ArmazemNotificacoes, Cursor } from './armazem.js';
import type { CargaPush, ChavesPush, EnviadorPush } from './push.js';
import { avaliarEspera, EsquemaRegraEspera, regraDa, type PrazoEspera, type RegraEspera, type RegrasEspera } from './espera.js';
import { completarPreferencias, emNaoPerturbe, esperaSilenciada, TIPOS_VISIVEIS, type Notificacao, type Preferencias, type TipoNotificacao } from './tipos.js';
import type { UnidadeId } from '../domain.js';
import { nomeOuTelefone } from '../contatos/nome.js';

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
  /** conversa-extra: quem silenciou a conversa agora (sem push, sem vibração para essas pessoas). */
  silenciaram?: (conversaId: string, agora: Date) => Promise<Set<string>>;
  /** serena-chave: Serena pausada: conversa no modo IA com cliente esperando também avisa a equipe. */
  serenaPausada?: () => boolean;
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
  /** automacao-vendas: prazo de resposta que vale (minutos) e de onde veio (primeira resposta, etapa ou padrão). */
  prazoMin: number;
  escalaMin: number;
  prazo: string;
}

type ListaEsperas = Array<{ c: Conversa; nivel: 1 | 2; desde: Date; minutos: number; regra: RegraEspera; prazo?: PrazoEspera }>;

/** Tipos que entram na lista do sino como notificação (a espera vem da lista de verdade, não das notificações). */
const TIPOS_DA_LISTA = TIPOS_VISIVEIS.filter((t) => t !== 'espera');

/** Item "clientes esperando" do sino. */
export interface EsperaDoSino {
  conversaId: string;
  nome: string;
  unidade: UnidadeId;
  nivel: 1 | 2;
  minutos: number;
  desde: Date;
  dona: string | null;
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
// "Número sem WhatsApp" é do contato, não do sistema: não vira aviso de falha.
export const classificarFalha = (erro: string) => (/não tem WhatsApp/i.test(erro) ? undefined : FALHAS.find((f) => f.teste.test(erro)));

// contato-nome: nome de verdade, ou o telefone no padrão "+55 (71) 99220-0365".
const nomeDa = (c: Conversa) => nomeOuTelefone(c.nome, c.telefone);
const curto = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export class Notificador {
  private fila: Promise<void> = Promise.resolve();
  private equipeCache?: { em: number; lista: Promise<Usuario[]> };
  private ultimaEspera = 0;
  /** Conversas que acabaram de nascer: a primeira mensagem já está na notificação de "nova cliente". */
  /** Mensagens que já tocaram no aparelho de cada pessoa ("<usuario>:<mensagem>"): nunca repete. */
  private regrasCache?: { em: number; regras: Promise<RegrasEspera> };
  /** notificacoes2: última lista de "clientes esperando" (montada pelo relógio; o sino lê daqui sem recalcular a cada pedido). */
  private esperasCache?: { em: number; lista: Promise<ListaEsperas> };
  /** notificacoes2: quando a lista de esperas mudou pela última vez (ms): entra na "versão" do sino. */
  private versaoEsperas = 0;
  private chavesEsperas = '';
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
    // notificacoes2: alguém respondeu: o "cliente esperando" dessa conversa sai do sino de todo mundo na hora.
    if (e.tipo === 'equipe_respondeu' || e.tipo === 'ia_respondeu') {
      const us = await this.equipe();
      const agora = this.agora();
      await this.o.armazem.fecharEsperas(us.map((u) => u.id), [], agora, e.conversaId);
      this.esperasCache = undefined;
      this.versaoEsperas = agora.getTime();
      return;
    }
    if (e.tipo === 'mensagem_cliente' || e.tipo === 'transferencia') this.esperasCache = undefined;
    const c = await this.o.repo.buscarConversa(e.conversaId);
    if (!c || c.empresaId !== this.o.empresaId) return;
    const us = await this.equipe();
    const d = e.dados ?? {};
    const nome = nomeDa(c);
    const unidade = unidadeDe(c.unidade)?.nome ?? c.unidade;

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
        // automacao-vendas: lead que chegou pelo rodízio automático (quem estava "Disponível para atender").
        if (d.motivo === 'rodizio') {
          await this.criar(alvo, { tipo: 'transferida', titulo: `Lead novo para você: ${nome}`, texto: `${nome} (${unidade}) chegou pelo rodízio automático. Responda logo!`, conversaId: c.id });
          return;
        }
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
      case 'nps': {
        // Nota baixa (0 a 6) na pesquisa de satisfação: a gestão fica sabendo para agir rápido.
        const nota = typeof d.nota === 'number' ? d.nota : NaN;
        if (!(nota >= 0 && nota <= 6)) return;
        const atendente = d.atendenteNome ? ` · atendimento de ${String(d.atendenteNome)}` : '';
        for (const u of this.gestao(us, c)) {
          await this.criar(u, { tipo: 'nps_baixa', titulo: `Nota ${nota} de ${nome}`, texto: curto(`Pesquisa de satisfação${atendente} · ${unidade}`), conversaId: c.id });
        }
        return;
      }
      case 'radar': {
        // Radar (src/radar): avisa quem colocou a conversa no radar; sem dona do radar (ou ela não vê mais), a dona da conversa ou a unidade.
        if (d.acao !== 'disparou') return;
        const dono = d.donoId ? us.filter((u) => u.id === String(d.donoId) && podeVer(u, c)) : [];
        const alvos = dono.length ? dono : this.donaOuUnidade(us, c);
        const resolvido = d.origem === 'resolvido';
        const texto = `${String(d.motivo ?? '')}${d.iaResponde ? ' A IA vai responder.' : ''}`.trim() || `Vigiando: ${String(d.vigiar ?? '')}`;
        for (const u of alvos) {
          await this.criar(u, { tipo: 'radar', titulo: resolvido ? `Radar: ${nome} — não precisa mais vigiar` : `Radar: aconteceu com ${nome}`, texto: curto(texto), conversaId: c.id });
        }
        return;
      }
      case 'lead_parado': {
        // funil-atendimento: lead em "Novo lead" sem resposta da loja há N min: a dona (ou a unidade) e a gerência.
        const chave = `parado:${c.id}:${String(d.desde ?? '')}`;
        const minutos = typeof d.minutos === 'number' ? d.minutos : null;
        const alvos = new Map([...this.donaOuUnidade(us, c), ...this.gestao(us, c)].map((u) => [u.id, u]));
        for (const u of alvos.values()) {
          if (await this.o.armazem.existeChave(u.id, chave)) continue;
          await this.criar(u, { tipo: 'lead_parado', titulo: `${nome} está esperando em Novo lead`, texto: curto(`Sem resposta${minutos !== null ? ` há ${minutos} min` : ''} · ${unidade}. Responda para o lead não esfriar.`), conversaId: c.id, chave });
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
      // notificacoes2: de novo depois de uma hora: o mesmo aviso sobe com "2×", "3×"… (não cria outro igual).
      await this.criar(u, { tipo: 'falha', titulo: f.titulo, texto: f.texto, vista: 'conexoes', agrupar: chave });
    }
  }

  /**
   * Aviso de sistema para a gestão (administração, direção e gerência): sino + push, tipo "falha".
   * A chave garante que o mesmo aviso sai uma vez só para cada pessoa (ex.: uma queda do WhatsApp).
   */
  async avisarGestao(a: { titulo: string; texto: string; chave: string; vista?: string; tipo?: TipoNotificacao; agrupar?: boolean }): Promise<number> {
    let n = 0;
    for (const u of (await this.equipe()).filter((x) => ehGestor(x))) {
      if (!a.agrupar && (await this.o.armazem.existeChave(u.id, a.chave))) continue;
      if (await this.criar(u, { tipo: a.tipo ?? 'falha', titulo: a.titulo, texto: a.texto, ...(a.agrupar ? { agrupar: a.chave } : { chave: a.chave }), ...(a.vista ? { vista: a.vista } : {}) })) n++;
    }
    return n;
  }

  /**
   * serena-chave: aviso para a equipe toda (sino + push, tipo "ia_equipe"): "Fulana pausou a Serena até 15h".
   * A chave garante um aviso só por pessoa. notificacoes2: com `agrupar`, a mesma chave atualiza o aviso que já existe
   * (pausou/ligou a Serena vira um item só, com o estado mais novo e quantas vezes mudou).
   */
  async avisarEquipe(a: { titulo: string; texto: string; chave: string; vista?: string; agrupar?: boolean }): Promise<number> {
    let n = 0;
    for (const u of await this.equipe()) {
      if (!a.agrupar && (await this.o.armazem.existeChave(u.id, a.chave))) continue;
      if (await this.criar(u, { tipo: 'ia_equipe', titulo: a.titulo, texto: a.texto, ...(a.agrupar ? { agrupar: a.chave } : { chave: a.chave }), ...(a.vista ? { vista: a.vista } : {}) })) n++;
    }
    return n;
  }

  /** msg-agendada: aviso direto para uma pessoa (ex.: a mensagem que ela agendou não saiu). Sino + push, tipo "falha". */
  /** atendimento-extra: `tipo` e `vista` opcionais (ex.: "reuniao" abrindo a Agenda). */
  async avisarPessoa(usuarioId: string, a: { titulo: string; texto: string; conversaId?: string; chave?: string; vista?: string; tipo?: TipoNotificacao }): Promise<boolean> {
    const u = (await this.equipe()).find((x) => x.id === usuarioId);
    if (!u) return false;
    if (a.chave && (await this.o.armazem.existeChave(u.id, a.chave))) return false;
    return Boolean(await this.criar(u, { tipo: a.tipo ?? 'falha', titulo: a.titulo, texto: a.texto, ...(a.conversaId ? { conversaId: a.conversaId } : {}), ...(a.vista ? { vista: a.vista } : {}), ...(a.chave ? { chave: a.chave } : {}) }));
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
  private async esperas(agora: Date): Promise<ListaEsperas> {
    const regras = await this.regrasEspera();
    const saida = [];
    for (const c of await this.o.repo.listarConversas()) {
      if (c.empresaId !== this.o.empresaId) continue;
      const regra = this.regraDaUnidade(regras, c.unidade);
      // serena-chave: com a Serena pausada, quem está no modo IA também está esperando a equipe.
      const s = avaliarEspera(c.modo === 'ia' && this.o.serenaPausada?.() ? { ...c, modo: 'copiloto' } : c, regra, agora);
      if (!s.nivel || !s.desde) continue;
      // Bot ou follow-up conduzindo a conversa: ninguém precisa correr.
      if (this.o.automacaoAtiva && (await this.o.automacaoAtiva(c.id).catch(() => false))) continue;
      saida.push({ c, nivel: s.nivel, desde: s.desde, minutos: s.minutos, regra, prazo: s.prazo });
    }
    return saida;
  }

  /** Cliente sem resposta além do limite: aviso (dona ou unidade) e alerta forte (também a gestão), uma vez por nível e por mensagem. */
  private async esperando(agora: Date): Promise<void> {
    const pronta = this.esperas(agora);
    this.esperasCache = { em: agora.getTime(), lista: pronta };
    const lista = await pronta;
    const us = await this.equipe();
    // notificacoes2: alguém respondeu (ou a conversa parou de esperar): o aviso sai do sino de todo mundo.
    const ativas = lista.map(({ c, desde }) => `espera:${c.id}:${desde.getTime()}`);
    const fechadas = await this.o.armazem.fecharEsperas(us.map((u) => u.id), ativas, agora);
    const chaves = ativas.sort().join('|');
    if (fechadas || chaves !== this.chavesEsperas) {
      this.chavesEsperas = chaves;
      this.versaoEsperas = agora.getTime();
    }
    if (!lista.length) return;
    for (const { c, nivel, desde, minutos, prazo } of lista) {
      const alvos = new Map(this.donaOuUnidade(us, c).map((u) => [u.id, u]));
      if (nivel === 2) for (const u of this.gestao(us, c)) alvos.set(u.id, u);
      const base = `espera:${c.id}:${desde.getTime()}`;
      for (const u of alvos.values()) {
        // Passou dos dois limites de uma vez: só o alerta forte. Já avisada no nível: não repete.
        if (await this.o.armazem.existeChave(u.id, `${base}:${nivel}`)) continue;
        if (nivel === 1 && (await this.o.armazem.existeChave(u.id, `${base}:2`))) continue;
        const forte = nivel === 2;
        // automacao-vendas: com prazo próprio (primeira resposta ou da etapa), o aviso diz qual prazo estourou.
        const qual = prazo?.rotulo ? ` (prazo da ${prazo.rotulo}: ${prazo.avisoMin} min)` : '';
        await this.criar(u, {
          tipo: 'espera',
          titulo: forte ? `Urgente: ${nomeDa(c)} espera há ${minutos} min` : prazo?.rotulo ? `Prazo estourou: ${nomeDa(c)}` : `${nomeDa(c)} está esperando`,
          texto: forte ? `Ninguém respondeu ainda${qual}. Responda agora ou passe para alguém.` : `Sem resposta há ${minutos} minutos${qual}.`,
          conversaId: c.id,
          chave: `${base}:${nivel}`,
          espera: true,
        });
      }
    }
  }

  /** A lista de esperas do último minuto (refaz se ficou velha: o relógio não rodou ou é a primeira vez). */
  private esperasRecentes(): Promise<ListaEsperas> {
    const agora = this.agora();
    if (!this.esperasCache || agora.getTime() - this.esperasCache.em > 90_000 || agora.getTime() < this.esperasCache.em) {
      this.esperasCache = { em: agora.getTime(), lista: this.esperas(agora) };
    }
    return this.esperasCache.lista;
  }

  /**
   * notificacoes2: "clientes esperando" do sino desta pessoa, montado da lista de verdade (não das últimas notificações):
   * as mesmas regras de quem recebe o aviso (dona ou a unidade; no alerta forte, também a gestão), se ela quer esse aviso.
   */
  async esperasDoSino(u: Usuario): Promise<EsperaDoSino[]> {
    const p = await this.prefsDe(u.id);
    if (p.tipos.espera === false) return [];
    const lista = await this.esperasRecentes().catch(() => [] as ListaEsperas);
    if (!lista.length) return [];
    const us = await this.equipe();
    return lista
      .filter(({ c, nivel }) => this.donaOuUnidade(us, c).some((x) => x.id === u.id) || (nivel === 2 && this.gestao(us, c).some((x) => x.id === u.id)))
      .sort((a, b) => b.minutos - a.minutos)
      .map(({ c, nivel, desde, minutos }) => ({ conversaId: c.id, nome: nomeDa(c), unidade: c.unidade, nivel, minutos, desde, dona: c.responsavelNome ?? null }));
  }

  /** Para a faixa do app: as esperas que esta pessoa vê. */
  async esperasPara(u: Usuario): Promise<EsperaParaTela[]> {
    const lista = await this.esperas(this.agora());
    return lista
      .filter(({ c }) => podeVer(u, c))
      .sort((a, b) => b.minutos - a.minutos)
      .map(({ c, nivel, desde, minutos, regra, prazo }) => ({
        conversaId: c.id,
        nome: nomeDa(c),
        unidade: c.unidade,
        nivel,
        desde,
        minutos,
        dona: c.responsavelNome ?? null,
        repetirSeg: regra.repetirSeg,
        prazoMin: prazo?.avisoMin ?? regra.avisoMin,
        escalaMin: prazo?.forteMin ?? regra.forteMin,
        prazo: prazo?.rotulo ?? '',
      }));
  }

  // ---------------------------------------------------------------- criar e entregar

  private async prefsDe(usuarioId: string): Promise<Preferencias> {
    return completarPreferencias(await this.o.armazem.preferencias(usuarioId));
  }

  private async criar(
    u: Usuario,
    n: { tipo: TipoNotificacao; titulo: string; texto: string; conversaId?: string; vista?: string; chave?: string; contador?: number; em?: Date; espera?: boolean; agrupar?: string },
  ): Promise<Notificacao | undefined> {
    const p = await this.prefsDe(u.id);
    if (n.tipo !== 'teste' && p.tipos[n.tipo] === false) return undefined;
    const semPush = Boolean(n.espera && (!p.espera.push || esperaSilenciada(p, this.agora())));
    const agora = this.agora();
    // notificacoes2: aviso que se repete (mesma chave) vira um item só: contador + 1, data nova, não lido de novo.
    if (n.agrupar) {
      const antes = await this.o.armazem.porChave(u.id, n.agrupar);
      const etiqueta = `grupo-${n.agrupar}`;
      if (antes) {
        const nova = await this.o.armazem.repetir(antes.id, { titulo: n.titulo, texto: n.texto, em: agora });
        if (!nova) return undefined;
        await this.entregar(nova, p, false, { texto: nova.texto, etiqueta }).catch((x) => this.log('Falha no push', String(x)));
        this.aoCriar?.(nova);
        return nova;
      }
      const criada = await this.o.armazem.criar({ usuarioId: u.id, tipo: n.tipo, titulo: n.titulo, texto: n.texto, criadaEm: agora, chave: n.agrupar, entregueEm: agora, ...(n.conversaId ? { conversaId: n.conversaId } : {}), ...(n.vista ? { vista: n.vista } : {}) });
      await this.entregar(criada, p, false, { etiqueta }).catch((x) => this.log('Falha no push', String(x)));
      this.aoCriar?.(criada);
      return criada;
    }
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
    // conversa-extra: conversa silenciada por esta pessoa = nada de push dela (o aviso continua no sino).
    // Lembrete de ligação foi a própria pessoa que pediu: esse continua tocando.
    if (n.conversaId && n.tipo !== 'lembrete_ligacao' && this.o.silenciaram) {
      const quem = await this.o.silenciaram(n.conversaId, this.agora()).catch(() => new Set<string>());
      if (quem.has(n.usuarioId)) return 0;
    }
    const inscricoes = await this.o.armazem.inscricoes(n.usuarioId);
    if (!inscricoes.length) return 0;
    const chaves = await this.o.push.chaves.obter();
    const carga: CargaPush = {
      id: n.id,
      titulo: troca?.titulo ?? n.titulo,
      texto: troca?.texto ?? (n.contador > 1 && (n.tipo === 'mensagem' || n.tipo === 'nova_cliente') ? `${n.texto} (${n.contador} mensagens)` : n.texto),
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
  /**
   * Lista do sino: só os tipos que ainda valem. notificacoes2: sem os avisos de espera (o item "clientes esperando"
   * vem de esperasDoSino) e sem os avisos que repetem um problema fixo no topo (`excluirChaves`).
   */
  listar(usuarioId: string, limite: number, antes?: Cursor, excluirChaves?: readonly string[]) {
    return this.o.armazem.listar(usuarioId, this.agora(), limite, antes, TIPOS_DA_LISTA, excluirChaves);
  }
  /**
   * notificacoes2 (modelo "Precisa de você"): o número do sino é o que está em "Precisa de você": cada cliente esperando,
   * cada problema fixo (uma vez) e cada aviso não lido que pede ação. `novas` = não lidas "para saber" (não entram no número).
   */
  async resumo(u: Usuario, extra: { problemas?: number; excluirChaves?: readonly string[] } = {}) {
    const agora = this.agora();
    const [r, acoes, esperas] = await Promise.all([
      this.o.armazem.resumo(u.id, agora, TIPOS_DA_LISTA, extra.excluirChaves),
      this.o.armazem.contarAcoes(u.id, agora, extra.excluirChaves),
      this.esperasDoSino(u),
    ]);
    return { naoLidas: esperas.length + (extra.problemas ?? 0) + acoes, novas: Math.max(0, r.naoLidas - acoes), versao: Math.max(r.versao, this.versaoEsperas), esperando: esperas.length };
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
