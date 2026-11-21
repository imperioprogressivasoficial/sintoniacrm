import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { proximaEtapa } from '../src/engine/etapas.js';
import { PedidoImportacao } from '../src/leads/leads.js';
import { expandirEtapas, naEtapa } from '../src/domain.js';
import { prazoDa, REGRA_PADRAO } from '../src/notificacoes/espera.js';
import { TEXTOS_NPS } from '../src/nps/tipos.js';
import { AgenteFalso, ambientes, montarFunis, quinta } from './funis-ambiente.js';
import { montarBot } from './bot-ambiente.js';

/**
 * etapa-entrada: etapa fixa "Entrada de leads" (bolinha cinza) antes de "Novo lead", em todo funil.
 * Todo lead novo nasce nela; sai na 1ª resposta da loja (equipe ou IA) ou quando alguém move. Não renomeia,
 * não apaga, fica sempre em primeiro; pode ter automações. Histórico importado do WhatsApp não entra nela.
 */

type Etapa = { id: string; nome: string; cor: string; ordem: number; chaveSistema: string | null };
type FunilJson = { id: string; nome: string; sistema: boolean; etapas: Etapa[] };

describe('Entrada de leads: regras do motor', () => {
  it('a cliente escrevendo não tira da Entrada; a 1ª resposta leva para Novo lead (ou Em conversa, se a cliente já escreveu)', () => {
    expect(proximaEtapa('entrada', { tipo: 'mensagem_cliente' })).toBe('entrada');
    expect(proximaEtapa('entrada', { tipo: 'primeira_resposta', clienteEscreveu: false })).toBe('novo_lead');
    expect(proximaEtapa('entrada', { tipo: 'primeira_resposta', clienteEscreveu: true })).toBe('em_conversa');
    // Fora da Entrada, a resposta da loja não mexe na etapa (a regra de sempre continua valendo).
    expect(proximaEtapa('novo_lead', { tipo: 'primeira_resposta', clienteEscreveu: true })).toBe('novo_lead');
    expect(proximaEtapa('novo_lead', { tipo: 'mensagem_cliente' })).toBe('em_conversa');
    // A IA classifica e o Trinks agenda direto da Entrada.
    expect(proximaEtapa('entrada', { tipo: 'ia_classificou', etapa: 'interessada' })).toBe('interessada');
    expect(proximaEtapa('entrada', { tipo: 'agendamento_criado' })).toBe('agendada');
  });

  it('nas contas, a Entrada também é "Novo lead" (filtros, prazos de espera) e o lead importado nasce nela', () => {
    expect(expandirEtapas(['novo_lead'])).toEqual(['novo_lead', 'entrada']);
    expect(expandirEtapas(['interessada'])).toEqual(['interessada']);
    expect(naEtapa('entrada', 'novo_lead')).toBe(true);
    expect(naEtapa('novo_lead', 'entrada')).toBe(false);
    const regra = { ...REGRA_PADRAO, etapas: { novo_lead: 7 } };
    expect(prazoDa(regra, { etapa: 'entrada' })).toMatchObject({ avisoMin: 7, origem: 'etapa' });
    expect(prazoDa({ ...regra, etapas: { novo_lead: 7, entrada: 3 } }, { etapa: 'entrada' })).toMatchObject({ avisoMin: 3 });
    expect(PedidoImportacao.parse({ linhas: [{ telefone: '71988887777' }], unidade: 'norte' }).etapa).toBe('entrada');
  });
});

