import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * sem-pagamento: a Sintonia não vende nada por dentro (preparação para a App Store, diretriz 3.1.1).
 *
 * - Contato público: o número de WhatsApp de vendas fica numa variável só (SINTONIA_WHATSAPP_VENDAS, vazia por padrão)
 *   e o e-mail de suporte em SINTONIA_EMAIL_SUPORTE (opcional). As páginas públicas (vendas, login, suporte,
 *   privacidade e termos) leem de GET /api/publico/contato pelo /contato-publico.js. Sem número, os botões levam
 *   para o e-mail ou para a página /suporte (que tem um formulário de recado).
 * - Ninguém cria conta sozinho: qualquer rota de cadastro responde 403 com o caminho do WhatsApp. Contas novas só
 *   pela administração (Atendentes e acessos › convite por link).
 * - Compra, plano, créditos e cobrança (Asaas) desligados: as rotas respondem 410. As tabelas continuam no banco
 *   (nada é apagado) e a medição de uso da IA continua valendo por dentro.
 */

export interface ContatoPublico {
  /** Só números, com o código do país (ex.: 5571999998888). Vazio = sem WhatsApp configurado. */
  whatsapp: string;
  /** E-mail de suporte. Vazio = sem e-mail configurado. */
  email: string;
  /** Mensagem pronta que abre no WhatsApp. */
  mensagem: string;
}

export const MENSAGEM_WHATSAPP = 'Olá! Quero conhecer a Sintonia.';

/** Número do WhatsApp em formato do wa.me: só dígitos; número brasileiro sem o 55 (10 ou 11 dígitos) ganha o 55. */
export function normalizarWhatsapp(bruto: string | undefined | null): string {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d.length >= 12 && d.length <= 15 ? d : '';
}

export function normalizarEmail(bruto: string | undefined | null): string {
  const e = String(bruto ?? '').trim();
  return /^[^\s@<>"']{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,}$/i.test(e) ? e : '';
}

export function contatoDoAmbiente(env: Record<string, string | undefined> = process.env): ContatoPublico {
  return { whatsapp: normalizarWhatsapp(env.SINTONIA_WHATSAPP_VENDAS), email: normalizarEmail(env.SINTONIA_EMAIL_SUPORTE), mensagem: MENSAGEM_WHATSAPP };
}

/** Rotas de cadastro que nunca existem: respondem recusa clara (e são públicas, para não confundir com "faça login"). */
export const ROTAS_CADASTRO = ['/api/auth/cadastro', '/api/auth/cadastrar', '/api/auth/criar-conta', '/api/auth/registrar', '/api/auth/signup', '/api/cadastro'] as const;
export const ROTAS_PUBLICAS_SEM_PAGAMENTO = ['/api/publico/contato', ...ROTAS_CADASTRO] as const;

export const SEM_CADASTRO = 'Não é possível criar conta por aqui. O acesso à Sintonia é liberado pela nossa equipe: fale com a gente no WhatsApp.';
export const DESLIGADO = 'Esta função foi desligada. A Sintonia não faz cobranças nem vendas pelo aplicativo.';

export interface OpcoesPublico {
  contato?: ContatoPublico;
}

export function registrarPublico(app: FastifyInstance, o: OpcoesPublico = {}): void {
  const contato = o.contato ?? contatoDoAmbiente();

  app.get('/api/publico/contato', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return { whatsapp: contato.whatsapp || null, email: contato.email || null, mensagem: contato.mensagem };
  });

  // Cadastro pela própria pessoa: desligado (qualquer método).
  const recusa = async (_req: unknown, reply: FastifyReply) => reply.code(403).send({ erro: SEM_CADASTRO, semCadastro: true, whatsapp: contato.whatsapp || null });
  for (const rota of ROTAS_CADASTRO) app.all(rota, recusa);

  // Plano, créditos, pedidos, comparativo de custo e pagamentos (Asaas): desligados.
  const desligado = async (_req: unknown, reply: FastifyReply) => reply.code(410).send({ erro: DESLIGADO, desligado: true });
  for (const rota of ['/api/planos', '/api/planos/*', '/webhooks/asaas', '/api/conexoes/pagamentos', '/api/conexoes/pagamentos/*']) app.all(rota, desligado);
}
