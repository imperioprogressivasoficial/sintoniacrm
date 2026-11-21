import { describe, expect, it } from 'vitest';
import { ContatosMemoria, ContatosPostgres, contatoVazio, type ArmazemContatos } from '../src/contatos/contatos.js';
import { ContasMemoria } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { Sintonia } from '../src/app/sintonia.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

async function montar(armazem: ArmazemContatos = new ContatosMemoria()) {
  const contas = new ContasMemoria();
  const senhaHash = await gerarHash('Imperio2026xyz');
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Bruno', email: 'bruno@imperio.com', papel: 'admin', unidades: [], senhaHash });
  await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
  const repo = new RepositorioMemoria();
  const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
  const agora = new Date();
  const { conversa: norte } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'x', telefone: '5571988887777', nome: 'Ju', agora });
  const { conversa: sumare } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'sumare', canalId: 'y', telefone: '5571977776666', nome: 'Bia', agora });
  const app = criarServidor({ sintonia, repo, auth: { contas }, contatos: { armazem, empresaId: 'imperio' } });
  const entrar = async (email: string) =>
    String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
  return { app, repo, norte, sumare, admin: await entrar('bruno@imperio.com'), carla: await entrar('carla@imperio.com') };
}

describe('Ficha do contato', () => {
  it('começa com o que veio do WhatsApp e grava nome, e-mail, nascimento, observações e empresa', async () => {
    const { app, repo, norte, carla } = await montar();
    const r0 = (await app.inject({ url: `/api/conversas/${norte.id}/contato`, headers: { cookie: carla } })).json();
    expect(r0.contato).toMatchObject({ telefone: '5571988887777', nome: 'Ju', email: null, pessoa: 'fisica' });
    const r = await app.inject({
      method: 'PUT', url: `/api/conversas/${norte.id}/contato`, headers: { cookie: carla },
      payload: { nome: 'Juliana Souza', email: 'JU@Exemplo.com ', nascimento: '1994-03-12', observacoes: 'Cabelo cacheado, prefere sábado', pessoa: 'juridica', empresa: { razaoSocial: 'Ju Beauty LTDA', cnpj: '12.345.678/0001-90', cargo: 'Sócia' } },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().contato).toMatchObject({ nome: 'Juliana Souza', email: 'ju@exemplo.com', nascimento: '1994-03-12', pessoa: 'juridica', empresa: { razaoSocial: 'Ju Beauty LTDA', cnpj: '12345678000190', cargo: 'Sócia' }, atualizadoPor: 'carla@imperio.com' });
    expect((await repo.buscarConversa(norte.id))?.nome).toBe('Juliana Souza'); // o nome vai para a lista
  });

  it('recusa e-mail, data e CNPJ inválidos', async () => {
    const { app, norte, carla } = await montar();
    for (const payload of [{ email: 'nao-e-email' }, { nascimento: '12/03/1994' }, { empresa: { cnpj: '123' } }]) {
      expect((await app.inject({ method: 'PUT', url: `/api/conversas/${norte.id}/contato`, headers: { cookie: carla }, payload })).statusCode).toBe(400);
    }
  });

  it('atendente do Norte não vê nem edita a ficha de uma cliente do Sumaré', async () => {
    const { app, sumare, carla } = await montar();
    expect((await app.inject({ url: `/api/conversas/${sumare.id}/contato`, headers: { cookie: carla } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/conversas/${sumare.id}/contato`, headers: { cookie: carla }, payload: { nome: 'X' } })).statusCode).toBe(404);
  });
});

describe('Campos personalizados', () => {
  it('a gestão cria; a atendente preenche com o tipo certo; campo apagado some', async () => {
    const { app, norte, admin, carla } = await montar();
    expect((await app.inject({ method: 'POST', url: '/api/campos-contato', headers: { cookie: carla }, payload: { nome: 'Tipo de cabelo', tipo: 'texto' } })).statusCode).toBe(403);
    const criar = async (payload: object) => (await app.inject({ method: 'POST', url: '/api/campos-contato', headers: { cookie: admin }, payload })).json();
    const cabelo = await criar({ nome: 'Tipo de cabelo', tipo: 'lista', opcoes: ['Liso', 'Ondulado', 'Cacheado', 'Crespo'] });
    const alergia = await criar({ nome: 'Tem alergia', tipo: 'sim_nao' });
    const visitas = await criar({ nome: 'Visitas', tipo: 'numero' });
    expect((await app.inject({ method: 'POST', url: '/api/campos-contato', headers: { cookie: admin }, payload: { nome: 'tipo de CABELO', tipo: 'texto' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/campos-contato', headers: { cookie: admin }, payload: { nome: 'Vazia', tipo: 'lista' } })).statusCode).toBe(400);

    const put = (campos: object) => app.inject({ method: 'PUT', url: `/api/conversas/${norte.id}/contato`, headers: { cookie: carla }, payload: { campos } });
    expect((await put({ [cabelo.id]: 'Afro' })).statusCode).toBe(400); // fora da lista
    expect((await put({ [visitas.id]: 'muitas' })).statusCode).toBe(400);
    const ok = await put({ [cabelo.id]: 'Cacheado', [alergia.id]: true, [visitas.id]: '3', inventado: 'x' });
    expect(ok.json().contato.campos).toEqual({ [cabelo.id]: 'Cacheado', [alergia.id]: true, [visitas.id]: 3 });

    await app.inject({ method: 'DELETE', url: `/api/campos-contato/${alergia.id}`, headers: { cookie: admin } });
    const lista = (await app.inject({ url: '/api/campos-contato', headers: { cookie: carla } })).json();
    expect(lista.map((c: { nome: string }) => c.nome)).toEqual(['Tipo de cabelo', 'Visitas']);
  });
});

describe.runIf(temPostgres)('Ficha no Postgres', () => {
  it('grava, relê e mantém campos e empresa', async () => {
    const pool = await poolDeTeste();
    const a = new ContatosPostgres(pool);
    const campo = await a.criarCampo('imperio', { nome: 'Como conheceu', tipo: 'texto', opcoes: [] });
    await expect(a.criarCampo('imperio', { nome: 'como conheceu', tipo: 'texto', opcoes: [] })).rejects.toThrow('Já existe');
    const c = { ...contatoVazio('5571900000001', 'Ana'), email: 'ana@x.com', nascimento: '1990-01-31', pessoa: 'juridica' as const, empresa: { cnpj: '12345678000190' }, campos: { [campo.id]: 'Instagram' } };
    await a.salvar('imperio', c, 'carla@imperio.com');
    const lido = await a.obter('imperio', '5571900000001');
    expect(lido).toMatchObject({ nome: 'Ana', email: 'ana@x.com', nascimento: '1990-01-31', pessoa: 'juridica', empresa: { cnpj: '12345678000190' }, campos: { [campo.id]: 'Instagram' }, atualizadoPor: 'carla@imperio.com' });
    expect(await a.atualizarCampo('imperio', campo.id, { nome: 'Origem' })).toMatchObject({ nome: 'Origem' });
  });
});
