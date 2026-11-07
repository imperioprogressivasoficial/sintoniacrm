import { LeiturasMemoria, LeiturasPostgres } from './app/leituras.js';
import Anthropic from '@anthropic-ai/sdk';
import { lerConfig } from './config.js';
import { ClienteTrinks } from './agenda/trinks.js';
import { Agente } from './ai/agente.js';
import { randomUUID } from 'node:crypto';
import { Fotos } from './app/fotos.js';
import { ArmazemMemoria, ArmazemPostgres, Conexoes } from './conexoes/conexoes.js';
import { Cofre } from './conexoes/cofre.js';
import { ContatosMemoria, ContatosPostgres } from './contatos/contatos.js';
import { Midias } from './app/midias.js';
import { textoDoAnexo, tipoPeloMimetype } from './midia.js';
import { CanalTeste, canalTesteDa, ehCanalTeste } from './channels/teste.js';
import { revisarRascunho } from './ai/copiloto.js';
import { carregarBase } from './ai/prompt.js';
import { Sintonia, type NumeroConectado } from './app/sintonia.js';
import { CanalEvolution } from './channels/evolution.js';
import { CanalMeta } from './channels/meta.js';
import { numerosDasConexoes, opcoesWebhookMeta } from './conexoes/numeros.js';
import type { CanalWhatsApp } from './channels/tipos.js';
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
import { ArmazemEmpresaMemoria, ArmazemEmpresaPostgres, Empresa, regrasDaConfig } from './empresa/empresa.js';
import { ArmazemTagsMemoria, ArmazemTagsPostgres, Tags, TagsDaIa } from './tags/tags.js';
import { ArmazemBaseMemoria, ArmazemBasePostgres, BaseConhecimento } from './ai/base.js';
import { simularResposta } from './ai/simulacao.js';
import { ArmazemFunisMemoria, ArmazemFunisPostgres, Funis } from './funis/funis.js';
import { ArmazemAutomacoesMemoria, ArmazemAutomacoesPostgres, Automacoes, ligarFunis } from './automacoes/automacoes.js';
import { registrarFunis } from './rotas/funis.js';
import { registrarConversa } from './conversa/rotas.js';
import { RespostasMemoria, RespostasPostgres } from './conversa/respostas.js';
import { TranscricoesMemoria, TranscricoesPostgres, TranscritorOpenAI } from './conversa/transcricao.js';
import { montarExtras, registrarExtras } from './rotas/extras.js';
import { ArmazemNotificacoesMemoria, ArmazemNotificacoesPostgres } from './notificacoes/armazem.js';
import { Notificador, observarEventos } from './notificacoes/notificador.js';
import { ChavesPush, enviadorWebPush } from './notificacoes/push.js';
import { EmailMarketing } from './email/email.js';
import { registrarEmail } from './email/rotas.js';
import { transporteArquivo, transporteReal } from './email/transporte.js';
import { calendarioPostgres } from './automacoes/calendario.js';

const cfg = lerConfig();
const log = (msg: string, extra?: unknown) => console.log(new Date().toISOString(), msg, extra ?? '');

// A chave da IA pode chegar depois (tela de Conexões): o agente usa sempre o cliente em vigor.
let claudeAtual = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY || 'sem-chave' });
const claude = new Proxy({} as Anthropic, { get: (_alvo, prop) => Reflect.get(claudeAtual, prop) });
const trinks = new ClienteTrinks({ apiKey: cfg.TRINKS_API_KEY ?? '', intervaloMs: cfg.TRINKS_INTERVALO_MS });
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
  // Pool só das travas: cada conversa em atendimento segura uma conexão aqui, e o trabalho usa o pool principal.
  // Tamanho: conversas simultâneas da fila + tarefas do relógio + folga.
  trava = new TravaPostgres(new pg.Pool({ connectionString: cfg.DATABASE_URL, max: cfg.SINTONIA_PARALELO + 8 }));
  contas = new ContasPostgres(pool);
} else {
  log('Aviso: DATABASE_URL ausente; dados em memória (somem ao reiniciar). Use só para teste local.');
  repo = new RepositorioMemoria();
  fila = new FilaMemoria();
  trava = new TravaMemoria();
  contas = new ContasMemoria();
}

