import { describe, expect, it } from 'vitest';
import { Agente } from '../src/ai/agente.js';
import { ArmazemBaseMemoria, BaseConhecimento, montarTexto, secoesDoMarkdown, VERSOES_GUARDADAS } from '../src/ai/base.js';
import type { Agenda } from '../src/ai/ferramentas.js';
import { carregarBase } from '../src/ai/prompt.js';
import { simularResposta } from '../src/ai/simulacao.js';
import { decidirQuemResponde } from '../src/engine/atendimento.js';
import { UNIDADES } from '../src/unidades.js';
import { bahia, MIN } from '../src/util/tempo.js';
import { AgenteFalso, ambientes, montarGestao, quinta } from './gestao-ambiente.js';

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
const fim = (t: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const systemDe = (p: Record<string, unknown>) => (p.system as Array<{ text: string }>)[0]!.text;

describe.each(ambientes)('Configuração da IA ($nome)', (amb) => {
  it('só a gestão lê e muda, e o padrão é o comportamento de hoje', async () => {
    const { gente, como } = await montarGestao(amb, { iaLigada: () => true });
    // A atendente não configura a IA: nem lê a configuração.
    expect((await como(gente.carla, 'GET', '/api/ia/config')).statusCode).toBe(403);
    const padrao = (await como(gente.gerenteNorte, 'GET', '/api/ia/config')).json();
    expect(padrao).toEqual({ modoPadrao: 'copiloto', assumirSemResposta: { ligado: true, minutos: 15 }, marcarTags: false, iaLigada: true });
    expect((await como(gente.carla, 'PATCH', '/api/ia/config', { modoPadrao: 'ia' })).statusCode).toBe(403);
    expect((await como(gente.rita, 'PATCH', '/api/ia/config', { modoPadrao: 'ia' })).statusCode).toBe(403);
    expect((await como(gente.gerenteNorte, 'PATCH', '/api/ia/config', { assumirSemResposta: { minutos: 0 } })).statusCode).toBe(400);
    expect((await como(gente.gerenteNorte, 'PATCH', '/api/ia/config', { modoPadrao: 'robo' })).statusCode).toBe(400);
    const r = await como(gente.gerenteNorte, 'PATCH', '/api/ia/config', { assumirSemResposta: { minutos: 30 } });
    expect(r.json()).toMatchObject({ modoPadrao: 'copiloto', assumirSemResposta: { ligado: true, minutos: 30 } });
    expect((await como(gente.direcao, 'PATCH', '/api/ia/config', { modoPadrao: 'humano', marcarTags: true })).json()).toMatchObject({
      modoPadrao: 'humano',
      assumirSemResposta: { ligado: true, minutos: 30 },
      marcarTags: true,
    });
  });

  it('conversa nova nasce no modo padrão (sem reiniciar)', async () => {
    const { gente, como, conversa, enviados } = await montarGestao(amb);
    expect((await conversa('norte', 'Marina')).modo).toBe('copiloto');
    await como(gente.admin, 'PATCH', '/api/ia/config', { modoPadrao: 'humano' });
    const so = await conversa('norte', 'Joana');
    expect(so.modo).toBe('humano');
    await como(gente.admin, 'PATCH', '/api/ia/config', { modoPadrao: 'ia' });
    const antes = enviados.length;
    const ia = await conversa('sumare', 'Paula');
    expect(ia.modo).toBe('ia');
    expect(enviados.length).toBe(antes + 1); // a IA já respondeu
  });

  it('o prazo para a IA assumir usa os minutos configurados; desligado, ela só sugere', async () => {
    const { gente, como, conversa, sintonia, relogio, repo, enviados } = await montarGestao(amb);
    await como(gente.admin, 'PATCH', '/api/ia/config', { assumirSemResposta: { minutos: 30 } });
    const c = await conversa('norte', 'Marina');
    relogio.t = quinta(14, 16);
    await sintonia.tick();
    expect(enviados).toHaveLength(0); // com 15 min de antes, já teria assumido
    expect((await repo.tarefasPendentes(c.id)).find((t) => t.tipo === 'reavaliar')!.quando).toEqual(quinta(14, 30));
    relogio.t = quinta(14, 30);
    await sintonia.tick();
    expect(enviados).toHaveLength(1);
    expect((await repo.buscarConversa(c.id))!.modo).toBe('ia');

    // Desligado: em horário de loja só sugere; reavalia no fechamento (aí vale a regra de fora do horário).
    await como(gente.admin, 'PATCH', '/api/ia/config', { assumirSemResposta: { ligado: false } });
    const d = await conversa('norte', 'Joana');
    relogio.t = quinta(16);
    await sintonia.tick();
    expect(enviados.filter((e) => e.telefone === d.telefone)).toHaveLength(0);
    const reav = (await repo.tarefasPendentes(d.id)).find((t) => t.tipo === 'reavaliar')!;
    expect(reav.quando.getTime()).toBeGreaterThan(quinta(16).getTime());
  });

  it('regra pura: assumirLigado=false nunca assume em horário de loja', () => {
    const c = {
      id: 'c', empresaId: 'imperio', unidade: 'norte' as const, canalId: 'x', telefone: '1', modo: 'copiloto' as const, etapa: 'novo_lead' as const,
      etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9), ultimaMensagemCliente: quinta(10),
    };
    const d = decidirQuemResponde(c, UNIDADES.norte, new Date(quinta(10).getTime() + 300 * MIN), { assumirAposMin: 15, pausaAposEquipeMin: 10, assumirLigado: false });
    expect(d.acao).toBe('sugerir');
    // De madrugada a IA continua respondendo.
    expect(decidirQuemResponde({ ...c, ultimaMensagemCliente: bahia(2026, 11, 6, 2) }, UNIDADES.norte, bahia(2026, 11, 6, 2, 1), { assumirAposMin: 15, pausaAposEquipeMin: 10, assumirLigado: false }).acao).toBe('ia_responde');
  });
});

