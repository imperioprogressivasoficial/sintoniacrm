import { LeiturasMemoria, LeiturasPostgres } from './app/leituras.js';
import Anthropic from '@anthropic-ai/sdk';
import { lerConfig } from './config.js';
import { ClienteTrinks } from './agenda/trinks.js';
import { AgendasDasUnidades, UNIDADES_AGENDA } from './agenda/unidades-agenda.js';
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
import { contaDaRede, numerosSociais } from './conexoes/sociais.js';
import { ehCanalSocial } from './channels/meta-social.js';
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
import { ArmazemBotsMemoria, ArmazemBotsPostgres, Bots, ligarBots } from './bot/bot.js';
import { registrarBots } from './bot/rotas.js';
import { registrarConversa } from './conversa/rotas.js';
import { RespostasMemoria, RespostasPostgres } from './conversa/respostas.js';
import { TranscricoesMemoria, TranscricoesPostgres, TranscritorOpenAI } from './conversa/transcricao.js';
import { montarExtras, registrarExtras } from './rotas/extras.js';
import { ArmazemNotificacoesMemoria, ArmazemNotificacoesPostgres } from './notificacoes/armazem.js';
import { Notificador, observarEventos } from './notificacoes/notificador.js';
import { montarAgentesIa } from './agentes-ia/montar.js';
import { moverEtapaPara, tagsParaAgentes } from './agentes-ia/ligar.js';
import { ChavesPush, enviadorWebPush } from './notificacoes/push.js';
import { ArmazemDemoMemoria, ArmazemDemoPostgres, type ArmazemDemo } from './demo/armazem.js';
import { Demo } from './demo/demo.js';
import { registrarDemo } from './demo/rotas.js';
import { ArmazemRastreioMemoria, ArmazemRastreioPostgres } from './rastreio/armazem.js';
import { Capi } from './rastreio/capi.js';
import { Rastreio } from './rastreio/rastreio.js';
import { configCapiDe, registrarRastreio } from './rastreio/rotas.js';
import { Transmissoes } from './transmissoes/transmissoes.js';
import { registrarTransmissoes } from './transmissoes/rotas.js';
import { EmailMarketing } from './email/email.js';
import { recuperacaoPorEmail } from './auth/recuperacao.js';
import { registrarEmail } from './email/rotas.js';
import { transporteArquivo, transporteReal } from './email/transporte.js';
import { calendarioPostgres } from './automacoes/calendario.js';
import { ArmazemComercialMemoria, ArmazemComercialPostgres } from './comercial/armazem.js';
import { FonteComercialMemoria, FonteComercialPostgres } from './comercial/fonte.js';
import { registrarComercial } from './comercial/rotas.js';
import { FonteDesempenhoMemoria, FonteDesempenhoPostgres } from './desempenho/fonte.js';
import { registrarDesempenho } from './desempenho/rotas.js';
import { ArmazemPlanosMemoria, ArmazemPlanosPostgres } from './planos/armazem.js';
import { anotadorDe, comPorteiro, medirCliente, porteiroDe, type Anotar, type PorteiroCliente } from './planos/medidor.js';
import { PagamentoManual } from './planos/pagamento.js';
import { Planos } from './planos/porteiro.js';
import { registrarPlanos } from './planos/rotas.js';
import { Followup } from './followup/followup.js';
import { ArmazemFollowupMemoria, ArmazemFollowupPostgres } from './followup/armazem.js';
import { registrarFollowup } from './followup/rotas.js';

const cfg = lerConfig();
const log = (msg: string, extra?: unknown) => console.log(new Date().toISOString(), msg, extra ?? '');

// A chave da IA pode chegar depois (tela de Conexões): o agente usa sempre o cliente em vigor.
let claudeAtual = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY || 'sem-chave' });
// Cada chamada à IA tem o uso (tokens, custo, créditos) medido e passa pelo porteiro do plano (src/planos):
// no Essencial ou com limite estourado sem crédito, nenhuma chamada sai (agente, copiloto, relatórios, comandos).
let anotarUso: Anotar = () => {};
let porteiroIa: PorteiroCliente = async () => ({ pode: true });
const claude = medirCliente(new Proxy({} as Anthropic, { get: (_alvo, prop) => Reflect.get(claudeAtual, prop) }), (r) => anotarUso(r), () => porteiroIa());
const trinks = new ClienteTrinks({ apiKey: cfg.TRINKS_API_KEY ?? '', intervaloMs: cfg.TRINKS_INTERVALO_MS });
// Sistema de agenda de cada unidade, lido das Conexões a cada uso (vale o que está na tela agora;
// `conexoes` é criada mais abaixo e só é lida depois, quando alguém usa a agenda).
const agendas = new AgendasDasUnidades({ ler: (campo) => conexoes.get(campo as Parameters<typeof conexoes.get>[0]), trinks, intervaloMs: cfg.TRINKS_INTERVALO_MS });
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

