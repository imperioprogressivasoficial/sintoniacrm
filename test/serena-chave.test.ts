import { describe, expect, it } from 'vitest';
import type { ClienteClaude, PedidoAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { RespostasMemoria } from '../src/conversa/respostas.js';
import { registrarConversa } from '../src/conversa/rotas.js';
import { TranscricoesMemoria } from '../src/conversa/transcricao.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemFollowupMemoria } from '../src/followup/armazem.js';
import { Followup } from '../src/followup/followup.js';
import { ArmazemCoberturaMemoria, CoberturaIa } from '../src/presenca/cobertura.js';
import { PresencasMemoria } from '../src/presenca/presenca.js';
import { AuditoriaMemoria } from '../src/seguranca/auditoria.js';
import {
  ArmazemPausaMemoria,
  ArmazemPausaPostgres,
  avisoDaMudanca,
  calcularAte,
  ChaveSerena,
  conversasParaRetomar,
  portaoIa,
  textoAte,
  type MudancaPausa,
} from '../src/serena/pausa.js';
import { registrarPausaSerena } from '../src/serena/pausa-rotas.js';
import { criarServidor } from '../src/server.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia, HORA, MIN } from '../src/util/tempo.js';
import { fabricas, poolDeTeste } from './repos.js';

/**
 * serena-chave: chave geral "Serena ligada / pausada". Pausada = como sem chave da IA, sem mexer na chave nem no modo
 * das conversas; volta sozinha na hora marcada; ao voltar, responde só quem escreveu há menos de 30 min.
 */

const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ telefone: string; texto: string }> = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, texto: string) {
    this.enviados.push({ telefone, texto });
    return { idExterno: `out-${this.enviados.length}-${Math.random()}` };
  }
}

async function montar(f: (typeof fabricas)[number], o: { temChave?: boolean } = {}) {
  const repo: Repositorio = await f.criar();
  const relogio = { t: quinta(14) };
  const agora = () => relogio.t;
  const auditoria = new AuditoriaMemoria();
  const armazem = f.nome === 'postgres' ? new ArmazemPausaPostgres(await poolDeTeste()) : new ArmazemPausaMemoria();
  const chave = new ChaveSerena({ empresaId: 'imperio', armazem, auditoria, agora });
  const mudancas: MudancaPausa[] = [];
  chave.aoMudar((m) => void mudancas.push(m));
  await chave.carregar();
  const portao = portaoIa({ chave, temChaveGeral: () => o.temChave ?? true });
  const canal = new CanalFalso();
  const pedidos: PedidoAgente[] = [];
  const s = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: { executar: async (p) => (pedidos.push(p), { texto: 'Oi! Sou a Serena.', acoes: [], recusou: false }) },
    agora,
    configIa: async () => ({ modoPadrao: 'ia' }),
    // Como no index: "IA atende primeiro" (aqui, sempre IA) passa pelo portão; a IA só é chamada com o portão aberto.
    modoInicial: portao.modoInicial(async () => 'ia' as const),
    iaDisponivel: (c) => portao.iaPara(c),
    respostaVencida: (c, a) => chave.respostaVencida(c, a),
  });
  let n = 0;
  const escreve = async (texto: string, telefone = `55719900001${String(++n).padStart(2, '0')}`) => {
    await s.receber({ canalId: 'imperio-norte', telefone, nome: `Cliente ${n}`, texto, deMim: false, idExterno: `in-${Math.random()}`, em: relogio.t });
    return (await repo.listarConversas()).find((c) => c.telefone === telefone)!;
  };
  const gestora = { id: 'u-fulana', nome: 'Fulana Souza', papel: 'gerente' };
  return { repo, relogio, auditoria, armazem, chave, mudancas, portao, canal, pedidos, s, escreve, gestora };
}

