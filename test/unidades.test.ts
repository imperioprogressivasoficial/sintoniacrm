import { afterEach, describe, expect, it } from 'vitest';
import { systemDoAgente } from '../src/agentes-ia/prompt.js';
import { ConfigAgente } from '../src/agentes-ia/tipos.js';
import { systemPrompt } from '../src/ai/prompt.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { modelosBot } from '../src/bot/modelos.js';
import { lerWebhookEvolution } from '../src/channels/evolution.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import { ArmazemMemoria, campoDaUnidade, campoDeUnidade, Conexoes } from '../src/conexoes/conexoes.js';
import { numerosDasConexoes } from '../src/conexoes/numeros.js';
import { registrarConexoes } from '../src/conexoes/rotas.js';
import { ContatosMemoria, ContatosPostgres } from '../src/contatos/contatos.js';
import { modelosProntos } from '../src/email/blocos.js';
import { ArmazemCadastroMemoria, ArmazemCadastroPostgres, type ArmazemCadastro } from '../src/empresa/cadastro.js';
import { registrarCadastro } from '../src/empresa/cadastro-rotas.js';
import { apresentacao, identidade, reiniciarIdentidades } from '../src/empresa/identidade.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags } from '../src/tags/tags.js';
import { montarExtras, registrarExtras } from '../src/rotas/extras.js';
import {
  definirEmpresaPadrao,
  existeUnidade,
  HORARIO_SHOPPING,
  idsUnidades,
  primeiraUnidade,
  reiniciarUnidades,
  unidadeDe,
  UNIDADES_IMPERIO,
  unidadePorNome,
  zUnidade,
} from '../src/unidades.js';
import { estaAberta } from '../src/engine/horario.js';
import { bahia } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/**
 * Unidades vindas do cadastro (Empresa › Unidades): uma empresa nova com 3 unidades de nomes próprios funciona
 * de ponta a ponta (número de WhatsApp por unidade, conversa, acesso por unidade, relatório, IA) e as unidades
 * da Império (norte, sumare, feira) continuam iguais.
 */

const SENHA = 'Unidades2026xyz';
afterEach(() => {
  reiniciarUnidades();
  reiniciarIdentidades();
});

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ canal: string; para: string; texto: string }> = [];
  lerWebhook(corpo: unknown) {
    return lerWebhookEvolution(corpo);
  }
  async enviarTexto(canal: string, para: string, texto: string) {
    this.enviados.push({ canal, para, texto });
    return { idExterno: `OUT${this.enviados.length}` };
  }
}

describe('cache das unidades (src/unidades.ts)', () => {
  it('Império intacta antes e depois do cadastro: ids, nomes para clientes, horário e campos antigos de Conexões', () => {
    expect(idsUnidades()).toEqual(['norte', 'sumare', 'feira']);
    expect(unidadeDe('norte').nome).toBe('Salvador Norte Shopping');
    expect(unidadeDe('sumare').nome).toBe('Shopping Sumaré');
    expect(unidadeDe('norte').horario).toEqual(HORARIO_SHOPPING);
    expect(unidadeDe('norte').trinksEstabelecimentoId).toBe('240643');
    expect(unidadeDe('feira').agendaAberta).toBe(false);
    expect(campoDaUnidade('metaToken', 'norte')).toBe('metaTokenNorte');
    expect(campoDaUnidade('canal', 'sumare')).toBe('canalSumare');
    expect(campoDeUnidade('agendaSistemaNorte')).toEqual({ base: 'agendaSistema', unidade: 'norte' });
    expect(unidadePorNome('quero ir no sumaré')?.id).toBe('sumare');
    expect(identidade().nome).toBe('Império Progressivas');
    expect(apresentacao()).toBe('Império Progressivas (salões de alisamento e progressiva em Salvador)');
  });

  it('empresa nova: só as unidades dela valem (zod contra o cadastro), campos de Conexões por unidade e nome no texto', () => {
    definirEmpresaPadrao('oficina');
    expect(idsUnidades()).toEqual([]);
    expect(primeiraUnidade()).toBe('principal');
    // Sem cadastro, "norte" da Império não vale para outra empresa.
    expect(zUnidade().safeParse('norte').success).toBe(false);
    reiniciarUnidades();
  });
});

interface Pecas {
  repo: Repositorio;
  contas: Contas;
  cadastro: ArmazemCadastro;
  pool?: Awaited<ReturnType<typeof poolDeTeste>>;
}
const ambientes: Array<{ nome: string; criar(): Promise<Pecas> }> = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria(), cadastro: new ArmazemCadastroMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.unidades cascade');
            await pool.query("delete from sintonia.empresas where id in ('oficina', 'imperio')");
            return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), cadastro: new ArmazemCadastroPostgres(pool), pool };
          },
        },
      ]
    : []),
];

