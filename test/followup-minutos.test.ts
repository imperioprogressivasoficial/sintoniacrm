import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp } from '../src/channels/tipos.js';
import { ArmazemFollowupMemoria, ArmazemFollowupPostgres, type ArmazemFollowup } from '../src/followup/armazem.js';
import { ehGrupo, Followup } from '../src/followup/followup.js';
import { registrarFollowup } from '../src/followup/rotas.js';
import { configPadrao, ConfigFollowup, ehToqueCurto, esperaMs, normalizarConfig, SUGESTAO_SEM_RESPOSTA } from '../src/followup/tipos.js';
import { observarEventos } from '../src/notificacoes/notificador.js';
import { RepositorioPostgres } from '../src/store/postgres.js';
import { RepositorioMemoria, type Repositorio } from '../src/store/repositorio.js';
import { bahia, DIA, HORA, MIN } from '../src/util/tempo.js';
import { poolDeTeste, temPostgres } from './repos.js';

/*
 * followup-minutos (pedido do dono, 28/11): "Não respondeu" em minutos (5 min, 15 min, depois mais espaçado), editável
 * na tela de Follow-up, com as regras de segurança: só quando a última mensagem é da loja, para quando ela responde,
 * nada em conversa com horário marcado, nem com a equipe escrevendo; toque de minutos só com a conversa quente.
 */

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  linha: string[] = [];
  enviados: Array<{ telefone: string; texto: string }> = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, texto: string) {
    this.enviados.push({ telefone, texto });
    this.linha.push(`texto:${texto}`);
    return { idExterno: `out-${Math.random()}` };
  }
  async enviarPresenca(_c: string, _t: string, tipo: string, ms: number) {
    this.linha.push(`presenca:${tipo}:${ms}`);
  }
}

class AgenteFalso {
  pedidos: PedidoAgente[] = [];
  async executar(p: PedidoAgente): Promise<RespostaAgente> {
    this.pedidos.push(p);
    return { texto: p.objetivo ? 'Oi, Marina! Ainda quer aquela progressiva na Norte? Posso reservar para você.' : 'Oi! Posso ajudar?', acoes: [], recusou: false };
  }
}

/** Quinta-feira, 5/11/2026, 14h (Bahia): loja aberta (10h–22h). */
const QUINTA = bahia(2026, 11, 5, 14, 0);

interface Ambiente {
  nome: string;
  criar(): Promise<{ repo: Repositorio; armazem: ArmazemFollowup }>;
}

const ambientes: Ambiente[] = [
  { nome: 'memória', criar: async () => ({ repo: new RepositorioMemoria(), armazem: new ArmazemFollowupMemoria() }) },
  ...(temPostgres
    ? [
        {
          nome: 'postgres',
          criar: async () => {
            const pool = await poolDeTeste();
            await pool.query('truncate sintonia.followup_envios, sintonia.followup_config, sintonia.agenda_confirmacoes, sintonia.followup_pausas restart identity cascade');
            return { repo: new RepositorioPostgres(pool), armazem: new ArmazemFollowupPostgres(pool) };
          },
        },
      ]
    : []),
];

async function montar(a: Ambiente, ajustar?: (cfg: ConfigFollowup) => void) {
  const base = await a.criar();
  const relogio = { t: QUINTA };
  const agora = () => relogio.t;
  const canal = new CanalFalso();
  const agente = new AgenteFalso();
  const esperas: number[] = [];
  let sintonia!: Sintonia;
  const f = new Followup({
    empresaId: 'imperio',
    armazem: base.armazem,
    repo: base.repo,
    sintonia: () => sintonia,
    agente,
    iaDisponivel: () => true,
    agora,
    pausaDigitando: (texto) => 1000 + texto.length * 10,
    esperar: async (ms) => void esperas.push(ms),
  });
  observarEventos(base.repo, (e) => f.aoEvento(e));
  sintonia = new Sintonia({
    empresaId: 'imperio',
    repo: base.repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente,
    agora,
    motor: (c) => f.motor(c),
    configIa: async () => ({ modoPadrao: 'ia' }),
    ganchos: { mensagemCliente: (c, m) => f.mensagemCliente(c, m) },
  });
  const cfg = configPadrao();
  const cad = cfg.cadencias.find((c) => c.id === 'sem_resposta')!;
  cad.ligada = true;
  cad.passos = structuredClone(SUGESTAO_SEM_RESPOSTA);
  ajustar?.(cfg);
  await f.salvarConfig(cfg, 'teste');
  let seq = 0;
  const cliente = async (texto: string) => {
    await sintonia.receber({ canalId: 'imperio-norte', telefone: '5571988124471', nome: 'Marina Souza', texto, deMim: false, idExterno: `in-${++seq}-${relogio.t.getTime()}`, em: relogio.t });
    await f.ocioso();
  };
  const ir = async (t: Date) => {
    relogio.t = t;
    await sintonia.tick();
    await f.ocioso();
    const r = await f.tick();
    await f.ocioso();
    return r.enviados;
  };
  const conversa = async () => (await base.repo.listarConversas())[0]!;
  const textos = () => canal.enviados.map((x) => x.texto);
  return { ...base, f, sintonia, relogio, canal, agente, esperas, cliente, ir, conversa, textos };
}

