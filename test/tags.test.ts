import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Agente } from '../src/ai/agente.js';
import type { Agenda } from '../src/ai/ferramentas.js';
import type { Conversa } from '../src/domain.js';
import { CORES_TAGS, PALETA_TAGS } from '../src/tags/tags.js';
import { AgenteFalso, ambientes, montarGestao, quinta } from './gestao-ambiente.js';
import { poolDeTeste, temPostgres } from './repos.js';

type TagJson = { id: string; nome: string; cor: string; ordem: number; conversas: number };

describe.each(ambientes)('Tags da empresa ($nome)', (amb) => {
  it('gestão cria, renomeia, muda cor, reordena e apaga; atendente não', async () => {
    const { gente, como } = await montarGestao(amb);
    // Atendente e recepcionista não mexem nas tags.
    expect((await como(gente.carla, 'POST', '/api/tags', { nome: 'Instagram' })).statusCode).toBe(403);
    expect((await como(gente.rita, 'POST', '/api/tags', { nome: 'Instagram' })).statusCode).toBe(403);

    const insta = (await como(gente.gerenteNorte, 'POST', '/api/tags', { nome: '  Instagram ' }));
    expect(insta.statusCode).toBe(201);
    expect(insta.json()).toMatchObject({ nome: 'Instagram', cor: CORES_TAGS[0], ordem: 0, criadaPor: 'Gil Norte' });
    const vip = (await como(gente.direcao, 'POST', '/api/tags', { nome: 'VIP', cor: '#8e4ec6' })).json() as TagJson;
    expect(vip.cor).toBe('#8E4EC6'); // normaliza para o hex da paleta
    const indic = (await como(gente.admin, 'POST', '/api/tags', { nome: 'Indicação' })).json() as TagJson;

    // Nome repetido (sem diferenciar maiúsculas), vazio, longo ou cor fora da paleta.
    expect((await como(gente.admin, 'POST', '/api/tags', { nome: 'instagram' })).statusCode).toBe(409);
    expect((await como(gente.admin, 'POST', '/api/tags', { nome: '   ' })).statusCode).toBe(400);
    expect((await como(gente.admin, 'POST', '/api/tags', { nome: 'x'.repeat(31) })).statusCode).toBe(400);
    expect((await como(gente.admin, 'POST', '/api/tags', { nome: 'Nova', cor: '#123456' })).statusCode).toBe(400);

    // Renomear e trocar cor.
    const id = (insta.json() as TagJson).id;
    expect((await como(gente.carla, 'PATCH', `/api/tags/${id}`, { nome: 'Insta' })).statusCode).toBe(403);
    expect((await como(gente.admin, 'PATCH', `/api/tags/${id}`, { nome: 'vip' })).statusCode).toBe(409);
    const ren = await como(gente.gerenteSumare, 'PATCH', `/api/tags/${id}`, { nome: 'Insta', cor: PALETA_TAGS[5].hex });
    expect(ren.json()).toMatchObject({ id, nome: 'Insta', cor: '#0090FF' });
    expect((await como(gente.admin, 'PATCH', `/api/tags/00000000-0000-0000-0000-000000000000`, { nome: 'X' })).statusCode).toBe(404);

    // Reordenar.
    expect((await como(gente.carla, 'POST', '/api/tags/ordem', { ids: [indic.id] })).statusCode).toBe(403);
    const ord = (await como(gente.admin, 'POST', '/api/tags/ordem', { ids: [indic.id, vip.id] })).json() as TagJson[];
    expect(ord.map((t) => t.nome)).toEqual(['Indicação', 'VIP', 'Insta']);
    expect(((await como(gente.carla, 'GET', '/api/tags')).json() as TagJson[]).map((t) => t.nome)).toEqual(['Indicação', 'VIP', 'Insta']);

    // Paleta para a tela.
    const cores = (await como(gente.carla, 'GET', '/api/tags/cores')).json() as Array<{ hex: string }>;
    expect(cores).toHaveLength(10);

    // Apagar.
    expect((await como(gente.bia, 'DELETE', `/api/tags/${vip.id}`)).statusCode).toBe(403);
    expect((await como(gente.admin, 'DELETE', `/api/tags/${vip.id}`)).json()).toEqual({ ok: true, removidaDe: 0 });
    expect(((await como(gente.admin, 'GET', '/api/tags')).json() as TagJson[]).map((t) => t.nome)).toEqual(['Indicação', 'Insta']);
  });

  it('marca e desmarca em conversa visível, filtra a lista, conta só o visível e apagar tira de todas', async () => {
    const { gente, como, conversa, repo, sintonia } = await montarGestao(amb);
    const vip = (await como(gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as TagJson;
    const insta = (await como(gente.admin, 'POST', '/api/tags', { nome: 'Instagram' })).json() as TagJson;
    const n1 = await conversa('norte', 'Marina');
    const n2 = await conversa('norte', 'Joana');
    const s1 = await conversa('sumare', 'Paula');
    await sintonia.definirResponsavel(n2.id, { id: gente.bia.id, nome: gente.bia.nome }, gente.gerenteNorte, 'transferiu');

    // A Carla vê n1 (sem dona), não vê n2 (da Bia) nem s1 (outra unidade).
    const r = await como(gente.carla, 'POST', `/api/conversas/${n1.id}/tags`, { tagId: vip.id });
    expect(r.json()).toEqual({ tags: [{ id: vip.id, nome: 'VIP', cor: vip.cor }] });
    expect((await como(gente.carla, 'POST', `/api/conversas/${n2.id}/tags`, { tagId: vip.id })).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `/api/conversas/${n1.id}/tags`, { tagId: 'nao-existe' })).statusCode).toBe(404);
    await como(gente.carla, 'POST', `/api/conversas/${n1.id}/tags`, { tagId: vip.id }); // de novo: nada muda
    await como(gente.bia, 'POST', `/api/conversas/${n2.id}/tags`, { tagId: vip.id });
    await como(gente.bia, 'POST', `/api/conversas/${n2.id}/tags`, { tagId: insta.id });
    await como(gente.rita, 'POST', `/api/conversas/${s1.id}/tags`, { tagId: vip.id });

    // Eventos: um por marcação de verdade.
    const ev = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'tag_marcada');
    expect(ev).toHaveLength(4);
    expect(ev[0]!.dados).toMatchObject({ tagId: vip.id, nome: 'VIP', por: 'Carla Lima', porId: gente.carla.id });

    // Contagem por quem pede.
    const contagem = async (u: typeof gente.admin) =>
      Object.fromEntries(((await como(u, 'GET', '/api/tags')).json() as TagJson[]).map((t) => [t.nome, t.conversas]));
    expect(await contagem(gente.admin)).toEqual({ VIP: 3, Instagram: 1 });
    expect(await contagem(gente.gerenteNorte)).toEqual({ VIP: 2, Instagram: 1 });
    expect(await contagem(gente.carla)).toEqual({ VIP: 1, Instagram: 0 });
    expect(await contagem(gente.rita)).toEqual({ VIP: 1, Instagram: 0 });

    // Lista de conversas: tags de cada uma e filtro ?tag=.
    const lista = (await como(gente.gerenteNorte, 'GET', `/api/conversas`)).json() as Array<Conversa & { tags: TagJson[] }>;
    expect(lista.find((c) => c.id === n2.id)!.tags.map((t) => t.nome)).toEqual(['VIP', 'Instagram']);
    const soInsta = (await como(gente.gerenteNorte, 'GET', `/api/conversas?tag=${insta.id}`)).json() as Conversa[];
    expect(soInsta.map((c) => c.id)).toEqual([n2.id]);
    const vipCarla = (await como(gente.carla, 'GET', `/api/conversas?tag=${vip.id}`)).json() as Conversa[];
    expect(vipCarla.map((c) => c.id)).toEqual([n1.id]);
    expect((await como(gente.carla, 'GET', `/api/conversas/${n1.id}`)).json().conversa.tags).toEqual([{ id: vip.id, nome: 'VIP', cor: vip.cor }]);

    // Desmarcar.
    expect((await como(gente.bia, 'DELETE', `/api/conversas/${n2.id}/tags/${insta.id}`)).json()).toEqual({ tags: [{ id: vip.id, nome: 'VIP', cor: vip.cor }] });
    expect((await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'tag_desmarcada')).toHaveLength(1);

    // Apagar a VIP tira de todas as conversas.
    expect((await como(gente.admin, 'DELETE', `/api/tags/${vip.id}`)).json()).toEqual({ ok: true, removidaDe: 3 });
    const depois = (await como(gente.admin, 'GET', '/api/conversas')).json() as Array<{ tags: unknown[] }>;
    expect(depois.every((c) => c.tags.length === 0)).toBe(true);
  });

  it('a IA só marca tags que existem, só com a opção ligada, e registra o evento', async () => {
    const agente = new AgenteFalso(() => ({
      texto: 'Que bom que você nos achou!',
      acoes: [
        { tipo: 'marcar_tag', nome: 'instagram' },
        { tipo: 'marcar_tag', nome: 'Tag Inventada' },
      ],
      recusou: false,
    }));
    const { gente, como, conversa, repo, tags, escreve } = await montarGestao(amb, { agente });
    const insta = (await como(gente.admin, 'POST', '/api/tags', { nome: 'Instagram' })).json() as TagJson;

    // Desligado (padrão): a IA nem recebe a lista e nada é marcado.
    const c1 = await conversa('norte', 'Marina', 'Vi vocês no Instagram');
    expect(agente.pedidos.at(-1)!.tagsDisponiveis).toBeUndefined();
    expect(await tags.daConversa(c1.id)).toEqual([]);

    // Ligado: recebe os nomes existentes; aplica só o que existe; nunca cria.
    expect((await como(gente.carla, 'PATCH', '/api/ia/config', { marcarTags: true })).statusCode).toBe(403);
    expect((await como(gente.gerenteNorte, 'PATCH', '/api/ia/config', { marcarTags: true })).json().marcarTags).toBe(true);
    await escreve(c1, 'Foi pelo Instagram mesmo');
    expect(agente.pedidos.at(-1)!.tagsDisponiveis).toEqual(['Instagram']);
    expect(await tags.daConversa(c1.id)).toEqual([{ id: insta.id, nome: 'Instagram', cor: insta.cor }]);
    expect((await tags.listar()).map((t) => t.nome)).toEqual(['Instagram']);
    const ev = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'tag_marcada');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.dados).toMatchObject({ tagId: insta.id, nome: 'Instagram', por: 'IA' });

    // De novo: já marcada, sem novo evento.
    await escreve(c1, 'Instagram!!');
    expect((await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'tag_marcada')).toHaveLength(1);
  });
});

