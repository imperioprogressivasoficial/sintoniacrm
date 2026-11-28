import { describe, expect, it } from 'vitest';
import { Sintonia } from '../src/app/sintonia.js';
import { CanalEvolution, ErroEnvioWhatsApp, erroDaResposta } from '../src/channels/evolution.js';
import { EvolutionAdmin, type InfoInstancia } from '../src/channels/evolution-admin.js';
import { ArmazemSaudeMemoria, ArmazemSaudePostgres, SaudeWhatsApp, type AdminSaude, type AvisoSaude } from '../src/channels/whatsapp-saude.js';
import type { MensagemRecebida } from '../src/channels/tipos.js';
import { ContasMemoria } from '../src/auth/contas.js';
import { ArmazemNotificacoesMemoria } from '../src/notificacoes/armazem.js';
import { classificarFalha, Notificador } from '../src/notificacoes/notificador.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { poolDeTeste, temPostgres } from './repos.js';

const semEspera = async () => {};
const CANAIS = [
  { canalId: 'sintonia-c1', nome: 'Atendimento' },
  { canalId: 'sintonia-c2', nome: 'Vendas' },
];

/** Evolution falsa só para a saúde: estado de cada instância e o que acontece ao reconectar. */
function adminFalso() {
  const estado = new Map<string, InfoInstancia>();
  const chamadas: string[] = [];
  let fora = false;
  let reconexao: Awaited<ReturnType<AdminSaude['reconectar']>>['estado'] = 'conectada';
  const adm: AdminSaude = {
    async listar() {
      chamadas.push('listar');
      if (fora) throw new Error('fetch failed (ECONNREFUSED)');
      return [...estado.values()];
    },
    async reconectar(nome) {
      chamadas.push(`reconectar:${nome}`);
      if (reconexao === 'conectada') estado.set(nome, { ...estado.get(nome)!, estado: 'conectada' });
      return { estado: reconexao };
    },
  };
  const por = (nome: string, e: InfoInstancia['estado'], codigoDesconexao: number | null = null) =>
    estado.set(nome, { nome, estado: e, numero: '5571988887777', perfil: null, codigoDesconexao });
  return {
    adm,
    chamadas,
    por,
    apagar: (nome: string) => estado.delete(nome),
    set fora(v: boolean) { fora = v; },
    set reconexao(v: typeof reconexao) { reconexao = v; },
  };
}

function montarSaude(o: { agora?: { t: Date } } = {}) {
  const relogio = o.agora ?? { t: new Date('2026-11-20T12:00:00Z') };
  const avisos: AvisoSaude[] = [];
  const evo = adminFalso();
  const armazem = new ArmazemSaudeMemoria();
  const saude = new SaudeWhatsApp({
    armazem,
    admin: () => evo.adm,
    canais: () => CANAIS,
    avisar: async (a) => { avisos.push(a); },
    agora: () => relogio.t,
    esperaBaseMs: 60_000,
    maxTentativas: 3,
  });
  const passar = (min: number) => { relogio.t = new Date(relogio.t.getTime() + min * 60_000); };
  return { saude, avisos, evo, armazem, relogio, passar };
}

const conexao = (instance: string, state: string, statusReason?: number) => ({
  event: 'connection.update',
  instance,
  data: { instance, state, ...(statusReason !== undefined ? { statusReason } : {}) },
});

