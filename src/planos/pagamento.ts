import type { Pedido } from './armazem.js';

/**
 * Pagamento da assinatura e das recargas. Hoje NÃO há cobrança real: o provedor "manual" só registra o pedido
 * e responde "em breve: pagamento". Para cobrar de verdade, implemente esta interface com Stripe, Mercado Pago
 * ou Asaas (docs/PLANOS.md → "O que falta para cobrar") e confirme o pedido no webhook com `Planos.confirmarPedido`.
 */
export interface PagamentoProvider {
  readonly nome: string;
  /** Pagamento real disponível? (a tela mostra "em breve" quando não.) */
  readonly ativo: boolean;
  /** Cria a cobrança do pedido. Devolve o link de pagamento, se houver. */
  iniciar(pedido: Pedido, valor: number, descricao: string): Promise<{ url?: string; mensagem: string }>;
}

export class PagamentoManual implements PagamentoProvider {
  readonly nome = 'manual';
  readonly ativo = false;
  async iniciar(_p: Pedido, _valor: number, _descricao: string) {
    return { mensagem: 'Pedido registrado. Em breve: pagamento pela plataforma. Por enquanto, a equipe Sintonia entra em contato para ativar.' };
  }
}
