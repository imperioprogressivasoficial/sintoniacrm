import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, veTudo, type EscopoVisao } from '../auth/acesso.js';
import type { Contas, Usuario } from '../auth/contas.js';
import { mesDe } from '../painel/painel.js';
import { bahia, DIA, partesBahia } from '../util/tempo.js';
import { novoTokenTv, tokenValido, type ArmazemComercial } from './armazem.js';
import {
  calcularComissao,
  comissaoCsv,
  ConfigComercial,
  CRITERIOS,
  janelaRanking,
  metaDaEquipe,
  montarRanking,
  PERIODOS_RANKING,
  primeiroNome,
  progresso,
  progressoMetas,
  servicosMaisAgendados,
  type Pessoa,
  type PeriodoRanking,
} from './calculo.js';
import type { FonteComercial } from './fonte.js';

/**
 * Rotas do comercial: resumo do Dashboard (minha meta, ranking, serviços), "Metas e comissão" da gestão,
 * relatório de comissão (CSV) e o Painel na TV, público só com o token secreto (/tv/:token/dados), sem dados
 * de clientes além do primeiro nome (e nem isso, se a gestão desligar).
 */
export interface OpcoesComercial {
  armazem: ArmazemComercial;
  fonte: FonteComercial;
  contas?: Contas;
  /** Empresa quando não há login (uso local / testes). */
  empresaId: string;
  agora: () => Date;
  unidades: string[];
  /** Meta antiga do Dashboard (agendamentos do mês), usada na TV quando a equipe não tem meta própria. */
  metaMesAntiga?: () => Promise<number | null>;
  nomeEmpresa?: () => Promise<string>;
}

const erro = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });
const PAPEIS_VENDA = new Set(['atendente', 'recepcionista', 'gerente']);

