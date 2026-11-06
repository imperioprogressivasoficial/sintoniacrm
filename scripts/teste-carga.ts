/**
 * Teste de carga e de queda da Sintonia, com processos separados e um Postgres de verdade.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/teste-carga.ts [--mensagens 1000] [--clientes 200]
 *     [--trabalhadores 3] [--segundos 10] [--repetidas 0.05] [--ia-ms 50] [--paralelo 8] [--espera 300] [--sem-queda]
 *
 * O que faz:
 *  1. limpa o esquema "sintonia" do banco informado (USE UM BANCO DE TESTE);
 *  2. sobe N processos trabalhadores, cada um com IA e WhatsApp simulados;
 *  3. joga as mensagens na fila no ritmo pedido, com uma parte repetida (o mesmo webhook duas vezes);
 *  4. no meio, mata um trabalhador sem aviso (kill -9) e sobe outro no lugar;
 *  5. espera a fila esvaziar e confere: nenhuma mensagem perdida, nenhuma repetida,
 *     toda cliente respondida, nenhuma falha.
 *
 * A IA e o WhatsApp são simulados: o teste mede a Sintonia, não a Anthropic. `--ia-ms` define quanto
 * a IA simulada demora em média (use ~3000 para o tempo real de uma resposta).
 */
import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { Sintonia } from '../src/app/sintonia.js';
import type { CanalWhatsApp, MensagemRecebida } from '../src/channels/tipos.js';
import { FilaPostgres } from '../src/fila/entrada.js';
import { Trabalhador } from '../src/fila/trabalhador.js';
import { TravaPostgres } from '../src/fila/trava.js';
import { migrar } from '../src/store/migrar.js';
import { RepositorioPostgres } from '../src/store/postgres.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Defina DATABASE_URL apontando para um banco de TESTE.');
  process.exit(2);
}

const arg = (nome: string, padrao: number) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i > 0 ? Number(process.argv[i + 1]) : padrao;
};
const RESERVA_MS = 4_000;
const CANAL_ID = 'carga-norte';
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Relógio dos trabalhadores fixado de madrugada na Bahia: a IA responde sozinha (sem esperar a equipe).
// O deslocamento é calculado uma vez pelo coordenador e passado aos trabalhadores, para todos
// os processos marcarem a mesma hora.
const MADRUGADA_OFFSET = process.env.CARGA_OFFSET ? Number(process.env.CARGA_OFFSET) : (() => {
  const agora = new Date();
  const alvo = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 6, 0)); // 03:00 na Bahia
  return alvo.getTime() - agora.getTime();
})();

// ---------------------------------------------------------------- processo trabalhador
async function trabalhador() {
  const pool = new pg.Pool({ connectionString: url, max: 12 });
  const repo = new RepositorioPostgres(pool);
  let n = 0;
  const canal: CanalWhatsApp = {
    tipo: 'evolution',
    lerWebhook: () => [],
    enviarTexto: async () => {
      await dorme(5 + Math.random() * 15);
      return { idExterno: `out-${process.pid}-${++n}` };
    },
  };
  const sintonia = new Sintonia({
    empresaId: 'carga',
    repo,
    numeros: [{ canalId: CANAL_ID, unidade: 'norte', canal }],
    trava: new TravaPostgres(pool),
    agora: () => new Date(Date.now() + MADRUGADA_OFFSET),
    agente: {
      executar: async (p) => {
        const ia = Number(process.env.CARGA_IA_MS ?? 50);
        await dorme(ia * (0.4 + Math.random() * 1.2));
        const ultima = [...p.mensagens].reverse().find((m) => m.autor === 'cliente');
        return { texto: `Resposta para: ${ultima?.texto ?? '?'}`, acoes: [], recusou: false };
      },
    },
  });
  const t = new Trabalhador({ fila: new FilaPostgres(pool, RESERVA_MS), processar: (m) => sintonia.receber(m), paralelo: Number(process.env.CARGA_PARALELO ?? 8), esperaVaziaMs: 50 });
  t.iniciar();
  process.on('SIGTERM', async () => {
    await t.parar();
    await pool.end();
    process.exit(0);
  });
  process.send?.('pronto');
}