// Plano da IA: medição de uso e porteiro. A conta original (SINTONIA_PLANO_FUNDADOR, padrão "imperio") fica no Fundador.
const planos = new Planos({
  armazem: pool ? new ArmazemPlanosPostgres(pool) : new ArmazemPlanosMemoria(),
  fundadoras: (process.env.SINTONIA_PLANO_FUNDADOR ?? 'imperio').split(',').map((x) => x.trim()).filter(Boolean),
  log,
});
anotarUso = anotadorDe(planos, cfg.SINTONIA_EMPRESA_ID);
porteiroIa = porteiroDe(planos, cfg.SINTONIA_EMPRESA_ID);

// Empresa (nome e configuração da IA), tags e base de conhecimento: no banco, valendo sem reiniciar.
const empresa = new Empresa(pool ? new ArmazemEmpresaPostgres(pool) : new ArmazemEmpresaMemoria(), cfg.SINTONIA_EMPRESA_ID, 'Império Progressivas');
const armazemTags = pool ? new ArmazemTagsPostgres(pool) : new ArmazemTagsMemoria(() => repo.listarConversas());
const tags = new Tags(armazemTags, cfg.SINTONIA_EMPRESA_ID);
const tagsDaIa = new TagsDaIa(tags, async () => (await empresa.configIa()).marcarTags);
// Na primeira vez (banco vazio) a base nasce do knowledge/imperio.md; depois vale a do banco.
const base = new BaseConhecimento(pool ? new ArmazemBasePostgres(pool) : new ArmazemBaseMemoria(), cfg.SINTONIA_EMPRESA_ID, () => carregarBase());
await base.garantirSemente().catch((e) => log('Falha ao preparar a base de conhecimento', String(e)));
const agente = new Agente(claude, agendas, () => base.texto(), { modelo: cfg.SINTONIA_MODELO, esforco: cfg.SINTONIA_ESFORCO });

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
/** Número real de WhatsApp (nem o de teste, nem Messenger/Instagram/TikTok). */
const ehReal = (n: NumeroConectado) => !ehCanalTeste(n.canalId) && !ehCanalSocial(n.canalId);
const canaisSociais = new Map<string, { chave: string; canal: CanalWhatsApp }>();
let iaLigada = false;
let agendaLigada = false;
const ESTABELECIMENTO_PADRAO = { norte: UNIDADES.norte.trinksEstabelecimentoId, sumare: UNIDADES.sumare.trinksEstabelecimentoId };

function aplicarConexoes() {
  const chaveIA = conexoes.get('anthropicApiKey');
  claudeAtual = new Anthropic({ apiKey: chaveIA || 'sem-chave' });
  iaLigada = Boolean(chaveIA);
  trinks.definirChave(conexoes.get('trinksApiKey') ?? '');
  // ID do estabelecimento de cada unidade: o da tela de Conexões vale por cima do padrão.
  for (const [u, campo] of [['norte', 'trinksEstabelecimentoNorte'], ['sumare', 'trinksEstabelecimentoSumare']] as const) {
    UNIDADES[u].trinksEstabelecimentoId = conexoes.get(campo) || ESTABELECIMENTO_PADRAO[u];
  }
  // Cada unidade usa o sistema escolhido em Conexões › Agenda (Trinks, Avec, AppBarber ou nenhum).
  agendaLigada = agendas.algumaPronta();
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
  // Facebook Messenger e Instagram Direct: entram depois (o número de WhatsApp de cada unidade continua sendo o primeiro).
  const sociais = numerosSociais(conexoes, canaisSociais);
  lista.push(...sociais);
  numeros.splice(0, numeros.length, ...lista);
  log(`Conexões aplicadas: IA ${iaLigada ? 'ligada' : 'desligada'}, agenda ${agendaLigada ? 'ligada' : 'desligada'}, ${lista.filter(ehReal).length} número(s) de WhatsApp${sociais.length ? `, ${sociais.map((n) => n.canal.tipo).join(' e ')}` : ''}.`);
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
  // Cliente esperando: sem alerta enquanto um bot ou um follow-up conduz a conversa (criados mais abaixo).
  automacaoAtiva: async (id) => (await armazemBots.ativasDaConversa(id)).length > 0 || Boolean((await followup.seloDaConversa(id)).cadencia),
  log,
});
observarEventos(repo, (e) => notificador.aoEvento(e));
await chavesPush.obter().catch((e) => log('Falha ao preparar as chaves do push', String(e)));

