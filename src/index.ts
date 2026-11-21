import { LeiturasMemoria, LeiturasPostgres } from './app/leituras.js';
import { ConversasPessoaisMemoria, ConversasPessoaisPostgres } from './conversa/pessoal.js'; /* conversa-extra */
import { LayoutsPainelMemoria, LayoutsPainelPostgres } from './painel/layout.js';
import { PresencasMemoria, PresencasPostgres } from './presenca/presenca.js';
import Anthropic from '@anthropic-ai/sdk';
import { lerChaveDeArquivo, lerConfig } from './config.js';
import { ClienteTrinks } from './agenda/trinks.js';
import { AgendasDasUnidades, unidadesAgenda } from './agenda/unidades-agenda.js';
import { AgendaExterna } from './agenda/agenda-externa.js';
import { Agente } from './ai/agente.js';
/* ia-completa: a IA faz tudo (CRM, remarcar/cancelar, ouvir/ver), com travas de segurança e a tela de estado */
import { ArmazemTarefasIaMemoria, ArmazemTarefasIaPostgres, montarCrmIa } from './ai/crm-ia.js';
import { GuardaCusto } from './ai/guarda.js';
import { registrarEstadoIa } from './ai/estado-ia.js';
import { PercepcaoIa } from './app/percepcao.js';
import { ArmazemCoberturaMemoria, ArmazemCoberturaPostgres, CoberturaIa } from './presenca/cobertura.js';
import { randomUUID } from 'node:crypto';
import { Fotos } from './app/fotos.js';
import { ArmazemMemoria, ArmazemPostgres, Conexoes } from './conexoes/conexoes.js';
import { Cofre } from './conexoes/cofre.js';
import { ContatosMemoria, ContatosPostgres } from './contatos/contatos.js';
import { Midias } from './app/midias.js';
import { textoDoAnexo, tipoPeloMimetype } from './midia.js';
import { CanalTeste, canalTesteDa, ehCanalTeste } from './channels/teste.js';
import { revisarRascunho } from './ai/copiloto.js';
import { carregarBaseDa } from './ai/prompt.js';
import { Sintonia, type NumeroConectado } from './app/sintonia.js';
import { CanalEvolution } from './channels/evolution.js';
import { EvolutionAdmin } from './channels/evolution-admin.js';
import { ArmazemSaudeMemoria, ArmazemSaudePostgres, SaudeWhatsApp } from './channels/whatsapp-saude.js';
import { CanalMeta } from './channels/meta.js';
import { canaisEvolution, numerosDasConexoes, opcoesWebhookMeta } from './conexoes/numeros.js';
import { contaDaRede, numerosSociais } from './conexoes/sociais.js';
import { ArmazemChamadasMemoria, ArmazemChamadasPostgres } from './ligacoes/chamadas.js';
import { ehCanalSocial } from './channels/meta-social.js';
import type { CanalWhatsApp } from './channels/tipos.js';
import { criarServidor } from './server.js';
import { AuditoriaMemoria, AuditoriaPostgres } from './seguranca/auditoria.js'; /* banco-seguranca */
import { DadosCliente } from './seguranca/dados-cliente.js'; /* banco-seguranca */
import { modoCsp } from './seguranca/protecao.js'; /* banco-seguranca */
import { ArmazemGruposMemoria, ArmazemGruposPostgres } from './grupos/armazem.js';
import { Grupos } from './grupos/grupos.js';
import { registrarGrupos } from './grupos/rotas.js';
import pg from 'pg';
import { migrar } from './store/migrar.js';
import { RepositorioPostgres } from './store/postgres.js';
import { RepositorioMemoria, type Repositorio } from './store/repositorio.js';
import { FilaMemoria, FilaPostgres, type FilaEntrada } from './fila/entrada.js';
import { Trabalhador } from './fila/trabalhador.js';
import { TravaMemoria, TravaPostgres, type Trava } from './fila/trava.js';
import { FilaComReserva } from './fila/reserva.js';
import { umaPorVez } from './util/relogio.js';
import { FilaIa } from './app/fila-ia.js';
import { FilaHistoricoPostgres, ImportadorHistorico } from './app/historico.js';
import { acessosPara } from './auth/acessos.js';
import { resolver as resolverPermissoes } from './auth/permissoes.js';
import { criarPool, esperarBanco, ehErroDeConexao } from './store/banco.js';
import { homedir } from 'node:os';
import path from 'node:path';
import { ContasMemoria, ContasPostgres, type Contas } from './auth/contas.js';
import { gerarHash, senhaFraca } from './auth/senha.js';
import { definirAgendaDasUnidades, definirEmpresaPadrao, EMPRESA_IMPERIO, idsUnidades, UNIDADE_INICIAL, UNIDADES_IMPERIO, unidadeDe } from './unidades.js';
import { definirEmpresaPadraoIdentidade, IDENTIDADE_IMPERIO } from './empresa/identidade.js';
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
import { fontesDoBanco, funisComEtapas } from './serena/acoes.js';
import { RespostasMemoria, RespostasPostgres } from './conversa/respostas.js';
import { FluxosMemoria, FluxosPostgres, MotorFluxos } from './conversa/fluxos.js';
import { registrarFluxos } from './conversa/fluxos-rotas.js';
import { TranscricoesMemoria, TranscricoesPostgres, TranscritorComReserva, TranscritorLocal, TranscritorOpenAI } from './conversa/transcricao.js';
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
import { FonteCriativosMemoria, FonteCriativosPostgres } from './rastreio/criativos.js';
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
import { FonteAnalisesMemoria, FonteAnalisesPostgres } from './analises/fonte.js';
import { OrigensConversa } from './analises/origens.js';
import { registrarAnalises } from './analises/rotas.js';
/* relatorio-dia */
import { agendamentosEntre } from './agenda/agenda-dia.js';
import { ArmazemEnvioRelatorioMemoria, ArmazemEnvioRelatorioPostgres } from './relatorio-dia/envio.js';
import { FonteRelatorioDiaMemoria, FonteRelatorioDiaPostgres } from './relatorio-dia/fonte.js';
import { registrarRelatorioDia } from './relatorio-dia/rotas.js';
import { RelatorioDia } from './relatorio-dia/servico.js';
/* perdas-saude: motivo de perda obrigatório, relatório de perdas e painel de saúde da gestão */
import { Perdas } from './perdas/perdas.js';
import { ArmazemPerdasMemoria, ArmazemPerdasPostgres } from './perdas/armazem.js';
import { registrarPerdas } from './perdas/rotas.js';
import { FonteSaudeMemoria, FonteSaudePostgres, PainelSaude } from './saude/painel.js';
import { registrarSaude } from './saude/rotas.js';
import type { BloqueioConta } from './auth/limite-login.js';
import type { Usuario } from './auth/contas.js';
import { ArmazemPlanosMemoria, ArmazemPlanosPostgres } from './planos/armazem.js';
import { anotadorDe, comPorteiro, medirCliente, porteiroDe, type Anotar, type PorteiroCliente } from './planos/medidor.js';
import { Planos } from './planos/porteiro.js';
import { contatoDoAmbiente, registrarPublico } from './publico/publico.js'; /* sem-pagamento */
import { Followup } from './followup/followup.js';
import { ArmazemFollowupMemoria, ArmazemFollowupPostgres } from './followup/armazem.js';
import { registrarFollowup } from './followup/rotas.js';
/* nps-posvenda: finalizar atendimento, pesquisa de satisfação (NPS) e modelos prontos de automação */
import { Nps } from './nps/nps.js';
import { ArmazemNpsMemoria, ArmazemNpsPostgres } from './nps/armazem.js';
import { registrarNps } from './nps/rotas.js';
import { Radar } from './radar/radar.js';
import { ArmazemRadarMemoria, ArmazemRadarPostgres } from './radar/armazem.js';
import { juizClaude } from './radar/juiz.js';
import { registrarRadar } from './radar/rotas.js';
import { ArmazemRodizioMemoria, ArmazemRodizioPostgres, Rodizio } from './rodizio/rodizio.js'; // automacao-vendas
import { registrarRodizio } from './rodizio/rotas.js'; // automacao-vendas
import { registrarResgate } from './resgate/resgate.js';
import { NomesWhatsapp } from './contatos/nomes-whatsapp.js';
/* equipe: conversas de equipe (chat interno da empresa, sem WhatsApp) */
import { ArmazemEquipeMemoria, ArmazemEquipePostgres } from './equipe/armazem.js';
import { ChatEquipe } from './equipe/chat.js';
import { avisoPorPush, registrarChatEquipe } from './equipe/rotas.js';
/* msg-agendada: mensagens agendadas na conversa (src/agendadas) */
import { AgendadasMemoria, AgendadasPostgres, MotorAgendadas } from './agendadas/agendadas.js';
import { registrarAgendadas } from './agendadas/rotas.js';
/* empresa-conta: menu Empresa (dados, unidades, produtos e serviços, tabelas de preço, documentos) e Conta (perfil) */
import { ArmazemCadastroMemoria, ArmazemCadastroPostgres, horarioDeFaixas } from './empresa/cadastro.js';
import { registrarCadastro } from './empresa/cadastro-rotas.js';
import { ArmazemProdutosLeadMemoria, ArmazemProdutosLeadPostgres, ProdutosLead } from './empresa/lead-produtos.js';
import { registrarProdutosLead } from './empresa/lead-produtos-rotas.js';
import { precosDoCadastro } from './empresa/precos-comercial.js';
import { ArmazemPerfisMemoria, ArmazemPerfisPostgres, registrarConta, telefonesDosPerfis, trocarEmailMemoria, trocarEmailPostgres } from './conta/conta.js';
/* integracoes: área de desenvolvedores (chaves de API, API v1, webhooks de saída e MCP) */
import { ArmazemIntegracoesMemoria, ArmazemIntegracoesPostgres } from './integracoes/armazem.js';
import { montarIntegracoes } from './integracoes/rotas.js';
/* atendimento-extra: avisos do agendamento online (sino, WhatsApp para o contato e lembrete antes) */
import { AvisosReuniao } from './reunioes/avisos.js';

