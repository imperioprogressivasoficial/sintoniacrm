import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Usuario } from '../auth/contas.js';
import type { Notificador } from '../notificacoes/notificador.js';
import { ErroEquipe, type Aviso, type ChatEquipe } from './chat.js';

/**
 * Rotas das Conversas de equipe (chat interno). Sempre com login: cada pessoa só vê as salas de que participa.
 * Registradas depois de criarServidor (valem o login e o tratamento de erros de lá).
 *
 * GET    /api/equipe/chat                       → { salas, naoLidas }
 * GET    /api/equipe/chat/resumo                → { naoLidas, versao }
 * GET    /api/equipe/chat/pessoas               → { pessoas }
 * POST   /api/equipe/chat/direta   { pessoaId } → { id }
 * POST   /api/equipe/chat/grupos   { nome, pessoas } → { id }
 * PATCH  /api/equipe/chat/salas/:id { nome?, adicionar? }
 * POST   /api/equipe/chat/salas/:id/sair
 * GET    /api/equipe/chat/salas/:id/mensagens?depois=&antes=&limite=
 * POST   /api/equipe/chat/salas/:id/mensagens { texto, respostaA?, conversaId? }
 * POST   /api/equipe/chat/salas/:id/lida
 */
const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

export function registrarChatEquipe(app: FastifyInstance, o: { chat: ChatEquipe }): void {
  const { chat } = o;
  const eu = (req: FastifyRequest): Usuario => {
    if (!req.usuario) throw erro('Faça login para continuar.', 401);
    return req.usuario;
  };
  const id = (req: FastifyRequest) => (req.params as { id: string }).id;
  const tratar = async <T>(f: () => Promise<T>): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      if (e instanceof z.ZodError) {
        const i = e.issues[0];
        throw erro(i?.message && !/^(Required|Invalid)/.test(i.message) ? i.message : 'Dados inválidos.', 400);
      }
      if (e instanceof ErroEquipe) throw erro(e.message, e.statusCode);
      throw e;
    }
  };

  app.get('/api/equipe/chat', (req) => tratar(() => chat.listar(eu(req))));
  app.get('/api/equipe/chat/resumo', (req) => tratar(() => chat.resumo(eu(req))));
  app.get('/api/equipe/chat/pessoas', (req) => tratar(async () => ({ pessoas: await chat.pessoas(eu(req)) })));
  app.post('/api/equipe/chat/direta', (req) => tratar(() => chat.direta(eu(req), req.body)));
  app.post('/api/equipe/chat/grupos', (req) => tratar(() => chat.grupo(eu(req), req.body)));
  app.patch('/api/equipe/chat/salas/:id', (req) => tratar(() => chat.editar(eu(req), id(req), req.body ?? {})));
  app.post('/api/equipe/chat/salas/:id/sair', (req) => tratar(() => chat.sair(eu(req), id(req))));
  app.get('/api/equipe/chat/salas/:id/mensagens', (req) => tratar(() => chat.mensagens(eu(req), id(req), req.query)));
  app.post('/api/equipe/chat/salas/:id/mensagens', (req) => tratar(() => chat.enviar(eu(req), id(req), req.body ?? {})));
  app.post('/api/equipe/chat/salas/:id/lida', (req) => tratar(() => chat.marcarLida(eu(req), id(req))));
}

/**
 * Aviso de mensagem nova pelo push que já existe (src/notificacoes): respeita "push ligado", "não perturbe" e
 * "avisar a cada mensagem" das preferências da pessoa. Não entra no sino (o contador fica no menu Conversas de equipe).
 * Ao tocar, abre /app#vista=chat-equipe.
 */
export function avisoPorPush(notificador: Pick<Notificador, 'preferencias' | 'entregar'>, agora: () => Date = () => new Date()) {
  return async (a: Aviso) => {
    for (const usuarioId of a.para) {
      const p = await notificador.preferencias(usuarioId);
      if (!p.push || p.mensagens.push === false) continue;
      const em = agora();
      await notificador.entregar(
        { id: randomUUID(), usuarioId, tipo: 'mensagem', titulo: a.titulo, texto: a.texto, vista: 'chat-equipe', contador: 1, criadaEm: em, atualizadaEm: em },
        p,
        false,
        { etiqueta: `equipe-${a.salaId}` },
      );
    }
  };
}
