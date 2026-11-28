import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { respostaDeErro, type AutenticadorApi } from './api.js';
import { temEscopo, type Escopo } from './catalogo.js';
import { MoverLead, NovaTarefa, type Contexto, type ServicoApi } from './servico.js';

/**
 * Servidor MCP da Sintonia em /mcp (transporte "Streamable HTTP", sem estado), autenticado pela chave de API.
 * Implementa o mínimo do protocolo em JSON-RPC 2.0: initialize, notifications/initialized, ping, tools/list
 * e tools/call. Cada ferramenta exige os mesmos escopos da rota equivalente da API v1, e a lista só mostra
 * as ferramentas que a chave pode usar. Respostas sempre em application/json (o servidor não abre fluxo SSE).
 * Por que não o SDK oficial (@modelcontextprotocol/sdk): ele traz o Express e o zod 3 como dependências,
 * e a pasta node_modules é dividida entre várias cópias do projeto; o protocolo necessário é pequeno.
 */

export const VERSOES_MCP = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

interface Ferramenta {
  nome: string;
  titulo: string;
  descricao: string;
  escopos: Escopo[];
  entrada: z.ZodObject;
  somenteLeitura: boolean;
  executar: (ctx: Contexto, args: Record<string, unknown>, s: ServicoApi) => Promise<unknown>;
}

const Id = z.string().describe('Id da conversa (vem de buscar_contato ou listar_conversas).');

