import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Usuario } from '../auth/contas.js';
import type { ArmazemNotificacoes } from './armazem.js';
import type { Notificador } from './notificador.js';
import type { ChavesPush } from './push.js';
import { completarPreferencias, emNaoPerturbe, EsquemaPreferencias, type Notificacao } from './tipos.js';

export interface OpcoesNotificacoes {
  notificador: Notificador;
  armazem: ArmazemNotificacoes;
  /** Sem chaves, o push fica desligado (a rota da chave responde 501). */
  chaves?: ChavesPush;
  agora?: () => Date;
}

const exigeLogin = (req: FastifyRequest): Usuario => {
  if (!req.usuario) throw Object.assign(new Error('Faça login para continuar.'), { statusCode: 401 });
  return req.usuario;
};

const paraTela = (n: Notificacao) => ({
  id: n.id,
  tipo: n.tipo,
  titulo: n.titulo,
  texto: n.texto,
  contador: n.contador,
  conversaId: n.conversaId ?? null,
  vista: n.vista ?? null,
  em: n.atualizadaEm,
  criadaEm: n.criadaEm,
  lida: Boolean(n.lidaEm),
});

/** Cursor opaco: "<ms>_<id>" da última notificação mostrada. */
const lerCursor = (s?: string) => {
  const m = s?.match(/^(\d+)_([0-9a-f-]{36})$/i);
  return m ? { em: new Date(Number(m[1])), id: m[2]! } : undefined;
};
const cursorDe = (n: Notificacao) => `${n.atualizadaEm.getTime()}_${n.id}`;

/**
 * Cabeçalho com o resumo das notificações (não lidas, versão e se está no "não perturbe"),
 * posto nas respostas que o app já busca periodicamente: o sino se atualiza sem chamada nova.
 */
export async function cabecalhoNotificacoes(o: OpcoesNotificacoes | undefined, req: FastifyRequest, reply: FastifyReply): Promise<{ naoLidas: number; versao: number; silencio: boolean } | undefined> {
  if (!o || !req.usuario) return undefined;
  try {
    const r = await o.notificador.resumo(req.usuario.id);
    const prefs = await o.notificador.preferencias(req.usuario.id);
    const resumo = { ...r, silencio: emNaoPerturbe(prefs, o.agora?.() ?? new Date()) };
    reply.header('x-notificacoes', JSON.stringify({ n: resumo.naoLidas, v: resumo.versao, s: resumo.silencio ? 1 : 0 }));
    return resumo;
  } catch {
    return undefined; // o sino nunca derruba a lista de conversas
  }
}

export function registrarNotificacoes(app: FastifyInstance, o: OpcoesNotificacoes): void {
  const agora = () => o.agora?.() ?? new Date();

  app.get('/api/notificacoes', async (req, reply) => {
    const u = exigeLogin(req);
    const q = z.object({ antes: z.string().max(80).optional(), limite: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const itens = await o.notificador.listar(u.id, q.limite + 1, lerCursor(q.antes));
    const pagina = itens.slice(0, q.limite);
    const resumo = await cabecalhoNotificacoes(o, req, reply);
    return {
      itens: pagina.map(paraTela),
      proximo: itens.length > q.limite && pagina.length ? cursorDe(pagina[pagina.length - 1]!) : null,
      naoLidas: resumo?.naoLidas ?? 0,
      versao: resumo?.versao ?? 0,
      silencio: resumo?.silencio ?? false,
    };
  });

  app.post('/api/notificacoes/lidas', async (req) => {
    const u = exigeLogin(req);
    return { ok: true, marcadas: await o.armazem.marcarTodas(u.id, agora()) };
  });

  app.post('/api/notificacoes/:id/lida', async (req, reply) => {
    const u = exigeLogin(req);
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    if (!(await o.armazem.marcarLida(u.id, id, agora()))) return reply.code(404).send({ erro: 'Notificação não encontrada' });
    return { ok: true };
  });

  app.get('/api/notificacoes/preferencias', async (req) => {
    const u = exigeLogin(req);
    const p = await o.notificador.preferencias(u.id);
    return { ...p, pushDisponivel: Boolean(o.chaves), aparelhos: (await o.armazem.inscricoes(u.id)).length };
  });

  app.put('/api/notificacoes/preferencias', async (req) => {
    const u = exigeLogin(req);
    const b = EsquemaPreferencias.partial().parse(req.body);
    const atual = await o.notificador.preferencias(u.id);
    const nova = completarPreferencias({ ...atual, ...b, tipos: { ...atual.tipos, ...(b.tipos ?? {}) } });
    await o.armazem.salvarPreferencias(u.id, nova);
    return nova;
  });

  /** Manda uma notificação de teste para a própria pessoa (e para os aparelhos dela). */
  app.post('/api/notificacoes/teste', async (req) => {
    const u = exigeLogin(req);
    const n = await o.notificador.testar(u);
    return { ok: true, id: n?.id ?? null, aparelhos: (await o.armazem.inscricoes(u.id)).length };
  });

  // ---------- Web Push ----------
  app.get('/api/push/chave', async (req, reply) => {
    exigeLogin(req);
    if (!o.chaves) return reply.code(501).send({ erro: 'Push desligado neste servidor' });
    return { chave: (await o.chaves.obter()).publica };
  });

  const Inscricao = z.object({
    endpoint: z.string().url().max(1000).refine((s) => s.startsWith('https://'), 'Endereço de push inválido'),
    keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  });
  app.post('/api/push/inscrever', async (req) => {
    const u = exigeLogin(req);
    const b = Inscricao.parse(req.body);
    const agente = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : undefined;
    await o.armazem.inscrever({ endpoint: b.endpoint, usuarioId: u.id, p256dh: b.keys.p256dh, auth: b.keys.auth, ...(agente ? { agente } : {}) });
    return { ok: true, aparelhos: (await o.armazem.inscricoes(u.id)).length };
  });

  app.post('/api/push/sair', async (req) => {
    const u = exigeLogin(req);
    const b = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    return { ok: await o.armazem.removerInscricao(b.endpoint, u.id) };
  });
}