const destinosRelatorio = () => (conexoes.destinosRelatorio().length ? conexoes.destinosRelatorio() : cfg.destinosRelatorio);

// Fotos, áudios, vídeos e documentos recebidos: baixados à parte, sem segurar o texto.
const midias = new Midias(repo, (canalId) => numeros.find((n) => n.canalId === canalId)?.canal, undefined, log);

// Fichas (contatos) e respostas rápidas (também usadas pela demonstração).
const armazemContatos = pool ? new ContatosPostgres(pool) : new ContatosMemoria();
const armazemRespostas = pool ? new RespostasPostgres(pool) : new RespostasMemoria();
// Dados de demonstração (Mais › Dados de demonstração): registro do que foi criado, para apagar só isso.
const armazemDemo: ArmazemDemo = pool
  ? new ArmazemDemoPostgres(pool)
  : new ArmazemDemoMemoria({
      repo: repo as RepositorioMemoria,
      tags: armazemTags as ArmazemTagsMemoria,
      contatos: armazemContatos as ContatosMemoria,
      contas: contas as ContasMemoria,
      notificacoes: armazemNotificacoes as ArmazemNotificacoesMemoria,
    });

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
const armazemAutomacoes = pool
  ? new ArmazemAutomacoesPostgres(pool)
  : new ArmazemAutomacoesMemoria(armazemTags, (id) => (armazemDemo as ArmazemDemoMemoria).ehConversaDemo(id));
const automacoes = new Automacoes({
  email,
  calendario: pool ? calendarioPostgres(pool, cfg.SINTONIA_EMPRESA_ID) : undefined,
  armazem: armazemAutomacoes,
  repo,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  sintonia: () => sintonia,
  funis,
  tags,
  contas,
  log,
  transmissoes: () => transmissoes,
});
// Construtor de bots (fluxos em grafo): por cima dos ganchos de funis/automações; o bot responde antes da IA.
const armazemBots = pool ? new ArmazemBotsPostgres(pool) : new ArmazemBotsMemoria();
const bots = new Bots({
  armazem: armazemBots,
  repo,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  sintonia: () => sintonia,
  funis,
  tags,
  contas,
  contatos: armazemContatos,
  envios: armazemAutomacoes,
  log,
});
const ganchosBase = ligarBots(ligarFunis({ tags, funis, automacoes }), { bots, funis, tags });
// Transmissões (disparo em massa): só com Postgres. Criadas depois da Sintonia; os ganchos as chamam quando existirem.
let transmissoes: Transmissoes | undefined;
// Follow-up configurável e confirmação automática de agenda (src/followup): ouve os eventos, envia pelo relógio.
const followup = new Followup({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  armazem: pool ? new ArmazemFollowupPostgres(pool) : new ArmazemFollowupMemoria(),
  repo,
  sintonia: () => sintonia,
  agente: { executar: (p) => agentesIa.agente.executar(p) },
  iaDisponivel: () => iaLigada,
  email,
  tags,
  log,
});
observarEventos(repo, (e) => followup.aoEvento(e));
const ganchos: typeof ganchosBase = {
  ...ganchosBase,
  mensagemCliente: async (c, m) => {
    await ganchosBase.mensagemCliente?.(c, m);
    await followup.mensagemCliente(c, m).catch((e) => log('Falha no follow-up (resposta da cliente)', String(e)));
    await transmissoes?.mensagemCliente(c, m).catch((e) => log('Falha nas respostas das transmissões', String(e)));
  },
};
funis.aoMover(async (m) => {
  await transmissoes?.aoMover(m).catch((e) => log('Falha no gatilho das transmissões', String(e)));
});
tags.aoMarcar(async (c, tag) => {
  await transmissoes?.aoMarcarTag(c, tag).catch((e) => log('Falha no gatilho das transmissões', String(e)));
});
// Funil do sistema "Atendimento" e toda conversa nele, na etapa em que está.
await funis.sincronizarSistema().then((n) => n && log(`Funil do sistema: ${n} conversa(s) sincronizada(s)`)).catch((e) => log('Falha ao sincronizar o funil do sistema', String(e)));

