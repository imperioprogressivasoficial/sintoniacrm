import { generateVAPIDKeys, sendNotification } from 'web-push';
import type { Cofre } from '../conexoes/cofre.js';
import type { ArmazemNotificacoes } from './armazem.js';
import type { InscricaoPush } from './tipos.js';

/** Chaves VAPID do servidor: geradas uma vez e guardadas no banco (a privada cifrada pelo Cofre). */
export interface ChavesVapid {
  publica: string;
  privada: string;
}

/** O que vai para o aparelho (o service worker /sw.js monta a notificação com isto). */
export interface CargaPush {
  id: string;
  titulo: string;
  texto: string;
  conversaId?: string;
  vista?: string;
  /** Notificações com a mesma etiqueta se substituem no aparelho (uma por conversa). */
  etiqueta: string;
  /** Atualização silenciosa de uma notificação que já está no aparelho (rajada de mensagens). */
  silenciosa?: boolean;
  /** Tipo da notificação (o app escolhe o som). */
  tipo?: string;
  /** Vibrar o celular (preferência da pessoa). */
  vibrar?: boolean;
  /** Fica na tela até a pessoa tocar (cliente esperando). */
  insistente?: boolean;
}

/** Quem manda o push de verdade. Nos testes, um falso (nunca chama a rede). */
export interface EnviadorPush {
  /** Lança erro com `statusCode` quando o serviço de push recusa (404/410 = inscrição morta). */
  enviar(i: InscricaoPush, carga: string, chaves: ChavesVapid & { assunto: string }, opcoes: { ttlSeg: number; urgencia: 'normal' | 'high' }): Promise<void>;
}

export const enviadorWebPush: EnviadorPush = {
  async enviar(i, carga, chaves, opcoes) {
    await sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, carga, {
      vapidDetails: { subject: chaves.assunto, publicKey: chaves.publica, privateKey: chaves.privada },
      TTL: opcoes.ttlSeg,
      urgency: opcoes.urgencia,
      timeout: 15_000,
    });
  },
};

export class ChavesPush {
  private atuais?: Promise<ChavesVapid>;
  constructor(
    private readonly armazem: ArmazemNotificacoes,
    private readonly cofre?: Cofre,
    private readonly gerar: () => { publicKey: string; privateKey: string } = generateVAPIDKeys,
  ) {}

  obter(): Promise<ChavesVapid> {
    this.atuais ??= this.carregar().catch((e) => {
      this.atuais = undefined;
      throw e;
    });
    return this.atuais;
  }

  private async carregar(): Promise<ChavesVapid> {
    let guardado = await this.armazem.config('vapid');
    if (!guardado) {
      const k = this.gerar();
      const privada = this.cofre ? this.cofre.cifrar(k.privateKey) : `claro:${k.privateKey}`;
      guardado = await this.armazem.gravarConfigSeNova('vapid', JSON.stringify({ publica: k.publicKey, privada }));
    }
    const { publica, privada } = JSON.parse(guardado) as { publica: string; privada: string };
    return { publica, privada: privada.startsWith('claro:') ? privada.slice(6) : this.cofre!.decifrar(privada) };
  }
}
