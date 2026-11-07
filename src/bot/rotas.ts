import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehGestor, podeVer } from '../auth/acesso.js';
import { ehCanalTeste } from '../channels/teste.js';
import { semPrefixoDataUrl } from '../midia.js';
import { ErroBot, type Bots, type ExecucaoBot, type Fluxo } from './bot.js';
import { Grafo } from './esquema.js';

/**
 * Rotas do construtor de bots. Registradas depois de criarServidor (valem o login e o tratamento de erros de lá).
 * Gestão (gerente, direção, admin) cria, edita, publica, liga e testa. Quem vê a conversa pode iniciar um bot
 * publicado nela e parar o bot que está rodando.
 */
export interface OpcoesRotasBots {
  repo: Repositorio;
  bots: Bots;
}

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });

/** Lista sem os grafos (a tela carrega o fluxo inteiro ao abrir). */
const resumo = (f: Fluxo) => ({
  id: f.id,
  nome: f.nome,
  descricao: f.descricao,
  ligado: f.ligado,
  versao: f.versao,
  publicadoEm: f.publicadoEm,
  publicadoPor: f.publicadoPor,
  gatilho: (f.publicado ?? f.rascunho).nos.find((n) => n.tipo === 'inicio')?.gatilho ?? null,
  blocos: f.rascunho.nos.length,
  rascunhoDiferente: JSON.stringify(f.rascunho) !== JSON.stringify(f.publicado),
  criadoPor: f.criadoPor,
  criadoEm: f.criadoEm,
  atualizadoEm: f.atualizadoEm,
});

/** A execução sem a cópia do grafo (a tela já tem o fluxo). */
const execucao = (e: ExecucaoBot) => {
  const { grafo: _g, ...resto } = e;
  return resto;
};

