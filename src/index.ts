import Anthropic from '@anthropic-ai/sdk';
import { lerConfig } from './config.js';
import { ClienteTrinks } from './agenda/trinks.js';
import { Agente } from './ai/agente.js';
import { revisarRascunho } from './ai/copiloto.js';
import { carregarBase } from './ai/prompt.js';
import { Sintonia, type NumeroConectado } from './app/sintonia.js';
import { CanalEvolution } from './channels/evolution.js';
import { CanalMeta } from './channels/meta.js';
import { criarServidor } from './server.js';
import pg from 'pg';
import { migrar } from './store/migrar.js';
import { RepositorioPostgres } from './store/postgres.js';
import { RepositorioMemoria, type Repositorio } from './store/repositorio.js';
import { FilaMemoria, FilaPostgres, type FilaEntrada } from './fila/entrada.js';
import { Trabalhador } from './fila/trabalhador.js';
import { TravaMemoria, TravaPostgres, type Trava } from './fila/trava.js';
import { UNIDADES } from './unidades.js';
import { dataISO, partesBahia } from './util/tempo.js';

const cfg = lerConfig();
const log = (msg: string, extra?: unknown) => console.log(new Date().toISOString(), msg, extra ?? '');

if (!cfg.ANTHROPIC_API_KEY) log('Aviso: ANTHROPIC_API_KEY ausente; a IA não vai responder.');
if (!cfg.TRINKS_API_KEY) log('Aviso: TRINKS_API_KEY ausente; agenda indisponível.');

const claude = new Anthropic();
const trinks = new ClienteTrinks({ apiKey: cfg.TRINKS_API_KEY ?? '', intervaloMs: cfg.TRINKS_INTERVALO_MS });
const base = carregarBase();
const agente = new Agente(claude, trinks, base, { modelo: cfg.SINTONIA_MODELO, esforco: cfg.SINTONIA_ESFORCO });

let repo: Repositorio;
let fila: FilaEntrada;
let trava: Trava;
let pool: pg.Pool | undefined;
if (cfg.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 20 });
  const aplicadas = await migrar(pool);
  if (aplicadas.length) log('Migrações aplicadas', aplicadas);
  repo = new RepositorioPostgres(pool);
  fila = new FilaPostgres(pool);
  trava = new TravaPostgres(pool);
} else {
  log('Aviso: DATABASE_URL ausente; dados em memória (somem ao reiniciar). Use só para teste local.');
  repo = new RepositorioMemoria();
  fila = new FilaMemoria();
  trava = new TravaMemoria();
}

const evolution =
  cfg.EVOLUTION_URL && cfg.EVOLUTION_API_KEY ? new CanalEvolution(cfg.EVOLUTION_URL, cfg.EVOLUTION_API_KEY) : undefined;
const meta = cfg.META_TOKEN ? new CanalMeta(cfg.META_TOKEN) : undefined;

const numeros: NumeroConectado[] = cfg.numeros.flatMap((n) => {
  const canal = n.canal === 'evolution' ? evolution : meta;
  if (!canal) {
    log(`Número ${n.canalId} ignorado: canal ${n.canal} sem credenciais`);
    return [];
  }
  return [{ canalId: n.canalId, unidade: n.unidade, canal }];
});

const sintonia = new Sintonia({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  repo,
  numeros,
  agente,
  log,
  trava,
  avisarEquipe: async (texto) => {
    // Aviso vai para os mesmos números do relatório, pelo primeiro número conectado.
    const n = numeros[0];
    if (!n) return;
    for (const destino of cfg.destinosRelatorio) await n.canal.enviarTexto(n.canalId, destino, texto);
  },
});

const trabalhador = new Trabalhador({ fila, processar: (m) => sintonia.receber(m), paralelo: cfg.SINTONIA_PARALELO, log });

const app = criarServidor({
  sintonia,
  repo,
  log,
  fila: { fila, avisar: () => trabalhador.avisar() },
  agenda: cfg.TRINKS_API_KEY ? trinks : undefined,
  evolution: evolution ? { canal: evolution, token: cfg.EVOLUTION_WEBHOOK_TOKEN } : undefined,
  meta: meta ? { canal: meta, verifyToken: cfg.META_VERIFY_TOKEN, appSecret: cfg.META_APP_SECRET } : undefined,
  revisar: async (conversaId, rascunho) => {
    const conversa = await repo.buscarConversa(conversaId);
    if (!conversa) throw new Error('Conversa não encontrada');
    const est = UNIDADES[conversa.unidade].trinksEstabelecimentoId;
    const servicos = est ? await trinks.listarServicos(est).catch(() => []) : [];
    return revisarRascunho(
      claude,
      { modelo: cfg.SINTONIA_MODELO, baseConhecimento: base },
      { conversa, mensagens: await repo.mensagens(conversaId), rascunho, servicos, agora: new Date() },
    );
  },
});

// Relógio: reavaliações, lembretes e follow-ups a cada 30 s; relatório às 20h.
let relatorioEnviadoEm = '';
const relogio = setInterval(async () => {
  await sintonia.tick().catch((e) => log('Falha no relógio', String(e)));
  const agora = new Date();
  const p = partesBahia(agora);
  if (p.hora === 20 && relatorioEnviadoEm !== dataISO(agora) && numeros[0]) {
    relatorioEnviadoEm = dataISO(agora);
    const texto = await sintonia.relatorioDoDia(agora);
    for (const destino of cfg.destinosRelatorio) {
      await numeros[0].canal.enviarTexto(numeros[0].canalId, destino, texto).catch((e) => log('Falha no relatório', String(e)));
    }
  }
}, 30_000);

trabalhador.iniciar();
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });

// Desligamento limpo: para de aceitar, termina o que está em andamento, fecha o banco.
// Se cair de vez, nada se perde: as mensagens reservadas voltam para a fila quando a reserva vence.
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, async () => {
    log(`Recebido ${sinal}: encerrando`);
    clearInterval(relogio);
    await app.close().catch(() => {});
    await trabalhador.parar();
    await pool?.end();
    process.exit(0);
  });
}
log(`Sintonia no ar na porta ${cfg.PORT} com ${numeros.length} número(s) conectado(s).`);
