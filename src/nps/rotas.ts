import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { escopoDe, podeVer } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import type { Automacoes } from '../automacoes/automacoes.js';
import type { Conversa } from '../domain.js';
import { janela, PERIODOS } from '../painel/painel.js';
import { periodoRelatorio } from '../relatorios/relatorios.js';
import type { Repositorio } from '../store/repositorio.js';
import { gerarCsv, nomeArquivo } from '../util/csv.js';
import { dataISO } from '../util/tempo.js';
import { ErroNps, type Nps } from './nps.js';
import { MOTIVOS_FINALIZACAO, NOME_MOTIVO } from './tipos.js';

/**
 * Rotas do finalizar atendimento e da pesquisa de satisfação (NPS).
 * sem-exemplos: saíram as rotas dos modelos prontos de automação (GET /api/automacoes/modelos e
 * POST /api/automacoes/modelos/pos-venda); o gerador do pós-venda fica em src/automacoes/modelos.ts para a futura Ajuda.
 * Registradas depois de criarServidor: valem o login e o tratamento de erros de lá.
 * - Finalizar: quem vê a conversa.
 * - Configurar a pesquisa: quem mexe nas automações.
 * - Resultado (Dashboard e Relatórios): quem vê relatórios, só das unidades que a pessoa vê.
 */
export interface OpcoesRotasNps {
  nps: Nps;
  repo: Repositorio;
  automacoes?: Automacoes;
  agora?: () => Date;
}

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const FiltroQ = z.object({
  periodo: z.enum([...PERIODOS, 'personalizado']).default('30d'),
  de: Data.optional(),
  ate: Data.optional(),
  unidade: z.string().min(1).max(40).optional(),
  atendente: z.string().min(1).max(80).optional(),
});

export function registrarNps(app: FastifyInstance, o: OpcoesRotasNps): void {
  const { nps } = o;
  const agora = o.agora ?? (() => new Date());
  const quem = (req: FastifyRequest) => ({ id: req.usuario?.id, nome: req.usuario?.nome ?? 'teste' });
  const exigir = (req: FastifyRequest, p: 'automacoes' | 'relatorios', msg: string) => {
    if (!pode(req, p)) throw erro(msg, 403);
  };
  const conversa = async (req: FastifyRequest): Promise<Conversa> => {
    const id = (req.params as { id: string }).id;
    const c = /^[0-9a-f-]{36}$/i.test(id) ? await o.repo.buscarConversa(id).catch(() => undefined) : undefined;
    if (!c || (req.usuario && (c.empresaId !== req.usuario.empresaId || !podeVer(req.usuario, c)))) throw erro('Conversa não encontrada.', 404);
    return c;
  };
  const motivos = () => MOTIVOS_FINALIZACAO.map((id) => ({ id, nome: NOME_MOTIVO[id] }));
  const validacao = (e: unknown) => {
    if (e instanceof z.ZodError) {
      const i = e.issues[0];
      return erro(`Dados inválidos: ${i?.path.join('.') || ''} ${i?.message ?? ''}`.trim(), 400);
    }
    if (e instanceof ErroNps) return erro(e.message, e.statusCode);
    return e;
  };

  // ------------------------------------------------------------ finalizar atendimento
  app.get('/api/conversas/:id/finalizar', async (req) => {
    const c = await conversa(req);
    const cfg = await nps.config();
    return { motivos: motivos(), pesquisa: { ligada: cfg.ligada, motivos: cfg.motivos }, ...(await nps.daConversa(c.id)) };
  });

  app.post('/api/conversas/:id/finalizar', async (req) => {
    const c = await conversa(req);
    try {
      const r = await nps.finalizar(c.id, req.body, quem(req));
      return { ok: true, finalizacao: r.finalizacao, pesquisa: r.pesquisa ? { estado: r.pesquisa.estado } : null, aviso: r.aviso };
    } catch (e) {
      throw validacao(e);
    }
  });

  // ------------------------------------------------------------ configuração da pesquisa
  const MSG_CFG = 'Só a gestão muda a pesquisa de satisfação.';
  app.get('/api/nps/config', async (req) => {
    exigir(req, 'automacoes', MSG_CFG);
    return { config: await nps.config(), motivos: motivos() }; // sem-exemplos: sem os textos de exemplo
  });
  app.put('/api/nps/config', async (req) => {
    exigir(req, 'automacoes', MSG_CFG);
    try {
      return { config: await nps.salvarConfig(req.body, quem(req).nome) };
    } catch (e) {
      throw validacao(e);
    }
  });

  // ------------------------------------------------------------ resultado
  const MSG_REL = 'Só a gerência, a direção e a administração veem o resultado da pesquisa.';
  const filtro = (req: FastifyRequest) => {
    const f = FiltroQ.parse(req.query);
    const p =
      f.periodo === 'personalizado' || f.periodo === 'hoje' || f.periodo === '7d' || f.periodo === '30d'
        ? periodoRelatorio({ periodo: f.periodo, de: f.de, ate: f.ate }, agora())
        : janela(f.periodo, agora());
    const esc = escopoDe(req.usuario);
    // +1 ms: o que aconteceu agora mesmo entra.
    return { inicio: p.inicio, fim: new Date(p.fim.getTime() + 1), unidades: esc.unidades, unidade: f.unidade, atendente: f.atendente, periodo: f.periodo };
  };
  app.get('/api/nps/resumo', async (req) => {
    exigir(req, 'relatorios', MSG_REL);
    const f = filtro(req);
    const cfg = await nps.config();
    return { periodo: f.periodo, ligada: cfg.ligada, ...(await nps.resumo(f)) };
  });
  app.get('/api/nps/csv', async (req, reply) => {
    exigir(req, 'relatorios', MSG_REL);
    const f = filtro(req);
    const r = await nps.resumo(f);
    const linhas = [
      ['Geral', r.total, r.nps, r.promotores, r.neutros, r.detratores, ''],
      ...r.porAtendente.map((a) => [a.nome, a.total, a.nps, a.promotores, a.neutros, a.detratores, a.media]),
    ];
    const csv = gerarCsv(['Atendente', 'Respostas', 'NPS', 'Promotores (9-10)', 'Neutros (7-8)', 'Detratores (0-6)', 'Média'], linhas);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeArquivo(`nps-${dataISO(f.inicio)}-a-${dataISO(new Date(f.fim.getTime() - 1))}.csv`)}"`)
      .header('cache-control', 'no-store')
      .send(csv);
  });
}
