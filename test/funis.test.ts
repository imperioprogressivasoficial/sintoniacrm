import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AgenteFalso, ambientes, montarFunis, quinta } from './funis-ambiente.js';
import { poolDeTeste, temPostgres } from './repos.js';

type Etapa = { id: string; nome: string; cor: string; ordem: number; chaveSistema: string | null; conversas?: number };
type FunilJson = { id: string; nome: string; sistema: boolean; etapas: Etapa[]; conversas?: number };
type Coluna = { etapa: Etapa; total: number; mais: boolean; offset: number; cartoes: Array<{ conversaId: string; nome: string; tags: Array<{ nome: string }>; desde: string; ultima: { texto: string } | null; dona: { id: string } | null }> };

describe.each(ambientes)('Funil do sistema "Atendimento" ($nome)', (amb) => {
  it('existe sozinho com as 7 etapas; toda conversa entra nele; a IA/motor movem a tag sem laço', async () => {
    const agente = new AgenteFalso(() => ({ texto: 'Oi!', acoes: [{ tipo: 'etapa', etapa: 'interessada', motivo: 'perguntou preço' }], recusou: false }));
    const { como, gente, conversa, repo, sistema, etapasSistema, funis } = await montarFunis(amb, { agente });
    const lista = (await como(gente.carla, 'GET', '/api/funis')).json() as FunilJson[];
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: sistema.id, nome: 'Atendimento', sistema: true });
    expect(lista[0]!.etapas.map((e) => e.chaveSistema)).toEqual(['novo_lead', 'em_conversa', 'interessada', 'agendada', 'compareceu', 'manutencao', 'perdida']);
    expect(lista[0]!.etapas.map((e) => e.nome)).toContain('Manutenção');
    // garantirSistema é idempotente.
    await funis.garantirSistema();
    expect(((await como(gente.admin, 'GET', '/api/funis')).json() as FunilJson[]).length).toBe(1);

    // Cliente escreve: o motor põe em "Em conversa" e a IA (sugestão) classifica "Interessada".
    const c = await conversa('norte', 'Marina');
    expect((await repo.buscarConversa(c.id))!.etapa).toBe('interessada');
    const daConversa = (await como(gente.carla, 'GET', `/api/conversas/${c.id}/funis`)).json() as Array<{ funilId: string; etapa: { id: string; chaveSistema: string } }>;
    expect(daConversa[0]!.etapa).toMatchObject({ id: etapasSistema.get('interessada'), chaveSistema: 'interessada' });
    const ev = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'etapa_movida');
    expect(ev.map((e) => [e.dados!.de, e.dados!.para, e.dados!.por, e.dados!.automatico])).toEqual([
      [etapasSistema.get('novo_lead'), etapasSistema.get('em_conversa'), 'Sintonia', true],
      [etapasSistema.get('em_conversa'), etapasSistema.get('interessada'), 'IA', true],
    ]);
    // Contagem por etapa (visível).
    const contada = ((await como(gente.carla, 'GET', '/api/funis')).json() as FunilJson[])[0]!;
    expect(contada.etapas.find((e) => e.chaveSistema === 'interessada')!.conversas).toBe(1);
    expect(((await como(gente.rita, 'GET', '/api/funis')).json() as FunilJson[])[0]!.conversas).toBe(0);
  });

  it('mover o cartão para uma etapa do sistema muda conversa.etapa; o motor respeita (Agendada é protegida)', async () => {
    const agente = new AgenteFalso(() => ({ texto: 'Oi!', acoes: [{ tipo: 'etapa', etapa: 'perdida', motivo: 'x' }], recusou: false }));
    const { como, gente, conversa, escreve, repo, sistema, etapasSistema } = await montarFunis(amb);
    const c = await conversa('norte', 'Marina');
    expect((await repo.buscarConversa(c.id))!.etapa).toBe('em_conversa');

    const r = await como(gente.carla, 'POST', `/api/conversas/${c.id}/funis/${sistema.id}`, { etapaId: etapasSistema.get('agendada') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, mudou: true, etapa: 'agendada' });
    expect((await repo.buscarConversa(c.id))!.etapa).toBe('agendada');
    const mudou = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'etapa_mudou').at(-1)!;
    expect(mudou.dados).toMatchObject({ de: 'em_conversa', para: 'agendada', motivo: 'manual', por: 'Carla Lima', porId: gente.carla.id });

    // A cliente volta a falar e a IA tenta "Perdida": Agendada é protegida, nada muda (nem a tag).
    agente.resposta = () => ({ texto: 'Oi!', acoes: [{ tipo: 'etapa', etapa: 'perdida', motivo: 'x' }], recusou: false });
    await escreve(c, 'Até amanhã!');
    expect((await repo.buscarConversa(c.id))!.etapa).toBe('agendada');
    const funis = (await como(gente.carla, 'GET', `/api/conversas/${c.id}/funis`)).json() as Array<{ etapa: { chaveSistema: string } }>;
    expect(funis[0]!.etapa.chaveSistema).toBe('agendada');

    // Pelo endpoint de tags: marcar a etapa "Perdida" (tag do sistema) move o cartão e a etapa.
    const t = await como(gente.carla, 'POST', `/api/conversas/${c.id}/tags`, { tagId: etapasSistema.get('perdida') });
    expect(t.statusCode).toBe(200);
    expect((await repo.buscarConversa(c.id))!.etapa).toBe('perdida');
    // Tirar do funil do sistema não pode.
    expect((await como(gente.carla, 'POST', `/api/conversas/${c.id}/funis/${sistema.id}`, { etapaId: null })).statusCode).toBe(400);
    expect((await como(gente.carla, 'DELETE', `/api/conversas/${c.id}/tags/${etapasSistema.get('perdida')}`)).statusCode).toBe(400);
    // A tag do sistema não aparece nas tags da conversa (já está em conversa.etapa).
    expect((await como(gente.carla, 'GET', `/api/conversas/${c.id}`)).json().conversa.tags).toEqual([]);
    // Cada movimento uma vez só: sem laço.
    const movidas = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'etapa_movida').map((e) => e.dados!.para);
    expect(movidas).toEqual([etapasSistema.get('em_conversa'), etapasSistema.get('agendada'), etapasSistema.get('perdida')]);
  });

  it('etapas do sistema: renomeia e recolore, mas não apaga; o funil do sistema não apaga', async () => {
    const { como, gente, sistema, etapasSistema } = await montarFunis(amb);
    const id = etapasSistema.get('interessada')!;
    expect((await como(gente.carla, 'PATCH', `/api/funis/${sistema.id}/etapas/${id}`, { nome: 'Quente' })).statusCode).toBe(403);
    const r = await como(gente.gerenteNorte, 'PATCH', `/api/funis/${sistema.id}/etapas/${id}`, { nome: 'Quente', cor: '#E5484D' });
    expect(r.json()).toMatchObject({ id, nome: 'Quente', cor: '#E5484D', chaveSistema: 'interessada' });
    expect((await como(gente.admin, 'DELETE', `/api/funis/${sistema.id}/etapas/${id}`)).statusCode).toBe(409);
    expect((await como(gente.admin, 'DELETE', `/api/funis/${sistema.id}`)).statusCode).toBe(409);
    expect((await como(gente.admin, 'DELETE', `/api/tags/${id}`)).statusCode).toBe(409);
    expect((await como(gente.admin, 'PATCH', `/api/funis/${sistema.id}`, { nome: 'Atendimento Império' })).json()).toMatchObject({ nome: 'Atendimento Império', sistema: true });
  });

  it('sincronizar ao subir: conversa fora do funil ou na etapa errada é corrigida (conversa.etapa manda)', async () => {
    const { conversa, repo, funis, sistema, etapasSistema, tags } = await montarFunis(amb);
    const c = await conversa('norte', 'Marina');
    // Alguém mexeu na conversa por fora (ex.: banco antigo): etapa fixa diferente da tag.
    await repo.salvarConversa({ ...(await repo.buscarConversa(c.id))!, etapa: 'compareceu' });
    expect(await funis.sincronizarSistema()).toBe(1);
    expect(await tags.temTag(c.id, etapasSistema.get('compareceu')!)).toBe(true);
    expect(await tags.temTag(c.id, etapasSistema.get('em_conversa')!)).toBe(false);
    expect(await funis.sincronizarSistema()).toBe(0);
    expect((await funis.daConversa((await repo.buscarConversa(c.id))!))[0]).toMatchObject({ funilId: sistema.id, etapa: { chaveSistema: 'compareceu' } });
  });
});

