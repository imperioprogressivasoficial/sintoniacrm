import Fastify, { type FastifyInstance } from 'fastify';
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
import { registrarPaginas } from './web/paginas.js';
import { atualizacoesDeHoje } from './app/atualizacoes.js';
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

  // ---------- API da tela do CRM ----------
  // Atenção: antes de expor na internet, estas rotas precisam de login (Fase 1).
  app.get('/api/conversas', async () => {
    const [lista, ultimas] = await Promise.all([d.repo.listarConversas(), d.repo.ultimasMensagens()]);
    return lista
      .sort((a, b) => b.atualizadaEm.getTime() - a.atualizadaEm.getTime())
      .map((c) => {
        const m = ultimas.get(c.id);
        return { ...c, ultima: m ? { autor: m.autor, autorNome: m.autorNome, texto: m.texto.slice(0, 140), em: m.em } : null };
      });
  });

  app.get('/api/conversas/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const conversa = await d.repo.buscarConversa(id);
    if (!conversa) return reply.code(404).send();
    return { conversa, mensagens: await d.repo.mensagens(id, 200), sugestao: await d.repo.sugestao(id) };
  });

  app.get('/api/conversas/:id/foto', async (req, reply) => {
    const c = await d.repo.buscarConversa((req.params as { id: string }).id);
    const foto = c && d.fotos ? await d.fotos.da(c) : null;
    // "Sem foto" nunca fica guardado no navegador: assim que a foto existir, ela aparece.
    if (!foto) return reply.header('cache-control', 'no-store').code(204).send();
    return reply.header('cache-control', 'private, max-age=3600').type(foto.tipo).send(foto.conteudo);
  });

  app.post('/api/conversas/:id/digitando', async (req) => {
    await d.sintonia.equipeDigitando((req.params as { id: string }).id);
    return { ok: true };
  });

  const Envio = z.object({ texto: z.string().min(1), atendente: z.string().min(1) });
  app.post('/api/conversas/:id/enviar', async (req) => {
    const b = Envio.parse(req.body);
    await d.sintonia.equipeEnviou((req.params as { id: string }).id, b.texto, b.atendente);
    return { ok: true };
  });

  const Modo = z.object({ modo: z.enum(['ia', 'copiloto', 'humano']) });
  app.post('/api/conversas/:id/modo', async (req) => {
    await d.sintonia.mudarModo((req.params as { id: string }).id, Modo.parse(req.body).modo);
    return { ok: true };
  });

  const Rascunho = z.object({ rascunho: z.string().min(1) });
  app.post('/api/conversas/:id/revisar', async (req, reply) => {
    if (!d.revisar) return reply.code(501).send({ erro: 'Revisão indisponível' });
    return d.revisar((req.params as { id: string }).id, Rascunho.parse(req.body).rascunho);
  });

  const agora = d.agora ?? (() => new Date());
  // Lista de falhas da fila (mensagens que não conseguimos processar depois de várias tentativas).
  app.get('/api/fila/falhas', async (_req, reply) => {
    if (!d.fila) return reply.code(404).send();
    return d.fila.fila.falhas();
  });
  app.post('/api/fila/falhas/:id/reprocessar', async (req, reply) => {
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

  // ---------- aba Atualizações ----------
  app.get('/api/atualizacoes', async () => atualizacoesDeHoje(d.repo, agora()));

  app.get('/api/relatorio', async () => ({ texto: await d.sintonia.relatorioDoDia(agora()) }));
  app.get('/api/painel', async () => d.sintonia.resumoDoDia(agora()));

  // ---------- Botão "Agendar" dentro do CRM (sem abrir o Trinks) ----------
  const UnidadeQ = z.enum(['norte', 'sumare']);

  async function conversaOu404(id: string) {
    const c = await d.repo.buscarConversa(id);
    if (!c) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    return c;
  }
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
    atendente: z.string().min(1),
    /** Envia a confirmação padrão para a cliente pelo WhatsApp. */
    enviarConfirmacao: z.boolean().default(true),
  });

  app.post('/api/conversas/:id/agendar', async (req, reply) => {
    const b = Agendar.parse(req.body);
    const conversa = await conversaOu404((req.params as { id: string }).id);
    try {
      const r = await agendarNoTrinks(
        exigeAgenda(),
        conversa,
        { ...b, origem: `${b.atendente} pelo CRM` },
        agora(),
      );
      await d.sintonia.equipeAgendou(conversa.id, { tipo: 'agendou', agendamento: r.agendamento, clienteTrinksId: r.clienteTrinksId }, b.atendente);
      const confirmacao = textoConfirmacao(conversa.nome ?? b.nomeCliente, r);
      if (b.enviarConfirmacao) await d.sintonia.equipeEnviou(conversa.id, confirmacao, b.atendente);
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
