import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import type { Aprender } from './aprender.js';

/**
 * ia-aprende: rotas do "Aprender com a equipe" (Inteligência › Treinamento). Só a gestão (gerência, direção e
 * administração com a permissão "Agentes de IA") vê e mexe. Sem login (teste local), liberado como o resto da API.
 * GET    /api/ia/aprender                       andamento, chave e contagens
 * POST   /api/ia/aprender/estudar               "Estudar as conversas agora" (202; segue em segundo plano)
 * PATCH  /api/ia/aprender/config { auto }       chave "Aprender sozinha"
 * GET    /api/ia/aprender/itens?lista=pendentes|aprendidos
 * POST   /api/ia/aprender/itens/:id/aprovar     { texto?, pergunta?, resposta?, destino? } (editar e aprovar)
 * POST   /api/ia/aprender/itens/:id/recusar
 * POST   /api/ia/aprender/itens/:id/desfazer
 * POST   /api/ia/aprender/documento { nome, base64? | texto? }   PDF ou texto do dono (202)
 */
export interface OpcoesRotasAprender {
  /** O serviço da empresa de quem pediu (um servidor atende uma empresa; outra empresa não vê nada). */
  aprender: (empresaId: string) => Aprender | undefined;
  empresaId: string;
}

const proibido = () => Object.assign(new Error('Só a gerência, a direção e a administração ensinam a IA.'), { statusCode: 403 });
const naoEncontrado = () => Object.assign(new Error('Aprender com a equipe não está disponível aqui.'), { statusCode: 404 });

export function registrarAprender(app: FastifyInstance, o: OpcoesRotasAprender): void {
  const servico = (req: FastifyRequest) => {
    const u = req.usuario;
    if (u && (!ehGestor(u) || !pode(req, 'agentes_ia'))) throw proibido();
    const s = o.aprender(u?.empresaId ?? o.empresaId);
    if (!s) throw naoEncontrado();
    return s;
  };
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const idDe = (req: FastifyRequest) => z.string().uuid('Aprendizado não encontrado.').parse((req.params as { id: string }).id);

  app.get('/api/ia/aprender', async (req) => servico(req).estado());

  app.post('/api/ia/aprender/estudar', async (req, reply) => reply.code(202).send(await servico(req).estudar(quem(req))));

  app.patch('/api/ia/aprender/config', async (req) => servico(req).configurar(z.object({ auto: z.boolean() }).strict().parse(req.body), quem(req)));

  app.get('/api/ia/aprender/itens', async (req) => {
    const { lista } = z.object({ lista: z.enum(['pendentes', 'aprendidos']).default('pendentes') }).parse(req.query);
    return servico(req).itens(lista);
  });

  const Edicao = z
    .object({
      texto: z.string().trim().min(1).max(2000).optional(),
      pergunta: z.string().trim().min(3).max(500).optional(),
      resposta: z.string().trim().min(1).max(2000).optional(),
      destino: z.string().trim().min(1).max(80).optional(),
    })
    .strict();
  app.post('/api/ia/aprender/itens/:id/aprovar', async (req) => servico(req).aprovar(idDe(req), Edicao.parse(req.body ?? {}), quem(req)));
  app.post('/api/ia/aprender/itens/:id/recusar', async (req) => servico(req).recusar(idDe(req), quem(req)));
  app.post('/api/ia/aprender/itens/:id/desfazer', async (req) => servico(req).desfazer(idDe(req), quem(req)));

  app.post('/api/ia/aprender/documento', { bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    const s = servico(req);
    const f = z
      .object({
        nome: z.string().trim().min(1).max(160).regex(/\.(txt|pdf|md)$/i, 'Envie um arquivo .pdf ou .txt.'),
        base64: z.string().max(14_000_000).optional(),
        texto: z.string().max(200_000).optional(),
      })
      .refine((v) => v.base64 || v.texto, 'Envie o arquivo ou cole o texto.')
      .parse(req.body);
    return reply.code(202).send(await s.enviarDocumento(f, quem(req)));
  });
}
