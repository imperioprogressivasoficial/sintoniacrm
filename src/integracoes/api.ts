import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErroMeta } from '../channels/meta.js';
import type { ArmazemIntegracoes, ChaveApi } from './armazem.js';
import { temEscopo, type Escopo } from './catalogo.js';
import { chaveDoCabecalho, hashConfere, prefixoDe } from './chaves.js';
import {
  AplicarTag, EnvioNumero, ErroApi, FiltroAgendamentos, FiltroContatos, FiltroConversas, FiltroMensagens, FiltroTarefas, Limite,
  MoverLead, NovaTarefa, NovoAgendamento, NovoContato, ValorLead, type Contexto, type ServicoApi,
} from './servico.js';
import { EdicaoContato } from '../contatos/contatos.js';

/**
 * API pública versionada (/api/v1), separada das rotas internas da tela:
 * - autenticação só por chave (Authorization: Bearer sk_...), sem cookie;
 * - empresa sempre a da chave; escopo conferido em cada rota;
 * - limite de chamadas por chave (padrão 60 por minuto), com os cabeçalhos X-RateLimit-*;
 * - erros sempre no formato { "erro": { "codigo", "mensagem", ... } };
 * - cada chamada fica no uso da chave (tela Integrações).
 */

declare module 'fastify' {
  interface FastifyRequest {
    api?: { ctx: Contexto; chave: ChaveApi; origem: 'api' | 'mcp'; inicio: number };
  }
}

// ------------------------------------------------------------------ limite de chamadas

/** Janela deslizante de 60 s por chave (memória do processo). */
export class LimiteTaxa {
  private readonly marcas = new Map<string, number[]>();
  constructor(private readonly janelaMs = 60_000) {}
  /** Conta a chamada se couber. `resetSeg` = em quantos segundos abre uma vaga. */
  consumir(chave: string, limite: number, agora: number): { ok: boolean; restantes: number; resetSeg: number } {
    const l = (this.marcas.get(chave) ?? []).filter((t) => agora - t < this.janelaMs);
    const ok = l.length < limite;
    if (ok) l.push(agora);
    this.marcas.set(chave, l);
    if (this.marcas.size > 10_000) for (const [k, v] of this.marcas) if (!v.some((t) => agora - t < this.janelaMs)) this.marcas.delete(k);
    const primeiro = l[0] ?? agora;
    return { ok, restantes: Math.max(0, limite - l.length), resetSeg: Math.max(1, Math.ceil((primeiro + this.janelaMs - agora) / 1000)) };
  }
  /** Quantas marcas há na janela (sem contar uma nova). */
  contar(chave: string, agora: number): number {
    return (this.marcas.get(chave) ?? []).filter((t) => agora - t < this.janelaMs).length;
  }
}

export const erroJson = (codigo: string, mensagem: string, extra: Record<string, unknown> = {}) => ({ erro: { codigo, mensagem, ...extra } });

export interface OpcoesAutenticador {
  armazem: ArmazemIntegracoes;
  agora?: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

/** Autenticação por chave + limite + registro de uso, usados pela API e pelo MCP. */
export class AutenticadorApi {
  private readonly agora: () => Date;
  readonly taxa = new LimiteTaxa();
  /** Tentativas com chave errada por IP (protege contra quem tenta adivinhar). */
  private readonly erradas = new LimiteTaxa();
  private readonly cache = new Map<string, { ate: number; chave: ChaveApi | undefined }>();
  private readonly marcadoEm = new Map<string, number>();

  constructor(private readonly o: OpcoesAutenticador) {
    this.agora = o.agora ?? (() => new Date());
  }

  /** Chave revogada ou criada: some do cache na hora. */
  esquecer(prefixo?: string) {
    if (prefixo) this.cache.delete(prefixo);
    else this.cache.clear();
  }

