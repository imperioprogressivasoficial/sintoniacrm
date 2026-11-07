import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { Agendamento, Conversa, Etapa } from '../domain.js';
import { agendar, agendaDaUnidade, horariosLivres } from '../agenda/agendar.js';
import type { FonteAgenda } from '../agenda/sistema.js';
import { dataISO, DIA } from '../util/tempo.js';

/**
 * O que o agente precisa da agenda (src/agenda/sistema.ts): o roteador que escolhe o sistema de cada unidade
 * (Trinks, Avec ou AppBarber) ou um sistema só (nos testes, um falso no formato do Trinks).
 */
export type Agenda = FonteAgenda;

/** Efeitos que o agente pede e o app aplica depois (funil, lembretes, alerta para a equipe). */
export type AcaoAgente =
  | { tipo: 'agendou'; agendamento: Agendamento; clienteTrinksId: number }
  | { tipo: 'passar_para_humano'; motivo: string }
  | { tipo: 'etapa'; etapa: Etapa; motivo: string }
  /** Marcar uma tag que JÁ EXISTE na empresa (a IA nunca cria tag). */
  | { tipo: 'marcar_tag'; nome: string };

const UNIDADES_COM_AGENDA = ['norte', 'sumare'] as const;

type Ferramenta = Anthropic.Beta.Messages.BetaTool;

const def = (name: string, description: string, properties: Record<string, unknown>): Ferramenta => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
});

const unidadeProp = {
  type: 'string',
  enum: UNIDADES_COM_AGENDA,
  description: 'norte = Salvador Norte Shopping, sumare = Shopping Sumaré',
};

export const FERRAMENTAS_LEITURA: Ferramenta[] = [
  def('ver_servicos', 'Lista os serviços da unidade no sistema de agenda do salão, com id, preço de tabela, preço promocional de hoje e duração.', {
    unidade: unidadeProp,
  }),
  def(
    'consultar_horarios',
    'Horários livres de um dia para um serviço, por profissional. Use antes de propor qualquer horário.',
    {
      unidade: unidadeProp,
      data: { type: 'string', description: 'Dia no formato AAAA-MM-DD' },
      servico_id: { type: 'integer', description: 'id vindo de ver_servicos' },
      profissional_id: { type: ['integer', 'null'], description: 'Opcional: filtra uma profissional' },
    },
  ),
  def('ver_agendamentos_da_cliente', 'Próximos horários marcados desta cliente (próximos 60 dias).', {
    unidade: unidadeProp,
  }),
  def('registrar_etapa', 'Atualiza a etapa da cliente no funil quando o momento dela ficar claro.', {
    etapa: { type: 'string', enum: ['em_conversa', 'interessada', 'perdida'] },
    motivo: { type: 'string', description: 'Uma frase curta explicando' },
  }),
];

/**
 * Ferramenta de tags: só entra quando a empresa ligou "IA marca tags" e existe alguma tag.
 * A lista de nomes vai no enum (o modelo não consegue inventar um nome) e é conferida de novo ao aplicar.
 */
export function ferramentaMarcarTag(nomes: string[]): Ferramenta {
  return def(
    'marcar_tag',
    `Marca na conversa uma das tags da loja, quando a conversa deixar isso claro (ex.: a cliente diz que veio pelo Instagram → "Instagram"). Use só se tiver certeza; não precisa avisar a cliente. Tags existentes: ${nomes.map((n) => `"${n}"`).join(', ')}.`,
    { nome: { type: 'string', enum: nomes, description: 'Nome exato de uma tag existente' } },
  );
}

export const FERRAMENTAS_ESCRITA: Ferramenta[] = [
  def(
    'agendar',
    'Marca o horário no sistema de agenda do salão. Só use depois que a cliente confirmou serviço, unidade, dia, hora e profissional.',
    {
      unidade: unidadeProp,
      servico_id: { type: 'integer' },
      profissional_id: { type: 'integer' },
      data: { type: 'string', description: 'AAAA-MM-DD' },
      hora: { type: 'string', description: 'HH:mm, um dos horários de consultar_horarios' },
      nome_cliente: { type: 'string', description: 'Nome completo da cliente para o cadastro' },
    },
  ),
  def('passar_para_humano', 'Chama alguém da equipe para continuar esta conversa. A IA para de responder aqui.', {
    motivo: { type: 'string' },
  }),
];

const Unidade = z.enum(UNIDADES_COM_AGENDA);
const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Hora = z.string().regex(/^\d{1,2}:\d{2}$/);

const ENTRADAS = {
  ver_servicos: z.object({ unidade: Unidade }),
  consultar_horarios: z.object({
    unidade: Unidade,
    data: Data,
    servico_id: z.number().int(),
    profissional_id: z.number().int().nullable(),
  }),
  ver_agendamentos_da_cliente: z.object({ unidade: Unidade }),
  registrar_etapa: z.object({ etapa: z.enum(['em_conversa', 'interessada', 'perdida']), motivo: z.string() }),
  agendar: z.object({
    unidade: Unidade,
    servico_id: z.number().int(),
    profissional_id: z.number().int(),
    data: Data,
    hora: Hora,
    nome_cliente: z.string().min(3),
  }),
  passar_para_humano: z.object({ motivo: z.string() }),
} as const;

