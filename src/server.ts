import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Sintonia } from './app/sintonia.js';
import type { CanalWhatsApp } from './channels/tipos.js';
import type { Repositorio } from './store/repositorio.js';
import { assinaturaMetaValida, ErroMeta } from './channels/meta.js';
import type { Leituras } from './app/leituras.js';
import type { Revisao } from './ai/copiloto.js';
import type { Agenda } from './ai/ferramentas.js';
import type { FilaEntrada } from './fila/entrada.js';
import type { MensagemRecebida, StatusRecebido } from './channels/tipos.js';
import { registrarAuth, type OpcoesAuth } from './auth/rotas.js';
import { podeAssumir, podeReceber, podeTransferir, podeVer, veTudo } from './auth/acesso.js';
import type { Conversa } from './domain.js';
import { registrarPaginas } from './web/paginas.js';
import { atualizacoesDeHoje } from './app/atualizacoes.js';
import { ligacoesDoDia, quemLigar, registrarLigacao } from './app/ligacoes.js';
import { direcaoDoAviso, lerChamadasEvolution, type ArmazemChamadas } from './ligacoes/chamadas.js';
import { registrarLigacoes } from './ligacoes/rotas.js';
import { bahia, DIA, partesBahia } from './util/tempo.js';
import { registrarContatos } from './contatos/rotas.js';
import type { ArmazemContatos } from './contatos/contatos.js';
import { registrarConexoes, type OpcoesConexoes } from './conexoes/rotas.js';
import { registrarWebhooksSociais, type OpcoesWebhooksSociais } from './conexoes/sociais.js';
import { registrarRotasMidia } from './web/midias.js';
import { agendar, agendaDaUnidade, ErroAgendamento, horariosLivres, textoConfirmacao } from './agenda/agendar.js';
import { ErroIntegracaoPendente } from './agenda/sistema.js';
import { registrarGestao, type OpcoesGestao } from './rotas/gestao.js';
import { fontePainelPara } from './painel/painel.js';
import { cabecalhoNotificacoes, problemasDaSituacao, registrarNotificacoes, type OpcoesNotificacoes } from './notificacoes/rotas.js';

export interface DependenciasServidor {
  sintonia: Sintonia;
  repo: Repositorio;
  evolution?: { canal: CanalWhatsApp; token?: string };
  /** Histórico de ligações (tela Ligações) e o evento CALL do WhatsApp (Evolution). */
  chamadas?: { armazem: ArmazemChamadas; empresaId: string; canalDaInstancia?: (instancia: string) => string | undefined };
  /** WhatsApp oficial (Meta). Lido a cada webhook: as unidades podem mudar pela tela de Conexões. */
  meta?: OpcoesWebhookMeta;
  /** Facebook Messenger, Instagram Direct e leads do TikTok (lido a cada webhook). */
  sociais?: OpcoesWebhooksSociais;
  revisar?: (conversaId: string, rascunho: string) => Promise<Revisao>;
  /** Fila persistente: o webhook só grava e responde; os trabalhadores processam. */
  fila?: { fila: FilaEntrada; avisar?: () => void };
  /** Agenda do salão (Trinks, Avec ou AppBarber, por unidade): habilita o botão "Agendar" dentro do CRM. */
  agenda?: Agenda;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Login. Sem ele, a API fica aberta (só para teste local). */
  auth?: OpcoesAuth;
  /** Tela de Conexões (chaves da IA, Trinks, Evolution e QR Code do WhatsApp). */
  conexoes?: Omit<OpcoesConexoes, 'auth'>;
  /** Ficha do contato e campos personalizados. */
  contatos?: { armazem: ArmazemContatos; empresaId: string };
  /** Fotos de perfil das clientes. */
  fotos?: { da(c: import('./domain.js').Conversa): Promise<{ conteudo: Buffer; tipo: string } | null> };
  /** O que está ligado, para a tela avisar (IA, agenda, números). */
  situacao?: () => { iaLigada: boolean; agendaLigada: boolean; numerosReais: number; canais?: Record<string, boolean>; agenda?: { chave: boolean; unidades: Array<{ id: string; nome: string; estabelecimento: boolean; sistema?: string; sistemaNome?: string | null; falta?: string[]; pronta?: boolean }> } };
  /** Simulador: uma "cliente" escreve pelo WhatsApp de teste (texto e, se quiser, uma mídia de teste). */
  clienteTeste?: (p: {
    unidade: 'norte' | 'sumare';
    nome: string;
    telefone: string;
    texto?: string;
    midia?: { base64: string; mimetype: string; nomeArquivo?: string; duracaoSeg?: number };
    /** Simula a cliente chegando por um anúncio de clique para WhatsApp. */
    anuncio?: { adId?: string; titulo?: string; texto?: string; url?: string; miniaturaUrl?: string; ctwaClid?: string };
  }) => Promise<void>;
  /** Baixador de mídias recebidas (fotos, áudios...): avisado para tentar de novo. */
  midias?: { avisar(): void };
  /** Tags, aba IA (configuração, treinamento, testar), painel completo e empresa. */
  /** Sino, notificações e push (Web Push). */
  notificacoes?: OpcoesNotificacoes;
  /** Até onde cada pessoa leu cada conversa ("não lida" por atendente). */
  leituras?: Leituras;
  /** Origem do lead (src/rastreio): selo e ícone de cada conversa, para a lista. */
  origens?: (ids: string[]) => Promise<Record<string, { icone: string; canal?: string; rotulo?: string; campanha?: string }>>;
  gestao?: Partial<Pick<OpcoesGestao, 'tags' | 'empresa' | 'base' | 'painel' | 'simularIa' | 'iaLigada' | 'tagsDaIa'>>;
}

