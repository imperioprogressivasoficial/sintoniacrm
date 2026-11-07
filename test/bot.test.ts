import { describe, expect, it } from 'vitest';
import { casarOpcao, Grafo, problemasDoGrafo, textoComOpcoes, validarResposta } from '../src/bot/esquema.js';
import { MODELOS } from '../src/bot/modelos.js';
import { AgenteFalso, ambientes, montarBot, quinta } from './bot-ambiente.js';

type Exec = { id: string; status: string; erro: string | null; estado: { noAtual: string | null; caminho: string[]; vars: Record<string, string>; espera: { tipo: string } | null; emExecucao: string | null }; log: Array<{ detalhe: string; tipo: string }> };

/** Monta um grafo a partir de blocos e linhas [de, saída, para]. */
const grafo = (nos: Array<Record<string, unknown>>, ligs: Array<[string, string, string]>) =>
  Grafo.parse({ nos, ligacoes: ligs.map(([de, saida, para], i) => ({ id: `l${i}`, de, saida, para })) });

async function preparar(amb: (typeof ambientes)[number], opcoes: Parameters<typeof montarBot>[1] = {}) {
  const m = await montarBot(amb, opcoes);
  /** Cria, publica e liga um bot com o grafo. */
  const bot = async (nome: string, g: ReturnType<typeof grafo>, ligar = true) => {
    const r = await m.como(m.gente.admin, 'POST', '/api/bots', { nome, rascunho: g });
    if (r.statusCode !== 201) throw new Error(`criar bot: ${r.statusCode} ${r.body}`);
    const f = r.json() as { id: string };
    const p = await m.como(m.gente.admin, 'POST', `/api/bots/${f.id}/publicar`);
    if (p.statusCode !== 200) throw new Error(`publicar: ${p.statusCode} ${p.body}`);
    if (ligar) expect((await m.como(m.gente.admin, 'POST', `/api/bots/${f.id}/ligar`)).statusCode).toBe(200);
    return f;
  };
  const execucoes = async (id: string) => (await m.como(m.gente.admin, 'GET', `/api/bots/${id}/execucoes`)).json() as Exec[];
  return { ...m, bot, execucoes };
}

const MENU = grafo(
  [
    { id: 'ini', tipo: 'inicio', gatilho: { tipo: 'palavra_chave', palavras: ['menu'] } },
    { id: 'oi', tipo: 'mensagem', texto: 'Oi, {primeiro_nome}! Aqui é da {unidade}.' },
    { id: 'p', tipo: 'pergunta', texto: 'Como posso ajudar?', variavel: 'servico', tentativas: 1, opcoes: [{ id: 'prog', texto: 'Progressiva' }, { id: 'sel', texto: 'Selagem' }, { id: 'hum', texto: 'Falar com atendente' }] },
    { id: 'm1', tipo: 'mensagem', texto: 'Você escolheu {servico}.' },
    { id: 'h', tipo: 'transferir', texto: 'Já chamei uma atendente.' },
    { id: 'fim', tipo: 'fim' },
  ],
  [
    ['ini', 'proximo', 'oi'],
    ['oi', 'proximo', 'p'],
    ['p', 'prog', 'm1'],
    ['p', 'sel', 'm1'],
    ['p', 'hum', 'h'],
    ['p', 'outro', 'h'],
    ['m1', 'proximo', 'fim'],
  ],
);

