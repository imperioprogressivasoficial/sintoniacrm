import type { Pedido } from './armazem.js';

/**
 * Pagamento da assinatura e das recargas. Sem chave do Asaas, o provedor "manual" só registra o pedido e responde
 * "em breve: pagamento". Com a chave salva em Conexões › Outras configurações › Pagamentos, vale o Asaas
 * (src/planos/asaas.ts): a cobrança sai com link de pagamento e o webhook confirma o pedido com
 * `Planos.confirmarPedido`.
 */
export interface ResultadoPagamento {
  /** Link de pagamento (Pix, boleto ou cartão), quando há cobrança real. */
  url?: string;
  mensagem: string;
  /** Falta o CPF/CNPJ de quem paga: a tela pede e manda de novo. */
  precisaCpfCnpj?: boolean;
}

export interface PagamentoProvider {
  readonly nome: string;
  /** Pagamento real disponível? (a tela mostra "em breve" quando não.) */
  readonly ativo: boolean;
  /** Cria a cobrança do pedido. Devolve o link de pagamento, se houver. */
  iniciar(pedido: Pedido, valor: number, descricao: string): Promise<ResultadoPagamento>;
  /** Falta algum dado para cobrar (ex.: CPF/CNPJ)? null = pode cobrar. Conferido antes de registrar o pedido. */
  pendencia?(): Promise<{ mensagem: string; precisaCpfCnpj: boolean } | null>;
  /** Guarda o CPF/CNPJ de quem paga (informado na tela do plano). Lança 400 se não for válido. */
  guardarCpfCnpj?(documento: string, quem: string): Promise<void>;
}

export class PagamentoManual implements PagamentoProvider {
  readonly nome = 'manual';
  readonly ativo = false;
  async iniciar(_p: Pedido, _valor: number, _descricao: string): Promise<ResultadoPagamento> {
    return { mensagem: 'Pedido registrado. Em breve: pagamento pela plataforma. Por enquanto, a equipe Sintonia entra em contato para ativar.' };
  }
}