export function registrarComercial(app: FastifyInstance, o: OpcoesComercial): void {
  const empresaDe = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;
  const exigeGestao = (req: FastifyRequest) => {
    if (req.usuario && !ehGestor(req.usuario)) throw erro(403, 'Só a gerência, a direção e a administração mudam metas, comissão e o Painel na TV.');
  };
  /** O comercial é da equipe: a atendente vê o time das unidades dela (não só as conversas dela). */
  const escopoTime = (empresaId: string, u?: Usuario): EscopoVisao => {
    if (!u) return { empresaId };
    return veTudo(u) ? { empresaId } : { empresaId, unidades: [...u.unidades] };
  };
  const pessoasDe = async (empresaId: string, u?: Usuario): Promise<Pessoa[]> => {
    const todas = o.contas ? await o.contas.listarUsuarios(empresaId) : [];
    return todas
      .filter((p) => p.ativo && PAPEIS_VENDA.has(p.papel))
      .filter((p) => !u || veTudo(u) || p.unidades.some((x) => u.unidades.includes(x)))
      .map((p) => ({ id: p.id, nome: p.nome, unidades: p.unidades }));
  };
  const fatorMeta = (p: PeriodoRanking, agora: Date) => {
    const dias = mesDe(agora).diasNoMes;
    return p === 'dia' ? 1 / dias : p === 'semana' ? 7 / dias : 1;
  };

  async function ranking(empresaId: string, escopo: EscopoVisao, pessoas: Pessoa[], cfg: ConfigComercial, periodo: PeriodoRanking, criterio: (typeof CRITERIOS)[number]) {
    const agora = o.agora();
    const j = janelaRanking(periodo, agora);
    const [atual, anterior] = await Promise.all([o.fonte.carregar(j.inicio, j.fim, escopo), o.fonte.carregar(j.inicioAnterior, j.fimAnterior, escopo)]);
    return { atual, linhas: montarRanking({ atual, anterior, pessoas, cfg, criterio, fatorMeta: fatorMeta(periodo, agora) }) };
  }

  // ------------------------------------------------------------ resumo do Dashboard
  const ResumoQ = z.object({ periodo: z.enum(PERIODOS_RANKING).default('mes'), criterio: z.enum(CRITERIOS).default('agendamentos') });
  app.get('/api/comercial/resumo', async (req) => {
    const { periodo, criterio } = ResumoQ.parse(req.query);
    const u = req.usuario;
    const empresaId = empresaDe(req);
    const { cfg } = await o.armazem.ler(empresaId);
    const escopo = escopoTime(empresaId, u);
    const pessoas = await pessoasDe(empresaId, u);
    const agora = o.agora();
    const m = mesDe(agora);
    const [rk, mes] = await Promise.all([ranking(empresaId, escopo, pessoas, cfg, periodo, criterio), o.fonte.carregar(m.inicio, agora, escopo)]);
    const metas = progressoMetas(mes.vendas, cfg, pessoas, o.unidades);
    const minha = u ? { ...progresso(mes.vendas.filter((v) => v.atendenteId === u.id), cfg.metas.atendentes[u.id], cfg), posicao: rk.linhas.find((l) => l.id === u.id)?.posicao ?? null } : null;
    return {
      periodo,
      criterio,
      mes: m.mes,
      diasRestantes: m.diasRestantes,
      ranking: rk.linhas,
      servicos: servicosMaisAgendados(rk.atual.vendas, cfg).slice(0, 12),
      metas: { equipe: metas.equipe, unidades: metas.unidades },
      minha,
      podeEditar: !u || ehGestor(u),
    };
  });

  // ------------------------------------------------------------ configuração (gestão)
  const tvInfo = (r: { tvToken: string | null; tvCriadoEm: Date | null }) => ({ ativo: Boolean(r.tvToken), caminho: r.tvToken ? `/tv/${r.tvToken}` : null, criadoEm: r.tvCriadoEm });
  app.get('/api/comercial/config', async (req) => {
    exigeGestao(req);
    const empresaId = empresaDe(req);
    const r = await o.armazem.ler(empresaId);
    return { ...r.cfg, tv: { ...r.cfg.tv, ...tvInfo(r) }, pessoas: await pessoasDe(empresaId, req.usuario), unidades: o.unidades, atualizadoEm: r.atualizadoEm, atualizadoPor: r.atualizadoPor };
  });

  app.put('/api/comercial/config', async (req) => {
    exigeGestao(req);
    const empresaId = empresaDe(req);
    const corpo = (req.body ?? {}) as Record<string, unknown>;
    const atual = (await o.armazem.ler(empresaId)).cfg;
    const tvCorpo = corpo.tv && typeof corpo.tv === 'object' ? (corpo.tv as Record<string, unknown>) : {};
    const novo = ConfigComercial.parse({
      metas: corpo.metas ?? atual.metas,
      comissao: corpo.comissao ?? atual.comissao,
      precos: corpo.precos ?? atual.precos,
      tv: { rotacao: tvCorpo.rotacao ?? atual.tv.rotacao, ultimosNomes: tvCorpo.ultimosNomes ?? atual.tv.ultimosNomes },
    });
    await o.armazem.salvar(empresaId, novo, req.usuario?.nome ?? 'teste');
    const r = await o.armazem.ler(empresaId);
    return { ...r.cfg, tv: { ...r.cfg.tv, ...tvInfo(r) } };
  });

  app.post('/api/comercial/tv', async (req) => {
    exigeGestao(req);
    const token = novoTokenTv();
    await o.armazem.definirToken(empresaDe(req), token, o.agora());
    return { ativo: true, token, caminho: `/tv/${token}` };
  });

  app.delete('/api/comercial/tv', async (req) => {
    exigeGestao(req);
    await o.armazem.definirToken(empresaDe(req), null, o.agora());
    return { ativo: false, caminho: null };
  });

  // ------------------------------------------------------------ comissão
  const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const ComissaoQ = z.object({ de: Data.optional(), ate: Data.optional(), formato: z.enum(['json', 'csv']).default('json'), atendenteId: z.string().max(64).optional() });
  const diaBahia = (s: string) => {
    const [a, m, d] = s.split('-').map(Number) as [number, number, number];
    return bahia(a, m, d);
  };
  app.get('/api/comercial/comissao', async (req, reply) => {
    const q = ComissaoQ.parse(req.query);
    const u = req.usuario;
    const empresaId = empresaDe(req);
    const agora = o.agora();
    const inicio = q.de ? diaBahia(q.de) : mesDe(agora).inicio;
    const fim = q.ate ? new Date(diaBahia(q.ate).getTime() + DIA) : agora;
    if (fim <= inicio) throw erro(400, 'A data final precisa ser depois da inicial.');
    if (fim.getTime() - inicio.getTime() > 400 * DIA) throw erro(400, 'Escolha um período de até 13 meses.');
    const { cfg } = await o.armazem.ler(empresaId);
    const gestor = !u || ehGestor(u);
    let pessoas = await pessoasDe(empresaId, u);
    const dados = await o.fonte.carregar(inicio, fim, escopoTime(empresaId, u));
    let linhas = calcularComissao(dados.vendas, cfg, pessoas);
    // Cada atendente vê só a dela.
    if (!gestor) linhas = linhas.filter((l) => l.id === u!.id);
    else if (q.atendenteId) linhas = linhas.filter((l) => l.id === q.atendenteId);
    else if (u && !veTudo(u)) {
      const ids = new Set(pessoas.map((p) => p.id));
      linhas = linhas.filter((l) => ids.has(l.id));
    }
    pessoas = [];
    if (q.formato === 'csv') {
      const p = (d: Date) => {
        const x = partesBahia(d);
        return `${x.ano}-${String(x.mes).padStart(2, '0')}-${String(x.dia).padStart(2, '0')}`;
      };
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="comissao-${p(inicio)}-a-${p(new Date(fim.getTime() - 1))}.csv"`)
        .send(comissaoCsv(linhas));
    }
    return {
      de: inicio,
      ate: fim,
      ligada: cfg.comissao.ligada,
      regras: cfg.comissao.regras,
      soQuemAgendou: cfg.comissao.soQuemAgendou,
      total: Math.round(linhas.reduce((s, l) => s + l.comissao, 0) * 100) / 100,
      atendentes: linhas.map((l) => ({ ...l, itens: l.itens.map((i) => ({ ...i, conversaId: gestor || l.id === u?.id ? i.conversaId : undefined })) })),
    };
  });

  // ------------------------------------------------------------ Painel na TV (público com token)
  const naoAchou = (reply: FastifyReply) => reply.code(404).header('cache-control', 'no-store').send({ erro: 'Este link do Painel na TV não vale mais. Peça um novo para a gestão.' });
  const empresaDoToken = async (token: string) => (tokenValido(token) ? o.armazem.empresaDoToken(token) : undefined);
  const cabecalhosTv = (reply: FastifyReply) =>
    reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow').header('referrer-policy', 'no-referrer');

  app.get('/tv/:token/dados', async (req, reply) => {
    const { token } = req.params as { token: string };
    const empresaId = await empresaDoToken(token);
    if (!empresaId) return naoAchou(reply);
    return cabecalhosTv(reply).send(await dadosTv(empresaId));
  });

  app.get('/tv/:token/foto/:id', async (req, reply) => {
    const { token, id } = req.params as { token: string; id: string };
    const empresaId = await empresaDoToken(token);
    if (!empresaId || !o.contas) return naoAchou(reply);
    const p = await o.contas.buscarPorId(id).catch(() => undefined);
    if (!p || p.empresaId !== empresaId || !p.ativo) return reply.code(404).send();
    const f = await o.contas.fotoDe(id);
    if (!f) return reply.header('cache-control', 'no-store').code(204).send();
    return reply.header('cache-control', 'private, max-age=600').header('referrer-policy', 'no-referrer').type(f.tipo).send(f.conteudo);
  });

  async function dadosTv(empresaId: string) {
    const agora = o.agora();
    const r = await o.armazem.ler(empresaId);
    const cfg = r.cfg;
    const escopo: EscopoVisao = { empresaId };
    const pessoas = await pessoasDe(empresaId);
    const fotos = o.contas ? await o.contas.fotosDaEmpresa(empresaId) : new Map<string, Date>();
    const m = mesDe(agora);
    const d = partesBahia(agora);
    const inicioDia = bahia(d.ano, d.mes, d.dia);
    const [rk, mes] = await Promise.all([ranking(empresaId, escopo, pessoas, cfg, 'mes', 'agendamentos'), o.fonte.carregar(m.inicio, agora, escopo)]);
    const metaEq = metaDaEquipe(cfg);
    const antiga = metaEq.agendamentos || metaEq.valor ? null : ((await o.metaMesAntiga?.().catch(() => null)) ?? null);
    const meta = progresso(mes.vendas, antiga ? { agendamentos: antiga } : metaEq, cfg);
    const hoje = mes.vendas.filter((v) => v.em >= inicioDia);
    const porUnidadeHoje = Object.fromEntries(o.unidades.map((u) => [u, hoje.filter((v) => v.unidade === u).length]));
    const ultimos = mes.vendas
      .slice(-6)
      .reverse()
      .map((v) => ({
        // Chave opaca: muda a cada agendamento novo, sem expor a conversa.
        chave: `${v.em.getTime()}-${v.unidade}`,
        em: v.em,
        cliente: cfg.tv.ultimosNomes ? v.primeiroNome : null,
        servico: v.servico,
        unidade: v.unidade,
        por: v.porIa ? 'IA' : (primeiroNome(v.atendenteNome) ?? 'Equipe'),
      }));
    return {
      empresa: (await o.nomeEmpresa?.().catch(() => undefined)) ?? null,
      agora,
      rotacao: cfg.tv.rotacao,
      mes: { mes: m.mes, diasRestantes: m.diasRestantes, ...meta },
      hoje: { agendamentos: hoje.length, compareceram: hoje.filter((v) => v.compareceu).length, porUnidade: porUnidadeHoje, ia: hoje.filter((v) => v.porIa).length },
      ranking: rk.linhas.slice(0, 10).map((l) => ({
        id: l.id,
        nome: primeiroNome(l.nome) ?? l.nome,
        posicao: l.posicao,
        agendamentos: l.agendamentos,
        comparecimentos: l.comparecimentos,
        valor: l.valor,
        medalha: l.medalha,
        variacao: l.variacao,
        meta: l.meta,
        foto: fotos.has(l.id) ? fotos.get(l.id)!.getTime() : null,
      })),
      servicos: servicosMaisAgendados(mes.vendas, cfg).slice(0, 6).map((s) => ({ servico: s.servico, agendamentos: s.agendamentos, valor: s.valor, porUnidade: s.porUnidade })),
      ultimos,
    };
  }
}
