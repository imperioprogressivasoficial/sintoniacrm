import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { PedidoAgente, RespostaAgente } from '../src/ai/agente.js';
import { FilaIa } from '../src/app/fila-ia.js';
import { esperaFalhaIa, MAX_FALHAS_IA, Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import { FilaMemoria, type FilaEntrada } from '../src/fila/entrada.js';
import { FilaComReserva } from '../src/fila/reserva.js';
import { criarServidor } from '../src/server.js';
import { criarPool, ehErroDeConexao, esperarBanco } from '../src/store/banco.js';
import { RepositorioMemoria } from '../src/store/repositorio.js';
import { umaPorVez } from '../src/util/relogio.js';
import { bahia, MIN } from '../src/util/tempo.js';
import { fabricas, poolDeTeste, temPostgres } from './repos.js';

/* robustez: testes das correções da auditoria de 20/11 (docs/AUDITORIA-2026-11-20.md, "Correções feitas"). */

class CanalFalso implements CanalWhatsApp {
  readonly tipo = 'evolution' as const;
  enviados: Array<{ telefone: string; texto: string }> = [];
  lerWebhook() {
    return [];
  }
  async enviarTexto(_c: string, telefone: string, texto: string) {
    this.enviados.push({ telefone, texto });
    return { idExterno: `out-${Math.random().toString(36).slice(2)}` };
  }
}

let seq = 0;
const msg = (texto: string, em: Date, extra: Partial<MensagemRecebida> = {}): MensagemRecebida => ({
  canalId: 'imperio-norte',
  telefone: '5571988124471',
  nome: 'Marina',
  texto,
  deMim: false,
  idExterno: `rb-${++seq}-${Math.random().toString(36).slice(2, 7)}`,
  em,
  ...extra,
});
const madrugada = (m = 0) => bahia(2026, 11, 5, 2, m); // a IA responde sozinha
const tarde = (m = 0) => bahia(2026, 11, 5, 14, m); // horário da loja: a IA sugere

function sintoniaCom(repo: RepositorioMemoria | Awaited<ReturnType<(typeof fabricas)[number]['criar']>>, agora: { t: Date }, o: Partial<ConstructorParameters<typeof Sintonia>[0]> & { agente?: { executar(p: PedidoAgente): Promise<RespostaAgente> } } = {}) {
  const canal = new CanalFalso();
  const s = new Sintonia({
    empresaId: 'imperio',
    repo,
    numeros: [{ canalId: 'imperio-norte', unidade: 'norte', canal }],
    agente: o.agente ?? { executar: async () => ({ texto: 'Oi! Posso ajudar?', acoes: [], recusou: false }) },
    agora: () => agora.t,
    ...o,
  });
  return { s, canal };
}

// ---------------------------------------------------------------- 1. banco caiu

describe('Banco caiu ou reiniciou: o app não cai e nada se perde', () => {
  it('reconhece erro de conexão (e não confunde com erro de consulta)', () => {
    expect(ehErroDeConexao(Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' }))).toBe(true);
    expect(ehErroDeConexao(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(ehErroDeConexao(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(ehErroDeConexao(new Error('timeout exceeded when trying to connect'))).toBe(true);
    expect(ehErroDeConexao(Object.assign(new Error('syntax error at or near "selec"'), { code: '42601' }))).toBe(false);
  });

  it('na subida, espera o banco responder (com espera crescente) em vez de cair', async () => {
    let falhas = 3;
    const esperas: number[] = [];
    const pool = { query: async () => { if (falhas-- > 0) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); return { rows: [] }; } } as unknown as pg.Pool;
    await esperarBanco(pool, () => {}, { dormir: async (ms) => void esperas.push(ms) });
    expect(esperas).toEqual([1000, 2000, 4000]);
  });

  it.runIf(temPostgres)('o Postgres derruba as conexões (paradas e em uso): o processo segue e a próxima consulta reconecta', async () => {
    const base = await poolDeTeste();
    const avisos: string[] = [];
    const url = process.env.SINTONIA_TESTE_PG!;
    const pool = criarPool({ url, max: 4, log: (m) => avisos.push(m), nome: 'banco de teste' });
    const emUso = await pool.connect(); // conexão emprestada e parada (como a trava da conversa)
    await pool.query('select 1'); // e uma parada no pool
    const { rows } = await pool.query<{ pid: number }>('select pg_backend_pid() as pid');
    const { rows: meu } = await emUso.query<{ pid: number }>('select pg_backend_pid() as pid');
    // Mata TODAS as conexões deste pool (o que o Postgres faz ao reiniciar): sem os ouvintes, isto derrubava o Node.
    await base.query('select pg_terminate_backend(pid) from pg_stat_activity where pid = any($1)', [[rows[0]!.pid, meu[0]!.pid]]);
    await new Promise((r) => setTimeout(r, 300));
    emUso.release(true);
    expect(avisos.some((a) => a.includes('caiu'))).toBe(true);
    const r = await pool.query<{ ok: number }>('select 1 as ok');
    expect(r.rows[0]!.ok).toBe(1);
    await pool.end();
  });

  it('webhook com o banco fora: guarda no disco, responde 200, e a mensagem entra na fila quando o banco volta (sem duplicar)', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'sintonia-reserva-'));
    const real = new FilaMemoria();
    let fora = true;
    const principal: FilaEntrada = new Proxy(real, {
      get(alvo, prop) {
        if (prop === 'enfileirar') return async (canal: string, ms: MensagemRecebida[]) => {
          if (fora) throw Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });
          return alvo.enfileirar(canal, ms);
        };
        return Reflect.get(alvo, prop);
      },
    });
    const fila = new FilaComReserva(principal, pasta);
    const repo = new RepositorioMemoria();
    const { s } = sintoniaCom(repo, { t: madrugada() });
    const app = criarServidor({ sintonia: s, repo, fila: { fila }, evolution: { canal: { tipo: 'evolution', lerWebhook: () => [msg('oi, tem horário?', madrugada())], enviarTexto: async () => ({ idExterno: 'x' }) } as CanalWhatsApp } });
    const r = await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: { event: 'messages.upsert', instance: 'imperio-norte', data: {} } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ recebidas: 1 });
    expect(await fila.pendentesNaReserva()).toBe(1);
    expect((await real.situacao()).pendentes).toBe(0);
    // Uma segunda cópia do mesmo lote (o WhatsApp reenviou) também vai para a reserva.
    const [m] = (await import('node:fs')).readFileSync(path.join(pasta, 'entrada.jsonl'), 'utf8').trim().split('\n');
    writeFileSync(path.join(pasta, 'entrada.jsonl'), `${m}\n${m}\n`);
    fora = false;
    expect(await fila.descarregar()).toBe(2);
    expect((await real.situacao()).pendentes).toBe(1); // a repetida foi ignorada pelo id do WhatsApp
    const [item] = await real.reivindicar(new Date(), 10);
    expect(item!.mensagem.em).toBeInstanceOf(Date);
    expect(item!.mensagem.texto).toBe('oi, tem horário?');
    expect(readdirSync(pasta)).toEqual([]);
    expect(await fila.pendentesNaReserva()).toBe(0);
  });

  it('descarga interrompida (banco caiu de novo no meio) fica no disco e é retomada', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'sintonia-reserva-'));
    const real = new FilaMemoria();
    let vezes = 0;
    let fora = true;
    const principal = {
      ...Object.fromEntries(['reivindicar', 'concluir', 'falhar', 'situacao', 'falhas', 'reprocessar'].map((k) => [k, (...a: unknown[]) => (real as never as Record<string, (...x: unknown[]) => unknown>)[k]!(...a)])),
      enfileirar: async (canal: string, ms: MensagemRecebida[]) => {
        if (fora || (vezes++ === 1)) throw new Error('Connection terminated unexpectedly');
        return real.enfileirar(canal, ms);
      },
    } as unknown as FilaEntrada;
    const fila = new FilaComReserva(principal, pasta);
    await fila.enfileirar('evolution', [msg('primeira', madrugada())]);
    await fila.enfileirar('evolution', [msg('segunda', madrugada(1))]);
    fora = false;
    await expect(fila.descarregar()).rejects.toThrow();
    expect(await fila.pendentesNaReserva()).toBe(2); // o arquivo da descarga ficou inteiro
    expect(await fila.descarregar()).toBe(2);
    expect((await real.situacao()).pendentes).toBe(2);
  });

  it('se nem o disco aceita, o webhook responde erro (o WhatsApp reenvia)', async () => {
    const pasta = mkdtempSync(path.join(tmpdir(), 'sintonia-reserva-'));
    const fila = new FilaComReserva({ enfileirar: async () => { throw new Error('Connection terminated'); } } as unknown as FilaEntrada, pasta);
    // Pasta virou arquivo: não dá para gravar.
    (await import('node:fs')).rmSync(pasta, { recursive: true });
    writeFileSync(pasta, '');
    const repo = new RepositorioMemoria();
    const { s } = sintoniaCom(repo, { t: madrugada() });
    const app = criarServidor({ sintonia: s, repo, fila: { fila }, evolution: { canal: { tipo: 'evolution', lerWebhook: () => [msg('oi', madrugada())], enviarTexto: async () => ({ idExterno: 'x' }) } as CanalWhatsApp } });
    const r = await app.inject({ method: 'POST', url: '/webhooks/evolution', payload: { event: 'messages.upsert', instance: 'x', data: {} } });
    expect(r.statusCode).toBeGreaterThanOrEqual(500);
    expect(existsSync(path.join(pasta, 'entrada.jsonl'))).toBe(false);
  });
});

