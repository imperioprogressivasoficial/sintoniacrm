import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemMemoria, Conexoes, type ValoresConexao } from '../src/conexoes/conexoes.js';
import { ArmazemPlanosMemoria, ArmazemPlanosPostgres, type ArmazemPlanos } from '../src/planos/armazem.js';
import { ASAAS_PRODUCAO, ASAAS_SANDBOX, PagamentoAsaas, PagamentoEscolhido, registrarAsaas, tokenConfere } from '../src/planos/asaas.js';
import { Planos } from '../src/planos/porteiro.js';
import { registrarPlanos } from '../src/planos/rotas.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const agora = bahia(2026, 11, 20, 10);
const EMP = 'loja-asaas';
const TOKEN = 'token-do-webhook-123';

interface Chamada {
  url: string;
  metodo: string;
  headers: Record<string, string>;
  corpo: unknown;
}

/** fetch falso do Asaas: guarda as chamadas e responde conforme a rota. */
function asaasFalso(opc: { clienteExiste?: boolean; status?: number } = {}) {
  const chamadas: Chamada[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const c: Chamada = { url, metodo: init.method ?? 'GET', headers: init.headers as Record<string, string>, corpo: init.body ? JSON.parse(String(init.body)) : undefined };
    chamadas.push(c);
    const resp = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (opc.status) return resp(opc.status, { errors: [{ code: 'x', description: 'Algo errado no Asaas.' }] });
    const caminho = url.replace(/^https:\/\/[^/]+\/v3/, '');
    if (caminho.startsWith('/customers?')) return resp(200, { data: opc.clienteExiste ? [{ id: 'cus_existente' }] : [] });
    if (caminho === '/customers') return resp(200, { id: 'cus_novo' });
    if (caminho === '/payments') return resp(200, { id: 'pay_1', invoiceUrl: 'https://www.asaas.com/i/pay_1' });
    if (caminho === '/finance/balance') return resp(200, { balance: 0 });
    return resp(404, {});
  }) as unknown as typeof fetch;
  return { chamadas, fetchFn };
}

async function montar(valores: ValoresConexao = {}, armazem: ArmazemPlanos = new ArmazemPlanosMemoria(), opc: Parameters<typeof asaasFalso>[0] = {}) {
  const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('s'));
  await conexoes.salvar(valores, 'teste');
  const falso = asaasFalso(opc);
  const logs: string[] = [];
  const asaas = new PagamentoAsaas({ conexoes, nomeEmpresa: async () => 'Império Progressivas', fetchFn: falso.fetchFn, agora: () => agora, log: (m) => logs.push(m) });
  const pagamento = new PagamentoEscolhido(asaas);
  const planos = new Planos({ armazem, fundadoras: [] });
  await armazem.gravarAssinatura({ empresaId: EMP, plano: 'essencial', status: 'ativa', atualizadaEm: agora, atualizadaPor: 'teste' });
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    (req as { usuario?: unknown }).usuario = { id: 'u1', nome: 'Bruno', email: 'bruno@teste.com', empresaId: EMP, papel: 'admin' };
  });
  registrarAsaas(app, { asaas, conexoes, planos, agora: () => agora, log: (m) => logs.push(m) });
  registrarPlanos(app, { planos, pagamento, empresaId: EMP, agora: () => agora });
  return { app, conexoes, asaas, pagamento, planos, logs, ...falso };
}