// ---------------------------------------------------------------- coordenador
async function coordenador() {
  const total = arg('mensagens', 1000);
  const clientes = arg('clientes', 200);
  const nTrab = arg('trabalhadores', 3);
  const segundos = arg('segundos', 10);
  const repetidas = arg('repetidas', 0.05);
  const comQueda = !process.argv.includes('--sem-queda');

  const pool = new pg.Pool({ connectionString: url, max: 5 });
  await pool.query('drop schema if exists sintonia cascade');
  await migrar(pool);
  const fila = new FilaPostgres(pool, RESERVA_MS);

  const eu = fileURLToPath(import.meta.url);
  const subir = () =>
    new Promise<ChildProcess>((ok) => {
      const p = fork(eu, ['trabalhador'], {
        execArgv: ['--import', 'tsx'],
        env: { ...process.env, CARGA_OFFSET: String(MADRUGADA_OFFSET), CARGA_IA_MS: String(arg('ia-ms', 50)), CARGA_PARALELO: String(arg('paralelo', 8)) },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      p.once('message', () => ok(p));
    });
  const procs = await Promise.all(Array.from({ length: nTrab }, subir));
  console.log(`${nTrab} trabalhadores no ar. Enviando ${total} mensagens de ${clientes} clientes em ${segundos}s (${Math.round(repetidas * 100)}% repetidas)...`);

  const inicio = Date.now();
  const tels = Array.from({ length: clientes }, (_, i) => `55719${String(10_000_000 + i)}`);
  const porCliente = new Map<string, number>();
  let duplicadasEnviadas = 0;
  let quedaFeita = false;
  for (let i = 0; i < total; i++) {
    const tel = tels[i % clientes]!;
    const k = (porCliente.get(tel) ?? 0) + 1;
    porCliente.set(tel, k);
    const m: MensagemRecebida = {
      canalId: CANAL_ID,
      telefone: tel,
      nome: `Cliente ${tel.slice(-4)}`,
      texto: `${tel}#${k}`,
      deMim: false,
      idExterno: `in-${tel}-${k}`,
      em: new Date(Date.now() + MADRUGADA_OFFSET),
    };
    await fila.enfileirar('evolution', [m]);
    if (Math.random() < repetidas) {
      await fila.enfileirar('evolution', [m]); // o mesmo webhook de novo
      duplicadasEnviadas++;
    }
    if (comQueda && !quedaFeita && i >= total * 0.4) {
      quedaFeita = true;
      const vitima = procs.shift()!;
      vitima.kill('SIGKILL');
      console.log(`Queda: trabalhador ${vitima.pid} morto sem aviso com ${i} mensagens enviadas. Subindo outro em 1s...`);
      setTimeout(() => void subir().then((p) => procs.push(p)), 1000);
    }
    const alvo = inicio + ((i + 1) / total) * segundos * 1000;
    const falta = alvo - Date.now();
    if (falta > 0) await dorme(falta);
  }
  const fimEnvio = Date.now();

  // espera esvaziar (com folga para a reserva da mensagem do processo morto vencer)
  let s = await fila.situacao();
  const limite = Date.now() + arg('espera', 300) * 1000;
  while ((s.pendentes > 0 || s.processando > 0) && Date.now() < limite) {
    await dorme(250);
    s = await fila.situacao();
  }
  const fim = Date.now();
  await Promise.all(procs.map((p) => new Promise((r) => (p.once('exit', r), p.kill('SIGTERM')))));

  // ---------------- conferência
  const q = async (sql: string) => (await pool.query(sql)).rows;
  const [entrada] = await q(`select count(*)::int as linhas, count(*) filter (where status='feita')::int as feitas,
    count(*) filter (where status='falhou')::int as falhas, max(tentativas)::int as max_tentativas,
    count(*) filter (where tentativas > 1)::int as retomadas from sintonia.entrada`);
  const [msgs] = await q(`select count(*) filter (where autor='cliente')::int as cliente, count(*) filter (where autor='ia')::int as ia,
    count(distinct conversa_id)::int as conversas from sintonia.mensagens`);
  const [dupl] = await q(`select count(*)::int as n from (select texto from sintonia.mensagens where autor='cliente' group by texto having count(*) > 1) d`);
  // Cada mensagem da cliente precisa de uma resposta própria (a IA simulada responde citando o texto).
  const [semResposta] = await q(`select count(*)::int as n from sintonia.mensagens c
    where c.autor = 'cliente'
      and not exists (select 1 from sintonia.mensagens r where r.conversa_id = c.conversa_id and r.autor = 'ia' and r.texto = 'Resposta para: ' || c.texto)`);
  const [respostaDupla] = await q(`select count(*)::int as n from (select texto from sintonia.mensagens where autor = 'ia' group by conversa_id, texto having count(*) > 1) d`);
  const [conversas] = await q(`select count(*)::int as n from sintonia.conversas`);
  const [falhasIa] = await q(`select count(*)::int as n from sintonia.eventos where tipo='falha'`);
  const [lat] = await q(`select
      percentile_cont(0.5) within group (order by extract(epoch from (feita_em - criada_em))) as p50,
      percentile_cont(0.95) within group (order by extract(epoch from (feita_em - criada_em))) as p95,
      max(extract(epoch from (feita_em - criada_em))) as maximo
    from sintonia.entrada where status='feita'`);
  await pool.end();

  const checagens: Array<[string, boolean, string]> = [
    ['Nenhuma mensagem perdida', msgs.cliente === total && entrada.feitas === total, `${msgs.cliente}/${total} gravadas, ${entrada.feitas} concluídas na fila`],
    ['Webhook repetido não duplicou', entrada.linhas === total && dupl.n === 0, `${duplicadasEnviadas} repetidas enviadas, ${entrada.linhas} linhas na fila, ${dupl.n} duplicadas no histórico`],
    ['Uma conversa por cliente', conversas.n === clientes, `${conversas.n} conversas para ${clientes} clientes`],
    ['Toda mensagem respondida', semResposta.n === 0, `${semResposta.n} mensagens de cliente sem resposta própria`],
    // Se o processo cai DEPOIS de enviar e ANTES de gravar, a mensagem retomada é respondida de novo:
    // no máximo uma por mensagem retomada (entrega "pelo menos uma vez").
    ['Resposta dupla só em mensagem retomada', respostaDupla.n <= entrada.retomadas, `${respostaDupla.n} respostas repetidas, ${entrada.retomadas} mensagens retomadas`],
    ['Nenhuma falha', entrada.falhas === 0 && falhasIa.n === 0, `${entrada.falhas} na lista de falhas, ${falhasIa.n} falhas ao processar`],
    ...(comQueda ? [['Queda recuperada', entrada.retomadas >= 0 && entrada.falhas === 0, `${entrada.retomadas} mensagens retomadas de outro trabalhador`] as [string, boolean, string]] : []),
  ];

  const dur = (fim - inicio) / 1000;
  console.log('\nResultado');
  for (const [nome, ok, det] of checagens) console.log(`  ${ok ? 'OK   ' : 'FALHOU'} ${nome}: ${det}`);
  console.log(`\n  Mensagens: ${total} em ${segundos}s (${Math.round(total / segundos)}/s, equivale a ${Math.round((total / segundos) * 3600).toLocaleString('pt-BR')}/hora)`);
  console.log(`  Fila vazia ${((fim - fimEnvio) / 1000).toFixed(1)}s depois do último envio; total ${dur.toFixed(1)}s`);
  console.log(`  Respostas da IA: ${msgs.ia} para ${msgs.cliente} mensagens de cliente`);
  console.log(`  Tempo da chegada até processar: mediana ${Number(lat.p50).toFixed(2)}s, 95% em até ${Number(lat.p95).toFixed(2)}s, pior ${Number(lat.maximo).toFixed(2)}s`);
  process.exit(checagens.every((c) => c[1]) ? 0 : 1);
}

if (process.argv[2] === 'trabalhador') void trabalhador();
else void coordenador();