describe('Bots: funções puras', () => {
  it('valida o grafo: início, ligações, pergunta sem opções, saída solta', () => {
    expect(problemasDoGrafo(grafo([], [])).map((p) => p.mensagem)).toContain('Falta o bloco Início.');
    const g = grafo(
      [
        { id: 'a', tipo: 'inicio' },
        { id: 'b', tipo: 'pergunta', texto: 'Qual?', opcoes: [] },
        { id: 'c', tipo: 'mensagem', texto: '' },
        { id: 'd', tipo: 'mensagem', texto: 'solto' },
      ],
      [
        ['a', 'proximo', 'b'],
        ['b', 'naoexiste', 'c'],
        ['c', 'proximo', 'a'],
      ],
    );
    const p = problemasDoGrafo(g);
    const erros = p.filter((x) => x.nivel === 'erro').map((x) => x.mensagem);
    expect(erros).toEqual(expect.arrayContaining(['Pergunta com opções: a pergunta precisa de pelo menos uma opção.', 'Pergunta com opções: saída "naoexiste" não existe.', 'Nenhuma linha pode entrar no Início.', 'Enviar mensagem: escreva a mensagem (ou escolha uma imagem).']));
    const avisos = p.filter((x) => x.nivel === 'aviso');
    expect(avisos.some((x) => x.noId === 'd' && x.mensagem.includes('nenhum caminho'))).toBe(true);
    expect(avisos.some((x) => x.noId === 'd' && x.mensagem.includes('não está ligada'))).toBe(true);
    // Uma saída, uma linha.
    const dupla = grafo([{ id: 'a', tipo: 'inicio' }, { id: 'b', tipo: 'fim' }, { id: 'c', tipo: 'fim' }], [['a', 'proximo', 'b'], ['a', 'proximo', 'c']]);
    expect(problemasDoGrafo(dupla).some((x) => x.mensagem.includes('uma saída só pode ter uma linha'))).toBe(true);
    expect(problemasDoGrafo(MENU).filter((x) => x.nivel === 'erro')).toEqual([]);
    for (const m of MODELOS) expect(problemasDoGrafo(Grafo.parse(m.grafo)).filter((x) => x.nivel === 'erro'), m.id).toEqual([]);
  });

  it('entende a resposta da cliente e valida a pergunta aberta', () => {
    const ops = [{ id: 'a', texto: 'Progressiva' }, { id: 'b', texto: 'Selagem' }, { id: 'c', texto: 'Preços' }];
    expect(casarOpcao('2', ops)?.id).toBe('b');
    expect(casarOpcao(' 3. ', ops)?.id).toBe('c');
    expect(casarOpcao('1️⃣', ops)?.id).toBe('a');
    expect(casarOpcao('dois', ops)?.id).toBe('b');
    expect(casarOpcao('quero a SELAGEM', ops)?.id).toBe('b');
    expect(casarOpcao('preço', ops)?.id).toBe('c');
    expect(casarOpcao('9', ops)).toBeUndefined();
    expect(casarOpcao('talvez', ops)).toBeUndefined();
    expect(textoComOpcoes('Qual?', ops)).toBe('Qual?\n\n1. Progressiva\n2. Selagem\n3. Preços\n\nResponda com o número da opção.');
    expect(validarResposta('Ana@Mail.com', 'email')).toBe('ana@mail.com');
    expect(validarResposta('ana@', 'email')).toBeUndefined();
    expect(validarResposta('(71) 98888-7777', 'telefone')).toBe('71988887777');
    expect(validarResposta('12', 'telefone')).toBeUndefined();
    expect(validarResposta('3,5', 'numero')).toBe('3.5');
    expect(validarResposta('três', 'numero')).toBeUndefined();
    expect(validarResposta('25/12/2026', 'data')).toBe('2026-12-25');
    expect(validarResposta('31/02/2026', 'data')).toBeUndefined();
  });
});

