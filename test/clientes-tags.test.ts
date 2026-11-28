import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ContatosMemoria, ContatosPostgres, contatoVazio } from '../src/contatos/contatos.js';
import { montarExtras, registrarExtras } from '../src/rotas/extras.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags, type ArmazemTags } from '../src/tags/tags.js';
import { ambientes, montarGestao, quinta } from './gestao-ambiente.js';

/**
 * clientes-tags: gestão completa das tags (uso, grupo, juntar, marcar em massa), exportar com filtro de origem
 * e dos selecionados, empresas ligadas aos contatos e isolamento por empresa.
 */
type TagJson = { id: string; nome: string; cor: string; grupo: string | null; conversas: number; ultimoUso: string | null };

for (const amb of ambientes) {
  describe(`Tags: gestão completa (${amb.nome})`, () => {
    it('lista com contagem e último uso; grupo cria, muda e sai', async () => {
      const g = await montarGestao(amb);
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP', grupo: '  Situação ' })).json() as TagJson;
      expect(vip.grupo).toBe('Situação');
      const insta = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'Instagram' })).json() as TagJson;
      expect(insta.grupo).toBeNull();
      expect((await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'X', grupo: 'g'.repeat(31) })).statusCode).toBe(400);

      const a = await g.conversa('norte', 'Marina');
      const b = await g.conversa('sumare', 'Paula');
      await g.como(g.gente.admin, 'POST', `/api/conversas/${a.id}/tags`, { tagId: vip.id });
      g.relogio.t = quinta(16);
      await g.como(g.gente.admin, 'POST', `/api/conversas/${b.id}/tags`, { tagId: vip.id });

      const lista = async (u = g.gente.admin) => Object.fromEntries(((await g.como(u, 'GET', '/api/tags')).json() as TagJson[]).map((t) => [t.nome, t]));
      const l = await lista();
      expect(l.VIP).toMatchObject({ conversas: 2, grupo: 'Situação' });
      expect(new Date(l.VIP!.ultimoUso!).getTime()).toBe(quinta(16).getTime());
      expect(l.Instagram).toMatchObject({ conversas: 0, ultimoUso: null });
      // Gerente do Norte só conta (e vê o último uso) do que é dele.
      const norte = await lista(g.gente.gerenteNorte);
      expect(norte.VIP).toMatchObject({ conversas: 1 });
      expect(new Date(norte.VIP!.ultimoUso!).getTime()).toBe(quinta(14).getTime());

      // Grupo: muda, e sai com null ou vazio; só a gestão.
      expect((await g.como(g.gente.carla, 'PATCH', `/api/tags/${insta.id}`, { grupo: 'Origem' })).statusCode).toBe(403);
      expect((await g.como(g.gente.admin, 'PATCH', `/api/tags/${insta.id}`, { grupo: 'Origem' })).json()).toMatchObject({ grupo: 'Origem', nome: 'Instagram' });
      expect((await g.como(g.gente.admin, 'PATCH', `/api/tags/${vip.id}`, { nome: 'Cliente VIP' })).json()).toMatchObject({ grupo: 'Situação', nome: 'Cliente VIP' });
      expect((await g.como(g.gente.admin, 'PATCH', `/api/tags/${vip.id}`, { grupo: null })).json()).toMatchObject({ grupo: null });
      expect((await g.como(g.gente.admin, 'PATCH', `/api/tags/${insta.id}`, { grupo: '  ' })).json()).toMatchObject({ grupo: null });
    });

    it('juntar duas tags: quem tinha as duas não repete, a de origem some; só a gestão', async () => {
      const g = await montarGestao(amb);
      const insta = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'Instagram' })).json() as TagJson;
      const ig = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'IG' })).json() as TagJson;
      const a = await g.conversa('norte', 'Marina');
      const b = await g.conversa('norte', 'Joana');
      const c = await g.conversa('sumare', 'Paula');
      for (const [conv, tag] of [[a, ig], [b, ig], [b, insta], [c, insta]] as const) {
        await g.como(g.gente.admin, 'POST', `/api/conversas/${conv.id}/tags`, { tagId: tag.id });
      }

      expect((await g.como(g.gente.carla, 'POST', `/api/tags/${ig.id}/juntar`, { paraId: insta.id })).statusCode).toBe(403);
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${ig.id}/juntar`, { paraId: ig.id })).statusCode).toBe(400);
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${ig.id}/juntar`, { paraId: randomUUID() })).statusCode).toBe(404);
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${ig.id}/juntar`, {})).statusCode).toBe(400);

      const r = (await g.como(g.gente.admin, 'POST', `/api/tags/${ig.id}/juntar`, { paraId: insta.id })).json();
      expect(r).toMatchObject({ ok: true, movidas: 1, tag: { id: insta.id, nome: 'Instagram' } });
      const tags = (await g.como(g.gente.admin, 'GET', '/api/tags')).json() as TagJson[];
      expect(tags.map((t) => [t.nome, t.conversas])).toEqual([['Instagram', 3]]);
      for (const conv of [a, b, c]) expect((await g.tags.daConversa(conv.id)).map((t) => t.nome)).toEqual(['Instagram']);
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${ig.id}/juntar`, { paraId: insta.id })).statusCode).toBe(404); // a IG já não existe
    });

    it('marcar e desmarcar em massa só nas conversas que a pessoa vê', async () => {
      const g = await montarGestao(amb);
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as TagJson;
      const n1 = await g.conversa('norte', 'Marina');
      const n2 = await g.conversa('norte', 'Joana');
      const s1 = await g.conversa('sumare', 'Paula');
      await g.como(g.gente.carla, 'POST', `/api/conversas/${n2.id}/tags`, { tagId: vip.id });

      const ids = [n1.id, n2.id, s1.id, randomUUID()];
      const r = (await g.como(g.gente.carla, 'POST', `/api/tags/${vip.id}/conversas`, { ids })).json();
      expect(r).toEqual({ ok: true, mudaram: 1, ignoradas: 2 }); // n2 já tinha; s1 é de outra unidade; o último não existe
      expect((await g.tags.daConversa(n1.id)).map((t) => t.nome)).toEqual(['VIP']);
      expect(await g.tags.daConversa(s1.id)).toEqual([]);
      const ev = (await g.repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'tag_marcada');
      expect(ev).toHaveLength(2);

      const d = (await g.como(g.gente.carla, 'POST', `/api/tags/${vip.id}/conversas`, { ids: [n1.id, n2.id], acao: 'desmarcar' })).json();
      expect(d).toEqual({ ok: true, mudaram: 2, ignoradas: 0 });
      expect((await g.como(g.gente.carla, 'POST', `/api/tags/${vip.id}/conversas`, { ids: ['x'] })).statusCode).toBe(400);
      expect((await g.como(g.gente.carla, 'POST', `/api/tags/${randomUUID()}/conversas`, { ids: [n1.id] })).statusCode).toBe(404);
    });

    it('isolamento por empresa: tags de outra empresa não aparecem, não se juntam e não contam', async () => {
      const g = await montarGestao(amb);
      const armazem: ArmazemTags = g.pool ? new ArmazemTagsPostgres(g.pool) : ((g.tags as unknown as { armazem: ArmazemTagsMemoria }).armazem);
      const outra = new Tags(armazem, 'outra', () => g.relogio.t);
      const daOutra = await outra.criar({ nome: 'VIP' }, 'alguém de lá'); // mesmo nome: cada empresa tem as suas
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as TagJson;

      // Conversa da outra empresa com a tag de lá.
      const modelo = await g.conversa('norte', 'Marina');
      const { conversa: deLa } = await g.repo.buscarOuCriarConversa({ empresaId: 'outra', unidade: 'norte', canalId: 'outra-norte', telefone: '5511999990000', nome: 'De lá', agora: g.relogio.t });
      await outra.marcar(deLa, daOutra.id, 'teste');
      await g.como(g.gente.admin, 'POST', `/api/conversas/${modelo.id}/tags`, { tagId: vip.id });

      const lista = (await g.como(g.gente.admin, 'GET', '/api/tags')).json() as TagJson[];
      expect(lista.map((t) => [t.id, t.conversas])).toEqual([[vip.id, 1]]);
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${vip.id}/juntar`, { paraId: daOutra.id })).statusCode).toBe(404);
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${daOutra.id}/juntar`, { paraId: vip.id })).statusCode).toBe(404);
      expect((await g.como(g.gente.admin, 'PATCH', `/api/tags/${daOutra.id}`, { nome: 'Minha' })).statusCode).toBe(404);
      expect((await g.como(g.gente.admin, 'DELETE', `/api/tags/${daOutra.id}`)).statusCode).toBe(404);
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${daOutra.id}/conversas`, { ids: [modelo.id] })).statusCode).toBe(404);
      // Marcar em massa com a tag daqui numa conversa de lá: ignorada.
      expect((await g.como(g.gente.admin, 'POST', `/api/tags/${vip.id}/conversas`, { ids: [deLa.id] })).json()).toMatchObject({ mudaram: 0, ignoradas: 1 });
      await expect(outra.juntar(daOutra.id, vip.id, 'x')).rejects.toMatchObject({ statusCode: 404 });
      expect([...(await outra.listarComContagem({}))].map((t) => [t.nome, t.conversas])).toEqual([['VIP', 1]]);
      expect(await outra.daConversa(deLa.id)).toEqual([{ id: daOutra.id, nome: 'VIP', cor: daOutra.cor }]);
    });
  });

  describe(`Clientes: exportar com filtros, selecionados e empresas (${amb.nome})`, () => {
    async function montar() {
      const g = await montarGestao(amb, { inicio: quinta(10) });
      const contatos = g.pool ? new ContatosPostgres(g.pool) : new ContatosMemoria();
      const armazemTags = (g.tags as unknown as { armazem: ArmazemTags }).armazem;
      const origens: Record<string, { icone: string }> = {};
      const extras = montarExtras({
        repo: g.repo,
        pool: g.pool,
        contatos,
        armazemTags,
        tags: g.tags,
        empresaId: 'imperio',
        canalDa: (u) => `imperio-${u}`,
        comConversa: (id, fn) => g.sintonia.comConversa(id, fn),
        origens: async (ids) => Object.fromEntries(ids.filter((id) => origens[id]).map((id) => [id, origens[id]!])),
        agora: () => g.relogio.t,
      });
      registrarExtras(g.app, { repo: g.repo, empresaId: 'imperio', relatorios: extras.relatorios, leads: extras.leads, contas: g.contas, agora: () => g.relogio.t });
      return { ...g, contatos, origens };
    }
    const linhas = (csv: string) => csv.split('\r\n').filter(Boolean);

    it('filtra por origem, junta com tag e exporta só os selecionados', async () => {
      const g = await montar();
      const vip = (await g.como(g.gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as TagJson;
      const marina = await g.conversa('norte', 'Marina');
      const joana = await g.conversa('norte', 'Joana');
      const paula = await g.conversa('sumare', 'Paula');
      g.origens[marina.id] = { icone: 'instagram' };
      g.origens[paula.id] = { icone: 'instagram' };
      g.origens[joana.id] = { icone: 'google_ads' };
      await g.como(g.gente.admin, 'POST', `/api/conversas/${marina.id}/tags`, { tagId: vip.id });

      const tudo = (await g.como(g.gente.admin, 'GET', '/api/leads/exportar')).body;
      expect(linhas(tudo)[0]).toBe('﻿Nome;Telefone;E-mail;Unidade;Etapa;Tags;Dona;Criado em;Origem');
      expect(tudo).toContain('Joana;5571988130002;;Salvador Norte Shopping;Novo lead;;;05/11/2026 10:00;Google');

      const insta = (await g.como(g.gente.admin, 'GET', '/api/leads/exportar?origem=instagram')).body;
      expect(linhas(insta)).toHaveLength(3);
      expect(insta).not.toContain('Joana');
      expect(linhas((await g.como(g.gente.admin, 'GET', `/api/leads/exportar?origem=instagram&tag=${vip.id}`)).body)).toHaveLength(2);
      expect((await g.como(g.gente.admin, 'GET', '/api/leads?origem=whatsapp')).json().total).toBe(0);
      expect((await g.como(g.gente.admin, 'GET', '/api/leads?origem=inventada')).statusCode).toBe(400);
      // A gerente do Norte não leva a Paula (Sumaré) mesmo filtrando pela origem dela.
      expect((await g.como(g.gente.gerenteNorte, 'GET', '/api/leads/exportar?origem=instagram')).body).not.toContain('Paula');

      // Selecionados: só os ids pedidos (e só os que a pessoa vê).
      const sel = await g.como(g.gente.gerenteNorte, 'POST', '/api/leads/exportar', { ids: [joana.id, paula.id] });
      expect(sel.headers['content-disposition']).toContain('clientes-selecionados-2026-11-05.csv');
      expect(linhas(sel.body)).toHaveLength(2);
      expect(sel.body).toContain('Joana');
      expect((await g.como(g.gente.carla, 'POST', '/api/leads/exportar', { ids: [joana.id] })).statusCode).toBe(403);
      expect((await g.como(g.gente.admin, 'POST', '/api/leads/exportar', { ids: [] })).statusCode).toBe(400);
      expect((await g.como(g.gente.admin, 'POST', '/api/leads/exportar', { ids: ['nao-e-id'] })).statusCode).toBe(400);
    });

    it('empresas ligadas aos contatos, agrupadas por CNPJ ou nome, só o que a pessoa vê', async () => {
      const g = await montar();
      const marina = await g.conversa('norte', 'Marina');
      const joana = await g.conversa('norte', 'Joana');
      const paula = await g.conversa('sumare', 'Paula');
      const ficha = (tel: string, nome: string, empresa: Record<string, string>) => g.contatos.salvar('imperio', { ...contatoVazio(tel, nome), pessoa: 'juridica', empresa }, 'teste');
      await ficha(marina.telefone, 'Marina', { nomeFantasia: 'Acme', cnpj: '12.345.678/0001-90', cargo: 'Compras' });
      await ficha(joana.telefone, 'Joana', { razaoSocial: 'ACME Comércio Ltda', cnpj: '12345678000190' });
      await ficha(paula.telefone, 'Paula', { nomeFantasia: 'Padaria Sol' });
      await ficha('5571900000001', 'Sem conversa', { nomeFantasia: 'padaria sol ' }); // importada, sem conversa
      await ficha('5571900000002', 'Pessoa', {}); // sem empresa: fica de fora

      const todas = (await g.como(g.gente.admin, 'GET', '/api/clientes/empresas')).json().empresas;
      expect(todas.map((e: { nome: string; total: number }) => [e.nome, e.total])).toEqual([['Acme', 2], ['Padaria Sol', 2]]);
      expect(todas[0]).toMatchObject({ cnpj: '12.345.678/0001-90', razaoSocial: 'ACME Comércio Ltda' });
      expect(todas[0].contatos.find((c: { nome: string }) => c.nome === 'Marina')).toMatchObject({ cargo: 'Compras', conversaId: marina.id, unidade: 'norte' });
      expect(todas[1].contatos.find((c: { nome: string }) => c.nome === 'Sem conversa')).toMatchObject({ conversaId: null });

      // Atendente do Norte: só a Acme (Marina e Joana); nem Paula (Sumaré) nem a ficha sem conversa.
      const carla = (await g.como(g.gente.carla, 'GET', '/api/clientes/empresas')).json().empresas;
      expect(carla.map((e: { nome: string; total: number }) => [e.nome, e.total])).toEqual([['Acme', 2]]);
    });
  });
}