const em = (min: number) => new Date(QUINTA.getTime() + min * MIN);

describe('followup-minutos: tempos e compatibilidade', () => {
  it('espera em minutos (mínimo 1), horas ou dias; aceita esperaMinutos; configuração antiga (esperaHoras) continua igual', () => {
    const cfg = normalizarConfig({
      cadencias: [
        {
          id: 'sem_resposta',
          ligada: true,
          passos: [
            { esperaMinutos: 5, texto: 'Oi, ainda está aí?' },
            { esperaHoras: 0.25, texto: 'antiga: 15 min' },
            { esperaHoras: 24, texto: 'antiga: 1 dia' },
            { esperaHoras: 1 / 60, unidade: 'min', texto: '1 minuto' },
          ],
        },
      ],
    });
    const p = cfg.cadencias.find((c) => c.id === 'sem_resposta')!.passos;
    expect(p.map(esperaMs)).toEqual([5 * MIN, 15 * MIN, DIA, MIN]);
    expect(p[0]).toMatchObject({ unidade: 'min', texto: 'Oi, ainda está aí?', ia: false });
    expect(p[1]!.unidade).toBeUndefined(); // a tela escolhe pela conta
    expect(p.map(ehToqueCurto)).toEqual([true, true, false, true]);
    expect(() => ConfigFollowup.parse({ ...configPadrao(), cadencias: [{ id: 'sem_resposta', passos: [{ esperaHoras: 0.5 / 60, texto: 'x' }] }] })).toThrow();
    // As outras cadências também aceitam minutos.
    const outra = normalizarConfig({ cadencias: [{ id: 'orcamento', passos: [{ esperaMinutos: 30, texto: 'x' }] }] });
    expect(esperaMs(outra.cadencias.find((c) => c.id === 'orcamento')!.passos[0]!)).toBe(30 * MIN);
  });

  it('empresa nova: "Não respondeu" nasce vazia e desligada; o modelo sugerido só vem pela rota (5 min, 15 min, 1 dia, 3 dias)', async () => {
    expect(configPadrao().cadencias.find((c) => c.id === 'sem_resposta')).toMatchObject({ ligada: false, passos: [] });
    const app = Fastify();
    const f = new Followup({ empresaId: 'nova', armazem: new ArmazemFollowupMemoria(), repo: new RepositorioMemoria(), sintonia: () => ({}) as never });
    registrarFollowup(app, { followup: f, repo: new RepositorioMemoria() });
    const r = await app.inject({ method: 'GET', url: '/api/followup/sugerido/sem_resposta' });
    expect(r.statusCode).toBe(200);
    const passos = (r.json() as { passos: Array<{ esperaHoras: number; texto: string; ia: boolean }> }).passos;
    expect(passos.map((x) => Math.round(x.esperaHoras * 60))).toEqual([5, 15, 1440, 2880]);
    expect(passos[0]!.texto).toBe('Oi, ainda está por aí?');
    expect(passos[2]!.ia).toBe(true);
    // Sem emoji de rosto.
    for (const x of passos) expect(x.texto).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
    expect((await app.inject({ method: 'GET', url: '/api/followup/sugerido/orcamento' })).statusCode).toBe(404);
    const c = await app.inject({ method: 'GET', url: '/api/followup/config' });
    expect(c.json()).toMatchObject({ enviadasHoje: {} });
    expect((c.json() as { config: { cadencias: Array<{ passos: unknown[] }> } }).config.cadencias.every((x) => x.passos.length === 0)).toBe(true);
    await app.close();
  });

  it('conversa de grupo nunca recebe follow-up', () => {
    expect(ehGrupo({ telefone: '5571988124471' })).toBe(false);
    expect(ehGrupo({ telefone: '120363025246125486' })).toBe(true);
    expect(ehGrupo({ telefone: '5571988124471-1612345678' })).toBe(true);
  });
});

