import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conexoes } from '../conexoes/conexoes.js';
import { dataISO, DIA } from '../util/tempo.js';
import type { Pedido } from './armazem.js';
import { PagamentoManual, type PagamentoProvider, type ResultadoPagamento } from './pagamento.js';
import type { Planos } from './porteiro.js';

/**
 * Cobrança real pelo Asaas (Pix, boleto e cartão), API v3. Só liga quando a chave está salva em
 * Conexões › Outras configurações › Pagamentos; sem chave, vale o PagamentoManual (nada muda para quem usa).
 *
 * Fluxo: acha (ou cria) o cliente no Asaas pelo CPF/CNPJ de quem paga → cria uma cobrança avulsa
 * (`billingType: UNDEFINED`, a pessoa escolhe Pix, boleto ou cartão; vence em 3 dias; `externalReference` = id do
 * pedido) → devolve o `invoiceUrl`. O Asaas avisa em POST /webhooks/asaas (PAYMENT_CONFIRMED ou PAYMENT_RECEIVED) e o
 * pedido é confirmado uma vez só (`Planos.confirmarPedido`).
 *
 * Mudar de plano também é uma cobrança avulsa (o mês do plano novo); a renovação mensal automática ainda não existe
 * (docs/PLANOS.md › "O que falta para cobrar").
 */

export const ASAAS_PRODUCAO = 'https://api.asaas.com/v3';
export const ASAAS_SANDBOX = 'https://api-sandbox.asaas.com/v3';

/** Chave de sandbox do Asaas tem "_hmlg_" ($aact_hmlg_...); a opção "Sandbox" na tela força o sandbox. */
export const ehSandbox = (chave: string, flag?: string) => flag === '1' || /_hmlg_/.test(chave);
export const urlAsaas = (chave: string, flag?: string) => (ehSandbox(chave, flag) ? ASAAS_SANDBOX : ASAAS_PRODUCAO);

export const soDigitos = (s: string | undefined) => String(s ?? '').replace(/\D/g, '');
export const documentoValido = (d: string) => d.length === 11 || d.length === 14;

export class ErroAsaas extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export type ConfigPagamento = Pick<Conexoes, 'get' | 'salvar'>;

export interface OpcoesAsaas {
  conexoes: ConfigPagamento;
  /** Nome de quem paga quando "Nome na cobrança" está vazio (o nome da empresa). */
  nomeEmpresa: () => Promise<string>;
  fetchFn?: typeof fetch;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

const FALTA_DOC = 'Para gerar a cobrança, informe o CPF ou o CNPJ de quem paga (só os números).';

export class PagamentoAsaas implements PagamentoProvider {
  readonly nome = 'asaas';
  constructor(private readonly o: OpcoesAsaas) {}

  /** Liga sozinho quando há chave salva. */
  get ativo(): boolean {
    return Boolean(this.o.conexoes.get('asaasApiKey'));
  }

  get sandbox(): boolean {
    const chave = this.o.conexoes.get('asaasApiKey');
    return chave ? ehSandbox(chave, this.o.conexoes.get('asaasSandbox')) : this.o.conexoes.get('asaasSandbox') === '1';
  }

  private log(msg: string, extra?: unknown) {
    this.o.log?.(msg, extra);
  }