const cfg = lerConfig();
const log = (msg: string, extra?: unknown) => console.log(new Date().toISOString(), msg, extra ?? '');

/* robustez: um erro esquecido (promessa sem catch, conexão do banco que caiu) não derruba o app inteiro.
   Erro de conexão com o banco só é registrado (o pool reconecta); outro erro inesperado também fica no log,
   mas sem sair: o Docker só reinicia se o processo morrer, e reiniciar no meio do atendimento perde o que estava em memória. */
process.on('unhandledRejection', (e) => {
  if (ehErroDeConexao(e)) log('Banco fora do ar (tarefa em segundo plano); tentando de novo depois', String((e as Error)?.message ?? e));
  else log('Erro sem tratamento numa tarefa em segundo plano', e instanceof Error ? (e.stack ?? e.message) : String(e));
});
process.on('uncaughtException', (e) => {
  if (ehErroDeConexao(e)) {
    log('Conexão com o banco caiu; o app continua e reconecta sozinho', String(e?.message ?? e));
    return;
  }
  log('Erro inesperado; encerrando para o Docker religar', e?.stack ?? String(e));
  process.exit(1);
});

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
/* robustez: o banco pode reiniciar ou derrubar conexões sem derrubar o app (src/store/banco.ts). */
let poolTravas: pg.Pool | undefined;
let reservaEntrada: FilaComReserva | undefined;
if (cfg.DATABASE_URL) {
  pool = criarPool({ url: cfg.DATABASE_URL, max: 20, log });
  await esperarBanco(pool, log);
  const aplicadas = await migrar(pool);
  if (aplicadas.length) log('Migrações aplicadas', aplicadas);
  repo = new RepositorioPostgres(pool);
  // Banco fora: o webhook guarda a mensagem no disco e ela entra na fila quando o banco voltar (src/fila/reserva.ts).
  reservaEntrada = new FilaComReserva(new FilaPostgres(pool), process.env.SINTONIA_RESERVA_DIR || path.join(homedir(), 'sintonia-reserva'), log);
  fila = reservaEntrada;
  // Pool só das travas: cada conversa em atendimento segura uma conexão aqui, e o trabalho usa o pool principal.
  // Tamanho: conversas simultâneas da fila + da IA + tarefas do relógio + folga.
  poolTravas = criarPool({ url: cfg.DATABASE_URL, max: cfg.SINTONIA_PARALELO + cfg.SINTONIA_PARALELO_IA + 8, log, nome: 'banco (travas)' });
  trava = new TravaPostgres(poolTravas);
  contas = new ContasPostgres(pool);
} else {
  log('Aviso: DATABASE_URL ausente; dados em memória (somem ao reiniciar). Use só para teste local.');
  repo = new RepositorioMemoria();
  fila = new FilaMemoria();
  trava = new TravaMemoria();
  contas = new ContasMemoria();
}

// Empresa atendida por este servidor: as unidades e a identidade (nome, segmento, cidade) vêm do cadastro dela.
definirEmpresaPadrao(cfg.SINTONIA_EMPRESA_ID);
definirEmpresaPadraoIdentidade(cfg.SINTONIA_EMPRESA_ID);

// Plano da IA: medição de uso e porteiro. A conta original (SINTONIA_PLANO_FUNDADOR, padrão "imperio") fica no Fundador.
const planos = new Planos({
  armazem: pool ? new ArmazemPlanosPostgres(pool) : new ArmazemPlanosMemoria(),
  fundadoras: (process.env.SINTONIA_PLANO_FUNDADOR ?? 'imperio').split(',').map((x) => x.trim()).filter(Boolean),
  log,
});
/* ia-completa: limite de uso da IA por conversa por dia (SINTONIA_IA_LIMITE_CONVERSA; 0 = sem limite). */
const guardaCusto = new GuardaCusto(Number(process.env.SINTONIA_IA_LIMITE_CONVERSA ?? 600_000) || 0);
const anotarPlano = anotadorDe(planos, cfg.SINTONIA_EMPRESA_ID);
anotarUso = (r) => {
  anotarPlano(r);
  guardaCusto.anotar(r.conversaId, r.uso);
};
porteiroIa = porteiroDe(planos, cfg.SINTONIA_EMPRESA_ID);

// Empresa (nome e configuração da IA), tags e base de conhecimento: no banco, valendo sem reiniciar.
const empresa = new Empresa(pool ? new ArmazemEmpresaPostgres(pool) : new ArmazemEmpresaMemoria(), cfg.SINTONIA_EMPRESA_ID, cfg.SINTONIA_EMPRESA_ID === EMPRESA_IMPERIO ? IDENTIDADE_IMPERIO.nome : 'Minha empresa');
const armazemTags = pool ? new ArmazemTagsPostgres(pool) : new ArmazemTagsMemoria(() => repo.listarConversas());
const tags = new Tags(armazemTags, cfg.SINTONIA_EMPRESA_ID);
const tagsDaIa = new TagsDaIa(tags, async () => (await empresa.configIa()).marcarTags);
// Na primeira vez (banco vazio) a base nasce do knowledge/imperio.md; depois vale a do banco.
const base = new BaseConhecimento(pool ? new ArmazemBasePostgres(pool) : new ArmazemBaseMemoria(), cfg.SINTONIA_EMPRESA_ID, () => carregarBaseDa(cfg.SINTONIA_EMPRESA_ID));
await base.garantirSemente().catch((e) => log('Falha ao preparar a base de conhecimento', String(e)));
const agente = new Agente(claude, agendas, () => base.texto(), {
  modelo: cfg.SINTONIA_MODELO,
  esforco: cfg.SINTONIA_ESFORCO,
  /* produtos-lead: a IA sabe o que a equipe vinculou ao lead */
  produtosDoLead: (c) => produtosLead.textoParaIa(c),
  /* ia-completa: pipelines, produtos e arquivos (lidos na hora; criados mais abaixo) */
  crm: () => crmIa,
});

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
/* robustez: chave própria do cofre (SINTONIA_COFRE_CHAVE ou SINTONIA_COFRE_CHAVE_ARQUIVO), sem perder o que já foi
   gravado: a chave antiga (tirada do endereço do banco) continua valendo só para LER. Sem a chave nova, tudo como antes.
   Plano completo em docs/SEGURANCA-SERVIDOR.md ("Chave do cofre"). */
