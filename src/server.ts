import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Sintonia } from './app/sintonia.js';
import type { CanalWhatsApp } from './channels/tipos.js';
import type { Repositorio } from './store/repositorio.js';
import { assinaturaMetaValida } from './channels/meta.js';
import type { Revisao } from './ai/copiloto.js';
import type { Agenda } from './ai/ferramentas.js';
import type { FilaEntrada } from './fila/entrada.js';
import type { MensagemRecebida } from './channels/tipos.js';
import { registrarAuth, type OpcoesAuth } from './auth/rotas.js';
import { podeAssumir, podeReceber, podeTransferir, podeVer, veTudo } from './auth/acesso.js';
import type { Conversa } from './domain.js';
import { registrarPaginas } from './web/paginas.js';
import { atualizacoesDeHoje } from './app/atualizacoes.js';
import { ligacoesDoDia, quemLigar, registrarLigacao } from './app/ligacoes.js';
import { bahia, DIA, partesBahia } from './util/tempo.js';
import { registrarConexoes, type OpcoesConexoes } from './conexoes/rotas.js';
import { agendarNoTrinks, ErroAgendamento, estabelecimentoDa, horariosLivres, textoConfirmacao } from './agenda/agendar.js';

export interface DependenciasServidor {
  sintonia: Sintonia;
  repo: Repositorio;
  evolution?: { canal: CanalWhatsApp; token?: string };
  meta?: { canal: CanalWhatsApp; verifyToken?: string; appSecret?: string };
  revisar?: (conversaId: string, rascunho: string) => Promise<Revisao>;
  /** Fila persistente: o webhook só grava e responde; os trabalhadores processam. */
  fila?: { fila: FilaEntrada; avisar?: () => void };
  /** Trinks: habilita o botão "Agendar" dentro do CRM. */
  agenda?: Agenda;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
  /** Login. Sem ele, a API fica aberta (só para teste local). */
  auth?: OpcoesAuth;
  /** Tela de Conexões (chaves da IA, Trinks, Evolution e QR Code do WhatsApp). */
  conexoes?: Omit<OpcoesConexoes, 'auth'>;
  /** Fotos de perfil das clientes. */
  fotos?: { da(c: import('./domain.js').Conversa): Promise<{ conteudo: Buffer; tipo: string } | null> };
  /** O que está ligado, para a tela avisar (IA, agenda, números). */
  situacao?: () => { iaLigada: boolean; agendaLigada: boolean; numerosReais: number };
  /** Simulador: uma "cliente" escreve pelo WhatsApp de teste. */
  clienteTeste?: (p: { unidade: 'norte' | 'sumare'; nome: string; telefone: string; texto: string }) => Promise<void>;
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
  if (d.conexoes) registrarConexoes(app, { ...d.conexoes, auth: d.auth });

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

  app.get('/saude', async () => ({ ok: true, fila: d.fila ? await d.fila.fila.situacao() : undefined }));

  // ---------- WhatsApp não oficial (Evolution) ----------
  app.post('/webhooks/evolution', async (req, reply) => {
    if (!d.evolution) return reply.code(404).send();
    if (d.evolution.token && req.headers['x-sintonia-token'] !== d.evolution.token) return reply.code(401).send();
    const mensagens = d.evolution.canal.lerWebhook(req.body);
    return { recebidas: await entregar('evolution', mensagens) };
  });