describe('Saúde do WhatsApp: webhook CONNECTION_UPDATE', () => {
  it('aparelho removido no celular (401): marca desconectado e avisa uma vez; ao voltar, avisa que voltou', async () => {
    const { saude, avisos } = montarSaude();
    saude.aoWebhook(conexao('sintonia-c1', 'open'));
    expect(saude.canal('sintonia-c1')?.estado).toBe('conectado');

    expect(saude.aoWebhook(conexao('sintonia-c1', 'close', 401))).toBe(true);
    await saude.ocioso();
    const s = saude.canal('sintonia-c1')!;
    expect(s).toMatchObject({ estado: 'desconectado', precisaParear: true, codigo: 401 });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ titulo: 'O WhatsApp Atendimento desconectou', vista: 'conexoes#nao-oficial' });
    expect(avisos[0]!.texto).toMatch(/Toque para reconectar/);

    // Repetido (a Evolution reenvia): nada de novo aviso.
    saude.aoWebhook(conexao('sintonia-c1', 'close', 401));
    await saude.ocioso();
    expect(avisos).toHaveLength(1);
    expect(saude.resumo().canais.find((c) => c.id === 'sintonia-c1')).toMatchObject({ estado: 'desconectado', reconectando: false });

    saude.aoWebhook(conexao('sintonia-c1', 'open'));
    await saude.ocioso();
    expect(saude.canal('sintonia-c1')?.estado).toBe('conectado');
    expect(avisos.map((a) => a.titulo)).toEqual(['O WhatsApp Atendimento desconectou', 'O WhatsApp Atendimento voltou']);
  });

  it('desconectar de propósito, canal que nunca conectou e instância de fora não geram aviso', async () => {
    const { saude, avisos } = montarSaude();
    saude.aoWebhook(conexao('sintonia-c2', 'close', 401)); // nunca conectou
    saude.aoWebhook(conexao('assia', 'close', 401)); // instância de outro sistema
    saude.aoWebhook(conexao('sintonia-c1', 'open'));
    saude.desligadoPelaPessoa('sintonia-c1');
    saude.aoWebhook(conexao('sintonia-c1', 'close', 401));
    await saude.ocioso();
    expect(avisos).toEqual([]);
    expect(saude.canal('sintonia-c1')?.estado).toBe('desligado');
    expect(saude.canal('assia')).toBeUndefined();
  });

  it('enquanto a pessoa lê o QR Code, QR vencido não é queda', async () => {
    const { saude, avisos } = montarSaude();
    saude.aoWebhook(conexao('sintonia-c1', 'open'));
    saude.desligadoPelaPessoa('sintonia-c1');
    saude.pareandoPelaPessoa('sintonia-c1');
    saude.aoWebhook(conexao('sintonia-c1', 'refused'));
    await saude.ocioso();
    expect(avisos).toEqual([]);
  });

  it('eventos estranhos não quebram e são ignorados', () => {
    const { saude } = montarSaude();
    for (const corpo of [null, 'texto', [], { event: 'connection.update' }, { event: 'connection.update', instance: 5, data: 'x' }, { event: 'presence.update', instance: 'sintonia-c1' }]) {
      expect(() => saude.aoWebhook(corpo)).not.toThrow();
    }
    expect(saude.aoWebhook({ event: 'presence.update', instance: 'sintonia-c1' })).toBe(false);
  });

  it('mensagem recebida guarda a hora e prova que o canal está conectado', async () => {
    const { saude } = montarSaude();
    const em = new Date('2026-11-20T11:59:00Z');
    saude.aoMensagem('sintonia-c1', em);
    expect(saude.canal('sintonia-c1')).toMatchObject({ estado: 'conectado', ultimaMensagemEm: em });
    expect(saude.resumo().canais[0]!.ultimaMensagemEm).toBe(em.toISOString());
  });
});