// Empresa (nome e configuração da IA), tags e base de conhecimento: no banco, valendo sem reiniciar.
const empresa = new Empresa(pool ? new ArmazemEmpresaPostgres(pool) : new ArmazemEmpresaMemoria(), cfg.SINTONIA_EMPRESA_ID, 'Império Progressivas');
const armazemTags = pool ? new ArmazemTagsPostgres(pool) : new ArmazemTagsMemoria(() => repo.listarConversas());
const tags = new Tags(armazemTags, cfg.SINTONIA_EMPRESA_ID);
const tagsDaIa = new TagsDaIa(tags, async () => (await empresa.configIa()).marcarTags);
// Na primeira vez (banco vazio) a base nasce do knowledge/imperio.md; depois vale a do banco.
const base = new BaseConhecimento(pool ? new ArmazemBasePostgres(pool) : new ArmazemBaseMemoria(), cfg.SINTONIA_EMPRESA_ID, () => carregarBase());
await base.garantirSemente().catch((e) => log('Falha ao preparar a base de conhecimento', String(e)));
const agente = new Agente(claude, trinks, () => base.texto(), { modelo: cfg.SINTONIA_MODELO, esforco: cfg.SINTONIA_ESFORCO });

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
const cofre = new Cofre(process.env.SINTONIA_SEGREDO || cfg.DATABASE_URL || 'sintonia-local');
const conexoes = new Conexoes(
  pool ? new ArmazemPostgres(pool) : new ArmazemMemoria(),
  cofre,
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
// API oficial por variável de ambiente (configuração antiga, SINTONIA_NUMEROS com canal "meta"); a tela de Conexões vale por unidade.
const meta = cfg.META_TOKEN ? new CanalMeta(cfg.META_TOKEN) : undefined;
/** Canal da API oficial de cada unidade: refeito quando muda o token ou a WABA. */
const canaisMeta = new Map<string, { chave: string; canal: CanalWhatsApp }>();
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
  // Cada unidade usa a API escolhida na tela: oficial (Meta) ou não oficial (Evolution, QR Code).
  const lista: NumeroConectado[] = numerosDasConexoes({
    conexoes,
    evolution: temEvolution ? evolution : undefined,
    doAmbiente: cfg.numeros,
    metaDoAmbiente: meta,
    cacheMeta: canaisMeta,
    log,
  });
  // WhatsApp de teste por unidade: deixa ver a plataforma funcionando sem número real.
  for (const unidade of ['norte', 'sumare'] as const) lista.push({ canalId: canalTesteDa(unidade), unidade, canal: canalTeste });
  numeros.splice(0, numeros.length, ...lista);
  log(`Conexões aplicadas: IA ${iaLigada ? 'ligada' : 'desligada'}, agenda ${agendaLigada ? 'ligada' : 'desligada'}, ${lista.filter(ehReal).length} número(s) de WhatsApp.`);
}
conexoes.aoMudar(aplicarConexoes);
await conexoes.carregar();

// Notificações (sino e push): cada evento registrado vira aviso para quem pode ver a conversa.
const armazemNotificacoes = pool ? new ArmazemNotificacoesPostgres(pool) : new ArmazemNotificacoesMemoria();
const chavesPush = new ChavesPush(armazemNotificacoes, cofre);
const notificador = new Notificador({
  armazem: armazemNotificacoes,
  contas,
  repo,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  push: { chaves: chavesPush, enviador: enviadorWebPush, assunto: `mailto:${process.env.VAPID_EMAIL || cfg.ADMIN_EMAIL || 'suporte@example.com'}` },
  log,
});
observarEventos(repo, (e) => notificador.aoEvento(e));
await chavesPush.obter().catch((e) => log('Falha ao preparar as chaves do push', String(e)));

const destinosRelatorio = () => (conexoes.destinosRelatorio().length ? conexoes.destinosRelatorio() : cfg.destinosRelatorio);

// Fotos, áudios, vídeos e documentos recebidos: baixados à parte, sem segurar o texto.
const midias = new Midias(repo, (canalId) => numeros.find((n) => n.canalId === canalId)?.canal, undefined, log);

// Funis por tags e automações. A Sintonia nasce com os ganchos deles; eles usam a trava da Sintonia.
const funis = new Funis({
  armazem: pool ? new ArmazemFunisPostgres(pool) : new ArmazemFunisMemoria(repo, armazemTags),
  armazemTags,
  tags,
  repo,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  comConversa: (id, fn) => sintonia.comConversa(id, fn),
  log,
});
// E-mail marketing (só com banco). EMAIL_TRANSPORTE=arquivo:/pasta grava os e-mails em arquivos em vez de enviar (desenvolvimento).
const transporteEmail = process.env.EMAIL_TRANSPORTE?.startsWith('arquivo:') ? transporteArquivo(process.env.EMAIL_TRANSPORTE.slice('arquivo:'.length)) : transporteReal;
const email = pool ? new EmailMarketing({ pool, cofre, empresaId: cfg.SINTONIA_EMPRESA_ID, transporte: transporteEmail, urlPublica: process.env.SINTONIA_URL_PUBLICA, log }) : undefined;
const automacoes = new Automacoes({
  email,
  calendario: pool ? calendarioPostgres(pool, cfg.SINTONIA_EMPRESA_ID) : undefined,
  armazem: pool ? new ArmazemAutomacoesPostgres(pool) : new ArmazemAutomacoesMemoria(armazemTags),
  repo,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  sintonia: () => sintonia,
  funis,
  tags,
  contas,
  log,
});
const ganchos = ligarFunis({ tags, funis, automacoes });
// Funil do sistema "Atendimento" e toda conversa nele, na etapa em que está.
await funis.sincronizarSistema().then((n) => n && log(`Funil do sistema: ${n} conversa(s) sincronizada(s)`)).catch((e) => log('Falha ao sincronizar o funil do sistema', String(e)));