const chaveAntigaCofre = process.env.SINTONIA_SEGREDO || cfg.DATABASE_URL || 'sintonia-local';
const chaveNovaCofre = process.env.SINTONIA_COFRE_CHAVE || lerChaveDeArquivo(process.env.SINTONIA_COFRE_CHAVE_ARQUIVO);
const cofre = chaveNovaCofre ? new Cofre(chaveNovaCofre, [chaveAntigaCofre]) : new Cofre(chaveAntigaCofre);
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
// Estabelecimento do Trinks e se a unidade agenda: lido de Conexões › Agenda (vale o que está na tela agora).
definirAgendaDasUnidades((id) => {
  const a = agendas.config(id);
  return { trinksEstabelecimentoId: a.escolha === 'trinks' ? a.local : null, agendaAberta: a.escolha !== 'nenhum' };
});

/* robustez: chave da IA trocada em Conexões tira a pausa de 15 min depois de um 401 (ligado quando a Sintonia existir). */
let aoTrocarChaveIa: () => void = () => {};
let chaveIaAplicada: string | undefined;
function aplicarConexoes() {
  const chaveIA = conexoes.get('anthropicApiKey');
  if (chaveIA !== chaveIaAplicada) {
    chaveIaAplicada = chaveIA;
    aoTrocarChaveIa();
  }
  claudeAtual = new Anthropic({ apiKey: chaveIA || 'sem-chave' });
  iaLigada = Boolean(chaveIA);
  trinks.definirChave(conexoes.get('trinksApiKey') ?? '');
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
  for (const unidade of idsUnidades()) lista.push({ canalId: canalTesteDa(unidade), unidade, canal: canalTeste });
  // Facebook Messenger e Instagram Direct: entram depois (o número de WhatsApp de cada unidade continua sendo o primeiro).
  const sociais = numerosSociais(conexoes, canaisSociais);
  lista.push(...sociais);
  numeros.splice(0, numeros.length, ...lista);
  log(`Conexões aplicadas: IA ${iaLigada ? 'ligada' : 'desligada'}, agenda ${agendaLigada ? 'ligada' : 'desligada'}, ${lista.filter(ehReal).length} número(s) de WhatsApp${sociais.length ? `, ${sociais.map((n) => n.canal.tipo).join(' e ')}` : ''}.`);
}
conexoes.aoMudar(aplicarConexoes);
await conexoes.carregar();

