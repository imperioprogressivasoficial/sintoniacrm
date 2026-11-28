import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ehGestor, veTudo } from '../auth/acesso.js';
import { pode } from '../auth/permissoes.js';
import type { Empresa } from '../empresa/empresa.js';
import { unidadesDa } from '../unidades.js';
import type { BaseConhecimento } from './base.js';
import { AlteracaoJeito, aplicarAlteracao, emojisDe, ESFORCOS_IA, MODELOS_IA, temTextoDaEmpresa, type JeitoDeAtender } from './jeito-atender.js';

/**
 * serena-config: rotas da tela Inteligência › Jeito de atender.
 * - GET  /api/ia/jeito            o jeito, o padrão (para "Voltar ao padrão"), nome, tabelas e horários das unidades.
 * - PUT  /api/ia/jeito            grava (só o que vier) e guarda no histórico quem mudou e o quê.
 * - GET  /api/ia/jeito/historico  quem mudou, quando e quais campos.
 * Nome da atendente e tabelas são gravados na configuração da IA (fonte única); horários, na unidade (Empresa › Unidades).
 */
export interface OpcoesJeito {
  jeito: JeitoDeAtender;
  empresa?: Empresa;
  base?: BaseConhecimento;
}

/** Seções antigas da base da Império que passaram para o Jeito de atender. */
export const SECOES_NO_JEITO: Record<string, string> = {
  'jeito-de-falar': 'Jeito de falar',
  'roteiro-de-atendimento-ate-agendar': 'Roteiro de atendimento até agendar',
  'mensagens-prontas': 'Mensagens prontas',
};

const proibido = (msg: string) => Object.assign(new Error(msg), { statusCode: 403 });

const Corpo = z.object({
  jeito: AlteracaoJeito.optional(),
  /** Nome da atendente (vai para a assinatura da IA). */
  nome: z.string().trim().min(1, 'Escreva o nome da atendente.').max(40, 'No máximo 40 letras.').optional(),
  tabelas: z.object({ clienteNova: z.string().trim().max(120).optional(), jaCliente: z.string().trim().max(120).optional() }).optional(),
});

export function registrarJeito(app: FastifyInstance, o: OpcoesJeito): void {
  const quem = (req: FastifyRequest) => req.usuario?.nome ?? 'teste';
  /** Edita: quem tem a permissão de IA (Agentes de IA). A gestão tem por padrão. */
  const podeEditar = (req: FastifyRequest) => !req.usuario || pode(req, 'agentes_ia');
  const exigeVer = (req: FastifyRequest) => {
    if (req.usuario && !ehGestor(req.usuario) && !podeEditar(req)) throw proibido('Só a gestão e quem cuida da IA veem o jeito de atender.');
  };
  const exigeEditar = (req: FastifyRequest) => {
    if (!podeEditar(req)) throw proibido('Só a gestão e quem cuida da IA mudam o jeito de atender.');
  };

  const visao = async (req: FastifyRequest) => {
    const [jeito, cfg, mudou, secoes] = await Promise.all([
      o.jeito.atual(),
      o.empresa?.configIa(),
      o.jeito.quem(),
      o.base ? o.base.secoes().catch(() => []) : Promise.resolve([]),
    ]);
    const avisos: string[] = [];
    if (temTextoDaEmpresa({ jeito })) {
      for (const s of secoes) {
        if (SECOES_NO_JEITO[s.chave]) avisos.push(`A base de conhecimento ainda tem a seção "${s.titulo}". O que vale agora é esta tela: apague a seção na base (Treinamento) para não ter duas versões.`);
      }
    }
    return {
      jeito,
      padrao: o.jeito.padrao(),
      nome: cfg?.assinatura.texto ?? 'Serena',
      tabelas: cfg?.tabelaAgendamento ?? { clienteNova: '', jaCliente: '' },
      unidades: unidadesDa(o.jeito.empresaId).map((u) => ({ id: u.id, nome: u.nome, horariosPadrao: u.horariosPadrao, ultimoHorarioEspecial: u.ultimoHorarioEspecial })),
      emojisPermitidos: emojisDe(jeito.tom.emojis),
      opcoes: { modelos: MODELOS_IA, esforcos: ESFORCOS_IA },
      podeEditar: podeEditar(req),
      podeEditarUnidades: !req.usuario || veTudo(req.usuario),
      atualizadaEm: mudou.em,
      atualizadaPor: mudou.por,
      avisos,
    };
  };

  app.get('/api/ia/jeito', async (req) => {
    exigeVer(req);
    return visao(req);
  });

  app.put('/api/ia/jeito', async (req, reply) => {
    exigeEditar(req);
    const r = Corpo.safeParse(req.body ?? {});
    if (!r.success) return reply.code(400).send({ erro: r.error.issues[0]?.message ?? 'Dados inválidos.', campo: r.error.issues[0]?.path.join('.') });
    const b = r.data;
    // Confere o jeito antes de gravar qualquer coisa (nada fica pela metade).
    try {
      aplicarAlteracao(await o.jeito.atual(), b.jeito ?? {});
    } catch (e) {
      if (e instanceof z.ZodError) return reply.code(400).send({ erro: e.issues[0]?.message ?? 'Dados inválidos.', campo: e.issues[0]?.path.join('.') });
      throw e;
    }
    const extra: string[] = [];
    if (o.empresa && (b.nome !== undefined || b.tabelas)) {
      const cfg = await o.empresa.configIa();
      if (b.nome !== undefined && b.nome !== cfg.assinatura.texto) extra.push('identidade.nome');
      if (b.tabelas && ((b.tabelas.clienteNova ?? cfg.tabelaAgendamento.clienteNova) !== cfg.tabelaAgendamento.clienteNova || (b.tabelas.jaCliente ?? cfg.tabelaAgendamento.jaCliente) !== cfg.tabelaAgendamento.jaCliente)) extra.push('tabelas');
      if (extra.length) await o.empresa.alterarConfigIa({ ...(b.nome !== undefined ? { assinatura: { texto: b.nome } } : {}), ...(b.tabelas ? { tabelaAgendamento: b.tabelas } : {}) }, quem(req));
    }
    const novaCfg = o.empresa ? await o.empresa.configIa() : undefined;
    await o.jeito.salvar(b.jeito ?? {}, quem(req), { campos: extra, config: novaCfg ? { nome: novaCfg.assinatura.texto, tabelas: novaCfg.tabelaAgendamento } : {} });
    return visao(req);
  });

  app.get('/api/ia/jeito/historico', async (req) => {
    exigeVer(req);
    const l = await o.jeito.historico(30);
    return { versoes: l.map((v) => ({ em: v.em, por: v.por === 'semente' ? 'Texto inicial' : v.por, campos: v.campos })) };
  });
}