const pedirRecarga = (app: Awaited<ReturnType<typeof montar>>['app'], extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/planos/pedidos', payload: { tipo: 'recarga', recargaId: 'r5', ...extra } });
const aviso = (app: Awaited<ReturnType<typeof montar>>['app'], evento: string, ref: string, token = TOKEN, valor = 99) =>
  app.inject({ method: 'POST', url: '/webhooks/asaas', headers: { 'asaas-access-token': token }, payload: { id: 'evt_1', event: evento, payment: { id: 'pay_1', externalReference: ref, value: valor } } });

describe('escolha do pagamento', () => {
  it('sem chave: manual (nada muda); com chave: Asaas, sem reiniciar', async () => {
    const { pagamento, conexoes, app } = await montar();
    expect(pagamento.nome).toBe('manual');
    expect(pagamento.ativo).toBe(false);
    const r = await pedirRecarga(app);
    expect(r.json()).toMatchObject({ pagamentoAtivo: false, pedido: { status: 'pendente' } });
    expect(r.json().url).toBeUndefined();
    expect(r.json().mensagem).toContain('Em breve');

    await conexoes.salvar({ asaasApiKey: '$aact_prod_abc' }, 'teste');
    expect(pagamento.nome).toBe('asaas');
    expect(pagamento.ativo).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/planos' })).json().pagamento).toEqual({ provedor: 'asaas', ativo: true });
  });

  it('produção ou sandbox pela chave ou pela opção da tela', async () => {
    const prod = await montar({ asaasApiKey: '$aact_prod_abc', cobrancaCpfCnpj: '12345678901' });
    await prod.app.inject({ method: 'POST', url: '/api/conexoes/pagamentos/testar' });
    expect(prod.chamadas[0]!.url).toBe(`${ASAAS_PRODUCAO}/finance/balance`);
    const hmlg = await montar({ asaasApiKey: '$aact_hmlg_abc' });
    expect((await hmlg.app.inject({ method: 'POST', url: '/api/conexoes/pagamentos/testar' })).json()).toMatchObject({ ok: true, mensagem: expect.stringContaining('sandbox') });
    expect(hmlg.chamadas[0]!.url).toBe(`${ASAAS_SANDBOX}/finance/balance`);
    const flag = await montar({ asaasApiKey: '$aact_abc', asaasSandbox: '1' });
    await flag.app.inject({ method: 'POST', url: '/api/conexoes/pagamentos/testar' });
    expect(flag.chamadas[0]!.url.startsWith(ASAAS_SANDBOX)).toBe(true);
  });
});

describe('cobrança no Asaas', () => {
  it('cria o cliente e a cobrança e devolve o link', async () => {
    const { app, chamadas, planos } = await montar({ asaasApiKey: '$aact_prod_abc', cobrancaCpfCnpj: '12.345.678/0001-90', cobrancaEmail: 'financeiro@loja.com' });
    const r = await pedirRecarga(app);
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ url: 'https://www.asaas.com/i/pay_1', pagamentoAtivo: true, pedido: { status: 'pendente' } });
    expect(chamadas.map((c) => `${c.metodo} ${c.url.replace(ASAAS_PRODUCAO, '')}`)).toEqual(['GET /customers?cpfCnpj=12345678000190&limit=1', 'POST /customers', 'POST /payments']);
    expect(chamadas[0]!.headers.access_token).toBe('$aact_prod_abc');
    expect(chamadas[1]!.corpo).toEqual({ name: 'Império Progressivas', cpfCnpj: '12345678000190', email: 'financeiro@loja.com' });
    expect(chamadas[2]!.corpo).toEqual({ customer: 'cus_novo', billingType: 'UNDEFINED', value: 99, dueDate: '2026-11-23', description: expect.stringMatching(/^Sintonia: Créditos/), externalReference: j.pedido.id });
    expect(await planos.armazem.pedidos(EMP)).toHaveLength(1);
  });

  it('reaproveita o cliente que já existe no Asaas', async () => {
    const { app, chamadas } = await montar({ asaasApiKey: '$aact_prod_abc', cobrancaCpfCnpj: '12345678901' }, undefined, { clienteExiste: true });
    await pedirRecarga(app);
    expect(chamadas.map((c) => c.metodo + ' ' + c.url.replace(ASAAS_PRODUCAO, '').split('?')[0])).toEqual(['GET /customers', 'POST /payments']);
    expect((chamadas[1]!.corpo as { customer: string }).customer).toBe('cus_existente');
  });

  it('sem CPF/CNPJ: pede antes de registrar; com o documento, guarda e cobra', async () => {
    const { app, chamadas, planos, conexoes, asaas } = await montar({ asaasApiKey: '$aact_prod_abc' });
    const r = await pedirRecarga(app);
    expect(r.json()).toMatchObject({ pedido: null, precisaCpfCnpj: true, pagamentoAtivo: true });
    expect(r.json().mensagem).toContain('CPF ou o CNPJ');
    expect(chamadas).toHaveLength(0);
    expect(await planos.armazem.pedidos(EMP)).toHaveLength(0);
    // O próprio provedor também responde com a mensagem se chamado sem documento.
    const direto = await asaas.iniciar({ id: 'x', empresaId: EMP, tipo: 'recarga', dados: {}, status: 'pendente', criadoEm: agora, pagoEm: null, por: null }, 99, 'Créditos');
    expect(direto).toMatchObject({ precisaCpfCnpj: true });
    expect(direto.url).toBeUndefined();

    expect((await pedirRecarga(app, { cpfCnpj: '123' })).statusCode).toBe(400);
    const ok = await pedirRecarga(app, { cpfCnpj: '123.456.789-01' });
    expect(ok.json().url).toBe('https://www.asaas.com/i/pay_1');
    expect(conexoes.get('cobrancaCpfCnpj')).toBe('12345678901');
  });

  it('erro do Asaas não derruba a tela: o pedido fica registrado com a explicação', async () => {
    const { app } = await montar({ asaasApiKey: '$aact_prod_abc', cobrancaCpfCnpj: '12345678901' }, undefined, { status: 400 });
    const r = await pedirRecarga(app);
    expect(r.statusCode).toBe(200);
    expect(r.json().url).toBeUndefined();
    expect(r.json().mensagem).toContain('Algo errado no Asaas');
  });

  it('chave recusada no Testar', async () => {
    const { app } = await montar({ asaasApiKey: '$aact_prod_ruim' }, undefined, { status: 401 });
    expect((await app.inject({ method: 'POST', url: '/api/conexoes/pagamentos/testar' })).json()).toMatchObject({ ok: false, erro: expect.stringContaining('recusou a chave') });
  });
});