// Presença da equipe (online/offline): a mesma instância para o servidor e as Conversas de equipe.
const presencas = pool ? new PresencasPostgres(pool) : new PresencasMemoria();
// Notificações (sino e push): cada evento registrado vira aviso para quem pode ver a conversa.
const armazemNotificacoes = pool ? new ArmazemNotificacoesPostgres(pool) : new ArmazemNotificacoesMemoria();
// Histórico da tela Ligações (efetuadas pelo app; recebidas/perdidas pelo evento CALL do WhatsApp).
const armazemChamadas = pool ? new ArmazemChamadasPostgres(pool) : new ArmazemChamadasMemoria();
const chavesPush = new ChavesPush(armazemNotificacoes, cofre);
/* conversa-extra: silenciar e arquivar conversas, por pessoa (o push respeita o silêncio) */
const pessoais = pool ? new ConversasPessoaisPostgres(pool) : new ConversasPessoaisMemoria();
const notificador = new Notificador({
  silenciaram: (conversaId, agora) => pessoais.silenciaramAgora(conversaId, agora),
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

// Saúde do WhatsApp não oficial: avisa quando um canal cai ou o servidor da Evolution some, e tenta reconectar.
const whatsappSaude = new SaudeWhatsApp({
  armazem: pool ? new ArmazemSaudePostgres(pool) : new ArmazemSaudeMemoria(),
  admin: () => {
    const url = conexoes.get('evolutionUrl');
    const chave = conexoes.get('evolutionApiKey');
    return url && chave ? new EvolutionAdmin(url, chave) : undefined;
  },
  canais: () => canaisEvolution(conexoes.numeros()),
  avisar: (a) => notificador.avisarGestao(a),
  log,
});
await whatsappSaude.carregar();
whatsappSaude.iniciar();
await chavesPush.obter().catch((e) => log('Falha ao preparar as chaves do push', String(e)));

const destinosRelatorio = () => (conexoes.destinosRelatorio().length ? conexoes.destinosRelatorio() : cfg.destinosRelatorio);

// Fotos, áudios, vídeos e documentos recebidos: baixados à parte, sem segurar o texto.
const midias = new Midias(repo, (canalId) => numeros.find((n) => n.canalId === canalId)?.canal, undefined, log);

// Fichas (contatos) e respostas rápidas (também usadas pela demonstração).
const armazemContatos = pool ? new ContatosPostgres(pool) : new ContatosMemoria();
const armazemRespostas = pool ? new RespostasPostgres(pool) : new RespostasMemoria();
// Dados de demonstração (Configurações › Dados de demonstração): registro do que foi criado, para apagar só isso.
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
/* perdas-saude: cada ida para uma etapa de perda fica registrada (com o motivo pedido na tela) */
const perdas = new Perdas({ armazem: pool ? new ArmazemPerdasPostgres(pool) : new ArmazemPerdasMemoria(repo), funis, empresaId: cfg.SINTONIA_EMPRESA_ID, log });
/* empresa-conta: o Comercial (e Desempenho, Análises, Plano, Criativos) lê os preços de Empresa › Produtos e serviços.
   ia-completa: criados aqui (antes eram mais abaixo) porque a IA também lê produtos e liga produto ao lead. */
const armazemCadastro = pool ? new ArmazemCadastroPostgres(pool) : new ArmazemCadastroMemoria(async () => (await empresa.dados()).nome);
/* produtos-lead: produtos e serviços vinculados ao lead (ficha, cartão do Pipeline, filtro, exportar, IA e Análises) */
const produtosLead = new ProdutosLead({ armazem: pool ? new ArmazemProdutosLeadPostgres(pool) : new ArmazemProdutosLeadMemoria(), cadastro: armazemCadastro, valor: funis });
/* ia-completa: o que a IA enxerga e mexe no CRM (pipelines, motivos de perda, produtos, tarefas da equipe, arquivos). */
const crmIa = montarCrmIa({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  funis,
  perdas,
  cadastro: armazemCadastro,
  produtosLead,
  tarefas: pool ? new ArmazemTarefasIaPostgres(pool) : new ArmazemTarefasIaMemoria(),
  responsavelPadrao: async () => {
    const todos = (await contas.listarUsuarios(cfg.SINTONIA_EMPRESA_ID)).filter((u) => u.ativo);
    const g = todos.find((u) => u.papel === 'gerente') ?? todos.find((u) => u.papel === 'direcao') ?? todos.find((u) => u.papel === 'admin');
    return g ? { id: g.id, nome: g.nome } : undefined;
  },
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
  variaveis: () => nps.variaveis(), // {link_avaliacao} da pesquisa de satisfação
});
/* automacao-vendas: gatilho "agendou" (agendamento da IA ou da equipe, e a cliente confirmando o horário). */
observarEventos(repo, (e) => void automacoes.aoEvento(e));
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
// Finalizar atendimento + pesquisa de satisfação (src/nps): lê a nota na resposta da cliente; dispara as automações.
const armazemNps = pool ? new ArmazemNpsPostgres(pool) : new ArmazemNpsMemoria();
const nps = new Nps({ empresaId: cfg.SINTONIA_EMPRESA_ID, armazem: armazemNps, repo, sintonia: () => sintonia, automacoes: () => automacoes, log });
// Radar (src/radar): a equipe coloca a conversa no radar; a IA confere cada mensagem nova e o prazo; avisa e, se pedido, responde.
const radar = new Radar({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  armazem: pool ? new ArmazemRadarPostgres(pool) : new ArmazemRadarMemoria(),
  repo,
  sintonia: () => sintonia,
  agente: { executar: (p) => agentesIa.agente.executar(p) },
  juiz: juizClaude(claude, { modelo: cfg.SINTONIA_MODELO }),
  iaDisponivel: () => iaLigada,
  log,
});
observarEventos(repo, (e) => radar.aoEvento(e));
const ganchos: typeof ganchosBase = {
  ...ganchosBase,
  // radar: a instrução do radar que acabou de disparar vai junto com o objetivo dos fluxos de IA.
  objetivoIa: async (c) => {
    const partes = [await ganchosBase.objetivoIa?.(c), await radar.objetivo(c).catch(() => undefined)].filter(Boolean);
    return partes.length ? partes.join('\n\n') : undefined;
  },
  mensagemCliente: async (c, m) => {
    await ganchosBase.mensagemCliente?.(c, m);
    await nps.mensagemCliente(c, m).catch((e) => log('Falha na pesquisa de satisfação (resposta da cliente)', String(e)));
    await followup.mensagemCliente(c, m).catch((e) => log('Falha no follow-up (resposta da cliente)', String(e)));
    await radar.mensagemCliente(c, m).catch((e) => log('Falha no radar (resposta da cliente)', String(e)));
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
  crm: () => crmIa /* ia-completa */,
  log,
});
// Correções da equipe às sugestões viram aprendizados para a gestão aprovar.
observarEventos(repo, (e) => void agentesIa.controle.aoEvento(e));

/* robustez: fila própria da IA (src/app/fila-ia.ts): a mensagem aparece na tela na hora e a IA pensa por trás,
   com SINTONIA_PARALELO_IA conversas ao mesmo tempo. SINTONIA_FILA_IA=0 volta ao jeito antigo (pensa dentro da entrada). */
const filaIa = process.env.SINTONIA_FILA_IA === '0' ? undefined : new FilaIa({ pensar: (id) => sintonia.pensar(id), paralelo: cfg.SINTONIA_PARALELO_IA, log });
/* ia-completa: transcrição (usada pela tela da conversa e pela IA, que ouve os áudios antes de responder). */
const transcricoes = pool ? new TranscricoesPostgres(pool) : new TranscricoesMemoria();
const transcritor = new TranscritorComReserva(cfg.WHISPER_URL ? new TranscritorLocal(cfg.WHISPER_URL) : null, new TranscritorOpenAI(() => conexoes.get('openaiApiKey')), () => Boolean(conexoes.get('openaiApiKey')));
const transcricaoLigada = () => Boolean(cfg.WHISPER_URL || conexoes.get('openaiApiKey'));
const sintonia = new Sintonia({
  filaIa,
  /* ia-completa: junta mensagens seguidas (só com a fila da IA, que pensa por trás); ouve áudio e vê foto; CRM; custo. */
  juntarMs: filaIa ? Number(process.env.SINTONIA_JUNTAR_MS ?? 6000) : 0,
  percepcao: new PercepcaoIa({ repo, transcricoes, transcritor, transcricaoLigada, log }),
  crmIa,
  guardaCusto,
  equipeAgora: (c) => cobertura.equipeAgora(c),
  rastreio,
  ganchos,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  repo,
  numeros,
  // Porteiro do plano da IA: sem plano, fora da janela ou sem cota, a conversa fica para a equipe.
  agente: comPorteiro(agentesIa.agente, { planos, empresaId: cfg.SINTONIA_EMPRESA_ID, log }),
  modoInicial: agentesIa.modoInicial,
  /* robustez: sem chave da IA, a IA não é chamada e a conversa nova nasce com a equipe. */
  iaDisponivel: (c) => agentesIa.temIaPara(c),
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
    // enviarAvulso: o eco do WhatsApp não volta como "equipe respondeu pelo celular".
    for (const destino of destinosRelatorio()) await sintonia.enviarAvulso(n, destino, texto);
  },
});

aoTrocarChaveIa = () => sintonia.liberarIa();

/* automacao-vendas: rodízio automático de leads entre quem está "Disponível para atender", por unidade. */
const acessosRodizio = acessosPara(contas);
const rodizio = new Rodizio({
  armazem: pool ? new ArmazemRodizioPostgres(pool) : new ArmazemRodizioMemoria(repo),
  contas,
  presencas,
  repo,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  sintonia: () => sintonia,
  // Só quem tem "Responder clientes" (perfil do papel + ajustes da pessoa) entra no rodízio.
  podeResponder: async (u) => {
    if (!acessosRodizio) return resolverPermissoes(u.papel).responder;
    const [perfis, extras] = await Promise.all([acessosRodizio.perfis(u.empresaId), acessosRodizio.extras(u.id)]);
    return resolverPermissoes(u.papel, perfis[u.papel], extras.ajustes).responder;
  },
  ehDemo: async (id) => (await armazemDemo.conversasDemo(cfg.SINTONIA_EMPRESA_ID)).has(id),
  log,
});
observarEventos(repo, (e) => rodizio.aoEvento(e));

/* ia-completa: a IA cobre quem saiu do ar (fim do turno, almoço) e sabe quantas pessoas estão atendendo agora. */
const cobertura = new CoberturaIa({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  armazem: pool ? new ArmazemCoberturaPostgres(pool) : new ArmazemCoberturaMemoria(),
  repo,
  contas,
  presencas,
  comConversa: (id, fn) => sintonia.comConversa(id, fn),
  temIa: async (c) => !sintonia.iaPausadaAte() && (await agentesIa.temIaPara(c)),
  reavaliar: (id) => sintonia.reavaliar(id),
  podeAtender: async (u) => {
    if (!acessosRodizio) return resolverPermissoes(u.papel).responder;
    const [perfis, extras] = await Promise.all([acessosRodizio.perfis(u.empresaId), acessosRodizio.extras(u.id)]);
    return resolverPermissoes(u.papel, perfis[u.papel], extras.ajustes).responder;
  },
  finalizadas: (ids) => armazemNps.ultimasFinalizacoes(ids),
  log,
});

/* grupos: Conversas de grupo (grupos do WhatsApp pela API não oficial), em tabelas próprias. */
const armazemGrupos = pool ? new ArmazemGruposPostgres(pool) : new ArmazemGruposMemoria();
const grupos = new Grupos({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  armazem: armazemGrupos,
  numeros: () => numeros,
  admin: () => {
    const url = conexoes.get('evolutionUrl');
    const chave = conexoes.get('evolutionApiKey');
    return url && chave ? new EvolutionAdmin(url, chave) : undefined;
  },
  log,
});

const trabalhador = new Trabalhador({ fila, processar: (m) => sintonia.receber(m), paralelo: cfg.SINTONIA_PARALELO, log });

// Por qual número a unidade fala: o real; o de teste só enquanto nenhum número real estiver conectado.
const canalDaUnidade = (unidade: import('./domain.js').UnidadeId): { canalId: string } | { erro: string } => {
  const real = numeros.find((n) => n.unidade === unidade && ehReal(n));
  if (real) return { canalId: real.canalId };
  const teste = numeros.find((n) => n.unidade === unidade);
  if (teste && !numeros.some(ehReal)) return { canalId: teste.canalId };
  return { erro: 'Esta unidade ainda não tem WhatsApp conectado. Conecte o número em Conexões.' };
};

const acessosApi = acessosPara(contas);
/* integracoes: chaves de API, API pública (/api/v1), webhooks de saída e MCP (/mcp). Só lê os eventos: não muda ninguém. */
const producao = process.env.NODE_ENV === 'production';
const integracoes = montarIntegracoes({
  armazem: pool ? new ArmazemIntegracoesPostgres(pool) : new ArmazemIntegracoesMemoria(),
  cofre,
  repo,
  sintonia,
  canalDa: canalDaUnidade,
  modoInicial: async () => (iaLigada ? (await empresa.configIa()).modoPadrao : 'humano'),
  contatos: armazemContatos,
  tags: (e) => (e === tags.empresaId ? tags : undefined),
  funis: (e) => (e === funis.empresaId ? funis : undefined),
  pool,
  contas,
  nomes: {
    funil: async (id) => (await funis.listar()).find((f) => f.id === id)?.nome,
    etapa: async (id) => (await armazemTags.buscar(id))?.nome,
  },
  producao,
  // Só em desenvolvimento: deixa testar webhook em http://localhost.
  permitirLocal: !producao && process.env.WEBHOOKS_PERMITIR_LOCAL === '1',
  avisar: (a) => notificador.avisarGestao(a),
  /* robustez: mensagem pela API v1 exige que quem criou a chave ainda tenha "Responder". */
  podeResponder: async (usuarioId) => {
    const u = await contas.buscarPorId(usuarioId);
    if (!u || !u.ativo) return false;
    const ac = acessosApi;
    if (!ac) return resolverPermissoes(u.papel).responder;
    const [perfis, extras] = await Promise.all([ac.perfis(u.empresaId), ac.extras(u.id)]);
    return resolverPermissoes(u.papel, perfis[u.papel], extras.ajustes).responder;
  },
  log,
});
observarEventos(repo, (e) => integracoes.aoEvento(e));

/* atendimento-extra: quem marca ou desmarca pelo link de agendamento avisa a dona do link e a gestão (sino + push);
 * o contato recebe a confirmação e o lembrete pelo WhatsApp (conversa do número, ou uma nova no primeiro número conectado). */
const avisosReuniao = pool
  ? new AvisosReuniao({
      pool,
      log,
      urlPublica: () => process.env.SINTONIA_URL_PUBLICA,
      avisarPessoa: (id, a) => notificador.avisarPessoa(id, a),
      avisarGestao: (a) => notificador.avisarGestao(a),
      aoAgendou: (reuniaoId, conversaId) => automacoes.aoAgendouOnline(conversaId, reuniaoId), // automacao-vendas
      whatsapp: async (telefone, nome, texto) => {
        const n = numeros.find(ehReal);
        if (!n) return undefined;
        const agora = new Date();
        const r = await repo.buscarOuCriarConversa({ empresaId: cfg.SINTONIA_EMPRESA_ID, unidade: n.unidade, canalId: n.canalId, telefone, nome, agora });
        if (r.nova) {
          await repo.registrarEvento({ tipo: 'conversa_nova', conversaId: r.conversa.id, unidade: r.conversa.unidade, em: agora, dados: { origem: 'agendamento_online' } });
          await sintonia.mudarModo(r.conversa.id, (await agentesIa.modoInicial(r.conversa, agora)) ?? (iaLigada ? (await empresa.configIa()).modoPadrao : 'humano'));
        }
        await sintonia.comConversa(r.conversa.id, async (c) => {
          await sintonia.enviarAutomatico(c, texto, 'Agendamento online');
          await repo.salvarConversa(c);
        });
        return { conversaId: r.conversa.id };
      },
    })
  : undefined;

/* robustez: histórico do WhatsApp ao conectar em lotes, com o estado no banco (continua depois de reiniciar). */
const importadorHistorico = pool
  ? new ImportadorHistorico({ fila: new FilaHistoricoPostgres(pool), importar: (m) => sintonia.importarHistorico(m), log })
  : undefined;
/* perdas-saude: conta bloqueada por muitas tentativas de senha errada: a dona fica sabendo pelo sino e pelo e-mail. */
async function avisarContaBloqueada(u: Usuario, b: BloqueioConta): Promise<void> {
  const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' }).format(new Date(b.ate));
  const texto = `Alguém errou a senha da sua conta ${b.erros} vezes seguidas. Por segurança, ela ficou bloqueada até ${hora}. Se não foi você, troque a senha (Minha conta ou "Esqueci minha senha").`;
  await notificador.avisarPessoa(u.id, { titulo: 'Tentativas de entrar na sua conta', texto, chave: `login-bloqueado-${u.id}-${Math.floor(b.ate / 60_000)}` }).catch(() => false);
  if (email && (await email.temContaAtiva().catch(() => false))) {
    const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#0b1f33;line-height:1.6"><p>Olá, ${escaparHtml(u.nome.split(/\s+/)[0] || u.nome)}!</p><p>${escaparHtml(texto)}</p><p style="color:#5b6b7c;font-size:13px">Sintonia</p></body></html>`;
    await email.enviarSistema({ para: u.email, nome: u.nome, assunto: 'Tentativas de entrar na sua conta do Sintonia', html, texto }).catch((e) => log('Aviso de conta bloqueada: o e-mail não saiu', String(e)));
  }
}
const escaparHtml = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/* usuarios: um só armazém de perfis (Conta › Perfil e o telefone que a gestão usa para mandar o convite pelo WhatsApp). */
const perfisUsuario = pool ? new ArmazemPerfisPostgres(pool) : new ArmazemPerfisMemoria();
const app = criarServidor({
  /* banco-seguranca: auditoria das ações sensíveis, LGPD (exportar/apagar dados de cliente) e CSP (SINTONIA_CSP) */
  protecao: { empresaId: cfg.SINTONIA_EMPRESA_ID, auditoria: pool ? new AuditoriaPostgres(pool) : new AuditoriaMemoria(), ...(pool ? { dadosCliente: new DadosCliente(pool) } : {}), https: cfg.COOKIE_SEGURO === '1', csp: modoCsp() },
  ...(importadorHistorico ? { historico: importadorHistorico } : {}),
  sintonia,
  repo,
  log,
  auth: { contas, cookieSeguro: cfg.COOKIE_SEGURO === '1', ...(email ? { recuperacao: recuperacaoPorEmail(email, log) } : {}), avisarBloqueio: avisarContaBloqueada /* perdas-saude */, telefones: telefonesDosPerfis(perfisUsuario) /* usuarios */ },
  fila: { fila, avisar: () => trabalhador.avisar(), ...(filaIa ? { ia: () => filaIa.situacao() } : {}), ...(reservaEntrada ? { reserva: () => reservaEntrada!.pendentesNaReserva() } : {}) },
  contatos: { armazem: armazemContatos, empresaId: cfg.SINTONIA_EMPRESA_ID },
  get agenda() {
    return agendaLigada ? agendas : undefined;
  },
  get evolution() {
    return { canal: evolution, token: conexoes.get('webhookToken') };
  },
  grupos,
  aoReuniao: integracoes.aoReuniao,
  avisosReuniao, // atendimento-extra
  conexoes: {
    conexoes,
    agendas,
    sincronizarGrupos: () => grupos.sincronizar(),
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
      for (const u of unidadesAgenda().filter((x) => agendas.config(x).escolha === 'trinks')) {
        const est = unidadeDe(u).trinksEstabelecimentoId;
        if (!est) { partes.push(`${unidadeDe(u).nome}: sem ID do estabelecimento`); continue; }
        try { partes.push(`${unidadeDe(u).nome}: ${(await t.listarProfissionais(est)).length} profissionais`); }
        catch (e) { falhas++; partes.push(`${unidadeDe(u).nome}: ${String((e as Error).message).slice(0, 80)}`); }
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
  finalizadas: (ids) => armazemNps.ultimasFinalizacoes(ids),
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
      unidades: unidadesAgenda().map((u) => {
        const a = agendas.config(u);
        return { id: u, nome: a.nome, estabelecimento: Boolean(a.local), sistema: a.escolha, sistemaNome: a.sistemaNome, falta: a.aviso && !a.falta.length ? [a.aviso] : a.falta, pronta: a.pronta };
      }),
    },
  }),
  midias,
  notificacoes: { notificador, armazem: armazemNotificacoes, chaves: chavesPush },
  whatsappSaude,
  chamadas: { armazem: armazemChamadas, empresaId: cfg.SINTONIA_EMPRESA_ID },
  leituras: pool ? new LeiturasPostgres(pool) : new LeiturasMemoria(),
  pessoais,
  layoutsPainel: pool ? new LayoutsPainelPostgres(pool) : new LayoutsPainelMemoria(),
  ...(pool ? { poolReunioes: pool, poolRotina: pool } : {}),
  presencas,
  /* ia-completa: "Disponível" desligado = a IA cobre as conversas da pessoa; ligado de novo = devolve. */
  aoMudarPresenca: (u, status) => cobertura.aoMudar(u, status),
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
      await repo.registrarEvento({ tipo: 'conversa_nova', conversaId: conversa.id, unidade, em: agora, dados: { origem: 'cliente_teste' } });
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
registrarFunis(app, { repo, funis, automacoes, origens: (ids) => rastreio.selos(ids), perdas });
registrarPerdas(app, { perdas }); /* perdas-saude */
/* ia-completa: "O que a IA faz" (Automações › Agente de IA): ferramentas por agente e o que falta para funcionar. */
registrarEstadoIa(app, {
  chaves: () => ({ anthropic: Boolean(conexoes.get('anthropicApiKey')), openai: Boolean(conexoes.get('openaiApiKey')) }),
  pausadaAte: () => sintonia.iaPausadaAte(),
  agendas,
  whatsapp: () => idsUnidades().map((u) => ({ unidade: u, conectado: numeros.some((n) => n.unidade === u && ehReal(n)) })),
  configIa: () => empresa.configIa(),
  controle: () => agentesIa.armazem.controle(cfg.SINTONIA_EMPRESA_ID),
  agentes: () => agentesIa.armazem.listar(cfg.SINTONIA_EMPRESA_ID),
  transcricao: transcricaoLigada,
  crm: true,
  limiteConversaDia: guardaCusto.limitePorConversaDia,
});
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
  /* clientes-tags: origem de cada conversa no exportar (filtro e coluna) */
  origens: (ids) => rastreio.selos(ids),
  /* produtos-lead: coluna "Produtos" do exportar */
  produtos: (ids) => produtosLead.resumoDe(cfg.SINTONIA_EMPRESA_ID, ids),
});
// A Agenda mostra também o que a recepção marca direto no sistema do salão (cache de 1 minuto por unidade e período).
const agendaExterna = new AgendaExterna({ roteador: agendas, log });
registrarExtras(app, { repo, empresaId: cfg.SINTONIA_EMPRESA_ID, relatorios: extras.relatorios, leads: extras.leads, contas, agendaExterna });
// Comercial: metas individuais, comissão, ranking, serviços mais agendados e o Painel na TV (/tv/:token).
/* empresa-conta: o Comercial (e Desempenho, Análises, Plano, Criativos) lê os preços de Empresa › Produtos e serviços */
registrarProdutosLead(app, { repo, servico: produtosLead, empresaId: cfg.SINTONIA_EMPRESA_ID });
funis.ligarFiltros({
  conversasComProdutos: (f) => produtosLead.conversasComFiltro(cfg.SINTONIA_EMPRESA_ID, f),
  telefonesDasEmpresas: (chaves) => extras.leads.telefonesDasEmpresas(chaves),
});
const armazemComercialBase = pool ? new ArmazemComercialPostgres(pool) : new ArmazemComercialMemoria();
const armazemComercial = precosDoCadastro(armazemComercialBase, armazemCadastro);
const cadastroEmpresa = registrarCadastro(app, {
  armazem: armazemCadastro,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  empresa,
  // Empresa sem unidades no cadastro: a Império recebe as que o app já mostrava (com o nome para clientes e o
  // horário de shopping de antes); qualquer outra empresa começa com uma "Unidade principal" e cadastra as dela.
  unidadesPadrao: (empresaId) =>
    empresaId === EMPRESA_IMPERIO
      ? UNIDADES_IMPERIO.map((u) => ({ id: u.id, nome: u.nome, nomeCliente: u.nomeCliente, horario: u.horario && Object.keys(u.horario).length ? horarioDeFaixas(u.horario) : null, ativa: u.ativa }))
      : [{ id: UNIDADE_INICIAL.id, nome: UNIDADE_INICIAL.nome, horario: null }],
  // Não deixa apagar unidade com conversas, pessoas ou números ligados (só desativar).
  emUso: async (empresaId, id) => {
    if (numeros.some((n) => n.unidade === id && !ehCanalTeste(n.canalId)) || conexoes.numeros().some((n) => n.unidade === id)) return true;
    if (pool) {
      const { rows } = await pool.query<{ usada: boolean }>(
        `select exists(select 1 from sintonia.conversas where empresa_id = $1 and unidade = $2)
             or exists(select 1 from sintonia.usuarios where empresa_id = $1 and $2 = any(unidades)) as usada`,
        [empresaId, id],
      );
      return Boolean(rows[0]?.usada);
    }
    return (await repo.listarConversas()).some((c) => c.empresaId === empresaId && c.unidade === id) || (await contas.listarUsuarios(empresaId)).some((u) => u.unidades.includes(id));
  },
  // Unidade nova (ou desativada): canais de teste, agenda e números refeitos na hora.
  aoMudarUnidades: () => {
    aplicarConexoes();
    conexoes.garantirTokensDasUnidades().catch((e) => log('Falha ao gerar o Verify Token da unidade nova', String(e)));
  },
  // A tabela antiga, sem a mistura com os produtos (é ela que é copiada).
  precosComercial: async (id) => (await armazemComercialBase.ler(id)).cfg.precos,
});
// Cache das unidades e da identidade da empresa (src/unidades.ts, src/empresa/identidade.ts) a partir do cadastro,
// antes de atender qualquer mensagem; depois as conexões são refeitas com as unidades certas.
try {
  await cadastroEmpresa.carregar(cfg.SINTONIA_EMPRESA_ID);
  await conexoes.garantirTokensDasUnidades();
  aplicarConexoes();
} catch (e) {
  log('Falha ao carregar as unidades do cadastro (seguem as conhecidas)', String(e));
}
registrarConta(app, {
  contas,
  perfis: perfisUsuario,
  trocarEmail: pool ? trocarEmailPostgres(pool) : contas instanceof ContasMemoria ? trocarEmailMemoria(contas) : undefined,
});
registrarComercial(app, {
  armazem: armazemComercial,
  fonte: pool ? new FonteComercialPostgres(pool) : new FonteComercialMemoria(repo),
  contas,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  agora: () => new Date(),
  // Unidades ativas do cadastro, lidas na hora (unidade nova entra nas metas e na TV sem reiniciar).
  get unidades() {
    return idsUnidades();
  },
  metaMesAntiga: async () => (await empresa.meta()).agendamentosMes ?? null,
  nomeEmpresa: async () => (await empresa.dados()).nome,
});
// Desempenho do atendimento (visão do dono): tempos, expediente, o que ficou para trás e a fila de agora.
registrarDesempenho(app, {
  fonte: pool ? new FonteDesempenhoPostgres(pool) : new FonteDesempenhoMemoria(repo),
  armazem: armazemComercial,
  contas,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  get unidades() {
    return idsUnidades();
  },
  agora: () => new Date(),
});
// Análises (menu Análises): vendas e receita, horários de pico, tempo parado no funil e clientes que voltaram.
registrarAnalises(app, {
  fonte: pool ? new FonteAnalisesPostgres(pool) : new FonteAnalisesMemoria(repo),
  comercial: pool ? new FonteComercialPostgres(pool) : new FonteComercialMemoria(repo),
  armazemComercial,
  origens: new OrigensConversa({ repo, contatos: armazemContatos, leads: extras.armazem, selos: (ids) => rastreio.selos(ids) }),
  contas,
  /* produtos-lead: receita por produto/serviço vinculado */
  produtosVinculados: (empresaId, ids) => produtosLead.porProduto(empresaId, ids),
  perdas, // perdas-saude
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  agora: () => new Date(),
});
/* relatorio-dia: Análises › Dia a dia (leads novos × agendaram, por dia e por grupo de leads) e relatórios
   automáticos pelo WhatsApp (a Serena como gerente de vendas). Tudo começa desligado. */
