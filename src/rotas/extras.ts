import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { ETAPAS, type Conversa, type UnidadeId } from '../domain.js';
import type { ArmazemContatos, ContatosMemoria } from '../contatos/contatos.js';
import type { RepositorioMemoria } from '../store/repositorio.js';
import type { ArmazemTags, Tags } from '../tags/tags.js';
import { ArmazemLeadsMemoria, ArmazemLeadsPostgres, type ArmazemLeads } from '../leads/armazem.js';
import { Leads as LeadsClasse } from '../leads/leads.js';
import { Relatorios as RelatoriosClasse } from '../relatorios/relatorios.js';
import { ehGestor, escopoDe, noEscopo, podeVer, type EscopoVisao } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import type { Contas } from '../auth/contas.js';
import type { Repositorio } from '../store/repositorio.js';
import { agendamentosEntre } from '../agenda/agenda-dia.js';
import { conversasDasClientes, mesclarAgenda, type AgendaExterna } from '../agenda/agenda-externa.js';
import { maisUsadosDaUnidade } from '../agenda/mais-usados.js'; // agendar-compacto
import { ErroLeads, PedidoImportacao, unidadesLeads, type Leads } from '../leads/leads.js';
import { ICONES } from '../rastreio/rastreio.js';
import { PERIODOS_RELATORIO, RELATORIOS, type NomeRelatorio, type Relatorios } from '../relatorios/relatorios.js';
import { nomeArquivo } from '../util/csv.js';
import { bahia, dataISO, DIA } from '../util/tempo.js';
import { unidadeDe, zUnidade } from '../unidades.js';

/**
 * Relatórios, Leads (importar/exportar/duplicatas) e Agenda. Registradas depois de criarServidor (src/index.ts),
 * então valem o login, o bloqueio da API e o tratamento de erros de lá.
 * Relatórios e Leads: só gestão (gerente vê as unidades dele). Agenda: todo mundo, nas unidades da pessoa.
 */
export interface OpcoesExtras {
  repo: Repositorio;
  empresaId: string;
  relatorios: Relatorios;
  leads: Leads;
  contas?: Contas;
  /** A agenda do sistema do salão (Trinks…), para mostrar também o que a recepção marca direto lá. */
  agendaExterna?: AgendaExterna;
  agora?: () => Date;
}

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Unidade = zUnidade();

