import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import type { Repositorio } from '../store/repositorio.js';
import { ehGestor, escopoDe, podeVer } from '../auth/acesso.js';
import { ehCanalTeste } from '../channels/teste.js';
import type { Funis } from '../funis/funis.js';
import type { Automacoes } from '../automacoes/automacoes.js';

/**
 * Rotas dos funis por tags e das automações. Registradas depois de criarServidor (src/index.ts),
 * então valem o login, o bloqueio da API e o tratamento de erros de lá.
 * Sem login configurado (teste local) tudo fica liberado, como no resto da API.
 *
 * Quem pode: gestão (gerente, direção, admin) cria/edita funis, etapas e automações;
 * quem vê a conversa pode movê-la; listas e quadro só mostram o que a pessoa vê.
 */
export interface OpcoesRotasFunis {
  repo: Repositorio;
  funis: Funis;
  automacoes?: Automacoes;
}

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });
const UNIDADE = z.enum(['norte', 'sumare', 'feira']);

export function registrarFunis(app: FastifyInstance, o: OpcoesRotasFunis): void {
  const { funis } = o;
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  const exigeGestao = (req: FastifyRequest, msg = 'Só a gerência, a direção e a administração mexem nos funis e nas automações.') => {
    if (req.usuario && !ehGestor(req.usuario)) throw proibido(msg);
  };
  const visivel = (req: FastifyRequest, c: Conversa) => !req.usuario || podeVer(req.usuario, c);
  async function conversaVisivel(req: FastifyRequest, id: string): Promise<Conversa> {
    const c = await o.repo.buscarConversa(id).catch(() => undefined);
    if (!c || c.empresaId !== funis.empresaId || !visivel(req, c)) throw Object.assign(new Error('Conversa não encontrada'), { statusCode: 404 });
    return c;
  }
  const automacoes = () => {
    if (!o.automacoes) throw Object.assign(new Error('As automações não estão configuradas neste servidor.'), { statusCode: 501 });
    return o.automacoes;
  };
  const param = (req: FastifyRequest, nome: string) => (req.params as Record<string, string>)[nome]!;
  const comEtapas = async (id: string) => ({ ...(await funis.exigir(id)), etapas: await funis.etapas(id) });

  // ------------------------------------------------------------ funis e etapas
  const EtapaNova = z.object({ nome: z.string().max(60), cor: z.string().max(10).optional() });
  const FunilNovo = z.object({ nome: z.string().max(80), etapas: z.array(EtapaNova).max(30).optional() });
  const FunilAlteracao = z
    .object({ nome: z.string().max(80).optional(), ordem: z.number().int().min(0).max(1000).optional() })
    .refine((v) => v.nome !== undefined || v.ordem !== undefined, 'Informe o nome ou a ordem.');
  const EtapaAlteracao = z
    .object({ nome: z.string().max(60).optional(), cor: z.string().max(10).optional() })
    .refine((v) => v.nome !== undefined || v.cor !== undefined, 'Informe o nome ou a cor.');
  const Ordem = z.object({ ids: z.array(z.string().min(1)).max(100) });

  app.get('/api/funis', async (req) => funis.listarComEtapas(escopoDe(req.usuario)));

  app.post('/api/funis', async (req, reply) => {
    exigeGestao(req);
    const f = await funis.criar(FunilNovo.parse(req.body), quem(req));
    return reply.code(201).send(await comEtapas(f.id));
  });

  app.patch('/api/funis/:id', async (req) => {
    exigeGestao(req);
    await funis.alterar(param(req, 'id'), FunilAlteracao.parse(req.body));
    return comEtapas(param(req, 'id'));
  });

  app.delete('/api/funis/:id', async (req) => {
    exigeGestao(req);
    await funis.apagar(param(req, 'id'));
    return { ok: true };
  });

  app.post('/api/funis/:id/etapas', async (req, reply) => {
    exigeGestao(req);
    return reply.code(201).send(await funis.criarEtapa(param(req, 'id'), EtapaNova.parse(req.body), quem(req)));
  });

  app.patch('/api/funis/:id/etapas/:etapaId', async (req) => {
    exigeGestao(req);
    return funis.alterarEtapa(param(req, 'id'), param(req, 'etapaId'), EtapaAlteracao.parse(req.body));
  });

  app.delete('/api/funis/:id/etapas/:etapaId', async (req, reply) => {
    exigeGestao(req);
    const { moverPara } = z.object({ moverPara: z.string().min(1).optional() }).parse(req.query);
    try {
      return { ok: true, movidas: await funis.apagarEtapa(param(req, 'id'), param(req, 'etapaId'), moverPara, quem(req)) };
    } catch (e) {
      const x = e as { codigo?: string; conversas?: number; message: string };
      if (x.codigo === 'etapa_com_conversas') return reply.code(409).send({ erro: x.message, codigo: x.codigo, conversas: x.conversas });
      throw e;
    }
  });

  app.post('/api/funis/:id/etapas/ordem', async (req) => {
    exigeGestao(req);
    return funis.reordenarEtapas(param(req, 'id'), Ordem.parse(req.body).ids);
  });

  const QuadroQ = z.object({
    unidade: UNIDADE.optional(),
    busca: z.string().trim().max(80).optional(),
    etapaId: z.string().min(1).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limite: z.coerce.number().int().min(1).max(200).default(50),
  });
  app.get('/api/funis/:id/quadro', async (req) => {
    const q = QuadroQ.parse(req.query);
    return funis.quadro(param(req, 'id'), { ...q, busca: q.busca || undefined, escopo: escopoDe(req.usuario) });
  });

  // ------------------------------------------------------------ cartões
  app.get('/api/conversas/:id/funis', async (req) => funis.daConversa(await conversaVisivel(req, param(req, 'id'))));

  const Mover = z.object({ etapaId: z.string().min(1).nullable() });
  app.post('/api/conversas/:id/funis/:funilId', async (req) => {
    const { etapaId } = Mover.parse(req.body);
    const c = await conversaVisivel(req, param(req, 'id'));
    const r = await funis.mover(c.id, param(req, 'funilId'), etapaId, { nome: quem(req), id: req.usuario?.id ?? null });
    const depois = (await o.repo.buscarConversa(c.id)) ?? c;
    return { ok: true, mudou: r.mudou, etapa: depois.etapa, funis: await funis.daConversa(depois) };
  });

  // ------------------------------------------------------------ automações
  const ConfigQ = z.object({ limiteDiario: z.number().int().min(0).max(20) });
  app.get('/api/automacoes/config', async (req) => {
    exigeGestao(req);
    return automacoes().config();
  });
  app.patch('/api/automacoes/config', async (req) => {
    exigeGestao(req);
    return automacoes().alterarConfig(ConfigQ.parse(req.body), quem(req));
  });

  app.get('/api/automacoes', async (req) => {
    exigeGestao(req);
    const { funilId } = z.object({ funilId: z.string().min(1).optional() }).parse(req.query);
    const lista = await automacoes().listar();
    return funilId ? lista.filter((a) => (funilId === 'geral' ? !a.funilId : a.funilId === funilId)) : lista;
  });

  app.post('/api/automacoes', async (req, reply) => {
    exigeGestao(req);
    return reply.code(201).send(await automacoes().criar(req.body, quem(req)));
  });

  app.get('/api/automacoes/:id', async (req) => {
    exigeGestao(req);
    return automacoes().exigir(param(req, 'id'));
  });

  app.patch('/api/automacoes/:id', async (req) => {
    exigeGestao(req);
    return automacoes().alterar(param(req, 'id'), req.body);
  });

  app.delete('/api/automacoes/:id', async (req) => {
    exigeGestao(req);
    await automacoes().apagar(param(req, 'id'));
    return { ok: true };
  });

  app.post('/api/automacoes/:id/ligar', async (req) => {
    exigeGestao(req);
    return automacoes().ligar(param(req, 'id'), true);
  });
  app.post('/api/automacoes/:id/desligar', async (req) => {
    exigeGestao(req);
    return automacoes().ligar(param(req, 'id'), false);
  });

  app.get('/api/automacoes/:id/execucoes', async (req) => {
    exigeGestao(req);
    const { limite } = z.object({ limite: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    return automacoes().execucoes(param(req, 'id'), limite);
  });

  const Testar = z.object({ conversaId: z.string().min(1), permitirReal: z.boolean().default(false) });
  app.post('/api/automacoes/:id/testar', async (req, reply) => {
    exigeGestao(req);
    const b = Testar.parse(req.body);
    const c = await conversaVisivel(req, b.conversaId);
    if (!ehCanalTeste(c.canalId) && !b.permitirReal) {
      return reply.code(400).send({
        erro: 'Teste numa conversa do WhatsApp de teste. Numa cliente de verdade as mensagens saem de verdade: mande permitirReal: true para confirmar.',
        codigo: 'conversa_real',
      });
    }
    return automacoes().testar(param(req, 'id'), c.id);
  });
}