describe.each(fabricas)('Chave da Serena ($nome)', (f) => {
  it('pausada: a IA não é chamada, a conversa nova nasce em "Minha resposta" e o modo das outras não muda', async () => {
    const m = await montar(f);
    const antiga = await m.escreve('oi');
    expect(antiga.modo).toBe('ia');
    expect(m.pedidos).toHaveLength(1);

    await m.chave.pausar({ ate: calcularAte('1h', m.relogio.t), duracao: '1h' }, m.gestora);
    expect(m.chave.pausada()).toBe(true);
    expect(m.portao.iaAtiva()).toBe(false);

    m.relogio.t = quinta(14, 5);
    await m.escreve('quanto custa a progressiva?', antiga.telefone);
    expect(m.pedidos).toHaveLength(1); // a IA não foi chamada
    expect(m.canal.enviados).toHaveLength(1); // só a resposta de antes da pausa
    expect((await m.repo.buscarConversa(antiga.id))!.modo).toBe('ia'); // o modo fica como estava

    const nova = await m.escreve('oi, primeira vez aqui');
    expect(nova.modo).toBe('humano');
    expect(m.pedidos).toHaveLength(1);
    expect(await m.portao.modoNovo(async () => 'ia')).toBe('humano');
  });

  it('vence sozinha: passou da hora, conta como ligada e a volta fica registrada uma vez só (com nota)', async () => {
    const m = await montar(f);
    await m.chave.pausar({ ate: quinta(15), duracao: '1h' }, m.gestora);
    m.relogio.t = quinta(14, 59);
    expect(m.chave.pausada()).toBe(true);
    m.relogio.t = quinta(15, 1);
    expect(m.chave.pausada()).toBe(false);
    expect(m.chave.pausada()).toBe(false);
    await m.chave.carregar();
    await m.chave.ocioso();
    // Outro processo lendo o banco: já está ligada, e não registra de novo.
    const outro = new ChaveSerena({ empresaId: 'imperio', armazem: m.armazem, auditoria: m.auditoria, agora: () => m.relogio.t });
    await outro.carregar();
    await outro.ocioso();
    expect(outro.pausada()).toBe(false);
    const voltas = m.auditoria.linhas.filter((l) => l.acao === 'serena_voltou_sozinha');
    expect(voltas).toHaveLength(1);
    expect(voltas[0]!.detalhe).toMatchObject({ pausadaPor: 'Fulana Souza', nota: expect.stringContaining('voltou sozinha') });
    expect(m.mudancas.map((x) => x.tipo)).toEqual(['pausou', 'voltou_sozinha']);
    expect(avisoDaMudanca(m.mudancas[1]!, m.relogio.t).titulo).toBe('A Serena voltou a atender');
    expect(outro.ultima()).toMatchObject({ como: 'venceu' });
  });

  it('ao ligar de novo: responde só quem escreveu há menos de 30 min; as mais antigas ficam com a equipe', async () => {
    const m = await montar(f);
    const a = await m.escreve('oi');
    const b = await m.escreve('oi');
    const enviadosAntes = m.canal.enviados.length;
    await m.chave.pausar({ ate: null, duracao: 'indefinido' }, m.gestora);
    m.relogio.t = quinta(14, 10);
    await m.escreve('alguém aí?', b.telefone); // vai esperar mais de 30 min
    m.relogio.t = quinta(14, 40);
    await m.escreve('quero agendar', a.telefone); // 10 min antes de ligar
    m.relogio.t = quinta(14, 50);
    expect(m.canal.enviados).toHaveLength(enviadosAntes);

    expect(await m.chave.ligar(m.gestora)).toBe(true);
    const lista = conversasParaRetomar(await m.repo.listarConversas(), m.relogio.t);
    expect(lista.map((c) => c.id)).toEqual([a.id]);
    for (const c of lista) await m.s.reavaliar(c.id);
    expect(m.canal.enviados.slice(enviadosAntes).map((x) => x.telefone)).toEqual([a.telefone]);

    // Mesmo que algo peça para pensar de novo, a mensagem de 40 min atrás fica com a equipe.
    await m.s.reavaliar(b.id);
    expect(m.canal.enviados.slice(enviadosAntes)).toHaveLength(1);
    expect((await m.repo.buscarConversa(b.id))!.modo).toBe('ia');
    // A cliente escreve de novo: a Serena volta a responder normalmente.
    m.relogio.t = quinta(14, 55);
    await m.escreve('oi de novo', b.telefone);
    expect(m.canal.enviados.slice(enviadosAntes).map((x) => x.telefone)).toEqual([a.telefone, b.telefone]);
  });

  it('auditoria: pausou e ligou ficam registrados com quem, quando e até quando', async () => {
    const m = await montar(f);
    await m.chave.pausar({ ate: quinta(15), duracao: '1h', motivo: 'Treinamento da equipe' }, { ...m.gestora, ip: '10.0.0.1' });
    await m.chave.ligar({ id: 'u-bruno', nome: 'Bruno Batista', papel: 'admin' });
    const [ligou, pausou] = await m.auditoria.listar('imperio');
    expect(pausou).toMatchObject({ acao: 'serena_pausou', autorNome: 'Fulana Souza', papel: 'gerente', alvo: 'serena', ip: '10.0.0.1', detalhe: { ate: quinta(15).toISOString(), duracao: '1h', motivo: 'Treinamento da equipe' } });
    expect(ligou).toMatchObject({ acao: 'serena_ligou', autorNome: 'Bruno Batista', detalhe: { pausadaPor: 'Fulana Souza' } });
    expect(avisoDaMudanca(m.mudancas[0]!, m.relogio.t).titulo).toBe('Fulana pausou a Serena até 15h');
    expect(avisoDaMudanca(m.mudancas[1]!, m.relogio.t).titulo).toBe('Bruno ligou a Serena de novo');
    // Ligar quando já está ligada não registra nada.
    expect(await m.chave.ligar(m.gestora)).toBe(false);
    expect(m.auditoria.linhas).toHaveLength(2);
  });
});

