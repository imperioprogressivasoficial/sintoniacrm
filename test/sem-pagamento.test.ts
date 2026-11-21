import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { ArmazemPerfisMemoria, ArmazemPerfisPostgres, emailExcluido, NOME_EXCLUIDO, registrarConta, type ArmazemPerfis } from '../src/conta/conta.js';
import { contatoDoAmbiente, normalizarEmail, normalizarWhatsapp, registrarPublico, ROTAS_CADASTRO, type ContatoPublico } from '../src/publico/publico.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

/* sem-pagamento: nada se compra pelo app, ninguém cria conta sozinho, contato pelo WhatsApp e excluir a própria conta. */

const SENHA = 'Imperio2026xyz';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b00000000049454e44ae426082', 'hex');

interface Ambiente {
  nome: string;
  criar(): Promise<{ contas: Contas; perfis: ArmazemPerfis }>;
}
const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ contas: new ContasMemoria(), perfis: new ArmazemPerfisMemoria() }) },
  ...(temPostgres
    ? [{ nome: 'postgres', criar: async () => { const pool = await poolDeTeste(); return { contas: new ContasPostgres(pool), perfis: new ArmazemPerfisPostgres(pool) }; } }]
    : []),
];

async function montar(contato?: ContatoPublico, base?: { contas: Contas; perfis: ArmazemPerfis }) {
  const { contas, perfis } = base ?? { contas: new ContasMemoria(), perfis: new ArmazemPerfisMemoria() };
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const hash = await gerarHash(SENHA);
  const criar = (nome: string, email: string, papel: 'admin' | 'atendente' | 'direcao') => contas.criarUsuario({ empresaId: 'imperio', nome, email, papel, unidades: [], senhaHash: hash });
  const bruno = await criar('Bruno Batista', 'bruno@imperio.com', 'admin');
  const carla = await criar('Carla Lima', 'carla@imperio.com', 'atendente');
  const app = criarServidor({ sintonia, repo, auth: { contas, agora: () => new Date(), duracaoHoras: 12 } });
  registrarConta(app, { contas, perfis });
  registrarPublico(app, contato ? { contato } : {});
  const entrar = async (email: string, senha = SENHA) => app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha } });
  const cookie = async (email: string) => String((await entrar(email)).headers['set-cookie']).split(';')[0]!;
  return { app, contas, perfis, bruno, carla, entrar, cookie, criar };
}

describe('contato público (WhatsApp de vendas)', () => {
  it('número só com dígitos; número brasileiro sem 55 ganha o 55; inválido vira vazio', () => {
    expect(normalizarWhatsapp('+55 (71) 99999-8888')).toBe('5571999998888');
    expect(normalizarWhatsapp('71 99999-8888')).toBe('5571999998888');
    expect(normalizarWhatsapp('7133334444')).toBe('557133334444');
    expect(normalizarWhatsapp('')).toBe('');
    expect(normalizarWhatsapp(undefined)).toBe('');
    expect(normalizarWhatsapp('123')).toBe('');
    expect(normalizarEmail('contato@sintonia.com.br')).toBe('contato@sintonia.com.br');
    expect(normalizarEmail('nada')).toBe('');
    expect(contatoDoAmbiente({ SINTONIA_WHATSAPP_VENDAS: '(71) 98888-7777' })).toMatchObject({ whatsapp: '5571988887777', email: '' });
    expect(contatoDoAmbiente({})).toMatchObject({ whatsapp: '', email: '' });
  });

  it('GET /api/publico/contato funciona sem login e devolve o número configurado', async () => {
    const { app } = await montar({ whatsapp: '5571999998888', email: 'oi@sintonia.com', mensagem: 'Olá! Quero conhecer a Sintonia.' });
    const r = await app.inject({ url: '/api/publico/contato' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ whatsapp: '5571999998888', email: 'oi@sintonia.com', mensagem: 'Olá! Quero conhecer a Sintonia.' });
  });

  it('sem número configurado: devolve null (a página cai no e-mail ou na página de suporte)', async () => {
    const { app } = await montar({ whatsapp: '', email: '', mensagem: 'Olá!' });
    expect((await app.inject({ url: '/api/publico/contato' })).json()).toMatchObject({ whatsapp: null, email: null });
  });
});

