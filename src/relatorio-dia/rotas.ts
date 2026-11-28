import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, escopoDe, type EscopoVisao } from '../auth/acesso.js';
import type { Contas } from '../auth/contas.js';
import { pode } from '../auth/permissoes.js';
import { unidadesLeads } from '../leads/leads.js';
import { unidadeDe, zUnidade } from '../unidades.js';
import { gerarCsv, nomeArquivo, type Celula } from '../util/csv.js';
import { dataISO } from '../util/tempo.js';
import { NOME_FAIXA } from './calculo.js';
import { chaveDestino, ConfigEnvio, Destinatario, NOME_RELATORIO, numeroBonito, numeroDestino, RELATORIOS, type ArmazemEnvioRelatorio } from './envio.js';
import type { RelatorioDia } from './servico.js';

/**
 * relatorio-dia: rotas da gestão.
 *   GET  /api/relatorio-dia                 o dia (visão a), o grupo de leads (visão b) e o geral do período
 *   GET  /api/relatorio-dia/csv?tabela=…     dia | faixas | coorte | origens
 *   GET  /api/relatorio-dia/envio           configuração do relatório automático + grupos, equipe com telefone, registros
 *   PUT  /api/relatorio-dia/envio           salva (só gestão)
 *   POST /api/relatorio-dia/envio/previa    o texto exato que sairia agora
 *   POST /api/relatorio-dia/envio/teste     manda para o WhatsApp de quem pediu (telefone da Conta)
 * Ver: permissão "relatorios" (como as Análises). Exportar: "exportar". Mexer no envio: gestão.
 */
export interface GrupoOpcao {
  id: string;
  nome: string;
  unidade: string;
}

export interface OpcoesRotasRelatorioDia {
  servico: RelatorioDia;
  armazem: ArmazemEnvioRelatorio;
  contas?: Contas;
  /** Telefone da Conta › Perfil da pessoa ('' = sem). */
  telefoneDe?: (usuarioId: string) => Promise<string>;
  /** Grupos do WhatsApp em que o número da loja está (src/grupos). */
  grupos?: (empresaId: string) => Promise<GrupoOpcao[]>;
  /** Unidades com número de WhatsApp conectado (por onde o relatório pode sair). */
  canais?: () => string[];
  empresaId: string;
  agora: () => Date;
}

const erro = (status: number, msg: string) => Object.assign(new Error(msg), { statusCode: status });
const Dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const FiltroDia = z.object({
  dia: Dia.optional(),
  dias: z.coerce.number().int().min(3).max(60).default(14),
  unidade: zUnidade().optional(),
  atendente: z.string().min(1).max(80).optional(),
  quem: z.enum(['ia', 'equipe']).optional(),
  origem: z.string().min(1).max(80).optional(),
});
export type FiltroDia = z.infer<typeof FiltroDia>;
const TABELAS = ['dia', 'faixas', 'coorte', 'origens'] as const;

const CorpoEnvio = z.object({
  ligado: z.boolean(),
  unidadeEnvio: z.string().max(40).nullable().optional(),
  unidade: z.string().max(40).nullable().optional(),
  horarios: ConfigEnvio.shape.horarios.optional(),
  destinatarios: z.array(Destinatario).max(30),
});