describe.each(ambientes)('Treinamento da IA: base de conhecimento ($nome)', (amb) => {
  it('nasce do arquivo, mostra [PREENCHER], edita com histórico e só a gestão mexe', async () => {
    const { gente, como } = await montarGestao(amb);
    for (const url of ['/api/ia/base', '/api/ia/base/texto', '/api/ia/perguntas', '/api/ia/hoje']) expect((await como(gente.carla, 'GET', url)).statusCode).toBe(403);
    const b = (await como(gente.gerenteNorte, 'GET', '/api/ia/base')).json();
    expect(b.secoes.map((s: { chave: string }) => s.chave)).toEqual(['quem-somos', 'jeito-de-falar', 'perguntas-frequentes']);
    expect(b.secoes[0]).toMatchObject({ titulo: 'Quem somos', atualizadaPor: 'semente', pendencias: 1 });
    expect(b.pendencias).toEqual([
      { chave: 'quem-somos', titulo: 'Quem somos', linha: 2, trecho: '- Endereço: [PREENCHER]' },
      { chave: 'perguntas-frequentes', titulo: 'Perguntas frequentes', linha: 1, trecho: '[PREENCHER — cole aqui as perguntas]' },
    ]);

    expect((await como(gente.carla, 'PUT', '/api/ia/base/quem-somos', { conteudo: 'x' })).statusCode).toBe(403);
    expect((await como(gente.gerenteNorte, 'PUT', '/api/ia/base/nao-existe', { conteudo: 'x' })).statusCode).toBe(404);
    const ed = await como(gente.gerenteNorte, 'PUT', '/api/ia/base/quem-somos', { conteudo: '- Império Progressivas.\n- Endereço: Piso L2, loja 210' });
    expect(ed.json()).toMatchObject({ chave: 'quem-somos', atualizadaPor: 'Gil Norte' });
    const depois = (await como(gente.gerenteNorte, 'GET', '/api/ia/base')).json();
    expect(depois.pendencias.map((p: { chave: string }) => p.chave)).toEqual(['perguntas-frequentes']);

    expect((await como(gente.carla, 'GET', '/api/ia/base/quem-somos/historico')).statusCode).toBe(403);
    const hist = (await como(gente.gerenteNorte, 'GET', '/api/ia/base/quem-somos/historico')).json();
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ por: 'Gil Norte' });
    expect(hist[0].conteudo).toContain('loja 210');
    expect(hist[1]).toMatchObject({ por: 'semente' });

    // Seção nova e perguntas frequentes.
    const nova = await como(gente.direcao, 'POST', '/api/ia/base', { titulo: 'Unidades e horários', conteudo: 'Seg a sáb, 10h às 22h.' });
    expect(nova.statusCode).toBe(201);
    expect(nova.json()).toMatchObject({ chave: 'unidades-e-horarios', ordem: 3 });
    expect((await como(gente.direcao, 'POST', '/api/ia/base', { titulo: 'Unidades e horários', conteudo: '' })).statusCode).toBe(409);
    expect((await como(gente.carla, 'POST', '/api/ia/perguntas', { pergunta: 'Tem estacionamento?', resposta: 'Sim' })).statusCode).toBe(403);
    const p = await como(gente.gerenteNorte, 'POST', '/api/ia/perguntas', { pergunta: 'Tem estacionamento?', resposta: 'Sim, o do shopping.' });
    expect(p.statusCode).toBe(201);
    const id = p.json().id as string;
    await como(gente.gerenteNorte, 'PATCH', `/api/ia/perguntas/${id}`, { resposta: 'Sim, o do shopping (2h grátis).' });
    const texto = (await como(gente.gerenteNorte, 'GET', '/api/ia/base/texto')).json().texto as string;
    expect(texto).toContain('Endereço: Piso L2, loja 210');
    expect(texto).toContain('## Unidades e horários\nSeg a sáb, 10h às 22h.');
    expect(texto).toMatch(/## Perguntas frequentes\n\[PREENCHER — cole aqui as perguntas\]\n- Pergunta: Tem estacionamento\?\n {2}Resposta: Sim, o do shopping \(2h grátis\)\./);
    expect(texto).not.toContain('Título que não vira seção');
    expect((await como(gente.gerenteNorte, 'DELETE', `/api/ia/perguntas/${id}`)).json()).toEqual({ ok: true });
    expect((await como(gente.gerenteNorte, 'DELETE', `/api/ia/perguntas/${id}`)).statusCode).toBe(404);
    expect((await como(gente.admin, 'DELETE', '/api/ia/base/unidades-e-horarios')).json()).toEqual({ ok: true });
  });

  it('o agente usa sempre a versão mais nova do banco (sem reiniciar)', async () => {
    const { base, gente, como } = await montarGestao(amb);
    const claude = claudeFalso([fim('a'), fim('b')]);
    const agente = new Agente(claude, {} as Agenda, () => base.texto(), { modelo: 'claude-opus-5-5', esforco: 'low' });
    const conversa = { id: 'c', empresaId: 'imperio', unidade: 'norte' as const, canalId: 'x', telefone: '1', modo: 'ia' as const, etapa: 'novo_lead' as const, etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9) };
    const pedido = { conversa, mensagens: [{ id: '1', conversaId: 'c', autor: 'cliente' as const, texto: 'oi', em: quinta(9) }], agora: quinta(9), modo: 'responder' as const };
    await agente.executar(pedido);
    expect(systemDe(claude.recebidos[0]!)).toContain('Curto e caloroso.');
    await como(gente.admin, 'PUT', '/api/ia/base/jeito-de-falar', { conteudo: 'Sempre chame de "rainha".' });
    await agente.executar(pedido);
    expect(systemDe(claude.recebidos[1]!)).toContain('Sempre chame de "rainha".');
    expect(systemDe(claude.recebidos[1]!)).not.toContain('Curto e caloroso.');
  });
});

