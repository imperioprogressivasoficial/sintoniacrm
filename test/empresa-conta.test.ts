import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import { UNIDADES_EQUIPE } from '../src/auth/acesso.js';
import { ContasMemoria, ContasPostgres, type Contas, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { lerWebhookEvolution } from '../src/channels/evolution.js';
import type { CanalWhatsApp, MidiaEnvio } from '../src/channels/tipos.js';
import { ArmazemComercialMemoria, ArmazemComercialPostgres, type ArmazemComercial } from '../src/comercial/armazem.js';
import { configPadrao } from '../src/comercial/calculo.js';
import { ArmazemPerfisMemoria, ArmazemPerfisPostgres, assinar, registrarConta, trocarEmailMemoria, trocarEmailPostgres, type ArmazemPerfis, type TrocarEmail } from '../src/conta/conta.js';
import { ArmazemCadastroMemoria, ArmazemCadastroPostgres, cnpjValido, type ArmazemCadastro } from '../src/empresa/cadastro.js';
import { ArmazemEmpresaMemoria, ArmazemEmpresaPostgres, Empresa } from '../src/empresa/empresa.js';
import Fastify from 'fastify';
import { idDeUnidade, registrarCadastro } from '../src/empresa/cadastro-rotas.js';
import { precosDoCadastro } from '../src/empresa/precos-comercial.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { HORA } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5b00000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1');

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  textos: Array<{ para: string; texto: string }> = [];
  lerWebhook(corpo: unknown) {
    return lerWebhookEvolution(corpo);
  }
  async enviarTexto(_canal: string, para: string, texto: string) {
    this.textos.push({ para, texto });
    return { idExterno: `OUT${this.textos.length}` };
  }
  async enviarMidia(_canal: string, _para: string, _m: MidiaEnvio) {
    return { idExterno: 'OUTM' };
  }
}
class AgenteFalso {
  async executar(_p: PedidoAgente): Promise<RespostaAgente> {
    return { texto: 'Oi', acoes: [], recusou: false };
  }
}

interface Peças {
  repo: Repositorio;
  contas: Contas;
  cadastro: ArmazemCadastro;
  comercial: ArmazemComercial;
  perfis: ArmazemPerfis;
  trocarEmail: TrocarEmail;
}
interface Ambiente {
  nome: string;
  criar(): Promise<Peças>;
}
const ambientes: Ambiente[] = [
  {
    nome: 'memória',
    criar: async () => {
      const contas = new ContasMemoria();
      return { repo: new RepositorioMemoria(), contas, cadastro: new ArmazemCadastroMemoria(), comercial: new ArmazemComercialMemoria(), perfis: new ArmazemPerfisMemoria(), trocarEmail: trocarEmailMemoria(contas) };
    },
  },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.unidades, sintonia.produtos, sintonia.tabelas_preco, sintonia.tabela_preco_itens, sintonia.documentos_empresa, sintonia.perfis_usuario, sintonia.comercial_config cascade');
            return {
              repo: new RepositorioPostgres(pool),
              contas: new ContasPostgres(pool),
              cadastro: new ArmazemCadastroPostgres(pool),
              comercial: new ArmazemComercialPostgres(pool),
              perfis: new ArmazemPerfisPostgres(pool),
              trocarEmail: trocarEmailPostgres(pool),
            };
          },
        },
      ]
    : []),
];