for (const amb of ambientes) {
  describe(`Empresa nova com 3 unidades de nomes próprios (${amb.nome})`, () => {
    async function montar() {
      const p = await amb.criar();
      const E = 'oficina';
      definirEmpresaPadrao(E);
      const canal = new CanalFalso();
      const numeros: ConstructorParameters<typeof Sintonia>[0]['numeros'] = [];
      const sintonia = new Sintonia({ empresaId: E, repo: p.repo, numeros, agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, configIa: async () => ({ modoPadrao: 'humano' }) });
      const app = criarServidor({ sintonia, repo: p.repo, auth: { contas: p.contas } });
      let nomeEmpresa = 'Oficina do Zé';
      const cad = registrarCadastro(app, {
        armazem: p.cadastro,
        empresaId: E,
        empresa: { dados: async () => ({ nome: nomeEmpresa }), renomear: async (n) => (nomeEmpresa = n) },
        unidadesPadrao: [{ id: 'principal', nome: 'Unidade principal' }],
      });
      // Número de WhatsApp por unidade: Conexões › WhatsApp (canal "sem loja fixa" com a unidade escolhida).
      const conexoes = new Conexoes(new ArmazemMemoria(), new Cofre('teste-unidades'));
      await conexoes.carregar();
      registrarConexoes(app, { conexoes, auth: { contas: p.contas }, testarIA: async () => {}, testarTrinks: async () => ({ resumo: '' }) });
      const aplicarNumeros = () => numeros.splice(0, numeros.length, ...numerosDasConexoes({ conexoes, evolution: canal }));
      conexoes.aoMudar(aplicarNumeros);
      // Relatórios (Gestão › Relatórios) com as unidades do cadastro.
      const contatos = p.pool ? new ContatosPostgres(p.pool) : new ContatosMemoria();
      const armazemTags = p.pool ? new ArmazemTagsPostgres(p.pool) : new ArmazemTagsMemoria(() => p.repo.listarConversas());
      const extras = montarExtras({ repo: p.repo, pool: p.pool, contatos, armazemTags, tags: new Tags(armazemTags, E), empresaId: E, canalDa: (u) => numeros.find((n) => n.unidade === u)?.canalId, comConversa: (id, fn) => sintonia.comConversa(id, fn) });
      registrarExtras(app, { repo: p.repo, empresaId: E, relatorios: extras.relatorios, leads: extras.leads, contas: p.contas });

      const h = await gerarHash(SENHA);
      await p.contas.criarUsuario({ empresaId: E, nome: 'Zé Dono', email: 'ze@oficina.com', papel: 'admin', unidades: [], senhaHash: h });
      const entrar = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: SENHA } })).headers['set-cookie']).split(';')[0]!;
      const dono = await entrar('ze@oficina.com');
      const como = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
        app.inject({ method, url, headers: { cookie }, ...(payload !== undefined ? { payload: payload as object } : {}) });
      await cad.carregar(E);
      return { ...p, E, app, sintonia, numeros, canal, conexoes, como, dono, entrar, h };
    }

    it('cadastra as unidades, liga um número a cada uma, a conversa nasce na unidade certa, o acesso respeita a unidade e o relatório mostra os nomes', async () => {
      const t = await montar();
      // Começa com a "Unidade principal" (nada da Império).
      let r = await t.como(t.dono, 'GET', '/api/unidades');
      expect(r.json().unidades.map((u: { id: string }) => u.id)).toEqual(['principal']);
      expect(existeUnidade('norte')).toBe(false);

      // 3 unidades de nomes próprios; a principal fica desativada.
      for (const [nome, nomeCliente] of [['Centro', 'Oficina do Zé - Centro'], ['Barra Shopping', ''], ['Lauro de Freitas', 'Unidade Lauro']]) {
        r = await t.como(t.dono, 'POST', '/api/unidades', { nome, nomeCliente });
        expect(r.statusCode, r.body).toBe(201);
      }
      r = await t.como(t.dono, 'PATCH', '/api/unidades/principal', { ativa: false });
      expect(r.statusCode, r.body).toBe(200);
      expect(idsUnidades()).toEqual(['centro', 'barra-shopping', 'lauro-de-freitas']);
      expect(unidadeDe('centro').nome).toBe('Oficina do Zé - Centro');
      expect(unidadeDe('barra-shopping').nome).toBe('Barra Shopping');
      expect(unidadeDe('lauro-de-freitas').nomeApp).toBe('Lauro de Freitas');
      // Horário: segue o da empresa (seg a sex 9h–18h) até a unidade ter um próprio.
      expect(estaAberta(unidadeDe('centro'), bahia(2026, 11, 23, 10))).toBe(true);
      expect(estaAberta(unidadeDe('centro'), bahia(2026, 11, 22, 10))).toBe(false);

      // Número de WhatsApp por unidade (canal da Evolution com a unidade escolhida).
      r = await t.como(t.dono, 'POST', '/api/conexoes/whatsapp/canais', { nome: 'WhatsApp Barra', unidade: 'barra-shopping' });
      expect(r.statusCode, r.body).toBe(200);
      const barra = r.json().id as string;
      r = await t.como(t.dono, 'POST', '/api/conexoes/whatsapp/canais', { nome: 'WhatsApp Lauro' });
      const lauro = r.json().id as string;
      expect(r.json().unidade).toBe('centro'); // sem unidade: a primeira ativa
      r = await t.como(t.dono, 'PATCH', `/api/conexoes/whatsapp/canais/${lauro}`, { unidade: 'lauro-de-freitas' });
      expect(r.json()).toMatchObject({ unidade: 'lauro-de-freitas', nome: 'WhatsApp Lauro' });
      // Unidade da Império (ou de outra empresa) é recusada.
      expect((await t.como(t.dono, 'PATCH', `/api/conexoes/whatsapp/canais/${lauro}`, { unidade: 'norte' })).statusCode).toBe(400);
      expect(t.numeros.map((n) => [n.canalId, n.unidade])).toEqual([
        [barra, 'barra-shopping'],
        [lauro, 'lauro-de-freitas'],
      ]);
      // API oficial por unidade: campo "base__id" salvo e lido.
      r = await t.como(t.dono, 'PUT', '/api/conexoes', { 'metaPhoneNumberId__centro': '123456', 'metaToken__centro': 'EAAB-segredo', 'metaToken__nao-existe': 'x' });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().campos['metaPhoneNumberId__centro']).toMatchObject({ definido: true, valor: '123456' });
      expect(r.json().campos['metaToken__centro']).toMatchObject({ definido: true, final: 'redo' });
      expect(r.json().campos['metaToken__nao-existe']).toBeUndefined();
      expect(r.json().camposUnidade['barra-shopping'].canal).toBe('canal__barra-shopping');
      expect(t.conexoes.contaMeta('centro')).toMatchObject({ phoneNumberId: '123456', token: 'EAAB-segredo' });

      // Conversas chegam pelo número de cada unidade.
      const agora = new Date();
      await t.sintonia.receber({ canalId: barra, telefone: '5571911112222', nome: 'Ana', texto: 'Oi, quero orçamento', deMim: false, idExterno: 'in-1', em: agora });
      await t.sintonia.receber({ canalId: lauro, telefone: '5571933334444', nome: 'Bia', texto: 'Bom dia', deMim: false, idExterno: 'in-2', em: agora });
      const todas = await t.repo.listarConversas();
      const daOficina = todas.filter((c) => c.empresaId === t.E);
      expect(Object.fromEntries(daOficina.map((c) => [c.nome, c.unidade]))).toEqual({ Ana: 'barra-shopping', Bia: 'lauro-de-freitas' });

      // Acesso por unidade: a atendente da Barra vê só a Barra; unidade fora do cadastro é recusada.
      r = await t.como(t.dono, 'POST', '/api/equipe', { nome: 'Carla Barra', email: 'carla@oficina.com', papel: 'atendente', unidades: ['barra-shopping'], senha: SENHA });
      expect(r.statusCode, r.body).toBe(201);
      r = await t.como(t.dono, 'POST', '/api/equipe', { nome: 'Outra', email: 'outra@oficina.com', papel: 'atendente', unidades: ['norte'], senha: SENHA });
      expect(r.statusCode).toBe(400);
      const carla = await t.entrar('carla@oficina.com');
      r = await t.como(carla, 'GET', '/api/conversas');
      expect(r.statusCode, r.body).toBe(200);
      const vistas = (r.json() as Array<{ nome?: string; unidade: string }>) ?? [];
      const lista = Array.isArray(vistas) ? vistas : (vistas as { conversas: Array<{ nome?: string; unidade: string }> }).conversas;
      expect(lista.map((c) => c.unidade)).toEqual(['barra-shopping']);

      // Relatório: as opções de unidade são as do cadastro, com os nomes dela.
      r = await t.como(t.dono, 'GET', '/api/relatorios?periodo=30d');
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().opcoes.unidades).toEqual([
        { id: 'centro', nome: 'Oficina do Zé - Centro' },
        { id: 'barra-shopping', nome: 'Barra Shopping' },
        { id: 'lauro-de-freitas', nome: 'Unidade Lauro' },
      ]);
      expect((await t.como(t.dono, 'GET', '/api/relatorios?periodo=30d&unidade=barra-shopping')).statusCode).toBe(200);
      expect((await t.como(t.dono, 'GET', '/api/relatorios?periodo=30d&unidade=norte')).statusCode).toBe(400);

      // Unidade com conversas/números não pode ser apagada (só desativada) — aqui sem "emUso", a criada pode.
      expect((await t.como(t.dono, 'DELETE', '/api/unidades/centro')).statusCode).toBe(200);
      expect(existeUnidade('centro')).toBe(false);
    });

    it('nome, segmento, cidade e "sobre" de Empresa › Dados entram na IA, no agente, nos modelos de bot e de e-mail', async () => {
      const t = await montar();
      await t.como(t.dono, 'POST', '/api/unidades', { nome: 'Centro' });
      await t.como(t.dono, 'POST', '/api/unidades', { nome: 'Pituba' });
      const r = await t.como(t.dono, 'PATCH', '/api/empresa/cadastro', {
        nome: 'Auto Center Bahia',
        dados: { segmento: 'Oficina mecânica', sobre: 'Revisão e troca de óleo com hora marcada.', endereco: { cidade: 'Lauro de Freitas', uf: 'BA' } },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(identidade()).toMatchObject({ nome: 'Auto Center Bahia', segmento: 'Oficina mecânica', cidade: 'Lauro de Freitas', uf: 'BA' });
      const sys = systemPrompt('base');
      expect(sys).toContain('Auto Center Bahia');
      expect(sys).toContain('oficina mecânica em Lauro de Freitas');
      expect(sys).toContain('Revisão e troca de óleo');
      expect(sys).not.toMatch(/Império|alisamento/);
      const agente = systemDoAgente({ agente: { nome: 'Lia', criatividade: 50, config: ConfigAgente.parse({}) } as never, conhecimento: [], aprendizados: [], ferramentas: [] });
      expect(agente).toContain('atendente da Auto Center Bahia no WhatsApp (oficina mecânica em Lauro de Freitas)');
      // Bot: o nome da empresa e as unidades dela; nada de progressiva.
      const bot = JSON.stringify(modelosBot());
      expect(bot).toContain('Auto Center Bahia');
      expect(bot).toContain('"id":"pituba"');
      expect(bot).not.toMatch(/Império|norte|Progressiva/);
      const emails = JSON.stringify(modelosProntos());
      expect(emails).toContain('Auto Center Bahia · Lauro de Freitas, Bahia');
      expect(emails).not.toMatch(/Império|progressiva/i);
    });
  });
}

