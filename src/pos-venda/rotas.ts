import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { podeVer } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import type { Repositorio } from '../store/repositorio.js';
import { ESTILOS, type PosVenda } from './pos-venda.js';

/**
 * pos-venda: rotas do funil pós-venda (registradas depois de criarServidor: valem o login e o tratamento de erros).
 * - GET  /api/pos-venda              configuração (funil, meta) e o número do topo (quem vê o CRM);
 * - PATCH /api/pos-venda             meta de visitas no ano (gestão);
 * - POST /api/pos-venda/sugerido     "Criar funil pós-venda sugerido" (gestão);
 * - GET  /api/pos-venda/conversas/:id visitas no ano da cliente, para a ficha (quem vê a conversa).
 * O quadro do funil pós-venda já vem com as visitas de cada cartão e o resumo (src/rotas/funis.ts).
 */
export interface OpcoesRotasPosVenda {
  posVenda: PosVenda;
  repo: Repositorio;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });
const Alteracao = z.object({ metaVisitas: z.number().int().min(1).max(52) }).strict();
const Sugerido = z.object({ estilo: z.enum(ESTILOS).optional() }).strict().default({});

export function registrarPosVenda(app: FastifyInstance, o: OpcoesRotasPosVenda): void {
  const { posVenda } = o;
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const exigeGestao = (req: FastifyRequest) => {
    if (!pode(req, 'funis_editar') || !pode(req, 'automacoes')) throw erro('Só a gerência, a direção e a administração mexem no funil pós-venda.', 403);
  };
  const lerCorpo = <S extends z.ZodType>(esquema: S, corpo: unknown): z.infer<S> => {
    const r = esquema.safeParse(corpo ?? {});
    if (!r.success) throw erro(`Dados inválidos: ${r.error.issues[0]?.path.join('.') || ''} ${r.error.issues[0]?.message ?? ''}`.trim(), 400);
    return r.data as z.infer<S>;
  };
  const resposta = async () => {
    const c = await posVenda.config();
    return {
      funilId: c.funilId,
      funilNome: c.funil?.nome ?? null,
      metaVisitas: c.metaVisitas,
      sugeridoEm: c.semeadoEm,
      resumo: c.funilId ? await posVenda.resumo(c.funilId) : null,
    };
  };

  app.get('/api/pos-venda', async () => resposta());

  app.patch('/api/pos-venda', async (req) => {
    exigeGestao(req);
    await posVenda.alterarConfig(lerCorpo(Alteracao, req.body), quem(req));
    return resposta();
  });

  app.post('/api/pos-venda/sugerido', async (req, reply) => {
    exigeGestao(req);
    const d = lerCorpo(Sugerido, req.body);
    const r = await posVenda.criarSugerido(quem(req), { estilo: d.estilo });
    reply.code(201);
    return { funil: r.funil, automacoes: r.automacoes, ...(await resposta()) };
  });

  app.get('/api/pos-venda/conversas/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await o.repo.buscarConversa(id).catch(() => undefined) : undefined;
    if (!c || c.empresaId !== posVenda.empresaId || (req.usuario && !podeVer(req.usuario, c))) throw erro('Conversa não encontrada.', 404);
    return posVenda.daConversa(c);
  });
}