describe('ninguém cria conta sozinho', () => {
  it('toda rota de cadastro recusa com 403 e aponta o WhatsApp (sem pedir login)', async () => {
    const { app, contas } = await montar({ whatsapp: '5571999998888', email: '', mensagem: 'Olá!' });
    for (const url of ROTAS_CADASTRO) {
      const r = await app.inject({ method: 'POST', url, payload: { nome: 'Fulana', email: 'fulana@x.com', senha: 'Senha2026forte' } });
      expect(r.statusCode, url).toBe(403);
      expect(r.json()).toMatchObject({ semCadastro: true, whatsapp: '5571999998888', erro: expect.stringContaining('WhatsApp') });
    }
    expect(await contas.buscarPorEmail('fulana@x.com')).toBeUndefined();
  });

  it('a tela de entrar não tem "Criar conta": tem "Fale com a gente no WhatsApp" e os links legais', () => {
    const html = readFileSync(new URL('../public/entrar.html', import.meta.url), 'utf8');
    expect(html).not.toMatch(/criar conta|cadastre-se|cadastrar/i);
    expect(html).toContain('data-whats');
    expect(html).toContain('Fale com a gente no WhatsApp');
    for (const p of ['/privacidade', '/termos', '/suporte']) expect(html).toContain(`href="${p}"`);
  });
});