// ---------------------------------------------------------------- 2. IA sem chave

describe.each(fabricas)('IA sem chave não é chamada nem reagendada para sempre ($nome)', (f) => {
  it('conversa nova nasce com a equipe e a IA não é chamada (nem de madrugada)', async () => {
    const repo = await f.criar();
    const pedidos: PedidoAgente[] = [];
    const { s, canal } = sintoniaCom(repo, { t: madrugada() }, { iaDisponivel: async () => false, configIa: async () => ({ modoPadrao: 'copiloto' }), agente: { executar: async (p) => (pedidos.push(p), { texto: 'não deveria sair', acoes: [], recusou: false }) } });
    await s.receber(msg('oi, vocês abrem amanhã?', madrugada()));
    const [c] = await repo.listarConversas();
    expect(c!.modo).toBe('humano');
    expect(pedidos).toHaveLength(0);
    expect(canal.enviados).toHaveLength(0);
    expect((await repo.tarefasPendentes(c!.id)).filter((t) => t.tipo === 'reavaliar')).toHaveLength(0);
    // Alguém pôs a conversa em IA (ou ela já estava em Sugestões): ainda assim nada é chamado nem reagendado.
    await s.mudarModo(c!.id, 'ia');
    await s.receber(msg('alô?', madrugada(5)));
    expect(pedidos).toHaveLength(0);
    expect((await repo.tarefasPendentes(c!.id)).filter((t) => t.tipo === 'reavaliar')).toHaveLength(0);
  });

  it('com chave, conversa nova nasce no modo padrão e a IA responde', async () => {
    const repo = await f.criar();
    const { s, canal } = sintoniaCom(repo, { t: madrugada() }, { iaDisponivel: async () => true, configIa: async () => ({ modoPadrao: 'copiloto' }) });
    await s.receber(msg('oi', madrugada()));
    expect(canal.enviados).toHaveLength(1);
  });

  it('IA falhando: tenta de novo com espera crescente e desiste depois do teto (não reagenda para sempre)', async () => {
    const repo = await f.criar();
    const relogio = { t: madrugada() };
    let chamadas = 0;
    const { s, canal } = sintoniaCom(repo, relogio, { agente: { executar: async () => { chamadas++; throw new Error('IA fora do ar'); } } });
    await s.receber(msg('oi', relogio.t));
    const [c] = await repo.listarConversas();
    const esperas: number[] = [];
    for (let i = 0; i < 10; i++) {
      const [t] = (await repo.tarefasPendentes(c!.id)).filter((x) => x.tipo === 'reavaliar');
      if (!t) break;
      esperas.push(Math.round((t.quando.getTime() - relogio.t.getTime()) / MIN));
      relogio.t = new Date(t.quando.getTime() + 1000);
      await s.tick();
    }
    expect(esperas).toEqual([2, 4, 8, 16, 30]);
    expect(chamadas).toBe(MAX_FALHAS_IA + 1);
    expect(canal.enviados).toHaveLength(0);
    expect((await repo.tarefasPendentes(c!.id)).filter((x) => x.tipo === 'reavaliar')).toHaveLength(0);
    // A próxima mensagem da cliente recomeça a contagem.
    await s.receber(msg('alguém?', relogio.t));
    expect(s.falhasDaIa(c!.id)).toBe(1);
  });

  it('chave recusada pela IA (401) não fica tentando de novo', async () => {
    const repo = await f.criar();
    const { s } = sintoniaCom(repo, { t: madrugada() }, { agente: { executar: async () => { throw Object.assign(new Error('invalid x-api-key'), { status: 401 }); } } });
    await s.receber(msg('oi', madrugada()));
    const [c] = await repo.listarConversas();
    expect((await repo.tarefasPendentes(c!.id)).filter((x) => x.tipo === 'reavaliar')).toHaveLength(0);
  });

  it('esperas: 2, 4, 8, 16 e 30 min (teto)', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => esperaFalhaIa(n) / MIN)).toEqual([2, 4, 8, 16, 30, 30]);
  });
});

