import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, podeVer } from '../auth/acesso.js';
import type { Repositorio } from '../store/repositorio.js';
import type { Followup } from './followup.js';
import { GATILHO_SITUACAO, MODELOS_CADENCIA, NOME_SITUACAO, SITUACOES, TEXTOS_CONFIRMACAO } from './tipos.js';

/**
 * Rotas /api/followup/... (registradas depois de criarServidor: valem o login e o tratamento de erros de lá).
 * Configuração: só a gestão muda. Selo da conversa e pausa: quem vê a conversa.
 */
export interface OpcoesRotasFollowup {
  followup: Followup;
  repo: Repositorio;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

export function registrarFollowup(app: FastifyInstance, o: OpcoesRotasFollowup): void {
  const f = o.followup;
  const exigeGestao = (req: FastifyRequest) => {
    if (req.usuario && !ehGestor(req.usuario)) throw erro('Só a gerência, a direção e a administração mudam o follow-up.', 403);
  };
  const conversa = async (req: FastifyRequest) => {
    const id = (req.params as { id: string }).id;
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await o.repo.buscarConversa(id) : undefined;
    if (!c || (req.usuario && (c.empresaId !== req.usuario.empresaId || !podeVer(req.usuario, c)))) throw erro('Conversa não encontrada.', 404);
    return c;
  };

  app.get('/api/followup/config', async () => ({
    config: await f.config(),
    situacoes: SITUACOES.map((id) => ({ id, nome: NOME_SITUACAO[id], gatilho: GATILHO_SITUACAO[id], modelo: MODELOS_CADENCIA[id] })),
    textosConfirmacao: TEXTOS_CONFIRMACAO,
  }));

  app.put('/api/followup/config', async (req) => {
    exigeGestao(req);
    try {
      return { config: await f.salvarConfig(req.body, req.usuario?.nome ?? 'teste') };
    } catch (e) {
      if (e instanceof z.ZodError) throw erro(`Configuração inválida: ${e.issues[0]?.path.join('.')} ${e.issues[0]?.message ?? ''}`.trim(), 400);
      throw e;
    }
  });

  app.get('/api/followup/conversa/:id', async (req) => f.seloDaConversa((await conversa(req)).id));

  app.post('/api/followup/conversa/:id/pausar', async (req) => {
    const c = await conversa(req);
    await f.pausar(c.id, req.usuario?.nome ?? 'teste');
    return f.seloDaConversa(c.id);
  });

  app.post('/api/followup/conversa/:id/retomar', async (req) => {
    const c = await conversa(req);
    await f.retomar(c.id);
    return f.seloDaConversa(c.id);
  });

  /** Status das confirmações na Agenda: { agendamento: status }. */
  app.get('/api/followup/confirmacoes', async (req) => {
    const q = req.query as { de?: string; ate?: string };
    const de = q.de && !Number.isNaN(Date.parse(q.de)) ? new Date(q.de) : new Date(Date.now() - 7 * 86400_000);
    const ate = q.ate && !Number.isNaN(Date.parse(q.ate)) ? new Date(q.ate) : new Date(de.getTime() + 60 * 86400_000);
    const lista = await f.confirmacoesEntre(de, ate);
    const status: Record<string, string> = {};
    for (const c of lista) status[c.agendamento] = c.status;
    return { status };
  });

  app.post('/api/followup/confirmacoes/:agendamento', async (req) => {
    const ag = (req.params as { agendamento: string }).agendamento;
    const conf = await f.confirmacao(ag);
    const c = conf ? await o.repo.buscarConversa(conf.conversaId) : undefined;
    if (!c || (req.usuario && (c.empresaId !== req.usuario.empresaId || !podeVer(req.usuario, c)))) throw erro('Agendamento não encontrado.', 404);
    const { status } = z.object({ status: z.enum(['aguardando', 'confirmado', 'remarcar', 'sem_resposta']) }).parse(req.body);
    if (!(await f.definirStatus(ag, status))) throw erro('Agendamento não encontrado.', 404);
    return { ok: true };
  });
}