const armazemRelatorioDia = pool ? new ArmazemEnvioRelatorioPostgres(pool) : new ArmazemEnvioRelatorioMemoria();
const relatorioDia = new RelatorioDia({
  fonte: pool ? new FonteRelatorioDiaPostgres(pool) : new FonteRelatorioDiaMemoria(repo),
  armazem: armazemRelatorioDia,
  armazemComercial,
  comercial: pool ? new FonteComercialPostgres(pool) : new FonteComercialMemoria(repo),
  origens: (empresaId, ids) => new OrigensConversa({ repo, contatos: armazemContatos, leads: extras.armazem, selos: (x) => rastreio.selos(x) }).de(empresaId, ids),
  agendaEntre: (inicio, fim, escopo) => agendamentosEntre(repo, inicio, fim, escopo),
  enviar: async (d, texto, unidadeEnvio) => {
    if (d.tipo === 'grupo') {
      const g = await armazemGrupos.buscar(d.destino);
      if (!g) throw new Error('Grupo não encontrado');
      await grupos.enviarTexto(g, texto, { nome: 'Serena (relatório)' });
      return;
    }
    const n = (unidadeEnvio && numeros.find((x) => x.unidade === unidadeEnvio && ehReal(x))) || numeros.find(ehReal);
    if (!n) throw new Error('Nenhum WhatsApp conectado para enviar');
    await sintonia.enviarAvulso(n, d.destino, texto);
  },
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  log,
});
registrarRelatorioDia(app, {
  servico: relatorioDia,
  armazem: armazemRelatorioDia,
  contas,
  telefoneDe: async (id) => (await perfisUsuario.ler(id)).telefone,
  grupos: async (empresaId) => (await armazemGrupos.listar(empresaId)).map((g) => ({ id: g.id, nome: g.nome ?? 'Grupo sem nome', unidade: g.unidade })),
  canais: () => [...new Set(numeros.filter(ehReal).map((n) => n.unidade))],
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  agora: () => new Date(),
});
/* perdas-saude: painel de saúde da gestão (Análises › Saúde do sistema) */
const painelSaude = new PainelSaude({
  fonte: pool ? new FonteSaudePostgres(pool) : new FonteSaudeMemoria(repo),
  filaEntrada: () => fila.situacao(),
  ...(reservaEntrada ? { reservaEmDisco: () => reservaEntrada!.pendentesNaReserva() } : {}),
  ...(filaIa ? { filaIa: () => filaIa.situacao() } : {}),
  iaPausadaAte: () => sintonia.iaPausadaAte(),
  iaLigada: () => iaLigada,
  whatsapp: () => whatsappSaude.resumo(),
  ...(pool ? { pool: () => ({ total: pool!.totalCount, livres: pool!.idleCount, esperando: pool!.waitingCount }) } : {}),
});
registrarSaude(app, { painel: painelSaude });
/* sem-pagamento: nada se compra pelo app (App Store). Plano, créditos, pedidos, comparativo de custo e o Asaas
   ficam desligados (as rotas respondem 410; as tabelas continuam no banco). A medição de uso da IA e o porteiro
   (acima) continuam valendo por dentro. Cadastro pela própria pessoa: recusado (contas só pela administração).
   Contato público (WhatsApp de vendas): SINTONIA_WHATSAPP_VENDAS. Para religar a cobrança no futuro, volte a chamar
   registrarAsaas e registrarPlanos (src/planos/asaas.ts e src/planos/rotas.ts) no lugar de registrarPublico. */
