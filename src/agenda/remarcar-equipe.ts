import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Conversa } from '../domain.js';
import { agendamentosDa, executarFerramenta, novaSessao, servicoEscolhido, type AcaoAgente, type Agenda, type ContextoFerramentas } from '../ai/ferramentas.js';
import { exigir } from '../auth/permissoes.js';
import type { Auditoria } from '../seguranca/auditoria.js';
import type { Sintonia } from '../app/sintonia.js';
import { unidadeDe } from '../unidades.js';
import { dataISO, horaHHmm } from '../util/tempo.js';
import { horaDoSistema } from './agenda-externa.js';
import { agendaDaUnidade, textoConfirmacao } from './agendar.js';

/**
 * reagendar (dono 28/11): no topo da conversa, o botão de agenda oferece "Reagendar" quando a cliente já tem horário.
 * Duas rotas da equipe, sempre na unidade da conversa:
 * - GET  /api/conversas/:id/horarios-marcados: os horários futuros dela (dia, hora, serviço; sem profissional);
 * - POST /api/conversas/:id/remarcar: troca um deles por outro. É a mesma ferramenta remarcar_agendamento da IA
 *   (marca o novo ANTES de cancelar o antigo: a cliente nunca fica sem horário).
 */

export interface OpcoesRemarcarEquipe {
  agenda: () => Agenda | undefined;
  sintonia: Pick<Sintonia, 'equipeMudouAgenda' | 'equipeEnviou' | 'conferirVez'>;
  conversaVisivel: (req: FastifyRequest) => Promise<Conversa>;
  nomeDe: (req: FastifyRequest, doCorpo?: string) => string;
  auditoria?: Auditoria;
  empresaId: string;
  agora: () => Date;
  log?: (msg: string, extra?: unknown) => void;
}

const Remarcar = z.object({
  agendamentoId: z.number().int().positive(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{1,2}:\d{2}$/),
  /** Envia a confirmação do horário novo para a cliente pelo WhatsApp. */
  enviarConfirmacao: z.boolean().default(true),
  /** Só sem login (teste local). */
  atendente: z.string().trim().min(1).max(120).optional(),
});

const erro = (msg: string, statusCode: number) => Object.assign(new Error(msg), { statusCode });