export const FERRAMENTAS: Ferramenta[] = [
  {
    nome: 'buscar_contato', titulo: 'Buscar contato', somenteLeitura: true, escopos: ['contatos:ler'],
    descricao: 'Procura contatos pelo nome ou pelo telefone. Devolve a ficha, as tags e as conversas de cada um.',
    entrada: z.object({ busca: z.string().min(1).max(80).describe('Nome ou parte do telefone.'), limite: z.number().int().min(1).max(25).default(10) }),
    executar: (ctx, a, s) => s.listarContatos(ctx, { busca: String(a.busca), limite: Number(a.limite ?? 10) }),
  },
  {
    nome: 'listar_conversas', titulo: 'Listar conversas', somenteLeitura: true, escopos: ['conversas:ler'],
    descricao: 'Conversas mais recentes da empresa, com etapa, tags e quem atende. Filtre por etapa ou unidade.',
    entrada: z.object({
      limite: z.number().int().min(1).max(50).default(20),
      etapa: z.enum(['entrada', 'novo_lead', 'em_conversa', 'interessada', 'agendada', 'compareceu', 'manutencao', 'perdida']).optional(),
      cursor: z.string().optional().describe('proximoCursor da chamada anterior.'),
    }),
    executar: (ctx, a, s) => s.listarConversas(ctx, { limite: Number(a.limite ?? 20), etapa: a.etapa as never, cursor: a.cursor as string | undefined }),
  },
  {
    nome: 'ver_conversa', titulo: 'Ver conversa', somenteLeitura: true, escopos: ['conversas:ler', 'mensagens:ler'],
    descricao: 'Mostra a conversa (etapa, tags, funis, valor) e as últimas mensagens, da mais nova para a mais antiga.',
    entrada: z.object({ conversaId: Id, limiteMensagens: z.number().int().min(1).max(100).default(30) }),
    executar: async (ctx, a, s) => ({ conversa: await s.verConversa(ctx, String(a.conversaId)), mensagens: (await s.listarMensagens(ctx, String(a.conversaId), { limite: Number(a.limiteMensagens ?? 30) })).dados }),
  },
  {
    nome: 'enviar_mensagem', titulo: 'Enviar mensagem', somenteLeitura: false, escopos: ['mensagens:escrever'],
    descricao: 'Envia uma mensagem de WhatsApp pela empresa, numa conversa (conversaId) ou para um número (telefone). Confirme o texto com a pessoa antes de enviar.',
    entrada: z.object({
      conversaId: z.string().optional().describe('Conversa onde enviar.'),
      telefone: z.string().optional().describe('Ou o telefone com DDI e DDD (ex.: 5571988124471).'),
      texto: z.string().min(1).max(4096),
    }),
    executar: (ctx, a, s) => {
      if (a.conversaId) return s.enviarNaConversa(ctx, String(a.conversaId), String(a.texto));
      if (a.telefone) return s.enviarParaNumero(ctx, { telefone: String(a.telefone), texto: String(a.texto) });
      throw Object.assign(new Error('Informe conversaId ou telefone.'), { statusCode: 400 });
    },
  },
  {
    nome: 'listar_funis', titulo: 'Listar funis', somenteLeitura: true, escopos: ['funis:ler'],
    descricao: 'Funis de venda com as etapas e quantos leads há em cada uma.',
    entrada: z.object({}),
    executar: (ctx, _a, s) => s.listarFunis(ctx),
  },
  {
    nome: 'mover_lead', titulo: 'Mover lead de etapa', somenteLeitura: false, escopos: ['funis:escrever'],
    descricao: 'Move o lead (conversa) para outra etapa, pelo nome da etapa ou pelo id. Use listar_funis para ver as etapas.',
    entrada: z.object({ conversaId: Id, etapa: z.string().optional().describe('Nome da etapa, ex.: "Interessada".'), etapaId: z.string().optional(), funilId: z.string().optional() }),
    executar: (ctx, a, s) => s.moverLead(ctx, String(a.conversaId), MoverLead.parse({ etapa: a.etapa, etapaId: a.etapaId, funilId: a.funilId })),
  },
  {
    nome: 'aplicar_tag', titulo: 'Aplicar tag', somenteLeitura: false, escopos: ['tags:escrever'],
    descricao: 'Coloca (ou, com remover: true, tira) uma tag que já existe numa conversa.',
    entrada: z.object({ conversaId: Id, tag: z.string().min(1).max(40).describe('Nome da tag.'), remover: z.boolean().default(false) }),
    executar: async (ctx, a, s) => {
      if (!a.remover) return s.aplicarTag(ctx, String(a.conversaId), { nome: String(a.tag) });
      const tags = (await s.listarTags(ctx)).dados;
      const t = tags.find((x) => x.nome.toLowerCase() === String(a.tag).toLowerCase());
      if (!t) throw Object.assign(new Error(`A tag "${a.tag}" não existe.`), { statusCode: 404 });
      return s.removerTag(ctx, String(a.conversaId), t.id);
    },
  },
  {
    nome: 'listar_agendamentos', titulo: 'Listar agendamentos', somenteLeitura: true, escopos: ['agendamentos:ler'],
    descricao: 'Horários marcados (agenda e links de agendamento) num período. Sem datas: de ontem até 30 dias.',
    entrada: z.object({ de: z.string().datetime({ offset: true }).optional().describe('Início, ISO 8601 (ex.: 2026-12-01T00:00:00-03:00).'), ate: z.string().datetime({ offset: true }).optional() }),
    executar: (ctx, a, s) => s.listarAgendamentos(ctx, { de: a.de as string | undefined, ate: a.ate as string | undefined }),
  },
  {
    nome: 'criar_tarefa', titulo: 'Criar tarefa', somenteLeitura: false, escopos: ['tarefas:escrever'],
    descricao: 'Cria uma tarefa na rotina da equipe (ex.: "Ligar para a Maria amanhã às 10h"), ligada ou não a uma conversa.',
    entrada: z.object({
      titulo: z.string().min(2).max(140),
      descricao: z.string().max(2000).optional(),
      venceEm: z.string().datetime({ offset: true }).optional().describe('Prazo, ISO 8601 com fuso.'),
      conversaId: z.string().optional(),
      responsavelId: z.string().optional().describe('Pessoa da equipe (sem isto, quem criou a chave).'),
      prioridade: z.enum(['baixa', 'normal', 'alta']).default('normal'),
    }),
    executar: (ctx, a, s) => s.criarTarefa(ctx, NovaTarefa.parse({ ...a, venceEm: a.venceEm ?? null })),
  },
];

const esquemaJson = (e: z.ZodObject) => {
  const { $schema: _s, ...resto } = z.toJSONSchema(e, { io: 'input' }) as Record<string, unknown>;
  return resto;
};

type Mensagem = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
const resposta = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const falha = (id: unknown, code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });

export interface OpcoesMcp {
  autenticador: AutenticadorApi;
  servico: ServicoApi;
  versao?: string;
  log?: (msg: string, extra?: unknown) => void;
}

