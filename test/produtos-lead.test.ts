import { describe, expect, it } from 'vitest';
import { ContatosMemoria, ContatosPostgres, contatoVazio, type ArmazemContatos } from '../src/contatos/contatos.js';
import { ArmazemCadastroMemoria, ArmazemCadastroPostgres, type ArmazemCadastro, type NovoProduto } from '../src/empresa/cadastro.js';
import { ArmazemProdutosLeadMemoria, ArmazemProdutosLeadPostgres, ProdutosLead, totalItem, totalItens } from '../src/empresa/lead-produtos.js';
import { registrarProdutosLead } from '../src/empresa/lead-produtos-rotas.js';
import { montarExtras } from '../src/rotas/extras.js';
import { ambientes, montarFunis } from './funis-ambiente.js';

/**
 * produtos-lead: produtos e serviços vinculados ao lead (ficha e cartão do Pipeline), valor do lead pela soma,
 * filtro do Pipeline por produto, categoria e empresa vinculada ao contato, coluna "Produtos" do exportar,
 * texto para a IA, receita por produto (Análises) e isolamento por empresa.
 */
type Itens = { itens: Array<{ id: string; produtoId: string; nome: string; quantidade: number; preco: number; desconto: number; total: number }>; total: number; valor: number | null; valorPelaSoma: boolean; valorCalculado: boolean; podeEditar: boolean };
type Quadro = { colunas: Array<{ cartoes: Array<{ nome: string }> }>; avisos: string[] };
const q = (filtro: unknown) => `?limite=50&filtro=${encodeURIComponent(JSON.stringify(filtro))}`;
const nomes = (r: Quadro) => r.colunas.flatMap((c) => c.cartoes.map((x) => x.nome)).sort();

const produto = (nome: string, extra: Partial<NovoProduto> = {}): NovoProduto => ({
  nome, tipo: 'servico', categoria: null, preco: 100, duracaoMin: null, descricao: '', codigo: '', ativo: true, ...extra,
});

async function montar(amb: (typeof ambientes)[number]) {
  const m = await montarFunis(amb);
  const pool = m.pool;
  if (pool) await pool.query('truncate sintonia.produtos, sintonia.lead_produtos, sintonia.lead_produtos_valor, sintonia.lead_produtos_config cascade');
  const cadastro: ArmazemCadastro = pool ? new ArmazemCadastroPostgres(pool) : new ArmazemCadastroMemoria();
  const contatos: ArmazemContatos = pool ? new ContatosPostgres(pool) : new ContatosMemoria();
  const servico = new ProdutosLead({ armazem: pool ? new ArmazemProdutosLeadPostgres(pool) : new ArmazemProdutosLeadMemoria(), cadastro, valor: m.funis });
  const extras = montarExtras({ repo: m.repo, pool, contatos, empresaId: 'imperio', canalDa: () => undefined, produtos: (ids) => servico.resumoDe('imperio', ids) });
  registrarProdutosLead(m.app, { repo: m.repo, servico, empresaId: 'imperio' });
  m.funis.ligarFiltros({
    conversasComProdutos: (f) => servico.conversasComFiltro('imperio', f),
    telefonesDasEmpresas: (ch) => extras.leads.telefonesDasEmpresas(ch),
  });
  const escova = await cadastro.criarProduto('imperio', produto('Escova', { preco: 80, categoria: 'Cabelo' }), 'teste');
  const progressiva = await cadastro.criarProduto('imperio', produto('Progressiva', { preco: 350, categoria: 'Cabelo' }), 'teste');
  const kit = await cadastro.criarProduto('imperio', produto('Kit home care', { tipo: 'produto', preco: 120, categoria: 'Loja' }), 'teste');
  const consulta = await cadastro.criarProduto('imperio', produto('Avaliação', { preco: null }), 'teste');
  return { ...m, cadastro, contatos, servico, extras, escova, progressiva, kit, consulta };
}

describe('produtos-lead: contas', () => {
  it('total da linha = quantidade × preço − desconto, nunca negativo', () => {
    expect(totalItem({ quantidade: 3, preco: 19.9, desconto: 0 })).toBe(59.7);
    expect(totalItem({ quantidade: 1, preco: 50, desconto: 80 })).toBe(0);
    expect(totalItens([{ quantidade: 2, preco: 80, desconto: 10 }, { quantidade: 1, preco: 0.1, desconto: 0 }, { quantidade: 1, preco: 0.2, desconto: 0 }])).toBe(150.3);
  });
});

