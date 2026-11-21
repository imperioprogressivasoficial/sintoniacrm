import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import type { RespostaAgente } from '../src/ai/agente.js';
import type { Papel, Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import { chaveSemResposta } from '../src/automacoes/automacoes.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { Cofre } from '../src/conexoes/cofre.js';
import type { Conversa, ModoAtendimento } from '../src/domain.js';
import { ArmazemNotificacoesMemoria } from '../src/notificacoes/armazem.js';
import { avaliarEspera, EsquemaRegraEspera, prazoDa, REGRA_PADRAO } from '../src/notificacoes/espera.js';
import { Notificador, observarEventos } from '../src/notificacoes/notificador.js';
import { ChavesPush, type EnviadorPush } from '../src/notificacoes/push.js';
import { PresencasMemoria, PresencasPostgres } from '../src/presenca/presenca.js';
import { ArmazemRodizioMemoria, ArmazemRodizioPostgres, Rodizio } from '../src/rodizio/rodizio.js';
import { registrarRodizio } from '../src/rodizio/rotas.js';
import { criarServidor } from '../src/server.js';
import { AgenteFalso, ambientes, quinta, type Ambiente } from './gestao-ambiente.js';
import { montarFunis } from './funis-ambiente.js';

const MIN = 60_000;
const hashPadrao = gerarHash('Imperio2026xyz');

/** Sintonia + notificações + rodízio, como no index (eventos observados pelo notificador e pelo rodízio). */
async function montarRodizio(amb: Ambiente) {
  const { repo, contas, pool } = await amb.criar();
  if (pool) await pool.query('delete from sintonia.rodizio_config');
  const relogio = { t: quinta(14) };
  const agora = () => relogio.t;
  const canal: CanalWhatsApp = { tipo: 'evolution', lerWebhook: () => [], enviarTexto: async () => ({ idExterno: `out-${Math.random()}` }) };
  const armazem = new ArmazemNotificacoesMemoria();
  const pushes: Array<{ endpoint: string; carga: Record<string, unknown> }> = [];
  const enviador: EnviadorPush = { async enviar(i, carga) { pushes.push({ endpoint: i.endpoint, carga: JSON.parse(carga) }); } };
  const chaves = new ChavesPush(armazem, new Cofre('teste'));
  const notificador = new Notificador({ armazem, contas, repo, empresaId: 'imperio', agora, push: { chaves, enviador, assunto: 'mailto:teste@example.com' } });
  observarEventos(repo, (e) => notificador.aoEvento(e));
  const modo = { novo: 'copiloto' as ModoAtendimento };
  const resposta = { r: { texto: 'Sugestão', acoes: [], recusou: false } as RespostaAgente };
  const agente = new AgenteFalso(() => resposta.r);
  let sintonia: Sintonia;
  const presencas = pool ? new PresencasPostgres(pool) : new PresencasMemoria();
  const semResponder = new Set<string>();
  const rodizio = new Rodizio({
    armazem: pool ? new ArmazemRodizioPostgres(pool) : new ArmazemRodizioMemoria(repo),
    contas,
    presencas,
    repo,
    empresaId: 'imperio',
    sintonia: () => sintonia,
    podeResponder: async (u) => !semResponder.has(u.id),
    agora,
  });
  observarEventos(repo, (e) => rodizio.aoEvento(e));
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [
      { canalId: 'imperio-norte', unidade: 'norte', canal },
      { canalId: 'imperio-sumare', unidade: 'sumare', canal },
    ],
    agente,
    agora,
    modoInicial: async () => modo.novo,
  });
  const app = criarServidor({ sintonia, repo, agora, auth: { contas, agora }, notificacoes: { notificador, armazem, chaves, agora } });
  registrarRodizio(app, { rodizio });
  const h = await hashPadrao;
  const pessoa = (nome: string, papel: Papel, unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = {
    admin: await pessoa('Bruno Batista', 'admin', []),
    gerente: await pessoa('Gil Norte', 'gerente', ['norte']),
    carla: await pessoa('Carla Lima', 'atendente', ['norte']),
    bia: await pessoa('Bia Souza', 'atendente', ['norte']),
    rita: await pessoa('Rita Recepção', 'recepcionista', ['sumare']),
  };
  for (const u of Object.values(gente)) await armazem.inscrever({ endpoint: `https://push.exemplo.test/${u.id}`, usuarioId: u.id, p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) });
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'PUT', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 24 * 3600_000))}`));
    return app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  const ocioso = async () => {
    await rodizio.ocioso();
    await notificador.ocioso();
  };
  let seq = 0;
  const cliente = async (texto = 'Oi, quero saber o preço', unidade: 'norte' | 'sumare' = 'norte', telefone = `55719882${String(++seq).padStart(5, '0')}`): Promise<Conversa> => {
    relogio.t = new Date(relogio.t.getTime() + 1000);
    await sintonia.receber({ canalId: `imperio-${unidade}`, telefone, nome: `Cliente ${seq}`, texto, deMim: false, idExterno: `in-${seq}-${Math.random()}`, em: relogio.t });
    await ocioso();
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const dona = async (c: Conversa) => (await repo.buscarConversa(c.id))!.responsavelId;
  return { repo, contas, pool, relogio, sintonia, rodizio, notificador, armazem, pushes, presencas, gente, como, cliente, dona, ocioso, modo, resposta, semResponder };
}

describe.each(ambientes)('Rodízio automático de leads ($nome)', (amb) => {
  it('distribui conversa nova entre quem está disponível, em rodízio justo, avisa quem recebeu e registra na conversa', async () => {
    const m = await montarRodizio(amb);
    const { gente, como } = m;
    // Desligado (padrão): ninguém ganha conversa sozinho.
    expect(await m.dona(await m.cliente())).toBeUndefined();

    // Só a gestão da unidade configura.
    expect((await como(gente.carla, 'PUT', '/api/rodizio/norte', { ligado: true })).statusCode).toBe(403);
    expect((await como(gente.gerente, 'PUT', '/api/rodizio/sumare', { ligado: true })).statusCode).toBe(403);
    expect((await como(gente.gerente, 'PUT', '/api/rodizio/norte', { regra: 'sorteio' })).statusCode).toBe(400);
    expect((await como(gente.gerente, 'PUT', '/api/rodizio/norte', { participantes: [gente.rita.id] })).statusCode).toBe(400); // não atende Norte
    const r = await como(gente.gerente, 'PUT', '/api/rodizio/norte', { ligado: true });
    expect(r.statusCode).toBe(200);
    expect(r.json().config).toEqual({ ligado: true, regra: 'rodizio', participantes: [] });

    // Rodízio: Bia, Carla, Bia (empate no começo: ordem do nome). Gerente não entra (só a linha de frente).
    const c1 = await m.cliente();
    const c2 = await m.cliente();
    const c3 = await m.cliente();
    expect([await m.dona(c1), await m.dona(c2), await m.dona(c3)]).toEqual([gente.bia.id, gente.carla.id, gente.bia.id]);

    // Quem recebeu é avisada (sino + push) e a conversa mostra de onde veio a dona.
    const avisosCarla = (await m.armazem.listar(gente.carla.id, m.relogio.t, 50)).filter((n) => n.tipo === 'transferida');
    expect(avisosCarla).toHaveLength(1);
    expect(avisosCarla[0]).toMatchObject({ titulo: 'Lead novo para você: Cliente 3', conversaId: c2.id });
    expect(m.pushes.some((p) => p.endpoint.endsWith(gente.carla.id) && p.carga.conversaId === c2.id)).toBe(true);
    const msgs = await m.repo.mensagens(c2.id);
    expect(msgs.find((x) => x.autor === 'sistema')?.texto).toBe('Rodízio automático: conversa passada para Carla Lima (vez no rodízio).');
    // A lista de conversas continua mostrando a mensagem da cliente (o aviso entra logo antes dela).
    expect((await m.repo.ultimasMensagens([c2.id])).get(c2.id)?.autor).toBe('cliente');
    const ev = (await m.repo.eventosEntre(quinta(0), quinta(23, 59))).filter((e) => e.tipo === 'transferencia' && e.conversaId === c2.id);
    expect(ev[0]?.dados).toMatchObject({ paraId: gente.carla.id, motivo: 'rodizio', porNome: 'Rodízio automático' });

    // Carla ficou fora do ar: tudo vai para a Bia. Bia sem a permissão "Responder": ninguém, a conversa fica para a unidade.
    await m.presencas.gravar(gente.carla.id, 'offline');
    expect(await m.dona(await m.cliente())).toBe(gente.bia.id);
    m.semResponder.add(gente.bia.id);
    expect(await m.dona(await m.cliente())).toBeUndefined();
    m.semResponder.clear();
    await m.presencas.gravar(gente.carla.id, 'online');

    // A tela: pessoas, disponibilidade e quantas receberam hoje; últimas distribuições.
    const tela = (await como(gente.gerente, 'GET', '/api/rodizio')).json();
    const norte = tela.unidades.find((u: { id: string }) => u.id === 'norte');
    expect(norte.pessoas.map((p: { nome: string }) => p.nome)).toEqual(['Bia Souza', 'Carla Lima']);
    expect(norte.pessoas.find((p: { id: string }) => p.id === gente.bia.id)).toMatchObject({ disponivel: true, participa: true, recebidasHoje: 3 });
    expect(tela.recentes.length).toBe(4);
    expect((await como(gente.carla, 'GET', '/api/rodizio')).statusCode).toBe(403);

    // Outra unidade: a conversa de Sumaré nunca vai para alguém de Norte (lá está desligado).
    expect(await m.dona(await m.cliente('Oi', 'sumare'))).toBeUndefined();
  });

  it('quem participa, menor carga, conversa já com dona e conversa aberta pela equipe ficam como estão', async () => {
    const m = await montarRodizio(amb);
    const { gente, como } = m;
    await como(gente.gerente, 'PUT', '/api/rodizio/norte', { ligado: true, participantes: [gente.carla.id, gente.gerente.id] });
    // Só quem participa: Carla e o gerente (escolhido de propósito).
    const a = await m.cliente();
    const b = await m.cliente();
    expect(new Set([await m.dona(a), await m.dona(b)])).toEqual(new Set([gente.carla.id, gente.gerente.id]));

    // Menor carga: quem tem menos conversas em andamento recebe (Bia está sem nenhuma).
    await como(gente.gerente, 'PUT', '/api/rodizio/norte', { regra: 'carga', participantes: [gente.carla.id, gente.bia.id] });
    expect(await m.dona(await m.cliente())).toBe(gente.bia.id);
    // Carla tem 1, Bia tem 1: empate → quem recebeu há mais tempo (Carla).
    expect(await m.dona(await m.cliente())).toBe(gente.carla.id);
    const ultimas = await m.rodizio.recentes(['norte'], 10);
    expect(ultimas.map((x) => x.regra)).toEqual(['carga', 'carga', 'rodizio', 'rodizio']);

    // Conversa aberta pela equipe ("Nova conversa", sem origem cliente): não entra no rodízio.
    const { conversa } = await m.repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: '5571999990000', agora: m.relogio.t });
    await m.repo.registrarEvento({ tipo: 'conversa_nova', conversaId: conversa.id, unidade: 'norte', em: m.relogio.t });
    await m.ocioso();
    expect(await m.dona(conversa)).toBeUndefined();

    // Já tem dona: não mexe.
    await m.sintonia.definirResponsavel(conversa.id, { id: gente.carla.id, nome: gente.carla.nome }, { id: gente.gerente.id, nome: 'Gil' }, 'transferiu');
    expect(await m.rodizio.distribuir(conversa.id, 'ia')).toEqual({ feito: false, motivo: 'tem_dona' });
  });

  it('IA atende primeiro: a conversa só vai para alguém quando a IA passa para a equipe', async () => {
    const m = await montarRodizio(amb);
    await m.como(m.gente.gerente, 'PUT', '/api/rodizio/norte', { ligado: true });
    m.modo.novo = 'ia';
    m.resposta.r = { texto: 'Oi! Já te respondo.', acoes: [], recusou: false };
    const c = await m.cliente('Oi');
    expect((await m.repo.buscarConversa(c.id))!.modo).toBe('ia');
    expect(await m.dona(c)).toBeUndefined();
    // A cliente pede uma pessoa: a IA passa para a equipe e o rodízio entra.
    m.resposta.r = { texto: 'Vou chamar alguém da equipe.', acoes: [{ tipo: 'passar_para_humano', motivo: 'quer falar com uma pessoa' }], recusou: false };
    m.relogio.t = new Date(m.relogio.t.getTime() + 1000);
    await m.sintonia.receber({ canalId: 'imperio-norte', telefone: c.telefone, nome: c.nome, texto: 'Quero falar com uma pessoa', deMim: false, idExterno: `in-x-${Math.random()}`, em: m.relogio.t });
    await m.ocioso();
    expect(await m.dona(c)).toBe(m.gente.bia.id);
    // Quem recebeu ganha "Lead novo" (e a linha de frente o aviso de sempre da IA).
    expect((await m.armazem.listar(m.gente.bia.id, m.relogio.t, 50)).map((n) => n.tipo)).toContain('transferida');
  });
});

describe('Prazo de resposta (SLA) por etapa e primeira resposta', () => {
  const base = { modo: 'humano' as const, unidade: 'norte', etapa: 'novo_lead' as const, ultimaMensagemEquipe: undefined, ultimaMensagemIa: undefined };
  const agora = quinta(14);
  const regra = EsquemaRegraEspera.parse({ ...REGRA_PADRAO, avisoMin: 10, forteMin: 25, primeiraMin: 3, etapas: { novo_lead: 5, em_conversa: 30 } });

  it('vale a primeira resposta, depois o prazo da etapa, depois o padrão; a escalada vem depois do mesmo intervalo', () => {
    expect(prazoDa(regra, base)).toMatchObject({ avisoMin: 3, forteMin: 18, origem: 'primeira' });
    const respondida = { ...base, ultimaMensagemEquipe: quinta(13) };
    expect(prazoDa(regra, respondida)).toMatchObject({ avisoMin: 5, forteMin: 20, origem: 'etapa', rotulo: 'etapa Novo lead' });
    expect(prazoDa(regra, { ...respondida, etapa: 'em_conversa' })).toMatchObject({ avisoMin: 30, forteMin: 45 });
    expect(prazoDa(regra, { ...respondida, etapa: 'interessada' })).toMatchObject({ avisoMin: 10, forteMin: 25, origem: 'padrao' });
    // Sem prazos novos: igual a antes.
    expect(prazoDa(REGRA_PADRAO, base)).toMatchObject({ avisoMin: 5, forteMin: 15, origem: 'padrao' });

    const esperando = (min: number, c: object = base) => avaliarEspera({ ...base, ...c, ultimaMensagemCliente: new Date(agora.getTime() - min * MIN) }, regra, agora).nivel;
    expect([esperando(2), esperando(4), esperando(18)]).toEqual([0, 1, 2]);
    const cliente = { ultimaMensagemEquipe: new Date(agora.getTime() - 60 * MIN), etapa: 'em_conversa' };
    expect([esperando(29, cliente), esperando(31, cliente), esperando(46, cliente)]).toEqual([0, 1, 2]);
  });

  it('valida as etapas e os minutos', () => {
    expect(() => EsquemaRegraEspera.parse({ ...REGRA_PADRAO, etapas: { voando: 5 } })).toThrow();
    expect(() => EsquemaRegraEspera.parse({ ...REGRA_PADRAO, etapas: { novo_lead: 0 } })).toThrow();
    expect(() => EsquemaRegraEspera.parse({ ...REGRA_PADRAO, primeiraMin: 5000 })).toThrow();
    // Regra antiga (sem os campos novos) continua valendo.
    const { primeiraMin: _p, etapas: _e, ...antiga } = REGRA_PADRAO;
    expect(EsquemaRegraEspera.parse(antiga)).toMatchObject({ primeiraMin: null, etapas: {} });
  });

  it.each(ambientes)('estourou: avisa a dona; continuou: escala para a gerência ($nome)', async (amb) => {
    const m = await montarRodizio(amb);
    m.modo.novo = 'humano';
    const g = m.gente;
    const r = await m.como(g.gerente, 'PUT', '/api/espera/regras/norte', { primeiraMin: 2, etapas: { novo_lead: 4 }, avisoMin: 5, forteMin: 15 });
    expect(r.statusCode).toBe(200);
    expect(r.json().regra).toMatchObject({ primeiraMin: 2, etapas: { novo_lead: 4 } });
    expect((await m.como(g.gerente, 'PUT', '/api/espera/regras/norte', { etapas: { novo_lead: -1 } })).statusCode).toBe(400);
    // O GET mostra os prazos para a tela (cronômetro e Distribuição e prazos).
    expect((await m.como(g.carla, 'GET', '/api/espera/regras')).json().unidades[0].regra).toMatchObject({ primeiraMin: 2, etapas: { novo_lead: 4 } });

    const c = await m.cliente('Oi');
    await m.sintonia.definirResponsavel(c.id, { id: g.carla.id, nome: g.carla.nome }, { id: g.gerente.id, nome: 'Gil' }, 'transferiu');
    await m.ocioso();
    const esperas = async (u: Usuario) => (await m.armazem.listar(u.id, m.relogio.t, 50)).filter((n) => n.tipo === 'espera');
    const avancar = async (min: number) => {
      m.relogio.t = new Date(m.relogio.t.getTime() + min * MIN);
      await m.notificador.tick();
      await m.ocioso();
    };
    await avancar(1);
    expect(await esperas(g.carla)).toHaveLength(0);
    await avancar(2); // 3 min: passou o prazo da primeira resposta (2 min)
    const [aviso] = await esperas(g.carla);
    expect(aviso).toMatchObject({ titulo: 'Prazo estourou: Cliente 1' });
    expect(aviso!.texto).toContain('prazo da primeira resposta: 2 min');
    expect(await esperas(g.gerente)).toHaveLength(0);
    const faixa = (await m.como(g.carla, 'GET', '/api/espera')).json().itens[0];
    expect(faixa).toMatchObject({ nivel: 1, prazoMin: 2, escalaMin: 12, prazo: 'primeira resposta' });
    await avancar(10); // 13 min: 2 + 10 (intervalo da escalada) → gerência
    expect((await esperas(g.gerente))[0]).toMatchObject({ titulo: expect.stringContaining('Urgente') });
  });
});

describe('chaveSemResposta (gatilho "sem resposta")', () => {
  const t = (min: number) => new Date(quinta(14).getTime() + min * MIN);
  it('uma chave por silêncio da cliente; só esperas começadas depois de criar a automação', () => {
    const c = { ultimaMensagemCliente: t(0), ultimaMensagemEquipe: undefined, ultimaMensagemIa: undefined };
    expect(chaveSemResposta(c, 'equipe', t(30), t(-10))).toBe(`semresp:equipe:${t(0).toISOString()}`);
    expect(chaveSemResposta(c, 'equipe', t(-1), t(-10))).toBeUndefined(); // ainda não deu o tempo
    expect(chaveSemResposta(c, 'equipe', t(30), t(1))).toBeUndefined(); // espera antiga
    expect(chaveSemResposta(c, 'cliente', t(30), t(-10))).toBeUndefined(); // a vez é da loja
    const loja = { ...c, ultimaMensagemIa: t(5) };
    expect(chaveSemResposta(loja, 'equipe', t(30), t(-10))).toBeUndefined();
    expect(chaveSemResposta(loja, 'cliente', t(30), t(-10))).toBe(`semresp:cliente:${t(0).toISOString()}`);
    // A loja escreveu de novo (ex.: a própria automação): a chave é a mesma (não dispara de novo).
    expect(chaveSemResposta({ ...loja, ultimaMensagemEquipe: t(40) }, 'cliente', t(80), t(-10))).toBe(`semresp:cliente:${t(0).toISOString()}`);
  });
});

describe.each(ambientes)('Automações: gatilhos novos ($nome)', (amb) => {
  async function preparar() {
    const m = await montarFunis(amb);
    observarEventos(m.repo, (e) => void m.automacoes.aoEvento(e));
    const vip = (await m.como(m.gente.admin, 'POST', '/api/tags', { nome: 'Gatilho' })).json() as { id: string };
    const criar = async (nome: string, gatilho: Record<string, unknown>, passos: unknown[] = [{ tipo: 'marcar_tag', tagId: vip.id }]) => {
      const r = await m.como(m.gente.admin, 'POST', '/api/automacoes', { nome, ligada: true, gatilho, passos });
      if (r.statusCode !== 201) throw new Error(`criar automação: ${r.statusCode} ${r.body}`);
      return r.json() as { id: string };
    };
    const execucoes = async (id: string) => (await m.como(m.gente.admin, 'GET', `/api/automacoes/${id}/execucoes`)).json() as Array<{ status: string; chave: string }>;
    return { ...m, vip, criar, execucoes };
  }

  it('valida os gatilhos novos', async () => {
    const m = await preparar();
    const recusa = async (gatilho: Record<string, unknown>) => (await m.como(m.gente.admin, 'POST', '/api/automacoes', { nome: 'x', gatilho, passos: [{ tipo: 'esperar', minutos: 1 }] })).statusCode;
    expect(await recusa({ tipo: 'sem_resposta', quem: 'equipe', minutos: 2 })).toBe(400); // mínimo 5 min
    expect(await recusa({ tipo: 'sem_resposta', quem: 'ninguem', minutos: 30 })).toBe(400);
    expect(await recusa({ tipo: 'agendou', quando: 'ontem' })).toBe(400);
    expect(await recusa({ tipo: 'sem_resposta', quem: 'cliente', minutos: 60 })).toBe(201);
    expect(await recusa({ tipo: 'agendou' })).toBe(201);
    expect(await recusa({ tipo: 'mensagem_recebida', unidade: 'norte' })).toBe(201);
  });

  it('qualquer mensagem recebida: dispara a cada mensagem da cliente (só da unidade escolhida)', async () => {
    const m = await preparar();
    const a = await m.criar('Toda mensagem', { tipo: 'mensagem_recebida', unidade: 'norte' }, [{ tipo: 'lembrete_ligacao', em_minutos: 0, texto: 'Ver' }]);
    const c = await m.conversa('norte', 'Ana Paula');
    await m.escreve(c, 'Outra mensagem');
    await m.escreve(c, 'eu', true); // da loja: não conta
    await m.conversa('sumare', 'Rosa');
    const ex = await m.execucoes(a.id);
    expect(ex).toHaveLength(2);
    expect(ex.every((e) => e.status === 'concluida' && e.chave.startsWith('recebida:'))).toBe(true);
  });

  it('sem resposta da equipe e da cliente: uma vez por espera; esperas antigas ficam de fora', async () => {
    const m = await preparar();
    const antiga = await m.conversa('norte', 'Antiga'); // esperando desde antes da automação
    m.avancar(1);
    const equipe = await m.criar('Cliente esperando', { tipo: 'sem_resposta', quem: 'equipe', minutos: 30 });
    const cliente = await m.criar('Cliente sumiu', { tipo: 'sem_resposta', quem: 'cliente', minutos: 60 });
    const c = await m.conversa('norte', 'Marina');
    m.avancar(20);
    await m.tick();
    expect(await m.execucoes(equipe.id)).toHaveLength(0);
    m.avancar(15);
    await m.tick();
    await m.tick();
    const ex = await m.execucoes(equipe.id);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.chave).toContain('semresp:equipe:');
    expect(await m.tags.temTag(c.id, m.vip.id)).toBe(true);
    expect(await m.tags.temTag(antiga.id, m.vip.id)).toBe(false);

    // A equipe respondeu: agora a vez é da cliente. 60 min sem ela responder → o outro gatilho.
    await m.escreve(c, 'Oi Marina, tudo bem?', true);
    m.avancar(61);
    await m.tick();
    await m.tick();
    expect((await m.execucoes(cliente.id)).map((e) => e.chave)).toEqual([expect.stringContaining('semresp:cliente:')]);

    // A cliente voltou e ficou sem resposta de novo: nova espera, dispara de novo.
    await m.escreve(c, 'Voltei');
    m.avancar(31);
    await m.tick();
    expect(await m.execucoes(equipe.id)).toHaveLength(2);
  });

  it('agendou: pela equipe/IA, confirmação da cliente e o link online', async () => {
    const m = await preparar();
    const qualquer = await m.criar('Agendou', { tipo: 'agendou', quando: 'qualquer' });
    const pelaIa = await m.criar('IA agendou', { tipo: 'agendou', quando: 'ia' });
    const confirmou = await m.criar('Confirmou', { tipo: 'agendou', quando: 'confirmou' });
    const online = await m.criar('Online', { tipo: 'agendou', quando: 'online' });
    const c = await m.conversa('norte', 'Joana');
    await m.sintonia.equipeAgendou(c.id, { tipo: 'agendou', clienteTrinksId: 5, agendamento: { trinksId: 77, unidade: 'norte', servico: 'Progressiva', inicio: quinta(19), duracaoMin: 180 } }, 'Carla Lima', m.gente.carla);
    await m.automacoes.ocioso();
    expect(await m.execucoes(qualquer.id)).toHaveLength(1);
    expect(await m.execucoes(pelaIa.id)).toHaveLength(0);
    // A cliente confirmou o horário (confirmação automática de agenda).
    await m.repo.registrarEvento({ tipo: 'confirmacao', conversaId: c.id, unidade: 'norte', em: m.relogio.t, dados: { status: 'confirmado', agendamento: '77' } });
    await m.repo.registrarEvento({ tipo: 'confirmacao', conversaId: c.id, unidade: 'norte', em: m.relogio.t, dados: { status: 'remarcar', agendamento: '77' } });
    await m.automacoes.ocioso();
    expect((await m.execucoes(confirmou.id)).map((e) => e.chave)).toEqual(['confirmou:77']);
    // Link de agendamento online.
    await m.automacoes.aoAgendouOnline(c.id, 'r1');
    await m.automacoes.aoAgendouOnline(c.id, 'r1'); // o mesmo aviso de novo: não repete
    await m.automacoes.ocioso();
    expect((await m.execucoes(online.id)).map((e) => e.chave)).toEqual(['reuniao:r1']);
    expect(await m.execucoes(qualquer.id)).toHaveLength(2);
  });
});
