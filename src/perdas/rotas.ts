import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pode } from '../auth/permissoes.js';
import { ErroPerda, type Perdas } from './perdas.js';

/**
 * perdas-saude: lista de motivos de perda da empresa.
 * - GET  /api/perdas/motivos: quem está logado (a tela de mover pergunta com ela); traz também os desativados.
 * - PUT  /api/perdas/motivos: a gestão que mexe nos funis (permissão "funis_editar").
 * O relatório fica em /api/analises/perdas (src/analises/rotas.ts).
 */
export function registrarPerdas(app: FastifyInstance, o: { perdas: Perdas }): void {
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  app.get('/api/perdas/motivos', async (req) => {
    const cfg = await o.perdas.config();
    return { motivos: cfg.motivos, podeEditar: !req.usuario || pode(req, 'funis_editar') };
  });
  app.put('/api/perdas/motivos', async (req, reply) => {
    if (req.usuario && !pode(req, 'funis_editar')) return reply.code(403).send({ erro: 'Só a gestão muda a lista de motivos de perda.' });
    try {
      return await o.perdas.salvarConfig(req.body, quem(req));
    } catch (e) {
      if (e instanceof ErroPerda) return reply.code(e.statusCode).send({ erro: e.message });
      throw e;
    }
  });
}