for (const a of ambientes) {
  describe(`followup-minutos (${a.nome})`, () => {
    it('5 min, 15 min, 1 dia (IA) e 3 dias; "digitando…" antes de cada uma; conta "enviadas hoje"', async () => {
      const m = await montar(a);
      await m.cliente('Oi, queria saber da progressiva');
      expect(m.textos()).toEqual(['Oi! Posso ajudar?']);
      expect(await m.ir(em(4))).toBe(0);
      expect(await m.ir(em(5))).toBe(1);
      expect(m.textos().at(-1)).toBe('Oi, ainda está por aí?');
      // "digitando…" antes da mensagem, pelo tempo de escrever (pausaDigitando).
      const i = m.canal.linha.indexOf('texto:Oi, ainda está por aí?');
      expect(m.canal.linha[i - 1]).toMatch(/^presenca:digitando:\d+$/);
      expect(m.esperas.at(-1)).toBe(1000 + 'Oi, ainda está por aí?'.length * 10);
      expect(await m.ir(em(19))).toBe(0);
      expect(await m.ir(em(20))).toBe(1);
      expect(m.textos().at(-1)).toBe('Consegui te ajudar? Se quiser, já deixo seu horário separado.');
      expect(await m.f.enviadasHoje()).toEqual({ sem_resposta: 2 });
      expect(await m.ir(new Date(em(20).getTime() + DIA - MIN))).toBe(0);
      expect(await m.ir(new Date(em(20).getTime() + DIA))).toBe(1);
      expect(m.textos().at(-1)).toContain('Ainda quer aquela progressiva'); // a IA escreveu com o objetivo
      expect(m.agente.pedidos.at(-1)!.objetivo).toContain('Retomar a conversa de ontem');
      expect(await m.ir(new Date(em(20).getTime() + 3 * DIA))).toBe(1);
      expect(m.textos().at(-1)).toContain('Vou deixar nossa conversa guardada');
      expect(m.textos()).toHaveLength(5);
      expect(await m.ir(new Date(em(20).getTime() + 6 * DIA))).toBe(0); // acabou
    });

    it('para assim que ela responde; o toque de 5 min não se repete no mesmo dia', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      expect(await m.ir(em(5))).toBe(1);
      m.relogio.t = em(7);
      await m.cliente('Tô sim! Qual o valor?'); // a IA responde e a cadência recomeça
      const c = await m.conversa();
      expect((await m.f.seloDaConversa(c.id)).historico.some((h) => h.estado === 'cancelado' && h.detalhe === 'a cliente respondeu')).toBe(true);
      const antes = m.textos().length;
      // 5 min depois da resposta da IA: o "ainda está aí?" já saiu hoje; pula para o de 15 min.
      expect(await m.ir(em(12))).toBe(0);
      expect(m.textos()).toHaveLength(antes);
      expect(await m.ir(em(27))).toBe(1);
      expect(m.textos().at(-1)).toBe('Consegui te ajudar? Se quiser, já deixo seu horário separado.');
      // Ela responde de novo: nada mais sai enquanto a última palavra é dela.
      m.relogio.t = em(28);
      await m.cliente('Vou ver e te falo');
      expect(m.textos().filter((t) => t === 'Oi, ainda está por aí?')).toHaveLength(1);
    });

    it('só sai quando a última mensagem é da loja: a cliente escreveu por último, nada sai', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      const c = await m.conversa();
      // A cliente manda outra mensagem que ainda não foi respondida (a IA ainda vai responder).
      c.ultimaMensagemCliente = em(2);
      await m.repo.salvarConversa(c);
      expect(await m.ir(em(5))).toBe(0);
      expect((await m.f.seloDaConversa(c.id)).historico[0]).toMatchObject({ estado: 'cancelado', detalhe: 'a cliente respondeu' });
    });

    it('não sai em conversa com horário marcado pela frente', async () => {
      const m = await montar(a);
      await m.cliente('Quero agendar');
      const c = await m.conversa();
      await m.sintonia.equipeAgendou(c.id, { tipo: 'agendou', clienteTrinksId: 9, agendamento: { trinksId: 77, unidade: 'norte', servico: 'Progressiva', profissional: 'Ana', inicio: bahia(2026, 11, 9, 15, 0), duracaoMin: 120 } }, 'Carla');
      await m.f.ocioso();
      // Alguém mexe na etapa (o cartão saiu de "Agendada"), mas o horário continua marcado.
      const d = await m.conversa();
      d.etapa = 'interessada';
      d.modo = 'ia';
      await m.repo.salvarConversa(d);
      m.relogio.t = em(30);
      await m.cliente('Obrigada!');
      const antes = m.textos().length;
      expect(await m.ir(em(36))).toBe(0);
      expect(await m.ir(em(60))).toBe(0);
      expect(m.textos()).toHaveLength(antes);
      expect(m.textos()).not.toContain('Oi, ainda está por aí?');
    });

    it('com alguém da equipe escrevendo, espera; depois sai', async () => {
      const m = await montar(a);
      await m.cliente('Oi');
      const c = await m.conversa();
      m.relogio.t = em(4);
      await m.sintonia.equipeDigitando(c.id, { id: '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f', nome: 'Carla' });
      expect(await m.ir(em(5))).toBe(0);
      const selo = await m.f.seloDaConversa(c.id);
      expect(selo.cadencia).toMatchObject({ passo: 1 }); // continua na fila, mais tarde
      expect(selo.historico.some((h) => h.estado === 'cancelado')).toBe(false);
      expect(await m.ir(em(60))).toBe(1);
      expect(m.textos().at(-1)).toBe('Oi, ainda está por aí?');
    });

    it('loja fechou: o toque de minutos espera abrir e, com a conversa fria, fica para o de 1 dia', async () => {
      const m = await montar(a);
      m.relogio.t = bahia(2026, 11, 5, 21, 58);
      await m.cliente('Oi');
      expect(await m.ir(bahia(2026, 11, 5, 22, 4))).toBe(0); // fechada (22h)
      expect(await m.ir(bahia(2026, 11, 6, 10, 0))).toBe(0); // abriu, mas a conversa é de ontem: pula o de 5 min
      expect(await m.ir(bahia(2026, 11, 6, 10, 15))).toBe(0); // e o de 15 min
      expect(m.textos()).toEqual(['Oi! Posso ajudar?']);
      expect(await m.ir(bahia(2026, 11, 7, 10, 16))).toBe(1); // o de 1 dia sai
      expect(m.textos().at(-1)).toContain('Ainda quer aquela progressiva');
      const c = await m.conversa();
      expect((await m.f.seloDaConversa(c.id)).historico.filter((h) => h.detalhe?.includes('esfriou'))).toHaveLength(2);
    });

    it('respeita o limite por semana', async () => {
      const m = await montar(a, (cfg) => {
        cfg.limiteSemana = 1;
      });
      await m.cliente('Oi');
      expect(await m.ir(em(5))).toBe(1);
      expect(await m.ir(em(20))).toBe(0);
      const c = await m.conversa();
      expect((await m.f.seloDaConversa(c.id)).historico[0]).toMatchObject({ estado: 'pulado', detalhe: 'limite de mensagens por cliente' });
    });

    it('desligada na tela: nada sai', async () => {
      const m = await montar(a, (cfg) => {
        cfg.cadencias.find((c) => c.id === 'sem_resposta')!.ligada = false;
      });
      await m.cliente('Oi');
      expect(await m.ir(em(5))).toBe(0);
      expect(await m.ir(em(60 * 30))).toBe(0);
    });
  });
}