export interface OpcoesWebhookMeta {
  /** Lê as mensagens (e os avisos de entrega) do corpo. */
  canal: CanalWhatsApp;
  /** Verify Tokens aceitos na verificação do webhook (um por unidade). */
  verifyTokens: string[];
  /**
   * App Secrets que podem assinar o webhook. `numeros` = phone_number_id que cada um pode assinar
   * (sem `numeros`, qualquer um: configuração antiga por variável de ambiente).
   */
  segredos: Array<{ appSecret: string; numeros?: string[] }>;
  /** Só a configuração antiga sem META_APP_SECRET: aceita webhook sem assinatura. */
  semAssinatura?: boolean;
  /** Avisos de entrega/leitura. */
  status?: (lista: StatusRecebido[]) => Promise<unknown>;
}

export function criarServidor(d: DependenciasServidor): FastifyInstance {
  const app = Fastify({ logger: false });
  const log = d.log ?? (() => {});

  // Corpo bruto guardado para conferir a assinatura da Meta.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, corpo, feito) => {
    try {
      (req as unknown as { corpoBruto: string }).corpoBruto = String(corpo);
      feito(null, corpo ? JSON.parse(String(corpo)) : {});
    } catch (e) {
      feito(e as Error, undefined);
    }
  });

  // Login antes de tudo: o bloqueio da API vale para todas as rotas registradas depois.
  if (d.auth) registrarAuth(app, d.auth);
  registrarPaginas(app, d.auth);
  // Quando chegou o último webhook de cada número da API oficial (para a tela de Conexões mostrar se está chegando).
  const vistosMeta = new Map<string, Date>();
  if (d.conexoes) registrarConexoes(app, { ultimoWebhookMeta: (id) => vistosMeta.get(id), ...d.conexoes, auth: d.auth });

  /**
   * Com fila: grava e responde (se a gravação falhar, o WhatsApp recebe erro e reenvia).
   * Sem fila (teste local): processa em segundo plano.
   */
  async function entregar(canal: string, mensagens: MensagemRecebida[]): Promise<number> {
    if (!mensagens.length) return 0;
    if (d.fila) {
      const n = await d.fila.fila.enfileirar(canal, mensagens);
      d.fila.avisar?.();
      return n;
    }
    for (const m of mensagens) d.sintonia.receber(m).catch((e) => log(`Falha ao receber (${canal})`, String(e)));
    return mensagens.length;
  }

  /** Ligação de voz avisada pelo WhatsApp: perdida (offer/timeout/reject) ou recebida (accept), na conversa da cliente. */
  async function registrarChamadasWhatsapp(corpo: unknown): Promise<number> {
    const ch = d.chamadas!;
    let n = 0;
    for (const a of lerChamadasEvolution(corpo)) {
      const direcao = direcaoDoAviso(a.status);
      const ja = await ch.armazem.porIdExterno(ch.empresaId, a.idExterno);
      if (ja) {
        if (ja.direcao !== direcao && direcao === 'recebida') await ch.armazem.atualizar(ja.id, { direcao, resultado: a.status });
        continue;
      }
      const canalId = ch.canalDaInstancia?.(a.instancia) ?? a.instancia;
      const conversas = (await d.repo.listarConversas()).filter((c) => c.empresaId === ch.empresaId && c.telefone === a.telefone);
      const c = conversas.find((x) => x.canalId === canalId) ?? conversas[0];
      await ch.armazem.registrar({ empresaId: ch.empresaId, conversaId: c?.id ?? null, telefone: a.telefone, direcao, resultado: a.status, atendenteId: null, atendenteNome: null, unidade: c?.unidade ?? null, em: a.em ?? agora(), origem: 'whatsapp', idExterno: a.idExterno });
      n++;
    }
    return n;
  }

  app.get('/saude', async () => ({ ok: true, fila: d.fila ? await d.fila.fila.situacao() : undefined }));

  // ---------- WhatsApp não oficial (Evolution) ----------
  app.post('/webhooks/evolution', async (req, reply) => {
    if (!d.evolution) return reply.code(404).send();
    if (d.evolution.token && req.headers['x-sintonia-token'] !== d.evolution.token) return reply.code(401).send();
    const mensagens = d.evolution.canal.lerWebhook(req.body);
    const chamadas = d.chamadas ? await registrarChamadasWhatsapp(req.body).catch((e) => (log('Falha ao registrar ligação do WhatsApp', String(e)), 0)) : 0;
    return { recebidas: await entregar('evolution', mensagens), ...(chamadas ? { chamadas } : {}) };
  });

  // ---------- WhatsApp oficial (Meta) ----------
  // URL para colar no painel da Meta: /webhook/meta (a antiga /webhooks/meta continua valendo).
  const verificarMeta = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const q = req.query as Record<string, string | undefined>;
    const token = q['hub.verify_token'];
    if (d.meta && q['hub.mode'] === 'subscribe' && token && d.meta.verifyTokens.includes(token)) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send();
  };

  const receberMeta = async (req: FastifyRequest, reply: import('fastify').FastifyReply) => {
    const meta = d.meta;
    if (!meta) return reply.code(404).send();
    const bruto = (req as unknown as { corpoBruto?: string }).corpoBruto ?? '';
    const assinatura = typeof req.headers['x-hub-signature-256'] === 'string' ? req.headers['x-hub-signature-256'] : undefined;
    // Cada App Secret só vale para os números da unidade dele: uma unidade não assina pela outra.
    let liberado: (numero: string) => boolean;
    if (!meta.segredos.length) {
      if (!meta.semAssinatura) return reply.code(401).send();
      liberado = () => true;
    } else {
      const validos = meta.segredos.filter((s) => assinaturaMetaValida(bruto, assinatura, s.appSecret));
      if (!validos.length) return reply.code(401).send();
      liberado = (numero) => validos.some((s) => !s.numeros || s.numeros.includes(numero));
    }
    const mensagens = meta.canal.lerWebhook(req.body).filter((m) => liberado(m.canalId));
    const status = (meta.canal.lerStatus?.(req.body) ?? []).filter((x) => liberado(x.canalId));
    for (const id of new Set([...mensagens, ...status].map((x) => x.canalId))) vistosMeta.set(id, new Date());
    if (status.length && meta.status) await meta.status(status).catch((e) => log('Falha ao registrar entrega (Meta)', String(e)));
    return { recebidas: await entregar('meta', mensagens), status: status.length };
  };
  app.get('/webhook/meta', verificarMeta);
  app.get('/webhooks/meta', verificarMeta);
  app.post('/webhook/meta', receberMeta);
  app.post('/webhooks/meta', receberMeta);

  // ---------- Facebook Messenger, Instagram Direct e TikTok (leads) ----------
  registrarWebhooksSociais(app, () => d.sociais, entregar, log);

  // ---------- Quem vê o quê ----------
  // Sem login configurado (testes antigos, uso local) tudo fica visível, como antes.
  const visivelPara = (req: FastifyRequest) => (c: Conversa) => !req.usuario || podeVer(req.usuario, c);
  /** Conversa que a pessoa logada pode ver; a de outra pessoa dá 404 (não revela que existe). */
  async function conversaVisivel(req: FastifyRequest): Promise<Conversa> {
    const c = await d.repo.buscarConversa((req.params as { id: string }).id).catch(() => undefined);
    if (!c || !visivelPara(req)(c)) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    return c;
  }
  /** Nome de quem está agindo: o da sessão; sem login, o que veio no corpo. */
  const nomeDe = (req: FastifyRequest, doCorpo?: string): string => {
    const nome = req.usuario?.nome ?? doCorpo;
    if (!nome) throw Object.assign(new Error('Informe quem está atendendo.'), { statusCode: 400 });
    return nome;
  };

  // ---------- API da tela do CRM ----------
  // ?tag=<id> mostra só as conversas com essa tag. Cada conversa vem com as tags dela (id, nome, cor).
  app.get('/api/conversas', async (req, reply) => {
    await cabecalhoNotificacoes(d.notificacoes, req, reply);
    const { tag } = z.object({ tag: z.string().min(1).optional() }).parse(req.query);
    const [todas, ultimas] = await Promise.all([d.repo.listarConversas(), d.repo.ultimasMensagens()]);
    const lista = todas.filter(visivelPara(req));
    const tags = d.gestao?.tags ? await d.gestao.tags.dasConversas(lista.map((c) => c.id)) : new Map<string, Array<{ id: string; nome: string; cor: string }>>();
    const lidas = d.leituras && req.usuario ? await d.leituras.doUsuario(req.usuario.id) : new Map<string, Date>();
    const origens = d.origens ? await d.origens(lista.map((c) => c.id)).catch(() => ({}) as Record<string, never>) : undefined;
    return lista
      .filter((c) => !tag || (tags.get(c.id) ?? []).some((t) => t.id === tag))
      .sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime())
      .map((c) => {
        const m = ultimas.get(c.id);
        return { ...c, tags: tags.get(c.id) ?? [], ...(origens ? { origem: origens[c.id] ?? { icone: 'desconhecido' } } : {}), lidaAte: lidas.get(c.id) ?? null, ultima: m ? { autor: m.autor, autorNome: m.autorNome, texto: m.texto.slice(0, 140), em: m.em, anexo: m.anexo } : null };
      });
  });

  // Lidas e não lidas por pessoa (menu ⋯ da lista: marcar tudo como lido, selecionar conversas).
  const IdsLeitura = z.object({ ids: z.array(z.string().uuid()).max(2000).optional(), todas: z.boolean().optional() });
  app.post('/api/conversas/lidas', async (req, reply) => {
    if (!d.leituras || !req.usuario) return reply.code(501).send({ erro: 'Leitura por pessoa indisponível' });
    const b = IdsLeitura.parse(req.body ?? {});
    const visiveis = (await d.repo.listarConversas()).filter(visivelPara(req)).map((c) => c.id);
    const ids = b.todas ? visiveis : (b.ids ?? []).filter((id) => visiveis.includes(id));
    await d.leituras.marcar(req.usuario.id, ids, new Date());
    return { ok: true, marcadas: ids.length };
  });
  app.post('/api/conversas/nao-lidas', async (req, reply) => {
    if (!d.leituras || !req.usuario) return reply.code(501).send({ erro: 'Leitura por pessoa indisponível' });
    const b = IdsLeitura.parse(req.body ?? {});
    const visiveis = new Set((await d.repo.listarConversas()).filter(visivelPara(req)).map((c) => c.id));
    const ids = (b.ids ?? []).filter((id) => visiveis.has(id));
    await d.leituras.desmarcar(req.usuario.id, ids);
    return { ok: true, marcadas: ids.length };
  });

  app.get('/api/conversas/:id', async (req) => {
    const conversa = await conversaVisivel(req);
    const id = conversa.id;
    const u = req.usuario;
    if (u && d.leituras) await d.leituras.marcar(u.id, [id], new Date());
    // Quem mais está respondendo agora (sem horário, para a tela só redesenhar quando muda).
    const digitando = (await d.sintonia.quemEstaRespondendo(id))
      .filter((x) => x.usuarioId !== u?.id)
      .map((x) => ({ usuarioId: x.usuarioId, nome: x.nome }));
    const permissoes = u
      ? { assumir: podeAssumir(u, conversa) && conversa.responsavelId !== u.id, transferir: podeTransferir(u, conversa) }
      : { assumir: !conversa.responsavelId, transferir: true };
    const tags = d.gestao?.tags ? await d.gestao.tags.daConversa(id) : [];
    return {
      conversa: { ...conversa, tags },
      mensagens: await d.repo.mensagens(id, 200),
      sugestao: await d.repo.sugestao(id),
      digitando,
      permissoes,
      // API oficial: até quando dá para escrever livremente (depois, só modelo aprovado).
      janela: d.sintonia.janelaDa(conversa),
    };
  });

  app.get('/api/conversas/:id/foto', async (req, reply) => {
    const c = await conversaVisivel(req).catch(() => undefined);
    const foto = c && d.fotos ? await d.fotos.da(c) : null;
    // "Sem foto" nunca fica guardado no navegador: assim que a foto existir, ela aparece.
    if (!foto) return reply.header('cache-control', 'no-store').code(204).send();
    return reply.header('cache-control', 'private, max-age=3600').type(foto.tipo).send(foto.conteudo);
  });

  app.post('/api/conversas/:id/digitando', async (req) => {
    const c = await conversaVisivel(req);
    await d.sintonia.equipeDigitando(c.id, req.usuario);
    return { ok: true };
  });

  const Envio = z.object({ texto: z.string().min(1), atendente: z.string().min(1).optional() });
  app.post('/api/conversas/:id/enviar', async (req) => {
    const b = Envio.parse(req.body);
    const c = await conversaVisivel(req);
    await d.sintonia.equipeEnviou(c.id, b.texto, nomeDe(req, b.atendente), req.usuario);
    return { ok: true };
  });

  // ---------- API oficial: janela de 24 h, modelos aprovados e "lida" ----------
  const ModeloCorpo = z.object({
    nome: z.string().min(1).max(512),
    idioma: z.string().min(2).max(15),
    parametros: z.array(z.string().max(1024)).max(20).optional(),
    atendente: z.string().min(1).optional(),
  });
  app.get('/api/conversas/:id/modelos', async (req) => {
    const c = await conversaVisivel(req);
    return { janela: d.sintonia.janelaDa(c), modelos: await d.sintonia.modelosDa(c.id) };
  });
  app.post('/api/conversas/:id/modelo', async (req) => {
    const b = ModeloCorpo.parse(req.body);
    const c = await conversaVisivel(req);
    const r = await d.sintonia.equipeEnviouModelo(c.id, { nome: b.nome, idioma: b.idioma, parametros: b.parametros }, nomeDe(req, b.atendente), req.usuario);
    return { ok: true, texto: r.texto };
  });
  app.post('/api/conversas/:id/lida', async (req) => {
    const c = await conversaVisivel(req);
    // Abriu a conversa: as notificações dela deixam de contar no sino.
    if (req.usuario && d.notificacoes) await d.notificacoes.armazem.marcarDaConversa(req.usuario.id, c.id, agora()).catch(() => 0);
    return { ok: await d.sintonia.marcarLida(c.id) };
  });

  const Modo = z.object({ modo: z.enum(['ia', 'copiloto', 'humano']) });
  app.post('/api/conversas/:id/modo', async (req) => {
    const modo = Modo.parse(req.body).modo;
    const c = await conversaVisivel(req);
    await d.sintonia.mudarModo(c.id, modo);
    return { ok: true };
  });

  const Rascunho = z.object({ rascunho: z.string().min(1) });
  app.post('/api/conversas/:id/revisar', async (req, reply) => {
    const rascunho = Rascunho.parse(req.body).rascunho;
    const c = await conversaVisivel(req);
    if (!d.revisar) return reply.code(501).send({ erro: 'Revisão indisponível' });
    return d.revisar(c.id, rascunho);
  });

  // ---------- Dona da conversa: assumir, transferir, liberar ----------
  const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });
  const exigeLogin = (req: FastifyRequest) => {
    if (!req.usuario || !d.auth) throw Object.assign(new Error('Faça login para continuar.'), { statusCode: 401 });
    return { u: req.usuario, contas: d.auth.contas };
  };
  const resumoDona = (c: Conversa | undefined) => ({ ok: true, responsavelId: c?.responsavelId ?? null, responsavelNome: c?.responsavelNome ?? null });

  app.post('/api/conversas/:id/assumir', async (req) => {
    const { u } = exigeLogin(req);
    const c = await conversaVisivel(req);
    if (!podeAssumir(u, c)) throw proibido('Esta conversa já tem dona. Peça para a gerente transferir para você.');
    return resumoDona(await d.sintonia.definirResponsavel(c.id, { id: u.id, nome: u.nome }, u, 'assumiu'));
  });

  /** Pessoas que podem receber esta conversa (para a janela "Transferir"). */
  app.get('/api/conversas/:id/transferir', async (req) => {
    const { u, contas } = exigeLogin(req);
    const c = await conversaVisivel(req);
    if (!podeTransferir(u, c)) throw proibido('Só a dona da conversa ou a gerência pode transferir.');
    const pessoas = (await contas.listarUsuarios(u.empresaId)).filter((p) => podeReceber(p, c) && p.papel !== 'admin' && p.papel !== 'direcao');
    return pessoas.map((p) => ({ id: p.id, nome: p.nome, papel: p.papel, eu: p.id === u.id, dona: p.id === c.responsavelId }));
  });

  const Transferir = z.object({ usuarioId: z.string().min(1).nullable() });
  app.post('/api/conversas/:id/transferir', async (req) => {
    const { u, contas } = exigeLogin(req);
    const { usuarioId } = Transferir.parse(req.body);
    const c = await conversaVisivel(req);
    if (!podeTransferir(u, c)) throw proibido('Só a dona da conversa ou a gerência pode transferir.');
    if (usuarioId === null) return resumoDona(await d.sintonia.definirResponsavel(c.id, null, u, 'liberou'));
    const alvo = await contas.buscarPorId(usuarioId).catch(() => undefined);
    if (!alvo || !podeReceber(alvo, c)) {
      throw Object.assign(new Error('Essa pessoa não está ativa ou não atende esta unidade.'), { statusCode: 400 });
    }
    return resumoDona(await d.sintonia.definirResponsavel(c.id, { id: alvo.id, nome: alvo.nome }, u, alvo.id === u.id ? 'assumiu' : 'transferiu'));
  });

  const agora = d.agora ?? (() => new Date());
  // Lista de falhas da fila (mensagens que não conseguimos processar depois de várias tentativas).
  // Falhas mostram mensagens de qualquer conversa: só para quem vê tudo.
  const soQuemVeTudo = (req: FastifyRequest) => {
    if (req.usuario && !veTudo(req.usuario)) throw proibido('Só a direção e a administração veem as falhas da fila.');
  };
  app.get('/api/fila/falhas', async (req, reply) => {
    soQuemVeTudo(req);
    if (!d.fila) return reply.code(404).send();
    return d.fila.fila.falhas();
  });
  app.post('/api/fila/falhas/:id/reprocessar', async (req, reply) => {
    soQuemVeTudo(req);
    if (!d.fila) return reply.code(404).send();
    await d.fila.fila.reprocessar(Number((req.params as { id: string }).id), new Date());
    d.fila.avisar?.();
    return { ok: true };
  });

  app.get('/api/situacao', async () => ({
    ...(d.situacao?.() ?? { iaLigada: false, agendaLigada: Boolean(d.agenda), numerosReais: 0 }),
    simulador: Boolean(d.clienteTeste),
  }));

  const ClienteTeste = z
    .object({
      unidade: z.enum(['norte', 'sumare']),
      nome: z.string().trim().min(2).max(60),
      telefone: z.string().regex(/^5599\d{9}$/, 'Telefone de teste inválido'),
      texto: z.string().trim().max(2000).optional(),
      /** Mídia de teste: como se a cliente mandasse uma foto, áudio, vídeo ou documento. */
      midia: z
        .object({
          base64: z.string().min(1),
          mimetype: z.string().regex(/^[\w.+-]+\/[\w.+-]+(\s*;.*)?$/),
          nomeArquivo: z.string().trim().min(1).max(200).optional(),
          duracaoSeg: z.number().min(0).max(4 * 3600).optional(),
        })
        .optional(),
      anuncio: z
        .object({
          adId: z.string().regex(/^\d{5,25}$/).optional(),
          titulo: z.string().trim().max(200).optional(),
          texto: z.string().trim().max(500).optional(),
          url: z.string().url().max(500).optional(),
          miniaturaUrl: z.string().url().max(1000).optional(),
          ctwaClid: z.string().max(300).optional(),
        })
        .optional(),
    })
    .refine((b) => Boolean(b.texto) || Boolean(b.midia), 'Escreva a mensagem ou mande um arquivo');
  app.post('/api/teste/cliente', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    if (!d.clienteTeste) return reply.code(404).send({ erro: 'Simulador desligado' });
    await d.clienteTeste(ClienteTeste.parse(req.body));
    return { ok: true };
  });

  // ---------- Fotos, áudios, vídeos e documentos ----------
  if (d.contatos) registrarContatos(app, { contatos: d.contatos.armazem, empresaId: d.contatos.empresaId, conversaVisivel, renomear: (id, nome) => d.sintonia.renomearCliente(id, nome) });
  registrarRotasMidia(app, { sintonia: d.sintonia, repo: d.repo, midias: d.midias, agora: d.agora, conversaVisivel, quemDe: (req) => req.usuario });

  // Painel e relatório só contam as conversas que a pessoa pode ver.
  const filtroDe = (req: FastifyRequest) => (req.usuario && !veTudo(req.usuario) ? visivelPara(req) : undefined);
  app.get('/api/relatorio', async (req) => ({ texto: await d.sintonia.relatorioDoDia(agora(), filtroDe(req)) }));
  app.get('/api/painel', async (req) => d.sintonia.resumoDoDia(agora(), filtroDe(req)));

  // ---------- aba Atualizações (só do que a pessoa pode ver) ----------
  // O contador do sino vai junto (cabeçalho x-notificacoes; com ?notificacoes=1, também no corpo).
  app.get('/api/atualizacoes', async (req, reply) => {
    const ve = visivelPara(req);
    const gestao = !req.usuario || veTudo(req.usuario);
    const [lista, resumo] = await Promise.all([
      atualizacoesDeHoje(d.repo, agora(), (c, tipo) => (c ? ve(c) : gestao) && (tipo !== 'falha' || gestao)),
      cabecalhoNotificacoes(d.notificacoes, req, reply),
    ]);
    if ((req.query as { notificacoes?: string }).notificacoes === '1') {
      return { atualizacoes: lista, notificacoes: resumo ?? { naoLidas: 0, versao: 0, silencio: false } };
    }
    return lista;
  });

  // ---------- aba Ligações ----------
  app.get('/api/ligacoes', async (req) => {
    const p = partesBahia(agora());
    const inicio = bahia(p.ano, p.mes, p.dia);
    const ve = visivelPara(req);
    return {
      sugestoes: await quemLigar(d.repo, agora(), ve),
      hoje: await ligacoesDoDia(d.repo, inicio, new Date(inicio.getTime() + DIA), (c) => Boolean(c && ve(c))),
    };
  });
  const Ligacao = z.object({
    resultado: z.enum(['atendeu', 'nao_atendeu', 'agendou', 'caixa_postal']),
    nota: z.string().max(500).optional(),
    atendente: z.string().min(1).optional(),
    /** A ligação que o app já registrou ao tocar em Ligar (tela Ligações): só recebe o resultado. */
    chamadaId: z.string().max(64).optional(),
  });
  app.post('/api/conversas/:id/ligacao', async (req) => {
    const c = await conversaVisivel(req);
    const b = Ligacao.parse(req.body);
    await registrarLigacao(d.repo, c, { resultado: b.resultado, nota: b.nota, atendente: nomeDe(req, b.atendente), atendenteId: req.usuario?.id, agora: agora() });
    if (d.chamadas) {
      const ja = b.chamadaId ? await d.chamadas.armazem.buscar(b.chamadaId) : undefined;
      if (ja && ja.conversaId === c.id) await d.chamadas.armazem.atualizar(ja.id, { resultado: b.resultado });
      else await d.chamadas.armazem.registrar({ empresaId: c.empresaId, conversaId: c.id, telefone: c.telefone, direcao: 'efetuada', resultado: b.resultado, atendenteId: req.usuario?.id ?? null, atendenteNome: nomeDe(req, b.atendente), unidade: c.unidade, em: agora(), origem: 'app' });
    }
    return { ok: true };
  });
  if (d.chamadas) registrarLigacoes(app, { repo: d.repo, chamadas: d.chamadas.armazem, empresaId: d.chamadas.empresaId, agora });

  // ---------- Tags, aba IA, painel completo e empresa ----------
  registrarGestao(app, {
    ...d.gestao,
    repo: d.repo,
    agora,
    visivelPara,
    conversaVisivel,
    contas: d.auth?.contas,
    painel: d.gestao?.painel ?? fontePainelPara(d.repo),
  });

  // ---------- Botão "Agendar" dentro do CRM (sem abrir o Trinks) ----------
  const UnidadeQ = z.enum(['norte', 'sumare']);

  function exigeAgenda(): Agenda {
    if (!d.agenda) throw Object.assign(new Error('Agenda do salão não configurada (Conexões › Agenda)'), { statusCode: 501 });
    return d.agenda;
  }

  app.get('/api/agenda/servicos', async (req) => {
    const { unidade } = z.object({ unidade: UnidadeQ }).parse(req.query);
    const { sistema, local } = agendaDaUnidade(exigeAgenda(), unidade);
    const servicos = await sistema.listarServicos(local);
    return servicos
      .filter((s) => s.visivelParaCliente !== false)
      .map((s) => ({ id: s.id, nome: s.nome, categoria: s.categoria ?? null, duracaoMin: s.duracaoEmMinutos, preco: s.preco, precoHoje: s.valorPromocional ?? s.preco }));
  });

  app.get('/api/agenda/profissionais', async (req) => {
    const { unidade } = z.object({ unidade: UnidadeQ }).parse(req.query);
    const { sistema, local } = agendaDaUnidade(exigeAgenda(), unidade);
    const lista = await sistema.listarProfissionais(local);
    return lista.filter((p) => p.possuiAgenda !== false).map((p) => ({ id: p.id, nome: p.apelido || p.nome }));
  });

  app.get('/api/agenda/horarios', async (req) => {
    const q = z
      .object({
        unidade: UnidadeQ,
        data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        servicoId: z.coerce.number().int(),
        profissionalId: z.coerce.number().int().optional(),
      })
      .parse(req.query);
    return horariosLivres(exigeAgenda(), q.unidade, q.data, q.servicoId, q.profissionalId, agora());
  });

  const Agendar = z.object({
    unidade: UnidadeQ,
    servicoId: z.number().int(),
    profissionalId: z.number().int(),
    data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hora: z.string().regex(/^\d{1,2}:\d{2}$/),
    nomeCliente: z.string().min(3),
    /** Só sem login (teste local): com login vale o nome da sessão. */
    atendente: z.string().min(1).optional(),
    /** Envia a confirmação padrão para a cliente pelo WhatsApp. */
    enviarConfirmacao: z.boolean().default(true),
  });

  app.post('/api/conversas/:id/agendar', async (req, reply) => {
    const b = Agendar.parse(req.body);
    const conversa = await conversaVisivel(req);
    const atendente = nomeDe(req, b.atendente);
    // Anti-duplicidade antes de gravar no Trinks: se outra pessoa já está respondendo, nada é marcado.
    if (req.usuario) await d.sintonia.conferirVez(conversa.id, req.usuario);
    try {
      const r = await agendar(
        exigeAgenda(),
        conversa,
        { ...b, origem: `${atendente} pelo CRM` },
        agora(),
      );
      await d.sintonia.equipeAgendou(conversa.id, { tipo: 'agendou', agendamento: r.agendamento, clienteTrinksId: r.clienteTrinksId }, atendente, req.usuario);
      const confirmacao = textoConfirmacao(conversa.nome ?? b.nomeCliente, r);
      if (b.enviarConfirmacao) await d.sintonia.equipeEnviou(conversa.id, confirmacao, atendente, req.usuario);
      return { ok: true, agendamentoId: r.agendamento.trinksId, valor: r.valor, confirmacao };
    } catch (e) {
      if (e instanceof ErroAgendamento) {
        return reply.code(e.codigo === 'horario_ocupado' ? 409 : 400).send({ erro: e.message, codigo: e.codigo });
      }
      throw e;
    }
  });

  if (d.notificacoes) registrarNotificacoes(app, { agora, problemas: d.situacao ? () => problemasDaSituacao(d.situacao!()) : undefined, ...d.notificacoes });

  app.setErrorHandler((erro, _req, reply) => {
    if (erro instanceof z.ZodError) return reply.code(400).send({ erro: 'Dados inválidos', detalhes: erro.issues });
    if (erro instanceof ErroAgendamento) return reply.code(400).send({ erro: erro.message, codigo: erro.codigo });
    if (erro instanceof ErroIntegracaoPendente) return reply.code(501).send({ erro: erro.message, codigo: 'integracao_pendente', sistema: erro.tipo });
    // Recusa da Graph API (API oficial): a mensagem explicada chega à tela. Fora da janela de 24 h = 422.
    if (erro instanceof ErroMeta) {
      return erro.codigo === 131047
        ? reply.code(422).send({ erro: erro.message, codigo: 'fora_da_janela' })
        : reply.code(502).send({ erro: erro.message, codigo: 'meta' });
    }
    const status = (erro as { statusCode?: number }).statusCode;
    const codigo = (erro as { codigo?: string }).codigo;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ erro: (erro as Error).message, ...(codigo ? { codigo } : {}) });
    if (status === 501) return reply.code(501).send({ erro: (erro as Error).message });
    log('Erro na API', String(erro));
    return reply.code(500).send({ erro: 'Erro interno' });
  });

  return app;
}