describe('Saúde do WhatsApp: verificação periódica e reconexão', () => {
  it('pega a queda sem webhook, tenta reconectar (sem número) e volta sozinho, sem aviso', async () => {
    const { saude, avisos, evo } = montarSaude();
    evo.por('sintonia-c1', 'conectada');
    evo.por('sintonia-c2', 'conectada');
    await saude.verificar();
    evo.por('sintonia-c1', 'desconectada'); // caiu sem mandar webhook
    await saude.verificar();
    await saude.ocioso();
    expect(evo.chamadas).toContain('reconectar:sintonia-c1');
    expect(saude.canal('sintonia-c1')?.estado).toBe('conectado');
    expect(avisos).toEqual([]);
  });

  it('a primeira tentativa não resolve: avisa; depois espera cada vez mais e para no limite', async () => {
    const { saude, avisos, evo, passar } = montarSaude();
    evo.por('sintonia-c1', 'conectada');
    await saude.verificar();
    evo.por('sintonia-c1', 'desconectada');
    evo.reconexao = 'conectando';
    await saude.verificar(); // tentativa 1
    await saude.ocioso();
    expect(avisos.map((a) => a.titulo)).toEqual(['O WhatsApp Atendimento desconectou']);
    expect(saude.resumo().canais[0]).toMatchObject({ reconectando: true, tentativas: 1 });
    await saude.verificar(); // cedo demais: não tenta
    expect(evo.chamadas.filter((c) => c.startsWith('reconectar')).length).toBe(1);
    passar(1);
    await saude.verificar(); // tentativa 2 (1 min depois)
    passar(1);
    await saude.verificar(); // ainda não (espera 2 min)
    passar(1);
    await saude.verificar(); // tentativa 3
    passar(60);
    await saude.verificar(); // limite atingido
    expect(evo.chamadas.filter((c) => c.startsWith('reconectar')).length).toBe(3);
    await saude.ocioso();
    expect(avisos).toHaveLength(1);
    expect(saude.resumo().canais[0]).toMatchObject({ reconectando: false });
  });

  it('se o WhatsApp pede QR Code de novo, não insiste: só avisa', async () => {
    const { saude, avisos, evo } = montarSaude();
    evo.por('sintonia-c1', 'conectada');
    await saude.verificar();
    evo.por('sintonia-c1', 'desconectada');
    evo.reconexao = 'precisa_parear';
    await saude.verificar();
    await saude.verificar();
    await saude.ocioso();
    expect(evo.chamadas.filter((c) => c.startsWith('reconectar'))).toHaveLength(1);
    expect(saude.canal('sintonia-c1')).toMatchObject({ estado: 'desconectado', precisaParear: true });
    expect(avisos).toHaveLength(1);
  });

  it('desconexão 401 lida da Evolution e instância apagada: avisa sem tentar reconectar', async () => {
    const { saude, avisos, evo } = montarSaude();
    evo.por('sintonia-c1', 'conectada');
    evo.por('sintonia-c2', 'conectada');
    await saude.verificar();
    evo.por('sintonia-c1', 'desconectada', 401);
    evo.apagar('sintonia-c2');
    await saude.verificar();
    await saude.ocioso();
    expect(evo.chamadas.some((c) => c.startsWith('reconectar'))).toBe(false);
    expect(avisos.map((a) => a.titulo).sort()).toEqual(['O WhatsApp Atendimento desconectou', 'O WhatsApp Vendas desconectou']);
    expect(saude.canal('sintonia-c1')?.motivo).toMatch(/celular/);
  });

  it('"conectando" por muito tempo num canal que já funcionou vira queda', async () => {
    const { saude, avisos, evo, passar } = montarSaude();
    evo.por('sintonia-c1', 'conectada');
    await saude.verificar();
    evo.por('sintonia-c1', 'conectando');
    await saude.verificar();
    passar(2);
    await saude.verificar();
    expect(avisos).toHaveLength(0);
    passar(4);
    await saude.verificar();
    await saude.ocioso();
    expect(avisos).toHaveLength(1);
    expect(saude.canal('sintonia-c1')).toMatchObject({ estado: 'desconectado', precisaParear: true });
  });

  it('servidor da Evolution fora: um aviso por queda (depois de 2 falhas) e um quando volta', async () => {
    const { saude, avisos, evo, passar } = montarSaude();
    evo.por('sintonia-c1', 'conectada');
    await saude.verificar();
    evo.fora = true;
    await saude.verificar();
    await saude.ocioso();
    expect(avisos).toHaveLength(0); // uma falha só pode ser um tropeço
    for (let i = 0; i < 5; i++) await saude.verificar();
    await saude.ocioso();
    expect(avisos.map((a) => a.titulo)).toEqual(['Servidor do WhatsApp sem resposta']);
    expect(saude.servidorOk()).toBe(false);
    // Servidor fora não muda o estado dos canais.
    expect(saude.canal('sintonia-c1')?.estado).toBe('conectado');
    evo.fora = false;
    await saude.verificar();
    await saude.verificar();
    await saude.ocioso();
    expect(avisos.map((a) => a.titulo)).toEqual(['Servidor do WhatsApp sem resposta', 'O servidor do WhatsApp voltou']);
    // Nova queda: novo aviso (chave nova).
    passar(10);
    evo.fora = true;
    await saude.verificar();
    await saude.verificar();
    await saude.ocioso();
    expect(avisos).toHaveLength(3);
    expect(new Set(avisos.map((a) => a.chave)).size).toBe(3);
  });

  it('guarda o estado: depois de reiniciar não repete o aviso da mesma queda', async () => {
    const { saude, avisos, armazem, relogio } = montarSaude();
    saude.aoWebhook(conexao('sintonia-c1', 'open'));
    saude.aoWebhook(conexao('sintonia-c1', 'close', 401));
    await saude.ocioso();
    expect(avisos).toHaveLength(1);
    const avisos2: AvisoSaude[] = [];
    const outra = new SaudeWhatsApp({ armazem, admin: () => undefined, canais: () => CANAIS, avisar: async (a) => { avisos2.push(a); }, agora: () => relogio.t });
    await outra.carregar();
    expect(outra.canal('sintonia-c1')).toMatchObject({ estado: 'desconectado', avisado: true, jaConectou: true });
    outra.aoWebhook(conexao('sintonia-c1', 'close', 401));
    await outra.ocioso();
    expect(avisos2).toEqual([]);
  });

  it('o relógio não segura o processo aberto', () => {
    const { saude } = montarSaude();
    saude.iniciar(120_000, 20_000);
    const r = (saude as unknown as { relogio: { hasRef(): boolean } }).relogio;
    expect(r.hasRef()).toBe(false);
    saude.parar();
  });
});

