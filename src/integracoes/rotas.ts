import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { linkBase } from '../auth/rotas.js';
import { veTudo } from '../auth/acesso.js';
import type { Evento } from '../store/repositorio.js';
import { AutenticadorApi, registrarApiPublica } from './api.js';
import type { ArmazemIntegracoes, ChaveApi, Entrega, Webhook } from './armazem.js';
import { ehEscopo, ESCOPOS, EVENTOS, LIMITE_PADRAO_MINUTO, RECURSOS } from './catalogo.js';
import { gerarChave } from './chaves.js';
import { FERRAMENTAS, registrarMcp } from './mcp.js';
import { gerarOpenApi } from './openapi.js';
import { lerCursor, codificarCursor, ServicoApi, type OpcoesServicoApi } from './servico.js';
import { Webhooks, type OpcoesWebhooks } from './webhooks.js';

/**
 * Área de desenvolvedores, montada num lugar só:
 * - /api/integracoes/*  tela Integrações (só administração e direção): chaves, webhooks, entregas;
 * - /api/v1/*           API pública (chave de API);
 * - /mcp                servidor MCP (chave de API);
 * - /desenvolvedores e /openapi.json  documentação pública (sem dado de empresa nenhuma).
 */

export interface OpcoesIntegracoes extends Omit<OpcoesServicoApi, 'aoReuniao'>, Omit<OpcoesWebhooks, 'repo' | 'armazem'> {
  armazem: ArmazemIntegracoes;
}

export interface Integracoes {
  webhooks: Webhooks;
  servico: ServicoApi;
  autenticador: AutenticadorApi;
  /** Ouvinte de repo.registrarEvento (observarEventos). */
  aoEvento: (e: Evento) => void;
  /** Reunião marcada ou cancelada fora da API (página pública do link, tela). */
  aoReuniao: (tipo: 'criado' | 'cancelado', empresaId: string, reuniao: Record<string, unknown>) => void;
  registrar: (app: FastifyInstance) => void;
  tick: () => Promise<number>;
}

const erro = (statusCode: number, msg: string, codigo?: string) => Object.assign(new Error(msg), { statusCode, ...(codigo ? { codigo } : {}) });
const UUID = z.string().uuid();

function situacaoChave(c: ChaveApi, agora: Date): 'ativa' | 'revogada' | 'vencida' {
  if (c.revogadaEm) return 'revogada';
  if (c.expiraEm && c.expiraEm <= agora) return 'vencida';
  return 'ativa';
}

const NovaChave = z.object({
  nome: z.string().trim().min(2, 'Dê um nome para a chave (ex.: "Site", "n8n").').max(60),
  escopos: z.array(z.string()).min(1, 'Escolha pelo menos uma permissão.').max(40),
  expiraEmDias: z.number().int().min(1).max(730).nullable().default(null),
  limiteMinuto: z.number().int().min(5).max(600).default(LIMITE_PADRAO_MINUTO),
});
const NovoWebhook = z.object({ nome: z.string().trim().max(80).optional(), url: z.string().trim().min(8).max(2000), eventos: z.array(z.string()).min(1, 'Escolha pelo menos um evento.').max(40) });
const EdicaoWebhook = z.object({ nome: z.string().trim().max(80).optional(), url: z.string().trim().min(8).max(2000).optional(), eventos: z.array(z.string()).min(1).max(40).optional(), ativo: z.boolean().optional() });