// ---------------------------------------------------------------- 6. fila da IA

describe.each(fabricas)('Fila da IA: a mensagem aparece na hora, a IA pensa por trás ($nome)', (f) => {
  it('receber volta antes de a IA terminar; a mensagem já está na conversa; a resposta sai depois', async () => {
    const repo = await f.criar();
    let soltar!: () => void;
    const segura = new Promise<void>((r) => (soltar = r));
    let pensando = 0;
    const agente = { executar: async () => { pensando++; await segura; return { texto: 'Temos sim!', acoes: [], recusou: false }; } };
    let sintonia!: Sintonia;
    const filaIa = new FilaIa({ pensar: (id) => sintonia.pensar(id), paralelo: 4 });
    const relogio = { t: madrugada() };
    const { s, canal } = sintoniaCom(repo, relogio, { agente, filaIa });
    sintonia = s;
    const t0 = Date.now();
    await s.receber(msg('tem horário amanhã?', madrugada()));
    expect(Date.now() - t0).toBeLessThan(1000);
    const [c] = await repo.listarConversas();
    expect((await repo.mensagens(c!.id)).map((m) => m.texto)).toEqual(['tem horário amanhã?']);
    // Rede de segurança no banco, caso o processo caia antes de a IA pensar.
    expect((await repo.tarefasPendentes(c!.id)).some((t) => t.tipo === 'reavaliar')).toBe(true);
    // A segunda mensagem da MESMA cliente também aparece na hora (a IA não segura a trava da conversa).
    await s.receber(msg('de manhã de preferência', madrugada(1)));
    expect((await repo.mensagens(c!.id)).map((m) => m.texto)).toEqual(['tem horário amanhã?', 'de manhã de preferência']);
    expect(canal.enviados).toHaveLength(0);
    relogio.t = madrugada(2);
    soltar();
    await filaIa.ocioso();
    // Pensou de novo com as duas mensagens e respondeu uma vez só.
    expect(pensando).toBe(2);
    expect(canal.enviados.map((e) => e.texto)).toEqual(['Temos sim!']);
    // Respondeu: a rede de segurança foi cancelada.
    expect((await repo.tarefasPendentes(c!.id)).some((t) => t.tipo === 'reavaliar')).toBe(false);
  });
});

