import type { FastifyInstance } from 'fastify';
import { ehGestor } from '../auth/acesso.js';
import type { PainelSaude } from './painel.js';

/**
 * perdas-saude: GET /api/saude/painel — painel de saúde da gestão (Análises › Saúde do sistema).
 * Só gerência, direção e administração. A tela pede a cada 15 s enquanto está aberta (e visível).
 * O /saude público (Docker) continua igual e mínimo.
 */
export function registrarSaude(app: FastifyInstance, o: { painel: PainelSaude }): void {
  app.get('/api/saude/painel', async (req, reply) => {
    if (req.usuario && !ehGestor(req.usuario)) return reply.code(403).send({ erro: 'A saúde do sistema fica com a gerência, a direção e a administração.' });
    reply.header('cache-control', 'no-store');
    return o.painel.montar();
  });
}