// Rastreamento de leads (origem: anúncio, link rastreado) e API de Conversões da Meta.
const armazemRastreio = pool ? new ArmazemRastreioPostgres(pool) : new ArmazemRastreioMemoria();
const capi = new Capi({
  armazem: armazemRastreio,
  config: () => configCapiDe(conexoes),
  buscarConversa: (id) => repo.buscarConversa(id),
  wabaDaUnidade: (u) => conexoes.contaMeta(u)?.wabaId,
  ficha: async (c) => {
    const k = await armazemContatos.obter(cfg.SINTONIA_EMPRESA_ID, c.telefone);
    if (!k) return {};
    const campos = await armazemContatos.campos(cfg.SINTONIA_EMPRESA_ID);
    const campoValor = campos.find((x) => x.tipo === 'numero' && /valor/i.test(x.nome));
    const valor = campoValor ? Number(k.campos[campoValor.id]) : NaN;
    return { email: k.email ?? undefined, ...(Number.isFinite(valor) && valor > 0 ? { valor } : {}) };
  },
  log,
});
observarEventos(repo, (e) => capi.aoEvento(e));
const rastreio = new Rastreio({
  armazem: armazemRastreio,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  capi,
  graph: () => ({ token: conexoes.get('metaAdsToken') ?? conexoes.get('capiToken'), versao: configCapiDe(conexoes).versao }),
  log,
});
// Estúdio de agentes de IA e "IA atende primeiro" (src/agentes-ia). Desligado, tudo segue com o agente de sempre.
const agentesIa = montarAgentesIa({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  pool,
  repo,
  cofre,
  agenda: agendas,
  baseGeral: () => base.texto(),
  padrao: agente,
  chaveGeral: (p) => (p === 'openai' ? conexoes.get('openaiApiKey') : conexoes.get('anthropicApiKey')) || undefined,
  claudeGeral: claude,
  claudeComChave: (chave) => medirCliente(new Anthropic({ apiKey: chave }), (r) => anotarUso(r), () => porteiroIa()),
  // Agentes do estúdio na OpenAI: também medidos e com porteiro.
  embrulhar: (c) => medirCliente(c, (r) => anotarUso(r), () => porteiroIa()),
  sintonia: () => sintonia,
  tags: tagsParaAgentes(tags, repo),
  moverEtapa: moverEtapaPara({ funis, armazemTags, empresaId: cfg.SINTONIA_EMPRESA_ID, repo, comConversa: (id, fn) => sintonia.comConversa(id, fn) }),
  modeloComandos: cfg.SINTONIA_MODELO,
  log,
});
// Correções da equipe às sugestões viram aprendizados para a gestão aprovar.
observarEventos(repo, (e) => void agentesIa.controle.aoEvento(e));

