import type { FastifyInstance, FastifyRequest } from 'fastify';
import { veTudo } from '../auth/acesso.js';
import type { Demo } from './demo.js';

/**
 * Dados de demonstração (Mais › Dados de demonstração). Só administração e direção, sempre com login.
 * GET    /api/demo          existe demonstração? quantos registros
 * POST   /api/demo/popular  preenche (substitui a anterior) e devolve as contagens
 * DELETE /api/demo          apaga só a demonstração e devolve o que apagou
 */
export function registrarDemo(app: FastifyInstance, demo: Demo): void {
  const exige = (req: FastifyRequest) => {
    const u = req.usuario;
    if (!u || !veTudo(u)) throw Object.assign(new Error('Só a administração e a direção mexem nos dados de demonstração.'), { statusCode: 403 });
    return u;
  };
  app.get('/api/demo', async (req) => {
    exige(req);
    return demo.estado();
  });
  app.post('/api/demo/popular', async (req) => {
    const u = exige(req);
    return demo.popular(u);
  });
  app.delete('/api/demo', async (req) => {
    exige(req);
    return demo.apagar();
  });
}
