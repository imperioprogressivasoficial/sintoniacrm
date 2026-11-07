import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, escopoDe } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import { ErroTag } from '../tags/tags.js';
import { ErroLeads } from '../leads/leads.js';
import { ErroTransmissao, type Transmissoes } from './transmissoes.js';
import { UNIDADES_TRANSMISSAO } from './tipos.js';

/**
 * Rotas /api/transmissoes/... — só gestão (gerente nas unidades dele, direção e admin).
 * Registradas depois de criarServidor (valem o login, o bloqueio da API e o tratamento de erros de lá).
 */
export interface OpcoesRotasTransmissoes {
  transmissoes: Transmissoes;
  /** Canal de teste: uma cliente "responde" à transmissão (chega como mensagem normal). */
  simularResposta?: (p: { unidade: 'norte' | 'sumare'; telefone: string; nome?: string; texto: string }) => Promise<void>;
}

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });
const Unidade = z.enum(UNIDADES_TRANSMISSAO);
const MSG = 'Só a gerência, a direção e a administração fazem transmissões.';

export function registrarTransmissoes(app: FastifyInstance, o: OpcoesRotasTransmissoes): void {
  const t = o.transmissoes;
  const exigeGestao = (req: FastifyRequest) => {
    if (!pode(req, 'transmissoes')) throw proibido(MSG);
  };
  const unidadesDe = (req: FastifyRequest) => escopoDe(req.usuario).unidades;
  const exigeUnidade = (req: FastifyRequest, u: string) => {
    const us = unidadesDe(req);
    if (us && !us.includes(u as never)) throw proibido('Você só faz transmissões das suas unidades.');
  };
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const param = (req: FastifyRequest) => (req.params as { id: string }).id;
  const campanha = async (req: FastifyRequest) => {
    exigeGestao(req);
    const c = await t.exigir(param(req));
    exigeUnidade(req, c.unidade);
    return c;
  };
  const erro = (reply: FastifyReply, e: unknown) => {
    if (e instanceof ErroTransmissao || e instanceof ErroTag || e instanceof ErroLeads) return reply.code(e.statusCode).send({ erro: e.message });
    throw e;
  };
  const tratar =
    <T>(fn: (req: FastifyRequest, reply: FastifyReply) => Promise<T>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(req, reply);
      } catch (e) {
        return erro(reply, e);
      }
    };

  app.get('/api/transmissoes', tratar(async (req) => {
    exigeGestao(req);
    const [lista, descadastrados] = await Promise.all([t.listar(unidadesDe(req)), t.totalDescadastrados()]);
    return { campanhas: lista, numeros: t.numeros().filter((n) => !unidadesDe(req) || unidadesDe(req)!.includes(n.unidade)), limites: t.limites(), descadastrados };
  }));

  app.post('/api/transmissoes', tratar(async (req, reply) => {
    exigeGestao(req);
    const u = (req.body as { unidade?: string } | undefined)?.unidade;
    if (u) exigeUnidade(req, u);
    return reply.code(201).send(await t.criar(req.body, quem(req)));
  }));

  app.post('/api/transmissoes/publico/previa', tratar(async (req) => {
    exigeGestao(req);
    const b = z.object({ unidade: Unidade, publico: z.unknown(), campanhaId: z.string().uuid().optional() }).parse(req.body);
    exigeUnidade(req, b.unidade);
    return t.previaPublico(b.unidade, b.publico, b.campanhaId ?? null);
  }));

  app.post('/api/transmissoes/importar', { bodyLimit: 12 * 1024 * 1024 }, tratar(async (req) => {
    exigeGestao(req);
    const b = z
      .object({
        linhas: z.array(z.unknown()).min(1).max(5000),
        unidade: Unidade,
        tagId: z.string().min(1).optional(),
        tagNova: z.string().trim().max(30).optional(),
        dddPadrao: z.string().regex(/^\d{2}$/).optional(),
        simular: z.boolean().default(false),
      })
      .parse(req.body);
    exigeUnidade(req, b.unidade);
    return t.importar(b, quem(req));
  }));

  // ---------- modelos da API oficial
  app.get('/api/transmissoes/modelos', tratar(async (req) => {
    exigeGestao(req);
    const q = z.object({ unidade: Unidade, sincronizar: z.enum(['0', '1']).optional() }).parse(req.query);
    exigeUnidade(req, q.unidade);
    return t.modelos(q.unidade, q.sincronizar === '1');
  }));

  app.post('/api/transmissoes/modelos', { bodyLimit: 8 * 1024 * 1024 }, tratar(async (req, reply) => {
    exigeGestao(req);
    const u = (req.body as { unidade?: string } | undefined)?.unidade;
    if (u) exigeUnidade(req, u);
    return reply.code(201).send(await t.criarModelo(req.body, quem(req)));
  }));

  app.post('/api/transmissoes/descadastro', tratar(async (req) => {
    exigeGestao(req);
    const b = z.object({ telefone: z.string().regex(/^\d{12,13}$/), sair: z.boolean() }).parse(req.body);
    if (b.sair) await t.descadastrar(b.telefone, `Marcado por ${quem(req)}`);
    else await t.voltarAReceber(b.telefone);
    return { ok: true };
  }));

  // ---------- campanha
  app.get('/api/transmissoes/:id', tratar(async (req) => {
    await campanha(req);
    return t.detalhe(param(req));
  }));

  app.patch('/api/transmissoes/:id', tratar(async (req) => {
    await campanha(req);
    const u = (req.body as { unidade?: string } | undefined)?.unidade;
    if (u) exigeUnidade(req, u);
    return t.alterar(param(req), req.body);
  }));

  app.delete('/api/transmissoes/:id', tratar(async (req) => {
    await campanha(req);
    await t.apagar(param(req));
    return { ok: true };
  }));

  app.post('/api/transmissoes/:id/duplicar', tratar(async (req, reply) => {
    await campanha(req);
    return reply.code(201).send(await t.duplicar(param(req), quem(req)));
  }));

  app.post('/api/transmissoes/:id/imagem', { bodyLimit: 8 * 1024 * 1024 }, tratar(async (req) => {
    await campanha(req);
    const b = z.object({ base64: z.string().max(7_500_000).nullable(), mimetype: z.string().max(40).optional() }).parse(req.body);
    return t.definirImagem(param(req), b.base64 ? { conteudo: Buffer.from(b.base64, 'base64'), mimetype: b.mimetype ?? 'image/jpeg' } : null);
  }));

  app.get('/api/transmissoes/:id/imagem', tratar(async (req, reply) => {
    await campanha(req);
    const img = await t.imagem(param(req));
    if (!img) return reply.code(404).send({ erro: 'Sem imagem' });
    return reply.header('content-type', img.tipo).header('cache-control', 'private, max-age=60').send(img.conteudo);
  }));

  app.post('/api/transmissoes/:id/iniciar', tratar(async (req) => {
    await campanha(req);
    const b = z.object({ agendarPara: z.string().datetime({ offset: true }).nullable().optional() }).parse(req.body ?? {});
    return t.iniciar(param(req), b.agendarPara === undefined ? {} : { agendarPara: b.agendarPara ? new Date(b.agendarPara) : null });
  }));

  for (const acao of ['pausar', 'retomar', 'cancelar'] as const) {
    app.post(`/api/transmissoes/:id/${acao}`, tratar(async (req) => {
      await campanha(req);
      return t[acao](param(req));
    }));
  }

  app.get('/api/transmissoes/:id/destinos', tratar(async (req) => {
    await campanha(req);
    const q = z
      .object({ status: z.string().max(20).optional(), busca: z.string().max(60).optional(), pagina: z.coerce.number().int().min(0).max(10_000).optional(), limite: z.coerce.number().int().min(1).max(200).optional() })
      .parse(req.query);
    return t.destinos(param(req), q);
  }));

  app.post('/api/transmissoes/:id/simular-resposta', tratar(async (req) => {
    await campanha(req);
    if (!o.simularResposta) throw new ErroTransmissao('Simulação indisponível neste servidor.', 501);
    const b = z.object({ texto: z.string().trim().min(1).max(500).default('Quero saber mais!') }).parse(req.body ?? {});
    const alvo = await t.alguemParaResponder(param(req));
    if (!alvo) throw new ErroTransmissao('Ninguém recebeu ainda.', 409);
    await o.simularResposta({ unidade: alvo.unidade, telefone: alvo.telefone, nome: alvo.nome ?? undefined, texto: b.texto });
    return { ok: true, telefone: alvo.telefone, nome: alvo.nome };
  }));
}