export function registrarRemarcarEquipe(app: FastifyInstance, o: OpcoesRemarcarEquipe): void {
  const exigeAgenda = (): Agenda => {
    const a = o.agenda();
    if (!a) throw erro('Agenda não configurada (Conexões › Agenda)', 501);
    return a;
  };
  const ctxDe = (agenda: Agenda, c: Conversa, acoes: AcaoAgente[] = [], origem?: string): ContextoFerramentas => ({
    agenda,
    conversa: c,
    agora: o.agora(),
    acoes,
    podeEscrever: true,
    sessao: novaSessao(),
    ...(origem ? { origemAgendamento: origem } : {}),
  });

  app.get('/api/conversas/:id/horarios-marcados', async (req) => {
    const c = await o.conversaVisivel(req);
    const agenda = o.agenda();
    const unidade = c.unidade;
    const base = { unidade, unidadeNome: unidadeDe(unidade).nome, horarios: [] as unknown[] };
    if (!agenda) return base;
    try {
      agendaDaUnidade(agenda, unidade);
    } catch {
      return base; // unidade sem agenda: o botão abre o Agendar de sempre
    }
    const ctx = ctxDe(agenda, c);
    const { lista } = await agendamentosDa(ctx, unidade);
    const agora = o.agora().getTime();
    let padrao: number | null | undefined;
    const horarios = [];
    for (const a of lista) {
      const d = horaDoSistema(String(a.dataHoraInicio));
      if (!d || d.getTime() <= agora) continue;
      // O serviço para buscar os horários livres: o mesmo do horário (se ainda existe), senão o padrão da unidade.
      let servicoId: number | null = a.servico?.id ?? null;
      try {
        servicoId = (await servicoEscolhido(ctx, unidade, servicoId)).id;
      } catch {
        if (padrao === undefined) padrao = await servicoEscolhido(ctx, unidade, null).then((s) => s.id).catch(() => null);
        servicoId = padrao;
      }
      horarios.push({ id: a.id, data: dataISO(d), hora: horaHHmm(d), servico: a.servico?.nome ?? null, servicoId, duracaoMin: a.duracaoEmMinutos ?? null });
    }
    horarios.sort((x, y) => `${x.data} ${x.hora}`.localeCompare(`${y.data} ${y.hora}`));
    return { ...base, horarios };
  });

  app.post('/api/conversas/:id/remarcar', async (req) => {
    const b = Remarcar.parse(req.body);
    const c = await o.conversaVisivel(req);
    // A confirmação vai para a cliente pelo WhatsApp: precisa da permissão "Responder" (igual ao Agendar).
    if (b.enviarConfirmacao) exigir(req, 'responder', 'Você não tem permissão para responder clientes. Remarque sem enviar a confirmação ou fale com a gestão.');
    const atendente = o.nomeDe(req, b.atendente);
    if (req.usuario) await o.sintonia.conferirVez(c.id, req.usuario);
    const agenda = exigeAgenda();
    const acoes: AcaoAgente[] = [];
    const ctx = ctxDe(agenda, c, acoes, `${atendente} pelo CRM`);
    // Mantém a mesma profissional quando ela está livre no horário novo (senão, quem estiver livre). Nunca aparece na tela.
    let profissionalId: number | null = null;
    try {
      profissionalId = (await agendamentosDa(ctx, c.unidade)).lista.find((a) => a.id === b.agendamentoId)?.profissional?.id ?? null;
    } catch {
      /* a ferramenta confere de novo e explica */
    }
    const r = await executarFerramenta(
      'remarcar_agendamento',
      { unidade: c.unidade, agendamento_id: b.agendamentoId, data: b.data, hora: b.hora, servico_id: null, profissional_id: profissionalId, cliente_confirmou: true },
      { ...ctx, sessao: novaSessao() },
    );
    if (r.erro) {
      const msg = r.conteudo.startsWith('A agenda do salão não respondeu')
        ? 'A agenda não respondeu agora. Nada mudou; tente de novo em instantes.'
        : r.conteudo
            .replace(/ ?Use ver_agendamentos_da_cliente[^.]*\.?/, '')
            .replace(/ ?Use passar_para_humano[^.]*\.?/, '')
            .replace(/ ?Use consultar_horarios[^.]*\.?/, '')
            .replace(/ ?Peça desculpas e ofereça outro\.?/, '');
      throw Object.assign(erro(msg.trim() || 'Não deu para remarcar.', 409), { codigo: 'nao_remarcou' });
    }
    const mudou = acoes.filter((a): a is Extract<AcaoAgente, { tipo: 'remarcou' }> => a.tipo === 'remarcou');
    const m = mudou[0];
    if (!m) throw erro('Não deu para remarcar.', 409);
    await o.sintonia.equipeMudouAgenda(c.id, mudou, atendente, req.usuario);
    let aviso: string | undefined;
    let confirmacao: string | undefined;
    if (b.enviarConfirmacao) {
      // Sem o nome da profissional (a cliente escolhe o horário, não a pessoa).
      confirmacao = textoConfirmacao(c.nome ?? undefined, { agendamento: { ...m.agendamento, profissional: undefined }, valor: 0, clienteTrinksId: m.clienteTrinksId });
      try {
        await o.sintonia.equipeEnviou(c.id, confirmacao, atendente, req.usuario);
      } catch (e) {
        aviso = `A confirmação para a cliente não saiu (${(e as Error).message}). Avise por outro jeito.`;
      }
    }
    if (!m.cancelouAntigo) aviso = [aviso, 'O horário novo está marcado, mas o antigo não foi cancelado na agenda: cancele à mão.'].filter(Boolean).join(' ');
    void o.auditoria
      ?.registrar({
        empresaId: o.empresaId,
        acao: 'remarcou horário',
        autorId: req.usuario?.id ?? null,
        autorNome: atendente,
        papel: req.usuario?.papel ?? null,
        alvo: `conversa ${c.id}`,
        detalhe: { unidade: c.unidade, de: m.antigo.inicio, agendamentoAntigo: b.agendamentoId, para: `${b.data} ${b.hora.padStart(5, '0')}`, agendamentoNovo: m.agendamento.trinksId, cancelouAntigo: m.cancelouAntigo },
        ip: req.ip,
        em: o.agora(),
      })
      .catch((e) => o.log?.('Remarcar: falha na auditoria', String(e)));
    return {
      ok: true,
      agendamentoId: m.agendamento.trinksId,
      data: dataISO(m.agendamento.inicio),
      hora: horaHHmm(m.agendamento.inicio),
      cancelouAntigo: m.cancelouAntigo,
      ...(confirmacao && !aviso?.startsWith('A confirmação') ? { confirmacao } : {}),
      ...(aviso ? { aviso } : {}),
    };
  });
}
