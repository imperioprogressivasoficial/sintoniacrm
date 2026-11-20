import type pg from 'pg';
import { eventoEvolution } from './evolution.js';
import { PREFIXO_INSTANCIA, type InfoInstancia } from './evolution-admin.js';

/**
 * Saúde do WhatsApp pela API não oficial (Evolution v2 + Baileys), canal por canal.
 *
 * Fontes: o webhook CONNECTION_UPDATE (na hora) e uma verificação periódica na Evolution (pega quedas sem webhook).
 * O que faz: marca cada canal como conectado/desconectado, tenta reconectar sozinho quando a sessão ainda vale
 * (GET /instance/connect sem número, com limite de tentativas e espera crescente) e avisa a gestão (sino + push)
 * uma vez por queda — e quando volta. Se o servidor da Evolution não responde, avisa uma vez por queda.
 * A lista completa de erros e do que acontece em cada um está em docs/WHATSAPP-NAO-OFICIAL.md.
 */

/**
 * - conectado: tudo certo.
 * - conectando: a Evolution está religando sozinha (ou a pessoa está lendo o QR Code: `pareando`).
 * - desconectado: caiu e precisa de atenção (ou a Sintonia está tentando reconectar).
 * - desligado: a pessoa desconectou de propósito em Conexões (sem aviso).
 * - nunca: canal criado que ainda não conectou nenhuma vez (sem aviso).
 */
export type EstadoSaude = 'conectado' | 'conectando' | 'desconectado' | 'desligado' | 'nunca';

export interface SaudeCanal {
  canalId: string;
  estado: EstadoSaude;
  desde: Date;
  motivo?: string;
  codigo?: number;
  /** Só a pessoa resolve: o aparelho saiu (logout) ou o WhatsApp pede QR Code/código de novo. */
  precisaParear: boolean;
  /** Já conectou alguma vez (só canal que já funcionou gera aviso de queda). */
  jaConectou: boolean;
  /** A pessoa está lendo o QR Code / digitando o código agora (falhas do pareamento não são queda). */
  pareando?: boolean;
  ultimaMensagemEm?: Date;
  ultimaVerificacaoEm?: Date;
  tentativas: number;
  proximaTentativaEm?: Date;
  /** Já avisou a gestão sobre esta queda. */
  avisado: boolean;
}

export interface SaudeServidor {
  ok: boolean;
  desde: Date;
  /** Verificações seguidas sem resposta. */
  falhas: number;
  avisado: boolean;
  erro?: string;
  ultimaVerificacaoEm?: Date;
}

/** O que a saúde precisa da Evolution (EvolutionAdmin). */
export interface AdminSaude {
  listar(): Promise<InfoInstancia[]>;
  reconectar(nome: string): Promise<{ estado: 'conectada' | 'precisa_parear' | 'conectando' | 'inexistente' }>;
  /** Acrescenta CONNECTION_UPDATE ao webhook de instâncias antigas. */
  atualizarEventos?(nome: string): Promise<boolean>;
}

export interface AvisoSaude {
  titulo: string;
  texto: string;
  /** Chave única: o mesmo aviso nunca sai duas vezes. */
  chave: string;
  /** Tela que abre ao tocar (ex.: "conexoes#nao-oficial"). */
  vista: string;
}

export interface ArmazemSaude {
  carregar(): Promise<Array<{ chave: string; dados: Record<string, unknown> }>>;
  gravar(chave: string, dados: Record<string, unknown>): Promise<void>;
  apagar(chave: string): Promise<void>;
}

export interface OpcoesSaude {
  armazem: ArmazemSaude;
  /** Evolution em vigor (undefined = sem endereço ou chave: nada a verificar). */
  admin: () => AdminSaude | undefined;
  /** Canais salvos em Conexões (instâncias "sintonia-…"), com o nome que a pessoa deu. */
  canais: () => Array<{ canalId: string; nome: string }>;
  /** Avisa a gestão (admin, direção e gerência): sino + push. */
  avisar: (a: AvisoSaude) => Promise<unknown>;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Tentativas de reconexão automática por queda (padrão 5). */
  maxTentativas?: number;
  /** Espera antes da 2ª tentativa; dobra a cada uma (padrão 1 min: 1, 2, 4, 8 min). */
  esperaBaseMs?: number;
  /** Verificações seguidas sem resposta para declarar o servidor fora (padrão 2). */
  falhasParaQueda?: number;
  /** "Conectando" por mais que isso, num canal que já funcionou, vira queda (padrão 5 min). */
  limiteConectandoMs?: number;
  /** Espera depois de pedir a reconexão, antes de conferir (padrão 4 s). */
  esperar?: (ms: number) => Promise<void>;
}

