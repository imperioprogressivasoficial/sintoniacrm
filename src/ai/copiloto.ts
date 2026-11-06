import type Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Conversa, Mensagem } from '../domain.js';
import type { TrinksServico } from '../agenda/trinks.js';
import { contextoDaConversa, historicoParaTurnos } from './prompt.js';

/**
 * Revisão do rascunho enquanto a atendente digita (antes de enviar).
 * A IA nunca envia nada aqui: só aponta problemas e propõe uma versão melhor.
 */

export const Revisao = z.object({
  ok: z.boolean().describe('true quando a mensagem pode ser enviada como está'),
  alertas: z.array(
    z.object({
      tipo: z.enum(['preco', 'informacao', 'conducao', 'tom', 'agenda']),
      texto: z.string().describe('Uma frase curta para a atendente'),
    }),
  ),
  versao_sugerida: z.string().nullable().describe('Rascunho melhorado, ou null se ok'),
});
export type Revisao = z.infer<typeof Revisao>;

export type ClienteClaudeParse = { beta: { messages: Pick<Anthropic['beta']['messages'], 'parse'> } };

const INSTRUCOES = `Você revisa, antes do envio, a mensagem que uma atendente da Império Progressivas escreveu para uma cliente no WhatsApp.
Aponte só o que importa:
- preco: valor diferente da tabela do Trinks informada abaixo.
- informacao: afirmação insegura ou incorreta ("não sei", promessa de resultado, regra que não existe na base).
- conducao: a mensagem não leva a cliente ao próximo passo (normalmente propor horário).
- tom: frio, ríspido ou longo demais para WhatsApp.
- agenda: cita dia ou horário que precisa ser conferido na agenda.
Se a mensagem estiver boa, devolva ok = true, sem alertas e versao_sugerida = null.
A versão sugerida mantém o jeito da atendente: curta, natural, sem markdown.`;

export async function revisarRascunho(
  claude: ClienteClaudeParse,
  opcoes: { modelo: string; baseConhecimento: string },
  dados: { conversa: Conversa; mensagens: Mensagem[]; rascunho: string; servicos: TrinksServico[]; agora: Date },
): Promise<Revisao> {
  const tabela = dados.servicos
    .map((s) => `- ${s.nome}: R$ ${s.preco.toFixed(2)}${s.valorPromocional != null ? ` (hoje R$ ${s.valorPromocional.toFixed(2)})` : ''}, ${s.duracaoEmMinutos} min`)
    .join('\n');
  const conversaTexto = historicoParaTurnos(dados.mensagens.slice(-12))
    .map((t) => `${t.role === 'user' ? 'Cliente' : 'Loja'}: ${t.content}`)
    .join('\n');

  const resp = await claude.beta.messages.parse({
    model: opcoes.modelo,
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: `${INSTRUCOES}\n\n<base_de_conhecimento>\n${opcoes.baseConhecimento}\n</base_de_conhecimento>`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `${contextoDaConversa(dados.conversa, dados.agora)}\n\n<tabela_trinks>\n${tabela || '(indisponível)'}\n</tabela_trinks>\n\n<conversa>\n${conversaTexto}\n</conversa>\n\n<rascunho_da_atendente>\n${dados.rascunho}\n</rascunho_da_atendente>`,
      },
    ],
    output_config: { effort: 'low', format: betaZodOutputFormat(Revisao) },
  });

  if (resp.stop_reason === 'refusal' || !resp.parsed_output) {
    return { ok: true, alertas: [], versao_sugerida: null };
  }
  return resp.parsed_output;
}