describe.runIf(temPostgres)('Saúde do WhatsApp no Postgres', () => {
  it('grava, relê e apaga', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.whatsapp_saude');
    const a = new ArmazemSaudePostgres(pool);
    await a.gravar('sintonia-c1', { estado: 'desconectado', avisado: true });
    await a.gravar('sintonia-c1', { estado: 'conectado' });
    expect(await a.carregar()).toEqual([{ chave: 'sintonia-c1', dados: { estado: 'conectado' } }]);
    await a.apagar('sintonia-c1');
    expect(await a.carregar()).toEqual([]);
  });
});

// ---------------------------------------------------------------- envio

/** fetch falso que responde em sequência (Response, ou Error para simular falha de rede). */
function fetchSequencia(respostas: Array<Response | Error>) {
  const pedidos: Array<{ url: string; corpo: unknown }> = [];
  const f = (async (url: string, init?: RequestInit) => {
    if (String(url).includes('sendPresence')) return new Response('{}'); // "digitando…" não é mensagem
    pedidos.push({ url, corpo: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = respostas.shift() ?? new Response('{}', { status: 500 });
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { f, pedidos };
}
const okEnvio = (id = 'ABC') => new Response(JSON.stringify({ key: { id } }), { status: 201 });
const erroRede = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

describe('Envio pela Evolution: erros claros, nova tentativa só sem risco de duplicar', () => {
  it('número sem WhatsApp: mensagem clara e nenhuma nova tentativa', async () => {
    const { f, pedidos } = fetchSequencia([
      new Response(JSON.stringify({ status: 400, error: 'Bad Request', response: { message: [{ jid: '5571900000000@s.whatsapp.net', exists: false, number: '5571900000000' }] } }), { status: 400 }),
    ]);
    const canal = new CanalEvolution('https://evo', 'k', f, semEspera);
    const e = await canal.enviarTexto('sintonia-c1', '5571900000000', 'oi').catch((x) => x);
    expect(e).toBeInstanceOf(ErroEnvioWhatsApp);
    expect(e).toMatchObject({ codigo: 'sem_whatsapp', statusCode: 422, message: 'Não enviada: este número não tem WhatsApp.' });
    expect(pedidos).toHaveLength(1);
  });

  it('servidor fora antes de chegar (ECONNREFUSED, 502/503): tenta de novo e envia uma vez só', async () => {
    const { f, pedidos } = fetchSequencia([erroRede('ECONNREFUSED'), new Response('Bad Gateway', { status: 502 }), okEnvio('ID9')]);
    const canal = new CanalEvolution('https://evo', 'k', f, semEspera);
    expect(await canal.enviarTexto('sintonia-c1', '5571988887777', 'oi')).toEqual({ idExterno: 'ID9' });
    expect(pedidos).toHaveLength(3);
  });

  it('servidor fora o tempo todo: desiste depois de 3 tentativas com mensagem clara', async () => {
    const { f, pedidos } = fetchSequencia([erroRede('ECONNREFUSED'), erroRede('ECONNREFUSED'), erroRede('ECONNREFUSED'), okEnvio()]);
    const e = await new CanalEvolution('https://evo', 'k', f, semEspera).enviarTexto('sintonia-c1', '5571988887777', 'oi').catch((x) => x);
    expect(e).toMatchObject({ codigo: 'servidor_fora', message: expect.stringMatching(/não respondeu/) });
    expect(pedidos).toHaveLength(3);
  });

  it('WhatsApp desconectado (Connection Closed): tenta mais uma vez; se continuar, avisa', async () => {
    const fechado = () => new Response(JSON.stringify({ status: 500, error: 'Internal Server Error', response: { message: ['Error: Connection Closed'] } }), { status: 500 });
    const a = fetchSequencia([fechado(), okEnvio('V')]);
    expect(await new CanalEvolution('https://evo', 'k', a.f, semEspera).enviarTexto('sintonia-c1', '5571988887777', 'oi')).toEqual({ idExterno: 'V' });
    const b = fetchSequencia([fechado(), fechado(), okEnvio()]);
    const e = await new CanalEvolution('https://evo', 'k', b.f, semEspera).enviarTexto('sintonia-c1', '5571988887777', 'oi').catch((x) => x);
    expect(e).toMatchObject({ codigo: 'desconectado', message: expect.stringMatching(/^Não enviada: o WhatsApp deste canal está desconectado/) });
    expect(b.pedidos).toHaveLength(2);
  });

  it('tempo esgotado ou queda no meio: nunca reenvia (pode ter saído)', async () => {
    for (const falha of [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), erroRede('ECONNRESET'), new Response('', { status: 504 })]) {
      const { f, pedidos } = fetchSequencia([falha, okEnvio()]);
      const e = await new CanalEvolution('https://evo', 'k', f, semEspera).enviarTexto('sintonia-c1', '5571988887777', 'oi').catch((x) => x);
      expect(e).toMatchObject({ codigo: 'incerto' });
      expect(pedidos).toHaveLength(1);
    }
  });

  it('canal apagado, chave errada, 500 genérico e outro 4xx viram mensagens próprias', () => {
    expect(erroDaResposta(404, '{"response":{"message":["The \\"sintonia-c1\\" instance does not exist"]}}').codigo).toBe('canal_inexistente');
    expect(erroDaResposta(401, 'Unauthorized').codigo).toBe('chave_recusada');
    expect(erroDaResposta(500, 'oops').codigo).toBe('servidor_erro');
    expect(erroDaResposta(400, '{"message":"bad"}').codigo).toBe('recusado');
    expect(erroDaResposta(429, '').temporario).toBe(true);
  });

  it('o aviso de falha do sistema não dispara por número sem WhatsApp', () => {
    expect(classificarFalha('Não enviada: este número não tem WhatsApp.')).toBeUndefined();
    expect(classificarFalha(new ErroEnvioWhatsApp('desconectado').message)?.classe).toBe('whatsapp');
  });
});

// ---------------------------------------------------------------- eco (fromMe) e conversa

let seq = 0;
const recebida = (texto: string, extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  canalId: 'sintonia-c1',
  telefone: '5571988124471',
  nome: 'Marina',
  texto,
  deMim: false,
  idExterno: `in-${++seq}`,
  em: new Date('2026-11-20T12:00:00Z'),
  ...extra,
});

function montarConversa(respostas: Array<Response | Error>) {
  const repo = new RepositorioMemoria();
  const fx = fetchSequencia(respostas);
  const canal = new CanalEvolution('https://evo', 'k', fx.f, semEspera);
  const sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'sintonia-c1', unidade: 'norte', canal }],
    agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) },
    agora: () => new Date('2026-11-20T12:00:00Z'),
  });
  return { repo, sintonia, canal, fx };
}

