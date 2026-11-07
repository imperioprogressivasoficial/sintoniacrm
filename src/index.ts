import Anthropic from '@anthropic-ai/sdk';
import { lerConfig } from './config.js';
import { ClienteTrinks } from './agenda/trinks.js';
import { Agente } from './ai/agente.js';
import { randomUUID } from 'node:crypto';
import { Fotos } from './app/fotos.js';
import { ArmazemMemoria, ArmazemPostgres, Conexoes } from './conexoes/conexoes.js';
import { Cofre } from './conexoes/cofre.js';
import { CanalTeste, canalTesteDa, ehCanalTeste } from './channels/teste.js';
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
import { ContasMemoria, ContasPostgres, type Contas } from './auth/contas.js';
import { gerarHash, senhaFraca } from './auth/senha.js';
import { UNIDADES } from './unidades.js';
import { dataISO, partesBahia } from './util/tempo.js';

const cfg = lerConfig();
const log = (msg: string, extra?: unknown) => console.log(new Date().toISOString(), msg, extra ?? '');

// A chave da IA pode chegar depois (tela de Conexões): o agente usa sempre o cliente em vigor.
let claudeAtual = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY || 'sem-chave' });
const claude = new Proxy({} as Anthropic, { get: (_alvo, prop) => Reflect.get(claudeAtual, prop) });
const trinks = new ClienteTrinks({ apiKey: cfg.TRINKS_API_KEY ?? '', intervaloMs: cfg.TRINKS_INTERVALO_MS });
const base = carregarBase();
const agente = new Agente(claude, trinks, base, { modelo: cfg.SINTONIA_MODELO, esforco: cfg.SINTONIA_ESFORCO });

let repo: Repositorio;
let fila: FilaEntrada;
let trava: Trava;
let contas: Contas;
let pool: pg.Pool | undefined;
if (cfg.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: 20 });
  const aplicadas = await migrar(pool);
  if (aplicadas.length) log('Migrações aplicadas', aplicadas);
  repo = new RepositorioPostgres(pool);
  fila = new FilaPostgres(pool);
  trava = new TravaPostgres(pool);
  contas = new ContasPostgres(pool);
} else {
  log('Aviso: DATABASE_URL ausente; dados em memória (somem ao reiniciar). Use só para teste local.');
  repo = new RepositorioMemoria();
  fila = new FilaMemoria();
  trava = new TravaMemoria();
  contas = new ContasMemoria();
}

// Primeiro administrador (só se ainda não existir). ADMIN_SENHA_HASH evita guardar a senha em texto.
if (cfg.ADMIN_EMAIL && (cfg.ADMIN_SENHA || cfg.ADMIN_SENHA_HASH)) {
  const fraca = cfg.ADMIN_SENHA_HASH ? null : senhaFraca(cfg.ADMIN_SENHA!);
  if (fraca) log(`ADMIN_SENHA recusada: ${fraca}`);
  else if (!(await contas.buscarPorEmail(cfg.ADMIN_EMAIL))) {
    await contas.criarUsuario({
      empresaId: cfg.SINTONIA_EMPRESA_ID,
      nome: cfg.ADMIN_NOME ?? 'Administrador',
      email: cfg.ADMIN_EMAIL,
      papel: 'admin',
      unidades: [],
      senhaHash: cfg.ADMIN_SENHA_HASH ?? (await gerarHash(cfg.ADMIN_SENHA!)),
    });
    log(`Administrador ${cfg.ADMIN_EMAIL} criado.`);
  }
}

// Conexões: o que for salvo na tela vale por cima do ambiente, e é aplicado na hora.
const conexoes = new Conexoes(
  pool ? new ArmazemPostgres(pool) : new ArmazemMemoria(),
  new Cofre(process.env.SINTONIA_SEGREDO || cfg.DATABASE_URL || 'sintonia-local'),
  {
    anthropicApiKey: cfg.ANTHROPIC_API_KEY,
    trinksApiKey: cfg.TRINKS_API_KEY,
    evolutionUrl: cfg.EVOLUTION_URL,
    evolutionApiKey: cfg.EVOLUTION_API_KEY,
    webhookToken: cfg.EVOLUTION_WEBHOOK_TOKEN,
    relatorioDestinos: cfg.RELATORIO_DESTINOS,
  },
  log,
);

// A lista de números é a mesma usada pela Sintonia: é refeita no lugar quando as conexões mudam.
let evolution = new CanalEvolution(cfg.EVOLUTION_URL ?? '', cfg.EVOLUTION_API_KEY ?? '');
const meta = cfg.META_TOKEN ? new CanalMeta(cfg.META_TOKEN) : undefined;
const canalTeste = new CanalTeste();
const numeros: NumeroConectado[] = [];
const ehReal = (n: NumeroConectado) => !ehCanalTeste(n.canalId);
let iaLigada = false;
let agendaLigada = false;

