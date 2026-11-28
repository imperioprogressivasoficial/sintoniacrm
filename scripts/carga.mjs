#!/usr/bin/env node
/**
 * Teste de carga automático da Sintonia (rodar antes de cada publicação grande). Adaptado dos scripts da
 * auditoria de 20–21/11 (carga.mjs, atendentes.mjs, falsos.mjs e medir-aparecer.sh).
 *
 *   node scripts/carga.mjs [--segundos 30] [--ritmo 20] [--atendentes 10] [--clientes 600] [--ia-ms 400]
 *                          [--porta 3790] [--banco postgres://sintonia@127.0.0.1:54329/sintonia_carga_auto]
 *                          [--saida carga-resultado.json] [--manter]
 *
 * O que faz (nada sai para a internet; NUNCA aponte para o banco de produção):
 *  1. apaga e recria o banco de carga (só aceita banco em 127.0.0.1/localhost cujo nome tenha "carga" ou "teste");
 *  2. sobe uma Evolution falsa e uma IA (Anthropic) falsa em portas locais;
 *  3. sobe o app (npx tsx src/index.ts) apontando para elas, com um número de WhatsApp de carga;
 *  4. por `--segundos`, manda `--ritmo` mensagens por segundo no webhook (10% fotos, 2% áudios, 5% repetidas de
 *     propósito) enquanto `--atendentes` pessoas ficam com a lista aberta (lista a cada 4 s + uma conversa aberta);
 *  5. espera a fila esvaziar e confere no banco.
 *
 * Falha (sai com código 1) se:
 *  - alguma mensagem se perdeu (entrou no webhook e não está na conversa) ou o webhook recusou alguma;
 *  - o webhook respondeu devagar: 95% acima de 200 ms;
 *  - alguma mensagem demorou mais de 2 s para aparecer na conversa (da chegada no webhook até gravada);
 *  - a lista de conversas respondeu devagar: 95% acima de 300 ms.
 * Ao final mostra os números e grava o resultado em JSON (`--saida`).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (nome, padrao) => {
  const i = process.argv.indexOf(`--${nome}`);
  if (i < 0) return padrao;
  const v = process.argv[i + 1];
  return typeof padrao === 'number' ? Number(v) : v;
};
const tem = (nome) => process.argv.includes(`--${nome}`);
const O = {
  segundos: arg('segundos', 30),
  ritmo: arg('ritmo', 20),
  atendentes: arg('atendentes', 10),
  clientes: arg('clientes', 600),
  iaMs: arg('ia-ms', 400),
  porta: arg('porta', 3790),
  banco: arg('banco', process.env.CARGA_PG || 'postgres://sintonia@127.0.0.1:54329/sintonia_carga_auto'),
  saida: arg('saida', ''),
};
/** Limites (os mesmos do painel de saúde: src/saude/painel.ts › LIMITES_SAUDE). */
const LIMITES = { webhookP95Ms: 200, aparecerMaxMs: 2000, listaP95Ms: 300 };
const TOKEN = 'tok-carga-' + Math.random().toString(36).slice(2);
const INSTANCIA = 'carga-norte';
const PREFIXO = 'carga' + Date.now().toString(36);
const log = (...a) => console.log('[carga]', ...a);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ banco de carga (recriado do zero)
const alvo = new URL(O.banco);
const nomeBanco = alvo.pathname.replace(/^\//, '');
if (!['127.0.0.1', 'localhost', '::1'].includes(alvo.hostname) || !/carga|teste/i.test(nomeBanco) || !/^[a-z0-9_]+$/i.test(nomeBanco)) {
  console.error(`[carga] Recuso o banco "${O.banco}": use um Postgres local (127.0.0.1) com "carga" ou "teste" no nome. Ele é APAGADO.`);
  process.exit(2);
}
async function recriarBanco() {
  const adm = new URL(O.banco);
  adm.pathname = '/postgres';
  const c = new pg.Client({ connectionString: adm.toString() });
  await c.connect();
  await c.query(`drop database if exists ${nomeBanco} with (force)`);
  await c.query(`create database ${nomeBanco}`);
  await c.end();
}

// ------------------------------------------------------------------ Evolution e IA falsas
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const falsos = { envios: 0, midias: 0, ia: 0, iaMax: 0, iaAtivas: 0 };
const corpo = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
function ouvir(srv) {
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
}
const evolution = http.createServer(async (req, res) => {
  await corpo(req);
  res.setHeader('content-type', 'application/json');
  const u = req.url || '';
  if (u.startsWith('/instance/connectionState')) return res.end(JSON.stringify({ instance: { instanceName: INSTANCIA, state: 'open' } }));
  if (u.startsWith('/instance/fetchInstances')) return res.end(JSON.stringify([{ name: INSTANCIA, connectionStatus: 'open' }]));
  if (u.startsWith('/message/send')) { falsos.envios++; await dormir(80); return res.end(JSON.stringify({ key: { id: 'FALSO' + Math.random().toString(36).slice(2) }, status: 'PENDING' })); }
  if (u.startsWith('/chat/getBase64FromMediaMessage')) { falsos.midias++; await dormir(150); return res.end(JSON.stringify({ base64: PNG1, mimetype: 'image/png' })); }
  if (u.startsWith('/chat/fetchProfilePictureUrl')) return res.end(JSON.stringify({ profilePictureUrl: null }));
  res.end('{}');
});
const ia = http.createServer(async (req, res) => {
  await corpo(req);
  falsos.ia++; falsos.iaAtivas++; falsos.iaMax = Math.max(falsos.iaMax, falsos.iaAtivas);
  await dormir(O.iaMs);
  falsos.iaAtivas--;
  res.setHeader('content-type', 'application/json');
  res.setHeader('request-id', 'req_falso');
  res.end(JSON.stringify({ id: 'msg_falso', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Oi! Resposta do teste de carga.' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }));
});

// ------------------------------------------------------------------ app
let app;
let reserva;
async function subirApp(portaEvo, portaIa) {
  reserva = mkdtempSync(path.join(tmpdir(), 'sintonia-carga-'));
  const env = {
    ...process.env,
    PORT: String(O.porta),
    COOKIE_SEGURO: '0',
    DATABASE_URL: O.banco,
    ADMIN_NOME: 'Carga Teste',
    ADMIN_EMAIL: 'carga@teste.local',
    ADMIN_SENHA: 'CargaTeste2026x',
    ANTHROPIC_API_KEY: 'sk-falsa-carga',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaIa}`,
    EVOLUTION_URL: `http://127.0.0.1:${portaEvo}`,
    EVOLUTION_API_KEY: 'chave-falsa',
    EVOLUTION_WEBHOOK_TOKEN: TOKEN,
    SINTONIA_NUMEROS: JSON.stringify([{ canalId: INSTANCIA, unidade: 'norte', canal: 'evolution' }]),
    SINTONIA_RESERVA_DIR: reserva,
    SINTONIA_SEGREDO: 'segredo-do-teste-de-carga',
  };
  delete env.SINTONIA_COFRE_CHAVE;
  delete env.SINTONIA_COFRE_CHAVE_ARQUIVO;
  const saidaApp = [];
  app = spawn(process.execPath, [path.join(RAIZ, 'node_modules/tsx/dist/cli.mjs'), 'src/index.ts'], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const guardar = (b) => { saidaApp.push(String(b)); if (saidaApp.length > 400) saidaApp.shift(); };
  app.stdout.on('data', guardar);
  app.stderr.on('data', guardar);
  const ate = Date.now() + 120_000;
  while (Date.now() < ate) {
    if (app.exitCode !== null) throw new Error('o app caiu ao subir:\n' + saidaApp.join('').slice(-3000));
    try { const r = await fetch(`http://127.0.0.1:${O.porta}/saude`, { signal: AbortSignal.timeout(2000) }); if (r.ok) return saidaApp; } catch { /* ainda subindo */ }
    await dormir(500);
  }
  throw new Error('o app não subiu em 2 min:\n' + saidaApp.join('').slice(-3000));
}
const BASE = () => `http://127.0.0.1:${O.porta}`;

async function entrar() {
  const r = await fetch(BASE() + '/api/auth/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'carga@teste.local', senha: 'CargaTeste2026x' }) });
  if (!r.ok) throw new Error(`login falhou (${r.status}): ${await r.text()}`);
  return String(r.headers.get('set-cookie') || '').split(';')[0];
}

// ------------------------------------------------------------------ carga no webhook (laço aberto, como a Evolution)
function corpoMsg(i, ids) {
  const tel = '5571' + String(900000000 + ((i * 7919) % O.clientes)).padStart(9, '0');
  const dup = i > 10 && i % 20 === 0; // 5% repetidas (a Evolution às vezes reenvia)
  const id = dup ? ids[i - 5] : `${PREFIXO}-${i}`;
  if (!dup) ids[i] = id;
  const r = i % 50;
  let message;
  if (r < 5) message = { imageMessage: { mimetype: 'image/jpeg', caption: 'foto ' + i, fileLength: 54321 } };
  else if (r === 5) message = { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 7, ptt: true, fileLength: 12000 } };
  else message = { conversation: `Oi, quero saber o preço e o horário (msg ${i})` };
  return { dup, corpo: JSON.stringify({ event: 'messages.upsert', instance: INSTANCIA, data: { key: { remoteJid: tel + '@s.whatsapp.net', fromMe: false, id }, pushName: 'Cliente ' + (i % O.clientes), message, messageTimestamp: Math.floor(Date.now() / 1000) } }) };
}
async function cargaWebhook() {
  const lat = []; const status = {}; const ids = []; let repetidas = 0;
  const total = O.ritmo * O.segundos; const inicio = performance.now(); const pend = [];
  const um = async (i) => {
    const m = corpoMsg(i, ids);
    if (m.dup) repetidas++;
    const t0 = performance.now();
    try {
      const r = await fetch(BASE() + '/webhooks/evolution', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sintonia-token': TOKEN }, body: m.corpo, signal: AbortSignal.timeout(30_000) });
      await r.text();
      status[r.status] = (status[r.status] ?? 0) + 1;
    } catch (e) { status['erro'] = (status['erro'] ?? 0) + 1; }
    lat.push(performance.now() - t0);
  };
  for (let i = 0; i < total; i++) {
    const espera = inicio + (i * 1000) / O.ritmo - performance.now();
    if (espera > 1) await dormir(espera);
    pend.push(um(i));
  }
  await Promise.all(pend);
  return { enviadas: total, repetidas, unicas: total - repetidas, lat, status, duracaoS: (performance.now() - inicio) / 1000 };
}

// ------------------------------------------------------------------ atendentes com a lista aberta
async function atendentes(cookie, conversaId, ate) {
  const lat = []; const st = {};
  const pedir = async (u) => {
    const t = performance.now();
    try { const r = await fetch(BASE() + u, { headers: { cookie }, signal: AbortSignal.timeout(30_000) }); await r.arrayBuffer(); st[r.status] = (st[r.status] ?? 0) + 1; } catch { st.erro = (st.erro ?? 0) + 1; }
    return performance.now() - t;
  };
  await Promise.all(Array.from({ length: O.atendentes }, async () => {
    await dormir(Math.random() * 4000);
    while (Date.now() < ate) {
      const t = Date.now();
      lat.push(await pedir('/api/conversas'));
      if (conversaId) await pedir('/api/conversas/' + conversaId);
      const resto = 4000 - (Date.now() - t);
      if (resto > 0) await dormir(resto);
    }
  }));
  return { lat, st };
}

const quantil = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
const ms = (v) => (v == null ? '—' : `${Math.round(v)} ms`);

// ------------------------------------------------------------------ roteiro
let pool;
async function principal() {
  log(`banco ${nomeBanco} (apagado e recriado) · ${O.segundos} s a ${O.ritmo} msg/s · ${O.atendentes} atendentes · IA falsa de ${O.iaMs} ms`);
  await recriarBanco();
  const [portaEvo, portaIa] = await Promise.all([ouvir(evolution), ouvir(ia)]);
  const t0 = Date.now();
  await subirApp(portaEvo, portaIa);
  log(`app no ar em ${((Date.now() - t0) / 1000).toFixed(1)} s (porta ${O.porta})`);
  pool = new pg.Pool({ connectionString: O.banco, max: 4 });
  const cookie = await entrar();

  // Aquecimento: uma mensagem, espera aparecer (abre a conversa que os atendentes vão olhar).
  const aquece = `${PREFIXO}-aquece`;
  await fetch(BASE() + '/webhooks/evolution', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sintonia-token': TOKEN }, body: JSON.stringify({ event: 'messages.upsert', instance: INSTANCIA, data: { key: { remoteJid: '557199999999@s.whatsapp.net', fromMe: false, id: aquece }, pushName: 'Aquecimento', message: { conversation: 'Oi' }, messageTimestamp: Math.floor(Date.now() / 1000) } }) });
  let conversaId = null;
  for (let i = 0; i < 60 && !conversaId; i++) {
    const { rows } = await pool.query('select conversa_id from sintonia.mensagens where id_externo = $1', [aquece]);
    conversaId = rows[0]?.conversa_id ?? null;
    if (!conversaId) await dormir(250);
  }
  if (!conversaId) throw new Error('a mensagem de aquecimento não apareceu: o webhook ou a fila não estão funcionando');

  const fim = Date.now() + O.segundos * 1000;
  const [w, a] = await Promise.all([cargaWebhook(), atendentes(cookie, conversaId, fim)]);
  log(`carga enviada: ${w.enviadas} mensagens (${w.repetidas} repetidas de propósito) em ${w.duracaoS.toFixed(1)} s`);

  // Espera a fila esvaziar (até 60 s).
  const esperarAte = Date.now() + 60_000;
  let fila;
  while (Date.now() < esperarAte) {
    ({ rows: [fila] } = await pool.query(`select count(*) filter (where status in ('pendente','processando'))::int as abertas, count(*) filter (where status = 'falhou')::int as falhas from sintonia.entrada where id_externo like $1`, [`${PREFIXO}-%`]));
    if (!fila.abertas) break;
    await dormir(500);
  }
  const { rows: [na] } = await pool.query(`select count(distinct id_externo)::int as n from sintonia.mensagens where id_externo like $1 and id_externo <> $2`, [`${PREFIXO}-%`, aquece]);
  const { rows: [ap] } = await pool.query(
    `select percentile_cont(0.5) within group (order by extract(epoch from feita_em - criada_em)) * 1000 as p50,
            percentile_cont(0.95) within group (order by extract(epoch from feita_em - criada_em)) * 1000 as p95,
            max(extract(epoch from feita_em - criada_em)) * 1000 as max, count(*)::int as n
       from sintonia.entrada where id_externo like $1 and id_externo <> $2 and status = 'feita'`,
    [`${PREFIXO}-%`, aquece],
  );
  const saude = await fetch(BASE() + '/api/saude/painel', { headers: { cookie } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  const recusadas = Object.entries(w.status).filter(([k]) => !/^2/.test(k)).reduce((s, [, n]) => s + n, 0);
  const perdidas = Math.max(0, w.unicas - na.n);
  const r = {
    quando: new Date().toISOString(),
    cenario: { segundos: O.segundos, ritmo: O.ritmo, atendentes: O.atendentes, clientes: O.clientes, iaMs: O.iaMs },
    webhook: { enviadas: w.enviadas, unicas: w.unicas, repetidas: w.repetidas, recusadas, status: w.status, p50Ms: quantil(w.lat, 0.5), p95Ms: quantil(w.lat, 0.95), p99Ms: quantil(w.lat, 0.99), maxMs: quantil(w.lat, 1) },
    conversas: { gravadas: na.n, perdidas, filaAberta: fila?.abertas ?? null, filaFalhas: fila?.falhas ?? null },
    aparecer: { n: ap.n, p50Ms: ap.p50 == null ? null : Number(ap.p50), p95Ms: ap.p95 == null ? null : Number(ap.p95), maxMs: ap.max == null ? null : Number(ap.max) },
    lista: { pedidos: a.lat.length, status: a.st, p50Ms: quantil(a.lat, 0.5), p95Ms: quantil(a.lat, 0.95), maxMs: quantil(a.lat, 1) },
    ia: { pedidos: falsos.ia, maxAoMesmoTempo: falsos.iaMax, enviosWhatsApp: falsos.envios, midiasBaixadas: falsos.midias },
    app: saude ? { memoriaMB: Math.round(saude.processo.memoria.rss / 1048576), nivel: saude.nivel, alertas: saude.alertas.map((x) => x.texto) } : null,
    limites: LIMITES,
  };
  const falhas = [];
  if (perdidas) falhas.push(`${perdidas} mensagem(ns) perdida(s): entraram no webhook e não estão na conversa`);
  if (recusadas) falhas.push(`${recusadas} pedido(s) do webhook recusado(s) ou com erro (${JSON.stringify(w.status)})`);
  if (fila?.abertas) falhas.push(`${fila.abertas} mensagem(ns) ainda na fila depois de 60 s`);
  if (fila?.falhas) falhas.push(`${fila.falhas} mensagem(ns) foram para a lista de falhas da fila`);
  if (r.webhook.p95Ms > LIMITES.webhookP95Ms) falhas.push(`webhook lento: 95% em até ${ms(r.webhook.p95Ms)} (limite ${LIMITES.webhookP95Ms} ms)`);
  if (r.aparecer.maxMs == null || r.aparecer.maxMs > LIMITES.aparecerMaxMs) falhas.push(`mensagem demorou ${ms(r.aparecer.maxMs)} para aparecer (limite ${LIMITES.aparecerMaxMs} ms)`);
  if (r.lista.p95Ms == null || r.lista.p95Ms > LIMITES.listaP95Ms) falhas.push(`lista de conversas lenta: 95% em até ${ms(r.lista.p95Ms)} (limite ${LIMITES.listaP95Ms} ms)`);
  const listaErros = Object.entries(a.st).filter(([k]) => !/^(2|304)/.test(k)).reduce((s, [, n]) => s + n, 0);
  if (listaErros) falhas.push(`${listaErros} pedido(s) da lista com erro (${JSON.stringify(a.st)})`);
  r.falhas = falhas;
  r.passou = !falhas.length;

  console.log('');
  console.log('  Resultado do teste de carga');
  console.log(`  Webhook ......... ${w.enviadas} enviadas, ${recusadas} recusadas · p50 ${ms(r.webhook.p50Ms)} · p95 ${ms(r.webhook.p95Ms)} · máx ${ms(r.webhook.maxMs)}`);
  console.log(`  Nas conversas ... ${na.n} de ${w.unicas} únicas · perdidas ${perdidas}`);
  console.log(`  Até aparecer .... p50 ${ms(r.aparecer.p50Ms)} · p95 ${ms(r.aparecer.p95Ms)} · máx ${ms(r.aparecer.maxMs)}`);
  console.log(`  Lista (${O.atendentes} at.) .. ${a.lat.length} pedidos · p50 ${ms(r.lista.p50Ms)} · p95 ${ms(r.lista.p95Ms)} · máx ${ms(r.lista.maxMs)}`);
  console.log(`  IA falsa ........ ${falsos.ia} pedidos (até ${falsos.iaMax} ao mesmo tempo) · ${falsos.envios} respostas enviadas · ${falsos.midias} mídias baixadas`);
  if (r.app) console.log(`  App ............. ${r.app.memoriaMB} MB · saúde: ${r.app.nivel}`);
  console.log(r.passou ? '\n  PASSOU ✓\n' : `\n  FALHOU ✗\n  - ${falhas.join('\n  - ')}\n`);
  if (O.saida) writeFileSync(O.saida, JSON.stringify(r, null, 2));
  return r.passou;
}

async function limpar() {
  try { await pool?.end(); } catch { /* já fechado */ }
  if (app && app.exitCode === null) {
    app.kill('SIGTERM');
    await Promise.race([new Promise((r) => app.once('exit', r)), dormir(15_000)]);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
  evolution.close();
  ia.close();
  if (reserva) rmSync(reserva, { recursive: true, force: true });
  if (!tem('manter')) {
    try {
      const adm = new URL(O.banco); adm.pathname = '/postgres';
      const c = new pg.Client({ connectionString: adm.toString() }); await c.connect();
      await c.query(`drop database if exists ${nomeBanco} with (force)`); await c.end();
    } catch { /* fica para a próxima rodada */ }
  }
}

let codigo = 1;
try {
  codigo = (await principal()) ? 0 : 1;
} catch (e) {
  console.error('[carga] não deu para rodar:', e?.message ?? e);
  codigo = 2;
} finally {
  await limpar();
}
process.exit(codigo);
