/**
 * perdas-saude: limite de tentativas de login.
 *
 * Três contas separadas (tudo em memória do processo; um reinício zera, o que só favorece quem errou a senha):
 * - endereço + e-mail: 5 erros em 15 min bloqueiam esse par por 15 min (como sempre foi);
 * - endereço (de qualquer e-mail): 20 erros em 15 min bloqueiam o endereço por 15 min — quem testa muitos e-mails
 *   diferentes do mesmo lugar para aqui;
 * - conta (o e-mail, de qualquer endereço): 8 erros em 30 min bloqueiam a CONTA por um tempo que cresce a cada
 *   bloqueio (5 min, 15 min, 1 h, 4 h, 24 h) e volta ao começo depois de 24 h sem bloqueio. Enquanto a conta está
 *   bloqueada, nem a senha certa entra (é isso que segura quem tenta de muitos endereços); "Esqueci minha senha"
 *   libera na hora (liberarConta), porque só a dona do e-mail consegue criar a senha nova.
 * Ao bloquear a conta, `aoBloquearConta` avisa a dona (sino e e-mail, em src/index.ts), no máximo uma vez por bloqueio.
 */

const MIN = 60_000;
export const LIMITES_LOGIN = {
  par: { erros: 5, janelaMs: 15 * MIN, bloqueioMs: 15 * MIN },
  endereco: { erros: 20, janelaMs: 15 * MIN, bloqueioMs: 15 * MIN },
  conta: { erros: 8, janelaMs: 30 * MIN, esperasMs: [5 * MIN, 15 * MIN, 60 * MIN, 240 * MIN, 1440 * MIN], zeraNivelMs: 1440 * MIN },
} as const;

export type MotivoBloqueio = 'par' | 'endereco' | 'conta';
export interface Bloqueio {
  motivo: MotivoBloqueio;
  ate: number;
}
export interface BloqueioConta {
  email: string;
  ate: number;
  nivel: number;
  erros: number;
}

interface EstadoConta {
  erros: number[];
  bloqueadaAte: number;
  nivel: number;
  ultimoBloqueio: number;
}

const tirarVelhas = (l: number[], agora: number, janela: number) => l.filter((t) => agora - t < janela);

export class LimiteLogin {
  private readonly par = new Map<string, number[]>();
  private readonly endereco = new Map<string, number[]>();
  private readonly contas = new Map<string, EstadoConta>();

  constructor(private readonly o: { aoBloquearConta?: (b: BloqueioConta) => void } = {}) {}

  private chavePar = (ip: string, email: string) => `${ip}|${email.toLowerCase()}`;

  /** Está bloqueado agora? (antes de conferir a senha) */
  bloqueio(ip: string, email: string, agora: number): Bloqueio | null {
    const e = email.toLowerCase();
    const c = this.contas.get(e);
    if (c && c.bloqueadaAte > agora) return { motivo: 'conta', ate: c.bloqueadaAte };
    const L = LIMITES_LOGIN;
    const ender = tirarVelhas(this.endereco.get(ip) ?? [], agora, L.endereco.janelaMs);
    this.endereco.set(ip, ender);
    if (ender.length >= L.endereco.erros) return { motivo: 'endereco', ate: ender.at(-L.endereco.erros)! + L.endereco.bloqueioMs };
    const par = tirarVelhas(this.par.get(this.chavePar(ip, e)) ?? [], agora, L.par.janelaMs);
    this.par.set(this.chavePar(ip, e), par);
    if (par.length >= L.par.erros) return { motivo: 'par', ate: par.at(-L.par.erros)! + L.par.bloqueioMs };
    return null;
  }

