import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import { ContasMemoria, ContasPostgres, type Contas, type Usuario } from '../src/auth/contas.js';
import { gerarHash } from '../src/auth/senha.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { ArmazemNotificacoesMemoria, ArmazemNotificacoesPostgres, type ArmazemNotificacoes } from '../src/notificacoes/armazem.js';
import { Notificador, observarEventos } from '../src/notificacoes/notificador.js';
import { ArmazemRadarMemoria, ArmazemRadarPostgres, type ArmazemRadar } from '../src/radar/armazem.js';
import { juizClaude, juizSemIa, type PedidoJuiz } from '../src/radar/juiz.js';
import { Radar } from '../src/radar/radar.js';
import { registrarRadar } from '../src/radar/rotas.js';
import type { Veredito } from '../src/radar/tipos.js';
import { criarServidor } from '../src/server.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia, HORA, MIN } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

const SENHA = 'Imperio2026xyz';
const hashPadrao = gerarHash(SENHA);
/** Quinta-feira, 5/11/2026, 14h (Bahia). */
const QUINTA = bahia(2026, 11, 5, 14, 0);

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: string[] = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, _t: string, texto: string) {
    this.enviados.push(texto);
    return { idExterno: `out-${Math.random()}` };
  }
}

/** IA falsa: responde "Resposta normal"; com objetivo do radar, "Resposta do radar". */
class AgenteFalso {
  pedidos: PedidoAgente[] = [];
  async executar(p: PedidoAgente): Promise<RespostaAgente> {
    this.pedidos.push(p);
    return { texto: p.objetivo?.includes('radar') ? 'Resposta do radar' : 'Resposta normal', acoes: [], recusou: false };
  }
}

/** Juiz falso: "aconteceu" quando a mensagem fala de salário. */
class JuizFalso {
  pedidos: PedidoJuiz[] = [];
  async julgar(p: PedidoJuiz): Promise<Veredito> {
    this.pedidos.push(p);
    if (/sal[aá]rio/i.test(p.novas)) return { situacao: 'aconteceu', motivo: 'Ela disse que o salário caiu.' };
    return { situacao: 'ainda_nao', motivo: '' };
  }
}

interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; contas: Contas; notifs: ArmazemNotificacoes; armazem: ArmazemRadar }>;
}
const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), contas: new ContasMemoria(), notifs: new ArmazemNotificacoesMemoria(), armazem: new ArmazemRadarMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.radar_conversas, sintonia.radar_historico restart identity');
            return { repo: new RepositorioPostgres(pool), contas: new ContasPostgres(pool), notifs: new ArmazemNotificacoesPostgres(pool), armazem: new ArmazemRadarPostgres(pool) };
          },
        },
      ]
    : []),
];