describe('Ferramenta marcar_tag do agente', () => {
  const agenda = {} as Agenda;
  const conversa: Conversa = {
    id: 'c1', empresaId: 'imperio', unidade: 'norte', canalId: 'x', telefone: '5571999990000', nome: 'Marina',
    modo: 'copiloto', etapa: 'novo_lead', etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9),
  };
  const mensagens = [{ id: '1', conversaId: 'c1', autor: 'cliente' as const, texto: 'Vi no Instagram', em: quinta(9) }];
  function claudeFalso(respostas: Array<Record<string, unknown>>) {
    const recebidos: Array<Record<string, unknown>> = [];
    return {
      recebidos,
      beta: {
        messages: {
          create: (async (p: Record<string, unknown>) => {
            recebidos.push(structuredClone(p));
            const r = respostas.shift();
            if (!r) throw new Error('sem resposta');
            return r;
          }) as never,
        },
      },
    };
  }
  const usar = (id: string, input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'marcar_tag', input }] });
  const fim = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });

  it('só aparece com tags disponíveis, com os nomes no enum, e recusa nome inventado', async () => {
    const claude = claudeFalso([usar('t1', { nome: 'TikTok' }), usar('t2', { nome: 'instagram' }), fim('Oi!')]);
    const agente = new Agente(claude, agenda, 'BASE', { modelo: 'claude-opus-5-5', esforco: 'low' });
    const r = await agente.executar({ conversa, mensagens, agora: quinta(9), modo: 'sugerir', tagsDisponiveis: ['Instagram', 'VIP'] });
    expect(r.acoes).toEqual([{ tipo: 'marcar_tag', nome: 'Instagram' }]);
    const ferramenta = (claude.recebidos[0]!.tools as Array<{ name: string; input_schema: { properties: { nome?: { enum: string[] } } } }>).find((t) => t.name === 'marcar_tag');
    expect(ferramenta!.input_schema.properties.nome!.enum).toEqual(['Instagram', 'VIP']);
    const resultado = (claude.recebidos[1]!.messages as Array<{ content: unknown }>).at(-1)!.content as Array<{ is_error: boolean; content: string }>;
    expect(resultado[0]).toMatchObject({ is_error: true });
    expect(resultado[0]!.content).toContain('não existe');

    const sem = claudeFalso([fim('Oi!')]);
    await new Agente(sem, agenda, 'BASE', { modelo: 'm', esforco: 'low' }).executar({ conversa, mensagens, agora: quinta(9), modo: 'responder' });
    expect((sem.recebidos[0]!.tools as Array<{ name: string }>).some((t) => t.name === 'marcar_tag')).toBe(false);
  });
});

