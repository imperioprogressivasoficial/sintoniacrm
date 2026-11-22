import { randomUUID } from 'node:crypto';
import type { CanalWhatsApp, EnvioResultado } from './tipos.js';

/**
 * WhatsApp de teste, dentro da própria Sintonia: não envia nada para fora.
 * Serve para ver a plataforma funcionando (conversas, funil, IA, Agendar) antes de ligar um número real.
 */
export class CanalTeste implements CanalWhatsApp {
  readonly tipo = 'teste' as const;
  lerWebhook(): never[] {
    return [];
  }
  async enviarTexto(): Promise<EnvioResultado> {
    return { idExterno: `teste-${randomUUID()}` };
  }
  /** Aceita foto, vídeo, documento e áudio sem mandar nada para fora (a Sintonia guarda o arquivo). */
  async enviarMidia(): Promise<EnvioResultado> {
    return { idExterno: `teste-${randomUUID()}` };
  }
  /* menu-mensagem: reagir, responder citando, editar e apagar para todos, sem mandar nada para fora */
  async enviarReacao(): Promise<void> {}
  async enviarCitando(): Promise<EnvioResultado> {
    return { idExterno: `teste-${randomUUID()}` };
  }
  async editarTexto(): Promise<void> {}
  async apagarParaTodos(): Promise<void> {}
}

/** Canal de teste de cada unidade. */
export const canalTesteDa = (unidade: string) => `teste-${unidade}`;
export const ehCanalTeste = (canalId: string) => canalId.startsWith('teste-');