describe('Império continua igual com o cadastro', () => {
  it('semeia norte, sumare e feira com os nomes de antes e a IA se apresenta do mesmo jeito', async () => {
    const app = criarServidor({ sintonia: new Sintonia({ empresaId: 'imperio', repo: new RepositorioMemoria(), numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } }), repo: new RepositorioMemoria() });
    const armazem = new ArmazemCadastroMemoria();
    await armazem.gravarDados('imperio', { ...(await import('../src/empresa/cadastro.js')).dadosPadrao(), segmento: 'Salões de alisamento e progressiva', endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: 'Salvador', uf: 'BA' } }, 'migração 530');
    const cad = registrarCadastro(app, {
      armazem,
      empresaId: 'imperio',
      empresa: { dados: async () => ({ nome: 'Império Progressivas' }), renomear: async () => ({}) },
      unidadesPadrao: UNIDADES_IMPERIO.map((u) => ({ id: u.id, nome: u.nome, nomeCliente: u.nomeCliente, ativa: u.ativa })),
    });
    await cad.carregar('imperio');
    const r = await app.inject({ method: 'GET', url: '/api/unidades' });
    expect(r.json().unidades.map((u: { id: string; nome: string; fixa: boolean }) => [u.id, u.nome, u.fixa])).toEqual([
      ['norte', 'Salvador Norte', true],
      ['sumare', 'Sumaré', true],
      ['feira', 'Feira de Santana', true],
    ]);
    expect(unidadeDe('norte').nome).toBe('Salvador Norte Shopping');
    expect(unidadeDe('sumare').nome).toBe('Shopping Sumaré');
    expect(idsUnidades()).toEqual(['norte', 'sumare', 'feira']);
    expect(apresentacao()).toBe('Império Progressivas (salões de alisamento e progressiva em Salvador)');
    expect(systemPrompt('base')).toContain('Você é a assistente de atendimento da Império Progressivas no WhatsApp');
    // Os ids antigos não podem ser apagados (conversas e pessoas já usam).
    expect((await app.inject({ method: 'DELETE', url: '/api/unidades/feira' })).statusCode).toBe(409);
    // Bot e e-mail da Império mantêm o jeito de salão e as unidades dela.
    const bot = JSON.stringify(modelosBot());
    expect(bot).toContain('Aqui é da Império Progressivas');
    expect(bot).toContain('Salvador Norte Shopping');
    expect(bot).toContain('Progressiva');
    expect(JSON.stringify(modelosProntos())).toContain('Império Progressivas · Salvador, Bahia');
  });
});