function aplicarConexoes() {
  const chaveIA = conexoes.get('anthropicApiKey');
  claudeAtual = new Anthropic({ apiKey: chaveIA || 'sem-chave' });
  iaLigada = Boolean(chaveIA);
  trinks.definirChave(conexoes.get('trinksApiKey') ?? '');
  agendaLigada = Boolean(conexoes.get('trinksApiKey'));
  evolution = new CanalEvolution(conexoes.get('evolutionUrl') ?? '', conexoes.get('evolutionApiKey') ?? '');
  const temEvolution = Boolean(conexoes.get('evolutionUrl') && conexoes.get('evolutionApiKey'));
  const lista: NumeroConectado[] = [];
  for (const n of cfg.numeros) {
    const canal = n.canal === 'evolution' ? (temEvolution ? evolution : undefined) : meta;
    if (canal) lista.push({ canalId: n.canalId, unidade: n.unidade, canal });
    else log(`Número ${n.canalId} ignorado: canal ${n.canal} sem credenciais`);
  }
  if (temEvolution) for (const n of conexoes.numeros()) if (!lista.some((x) => x.canalId === n.canalId)) lista.push({ ...n, canal: evolution });
  // WhatsApp de teste por unidade: deixa ver a plataforma funcionando sem número real.
  for (const unidade of ['norte', 'sumare'] as const) lista.push({ canalId: canalTesteDa(unidade), unidade, canal: canalTeste });
  numeros.splice(0, numeros.length, ...lista);
  log(`Conexões aplicadas: IA ${iaLigada ? 'ligada' : 'desligada'}, agenda ${agendaLigada ? 'ligada' : 'desligada'}, ${lista.filter(ehReal).length} número(s) de WhatsApp.`);
}
conexoes.aoMudar(aplicarConexoes);
await conexoes.carregar();
const destinosRelatorio = () => (conexoes.destinosRelatorio().length ? conexoes.destinosRelatorio() : cfg.destinosRelatorio);

const sintonia = new Sintonia({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  repo,
  numeros,
  agente,
  log,
  trava,
  avisarEquipe: async (texto) => {
    // Aviso vai para os mesmos números do relatório, pelo primeiro número real conectado.
    const n = numeros.find(ehReal);
    if (!n) return;
    for (const destino of destinosRelatorio()) await n.canal.enviarTexto(n.canalId, destino, texto);
  },
});

const trabalhador = new Trabalhador({ fila, processar: (m) => sintonia.receber(m), paralelo: cfg.SINTONIA_PARALELO, log });

const app = criarServidor({
  sintonia,
  repo,
  log,
  auth: { contas, cookieSeguro: cfg.COOKIE_SEGURO === '1' },
  fila: { fila, avisar: () => trabalhador.avisar() },
  get agenda() {
    return agendaLigada ? trinks : undefined;
  },
  get evolution() {
    return { canal: evolution, token: conexoes.get('webhookToken') };
  },
  conexoes: {
    conexoes,
    testarIA: async (chave) => {
      await new Anthropic({ apiKey: chave }).models.list({ limit: 1 });
    },
    testarTrinks: async (chave) => {
      const t = new ClienteTrinks({ apiKey: chave });
      const lista = await t.listarProfissionais(UNIDADES.norte.trinksEstabelecimentoId ?? '');
      return { profissionais: lista.length };
    },
  },
  meta: meta ? { canal: meta, verifyToken: cfg.META_VERIFY_TOKEN, appSecret: cfg.META_APP_SECRET } : undefined,
  fotos: new Fotos(repo, (canalId) => numeros.find((n) => n.canalId === canalId)?.canal, undefined, log),
  situacao: () => ({ iaLigada, agendaLigada, numerosReais: numeros.filter(ehReal).length }),
  clienteTeste: async ({ unidade, nome, telefone, texto }) => {
    const canalId = canalTesteDa(unidade);
    const agora = new Date();
    // Sem a chave da IA, a conversa de teste nasce em "Só eu" para a IA não ficar tentando responder.
    const { conversa, nova } = await repo.buscarOuCriarConversa({ empresaId: cfg.SINTONIA_EMPRESA_ID, unidade, canalId, telefone, nome, agora });
    if (nova && !iaLigada) await sintonia.mudarModo(conversa.id, 'humano');
    await sintonia.receber({ canalId, telefone, nome, texto, deMim: false, idExterno: `teste-${randomUUID()}`, em: agora });
  },
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
  const real = numeros.find(ehReal);
  if (p.hora === 20 && relatorioEnviadoEm !== dataISO(agora) && real) {
    relatorioEnviadoEm = dataISO(agora);
    const texto = await sintonia.relatorioDoDia(agora);
    for (const destino of destinosRelatorio()) {
      await real.canal.enviarTexto(real.canalId, destino, texto).catch((e) => log('Falha no relatório', String(e)));
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