/** Códigos de desconexão do WhatsApp (Baileys/Boom) que a Evolution não religa sozinha: só um novo pareamento resolve. */
export const CODIGOS_SEM_VOLTA = [401, 402, 403, 406];

/** Explicação simples de cada código de desconexão (statusReason / disconnectionReasonCode). */
export function motivoDoCodigo(codigo: number | undefined): string {
  switch (codigo) {
    case 401:
      return 'O aparelho foi desconectado no celular (Aparelhos conectados) ou a sessão venceu';
    case 403:
      return 'O WhatsApp bloqueou o acesso deste número';
    case 402:
    case 406:
      return 'O WhatsApp encerrou a sessão deste número';
    case 408:
      return 'A conexão com o WhatsApp caiu (tempo esgotado)';
    case 428:
      return 'A conexão com o WhatsApp foi fechada';
    case 440:
      return 'O WhatsApp foi aberto em outro lugar com este número';
    case 500:
      return 'A sessão do WhatsApp ficou com defeito';
    case 515:
      return 'O WhatsApp pediu para reiniciar a conexão';
    default:
      return 'A conexão com o WhatsApp caiu';
  }
}

const CHAVE_SERVIDOR = '__servidor__';
const MIN = 60_000;

const dataOu = (v: unknown): Date | undefined => {
  if (typeof v !== 'string' && !(v instanceof Date)) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export class SaudeWhatsApp {
  private readonly canaisSaude = new Map<string, SaudeCanal>();
  private servidor: SaudeServidor;
  private readonly agora: () => Date;
  private readonly log: (msg: string, extra?: unknown) => void;
  private readonly esperar: (ms: number) => Promise<void>;
  private verificando: Promise<void> | null = null;
  private relogio?: ReturnType<typeof setInterval>;
  private primeira?: ReturnType<typeof setTimeout>;
  /** Última gravação da "última mensagem" de cada canal (grava no máximo 1 vez por minuto). */
  private readonly gravadoMsgEm = new Map<string, number>();
  private fila: Promise<unknown> = Promise.resolve();
  /** Canais cujo webhook já foi conferido nesta execução (assina CONNECTION_UPDATE). */
  private readonly eventosConferidos = new Set<string>();

  constructor(private readonly o: OpcoesSaude) {
    this.agora = o.agora ?? (() => new Date());
    this.log = o.log ?? (() => {});
    this.esperar = o.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms).unref?.()));
    this.servidor = { ok: true, desde: this.agora(), falhas: 0, avisado: false };
  }

  private get maxTentativas() {
    return this.o.maxTentativas ?? 5;
  }

  // ---------------------------------------------------------------- guardar

  async carregar(): Promise<void> {
    const linhas = await this.o.armazem.carregar().catch((e) => {
      this.log('Falha ao ler a saúde do WhatsApp', String(e));
      return [];
    });
    for (const { chave, dados } of linhas) {
      if (chave === CHAVE_SERVIDOR) {
        this.servidor = {
          ok: dados.ok !== false,
          desde: dataOu(dados.desde) ?? this.agora(),
          falhas: Number(dados.falhas) || 0,
          avisado: dados.avisado === true,
          ...(typeof dados.erro === 'string' ? { erro: dados.erro } : {}),
        };
        continue;
      }
      const estado = String(dados.estado ?? 'nunca') as EstadoSaude;
      this.canaisSaude.set(chave, {
        canalId: chave,
        estado: ['conectado', 'conectando', 'desconectado', 'desligado', 'nunca'].includes(estado) ? estado : 'nunca',
        desde: dataOu(dados.desde) ?? this.agora(),
        ...(typeof dados.motivo === 'string' ? { motivo: dados.motivo } : {}),
        ...(typeof dados.codigo === 'number' ? { codigo: dados.codigo } : {}),
        precisaParear: dados.precisaParear === true,
        jaConectou: dados.jaConectou === true,
        pareando: dados.pareando === true,
        ultimaMensagemEm: dataOu(dados.ultimaMensagemEm),
        tentativas: Number(dados.tentativas) || 0,
        proximaTentativaEm: dataOu(dados.proximaTentativaEm),
        avisado: dados.avisado === true,
      });
    }
  }

  private gravar(s: SaudeCanal | 'servidor'): void {
    const [chave, dados] = s === 'servidor' ? [CHAVE_SERVIDOR, { ...this.servidor }] : [s.canalId, { ...s }];
    // Em ordem, sem segurar quem chamou (o webhook responde na hora).
    this.fila = this.fila
      .then(() => this.o.armazem.gravar(chave, dados as unknown as Record<string, unknown>))
      .catch((e) => this.log('Falha ao gravar a saúde do WhatsApp', String(e)));
  }

  /** Termina quando tudo o que foi pedido até agora foi gravado (testes e desligamento). */
  ocioso(): Promise<unknown> {
    return Promise.all([this.fila, this.verificando]);
  }

  private nomeDe(canalId: string): string {
    return this.o.canais().find((c) => c.canalId === canalId)?.nome ?? canalId.replace(PREFIXO_INSTANCIA, '');
  }

  private daSintonia(canalId: string): boolean {
    return canalId.startsWith(PREFIXO_INSTANCIA) && this.o.canais().some((c) => c.canalId === canalId);
  }

  private saude(canalId: string): SaudeCanal {
    let s = this.canaisSaude.get(canalId);
    if (!s) {
      s = { canalId, estado: 'nunca', desde: this.agora(), precisaParear: false, jaConectou: false, tentativas: 0, avisado: false };
      this.canaisSaude.set(canalId, s);
    }
    return s;
  }

  private avisar(a: AvisoSaude): void {
    this.fila = this.fila.then(() => this.o.avisar(a)).catch((e) => this.log('Falha ao avisar sobre o WhatsApp', String(e)));
  }

  // ---------------------------------------------------------------- mudanças de estado

  /** O canal está funcionando. Se a gestão foi avisada da queda, avisa que voltou. */
  marcarConectado(canalId: string): void {
    const s = this.saude(canalId);
    if (s.estado === 'conectado') return;
    const avisado = s.avisado;
    const quedaDesde = s.desde;
    Object.assign(s, { estado: 'conectado', desde: this.agora(), precisaParear: false, jaConectou: true, pareando: false, tentativas: 0, avisado: false });
    delete s.motivo;
    delete s.codigo;
    delete s.proximaTentativaEm;
    this.gravar(s);
    if (avisado) {
      const nome = this.nomeDe(canalId);
      this.avisar({
        titulo: `O WhatsApp ${nome} voltou`,
        texto: 'Conectado de novo: as mensagens voltaram a chegar e sair.',
        chave: `whatsapp-voltou:${canalId}:${quedaDesde.getTime()}`,
        vista: 'conexoes#nao-oficial',
      });
    }
  }

  /** A Evolution está religando (ou a pessoa está pareando). Sem aviso. */
  private marcarConectando(canalId: string): void {
    const s = this.saude(canalId);
    if (s.estado === 'conectando' || s.estado === 'desconectado') return;
    if (s.estado === 'nunca' || s.estado === 'desligado') return; // pareando ou parado de propósito: nada muda
    Object.assign(s, { estado: 'conectando', desde: this.agora() });
    this.gravar(s);
  }

  /**
   * Caiu. Só gera aviso se o canal já funcionou, não está sendo pareado agora e a pessoa não desligou de propósito.
   * `precisaParear`: só um novo QR Code/código resolve (aviso na hora). Senão: tenta reconectar sozinho e avisa
   * se a primeira tentativa não resolver.
   */
  marcarQueda(canalId: string, q: { codigo?: number; motivo?: string; precisaParear: boolean }): void {
    const s = this.saude(canalId);
    if (s.estado === 'desligado' || (!s.jaConectou && s.estado === 'nunca')) return;
    if (s.pareando && s.estado !== 'conectado') return; // a pessoa está na tela de conectar: ela vê o que acontece
    const motivo = q.motivo ?? motivoDoCodigo(q.codigo);
    if (s.estado === 'desconectado') {
      // Já estava fora: só registra se piorou (agora precisa de QR Code).
      if (q.precisaParear && !s.precisaParear) {
        Object.assign(s, { precisaParear: true, motivo, ...(q.codigo !== undefined ? { codigo: q.codigo } : {}) });
        delete s.proximaTentativaEm;
        this.gravar(s);
        if (!s.avisado) this.avisarQueda(s);
      }
      return;
    }
    Object.assign(s, { estado: 'desconectado', desde: this.agora(), motivo, precisaParear: q.precisaParear, tentativas: 0, avisado: false, pareando: false });
    if (q.codigo !== undefined) s.codigo = q.codigo;
    else delete s.codigo;
    if (q.precisaParear) delete s.proximaTentativaEm;
    else s.proximaTentativaEm = this.agora();
    this.gravar(s);
    this.log(`WhatsApp ${canalId} desconectou`, { codigo: q.codigo, motivo });
    if (q.precisaParear) this.avisarQueda(s);
  }

  private avisarQueda(s: SaudeCanal): void {
    s.avisado = true;
    this.gravar(s);
    const nome = this.nomeDe(s.canalId);
    this.avisar({
      titulo: `O WhatsApp ${nome} desconectou`,
      texto: s.precisaParear
        ? `${s.motivo ?? 'A conexão caiu'}. Toque para reconectar.`
        : `${s.motivo ?? 'A conexão caiu'} e não voltou sozinha. Toque para reconectar.`,
      chave: `whatsapp-queda:${s.canalId}:${s.desde.getTime()}`,
      vista: 'conexoes#nao-oficial',
    });
  }

  /** A pessoa começou a conectar este canal (QR Code ou código): falhas no caminho não são queda. */
  pareandoPelaPessoa(canalId: string): void {
    const s = this.saude(canalId);
    s.pareando = true;
    if (s.estado !== 'conectado') {
      s.desde = this.agora();
      if (s.estado === 'desligado') s.estado = s.jaConectou ? 'conectando' : 'nunca';
    }
    this.gravar(s);
  }

  /** A pessoa desconectou de propósito: sem aviso, sem reconexão. */
  desligadoPelaPessoa(canalId: string): void {
    const s = this.saude(canalId);
    Object.assign(s, { estado: 'desligado', desde: this.agora(), precisaParear: false, pareando: false, tentativas: 0, avisado: false });
    delete s.motivo;
    delete s.proximaTentativaEm;
    this.gravar(s);
  }

  /** Canal apagado em Conexões. */
  removido(canalId: string): void {
    this.canaisSaude.delete(canalId);
    this.fila = this.fila.then(() => this.o.armazem.apagar(canalId)).catch(() => {});
  }

  /** Chegou mensagem (ou histórico) pelo canal: prova de que está conectado. */
  aoMensagem(canalId: string, em: Date = this.agora()): void {
    if (!this.daSintonia(canalId)) return;
    const s = this.saude(canalId);
    if (!s.ultimaMensagemEm || em.getTime() > s.ultimaMensagemEm.getTime()) s.ultimaMensagemEm = em;
    if (s.estado !== 'conectado') return this.marcarConectado(canalId); // já grava
    const t = this.agora().getTime();
    if (t - (this.gravadoMsgEm.get(canalId) ?? 0) >= MIN) {
      this.gravadoMsgEm.set(canalId, t);
      this.gravar(s);
    }
  }

  /**
   * Eventos de conexão do webhook da Evolution. Devolve true se o evento era de conexão (tratado aqui).
   * Nunca lança: corpo estranho é ignorado.
   */
  aoWebhook(corpo: unknown): boolean {
    const evento = eventoEvolution(corpo);
    if (evento !== 'connection.update' && evento !== 'logout.instance' && evento !== 'qrcode.updated' && evento !== 'remove.instance' && evento !== 'instance.delete') return false;
    const c = corpo as { instance?: unknown; data?: unknown };
    const dados = (c.data && typeof c.data === 'object' && !Array.isArray(c.data) ? c.data : {}) as Record<string, unknown>;
    const instancia = typeof c.instance === 'string' ? c.instance : typeof dados.instance === 'string' ? dados.instance : '';
    if (!this.daSintonia(instancia)) return true;
    try {
      if (evento === 'logout.instance' || evento === 'remove.instance' || evento === 'instance.delete') {
        this.marcarQueda(instancia, { codigo: 401, motivo: motivoDoCodigo(401), precisaParear: true });
        return true;
      }
      if (evento === 'qrcode.updated') {
        // Só interessa o "limite de QR Code": ninguém leu a tempo.
        if (typeof dados.statusCode === 'number' || /limit/i.test(String(dados.message ?? ''))) {
          this.marcarQueda(instancia, { motivo: 'O QR Code venceu sem ser lido', precisaParear: true });
        }
        return true;
      }
      const estado = String(dados.state ?? '');
      const codigo = typeof dados.statusReason === 'number' ? dados.statusReason : Number(dados.statusReason) || undefined;
      if (estado === 'open') this.marcarConectado(instancia);
      else if (estado === 'connecting') this.marcarConectando(instancia);
      else if (estado === 'close') this.marcarQueda(instancia, { codigo, precisaParear: codigo === undefined || CODIGOS_SEM_VOLTA.includes(codigo) });
      else if (estado === 'refused') this.marcarQueda(instancia, { motivo: 'O QR Code venceu sem ser lido', precisaParear: true });
    } catch (e) {
      this.log('Falha ao ler o aviso de conexão do WhatsApp', String(e));
    }
    return true;
  }

  // ---------------------------------------------------------------- verificação periódica

  /** Confere todos os canais na Evolution. Duas chamadas ao mesmo tempo viram uma só. */
  verificar(): Promise<void> {
    if (!this.verificando) {
      this.verificando = this.verificarAgora()
        .catch((e) => this.log('Falha ao verificar o WhatsApp', String(e)))
        .finally(() => {
          this.verificando = null;
        });
    }
    return this.verificando;
  }

  private async verificarAgora(): Promise<void> {
    const adm = this.o.admin();
    const canais = this.o.canais();
    if (!adm || !canais.length) return;
    const agora = this.agora();
    let lista: InfoInstancia[];
    try {
      lista = await adm.listar();
    } catch (e) {
      this.servidorFalhou(e);
      return;
    }
    this.servidorRespondeu();
    for (const { canalId } of canais) {
      const s = this.saude(canalId);
      s.ultimaVerificacaoEm = agora;
      const info = lista.find((i) => i.nome === canalId);
      const estado = info?.estado ?? 'inexistente';
      if (estado === 'conectada') {
        this.marcarConectado(canalId);
        if (adm.atualizarEventos && !this.eventosConferidos.has(canalId)) {
          this.eventosConferidos.add(canalId);
          await adm.atualizarEventos(canalId).then((mudou) => mudou && this.log(`Webhook do WhatsApp ${canalId} passou a avisar quedas`)).catch(() => this.eventosConferidos.delete(canalId));
        }
        continue;
      }
      if (s.estado === 'desligado') continue;
      if (estado === 'conectando') {
        if (s.estado === 'conectado') this.marcarConectando(canalId);
        else if (s.jaConectou && s.estado !== 'desconectado') {
          const limite = s.pareando ? 3 * (this.o.limiteConectandoMs ?? 5 * MIN) : (this.o.limiteConectandoMs ?? 5 * MIN);
          if (agora.getTime() - s.desde.getTime() >= limite) {
            s.pareando = false;
            this.marcarQueda(canalId, { motivo: 'O WhatsApp está pedindo para ler o QR Code de novo', precisaParear: true });
          }
        }
        continue;
      }
      // Pareando há muito tempo sem conseguir: deixa de ser "pareando" e vale como queda (se já tinha funcionado).
      if (s.pareando && agora.getTime() - s.desde.getTime() >= 3 * (this.o.limiteConectandoMs ?? 5 * MIN)) s.pareando = false;
      if (estado === 'inexistente') {
        this.marcarQueda(canalId, { motivo: 'A conexão deste canal foi apagada do servidor do WhatsApp', precisaParear: true });
        continue;
      }
      // Fechada: com código de "sem volta" só o QR Code resolve; sem código, tenta reconectar.
      const codigo = info?.codigoDesconexao ?? undefined;
      this.marcarQueda(canalId, { codigo, precisaParear: codigo !== undefined && CODIGOS_SEM_VOLTA.includes(codigo) });
    }
    for (const { canalId } of canais) await this.talvezReconectar(adm, canalId);
  }

  /** Reconexão automática: só quando a sessão ainda vale, com limite de tentativas e espera crescente. */
  private async talvezReconectar(adm: AdminSaude, canalId: string): Promise<void> {
    const s = this.canaisSaude.get(canalId);
    if (!s || s.estado !== 'desconectado' || s.precisaParear || s.pareando) return;
    const agora = this.agora();
    if (s.tentativas >= this.maxTentativas) return;
    if (s.proximaTentativaEm && s.proximaTentativaEm.getTime() > agora.getTime()) return;
    s.tentativas++;
    s.proximaTentativaEm = new Date(agora.getTime() + (this.o.esperaBaseMs ?? MIN) * 2 ** (s.tentativas - 1));
    this.gravar(s);
    let r: Awaited<ReturnType<AdminSaude['reconectar']>>;
    try {
      r = await adm.reconectar(canalId);
    } catch (e) {
      this.log(`Reconexão do WhatsApp ${canalId} falhou`, String(e));
      r = { estado: 'conectando' };
    }
    if (r.estado === 'conectada') {
      this.log(`WhatsApp ${canalId} reconectou sozinho (tentativa ${s.tentativas})`);
      this.marcarConectado(canalId);
      return;
    }
    if (r.estado === 'precisa_parear' || r.estado === 'inexistente') {
      this.marcarQueda(canalId, {
        motivo: r.estado === 'inexistente' ? 'A conexão deste canal foi apagada do servidor do WhatsApp' : 'O WhatsApp pede para ler o QR Code de novo',
        precisaParear: true,
      });
      return;
    }
    // Ainda não voltou: avisa depois da primeira tentativa sem sucesso (e para de tentar no limite).
    if (!s.avisado) this.avisarQueda(s);
    if (s.tentativas >= this.maxTentativas) {
      delete s.proximaTentativaEm;
      this.gravar(s);
    }
  }

  private servidorFalhou(e: unknown): void {
    const erro = String((e as Error)?.message ?? e).slice(0, 200);
    const sv = this.servidor;
    if (sv.ok && sv.falhas === 0) sv.desde = this.agora(); // primeira falha: a queda conta daqui
    sv.falhas++;
    sv.erro = erro;
    sv.ultimaVerificacaoEm = this.agora();
    if (sv.ok && sv.falhas >= (this.o.falhasParaQueda ?? 2)) {
      sv.ok = false;
      sv.avisado = true;
      this.log('Servidor do WhatsApp (Evolution) sem resposta', erro);
      this.avisar({
        titulo: 'Servidor do WhatsApp sem resposta',
        texto: 'As mensagens do WhatsApp (QR Code) podem não estar chegando nem saindo. A Sintonia continua tentando.',
        chave: `evolution-fora:${sv.desde.getTime()}`,
        vista: 'conexoes#nao-oficial',
      });
    }
    this.gravar('servidor');
  }

  private servidorRespondeu(): void {
    const sv = this.servidor;
    sv.ultimaVerificacaoEm = this.agora();
    if (sv.ok && sv.falhas === 0) return;
    const estavaFora = !sv.ok;
    const desde = sv.desde;
    const avisado = sv.avisado;
    this.servidor = { ok: true, desde: this.agora(), falhas: 0, avisado: false, ultimaVerificacaoEm: this.agora() };
    this.gravar('servidor');
    if (estavaFora && avisado) {
      this.log('Servidor do WhatsApp (Evolution) voltou a responder');
      this.avisar({
        titulo: 'O servidor do WhatsApp voltou',
        texto: 'Respondendo de novo: as mensagens voltaram a chegar e sair.',
        chave: `evolution-voltou:${desde.getTime()}`,
        vista: 'conexoes#nao-oficial',
      });
    }
  }

  // ---------------------------------------------------------------- relógio

  /** Verifica a cada `intervaloMs` (padrão 2 min). Os relógios não seguram o processo aberto. */
  iniciar(intervaloMs = 2 * MIN, primeiraEmMs = 20_000): void {
    this.parar();
    this.primeira = setTimeout(() => void this.verificar(), primeiraEmMs);
    this.primeira.unref?.();
    this.relogio = setInterval(() => void this.verificar(), intervaloMs);
    this.relogio.unref?.();
  }

  parar(): void {
    if (this.relogio) clearInterval(this.relogio);
    if (this.primeira) clearTimeout(this.primeira);
    this.relogio = undefined;
    this.primeira = undefined;
  }

  // ---------------------------------------------------------------- leitura

  servidorOk(): boolean {
    return this.servidor.ok;
  }

  infoServidor(): { ok: boolean; desde: string; erro: string | null } {
    return { ok: this.servidor.ok, desde: this.servidor.desde.toISOString(), erro: this.servidor.ok ? null : (this.servidor.erro ?? null) };
  }

  canal(canalId: string): SaudeCanal | undefined {
    return this.canaisSaude.get(canalId);
  }

  /** Para as telas: um item por canal salvo. */
  resumo(): {
    servidor: { ok: boolean; desde: string; erro: string | null };
    canais: Array<{
      id: string;
      nome: string;
      estado: EstadoSaude;
      desde: string;
      motivo: string | null;
      precisaParear: boolean;
      reconectando: boolean;
      tentativas: number;
      ultimaMensagemEm: string | null;
    }>;
  } {
    return {
      servidor: this.infoServidor(),
      canais: this.o.canais().map(({ canalId, nome }) => {
        const s = this.canaisSaude.get(canalId);
        return {
          id: canalId,
          nome,
          estado: s?.estado ?? 'nunca',
          desde: (s?.desde ?? this.agora()).toISOString(),
          motivo: s?.motivo ?? null,
          precisaParear: s?.precisaParear ?? false,
          reconectando: Boolean(s && s.estado === 'desconectado' && !s.precisaParear && s.tentativas < this.maxTentativas),
          tentativas: s?.tentativas ?? 0,
          ultimaMensagemEm: s?.ultimaMensagemEm?.toISOString() ?? null,
        };
      }),
    };
  }
}