async function montar(a: Ambiente, opcoes: { ia?: boolean } = {}) {
  const { repo, contas, notifs, armazem } = await a.criar();
  const relogio = { t: QUINTA };
  const agora = () => relogio.t;
  const canal = new CanalFalso();
  const agente = new AgenteFalso();
  const juiz = new JuizFalso();
  const ia = { ligada: opcoes.ia ?? true };
  const notificador = new Notificador({ armazem: notifs, contas, repo, empresaId: 'imperio', agora });
  observarEventos(repo, (e) => notificador.aoEvento(e));
  let sintonia!: Sintonia;
  const radar = new Radar({ empresaId: 'imperio', armazem, repo, sintonia: () => sintonia, agente, juiz: (p) => juiz.julgar(p), iaDisponivel: () => ia.ligada, agora });
  observarEventos(repo, (e) => radar.aoEvento(e));
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente,
    agora,
    configIa: async () => ({ modoPadrao: 'ia' }),
    ganchos: { mensagemCliente: (c, m) => radar.mensagemCliente(c, m), objetivoIa: (c) => radar.objetivo(c) },
  });
  const app = criarServidor({ sintonia, repo, agora, auth: { contas, agora } });
  registrarRadar(app, { radar, repo, iaLigada: () => ia.ligada });
  const h = await hashPadrao;
  const pessoa = (nome: string, papel: 'admin' | 'atendente', unidades: string[]) =>
    contas.criarUsuario({ empresaId: 'imperio', nome, email: `${nome.split(' ')[0]!.toLowerCase()}@imperio.com`, papel, unidades, senhaHash: h });
  const gente = { admin: await pessoa('Bruno Batista', 'admin', []), carla: await pessoa('Carla Lima', 'atendente', ['norte']) };
  const cookies = new Map<string, string>();
  const como = async (u: Usuario, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => {
    let c = cookies.get(u.id);
    if (!c) cookies.set(u.id, (c = `sintonia_sessao=${await contas.criarSessao(u.id, new Date(relogio.t.getTime() + 30 * 24 * HORA))}`));
    return app.inject({ method, url, headers: { cookie: c }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  };
  let seq = 0;
  const cliente = async (texto: string) => {
    relogio.t = new Date(relogio.t.getTime() + 1000);
    await sintonia.receber({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina Souza', texto, deMim: false, idExterno: `in-${++seq}`, em: relogio.t });
    await radar.ocioso();
    await notificador.ocioso();
  };
  const conversa = async () => (await repo.listarConversas())[0]!;
  const ir = async (t: Date) => {
    relogio.t = t;
    const r = await radar.tick();
    await radar.ocioso();
    await notificador.ocioso();
    return r;
  };
  const avisos = async (u: Usuario) => (await notifs.listar(u.id, relogio.t, 50)).filter((n) => n.tipo === 'radar');
  return { repo, relogio, canal, agente, juiz, ia, radar, app, gente, como, cliente, conversa, ir, avisos, sintonia };
}

describe('radar: juiz sem IA', () => {
  const p = (vigiar: string, novas: string) => juizSemIa({ vigiar, novas, mensagens: [], agora: QUINTA });
  it('dispara quando uma palavra importante aparece', async () => {
    expect((await p('se ela falar que recebeu o salário', 'Oi! O salário caiu hoje')).situacao).toBe('aconteceu');
    expect((await p('quando pedir desconto', 'Tem algum descontinho?')).situacao).toBe('aconteceu');
    expect((await p('quando pedir desconto', 'Qual o endereço?')).situacao).toBe('ainda_nao');
  });
  it('"se não responder" deixa de valer quando ela escreve', async () => {
    expect((await p('se não responder até sexta', 'oi, tô aqui')).situacao).toBe('nao_precisa_mais');
  });
});

describe('radar: juiz com Claude (cliente falso)', () => {
  it('manda o que vigiar e a mensagem nova, e lê a resposta estruturada', async () => {
    const chamadas: Array<{ messages: Array<{ content: string }> }> = [];
    const claude = {
      beta: {
        messages: {
          parse: async (req: unknown) => {
            chamadas.push(req as { messages: Array<{ content: string }> });
            return { stop_reason: 'end_turn', parsed_output: { situacao: 'aconteceu', motivo: 'Ela disse que recebeu.' } };
          },
        },
      },
    } as unknown as Parameters<typeof juizClaude>[0];
    const v = await juizClaude(claude, { modelo: 'modelo-teste' })({ vigiar: 'se receber o salário', novas: 'recebi!', mensagens: [], agora: QUINTA });
    expect(v).toEqual({ situacao: 'aconteceu', motivo: 'Ela disse que recebeu.' });
    expect(chamadas[0]!.messages[0]!.content).toContain('se receber o salário');
    expect(chamadas[0]!.messages[0]!.content).toContain('recebi!');
  });
});

for (const a of ambientes) {
  describe(`radar (${a.nome})`, () => {
    it('só entra quem a equipe coloca; dispara na mensagem certa, avisa a dona do radar e conta como não visto', async () => {
      const m = await montar(a);
      await m.cliente('Oi, queria a progressiva');
      const c = await m.conversa();
      expect((await (await m.como(m.gente.carla, 'GET', '/api/radar')).json()).itens).toEqual([]);

      const put = await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: 'se ela falar que recebeu o salário', acao: 'avisar' });
      expect(put.statusCode).toBe(200);
      expect(put.json().item).toMatchObject({ estado: 'vigiando', vigiar: 'se ela falar que recebeu o salário', meu: true, donoNome: 'Carla Lima' });

      await m.cliente('Qual o endereço?');
      expect(m.juiz.pedidos).toHaveLength(1);
      expect((await m.radar.daConversa(c.id)).item?.estado).toBe('vigiando');

      await m.cliente('Oba, o salário caiu! Quero marcar');
      const d = (await (await m.como(m.gente.carla, 'GET', `/api/radar/conversa/${c.id}`)).json()) as { item: Record<string, unknown>; historico: Array<{ tipo: string; texto: string }> };
      expect(d.item).toMatchObject({ estado: 'disparou', motivo: 'Ela disse que o salário caiu.', visto: false });
      expect(d.historico.map((h) => h.tipo)).toEqual(['disparou', 'entrou']);
      const av = await m.avisos(m.gente.carla);
      expect(av).toHaveLength(1);
      expect(av[0]).toMatchObject({ conversaId: c.id, titulo: 'Radar: aconteceu com Marina Souza' });
      expect(await m.avisos(m.gente.admin)).toHaveLength(0); // só quem colocou

      // Disparou uma vez só: mensagem nova não dispara de novo.
      await m.cliente('salário salário');
      expect(await m.avisos(m.gente.carla)).toHaveLength(1);

      // Outra pessoa abrir não marca como visto; a dona abrir, sim.
      expect((await (await m.como(m.gente.admin, 'POST', `/api/radar/conversa/${c.id}/visto`)).json()).ok).toBe(false);
      expect((await (await m.como(m.gente.carla, 'POST', `/api/radar/conversa/${c.id}/visto`)).json()).ok).toBe(true);
      const lista = (await (await m.como(m.gente.carla, 'GET', '/api/radar')).json()).itens;
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ visto: true, estado: 'disparou' });

      // Vigiar de novo e tirar do radar.
      expect((await (await m.como(m.gente.carla, 'POST', `/api/radar/conversa/${c.id}/de-novo`)).json()).item.estado).toBe('vigiando');
      const del = await m.como(m.gente.carla, 'DELETE', `/api/radar/conversa/${c.id}`);
      expect(del.json().item).toBeNull();
      expect(del.json().historico[0].tipo).toBe('saiu');
      expect((await (await m.como(m.gente.carla, 'GET', '/api/radar')).json()).itens).toEqual([]);
    });

    it('valida a entrada', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      const c = await m.conversa();
      expect((await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: '', acao: 'avisar' })).statusCode).toBe(400);
      expect((await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: 'algo', acao: 'apagar' })).statusCode).toBe(400);
      expect((await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: 'algo', acao: 'avisar', prazo: new Date(QUINTA.getTime() - HORA).toISOString() })).statusCode).toBe(400);
      expect((await m.como(m.gente.carla, 'PUT', '/api/radar/conversa/00000000-0000-0000-0000-000000000000', { vigiar: 'algo', acao: 'avisar' })).statusCode).toBe(404);
    });

    it('"A IA responde" com a IA atendendo: a resposta normal leva a instrução do radar', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      const c = await m.conversa();
      expect(c.modo).toBe('ia');
      await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: 'se receber o salário', acao: 'ia', instrucao: 'Ofereça o horário de sábado.' });
      await m.cliente('Recebi o salário hoje');
      // Uma resposta só, com a instrução.
      expect(m.canal.enviados.at(-1)).toBe('Resposta do radar');
      expect(m.agente.pedidos.at(-1)!.objetivo).toContain('Ofereça o horário de sábado.');
      const d = await m.radar.daConversa(c.id);
      expect(d.item?.resposta).toBe('feita');
      expect(d.historico.map((h) => h.tipo)).toContain('ia_respondeu');
      const antes = m.canal.enviados.length;
      await m.ir(new Date(m.relogio.t.getTime() + 10 * MIN));
      expect(m.canal.enviados.length).toBe(antes); // o relógio não manda em dobro
    });

    it('"A IA responde" com a atendente atendendo: o relógio do radar envia pelo agente', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      const c = await m.conversa();
      await m.sintonia.mudarModo(c.id, 'humano');
      await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: 'se receber o salário', acao: 'ia' });
      const antes = m.canal.enviados.length;
      await m.cliente('salário na conta!');
      expect(m.canal.enviados.length).toBe(antes); // em modo humano a IA da conversa não responde
      const r = await m.ir(new Date(m.relogio.t.getTime() + 30_000));
      expect(r.respostas).toBe(1);
      expect(m.canal.enviados.at(-1)).toBe('Resposta do radar');
      const msgs = await m.repo.mensagens(c.id);
      expect(msgs.at(-1)).toMatchObject({ autor: 'ia', autorNome: 'Radar' });
      expect((await m.radar.daConversa(c.id)).historico[0]!.texto).toMatch(/A IA respondeu/);
    });

    it('IA desligada: só avisa (comparação simples de palavras) e não envia nada', async () => {
      const m = await montar(a, { ia: false });
      await m.cliente('Oi');
      const c = await m.conversa();
      await m.sintonia.mudarModo(c.id, 'humano');
      await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: 'quando pedir desconto', acao: 'ia' });
      const antes = m.canal.enviados.length;
      await m.cliente('tem desconto pra pix?');
      await m.ir(new Date(m.relogio.t.getTime() + 5 * MIN));
      expect(m.juiz.pedidos).toHaveLength(0);
      expect(m.canal.enviados.length).toBe(antes);
      const d = await m.radar.daConversa(c.id);
      expect(d.item).toMatchObject({ estado: 'disparou' });
      expect(d.item?.resposta).toBeUndefined();
      expect(d.historico.map((h) => h.tipo)).toContain('so_avisou');
      expect(await m.avisos(m.gente.carla)).toHaveLength(1);
    });

    it('prazo vencido dispara e, com "A IA responde", manda mensagem ativa', async () => {
      const m = await montar(a);
      await m.cliente('Vou pensar');
      const c = await m.conversa();
      const prazo = new Date(QUINTA.getTime() + 26 * HORA);
      await m.como(m.gente.carla, 'PUT', `/api/radar/conversa/${c.id}`, { vigiar: 'se não responder até sexta', prazo: prazo.toISOString(), acao: 'ia', instrucao: 'Pergunte se ainda tem interesse.' });
      expect((await m.ir(new Date(prazo.getTime() - MIN))).disparados).toBe(0);
      const r = await m.ir(new Date(prazo.getTime() + MIN));
      expect(r).toEqual({ disparados: 1, respostas: 1 });
      expect(m.agente.pedidos.at(-1)!.objetivo).toMatch(/Chegou o prazo.*Pergunte se ainda tem interesse/);
      expect(m.canal.enviados.at(-1)).toBe('Resposta do radar');
      const av = await m.avisos(m.gente.carla);
      expect(av).toHaveLength(1);
      expect(av[0]!.texto).toMatch(/Chegou o prazo/);
      expect((await m.ir(new Date(prazo.getTime() + HORA))).disparados).toBe(0);
    });
  });
}