describe('nada se compra pelo app', () => {
  it('plano, pedidos, créditos, comparativo e pagamentos (Asaas) respondem 410', async () => {
    const { app, cookie } = await montar();
    const c = await cookie('bruno@imperio.com');
    const chamadas: Array<[string, string]> = [
      ['GET', '/api/planos'],
      ['POST', '/api/planos/pedidos'],
      ['PUT', '/api/planos/custo-clt'],
      ['GET', '/api/planos/comparativo'],
      ['GET', '/api/conexoes/pagamentos'],
      ['POST', '/api/conexoes/pagamentos/testar'],
      ['POST', '/api/conexoes/pagamentos/token'],
    ];
    for (const [method, url] of chamadas) {
      const r = await app.inject({ method: method as 'GET', url, headers: { cookie: c }, payload: method === 'GET' ? undefined : { tipo: 'recarga', recargaId: 'r5' } });
      expect(r.statusCode, url).toBe(410);
      expect(r.json()).toMatchObject({ desligado: true });
    }
    // O aviso de pagamento do Asaas também não faz nada.
    const w = await app.inject({ method: 'POST', url: '/webhooks/asaas', payload: { event: 'PAYMENT_RECEIVED', payment: { externalReference: 'x', value: 99 } } });
    expect(w.statusCode).toBe(410);
    // Sem login continua pedindo login (não vaza nada).
    expect((await app.inject({ url: '/api/planos' })).statusCode).toBe(401);
  });

  it('páginas sem preço, plano nem compra; app sem a tela de plano', () => {
    const ler = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    const vendas = ler('index.html');
    expect(vendas).not.toMatch(/R\$ ?1\.997|R\$ ?497|Começar grátis|Ver planos|id="planos"|Contratar|data-lead|calculadora-ia/);
    expect(vendas).toContain('data-whats');
    expect(vendas).toContain('/contato-publico.js');
    for (const p of ['/privacidade', '/termos', '/suporte']) expect(vendas).toContain(`href="${p}"`);
    const app = ler('app.html');
    expect(app).not.toMatch(/telas\/planos\.js|Plano e uso da IA|v-planos/);
    const conta = ler('telas/conta.js');
    expect(conta).not.toMatch(/'Faturamento'|\/api\/planos|Saldo de créditos/);
    expect(conta).toContain('/api/conta/excluir');
    const conexoes = ler('conexoes.html');
    expect(conexoes).not.toMatch(/asaas|Comprar créditos|cobrança/i);
  });

  it('páginas de privacidade, termos e suporte abertas a todos', async () => {
    const { app } = await montar();
    for (const [url, texto] of [['/privacidade', 'LGPD'], ['/termos', 'Termos de uso'], ['/suporte', 'Deixe um recado']] as const) {
      const r = await app.inject({ url });
      expect(r.statusCode, url).toBe(200);
      expect(r.headers['content-type']).toContain('text/html');
      expect(r.body).toContain(texto);
      expect(r.body).toContain('/contato-publico.js');
    }
    expect((await app.inject({ url: '/contato-publico.js' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/telas/planos.js' })).statusCode).toBe(404);
  });
});

for (const amb of ambientes) {
  describe(`excluir a própria conta (${amb.nome})`, () => {
    it('pede EXCLUIR; apaga os dados pessoais, desliga o login e encerra as sessões', async () => {
      const base = await amb.criar();
      const { app, contas, perfis, carla, cookie, entrar } = await montar(undefined, base);
      const c = await cookie('carla@imperio.com');
      await app.inject({ method: 'PATCH', url: '/api/conta', headers: { cookie: c }, payload: { telefone: '(71) 99999-0000' } });
      await contas.salvarFotoDe(carla.id, { conteudo: PNG, tipo: 'image/png' }, new Date());
      const outro = await cookie('carla@imperio.com'); // segundo aparelho

      const sem = await app.inject({ method: 'POST', url: '/api/conta/excluir', headers: { cookie: c }, payload: { confirmacao: 'sim' } });
      expect(sem.statusCode).toBe(400);
      expect(sem.json().erro).toContain('EXCLUIR');
      expect((await contas.buscarPorId(carla.id))!.ativo).toBe(true);

      const r = await app.inject({ method: 'POST', url: '/api/conta/excluir', headers: { cookie: c }, payload: { confirmacao: 'excluir' } });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true });
      expect(String(r.headers['set-cookie'])).toContain('Max-Age=0');

      const u = (await contas.buscarPorId(carla.id))!;
      expect(u).toMatchObject({ ativo: false, nome: NOME_EXCLUIDO, email: emailExcluido(carla.id) });
      expect(await contas.fotoDe(carla.id)).toBeUndefined();
      expect((await perfis.ler(carla.id)).telefone).toBe('');
      // Nenhuma sessão vale mais e a senha antiga não entra.
      expect((await app.inject({ url: '/api/auth/eu', headers: { cookie: c } })).statusCode).toBe(401);
      expect((await app.inject({ url: '/api/auth/eu', headers: { cookie: outro } })).statusCode).toBe(401);
      expect((await entrar('carla@imperio.com')).statusCode).toBe(401);
      // O e-mail real fica livre (a administração pode convidar de novo no futuro).
      expect(await contas.buscarPorEmail('carla@imperio.com')).toBeUndefined();
    });

    it('a única pessoa com acesso de administração não pode se excluir; com outra admin, pode', async () => {
      const base = await amb.criar();
      const { app, contas, bruno, cookie, criar } = await montar(undefined, base);
      const c = await cookie('bruno@imperio.com');
      const r = await app.inject({ method: 'POST', url: '/api/conta/excluir', headers: { cookie: c }, payload: { confirmacao: 'EXCLUIR' } });
      expect(r.statusCode).toBe(409);
      expect(r.json().erro).toContain('única pessoa com acesso de administração');
      expect((await contas.buscarPorId(bruno.id))!.ativo).toBe(true);

      await criar('Ana Souza', 'ana@imperio.com', 'admin');
      const ok = await app.inject({ method: 'POST', url: '/api/conta/excluir', headers: { cookie: c }, payload: { confirmacao: 'EXCLUIR' } });
      expect(ok.statusCode).toBe(200);
      expect((await contas.buscarPorId(bruno.id))!).toMatchObject({ ativo: false, nome: NOME_EXCLUIDO });
    });

    it('sem login não exclui ninguém', async () => {
      const base = await amb.criar();
      const { app } = await montar(undefined, base);
      expect((await app.inject({ method: 'POST', url: '/api/conta/excluir', payload: { confirmacao: 'EXCLUIR' } })).statusCode).toBe(401);
    });
  });
}