describe.each(ambientes)('Funis da empresa ($nome)', (amb) => {
  it('CRUD de funis e etapas com permissões; uma etapa por funil; vários funis por conversa', async () => {
    const { como, gente, conversa, tags } = await montarFunis(amb);
    expect((await como(gente.carla, 'POST', '/api/funis', { nome: 'Pós-venda' })).statusCode).toBe(403);
    const novo = await como(gente.gerenteNorte, 'POST', '/api/funis', { nome: 'Pós-venda', etapas: [{ nome: 'Avaliar' }, { nome: 'Retorno', cor: '#30A46C' }, { nome: 'Fiel' }] });
    expect(novo.statusCode).toBe(201);
    const pos = novo.json() as FunilJson;
    expect(pos.etapas.map((e) => e.nome)).toEqual(['Avaliar', 'Retorno', 'Fiel']);
    expect((await como(gente.admin, 'POST', '/api/funis', { nome: 'pós-venda' })).statusCode).toBe(409);
    expect((await como(gente.admin, 'POST', '/api/funis', { nome: '  ' })).statusCode).toBe(400);
    expect((await como(gente.admin, 'POST', '/api/funis', { nome: 'X', etapas: [{ nome: 'A' }, { nome: 'a' }] })).statusCode).toBe(400);
    const campanha = (await como(gente.admin, 'POST', '/api/funis', { nome: 'Campanha', etapas: [{ nome: 'Avaliar' }, { nome: 'Fechou' }] })).json() as FunilJson;
    // Mesmo nome de etapa em funis diferentes pode; repetido no mesmo funil não; e uma tag solta com o mesmo nome também pode.
    expect((await como(gente.admin, 'POST', `/api/funis/${pos.id}/etapas`, { nome: 'avaliar' })).statusCode).toBe(409);
    expect((await como(gente.admin, 'POST', '/api/tags', { nome: 'Avaliar' })).statusCode).toBe(201);
    const extra = (await como(gente.admin, 'POST', `/api/funis/${pos.id}/etapas`, { nome: 'Sumiu' })).json() as Etapa;
    expect(extra.ordem).toBe(3);
    expect((await como(gente.carla, 'POST', `/api/funis/${pos.id}/etapas`, { nome: 'Y' })).statusCode).toBe(403);

    // Renomear funil e etapa; reordenar.
    expect((await como(gente.admin, 'PATCH', `/api/funis/${pos.id}`, { nome: 'Pós-atendimento' })).json()).toMatchObject({ nome: 'Pós-atendimento' });
    const [avaliar, retorno, fiel] = pos.etapas;
    expect((await como(gente.admin, 'PATCH', `/api/funis/${pos.id}/etapas/${retorno!.id}`, { nome: 'Voltar' })).json()).toMatchObject({ nome: 'Voltar' });
    const ord = (await como(gente.admin, 'POST', `/api/funis/${pos.id}/etapas/ordem`, { ids: [fiel!.id, avaliar!.id] })).json() as Etapa[];
    expect(ord.map((e) => e.nome)).toEqual(['Fiel', 'Avaliar', 'Voltar', 'Sumiu']);
    expect((await como(gente.admin, 'POST', `/api/funis/${pos.id}/etapas/ordem`, { ids: [campanha.etapas[0]!.id] })).statusCode).toBe(404);

    // GET /api/tags continua só com as soltas.
    expect(((await como(gente.admin, 'GET', '/api/tags')).json() as Array<{ nome: string }>).map((t) => t.nome)).toEqual(['Avaliar']);

    // Exclusividade: marcar a etapa B tira da A (pelo endpoint de tags e pelo de mover).
    const c = await conversa('norte', 'Marina');
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/tags`, { tagId: avaliar!.id });
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/tags`, { tagId: fiel!.id });
    expect(await tags.temTag(c.id, avaliar!.id)).toBe(false);
    expect(await tags.temTag(c.id, fiel!.id)).toBe(true);
    const r = await como(gente.carla, 'POST', `/api/conversas/${c.id}/funis/${pos.id}`, { etapaId: retorno!.id });
    expect(r.json()).toMatchObject({ mudou: true });
    // Em dois funis ao mesmo tempo (uma etapa em cada) + o do sistema.
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/funis/${campanha.id}`, { etapaId: campanha.etapas[1]!.id });
    const nos = (await como(gente.carla, 'GET', `/api/conversas/${c.id}/funis`)).json() as Array<{ funilNome: string; etapa: { nome: string } | null }>;
    expect(nos.map((x) => `${x.funilNome}:${x.etapa?.nome ?? '-'}`)).toEqual(['Atendimento:Em conversa', 'Pós-atendimento:Voltar', 'Campanha:Fechou']);
    // As etapas dos funis da empresa aparecem nas tags da conversa (com funilId).
    const tagsConversa = (await como(gente.carla, 'GET', `/api/conversas/${c.id}`)).json().conversa.tags as Array<{ nome: string; funilId?: string }>;
    expect(tagsConversa.map((t) => `${t.nome}:${t.funilId ? 'etapa' : 'solta'}`).sort()).toEqual(['Fechou:etapa', 'Voltar:etapa']);
    // Mover etapa de outro funil: 404. Tirar do funil: etapaId null.
    expect((await como(gente.carla, 'POST', `/api/conversas/${c.id}/funis/${pos.id}`, { etapaId: campanha.etapas[0]!.id })).statusCode).toBe(404);
    expect((await como(gente.carla, 'POST', `/api/conversas/${c.id}/funis/${campanha.id}`, { etapaId: null })).json()).toMatchObject({ mudou: true });
    // Desmarcar a etapa pela rota de tags também tira do funil.
    expect((await como(gente.carla, 'DELETE', `/api/conversas/${c.id}/tags/${retorno!.id}`)).json()).toEqual({ tags: [] });
    expect(await tags.temTag(c.id, retorno!.id)).toBe(false);
    // Quem não vê a conversa não move.
    expect((await como(gente.rita, 'POST', `/api/conversas/${c.id}/funis/${pos.id}`, { etapaId: fiel!.id })).statusCode).toBe(404);

    // Apagar etapa com conversas: precisa dizer para onde vão.
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/funis/${pos.id}`, { etapaId: fiel!.id });
    const recusa = await como(gente.admin, 'DELETE', `/api/funis/${pos.id}/etapas/${fiel!.id}`);
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json()).toMatchObject({ codigo: 'etapa_com_conversas', conversas: 1 });
    expect((await como(gente.admin, 'DELETE', `/api/funis/${pos.id}/etapas/${fiel!.id}?moverPara=${avaliar!.id}`)).json()).toEqual({ ok: true, movidas: 1 });
    expect(await tags.temTag(c.id, avaliar!.id)).toBe(true);
    expect((await como(gente.admin, 'DELETE', `/api/funis/${pos.id}/etapas/${extra.id}`)).json()).toEqual({ ok: true, movidas: 0 });

    // Apagar o funil leva etapas e marcações.
    expect((await como(gente.carla, 'DELETE', `/api/funis/${pos.id}`)).statusCode).toBe(403);
    expect((await como(gente.admin, 'DELETE', `/api/funis/${pos.id}`)).json()).toEqual({ ok: true });
    expect(((await como(gente.admin, 'GET', '/api/funis')).json() as FunilJson[]).map((f) => f.nome)).toEqual(['Atendimento', 'Campanha']);
    expect(await tags.temTag(c.id, avaliar!.id)).toBe(false);
    expect((await como(gente.admin, 'GET', `/api/funis/${pos.id}/quadro`)).statusCode).toBe(404);
  });

  it('quadro: colunas com cartões paginados, filtros e só o que a pessoa vê', async () => {
    const { como, gente, conversa, sintonia, avancar, sistema, etapasSistema } = await montarFunis(amb);
    const f = (await como(gente.admin, 'POST', '/api/funis', { nome: 'Vendas', etapas: [{ nome: 'Lead' }, { nome: 'Proposta' }] })).json() as FunilJson;
    const [lead, proposta] = f.etapas;
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      avancar(1);
      const c = await conversa('norte', `Cliente ${i}`);
      ids.push(c.id);
      await como(gente.admin, 'POST', `/api/conversas/${c.id}/funis/${f.id}`, { etapaId: lead!.id });
    }
    const s = await conversa('sumare', 'Paula Sumaré');
    await como(gente.admin, 'POST', `/api/conversas/${s.id}/funis/${f.id}`, { etapaId: proposta!.id });
    // Uma da Bia (a Carla não vê).
    await sintonia.definirResponsavel(ids[0]!, { id: gente.bia.id, nome: gente.bia.nome }, gente.gerenteNorte, 'transferiu');
    await como(gente.admin, 'POST', '/api/tags', { nome: 'VIP' }).then(async (r) => como(gente.admin, 'POST', `/api/conversas/${ids[6]}/tags`, { tagId: r.json().id }));

    const q = (await como(gente.admin, 'GET', `/api/funis/${f.id}/quadro?limite=3`)).json() as { colunas: Coluna[] };
    expect(q.colunas.map((c) => [c.etapa.nome, c.total, c.cartoes.length, c.mais])).toEqual([
      ['Lead', 7, 3, true],
      ['Proposta', 1, 1, false],
    ]);
    // Mais recentes primeiro; cartão com tags soltas, última mensagem e "desde".
    const primeiro = q.colunas[0]!.cartoes[0]!;
    expect(primeiro).toMatchObject({ conversaId: ids[6], nome: 'Cliente 6', tags: [{ nome: 'VIP' }], ultima: { texto: 'Oi, quanto custa?' } });
    expect(new Date(primeiro.desde).getTime()).toBe(quinta(14, 7).getTime());
    // Próxima página de uma coluna só.
    const p2 = (await como(gente.admin, 'GET', `/api/funis/${f.id}/quadro?limite=3&offset=3&etapaId=${lead!.id}`)).json() as { colunas: Coluna[] };
    expect(p2.colunas).toHaveLength(1);
    expect(p2.colunas[0]!.cartoes.map((c) => c.nome)).toEqual(['Cliente 3', 'Cliente 2', 'Cliente 1']);
    expect(p2.colunas[0]!.mais).toBe(true);

    // Visibilidade: Carla (norte, sem a da Bia), Rita (sumaré), gerente norte.
    const total = async (u: (typeof gente)[keyof typeof gente], extra = '') =>
      ((await como(u, 'GET', `/api/funis/${f.id}/quadro${extra}`)).json() as { colunas: Coluna[] }).colunas.map((c) => c.total);
    expect(await total(gente.carla)).toEqual([6, 0]);
    expect(await total(gente.rita)).toEqual([0, 1]);
    expect(await total(gente.gerenteNorte)).toEqual([7, 0]);
    // Filtros: unidade e busca (nome ou telefone).
    expect(await total(gente.admin, '?unidade=sumare')).toEqual([0, 1]);
    expect(await total(gente.admin, '?busca=cliente%205')).toEqual([1, 0]);
    expect(await total(gente.admin, `?busca=${s.telefone.slice(-6)}`)).toEqual([0, 1]);
    // O quadro do sistema funciona igual.
    const qs = (await como(gente.carla, 'GET', `/api/funis/${sistema.id}/quadro`)).json() as { colunas: Coluna[] };
    expect(qs.colunas.find((c) => c.etapa.id === etapasSistema.get('em_conversa'))!.total).toBe(6);
  });
});