const sintonia = new Sintonia({
  rastreio,
  ganchos,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  repo,
  numeros,
  // Porteiro do plano da IA: sem plano, fora da janela ou sem cota, a conversa fica para a equipe.
  agente: comPorteiro(agentesIa.agente, { planos, empresaId: cfg.SINTONIA_EMPRESA_ID, log }),
  modoInicial: agentesIa.modoInicial,
  log,
  trava,
  midias,
  configIa: async () => regrasDaConfig(await empresa.configIa()),
  tagsIa: tagsDaIa,
  motor: (c) => followup.motor(c),
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
  auth: { contas, cookieSeguro: cfg.COOKIE_SEGURO === '1', ...(email ? { recuperacao: recuperacaoPorEmail(email, log) } : {}) },
  fila: { fila, avisar: () => trabalhador.avisar() },
  contatos: { armazem: armazemContatos, empresaId: cfg.SINTONIA_EMPRESA_ID },
  get agenda() {
    return agendaLigada ? agendas : undefined;
  },
  get evolution() {
    return { canal: evolution, token: conexoes.get('webhookToken') };
  },
  conexoes: {
    conexoes,
    agendas,
    testarIA: async (chave) => {
      await new Anthropic({ apiKey: chave }).models.list({ limit: 1 });
    },
    testarOpenAI: async (chave) => {
      const r = await fetch('https://api.openai.com/v1/models/whisper-1', { headers: { authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(r.status === 401 ? 'Chave recusada pela OpenAI' : `OpenAI respondeu ${r.status}`);
    },
    testarTrinks: async (chave) => {
      const t = new ClienteTrinks({ apiKey: chave });
      const partes: string[] = [];
      let falhas = 0;
      for (const u of ['norte', 'sumare'] as const) {
        const est = UNIDADES[u].trinksEstabelecimentoId;
        if (!est) { partes.push(`${UNIDADES[u].nome}: sem ID do estabelecimento`); continue; }
        try { partes.push(`${UNIDADES[u].nome}: ${(await t.listarProfissionais(est)).length} profissionais`); }
        catch (e) { falhas++; partes.push(`${UNIDADES[u].nome}: ${String((e as Error).message).slice(0, 80)}`); }
      }
      if (falhas && falhas === partes.length) throw new Error(partes.join(' · '));
      return { resumo: partes.join(' · ') };
    },
  },
  get meta() {
    // Lido a cada webhook: vale o que está na tela agora.
    return opcoesWebhookMeta(
      conexoes,
      { verifyToken: cfg.META_VERIFY_TOKEN, appSecret: cfg.META_APP_SECRET, temNumerosMeta: Boolean(meta) && cfg.numeros.some((n) => n.canal === 'meta') },
      async (lista) => {
        const n = await sintonia.statusRecebidos(lista);
        await transmissoes?.statusRecebidos(lista).catch((e) => log('Falha nos avisos de entrega das transmissões', String(e)));
        return n;
      },
    );
  },
  sociais: {
    conexoes,
    canalDe: (canalId) => numeros.find((n) => n.canalId === canalId)?.canal,
    // Esqueleto: o lead do TikTok fica no log até existir a tela de leads de formulário.
    aoLeadTikTok: async (leads, unidade) => {
      for (const l of leads) log(`Lead do TikTok recebido (${unidade})`, { leadId: l.leadId, adId: l.adId, temTelefone: Boolean(l.telefone), temEmail: Boolean(l.email) });
    },
  },
  origens: (ids) => rastreio.selos(ids),
  fotos: new Fotos(repo, (canalId) => numeros.find((n) => n.canalId === canalId)?.canal, undefined, log),
  situacao: () => ({
    iaLigada,
    agendaLigada,
    numerosReais: numeros.filter(ehReal).length,
    // Canais para "Novo contato": quais estão conectados (Instagram e Messenger só respondem quem chamou).
    canais: {
      whatsapp: numeros.some((n) => !ehCanalSocial(n.canalId)),
      instagram: Boolean(contaDaRede(conexoes, 'instagram')),
      messenger: Boolean(contaDaRede(conexoes, 'messenger')),
      tiktok: conexoes.get('tiktokLigado') === 'sim' || conexoes.get('tiktokLigado') === 'true',
    },
    agenda: {
      chave: Boolean(conexoes.get('trinksApiKey')),
      unidades: UNIDADES_AGENDA.map((u) => {
        const a = agendas.config(u);
        return { id: u, nome: a.nome, estabelecimento: Boolean(a.local), sistema: a.escolha, sistemaNome: a.sistemaNome, falta: a.aviso && !a.falta.length ? [a.aviso] : a.falta, pronta: a.pronta };
      }),
    },
  }),
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
  clienteTeste: async ({ unidade, nome, telefone, texto, midia, anuncio }) => {
    const canalId = canalTesteDa(unidade);
    const agora = new Date();
    // Sem a chave da IA, a conversa de teste nasce em "Só eu" para a IA não ficar tentando responder.
    const { conversa, nova } = await repo.buscarOuCriarConversa({ empresaId: cfg.SINTONIA_EMPRESA_ID, unidade, canalId, telefone, nome, agora });
    if (nova) {
      // A conversa foi criada aqui (para nascer no modo certo): registra a chegada da cliente como num número real.
      await repo.registrarEvento({ tipo: 'conversa_nova', conversaId: conversa.id, unidade, em: agora });
      const inicial = await agentesIa.modoInicial(conversa, agora);
      await sintonia.mudarModo(conversa.id, inicial ?? (iaLigada ? (await empresa.configIa()).modoPadrao : 'humano'));
    }
    // Mídia de teste: chega como se viesse do WhatsApp, já com o arquivo (o canal de teste não baixa nada).
    const tipo = midia ? tipoPeloMimetype(midia.mimetype) : undefined;
    const anexo = midia && tipo
      ? { tipo, mimetype: midia.mimetype, nomeArquivo: tipo === 'documento' ? (midia.nomeArquivo ?? 'arquivo') : undefined, duracaoSeg: midia.duracaoSeg, legenda: texto, voz: tipo === 'audio' || undefined, base64: midia.base64 }
      : undefined;
    const conteudo = anexo ? textoDoAnexo(anexo.tipo, texto, anexo.nomeArquivo) : (texto ?? '');
    // Anúncio de teste: chega como um clique em anúncio de clique para WhatsApp.
    const referencia = anuncio ? { via: 'meta' as const, tipo: 'ad', adId: anuncio.adId, titulo: anuncio.titulo, texto: anuncio.texto, url: anuncio.url, miniaturaUrl: anuncio.miniaturaUrl, ctwaClid: anuncio.ctwaClid ?? `teste-${randomUUID()}`, app: 'instagram' } : undefined;
    await sintonia.receber({ canalId, telefone, nome, texto: conteudo, deMim: false, idExterno: `teste-${randomUUID()}`, em: agora, ...(anexo ? { anexo } : {}), ...(referencia ? { referencia } : {}) });
  },
  revisar: async (conversaId, rascunho) => {
    const conversa = await repo.buscarConversa(conversaId);
    if (!conversa) throw new Error('Conversa não encontrada');
    const servicos = await Promise.resolve()
      .then(() => { const a = agendas.paraUnidade(conversa.unidade); return a.sistema.listarServicos(a.local); })
      .catch(() => []);
    return revisarRascunho(
      claude,
      { modelo: cfg.SINTONIA_MODELO, baseConhecimento: await base.texto() },
      { conversa, mensagens: await repo.mensagens(conversaId), rascunho, servicos, agora: new Date() },
    );
  },
});

// Estúdio de agentes de IA (/api/agentes-ia) e "Peça para a IA" (/api/ia/comando).
// O construtor de bot usa agentesIa.executarAgente(agenteIaId, conversa, objetivo).
agentesIa.registrar(app, { tagsDaIa: () => tagsDaIa.nomes() });

// Rotas dos funis e das automações (depois de criarServidor: valem o login e o tratamento de erros de lá).
registrarFunis(app, { repo, funis, automacoes, origens: (ids) => rastreio.selos(ids) });
registrarBots(app, { repo, bots });
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
// Comercial: metas individuais, comissão, ranking, serviços mais agendados e o Painel na TV (/tv/:token).
const armazemComercial = pool ? new ArmazemComercialPostgres(pool) : new ArmazemComercialMemoria();
registrarComercial(app, {
  armazem: armazemComercial,
  fonte: pool ? new FonteComercialPostgres(pool) : new FonteComercialMemoria(repo),
  contas,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  agora: () => new Date(),
  unidades: ['norte', 'sumare'],
  metaMesAntiga: async () => (await empresa.meta()).agendamentosMes ?? null,
  nomeEmpresa: async () => (await empresa.dados()).nome,
});
// Desempenho do atendimento (visão do dono): tempos, expediente, o que ficou para trás e a fila de agora.
registrarDesempenho(app, {
  fonte: pool ? new FonteDesempenhoPostgres(pool) : new FonteDesempenhoMemoria(repo),
  armazem: armazemComercial,
  contas,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  unidades: ['norte', 'sumare'],
  agora: () => new Date(),
});
// Plano e uso da IA (Mais › Plano e uso da IA): cota, uso, pedidos e o comparativo IA × atendente.
registrarPlanos(app, {
  planos,
  pagamento: new PagamentoManual(),
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  agora: () => new Date(),
  fonte: pool ? new FonteDesempenhoPostgres(pool) : new FonteDesempenhoMemoria(repo),
  armazemComercial,
  contas,
});
// Links rastreados (/l/:codigo), origem na ficha, selos e API de Conversões.
registrarRastreio(app, { repo, rastreio, capi, conexoes, empresaId: cfg.SINTONIA_EMPRESA_ID });

// Transmissões: campanhas, público, modelos da Meta e a fila de envio com ritmo por número.
if (pool) {
  transmissoes = new Transmissoes({
    pool,
    empresaId: cfg.SINTONIA_EMPRESA_ID,
    repo,
    sintonia: () => sintonia,
    numeros: () => numeros,
    tags,
    contatos: armazemContatos,
    leads: extras.leads,
    contaMeta: (u) => conexoes.contaMeta(u),
    modoInicial: async () => (iaLigada ? (await empresa.configIa()).modoPadrao : 'humano'),
    log,
  });
  registrarTransmissoes(app, {
    transmissoes,
    simularResposta: async ({ unidade, telefone, nome, texto }) => {
      await sintonia.receber({ canalId: canalTesteDa(unidade), telefone, nome, texto, deMim: false, idExterno: `teste-${randomUUID()}`, em: new Date() });
    },
  });
}

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
  respostas: armazemRespostas,
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

// Dados de demonstração: só administração e direção (src/demo/rotas.ts).
const demo = new Demo({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  armazem: armazemDemo,
  contas,
  tags,
  armazemTags,
  funis,
  contatos: armazemContatos,
  respostas: armazemRespostas,
  automacoes,
  notificacoes: armazemNotificacoes,
  empresa,
  segmento: process.env.DEMO_SEGMENTO === 'estetica' ? 'estetica' : undefined,
  log,
});
registrarDemo(app, demo);
registrarFollowup(app, { followup, repo });

// Relógio: reavaliações, lembretes e follow-ups a cada 30 s; relatório às 20h.
let relatorioEnviadoEm = '';
const relogio = setInterval(async () => {
  await sintonia.tick().catch((e) => log('Falha no relógio', String(e)));
  await agentesIa.controle.tick().catch((e) => log('Falha no relógio dos agentes de IA', String(e))); // volta para a IA
  await automacoes.tick().catch((e) => log('Falha no relógio das automações', String(e))); // "esperar", fora do horário, parada na etapa
  await bots.tick().catch((e) => log('Falha no relógio dos bots', String(e))); // esperas, tempo limite das respostas, agente de IA
  await notificador.tick().catch((e) => log('Falha no relógio das notificações', String(e))); // lembretes que venceram, cliente esperando
  midias.avisar(); // novas tentativas de download que já venceram
  await capi.tick().catch((e) => log('Falha no relógio da CAPI', String(e))); // eventos da API de Conversões
  await rastreio.tick().catch((e) => log('Falha ao buscar nomes de anúncios', String(e)));
  await followup.tick().catch((e) => log('Falha no relógio do follow-up', String(e))); // cadências e confirmações de agenda
  const agora = new Date();
  const p = partesBahia(agora);
  const real = numeros.find(ehReal);
  if (p.hora === 20 && relatorioEnviadoEm !== dataISO(agora) && real) {
    relatorioEnviadoEm = dataISO(agora);
    // As conversas de demonstração não entram no relatório que sai pelo WhatsApp.
    const texto = await sintonia.relatorioDoDia(agora, undefined, await demo.conversasDemo().catch(() => undefined));
    for (const destino of destinosRelatorio()) {
      await real.canal.enviarTexto(real.canalId, destino, texto).catch((e) => log('Falha no relatório', String(e)));
    }
  }
}, 30_000);

// Fila das transmissões: a cada 2 s (o ritmo de cada número decide quantas saem).
const relogioTransmissoes = setInterval(() => {
  transmissoes?.tick().catch((e) => log('Falha no relógio das transmissões', String(e)));
}, 2_000);

trabalhador.iniciar();
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });

// Desligamento limpo: para de aceitar, termina o que está em andamento, fecha o banco.
// Se cair de vez, nada se perde: as mensagens reservadas voltam para a fila quando a reserva vence.
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, async () => {
    log(`Recebido ${sinal}: encerrando`);
    clearInterval(relogio);
    clearInterval(relogioTransmissoes);
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