registrarPublico(app, { contato: contatoDoAmbiente() });
// Links rastreados (/l/:codigo), origem na ficha, selos e API de Conversões.
registrarGrupos(app, { grupos, armazem: armazemGrupos, empresaId: cfg.SINTONIA_EMPRESA_ID });
registrarRastreio(app, {
  repo, rastreio, capi, conexoes, empresaId: cfg.SINTONIA_EMPRESA_ID,
  // marketing: Central de criativos (leads, agendamentos e vendas por anúncio; gasto vem da conta de anúncios nas Conexões).
  criativos: pool ? new FonteCriativosPostgres(pool) : new FonteCriativosMemoria(repo, armazemRastreio, { valor: (id) => funis.valor({ id } as never) }),
  precos: async () => (await armazemComercial.ler(cfg.SINTONIA_EMPRESA_ID)).cfg.precos,
});

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
  /* robustez: cada relógio só começa uma rodada quando a anterior terminou (src/util/relogio.ts). */
  const filaEmail = umaPorVez('e-mails', () => email.tick(), log);
  const andar = () => void filaEmail();
  registrarEmail(app, { email, avisar: andar });
  emailTick = setInterval(andar, 10_000);
  const caixas = umaPorVez('caixas de e-mail', () => email.lerCaixas(), log);
  emailImap = setInterval(() => void caixas(), 120_000);
}