  /**
   * Errou a senha (ou o e-mail não existe: conta igual, para não revelar quem tem conta).
   * Devolve quantas tentativas faltam antes do próximo bloqueio (o menor dos três) e, se bloqueou agora, o bloqueio.
   */
  errou(ip: string, email: string, agora: number): { restantes: number; bloqueio: Bloqueio | null } {
    const e = email.toLowerCase();
    const L = LIMITES_LOGIN;
    const kp = this.chavePar(ip, e);
    const par = [...tirarVelhas(this.par.get(kp) ?? [], agora, L.par.janelaMs), agora];
    this.par.set(kp, par);
    const ender = [...tirarVelhas(this.endereco.get(ip) ?? [], agora, L.endereco.janelaMs), agora];
    this.endereco.set(ip, ender);
    const c = this.contas.get(e) ?? { erros: [], bloqueadaAte: 0, nivel: 0, ultimoBloqueio: 0 };
    if (c.ultimoBloqueio && agora - c.ultimoBloqueio > L.conta.zeraNivelMs && c.bloqueadaAte <= agora) c.nivel = 0;
    c.erros = [...tirarVelhas(c.erros, agora, L.conta.janelaMs), agora];
    this.contas.set(e, c);
    if (this.par.size > 20_000) this.par.clear();
    if (this.endereco.size > 20_000) this.endereco.clear();
    if (this.contas.size > 20_000) this.contas.clear();

    let bloqueio: Bloqueio | null = null;
    if (c.erros.length >= L.conta.erros) {
      const espera = L.conta.esperasMs[Math.min(c.nivel, L.conta.esperasMs.length - 1)]!;
      c.bloqueadaAte = agora + espera;
      c.ultimoBloqueio = agora;
      c.nivel++;
      const erros = c.erros.length;
      c.erros = [];
      bloqueio = { motivo: 'conta', ate: c.bloqueadaAte };
      try {
        this.o.aoBloquearConta?.({ email: e, ate: c.bloqueadaAte, nivel: c.nivel, erros });
      } catch {
        /* aviso é extra: nunca atrapalha o login */
      }
    } else if (ender.length >= L.endereco.erros) bloqueio = { motivo: 'endereco', ate: agora + L.endereco.bloqueioMs };
    else if (par.length >= L.par.erros) bloqueio = { motivo: 'par', ate: agora + L.par.bloqueioMs };
    const restantes = bloqueio ? 0 : Math.min(L.par.erros - par.length, L.endereco.erros - ender.length, L.conta.erros - c.erros.length);
    return { restantes, bloqueio };
  }

  /** Entrou: zera os erros desse par e da conta (o nível de espera da conta continua valendo por 24 h). */
  acertou(ip: string, email: string): void {
    const e = email.toLowerCase();
    this.par.delete(this.chavePar(ip, e));
    const c = this.contas.get(e);
    if (c) c.erros = [];
  }

  /** Nova senha criada pelo "Esqueci minha senha" (ou convite): a conta volta a entrar na hora. */
  liberarConta(email: string): void {
    this.contas.delete(email.toLowerCase());
    for (const k of this.par.keys()) if (k.endsWith(`|${email.toLowerCase()}`)) this.par.delete(k);
  }
}

/** "5 minutos", "1 hora", "4 horas", "24 horas" (arredonda para cima). */
export function esperaEmTexto(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / MIN));
  if (min < 60) return `${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.ceil(min / 60);
  return `${h} ${h === 1 ? 'hora' : 'horas'}`;
}

/** Mensagem honesta para a tela de entrar. */
export function mensagemBloqueio(b: Bloqueio, agora: number): string {
  const espera = esperaEmTexto(b.ate - agora);
  if (b.motivo === 'conta')
    return `Por segurança, esta conta ficou bloqueada por ${espera} depois de muitas tentativas com a senha errada. Se não foi você, crie uma senha nova em "Esqueci minha senha": isso libera na hora.`;
  if (b.motivo === 'endereco') return `Muitas tentativas erradas a partir desta rede. Espere ${espera} e tente de novo.`;
  return `Muitas tentativas com a senha errada. Espere ${espera} e tente de novo, ou use "Esqueci minha senha".`;
}
