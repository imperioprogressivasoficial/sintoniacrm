import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { podeVer } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ErroProdutosLead, type ProdutosLead } from './lead-produtos.js';

/**
 * Rotas dos produtos e serviços vinculados ao lead (produtos-lead, migração 520):
 * - GET    /api/conversas/:id/produtos            itens, total e se o valor do lead vem da soma (quem vê a conversa)
 * - POST   /api/conversas/:id/produtos            adiciona do cadastro (quem pode mudar o CRM)
 * - PATCH  /api/conversas/:id/produtos/:itemId    quantidade, preço e desconto
 * - DELETE /api/conversas/:id/produtos/:itemId
 * - GET/PUT /api/produtos-lead/config             "valor do lead = soma dos produtos" (gestão muda)
 */
export interface OpcoesRotasProdutosLead {
  repo: Repositorio;
  servico: ProdutosLead;
  empresaId: string;
}

const erro = (statusCode: number, msg: string) => Object.assign(new Error(msg), { statusCode });
const validar = <S extends z.ZodTypeAny>(s: S, v: unknown): z.infer<S> => {
  const r = s.safeParse(v ?? {});
  if (r.success) return r.data;
  const i = r.error.issues[0];
  throw erro(400, i?.message && !/^(Invalid|Expected|Too|Number must|String must)/.test(i.message) ? i.message : 'Confira os dados.');
};

const Quantidade = z.number({ error: 'Quantidade inválida.' }).int('Use um número inteiro na quantidade.').min(1, 'A quantidade mínima é 1.').max(9999, 'Quantidade grande demais.');
const Dinheiro = (rotulo: string) => z.number({ error: `${rotulo} inválido.` }).min(0, `${rotulo} não pode ser negativo.`).max(10_000_000, `${rotulo} grande demais.`);
const Novo = z.object({
  produtoId: z.string().uuid('Escolha um produto do cadastro.'),
  quantidade: Quantidade.optional(),
  preco: Dinheiro('Preço').nullable().optional(),
  desconto: Dinheiro('Desconto').optional(),
});
const Edicao = z
  .object({ quantidade: Quantidade.optional(), preco: Dinheiro('Preço').optional(), desconto: Dinheiro('Desconto').optional() })
  .refine((v) => v.quantidade !== undefined || v.preco !== undefined || v.desconto !== undefined, 'Informe a quantidade, o preço ou o desconto.');
const Config = z.object({ valorPelaSoma: z.boolean() });

export function registrarProdutosLead(app: FastifyInstance, o: OpcoesRotasProdutosLead): void {
  const empresaDe = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const param = (req: FastifyRequest, nome: string) => (req.params as Record<string, string>)[nome]!;
  async function conversaVisivel(req: FastifyRequest): Promise<Conversa> {
    const c = await o.repo.buscarConversa(param(req, 'id')).catch(() => undefined);
    if (!c || c.empresaId !== empresaDe(req) || (req.usuario && !podeVer(req.usuario, c))) throw erro(404, 'Conversa não encontrada');
    return c;
  }
  const exigeCrm = (req: FastifyRequest) => {
    if (!pode(req, 'crm_mover')) throw erro(403, 'Você não pode mudar o CRM. Fale com a gestão.');
  };
  const comErro = async <R>(fn: () => Promise<R>) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroProdutosLead) throw erro(e.statusCode, e.message);
      throw e;
    }
  };
  const resposta = async (req: FastifyRequest, r: Awaited<ReturnType<ProdutosLead['daConversa']>>) => ({ ...r, podeEditar: pode(req, 'crm_mover') });

  app.get('/api/conversas/:id/produtos', async (req) => resposta(req, await o.servico.daConversa(await conversaVisivel(req))));
  app.post('/api/conversas/:id/produtos', async (req, reply) => {
    exigeCrm(req);
    const b = validar(Novo, req.body);
    const c = await conversaVisivel(req);
    return reply.code(201).send(await resposta(req, await comErro(() => o.servico.adicionar(c, b, quem(req)))));
  });
  app.patch('/api/conversas/:id/produtos/:itemId', async (req) => {
    exigeCrm(req);
    const b = validar(Edicao, req.body);
    const c = await conversaVisivel(req);
    return resposta(req, await comErro(() => o.servico.alterar(c, param(req, 'itemId'), b, quem(req))));
  });
  app.delete('/api/conversas/:id/produtos/:itemId', async (req) => {
    exigeCrm(req);
    const c = await conversaVisivel(req);
    return resposta(req, await comErro(() => o.servico.remover(c, param(req, 'itemId'), quem(req))));
  });

  app.get('/api/produtos-lead/config', async (req) => ({ ...(await o.servico.config(empresaDe(req))), podeEditar: pode(req, 'funis_editar') }));
  app.put('/api/produtos-lead/config', async (req) => {
    if (!pode(req, 'funis_editar')) throw erro(403, 'Só a gerência, a direção e a administração mudam esta opção.');
    const b = validar(Config, req.body);
    return { ...(await o.servico.gravarConfig(empresaDe(req), b.valorPelaSoma, quem(req))), podeEditar: true };
  });
}