describe('Eco das mensagens da própria Sintonia (sem loop)', () => {
  it('envio confirmado: o eco fromMe é ignorado', async () => {
    const { repo, sintonia } = montarConversa([okEnvio('OUT1')]);
    await sintonia.receber(recebida('Oi'));
    const [c] = await repo.listarConversas();
    await sintonia.equipeEnviou(c!.id, 'Olá, tudo bem?', 'Ana');
    await sintonia.receber(recebida('Olá, tudo bem?', { deMim: true, idExterno: 'OUT1' }));
    expect((await repo.mensagens(c!.id)).map((m) => m.autor)).toEqual(['cliente', 'equipe']);
  });

  it('tempo esgotado e a mensagem saiu: o eco entra na conversa (ninguém manda de novo)', async () => {
    const { repo, sintonia } = montarConversa([Object.assign(new Error('timeout'), { name: 'TimeoutError' })]);
    await sintonia.receber(recebida('Oi'));
    const [c] = await repo.listarConversas();
    await expect(sintonia.equipeEnviou(c!.id, 'Já te respondo', 'Ana')).rejects.toMatchObject({ codigo: 'incerto' });
    expect(await repo.mensagens(c!.id)).toHaveLength(1);
    await sintonia.receber(recebida('Já te respondo', { deMim: true, idExterno: 'OUT-X' }));
    expect((await repo.mensagens(c!.id)).map((m) => m.texto)).toEqual(['Oi', 'Já te respondo']);
  });

  it('envio que falhou de vez: a mesma frase digitada no celular não some', async () => {
    const { repo, sintonia } = montarConversa([new Response('{"exists":false}', { status: 400 })]);
    await sintonia.receber(recebida('Oi'));
    const [c] = await repo.listarConversas();
    await expect(sintonia.equipeEnviou(c!.id, 'Bom dia', 'Ana')).rejects.toMatchObject({ codigo: 'sem_whatsapp' });
    await sintonia.receber(recebida('Bom dia', { deMim: true, idExterno: 'CEL1' }));
    expect((await repo.mensagens(c!.id)).map((m) => m.texto)).toEqual(['Oi', 'Bom dia']);
  });

  it('aviso para a equipe e relatório (enviarAvulso): o eco não vira conversa nova', async () => {
    const { repo, sintonia } = montarConversa([okEnvio('AV1')]);
    await sintonia.enviarAvulso({ canalId: 'sintonia-c1', unidade: 'norte', canal: (sintonia as unknown as { d: { numeros: Array<{ canal: CanalEvolution }> } }).d.numeros[0]!.canal }, '5571999990000', 'Relatório do dia');
    await sintonia.receber(recebida('Relatório do dia', { deMim: true, idExterno: 'AV1', telefone: '5571999990000' }));
    expect(await repo.listarConversas()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- servidor (webhook, faixa, erro de envio)

function montarServidor(respostas: Array<Response | Error> = []) {
  const m = montarConversa(respostas);
  const { saude, avisos, evo } = montarSaude();
  const app = criarServidor({ sintonia: m.sintonia, repo: m.repo, evolution: { canal: m.canal, token: 'tok-123' }, whatsappSaude: saude });
  const webhook = (payload: unknown, token = 'tok-123') => app.inject({ method: 'POST', url: '/webhooks/evolution', headers: { 'x-sintonia-token': token, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  return { ...m, saude, avisos, evo, app, webhook };
}

describe('Webhook /webhooks/evolution', () => {
  it('token errado: 401; corpo estranho e evento desconhecido: 200 sem erro', async () => {
    const { webhook } = montarServidor();
    expect((await webhook({ event: 'messages.upsert' }, 'errado')).statusCode).toBe(401);
    expect((await webhook({ event: 'messages.upsert' }, 'tok-12')).statusCode).toBe(401);
    for (const corpo of [[], 'oi', 42, {}, { event: 'presence.update', instance: 'sintonia-c1', data: { id: 'x' } }, { event: 'messages.upsert', instance: 'sintonia-c1', data: { nada: true } }, { event: 'messages.upsert', instance: 'sintonia-c1', data: [{ key: 5 }] }]) {
      const r = await webhook(corpo);
      expect(r.statusCode).toBe(200);
    }
  });

  it('JSON quebrado: 400 (não 500)', async () => {
    const { app } = montarServidor();
    const r = await app.inject({ method: 'POST', url: '/webhooks/evolution', headers: { 'x-sintonia-token': 'tok-123', 'content-type': 'application/json' }, payload: '{"event":' });
    expect(r.statusCode).toBe(400);
  });

  it('CONNECTION_UPDATE de logout vira faixa no app; mensagem recebida guarda a hora', async () => {
    const { webhook, app, saude, avisos } = montarServidor();
    await webhook({ event: 'messages.upsert', instance: 'sintonia-c1', data: { key: { remoteJid: '5571988124471@s.whatsapp.net', fromMe: false, id: 'M1' }, pushName: 'Ana', message: { conversation: 'oi' }, messageTimestamp: 1795180000 } });
    expect(saude.canal('sintonia-c1')).toMatchObject({ estado: 'conectado', ultimaMensagemEm: new Date(1795180000 * 1000) });
    expect((await app.inject({ url: '/api/whatsapp/saude' })).json().canais).toEqual([]);

    const r = await webhook({ event: 'connection.update', instance: 'sintonia-c1', data: { instance: 'sintonia-c1', state: 'close', statusReason: 401 } });
    expect(r.statusCode).toBe(200);
    await saude.ocioso();
    expect(avisos).toHaveLength(1);
    const faixa = (await app.inject({ url: '/api/whatsapp/saude' })).json();
    expect(faixa).toMatchObject({ servidor: { ok: true }, canais: [{ id: 'sintonia-c1', nome: 'Atendimento', precisaParear: true }], podeReconectar: true });
  });

  it('envio pela conversa com WhatsApp desconectado: resposta com mensagem clara', async () => {
    const fechado = () => new Response('{"response":{"message":["Error: Connection Closed"]}}', { status: 500 });
    const { app, sintonia, repo } = montarServidor([fechado(), fechado()]);
    await sintonia.receber(recebida('Oi'));
    const [c] = await repo.listarConversas();
    const r = await app.inject({ method: 'POST', url: `/api/conversas/${c!.id}/enviar`, payload: { texto: 'Bom dia', atendente: 'Ana' } });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ codigo: 'desconectado', erro: expect.stringMatching(/^Não enviada: o WhatsApp deste canal está desconectado/) });
  });
});

// ---------------------------------------------------------------- notificação para a gestão

describe('Aviso para a gestão (sino + push)', () => {
  it('vai para admin, direção e gerência (não atendente), uma vez por chave', async () => {
    const contas = new ContasMemoria();
    const criar = (email: string, papel: 'admin' | 'direcao' | 'gerente' | 'atendente') =>
      contas.criarUsuario({ empresaId: 'imperio', nome: email, email, papel, unidades: ['norte'], senhaHash: 'x' });
    await criar('a@x.com', 'admin');
    await criar('d@x.com', 'direcao');
    await criar('g@x.com', 'gerente');
    await criar('t@x.com', 'atendente');
    const armazem = new ArmazemNotificacoesMemoria();
    const n = new Notificador({ armazem, contas, repo: new RepositorioMemoria(), empresaId: 'imperio' });
    const aviso = { titulo: 'O WhatsApp Atendimento desconectou', texto: 'Toque para reconectar.', chave: 'whatsapp-queda:sintonia-c1:1', vista: 'conexoes#nao-oficial' };
    expect(await n.avisarGestao(aviso)).toBe(3);
    expect(await n.avisarGestao(aviso)).toBe(0);
    const us = await contas.listarUsuarios('imperio');
    const lista = await n.listar(us.find((u) => u.email === 'a@x.com')!.id, 10);
    expect(lista.map((x) => x.titulo)).toEqual(['O WhatsApp Atendimento desconectou']);
    const atendente = await n.listar(us.find((u) => u.email === 't@x.com')!.id, 10);
    expect(JSON.stringify(atendente)).not.toContain('desconectou');
    expect(JSON.stringify(lista)).toContain('conexoes#nao-oficial');
  });
});

// ---------------------------------------------------------------- EvolutionAdmin

describe('EvolutionAdmin: reconectar e eventos do webhook', () => {
  function evo(o: { estado: string; connect: unknown; depois?: string; webhook?: unknown }) {
    const pedidos: Array<{ metodo: string; url: string; corpo?: unknown }> = [];
    let estado = o.estado;
    const f = (async (url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET';
      const corpo = init?.body ? JSON.parse(String(init.body)) : undefined;
      pedidos.push({ metodo, url, corpo });
      const u = new URL(url);
      if (u.pathname === '/instance/fetchInstances') return new Response(JSON.stringify([{ name: 'sintonia-c1', connectionStatus: estado, disconnectionReasonCode: 401 }]));
      if (u.pathname.startsWith('/instance/connect/')) { if (o.depois) estado = o.depois; return new Response(JSON.stringify(o.connect)); }
      if (u.pathname.startsWith('/webhook/find/')) return new Response(JSON.stringify(o.webhook ?? null));
      if (u.pathname.startsWith('/webhook/set/')) return new Response('{}');
      return new Response('?', { status: 404 });
    }) as typeof fetch;
    return { adm: new EvolutionAdmin('https://evo', 'k', f, semEspera), pedidos };
  }

  it('sessão ainda vale: religa sem número e confere', async () => {
    const { adm, pedidos } = evo({ estado: 'close', connect: {}, depois: 'open' });
    expect(await adm.reconectar('sintonia-c1')).toEqual({ estado: 'conectada' });
    const connect = pedidos.find((p) => p.url.includes('/instance/connect/'))!;
    expect(connect.url).toBe('https://evo/instance/connect/sintonia-c1'); // sem ?number
  });

  it('o WhatsApp devolve QR Code: precisa parear', async () => {
    const { adm } = evo({ estado: 'close', connect: { base64: 'data:image/png;base64,QR', code: '2@x' } });
    expect(await adm.reconectar('sintonia-c1')).toEqual({ estado: 'precisa_parear' });
  });

  it('listar traz o código da última desconexão', async () => {
    const { adm } = evo({ estado: 'close', connect: {} });
    expect((await adm.listar())[0]).toMatchObject({ estado: 'desconectada', codigoDesconexao: 401 });
  });

  it('instância antiga ganha CONNECTION_UPDATE mantendo endereço e token', async () => {
    const webhook = { url: 'https://sintonia/webhooks/evolution', enabled: true, headers: { 'x-sintonia-token': 't' }, events: ['MESSAGES_UPSERT', 'MESSAGES_SET', 'CALL'] };
    const { adm, pedidos } = evo({ estado: 'open', connect: {}, webhook });
    expect(await adm.atualizarEventos('sintonia-c1')).toBe(true);
    const set = pedidos.find((p) => p.url.includes('/webhook/set/'))!;
    expect(set.corpo).toMatchObject({ webhook: { url: webhook.url, headers: webhook.headers, base64: true, events: ['MESSAGES_UPSERT', 'MESSAGES_SET', 'CALL', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'] } });
    const outro = evo({ estado: 'open', connect: {}, webhook: { ...webhook, webhookBase64: true, events: ['MESSAGES_UPSERT', 'MESSAGES_SET', 'CALL', 'CONNECTION_UPDATE', 'MESSAGES_UPDATE'] } });
    expect(await outro.adm.atualizarEventos('sintonia-c1')).toBe(false);
    expect(await outro.adm.atualizarEventos('assia')).toBe(false);
  });
});