export function registrarMcp(app: FastifyInstance, o: OpcoesMcp): void {
  /** O que esta chave pode usar. */
  const permitidas = (req: FastifyRequest) => FERRAMENTAS.filter((f) => f.escopos.every((e) => temEscopo(req.api!.chave.escopos, e)));

  async function tratar(req: FastifyRequest, m: Mensagem, usadas: string[]): Promise<object | null> {
    const id = m.id;
    const ehNotificacao = id === undefined;
    if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return ehNotificacao ? null : falha(id, -32600, 'Pedido inválido (JSON-RPC 2.0).');
    const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>;
    switch (m.method) {
      case 'initialize': {
        const pedida = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = (VERSOES_MCP as readonly string[]).includes(pedida) ? pedida : VERSOES_MCP[0];
        return resposta(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'sintonia', title: 'Sintonia CRM', version: o.versao ?? '1.0.0' },
          instructions: 'Ferramentas do CRM Sintonia da empresa dona da chave: contatos, conversas de WhatsApp, funis, tags, agendamentos e tarefas. Antes de enviar mensagem a um cliente, confirme o texto com a pessoa.',
        });
      }
      case 'ping':
        return ehNotificacao ? null : resposta(id, {});
      case 'tools/list':
        return resposta(id, {
          tools: permitidas(req).map((f) => ({
            name: f.nome, title: f.titulo, description: f.descricao, inputSchema: esquemaJson(f.entrada),
            annotations: { title: f.titulo, readOnlyHint: f.somenteLeitura, destructiveHint: false, idempotentHint: f.somenteLeitura, openWorldHint: f.nome === 'enviar_mensagem' },
          })),
        });
      case 'tools/call': {
        const nome = String(params.name ?? '');
        const f = FERRAMENTAS.find((x) => x.nome === nome);
        if (!f) return falha(id, -32602, `Ferramenta desconhecida: ${nome}`);
        usadas.push(nome);
        const faltam = f.escopos.filter((e) => !temEscopo(req.api!.chave.escopos, e));
        const erro = (texto: string, extra?: object) => resposta(id, { content: [{ type: 'text', text: texto }], isError: true, ...(extra ? { structuredContent: extra } : {}) });
        if (faltam.length) return erro(`Esta chave não tem o escopo ${faltam.join(', ')}. Peça para a gestão liberar em Integrações › Chaves de API.`, { erro: { codigo: 'sem_permissao', escoposNecessarios: faltam } });
        const args = f.entrada.safeParse(params.arguments ?? {});
        if (!args.success) return erro(`Argumentos inválidos: ${args.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ')}`);
        try {
          const r = await f.executar(req.api!.ctx, args.data as Record<string, unknown>, o.servico);
          const estruturado = r && typeof r === 'object' && !Array.isArray(r) ? r : { resultado: r };
          return resposta(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], structuredContent: estruturado });
        } catch (e) {
          const x = respostaDeErro(e, o.log);
          return erro(x.corpo.erro.mensagem, x.corpo);
        }
      }
      default:
        if (ehNotificacao) return null; // notifications/initialized, notifications/cancelled...
        return falha(id, -32601, `Método não suportado: ${m.method}`);
    }
  }

  void app.register(async (mcp) => {
    mcp.addHook('onRequest', async (req, reply) => {
      reply.header('cache-control', 'no-store');
      // Proteção contra DNS rebinding pedida pelo protocolo: navegador de outro site não chama o /mcp.
      const origem = req.headers.origin;
      if (origem && origem !== 'null') {
        let host = '';
        try { host = new URL(origem).host; } catch { /* inválida */ }
        const nosso = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
        if (!host || host !== nosso) return reply.code(403).send(falha(null, -32000, 'Origem não permitida.'));
      }
      if (req.method !== 'POST') return reply.header('allow', 'POST').code(405).send(falha(null, -32000, 'Use POST (este servidor não abre fluxo SSE).'));
      if (!(await o.autenticador.autenticar(req, reply, 'mcp'))) return reply;
    });
    mcp.addHook('onResponse', async (req, reply) => {
      o.autenticador.registrarUso(req, reply.statusCode, (req as FastifyRequest & { rotaMcp?: string }).rotaMcp ?? 'MCP');
    });
    mcp.setErrorHandler((erro, _req, reply) => {
      const status = (erro as { statusCode?: number }).statusCode;
      return reply.code(status === 413 ? 413 : 400).send(falha(null, -32700, 'JSON inválido.'));
    });
    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
      const corpo = req.body as unknown;
      const lote = Array.isArray(corpo);
      const lista = (lote ? corpo : [corpo]) as Mensagem[];
      if (!lista.length || lista.some((x) => !x || typeof x !== 'object')) return reply.code(400).send(falha(null, -32600, 'Pedido inválido.'));
      const usadas: string[] = [];
      const respostas = (await Promise.all(lista.map((m) => tratar(req, m, usadas)))).filter((x): x is object => x !== null);
      (req as FastifyRequest & { rotaMcp?: string }).rotaMcp = `MCP ${lista.map((m) => String(m.method ?? '?')).join(', ')}${usadas.length ? ` (${usadas.join(', ')})` : ''}`.slice(0, 200);
      const pv = typeof req.headers['mcp-protocol-version'] === 'string' ? req.headers['mcp-protocol-version'] : undefined;
      if (pv) reply.header('mcp-protocol-version', pv);
      if (!respostas.length) return reply.code(202).send();
      return reply.type('application/json').send(lote ? respostas : respostas[0]);
    };
    mcp.route({ method: ['POST', 'GET', 'DELETE'], url: '/mcp', handler });
  });
}