// ------------------------------------------------------------------------------------------------ migração 780
const MIGRACAO = readFileSync(new URL('../db/migrations/780_followup_minutos.sql', import.meta.url), 'utf8');

describe.runIf(temPostgres)('followup-minutos: migração 780 (Postgres)', () => {
  const rodar = async (pool: import('pg').Pool) => {
    const cli = await pool.connect();
    try {
      await cli.query('begin');
      await cli.query(MIGRACAO);
      await cli.query('commit');
    } catch (e) {
      await cli.query('rollback');
      throw e;
    } finally {
      cli.release();
    }
  };
  const ler = async (pool: import('pg').Pool, empresa: string) => (await pool.query('select config from sintonia.followup_config where empresa_id = $1', [empresa])).rows[0]?.config;

  it('Império sem configuração: nasce com "Não respondeu" ligada, igual ao modelo sugerido; o resto do padrão', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.followup_config');
    await pool.query("insert into sintonia.empresas (id, nome) values ('imperio', 'Império') on conflict do nothing");
    await rodar(pool);
    await rodar(pool);
    const cfg = normalizarConfig(await ler(pool, 'imperio'));
    const cad = cfg.cadencias.find((c) => c.id === 'sem_resposta')!;
    expect(cad).toMatchObject({ ligada: true, pararSeResponder: true });
    expect(cad.passos).toEqual(SUGESTAO_SEM_RESPOSTA); // migração e modelo da tela continuam iguais
    expect(cfg.cadencias.filter((c) => c.id !== 'sem_resposta').every((c) => !c.ligada && c.passos.length === 0)).toBe(true);
    expect(cfg.confirmacao.ligada).toBe(true);
    expect(await ler(pool, 'outra')).toBeUndefined(); // só a Império
  });

  it('Império com a cadência vazia: preenche e liga, sem mexer no resto; escrita por alguém: fica como está', async () => {
    const pool = await poolDeTeste();
    await pool.query('truncate sintonia.followup_config');
    const vazia = configPadrao();
    vazia.limiteSemana = 7;
    vazia.cadencias.find((c) => c.id === 'pos_atendimento')!.passos = [{ esperaHoras: 24, texto: 'Como ficou?', ia: false, objetivo: '', email: false, emailModeloId: null }];
    await pool.query("insert into sintonia.followup_config (empresa_id, config) values ('imperio', $1)", [JSON.stringify(vazia)]);
    const escrita = configPadrao();
    escrita.cadencias[0]!.passos = [{ esperaHoras: 2, texto: 'Meu texto', ia: false, objetivo: '', email: false, emailModeloId: null }];
    await pool.query("insert into sintonia.followup_config (empresa_id, config) values ('outra', $1)", [JSON.stringify(escrita)]);
    await rodar(pool);
    await rodar(pool);
    const cfg = normalizarConfig(await ler(pool, 'imperio'));
    expect(cfg.cadencias.find((c) => c.id === 'sem_resposta')).toMatchObject({ ligada: true, passos: [{ texto: 'Oi, ainda está por aí?' }, {}, { ia: true }, {}] });
    expect(cfg.limiteSemana).toBe(7);
    expect(cfg.cadencias.find((c) => c.id === 'pos_atendimento')!.passos[0]!.texto).toBe('Como ficou?');
    expect((await ler(pool, 'imperio')).cadencias.map((c: { id: string }) => c.id)).toEqual(['sem_resposta', 'preco_sem_agendar', 'faltou', 'pos_atendimento', 'orcamento']);

    // A Império escreveu a dela depois: a migração rodando de novo não troca.
    const minha = structuredClone(cfg);
    minha.cadencias.find((c) => c.id === 'sem_resposta')!.passos = [{ esperaHoras: 10 / 60, unidade: 'min', texto: 'Oi! Ainda por aí?', ia: false, objetivo: '', email: false, emailModeloId: null }];
    await pool.query("update sintonia.followup_config set config = $1 where empresa_id = 'imperio'", [JSON.stringify(minha)]);
    await rodar(pool);
    expect(normalizarConfig(await ler(pool, 'imperio')).cadencias.find((c) => c.id === 'sem_resposta')!.passos).toMatchObject([{ texto: 'Oi! Ainda por aí?', unidade: 'min' }]);
    expect(normalizarConfig(await ler(pool, 'outra')).cadencias[0]!.passos).toMatchObject([{ texto: 'Meu texto' }]);
  });
});