  private async porPrefixo(prefixo: string): Promise<ChaveApi | undefined> {
    const t = Date.now();
    const c = this.cache.get(prefixo);
    if (c && c.ate > t) return c.chave;
    const chave = await this.o.armazem.chavePorPrefixo(prefixo);
    this.cache.set(prefixo, { ate: t + 15_000, chave });
    if (this.cache.size > 5000) this.cache.clear();
    return chave;
  }

  /** Confere a chave e o limite. Devolve false se já respondeu com erro. */
  async autenticar(req: FastifyRequest, reply: FastifyReply, origem: 'api' | 'mcp'): Promise<boolean> {
    const inicio = Date.now();
    const agora = this.agora();
    const recebida = chaveDoCabecalho(req.headers as Record<string, unknown>);
    const recusar = (codigo: string, mensagem: string) => {
      this.erradas.consumir(req.ip, Number.MAX_SAFE_INTEGER, agora.getTime());
      reply.header('www-authenticate', 'Bearer realm="Sintonia"').code(401).send(erroJson(codigo, mensagem));
      return false;
    };
    if (!recebida) return recusar('nao_autenticado', 'Envie a chave no cabeçalho Authorization: Bearer sk_...');
    // Muitas chaves erradas deste IP: espera um pouco (a conferência nem é feita).
    if (this.erradas.contar(req.ip, agora.getTime()) >= 30) {
      reply.header('retry-after', '60').code(429).send(erroJson('muitas_tentativas', 'Muitas chaves inválidas deste endereço. Espere um minuto.'));
      return false;
    }
    const prefixo = prefixoDe(recebida);
    const chave = prefixo ? await this.porPrefixo(prefixo) : undefined;
    if (!chave || !hashConfere(recebida, chave.hash)) return recusar('chave_invalida', 'Chave de API inválida.');
    if (chave.revogadaEm) return recusar('chave_revogada', 'Esta chave foi revogada. Crie outra em Integrações › Chaves de API.');
    if (chave.expiraEm && chave.expiraEm.getTime() <= agora.getTime()) return recusar('chave_expirada', 'Esta chave venceu. Crie outra em Integrações › Chaves de API.');

    const t = this.taxa.consumir(chave.id, chave.limiteMinuto, agora.getTime());
    reply.header('x-ratelimit-limit', String(chave.limiteMinuto)).header('x-ratelimit-remaining', String(t.restantes)).header('x-ratelimit-reset', String(t.resetSeg));
    req.api = { ctx: { empresaId: chave.empresaId, chaveId: chave.id, nomeChave: chave.nome, criadaPor: chave.criadaPor }, chave, origem, inicio };
    if (!t.ok) {
      reply.header('retry-after', String(t.resetSeg)).code(429).send(erroJson('limite_excedido', `Limite de ${chave.limiteMinuto} chamadas por minuto desta chave. Tente de novo em ${t.resetSeg} s.`, { tenteEmSegundos: t.resetSeg }));
      return false;
    }
    // "Último uso" no máximo uma vez por minuto por chave (não pesa no banco).
    if ((this.marcadoEm.get(chave.id) ?? 0) < agora.getTime() - 60_000) {
      this.marcadoEm.set(chave.id, agora.getTime());
      this.o.armazem.marcarUsoChave(chave.id, agora, req.ip).catch(() => undefined);
    }
    return true;
  }