describe('Base de conhecimento: semente e histórico', () => {
  it('as seções do knowledge/imperio.md viram a semente', () => {
    const s = secoesDoMarkdown(carregarBase());
    expect(s.map((x) => x.chave)).toEqual(['quem-somos', 'jeito-de-falar', 'servicos', 'regras-comerciais', 'quando-passar-para-uma-pessoa-da-equipe', 'perguntas-frequentes']);
    expect(s[0]!.conteudo).toContain('Salvador Norte Shopping');
  });

  it('guarda só as últimas versões e não semeia de novo quem já tem base', async () => {
    const armazem = new ArmazemBaseMemoria();
    const b = new BaseConhecimento(armazem, 'imperio', () => '## A\nx', { cacheMs: 0 });
    for (let i = 0; i < VERSOES_GUARDADAS + 5; i++) await b.editar('a', { conteudo: `v${i}` }, 'eu');
    const h = await b.historico('a', 100);
    expect(h).toHaveLength(VERSOES_GUARDADAS);
    expect(h[0]!.conteudo).toBe(`v${VERSOES_GUARDADAS + 4}`);
    const outra = new BaseConhecimento(armazem, 'imperio', () => '## B\ny', { cacheMs: 0 });
    expect((await outra.secoes()).map((x) => x.chave)).toEqual(['a']);
    expect(montarTexto([], [])).toContain('[PREENCHER]');
  });
});

