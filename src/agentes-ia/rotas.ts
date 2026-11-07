import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, podeVer } from '../auth/acesso.js';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Comandos } from './comandos.js';
import type { ControleIa } from './controle.js';
import type { ExecutorAgentes } from './executor.js';
import { ferramentasPermitidas } from './executor.js';
import type { ServicoAgentesIa } from './servico.js';
import { AgenteNovo, CHAVES_MEMORIA, FERRAMENTAS_AGENTE, MODELOS, modeloImperio, NOME_FERRAMENTA, NOME_MEMORIA, publico } from './tipos.js';

export interface OpcoesRotasAgentesIa {
  repo: Repositorio;
  servico: ServicoAgentesIa;
  executor: ExecutorAgentes;
  controle: ControleIa;
  comandos: Comandos;
  /** Há chave geral de cada provedor (Conexões)? */
  chavesGerais: () => { anthropic: boolean; openai: boolean };
  tagsDaIa?: () => Promise<string[]>;
  sintonia: { mudarModo(id: string, modo: 'ia' | 'copiloto' | 'humano'): Promise<void> };
}

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });

/** /api/agentes-ia (estúdio) e /api/ia/comando (pedidos da gestão). Registre depois de criarServidor. */
export function registrarAgentesIa(app: FastifyInstance, o: OpcoesRotasAgentesIa): void {
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const gestao = (req: FastifyRequest, msg = 'Só a gerência, a direção e a administração mudam os agentes de IA.') => {
    if (req.usuario && !ehGestor(req.usuario)) throw proibido(msg);
  };
  const visivel = (req: FastifyRequest) => (c: Conversa) => !req.usuario || podeVer(req.usuario, c);
  const conversa = async (req: FastifyRequest, id: string) => {
    const c = await o.repo.buscarConversa(id);
    if (!c || !visivel(req)(c)) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    return c;
  };
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;

  app.get('/api/agentes-ia', async () => ({
    agentes: await o.servico.listar(),
    modelos: MODELOS,
    ferramentas: FERRAMENTAS_AGENTE.map((f) => ({ id: f, nome: NOME_FERRAMENTA[f] })),
    memoria: CHAVES_MEMORIA.map((c) => ({ id: c, nome: NOME_MEMORIA[c] })),
    chaves: o.chavesGerais(),
  }));

  app.post('/api/agentes-ia', async (req, reply) => {
    gestao(req);
    const b = (req.body ?? {}) as { modelo?: unknown };
    const corpo = b && (b as { modeloPronto?: string }).modeloPronto === 'imperio' ? { ...modeloImperio(), ...(req.body as object) } : req.body;
    const a = await o.servico.criar(AgenteNovo.parse(corpo), quem(req));
    return reply.code(201).send(publico(a));
  });

  app.get('/api/agentes-ia/controle', async () => o.servico.controle());
  app.put('/api/agentes-ia/controle', async (req) => {
    gestao(req, 'Só a gerência, a direção e a administração mudam quem atende primeiro.');
    return o.servico.gravarControle(req.body, quem(req));
  });

  // ---------- memória por cliente
  app.get('/api/agentes-ia/memoria', async (req) => {
    gestao(req, 'Só a gestão vê a memória de todas as clientes.');
    return o.servico.memoriasRecentes();
  });
  app.get('/api/agentes-ia/conversa/:id', async (req) => {
    const c = await conversa(req, id(req));
    const a = await o.controle.agenteDe(c);
    return {
      conversaId: c.id,
      modo: c.modo,
      noControle: c.modo === 'ia' ? 'ia' : 'equipe',
      agente: a ? { id: a.id, nome: a.nome, avatar: a.avatar } : null,
      memoria: await o.servico.memoria(c.telefone),
    };
  });
  const Fato = z.object({ chave: z.enum(CHAVES_MEMORIA), valor: z.string().trim().min(1).max(300) });
  app.post('/api/agentes-ia/conversa/:id/memoria', async (req) => {
    const c = await conversa(req, id(req));
    const f = Fato.parse(req.body);
    return o.servico.gravarMemoria(c, f.chave, f.valor, quem(req));
  });
  app.delete('/api/agentes-ia/conversa/:id/memoria/:chave', async (req) => {
    const c = await conversa(req, id(req));
    return o.servico.apagarMemoria(c, (req.params as { chave: string }).chave);
  });
  app.post('/api/agentes-ia/conversa/:id/assumir', async (req) => {
    const c = await conversa(req, id(req));
    await o.sintonia.mudarModo(c.id, 'humano');
    await o.repo.registrarEvento({ tipo: 'transferencia', conversaId: c.id, unidade: c.unidade, em: new Date(), dados: { motivo: 'assumiu_da_ia', porNome: quem(req), porId: req.usuario?.id ?? null, deNome: 'IA', paraNome: quem(req), paraId: req.usuario?.id ?? null } });
    return { ok: true };
  });
  app.post('/api/agentes-ia/conversa/:id/devolver', async (req) => {
    const c = await conversa(req, id(req));
    const b = z.object({ agenteId: z.string().optional() }).parse(req.body ?? {});
    const a = await o.controle.devolverParaIa(c.id, b.agenteId);
    return { ok: true, agente: a ? { id: a.id, nome: a.nome, avatar: a.avatar } : null };
  });

  // ---------- aprendizados ("a IA aprendeu isso, aprovar?")
  app.get('/api/agentes-ia/aprendizados', async (req) => {
    const s = (req.query as { situacao?: string }).situacao;
    return o.servico.aprendizados(s === 'pendente' || s === 'aprovado' || s === 'recusado' ? s : undefined);
  });
  const Decisao = z.object({ texto: z.string().trim().min(3).max(600).optional() });
  app.post('/api/agentes-ia/aprendizados/:id/aprovar', async (req) => {
    gestao(req, 'Só a gestão aprova o que a IA aprende.');
    return o.servico.decidir(id(req), 'aprovado', quem(req), Decisao.parse(req.body ?? {}).texto);
  });
  app.post('/api/agentes-ia/aprendizados/:id/recusar', async (req) => {
    gestao(req, 'Só a gestão decide o que a IA aprende.');
    return o.servico.decidir(id(req), 'recusado', quem(req));
  });

  // ---------- um agente
  app.get('/api/agentes-ia/:id', async (req) => o.servico.detalhe(id(req)));
  app.patch('/api/agentes-ia/:id', async (req) => {
    gestao(req);
    return publico(await o.servico.alterar(id(req), AgenteNovo.partial().parse(req.body ?? {}), quem(req)));
  });
  app.delete('/api/agentes-ia/:id', async (req) => {
    gestao(req);
    await o.servico.apagar(id(req));
    return { ok: true };
  });
  app.get('/api/agentes-ia/:id/prompt', async (req) => {
    const a = await o.servico.exigir(id(req));
    const nomes = [...ferramentasPermitidas(a.config.ferramentas, a.config.memoriaCliente)];
    return { texto: await o.executor.systemDe(a, nomes), ferramentas: nomes };
  });

  const Teste = z.object({
    mensagem: z.string().trim().min(1).max(2000),
    historico: z.array(z.object({ autor: z.enum(['cliente', 'ia']), texto: z.string().max(4000) })).max(40).optional(),
    unidade: z.enum(['norte', 'sumare']).optional(),
    nome: z.string().trim().max(60).optional(),
  });
  app.post('/api/agentes-ia/:id/testar', async (req) => {
    const a = await o.servico.exigir(id(req));
    const t = Teste.parse(req.body);
    const tags = a.config.ferramentas.includes('marcar_tag') ? await o.tagsDaIa?.().catch(() => []) : undefined;
    return o.executor.testar(a, { ...t, tagsDisponiveis: tags?.length ? tags : undefined });
  });

  const Conh = z.object({ tipo: z.enum(['texto', 'faq']), titulo: z.string().trim().min(1).max(120), conteudo: z.string().trim().min(1).max(40_000) });
  app.post('/api/agentes-ia/:id/conhecimento', async (req, reply) => {
    gestao(req);
    return reply.code(201).send(await o.servico.adicionarConhecimento(id(req), Conh.parse(req.body), quem(req)));
  });
  app.post('/api/agentes-ia/:id/conhecimento/link', async (req, reply) => {
    gestao(req);
    const { url } = z.object({ url: z.string().trim().min(8).max(2000) }).parse(req.body);
    return reply.code(201).send(await o.servico.importarLink(id(req), url, quem(req)));
  });
  app.post('/api/agentes-ia/:id/conhecimento/arquivo', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    gestao(req);
    const f = z
      .object({ nome: z.string().trim().min(1).max(160).regex(/\.(txt|pdf|md)$/i, 'Use um arquivo .txt ou .pdf'), base64: z.string().max(11_000_000).optional(), texto: z.string().max(200_000).optional() })
      .parse(req.body);
    return reply.code(201).send(await o.servico.importarArquivo(id(req), f, quem(req)));
  });
  app.delete('/api/agentes-ia/:id/conhecimento/:kid', async (req) => {
    gestao(req);
    await o.servico.apagarConhecimento(id(req), (req.params as { kid: string }).kid);
    return { ok: true };
  });
  app.post('/api/agentes-ia/:id/aprendizados', async (req, reply) => {
    // A equipe corrige uma resposta (no teste ou na conversa): vira aprendizado pendente para a gestão aprovar.
    const b = z
      .object({ texto: z.string().trim().min(3).max(600), cliente: z.string().max(2000).optional(), sugestao: z.string().max(4000).optional(), conversaId: z.string().optional() })
      .parse(req.body);
    return reply.code(201).send(await o.servico.sugerirAprendizado(id(req), b.texto, { cliente: b.cliente, sugestao: b.sugestao, conversaId: b.conversaId, por: quem(req) }));
  });

  // ---------- "Peça para a IA" (comandos da gestão)
  const exigeComando = (req: FastifyRequest) => gestao(req, 'Só a gerência, a direção e a administração usam os comandos da IA.');
  app.get('/api/ia/comandos', async (req) => {
    exigeComando(req);
    return o.comandos.historico();
  });
  app.post('/api/ia/comando', async (req) => {
    exigeComando(req);
    const { texto } = z.object({ texto: z.string().trim().min(4).max(500) }).parse(req.body);
    return o.comandos.planejar(texto, { nome: quem(req), id: req.usuario?.id }, visivel(req));
  });
  app.post('/api/ia/comando/:id/confirmar', async (req) => {
    exigeComando(req);
    return o.comandos.confirmar(id(req), { nome: quem(req), id: req.usuario?.id }, visivel(req));
  });
  app.post('/api/ia/comando/:id/cancelar', async (req) => {
    exigeComando(req);
    return o.comandos.cancelar(id(req), { nome: quem(req) });
  });
}
