import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, veTudo } from '../auth/acesso.js';
import type { Usuario } from '../auth/contas.js';
import type { UnidadeId } from '../domain.js';
import { existeUnidade, idsUnidades, unidadeDe, zUnidade } from '../unidades.js';
import { CONFIG_RODIZIO_PADRAO, type Rodizio } from './rodizio.js';

/**
 * automacao-vendas: rotas do rodízio automático de leads (tela Atendimento › Distribuição e prazos).
 * GET /api/rodizio                → { podeEditar, unidades: [{ id, nome, config, pessoas }], recentes }
 * PUT /api/rodizio/:unidade       { ligado?, regra?, participantes? } → { ok, config } (só a gestão da unidade)
 */
const exigeLogin = (req: FastifyRequest): Usuario => {
  if (!req.usuario) throw Object.assign(new Error('Faça login para continuar.'), { statusCode: 401 });
  return req.usuario;
};

const unidadesDe = (u: Usuario): UnidadeId[] => (veTudo(u) ? idsUnidades(u.empresaId) : u.unidades.filter((x) => existeUnidade(x, u.empresaId)));

export function registrarRodizio(app: FastifyInstance, o: { rodizio: Rodizio }): void {
  app.get('/api/rodizio', async (req, reply) => {
    const u = exigeLogin(req);
    if (!ehGestor(u)) return reply.code(403).send({ erro: 'Só a gestão vê a distribuição de leads.' });
    const configs = await o.rodizio.configs();
    const unidades = [];
    for (const id of unidadesDe(u)) {
      const config = { ...CONFIG_RODIZIO_PADRAO, ...(configs[id] ?? {}) };
      unidades.push({ id, nome: unidadeDe(id).nome, config, pessoas: await o.rodizio.painel(id, config) });
    }
    const recentes = (await o.rodizio.recentes(unidadesDe(u), 15)).map((a) => ({ ...a, unidadeNome: unidadeDe(a.unidade).nome }));
    reply.header('cache-control', 'no-store');
    return { podeEditar: true, unidades, recentes };
  });

  app.put('/api/rodizio/:unidade', { bodyLimit: 20_000 }, async (req, reply) => {
    const u = exigeLogin(req);
    const { unidade } = z.object({ unidade: zUnidade() }).parse(req.params);
    if (!ehGestor(u) || !unidadesDe(u).includes(unidade)) return reply.code(403).send({ erro: 'Só a gestão da unidade muda o rodízio.' });
    try {
      const atual = await o.rodizio.config(unidade);
      const corpo = (req.body ?? {}) as Record<string, unknown>;
      // Quem participa precisa poder receber conversas desta unidade.
      if (Array.isArray(corpo.participantes)) {
        const podem = new Set((await o.rodizio.elegiveis({ empresaId: u.empresaId, unidade }, { ...atual, participantes: corpo.participantes.map(String) })).map((x) => x.id));
        const fora = corpo.participantes.map(String).filter((id) => !podem.has(id));
        if (fora.length) return reply.code(400).send({ erro: 'Escolha só pessoas ativas que atendem esta unidade e podem responder clientes.' });
      }
      return { ok: true, config: await o.rodizio.salvarConfig(unidade, corpo, u.nome) };
    } catch (x) {
      if (x instanceof z.ZodError) return reply.code(400).send({ erro: x.issues[0]?.message ?? 'Configuração inválida' });
      throw x;
    }
  });
}