  private async chamar<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<T> {
    const chave = this.o.conexoes.get('asaasApiKey');
    if (!chave) throw new ErroAsaas('Chave do Asaas não preenchida.', 400);
    const f = this.o.fetchFn ?? fetch;
    let r: Response;
    try {
      r = await f(`${urlAsaas(chave, this.o.conexoes.get('asaasSandbox'))}${caminho}`, {
        method: metodo,
        headers: { access_token: chave, 'content-type': 'application/json', 'user-agent': 'Sintonia' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ErroAsaas(`O Asaas não respondeu (${String((e as Error).message ?? e).slice(0, 120)}).`, 502);
    }
    const j = (await r.json().catch(() => ({}))) as { errors?: Array<{ description?: string }> };
    if (!r.ok) {
      if (r.status === 401) throw new ErroAsaas('O Asaas recusou a chave. Confira se copiou a chave inteira e se ela é da conta certa (produção ou sandbox).', 401);
      const motivo = (j.errors ?? []).map((e) => e.description).filter(Boolean).join(' ');
      throw new ErroAsaas(`O Asaas recusou: ${motivo || `erro ${r.status}`}`, r.status);
    }
    return j as T;
  }

  async pendencia() {
    return documentoValido(soDigitos(this.o.conexoes.get('cobrancaCpfCnpj'))) ? null : { mensagem: FALTA_DOC, precisaCpfCnpj: true };
  }

  async guardarCpfCnpj(documento: string, quem: string) {
    const d = soDigitos(documento);
    if (!documentoValido(d)) throw Object.assign(new Error('CPF tem 11 números e CNPJ tem 14. Confira e tente de novo.'), { statusCode: 400 });
    await this.o.conexoes.salvar({ cobrancaCpfCnpj: d }, quem);
  }

  /** Acha o cliente pelo CPF/CNPJ ou cria um novo. */
  async cliente(): Promise<string> {
    const c = this.o.conexoes;
    const cpfCnpj = soDigitos(c.get('cobrancaCpfCnpj'));
    if (!documentoValido(cpfCnpj)) throw new ErroAsaas(FALTA_DOC, 400);
    const achou = await this.chamar<{ data?: Array<{ id: string; deleted?: boolean }> }>('GET', `/customers?cpfCnpj=${cpfCnpj}&limit=1`);
    const existente = achou.data?.find((x) => !x.deleted);
    if (existente) return existente.id;
    const nome = c.get('cobrancaNome') || (await this.o.nomeEmpresa());
    const email = c.get('cobrancaEmail');
    const novo = await this.chamar<{ id: string }>('POST', '/customers', { name: nome, cpfCnpj, ...(email ? { email } : {}) });
    this.log('Cliente criado no Asaas', { cliente: novo.id });
    return novo.id;
  }

  async iniciar(pedido: Pedido, valor: number, descricao: string): Promise<ResultadoPagamento> {
    if (!(valor > 0)) return { mensagem: 'Pedido registrado. Este pedido não tem cobrança pela plataforma: a equipe Sintonia entra em contato.' };
    const falta = await this.pendencia();
    if (falta) return falta;
    try {
      const customer = await this.cliente();
      const agora = (this.o.agora ?? (() => new Date()))();
      const cobranca = await this.chamar<{ id: string; invoiceUrl?: string }>('POST', '/payments', {
        customer,
        billingType: 'UNDEFINED',
        value: Math.round(valor * 100) / 100,
        dueDate: dataISO(new Date(agora.getTime() + 3 * DIA)),
        description: `Sintonia: ${descricao}`,
        externalReference: pedido.id,
      });
      this.log('Cobrança criada no Asaas', { pedido: pedido.id, cobranca: cobranca.id, valor });
      if (!cobranca.invoiceUrl) return { mensagem: 'Cobrança criada, mas o Asaas não mandou o link. Veja a cobrança no painel do Asaas.' };
      return { url: cobranca.invoiceUrl, mensagem: 'Cobrança gerada. Pague pelo link (Pix, boleto ou cartão). O pedido é liberado assim que o pagamento for confirmado.' };
    } catch (e) {
      this.log('Falha ao criar a cobrança no Asaas', { pedido: pedido.id, erro: String((e as Error).message ?? e) });
      return { mensagem: `Não deu para gerar a cobrança agora. ${(e as Error).message ?? ''} O pedido ficou registrado; tente de novo ou fale com a equipe Sintonia.`.replace(/\s+/g, ' ').trim() };
    }
  }

  /** "Testar" da tela: lê o saldo (chamada barata, só leitura). */
  async testar(): Promise<{ mensagem: string }> {
    await this.chamar('GET', '/finance/balance');
    return { mensagem: `Asaas respondendo (${this.sandbox ? 'sandbox, para testes' : 'produção'})` };
  }
}

/** Escolhe na hora: Asaas quando há chave; senão, o manual. Trocar a chave em Conexões vale sem reiniciar. */
export class PagamentoEscolhido implements PagamentoProvider {
  constructor(
    readonly asaas: PagamentoAsaas,
    readonly manual: PagamentoProvider = new PagamentoManual(),
  ) {}
  get atual(): PagamentoProvider {
    return this.asaas.ativo ? this.asaas : this.manual;
  }
  get nome() {
    return this.atual.nome;
  }
  get ativo() {
    return this.atual.ativo;
  }
  iniciar(pedido: Pedido, valor: number, descricao: string) {
    return this.atual.iniciar(pedido, valor, descricao);
  }
  async pendencia() {
    return (await this.atual.pendencia?.()) ?? null;
  }
  async guardarCpfCnpj(documento: string, quem: string) {
    await this.atual.guardarCpfCnpj?.(documento, quem);
  }
}

/** Compara em tempo constante (os dois lados viram hash do mesmo tamanho). */
export function tokenConfere(recebido: unknown, esperado: string | undefined): boolean {
  if (!esperado || typeof recebido !== 'string' || !recebido) return false;
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(recebido), h(esperado));
}

export const novoTokenAsaas = () => `sintonia-asaas-${randomBytes(24).toString('hex')}`;

const EVENTOS_PAGO = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const AvisoAsaas = z.object({
  event: z.string(),
  payment: z.object({ id: z.string().optional(), externalReference: z.string().nullish(), value: z.number().optional() }).passthrough().optional(),
});

export interface OpcoesRotasAsaas {
  asaas: PagamentoAsaas;
  conexoes: ConfigPagamento;
  planos: Planos;
  agora: () => Date;
  log: (msg: string, extra?: unknown) => void;
  /** Endereço público do app (SINTONIA_URL_PUBLICA). Sem ele, usa o host da requisição. */
  urlPublica?: string;
}

/**
 * POST /webhooks/asaas                       aviso do Asaas (cabeçalho asaas-access-token)
 * GET  /api/conexoes/pagamentos              situação, URL e token do webhook (gera o token na 1ª vez)
 * POST /api/conexoes/pagamentos/testar       confere a chave
 * POST /api/conexoes/pagamentos/token        gera outro token do webhook
 */
export function registrarAsaas(app: FastifyInstance, o: OpcoesRotasAsaas): void {
  const c = o.conexoes;

  app.post('/webhooks/asaas', async (req, reply) => {
    if (!tokenConfere(req.headers['asaas-access-token'], c.get('asaasWebhookToken'))) {
      o.log('Webhook do Asaas recusado: token inválido ou não configurado');
      return reply.code(401).send({ erro: 'Token inválido' });
    }
    const aviso = AvisoAsaas.safeParse(req.body);
    if (!aviso.success) {
      o.log('Webhook do Asaas com formato inesperado; ignorado');
      return { ok: true, ignorado: true };
    }
    const { event, payment } = aviso.data;
    // Outros eventos (cobrança criada, vencida, estornada...) só respondem 200 para a fila do Asaas não parar.
    if (!EVENTOS_PAGO.has(event)) return { ok: true, ignorado: true };
    const ref = payment?.externalReference;
    if (!ref) {
      o.log('Pagamento do Asaas sem referência do pedido; ignorado', { evento: event, cobranca: payment?.id });
      return { ok: true, ignorado: true };
    }
    const pedido = await o.planos.armazem.pedidoPorId(ref);
    if (!pedido) {
      o.log('Pagamento do Asaas para um pedido que não existe aqui; ignorado', { evento: event, pedido: ref, cobranca: payment?.id });
      return { ok: true, ignorado: true };
    }
    if (pedido.status !== 'pendente') {
      o.log(`Pagamento do Asaas repetido: o pedido já estava ${pedido.status}; nada muda`, { evento: event, pedido: ref });
      return { ok: true, jaConfirmado: true };
    }
    const esperado = Number(pedido.dados.valor ?? 0);
    if (esperado > 0 && typeof payment?.value === 'number' && payment.value + 0.01 < esperado) {
      o.log('Pagamento do Asaas com valor menor que o do pedido; não liberado', { pedido: ref, pago: payment.value, esperado });
      return { ok: true, ignorado: true };
    }
    const p = await o.planos.confirmarPedido(pedido.empresaId, pedido.id, o.agora(), 'Asaas');
    if (p) o.log('Pagamento confirmado pelo Asaas: pedido liberado', { evento: event, pedido: ref, tipo: p.tipo });
    else o.log('Pagamento do Asaas repetido: o pedido já tinha sido confirmado; nada muda', { evento: event, pedido: ref });
    return { ok: true, confirmado: Boolean(p) };
  });

  const exigir = (req: FastifyRequest) => {
    const u = req.usuario;
    if (!u || !['admin', 'direcao'].includes(u.papel)) throw Object.assign(new Error('Só a administração mexe nos pagamentos.'), { statusCode: 403 });
    return u;
  };
  const base = (req: FastifyRequest) => {
    if (o.urlPublica) return o.urlPublica.replace(/\/+$/, '');
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    return `${/^(localhost|127\.)/.test(host) ? 'http' : 'https'}://${host}`;
  };

  app.get('/api/conexoes/pagamentos', async (req) => {
    const u = exigir(req);
    if (!c.get('asaasWebhookToken')) await c.salvar({ asaasWebhookToken: novoTokenAsaas() }, u.email || u.nome);
    return {
      ativo: o.asaas.ativo,
      ambiente: o.asaas.ativo ? (o.asaas.sandbox ? 'sandbox' : 'producao') : null,
      webhookUrl: `${base(req)}/webhooks/asaas`,
      webhookToken: c.get('asaasWebhookToken') ?? '',
      cpfCnpjOk: documentoValido(soDigitos(c.get('cobrancaCpfCnpj'))),
    };
  });

  app.post('/api/conexoes/pagamentos/testar', async (req) => {
    exigir(req);
    if (!o.asaas.ativo) return { ok: false, erro: 'Chave do Asaas não preenchida' };
    try {
      return { ok: true, ...(await o.asaas.testar()) };
    } catch (e) {
      return { ok: false, erro: String((e as Error).message ?? e).slice(0, 300) };
    }
  });

  app.post('/api/conexoes/pagamentos/token', async (req) => {
    const u = exigir(req);
    await c.salvar({ asaasWebhookToken: novoTokenAsaas() }, u.email || u.nome);
    return { webhookToken: c.get('asaasWebhookToken') };
  });
}