describe.runIf(temPostgres)('Migração das etiquetas antigas para tags', () => {
  it('cada etiqueta vira tag da empresa e fica marcada nas mesmas conversas (sem "precisa da equipe")', async () => {
    const pool = await poolDeTeste();
    const inserir = (id: string, empresa: string, tel: string, etiquetas: string[]) =>
      pool.query(
        `insert into sintonia.conversas (id, empresa_id, unidade, canal_id, telefone, etiquetas, criada_em, atualizada_em)
         values ($1, $2, 'norte', 'x', $3, $4, now(), now())`,
        [id, empresa, tel, etiquetas],
      );
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    const c = '33333333-3333-3333-3333-333333333333';
    await inserir(a, 'imperio', '1', ['VIP', 'Manutenção', 'precisa da equipe']);
    await inserir(b, 'imperio', '2', ['vip ', 'Instagram']);
    await inserir(c, 'outra', '3', ['VIP']);
    // A migração foi escrita para poder rodar de novo: rodamos o arquivo sobre os dados antigos.
    const sql = readFileSync(new URL('../db/migrations/007_empresa_tags.sql', import.meta.url), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(sql);
      await cliente.query(sql); // duas vezes: nada duplica
      await cliente.query('commit');
    } finally {
      cliente.release();
    }
    const { rows: tags } = await pool.query<{ empresa_id: string; nome: string; cor: string }>(
      'select empresa_id, nome, cor from sintonia.tags order by empresa_id, lower(nome)',
    );
    expect(tags.map((t) => `${t.empresa_id}:${t.nome}`)).toEqual(['imperio:Instagram', 'imperio:Manutenção', 'imperio:VIP', 'outra:VIP']);
    expect(tags.every((t) => CORES_TAGS.includes(t.cor))).toBe(true);
    const { rows: marcas } = await pool.query<{ conversa_id: string; nome: string }>(
      `select ct.conversa_id, t.nome from sintonia.conversa_tags ct join sintonia.tags t on t.id = ct.tag_id order by 1, 2`,
    );
    expect(marcas.map((m) => `${m.conversa_id.slice(0, 1)}:${m.nome}`)).toEqual(['1:Manutenção', '1:VIP', '2:Instagram', '2:VIP', '3:VIP']);
    // O array antigo fica como estava.
    const { rows } = await pool.query<{ etiquetas: string[] }>('select etiquetas from sintonia.conversas where id = $1', [a]);
    expect(rows[0]!.etiquetas).toEqual(['VIP', 'Manutenção', 'precisa da equipe']);
  });
});