  /** Registra a chamada no uso da chave (sem a chave, sem corpo). */
  registrarUso(req: FastifyRequest, status: number, rota: string) {
    const a = req.api;
    if (!a) return;
    this.o.armazem
      .registrarUso([{ chaveId: a.chave.id, empresaId: a.ctx.empresaId, origem: a.origem, metodo: req.method, rota, status, duracaoMs: Date.now() - a.inicio, ip: req.ip ?? null, em: this.agora() }])
      .catch((e) => this.o.log?.('Falha ao registrar o uso da API', String(e)));
  }
}

/** Erro qualquer → resposta padronizada. */
export function respostaDeErro(erro: unknown, log?: (msg: string, extra?: unknown) => void): { status: number; corpo: ReturnType<typeof erroJson> } {
  if (erro instanceof z.ZodError) {
    return { status: 400, corpo: erroJson('dados_invalidos', 'Dados inválidos.', { detalhes: erro.issues.map((i) => ({ campo: i.path.join('.') || null, mensagem: i.message })) }) };
  }
  if (erro instanceof ErroApi) return { status: erro.statusCode, corpo: erroJson(erro.codigo, erro.message, erro.extra) };
  if (erro instanceof ErroMeta) {
    return erro.codigo === 131047
      ? { status: 422, corpo: erroJson('fora_da_janela', erro.message) }
      : { status: 502, corpo: erroJson('erro_canal', erro.message) };
  }
  const status = (erro as { statusCode?: number }).statusCode;
  const codigo = (erro as { codigo?: unknown }).codigo;
  if (status && status >= 400 && status < 500) {
    const padrao: Record<number, string> = { 400: 'dados_invalidos', 403: 'sem_permissao', 404: 'nao_encontrado', 409: 'conflito', 413: 'corpo_grande', 415: 'formato_invalido', 422: 'nao_processavel' };
    const msg = (erro as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY' || (erro instanceof SyntaxError) ? 'JSON inválido no corpo.' : (erro as Error).message;
    return { status, corpo: erroJson(typeof codigo === 'string' ? codigo : (padrao[status] ?? 'erro'), msg) };
  }
  if (status === 501) return { status: 501, corpo: erroJson('indisponivel', (erro as Error).message) };
  if (status === 502 || status === 503 || status === 504) return { status: 502, corpo: erroJson(typeof codigo === 'string' ? codigo : 'erro_canal', (erro as Error).message) };
  log?.('Erro na API pública', String(erro).slice(0, 300));
  return { status: 500, corpo: erroJson('erro_interno', 'Erro interno. Tente de novo; se continuar, fale com o suporte.') };
}

// ------------------------------------------------------------------ rotas

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
export interface RotaApi {
  metodo: Metodo;
  /** Caminho depois de /api/v1, no formato do Fastify (/contatos/:telefone). */
  caminho: string;
  escopo: Escopo | null;
  grupo: string;
  resumo: string;
  descricao?: string;
  parametros?: Record<string, string>;
  query?: z.ZodObject;
  corpo?: z.ZodType;
  exemploCorpo?: unknown;
  status?: number;
  executar: (ctx: Contexto, req: FastifyRequest, s: ServicoApi) => Promise<unknown>;
}

const p = (req: FastifyRequest, nome: string) => String((req.params as Record<string, string>)[nome] ?? '');
const PaginaSimples = z.object({ limite: Limite, cursor: z.string().max(400).optional() });

export const ROTAS: RotaApi[] = [
  { metodo: 'GET', caminho: '/eu', escopo: null, grupo: 'Chave', resumo: 'Quem é esta chave', descricao: 'Empresa, escopos e limite da chave usada.', executar: async (ctx, req) => ({ empresaId: ctx.empresaId, chave: { id: ctx.chaveId, nome: ctx.nomeChave, prefixo: req.api!.chave.prefixo, escopos: req.api!.chave.escopos, limiteMinuto: req.api!.chave.limiteMinuto, expiraEm: req.api!.chave.expiraEm?.toISOString() ?? null } }) },

  { metodo: 'GET', caminho: '/contatos', escopo: 'contatos:ler', grupo: 'Contatos', resumo: 'Listar e buscar contatos', descricao: 'Do mais recente para o mais antigo. `busca` procura no nome ou nos dígitos do telefone.', query: FiltroContatos, executar: (ctx, req, s) => s.listarContatos(ctx, FiltroContatos.parse(req.query)) },
  { metodo: 'GET', caminho: '/contatos/:telefone', escopo: 'contatos:ler', grupo: 'Contatos', resumo: 'Ver um contato', parametros: { telefone: 'Telefone com DDI e DDD, só números (ex.: 5571988124471).' }, executar: (ctx, req, s) => s.contato(ctx, p(req, 'telefone')) },
  { metodo: 'POST', caminho: '/contatos', escopo: 'contatos:escrever', grupo: 'Contatos', resumo: 'Criar contato', descricao: 'Cria a conversa (sem mandar mensagem) e a ficha. Se o telefone já existe, devolve o contato que já existe (criado: false).', corpo: NovoContato, exemploCorpo: { telefone: '5571988124471', nome: 'Maria Souza', email: 'maria@exemplo.com', observacoes: 'Veio pelo site' }, status: 201, executar: (ctx, req, s) => s.criarContato(ctx, NovoContato.parse(req.body)) },
  { metodo: 'PATCH', caminho: '/contatos/:telefone', escopo: 'contatos:escrever', grupo: 'Contatos', resumo: 'Atualizar contato', descricao: 'Só os campos enviados mudam. `campos` aceita o id ou o nome do campo personalizado.', parametros: { telefone: 'Telefone com DDI e DDD.' }, corpo: EdicaoContato, exemploCorpo: { nome: 'Maria S. Souza', campos: { 'Cidade': 'Salvador' } }, executar: (ctx, req, s) => s.atualizarContato(ctx, p(req, 'telefone'), EdicaoContato.parse(req.body)) },

  { metodo: 'GET', caminho: '/conversas', escopo: 'conversas:ler', grupo: 'Conversas', resumo: 'Listar conversas', descricao: 'Da última atualizada para a mais antiga.', query: FiltroConversas, executar: (ctx, req, s) => s.listarConversas(ctx, FiltroConversas.parse(req.query)) },
  { metodo: 'GET', caminho: '/conversas/:id', escopo: 'conversas:ler', grupo: 'Conversas', resumo: 'Ver uma conversa', descricao: 'Com tags, etapa em cada funil e valor do negócio.', parametros: { id: 'Id da conversa.' }, executar: (ctx, req, s) => s.verConversa(ctx, p(req, 'id')) },
  { metodo: 'GET', caminho: '/conversas/:id/mensagens', escopo: 'mensagens:ler', grupo: 'Mensagens', resumo: 'Mensagens da conversa', descricao: 'Da mais nova para a mais antiga (até as 2.000 últimas).', parametros: { id: 'Id da conversa.' }, query: FiltroMensagens, executar: (ctx, req, s) => s.listarMensagens(ctx, p(req, 'id'), FiltroMensagens.parse(req.query)) },
  { metodo: 'POST', caminho: '/conversas/:id/mensagens', escopo: 'mensagens:escrever', grupo: 'Mensagens', resumo: 'Enviar mensagem na conversa', descricao: 'Sai pelo mesmo caminho da tela (WhatsApp oficial ou não oficial). Na API oficial, fora da janela de 24 h a resposta é 422 fora_da_janela.', parametros: { id: 'Id da conversa.' }, corpo: z.object({ texto: z.string().min(1).max(4096) }), exemploCorpo: { texto: 'Olá! Seu pedido saiu para entrega.' }, status: 201, executar: (ctx, req, s) => s.enviarNaConversa(ctx, p(req, 'id'), z.object({ texto: z.string() }).parse(req.body).texto) },
  { metodo: 'POST', caminho: '/mensagens', escopo: 'mensagens:escrever', grupo: 'Mensagens', resumo: 'Enviar mensagem para um número', descricao: 'Usa a conversa que já existe com esse número ou abre uma nova (pela unidade pedida ou pela primeira com WhatsApp conectado).', corpo: EnvioNumero, exemploCorpo: { telefone: '5571988124471', texto: 'Oi, Maria! Seu horário está confirmado.' }, status: 201, executar: (ctx, req, s) => s.enviarParaNumero(ctx, EnvioNumero.parse(req.body)) },

  { metodo: 'GET', caminho: '/funis', escopo: 'funis:ler', grupo: 'Funis e leads', resumo: 'Funis e etapas', descricao: 'Cada funil com as etapas e quantos leads há em cada uma.', executar: (ctx, _req, s) => s.listarFunis(ctx) },
  { metodo: 'GET', caminho: '/funis/:funilId/etapas/:etapaId/leads', escopo: 'funis:ler', grupo: 'Funis e leads', resumo: 'Leads de uma etapa', parametros: { funilId: 'Id do funil.', etapaId: 'Id da etapa.' }, query: PaginaSimples, executar: (ctx, req, s) => s.leadsDaEtapa(ctx, p(req, 'funilId'), p(req, 'etapaId'), PaginaSimples.parse(req.query)) },
  { metodo: 'POST', caminho: '/conversas/:id/etapa', escopo: 'funis:escrever', grupo: 'Funis e leads', resumo: 'Mover o lead de etapa', descricao: 'Pelo id da etapa (etapaId) ou pelo nome (etapa). Automações da etapa disparam como na tela.', parametros: { id: 'Id da conversa.' }, corpo: MoverLead, exemploCorpo: { etapa: 'Interessada' }, executar: (ctx, req, s) => s.moverLead(ctx, p(req, 'id'), MoverLead.parse(req.body)) },
  { metodo: 'PUT', caminho: '/conversas/:id/valor', escopo: 'funis:escrever', grupo: 'Funis e leads', resumo: 'Valor do negócio', descricao: 'Valor em reais (null apaga).', parametros: { id: 'Id da conversa.' }, corpo: ValorLead, exemploCorpo: { valor: 1490.9 }, executar: (ctx, req, s) => s.definirValor(ctx, p(req, 'id'), ValorLead.parse(req.body).valor) },

  { metodo: 'GET', caminho: '/tags', escopo: 'tags:ler', grupo: 'Tags', resumo: 'Listar tags', executar: (ctx, _req, s) => s.listarTags(ctx) },
  { metodo: 'POST', caminho: '/conversas/:id/tags', escopo: 'tags:escrever', grupo: 'Tags', resumo: 'Aplicar tag', descricao: 'Pelo id (tagId) ou pelo nome (nome) de uma tag que já existe.', parametros: { id: 'Id da conversa.' }, corpo: AplicarTag, exemploCorpo: { nome: 'Cliente VIP' }, executar: (ctx, req, s) => s.aplicarTag(ctx, p(req, 'id'), AplicarTag.parse(req.body)) },
  { metodo: 'DELETE', caminho: '/conversas/:id/tags/:tagId', escopo: 'tags:escrever', grupo: 'Tags', resumo: 'Tirar tag', parametros: { id: 'Id da conversa.', tagId: 'Id da tag.' }, executar: (ctx, req, s) => s.removerTag(ctx, p(req, 'id'), p(req, 'tagId')) },

  { metodo: 'GET', caminho: '/agendamentos', escopo: 'agendamentos:ler', grupo: 'Agendamentos', resumo: 'Listar agendamentos', descricao: 'Os da agenda (marcados pela IA ou pela equipe) e os dos links de agendamento. Padrão: de ontem até 30 dias; no máximo 93 dias por vez.', query: FiltroAgendamentos, executar: (ctx, req, s) => s.listarAgendamentos(ctx, FiltroAgendamentos.parse(req.query)) },
  { metodo: 'GET', caminho: '/agendamentos/links', escopo: 'agendamentos:ler', grupo: 'Agendamentos', resumo: 'Links de agendamento', executar: (ctx, _req, s) => s.linksDeAgendamento(ctx) },
  { metodo: 'POST', caminho: '/agendamentos', escopo: 'agendamentos:escrever', grupo: 'Agendamentos', resumo: 'Marcar pelo link de agendamento', descricao: 'Reserva um horário livre de um link (o mesmo que o contato faria na página do link).', corpo: NovoAgendamento, exemploCorpo: { linkId: '6f1c…', data: '2026-12-01', hora: '10:00', nome: 'Maria Souza', telefone: '5571988124471' }, status: 201, executar: (ctx, req, s) => s.criarAgendamento(ctx, NovoAgendamento.parse(req.body)) },
  { metodo: 'POST', caminho: '/agendamentos/:id/cancelar', escopo: 'agendamentos:escrever', grupo: 'Agendamentos', resumo: 'Cancelar agendamento (link)', parametros: { id: 'Id do agendamento (origem "link").' }, executar: (ctx, req, s) => s.cancelarAgendamento(ctx, p(req, 'id')) },

  { metodo: 'GET', caminho: '/tarefas', escopo: 'tarefas:ler', grupo: 'Tarefas', resumo: 'Listar tarefas', query: FiltroTarefas, executar: (ctx, req, s) => s.listarTarefas(ctx, FiltroTarefas.parse(req.query)) },
  { metodo: 'POST', caminho: '/tarefas', escopo: 'tarefas:escrever', grupo: 'Tarefas', resumo: 'Criar tarefa', descricao: 'Sem responsavelId, a tarefa fica com quem criou a chave.', corpo: NovaTarefa, exemploCorpo: { titulo: 'Ligar para a Maria', venceEm: '2026-12-01T14:00:00-03:00', prioridade: 'alta' }, status: 201, executar: (ctx, req, s) => s.criarTarefa(ctx, NovaTarefa.parse(req.body)) },
  { metodo: 'GET', caminho: '/equipe', escopo: 'tarefas:ler', grupo: 'Tarefas', resumo: 'Pessoas da equipe', descricao: 'Para escolher o responsavelId das tarefas.', executar: (ctx, _req, s) => s.equipe(ctx) },
];

export interface OpcoesApiPublica {
  autenticador: AutenticadorApi;
  servico: ServicoApi;
  log?: (msg: string, extra?: unknown) => void;
}

export function registrarApiPublica(app: FastifyInstance, o: OpcoesApiPublica): void {
  void app.register(
    async (api) => {
      api.addHook('onRequest', async (req, reply) => {
        reply.header('cache-control', 'no-store');
        if (!(await o.autenticador.autenticar(req, reply, 'api'))) return reply;
      });
      api.addHook('onResponse', async (req, reply) => {
        o.autenticador.registrarUso(req, reply.statusCode, `${req.method} /api/v1${(req.routeOptions?.url ?? '').replace(/^\/api\/v1/, '') || req.url.split('?')[0]}`);
      });
      api.setErrorHandler((erro, _req, reply) => {
        const r = respostaDeErro(erro, o.log);
        return reply.code(r.status).send(r.corpo);
      });
      api.setNotFoundHandler((_req, reply) => reply.code(404).send(erroJson('rota_inexistente', 'Esse endereço não existe na API v1. Veja /desenvolvedores.')));
      for (const r of ROTAS) {
        api.route({
          method: r.metodo,
          url: r.caminho,
          handler: async (req, reply) => {
            const a = req.api!;
            if (r.escopo && !temEscopo(a.chave.escopos, r.escopo)) {
              return reply.code(403).send(erroJson('sem_permissao', `Esta chave não tem o escopo "${r.escopo}".`, { escopoNecessario: r.escopo }));
            }
            const resultado = await r.executar(a.ctx, req, o.servico);
            // "Criar" de algo que já existia (ex.: contato com o mesmo telefone) responde 200.
            const jaExistia = r.status === 201 && (resultado as { criado?: unknown })?.criado === false;
            return reply.code(jaExistia ? 200 : (r.status ?? 200)).send(resultado);
          },
        });
      }
    },
    { prefix: '/api/v1' },
  );
}