describe.each(ambientes)('Entrada de leads ($nome)', (amb) => {
  it('todo funil tem a Entrada de leads em primeiro, cinza; não renomeia, não recolore, não apaga e não sai do lugar', async () => {
    const { como, gente, sistema } = await montarFunis(amb);
    const vendas = (await como(gente.admin, 'POST', '/api/funis', { nome: 'Vendas', etapas: [{ nome: 'Lead' }, { nome: 'Proposta' }, { nome: 'Entrada de leads' }] })).json() as FunilJson;
    const lista = (await como(gente.admin, 'GET', '/api/funis')).json() as FunilJson[];
    for (const f of lista) {
      expect(f.etapas[0]).toMatchObject({ nome: 'Entrada de leads', cor: '#94a3b8', chaveSistema: 'entrada' });
      expect(f.etapas.filter((e) => e.chaveSistema === 'entrada')).toHaveLength(1);
    }
    // Pedir uma etapa "Entrada de leads" ao criar o funil não repete a fixa.
    expect(vendas.etapas.map((e) => e.nome)).toEqual(['Entrada de leads', 'Lead', 'Proposta']);

    for (const f of [lista.find((x) => x.id === sistema.id)!, vendas]) {
      const entrada = f.etapas[0]!;
      const url = `/api/funis/${f.id}/etapas/${entrada.id}`;
      expect((await como(gente.admin, 'PATCH', url, { nome: 'Chegada' })).statusCode).toBe(409);
      expect((await como(gente.admin, 'PATCH', url, { cor: '#E5484D' })).statusCode).toBe(409);
      // Mandar o mesmo nome e a mesma cor não é mudar.
      expect((await como(gente.admin, 'PATCH', url, { nome: 'Entrada de leads' })).statusCode).toBe(200);
      expect((await como(gente.admin, 'DELETE', url)).statusCode).toBe(409);
      expect((await como(gente.admin, 'DELETE', `/api/tags/${entrada.id}`)).statusCode).toBe(409);
      // Reordenar com a Entrada no fim: ela continua em primeiro.
      const outras = f.etapas.slice(1).map((e) => e.id).reverse();
      const ord = (await como(gente.admin, 'POST', `/api/funis/${f.id}/etapas/ordem`, { ids: [...outras, entrada.id] })).json() as Etapa[];
      expect(ord[0]!.id).toBe(entrada.id);
      expect(ord.slice(1).map((e) => e.id)).toEqual(outras);
    }
    const depois = ((await como(gente.admin, 'GET', '/api/funis')).json() as FunilJson[]).find((f) => f.id === vendas.id)!;
    expect(depois.etapas.map((e) => e.nome)).toEqual(['Entrada de leads', 'Proposta', 'Lead']);
  });

  it('lead novo do WhatsApp entra na Entrada; a cliente escrevendo de novo não tira; a resposta da equipe leva para Em conversa', async () => {
    const { como, gente, conversa, escreve, buscar, etapasSistema, funis, repo } = await montarFunis(amb);
    const c = await conversa('norte', 'Marina');
    expect((await buscar(c.id)).etapa).toBe('entrada');
    expect((await funis.daConversa(await buscar(c.id)))[0]!.etapa).toMatchObject({ id: etapasSistema.get('entrada'), chaveSistema: 'entrada' });
    await escreve(c, 'Alguém aí?');
    expect((await buscar(c.id)).etapa).toBe('entrada');
    // Quadro do sistema: a cliente aparece na coluna Entrada de leads (a primeira).
    const q = (await como(gente.carla, 'GET', `/api/funis/${(await funis.garantirSistema()).id}/quadro`)).json() as { colunas: Array<{ etapa: Etapa; total: number }> };
    expect(q.colunas[0]).toMatchObject({ etapa: { chaveSistema: 'entrada' }, total: 1 });

    expect((await como(gente.carla, 'POST', `/api/conversas/${c.id}/enviar`, { texto: 'Oi, Marina! Já te ajudo.' })).statusCode).toBe(200);
    expect((await buscar(c.id)).etapa).toBe('em_conversa');
    const mudou = (await repo.eventosEntre(quinta(0), quinta(23))).filter((e) => e.tipo === 'etapa_mudou');
    expect(mudou.map((e) => [e.dados!.de, e.dados!.para, e.dados!.motivo])).toEqual([['entrada', 'em_conversa', 'primeira_resposta_equipe']]);
    // Responder de novo não mexe mais.
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/enviar`, { texto: 'Pode me mandar uma foto?' });
    expect((await buscar(c.id)).etapa).toBe('em_conversa');
  });

  it('a resposta pelo celular da loja e a resposta da IA também tiram da Entrada (a IA segue classificando)', async () => {
    const agente = new AgenteFalso(() => ({ texto: 'Oi! Sou a IA.', acoes: [], recusou: false }));
    const { como, gente, conversa, escreve, buscar } = await montarFunis(amb, { agente });
    // Pelo celular da loja (fromMe).
    const a = await conversa('norte', 'Ana');
    expect((await buscar(a.id)).etapa).toBe('entrada');
    await escreve(a, 'Oi Ana, tudo bem?', true);
    expect((await buscar(a.id)).etapa).toBe('em_conversa');

    // A IA respondendo (modo IA): sai da Entrada e a classificação da IA continua valendo.
    const b = await conversa('norte', 'Bia');
    expect((await buscar(b.id)).etapa).toBe('entrada');
    expect((await como(gente.admin, 'POST', `/api/conversas/${b.id}/modo`, { modo: 'ia' })).statusCode).toBe(200);
    agente.resposta = () => ({ texto: 'Temos horário amanhã!', acoes: [{ tipo: 'etapa', etapa: 'interessada', motivo: 'quer horário' }], recusou: false });
    await escreve(b, 'Tem horário amanhã?');
    const depois = await buscar(b.id);
    expect(depois.ultimaMensagemIa).toBeTruthy();
    expect(depois.etapa).toBe('interessada');
  });

  it('lead sem mensagem (API ou planilha) vai para Novo lead na 1ª mensagem da equipe; histórico importado não entra na Entrada', async () => {
    const { como, gente, buscar, sintonia, repo, conversa } = await montarFunis(amb);
    const base = await conversa('norte', 'Referência'); // só para ter um canal/unidade conhecidos
    const c = (await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: base.canalId, telefone: '5571977001122', nome: 'Formulário', agora: quinta(14) })).conversa;
    await repo.salvarConversa({ ...c, etapa: 'entrada' });
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/enviar`, { texto: 'Oi! Recebemos seu cadastro.' });
    expect((await buscar(c.id)).etapa).toBe('novo_lead');

    // Histórico do WhatsApp puxado ao conectar: fica onde sempre ficou (Novo lead), sem lotar a Entrada.
    await sintonia.importarHistorico([
      { canalId: base.canalId, telefone: '5571966001122', nome: 'Antiga', texto: 'Oi, faz tempo', deMim: false, idExterno: 'hist-1', em: quinta(9) },
      { canalId: base.canalId, telefone: '5571966001122', nome: 'Antiga', texto: 'Oi! Claro', deMim: true, idExterno: 'hist-2', em: quinta(10) },
    ]);
    const antiga = (await repo.listarConversas()).find((x) => x.telefone === '5571966001122')!;
    expect(antiga.etapa).toBe('novo_lead');
  });

  it('nos funis da empresa, a 1ª resposta da loja leva da Entrada para a etapa seguinte; mover à mão também vale', async () => {
    const { como, gente, conversa, buscar, tags } = await montarFunis(amb);
    const vendas = (await como(gente.admin, 'POST', '/api/funis', { nome: 'Vendas', etapas: [{ nome: 'Lead' }, { nome: 'Proposta' }] })).json() as FunilJson;
    const [entrada, lead, proposta] = vendas.etapas;
    const c = await conversa('norte', 'Carol');
    const d = await conversa('norte', 'Duda');
    for (const x of [c, d]) expect((await como(gente.admin, 'POST', `/api/conversas/${x.id}/funis/${vendas.id}`, { etapaId: entrada!.id })).statusCode).toBe(200);
    // Mover à mão (Duda vai direto para Proposta).
    await como(gente.admin, 'POST', `/api/conversas/${d.id}/funis/${vendas.id}`, { etapaId: proposta!.id });
    // A equipe responde a Carol: sai da Entrada nos dois funis.
    await como(gente.carla, 'POST', `/api/conversas/${c.id}/enviar`, { texto: 'Oi, Carol!' });
    expect(await tags.temTag(c.id, lead!.id)).toBe(true);
    expect(await tags.temTag(c.id, entrada!.id)).toBe(false);
    expect((await buscar(c.id)).etapa).toBe('em_conversa');
    // A Duda (já em Proposta) não volta nem anda por causa da resposta.
    await como(gente.carla, 'POST', `/api/conversas/${d.id}/enviar`, { texto: 'Oi, Duda!' });
    expect(await tags.temTag(d.id, proposta!.id)).toBe(true);
    // A etapa da Entrada aparece nas tags da conversa (é etapa de um funil da empresa).
    await como(gente.admin, 'POST', `/api/conversas/${d.id}/funis/${vendas.id}`, { etapaId: entrada!.id });
    const tagsD = (await como(gente.carla, 'GET', `/api/conversas/${d.id}`)).json().conversa.tags as Array<{ nome: string; funilId?: string }>;
    expect(tagsD.map((t) => t.nome)).toEqual(['Entrada de leads']);
  });

  it('a Entrada pode ter automações: quem chega dispara "entrou na etapa"', async () => {
    const { como, gente, conversa, etapasSistema, tags } = await montarFunis(amb);
    const vip = (await como(gente.admin, 'POST', '/api/tags', { nome: 'Chegou agora' })).json() as { id: string };
    const r = await como(gente.admin, 'POST', '/api/automacoes', { nome: 'Ao chegar', ligada: true, gatilho: { tipo: 'entrou_na_etapa', etapaId: etapasSistema.get('entrada') }, passos: [{ tipo: 'marcar_tag', tagId: vip.id }] });
    expect(r.statusCode, r.body).toBe(201);
    const c = await conversa('norte', 'Gabi');
    expect(await tags.temTag(c.id, vip.id)).toBe(true);
  });

  it('opções novas da etapa: tarefa para a equipe, rodízio e pesquisa de satisfação, ligadas à etapa', async () => {
    const tarefas: Array<{ conversaId: string; titulo: string; venceEm: Date | null; prioridade: string }> = [];
    const pedidosRodizio: string[] = [];
    const m = await montarFunis(amb, {
      nps: true,
      automacoes: {
        tarefas: () => ({ criarTarefa: async (c, t) => (tarefas.push({ conversaId: c.id, titulo: t.titulo, venceEm: t.venceEm, prioridade: t.prioridade }), { responsavel: 'Gil Norte' }) }),
        rodizio: () => ({ pedir: (id: string) => void pedidosRodizio.push(id) }),
      },
    });
    const { como, gente, conversa, etapasSistema, relogio } = m;
    expect((await como(gente.admin, 'PUT', '/api/nps/config', { ligada: true, ...TEXTOS_NPS })).statusCode).toBe(200);
    const entrada = etapasSistema.get('entrada')!;
    // Validação: título da tarefa obrigatório.
    expect((await como(gente.admin, 'POST', '/api/automacoes', { nome: 'X', gatilho: { tipo: 'entrou_na_etapa', etapaId: entrada }, passos: [{ tipo: 'criar_tarefa', titulo: '' }] })).statusCode).toBe(400);
    const criada = await como(gente.admin, 'POST', '/api/automacoes', {
      nome: 'Tarefa · Entrada de leads',
      ligada: true,
      gatilho: { tipo: 'entrou_na_etapa', etapaId: entrada },
      passos: [{ tipo: 'criar_tarefa', titulo: 'Ligar para {primeiro_nome}', em_minutos: 30, prioridade: 'alta' }, { tipo: 'distribuir_rodizio' }, { tipo: 'pesquisa_nps' }],
    });
    expect(criada.statusCode, criada.body).toBe(201);
    expect(criada.json()).toMatchObject({ gatilho: { tipo: 'entrou_na_etapa', etapaId: entrada }, passos: [{ tipo: 'criar_tarefa', em_minutos: 30, prioridade: 'alta' }, { tipo: 'distribuir_rodizio' }, { tipo: 'pesquisa_nps' }] });
    // Aparece na lista ligada à etapa (é o que a caixa da etapa mostra).
    const lista = (await como(gente.admin, 'GET', '/api/automacoes')).json() as Array<{ gatilho: { etapaId?: string } }>;
    expect(lista.filter((a) => a.gatilho.etapaId === entrada)).toHaveLength(1);

    const c = await conversa('norte', 'Helena Souza');
    expect(tarefas).toEqual([{ conversaId: c.id, titulo: 'Ligar para Helena', venceEm: new Date(relogio.t.getTime() + 30 * 60_000), prioridade: 'alta' }]);
    expect(pedidosRodizio).toEqual([c.id]);
    // A pesquisa saiu (mensagem de automação não conta como resposta: continua na Entrada).
    expect(m.enviados.map((e) => e.texto)).toEqual([expect.stringContaining('Oi, Helena! Obrigado por falar com a gente. De 0 a 10')]);
    expect((await m.buscar(c.id)).etapa).toBe('entrada');
    const pesquisas = (await m.nps!.daConversa(c.id)).pesquisas;
    expect(pesquisas[0]).toMatchObject({ estado: 'aguardando_nota', finalizacaoId: null });
    // A nota da cliente é lida como na pesquisa de sempre.
    await m.escreve(c, '10');
    expect((await m.nps!.daConversa(c.id)).pesquisas[0]).toMatchObject({ nota: 10 });
  });

  it.runIf(amb.nome === 'postgres')('migração 720: cria a Entrada nos funis que já existiam, sem mover ninguém, e o banco aceita a etapa', async () => {
    const { como, gente, conversa, pool, buscar, tags } = await montarFunis(amb);
    const vendas = (await como(gente.admin, 'POST', '/api/funis', { nome: 'Vendas antigas', etapas: [{ nome: 'Lead' }] })).json() as FunilJson;
    const [entrada, lead] = vendas.etapas;
    const c = await conversa('norte', 'Iara');
    await como(gente.admin, 'POST', `/api/conversas/${c.id}/funis/${vendas.id}`, { etapaId: lead!.id });
    // Como era antes: sem a Entrada no funil da empresa.
    await pool!.query('delete from sintonia.tags where id = $1', [entrada!.id]);
    const sql = readFileSync(new URL('../db/migrations/720_etapa_entrada.sql', import.meta.url), 'utf8');
    const cli = await pool!.connect();
    try {
      for (let i = 0; i < 2; i++) { // roda duas vezes: não estraga nada
        await cli.query('begin');
        await cli.query(sql);
        await cli.query('commit');
      }
    } finally {
      cli.release();
    }
    const { rows } = await pool!.query<{ nome: string; cor: string; ordem: number }>("select nome, cor, ordem from sintonia.tags where funil_id = $1 and chave_sistema = 'entrada'", [vendas.id]);
    expect(rows).toEqual([{ nome: 'Entrada de leads', cor: '#94a3b8', ordem: -1 }]);
    expect(await tags.temTag(c.id, lead!.id)).toBe(true); // ninguém mudou de etapa
    const { rows: n } = await pool!.query<{ n: number }>("select count(*)::int as n from sintonia.tags t join sintonia.funis f on f.id = t.funil_id where t.chave_sistema = 'entrada' and f.empresa_id = 'imperio'");
    expect(n[0]!.n).toBe(2);
    // A regra do banco aceita 'entrada' e continua recusando etapa que não existe.
    await pool!.query("update sintonia.conversas set etapa = 'entrada' where id = $1", [c.id]);
    expect((await buscar(c.id)).etapa).toBe('entrada');
    await expect(pool!.query("update sintonia.conversas set etapa = 'qualquer' where id = $1", [c.id])).rejects.toThrow();
  });
});