async function montar(a: Ambiente) {
  const p = await a.criar();
  const canal = new CanalFalso();
  const numeros = [{ canalId: 'sintonia-norte', unidade: 'norte' as const, canal }];
  const sintonia = new Sintonia({ empresaId: 'imperio', repo: p.repo, numeros, agente: new AgenteFalso(), configIa: async () => ({ modoPadrao: 'humano' }) });
  const app = criarServidor({ sintonia, repo: p.repo, auth: { contas: p.contas }, evolution: { canal } });
  // Preços antigos do Comercial (antes do cadastro existir).
  await p.comercial.salvar('imperio', { ...configPadrao(), precos: [{ servico: 'Progressiva', valor: 250 }, { servico: 'Hidratação', valor: 90 }] }, 'teste');
  let nome = 'Império Progressivas';
  registrarCadastro(app, {
    armazem: p.cadastro,
    empresaId: 'imperio',
    empresa: { dados: async () => ({ nome }), renomear: async (n) => (nome = n) },
    unidadesPadrao: [
      { id: 'norte', nome: 'Salvador Norte' },
      { id: 'sumare', nome: 'Sumaré' },
    ],
    idsFixos: UNIDADES_EQUIPE,
    precosComercial: async (id) => (await p.comercial.ler(id)).cfg.precos,
  });
  registrarConta(app, { contas: p.contas, perfis: p.perfis, trocarEmail: p.trocarEmail });
  const h = await hashPadrao;
  const pessoa = (nomeP: string, papel: 'admin' | 'gerente' | 'atendente', empresaId = 'imperio') =>
    p.contas.criarUsuario({ empresaId, nome: nomeP, email: `${nomeP.split(' ')[0]!.toLowerCase()}@${empresaId}.com`, papel, unidades: papel === 'admin' ? [] : ['norte'], senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin'),
    gerente: await pessoa('Gabi Souza', 'gerente'),
    carla: await pessoa('Carla Lima', 'atendente'),
    outra: await pessoa('Olga Outra', 'admin', 'outra'),
  };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await p.contas.criarSessao(u.id, new Date(Date.now() + 30 * 24 * HORA))}`));
    return app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  return { ...p, app, canal, sintonia, gente, como, nome: () => nome };
}

describe('funções do cadastro', () => {
  it('confere CNPJ, cria id de unidade e monta a assinatura', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11.222.333/0001-80')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
    expect(idDeUnidade('Shopping Barra', new Set())).toBe('shopping-barra');
    expect(idDeUnidade('Shopping Barra', new Set(['shopping-barra']))).toBe('shopping-barra-2');
    expect(idDeUnidade('Ação & Cia!!', new Set())).toBe('acao-cia');
    expect(assinar('Oi!', { ligada: true, texto: '', posicao: 'inicio' }, 'Carla Lima')).toBe('*Carla:*\nOi!');
    expect(assinar('Oi!', { ligada: true, texto: 'Carla (Norte)', posicao: 'fim' }, 'Carla Lima')).toBe('Oi!\n\n_Carla (Norte)_');
    expect(assinar('Oi!', { ligada: false, texto: '', posicao: 'inicio' }, 'Carla')).toBe('Oi!');
    expect(assinar('*Carla:*\nOi!', { ligada: true, texto: '', posicao: 'inicio' }, 'Carla')).toBe('*Carla:*\nOi!');
  });
});

for (const a of ambientes) {
  describe(`Empresa e Conta (${a.nome})`, () => {
    it('dados da empresa: só direção e administração editam; CNPJ é conferido; logo vai e volta', async () => {
      const m = await montar(a);
      const r0 = (await m.como(m.gente.carla, 'GET', '/api/empresa/cadastro')).json();
      expect(r0).toMatchObject({ nome: 'Império Progressivas', podeEditar: false, dados: { fuso: 'America/Bahia', cnpj: '' } });
      expect(r0.dados.horario).toHaveLength(7);
      expect((await m.como(m.gente.carla, 'PATCH', '/api/empresa/cadastro', { nome: 'X Ltda' })).statusCode).toBe(403);
      expect((await m.como(m.gente.gerente, 'PATCH', '/api/empresa/cadastro', { nome: 'X Ltda' })).statusCode).toBe(403);
      const ruim = await m.como(m.gente.admin, 'PATCH', '/api/empresa/cadastro', { dados: { cnpj: '11.222.333/0001-80' } });
      expect(ruim.statusCode).toBe(400);
      expect(ruim.json().erro).toMatch(/CNPJ/);
      const ok = await m.como(m.gente.admin, 'PATCH', '/api/empresa/cadastro', {
        nome: 'Império Progressivas Ltda',
        dados: { cnpj: '11222333000181', razaoSocial: 'Império Cabelos Ltda', endereco: { cidade: 'Salvador', uf: 'ba', cep: '41000-000' }, fuso: 'America/Sao_Paulo' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({ nome: 'Império Progressivas Ltda', dados: { cnpj: '11.222.333/0001-81', razaoSocial: 'Império Cabelos Ltda', endereco: { cidade: 'Salvador', uf: 'BA' }, fuso: 'America/Sao_Paulo' } });
      expect(m.nome()).toBe('Império Progressivas Ltda');
      expect((await m.como(m.gente.admin, 'PATCH', '/api/empresa/cadastro', { dados: { fuso: 'Lua/Base' } })).statusCode).toBe(400);
      // A outra empresa não vê nada disto.
      expect((await m.como(m.gente.outra, 'GET', '/api/empresa/cadastro')).json().dados.cnpj).toBe('');
      // Logo
      expect((await m.como(m.gente.admin, 'GET', '/api/empresa/logo')).statusCode).toBe(204);
      expect((await m.como(m.gente.admin, 'PUT', '/api/empresa/logo', { base64: Buffer.from('não é imagem').toString('base64'), mimetype: 'image/png' })).statusCode).toBe(400);
      expect((await m.como(m.gente.carla, 'PUT', '/api/empresa/logo', { base64: PNG.toString('base64'), mimetype: 'image/png' })).statusCode).toBe(403);
      expect((await m.como(m.gente.admin, 'PUT', '/api/empresa/logo', { base64: PNG.toString('base64'), mimetype: 'image/png' })).statusCode).toBe(200);
      const logo = await m.como(m.gente.carla, 'GET', '/api/empresa/logo');
      expect(logo.statusCode).toBe(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(logo.rawPayload, PNG)).toBe(0);
      expect((await m.como(m.gente.outra, 'GET', '/api/empresa/logo')).statusCode).toBe(204);
    });

    it('gravar os dados antes de a empresa existir no banco não troca o nome dela pelo id', async () => {
      const p = await a.criar();
      const pg = p.cadastro instanceof ArmazemCadastroPostgres ? await poolDeTeste() : null;
      const empresa = new Empresa(pg ? new ArmazemEmpresaPostgres(pg) : new ArmazemEmpresaMemoria(), 'imperio', 'Império Progressivas', { cacheMs: 0 });
      const app = Fastify();
      registrarCadastro(app, { armazem: p.cadastro, empresaId: 'imperio', empresa, unidadesPadrao: [], idsFixos: [] });
      const r = await app.inject({ method: 'PATCH', url: '/api/empresa/cadastro', payload: { dados: { segmento: 'Clínica' } } });
      expect(r.json()).toMatchObject({ nome: 'Império Progressivas', dados: { segmento: 'Clínica' } });
      expect((await empresa.dados()).nome).toBe('Império Progressivas');
      await app.close();
    });

    it('unidades: nascem com as que o sistema conhecia, a equipe lê, a direção cadastra, renomeia e desativa', async () => {
      const m = await montar(a);
      const l = (await m.como(m.gente.carla, 'GET', '/api/unidades')).json();
      expect(l.podeEditar).toBe(false);
      expect(l.unidades.map((u: { id: string; nome: string; fixa: boolean }) => [u.id, u.nome, u.fixa])).toEqual([
        ['norte', 'Salvador Norte', true],
        ['sumare', 'Sumaré', true],
      ]);
      expect((await m.como(m.gente.carla, 'POST', '/api/unidades', { nome: 'Barra' })).statusCode).toBe(403);
      expect((await m.como(m.gente.gerente, 'POST', '/api/unidades', { nome: 'Barra' })).statusCode).toBe(403);
      const nova = await m.como(m.gente.admin, 'POST', '/api/unidades', { nome: 'Shopping Barra', telefone: '71 3333-4444', endereco: { cidade: 'Salvador', uf: 'BA' } });
      expect(nova.statusCode).toBe(201);
      expect(nova.json()).toMatchObject({ id: 'shopping-barra', nome: 'Shopping Barra', ativa: true, fixa: false, dados: { telefone: '71 3333-4444', endereco: { cidade: 'Salvador' }, horario: null } });
      expect((await m.como(m.gente.admin, 'POST', '/api/unidades', { nome: 'shopping barra' })).statusCode).toBe(409);
      expect((await m.como(m.gente.admin, 'POST', '/api/unidades', { nome: 'x' })).statusCode).toBe(400);
      // Renomear a que o app já usa: o id não muda.
      const ren = await m.como(m.gente.admin, 'PATCH', '/api/unidades/norte', { nome: 'Norte Shopping' });
      expect(ren.json()).toMatchObject({ id: 'norte', nome: 'Norte Shopping' });
      expect((await m.como(m.gente.admin, 'DELETE', '/api/unidades/norte')).statusCode).toBe(409);
      expect((await m.como(m.gente.admin, 'PATCH', '/api/unidades/norte', { ativa: false })).json().ativa).toBe(false);
      expect((await m.como(m.gente.admin, 'PATCH', '/api/unidades/sumare', { ativa: false })).statusCode).toBe(200);
      // A última ativa não pode sair.
      expect((await m.como(m.gente.admin, 'PATCH', '/api/unidades/shopping-barra', { ativa: false })).statusCode).toBe(409);
      const ordem = await m.como(m.gente.admin, 'PUT', '/api/unidades/ordem', { ids: ['shopping-barra', 'sumare', 'norte'] });
      expect(ordem.json().unidades.map((u: { id: string }) => u.id)).toEqual(['shopping-barra', 'sumare', 'norte']);
      expect((await m.como(m.gente.admin, 'DELETE', '/api/unidades/shopping-barra')).statusCode).toBe(200);
      expect((await m.como(m.gente.admin, 'DELETE', '/api/unidades/shopping-barra')).statusCode).toBe(404);
      // Outra empresa tem as suas (as padrão), sem o nome trocado daqui.
      const outra = (await m.como(m.gente.outra, 'GET', '/api/unidades')).json();
      expect(outra.unidades.find((u: { id: string }) => u.id === 'norte').nome).toBe('Salvador Norte');
      expect((await m.como(m.gente.outra, 'PATCH', '/api/unidades/shopping-barra', { nome: 'Invasão' })).statusCode).toBe(404);
    });

    it('produtos e serviços: copia os preços do Comercial uma vez, valida, não repete nome e só a gestão edita', async () => {
      const m = await montar(a);
      const l = (await m.como(m.gente.carla, 'GET', '/api/produtos')).json();
      expect(l.podeEditar).toBe(false);
      expect(l.produtos.map((p: { nome: string; preco: number; tipo: string; origem: string }) => [p.nome, p.preco, p.tipo, p.origem])).toEqual([
        ['Hidratação', 90, 'servico', 'comercial'],
        ['Progressiva', 250, 'servico', 'comercial'],
      ]);
      expect((await m.como(m.gente.carla, 'POST', '/api/produtos', { nome: 'Shampoo', tipo: 'produto', preco: 40 })).statusCode).toBe(403);
      const neg = await m.como(m.gente.gerente, 'POST', '/api/produtos', { nome: 'Shampoo', tipo: 'produto', preco: -1 });
      expect(neg.statusCode).toBe(400);
      expect(neg.json().erro).toMatch(/negativo/);
      expect((await m.como(m.gente.gerente, 'POST', '/api/produtos', { nome: 'Shampoo', tipo: 'outro' })).statusCode).toBe(400);
      const sh = await m.como(m.gente.gerente, 'POST', '/api/produtos', { nome: 'Shampoo Pós-Química', tipo: 'produto', preco: 39.999, categoria: 'Home care', duracaoMin: 30, codigo: 'SH-01' });
      expect(sh.statusCode).toBe(201);
      expect(sh.json()).toMatchObject({ nome: 'Shampoo Pós-Química', preco: 40, categoria: 'Home care', duracaoMin: null, codigo: 'SH-01', ativo: true });
      expect((await m.como(m.gente.gerente, 'POST', '/api/produtos', { nome: 'progressiva', tipo: 'servico' })).statusCode).toBe(409);
      const corte = (await m.como(m.gente.admin, 'POST', '/api/produtos', { nome: 'Corte', tipo: 'servico', preco: null, duracaoMin: 45 })).json();
      expect(corte).toMatchObject({ preco: null, duracaoMin: 45 });
      // Editar: virou produto, a duração sai.
      expect((await m.como(m.gente.gerente, 'PATCH', `/api/produtos/${corte.id}`, { tipo: 'produto' })).json()).toMatchObject({ tipo: 'produto', duracaoMin: null });
      expect((await m.como(m.gente.gerente, 'PATCH', `/api/produtos/${corte.id}`, { nome: 'Hidratação' })).statusCode).toBe(409);
      const filtro = (await m.como(m.gente.carla, 'GET', '/api/produtos?tipo=produto&busca=home')).json();
      expect(filtro.produtos.map((p: { nome: string }) => p.nome)).toEqual(['Shampoo Pós-Química']);
      expect(filtro.categorias).toEqual(['Home care']);
      // Foto
      const id = sh.json().id;
      expect((await m.como(m.gente.carla, 'PUT', `/api/produtos/${id}/foto`, { base64: PNG.toString('base64'), mimetype: 'image/png' })).statusCode).toBe(403);
      expect((await m.como(m.gente.gerente, 'PUT', `/api/produtos/${id}/foto`, { base64: PNG.toString('base64'), mimetype: 'image/png' })).statusCode).toBe(200);
      expect((await m.como(m.gente.carla, 'GET', `/api/produtos/${id}/foto`)).headers['content-type']).toBe('image/png');
      expect((await m.como(m.gente.carla, 'GET', `/api/produtos/${id}`)).json().fotoEm).toBeTypeOf('number');
      // Outra empresa não vê nem mexe.
      expect((await m.como(m.gente.outra, 'GET', `/api/produtos/${id}`)).statusCode).toBe(404);
      expect((await m.como(m.gente.outra, 'DELETE', `/api/produtos/${id}`)).statusCode).toBe(404);
      expect((await m.como(m.gente.outra, 'GET', '/api/produtos')).json().produtos).toEqual([]);
      // Apagar um copiado do Comercial: não volta sozinho.
      const hid = l.produtos.find((p: { nome: string }) => p.nome === 'Hidratação');
      expect((await m.como(m.gente.gerente, 'DELETE', `/api/produtos/${hid.id}`)).statusCode).toBe(200);
      expect((await m.como(m.gente.carla, 'GET', '/api/produtos')).json().produtos.some((p: { nome: string }) => p.nome === 'Hidratação')).toBe(false);
      // "Copiar de novo" traz o que falta.
      expect((await m.como(m.gente.gerente, 'POST', '/api/produtos/importar-comercial')).json()).toEqual({ importados: 1 });
    });

    it('o Comercial passa a ler os preços do cadastro e o que ele salva vai para o cadastro', async () => {
      const m = await montar(a);
      const prog = (await m.como(m.gente.admin, 'GET', '/api/produtos')).json().produtos.find((p: { nome: string }) => p.nome === 'Progressiva');
      await m.como(m.gente.admin, 'PATCH', `/api/produtos/${prog.id}`, { preco: 280 });
      await m.como(m.gente.admin, 'POST', '/api/produtos', { nome: 'Botox capilar', tipo: 'servico', preco: 180 });
      await m.como(m.gente.admin, 'POST', '/api/produtos', { nome: 'Escova', tipo: 'servico', preco: 60, ativo: false });
      const ligado = precosDoCadastro(m.comercial, m.cadastro);
      const precos = (await ligado.ler('imperio')).cfg.precos;
      expect(precos).toEqual(expect.arrayContaining([{ servico: 'Progressiva', valor: 280 }, { servico: 'Botox capilar', valor: 180 }, { servico: 'Hidratação', valor: 90 }]));
      expect(precos.some((p) => p.servico === 'Escova')).toBe(false);
      expect(precos.filter((p) => p.servico === 'Progressiva')).toHaveLength(1);
      // A tela do Comercial salvou: preço mudado e um novo.
      await ligado.salvar('imperio', { ...configPadrao(), precos: [...precos.map((p) => (p.servico === 'Botox capilar' ? { ...p, valor: 200 } : p)), { servico: 'Cauterização', valor: 150 }] }, 'Gabi');
      const depois = (await m.como(m.gente.admin, 'GET', '/api/produtos')).json().produtos;
      expect(depois.find((p: { nome: string }) => p.nome === 'Botox capilar').preco).toBe(200);
      expect(depois.find((p: { nome: string }) => p.nome === 'Cauterização')).toMatchObject({ preco: 150, tipo: 'servico', origem: 'comercial' });
      expect((await m.comercial.ler('imperio')).cfg.precos).toEqual([]);
    });

    it('tabelas de preço: itens só de produtos da empresa e unidade que existe', async () => {
      const m = await montar(a);
      const ps = (await m.como(m.gente.admin, 'GET', '/api/produtos')).json().produtos;
      const outroProd = (await m.como(m.gente.outra, 'POST', '/api/produtos', { nome: 'Da outra', tipo: 'produto', preco: 1 })).json();
      expect((await m.como(m.gente.carla, 'POST', '/api/tabelas-preco', { nome: 'Black Friday' })).statusCode).toBe(403);
      expect((await m.como(m.gente.gerente, 'POST', '/api/tabelas-preco', { nome: 'Black Friday', unidade: 'lua' })).statusCode).toBe(400);
      expect((await m.como(m.gente.gerente, 'POST', '/api/tabelas-preco', { nome: 'Black Friday', inicio: '2026-11-30', fim: '2026-11-01' })).statusCode).toBe(400);
      const t = await m.como(m.gente.gerente, 'POST', '/api/tabelas-preco', {
        nome: 'Black Friday',
        unidade: 'norte',
        inicio: '2026-11-20',
        fim: '2026-11-30',
        itens: [{ produtoId: ps[0].id, preco: 70 }, { produtoId: outroProd.id, preco: 0.5 }],
      });
      expect(t.statusCode).toBe(201);
      expect(t.json()).toMatchObject({ nome: 'Black Friday', unidade: 'norte', inicio: '2026-11-20', fim: '2026-11-30', itens: [{ produtoId: ps[0].id, preco: 70 }] });
      const ed = await m.como(m.gente.gerente, 'PUT', `/api/tabelas-preco/${t.json().id}`, { nome: 'Black Friday 2026', itens: [{ produtoId: ps[1].id, preco: 200 }] });
      expect(ed.json()).toMatchObject({ nome: 'Black Friday 2026', unidade: null, itens: [{ produtoId: ps[1].id, preco: 200 }] });
      expect((await m.como(m.gente.carla, 'GET', '/api/tabelas-preco')).json().tabelas).toHaveLength(1);
      expect((await m.como(m.gente.outra, 'GET', '/api/tabelas-preco')).json().tabelas).toHaveLength(0);
      expect((await m.como(m.gente.outra, 'DELETE', `/api/tabelas-preco/${t.json().id}`)).statusCode).toBe(404);
      // Apagar o produto tira ele da tabela.
      await m.como(m.gente.gerente, 'DELETE', `/api/produtos/${ps[1].id}`);
      expect((await m.como(m.gente.carla, 'GET', '/api/tabelas-preco')).json().tabelas[0].itens).toEqual([]);
      expect((await m.como(m.gente.gerente, 'DELETE', `/api/tabelas-preco/${t.json().id}`)).statusCode).toBe(200);
    });

    it('documentos: a gestão envia; tipo e conteúdo conferidos; "só gestão" some para a equipe', async () => {
      const m = await montar(a);
      const enviar = (u: Usuario, corpo: Record<string, unknown>) => m.como(u, 'POST', '/api/documentos', { nome: 'Contrato padrão', categoria: 'contrato', mimetype: 'application/pdf', base64: PDF.toString('base64'), ...corpo });
      expect((await enviar(m.gente.carla, {})).statusCode).toBe(403);
      expect((await enviar(m.gente.gerente, { mimetype: 'text/html', base64: Buffer.from('<script>x</script>').toString('base64') })).statusCode).toBe(400);
      expect((await enviar(m.gente.gerente, { base64: Buffer.from('não é pdf').toString('base64') })).statusCode).toBe(400);
      const d1 = await enviar(m.gente.gerente, {});
      expect(d1.statusCode).toBe(201);
      expect(d1.json()).toMatchObject({ nome: 'Contrato padrão', categoria: 'contrato', visivel: 'equipe', mimetype: 'application/pdf', tamanho: PDF.length, enviadoPor: 'Gabi Souza' });
      const d2 = (await enviar(m.gente.admin, { nome: 'Tabela de comissão', categoria: 'tabela', visivel: 'gestao' })).json();
      expect((await m.como(m.gente.carla, 'GET', '/api/documentos')).json().documentos.map((d: { nome: string }) => d.nome)).toEqual(['Contrato padrão']);
      expect((await m.como(m.gente.gerente, 'GET', '/api/documentos')).json().documentos).toHaveLength(2);
      expect((await m.como(m.gente.carla, 'GET', `/api/documentos/${d2.id}/arquivo`)).statusCode).toBe(404);
      const arq = await m.como(m.gente.carla, 'GET', `/api/documentos/${d1.json().id}/arquivo`);
      expect(arq.statusCode).toBe(200);
      expect(arq.headers['content-type']).toBe('application/pdf');
      expect(arq.headers['content-disposition']).toMatch(/^inline; filename="Contrato padr_o.pdf"/);
      expect(arq.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(arq.rawPayload, PDF)).toBe(0);
      expect((await m.como(m.gente.carla, 'GET', `/api/documentos/${d1.json().id}/arquivo?baixar=1`)).headers['content-disposition']).toMatch(/^attachment/);
      expect((await m.como(m.gente.outra, 'GET', `/api/documentos/${d1.json().id}/arquivo`)).statusCode).toBe(404);
      expect((await m.como(m.gente.carla, 'PATCH', `/api/documentos/${d1.json().id}`, { nome: 'x' })).statusCode).toBe(403);
      expect((await m.como(m.gente.gerente, 'PATCH', `/api/documentos/${d1.json().id}`, { nome: 'Contrato 2026', visivel: 'gestao' })).json()).toMatchObject({ nome: 'Contrato 2026', visivel: 'gestao' });
      expect((await m.como(m.gente.carla, 'GET', '/api/documentos')).json().documentos).toEqual([]);
      expect((await m.como(m.gente.outra, 'DELETE', `/api/documentos/${d2.id}`)).statusCode).toBe(404);
      expect((await m.como(m.gente.admin, 'DELETE', `/api/documentos/${d2.id}`)).statusCode).toBe(200);
    });

    it('conta: perfil, preferências, troca de e-mail com senha e assinatura nas mensagens', async () => {
      const m = await montar(a);
      const c0 = (await m.como(m.gente.carla, 'GET', '/api/conta')).json();
      expect(c0).toMatchObject({ nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', papelNome: 'Atendente', telefone: '', assinatura: { ligada: false }, preferencias: { tema: 'auto', telaInicial: 'conversas', densidade: 'confortavel', idioma: 'pt-BR' } });
      expect((await m.como(m.gente.carla, 'PATCH', '/api/conta', { preferencias: { tema: 'roxo' } })).statusCode).toBe(400);
      expect((await m.como(m.gente.carla, 'PATCH', '/api/conta', { telefone: 'abc' })).statusCode).toBe(400);
      const c1 = await m.como(m.gente.carla, 'PATCH', '/api/conta', { nome: 'Carla Lima Santos', telefone: '(71) 99999-0000', preferencias: { tema: 'escuro', telaInicial: 'painel' }, assinatura: { ligada: true } });
      expect(c1.json()).toMatchObject({ nome: 'Carla Lima Santos', telefone: '(71) 99999-0000', preferencias: { tema: 'escuro', telaInicial: 'painel', densidade: 'confortavel' }, assinatura: { ligada: true, posicao: 'inicio' } });
      // Só mudou o que veio.
      expect((await m.como(m.gente.carla, 'PATCH', '/api/conta', { preferencias: { densidade: 'compacta' } })).json().preferencias).toMatchObject({ tema: 'escuro', densidade: 'compacta' });
      expect((await m.contas.buscarPorId(m.gente.carla.id))?.nome).toBe('Carla Lima Santos');
      // O perfil é de cada um.
      expect((await m.como(m.gente.gerente, 'GET', '/api/conta')).json().preferencias.tema).toBe('auto');
      // E-mail
      expect((await m.como(m.gente.carla, 'POST', '/api/conta/email', { email: 'carla.nova@imperio.com', senha: 'errada' })).statusCode).toBe(400);
      expect((await m.como(m.gente.carla, 'POST', '/api/conta/email', { email: 'gabi@imperio.com', senha: SENHA })).statusCode).toBe(409);
      expect((await m.como(m.gente.carla, 'POST', '/api/conta/email', { email: 'Carla.Nova@Imperio.com', senha: SENHA })).json().email).toBe('carla.nova@imperio.com');
      expect((await m.contas.buscarPorEmail('carla.nova@imperio.com'))?.id).toBe(m.gente.carla.id);
      // Assinatura: a mensagem que ela manda sai com o nome dela no começo.
      await m.sintonia.receber({ canalId: 'sintonia-norte', telefone: '5571988887777', nome: 'Joana', texto: 'Oi, quero agendar', deMim: false, idExterno: 'IN1', em: new Date() });
      const conv = (await m.repo.listarConversas())[0]!;
      const env = await m.como(m.gente.admin, 'POST', `/api/conversas/${conv.id}/enviar`, { texto: 'Bom dia!' });
      expect(env.statusCode).toBe(200);
      expect(m.canal.textos.at(-1)?.texto).toBe('Bom dia!');
      await m.como(m.gente.admin, 'PATCH', '/api/conta', { assinatura: { ligada: true, texto: 'Bruno (gerência)' } });
      await m.como(m.gente.admin, 'POST', `/api/conversas/${conv.id}/enviar`, { texto: 'Pode vir às 15h.' });
      expect(m.canal.textos.at(-1)?.texto).toBe('*Bruno (gerência):*\nPode vir às 15h.');
    });
  });
}