describe.each(ambientes)('Testar a IA ($nome)', (amb) => {
  it('responde com a base atual, sem enviar nada nem gravar conversa', async () => {
    const claude = claudeFalso([fim('Oi! A progressiva fica R$ 320.'), fim('Segunda resposta')]);
    let base: () => Promise<string> = async () => '';
    const agente = new Agente(claude, {} as Agenda, () => base(), { modelo: 'claude-opus-5-5', esforco: 'low' });
    const g = await montarGestao(amb, { iaLigada: () => true, simularIa: (p) => simularResposta(agente, 'imperio', { ...p, agora: quinta(14) }) });
    base = () => g.base.texto();

    expect((await g.como(g.gente.carla, 'POST', '/api/ia/testar', { mensagem: 'Quanto custa?' })).statusCode).toBe(403);
    const r = await g.como(g.gente.gerenteNorte, 'POST', '/api/ia/testar', { mensagem: 'Quanto custa?' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ resposta: 'Oi! A progressiva fica R$ 320.', acoes: [], recusou: false });
    const pedido = claude.recebidos[0]!;
    expect(systemDe(pedido)).toContain('Curto e caloroso.');
    // Simulação: sem ferramentas de escrita e sem instrução de copiloto.
    const nomes = (pedido.tools as Array<{ name: string }>).map((t) => t.name);
    expect(nomes).not.toContain('agendar');
    expect(nomes).not.toContain('passar_para_humano');
    expect(JSON.stringify(pedido.messages)).not.toContain('modo copiloto');

    // Com histórico (várias trocas).
    await g.como(g.gente.admin, 'POST', '/api/ia/testar', { mensagem: 'E sábado?', historico: [{ autor: 'cliente', texto: 'Oi' }, { autor: 'ia', texto: 'Olá!' }] });
    const msgs = claude.recebidos[1]!.messages as Array<{ role: string; content: string }>;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);

    expect(g.enviados).toHaveLength(0);
    expect(await g.repo.listarConversas()).toHaveLength(0);
    expect(await g.repo.eventosEntre(quinta(0), quinta(23))).toHaveLength(0);
  });

  it('sem chave da IA dá erro claro; sem o recurso, 501', async () => {
    const g = await montarGestao(amb, { iaLigada: () => false, simularIa: async () => ({ resposta: 'x', acoes: [], recusou: false }) });
    const r = await g.como(g.gente.admin, 'POST', '/api/ia/testar', { mensagem: 'Oi' });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ codigo: 'ia_sem_chave' });
    expect(r.json().erro).toContain('Conexões');
    const sem = await montarGestao(amb);
    expect((await sem.como(sem.gente.admin, 'POST', '/api/ia/testar', { mensagem: 'Oi' })).statusCode).toBe(501);
    expect((await sem.como(sem.gente.admin, 'POST', '/api/ia/testar', { mensagem: '' })).statusCode).toBe(400);
  });
});