export function montarIntegracoes(o: OpcoesIntegracoes): Integracoes {
  const agora = o.agora ?? (() => new Date());
  const webhooks = new Webhooks({ ...o, armazem: o.armazem, repo: o.repo });
  const aoReuniao: Integracoes['aoReuniao'] = (tipo, empresaId, reuniao) => {
    void webhooks.emitir(empresaId, tipo === 'criado' ? 'agendamento.criado' : 'agendamento.cancelado', { conversa: null, agendamento: reuniao }).catch((e) => o.log?.('Falha no webhook de agendamento', String(e)));
  };
  const servico = new ServicoApi({ ...o, aoReuniao });
  const autenticador = new AutenticadorApi({ armazem: o.armazem, agora, log: o.log });

  const chaveParaTela = (c: ChaveApi, uso?: { total: number; erros: number }) => ({
    id: c.id, nome: c.nome, prefixo: c.prefixo, escopos: c.escopos, limiteMinuto: c.limiteMinuto, criadaPorNome: c.criadaPorNome,
    criadaEm: c.criadaEm, expiraEm: c.expiraEm, ultimoUsoEm: c.ultimoUsoEm, ultimoIp: c.ultimoIp, revogadaEm: c.revogadaEm,
    situacao: situacaoChave(c, agora()), uso24h: uso ?? { total: 0, erros: 0 },
  });
  const webhookParaTela = (w: Webhook, contagem?: Record<string, number>) => ({
    id: w.id, nome: w.nome, url: w.url, eventos: w.eventos, ativo: w.ativo, desligadoMotivo: w.desligadoMotivo, desligadoEm: w.desligadoEm,
    falhasSeguidas: w.falhasSeguidas, ultimoSucessoEm: w.ultimoSucessoEm, ultimaFalhaEm: w.ultimaFalhaEm, criadoEm: w.criadoEm,
    ...(contagem ? { entregas24h: contagem } : {}),
  });
  const entregaParaTela = (e: Entrega, completa = false) => ({
    id: e.id, webhookId: e.webhookId, evento: e.evento, eventoId: e.eventoId, status: e.status, tentativas: e.tentativas, proximaEm: e.proximaEm,
    ultimoHttp: e.ultimoHttp, ultimoErro: e.ultimoErro, duracaoMs: e.duracaoMs, teste: e.teste, criadaEm: e.criadaEm, entregueEm: e.entregueEm,
    ...(completa ? { corpo: e.corpo, ultimaResposta: e.ultimaResposta } : {}),
  });

  function registrar(app: FastifyInstance) {
    // ---------------------------------------------------------------- tela (só gestão que vê tudo)
    const gestao = (req: FastifyRequest) => {
      const u = req.usuario;
      if (!u) throw erro(401, 'Faça login para continuar.');
      if (!veTudo(u)) throw erro(403, 'Só a administração e a direção mexem nas integrações.');
      return u;
    };
    const id = (req: FastifyRequest, nome = 'id') => {
      const r = UUID.safeParse((req.params as Record<string, string>)[nome]);
      if (!r.success) throw erro(404, 'Não encontrado.');
      return r.data;
    };
    const enderecos = (req: FastifyRequest) => {
      const base = linkBase(req);
      return { base, api: `${base}/api/v1`, mcp: `${base}/mcp`, docs: `${base}/desenvolvedores`, openapi: `${base}/openapi.json` };
    };

    app.get('/api/integracoes', async (req) => {
      const u = gestao(req);
      const ontem = new Date(agora().getTime() - 86400_000);
      const [chaves, uso, ganchos] = await Promise.all([o.armazem.chaves(u.empresaId), o.armazem.resumoUso(u.empresaId, ontem), o.armazem.webhooks(u.empresaId)]);
      return {
        chaves: chaves.map((c) => chaveParaTela(c, uso.get(c.id))),
        webhooks: await Promise.all(ganchos.map(async (w) => webhookParaTela(w, await o.armazem.contagem(u.empresaId, w.id, ontem)))),
        catalogo: { recursos: RECURSOS, escopos: ESCOPOS, eventos: EVENTOS, ferramentas: FERRAMENTAS.map((f) => ({ nome: f.nome, titulo: f.titulo, descricao: f.descricao, escopos: f.escopos })) },
        enderecos: enderecos(req),
        producao: o.producao,
      };
    });

    app.post('/api/integracoes/chaves', async (req, reply) => {
      const u = gestao(req);
      const b = NovaChave.parse(req.body);
      const escopos = [...new Set(b.escopos)];
      const ruins = escopos.filter((e) => !ehEscopo(e));
      if (ruins.length) throw erro(400, `Permissão desconhecida: ${ruins.join(', ')}.`);
      const ativas = (await o.armazem.chaves(u.empresaId)).filter((c) => situacaoChave(c, agora()) === 'ativa');
      if (ativas.length >= 50) throw erro(409, 'Limite de 50 chaves ativas. Revogue as que não usa mais.');
      const g = gerarChave();
      const c: ChaveApi = {
        id: randomUUID(), empresaId: u.empresaId, nome: b.nome, prefixo: g.prefixo, hash: g.hash, escopos, limiteMinuto: b.limiteMinuto,
        criadaPor: u.id, criadaPorNome: u.nome, criadaEm: agora(), expiraEm: b.expiraEmDias ? new Date(agora().getTime() + b.expiraEmDias * 86400_000) : null,
        ultimoUsoEm: null, ultimoIp: null, revogadaEm: null,
      };
      await o.armazem.criarChave(c);
      o.log?.('Chave de API criada', { empresa: u.empresaId, prefixo: c.prefixo, por: u.id });
      // A chave inteira vai só nesta resposta: depois disso, ninguém (nem o servidor) consegue mostrar de novo.
      return reply.code(201).header('cache-control', 'no-store').send({ chave: g.chave, info: chaveParaTela(c) });
    });

    app.post('/api/integracoes/chaves/:id/revogar', async (req) => {
      const u = gestao(req);
      const c = await o.armazem.chave(u.empresaId, id(req));
      if (!c) throw erro(404, 'Chave não encontrada.');
      await o.armazem.revogarChave(u.empresaId, c.id, agora(), u.id);
      autenticador.esquecer(c.prefixo);
      o.log?.('Chave de API revogada', { empresa: u.empresaId, prefixo: c.prefixo, por: u.id });
      return { ok: true };
    });

    app.get('/api/integracoes/chaves/:id/uso', async (req) => {
      const u = gestao(req);
      const c = await o.armazem.chave(u.empresaId, id(req));
      if (!c) throw erro(404, 'Chave não encontrada.');
      return { uso: await o.armazem.usoDaChave(u.empresaId, c.id, 100) };
    });

    app.post('/api/integracoes/webhooks', async (req, reply) => {
      const u = gestao(req);
      const b = NovoWebhook.parse(req.body);
      const r = await webhooks.criar(u.empresaId, b, u.id);
      return reply.code(201).header('cache-control', 'no-store').send({ webhook: webhookParaTela(r.webhook), segredo: r.segredo });
    });

    app.patch('/api/integracoes/webhooks/:id', async (req) => {
      const u = gestao(req);
      return { webhook: webhookParaTela(await webhooks.alterar(u.empresaId, id(req), EdicaoWebhook.parse(req.body))) };
    });

    app.delete('/api/integracoes/webhooks/:id', async (req) => {
      const u = gestao(req);
      await webhooks.apagar(u.empresaId, id(req));
      return { ok: true };
    });

    app.get('/api/integracoes/webhooks/:id/segredo', async (req, reply) => {
      const u = gestao(req);
      return reply.header('cache-control', 'no-store').send({ segredo: await webhooks.segredo(u.empresaId, id(req)) });
    });

    app.post('/api/integracoes/webhooks/:id/segredo', async (req, reply) => {
      const u = gestao(req);
      return reply.header('cache-control', 'no-store').send({ segredo: await webhooks.trocarSegredo(u.empresaId, id(req)) });
    });

    app.post('/api/integracoes/webhooks/:id/teste', async (req) => {
      const u = gestao(req);
      return { entrega: entregaParaTela(await webhooks.testar(u.empresaId, id(req)), true) };
    });

    const HistoricoQ = z.object({ cursor: z.string().max(400).optional(), limite: z.coerce.number().int().min(1).max(100).default(30) });
    app.get('/api/integracoes/webhooks/:id/entregas', async (req) => {
      const u = gestao(req);
      const w = await webhooks.exigir(u.empresaId, id(req));
      const q = HistoricoQ.parse(req.query);
      const lista = await o.armazem.entregas(u.empresaId, w.id, q.limite + 1, lerCursor(q.cursor));
      const pagina = lista.slice(0, q.limite);
      const ultimo = pagina.at(-1);
      return { entregas: pagina.map((e) => entregaParaTela(e)), proximoCursor: lista.length > q.limite && ultimo ? codificarCursor(ultimo.criadaEm, ultimo.id) : null };
    });

    app.get('/api/integracoes/entregas/:id', async (req) => {
      const u = gestao(req);
      const e = await o.armazem.entrega(u.empresaId, id(req));
      if (!e) throw erro(404, 'Entrega não encontrada.');
      return { entrega: entregaParaTela(e, true) };
    });

    app.post('/api/integracoes/entregas/:id/reenviar', async (req) => {
      const u = gestao(req);
      return { entrega: entregaParaTela(await webhooks.reenviar(u.empresaId, id(req)), true) };
    });

    // ---------------------------------------------------------------- documentação pública
    let pagina: Buffer | undefined;
    app.get('/desenvolvedores', async (_req, reply) => {
      pagina ??= readFileSync(new URL('../../public/desenvolvedores.html', import.meta.url));
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-cache')
        .header('x-content-type-options', 'nosniff')
        .header('referrer-policy', 'strict-origin-when-cross-origin')
        .send(pagina);
    });
    app.get('/openapi.json', async (req, reply) =>
      reply.header('cache-control', 'public, max-age=300').header('access-control-allow-origin', '*').send({
        ...gerarOpenApi(linkBase(req)),
        'x-eventos': EVENTOS,
        'x-ferramentas-mcp': FERRAMENTAS.map((f) => ({ nome: f.nome, titulo: f.titulo, descricao: f.descricao, escopos: f.escopos })),
      }),
    );

    // ---------------------------------------------------------------- API v1 e MCP
    registrarApiPublica(app, { autenticador, servico, log: o.log });
    registrarMcp(app, { autenticador, servico, log: o.log });
  }

  return { webhooks, servico, autenticador, aoEvento: (e) => webhooks.aoEvento(e), aoReuniao, registrar, tick: () => webhooks.tick() };
}