describe('webhook do Asaas', () => {
  it('token errado ou ausente: 401; sem token configurado: 401', async () => {
    const semToken = await montar({ asaasApiKey: '$aact_prod_abc' });
    expect((await aviso(semToken.app, 'PAYMENT_RECEIVED', 'x', '')).statusCode).toBe(401);
    expect((await aviso(semToken.app, 'PAYMENT_RECEIVED', 'x', 'qualquer')).statusCode).toBe(401);
    const { app } = await montar({ asaasApiKey: '$aact_prod_abc', asaasWebhookToken: TOKEN });
    expect((await aviso(app, 'PAYMENT_RECEIVED', 'x', 'token-errado')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/webhooks/asaas', payload: { event: 'PAYMENT_RECEIVED' } })).statusCode).toBe(401);
    expect(tokenConfere(TOKEN, TOKEN)).toBe(true);
    expect(tokenConfere(TOKEN + 'x', TOKEN)).toBe(false);
  });

  it('outros eventos e pedidos desconhecidos respondem 200 sem mexer em nada', async () => {
    const { app } = await montar({ asaasApiKey: '$aact_prod_abc', asaasWebhookToken: TOKEN });
    expect((await aviso(app, 'PAYMENT_CREATED', 'x')).json()).toMatchObject({ ok: true, ignorado: true });
    expect((await aviso(app, 'PAYMENT_RECEIVED', '00000000-0000-0000-0000-000000000000')).json()).toMatchObject({ ok: true, ignorado: true });
  });

  async function confirmacaoUmaVez(armazem: ArmazemPlanos) {
    const { app, planos, logs } = await montar({ asaasApiKey: '$aact_prod_abc', asaasWebhookToken: TOKEN, cobrancaCpfCnpj: '12345678901' }, armazem);
    const ped = (await pedirRecarga(app)).json().pedido;
    expect((await planos.situacao(EMP, agora)).creditos.comprados).toBe(0);
    // Cartão: chega PAYMENT_CONFIRMED e depois PAYMENT_RECEIVED; o Asaas também reenvia.
    expect((await aviso(app, 'PAYMENT_CONFIRMED', ped.id)).json()).toMatchObject({ ok: true, confirmado: true });
    expect((await aviso(app, 'PAYMENT_RECEIVED', ped.id)).json()).toMatchObject({ ok: true, jaConfirmado: true });
    expect((await aviso(app, 'PAYMENT_RECEIVED', ped.id)).statusCode).toBe(200);
    expect((await planos.situacao(EMP, agora)).creditos.comprados).toBe(ped.dados.tokens);
    const [p] = await planos.armazem.pedidos(EMP);
    expect(p).toMatchObject({ status: 'pago' });
    // Confirmação direta repetida (corrida entre dois avisos) também não aplica de novo.
    expect(await planos.confirmarPedido(EMP, ped.id, agora)).toBeNull();
    expect(logs.some((l) => l.includes('Pagamento confirmado pelo Asaas'))).toBe(true);
    expect(logs.some((l) => l.includes('repetido'))).toBe(true);
  }

  it('confirma o pedido uma vez só (memória)', () => confirmacaoUmaVez(new ArmazemPlanosMemoria()));
  it.skipIf(!temPostgres)('confirma o pedido uma vez só (Postgres)', async () => {
    const pool = await poolDeTeste();
    for (const t of ['ia_pedidos', 'ia_uso', 'ia_assinaturas']) await pool.query(`delete from sintonia.${t} where empresa_id = $1`, [EMP]);
    await confirmacaoUmaVez(new ArmazemPlanosPostgres(pool));
  });

  it('mudar de plano pago troca o plano', async () => {
    const { app, planos } = await montar({ asaasApiKey: '$aact_prod_abc', asaasWebhookToken: TOKEN, cobrancaCpfCnpj: '12345678901' });
    const r = (await app.inject({ method: 'POST', url: '/api/planos/pedidos', payload: { tipo: 'mudar_plano', plano: 'expediente' } })).json();
    expect(r.url).toBeTruthy();
    expect((await aviso(app, 'PAYMENT_RECEIVED', r.pedido.id, TOKEN, 1997)).json()).toMatchObject({ confirmado: true });
    expect((await planos.assinatura(EMP)).plano).toBe('expediente');
  });

  it('valor pago menor que o do pedido não libera', async () => {
    const { app, planos } = await montar({ asaasApiKey: '$aact_prod_abc', asaasWebhookToken: TOKEN, cobrancaCpfCnpj: '12345678901' });
    const ped = (await pedirRecarga(app)).json().pedido;
    expect((await aviso(app, 'PAYMENT_RECEIVED', ped.id, TOKEN, 1)).json()).toMatchObject({ ignorado: true });
    expect((await planos.armazem.pedidos(EMP))[0]).toMatchObject({ status: 'pendente' });
  });

  it('a tela de Conexões recebe a URL e gera o token na primeira vez', async () => {
    const { app, conexoes } = await montar();
    const j = (await app.inject({ method: 'GET', url: '/api/conexoes/pagamentos', headers: { host: 'app.exemplo.com' } })).json();
    expect(j).toMatchObject({ ativo: false, ambiente: null, webhookUrl: 'https://app.exemplo.com/webhooks/asaas', cpfCnpjOk: false });
    expect(j.webhookToken).toBe(conexoes.get('asaasWebhookToken'));
    expect(j.webhookToken.length).toBeGreaterThan(20);
    const novo = (await app.inject({ method: 'POST', url: '/api/conexoes/pagamentos/token' })).json();
    expect(novo.webhookToken).not.toBe(j.webhookToken);
  });
});