describe.each(ambientes)('Aba IA: o que a IA fez hoje ($nome)', (amb) => {
  it('conta atendimentos, agendamentos, pedidos de ajuda, envios, tempo e quem ela conduz agora — só do visível', async () => {
    const agente = new AgenteFalso((p) =>
      p.conversa.nome === 'Joana'
        ? { texto: 'Vou chamar a equipe', acoes: [{ tipo: 'passar_para_humano', motivo: 'Reclamação' }], recusou: false }
        : p.conversa.nome === 'Paula'
          ? {
              texto: 'Agendado!',
              acoes: [{ tipo: 'agendou', clienteTrinksId: 1, agendamento: { trinksId: 9, unidade: 'sumare', servico: 'Progressiva', inicio: quinta(16), duracaoMin: 180 } }],
              recusou: false,
            }
          : { texto: 'Oi! Posso ajudar?', acoes: [], recusou: false },
    );
    // Madrugada: a IA responde sozinha.
    const g = await montarGestao(amb, { agente, inicio: quinta(2) });
    const m = await g.conversa('norte', 'Marina');
    await g.conversa('norte', 'Joana');
    g.relogio.t = quinta(2, 5);
    await g.conversa('sumare', 'Paula');
    // Lembrete enviado pela IA (tarefa ativa).
    await g.repo.programar({ conversaId: m.id, tipo: 'lembrete_2h', quando: quinta(2, 6) });
    g.relogio.t = quinta(2, 10);
    await g.sintonia.tick();

    const hoje = (await g.como(g.gente.admin, 'GET', '/api/ia/hoje')).json();
    expect(hoje).toMatchObject({
      dia: '2026-11-05',
      conversasAtendidas: 3,
      respostas: 3,
      assumiu: 3,
      agendamentos: { total: 1 },
      pediuAjuda: { total: 1 },
      envios: { total: 1, lembretes: 1, followups: 0, porTipo: { lembrete_2h: 1 } },
    });
    expect(hoje.agendamentos.lista[0]).toMatchObject({ cliente: 'Paula', servico: 'Progressiva' });
    expect(hoje.pediuAjuda.lista[0]).toMatchObject({ cliente: 'Joana', motivo: 'Reclamação' });
    expect(hoje.tempoMedioRespostaSeg).toBe(0);
    // Joana passou para a equipe (modo humano): não conta como "conduzindo".
    expect(hoje.conduzindoAgora.map((c: { nome: string }) => c.nome).sort()).toEqual(['Marina', 'Paula']);
    const marina = hoje.conduzindoAgora.find((c: { nome: string }) => c.nome === 'Marina');
    expect(marina).toMatchObject({ unidade: 'norte', haMin: 0, ultimaMensagem: { autor: 'ia' } });

    const norte = (await g.como(g.gente.gerenteNorte, 'GET', '/api/ia/hoje')).json();
    expect(norte).toMatchObject({ conversasAtendidas: 2, agendamentos: { total: 0 }, pediuAjuda: { total: 1 } });
    // Atendente não abre a tela Inteligência (ela usa o chat "Ajuda da IA").
    expect((await g.como(g.gente.rita, 'GET', '/api/ia/hoje')).statusCode).toBe(403);

    // Três horas depois ninguém mais está sendo conduzido agora.
    g.relogio.t = quinta(5, 30);
    expect((await g.como(g.gente.admin, 'GET', '/api/ia/hoje')).json().conduzindoAgora).toEqual([]);
  });
});

describe.each(ambientes)('Empresa ($nome)', (amb) => {
  it('todos leem o nome; só direção e admin mudam', async () => {
    const { gente, como } = await montarGestao(amb);
    expect((await como(gente.carla, 'GET', '/api/empresa')).json()).toMatchObject({ id: 'imperio', nome: 'Império Progressivas' });
    expect((await como(gente.gerenteNorte, 'PATCH', '/api/empresa', { nome: 'Outra' })).statusCode).toBe(403);
    expect((await como(gente.carla, 'PATCH', '/api/empresa', { nome: 'Outra' })).statusCode).toBe(403);
    expect((await como(gente.direcao, 'PATCH', '/api/empresa', { nome: 'x' })).statusCode).toBe(400);
    const r = await como(gente.direcao, 'PATCH', '/api/empresa', { nome: '  Império Progressivas Bahia ' });
    expect(r.json()).toMatchObject({ nome: 'Império Progressivas Bahia', atualizadaPor: 'Diana Reis' });
    expect((await como(gente.rita, 'GET', '/api/empresa')).json().nome).toBe('Império Progressivas Bahia');
    expect((await como(gente.admin, 'PATCH', '/api/empresa', { nome: 'Império' })).statusCode).toBe(200);
  });
});