describe.each(ambientes)('Produtos e serviços no lead ($nome)', (amb) => {
  it('vincula, soma quantidade do mesmo produto, muda, remove e o valor do lead acompanha a soma', async () => {
    const m = await montar(amb);
    const { como, gente, conversa } = m;
    const ana = await conversa('norte', 'Ana');
    const url = `/api/conversas/${ana.id}/produtos`;

    let r = await como(gente.carla, 'GET', url);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ itens: [], total: 0, valor: null, valorPelaSoma: true, valorCalculado: false, podeEditar: true });

    // valor digitado à mão antes dos produtos
    await como(gente.admin, 'PUT', `/api/conversas/${ana.id}/valor`, { valor: 500 });

    r = await como(gente.carla, 'POST', url, { produtoId: m.escova.id, quantidade: 2 });
    expect(r.statusCode, r.body).toBe(201);
    let b = r.json() as Itens;
    expect(b.itens).toHaveLength(1);
    expect(b.itens[0]).toMatchObject({ nome: 'Escova', quantidade: 2, preco: 80, desconto: 0, total: 160 });
    expect(b).toMatchObject({ total: 160, valor: 160, valorCalculado: true });

    // o mesmo produto de novo: soma a quantidade
    b = (await como(gente.carla, 'POST', url, { produtoId: m.escova.id })).json() as Itens;
    expect(b.itens).toHaveLength(1);
    expect(b.itens[0]!.quantidade).toBe(3);
    expect(b.total).toBe(240);

    // outro produto, com preço do momento diferente e desconto
    b = (await como(gente.carla, 'POST', url, { produtoId: m.progressiva.id, preco: 300, desconto: 20 })).json() as Itens;
    expect(b.total).toBe(240 + 280);
    expect(b.valor).toBe(520);
    // "sob consulta" entra com preço 0
    b = (await como(gente.carla, 'POST', url, { produtoId: m.consulta.id })).json() as Itens;
    expect(b.itens.find((i) => i.nome === 'Avaliação')).toMatchObject({ preco: 0, total: 0 });

    // o preço do cadastro muda depois: o item guarda o preço do momento
    await m.cadastro.alterarProduto('imperio', m.escova.id, { preco: 999, nome: 'Escova modelada' }, 'teste');
    const id = b.itens.find((i) => i.produtoId === m.escova.id)!.id;
    b = (await como(gente.carla, 'GET', url)).json() as Itens;
    expect(b.itens.find((i) => i.id === id)).toMatchObject({ nome: 'Escova modelada', preco: 80 });

    // mudar quantidade
    r = await como(gente.carla, 'PATCH', `${url}/${id}`, { quantidade: 1 });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as Itens).valor).toBe(80 + 280);
    expect((await como(gente.carla, 'PATCH', `${url}/${id}`, { quantidade: 0 })).statusCode).toBe(400);
    expect((await como(gente.carla, 'PATCH', `${url}/${id}`, {})).statusCode).toBe(400);
    expect((await como(gente.carla, 'PATCH', `${url}/${id}`, { desconto: -1 })).statusCode).toBe(400);
    // o valor do cartão do CRM é o mesmo
    expect((await como(gente.admin, 'GET', `/api/conversas/${ana.id}/valor`)).json()).toEqual({ valor: 360 });

    // tirar todos: volta o valor digitado à mão
    for (const i of (await como(gente.carla, 'GET', url)).json().itens as Itens['itens']) expect((await como(gente.carla, 'DELETE', `${url}/${i.id}`)).statusCode).toBe(200);
    expect((await como(gente.admin, 'GET', `/api/conversas/${ana.id}/valor`)).json()).toEqual({ valor: 500 });
    expect((await como(gente.carla, 'DELETE', `${url}/${id}`)).statusCode).toBe(404);

    // sem valor à mão: com produtos vira a soma; sem produtos, some
    const bia = await conversa('norte', 'Bianca');
    const ub = `/api/conversas/${bia.id}/produtos`;
    const item = ((await como(gente.admin, 'POST', ub, { produtoId: m.kit.id })).json() as Itens).itens[0]!;
    expect((await como(gente.admin, 'GET', `/api/conversas/${bia.id}/valor`)).json()).toEqual({ valor: 120 });
    // alguém muda o valor à mão depois: ao tirar os produtos, esse valor fica
    await como(gente.admin, 'PUT', `/api/conversas/${bia.id}/valor`, { valor: 99 });
    await como(gente.admin, 'DELETE', `${ub}/${item.id}`);
    expect((await como(gente.admin, 'GET', `/api/conversas/${bia.id}/valor`)).json()).toEqual({ valor: 99 });
  });

  it('opção "valor pela soma": desligada, o valor do lead não muda; só a gestão muda', async () => {
    const m = await montar(amb);
    const { como, gente, conversa } = m;
    const ana = await conversa('norte', 'Ana');
    expect((await como(gente.carla, 'PUT', '/api/produtos-lead/config', { valorPelaSoma: false })).statusCode).toBe(403);
    expect((await como(gente.carla, 'GET', '/api/produtos-lead/config')).json()).toMatchObject({ valorPelaSoma: true, podeEditar: false });
    const r = await como(gente.admin, 'PUT', '/api/produtos-lead/config', { valorPelaSoma: false });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ valorPelaSoma: false });
    expect((await como(gente.admin, 'PUT', '/api/produtos-lead/config', { valorPelaSoma: 'sim' })).statusCode).toBe(400);
    await como(gente.admin, 'PUT', `/api/conversas/${ana.id}/valor`, { valor: 50 });
    const b = (await como(gente.admin, 'POST', `/api/conversas/${ana.id}/produtos`, { produtoId: m.progressiva.id })).json() as Itens;
    expect(b).toMatchObject({ total: 350, valor: 50, valorCalculado: false });
  });

  it('quem não vê a conversa não vê nem mexe; produto de outra empresa ou desativado não entra', async () => {
    const m = await montar(amb);
    const { como, gente, conversa } = m;
    const ana = await conversa('norte', 'Ana');
    const url = `/api/conversas/${ana.id}/produtos`;
    expect((await como(gente.rita, 'GET', url)).statusCode).toBe(404);
    expect((await como(gente.rita, 'POST', url, { produtoId: m.escova.id })).statusCode).toBe(404);
    expect((await como(gente.admin, 'POST', url, { produtoId: 'nao-e-id' })).statusCode).toBe(400);
    const deOutra = await m.cadastro.criarProduto('outra', produto('Escova da outra'), 'teste');
    expect((await como(gente.admin, 'POST', url, { produtoId: deOutra.id })).statusCode).toBe(404);
    const parado = await m.cadastro.criarProduto('imperio', produto('Antigo', { ativo: false }), 'teste');
    expect((await como(gente.admin, 'POST', url, { produtoId: parado.id })).statusCode).toBe(409);
    expect((await como(gente.admin, 'POST', url, { produtoId: m.escova.id, quantidade: 1.5 })).statusCode).toBe(400);
    // item de uma conversa não se mexe pela rota de outra
    const it0 = ((await como(gente.admin, 'POST', url, { produtoId: m.escova.id })).json() as Itens).itens[0]!;
    const bia = await conversa('norte', 'Bianca');
    expect((await como(gente.admin, 'DELETE', `/api/conversas/${bia.id}/produtos/${it0.id}`)).statusCode).toBe(404);
    expect((await como(gente.admin, 'PATCH', `/api/conversas/${bia.id}/produtos/${it0.id}`, { quantidade: 3 })).statusCode).toBe(404);
    // isolamento: os dados de outra empresa não aparecem no filtro nem no resumo
    expect(await m.servico.conversasComFiltro('outra', { produtos: [m.escova.id], categorias: [] })).toEqual([]);
    expect((await m.servico.resumoDe('outra', [ana.id])).size).toBe(0);
    expect(await m.servico.conversasComFiltro('imperio', { produtos: [m.escova.id], categorias: [] })).toEqual([ana.id]);
  });

  it('filtro do Pipeline por produto, categoria e empresa vinculada ao contato', async () => {
    const m = await montar(amb);
    const { como, gente, conversa, sistema } = m;
    const ana = await conversa('norte', 'Ana');
    const bia = await conversa('norte', 'Bianca');
    await conversa('norte', 'Cristina');
    await como(gente.admin, 'POST', `/api/conversas/${ana.id}/produtos`, { produtoId: m.escova.id });
    await como(gente.admin, 'POST', `/api/conversas/${bia.id}/produtos`, { produtoId: m.kit.id });
    await como(gente.admin, 'POST', `/api/conversas/${bia.id}/produtos`, { produtoId: m.progressiva.id });
    // empresas ligadas aos contatos (ficha › empresa)
    await m.contatos.salvar('imperio', { ...contatoVazio(ana.telefone, 'Ana'), pessoa: 'juridica', empresa: { nomeFantasia: 'Acme Ltda', cnpj: '11.222.333/0001-81' } }, 'teste');
    await m.contatos.salvar('imperio', { ...contatoVazio(bia.telefone, 'Bianca'), empresa: { nomeFantasia: 'Padaria São José' } }, 'teste');

    const quadro = async (filtro: unknown) => {
      const r = await como(gente.admin, 'GET', `/api/funis/${sistema.id}/quadro${q(filtro)}`);
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as Quadro;
    };
    expect(nomes(await quadro({ produtos: [m.escova.id] }))).toEqual(['Ana']);
    expect((await quadro({ produtos: [m.escova.id] })).avisos).toEqual([]);
    expect(nomes(await quadro({ produtos: [m.escova.id, m.kit.id] }))).toEqual(['Ana', 'Bianca']);
    expect(nomes(await quadro({ produtos: [m.consulta.id] }))).toEqual([]);
    expect(nomes(await quadro({ categorias: ['Cabelo'] }))).toEqual(['Ana', 'Bianca']);
    expect(nomes(await quadro({ categorias: ['loja'] }))).toEqual(['Bianca']);
    expect(nomes(await quadro({ categorias: ['Cabelo'], produtos: [m.kit.id] }))).toEqual(['Bianca']);
    expect(nomes(await quadro({ categorias: ['Nada'] }))).toEqual([]);

    // "propriedade vinculada": as chaves vêm de Clientes › Empresas
    const empresas = (await m.extras.leads.empresas({ empresaId: 'imperio' })).map((e) => e.chave).sort();
    expect(empresas).toEqual(['cnpj:11222333000181', 'nome:padaria sao jose']);
    expect(nomes(await quadro({ empresas: ['cnpj:11222333000181'] }))).toEqual(['Ana']);
    expect(nomes(await quadro({ empresas: ['nome:padaria sao jose', 'cnpj:11222333000181'] }))).toEqual(['Ana', 'Bianca']);
    expect(nomes(await quadro({ empresas: ['nome:ninguem'] }))).toEqual([]);
    expect(nomes(await quadro({ empresas: ['nome:padaria sao jose'], produtos: [m.escova.id] }))).toEqual([]);
    // ids da transmissão seguem o mesmo filtro
    const ids = (await como(gente.admin, 'GET', `/api/funis/${sistema.id}/ids?filtro=${encodeURIComponent(JSON.stringify({ categorias: ['Loja'] }))}`)).json() as { ids: string[] };
    expect(ids.ids).toEqual([bia.id]);
  });

  it('exportar ganha a coluna "Produtos"; IA e Análises leem os produtos vinculados', async () => {
    const m = await montar(amb);
    const { como, gente, conversa } = m;
    const ana = await conversa('norte', 'Ana');
    const bia = await conversa('norte', 'Bianca');
    await como(gente.admin, 'POST', `/api/conversas/${ana.id}/produtos`, { produtoId: m.escova.id, quantidade: 2 });
    await como(gente.admin, 'POST', `/api/conversas/${ana.id}/produtos`, { produtoId: m.kit.id, desconto: 20 });
    await como(gente.admin, 'POST', `/api/conversas/${bia.id}/produtos`, { produtoId: m.escova.id });

    const { csv } = await m.extras.leads.exportarCsv({ empresaId: 'imperio' });
    const linhas = csv.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const sep = linhas[0]!.includes(';') ? ';' : ',';
    const cab = linhas[0]!.split(sep);
    const col = cab.indexOf('Produtos');
    expect(col).toBeGreaterThan(0);
    const daAna = linhas.find((l) => l.includes(ana.telefone))!;
    expect(daAna).toContain('2× Escova; Kit home care');

    const texto = await m.servico.textoParaIa(ana);
    expect(texto).toContain('2× Escova (serviço, R$ 80,00 cada)');
    expect(texto).toContain('desconto de R$ 20,00');
    expect(texto).toContain('Total: R$ 260,00');
    expect(await m.servico.textoParaIa(await conversa('norte', 'Cris'))).toBeNull();

    const porProduto = await m.servico.porProduto('imperio', [ana.id, bia.id, ana.id]);
    expect(porProduto[0]).toMatchObject({ nome: 'Escova', leads: 2, quantidade: 3, receita: 240 });
    expect(porProduto[1]).toMatchObject({ nome: 'Kit home care', tipo: 'produto', leads: 1, quantidade: 1, receita: 100 });
  });
});