// Tela de conversa: respostas rápidas, botão "IA", transcrição de áudio e nova conversa por número.
registrarConversa(app, {
  repo,
  sintonia,
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  respostas: armazemRespostas,
  transcricoes,
  transcritor,
  transcricaoLigada,
  ia: { claude, modelo: cfg.SINTONIA_MODELO, base: () => base.texto(), ligada: () => iaLigada },
  // Envia pelo número real da unidade; o de teste só vale enquanto nenhum número real estiver conectado.
  canalDa: canalDaUnidade,
  modoInicial: async () => (iaLigada ? (await empresa.configIa()).modoPadrao : 'humano'),
  controleIa: () => agentesIa.servico.controle(),
  // Serena cria coisas no CRM (sempre com prévia e "Salvar"): scripts, fluxos, links de agendamento e etiquetas.
  serenaAcoes: (empresaId) => ({
    ...(pool ? fontesDoBanco(pool, empresaId) : {}),
    funis: async () => funisComEtapas(await funis.listar(), await tags.listar()),
    tags: () => tags.listar(),
    conferirAutomacao: (d) => automacoes.conferir(d),
  }),
});

/* respostas-fluxos: fluxos de mensagens (Respostas rápidas › Fluxos). O servidor envia os passos sozinho, com espera e "digitando…". */
const armazemFluxos = pool ? new FluxosPostgres(pool) : new FluxosMemoria();
const motorFluxos = new MotorFluxos({
  armazem: armazemFluxos,
  log,
  enviador: {
    conversa: (id) => repo.buscarConversa(id),
    texto: (id, texto, atendente) => sintonia.equipeEnviou(id, texto, atendente),
    midia: async (id, m, atendente) => {
      await sintonia.equipeEnviouMidia(id, m, atendente);
    },
    presenca: (id, tipo, seg) => sintonia.mostrarPresenca(id, tipo, seg),
  },
});
registrarFluxos(app, { repo, empresaId: cfg.SINTONIA_EMPRESA_ID, armazem: armazemFluxos, motor: motorFluxos, conferirVez: (id, quem) => sintonia.conferirVez(id, quem) });