describe('Fila da IA: limites', () => {
  it('pensa no máximo `paralelo` conversas por vez, cada conversa uma vez por vez, por ordem de chegada', async () => {
    const ativos = new Set<string>();
    let max = 0;
    const ordem: string[] = [];
    const fila = new FilaIa({
      paralelo: 3,
      pensar: async (id) => {
        expect(ativos.has(id)).toBe(false);
        ativos.add(id);
        ordem.push(id);
        max = Math.max(max, ativos.size);
        await new Promise((r) => setTimeout(r, 10));
        ativos.delete(id);
      },
    });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'a', 'a']) fila.pedir(id);
    fila.pedir('b'); // pedido durante a vez de "b": pensa de novo depois
    await fila.ocioso();
    expect(max).toBe(3);
    expect(ordem.slice(0, 5)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ordem.filter((x) => x === 'a')).toHaveLength(2);
    expect(ordem.filter((x) => x === 'b')).toHaveLength(2);
    await fila.executar('z');
    expect(fila.situacao()).toMatchObject({ esperando: 0, pensando: 0 });
  });

  it('com 5 mensagens por segundo e IA de 8 s, a mensagem aparece em menos de 2 s (antes: dezenas de segundos)', async () => {
    const repo = new RepositorioMemoria();
    const agente = { executar: async () => { await new Promise((r) => setTimeout(r, 8000 / 40)); return { texto: 'ok', acoes: [], recusou: false }; } };
    let sintonia!: Sintonia;
    const filaIa = new FilaIa({ pensar: (id) => sintonia.pensar(id), paralelo: 24 });
    const { s } = sintoniaCom(repo, { t: madrugada() }, { agente, filaIa });
    sintonia = s;
    // Tempo comprimido 40x: 5 msg/s → uma a cada 5 ms; IA de 8 s → 200 ms. O que importa é o tempo até gravar.
    const atrasos: number[] = [];
    await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      await new Promise((r) => setTimeout(r, i * 5));
      const t = Date.now();
      await s.receber(msg(`oi ${i}`, madrugada(), { telefone: `55719900000${String(i).padStart(2, '0')}` }));
      atrasos.push((Date.now() - t) * 40);
    }));
    await filaIa.ocioso();
    atrasos.sort((a, b) => a - b);
    expect(atrasos[Math.floor(atrasos.length * 0.95)]!).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------- 8. relógios

describe('Relógios não começam uma rodada por cima da outra', () => {
  it('pula a vez enquanto a anterior roda e volta a rodar depois', async () => {
    let soltar!: () => void;
    let rodadas = 0;
    const r = umaPorVez('teste', async () => { rodadas++; await new Promise<void>((x) => (soltar = x)); });
    const primeira = r();
    expect(await r()).toBe(false);
    expect(await r()).toBe(false);
    expect(r.pulos).toBe(2);
    soltar();
    expect(await primeira).toBe(true);
    const terceira = r();
    soltar();
    expect(await terceira).toBe(true);
    expect(rodadas).toBe(2);
  });

  it('erro numa rodada não trava as próximas', async () => {
    const avisos: string[] = [];
    let n = 0;
    const r = umaPorVez('teste', async () => { if (n++ === 0) throw new Error('falhou'); }, (m) => avisos.push(m));
    expect(await r()).toBe(true);
    expect(await r()).toBe(true);
    expect(avisos[0]).toContain('Falha no relógio');
  });
});