export function registrarBots(app: FastifyInstance, o: OpcoesRotasBots): void {
  const { bots } = o;
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const exigeGestao = (req: FastifyRequest) => {
    if (req.usuario && !ehGestor(req.usuario)) throw proibido('Só a gerência, a direção e a administração mexem nos bots.');
  };
  const param = (req: FastifyRequest, nome: string) => (req.params as Record<string, string>)[nome]!;
  async function conversaVisivel(req: FastifyRequest, id: string): Promise<Conversa> {
    const c = await o.repo.buscarConversa(id).catch(() => undefined);
    if (!c || c.empresaId !== bots.empresaId || (req.usuario && !podeVer(req.usuario, c))) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    return c;
  }
  /** ErroBot com a lista de problemas (a tela marca os blocos). */
  const comProblemas = async <T>(reply: FastifyReply, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroBot) return reply.code(e.statusCode).send({ erro: e.message, ...(e.problemas ? { problemas: e.problemas } : {}) });
      throw e;
    }
  };

  app.get('/api/bots/modelos', async (req) => {
    exigeGestao(req);
    return bots.modelos();
  });

  app.get('/api/bots', async (req) => {
    exigeGestao(req);
    return (await bots.listar()).map(resumo);
  });

  app.post('/api/bots', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, async () => reply.code(201).send(await bots.criar(req.body, quem(req))));
  });

  app.get('/api/bots/:id', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, async () => {
      const f = await bots.exigir(param(req, 'id'));
      return { ...f, problemas: await bots.validar(f.rascunho) };
    });
  });

  /** Salvar rascunho (devolve os problemas do rascunho para a tela marcar). */
  app.patch('/api/bots/:id', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, async () => {
      const f = await bots.alterar(param(req, 'id'), req.body);
      return { ...f, problemas: await bots.validar(f.rascunho) };
    });
  });

  app.delete('/api/bots/:id', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, async () => {
      await bots.apagar(param(req, 'id'));
      return { ok: true };
    });
  });

  /** Confere um grafo sem salvar. */
  app.post('/api/bots/validar', async (req) => {
    exigeGestao(req);
    const { grafo } = z.object({ grafo: Grafo }).parse(req.body);
    return { problemas: await bots.validar(grafo) };
  });

  app.post('/api/bots/:id/publicar', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, () => bots.publicar(param(req, 'id'), quem(req)));
  });
  app.post('/api/bots/:id/ligar', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, () => bots.ligar(param(req, 'id'), true));
  });
  app.post('/api/bots/:id/desligar', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, () => bots.ligar(param(req, 'id'), false));
  });

  app.get('/api/bots/:id/execucoes', async (req, reply) => {
    exigeGestao(req);
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(200).default(30) }).parse(req.query);
    return comProblemas(reply, async () => (await bots.execucoes(param(req, 'id'), limite)).map(execucao));
  });

  app.get('/api/bots/execucoes/:id', async (req, reply) => {
    exigeGestao(req);
    return comProblemas(reply, async () => execucao(await bots.execucao(param(req, 'id'))));
  });

  /** Testar o rascunho numa conversa do WhatsApp de teste. Depois é só escrever como a cliente (POST /api/teste/cliente). */
  const Testar = z.object({ conversaId: z.string().min(1), usarPublicado: z.boolean().default(false) });
  app.post('/api/bots/:id/testar', async (req, reply) => {
    exigeGestao(req);
    const b = Testar.parse(req.body);
    const c = await conversaVisivel(req, b.conversaId);
    if (!ehCanalTeste(c.canalId)) return reply.code(400).send({ erro: 'Teste o bot numa conversa do WhatsApp de teste.', codigo: 'conversa_real' });
    return comProblemas(reply, async () => execucao(await bots.testar(param(req, 'id'), c.id, { usarPublicado: b.usarPublicado })));
  });

  // ------------------------------------------------------------ na conversa

  app.get('/api/conversas/:id/bot', async (req, reply) => {
    const c = await conversaVisivel(req, param(req, 'id'));
    return comProblemas(reply, async () => {
      const r = await bots.daConversa(c.id);
      return { ativa: r.ativa ? execucao(r.ativa) : null, fluxos: r.fluxos };
    });
  });

  app.post('/api/conversas/:id/bot', async (req, reply) => {
    const c = await conversaVisivel(req, param(req, 'id'));
    const b = z.object({ fluxoId: z.string().min(1), substituir: z.boolean().default(false) }).parse(req.body);
    return comProblemas(reply, async () => execucao(await bots.iniciar(b.fluxoId, c.id, { substituir: b.substituir, por: req.usuario?.nome })));
  });

  app.post('/api/conversas/:id/bot/parar', async (req, reply) => {
    const c = await conversaVisivel(req, param(req, 'id'));
    return comProblemas(reply, async () => {
      const r = await bots.daConversa(c.id);
      if (!r.ativa) return { ok: true, parou: false };
      await bots.cancelar(r.ativa.id, `Parado por ${req.usuario?.nome ?? 'alguém da equipe'}.`);
      return { ok: true, parou: true };
    });
  });

  // ------------------------------------------------------------ imagens do bloco "Enviar mensagem"

  const Upload = z.object({ nome: z.string().max(200).optional(), mimetype: z.string().regex(/^(image|video|application|audio)\/[\w.+-]+$/), base64: z.string().min(4) });
  app.post('/api/bots/midias', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    exigeGestao(req);
    const b = Upload.parse(req.body);
    const conteudo = Buffer.from(semPrefixoDataUrl(b.base64), 'base64');
    if (conteudo.length > 8 * 1024 * 1024) return reply.code(400).send({ erro: 'Arquivo grande demais (máximo 8 MB).' });
    const m = await bots.guardarMidia({ nome: b.nome, mimetype: b.mimetype, conteudo });
    return reply.code(201).send({ id: m.id, nome: m.nome, mimetype: m.mimetype, url: `/api/bots/midias/${m.id}` });
  });

  app.get('/api/bots/midias/:id', async (req, reply) => {
    return comProblemas(reply, async () => {
      const m = await bots.midia(param(req, 'id'));
      return reply.header('content-type', m.mimetype).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(m.conteudo);
    });
  });
}
