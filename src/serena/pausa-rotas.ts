import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor } from '../auth/acesso.js';
import type { Usuario } from '../auth/contas.js';
import { calcularAte, DURACOES, type ChaveSerena } from './pausa.js';

/**
 * serena-chave: rotas da chave geral da Serena (registradas depois de criarServidor: valem o login e os erros de lá).
 * GET /api/ia/pausa  → estado para todo mundo da equipe (as telas mostram a faixa) + se a pessoa pode mudar.
 * PUT /api/ia/pausa  { pausada: true, duracao: '1h' | 'amanha' | 'indefinido' | ate: ISO, motivo? } ou { pausada: false }
 *                    → só a gestão (gerente, direção, administração). Fica na auditoria e vira aviso para a equipe.
 */
export interface OpcoesRotasPausa {
  chave: ChaveSerena;
  /** Há chave da IA em Conexões? Sem ela a chave aparece desligada ("Falta a chave em Conexões"). */
  temChave: () => boolean;
  agora?: () => Date;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });
const exigeLogin = (req: FastifyRequest): Usuario => {
  if (!req.usuario) throw erro('Faça login para continuar.', 401);
  return req.usuario;
};

const Pedido = z.union([
  z.object({ pausada: z.literal(false) }).strict(),
  z
    .object({
      pausada: z.literal(true),
      duracao: z.enum(DURACOES).optional(),
      ate: z.string().datetime({ offset: true }).optional(),
      motivo: z.string().trim().max(200).optional(),
    })
    .strict()
    .refine((p) => Boolean(p.duracao) !== Boolean(p.ate), { message: 'Escolha por quanto tempo pausar.' }),
]);

export function registrarPausaSerena(app: FastifyInstance, o: OpcoesRotasPausa): void {
  const estado = (u: Usuario) => ({
    ...o.chave.paraTela(),
    temChave: o.temChave(),
    podeMudar: ehGestor(u),
  });

  app.get('/api/ia/pausa', async (req, reply) => {
    const u = exigeLogin(req);
    reply.header('cache-control', 'no-store');
    return estado(u);
  });

  app.put('/api/ia/pausa', { bodyLimit: 4_000 }, async (req, reply) => {
    const u = exigeLogin(req);
    if (!ehGestor(u)) return reply.code(403).send({ erro: 'Só a gestão liga e desliga a Serena.' });
    const b = Pedido.parse(req.body);
    const quem = { id: u.id, nome: u.nome, papel: u.papel, ip: req.ip };
    if (!b.pausada) {
      await o.chave.ligar(quem);
      return estado(u);
    }
    if (!o.temChave()) return reply.code(409).send({ erro: 'Falta a chave da IA em Conexões: a Serena já está sem atender.' });
    const agora = o.agora?.() ?? new Date();
    const ate = b.ate ? new Date(b.ate) : calcularAte(b.duracao!, agora);
    if (ate && ate.getTime() - agora.getTime() > 31 * 24 * 60 * 60_000) return reply.code(400).send({ erro: 'Pause por no máximo 30 dias (ou "até eu ligar de novo").' });
    await o.chave.pausar({ ate, motivo: b.motivo ?? null, ...(b.duracao ? { duracao: b.duracao } : {}) }, quem);
    return estado(u);
  });
}