describe('Chave da Serena: textos e horários', () => {
  it('"amanhã" é o dia seguinte às 8h da Bahia; os textos são simples', () => {
    expect(calcularAte('amanha', quinta(22, 30))).toEqual(bahia(2026, 11, 6, 8, 0));
    expect(calcularAte('1h', quinta(14))).toEqual(quinta(15));
    expect(calcularAte('indefinido', quinta(14))).toBeNull();
    expect(textoAte(quinta(15), quinta(14))).toBe('até 15h');
    expect(textoAte(quinta(15, 30), quinta(14))).toBe('até 15h30');
    expect(textoAte(bahia(2026, 11, 6, 8), quinta(14))).toBe('até amanhã às 8h');
    expect(textoAte(bahia(2026, 11, 9, 8), quinta(14))).toBe('até seg., 09/11 às 8h');
    expect(textoAte(null, quinta(14))).toBe('até alguém ligar de novo');
  });
});

describe('Chave da Serena: quem mais respeita a pausa', () => {
  it('a cobertura do "Disponível" não passa conversas para a IA com a Serena pausada', async () => {
    const repo = new RepositorioMemoria();
    const contas = new ContasMemoria();
    const carla: Usuario = await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Souza', email: 'carla@x.com', papel: 'atendente', unidades: ['norte'], senhaHash: 'x' });
    const relogio = { t: quinta(14) };
    const chave = new ChaveSerena({ empresaId: 'imperio', armazem: new ArmazemPausaMemoria(), agora: () => relogio.t });
    const portao = portaoIa({ chave, temChaveGeral: () => true });
    const s = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal: new CanalFalso() }], agente: { executar: async () => ({ texto: 'oi', acoes: [], recusou: false }) }, agora: () => relogio.t, iaDisponivel: (c) => portao.iaPara(c) });
    const cob = new CoberturaIa({ empresaId: 'imperio', armazem: new ArmazemCoberturaMemoria(), repo, contas, presencas: new PresencasMemoria(), comConversa: (id, fn) => s.comConversa(id, fn), temIa: (c) => portao.iaPara(c), reavaliar: (id) => s.reavaliar(id), agora: () => relogio.t });
    const { conversa: c } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: '5571990000001', nome: 'Maria', agora: quinta(13) });
    Object.assign(c, { modo: 'humano', etapa: 'em_conversa', ultimaMensagemCliente: quinta(13), ultimaMensagemEquipe: quinta(13, 1), responsavelId: carla.id, responsavelNome: carla.nome });
    await repo.salvarConversa(c);

    await chave.pausar({ ate: null }, { nome: 'Fulana' });
    expect(await cob.aoMudar(carla, 'offline')).toEqual({ cobertas: 0, devolvidas: 0 });
    expect((await repo.buscarConversa(c.id))!.modo).toBe('humano');
    // Ligada de novo, a cobertura volta a valer.
    await chave.ligar({ nome: 'Fulana' });
    await cob.aoMudar(carla, 'online');
    expect((await cob.aoMudar(carla, 'offline')).cobertas).toBe(1);
  });

  it('follow-up: com a Serena pausada a cadência espera (fica adiada, não se perde)', async () => {
    const repo = new RepositorioMemoria();
    const relogio = { t: quinta(14) };
    const chave = new ChaveSerena({ empresaId: 'imperio', armazem: new ArmazemPausaMemoria(), agora: () => relogio.t });
    const armazem = new ArmazemFollowupMemoria();
    const s = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal: new CanalFalso() }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) }, agora: () => relogio.t });
    const fu = new Followup({ empresaId: 'imperio', armazem, repo, sintonia: () => s, agora: () => relogio.t, pausada: () => chave.pausada() });
    const { conversa: c } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: '5571990000002', nome: 'Maria', agora: quinta(13) });
    await armazem.programar('imperio', { conversaId: c.id, tipo: 'cadencia', situacao: 'sem_resposta', passo: 0, total: 1, chave: `fu:${c.id}:0`, quando: quinta(13, 59), dados: {} }, quinta(13));
    await chave.pausar({ ate: null }, { nome: 'Fulana' });
    await fu.tick();
    const [e] = await armazem.envios(c.id);
    expect(e!.estado).toBe('pendente');
    expect(e!.quando.getTime()).toBeGreaterThanOrEqual(quinta(14, 15).getTime());
  });
});

