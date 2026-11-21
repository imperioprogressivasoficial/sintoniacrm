import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { Agente, TEXTO_PASSAGEM_DEPOIS, type ClienteClaude, type PedidoAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, type Usuario } from '../src/auth/contas.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import type { Conversa } from '../src/domain.js';
import { ArmazemCoberturaMemoria, ArmazemCoberturaPostgres, CoberturaIa } from '../src/presenca/cobertura.js';
import { PresencasMemoria, registrarPresenca } from '../src/presenca/presenca.js';
import type { Repositorio } from '../src/store/repositorio.js';
import { bahia } from '../src/util/tempo.js';
import { fabricas, poolDeTeste } from './repos.js';

/**
 * ia-completa: "Disponível para atender" desligado = a IA cobre as conversas da pessoa; ligado de novo = devolve.
 * E a IA sabe, em cada resposta, quantas pessoas da unidade estão atendendo e se a responsável está disponível.
 */

const quinta = (h: number, m = 0) => bahia(2026, 11, 5, h, m);

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: string[] = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, _t: string, texto: string) {
    this.enviados.push(texto);
    return { idExterno: `out-${this.enviados.length}` };
  }
}

async function montar(f: (typeof fabricas)[number], o: { temIa?: boolean } = {}) {
  const repo: Repositorio = await f.criar();
  const armazem = f.nome === 'postgres' ? new ArmazemCoberturaPostgres(await poolDeTeste()) : new ArmazemCoberturaMemoria();
  const contas = new ContasMemoria();
  const novo = (nome: string, unidades: string[], papel: Usuario['papel'] = 'atendente') => contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@x.com`, papel, unidades, senhaHash: 'x' });
  const carla = await novo('Carla Souza', ['norte']);
  const ana = await novo('Ana Lima', ['norte']);
  const bia = await novo('Bia Rocha', ['sumare']);
  const presencas = new PresencasMemoria();
  const canal = new CanalFalso();
  const relogio = { t: quinta(14) };
  const pedidos: PedidoAgente[] = [];
  let cob!: CoberturaIa;
  const s = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: { executar: async (p) => (pedidos.push(p), { texto: 'Oi! Eu continuo com você.', acoes: [], recusou: false }) },
    agora: () => relogio.t,
    equipeAgora: (c) => cob.equipeAgora(c),
  });
  cob = new CoberturaIa({
    empresaId: 'imperio',
    armazem,
    repo,
    contas,
    presencas,
    comConversa: (id, fn) => s.comConversa(id, fn),
    temIa: async () => o.temIa ?? true,
    reavaliar: (id) => s.reavaliar(id),
    agora: () => relogio.t,
  });
  let n = 0;
  /** Conversa da Carla (ou de outra dona), já com uma mensagem da cliente. */
  const conversa = async (dona: Usuario | null, extra: Partial<Conversa> = {}, esperando = false) => {
    const tel = `55719900000${String(++n).padStart(2, '0')}`;
    const { conversa: c } = await repo.buscarOuCriarConversa({ empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: tel, nome: `Cliente ${n}`, agora: quinta(13) });
    await repo.adicionarMensagem({ conversaId: c.id, autor: 'cliente', texto: 'oi', em: quinta(13) });
    if (!esperando) await repo.adicionarMensagem({ conversaId: c.id, autor: 'equipe', autorNome: 'Carla', texto: 'Oi! Já te ajudo.', em: quinta(13, 1) });
    Object.assign(c, { modo: 'humano', etapa: 'em_conversa', ultimaMensagemCliente: quinta(13), ...(esperando ? {} : { ultimaMensagemEquipe: quinta(13, 1) }), ...(dona ? { responsavelId: dona.id, responsavelNome: dona.nome } : {}), ...extra });
    await repo.salvarConversa(c);
    return c;
  };
  const notas = async (id: string) => (await repo.mensagens(id)).filter((m) => m.autor === 'sistema').map((m) => m.texto);
  return { repo, armazem, contas, presencas, canal, relogio, pedidos, s, cob, conversa, notas, carla, ana, bia };
}

describe.each(fabricas)('A IA cobre quem ficou indisponível ($nome)', (f) => {
  it('desligou "Disponível": a IA assume só as conversas abertas da pessoa em "Só eu", com a marca; a dona continua', async () => {
    const m = await montar(f);
    const a = await m.conversa(m.carla);
    const perdida = await m.conversa(m.carla, { etapa: 'perdida' });
    const sugestoes = await m.conversa(m.carla, { modo: 'copiloto' });
    const daAna = await m.conversa(m.ana);
    const r = await m.cob.aoMudar(m.carla, 'offline');
    expect(r).toEqual({ cobertas: 1, devolvidas: 0 });
    const depois = (await m.repo.buscarConversa(a.id))!;
    expect(depois.modo).toBe('ia');
    expect(depois.responsavelId).toBe(m.carla.id);
    expect(await m.armazem.daConversa(a.id)).toMatchObject({ usuarioId: m.carla.id });
    expect((await m.notas(a.id)).join()).toContain('Serena assumiu: Carla ficou indisponível.');
    for (const c of [perdida, sugestoes, daAna]) expect((await m.repo.buscarConversa(c.id))!.modo).toBe(c.modo);
  });

  it('cliente esperando: a IA responde na hora e sabe que a responsável está indisponível', async () => {
    const m = await montar(f);
    await m.presencas.gravar(m.carla.id, 'offline');
    const c = await m.conversa(m.carla, {}, true);
    await m.cob.aoMudar(m.carla, 'offline');
    expect(m.canal.enviados).toEqual(['Oi! Eu continuo com você.']);
    expect(m.pedidos[0]!.equipe!.texto).toContain('Responsável por esta conversa: Carla — indisponível.');
    expect(m.pedidos[0]!.equipe!.texto).toContain('Você está cobrindo Carla');
    expect((await m.repo.buscarConversa(c.id))!.modo).toBe('ia');
  });

  it('voltou: o que ainda está com a IA volta para "Só eu"; o que mudaram à mão fica como está', async () => {
    const m = await montar(f);
    const a = await m.conversa(m.carla);
    const b = await m.conversa(m.carla);
    await m.cob.aoMudar(m.carla, 'offline');
    // Alguém pôs a conversa B em Sugestões no meio tempo.
    await m.s.mudarModo(b.id, 'copiloto');
    const r = await m.cob.aoMudar(m.carla, 'online');
    expect(r.devolvidas).toBe(1);
    expect((await m.repo.buscarConversa(a.id))!.modo).toBe('humano');
    expect((await m.repo.buscarConversa(b.id))!.modo).toBe('copiloto');
    expect((await m.notas(a.id)).join()).toContain('Carla voltou: conversa devolvida.');
    expect(await m.armazem.daPessoa(m.carla.id)).toEqual([]);
  });

  it('conversa que mudou de dona no meio não volta para a pessoa', async () => {
    const m = await montar(f);
    const a = await m.conversa(m.carla);
    await m.cob.aoMudar(m.carla, 'offline');
    await m.s.definirResponsavel(a.id, { id: m.ana.id, nome: m.ana.nome }, { nome: 'Gil' }, 'transferiu');
    await m.cob.aoMudar(m.carla, 'online');
    expect((await m.repo.buscarConversa(a.id))!.modo).toBe('ia');
  });

  it('IA desligada (sem chave): não assume nada', async () => {
    const m = await montar(f, { temIa: false });
    const a = await m.conversa(m.carla);
    expect(await m.cob.aoMudar(m.carla, 'offline')).toEqual({ cobertas: 0, devolvidas: 0 });
    expect((await m.repo.buscarConversa(a.id))!.modo).toBe('humano');
    expect(await m.armazem.daConversa(a.id)).toBeUndefined();
  });

  it('a IA sabe quantas pessoas da unidade estão disponíveis (as de outra unidade não contam)', async () => {
    const m = await montar(f);
    const c = await m.conversa(m.carla);
    let e = (await m.cob.equipeAgora(c))!;
    expect(e.disponiveis).toBe(2);
    expect(e.texto).toContain('Equipe agora: 2 pessoas disponíveis para atender (Ana, Carla).');
    expect(e.texto).toContain('Responsável por esta conversa: Carla — disponível.');
    await m.presencas.gravar(m.ana.id, 'offline');
    await m.presencas.gravar(m.carla.id, 'offline');
    e = (await m.cob.equipeAgora(c))!;
    expect(e.disponiveis).toBe(0);
    expect(e.texto).toContain('Equipe agora: 0 pessoas disponíveis');
    expect(e.responsavelDisponivel).toBe(false);
  });
});

describe('A IA usa a informação da equipe', () => {
  const conversa: Conversa = { id: 'c1', empresaId: 'imperio', unidade: 'norte', canalId: 'imperio-norte', telefone: '5571', nome: 'Marina', modo: 'ia', etapa: 'em_conversa', etiquetas: [], criadaEm: quinta(9), atualizadaEm: quinta(9) };
  const recebidos: Array<Record<string, unknown>> = [];
  const claude = { beta: { messages: { create: (async (p: Record<string, unknown>) => (recebidos.push(p), { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Oi!' }] })) as never } } } as ClienteClaude;
  const agente = new Agente(claude, {} as never, 'BASE', { modelo: 'm', esforco: 'low' });

  it('a contagem vai no contexto de cada resposta e a regra está no system', async () => {
    await agente.executar({ conversa, agora: quinta(14), modo: 'responder', mensagens: [{ id: '1', conversaId: 'c1', autor: 'cliente', texto: 'oi', em: quinta(14) }], equipe: { texto: 'Equipe agora: 0 pessoas disponíveis para atender.', disponiveis: 0, responsavelDisponivel: null } });
    expect(JSON.stringify(recebidos[0]!.messages)).toContain('<equipe>');
    expect(JSON.stringify(recebidos[0]!.messages)).toContain('0 pessoas disponíveis');
    expect(JSON.stringify(recebidos[0]!.system)).toContain('Ninguém disponível');
  });

  it('ninguém disponível: a passagem não promete "já já"', async () => {
    const r = await agente.executar({ conversa, agora: quinta(14), modo: 'responder', mensagens: [{ id: '1', conversaId: 'c1', autor: 'cliente', texto: 'quero falar com uma atendente', em: quinta(14) }], equipe: { texto: 'x', disponiveis: 0, responsavelDisponivel: null } });
    expect(r.texto).toBe(TEXTO_PASSAGEM_DEPOIS);
    expect(r.texto).not.toContain('Já já');
  });
});

describe('Rota PUT /api/presenca chama a cobertura só quando o status muda', () => {
  it('offline → cobre; offline de novo → nada; online → devolve', async () => {
    const presencas = new PresencasMemoria();
    const chamadas: string[] = [];
    const app = Fastify();
    const eu = { id: 'u1', empresaId: 'imperio', nome: 'Carla', email: 'c@x.com', papel: 'atendente', unidades: ['norte'], ativo: true } as Usuario;
    app.addHook('onRequest', async (req) => void Object.assign(req, { usuario: eu }));
    registrarPresenca(app, { presencas, aoMudar: async (_u, s) => (chamadas.push(s), s === 'offline' ? { cobertas: 3 } : { devolvidas: 3 }) });
    const put = (status: string) => app.inject({ method: 'PUT', url: '/api/presenca', payload: { status } });
    expect((await put('offline')).json()).toEqual({ ok: true, status: 'offline', cobertas: 3 });
    await put('offline');
    expect((await put('online')).json()).toMatchObject({ devolvidas: 3 });
    expect(chamadas).toEqual(['offline', 'online']);
    await app.close();
  });
});

export type _M = MensagemRecebida;