const sintonia = new Sintonia({
  ganchos,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  repo,
  numeros,
  agente,
  log,
  trava,
  midias,
  configIa: async () => regrasDaConfig(await empresa.configIa()),
  tagsIa: tagsDaIa,
  avisarEquipe: async (texto) => {
    // Aviso vai para os mesmos números do relatório, pelo primeiro número real conectado.
    const n = numeros.find(ehReal);
    if (!n) return;
    for (const destino of destinosRelatorio()) await n.canal.enviarTexto(n.canalId, destino, texto);
  },
});

const armazemContatos = pool ? new ContatosPostgres(pool) : new ContatosMemoria();

const trabalhador = new Trabalhador({ fila, processar: (m) => sintonia.receber(m), paralelo: cfg.SINTONIA_PARALELO, log });

const app = criarServidor({
  sintonia,
  repo,
  log,
  auth: { contas, cookieSeguro: cfg.COOKIE_SEGURO === '1' },
  fila: { fila, avisar: () => trabalhador.avisar() },
  contatos: { armazem: armazemContatos, empresaId: cfg.SINTONIA_EMPRESA_ID },
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
    testarOpenAI: async (chave) => {
      const r = await fetch('https://api.openai.com/v1/models/whisper-1', { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(r.status === 401 ? 'Chave recusada pela OpenAI' : `OpenAI respondeu ${r.status}`);
    },
    testarTrinks: async (chave) => {
      const t = new ClienteTrinks({ apiKey: chave });
      const lista = await t.listarProfissionais(UNIDADES.norte.trinksEstabelecimentoId ?? '');
      return { profissionais: lista.length };
    },
  },
  get meta() {
    // Lido a cada webhook: vale o que está na tela agora.
    return opcoesWebhookMeta(
      conexoes,
      { verifyToken: cfg.META_VERIFY_TOKEN, appSecret: cfg.META_APP_SECRET, temNumerosMeta: Boolean(meta) && cfg.numeros.some((n) => n.canal === 'meta') },
      (lista) => sintonia.statusRecebidos(lista),
    );
  },
  fotos: new Fotos(repo, (canalId) => numeros.find((n) => n.canalId === canalId)?.canal, undefined, log),
  situacao: () => ({ iaLigada, agendaLigada, numerosReais: numeros.filter(ehReal).length }),
  midias,
  notificacoes: { notificador, armazem: armazemNotificacoes, chaves: chavesPush },
  leituras: pool ? new LeiturasPostgres(pool) : new LeiturasMemoria(),
  gestao: {
    tags,
    empresa,
    base,
    iaLigada: () => iaLigada,
    tagsDaIa: () => tagsDaIa.nomes(),
    simularIa: (p) => simularResposta(agente, cfg.SINTONIA_EMPRESA_ID, { ...p, agora: new Date() }),
  },
  clienteTeste: async ({ unidade, nome, telefone, texto, midia }) => {
    const canalId = canalTesteDa(unidade);
    const agora = new Date();
    // Sem a chave da IA, a conversa de teste nasce em "Só eu" para a IA não ficar tentando responder.
    const { conversa, nova } = await repo.buscarOuCriarConversa({ empresaId: cfg.SINTONIA_EMPRESA_ID, unidade, canalId, telefone, nome, agora });
    if (nova) {
      // A conversa foi criada aqui (para nascer no modo certo): registra a chegada da cliente como num número real.
      await repo.registrarEvento({ tipo: 'conversa_nova', conversaId: conversa.id, unidade, em: agora });
      await sintonia.mudarModo(conversa.id, iaLigada ? (await empresa.configIa()).modoPadrao : 'humano');
    }
    // Mídia de teste: chega como se viesse do WhatsApp, já com o arquivo (o canal de teste não baixa nada).
    const tipo = midia ? tipoPeloMimetype(midia.mimetype) : undefined;
    const anexo = midia && tipo
      ? { tipo, mimetype: midia.mimetype, nomeArquivo: tipo === 'documento' ? (midia.nomeArquivo ?? 'arquivo') : undefined, duracaoSeg: midia.duracaoSeg, legenda: texto, voz: tipo === 'audio' || undefined, base64: midia.base64 }
      : undefined;
    const conteudo = anexo ? textoDoAnexo(anexo.tipo, texto, anexo.nomeArquivo) : (texto ?? '');
    await sintonia.receber({ canalId, telefone, nome, texto: conteudo, deMim: false, idExterno: `teste-${randomUUID()}`, em: agora, ...(anexo ? { anexo } : {}) });
  },
  revisar: async (conversaId, rascunho) => {
    const conversa = await repo.buscarConversa(conversaId);
    if (!conversa) throw new Error('Conversa não encontrada');
    const est = UNIDADES[conversa.unidade].trinksEstabelecimentoId;
    const servicos = est ? await trinks.listarServicos(est).catch(() => []) : [];
    return revisarRascunho(
      claude,
      { modelo: cfg.SINTONIA_MODELO, baseConhecimento: await base.texto() },
      { conversa, mensagens: await repo.mensagens(conversaId), rascunho, servicos, agora: new Date() },
    );
  },
});

// Rotas dos funis e das automações (depois de criarServidor: valem o login e o tratamento de erros de lá).
registrarFunis(app, { repo, funis, automacoes });
// Relatórios, Leads (importar/exportar/duplicatas) e Agenda.
const extras = montarExtras({
  repo,
  pool,
  contatos: armazemContatos,
  armazemTags,
  tags,
  funis,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  // Conversa importada: pelo número real da unidade (se houver), senão pelo de teste.
  canalDa: (unidade) => (numeros.find((n) => n.unidade === unidade && ehReal(n)) ?? numeros.find((n) => n.unidade === unidade))?.canalId,
  comConversa: (id, fn) => sintonia.comConversa(id, fn),
});
registrarExtras(app, { repo, empresaId: cfg.SINTONIA_EMPRESA_ID, relatorios: extras.relatorios, leads: extras.leads, contas });

// E-mail marketing: gestão (/api/email) e rastreio público (/e/...). A fila anda a cada 10 s; o IMAP é lido a cada 2 min.
let emailTick: ReturnType<typeof setInterval> | undefined;
let emailImap: ReturnType<typeof setInterval> | undefined;
if (email) {
  const andar = () => void email.tick().catch((e) => log('Falha na fila de e-mails', String(e)));
  registrarEmail(app, { email, avisar: andar });
  emailTick = setInterval(andar, 10_000);
  emailImap = setInterval(() => void email.lerCaixas().catch((e) => log('Falha ao ler as caixas de e-mail', String(e))), 120_000);
}

// Tela de conversa: respostas rápidas, botão "IA", transcrição de áudio e nova conversa por número.
registrarConversa(app, {
  repo,
  sintonia,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  respostas: pool ? new RespostasPostgres(pool) : new RespostasMemoria(),
  transcricoes: pool ? new TranscricoesPostgres(pool) : new TranscricoesMemoria(),
  transcritor: new TranscritorOpenAI(() => conexoes.get('openaiApiKey')),
  transcricaoLigada: () => Boolean(conexoes.get('openaiApiKey')),
  ia: { claude, modelo: cfg.SINTONIA_MODELO, base: () => base.texto(), ligada: () => iaLigada },
  // Envia pelo número real da unidade; o de teste só vale enquanto nenhum número real estiver conectado.
  canalDa: (unidade) => {
    const real = numeros.find((n) => n.unidade === unidade && ehReal(n));
    if (real) return { canalId: real.canalId };
    const teste = numeros.find((n) => n.unidade === unidade);
    if (teste && !numeros.some(ehReal)) return { canalId: teste.canalId };
    return { erro: 'Esta unidade ainda não tem WhatsApp conectado. Conecte o número em Conexões.' };
  },
  modoInicial: async () => (iaLigada ? (await empresa.configIa()).modoPadrao : 'humano'),
});

// Relógio: reavaliações, lembretes e follow-ups a cada 30 s; relatório às 20h.
let relatorioEnviadoEm = '';
const relogio = setInterval(async () => {
  await sintonia.tick().catch((e) => log('Falha no relógio', String(e)));
  await automacoes.tick().catch((e) => log('Falha no relógio das automações', String(e))); // "esperar", fora do horário, parada na etapa
  await notificador.tick().catch((e) => log('Falha no relógio das notificações', String(e))); // lembretes que venceram, cliente esperando
  midias.avisar(); // novas tentativas de download que já venceram
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
    if (emailTick) clearInterval(emailTick);
    if (emailImap) clearInterval(emailImap);
    await app.close().catch(() => {});
    await trabalhador.parar();
    await notificador.ocioso().catch(() => {});
    await pool?.end();
    process.exit(0);
  });
}
log(`Sintonia no ar na porta ${cfg.PORT} com ${numeros.length} número(s) conectado(s).`);