  // ---------- WhatsApp oficial (Meta) ----------
  app.get('/webhooks/meta', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (d.meta?.verifyToken && q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === d.meta.verifyToken) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send();
  });

  app.post('/webhooks/meta', async (req, reply) => {
    if (!d.meta) return reply.code(404).send();
    if (d.meta.appSecret) {
      const bruto = (req as unknown as { corpoBruto?: string }).corpoBruto ?? '';
      const assinatura = req.headers['x-hub-signature-256'];
      if (!assinaturaMetaValida(bruto, typeof assinatura === 'string' ? assinatura : undefined, d.meta.appSecret)) {
        return reply.code(401).send();
      }
    }
    const mensagens = d.meta.canal.lerWebhook(req.body);
    return { recebidas: await entregar('meta', mensagens) };
  });

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
  app.get('/api/conversas', async (req) => {
    const [lista, ultimas] = await Promise.all([d.repo.listarConversas(), d.repo.ultimasMensagens()]);
    return lista
      .filter(visivelPara(req))
      .sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime())
      .map((c) => {
        const m = ultimas.get(c.id);
        return { ...c, ultima: m ? { autor: m.autor, autorNome: m.autorNome, texto: m.texto.slice(0, 140), em: m.em } : null };
      });
  });

  app.get('/api/conversas/:id', async (req) => {
    const conversa = await conversaVisivel(req);
    const id = conversa.id;
    const u = req.usuario;
    // Quem mais está respondendo agora (sem horário, para a tela só redesenhar quando muda).
    const digitando = (await d.sintonia.quemEstaRespondendo(id))
      .filter((x) => x.usuarioId !== u?.id)
      .map((x) => ({ usuarioId: x.usuarioId, nome: x.nome }));
    const permissoes = u
      ? { assumir: podeAssumir(u, conversa) && conversa.responsavelId !== u.id, transferir: podeTransferir(u, conversa) }
      : { assumir: !conversa.responsavelId, transferir: true };
    return { conversa, mensagens: await d.repo.mensagens(id, 200), sugestao: await d.repo.sugestao(id), digitando, permissoes };
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

  const ClienteTeste = z.object({
    unidade: z.enum(['norte', 'sumare']),
    nome: z.string().trim().min(2).max(60),
    telefone: z.string().regex(/^5599\d{9}$/, 'Telefone de teste inválido'),
    texto: z.string().trim().min(1).max(2000),
  });
  app.post('/api/teste/cliente', async (req, reply) => {
    if (!d.clienteTeste) return reply.code(404).send({ erro: 'Simulador desligado' });
    await d.clienteTeste(ClienteTeste.parse(req.body));
    return { ok: true };
  });

  // Painel e relatório só contam as conversas que a pessoa pode ver.
  const filtroDe = (req: FastifyRequest) => (req.usuario && !veTudo(req.usuario) ? visivelPara(req) : undefined);
  app.get('/api/relatorio', async (req) => ({ texto: await d.sintonia.relatorioDoDia(agora(), filtroDe(req)) }));
  app.get('/api/painel', async (req) => d.sintonia.resumoDoDia(agora(), filtroDe(req)));

  // ---------- aba Atualizações (só do que a pessoa pode ver) ----------
  app.get('/api/atualizacoes', async (req) => {
    const ve = visivelPara(req);
    const gestao = !req.usuario || veTudo(req.usuario);
    return atualizacoesDeHoje(d.repo, agora(), (c, tipo) => (c ? ve(c) : gestao) && (tipo !== 'falha' || gestao));
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
  });
  app.post('/api/conversas/:id/ligacao', async (req) => {
    const c = await conversaVisivel(req);
    const b = Ligacao.parse(req.body);
    await registrarLigacao(d.repo, c, { resultado: b.resultado, nota: b.nota, atendente: nomeDe(req, b.atendente), agora: agora() });
    return { ok: true };
  });

  // ---------- Botão "Agendar" dentro do CRM (sem abrir o Trinks) ----------
  const UnidadeQ = z.enum(['norte', 'sumare']);

  function exigeAgenda(): Agenda {
    if (!d.agenda) throw Object.assign(new Error('Agenda (Trinks) não configurada'), { statusCode: 501 });
    return d.agenda;
  }

  app.get('/api/agenda/servicos', async (req) => {
    const { unidade } = z.object({ unidade: UnidadeQ }).parse(req.query);
    const servicos = await exigeAgenda().listarServicos(estabelecimentoDa(unidade));
    return servicos
      .filter((s) => s.visivelParaCliente !== false)
      .map((s) => ({ id: s.id, nome: s.nome, categoria: s.categoria ?? null, duracaoMin: s.duracaoEmMinutos, preco: s.preco, precoHoje: s.valorPromocional ?? s.preco }));
  });

  app.get('/api/agenda/profissionais', async (req) => {
    const { unidade } = z.object({ unidade: UnidadeQ }).parse(req.query);
    const lista = await exigeAgenda().listarProfissionais(estabelecimentoDa(unidade));
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
      const r = await agendarNoTrinks(
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

  app.setErrorHandler((erro, _req, reply) => {
    if (erro instanceof z.ZodError) return reply.code(400).send({ erro: 'Dados inválidos', detalhes: erro.issues });
    if (erro instanceof ErroAgendamento) return reply.code(400).send({ erro: erro.message, codigo: erro.codigo });
    const status = (erro as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ erro: (erro as Error).message });
    if (status === 501) return reply.code(501).send({ erro: (erro as Error).message });
    log('Erro na API', String(erro));
    return reply.code(500).send({ erro: 'Erro interno' });
  });

  return app;
}