export function registrarRelatorioDia(app: FastifyInstance, o: OpcoesRotasRelatorioDia): void {
  const empresaDe = (req: FastifyRequest) => req.usuario?.empresaId ?? o.empresaId;
  const exige = (req: FastifyRequest) => {
    if (req.usuario && !pode(req, 'relatorios')) throw erro(403, 'Os relatórios ficam com a gerência, a direção e a administração.');
  };
  const exigeGestao = (req: FastifyRequest) => {
    exige(req);
    if (req.usuario && !ehGestor(req.usuario)) throw erro(403, 'Só a gerência, a direção e a administração mexem no relatório automático.');
  };
  const escopoDaReq = (req: FastifyRequest, unidade?: string): EscopoVisao => {
    const e: EscopoVisao = { ...escopoDe(req.usuario), empresaId: empresaDe(req) };
    if (unidade) {
      if (e.unidades && !e.unidades.includes(unidade)) throw erro(403, 'Você não vê essa unidade.');
      e.unidades = [unidade];
    }
    return e;
  };
  const equipe = async (req: FastifyRequest) => (o.contas ? await o.contas.listarUsuarios(empresaDe(req)).catch(() => []) : []);

  async function gerar(req: FastifyRequest, f: FiltroDia) {
    const hoje = dataISO(o.agora());
    return o.servico.tela(escopoDaReq(req, f.unidade), { dia: f.dia ?? hoje, dias: f.dias, unidade: f.unidade, atendente: f.atendente, quem: f.quem, origem: f.origem });
  }

  app.get('/api/relatorio-dia', async (req) => {
    exige(req);
    const f = FiltroDia.parse(req.query);
    const esc = escopoDe(req.usuario);
    const [r, pessoas] = await Promise.all([gerar(req, f), equipe(req)]);
    const unidades = unidadesLeads().filter((u) => !esc.unidades || esc.unidades.includes(u)).map((u) => ({ id: u, nome: unidadeDe(u).nome }));
    const atendentes = pessoas
      .filter((p) => ['atendente', 'recepcionista', 'gerente'].includes(p.papel) && (!esc.unidades || p.unidades.some((x) => esc.unidades!.includes(x))))
      .map((p) => ({ id: p.id, nome: p.nome, ativo: p.ativo }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    // Nomes da equipe no ranking (o evento guarda o nome da hora em que marcou).
    const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
    const renomear = <T extends { id: string | null; nome: string }>(l: T[]) => l.map((x) => (x.id && nomes.has(x.id) ? { ...x, nome: nomes.get(x.id)! } : x));
    return {
      ...r,
      relatorio: { ...r.relatorio, ranking: renomear(r.relatorio.ranking) },
      geral: { ...r.geral, ranking: renomear(r.geral.ranking) },
      filtros: { unidade: f.unidade ?? null, atendente: f.atendente ?? null, quem: f.quem ?? null, origem: f.origem ?? null },
      opcoes: { unidades, atendentes, origens: r.origens },
      podeConfigurar: !req.usuario || ehGestor(req.usuario),
    };
  });

  app.get('/api/relatorio-dia/csv', async (req, reply) => {
    exige(req);
    if (req.usuario && !pode(req, 'exportar')) throw erro(403, 'Você não tem permissão para exportar. Fale com a gestão.');
    const q = (req.query ?? {}) as Record<string, unknown>;
    const tabela = z.enum(TABELAS).parse(q.tabela ?? 'dia');
    const f = FiltroDia.parse(q);
    const r = await gerar(req, f);
    const { cab, linhas } = tabelaCsv(tabela, r);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${nomeArquivo(`dia-a-dia-${tabela}_${r.dia}${f.unidade ? '_' + f.unidade : ''}.csv`)}"`)
      .header('cache-control', 'no-store')
      .send(gerarCsv(cab, linhas));
  });

  // ---------------------------------------------------------------- envio automático

  app.get('/api/relatorio-dia/envio', async (req) => {
    exigeGestao(req);
    const empresaId = empresaDe(req);
    const [reg, registros, pessoas, grupos] = await Promise.all([
      o.armazem.lerConfig(empresaId),
      o.armazem.recentes(empresaId, 40),
      equipe(req),
      o.grupos ? o.grupos(empresaId).catch(() => []) : Promise.resolve([]),
    ]);
    const comTelefone = await Promise.all(
      pessoas.filter((p) => p.ativo).map(async (p) => {
        const t = o.telefoneDe ? await o.telefoneDe(p.id).catch(() => '') : '';
        let numero: string | null = null;
        try {
          numero = t ? numeroDestino(t) : null;
        } catch {
          numero = null;
        }
        return { id: p.id, nome: p.nome, papel: p.papel, numero, numeroBonito: numero ? numeroBonito(numero) : null };
      }),
    );
    const canais = (o.canais?.() ?? []).map((u) => ({ id: u, nome: unidadeDe(u).nome }));
    return {
      config: { ...reg.cfg, destinatarios: reg.cfg.destinatarios.map((d) => ({ ...d, bonito: d.tipo === 'numero' ? numeroBonito(d.destino) : null })) },
      atualizadoEm: reg.atualizadoEm,
      atualizadoPor: reg.atualizadoPor,
      relatorios: RELATORIOS.map((k) => ({ id: k, nome: NOME_RELATORIO[k] })),
      equipe: comTelefone.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
      grupos,
      canais,
      unidades: unidadesLeads().map((u) => ({ id: u, nome: unidadeDe(u).nome })),
      registros: registros.map((r) => ({ ...r, relatorioNome: r.relatorio === 'teste' ? 'Teste' : (NOME_RELATORIO as Record<string, string>)[r.relatorio] ?? r.relatorio })),
    };
  });

  app.put('/api/relatorio-dia/envio', async (req) => {
    exigeGestao(req);
    const empresaId = empresaDe(req);
    const b = CorpoEnvio.parse(req.body);
    const atual = (await o.armazem.lerConfig(empresaId)).cfg;
    const grupos = o.grupos ? new Map((await o.grupos(empresaId).catch(() => [])).map((g) => [g.id, g])) : null;
    const vistos = new Set<string>();
    const destinatarios = b.destinatarios.map((d) => {
      const x = { ...d };
      if (x.tipo === 'numero') x.destino = numeroDestino(x.destino);
      else if (grupos && !grupos.has(x.destino)) throw erro(400, `O grupo "${x.nome || x.destino}" não está mais na lista de grupos do WhatsApp.`);
      else if (grupos) x.nome = x.nome || grupos.get(x.destino)!.nome;
      const k = chaveDestino(x);
      if (vistos.has(k)) throw erro(400, `"${x.nome || x.destino}" está duas vezes na lista.`);
      vistos.add(k);
      x.relatorios = [...new Set(x.relatorios)];
      return x;
    });
    const valida = (u: string | null | undefined) => (u ? zUnidade().parse(u) : null);
    const cfg = ConfigEnvio.parse({
      ligado: b.ligado,
      unidadeEnvio: b.unidadeEnvio === undefined ? atual.unidadeEnvio : valida(b.unidadeEnvio),
      unidade: b.unidade === undefined ? atual.unidade : valida(b.unidade),
      horarios: b.horarios ?? atual.horarios,
      destinatarios,
    });
    await o.armazem.salvarConfig(empresaId, cfg, req.usuario?.nome ?? 'sistema');
    return { ok: true, config: cfg };
  });

  const CorpoPrevia = z.object({ relatorio: z.enum(RELATORIOS), unidade: z.string().max(40).nullable().optional() });

  app.post('/api/relatorio-dia/envio/previa', async (req) => {
    exigeGestao(req);
    const b = CorpoPrevia.parse(req.body ?? {});
    const cfg = (await o.armazem.lerConfig(empresaDe(req))).cfg;
    if (b.unidade !== undefined) cfg.unidade = b.unidade ? zUnidade().parse(b.unidade) : null;
    return { relatorio: b.relatorio, texto: await o.servico.texto(b.relatorio, cfg, o.agora()) };
  });

  app.post('/api/relatorio-dia/envio/teste', async (req) => {
    exigeGestao(req);
    const b = CorpoPrevia.parse(req.body ?? {});
    const u = req.usuario;
    const t = u && o.telefoneDe ? await o.telefoneDe(u.id).catch(() => '') : '';
    if (!t) throw erro(400, 'Cadastre seu WhatsApp em Minha conta › Perfil para receber o teste.');
    const numero = numeroDestino(t);
    const cfg = (await o.armazem.lerConfig(empresaDe(req))).cfg;
    if (b.unidade !== undefined) cfg.unidade = b.unidade ? zUnidade().parse(b.unidade) : null;
    const r = await o.servico.enviarTeste(b.relatorio, numero, u?.nome ?? 'teste', cfg);
    if (!r.enviado) throw erro(502, `Não deu para enviar o teste: ${r.erro}`);
    return { ok: true, para: numeroBonito(numero) };
  });
}

const br = (d: string) => d.split('-').reverse().join('/');
const horas = (ms: number | null | undefined) => (ms == null ? '' : Math.round((ms / 3_600_000) * 10) / 10);

/** Cabeçalho e linhas de cada tabela exportável (o mesmo conteúdo da tela). */
export function tabelaCsv(tabela: (typeof TABELAS)[number], r: Awaited<ReturnType<RelatorioDia['tela']>>): { cab: string[]; linhas: Celula[][] } {
  const d = r.relatorio;
  if (tabela === 'dia') {
    return {
      cab: ['Indicador', 'Valor'],
      linhas: [
        ['Dia', br(d.dia)],
        ['Leads novos que chegaram', d.chegaram.novos],
        ['Leads novos que agendaram no mesmo dia', d.novosQueAgendaramNoDia],
        ['Conversão no mesmo dia (%)', d.conversaoNoDiaPct],
        ['Retorno (já tinham agendado)', d.chegaram.retorno],
        ['Contatos importados ou antigos (não contam)', d.chegaram.importados],
        ['Agendamentos feitos no dia', d.agendamentos.total],
        ['Pela IA', d.agendamentos.porIa],
        ['Pela equipe', d.agendamentos.porEquipe],
        ['Compareceram', d.agendamentos.compareceram],
        ['Faltaram', d.agendamentos.faltaram],
        ...d.grupos.map((g, i): Celula[] => [`Leads de ${i === 0 ? 'hoje' : i === 1 ? 'ontem' : 'anteontem'} (${br(g.dia)}): chegaram / agendaram no mesmo dia / agendaram até ${br(d.dia)}`, `${g.chegaram} / ${g.agendaramNoMesmoDia} / ${g.agendaramAte}`]),
      ],
    };
  }
  if (tabela === 'faixas') return { cab: ['Quando o lead chegou', 'Agendamentos', '%'], linhas: d.agendamentos.faixas.map((f) => [NOME_FAIXA[f.faixa], f.total, f.pct]) };
  if (tabela === 'coorte') {
    return {
      cab: ['Dia de chegada', 'Leads novos', ...Array.from({ length: r.coorte.dias + 1 }, (_, k) => (k === r.coorte.dias ? `Dia ${k}+` : `Dia ${k}`)), 'Agendaram', 'Conversão (%)'],
      linhas: r.coorte.linhas.map((l) => [br(l.dia), l.chegaram, ...l.celulas.map((c) => (c ? c.agendaram : '')), l.agendaram, l.conversaoPct]),
    };
  }
  return {
    cab: ['Origem', 'Leads novos', 'Agendaram', 'Conversão (%)', 'Tempo até agendar (mediana, h)'],
    linhas: r.geral.origens.map((x) => [x.origem, x.chegaram, x.agendaram, x.conversaoPct, horas(x.tempoMedianaMs)]),
  };
}