describe.runIf(temPostgres)('Migração 010 (funil do sistema)', () => {
  it('cria o funil do sistema, põe cada conversa na sua etapa e pode rodar de novo', async () => {
    const pool = await poolDeTeste();
    const inserir = (id: string, empresa: string, tel: string, etapa: string) =>
      pool.query(
        `insert into sintonia.conversas (id, empresa_id, unidade, canal_id, telefone, etapa, criada_em, atualizada_em)
         values ($1, $2, 'norte', 'x', $3, $4, '2026-11-01T12:00:00Z', now())`,
        [id, empresa, tel, etapa],
      );
    await inserir('11111111-1111-1111-1111-111111111111', 'imperio', '1', 'agendada');
    await inserir('22222222-2222-2222-2222-222222222222', 'imperio', '2', 'novo_lead');
    await inserir('33333333-3333-3333-3333-333333333333', 'outra', '3', 'perdida');
    await pool.query(`insert into sintonia.eventos (conversa_id, tipo, em) values ('11111111-1111-1111-1111-111111111111', 'etapa_mudou', '2026-11-03T15:00:00Z')`);
    const sql = readFileSync(new URL('../db/migrations/010_funis.sql', import.meta.url), 'utf8');
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(sql);
      await cliente.query(sql);
      await cliente.query('commit');
    } finally {
      cliente.release();
    }
    const { rows: funis } = await pool.query<{ empresa_id: string; n: number }>(
      `select f.empresa_id, count(t.id)::int as n from sintonia.funis f join sintonia.tags t on t.funil_id = f.id where f.sistema group by 1 order by 1`,
    );
    expect(funis).toEqual([
      { empresa_id: 'imperio', n: 7 },
      { empresa_id: 'outra', n: 7 },
    ]);
    const { rows } = await pool.query<{ tel: string; chave: string; desde: Date }>(
      `select c.telefone as tel, t.chave_sistema as chave, ct.marcada_em as desde
         from sintonia.conversa_tags ct join sintonia.tags t on t.id = ct.tag_id join sintonia.conversas c on c.id = ct.conversa_id order by 1`,
    );
    expect(rows.map((r) => `${r.tel}:${r.chave}`)).toEqual(['1:agendada', '2:novo_lead', '3:perdida']);
    expect(rows[0]!.desde.toISOString()).toBe('2026-11-03T15:00:00.000Z');
    expect(rows[1]!.desde.toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });
});