/* msg-agendada: "Agendar envio" na conversa. O relógio envia na hora pelo mesmo caminho da equipe (com o nome de quem agendou). */
const armazemAgendadas = pool ? new AgendadasPostgres(pool) : new AgendadasMemoria();
const motorAgendadas = new MotorAgendadas({
  armazem: armazemAgendadas,
  log,
  enviador: {
    conversa: (id) => repo.buscarConversa(id),
    texto: (id, texto, atendente) => sintonia.equipeEnviou(id, texto, atendente),
    midia: async (id, m, atendente) => {
      await sintonia.equipeEnviouMidia(id, m, atendente);
    },
  },
  avisar: async (m, c) => {
    if (!m.criadoPorId) return;
    const para = c?.nome || 'a cliente';
    await notificador.avisarPessoa(m.criadoPorId, { titulo: `Mensagem agendada não enviada (${para})`, texto: m.erro || 'Não deu para enviar.', conversaId: m.conversaId, chave: `agendada-falhou-${m.id}-${m.tentativas}` });
  },
});
registrarAgendadas(app, { repo, empresaId: cfg.SINTONIA_EMPRESA_ID, armazem: armazemAgendadas, motor: motorAgendadas, conferirVez: (id, quem) => sintonia.conferirVez(id, quem) });

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
  chamadas: armazemChamadas,
  empresa,
  segmento: process.env.DEMO_SEGMENTO === 'estetica' ? 'estetica' : undefined,
  log,
});
registrarDemo(app, demo);
registrarFollowup(app, { followup, repo });
registrarNps(app, { nps, repo, automacoes });
registrarRadar(app, { radar, repo, iaLigada: () => iaLigada });
registrarRodizio(app, { rodizio }); // automacao-vendas
/* contato-nome: conversas só com o número ganham o nome do perfil do WhatsApp (ao subir, a cada 6 h e no "Sincronizar WhatsApp"). */
const nomesWhatsapp = new NomesWhatsapp({
  empresaId: cfg.SINTONIA_EMPRESA_ID,
  admin: () => {
    const url = conexoes.get('evolutionUrl');
    const chave = conexoes.get('evolutionApiKey');
    return url && chave ? new EvolutionAdmin(url, chave) : undefined;
  },
  canais: () => canaisEvolution(conexoes.numeros()).map((c) => c.canalId),
  semNome: (empresaId, limite) => repo.conversasSemNome(empresaId, limite),
  aplicar: (id, nome) => sintonia.nomeDoWhatsapp(id, nome),
  log,
});
// Resgatar mensagens: busca de novo na Evolution o que não apareceu (uma conversa ou todas), sem IA nem avisos.
registrarResgate(app, {
  repo,
  admin: () => {
    const url = conexoes.get('evolutionUrl');
    const chave = conexoes.get('evolutionApiKey');
    return url && chave ? new EvolutionAdmin(url, chave) : undefined;
  },
  canais: () => canaisEvolution(conexoes.numeros()).map((c) => c.canalId),
  importar: (m) => sintonia.importarHistorico(m),
  depois: () => nomesWhatsapp.rodar(), // contato-nome
  log,
});
/* integracoes: tela Integrações (/api/integracoes), API v1, MCP, /desenvolvedores e /openapi.json */
integracoes.registrar(app);
/* equipe: conversas de equipe (src/equipe) — direta, grupos e o "Geral"; aviso pelo push que já existe. */
registrarChatEquipe(app, {
  chat: new ChatEquipe({ armazem: pool ? new ArmazemEquipePostgres(pool) : new ArmazemEquipeMemoria(), contas, repo, presencas, avisar: avisoPorPush(notificador), log }),
});

// Relógio: reavaliações, lembretes e follow-ups a cada 30 s; relatório às 20h.
let relatorioEnviadoEm = '';
/* robustez: a rodada de 30 s nunca começa por cima da anterior (src/util/relogio.ts). */
const rodadaRelogio = umaPorVez('30 s', async () => {
  await sintonia.tick().catch((e) => log('Falha no relógio', String(e)));
  await agentesIa.controle.tick().catch((e) => log('Falha no relógio dos agentes de IA', String(e))); // volta para a IA
  await automacoes.tick().catch((e) => log('Falha no relógio das automações', String(e))); // "esperar", fora do horário, parada na etapa
  await bots.tick().catch((e) => log('Falha no relógio dos bots', String(e))); // esperas, tempo limite das respostas, agente de IA
  await notificador.tick().catch((e) => log('Falha no relógio das notificações', String(e))); // lembretes que venceram, cliente esperando
  midias.avisar(); // novas tentativas de download que já venceram
  await capi.tick().catch((e) => log('Falha no relógio da CAPI', String(e))); // eventos da API de Conversões
  await rastreio.tick().catch((e) => log('Falha ao buscar nomes de anúncios', String(e)));
  await followup.tick().catch((e) => log('Falha no relógio do follow-up', String(e))); // cadências e confirmações de agenda
  await nps.tick().catch((e) => log('Falha no relógio da pesquisa de satisfação', String(e))); // pesquisas sem resposta no prazo
  await radar.tick().catch((e) => log('Falha no relógio do radar', String(e))); // prazos vencidos e respostas da IA pedidas pelo radar
  await avisosReuniao?.tick().catch((e) => log('Falha no relógio do agendamento online', String(e))); // atendimento-extra: lembrete antes da reunião
  await relatorioDia.tick().catch((e) => log('Falha no relógio dos relatórios automáticos', String(e))); // relatorio-dia: uma vez só (chave única no banco)
  const agora = new Date();
  const p = partesBahia(agora);
  const real = numeros.find(ehReal);
  if (p.hora === 20 && relatorioEnviadoEm !== dataISO(agora) && real) {
    relatorioEnviadoEm = dataISO(agora);
    // As conversas de demonstração não entram no relatório que sai pelo WhatsApp.
    const texto = await sintonia.relatorioDoDia(agora, undefined, await demo.conversasDemo().catch(() => undefined));
    for (const destino of destinosRelatorio()) {
      await sintonia.enviarAvulso(real, destino, texto).catch((e) => log('Falha no relatório', String(e)));
    }
  }
}, log);
const relogio = setInterval(() => void rodadaRelogio(), 30_000);

// integracoes: fila dos webhooks de saída, a cada 5 s.
const rodadaWebhooks = umaPorVez('webhooks de saída', () => integracoes.tick(), log);
const relogioWebhooks = setInterval(() => void rodadaWebhooks(), 5_000);

// Fila das transmissões: a cada 2 s (o ritmo de cada número decide quantas saem).
const rodadaTransmissoes = umaPorVez('transmissões', async () => transmissoes?.tick(), log);
const relogioTransmissoes = setInterval(() => void rodadaTransmissoes(), 2_000);

// msg-agendada: mensagens agendadas, a cada 15 s (sai no máximo 15 s depois da hora marcada).
const rodadaAgendadas = umaPorVez('mensagens agendadas', () => motorAgendadas.tick(), log);
const relogioAgendadas = setInterval(() => void rodadaAgendadas(), 15_000);

// respostas-fluxos: passos dos fluxos de mensagens (esperas de segundos), a cada 1 s.
const rodadaFluxos = umaPorVez('fluxos de mensagens', async () => {
  await motorFluxos.tick();
  await motorFluxos.limpar(cfg.SINTONIA_EMPRESA_ID);
}, log);
const relogioFluxos = setInterval(() => void rodadaFluxos(), 1_000);

/* robustez: a reserva em disco (mensagens que chegaram com o banco fora) volta para a fila assim que o banco responde. */
const rodadaReserva = umaPorVez('reserva em disco', async () => {
  if (await reservaEntrada?.descarregar()) trabalhador.avisar();
});
const relogioReserva = setInterval(() => void rodadaReserva(), 5_000);
void rodadaReserva();

trabalhador.iniciar();
nomesWhatsapp.iniciar(); // contato-nome: primeira rodada uns segundos depois de subir, sem segurar a subida
importadorHistorico?.avisar(); // robustez: histórico que ficou pela metade antes de reiniciar continua agora
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });

// Desligamento limpo: para de aceitar, termina o que está em andamento, fecha o banco.
// Se cair de vez, nada se perde: as mensagens reservadas voltam para a fila quando a reserva vence.
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, async () => {
    log(`Recebido ${sinal}: encerrando`);
    clearInterval(relogio);
    clearInterval(relogioTransmissoes);
    clearInterval(relogioFluxos);
    clearInterval(relogioAgendadas);
    clearInterval(relogioWebhooks);
    clearInterval(relogioReserva);
    whatsappSaude.parar();
    nomesWhatsapp.parar();
    if (emailTick) clearInterval(emailTick);
    if (emailImap) clearInterval(emailImap);
    await app.close().catch(() => {});
    await trabalhador.parar();
    await importadorHistorico?.encerrar().catch(() => {});
    // A IA em andamento tem até 15 s para terminar; o que ficar na fila volta pela tarefa "reavaliar" do banco.
    await Promise.race([filaIa?.encerrar(), new Promise((r) => setTimeout(r, 15_000))]);
    await Promise.race([Promise.all([rodadaRelogio.ocioso(), rodadaFluxos.ocioso(), rodadaAgendadas.ocioso(), rodadaTransmissoes.ocioso(), rodadaWebhooks.ocioso(), rodadaReserva.ocioso()]).catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    await notificador.ocioso().catch(() => {});
    await integracoes.webhooks.ocioso().catch(() => {});
    await whatsappSaude.ocioso().catch(() => {});
    await pool?.end().catch(() => {});
    await poolTravas?.end().catch(() => {});
    process.exit(0);
  });
}
log(`Sintonia no ar na porta ${cfg.PORT} com ${numeros.length} número(s) conectado(s).`);