describe('Chave da Serena: telas e permissões', () => {
  async function servidor() {
    const contas = new ContasMemoria();
    const senhaHash = await gerarHash('Imperio2026xyz');
    await contas.criarUsuario({ empresaId: 'imperio', nome: 'Fulana Souza', email: 'fulana@imperio.com', papel: 'gerente', unidades: ['norte'], senhaHash });
    await contas.criarUsuario({ empresaId: 'imperio', nome: 'Carla Lima', email: 'carla@imperio.com', papel: 'atendente', unidades: ['norte'], senhaHash });
    const repo = new RepositorioMemoria();
    const relogio = { t: quinta(14) };
    const auditoria = new AuditoriaMemoria();
    const chave = new ChaveSerena({ empresaId: 'imperio', armazem: new ArmazemPausaMemoria(), auditoria, agora: () => relogio.t });
    const sintonia = new Sintonia({ empresaId: 'imperio', repo, numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal: new CanalFalso() }], agente: { executar: async () => ({ texto: '', acoes: [], recusou: false }) } });
    const app = criarServidor({ sintonia, repo, auth: { contas } });
    const pedidosIa: unknown[] = [];
    const claude = { beta: { messages: { create: async (p: unknown) => (pedidosIa.push(p), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hoje você tem 3 clientes esperando.' }] }) } } };
    // Como no index: o chat da Serena olha só a chave da IA (iaLigada), não a pausa.
    registrarConversa(app, { repo, sintonia, empresaId: 'imperio', agora: () => relogio.t, respostas: new RespostasMemoria(), transcricoes: new TranscricoesMemoria(), ia: { claude: claude as unknown as ClienteClaude, modelo: 'claude-opus-5-5', base: async () => '', ligada: () => true }, canalDa: () => ({ erro: 'sem número' }) });
    registrarPausaSerena(app, { chave, temChave: () => true, agora: () => relogio.t });
    const entrar = async (email: string) => String((await app.inject({ method: 'POST', url: '/api/auth/entrar', payload: { email, senha: 'Imperio2026xyz' } })).headers['set-cookie']).split(';')[0]!;
    return { app, chave, auditoria, relogio, pedidosIa, gestora: await entrar('fulana@imperio.com'), carla: await entrar('carla@imperio.com') };
  }

  it('a atendente vê o estado mas não muda; a gestão pausa e liga', async () => {
    const m = await servidor();
    const ver = (cookie: string) => m.app.inject({ method: 'GET', url: '/api/ia/pausa', headers: { cookie } });
    const mudar = (cookie: string, payload: object) => m.app.inject({ method: 'PUT', url: '/api/ia/pausa', headers: { cookie }, payload });
    expect((await ver(m.carla)).json()).toMatchObject({ pausada: false, podeMudar: false, temChave: true });
    const r = await mudar(m.carla, { pausada: true, duracao: '1h' });
    expect(r.statusCode).toBe(403);
    expect(r.json().erro).toBe('Só a gestão liga e desliga a Serena.');
    expect(m.chave.pausada()).toBe(false);
    expect(m.auditoria.linhas).toHaveLength(0);

    const p = await mudar(m.gestora, { pausada: true, duracao: 'amanha' });
    expect(p.statusCode, p.body).toBe(200);
    expect(p.json()).toMatchObject({ pausada: true, podeMudar: true, por: 'Fulana Souza', texto: 'até amanhã às 8h', ate: bahia(2026, 11, 6, 8).toISOString() });
    expect((await ver(m.carla)).json()).toMatchObject({ pausada: true, texto: 'até amanhã às 8h', podeMudar: false });
    expect((await mudar(m.carla, { pausada: false })).statusCode).toBe(403);
    expect(m.chave.pausada()).toBe(true);
    expect((await mudar(m.gestora, { pausada: true })).statusCode).toBe(400); // falta a duração
    expect((await mudar(m.gestora, { pausada: false })).json()).toMatchObject({ pausada: false });
    expect(m.auditoria.linhas.map((l) => l.acao)).toEqual(['serena_pausou', 'serena_ligou']);
    expect(m.auditoria.linhas[0]!.autorNome).toBe('Fulana Souza');
  });

  it('o chat da Serena no app (a equipe falando com ela) continua funcionando com a Serena pausada', async () => {
    const m = await servidor();
    await m.chave.pausar({ ate: new Date(m.relogio.t.getTime() + HORA) }, { nome: 'Fulana' });
    expect(m.chave.pausada()).toBe(true);
    const r = await m.app.inject({ method: 'POST', url: '/api/ia/chat', headers: { cookie: m.carla }, payload: { mensagens: [{ papel: 'usuario', texto: 'Como está o dia?' }] } });
    expect(r.statusCode, r.body).toBe(200);
    expect(JSON.stringify(r.json())).toContain('3 clientes esperando');
    expect(m.pedidosIa).toHaveLength(1);
  });
});

it('uma conversa só volta a ser respondida se a última mensagem da cliente é recente e sem resposta', () => {
  const agora = quinta(15);
  const c = (id: string, extra: Partial<Conversa>) => ({ id, modo: 'ia' as const, ultimaMensagemCliente: undefined, ultimaMensagemEquipe: undefined, ultimaMensagemIa: undefined, ...extra });
  const lista = [
    c('recente', { ultimaMensagemCliente: new Date(agora.getTime() - 10 * MIN) }),
    c('antiga', { ultimaMensagemCliente: new Date(agora.getTime() - 31 * MIN) }),
    c('respondida', { ultimaMensagemCliente: new Date(agora.getTime() - 10 * MIN), ultimaMensagemEquipe: new Date(agora.getTime() - 5 * MIN) }),
    c('copiloto', { modo: 'copiloto', ultimaMensagemCliente: new Date(agora.getTime() - 5 * MIN) }),
  ];
  expect(conversasParaRetomar(lista, agora).map((x) => x.id)).toEqual(['recente']);
});