describe.each(ambientes)('Caixa da etapa: bots já ligados à etapa ($nome)', (amb) => {
  it('o bot criado pela caixa (Agente de IA ou Webhook) nasce com o gatilho da etapa e os blocos ligados, vazios para preencher', async () => {
    const m = await montarBot(amb);
    const entrada = m.etapasSistema.get('entrada')!;
    // O mesmo rascunho que /telas/bot.js monta (rascunhoInicial): Início → bloco → Fim.
    const rascunho = (tipo: 'agente_ia' | 'webhook') => ({
      nos: [
        { id: 'inicio', tipo: 'inicio', x: 0, y: 0, gatilho: { tipo: 'entrou_na_etapa', etapaId: entrada } },
        tipo === 'agente_ia' ? { id: 'b1', tipo, x: 0, y: 170, objetivo: '', saida: { tipo: 'agendou' }, dias: 3 } : { id: 'b1', tipo, x: 0, y: 170, url: '' },
        { id: 'b2', tipo: 'fim', x: 0, y: 340 },
      ],
      ligacoes: [
        { id: 'l1', de: 'inicio', saida: 'proximo', para: 'b1' },
        { id: 'l2', de: 'b1', saida: tipo === 'agente_ia' ? 'concluiu' : 'ok', para: 'b2' },
      ],
    });
    for (const [tipo, falta] of [['agente_ia', 'objetivo'], ['webhook', 'http']] as const) {
      const r = await m.como(m.gente.admin, 'POST', '/api/bots', { nome: `${tipo} · Entrada de leads`, rascunho: rascunho(tipo) });
      expect(r.statusCode, r.body).toBe(201);
      const b = (await m.como(m.gente.admin, 'GET', `/api/bots/${r.json().id}`)).json() as { problemas: Array<{ nivel: string; mensagem: string }> };
      const erros = b.problemas.filter((p) => p.nivel === 'erro').map((p) => p.mensagem);
      expect(erros).toHaveLength(1);
      expect(erros[0]).toContain(falta);
      const lista = (await m.como(m.gente.admin, 'GET', '/api/bots')).json() as Array<{ id: string; gatilho: { tipo: string; etapaId?: string } }>;
      expect(lista.find((x) => x.id === r.json().id)!.gatilho).toEqual({ tipo: 'entrou_na_etapa', etapaId: entrada });
    }
  });
});