export interface ContextoFerramentas {
  agenda: Agenda;
  conversa: Conversa;
  agora: Date;
  acoes: AcaoAgente[];
  /** Em modo sugestão, nada é gravado na agenda. */
  podeEscrever: boolean;
  /** Tags que a IA pode marcar (vazio = não marca). */
  tagsDisponiveis?: string[];
}


/** Executa uma ferramenta e devolve o texto do tool_result. Erros viram mensagem para a IA. */
export async function executarFerramenta(
  nome: string,
  entrada: unknown,
  ctx: ContextoFerramentas,
): Promise<{ conteudo: string; erro: boolean }> {
  try {
    const r = await rodar(nome, entrada, ctx);
    return { conteudo: JSON.stringify(r), erro: false };
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? `Parâmetros inválidos: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
        : e instanceof Error
          ? e.message
          : String(e);
    return { conteudo: msg, erro: true };
  }
}

async function rodar(nome: string, entrada: unknown, ctx: ContextoFerramentas): Promise<unknown> {
  const { agenda, conversa, agora } = ctx;
  switch (nome) {
    case 'ver_servicos': {
      const i = ENTRADAS.ver_servicos.parse(entrada);
      const { sistema, local } = agendaDaUnidade(agenda, i.unidade);
      const servicos = await sistema.listarServicos(local);
      return servicos
        .filter((s) => s.visivelParaCliente !== false)
        .map((s) => ({
          id: s.id,
          nome: s.nome,
          categoria: s.categoria ?? null,
          duracao_min: s.duracaoEmMinutos,
          preco: s.preco,
          preco_promocional_hoje: s.valorPromocional ?? null,
        }));
    }
    case 'consultar_horarios': {
      const i = ENTRADAS.consultar_horarios.parse(entrada);
      if (i.data < dataISO(agora)) throw new Error('Essa data já passou.');
      const livres = await horariosLivres(agenda, i.unidade, i.data, i.servico_id, i.profissional_id ?? undefined, agora);
      return livres.length ? livres : 'Nenhum horário livre nesse dia para esse serviço.';
    }
    case 'ver_agendamentos_da_cliente': {
      const i = ENTRADAS.ver_agendamentos_da_cliente.parse(entrada);
      const { sistema, tipo, local: est } = agendaDaUnidade(agenda, i.unidade);
      const clienteId =
        (tipo === 'trinks' ? conversa.trinksClienteId : undefined) ?? (await sistema.buscarClientePorTelefone(est, conversa.telefone))?.id;
      if (!clienteId) return 'Cliente ainda não tem cadastro na agenda do salão.';
      const lista = await sistema.listarAgendamentosDoCliente(
        est,
        clienteId,
        dataISO(agora),
        dataISO(new Date(agora.getTime() + 60 * DIA)),
      );
      // Status 9 = cancelado no Trinks; os outros sistemas marcam `cancelado`.
      const ativos = lista.filter((a) => !a.cancelado && !(tipo === 'trinks' && a.status?.id === 9));
      return ativos.length
        ? ativos.map((a) => ({
            id: a.id,
            servico: a.servico?.nome,
            profissional: a.profissional?.nome,
            inicio: a.dataHoraInicio,
            status: a.status?.nome,
          }))
        : 'Nenhum horário marcado.';
    }
    case 'registrar_etapa': {
      const i = ENTRADAS.registrar_etapa.parse(entrada);
      ctx.acoes.push({ tipo: 'etapa', etapa: i.etapa, motivo: i.motivo });
      return 'ok';
    }
    case 'agendar': {
      const i = ENTRADAS.agendar.parse(entrada);
      if (!ctx.podeEscrever) throw new Error('Modo sugestão: não agende. Escreva a mensagem propondo o horário.');
      const r = await agendar(
        agenda,
        conversa,
        {
          unidade: i.unidade,
          servicoId: i.servico_id,
          profissionalId: i.profissional_id,
          data: i.data,
          hora: i.hora,
          nomeCliente: i.nome_cliente,
          origem: 'IA via WhatsApp',
        },
        agora,
      );
      ctx.acoes.push({ tipo: 'agendou', clienteTrinksId: r.clienteTrinksId, agendamento: r.agendamento });
      return {
        ok: true,
        agendamento_id: r.agendamento.trinksId,
        servico: r.agendamento.servico,
        profissional: r.agendamento.profissional,
        data: i.data,
        hora: i.hora,
        valor: r.valor,
      };
    }
    case 'passar_para_humano': {
      const i = ENTRADAS.passar_para_humano.parse(entrada);
      if (!ctx.podeEscrever) throw new Error('Modo sugestão: apenas sugira que alguém da equipe continue.');
      ctx.acoes.push({ tipo: 'passar_para_humano', motivo: i.motivo });
      return 'ok: a equipe foi avisada. Diga à cliente que alguém da equipe vai continuar o atendimento.';
    }
    case 'marcar_tag': {
      const i = z.object({ nome: z.string() }).parse(entrada);
      const alvo = i.nome.trim().toLowerCase();
      const existente = (ctx.tagsDisponiveis ?? []).find((n) => n.toLowerCase() === alvo);
      if (!existente) throw new Error('Essa tag não existe. Use só as tags da lista; a IA não cria tags.');
      if (!ctx.acoes.some((a) => a.tipo === 'marcar_tag' && a.nome === existente)) ctx.acoes.push({ tipo: 'marcar_tag', nome: existente });
      return 'ok';
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${nome}`);
  }
}