describe.each(ambientes)('Bots ($nome)', (amb) => {
  it('cadastro: modelos, rascunho × publicado, publicar recusa com problemas, ligar só publicado, permissões', async () => {
    const { como, gente } = await preparar(amb);
    const modelos = (await como(gente.admin, 'GET', '/api/bots/modelos')).json() as Array<{ id: string }>;
    expect(modelos.map((x) => x.id)).toEqual(['boas_vindas_menu', 'fora_do_horario', 'qualificacao']);
    expect((await como(gente.carla, 'GET', '/api/bots')).statusCode).toBe(403);
    const r = await como(gente.admin, 'POST', '/api/bots', { nome: 'Boas-vindas', modelo: 'boas_vindas_menu' });
    expect(r.statusCode).toBe(201);
    const f = r.json() as { id: string; ligado: boolean; versao: number; publicado: unknown; rascunho: { nos: unknown[] } };
    expect(f).toMatchObject({ ligado: false, versao: 0, publicado: null });
    expect(f.rascunho.nos.length).toBeGreaterThan(5);
    // Ligar sem publicar: 409.
    expect((await como(gente.admin, 'POST', `/api/bots/${f.id}/ligar`)).statusCode).toBe(409);
    // Rascunho com problema: salva, mas não publica.
    const ruim = grafo([{ id: 'i', tipo: 'inicio', gatilho: { tipo: 'nova_conversa' } }, { id: 'p', tipo: 'pergunta', texto: 'Qual?' }], [['i', 'proximo', 'p']]);
    const salvo = await como(gente.admin, 'PATCH', `/api/bots/${f.id}`, { rascunho: ruim });
    expect(salvo.statusCode).toBe(200);
    expect((salvo.json() as { problemas: Array<{ noId: string; nivel: string }> }).problemas).toEqual(expect.arrayContaining([expect.objectContaining({ noId: 'p', nivel: 'erro' })]));
    const pub = await como(gente.admin, 'POST', `/api/bots/${f.id}/publicar`);
    expect(pub.statusCode).toBe(400);
    expect((pub.json() as { problemas: unknown[] }).problemas.length).toBeGreaterThan(0);
    // Etapa que não existe também barra.
    await como(gente.admin, 'PATCH', `/api/bots/${f.id}`, { rascunho: grafo([{ id: 'i', tipo: 'inicio', gatilho: { tipo: 'nova_conversa' } }, { id: 't', tipo: 'marcar_tag', tagId: 'nao-existe' }], [['i', 'proximo', 't']]) });
    expect((await como(gente.admin, 'POST', `/api/bots/${f.id}/publicar`)).statusCode).toBe(400);
    await como(gente.admin, 'PATCH', `/api/bots/${f.id}`, { rascunho: MENU });
    const ok = (await como(gente.admin, 'POST', `/api/bots/${f.id}/publicar`)).json() as { versao: number; publicado: unknown };
    expect(ok.versao).toBe(1);
    expect((await como(gente.admin, 'POST', `/api/bots/${f.id}/ligar`)).json()).toMatchObject({ ligado: true });
    // Mexer no rascunho não muda o publicado.
    await como(gente.admin, 'PATCH', `/api/bots/${f.id}`, { nome: 'Menu', rascunho: ruim });
    const lista = (await como(gente.admin, 'GET', '/api/bots')).json() as Array<{ nome: string; rascunhoDiferente: boolean; versao: number }>;
    expect(lista).toEqual([expect.objectContaining({ nome: 'Menu', rascunhoDiferente: true, versao: 1 })]);
    expect((await como(gente.admin, 'DELETE', `/api/bots/${f.id}`)).json()).toEqual({ ok: true });
    expect((await como(gente.admin, 'GET', `/api/bots/${f.id}`)).statusCode).toBe(404);
  });

  it('pergunta com opções: lista numerada, retoma na resposta, resposta inválida pergunta de novo, variável e transferir', async () => {
    const { bot, conversa, escreve, enviadosPara, execucoes, buscar } = await preparar(amb);
    const f = await bot('Menu', MENU);
    const c = await conversa('norte', 'Marina Souza', 'quero ver o menu');
    expect(enviadosPara(c)).toEqual(['Oi, Marina! Aqui é da Salvador Norte Shopping.', textoComOpcoes('Como posso ajudar?', [{ id: '1', texto: 'Progressiva' }, { id: '2', texto: 'Selagem' }, { id: '3', texto: 'Falar com atendente' }])]);
    let [e] = await execucoes(f.id);
    expect(e).toMatchObject({ status: 'pendente', estado: { noAtual: 'p', espera: { tipo: 'resposta' } } });
    await escreve(c, 'sei lá');
    expect(enviadosPara(c).at(-1)).toContain('Não entendi');
    await escreve(c, '2');
    expect(enviadosPara(c).at(-1)).toBe('Você escolheu Selagem.');
    [e] = await execucoes(f.id);
    expect(e).toMatchObject({ status: 'concluida', estado: { vars: { servico: 'Selagem' } } });
    expect(e!.estado.caminho).toEqual(['ini', 'oi', 'p', 'm1', 'fim']);
    // Outra cliente: duas respostas erradas → "Não entendeu" → transferir.
    const d = await conversa('norte', 'Bia', 'menu');
    await escreve(d, 'hmm');
    await escreve(d, 'nada');
    expect(enviadosPara(d).at(-1)).toBe('Já chamei uma atendente.');
    expect(await buscar(d.id)).toMatchObject({ modo: 'humano', etiquetas: expect.arrayContaining(['precisa da equipe']) });
  });

  it('bot responde antes da IA, e a IA fica quieta enquanto o bot espera a resposta', async () => {
    const agente = new AgenteFalso(() => ({ texto: 'Resposta da IA', acoes: [], recusou: false }));
    const { bot, conversa, escreve, enviadosPara, sintonia, agente: ag } = await preparar(amb, { agente });
    await bot('Menu', MENU);
    const c = await conversa('norte', 'Marina', 'Bom dia');
    await sintonia.mudarModo(c.id, 'ia');
    expect(enviadosPara(c)).toEqual(['Resposta da IA']);
    const antes = ag.pedidos.length;
    await escreve(c, 'me manda o menu');
    expect(enviadosPara(c).slice(1, 3)).toEqual(['Oi, Marina! Aqui é da Salvador Norte Shopping.', expect.stringContaining('Como posso ajudar?')]);
    expect(enviadosPara(c)).toHaveLength(3);
    // A cliente escreve algo fora das opções: o bot pergunta de novo, a IA não entra.
    await escreve(c, 'quanto custa?');
    expect(enviadosPara(c).at(-1)).toContain('Não entendi');
    expect(ag.pedidos.length).toBe(antes);
    await escreve(c, '1');
    expect(enviadosPara(c).at(-1)).toBe('Você escolheu Progressiva.');
    expect(ag.pedidos.length).toBe(antes);
    // Bot terminou: a IA volta a responder.
    await escreve(c, 'e o horário?');
    expect(enviadosPara(c).at(-1)).toBe('Resposta da IA');
  });

  it('pergunta aberta com validação salva na ficha; condição pelo campo; ações (tag, etapa, atribuir, modo, lembrete, webhook)', async () => {
    const { bot, conversa, escreve, enviadosPara, execucoes, como, gente, tags, sistema, etapasSistema, webhooks, armazens, buscar } = await preparar(amb);
    const vip = (await como(gente.admin, 'POST', '/api/tags', { nome: 'VIP' })).json() as { id: string };
    const g = grafo(
      [
        { id: 'ini', tipo: 'inicio', gatilho: { tipo: 'palavra_chave', palavras: ['cadastro'] } },
        { id: 'email', tipo: 'pergunta_aberta', texto: 'Qual seu e-mail?', validacao: 'email', variavel: 'email', campo: 'email' },
        { id: 'cond', tipo: 'condicao', condicao: { se: 'campo', campo: 'email', operador: 'contem', valor: 'vip.com' } },
        { id: 'tag', tipo: 'marcar_tag', tagId: vip.id },
        { id: 'mov', tipo: 'mover_etapa', funilId: sistema.id, etapaId: etapasSistema.get('interessada') },
        { id: 'dona', tipo: 'atribuir', usuarioId: gente.carla.id },
        { id: 'lem', tipo: 'lembrete', em_minutos: 30, texto: 'Ligar para {primeiro_nome} ({email})' },
        { id: 'web', tipo: 'webhook', url: 'https://exemplo.com/gancho' },
        { id: 'fim_ok', tipo: 'mensagem', texto: 'Protocolo {webhook_protocolo}. Obrigada!' },
        { id: 'comum', tipo: 'mensagem', texto: 'Obrigada, {primeiro_nome}!' },
      ],
      [
        ['ini', 'proximo', 'email'],
        ['email', 'proximo', 'cond'],
        ['cond', 'sim', 'tag'],
        ['cond', 'nao', 'comum'],
        ['tag', 'proximo', 'mov'],
        ['mov', 'proximo', 'dona'],
        ['dona', 'proximo', 'lem'],
        ['lem', 'proximo', 'web'],
        ['web', 'ok', 'fim_ok'],
      ],
    );
    const f = await bot('Cadastro', g);
    const c = await conversa('norte', 'Marina Souza', 'quero fazer cadastro');
    expect(enviadosPara(c)).toEqual(['Qual seu e-mail?']);
    await escreve(c, 'marina arroba');
    expect(enviadosPara(c).at(-1)).toContain('e-mail não parece certo');
    await escreve(c, 'Marina@VIP.com');
    expect(enviadosPara(c).at(-1)).toBe('Protocolo A123. Obrigada!');
    const [e] = await execucoes(f.id);
    expect(e).toMatchObject({ status: 'concluida', estado: { vars: { email: 'marina@vip.com', webhook_protocolo: 'A123' } } });
    expect(e!.estado.caminho).toEqual(['ini', 'email', 'cond', 'tag', 'mov', 'dona', 'lem', 'web', 'fim_ok']);
    expect((await armazens.contatos.obter('imperio', c.telefone))?.email).toBe('marina@vip.com');
    expect(await tags.temTag(c.id, vip.id)).toBe(true);
    expect(await buscar(c.id)).toMatchObject({ etapa: 'interessada', responsavelId: gente.carla.id });
    expect(webhooks[0]).toMatchObject({ url: 'https://exemplo.com/gancho', corpo: { conversa: { telefone: c.telefone }, variaveis: { email: 'marina@vip.com' } } });
    const lig = (await como(gente.carla, 'GET', '/api/ligacoes')).json() as { sugestoes: Array<{ conversaId: string; texto: string }> };
    expect(lig.sugestoes.find((s) => s.conversaId === c.id)?.texto).toContain('Ligar para Marina (marina@vip.com)');
    // E-mail comum: o outro lado da condição.
    const d = await conversa('norte', 'Bia Souza', 'cadastro');
    await escreve(d, 'bia@gmail.com');
    expect(enviadosPara(d).at(-1)).toBe('Obrigada, Bia!');
  });

  it('esperar sobrevive a reinício; esperar resposta com tempo limite segue por "não respondeu"; não envia em dobro', async () => {
    const m = await preparar(amb);
    const g = grafo(
      [
        { id: 'ini', tipo: 'inicio', gatilho: { tipo: 'palavra_chave', palavras: ['oi'], modo: 'exata' } },
        { id: 'a', tipo: 'mensagem', texto: 'Primeira' },
        { id: 'w', tipo: 'esperar', minutos: 60 },
        { id: 'b', tipo: 'mensagem', texto: 'Segunda' },
        { id: 'r', tipo: 'esperar_resposta', minutos: 30, variavel: 'resp' },
        { id: 'sim', tipo: 'mensagem', texto: 'Recebi: {resp}' },
        { id: 'nao', tipo: 'mensagem', texto: 'Tudo bem, fico por aqui!' },
      ],
      [
        ['ini', 'proximo', 'a'],
        ['a', 'proximo', 'w'],
        ['w', 'proximo', 'b'],
        ['b', 'proximo', 'r'],
        ['r', 'respondeu', 'sim'],
        ['r', 'sem_resposta', 'nao'],
      ],
    );
    const f = await m.bot('Espera', g);
    const c = await m.conversa('norte', 'Marina', 'Oi');
    expect(m.enviadosPara(c)).toEqual(['Primeira']);
    m.avancar(30);
    await m.tick();
    expect(m.enviadosPara(c)).toEqual(['Primeira']);
    // "Reinício": outra instância, mesmo banco.
    m.reiniciar();
    m.avancar(31);
    await m.tick();
    await m.tick();
    expect(m.enviadosPara(c)).toEqual(['Primeira', 'Segunda']);
    // Ninguém responde em 30 min: segue por "não respondeu".
    m.avancar(31);
    await m.tick();
    expect(m.enviadosPara(c)).toEqual(['Primeira', 'Segunda', 'Tudo bem, fico por aqui!']);
    const [e] = await m.execucoes(f.id);
    expect(e!.status).toBe('concluida');
    expect(e!.estado.caminho).toEqual(['ini', 'a', 'w', 'b', 'r', 'nao']);

    // Queda no meio de um envio: o bloco não repete quando a execução é retomada.
    const d = await m.conversa('norte', 'Bia', 'Oi');
    expect(m.enviadosPara(d)).toEqual(['Primeira']);
    const [ed] = (await m.execucoes(f.id)).filter((x) => x.status === 'pendente');
    const bruto = (await m.armazens.bots.execucao(ed!.id))!;
    // Simula: o processo reservou, gravou "em execução" no bloco "Segunda" e caiu antes de terminar.
    Object.assign(bruto, { status: 'rodando', reservadaAte: new Date(m.relogio.t.getTime() - 1000) });
    bruto.estado.noAtual = 'b';
    bruto.estado.emExecucao = 'b';
    bruto.estado.espera = null;
    await m.armazens.bots.salvarExecucao(bruto);
    m.reiniciar();
    await m.tick();
    expect(m.enviadosPara(d)).toEqual(['Primeira']); // "Segunda" não saiu de novo
    const depois = (await m.armazens.bots.execucao(ed!.id))!;
    expect(depois.estado).toMatchObject({ noAtual: 'r', espera: { tipo: 'resposta' } });
    await m.escreve(d, 'oi de novo');
    expect(m.enviadosPara(d)).toEqual(['Primeira', 'Recebi: oi de novo']);
  });

  it('para quando a equipe responde; desligar cancela a continuação; um bot por vez', async () => {
    const { bot, conversa, escreve, enviadosPara, execucoes, sintonia, como, gente } = await preparar(amb);
    const f = await bot('Menu', MENU);
    const c = await conversa('norte', 'Marina', 'menu');
    expect(enviadosPara(c)).toHaveLength(2);
    await sintonia.equipeEnviou(c.id, 'Oi Marina, sou a Carla!', 'Carla Lima');
    const [e] = await execucoes(f.id);
    expect(e).toMatchObject({ status: 'cancelada', erro: 'A equipe respondeu a conversa.' });
    await escreve(c, '2');
    expect(enviadosPara(c).at(-1)).toBe('Oi Marina, sou a Carla!');
    // Desligar: a cliente responde e nada acontece.
    const d = await conversa('norte', 'Bia', 'menu');
    await como(gente.admin, 'POST', `/api/bots/${f.id}/desligar`);
    await escreve(d, '1');
    expect(enviadosPara(d)).toHaveLength(2);
    expect((await execucoes(f.id)).find((x) => x.status === 'pendente' || x.status === 'rodando')).toBeUndefined();
  });

  it('iniciar à mão pela conversa, testar o rascunho numa conversa de teste e parar', async () => {
    const { como, gente, conversa, escreve, enviadosPara, bot } = await preparar(amb);
    const manual = grafo([{ id: 'i', tipo: 'inicio', gatilho: { tipo: 'manual' } }, { id: 'm', tipo: 'mensagem', texto: 'Olá, {nome}! Posso ajudar?' }, { id: 'r', tipo: 'esperar_resposta', minutos: 60 }], [['i', 'proximo', 'm'], ['m', 'proximo', 'r']]);
    const f = await bot('Manual', manual);
    const c = await conversa('norte', 'Marina Souza', 'Bom dia');
    expect(enviadosPara(c)).toEqual([]); // manual não dispara sozinho
    const lista = (await como(gente.carla, 'GET', `/api/conversas/${c.id}/bot`)).json() as { ativa: unknown; fluxos: Array<{ id: string }> };
    expect(lista).toMatchObject({ ativa: null, fluxos: [{ id: f.id }] });
    const ini = await como(gente.carla, 'POST', `/api/conversas/${c.id}/bot`, { fluxoId: f.id });
    expect(ini.statusCode).toBe(200);
    expect(enviadosPara(c)).toEqual(['Olá, Marina Souza! Posso ajudar?']);
    expect((await como(gente.carla, 'POST', `/api/conversas/${c.id}/bot`, { fluxoId: f.id })).statusCode).toBe(409);
    expect((await como(gente.carla, 'GET', `/api/conversas/${c.id}/bot`)).json()).toMatchObject({ ativa: { fluxoId: f.id, fluxoNome: 'Manual' } });
    expect((await como(gente.carla, 'POST', `/api/conversas/${c.id}/bot/parar`)).json()).toEqual({ ok: true, parou: true });

    // Testar o rascunho: só em conversa de teste; mostra o caminho percorrido.
    await como(gente.admin, 'PATCH', `/api/bots/${f.id}`, { rascunho: MENU });
    expect((await como(gente.admin, 'POST', `/api/bots/${f.id}/testar`, { conversaId: c.id })).statusCode).toBe(400);
    const t = await conversa('norte', 'Teste', 'Oi', 'teste-norte');
    const r = await como(gente.admin, 'POST', `/api/bots/${f.id}/testar`, { conversaId: t.id });
    expect(r.statusCode).toBe(200);
    const ex = r.json() as Exec;
    expect(ex).toMatchObject({ status: 'pendente', estado: { caminho: ['ini', 'oi', 'p'] } });
    await escreve(t, '3');
    const fim = (await como(gente.admin, 'GET', `/api/bots/execucoes/${ex.id}`)).json() as Exec;
    expect(fim).toMatchObject({ status: 'concluida', estado: { caminho: ['ini', 'oi', 'p', 'h'] } });
    expect(enviadosPara(t).at(-1)).toBe('Já chamei uma atendente.');
  });

  it('agente de IA: entrega a conversa com o objetivo e volta ao fluxo quando cumpre (até N mensagens)', async () => {
    const agente = new AgenteFalso(() => ({ texto: 'IA aqui', acoes: [], recusou: false }));
    const { bot, conversa, escreve, enviadosPara, buscar, agente: ag, tick, avancar } = await preparar(amb, { agente });
    const g = grafo(
      [
        { id: 'i', tipo: 'inicio', gatilho: { tipo: 'palavra_chave', palavras: ['agendar'] } },
        { id: 's', tipo: 'pergunta', texto: 'Qual serviço?', variavel: 'servico', opcoes: [{ id: 'p', texto: 'Progressiva' }, { id: 's', texto: 'Selagem' }] },
        { id: 'ag', tipo: 'agente_ia', objetivo: 'Agendar {servico}', saida: { tipo: 'mensagens', n: 2 }, dias: 1 },
        { id: 'fim', tipo: 'transferir', texto: 'Vou chamar uma atendente para fechar.' },
        { id: 'prazo', tipo: 'mensagem', texto: 'Prazo acabou.' },
      ],
      [
        ['i', 'proximo', 's'],
        ['s', 'p', 'ag'],
        ['s', 's', 'ag'],
        ['ag', 'concluiu', 'fim'],
        ['ag', 'tempo_esgotado', 'prazo'],
      ],
    );
    await bot('Agendar', g);
    const c = await conversa('norte', 'Marina', 'quero agendar');
    expect(enviadosPara(c)).toEqual([expect.stringContaining('Qual serviço?')]);
    avancar(1); // relógio parado: a resposta da IA sairia "antes" da mensagem da cliente
    await escreve(c, 'selagem');
    // A IA responde com o objetivo do bloco.
    expect((await buscar(c.id)).modo).toBe('ia');
    expect(ag.pedidos.at(-1)!.objetivo).toBe('Agendar Selagem');
    expect(enviadosPara(c)).toEqual([expect.stringContaining('Qual serviço?'), 'IA aqui']);
    avancar(1);
    await escreve(c, 'pode ser sábado');
    expect(enviadosPara(c).at(-1)).toBe('IA aqui');
    // Depois de 2 mensagens da IA, o bot retoma (no relógio ou na próxima mensagem) antes da IA.
    await tick();
    expect(enviadosPara(c).at(-1)).toBe('Vou chamar uma atendente para fechar.');
    expect((await buscar(c.id)).modo).toBe('humano');
  });

  it('agente de IA "até agendar" e gatilhos nova conversa / fora do horário / entrou na etapa', async () => {
    const m = await preparar(amb, { inicio: quinta(22) });
    const fora = grafo([{ id: 'i', tipo: 'inicio', gatilho: { tipo: 'fora_do_horario' } }, { id: 'm', tipo: 'mensagem', texto: 'Estamos fechados.' }], [['i', 'proximo', 'm']]);
    await m.bot('Fora', fora);
    const c = await m.conversa('norte', 'Marina', 'Oi');
    expect(m.enviadosPara(c)).toEqual(['Estamos fechados.']);
    await m.escreve(c, 'alô?');
    expect(m.enviadosPara(c).filter((t) => t === 'Estamos fechados.')).toHaveLength(1); // uma vez por período fechado
    // Entrou na etapa "Agendada" dispara outro bot.
    const etapa = grafo([{ id: 'i', tipo: 'inicio', gatilho: { tipo: 'entrou_na_etapa', etapaId: m.etapasSistema.get('agendada') } }, { id: 'm', tipo: 'mensagem', texto: 'Agendado! Te esperamos.' }], [['i', 'proximo', 'm']]);
    await m.bot('Pós-agendamento', etapa);
    await m.como(m.gente.admin, 'POST', `/api/conversas/${c.id}/funis/${m.sistema.id}`, { etapaId: m.etapasSistema.get('agendada') });
    expect(m.enviadosPara(c).at(-1)).toBe('Agendado! Te esperamos.');
  });
});