// ---------------------------------------------------------------- armazéns

export class ArmazemSaudeMemoria implements ArmazemSaude {
  readonly dados = new Map<string, Record<string, unknown>>();
  async carregar() {
    return [...this.dados].map(([chave, dados]) => ({ chave, dados: JSON.parse(JSON.stringify(dados)) as Record<string, unknown> }));
  }
  async gravar(chave: string, dados: Record<string, unknown>) {
    this.dados.set(chave, JSON.parse(JSON.stringify(dados)) as Record<string, unknown>);
  }
  async apagar(chave: string) {
    this.dados.delete(chave);
  }
}

/** db/migrations/330_whatsapp_saude.sql */
export class ArmazemSaudePostgres implements ArmazemSaude {
  constructor(private readonly pool: pg.Pool) {}
  async carregar() {
    const { rows } = await this.pool.query<{ canal_id: string; dados: Record<string, unknown> }>('select canal_id, dados from sintonia.whatsapp_saude');
    return rows.map((r) => ({ chave: r.canal_id, dados: r.dados }));
  }
  async gravar(chave: string, dados: Record<string, unknown>) {
    await this.pool.query(
      `insert into sintonia.whatsapp_saude (canal_id, dados, atualizado_em) values ($1, $2, now())
       on conflict (canal_id) do update set dados = excluded.dados, atualizado_em = now()`,
      [chave, JSON.stringify(dados)],
    );
  }
  async apagar(chave: string) {
    await this.pool.query('delete from sintonia.whatsapp_saude where canal_id = $1', [chave]);
  }
}