export function registrarExtras(app: FastifyInstance, o: OpcoesExtras): void {
  const agora = o.agora ?? (() => new Date());
  const exigeGestao = (req: FastifyRequest, msg: string) => {
    if (!pode(req, req.url.startsWith('/api/relatorios') ? 'relatorios' : 'importar_leads')) throw proibido(msg);
  };
  const escopo = (req: FastifyRequest): EscopoVisao => ({ empresaId: o.empresaId, ...escopoDe(req.usuario) });
  const quem = (req: FastifyRequest) => ({ nome: req.usuario?.nome ?? 'teste', id: req.usuario?.id });
  const equipe = async (req: FastifyRequest) => (req.usuario && o.contas ? o.contas.listarUsuarios(req.usuario.empresaId) : undefined);
  const csv = (reply: FastifyReply, conteudo: string, arquivo: string) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeArquivo(arquivo)}"`)
      .header('cache-control', 'no-store')
      .send(conteudo);
  const erroLeads = (reply: FastifyReply, e: unknown) => {
    if (e instanceof ErroLeads) return reply.code(e.statusCode).send({ erro: e.message });
    throw e;
  };

  // ------------------------------------------------------------ relatórios
  const FiltroQ = z.object({
    periodo: z.enum(PERIODOS_RELATORIO).default('7d'),
    de: Data.optional(),
    ate: Data.optional(),
    unidade: Unidade.optional(),
    atendente: z.string().min(1).max(80).optional(),
  });
  const MSG_REL = 'Só a gerência, a direção e a administração veem os relatórios.';

  app.get('/api/relatorios', async (req) => {
    exigeGestao(req, MSG_REL);
    const f = FiltroQ.parse(req.query);
    const eq = await equipe(req);
    const esc = escopo(req);
    const r = await o.relatorios.gerar(f, { agora: agora(), escopo: esc, equipe: eq });
    const unidades = unidadesLeads().filter((u) => !esc.unidades || esc.unidades.includes(u)).map((u) => ({ id: u, nome: unidadeDe(u).nome }));
    const atendentes = (eq ?? [])
      .filter((p) => ['atendente', 'recepcionista'].includes(p.papel) && (!esc.unidades || p.unidades.some((x) => esc.unidades!.includes(x))))
      .map((p) => ({ id: p.id, nome: p.nome, ativo: p.ativo }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    return { ...r, opcoes: { unidades, atendentes } };
  });

  app.get('/api/relatorios/:nome/csv', async (req, reply) => {
    exigeGestao(req, MSG_REL);
    const nome = z.enum(RELATORIOS).parse((req.params as { nome: string }).nome) as NomeRelatorio;
    const r = await o.relatorios.csv(nome, FiltroQ.parse(req.query), { agora: agora(), escopo: escopo(req), equipe: await equipe(req) });
    return csv(reply, r.csv, r.arquivo);
  });

  // ------------------------------------------------------------ leads
  const MSG_LEADS = 'Só a gerência, a direção e a administração importam e exportam leads.';
  const FiltroLeadsQ = z.object({
    unidade: Unidade.optional(),
    etapa: z.enum(ETAPAS).optional(),
    tag: z.string().min(1).optional(),
    de: Data.optional(),
    ate: Data.optional(),
    /* clientes-tags: filtro por origem (ícone do rastreamento) */
    origem: z.enum(ICONES).optional(),
  });
  /* clientes-tags: exportar os selecionados (Clientes › seleção em massa) vai no corpo, pela quantidade de ids */
  const ExportarSelecionados = FiltroLeadsQ.extend({ ids: z.array(z.string().uuid()).min(1).max(5000) });
  const filtroLeads = (q: unknown, ids?: string[]) => {
    const f = FiltroLeadsQ.parse(q);
    const dia = (s: string) => bahia(Number(s.slice(0, 4)), Number(s.slice(5, 7)), Number(s.slice(8, 10)));
    return { unidade: f.unidade, etapa: f.etapa, tagId: f.tag, origem: f.origem, de: f.de ? dia(f.de) : undefined, ate: f.ate ? new Date(dia(f.ate).getTime() + DIA) : undefined, ...(ids ? { conversaIds: ids } : {}) };
  };

  app.get('/api/leads', async (req) => {
    exigeGestao(req, MSG_LEADS);
    const { linhas } = await o.leads.linhas(escopo(req), filtroLeads(req.query));
    return { total: linhas.length, amostra: linhas.slice(0, 8) };
  });

  app.get('/api/leads/exportar', async (req, reply) => {
    exigeGestao(req, MSG_LEADS);
    const r = await o.leads.exportarCsv(escopo(req), filtroLeads(req.query));
    return csv(reply, r.csv, `leads-imperio-${dataISO(agora())}.csv`);
  });

  app.post('/api/leads/exportar', async (req, reply) => {
    exigeGestao(req, MSG_LEADS);
    const { ids, ...resto } = ExportarSelecionados.parse(req.body);
    const r = await o.leads.exportarCsv(escopo(req), filtroLeads(resto, ids));
    return csv(reply, r.csv, `clientes-selecionados-${dataISO(agora())}.csv`);
  });

  /* clientes-tags: empresas ligadas aos contatos (aba Clientes › Empresas). Todo mundo, só o que a pessoa vê. */
  app.get('/api/clientes/empresas', async (req) => ({ empresas: await o.leads.empresas(escopo(req)) }));

  app.post('/api/leads/importar', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    exigeGestao(req, MSG_LEADS);
    const p = PedidoImportacao.parse(req.body);
    const esc = escopo(req);
    if (esc.unidades && !esc.unidades.includes(p.unidade)) throw proibido('Você só importa leads para as suas unidades.');
    try {
      return await o.leads.importar(p, quem(req).nome);
    } catch (e) {
      return erroLeads(reply, e);
    }
  });

  app.get('/api/leads/conferir', async (req) => {
    const q = z.object({ telefone: z.string().max(40).optional(), email: z.string().max(200).optional() }).parse(req.query);
    const d = await o.leads.conferirDuplicata(q.telefone, q.email);
    // seguranca-abertura: pelo e-mail, o telefone de um contato que a pessoa não vê (outra unidade) não sai daqui.
    if (d && d.motivo === 'email' && req.usuario) {
      const esc = escopo(req);
      const ve = (await o.repo.listarConversas({ empresaId: o.empresaId, telefone: d.telefone, incluirArquivadas: true })).some((c) => noEscopo(esc, c));
      if (!ve) return { duplicata: { telefone: null, motivo: d.motivo } };
    }
    return { duplicata: d };
  });

  app.get('/api/leads/duplicatas', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração cuidam das duplicatas.');
    const grupos = await o.leads.duplicatas(escopo(req));
    return { grupos, naoDuplicatas: (await o.leads.paresNaoDuplicata()).length };
  });

  const Mesclar = z.object({ principal: z.string().min(8).max(20), outros: z.array(z.string().min(8).max(20)).min(1).max(20) });
  app.post('/api/leads/mesclar', async (req, reply) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração mesclam contatos.');
    const b = Mesclar.parse(req.body);
    try {
      return await o.leads.mesclar(b.principal, b.outros, escopo(req), quem(req));
    } catch (e) {
      return erroLeads(reply, e);
    }
  });

  const NaoDuplicata = z.object({ telefones: z.array(z.string().min(8).max(20)).min(2).max(20) });
  app.post('/api/leads/nao-duplicata', async (req) => {
    exigeGestao(req, 'Só a gerência, a direção e a administração cuidam das duplicatas.');
    await o.leads.naoEDuplicata(NaoDuplicata.parse(req.body).telefones, quem(req).nome);
    return { ok: true };
  });

  // ------------------------------------------------------------ agenda
  const AgendaQ = z.object({
    de: Data.optional(),
    dias: z.coerce.number().int().min(1).max(42).default(7),
    unidade: Unidade.optional(),
    profissional: z.string().max(80).optional(),
  });
  /* agendar-compacto: serviços e profissionais mais marcados na unidade (últimos 120 dias), para o Agendar da
     conversa mostrar estes primeiro. Quem não vê a unidade recebe listas vazias (a tela cai na ordem alfabética). */
  app.get('/api/agenda/mais-usados', async (req) => {
    const { unidade } = z.object({ unidade: Unidade }).parse(req.query);
    const unidades = req.usuario ? escopoDe(req.usuario).unidades : undefined;
    if (unidades && !unidades.includes(unidade)) return { servicos: [], profissionais: [] };
    return maisUsadosDaUnidade(o.repo, o.empresaId, unidade, new Date(agora().getTime() - 120 * DIA));
  });

  app.get('/api/agenda/agendamentos', async (req) => {
    const q = AgendaQ.parse(req.query);
    const u = req.usuario;
    const de = q.de ?? dataISO(agora());
    const inicio = bahia(Number(de.slice(0, 4)), Number(de.slice(5, 7)), Number(de.slice(8, 10)));
    const fim = new Date(inicio.getTime() + q.dias * DIA);
    // A agenda da unidade é de todas (a recepção vê o dia inteiro); abrir a conversa segue quem vê o quê.
    const esc: EscopoVisao = { empresaId: o.empresaId, ...(u && escopoDe(u).unidades ? { unidades: escopoDe(u).unidades } : {}) };
    const permitidas = unidadesLeads().filter((x) => !esc.unidades || esc.unidades.includes(x)).map((x) => ({ id: x, nome: unidadeDe(x).nome }));
    if (q.unidade) {
      if (esc.unidades && !esc.unidades.includes(q.unidade)) throw proibido('Você não vê a agenda dessa unidade.');
      esc.unidades = [q.unidade];
    }
    const unidadesVistas = (esc.unidades ?? permitidas.map((x) => x.id)) as UnidadeId[];
    // A Sintonia (banco) e o sistema do salão ao mesmo tempo; o sistema nunca derruba a agenda.
    const [doBanco, externo] = await Promise.all([
      agendamentosEntre(o.repo, inicio, fim, esc),
      o.agendaExterna
        ? o.agendaExterna.dasUnidades(unidadesVistas, de, dataISO(new Date(fim.getTime() - 1))).catch(() => ({ itens: [], aviso: undefined }))
        : Promise.resolve({ itens: [], aviso: undefined }),
    ]);
    const externos = externo.itens.filter((i) => i.inicio >= inicio && i.inicio < fim);
    const conversaDe = externos.length
      ? await conversasDasClientes(o.repo as Parameters<typeof conversasDasClientes>[0], o.empresaId, externos).catch(() => () => undefined)
      : () => undefined;
    // Conversas que os horários (da Sintonia ou do sistema, casados pelo celular) podem abrir.
    const conversas = new Map<string, Conversa>();
    const ids = new Set([...doBanco.map((i) => i.conversaId), ...externos.map((e) => conversaDe(e)?.id).filter((x): x is string => Boolean(x))]);
    for (const id of ids) {
      const c = await o.repo.buscarConversa(id).catch(() => undefined);
      if (c) conversas.set(id, c);
    }
    const todos = mesclarAgenda(doBanco, externos, conversaDe, (id) => {
      const c = conversas.get(id);
      return Boolean(c && (!u || podeVer(u, c)));
    });
    const profissionais = [...new Set(todos.map((i) => i.profissional).filter((p): p is string => Boolean(p)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const itens = todos.filter((i) => !q.profissional || (q.profissional === '-' ? !i.profissional : i.profissional === q.profissional));
    return {
      fontes: [...new Set(['sintonia', ...todos.map((i) => i.fonte)])],
      ...(externo.aviso ? { aviso: externo.aviso } : {}),
      de,
      dias: q.dias,
      itens,
      profissionais,
      unidades: permitidas,
    };
  });
}

// ------------------------------------------------------------ montagem (index.ts e testes)

export interface DependenciasExtras {
  repo: Repositorio;
  /** Com banco: tudo no Postgres. Sem: repo e contatos precisam ser os da memória. */
  pool?: pg.Pool;
  contatos: ArmazemContatos;
  armazemTags?: ArmazemTags;
  tags?: Tags;
  funis?: { garantirNoSistema(c: Conversa): Promise<void> };
  empresaId: string;
  canalDa: (unidade: UnidadeId) => string | undefined;
  comConversa?: <T>(id: string, fn: (c: Conversa) => Promise<T>) => Promise<T | undefined>;
  /** Origem de cada conversa (rastreamento): filtro e coluna do exportar. */
  origens?: (ids: string[]) => Promise<Record<string, { icone: string }>>;
  /** produtos-lead: produtos vinculados de cada conversa (coluna "Produtos" do exportar). */
  produtos?: (ids: string[]) => Promise<Map<string, string>>;
  agora?: () => Date;
}

export function montarExtras(d: DependenciasExtras): { relatorios: RelatoriosClasse; leads: LeadsClasse; armazem: ArmazemLeads } {
  const armazem: ArmazemLeads = d.pool
    ? new ArmazemLeadsPostgres(d.pool)
    : new ArmazemLeadsMemoria(d.repo as RepositorioMemoria, d.contatos as ContatosMemoria, d.armazemTags);
  const agora = d.agora ?? (() => new Date());
  const leads = new LeadsClasse({ repo: d.repo, armazem, contatos: d.contatos, empresaId: d.empresaId, tags: d.tags, funis: d.funis, canalDa: d.canalDa, comConversa: d.comConversa, origens: d.origens, produtos: d.produtos, agora });
  const relatorios = new RelatoriosClasse({ repo: d.repo, empresaId: d.empresaId, tags: d.tags, contatos: d.contatos, leads: armazem });
  return { relatorios, leads, armazem };
}
